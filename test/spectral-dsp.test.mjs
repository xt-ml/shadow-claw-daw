import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  WINDOW_FUNCTIONS,
  SPECTROGRAM_PALETTES,
  SPECTROGRAM_SCALES,
  nextPowerOfTwo,
  createWindow,
  fft,
  ifft,
  freqToNoteName,
  computePowerSpectrum,
  captureNoiseProfile,
  applyNoiseReduction,
  mapSpectrogramColor,
  computeSpectrogram,
  applySpectralEdit,
  findClippingRegions,
  findSilenceRegions,
  findBeatOnsets,
} from "../.agents/scripts/scdaw-spectral-dsp.js";
import {
  findNearestSpectrumBin,
  renderSpectrumSvg,
} from "../.agents/scripts/components/shadow-claw-daw-spectrum.js";
import { renderSpectrogramSvg } from "../.agents/scripts/components/shadow-claw-daw-wave-editor.js";
import { formatRecordingErrorDialog } from "../.agents/scripts/components/shadow-claw-daw-transport.js";
import { handleToolDispatch } from "../.agents/scripts/scdaw-adapter.js";

function makeSine(freq, sampleRate, durationSec, amp = 0.5) {
  const len = Math.round(sampleRate * durationSec);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return out;
}

function makeSeededNoise(len, amp = 0.08, seed = 42) {
  const out = new Float32Array(len);
  let s = seed >>> 0;
  for (let i = 0; i < len; i++) {
    s = (1664525 * s + 1013904223) >>> 0;
    out[i] = amp * ((s / 4294967296) * 2 - 1);
  }
  return out;
}

function rmsOf(arr, start = 0, end = arr.length) {
  let sum = 0;
  let n = 0;
  for (let i = start; i < end && i < arr.length; i++) {
    sum += arr[i] * arr[i];
    n++;
  }
  return n > 0 ? Math.sqrt(sum / n) : 0;
}

