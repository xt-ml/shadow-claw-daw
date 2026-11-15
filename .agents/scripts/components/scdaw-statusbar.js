/**
 * .agents/scripts/components/scdaw-statusbar.js
 *
 * Bottom Telemetry & Status Bar Web Component (<scdaw-statusbar>).
 * Ported concepts from openDAW Footer & PerformanceStats.
 * Redesigned Mobile-First, Responsive, BEM, and ARIA compliant.
 */

import { SHARED_STYLES } from "./scdaw-styles.js";
import { scdaw } from "../scdaw-engine.js";
import { effect } from "../scdaw-signals.js";

const BaseElement = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

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
  return {
    audioText: `Audio: ${audio}`,
    audioStatus: audio,
    projectSummary: `${name} · ${bpm} BPM · ${tracksCount} Tracks`,
    bounceSummary: bounceInfo,
    midiSummary,
  };
}

export class DawStatusBarElement extends BaseElement {
  constructor() {
    super();
    if (this.attachShadow) {
      this.attachShadow({ mode: "open" });
    }
    this._rafId = null;
  }

  connectedCallback() {
    this.render();
    this._dispose = effect(() => {
      scdaw.state.get();
      scdaw.project.get();
      scdaw.midi?.state?.get?.();
      this._sync();
    });
  }

  disconnectedCallback() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._dispose) this._dispose();
  }

  _sync() {
    if (!this.shadowRoot) return;
    const s = scdaw.getState();
    const p = scdaw.project.get();
    const m = scdaw.midi?.state?.get?.();
    const formatted = formatTelemetryStatus(s, p, m);

    const audioIndicator = this.shadowRoot.getElementById("audio-stat");
    const projIndicator = this.shadowRoot.getElementById("proj-stat");
    const bounceIndicator = this.shadowRoot.getElementById("bounce-stat");
    const midiIndicator = this.shadowRoot.getElementById("midi-stat");

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
          container-name: scdaw-statusbar;
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

        /* Progressive Enhancement: Tablet and Desktop (>= 640px) */
        @container scdaw-statusbar (min-width: 640px) {
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
      <div class="scdaw-statusbar statusbar" role="status" aria-label="Audio telemetry and project status" aria-live="polite">
        <div class="scdaw-statusbar__group stat-item">
          <span id="audio-stat" class="scdaw-statusbar__stat scdaw-statusbar__stat--audio" style="color:var(--warning); font-weight:700;">Audio: ${s.audio}</span>
          <span class="scdaw-statusbar__sep" aria-hidden="true">|</span>
          <span id="proj-stat" class="scdaw-statusbar__stat scdaw-statusbar__stat--project">${p.name} · ${p.bpm} BPM</span>
        </div>
        <div class="scdaw-statusbar__group stat-item">
          <span id="bounce-stat" class="scdaw-statusbar__stat scdaw-statusbar__stat--bounce">${s.lastBounce ? `Last Bounce: ${s.lastBounce.durationSec.toFixed(1)}s` : "No Bounces"}</span>
          <span class="scdaw-statusbar__sep" aria-hidden="true">|</span>
          <span id="midi-stat" class="scdaw-statusbar__stat scdaw-statusbar__stat--midi">MIDI: --</span>
          <span class="scdaw-statusbar__sep" aria-hidden="true">|</span>
          <span class="scdaw-statusbar__stat scdaw-statusbar__stat--lock" style="color:var(--accent);">Leader Lock OK</span>
        </div>
      </div>
    `;
  }
}

if (
  typeof customElements !== "undefined" &&
  !customElements.get("scdaw-statusbar")
) {
  customElements.define("scdaw-statusbar", DawStatusBarElement);
}
