import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAudioStream } from '../hooks/useAudioStream';
import { useTTS } from '../hooks/useTTS';
import { useTheme } from '../contexts/ThemeContext';
import ThemeToggle from '../components/ThemeToggle';
import { supabase } from '../supabase';
import OnboardingTour from '../components/OnboardingTour';
import DiagramPromptBubble from '../components/DiagramPromptBubble';
import DiagramPanel from '../components/DiagramPanel';
import { exportSessionPDF } from '../utils/generatePDF';

const TOUR_STEPS_WORKSPACE = [
  {
    targetId:    'waveform-canvas',
    title:       'موجة الصوت',
    description: 'الموجة دي بتتحرك مع صوتك وصوت مسار. اللون البرتقالي لما بتتكلم، السماوي لما مسار بيرد.',
    position:    'top',
  },
  {
    targetId:    'start-call-btn',
    title:       'ابدأ المكالمة',
    description: 'اضغط هنا وابدأ تتكلم بالعامية المصرية — مسار هيسمعك ويرد عليك فوراً.',
    position:    'top',
  },
  {
    targetId:    'eye-toggle-btn',
    title:       'عرض النص',
    description: 'اضغط هنا عشان تشوف النص المكتوب لكلامك وإجابة مسار.',
    position:    'bottom',
  },
  {
    targetId:    'replay-btn',
    title:       'إعادة الإجابة',
    description: 'بعد ما مسار يجاوب، اضغط هنا عشان تسمع الإجابة تاني.',
    position:    'top',
  },
  {
    targetId:    'sidebar-btn',
    title:       'الجلسات السابقة',
    description: 'من هنا تقدر تشوف كل محادثاتك السابقة وترجع ليها.',
    position:    'bottom',
  },
];

const VAD_THRESHOLDS = { low: 0.20, medium: 0.10, high: 0.05 };
const VAD_SILENCE_MS = 4000;
const VAD_MIN_SPEECH = 600;

const DIAGRAM_SERVICES = new Set(['topology','fiber','ip','redundancy','security','monitoring','capacity','qos']);
const API_BASE = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000';

const DEFAULT_SERVICE = {
  id: 'fiber',
  label: 'Fiber Optic Routing',
  arabic: 'توجيه الألياف الضوئية',
  accent: '#F59E0B',
  icon: '◈',
};

// Wave colors per state: [r, g, b, alpha 0-1]
const STATE_COLORS = {
  idle:      { w1: [245, 158,  11, 0.12], w2: [124,  58, 237, 0.08] },
  listening: { w1: [245, 158,  11, 1.00], w2: [124,  58, 237, 0.85] },
  thinking:  { w1: [ 34, 211, 238, 1.00], w2: [124,  58, 237, 0.85] },
  speaking:  { w1: [ 34, 211, 238, 1.00], w2: [ 59, 130, 246, 0.85] },
};

function buildDotGrid(W, H) {
  const off = document.createElement('canvas');
  off.width  = W;
  off.height = H;
  const ctx  = off.getContext('2d');
  const spacing = 28;
  ctx.fillStyle = 'rgba(13,148,136,0.10)';
  for (let x = spacing / 2; x < W; x += spacing) {
    for (let y = spacing / 2; y < H; y += spacing) {
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return off;
}

function drawWave(ctx, W, H, baseline, amp, phase, color, wavelength) {
  const [r, g, b, a] = color;
  if (a < 0.005) return;

  const pts = [];
  for (let x = 0; x <= W; x += 3) {
    pts.push([x, baseline + amp * Math.sin((2 * Math.PI * x / wavelength) + phase)]);
  }

  // Glow stroke
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.strokeStyle = `rgba(${r},${g},${b},${a})`;
  ctx.lineWidth   = 2.5;
  ctx.shadowBlur  = 14 + amp * 0.05;
  ctx.shadowColor = `rgba(${r},${g},${b},${Math.min(1, a * 0.65)})`;
  ctx.stroke();
  ctx.shadowBlur  = 0;

  // Area fill (gradient around baseline)
  const grad = ctx.createLinearGradient(0, baseline - amp - 20, 0, baseline + amp + 20);
  grad.addColorStop(0,    `rgba(${r},${g},${b},0)`);
  grad.addColorStop(0.45, `rgba(${r},${g},${b},${Math.min(1, a * 0.16)})`);
  grad.addColorStop(1,    `rgba(${r},${g},${b},0)`);
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.lineTo(W, baseline);
  ctx.lineTo(0, baseline);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Reflection below baseline at 20% alpha
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const ry = baseline + (baseline - y);
    if (i === 0) ctx.moveTo(x, ry); else ctx.lineTo(x, ry);
  });
  ctx.strokeStyle = `rgba(${r},${g},${b},${Math.min(1, a * 0.20)})`;
  ctx.lineWidth   = 1.5;
  ctx.shadowBlur  = 6;
  ctx.shadowColor = `rgba(${r},${g},${b},${Math.min(1, a * 0.08)})`;
  ctx.stroke();
  ctx.shadowBlur  = 0;
}

