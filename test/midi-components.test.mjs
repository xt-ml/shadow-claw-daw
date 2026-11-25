import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  buildPianoKeys,
  pitchToNoteName,
  resolveKeyElementFromPoint,
  ShadowClawDawMidiKeyboard,
} from "../.agents/scripts/components/shadow-claw-daw-midi-keyboard.js";
import { scdaw } from "../.agents/scripts/scdaw-engine.js";
import { setupWorkbenchMidiKeyboard } from "../.agents/scripts/components/shadow-claw-daw-workbench.js";
import { formatTelemetryStatus } from "../.agents/scripts/components/shadow-claw-daw-status-bar.js";
import {
  formatMidiStatusBadge,
  formatCaptureButtonState,
} from "../.agents/scripts/components/shadow-claw-daw-transport.js";
import {
  pitchToPianoRollRow,
  pianoRollRowToPitch,
  resolvePianoRollKeyFromPoint,
  setupPianoRollKeyAudition,
} from "../.agents/scripts/components/shadow-claw-daw-editor.js";

test("shadow-claw-daw-midi-keyboard: buildPianoKeys and pitchToNoteName generate accessible key descriptors", () => {
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
  assert.equal(typeof ShadowClawDawMidiKeyboard, "function");
});

test("shadow-claw-daw-midi-keyboard: source uses @container queries, coarse pointer hit targets, and ARIA", async () => {
  const src = await fs.readFile(
    ".agents/scripts/components/shadow-claw-daw-midi-keyboard.js",
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

test("shadow-claw-daw-status-bar: formatTelemetryStatus includes MIDI status when provided", () => {
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

test("shadow-claw-daw-transport: formatMidiStatusBadge and native <dialog> compliance", async () => {
  assert.equal(
    formatMidiStatusBadge({ status: "ready", inputs: [{ id: "1" }] }).label,
    "MIDI (1)",
  );
  assert.equal(
    formatMidiStatusBadge({ status: "unsupported", inputs: [] }).label,
    "MIDI (Keys)",
  );

  const src = await fs.readFile(
    ".agents/scripts/components/shadow-claw-daw-transport.js",
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

test("shadow-claw-daw-timeline: renders record-arm-btn for synth/drums tracks too", async () => {
  const src = await fs.readFile(
    ".agents/scripts/components/shadow-claw-daw-timeline.js",
    "utf8",
  );
  // Ensure record-arm-btn is no longer restricted solely to t.kind === "audio"
  assert.doesNotMatch(
    src,
    /t\.kind\s*===\s*["']audio["']\s*\?\s*`<button[^>]*record-arm-btn/,
  );
});

test("shadow-claw-daw-workbench: mounts shadow-claw-daw-midi-keyboard", async () => {
  const src = await fs.readFile(
    ".agents/scripts/components/shadow-claw-daw-workbench.js",
    "utf8",
  );
  assert.match(src, /<shadow-claw-daw-midi-keyboard/);
});

test("shadow-claw-daw-browser: search input updates item-list in-place without full re-render", async () => {
  const src = await fs.readFile(
    ".agents/scripts/components/shadow-claw-daw-browser.js",
    "utf8",
  );
  const inputHandler = src.match(
    /searchInput\.addEventListener\("input",[\s\S]*?\}\);/,
  );
  assert.ok(inputHandler, "Expected searchInput input listener");
  assert.match(inputHandler[0], /_updateList\(\)/);
  assert.doesNotMatch(inputHandler[0], /this\.render\(\)/);
});

test("shadow-claw-daw-editor: supports all MIDI octaves (0..127) without clamping and renders full range", async () => {
  const rowB6 = pitchToPianoRollRow(95);
  assert.equal(pianoRollRowToPitch(rowB6), 95);
  const rowC_1 = pitchToPianoRollRow(0);
  assert.equal(pianoRollRowToPitch(rowC_1), 0);
  const rowG9 = pitchToPianoRollRow(127);
  assert.equal(pianoRollRowToPitch(rowG9), 127);

  const src = await fs.readFile(
    ".agents/scripts/components/shadow-claw-daw-editor.js",
    "utf8",
  );
  assert.match(
    src,
    /for\s*\(\s*let\s+pitch\s*=\s*MAX_PITCH;\s*pitch\s*>=\s*MIN_PITCH;\s*pitch--\s*\)/,
  );
});

function createMockKey({ selector, pitch }) {
  const attrs = { "aria-pressed": "false" };
  const capturedPointers = [];
  const el = {
    dataset: { pitch: String(pitch) },
    capturedPointers,
    getAttribute(name) {
      return attrs[name] ?? null;
    },
    setAttribute(name, val) {
      attrs[name] = String(val);
    },
    setPointerCapture(pointerId) {
      capturedPointers.push(pointerId);
    },
    closest(sel) {
      return sel === selector ? el : null;
    },
  };
  return el;
}

function createMockShadowRoot({ keys, hitTest }) {
  const listeners = new Map();
  const root = {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatch(type, event) {
      for (const fn of listeners.get(type) || []) {
        fn(event);
      }
    },
    querySelectorAll(sel) {
      if (sel === ".piano-key" || sel === ".pr-key[data-pitch]") return keys;
      return [];
    },
    contains(el) {
      return keys.includes(el);
    },
    elementFromPoint(x, y) {
      return hitTest(x, y);
    },
  };
  return root;
}

test("shadow-claw-daw-midi-keyboard: resolveKeyElementFromPoint resolves shadow keys, child nodes, and filters outside nodes", () => {
  const key60 = createMockKey({ selector: ".piano-key", pitch: 60 });
  const childSpan = { closest: (sel) => (sel === ".piano-key" ? key60 : null) };
  const outsideKey = createMockKey({ selector: ".piano-key", pitch: 72 });
  const stripGap = { closest: () => null };

  let hitTarget = childSpan;
  const root = createMockShadowRoot({
    keys: [key60],
    hitTest: () => hitTarget,
  });

  assert.equal(resolveKeyElementFromPoint(root, 10, 20, ".piano-key"), key60);
  hitTarget = stripGap;
  assert.equal(resolveKeyElementFromPoint(root, 10, 20, ".piano-key"), null);
  hitTarget = outsideKey;
  assert.equal(resolveKeyElementFromPoint(root, 10, 20, ".piano-key"), null);
  assert.equal(
    resolveKeyElementFromPoint(root, Number.NaN, 20, ".piano-key"),
    null,
  );
  assert.equal(resolveKeyElementFromPoint(null, 10, 20, ".piano-key"), null);
});

test("shadow-claw-daw-midi-keyboard: pointer drag glissando transitions notes cleanly across keys, gaps, and multi-touch", () => {
  const key59 = createMockKey({ selector: ".piano-key", pitch: 59 });
  const key60 = createMockKey({ selector: ".piano-key", pitch: 60 });
  const key61 = createMockKey({ selector: ".piano-key", pitch: 61 });
  const key62 = createMockKey({ selector: ".piano-key", pitch: 62 });
  const key64 = createMockKey({ selector: ".piano-key", pitch: 64 });
  const keys = [key59, key60, key61, key62, key64];
  const stripEl = {
    closest: (sel) => (sel === ".keys-strip" ? stripEl : null),
  };

  const hitByX = (x) => {
    if (x >= 0 && x < 20) return key59;
    if (x >= 20 && x < 40) return key60;
    if (x >= 40 && x < 60) return key61;
    if (x >= 60 && x < 80) return key62;
    if (x >= 80 && x < 90) return stripEl; // gap / non-key strip
    if (x >= 90 && x < 110) return key64;
    return null;
  };

  const root = createMockShadowRoot({ keys, hitTest: (x) => hitByX(x) });
  const kbd = new ShadowClawDawMidiKeyboard();
  kbd.shadowRoot = root;
  kbd._bindEvents();

  const events = [];
  const origNoteOn = scdaw.midi.software.noteOn;
  const origNoteOff = scdaw.midi.software.noteOff;
  scdaw.midi.software.noteOn = (pitch, vel) =>
    events.push({ type: "on", pitch, vel });
  scdaw.midi.software.noteOff = (pitch) => events.push({ type: "off", pitch });

  try {
    // 1. Single-pointer glissando: C4 (60) -> same key no-op -> C#4 (61) -> D4 (62) -> up
    root.dispatch("pointerdown", {
      pointerId: 1,
      button: 0,
      target: key60,
      clientX: 30,
      clientY: 20,
    });
    assert.deepEqual(key60.capturedPointers, [1]);
    assert.equal(key60.getAttribute("aria-pressed"), "true");
    assert.deepEqual(events, [{ type: "on", pitch: 60, vel: 0.8 }]);

    // Move within C4 -> no-op
    root.dispatch("pointermove", {
      pointerId: 1,
      pointerType: "touch",
      clientX: 35,
      clientY: 22,
    });
    assert.equal(events.length, 1);

    // Move onto C#4 (61)
    root.dispatch("pointermove", {
      pointerId: 1,
      pointerType: "touch",
      clientX: 50,
      clientY: 22,
    });
    assert.deepEqual(events.slice(1), [
      { type: "off", pitch: 60 },
      { type: "on", pitch: 61, vel: 0.8 },
    ]);
    assert.equal(key60.getAttribute("aria-pressed"), "false");
    assert.equal(key61.getAttribute("aria-pressed"), "true");

    // Move onto D4 (62)
    root.dispatch("pointermove", {
      pointerId: 1,
      pointerType: "touch",
      clientX: 70,
      clientY: 22,
    });
    assert.deepEqual(events.slice(3), [
      { type: "off", pitch: 61 },
      { type: "on", pitch: 62, vel: 0.8 },
    ]);
    assert.equal(key61.getAttribute("aria-pressed"), "false");
    assert.equal(key62.getAttribute("aria-pressed"), "true");

    // Release pointer
    root.dispatch("pointerup", { pointerId: 1 });
    assert.deepEqual(events.slice(5), [{ type: "off", pitch: 62 }]);
    assert.equal(key62.getAttribute("aria-pressed"), "false");

    // 2. Gap / off-strip continuity: C4 (60) -> gap (.keys-strip) -> outside (null) -> E4 (64) -> up
    events.length = 0;
    root.dispatch("pointerdown", {
      pointerId: 2,
      button: 0,
      target: key60,
      clientX: 25,
      clientY: 20,
    });
    root.dispatch("pointermove", {
      pointerId: 2,
      pointerType: "touch",
      clientX: 85,
      clientY: 20,
    });
    assert.equal(key60.getAttribute("aria-pressed"), "false");
    assert.deepEqual(events, [
      { type: "on", pitch: 60, vel: 0.8 },
      { type: "off", pitch: 60 },
    ]);

    root.dispatch("pointermove", {
      pointerId: 2,
      pointerType: "touch",
      clientX: 200,
      clientY: 20,
    });
    assert.equal(events.length, 2);

    root.dispatch("pointermove", {
      pointerId: 2,
      pointerType: "touch",
      clientX: 95,
      clientY: 20,
    });
    assert.equal(key64.getAttribute("aria-pressed"), "true");
    assert.deepEqual(events.slice(2), [{ type: "on", pitch: 64, vel: 0.8 }]);

    root.dispatch("pointerup", { pointerId: 2 });
    assert.equal(key64.getAttribute("aria-pressed"), "false");
    assert.deepEqual(events.slice(3), [{ type: "off", pitch: 64 }]);

    // 3. Multi-touch shared-pitch protection:
    // Pointer 10 holds C4 (60); Pointer 11 presses B3 (59), drags onto C4 (60), then onto D4 (62)
    events.length = 0;
    root.dispatch("pointerdown", {
      pointerId: 10,
      button: 0,
      target: key60,
      clientX: 25,
      clientY: 20,
    });
    root.dispatch("pointerdown", {
      pointerId: 11,
      button: 0,
      target: key59,
      clientX: 10,
      clientY: 20,
    });
    root.dispatch("pointermove", {
      pointerId: 11,
      pointerType: "touch",
      clientX: 30,
      clientY: 20,
    });
    root.dispatch("pointermove", {
      pointerId: 11,
      pointerType: "touch",
      clientX: 70,
      clientY: 20,
    });

    // Moving Pointer 11 off C4 (60) must NOT send noteOff(60) while Pointer 10 holds it
    assert.equal(
      events.some((e) => e.type === "off" && e.pitch === 60),
      false,
    );
    assert.equal(key60.getAttribute("aria-pressed"), "true");
    assert.equal(key62.getAttribute("aria-pressed"), "true");

    root.dispatch("pointerup", { pointerId: 11 });
    assert.equal(key60.getAttribute("aria-pressed"), "true");
    root.dispatch("pointerup", { pointerId: 10 });
    assert.equal(key60.getAttribute("aria-pressed"), "false");
    assert.equal(
      events.filter((e) => e.type === "off" && e.pitch === 60).length,
      1,
    );

    // 4. Hold mode skips glissando
    events.length = 0;
    kbd._holdMode = true;
    root.dispatch("pointerdown", {
      pointerId: 12,
      button: 0,
      target: key60,
      clientX: 25,
      clientY: 20,
    });
    root.dispatch("pointermove", {
      pointerId: 12,
      pointerType: "touch",
      clientX: 70,
      clientY: 20,
    });
    assert.deepEqual(events, [{ type: "on", pitch: 60, vel: 0.8 }]);
    assert.equal(key60.getAttribute("aria-pressed"), "true");
    assert.equal(key62.getAttribute("aria-pressed"), "false");
    kbd._holdMode = false;
    kbd._releaseAllPointers();

    // 5. Non-primary button ignored; lostpointercapture & mouse buttons=0 end drag cleanly
    events.length = 0;
    root.dispatch("pointerdown", {
      pointerId: 20,
      button: 2,
      target: key60,
      clientX: 25,
      clientY: 20,
    });
    assert.equal(events.length, 0);

    // lostpointercapture releases active pointer if pointerup never arrived
    root.dispatch("pointerdown", {
      pointerId: 21,
      button: 0,
      target: key60,
      clientX: 25,
      clientY: 20,
    });
    root.dispatch("lostpointercapture", { pointerId: 21 });
    assert.deepEqual(events, [
      { type: "on", pitch: 60, vel: 0.8 },
      { type: "off", pitch: 60 },
    ]);
    // Subsequent lostpointercapture or duplicate after pointerup is a no-op
    root.dispatch("lostpointercapture", { pointerId: 21 });
    assert.equal(events.length, 2);

    // Mouse pointermove with buttons === 0 ends the drag and sends noteOff
    events.length = 0;
    root.dispatch("pointerdown", {
      pointerId: 22,
      button: 0,
      target: key60,
      clientX: 25,
      clientY: 20,
    });
    root.dispatch("pointermove", {
      pointerId: 22,
      pointerType: "mouse",
      buttons: 0,
      clientX: 50,
      clientY: 20,
    });
    assert.deepEqual(events, [
      { type: "on", pitch: 60, vel: 0.8 },
      { type: "off", pitch: 60 },
    ]);
    assert.equal(key60.getAttribute("aria-pressed"), "false");
  } finally {
    scdaw.midi.software.noteOn = origNoteOn;
    scdaw.midi.software.noteOff = origNoteOff;
  }
});

test("shadow-claw-daw-midi-keyboard: CSS includes Safari user-select fallback, preserves touch-action rules, and avoids :active stickiness", async () => {
  const src = await fs.readFile(
    ".agents/scripts/components/shadow-claw-daw-midi-keyboard.js",
    "utf8",
  );
  assert.match(src, /-webkit-user-select:\s*none;\s*\n\s*user-select:\s*none;/);
  assert.match(src, /\.keys-strip\s*\{[^}]*touch-action:\s*pan-x/);
  assert.match(src, /\.piano-key\s*\{[^}]*touch-action:\s*none/);
  assert.doesNotMatch(src, /\.piano-key:active/);
  assert.doesNotMatch(src, /\.piano-key--black:active/);
});

test("shadow-claw-daw-editor: Piano Roll .pr-key audition supports drag glissando, click deduplication, keyboard activation, and CSS rules", async () => {
  const key60 = createMockKey({ selector: ".pr-key[data-pitch]", pitch: 60 });
  const key62 = createMockKey({ selector: ".pr-key[data-pitch]", pitch: 62 });
  const key64 = createMockKey({ selector: ".pr-key[data-pitch]", pitch: 64 });
  const keys = [key60, key62, key64];

  const hitByY = (y) => {
    if (y >= 0 && y < 22) return key60;
    if (y >= 22 && y < 44) return key62;
    if (y >= 44 && y < 66) return key64;
    return null;
  };

  const root = createMockShadowRoot({ keys, hitTest: (_x, y) => hitByY(y) });
  const gridListeners = new Map();
  const gridArea = {
    addEventListener(type, fn) {
      if (!gridListeners.has(type)) gridListeners.set(type, []);
      gridListeners.get(type).push(fn);
    },
    dispatch(type, event) {
      for (const fn of gridListeners.get(type) || []) {
        fn(event);
      }
    },
  };

  assert.equal(resolvePianoRollKeyFromPoint(root, 10, 10), key60);
  assert.equal(resolvePianoRollKeyFromPoint(root, 10, 100), null);

  const previews = [];
  let activeTrackId = "trk_synth_1";
  setupPianoRollKeyAudition(gridArea, {
    root,
    getTrackId: () => activeTrackId,
    previewNote: (trackId, pitch, velocity, duration) => {
      previews.push({ trackId, pitch, velocity, duration });
    },
  });

  // 1. Single pointer click -> auditions ONCE on pointerdown, trailing click suppressed
  gridArea.dispatch("pointerdown", {
    pointerId: 1,
    button: 0,
    target: key60,
    clientX: 10,
    clientY: 10,
  });
  assert.deepEqual(key60.capturedPointers, [1]);
  assert.equal(key60.getAttribute("aria-pressed"), "true");
  gridArea.dispatch("pointerup", { pointerId: 1 });
  assert.equal(key60.getAttribute("aria-pressed"), "false");
  gridArea.dispatch("click", { target: key60, preventDefault() {} });
  assert.deepEqual(previews, [
    { trackId: "trk_synth_1", pitch: 60, velocity: 0.85, duration: 240 },
  ]);

  // 2. Drag glissando across keys -> C4 -> C4 (no dup) -> D4 -> outside -> E4 -> up
  previews.length = 0;
  gridArea.dispatch("pointerdown", {
    pointerId: 2,
    button: 0,
    target: key60,
    clientX: 10,
    clientY: 10,
  });
  gridArea.dispatch("pointermove", {
    pointerId: 2,
    pointerType: "touch",
    clientX: 12,
    clientY: 12,
  });
  assert.equal(previews.length, 1);

  gridArea.dispatch("pointermove", {
    pointerId: 2,
    pointerType: "touch",
    clientX: 12,
    clientY: 30,
  });
  assert.equal(key60.getAttribute("aria-pressed"), "false");
  assert.equal(key62.getAttribute("aria-pressed"), "true");
  assert.equal(previews.length, 2);
  assert.equal(previews[1].pitch, 62);

  gridArea.dispatch("pointermove", {
    pointerId: 2,
    pointerType: "touch",
    clientX: 12,
    clientY: 120,
  });
  assert.equal(key62.getAttribute("aria-pressed"), "false");
  assert.equal(previews.length, 2);

  gridArea.dispatch("pointermove", {
    pointerId: 2,
    pointerType: "touch",
    clientX: 12,
    clientY: 50,
  });
  assert.equal(key64.getAttribute("aria-pressed"), "true");
  assert.equal(previews.length, 3);
  assert.equal(previews[2].pitch, 64);

  gridArea.dispatch("pointerup", { pointerId: 2 });
  assert.equal(key64.getAttribute("aria-pressed"), "false");

  // 3. After dragging C4 -> D4 and releasing on D4, a subsequent programmatic / screen-reader click on C4 still auditions C4
  previews.length = 0;
  gridArea.dispatch("pointerdown", {
    pointerId: 3,
    button: 0,
    target: key60,
    clientX: 10,
    clientY: 10,
  });
  gridArea.dispatch("pointermove", {
    pointerId: 3,
    pointerType: "mouse",
    buttons: 1,
    clientX: 10,
    clientY: 30,
  });
  gridArea.dispatch("pointerup", { pointerId: 3 });
  gridArea.dispatch("click", { target: key60, preventDefault() {} });
  assert.deepEqual(
    previews.map((p) => p.pitch),
    [60, 62, 60],
  );

  // 4. Keyboard Enter and Space audition
  previews.length = 0;
  gridArea.dispatch("keydown", {
    key: "Enter",
    target: key62,
    preventDefault() {},
  });
  gridArea.dispatch("keydown", {
    key: " ",
    target: key64,
    preventDefault() {},
  });
  assert.deepEqual(
    previews.map((p) => p.pitch),
    [62, 64],
  );

  // 5. Non-primary button ignored; lostpointercapture / pointercancel / mouse buttons=0 clear aria-pressed
  previews.length = 0;
  gridArea.dispatch("pointerdown", {
    pointerId: 4,
    button: 2,
    target: key60,
    clientX: 10,
    clientY: 10,
  });
  assert.equal(previews.length, 0);

  gridArea.dispatch("pointerdown", {
    pointerId: 5,
    button: 0,
    target: key60,
    clientX: 10,
    clientY: 10,
  });
  assert.equal(key60.getAttribute("aria-pressed"), "true");
  gridArea.dispatch("pointercancel", { pointerId: 5 });
  assert.equal(key60.getAttribute("aria-pressed"), "false");

  gridArea.dispatch("pointerdown", {
    pointerId: 6,
    button: 0,
    target: key62,
    clientX: 10,
    clientY: 30,
  });
  assert.equal(key62.getAttribute("aria-pressed"), "true");
  gridArea.dispatch("lostpointercapture", { pointerId: 6 });
  assert.equal(key62.getAttribute("aria-pressed"), "false");

  gridArea.dispatch("pointerdown", {
    pointerId: 7,
    button: 0,
    target: key64,
    clientX: 10,
    clientY: 50,
  });
  assert.equal(key64.getAttribute("aria-pressed"), "true");
  gridArea.dispatch("pointermove", {
    pointerId: 7,
    pointerType: "mouse",
    buttons: 0,
    clientX: 10,
    clientY: 30,
  });
  assert.equal(key64.getAttribute("aria-pressed"), "false");
  assert.equal(key62.getAttribute("aria-pressed"), "false");

  // 6. CSS checks
  const editorSrc = await fs.readFile(
    ".agents/scripts/components/shadow-claw-daw-editor.js",
    "utf8",
  );
  assert.match(
    editorSrc,
    /\.pr-key\s*\{[^}]*-webkit-user-select:\s*none;\s*\n\s*user-select:\s*none;/,
  );
  assert.match(
    editorSrc,
    /\.pr-key\[data-pitch\]\s*\{[^}]*cursor:\s*pointer;[^}]*touch-action:\s*none;/,
  );
});

test("shadow-claw-daw-midi-keyboard: buildPianoKeys and render() expose QWERTY shortcuts, layout toggle, and dynamic hint", () => {
  const abletonKeys = buildPianoKeys(4, 2, "ableton");
  assert.equal(abletonKeys.length, 24);
  assert.equal(abletonKeys[0].shortcut, "A");
  assert.equal(abletonKeys[1].shortcut, "W");
  assert.equal(abletonKeys[17].shortcut, "'");
  assert.equal(abletonKeys[18].shortcut, null);

  const twoOctKeys = buildPianoKeys(4, 2, "two-octave");
  assert.equal(twoOctKeys.length, 24);
  assert.equal(twoOctKeys[0].shortcut, "Z");
  assert.equal(twoOctKeys[12].shortcut, "Q");
  assert.equal(twoOctKeys[23].shortcut, "U");

  const kbd = new ShadowClawDawMidiKeyboard();
  kbd.shadowRoot = {
    innerHTML: "",
    querySelectorAll: () => [],
  };
  kbd.render();

  assert.match(kbd.shadowRoot.innerHTML, /id="layout-btn"/);
  assert.match(kbd.shadowRoot.innerHTML, /aria-pressed="false"/);
  assert.match(kbd.shadowRoot.innerHTML, /aria-keyshortcuts="A"/);
  assert.match(
    kbd.shadowRoot.innerHTML,
    /<span class="piano-key__shortcut" aria-hidden="true">A<\/span>/,
  );
  assert.match(
    kbd.shadowRoot.innerHTML,
    /<span class="kbd-hint">QWERTY: A–' · Z\/X Oct<\/span>/,
  );

  kbd._keyLayout = "two-octave";
  kbd.render();
  assert.match(
    kbd.shadowRoot.innerHTML,
    /id="layout-btn"[^>]*aria-pressed="true"/,
  );
  assert.match(kbd.shadowRoot.innerHTML, /aria-keyshortcuts="U"/);
  assert.match(
    kbd.shadowRoot.innerHTML,
    /<span class="kbd-hint">QWERTY: Z–M \/ Q–U · -\/= Oct<\/span>/,
  );
});

test("shadow-claw-daw-midi-keyboard: QWERTY key playback, Z/X and -/= octave shift, layout toggle, Hold mode, and close cleanup", () => {
  const keys = buildPianoKeys(4, 2, "ableton").map((k) =>
    createMockKey({ selector: ".piano-key", pitch: k.pitch }),
  );
  const root = createMockShadowRoot({ keys, hitTest: () => null });
  root.innerHTML = "";
  const dispatched = [];

  const kbd = new ShadowClawDawMidiKeyboard();
  kbd.shadowRoot = root;
  kbd.dispatchEvent = (evt) => dispatched.push(evt);
  kbd._bindEvents();

  const sw = scdaw.midi.software;
  const events = [];
  const origNoteOn = sw.noteOn.bind(sw);
  const origNoteOff = sw.noteOff.bind(sw);
  sw.noteOn = (pitch, vel) => {
    events.push({ type: "on", pitch, vel });
    return origNoteOn(pitch, vel);
  };
  sw.noteOff = (pitch) => {
    events.push({ type: "off", pitch });
    return origNoteOff(pitch);
  };

  try {
    sw.setOctave(4);
    sw.setKeyLayout("ableton");

    // 1. Mapped QWERTY key plays, calls preventDefault, and releases cleanly; unmapped key does not call preventDefault
    let prevented = false;
    assert.equal(
      kbd.handleQwertyKeyDown({
        key: "a",
        code: "KeyA",
        repeat: false,
        preventDefault: () => {
          prevented = true;
        },
      }),
      true,
    );
    assert.equal(prevented, true);
    assert.equal(events.length, 1);
    assert.equal(events[0].pitch, 60);

    kbd.handleQwertyKeyUp({ key: "a", code: "KeyA" });
    assert.equal(events.length, 2);
    assert.deepEqual(events[1], { type: "off", pitch: 60 });

    let unmappedPrevented = false;
    assert.equal(
      kbd.handleQwertyKeyDown({
        key: "1",
        code: "Digit1",
        repeat: false,
        preventDefault: () => {
          unmappedPrevented = true;
        },
      }),
      false,
    );
    assert.equal(unmappedPrevented, false);

    // 2. Z / X shift octave in ableton layout and sync kbd._octave + software octave + render
    let octPrevented = false;
    assert.equal(
      kbd.handleQwertyKeyDown({
        key: "x",
        code: "KeyX",
        repeat: false,
        preventDefault: () => {
          octPrevented = true;
        },
      }),
      true,
    );
    assert.equal(octPrevented, true);
    assert.equal(kbd._octave, 5);
    assert.equal(sw.octave, 5);
    assert.match(root.innerHTML, /Oct 5/);

    assert.equal(
      kbd.handleQwertyKeyDown({
        key: "z",
        code: "KeyZ",
        repeat: false,
        preventDefault() {},
      }),
      true,
    );
    assert.equal(kbd._octave, 4);
    assert.equal(sw.octave, 4);
    assert.match(root.innerHTML, /Oct 4/);

    // 3. Clicking #layout-btn toggles ableton <-> two-octave and updates software layout & keycaps
    const layoutBtn = {
      id: "layout-btn",
      closest: (sel) => (sel === "button" ? layoutBtn : null),
    };
    root.dispatch("click", { target: layoutBtn });
    assert.equal(kbd._keyLayout, "two-octave");
    assert.equal(sw.keyLayout, "two-octave");
    assert.match(root.innerHTML, /aria-keyshortcuts="Z"/);

    // In two-octave layout, - and = shift octave while Z plays C4 (60)
    assert.equal(
      kbd.handleQwertyKeyDown({
        key: "=",
        code: "Equal",
        repeat: false,
        preventDefault() {},
      }),
      true,
    );
    assert.equal(kbd._octave, 5);
    assert.equal(
      kbd.handleQwertyKeyDown({
        key: "-",
        code: "Minus",
        repeat: false,
        preventDefault() {},
      }),
      true,
    );
    assert.equal(kbd._octave, 4);

    // 4. Hold mode latches/unlatches QWERTY notes, ignores repeat, and ignores keyup while latched
    events.length = 0;
    kbd._holdMode = true;
    assert.equal(
      kbd.handleQwertyKeyDown({
        key: "z",
        code: "KeyZ",
        repeat: false,
        preventDefault() {},
      }),
      true,
    );
    assert.equal(kbd._latchedPitches.has(60), true);
    assert.equal(events.length, 1);

    // Repeat ignored in hold mode
    assert.equal(
      kbd.handleQwertyKeyDown({
        key: "z",
        code: "KeyZ",
        repeat: true,
        preventDefault() {},
      }),
      true,
    );
    assert.equal(kbd._latchedPitches.has(60), true);
    assert.equal(events.length, 1);

    // Keyup does NOT release latched note
    kbd.handleQwertyKeyUp({ key: "z", code: "KeyZ" });
    assert.equal(kbd._latchedPitches.has(60), true);
    assert.equal(events.length, 1);

    // Pressing Z again unlatches and sends noteOff
    kbd.handleQwertyKeyDown({
      key: "z",
      code: "KeyZ",
      repeat: false,
      preventDefault() {},
    });
    assert.equal(kbd._latchedPitches.has(60), false);
    assert.deepEqual(events[1], { type: "off", pitch: 60 });

    // 5. releaseTransientNotes releases active pointers & held QWERTY keys without killing latched Hold notes
    events.length = 0;
    kbd.handleQwertyKeyDown({
      key: "z",
      code: "KeyZ",
      repeat: false,
      preventDefault() {},
    }); // latch 60
    kbd._holdMode = false;
    kbd.handleQwertyKeyDown({
      key: "q",
      code: "KeyQ",
      repeat: false,
      preventDefault() {},
    }); // held QWERTY 72
    root.dispatch("pointerdown", {
      pointerId: 9,
      button: 0,
      target: keys[2], // D4 (62)
      clientX: 0,
      clientY: 0,
    });
    kbd.releaseTransientNotes();
    assert.equal(kbd._latchedPitches.has(60), true);
    assert.equal(sw._heldKeys.size, 0);
    assert.equal(kbd._activePointers.size, 0);
    assert.equal(
      events.some((e) => e.type === "off" && e.pitch === 72),
      true,
    );
    assert.equal(
      events.some((e) => e.type === "off" && e.pitch === 62),
      true,
    );
    assert.equal(
      events.some((e) => e.type === "off" && e.pitch === 60),
      false,
    );

    // 6. Clicking #close-btn hides keyboard, releases transient notes, and dispatches "close"
    kbd.handleQwertyKeyDown({
      key: "q",
      code: "KeyQ",
      repeat: false,
      preventDefault() {},
    });
    const closeBtn = {
      id: "close-btn",
      closest: (sel) => (sel === "button" ? closeBtn : null),
    };
    root.dispatch("click", { target: closeBtn });
    assert.equal(kbd.hidden, true);
    assert.equal(sw._heldKeys.size, 0);
    assert.equal(
      dispatched.some((evt) => evt.type === "close"),
      true,
    );
  } finally {
    kbd._releaseAllPointers();
    sw.releaseAll();
    sw.setOctave(4);
    sw.setKeyLayout("ableton");
    sw.noteOn = origNoteOn;
    sw.noteOff = origNoteOff;
  }
});

test("shadow-claw-daw-workbench: setupWorkbenchMidiKeyboard routes QWERTY events safely, handles blur/close sync, and disposes cleanly", () => {
  const mkTarget = () => {
    const map = new Map();
    return {
      listeners: map,
      addEventListener(type, fn) {
        if (!map.has(type)) map.set(type, []);
        map.get(type).push(fn);
      },
      removeEventListener(type, fn) {
        if (!map.has(type)) return;
        map.set(
          type,
          map.get(type).filter((f) => f !== fn),
        );
      },
      dispatch(type, event) {
        for (const fn of [...(map.get(type) || [])]) {
          fn(event);
        }
      },
    };
  };

  const windowObj = mkTarget();
  const keysBtnAttrs = { "aria-pressed": "true" };
  const keysBtn = {
    getAttribute: (name) => keysBtnAttrs[name] ?? null,
    setAttribute: (name, val) => {
      keysBtnAttrs[name] = String(val);
    },
  };
  const transport = {
    shadowRoot: {
      getElementById: (id) => (id === "keys-btn" ? keysBtn : null),
    },
  };

  const calls = { down: [], up: [], transient: 0 };
  const kbd = {
    hidden: true,
    handleQwertyKeyDown: (e) => {
      calls.down.push(e);
      return true;
    },
    handleQwertyKeyUp: (e) => {
      calls.up.push(e);
    },
    releaseTransientNotes: () => {
      calls.transient++;
    },
  };

  const shadowRoot = {
    ...mkTarget(),
    getElementById: (id) => (id === "midi-keyboard" ? kbd : null),
    querySelector: (sel) =>
      sel === "shadow-claw-daw-transport" ? transport : null,
  };

  const controller = setupWorkbenchMidiKeyboard({ shadowRoot, windowObj });

  // 1. Ignored while hidden
  windowObj.dispatch("keydown", {
    key: "a",
    code: "KeyA",
    composedPath: () => [{ tagName: "BODY" }],
  });
  assert.equal(calls.down.length, 0);

  // 2. toggle-midi-keyboard opens keyboard
  shadowRoot.dispatch("toggle-midi-keyboard", { detail: { visible: true } });
  assert.equal(kbd.hidden, false);

  // 3. Modifiers, editable targets, and dialogs are ignored
  windowObj.dispatch("keydown", {
    key: "a",
    code: "KeyA",
    ctrlKey: true,
    composedPath: () => [{ tagName: "BODY" }],
  });
  windowObj.dispatch("keydown", {
    key: "a",
    code: "KeyA",
    metaKey: true,
    composedPath: () => [{ tagName: "BODY" }],
  });
  windowObj.dispatch("keydown", {
    key: "a",
    code: "KeyA",
    altKey: true,
    composedPath: () => [{ tagName: "BODY" }],
  });
  windowObj.dispatch("keydown", {
    key: "a",
    code: "KeyA",
    composedPath: () => [{ tagName: "INPUT" }],
  });
  windowObj.dispatch("keydown", {
    key: "a",
    code: "KeyA",
    composedPath: () => [{ tagName: "DIV", isContentEditable: true }],
  });
  windowObj.dispatch("keydown", {
    key: "a",
    code: "KeyA",
    composedPath: () => [{ tagName: "BUTTON" }, { tagName: "DIALOG" }],
  });
  assert.equal(calls.down.length, 0);

  // 4. Valid keydown forwards to kbd.handleQwertyKeyDown
  windowObj.dispatch("keydown", {
    key: "a",
    code: "KeyA",
    composedPath: () => [{ tagName: "BUTTON" }],
  });
  assert.equal(calls.down.length, 1);

  // 5. keyup still forwards even if kbd just became hidden so releases are never dropped
  kbd.hidden = true;
  windowObj.dispatch("keyup", { key: "a", code: "KeyA" });
  assert.equal(calls.up.length, 1);

  // 6. window blur and toggle hidden release transient notes
  windowObj.dispatch("blur", {});
  assert.equal(calls.transient, 1);
  shadowRoot.dispatch("toggle-midi-keyboard", { detail: { visible: false } });
  assert.equal(kbd.hidden, true);
  assert.equal(calls.transient, 2);

  // 7. Keyboard "close" event syncs shadow-claw-daw-transport #keys-btn aria-pressed="false"
  shadowRoot.dispatch("close", { target: kbd });
  assert.equal(keysBtn.getAttribute("aria-pressed"), "false");

  // 8. dispose() removes all window & shadowRoot listeners
  controller.dispose();
  assert.equal(windowObj.listeners.get("keydown").length, 0);
  assert.equal(windowObj.listeners.get("keyup").length, 0);
  assert.equal(windowObj.listeners.get("blur").length, 0);
  assert.equal(shadowRoot.listeners.get("toggle-midi-keyboard").length, 0);
  assert.equal(shadowRoot.listeners.get("close").length, 0);
});
