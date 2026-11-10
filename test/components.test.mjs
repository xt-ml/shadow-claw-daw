import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { SHARED_STYLES } from "../.agents/scripts/components/scdaw-styles.js";
import {
  mapNormalizedToValue,
  mapValueToNormalized,
  formatValueWithUnit,
} from "../.agents/scripts/components/scdaw-knob.js";
import { filterBrowserItems } from "../.agents/scripts/components/scdaw-browser.js";
import {
  computeTimelineTicks,
  computeClipOverlapLayout,
  calculateClipDragPosition,
  calculateClipResize,
  calculateClipKeyboardNudge,
  setupClipInteraction,
} from "../.agents/scripts/components/scdaw-timeline.js";
import {
  pitchToPianoRollRow,
  pianoRollRowToPitch,
  computeCellActiveMap,
  shouldPreserveEditorDom,
  resolveEditorScrollPosition,
  computeStepVelocity,
  calculateVelocityFromPointer,
} from "../.agents/scripts/components/scdaw-editor.js";
import { getDeviceChainForTrack } from "../.agents/scripts/components/scdaw-devices.js";
import {
  computeMeterSegments,
  formatDb,
  calculateSliderValueFromPointer,
  calculateSliderValueFromWheel,
  shouldPreserveMixerDom,
  setupVolumeSlider,
} from "../.agents/scripts/components/scdaw-mixer.js";
import {
  formatPosition,
  calculateTransportWheelValue,
  setupTransportWheelControls,
  calculateBpmDragValue,
  setupBpmDragControl,
  shouldPromptRecordOptions,
} from "../.agents/scripts/components/scdaw-transport.js";
import { formatTelemetryStatus } from "../.agents/scripts/components/scdaw-statusbar.js";
import {
  resolveWorkbenchPanels,
  resolveWorkbenchResponsiveLayout,
  resolveDropAction,
} from "../.agents/scripts/components/scdaw-workbench.js";
import {
  clampSize,
  computeKeyboardResize,
  getAriaAttributes,
} from "../.agents/scripts/components/scdaw-resize-handle.js";

test("scdaw-knob: maps normalized 0-1 range to linear and exponential values accurately", () => {
  // Linear volume fader (0 to 1.5)
  assert.equal(mapNormalizedToValue(0.0, 0, 1.5, "linear"), 0);
  assert.equal(mapNormalizedToValue(1.0, 0, 1.5, "linear"), 1.5);
  assert.equal(mapNormalizedToValue(0.5, 0, 1.5, "linear"), 0.75);
  assert.equal(mapValueToNormalized(0.75, 0, 1.5, "linear"), 0.5);

  // Exponential frequency sweep (20 Hz to 20000 Hz)
  const midFreq = mapNormalizedToValue(0.5, 20, 20000, "exponential");
  // Middle of exponential range is sqrt(20 * 20000) = sqrt(400000) ~ 632.45 Hz
  assert.ok(Math.abs(midFreq - 632.45) < 2);
  const backToNorm = mapValueToNormalized(midFreq, 20, 20000, "exponential");
  assert.ok(Math.abs(backToNorm - 0.5) < 0.01);

  // Formats values with units
  assert.equal(formatValueWithUnit(1200, "Hz"), "1200 Hz");
  assert.equal(formatValueWithUnit(0.15, "s"), "150 ms");
  assert.equal(formatValueWithUnit(-6, "dB"), "-6 dB");
});

test("scdaw-browser: filters presets, instruments, and FX items by category tab and query", () => {
  const items = [
    { id: "p1", name: "Techno Bass", type: "preset", category: "Bass" },
    { id: "p2", name: "Pop Pluck", type: "preset", category: "Pluck" },
    { id: "d1", name: "Vaporisateur", type: "device", category: "Instrument" },
    { id: "d2", name: "Fold", type: "device", category: "Audio FX" },
    { id: "s1", name: "909 Kick", type: "sample", category: "Drums" },
  ];

  // Tab filter: presets
  const presetsOnly = filterBrowserItems(items, "", "presets");
  assert.equal(presetsOnly.length, 2);
  assert.equal(presetsOnly[0].id, "p1");

  // Tab filter: devices
  const devicesOnly = filterBrowserItems(items, "", "devices");
  assert.equal(devicesOnly.length, 2);

  // Search query filter
  const queryMatch = filterBrowserItems(items, "bass", "all");
  assert.equal(queryMatch.length, 1);
  assert.equal(queryMatch[0].name, "Techno Bass");
});

test("scdaw-timeline: computes timeline bars and beat ticks based on signature", () => {
  const ticks = computeTimelineTicks(2, [4, 4]);
  assert.equal(ticks.length, 8); // 2 bars * 4 quarter beats = 8 ticks
  assert.equal(ticks[0].bar, 1);
  assert.equal(ticks[0].beat, 1);
  assert.equal(ticks[4].bar, 2);
  assert.equal(ticks[4].beat, 1);
});

test("scdaw-timeline: calculateClipDragPosition moves and snaps clip to beats with shift-key fine tuning", () => {
  // 400px lane, 16 beats total = 25px per beat
  const laneWidth = 400;
  const totalBeats = 16;

  // Move right +50px = +2 beats from beat 2 -> 4
  const pos1 = calculateClipDragPosition({
    startBeat: 2,
    deltaX: 50,
    laneWidth,
    totalBeats,
  });
  assert.equal(pos1, 4);

  // Move left -25px = -1 beat from beat 2 -> 1
  const pos2 = calculateClipDragPosition({
    startBeat: 2,
    deltaX: -25,
    laneWidth,
    totalBeats,
  });
  assert.equal(pos2, 1);

  // Clamp at beginning (0)
  const pos3 = calculateClipDragPosition({
    startBeat: 2,
    deltaX: -100,
    laneWidth,
    totalBeats,
  });
  assert.equal(pos3, 0);

  // Snap to integer beat without shiftKey (+35px = +1.4 beats from beat 1 -> snaps to 2)
  const pos4 = calculateClipDragPosition({
    startBeat: 1,
    deltaX: 35,
    laneWidth,
    totalBeats,
    shiftKey: false,
  });
  assert.equal(pos4, 2);

  // Fine snap with shiftKey (+35px = +1.4 beats from beat 1 -> snaps to 2.5 with 0.25 grid)
  const pos5 = calculateClipDragPosition({
    startBeat: 1,
    deltaX: 35,
    laneWidth,
    totalBeats,
    shiftKey: true,
  });
  assert.equal(pos5, 2.5); // 1 + 1.4 = 2.4 -> rounded to nearest 0.25 is 2.5
});

test("scdaw-timeline: calculateClipResize resizes right duration and trims left start/offset", () => {
  const laneWidth = 400;
  const totalBeats = 16; // 25 px/beat

  // 1. Right edge resize: lengthen duration by 50px (+2 beats)
  const resRight1 = calculateClipResize({
    startTime: 2,
    startDuration: 4,
    startOffset: 0,
    deltaX: 50,
    laneWidth,
    totalBeats,
    edge: "right",
  });
  assert.equal(resRight1.time, 2);
  assert.equal(resRight1.duration, 6);
  assert.equal(resRight1.offset, 0);

  // 2. Right edge resize: shorten duration by 25px (-1 beat)
  const resRight2 = calculateClipResize({
    startTime: 2,
    startDuration: 4,
    startOffset: 0,
    deltaX: -25,
    laneWidth,
    totalBeats,
    edge: "right",
  });
  assert.equal(resRight2.duration, 3);

  // 3. Right edge resize: clamped to min duration (0.25)
  const resRight3 = calculateClipResize({
    startTime: 2,
    startDuration: 4,
    startOffset: 0,
    deltaX: -200,
    laneWidth,
    totalBeats,
    edge: "right",
  });
  assert.equal(resRight3.duration, 0.25);

  // 4. Left edge trim: drag right 25px (+1 beat) -> delays time, shrinks duration, advances offset
  // bpm 120 -> 0.5 sec/beat
  const resLeft1 = calculateClipResize({
    startTime: 2,
    startDuration: 4,
    startOffset: 0,
    deltaX: 25,
    laneWidth,
    totalBeats,
    edge: "left",
    bpm: 120,
  });
  assert.equal(resLeft1.time, 3);
  assert.equal(resLeft1.duration, 3);
  assert.equal(resLeft1.offset, 0.5);

  // 5. Left edge trim: drag left 25px (-1 beat) -> earlier time, larger duration, decrements offset
  const resLeft2 = calculateClipResize({
    startTime: 2,
    startDuration: 4,
    startOffset: 1.0,
    deltaX: -25,
    laneWidth,
    totalBeats,
    edge: "left",
    bpm: 120,
  });
  assert.equal(resLeft2.time, 1);
  assert.equal(resLeft2.duration, 5);
  assert.equal(resLeft2.offset, 0.5);
});

test("scdaw-timeline: calculateClipKeyboardNudge supports arrow nudging, shift fine tuning, and alt resizing", () => {
  // Move right 1 beat
  const n1 = calculateClipKeyboardNudge({
    currentBeat: 4,
    currentDuration: 2,
    key: "ArrowRight",
  });
  assert.deepEqual(n1, { action: "move", time: 5 });

  // Move left 1 beat
  const n2 = calculateClipKeyboardNudge({
    currentBeat: 4,
    currentDuration: 2,
    key: "ArrowLeft",
  });
  assert.deepEqual(n2, { action: "move", time: 3 });

  // Fine move right 0.25 beat with Shift
  const n3 = calculateClipKeyboardNudge({
    currentBeat: 4,
    currentDuration: 2,
    key: "ArrowRight",
    shiftKey: true,
  });
  assert.deepEqual(n3, { action: "move", time: 4.25 });

  // Alt + ArrowRight: resize duration +1
  const n4 = calculateClipKeyboardNudge({
    currentBeat: 4,
    currentDuration: 2,
    key: "ArrowRight",
    altKey: true,
  });
  assert.deepEqual(n4, { action: "resize", duration: 3 });

  // Alt + ArrowLeft: resize duration -1
  const n5 = calculateClipKeyboardNudge({
    currentBeat: 4,
    currentDuration: 2,
    key: "ArrowLeft",
    altKey: true,
  });
  assert.deepEqual(n5, { action: "resize", duration: 1 });

  // Home key: jump to start
  const n6 = calculateClipKeyboardNudge({
    currentBeat: 4,
    currentDuration: 2,
    key: "Home",
  });
  assert.deepEqual(n6, { action: "move", time: 0 });
});

