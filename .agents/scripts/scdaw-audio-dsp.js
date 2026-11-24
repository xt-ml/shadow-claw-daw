/**
 * .agents/scripts/scdaw-audio-dsp.js
 *
 * Pure Float32Array offline audio DSP kernels, restoration, generators,
 * zero-crossing analysis, and EBU R128 loudness measurement.
 * 100% zero-dependency ESM with optional pluggable WASM/Worker backend hooks.
 */

import { evaluateClipGainEnvelope } from "./scdaw.js";
import {
  applyNoiseReduction,
  applySpectralEdit,
} from "./scdaw-spectral-dsp.js";
import {
  resampleAudio,
  timeStretchWsola,
  pitchShiftAudio,
  changeSpeedAudio,
  truncateSilenceAudio,
} from "./scdaw-time-dsp.js";

export {
  resampleAudio,
  timeStretchWsola,
  pitchShiftAudio,
  changeSpeedAudio,
  truncateSilenceAudio,
};

const _dspBackends = new Map();

/**
 * Register a custom DSP backend (e.g. WASM or Web Worker accelerator) for an operation.
 * @param {string} opName
 * @param {Function} handler - (channels, params, sampleRate) => { channels, meta }
 */
export function registerDspBackend(opName, handler) {
  if (!opName || typeof handler !== "function") {
    throw new Error("registerDspBackend requires opName and handler function");
  }
  _dspBackends.set(String(opName), handler);
}

/**
 * Remove a registered custom DSP backend.
 * @param {string} opName
 * @returns {boolean}
 */
export function unregisterDspBackend(opName) {
  return _dspBackends.delete(String(opName));
}

/**
 * Get registered custom DSP backend for an operation, or null.
 * @param {string} opName
 * @returns {Function|null}
 */
export function getDspBackend(opName) {
  return _dspBackends.get(String(opName)) || null;
}

/**
 * List all registered custom DSP backend operation names.
 * @returns {string[]}
 */
export function listDspBackends() {
  return Array.from(_dspBackends.keys());
}

function normalizeChannels(channels) {
  if (!Array.isArray(channels) || channels.length === 0) {
    return [new Float32Array(0)];
  }
  return channels.map((ch) =>
    ch instanceof Float32Array ? ch : new Float32Array(ch || 0),
  );
}

function cloneChannels(channels) {
  return normalizeChannels(channels).map((ch) => new Float32Array(ch));
}

/**
 * Locate the nearest upward zero crossing inside a 10ms window around targetSample.
 *
 * @param {Float32Array[]} channels
 * @param {number} targetSample
 * @param {number} [sampleRate=44100]
 * @returns {{ sampleIndex: number, timeSec: number, score: number }}
 */
export function findNearestZeroCrossing(
  channels,
  targetSample,
  sampleRate = 44100,
) {
  const chs = normalizeChannels(channels);
  const len = chs[0]?.length || 0;
  if (len === 0) {
    return { sampleIndex: 0, timeSec: 0, score: 0 };
  }

  const center = Math.max(0, Math.min(len - 1, Math.round(targetSample || 0)));
  const windowSize = Math.max(2, Math.round(sampleRate / 100));
  const halfWin = Math.floor(windowSize / 2);
  const start = Math.max(0, center - halfWin);
  const end = Math.min(len, start + windowSize);
  const span = Math.max(1, end - start);

  const dist = new Float64Array(span);
  for (const ch of chs) {
    let prev = start > 0 ? ch[start - 1] : ch[start];
    for (let i = 0; i < span; i++) {
      const idx = start + i;
      const sample = ch[idx];
      let score = Math.abs(sample);
      if (prev * sample > 0) {
        score += 0.4; // same sign: not a crossing
      } else if (prev > 0) {
        score += 0.1; // downward crossing penalty
      }
      dist[i] += score;
      prev = sample;
    }
  }

  let bestOffset = center - start;
  let minScore = Infinity;
  for (let i = 0; i < span; i++) {
    const distancePenalty =
      0.1 * (Math.abs(start + i - center) / Math.max(1, halfWin));
    const total = dist[i] + distancePenalty;
    if (total < minScore) {
      minScore = total;
      bestOffset = i;
    }
  }

  const sampleIndex = start + bestOffset;
  return {
    sampleIndex,
    timeSec: sampleIndex / (sampleRate || 44100),
    score: minScore,
  };
}

