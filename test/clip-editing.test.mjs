import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  createProject,
  applyCommand,
  evaluateClipGainEnvelope,
} from "../.agents/scripts/shadow-claw-daw.js";
import {
  DawEngine,
  scheduleClipGainAutomation,
} from "../.agents/scripts/shadow-claw-daw-engine.js";
import {
  calculateClipFadeHandleDrag,
  renderClipFadeOverlaySvg,
  setupClipInteraction,
} from "../.agents/scripts/components/shadow-claw-daw-timeline.js";
import { handleToolDispatch } from "../.agents/scripts/shadow-claw-daw-adapter.js";
import {
  FakeAudioContext,
  FakeOfflineAudioContext,
} from "./helpers/fake-audio-context.mjs";

function makeAudioProject({ bpm = 120, clips = [] } = {}) {
  const proj = createProject("empty", { bpm });
  const added = applyCommand(proj, "add_track", {
    kind: "audio",
    name: "Vocals",
  }).project;
  const trackId = added.tracks.find((t) => t.kind === "audio").id;
  let current = added;
  for (const clip of clips) {
    current = applyCommand(current, "add_audio_clip", {
      trackId,
      clip,
    }).project;
  }
  return { project: current, trackId };
}

test("Phase 1.1: evaluateClipGainEnvelope computes linear, logarithmic equal-power, s-curve, envelope, and mute", () => {
  // Default flat gain
  assert.equal(evaluateClipGainEnvelope({ gain: 0.8 }, 1.0, 4.0), 0.8);
  assert.equal(evaluateClipGainEnvelope({ gain: 1.0 }, 0.0, 4.0), 1.0);

  // Muted clip returns 0
  assert.equal(
    evaluateClipGainEnvelope({ gain: 1.0, muted: true }, 1.0, 4.0),
    0,
  );

  // Linear fade-in and fade-out
  const linearClip = {
    gain: 1.0,
    fadeIn: 1.0,
    fadeOut: 1.0,
    fadeInType: "linear",
    fadeOutType: "linear",
  };
  assert.ok(
    Math.abs(evaluateClipGainEnvelope(linearClip, 0.0, 4.0) - 0.0) < 1e-6,
  );
  assert.ok(
    Math.abs(evaluateClipGainEnvelope(linearClip, 0.5, 4.0) - 0.5) < 1e-6,
  );
  assert.ok(
    Math.abs(evaluateClipGainEnvelope(linearClip, 2.0, 4.0) - 1.0) < 1e-6,
  );
  assert.ok(
    Math.abs(evaluateClipGainEnvelope(linearClip, 3.5, 4.0) - 0.5) < 1e-6,
  );
  assert.ok(
    Math.abs(evaluateClipGainEnvelope(linearClip, 4.0, 4.0) - 0.0) < 1e-6,
  );

  // Logarithmic equal-power curve: midpoint ~ sqrt(0.5) and sin^2 + cos^2 = 1
  const fadeOutClip = { fadeOut: 2.0, fadeOutType: "logarithmic" };
  const fadeInClip = { fadeIn: 2.0, fadeInType: "logarithmic" };
  const midOut = evaluateClipGainEnvelope(fadeOutClip, 1.0, 2.0);
  const midIn = evaluateClipGainEnvelope(fadeInClip, 1.0, 2.0);
  assert.ok(Math.abs(midOut - Math.SQRT1_2) < 1e-5);
  assert.ok(Math.abs(midIn - Math.SQRT1_2) < 1e-5);
  for (const t of [0.25, 0.75, 1.25, 1.75]) {
    const gOut = evaluateClipGainEnvelope(fadeOutClip, t, 2.0);
    const gIn = evaluateClipGainEnvelope(fadeInClip, t, 2.0);
    assert.ok(
      Math.abs(gOut * gOut + gIn * gIn - 1.0) < 1e-5,
      `Equal power energy must sum to 1 at t=${t}`,
    );
  }

  // S-curve fade-in midpoint is 0.5 and slope at ends is smooth
  const sCurveClip = { fadeIn: 2.0, fadeInType: "scurve" };
  assert.ok(
    Math.abs(evaluateClipGainEnvelope(sCurveClip, 0.0, 2.0) - 0.0) < 1e-6,
  );
  assert.ok(
    Math.abs(evaluateClipGainEnvelope(sCurveClip, 1.0, 2.0) - 0.5) < 1e-6,
  );
  assert.ok(
    Math.abs(evaluateClipGainEnvelope(sCurveClip, 2.0, 2.0) - 1.0) < 1e-6,
  );

  // Overlapping fades > durSec scale proportionally without negative/NaN
  const overlapClip = {
    fadeIn: 3.0,
    fadeOut: 3.0,
    fadeInType: "linear",
    fadeOutType: "linear",
  };
  const midOverlap = evaluateClipGainEnvelope(overlapClip, 1.0, 2.0);
  assert.ok(Number.isFinite(midOverlap) && midOverlap >= 0 && midOverlap <= 1);

  // Multi-point gainEnvelope interpolation & clamping
  const envClip = {
    gain: 0.5,
    gainEnvelope: [
      { time: 3.0, value: 0.2 },
      { time: 1.0, value: 1.0 },
    ],
  };
  assert.ok(Math.abs(evaluateClipGainEnvelope(envClip, 0.0, 4.0) - 0.5) < 1e-6);
  assert.ok(Math.abs(evaluateClipGainEnvelope(envClip, 2.0, 4.0) - 0.3) < 1e-6);
  assert.ok(Math.abs(evaluateClipGainEnvelope(envClip, 3.8, 4.0) - 0.1) < 1e-6);
});

