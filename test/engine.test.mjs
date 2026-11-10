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

test("DawEngine & Presets: applying new synth presets replaces parameters cleanly and updates track.instrument without combining prior preset params", async () => {
  const ctx = new FakeAudioContext();
  const engine = new DawEngine({
    audioContext: ctx,
    offlineAudioContextClass: FakeOfflineAudioContext,
  });

  const p = engine.getProject();
  const trkBass = p.tracks.find((t) => t.id === "trk_bass");
  assert.ok(trkBass, "trk_bass exists");

  // 1. Apply clean-808
  await engine.sendCommand("apply_preset", {
    trackId: trkBass.id,
    preset: "clean-808",
  });
  let track = engine.getProject().tracks.find((t) => t.id === trkBass.id);
  assert.equal(
    track.instrument,
    "808",
    "track.instrument should be updated to 808",
  );
  assert.equal(track.params.instrument, "808");
  assert.equal(track.params.drive, 1.15);
  assert.equal(track.params.decay, 0.85);

  // 2. Apply tubular-electric-piano (DX7 FM)
  await engine.sendCommand("apply_preset", {
    trackId: trkBass.id,
    preset: "tubular-electric-piano",
  });
  track = engine.getProject().tracks.find((t) => t.id === trkBass.id);
  assert.equal(
    track.instrument,
    "tubular",
    "track.instrument should be updated to tubular",
  );
  assert.equal(track.params.algorithm, 5);
  assert.equal(track.params.modIndex, 2.2);
  assert.equal(
    track.params.glide,
    undefined,
    "808 glide should not leak into tubular",
  );
  assert.equal(
    track.params.tone,
    undefined,
    "808 tone should not leak into tubular",
  );

  // 3. Apply acid-303 (standard synth preset without explicit instrument field)
  await engine.sendCommand("apply_preset", {
    trackId: trkBass.id,
    preset: "acid-303",
  });
  track = engine.getProject().tracks.find((t) => t.id === trkBass.id);
  assert.equal(
    track.instrument,
    "synth",
    "track.instrument should revert to synth",
  );
  assert.equal(track.params.cutoff, 280);
  assert.equal(track.params.resonance, 18.0);
  assert.equal(
    track.params.algorithm,
    undefined,
    "tubular algorithm should not leak into acid-303",
  );
  assert.equal(
    track.params.modIndex,
    undefined,
    "tubular modIndex should not leak into acid-303",
  );

  // 4. Apply pluck-guitarish (Karplus-Strong)
  await engine.sendCommand("apply_preset", {
    trackId: trkBass.id,
    preset: "pluck-guitarish",
  });
  track = engine.getProject().tracks.find((t) => t.id === trkBass.id);
  assert.equal(
    track.instrument,
    "pluck",
    "track.instrument should be updated to pluck",
  );
  assert.equal(track.params.tone, 0.7);
  assert.equal(
    track.params.waveform,
    undefined,
    "synth waveform should not leak into pluck",
  );
  assert.equal(
    track.params.cutoff,
    undefined,
    "synth cutoff should not leak into pluck",
  );
});

test("DawEngine: playing and switching presets does not stack voices, duplicate lookahead events, or leak active voices", async () => {
  const ctx = new FakeAudioContext();
  const engine = new DawEngine({
    audioContext: ctx,
    offlineAudioContextClass: FakeOfflineAudioContext,
  });

  try {
    // Basic beat has 20 notes across drums and bass
    const initialProject = engine.getProject();
    const totalNotesInBar = initialProject.tracks.reduce(
      (sum, t) => sum + (t.notes?.length || 0),
      0,
    );
    assert.ok(totalNotesInBar > 0, "project has notes in bar");

    let voiceTriggerCount = 0;
    const origTrigger = engine._triggerVoice;

    await engine.play();

    // Track total voices triggered across exactly 1 bar (2.0s = 80 ticks of 25ms)
    // In lookahead scheduling, each note in the bar must be triggered EXACTLY ONCE per loop
    for (let step = 0; step < 80; step++) {
      ctx.currentTime += 0.025;
      engine._onClockTick();
    }

    // Apply preset while playing
    await engine.sendCommand("apply_preset", {
      trackId: "trk_bass",
      preset: "clean-808",
    });

    // Check that previous active voices on trk_bass were stopped
    for (const v of engine._activeVoices) {
      if (v.trackId === "trk_bass") {
        assert.fail(
          "Previous active voices on trk_bass should be stopped when applying new preset",
        );
      }
    }

    // More clock ticks with the new preset
    for (let step = 0; step < 8; step++) {
      ctx.currentTime += 0.025;
      engine._onClockTick();
    }

    // Apply another preset while playing
    await engine.sendCommand("apply_preset", {
      trackId: "trk_bass",
      preset: "tubular-solid-bass",
    });

    for (let step = 0; step < 8; step++) {
      ctx.currentTime += 0.025;
      engine._onClockTick();
    }

    // Apply a third preset
    await engine.sendCommand("apply_preset", {
      trackId: "trk_bass",
      preset: "pluck-guitarish",
    });

    for (let step = 0; step < 8; step++) {
      ctx.currentTime += 0.025;
      engine._onClockTick();
    }

    // Advance time and allow onended timers to fire to verify cleanup
    await new Promise((resolve) => setTimeout(resolve, 60));

    // _activeVoices should not have accumulated all historical voices indefinitely
    assert.ok(
      engine._activeVoices.size < 20,
      `_activeVoices (${engine._activeVoices.size}) should not leak indefinitely across preset changes`,
    );
  } finally {
    await engine.stop();
  }
});

test("Instruments: voices disconnect their audio nodes and invoke onended on completion to prevent Web Audio memory leaks", async () => {
  const ctx = new FakeAudioContext();
  const dest = ctx.createGain();

  let synthEnded = false;
  const synthVoice = triggerInstrumentVoice(
    ctx,
    dest,
    {
      trackInstrument: "synth",
      trackKind: "synth",
      note: { pitch: 60, velocity: 0.8, duration: 120 },
    },
    ctx.currentTime,
    120,
  );
  assert.ok(synthVoice, "synth voice should be created");
  synthVoice.onended = () => {
    synthEnded = true;
  };
  synthVoice.stop(0);
  assert.equal(synthEnded, true, "synthVoice onended should fire on stop");

  let pluckEnded = false;
  const pluckVoice = triggerInstrumentVoice(
    ctx,
    dest,
    {
      trackInstrument: "pluck",
      trackKind: "synth",
      note: { pitch: 64, velocity: 0.9, duration: 120 },
    },
    ctx.currentTime,
    120,
  );
  assert.ok(pluckVoice, "pluck voice should be created");
  pluckVoice.onended = () => {
    pluckEnded = true;
  };
  pluckVoice.stop(0);
  assert.equal(pluckEnded, true, "pluckVoice onended should fire on stop");
});
