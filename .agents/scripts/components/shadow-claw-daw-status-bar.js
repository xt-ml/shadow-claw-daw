/**
 * .agents/scripts/components/shadow-claw-daw-status-bar.js
 *
 * Bottom Telemetry & Status Bar Web Component (<shadow-claw-daw-status-bar>).
 * Composes ShadowClaw's shared `<shadow-claw-status-bar>` chrome while binding
 * DAW audio telemetry, project summary, bounce readouts, MIDI status, and error banners.
 */

import "shadow-claw/components/shadow-claw-status-bar";
import {
  ShadowClawElement,
  defineElement,
} from "shadow-claw/components/shadow-claw-element";
import { SHARED_STYLES } from "./shadow-claw-daw-styles.js";
import { scdaw } from "../shadow-claw-daw-engine.js";
import { effect } from "../shadow-claw-daw-signals.js";

export function formatTelemetryStatus(
  state = {},
  project = {},
  midiState = null,
) {
  const audio = state.audio || "suspended";
  const name = project.name || "Untitled";
  const bpm = project.bpm || 120;
  const tracksCount = Array.isArray(project.tracks) ? project.tracks.length : 0;
  const bounceInfo = state.lastBounce
    ? `Bounce: ${state.lastBounce.durationSec.toFixed(1)}s (${state.lastBounce.peakDb.toFixed(1)} dB)`
    : "No Bounces";
  const mStatus = midiState?.midiStatus || midiState?.status || "idle";
  const mCount =
    midiState?.midiInputCount ??
    (Array.isArray(midiState?.inputs) ? midiState.inputs.length : 0);
  const midiSummary =
    mStatus === "ready"
      ? `MIDI: ${mCount} in`
      : mStatus === "unsupported" || mStatus === "denied"
        ? "MIDI: Keys"
        : "MIDI: --";
  const errorText = state.lastError
    ? typeof state.lastError === "string"
      ? state.lastError
      : `${state.lastError.title || "Error"}: ${state.lastError.message || "Unexpected error"}`
    : "";
  return {
    audioText: `Audio: ${audio}`,
    audioStatus: audio,
    projectSummary: `${name} · ${bpm} BPM · ${tracksCount} Tracks`,
    bounceSummary: bounceInfo,
    midiSummary,
    errorText,
  };
}

export class ShadowClawDawStatusBar extends ShadowClawElement {
  constructor() {
    super();
    this._dispose = null;
  }

  connectedCallback() {
    this.disposeCleanups();
    this.render();
    this._dispose = effect(() => {
      scdaw.state.get();
      scdaw.project.get();
      scdaw.midi?.state?.get?.();
      this._sync();
    });
    this.addCleanup(() => {
      if (this._dispose) {
        this._dispose();
        this._dispose = null;
      }
    });
  }

  disconnectedCallback() {
    if (this._dispose) {
      this._dispose();
      this._dispose = null;
    }
    super.disconnectedCallback();
  }

  _sync() {
    if (!this.shadowRoot) return;
    const s = scdaw.getState();
    const p = scdaw.project.get();
    const m = scdaw.midi?.state?.get?.();
    const formatted = formatTelemetryStatus(s, p, m);

    const sb = this.shadowRoot.getElementById("scdaw-sb");
    const audioIndicator = this.shadowRoot.getElementById("audio-stat");
    const projIndicator = this.shadowRoot.getElementById("proj-stat");
    const bounceIndicator = this.shadowRoot.getElementById("bounce-stat");
    const midiIndicator = this.shadowRoot.getElementById("midi-stat");
    const errorIndicator = this.shadowRoot.getElementById("error-stat");

    if (sb) {
      const errMsg = formatted.errorText ? `⚠ ${formatted.errorText}` : "";
      if (typeof sb.setAttribute === "function") {
        sb.setAttribute("message", errMsg);
      } else {
        sb.message = errMsg;
      }
    }

    if (audioIndicator) {
      audioIndicator.textContent = `Audio: ${s.audio}`;
      audioIndicator.style.color =
        s.audio === "running" ? "var(--success)" : "var(--warning)";
    }
    if (projIndicator) {
      projIndicator.textContent = `${p.name} · ${p.bpm} BPM · ${p.tracks.length} Tracks`;
    }
    if (bounceIndicator && s.lastBounce) {
      bounceIndicator.textContent = `Last Bounce: ${s.lastBounce.durationSec.toFixed(1)}s (${s.lastBounce.peakDb.toFixed(1)} dB peak)`;
    }
    if (midiIndicator) {
      midiIndicator.textContent = formatted.midiSummary;
    }
    if (errorIndicator) {
      if (formatted.errorText) {
        errorIndicator.textContent = `⚠ ${formatted.errorText} (Dismiss)`;
        errorIndicator.hidden = false;
        errorIndicator.classList?.remove("hidden");
      } else {
        errorIndicator.textContent = "";
        errorIndicator.hidden = true;
        errorIndicator.classList?.add("hidden");
      }
    }
  }

