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

const BACKEND_WS    = `${import.meta.env.VITE_WS_BASE ?? 'ws://localhost:8002'}/ws/audio`;
const VAD_THRESHOLD = 18;   // 0–255 — raise if background noise triggers false positives
const VAD_SMOOTHING = 0.6;  // AnalyserNode smoothingTimeConstant
const LEVEL_MAX     = 70;   // amplitude considered "loud speech" — normalises to 1.0

export function useAudioStream() {
  const [turns, setTurns]             = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking]   = useState(false);
  const [error, setError]             = useState(null);

  // Mutable ref read by the component's rAF loop — no re-renders per frame
  const audioLevelRef = useRef(0); // 0.0 – 1.0, normalised amplitude

  const wsRef           = useRef(null);
  const audioCtxRef     = useRef(null);
  const workletRef      = useRef(null);
  const analyserRef     = useRef(null);
  const rafRef          = useRef(null);
  const streamRef       = useRef(null);
  const activeTurnIdRef = useRef(null);

  const startRecording = useCallback(async () => {
    setError(null);
    const turnId = Date.now();

    setTurns(prev => [...prev, { id: turnId, text: '', partial: '', time: '', isActive: true }]);
    activeTurnIdRef.current = turnId;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      if (audioCtx.state === 'suspended') await audioCtx.resume();
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

      // ── Voice Activity Detection ──────────────────────────────────────
      // AnalyserNode reads frequency energy on every animation frame.
      // When average amplitude crosses VAD_THRESHOLD, isSpeaking flips true.
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = VAD_SMOOTHING;
      analyserRef.current = analyser;
      const vadBuffer = new Uint8Array(analyser.frequencyBinCount);

      const detectVoice = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(vadBuffer);
        const avg = vadBuffer.reduce((sum, v) => sum + v, 0) / vadBuffer.length;
        // Normalise to 0–1: below threshold = 0, LEVEL_MAX and above = 1
        audioLevelRef.current = Math.min(1, Math.max(0, (avg - VAD_THRESHOLD) / LEVEL_MAX));
        setIsSpeaking(avg > VAD_THRESHOLD);
        rafRef.current = requestAnimationFrame(detectVoice);
      };
      rafRef.current = requestAnimationFrame(detectVoice);

      // Connect: mic → analyser (VAD) + worklet (PCM stream) → destination
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      source.connect(workletNode);
      workletNode.connect(audioCtx.destination);

      setIsRecording(true);
    } catch (err) {
      setError(err.message || 'Failed to start recording');
      setTurns(prev => prev.filter(t => t.id !== turnId));
      activeTurnIdRef.current = null;
      streamRef.current?.getTracks().forEach(t => t.stop());
      audioCtxRef.current?.close();
    }
  }, []);

  const stopRecording = useCallback(() => {
    // Stop VAD loop and reset level
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    analyserRef.current   = null;
    audioLevelRef.current = 0;
    setIsSpeaking(false);

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
    audioCtxRef.current?.close();
    streamRef.current?.getTracks().forEach(t => t.stop());
    wsRef.current?.close();

    workletRef.current  = null;
    audioCtxRef.current = null;
    streamRef.current   = null;
    wsRef.current       = null;

    setIsRecording(false);
  }, []);

  const clearTurns = useCallback(() => setTurns([]), []);

  return { turns, isRecording, isSpeaking, audioLevelRef, error, startRecording, stopRecording, clearTurns };
}
