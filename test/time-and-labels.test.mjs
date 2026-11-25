import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  resampleAudio,
  timeStretchWsola,
  pitchShiftAudio,
  changeSpeedAudio,
  truncateSilenceAudio,
} from "../.agents/scripts/shadow-claw-daw-time-dsp.js";
import {
  processAudioChannels,
  registerDspBackend,
  unregisterDspBackend,
} from "../.agents/scripts/shadow-claw-daw-audio-dsp.js";
import { computePowerSpectrum } from "../.agents/scripts/shadow-claw-daw-spectral-dsp.js";
import {
  createProject,
  validateProject,
  applyCommand,
  computeClipPlaybackParams,
} from "../.agents/scripts/shadow-claw-daw.js";
import { DawEngine } from "../.agents/scripts/shadow-claw-daw-engine.js";
import { handleToolDispatch } from "../.agents/scripts/shadow-claw-daw-adapter.js";
import { computeLabelLayout } from "../.agents/scripts/components/shadow-claw-daw-timeline.js";
import {
  FakeAudioContext,
  FakeOfflineAudioContext,
} from "./helpers/fake-audio-context.mjs";

function makeSine(freq, sampleRate, durationSec, amp = 0.5) {
  const len = Math.round(sampleRate * durationSec);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return out;
}

function makeToneWithSilenceGap(sampleRate = 16000) {
  // 0.4s tone + 0.6s silence + 0.4s tone = 1.4s
  const t1 = makeSine(440, sampleRate, 0.4, 0.5);
  const gap = new Float32Array(Math.round(sampleRate * 0.6));
  const t2 = makeSine(554.37, sampleRate, 0.4, 0.5);
  const out = new Float32Array(t1.length + gap.length + t2.length);
  out.set(t1, 0);
  out.set(gap, t1.length);
  out.set(t2, t1.length + gap.length);
  return out;
}

test("Phase 5.1: Pure-JS resampleAudio and changeSpeedAudio scale duration and pitch", () => {
  const sr = 22050;
  const sig = makeSine(440, sr, 0.5, 0.6);

  const fast = resampleAudio([sig], { rate: 2.0 });
  assert.equal(fast.channels[0].length, Math.round(sig.length / 2));
  const fastSpec = computePowerSpectrum(fast.channels[0], {
    fftSize: 4096,
    sampleRate: sr,
  });
  assert.ok(
    Math.abs(fastSpec.peakFreq - 880) < 25,
    `Expected ~880 Hz after 2x resample, got ${fastSpec.peakFreq}`,
  );

  const slow = resampleAudio([sig], { rate: 0.5 });
  assert.equal(slow.channels[0].length, sig.length * 2);

  const spd = changeSpeedAudio([sig], { percentChange: -25 });
  assert.equal(spd.channels[0].length, Math.round(sig.length / 0.75));
});

test("Phase 5.1: WSOLA timeStretchWsola scales duration while preserving pitch", () => {
  const sr = 22050;
  const sig = makeSine(440, sr, 0.6, 0.6);

  // Speed up tempo 2x -> half duration, pitch still ~440 Hz
  const faster = timeStretchWsola([sig, sig], {
    tempoMultiplier: 2.0,
    sampleRate: sr,
  });
  assert.equal(faster.channels.length, 2);
  assert.ok(
    Math.abs(faster.channels[0].length - sig.length / 2) <= 64,
    `Expected ~${sig.length / 2} frames, got ${faster.channels[0].length}`,
  );
  const specFast = computePowerSpectrum(faster.channels[0], {
    fftSize: 4096,
    sampleRate: sr,
  });
  assert.ok(
    Math.abs(specFast.peakFreq - 440) <= 25,
    `Expected preserved ~440 Hz peak at 2x tempo, got ${specFast.peakFreq}`,
  );

  // Slow down tempo 0.5x -> double duration, pitch still ~440 Hz
  const slower = timeStretchWsola([sig], {
    tempoMultiplier: 0.5,
    sampleRate: sr,
  });
  assert.ok(
    Math.abs(slower.channels[0].length - sig.length * 2) <= 64,
    `Expected ~${sig.length * 2} frames, got ${slower.channels[0].length}`,
  );
  const specSlow = computePowerSpectrum(slower.channels[0], {
    fftSize: 4096,
    sampleRate: sr,
  });
  assert.ok(
    Math.abs(specSlow.peakFreq - 440) <= 25,
    `Expected preserved ~440 Hz peak at 0.5x tempo, got ${specSlow.peakFreq}`,
  );
});