test("Phase 4.1: Transport native modal error dialog surfaces recording errors on REC click", async () => {
  const notFound = formatRecordingErrorDialog(
    { name: "NotFoundError", message: "Requested device not found" },
    "Recording",
  );
  assert.equal(notFound.title, "Recording Error");
  assert.match(notFound.message, /microphone|audio input device/i);
  assert.match(notFound.hint, /microphone|Wave Editor/i);

  const notAllowed = formatRecordingErrorDialog({
    name: "NotAllowedError",
    message: "Permission denied",
  });
  assert.match(notAllowed.message, /permission/i);

  const notReadable = formatRecordingErrorDialog({
    name: "NotReadableError",
    message: "Device in use",
  });
  assert.match(notReadable.message, /busy|unavailable/i);

  const transportSrc = await fs.readFile(
    new URL(
      "../.agents/scripts/components/shadow-claw-daw-transport.js",
      import.meta.url,
    ),
    "utf8",
  );

  // Native <dialog> best practices: no redundant role="dialog" or aria-modal on error dialog
  assert.match(
    transportSrc,
    /<dialog[^>]+id=["']scdaw-error-dialog["'][^>]*closedby=["']any["']/,
  );
  assert.match(
    transportSrc,
    /id=["']scdaw-error-dialog["'][^>]*aria-labelledby=["']error-dialog-title["']/,
  );
  assert.match(
    transportSrc,
    /id=["']scdaw-error-dialog["'][^>]*aria-describedby=["']error-dialog-message["']/,
  );
  assert.doesNotMatch(
    transportSrc,
    /<dialog[^>]+id=["']scdaw-error-dialog["'][^>]*(?:role=["']dialog["']|aria-modal)/,
  );
  assert.match(transportSrc, /<h1[^>]+id=["']error-dialog-title["']/);
  assert.match(transportSrc, /<p[^>]+id=["']error-dialog-message["']/);
  assert.match(transportSrc, /id=["']error-dialog-ok["'][^>]*autofocus/);
  assert.match(
    transportSrc,
    /dialog:modal\s*\{[^}]*overscroll-behavior:\s*contain/,
  );
  assert.match(transportSrc, /dialog::backdrop\s*\{[^}]*overflow:\s*hidden/);
  assert.match(transportSrc, /errorDialog\.returnValue\s*=\s*["']["']/);

  // All 4 recording catch blocks + MIDI import must invoke showErrorDialog
  const showDialogMatches = transportSrc.match(/showErrorDialog\(/g) || [];
  assert.ok(
    showDialogMatches.length >= 5,
    `Expected showErrorDialog() in all recording/MIDI catch blocks, found ${showDialogMatches.length}`,
  );
});

test("Phase 4.2: FFT/IFFT roundtrip, windows, pitch note conversion, and power spectrum", () => {
  assert.equal(nextPowerOfTwo(1000), 1024);
  assert.ok(WINDOW_FUNCTIONS.includes("hann"));
  assert.ok(WINDOW_FUNCTIONS.includes("blackmanHarris"));

  const hann = createWindow(64, "hann");
  assert.ok(Math.abs(hann[0]) < 1e-6);
  assert.ok(Math.abs(hann[32] - 1.0) < 0.01);
  const rect = createWindow(32, "rectangular");
  assert.equal(
    rect.every((v) => v === 1),
    true,
  );

  const sig = makeSine(1000, 44100, 1024 / 44100, 0.8);
  const { real, imag } = fft(sig);
  const rec = ifft(real, imag);
  let maxErr = 0;
  for (let i = 0; i < sig.length; i++) {
    maxErr = Math.max(maxErr, Math.abs(sig[i] - rec[i]));
  }
  assert.ok(maxErr < 1e-4, `IFFT roundtrip maxErr=${maxErr}`);

  assert.equal(freqToNoteName(440), "A4");
  assert.equal(freqToNoteName(261.63), "C4");
  assert.equal(freqToNoteName(880), "A5");

  const sr = 44100;
  const sine440 = makeSine(440, sr, 0.25, 1.0);
  const spec = computePowerSpectrum(sine440, {
    fftSize: 2048,
    windowType: "hann",
    sampleRate: sr,
  });
  assert.ok(Math.abs(spec.peakFreq - 440) < 25);
  assert.equal(spec.peakNote, "A4");
  assert.ok(spec.peakDb > -3 && spec.peakDb <= 1, `peakDb=${spec.peakDb}`);
});

test("Phase 4.3: Profile-based Noise Reduction attenuates noise floor while preserving tone", () => {
  const sr = 44100;
  const noiseOnly = makeSeededNoise(8192, 0.08, 777);
  const profile = captureNoiseProfile([noiseOnly], {
    fftSize: 1024,
    sampleRate: sr,
  });
  assert.equal(profile.fftSize, 1024);
  assert.ok(profile.frameCount > 0);

  // First 0.5s: 1 kHz tone + noise; last 0.5s: noise only
  const len = sr; // 1.0s
  const noisy = makeSeededNoise(len, 0.08, 999);
  const toneEnd = Math.floor(sr * 0.5);
  for (let i = 0; i < toneEnd; i++) {
    noisy[i] += 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sr);
  }

  const noiseTailBefore = rmsOf(noisy, toneEnd + 2048, len);
  const toneRmsBefore = rmsOf(noisy, 2048, toneEnd - 2048);

  const reduced = applyNoiseReduction([noisy], profile, {
    reductionDb: 18,
    sensitivity: 6,
    freqSmoothingBands: 3,
    sampleRate: sr,
  });
  const out = reduced.channels[0];
  const noiseTailAfter = rmsOf(out, toneEnd + 2048, len);
  const toneRmsAfter = rmsOf(out, 2048, toneEnd - 2048);

  const noiseDropDb =
    20 * Math.log10(noiseTailBefore / Math.max(1e-7, noiseTailAfter));
  assert.ok(
    noiseDropDb >= 6,
    `Expected noise floor reduction >= 6 dB, got ${noiseDropDb.toFixed(2)} dB`,
  );
  assert.ok(
    toneRmsAfter > toneRmsBefore * 0.65,
    `Expected tone energy preserved (before=${toneRmsBefore}, after=${toneRmsAfter})`,
  );
});

test("Phase 4.4: Spectrogram matrix, palettes, and spectral selection editing", () => {
  assert.ok(SPECTROGRAM_PALETTES.includes("roseus"));
  assert.ok(SPECTROGRAM_SCALES.includes("mel"));

  for (const pal of SPECTROGRAM_PALETTES) {
    const rgb = mapSpectrogramColor(0.5, pal);
    assert.equal(rgb.length, 3);
    assert.ok(rgb.every((v) => v >= 0 && v <= 255));
  }

  const sr = 44100;
  const sine1k = makeSine(1000, sr, 0.2, 0.8);
  for (const scale of ["linear", "logarithmic", "mel"]) {
    const spec = computeSpectrogram(sine1k, {
      fftSize: 512,
      hopSize: 128,
      scale,
      sampleRate: sr,
    });
    assert.ok(spec.columns > 0 && spec.rows > 0);
    assert.equal(spec.data.length, spec.columns * spec.rows);
  }

  // Mix 440 Hz + 3000 Hz, then delete [2500 Hz, 3500 Hz]
  const s440 = makeSine(440, sr, 0.3, 0.4);
  const s3000 = makeSine(3000, sr, 0.3, 0.4);
  const mix = new Float32Array(s440.length);
  for (let i = 0; i < mix.length; i++) mix[i] = s440[i] + s3000[i];

  const edited = applySpectralEdit([mix], {
    lowFreq: 2500,
    highFreq: 3500,
    mode: "delete",
    fftSize: 1024,
    sampleRate: sr,
  });

  const beforeSpec = computePowerSpectrum(mix, {
    fftSize: 2048,
    sampleRate: sr,
  });
  const afterSpec = computePowerSpectrum(edited.channels[0], {
    fftSize: 2048,
    sampleRate: sr,
  });
  const bin440 = findNearestSpectrumBin(
    afterSpec.frequencies,
    afterSpec.magnitudesDb,
    440,
  );
  const bin3kBefore = findNearestSpectrumBin(
    beforeSpec.frequencies,
    beforeSpec.magnitudesDb,
    3000,
  );
  const bin3kAfter = findNearestSpectrumBin(
    afterSpec.frequencies,
    afterSpec.magnitudesDb,
    3000,
  );
  assert.ok(
    bin3kBefore.db - bin3kAfter.db > 12,
    `Expected >12 dB attenuation at 3000 Hz, got ${bin3kBefore.db - bin3kAfter.db}`,
  );
  assert.ok(bin440.db > -15, `Expected 440 Hz preserved, got ${bin440.db}`);
});

test("Phase 4.5: Clipping, Silence, and Beat Onset analysis", () => {
  const sr = 44100;

  // Clipping
  const clean = makeSine(440, sr, 0.1, 0.5);
  assert.equal(findClippingRegions([clean]).length, 0);
  const clipped = new Float32Array(clean);
  for (let i = 1000; i < 1010; i++) clipped[i] = 1.0;
  const clipRegs = findClippingRegions([clipped], { minConsecutive: 3 });
  assert.equal(clipRegs.length, 1);
  assert.equal(clipRegs[0].lengthSamples, 10);

  // Silence finder
  const gapped = new Float32Array(Math.round(sr * 1.5));
  const toneA = makeSine(440, sr, 0.4, 0.6);
  const toneB = makeSine(440, sr, 0.4, 0.6);
  gapped.set(toneA, 0);
  gapped.set(toneB, Math.round(sr * 1.0));
  const silences = findSilenceRegions([gapped], {
    thresholdDb: -40,
    minDurationSec: 0.25,
    sampleRate: sr,
  });
  assert.equal(silences.length, 1);
  assert.ok(silences[0].startSec >= 0.35 && silences[0].endSec <= 1.05);

  // Beat finder (120 BPM = 0.5s interval across 3 seconds)
  const beatsPcm = new Float32Array(sr * 3);
  for (let b = 0; b < 6; b++) {
    const idx = Math.round(b * 0.5 * sr);
    for (let k = 0; k < 400; k++) {
      if (idx + k < beatsPcm.length) {
        beatsPcm[idx + k] = Math.exp(-k / 80) * 0.9;
      }
    }
  }
  const beatRes = findBeatOnsets([beatsPcm], { sampleRate: sr });
  assert.ok(beatRes.onsets.length >= 4);
  assert.ok(
    Math.abs(beatRes.estimatedBpm - 120) <= 15,
    `Expected ~120 BPM, got ${beatRes.estimatedBpm}`,
  );
});

test("Phase 4.6: <shadow-claw-daw-spectrum> & spectrogram SVG rendering + ARIA/mobile compliance", async () => {
  const sr = 44100;
  const sine = makeSine(440, sr, 0.2, 0.8);
  const spec = computePowerSpectrum(sine, { fftSize: 1024, sampleRate: sr });
  const svgLog = renderSpectrumSvg({ ...spec, scale: "log" });
  const svgLin = renderSpectrumSvg({ ...spec, scale: "linear" });
  assert.match(svgLog, /<svg/);
  assert.match(svgLog, /<path/);
  assert.match(svgLog, /A4/);
  assert.match(svgLin, /<svg/);

  const spectrogram = computeSpectrogram(sine, {
    fftSize: 512,
    hopSize: 128,
    scale: "mel",
    sampleRate: sr,
  });
  const specgramSvg = renderSpectrogramSvg({
    spectrogram,
    palette: "roseus",
    freqSelection: { lowFreq: 300, highFreq: 800, maxFreq: sr / 2 },
  });
  assert.match(specgramSvg, /<svg/);
  assert.match(specgramSvg, /scdaw-wave__freq-selection/);

  const spectrumSrc = await fs.readFile(
    new URL(
      "../.agents/scripts/components/shadow-claw-daw-spectrum.js",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(spectrumSrc, /container-name:\s*shadow-claw-daw-spectrum/);
  assert.match(
    spectrumSrc,
    /@container shadow-claw-daw-spectrum\s*\(\s*min-width:\s*640px\s*\)/,
  );
  assert.match(
    spectrumSrc,
    /@supports\s+not\s*\(\s*container-type:\s*inline-size\s*\)/,
  );
  assert.match(spectrumSrc, /@media\s*\(\s*pointer:\s*coarse\s*\)/);
  assert.match(spectrumSrc, /min-height:\s*44px/);
  assert.match(spectrumSrc, /font:\s*inherit/);
  assert.doesNotMatch(spectrumSrc, /:host-context\(/);
  assert.match(spectrumSrc, /role=["']region["']/);
  assert.match(spectrumSrc, /aria-live=["']polite["']/);
  assert.match(
    spectrumSrc,
    /(?:defineElement|customElements\.define)\(\s*["']shadow-claw-daw-spectrum["']/,
  );

  const surface = await handleToolDispatch("scdaw_render_surface", {
    element: "spectrum",
  });
  assert.equal(
    surface.element,
    "<shadow-claw-daw-spectrum></shadow-claw-daw-spectrum>",
  );
});

test("Phase 4.7: scdaw_analyze_audio_clip & spectral/noise_reduction tools work end-to-end", async () => {
  const trk = await handleToolDispatch("scdaw_add_track", {
    kind: "audio",
    name: "Spectral Track",
  });
  const gen = await handleToolDispatch("scdaw_process_audio_clip", {
    trackId: trk.trackId,
    effect: "generate_tone",
    params: {
      waveform: "sine",
      frequency: 440,
      durationSec: 0.4,
      amplitude: 0.7,
    },
  });
  const clipId = gen.clipId;

  for (const analysis of [
    "stats",
    "spectrum",
    "clipping",
    "silence_finder",
    "beat_finder",
    "spectrogram",
  ]) {
    const res = await handleToolDispatch("scdaw_analyze_audio_clip", {
      trackId: trk.trackId,
      clipId,
      analysis,
    });
    assert.ok(res.ok, `Expected analysis '${analysis}' to succeed`);
  }

  const profRes = await handleToolDispatch("scdaw_process_audio_clip", {
    trackId: trk.trackId,
    clipId,
    effect: "noise_profile",
    params: { fftSize: 1024 },
  });
  assert.equal(profRes.profileCaptured, true);

  const nrRes = await handleToolDispatch("scdaw_process_audio_clip", {
    trackId: trk.trackId,
    clipId,
    effect: "noise_reduction",
    params: { reductionDb: 12 },
  });
  assert.ok(nrRes.ok);

  const seRes = await handleToolDispatch("scdaw_process_audio_clip", {
    trackId: trk.trackId,
    clipId,
    effect: "spectral_edit",
    params: { lowFreq: 800, highFreq: 1600, mode: "delete" },
  });
  assert.ok(seRes.ok);
});
