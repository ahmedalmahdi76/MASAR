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
from num2words import num2words as _num2words
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
_tts_semaphore = asyncio.Semaphore(2)

# ── System prompts ────────────────────────────────────────────────────────────

REFINEMENT_SYSTEM_PROMPT = """You are the Refinement Layer of Masar (مسار), a graduation project built at MTI University, Faculty of Engineering, Electronics and Communications Department. Masar is an AI-powered voice network planning assistant for network and communications engineers — its purpose is to help ECE engineers plan and design telecommunications networks by speaking in Egyptian Arabic dialect and receiving professional network planning solutions.

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
    req.service_id = _remap_service(req.service_id)
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

_SERVICE_REMAP = {
    'topology':   'infrastructure',
    'monitoring':  'infrastructure',
    'security':    'infrastructure',
    'redundancy':  'infrastructure',
}

def _remap_service(sid: str) -> str:
    return _SERVICE_REMAP.get(sid, sid)

_IDENTITY = """
إنت "مسار" (MASAR) — مساعد ذكي لمهندسي الشبكات والاتصالات. اتبنيت كمشروع تخرج على إيد طلبة قسم الإلكترونيات والاتصالات في كلية الهندسة جامعة MTI.

دورك: تساعد المهندس في تخطيط وتصميم وحل مشاكل وفهم شبكات الاتصالات عبر 8 مجالات: الاتصالات المتنقلة، الهوائيات والـ RF، الألياف الضوئية، عنونة الـ IP، تخطيط السعة، جودة الخدمة QoS، البنية التحتية للشبكات، والمرشد العام.

إنت بتعرف الأدوات والبرامج اللي المهندسين بيستخدموها فعلياً زي Packet Tracer وGNS3 وWireshark وCisco IOS وأوامرها — لو المستخدم سأل عن أي أداة أو مفهوم في مجال الشبكات والاتصالات، اشرحهوله.

قدراتك الإضافية: تقدر تولّد مخططات شبكية (زرار في الركن السفلي اليمين) وجداول حسابات قابلة للتنزيل PDF أو CSV (زرار في الركن السفلي الشمال)."""

_SCOPE = """
نطاق التعامل:
- لو السؤال في مجال تخصصك الأساسي، جاوب كامل وبعمق.
- لو السؤال في الشبكات أو الاتصالات بس برا تخصصك الأساسي (مثلاً سؤال عن Packet Tracer وإنت في خدمة الألياف)، جاوب باختصار مفيد، وبعدها نوّه بلطف إن فيه خدمة أنسب للموضوع ده لو حب يفتحها — من غير ما تحوله أوتوماتيك ومن غير ما ترفض الإجابة.
- ما ترفضش أي سؤال في مجال الشبكات والاتصالات. الرفض بس للأسئلة اللي خارج المجال تماماً (زي الطبخ أو السياسة) — وساعتها رد بأدب إنك مساعد شبكات واتصالات بس.
- لو في شك، اجب."""

_STYLE = """
قواعد الرد (إلزامية — بدون أي استثناء):

ممنوع منعاً باتاً أي تنسيق نصي: لا عناوين بـ # أو ## أو ###، لا نجوم ** أو * للتعريض أو التمييز، لا شرطات - أو نقط للقوائم، لا ترقيم بنقطة (1. أو 2.)، لا جداول، لا أكواد بـ backticks. ردك ده هيتقري بصوت عالي من محرك TTS — أي رمز تنسيق هيتنطق حرفياً ويخرب الصوت. الفواصل والنقاط بس هي المسموح بيها للوقفات.

طول الإجابة (قاعدة أساسية):
الافتراضي إن ردك يكون متوسط ومركّز — مفيد من غير ما يكون حيطة كلام. ده مساعد صوتي، والكلام الطويل بيتعب اللي بيسمع.
أي سؤال مفاهيمي أو تعريفي أو عام (زي "يعني إيه كذا"، "إيه الفرق بين كذا وكذا"، "عرّف نفسك"، "إيه هو كذا"): رد قصير ومركّز، من جملتين لأربع جمل بحد أقصى. جاوب جوهر السؤال وبس، وما تسردش كل اللي تعرفه. ممنوع الردود الطويلة على الأسئلة دي نهائياً.
بس أسئلة التصميم والحسابات الفعلية (زي "صمملي شبكة" أو "احسبلي link budget"): دي بس اللي ياخدوا رد كامل مفصّل بالأرقام والمواصفات. اديهم حقهم.
القاعدة: ما تطوّلش إلا لو السؤال تصميم أو حسابات فعلية. أي حاجة تانية = رد متوسط أو قصير. لو لقيت نفسك بتسرد قائمة طويلة من قدراتك أو المعلومات، إنت بتطوّل غلط — قصّر.

