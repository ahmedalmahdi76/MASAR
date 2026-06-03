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
_dg_key = os.getenv("DEEPGRAM_API_KEY", "")
if _dg_key:
    logger.info("Deepgram API key loaded: %s... (len=%d)", _dg_key[:8], len(_dg_key))
else:
    logger.error("Deepgram API key is NOT set — check .env")
deepgram = DeepgramClient(_dg_key, _dg_config)

# Anthropic (Layer 4 — AI Reasoning Core)
anthropic = AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# ElevenLabs (Layer 5 — TTS)
# Set ELEVENLABS_VOICE_ID in .env to override; default is a multilingual voice.
_ELEVENLABS_KEY = os.getenv("ELEVENLABS_API_KEY", "")
elevenlabs_client = ElevenLabsClient(api_key=_ELEVENLABS_KEY) if _ELEVENLABS_KEY else None
DEFAULT_VOICE_ID  = os.getenv("ELEVENLABS_VOICE_ID", "UR972wNGq3zluze0LoIp")
logger.info("ElevenLabs DEFAULT_VOICE_ID at startup: %s", DEFAULT_VOICE_ID)

# ── System prompts ────────────────────────────────────────────────────────────

REFINEMENT_SYSTEM_PROMPT = """You are the Refinement Layer of Masar (مسار), a graduation project built at MTI University, Faculty of Engineering, Electronics and Communications Department. Masar is an AI-powered voice network planning assistant for telecom engineers — its purpose is to help ECE engineers plan and design telecommunications networks by speaking in Egyptian Arabic dialect and receiving professional network planning solutions.

Your ONLY job: convert the Egyptian Arabic speech transcript you receive into a precise, professional English network planning request.

Output rules:
- Return ONLY the refined English request — no preamble, no explanation, no "Here is..."
- Use IEEE / ITU-T / 3GPP standard terminology
- Preserve every technical detail: frequencies, distances, site counts, topology types, link budgets
- If the input is vague, apply standard telecom engineering assumptions and be explicit about them
- Never fabricate details that were not implied by the input
- Structure the output as a precise engineering request optimized to produce the most detailed and accurate network planning solution from an AI model — while keeping it professional IEEE/ITU-T/3GPP standard English. The refined output should read like a request written by a senior telecom engineer, not a transcription of spoken words.

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
    dg_connection.on(LiveTranscriptionEvents.Error,
        lambda conn, error, **kw: logger.error("Deepgram stream error event: %s", error))

    options = LiveOptions(
        model="nova-3",
        language="ar",
        smart_format=True,
        encoding="linear16",
        channels=1,
        sample_rate=sample_rate,
        interim_results=True,
    )

    logger.info(
        "Starting Deepgram — model=%s  lang=%s  encoding=%s  sr=%s  interim=%s",
        options.model, options.language, options.encoding, options.sample_rate, options.interim_results,
    )

    try:
        started = await dg_connection.start(options)
    except Exception as exc:
        logger.error("dg_connection.start() raised an exception: %s", exc)
        started = False

    if not started:
        logger.error(
            "Deepgram refused to start — model=%s  lang=%s  encoding=%s  sr=%s",
            options.model, options.language, options.encoding, sample_rate,
        )
        await websocket.close(code=1011, reason="Deepgram connection failed")
        return

    logger.info("Deepgram streaming session open — waiting for audio")

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
    Layer 3: Arabic transcript → Claude Haiku → streamed ECE English via SSE.

    SSE format:  data: <json-encoded token>\\n\\n
                 data: [DONE]\\n\\n
    """
    system_prompt = GENERAL_REFINEMENT_SYSTEM_PROMPT if req.service_id == "general" else REFINEMENT_SYSTEM_PROMPT
    full_prompt   = f"Tech level: {req.tech_level}\n\nArabic transcript:\n{req.text}"

    async def event_stream():
        max_retries = 3
        try:
            for attempt in range(max_retries):
                try:
                    logger.info("Claude refine: attempt %d", attempt + 1)
                    async with anthropic.messages.stream(
                        model="claude-haiku-4-5-20251001",
                        max_tokens=300,
                        system=system_prompt,
                        messages=[{"role": "user", "content": full_prompt}],
                    ) as stream:
                        async for token in stream.text_stream:
                            yield f"data: {json.dumps(token)}\n\n"
                    logger.info("Claude refine: complete")
                    return
                except Exception as e:
                    err_str    = str(e)
                    is_rate     = "429" in err_str or "rate_limit" in err_str.lower()
                    is_overload = "529" in err_str or "overloaded" in err_str.lower() or "503" in err_str
                    if (is_rate or is_overload) and attempt < max_retries - 1:
                        delay = 30 if is_rate else 5
                        logger.warning("Claude refine %s — retrying in %ds", "429" if is_rate else "503/529", delay)
                        yield f"data: {json.dumps(f'[Retrying in {delay}s…]')}\n\n"
                        await asyncio.sleep(delay)
                    else:
                        logger.error("Claude refine error: %s", e)
                        yield f"data: {json.dumps('[ERROR] ' + err_str)}\n\n"
                        return
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Layer 4: AI Reasoning Core ────────────────────────────────────────────────

