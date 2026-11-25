import test from "node:test";
import assert from "node:assert/strict";
import {
  PPQN,
  MIN_BPM,
  MAX_BPM,
  createProject,
  validateProject,
  deserializeProject,
  applyCommand,
  parseDuration,
  projectToScoreView,
  beatsPerBar,
  barPulses,
  stepsPerBar,
  getNormalizedSignatureMap,
  getBarTimeline,
  pulseToBarBeat,
  computeProjectTotalPulses,
} from "../.agents/scripts/shadow-claw-daw.js";
import {
  TRANSPORT_SCHEMA,
  migrateProject,
} from "../.agents/scripts/shadow-claw-daw-schema.js";
import {
  parseMotif,
  compileSong,
  SCALES,
  CHORD_INTERVALS,
  STYLE_PRESETS,
} from "../.agents/scripts/shadow-claw-daw-compose.js";
import {
  GM_INSTRUMENTS,
  resolveGmProgram,
} from "../.agents/scripts/shadow-claw-daw-soundfont.js";
import {
  encodeMidiFile,
  decodeMidiFile,
  midiToProject,
} from "../.agents/scripts/shadow-claw-daw-midi.js";
import {
  encodeDawProject,
  decodeDawProject,
} from "../.agents/scripts/shadow-claw-daw-dawproject.js";
import {
  compressToBase64Url,
  validateBase64UrlLength,
} from "../.agents/scripts/shadow-claw-daw-compress.js";
import {
  MAX_HASH_URL_LENGTH,
  MAX_QUERY_URL_LENGTH,
  createCompressedUrl,
  validateCompressedUrl,
} from "../.agents/scripts/shadow-claw-daw-url-param.js";
import { handleToolDispatch } from "../.agents/scripts/shadow-claw-daw-adapter.js";
import {
  computeTimelineTicks,
  calculateTimelineSeekPpqn,
} from "../.agents/scripts/components/shadow-claw-daw-timeline.js";

test("BPM Range (20-300): constants, validateProject, deserializeProject, and set_transport accept slow choral & fast compound tempos", () => {
  assert.equal(MIN_BPM, 20);
  assert.equal(MAX_BPM, 300);
  assert.equal(TRANSPORT_SCHEMA.bpm.min, 20);
  assert.equal(TRANSPORT_SCHEMA.bpm.max, 300);

  // Slow choral ballad: 32 BPM ("Somewhere in Your Silent Night") & 27 BPM ("Hush Little Baby") & lower bound 20 BPM
  for (const slowBpm of [20, 27, 32]) {
    const proj = createProject({
      name: `Slow ${slowBpm}`,
      bpm: slowBpm,
      signature: [6, 8],
    });
    const val = validateProject(proj);
    assert.equal(
      val.valid,
      true,
      `BPM ${slowBpm} must be valid: ${val.errors.join(", ")}`,
    );
    const roundTrip = deserializeProject(JSON.stringify(proj));
    assert.equal(roundTrip.bpm, slowBpm);
  }

  // Fast compound / presto tempos: 252, 260, 300 BPM
  for (const fastBpm of [252, 260, 300]) {
    const proj = createProject({
      name: `Fast ${fastBpm}`,
      bpm: fastBpm,
      signature: [6, 8],
    });
    const val = validateProject(proj);
    assert.equal(
      val.valid,
      true,
      `BPM ${fastBpm} must be valid: ${val.errors.join(", ")}`,
    );
  }

  // Out-of-bounds (< 20 or > 300) must still fail with 20..300 message
  const tooSlow = { ...createProject("empty"), bpm: 19 };
  const slowVal = validateProject(tooSlow);
  assert.equal(slowVal.valid, false);
  assert.match(slowVal.errors[0], /20.*300/);

  const tooFast = { ...createProject("empty"), bpm: 301 };
  const fastVal = validateProject(tooFast);
  assert.equal(fastVal.valid, false);
  assert.match(fastVal.errors[0], /20.*300/);

  assert.throws(
    () => deserializeProject(tooSlow),
    /Invalid bpm: 19 \(must be between 20 and 300\)/,
  );
  assert.throws(
    () => deserializeProject(tooFast),
    /Invalid bpm: 301 \(must be between 20 and 300\)/,
  );

  // set_transport clamps to [20, 300]
  const base = createProject("empty");
  assert.equal(
    applyCommand(base, "set_transport", { bpm: 32 }).project.bpm,
    32,
  );
  assert.equal(
    applyCommand(base, "set_transport", { bpm: 10 }).project.bpm,
    20,
  );
  assert.equal(
    applyCommand(base, "set_transport", { bpm: 280 }).project.bpm,
    280,
  );
  assert.equal(
    applyCommand(base, "set_transport", { bpm: 350 }).project.bpm,
    300,
  );
});

