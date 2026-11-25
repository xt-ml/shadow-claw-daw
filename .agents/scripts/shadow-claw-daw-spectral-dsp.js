/**
 * .agents/scripts/shadow-claw-daw-spectral-dsp.js
 *
 * Pure Float32Array FFT/IFFT, windowing, calibrated power spectrum,
 * profile-based STFT noise reduction, spectrogram computation, spectral selection editing,
 * and clipping/silence/beat-onset analysis.
 * Ported from Audacity 3 (NoiseReduction.cpp, FindClippingBase.cpp, FFT.cpp, SpectrumAnalyst.cpp)
 * and Audacity 4 (spectrogramtypes.h, au3-fft).
 */

export const WINDOW_FUNCTIONS = Object.freeze([
  "rectangular",
  "bartlett",
  "hamming",
  "hann",
  "blackman",
  "blackmanHarris",
]);

export const SPECTROGRAM_PALETTES = Object.freeze([
  "roseus",
  "classic",
  "grayscale",
  "inverseGrayscale",
]);

export const SPECTROGRAM_SCALES = Object.freeze([
  "linear",
  "logarithmic",
  "mel",
]);

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
 * Return smallest power of 2 >= n (minimum 2).
 * @param {number} n
 * @returns {number}
 */
export function nextPowerOfTwo(n) {
  const target = Math.max(2, Math.ceil(Number(n) || 2));
  let p = 2;
  while (p < target) p <<= 1;
  return p;
}

/**
 * Create an analysis/synthesis window of length `size`.
 * @param {number} size
 * @param {string} [type="hann"]
 * @returns {Float32Array}
 */
export function createWindow(size, type = "hann") {
  const n = Math.max(2, Math.round(size));
  const win = new Float32Array(n);
  const t = String(type || "hann");
  const denom = n;

  for (let i = 0; i < n; i++) {
    const x = i / denom;
    if (t === "rectangular") {
      win[i] = 1.0;
    } else if (t === "bartlett") {
      win[i] = 1.0 - Math.abs((2 * i) / denom - 1.0);
    } else if (t === "hamming") {
      win[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * x);
    } else if (t === "blackman") {
      win[i] =
        0.42 -
        0.5 * Math.cos(2 * Math.PI * x) +
        0.08 * Math.cos(4 * Math.PI * x);
    } else if (t === "blackmanHarris") {
      win[i] =
        0.35875 -
        0.48829 * Math.cos(2 * Math.PI * x) +
        0.14128 * Math.cos(4 * Math.PI * x) -
        0.01168 * Math.cos(6 * Math.PI * x);
    } else {
      // Periodic Hann (matches Audacity STFT & COLA)
      win[i] = 0.5 * (1.0 - Math.cos(2 * Math.PI * x));
    }
  }
  return win;
}

/**
 * Forward radix-2 Cooley-Tukey complex FFT (returns newly allocated Float32Arrays).
 * @param {Float32Array|number[]} realIn
 * @param {Float32Array|number[]|null} [imagIn=null]
 * @returns {{ real: Float32Array, imag: Float32Array, size: number }}
 */
export function fft(realIn, imagIn = null) {
  const n = nextPowerOfTwo(realIn?.length || 2);
  const real = new Float32Array(n);
  const imag = new Float32Array(n);

  const copyLen = Math.min(n, realIn?.length || 0);
  for (let i = 0; i < copyLen; i++) real[i] = realIn[i];
  if (imagIn) {
    const imagLen = Math.min(n, imagIn.length);
    for (let i = 0; i < imagLen; i++) imag[i] = imagIn[i];
  }

  // Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      const tr = real[i];
      const ti = imag[i];
      real[i] = real[j];
      imag[i] = imag[j];
      real[j] = tr;
      imag[j] = ti;
    }
    let bit = n >> 1;
    while (bit > 0 && (j & bit) !== 0) {
      j ^= bit;
      bit >>= 1;
    }
    j |= bit;
  }

  // Butterfly stages
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wStepR = Math.cos(angle);
    const wStepI = Math.sin(angle);
    for (let start = 0; start < n; start += len) {
      let wR = 1.0;
      let wI = 0.0;
      for (let k = 0; k < half; k++) {
        const evenIdx = start + k;
        const oddIdx = evenIdx + half;
        const oddR = real[oddIdx] * wR - imag[oddIdx] * wI;
        const oddI = real[oddIdx] * wI + imag[oddIdx] * wR;

        real[oddIdx] = real[evenIdx] - oddR;
        imag[oddIdx] = imag[evenIdx] - oddI;
        real[evenIdx] += oddR;
        imag[evenIdx] += oddI;

        const nextWR = wR * wStepR - wI * wStepI;
        wI = wR * wStepI + wI * wStepR;
        wR = nextWR;
      }
    }
  }

  return { real, imag, size: n };
}

