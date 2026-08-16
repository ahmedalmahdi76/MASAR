# MASAR — AI Network Planner مسار

**MASAR** (مسار) is a voice-driven AI assistant for telecom network planning, built as an ECE graduation project at MTI University. Engineers speak in Egyptian Arabic and receive structured, professional network planning solutions in real time.


---

## How It Works

The system processes voice input through a 5-layer pipeline:

```
Microphone (PCM audio)
    │
    ▼  Layer 1+2 — WebSocket
Deepgram STT  →  Live Arabic transcript
    │
    ▼  Layer 3 — SSE stream
Gemini 2.5 Flash  →  Refined professional English request
    │
    ▼  Layer 4 — SSE stream
Claude Haiku (Anthropic)  →  Full network planning solution
    │
    ▼  Layer 5 — HTTP
ElevenLabs TTS  →  Audio playback (multilingual)
```

---

## Features

- **Real-time Arabic STT** — Deepgram Nova-3 model with interim results
- **Egyptian Arabic NLU** — Gemini refines dialect speech into precise IEEE/3GPP-standard English
- **AI Planning Core** — Claude Haiku generates complete network solutions (topology, equipment, capacity budgets, standards references)
- **Tech Level Toggle** — Beginner / Professional / Expert adjusts response depth and terminology
- **Bilingual Output** — Switch between Arabic and English responses
- **Voice Playback** — ElevenLabs eleven_multilingual_v2 reads the solution aloud
- **General Mode** — Open-ended assistant (not limited to telecom)
- **Streaming UI** — All AI responses stream token-by-token in real time

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI (Python) |
| STT | Deepgram Nova-3 |
| Refinement | Google Gemini 2.5 Flash |
| AI Reasoning | Anthropic Claude Haiku |
| TTS | ElevenLabs eleven_multilingual_v2 |
| Frontend | React 19 + Vite |
| State | Zustand |
| Styling | Tailwind CSS |
| Routing | React Router v7 |

---

## Project Structure

```
Graduation_Project/
├── backend.py              # FastAPI server — all 5 pipeline layers
├── requirements.txt        # Python dependencies
├── .env                    # API keys (not committed)
└── voice-planner-ui/       # React frontend
    ├── src/
    │   ├── pages/          # LandingPage, AuthPage, ServiceSelect, Workspace, SessionSummary
    │   ├── components/     # MicButton, Waveform, TranscriptPanel, Sidebar, TechLevelPicker
    │   ├── hooks/          # useAudioStream, useWebSocket, useTTS, useSession
    │   └── store/          # Zustand stores (audio, auth, session, ui)
    └── public/
        └── audio-processor.js  # AudioWorklet for PCM capture
```

---

## Setup

### Prerequisites

- Python 3.10+
- Node.js 18+
- API keys for: Deepgram, Google Gemini, Anthropic, ElevenLabs

### Backend

```bash
# Create and activate a virtual environment
python -m venv grad_env
grad_env\Scripts\activate        # Windows
# source grad_env/bin/activate   # macOS/Linux

# Install dependencies
pip install fastapi uvicorn python-dotenv deepgram-sdk google-genai anthropic elevenlabs

# Create .env file and fill in your API keys
# Run the server
uvicorn backend:app --reload --port 8000
```

### Frontend

```bash
cd voice-planner-ui
npm install
npm run dev
```

The UI runs at `http://localhost:5173` and connects to the backend at `http://localhost:8000`.

---

## Environment Variables

Create a `.env` file in the project root:

```env
DEEPGRAM_API_KEY=your_deepgram_key
GEMINI_API_KEY=your_gemini_key
ANTHROPIC_API_KEY=your_anthropic_key
ELEVENLABS_API_KEY=your_elevenlabs_key
ELEVENLABS_VOICE_ID=EXAVITQu4vr4xnSDxMaL   # optional, defaults to Sarah
```

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `WS` | `/ws/audio?sample_rate=16000` | Stream PCM audio → live transcript |
| `POST` | `/refine` | Arabic transcript → refined English (SSE) |
| `POST` | `/solve` | Refined prompt → network solution (SSE) |
| `POST` | `/tts` | Solution text → MP3 audio |

---

## Team

ECE Graduation Project — MTI University, 2026
Made by: 
Eng. Ahmed Mohamed Almahdi.
Eng.Saleh Khodier.
Eng.Yassin Mounir.
