import test from "node:test";
import assert from "node:assert/strict";
import {
  clampSize,
  computeKeyboardResize,
  getAriaAttributes,
} from "../.agents/scripts/components/scdaw-resize-handle.js";
import {
  resolveWorkbenchResponsiveLayout,
  resolveWorkbenchButtonStates,
} from "../.agents/scripts/components/scdaw-workbench.js";

test("scdaw-resize-handle: clampSize clamps values within min and max boundaries", () => {
  assert.equal(clampSize(250, 150, 400), 250);
  assert.equal(clampSize(100, 150, 400), 150);
  assert.equal(clampSize(500, 150, 400), 400);
  assert.equal(clampSize(NaN, 150, 400), 150);
});

test("scdaw-resize-handle: computeKeyboardResize handles Arrow keys, Shift multipliers, and Home/End", () => {
  const min = 160;
  const max = 500;
  const current = 250;

  // Arrow keys standard step (+10 / -10)
  assert.equal(
    computeKeyboardResize("ArrowRight", false, current, min, max),
    260,
  );
  assert.equal(
    computeKeyboardResize("ArrowLeft", false, current, min, max),
    240,
  );
  assert.equal(
    computeKeyboardResize("ArrowDown", false, current, min, max),
    260,
  );
  assert.equal(computeKeyboardResize("ArrowUp", false, current, min, max), 240);

  // Shift modifier accelerates step (+50 / -50)
  assert.equal(
    computeKeyboardResize("ArrowRight", true, current, min, max),
    300,
  );
  assert.equal(
    computeKeyboardResize("ArrowLeft", true, current, min, max),
    200,
  );

  // Home / End jumps to boundaries
  assert.equal(computeKeyboardResize("Home", false, current, min, max), min);
  assert.equal(computeKeyboardResize("End", false, current, min, max), max);

  // Unhandled key returns current unchanged
  assert.equal(
    computeKeyboardResize("Enter", false, current, min, max),
    current,
  );
});

test("scdaw-resize-handle: getAriaAttributes generates compliant WCAG separator attributes", () => {
  const attrs = getAriaAttributes(
    "vertical",
    240,
    150,
    400,
    "Resize Browser panel",
  );
  assert.equal(attrs.role, "separator");
  assert.equal(attrs.tabindex, "0");
  assert.equal(attrs["aria-orientation"], "vertical");
  assert.equal(attrs["aria-valuenow"], "240");
  assert.equal(attrs["aria-valuemin"], "150");
  assert.equal(attrs["aria-valuemax"], "400");
  assert.equal(attrs["aria-label"], "Resize Browser panel");
});

test("scdaw-workbench: resolveWorkbenchResponsiveLayout adapts mobile-first and full-width views", () => {
  // 1. Mobile container (< 640px)
  const mobile = resolveWorkbenchResponsiveLayout({
    containerWidth: 420,
    viewMode: "studio",
    showBrowser: true,
    showMixer: true,
    browserWidth: 220,
    mixerWidth: 300,
  });
  assert.equal(mobile.isMobile, true);
  assert.equal(mobile.gridTemplateColumns, "1fr");
  assert.equal(mobile.showResizeHandles, false);

  // 2. Desktop studio mode (> 1024px)
  const desktop = resolveWorkbenchResponsiveLayout({
    containerWidth: 1200,
    viewMode: "studio",
    showBrowser: true,
    showMixer: true,
    browserWidth: 220,
    mixerWidth: 320,
  });
  assert.equal(desktop.isMobile, false);
  assert.equal(desktop.gridTemplateColumns, "220px 8px 1fr 8px 320px");
  assert.equal(desktop.showResizeHandles, true);

  // 3. Piano roll full-width view mode
  const pianoRollFull = resolveWorkbenchResponsiveLayout({
    containerWidth: 1200,
    viewMode: "piano-roll-full",
    showBrowser: true,
    showMixer: true,
    browserWidth: 220,
    mixerWidth: 320,
  });
  assert.equal(pianoRollFull.gridTemplateColumns, "1fr");
  assert.equal(pianoRollFull.isFullWidth, true);
  assert.equal(pianoRollFull.activeFocus, "piano-roll");

  // 4. Sequencer full-width view mode
  const seqFull = resolveWorkbenchResponsiveLayout({
    containerWidth: 1200,
    viewMode: "sequencer-full",
    showBrowser: true,
    showMixer: true,
    browserWidth: 220,
    mixerWidth: 320,
  });
  assert.equal(seqFull.gridTemplateColumns, "1fr");
  assert.equal(seqFull.isFullWidth, true);
  assert.equal(seqFull.activeFocus, "sequencer");

  // 5. Mixer full-width view mode
  const mixerFull = resolveWorkbenchResponsiveLayout({
    containerWidth: 1200,
    viewMode: "mixer-full",
    showBrowser: true,
    showMixer: true,
    browserWidth: 220,
    mixerWidth: 320,
  });
  assert.equal(mixerFull.gridTemplateColumns, "1fr");
  assert.equal(mixerFull.isFullWidth, true);
  assert.equal(mixerFull.activeFocus, "mixer");
});

