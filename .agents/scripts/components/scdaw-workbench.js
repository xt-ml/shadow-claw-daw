/**
 * .agents/scripts/components/scdaw-workbench.js
 *
 * Master Studio Docking Workbench Web Component (<scdaw-workbench>).
 * Ported concepts from openDAW DefaultWorkspace & WorkspacePage.
 * Incorporates CSS Container Queries (@container), accessible split-pane
 * resize handles (<scdaw-resize-handle>), and responsive mobile-first full-width views.
 */

import { SHARED_STYLES, installPageSwipeGuard } from "./scdaw-styles.js";
import { scdaw } from "../scdaw-engine.js";
import { shouldHandleSoftwareKeyboardEvent } from "../scdaw-midi-io.js";
import { serializeProject } from "../scdaw.js";
import {
  getBaseHref,
  createCompressedUrl,
  getCompressedParam,
  getUrlParam,
  clearUrlParam,
} from "../scdaw-url-param.js";
import { effect } from "../scdaw-signals.js";
import {
  DEFAULT_GROUP_ID,
  formatFileSize,
  getFileIcon,
  classifyFile,
} from "../scdaw-fs.js";

import "./scdaw-transport.js";
import "./scdaw-browser.js";
import "./scdaw-timeline.js";
import "./scdaw-editor.js";
import "./scdaw-wave-editor.js";
import "./scdaw-sequencer.js";
import "./scdaw-synth.js";
import "./scdaw-devices.js";
import "./scdaw-mixer.js";
import "./scdaw-statusbar.js";
import "./scdaw-midi-keyboard.js";
import "./scdaw-resize-handle.js";

// Ensure <shadow-claw-dialog> custom element is available via CDN
if (
  typeof window !== "undefined" &&
  typeof customElements !== "undefined" &&
  !customElements.get("shadow-claw-dialog")
) {
  import("https://cdn.jsdelivr.net/npm/shadow-claw/dist/lib/components/shadow-claw-dialog.js").catch(
    () => {},
  );
}

const BaseElement = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

export function resolveDropAction({
  targetTrackId = null,
  file = null,
  plugin = null,
} = {}) {
  // 1. If a plugin was dragged from browser (application/x-scdaw-plugin)
  if (plugin && typeof plugin === "object") {
    if (plugin.kind === "instrument") {
      return {
        action: "load_instrument",
        trackId: targetTrackId,
        instrument: plugin.type || plugin.id,
      };
    }
    if (plugin.kind === "preset") {
      return {
        action: "apply_preset",
        trackId: targetTrackId,
        preset: plugin.id || plugin.name,
      };
    }
    if (
      plugin.kind === "audio_fx" ||
      plugin.kind === "midi_fx" ||
      plugin.kind === "fx"
    ) {
      return {
        action: "add_fx",
        trackId: targetTrackId,
        fx: plugin,
      };
    }
    return {
      action: "apply_plugin",
      trackId: targetTrackId,
      plugin,
    };
  }

  // 2. If a file was dragged from OS
  if (file && typeof file === "object") {
    const name = String(file.name || "").toLowerCase();

    // Check extension
    if (name.endsWith(".dawproject")) {
      return { action: "import_session", format: "dawproject" };
    }
    if (name.endsWith(".scdaw.json") || name.endsWith(".json")) {
      return { action: "import_session", format: "scdaw-json" };
    }
    if (name.endsWith(".mid") || name.endsWith(".midi")) {
      if (targetTrackId) {
        return {
          action: "import_track_midi",
          trackId: targetTrackId,
          format: "midi",
        };
      }
      return { action: "import_session", format: "midi" };
    }
    if (
      name.endsWith(".wav") ||
      name.endsWith(".wave") ||
      name.endsWith(".mp3") ||
      name.endsWith(".ogg")
    ) {
      if (targetTrackId) {
        return {
          action: "import_track_audio",
          trackId: targetTrackId,
          format: "wav",
        };
      }
      return { action: "import_track_audio", trackId: null, format: "wav" };
    }

    return { action: "import_session", format: "unknown" };
  }

  return { action: "none" };
}

export function resolveWorkbenchResponsiveLayout({
  containerWidth = 1200,
  viewMode = "studio", // "studio" | "browser-full" | "piano-roll-full" | "sequencer-full" | "synth-full" | "mixer-full"
  showBrowser = true,
  showMixer = true,
  browserWidth = 220,
  mixerWidth = 300,
} = {}) {
  const isMobile = containerWidth < 640;
  const isTablet = containerWidth >= 640 && containerWidth < 1024;
  const isDesktop = containerWidth >= 1024;

  const isFullWidth =
    viewMode === "browser-full" ||
    viewMode === "piano-roll-full" ||
    viewMode === "sequencer-full" ||
    viewMode === "synth-full" ||
    viewMode === "audio-full" ||
    viewMode === "mixer-full";

  let activeFocus = "studio";
  if (viewMode === "browser-full") activeFocus = "browser";
  else if (viewMode === "piano-roll-full") activeFocus = "piano-roll";
  else if (viewMode === "sequencer-full") activeFocus = "sequencer";
  else if (viewMode === "synth-full") activeFocus = "synth";
  else if (viewMode === "audio-full") activeFocus = "audio";
  else if (viewMode === "mixer-full") activeFocus = "mixer";

  if (isFullWidth || isMobile) {
    return {
      isMobile,
      isTablet,
      isDesktop,
      isFullWidth,
      activeFocus,
      showResizeHandles: false,
      showBrowserHandle: false,
      showMixerHandle: false,
      gridTemplateColumns: "1fr",
      showBrowser: viewMode === "browser-full",
      showMixer: false,
    };
  }

  // Multi-pane Studio layout (>= 640px: Tablet & Desktop)
  const visibleBrowser = Boolean(showBrowser);
  const visibleMixer = Boolean(showMixer);
  let cols;
  let showBrowserHandle = false;
  let showMixerHandle = false;

  if (visibleBrowser && visibleMixer) {
    cols = `${browserWidth}px 8px 1fr 8px ${mixerWidth}px`;
    showBrowserHandle = true;
    showMixerHandle = true;
  } else if (visibleBrowser) {
    cols = `${browserWidth}px 8px 1fr`;
    showBrowserHandle = true;
  } else if (visibleMixer) {
    cols = `1fr 8px ${mixerWidth}px`;
    showMixerHandle = true;
  } else {
    cols = "1fr";
  }

  return {
    isMobile,
    isTablet,
    isDesktop,
    isFullWidth: false,
    activeFocus: "studio",
    showResizeHandles: showBrowserHandle || showMixerHandle,
    showBrowserHandle,
    showMixerHandle,
    gridTemplateColumns: cols,
    showBrowser: visibleBrowser,
    showMixer: visibleMixer,
  };
}

export function resolveWorkbenchPanels(showBrowser, showMixer, editorMode) {
  return {
    showBrowser: Boolean(showBrowser),
    showMixer: Boolean(showMixer),
    editorMode:
      editorMode === "step-sequencer"
        ? "step-sequencer"
        : editorMode === "synth"
          ? "synth"
          : editorMode === "audio"
            ? "audio"
            : "piano-roll",
    gridColumns:
      showBrowser && showMixer
        ? "240px 1fr 280px"
        : showBrowser
          ? "240px 1fr"
          : showMixer
            ? "1fr 280px"
            : "1fr",
  };
}

export function resolveWorkbenchButtonStates({
  viewMode = "studio",
  showBrowser = true,
  showMixer = true,
  isMobile = false,
} = {}) {
  const isStudio = viewMode === "studio";
  const canShowDocks = isStudio && !isMobile;

  const browserVisible = Boolean(canShowDocks && showBrowser);
  const mixerVisible = Boolean(canShowDocks && showMixer);

  return {
    browser: {
      active: browserVisible,
      disabled: !canShowDocks,
      visible: browserVisible,
    },
    mixer: {
      active: mixerVisible,
      disabled: !canShowDocks,
      visible: mixerVisible,
    },
    studio: {
      active: isStudio,
      disabled: false,
    },
    browserFull: {
      active: viewMode === "browser-full",
      disabled: false,
    },
    pianoRollFull: {
      active: viewMode === "piano-roll-full",
      disabled: false,
    },
    sequencerFull: {
      active: viewMode === "sequencer-full",
      disabled: false,
    },
    synthFull: {
      active: viewMode === "synth-full",
      disabled: false,
    },
    audioFull: {
      active: viewMode === "audio-full",
      disabled: false,
    },
    mixerFull: {
      active: viewMode === "mixer-full",
      disabled: false,
    },
  };
}

/**
 * Resolves fullscreen state and UI attributes for workbench button and container.
 *
 * @param {boolean} isFullscreen - Current or requested fullscreen state
 * @returns {{
 *   isFullscreen: boolean,
 *   ariaLabel: string,
 *   ariaPressed: "true" | "false",
 *   title: string,
 *   btnText: string,
 *   btnIcon: string,
 *   btnClass: string,
 *   hostClass: string,
 * }}
 */
export function resolveWorkbenchFullscreenState(isFullscreen) {
  const active = Boolean(isFullscreen);
  return {
    isFullscreen: active,
    ariaLabel: active ? "Exit full screen mode" : "Enter full screen mode",
    ariaPressed: active ? "true" : "false",
    title: active
      ? "Exit full screen mode (restore app navigation)"
      : "Full screen mode (hide app navigation and focus on DAW)",
    btnText: active ? "Exit Full Screen" : "Full Screen",
    btnIcon: active ? "✕" : "⛶",
    btnClass: active
      ? "scdaw-workbench__btn btn btn-icon scdaw-workbench__btn--fullscreen scdaw-workbench__btn--active btn-primary"
      : "scdaw-workbench__btn btn btn-icon scdaw-workbench__btn--fullscreen",
    hostClass: active ? "scdaw-workbench--fullscreen" : "",
  };
}

/**
 * Toggles fullscreen mode for the DAW workbench and host page container.
 * Safely invokes requestFullscreen / exitFullscreen when supported,
 * synchronizes CSS fixed fullscreen classes, ARIA attributes, and handles
 * keyboard Escape and fullscreenchange events.
 *
 * @param {Object} options
 * @param {HTMLElement} options.workbenchEl - The <scdaw-workbench> element
 * @param {HTMLElement} [options.fullscreenBtn] - The fullscreen toggle button
 * @param {HTMLElement} [options.pageEl] - The parent .scdaw-workbench-page element (if present)
 * @param {Object} [options.windowObj] - Window reference (defaults to global window)
 * @param {Object} [options.documentObj] - Document reference (defaults to global document)
 * @param {Function} [options.onStateChange] - Callback invoked when state changes
 * @returns {{ toggle: (force?: boolean) => void, setState: (force?: boolean) => void, isFullscreen: () => boolean, dispose: () => void }}
 */
export function setupWorkbenchFullscreen({
  workbenchEl,
  fullscreenBtn,
  pageEl,
  windowObj = typeof window !== "undefined" ? window : null,
  documentObj = typeof document !== "undefined" ? document : null,
  onStateChange,
}) {
  let isFullscreen = false;

  const updateUI = () => {
    const state = resolveWorkbenchFullscreenState(isFullscreen);

    // Toggle classes on workbench element
    workbenchEl?.classList?.toggle("scdaw-workbench--fullscreen", isFullscreen);

    // Toggle classes on parent page container if available
    pageEl?.classList?.toggle("scdaw-workbench-page--fullscreen", isFullscreen);

    // Update button attributes and labels
    if (fullscreenBtn) {
      fullscreenBtn.setAttribute?.("aria-pressed", state.ariaPressed);
      fullscreenBtn.setAttribute?.("aria-label", state.ariaLabel);
      fullscreenBtn.title = state.title;

      fullscreenBtn.classList?.toggle("btn-primary", state.isFullscreen);
      fullscreenBtn.classList?.toggle(
        "scdaw-workbench__btn--active",
        state.isFullscreen,
      );

      const iconEl = fullscreenBtn.querySelector?.(
        ".scdaw-workbench__fullscreen-icon",
      );
      if (iconEl) iconEl.textContent = state.btnIcon;

      const labelEl = fullscreenBtn.querySelector?.(
        ".scdaw-workbench__fullscreen-label",
      );
      if (labelEl) labelEl.textContent = state.btnText;
    }

    if (typeof onStateChange === "function") {
      onStateChange(isFullscreen);
    }
  };

  const setState = (nextActive) => {
    const active = Boolean(nextActive);
    if (isFullscreen === active) return;
    isFullscreen = active;

    if (documentObj) {
      const isDocFs = Boolean(documentObj.fullscreenElement);
      if (isFullscreen && !isDocFs) {
        const target = pageEl || workbenchEl;
        try {
          if (typeof target?.requestFullscreen === "function") {
            const p = target.requestFullscreen();
            p?.catch?.(() => {});
          }
        } catch {}
      } else if (!isFullscreen && isDocFs) {
        try {
          if (typeof documentObj.exitFullscreen === "function") {
            const p = documentObj.exitFullscreen();
            p?.catch?.(() => {});
          }
        } catch {}
      }
    }

    updateUI();
  };

  const toggle = (force) => {
    const next = typeof force === "boolean" ? force : !isFullscreen;
    setState(next);
  };

  const onBtnClick = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    toggle();
  };

  const onKeyDown = (e) => {
    if (e?.key === "Escape" && isFullscreen) {
      e?.preventDefault?.();
      setState(false);
    }
  };

  const onFullscreenChange = () => {
    const docActive = Boolean(documentObj?.fullscreenElement);
    if (docActive !== isFullscreen) {
      setState(docActive);
    }
  };

  fullscreenBtn?.addEventListener?.("click", onBtnClick);
  windowObj?.addEventListener?.("keydown", onKeyDown);
  documentObj?.addEventListener?.("fullscreenchange", onFullscreenChange);

  // Initialize initial UI
  updateUI();

  return {
    toggle,
    setState,
    isFullscreen: () => isFullscreen,
    dispose: () => {
      fullscreenBtn?.removeEventListener?.("click", onBtnClick);
      windowObj?.removeEventListener?.("keydown", onKeyDown);
      documentObj?.removeEventListener?.(
        "fullscreenchange",
        onFullscreenChange,
      );
    },
  };
}

