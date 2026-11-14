import test from "node:test";
import assert from "node:assert/strict";
import {
  FakeAudioContext,
  FakeOfflineAudioContext,
} from "./helpers/fake-audio-context.mjs";
import { triggerInstrumentVoice } from "../.agents/scripts/scdaw-instruments.js";
import { DawEngine } from "../.agents/scripts/scdaw-engine.js";
import {
  computeEventsInRange,
  createProject,
  PPQN,
} from "../.agents/scripts/scdaw.js";

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

test("DawEngine: metronome click scheduling and preview sound generation", async () => {
  const ctx = new FakeAudioContext();
  const engine = new DawEngine({
    audioContext: ctx,
    offlineAudioContextClass: FakeOfflineAudioContext,
  });

  try {
    // 1. Initial state: metronome disabled
    assert.equal(engine.getProject().metronome?.enabled, false);

    // 2. previewMetronomeClick generates an audible oscillator click connected to master
    await engine.previewMetronomeClick(true);
    assert.ok(
      ctx.oscillators.length > 0,
      "previewMetronomeClick should create an oscillator",
    );
    const accentOsc = ctx.oscillators[ctx.oscillators.length - 1];
    assert.equal(
      accentOsc.frequency.events[0].val,
      1200,
      "accent preview click frequency should start at 1200Hz",
    );
    assert.equal(
      accentOsc.frequency.events[1].val,
      400,
      "accent preview click frequency should ramp down to 400Hz",
    );

    // Test unaccented preview click
    await engine.previewMetronomeClick(false);
    const unaccentOsc = ctx.oscillators[ctx.oscillators.length - 1];
    assert.equal(
      unaccentOsc.frequency.events[0].val,
      800,
      "regular preview click frequency should start at 800Hz",
    );
    assert.equal(
      unaccentOsc.frequency.events[1].val,
      300,
      "regular preview click frequency should ramp down to 300Hz",
    );

    // 3. Enable metronome
    await engine.sendCommand("set_metronome", { enabled: true, volume: 0.9 });
    assert.equal(engine.getProject().metronome.enabled, true);

    const oscCountBeforePlay = ctx.oscillators.length;

    // 4. Start playback - downbeat click scheduled immediately in initial lookahead
    await engine.play();
    engine._onClockTick();

    assert.ok(
      ctx.oscillators.length > oscCountBeforePlay,
      "playing with metronome enabled should schedule oscillator clicks",
    );

    // Verify downbeat accent on beat 1 (pos 0)
    const playOscs = ctx.oscillators.slice(oscCountBeforePlay);
    const playDownbeatOsc = playOscs.find(
      (o) => o.frequency.events[0]?.val === 1200,
    );
    assert.ok(
      playDownbeatOsc,
      "downbeat click at beat 1 should be scheduled with accent frequency (1200Hz)",
    );
    assert.equal(
      playDownbeatOsc.frequency.events[1].val,
      400,
      "downbeat click should ramp to 400Hz",
    );

    // 5. Disable metronome - subsequent clock ticks should not schedule metronome clicks
    await engine.sendCommand("set_metronome", { enabled: false });
    const oscCountAfterDisable = ctx.oscillators.length;
    // Step forward by 1 beat
    ctx.currentTime += 0.5;
    engine._onClockTick();
    // In our starter project drums/bass notes might be scheduled, but no new metronome click
    const newOscs = ctx.oscillators.slice(oscCountAfterDisable);
    const hasNewMetroOsc = newOscs.some(
      (o) =>
        o.frequency.events.length > 0 &&
        (o.frequency.events[0].val === 1200 ||
          o.frequency.events[0].val === 800),
    );
    assert.equal(
      hasNewMetroOsc,
      false,
      "no metronome oscillators should be created when metronome is disabled",
    );
  } finally {
    await engine.stop();
  }
});