لو عايز تنظم إجابة طويلة (في أسئلة التصميم بس)، استخدم كلام مصري طبيعي زي "أول حاجة" و"بعد كده" و"تاني نقطة" و"وأخيراً" — مش عناوين ولا bullets. لو بتعدد خطوات، قولها في جمل متصلة زي "الخطوة الأولى إنك تعمل كذا، بعدها تعمل كذا" مش بشرطة في أول السطر.

اتكلم بالعامية المصرية دايمًا — ممنوع الفصحى أو أي لغة تانية تحت أي ظرف، حتى لو المستخدم اتكلم بالفصحى أو بالإنجليزي (المصطلحات التقنية زي IEEE وOSPF وDWDM تفضل بالإنجليزي).
فضّل الأرقام على الوصف العام في أسئلة التصميم (مثال: "23 GHz، 28 dBm Tx" مش "تردد مناسب").
ابدأ بالمفيد على طول من غير حشو.
استخدم كلمات عامية مصرية بسيطة وواضحة النطق قدر الإمكان. تجنب الكلمات النادرة أو الصعبة النطق في العامية حتى لو كانت فصحى صح. الكلام لازم يبقى سهل الاستماع وطبيعي للأذن المصرية.

تعديل المستوى التقني (ده بيغيّر عمق المصطلحات مش طول الإجابة):
Beginner: مصطلحات مبسطة ومشروحة، أمثلة عملية.
Professional: مصطلحات هندسية كاملة وإشارة للمعايير.
Expert: مصطلحات كثيفة وإشارة لإصدارات المعايير، مع افتراض خبرة كاملة.
في كل المستويات، طول الإجابة بيتحدد بصعوبة السؤال مش بالمستوى — المستوى بيغيّر صعوبة اللغة، مش عدد الجمل."""

_CAP_DIAGRAM = """
قدرة إضافية — المخطط الشبكي: لو الحل بيتضمن تصميم شبكة أو topology أو مسار، المستخدم يقدر يضغط على زرار "المخطط الشبكي" اللي بيظهر في الركن السفلي اليمين عشان يشوف رسم بياني للتصميم. نوه ليه باختصار وبشكل طبيعي في آخر ردك لو الحل فعلاً يستاهل مخطط — ومتذكرهوش لو مش مناسب."""

_CAP_CALC = """
قدرة إضافية — جدول الحسابات: لو الحل فيه حسابات أو أرقام هندسية، المستخدم يقدر يضغط على زرار "جدول الحسابات" اللي بيظهر في الركن السفلي الشمال عشان يشوف جدول بالحسابات وينزله PDF أو CSV. نوه ليه باختصار وبشكل طبيعي في آخر ردك لو الحل فعلاً فيه أرقام — ومتذكرهوش لو مش مناسب."""

SERVICE_PROMPTS = {
    "mobile": f"""{_IDENTITY}
تخصصك الأساسي الاتصالات المتنقلة — تخطيط شبكات 4G LTE و5G NR، تصميم الـ RAN وحسابات تغطية وسعة الخلايا، الـ handover والـ network slicing، الشبكة الأساسية EPC و5GC، معايير 3GPP. ابدأ من المنظور ده.
{_SCOPE}
{_STYLE}
{_CAP_DIAGRAM}
{_CAP_CALC}""",

    "antenna_rf": f"""{_IDENTITY}