/**
 * Remove constant DC offset per channel.
 *
 * @param {Float32Array[]} channels
 * @returns {{ channels: Float32Array[], meta: { offsets: number[] } }}
 */
export function removeDcOffset(channels) {
  const chs = normalizeChannels(channels);
  const offsets = [];
  const out = chs.map((ch) => {
    const len = ch.length;
    const dst = new Float32Array(len);
    if (len === 0) {
      offsets.push(0);
      return dst;
    }
    let sum = 0;
    for (let i = 0; i < len; i++) sum += ch[i];
    const mean = sum / len;
    offsets.push(mean);
    for (let i = 0; i < len; i++) {
      dst[i] = Math.max(-1, Math.min(1, ch[i] - mean));
    }
    return dst;
  });
  return { channels: out, meta: { offsets } };
}

/**
 * Invert phase/polarity of every sample.
 * @param {Float32Array[]} channels
 * @returns {{ channels: Float32Array[], meta: { inverted: true } }}
 */
export function invertAudio(channels) {
  const chs = normalizeChannels(channels);
  const out = chs.map((ch) => {
    const dst = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) dst[i] = -ch[i];
    return dst;
  });
  return { channels: out, meta: { inverted: true } };
}

/**
 * Reverse sample order across all channels.
 * @param {Float32Array[]} channels
 * @returns {{ channels: Float32Array[], meta: { reversed: true } }}
 */
export function reverseAudio(channels) {
  const chs = normalizeChannels(channels);
  const out = chs.map((ch) => {
    const len = ch.length;
    const dst = new Float32Array(len);
    for (let i = 0; i < len; i++) dst[i] = ch[len - 1 - i];
    return dst;
  });
  return { channels: out, meta: { reversed: true } };
}

/**
 * Amplify audio by gainDb with optional clipping guard.
 * @param {Float32Array[]} channels
 * @param {{ gainDb?: number, allowClipping?: boolean }} [options]
 * @returns {{ channels: Float32Array[], meta: { gainDb: number, factor: number, clippedSamples: number } }}
 */
export function amplifyAudio(channels, options = {}) {
  const chs = normalizeChannels(channels);
  const gainDb = Number(options.gainDb ?? 0);
  const allowClipping = Boolean(options.allowClipping);
  const factor = Math.pow(10, gainDb / 20);
  let clippedSamples = 0;

  const out = chs.map((ch) => {
    const dst = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i] * factor;
      if (!allowClipping && (v > 1 || v < -1)) {
        clippedSamples++;
        dst[i] = Math.max(-1, Math.min(1, v));
      } else {
        dst[i] = v;
      }
    }
    return dst;
  });

  return {
    channels: out,
    meta: { gainDb, factor, clippedSamples },
  };
}

/**
 * Peak-normalize channels to targetDb (default -1 dBFS), optionally removing DC offset
 * and normalizing stereo channels together or independently.
 *
 * @param {Float32Array[]} channels
 * @param {{ targetDb?: number, removeDc?: boolean, independent?: boolean }} [options]
 * @returns {{ channels: Float32Array[], meta: { targetDb: number, peakBefore: number, gainAppliedDb: number } }}
 */
export function normalizePeakAudio(channels, options = {}) {
  const targetDb = Number(options.targetDb ?? -1.0);
  const removeDc = options.removeDc !== false;
  const independent = Boolean(options.independent);
  const targetAmp = Math.pow(10, targetDb / 20);

  const working = removeDc
    ? removeDcOffset(channels).channels
    : cloneChannels(channels);

  const peaks = working.map((ch) => {
    let p = 0;
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > p) p = a;
    }
    return p;
  });

  const maxPeak = peaks.reduce((acc, v) => Math.max(acc, v), 0);
  if (maxPeak <= 1e-9) {
    return {
      channels: working,
      meta: { targetDb, peakBefore: 0, gainAppliedDb: 0 },
    };
  }

  let appliedFactor = targetAmp / maxPeak;
  const out = working.map((ch, idx) => {
    const chPeak = peaks[idx];
    const factor =
      independent && chPeak > 1e-9 ? targetAmp / chPeak : appliedFactor;
    const dst = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      dst[i] = Math.max(-1, Math.min(1, ch[i] * factor));
    }
    return dst;
  });

  return {
    channels: out,
    meta: {
      targetDb,
      peakBefore: maxPeak,
      gainAppliedDb: 20 * Math.log10(appliedFactor),
    },
  };
}

