import test from "node:test";
import assert from "node:assert/strict";
import { FakeAudioContext } from "./helpers/fake-audio-context.mjs";
import { FakeMIDIPort, FakeMIDIAccess } from "./helpers/fake-midi-access.mjs";
import { createProject, applyCommand } from "../.agents/scripts/scdaw.js";
import { DawEngine } from "../.agents/scripts/scdaw-engine.js";
import {
  createMidiIo,
  SoftwareMidiInput,
  QWERTY_LAYOUTS,
  getQwertyKeyMapForLayout,
  shouldHandleSoftwareKeyboardEvent,
} from "../.agents/scripts/scdaw-midi-io.js";

function createTestSetup() {
  const fakeCtx = new FakeAudioContext();
  const p0 = createProject("empty");
  const addRes = applyCommand(p0, "add_track", {
    kind: "synth",
    name: "Lead",
  });
  const engine = new DawEngine({
    audioContext: fakeCtx,
    project: addRes.project,
  });
  return { engine, trackId: addRes.result.trackId };
}

test("createMidiIo: gracefully degrades when requestMIDIAccess is unavailable", async () => {
  const { engine, trackId } = createTestSetup();
  const midi = createMidiIo(engine, { navigatorObj: {} });

  const status = await midi.init();
  assert.equal(status, "unsupported");
  assert.equal(midi.state.get().status, "unsupported");
  assert.equal(midi.state.get().supported, false);

  // SoftwareMidiInput still works even when Web MIDI is unsupported
  midi.software.noteOn(60, 0.8);
  assert.equal(engine._liveVoices.has(`${trackId}:60`), true);
  midi.software.noteOff(60);
  assert.equal(engine._liveVoices.has(`${trackId}:60`), false);
});

test("createMidiIo: gracefully degrades when requestMIDIAccess is denied", async () => {
  const { engine } = createTestSetup();
  const midi = createMidiIo(engine, {
    navigatorObj: {
      requestMIDIAccess: async () => {
        throw new Error("Permission denied");
      },
    },
  });

  const status = await midi.init();
  assert.equal(status, "denied");
  assert.equal(midi.state.get().status, "denied");
  assert.equal(midi.state.get().supported, false);
});

test("createMidiIo: enumerates ports, routes incoming notes, and handles hot-unplug", async () => {
  const { engine, trackId } = createTestSetup();
  const inPort = new FakeMIDIPort({
    id: "in-1",
    name: "Keystep 37",
    type: "input",
  });
  const outPort = new FakeMIDIPort({
    id: "out-1",
    name: "Prophet Rev2",
    type: "output",
  });
  const access = new FakeMIDIAccess({
    inputs: [inPort],
    outputs: [outPort],
  });

  const midi = createMidiIo(engine, {
    navigatorObj: {
      requestMIDIAccess: async () => access,
    },
  });

  const status = await midi.init();
  assert.equal(status, "ready");
  assert.equal(midi.state.get().inputs.length, 1);
  assert.equal(midi.state.get().outputs.length, 1);

  // Incoming NoteOn -> liveNoteOn
  inPort.emitMessage([0x90, 60, 100]);
  assert.equal(engine._liveVoices.has(`${trackId}:60`), true);

  // Hot-unplug while note 60 is held -> releases held note and removes port
  access.disconnectPort("in-1");
  assert.equal(midi.state.get().inputs.length, 0);
  assert.equal(engine._liveVoices.has(`${trackId}:60`), false);

  // Reconnect port
  access.connectPort(inPort);
  assert.equal(midi.state.get().inputs.length, 1);
});

test("createMidiIo: MIDI Learn captures CC and drives live track param", async () => {
  const { engine, trackId } = createTestSetup();
  const inPort = new FakeMIDIPort({ id: "in-1", name: "Knobs", type: "input" });
  const access = new FakeMIDIAccess({ inputs: [inPort] });

  const midi = createMidiIo(engine, {
    navigatorObj: { requestMIDIAccess: async () => access },
  });
  await midi.init();

  midi.startMidiLearn({
    trackId,
    param: "cutoff",
    min: 100,
    max: 10000,
    scaling: "linear",
  });
  assert.equal(midi.state.get().learning.active, true);

  // Send CC 74 on channel 0, value 64
  inPort.emitMessage([0xb0, 74, 64]);
  // Give async sendCommand a microtask tick
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(midi.state.get().learning.active, false);
  const p = engine.project.get();
  assert.equal(p.midiMappings.length, 1);
  assert.equal(p.midiMappings[0].cc, 74);

  // Subsequent CC 74 value 127 should update track.params.cutoff to max (10000)
  inPort.emitMessage([0xb0, 74, 127]);
  const updatedTrack = engine.project
    .get()
    .tracks.find((t) => t.id === trackId);
  assert.ok(Math.abs(updatedTrack.params.cutoff - 10000) < 1);
});

