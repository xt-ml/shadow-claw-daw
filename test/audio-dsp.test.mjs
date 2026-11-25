import test from "node:test";
import assert from "node:assert/strict";
import {
  registerDspBackend,
  unregisterDspBackend,
  getDspBackend,
  listDspBackends,
  findNearestZeroCrossing,
  removeDcOffset,
  invertAudio,
  reverseAudio,
  amplifyAudio,
  normalizePeakAudio,
  measureLufs,
  normalizeLoudnessAudio,
  bakeClipGainAndFades,
  removeClicksAudio,
  generateToneAudio,
  generateNoiseAudio,
  generateDtmfAudio,
  generateSilenceAudio,
  processAudioChannels,
} from "../.agents/scripts/shadow-claw-daw-audio-dsp.js";
import { DawEngine } from "../.agents/scripts/shadow-claw-daw-engine.js";
import { handleToolDispatch } from "../.agents/scripts/shadow-claw-daw-adapter.js";
import { FakeAudioContext } from "./helpers/fake-audio-context.mjs";

function makeSine(freq, sampleRate, durationSec, amp = 0.5, dcOffset = 0) {
  const len = Math.round(sampleRate * durationSec);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate) + dcOffset;
  }
  return out;
}

test("Phase 2.1: Pluggable DSP backend registry intercepts processAudioChannels and restores pure-JS fallback", () => {
  const customChannels = [new Float32Array([0.1, 0.2])];
  registerDspBackend("custom_test_op", (channels, params) => ({
    channels: channels.map((ch) => ch.map((v) => v * (params.scale || 2))),
    meta: { backend: "wasm-mock" },
  }));

  assert.ok(getDspBackend("custom_test_op"));
  assert.ok(listDspBackends().includes("custom_test_op"));

  const res = processAudioChannels(
    customChannels,
    "custom_test_op",
    { scale: 3 },
    44100,
  );
  assert.equal(res.meta.backend, "wasm-mock");
  assert.ok(Math.abs(res.channels[0][0] - 0.3) < 1e-6);
  assert.ok(Math.abs(res.channels[0][1] - 0.6) < 1e-6);

  unregisterDspBackend("custom_test_op");
  assert.equal(getDspBackend("custom_test_op"), null);
  assert.throws(() =>
    processAudioChannels(customChannels, "custom_test_op", {}, 44100),
  );
});

