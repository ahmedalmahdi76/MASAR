import { useState, useRef } from 'react';

/*
 * useTTS — ElevenLabs Text-to-Speech hook (Layer 5)
 *
 * ttsStates: { [turnId]: 'idle' | 'loading' | 'playing' }
 *   idle    — no audio for this turn
 *   loading — fetching audio from /tts (ElevenLabs API call in progress)
 *   playing — HTMLAudioElement is playing
 *
 * isSpeaking — true whenever any turn is loading or playing;
 *              drives the MASAR state indicator's "Speaking" state.
 */

const API_BASE = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000';
const TTS_URL  = `${API_BASE}/tts`;

export function useTTS() {
  const [ttsStates, setTtsStates] = useState({});
  const audioRef   = useRef(null);   // currently playing HTMLAudioElement
  const activeRef  = useRef(null);   // turnId of the active audio

  // ── internal helpers ──────────────────────────────────────────────────────

  function _setTts(turnId, state) {
    setTtsStates(prev => ({ ...prev, [turnId]: state }));
  }

  function _stopCurrent() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    if (activeRef.current !== null) {
      _setTts(activeRef.current, 'idle');
      activeRef.current = null;
    }
  }

  // ── public API ────────────────────────────────────────────────────────────

  async function play(turnId, text) {
    // Stop whatever is currently playing
    _stopCurrent();

    _setTts(turnId, 'loading');
    activeRef.current = turnId;

    try {
      const res = await fetch(TTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      // Surface ElevenLabs errors gracefully
      if (!res.ok) {
        const errHeader = res.headers.get('X-TTS-Error') ?? `HTTP ${res.status}`;
        console.warn('[useTTS] TTS failed:', errHeader);
        _setTts(turnId, 'idle');
        activeRef.current = null;
        return;
      }

      const blob  = await res.blob();
      const url   = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        audioRef.current  = null;
        activeRef.current = null;
        _setTts(turnId, 'idle');
      };

      audio.onerror = () => {
        URL.revokeObjectURL(url);
        audioRef.current  = null;
        activeRef.current = null;
        _setTts(turnId, 'idle');
      };

      _setTts(turnId, 'playing');
      await audio.play();
    } catch (err) {
      console.error('[useTTS] Network error:', err);
      _setTts(turnId, 'idle');
      activeRef.current = null;
    }
  }

  function stop(turnId) {
    if (activeRef.current === turnId) {
      _stopCurrent();
    }
  }

  function replay(turnId, text) {
    // Re-triggers the same pipeline — identical to play()
    play(turnId, text);
  }

  // True whenever any turn is loading or playing — used by Workspace to set masarSpeaking
  const isSpeaking = Object.values(ttsStates).some(
    s => s === 'loading' || s === 'playing'
  );

  return { ttsStates, play, stop, replay, isSpeaking, audioRef };
}