function makeEbuR128Filters(sampleRate) {
  const fs = Math.max(8000, Number(sampleRate) || 44100);
  // Stage 1: High-shelf pre-filter (+4 dB above ~1682 Hz)
  const db = 3.999843853973347;
  const f0Pre = 1681.974450955533;
  const qPre = 0.7071752369554196;
  const kPre = Math.tan((Math.PI * f0Pre) / fs);
  const vh = Math.pow(10, db / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  const a0Pre = 1 + kPre / qPre + kPre * kPre;

  const b0_1 = (vh + (vb * kPre) / qPre + kPre * kPre) / a0Pre;
  const b1_1 = (2 * (kPre * kPre - vh)) / a0Pre;
  const b2_1 = (vh - (vb * kPre) / qPre + kPre * kPre) / a0Pre;
  const a1_1 = (2 * (kPre * kPre - 1)) / a0Pre;
  const a2_1 = (1 - kPre / qPre + kPre * kPre) / a0Pre;

  // Stage 2: High-pass RLB weighting filter (~38.14 Hz)
  const f0Hp = 38.13547087602444;
  const qHp = 0.5003270373238773;
  const kHp = Math.tan((Math.PI * f0Hp) / fs);
  const a0Hp = 1 + kHp / qHp + kHp * kHp;

  const b0_2 = 1 / a0Hp;
  const b1_2 = -2 / a0Hp;
  const b2_2 = 1 / a0Hp;
  const a1_2 = (2 * (kHp * kHp - 1)) / a0Hp;
  const a2_2 = (1 - kHp / qHp + kHp * kHp) / a0Hp;

  return {
    b0_1,
    b1_1,
    b2_1,
    a1_1,
    a2_1,
    b0_2,
    b1_2,
    b2_2,
    a1_2,
    a2_2,
  };
}

function applyKWeighting(samples, coeffs) {
  const len = samples.length;
  const out = new Float64Array(len);
  let x1_1 = 0,
    x2_1 = 0,
    y1_1 = 0,
    y2_1 = 0;
  let x1_2 = 0,
    x2_2 = 0,
    y1_2 = 0,
    y2_2 = 0;

  for (let i = 0; i < len; i++) {
    const x = samples[i];
    const y1 =
      coeffs.b0_1 * x +
      coeffs.b1_1 * x1_1 +
      coeffs.b2_1 * x2_1 -
      coeffs.a1_1 * y1_1 -
      coeffs.a2_1 * y2_1;
    x2_1 = x1_1;
    x1_1 = x;
    y2_1 = y1_1;
    y1_1 = y1;

    const y2 =
      coeffs.b0_2 * y1 +
      coeffs.b1_2 * x1_2 +
      coeffs.b2_2 * x2_2 -
      coeffs.a1_2 * y1_2 -
      coeffs.a2_2 * y2_2;
    x2_2 = x1_2;
    x1_2 = y1;
    y2_2 = y1_2;
    y1_2 = y2;

    out[i] = y2;
  }
  return out;
}

/**
 * Measure integrated LUFS loudness per ITU-R BS.1770 / EBU R128.
 *
 * @param {Float32Array[]} channels
 * @param {number} [sampleRate=44100]
 * @returns {number} Integrated loudness in LUFS (-Infinity for silence)
 */
export function measureLufs(channels, sampleRate = 44100) {
  const chs = normalizeChannels(channels);
  const len = chs[0]?.length || 0;
  if (len === 0) return -Infinity;

  const fs = Math.max(8000, Number(sampleRate) || 44100);
  const coeffs = makeEbuR128Filters(fs);
  const weighted = chs.map((ch) => applyKWeighting(ch, coeffs));

  const powerSum = new Float64Array(len);
  for (let c = 0; c < weighted.length; c++) {
    const w = weighted[c];
    for (let i = 0; i < len; i++) {
      powerSum[i] += w[i] * w[i];
    }
  }

  const blockSize = Math.max(1, Math.round(0.4 * fs));
  const hopSize = Math.max(1, Math.round(0.1 * fs));
  const blocks = [];

  if (len < blockSize) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += powerSum[i];
    blocks.push(sum / len);
  } else {
    for (let start = 0; start + blockSize <= len; start += hopSize) {
      let sum = 0;
      for (let i = 0; i < blockSize; i++) sum += powerSum[start + i];
      blocks.push(sum / blockSize);
    }
  }

  const absThresholdLinear = Math.pow(10, (-70 + 0.691) / 10);
  const absGated = blocks.filter((z) => z > absThresholdLinear);
  if (absGated.length === 0) return -Infinity;

  const avgAbs = absGated.reduce((a, b) => a + b, 0) / absGated.length;
  const gammaR = -0.691 + 10 * Math.log10(avgAbs) - 10;
  const relThresholdLinear = Math.pow(10, (gammaR + 0.691) / 10);

  const relGated = absGated.filter((z) => z > relThresholdLinear);
  if (relGated.length === 0) return -Infinity;

  const avgRel = relGated.reduce((a, b) => a + b, 0) / relGated.length;
  return -0.691 + 10 * Math.log10(avgRel);
}