/**
 * Inverse FFT returning real-part Float32Array scaled by 1/N.
 * @param {Float32Array} realIn
 * @param {Float32Array} imagIn
 * @returns {Float32Array}
 */
export function ifft(realIn, imagIn) {
  const n = nextPowerOfTwo(realIn?.length || 2);
  const conjImag = new Float32Array(n);
  const imagLen = Math.min(n, imagIn?.length || 0);
  for (let i = 0; i < imagLen; i++) conjImag[i] = -imagIn[i];

  const { real } = fft(realIn, conjImag);
  const scale = 1.0 / n;
  for (let i = 0; i < n; i++) {
    real[i] *= scale;
  }
  return real;
}

/**
 * Convert frequency in Hz to nearest equal-temperament MIDI note name (e.g., 440 -> "A4").
 * @param {number} freqHz
 * @returns {string}
 */
export function freqToNoteName(freqHz) {
  const f = Number(freqHz);
  if (!Number.isFinite(f) || f <= 0) return "--";
  const midi = Math.round(69 + 12 * Math.log2(f / 440));
  const note = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

/**
 * Compute averaged calibrated power spectrum in dBFS.
 * Ported from Audacity SpectrumAnalyst.
 *
 * @param {Float32Array|number[]} samples
 * @param {{ fftSize?: number, windowType?: string, sampleRate?: number }} [options]
 * @returns {{ frequencies: Float32Array, magnitudesDb: Float32Array, peakFreq: number, peakDb: number, peakNote: string, fftSize: number, sampleRate: number, windowType: string }}
 */
export function computePowerSpectrum(samples, options = {}) {
  const sampleRate = Math.max(8000, Number(options.sampleRate ?? 44100));
  const fftSize = nextPowerOfTwo(
    Math.max(64, Math.min(16384, Number(options.fftSize ?? 2048))),
  );
  const windowType = WINDOW_FUNCTIONS.includes(options.windowType)
    ? options.windowType
    : "hann";

  const half = fftSize >> 1;
  const frequencies = new Float32Array(half);
  const magnitudesDb = new Float32Array(half);
  for (let i = 0; i < half; i++) {
    frequencies[i] = (i * sampleRate) / fftSize;
  }

  if (!samples || samples.length === 0) {
    magnitudesDb.fill(-120);
    return {
      frequencies,
      magnitudesDb,
      peakFreq: 0,
      peakDb: -120,
      peakNote: "--",
      fftSize,
      sampleRate,
      windowType,
    };
  }

  const win = createWindow(fftSize, windowType);
  let winSum = 0;
  for (let i = 0; i < fftSize; i++) winSum += win[i];
  const normScale = winSum > 0 ? 4.0 / (winSum * winSum) : 1.0;

  const accum = new Float64Array(half);
  const hop = Math.max(1, fftSize >> 1);
  let frames = 0;

  const padded =
    samples.length < fftSize
      ? (() => {
          const buf = new Float32Array(fftSize);
          buf.set(samples);
          return buf;
        })()
      : samples;

  const frameBuf = new Float32Array(fftSize);
  for (let start = 0; start + fftSize <= padded.length; start += hop) {
    for (let i = 0; i < fftSize; i++) {
      frameBuf[i] = padded[start + i] * win[i];
    }
    const { real, imag } = fft(frameBuf);
    for (let k = 0; k < half; k++) {
      accum[k] += (real[k] * real[k] + imag[k] * imag[k]) * normScale;
    }
    frames++;
  }

  let peakIdx = 1;
  let peakDb = -Infinity;
  for (let k = 0; k < half; k++) {
    const power = frames > 0 ? accum[k] / frames : 0;
    const db = Math.max(-120, 10 * Math.log10(Math.max(1e-12, power)));
    magnitudesDb[k] = db;
    if (k >= 1 && db > peakDb) {
      peakDb = db;
      peakIdx = k;
    }
  }

  const peakFreq = frequencies[peakIdx] || 0;
  return {
    frequencies,
    magnitudesDb,
    peakFreq,
    peakDb: Number.isFinite(peakDb) ? peakDb : -120,
    peakNote: freqToNoteName(peakFreq),
    fftSize,
    sampleRate,
    windowType,
  };
}

/**
 * Step 1 of Audacity Noise Reduction: capture per-bin noise power spectrum profile.
 *
 * @param {Float32Array[]} channels
 * @param {{ fftSize?: number, sampleRate?: number }} [options]
 * @returns {{ fftSize: number, sampleRate: number, bins: Float32Array, frameCount: number }}
 */
export function captureNoiseProfile(channels, options = {}) {
  const sampleRate = Math.max(8000, Number(options.sampleRate ?? 44100));
  const fftSize = nextPowerOfTwo(
    Math.max(256, Math.min(8192, Number(options.fftSize ?? 2048))),
  );
  const numBins = (fftSize >> 1) + 1;
  const win = createWindow(fftSize, "hann");
  const hop = fftSize >> 2; // 75% overlap (Audacity default)

  const mono =
    Array.isArray(channels) && channels.length > 0
      ? channels[0]
      : new Float32Array(0);
  const bins = new Float32Array(numBins);
  if (mono.length === 0) {
    return { fftSize, sampleRate, bins, frameCount: 0 };
  }

  const padded =
    mono.length < fftSize
      ? (() => {
          const b = new Float32Array(fftSize);
          b.set(mono);
          return b;
        })()
      : mono;

  const meanPower = new Float64Array(numBins);
  const frameBuf = new Float32Array(fftSize);
  let frameCount = 0;

  for (let start = 0; start + fftSize <= padded.length; start += hop) {
    for (let i = 0; i < fftSize; i++) {
      frameBuf[i] = padded[start + i] * win[i];
    }
    const { real, imag } = fft(frameBuf);
    for (let k = 0; k < numBins; k++) {
      const p = real[k] * real[k] + imag[k] * imag[k];
      meanPower[k] += p;
    }
    frameCount++;
  }

  if (frameCount > 0) {
    for (let k = 0; k < numBins; k++) {
      bins[k] = meanPower[k] / frameCount;
    }
  }

  return { fftSize, sampleRate, bins, frameCount };
}

/**
 * Step 2 of Audacity Noise Reduction: STFT spectral gating with sensitivity,
 * reduction dB, frequency smoothing, and time attack/release smoothing.
 *
 * @param {Float32Array[]} channels
 * @param {{ fftSize: number, bins: Float32Array }} noiseProfile
 * @param {{ reductionDb?: number, sensitivity?: number, freqSmoothingBands?: number, sampleRate?: number }} [options]
 * @returns {{ channels: Float32Array[], meta: Object }}
 */
export function applyNoiseReduction(channels, noiseProfile, options = {}) {
  if (!noiseProfile || !noiseProfile.bins) {
    throw new Error(
      "Noise profile is required. Capture a noise profile first using noise_profile.",
    );
  }
  const chs =
    Array.isArray(channels) && channels.length > 0
      ? channels
      : [new Float32Array(0)];
  const fftSize = noiseProfile.fftSize || 2048;
  const numBins = (fftSize >> 1) + 1;
  const hop = fftSize >> 2;
  const win = createWindow(fftSize, "hann");

  const reductionDb = Math.max(
    0,
    Math.min(48, Number(options.reductionDb ?? 12)),
  );
  const sensitivity = Math.max(
    0,
    Math.min(24, Number(options.sensitivity ?? 6)),
  );
  const freqSmooth = Math.max(
    0,
    Math.min(12, Math.round(options.freqSmoothingBands ?? 3)),
  );

  const noiseFloorGain = Math.pow(10, -reductionDb / 20);
  const sensLinear = Math.pow(10, sensitivity / 10);
  const attackCoeff = 0.65;
  const releaseCoeff = 0.85;

  // COLA normalization factor for Hann analysis + Hann synthesis at 75% overlap
  const colaNorm = new Float32Array(fftSize);
  for (let shift = 0; shift < fftSize; shift += hop) {
    for (let i = 0; i < fftSize; i++) {
      const idx = (i + shift) % fftSize;
      colaNorm[i] += win[idx] * win[idx];
    }
  }
  const avgCola = colaNorm[0] || 1.5;

  const out = chs.map((ch) => {
    const len = ch.length;
    if (len === 0) return new Float32Array(0);

    const paddedLen = Math.max(fftSize, len + fftSize);
    const padded = new Float32Array(paddedLen);
    const halfPad = fftSize >> 1;
    padded.set(ch, halfPad);

    const accum = new Float32Array(paddedLen);
    const frameBuf = new Float32Array(fftSize);
    const prevGains = new Float32Array(numBins).fill(noiseFloorGain);
    const rawGains = new Float32Array(numBins);
    const smoothGains = new Float32Array(numBins);

    for (let start = 0; start + fftSize <= paddedLen; start += hop) {
      for (let i = 0; i < fftSize; i++) {
        frameBuf[i] = padded[start + i] * win[i];
      }
      const { real, imag } = fft(frameBuf);

      for (let k = 0; k < numBins; k++) {
        const power = real[k] * real[k] + imag[k] * imag[k];
        const thresh = (noiseProfile.bins[k] || 0) * sensLinear;
        let targetGain = noiseFloorGain;
        if (thresh <= 1e-18 || power > thresh) {
          targetGain = 1.0;
        } else if (power > thresh * 0.25) {
          const ratio = (power - thresh * 0.25) / (thresh * 0.75);
          targetGain = noiseFloorGain + (1.0 - noiseFloorGain) * ratio;
        }
        // Time smoothing
        const coeff = targetGain > prevGains[k] ? attackCoeff : releaseCoeff;
        const smoothedT = prevGains[k] * coeff + targetGain * (1 - coeff);
        prevGains[k] = smoothedT;
        rawGains[k] = smoothedT;
      }

      // Frequency smoothing across neighboring bins
      if (freqSmooth > 0) {
        for (let k = 0; k < numBins; k++) {
          let sum = 0;
          let cnt = 0;
          const lo = Math.max(0, k - freqSmooth);
          const hi = Math.min(numBins - 1, k + freqSmooth);
          for (let b = lo; b <= hi; b++) {
            sum += rawGains[b];
            cnt++;
          }
          smoothGains[k] = sum / cnt;
        }
      } else {
        smoothGains.set(rawGains);
      }

      // Apply symmetric spectral gains to positive and negative frequency bins
      for (let k = 0; k < numBins; k++) {
        const g = smoothGains[k];
        real[k] *= g;
        imag[k] *= g;
        if (k > 0 && k < fftSize >> 1) {
          const mirror = fftSize - k;
          real[mirror] *= g;
          imag[mirror] *= g;
        }
      }

      const synth = ifft(real, imag);
      for (let i = 0; i < fftSize; i++) {
        accum[start + i] += (synth[i] * win[i]) / avgCola;
      }
    }

    const dst = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      dst[i] = Math.max(-1, Math.min(1, accum[i + halfPad]));
    }
    return dst;
  });

  return {
    channels: out,
    meta: { reductionDb, sensitivity, freqSmoothingBands: freqSmooth, fftSize },
  };
}

