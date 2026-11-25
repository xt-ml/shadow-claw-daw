// Ported from openDAW packages/lib/dsp @10088021 (AGPL-3.0-or-later, © André Michelle)
/**
 * .agents/scripts/shadow-claw-daw-dsp.js
 *
 * Pure Float32Array DSP kernels for audio effects, transfer curves, and impulse responses.
 * 100% environment agnostic (runs identically in Node.js, Web Workers, and AudioWorklet).
 */

/**
 * Generates a non-linear wavefolding / saturation curve for WaveShaperNode.
 * Ported from openDAW waveshaper & fold devices.
 *
 * @param {number} driveDb - Drive in decibels (0 to 24 dB).
 * @param {number} numSamples - Curve resolution (default 1024).
 * @returns {Float32Array} Transfer function from -1 to 1.
 */
export function createWavefolderCurve(driveDb = 6, numSamples = 1024) {
  const curve = new Float32Array(numSamples);
  const gain = Math.pow(10, driveDb / 20);

  for (let i = 0; i < numSamples; i++) {
    // Map i from [0, numSamples - 1] to [-1, 1]
    const x = (i * 2) / (numSamples - 1) - 1;
    const driven = x * gain;
    // Folding / soft saturation function: sin(driven) bounded smoothly
    if (Math.abs(driven) <= 1.0) {
      curve[i] = Math.sin((driven * Math.PI) / 2);
    } else {
      // Fold back around [-1, 1]
      const folded = Math.sin(driven);
      curve[i] = Math.tanh(folded);
    }
  }
  return curve;
}

/**
 * Bitcrusher & sample-rate reducer kernel.
 * Ported from openDAW packages/lib/dsp/src/crusher.ts.
 *
 * @param {Float32Array} input - Input audio buffer.
 * @param {number} bits - Target bit depth (2 to 16).
 * @param {number} downsample - Downsampling ratio (1 = no downsampling, 2, 4, 8...).
 * @returns {Float32Array} Crushed audio buffer.
 */
export function processCrusherBuffer(input, bits = 8, downsample = 1) {
  const len = input.length;
  const output = new Float32Array(len);
  const step = Math.pow(0.5, bits - 1);
  const ds = Math.max(1, Math.round(downsample));

  let heldSample = 0;
  for (let i = 0; i < len; i++) {
    if (i % ds === 0) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      // Quantize to step
      heldSample = step * Math.round(sample / step);
    }
    output[i] = heldSample;
  }
  return output;
}

/**
 * Mid-Side stereo width and pan positioning processor.
 * Ported from openDAW packages/lib/dsp/src/stereo.ts.
 *
 * @param {Float32Array} left - Left channel frames.
 * @param {Float32Array} right - Right channel frames.
 * @param {number} width - Stereo width factor (0 = mono, 1 = normal, 2 = extra wide).
 * @param {number} pan - Stereo pan (-1 left, 0 center, +1 right).
 * @param {boolean} invertL - Invert phase of left channel.
 * @param {boolean} invertR - Invert phase of right channel.
 * @returns {{ outLeft: Float32Array, outRight: Float32Array }}
 */
export function processStereoTool(
  left,
  right,
  width = 1.0,
  pan = 0.0,
  invertL = false,
  invertR = false,
) {
  const len = left.length;
  const outLeft = new Float32Array(len);
  const outRight = new Float32Array(len);

  // Equal-power pan factors
  const panRad = ((pan + 1) * Math.PI) / 4;
  const panGainL = Math.cos(panRad) * Math.SQRT2;
  const panGainR = Math.sin(panRad) * Math.SQRT2;

  const signL = invertL ? -1 : 1;
  const signR = invertR ? -1 : 1;

  for (let i = 0; i < len; i++) {
    const l = left[i] * signL;
    const r = right[i] * signR;

    // Mid / Side decomposition
    const mid = (l + r) * 0.5;
    const side = (l - r) * 0.5 * width;

    // Reconstruct stereo and apply pan
    outLeft[i] = Math.max(-1, Math.min(1, (mid + side) * panGainL));
    outRight[i] = Math.max(-1, Math.min(1, (mid - side) * panGainR));
  }

  return { outLeft, outRight };
}

/**
 * Generates algorithmic stereo impulse response for plate/room reverb.
 * Suitable for loading into Web Audio ConvolverNode or offline convolution.
 *
 * @param {number} sampleRate - Context sample rate (e.g. 44100).
 * @param {number} decaySec - Reverb decay time in seconds (0.1 to 5.0).
 * @param {number} damping - High-frequency absorption factor (0.0 to 1.0).
 * @param {number} preDelayMs - Pre-delay before reflections in milliseconds.
 * @returns {{ left: Float32Array, right: Float32Array }}
 */
export function generateReverbImpulse(
  sampleRate = 44100,
  decaySec = 1.5,
  damping = 0.5,
  preDelayMs = 20,
) {
  const numFrames = Math.max(128, Math.round(sampleRate * decaySec));
  const preDelayFrames = Math.round((preDelayMs / 1000) * sampleRate);
  const left = new Float32Array(numFrames);
  const right = new Float32Array(numFrames);

  const decayConstant = -3 / (decaySec * sampleRate); // T60 decay

  let lpL = 0;
  let lpR = 0;
  const dampCoeff = Math.min(0.95, Math.max(0.05, 1.0 - damping * 0.7));

  for (let i = 0; i < numFrames; i++) {
    if (i < preDelayFrames) {
      left[i] = 0;
      right[i] = 0;
      continue;
    }

    const t = i - preDelayFrames;
    const env = Math.exp(decayConstant * t);

    // Filtered pseudo-random noise burst simulating dense room diffuse reflections
    const noiseL = (Math.random() * 2 - 1) * env;
    const noiseR = (Math.random() * 2 - 1) * env;

    lpL = lpL * (1 - dampCoeff) + noiseL * dampCoeff;
    lpR = lpR * (1 - dampCoeff) + noiseR * dampCoeff;

    left[i] = lpL;
    right[i] = lpR;
  }

  return { left, right };
}

/**
 * Tidal LFO Shaper computer.
 * Ported from openDAW packages/lib/dsp/src/tidal.ts & crates/dsp/src/tidal.rs.
 */
export class TidalComputer {
  static SLOPE_MULT = 10.0;

  constructor() {
    this._depth = 1.0;
    this._slope = 0.0;
    this._symmetry = 0.5;
    this._pEx = 1.0;
    this._invS0 = 2.0;
    this._invS1 = 2.0;
  }

  set(depth, slope, symmetry) {
    this._depth = Math.max(0, Math.min(1, depth));
    this._slope = Math.max(-1, Math.min(1, slope)) * TidalComputer.SLOPE_MULT;
    this._symmetry = Math.max(1e-5, Math.min(1 - 1e-5, symmetry));
    this._pEx = Math.pow(2.0, Math.abs(this._slope));
    this._invS0 = 1.0 / this._symmetry;
    this._invS1 = 1.0 / (1.0 - this._symmetry);
  }

  compute(input) {
    if (this._depth === 0) return 1.0;
    const p = input - Math.floor(input);
    let x, sym, invS0, invS1;
    if (this._slope < 0.0) {
      x = 1.0 - p;
      sym = 1.0 - this._symmetry;
      invS0 = this._invS1;
      invS1 = this._invS0;
    } else {
      x = p;
      sym = this._symmetry;
      invS0 = this._invS0;
      invS1 = this._invS1;
    }
    if (x <= sym) {
      return 1.0 - Math.pow(1.0 - x * invS0, this._pEx) * this._depth;
    } else {
      return (
        Math.pow((1.0 - x) * invS1, this._pEx) * this._depth - this._depth + 1.0
      );
    }
  }
}