/**
 * Normalize audio loudness to target LUFS (EBU R128) or target RMS dB.
 *
 * @param {Float32Array[]} channels
 * @param {{ mode?: "lufs"|"rms", targetLufs?: number, targetRmsDb?: number, sampleRate?: number }} [options]
 * @returns {{ channels: Float32Array[], meta: { mode: string, beforeDb: number, targetDb: number, gainAppliedDb: number } }}
 */
export function normalizeLoudnessAudio(channels, options = {}) {
  const chs = normalizeChannels(channels);
  const mode = String(options.mode || "lufs").toLowerCase();
  const sampleRate = Number(options.sampleRate || 44100);
  const targetDb =
    mode === "rms"
      ? Number(options.targetRmsDb ?? -18)
      : Number(options.targetLufs ?? -14);

  let beforeDb;
  if (mode === "rms") {
    let sumSq = 0;
    let totalSamples = 0;
    for (const ch of chs) {
      for (let i = 0; i < ch.length; i++) sumSq += ch[i] * ch[i];
      totalSamples += ch.length;
    }
    const rms = totalSamples > 0 ? Math.sqrt(sumSq / totalSamples) : 0;
    beforeDb = rms > 1e-9 ? 20 * Math.log10(rms) : -Infinity;
  } else {
    beforeDb = measureLufs(chs, sampleRate);
  }

  if (!Number.isFinite(beforeDb)) {
    return {
      channels: cloneChannels(chs),
      meta: { mode, beforeDb, targetDb, gainAppliedDb: 0 },
    };
  }

  const gainAppliedDb = targetDb - beforeDb;
  const factor = Math.pow(10, gainAppliedDb / 20);
  const out = chs.map((ch) => {
    const dst = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      dst[i] = Math.max(-1, Math.min(1, ch[i] * factor));
    }
    return dst;
  });

  return {
    channels: out,
    meta: { mode, beforeDb, targetDb, gainAppliedDb },
  };
}

/**
 * Bake clip gain, fade-in, fade-out, and gainEnvelope directly into PCM buffers.
 *
 * @param {Float32Array[]} channels
 * @param {Object} clip
 * @param {number} [sampleRate=44100]
 * @returns {{ channels: Float32Array[], meta: { baked: true } }}
 */
export function bakeClipGainAndFades(channels, clip = {}, sampleRate = 44100) {
  const chs = normalizeChannels(channels);
  const fs = Math.max(1, Number(sampleRate) || 44100);
  const out = chs.map((ch) => {
    const len = ch.length;
    const durSec = len / fs;
    const dst = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const t = i / fs;
      const g = evaluateClipGainEnvelope(clip, t, durSec);
      dst[i] = Math.max(-1, Math.min(1, ch[i] * g));
    }
    return dst;
  });
  return { channels: out, meta: { baked: true } };
}

/**
 * Detect and linearly interpolate narrow impulse clicks/pops.
 *
 * @param {Float32Array[]} channels
 * @param {{ threshold?: number, maxClickWidth?: number }} [options]
 * @returns {{ channels: Float32Array[], meta: { clicksRemoved: number } }}
 */