test("Phase 1.2: pure reducers split, trim, duplicate, join, crossfade, set_fades, set_envelope, silence", () => {
  // 1. split_audio_clip slices time/duration/offset, fades, and gainEnvelope
  const { project: p1, trackId } = makeAudioProject({
    bpm: 120, // 0.5 sec per beat
    clips: [
      {
        id: "c1",
        name: "Take 1",
        sample: "vox.wav",
        time: 0,
        duration: 8,
        offset: 0.5,
        fadeIn: 0.25,
        fadeOut: 0.4,
        fadeInType: "linear",
        fadeOutType: "logarithmic",
        gainEnvelope: [
          { time: 0, value: 1.0 },
          { time: 3.0, value: 0.4 },
        ],
      },
    ],
  });

  const splitRes = applyCommand(p1, "split_audio_clip", {
    trackId,
    clipId: "c1",
    splitBeat: 3, // 1.5s into clip (midpoint between 0s=1.0 and 3.0s=0.4 -> 0.7)
  });
  const splitClips = splitRes.project.tracks.find(
    (t) => t.id === trackId,
  ).audioClips;
  assert.equal(splitClips.length, 2);
  assert.equal(splitClips[0].time, 0);
  assert.equal(splitClips[0].duration, 3);
  assert.equal(splitClips[0].offset, 0.5);
  assert.equal(splitClips[0].fadeIn, 0.25);
  assert.equal(splitClips[0].fadeOut, 0);

  assert.equal(splitClips[1].time, 3);
  assert.equal(splitClips[1].duration, 5);
  assert.equal(splitClips[1].offset, 2.0); // 0.5 + (3 * 0.5)
  assert.equal(splitClips[1].fadeIn, 0);
  assert.equal(splitClips[1].fadeOut, 0.4);
  assert.equal(splitClips[1].fadeOutType, "logarithmic");

  const leftLastPt = splitClips[0].gainEnvelope.at(-1);
  const rightFirstPt = splitClips[1].gainEnvelope[0];
  assert.ok(Math.abs(leftLastPt.time - 1.5) < 1e-6);
  assert.ok(Math.abs(leftLastPt.value - 0.7) < 1e-6);
  assert.ok(Math.abs(rightFirstPt.time - 0) < 1e-6);
  assert.ok(Math.abs(rightFirstPt.value - 0.7) < 1e-6);
  assert.ok(Math.abs(splitClips[1].gainEnvelope[1].time - 1.5) < 1e-6);

  assert.throws(() =>
    applyCommand(p1, "split_audio_clip", {
      trackId,
      clipId: "c1",
      splitBeat: 8,
    }),
  );

  // 2. trim_audio_clip updates left/right boundaries and shifts envelope
  const trimRes = applyCommand(p1, "trim_audio_clip", {
    trackId,
    clipId: "c1",
    startBeat: 2,
    endBeat: 6,
  });
  const trimmed = trimRes.project.tracks.find((t) => t.id === trackId)
    .audioClips[0];
  assert.equal(trimmed.time, 2);
  assert.equal(trimmed.duration, 4);
  assert.equal(trimmed.offset, 1.5); // 0.5 + 2*0.5

  // 3. duplicate_audio_clip clones clip after original or at custom time
  const dupRes = applyCommand(p1, "duplicate_audio_clip", {
    trackId,
    clipId: "c1",
  });
  const dupClips = dupRes.project.tracks.find(
    (t) => t.id === trackId,
  ).audioClips;
  assert.equal(dupClips.length, 2);
  assert.equal(dupClips[1].time, 8);
  assert.equal(dupClips[1].duration, 8);
  assert.notEqual(dupClips[1].id, "c1");
  assert.deepEqual(dupClips[1].gainEnvelope, dupClips[0].gainEnvelope);

  // 4. join_audio_clips merges clips sharing the same sample and rejects mismatches
  const joinedRes = applyCommand(splitRes.project, "join_audio_clips", {
    trackId,
    clipIds: splitClips.map((c) => c.id),
  });
  const joinedClips = joinedRes.project.tracks.find(
    (t) => t.id === trackId,
  ).audioClips;
  assert.equal(joinedClips.length, 1);
  assert.equal(joinedClips[0].time, 0);
  assert.equal(joinedClips[0].duration, 8);
  assert.equal(joinedClips[0].offset, 0.5);
  assert.equal(joinedClips[0].fadeIn, 0.25);
  assert.equal(joinedClips[0].fadeOut, 0.4);

  const { project: pMismatch, trackId: mismatchTrackId } = makeAudioProject({
    clips: [
      { id: "a", sample: "s1.wav", time: 0, duration: 2 },
      { id: "b", sample: "s2.wav", time: 2, duration: 2 },
    ],
  });
  assert.throws(
    () =>
      applyCommand(pMismatch, "join_audio_clips", {
        trackId: mismatchTrackId,
        clipIds: ["a", "b"],
      }),
    /sample/i,
  );

  // 5. crossfade_audio_clips creates equal-power logarithmic crossfade
  const { project: pCf, trackId: cfTrackId } = makeAudioProject({
    bpm: 120,
    clips: [
      { id: "cA", sample: "s1.wav", time: 0, duration: 4 },
      { id: "cB", sample: "s2.wav", time: 4, duration: 4 },
    ],
  });
  const cfRes = applyCommand(pCf, "crossfade_audio_clips", {
    trackId: cfTrackId,
    clipIdA: "cA",
    clipIdB: "cB",
    durationBeats: 1,
  });
  const cfClips = cfRes.project.tracks.find(
    (t) => t.id === cfTrackId,
  ).audioClips;
  assert.equal(cfClips[0].fadeOut, 0.5);
  assert.equal(cfClips[0].fadeOutType, "logarithmic");
  assert.equal(cfClips[1].time, 3);
  assert.equal(cfClips[1].fadeIn, 0.5);
  assert.equal(cfClips[1].fadeInType, "logarithmic");

  // 6. set_clip_fades & set_clip_gain_envelope
  const fadesRes = applyCommand(p1, "set_clip_fades", {
    trackId,
    clipId: "c1",
    fadeIn: 10, // clamped to clip duration (4.0s at 120bpm)
    fadeOut: 1.0,
    fadeInType: "scurve",
    fadeOutType: "linear",
  });
  const fadedClip = fadesRes.project.tracks.find((t) => t.id === trackId)
    .audioClips[0];
  assert.equal(fadedClip.fadeIn, 4.0);
  assert.equal(fadedClip.fadeInType, "scurve");

  const envUpsert = applyCommand(p1, "set_clip_gain_envelope", {
    trackId,
    clipId: "c1",
    point: { time: 1.5, value: 1.5 },
  });
  const envClip = envUpsert.project.tracks.find((t) => t.id === trackId)
    .audioClips[0];
  assert.equal(envClip.gainEnvelope.length, 3);
  assert.equal(envClip.gainEnvelope[1].value, 1.5);

  const envRemove = applyCommand(envUpsert.project, "set_clip_gain_envelope", {
    trackId,
    clipId: "c1",
    removeTime: 1.5,
  });
  assert.equal(
    envRemove.project.tracks.find((t) => t.id === trackId).audioClips[0]
      .gainEnvelope.length,
    2,
  );

  // 7. silence_audio_clip & silence_clip_range
  const muteRes = applyCommand(p1, "silence_audio_clip", {
    trackId,
    clipId: "c1",
    muted: true,
  });
  assert.equal(
    muteRes.project.tracks.find((t) => t.id === trackId).audioClips[0].muted,
    true,
  );

  const silRangeRes = applyCommand(p1, "silence_clip_range", {
    trackId,
    clipId: "c1",
    startBeat: 2,
    endBeat: 4,
  });
  const silClips = silRangeRes.project.tracks.find(
    (t) => t.id === trackId,
  ).audioClips;
  assert.equal(silClips.length, 2);
  assert.equal(silClips[0].time, 0);
  assert.equal(silClips[0].duration, 2);
  assert.equal(silClips[1].time, 4);
  assert.equal(silClips[1].duration, 4);
  assert.equal(silClips[1].offset, 2.5); // 0.5 + 4 * 0.5
});