/**
 * Tidal Modulation LFO, Chorus, Flanger, and Auto-Pan Processor.
 * Ported from openDAW TidalDeviceBox & device-tidal.
 *
 * @param {Float32Array} left
 * @param {Float32Array} right
 * @param {object} options
 * @param {number} bpm
 * @param {number} sampleRate
 * @returns {{ outLeft: Float32Array, outRight: Float32Array }}
 */
export function processTidal(
  left,
  right,
  options = {},
  bpm = 120,
  sampleRate = 44100,
) {
  const len = left.length;
  const outLeft = new Float32Array(len);
  const outRight = new Float32Array(len);
  const depth = options.depth ?? 0.8;
  const slope = options.slope ?? 0.0;
  const symmetry = options.symmetry ?? 0.5;
  const rate = options.rate ?? 4; // Hz or rate fraction
  const offset = options.offset ?? 0; // degrees
  const channelOffset = options.channelOffset ?? 90; // degrees
  const mix = options.mix ?? 1.0;

  const computer = new TidalComputer();
  computer.set(depth, slope, symmetry);

  const freq = typeof rate === "number" ? Math.max(0.01, rate) : 2.0;
  const radOffsetL = (offset * Math.PI) / 180;
  const radOffsetR = ((offset + channelOffset) * Math.PI) / 180;

  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const phaseL = (t * freq + radOffsetL / (2 * Math.PI)) % 1.0;
    const phaseR = (t * freq + radOffsetR / (2 * Math.PI)) % 1.0;

    const gainL = computer.compute(phaseL >= 0 ? phaseL : phaseL + 1.0);
    const gainR = computer.compute(phaseR >= 0 ? phaseR : phaseR + 1.0);

    outLeft[i] = Math.max(-1, Math.min(1, left[i] * (1 - mix + mix * gainL)));
    outRight[i] = Math.max(-1, Math.min(1, right[i] * (1 - mix + mix * gainR)));
  }

  return { outLeft, outRight };
}

/**
 * Lookahead Brickwall Peak Limiter & Maximizer with Automatic Makeup Gain.
 * Ported from openDAW crates/stock-devices/device-maximizer.
 *
 * @param {Float32Array} left
 * @param {Float32Array} right
 * @param {object} options
 * @param {number} sampleRate
 * @returns {{ outLeft: Float32Array, outRight: Float32Array, reductionDb: number }}
 */
export function processMaximizer(
  left,
  right,
  options = {},
  sampleRate = 44100,
) {
  const len = left.length;
  const outLeft = new Float32Array(len);
  const outRight = new Float32Array(len);
  const thresholdDb = options.threshold ?? -6.0;
  const ceilingDb = options.ceiling ?? -0.1;
  const lookaheadMs = options.lookahead ? (options.lookaheadMs ?? 5.0) : 0.0;
  const releaseSec = options.release ?? 0.15;

  const thresholdGain = Math.pow(10, thresholdDb / 20);
  const ceilingGain = Math.pow(10, ceilingDb / 20);
  const makeupGain = ceilingGain / Math.max(1e-4, thresholdGain);

  const lookaheadFrames = Math.round((lookaheadMs / 1000) * sampleRate);
  const releaseCoeff = Math.exp(
    -1.0 / (Math.max(0.01, releaseSec) * sampleRate),
  );

  let envelope = 0;
  let minGainReduction = 1.0;
  const gains = new Float32Array(len);

  for (let i = 0; i < len; i++) {
    const peak = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    if (peak > envelope) {
      envelope = peak;
    } else {
      envelope = envelope * releaseCoeff + peak * (1.0 - releaseCoeff);
    }

    let g = 1.0;
    if (envelope > thresholdGain) {
      g = thresholdGain / envelope;
    }
    gains[i] = g;
    if (g < minGainReduction) {
      minGainReduction = g;
    }
  }

  for (let i = 0; i < len; i++) {
    const gainIdx = Math.min(len - 1, i + lookaheadFrames);
    const g = gains[gainIdx] * makeupGain;
    const l = left[i] * g;
    const r = right[i] * g;
    outLeft[i] = Math.max(-ceilingGain, Math.min(ceilingGain, l));
    outRight[i] = Math.max(-ceilingGain, Math.min(ceilingGain, r));
  }

  const reductionDb = 20 * Math.log10(Math.max(1e-5, minGainReduction));
  return { outLeft, outRight, reductionDb };
}

/**
 * Fast/Slow Envelope Transient Shaper.
 * Ported from claw-daw/claw_daw/audio/transient.py.
 *
 * @param {Float32Array} left
 * @param {Float32Array} right
 * @param {object} options
 * @param {number} sampleRate
 * @returns {{ outLeft: Float32Array, outRight: Float32Array }}
 */
export function processTransientShaper(
  left,
  right,
  options = {},
  sampleRate = 44100,
) {
  const len = left.length;
  const outLeft = new Float32Array(len);
  const outRight = new Float32Array(len);

  const atk = Math.max(-1.0, Math.min(1.0, options.attack ?? 0.0));
  const sus = Math.max(-1.0, Math.min(1.0, options.sustain ?? 0.0));

  if (Math.abs(atk) < 1e-5 && Math.abs(sus) < 1e-5) {
    outLeft.set(left);
    outRight.set(right);
    return { outLeft, outRight };
  }

  const winFast = Math.max(1, Math.round(sampleRate * 0.002)); // 2ms
  const winSlow = Math.max(1, Math.round(sampleRate * 0.03)); // 30ms

  function computeEnv(sig, win) {
    const env = new Float32Array(sig.length);
    let s = 0.0;
    const buf = new Float32Array(win);
    let bi = 0;
    for (let i = 0; i < sig.length; i++) {
      const ax = Math.abs(sig[i]);
      s -= buf[bi];
      buf[bi] = ax;
      s += ax;
      bi = (bi + 1) % win;
      env[i] = s / win;
    }
    return env;
  }

  const efL = computeEnv(left, winFast);
  const esL = computeEnv(left, winSlow);
  const efR = computeEnv(right, winFast);
  const esR = computeEnv(right, winSlow);

  let maxSlowL = 1e-6;
  let maxSlowR = 1e-6;
  for (let i = 0; i < len; i++) {
    if (esL[i] > maxSlowL) maxSlowL = esL[i];
    if (esR[i] > maxSlowR) maxSlowR = esR[i];
  }

  const eps = 1e-6;
  for (let i = 0; i < len; i++) {
    const transL = Math.max(0.0, efL[i] - esL[i]);
    const transR = Math.max(0.0, efR[i] - esR[i]);

    const gAtkL = 1.0 + atk * (transL / (esL[i] + eps));
    const gSusL = 1.0 + sus * (esL[i] / maxSlowL);
    outLeft[i] = Math.max(-1.0, Math.min(1.0, left[i] * gAtkL * gSusL));

    const gAtkR = 1.0 + atk * (transR / (esR[i] + eps));
    const gSusR = 1.0 + sus * (esR[i] / maxSlowR);
    outRight[i] = Math.max(-1.0, Math.min(1.0, right[i] * gAtkR * gSusR));
  }

  return { outLeft, outRight };
}

/**
 * Musical scale intervals relative to root note (0..11).
 */
export const SCALE_INTERVALS = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