/**
 * Map normalized amplitude [0..1] to [r, g, b] for Audacity spectrogram palettes.
 * @param {number} norm01
 * @param {string} [palette="roseus"]
 * @returns {[number, number, number]}
 */
export function mapSpectrogramColor(norm01, palette = "roseus") {
  const t = Math.max(0, Math.min(1, Number(norm01) || 0));
  const p = String(palette || "roseus");

  if (p === "grayscale") {
    const v = Math.round(t * 255);
    return [v, v, v];
  }
  if (p === "inverseGrayscale") {
    const v = Math.round((1 - t) * 255);
    return [v, v, v];
  }
  if (p === "classic") {
    // Audacity classic: dark navy -> blue -> magenta -> red -> yellow -> white
    if (t < 0.25) {
      const k = t / 0.25;
      return [Math.round(k * 60), Math.round(k * 30), Math.round(40 + k * 140)];
    }
    if (t < 0.5) {
      const k = (t - 0.25) / 0.25;
      return [
        Math.round(60 + k * 140),
        Math.round(30 - k * 20),
        Math.round(180 - k * 40),
      ];
    }
    if (t < 0.75) {
      const k = (t - 0.5) / 0.25;
      return [
        Math.round(200 + k * 55),
        Math.round(10 + k * 160),
        Math.round(140 * (1 - k)),
      ];
    }
    const k = (t - 0.75) / 0.25;
    return [255, Math.round(170 + k * 85), Math.round(k * 255)];
  }
  // Roseus (Audacity 4 default): deep obsidian -> indigo -> rose -> amber -> cream
  if (t < 0.3) {
    const k = t / 0.3;
    return [
      Math.round(14 + k * 56),
      Math.round(16 + k * 20),
      Math.round(28 + k * 92),
    ];
  }
  if (t < 0.65) {
    const k = (t - 0.3) / 0.35;
    return [
      Math.round(70 + k * 155),
      Math.round(36 + k * 44),
      Math.round(120 - k * 10),
    ];
  }
  const k = (t - 0.65) / 0.35;
  return [
    Math.round(225 + k * 30),
    Math.round(80 + k * 165),
    Math.round(110 + k * 115),
  ];
}