test("Phase 2.2: Sample utilities - zero crossing, DC offset, invert, reverse, amplify, normalize, LUFS/RMS, bake", () => {
  const sr = 44100;
  // 1. findNearestZeroCrossing finds upward zero crossing within 10ms window
  const sine = makeSine(220, sr, 0.1, 0.8); // period = 200.45 samples
  const zc = findNearestZeroCrossing([sine], 210, sr);
  assert.ok(zc.sampleIndex >= 195 && zc.sampleIndex <= 210);
  assert.ok(sine[zc.sampleIndex - 1] <= 0 && sine[zc.sampleIndex] >= 0);
  assert.ok(Math.abs(zc.timeSec - zc.sampleIndex / sr) < 1e-9);

  // 2. removeDcOffset eliminates constant bias
  const biased = makeSine(440, sr, 0.1, 0.4, 0.35);
  const dcRes = removeDcOffset([biased]);
  let mean = 0;
  for (let i = 0; i < dcRes.channels[0].length; i++)
    mean += dcRes.channels[0][i];
  mean /= dcRes.channels[0].length;
  assert.ok(Math.abs(mean) < 1e-5, `Expected near-zero mean, got ${mean}`);
  // Must not mutate input
  assert.ok(Math.abs(biased[0] - 0.35) < 1e-5);

  // 3. invertAudio & reverseAudio
  const sample = new Float32Array([0.1, -0.4, 0.7]);
  const inv = invertAudio([sample]);
  assert.deepEqual(
    Array.from(inv.channels[0]).map((v) => Number(v.toFixed(4))),
    [-0.1, 0.4, -0.7],
  );
  const rev = reverseAudio([sample]);
  assert.deepEqual(
    Array.from(rev.channels[0]).map((v) => Number(v.toFixed(4))),
    [0.7, -0.4, 0.1],
  );

  // 4. amplifyAudio (+6.0206 dB doubles amplitude; respects allowClipping)
  const quiet = new Float32Array([0.25, -0.6]);
  const ampClipped = amplifyAudio([quiet], { gainDb: 6.0206 });
  assert.ok(Math.abs(ampClipped.channels[0][0] - 0.5) < 1e-3);
  assert.equal(ampClipped.channels[0][1], -1);

  const ampUnclipped = amplifyAudio([quiet], {
    gainDb: 6.0206,
    allowClipping: true,
  });
  assert.ok(ampUnclipped.channels[0][1] < -1.1);

  // 5. normalizePeakAudio (-1 dBFS ~ 0.89125, shared vs independent, silence safe)
  const left = new Float32Array([0.2, -0.4, 0.1]);
  const right = new Float32Array([0.1, 0.2, -0.05]);
  const normShared = normalizePeakAudio([left, right], {
    targetDb: -1,
    removeDc: false,
    independent: false,
  });
  const targetPeak = Math.pow(10, -1 / 20);
  assert.ok(Math.abs(Math.abs(normShared.channels[0][1]) - targetPeak) < 1e-4);
  assert.ok(Math.abs(normShared.channels[1][1]) < targetPeak * 0.6);

  const normIndep = normalizePeakAudio([left, right], {
    targetDb: -1,
    removeDc: false,
    independent: true,
  });
  assert.ok(Math.abs(Math.abs(normIndep.channels[1][1]) - targetPeak) < 1e-4);

  const silenceRes = normalizePeakAudio([new Float32Array(64)], {
    targetDb: -1,
  });
  assert.equal(silenceRes.channels[0][0], 0);
  assert.equal(Number.isFinite(silenceRes.meta.gainAppliedDb), true);

  // 6. measureLufs & normalizeLoudnessAudio (EBU R128 + RMS)
  const testTone = makeSine(1000, sr, 0.5, 0.5);
  const lufsVal = measureLufs([testTone, testTone], sr);
  assert.ok(Number.isFinite(lufsVal) && lufsVal < 0 && lufsVal > -20);
  assert.equal(measureLufs([new Float32Array(1000)], sr), -Infinity);

  const loudLufs = normalizeLoudnessAudio([testTone, testTone], {
    mode: "lufs",
    targetLufs: -14,
    sampleRate: sr,
  });
  const afterLufs = measureLufs(loudLufs.channels, sr);
  assert.ok(
    Math.abs(afterLufs - -14) < 0.5,
    `Expected ~ -14 LUFS, got ${afterLufs}`,
  );

  const loudRms = normalizeLoudnessAudio([testTone], {
    mode: "rms",
    targetRmsDb: -18,
    sampleRate: sr,
  });
  let sumSq = 0;
  for (let i = 0; i < loudRms.channels[0].length; i++) {
    sumSq += loudRms.channels[0][i] * loudRms.channels[0][i];
  }
  const actualRmsDb =
    20 * Math.log10(Math.sqrt(sumSq / loudRms.channels[0].length));
  assert.ok(
    Math.abs(actualRmsDb - -18) < 0.2,
    `Expected ~ -18 dB RMS, got ${actualRmsDb}`,
  );

  // 7. bakeClipGainAndFades bakes fadeIn, fadeOut, and gainEnvelope into PCM
  const ones = new Float32Array(4410).fill(1.0); // 0.1s at 44100 Hz
  const baked = bakeClipGainAndFades(
    [ones],
    {
      gain: 0.8,
      fadeIn: 0.05,
      fadeOut: 0.05,
      fadeInType: "linear",
      fadeOutType: "linear",
    },
    sr,
  );
  assert.ok(baked.channels[0][0] < 0.01);
  assert.ok(Math.abs(baked.channels[0][2205] - 0.8) < 0.05);
  assert.ok(baked.channels[0][4409] < 0.01);
});

