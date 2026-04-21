import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAudioStream } from '../hooks/useAudioStream';
import { useTTS } from '../hooks/useTTS';

/*
 * Workspace — The Cockpit
 * Layout: sidebar | scrollable turn feed | fixed bottom controls
 *
 * Each mic session = one TurnBlock (User Speech bubbles + Masar answer below).
 * Turns stack vertically in a scrollable column.
 */

const TECH_LEVELS = ['Beginner', 'Professional', 'Expert'];

// VAD silence thresholds — audioLevelRef is 0.0–1.0 (0 = below noise floor)
const VAD_THRESHOLDS = { low: 0.05, medium: 0.02, high: 0.01 };
const VAD_SILENCE_MS  = 1500;  // ms of continuous silence before turn closes
const VAD_MIN_SPEECH  = 500;   // ms of speech required before VAD can trigger

// Default fallback service if user lands directly on /workspace
const DEFAULT_SERVICE = {
  id: 'fiber',
  label: 'Fiber Optic Routing',
  arabic: 'توجيه الألياف الضوئية',
  accent: '#F59E0B',
  icon: '◈',
};

export default function Workspace() {
  const navigate   = useNavigate();
  const location   = useLocation();
  const service    = location.state?.service ?? DEFAULT_SERVICE;

  const [sidebarOpen,    setSidebarOpen]    = useState(true);
  const [techLevel,      setTechLevel]      = useState('Professional');
  const [vadSensitivity, setVadSensitivity] = useState('medium');
  const [callActive,     setCallActive]     = useState(false);
  const [sessions,       setSessions]       = useState(() => {
    try { return JSON.parse(localStorage.getItem('masar_sessions') || '[]'); }
    catch { return []; }
  });

  const feedEndRef    = useRef(null);
  const micBtnRef     = useRef(null);
  const startTimeRef  = useRef(Date.now());
  const prevStateRef  = useRef('idle'); // tracks previous masarState for restart logic

  const { turns, isRecording, isSpeaking, audioLevelRef, error, startRecording, stopRecording, clearTurns } = useAudioStream();

  // masarResponses:  { [turnId]: string } — tokens streamed from /refine (Layer 3)
  // streamingIds:    { [turnId]: true }  — present while Layer 3 SSE stream is open
  const [masarResponses, setMasarResponses] = useState({});
  const [streamingIds,   setStreamingIds]   = useState({});

  // solutions:    { [turnId]: string } — tokens streamed from /solve (Layer 4)
  // solvingIds:   { [turnId]: true }  — present while Layer 4 SSE stream is open
  const [solutions,  setSolutions]  = useState({});
  const [solvingIds, setSolvingIds] = useState({});

  // Layer 5 — TTS
  const { ttsStates, play: playTTS, stop: stopTTS, replay: replayTTS, isSpeaking: masarSpeaking } = useTTS();

  // Auto-trigger TTS once per turn when solution streaming finishes
  const ttsTriggeredRef = useRef(new Set());
  useEffect(() => {
    turns.forEach(t => {
      if (
        !t.isActive &&
        solutions[t.id] &&
        !solvingIds[t.id] &&
        !ttsTriggeredRef.current.has(t.id)
      ) {
        ttsTriggeredRef.current.add(t.id);
        playTTS(t.id, solutions[t.id]);
      }
    });
  }, [turns, solutions, solvingIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive MASAR's current state — priority: speaking > listening > thinking > idle
  const isThinking = Object.keys(streamingIds).length > 0 || Object.keys(solvingIds).length > 0;
  const masarState  = masarSpeaking ? 'speaking'
    : isRecording                   ? 'listening'
    : isThinking                    ? 'thinking'
    : 'idle';

  // Trigger refinement whenever a turn closes with captured text
  useEffect(() => {
    const toRefine = turns.filter(t => !t.isActive && t.text && masarResponses[t.id] === undefined);
    toRefine.forEach(turn =>
      streamRefine(turn.id, turn.text, techLevel, service.id, setMasarResponses, setStreamingIds)
    );
  }, [turns]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-solve: fire Layer 4 as soon as Layer 3 finishes (replaces manual button)
  useEffect(() => {
    turns.forEach(t => {
      if (
        !t.isActive &&
        masarResponses[t.id] &&
        !streamingIds[t.id] &&
        solutions[t.id] === undefined
      ) {
        streamSolve(t.id, masarResponses[t.id], techLevel, service.id, setSolutions, setSolvingIds);
      }
    });
  }, [masarResponses, streamingIds, turns]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── VAD loop ─────────────────────────────────────────────────────────────
  // Runs only while the call is active and the mic is open.
  // Reads audioLevelRef (written by useAudioStream's own rAF) — no new audio pipeline.
  useEffect(() => {
    if (!callActive || !isRecording) return;

    const THRESHOLD = VAD_THRESHOLDS[vadSensitivity];
    let speechStart  = null;
    let silenceStart = null;
    let rafId;

    let lastLogTime = 0;

    const tick = () => {
      const level = audioLevelRef.current;
      const now   = Date.now();

      // Log amplitude every 500ms so we can see what the VAD is actually reading
      if (now - lastLogTime >= 500) {
        console.log(`[VAD] level=${level.toFixed(4)} threshold=${THRESHOLD} speechStart=${speechStart ? now - speechStart + 'ms ago' : 'null'} silenceStart=${silenceStart ? now - silenceStart + 'ms ago' : 'null'}`);
        lastLogTime = now;
      }

      if (level > THRESHOLD) {
        // Speech detected — reset silence clock, start speech clock
        if (!speechStart) speechStart = now;
        silenceStart = null;
      } else {
        // Silence detected
        if (!silenceStart) silenceStart = now;

        const speechDuration  = speechStart ? (silenceStart - speechStart) : 0;
        const silenceDuration = now - silenceStart;

        if (speechDuration >= VAD_MIN_SPEECH && silenceDuration >= VAD_SILENCE_MS) {
          console.log(`[VAD] FIRING stopRecording — speechDuration=${speechDuration}ms silenceDuration=${silenceDuration}ms`);
          stopRecording();
          return;
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [callActive, isRecording, vadSensitivity]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-restart mic after pipeline completes ────────────────────────────
  // When masarState transitions from any active state back to idle,
  // and the call is still active, reopen the mic.
  useEffect(() => {
    const prev = prevStateRef.current;
    prevStateRef.current = masarState;

    if (!callActive) return;
    if (prev !== 'idle' && masarState === 'idle') {
      startRecording();
    }
  }, [masarState, callActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drive mic button glow directly from amplitude — bypasses React renders entirely
  useEffect(() => {
    if (!isRecording) {
      if (micBtnRef.current) {
        micBtnRef.current.style.boxShadow = '';
        micBtnRef.current.style.transform = '';
      }
      return;
    }
    let rafId;
    const update = () => {
      const lvl = audioLevelRef.current;
      if (micBtnRef.current) {
        const ring  = `0 0 0 ${2 + lvl * 6}px rgba(245,158,11,${(0.3 + lvl * 0.65).toFixed(2)})`;
        const aura  = `0 0 ${10 + lvl * 32}px rgba(245,158,11,${(0.12 + lvl * 0.48).toFixed(2)})`;
        const halo  = `0 0 ${28 + lvl * 56}px rgba(245,158,11,${(0.04 + lvl * 0.18).toFixed(2)})`;
        micBtnRef.current.style.boxShadow = `${ring}, ${aura}, ${halo}`;
        micBtnRef.current.style.transform = `scale(${(1 + lvl * 0.11).toFixed(4)})`;
      }
      rafId = requestAnimationFrame(update);
    };
    rafId = requestAnimationFrame(update);
    return () => {
      cancelAnimationFrame(rafId);
      if (micBtnRef.current) {
        micBtnRef.current.style.boxShadow = '';
        micBtnRef.current.style.transform = '';
      }
    };
  }, [isRecording, audioLevelRef]);

  // Auto-scroll to bottom whenever a new turn is added or messages arrive
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns]);

  // ── Call control ──────────────────────────────────────────────────────────
  function startCall() {
    setCallActive(true);
    startRecording();
  }

  function endCall() {
    setCallActive(false);
    stopRecording();
  }

  // Save session to localStorage + navigate to summary
  function endSession() {
    endCall();
    if (turns.some(t => t.text)) {
      const firstText = turns.find(t => t.text)?.text ?? '';
      const label = firstText.length > 42 ? firstText.slice(0, 42) + '…' : firstText;
      const durationSecs = Math.round((Date.now() - startTimeRef.current) / 1000);
      const newSession = {
        id: startTimeRef.current,
        label: label || service.label,
        service: service.label,
        serviceId: service.id,
        accent: service.accent,
        techLevel,
        durationSecs,
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

  // Start a new session (save current + clear state)
  function newSession() {
    endCall();
    if (turns.some(t => t.text)) {
      const firstText = turns.find(t => t.text)?.text ?? '';
      const label = firstText.length > 42 ? firstText.slice(0, 42) + '…' : firstText;
      const durationSecs = Math.round((Date.now() - startTimeRef.current) / 1000);
      const saved = {
        id: startTimeRef.current,
        label: label || service.label,
        service: service.label,
        serviceId: service.id,
        accent: service.accent,
        techLevel,
        durationSecs,
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

  const isGeneral     = service.id === 'general';
  const callBusy      = callActive && (masarState === 'thinking' || masarState === 'speaking');

  return (
    <div style={{ height: '100vh', display: 'flex', overflow: 'hidden', fontFamily: 'var(--font-body)' }}>

      {/* ══ SIDEBAR ══════════════════════════════════════════════════════ */}
      <aside style={{
        width: sidebarOpen ? 'var(--sidebar-width)' : '0',
        minWidth: sidebarOpen ? 'var(--sidebar-width)' : '0',
        overflow: 'hidden',
        background: 'var(--masar-surface)',
        borderRight: '1px solid var(--masar-border)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width var(--duration-slow) var(--ease-out-expo), min-width var(--duration-slow) var(--ease-out-expo)',
      }}>
        <div style={{ width: 'var(--sidebar-width)', display: 'flex', flexDirection: 'column', height: '100%' }}>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1.25rem 1rem', borderBottom: '1px solid var(--masar-border)' }}>
            <span className="heading-md" style={{ fontSize: '0.9375rem' }}>
              Masar <span style={{ color: 'var(--masar-amber)', fontFamily: 'Cairo, sans-serif' }}>مسار</span>
            </span>
            <SidebarIconBtn onClick={() => setSidebarOpen(false)} title="Close sidebar">←</SidebarIconBtn>
          </div>

          <div style={{ padding: '0.75rem' }}>
            <button
              onClick={newSession}
              style={{
                width: '100%', background: 'var(--masar-amber-glow)',
                border: '1px solid var(--masar-amber-line)', borderRadius: 'var(--radius-md)',
                color: 'var(--masar-amber)', fontFamily: 'var(--font-mono)',
                fontSize: '0.8125rem', padding: '0.625rem', cursor: 'pointer',
                transition: 'opacity var(--duration-fast)',
              }}
              onMouseEnter={e => e.target.style.opacity = '0.8'}
              onMouseLeave={e => e.target.style.opacity = '1'}
            >
              + New Session
            </button>
          </div>

          <div style={{ padding: '0 0.75rem 0.75rem' }}>
            <input placeholder="Search sessions..." style={{
              width: '100%', background: 'var(--masar-elevated)',
              border: '1px solid var(--masar-border)', borderRadius: 'var(--radius-md)',
              color: '#E2E8F0', fontFamily: 'var(--font-mono)',
              fontSize: '0.8125rem', padding: '0.5rem 0.75rem', outline: 'none',
            }} />
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '0 0.75rem' }}>
            <p className="mono-sm" style={{ color: 'var(--masar-muted)', padding: '0.5rem 0.25rem', marginBottom: '0.25rem' }}>
              Previous Sessions
            </p>
            {sessions.length === 0 ? (
              <p className="mono-sm" style={{ color: 'var(--masar-muted)', padding: '0.25rem' }}>No sessions yet</p>
            ) : sessions.map(s => (
              <div key={s.id}
                style={{ padding: '0.625rem 0.75rem', borderRadius: 'var(--radius-md)', cursor: 'pointer', marginBottom: '0.125rem', transition: 'background var(--duration-fast)', borderLeft: `2px solid ${s.accent ?? 'var(--masar-border)'}` }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--masar-elevated)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <p style={{ fontSize: '0.8125rem', color: '#CBD5E1', marginBottom: '0.125rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</p>
                <p className="mono-sm" style={{ color: 'var(--masar-muted)' }}>{s.service} · {s.time}</p>
              </div>
            ))}
          </div>

          <div style={{ padding: '0.75rem', borderTop: '1px solid var(--masar-border)' }}>
            <SidebarRow icon="⚙" label="Settings" />
          </div>

        </div>
      </aside>

      {/* ══ MAIN PANEL ═══════════════════════════════════════════════════ */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

        {/* Top bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0.875rem 1.5rem', borderBottom: '1px solid var(--masar-border)',
          background: 'var(--masar-deep)', zIndex: 10, flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {!sidebarOpen && (
              <SidebarIconBtn onClick={() => setSidebarOpen(true)} title="Open sidebar">→</SidebarIconBtn>
            )}
            {/* Call status dot */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              <div style={{
                width: 7, height: 7, borderRadius: '50%',
                background: masarState === 'speaking'  ? 'var(--masar-signal)'
                          : masarState === 'listening' ? 'var(--masar-amber)'
                          : masarState === 'thinking'  ? 'var(--masar-cyan)'
                          : callActive                 ? 'var(--masar-muted)'
                          : 'var(--masar-muted)',
                boxShadow: masarState === 'listening' ? '0 0 0 3px rgba(245,158,11,0.2)'
                         : masarState === 'speaking'  ? '0 0 0 3px rgba(34,197,94,0.2)'
                         : 'none',
                transition: 'all var(--duration-base)',
              }} />
              <span className="mono-sm" style={{
                color: masarState === 'speaking'  ? 'var(--masar-signal)'
                     : masarState === 'listening' ? 'var(--masar-amber)'
                     : masarState === 'thinking'  ? 'var(--masar-cyan)'
                     : 'var(--masar-muted)',
              }}>
                {masarState === 'speaking'  ? 'Speaking'
               : masarState === 'listening' ? 'Listening'
               : masarState === 'thinking'  ? 'Thinking'
               : callActive                 ? 'Standby'
               : 'Idle'}
              </span>
            </div>
            {/* Active service badge */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.35rem',
              background: 'var(--masar-elevated)', border: '1px solid var(--masar-border)',
              borderRadius: '999px', padding: '0.2rem 0.65rem',
            }}>
              <span style={{ fontSize: '0.75rem', color: service.accent }}>{service.icon}</span>
              <span className="mono-sm" style={{ color: service.accent }}>{service.label}</span>
            </div>
          </div>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'var(--masar-elevated)', border: '1px solid var(--masar-border-mid)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', fontFamily: 'var(--font-display)',
            fontWeight: 600, fontSize: '0.8125rem', color: 'var(--masar-amber)',
          }}>A</div>
        </div>

        {/* ── Scrollable conversation feed ── */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.5rem',
          position: 'relative',
        }}>
          <div className="grid-bg" style={{ opacity: 0.12, pointerEvents: 'none' }} />

          {/* Empty state */}
          {turns.length === 0 && (
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              color: 'var(--masar-muted)', gap: '0.5rem',
              minHeight: '200px',
            }}>
              <span style={{ fontSize: '2rem', opacity: 0.3 }}>📞</span>
              <span className="mono-sm" style={{ fontFamily: 'Cairo, sans-serif' }}>
                {callActive ? 'جارٍ الاستماع…' : 'ابدأ المكالمة للتحدث مع مسار'}
              </span>
            </div>
          )}

          {/* Turn blocks */}
          {turns.map(turn => (
            <TurnBlock
              key={turn.id}
              turn={turn}
              error={error}
              isGeneral={isGeneral}
              masarResponse={masarResponses[turn.id]}
              isStreaming={!!streamingIds[turn.id]}
              solution={solutions[turn.id]}
              isSolving={!!solvingIds[turn.id]}
              ttsState={ttsStates[turn.id] ?? 'idle'}
              onPlay={() => playTTS(turn.id, solutions[turn.id])}
              onStop={() => stopTTS(turn.id)}
              onReplay={() => replayTTS(turn.id, solutions[turn.id])}
            />
          ))}

          <div ref={feedEndRef} />
        </div>

        {/* ── Fixed bottom controls ── */}
        <div style={{
          flexShrink: 0,
          borderTop: '1px solid var(--masar-border)',
          background: 'var(--masar-deep)',
          padding: '1rem 1.5rem',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0.875rem',
        }}>
          {/* MASAR State Indicator */}
          <MasarStateIndicator state={masarState} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '1.75rem' }}>

            {/* ── Call button ── */}
            <div style={{ position: 'relative', width: 88, height: 88, flexShrink: 0 }}>
              {/* Ripple rings — while listening */}
              {isRecording && [0, 1, 2].map(i => (
                <span key={i} className="mic-ripple" style={{ animationDelay: `${i * 0.7}s` }} />
              ))}

              <button
                ref={micBtnRef}
                onClick={callActive ? endCall : startCall}
                disabled={callBusy}
                className={isRecording && !isSpeaking ? 'mic-btn-listening' : ''}
                style={{
                  position: 'relative',
                  width: 88, height: 88, borderRadius: '50%',
                  border: callActive
                    ? '2px solid rgba(239,68,68,0.7)'
                    : '2px solid var(--masar-amber-line)',
                  background: callActive
                    ? 'rgba(239,68,68,0.13)'
                    : 'var(--masar-amber-glow)',
                  cursor: callBusy ? 'not-allowed' : 'pointer',
                  opacity: callBusy ? 0.45 : 1,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'border-color 300ms ease, background 300ms ease, opacity 300ms ease',
                  zIndex: 1,
                }}
              >
                {callActive ? (
                  <span style={{
                    fontSize: '1.75rem',
                    display: 'inline-block',
                    transform: 'rotate(135deg)',
                    lineHeight: 1,
                    filter: 'grayscale(1) brightness(1.8)',
                  }}>
                    📞
                  </span>
                ) : (
                  <span style={{ fontSize: '1.8rem', lineHeight: 1 }}>🎙</span>
                )}
              </button>
            </div>

            {/* Right-side controls stacked vertically */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>

              {/* Tech level selector */}
              <div style={{
                display: 'flex', background: 'var(--masar-surface)',
                border: '1px solid var(--masar-border)', borderRadius: '999px',
                padding: '3px', gap: '2px',
              }}>
                {TECH_LEVELS.map(level => (
                  <button key={level} onClick={() => setTechLevel(level)} className="mono-sm"
                    style={{
                      background: techLevel === level ? 'var(--masar-amber)' : 'transparent',
                      border: 'none', color: techLevel === level ? '#080C14' : 'var(--masar-muted)',
                      padding: '0.375rem 0.875rem', borderRadius: '999px', cursor: 'pointer',
                      fontWeight: techLevel === level ? 600 : 400, transition: 'all var(--duration-base)',
                    }}
                  >
                    {level}
                  </button>
                ))}
              </div>

              {/* VAD sensitivity selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="mono-sm" style={{ color: 'var(--masar-muted)', fontSize: '0.6875rem', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  VAD
                </span>
                <div style={{
                  display: 'flex', background: 'var(--masar-surface)',
                  border: '1px solid var(--masar-border)', borderRadius: '999px',
                  padding: '2px', gap: '1px',
                }}>
                  {['low', 'medium', 'high'].map(level => (
                    <button key={level} onClick={() => setVadSensitivity(level)} className="mono-sm"
                      style={{
                        background: vadSensitivity === level ? 'rgba(245,158,11,0.15)' : 'transparent',
                        border: vadSensitivity === level ? '1px solid rgba(245,158,11,0.35)' : '1px solid transparent',
                        color: vadSensitivity === level ? 'var(--masar-amber)' : 'var(--masar-muted)',
                        padding: '0.25rem 0.625rem', borderRadius: '999px', cursor: 'pointer',
                        fontSize: '0.6875rem', fontWeight: vadSensitivity === level ? 600 : 400,
                        transition: 'all var(--duration-base)', textTransform: 'capitalize',
                      }}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>

            </div>
          </div>

          {/* Call label + end session */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
            <span className="mono-sm" style={{
              color: callActive ? 'var(--masar-danger)' : 'var(--masar-muted)',
              fontSize: '0.6875rem', letterSpacing: '0.08em', textTransform: 'uppercase',
              transition: 'color 300ms',
            }}>
              {callActive ? '● Call Active' : 'Press mic to start call'}
            </span>
            <button onClick={endSession} className="mono-sm"
              style={{ background: 'transparent', border: 'none', color: 'var(--masar-muted)', cursor: 'pointer', transition: 'color var(--duration-fast)' }}
              onMouseEnter={e => e.target.style.color = '#E2E8F0'}
              onMouseLeave={e => e.target.style.color = 'var(--masar-muted)'}
            >
              End session & view summary →
            </button>
          </div>

        </div>

      </main>
    </div>
  );
}

/* ══ Layer 3: Refinement streaming ════════════════════════════════════════ */

async function streamRefine(turnId, text, techLevel, serviceId, setMasarResponses, setStreamingIds) {
  setMasarResponses(prev => ({ ...prev, [turnId]: '' }));
  setStreamingIds(prev => ({ ...prev, [turnId]: true }));

  try {
    const res = await fetch(`${import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'}/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, tech_level: techLevel, service_id: serviceId }),
    });

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const raw = decoder.decode(value, { stream: true });
      for (const line of raw.split('\n')) {
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
    const res = await fetch(`${import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'}/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refined_prompt: refinedPrompt, tech_level: techLevel, service_id: serviceId, response_language: 'arabic' }),
    });

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const raw = decoder.decode(value, { stream: true });
      for (const line of raw.split('\n')) {
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

const WAVEFORM_DELAYS = [0, 140, 80, 220, 40];

function TurnBlock({ turn, error, isGeneral, masarResponse, isStreaming, solution, isSolving,
                     ttsState = 'idle', onPlay, onStop, onReplay }) {
  const displayText = turn.isActive
    ? [turn.text, turn.partial].filter(Boolean).join(' ')
    : turn.text;

  const isEmpty = !displayText;

  const layer3Label  = isGeneral ? 'Masar (Cleaned)'   : 'Masar';
  const layer4Label  = isGeneral ? 'Response'          : 'Network Solution';
  const layer4Color  = isGeneral ? 'var(--masar-cyan)' : 'var(--masar-success)';
  const layer4Border = isGeneral ? 'var(--masar-cyan)' : 'var(--masar-success)';

  return (
    <div style={{ width: '100%', maxWidth: '680px', margin: '0 auto' }}>

      <p className="mono-sm" style={{
        color: 'var(--masar-amber)', marginBottom: '0.5rem',
        letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: '0.6875rem',
      }}>
        User Speech
      </p>

      <div style={{
        background: 'var(--masar-surface)',
        border: '1px solid var(--masar-border)',
        borderLeft: '3px solid var(--masar-amber)',
        borderRadius: 'var(--radius-md)',
        padding: '0.75rem 1rem',
        minHeight: '3.5rem',
        display: 'flex',
        alignItems: isEmpty ? 'center' : 'flex-start',
        justifyContent: isEmpty ? 'center' : 'space-between',
        gap: '0.75rem',
        fontFamily: 'Cairo, sans-serif',
      }}>
        {isEmpty ? (
          <span style={{ color: 'var(--masar-muted)', fontStyle: 'italic', fontSize: '0.9rem' }}>
            {turn.isActive ? 'جارٍ الاستماع…' : 'لم يتم تسجيل أي كلام'}
          </span>
        ) : (
          <>
            <span style={{
              fontFamily: 'Cairo, sans-serif',
              fontSize: '0.9375rem',
              color: turn.isActive ? 'rgba(226,232,240,0.75)' : '#E2E8F0',
              direction: 'rtl',
              flex: 1,
              lineHeight: 1.7,
              transition: 'color 0.3s',
            }}>
              {error && turn.isActive ? error : displayText}
            </span>
            {!turn.isActive && turn.time && (
              <span className="mono-sm" style={{
                color: 'var(--masar-muted)', whiteSpace: 'nowrap',
                paddingTop: '0.25rem', flexShrink: 0,
              }}>
                {turn.time}
              </span>
            )}
          </>
        )}
      </div>

      {/* Layer 3 output */}
      {!turn.isActive && (
        <div style={{
          background: 'var(--masar-surface)',
          border: '1px solid var(--masar-border)',
          borderLeft: '3px solid var(--masar-cyan)',
          borderRadius: 'var(--radius-md)',
          padding: '0.75rem 1rem',
          marginTop: '0.5rem',
          minHeight: '2.75rem',
        }}>
          <span className="mono-sm" style={{ color: 'var(--masar-cyan)', marginRight: '0.75rem' }}>
            {layer3Label}
          </span>
          {masarResponse === undefined ? (
            <span style={{ fontSize: '0.9375rem', color: 'var(--masar-muted)', fontStyle: 'italic' }}>
              [ Agent response will appear here ]
            </span>
          ) : masarResponse === '' ? (
            <span className="thinking-dots" style={{ fontSize: '0.9375rem', color: 'var(--masar-cyan)', opacity: 0.6 }}>
              Thinking
            </span>
          ) : (
            <span style={{ fontSize: '0.9375rem', color: '#E2E8F0', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {masarResponse}
              {isStreaming && <span className="stream-cursor">▌</span>}
            </span>
          )}
        </div>
      )}

      {/* Layer 4 output */}
      {!turn.isActive && solution !== undefined && (
        <div style={{
          background: 'var(--masar-surface)',
          border: '1px solid var(--masar-border)',
          borderLeft: `3px solid ${layer4Border}`,
          borderRadius: 'var(--radius-md)',
          padding: '0.75rem 1rem',
          marginTop: '0.5rem',
          minHeight: '2.75rem',
        }}>
          <span className="mono-sm" style={{ color: layer4Color, marginRight: '0.75rem' }}>
            {layer4Label}
          </span>
          {solution === '' ? (
            <span className="thinking-dots" style={{ fontSize: '0.9375rem', color: layer4Color, opacity: 0.6 }}>
              Thinking
            </span>
          ) : (
            <>
              <span style={{ fontSize: '0.9375rem', color: '#E2E8F0', lineHeight: 1.7, whiteSpace: 'pre-wrap', display: 'block', marginTop: '0.25rem' }}>
                {solution}
                {isSolving && <span className="stream-cursor" style={{ color: layer4Color }}>▌</span>}
              </span>

              {/* Speaker controls */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                marginTop: '0.875rem',
                paddingTop: '0.625rem',
                borderTop: '1px solid var(--masar-border)',
                opacity: isSolving ? 0.35 : 1,
                transition: 'opacity 300ms',
                pointerEvents: isSolving ? 'none' : 'auto',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: 16 }}>
                  {WAVEFORM_DELAYS.map((delay, i) => (
                    <span
                      key={i}
                      className={`waveform-bar${ttsState === 'playing' ? ' waveform-bar-active' : ''}`}
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </div>

                <div style={{ flex: 1 }} />

                <button
                  onClick={() => ttsState === 'playing' ? onStop() : onPlay()}
                  className="mono-sm"
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.35rem',
                    background: ttsState === 'playing' ? 'rgba(34,211,238,0.1)' : 'transparent',
                    border: `1px solid ${ttsState === 'playing' ? 'rgba(34,211,238,0.4)' : 'var(--masar-border)'}`,
                    color: ttsState === 'loading' ? 'var(--masar-muted)' : 'var(--masar-cyan)',
                    padding: '0.3rem 0.75rem',
                    borderRadius: 'var(--radius-md)',
                    cursor: ttsState === 'loading' ? 'wait' : 'pointer',
                    transition: 'background 200ms, border-color 200ms, color 200ms',
                  }}
                  onMouseEnter={e => { if (ttsState === 'idle') e.currentTarget.style.borderColor = 'rgba(34,211,238,0.35)'; }}
                  onMouseLeave={e => { if (ttsState === 'idle') e.currentTarget.style.borderColor = 'var(--masar-border)'; }}
                >
                  <span>{ttsState === 'loading' ? '…' : ttsState === 'playing' ? '⏹' : '🔊'}</span>
                  <span>{ttsState === 'loading' ? 'Loading…' : ttsState === 'playing' ? 'Stop' : 'Play Response'}</span>
                </button>

                <button
                  onClick={onReplay}
                  title="Replay"
                  disabled={ttsState !== 'idle'}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'transparent',
                    border: '1px solid var(--masar-border)',
                    color: ttsState !== 'idle' ? 'var(--masar-muted)' : 'var(--masar-cyan)',
                    width: 30, height: 30,
                    borderRadius: 'var(--radius-md)',
                    cursor: ttsState !== 'idle' ? 'not-allowed' : 'pointer',
                    fontSize: '0.875rem',
                    opacity: ttsState !== 'idle' ? 0.35 : 1,
                    transition: 'opacity 200ms, border-color 200ms',
                  }}
                  onMouseEnter={e => { if (ttsState === 'idle') e.currentTarget.style.borderColor = 'rgba(34,211,238,0.35)'; }}
                  onMouseLeave={e => { if (ttsState === 'idle') e.currentTarget.style.borderColor = 'var(--masar-border)'; }}
                >
                  🔁
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}


/* ══ MASAR State Indicator ════════════════════════════════════════════════ */

const STATE_CONFIG = {
  idle: {
    color: 'var(--masar-muted)', border: 'var(--masar-border)', bg: 'transparent',
    dot: 'var(--masar-muted)', dotClass: '', icon: '◎', label: 'Idle',
  },
  listening: {
    color: 'var(--masar-amber)', border: 'rgba(245,158,11,0.4)', bg: 'rgba(245,158,11,0.06)',
    dot: 'var(--masar-amber)', dotClass: 'state-dot-listening', icon: '🎙', label: 'Listening',
  },
  thinking: {
    color: 'var(--masar-cyan)', border: 'rgba(34,211,238,0.4)', bg: 'rgba(34,211,238,0.06)',
    dot: 'var(--masar-cyan)', dotClass: 'state-dot-thinking', icon: '⚙', label: 'Thinking',
  },
  speaking: {
    color: 'var(--masar-signal)', border: 'rgba(34,197,94,0.4)', bg: 'rgba(34,197,94,0.06)',
    dot: 'var(--masar-signal)', dotClass: 'state-dot-speaking', icon: '🔊', label: 'Speaking',
  },
};

function MasarStateIndicator({ state }) {
  const cfg = STATE_CONFIG[state] ?? STATE_CONFIG.idle;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: '0.625rem', padding: '0.5rem 1.5rem', borderRadius: '999px',
      border: `1px solid ${cfg.border}`, background: cfg.bg,
      transition: 'border-color 400ms ease, background 400ms ease',
      minWidth: '180px',
    }}>
      <span className={cfg.dotClass} style={{
        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
        background: cfg.dot, flexShrink: 0, transition: 'background 400ms ease',
      }} />
      <span style={{ fontSize: '0.875rem', lineHeight: 1, filter: state === 'idle' ? 'grayscale(1) opacity(0.4)' : 'none', transition: 'filter 400ms ease' }}>
        {cfg.icon}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: cfg.color, transition: 'color 400ms ease' }}>
        {cfg.label}
      </span>
    </div>
  );
}

function SidebarIconBtn({ children, onClick, title }) {
  return (
    <button onClick={onClick} title={title} style={{
      background: 'transparent', border: '1px solid var(--masar-border)',
      borderRadius: 'var(--radius-sm)', color: 'var(--masar-muted)',
      width: 28, height: 28, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '0.875rem', transition: 'color var(--duration-fast)',
    }}>
      {children}
    </button>
  );
}

function SidebarRow({ icon, label }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.625rem',
      padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-md)',
      cursor: 'pointer', transition: 'background var(--duration-fast)',
    }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--masar-elevated)'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <span style={{ fontSize: '0.875rem' }}>{icon}</span>
      <span style={{ fontSize: '0.8125rem', color: 'var(--masar-muted)' }}>{label}</span>
    </div>
  );
}
