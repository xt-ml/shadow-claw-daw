/**
 * .agents/scripts/shadow-claw-daw-time-dsp.js
 *
 * Pure zero-dependency Float32Array time-stretching (WSOLA), pitch-shifting,
 * speed/resampling, and Truncate Silence DSP kernels.
 * Leaf module (no imports from shadow-claw-daw-audio-dsp.js to keep module graph acyclic).
 */

function normalizeChannels(channels) {
  if (!Array.isArray(channels) || channels.length === 0) {
    throw new Error("channels must be a non-empty array of Float32Array");
  }
  return channels.map((ch) =>
    ch instanceof Float32Array ? ch : new Float32Array(ch || 0),
  );
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/**
 * Cubic Catmull-Rom resampler changing playback speed/length and pitch together.
 *
 * @param {Float32Array[]} channels
 * @param {{ rate?: number, targetLength?: number | null }} [options]
 * @returns {{ channels: Float32Array[], meta: Object }}
 */
export function resampleAudio(channels, options = {}) {
  const chs = normalizeChannels(channels);
  const inLen = chs[0].length;
  if (inLen === 0) {
    return {
      channels: chs.map(() => new Float32Array(0)),
      meta: { rate: 1, inputFrames: 0, outputFrames: 0 },
    };
  }

  const effectiveRate = clamp(Number(options.rate ?? 1.0) || 1.0, 0.25, 4.0);
  const outLen =
    options.targetLength !== null && options.targetLength !== undefined
      ? Math.max(1, Math.round(Number(options.targetLength)))
      : Math.max(1, Math.round(inLen / effectiveRate));

  const step = inLen / outLen;
  const out = chs.map((ch) => {
    const dst = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = Math.min(inLen - 1, i * step);
      const i0 = Math.floor(pos);
      const t = pos - i0;
      const p0 = ch[Math.max(0, i0 - 1)];
      const p1 = ch[i0];
      const p2 = ch[Math.min(inLen - 1, i0 + 1)];
      const p3 = ch[Math.min(inLen - 1, i0 + 2)];
      dst[i] = clamp(catmullRom(p0, p1, p2, p3, t), -1, 1);
    }
    return dst;
  });

  return {
    channels: out,
    meta: {
      rate: effectiveRate,
      inputFrames: inLen,
      outputFrames: outLen,
    },
  };
}

/**
 * Change speed (tempo + pitch simultaneously via resampling).
 * Supports `rate` multiplier or `percentChange` (e.g. -25 for -25%).
 *
 * @param {Float32Array[]} channels
 * @param {{ rate?: number | null, percentChange?: number | null }} [options]
 * @returns {{ channels: Float32Array[], meta: Object }}
 */
export function changeSpeedAudio(channels, options = {}) {
  let effectiveRate = 1.0;
  if (
    options.percentChange !== null &&
    options.percentChange !== undefined &&
    Number.isFinite(Number(options.percentChange))
  ) {
    effectiveRate = 1 + Number(options.percentChange) / 100;
  } else if (options.rate !== null && options.rate !== undefined) {
    effectiveRate = Number(options.rate);
  }
  const safeRate = clamp(
    Number.isFinite(effectiveRate) && effectiveRate > 0 ? effectiveRate : 1.0,
    0.25,
    4.0,
  );
  return resampleAudio(channels, { rate: safeRate });
}

/**
 * Waveform Similarity Overlap-Add (WSOLA) time-stretcher preserving pitch.
 * Accepts either `tempoMultiplier` (> 1 speeds up / shortens duration) or
 * explicit `ratio` (outputLength / inputLength).
 *
 * @param {Float32Array[]} channels
 * @param {{ tempoMultiplier?: number | null, ratio?: number | null, windowMs?: number, searchMs?: number, sampleRate?: number }} [options]
 * @returns {{ channels: Float32Array[], meta: Object }}
 */
