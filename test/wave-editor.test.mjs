import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  DawEngine,
  formatUserError,
} from "../.agents/scripts/shadow-claw-daw-engine.js";
import { formatTelemetryStatus } from "../.agents/scripts/components/shadow-claw-daw-status-bar.js";
import {
  computeWaveformEnvelope,
  clampWaveSelection,
  snapSelectionToZeroCrossings,
  applyEnvelopePointDrag,
  computeWaveViewport,
  renderWaveformSvg,
  extractClipDisplayWindow,
  computeWavePlayheadState,
} from "../.agents/scripts/components/shadow-claw-daw-wave-editor.js";
import { PPQN } from "../.agents/scripts/shadow-claw-daw.js";
import {
  resolveWorkbenchResponsiveLayout,
  resolveWorkbenchButtonStates,
  resolveWorkbenchPanels,
} from "../.agents/scripts/components/shadow-claw-daw-workbench.js";
import { handleToolDispatch } from "../.agents/scripts/shadow-claw-daw-adapter.js";
import { installPageSwipeGuard } from "../.agents/scripts/components/shadow-claw-daw-styles.js";
import { FakeAudioContext } from "./helpers/fake-audio-context.mjs";

function makeSine(freq, sampleRate, durationSec, amp = 0.5) {
  const len = Math.round(sampleRate * durationSec);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return out;
}