function hzToMel(hz) {
  return 2595 * Math.log10(1 + Math.max(0, hz) / 700);
}

function melToHz(mel) {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

/**
 * Compute spectrogram matrix (column-major Float32Array in normalized [0..1]).
 *
 * @param {Float32Array} samples
 * @param {{ fftSize?: number, hopSize?: number, scale?: "linear"|"logarithmic"|"mel", rows?: number, minFreq?: number, maxFreq?: number, rangeDb?: number, sampleRate?: number }} [options]
 * @returns {{ columns: number, rows: number, data: Float32Array, minFreq: number, maxFreq: number, scale: string, fftSize: number, sampleRate: number }}
 */
export function computeSpectrogram(samples, options = {}) {
  const sampleRate = Math.max(8000, Number(options.sampleRate ?? 44100));
  const fftSize = nextPowerOfTwo(
    Math.max(128, Math.min(4096, Number(options.fftSize ?? 512))),
  );
  const hopSize = Math.max(32, Math.round(options.hopSize ?? fftSize >> 2));
  const rows = Math.max(8, Math.min(128, Math.round(options.rows ?? 32)));
  const scale = SPECTROGRAM_SCALES.includes(options.scale)
    ? options.scale
    : "linear";
  const minFreq = Math.max(20, Number(options.minFreq ?? 20));
  const maxFreq = Math.min(
    sampleRate / 2,
    Number(options.maxFreq ?? sampleRate / 2),
  );
  const rangeDb = Math.max(20, Number(options.rangeDb ?? 80));

  if (!samples || samples.length === 0) {
    return {
      columns: 1,
      rows,
      data: new Float32Array(rows),
      minFreq,
      maxFreq,
      scale,
      fftSize,
      sampleRate,
    };
  }

  const padded =
    samples.length < fftSize
      ? (() => {
          const b = new Float32Array(fftSize);
          b.set(samples);
          return b;
        })()
      : samples;

  const win = createWindow(fftSize, "hann");
  let winSum = 0;
  for (let i = 0; i < fftSize; i++) winSum += win[i];
  const normScale = winSum > 0 ? 4.0 / (winSum * winSum) : 1.0;

  const frameStarts = [];
  for (let s = 0; s + fftSize <= padded.length; s += hopSize) {
    frameStarts.push(s);
  }
  const columns = Math.max(1, frameStarts.length);
  const data = new Float32Array(columns * rows);
  const half = fftSize >> 1;

  // Precompute FFT bin mapping for each row (0 = low freq, rows-1 = high freq)
  const rowRanges = new Array(rows);
  for (let r = 0; r < rows; r++) {
    const f0Frac = r / rows;
    const f1Frac = (r + 1) / rows;
    let fLo;
    let fHi;
    if (scale === "logarithmic") {
      const logMin = Math.log(minFreq);
      const logMax = Math.log(Math.max(minFreq + 1, maxFreq));
      fLo = Math.exp(logMin + f0Frac * (logMax - logMin));
      fHi = Math.exp(logMin + f1Frac * (logMax - logMin));
    } else if (scale === "mel") {
      const mMin = hzToMel(minFreq);
      const mMax = hzToMel(maxFreq);
      fLo = melToHz(mMin + f0Frac * (mMax - mMin));
      fHi = melToHz(mMin + f1Frac * (mMax - mMin));
    } else {
      fLo = minFreq + f0Frac * (maxFreq - minFreq);
      fHi = minFreq + f1Frac * (maxFreq - minFreq);
    }
    const bLo = Math.max(
      1,
      Math.min(half - 1, Math.floor((fLo * fftSize) / sampleRate)),
    );
    const bHi = Math.max(
      bLo,
      Math.min(half - 1, Math.ceil((fHi * fftSize) / sampleRate)),
    );
    rowRanges[r] = [bLo, bHi];
  }

  const frameBuf = new Float32Array(fftSize);
  for (let c = 0; c < columns; c++) {
    const start = frameStarts[c];
    for (let i = 0; i < fftSize; i++) {
      frameBuf[i] = padded[start + i] * win[i];
    }
    const { real, imag } = fft(frameBuf);
    for (let r = 0; r < rows; r++) {
      const [bLo, bHi] = rowRanges[r];
      let maxPow = 0;
      for (let b = bLo; b <= bHi; b++) {
        const p = (real[b] * real[b] + imag[b] * imag[b]) * normScale;
        if (p > maxPow) maxPow = p;
      }
      const db = 10 * Math.log10(Math.max(1e-12, maxPow));
      const norm = Math.max(0, Math.min(1, (db + rangeDb) / rangeDb));
      data[c * rows + r] = norm;
    }
  }

  return {
    columns,
    rows,
    data,
    minFreq,
    maxFreq,
    scale,
    fftSize,
    sampleRate,
  };
}

/**
 * Apply Audacity spectral selection edit (delete, attenuate, amplify, or isolate)
 * over [lowFreq, highFreq] in STFT domain.
 *
 * @param {Float32Array[]} channels
 * @param {{ lowFreq?: number, highFreq?: number, mode?: "delete"|"attenuate"|"amplify"|"isolate", gainDb?: number, fftSize?: number, sampleRate?: number }} [options]
 * @returns {{ channels: Float32Array[], meta: Object }}
 */
export function applySpectralEdit(channels, options = {}) {
  const chs =
    Array.isArray(channels) && channels.length > 0
      ? channels
      : [new Float32Array(0)];
  const sampleRate = Math.max(8000, Number(options.sampleRate ?? 44100));
  const fftSize = nextPowerOfTwo(
    Math.max(256, Math.min(8192, Number(options.fftSize ?? 2048))),
  );
  const hop = fftSize >> 2;
  const win = createWindow(fftSize, "hann");
  const mode = String(options.mode || "delete").toLowerCase();
  const f1 = Math.max(0, Number(options.lowFreq ?? 0));
  const f2 = Math.min(
    sampleRate / 2,
    Number(options.highFreq ?? sampleRate / 2),
  );
  const lowFreq = Math.min(f1, f2);
  const highFreq = Math.max(f1, f2);

  let bandGain = 0;
  let outsideGain = 1;
  if (mode === "attenuate") {
    bandGain = Math.pow(10, -Math.abs(Number(options.gainDb ?? 18)) / 20);
  } else if (mode === "amplify") {
    bandGain = Math.pow(10, Number(options.gainDb ?? 6) / 20);
  } else if (mode === "isolate") {
    bandGain = 1;
    outsideGain = 0;
  }

  let avgCola = 0;
  for (let shift = 0; shift < fftSize; shift += hop) {
    avgCola += win[shift] * win[shift];
  }
  avgCola = avgCola || 1.5;

  const numBins = (fftSize >> 1) + 1;
  const binGains = new Float32Array(numBins);
  for (let k = 0; k < numBins; k++) {
    const freq = (k * sampleRate) / fftSize;
    binGains[k] = freq >= lowFreq && freq <= highFreq ? bandGain : outsideGain;
  }

  const out = chs.map((ch) => {
    const len = ch.length;
    if (len === 0) return new Float32Array(0);
    const halfPad = fftSize >> 1;
    const paddedLen = Math.max(fftSize, len + fftSize);
    const padded = new Float32Array(paddedLen);
    padded.set(ch, halfPad);

    const accum = new Float32Array(paddedLen);
    const frameBuf = new Float32Array(fftSize);
    for (let start = 0; start + fftSize <= paddedLen; start += hop) {
      for (let i = 0; i < fftSize; i++) {
        frameBuf[i] = padded[start + i] * win[i];
      }
      const { real, imag } = fft(frameBuf);
      for (let k = 0; k < numBins; k++) {
        const g = binGains[k];
        real[k] *= g;
        imag[k] *= g;
        if (k > 0 && k < fftSize >> 1) {
          const mirror = fftSize - k;
          real[mirror] *= g;
          imag[mirror] *= g;
        }
      }
      const synth = ifft(real, imag);
      for (let i = 0; i < fftSize; i++) {
        accum[start + i] += (synth[i] * win[i]) / avgCola;
      }
    }

    const dst = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      dst[i] = Math.max(-1, Math.min(1, accum[i + halfPad]));
    }
    return dst;
  });

  return {
    channels: out,
    meta: { mode, lowFreq, highFreq, fftSize },
  };
}

