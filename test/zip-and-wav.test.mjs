import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encodeWav,
  decodeWavHeader,
  serializeProject,
  deserializeProject,
  createProject,
} from "../.agents/scripts/scdaw.js";
import {
  DAWPROJECT_UNITS,
  DEVICE_ROLES,
  CHANNEL_ROLES,
  ParameterEncoder,
  ParameterDecoder,
  migrateProject,
} from "../.agents/scripts/scdaw-schema.js";
import {
  encodeZip,
  decodeZip,
  createResourcePacker,
  createResourceProvider,
} from "../.agents/scripts/scdaw-zip.js";

test("encodeWav and decodeWavHeader: supports 16-bit, 24-bit PCM and 32-bit Float", () => {
  const sampleRate = 44100;
  const numFrames = 200;
  const left = new Float32Array(numFrames);
  const right = new Float32Array(numFrames);
  for (let i = 0; i < numFrames; i++) {
    left[i] = Math.sin((i / numFrames) * Math.PI * 2) * 0.8;
    right[i] = -left[i];
  }

  // 16-bit PCM
  const wav16 = encodeWav([left, right], sampleRate, { bitDepth: 16 });
  assert.equal(wav16.byteLength, 44 + numFrames * 4);
  const info16 = decodeWavHeader(wav16);
  assert.equal(info16.audioFormat, 1);
  assert.equal(info16.numChannels, 2);
  assert.equal(info16.sampleRate, sampleRate);
  assert.equal(info16.bitsPerSample, 16);
  assert.equal(info16.numFrames, numFrames);

  // 24-bit PCM
  const wav24 = encodeWav([left, right], sampleRate, { bitDepth: 24 });
  assert.equal(wav24.byteLength, 44 + numFrames * 6);
  const info24 = decodeWavHeader(wav24);
  assert.equal(info24.audioFormat, 1);
  assert.equal(info24.numChannels, 2);
  assert.equal(info24.sampleRate, sampleRate);
  assert.equal(info24.bitsPerSample, 24);
  assert.equal(info24.numFrames, numFrames);

  // 32-bit IEEE Float
  const wav32 = encodeWav([left, right], sampleRate, { bitDepth: 32 });
  assert.equal(wav32.byteLength, 44 + numFrames * 8);
  const info32 = decodeWavHeader(wav32);
  assert.equal(info32.audioFormat, 3);
  assert.equal(info32.numChannels, 2);
  assert.equal(info32.sampleRate, sampleRate);
  assert.equal(info32.bitsPerSample, 32);
  assert.equal(info32.numFrames, numFrames);
});

test("encodeZip and decodeZip: packages and extracts multiple files with CRC-32 integrity", async () => {
  const textContent = "Hello ShadowClaw DAW";
  const jsonContent = JSON.stringify({ name: "Test Project", bpm: 128 });
  const binaryBuffer = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0xfe, 0xff]);

  const files = [
    { name: "readme.txt", data: textContent },
    { name: "project.json", data: jsonContent },
    { name: "samples/kick.raw", data: binaryBuffer },
  ];

  const zipBuffer = encodeZip(files);
  assert.ok(zipBuffer instanceof ArrayBuffer);
  assert.ok(zipBuffer.byteLength > 100);

  const decoded = await decodeZip(zipBuffer);
  assert.equal(decoded.length, 3);

  const txtEntry = decoded.find((e) => e.name === "readme.txt");
  assert.ok(txtEntry);
  assert.equal(new TextDecoder().decode(txtEntry.data), textContent);

  const jsonEntry = decoded.find((e) => e.name === "project.json");
  assert.ok(jsonEntry);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(jsonEntry.data)), {
    name: "Test Project",
    bpm: 128,
  });

  const binEntry = decoded.find((e) => e.name === "samples/kick.raw");
  assert.ok(binEntry);
  assert.deepEqual(
    Array.from(binEntry.data),
    [0x01, 0x02, 0x03, 0x04, 0xfe, 0xff],
  );

  // Test ResourceProvider / ResourcePacker interfaces
  const provider = createResourceProvider(decoded);
  const pTxt = provider.fromPath("readme.txt");
  assert.equal(pTxt.name, "readme.txt");
  assert.equal(new TextDecoder().decode(pTxt.buffer), textContent);

  const packer = createResourcePacker();
  packer.write("metadata.xml", "<meta></meta>");
  packer.write("samples/01.wav", new Uint8Array([1, 2, 3]));
  const packedZip = packer.toZip();
  const decodedPacked = await decodeZip(packedZip);
  assert.equal(decodedPacked.length, 2);
});

test("scdaw-schema: exports DAWproject enums and ParameterEncoder/Decoder", () => {
  assert.equal(DAWPROJECT_UNITS.LINEAR, "linear");
  assert.equal(DAWPROJECT_UNITS.NORMALIZED, "normalized");
  assert.equal(DAWPROJECT_UNITS.BPM, "bpm");
  assert.equal(DEVICE_ROLES.INSTRUMENT, "instrument");
  assert.equal(CHANNEL_ROLES.REGULAR, "regular");

  const linParam = ParameterEncoder.linear("vol_1", 0.75, 0, 1.5, "Volume");
  assert.equal(linParam.id, "vol_1");
  assert.equal(linParam.value, 0.75);
  assert.equal(linParam.unit, "linear");
  assert.equal(ParameterDecoder.readValue(linParam), 0.75);

  const normParam = ParameterEncoder.normalized("pan_1", 0.5, 0, 1, "Pan");
  assert.equal(normParam.unit, "normalized");
  assert.equal(ParameterDecoder.readValue(normParam), 0.5);
});

test("migrateProject & serialize/deserializeProject: v1 to v2 upgrade and round-trip", () => {
  const v1Project = {
    version: 1,
    name: "Legacy V1 Beat",
    bpm: 124,
    signature: [4, 4],
    lengthBars: 1,
    master: { volume: 0.8 },
    tracks: [
      {
        id: "trk_drums",
        name: "Drums",
        kind: "drums",
        volume: 0.85,
        pan: 0,
        notes: [{ position: 0, duration: 240, pitch: 36, velocity: 1.0 }],
      },
    ],
  };

  const migrated = migrateProject(v1Project);
  assert.equal(migrated.version, 2);
  assert.ok(migrated.meta);
  assert.equal(migrated.meta.title, "Legacy V1 Beat");
  assert.equal(migrated.tracks[0].channelRole, "regular");
  assert.ok(Array.isArray(migrated.tracks[0].fx));
  assert.ok(Array.isArray(migrated.tracks[0].midiFx));

  const serialized = serializeProject(migrated);
  assert.equal(typeof serialized, "string");
  const deserialized = deserializeProject(serialized);
  assert.equal(deserialized.name, "Legacy V1 Beat");
  assert.equal(deserialized.bpm, 124);
  assert.equal(deserialized.tracks.length, 1);
});