/**
 * Real-Time Monophonic Pitch Snapping & Autotune DSP.
 * Ported from openDAW crates/dsp/src/autotune.rs & docs/autotune.md.
 *
 * @param {Float32Array} left
 * @param {Float32Array} right
 * @param {object} options
 * @param {number} sampleRate
 * @returns {{ outLeft: Float32Array, outRight: Float32Array, detectedPitch: number, targetPitch: number }}
 */
export function processAutotune(left, right, options = {}, sampleRate = 44100) {
  const len = left.length;
  const outLeft = new Float32Array(len);
  const outRight = new Float32Array(len);

  const keyName = String(options.key || "C").toUpperCase();
  const scaleName = String(options.scale || "chromatic").toLowerCase();
  const retune = Math.max(0, Math.min(1, options.retune ?? 0.8)); // 0=loose, 1=hard
  const amount = Math.max(0, Math.min(1, options.amount ?? 1.0));
  const shift = options.shift ?? 0; // semitones (-12 to +12)

  const rootClass = Math.max(0, NOTE_NAMES.indexOf(keyName));
  const intervals = SCALE_INTERVALS[scaleName] || SCALE_INTERVALS.chromatic;
  const allowedClasses = new Set(intervals.map((i) => (rootClass + i) % 12));

  // Autocorrelation pitch detection on mono mix
  let bestPeriod = 0;
  let maxCorr = 0;
  const minPeriod = Math.floor(sampleRate / 1000); // 1000 Hz ceiling
  const maxPeriod = Math.floor(sampleRate / 60); // 60 Hz floor

  for (
    let period = minPeriod;
    period < maxPeriod && period < len / 2;
    period++
  ) {
    let corr = 0;
    let norm = 0;
    const testLen = Math.min(len - period, 512);
    for (let i = 0; i < testLen; i++) {
      const mono = 0.5 * (left[i] + right[i]);
      const monoDelayed = 0.5 * (left[i + period] + right[i + period]);
      corr += mono * monoDelayed;
      norm += mono * mono;
    }
    const coeff = norm > 1e-4 ? corr / norm : 0;
    if (coeff > maxCorr) {
      maxCorr = coeff;
      bestPeriod = period;
    }
  }

  let detectedPitch = 440;
  if (bestPeriod > 0) {
    detectedPitch = sampleRate / bestPeriod;
  }

  // Convert Hz to fractional MIDI pitch
  const midiPitch = 69 + 12 * Math.log2(Math.max(20, detectedPitch) / 440);
  const currentPitchClass = Math.round(midiPitch) % 12;

  // Find nearest allowed pitch class
  let targetClass = currentPitchClass;
  let minDistance = Infinity;
  for (let d = -6; d <= 6; d++) {
    const candidateClass = (currentPitchClass + d + 12) % 12;
    if (allowedClasses.has(candidateClass)) {
      if (Math.abs(d) < minDistance) {
        minDistance = Math.abs(d);
        targetClass = candidateClass;
      }
    }
  }

  const snappedMidi =
    Math.round(midiPitch) +
    ((targetClass - currentPitchClass + 18) % 12) -
    6 +
    shift;
  const targetPitch = 440 * Math.pow(2, (snappedMidi - 69) / 12);

  // Compute pitch shift ratio based on retune speed & amount
  const idealRatio = targetPitch / Math.max(20, detectedPitch);
  const effectiveRatio =
    1.0 + (idealRatio - 1.0) * amount * (0.2 + 0.8 * retune);

  // Granular pitch shift resampler
  for (let i = 0; i < len; i++) {
    const readPos = i * effectiveRatio;
    const idx0 = Math.floor(readPos) % len;
    const idx1 = (idx0 + 1) % len;
    const frac = readPos - Math.floor(readPos);

    outLeft[i] = Math.max(
      -1,
      Math.min(1, left[idx0] * (1 - frac) + left[idx1] * frac),
    );
    outRight[i] = Math.max(
      -1,
      Math.min(1, right[idx0] * (1 - frac) + right[idx1] * frac),
    );
  }

  return { outLeft, outRight, detectedPitch, targetPitch };
}

/**
 * 16-Band Channel Vocoder DSP.
 * Ported from openDAW crates/dsp/src/vocoder.rs.
 *
 * @param {Float32Array} carrierL
 * @param {Float32Array} carrierR
 * @param {Float32Array|null} modL
 * @param {Float32Array|null} modR
 * @param {object} options
 * @param {number} sampleRate
 * @returns {{ outLeft: Float32Array, outRight: Float32Array }}
 */
export function processVocoder(
  carrierL,
  carrierR,
  modL = null,
  modR = null,
  options = {},
  sampleRate = 44100,
) {
  const len = carrierL.length;
  const outLeft = new Float32Array(len);
  const outRight = new Float32Array(len);

  const numBands = options.bands || 16;
  const releaseSec = options.release || 0.04;
  const releaseCoeff = Math.exp(-1.0 / (releaseSec * sampleRate));

  // 16 logarithmically spaced band center frequencies (100 Hz to 8000 Hz)
  const bandFreqs = [];
  const minF = 100;
  const maxF = 8000;
  for (let b = 0; b < numBands; b++) {
    bandFreqs.push(minF * Math.pow(maxF / minF, b / (numBands - 1)));
  }

  // Pre-generate noise if no modulator supplied
  const effectiveModL = modL || new Float32Array(len);
  const effectiveModR = modR || new Float32Array(len);
  if (!modL) {
    for (let i = 0; i < len; i++) {
      effectiveModL[i] = (Math.random() * 2 - 1) * 0.5;
      effectiveModR[i] = (Math.random() * 2 - 1) * 0.5;
    }
  }

  // Biquad bandpass filter helper
  function makeBandpass(freq, q = 4.0) {
    const w0 = (2 * Math.PI * freq) / sampleRate;
    const alpha = Math.sin(w0) / (2 * q);
    const b0 = alpha;
    const b1 = 0;
    const b2 = -alpha;
    const a0 = 1 + alpha;
    const a1 = -2 * Math.cos(w0);
    const a2 = 1 - alpha;
    return {
      b0: b0 / a0,
      b1: b1 / a0,
      b2: b2 / a0,
      a1: a1 / a0,
      a2: a2 / a0,
      x1: 0,
      x2: 0,
      y1: 0,
      y2: 0,
      process(sample) {
        const y =
          this.b0 * sample +
          this.b1 * this.x1 +
          this.b2 * this.x2 -
          this.a1 * this.y1 -
          this.a2 * this.y2;
        this.x2 = this.x1;
        this.x1 = sample;
        this.y2 = this.y1;
        this.y1 = y;
        return y;
      },
    };
  }

  for (let b = 0; b < numBands; b++) {
    const freq = bandFreqs[b];
    const carrierFilterL = makeBandpass(freq);
    const carrierFilterR = makeBandpass(freq);
    const modFilterL = makeBandpass(freq);
    const modFilterR = makeBandpass(freq);

    let envL = 0;
    let envR = 0;

    for (let i = 0; i < len; i++) {
      const cL = carrierFilterL.process(carrierL[i]);
      const cR = carrierFilterR.process(carrierR[i]);

      const mL = Math.abs(modFilterL.process(effectiveModL[i]));
      const mR = Math.abs(modFilterR.process(effectiveModR[i]));

      envL = Math.max(mL, envL * releaseCoeff);
      envR = Math.max(mR, envR * releaseCoeff);

      outLeft[i] += cL * envL * 2.0;
      outRight[i] += cR * envR * 2.0;
    }
  }

  for (let i = 0; i < len; i++) {
    outLeft[i] = Math.max(-1, Math.min(1, outLeft[i]));
    outRight[i] = Math.max(-1, Math.min(1, outRight[i]));
  }

  return { outLeft, outRight };
}