/**
 * Detect clipped runs >= minConsecutive samples.
 * Ported from Audacity FindClippingBase.
 *
 * @param {Float32Array[]} channels
 * @param {{ threshold?: number, minConsecutive?: number, sampleRate?: number }} [options]
 * @returns {Array<{ channel: number, startSample: number, endSample: number, lengthSamples: number, startSec: number, endSec: number }>}
 */
export function findClippingRegions(channels, options = {}) {
  const chs = Array.isArray(channels) ? channels : [];
  const threshold = Math.max(
    0.5,
    Math.min(1.0, Number(options.threshold ?? 0.999)),
  );
  const minConsecutive = Math.max(1, Math.round(options.minConsecutive ?? 3));
  const sr = Math.max(1, Number(options.sampleRate ?? 44100));
  const regions = [];

  chs.forEach((ch, chIdx) => {
    let runStart = -1;
    for (let i = 0; i < ch.length; i++) {
      if (Math.abs(ch[i]) >= threshold) {
        if (runStart === -1) runStart = i;
      } else if (runStart !== -1) {
        const runLen = i - runStart;
        if (runLen >= minConsecutive) {
          regions.push({
            channel: chIdx,
            startSample: runStart,
            endSample: i,
            lengthSamples: runLen,
            startSec: runStart / sr,
            endSec: i / sr,
          });
        }
        runStart = -1;
      }
    }
    if (runStart !== -1) {
      const runLen = ch.length - runStart;
      if (runLen >= minConsecutive) {
        regions.push({
          channel: chIdx,
          startSample: runStart,
          endSample: ch.length,
          lengthSamples: runLen,
          startSec: runStart / sr,
          endSec: ch.length / sr,
        });
      }
    }
  });

  return regions;
}

