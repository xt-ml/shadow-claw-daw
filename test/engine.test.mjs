import test from "node:test";
import assert from "node:assert/strict";
import {
  FakeAudioContext,
  FakeOfflineAudioContext,
} from "./helpers/fake-audio-context.mjs";
import { triggerInstrumentVoice } from "../.agents/scripts/scdaw-instruments.js";
import { DawEngine } from "../.agents/scripts/scdaw-engine.js";

test("Instruments: triggers drum synth voices with parameter automation", () => {
  const ctx = new FakeAudioContext();
  const dest = ctx.createGain();

  // Test kick
  const kickVoice = triggerInstrumentVoice(
    ctx,
    dest,
    {
      trackKind: "drums",
      note: { pitch: 36, velocity: 0.9, duration: 240 },
    },
    0.1,
    120,
  );
  assert.ok(kickVoice, "kick voice should be created");

  // Test snare
  const snareVoice = triggerInstrumentVoice(
    ctx,
    dest,
    {
      trackKind: "drums",
      note: { pitch: 38, velocity: 0.8, duration: 240 },
    },
    0.2,
    120,
  );
  assert.ok(snareVoice, "snare voice should be created");

  // Test hat
  const hatVoice = triggerInstrumentVoice(
    ctx,
    dest,
    {
      trackKind: "drums",
      note: { pitch: 42, velocity: 0.7, duration: 240 },
    },
    0.3,
    120,
  );
  assert.ok(hatVoice, "hat voice should be created");
});

test("Instruments: triggers synth voice with ADSR and filter", () => {
  const ctx = new FakeAudioContext();
  const dest = ctx.createGain();

  const synthVoice = triggerInstrumentVoice(
    ctx,
    dest,
    {
      trackKind: "synth",
      trackParams: {
        waveform: "sawtooth",
        cutoff: 1200,
        resonance: 4,
        attack: 0.02,
        decay: 0.2,
        sustain: 0.5,
        release: 0.1,
      },
      note: { pitch: 60, velocity: 0.85, duration: 480 },
    },
    0.5,
    120,
  );

  assert.ok(synthVoice, "synth voice should be created");
});

test("DawEngine: initializes, controls transport, and mutates via commands", async () => {
  const ctx = new FakeAudioContext();
  const engine = new DawEngine({
    audioContext: ctx,
    offlineAudioContextClass: FakeOfflineAudioContext,
  });

  const state = engine.getState();
  assert.equal(state.playing, false);
  assert.equal(state.trackCount, 2); // default basic-beat has drums + bass

  // Play
  await engine.play();
  assert.equal(engine.getState().playing, true);

  // Stop
  await engine.stop();
  assert.equal(engine.getState().playing, false);

  // Send command: add track
  const addRes = await engine.sendCommand("add_track", {
    kind: "synth",
    name: "Lead",
  });
  assert.ok(addRes.trackId);
  assert.equal(engine.getState().trackCount, 3);

  // Undo command
  const undoRes = await engine.sendCommand("undo");
  assert.ok(undoRes.ok);
  assert.equal(engine.getState().trackCount, 2);

  // Bounce
  const bounceRes = await engine.bounce({ loops: 1, saveToWorkspace: true });
  assert.ok(bounceRes);
  assert.ok(bounceRes.bytes > 0);
  assert.equal(bounceRes.channels, 2);
  assert.ok(engine.getState().lastBounce);
});

test("DawEngine: automation ramps volume and pan AudioParams during playback", async () => {
  const ctx = new FakeAudioContext();
  const engine = new DawEngine({
    audioContext: ctx,
    offlineAudioContextClass: FakeOfflineAudioContext,
  });

  try {
    const project = engine.getProject();
    const bassTrackId = project.tracks.find((t) => t.id === "trk_bass").id;

    // Set automation for volume and pan on bass track
    await engine.sendCommand("set_automation", {
      trackId: bassTrackId,
      param: "volume",
      points: [
        { time: 0, value: 0.2 },
        { time: 2, value: 0.9 },
      ],
    });
    await engine.sendCommand("set_automation", {
      trackId: bassTrackId,
      param: "pan",
      points: [
        { time: 0, value: -0.8 },
        { time: 2, value: 0.8 },
      ],
    });

    await engine.play();
    // Simulate clock tick
    engine._onClockTick();

    const bassNodes = engine.graph.tracks.get(bassTrackId);
    assert.ok(bassNodes, "bass nodes exist in graph");

    // Check that events were pushed to FakeAudioParam
    const gainEvents = bassNodes.gain.gain.events;
    const hasRamp = gainEvents.some(
      (e) => e.type === "linearRampToValueAtTime",
    );
    assert.ok(
      hasRamp,
      "volume linearRampToValueAtTime was called on gain AudioParam",
    );

    if (bassNodes.panner) {
      const panEvents = bassNodes.panner.pan.events;
      const hasPanRamp = panEvents.some(
        (e) => e.type === "linearRampToValueAtTime",
      );
      assert.ok(
        hasPanRamp,
        "pan linearRampToValueAtTime was called on panner AudioParam",
      );
    }
  } finally {
    await engine.stop();
  }
});

test("DawEngine: schedules audio clips for audio tracks", async () => {
  const ctx = new FakeAudioContext();
  const engine = new DawEngine({
    audioContext: ctx,
    offlineAudioContextClass: FakeOfflineAudioContext,
  });

  try {
    // Add audio track
    const addRes = await engine.sendCommand("add_track", {
      name: "Audio Stems",
      kind: "audio",
    });
    const audioTrackId = addRes.trackId;

    // Add audio clip at time 0
    await engine.sendCommand("add_audio_clip", {
      trackId: audioTrackId,
      clip: {
        id: "clip_intro",
        name: "Intro Stem",
        time: 0,
        duration: 2,
        offset: 0,
        gain: 0.9,
      },
    });

    await engine.play();
    engine._lastSchedulePpqn = 0;
    engine._onClockTick();

    // Active voices should contain scheduled audio clip source
    assert.ok(
      engine._activeVoices.size > 0,
      "active voices has scheduled audio clip",
    );
  } finally {
    await engine.stop();
  }
});

test("DawEngine: configures aux send gain routing between tracks", async () => {
  const ctx = new FakeAudioContext();
  const engine = new DawEngine({
    audioContext: ctx,
    offlineAudioContextClass: FakeOfflineAudioContext,
  });

  try {
    const p = engine.getProject();
    const trkDrums = p.tracks.find((t) => t.id === "trk_drums").id;
    const trkBass = p.tracks.find((t) => t.id === "trk_bass").id;

    // Send drums to bass with send level 0.6
    await engine.sendCommand("set_track_send", {
      trackId: trkDrums,
      targetTrackId: trkBass,
      level: 0.6,
    });

    const drumNodes = engine.graph.tracks.get(trkDrums);
    assert.ok(drumNodes, "drum nodes exist in graph");
    assert.ok(drumNodes.sends instanceof Map, "drum nodes has sends map");
    assert.ok(drumNodes.sends.has(trkBass), "drum nodes has send to bass");

    const sendObj = drumNodes.sends.get(trkBass);
    assert.equal(sendObj.gainNode.gain.value, 0.6);
  } finally {
    await engine.stop();
  }
});