تخصصك الأساسي الهوائيات وهندسة الـ RF — أنواع الهوائيات وتصميمها، الـ gain وpatterns الإشعاع، MIMO وbeamforming، نماذج الانتشار زي Friis وOkumura-Hata وCOST-231، تصميم وصلات RF والميكروويف، fade margin وEIRP وتخطيط الترددات. ابدأ من المنظور ده.
{_SCOPE}
{_STYLE}
{_CAP_DIAGRAM}
{_CAP_CALC}""",

    "fiber": f"""{_IDENTITY}
تخصصك الأساسي تصميم شبكات الألياف الضوئية — مسارات backbone، حسابات OSNR وميزانية الخسارة، أنواع الألياف SMF/MMF/G.652/G.655، تخطيط OTN وDWDM، معايير ITU-T G-series. ابدأ من المنظور ده.
{_SCOPE}
{_STYLE}
{_CAP_DIAGRAM}
{_CAP_CALC}""",

    "ip": f"""{_IDENTITY}
تخصصك الأساسي تخطيط عناوين IP وتقسيم الشبكات — VLSM، CIDR، IPv4/IPv6، subnet masks، RFC 1918، DHCP، VLANs، بروتوكولات التوجيه OSPF/BGP/EIGRP، وحسابات الـ subnets والـ hosts. ابدأ من المنظور ده.
{_SCOPE}
{_STYLE}
{_CAP_DIAGRAM}
{_CAP_CALC}""",

    "capacity": f"""{_IDENTITY}
تخصصك الأساسي تخطيط السعة الشبكية — تقدير النطاق الترددي، توقع نمو الحركة، حسابات الإنتاجية، استخدام الروابط، تخطيط الترقية، نماذج حركة Erlang، ITU-T E.501. ابدأ من المنظور ده.
{_SCOPE}
{_STYLE}
{_CAP_DIAGRAM}
{_CAP_CALC}""",

    "qos": f"""{_IDENTITY}
تخصصك الأساسي تصميم جودة الخدمة QoS — تشكيل الحركة، وسم DSCP (RFC 2474)، قوائم الأولوية (PQ/WFQ/CBWFQ)، سياسات QoS، ضمانات النطاق الترددي، تحسين الكمون والـ jitter، CoS IEEE 802.1p. ابدأ من المنظور ده.
{_SCOPE}
{_STYLE}
{_CAP_DIAGRAM}
{_CAP_CALC}""",

    "infrastructure": f"""{_IDENTITY}
تخصصك الأساسي البنية التحتية للشبكات — ده مجال واسع بيغطي أربع محاور أساسية. أول حاجة تصميم التوبولوجيا: شبكات ring وmesh وstar وhybrid، واختيار المعدات والمسارات. تاني حاجة التكرار وعالي التوافر: مسارات failover، STP/RSTP، VRRP/HSRP، LACP، وتصميم HA بنسبة 99.999%. تالت حاجة المراقبة: SNMP v2c/v3، NetFlow/IPFIX، Syslog، أدوات المراقبة زي Zabbix وPRTG وNagios. ورابع حاجة الأمن: تصميم firewalls، DMZ، VPN بين المواقع، ACLs، وتقييم الثغرات. أول ما تسمع المهندس حدد أي محور من دول بيتكلم عنه وغوص فيه. ركّز على المحور اللي المهندس سأل عنه بس، ومتسردش باقي المحاور إلا لو طلب. لو وصف تصميم فيه ثغرة أمنية واضحة، نبهه فوراً.
{_SCOPE}
{_STYLE}
{_CAP_DIAGRAM}
{_CAP_CALC}""",

    "general": f"""{_IDENTITY}