test("scdaw-timeline: setupClipInteraction binds pointer dragging, edge resizing, and keyboard actions", () => {
  const updates = [];
  let removeCalled = false;
  const classList = new Set();
  const attributes = {};
  const styles = {};
  const listeners = {};

  const leftHandle = {
    closest: (sel) =>
      sel.includes("scdaw-timeline__clip-handle--left") ? leftHandle : null,
  };
  const rightHandle = {
    closest: (sel) =>
      sel.includes("scdaw-timeline__clip-handle--right") ? rightHandle : null,
  };

  const clipEl = {
    classList: {
      add: (cls) => classList.add(cls),
      remove: (cls) => classList.delete(cls),
      contains: (cls) => classList.has(cls),
    },
    setAttribute: (name, val) => {
      attributes[name] = val;
    },
    getAttribute: (name) => attributes[name],
    style: styles,
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    removeEventListener: (type, fn) => {
      if (listeners[type] === fn) delete listeners[type];
    },
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    closest: () => null,
  };

  const mockLane = {
    getBoundingClientRect: () => ({ width: 400 }),
  };

  const clip = {
    id: "clip_vocal_1",
    name: "Lead Vocal",
    time: 2,
    duration: 4,
    offset: 0,
  };

  const cleanup = setupClipInteraction({
    clipEl,
    laneEl: mockLane,
    clip,
    trackId: "trk_audio",
    totalBeats: 16,
    bpm: 120,
    onUpdate: (patch) => updates.push(patch),
    onRemove: () => {
      removeCalled = true;
    },
  });

  // Verify listeners were attached
  assert.ok(typeof listeners.pointerdown === "function");
  assert.ok(typeof listeners.pointermove === "function");
  assert.ok(typeof listeners.pointerup === "function");
  assert.ok(typeof listeners.keydown === "function");

  // 1. Drag move (+50px = +2 beats from beat 2 -> 4)
  listeners.pointerdown({ button: 0, clientX: 100, target: clipEl });
  assert.ok(clipEl.classList.contains("scdaw-timeline__clip--dragging"));
  listeners.pointermove({ clientX: 150 });
  assert.equal(clipEl.style.left, "25%"); // 4 / 16 * 100% = 25%
  listeners.pointerup({ clientX: 150 });
  assert.ok(!clipEl.classList.contains("scdaw-timeline__clip--dragging"));
  assert.deepEqual(updates[updates.length - 1], { time: 4 });

  // 2. Right edge resize (+50px = +2 beats duration -> 6 beats)
  listeners.pointerdown({ button: 0, clientX: 100, target: rightHandle });
  assert.ok(clipEl.classList.contains("scdaw-timeline__clip--resizing"));
  listeners.pointermove({ clientX: 150 });
  assert.equal(clipEl.style.width, "37.5%"); // 6 / 16 * 100% = 37.5%
  listeners.pointerup({ clientX: 150 });
  assert.deepEqual(updates[updates.length - 1], { duration: 6 });

  // 3. Left edge trim (+25px = +1 beat delay -> time: 3, duration: 3, offset: 0.5s at 120 BPM)
  listeners.pointerdown({ button: 0, clientX: 100, target: leftHandle });
  assert.ok(clipEl.classList.contains("scdaw-timeline__clip--resizing"));
  listeners.pointermove({ clientX: 125 });
  listeners.pointerup({ clientX: 125 });
  assert.deepEqual(updates[updates.length - 1], {
    time: 3,
    duration: 3,
    offset: 0.5,
  });

  // 4. Keyboard ArrowRight nudges position (+1 beat -> 3)
  listeners.keydown({ key: "ArrowRight", target: clipEl });
  assert.deepEqual(updates[updates.length - 1], { time: 3 });

  // 5. Keyboard Alt+ArrowRight resizes duration (+1 beat -> 5)
  listeners.keydown({ key: "ArrowRight", altKey: true, target: clipEl });
  assert.deepEqual(updates[updates.length - 1], { duration: 5 });

  // 6. Keyboard Delete triggers onRemove
  listeners.keydown({ key: "Delete", target: clipEl });
  assert.equal(removeCalled, true);

  cleanup();
  assert.equal(Object.keys(listeners).length, 0);
});

test("scdaw-editor: maps MIDI pitch to piano roll row and back", () => {
  // C4 = 60
  const rowC4 = pitchToPianoRollRow(60);
  assert.equal(pianoRollRowToPitch(rowC4), 60);

  // C2 = 36
  const rowC2 = pitchToPianoRollRow(36);
  assert.equal(pianoRollRowToPitch(rowC2), 36);
  assert.ok(
    rowC4 < rowC2,
    "higher pitch should have smaller row index (higher visually on piano roll)",
  );
});

test("scdaw-editor: computeCellActiveMap accurately indexes active notes by pitch and step", () => {
  const notes = [
    { pitch: 36, position: 0, duration: 480, velocity: 0.8 },
    { pitch: 40, position: 960, duration: 480, velocity: 0.8 }, // step 4 (960 PPQN)
  ];
  const activeMap = computeCellActiveMap(notes);
  assert.equal(activeMap.has("36:0"), true);
  assert.equal(activeMap.has("40:4"), true);
  assert.equal(activeMap.has("36:1"), false);
  assert.equal(activeMap.has("60:0"), false);
});

test("scdaw-editor: shouldPreserveEditorDom prevents tearing down DOM and resetting scroll on note edits", () => {
  // Same track, same step count, skeleton already rendered -> preserve DOM (in-place update)
  assert.equal(
    shouldPreserveEditorDom({
      renderedTrackId: "trk_bass",
      targetTrackId: "trk_bass",
      renderedSteps: 16,
      targetSteps: 16,
      hasSkeleton: true,
    }),
    true,
  );

  // Different track -> full re-render needed
  assert.equal(
    shouldPreserveEditorDom({
      renderedTrackId: "trk_bass",
      targetTrackId: "trk_lead",
      renderedSteps: 16,
      targetSteps: 16,
      hasSkeleton: true,
    }),
    false,
  );

  // Different step count (e.g. project resized) -> full re-render needed
  assert.equal(
    shouldPreserveEditorDom({
      renderedTrackId: "trk_bass",
      targetTrackId: "trk_bass",
      renderedSteps: 16,
      targetSteps: 32,
      hasSkeleton: true,
    }),
    false,
  );

  // No skeleton yet -> full render needed
  assert.equal(
    shouldPreserveEditorDom({
      renderedTrackId: null,
      targetTrackId: "trk_bass",
      renderedSteps: null,
      targetSteps: 16,
      hasSkeleton: false,
    }),
    false,
  );
});

test("scdaw-editor: resolveEditorScrollPosition preserves scroll position and centers track notes on first view", () => {
  // Existing scroll position is strictly preserved
  assert.equal(
    resolveEditorScrollPosition({
      currentScrollTop: 420,
      notes: [{ pitch: 36, position: 0 }],
      rowHeight: 22,
      viewportHeight: 340,
    }),
    420,
  );

  // If no current scroll (initial load) and track has notes at pitch 36 (C2)
  const initialScroll = resolveEditorScrollPosition({
    currentScrollTop: null,
    notes: [{ pitch: 36, position: 0 }],
    rowHeight: 22,
    viewportHeight: 340,
  });
  assert.ok(
    initialScroll > 400,
    "initial scroll should center around bass note range, not 0",
  );
});

test("scdaw-devices: constructs device chain for track (MIDI FX -> Instrument -> Audio FX)", () => {
  const track = {
    id: "trk_1",
    name: "Lead",
    kind: "synth",
    midiFx: [{ type: "arpeggio", mode: "up" }],
    params: { waveform: "sawtooth", cutoff: 1500 },
    fx: [{ type: "delay", wet: 0.3 }],
  };

  const chain = getDeviceChainForTrack(track);
  assert.equal(chain.length, 3);
  assert.equal(chain[0].role, "midi-fx");
  assert.equal(chain[0].type, "arpeggio");
  assert.equal(chain[1].role, "instrument");
  assert.equal(chain[1].type, "synth");
  assert.equal(chain[2].role, "audio-fx");
  assert.equal(chain[2].type, "delay");
});

test("scdaw-mixer: computes 12-segment meter levels and formats decibels", () => {
  // Clipping / 0 dB
  const topSegments = computeMeterSegments(0, 12);
  assert.equal(topSegments.litCount, 12);
  assert.equal(topSegments.isClipping, false);

  // -12 dB (should light around 9 segments out of 12 for -48 to 0 dB range)
  const midSegments = computeMeterSegments(-12, 12);
  assert.ok(midSegments.litCount >= 8 && midSegments.litCount <= 10);

  // -100 dB (silence)
  const silentSegments = computeMeterSegments(-100, 12);
  assert.equal(silentSegments.litCount, 0);

  // Format dB
  assert.equal(formatDb(0), "0.0 dB");
  assert.equal(formatDb(-6.02), "-6.0 dB");
  assert.equal(formatDb(-100), "-∞ dB");
});

test("scdaw-mixer: calculateSliderValueFromPointer computes vertical fader level from pointer coordinate accurately", () => {
  const rect = { top: 100, bottom: 220, height: 120 };
  // Track volume fader (min 0, max 150)
  // Clicking top (clientY = 100) -> max 150
  assert.equal(
    calculateSliderValueFromPointer({
      clientY: 100,
      rect,
      min: 0,
      max: 150,
      padding: 8,
    }),
    150,
  );
  // Clicking bottom (clientY = 220) -> min 0
  assert.equal(
    calculateSliderValueFromPointer({
      clientY: 220,
      rect,
      min: 0,
      max: 150,
      padding: 8,
    }),
    0,
  );
  // Center (clientY = 160) -> 75
  assert.equal(
    calculateSliderValueFromPointer({
      clientY: 160,
      rect,
      min: 0,
      max: 150,
      padding: 8,
    }),
    75,
  );
  // Dragging above top (clientY = 50) -> clamps to max 150
  assert.equal(
    calculateSliderValueFromPointer({
      clientY: 50,
      rect,
      min: 0,
      max: 150,
      padding: 8,
    }),
    150,
  );
  // Dragging below bottom (clientY = 300) -> clamps to min 0
  assert.equal(
    calculateSliderValueFromPointer({
      clientY: 300,
      rect,
      min: 0,
      max: 150,
      padding: 8,
    }),
    0,
  );

  // Master fader (min 0, max 100)
  assert.equal(
    calculateSliderValueFromPointer({
      clientY: 100,
      rect,
      min: 0,
      max: 100,
      padding: 8,
    }),
    100,
  );
  assert.equal(
    calculateSliderValueFromPointer({
      clientY: 160,
      rect,
      min: 0,
      max: 100,
      padding: 8,
    }),
    50,
  );
  assert.equal(
    calculateSliderValueFromPointer({
      clientY: 220,
      rect,
      min: 0,
      max: 100,
      padding: 8,
    }),
    0,
  );

  // Fallback for zero or missing rect
  assert.equal(
    calculateSliderValueFromPointer({
      clientY: 100,
      rect: null,
      min: 0,
      max: 100,
    }),
    0,
  );
});