_STYLE = """
قواعد الرد (إلزامية — لا استثناء):
- اتكلم بالعامية المصرية دايمًا — ممنوع الفصحى أو أي لغة تانية تحت أي ظرف، حتى لو المستخدم اتكلم بالفصحى أو بالإنجليزي (المصطلحات التقنية زي IEEE وOSPF وDWDM تفضل بالإنجليزي)
- الرد يكون كلام طبيعي قابل للنطق من غير أي رموز تنسيق. ممنوع تماماً الإيموجي والـ em dashes والشرطات والنجوم والـ bullets والـ headers. الفواصل والنقاط بس هي المسموح بيها للوقفات.
- كون مختصر قدر الإمكان من غير ما تحذف أي معلومة تقنية مهمة. متكررش ومتحشيش. وقف لما الإجابة تكتمل من غير ما تحدد عدد أسطر معين.
- ابدأ فورًا بالحل أو التوصية مباشرةً — من غير مقدمات
- كل سطر لازم يحمل قيمة تقنية: مواصفات، أرقام، معدات، أو مراجع معايير
- فضّل الأرقام على الوصف العام (مثال: "23 GHz، 28 dBm Tx" مش "تردد مناسب")
- من غير خاتمة أو تلخيص في الآخر
- استخدم كلمات عامية مصرية بسيطة وواضحة النطق قدر الإمكان. تجنب الكلمات النادرة أو الصعبة النطق في العامية حتى لو كانت فصحى صح. الكلام لازم يبقى سهل الاستماع وطبيعي للأذن المصرية.

تعديل الكثافة حسب المستوى:
- Beginner: اشرح كل مصطلح بإيجاز، ابعد عن المعادلات التقيلة، استخدم أمثلة عملية
- Professional: مصطلحات هندسية كاملة، أشر للمعايير، اذكر الأرقام والمعادلات الأساسية
- Expert: أعلى كثافة تقنية، أشر لأرقام إصدارات المعايير، افترض خبرة كاملة"""

_REJECT = "لو السؤال برا نطاق الخدمة دي، رد بجملة واحدة محترمة بالعامية المصرية توجّه المستخدم للخدمة المناسبة، ومتجاوبش على السؤال."