إنت في وضع المرشد العام — دورك تساعد المهندس اللي مش عارف يبدأ منين. اسأله عن المشكلة أو المشروع اللي شغال عليه، وبناءً على إجابته وجّهه للمجال المناسب من المجالات الثمانية: الاتصالات المتنقلة، الهوائيات والـ RF، الألياف الضوئية، عنونة الـ IP، تخطيط السعة، جودة الخدمة، البنية التحتية، أو اسأل أكتر لو محتاج توضيح. لو سأل سؤال تقني مباشر، جاوبه باختصار وبعدها قوله إن فيه خدمة متخصصة هتفيده أكتر.
{_SCOPE}
{_STYLE}""",
}


class SolveRequest(BaseModel):
    refined_prompt: str
    tech_level: str = "Professional"  # Beginner | Professional | Expert
    service_id: str = "fiber"         # general → open-ended assistant
    response_language: str = "arabic" # arabic | english — Priority 5 toggle
    history: list[dict] = []          # [{user: str, assistant: str}, ...] last N turns
    file_data: str = ""               # base64-encoded file bytes (optional)
    file_type: str = ""               # "image" | "pdf"
    file_mime: str = ""               # e.g. "image/png", "application/pdf"
    original_text: str = ""           # Arabic transcript for intro detection


_INTRO_TRIGGERS = [
    'عرف نفسك', 'عرّف نفسك', 'قدم نفسك', 'قدّم نفسك', 'اقدم نفسك',
    'انت مين', 'إنت مين', 'مين انت', 'مين إنت',
    'اتكلم عن نفسك', 'كلمنا عن نفسك',
    'introduce yourself', 'who are you', 'tell us about yourself',
    'tell me about yourself', 'what are you', 'describe yourself',
    'self introduction', 'about masar', 'what is masar',
]

_INTRO_TEXT = (
    'أهلاً بحضراتكم، شرف كبير ليا وجودي معاكم . '
    'أنا مسار، وكيل ذكاء اصطناعي صوتي تم تطويري بالكامل على إيد مهندسين '
    'قسم الإلكترونيات والاتصالات في جامعة MTI. '
    'أنا بشتغل في الوقت الفعلي، '
    'وبفهم المصطلحات الهندسية الممزوجة بالعامية المصرية. '
    'وظيفتي أشتغل كمساعد ذكي لمهندس الاتصالات في الموقع، '
    'وبقدّم حلول وتصميمات فورية مبنية ومطابقة لمعايير الـ ITU-T والـ 3GPP والـ IEEE.'
    'وأخيراً، أتمنى لحضراتكم مناقشة موفقة، وأنا تحت أمركم لو حابين تجربوا أي حاجة.'
)


def _is_intro_request(text: str) -> bool:
    lower = text.lower().strip()
    return any(t in lower for t in _INTRO_TRIGGERS)


@app.post("/solve")
async def solve(req: SolveRequest) -> StreamingResponse:
    """
    Layer 4: Refined English prompt → Claude Haiku → streamed network solution via SSE.

    SSE format:  data: <json-encoded token>\\n\\n
                 data: [DONE]\\n\\n
    """
    req.service_id = _remap_service(req.service_id)
    # Fixed intro — bypass LLM entirely (general service only)
    is_general  = req.service_id == "general"
    intro_match = _is_intro_request(req.refined_prompt) or _is_intro_request(req.original_text)
    if is_general and intro_match:
        logger.info("SOLVE: intro request detected, returning fixed text")
        async def intro_stream():
            sentences = re.split(r'(?<=[.؟!])\s*', _INTRO_TEXT.strip())
            for s in sentences:
                s = s.strip()
                if s:
                    yield f"data: {json.dumps(s + ' ')}\n\n"
                    await asyncio.sleep(0.4)
            yield "data: [DONE]\n\n"
        return StreamingResponse(
            intro_stream(), media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    planning_prompt = SERVICE_PROMPTS.get(req.service_id, SERVICE_PROMPTS["general"])
    full_prompt     = f"Tech level: {req.tech_level}\n\nRequest:\n{req.refined_prompt}"

    history = req.history[-6:]
    messages = []
    for turn in history:
        messages.append({"role": "user",      "content": turn["user"]})
        messages.append({"role": "assistant", "content": turn["assistant"]})

    # Build last user message — include file attachment if provided
    if req.file_data:
        if req.file_type == "image":
            file_block = {
                "type": "image",
                "source": {"type": "base64", "media_type": req.file_mime, "data": req.file_data},
            }
        else:  # pdf
            file_block = {
                "type": "document",
                "source": {"type": "base64", "media_type": "application/pdf", "data": req.file_data},
            }
        last_content = [file_block, {"type": "text", "text": full_prompt}]
        logger.info("solve with file attachment type=%s mime=%s", req.file_type, req.file_mime)
    else:
        last_content = full_prompt

    messages.append({"role": "user", "content": last_content})

    # Use a vision-capable model when a file is attached
    if req.file_data:
        logger.info("File received type=%s mime=%s size=%d chars",
                    req.file_type, req.file_mime, len(req.file_data))
    _model = "claude-sonnet-4-6" if req.file_data else "claude-haiku-4-5-20251001"
    logger.info("SOLVE model=%s has_file=%s", _model, bool(req.file_data))

    async def event_stream():
        _max_tokens = {'Beginner': 768, 'Professional': 1024, 'Expert': 2048}.get(req.tech_level, 1024)
        try:
            async with anthropic.messages.stream(
                model=_model,
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

_DIGIT_MAP = {
    '0': 'صفر', '1': 'واحد', '2': 'اتنين', '3': 'تلاتة',
    '4': 'أربعة', '5': 'خمسة', '6': 'ستة', '7': 'سبعة',
    '8': 'تمنية', '9': 'تسعة',
}

_UNIT_MAP = [
    (r'\bTbps\b', 'تيرا بيت بير سكند'),
    (r'\bGbps\b', 'جيجا بيت بير سكند'),
    (r'\bMbps\b', 'ميجا بيت بير سكند'),
    (r'\bKbps\b', 'كيلو بيت بير سكند'),
    (r'\bdBm\b', 'ديسيبل ميلي واط'),
    (r'\bdB\b', 'ديسيبل'),
    (r'\bGHz\b', 'جيجا هرتز'),
    (r'\bMHz\b', 'ميجا هرتز'),
    (r'\bKHz\b', 'كيلو هرتز'),
    (r'\bHz\b', 'هرتز'),
    (r'\bGB\b', 'جيجا بايت'),
    (r'\bMB\b', 'ميجا بايت'),
    (r'\bKB\b', 'كيلو بايت'),
    (r'\bms\b', 'ميلي ثانية'),
    (r'\bميجابايت\b', 'ميجا بايت'),
    (r'\bميجابت\b', 'ميجا بيت'),
    (r'\bجيجابايت\b', 'جيجا بايت'),
    (r'\bجيجابت\b', 'جيجا بيت'),
]


def _spell_digits(num_str):
    return ' '.join(_DIGIT_MAP[d] for d in num_str if d in _DIGIT_MAP)


def make_tts_friendly(text: str) -> str:
    """Convert IPs, MACs, numbers, and math symbols into spoken Arabic for TTS."""
    placeholders = {}
    _counter = [0]

    def _ph(prefix, spoken):
        key = f'\x00{prefix}{_counter[0]}\x00'
        _counter[0] += 1
        placeholders[key] = spoken
        return key

    # STEP 0 — Protect standard references (G.652, 802.1Q, RFC 1918)
    text = re.sub(r'[A-Za-z]\.\d+\w*', lambda m: _ph('STD', m.group(0)), text)
    text = re.sub(r'\b802\.\d+\w*', lambda m: _ph('STD', m.group(0)), text)
    text = re.sub(r'\b\d+\.\d+[A-Za-z]\w*', lambda m: _ph('STD', m.group(0)), text)
    text = re.sub(r'\bRFC\s*\d+', lambda m: _ph('STD', m.group(0)), text)

    # STEP 1 — IP addresses (digit-by-digit spelling → placeholder)
    def _ip_replace(m):
        ip = m.group(0)
        if '/' in ip:
            addr, cidr = ip.split('/')
            spoken = ' دوت '.join(_spell_digits(o) for o in addr.split('.'))
            return _ph('IP', spoken + ' سلاش ' + _spell_digits(cidr))
        return _ph('IP', ' دوت '.join(_spell_digits(o) for o in ip.split('.')))

    text = re.sub(
        r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(/\d{1,2})?\b',
        _ip_replace, text)

    # STEP 2 — MAC addresses → placeholder
    text = re.sub(
        r'\b([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}\b',
        lambda m: _ph('MAC', m.group(0).replace(':', ' ')), text)

    # STEP 2.5 — Unit abbreviations → spoken Arabic
    for pattern, spoken in _UNIT_MAP:
        text = re.sub(pattern, spoken, text, flags=re.IGNORECASE)

    # STEP 3 — Context-sensitive math operators (must run while digits exist)
    text = re.sub(r'(?<=\d)\s*/\s*(?=\d)', ' على ', text)
    text = re.sub(r'(?<=\d)\s*-\s*(?=\d)', ' ناقص ', text)

    # STEP 4 — Decimal numbers → Arabic words + digit-spelled fraction
    def _decimal_replace(m):
        try:
            int_part, dec_part = m.group(0).split('.')
            int_word = _num2words(int(int_part), lang='ar')
            return int_word + ' فاصلة ' + _spell_digits(dec_part)
        except Exception:
            return m.group(0)

    text = re.sub(r'\b\d+\.\d+\b', _decimal_replace, text)

    # STEP 5 — Whole numbers → Arabic words
    def _int_replace(m):
        try:
            return _num2words(int(m.group(0)), lang='ar')
        except Exception:
            return m.group(0)

    text = re.sub(r'\b\d+\b', _int_replace, text)

    # STEP 6 — Simple symbol replacements
    text = text.replace('×', ' في ')
    text = text.replace('÷', ' على ')
    text = text.replace('±', ' زائد أو ناقص ')
    text = text.replace('≈', ' تقريباً يساوي ')
    text = text.replace('+', ' زائد ')
    text = text.replace('=', ' يساوي ')
    text = text.replace('%', ' بالمية ')
    text = text.replace('>', ' أكبر من ')
    text = text.replace('<', ' أصغر من ')

    # STEP 7 — Restore all placeholders
    for key, spoken in placeholders.items():
        text = text.replace(key, spoken)

    return text


def clean_for_tts(text: str) -> str:
    """Strip markdown artifacts that ElevenLabs would speak aloud."""
    text = re.sub(r'[*_#`~]', '', text)
    text = re.sub(r'\n+', ' ', text)
    text = re.sub(r'\s{2,}', ' ', text)
    text = make_tts_friendly(text)
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
        async with _tts_semaphore:
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


@app.post("/tts-sentence")
async def tts_sentence(req: TTSRequest) -> Response:
    """
    Layer 5 variant: synthesize a single sentence for streaming TTS.
    Input is already one sentence — no chunking needed.
    Returns raw audio/mpeg bytes, same format as /tts.
    """
    if not elevenlabs_client:
        return Response(content=b"", status_code=503,
                        headers={"X-TTS-Error": "ELEVENLABS_API_KEY not configured"})

    voice        = req.voice_id or DEFAULT_VOICE_ID or "UR972wNGq3zluze0LoIp"
    loop         = asyncio.get_event_loop()
    cleaned_text = clean_for_tts(req.text)
    if not cleaned_text:
        logger.warning("[TTS-SENTENCE] empty text after cleaning, skipping")
        return Response(content=b"", status_code=204)
    logger.info("TTS-sentence voice=%s chars=%d", voice, len(cleaned_text))
    logger.info("[TTS-OUT] %s", cleaned_text)

    def _synthesize() -> bytes:
        chunks = elevenlabs_client.text_to_speech.convert(
            voice_id=voice,
            text=cleaned_text,
            model_id="eleven_multilingual_v2",
            output_format="mp3_44100_128",
        )
        return b"".join(chunks)

    for attempt in range(2):
        try:
            async with _tts_semaphore:
                audio_bytes = await loop.run_in_executor(None, _synthesize)
            return Response(content=audio_bytes, media_type="audio/mpeg",
                            headers={"Cache-Control": "no-store"})
        except Exception as e:
            err_str = str(e)
            is_rate = "429" in err_str or "concurrent" in err_str.lower()
            if is_rate and attempt == 0:
                logger.warning("[TTS-SENTENCE] rate limited, retrying in 2s")
                await asyncio.sleep(2)
                continue
            logger.error("[TTS-SENTENCE] failed: %s", repr(e))
            return Response(content=b"", status_code=502,
                            headers={"X-TTS-Error": err_str})


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
    """Generate a short English session title (3-5 words, Title Case) using Claude Haiku."""
    req.service_id = _remap_service(req.service_id)
    for attempt in range(2):
        try:
            message = await anthropic.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=30,
                messages=[{
                    "role": "user",
                    "content": (
                        f"Generate a short English title (3-5 words, Title Case) that describes this network engineering question. "
                        f"Return ONLY the title — no quotes, no explanation, no period.\n"
                        f"Examples: VLSM Subnet Planning, Fiber Link Budget, Voice QoS Design, SNMP Monitoring Setup\n"
                        f"Question: {req.first_question}"
                    ),
                }],
            )
            title = message.content[0].text.strip().strip('"').strip("'")
            logger.info("session-title generated: %r", title)
            return {"title": title}
        except Exception as e:
            logger.warning("session-title attempt %d failed: %s", attempt + 1, e)
            if attempt == 0:
                await asyncio.sleep(3)
    logger.error("session-title all attempts failed, falling back to service_id")
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
        valid_starts = [
            'graph ', 'flowchart ', 'sequenceDiagram', 'classDiagram',
            'erDiagram', 'gantt', 'pie', 'gitGraph', 'mindmap',
        ]
        if not any(mermaid_code.startswith(s) for s in valid_starts):
            logger.warning("Invalid Mermaid syntax returned: %s", mermaid_code[:100])
            return {"diagram": None}
        logger.info("diagram generated service=%s chars=%d", req.service_id, len(mermaid_code))
        return {"diagram": mermaid_code}
    except Exception as e:
        logger.error("Diagram error: %s", e)
        return {"diagram": None}


# ── Engineering Calculation Sheet ────────────────────────────────────────────

class CalculateRequest(BaseModel):
    solution: str
    service_id: str
    tech_level: str = "Professional"


@app.post("/calculate")
async def calculate(req: CalculateRequest):
    """Extract engineering calculations from a solution into structured JSON."""
    system_prompt = """CRITICAL: Return ONLY a raw JSON object. No markdown fences, no explanation text, no preamble. Start your response with { and end with }. Nothing before or after.