test("scdaw-mixer: calculateSliderValueFromWheel increments and decrements volume with clamping and shift-key fine tuning", () => {
  // Master fader: scroll up (negative deltaY) increases volume
  assert.equal(
    calculateSliderValueFromWheel({
      currentValue: 80,
      deltaY: -100,
      min: 0,
      max: 100,
      step: 2,
    }),
    82,
  );
  // Master fader: scroll down (positive deltaY) decreases volume
  assert.equal(
    calculateSliderValueFromWheel({
      currentValue: 80,
      deltaY: 100,
      min: 0,
      max: 100,
      step: 2,
    }),
    78,
  );
  // Clamping at maximum (100)
  assert.equal(
    calculateSliderValueFromWheel({
      currentValue: 99,
      deltaY: -100,
      min: 0,
      max: 100,
      step: 2,
    }),
    100,
  );
  assert.equal(
    calculateSliderValueFromWheel({
      currentValue: 100,
      deltaY: -100,
      min: 0,
      max: 100,
      step: 2,
    }),
    100,
  );
  // Clamping at minimum (0)
  assert.equal(
    calculateSliderValueFromWheel({
      currentValue: 1,
      deltaY: 100,
      min: 0,
      max: 100,
      step: 2,
    }),
    0,
  );
  assert.equal(
    calculateSliderValueFromWheel({
      currentValue: 0,
      deltaY: 100,
      min: 0,
      max: 100,
      step: 2,
    }),
    0,
  );

  // Track fader: can reach up to 150
  assert.equal(
    calculateSliderValueFromWheel({
      currentValue: 148,
      deltaY: -100,
      min: 0,
      max: 150,
      step: 2,
    }),
    150,
  );

  // Shift-key fine tuning (step of 1 instead of 2)
  assert.equal(
    calculateSliderValueFromWheel({
      currentValue: 80,
      deltaY: -100,
      min: 0,
      max: 100,
      step: 2,
      shiftKey: true,
    }),
    81,
  );
  assert.equal(
    calculateSliderValueFromWheel({
      currentValue: 80,
      deltaY: 100,
      min: 0,
      max: 100,
      step: 2,
      shiftKey: true,
    }),
    79,
  );

  // deltaY = 0 does not change value
  assert.equal(
    calculateSliderValueFromWheel({
      currentValue: 80,
      deltaY: 0,
      min: 0,
      max: 100,
    }),
    80,
  );
});

test("scdaw-mixer: shouldPreserveMixerDom determines when mixer DOM should be updated in-place vs re-rendered", () => {
  // Same track IDs in sequence with container -> preserve
  assert.equal(
    shouldPreserveMixerDom({
      renderedTrackIds: ["trk_drums", "trk_bass"],
      targetTrackIds: ["trk_drums", "trk_bass"],
      hasContainer: true,
    }),
    true,
  );

  // Missing container -> re-render needed
  assert.equal(
    shouldPreserveMixerDom({
      renderedTrackIds: ["trk_drums", "trk_bass"],
      targetTrackIds: ["trk_drums", "trk_bass"],
      hasContainer: false,
    }),
    false,
  );

  // Different track count -> re-render needed
  assert.equal(
    shouldPreserveMixerDom({
      renderedTrackIds: ["trk_drums"],
      targetTrackIds: ["trk_drums", "trk_bass"],
      hasContainer: true,
    }),
    false,
  );

  // Different track IDs -> re-render needed
  assert.equal(
    shouldPreserveMixerDom({
      renderedTrackIds: ["trk_drums", "trk_bass"],
      targetTrackIds: ["trk_drums", "trk_lead"],
      hasContainer: true,
    }),
    false,
  );
});

