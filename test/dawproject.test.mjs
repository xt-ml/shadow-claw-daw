import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseXml,
  xmlElement,
  serializeXmlDocument,
  encodeDawProject,
  decodeDawProject,
} from "../.agents/scripts/scdaw-dawproject.js";
import { createProject } from "../.agents/scripts/scdaw.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = fs.existsSync(join(__dirname, "fixtures"))
  ? join(__dirname, "fixtures")
  : join(__dirname, "assets");

test("scdaw-dawproject: parseXml and serializeXmlDocument parse and format clean XML", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project version="1.0">
    <Application name="ShadowClaw DAW" version="1.0.0"/>
    <Transport>
        <Tempo value="130.000000" unit="bpm"/>
        <TimeSignature numerator="4" denominator="4"/>
    </Transport>
    <Structure>
        <Track id="trk_1" name="Drums">
            <Channel role="regular" solo="false">
                <Volume value="0.850000"/>
                <Pan value="0.500000"/>
            </Channel>
        </Track>
    </Structure>
</Project>`;

  const root = parseXml(xml);
  assert.equal(root.tag, "Project");
  assert.equal(root.attributes.version, "1.0");

  const app = root.children.find((c) => c.tag === "Application");
  assert.ok(app);
  assert.equal(app.attributes.name, "ShadowClaw DAW");

  const tempo = root.children
    .find((c) => c.tag === "Transport")
    ?.children.find((c) => c.tag === "Tempo");
  assert.ok(tempo);
  assert.equal(tempo.attributes.value, "130.000000");
  assert.equal(tempo.attributes.unit, "bpm");

  // Verify XML builder
  const built = serializeXmlDocument(
    xmlElement("MetaData", {}, [
      xmlElement("Title", {}, ["My Song"]),
      xmlElement("Artist", {}, ["ShadowClaw"]),
    ]),
  );
  assert.ok(built.includes("<MetaData>"));
  assert.ok(built.includes("<Title>My Song</Title>"));
  assert.ok(built.includes("<Artist>ShadowClaw</Artist>"));
});

test("scdaw-dawproject: decodeDawProject imports note-regions.dawproject fixture accurately", async () => {
  const fixturePath = join(FIXTURES_DIR, "note-regions.dawproject");
  const fileBuffer = fs.readFileSync(fixturePath);

  const project = await decodeDawProject(fileBuffer);
  assert.ok(project, "Must parse DAWproject into project object");
  assert.equal(project.bpm, 110);
  assert.deepEqual(project.signature, [4, 4]);

  // note-regions.dawproject has 3 note tracks (Inst 1, Inst 2, Inst 3) + FX track + Master
  assert.ok(
    project.tracks.length >= 3,
    `Expected at least 3 tracks, got ${project.tracks.length}`,
  );

  const inst1 = project.tracks.find((t) => t.name === "Inst 1");
  assert.ok(inst1, "Must contain Inst 1 track");
  assert.ok(inst1.notes.length > 0, "Inst 1 must contain parsed notes");

  // Check note properties
  const note0 = inst1.notes[0];
  assert.ok(
    note0.pitch >= 0 && note0.pitch <= 127,
    "Pitch must be in valid MIDI range",
  );
  assert.ok(note0.duration > 0, "Duration must be positive PPQN");
  assert.ok(note0.position >= 0, "Position must be non-negative PPQN");
});

test("scdaw-dawproject: decodeDawProject imports eq.dawproject fixture and detects equalizer device", async () => {
  const fixturePath = join(FIXTURES_DIR, "eq.dawproject");
  const fileBuffer = fs.readFileSync(fixturePath);

  const project = await decodeDawProject(fileBuffer);
  assert.ok(project);
  assert.equal(project.bpm, 110);

  const eqTrack = project.tracks.find((t) => t.name === "EQ+");
  assert.ok(eqTrack, "Must contain EQ+ track");
  assert.ok(Array.isArray(eqTrack.audioFx), "Track should have audioFx array");
  assert.ok(eqTrack.audioFx.length > 0, "Track should import equalizer device");

  const eqDevice = eqTrack.audioFx[0];
  assert.equal(eqDevice.type, "equalizer");
  assert.ok(Array.isArray(eqDevice.bands), "Equalizer should contain bands");
  assert.equal(eqDevice.bands.length, 6, "EQ+ fixture has 6 bands");
});

test("scdaw-dawproject: round-trip project -> encodeDawProject -> decodeDawProject preserves project structure and notes", async () => {
  const original = createProject({
    name: "DAWproject Interchange Test",
    bpm: 126,
    signature: [4, 4],
    tracks: [
      {
        id: "drums",
        name: "Drums",
        type: "drums",
        volume: 0.9,
        pan: 0,
        notes: [
          { position: 0, duration: 240, pitch: 36, velocity: 100 },
          { position: 960, duration: 240, pitch: 38, velocity: 90 },
          { position: 1920, duration: 240, pitch: 36, velocity: 95 },
        ],
      },
      {
        id: "synth",
        name: "Lead Synth",
        type: "synth",
        volume: 0.75,
        pan: -0.25,
        notes: [
          { position: 0, duration: 480, pitch: 60, velocity: 80 },
          { position: 480, duration: 480, pitch: 64, velocity: 85 },
        ],
      },
    ],
  });

  const zipBytes = encodeDawProject(original);
  assert.ok(zipBytes instanceof Uint8Array || zipBytes instanceof ArrayBuffer);

  const restored = await decodeDawProject(zipBytes);
  assert.equal(restored.bpm, 126);
  assert.deepEqual(restored.signature, [4, 4]);
  assert.equal(restored.tracks.length, 2);

  const drumTrack = restored.tracks.find((t) => t.name === "Drums");
  assert.ok(drumTrack);
  assert.equal(drumTrack.notes.length, 3);
  assert.equal(drumTrack.notes[0].pitch, 36);
  assert.equal(drumTrack.notes[0].position, 0);
  assert.equal(drumTrack.notes[0].duration, 240);

  const synthTrack = restored.tracks.find((t) => t.name === "Lead Synth");
  assert.ok(synthTrack);
  assert.equal(synthTrack.notes.length, 2);
  assert.equal(synthTrack.notes[0].pitch, 60);
  assert.equal(synthTrack.notes[0].duration, 480);
});

test("scdaw-dawproject: preserves device parameters and presets in presets/*.json", async () => {
  const original = createProject({
    name: "Deep Data Project",
    bpm: 132,
    tracks: [
      {
        id: "bass",
        name: "Acid Bass",
        type: "synth",
        volume: 0.8,
        pan: 0,
        params: {
          waveform: "sawtooth",
          cutoff: 950,
          resonance: 14.5,
          attack: 0.005,
          decay: 0.12,
          sustain: 0.1,
          release: 0.08,
        },
        notes: [{ position: 0, duration: 240, pitch: 36, velocity: 100 }],
      },
    ],
  });

  const zipBytes = encodeDawProject(original);
  const restored = await decodeDawProject(zipBytes);

  const bassTrack = restored.tracks.find((t) => t.name === "Acid Bass");
  assert.ok(bassTrack, "Must restore Acid Bass track");
  assert.ok(bassTrack.params, "Track must have restored params");
  assert.equal(bassTrack.params.waveform, "sawtooth");
  assert.equal(bassTrack.params.cutoff, 950);
  assert.equal(bassTrack.params.resonance, 14.5);
  assert.equal(bassTrack.params.attack, 0.005);
});

test("scdaw-dawproject: supports hybrid audio stems embedding in samples/*.wav", async () => {
  const original = createProject({
    name: "Hybrid Stems Project",
    bpm: 124,
    tracks: [
      {
        id: "drums",
        name: "Drums",
        type: "drums",
        notes: [{ position: 0, duration: 240, pitch: 36, velocity: 100 }],
      },
    ],
  });

  // Minimal fake WAV bytes
  const fakeWav = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
  ]);
  const zipBytes = encodeDawProject(original, {
    bouncedStems: {
      drums: fakeWav,
    },
  });

  // Extract ZIP and verify samples/drums.wav entry
  const { decodeZip } = await import("../.agents/scripts/scdaw-zip.js");
  const extracted = await decodeZip(zipBytes);
  const sampleEntry = extracted.find((e) => e.name === "samples/drums.wav");
  assert.ok(
    sampleEntry,
    "Must embed samples/drums.wav in .dawproject container",
  );
  assert.equal(sampleEntry.data.length, fakeWav.length);
});

test("scdaw-dawproject: encodes and decodes continuous parameter automation curves in Points lanes", async () => {
  const original = createProject({
    name: "Automation Test",
    bpm: 128,
    tracks: [
      {
        id: "lead",
        name: "Lead Synth",
        type: "synth",
        volume: 0.8,
        pan: 0.0,
        automation: {
          volume: [
            { time: 0.0, value: 0.8 },
            { time: 2.0, value: 0.5 },
            { time: 4.0, value: 0.9 },
          ],
          pan: [
            { time: 0.0, value: -0.5 },
            { time: 4.0, value: 0.5 },
          ],
          cutoff: [
            { time: 0.0, value: 800 },
            { time: 4.0, value: 2400 },
          ],
        },
        notes: [{ position: 0, duration: 480, pitch: 60, velocity: 100 }],
      },
    ],
  });

  const zipBytes = encodeDawProject(original);
  const restored = await decodeDawProject(zipBytes);

  const lead = restored.tracks.find(
    (t) => t.id === "lead" || t.name === "Lead Synth",
  );
  assert.ok(lead, "Must restore Lead Synth track");
  assert.ok(lead.automation, "Must restore track.automation object");
  assert.ok(
    Array.isArray(lead.automation.volume),
    "Must restore volume automation array",
  );
  assert.equal(lead.automation.volume.length, 3);
  assert.equal(lead.automation.volume[0].time, 0.0);
  assert.equal(lead.automation.volume[0].value, 0.8);
  assert.equal(lead.automation.volume[1].time, 2.0);
  assert.equal(lead.automation.volume[1].value, 0.5);

  assert.ok(
    Array.isArray(lead.automation.pan),
    "Must restore pan automation array",
  );
  assert.equal(lead.automation.pan.length, 2);
  assert.equal(lead.automation.pan[0].time, 0.0);
  assert.equal(lead.automation.pan[0].value, -0.5);

  assert.ok(
    Array.isArray(lead.automation.cutoff),
    "Must restore cutoff automation array",
  );
  assert.equal(lead.automation.cutoff.length, 2);
  assert.equal(lead.automation.cutoff[0].value, 800);
});

test("scdaw-dawproject: preserves extended builtin audio FX (delay, reverb, crusher, wavefolder)", async () => {
  const original = createProject({
    name: "FX Rack Test",
    bpm: 120,
    tracks: [
      {
        id: "pad",
        name: "Space Pad",
        type: "synth",
        audioFx: [
          {
            type: "delay",
            feedback: 0.45,
            wet: 0.35,
            timeStepsL: 3,
            timeStepsR: 4,
          },
          { type: "reverb", decay: 2.5, wet: 0.4 },
          { type: "crusher", bits: 8, downsample: 2, mix: 0.7 },
          { type: "fold", driveDb: 6, mix: 0.8 },
        ],
        notes: [{ position: 0, duration: 960, pitch: 48, velocity: 90 }],
      },
    ],
  });

  const zipBytes = encodeDawProject(original);
  const restored = await decodeDawProject(zipBytes);

  const pad = restored.tracks.find(
    (t) => t.id === "pad" || t.name === "Space Pad",
  );
  assert.ok(pad, "Must restore Space Pad track");
  assert.ok(Array.isArray(pad.audioFx), "Must restore audioFx array");
  assert.equal(pad.audioFx.length, 4);

  const delayFx = pad.audioFx.find((f) => f.type === "delay");
  assert.ok(delayFx);
  assert.equal(delayFx.feedback, 0.45);
  assert.equal(delayFx.wet, 0.35);

  const reverbFx = pad.audioFx.find((f) => f.type === "reverb");
  assert.ok(reverbFx);
  assert.equal(reverbFx.decay, 2.5);

  const crusherFx = pad.audioFx.find((f) => f.type === "crusher");
  assert.ok(crusherFx);
  assert.equal(crusherFx.bits, 8);

  const foldFx = pad.audioFx.find((f) => f.type === "fold");
  assert.ok(foldFx);
  assert.equal(foldFx.driveDb, 6);
});

test("scdaw-dawproject: encodes and decodes timeline audio clips referencing embedded samples", async () => {
  const original = createProject({
    name: "Audio Clips Test",
    bpm: 120,
    tracks: [
      {
        id: "vox",
        name: "Vocal Stem",
        type: "audio",
        audioClips: [
          {
            time: 0.0,
            duration: 4.0,
            sample: "samples/vox.wav",
            name: "Vox Verse",
          },
        ],
      },
    ],
  });

  const fakeWav = new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
  ]);
  const zipBytes = encodeDawProject(original, {
    bouncedStems: {
      vox: fakeWav,
    },
  });

  const restored = await decodeDawProject(zipBytes);
  const voxTrack = restored.tracks.find(
    (t) => t.id === "vox" || t.name === "Vocal Stem",
  );
  assert.ok(voxTrack);
  assert.ok(Array.isArray(voxTrack.audioClips));
  assert.equal(voxTrack.audioClips.length, 1);
  assert.equal(voxTrack.audioClips[0].time, 0.0);
  assert.equal(voxTrack.audioClips[0].duration, 4.0);
  assert.equal(voxTrack.audioClips[0].sample, "samples/vox.wav");
});