/**
 * Detect silent regions below thresholdDb lasting at least minDurationSec.
 *
 * @param {Float32Array[]} channels
 * @param {{ thresholdDb?: number, minDurationSec?: number, sampleRate?: number }} [options]
 * @returns {Array<{ startSec: number, endSec: number, durationSec: number }>}
 */
export function findSilenceRegions(channels, options = {}) {
  const chs = Array.isArray(channels) && channels.length > 0 ? channels : [];
  const len = chs[0]?.length || 0;
  if (len === 0) return [];
  const sr = Math.max(1, Number(options.sampleRate ?? 44100));
  const thresholdDb = Number(options.thresholdDb ?? -40);
  const thresholdAmp = Math.pow(10, thresholdDb / 20);
  const minDurationSec = Math.max(0.01, Number(options.minDurationSec ?? 0.25));
  const windowSamples = Math.max(1, Math.round(0.01 * sr)); // 10 ms RMS window

  const regions = [];
  let silentStart = -1;
  for (let start = 0; start < len; start += windowSamples) {
    const end = Math.min(len, start + windowSamples);
    let maxRms = 0;
    for (const ch of chs) {
      let sumSq = 0;
      for (let i = start; i < end; i++) sumSq += ch[i] * ch[i];
      const rms = Math.sqrt(sumSq / Math.max(1, end - start));
      if (rms > maxRms) maxRms = rms;
    }

    if (maxRms <= thresholdAmp) {
      if (silentStart === -1) silentStart = start;
    } else if (silentStart !== -1) {
      const dur = (start - silentStart) / sr;
      if (dur >= minDurationSec) {
        regions.push({
          startSec: silentStart / sr,
          endSec: start / sr,
          durationSec: dur,
        });
      }
      silentStart = -1;
    }
  }
  if (silentStart !== -1) {
    const dur = (len - silentStart) / sr;
    if (dur >= minDurationSec) {
      regions.push({
        startSec: silentStart / sr,
        endSec: len / sr,
        durationSec: dur,
      });
    }
  }

  return regions;
}