export default function Workspace() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const service   = location.state?.service ?? DEFAULT_SERVICE;
  const { theme } = useTheme();
  const themeRef  = useRef(theme);
  useEffect(() => { themeRef.current = theme; }, [theme]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showText,    setShowText]    = useState(false);
  const [techLevel]      = useState(() => localStorage.getItem('masar_tech_level') ?? 'Professional');
  const [vadSensitivity] = useState(() => localStorage.getItem('masar_vad')        ?? 'medium');
  const [callActive, setCallActive] = useState(false);
  const [sessions,   setSessions]   = useState(() => {
    try { return JSON.parse(localStorage.getItem('masar_sessions') || '[]'); } catch { return []; }
  });

  // PDF export
  const [pdfLoading,     setPdfLoading]     = useState(false);
  const [sessionSearch,  setSessionSearch]  = useState('');
  const handleExportPDF = async () => {
    setPdfLoading(true);
    try {
      const filledTurns = displayTurns.filter(t => t.text);
      await exportSessionPDF({
        turns: filledTurns,
        masarResponses,
        solutions,
        service,
        techLevel,
        startTime: startTimeRef.current,
        duration: Math.floor((Date.now() - startTimeRef.current) / 1000),
        diagrams,
      });
    } catch (error) {
      console.error('PDF export failed:', error);
      alert('حصل خطأ في تصدير الـ PDF، حاول تاني');
    } finally {
      setPdfLoading(false);
    }
  };

  // Onboarding tour
  const [showTour, setShowTour] = useState(false);
  useEffect(() => {
    const done = localStorage.getItem('masar_tour_workspace');
    if (!done) setTimeout(() => setShowTour(true), 800);
  }, []);
  const completeTour = () => { localStorage.setItem('masar_tour_workspace', 'done'); setShowTour(false); };

  // Supabase session persistence
  const [currentUser,       setCurrentUser]       = useState(undefined);
  const [supabaseSessionId, setSupabaseSessionId] = useState(null);
  const [supabaseSessions,  setSupabaseSessions]  = useState([]);
  const [isLoadedSession,   setIsLoadedSession]   = useState(false);
  const [loadedTurns,       setLoadedTurns]       = useState([]);
  const supabaseSessionIdRef = useRef(null); // mirrors state — safe to read inside effects
  const sessionCreatingRef   = useRef(false); // prevents duplicate session creation race
  const sessionStartTimeRef  = useRef(null);

  const startTimeRef = useRef(Date.now());
  const prevStateRef = useRef('idle');

  const {
    turns, isRecording, audioLevelRef, error,
    startRecording, stopRecording, clearTurns, removeTurn,
  } = useAudioStream();

  const [masarResponses,      setMasarResponses]      = useState({});
  const [streamingIds,        setStreamingIds]        = useState({});
  const [solutions,           setSolutions]           = useState({});
  const [solvingIds,          setSolvingIds]          = useState({});
  const [conversationHistory, setConversationHistory] = useState([]);
  const historyAddedRef = useRef(new Set());

  const [diagrams,            setDiagrams]            = useState({});
  const [diagramLoading,      setDiagramLoading]      = useState({});
  const [showDiagramPrompt,   setShowDiagramPrompt]   = useState(false);
  const [pendingDiagramTurnId, setPendingDiagramTurnId] = useState(null);
  const diagramTriggeredRef = useRef(new Set());
  const promptedRef         = useRef(new Set());

  const {
    ttsStates, play: playTTS, stop: stopTTS,
    isSpeaking: masarSpeaking, audioRef: ttsAudioRef,
  } = useTTS();

  // ── Auto-TTS ───────────────────────────────────────────────────────────────
  const ttsTriggeredRef   = useRef(new Set());
  const lastSpokenRef     = useRef(null);   // text of last solution spoken
  const lastSpokenTurnRef = useRef(null);   // turn ID of last solution spoken
  const [hasLastSpoken, setHasLastSpoken] = useState(false);

  useEffect(() => {
    turns.forEach(t => {
      if (!t.isActive && solutions[t.id] && !solvingIds[t.id] && !ttsTriggeredRef.current.has(t.id)) {
        ttsTriggeredRef.current.add(t.id);
        lastSpokenRef.current     = solutions[t.id];
        lastSpokenTurnRef.current = t.id;
        setHasLastSpoken(true);
        playTTS(t.id, solutions[t.id]);
      }
    });
  }, [turns, solutions, solvingIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── masarState ─────────────────────────────────────────────────────────────
  const isThinking = Object.keys(streamingIds).length > 0 || Object.keys(solvingIds).length > 0;
  const masarState = masarSpeaking ? 'speaking'
    : isRecording                  ? 'listening'
    : isThinking                   ? 'thinking'
    : 'idle';

  // Error guard
  useEffect(() => {
    if (error && callActive && !isRecording) setCallActive(false);
  }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refinement trigger
  useEffect(() => {
    const toRefine = turns.filter(t => !t.isActive && t.text && masarResponses[t.id] === undefined);
    toRefine.forEach(turn => {
      const wordCount = turn.text.trim().split(/\s+/).filter(Boolean).length;
      if (wordCount < 5) { removeTurn(turn.id); return; }
      streamRefine(turn.id, turn.text, techLevel, service.id, setMasarResponses, setStreamingIds);
    });
  }, [turns]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-solve
  useEffect(() => {
    turns.forEach(t => {
      if (!t.isActive && masarResponses[t.id] && !streamingIds[t.id] && solutions[t.id] === undefined) {
        streamSolve(t.id, masarResponses[t.id], techLevel, service.id, setSolutions, setSolvingIds, conversationHistory);
      }
    });
  }, [masarResponses, streamingIds, turns]); // eslint-disable-line react-hooks/exhaustive-deps

  // History tracking — fires once per turn after both refine and solve finish
  useEffect(() => {
    turns.forEach(t => {
      if (
        !t.isActive &&
        masarResponses[t.id] && !streamingIds[t.id] &&
        solutions[t.id]      && !solvingIds[t.id]   &&
        !historyAddedRef.current.has(t.id)
      ) {
        historyAddedRef.current.add(t.id);
        setConversationHistory(prev => [...prev, {
          user:      masarResponses[t.id],
          assistant: solutions[t.id],
        }]);
        // Persist to Supabase — lazy session creation on first real turn
        (async () => {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return;

          if (!supabaseSessionIdRef.current) {
            if (sessionCreatingRef.current) return;
            sessionCreatingRef.current = true;
            const { data: sessionData, error: sessionError } = await supabase
              .from('sessions')
              .insert({
                user_id:    user.id,
                service_id: service.id,
                tech_level: techLevel,
                started_at: new Date().toISOString(),
              })
              .select()
              .single();
            if (sessionError || !sessionData) return;
            supabaseSessionIdRef.current = sessionData.id;
            setSupabaseSessionId(sessionData.id);

            // Generate Arabic title from first question
            try {
              const res = await fetch(
                `${import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000'}/session-title`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    first_question: masarResponses[t.id],
                    service_id:     service.id,
                  }),
                }
              );
              const { title } = await res.json();
              await supabase.from('sessions')
                .update({ title })
                .eq('id', supabaseSessionIdRef.current);
            } catch (e) {
              console.warn('[session-title] failed:', e.message);
            }
          }

          const { error } = await supabase.from('turns').insert({
            session_id:        supabaseSessionIdRef.current,
            arabic_transcript: t.text,
            refined_prompt:    masarResponses[t.id],
            solution:          solutions[t.id],
          });
          if (error) console.warn('[Supabase] turn insert failed:', error.message);
        })();
      }
    });
  }, [turns, masarResponses, streamingIds, solutions, solvingIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Diagram prompt — show bubble 1s after solution completes for technical services
  useEffect(() => {
    turns.forEach(t => {
      if (
        !t.isActive &&
        solutions[t.id] && !solvingIds[t.id] &&
        DIAGRAM_SERVICES.has(service.id) &&
        !promptedRef.current.has(t.id) &&
        !diagramTriggeredRef.current.has(t.id)
      ) {
        promptedRef.current.add(t.id);
        setTimeout(() => {
          setPendingDiagramTurnId(t.id);
          setShowDiagramPrompt(true);
        }, 1000);
      }
    });
  }, [turns, solutions, solvingIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // VAD loop
  useEffect(() => {
    if (!callActive || !isRecording) return;
    const THRESHOLD = VAD_THRESHOLDS[vadSensitivity];
    let speechStart = null, silenceStart = null, lastLogTime = 0, rafId;
    const tick = () => {
      const level = audioLevelRef.current, now = Date.now();
      if (now - lastLogTime >= 500) {
        console.log(`[VAD] level=${level.toFixed(4)} threshold=${THRESHOLD}`);
        lastLogTime = now;
      }
      if (level > THRESHOLD) {
        if (!speechStart) speechStart = now;
        silenceStart = null;
      } else {
        if (!silenceStart) silenceStart = now;
        const sd = speechStart ? (silenceStart - speechStart) : 0;
        if (sd >= VAD_MIN_SPEECH && (now - silenceStart) >= VAD_SILENCE_MS) {
          stopRecording(); return;
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [callActive, isRecording, vadSensitivity]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-restart mic
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = masarState;
    if (!callActive) return;
    if (prev !== 'idle' && masarState === 'idle') startRecording();
  }, [masarState, callActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Barge-in — independent mic monitor, active only while MASAR is speaking
  useEffect(() => {
    return; // barge-in disabled - mic conflict
  }, [callActive, masarState]);

  // Unmount cleanup — release mic, TTS, and call state
  useEffect(() => {
    return () => {
      stopRecording();
      stopTTS();
      setCallActive(false);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Supabase session persistence ───────────────────────────────────────────
  const fetchSessions = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('sessions')
        .select('*, turns(*)')
        .eq('user_id', user.id)
        .order('started_at', { ascending: false });
      setSupabaseSessions(data ?? []);
    } catch (err) {
      console.error('[fetchSessions] failed:', err);
    }
  };

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user ?? null);
      if (user) fetchSessions();
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isGuest = currentUser === null && !!localStorage.getItem('masar_guest');

  // ── Canvas refs ────────────────────────────────────────────────────────────
  const canvasRef        = useRef(null);
  const masarStateRef    = useRef('idle');
  const smoothedAmpRef   = useRef(0);
  const currentColorsRef = useRef({
    w1: [...STATE_COLORS.idle.w1],
    w2: [...STATE_COLORS.idle.w2],
  });
  const dotGridRef = useRef(null);

  // Keep masarState readable inside the rAF closure without stale closures
  useEffect(() => { masarStateRef.current = masarState; }, [masarState]);

  // ── TTS audio level ────────────────────────────────────────────────────────
  const ttsAudioLevelRef = useRef(0);
  const ttsAnalyserRef   = useRef(null);
  const ttsAudioCtxRef   = useRef(null);
  const ttsBufRef        = useRef(null);

  // Trigger when any TTS track transitions to 'playing' (audioRef.current is set by then)
  const anyTtsPlaying = Object.values(ttsStates).some(s => s === 'playing');

  useEffect(() => {
    // Clean up any previous connection
    if (ttsAudioCtxRef.current) {
      ttsAudioCtxRef.current.close().catch(() => {});
      ttsAudioCtxRef.current = null;
    }
    ttsAnalyserRef.current = null;
    ttsBufRef.current      = null;
    ttsAudioLevelRef.current = 0;

    if (anyTtsPlaying && ttsAudioRef?.current) {
      try {
        const ctx     = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.7;
        const source = ctx.createMediaElementSource(ttsAudioRef.current);
        source.connect(analyser);
        analyser.connect(ctx.destination); // audio still plays through speakers
        ttsAudioCtxRef.current = ctx;
        ttsAnalyserRef.current = analyser;
        ttsBufRef.current      = new Uint8Array(analyser.fftSize);
      } catch (e) {
        console.warn('[TTS analyser]', e.message);
      }
    }

    return () => {
      if (ttsAudioCtxRef.current) {
        ttsAudioCtxRef.current.close().catch(() => {});
        ttsAudioCtxRef.current = null;
      }
      ttsAnalyserRef.current   = null;
      ttsBufRef.current        = null;
      ttsAudioLevelRef.current = 0;
    };
  }, [anyTtsPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── ResizeObserver — keep canvas sized to its CSS container ───────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      const dpr = window.devicePixelRatio || 1;
      canvas.width  = Math.round(width  * dpr);
      canvas.height = Math.round(height * dpr);
      dotGridRef.current = buildDotGrid(canvas.width, canvas.height);
    });
    obs.observe(canvas);
    return () => obs.disconnect();
  }, []);

  // ── Main canvas rAF loop ───────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let phase1 = 0, phase2 = 0.5, rafId;
    const lerp = (a, b, t) => a + (b - a) * t;

    const render = () => {
      const W = canvas.width, H = canvas.height, baseline = H / 2;

      // Background — respects theme
      ctx.fillStyle = themeRef.current === 'light' ? '#F0F4F8' : '#010508';
      ctx.fillRect(0, 0, W, H);
      if (dotGridRef.current) ctx.drawImage(dotGridRef.current, 0, 0);

      // ── Amplitude source per state ────────────────────────────────────────
      const state = masarStateRef.current;
      let targetAmp;

      if (state === 'listening') {
        targetAmp = audioLevelRef.current;
      } else if (state === 'thinking') {
        targetAmp = Math.abs(Math.sin(Date.now() / 1000)) * 0.3;
      } else if (state === 'speaking') {
        if (ttsAnalyserRef.current && ttsBufRef.current) {
          ttsAnalyserRef.current.getByteTimeDomainData(ttsBufRef.current);
          let sum = 0;
          for (let i = 0; i < ttsBufRef.current.length; i++) {
            const s = (ttsBufRef.current[i] - 128) / 128;
            sum += s * s;
          }
          ttsAudioLevelRef.current = Math.min(1, Math.sqrt(sum / ttsBufRef.current.length) / 0.3);
        }
        targetAmp = ttsAudioLevelRef.current;
      } else {
        targetAmp = Math.abs(Math.sin(Date.now() / 2000)) * 0.05;
      }

      smoothedAmpRef.current += (targetAmp - smoothedAmpRef.current) * 0.12;
      const amp = smoothedAmpRef.current * H * 0.35;

      // ── Color lerp toward target state ────────────────────────────────────
      const target = STATE_COLORS[state] ?? STATE_COLORS.idle;
      const cc = currentColorsRef.current;
      cc.w1 = cc.w1.map((c, i) => lerp(c, target.w1[i], 0.07));
      cc.w2 = cc.w2.map((c, i) => lerp(c, target.w2[i], 0.07));

      // ── Phase advance (faster when louder) ────────────────────────────────
      phase1 += 0.022 + smoothedAmpRef.current * 0.045;
      phase2 += 0.018 + smoothedAmpRef.current * 0.035;

      const lam1 = W / 2.2;
      const lam2 = W / 1.65;

      drawWave(ctx, W, H, baseline, amp,        phase1, cc.w1, lam1);
      drawWave(ctx, W, H, baseline, amp * 0.82, phase2, cc.w2, lam2);

      rafId = requestAnimationFrame(render);
    };

    rafId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Call controls ──────────────────────────────────────────────────────────
  function startCall() {
    sessionStartTimeRef.current = Date.now();
    setCallActive(true);
    setIsLoadedSession(false);
    startRecording();
  }

  function endCall() {
    const activeTtsTurn = turns.find(t => ttsStates[t.id] && ttsStates[t.id] !== 'idle');
    if (activeTtsTurn) stopTTS(activeTtsTurn.id);
    setCallActive(false);
    stopRecording();
  }

  async function _closeSupabaseSession() {
    if (!supabaseSessionIdRef.current) return;
    const duration = sessionStartTimeRef.current
      ? Math.floor((Date.now() - sessionStartTimeRef.current) / 1000)
      : 0;
    await supabase.from('sessions').update({
      ended_at: new Date().toISOString(),
    }).eq('id', supabaseSessionIdRef.current);
  }

  async function endSession() {
    endCall();
    await _closeSupabaseSession();
    // Guest / localStorage fallback
    if (turns.some(t => t.text)) {
      const firstText = turns.find(t => t.text)?.text ?? '';
      const label = firstText.length > 42 ? firstText.slice(0, 42) + '…' : firstText;
      const newSess = {
        id: startTimeRef.current,
        label: label || service.label,
        service: service.label,
        serviceId: service.id,
        accent: service.accent,
        techLevel,
        durationSecs: Math.round((Date.now() - startTimeRef.current) / 1000),
        time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      };
      const updated = [newSess, ...sessions].slice(0, 20);
      setSessions(updated);
      localStorage.setItem('masar_sessions', JSON.stringify(updated));
    }
    await fetchSessions();
    navigate('/summary', {
      state: { turns, masarResponses, solutions, service, techLevel, startTime: startTimeRef.current },
    });
  }

  async function newSession() {
    endCall();
    await _closeSupabaseSession();
    // Guest / localStorage fallback
    if (turns.some(t => t.text)) {
      const firstText = turns.find(t => t.text)?.text ?? '';
      const label = firstText.length > 42 ? firstText.slice(0, 42) + '…' : firstText;
      const saved = {
        id: startTimeRef.current,
        label: label || service.label,
        service: service.label,
        serviceId: service.id,
        accent: service.accent,
        techLevel,
        durationSecs: Math.round((Date.now() - startTimeRef.current) / 1000),
        time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      };
      const updated = [saved, ...sessions].slice(0, 20);
      setSessions(updated);
      localStorage.setItem('masar_sessions', JSON.stringify(updated));
    }
    clearTurns();
    setMasarResponses({});
    setStreamingIds({});
    setSolutions({});
    setSolvingIds({});
    setConversationHistory([]);
    setHasLastSpoken(false);
    setSupabaseSessionId(null);
    setIsLoadedSession(false);
    setLoadedTurns([]);
    supabaseSessionIdRef.current = null;
    sessionCreatingRef.current   = false;
    sessionStartTimeRef.current  = null;
    ttsTriggeredRef.current   = new Set();
    historyAddedRef.current   = new Set();
    lastSpokenRef.current     = null;
    lastSpokenTurnRef.current = null;
    startTimeRef.current = Date.now();
    setDiagrams({});
    setDiagramLoading({});
    setShowDiagramPrompt(false);
    setPendingDiagramTurnId(null);
    diagramTriggeredRef.current = new Set();
    promptedRef.current         = new Set();
    await fetchSessions();
  }

  function loadSession(s) {
    setSidebarOpen(false);
    // Map Supabase turns → Workspace turn shape
    const mapped = (s.turns ?? []).map(t => ({
      id:       t.id,
      text:     t.arabic_transcript ?? '',
      partial:  '',
      time:     new Date(t.created_at).toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }),
      isActive: false,
    }));
    // Pre-populate responses + solutions so display works immediately
    const responses = {};
    const sols      = {};
    const history   = [];
    (s.turns ?? []).forEach(t => {
      responses[t.id] = t.refined_prompt ?? '';
      sols[t.id]      = t.solution       ?? '';
      history.push({ user: t.refined_prompt, assistant: t.solution });
      historyAddedRef.current.add(t.id);   // prevent history effect re-processing
      ttsTriggeredRef.current.add(t.id);   // prevent auto-TTS on loaded turns
    });
    clearTurns();
    setLoadedTurns(mapped);
    setMasarResponses(responses);
    setSolutions(sols);
    setConversationHistory(history);
    setIsLoadedSession(true);
    setShowText(true);
  }

  async function deleteSession(sessionId) {
    if (!window.confirm('هتمسح الجلسة دي؟')) return;
    await supabase.from('turns').delete().eq('session_id', sessionId);
    await supabase.from('sessions').delete().eq('id', sessionId);
    await fetchSessions();
  }

  // Merge loaded past turns with live mic turns for display
  const displayTurns = [...loadedTurns, ...turns];

  // Latest Claude solution for the text panel (most recent turn with any solution)
  const latestSolvedTurn = (() => {
    const withSol = displayTurns.filter(t => solutions[t.id]);
    return withSol.length > 0 ? withSol[withSol.length - 1] : null;
  })();
  const latestSolution = latestSolvedTurn ? solutions[latestSolvedTurn.id] : null;
  console.log('[DIAGRAM] latestSolvedTurn check:',
    'displayTurns:', displayTurns.length,
    'withSolutions:', displayTurns.filter(t => solutions[t.id]).length,
    'result:', latestSolvedTurn?.id
  );
  console.log('[DIAGRAM] showText:', showText, 'latestSolvedTurn:', latestSolvedTurn?.id, 'diagrams:', Object.keys(diagrams));

  const latestTurn = displayTurns.length > 0 ? displayTurns[displayTurns.length - 1] : null;
  const latestTranscript = latestTurn
    ? (latestTurn.isActive
        ? [latestTurn.text, latestTurn.partial].filter(Boolean).join(' ') || null
        : latestTurn.text || null)
    : null;

  const callBusy   = callActive && masarState === 'thinking';
  const showReplay = hasLastSpoken && masarState === 'idle';

  const handleReplay = () => {
    if (lastSpokenRef.current && lastSpokenTurnRef.current !== null) {
      playTTS(lastSpokenTurnRef.current, lastSpokenRef.current);
    }
  };

  const fetchDiagram = async (turnId) => {
    console.log('[DIAGRAM] fetchDiagram called for turnId:', turnId);
    console.log('[DIAGRAM] solution text length:', solutions[turnId]?.length);
    console.log('[DIAGRAM] already triggered:', diagramTriggeredRef.current.has(turnId));
    if (diagramTriggeredRef.current.has(turnId)) return;
    diagramTriggeredRef.current.add(turnId);
    setDiagramLoading(prev => ({ ...prev, [turnId]: true }));
    setShowDiagramPrompt(false);
    try {
      const res = await fetch(`${API_BASE}/diagram`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ solution: solutions[turnId], service_id: service.id }),
      });
      console.log('[DIAGRAM] response status:', res.status);
      const data = await res.json();
      console.log('[DIAGRAM] response data:', data);
      const { diagram } = data;
      if (diagram) setDiagrams(prev => ({ ...prev, [turnId]: diagram }));
    } catch (e) {
      console.error('Diagram fetch failed:', e);
    } finally {
      setDiagramLoading(prev => { const n = { ...prev }; delete n[turnId]; return n; });
    }
  };

  const handleDiagramAccept = useCallback(() => {
    console.log('[DIAGRAM] accept clicked, pendingDiagramTurnId:', pendingDiagramTurnId);
    if (pendingDiagramTurnId) {
      setShowText(true);
      fetchDiagram(pendingDiagramTurnId);
    }
  }, [pendingDiagramTurnId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDiagramDismiss = useCallback(() => {
    setShowDiagramPrompt(false);
    if (pendingDiagramTurnId) diagramTriggeredRef.current.add(pendingDiagramTurnId);
  }, [pendingDiagramTurnId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ height: '100vh', width: '100vw', position: 'relative', overflow: 'hidden', background: theme === 'light' ? '#F0F4F8' : '#010508' }}>

      {/* ── Full-screen canvas ── */}
      <canvas
        id="waveform-canvas"
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
      />

      {/* ── Dark overlay when showText ── */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 10,
        background: 'rgba(0,0,0,0.45)',
        opacity: showText ? 1 : 0,
        transition: 'opacity 300ms ease',
        pointerEvents: 'none',
      }} />

      {/* ── Frosted glass text panel ── */}
      <div style={{
        position: 'absolute',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        background: 'rgba(8,12,20,0.75)',
        border: '1px solid rgba(34,211,238,0.15)',
        borderRadius: 16,
        padding: '2rem',
        maxWidth: 680,
        width: 'calc(100vw - 4rem)',
        maxHeight: '60vh',
        overflowY: 'auto',
        zIndex: 20,
        opacity: (showText && (latestTranscript || latestSolution)) ? 1 : 0,
        transition: 'opacity 300ms ease',
        pointerEvents: (showText && (latestTranscript || latestSolution)) ? 'auto' : 'none',
      }}>

        {/* Loaded-session banner */}
        {isLoadedSession && !callActive && (
          <p style={{
            fontFamily: 'Cairo, sans-serif', fontSize: '0.8125rem',
            direction: 'rtl', textAlign: 'right',
            color: 'var(--masar-amber)', margin: '0 0 1.25rem 0',
            opacity: 0.85,
          }}>
            جلسة محفوظة — اضغط ابدأ مكالمة للاستمرار
          </p>
        )}

        {/* قلت — user speech */}
        {latestTranscript && (
          <div>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: '0.6875rem',
              letterSpacing: '0.1em', color: 'var(--masar-amber)',
              textAlign: 'right', margin: '0 0 0.5rem 0',
            }}>
              قلت
            </p>
            <p style={{
              fontFamily: 'Cairo, sans-serif', fontSize: '1rem',
              lineHeight: 1.9, direction: 'rtl', textAlign: 'right',
              color: 'var(--masar-muted)', margin: 0, whiteSpace: 'pre-wrap',
            }}>
              {latestTranscript}
              {latestTurn?.isActive && (
                <span className="stream-cursor" style={{ color: 'var(--masar-amber)' }}>▌</span>
              )}
            </p>
          </div>
        )}

        {/* Divider */}
        {latestTranscript && latestSolution && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', margin: '1.25rem 0' }} />
        )}

        {/* مسار — Claude response */}
        {latestSolution && (
          <div>
            <p style={{
              fontFamily: 'var(--font-mono)', fontSize: '0.6875rem',
              letterSpacing: '0.1em', color: 'var(--masar-cyan)',
              textAlign: 'right', margin: '0 0 0.5rem 0',
            }}>
              مسار
            </p>
            <p style={{
              fontFamily: 'Cairo, sans-serif', fontSize: '1.0625rem',
              lineHeight: 2, direction: 'rtl', textAlign: 'right',
              color: '#E2E8F0', margin: 0, whiteSpace: 'pre-wrap',
            }}>
              {latestSolution}
            </p>
          </div>
        )}

        {/* Network diagram panel — shown after user accepts the prompt */}
        {(diagrams[latestSolvedTurn?.id] || diagramLoading[latestSolvedTurn?.id]) && (
          <DiagramPanel
            diagramCode={diagrams[latestSolvedTurn?.id]}
            loading={!!diagramLoading[latestSolvedTurn?.id]}
          />
        )}

      </div>

      {/* ── Sidebar scrim ── */}
      {sidebarOpen && (
        <div
          className="scrim-enter"
          onClick={() => setSidebarOpen(false)}
          style={{ position: 'absolute', inset: 0, zIndex: 30, background: 'rgba(0,0,0,0.3)' }}
        />
      )}

      {/* ── Sidebar (absolute overlay, slides from left) ── */}
      <aside style={{
        position: 'absolute', left: 0, top: 0, height: '100%',
        width: 'var(--sidebar-width)',
        background: 'rgba(8,12,20,0.96)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRight: '1px solid var(--masar-border)',
        display: 'flex', flexDirection: 'column',
        transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform var(--duration-slow) var(--ease-out-expo)',
        zIndex: 40,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.25rem 1rem', borderBottom: '1px solid var(--masar-border)' }}>
            <span className="heading-md" style={{ fontSize: '0.9375rem' }}>
              Masar <span style={{ color: 'var(--masar-amber)', fontFamily: 'Cairo, sans-serif' }}>مسار</span>
            </span>
            <SidebarIconBtn onClick={() => setSidebarOpen(false)} title="Close">←</SidebarIconBtn>
          </div>

          <div style={{ padding: '0.75rem' }}>
            <button onClick={newSession} style={{
              width: '100%', background: 'var(--masar-amber-glow)',
              border: '1px solid var(--masar-amber-line)', borderRadius: 'var(--radius-md)',
              color: 'var(--masar-amber)', fontFamily: 'var(--font-mono)',
              fontSize: '0.8125rem', padding: '0.625rem', cursor: 'pointer',
            }}>
              + New Session
            </button>
          </div>

          <div style={{ padding: '0 0.75rem 0.75rem' }}>
            <input
              placeholder="Search sessions..."
              value={sessionSearch}
              onChange={e => setSessionSearch(e.target.value)}
              style={{
                width: '100%', background: 'var(--masar-elevated)',
                border: '1px solid var(--masar-border)', borderRadius: 'var(--radius-md)',
                color: '#E2E8F0', fontFamily: 'var(--font-mono)',
                fontSize: '0.8125rem', padding: '0.5rem 0.75rem', outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '0 0.75rem' }}>
            <p className="mono-sm" style={{ color: 'var(--masar-muted)', padding: '0.5rem 0.25rem' }}>
              Previous Sessions
            </p>

            {/* ── Logged-in: Supabase sessions only ── */}
            {currentUser
              ? (() => {
                  const filteredSessions = supabaseSessions.filter(s =>
                    !sessionSearch ||
                    (s.title ?? '').includes(sessionSearch) ||
                    (s.service_id ?? '').includes(sessionSearch)
                  );
                  return filteredSessions.length > 0
                    ? filteredSessions.map(s => (
                  <div key={s.id} style={{
                    display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
                    padding: '0.625rem 0.75rem', borderRadius: 'var(--radius-md)',
                    cursor: 'pointer', marginBottom: '0.125rem',
                    borderLeft: '2px solid var(--masar-amber)',
                  }}
                    onClick={() => loadSession(s)}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--masar-elevated)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: '0.8125rem', color: '#CBD5E1', marginBottom: '0.125rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'Cairo, sans-serif', direction: 'rtl' }}>
                        {s.title ?? s.service_id ?? 'جلسة'}
                      </p>
                      <p className="mono-sm" style={{ color: 'var(--masar-muted)', fontFamily: 'Cairo, sans-serif', direction: 'rtl', textAlign: 'right' }}>
                        {new Date(s.started_at).toLocaleDateString('ar-EG')}
                        {s.duration_seconds ? ` · ${Math.round(s.duration_seconds / 60)} د` : ''}
                        {s.turns?.length ? ` · ${s.turns.length} رد` : ''}
                      </p>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); deleteSession(s.id); }}
                      style={{
                        background: 'transparent', border: 'none',
                        color: 'rgba(239,68,68,0.5)', cursor: 'pointer',
                        fontSize: '0.875rem', lineHeight: 1, padding: '0.125rem',
                        flexShrink: 0, transition: 'color 150ms',
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = '#EF4444'}
                      onMouseLeave={e => e.currentTarget.style.color = 'rgba(239,68,68,0.5)'}
                      title="حذف الجلسة"
                    >×</button>
                  </div>
                ))
                : (
                  <p style={{
                    fontFamily: 'Cairo, sans-serif', fontSize: '0.8125rem',
                    color: 'var(--masar-muted)', textAlign: 'center', direction: 'rtl',
                    padding: '1rem 0.25rem',
                  }}>
                    مفيش جلسات محفوظة لسه
                  </p>
                );
                })()
              : /* Guest — localStorage sessions only */
                sessions.length > 0
                  ? sessions.map(s => (
                    <div key={s.id} style={{
                      padding: '0.625rem 0.75rem', borderRadius: 'var(--radius-md)',
                      cursor: 'pointer', marginBottom: '0.125rem',
                      borderLeft: `2px solid ${s.accent ?? 'var(--masar-border)'}`,
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--masar-elevated)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <p style={{ fontSize: '0.8125rem', color: '#CBD5E1', marginBottom: '0.125rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</p>
                      <p className="mono-sm" style={{ color: 'var(--masar-muted)' }}>{s.service} · {s.time}</p>
                    </div>
                  ))
                  : (
                    <p className="mono-sm" style={{ color: 'var(--masar-muted)', padding: '0.25rem' }}>No sessions yet</p>
                  )
            }

            {/* Guest login prompt */}
            {isGuest && (
              <p style={{
                fontFamily: 'Cairo, sans-serif', fontSize: '0.75rem',
                color: 'var(--masar-muted)', textAlign: 'right', direction: 'rtl',
                padding: '0.75rem 0.25rem 0.25rem', marginTop: '0.5rem',
                borderTop: '1px solid var(--masar-border)',
              }}>
                <span
                  onClick={() => navigate('/auth')}
                  style={{ color: 'var(--masar-amber)', cursor: 'pointer', textDecoration: 'underline' }}
                >
                  سجل دخول
                </span>
                {' '}عشان تحفظ جلساتك
              </p>
            )}
          </div>

          <div style={{ padding: '0.75rem', borderTop: '1px solid var(--masar-border)' }}>
            <SidebarRow icon="⚙" label="Settings" onClick={() => navigate('/settings')} />
          </div>

        </div>
      </aside>

      {/* ── Top bar ── */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50,
        display: 'flex', alignItems: 'center',
        padding: '1rem 1.25rem',
        background: 'linear-gradient(to bottom, rgba(1,5,8,0.70) 0%, transparent 100%)',
      }}>
        <button
          id="sidebar-btn"
          onClick={() => setSidebarOpen(v => !v)}
          style={{
            background: 'transparent', border: 'none',
            color: 'rgba(226,232,240,0.7)', fontSize: '1.25rem',
            cursor: 'pointer', padding: '0.25rem 0.5rem', lineHeight: 1,
          }}
        >
          ☰
        </button>

        <span style={{
          flex: 1, textAlign: 'center',
          fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
          letterSpacing: '0.12em', textTransform: 'uppercase',
          color: 'var(--masar-amber)',
        }}>
          {service.label}
        </span>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <span id="eye-toggle-btn">
            <TopBarBtn
              onClick={() => setShowText(v => !v)}
              active={showText}
              title={showText ? 'Hide response' : 'Show response'}
            >
              👁
            </TopBarBtn>
          </span>
          {Object.keys(solutions).length > 0 && (
            <TopBarBtn
              onClick={handleExportPDF}
              title={pdfLoading ? 'Generating PDF…' : 'Export PDF'}
            >
              {pdfLoading ? '…' : '📄'}
            </TopBarBtn>
          )}
          <ThemeToggle />
          <TopBarBtn onClick={() => navigate('/settings')} title="Settings">
            ⚙
          </TopBarBtn>
        </div>
      </div>

      {/* ── Bottom controls ── */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 50,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '0.75rem',
        padding: '1.5rem 1.5rem 2.5rem',
        background: 'linear-gradient(to top, rgba(1,5,8,0.75) 0%, transparent 100%)',
      }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.25rem' }}>

          {/* Replay button — left of mic, fades in when MASAR returns to idle */}
          <button
            id="replay-btn"
            onClick={handleReplay}
            title="Replay last response"
            style={{
              width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
              border: '1px solid rgba(34,211,238,0.40)',
              background: 'transparent',
              color: 'var(--masar-cyan)',
              fontSize: '1rem', lineHeight: 1,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: showReplay ? 1 : 0,
              pointerEvents: showReplay ? 'auto' : 'none',
              transition: 'opacity 300ms ease, background 200ms ease',
            }}
            onMouseEnter={e => { if (showReplay) e.currentTarget.style.background = 'rgba(34,211,238,0.10)'; }}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            🔁
          </button>

          {/* Mic / End Call button */}
          <button
            id="start-call-btn"
            onClick={callActive ? endCall : startCall}
            disabled={callBusy}
            style={{
              width: 72, height: 72, borderRadius: '50%', flexShrink: 0,
              border: callActive
                ? '2px solid rgba(239,68,68,0.80)'
                : '2px solid rgba(245,158,11,0.60)',
              background: callActive
                ? 'rgba(239,68,68,0.12)'
                : 'rgba(245,158,11,0.08)',
              color: callActive ? '#EF4444' : 'var(--masar-amber)',
              fontSize: '1.6rem', lineHeight: 1,
              cursor: callBusy ? 'not-allowed' : 'pointer',
              opacity: callBusy ? 0.45 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'border-color 300ms, background 300ms, opacity 300ms',
              boxShadow: callActive
                ? '0 0 0 8px rgba(239,68,68,0.07), 0 0 24px rgba(239,68,68,0.12)'
                : '0 0 0 8px rgba(245,158,11,0.05), 0 0 24px rgba(245,158,11,0.08)',
            }}
          >
            {callActive
              ? <span style={{ transform: 'rotate(135deg)', display: 'inline-block' }}>📞</span>
              : <span>🎙</span>}
          </button>

          {/* Spacer — mirrors replay width to keep mic centered */}
          <div style={{ width: 40, height: 40, flexShrink: 0 }} />

        </div>

        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.6875rem',
          letterSpacing: '0.1em', textTransform: 'uppercase',
          color: callActive ? 'var(--masar-danger)' : 'rgba(148,163,184,0.45)',
          transition: 'color 300ms',
        }}>
          {callActive ? '● Call Active' : 'Start Call'}
        </span>

        <button
          onClick={endSession}
          style={{
            background: 'transparent', border: 'none',
            color: 'rgba(148,163,184,0.40)',
            fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
            cursor: 'pointer', transition: 'color 200ms',
          }}
          onMouseEnter={e => e.target.style.color = 'rgba(226,232,240,0.80)'}
          onMouseLeave={e => e.target.style.color = 'rgba(148,163,184,0.40)'}
        >
          End Session &amp; View Summary →
        </button>

      </div>

      {showTour && (
        <OnboardingTour
          steps={TOUR_STEPS_WORKSPACE}
          onComplete={completeTour}
          onSkip={completeTour}
        />
      )}

      <DiagramPromptBubble
        key={pendingDiagramTurnId}
        visible={showDiagramPrompt}
        onAccept={handleDiagramAccept}
        onDismiss={handleDiagramDismiss}
      />

    </div>
  );
}