test("PPQN & Durations: standard PPQN=960 constants and dotted/triplet/32nd durations", () => {
  assert.equal(PPQN.Quarter, 960);
  assert.equal(PPQN.Eighth, 480);
  assert.equal(PPQN.DottedQuarter, 1440);
  assert.equal(PPQN.Half, 1920);
  assert.equal(PPQN.DottedHalf, 2880);
  assert.equal(PPQN.Whole, 3840);
  assert.equal(PPQN.SemiQuaver, 240);
  assert.equal(PPQN.TripletEighth, 320);

  assert.equal(parseDuration("1/8."), 720);
  assert.equal(parseDuration("de"), 720);
  assert.equal(parseDuration("1/4."), 1440);
  assert.equal(parseDuration("dq"), 1440);
  assert.equal(parseDuration("3/8"), 1440);
  assert.equal(parseDuration("1/2."), 2880);
  assert.equal(parseDuration("dh"), 2880);
  assert.equal(parseDuration("1/8t"), 320);
  assert.equal(parseDuration("8t"), 320);
  assert.equal(parseDuration("1/4t"), 640);
  assert.equal(parseDuration("1/32"), 120);

  // parseMotif supports dotted and triplet durations
  const motif = parseMotif("C4:4. D4:8. E4:2. F4:dq G4:8t A4:32");
  assert.equal(motif.length, 6);
  assert.equal(motif[0].duration, 1440);
  assert.equal(motif[1].relPulse, 1440);
  assert.equal(motif[1].duration, 720);
  assert.equal(motif[2].relPulse, 2160);
  assert.equal(motif[2].duration, 2880);
  assert.equal(motif[3].duration, 1440);
  assert.equal(motif[4].duration, 320);
  assert.equal(motif[5].duration, 120);
});

test("Mixed Time Signatures & Score View: projectToScoreView tracks 6/8 -> 2/4 -> 4/4 without bar/beat drift", () => {
  // 2 bars of 6/8 (2880 * 2 = 5760), then 1 bar of 2/4 at 5760 (length 1920 -> ends at 7680), then 4/4 starting at 7680
  const proj = {
    version: 2,
    name: "Mixed Meter Choral",
    bpm: 32,
    signature: [6, 8],
    lengthBars: 4,
    signatureMap: [
      { pulse: 0, signature: [6, 8] },
      { pulse: 5760, signature: [2, 4] },
      { pulse: 7680, signature: [4, 4] },
    ],
    tracks: [
      {
        id: "trk_sop",
        name: "Soprano",
        kind: "synth",
        instrument: "soundfont",
        params: { program: 52 },
        notes: [
          { position: 0, duration: 1440, pitch: 67, velocity: 0.85 }, // Bar 1, Beat 1 (6/8)
          { position: 2880, duration: 2880, pitch: 69, velocity: 0.85 }, // Bar 2, Beat 1 (6/8, full bar)
          { position: 5760, duration: 960, pitch: 71, velocity: 0.9 }, // Bar 3, Beat 1 (2/4)
          { position: 6720, duration: 960, pitch: 72, velocity: 0.9 }, // Bar 3, Beat 2 (2/4)
          { position: 7680, duration: 3840, pitch: 74, velocity: 0.95 }, // Bar 4, Beat 1 (4/4, full bar)
          { position: 8640, duration: 480, pitch: 76, velocity: 0.8 }, // Bar 4, Beat 2 (4/4)
        ],
      },
    ],
  };

  const sigMap = getNormalizedSignatureMap(proj);
  assert.equal(sigMap.length, 3);

  const bars = getBarTimeline(proj);
  assert.equal(bars.length, 4);
  assert.deepEqual(
    bars.map((b) => ({
      bar: b.bar,
      start: b.startPulse,
      len: b.lengthPulses,
      sig: b.signature,
    })),
    [
      { bar: 1, start: 0, len: 2880, sig: [6, 8] },
      { bar: 2, start: 2880, len: 2880, sig: [6, 8] },
      { bar: 3, start: 5760, len: 1920, sig: [2, 4] },
      { bar: 4, start: 7680, len: 3840, sig: [4, 4] },
    ],
  );

  assert.equal(computeProjectTotalPulses(proj), 2880 + 2880 + 1920 + 3840);
  assert.deepEqual(pulseToBarBeat(5760, proj).bar, 3);
  assert.deepEqual(pulseToBarBeat(7680, proj).bar, 4);

  const scoreView = projectToScoreView(proj);
  const sop = scoreView.tracks[0].score;
  assert.equal(sop[0].bar, 1);
  assert.equal(sop[0].beat, 1);
  assert.equal(sop[0].dur, "3/8"); // dotted quarter = 1440
  assert.equal(sop[1].bar, 2);
  assert.equal(sop[1].beat, 1);
  assert.equal(sop[1].dur, "1 bar"); // 2880 in 6/8 bar
  assert.equal(sop[2].bar, 3);
  assert.equal(sop[2].beat, 1);
  assert.equal(sop[3].bar, 3);
  assert.equal(sop[3].beat, 2);
  assert.equal(sop[4].bar, 4);
  assert.equal(sop[4].beat, 1);
  assert.equal(sop[4].dur, "1 bar"); // 3840 in 4/4 bar
  assert.equal(sop[5].bar, 4);
  assert.equal(sop[5].beat, 2);
});

