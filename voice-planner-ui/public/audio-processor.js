/**
 * Masar PCM Processor — AudioWorklet
 *
 * Runs on the dedicated audio rendering thread (not the main JS thread).
 * Receives Float32 audio frames from the mic, converts to Int16 PCM,
 * and posts the buffer back to the main thread for WebSocket transmission.
 *
 * Buffer size: 128 frames per process() call (Web Audio API standard).
 * At 48000 Hz → ~2.67ms per chunk — lower latency than ScriptProcessorNode.
 */

class PcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    const int16 = new Int16Array(channel.length);
    for (let i = 0; i < channel.length; i++) {
      const s = Math.max(-1, Math.min(1, channel[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    // Transfer the buffer (zero-copy) to the main thread
    this.port.postMessage(int16.buffer, [int16.buffer]);
    return true; // returning false would stop the processor
  }
}

registerProcessor('pcm-processor', PcmProcessor);