test("Phase 1.3: DawEngine schedules clip fades/envelopes, skips muted clips, bounces, and undoes splits", async () => {
  const engine = new DawEngine({
    audioContext: new FakeAudioContext(),
    offlineAudioContextClass: FakeOfflineAudioContext,
  });
  const trackRes = await engine.sendCommand("add_track", {
    kind: "audio",
    name: "Guitar",
  });
  const trackId = trackRes.trackId;
  const buf = engine.ctx.createBuffer(1, 44100 * 2, 44100);
  buf.getChannelData(0).fill(0.5);
  await engine.loadSample("gtr.wav", buf);

  await engine.sendCommand("add_audio_clip", {
    trackId,
    clip: {
      id: "g1",
      name: "Riff",
      sample: "gtr.wav",
      time: 0,
      duration: 4,
      fadeIn: 0.5,
      fadeOut: 0.5,
      fadeInType: "linear",
      fadeOutType: "logarithmic",
    },
  });

  // scheduleClipGainAutomation sets curve / ramps cleanly and zeroes muted clips
  const gainParam = engine.ctx.createGain().gain;
  scheduleClipGainAutomation(
    gainParam,
    {
      gain: 1.0,
      fadeIn: 0.5,
      fadeOut: 0.5,
      fadeInType: "linear",
      fadeOutType: "logarithmic",
    },
    1.0,
    2.0,
    16,
  );
  assert.ok(gainParam.events.length > 0);

  const mutedGainParam = engine.ctx.createGain().gain;
  scheduleClipGainAutomation(
    mutedGainParam,
    { gain: 1.0, muted: true },
    0,
    2.0,
    16,
  );
  assert.equal(mutedGainParam.events[0].val, 0);

  // Split + undo restores original clip
  await engine.sendCommand("split_audio_clip", {
    trackId,
    clipId: "g1",
    splitBeat: 2,
  });
  assert.equal(
    engine.getProject().tracks.find((t) => t.id === trackId).audioClips.length,
    2,
  );
  await engine.sendCommand("undo");
  assert.equal(
    engine.getProject().tracks.find((t) => t.id === trackId).audioClips.length,
    1,
  );

  // Offline bounce honors fades & muted clips without throwing
  const bounceRes = await engine.bounce({ loops: 1, bitDepth: 16 });
  assert.equal(bounceRes.bitDepth, 16);
  assert.ok(bounceRes.bytes > 44);
});

