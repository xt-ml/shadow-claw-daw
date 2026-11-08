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

  // Inverted direction (e.g. Mixer Handle on right side of center stack)
  // Moving handle left expands the right panel (increases its width)
  assert.equal(
    computeKeyboardResize("ArrowLeft", false, current, min, max, 10, true),
    260,
  );
  // Moving handle right shrinks the right panel (decreases its width)
  assert.equal(
    computeKeyboardResize("ArrowRight", false, current, min, max, 10, true),
    240,
  );
  // Shift modifier with invert
  assert.equal(
    computeKeyboardResize("ArrowLeft", true, current, min, max, 10, true),
    300,
  );
  assert.equal(
    computeKeyboardResize("ArrowRight", true, current, min, max, 10, true),
    200,
  );
  // Home jumps to max (handle all the way left) and End jumps to min (handle all the way right)
  assert.equal(
    computeKeyboardResize("Home", false, current, min, max, 10, true),
    max,
  );
  assert.equal(
    computeKeyboardResize("End", false, current, min, max, 10, true),
    min,
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
  assert.equal(desktop.showBrowserHandle, true);
  assert.equal(desktop.showMixerHandle, true);

  // 2b. Compact Desktop / Tablet with sidebar open (e.g. 860px) and both docks enabled
  const compactStudio = resolveWorkbenchResponsiveLayout({
    containerWidth: 860,
    viewMode: "studio",
    showBrowser: true,
    showMixer: true,
    browserWidth: 220,
    mixerWidth: 300,
  });
  assert.equal(compactStudio.isMobile, false);
  assert.equal(compactStudio.showBrowser, true);
  assert.equal(compactStudio.showMixer, true);
  assert.equal(compactStudio.showBrowserHandle, true);
  assert.equal(compactStudio.showMixerHandle, true);
  assert.equal(compactStudio.gridTemplateColumns, "220px 8px 1fr 8px 300px");

  // 2c. Studio with Mixer toggled off (Browser + Center only)
  const noMixer = resolveWorkbenchResponsiveLayout({
    containerWidth: 1200,
    viewMode: "studio",
    showBrowser: true,
    showMixer: false,
    browserWidth: 220,
    mixerWidth: 320,
  });
  assert.equal(noMixer.showBrowser, true);
  assert.equal(noMixer.showMixer, false);
  assert.equal(noMixer.showBrowserHandle, true);
  assert.equal(noMixer.showMixerHandle, false);
  assert.equal(noMixer.gridTemplateColumns, "220px 8px 1fr");

  // 2d. Studio with Browser toggled off (Center + Mixer only)
  const noBrowser = resolveWorkbenchResponsiveLayout({
    containerWidth: 1200,
    viewMode: "studio",
    showBrowser: false,
    showMixer: true,
    browserWidth: 220,
    mixerWidth: 320,
  });
  assert.equal(noBrowser.showBrowser, false);
  assert.equal(noBrowser.showMixer, true);
  assert.equal(noBrowser.showBrowserHandle, false);
  assert.equal(noBrowser.showMixerHandle, true);
  assert.equal(noBrowser.gridTemplateColumns, "1fr 8px 320px");

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
  assert.equal(pianoRollFull.showResizeHandles, false);
  assert.equal(pianoRollFull.showBrowserHandle, false);
  assert.equal(pianoRollFull.showMixerHandle, false);

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
  assert.equal(seqFull.showResizeHandles, false);
  assert.equal(seqFull.showBrowserHandle, false);
  assert.equal(seqFull.showMixerHandle, false);

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
  assert.equal(mixerFull.showResizeHandles, false);
  assert.equal(mixerFull.showBrowserHandle, false);
  assert.equal(mixerFull.showMixerHandle, false);
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

test("scdaw-workbench: mixer-handle specifies invert attribute so dragging left expands the right mixer panel", async () => {
  const fs = await import("node:fs/promises");
  const workbenchContent = await fs.readFile(
    new URL(
      "../.agents/scripts/components/scdaw-workbench.js",
      import.meta.url,
    ),
    "utf-8",
  );
  assert.match(
    workbenchContent,
    /<scdaw-resize-handle[^>]+id=["']mixer-handle["'][^>]*\sinvert/,
    "mixer-handle must have the invert attribute to ensure dragging left expands the mixer and shrinks center stack",
  );
  assert.doesNotMatch(
    workbenchContent,
    /<scdaw-resize-handle[^>]+id=["']browser-handle["'][^>]*\sinvert/,
    "browser-handle must not have the invert attribute because dragging right expands the browser",
  );
});

test("scdaw-workbench: avoids LaunchParams.prototype.files getter Illegal invocation and eliminates !important resize handle CSS overrides", async () => {
  const fs = await import("node:fs/promises");
  const workbenchContent = await fs.readFile(
    new URL(
      "../.agents/scripts/components/scdaw-workbench.js",
      import.meta.url,
    ),
    "utf-8",
  );

  // 1. Must not invoke LaunchParams.prototype.files getter directly on prototype
  assert.doesNotMatch(
    workbenchContent,
    /LaunchParams\??\.prototype\??\.files/,
    "Accessing LaunchParams.prototype.files directly invokes a Web IDL getter on the prototype and throws TypeError: Illegal invocation",
  );
  assert.match(
    workbenchContent,
    /["']files["']\s+in\s+window\.LaunchParams\.prototype/,
    "Must check 'files' in window.LaunchParams.prototype using the 'in' operator",
  );

  // 2. Must not force scdaw-resize-handle visible via display: inline-flex !important
  assert.doesNotMatch(
    workbenchContent,
    /scdaw-resize-handle\s*\{\s*display:\s*inline-flex\s*!important/,
    "scdaw-resize-handle must not use display: inline-flex !important, which overrides hidden state in Full views",
  );

  // 3. Must not lock #mixer-container to var(--mixer-w) in CSS so Mixer (Full) can expand to 100% width
  assert.doesNotMatch(
    workbenchContent,
    /#mixer-container\s*\{\s*width:\s*var\(--mixer-w/,
    "#mixer-container must use width: 100% of its grid track so Mixer (Full) stretches full width",
  );
});

test("scdaw-workbench: DawWorkbenchElement lifecycle, initial Studio state, Toggle Mixer/Browser, and Full views hide inactive panels and resize handles", async () => {
  const { DawWorkbenchElement } =
    await import("../.agents/scripts/components/scdaw-workbench.js");

  // Simulate Chromium's Web IDL LaunchParams.prototype.files getter that throws Illegal invocation on prototype access
  const prevWindow = globalThis.window;
  function MockLaunchParams() {}
  Object.defineProperty(MockLaunchParams.prototype, "files", {
    get() {
      if (!(this instanceof MockLaunchParams)) {
        throw new TypeError("Illegal invocation");
      }
      return [];
    },
  });

  globalThis.window = {
    innerWidth: 1280,
    launchQueue: { setConsumer() {} },
    LaunchParams: MockLaunchParams,
  };

  try {
    const el = new DawWorkbenchElement();

    // Minimal reactive DOM mock for shadowRoot elements
    const elements = new Map();
    const makeMockEl = (id, initialClasses = []) => {
      const classSet = new Set(initialClasses);
      const attrs = new Map();
      const listeners = new Map();
      const mockObj = {
        id,
        style: { display: "", gridTemplateColumns: "" },
        disabled: false,
        hidden: false,
        title: "",
        textContent: "",
        classList: {
          add: (...cls) => cls.forEach((c) => classSet.add(c)),
          remove: (...cls) => cls.forEach((c) => classSet.delete(c)),
          toggle: (c, force) => {
            const shouldHave =
              force !== undefined ? Boolean(force) : !classSet.has(c);
            if (shouldHave) classSet.add(c);
            else classSet.delete(c);
            return shouldHave;
          },
          contains: (c) => classSet.has(c),
        },
        setAttribute: (k, v) => {
          attrs.set(k, String(v));
          if (k === "hidden") mockObj.hidden = true;
        },
        removeAttribute: (k) => {
          attrs.delete(k);
          if (k === "hidden") mockObj.hidden = false;
        },
        getAttribute: (k) => attrs.get(k) ?? null,
        hasAttribute: (k) => attrs.has(k),
        addEventListener: (evt, fn) => listeners.set(evt, fn),
        click: () => listeners.get("click")?.({ preventDefault() {} }),
        querySelectorAll: () => [],
      };
      return mockObj;
    };

    const ids = [
      "dock-grid",
      "browser-container",
      "browser-handle",
      "center-stack",
      "timeline-container",
      "editor-bar",
      "center-editor-piano-btn",
      "center-editor-seq-btn",
      "center-toggle-devices-btn",
      "editor-container",
      "seq-container",
      "devices-container",
      "mixer-handle",
      "mixer-container",
      "mode-studio-btn",
      "mode-piano-full-btn",
      "mode-seq-full-btn",
      "mode-mixer-full-btn",
      "toggle-browser-btn",
      "toggle-mixer-btn",
      "new-btn",
      "reset-btn",
      "undo-btn",
      "bounce-btn",
      "import-btn",
      "export-btn",
      "proj-header-name",
      "proj-bpm",
    ];
    for (const id of ids) {
      elements.set(id, makeMockEl(id));
    }

    el.shadowRoot = {
      innerHTML: "",
      getElementById: (id) => elements.get(id) || null,
      querySelector: () => null,
      querySelectorAll: () => [],
    };

    // 1. Mount component: must NOT throw Illegal invocation on LaunchParams
    assert.doesNotThrow(() => {
      el.connectedCallback();
    });

    const grid = elements.get("dock-grid");
    const bCont = elements.get("browser-container");
    const bHandle = elements.get("browser-handle");
    const centerStack = elements.get("center-stack");
    const edCont = elements.get("editor-container");
    const seqCont = elements.get("seq-container");
    const devCont = elements.get("devices-container");
    const mHandle = elements.get("mixer-handle");
    const mCont = elements.get("mixer-container");
    const bBtn = elements.get("toggle-browser-btn");
    const sBtn = elements.get("mode-studio-btn");
    const mBtn = elements.get("toggle-mixer-btn");
    const mixerFullBtn = elements.get("mode-mixer-full-btn");
    const pianoFullBtn = elements.get("mode-piano-full-btn");
    const seqFullBtn = elements.get("mode-seq-full-btn");

    // 2. Verify initial Studio state: Browser, Studio, AND Mixer are all visible and highlighted
    assert.equal(grid.style.gridTemplateColumns, "230px 8px 1fr 8px 320px");
    assert.equal(bBtn.classList.contains("btn-primary"), true);
    assert.equal(sBtn.classList.contains("btn-primary"), true);
    assert.equal(mBtn.classList.contains("btn-primary"), true);
    assert.equal(bCont.classList.contains("hidden"), false);
    assert.equal(bHandle.classList.contains("hidden"), false);
    assert.equal(centerStack.classList.contains("hidden"), false);
    assert.equal(mHandle.classList.contains("hidden"), false);
    assert.equal(mCont.classList.contains("hidden"), false);
    assert.equal(edCont.classList.contains("hidden"), false);
    assert.equal(seqCont.classList.contains("hidden"), true);

    // 3. Click "Toggle Mixer" 1st time -> hides Mixer and mixer-handle; Browser and Studio stay active
    mBtn.click();
    assert.equal(mBtn.classList.contains("btn-primary"), false);
    assert.equal(bBtn.classList.contains("btn-primary"), true);
    assert.equal(sBtn.classList.contains("btn-primary"), true);
    assert.equal(mCont.classList.contains("hidden"), true);
    assert.equal(mHandle.classList.contains("hidden"), true);
    assert.equal(bCont.classList.contains("hidden"), false);
    assert.equal(bHandle.classList.contains("hidden"), false);
    assert.equal(grid.style.gridTemplateColumns, "230px 8px 1fr");

    // 4. Click "Toggle Mixer" 2nd time -> shows Mixer and mixer-handle again
    mBtn.click();
    assert.equal(mBtn.classList.contains("btn-primary"), true);
    assert.equal(mCont.classList.contains("hidden"), false);
    assert.equal(mHandle.classList.contains("hidden"), false);
    assert.equal(grid.style.gridTemplateColumns, "230px 8px 1fr 8px 320px");

    // 5. Click "Mixer (Full)" -> shows Mixer only, hides BOTH resize handles and Browser/Center
    mixerFullBtn.click();
    assert.equal(mixerFullBtn.classList.contains("btn-primary"), true);
    assert.equal(sBtn.classList.contains("btn-primary"), false);
    assert.equal(bBtn.disabled, true);
    assert.equal(mBtn.disabled, true);
    assert.equal(mCont.classList.contains("hidden"), false);
    assert.equal(bCont.classList.contains("hidden"), true);
    assert.equal(centerStack.classList.contains("hidden"), true);
    assert.equal(bHandle.classList.contains("hidden"), true);
    assert.equal(mHandle.classList.contains("hidden"), true);
    assert.equal(grid.style.gridTemplateColumns, "1fr");

    // 6. Click "Piano Roll (Full)" -> shows Timeline + Piano Roll only, hides BOTH resize handles
    pianoFullBtn.click();
    assert.equal(pianoFullBtn.classList.contains("btn-primary"), true);
    assert.equal(centerStack.classList.contains("hidden"), false);
    assert.equal(edCont.classList.contains("hidden"), false);
    assert.equal(seqCont.classList.contains("hidden"), true);
    assert.equal(bCont.classList.contains("hidden"), true);
    assert.equal(mCont.classList.contains("hidden"), true);
    assert.equal(bHandle.classList.contains("hidden"), true);
    assert.equal(mHandle.classList.contains("hidden"), true);
    assert.equal(grid.style.gridTemplateColumns, "1fr");

    // 7. Click "Drum Matrix (Full)" -> shows Timeline + Step Sequencer only, hides BOTH resize handles
    seqFullBtn.click();
    assert.equal(seqFullBtn.classList.contains("btn-primary"), true);
    assert.equal(centerStack.classList.contains("hidden"), false);
    assert.equal(edCont.classList.contains("hidden"), true);
    assert.equal(seqCont.classList.contains("hidden"), false);
    assert.equal(bCont.classList.contains("hidden"), true);
    assert.equal(mCont.classList.contains("hidden"), true);
    assert.equal(bHandle.classList.contains("hidden"), true);
    assert.equal(mHandle.classList.contains("hidden"), true);
    assert.equal(grid.style.gridTemplateColumns, "1fr");

    // 8. Click "Studio" -> returns to 3-column Studio layout
    sBtn.click();
    assert.equal(sBtn.classList.contains("btn-primary"), true);
    assert.equal(bCont.classList.contains("hidden"), false);
    assert.equal(bHandle.classList.contains("hidden"), false);
    assert.equal(centerStack.classList.contains("hidden"), false);
    assert.equal(mHandle.classList.contains("hidden"), false);
    assert.equal(mCont.classList.contains("hidden"), false);
    assert.equal(grid.style.gridTemplateColumns, "230px 8px 1fr 8px 320px");

    // 9. In-Studio Center Editor Switcher toggles between Piano Roll, Step Sequencer, and Device Rack
    const centerSeqBtn = elements.get("center-editor-seq-btn");
    const centerPianoBtn = elements.get("center-editor-piano-btn");
    const centerDevBtn = elements.get("center-toggle-devices-btn");

    centerSeqBtn.click();
    assert.equal(seqCont.classList.contains("hidden"), false);
    assert.equal(edCont.classList.contains("hidden"), true);
    // Docks remain open in Studio mode!
    assert.equal(bCont.classList.contains("hidden"), false);
    assert.equal(mCont.classList.contains("hidden"), false);

    centerPianoBtn.click();
    assert.equal(edCont.classList.contains("hidden"), false);
    assert.equal(seqCont.classList.contains("hidden"), true);

    centerDevBtn.click();
    assert.equal(devCont.classList.contains("hidden"), true);
    centerDevBtn.click();
    assert.equal(devCont.classList.contains("hidden"), false);

    el.disconnectedCallback();
  } finally {
    globalThis.window = prevWindow;
  }
});