  render() {
    if (!this.shadowRoot) return;
    const s = scdaw.getState();
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
          container-name: shadow-claw-daw-status-bar;
        }

        /* Mobile First Base Styles (Stacked rows) */
        .scdaw-statusbar,
        .statusbar {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
          padding: 0.4rem 0.6rem;
          background: #080d0e;
          border: 1px solid var(--border);
          border-radius: 6px;
          font-size: 0.72rem;
          font-family: var(--mono);
          color: var(--shadow-claw-text-secondary, #94a3b8);
          user-select: none;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          overflow-x: hidden;
        }

        .scdaw-statusbar__group,
        .stat-item {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          flex-wrap: wrap;
          width: 100%;
          box-sizing: border-box;
        }

        .scdaw-statusbar__stat {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .scdaw-statusbar__sep {
          opacity: 0.5;
        }

        .scdaw-statusbar__error {
          font: inherit;
          color: #fecaca;
          background: rgba(185, 28, 28, 0.35);
          border: 1px solid rgba(248, 113, 113, 0.6);
          border-radius: 4px;
          padding: 0.15rem 0.45rem;
          cursor: pointer;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .scdaw-statusbar__error.hidden,
        .scdaw-statusbar__error[hidden] {
          display: none !important;
        }

        /* Progressive Enhancement: Tablet and Desktop (>= 640px) */
        @container shadow-claw-daw-status-bar (min-width: 640px) {
          .scdaw-statusbar,
          .statusbar {
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
            padding: 0.35rem 0.75rem;
          }
          .scdaw-statusbar__group,
          .stat-item {
            width: auto;
            flex-wrap: nowrap;
          }
        }

        @supports not (container-type: inline-size) {
          @media (min-width: 640px) {
            .scdaw-statusbar,
            .statusbar {
              flex-direction: row;
              justify-content: space-between;
              align-items: center;
              padding: 0.35rem 0.75rem;
            }
            .scdaw-statusbar__group,
            .stat-item {
              width: auto;
              flex-wrap: nowrap;
            }
          }
        }
      </style>
      <shadow-claw-status-bar id="scdaw-sb" label="Audio telemetry and project status" role="status">
        <div slot="metrics" class="scdaw-statusbar statusbar" aria-live="polite">
          <div class="scdaw-statusbar__group stat-item">
            <span id="audio-stat" class="scdaw-statusbar__stat scdaw-statusbar__stat--audio" style="color:var(--warning); font-weight:700;">Audio: ${s.audio}</span>
            <span class="scdaw-statusbar__sep" aria-hidden="true">|</span>
            <span id="proj-stat" class="scdaw-statusbar__stat scdaw-statusbar__stat--project">${p.name} · ${p.bpm} BPM</span>
          </div>
          <div class="scdaw-statusbar__group stat-item">
            <button id="error-stat" type="button" class="scdaw-statusbar__error hidden" hidden aria-label="Dismiss active error"></button>
            <span id="bounce-stat" class="scdaw-statusbar__stat scdaw-statusbar__stat--bounce">${s.lastBounce ? `Last Bounce: ${s.lastBounce.durationSec.toFixed(1)}s` : "No Bounces"}</span>
            <span class="scdaw-statusbar__sep" aria-hidden="true">|</span>
            <span id="midi-stat" class="scdaw-statusbar__stat scdaw-statusbar__stat--midi">MIDI: --</span>
            <span class="scdaw-statusbar__sep" aria-hidden="true">|</span>
            <span class="scdaw-statusbar__stat scdaw-statusbar__stat--lock" style="color:var(--accent);">Leader Lock OK</span>
          </div>
        </div>
      </shadow-claw-status-bar>
    `;
    this.shadowRoot
      .getElementById("error-stat")
      ?.addEventListener("click", () => {
        scdaw.clearError?.();
      });
  }
}

defineElement("shadow-claw-daw-status-bar", ShadowClawDawStatusBar);