test("Phase 1.4: Timeline fade drag helper, SVG overlay, keyboard split/duplicate, and ARIA/touch compliance", async () => {
  const fadeInSec = calculateClipFadeHandleDrag({
    edge: "fade-in",
    deltaX: 50,
    clipWidthPx: 200,
    clipDurSec: 4.0,
    currentFadeSec: 0,
    otherFadeSec: 1.0,
  });
  assert.equal(fadeInSec, 1.0);

  const fadeOutSec = calculateClipFadeHandleDrag({
    edge: "fade-out",
    deltaX: -50,
    clipWidthPx: 200,
    clipDurSec: 4.0,
    currentFadeSec: 0,
    otherFadeSec: 1.0,
  });
  assert.equal(fadeOutSec, 1.0);

  // Clamped to remaining duration
  const clamped = calculateClipFadeHandleDrag({
    edge: "fade-in",
    deltaX: 500,
    clipWidthPx: 200,
    clipDurSec: 4.0,
    currentFadeSec: 0,
    otherFadeSec: 1.5,
  });
  assert.equal(clamped, 2.5);

  const flatSvg = renderClipFadeOverlaySvg({ time: 0, duration: 4 }, 120);
  assert.equal(flatSvg, "");

  const fadedSvg = renderClipFadeOverlaySvg(
    {
      time: 0,
      duration: 4,
      fadeIn: 0.5,
      fadeOut: 0.5,
      gainEnvelope: [
        { time: 0, value: 1 },
        { time: 1, value: 0.5 },
      ],
    },
    120,
  );
  assert.match(fadedSvg, /<svg/);
  assert.match(fadedSvg, /<path/);
  assert.match(fadedSvg, /<polyline/);

  // Keyboard shortcuts S (split) and D (duplicate) via setupClipInteraction
  const actions = [];
  const listeners = {};
  const clipEl = {
    classList: { add() {}, remove() {}, contains: () => false },
    setAttribute() {},
    addEventListener(evt, fn) {
      listeners[evt] = fn;
    },
    removeEventListener() {},
  };
  setupClipInteraction({
    clipEl,
    clip: { id: "c1", name: "Take", time: 2, duration: 4 },
    trackId: "trk1",
    totalBeats: 8,
    bpm: 120,
    onSplit: (splitBeat) => actions.push({ type: "split", splitBeat }),
    onDuplicate: () => actions.push({ type: "duplicate" }),
    onFadeChange: (patch) => actions.push({ type: "fade", patch }),
  });

  listeners.keydown({
    key: "s",
    target: { closest: () => null },
    preventDefault() {},
    stopPropagation() {},
  });
  listeners.keydown({
    key: "d",
    target: { closest: () => null },
    preventDefault() {},
    stopPropagation() {},
  });
  assert.deepEqual(actions, [
    { type: "split", splitBeat: 4 },
    { type: "duplicate" },
  ]);

  const timelineSrc = await fs.readFile(
    new URL(
      "../.agents/scripts/components/shadow-claw-daw-timeline.js",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(timelineSrc, /scdaw-timeline__fade-handle--in/);
  assert.match(timelineSrc, /scdaw-timeline__fade-handle--out/);
  assert.match(timelineSrc, /Fade in duration/);
  assert.match(timelineSrc, /Fade out duration/);
  assert.match(timelineSrc, /@media\s*\(\s*pointer:\s*coarse\s*\)/);
});

test("Phase 1.5: scdaw_edit_audio_clip WebMCP tool dispatches all clip editing actions", async () => {
  const addTrk = await handleToolDispatch("scdaw_add_track", {
    kind: "audio",
    name: "Audio",
  });
  const trackId = addTrk.trackId;

  await handleToolDispatch("scdaw_add_audio_clip", {
    trackId,
    clip: {
      id: "clip_edit_1",
      name: "Stem",
      sample: "stem.wav",
      time: 0,
      duration: 8,
    },
  });

  const fadesRes = await handleToolDispatch("scdaw_edit_audio_clip", {
    action: "set_fades",
    trackId,
    clipId: "clip_edit_1",
    fadeIn: 0.5,
    fadeOut: 0.5,
    fadeInType: "logarithmic",
  });
  assert.equal(fadesRes.clip.fadeIn, 0.5);

  const envRes = await handleToolDispatch("scdaw_edit_audio_clip", {
    action: "set_envelope",
    trackId,
    clipId: "clip_edit_1",
    point: { time: 1.0, value: 0.6 },
  });
  assert.equal(envRes.clip.gainEnvelope.length, 1);

  const splitRes = await handleToolDispatch("scdaw_edit_audio_clip", {
    action: "split",
    trackId,
    clipId: "clip_edit_1",
    splitBeat: 4,
  });
  assert.equal(splitRes.clips.length, 2);

  const dupRes = await handleToolDispatch("scdaw_edit_audio_clip", {
    action: "duplicate",
    trackId,
    clipId: splitRes.clips[1].id,
    time: 8,
  });
  assert.equal(dupRes.clip.time, 8);

  const cfRes = await handleToolDispatch("scdaw_edit_audio_clip", {
    action: "crossfade",
    trackId,
    clipIdA: splitRes.clips[0].id,
    clipIdB: splitRes.clips[1].id,
    durationBeats: 1,
  });
  assert.ok(cfRes.ok);

  const muteRes = await handleToolDispatch("scdaw_edit_audio_clip", {
    action: "mute",
    trackId,
    clipId: splitRes.clips[0].id,
    muted: true,
  });
  assert.equal(muteRes.clip.muted, true);
});
