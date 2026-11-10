/**
 * .agents/scripts/scdaw-recorder.js
 *
 * Audio recording pipeline and waveform peak computation for ShadowClaw DAW.
 * Ports OpenStudio's AudioRecorder and PeakCache concepts using native Web Audio API
 * and zero external dependencies.
 */

import { encodeWav } from "./scdaw.js";

/**
 * Computes normalized peak amplitudes (0.0 to 1.0) from raw PCM samples
 * for rendering multi-resolution waveform previews on timeline clips.
 *
 * @param {Float32Array|number[]|{ getChannelData: () => Float32Array }} source - PCM samples or AudioBuffer
 * @param {number} [numPeaks=32] - Number of peak buckets to calculate
 * @returns {number[]} Array of normalized peak heights between 0.0 and 1.0
 */
export function computeWaveformPeaks(source, numPeaks = 32) {
  if (!source || numPeaks <= 0) return [];

  let pcm;
  if (typeof source.getChannelData === "function") {
    pcm = source.getChannelData(0);
  } else if (source instanceof Float32Array || Array.isArray(source)) {
    pcm = source;
  } else {
    return [];
  }

  const length = pcm.length;
  if (length === 0) return new Array(numPeaks).fill(0);

  const blockSize = Math.floor(length / numPeaks);
  const peaks = new Array(numPeaks);

  if (blockSize <= 1) {
    for (let i = 0; i < numPeaks; i++) {
      const val = i < length ? Math.abs(pcm[i]) : 0;
      peaks[i] = Math.min(1.0, Math.max(0.0, Number(val.toFixed(3))));
    }
    return peaks;
  }

  for (let i = 0; i < numPeaks; i++) {
    const start = i * blockSize;
    const end = i === numPeaks - 1 ? length : start + blockSize;
    let max = 0;
    for (let j = start; j < end; j++) {
      const abs = Math.abs(pcm[j]);
      if (abs > max) max = abs;
    }
    peaks[i] = Math.min(1.0, Math.max(0.0, Number(max.toFixed(3))));
  }

  return peaks;
}

/**
 * AudioRecorder captures live microphone/line-in audio via getUserMedia()
 * and accumulates PCM frames, encoding them into standard 16-bit WAV on stop.
 */
export class AudioRecorder {
  /**
   * @param {Object} [options]
   * @param {AudioContext} [options.audioContext]
   * @param {number} [options.sampleRate=44100]
   */
  constructor({ audioContext = null, sampleRate = 44100 } = {}) {
    this._ctx = audioContext;
    this._sampleRate = sampleRate;
    this._recording = false;
    this._stream = null;
    this._sourceNode = null;
    this._processorNode = null;
    this._chunks = [];
    this._totalSamples = 0;
  }

  /**
   * Check if currently recording.
   * @returns {boolean}
   */
  isRecording() {
    return this._recording;
  }

  /**
   * Start recording from a MediaStream or request microphone access.
   *
   * @param {MediaStream} [stream] - Optional active MediaStream
   * @returns {Promise<void>}
   */
  async start(stream = null) {
    if (this._recording) {
      throw new Error("AudioRecorder is already recording");
    }

    if (!stream) {
      if (
        typeof navigator !== "undefined" &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === "function"
      ) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      } else {
        throw new Error("getUserMedia is not supported in this environment");
      }
    }

    this._stream = stream;
    this._chunks = [];
    this._totalSamples = 0;

    // Resolve or create AudioContext
    if (!this._ctx && typeof AudioContext !== "undefined") {
      this._ctx = new AudioContext({ sampleRate: this._sampleRate });
    }
    if (this._ctx && typeof this._ctx.resume === "function") {
      await this._ctx.resume();
    }

    const currentSampleRate = this._ctx
      ? this._ctx.sampleRate
      : this._sampleRate;
    this._sampleRate = currentSampleRate;

    if (this._ctx && typeof this._ctx.createMediaStreamSource === "function") {
      this._sourceNode = this._ctx.createMediaStreamSource(this._stream);

      // ScriptProcessor / AudioWorklet for PCM accumulation
      if (typeof this._ctx.createScriptProcessor === "function") {
        this._processorNode = this._ctx.createScriptProcessor(4096, 1, 1);
        this._processorNode.onaudioprocess = (e) => {
          if (!this._recording) return;
          const input = e.inputBuffer.getChannelData(0);
          this.recordChunk(input);
        };
        this._sourceNode.connect(this._processorNode);
        if (this._ctx.destination) {
          // Connect to destination to keep processor alive, but through a mute gain
          const mute = this._ctx.createGain();
          mute.gain.setValueAtTime(0, this._ctx.currentTime);
          this._processorNode.connect(mute);
          mute.connect(this._ctx.destination);
        }
      }
    }

    this._recording = true;
  }

  /**
   * Append a raw PCM chunk to internal buffer.
   *
   * @param {Float32Array|number[]} pcmChunk
   */
  recordChunk(pcmChunk) {
    if (!this._recording) return;
    const copy = new Float32Array(pcmChunk);
    this._chunks.push(copy);
    this._totalSamples += copy.length;
  }

  /**
   * Stop recording, release media streams, and encode accumulated PCM into WAV.
   *
   * @returns {Promise<{ buffer: ArrayBuffer, blob: Blob|null, durationSec: number, sampleRate: number, pcm: Float32Array }>}
   */
  async stop() {
    if (!this._recording) {
      return {
        buffer: new ArrayBuffer(0),
        blob: null,
        durationSec: 0,
        sampleRate: this._sampleRate,
        pcm: new Float32Array(0),
      };
    }

    this._recording = false;

    // Disconnect audio nodes
    if (this._processorNode) {
      if (typeof this._processorNode.disconnect === "function") {
        this._processorNode.disconnect();
      }
      this._processorNode.onaudioprocess = null;
      this._processorNode = null;
    }
    if (this._sourceNode) {
      if (typeof this._sourceNode.disconnect === "function") {
        this._sourceNode.disconnect();
      }
      this._sourceNode = null;
    }

    // Stop all media tracks
    if (this._stream && typeof this._stream.getAudioTracks === "function") {
      for (const track of this._stream.getAudioTracks()) {
        if (typeof track.stop === "function") {
          track.stop();
        }
      }
    }
    this._stream = null;

    // Merge accumulated PCM chunks
    const mergedPcm = new Float32Array(this._totalSamples);
    let offset = 0;
    for (const chunk of this._chunks) {
      mergedPcm.set(chunk, offset);
      offset += chunk.length;
    }
    this._chunks = [];

    // Encode to 16-bit standard WAV
    const wavBuffer = encodeWav([mergedPcm], this._sampleRate, {
      bitDepth: 16,
    });
    const durationSec = mergedPcm.length / this._sampleRate;

    let blob = null;
    if (typeof Blob !== "undefined") {
      blob = new Blob([wavBuffer], { type: "audio/wav" });
    }

    return {
      buffer: wavBuffer,
      blob,
      durationSec,
      sampleRate: this._sampleRate,
      pcm: mergedPcm,
    };
  }
}