/**
 * Detect rhythmic beat/transient onsets via positive energy flux and estimate BPM.
 *
 * @param {Float32Array[]} channels
 * @param {{ sampleRate?: number, thresholdMultiplier?: number, minBpm?: number, maxBpm?: number }} [options]
 * @returns {{ onsets: number[], estimatedBpm: number }}
 */
export function findBeatOnsets(channels, options = {}) {
  const chs = Array.isArray(channels) && channels.length > 0 ? channels : [];
  const len = chs[0]?.length || 0;
  if (len === 0) return { onsets: [], estimatedBpm: 120 };

  const sr = Math.max(1, Number(options.sampleRate ?? 44100));
  const hop = Math.max(64, Math.round(0.01 * sr)); // 10 ms frames
  const frameCount = Math.floor(len / hop);
  if (frameCount < 3) return { onsets: [], estimatedBpm: 120 };

  const energies = new Float32Array(frameCount);
  for (let f = 0; f < frameCount; f++) {
    const start = f * hop;
    const end = start + hop;
    let sumSq = 0;
    for (const ch of chs) {
      for (let i = start; i < end; i++) sumSq += ch[i] * ch[i];
    }
    energies[f] = Math.sqrt(sumSq / (hop * chs.length));
  }

  const flux = new Float32Array(frameCount);
  let meanFlux = 0;
  for (let f = 1; f < frameCount; f++) {
    const d = Math.max(0, energies[f] - energies[f - 1]);
    flux[f] = d;
    meanFlux += d;
  }
  meanFlux /= frameCount;

  const mult = Number(options.thresholdMultiplier ?? 2.2);
  const thresh = Math.max(1e-4, meanFlux * mult);
  const minGapFrames = Math.max(1, Math.round((0.18 * sr) / hop));
  const onsets = [];
  let lastFrame = -minGapFrames;

  for (let f = 1; f < frameCount - 1; f++) {
    if (
      flux[f] > thresh &&
      flux[f] >= flux[f - 1] &&
      flux[f] >= flux[f + 1] &&
      f - lastFrame >= minGapFrames
    ) {
      onsets.push(Number(((f * hop) / sr).toFixed(4)));
      lastFrame = f;
    }
  }

  let estimatedBpm = 120;
  if (onsets.length >= 2) {
    const intervals = [];
    for (let i = 1; i < onsets.length; i++) {
      const dt = onsets[i] - onsets[i - 1];
      if (dt > 0.15 && dt < 2.0) intervals.push(dt);
    }
    if (intervals.length > 0) {
      intervals.sort((a, b) => a - b);
      const medianDt = intervals[Math.floor(intervals.length / 2)];
      let bpm = 60 / medianDt;
      const minBpm = Number(options.minBpm ?? 60);
      const maxBpm = Number(options.maxBpm ?? 200);
      while (bpm < minBpm) bpm *= 2;
      while (bpm > maxBpm) bpm /= 2;
      estimatedBpm = Math.round(bpm);
    }
  }

  return { onsets, estimatedBpm };
}
