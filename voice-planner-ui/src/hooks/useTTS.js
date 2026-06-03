import { useState, useRef } from 'react';

/*
 * useTTS — ElevenLabs Text-to-Speech hook (Layer 5)
 *
 * Primary path  (Chrome/Edge): MediaSource streaming via /tts-stream
 *   Audio starts playing after the first chunk arrives (~1-2 s).
 *   Remaining chunks are appended to the SourceBuffer while playback runs.
 *
 * Fallback path (Firefox/Safari or any MS error): blob fetch via /tts
 *   Full response buffered before playback, same as original behaviour.
 *
 * ttsStates: { [turnId]: 'idle' | 'loading' | 'playing' }
 * isSpeaking — true whenever any turn is loading or playing.
 */

const API_BASE   = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000';
const TTS_URL    = `${API_BASE}/tts`;
const TTS_STREAM = `${API_BASE}/tts-stream`;
const MS_MIME    = 'audio/mpeg';
const USE_MS     = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(MS_MIME);

export function useTTS() {
  const [ttsStates, setTtsStates] = useState({});
  const audioRef  = useRef(null);   // currently playing HTMLAudioElement
  const activeRef = useRef(null);   // turnId of the active audio
  const abortRef  = useRef(null);   // AbortController for in-flight fetch

  function _setTts(id, state) {
    setTtsStates(prev => ({ ...prev, [id]: state }));
  }

  function _stopCurrent() {
    abortRef.current?.abort();
    abortRef.current = null;
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
    console.log('[useTTS] play() called — turnId:', turnId, 'textLen:', text?.length);
    _stopCurrent();
    _setTts(turnId, 'loading');
    activeRef.current = turnId;

    if (USE_MS) {
      await _playStream(turnId, text);
    } else {
      await _playBlob(turnId, text);
    }
  }

  // ── MediaSource streaming path ────────────────────────────────────────────

  async function _playStream(turnId, text) {
    const controller = new AbortController();
    abortRef.current = controller;

    const mediaSource = new MediaSource();
    const msUrl       = URL.createObjectURL(mediaSource);
    const audio       = new Audio();
    audioRef.current  = audio;

    function cleanup() {
      URL.revokeObjectURL(msUrl);
      if (audioRef.current === audio) audioRef.current = null;
    }

    audio.onended = () => {
      cleanup();
      activeRef.current = null;
      _setTts(turnId, 'idle');
    };

    audio.onerror = () => {
      cleanup();
      if (activeRef.current === turnId) {
        activeRef.current = null;
        _setTts(turnId, 'idle');
      }
    };

    try {
      // Setting src triggers the sourceopen event
      audio.src = msUrl;

      await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('sourceopen timeout')), 5000);
        mediaSource.addEventListener('sourceopen', () => { clearTimeout(t); resolve(); }, { once: true });
      });

      const sourceBuffer = mediaSource.addSourceBuffer(MS_MIME);
      const queue        = [];     // Uint8Array chunks + null end-sentinel
      let isAppending    = false;
      let playStarted    = false;

      function drainQueue() {
        if (isAppending || queue.length === 0) return;
        const item = queue.shift();

        if (item === null) {
          // End-of-stream sentinel
          if (mediaSource.readyState === 'open') {
            try { mediaSource.endOfStream(); } catch (_) {}
          }
          return;
        }

        isAppending = true;
        try {
          sourceBuffer.appendBuffer(item);
        } catch (e) {
          isAppending = false;
          console.error('[useTTS] appendBuffer error:', e);
          if (mediaSource.readyState === 'open') {
            try { mediaSource.endOfStream('decode-error'); } catch (_) {}
          }
        }
      }

      sourceBuffer.addEventListener('updateend', () => {
        isAppending = false;

        // Start playback as soon as the first chunk is buffered
        if (!playStarted) {
          playStarted = true;
          _setTts(turnId, 'playing');
          audio.play().catch(e => console.warn('[useTTS] play() rejected:', e));
        }

        drainQueue();
      });

      // Fetch the chunked stream — runs in parallel with the drain loop above
      const res = await fetch(TTS_STREAM, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(res.headers.get('X-TTS-Error') ?? `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            queue.push(null);   // signal end-of-stream to drain loop
            drainQueue();
            break;
          }
          queue.push(value);
          drainQueue();
        }
      } finally {
        reader.releaseLock();
      }

    } catch (err) {
      if (err.name === 'AbortError') return;   // clean stop, nothing to do
      console.warn('[useTTS] MediaSource path failed, falling back to blob:', err.message);
      cleanup();
      if (activeRef.current === turnId) {
        await _playBlob(turnId, text);
      }
    }
  }

  // ── Blob fallback path ────────────────────────────────────────────────────

  async function _playBlob(turnId, text) {
    const controller = new AbortController();
    abortRef.current = controller;
    let url = null;

    try {
      const res = await fetch(TTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errHeader = res.headers.get('X-TTS-Error') ?? `HTTP ${res.status}`;
        console.warn('[useTTS] TTS blob failed:', errHeader);
        _setTts(turnId, 'idle');
        activeRef.current = null;
        return;
      }

      const blob  = await res.blob();
      url = URL.createObjectURL(blob);
      const audio = new Audio();
      audio.src = url;
      audio.load();
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

      await new Promise(resolve => setTimeout(resolve, 150));
      _setTts(turnId, 'playing');
      await audio.play();
    } catch (err) {
      if (err.name === 'AbortError') { if (url) URL.revokeObjectURL(url); return; }
      console.error('[useTTS] Blob fallback error:', err);
      _setTts(turnId, 'idle');
      activeRef.current = null;
    }
  }

  function stop(id) {
    if (id === undefined) { _stopCurrent(); return; }
    if (activeRef.current === id) _stopCurrent();
  }

  function replay(id, text) {
    play(id, text);
  }

  const isSpeaking = Object.values(ttsStates).some(
    s => s === 'loading' || s === 'playing'
  );

  return { ttsStates, play, stop, replay, isSpeaking, audioRef };
}