export function removeClicksAudio(channels, options = {}) {
  const chs = normalizeChannels(channels);
  const threshold = Math.max(1, Number(options.threshold ?? 200));
  const maxClickWidth = Math.max(4, Math.round(options.maxClickWidth ?? 20));
  let clicksRemoved = 0;

  const out = chs.map((ch) => {
    const len = ch.length;
    const dst = new Float32Array(ch);
    if (len < 32) return dst;

    let sep = 2048;
    while (sep > Math.floor(len / 2) && sep > 16) {
      sep >>= 1;
    }
    const s2 = Math.floor(sep / 2);

    const b2 = new Float32Array(len);
    const msSeq = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      b2[i] = dst[i] * dst[i];
      msSeq[i] = b2[i];
    }

    let step = 1;
    while (step < sep) {
      for (let j = 0; j < len - step; j++) {
        msSeq[j] += msSeq[j + step];
      }
      step *= 2;
    }
    const effectiveSep = step;
    for (let i = 0; i < len - effectiveSep; i++) {
      msSeq[i] /= effectiveSep;
    }

    for (
      let wrc = Math.max(1, Math.floor(maxClickWidth / 4));
      wrc >= 1;
      wrc = Math.floor(wrc / 2)
    ) {
      const ww = Math.max(2, Math.floor(maxClickWidth / wrc));
      let left = 0;
      const limit = len - effectiveSep - ww - s2;
      for (let i = 0; i < limit; i++) {
        let msw = 0;
        for (let j = 0; j < ww; j++) {
          msw += b2[i + s2 + j];
        }
        msw /= ww;

        if (msw >= (threshold * msSeq[i]) / 10) {
          if (left === 0) left = i + s2;
        } else if (left !== 0) {
          const rightEnd = i + ww + s2;
          if (i - left + s2 <= ww * 2 && rightEnd < len) {
            const lv = dst[left];
            const rv = dst[rightEnd];
            const span = Math.max(1, rightEnd - left);
            for (let j = left; j < rightEnd; j++) {
              dst[j] = (rv * (j - left) + lv * (rightEnd - j)) / span;
              b2[j] = dst[j] * dst[j];
            }
            clicksRemoved++;
          }
          left = 0;
        }
      }
    }
    return dst;
  });

  return { channels: out, meta: { clicksRemoved } };
}

