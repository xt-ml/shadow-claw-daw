/**
 * .agents/scripts/components/scdaw-devices.js
 *
 * Selected Track Device Rack Web Component (<scdaw-devices>).
 * Ported concepts from openDAW DeviceEditor & OpenStudio FXChainPanel.
 */

import { SHARED_STYLES } from "./scdaw-styles.js";
import { scdaw } from "../scdaw-engine.js";
import { effect } from "../scdaw-signals.js";
import "./scdaw-knob.js";

const BaseElement = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

export function getDeviceChainForTrack(track) {
  if (!track) return [];
  const chain = [];

  // 1. MIDI FX
  if (Array.isArray(track.midiFx)) {
    for (const mfx of track.midiFx) {
      chain.push({
        role: "midi-fx",
        type: mfx.type,
        name: mfx.type.toUpperCase(),
        params: mfx,
      });
    }
  }

  // 2. Instrument
  chain.push({
    role: "instrument",
    type: track.kind === "drums" ? "drums" : "synth",
    name: track.kind === "drums" ? "Playfield (Drums)" : "Vaporisateur (Synth)",
    params: track.params || {},
  });

  // 3. Audio FX
  if (Array.isArray(track.fx)) {
    for (const fx of track.fx) {
      chain.push({
        role: "audio-fx",
        type: fx.type,
        name: fx.type.toUpperCase(),
        params: fx,
      });
    }
  }

  return chain;
}

export class DawDevicesElement extends BaseElement {
  constructor() {
    super();
    if (this.attachShadow) {
      this.attachShadow({ mode: "open" });
    }
    this._selectedTrackId = null;
  }

  connectedCallback() {
    this.render();
    this._dispose = effect(() => {
      scdaw.project.get();
      this.render();
    });
  }

  disconnectedCallback() {
    if (this._dispose) this._dispose();
  }

  render() {
    if (!this.shadowRoot) return;
    const p = scdaw.getProject();
    if (
      !this._selectedTrackId ||
      !p.tracks.some((t) => t.id === this._selectedTrackId)
    ) {
      this._selectedTrackId = p.tracks[0]?.id;
    }

    const track = p.tracks.find((t) => t.id === this._selectedTrackId);
    const chain = getDeviceChainForTrack(track);

    this.shadowRoot.innerHTML = `
      <style>
        ${SHARED_STYLES}
        :host {
          display: block;
        }
        .rack-container {
          display: flex;
          gap: 0.75rem;
          padding: 0.75rem;
          overflow-x: auto;
          background: rgba(0, 0, 0, 0.2);
          min-height: 140px;
        }
        .device-card {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 0.6rem;
          min-width: 280px;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .device-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid var(--border-subtle);
          padding-bottom: 4px;
        }
        .controls-row {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          flex-wrap: wrap;
        }
      </style>
      <div class="daw-panel">
        <div class="daw-panel-header">
          <div style="display:flex; align-items:center; gap:0.6rem;">
            <span>🎛️ Device Rack: <strong>${track?.name || "None"}</strong></span>
            <span class="badge">${chain.length} Devices</span>
          </div>
          <div style="display:flex; gap:4px;">
            <button id="reset-device-btn" class="btn btn-icon" title="Reset instrument parameters to factory defaults">🔄 Reset Device</button>
          </div>
        </div>
        <div class="rack-container">
          ${chain
            .map(
              (dev) => `
            <div class="device-card" data-role="${dev.role}">
              <div class="device-card-header">
                <span style="font-weight:700; font-size:0.78rem; color:var(--accent);">${dev.name}</span>
                <span class="badge" style="font-size:0.65rem;">${dev.role}</span>
              </div>
              <div class="controls-row">
                ${
                  dev.type === "synth"
                    ? `
                  <scdaw-knob label="Cutoff" min="20" max="20000" scaling="exponential" unit="Hz" value="${dev.params.cutoff || 1200}" default="1200" data-param="cutoff"></scdaw-knob>
                  <scdaw-knob label="Res" min="0.1" max="24" unit="Q" value="${dev.params.resonance || 2.0}" default="2.0" data-param="resonance"></scdaw-knob>
                  <scdaw-knob label="EnvAmt" min="0" max="8000" unit="Hz" value="${dev.params.filterEnvAmount || 0}" default="1000" data-param="filterEnvAmount"></scdaw-knob>
                  <scdaw-knob label="Attack" min="0.005" max="1.5" unit="s" value="${dev.params.attack || 0.01}" default="0.01" data-param="attack"></scdaw-knob>
                  <scdaw-knob label="Decay" min="0.01" max="2.0" unit="s" value="${dev.params.decay || 0.15}" default="0.15" data-param="decay"></scdaw-knob>
                `
                    : `
                  <div style="font-size:0.75rem; color:var(--shadow-claw-text-secondary, #94a3b8); padding:0.5rem 0;">
                    Procedural 12-Drum Physical Synthesizer active.
                  </div>
                `
                }
              </div>
            </div>
          `,
            )
            .join("")}
        </div>
      </div>
    `;

    // Knob parameter adjustments
    this.shadowRoot.querySelectorAll("scdaw-knob").forEach((knob) => {
      knob.addEventListener("change", (e) => {
        if (!this._selectedTrackId) return;
        const param = knob.dataset.param;
        const val = e.detail.value;
        scdaw.sendCommand("set_track", {
          trackId: this._selectedTrackId,
          params: { [param]: val },
        });
      });

      knob.addEventListener("reset", (e) => {
        if (!this._selectedTrackId) return;
        const param = knob.dataset.param;
        scdaw.sendCommand("reset_param", {
          scope: "synth",
          trackId: this._selectedTrackId,
          param,
        });
      });
    });

    // Reset device button
    this.shadowRoot
      .getElementById("reset-device-btn")
      ?.addEventListener("click", () => {
        if (this._selectedTrackId) {
          scdaw.sendCommand("reset_track", {
            trackId: this._selectedTrackId,
            mode: "params",
          });
        }
      });
  }
}

if (
  typeof customElements !== "undefined" &&
  !customElements.get("scdaw-devices")
) {
  customElements.define("scdaw-devices", DawDevicesElement);
}