test("Phase 5.1: pitchShiftAudio shifts frequency while preserving exact frame count", () => {
  const sr = 22050;
  const sig = makeSine(440, sr, 0.6, 0.6);

  const upOct = pitchShiftAudio([sig], { semitones: 12, sampleRate: sr });
  assert.equal(upOct.channels[0].length, sig.length);
  const specUp = computePowerSpectrum(upOct.channels[0], {
    fftSize: 4096,
    sampleRate: sr,
  });
  assert.ok(
    Math.abs(specUp.peakFreq - 880) <= 40,
    `Expected ~880 Hz for +12 semitones, got ${specUp.peakFreq}`,
  );

  const downOct = pitchShiftAudio([sig], { semitones: -12, sampleRate: sr });
  assert.equal(downOct.channels[0].length, sig.length);
  const specDown = computePowerSpectrum(downOct.channels[0], {
    fftSize: 4096,
    sampleRate: sr,
  });
  assert.ok(
    Math.abs(specDown.peakFreq - 220) <= 40,
    `Expected ~220 Hz for -12 semitones, got ${specDown.peakFreq}`,
  );

  const noop = pitchShiftAudio([sig], { semitones: 0, sampleRate: sr });
  assert.equal(noop.channels[0].length, sig.length);
});

test("Phase 5.1: truncateSilenceAudio truncates and compresses silence cleanly, wired into processAudioChannels", () => {
  const sr = 16000;
  const sig = makeToneWithSilenceGap(sr);

  const trunc = truncateSilenceAudio([sig], {
    thresholdDb: -40,
    minDurationSec: 0.2,
    truncateToSec: 0.05,
    mode: "truncate",
    sampleRate: sr,
  });
  assert.equal(trunc.meta.regionsTruncated, 1);
  assert.ok(trunc.channels[0].length < sig.length - Math.round(0.45 * sr));
  // Ensure no NaN or large splice discontinuity
  let maxDelta = 0;
  for (let i = 1; i < trunc.channels[0].length; i++) {
    assert.ok(Number.isFinite(trunc.channels[0][i]));
    maxDelta = Math.max(
      maxDelta,
      Math.abs(trunc.channels[0][i] - trunc.channels[0][i - 1]),
    );
  }
  assert.ok(maxDelta < 0.5, `Unexpected splice click delta: ${maxDelta}`);

  const comp = truncateSilenceAudio([sig], {
    thresholdDb: -40,
    minDurationSec: 0.2,
    mode: "compress",
    compressPercent: 50,
    sampleRate: sr,
  });
  assert.equal(comp.meta.regionsTruncated, 1);
  const expectedCompFrames = Math.round(0.3 * sr);
  assert.ok(
    Math.abs(comp.meta.removedFrames - expectedCompFrames) < sr * 0.05,
    `Expected ~${expectedCompFrames} compressed frames, got ${comp.meta.removedFrames}`,
  );

  // Dispatch through processAudioChannels + pluggable backend override
  const viaDispatch = processAudioChannels(
    [sig],
    "change_pitch",
    { semitones: 5 },
    sr,
  );
  assert.equal(viaDispatch.channels[0].length, sig.length);

  let backendCalled = false;
  registerDspBackend("change_tempo", (chs) => {
    backendCalled = true;
    return { channels: chs, meta: { custom: true } };
  });
  const overrideRes = processAudioChannels([sig], "change_tempo", {}, sr);
  assert.equal(backendCalled, true);
  assert.equal(overrideRes.meta.custom, true);
  unregisterDspBackend("change_tempo");
});

