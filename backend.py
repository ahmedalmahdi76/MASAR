"""
Masar Backend — FastAPI Server
Pipeline layers:
  Layer 1 + 2: /ws/audio  — PCM audio → Deepgram STT → live transcript
  Layer 3:     /refine    — Arabic transcript → Gemini → professional ECE English (SSE stream)
"""

import os
import re
import json
import asyncio
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel
from dotenv import load_dotenv
from google import genai
from google.genai import types
from anthropic import AsyncAnthropic
from elevenlabs.client import ElevenLabs as ElevenLabsClient
from deepgram import (
    DeepgramClient,
    DeepgramClientOptions,
    LiveTranscriptionEvents,
    LiveOptions,
)

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("masar")

app = FastAPI(title="Masar API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Singletons — initialised once at startup ──────────────────────────────────

# Deepgram
_dg_config = DeepgramClientOptions(options={"keepalive": "true"})
deepgram = DeepgramClient(os.getenv("DEEPGRAM_API_KEY"), _dg_config)

# Gemini (new google-genai SDK — properly async)
gemini = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

# Anthropic (Layer 4 — AI Reasoning Core)
anthropic = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# ElevenLabs (Layer 5 — TTS)
# Set ELEVENLABS_VOICE_ID in .env to override; default is a multilingual voice.
_ELEVENLABS_KEY = os.getenv("ELEVENLABS_API_KEY", "")
elevenlabs_client = ElevenLabsClient(api_key=_ELEVENLABS_KEY) if _ELEVENLABS_KEY else None
DEFAULT_VOICE_ID  = os.getenv("ELEVENLABS_VOICE_ID", "UR972wNGq3zluze0LoIp")
logger.info("ElevenLabs DEFAULT_VOICE_ID at startup: %s", DEFAULT_VOICE_ID)

# ── System prompts ────────────────────────────────────────────────────────────

REFINEMENT_SYSTEM_PROMPT = """You are the Refinement Layer of Masar (مسار), an AI network planning assistant for telecom engineers.

Your ONLY job: convert the Egyptian Arabic speech transcript you receive into a precise, professional English network planning request.

Output rules:
- Return ONLY the refined English request — no preamble, no explanation, no "Here is..."
- Use IEEE / ITU-T / 3GPP standard terminology
- Preserve every technical detail: frequencies, distances, site counts, topology types, link budgets
- If the input is vague, apply standard telecom engineering assumptions and be explicit about them
- Never fabricate details that were not implied by the input

Adjust output depth by tech level:
- Beginner: Plain English, avoid heavy math and acronyms, explain any term used
- Professional: Standard ECE terminology, reference relevant standards, include key formulas
- Expert: Dense technical language, cite 3GPP releases, assume full domain expertise, no hand-holding"""

GENERAL_REFINEMENT_SYSTEM_PROMPT = """You are a speech refinement assistant for Masar (مسار).

Your ONLY job: convert Egyptian Arabic speech transcript into clean, natural English.

Output rules:
- Return ONLY the cleaned English text — no preamble, no explanation
- Preserve the speaker's exact intent and tone faithfully
- Fix speech artifacts (repetitions, filler words) naturally
- Do NOT add technical jargon or impose any specific framing
- Keep the result conversational and natural"""


# ── Layer 1 + 2: WebSocket audio stream ──────────────────────────────────────

@app.websocket("/ws/audio")
async def audio_stream(websocket: WebSocket, sample_rate: int = 16000) -> None:
    """Receives raw PCM audio, forwards to Deepgram, streams transcript JSON back."""
    await websocket.accept()

    async def on_transcript(connection, result, **kwargs) -> None:
        sentence: str = result.channel.alternatives[0].transcript
        if sentence.strip():
            await websocket.send_json({
                "type": "transcript",
                "text": sentence,
                "is_final": result.is_final,
            })

    dg_connection = deepgram.listen.asyncwebsocket.v("1")
    dg_connection.on(LiveTranscriptionEvents.Transcript, on_transcript)

    options = LiveOptions(
        model="nova-3",
        language="ar",
        smart_format=True,
        encoding="linear16",
        channels=1,
        sample_rate=sample_rate,
        interim_results=True,
    )

    if not await dg_connection.start(options):
        await websocket.close(code=1011, reason="Deepgram connection failed")
        return

    try:
        while True:
            audio_chunk: bytes = await websocket.receive_bytes()
            await dg_connection.send(audio_chunk)
    except WebSocketDisconnect:
        logger.info("Client disconnected cleanly.")
    except Exception as e:
        logger.error("Audio loop error: %s: %s", type(e).__name__, e)
    finally:
        await dg_connection.finish()


# ── Layer 3: Refinement endpoint ──────────────────────────────────────────────

class RefineRequest(BaseModel):
    text: str
    tech_level: str = "Professional"  # Beginner | Professional | Expert
    service_id: str = "fiber"         # general → open-ended prompt


@app.post("/refine")
async def refine(req: RefineRequest) -> StreamingResponse:
    """
    Layer 3: Arabic transcript → Gemini → streamed ECE English via SSE.

    The google-generativeai SDK's sync streaming is reliable; we run it in a
    daemon thread and pipe tokens into an asyncio.Queue so FastAPI can yield
    them without blocking the event loop.

    SSE format:  data: <json-encoded token>\\n\\n
                 data: [DONE]\\n\\n
    """
    system_prompt = GENERAL_REFINEMENT_SYSTEM_PROMPT if req.service_id == "general" else REFINEMENT_SYSTEM_PROMPT
    full_prompt = f"Tech level: {req.tech_level}\n\nArabic transcript:\n{req.text}"

    async def event_stream():
        max_retries = 3
        try:
            for attempt in range(max_retries):
                try:
                    logger.info("Gemini: stream attempt %d", attempt + 1)
                    async for chunk in await gemini.aio.models.generate_content_stream(
                        model="gemini-2.5-flash",
                        contents=full_prompt,
                        config=types.GenerateContentConfig(
                            system_instruction=system_prompt,
                            temperature=0.3,
                        ),
                    ):
                        if chunk.text:
                            yield f"data: {json.dumps(chunk.text)}\n\n"
                    logger.info("Gemini: stream complete")
                    return
                except Exception as e:
                    err_str = str(e)
                    if ("429" in err_str or "503" in err_str) and attempt < max_retries - 1:
                        if "429" in err_str:
                            match = re.search(r'retry in ([\d.]+)(m?s)', err_str)
                            if match:
                                delay = float(match.group(1)) / 1000 if match.group(2) == 'ms' else float(match.group(1))
                                delay = max(1, min(int(delay) + 2, 65))
                            else:
                                delay = 30
                        else:
                            delay = 5  # 503: short wait, usually recovers quickly
                        logger.warning("Gemini %s — retrying in %ds", "429" if "429" in err_str else "503", delay)
                        yield f"data: {json.dumps(f'[Retrying in {delay}s…]')}\n\n"
                        await asyncio.sleep(delay)
                    else:
                        logger.error("Gemini error: %s", e)
                        yield f"data: {json.dumps('[ERROR] ' + err_str)}\n\n"
                        return
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── Layer 4: AI Reasoning Core ────────────────────────────────────────────────

_STYLE = """
قواعد الإجابة (إلزامية):
- أجب حصراً باللغة العربية الفصحى — ولا تستخدم الإنجليزية أبداً تحت أي ظرف (الاختصارات التقنية مثل IEEE وOSPF وDWDM مسموح بها)
- نقاط مختصرة فقط — بدون فقرات أو عناوين
- 6 إلى 8 أسطر كحد أقصى
- ابدأ فوراً بالحل أو التوصية المباشرة — بدون مقدمات
- كل سطر يجب أن يحمل قيمة تقنية: مواصفات، أرقام، معدات، أو مراجع معايير
- فضّل الأرقام على الأوصاف العامة (مثال: "23 GHz، 28 dBm Tx" لا "تردد مناسب")
- لا خاتمة ولا ملخص في النهاية

تعديل الكثافة حسب المستوى:
- Beginner: اشرح كل مصطلح باختصار، تجنب المعادلات المعقدة، استخدم أمثلة عملية
- Professional: مصطلحات هندسية كاملة، أشر للمعايير، اذكر الأرقام والمعادلات الأساسية
- Expert: أقصى كثافة تقنية، أشر لأرقام إصدارات المعايير، افترض خبرة كاملة"""

_REJECT = "إذا كان السؤال خارج نطاق هذه الخدمة، رد بجملة واحدة مهذبة بالعربية توجّه المستخدم للخدمة المناسبة، ولا تجب على السؤال."

SERVICE_PROMPTS = {
    "fiber": f"""أنت متخصص في تصميم شبكات الألياف الضوئية ضمن نظام مسار (Masar).

نطاق عملك: تصميم مسارات backbone الألياف، حسابات OSNR وميزانية الخسارة، فترات اللحام، أنواع الألياف (SMF/MMF/G.652/G.655)، تخطيط OTN وDWDM، معايير ITU-T G-series.
{_REJECT}
{_STYLE}""",

    "topology": f"""أنت متخصص في تصميم طبولوجيا الشبكات ضمن نظام مسار (Masar).

نطاق عملك: تصميم طبولوجيا Ring وMesh وStar وHybrid، معمارية Layer 2/3، مسارات التكرار والـ redundancy، معايير اختيار الطبولوجيا، IEEE 802.x.
{_REJECT}
{_STYLE}""",

    "ip": f"""أنت متخصص في تخطيط مخططات IP ضمن نظام مسار (Masar).

نطاق عملك: عنونة IP، تقسيم الشبكات (VLSM/CIDR)، تخطيط IPv4/IPv6، اختيار بروتوكول التوجيه (OSPF/BGP/EIGRP)، خطط تخصيص العناوين، RFC 1918.
{_REJECT}
{_STYLE}""",

    "monitoring": f"""أنت متخصص في مراقبة الشبكات ضمن نظام مسار (Masar).

نطاق عملك: SNMP v2c/v3، NetFlow/IPFIX، Syslog، التنبيهات الفورية، أدوات المراقبة (Zabbix/PRTG/Nagios)، لوحات KPI، إدارة الأعطال، ITU-T M.3000.
{_REJECT}
{_STYLE}""",

    "capacity": f"""أنت متخصص في تخطيط السعة الشبكية ضمن نظام مسار (Masar).

نطاق عملك: تقدير النطاق الترددي، توقع نمو الحركة، حسابات الإنتاجية، استخدام الروابط، تخطيط الترقية، نماذج حركة Erlang، ITU-T E.501.
{_REJECT}
{_STYLE}""",

    "redundancy": f"""أنت متخصص في تصميم التكرار وعالي التوافر ضمن نظام مسار (Masar).

نطاق عملك: مسارات الـ failover، Hot/Warm/Cold Standby، تخطيط STP/RSTP (IEEE 802.1D/w)، VRRP/HSRP، تجميع الروابط (LACP/802.3ad)، تصميم HA بنسبة 99.999%.
{_REJECT}
{_STYLE}""",

    "security": f"""أنت متخصص في أمن الشبكات ضمن نظام مسار (Masar).

نطاق عملك: تقسيم مناطق الجدار الناري، قوائم ACL، معمارية DMZ، تصميم VPN (IPSec/SSL)، وضع IDS/IPS، تجزئة الشبكة، معايير ISO 27001 وNIST SP 800-53.
{_REJECT}
{_STYLE}""",

    "qos": f"""أنت متخصص في تصميم جودة الخدمة (QoS) ضمن نظام مسار (Masar).

نطاق عملك: تشكيل الحركة، وسم DSCP (RFC 2474)، قوائم الأولوية (PQ/WFQ/CBWFQ)، سياسات QoS، ضمانات النطاق الترددي، تحسين الكمون والـ jitter، CoS IEEE 802.1p.
{_REJECT}
{_STYLE}""",

    "general": f"""أنت مسار (Masar)، مساعد هندسة شبكات متكامل.

نطاق عملك: أي موضوع في هندسة الشبكات والاتصالات — لا قيود على الأسئلة الهندسية.
{_STYLE}""",
}


class SolveRequest(BaseModel):
    refined_prompt: str
    tech_level: str = "Professional"  # Beginner | Professional | Expert
    service_id: str = "fiber"         # general → open-ended assistant
    response_language: str = "arabic" # arabic | english — Priority 5 toggle


@app.post("/solve")
async def solve(req: SolveRequest) -> StreamingResponse:
    """
    Layer 4: Refined English prompt → Claude Haiku → streamed network solution via SSE.

    SSE format:  data: <json-encoded token>\\n\\n
                 data: [DONE]\\n\\n
    """
    planning_prompt = SERVICE_PROMPTS.get(req.service_id, SERVICE_PROMPTS["general"])
    full_prompt     = f"Tech level: {req.tech_level}\n\nRequest:\n{req.refined_prompt}"

    async def event_stream():
        try:
            async with anthropic.messages.stream(
                model="claude-haiku-4-5-20251001",
                max_tokens=512,
                system=planning_prompt,
                messages=[{"role": "user", "content": full_prompt}],
            ) as stream:
                async for token in stream.text_stream:
                    yield f"data: {json.dumps(token)}\n\n"
        except Exception as e:
            logger.error("Claude error: %s", e)
            yield f"data: {json.dumps('[ERROR] ' + str(e))}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── Layer 5: Text-to-Speech (ElevenLabs) ─────────────────────────────────────

class TTSRequest(BaseModel):
    text: str
    voice_id: str = ""   # empty → use DEFAULT_VOICE_ID from env


@app.post("/tts")
async def tts(req: TTSRequest) -> Response:
    """
    Layer 5: Solution text → ElevenLabs eleven_multilingual_v2 → MP3 audio bytes.

    Returns raw audio/mpeg so the browser creates a Blob URL and plays it
    directly with HTMLAudioElement — no streaming needed at response sizes.
    """
    if not elevenlabs_client:
        return Response(
            content=b"",
            status_code=503,
            headers={"X-TTS-Error": "ELEVENLABS_API_KEY not configured"},
        )

    voice = req.voice_id or DEFAULT_VOICE_ID or "UR972wNGq3zluze0LoIp"
    loop  = asyncio.get_event_loop()
    logger.info("TTS request — voice_id: %s", voice)

    def _synthesize() -> bytes:
        chunks = elevenlabs_client.text_to_speech.convert(
            voice_id=voice,
            text=req.text,
            model_id="eleven_multilingual_v2",
            output_format="mp3_44100_128",
        )
        return b"".join(chunks)

    try:
        audio_bytes = await loop.run_in_executor(None, _synthesize)
        return Response(
            content=audio_bytes,
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-store"},
        )
    except Exception as e:
        logger.error("ElevenLabs error: %s", e)
        return Response(content=b"", status_code=502,
                        headers={"X-TTS-Error": str(e)})