/**
 * Dynamic Sidechain Gain Ducking Processor.
 * Ported from claw-daw mix_engine sidechain ducking.
 *
 * @param {Float32Array} targetLeft
 * @param {Float32Array} targetRight
 * @param {Float32Array} triggerBuffer
 * @param {object} options
 * @param {number} sampleRate
 * @returns {{ outLeft: Float32Array, outRight: Float32Array }}
 */
export function processSidechainDucking(
  targetLeft,
  targetRight,
  triggerBuffer,
  options = {},
  sampleRate = 44100,
) {
  const len = targetLeft.length;
  const outLeft = new Float32Array(len);
  const outRight = new Float32Array(len);

  const thresholdDb = options.thresholdDb ?? -18.0;
  const depthDb = options.depthDb ?? 18.0;
  const attackMs = options.attackMs ?? 5.0;
  const releaseMs = options.releaseMs ?? 80.0;

  const thresholdGain = Math.pow(10, thresholdDb / 20);
  const maxDuckGain = Math.pow(10, -depthDb / 20);

  const attackCoeff = Math.exp(
    -1.0 / (Math.max(0.001, attackMs / 1000) * sampleRate),
  );
  const releaseCoeff = Math.exp(
    -1.0 / (Math.max(0.001, releaseMs / 1000) * sampleRate),
  );

  let triggerEnv = 0;

  for (let i = 0; i < len; i++) {
    const trigVal = Math.abs(triggerBuffer[i] || 0);
    if (trigVal > triggerEnv) {
      triggerEnv = trigVal + (triggerEnv - trigVal) * attackCoeff;
    } else {
      triggerEnv = trigVal + (triggerEnv - trigVal) * releaseCoeff;
    }

    let duckGain = 1.0;
    if (triggerEnv > thresholdGain) {
      const trigDb = 20 * Math.log10(Math.max(1e-5, triggerEnv));
      const overDb = trigDb - thresholdDb;
      const reductionDb = Math.min(
        depthDb,
        Math.max(0, overDb * (depthDb / 12)),
      );
      duckGain = Math.pow(10, -reductionDb / 20);
    }

    outLeft[i] = Math.max(-1, Math.min(1, targetLeft[i] * duckGain));
    outRight[i] = Math.max(-1, Math.min(1, targetRight[i] * duckGain));
  }

  return { outLeft, outRight };
}

/**
 * Generates an asymmetric warm tube overdrive curve for guitar amp / cabinet distortion.
 *
 * @param {number} driveDb - Overdrive gain boost in dB (default: 12 dB).
 * @param {number} warmth - Even-harmonic warmth asymmetry (0.0 to 1.0).
 * @param {number} numSamples - Curve resolution (default: 1024).
 * @returns {Float32Array} Transfer function from -1 to 1.
 */
export function createGuitarOverdriveCurve(
  driveDb = 12,
  warmth = 0.4,
  numSamples = 1024,
) {
  const curve = new Float32Array(numSamples);
  const gain = Math.pow(10, driveDb / 20);

  for (let i = 0; i < numSamples; i++) {
    const x = (i * 2) / (numSamples - 1) - 1;
    const driven = x * gain;
    // Asymmetric soft-clipping saturation
    const soft = driven / (1.0 + Math.abs(driven));
    // Warm 2nd harmonic tone contour
    const warm = soft + warmth * 0.2 * (1.0 - Math.abs(x)) * x;
    curve[i] = Math.max(-1.0, Math.min(1.0, warm));
  }
  return curve;
}

/**
 * Generates an openDAW-style multi-equation waveshaper transfer curve.
 * Equations: "hardclip" | "softclip" | "sigmoid" | "atan" | "sin" | "foldback"
 *
 * @param {string} equation - Transfer function type.
 * @param {number} driveDb - Input drive in dB (0 to 30 dB).
 * @param {number} numSamples - Curve resolution (default: 1024).
 * @returns {Float32Array}
 */
export function createWaveshaperCurve(
  equation = "softclip",
  driveDb = 6,
  numSamples = 1024,
) {
  const curve = new Float32Array(numSamples);
  const gain = Math.pow(10, (driveDb || 0) / 20);
  const eq = String(equation || "softclip").toLowerCase();

  for (let i = 0; i < numSamples; i++) {
    const x = (i * 2) / (numSamples - 1) - 1;
    const d = x * gain;
    let y = d;
    if (eq === "hardclip") {
      y = Math.max(-1, Math.min(1, d));
    } else if (eq === "sigmoid") {
      y = 2 / (1 + Math.exp(-2 * d)) - 1;
    } else if (eq === "atan") {
      y = (2 / Math.PI) * Math.atan(d);
    } else if (eq === "sin") {
      y = Math.sin(Math.max(-Math.PI, Math.min(Math.PI, d)));
    } else if (eq === "foldback") {
      y = Math.sin(d * (Math.PI / 2));
    } else {
      // softclip (tanh)
      y = Math.tanh(d);
    }
    curve[i] = Math.max(-1, Math.min(1, y));
  }
  return curve;
}

/**
 * Pure biquad filter processor for offline audio rendering.
 */
function makeOfflineBiquad(
  type,
  freq,
  q = 0.707,
  gainDb = 0,
  sampleRate = 44100,
) {
  const clampedFreq = Math.max(20, Math.min(sampleRate * 0.48, freq || 1000));
  const w0 = (2 * Math.PI * clampedFreq) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const safeQ = Math.max(0.1, q || 0.707);
  const alpha = sinW0 / (2 * safeQ);
  const A = Math.pow(10, (gainDb || 0) / 40);

  let b0 = 1,
    b1 = 0,
    b2 = 0,
    a0 = 1,
    a1 = 0,
    a2 = 0;

  if (type === "highpass") {
    b0 = (1 + cosW0) / 2;
    b1 = -(1 + cosW0);
    b2 = (1 + cosW0) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cosW0;
    a2 = 1 - alpha;
  } else if (type === "lowpass") {
    b0 = (1 - cosW0) / 2;
    b1 = 1 - cosW0;
    b2 = (1 - cosW0) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cosW0;
    a2 = 1 - alpha;
  } else if (type === "bandpass") {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
    a0 = 1 + alpha;
    a1 = -2 * cosW0;
    a2 = 1 - alpha;
  } else if (type === "peaking") {
    b0 = 1 + alpha * A;
    b1 = -2 * cosW0;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cosW0;
    a2 = 1 - alpha / A;
  } else if (type === "lowshelf") {
    const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
    b0 = A * (A + 1 - (A - 1) * cosW0 + twoSqrtAAlpha);
    b1 = 2 * A * (A - 1 - (A + 1) * cosW0);
    b2 = A * (A + 1 - (A - 1) * cosW0 - twoSqrtAAlpha);
    a0 = A + 1 + (A - 1) * cosW0 + twoSqrtAAlpha;
    a1 = -2 * (A - 1 + (A + 1) * cosW0);
    a2 = A + 1 + (A - 1) * cosW0 - twoSqrtAAlpha;
  } else if (type === "highshelf") {
    const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
    b0 = A * (A + 1 + (A - 1) * cosW0 + twoSqrtAAlpha);
    b1 = -2 * A * (A - 1 + (A + 1) * cosW0);
    b2 = A * (A + 1 + (A - 1) * cosW0 - twoSqrtAAlpha);
    a0 = A + 1 - (A - 1) * cosW0 + twoSqrtAAlpha;
    a1 = 2 * (A - 1 - (A + 1) * cosW0);
    a2 = A + 1 - (A - 1) * cosW0 - twoSqrtAAlpha;
  }

  const nb0 = b0 / a0;
  const nb1 = b1 / a0;
  const nb2 = b2 / a0;
  const na1 = a1 / a0;
  const na2 = a2 / a0;

  return {
    processBuffer(buf) {
      let x1 = 0,
        x2 = 0,
        y1 = 0,
        y2 = 0;
      const out = new Float32Array(buf.length);
      for (let i = 0; i < buf.length; i++) {
        const x = buf[i];
        const y = nb0 * x + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        out[i] = y;
      }
      return out;
    },
  };
}