test("scdaw-workbench: resolveWorkbenchButtonStates accurately tracks and disables Browser and Mixer buttons in full-width and mobile modes", () => {
  // 1. Studio layout with both Browser and Mixer docks enabled
  const studioBothOpen = resolveWorkbenchButtonStates({
    viewMode: "studio",
    showBrowser: true,
    showMixer: true,
    isMobile: false,
  });
  assert.deepEqual(studioBothOpen.browser, {
    active: true,
    disabled: false,
    visible: true,
  });
  assert.deepEqual(studioBothOpen.mixer, {
    active: true,
    disabled: false,
    visible: true,
  });
  assert.equal(studioBothOpen.studio.active, true);
  assert.equal(studioBothOpen.studio.disabled, false);
  assert.equal(studioBothOpen.pianoRollFull.active, false);
  assert.equal(studioBothOpen.sequencerFull.active, false);
  assert.equal(studioBothOpen.mixerFull.active, false);

  // 2. Studio layout with Browser hidden, Mixer open
  const studioNoBrowser = resolveWorkbenchButtonStates({
    viewMode: "studio",
    showBrowser: false,
    showMixer: true,
    isMobile: false,
  });
  assert.equal(studioNoBrowser.browser.active, false);
  assert.equal(studioNoBrowser.browser.disabled, false);
  assert.equal(studioNoBrowser.browser.visible, false);
  assert.equal(studioNoBrowser.mixer.active, true);
  assert.equal(studioNoBrowser.mixer.disabled, false);

  // 3. Studio layout with Mixer hidden, Browser open
  const studioNoMixer = resolveWorkbenchButtonStates({
    viewMode: "studio",
    showBrowser: true,
    showMixer: false,
    isMobile: false,
  });
  assert.equal(studioNoMixer.browser.active, true);
  assert.equal(studioNoMixer.browser.disabled, false);
  assert.equal(studioNoMixer.mixer.active, false);
  assert.equal(studioNoMixer.mixer.disabled, false);

  // 4. Full width mode: Piano Roll (Full)
  // Even if showBrowser/showMixer were true in studio, they are hidden in full-width view
  // and must be disabled and not highlighted.
  const pianoFull = resolveWorkbenchButtonStates({
    viewMode: "piano-roll-full",
    showBrowser: true,
    showMixer: true,
    isMobile: false,
  });
  assert.deepEqual(pianoFull.browser, {
    active: false,
    disabled: true,
    visible: false,
  });
  assert.deepEqual(pianoFull.mixer, {
    active: false,
    disabled: true,
    visible: false,
  });
  assert.equal(pianoFull.studio.active, false);
  assert.equal(pianoFull.pianoRollFull.active, true);
  assert.equal(pianoFull.sequencerFull.active, false);
  assert.equal(pianoFull.mixerFull.active, false);

  // 5. Full width mode: Drum Matrix (Full) / Sequencer Full
  const seqFull = resolveWorkbenchButtonStates({
    viewMode: "sequencer-full",
    showBrowser: true,
    showMixer: true,
    isMobile: false,
  });
  assert.deepEqual(seqFull.browser, {
    active: false,
    disabled: true,
    visible: false,
  });
  assert.deepEqual(seqFull.mixer, {
    active: false,
    disabled: true,
    visible: false,
  });
  assert.equal(seqFull.sequencerFull.active, true);
  assert.equal(seqFull.studio.active, false);

  // 6. Full width mode: Mixer (Full)
  const mixerFull = resolveWorkbenchButtonStates({
    viewMode: "mixer-full",
    showBrowser: true,
    showMixer: true,
    isMobile: false,
  });
  assert.deepEqual(mixerFull.browser, {
    active: false,
    disabled: true,
    visible: false,
  });
  assert.deepEqual(mixerFull.mixer, {
    active: false,
    disabled: true,
    visible: false,
  });
  assert.equal(mixerFull.mixerFull.active, true);
  assert.equal(mixerFull.studio.active, false);

  // 7. Mobile layout: dock buttons are disabled and not active
  const mobile = resolveWorkbenchButtonStates({
    viewMode: "studio",
    showBrowser: true,
    showMixer: true,
    isMobile: true,
  });
  assert.deepEqual(mobile.browser, {
    active: false,
    disabled: true,
    visible: false,
  });
  assert.deepEqual(mobile.mixer, {
    active: false,
    disabled: true,
    visible: false,
  });

  // 8. Default parameters safety check
  const defaults = resolveWorkbenchButtonStates();
  assert.equal(defaults.studio.active, true);
  assert.equal(defaults.browser.disabled, false);
  assert.equal(defaults.mixer.disabled, false);
});