test("Phase 5.2: Engine duration sync, sub-range length splice, non-destructive clip playback & split_at_silences", async () => {
  let capturedSources = [];
  class InspectOfflineCtx extends FakeOfflineAudioContext {
    createBufferSource() {
      const s = super.createBufferSource();
      capturedSources.push(s);
      return s;
    }
  }
  const engine = new DawEngine({
    project: createProject("empty"),
    audioContext: new FakeAudioContext({ sampleRate: 16000 }),
    offlineAudioContextClass: InspectOfflineCtx,
  });
  const addTrk = await engine.sendCommand("add_track", {
    kind: "audio",
    name: "Vocals",
  });
  const trackId = addTrk.trackId;

  const sr = 16000;
  const toneGap = makeToneWithSilenceGap(sr); // 1.4s -> 2.8 beats @ 120 BPM
  const sampleKey = "vox_gap_1";
  await engine.loadSample(sampleKey, {
    numberOfChannels: 1,
    length: toneGap.length,
    sampleRate: sr,
    duration: toneGap.length / sr,
    getChannelData: () => toneGap,
  });

  const addClip = await engine.sendCommand("add_audio_clip", {
    trackId,
    clip: {
      name: "Vox Take",
      sample: sampleKey,
      time: 0,
      duration: (toneGap.length / sr) * 2,
      pitch: 3,
      speed: 1.25,
      stretchToMatchTempo: true,
      sourceBpm: 120,
    },
  });
  const clipId = addClip.clipId;

  // Verify computeClipPlaybackParams
  const pb = computeClipPlaybackParams(addClip.clip, 150);
  assert.ok(Math.abs(pb.playbackRate - 1.5625) < 1e-4);
  assert.equal(pb.detuneCents, 300);

  // Verify bounce uses playbackRate & detune on AudioBufferSourceNode
  await engine.sendCommand("set_transport", { bpm: 150, lengthBars: 2 });
  await engine.bounce({
    durationSec: 2,
  });
  assert.ok(capturedSources.length >= 1);
  assert.ok(Math.abs(capturedSources[0].playbackRate.value - 1.5625) < 1e-3);
  assert.equal(capturedSources[0].detune.value, 300);

  // Reset BPM to 120 and test processAudioClip length update + lossless 1-step undo
  await engine.sendCommand("set_transport", { bpm: 120 });
  const origDur = engine.project
    .get()
    .tracks.find((t) => t.id === trackId)
    .audioClips.find((c) => c.id === clipId).duration;

  const truncRes = await engine.sendCommand("process_audio_clip", {
    trackId,
    clipId,
    effect: "truncate_silence",
    params: { thresholdDb: -40, minDurationSec: 0.2, truncateToSec: 0.05 },
  });
  assert.equal(truncRes.ok, true);
  assert.ok(
    truncRes.clip.duration < origDur - 0.5,
    `Expected duration to shrink from ${origDur}, got ${truncRes.clip.duration}`,
  );

  // Sub-range length-changing splice should succeed cleanly without RangeError
  const subRangeRes = await engine.sendCommand("process_audio_clip", {
    trackId,
    clipId,
    effect: "change_tempo",
    startSec: 0.0,
    endSec: 0.4,
    params: { tempoMultiplier: 2.0 },
  });
  assert.equal(subRangeRes.ok, true);

  // Undo twice restores original sample and duration cleanly
  await engine.sendCommand("undo");
  await engine.sendCommand("undo");
  const restoredClip = engine.project
    .get()
    .tracks.find((t) => t.id === trackId)
    .audioClips.find((c) => c.id === clipId);
  assert.equal(restoredClip.sample, sampleKey);
  assert.ok(Math.abs(restoredClip.duration - origDur) < 1e-3);

  // split_at_silences splits into 2 clips and reverts in 1 undo
  const splitSilRes = await engine.sendCommand("split_at_silences", {
    trackId,
    clipId,
    thresholdDb: -35,
    minDurationSec: 0.2,
  });
  assert.equal(splitSilRes.ok, true);
  assert.equal(splitSilRes.segments.length, 2);
  const trackAfterSplit = engine.project
    .get()
    .tracks.find((t) => t.id === trackId);
  assert.equal(trackAfterSplit.audioClips.length, 2);
  assert.ok(
    trackAfterSplit.audioClips[1].time > trackAfterSplit.audioClips[0].time,
  );

  await engine.sendCommand("undo");
  const trackAfterUndo = engine.project
    .get()
    .tracks.find((t) => t.id === trackId);
  assert.equal(trackAfterUndo.audioClips.length, 1);

  // analyzeAudioClip with createLabels populates project.labels
  const analyzeSil = await engine.sendCommand("analyze_audio_clip", {
    trackId,
    clipId,
    analysis: "silence_finder",
    params: { thresholdDb: -35, minDurationSec: 0.2, createLabels: true },
  });
  assert.equal(analyzeSil.ok, true);
  assert.equal(analyzeSil.labelsCreated, 1);
  assert.equal(engine.project.get().labels.length, 1);
});