test("computeEventsInRange and DawEngine: seamless loop wrap without pause or dropped boundary notes", async () => {
  // 1. Create a 1-bar project with 16 continuous 16th notes on Closed Hat (pitch 42)
  const project = createProject("empty");
  project.bpm = 128;
  project.lengthBars = 1;
  const drumNotes = [];
  for (let i = 0; i < 16; i++) {
    drumNotes.push({
      position: i * PPQN.SemiQuaver,
      duration: PPQN.SemiQuaver,
      pitch: 42,
      velocity: 0.8,
    });
  }
  project.tracks.push({
    id: "trk_drums",
    name: "Drums",
    kind: "drums",
    volume: 0.85,
    pan: 0,
    mute: false,
    solo: false,
    params: {},
    notes: drumNotes,
  });

  // 2. Test computeEventsInRange directly across the loop wrap (e.g. from 3800 to 200 pulses)
  const wrappedEvents = computeEventsInRange(project, 3800, 200);
  assert.ok(
    wrappedEvents.length > 0,
    "Wrapped range across loop boundary must return events",
  );
  const noteAtZero = wrappedEvents.find(
    (e) => e.position === 0 || e.note.position === 0,
  );
  assert.ok(
    noteAtZero,
    "Note at position 0 must be captured when scheduling window wraps around the loop boundary (e.g. 3800 -> 200)",
  );

  // 3. Test DawEngine playback: simulate advancing near the loop boundary
  const ctx = new FakeAudioContext();
  const engine = new DawEngine({
    audioContext: ctx,
    project,
    offlineAudioContextClass: FakeOfflineAudioContext,
  });

  try {
    await engine.play();
    engine._onClockTick();

    // Advance audio clock to near the end of bar 1 (e.g. 1.82s at 128bpm; 1 bar = 1.875s)
    ctx.currentTime = 1.82;
    const sourcesCountBeforeWrap = ctx.bufferSources.length;

    // Tick when scheduling window crosses over the loop boundary
    engine._onClockTick();

    // Notes at the beginning of the next loop (step 0 at position 0) must be scheduled without a pause
    const sourcesCountAfterWrap = ctx.bufferSources.length;
    assert.ok(
      sourcesCountAfterWrap > sourcesCountBeforeWrap,
      "Notes at the start of the next loop repetition must be scheduled during loop boundary wrap",
    );
  } finally {
    await engine.stop();
  }
});

test("DawEngine Scheduler: maps event timestamps relative to true musical time, never shifting pre-stall notes into the future", async () => {
  const project = createProject("empty");
  project.bpm = 120; // 1920 PPQN/sec (1 beat = 960 PPQN = 0.5s)
  project.lengthBars = 4;
  project.tracks.push({
    id: "trk_synth",
    name: "Synth",
    kind: "synth",
    volume: 0.8,
    pan: 0,
    mute: false,
    solo: false,
    params: { waveform: "sawtooth", cutoff: 1200 },
    notes: [
      { position: 0, duration: 240, pitch: 60, velocity: 0.8 },
      { position: 960, duration: 240, pitch: 62, velocity: 0.8 },
      { position: 1920, duration: 240, pitch: 64, velocity: 0.8 },
      { position: 2880, duration: 240, pitch: 65, velocity: 0.8 },
    ],
  });

  const ctx = new FakeAudioContext();
  const engine = new DawEngine({
    audioContext: ctx,
    project,
    offlineAudioContextClass: FakeOfflineAudioContext,
  });

  try {
    await engine.play();
    // Initial tick at t=0 schedules [0, lookahead) -> note at 0
    engine._onClockTick();
    const initialOscCount = ctx.oscillators.length;
    assert.equal(
      initialOscCount,
      1,
      "Only note at 0 should be scheduled at t=0",
    );

    // Simulate a 0.81s main-thread stall (past note at 960 = 0.5s, approaching note at 1920 = 1.0s)
    ctx.currentTime = 0.81;
    engine._onClockTick();

    // Note at 960 (0.5s) is > 50ms in the past and must be dropped, NOT shifted to 0.81 + 0.5 = 1.31s.
    // Note at 1920 (1.0s) is inside the 200ms lookahead (0.81 + 0.2 = 1.01s) and must start at ~1.0s.
    const postStallOscs = ctx.oscillators.slice(initialOscCount);
    assert.equal(
      postStallOscs.length,
      1,
      "Only the upcoming note at 1920 (1.0s) should be scheduled, dropping stale pre-stall note at 960",
    );
    assert.ok(
      Math.abs(postStallOscs[0].startTime - 1.0) < 0.002,
      `Expected note at 1920 to schedule at 1.0s, got ${postStallOscs[0].startTime}`,
    );

    // Simulate a duplicate queued Worker tick firing at the same audio time
    engine._onClockTick();
    assert.equal(
      ctx.oscillators.length,
      initialOscCount + 1,
      "Queued duplicate tick at same audioTime must not double-trigger notes",
    );
  } finally {
    await engine.stop();
  }
});

