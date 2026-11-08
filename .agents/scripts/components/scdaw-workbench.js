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
      gridTemplateColumns: "1fr",
      showBrowser: isMobile ? false : showBrowser && !isFullWidth,
      showMixer: isMobile ? false : showMixer && !isFullWidth,
    };
  }

  // Tablet: 2-column or adaptable
  if (isTablet) {
    const showSide = showBrowser && !showMixer;
    const showMix = showMixer && !showBrowser;
    const cols = showSide
      ? `${browserWidth}px 8px 1fr`
      : showMix
        ? `1fr 8px ${mixerWidth}px`
        : "1fr";
    return {
      isMobile,
      isTablet,
      isDesktop,
      isFullWidth: false,
      activeFocus: "studio",
      showResizeHandles: showSide || showMix,
      gridTemplateColumns: cols,
      showBrowser: showSide,
      showMixer: showMix,
    };
  }

  // Desktop (>= 1024px)
  let cols;
  let showHandles = false;
  if (showBrowser && showMixer) {
    cols = `${browserWidth}px 8px 1fr 8px ${mixerWidth}px`;
    showHandles = true;
  } else if (showBrowser) {
    cols = `${browserWidth}px 8px 1fr`;
    showHandles = true;
  } else if (showMixer) {
    cols = `1fr 8px ${mixerWidth}px`;
    showHandles = true;
  } else {
    cols = "1fr";
    showHandles = false;
  }

  return {
    isMobile,
    isTablet,
    isDesktop,
    isFullWidth: false,
    activeFocus: "studio",
    showResizeHandles: showHandles,
    gridTemplateColumns: cols,
    showBrowser,
    showMixer,
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
    this._editorMode = "piano-roll"; // "piano-roll" | "step-sequencer"
    this._viewMode = "studio"; // "studio" | "piano-roll-full" | "sequencer-full" | "mixer-full"
    this._browserWidth = 230;
    this._mixerWidth = 320;
    this._resizeObserver = null;
    this._containerWidth = 1200;
  }

  connectedCallback() {
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
            Math.abs(cr.width - this._containerWidth) > 20
          ) {
            this._containerWidth = cr.width;
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
          box-sizing: border-box;
          container-type: inline-size;
          container-name: scdaw-workbench;
          --browser-w: ${this._browserWidth}px;
          --mixer-w: ${this._mixerWidth}px;
        }
        .scdaw-workbench {
          width: 100%;
          box-sizing: border-box;
          padding: 0.5rem;
        }
        .scdaw-workbench__header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.75rem;
          border-bottom: 1px solid var(--border);
          padding-bottom: 0.6rem;
          flex-wrap: wrap;
          gap: 0.6rem;
        }
        .scdaw-workbench__title-area {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          flex-wrap: wrap;
        }
        .scdaw-workbench__title {
          margin: 0;
          font-size: 1.3rem;
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }
        .scdaw-workbench__toolbar {
          display: flex;
          gap: 0.4rem;
          align-items: center;
          flex-wrap: wrap;
        }
        .scdaw-workbench__toolbar .btn {
          height: 30px;
          min-height: 30px;
          max-height: 30px;
          box-sizing: border-box;
          padding: 0 0.6rem;
          font-size: 0.78rem;
          line-height: 1;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.35rem;
          white-space: nowrap;
        }
        .scdaw-workbench__view-switcher {
          display: flex;
          gap: 4px;
          background: rgba(0, 0, 0, 0.25);
          padding: 3px;
          border-radius: 6px;
          align-items: center;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }
        .scdaw-workbench__toolbar-sep {
          color: var(--border, #3f4849);
          opacity: 0.6;
          user-select: none;
          font-size: 0.85rem;
          padding: 0 2px;
        }
        .scdaw-workbench__dock-grid {
          display: grid;
          gap: 0;
          align-items: start;
          width: 100%;
          box-sizing: border-box;
          transition: grid-template-columns 0.1s ease;
        }
        .scdaw-workbench__center-stack {
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
          min-width: 0;
          width: 100%;
          box-sizing: border-box;
        }
        .scdaw-workbench__dock-panel {
          min-width: 0;
          box-sizing: border-box;
        }

        /* Container Queries: Mobile First & Component Sizing */
        @container scdaw-workbench (max-width: 680px) {
          .scdaw-workbench__header {
            flex-direction: column;
            align-items: stretch;
            gap: 0.6rem;
          }
          .scdaw-workbench__toolbar {
            justify-content: space-between;
          }
          .scdaw-workbench__view-switcher {
            width: 100%;
            justify-content: flex-start;
          }
          .scdaw-workbench__dock-grid {
            display: flex !important;
            flex-direction: column !important;
            gap: 0.75rem !important;
          }
          scdaw-resize-handle {
            display: none !important;
          }
          #browser-container,
          #mixer-container {
            width: 100% !important;
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
        .scdaw-dialog__form {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          margin: 0;
        }
        .scdaw-dialog__title {
          margin: 0;
          font-size: 1.15rem;
          font-weight: 600;
          color: var(--accent, #80d4db);
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
          <div class="scdaw-workbench__title-area">
            <h1 class="scdaw-workbench__title">
              <span>🎚️ ShadowClaw DAW</span>
              <span class="badge" style="color:var(--accent);">Studio Workbench</span>
            </h1>
            <span id="proj-header-info" style="font-size:0.78rem; color:var(--shadow-claw-text-secondary, #94a3b8);" aria-live="polite">
              Project: <strong id="proj-header-name">${p.name || "Untitled"}</strong>
            </span>
            <span id="proj-bpm" class="badge" style="color:var(--accent);">${p.bpm} BPM</span>
          </div>

          <div class="scdaw-workbench__toolbar" role="toolbar" aria-label="Workbench View Controls">
            <button id="new-btn" class="btn btn-icon" title="New project (reset to default starter template)">📄 New</button>
            <button id="import-btn" class="btn btn-icon" title="Open or import project (.scdaw.json, .dawproject, .mid)">📂 Open</button>
            <button id="export-btn" class="btn btn-icon btn-primary" title="Save or export audio mixdown, stems ZIP, MIDI, or DAWproject">💾 Export</button>
            <button id="reset-btn" class="btn btn-icon" title="Reset the entire project to default starter template">🔄 Reset</button>
            <span class="scdaw-workbench__toolbar-sep" aria-hidden="true">|</span>
            <div style="display:flex; gap:3px;">
              <button id="toggle-browser-btn" class="btn btn-icon" title="Toggle Browser Dock" aria-pressed="true">📁 Browser</button>
            </div>
            <div style="display:flex; gap:3px;">
              <button id="mode-studio-btn" class="btn btn-icon btn-primary" title="Multi-Pane Studio Layout" aria-pressed="true">🎛 Studio</button>
            </div>
            <div style="display:flex; gap:3px;">
              <button id="toggle-mixer-btn" class="btn btn-icon" title="Toggle Mixer Dock" aria-pressed="true">🎛 Mixer</button>
            </div>
            <span class="scdaw-workbench__toolbar-sep" aria-hidden="true">|</span>
            <div class="scdaw-workbench__view-switcher">
              <button id="mode-mixer-full-btn" class="btn btn-icon" title="Full Width Mixer Console" aria-pressed="false">🎚 Mixer (Full)</button>
              <button id="mode-piano-full-btn" class="btn btn-icon" title="Full Width Piano Roll Editor" aria-pressed="false">🎹 Piano Roll (Full)</button>
              <button id="mode-seq-full-btn" class="btn btn-icon" title="Full Width Drum Matrix" aria-pressed="false">🥁 Drum Matrix (Full)</button>
            </div>
            <span class="scdaw-workbench__toolbar-sep" aria-hidden="true">|</span>
            <button id="undo-btn" class="btn btn-icon" title="Undo last change">↩ Undo</button>
            <button id="bounce-btn" class="btn btn-icon btn-primary" title="Export 16-bit WAV audio">💿 Bounce WAV</button>
          </div>
        </header>

        <section style="margin-bottom:0.6rem;" aria-label="Audio Transport">
          <scdaw-transport></scdaw-transport>
        </section>

        <main id="dock-grid" class="scdaw-workbench__dock-grid" role="main">
          <!-- Left: Browser Panel -->
          <div id="browser-container" class="scdaw-workbench__dock-panel scdaw-workbench__dock-panel--browser" role="region" aria-label="Library Browser">
            <scdaw-browser></scdaw-browser>
          </div>

          <!-- Browser Resize Handle -->
          <scdaw-resize-handle id="browser-handle" orientation="vertical" value="${this._browserWidth}" min="150" max="420" label="Resize Browser panel"></scdaw-resize-handle>

          <!-- Center Stack: Timeline + Editor/Sequencer + Device Rack -->
          <div id="center-stack" class="scdaw-workbench__center-stack" role="region" aria-label="Arrangement and Track Editing">
            <div id="timeline-container">
              <scdaw-timeline></scdaw-timeline>
            </div>
            <div id="editor-container">
              <scdaw-editor></scdaw-editor>
            </div>
            <div id="seq-container">
              <scdaw-sequencer></scdaw-sequencer>
            </div>
            <div id="devices-container">
              <scdaw-devices></scdaw-devices>
            </div>
          </div>

          <!-- Mixer Resize Handle -->
          <scdaw-resize-handle id="mixer-handle" orientation="vertical" value="${this._mixerWidth}" min="180" max="520" label="Resize Mixer panel"></scdaw-resize-handle>

          <!-- Right: Mixer Panel -->
          <div id="mixer-container" class="scdaw-workbench__dock-panel scdaw-workbench__dock-panel--mixer" role="region" aria-label="Mixer Console">
            <scdaw-mixer></scdaw-mixer>
          </div>
        </main>

        <footer style="margin-top:0.6rem;" role="contentinfo">
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
        <dialog id="export-modal" class="scdaw-dialog" aria-labelledby="export-modal-title" style="padding:1.4rem; max-width:480px; width:92%; border-radius:8px; background:var(--surface, #1e293b); color:var(--text, #f8fafc); border:1px solid var(--border, #334155); box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);">
          <form method="dialog" id="export-form" style="display:flex; flex-direction:column; gap:0.9rem;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <h3 id="export-modal-title" style="margin:0; font-size:1.1rem; color:var(--text, #f8fafc);">💾 Save & Export</h3>
              <button type="button" id="export-modal-close" class="btn btn-icon" aria-label="Close export dialog" style="padding:2px 8px; font-size:1rem;">✕</button>
            </div>

            <!-- Destination Conversation Selection -->
            <div style="display:flex; flex-direction:column; gap:0.3rem;">
              <label for="export-conversation-select" style="font-size:0.8rem; font-weight:600; color:var(--shadow-claw-text-secondary, #94a3b8);">Destination Conversation</label>
              <select id="export-conversation-select" style="padding:0.4rem; background:var(--background, #0f172a); color:var(--text, #f8fafc); border:1px solid var(--border, #334155); border-radius:4px;">
                <option value="br:main" selected>Main (Default)</option>
              </select>
            </div>

            <!-- Filename Input -->
            <div style="display:flex; flex-direction:column; gap:0.3rem;">
              <label for="export-filename-input" style="font-size:0.8rem; font-weight:600; color:var(--shadow-claw-text-secondary, #94a3b8);">File Name</label>
              <input type="text" id="export-filename-input" value="${p.name || "daw"}" style="padding:0.4rem; background:var(--background, #0f172a); color:var(--text, #f8fafc); border:1px solid var(--border, #334155); border-radius:4px; box-sizing:border-box;"/>
            </div>

            <!-- Format Selector -->
            <div style="display:flex; flex-direction:column; gap:0.3rem;">
              <label for="export-format-select" style="font-size:0.8rem; font-weight:600; color:var(--shadow-claw-text-secondary, #94a3b8);">Format</label>
              <select id="export-format-select" style="padding:0.4rem; background:var(--background, #0f172a); color:var(--text, #f8fafc); border:1px solid var(--border, #334155); border-radius:4px;">
                <option value="json" selected>Native Project (.scdaw.json)</option>
                <option value="dawproject">DAWproject Interchange (.dawproject)</option>
                <option value="wav">WAV Audio Mixdown (.wav)</option>
                <option value="stems">Consolidated Stems Bundle (.zip)</option>
                <option value="midi">Standard MIDI File (.mid)</option>
              </select>
            </div>

            <!-- Save Target Options -->
            <div style="display:flex; flex-direction:column; gap:0.4rem; padding:0.2rem 0;">
              <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.8rem; cursor:pointer; color:var(--text, #f8fafc);">
                <input type="checkbox" id="export-save-to-fs" checked />
                <span>Save to Conversation Files (ShadowClaw FS / OPFS)</span>
              </label>
              <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.8rem; cursor:pointer; color:var(--shadow-claw-text-secondary, #94a3b8);">
                <input type="checkbox" id="export-download-copy" />
                <span>Also download copy to computer</span>
              </label>
            </div>

            <div id="export-opt-wav" style="display:none; flex-direction:column; gap:0.6rem;">
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.6rem;">
                <div>
                  <label for="export-bitdepth" style="font-size:0.75rem; color:var(--shadow-claw-text-secondary, #94a3b8);">Bit Depth</label>
                  <select id="export-bitdepth" style="width:100%; padding:0.35rem; background:var(--background, #0f172a); color:var(--text, #f8fafc); border:1px solid var(--border, #334155); border-radius:4px;">
                    <option value="16">16-bit PCM</option>
                    <option value="24" selected>24-bit PCM (Studio Standard)</option>
                    <option value="32">32-bit Float</option>
                  </select>
                </div>
                <div>
                  <label for="export-loops" style="font-size:0.75rem; color:var(--shadow-claw-text-secondary, #94a3b8);">Loops</label>
                  <input type="number" id="export-loops" min="1" max="16" value="1" style="width:100%; padding:0.35rem; background:var(--background, #0f172a); color:var(--text, #f8fafc); border:1px solid var(--border, #334155); border-radius:4px; box-sizing:border-box;"/>
                </div>
              </div>
            </div>

            <div id="export-opt-stems" style="display:none; flex-direction:column; gap:0.5rem;">
              <div>
                <label for="export-tap-select" style="font-size:0.75rem; color:var(--shadow-claw-text-secondary, #94a3b8);">Tap Routing</label>
                <select id="export-tap-select" style="width:100%; padding:0.35rem; background:var(--background, #0f172a); color:var(--text, #f8fafc); border:1px solid var(--border, #334155); border-radius:4px;">
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
        <dialog id="import-modal" class="scdaw-dialog" aria-labelledby="import-modal-title" style="padding:1.4rem; max-width:480px; width:92%; border-radius:8px; background:var(--surface, #1e293b); color:var(--text, #f8fafc); border:1px solid var(--border, #334155); box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);">
          <form method="dialog" id="import-form" style="display:flex; flex-direction:column; gap:0.9rem;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <h3 id="import-modal-title" style="margin:0; font-size:1.1rem; color:var(--text, #f8fafc);">📂 Open Project</h3>
              <button type="button" id="import-modal-close" class="btn btn-icon" aria-label="Close open dialog" style="padding:2px 8px; font-size:1rem;">✕</button>
            </div>

            <!-- Source Conversation Selector -->
            <div style="display:flex; flex-direction:column; gap:0.3rem;">
              <label for="import-conversation-select" style="font-size:0.8rem; font-weight:600; color:var(--shadow-claw-text-secondary, #94a3b8);">Conversation</label>
              <select id="import-conversation-select" style="padding:0.4rem; background:var(--background, #0f172a); color:var(--text, #f8fafc); border:1px solid var(--border, #334155); border-radius:4px;">
                <option value="br:main" selected>Main (Default)</option>
              </select>
            </div>

            <!-- Files in selected conversation -->
            <div style="display:flex; flex-direction:column; gap:0.3rem;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <label for="import-file-list" style="font-size:0.8rem; font-weight:600; color:var(--shadow-claw-text-secondary, #94a3b8);">Files in Conversation</label>
                <button type="button" id="import-refresh-btn" class="btn btn-icon" title="Refresh files" style="padding:2px 6px; font-size:0.75rem;">🔄 Refresh</button>
              </div>
              <div id="import-file-list" class="scdaw-file-list" role="listbox" aria-label="Available project files" tabindex="0" style="min-height:160px; max-height:220px; overflow-y:auto; border:1px solid var(--border, #334155); border-radius:4px; padding:0.4rem; background:var(--background, #0f172a); display:flex; flex-direction:column; gap:4px;">
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
    this.shadowRoot
      .getElementById("bounce-btn")
      ?.addEventListener("click", () => {
        const modal = this.shadowRoot.getElementById("export-modal");
        if (modal && typeof modal.showModal === "function") {
          modal.showModal();
        }
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
            <div class="scdaw-file-item" role="option" aria-selected="false" tabindex="0" data-filename="${f.name}" data-format="${f.format}" style="padding:0.45rem 0.6rem; border-radius:4px; display:flex; justify-content:space-between; align-items:center; cursor:pointer; font-size:0.8rem; background:var(--surface, #1e293b); color:var(--text, #f8fafc); border:1px solid transparent; transition:border-color 0.15s, background 0.15s;">
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
                el.style.borderColor = "transparent";
                el.style.background = "var(--surface, #1e293b)";
                el.setAttribute("aria-selected", "false");
              });
            item.style.borderColor = "var(--accent, #38bdf8)";
            item.style.background = "var(--bg-elevated, #334155)";
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

    this.shadowRoot
      .getElementById("export-btn")
      ?.addEventListener("click", async () => {
        if (exportModal && typeof exportModal.showModal === "function") {
          const p = scdaw.getProject();
          if (exportFilenameInput) {
            exportFilenameInput.value = (p.name || "daw").replace(
              /[^a-zA-Z0-9_-]/g,
              "_",
            );
          }
          const targetGid = exportConvSelect?.value || DEFAULT_GROUP_ID;
          await populateConversations(exportConvSelect, targetGid);
          exportModal.showModal();
        }
      });

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
        } catch (err) {
          console.error("Save/Export error:", err);
        } finally {
          if (submitBtn) submitBtn.textContent = "Save & Export";
        }
      });

    // PWA LaunchQueue File Handling API (opens files directly from OS file manager)
    if (
      typeof window !== "undefined" &&
      "launchQueue" in window &&
      window.LaunchParams?.prototype?.files
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

    // Context-Sensitive Drag and Drop
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
        const rawPlugin = e.dataTransfer?.getData("application/x-scdaw-plugin");
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
    const edCont = this.shadowRoot.getElementById("editor-container");
    const seqCont = this.shadowRoot.getElementById("seq-container");
    const devCont = this.shadowRoot.getElementById("devices-container");

    if (this._viewMode === "piano-roll-full") {
      if (bCont) bCont.style.display = "none";
      if (bHandle) bHandle.style.display = "none";
      if (mCont) mCont.style.display = "none";
      if (mHandle) mHandle.style.display = "none";
      if (centerStack) centerStack.style.display = "flex";
      if (timelineCont) timelineCont.style.display = "block";
      if (edCont) edCont.style.display = "block";
      if (seqCont) seqCont.style.display = "none";
      if (devCont) devCont.style.display = "none";
    } else if (this._viewMode === "sequencer-full") {
      if (bCont) bCont.style.display = "none";
      if (bHandle) bHandle.style.display = "none";
      if (mCont) mCont.style.display = "none";
      if (mHandle) mHandle.style.display = "none";
      if (centerStack) centerStack.style.display = "flex";
      if (timelineCont) timelineCont.style.display = "block";
      if (edCont) edCont.style.display = "none";
      if (seqCont) seqCont.style.display = "block";
      if (devCont) devCont.style.display = "none";
    } else if (this._viewMode === "mixer-full") {
      if (bCont) bCont.style.display = "none";
      if (bHandle) bHandle.style.display = "none";
      if (mCont) mCont.style.display = "block";
      if (mHandle) mHandle.style.display = "none";
      if (centerStack) centerStack.style.display = "none";
    } else {
      // Studio layout
      if (bCont) bCont.style.display = this._showBrowser ? "block" : "none";
      if (bHandle)
        bHandle.style.display = this._showBrowser ? "inline-block" : "none";
      if (mCont) mCont.style.display = this._showMixer ? "block" : "none";
      if (mHandle)
        mHandle.style.display = this._showMixer ? "inline-block" : "none";
      if (centerStack) centerStack.style.display = "flex";
      if (timelineCont) timelineCont.style.display = "block";
      if (edCont)
        edCont.style.display =
          this._editorMode === "piano-roll" ? "block" : "none";
      if (seqCont)
        seqCont.style.display =
          this._editorMode === "step-sequencer" ? "block" : "none";
      if (devCont) devCont.style.display = "block";
    }

    // Update active button states & ARIA pressed attributes
    const modeStudio = this.shadowRoot.getElementById("mode-studio-btn");
    const modePiano = this.shadowRoot.getElementById("mode-piano-full-btn");
    const modeSeq = this.shadowRoot.getElementById("mode-seq-full-btn");
    const modeMixer = this.shadowRoot.getElementById("mode-mixer-full-btn");
    const bBtn = this.shadowRoot.getElementById("toggle-browser-btn");
    const mBtn = this.shadowRoot.getElementById("toggle-mixer-btn");

    const isMobile = this._containerWidth < 640;
    const btnStates = resolveWorkbenchButtonStates({
      viewMode: this._viewMode,
      showBrowser: this._showBrowser,
      showMixer: this._showMixer,
      isMobile,
    });

    if (modeStudio) {
      modeStudio.disabled = btnStates.studio.disabled;
      modeStudio.setAttribute(
        "aria-disabled",
        String(btnStates.studio.disabled),
      );
      modeStudio.classList.toggle("btn-primary", btnStates.studio.active);
      modeStudio.setAttribute("aria-pressed", String(btnStates.studio.active));
    }
    if (modePiano) {
      modePiano.disabled = btnStates.pianoRollFull.disabled;
      modePiano.setAttribute(
        "aria-disabled",
        String(btnStates.pianoRollFull.disabled),
      );
      modePiano.classList.toggle("btn-primary", btnStates.pianoRollFull.active);
      modePiano.setAttribute(
        "aria-pressed",
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
      modeSeq.setAttribute(
        "aria-pressed",
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
      modeMixer.setAttribute(
        "aria-pressed",
        String(btnStates.mixerFull.active),
      );
    }
    if (bBtn) {
      bBtn.disabled = btnStates.browser.disabled;
      bBtn.setAttribute("aria-disabled", String(btnStates.browser.disabled));
      bBtn.classList.toggle("btn-primary", btnStates.browser.active);
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