test("Timeline ticks & seek: accurately handles 6/8, 3/4, and mixed signatureMap", () => {
  const ticks68 = computeTimelineTicks(2, [6, 8]);
  assert.equal(ticks68.length, 12); // 2 bars * 6 eighth notes
  assert.equal(ticks68[0].posPpqn, 0);
  assert.equal(ticks68[1].posPpqn, 480);
  assert.equal(ticks68[6].bar, 2);
  assert.equal(ticks68[6].posPpqn, 2880);

  const mixedTicks = computeTimelineTicks(
    3,
    [6, 8],
    [
      { pulse: 0, signature: [6, 8] },
      { pulse: 2880, signature: [2, 4] },
      { pulse: 4800, signature: [4, 4] },
    ],
  );
  // Bar 1 (6/8 -> 6 ticks), Bar 2 (2/4 -> 2 ticks), Bar 3 (4/4 -> 4 ticks) = 12 ticks
  assert.equal(mixedTicks.length, 12);
  assert.equal(mixedTicks[6].bar, 2);
  assert.equal(mixedTicks[6].posPpqn, 2880);
  assert.equal(mixedTicks[8].bar, 3);
  assert.equal(mixedTicks[8].posPpqn, 4800);

  const seek68 = calculateTimelineSeekPpqn({
    clientX: 100,
    rect: { left: 0, width: 200 },
    lengthBars: 2,
    snapMode: "bar",
    signature: [6, 8],
  });
  assert.equal(seek68, 2880);
});

test("Wider Music Support: SoundFont GM choir/strings/flute/world programs, scales, chords, and non-4/4 compileSong", () => {
  assert.equal(GM_INSTRUMENTS["choir-aahs"], 52);
  assert.equal(resolveGmProgram("choir-aahs"), 52);
  assert.equal(resolveGmProgram("string-ensemble-1"), 48);
  assert.equal(resolveGmProgram("flute"), 73);
  assert.equal(resolveGmProgram("sitar"), 104);

  assert.ok(Array.isArray(SCALES.harmonic_minor));
  assert.ok(Array.isArray(SCALES.lydian));
  assert.ok(Array.isArray(CHORD_INTERVALS.maj9));
  assert.ok(Array.isArray(CHORD_INTERVALS["7sus4"]));
  assert.ok(STYLE_PRESETS.waltz);
  assert.ok(STYLE_PRESETS.choral);

  // Compile a slow 6/8 choral ballad at 32 BPM
  const ballad = compileSong({
    title: "Silent Night Choral",
    bpm: 32,
    signature: [6, 8],
    key: "C",
    mode: "major",
    feel: "ballad",
    legato: true,
    instruments: {
      drums: "rock-kit",
      bass: "cello",
      rhythm: "choir-aahs",
      lead: "flute",
    },
    sections: [
      { name: "verse", bars: 4, chords: "C | G7 | C | F", energy: 0.6 },
    ],
    form: ["verse"],
  });

  assert.equal(ballad.bpm, 32);
  assert.deepEqual(ballad.signature, [6, 8]);
  assert.equal(ballad.lengthBars, 4);
  // 4 bars of 6/8 = 4 * 2880 = 11520 pulses! Must NOT overflow into 4/4 (15360)
  assert.equal(ballad.loop.endPulse, 4 * 2880);
  for (const trk of ballad.tracks) {
    for (const n of trk.notes) {
      assert.ok(
        n.position < 4 * 2880,
        `Note at ${n.position} in track ${trk.id} exceeds 4 bars of 6/8 (11520)`,
      );
    }
  }
  assert.equal(validateProject(ballad).valid, true);

  // Legato mode should preserve full mathematical note durations (no 0.85/0.92 clipping)
  const rhythm = ballad.tracks.find((t) => t.id === "trk_rhythm");
  assert.ok(
    rhythm.notes.some((n) => n.duration === 1440 || n.duration === 960),
  );
});