SERVICE_PROMPTS = {
    "fiber": f"""أنت متخصص في تصميم شبكات الألياف الضوئية ضمن نظام مسار (Masar).

نطاق عملك: تصميم مسارات backbone الألياف، حسابات OSNR وميزانية الخسارة، فترات اللحام، أنواع الألياف (SMF/MMF/G.652/G.655)، تخطيط OTN وDWDM، معايير ITU-T G-series.
{_REJECT}
{_STYLE}""",

    "topology": f"""أنت مسار، متخصص في تصميم توبولوجيا الشبكات، بتتكلم بالعامية المصرية.

أول ما تسمع المهندس بتحدد تلقائيًا إيه اللي عايزه: هل بيصمم توبولوجيا من الأول، بيقارن بين خيارات، عنده مشكلة في توبولوجيا شغالة، أو عنده قيود في الميزانية أو الحجم أو الـ redundancy.

ابدأ بانطباعك الأولي والاتجاه اللي شايفه على أساس اللي سمعته. بعدين اسأل أسئلة توضيحية ذكية تملي الناقص، إنت بتحدد إيه الناقص على حسب الحالة. لو التصميم الكامل أو توصيات معدات أو مسارات الـ redundancy هيفيدوا اعرضهم بشكل طبيعي في الكلام من غير ما تجبر المهندس. المهندس هو اللي بيقرر يكمل في التفاصيل أو ياخد التوصية ويمشي.

لو السؤال برا نطاق التوبولوجيا مش بتحول أوتوماتيك بس بتقوله بأدب إيه الخدمة الأنسب وتفضل في الكلام معاه.
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

    "security": f"""أنت مسار، متخصص في أمن الشبكات، بتتكلم بالعامية المصرية.

أول ما تسمع المهندس بتقرأ مستوى التفاصيل اللي قالها وبتتعامل على أساسها. لو وصف سيناريو كامل بتغوص فيه فوراً وتديه اتجاه معمارية أمنية شاملة وتسأله أسئلة مستهدفة للمواصفات الناقصة. لو سأل سؤال سريع بتجاوب مباشر ومختصر وتعرضله التوسع لو محتاج.

الأنواع اللي بتتعاملها: تصميم معمارية الـ firewall وإعداد الـ DMZ لسيناريوهات محددة وتخطيط الـ VPN بين المواقع ومراجعة أو audit لتصميم أمني موجود ومقارنة حلول أمنية تحت قيود والتعامل مع ثغرة أو تهديد وأي حاجة تانية في نطاق الأمن.

تنبيه إلزامي للمخاطر: لو المهندس وصف تصميم أو نهج فيه ثغرة أمنية واضحة أو misconfiguration أو فيه ممارسة أفضل متاحة لازم تنبهه فوراً من غير ما ينتظر يسألك. زي مستشار أمن بيشوف حاجة غلط بيقولها على طول.

لو السؤال برا نطاق الأمن مش بتحول أوتوماتيك بس بتقوله إيه الخدمة الأنسب وتفضل في الكلام معاه.
{_STYLE}""",

    "qos": f"""أنت متخصص في تصميم جودة الخدمة (QoS) ضمن نظام مسار (Masar).

نطاق عملك: تشكيل الحركة، وسم DSCP (RFC 2474)، قوائم الأولوية (PQ/WFQ/CBWFQ)، سياسات QoS، ضمانات النطاق الترددي، تحسين الكمون والـ jitter، CoS IEEE 802.1p.
{_REJECT}
{_STYLE}""",

    "general": f"""أنت مسار، مساعد هندسة شبكات واتصالات بتتكلم بالعامية المصرية. اتبنيت كمشروع تخرج في كلية الهندسة جامعة MTI، قسم الإلكترونيات والاتصالات.

بتتعامل مع أي سؤال في هندسة الشبكات والاتصالات من غير قيود. لو السؤال فيه تخصص واضح زي الألياف أو التوبولوجيا أو الأمن بتقول للمهندس إن الخدمة دي بتتعامل معاه أكتر بس مش بتحوله أوتوماتيك، هو اللي بيقرر يكمل أو يروح.
{_STYLE}""",
}


class SolveRequest(BaseModel):
    refined_prompt: str
    tech_level: str = "Professional"  # Beginner | Professional | Expert
    service_id: str = "fiber"         # general → open-ended assistant
    response_language: str = "arabic" # arabic | english — Priority 5 toggle
    history: list[dict] = []          # [{user: str, assistant: str}, ...] last N turns


@app.post("/solve")
async def solve(req: SolveRequest) -> StreamingResponse:
    """
    Layer 4: Refined English prompt → Claude Haiku → streamed network solution via SSE.

    SSE format:  data: <json-encoded token>\\n\\n
                 data: [DONE]\\n\\n
    """
    planning_prompt = SERVICE_PROMPTS.get(req.service_id, SERVICE_PROMPTS["general"])
    full_prompt     = f"Tech level: {req.tech_level}\n\nRequest:\n{req.refined_prompt}"

    history = req.history[-6:]
    messages = []
    for turn in history:
        messages.append({"role": "user",      "content": turn["user"]})
        messages.append({"role": "assistant", "content": turn["assistant"]})
    messages.append({"role": "user", "content": full_prompt})

    async def event_stream():
        _max_tokens = {'Beginner': 768, 'Professional': 1024, 'Expert': 2048}.get(req.tech_level, 1024)
        try:
            async with anthropic.messages.stream(
                model="claude-haiku-4-5-20251001",
                max_tokens=_max_tokens,
                system=planning_prompt,
                messages=messages,
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

def clean_for_tts(text: str) -> str:
    """Strip markdown artifacts that ElevenLabs would speak aloud."""
    text = re.sub(r'[*_#`~]', '', text)
    text = re.sub(r'\n+', ' ', text)
    text = re.sub(r'\s{2,}', ' ', text)
    return text.strip()



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

    voice        = req.voice_id or DEFAULT_VOICE_ID or "UR972wNGq3zluze0LoIp"
    loop         = asyncio.get_event_loop()
    cleaned_text = clean_for_tts(req.text)
    logger.info("TTS voice=%s chars=%d", voice, len(cleaned_text))

    def _synthesize() -> bytes:
        chunks = elevenlabs_client.text_to_speech.convert(
            voice_id=voice,
            text=cleaned_text,
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


def chunk_text(text: str, max_chars: int = 150) -> list:
    words, chunks, current = text.split(), [], ""
    for word in words:
        if len(current) + len(word) + 1 <= max_chars:
            current = (current + " " + word).strip()
        else:
            if current:
                chunks.append(current)
            current = word
    if current:
        chunks.append(current)
    return chunks


@app.post("/tts-stream")
async def tts_stream(req: TTSRequest) -> StreamingResponse:
    """
    Layer 5 variant: split text into sentences, synthesize each sequentially,
    stream MP3 bytes back as each sentence finishes. First audio arrives in
    ~1-2 s instead of waiting for the full text (~8-10 s).
    """
    if not elevenlabs_client:
        return Response(content=b"", status_code=503,
                        headers={"X-TTS-Error": "ELEVENLABS_API_KEY not configured"})

    voice   = req.voice_id or DEFAULT_VOICE_ID or "UR972wNGq3zluze0LoIp"
    loop    = asyncio.get_event_loop()
    cleaned = clean_for_tts(req.text)
    chunks  = chunk_text(cleaned, max_chars=400)
    logger.info("TTS-stream voice=%s chunks=%d", voice, len(chunks))

    async def generate():
        for chunk in chunks:
            def _synth(s=chunk):
                return b"".join(elevenlabs_client.text_to_speech.convert(
                    voice_id=voice,
                    text=s,
                    model_id="eleven_multilingual_v2",
                    output_format="mp3_44100_128",
                ))
            try:
                audio_bytes = await loop.run_in_executor(None, _synth)
                yield audio_bytes
            except asyncio.CancelledError:
                logger.info("TTS-stream: client disconnected, stopping")
                return
            except Exception as e:
                logger.error("TTS-stream chunk error (skipping): %s", e)

    return StreamingResponse(generate(), media_type="audio/mpeg",
                             headers={"Cache-Control": "no-store"})


# ── Session title generator ───────────────────────────────────────────────────

class SessionTitleRequest(BaseModel):
    first_question: str
    service_id: str = "fiber"


@app.post("/session-title")
async def session_title(req: SessionTitleRequest):
    """Generate a short Arabic session title (≤5 words) using Claude Haiku."""
    try:
        message = await anthropic.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=30,
            messages=[{
                "role": "user",
                "content": (
                    f"اعمل عنوان قصير جداً (أقصى 5 كلمات بالعربي) يلخص السؤال الهندسي ده. "
                    f"ارجع العنوان بس من غير أي شرح.\n"
                    f"السؤال: {req.first_question}"
                ),
            }],
        )
        title = message.content[0].text.strip()
        logger.info("session-title generated: %r", title)
        return {"title": title}
    except Exception as e:
        logger.error("session-title error: %s", e)
        return {"title": req.service_id}


# ── Network Diagram Generator ─────────────────────────────────────────────────

class DiagramRequest(BaseModel):
    solution: str
    service_id: str


@app.post("/diagram")
async def generate_diagram(req: DiagramRequest):
    """Generate a Mermaid.js diagram from a Claude solution text."""
    system_prompt = """You are a network diagram generator. Your ONLY job is to generate valid Mermaid.js diagram syntax that visually represents the network topology described.

Rules:
- Return ONLY valid Mermaid syntax
- No explanation, no markdown fences, no preamble — just raw Mermaid code
- Start directly with diagram type
- Use clear English node labels
- Maximum 15 nodes
- For network topologies: graph TD or LR
- For process flows: flowchart TD
- For sequences: sequenceDiagram
- Make it accurate to the described network

Example for ring topology:
graph LR
    Site1((Site 1)) --- Site2((Site 2))
    Site2 --- Site3((Site 3))
    Site3 --- Site4((Site 4))
    Site4 --- Site1
    style Site1 fill:#22D3EE,color:#000
    style Site2 fill:#22D3EE,color:#000
    style Site3 fill:#22D3EE,color:#000
    style Site4 fill:#22D3EE,color:#000"""

    try:
        message = await anthropic.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=500,
            system=system_prompt,
            messages=[{
                "role": "user",
                "content": f"Generate a Mermaid diagram for this network solution:\n\n{req.solution}",
            }],
        )
        mermaid_code = message.content[0].text.strip()
        mermaid_code = mermaid_code.replace("```mermaid", "").replace("```", "").strip()
        logger.info("diagram generated service=%s chars=%d", req.service_id, len(mermaid_code))
        return {"diagram": mermaid_code}
    except Exception as e:
        logger.error("Diagram error: %s", e)
        return {"diagram": None}