test("Phase 2.3: removeClicksAudio detects and interpolates synthetic click spikes", () => {
  const sr = 44100;
  const sig = makeSine(200, sr, 0.2, 0.05); // 8820 samples, quiet 0.05 sine
  const clickIdx = 4400;
  sig[clickIdx] = 0.95;
  sig[clickIdx + 1] = -0.9;
  sig[clickIdx + 2] = 0.88;

  const res = removeClicksAudio([sig], { threshold: 200, maxClickWidth: 20 });
  assert.ok(res.meta.clicksRemoved > 0);
  const peakAroundClick = Math.max(
    Math.abs(res.channels[0][clickIdx]),
    Math.abs(res.channels[0][clickIdx + 1]),
    Math.abs(res.channels[0][clickIdx + 2]),
  );
  assert.ok(
    peakAroundClick < 0.25,
    `Click spike should be interpolated down, got ${peakAroundClick}`,
  );
});

test("Phase 2.4: Generators produce tone, chirp, white/pink/brownian noise, DTMF, and silence", () => {
  const sr = 44100;

  // Tone & Chirp
  const tone = generateToneAudio({
    waveform: "sine",
    frequency: 440,
    durationSec: 0.25,
    amplitude: 0.6,
    sampleRate: sr,
  });
  assert.equal(tone.channels[0].length, Math.round(0.25 * sr));
  const chirp = generateToneAudio({
    waveform: "chirp",
    frequency: 220,
    endFrequency: 880,
    durationSec: 0.2,
    sampleRate: sr,
  });
  assert.equal(chirp.channels[0].length, Math.round(0.2 * sr));

  // Noise (white vs brownian HF energy)
  const white = generateNoiseAudio({
    type: "white",
    durationSec: 0.2,
    amplitude: 0.5,
    sampleRate: sr,
    seed: 12345,
  });
  const pink = generateNoiseAudio({
    type: "pink",
    durationSec: 0.2,
    amplitude: 0.5,
    sampleRate: sr,
    seed: 12345,
  });
  const brown = generateNoiseAudio({
    type: "brownian",
    durationSec: 0.2,
    amplitude: 0.5,
    sampleRate: sr,
    seed: 12345,
  });
  assert.equal(pink.channels[0].length, Math.round(0.2 * sr));
  const avgDiff = (arr) => {
    let sum = 0;
    for (let i = 1; i < arr.length; i++) sum += Math.abs(arr[i] - arr[i - 1]);
    return sum / (arr.length - 1);
  };
  assert.ok(
    avgDiff(brown.channels[0]) < avgDiff(white.channels[0]) * 0.5,
    "Brownian noise must have lower sample-to-sample HF diff than white noise",
  );

  // DTMF
  const dtmf = generateDtmfAudio({
    sequence: "5#",
    toneMs: 60,
    silenceMs: 40,
    amplitude: 0.5,
    sampleRate: sr,
  });
  assert.ok(dtmf.channels[0].length > Math.round(0.15 * sr));
  // Middle of first tone should be active; middle of silence gap should be 0
  assert.ok(Math.abs(dtmf.channels[0][Math.round(0.03 * sr)]) > 0.01);
  assert.equal(dtmf.channels[0][Math.round(0.08 * sr)], 0);

  // Silence
  const silence = generateSilenceAudio({ durationSec: 0.1, sampleRate: sr });
  assert.equal(silence.channels[0].length, Math.round(0.1 * sr));
  assert.equal(
    silence.channels[0].every((v) => v === 0),
    true,
  );
});

