// Ported from openDAW packages/lib/dsp @10088021 (AGPL-3.0-or-later, © André Michelle)
/**
 * .agents/scripts/scdaw-dsp.js
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

  // Single-pole filters for rough 3-band energy partitioning:
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
    `Bands: Low ${Math.round(bandBalance.low * 100)}% | Mid ${Math.round(bandBalance.mid * 100)}% | High ${Math.round(bandBalance.high * 100)}%`,
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
    bandBalance,
    summary,
    suggestions,
  };
}