You are an engineering calculation engine for MASAR network planning assistant. Extract all numerical values and engineering parameters from the solution text and organize them into a structured calculation sheet.

Return ONLY a valid JSON object with this exact structure:
{
  "title": "string — sheet title in English",
  "service": "string — service domain",
  "sections": [
    {
      "name": "string — section name",
      "calculations": [
        {
          "parameter": "string — parameter name",
          "symbol": "string — engineering symbol (optional, empty string if none)",
          "value": "number or string — the extracted value",
          "unit": "string — unit of measurement",
          "formula": "string — formula used (optional, empty string if none)",
          "standard": "string — IEEE/ITU reference (optional, empty string if none)"
        }
      ]
    }
  ],
  "summary": "string — brief one-sentence technical summary"
}

Rules:
- Extract ONLY values explicitly mentioned in the solution — do not fabricate values
- Group related calculations into logical sections (e.g. Link Budget, Traffic Analysis)
- Include units for every numeric value
- Reference applicable standards (IEEE 802.x, ITU-T G.xxx, etc.) where relevant
- Return valid JSON only — no markdown fences, no explanation, no preamble"""

    last_error = None
    for attempt in range(3):
        try:
            message = await anthropic.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=2000,
                system=system_prompt,
                messages=[{
                    "role": "user",
                    "content": (
                        f"Extract all engineering calculations from this {req.service_id} "
                        f"network planning solution (tech level: {req.tech_level}):\n\n"
                        f"{req.solution}"
                    ),
                }],
            )
            raw_text = message.content[0].text.strip()
            logger.info("CALC raw response (attempt %d): %s", attempt + 1, raw_text[:500])
            # Aggressively clean any markdown or surrounding text
            raw_text = re.sub(r'```json\s*|\s*```', '', raw_text).strip()
            raw_text = re.sub(r'```\s*|\s*```', '', raw_text).strip()
            # Extract from first { to last } in case there is preamble text
            start = raw_text.find('{')
            end   = raw_text.rfind('}')
            if start != -1 and end != -1:
                raw_text = raw_text[start:end + 1]
            data = json.loads(raw_text)
            logger.info("calculate service=%s sections=%d", req.service_id, len(data.get("sections", [])))
            return data
        except Exception as e:
            last_error = e
            logger.warning("CALC attempt %d failed: %s", attempt + 1, e)

    logger.error("CALC all attempts failed: %s", last_error)
    return {"error": "parse failed"}