export function setupWorkbenchMidiKeyboard({
  shadowRoot,
  windowObj,
  software = null,
} = {}) {
  const onKeyDown = (e) => {
    const kbd = shadowRoot?.getElementById?.("midi-keyboard");
    if (!kbd || kbd.hidden) return;
    if (!shouldHandleSoftwareKeyboardEvent(e)) return;
    if (typeof kbd.handleQwertyKeyDown === "function") {
      kbd.handleQwertyKeyDown(e);
    } else {
      software?.keyDown?.(e.key, { code: e.code, repeat: e.repeat });
    }
  };

  const onKeyUp = (e) => {
    const kbd = shadowRoot?.getElementById?.("midi-keyboard");
    if (typeof kbd?.handleQwertyKeyUp === "function") {
      kbd.handleQwertyKeyUp(e);
    } else {
      software?.keyUp?.(e.key, { code: e.code });
    }
  };

  const onBlur = () => {
    const kbd = shadowRoot?.getElementById?.("midi-keyboard");
    if (typeof kbd?.releaseTransientNotes === "function") {
      kbd.releaseTransientNotes();
    } else {
      software?.releaseHeldKeys?.();
    }
  };

  const onToggleKeyboard = (e) => {
    const kbd = shadowRoot?.getElementById?.("midi-keyboard");
    if (!kbd) return;
    const visible = Boolean(e?.detail?.visible);
    kbd.hidden = !visible;
    if (!visible) {
      if (typeof kbd.releaseTransientNotes === "function") {
        kbd.releaseTransientNotes();
      } else {
        software?.releaseHeldKeys?.();
      }
    }
  };

  const onKeyboardClose = (e) => {
    const kbd = shadowRoot?.getElementById?.("midi-keyboard");
    if (!kbd || (e?.target && e.target !== kbd)) return;
    const transport = shadowRoot?.querySelector?.("scdaw-transport");
    const keysBtn = transport?.shadowRoot?.getElementById?.("keys-btn");
    if (keysBtn) {
      keysBtn.setAttribute?.("aria-pressed", "false");
    }
  };

  windowObj?.addEventListener?.("keydown", onKeyDown);
  windowObj?.addEventListener?.("keyup", onKeyUp);
  windowObj?.addEventListener?.("blur", onBlur);
  shadowRoot?.addEventListener?.("toggle-midi-keyboard", onToggleKeyboard);
  shadowRoot?.addEventListener?.("close", onKeyboardClose);

  return {
    dispose() {
      windowObj?.removeEventListener?.("keydown", onKeyDown);
      windowObj?.removeEventListener?.("keyup", onKeyUp);
      windowObj?.removeEventListener?.("blur", onBlur);
      shadowRoot?.removeEventListener?.(
        "toggle-midi-keyboard",
        onToggleKeyboard,
      );
      shadowRoot?.removeEventListener?.("close", onKeyboardClose);
    },
  };
}

export class DawWorkbenchElement extends BaseElement {
  constructor() {
    super();
    if (this.attachShadow) {
      this.attachShadow({ mode: "open" });
    }
    this._showBrowser = true;
    this._showMixer = true;
    this._showDevices = true;
    this._editorMode = "piano-roll"; // "piano-roll" | "step-sequencer"
    this._viewMode = "studio"; // "studio" | "piano-roll-full" | "sequencer-full" | "mixer-full"
    this._browserWidth = 230;
    this._mixerWidth = 320;
    this._resizeObserver = null;
    this._containerWidth = 1200;
    this._isFullscreen = false;
    this._fullscreenController = null;
    this._midiKeyboardController = null;
  }

  _measureContainerWidth() {
    if (typeof this.getBoundingClientRect === "function") {
      const rect = this.getBoundingClientRect();
      if (rect && rect.width > 0) {
        this._containerWidth = Math.round(rect.width);
        return;
      }
    }
    if (typeof window !== "undefined" && window.innerWidth > 0) {
      this._containerWidth = window.innerWidth;
    }
  }