export function timeStretchWsola(channels, options = {}) {
  const chs = normalizeChannels(channels);
  const inLen = chs[0].length;
  const fs = Math.max(8000, Number(options.sampleRate ?? 44100));

  let stretchRatio = 1.0;
  if (
    options.ratio !== null &&
    options.ratio !== undefined &&
    Number.isFinite(Number(options.ratio))
  ) {
    stretchRatio = clamp(Number(options.ratio), 0.25, 4.0);
  } else if (
    options.tempoMultiplier !== null &&
    options.tempoMultiplier !== undefined &&
    Number.isFinite(Number(options.tempoMultiplier))
  ) {
    const tempo = clamp(Number(options.tempoMultiplier), 0.25, 4.0);
    stretchRatio = clamp(1 / tempo, 0.25, 4.0);
  }

  if (inLen < 64 || Math.abs(stretchRatio - 1.0) < 1e-4) {
    return {
      channels: chs.map((c) => new Float32Array(c)),
      meta: {
        tempoMultiplier: 1 / stretchRatio,
        stretchRatio,
        inputFrames: inLen,
        outputFrames: inLen,
      },
    };
  }

  const windowMs = Math.max(10, Math.min(120, Number(options.windowMs ?? 40)));
  const searchMs = Math.max(2, Math.min(40, Number(options.searchMs ?? 15)));
  let winLen = Math.min(
    inLen,
    Math.max(64, 2 * Math.round(((windowMs / 1000) * fs) / 2)),
  );
  if (winLen % 2 === 1) winLen = Math.max(4, winLen - 1);
  const hopOut = winLen >> 1;
  const hopIn = hopOut / stretchRatio;
  const searchRadius = Math.max(
    1,
    Math.min(hopOut, Math.round((searchMs / 1000) * fs)),
  );
  const outLen = Math.max(1, Math.round(inLen * stretchRatio));
  const maxStart = Math.max(0, inLen - winLen);

  // Periodic Hann window so overlapping 50%-hop halves sum identically to 1.0
  const hann = new Float32Array(winLen);
  for (let i = 0; i < winLen; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / winLen));
  }

  // Mono downmix reference keeps multi-channel WSOLA phase-locked
  const ref = new Float32Array(inLen);
  const chScale = 1 / chs.length;
  for (let c = 0; c < chs.length; c++) {
    const src = chs[c];
    for (let i = 0; i < inLen; i++) {
      ref[i] += src[i] * chScale;
    }
  }

  const out = chs.map(() => new Float32Array(outLen));
  const norm = new Float32Array(outLen);

  let prevIn = 0;
  let frameIdx = 0;
  for (let outPos = 0; outPos < outLen; outPos += hopOut) {
    const nomIn = clamp(Math.round(frameIdx * hopIn), 0, maxStart);
    let bestIn = nomIn;

    if (frameIdx > 0) {
      const natPos = prevIn + hopOut;
      if (natPos + hopOut <= inLen && maxStart > 0) {
        let bestScore = -Infinity;
        // Compute energy of template slice ref[natPos .. natPos + hopOut)
        let energyT = 0;
        for (let j = 0; j < hopOut; j++) {
          const tv = ref[natPos + j];
          energyT += tv * tv;
        }
        const deltaMin = Math.max(-searchRadius, -nomIn);
        const deltaMax = Math.min(searchRadius, maxStart - nomIn);
        for (let delta = deltaMin; delta <= deltaMax; delta++) {
          const cand = nomIn + delta;
          let dot = 0;
          let energyC = 0;
          for (let j = 0; j < hopOut; j++) {
            const cv = ref[cand + j];
            const tv = ref[natPos + j];
            dot += cv * tv;
            energyC += cv * cv;
          }
          const score = dot / Math.sqrt(energyT * energyC + 1e-12);
          if (score > bestScore) {
            bestScore = score;
            bestIn = cand;
          }
        }
      }
    }

    const writeCount = Math.min(winLen, outLen - outPos, inLen - bestIn);
    for (let i = 0; i < writeCount; i++) {
      const w = frameIdx === 0 && i < hopOut ? 1.0 : hann[i];
      norm[outPos + i] += w;
    }
    for (let c = 0; c < chs.length; c++) {
      const src = chs[c];
      const dst = out[c];
      for (let i = 0; i < writeCount; i++) {
        const w = frameIdx === 0 && i < hopOut ? 1.0 : hann[i];
        dst[outPos + i] += src[bestIn + i] * w;
      }
    }

    prevIn = bestIn;
    frameIdx++;
  }

  for (let c = 0; c < chs.length; c++) {
    const dst = out[c];
    for (let i = 0; i < outLen; i++) {
      const n = norm[i];
      if (n > 1e-6) {
        dst[i] = clamp(dst[i] / n, -1, 1);
      }
    }
  }

  return {
    channels: out,
    meta: {
      tempoMultiplier: Number((1 / stretchRatio).toFixed(4)),
      stretchRatio: Number(stretchRatio.toFixed(4)),
      inputFrames: inLen,
      outputFrames: outLen,
    },
  };
}