test("createMidiIo: sends MIDI output when track midiOutput is enabled", async () => {
  const { engine, trackId } = createTestSetup();
  const outPort = new FakeMIDIPort({
    id: "out-1",
    name: "Ext Synth",
    type: "output",
  });
  const access = new FakeMIDIAccess({ outputs: [outPort] });

  const midi = createMidiIo(engine, {
    navigatorObj: { requestMIDIAccess: async () => access },
  });
  await midi.init();

  await engine.sendCommand("set_track_midi_routing", {
    trackId,
    midiOutput: { deviceId: "out-1", channel: 2, enabled: true },
  });

  midi.sendNoteOn(trackId, 64, 0.8);
  midi.sendNoteOff(trackId, 64);

  assert.equal(outPort.sentMessages.length, 2);
  assert.equal(outPort.sentMessages[0].data[0], 0x91); // NoteOn ch 2 (0-indexed 1)
  assert.equal(outPort.sentMessages[0].data[1], 64);
  assert.equal(outPort.sentMessages[1].data[0], 0x81); // NoteOff ch 2
  assert.equal(outPort.sentMessages[1].data[1], 64);
});

test("SoftwareMidiInput: QWERTY key mapping with octave shift and repeat guard", () => {
  const { engine, trackId } = createTestSetup();
  const sw = new SoftwareMidiInput(engine);

  // 'a' -> C in octave 4 = 60
  const pitch1 = sw.keyDown("a");
  assert.equal(pitch1, 60);
  assert.equal(engine._liveVoices.has(`${trackId}:60`), true);

  // Key repeat should not retrigger
  assert.equal(sw.keyDown("a", { repeat: true }), null);

  sw.keyUp("a");
  assert.equal(engine._liveVoices.has(`${trackId}:60`), false);

  // Shift octave up -> 'a' = 72
  sw.setOctave(5);
  assert.equal(sw.keyDown("a"), 72);
  sw.releaseAll();
  assert.equal(engine._liveVoices.has(`${trackId}:72`), false);
});

test("MidiIoManager: Gap 2 & 3 - mute/solo/recordArm toggle cleanly on press (127), ignore release (0), deduplicate twin ports, and support momentary mode + port disable", async () => {
  const { engine, trackId } = createTestSetup();
  const masterPort = new FakeMIDIPort({
    id: "smc-master",
    name: "SINCO SMC-Mixer-Master",
    type: "input",
  });
  const privatePort = new FakeMIDIPort({
    id: "smc-private",
    name: "SINCO SMC-Mixer-Private",
    type: "input",
  });
  const access = new FakeMIDIAccess({ inputs: [masterPort, privatePort] });
  const midi = createMidiIo(engine, {
    navigatorObj: { requestMIDIAccess: async () => access },
    crossPortDedupWindowMs: 80,
  });
  await midi.init();

  await engine.sendCommand("set_midi_learn_mapping", {
    cc: 70,
    channel: "omni",
    trackId,
    param: "mute",
  });
  await engine.sendCommand("set_midi_learn_mapping", {
    cc: 78,
    channel: "omni",
    trackId,
    param: "solo",
  });
  await engine.sendCommand("set_midi_learn_mapping", {
    cc: 85,
    channel: "omni",
    trackId,
    param: "recordArm",
    mode: "momentary",
  });

  // Press Mute (127) arriving simultaneously on twin ports -> latches ONCE to true
  masterPort.emitMessage([0xb0, 70, 127]);
  privatePort.emitMessage([0xb0, 70, 127]);
  let trk = engine.project.get().tracks.find((t) => t.id === trackId);
  assert.equal(trk.mute, true);
  assert.equal(trk.params?.mute, undefined);

  // Release Mute (0) arriving on both twin ports -> ignored in toggle mode
  masterPort.emitMessage([0xb0, 70, 0]);
  privatePort.emitMessage([0xb0, 70, 0]);
  trk = engine.project.get().tracks.find((t) => t.id === trackId);
  assert.equal(trk.mute, true);

  // Press Solo (127) -> latches to true, release (0) ignored
  masterPort.emitMessage([0xb0, 78, 127]);
  privatePort.emitMessage([0xb0, 78, 127]);
  masterPort.emitMessage([0xb0, 78, 0]);
  trk = engine.project.get().tracks.find((t) => t.id === trackId);
  assert.equal(trk.solo, true);
  assert.equal(trk.params?.solo, undefined);

  // Momentary recordArm: 127 -> armed true, 0 -> armed false
  masterPort.emitMessage([0xb0, 85, 127]);
  trk = engine.project.get().tracks.find((t) => t.id === trackId);
  assert.equal(trk.recordArm, true);
  masterPort.emitMessage([0xb0, 85, 0]);
  trk = engine.project.get().tracks.find((t) => t.id === trackId);
  assert.equal(trk.recordArm, false);

  // Disabling a port ignores incoming messages from that port
  midi.setInputPortEnabled("smc-private", false);
  assert.equal(
    midi.state.get().inputs.find((p) => p.id === "smc-private").enabled,
    false,
  );
  privatePort.emitMessage([0xb0, 85, 127]);
  trk = engine.project.get().tracks.find((t) => t.id === trackId);
  assert.equal(trk.recordArm, false);
});