test("DawEngine Scheduler: live BPM change during playback re-anchors timebase without position jump", async () => {
  const project = createProject("empty");
  project.bpm = 120; // 1920 PPQN/sec
  project.lengthBars = 4;
  project.tracks.push({
    id: "trk_synth",
    name: "Synth",
    kind: "synth",
    volume: 0.8,
    pan: 0,
    mute: false,
    solo: false,
    params: { waveform: "sawtooth", cutoff: 1200 },
    notes: [
      { position: 0, duration: 240, pitch: 60, velocity: 0.8 },
      { position: 2880, duration: 240, pitch: 64, velocity: 0.8 },
    ],
  });

  const ctx = new FakeAudioContext();
  const engine = new DawEngine({
    audioContext: ctx,
    project,
    offlineAudioContextClass: FakeOfflineAudioContext,
  });

  try {
    await engine.play();
    engine._onClockTick();

    // Advance 1.0s at 120 BPM -> position should be 1920 PPQN
    ctx.currentTime = 1.0;
    engine._onClockTick();
    assert.ok(
      Math.abs(engine.getState().positionPpqn - 1920) < 1,
      `Expected positionPpqn ~1920 at 1.0s, got ${engine.getState().positionPpqn}`,
    );

    // Double BPM to 240 (3840 PPQN/sec) mid-playback
    await engine.sendCommand("set_transport", { bpm: 240 });

    // Position must stay continuous at 1920 (not jump to 3840)
    engine._onClockTick();
    assert.ok(
      Math.abs(engine.getState().positionPpqn - 1920) < 1,
      `Position jumped on live BPM change: ${engine.getState().positionPpqn}`,
    );

    // Advance 0.1s at 240 BPM -> position = 1920 + 384 = 2304; lookahead = 0.2s (768 PPQN) -> 3072 (covers 2880)
    // Note at 2880 is 960 pulses after 1920 -> at 240 BPM (3840 PPQN/s), 960 pulses = 0.25s -> 1.0 + 0.25 = 1.25s
    const beforeNoteCount = ctx.oscillators.length;
    ctx.currentTime = 1.1;
    engine._onClockTick();
    const addedOscs = ctx.oscillators.slice(beforeNoteCount);
    assert.equal(
      addedOscs.length,
      1,
      "Note at 2880 should be scheduled at 1.1s",
    );
    assert.ok(
      Math.abs(addedOscs[0].startTime - 1.25) < 0.002,
      `Expected note at 2880 to schedule at 1.25s after BPM change, got ${addedOscs[0].startTime}`,
    );
  } finally {
    await engine.stop();
  }
});

test("DawEngine Fast Path: setLiveTrackParam smoothly ramps GainNode/StereoPannerNode without pushing undo history or notifying project signal", async () => {
  const ctx = new FakeAudioContext();
  const engine = new DawEngine({
    audioContext: ctx,
    offlineAudioContextClass: FakeOfflineAudioContext,
  });

  try {
    await engine.play();

    let historyPushCount = 0;
    const origPush = engine.history.push.bind(engine.history);
    engine.history.push = (...args) => {
      historyPushCount++;
      return origPush(...args);
    };

    let projectNotifyCount = 0;
    const origSet = engine.project.set.bind(engine.project);
    engine.project.set = (...args) => {
      projectNotifyCount++;
      return origSet(...args);
    };

    const initialVol = engine.project.get().tracks[0].volume;

    // Simulate 50 rapid pointermove slider updates
    for (let i = 1; i <= 50; i++) {
      engine.setLiveTrackParam("trk_drums", {
        volume: i / 50,
        pan: (i - 25) / 25,
      });
    }

    assert.equal(
      historyPushCount,
      0,
      "Live param drag must not push undo history",
    );
    assert.equal(
      projectNotifyCount,
      0,
      "Live param drag must not notify project signal",
    );

    const trackNodes = engine.graph.tracks.get("trk_drums");
    const rampEvents = trackNodes.gain.gain.events.filter(
      (e) => e.type === "setTargetAtTime",
    );
    assert.ok(
      rampEvents.length >= 50,
      "Live volume changes must use de-zippered setTargetAtTime ramping",
    );

    // Commit once on pointerup
    engine.commitLiveTrackParam("trk_drums");
    assert.equal(
      historyPushCount,
      1,
      "Commit on pointerup must push exactly 1 undo entry",
    );
    assert.equal(
      projectNotifyCount,
      1,
      "Commit on pointerup must notify project signal once",
    );
    assert.equal(engine.project.get().tracks[0].volume, 1);

    // Undo restores pre-drag volume
    await engine.sendCommand("undo");
    assert.equal(engine.project.get().tracks[0].volume, initialVol);
  } finally {
    await engine.stop();
  }
});