/* ══ Layer 3: Refinement streaming ════════════════════════════════════════ */

async function streamRefine(turnId, text, techLevel, serviceId, setMasarResponses, setStreamingIds) {
  setMasarResponses(prev => ({ ...prev, [turnId]: '' }));
  setStreamingIds(prev => ({ ...prev, [turnId]: true }));
  try {
    const res = await fetch(`${import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000'}/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, tech_level: techLevel, service_id: serviceId }),
    });
    if (!res.ok) {
      setMasarResponses(prev => ({ ...prev, [turnId]: 'حصل خطأ في المعالجة، حاول تاني' }));
      setStreamingIds(prev => { const n = { ...prev }; delete n[turnId]; return n; });
      return;
    }
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value, { stream: true }).split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') {
          setStreamingIds(prev => { const n = { ...prev }; delete n[turnId]; return n; });
          return;
        }
        try {
          const token = JSON.parse(payload);
          setMasarResponses(prev => ({ ...prev, [turnId]: (prev[turnId] ?? '') + token }));
        } catch { /* partial SSE frame */ }
      }
    }
  } catch (err) {
    setMasarResponses(prev => ({ ...prev, [turnId]: `[Error: ${err.message}]` }));
  } finally {
    setStreamingIds(prev => { const n = { ...prev }; delete n[turnId]; return n; });
  }
}

async function streamSolve(turnId, refinedPrompt, techLevel, serviceId, setSolutions, setSolvingIds, history = []) {
  setSolutions(prev => ({ ...prev, [turnId]: '' }));
  setSolvingIds(prev => ({ ...prev, [turnId]: true }));
  try {
    const res = await fetch(`${import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000'}/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refined_prompt: refinedPrompt,
        tech_level: techLevel,
        service_id: serviceId,
        response_language: 'arabic',
        history,
      }),
    });
    if (!res.ok) {
      setSolutions(prev => ({ ...prev, [turnId]: 'حصل خطأ في التوليد، حاول تاني' }));
      setSolvingIds(prev => { const n = { ...prev }; delete n[turnId]; return n; });
      return;
    }
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value, { stream: true }).split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') {
          setSolvingIds(prev => { const n = { ...prev }; delete n[turnId]; return n; });
          return;
        }
        try {
          const token = JSON.parse(payload);
          setSolutions(prev => ({ ...prev, [turnId]: (prev[turnId] ?? '') + token }));
        } catch { /* partial SSE frame */ }
      }
    }
  } catch (err) {
    setSolutions(prev => ({ ...prev, [turnId]: `[Error: ${err.message}]` }));
  } finally {
    setSolvingIds(prev => { const n = { ...prev }; delete n[turnId]; return n; });
  }
}