test("MIDI & DAWproject: compound meter lengthBars, Format 0 velocity scaling, and signatureMap/tempoMap roundtrip", async () => {
  const proj68 = createProject({
    name: "Compound 6/8 Waltz",
    bpm: 32,
    signature: [6, 8],
    lengthBars: 4,
    signatureMap: [
      { pulse: 0, signature: [6, 8] },
      { pulse: 5760, signature: [2, 4] },
    ],
    tempoMap: [
      { pulse: 0, bpm: 32 },
      { pulse: 5760, bpm: 64 },
    ],
    tracks: [
      {
        id: "trk_choir",
        name: "Choir",
        kind: "synth",
        instrument: "soundfont",
        params: { program: 52 },
        notes: [
          { position: 0, duration: 1440, pitch: 60, velocity: 0.8 },
          { position: 5760, duration: 960, pitch: 64, velocity: 0.9 },
        ],
      },
    ],
  });

  // Format 1 round-trip with tempoMap/signatureMap
  const smf1 = encodeMidiFile(proj68, { format: 1 });
  const decoded1 = decodeMidiFile(smf1);
  assert.equal(decoded1.bpm, 32);
  assert.ok(decoded1.tempoMap.length >= 2);
  assert.ok(decoded1.signatureMap.length >= 2);

  // Compound meter 6/8 MIDI import lengthBars uses barPulses([6,8]) = 2880
  const pure68 = createProject({
    name: "Pure 6/8",
    bpm: 60,
    signature: [6, 8],
    lengthBars: 2,
    tracks: [
      {
        id: "trk_1",
        name: "Lead",
        kind: "synth",
        notes: [{ position: 2880, duration: 1440, pitch: 60, velocity: 0.8 }], // Bar 2
      },
    ],
  });
  const imported68 = midiToProject(encodeMidiFile(pure68));
  assert.equal(imported68.lengthBars, 2);

  // Format 0 velocity scaling preserves normalized 0.8 -> ~102 instead of 1
  const smf0 = encodeMidiFile(pure68, { format: 0 });
  const dec0 = decodeMidiFile(smf0);
  assert.ok(
    dec0.tracks[0].notes[0].velocity >= 95,
    `Expected scaled velocity ~102, got ${dec0.tracks[0].notes[0].velocity}`,
  );

  // DAWproject 6/8 totalBeats = 2 * 3 = 6
  const dawBuf = encodeDawProject(pure68);
  const dawDecoded = await decodeDawProject(dawBuf);
  assert.equal(dawDecoded.bpm, 60);
  assert.deepEqual(dawDecoded.signature, [6, 8]);
});

test("WebMCP Metadata & URL Length Validation: scdaw_list_schemas, scdaw_get_status, and createCompressedUrl pre-validation", async () => {
  const schemasRes = await handleToolDispatch("scdaw_list_schemas", {
    category: "all",
  });
  assert.ok(
    schemasRes.transport,
    "scdaw_list_schemas must expose transport schema",
  );
  assert.equal(schemasRes.transport.bpm.min, 20);
  assert.equal(schemasRes.transport.bpm.max, 300);

  const statusRes = await handleToolDispatch("scdaw_get_status", {});
  assert.deepEqual(statusRes.bpmRange, { min: 20, max: 300 });

  // Base64URL validation
  const validB64 = await compressToBase64Url(JSON.stringify({ ok: true }));
  assert.equal(validateBase64UrlLength(validB64).valid, true);
  assert.equal(validateBase64UrlLength("invalid+chars/=").valid, false);
  assert.equal(validateBase64UrlLength("abcd", { maxLength: 3 }).valid, false);

  // URL length pre-validation rejects oversized URLs
  assert.ok(MAX_HASH_URL_LENGTH >= 16384);
  assert.ok(MAX_QUERY_URL_LENGTH >= 2048);

  const smallUrl = await createCompressedUrl("https://example.com/", '{"a":1}');
  const urlCheck = validateCompressedUrl(smallUrl);
  assert.equal(urlCheck.valid, true);

  const variedPayload = Array.from(
    { length: 80 },
    (_, i) => `k${i}=${(i * 7919) % 997}`,
  ).join("&");
  await assert.rejects(
    async () =>
      await createCompressedUrl("https://example.com/", variedPayload, {
        maxUrlLength: 80,
      }),
    /URL length/i,
  );
});