test("Phase 3.1: Systemic error surfacing (formatUserError, reportError, clearError, statusbar, transport, workbench)", async () => {
  const notFoundMsg = formatUserError(
    { name: "NotFoundError", message: "Requested device not found" },
    "Recording",
  );
  assert.match(notFoundMsg, /microphone|audio input device/i);
  assert.match(notFoundMsg, /^Recording:/);

  const notAllowedMsg = formatUserError(
    { name: "NotAllowedError", message: "Permission denied" },
    "Recording",
  );
  assert.match(notAllowedMsg, /permission/i);

  const notReadableMsg = formatUserError(
    { name: "NotReadableError", message: "Could not start audio source" },
    "Recording",
  );
  assert.match(notReadableMsg, /busy|unavailable/i);

  const engine = new DawEngine({ audioContext: new FakeAudioContext() });
  const events = [];
  engine.addEventListener("scdaw-error", (e) => events.push(e.detail));

  const reported = engine.reportError(
    { name: "NotFoundError", message: "Requested device not found" },
    { title: "Recording Error", context: "Recording" },
  );
  assert.equal(reported.title, "Recording Error");
  assert.equal(reported.code, "NotFoundError");
  assert.equal(events.length, 1);
  assert.equal(engine.getState().lastError.title, "Recording Error");

  const telemetry = formatTelemetryStatus(
    engine.getState(),
    engine.getProject(),
  );
  assert.ok(telemetry.errorText.includes("Recording Error"));
  assert.match(telemetry.errorText, /microphone|audio input device/i);

  engine.clearError();
  assert.equal(engine.getState().lastError, null);
  assert.equal(
    formatTelemetryStatus(engine.getState(), engine.getProject()).errorText,
    "",
  );

  // Source checks across transport, statusbar, and workbench
  const [transportSrc, statusbarSrc, workbenchSrc] = await Promise.all([
    fs.readFile(
      new URL(
        "../.agents/scripts/components/shadow-claw-daw-transport.js",
        import.meta.url,
      ),
      "utf8",
    ),
    fs.readFile(
      new URL(
        "../.agents/scripts/components/shadow-claw-daw-status-bar.js",
        import.meta.url,
      ),
      "utf8",
    ),
    fs.readFile(
      new URL(
        "../.agents/scripts/components/shadow-claw-daw-workbench.js",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.doesNotMatch(transportSrc, /scdaw\.requestDialog\?\./);
  const reportMatches =
    transportSrc.match(/scdaw\.reportError(?:\?\.)?\(/g) || [];
  const dialogMatches = transportSrc.match(/showErrorDialog\(/g) || [];
  assert.ok(
    reportMatches.length >= 1 && dialogMatches.length >= 4,
    `Expected shadow-claw-daw-transport.js to surface all recording errors via showErrorDialog + scdaw.reportError`,
  );
  assert.match(statusbarSrc, /id=["']error-stat["']/);
  assert.match(
    workbenchSrc,
    /id=["']scdaw-error-banner["'][^>]*role=["']alert["']/,
  );
  assert.match(workbenchSrc, /id=["']scdaw-error-dismiss["']/);
});

test("Phase 3.2: Wave editor pure helpers (envelope, selection, zero-crossing snap, envelope drag eat/restore, viewport, SVG)", () => {
  const sr = 44100;
  const sine = makeSine(220, sr, 0.2, 0.8);

  // 1. computeWaveformEnvelope
  const env = computeWaveformEnvelope(sine, 20);
  assert.equal(env.length, 20);
  const maxPeak = Math.max(
    ...env.map((b) => Math.max(Math.abs(b.min), Math.abs(b.max))),
  );
  assert.ok(Math.abs(maxPeak - 0.8) < 0.05);
  assert.ok(Math.abs(env[0].rms - 0.8 / Math.SQRT2) < 0.12);
  assert.deepEqual(computeWaveformEnvelope(new Float32Array(0), 10), []);

  // 2. clampWaveSelection sorts reversed bounds and clamps
  const sel = clampWaveSelection({
    startSec: 1.5,
    endSec: 0.4,
    durationSec: 1.2,
  });
  assert.equal(sel.startSec, 0.4);
  assert.equal(sel.endSec, 1.2);
  assert.ok(Math.abs(sel.lengthSec - 0.8) < 1e-6);

  // 3. snapSelectionToZeroCrossings
  const snapped = snapSelectionToZeroCrossings(
    [sine],
    { startSec: 0.02, endSec: 0.1 },
    sr,
  );
  const sIdx = Math.round(snapped.startSec * sr);
  const eIdx = Math.round(snapped.endSec * sr);
  assert.ok(sine[sIdx - 1] <= 0 && sine[sIdx] >= 0);
  assert.ok(sine[eIdx - 1] <= 0 && sine[eIdx] >= 0);

  // 4. applyEnvelopePointDrag: envelope eat/restore semantics
  const origPts = [
    { time: 0.5, value: 1.0 },
    { time: 1.0, value: 0.5 },
    { time: 2.0, value: 1.0 },
  ];
  // Drag point 0 rightward past point 1 (to t=1.4) -> consumes point 1
  const eaten = applyEnvelopePointDrag(origPts, {
    index: 0,
    timeSec: 1.4,
    value: 1.2,
    durationSec: 4.0,
    originalPoints: origPts,
  });
  assert.equal(eaten.points.length, 2);
  assert.equal(eaten.draggedIndex, 0);
  assert.equal(eaten.points[0].time, 1.4);
  assert.equal(eaten.points[0].value, 1.2);

  // Drag back leftward to t=0.6 -> restores point 1 from originalPoints
  const restored = applyEnvelopePointDrag(eaten.points, {
    index: eaten.draggedIndex,
    timeSec: 0.6,
    value: 1.1,
    durationSec: 4.0,
    originalPoints: origPts,
  });
  assert.equal(restored.points.length, 3);
  assert.equal(restored.points[1].time, 1.0);
  assert.equal(restored.points[1].value, 0.5);

  // 5. computeWaveViewport
  const vp = computeWaveViewport({ durationSec: 10, zoom: 4, scrollFrac: 0.5 });
  assert.equal(vp.viewDurSec, 2.5);
  assert.equal(vp.viewStartSec, 3.75);
  assert.equal(vp.viewEndSec, 6.25);

  // 6. renderWaveformSvg
  const svg = renderWaveformSvg({
    channels: [sine],
    durationSec: 0.2,
    viewStartSec: 0,
    viewEndSec: 0.2,
    selection: { startSec: 0.05, endSec: 0.15, lengthSec: 0.1 },
    clip: {
      id: "c1",
      name: "Vox",
      fadeIn: 0.04,
      fadeOut: 0.04,
      gainEnvelope: [{ time: 0.1, value: 0.7 }],
    },
  });
  assert.match(svg, /<svg/);
  assert.match(svg, /scdaw-wave__selection/);
  assert.match(svg, /scdaw-wave__env-point/);
  assert.match(svg, /role=["']slider["']/);
});

test("Phase 3.3: Workbench audio tab, audio-full layout, render_surface, and mobile-first ARIA CSS", async () => {
  const audioFull = resolveWorkbenchResponsiveLayout({
    containerWidth: 390,
    viewMode: "audio-full",
  });
  assert.equal(audioFull.isFullWidth, true);
  assert.equal(audioFull.activeFocus, "audio");
  assert.equal(audioFull.showBrowser, false);
  assert.equal(audioFull.showMixer, false);

  const btnStates = resolveWorkbenchButtonStates({
    viewMode: "audio-full",
    isMobile: true,
  });
  assert.equal(btnStates.audioFull.active, true);
  assert.equal(btnStates.studio.active, false);

  const panels = resolveWorkbenchPanels(true, true, "audio");
  assert.equal(panels.editorMode, "audio");

  const surface = await handleToolDispatch("scdaw_render_surface", {
    element: "wave-editor",
  });
  assert.equal(
    surface.element,
    "<shadow-claw-daw-wave-editor></shadow-claw-daw-wave-editor>",
  );

  const [waveSrc, workbenchSrc] = await Promise.all([
    fs.readFile(
      new URL(
        "../.agents/scripts/components/shadow-claw-daw-wave-editor.js",
        import.meta.url,
      ),
      "utf8",
    ),
    fs.readFile(
      new URL(
        "../.agents/scripts/components/shadow-claw-daw-workbench.js",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(waveSrc, /container-name:\s*shadow-claw-daw-wave-editor/);
  assert.match(
    waveSrc,
    /@container shadow-claw-daw-wave-editor\s*\(\s*min-width:\s*640px\s*\)/,
  );
  assert.match(
    waveSrc,
    /@supports\s+not\s*\(\s*container-type:\s*inline-size\s*\)/,
  );
  assert.match(waveSrc, /@media\s*\(\s*pointer:\s*coarse\s*\)/);
  assert.match(waveSrc, /min-height:\s*44px/);
  assert.doesNotMatch(waveSrc, /:host-context\(/);
  assert.match(waveSrc, /font:\s*inherit/);
  assert.match(waveSrc, /role=["']region["']/);
  assert.match(waveSrc, /role=["']toolbar["']/);
  assert.match(waveSrc, /aria-live=["']polite["']/);
  assert.match(
    waveSrc,
    /(?:defineElement|customElements\.define)\(\s*["']shadow-claw-daw-wave-editor["']/,
  );

  assert.match(workbenchSrc, /id=["']center-editor-audio-btn["']/);
  assert.match(workbenchSrc, /id=["']mode-audio-full-btn["']/);
  assert.match(
    workbenchSrc,
    /<shadow-claw-daw-wave-editor><\/shadow-claw-daw-wave-editor>/,
  );
});

test("Page swipe guard: installPageSwipeGuard ref-counts ancestor data-no-swipe/data-no-nav and restores cleanly", async () => {
  const makeNode = () => {
    const attrs = new Map();
    return {
      _closestMap: {},
      setAttribute(k, v) {
        attrs.set(k, String(v));
      },
      getAttribute(k) {
        return attrs.has(k) ? attrs.get(k) : null;
      },
      removeAttribute(k) {
        attrs.delete(k);
      },
      closest(sel) {
        return this._closestMap[sel] || null;
      },
    };
  };

  const viewer = makeNode();
  const rendered = makeNode();
  const pageWrapper = makeNode();
  const host1 = makeNode();
  const host2 = makeNode();

  for (const host of [host1, host2]) {
    host._closestMap = {
      ".scdaw-workbench-page": pageWrapper,
      ".pages__rendered": rendered,
      ".pages__viewer": viewer,
    };
  }

  const cleanup1 = installPageSwipeGuard(host1);
  for (const el of [host1, pageWrapper, rendered, viewer]) {
    assert.equal(el.getAttribute("data-no-swipe"), "true");
    assert.equal(el.getAttribute("data-no-nav"), "true");
  }

  // Overlapping mount keeps shared ancestor guards active after cleanup1
  const cleanup2 = installPageSwipeGuard(host2);
  cleanup1();
  assert.equal(rendered.getAttribute("data-no-swipe"), "true");
  assert.equal(viewer.getAttribute("data-no-swipe"), "true");
  assert.equal(rendered.getAttribute("data-no-nav"), "true");
  assert.equal(viewer.getAttribute("data-no-nav"), "true");

  // Duplicate cleanup1 call must not underflow
  cleanup1();
  assert.equal(viewer.getAttribute("data-no-swipe"), "true");

  cleanup2();
  for (const el of [pageWrapper, rendered, viewer]) {
    assert.equal(el.getAttribute("data-no-swipe"), null);
    assert.equal(el.getAttribute("data-no-nav"), null);
  }

  // Pre-existing attributes must be restored rather than removed
  viewer.setAttribute("data-no-swipe", "preexisting");
  const cleanup3 = installPageSwipeGuard(host1);
  assert.equal(viewer.getAttribute("data-no-swipe"), "true");
  cleanup3();
  assert.equal(viewer.getAttribute("data-no-swipe"), "preexisting");

  // Verify workbench, wave-editor, and timeline wire swipe/drag navigation guards
  const [wbSrc, waveSrc, timelineSrc] = await Promise.all([
    fs.readFile(
      new URL(
        "../.agents/scripts/components/shadow-claw-daw-workbench.js",
        import.meta.url,
      ),
      "utf8",
    ),
    fs.readFile(
      new URL(
        "../.agents/scripts/components/shadow-claw-daw-wave-editor.js",
        import.meta.url,
      ),
      "utf8",
    ),
    fs.readFile(
      new URL(
        "../.agents/scripts/components/shadow-claw-daw-timeline.js",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(wbSrc, /installPageSwipeGuard/);
  assert.match(
    wbSrc,
    /this\._cleanupSwipeGuard\s*=\s*installPageSwipeGuard\(this\)/,
  );
  assert.match(
    wbSrc,
    /scdaw-workbench[^>]*data-no-swipe=["']true["'][^>]*data-no-nav=["']true["']/,
  );

  assert.match(waveSrc, /installPageSwipeGuard/);
  assert.match(
    waveSrc,
    /this\._cleanupSwipeGuard\s*=\s*installPageSwipeGuard\(this\)/,
  );
  assert.match(
    waveSrc,
    /class=["']scdaw-wave["'][^>]*data-no-swipe=["']true["'][^>]*data-no-nav=["']true["']/,
  );
  assert.match(
    waveSrc,
    /id=["']wave-stage["'][^>]*data-no-swipe=["']true["'][^>]*data-no-nav=["']true["']/,
  );

  assert.match(
    timelineSrc,
    /scdaw-timeline daw-panel[^>]*data-no-swipe=["']true["'][^>]*data-no-nav=["']true["']/,
  );
});

test("Wave Editor: extractClipDisplayWindow slices trimmed clip offset/duration & computeWavePlayheadState tracks playback cursor", async () => {
  const sr = 1000;
  const fullPcm = new Float32Array(sr * 4); // 4s = 8 beats @ 120 BPM
  fullPcm.fill(0.1, 0, sr * 1); // [0, 1s): 0.1
  fullPcm.fill(0.8, sr * 1, sr * 3); // [1, 3s): 0.8 (trimmed region)
  fullPcm.fill(0.1, sr * 3, sr * 4); // [3, 4s): 0.1
  const sampleBuf = {
    numberOfChannels: 1,
    length: fullPcm.length,
    sampleRate: sr,
    duration: 4.0,
    getChannelData: () => fullPcm,
  };

  // Trimmed to beats [2, 6) => clip.time = 2, duration = 4 (2.0s @ 120 BPM), offset = 1.0s
  const trimmedClip = {
    id: "clip_trimmed",
    name: "Trimmed Vox",
    time: 2,
    duration: 4,
    offset: 1.0,
  };
  const win = extractClipDisplayWindow(sampleBuf, trimmedClip, 120);
  assert.equal(win.durationSec, 2.0);
  assert.equal(win.offsetSec, 1.0);
  assert.equal(win.sampleRate, sr);
  assert.equal(win.channels.length, 1);
  assert.equal(win.channels[0].length, sr * 2);
  assert.ok(
    Math.abs(win.channels[0][0] - 0.8) < 1e-4 &&
      Math.abs(win.channels[0][win.channels[0].length - 1] - 0.8) < 1e-4,
    "Sliced display window must contain only the trimmed [1s, 3s) PCM samples",
  );

  // Waveform buckets on sliced channels should show ~0.8 throughout
  const buckets = computeWaveformEnvelope(win.channels[0], 10);
  assert.ok(buckets.every((b) => Math.abs(b.max - 0.8) < 1e-4));

  // Playhead state: stopped -> hidden
  assert.equal(
    computeWavePlayheadState({
      playing: false,
      positionPpqn: 4 * PPQN.Quarter,
      clip: trimmedClip,
      bpm: 120,
      viewStartSec: 0,
      viewEndSec: 2,
    }).visible,
    false,
  );

  // Playhead before clip.time -> hidden
  assert.equal(
    computeWavePlayheadState({
      playing: true,
      positionPpqn: 1 * PPQN.Quarter,
      clip: trimmedClip,
      bpm: 120,
      viewStartSec: 0,
      viewEndSec: 2,
    }).visible,
    false,
  );

  // Playhead halfway through clip (beat 4 of [2, 6) => clipTimeSec = 1.0s of 2.0s)
  const midCursor = computeWavePlayheadState({
    playing: true,
    positionPpqn: 4 * PPQN.Quarter,
    clip: trimmedClip,
    bpm: 120,
    viewStartSec: 0,
    viewEndSec: 2,
  });
  assert.equal(midCursor.visible, true);
  assert.equal(midCursor.clipTimeSec, 1.0);
  assert.equal(midCursor.leftPct, 50);

  // Zoomed viewport [0.5, 1.5] keeps cursor centered at 50%
  const zoomedIn = computeWavePlayheadState({
    playing: true,
    positionPpqn: 4 * PPQN.Quarter,
    clip: trimmedClip,
    bpm: 120,
    viewStartSec: 0.5,
    viewEndSec: 1.5,
  });
  assert.equal(zoomedIn.visible, true);
  assert.equal(zoomedIn.leftPct, 50);

  // Out-of-viewport zoom [1.2, 2.0] hides cursor
  const zoomedOut = computeWavePlayheadState({
    playing: true,
    positionPpqn: 4 * PPQN.Quarter,
    clip: trimmedClip,
    bpm: 120,
    viewStartSec: 1.2,
    viewEndSec: 2.0,
  });
  assert.equal(zoomedOut.visible, false);

  // Verify shadow-claw-daw-wave-editor.js wires extractClipDisplayWindow, trim refresh, and #wave-playhead RAF loop
  const waveSrc = await fs.readFile(
    new URL(
      "../.agents/scripts/components/shadow-claw-daw-wave-editor.js",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(waveSrc, /extractClipDisplayWindow\(/);
  assert.match(waveSrc, /id=["']wave-playhead["']/);
  assert.match(waveSrc, /\.scdaw-wave__playhead/);
  assert.match(waveSrc, /_startPlayheadLoop\(/);
  assert.match(waveSrc, /_updatePlayhead\(/);
  assert.match(waveSrc, /cancelAnimationFrame\(/);
  assert.match(waveSrc, /this\.render\(\)/);
});