/**
 * Pure-JS Pitch Shifter preserving original duration via WSOLA time-stretch
 * by `2^(semitones/12)` followed by Catmull-Rom resampling back to `inLen`.
 *
 * @param {Float32Array[]} channels
 * @param {{ semitones?: number, windowMs?: number, searchMs?: number, sampleRate?: number }} [options]
 * @returns {{ channels: Float32Array[], meta: Object }}
 */
export function pitchShiftAudio(channels, options = {}) {
  const chs = normalizeChannels(channels);
  const inLen = chs[0].length;
  const st = clamp(Number(options.semitones ?? 0) || 0, -24, 24);

  if (Math.abs(st) < 1e-6 || inLen < 64) {
    return {
      channels: chs.map((c) => new Float32Array(c)),
      meta: {
        semitones: 0,
        pitchFactor: 1,
        inputFrames: inLen,
        outputFrames: inLen,
      },
    };
  }

  const pitchFactor = Math.pow(2, st / 12);
  const stretched = timeStretchWsola(chs, {
    ratio: pitchFactor,
    windowMs: options.windowMs,
    searchMs: options.searchMs,
    sampleRate: options.sampleRate,
  });
  const resampled = resampleAudio(stretched.channels, {
    rate: pitchFactor,
    targetLength: inLen,
  });

  return {
    channels: resampled.channels,
    meta: {
      semitones: st,
      pitchFactor: Number(pitchFactor.toFixed(6)),
      inputFrames: inLen,
      outputFrames: inLen,
    },
  };
}

/**
 * Ported from Audacity `TruncSilenceBase.cpp`: detect contiguous silent regions
 * below `thresholdDb` of at least `minDurationSec`, and either truncate to
 * `truncateToSec` or compress to `compressPercent` with boundary crossfades.
 *
 * @param {Float32Array[]} channels
 * @param {{ thresholdDb?: number, minDurationSec?: number, truncateToSec?: number, mode?: "truncate"|"compress", compressPercent?: number, crossfadeMs?: number, sampleRate?: number }} [options]
 * @returns {{ channels: Float32Array[], meta: Object }}
 */