/* ══ Sub-components ═══════════════════════════════════════════════════════ */

function TopBarBtn({ children, onClick, active, title }) {
  return (
    <button onClick={onClick} title={title} style={{
      background: active ? 'rgba(34,211,238,0.12)' : 'rgba(255,255,255,0.06)',
      border: active ? '1px solid rgba(34,211,238,0.35)' : '1px solid rgba(255,255,255,0.10)',
      borderRadius: 'var(--radius-sm)',
      color: active ? 'var(--masar-cyan)' : 'rgba(226,232,240,0.70)',
      width: 32, height: 32, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '0.875rem',
      transition: 'background 200ms, border-color 200ms, color 200ms',
    }}>
      {children}
    </button>
  );
}

function SidebarIconBtn({ children, onClick, title }) {
  return (
    <button onClick={onClick} title={title} style={{
      background: 'transparent', border: '1px solid var(--masar-border)',
      borderRadius: 'var(--radius-sm)', color: 'var(--masar-muted)',
      width: 28, height: 28, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '0.875rem',
    }}>
      {children}
    </button>
  );
}

function SidebarRow({ icon, label, onClick }) {
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: '0.625rem',
      padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-md)',
      cursor: 'pointer',
    }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--masar-elevated)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <span style={{ fontSize: '0.875rem' }}>{icon}</span>
      <span style={{ fontSize: '0.8125rem', color: 'var(--masar-muted)' }}>{label}</span>
    </div>
  );
}
