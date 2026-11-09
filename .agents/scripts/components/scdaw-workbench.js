/**
 * .agents/scripts/components/scdaw-workbench.js
 *
 * Master Studio Docking Workbench Web Component (<scdaw-workbench>).
 * Ported concepts from openDAW DefaultWorkspace & WorkspacePage.
 * Incorporates CSS Container Queries (@container), accessible split-pane
 * resize handles (<scdaw-resize-handle>), and responsive mobile-first full-width views.
 */

import { SHARED_STYLES } from "./scdaw-styles.js";
import { scdaw } from "../scdaw-engine.js";
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
import "./scdaw-sequencer.js";
import "./scdaw-devices.js";
import "./scdaw-mixer.js";
import "./scdaw-statusbar.js";
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
  viewMode = "studio", // "studio" | "piano-roll-full" | "sequencer-full" | "mixer-full"
  showBrowser = true,
  showMixer = true,
  browserWidth = 220,
  mixerWidth = 300,
} = {}) {
  const isMobile = containerWidth < 640;
  const isTablet = containerWidth >= 640 && containerWidth < 1024;
  const isDesktop = containerWidth >= 1024;

  const isFullWidth =
    viewMode === "piano-roll-full" ||
    viewMode === "sequencer-full" ||
    viewMode === "mixer-full";

  let activeFocus = "studio";
  if (viewMode === "piano-roll-full") activeFocus = "piano-roll";
  else if (viewMode === "sequencer-full") activeFocus = "sequencer";
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
      showBrowser: false,
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
      editorMode === "step-sequencer" ? "step-sequencer" : "piano-roll",
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
    pianoRollFull: {
      active: viewMode === "piano-roll-full",
      disabled: false,
    },
    sequencerFull: {
      active: viewMode === "sequencer-full",
      disabled: false,
    },
    mixerFull: {
      active: viewMode === "mixer-full",
      disabled: false,
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
    this._measureContainerWidth();
    this._renderSkeleton();
    this._updatePanels();
    this._dispose = effect(() => {
      const p = scdaw.project.get();
      this._syncProject(p);
    });

    if (typeof ResizeObserver !== "undefined" && this.shadowRoot) {
      this._resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
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
      });
      const rootEl = this.shadowRoot.querySelector(".scdaw-workbench");
      if (rootEl) this._resizeObserver.observe(rootEl);
    }
  }

  disconnectedCallback() {
    if (this._dispose) this._dispose();
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
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
        }

        /* 1. Mobile First Base Styles (Default for all viewports) */
        .scdaw-workbench {
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          padding: 0.5rem;
          overflow-x: hidden;
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

        /* Actions: 2 equal columns on mobile */
        .scdaw-workbench__toolbar-group--actions {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 0.35rem;
          width: 100%;
        }

        /* Full-width focus views: 3 equal columns on mobile (no scrollbar) */
        .scdaw-workbench__toolbar-group--views,
        .scdaw-workbench__view-switcher {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
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
          grid-template-columns: repeat(2, minmax(0, 1fr));
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

        #browser-container,
        #mixer-container {
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
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
        }

        /* 3. Progressive Enhancement: Desktop Multi-Pane Grid (>= 1024px) */
        @container scdaw-workbench (min-width: 1024px) {
          .scdaw-workbench__dock-grid {
            display: grid;
            gap: 0;
            align-items: stretch;
            grid-template-columns: var(--browser-w, 230px) 8px minmax(0, 1fr) 8px var(--mixer-w, 320px);
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
      </style>
      <div class="scdaw-workbench">
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

            <div class="scdaw-workbench__toolbar-group scdaw-workbench__toolbar-group--actions" role="group" aria-label="History and Output">
              <button id="undo-btn" class="scdaw-workbench__btn btn btn-icon" title="Undo last change">↩ Undo</button>
              <button id="bounce-btn" class="scdaw-workbench__btn btn btn-icon btn-primary" title="Export 16-bit WAV audio">💿 Bounce WAV</button>
            </div>

            <div class="scdaw-workbench__toolbar-group scdaw-workbench__toolbar-group--views scdaw-workbench__view-switcher" role="tablist" aria-label="Layout Focus Views">
              <button id="mode-mixer-full-btn" role="tab" class="scdaw-workbench__btn btn btn-icon" title="Full Width Mixer Console" aria-pressed="false" aria-selected="false">🎚 Mixer (Full)</button>
              <button id="mode-piano-full-btn" role="tab" class="scdaw-workbench__btn btn btn-icon" title="Full Width Piano Roll Editor" aria-pressed="false" aria-selected="false">🎹 Piano Roll (Full)</button>
              <button id="mode-seq-full-btn" role="tab" class="scdaw-workbench__btn btn btn-icon" title="Full Width Drum Matrix" aria-pressed="false" aria-selected="false">🥁 Drum Matrix (Full)</button>
            </div>
          </nav>
        </header>

        <section class="scdaw-workbench__transport" style="margin-bottom:0.6rem;" aria-label="Audio Transport">
          <scdaw-transport></scdaw-transport>
        </section>

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
              </div>
              <button id="center-toggle-devices-btn" type="button" class="btn btn-icon btn-primary scdaw-workbench__btn--active" aria-pressed="true" title="Toggle Track Device Chain Rack">🎛️ Device Rack</button>
            </div>
            <div id="editor-container" class="scdaw-workbench__section scdaw-workbench__section--editor">
              <scdaw-editor></scdaw-editor>
            </div>
            <div id="seq-container" class="scdaw-workbench__section scdaw-workbench__section--sequencer hidden" hidden>
              <scdaw-sequencer></scdaw-sequencer>
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

            <div style="display:flex; justify-content:flex-end; gap:0.6rem; margin-top:0.6rem;">
              <button type="button" id="export-modal-cancel" class="btn">Cancel</button>
              <button type="button" id="export-modal-submit" class="btn btn-primary">Save & Export</button>
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

    // Center Stack Detail Editor Switcher (Piano Roll / Step Sequencer / Device Rack)
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
            "Start a new project? This will reset the workbench to the starter template.",
          confirmText: "New Project",
          cancelText: "Cancel",
          isDestructive: true,
        });
        if (ok) {
          await scdaw.resetProject({ template: "basic-beat" });
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

        importFileList.querySelectorAll(".scdaw-file-item").forEach((item) => {
          item.addEventListener("click", () => {
            importFileList
              .querySelectorAll(".scdaw-file-item")
              .forEach((el) => {
                el.setAttribute("aria-selected", "false");
              });
            item.setAttribute("aria-selected", "true");
            this._selectedImportFile = item.dataset.filename;
            if (importSubmitBtn) importSubmitBtn.disabled = false;
          });

          item.addEventListener("dblclick", async () => {
            this._selectedImportFile = item.dataset.filename;
            await executeOpenSelectedFile();
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
            const target = p.tracks.find((t) => t.id === dropAction.trackId);
            if (target) {
              target.sample = file.name;
              await scdaw.sendCommand("set_track", {
                trackId: target.id,
                sample: file.name,
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
        }
      });
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
      const handleClose = () => {
        nativeDialog.removeEventListener("close", handleClose);
        const isConfirmed = nativeDialog.returnValue === "confirm";
        // Reset returnValue to prevent stale value leakage across dialog displays
        nativeDialog.returnValue = "";
        resolve(isConfirmed);
      };

      nativeDialog.addEventListener("close", handleClose);
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
    const devCont = this.shadowRoot.getElementById("devices-container");

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
      setVisible(devCont, false);
    } else if (this._viewMode === "mixer-full") {
      setVisible(bCont, false);
      setVisible(bHandle, false, "inline-flex");
      setVisible(mCont, true);
      setVisible(mHandle, false, "inline-flex");
      setVisible(centerStack, false, "flex");
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
      setVisible(devCont, this._showDevices);
    }

    // Update Center Editor Switcher active states
    const centerPianoBtn = this.shadowRoot.getElementById(
      "center-editor-piano-btn",
    );
    const centerSeqBtn = this.shadowRoot.getElementById(
      "center-editor-seq-btn",
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
    const modePiano = this.shadowRoot.getElementById("mode-piano-full-btn");
    const modeSeq = this.shadowRoot.getElementById("mode-seq-full-btn");
    const modeMixer = this.shadowRoot.getElementById("mode-mixer-full-btn");
    const bBtn = this.shadowRoot.getElementById("toggle-browser-btn");
    const mBtn = this.shadowRoot.getElementById("toggle-mixer-btn");

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