/**
 * Applies a transfer curve (Float32Array) to an audio buffer with dry/wet mix.
 */
function applyTransferCurve(input, curve, mix = 1.0) {
  const len = input.length;
  const out = new Float32Array(len);
  const n = curve.length - 1;
  const m = Math.max(0, Math.min(1, mix));
  for (let i = 0; i < len; i++) {
    const x = Math.max(-1, Math.min(1, input[i]));
    const pos = (x + 1) * 0.5 * n;
    const idx0 = Math.floor(pos);
    const idx1 = Math.min(n, idx0 + 1);
    const frac = pos - idx0;
    const shaped = curve[idx0] * (1 - frac) + curve[idx1] * frac;
    out[i] = input[i] * (1 - m) + shaped * m;
  }
  return out;
}

/**
 * Pure sample-level offline FX chain processor for a track.
 * Runs identically in Node.js and browser offline bounce / mix analysis.
 *
 * @param {Float32Array} left
 * @param {Float32Array} right
 * @param {Array<object>} trackFx
 * @param {number} [bpm=120]
 * @param {number} [sampleRate=44100]
 * @returns {{ outLeft: Float32Array, outRight: Float32Array }}
 */
export function processTrackOfflineFx(
  left,
  right,
  trackFx = [],
  bpm = 120,
  sampleRate = 44100,
) {
  let curL = new Float32Array(left);
  let curR = new Float32Array(right || left);

  if (!Array.isArray(trackFx) || trackFx.length === 0) {
    return { outLeft: curL, outRight: curR };
  }

  const stepSec = 60 / Math.max(20, bpm || 120) / 4;

  for (const rawFx of trackFx) {
    if (!rawFx || rawFx.enabled === false) continue;
    const fx = { ...(rawFx.params || {}), ...rawFx };
    const type = String(fx.type || "").toLowerCase();

    if (type === "fold") {
      const driveDb = fx.driveDb ?? fx.drive ?? 6;
      const mix = fx.mix ?? fx.wet ?? 1.0;
      const curve = createWavefolderCurve(driveDb, 1024);
      curL = applyTransferCurve(curL, curve, mix);
      curR = applyTransferCurve(curR, curve, mix);
    } else if (type === "waveshaper") {
      const driveDb = fx.driveDb ?? fx.drive ?? 6;
      const mix = fx.mix ?? fx.wet ?? 1.0;
      const curve = createWaveshaperCurve(
        fx.equation || "softclip",
        driveDb,
        1024,
      );
      curL = applyTransferCurve(curL, curve, mix);
      curR = applyTransferCurve(curR, curve, mix);
    } else if (type === "crusher") {
      const bits = fx.bits ?? 8;
      const downsample = fx.downsample ?? 1;
      const mix = fx.mix ?? fx.wet ?? 1.0;
      const crushedL = processCrusherBuffer(curL, bits, downsample);
      const crushedR = processCrusherBuffer(curR, bits, downsample);
      for (let i = 0; i < curL.length; i++) {
        curL[i] = curL[i] * (1 - mix) + crushedL[i] * mix;
        curR[i] = curR[i] * (1 - mix) + crushedR[i] * mix;
      }
    } else if (type === "stereotool") {
      const res = processStereoTool(curL, curR, fx.width ?? 1.0, fx.pan ?? 0.0);
      curL = res.outLeft;
      curR = res.outRight;
    } else if (type === "revamp" || type === "eq") {
      const hpFreq = fx.hpFreq ?? 20;
      const lpFreq = fx.lpFreq ?? 18000;
      const lowGain = fx.lowGainDb ?? fx.lowGain ?? 0;
      const midGain = fx.midGainDb ?? fx.midGain ?? 0;
      const highGain = fx.highGainDb ?? fx.highGain ?? 0;
      const midFreq = fx.midFreq ?? 1200;
      const midQ = fx.midQ ?? 1.2;

      if (hpFreq > 22) {
        curL = makeOfflineBiquad(
          "highpass",
          hpFreq,
          0.707,
          0,
          sampleRate,
        ).processBuffer(curL);
        curR = makeOfflineBiquad(
          "highpass",
          hpFreq,
          0.707,
          0,
          sampleRate,
        ).processBuffer(curR);
      }
      if (Math.abs(lowGain) > 0.05) {
        curL = makeOfflineBiquad(
          "lowshelf",
          220,
          0.707,
          lowGain,
          sampleRate,
        ).processBuffer(curL);
        curR = makeOfflineBiquad(
          "lowshelf",
          220,
          0.707,
          lowGain,
          sampleRate,
        ).processBuffer(curR);
      }
      if (Math.abs(midGain) > 0.05) {
        curL = makeOfflineBiquad(
          "peaking",
          midFreq,
          midQ,
          midGain,
          sampleRate,
        ).processBuffer(curL);
        curR = makeOfflineBiquad(
          "peaking",
          midFreq,
          midQ,
          midGain,
          sampleRate,
        ).processBuffer(curR);
      }
      if (Math.abs(highGain) > 0.05) {
        curL = makeOfflineBiquad(
          "highshelf",
          3800,
          0.707,
          highGain,
          sampleRate,
        ).processBuffer(curL);
        curR = makeOfflineBiquad(
          "highshelf",
          3800,
          0.707,
          highGain,
          sampleRate,
        ).processBuffer(curR);
      }
      if (lpFreq < 17900) {
        curL = makeOfflineBiquad(
          "lowpass",
          lpFreq,
          0.707,
          0,
          sampleRate,
        ).processBuffer(curL);
        curR = makeOfflineBiquad(
          "lowpass",
          lpFreq,
          0.707,
          0,
          sampleRate,
        ).processBuffer(curR);
      }
    } else if (type === "filter" || type === "biquad") {
      const fType = fx.filterType || fx.params?.type || "highpass";
      const freq = fx.frequency ?? fx.cutoff ?? 120;
      const q = fx.Q ?? fx.resonance ?? 0.707;
      curL = makeOfflineBiquad(fType, freq, q, 0, sampleRate).processBuffer(
        curL,
      );
      curR = makeOfflineBiquad(fType, freq, q, 0, sampleRate).processBuffer(
        curR,
      );
    } else if (type === "compressor") {
      const threshDb = fx.threshold ?? -12;
      const ratio = Math.max(1, fx.ratio ?? 4);
      const wet = fx.wet ?? fx.mix ?? 1.0;
      const atkCoeff = Math.exp(
        -1 / (Math.max(0.001, fx.attack ?? 0.005) * sampleRate),
      );
      const relCoeff = Math.exp(
        -1 / (Math.max(0.01, fx.release ?? 0.12) * sampleRate),
      );
      let env = 0;
      for (let i = 0; i < curL.length; i++) {
        const peak = Math.max(Math.abs(curL[i]), Math.abs(curR[i]));
        env =
          peak > env
            ? peak + (env - peak) * atkCoeff
            : peak + (env - peak) * relCoeff;
        let g = 1.0;
        const envDb = 20 * Math.log10(Math.max(1e-6, env));
        if (envDb > threshDb) {
          const reducedDb = threshDb + (envDb - threshDb) / ratio;
          g = Math.pow(10, (reducedDb - envDb) / 20);
        }
        curL[i] = curL[i] * (1 - wet) + curL[i] * g * wet;
        curR[i] = curR[i] * (1 - wet) + curR[i] * g * wet;
      }
    } else if (type === "delay") {
      const stepsL = Math.max(1, fx.timeStepsL ?? fx.time ?? 3);
      const stepsR = Math.max(1, fx.timeStepsR ?? fx.time ?? 4);
      const fb = Math.max(0, Math.min(0.92, fx.feedback ?? 0.35));
      const wet = Math.max(0, Math.min(1, fx.wet ?? fx.mix ?? 0.3));
      const delayFramesL = Math.max(
        1,
        Math.round(stepsL * stepSec * sampleRate),
      );
      const delayFramesR = Math.max(
        1,
        Math.round(stepsR * stepSec * sampleRate),
      );
      const bufL = new Float32Array(curL.length);
      const bufR = new Float32Array(curR.length);
      for (let i = 0; i < curL.length; i++) {
        const dL = i >= delayFramesL ? bufL[i - delayFramesL] : 0;
        const dR = i >= delayFramesR ? bufR[i - delayFramesR] : 0;
        bufL[i] = curL[i] + dL * fb;
        bufR[i] = curR[i] + dR * fb;
        curL[i] = Math.max(
          -1,
          Math.min(1, curL[i] * (1 - wet * 0.5) + dL * wet),
        );
        curR[i] = Math.max(
          -1,
          Math.min(1, curR[i] * (1 - wet * 0.5) + dR * wet),
        );
      }
    } else if (type === "reverb") {
      const decay = Math.max(0.1, Math.min(5.0, fx.decay ?? 1.5));
      const damping = Math.max(0, Math.min(1.0, fx.damping ?? 0.5));
      const preDelayFrames = Math.max(
        0,
        Math.round(((fx.preDelayMs ?? 10) / 1000) * sampleRate),
      );
      const wet = Math.max(0, Math.min(1, fx.wet ?? fx.mix ?? 0.25));
      // Multi-tap Schroeder comb reflections for fast offline execution
      const tapMs = [29.7, 37.1, 41.1, 43.7];
      const tapFrames = tapMs.map((ms) =>
        Math.max(1, Math.round((ms / 1000) * sampleRate)),
      );
      const tapGains = tapFrames.map((f) =>
        Math.pow(10, (-3 * (f / sampleRate)) / decay),
      );
      const revL = new Float32Array(curL.length);
      const revR = new Float32Array(curR.length);
      let lpL = 0,
        lpR = 0;
      const damp = 0.2 + (1 - damping) * 0.6;
      for (let i = 0; i < curL.length; i++) {
        const srcIdx = i - preDelayFrames;
        let accL = srcIdx >= 0 ? curL[srcIdx] * 0.35 : 0;
        let accR = srcIdx >= 0 ? curR[srcIdx] * 0.35 : 0;
        for (let t = 0; t < tapFrames.length; t++) {
          const tf = tapFrames[t];
          if (i >= tf) {
            accL += revL[i - tf] * tapGains[t] * 0.24;
            accR += revR[(i - tf) % revR.length] * tapGains[t] * 0.24;
          }
        }
        lpL += damp * (accL - lpL);
        lpR += damp * (accR - lpR);
        revL[i] = lpL;
        revR[i] = lpR;
        curL[i] = Math.max(
          -1,
          Math.min(1, curL[i] * (1 - wet * 0.4) + lpL * wet),
        );
        curR[i] = Math.max(
          -1,
          Math.min(1, curR[i] * (1 - wet * 0.4) + lpR * wet),
        );
      }
    } else if (type === "tidal") {
      const res = processTidal(curL, curR, fx, bpm, sampleRate);
      curL = res.outLeft;
      curR = res.outRight;
    } else if (type === "transient") {
      const res = processTransientShaper(curL, curR, fx, sampleRate);
      curL = res.outLeft;
      curR = res.outRight;
    } else if (type === "maximizer") {
      const res = processMaximizer(curL, curR, fx, sampleRate);
      curL = res.outLeft;
      curR = res.outRight;
    } else if (type === "autotune") {
      const res = processAutotune(curL, curR, fx, sampleRate);
      curL = res.outLeft;
      curR = res.outRight;
    } else if (type === "vocoder") {
      const res = processVocoder(curL, curR, null, null, fx, sampleRate);
      curL = res.outLeft;
      curR = res.outRight;
    }
  }

  return { outLeft: curL, outRight: curR };
}

