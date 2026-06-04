/**
 * useAudioStream — Layer 1 + 2 hook
 *
 * Each mic session (start → stop) = one turn with a single accumulated utterance.
 * Final transcript chunks are silently joined into turn.text.
 * turn.partial shows the live interim text while speaking.
 * Timestamp is captured at mic-off (when the utterance is complete).
 *
 * Turn shape: { id: number, text: string, partial: string, time: string, isActive: bool }
 *
 * Returns:
 *   turns            — array of all turns (active + closed)
 *   isRecording      — whether the mic is currently active
 *   isSpeaking       — true only when voice is detected above noise threshold
 *   error            — last error string, or null
 *   startRecording() — opens a new turn and begins streaming
 *   stopRecording()  — closes the active turn with a timestamp
 *   clearTurns()     — reset all turns (New Session)
 */

import { useState, useRef, useCallback } from 'react';

const API_BASE   = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000';
const BACKEND_WS = `${API_BASE.replace(/^http/, 'ws')}/ws/audio`;
const VAD_THRESHOLD = 0.015; // RMS threshold for isSpeaking
const VAD_SMOOTHING = 0.6;   // AnalyserNode smoothingTimeConstant
const LEVEL_MAX     = 0.3;   // RMS considered loud speech — normalises to 1.0

