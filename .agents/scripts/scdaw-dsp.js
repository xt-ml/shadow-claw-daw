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