  connectedCallback() {
    this._cleanupSwipeGuard?.();
    this._cleanupSwipeGuard = installPageSwipeGuard(this);
    this._measureContainerWidth();
    this._renderSkeleton();
    this._initFullscreen();
    this._updatePanels();
    queueMicrotask(() => this._checkFileUrlParam());
    if (
      typeof window !== "undefined" &&
      typeof window.addEventListener === "function"
    ) {
      this._onHashChange = () => this._checkFileUrlParam();
      window.addEventListener("hashchange", this._onHashChange);
    }
    if (this._midiKeyboardController) {
      this._midiKeyboardController.dispose();
    }
    this._midiKeyboardController = setupWorkbenchMidiKeyboard({
      shadowRoot: this.shadowRoot,
      windowObj: typeof window !== "undefined" ? window : null,
      software: scdaw.midi?.software,
    });
    this._dispose = effect(() => {
      const p = scdaw.project.get();
      this._syncProject(p);
    });
    this._disposeError = effect(() => {
      const s = scdaw.state.get();
      this._syncErrorBanner(s?.lastError || null);
    });

    if (typeof ResizeObserver !== "undefined" && this.shadowRoot) {
      this._resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const centerStackEl = this.shadowRoot.getElementById("center-stack");
          if (centerStackEl && entry.target === centerStackEl) {
            const h = Math.round(entry.contentRect.height);
            if (h > 0) {
              this.style.setProperty("--center-stack-h", `${h}px`);
            }
          } else {
            const cr = entry.contentRect;
            if (
              cr &&
              cr.width > 0 &&
              Math.round(cr.width) !== this._containerWidth
            ) {
              this._containerWidth = Math.round(cr.width);
              this._updatePanels();
            }
          }
        }
      });
      const rootEl = this.shadowRoot.querySelector(".scdaw-workbench");
      if (rootEl) this._resizeObserver.observe(rootEl);
      const centerStack = this.shadowRoot.getElementById("center-stack");
      if (centerStack) this._resizeObserver.observe(centerStack);
    }
  }

  disconnectedCallback() {
    if (this._cleanupSwipeGuard) {
      this._cleanupSwipeGuard();
      this._cleanupSwipeGuard = null;
    }
    if (
      this._onHashChange &&
      typeof window !== "undefined" &&
      typeof window.removeEventListener === "function"
    ) {
      window.removeEventListener("hashchange", this._onHashChange);
      this._onHashChange = null;
    }
    if (this._midiKeyboardController) {
      this._midiKeyboardController.dispose();
      this._midiKeyboardController = null;
    }
    if (this._dispose) this._dispose();
    if (this._disposeError) this._disposeError();
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._fullscreenController) {
      this._fullscreenController.dispose();
      this._fullscreenController = null;
    }
  }

  _initFullscreen() {
    if (this._fullscreenController) {
      this._fullscreenController.dispose();
      this._fullscreenController = null;
    }
    const btn = this.shadowRoot?.getElementById("fullscreen-btn");
    const pageEl = this.closest?.(".scdaw-workbench-page") || null;
    this._fullscreenController = setupWorkbenchFullscreen({
      workbenchEl: this,
      fullscreenBtn: btn,
      pageEl,
      onStateChange: (active) => {
        this._isFullscreen = active;
        this._updatePanels();
      },
    });
  }

  toggleFullscreen(force) {
    this._fullscreenController?.toggle(force);
  }

  get isFullscreen() {
    return Boolean(this._isFullscreen);
  }

  _renderSkeleton() {
    if (!this.shadowRoot) return;
    const p = scdaw.getProject();

    this.shadowRoot.innerHTML = `
      <style>
        ${SHARED_STYLES}
        :host {
          display: block;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          container-type: inline-size;
          container-name: scdaw-workbench;
          --browser-w: ${this._browserWidth}px;
          --mixer-w: ${this._mixerWidth}px;
          --center-stack-h: calc(100vh - 180px);
        }

        /* 1. Mobile First Base Styles (Default for all viewports) */
        .scdaw-workbench {
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          padding: 0.5rem;
          overflow-x: hidden;
        }

        /* Fullscreen Viewport Mode */
        :host(.scdaw-workbench--fullscreen),
        :host(:fullscreen),
        .scdaw-workbench.scdaw-workbench--fullscreen,
        .scdaw-workbench:fullscreen {
          position: fixed !important;
          inset: 0 !important;
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          width: 100vw !important;
          height: 100dvh !important;
          max-width: 100vw !important;
          max-height: 100dvh !important;
          z-index: 99999 !important;
          margin: 0 !important;
          padding: 0.5rem !important;
          box-sizing: border-box !important;
          background: var(--shadow-claw-bg-primary, #0f172a) !important;
          overflow-y: auto !important;
          overflow-x: hidden !important;
        }

        :host(.scdaw-workbench--fullscreen) .scdaw-workbench,
        :host(:fullscreen) .scdaw-workbench {
          width: 100%;
          height: 100%;
          min-height: 100%;
          box-sizing: border-box;
        }

        .scdaw-workbench__btn--fullscreen {
          white-space: nowrap;
        }

        .scdaw-workbench__fullscreen-icon {
          font-size: 0.88rem;
          line-height: 1;
        }

        .scdaw-workbench__fullscreen-label {
          white-space: nowrap;
        }

        .scdaw-workbench__header {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          margin-bottom: 0.6rem;
          border-bottom: 1px solid var(--border);
          padding-bottom: 0.6rem;
        }

        .scdaw-workbench__title-bar {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
        }

        .scdaw-workbench__title-group {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          flex-wrap: wrap;
        }

        .scdaw-workbench__title {
          margin: 0;
          font-size: 1.15rem;
          font-weight: 700;
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
        }

        .scdaw-workbench__meta {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.78rem;
          color: var(--shadow-claw-text-secondary, #94a3b8);
          flex-wrap: wrap;
        }

        .scdaw-workbench__toolbar {
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
        }

        .scdaw-workbench__toolbar-group {
          display: flex;
          align-items: center;
          gap: 0.35rem;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          min-width: 0;
        }

        /* Project operations: 4 equal columns in mobile grid */
        .scdaw-workbench__toolbar-group--project {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 0.35rem;
          width: 100%;
        }

        /* Panel docks: 3 equal columns in mobile grid */
        .scdaw-workbench__toolbar-group--docks,
        .scdaw-workbench__dock-toggles {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 0.35rem;
          width: 100%;
        }

        /* Actions: 3 equal columns on mobile */
        .scdaw-workbench__toolbar-group--actions {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 0.35rem;
          width: 100%;
        }

        /* Full-width focus views: 2x2 grid on mobile (no scrollbar) */
        .scdaw-workbench__toolbar-group--views,
        .scdaw-workbench__view-switcher {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 4px;
          background: rgba(0, 0, 0, 0.25);
          padding: 3px;
          border-radius: 6px;
          align-items: center;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          box-sizing: border-box;
        }

        .scdaw-workbench__toolbar .btn {
          height: 30px;
          min-height: 30px;
          max-height: 30px;
          box-sizing: border-box;
          padding: 0 0.5rem;
          font-size: 0.78rem;
          line-height: 1;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.35rem;
          white-space: nowrap;
          width: 100%;
          min-width: 0;
        }

        .scdaw-workbench__view-switcher .btn {
          padding: 0 0.35rem;
          font-size: 0.72rem;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .scdaw-workbench__dock-grid {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          min-width: 0;
        }

        .scdaw-workbench__center-stack {
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
          min-width: 0;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          container-type: inline-size;
          container-name: scdaw-center;
        }

        .scdaw-workbench__dock-panel {
          min-width: 0;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
        }

        .scdaw-workbench__editor-bar {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 0.35rem;
          padding: 0.35rem 0.5rem;
          background: rgba(0, 0, 0, 0.25);
          border: 1px solid var(--border);
          border-radius: 6px;
          box-sizing: border-box;
        }

        .scdaw-workbench__editor-tabs {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          align-items: center;
          gap: 0.35rem;
          width: 100%;
        }

        .scdaw-workbench__editor-bar .btn {
          height: 26px;
          min-height: 26px;
          padding: 0 0.5rem;
          font-size: 0.74rem;
          width: 100%;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        @container scdaw-center (min-width: 420px) {
          .scdaw-workbench__editor-bar {
            flex-direction: row;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
          }
          .scdaw-workbench__editor-tabs {
            display: inline-flex;
            width: auto;
          }
          .scdaw-workbench__editor-bar .btn {
            width: auto;
            flex: 0 0 auto;
            overflow: visible;
          }
        }

        .hidden,
        [hidden] {
          display: none !important;
        }

        #browser-container {
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
          max-height: clamp(220px, 38vh, 340px);
          display: flex;
          flex-direction: column;
          min-height: 0;
          overflow: hidden;
        }

        #mixer-container {
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
          max-height: clamp(260px, 45vh, 420px);
          display: flex;
          flex-direction: column;
          min-height: 0;
        }

        /* 2. Progressive Enhancement: Tablet and Wider (>= 640px) */
        @container scdaw-workbench (min-width: 640px) {
          .scdaw-workbench__header {
            flex-direction: column;
            align-items: stretch;
          }
          .scdaw-workbench__title-bar {
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
          }
          .scdaw-workbench__toolbar {
            flex-direction: row;
            flex-wrap: wrap;
            align-items: center;
            justify-content: flex-start;
            gap: 0.45rem 0.6rem;
          }
          .scdaw-workbench__toolbar-group,
          .scdaw-workbench__toolbar-group--project,
          .scdaw-workbench__toolbar-group--docks,
          .scdaw-workbench__dock-toggles,
          .scdaw-workbench__toolbar-group--actions,
          .scdaw-workbench__toolbar-group--views,
          .scdaw-workbench__view-switcher {
            display: inline-flex;
            flex-direction: row;
            flex-wrap: nowrap;
            align-items: center;
            width: auto;
            min-width: max-content;
            flex: 0 0 auto;
          }
          .scdaw-workbench__toolbar-group--views,
          .scdaw-workbench__view-switcher {
            margin-inline-start: auto;
          }
          .scdaw-workbench__toolbar .btn,
          .scdaw-workbench__view-switcher .btn {
            width: auto;
            flex: 0 0 auto;
            padding: 0 0.55rem;
            font-size: 0.78rem;
            overflow: visible;
          }
          .scdaw-workbench__dock-grid {
            display: grid;
            gap: 0;
            align-items: stretch;
            grid-template-columns: var(--browser-w, 230px) 8px minmax(0, 1fr) 8px var(--mixer-w, 320px);
          }
          #browser-container {
            height: 100%;
            max-height: var(--center-stack-h, calc(100vh - 180px));
            min-height: 0;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          #mixer-container {
            height: 100%;
            max-height: var(--center-stack-h, calc(100vh - 180px));
            min-height: 0;
            display: flex;
            flex-direction: column;
          }
        }

        /* 3. Progressive Enhancement: Desktop Multi-Pane Grid (>= 1024px) */
        @container scdaw-workbench (min-width: 1024px) {
          .scdaw-workbench__dock-grid {
            display: grid;
            gap: 0;
            align-items: stretch;
            grid-template-columns: var(--browser-w, 230px) 8px minmax(0, 1fr) 8px var(--mixer-w, 320px);
          }
          #browser-container {
            height: 100%;
            max-height: var(--center-stack-h, calc(100vh - 180px));
            min-height: 0;
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          #mixer-container {
            height: 100%;
            max-height: var(--center-stack-h, calc(100vh - 180px));
            min-height: 0;
            display: flex;
            flex-direction: column;
          }
        }

        /* Fallback for environments lacking CSS container query evaluation */
        @supports not (container-type: inline-size) {
          @media (min-width: 640px) {
            .scdaw-workbench__title-bar {
              flex-direction: row;
              justify-content: space-between;
              align-items: center;
            }
            .scdaw-workbench__toolbar {
              flex-direction: row;
              flex-wrap: wrap;
              align-items: center;
            }
            .scdaw-workbench__toolbar-group {
              display: inline-flex;
              width: auto;
              flex: 0 0 auto;
            }
            .scdaw-workbench__toolbar .btn {
              width: auto;
            }
            .scdaw-workbench__dock-grid {
              display: grid;
              gap: 0;
              align-items: stretch;
            }
            #browser-container {
              height: 100%;
              max-height: var(--center-stack-h, calc(100vh - 180px));
              min-height: 0;
              display: flex;
              flex-direction: column;
              overflow: hidden;
            }
            #mixer-container {
              height: 100%;
              max-height: var(--center-stack-h, calc(100vh - 180px));
              min-height: 0;
              display: flex;
              flex-direction: column;
            }
          }
        }

        /* ShadowClaw Dialog Styles & Modern Scroll Containment */
        dialog:modal {
          overscroll-behavior: contain;
          background: var(--bg-card, #161b1c);
          color: var(--shadow-claw-text-primary, #dde4e4);
          border: 1px solid var(--border, #3f4849);
          border-radius: 8px;
          padding: 1.25rem;
          max-width: 440px;
          width: calc(100% - 2rem);
          box-shadow: 0 16px 36px rgba(0, 0, 0, 0.7);
          box-sizing: border-box;
          font-family: inherit;
        }
        dialog::backdrop {
          overflow: hidden;
          overscroll-behavior: contain;
          background: rgba(0, 0, 0, 0.65);
          backdrop-filter: blur(2px);
        }
        .scdaw-dialog {
          padding: 1.4rem;
          max-width: 480px;
          width: 92%;
          border-radius: 8px;
          background: var(--bg-card, #161b1c);
          color: var(--shadow-claw-text-primary, #dde4e4);
          border: 1px solid var(--border, #3f4849);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          box-sizing: border-box;
          font-family: inherit;
        }
        .scdaw-dialog__form {
          display: flex;
          flex-direction: column;
          gap: 0.9rem;
          margin: 0;
        }
        .scdaw-dialog__header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .scdaw-dialog__title,
        .scdaw-dialog__header h3 {
          margin: 0;
          font-size: 1.15rem;
          font-weight: 600;
          color: var(--shadow-claw-text-primary, #dde4e4);
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .scdaw-dialog__message {
          margin: 0;
          font-size: 0.88rem;
          line-height: 1.5;
          color: var(--shadow-claw-text-secondary, #94a3b8);
        }
        .scdaw-dialog__field {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }
        .scdaw-dialog label {
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--shadow-claw-text-secondary, #94a3b8);
        }
        .scdaw-dialog input[type="text"],
        .scdaw-dialog input[type="number"],
        .scdaw-dialog select {
          padding: 0.45rem 0.6rem;
          background: var(--bg-app, #0e1415);
          color: var(--shadow-claw-text-primary, #dde4e4);
          border: 1px solid var(--border, #3f4849);
          border-radius: 4px;
          font-family: inherit;
          font-size: 0.82rem;
          box-sizing: border-box;
          transition: border-color 0.15s;
        }
        .scdaw-dialog input[type="text"]:focus,
        .scdaw-dialog input[type="number"]:focus,
        .scdaw-dialog select:focus {
          border-color: var(--accent, #80d4db);
          outline: none;
        }
        .scdaw-dialog__checkboxes {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
          padding: 0.2rem 0;
        }
        .scdaw-dialog__checkboxes label {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.8rem;
          cursor: pointer;
          color: var(--shadow-claw-text-primary, #dde4e4);
        }
        .scdaw-file-list {
          min-height: 120px;
          max-height: 180px;
          overflow-y: auto;
          background: var(--bg-app, #0e1415);
          border: 1px solid var(--border, #3f4849);
          border-radius: 4px;
          padding: 0.4rem;
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
        }
        .scdaw-file-item {
          padding: 0.45rem 0.6rem;
          border-radius: 4px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          cursor: pointer;
          font-size: 0.8rem;
          background: var(--bg-elevated, #252b2c);
          color: var(--shadow-claw-text-primary, #dde4e4);
          border: 1px solid transparent;
          transition: border-color 0.15s, background 0.15s;
        }
        .scdaw-file-item:hover {
          background: var(--border, #3f4849);
        }
        .scdaw-file-item[aria-selected="true"] {
          border-color: var(--accent, #80d4db);
          background: rgba(128, 212, 219, 0.15);
        }
        .scdaw-dialog__actions {
          display: flex;
          justify-content: flex-end;
          gap: 0.6rem;
          margin-top: 0.25rem;
        }
        .scdaw-dialog__actions .btn {
          height: 32px;
          padding: 0 0.85rem;
          font-size: 0.82rem;
        }
        @media (pointer: coarse) {
          .scdaw-workbench__toolbar .btn,
          .scdaw-workbench__editor-bar .btn,
          .scdaw-dialog__actions .btn,
          .scdaw-file-item,
          .scdaw-error-banner__dismiss {
            min-height: 44px;
            min-width: 44px;
          }
        }
        .scdaw-error-banner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.75rem;
          padding: 0.55rem 0.75rem;
          margin-bottom: 0.6rem;
          border-radius: 6px;
          border: 1px solid rgba(248, 113, 113, 0.7);
          background: rgba(127, 29, 29, 0.45);
          color: #fee2e2;
          font-size: 0.82rem;
        }
        .scdaw-error-banner.hidden,
        .scdaw-error-banner[hidden] {
          display: none !important;
        }
        .scdaw-error-banner__body {
          display: flex;
          flex-wrap: wrap;
          align-items: baseline;
          gap: 0.4rem;
          min-width: 0;
        }
        .scdaw-error-banner__dismiss {
          font: inherit;
          color: inherit;
          background: rgba(255, 255, 255, 0.12);
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 4px;
          padding: 0.2rem 0.55rem;
          cursor: pointer;
          flex-shrink: 0;
        }
        .scdaw-error-banner__dismiss:focus-visible {
          outline: 2px solid #ffffff;
          outline-offset: 2px;
        }
      </style>
      <div class="scdaw-workbench" data-no-swipe="true" data-no-nav="true">
        <header class="scdaw-workbench__header" role="banner">
          <div class="scdaw-workbench__title-bar">
            <div class="scdaw-workbench__title-group">
              <h1 class="scdaw-workbench__title">
                <span class="scdaw-workbench__title-icon" aria-hidden="true">🎚️</span>
                <span class="scdaw-workbench__title-text">ShadowClaw DAW</span>
              </h1>
              <span class="scdaw-workbench__badge badge" style="color:var(--accent);">Studio Workbench</span>
            </div>
            <div class="scdaw-workbench__meta">
              <span id="proj-header-info" class="scdaw-workbench__project-info" aria-live="polite">
                Project: <strong id="proj-header-name">${p.name || "Untitled"}</strong>
              </span>
              <span id="proj-bpm" class="scdaw-workbench__bpm-badge badge" style="color:var(--accent);">${p.bpm} BPM</span>
            </div>
          </div>

          <nav class="scdaw-workbench__toolbar" role="toolbar" aria-label="Workbench View Controls">
            <div class="scdaw-workbench__toolbar-group scdaw-workbench__toolbar-group--project" role="group" aria-label="Project Operations">
              <button id="new-btn" class="scdaw-workbench__btn btn btn-icon" title="New project (reset to default starter template)">📄 New</button>
              <button id="import-btn" class="scdaw-workbench__btn btn btn-icon" title="Open or import project (.scdaw.json, .dawproject, .mid)">📂 Open</button>
              <button id="export-btn" class="scdaw-workbench__btn btn btn-icon btn-primary" title="Save or export audio mixdown, stems ZIP, MIDI, or DAWproject">💾 Export</button>
              <button id="reset-btn" class="scdaw-workbench__btn btn btn-icon" title="Reset the entire project to default starter template">🔄 Reset</button>
            </div>

            <div class="scdaw-workbench__toolbar-group scdaw-workbench__toolbar-group--docks scdaw-workbench__dock-toggles" role="group" aria-label="Panel Docks">
              <button id="toggle-browser-btn" class="scdaw-workbench__btn btn btn-icon btn-primary scdaw-workbench__btn--active" title="Toggle Browser Dock" aria-pressed="true" aria-controls="browser-container">📁 Browser</button>
              <button id="mode-studio-btn" class="scdaw-workbench__btn btn btn-icon btn-primary scdaw-workbench__btn--active" title="Multi-Pane Studio Layout" aria-pressed="true">🎛 Studio</button>
              <button id="toggle-mixer-btn" class="scdaw-workbench__btn btn btn-icon btn-primary scdaw-workbench__btn--active" title="Toggle Mixer Dock" aria-pressed="true" aria-controls="mixer-container">🎛 Mixer</button>
            </div>

            <div class="scdaw-workbench__toolbar-group scdaw-workbench__toolbar-group--actions" role="group" aria-label="History, Output, and Display">
              <button id="undo-btn" class="scdaw-workbench__btn btn btn-icon" title="Undo last change">↩ Undo</button>
              <button id="bounce-btn" class="scdaw-workbench__btn btn btn-icon btn-primary" title="Export 16-bit WAV audio" hidden="hidden">💿 Bounce WAV</button>
              <button
                id="fullscreen-btn"
                type="button"
                class="scdaw-workbench__btn btn btn-icon scdaw-workbench__btn--fullscreen ${this._isFullscreen ? "btn-primary scdaw-workbench__btn--active" : ""}"
                title="${this._isFullscreen ? "Exit full screen mode (restore app navigation)" : "Full screen mode (hide app navigation and focus on DAW)"}"
                aria-label="${this._isFullscreen ? "Exit full screen mode" : "Enter full screen mode"}"
                aria-pressed="${this._isFullscreen ? "true" : "false"}">
                <span class="scdaw-workbench__fullscreen-icon" aria-hidden="true">${this._isFullscreen ? "✕" : "⛶"}</span>
                <span class="scdaw-workbench__fullscreen-label">${this._isFullscreen ? "Exit Full Screen" : "Full Screen"}</span>
              </button>
            </div>

            <div class="scdaw-workbench__toolbar-group scdaw-workbench__toolbar-group--views scdaw-workbench__view-switcher" role="tablist" aria-label="Layout Focus Views">
              <button id="mode-browser-full-btn" type="button" role="tab" class="scdaw-workbench__btn btn btn-icon" title="Full Width Library Browser" aria-pressed="false" aria-selected="false">📁 Browser (Full)</button>
              <button id="mode-mixer-full-btn" type="button" role="tab" class="scdaw-workbench__btn btn btn-icon" title="Full Width Mixer Console" aria-pressed="false" aria-selected="false">🎚 Mixer (Full)</button>
              <button id="mode-piano-full-btn" type="button" role="tab" class="scdaw-workbench__btn btn btn-icon" title="Full Width Piano Roll Editor" aria-pressed="false" aria-selected="false">🎹 Piano Roll (Full)</button>
              <button id="mode-seq-full-btn" type="button" role="tab" class="scdaw-workbench__btn btn btn-icon" title="Full Width Drum Matrix" aria-pressed="false" aria-selected="false">🥁 Drum Matrix (Full)</button>
              <button id="mode-synth-full-btn" type="button" role="tab" class="scdaw-workbench__btn btn btn-icon" title="Full Width Synthesizer Workbench" aria-pressed="false" aria-selected="false">🎛️ Synth (Full)</button>
              <button id="mode-audio-full-btn" type="button" role="tab" class="scdaw-workbench__btn btn btn-icon" title="Full Width Wave Audio Editor" aria-pressed="false" aria-selected="false">🌊 Audio (Full)</button>
            </div>
          </nav>
        </header>

        <section class="scdaw-workbench__transport" style="margin-bottom:0.6rem;" aria-label="Audio Transport">
          <scdaw-transport></scdaw-transport>
        </section>

        <div id="scdaw-error-banner" role="alert" aria-live="assertive" aria-atomic="true" class="scdaw-error-banner hidden" hidden>
          <div class="scdaw-error-banner__body">
            <strong id="scdaw-error-title">Error</strong>
            <span id="scdaw-error-message"></span>
          </div>
          <button id="scdaw-error-dismiss" type="button" class="scdaw-error-banner__dismiss" aria-label="Dismiss error notification">✕ Dismiss</button>
        </div>

        <main id="dock-grid" class="scdaw-workbench__dock-grid" role="main">
          <!-- Left: Browser Panel -->
          <div id="browser-container" class="scdaw-workbench__dock-panel scdaw-workbench__dock-panel--browser" role="region" aria-label="Library Browser">
            <scdaw-browser></scdaw-browser>
          </div>

          <!-- Browser Resize Handle -->
          <scdaw-resize-handle id="browser-handle" class="scdaw-workbench__handle scdaw-workbench__handle--browser" orientation="vertical" value="${this._browserWidth}" min="150" max="420" label="Resize Browser panel"></scdaw-resize-handle>

          <!-- Center Stack: Timeline + Editor Switcher + Editor/Sequencer + Device Rack -->
          <div id="center-stack" class="scdaw-workbench__center-stack" role="region" aria-label="Arrangement and Track Editing">
            <div id="timeline-container" class="scdaw-workbench__section scdaw-workbench__section--timeline">
              <scdaw-timeline></scdaw-timeline>
            </div>
            <div id="editor-bar" class="scdaw-workbench__editor-bar" role="toolbar" aria-label="Detail Editor Switcher">
              <div class="scdaw-workbench__editor-tabs" role="group" aria-label="Active Detail View">
                <button id="center-editor-piano-btn" type="button" class="btn btn-icon btn-primary scdaw-workbench__btn--active" aria-pressed="true" title="Show Piano Roll Note Editor in Studio">🎹 Piano Roll</button>
                <button id="center-editor-seq-btn" type="button" class="btn btn-icon" aria-pressed="false" title="Show 16-Step Drum Matrix in Studio">🥁 Step Sequencer</button>
                <button id="center-editor-synth-btn" type="button" class="btn btn-icon" aria-pressed="false" title="Show Synthesizer Workbench in Studio">🎛️ Synth</button>
                <button id="center-editor-audio-btn" type="button" class="btn btn-icon" aria-pressed="false" title="Show Wave Audio Editor in Studio">🌊 Audio</button>
              </div>
              <button id="center-toggle-devices-btn" type="button" class="btn btn-icon btn-primary scdaw-workbench__btn--active" aria-pressed="true" title="Toggle Track Device Chain Rack">🎛️ Device Rack</button>
            </div>
            <div id="editor-container" class="scdaw-workbench__section scdaw-workbench__section--editor">
              <scdaw-editor></scdaw-editor>
            </div>
            <div id="seq-container" class="scdaw-workbench__section scdaw-workbench__section--sequencer hidden" hidden>
              <scdaw-sequencer></scdaw-sequencer>
            </div>
            <div id="synth-container" class="scdaw-workbench__section scdaw-workbench__section--synth hidden" hidden>
              <scdaw-synth></scdaw-synth>
            </div>
            <div id="wave-container" class="scdaw-workbench__section scdaw-workbench__section--wave hidden" hidden>
              <scdaw-wave-editor></scdaw-wave-editor>
            </div>
            <div id="devices-container" class="scdaw-workbench__section scdaw-workbench__section--devices">
              <scdaw-devices></scdaw-devices>
            </div>
          </div>

          <!-- Mixer Resize Handle -->
          <scdaw-resize-handle id="mixer-handle" class="scdaw-workbench__handle scdaw-workbench__handle--mixer" orientation="vertical" invert value="${this._mixerWidth}" min="180" max="520" label="Resize Mixer panel"></scdaw-resize-handle>

          <!-- Right: Mixer Panel -->
          <div id="mixer-container" class="scdaw-workbench__dock-panel scdaw-workbench__dock-panel--mixer" role="region" aria-label="Mixer Console">
            <scdaw-mixer></scdaw-mixer>
          </div>
        </main>

        <scdaw-midi-keyboard id="midi-keyboard" hidden></scdaw-midi-keyboard>
        <footer class="scdaw-workbench__footer" style="margin-top:0.6rem;" role="contentinfo">
          <scdaw-statusbar></scdaw-statusbar>
        </footer>

        <shadow-claw-dialog
          id="confirm-dialog"
          dialog-class="scdaw-dialog"
          dialog-aria-labelledby="confirm-dialog-title"
        >
          <form method="dialog" class="scdaw-dialog__form">
            <h3 id="confirm-dialog-title" class="scdaw-dialog__title">Confirm Action</h3>
            <p id="confirm-dialog-message" class="scdaw-dialog__message"></p>
            <div class="scdaw-dialog__actions">
              <button id="confirm-dialog-cancel" type="submit" value="cancel" class="btn" autofocus>Cancel</button>
              <button id="confirm-dialog-confirm" type="submit" value="confirm" class="btn btn-primary">Confirm</button>
            </div>
          </form>
        </shadow-claw-dialog>

        <!-- Hidden file input for project & MIDI import fallback -->
        <input type="file" id="import-file-input" style="display:none;" accept=".scdaw.json,.json,.dawproject,.mid,.midi" aria-hidden="true"/>

        <!-- Save & Export Modal Dialog -->
        <dialog id="export-modal" class="scdaw-dialog" aria-labelledby="export-modal-title">
          <form method="dialog" id="export-form" class="scdaw-dialog__form">
            <div class="scdaw-dialog__header">
              <h3 id="export-modal-title">💾 Save & Export</h3>
              <button type="button" id="export-modal-close" class="btn btn-icon" aria-label="Close export dialog" style="padding:2px 8px; font-size:1rem;">✕</button>
            </div>

            <!-- Destination Conversation Selection -->
            <div class="scdaw-dialog__field">
              <label for="export-conversation-select">Destination Conversation</label>
              <select id="export-conversation-select">
                <option value="br:main" selected>Main (Default)</option>
              </select>
            </div>

            <!-- Filename Input -->
            <div class="scdaw-dialog__field">
              <label for="export-filename-input">File Name</label>
              <input type="text" id="export-filename-input" value="${p.name || "daw"}"/>
            </div>

            <!-- Format Selector -->
            <div class="scdaw-dialog__field">
              <label for="export-format-select">Format</label>
              <select id="export-format-select">
                <option value="json" selected>Native Project (.scdaw.json)</option>
                <option value="dawproject">DAWproject Interchange (.dawproject)</option>
                <option value="wav">WAV Audio Mixdown (.wav)</option>
                <option value="stems">Consolidated Stems Bundle (.zip)</option>
                <option value="midi">Standard MIDI File (.mid)</option>
              </select>
            </div>

            <!-- Save Target Options -->
            <div class="scdaw-dialog__checkboxes">
              <label>
                <input type="checkbox" id="export-save-to-fs" checked />
                <span>Save to Conversation Files (OPFS)</span>
              </label>
              <label>
                <input type="checkbox" id="export-download-copy" />
                <span>Also download copy to computer</span>
              </label>
            </div>

            <div id="export-opt-wav" style="display:none; flex-direction:column; gap:0.6rem;">
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.6rem;">
                <div class="scdaw-dialog__field">
                  <label for="export-bitdepth">Bit Depth</label>
                  <select id="export-bitdepth" style="width:100%;">
                    <option value="16">16-bit PCM</option>
                    <option value="24" selected>24-bit PCM (Studio Standard)</option>
                    <option value="32">32-bit Float</option>
                  </select>
                </div>
                <div class="scdaw-dialog__field">
                  <label for="export-loops">Loops</label>
                  <input type="number" id="export-loops" min="1" max="16" value="1" style="width:100%;"/>
                </div>
              </div>
            </div>

            <div id="export-opt-stems" style="display:none; flex-direction:column; gap:0.5rem;">
              <div class="scdaw-dialog__field">
                <label for="export-tap-select">Tap Routing</label>
                <select id="export-tap-select" style="width:100%;">
                  <option value="post-fader" selected>Post-Fader & Pan (Mixdown Stems)</option>
                  <option value="pre-fader">Pre-Fader (Raw Track Level)</option>
                  <option value="pre-fx">Pre-FX (Raw Voice Output)</option>
                </select>
              </div>
            </div>

            <div style="display:flex; justify-content:flex-end; gap:0.6rem; margin-top:0.6rem; flex-wrap:wrap;">
              <button type="button" id="export-modal-cancel" class="btn">Cancel</button>
              <button type="button" id="export-modal-press-url" class="btn" title="Compress .scdaw.json project into a shareable URL">🔗 Press a URL</button>
              <button type="button" id="export-modal-submit" class="btn btn-primary">Save & Export</button>
            </div>
          </form>
        </dialog>

        <!-- Shareable Compressed Song URL Modal Dialog -->
        <dialog id="press-url-modal" class="scdaw-dialog" aria-labelledby="press-url-modal-title">
          <form method="dialog" id="press-url-form" class="scdaw-dialog__form">
            <div class="scdaw-dialog__header">
              <h3 id="press-url-modal-title">🔗 Compressed Song URL</h3>
              <button type="button" id="press-url-modal-close" class="btn btn-icon" aria-label="Close compressed URL dialog" style="padding:2px 8px; font-size:1rem;">✕</button>
            </div>

            <p id="press-url-stats" class="scdaw-dialog__message" style="margin:0; font-size:0.85rem; opacity:0.85;">
              Your project has been compressed into a shareable URL:
            </p>

            <div class="scdaw-dialog__field">
              <label for="press-url-input">Shareable Link</label>
              <input type="text" id="press-url-input" readonly />
            </div>

            <div style="max-height:120px; overflow-y:auto; padding:0.5rem; border-radius:var(--radius-sm, 6px); border:1px solid var(--border, rgba(255,255,255,0.12)); background:var(--surface-1, rgba(0,0,0,0.2));">
              <a id="press-url-link" href="#" target="_blank" rel="noopener noreferrer" style="word-break:break-all; font-size:0.82rem; color:var(--accent, inherit);"></a>
            </div>

            <div style="display:flex; justify-content:flex-end; gap:0.6rem; margin-top:0.6rem;">
              <button type="button" id="press-url-copy" class="btn">Copy URL</button>
              <button type="button" id="press-url-modal-done" class="btn btn-primary">Close</button>
            </div>
          </form>
        </dialog>

        <!-- Open / Load Project Modal Dialog -->
        <dialog id="import-modal" class="scdaw-dialog" aria-labelledby="import-modal-title">
          <form method="dialog" id="import-form" class="scdaw-dialog__form">
            <div class="scdaw-dialog__header">
              <h3 id="import-modal-title">📂 Open Project</h3>
              <button type="button" id="import-modal-close" class="btn btn-icon" aria-label="Close open dialog" style="padding:2px 8px; font-size:1rem;">✕</button>
            </div>

            <!-- Source Conversation Selector -->
            <div class="scdaw-dialog__field">
              <label for="import-conversation-select">Conversation</label>
              <select id="import-conversation-select">
                <option value="br:main" selected>Main (Default)</option>
              </select>
            </div>

            <!-- Files in selected conversation -->
            <div class="scdaw-dialog__field">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <label for="import-file-list">Files in Conversation</label>
                <button type="button" id="import-refresh-btn" class="btn btn-icon" title="Refresh files" style="padding:2px 6px; font-size:0.75rem;">🔄 Refresh</button>
              </div>
              <div id="import-file-list" class="scdaw-file-list" role="listbox" aria-label="Available project files" tabindex="0">
                <div style="padding:1rem; text-align:center; color:var(--shadow-claw-text-secondary, #94a3b8); font-size:0.8rem;">Loading files...</div>
              </div>
            </div>

            <!-- Actions footer -->
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:0.6rem;">
              <button type="button" id="import-from-disk-btn" class="btn" title="Open file from your computer">💻 From Computer...</button>
              <div style="display:flex; gap:0.6rem;">
                <button type="button" id="import-modal-cancel" class="btn">Cancel</button>
                <button type="button" id="import-modal-submit" class="btn btn-primary" disabled>Open Project</button>
              </div>
            </div>
          </form>
        </dialog>
      </div>
    `;

    this._attachEventListeners();
  }

  _attachEventListeners() {
    // Mode Switchers (Studio, Piano Roll Full, Sequencer Full, Mixer Full)
    this.shadowRoot
      .getElementById("mode-studio-btn")
      ?.addEventListener("click", () => {
        this._viewMode = "studio";
        this._editorMode = "piano-roll";
        this._updatePanels();
      });
    this.shadowRoot
      .getElementById("mode-piano-full-btn")
      ?.addEventListener("click", () => {
        this._viewMode = "piano-roll-full";
        this._editorMode = "piano-roll";
        this._updatePanels();
      });
    this.shadowRoot
      .getElementById("mode-seq-full-btn")
      ?.addEventListener("click", () => {
        this._viewMode = "sequencer-full";
        this._editorMode = "step-sequencer";
        this._updatePanels();
      });
    this.shadowRoot
      .getElementById("mode-synth-full-btn")
      ?.addEventListener("click", () => {
        this._viewMode = "synth-full";
        this._editorMode = "synth";
        this._updatePanels();
      });
    this.shadowRoot
      .getElementById("mode-audio-full-btn")
      ?.addEventListener("click", () => {
        this._viewMode = "audio-full";
        this._editorMode = "audio";
        this._updatePanels();
      });
    this.shadowRoot
      .getElementById("scdaw-error-dismiss")
      ?.addEventListener("click", () => {
        scdaw.clearError?.();
      });
    this.shadowRoot
      .getElementById("mode-browser-full-btn")
      ?.addEventListener("click", () => {
        this._viewMode = "browser-full";
        this._updatePanels();
      });
    this.shadowRoot
      .getElementById("mode-mixer-full-btn")
      ?.addEventListener("click", () => {
        this._viewMode = "mixer-full";
        this._updatePanels();
      });

    // Panel Toggles (only operational in multi-pane Studio layout)
    this.shadowRoot
      .getElementById("toggle-browser-btn")
      ?.addEventListener("click", () => {
        if (this._viewMode !== "studio") return;
        this._showBrowser = !this._showBrowser;
        this._updatePanels();
      });
    this.shadowRoot
      .getElementById("toggle-mixer-btn")
      ?.addEventListener("click", () => {
        if (this._viewMode !== "studio") return;
        this._showMixer = !this._showMixer;
        this._updatePanels();
      });

    // Center Stack Detail Editor Switcher (Piano Roll / Step Sequencer / Synth / Device Rack)
    this.shadowRoot
      .getElementById("center-editor-piano-btn")
      ?.addEventListener("click", () => {
        this._editorMode = "piano-roll";
        this._updatePanels();
      });
    this.shadowRoot
      .getElementById("center-editor-seq-btn")
      ?.addEventListener("click", () => {
        this._editorMode = "step-sequencer";
        this._updatePanels();
      });
    this.shadowRoot
      .getElementById("center-editor-synth-btn")
      ?.addEventListener("click", () => {
        this._editorMode = "synth";
        this._updatePanels();
      });
    this.shadowRoot
      .getElementById("center-editor-audio-btn")
      ?.addEventListener("click", () => {
        this._editorMode = "audio";
        this._updatePanels();
      });
    this.shadowRoot
      .getElementById("center-toggle-devices-btn")
      ?.addEventListener("click", () => {
        this._showDevices = !this._showDevices;
        this._updatePanels();
      });

    // Resize Handles
    this.shadowRoot
      .getElementById("browser-handle")
      ?.addEventListener("scdaw-resize", (e) => {
        this._browserWidth = e.detail.value;
        this.style.setProperty("--browser-w", `${e.detail.value}px`);
        this._updatePanels();
      });
    this.shadowRoot
      .getElementById("mixer-handle")
      ?.addEventListener("scdaw-resize", (e) => {
        this._mixerWidth = e.detail.value;
        this.style.setProperty("--mixer-w", `${e.detail.value}px`);
        this._updatePanels();
      });

    // New, Reset, Undo, Bounce
    this.shadowRoot
      .getElementById("new-btn")
      ?.addEventListener("click", async () => {
        const ok = await this.confirmDialog({
          title: "New Project",
          message:
            "Start a new blank project? This will clear all tracks and patterns.",
          confirmText: "New Project",
          cancelText: "Cancel",
          isDestructive: true,
        });
        if (ok) {
          await scdaw.newProject({ template: "empty" });
        }
      });
    this.shadowRoot
      .getElementById("reset-btn")
      ?.addEventListener("click", async () => {
        const ok = await this.confirmDialog({
          title: "Reset Project",
          message:
            "Reset the entire project? All tracks and patterns will return to the default starter template.",
          confirmText: "Reset",
          cancelText: "Cancel",
          isDestructive: true,
        });
        if (ok) {
          await scdaw.resetProject({ template: "basic-beat" });
        }
      });
    this.shadowRoot
      .getElementById("undo-btn")
      ?.addEventListener("click", () => {
        scdaw.sendCommand("undo");
      });

    // Helper to populate conversation dropdowns
    const populateConversations = async (
      selectEl,
      defaultId = DEFAULT_GROUP_ID,
    ) => {
      if (!selectEl) return;
      try {
        const conversations = await scdaw.listConversations();
        selectEl.innerHTML = conversations
          .map(
            (c) =>
              `<option value="${c.groupId}" ${c.groupId === defaultId ? "selected" : ""}>${c.name}${c.isDefault ? " (Default)" : ""}</option>`,
          )
          .join("");
      } catch (_) {}
    };

    // Import / Open Dialog Elements
    const importModal = this.shadowRoot.getElementById("import-modal");
    const importConvSelect = this.shadowRoot.getElementById(
      "import-conversation-select",
    );
    const importFileList = this.shadowRoot.getElementById("import-file-list");
    const importSubmitBtn = this.shadowRoot.getElementById(
      "import-modal-submit",
    );
    const importFromDiskBtn = this.shadowRoot.getElementById(
      "import-from-disk-btn",
    );
    const importRefreshBtn =
      this.shadowRoot.getElementById("import-refresh-btn");
    const fileInput = this.shadowRoot.getElementById("import-file-input");

    const loadImportFiles = async (groupId) => {
      if (!importFileList) return;
      importFileList.innerHTML = `<div style="padding:1rem; text-align:center; color:var(--shadow-claw-text-secondary, #94a3b8); font-size:0.8rem;">Loading files...</div>`;
      if (importSubmitBtn) importSubmitBtn.disabled = true;
      this._selectedImportFile = null;

      try {
        const files = await scdaw.listConversationFiles(groupId);
        if (!files || files.length === 0) {
          importFileList.innerHTML = `
            <div style="padding:1.2rem; text-align:center; color:var(--shadow-claw-text-secondary, #94a3b8); font-size:0.8rem;">
              No files found in this conversation.<br/>
              <span style="font-size:0.7rem; opacity:0.8;">Save a project to this conversation or load from your computer.</span>
            </div>
          `;
          return;
        }

        importFileList.innerHTML = files
          .map(
            (f) => `
            <div class="scdaw-file-item" role="option" aria-selected="false" tabindex="0" data-filename="${f.name}" data-format="${f.format}">
              <span style="display:flex; align-items:center; gap:8px;">
                <span aria-hidden="true">${getFileIcon(f.name)}</span>
                <span style="font-weight:500;">${f.name}</span>
              </span>
              <span style="display:flex; align-items:center; gap:8px;">
                <span class="badge" style="font-size:0.65rem;">${f.format}</span>
                <span style="font-size:0.7rem; color:var(--shadow-claw-text-secondary, #94a3b8);">${formatFileSize(f.size)}</span>
              </span>
            </div>
          `,
          )
          .join("");

        const allItems = Array.from(
          importFileList.querySelectorAll(".scdaw-file-item"),
        );
        const selectFileItem = (item) => {
          allItems.forEach((el) => {
            el.setAttribute("aria-selected", "false");
          });
          item.setAttribute("aria-selected", "true");
          this._selectedImportFile = item.dataset.filename;
          if (importSubmitBtn) importSubmitBtn.disabled = false;
        };
        allItems.forEach((item, idx) => {
          item.addEventListener("click", () => selectFileItem(item));
          item.addEventListener("dblclick", async () => {
            this._selectedImportFile = item.dataset.filename;
            await executeOpenSelectedFile();
          });
          item.addEventListener("keydown", async (e) => {
            if (e.key === " ") {
              e.preventDefault?.();
              selectFileItem(item);
            } else if (e.key === "Enter") {
              e.preventDefault?.();
              selectFileItem(item);
              await executeOpenSelectedFile();
            } else if (e.key === "ArrowDown" && allItems[idx + 1]) {
              e.preventDefault?.();
              allItems[idx + 1].focus?.();
            } else if (e.key === "ArrowUp" && allItems[idx - 1]) {
              e.preventDefault?.();
              allItems[idx - 1].focus?.();
            }
          });
        });
      } catch (err) {
        importFileList.innerHTML = `<div style="padding:1rem; text-align:center; color:#f87171; font-size:0.8rem;">Error loading files: ${err.message}</div>`;
      }
    };

    const executeOpenSelectedFile = async () => {
      if (!this._selectedImportFile) return;
      const conversationId = importConvSelect?.value || DEFAULT_GROUP_ID;
      const filename = this._selectedImportFile;
      if (importSubmitBtn) importSubmitBtn.textContent = "Loading...";

      try {
        await scdaw.loadProjectFromFs({ conversationId, filename });
        importModal?.close();
      } catch (err) {
        console.error("Failed to load project from conversation:", err);
        scdaw.reportError?.(err, {
          title: "Open Project Error",
          context: "Open Project",
        });
      } finally {
        if (importSubmitBtn) importSubmitBtn.textContent = "Open Project";
      }
    };

    // Open Button -> Show Import Modal
    this.shadowRoot
      .getElementById("import-btn")
      ?.addEventListener("click", async () => {
        if (importModal && typeof importModal.showModal === "function") {
          importModal.showModal();
          const targetGid = importConvSelect?.value || DEFAULT_GROUP_ID;
          await populateConversations(importConvSelect, targetGid);
          await loadImportFiles(importConvSelect?.value || targetGid);
        } else {
          fileInput?.click();
        }
      });

    importConvSelect?.addEventListener("change", (e) => {
      loadImportFiles(e.target.value);
    });

    importRefreshBtn?.addEventListener("click", async () => {
      const targetGid = importConvSelect?.value || DEFAULT_GROUP_ID;
      await populateConversations(importConvSelect, targetGid);
      await loadImportFiles(importConvSelect?.value || targetGid);
    });

    importFromDiskBtn?.addEventListener("click", () => {
      importModal?.close();
      fileInput?.click();
    });

    importSubmitBtn?.addEventListener("click", async () => {
      await executeOpenSelectedFile();
    });

    this.shadowRoot
      .getElementById("import-modal-close")
      ?.addEventListener("click", () => {
        importModal?.close();
      });

    this.shadowRoot
      .getElementById("import-modal-cancel")
      ?.addEventListener("click", () => {
        importModal?.close();
      });

    // Hidden File Input for fallback OS file import
    fileInput?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const buffer = await file.arrayBuffer();
        if (file.name.endsWith(".mid") || file.name.endsWith(".midi")) {
          await scdaw.importMidi(buffer);
        } else {
          await scdaw.importProjectFile(buffer);
        }
      } catch (err) {
        console.error("Import error:", err);
        scdaw.reportError?.(err, {
          title: "Import Error",
          context: "Import",
        });
      } finally {
        fileInput.value = "";
      }
    });

    // Save & Export Modal Dialog Handling
    const exportModal = this.shadowRoot.getElementById("export-modal");
    const exportConvSelect = this.shadowRoot.getElementById(
      "export-conversation-select",
    );
    const exportFilenameInput = this.shadowRoot.getElementById(
      "export-filename-input",
    );
    const formatSelect = this.shadowRoot.getElementById("export-format-select");
    const stemsOpt = this.shadowRoot.getElementById("export-opt-stems");
    const wavOpt = this.shadowRoot.getElementById("export-opt-wav");

    const openExportModal = async (preferredFormat = null) => {
      if (exportModal && typeof exportModal.showModal === "function") {
        const p = scdaw.getProject();
        if (exportFilenameInput) {
          exportFilenameInput.value = (p.name || "daw").replace(
            /[^a-zA-Z0-9_-]/g,
            "_",
          );
        }
        if (preferredFormat && formatSelect) {
          formatSelect.value = preferredFormat;
          formatSelect.dispatchEvent(new Event("change"));
        }
        const targetGid = exportConvSelect?.value || DEFAULT_GROUP_ID;
        await populateConversations(exportConvSelect, targetGid);
        exportModal.showModal();
      }
    };

    this.shadowRoot
      .getElementById("export-btn")
      ?.addEventListener("click", () => openExportModal());

    this.shadowRoot
      .getElementById("bounce-btn")
      ?.addEventListener("click", () => openExportModal("wav"));

    formatSelect?.addEventListener("change", (e) => {
      const fmt = e.target.value;
      if (stemsOpt) {
        stemsOpt.style.display = fmt === "stems" ? "flex" : "none";
      }
      if (wavOpt) {
        wavOpt.style.display =
          fmt === "wav" || fmt === "stems" ? "flex" : "none";
      }
    });

    this.shadowRoot
      .getElementById("export-modal-close")
      ?.addEventListener("click", () => {
        exportModal?.close();
      });

    this.shadowRoot
      .getElementById("export-modal-cancel")
      ?.addEventListener("click", () => {
        exportModal?.close();
      });

    const pressUrlModal = this.shadowRoot.getElementById("press-url-modal");
    const pressUrlInput = this.shadowRoot.getElementById("press-url-input");
    const pressUrlLink = this.shadowRoot.getElementById("press-url-link");
    const pressUrlStats = this.shadowRoot.getElementById("press-url-stats");
    const pressUrlCopyBtn = this.shadowRoot.getElementById("press-url-copy");

    this.shadowRoot
      .getElementById("export-modal-press-url")
      ?.addEventListener("click", async () => {
        const pressBtn = this.shadowRoot.getElementById(
          "export-modal-press-url",
        );
        if (pressBtn) pressBtn.textContent = "Compressing...";

        try {
          const prettyJson = serializeProject(scdaw.getProject());
          const jsonStr = JSON.stringify(JSON.parse(prettyJson));
          const compressedUrl = await createCompressedUrl(
            getBaseHref(),
            jsonStr,
            { paramName: "file", useHash: true },
          );

          if (pressUrlInput) pressUrlInput.value = compressedUrl;
          if (pressUrlLink) {
            pressUrlLink.href = compressedUrl;
            pressUrlLink.textContent = compressedUrl;
          }
          if (pressUrlStats) {
            pressUrlStats.style.color = "";
            const rawBytes = new TextEncoder().encode(jsonStr).byteLength;
            pressUrlStats.textContent = `Compressed .scdaw.json (${formatFileSize(rawBytes)} → ${compressedUrl.length} chars):`;
          }
          if (pressUrlCopyBtn) {
            pressUrlCopyBtn.disabled = false;
            pressUrlCopyBtn.textContent = "Copy URL";
          }

          exportModal?.close();
          pressUrlModal?.showModal();
        } catch (err) {
          console.error("Press URL error:", err);
          if (pressUrlInput) pressUrlInput.value = "";
          if (pressUrlLink) {
            pressUrlLink.removeAttribute("href");
            pressUrlLink.textContent = "";
          }
          if (pressUrlCopyBtn) pressUrlCopyBtn.disabled = true;
          if (pressUrlStats) {
            pressUrlStats.style.color = "#f87171";
            pressUrlStats.textContent =
              err?.message ||
              "Project is too large to encode safely inside a share URL. Export as MIDI or .scdaw.json instead.";
          }
          exportModal?.close();
          pressUrlModal?.showModal?.();
        } finally {
          if (pressBtn) pressBtn.textContent = "🔗 Press a URL";
        }
      });

    this.shadowRoot
      .getElementById("press-url-modal-close")
      ?.addEventListener("click", () => {
        pressUrlModal?.close();
      });

    this.shadowRoot
      .getElementById("press-url-modal-done")
      ?.addEventListener("click", () => {
        pressUrlModal?.close();
      });

    pressUrlModal?.addEventListener("click", (e) => {
      if (e.target === pressUrlModal) {
        pressUrlModal.close();
      }
    });

    pressUrlCopyBtn?.addEventListener("click", async () => {
      if (!pressUrlInput?.value) return;
      try {
        await navigator.clipboard.writeText(pressUrlInput.value);
        pressUrlCopyBtn.textContent = "Copied!";
        setTimeout(() => {
          if (pressUrlCopyBtn) pressUrlCopyBtn.textContent = "Copy URL";
        }, 2000);
      } catch (_) {
        pressUrlInput.select();
      }
    });

    this.shadowRoot
      .getElementById("export-modal-submit")
      ?.addEventListener("click", async () => {
        const fmt = formatSelect?.value || "json";
        const conversationId = exportConvSelect?.value || DEFAULT_GROUP_ID;
        const rawName = (
          exportFilenameInput?.value ||
          scdaw.getProject()?.name ||
          "daw"
        )
          .trim()
          .replace(/[^a-zA-Z0-9_.-]/g, "_");
        const saveToFs =
          this.shadowRoot.getElementById("export-save-to-fs")?.checked !==
          false;
        const downloadCopy =
          this.shadowRoot.getElementById("export-download-copy")?.checked ===
          true;
        const bitDepth = parseInt(
          this.shadowRoot.getElementById("export-bitdepth")?.value || "24",
          10,
        );
        const loops = parseInt(
          this.shadowRoot.getElementById("export-loops")?.value || "1",
          10,
        );
        const tap =
          this.shadowRoot.getElementById("export-tap-select")?.value ||
          "post-fader";

        const submitBtn = this.shadowRoot.getElementById("export-modal-submit");
        if (submitBtn) submitBtn.textContent = "Saving...";

        try {
          if (fmt === "wav") {
            const fname = rawName.endsWith(".wav") ? rawName : `${rawName}.wav`;
            await scdaw.bounce({
              loops,
              bitDepth,
              conversationId,
              filename: fname,
              saveToOpfs: saveToFs,
              saveToWorkspace: downloadCopy,
            });
          } else if (fmt === "stems") {
            const fname = rawName.endsWith(".zip")
              ? rawName
              : `${rawName}-stems.zip`;
            await scdaw.bounceStems({
              loops,
              bitDepth,
              tap,
              conversationId,
              filename: fname,
              saveToOpfs: saveToFs,
              saveToWorkspace: downloadCopy,
            });
          } else if (fmt === "midi") {
            const fname = rawName.endsWith(".mid") ? rawName : `${rawName}.mid`;
            scdaw.exportMidi({
              loops,
              conversationId,
              filename: fname,
              saveToOpfs: saveToFs,
              saveToWorkspace: downloadCopy,
            });
          } else if (fmt === "dawproject") {
            const fname = rawName.endsWith(".dawproject")
              ? rawName
              : `${rawName}.dawproject`;
            await scdaw.saveProject({
              conversationId,
              filename: fname,
              format: "dawproject",
              saveToOpfs: saveToFs,
              download: downloadCopy,
            });
          } else if (fmt === "json") {
            const fname = rawName.endsWith(".scdaw.json")
              ? rawName
              : `${rawName}.scdaw.json`;
            await scdaw.saveProject({
              conversationId,
              filename: fname,
              format: "json",
              saveToOpfs: saveToFs,
              download: downloadCopy,
            });
          }
          exportModal?.close();
          const browserEl = this.shadowRoot.querySelector("scdaw-browser");
          if (
            browserEl &&
            typeof browserEl.loadFilesForConversation === "function"
          ) {
            browserEl.loadFilesForConversation(conversationId);
          }
        } catch (err) {
          console.error("Save/Export error:", err);
          scdaw.reportError?.(err, {
            title: "Export Error",
            context: "Save/Export",
          });
          if (submitBtn) {
            submitBtn.textContent = "Error saving!";
            setTimeout(() => {
              if (submitBtn) submitBtn.textContent = "Save & Export";
            }, 3000);
          }
        } finally {
          if (submitBtn && submitBtn.textContent !== "Error saving!") {
            submitBtn.textContent = "Save & Export";
          }
        }
      });

    // PWA LaunchQueue File Handling API (opens files directly from OS file manager)
    // Note: Check property existence via "in" operator on prototype instead of invoking Web IDL getter
    try {
      if (
        typeof window !== "undefined" &&
        "launchQueue" in window &&
        "LaunchParams" in window &&
        window.LaunchParams?.prototype &&
        "files" in window.LaunchParams.prototype
      ) {
        window.launchQueue.setConsumer(async (launchParams) => {
          if (!launchParams.files?.length) return;
          for (const fileHandle of launchParams.files) {
            const file = await fileHandle.getFile();
            const buffer = await file.arrayBuffer();
            if (file.name.endsWith(".mid") || file.name.endsWith(".midi")) {
              await scdaw.importMidi(buffer);
            } else {
              await scdaw.importProjectFile(buffer);
            }
          }
        });
      }
    } catch (_) {
      // Ignore Web IDL prototype inspection restrictions in non-standard environments
    }

    // Context-Sensitive Drag and Drop
    if (typeof this.addEventListener === "function") {
      this.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        const path = e.composedPath ? e.composedPath() : [e.target];
        const trackEl = path.find(
          (el) => el?.dataset?.track || el?.dataset?.trackId,
        );
        if (trackEl) {
          trackEl.classList.add("drop-target-active");
        }
      });

      this.addEventListener("dragleave", (e) => {
        const path = e.composedPath ? e.composedPath() : [e.target];
        const trackEl = path.find(
          (el) => el?.dataset?.track || el?.dataset?.trackId,
        );
        if (trackEl) {
          trackEl.classList.remove("drop-target-active");
        }
      });

      this.addEventListener("drop", async (e) => {
        e.preventDefault();
        const path = e.composedPath ? e.composedPath() : [e.target];
        const trackEl = path.find(
          (el) => el?.dataset?.track || el?.dataset?.trackId,
        );
        if (trackEl) {
          trackEl.classList.remove("drop-target-active");
        }
        const targetTrackId =
          trackEl?.dataset?.track || trackEl?.dataset?.trackId || null;

        // Check for plugin drag payload
        let plugin = null;
        try {
          const rawPlugin = e.dataTransfer?.getData(
            "application/x-scdaw-plugin",
          );
          if (rawPlugin) plugin = JSON.parse(rawPlugin);
        } catch {}

        const file = e.dataTransfer?.files?.[0] || null;

        const dropAction = resolveDropAction({
          targetTrackId,
          file,
          plugin,
        });

        try {
          if (dropAction.action === "import_session") {
            const buffer = await file.arrayBuffer();
            if (dropAction.format === "midi") {
              await scdaw.importMidi(buffer);
            } else {
              await scdaw.importProjectFile(buffer);
            }
          } else if (dropAction.action === "import_track_midi") {
            const buffer = await file.arrayBuffer();
            await scdaw.importMidi(buffer, { trackId: dropAction.trackId });
          } else if (dropAction.action === "import_track_audio") {
            const p = scdaw.getProject();
            let target = dropAction.trackId
              ? p.tracks.find((t) => t.id === dropAction.trackId)
              : null;
            if (!target) {
              const baseName =
                (file.name || "Audio").replace(/\.[^/.]+$/, "") || "Audio";
              const addRes = await scdaw.sendCommand("add_track", {
                kind: "audio",
                name: baseName,
              });
              target = scdaw
                .getProject()
                .tracks.find((t) => t.id === addRes.trackId);
            }
            if (target) {
              const curPos = scdaw.getState().positionPpqn || 0;
              const curBeat = Math.floor(curPos / 480);
              await scdaw.importAudioFile(target.id, file, {
                name: file.name,
                time: curBeat,
              });
            }
          } else if (dropAction.action === "add_fx") {
            await scdaw.sendCommand("manage_fx", {
              action: "add",
              trackId: dropAction.trackId,
              fx: dropAction.fx,
            });
          } else if (dropAction.action === "apply_preset") {
            await scdaw.sendCommand("apply_preset", {
              trackId: dropAction.trackId,
              preset: dropAction.preset,
            });
          } else if (dropAction.action === "load_instrument") {
            await scdaw.sendCommand("set_track", {
              trackId: dropAction.trackId,
              kind: dropAction.instrument,
            });
          }
        } catch (err) {
          console.error("Context-sensitive drop handling failed:", err);
          scdaw.reportError?.(err, {
            title: "Drop Import Error",
            context: "File Drop",
          });
        }
      });
    }
  }

  /**
   * Checks the URL for a compressed `file` query parameter on startup.
   * Prompts the user to load the shared song and clears the param once loaded.
   */
  async _checkFileUrlParam() {
    if (typeof window === "undefined" || !window.location) return;
    if (this._checkingFileUrlParam) return;
    this._checkingFileUrlParam = true;

    try {
      const rawAutoplay = getUrlParam("autoplay", window.location);
      const shouldAutoplay =
        rawAutoplay === "true" ||
        rawAutoplay === "1" ||
        Boolean(globalThis.__scdawPendingUrlSong?.autoplay);

      let jsonStr = await getCompressedParam("file", window.location);
      let songName = "shared song";

      if (jsonStr) {
        if (globalThis.__scdawHandledUrlSong === jsonStr) {
          clearUrlParam("file");
          if (shouldAutoplay) clearUrlParam("autoplay");
          return;
        }
        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed?.name) songName = parsed.name;
        } catch (_) {
          // Invalid JSON; let importProjectFile handle or abort
        }
        globalThis.__scdawPendingUrlSong = {
          jsonStr,
          songName,
          autoplay: shouldAutoplay,
        };
      } else if (globalThis.__scdawPendingUrlSong?.jsonStr) {
        jsonStr = globalThis.__scdawPendingUrlSong.jsonStr;
        songName = globalThis.__scdawPendingUrlSong.songName || songName;
        if (globalThis.__scdawHandledUrlSong === jsonStr) {
          globalThis.__scdawPendingUrlSong = null;
          return;
        }
      } else {
        if (shouldAutoplay && !globalThis.__scdawHandledAutoplay) {
          globalThis.__scdawHandledAutoplay = true;
          clearUrlParam("autoplay");
          try {
            await scdaw.play();
          } catch (err) {
            console.warn("[scdaw] Autoplay failed or was blocked:", err);
          }
        }
        return;
      }

      if (
        typeof customElements !== "undefined" &&
        !customElements.get("shadow-claw-dialog")
      ) {
        await Promise.race([
          customElements.whenDefined("shadow-claw-dialog"),
          new Promise((r) => setTimeout(r, 1500)),
        ]);
      }

      if (this.isConnected === false) return;

      const confirmed = await this.confirmDialog({
        title: "Load Song from URL",
        message: `Would you like to load "${songName}" as a song? This will replace your current project.`,
        confirmText: "Load Song",
        cancelText: "Cancel",
      });

      if (confirmed) {
        globalThis.__scdawHandledUrlSong = jsonStr;
        globalThis.__scdawPendingUrlSong = null;
        try {
          await scdaw.importProjectFile(jsonStr);
          clearUrlParam("file");
          if (shouldAutoplay) {
            globalThis.__scdawHandledAutoplay = true;
            clearUrlParam("autoplay");
            await scdaw.play();
          }
        } catch (err) {
          console.error("[scdaw] Failed to load song from URL:", err);
        }
      } else if (this.isConnected !== false) {
        globalThis.__scdawHandledUrlSong = jsonStr;
        globalThis.__scdawPendingUrlSong = null;
        if (shouldAutoplay) {
          globalThis.__scdawHandledAutoplay = true;
          clearUrlParam("autoplay");
        }
      }
    } finally {
      this._checkingFileUrlParam = false;
    }
  }

  /**
   * Accessible confirmation dialog using <shadow-claw-dialog>.
   * Replaces native window.confirm() with a themed modal dialog.
   *
   * @param {Object} options
   * @param {string} [options.title="Confirm Action"] - Dialog heading text
   * @param {string} [options.message="Are you sure you want to proceed?"] - Descriptive message
   * @param {string} [options.confirmText="Confirm"] - Text for confirm button
   * @param {string} [options.cancelText="Cancel"] - Text for cancel button
   * @param {boolean} [options.isDestructive=false] - Whether this action is destructive
   * @returns {Promise<boolean>} Resolves true if confirmed, false if cancelled/dismissed
   */
  async confirmDialog({
    title = "Confirm Action",
    message = "Are you sure you want to proceed?",
    confirmText = "Confirm",
    cancelText = "Cancel",
    isDestructive = false,
  } = {}) {
    if (!this.shadowRoot) return false;

    const dialogWrapper = this.shadowRoot.getElementById("confirm-dialog");
    const nativeDialog =
      dialogWrapper?.dialog || dialogWrapper?.querySelector("dialog");

    if (
      !dialogWrapper ||
      typeof dialogWrapper.showModal !== "function" ||
      !nativeDialog
    ) {
      if (
        typeof window !== "undefined" &&
        typeof window.confirm === "function"
      ) {
        return window.confirm(`${title}\n\n${message}`);
      }
      return false;
    }

    const titleEl = this.shadowRoot.getElementById("confirm-dialog-title");
    const msgEl = this.shadowRoot.getElementById("confirm-dialog-message");
    const cancelBtn = this.shadowRoot.getElementById("confirm-dialog-cancel");
    const confirmBtn = this.shadowRoot.getElementById("confirm-dialog-confirm");

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;
    if (cancelBtn) cancelBtn.textContent = cancelText;
    if (confirmBtn) {
      confirmBtn.textContent = confirmText;
      if (isDestructive) {
        confirmBtn.className = "btn btn-danger";
        confirmBtn.style.background = "#dc2626";
        confirmBtn.style.color = "#ffffff";
        confirmBtn.style.borderColor = "#b91c1c";
      } else {
        confirmBtn.className = "btn btn-primary";
        confirmBtn.style.background = "";
        confirmBtn.style.color = "";
        confirmBtn.style.borderColor = "";
      }
    }

    return new Promise((resolve) => {
      let settled = false;
      const cleanup = () => {
        nativeDialog.removeEventListener("close", handleClose);
        confirmBtn?.removeEventListener("click", handleConfirmClick);
        cancelBtn?.removeEventListener("click", handleCancelClick);
      };
      const finish = (isConfirmed) => {
        if (settled) return;
        settled = true;
        cleanup();
        // Reset returnValue to prevent stale value leakage across dialog displays
        nativeDialog.returnValue = "";
        resolve(isConfirmed);
      };
      const handleClose = () => {
        finish(nativeDialog.returnValue === "confirm");
      };
      const closeWith = (val) => {
        nativeDialog.returnValue = val;
        if (typeof dialogWrapper.close === "function") {
          dialogWrapper.close(val);
        } else if (typeof nativeDialog.close === "function") {
          nativeDialog.close(val);
        }
        finish(val === "confirm");
      };
      const handleConfirmClick = (e) => {
        e?.preventDefault?.();
        closeWith("confirm");
      };
      const handleCancelClick = (e) => {
        e?.preventDefault?.();
        closeWith("cancel");
      };

      nativeDialog.addEventListener("close", handleClose);
      confirmBtn?.addEventListener("click", handleConfirmClick);
      cancelBtn?.addEventListener("click", handleCancelClick);
      if (nativeDialog.open && typeof nativeDialog.close === "function") {
        nativeDialog.close();
      }
      dialogWrapper.showModal();
    });
  }

  _updatePanels() {
    if (!this.shadowRoot) return;

    const layout = resolveWorkbenchResponsiveLayout({
      containerWidth: this._containerWidth,
      viewMode: this._viewMode,
      showBrowser: this._showBrowser,
      showMixer: this._showMixer,
      browserWidth: this._browserWidth,
      mixerWidth: this._mixerWidth,
    });

    const grid = this.shadowRoot.getElementById("dock-grid");
    if (grid) grid.style.gridTemplateColumns = layout.gridTemplateColumns;

    const bCont = this.shadowRoot.getElementById("browser-container");
    const bHandle = this.shadowRoot.getElementById("browser-handle");
    const mCont = this.shadowRoot.getElementById("mixer-container");
    const mHandle = this.shadowRoot.getElementById("mixer-handle");
    const centerStack = this.shadowRoot.getElementById("center-stack");
    const timelineCont = this.shadowRoot.getElementById("timeline-container");
    const editorBar = this.shadowRoot.getElementById("editor-bar");
    const edCont = this.shadowRoot.getElementById("editor-container");
    const seqCont = this.shadowRoot.getElementById("seq-container");
    const synthCont = this.shadowRoot.getElementById("synth-container");
    const waveCont = this.shadowRoot.getElementById("wave-container");
    const devCont = this.shadowRoot.getElementById("devices-container");

    if (centerStack) {
      const csHeight =
        centerStack.offsetHeight || centerStack.clientHeight || 0;
      if (csHeight > 0) {
        this.style.setProperty("--center-stack-h", `${csHeight}px`);
      }
    }

    const setVisible = (el, visible, display = "block") => {
      if (!el) return;
      el.classList.toggle("hidden", !visible);
      if (visible) {
        el.removeAttribute("hidden");
        el.style.display = display;
      } else {
        el.setAttribute("hidden", "");
        el.style.display = "none";
      }
    };

    const isMobile = this._containerWidth < 640;
    const btnStates = resolveWorkbenchButtonStates({
      viewMode: this._viewMode,
      showBrowser: this._showBrowser,
      showMixer: this._showMixer,
      isMobile,
    });

    if (this._viewMode === "piano-roll-full") {
      setVisible(bCont, false);
      setVisible(bHandle, false, "inline-flex");
      setVisible(mCont, false);
      setVisible(mHandle, false, "inline-flex");
      setVisible(centerStack, true, "flex");
      setVisible(timelineCont, true);
      setVisible(editorBar, false, "flex");
      setVisible(edCont, true);
      setVisible(seqCont, false);
      setVisible(synthCont, false);
      setVisible(waveCont, false);
      setVisible(devCont, false);
    } else if (this._viewMode === "sequencer-full") {
      setVisible(bCont, false);
      setVisible(bHandle, false, "inline-flex");
      setVisible(mCont, false);
      setVisible(mHandle, false, "inline-flex");
      setVisible(centerStack, true, "flex");
      setVisible(timelineCont, true);
      setVisible(editorBar, false, "flex");
      setVisible(edCont, false);
      setVisible(seqCont, true);
      setVisible(synthCont, false);
      setVisible(waveCont, false);
      setVisible(devCont, false);
    } else if (this._viewMode === "synth-full") {
      setVisible(bCont, false);
      setVisible(bHandle, false, "inline-flex");
      setVisible(mCont, false);
      setVisible(mHandle, false, "inline-flex");
      setVisible(centerStack, true, "flex");
      setVisible(timelineCont, false);
      setVisible(editorBar, false, "flex");
      setVisible(edCont, false);
      setVisible(seqCont, false);
      setVisible(synthCont, true);
      setVisible(waveCont, false);
      setVisible(devCont, false);
    } else if (this._viewMode === "audio-full") {
      setVisible(bCont, false);
      setVisible(bHandle, false, "inline-flex");
      setVisible(mCont, false);
      setVisible(mHandle, false, "inline-flex");
      setVisible(centerStack, true, "flex");
      setVisible(timelineCont, true);
      setVisible(editorBar, false, "flex");
      setVisible(edCont, false);
      setVisible(seqCont, false);
      setVisible(synthCont, false);
      setVisible(waveCont, true);
      setVisible(devCont, false);
    } else if (this._viewMode === "browser-full") {
      setVisible(bCont, true, "flex");
      setVisible(bHandle, false, "inline-flex");
      setVisible(mCont, false);
      setVisible(mHandle, false, "inline-flex");
      setVisible(centerStack, false, "flex");
      setVisible(synthCont, false);
      setVisible(waveCont, false);
    } else if (this._viewMode === "mixer-full") {
      setVisible(bCont, false);
      setVisible(bHandle, false, "inline-flex");
      setVisible(mCont, true);
      setVisible(mHandle, false, "inline-flex");
      setVisible(centerStack, false, "flex");
      setVisible(synthCont, false);
      setVisible(waveCont, false);
    } else {
      // Studio layout: On mobile, side docks are hidden by default to prioritize workspace
      const showBrowser = btnStates.browser.visible;
      const showMixer = btnStates.mixer.visible;
      setVisible(bCont, showBrowser);
      setVisible(bHandle, layout.showBrowserHandle, "inline-flex");
      setVisible(mCont, showMixer);
      setVisible(mHandle, layout.showMixerHandle, "inline-flex");
      setVisible(centerStack, true, "flex");
      setVisible(timelineCont, true);
      setVisible(editorBar, true, "flex");
      setVisible(edCont, this._editorMode === "piano-roll");
      setVisible(seqCont, this._editorMode === "step-sequencer");
      setVisible(synthCont, this._editorMode === "synth");
      setVisible(waveCont, this._editorMode === "audio");
      setVisible(devCont, this._showDevices);
    }

    // Update Center Editor Switcher active states
    const centerPianoBtn = this.shadowRoot.getElementById(
      "center-editor-piano-btn",
    );
    const centerSeqBtn = this.shadowRoot.getElementById(
      "center-editor-seq-btn",
    );
    const centerSynthBtn = this.shadowRoot.getElementById(
      "center-editor-synth-btn",
    );
    const centerAudioBtn = this.shadowRoot.getElementById(
      "center-editor-audio-btn",
    );
    const centerDevBtn = this.shadowRoot.getElementById(
      "center-toggle-devices-btn",
    );
    if (centerPianoBtn) {
      const isPiano = this._editorMode === "piano-roll";
      centerPianoBtn.classList.toggle("btn-primary", isPiano);
      centerPianoBtn.classList.toggle("scdaw-workbench__btn--active", isPiano);
      centerPianoBtn.setAttribute("aria-pressed", String(isPiano));
    }
    if (centerSeqBtn) {
      const isSeq = this._editorMode === "step-sequencer";
      centerSeqBtn.classList.toggle("btn-primary", isSeq);
      centerSeqBtn.classList.toggle("scdaw-workbench__btn--active", isSeq);
      centerSeqBtn.setAttribute("aria-pressed", String(isSeq));
    }
    if (centerSynthBtn) {
      const isSynth = this._editorMode === "synth";
      centerSynthBtn.classList.toggle("btn-primary", isSynth);
      centerSynthBtn.classList.toggle("scdaw-workbench__btn--active", isSynth);
      centerSynthBtn.setAttribute("aria-pressed", String(isSynth));
    }
    if (centerAudioBtn) {
      const isAudio = this._editorMode === "audio";
      centerAudioBtn.classList.toggle("btn-primary", isAudio);
      centerAudioBtn.classList.toggle("scdaw-workbench__btn--active", isAudio);
      centerAudioBtn.setAttribute("aria-pressed", String(isAudio));
    }
    if (centerDevBtn) {
      centerDevBtn.classList.toggle("btn-primary", this._showDevices);
      centerDevBtn.classList.toggle(
        "scdaw-workbench__btn--active",
        this._showDevices,
      );
      centerDevBtn.setAttribute("aria-pressed", String(this._showDevices));
    }

    // Update active button states & ARIA pressed attributes
    const modeStudio = this.shadowRoot.getElementById("mode-studio-btn");
    const modeBrowserFull = this.shadowRoot.getElementById(
      "mode-browser-full-btn",
    );
    const modePiano = this.shadowRoot.getElementById("mode-piano-full-btn");
    const modeSeq = this.shadowRoot.getElementById("mode-seq-full-btn");
    const modeSynth = this.shadowRoot.getElementById("mode-synth-full-btn");
    const modeAudio = this.shadowRoot.getElementById("mode-audio-full-btn");
    const modeMixer = this.shadowRoot.getElementById("mode-mixer-full-btn");
    const bBtn = this.shadowRoot.getElementById("toggle-browser-btn");
    const mBtn = this.shadowRoot.getElementById("toggle-mixer-btn");

    if (modeBrowserFull) {
      modeBrowserFull.disabled = btnStates.browserFull.disabled;
      modeBrowserFull.setAttribute(
        "aria-disabled",
        String(btnStates.browserFull.disabled),
      );
      modeBrowserFull.classList.toggle(
        "btn-primary",
        btnStates.browserFull.active,
      );
      modeBrowserFull.classList.toggle(
        "scdaw-workbench__btn--active",
        btnStates.browserFull.active,
      );
      modeBrowserFull.setAttribute(
        "aria-pressed",
        String(btnStates.browserFull.active),
      );
      modeBrowserFull.setAttribute(
        "aria-selected",
        String(btnStates.browserFull.active),
      );
    }

    if (modeStudio) {
      modeStudio.disabled = btnStates.studio.disabled;
      modeStudio.setAttribute(
        "aria-disabled",
        String(btnStates.studio.disabled),
      );
      modeStudio.classList.toggle("btn-primary", btnStates.studio.active);
      modeStudio.classList.toggle(
        "scdaw-workbench__btn--active",
        btnStates.studio.active,
      );
      modeStudio.setAttribute("aria-pressed", String(btnStates.studio.active));
    }
    if (modePiano) {
      modePiano.disabled = btnStates.pianoRollFull.disabled;
      modePiano.setAttribute(
        "aria-disabled",
        String(btnStates.pianoRollFull.disabled),
      );
      modePiano.classList.toggle("btn-primary", btnStates.pianoRollFull.active);
      modePiano.classList.toggle(
        "scdaw-workbench__btn--active",
        btnStates.pianoRollFull.active,
      );
      modePiano.setAttribute(
        "aria-pressed",
        String(btnStates.pianoRollFull.active),
      );
      modePiano.setAttribute(
        "aria-selected",
        String(btnStates.pianoRollFull.active),
      );
    }
    if (modeSeq) {
      modeSeq.disabled = btnStates.sequencerFull.disabled;
      modeSeq.setAttribute(
        "aria-disabled",
        String(btnStates.sequencerFull.disabled),
      );
      modeSeq.classList.toggle("btn-primary", btnStates.sequencerFull.active);
      modeSeq.classList.toggle(
        "scdaw-workbench__btn--active",
        btnStates.sequencerFull.active,
      );
      modeSeq.setAttribute(
        "aria-pressed",
        String(btnStates.sequencerFull.active),
      );
      modeSeq.setAttribute(
        "aria-selected",
        String(btnStates.sequencerFull.active),
      );
    }
    if (modeSynth) {
      modeSynth.disabled = btnStates.synthFull.disabled;
      modeSynth.setAttribute(
        "aria-disabled",
        String(btnStates.synthFull.disabled),
      );
      modeSynth.classList.toggle("btn-primary", btnStates.synthFull.active);
      modeSynth.classList.toggle(
        "scdaw-workbench__btn--active",
        btnStates.synthFull.active,
      );
      modeSynth.setAttribute(
        "aria-pressed",
        String(btnStates.synthFull.active),
      );
      modeSynth.setAttribute(
        "aria-selected",
        String(btnStates.synthFull.active),
      );
    }
    if (modeAudio) {
      modeAudio.disabled = btnStates.audioFull.disabled;
      modeAudio.setAttribute(
        "aria-disabled",
        String(btnStates.audioFull.disabled),
      );
      modeAudio.classList.toggle("btn-primary", btnStates.audioFull.active);
      modeAudio.classList.toggle(
        "scdaw-workbench__btn--active",
        btnStates.audioFull.active,
      );
      modeAudio.setAttribute(
        "aria-pressed",
        String(btnStates.audioFull.active),
      );
      modeAudio.setAttribute(
        "aria-selected",
        String(btnStates.audioFull.active),
      );
    }
    if (modeMixer) {
      modeMixer.disabled = btnStates.mixerFull.disabled;
      modeMixer.setAttribute(
        "aria-disabled",
        String(btnStates.mixerFull.disabled),
      );
      modeMixer.classList.toggle("btn-primary", btnStates.mixerFull.active);
      modeMixer.classList.toggle(
        "scdaw-workbench__btn--active",
        btnStates.mixerFull.active,
      );
      modeMixer.setAttribute(
        "aria-pressed",
        String(btnStates.mixerFull.active),
      );
      modeMixer.setAttribute(
        "aria-selected",
        String(btnStates.mixerFull.active),
      );
    }
    if (bBtn) {
      bBtn.disabled = btnStates.browser.disabled;
      bBtn.setAttribute("aria-disabled", String(btnStates.browser.disabled));
      bBtn.classList.toggle("btn-primary", btnStates.browser.active);
      bBtn.classList.toggle(
        "scdaw-workbench__btn--active",
        btnStates.browser.active,
      );
      bBtn.setAttribute("aria-pressed", String(btnStates.browser.active));
      bBtn.title = btnStates.browser.disabled
        ? isMobile
          ? "Browser dock is unavailable in mobile view"
          : "Browser dock is only available in Studio layout"
        : "Toggle Browser Dock";
    }
    if (mBtn) {
      mBtn.disabled = btnStates.mixer.disabled;
      mBtn.setAttribute("aria-disabled", String(btnStates.mixer.disabled));
      mBtn.classList.toggle("btn-primary", btnStates.mixer.active);
      mBtn.classList.toggle(
        "scdaw-workbench__btn--active",
        btnStates.mixer.active,
      );
      mBtn.setAttribute("aria-pressed", String(btnStates.mixer.active));
      mBtn.title = btnStates.mixer.disabled
        ? isMobile
          ? "Mixer dock is unavailable in mobile view"
          : "Mixer dock is only available in Studio layout"
        : "Toggle Mixer Dock";
    }
  }

  _syncProject(p) {
    if (!this.shadowRoot || !p) return;
    const name = this.shadowRoot.getElementById("proj-header-name");
    const bpm = this.shadowRoot.getElementById("proj-bpm");
    if (name) {
      name.textContent = `${p.name || "Untitled"}`;
    }
    if (bpm) {
      bpm.textContent = `${p.bpm} BPM`;
    }
  }

  _syncErrorBanner(lastError) {
    if (!this.shadowRoot) return;
    const banner = this.shadowRoot.getElementById("scdaw-error-banner");
    const titleEl = this.shadowRoot.getElementById("scdaw-error-title");
    const msgEl = this.shadowRoot.getElementById("scdaw-error-message");
    if (!banner) return;
    if (lastError) {
      if (titleEl) {
        titleEl.textContent =
          typeof lastError === "string" ? "Error" : lastError.title || "Error";
      }
      if (msgEl) {
        msgEl.textContent =
          typeof lastError === "string"
            ? lastError
            : lastError.message || "An unexpected error occurred";
      }
      banner.hidden = false;
      banner.classList.remove("hidden");
    } else {
      if (titleEl) titleEl.textContent = "";
      if (msgEl) msgEl.textContent = "";
      banner.hidden = true;
      banner.classList.add("hidden");
    }
  }

  render() {
    this._renderSkeleton();
    this._updatePanels();
  }
}

if (
  typeof customElements !== "undefined" &&
  !customElements.get("scdaw-workbench")
) {
  customElements.define("scdaw-workbench", DawWorkbenchElement);
}