test("MidiIoManager: Gap 4, 5, 6, 7 - liveRevision updates during sweeps without undo flooding, track volume reaches 1.5, master & transport targets work, and soft takeover / monitor work", async () => {
  const { engine, trackId } = createTestSetup();
  try {
    const inPort = new FakeMIDIPort({
      id: "smc-in",
      name: "SMC-Mixer",
      type: "input",
    });
    const access = new FakeMIDIAccess({ inputs: [inPort] });
    const midi = createMidiIo(engine, {
      navigatorObj: { requestMIDIAccess: async () => access },
    });
    await midi.init();

    // Learn track volume without explicit max -> defaults to 0..1.5 (Gap 7)
    midi.startMidiLearn({ trackId, param: "volume" });
    inPort.emitMessage([0xb0, 40, 64]);
    await new Promise((r) => setTimeout(r, 10));
    const volMap = engine.project.get().midiMappings.find((m) => m.cc === 40);
    assert.equal(volMap.max, 1.5);

    // Add master & transport mappings (Gaps 5 & 6)
    await engine.sendCommand("set_midi_learn_mapping", {
      cc: 47,
      channel: "omni",
      trackId: "master",
      param: "volume",
    });
    await engine.sendCommand("set_midi_learn_mapping", {
      cc: 102,
      channel: "omni",
      trackId: "transport",
      param: "play",
    });
    await engine.sendCommand("set_midi_learn_mapping", {
      cc: 103,
      channel: "omni",
      trackId: "transport",
      param: "stop",
    });

    // Track undo history pushes during rapid continuous CC sweep (Gap 4)
    let historyPushes = 0;
    const origPush = engine.history.push.bind(engine.history);
    engine.history.push = (...args) => {
      historyPushes++;
      return origPush(...args);
    };
    const revBefore = engine.liveRevision.get();

    inPort.emitMessage([0xb0, 40, 64]);
    inPort.emitMessage([0xb0, 40, 96]);
    inPort.emitMessage([0xb0, 40, 127]);

    assert.ok(
      engine.liveRevision.get() >= revBefore + 3,
      "liveRevision must increment on each live CC update for smooth UI redraw",
    );
    assert.equal(
      historyPushes,
      0,
      "Continuous CC sweep must not flood undo history before commit debounce",
    );
    assert.equal(
      engine.project.get().tracks.find((t) => t.id === trackId).volume,
      1.5,
    );

    // Master volume fader (CC 47 = 127 -> master.volume = 1.0)
    inPort.emitMessage([0xb0, 47, 127]);
    assert.equal(engine.project.get().master.volume, 1);

    // Live MIDI monitor captures latest message details
    const mon = midi.state.get().lastMessage;
    assert.equal(mon.portName, "SMC-Mixer");
    assert.equal(mon.controller, 47);
    assert.equal(mon.value, 127);

    // Wait for 150ms commit debounce -> commits cleanly
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(
      historyPushes >= 1 && historyPushes <= 2,
      `Expected debounced commit to push minimal history entries, got ${historyPushes}`,
    );

    // Soft takeover: set volume to 0.75 (mid), send CC 40 = 0 (mismatch) -> ignored until crossed
    engine.setLiveTrackParam(trackId, { volume: 0.75 });
    midi.setSoftTakeover(true);
    inPort.emitMessage([0xb0, 40, 10]); // ~0.118, well below 0.75 -> ignored
    assert.equal(
      engine.project.get().tracks.find((t) => t.id === trackId).volume,
      0.75,
    );
    inPort.emitMessage([0xb0, 40, 90]); // ~1.06, crosses 0.75 -> engages!
    assert.ok(
      engine.project.get().tracks.find((t) => t.id === trackId).volume > 1.0,
    );

    // Transport Play / Stop (Gap 6)
    inPort.emitMessage([0xb0, 102, 127]);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(engine.state.get().playing, true);
    inPort.emitMessage([0xb0, 102, 0]); // release ignored
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(engine.state.get().playing, true);
    inPort.emitMessage([0xb0, 103, 127]);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(engine.state.get().playing, false);
  } finally {
    await engine.stop();
  }
});