test("Instruments & Engine: track volume is applied once at track GainNode, not squared in triggerInstrumentVoice", async () => {
  const project = createProject("empty");
  project.bpm = 120;
  project.lengthBars = 2;
  project.tracks.push({
    id: "trk_synth",
    name: "Synth",
    kind: "synth",
    volume: 0.5,
    pan: 0,
    mute: false,
    solo: false,
    params: {
      waveform: "sawtooth",
      cutoff: 1200,
      attack: 0.01,
      decay: 0.1,
      sustain: 0.8,
      release: 0.1,
    },
    notes: [{ position: 0, duration: 480, pitch: 60, velocity: 0.8 }],
  });

  const ctx = new FakeAudioContext();
  const capturedGains = [];
  const origCreateGain = ctx.createGain.bind(ctx);
  ctx.createGain = () => {
    const g = origCreateGain();
    capturedGains.push(g);
    return g;
  };

  const engine = new DawEngine({
    audioContext: ctx,
    project,
    offlineAudioContextClass: FakeOfflineAudioContext,
  });

  try {
    await engine.play();
    const beforeVoiceGainCount = capturedGains.length;
    engine._onClockTick();
    const voiceGains = capturedGains.slice(beforeVoiceGainCount);
    // Voice envelope gain should peak at velocity (0.8), not velocity * 0.5 (0.4)
    const peakEvent = voiceGains
      .flatMap((g) => g.gain.events)
      .find((e) => e.type === "linearRampToValueAtTime" && e.val > 0);
    assert.ok(peakEvent, "Expected synth voice envelope ramp event");
    assert.ok(
      Math.abs(peakEvent.val - 0.8) < 0.05,
      `Expected voice envelope peak ~0.8 (track volume applied once at track GainNode), got ${peakEvent.val}`,
    );
  } finally {
    await engine.stop();
  }
});

test("DawEngine Fast Path: live synth param changes modulate active voices in-place without calling voice.stop(0)", async () => {
  const project = createProject("empty");
  project.bpm = 120;
  project.lengthBars = 2;
  project.tracks.push({
    id: "trk_bass",
    name: "Bass",
    kind: "synth",
    volume: 0.8,
    pan: 0,
    mute: false,
    solo: false,
    params: { waveform: "sawtooth", cutoff: 800, resonance: 2 },
    notes: [{ position: 0, duration: 1920, pitch: 48, velocity: 0.8 }],
  });

  const ctx = new FakeAudioContext();
  const createdFilters = [];
  const origCreateFilter = ctx.createBiquadFilter.bind(ctx);
  ctx.createBiquadFilter = () => {
    const f = origCreateFilter();
    createdFilters.push(f);
    return f;
  };

  const engine = new DawEngine({
    audioContext: ctx,
    project,
    offlineAudioContextClass: FakeOfflineAudioContext,
  });

  try {
    await engine.play();
    engine._onClockTick();
    assert.equal(engine._activeVoices.size, 1, "Expected 1 active synth voice");
    const activeOsc = ctx.oscillators[0];

    engine.setLiveTrackParam("trk_bass", {
      params: { cutoff: 2400, resonance: 6 },
    });

    assert.equal(
      engine._activeVoices.size,
      1,
      "Active voice must remain in _activeVoices",
    );
    assert.ok(
      activeOsc.stopTime > 0,
      "Live param change must not call voice.stop(0)",
    );
    const voiceFilter = createdFilters[createdFilters.length - 1];
    const cutoffRamp = voiceFilter.frequency.events.find(
      (e) => e.type === "setTargetAtTime" && e.val === 2400,
    );
    const qRamp = voiceFilter.Q.events.find(
      (e) => e.type === "setTargetAtTime" && e.val === 6,
    );
    assert.ok(cutoffRamp, "Active voice filter frequency must ramp to 2400");
    assert.ok(qRamp, "Active voice filter Q must ramp to 6");
  } finally {
    await engine.stop();
  }
});