/**
 * Builds a live/offline Web Audio API FX node chain for a track and connects it to `dest`.
 * Returns `{ input, nodes, disconnect }` so `DawEngine._updateGraph` and `bounce`
 * route track signal through `track.fx`.
 *
 * @param {AudioContext|OfflineAudioContext} ctx
 * @param {AudioNode} dest
 * @param {Array<object>} trackFx
 * @param {number} [bpm=120]
 * @returns {{ input: AudioNode, nodes: AudioNode[], disconnect: () => void }}
 */
export function buildTrackFxChain(ctx, dest, trackFx = [], bpm = 120) {
  const nodes = [];
  if (!ctx || !Array.isArray(trackFx) || trackFx.length === 0) {
    return {
      input: dest,
      nodes,
      disconnect() {},
    };
  }

  const entryGain = ctx.createGain();
  nodes.push(entryGain);
  let tail = entryGain;
  const stepSec = 60 / Math.max(20, bpm || 120) / 4;

  for (const rawFx of trackFx) {
    if (!rawFx || rawFx.enabled === false) continue;
    const fx = { ...(rawFx.params || {}), ...rawFx };
    const type = String(fx.type || "").toLowerCase();

    if (type === "fold" || type === "waveshaper" || type === "crusher") {
      const shaper = ctx.createWaveShaper();
      if (type === "fold") {
        shaper.curve = createWavefolderCurve(fx.driveDb ?? fx.drive ?? 6, 1024);
      } else if (type === "waveshaper") {
        shaper.curve = createWaveshaperCurve(
          fx.equation || "softclip",
          fx.driveDb ?? fx.drive ?? 6,
          1024,
        );
      } else {
        // Quantized step transfer curve for live crusher node
        const bits = fx.bits ?? 8;
        const step = Math.pow(0.5, bits - 1);
        const curve = new Float32Array(1024);
        for (let i = 0; i < 1024; i++) {
          const x = (i * 2) / 1023 - 1;
          curve[i] = step * Math.round(x / step);
        }
        shaper.curve = curve;
      }
      shaper.oversample = "2x";
      tail.connect(shaper);
      tail = shaper;
      nodes.push(shaper);
    } else if (type === "revamp" || type === "eq") {
      const hpFreq = fx.hpFreq ?? 20;
      if (hpFreq > 22) {
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = hpFreq;
        hp.Q.value = 0.707;
        tail.connect(hp);
        tail = hp;
        nodes.push(hp);
      }
      const lowGain = fx.lowGainDb ?? fx.lowGain ?? 0;
      if (Math.abs(lowGain) > 0.05) {
        const ls = ctx.createBiquadFilter();
        ls.type = "lowshelf";
        ls.frequency.value = 220;
        if (ls.gain) ls.gain.value = lowGain;
        tail.connect(ls);
        tail = ls;
        nodes.push(ls);
      }
      const midGain = fx.midGainDb ?? fx.midGain ?? 0;
      if (Math.abs(midGain) > 0.05) {
        const pk = ctx.createBiquadFilter();
        pk.type = "peaking";
        pk.frequency.value = fx.midFreq ?? 1200;
        pk.Q.value = fx.midQ ?? 1.2;
        if (pk.gain) pk.gain.value = midGain;
        tail.connect(pk);
        tail = pk;
        nodes.push(pk);
      }
      const highGain = fx.highGainDb ?? fx.highGain ?? 0;
      if (Math.abs(highGain) > 0.05) {
        const hs = ctx.createBiquadFilter();
        hs.type = "highshelf";
        hs.frequency.value = 3800;
        if (hs.gain) hs.gain.value = highGain;
        tail.connect(hs);
        tail = hs;
        nodes.push(hs);
      }
    } else if (type === "filter" || type === "biquad") {
      const flt = ctx.createBiquadFilter();
      flt.type = fx.filterType || fx.params?.type || "highpass";
      flt.frequency.value = fx.frequency ?? fx.cutoff ?? 120;
      flt.Q.value = fx.Q ?? fx.resonance ?? 0.707;
      tail.connect(flt);
      tail = flt;
      nodes.push(flt);
    } else if (type === "compressor" || type === "maximizer") {
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = fx.threshold ?? -12;
      comp.ratio.value = fx.ratio ?? (type === "maximizer" ? 20 : 4);
      comp.attack.value = fx.attack ?? 0.003;
      comp.release.value = fx.release ?? 0.15;
      tail.connect(comp);
      tail = comp;
      nodes.push(comp);
    } else if (type === "delay") {
      const dryGain = ctx.createGain();
      const wetGain = ctx.createGain();
      const outMix = ctx.createGain();
      const dly = ctx.createDelay(5.0);
      const fb = ctx.createGain();
      const steps = Math.max(1, fx.timeStepsL ?? fx.time ?? 3);
      const wet = Math.max(0, Math.min(1, fx.wet ?? fx.mix ?? 0.3));
      dly.delayTime.value = Math.min(4.9, steps * stepSec);
      fb.gain.value = Math.max(0, Math.min(0.9, fx.feedback ?? 0.35));
      dryGain.gain.value = 1.0;
      wetGain.gain.value = wet;

      tail.connect(dryGain);
      dryGain.connect(outMix);
      tail.connect(dly);
      dly.connect(fb);
      fb.connect(dly);
      dly.connect(wetGain);
      wetGain.connect(outMix);
      tail = outMix;
      nodes.push(dryGain, wetGain, outMix, dly, fb);
    } else if (type === "reverb") {
      const dryGain = ctx.createGain();
      const wetGain = ctx.createGain();
      const outMix = ctx.createGain();
      const wet = Math.max(0, Math.min(1, fx.wet ?? fx.mix ?? 0.25));
      dryGain.gain.value = 1.0;
      wetGain.gain.value = wet;
      tail.connect(dryGain);
      dryGain.connect(outMix);

      if (typeof ctx.createConvolver === "function") {
        const conv = ctx.createConvolver();
        const sr = ctx.sampleRate || 44100;
        const imp = generateReverbImpulse(
          sr,
          fx.decay ?? 1.2,
          fx.damping ?? 0.5,
          fx.preDelayMs ?? 10,
        );
        const buf = ctx.createBuffer(2, imp.left.length, sr);
        buf.getChannelData(0).set(imp.left);
        if (buf.numberOfChannels > 1) buf.getChannelData(1).set(imp.right);
        conv.buffer = buf;
        tail.connect(conv);
        conv.connect(wetGain);
        nodes.push(conv);
      } else {
        // Fallback diffuser delay when ConvolverNode is absent in mock
        const revDelay = ctx.createDelay(1.0);
        revDelay.delayTime.value = 0.035;
        tail.connect(revDelay);
        revDelay.connect(wetGain);
        nodes.push(revDelay);
      }
      wetGain.connect(outMix);
      tail = outMix;
      nodes.push(dryGain, wetGain, outMix);
    } else if (type === "stereotool") {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, fx.pan ?? 0));
      tail.connect(panner);
      tail = panner;
      nodes.push(panner);
    }
  }

  tail.connect(dest);
  return {
    input: entryGain,
    nodes,
    disconnect() {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          // ignore
        }
      }
    },
  };
}

