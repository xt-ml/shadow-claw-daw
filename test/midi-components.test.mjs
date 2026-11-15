import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  buildPianoKeys,
  pitchToNoteName,
  DawMidiKeyboardElement,
} from "../.agents/scripts/components/scdaw-midi-keyboard.js";
import { formatTelemetryStatus } from "../.agents/scripts/components/scdaw-statusbar.js";
import {
  formatMidiStatusBadge,
  formatCaptureButtonState,
} from "../.agents/scripts/components/scdaw-transport.js";
import {
  pitchToPianoRollRow,
  pianoRollRowToPitch,
} from "../.agents/scripts/components/scdaw-editor.js";

test("scdaw-midi-keyboard: buildPianoKeys and pitchToNoteName generate accessible key descriptors", () => {
  assert.equal(pitchToNoteName(60), "C4");
  assert.equal(pitchToNoteName(61), "C#4");
  assert.equal(pitchToNoteName(69), "A4");

  const keys = buildPianoKeys(4, 2); // 2 octaves starting at C4 (MIDI 60)
  assert.equal(keys.length, 24);
  assert.equal(keys[0].pitch, 60);
  assert.equal(keys[0].name, "C4");
  assert.equal(keys[0].isBlack, false);
  assert.equal(keys[1].pitch, 61);
  assert.equal(keys[1].isBlack, true);
  assert.equal(typeof DawMidiKeyboardElement, "function");
});

test("scdaw-midi-keyboard: source uses @container queries, coarse pointer hit targets, and ARIA", async () => {
  const src = await fs.readFile(
    ".agents/scripts/components/scdaw-midi-keyboard.js",
    "utf8",
  );
  assert.match(src, /@container/);
  assert.match(src, /@media \(pointer: coarse\)/);
  assert.match(src, /aria-pressed/);
  assert.match(src, /touch-action:\s*pan-x/);
  assert.match(src, /box-shadow:\s*inset/);
  assert.match(src, /translateY/);
  assert.match(src, /id="hold-btn"/);
  assert.match(src, /activeLivePitches/);
});

test("scdaw-statusbar: formatTelemetryStatus includes MIDI status when provided", () => {
  const res = formatTelemetryStatus(
    { playing: false, audio: "running", bar: 1, beat: 1, bpm: 120 },
    { name: "Demo", bpm: 120, tracks: [] },
    { midiStatus: "ready", midiInputCount: 2 },
  );
  assert.match(res.midiSummary, /MIDI:\s*2\s*in/i);

  const unsupported = formatTelemetryStatus(
    { playing: false, audio: "running", bar: 1, beat: 1, bpm: 120 },
    { name: "Demo", bpm: 120, tracks: [] },
    { midiStatus: "unsupported", midiInputCount: 0 },
  );
  assert.match(unsupported.midiSummary, /MIDI:\s*Keys/i);
});

test("scdaw-transport: formatMidiStatusBadge and native <dialog> compliance", async () => {
  assert.equal(
    formatMidiStatusBadge({ status: "ready", inputs: [{ id: "1" }] }).label,
    "MIDI (1)",
  );
  assert.equal(
    formatMidiStatusBadge({ status: "unsupported", inputs: [] }).label,
    "MIDI (Keys)",
  );

  const src = await fs.readFile(
    ".agents/scripts/components/scdaw-transport.js",
    "utf8",
  );
  const midiDialogMatch = src.match(
    /<dialog id="scdaw-midi-dialog"[\s\S]*?<\/dialog>/,
  );
  assert.ok(midiDialogMatch, "Expected #scdaw-midi-dialog");
  assert.match(src, /showModal\(\)/);
  assert.match(src, /overscroll-behavior:\s*contain/);
  assert.doesNotMatch(midiDialogMatch[0], /role=["']dialog["']/);
  assert.doesNotMatch(midiDialogMatch[0], /aria-modal/);

  const capEmpty = formatCaptureButtonState(0, 0);
  assert.equal(capEmpty.label, "⏺ Capture");
  assert.equal(capEmpty.hasNotes, false);

  const capReady = formatCaptureButtonState(4, 0);
  assert.equal(capReady.label, "⏺ Capture (4)");
  assert.equal(capReady.hasNotes, true);

  const capDone = formatCaptureButtonState(0, 4);
  assert.equal(capDone.label, "✓ Captured 4");

  const captureDialogMatch = src.match(
    /<dialog id="scdaw-capture-dialog"[\s\S]*?<\/dialog>/,
  );
  assert.ok(captureDialogMatch, "Expected #scdaw-capture-dialog");
  assert.doesNotMatch(captureDialogMatch[0], /role=["']dialog["']/);
  assert.doesNotMatch(captureDialogMatch[0], /aria-modal/);
});

test("scdaw-timeline: renders record-arm-btn for synth/drums tracks too", async () => {
  const src = await fs.readFile(
    ".agents/scripts/components/scdaw-timeline.js",
    "utf8",
  );
  // Ensure record-arm-btn is no longer restricted solely to t.kind === "audio"
  assert.doesNotMatch(
    src,
    /t\.kind\s*===\s*["']audio["']\s*\?\s*`<button[^>]*record-arm-btn/,
  );
});

test("scdaw-workbench: mounts scdaw-midi-keyboard", async () => {
  const src = await fs.readFile(
    ".agents/scripts/components/scdaw-workbench.js",
    "utf8",
  );
  assert.match(src, /<scdaw-midi-keyboard/);
});

test("scdaw-browser: search input updates item-list in-place without full re-render", async () => {
  const src = await fs.readFile(
    ".agents/scripts/components/scdaw-browser.js",
    "utf8",
  );
  const inputHandler = src.match(
    /searchInput\.addEventListener\("input",[\s\S]*?\}\);/,
  );
  assert.ok(inputHandler, "Expected searchInput input listener");
  assert.match(inputHandler[0], /_updateList\(\)/);
  assert.doesNotMatch(inputHandler[0], /this\.render\(\)/);
});

test("scdaw-editor: supports all MIDI octaves (0..127) without clamping and renders full range", async () => {
  const rowB6 = pitchToPianoRollRow(95);
  assert.equal(pianoRollRowToPitch(rowB6), 95);
  const rowC_1 = pitchToPianoRollRow(0);
  assert.equal(pianoRollRowToPitch(rowC_1), 0);
  const rowG9 = pitchToPianoRollRow(127);
  assert.equal(pianoRollRowToPitch(rowG9), 127);

  const src = await fs.readFile(
    ".agents/scripts/components/scdaw-editor.js",
    "utf8",
  );
  assert.match(
    src,
    /for\s*\(\s*let\s+pitch\s*=\s*MAX_PITCH;\s*pitch\s*>=\s*MIN_PITCH;\s*pitch--\s*\)/,
  );
});
