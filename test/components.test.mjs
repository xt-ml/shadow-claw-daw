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
import { computeTimelineTicks } from "../.agents/scripts/components/scdaw-timeline.js";
import {
  pitchToPianoRollRow,
  pianoRollRowToPitch,
  computeCellActiveMap,
  shouldPreserveEditorDom,
  resolveEditorScrollPosition,
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
} from "../.agents/scripts/components/scdaw-transport.js";
import { formatTelemetryStatus } from "../.agents/scripts/components/scdaw-statusbar.js";
import {
  resolveWorkbenchPanels,
  resolveWorkbenchResponsiveLayout,
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

  // Drag-and-drop import listeners are attached to the element
  assert.match(workbenchContent, /addEventListener\s*\(\s*["']dragover["']/);
  assert.match(workbenchContent, /addEventListener\s*\(\s*["']drop["']/);
});