test("scdaw-mixer: setupVolumeSlider binds pointer dragging, wheel scrolling, and reset events", () => {
  const capturedEvents = [];
  const volumeChanges = [];
  let resetCalled = false;

  const mockSlider = {
    min: "0",
    max: "150",
    value: "100",
    listeners: {},
    addEventListener(event, fn, options) {
      this.listeners[event] = fn;
    },
    getBoundingClientRect() {
      return { top: 100, bottom: 220, height: 120 };
    },
    setPointerCapture(id) {
      capturedEvents.push(`capture-${id}`);
    },
    releasePointerCapture(id) {
      capturedEvents.push(`release-${id}`);
    },
    focus() {
      capturedEvents.push("focus");
    },
  };

  setupVolumeSlider(mockSlider, {
    onVolumeChange(val) {
      volumeChanges.push(val);
    },
    onReset() {
      resetCalled = true;
    },
  });

  // Verify listeners were attached
  assert.ok(typeof mockSlider.listeners.pointerdown === "function");
  assert.ok(typeof mockSlider.listeners.pointermove === "function");
  assert.ok(typeof mockSlider.listeners.pointerup === "function");
  assert.ok(typeof mockSlider.listeners.pointercancel === "function");
  assert.ok(typeof mockSlider.listeners.wheel === "function");
  assert.ok(typeof mockSlider.listeners.dblclick === "function");

  // 1. Pointerdown (click/touch) initiates drag and sets initial value
  let prevented = false;
  mockSlider.listeners.pointerdown({
    pointerId: 42,
    clientY: 160, // center -> 75
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(mockSlider._isDragging, true);
  assert.equal(mockSlider.value, "75");
  assert.deepEqual(volumeChanges, [75]);
  assert.ok(capturedEvents.includes("capture-42"));
  assert.ok(capturedEvents.includes("focus"));

  // 2. Pointermove (drag) updates value smoothly
  mockSlider.listeners.pointermove({
    pointerId: 42,
    clientY: 100, // top -> 150
  });
  assert.equal(mockSlider.value, "150");
  assert.deepEqual(volumeChanges, [75, 150]);

  // 3. Pointerup ends drag
  mockSlider.listeners.pointerup({
    pointerId: 42,
  });
  assert.equal(mockSlider._isDragging, false);
  assert.ok(capturedEvents.includes("release-42"));

  // 4. Pointermove after pointerup does NOT update
  mockSlider.listeners.pointermove({
    pointerId: 42,
    clientY: 220,
  });
  assert.equal(mockSlider.value, "150"); // unchanged
  assert.deepEqual(volumeChanges, [75, 150]); // no new change

  // 5. Mouse wheel adjusts value
  let wheelPrevented = false;
  mockSlider.listeners.wheel({
    deltaY: 100, // scroll down -> -2
    preventDefault: () => {
      wheelPrevented = true;
    },
  });
  assert.equal(wheelPrevented, true);
  assert.equal(mockSlider.value, "148");
  assert.deepEqual(volumeChanges, [75, 150, 148]);

  // Mouse wheel scroll up -> +2
  mockSlider.listeners.wheel({
    deltaY: -100,
    preventDefault: () => {},
  });
  assert.equal(mockSlider.value, "150");
  assert.deepEqual(volumeChanges, [75, 150, 148, 150]);

  // 6. Double click triggers reset
  mockSlider.listeners.dblclick({});
  assert.equal(resetCalled, true);
});

test("scdaw-transport: formats musical position string", () => {
  assert.equal(formatPosition(1, 1, 0), "001 : 1 : 1");
  assert.equal(formatPosition(2, 3, 2), "002 : 3 : 3");
});

test("scdaw-transport: calculateTransportWheelValue adjusts BPM and Swing with clamping and shiftKey support", () => {
  // BPM adjustments (min: 40, max: 240, step: 1, shiftMultiplier: 5)
  // 1. Wheel up increases BPM by 1
  assert.equal(
    calculateTransportWheelValue({
      currentValue: 120,
      deltaY: -100,
      min: 40,
      max: 240,
      step: 1,
    }),
    121,
  );
  // 2. Wheel down decreases BPM by 1
  assert.equal(
    calculateTransportWheelValue({
      currentValue: 120,
      deltaY: 100,
      min: 40,
      max: 240,
      step: 1,
    }),
    119,
  );
  // 3. Shift key wheel up increases BPM by 5 (shiftMultiplier = 5)
  assert.equal(
    calculateTransportWheelValue({
      currentValue: 120,
      deltaY: -100,
      min: 40,
      max: 240,
      step: 1,
      shiftKey: true,
      shiftMultiplier: 5,
    }),
    125,
  );
  // 4. Shift key wheel down decreases BPM by 5
  assert.equal(
    calculateTransportWheelValue({
      currentValue: 120,
      deltaY: 100,
      min: 40,
      max: 240,
      step: 1,
      shiftKey: true,
      shiftMultiplier: 5,
    }),
    115,
  );
  // 5. Clamps to maximum (240)
  assert.equal(
    calculateTransportWheelValue({
      currentValue: 239,
      deltaY: -100,
      min: 40,
      max: 240,
      step: 1,
      shiftKey: true,
      shiftMultiplier: 5,
    }),
    240,
  );
  // 6. Clamps to minimum (40)
  assert.equal(
    calculateTransportWheelValue({
      currentValue: 42,
      deltaY: 100,
      min: 40,
      max: 240,
      step: 1,
      shiftKey: true,
      shiftMultiplier: 5,
    }),
    40,
  );
  // 7. Swing adjustments (min: 0, max: 50, step: 1, shiftMultiplier: 5)
  assert.equal(
    calculateTransportWheelValue({
      currentValue: 20,
      deltaY: -100,
      min: 0,
      max: 50,
      step: 1,
    }),
    21,
  );
  assert.equal(
    calculateTransportWheelValue({
      currentValue: 20,
      deltaY: 100,
      min: 0,
      max: 50,
      step: 1,
      shiftKey: true,
    }),
    15,
  );
  // 8. Zero delta returns clamped value
  assert.equal(
    calculateTransportWheelValue({
      currentValue: 120,
      deltaY: 0,
      min: 40,
      max: 240,
    }),
    120,
  );
});

test("scdaw-transport: setupTransportWheelControls binds non-passive wheel events, prevents scroll, and dispatches updates", () => {
  const bpmEvents = [];
  const swingEvents = [];

  const createMockInput = (initialValue, min, max) => {
    const listeners = {};
    return {
      value: String(initialValue),
      min: String(min),
      max: String(max),
      addEventListener: (type, cb, opts) => {
        listeners[type] = { cb, opts };
      },
      listeners,
    };
  };

  const mockBpm = createMockInput(120, 40, 240);
  const mockSwing = createMockInput(20, 0, 50);

  setupTransportWheelControls({
    bpmInput: mockBpm,
    swingInput: mockSwing,
    onBpmChange: (bpm) => bpmEvents.push(bpm),
    onSwingChange: (swing) => swingEvents.push(swing),
  });

  // Verify non-passive wheel listeners are registered (to allow preventDefault)
  assert.equal(mockBpm.listeners.wheel.opts?.passive, false);
  assert.equal(mockSwing.listeners.wheel.opts?.passive, false);

  // Wheel up on BPM
  let prevented = false;
  mockBpm.listeners.wheel.cb({
    deltaY: -100,
    shiftKey: false,
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(mockBpm.value, "121");
  assert.deepEqual(bpmEvents, [121]);

  // Wheel down on Swing with shift key
  prevented = false;
  mockSwing.listeners.wheel.cb({
    deltaY: 100,
    shiftKey: true,
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(mockSwing.value, "15");
  assert.deepEqual(swingEvents, [15]);
});

test("scdaw-transport: calculateBpmDragValue adjusts BPM with upward increase, downward decrease, clamping, and shift fine-tuning", () => {
  // 1. Dragging UP (currentY < startY) increases BPM
  // startY = 100, currentY = 80 (deltaY = +20) -> with pixelsPerUnit = 2, increases by +10 BPM
  assert.equal(
    calculateBpmDragValue({
      startY: 100,
      currentY: 80,
      startValue: 120,
      min: 40,
      max: 240,
      pixelsPerUnit: 2,
    }),
    130,
  );

  // 2. Dragging DOWN (currentY > startY) decreases BPM
  // startY = 100, currentY = 130 (deltaY = -30) -> with pixelsPerUnit = 2, decreases by -15 BPM
  assert.equal(
    calculateBpmDragValue({
      startY: 100,
      currentY: 130,
      startValue: 120,
      min: 40,
      max: 240,
      pixelsPerUnit: 2,
    }),
    105,
  );

  // 3. Shift key fine-tuning (rate scaled by 0.2, so 10px per 1 BPM)
  // deltaY = +20 with shiftKey -> +2 BPM
  assert.equal(
    calculateBpmDragValue({
      startY: 100,
      currentY: 80,
      startValue: 120,
      min: 40,
      max: 240,
      pixelsPerUnit: 2,
      shiftKey: true,
      shiftMultiplier: 0.2,
    }),
    122,
  );

  // 4. Clamps to max 240
  assert.equal(
    calculateBpmDragValue({
      startY: 100,
      currentY: -500,
      startValue: 120,
      min: 40,
      max: 240,
      pixelsPerUnit: 2,
    }),
    240,
  );

  // 5. Clamps to min 40
  assert.equal(
    calculateBpmDragValue({
      startY: 100,
      currentY: 500,
      startValue: 120,
      min: 40,
      max: 240,
      pixelsPerUnit: 2,
    }),
    40,
  );

  // 6. Zero or equal coordinates preserve startValue
  assert.equal(
    calculateBpmDragValue({
      startY: 100,
      currentY: 100,
      startValue: 128,
    }),
    128,
  );
});

test("scdaw-transport: setupBpmDragControl binds touch/pointer drag events, captures pointer, and dispatches updates", () => {
  const bpmChanges = [];
  const capturedEvents = [];

  const mockInput = {
    value: "120",
    min: "40",
    max: "240",
    focused: false,
    selected: false,
    blurred: false,
    focus() {
      this.focused = true;
    },
    select() {
      this.selected = true;
    },
    blur() {
      this.blurred = true;
    },
  };

  const listeners = {};
  const mockTarget = {
    setPointerCapture(id) {
      capturedEvents.push(`capture-${id}`);
    },
    releasePointerCapture(id) {
      capturedEvents.push(`release-${id}`);
    },
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
    removeEventListener(type) {
      delete listeners[type];
    },
  };

  setupBpmDragControl({
    bpmInput: mockInput,
    bpmContainer: mockTarget,
    onBpmChange: (bpm) => bpmChanges.push(bpm),
    pixelsPerUnit: 2,
  });

  // Verify listeners attached
  assert.equal(typeof listeners.pointerdown, "function");
  assert.equal(typeof listeners.pointermove, "function");
  assert.equal(typeof listeners.pointerup, "function");
  assert.equal(typeof listeners.pointercancel, "function");

  // 1. Touch/pointerdown captures pointer
  listeners.pointerdown({
    pointerId: 7,
    clientY: 200,
  });
  assert.ok(capturedEvents.includes("capture-7"));

  // 2. Drag UP 30px (clientY: 200 -> 170) -> +15 BPM -> 135 BPM
  let prevented = false;
  listeners.pointermove({
    pointerId: 7,
    clientY: 170,
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(mockInput.value, "135");
  assert.deepEqual(bpmChanges, [135]);

  // 3. Pointerup finishes drag, releases pointer capture, and blurs input
  prevented = false;
  listeners.pointerup({
    pointerId: 7,
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.ok(capturedEvents.includes("release-7"));
  assert.equal(mockInput.blurred, true);

  // 4. Tap/click without dragging (deltaY < 2) triggers focus & select for text editing
  mockInput.focused = false;
  mockInput.selected = false;
  mockInput.blurred = false;
  listeners.pointerdown({
    pointerId: 8,
    clientY: 200,
  });
  listeners.pointerup({
    pointerId: 8,
  });
  assert.equal(mockInput.focused, true);
  assert.equal(mockInput.selected, true);
});

test("scdaw-transport: shouldPromptRecordOptions identifies overlapping clips at current playhead", () => {
  const synthTrack = { kind: "synth", name: "Lead", notes: [] };
  assert.equal(
    shouldPromptRecordOptions({ targetTrack: synthTrack, currentBeat: 0 }),
    false,
  );

  const emptyAudioTrack = { kind: "audio", name: "Vocals", audioClips: [] };
  assert.equal(
    shouldPromptRecordOptions({ targetTrack: emptyAudioTrack, currentBeat: 0 }),
    false,
  );

  const audioTrackWithClip = {
    kind: "audio",
    name: "Vocals",
    audioClips: [{ id: "c1", name: "Take 1", time: 0, duration: 4 }],
  };

  // Beat 0 overlaps (0 <= 0 < 4)
  assert.equal(
    shouldPromptRecordOptions({
      targetTrack: audioTrackWithClip,
      currentBeat: 0,
    }),
    true,
  );

  // Beat 2 overlaps (0 <= 2 < 4)
  assert.equal(
    shouldPromptRecordOptions({
      targetTrack: audioTrackWithClip,
      currentBeat: 2,
    }),
    true,
  );

  // Beat 4 does not overlap (clip ends at 4)
  assert.equal(
    shouldPromptRecordOptions({
      targetTrack: audioTrackWithClip,
      currentBeat: 4,
    }),
    false,
  );

  // Beat 8 does not overlap
  assert.equal(
    shouldPromptRecordOptions({
      targetTrack: audioTrackWithClip,
      currentBeat: 8,
    }),
    false,
  );
});

test("scdaw-transport: Audio Recording Options dialog strictly follows ShadowClaw theme tokens and avoids slate-blue/hardcoded colors", async () => {
  const transportContent = await fs.readFile(
    new URL(
      "../.agents/scripts/components/scdaw-transport.js",
      import.meta.url,
    ),
    "utf-8",
  );

  // Must not have hardcoded Tailwind slate-blue colors (#1e293b, #334155, #f8fafc)
  assert.doesNotMatch(
    transportContent,
    /#1e293b/i,
    "scdaw-transport must not use hardcoded slate-800 (#1e293b)",
  );
  assert.doesNotMatch(
    transportContent,
    /#334155/i,
    "scdaw-transport must not use hardcoded slate-700 (#334155)",
  );
  assert.doesNotMatch(
    transportContent,
    /#f8fafc/i,
    "scdaw-transport must not use hardcoded slate-50 (#f8fafc)",
  );

  // Must not use ungrounded --scdaw- variables instead of theme tokens
  assert.doesNotMatch(
    transportContent,
    /--scdaw-surface/i,
    "scdaw-transport must not use non-existent --scdaw-surface variable",
  );
  assert.doesNotMatch(
    transportContent,
    /--scdaw-border/i,
    "scdaw-transport must not use non-existent --scdaw-border variable",
  );
  assert.doesNotMatch(
    transportContent,
    /--scdaw-text\b/i,
    "scdaw-transport must not use non-existent --scdaw-text variable",
  );

  // Must use proper ShadowClaw theme variables for dialog surface and borders
  assert.match(
    transportContent,
    /var\(--bg-card/i,
    "dialog modal must use var(--bg-card)",
  );
  assert.match(
    transportContent,
    /var\(--border/i,
    "dialog modal must use var(--border)",
  );
  assert.match(
    transportContent,
    /var\(--shadow-claw-text-primary/i,
    "dialog modal must use var(--shadow-claw-text-primary)",
  );
  assert.match(
    transportContent,
    /\.scdaw-dialog__btn[\s\S]*?var\(--bg-elevated/i,
    "dialog option buttons must use var(--bg-elevated)",
  );
  assert.match(
    transportContent,
    /\.scdaw-dialog__btn\.btn-primary[\s\S]*?var\(--accent/i,
    "dialog primary button must use var(--accent)",
  );
});

test("scdaw-statusbar: formats audio telemetry, project summary, and bounce status", () => {
  const status = formatTelemetryStatus(
    { audio: "running", lastBounce: { durationSec: 4.0, peakDb: -1.2 } },
    { name: "Techno Groove", bpm: 130, tracks: [1, 2, 3] },
  );
  assert.equal(status.audioText, "Audio: running");
  assert.equal(status.audioStatus, "running");
  assert.equal(status.projectSummary, "Techno Groove · 130 BPM · 3 Tracks");
  assert.equal(status.bounceSummary, "Bounce: 4.0s (-1.2 dB)");
});

test("scdaw-workbench: resolves grid docking columns according to panel visibility", () => {
  const allOpen = resolveWorkbenchPanels(true, true, "piano-roll");
  assert.equal(allOpen.gridColumns, "240px 1fr 280px");
  assert.equal(allOpen.editorMode, "piano-roll");

  const noBrowser = resolveWorkbenchPanels(false, true, "step-sequencer");
  assert.equal(noBrowser.gridColumns, "1fr 280px");
  assert.equal(noBrowser.editorMode, "step-sequencer");

  const noMixer = resolveWorkbenchPanels(true, false, "piano-roll");
  assert.equal(noMixer.gridColumns, "240px 1fr");

  const centerOnly = resolveWorkbenchPanels(false, false, "piano-roll");
  assert.equal(centerOnly.gridColumns, "1fr");
});

test("scdaw-resize-handle & responsive workbench: handles mobile-first container query adaptations", () => {
  // Mobile layout (< 640px)
  const mobileLayout = resolveWorkbenchResponsiveLayout({
    containerWidth: 400,
    viewMode: "studio",
    showBrowser: true,
    showMixer: true,
  });
  assert.equal(mobileLayout.isMobile, true);
  assert.equal(mobileLayout.gridTemplateColumns, "1fr");

  // Piano roll full width focus mode
  const pianoFull = resolveWorkbenchResponsiveLayout({
    containerWidth: 1200,
    viewMode: "piano-roll-full",
  });
  assert.equal(pianoFull.isFullWidth, true);
  assert.equal(pianoFull.activeFocus, "piano-roll");
  assert.equal(pianoFull.gridTemplateColumns, "1fr");

  // Clamp resize values
  assert.equal(clampSize(100, 150, 400), 150);
  assert.equal(clampSize(500, 150, 400), 400);

  // Keyboard navigation
  assert.equal(computeKeyboardResize("ArrowRight", false, 240, 150, 400), 250);
  assert.equal(computeKeyboardResize("ArrowLeft", true, 240, 150, 400), 190);

  // WCAG separator ARIA attributes
  const aria = getAriaAttributes("vertical", 240, 150, 400, "Resize Browser");
  assert.equal(aria.role, "separator");
  assert.equal(aria["aria-orientation"], "vertical");
  assert.equal(aria["aria-valuenow"], "240");
});

test("scdaw-styles & scdaw-workbench: toolbar buttons enforce uniform height and line-height across icons and text", async () => {
  assert.match(SHARED_STYLES, /line-height:\s*1/);

  const workbenchContent = await fs.readFile(
    new URL(
      "../.agents/scripts/components/scdaw-workbench.js",
      import.meta.url,
    ),
    "utf-8",
  );
  assert.match(workbenchContent, /\.scdaw-workbench__toolbar \.btn/);
  assert.match(workbenchContent, /height:\s*30px/);
  assert.match(workbenchContent, /min-height:\s*30px/);
});

test("scdaw-workbench: replaces native confirm() with accessible <shadow-claw-dialog> modal and scroll containment", async () => {
  const workbenchContent = await fs.readFile(
    new URL(
      "../.agents/scripts/components/scdaw-workbench.js",
      import.meta.url,
    ),
    "utf-8",
  );

  // Uses <shadow-claw-dialog> instead of native confirm()
  assert.match(workbenchContent, /<shadow-claw-dialog/);
  assert.doesNotMatch(
    workbenchContent,
    /["']new-btn["'][^}]+if\s*\(\s*confirm\s*\(/,
    "new-btn should not call native confirm() directly",
  );
  assert.doesNotMatch(
    workbenchContent,
    /["']reset-btn["'][^}]+if\s*\(\s*confirm\s*\(/,
    "reset-btn should not call native confirm() directly",
  );
  assert.match(workbenchContent, /confirmDialog\s*\(/);

  // Modern scroll containment & backdrop styles
  assert.match(
    workbenchContent,
    /dialog:modal\s*\{[^}]*overscroll-behavior:\s*contain/,
  );
  assert.match(
    workbenchContent,
    /dialog::backdrop\s*\{[^}]*overscroll-behavior:\s*contain/,
  );
  assert.match(
    workbenchContent,
    /dialog::backdrop\s*\{[^}]*overflow:\s*hidden/,
  );

  // Safe action autofocus
  assert.match(workbenchContent, /<button[^>]+value="cancel"[^>]+autofocus/);

  // Imports standalone shadow-claw-dialog component from CDN
  assert.match(
    workbenchContent,
    /https:\/\/cdn\.jsdelivr\.net\/npm\/shadow-claw\/dist\/lib\/components\/shadow-claw-dialog\.js/,
  );
});

test("scdaw-workbench: Save/Export and Open/Import dialogs adhere to WCAG and ARIA best practices", async () => {
  const workbenchContent = await fs.readFile(
    new URL(
      "../.agents/scripts/components/scdaw-workbench.js",
      import.meta.url,
    ),
    "utf-8",
  );

  // Toolbar action buttons exist with accessible titles
  assert.match(
    workbenchContent,
    /id=["']import-btn["'][^>]+title=["'][^"']+["']/,
  );
  assert.match(
    workbenchContent,
    /id=["']export-btn["'][^>]+title=["'][^"']+["']/,
  );

  // Hidden file input has appropriate accept types and aria-hidden
  assert.match(
    workbenchContent,
    /<input[^>]+type=["']file["'][^>]+id=["']import-file-input["'][^>]+accept=["'][^"']*scdaw\.json[^"']*["']/,
  );

  // Export modal dialog exists with accessible form controls and labels
  assert.match(workbenchContent, /<dialog[^>]+id=["']export-modal["']/);
  assert.match(workbenchContent, /<label[^>]+for=["']export-format-select["']/);
  assert.match(workbenchContent, /<select[^>]+id=["']export-format-select["']/);
  assert.match(workbenchContent, /<label[^>]+for=["']export-bitdepth["']/);
  assert.match(workbenchContent, /<label[^>]+for=["']export-loops["']/);
  assert.match(workbenchContent, /<label[^>]+for=["']export-tap-select["']/);

  // Export and Import dialogs must not use hardcoded slate-blue colors (#1e293b, #0f172a, #334155)
  assert.doesNotMatch(
    workbenchContent,
    /<dialog[^>]+id=["']export-modal["'][^>]*#[103][ef3][214][971][325][b5a]/i,
    "export-modal must not have inline hardcoded blue colors",
  );
  assert.doesNotMatch(
    workbenchContent,
    /<dialog[^>]+id=["']import-modal["'][^>]*#[103][ef3][214][971][325][b5a]/i,
    "import-modal must not have inline hardcoded blue colors",
  );
  assert.doesNotMatch(
    workbenchContent,
    /id=["']export-conversation-select["'][^>]*#[103][ef3][214][971][325][b5a]/i,
    "export-conversation-select must not have inline hardcoded blue colors",
  );
  assert.doesNotMatch(
    workbenchContent,
    /id=["']export-filename-input["'][^>]*#[103][ef3][214][971][325][b5a]/i,
    "export-filename-input must not have inline hardcoded blue colors",
  );

  // bounce-btn should configure export modal for WAV mixdown and populate conversations
  assert.match(
    workbenchContent,
    /getElementById\(["']bounce-btn["']\)[\s\S]*?openExportModal\(\s*["']wav["']\s*\)/i,
    "bounce-btn must call openExportModal with 'wav' before opening modal",
  );

  // Drag-and-drop import listeners are attached to the element
  assert.match(workbenchContent, /addEventListener\s*\(\s*["']dragover["']/);
  assert.match(workbenchContent, /addEventListener\s*\(\s*["']drop["']/);
});

test("scdaw-workbench: resolveDropAction determines context-sensitive action based on target and dragged payload", () => {
  // 1. Dropping session file anywhere on workbench
  assert.deepEqual(
    resolveDropAction({
      targetTrackId: null,
      file: { name: "summer.dawproject" },
    }),
    { action: "import_session", format: "dawproject" },
  );

  assert.deepEqual(
    resolveDropAction({
      targetTrackId: null,
      file: { name: "groove.scdaw.json" },
    }),
    { action: "import_session", format: "scdaw-json" },
  );

  // 2. Dropping MIDI file onto a specific track
  assert.deepEqual(
    resolveDropAction({
      targetTrackId: "trk_bass",
      file: { name: "bassline.mid" },
    }),
    { action: "import_track_midi", trackId: "trk_bass", format: "midi" },
  );

  // 3. Dropping audio WAV file onto a specific track
  assert.deepEqual(
    resolveDropAction({
      targetTrackId: "trk_drums",
      file: { name: "kick.wav" },
    }),
    { action: "import_track_audio", trackId: "trk_drums", format: "wav" },
  );

  // 4. Dragging plugin from browser onto a specific track
  assert.deepEqual(
    resolveDropAction({
      targetTrackId: "trk_lead",
      plugin: { kind: "audio_fx", type: "delay", feedback: 0.4 },
    }),
    {
      action: "add_fx",
      trackId: "trk_lead",
      fx: { kind: "audio_fx", type: "delay", feedback: 0.4 },
    },
  );

  assert.deepEqual(
    resolveDropAction({
      targetTrackId: "trk_lead",
      plugin: { kind: "preset", id: "acid-squelch" },
    }),
    { action: "apply_preset", trackId: "trk_lead", preset: "acid-squelch" },
  );

  assert.deepEqual(
    resolveDropAction({
      targetTrackId: "trk_drums",
      plugin: { kind: "instrument", type: "drums" },
    }),
    { action: "load_instrument", trackId: "trk_drums", instrument: "drums" },
  );
});

test("scdaw redesign: enforces Mobile-First, Responsive Design, Graceful Degradation, BEM, and ARIA compliance", async () => {
  const workbenchContent = await fs.readFile(
    new URL(
      "../.agents/scripts/components/scdaw-workbench.js",
      import.meta.url,
    ),
    "utf-8",
  );
  const transportContent = await fs.readFile(
    new URL(
      "../.agents/scripts/components/scdaw-transport.js",
      import.meta.url,
    ),
    "utf-8",
  );
  const statusbarContent = await fs.readFile(
    new URL(
      "../.agents/scripts/components/scdaw-statusbar.js",
      import.meta.url,
    ),
    "utf-8",
  );
  const stylesContent = await fs.readFile(
    new URL("../.agents/scripts/components/scdaw-styles.js", import.meta.url),
    "utf-8",
  );

  // 1. Mobile First Architecture
  // Workbench base styles must be mobile-first without desktop-first max-width container queries
  assert.doesNotMatch(
    workbenchContent,
    /@container scdaw-workbench\s*\(\s*max-width:\s*680px\s*\)/,
    "Workbench styles should be mobile-first, not desktop-first with max-width container queries",
  );
  assert.match(
    workbenchContent,
    /@container scdaw-workbench\s*\(\s*min-width:\s*640px\s*\)/,
    "Workbench should progressively enhance via min-width container queries",
  );
  assert.match(
    workbenchContent,
    /@container scdaw-workbench\s*\(\s*min-width:\s*1024px\s*\)/,
    "Workbench should progressively enhance desktop multi-pane grid via min-width container query",
  );

  // Transport base styles must be mobile-first
  assert.match(
    transportContent,
    /@container scdaw-transport\s*\(\s*min-width:\s*640px\s*\)/,
    "Transport bar should progressively enhance via min-width container query",
  );

  // 2. Responsive Design (No horizontal overflow & fluid sizing)
  assert.match(
    workbenchContent,
    /grid-template-columns:\s*repeat\(4,\s*1fr\)/,
    "Project buttons must use responsive 4-column grid on mobile to prevent overflow",
  );
  assert.match(
    workbenchContent,
    /grid-template-columns:\s*repeat\(2,\s*1fr\)/,
    "Actions must use responsive 2-column grid on mobile",
  );
  assert.match(
    workbenchContent,
    /overflow-x:\s*hidden/,
    "Workbench root must constrain horizontal overflow",
  );
  assert.match(
    transportContent,
    /overflow-x:\s*hidden/,
    "Transport bar must constrain horizontal overflow",
  );

  // 3. Degrades Gracefully (Fallback media queries)
  assert.match(
    workbenchContent,
    /@media\s*\(\s*min-width:\s*640px\s*\)/,
    "Workbench should provide fallback media queries for graceful degradation",
  );
  assert.match(
    transportContent,
    /@media\s*\(\s*min-width:\s*640px\s*\)/,
    "Transport should provide fallback media queries for graceful degradation",
  );

  // 4. Strict BEM Naming Conventions
  // Workbench BEM classes
  assert.match(workbenchContent, /class=["'][^"']*scdaw-workbench__header/);
  assert.match(workbenchContent, /class=["'][^"']*scdaw-workbench__title-bar/);
  assert.match(workbenchContent, /class=["'][^"']*scdaw-workbench__toolbar/);
  assert.match(
    workbenchContent,
    /class=["'][^"']*scdaw-workbench__toolbar-group--project/,
  );
  assert.match(
    workbenchContent,
    /class=["'][^"']*scdaw-workbench__toolbar-group--views/,
  );
  assert.match(
    workbenchContent,
    /class=["'][^"']*scdaw-workbench__dock-toggles/,
  );
  assert.match(
    workbenchContent,
    /class=["'][^"']*scdaw-workbench__view-switcher/,
  );
  assert.match(
    workbenchContent,
    /class=["'][^"']*scdaw-workbench__toolbar-group--actions/,
  );
  assert.match(workbenchContent, /class=["'][^"']*scdaw-workbench__dock-grid/);
  assert.match(
    workbenchContent,
    /class=["'][^"']*scdaw-workbench__center-stack/,
  );
  assert.match(
    workbenchContent,
    /class=["'][^"']*scdaw-workbench__dock-panel--browser/,
  );
  assert.match(
    workbenchContent,
    /class=["'][^"']*scdaw-workbench__dock-panel--mixer/,
  );

  // Transport BEM classes
  assert.match(
    transportContent,
    /class=["'][^"']*scdaw-transport__group--playback/,
  );
  assert.match(transportContent, /class=["'][^"']*scdaw-transport__btn--rec/);
  assert.match(transportContent, /class=["'][^"']*scdaw-transport__btn--metro/);
  assert.match(
    transportContent,
    /class=["'][^"']*scdaw-transport__group--tempo/,
  );
  assert.match(transportContent, /class=["'][^"']*scdaw-transport__pos/);
  assert.match(transportContent, /class=["'][^"']*scdaw-transport__item--bpm/);
  assert.match(
    transportContent,
    /class=["'][^"']*scdaw-transport__item--swing/,
  );
  assert.match(
    transportContent,
    /class=["'][^"']*scdaw-transport__item--panic/,
  );

  // Statusbar BEM classes
  assert.match(statusbarContent, /class=["'][^"']*scdaw-statusbar__group/);
  assert.match(
    statusbarContent,
    /class=["'][^"']*scdaw-statusbar__stat--audio/,
  );
  assert.match(
    statusbarContent,
    /class=["'][^"']*scdaw-statusbar__stat--project/,
  );

  // 5. Accessible (ARIA Compliant)
  // Landmarks
  assert.match(workbenchContent, /role=["']banner["']/);
  assert.match(workbenchContent, /role=["']toolbar["']/);
  assert.match(workbenchContent, /role=["']tablist["']/);
  assert.match(workbenchContent, /role=["']tab["']/);
  assert.match(workbenchContent, /role=["']main["']/);
  assert.match(workbenchContent, /role=["']region["']/);
  assert.match(workbenchContent, /role=["']contentinfo["']/);
  assert.match(transportContent, /role=["']status["']/);
  assert.match(statusbarContent, /role=["']status["']/);

  // Controls & States
  assert.match(workbenchContent, /aria-controls=["']browser-container["']/);
  assert.match(workbenchContent, /aria-controls=["']mixer-container["']/);
  assert.match(workbenchContent, /aria-pressed=/);
  assert.match(workbenchContent, /aria-selected=/);
  assert.match(transportContent, /aria-label=["']Audio Transport Controls["']/);
  assert.match(
    transportContent,
    /aria-label=["']Tempo in beats per minute["']/,
  );
  assert.match(transportContent, /aria-label=["']Groove swing percentage["']/);

  // Focus visible styles
  assert.match(stylesContent, /:focus-visible/);
  assert.match(stylesContent, /outline-offset:\s*2px/);
  assert.match(
    stylesContent,
    /\.hidden,\s*\[hidden\]\s*\{\s*display:\s*none\s*!important/,
  );
});

test("scdaw-engine & components: selectTrack synchronizes selectedTrackId across Timeline, Editor, Device Rack, and Mixer", async () => {
  const { scdaw } = await import("../.agents/scripts/scdaw-engine.js");
  const p = scdaw.getProject();
  assert.ok(p.tracks.length >= 2);
  assert.ok(scdaw.selectedTrackId, "scdaw must expose selectedTrackId signal");
  assert.equal(
    typeof scdaw.selectTrack,
    "function",
    "scdaw must expose selectTrack(trackId)",
  );

  const firstTrackId = p.tracks[0].id;
  const secondTrackId = p.tracks[1].id;

  scdaw.selectTrack(firstTrackId);
  assert.equal(scdaw.selectedTrackId.get(), firstTrackId);
  assert.equal(scdaw.getState().selectedTrackId, firstTrackId);

  scdaw.selectTrack(secondTrackId);
  assert.equal(scdaw.selectedTrackId.get(), secondTrackId);
  assert.equal(scdaw.getState().selectedTrackId, secondTrackId);

  // Ignoring non-existent track ID preserves current selection
  scdaw.selectTrack("non_existent_track_999");
  assert.equal(scdaw.selectedTrackId.get(), secondTrackId);
});

test("scdaw-timeline & scdaw-mixer: clicking M (Mute) and S (Solo) buttons toggles track mute and solo state on and off", async () => {
  const { scdaw } = await import("../.agents/scripts/scdaw-engine.js");
  const { DawTimelineElement } =
    await import("../.agents/scripts/components/scdaw-timeline.js");
  const { DawMixerElement } =
    await import("../.agents/scripts/components/scdaw-mixer.js");

  await scdaw.resetProject({ template: "basic-beat" });
  const initialProject = scdaw.getProject();
  const trackId = initialProject.tracks[0].id;
  assert.equal(initialProject.tracks[0].mute, false);
  assert.equal(initialProject.tracks[0].solo, false);

  // 1. Test DawTimelineElement Mute & Solo buttons
  const timeline = new DawTimelineElement();
  const makeBtnMock = (id) => {
    const listeners = new Map();
    const btn = {
      dataset: { track: id },
      addEventListener: (evt, fn) => listeners.set(evt, fn),
      click: () =>
        listeners.get("click")?.({
          target: btn,
          currentTarget: btn,
          stopPropagation() {},
          preventDefault() {},
        }),
    };
    return btn;
  };

  let timelineMuteBtn = makeBtnMock(trackId);
  let timelineSoloBtn = makeBtnMock(trackId);

  timeline.shadowRoot = {
    innerHTML: "",
    getElementById: () => null,
    querySelectorAll: (sel) => {
      if (sel === ".mute-btn") {
        timelineMuteBtn = makeBtnMock(trackId);
        return [timelineMuteBtn];
      }
      if (sel === ".solo-btn") {
        timelineSoloBtn = makeBtnMock(trackId);
        return [timelineSoloBtn];
      }
      return [];
    },
  };

  timeline.render();

  // Click M in Timeline -> mutes track
  timelineMuteBtn.click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    scdaw.getProject().tracks[0].mute,
    true,
    "Clicking M in Timeline must set track.mute = true",
  );

  // Re-render Timeline and verify muted button state + click M a second time -> unmutes track
  timeline.render();
  assert.match(
    timeline.shadowRoot.innerHTML,
    new RegExp(
      `class="[^"]*btn-danger[^"]*mute-btn"[^>]*data-track="${trackId}"[^>]*aria-pressed="true"`,
    ),
  );
  timelineMuteBtn.click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    scdaw.getProject().tracks[0].mute,
    false,
    "Clicking M a second time in Timeline must set track.mute = false",
  );

  // Click S in Timeline -> solos track
  timeline.render();
  timelineSoloBtn.click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    scdaw.getProject().tracks[0].solo,
    true,
    "Clicking S in Timeline must set track.solo = true",
  );

  // Re-render Timeline and click S a second time -> unsolos track
  timeline.render();
  timelineSoloBtn.click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    scdaw.getProject().tracks[0].solo,
    false,
    "Clicking S a second time in Timeline must set track.solo = false",
  );

  // 2. Test DawMixerElement Mute & Solo buttons across multiple clicks without full re-render
  const mixer = new DawMixerElement();
  const mixerMuteBtn = makeBtnMock(trackId);
  const mixerSoloBtn = makeBtnMock(trackId);

  mixer.shadowRoot = {
    innerHTML: "",
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: (sel) => {
      if (sel === ".mute-btn") return [mixerMuteBtn];
      if (sel === ".solo-btn") return [mixerSoloBtn];
      return [];
    },
  };

  mixer.render();

  // Click M in Mixer 1st time -> mutes track
  mixerMuteBtn.click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    scdaw.getProject().tracks[0].mute,
    true,
    "Clicking M in Mixer 1st time must mute track",
  );

  // Click M in Mixer 2nd time (without calling mixer.render(), since shouldPreserveMixerDom preserves DOM) -> unmutes track
  mixerMuteBtn.click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    scdaw.getProject().tracks[0].mute,
    false,
    "Clicking M in Mixer 2nd time must unmute track even when DOM is preserved in-place",
  );

  // Click S in Mixer 1st time -> solos track
  mixerSoloBtn.click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    scdaw.getProject().tracks[0].solo,
    true,
    "Clicking S in Mixer 1st time must solo track",
  );

  // Click S in Mixer 2nd time (without calling mixer.render()) -> unsolos track
  mixerSoloBtn.click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    scdaw.getProject().tracks[0].solo,
    false,
    "Clicking S in Mixer 2nd time must unsolo track even when DOM is preserved in-place",
  );
});

test("scdaw-editor: velocity stalks align 1:1 inside .grid-area with .pr-key + .pr-cells geometry and support interactive velocity editing", async () => {
  const { scdaw } = await import("../.agents/scripts/scdaw-engine.js");
  const { DawEditorElement } =
    await import("../.agents/scripts/components/scdaw-editor.js");

  // 1. Pure helpers: computeStepVelocity & calculateVelocityFromPointer
  assert.equal(computeStepVelocity([], 0), 0);
  assert.equal(
    computeStepVelocity(
      [
        { position: 0, pitch: 42, velocity: 0.55 },
        { position: 0, pitch: 36, velocity: 0.95 },
      ],
      0,
    ),
    0.95,
    "computeStepVelocity returns max note velocity at a step when multiple notes overlap",
  );

  const stalkRect = { top: 200, bottom: 240, height: 40 };
  assert.equal(
    calculateVelocityFromPointer({ clientY: 200, rect: stalkRect }),
    1.0,
    "Clicking top of velocity stalk sets velocity to 1.0 (100%)",
  );
  assert.equal(
    calculateVelocityFromPointer({ clientY: 220, rect: stalkRect }),
    0.5,
    "Clicking middle of velocity stalk sets velocity to 0.5 (50%)",
  );
  assert.equal(
    calculateVelocityFromPointer({ clientY: 240, rect: stalkRect }),
    0.05,
    "Clicking bottom of velocity stalk clamps velocity to minimum 0.05 (5%)",
  );

  // 2. DOM Alignment inside .grid-area
  await scdaw.sendCommand("reset_project", {});
  const track = scdaw.getProject().tracks[0];
  scdaw.selectTrack(track.id);

  const editor = new DawEditorElement();
  const stalkHandlers = {};
  const mockStalkStep0 = {
    dataset: { step: "0" },
    getBoundingClientRect: () => ({ top: 200, bottom: 240, height: 40 }),
    addEventListener: (evt, fn) => {
      stalkHandlers[evt] = fn;
    },
  };

  editor.shadowRoot = {
    innerHTML: "",
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: (sel) => {
      if (sel === ".vel-stalk") return [mockStalkStep0];
      return [];
    },
  };

  editor.render();

  const html = editor.shadowRoot.innerHTML;
  // .velocity-stalks MUST be rendered inside .grid-area (before closing .grid-area / .editor-container)
  // and MUST contain a 48px .pr-key.vel-key spacer + .pr-cells.vel-cells with min-width: 24px on .vel-stalk
  const gridAreaIndex = html.indexOf('<div class="grid-area">');
  const velocityStalksIndex = html.indexOf('class="velocity-stalks"');
  const editorContainerCloseIndex = html.lastIndexOf(
    "</div>\n        </div>\n      </div>",
  );
  assert.ok(gridAreaIndex !== -1, ".grid-area must exist");
  assert.ok(
    velocityStalksIndex > gridAreaIndex,
    ".velocity-stalks must be inside .grid-area",
  );
  assert.ok(
    velocityStalksIndex < editorContainerCloseIndex,
    ".velocity-stalks must be inside .grid-area, not outside .editor-container",
  );
  assert.match(
    html,
    /class="pr-key vel-key"/,
    ".velocity-stalks must include a sticky 48px .pr-key.vel-key column to align with note rows",
  );
  assert.match(
    html,
    /class="pr-cells vel-cells"/,
    ".velocity-stalks must wrap stalks in .pr-cells.vel-cells to match .pr-row flex geometry",
  );
  assert.match(
    html,
    /\.vel-stalk\s*\{[^}]*min-width:\s*24px/s,
    ".vel-stalk CSS must specify min-width: 24px matching .pr-cell",
  );

  // 3. Interactive velocity adjustment via pointerdown on .vel-stalk
  assert.equal(
    typeof stalkHandlers.pointerdown,
    "function",
    ".vel-stalk must bind pointerdown listener for interactive velocity editing",
  );
  stalkHandlers.pointerdown({
    clientY: 220,
    preventDefault: () => {},
  });
  await new Promise((r) => setTimeout(r, 10));

  const updatedTrack = scdaw
    .getProject()
    .tracks.find((t) => t.id === editor._selectedTrackId);
  const step0Notes = updatedTrack.notes.filter((n) => n.position === 0);
  assert.ok(step0Notes.length > 0, "Selected track has note(s) at step 0");
  assert.equal(
    step0Notes[0].velocity,
    0.5,
    "Pointerdown at vertical midpoint of .vel-stalk updates step 0 note velocity to 0.5",
  );
});

test("scdaw-timeline: renders audio tracks, audio clips, and toggles automation lanes with ARIA compliance", async () => {
  const { scdaw } = await import("../.agents/scripts/scdaw-engine.js");
  const { DawTimelineElement } =
    await import("../.agents/scripts/components/scdaw-timeline.js");

  await scdaw.resetProject({ template: "empty" });

  // Add an audio track with a clip
  const addRes = await scdaw.sendCommand("add_track", {
    kind: "audio",
    name: "Lead Vocal",
  });
  const audioTrackId = addRes.trackId;

  await scdaw.sendCommand("add_audio_clip", {
    trackId: audioTrackId,
    clip: {
      id: "clip_vox_chorus",
      name: "Vocal Chorus",
      time: 1,
      duration: 2,
    },
  });

  // Set an automation point
  await scdaw.sendCommand("set_automation", {
    trackId: audioTrackId,
    param: "volume",
    time: 1,
    value: 0.9,
  });

  const timeline = new DawTimelineElement();
  let addAudioBtn = null;
  let autoBtn = null;

  const makeBtnMock = () => {
    const listeners = new Map();
    const btn = {
      dataset: { track: audioTrackId, param: "volume" },
      addEventListener: (evt, fn) => listeners.set(evt, fn),
      click: () =>
        listeners.get("click")?.({
          target: btn,
          currentTarget: btn,
          stopPropagation() {},
          preventDefault() {},
        }),
    };
    return btn;
  };

  timeline.shadowRoot = {
    innerHTML: "",
    getElementById: (id) => {
      if (id === "add-audio-btn") {
        addAudioBtn = makeBtnMock();
        return addAudioBtn;
      }
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel === ".auto-btn") {
        autoBtn = makeBtnMock();
        return [autoBtn];
      }
      return [];
    },
  };

  timeline.render();

  // Verify presence of Add Audio button
  assert.ok(addAudioBtn, "#add-audio-btn element exists in timeline");
  assert.match(
    timeline.shadowRoot.innerHTML,
    /id="add-audio-btn"[^>]*aria-label="Add audio track"/,
  );

  // Verify audio track and audio clip rendered with ARIA attributes
  assert.match(
    timeline.shadowRoot.innerHTML,
    /class="[^"]*scdaw-timeline__clip--audio[^"]*"[^>]*role="button"[^>]*aria-label="Audio clip Vocal Chorus/,
  );
  assert.match(
    timeline.shadowRoot.innerHTML,
    /class="[^"]*scdaw-timeline__clip-handle--left[^"]*"[^>]*role="slider"[^>]*aria-label="Trim start for Vocal Chorus"[^>]*title="Drag to trim start"/,
  );
  assert.match(
    timeline.shadowRoot.innerHTML,
    /class="[^"]*scdaw-timeline__clip-handle--right[^"]*"[^>]*role="slider"[^>]*aria-label="Resize duration for Vocal Chorus"[^>]*title="Drag to resize duration"/,
  );

  // Verify Record Arm and Import buttons on audio track header
  assert.match(
    timeline.shadowRoot.innerHTML,
    /class="[^"]*record-arm-btn[^"]*"[^>]*aria-label="Arm recording for Lead Vocal"[^>]*aria-pressed="false"/,
  );
  assert.match(
    timeline.shadowRoot.innerHTML,
    /class="[^"]*import-audio-btn[^"]*"[^>]*aria-label="Import audio file into Lead Vocal"/,
  );
  assert.match(
    timeline.shadowRoot.innerHTML,
    /class="[^"]*delete-track-btn[^"]*"[^>]*aria-label="Delete Lead Vocal"/,
  );

  // Toggle automation lane
  assert.equal(timeline._expandedAutomation.has(audioTrackId), false);
  autoBtn.click();
  assert.equal(timeline._expandedAutomation.has(audioTrackId), true);

  // Verify automation row and controls rendered
  assert.match(
    timeline.shadowRoot.innerHTML,
    new RegExp(
      `class="[^"]*automation-row[^"]*"[^>]*data-track="${audioTrackId}"`,
    ),
  );
  assert.match(
    timeline.shadowRoot.innerHTML,
    /class="[^"]*auto-param-select[^"]*"[^>]*aria-label="Automation parameter for Lead Vocal"/,
  );
  assert.match(
    timeline.shadowRoot.innerHTML,
    /class="[^"]*auto-lane[^"]*"[^>]*role="application"/,
  );
  assert.match(
    timeline.shadowRoot.innerHTML,
    /class="[^"]*scdaw-timeline__auto-svg[^"]*"/,
  );
});

test("scdaw-timeline: track header enforces strict overflow containment, max-width, and non-overlapping controls", async () => {
  const { scdaw } = await import("../.agents/scripts/scdaw-engine.js");
  const { DawTimelineElement } =
    await import("../.agents/scripts/components/scdaw-timeline.js");

  await scdaw.resetProject({ template: "empty" });

  const addRes = await scdaw.sendCommand("add_track", {
    kind: "audio",
    name: "Audio 1",
  });

  const timeline = new DawTimelineElement();
  timeline.shadowRoot = {
    innerHTML: "",
    getElementById: () => null,
    querySelectorAll: () => [],
  };
  timeline.render();
  const html = timeline.shadowRoot.innerHTML;

  // 1. Verify stylesheet guarantees overflow containment and max-width on track-header
  assert.match(
    html,
    /\.scdaw-timeline__track-header,\s*\.track-header\s*\{[^}]*max-width:\s*var\(--track-header-w\)/,
    "Track header must declare max-width: var(--track-header-w) to prevent expanding into lane area",
  );
  assert.match(
    html,
    /\.scdaw-timeline__track-header,\s*\.track-header\s*\{[^}]*overflow:\s*hidden/,
    "Track header must declare overflow: hidden to contain all child controls",
  );

  // 2. Verify controls container wraps and respects 100% max-width
  assert.match(
    html,
    /\.scdaw-timeline__controls\s*\{[^}]*flex-wrap:\s*wrap/,
    "Track controls container must enable flex-wrap: wrap",
  );
  assert.match(
    html,
    /\.scdaw-timeline__controls\s*\{[^}]*max-width:\s*100%/,
    "Track controls container must declare max-width: 100%",
  );

  // 3. Verify markup separates track title and delete button into .scdaw-timeline__track-top
  assert.match(
    html,
    /class="[^"]*scdaw-timeline__track-top[^"]*"[\s\S]*?class="[^"]*delete-track-btn[^"]*"[^>]*aria-label="Delete Audio 1"/,
    "Delete button must reside in .scdaw-timeline__track-top alongside track title",
  );

  // 4. Verify playback & mixing buttons reside in .scdaw-timeline__controls
  assert.match(
    html,
    /class="[^"]*scdaw-timeline__controls[^"]*"[\s\S]*?class="[^"]*record-arm-btn[^"]*"[\s\S]*?class="[^"]*import-audio-btn[^"]*"[\s\S]*?class="[^"]*mute-btn[^"]*"[\s\S]*?class="[^"]*solo-btn[^"]*"/,
    "Track mixing controls must reside together inside .scdaw-timeline__controls",
  );
});

test("scdaw ground-up responsive toolbar & container queries: flattened sibling toolbar groups, zero view-switcher scrollbar/overlap, @supports-isolated @media fallbacks, and full custom element container query + ARIA compliance", async () => {
  const [
    workbenchContent,
    transportContent,
    timelineContent,
    editorContent,
    browserContent,
    devicesContent,
    statusbarContent,
    sequencerContent,
    mixerContent,
    knobContent,
    stylesContent,
  ] = await Promise.all([
    fs.readFile(
      new URL(
        "../.agents/scripts/components/scdaw-workbench.js",
        import.meta.url,
      ),
      "utf-8",
    ),
    fs.readFile(
      new URL(
        "../.agents/scripts/components/scdaw-transport.js",
        import.meta.url,
      ),
      "utf-8",
    ),
    fs.readFile(
      new URL(
        "../.agents/scripts/components/scdaw-timeline.js",
        import.meta.url,
      ),
      "utf-8",
    ),
    fs.readFile(
      new URL("../.agents/scripts/components/scdaw-editor.js", import.meta.url),
      "utf-8",
    ),
    fs.readFile(
      new URL(
        "../.agents/scripts/components/scdaw-browser.js",
        import.meta.url,
      ),
      "utf-8",
    ),
    fs.readFile(
      new URL(
        "../.agents/scripts/components/scdaw-devices.js",
        import.meta.url,
      ),
      "utf-8",
    ),
    fs.readFile(
      new URL(
        "../.agents/scripts/components/scdaw-statusbar.js",
        import.meta.url,
      ),
      "utf-8",
    ),
    fs.readFile(
      new URL(
        "../.agents/scripts/components/scdaw-sequencer.js",
        import.meta.url,
      ),
      "utf-8",
    ),
    fs.readFile(
      new URL("../.agents/scripts/components/scdaw-mixer.js", import.meta.url),
      "utf-8",
    ),
    fs.readFile(
      new URL("../.agents/scripts/components/scdaw-knob.js", import.meta.url),
      "utf-8",
    ),
    fs.readFile(
      new URL("../.agents/scripts/components/scdaw-styles.js", import.meta.url),
      "utf-8",
    ),
  ]);

  // 1. Shared styles (.btn and .badge) enforce intrinsic non-shrinking single-line pills/buttons
  assert.match(
    stylesContent,
    /\.btn\s*\{[^}]*white-space:\s*nowrap/s,
    ".btn must enforce white-space: nowrap",
  );
  assert.match(
    stylesContent,
    /\.btn\s*\{[^}]*flex-shrink:\s*0/s,
    ".btn must enforce flex-shrink: 0 so buttons never crush or spill out of flex groups",
  );
  assert.match(
    stylesContent,
    /\.badge\s*\{[^}]*white-space:\s*nowrap/s,
    ".badge must enforce white-space: nowrap so badges like 'Synth Preset' or '1 Bar (4/4)' never wrap mid-pill",
  );
  assert.match(
    stylesContent,
    /\.badge\s*\{[^}]*flex-shrink:\s*0/s,
    ".badge must enforce flex-shrink: 0",
  );

  // 2. Workbench toolbar groups must be flattened sibling children of .scdaw-workbench__toolbar
  //    and .scdaw-workbench__view-switcher must NOT use overflow-x: auto (no scrollbar over Bounce WAV)
  assert.doesNotMatch(
    workbenchContent,
    /\.scdaw-workbench__view-switcher\s*\{[^}]*overflow-x:\s*auto/s,
    ".scdaw-workbench__view-switcher must not use overflow-x: auto which spawns a scrollbar over adjacent buttons",
  );
  assert.match(
    workbenchContent,
    /scdaw-workbench__toolbar-group--docks/,
    "Dock toggles should be a dedicated toolbar group (--docks) sibling so Browser/Studio/Mixer flow directly next to Reset",
  );
  assert.match(
    workbenchContent,
    /@container scdaw-workbench\s*\(\s*min-width:\s*640px\s*\)\s*\{[\s\S]*?\.scdaw-workbench__toolbar-group\s*\{[^}]*flex:\s*0\s+0\s+auto/,
    "At >= 640px, .scdaw-workbench__toolbar-group must use flex: 0 0 auto so groups never shrink below content width or overlap Bounce WAV",
  );

  // 3. @media fallbacks must be isolated inside @supports not (container-type: inline-size)
  //    so desktop viewports never override narrow docked container queries
  for (const [name, content] of [
    ["scdaw-workbench.js", workbenchContent],
    ["scdaw-transport.js", transportContent],
    ["scdaw-editor.js", editorContent],
    ["scdaw-timeline.js", timelineContent],
    ["scdaw-statusbar.js", statusbarContent],
  ]) {
    assert.match(
      content,
      /@supports\s+not\s*\(\s*container-type:\s*inline-size\s*\)/,
      `${name} must isolate @media fallbacks inside @supports not (container-type: inline-size)`,
    );
  }

  // 4. All layout custom elements must declare container-type: inline-size on :host
  //    and strictly use mobile-first min-width @container queries (never desktop-first max-width)
  for (const [name, content] of [
    ["scdaw-workbench.js", workbenchContent],
    ["scdaw-transport.js", transportContent],
    ["scdaw-timeline.js", timelineContent],
    ["scdaw-editor.js", editorContent],
    ["scdaw-browser.js", browserContent],
    ["scdaw-devices.js", devicesContent],
    ["scdaw-statusbar.js", statusbarContent],
    ["scdaw-sequencer.js", sequencerContent],
    ["scdaw-mixer.js", mixerContent],
  ]) {
    assert.match(
      content,
      /container-type:\s*inline-size/,
      `${name} must establish container-type: inline-size`,
    );
    assert.doesNotMatch(
      content,
      /@container[^{]*\(\s*max-width:/,
      `${name} must be strictly Mobile-First (min-width @container queries, never max-width)`,
    );
  }

  // 5. Transport bar at >= 640px must allow wrapping and maintain gap so 001:1:1 and BPM never collide
  assert.match(
    transportContent,
    /@container scdaw-transport\s*\(\s*min-width:\s*640px\s*\)\s*\{[\s\S]*?flex-wrap:\s*wrap/,
    "scdaw-transport must allow flex-wrap: wrap in its >= 640px container rule so playback and tempo groups never collide or clip Panic",
  );

  // 6. Timeline uses @container scdaw-timeline instead of bare @media for track header width
  assert.match(
    timelineContent,
    /@container scdaw-timeline\s*\(\s*min-width:\s*520px\s*\)/,
    "scdaw-timeline must use @container scdaw-timeline to expand --track-header-w only when the timeline container itself is wide",
  );

  // 7. Knob implements WCAG role="slider", keyboard navigation, touch-action: none, and BEM classes
  assert.match(knobContent, /role=["']slider["']/);
  assert.match(knobContent, /touch-action:\s*none/);
  assert.match(knobContent, /scdaw-knob/);
});

test("scdaw-browser & scdaw-workbench: mobile-first container query height capping and internal scroll containment", async () => {
  const [workbenchContent, browserContent] = await Promise.all([
    fs.readFile(
      new URL(
        "../.agents/scripts/components/scdaw-workbench.js",
        import.meta.url,
      ),
      "utf-8",
    ),
    fs.readFile(
      new URL(
        "../.agents/scripts/components/scdaw-browser.js",
        import.meta.url,
      ),
      "utf-8",
    ),
  ]);

  // 1. Mobile-First base styles for #browser-container in workbench
  // Bounded height cap so browser does not push workspace out of view on mobile
  assert.match(
    workbenchContent,
    /#browser-container\s*\{[^}]*max-height:\s*clamp\(/,
    "#browser-container must enforce a mobile-first bounded max-height with clamp()",
  );
  assert.match(
    workbenchContent,
    /#browser-container\s*\{[^}]*overflow:\s*hidden/,
    "#browser-container must enforce overflow: hidden to contain scrollable children",
  );
  assert.match(
    workbenchContent,
    /#browser-container\s*\{[^}]*min-height:\s*0/,
    "#browser-container must enforce min-height: 0 to allow flex/grid shrinking",
  );

  // 2. Progressive enhancement for tablet/desktop in @container scdaw-workbench (min-width: 640px)
  // Height is capped relative to center-stack UI elements and viewport
  assert.match(
    workbenchContent,
    /@container scdaw-workbench\s*\(\s*min-width:\s*640px\s*\)\s*\{[\s\S]*?#browser-container\s*\{[^}]*max-height:\s*var\(--center-stack-h/,
    "#browser-container must cap height relative to center-stack UI elements (--center-stack-h) at >= 640px container width",
  );

  // 3. Dynamic height synchronization: workbench measures #center-stack and sets --center-stack-h
  assert.match(
    workbenchContent,
    /--center-stack-h/,
    "Workbench must define and update --center-stack-h CSS variable",
  );

  // 4. scdaw-browser internal styles: :host and inner panel must not expand unboundedly
  assert.match(
    browserContent,
    /:host\s*\{[^}]*min-height:\s*0/,
    "scdaw-browser :host must declare min-height: 0",
  );
  assert.match(
    browserContent,
    /:host\s*\{[^}]*max-height:\s*100%/,
    "scdaw-browser :host must declare max-height: 100%",
  );
  assert.match(
    browserContent,
    /:host\s*\{[^}]*overflow:\s*hidden/,
    "scdaw-browser :host must declare overflow: hidden",
  );

  // 5. scdaw-browser item list: flex shrink and scroll containment per modern-web-guidance
  assert.match(
    browserContent,
    /\.item-list\s*\{[^}]*min-height:\s*0/,
    ".item-list must declare min-height: 0 so flex child shrinks and scrolls",
  );
  assert.match(
    browserContent,
    /\.item-list\s*\{[^}]*overflow-y:\s*auto/,
    ".item-list must declare overflow-y: auto",
  );
  assert.match(
    browserContent,
    /\.item-list\s*\{[^}]*overscroll-behavior:\s*contain/,
    ".item-list must declare overscroll-behavior: contain to prevent scroll chaining",
  );
  assert.match(
    browserContent,
    /\.item-list\s*\{[^}]*scrollbar-gutter:\s*stable/,
    ".item-list must declare scrollbar-gutter: stable to prevent layout shifts",
  );

  // 6. Fixed elements inside scdaw-browser must have flex-shrink: 0
  assert.match(
    browserContent,
    /\.scdaw-browser__header[^}]*flex-shrink:\s*0/,
    "Browser header must declare flex-shrink: 0",
  );
  assert.match(
    browserContent,
    /\.search-box[^}]*flex-shrink:\s*0/,
    "Search box must declare flex-shrink: 0",
  );

  // 7. Internal container query @container scdaw-browser (min-width: ...) for component-level reactivity
  assert.match(
    browserContent,
    /@container scdaw-browser\s*\(\s*min-width:\s*\d+px\s*\)/,
    "scdaw-browser must declare internal mobile-first container query @container scdaw-browser",
  );
});