test("Phase 5.3: Project label tracks, split_at_labels, and scdaw_manage_labels WebMCP tool", async () => {
  const proj = createProject("empty");
  assert.deepEqual(proj.labels, []);
  assert.equal(validateProject({ ...proj, labels: "invalid" }).valid, false);

  // Reducer operations
  const addedPoint = applyCommand(proj, "add_label", {
    title: "Verse",
    startBeat: 2,
  });
  assert.equal(addedPoint.project.labels.length, 1);
  assert.equal(addedPoint.result.label.endBeat, 2);

  const addedRegion = applyCommand(addedPoint.project, "add_label", {
    title: "Chorus Vocals",
    startBeat: 4,
    endBeat: 8,
    lowFrequency: 200,
    highFrequency: 4000,
    color: "#38bdf8",
  });
  assert.equal(addedRegion.project.labels.length, 2);
  assert.equal(addedRegion.result.label.lowFrequency, 200);
  assert.equal(addedRegion.result.label.highFrequency, 4000);

  // Split clip at labels
  let withClip = applyCommand(addedRegion.project, "add_track", {
    kind: "audio",
    name: "Guitar",
  }).project;
  const trkId = withClip.tracks[0].id;
  withClip = applyCommand(withClip, "add_audio_clip", {
    trackId: trkId,
    clip: { name: "Gtr", sample: "gtr_1", time: 0, duration: 10 },
  }).project;

  const splitRes = applyCommand(withClip, "split_at_labels", {
    trackId: trkId,
    includeRegionEnds: false,
  });
  assert.equal(splitRes.result.ok, true);
  assert.equal(splitRes.project.tracks[0].audioClips.length, 3);
  assert.equal(splitRes.project.tracks[0].audioClips[0].time, 0);
  assert.equal(splitRes.project.tracks[0].audioClips[1].time, 2);
  assert.equal(splitRes.project.tracks[0].audioClips[2].time, 4);

  // WebMCP adapter dispatch round-trip on live scdaw singleton
  await handleToolDispatch("scdaw_reset", { template: "empty" });
  const trk = await handleToolDispatch("scdaw_add_track", {
    kind: "audio",
    name: "Stems",
  });
  await handleToolDispatch("scdaw_add_audio_clip", {
    trackId: trk.trackId,
    clip: { name: "Stem A", sample: "s1", time: 0, duration: 8 },
  });

  const lblAdd = await handleToolDispatch("scdaw_manage_labels", {
    action: "add",
    title: "Drop",
    startBeat: 4,
  });
  assert.equal(lblAdd.ok, true);
  const lblList = await handleToolDispatch("scdaw_manage_labels", {
    action: "list",
  });
  assert.equal(lblList.labels.length, 1);

  const lblUpd = await handleToolDispatch("scdaw_manage_labels", {
    action: "update",
    labelId: lblAdd.label.id,
    title: "Main Drop",
    endBeat: 6,
  });
  assert.equal(lblUpd.label.title, "Main Drop");
  assert.equal(lblUpd.label.endBeat, 6);

  const lblSplit = await handleToolDispatch("scdaw_manage_labels", {
    action: "split_at_labels",
    trackId: trk.trackId,
  });
  assert.equal(lblSplit.splitCount >= 1, true);

  await handleToolDispatch("scdaw_manage_labels", {
    action: "remove",
    labelId: lblAdd.label.id,
  });
  const afterRem = await handleToolDispatch("scdaw_manage_labels", {
    action: "list",
  });
  assert.equal(afterRem.labels.length, 0);
});

test("Phase 5.4: Mobile-first ARIA Timeline label lane and Wave Editor Phase 5 controls", async () => {
  const layout = computeLabelLayout(
    [
      { id: "l1", title: "Point", startBeat: 4, endBeat: 4 },
      { id: "l2", title: "Region", startBeat: 8, endBeat: 12 },
    ],
    16,
  );
  assert.equal(layout.length, 2);
  assert.equal(layout[0].leftPct, 25);
  assert.equal(layout[0].isRegion, false);
  assert.equal(layout[1].leftPct, 50);
  assert.equal(layout[1].widthPct, 25);
  assert.equal(layout[1].isRegion, true);

  const timelineSrc = await fs.readFile(
    new URL(
      "../.agents/scripts/components/shadow-claw-daw-timeline.js",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(timelineSrc, /scdaw-timeline__label-track/);
  assert.match(timelineSrc, /aria-label=["']Project labels["']/);
  assert.match(timelineSrc, /id=["']timeline-add-label-btn["']/);
  assert.match(timelineSrc, /id=["']timeline-clear-labels-btn["']/);
  assert.match(timelineSrc, /scdaw-timeline__label-item/);

  const waveSrc = await fs.readFile(
    new URL(
      "../.agents/scripts/components/shadow-claw-daw-wave-editor.js",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(waveSrc, /data-effect=["']truncate_silence["']/);
  assert.match(waveSrc, /data-effect=["']change_tempo["']/);
  assert.match(waveSrc, /data-effect=["']change_pitch["']/);
  assert.match(waveSrc, /data-effect=["']change_speed["']/);
  assert.match(waveSrc, /data-op=["']split_at_silences["']/);
  assert.match(waveSrc, /id=["']wave-add-label-btn["']/);
});