test("Phase 2.5: DawEngine immutable processAudioClip + range slicing + lossless undo + generateAudioClip", async () => {
  const engine = new DawEngine({ audioContext: new FakeAudioContext() });
  const trkRes = await engine.sendCommand("add_track", {
    kind: "audio",
    name: "Lead Vox",
  });
  const trackId = trkRes.trackId;

  const sr = 44100;
  const buf = engine.ctx.createBuffer(1, sr, sr);
  const srcPcm = makeSine(440, sr, 1.0, 0.2);
  buf.getChannelData(0).set(srcPcm);
  await engine.loadSample("vox_orig", buf);

  const addRes = await engine.sendCommand("add_audio_clip", {
    trackId,
    clip: {
      id: "vox_1",
      name: "Take",
      sample: "vox_orig",
      time: 0,
      duration: 2,
    },
  });
  assert.equal(addRes.clip.sample, "vox_orig");

  // Process normalize -1 dB -> creates new immutable sample key
  const procRes = await engine.sendCommand("process_audio_clip", {
    trackId,
    clipId: "vox_1",
    effect: "normalize",
    params: { targetDb: -1 },
  });
  assert.ok(procRes.ok);
  assert.notEqual(procRes.sampleKey, "vox_orig");

  const updatedClip = engine
    .getProject()
    .tracks.find((t) => t.id === trackId)
    .audioClips.find((c) => c.id === "vox_1");
  assert.equal(updatedClip.sample, procRes.sampleKey);

  // Original sample buffer stays untouched at peak 0.2
  const origPeak = Math.max(
    ...engine.getSample("vox_orig").getChannelData(0).map(Math.abs),
  );
  const newPeak = Math.max(
    ...engine.getSample(procRes.sampleKey).getChannelData(0).map(Math.abs),
  );
  assert.ok(Math.abs(origPeak - 0.2) < 1e-3);
  assert.ok(Math.abs(newPeak - Math.pow(10, -1 / 20)) < 1e-3);

  // Single undo reverts clip.sample back to vox_orig!
  await engine.sendCommand("undo");
  const revertedClip = engine
    .getProject()
    .tracks.find((t) => t.id === trackId)
    .audioClips.find((c) => c.id === "vox_1");
  assert.equal(revertedClip.sample, "vox_orig");

  // Sub-range selection only modifies [0.25s, 0.5s]
  const rangeRes = await engine.sendCommand("process_audio_clip", {
    trackId,
    clipId: "vox_1",
    effect: "invert",
    startSec: 0.25,
    endSec: 0.5,
  });
  const rangedPcm = engine.getSample(rangeRes.sampleKey).getChannelData(0);
  assert.ok(Math.abs(rangedPcm[100] - srcPcm[100]) < 1e-6);
  const insideIdx = Math.round(0.35 * sr);
  assert.ok(Math.abs(rangedPcm[insideIdx] + srcPcm[insideIdx]) < 1e-6);

  // generate_audio_clip creates generated clip on track
  const genRes = await engine.sendCommand("generate_audio_clip", {
    trackId,
    generator: "tone",
    params: { waveform: "sine", frequency: 440, durationSec: 0.5 },
    time: 2,
    name: "Reference Tone",
  });
  assert.ok(genRes.ok);
  assert.ok(engine.getSample(genRes.sampleKey));
});

test("Phase 2.6: scdaw_process_audio_clip WebMCP tool dispatches generators and DSP effects", async () => {
  const trkRes = await handleToolDispatch("scdaw_add_track", {
    kind: "audio",
    name: "DSP Track",
  });
  const trackId = trkRes.trackId;

  const gen = await handleToolDispatch("scdaw_process_audio_clip", {
    trackId,
    effect: "generate_tone",
    time: 0,
    name: "Test Sine",
    params: {
      waveform: "sine",
      frequency: 330,
      durationSec: 0.4,
      amplitude: 0.25,
    },
  });
  assert.ok(gen.ok);
  const clipId = gen.clipId;

  for (const [effect, params] of [
    ["normalize", { targetDb: -1 }],
    ["reverse", {}],
    ["invert", {}],
    ["remove_dc", {}],
    ["loudness", { mode: "rms", targetRmsDb: -16 }],
    ["click_removal", { threshold: 200, maxClickWidth: 20 }],
    ["fade_in", { fadeInType: "linear" }],
    ["bake_fades", {}],
  ]) {
    const res = await handleToolDispatch("scdaw_process_audio_clip", {
      trackId,
      clipId,
      effect,
      params,
    });
    assert.ok(res.ok, `Expected effect '${effect}' to succeed`);
  }
});
