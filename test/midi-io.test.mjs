import test from "node:test";
import assert from "node:assert/strict";
import { FakeAudioContext } from "./helpers/fake-audio-context.mjs";
import { FakeMIDIPort, FakeMIDIAccess } from "./helpers/fake-midi-access.mjs";
import { createProject, applyCommand } from "../.agents/scripts/scdaw.js";
import { DawEngine } from "../.agents/scripts/scdaw-engine.js";
import {
  createMidiIo,
  SoftwareMidiInput,
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