/**
 * Analyzes an audio buffer (peak dBFS, RMS dBFS, crest factor, clipping, frequency balance, and suggestions).
 * Ported concepts from claw-daw audio/metering and openDAW rms/analyser.
 *
 * @param {object} options
 * @param {Float32Array} options.left - Left channel audio data.
 * @param {Float32Array} [options.right] - Right channel audio data.
 * @param {number} [options.sampleRate=44100] - Sample rate.
 * @returns {object} Analysis report with metrics and actionable suggestions.
 */
export function analyzeAudioBuffer({ left, right, sampleRate = 44100 }) {
  if (!left || left.length === 0) {
    return {
      ok: false,
      error: "Empty or invalid audio buffer",
    };
  }

  const numFrames = left.length;
  const hasRight = right && right.length === numFrames;

  let maxL = 0;
  let maxR = 0;
  let sumSqL = 0;
  let sumSqR = 0;
  let clippedCount = 0;

  let lowEnergy = 0;
  let midEnergy = 0;
  let highEnergy = 0;

  // Single-pole filters for 3-band energy partitioning:
  // Low cutoff ~ 250 Hz, High cutoff ~ 4 kHz
  const dt = 1.0 / sampleRate;
  const rcLow = 1.0 / (2.0 * Math.PI * 250);
  const alphaLow = dt / (rcLow + dt);
  const rcHigh = 1.0 / (2.0 * Math.PI * 4000);
  const alphaHigh = rcHigh / (rcHigh + dt);

  let prevLowL = 0;
  let prevHighInL = 0;
  let prevHighOutL = 0;

  for (let i = 0; i < numFrames; i++) {
    const sL = left[i];
    const absL = Math.abs(sL);
    if (absL > maxL) maxL = absL;
    sumSqL += sL * sL;
    if (absL >= 0.999) clippedCount++;

    if (hasRight) {
      const sR = right[i];
      const absR = Math.abs(sR);
      if (absR > maxR) maxR = absR;
      sumSqR += sR * sR;
      if (absR >= 0.999) clippedCount++;
    }

    // Band energy estimation (Left channel)
    prevLowL += alphaLow * (sL - prevLowL);
    lowEnergy += prevLowL * prevLowL;

    prevHighOutL = alphaHigh * (prevHighOutL + sL - prevHighInL);
    prevHighInL = sL;
    highEnergy += prevHighOutL * prevHighOutL;

    const midSample = sL - prevLowL - prevHighOutL;
    midEnergy += midSample * midSample;
  }

  const peak = Math.max(maxL, maxR || maxL);
  const totalChannels = hasRight ? 2 : 1;
  const rms = Math.sqrt((sumSqL + sumSqR) / (totalChannels * numFrames));

  const peakDb = peak > 1e-6 ? 20 * Math.log10(peak) : -96.0;
  const rmsDb = rms > 1e-6 ? 20 * Math.log10(rms) : -96.0;
  const crestFactorDb = Math.max(0, peakDb - rmsDb);

  const totalBand = Math.max(1e-6, lowEnergy + midEnergy + highEnergy);
  const bandBalance = {
    low: Math.round((lowEnergy / totalBand) * 100) / 100,
    mid: Math.round((midEnergy / totalBand) * 100) / 100,
    high: Math.round((highEnergy / totalBand) * 100) / 100,
  };

  // Multi-frame 512-point Hann-windowed DFT for accurate 5-band energy & spectral centroid
  const fftSize = Math.min(512, numFrames);
  const halfBins = Math.floor(fftSize / 2);
  let eSub = 0,
    eLow = 0,
    eMid = 0,
    eHighMid = 0,
    eHigh = 0;
  let weightedFreqSum = 0;
  let magSum = 0;

  if (fftSize >= 64 && peak > 1e-5) {
    const numWindows = Math.min(
      6,
      Math.max(1, Math.floor(numFrames / fftSize)),
    );
    const step = Math.max(
      1,
      Math.floor((numFrames - fftSize) / Math.max(1, numWindows)),
    );
    for (let w = 0; w < numWindows; w++) {
      const start = Math.min(numFrames - fftSize, w * step);
      let winRms = 0;
      for (let n = 0; n < fftSize; n++) {
        const s = left[start + n];
        winRms += s * s;
      }
      if (winRms / fftSize < 1e-7) continue;

      for (let k = 1; k < halfBins; k++) {
        let re = 0,
          im = 0;
        const omega = (-2 * Math.PI * k) / fftSize;
        for (let n = 0; n < fftSize; n++) {
          const hann = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (fftSize - 1)));
          const s = left[start + n] * hann;
          const angle = omega * n;
          re += s * Math.cos(angle);
          im += s * Math.sin(angle);
        }
        const power = re * re + im * im;
        const mag = Math.sqrt(power);
        const freq = (k * sampleRate) / fftSize;
        weightedFreqSum += freq * mag;
        magSum += mag;

        if (freq < 90) eSub += power;
        else if (freq < 400) eLow += power;
        else if (freq < 1200) eMid += power;
        else if (freq < 4000) eHighMid += power;
        else eHigh += power;
      }
    }
  }

  const total5 = Math.max(1e-9, eSub + eLow + eMid + eHighMid + eHigh);
  const bandEnergy = {
    sub: Math.round((eSub / total5) * 1000) / 1000,
    low: Math.round((eLow / total5) * 1000) / 1000,
    mid: Math.round((eMid / total5) * 1000) / 1000,
    highMid: Math.round((eHighMid / total5) * 1000) / 1000,
    high: Math.round((eHigh / total5) * 1000) / 1000,
  };
  const spectralCentroidHz =
    magSum > 1e-6 ? Math.round((weightedFreqSum / magSum) * 10) / 10 : 0;

  // Estimate pitch in early sustain window vs tail window to measure pitch sag
  function detectWindowPitch(startFrame, endFrame) {
    const span = endFrame - startFrame;
    if (span < 256) return 0;
    const minLag = Math.max(8, Math.floor(sampleRate / 2200));
    const maxLag = Math.min(Math.floor(span / 2), Math.floor(sampleRate / 70));
    let bestLag = 0;
    let bestCorr = 0;
    const winLen = Math.min(512, span - maxLag);
    if (winLen < 64) return 0;

    let e0 = 0;
    for (let i = 0; i < winLen; i++) {
      const s = left[startFrame + i];
      e0 += s * s;
    }
    if (e0 < 1e-6) return 0;

    for (let lag = minLag; lag <= maxLag; lag++) {
      let c = 0;
      let eLag = 0;
      for (let i = 0; i < winLen; i++) {
        const a = left[startFrame + i];
        const b = left[startFrame + i + lag];
        c += a * b;
        eLag += b * b;
      }
      const norm = Math.sqrt(e0 * Math.max(1e-9, eLag));
      const r = norm > 1e-6 ? c / norm : 0;
      if (r > bestCorr) {
        bestCorr = r;
        bestLag = lag;
      }
    }
    return bestLag > 0 && bestCorr > 0.25 ? sampleRate / bestLag : 0;
  }

  // Find active bounds (above 5% of peak)
  let firstActive = 0;
  let lastActive = numFrames - 1;
  const activeThresh = Math.max(1e-4, peak * 0.06);
  for (let i = 0; i < numFrames; i++) {
    if (Math.abs(left[i]) >= activeThresh) {
      firstActive = i;
      break;
    }
  }
  for (let i = numFrames - 1; i >= firstActive; i--) {
    if (Math.abs(left[i]) >= activeThresh) {
      lastActive = i;
      break;
    }
  }
  const activeSpan = Math.max(1, lastActive - firstActive);
  const startPitchHz = detectWindowPitch(
    firstActive + Math.floor(activeSpan * 0.08),
    firstActive + Math.floor(activeSpan * 0.45),
  );
  const endPitchHz = detectWindowPitch(
    firstActive + Math.floor(activeSpan * 0.8),
    lastActive,
  );
  const estimatedPitchHz = startPitchHz || endPitchHz || 0;
  const pitchSagSemitones =
    startPitchHz > 20 && endPitchHz > 20
      ? Math.round(12 * Math.log2(endPitchHz / startPitchHz) * 100) / 100
      : 0;

  const suggestions = [];
  const clipping = clippedCount > 0;

  if (clipping) {
    suggestions.push(
      `Clipping detected (${clippedCount} samples >= 0 dBFS): reduce master volume or engage master limiter.`,
    );
  } else if (peakDb > -0.3) {
    suggestions.push(
      `Peak level is hot (${peakDb.toFixed(2)} dBFS): consider lowering master fader by ${(peakDb - -0.3).toFixed(1)} dB to prevent ISP inter-sample peaks.`,
    );
  } else {
    suggestions.push(
      `Master headroom is clean (${peakDb.toFixed(2)} dBFS peak) with zero clipping.`,
    );
  }

  if (rmsDb < -22.0) {
    suggestions.push(
      `Mix is quiet (${rmsDb.toFixed(1)} dBFS RMS): raise track faders or increase master bus compression to target -14 dBFS.`,
    );
  } else if (rmsDb > -10.0) {
    suggestions.push(
      `Mix is heavily squashed (${rmsDb.toFixed(1)} dBFS RMS): back off master compression to recover dynamic range.`,
    );
  }

  if (bandBalance.low > 0.45) {
    suggestions.push(
      `Bass energy is prominent (${Math.round(bandBalance.low * 100)}%): apply HPF below 80Hz on rhythm guitars and synths to clean mud.`,
    );
  }

  const summary = [
    `Peak: ${peakDb.toFixed(2)} dBFS | RMS: ${rmsDb.toFixed(2)} dBFS | Dynamic Range: ${crestFactorDb.toFixed(2)} dB`,
    `Centroid: ${spectralCentroidHz.toFixed(0)} Hz | Bands: Low ${Math.round(bandBalance.low * 100)}% | Mid ${Math.round(bandBalance.mid * 100)}% | High ${Math.round(bandBalance.high * 100)}%`,
    clipping
      ? `WARNING: ${clippedCount} clipped samples`
      : `Status: Clean headroom`,
  ].join(" | ");

  return {
    ok: true,
    peakDb: Math.round(peakDb * 100) / 100,
    rmsDb: Math.round(rmsDb * 100) / 100,
    crestFactorDb: Math.round(crestFactorDb * 100) / 100,
    clipping,
    clippedSampleCount: clippedCount,
    spectralCentroidHz,
    bandBalance,
    bandEnergy,
    estimatedPitchHz: Math.round(estimatedPitchHz * 10) / 10,
    startPitchHz: Math.round(startPitchHz * 10) / 10,
    endPitchHz: Math.round(endPitchHz * 10) / 10,
    pitchSagSemitones,
    summary,
    suggestions,
  };
}
