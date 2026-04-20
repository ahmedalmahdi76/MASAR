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
DEFAULT_VOICE_ID  = os.getenv("ELEVENLABS_VOICE_ID", "EXAVITQu4vr4xnSDxMaL")  # Sarah — eleven_multilingual_v2

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

PLANNING_SYSTEM_PROMPT = """You are the AI Reasoning Core of Masar (مسار), an AI network planning assistant for telecom engineers.

Your job: take a professional network engineering requirement and generate a complete, actionable technical solution.

Output rules:
- Return ONLY the technical solution — no preamble, no "Here is...", no repeating the input
- Use IEEE / ITU-T / 3GPP standard terminology
- Be specific: include topology recommendations, equipment types, capacity budgets, redundancy strategies, and relevant standards references
- Structure your response with clear sections where appropriate

Adjust output depth by tech level:
- Beginner: شرح مبسط بدون معادلات، اشرح كل مصطلح تستخدمه
- Professional: مصطلحات هندسية كاملة، أشر للمعايير المعتمدة، اذكر المعادلات الأساسية
- Expert: لغة تقنية كثيفة، أشر لأرقام إصدارات 3GPP، افترض خبرة كاملة، أقصى عمق تقني"""

GENERAL_PLANNING_SYSTEM_PROMPT = """أنت مسار (Masar)، مساعد ذكاء اصطناعي ودود ومعرفي.

يمكنك المساعدة في أي موضوع — هندسة، علوم، رياضيات، تاريخ، ثقافة، كتابة إبداعية، تحليل، أسئلة يومية، أو مجرد حديث عادي.

كن مفيداً حقاً، مدروساً، ومباشراً. تكيّف مع أسلوب المحادثة بشكل طبيعي — عامي عند الحاجة، وتفصيلي عند الطلب. لا قيود على المواضيع."""

LANGUAGE_INSTRUCTION = {
    "arabic":  "IMPORTANT: Respond entirely in Modern Standard Arabic (فصحى). Keep technical acronyms in English (IEEE, 3GPP, MPLS, IP, etc.) but write all explanations, headings, and prose in Arabic.",
    "english": "Respond in English.",
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
    base_prompt     = GENERAL_PLANNING_SYSTEM_PROMPT if req.service_id == "general" else PLANNING_SYSTEM_PROMPT
    lang_instruction = LANGUAGE_INSTRUCTION.get(req.response_language, LANGUAGE_INSTRUCTION["arabic"])
    planning_prompt  = f"{base_prompt}\n\n{lang_instruction}"
    full_prompt      = f"Tech level: {req.tech_level}\n\nRequest:\n{req.refined_prompt}"

    async def event_stream():
        try:
            async with anthropic.messages.stream(
                model="claude-haiku-4-5-20251001",
                max_tokens=2048,
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

    voice = req.voice_id or DEFAULT_VOICE_ID
    loop  = asyncio.get_event_loop()

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