function createSeededRng(seed) {
  if (seed === undefined || seed === null) {
    return () => Math.random();
  }
  let state = Number(seed) >>> 0 || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/**
 * Generate Tone or Frequency-Sweep Chirp PCM buffer.
 * @param {{ waveform?: "sine"|"square"|"sawtooth"|"triangle"|"chirp", frequency?: number, endFrequency?: number, durationSec?: number, amplitude?: number, sampleRate?: number }} [options]
 * @returns {{ channels: Float32Array[], sampleRate: number, durationSec: number }}
 */
export function generateToneAudio(options = {}) {
  const sampleRate = Math.max(8000, Number(options.sampleRate ?? 44100));
  const durationSec = Math.max(0.01, Number(options.durationSec ?? 1.0));
  const amplitude = Math.max(0, Math.min(1, Number(options.amplitude ?? 0.8)));
  const waveform = String(options.waveform || "sine").toLowerCase();
  const f0 = Math.max(1, Number(options.frequency ?? 440));
  const f1 = Math.max(
    1,
    Number(options.endFrequency ?? (waveform === "chirp" ? f0 * 2 : f0)),
  );
  const numFrames = Math.max(1, Math.round(durationSec * sampleRate));
  const pcm = new Float32Array(numFrames);

  let phase = 0;
  for (let i = 0; i < numFrames; i++) {
    const frac = numFrames > 1 ? i / (numFrames - 1) : 0;
    const freq = f0 + (f1 - f0) * frac;
    const p = phase - Math.floor(phase);
    let val = 0;
    if (waveform === "square") {
      val = p < 0.5 ? 1 : -1;
    } else if (waveform === "sawtooth") {
      val = 2 * p - 1;
    } else if (waveform === "triangle") {
      val = 1 - 4 * Math.abs(Math.round(p - 0.25) - (p - 0.25));
    } else {
      val = Math.sin(2 * Math.PI * p);
    }
    pcm[i] = amplitude * val;
    phase += freq / sampleRate;
  }

  return { channels: [pcm], sampleRate, durationSec: numFrames / sampleRate };
}

/**
 * Generate White, Pink (Paul Kellet), or Brownian noise.
 *
 * @param {{ type?: "white"|"pink"|"brownian", durationSec?: number, amplitude?: number, sampleRate?: number, seed?: number }} [options]
 * @returns {{ channels: Float32Array[], sampleRate: number, durationSec: number }}
 */
export function generateNoiseAudio(options = {}) {
  const sampleRate = Math.max(8000, Number(options.sampleRate ?? 44100));
  const durationSec = Math.max(0.01, Number(options.durationSec ?? 1.0));
  const amplitude = Math.max(0, Math.min(1, Number(options.amplitude ?? 0.5)));
  const type = String(options.type || "white").toLowerCase();
  const numFrames = Math.max(1, Math.round(durationSec * sampleRate));
  const pcm = new Float32Array(numFrames);
  const rand = createSeededRng(options.seed);

  if (type === "pink") {
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    const amp = amplitude * 0.129;
    for (let i = 0; i < numFrames; i++) {
      const white = rand() * 2 - 1;
      b0 = 0.99886 * b0 + 0.0555179 * white;
      b1 = 0.99332 * b1 + 0.0750759 * white;
      b2 = 0.969 * b2 + 0.153852 * white;
      b3 = 0.8665 * b3 + 0.3104856 * white;
      b4 = 0.55 * b4 + 0.5329522 * white;
      b5 = -0.7616 * b5 - 0.016898 * white;
      pcm[i] = Math.max(
        -1,
        Math.min(1, amp * (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362)),
      );
      b6 = white * 0.115926;
    }
  } else if (type === "brownian" || type === "brown") {
    const leakage = Math.min(0.9999, (sampleRate - 144) / sampleRate);
    const scaling = Math.max(0.01, 9.0 / Math.sqrt(sampleRate));
    let y = 0;
    for (let i = 0; i < numFrames; i++) {
      const white = rand() * 2 - 1;
      const z = leakage * y + white * scaling;
      y = Math.abs(z) > 1.0 ? leakage * y - white * scaling : z;
      pcm[i] = Math.max(-1, Math.min(1, amplitude * y));
    }
  } else {
    for (let i = 0; i < numFrames; i++) {
      pcm[i] = amplitude * (rand() * 2 - 1);
    }
  }

  return { channels: [pcm], sampleRate, durationSec: numFrames / sampleRate };
}

const DTMF_FREQS = Object.freeze({
  1: [697, 1209],
  2: [697, 1336],
  3: [697, 1477],
  A: [697, 1633],
  4: [770, 1209],
  5: [770, 1336],
  6: [770, 1477],
  B: [770, 1633],
  7: [852, 1209],
  8: [852, 1336],
  9: [852, 1477],
  C: [852, 1633],
  "*": [941, 1209],
  0: [941, 1336],
  "#": [941, 1477],
  D: [941, 1633],
});

/**
 * Generate ITU-T Dual-Tone Multi-Frequency (DTMF) keypad tone sequence.
 *
 * @param {{ sequence?: string, toneMs?: number, silenceMs?: number, amplitude?: number, sampleRate?: number }} [options]
 * @returns {{ channels: Float32Array[], sampleRate: number, durationSec: number }}
 */
export function generateDtmfAudio(options = {}) {
  const sampleRate = Math.max(8000, Number(options.sampleRate ?? 44100));
  const seq = String(options.sequence || "1234")
    .toUpperCase()
    .split("")
    .filter((ch) => Boolean(DTMF_FREQS[ch]));
  const symbols = seq.length > 0 ? seq : ["1"];
  const toneFrames = Math.max(
    1,
    Math.round(((options.toneMs ?? 100) / 1000) * sampleRate),
  );
  const silenceFrames = Math.max(
    0,
    Math.round(((options.silenceMs ?? 100) / 1000) * sampleRate),
  );
  const amplitude = Math.max(0, Math.min(1, Number(options.amplitude ?? 0.7)));
  const totalFrames =
    symbols.length * toneFrames +
    Math.max(0, symbols.length - 1) * silenceFrames;
  const pcm = new Float32Array(totalFrames);
  const rampFrames = Math.min(
    Math.floor(toneFrames / 4),
    Math.round(0.002 * sampleRate),
  );

  let cursor = 0;
  for (let s = 0; s < symbols.length; s++) {
    const [fLow, fHigh] = DTMF_FREQS[symbols[s]];
    for (let i = 0; i < toneFrames; i++) {
      let env = 1.0;
      if (rampFrames > 0) {
        if (i < rampFrames)
          env = 0.5 - 0.5 * Math.cos((Math.PI * i) / rampFrames);
        else if (i >= toneFrames - rampFrames) {
          env =
            0.5 - 0.5 * Math.cos((Math.PI * (toneFrames - 1 - i)) / rampFrames);
        }
      }
      const t = i / sampleRate;
      const sample =
        0.5 *
        (Math.sin(2 * Math.PI * fLow * t) + Math.sin(2 * Math.PI * fHigh * t));
      pcm[cursor++] = amplitude * env * sample;
    }
    if (s < symbols.length - 1) {
      cursor += silenceFrames;
    }
  }

  return {
    channels: [pcm],
    sampleRate,
    durationSec: totalFrames / sampleRate,
  };
}

/**
 * Generate pure silence PCM buffer.
 * @param {{ durationSec?: number, sampleRate?: number, channels?: number }} [options]
 * @returns {{ channels: Float32Array[], sampleRate: number, durationSec: number }}
 */
export function generateSilenceAudio(options = {}) {
  const sampleRate = Math.max(8000, Number(options.sampleRate ?? 44100));
  const durationSec = Math.max(0.01, Number(options.durationSec ?? 1.0));
  const numChannels = Math.max(
    1,
    Math.min(2, Math.round(options.channels ?? 1)),
  );
  const numFrames = Math.max(1, Math.round(durationSec * sampleRate));
  const channels = Array.from(
    { length: numChannels },
    () => new Float32Array(numFrames),
  );
  return { channels, sampleRate, durationSec: numFrames / sampleRate };
}

/**
 * Unified offline channel DSP dispatcher. Checks pluggable custom backends first,
 * then executes the pure-JS implementation.
 *
 * @param {Float32Array[]} channels
 * @param {string} effect
 * @param {Object} [params]
 * @param {number} [sampleRate=44100]
 * @returns {{ channels: Float32Array[], meta: Object }}
 */
export function processAudioChannels(
  channels,
  effect,
  params = {},
  sampleRate = 44100,
) {
  const op = String(effect || "").toLowerCase();
  const customBackend = getDspBackend(op);
  if (customBackend) {
    return customBackend(channels, params, sampleRate);
  }

  switch (op) {
    case "normalize":
      return normalizePeakAudio(channels, params);
    case "amplify":
      return amplifyAudio(channels, params);
    case "loudness":
      return normalizeLoudnessAudio(channels, { ...params, sampleRate });
    case "remove_dc":
      return removeDcOffset(channels);
    case "invert":
      return invertAudio(channels);
    case "reverse":
      return reverseAudio(channels);
    case "click_removal":
      return removeClicksAudio(channels, params);
    case "fade_in": {
      const chs = normalizeChannels(channels);
      const durSec = (chs[0]?.length || 0) / (sampleRate || 44100);
      return bakeClipGainAndFades(
        chs,
        {
          gain: 1.0,
          fadeIn: params.durationSec ?? durSec,
          fadeInType: params.fadeInType || params.fadeType || "linear",
        },
        sampleRate,
      );
    }
    case "fade_out": {
      const chs = normalizeChannels(channels);
      const durSec = (chs[0]?.length || 0) / (sampleRate || 44100);
      return bakeClipGainAndFades(
        chs,
        {
          gain: 1.0,
          fadeOut: params.durationSec ?? durSec,
          fadeOutType: params.fadeOutType || params.fadeType || "linear",
        },
        sampleRate,
      );
    }
    case "bake_fades":
      return bakeClipGainAndFades(channels, params.clip || params, sampleRate);
    case "noise_reduction":
      return applyNoiseReduction(channels, params.noiseProfile, {
        ...params,
        sampleRate,
      });
    case "spectral_edit":
      return applySpectralEdit(channels, { ...params, sampleRate });
    case "change_tempo":
      return timeStretchWsola(channels, { ...params, sampleRate });
    case "change_pitch":
      return pitchShiftAudio(channels, { ...params, sampleRate });
    case "change_speed":
      return changeSpeedAudio(channels, params);
    case "truncate_silence":
      return truncateSilenceAudio(channels, { ...params, sampleRate });
    default:
      throw new Error(`Unsupported audio DSP effect: ${effect}`);
  }
}