export function useAudioStream() {
  const [turns, setTurns]             = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking]   = useState(false);
  const [error, setError]             = useState(null);

  // Mutable ref read by the component's rAF loop — no re-renders per frame
  const audioLevelRef = useRef(0); // 0.0 – 1.0, normalised amplitude

  const wsRef                = useRef(null);
  const audioCtxRef          = useRef(null);
  const workletRef           = useRef(null);
  const analyserRef          = useRef(null);
  const rafRef               = useRef(null);
  const streamRef            = useRef(null);
  const activeTurnIdRef      = useRef(null);
  const stateChangeHandlerRef = useRef(null);

  const startRecording = useCallback(async () => {
    if (isRecording) return;
    setError(null);
    const turnId = Date.now();

    setTurns(prev => [...prev, { id: turnId, text: '', partial: '', time: '', isActive: true }]);
    activeTurnIdRef.current = turnId;

    // Detect whether the monitoring pipeline (AudioContext + stream + analyser + rAF)
    // is already alive from the previous turn. If so, reuse it — don't open a second
    // getUserMedia or create a second AudioContext, which would cause NotReadableError.
    const pipelineAlive = audioCtxRef.current && audioCtxRef.current.state !== 'closed';

    try {
      if (!pipelineAlive) {
        // ── Cold start: build the full monitoring pipeline ──────────────
        await new Promise(resolve => setTimeout(resolve, 200));
        let stream;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await new Promise(r => setTimeout(r, 200 * attempt));
            stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            break;
          } catch (e) {
            if (e.name === 'NotReadableError' && attempt < 2) {
              console.warn('[mic] NotReadableError attempt', attempt + 1, '— retrying...');
              continue;
            }
            throw e;
          }
        }
        streamRef.current = stream;

        const audioCtx = new AudioContext();
        audioCtxRef.current = audioCtx;
        const stateChangeHandler = () => {
          if (audioCtx.state === 'suspended' && analyserRef.current) {
            audioCtx.resume().catch(() => {});
          }
        };
        stateChangeHandlerRef.current = stateChangeHandler;
        audioCtx.addEventListener('statechange', stateChangeHandler);

        // ── Voice Activity Detection ──────────────────────────────────────
        // AnalyserNode is placed IN-SERIES (source → analyser → worklet → destination)
        // so Chrome's audio graph optimizer keeps it active. A dead-end analyser
        // branch gets skipped and always returns zero.
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = VAD_SMOOTHING;
        analyserRef.current = analyser;
        const timeDomainBuffer = new Uint8Array(analyser.fftSize);

        const detectVoice = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteTimeDomainData(timeDomainBuffer);
          let sumSq = 0;
          for (let i = 0; i < timeDomainBuffer.length; i++) {
            const s = (timeDomainBuffer[i] - 128) / 128;
            sumSq += s * s;
          }
          const rms = Math.sqrt(sumSq / timeDomainBuffer.length);
          audioLevelRef.current = Math.min(1, rms / LEVEL_MAX);
          setIsSpeaking(rms > VAD_THRESHOLD);
          rafRef.current = requestAnimationFrame(detectVoice);
        };
        rafRef.current = requestAnimationFrame(detectVoice);

        if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }
      } else {
        console.log('[useAudioStream] reusing monitoring pipeline for new turn');
      }

      // ── Per-turn: WebSocket + worklet (always fresh each turn) ──────────
      const audioCtx   = audioCtxRef.current;
      const analyser   = analyserRef.current;
      const sampleRate = audioCtx.sampleRate;

      const ws = new WebSocket(`${BACKEND_WS}?sample_rate=${sampleRate}`);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        const tid = activeTurnIdRef.current;
        if (!tid || msg.type !== 'transcript') return;

        if (msg.is_final) {
          setTurns(prev => prev.map(t =>
            t.id === tid
              ? { ...t, text: t.text ? `${t.text} ${msg.text}` : msg.text, partial: '' }
              : t
          ));
        } else {
          setTurns(prev => prev.map(t =>
            t.id === tid ? { ...t, partial: msg.text } : t
          ));
        }
      };

      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = (e) => {
          setError('WebSocket error — is the backend running?');
          reject(e);
        };
      });

      await audioCtx.audioWorklet.addModule('/audio-processor.js');
      const workletNode = new AudioWorkletNode(audioCtx, 'pcm-processor');
      workletRef.current = workletNode;

      workletNode.port.onmessage = (e) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(e.data);
      };

      // Correct order: source → analyser (in-path) → workletNode → silentGain → destination
      // GainNode at 0 gives Chrome a real output path (prevents auto-suspend) with no audible echo
      const source = audioCtx.createMediaStreamSource(streamRef.current);
      const silentGain = audioCtx.createGain();
      silentGain.gain.value = 0.001;
      source.connect(analyser);
      analyser.connect(workletNode);
      workletNode.connect(silentGain);
      silentGain.connect(audioCtx.destination);

      setIsRecording(true);
    } catch (err) {
      console.error('[useAudioStream] startRecording failed:', err);
      setError(err.message || 'Failed to start recording');
      setTurns(prev => prev.filter(t => t.id !== turnId));
      activeTurnIdRef.current = null;
      wsRef.current?.close();
      wsRef.current = null;
      if (!pipelineAlive) {
        streamRef.current?.getTracks().forEach(t => t.stop());
        if (audioCtxRef.current?.state !== 'closed') audioCtxRef.current?.close();
        audioCtxRef.current = null;
      }
    }
  }, [isRecording]);

  // Layer 1 — stop sending PCM / close WS / close worklet for this turn.
  // Leaves AudioContext, stream, analyser, and rAF loop alive so audioLevelRef
  // keeps updating during TTS (barge-in reads it).
  const stopSending = useCallback(() => {
    const tid = activeTurnIdRef.current;
    if (tid) {
      const time = new Date().toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
      setTurns(prev => prev
        .map(t => t.id === tid ? { ...t, isActive: false, partial: '', time } : t)
        .filter(t => !(t.id === tid && !t.text))
      );
      activeTurnIdRef.current = null;
    }

    workletRef.current?.disconnect();
    workletRef.current?.port.close();
    workletRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;

    setIsRecording(false);
  }, []);

  // Layer 2 — tear down the full monitoring pipeline (AudioContext + stream + analyser + rAF).
  // Call this when the call fully ends (callActive → false), not between turns.
  const stopMonitoring = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    analyserRef.current   = null;
    audioLevelRef.current = 0;
    setIsSpeaking(false);

    if (stateChangeHandlerRef.current) {
      audioCtxRef.current?.removeEventListener('statechange', stateChangeHandlerRef.current);
      stateChangeHandlerRef.current = null;
    }
    audioCtxRef.current?.close().catch(() => {});
    streamRef.current?.getTracks().forEach(t => t.stop());
    audioCtxRef.current = null;
    streamRef.current   = null;
  }, []);

  // stopRecording = Layer 1 only. Monitoring stays alive between turns for barge-in.
  const stopRecording = useCallback(() => {
    stopSending();
  }, [stopSending]);

  const clearTurns = useCallback(() => setTurns([]), []);
  const removeTurn = useCallback((id) => setTurns(prev => prev.filter(t => t.id !== id)), []);

  return { turns, isRecording, isSpeaking, audioLevelRef, error, startRecording, stopRecording, stopMonitoring, clearTurns, removeTurn };
}