test("QWERTY_LAYOUTS & getQwertyKeyMapForLayout: defines ableton (18 notes) and two-octave (24 notes) layouts", () => {
  assert.equal(QWERTY_LAYOUTS.ableton.notes.length, 18);
  assert.equal(QWERTY_LAYOUTS["two-octave"].notes.length, 24);
  assert.deepEqual(
    QWERTY_LAYOUTS["two-octave"].notes.map((n) => n.offset),
    Array.from({ length: 24 }, (_, i) => i),
  );

  const abletonMap = getQwertyKeyMapForLayout("ableton");
  assert.equal(abletonMap.get(0), "A");
  assert.equal(abletonMap.get(16), ";");
  assert.equal(abletonMap.get(17), "'");
  assert.equal(abletonMap.get(18), undefined);

  const twoOctMap = getQwertyKeyMapForLayout("two-octave");
  assert.equal(twoOctMap.get(0), "Z");
  assert.equal(twoOctMap.get(1), "S");
  assert.equal(twoOctMap.get(11), "M");
  assert.equal(twoOctMap.get(12), "Q");
  assert.equal(twoOctMap.get(13), "2");
  assert.equal(twoOctMap.get(23), "U");
});

test("SoftwareMidiInput: e.code-first resolution, Shift-safe keyUp, setOctave(0), layout switching, octave delta, and selective releaseHeldKeys", () => {
  const { engine, trackId } = createTestSetup();
  const sw = new SoftwareMidiInput(engine);

  // Shift-safe release on Semicolon in default ableton layout
  const semiPitch = sw.keyDown(";", { code: "Semicolon" });
  assert.equal(semiPitch, 76); // E5
  assert.equal(engine._liveVoices.has(`${trackId}:76`), true);
  sw.keyUp(":", { code: "Semicolon" });
  assert.equal(engine._liveVoices.has(`${trackId}:76`), false);

  // setOctave(0) must actually set octave 0 (not fall back to 4) and clamp to 0..7
  assert.equal(sw.setOctave(0), 0);
  assert.equal(sw.octave, 0);
  assert.equal(sw.state.get().octave, 0);
  assert.equal(sw.setOctave(99), 7);
  assert.equal(sw.setOctave(-3), 0);
  assert.equal(sw.setOctave(4), 4);

  // resolveOctaveDelta in ableton layout
  assert.equal(sw.resolveOctaveDelta("z", { code: "KeyZ" }), -1);
  assert.equal(sw.resolveOctaveDelta("-", { code: "Minus" }), -1);
  assert.equal(sw.resolveOctaveDelta("x", { code: "KeyX" }), 1);
  assert.equal(sw.resolveOctaveDelta("=", { code: "Equal" }), 1);
  assert.equal(sw.resolveOctaveDelta("a", { code: "KeyA" }), 0);

  // Hold a note before switching layout -> released automatically on setKeyLayout
  assert.equal(sw.keyDown("a", { code: "KeyA" }), 60);
  assert.equal(engine._liveVoices.has(`${trackId}:60`), true);
  assert.equal(sw.setKeyLayout("two-octave"), "two-octave");
  assert.equal(sw.keyLayout, "two-octave");
  assert.equal(sw.state.get().keyLayout, "two-octave");
  assert.equal(engine._liveVoices.has(`${trackId}:60`), false);

  // two-octave note mappings and Shift-safe Digit2 release
  assert.equal(sw.keyDown("z", { code: "KeyZ" }), 60);
  assert.equal(sw.keyDown("q", { code: "KeyQ" }), 72);
  assert.equal(sw.keyDown("u", { code: "KeyU" }), 83);
  assert.equal(sw.keyDown("2", { code: "Digit2" }), 73);
  assert.equal(engine._liveVoices.has(`${trackId}:73`), true);
  sw.keyUp("@", { code: "Digit2" });
  assert.equal(engine._liveVoices.has(`${trackId}:73`), false);

  // In two-octave layout, Z/X are notes (delta 0) while Minus/BracketLeft and Equal/BracketRight shift octaves
  assert.equal(sw.resolveOctaveDelta("z", { code: "KeyZ" }), 0);
  assert.equal(sw.resolveOctaveDelta("x", { code: "KeyX" }), 0);
  assert.equal(sw.resolveOctaveDelta("-", { code: "Minus" }), -1);
  assert.equal(sw.resolveOctaveDelta("[", { code: "BracketLeft" }), -1);
  assert.equal(sw.resolveOctaveDelta("=", { code: "Equal" }), 1);
  assert.equal(sw.resolveOctaveDelta("]", { code: "BracketRight" }), 1);

  // releaseHeldKeys({ shouldReleasePitch }) preserves latched pitches while clearing _heldKeys
  sw.releaseHeldKeys({ shouldReleasePitch: (pitch) => pitch !== 72 });
  assert.equal(engine._liveVoices.has(`${trackId}:60`), false);
  assert.equal(engine._liveVoices.has(`${trackId}:83`), false);
  assert.equal(engine._liveVoices.has(`${trackId}:72`), true);
  assert.equal(sw._heldKeys.size, 0);

  sw.noteOff(72);
  assert.equal(engine._liveVoices.has(`${trackId}:72`), false);
});