export function truncateSilenceAudio(channels, options = {}) {
  const chs = normalizeChannels(channels);
  const inLen = chs[0].length;
  const fs = Math.max(8000, Number(options.sampleRate ?? 44100));
  const thresholdDb = Number(options.thresholdDb ?? -40);
  const threshLin = Math.pow(10, thresholdDb / 20);
  const minFrames = Math.max(
    1,
    Math.round(Math.max(0.01, Number(options.minDurationSec ?? 0.25)) * fs),
  );
  const truncFrames = Math.max(
    0,
    Math.round(Math.max(0, Number(options.truncateToSec ?? 0.05)) * fs),
  );
  const mode =
    String(options.mode || "truncate").toLowerCase() === "compress"
      ? "compress"
      : "truncate";
  const compFrac = clamp(Number(options.compressPercent ?? 50) / 100, 0, 1);
  const xfadeFrames = Math.max(
    0,
    Math.round((clamp(Number(options.crossfadeMs ?? 5), 0, 50) / 1000) * fs),
  );

  // Identify contiguous silent runs across all channels
  const truncRegions = [];
  let runStart = -1;
  for (let i = 0; i < inLen; i++) {
    let peak = 0;
    for (let c = 0; c < chs.length; c++) {
      const a = Math.abs(chs[c][i]);
      if (a > peak) peak = a;
    }
    if (peak <= threshLin) {
      if (runStart === -1) runStart = i;
    } else if (runStart !== -1) {
      const runLen = i - runStart;
      if (runLen >= minFrames) {
        truncRegions.push({ start: runStart, end: i, length: runLen });
      }
      runStart = -1;
    }
  }
  if (runStart !== -1) {
    const runLen = inLen - runStart;
    if (runLen >= minFrames) {
      truncRegions.push({ start: runStart, end: inLen, length: runLen });
    }
  }

  if (truncRegions.length === 0) {
    return {
      channels: chs.map((c) => new Float32Array(c)),
      meta: {
        mode,
        thresholdDb,
        regionsTruncated: 0,
        removedFrames: 0,
        removedSec: 0,
        inputFrames: inLen,
        outputFrames: inLen,
      },
    };
  }

  // Build list of kept frame ranges [start, end)
  const keptRanges = [];
  let cursor = 0;
  let removedFrames = 0;
  let regionsTruncated = 0;

  for (const reg of truncRegions) {
    const keepLen =
      mode === "compress"
        ? Math.min(reg.length, Math.max(0, Math.round(reg.length * compFrac)))
        : Math.min(reg.length, truncFrames);

    if (keepLen >= reg.length) {
      continue;
    }

    regionsTruncated++;
    removedFrames += reg.length - keepLen;
    const keepLeft = Math.floor(keepLen / 2);
    const keepRight = keepLen - keepLeft;

    const leftEnd = reg.start + keepLeft;
    if (leftEnd > cursor) {
      keptRanges.push({ start: cursor, end: leftEnd });
    }
    cursor = reg.end - keepRight;
  }
  if (cursor < inLen) {
    keptRanges.push({ start: cursor, end: inLen });
  }

  let outLen = 0;
  for (const r of keptRanges) {
    outLen += r.end - r.start;
  }
  if (outLen === 0) {
    const fallbackLen = Math.min(inLen, Math.max(1, truncFrames || 1));
    return {
      channels: chs.map((ch) => ch.slice(0, fallbackLen)),
      meta: {
        mode,
        thresholdDb,
        regionsTruncated,
        removedFrames: Math.max(0, inLen - fallbackLen),
        removedSec: Math.max(0, inLen - fallbackLen) / fs,
        inputFrames: inLen,
        outputFrames: fallbackLen,
      },
    };
  }

  const out = chs.map((src) => {
    const dst = new Float32Array(outLen);
    let writePos = 0;
    for (let idx = 0; idx < keptRanges.length; idx++) {
      const range = keptRanges[idx];
      const segLen = range.end - range.start;
      dst.set(src.subarray(range.start, range.end), writePos);

      // Apply short smoothing ramp at splice boundaries between truncated gaps
      if (idx > 0 && xfadeFrames > 0) {
        const ramp = Math.min(xfadeFrames, segLen, writePos);
        if (ramp > 1) {
          const leftEndVal = dst[writePos - 1];
          const rightStartVal = dst[writePos];
          for (let j = 0; j < ramp; j++) {
            const u = (j + 1) / (ramp + 1);
            dst[writePos + j] = leftEndVal * (1 - u) + dst[writePos + j] * u;
            dst[writePos - 1 - j] =
              rightStartVal * (1 - u) + dst[writePos - 1 - j] * u;
          }
        }
      }

      writePos += segLen;
    }
    return dst;
  });

  return {
    channels: out,
    meta: {
      mode,
      thresholdDb,
      regionsTruncated,
      removedFrames,
      removedSec: Number((removedFrames / fs).toFixed(4)),
      inputFrames: inLen,
      outputFrames: outLen,
    },
  };
}
