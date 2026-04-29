import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAudioStream } from '../hooks/useAudioStream';
import { useTTS } from '../hooks/useTTS';

const VAD_THRESHOLDS = { low: 0.20, medium: 0.10, high: 0.05 };
const VAD_SILENCE_MS = 4000;
const VAD_MIN_SPEECH = 600;

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

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showText,    setShowText]    = useState(false);
  const [techLevel]      = useState(() => localStorage.getItem('masar_tech_level') ?? 'Professional');
  const [vadSensitivity] = useState(() => localStorage.getItem('masar_vad')        ?? 'medium');
  const [callActive, setCallActive] = useState(false);
  const [sessions,   setSessions]   = useState(() => {
    try { return JSON.parse(localStorage.getItem('masar_sessions') || '[]'); } catch { return []; }
  });

  const startTimeRef = useRef(Date.now());
  const prevStateRef = useRef('idle');

  const {
    turns, isRecording, audioLevelRef, error,
    startRecording, stopRecording, clearTurns, removeTurn,
  } = useAudioStream();

  const [masarResponses, setMasarResponses] = useState({});
  const [streamingIds,   setStreamingIds]   = useState({});
  const [solutions,      setSolutions]      = useState({});
  const [solvingIds,     setSolvingIds]     = useState({});

  const {
    ttsStates, play: playTTS, isSpeaking: masarSpeaking, audioRef: ttsAudioRef,
  } = useTTS();

  // ── Auto-TTS ───────────────────────────────────────────────────────────────
  const ttsTriggeredRef = useRef(new Set());
  useEffect(() => {
    turns.forEach(t => {
      if (!t.isActive && solutions[t.id] && !solvingIds[t.id] && !ttsTriggeredRef.current.has(t.id)) {
        ttsTriggeredRef.current.add(t.id);
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
        streamSolve(t.id, masarResponses[t.id], techLevel, service.id, setSolutions, setSolvingIds);
      }
    });
  }, [masarResponses, streamingIds, turns]); // eslint-disable-line react-hooks/exhaustive-deps

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

      // Dark background + dot grid
      ctx.fillStyle = '#010508';
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
  function startCall() { setCallActive(true); startRecording(); }
  function endCall()   { setCallActive(false); stopRecording(); }

  function endSession() {
    endCall();
    if (turns.some(t => t.text)) {
      const firstText = turns.find(t => t.text)?.text ?? '';
      const label = firstText.length > 42 ? firstText.slice(0, 42) + '…' : firstText;
      const newSession = {
        id: startTimeRef.current,
        label: label || service.label,
        service: service.label,
        serviceId: service.id,
        accent: service.accent,
        techLevel,
        durationSecs: Math.round((Date.now() - startTimeRef.current) / 1000),
        time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      };
      const updated = [newSession, ...sessions].slice(0, 20);
      setSessions(updated);
      localStorage.setItem('masar_sessions', JSON.stringify(updated));
    }
    navigate('/summary', {
      state: { turns, masarResponses, solutions, service, techLevel, startTime: startTimeRef.current },
    });
  }

  function newSession() {
    endCall();
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
    ttsTriggeredRef.current = new Set();
    startTimeRef.current = Date.now();
  }

  const callBusy = callActive && (masarState === 'thinking' || masarState === 'speaking');

  // Latest Claude solution for the text panel (most recent turn with any solution)
  const latestSolution = (() => {
    const withSol = turns.filter(t => solutions[t.id]);
    return withSol.length > 0 ? solutions[withSol[withSol.length - 1].id] : null;
  })();

  return (
    <div style={{ height: '100vh', width: '100vw', position: 'relative', overflow: 'hidden', background: '#010508' }}>

      {/* ── Full-screen canvas ── */}
      <canvas
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
        opacity: (showText && latestSolution) ? 1 : 0,
        transition: 'opacity 300ms ease',
        pointerEvents: (showText && latestSolution) ? 'auto' : 'none',
      }}>
        {latestSolution && (
          <p style={{
            fontFamily: 'Cairo, sans-serif',
            fontSize: '1.0625rem',
            lineHeight: 2,
            direction: 'rtl',
            textAlign: 'right',
            color: '#E2E8F0',
            margin: 0,
            whiteSpace: 'pre-wrap',
          }}>
            {latestSolution}
          </p>
        )}
      </div>

      {/* ── Sidebar scrim ── */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{ position: 'absolute', inset: 0, zIndex: 30 }}
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
            <input placeholder="Search sessions..." style={{
              width: '100%', background: 'var(--masar-elevated)',
              border: '1px solid var(--masar-border)', borderRadius: 'var(--radius-md)',
              color: '#E2E8F0', fontFamily: 'var(--font-mono)',
              fontSize: '0.8125rem', padding: '0.5rem 0.75rem', outline: 'none',
              boxSizing: 'border-box',
            }} />
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '0 0.75rem' }}>
            <p className="mono-sm" style={{ color: 'var(--masar-muted)', padding: '0.5rem 0.25rem' }}>
              Previous Sessions
            </p>
            {sessions.length === 0 ? (
              <p className="mono-sm" style={{ color: 'var(--masar-muted)', padding: '0.25rem' }}>No sessions yet</p>
            ) : sessions.map(s => (
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
            ))}
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
          <TopBarBtn
            onClick={() => setShowText(v => !v)}
            active={showText}
            title={showText ? 'Hide response' : 'Show response'}
          >
            👁
          </TopBarBtn>
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

        <button
          onClick={callActive ? endCall : startCall}
          disabled={callBusy}
          style={{
            width: 72, height: 72, borderRadius: '50%',
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

async function streamSolve(turnId, refinedPrompt, techLevel, serviceId, setSolutions, setSolvingIds) {
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
      }),
    });
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