test("shouldHandleSoftwareKeyboardEvent: filters modifiers, editable targets, IME, and dialogs", () => {
  const mkNode = (tagName, extra = {}) => ({ tagName, ...extra });
  const okEvent = (overrides = {}) => ({
    defaultPrevented: false,
    isComposing: false,
    keyCode: 65,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: mkNode("BUTTON"),
    composedPath: () => [mkNode("BUTTON"), mkNode("DIV")],
    ...overrides,
  });

  assert.equal(shouldHandleSoftwareKeyboardEvent(okEvent()), true);
  assert.equal(shouldHandleSoftwareKeyboardEvent(null), false);
  assert.equal(
    shouldHandleSoftwareKeyboardEvent(okEvent({ ctrlKey: true })),
    false,
  );
  assert.equal(
    shouldHandleSoftwareKeyboardEvent(okEvent({ metaKey: true })),
    false,
  );
  assert.equal(
    shouldHandleSoftwareKeyboardEvent(okEvent({ altKey: true })),
    false,
  );
  assert.equal(
    shouldHandleSoftwareKeyboardEvent(okEvent({ defaultPrevented: true })),
    false,
  );
  assert.equal(
    shouldHandleSoftwareKeyboardEvent(okEvent({ isComposing: true })),
    false,
  );
  assert.equal(
    shouldHandleSoftwareKeyboardEvent(okEvent({ keyCode: 229 })),
    false,
  );

  for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) {
    assert.equal(
      shouldHandleSoftwareKeyboardEvent(
        okEvent({ composedPath: () => [mkNode(tag)] }),
      ),
      false,
    );
  }

  assert.equal(
    shouldHandleSoftwareKeyboardEvent(
      okEvent({
        composedPath: () => [
          mkNode("SPAN"),
          mkNode("DIV", { isContentEditable: true }),
        ],
      }),
    ),
    false,
  );
  assert.equal(
    shouldHandleSoftwareKeyboardEvent(
      okEvent({
        composedPath: () => [
          mkNode("DIV", {
            getAttribute: (name) =>
              name === "contenteditable" ? "plaintext-only" : null,
          }),
        ],
      }),
    ),
    false,
  );
  assert.equal(
    shouldHandleSoftwareKeyboardEvent(
      okEvent({
        composedPath: () => [mkNode("BUTTON"), mkNode("DIALOG")],
      }),
    ),
    false,
  );
});
