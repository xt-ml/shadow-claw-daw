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
  const rawInst =
    track.instrument || (track.kind === "drums" ? "drums" : "synth");
  const instKind = String(rawInst).toLowerCase();
  const instNames = {
    808: "808 Sub Bass",
    cubed: "Cubed (TB-303 Acid)",
    pluck: "Pluck (Karplus-Strong)",
    tubular: "Tubular (DX7 6-Op FM)",
    neon: "Neon (CZ-101 PD)",
    "noise-pad": "Noise Pad (Atmospheric)",
    korpus: "Korpus (Modal Resonator)",
    nano: "Nano (Micro-Sampler)",
    soundfont: "SoundFont (GM Synth)",
    drums: "Playfield (12-Drum Kit)",
    synth: "Vaporisateur (Synth)",
    vaporisateur: "Vaporisateur (Synth)",
  };
  const instName =
    instNames[instKind] || `${instKind.toUpperCase()} (Instrument)`;

  chain.push({
    role: "instrument",
    type: instKind,
    name: instName,
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

export function renderDeviceControls(dev) {
  const p = dev.params || {};
  switch (dev.type) {
    case "808":
      return `
        <scdaw-knob label="Decay" min="0.1" max="4.0" unit="s" value="${p.decay ?? 1.2}" default="1.2" data-param="decay"></scdaw-knob>
        <scdaw-knob label="Glide" min="0" max="480" unit="t" value="${p.glide ?? 120}" default="120" data-param="glide"></scdaw-knob>
        <scdaw-knob label="Drive" min="0" max="1.0" unit="" value="${p.drive ?? 0.3}" default="0.3" data-param="drive"></scdaw-knob>
        <scdaw-knob label="Tone" min="0.1" max="1.0" unit="" value="${p.tone ?? 0.8}" default="0.8" data-param="tone"></scdaw-knob>
      `;
    case "cubed":
      return `
        <scdaw-knob label="Cutoff" min="50" max="6000" scaling="exponential" unit="Hz" value="${p.cutoff ?? 600}" default="600" data-param="cutoff"></scdaw-knob>
        <scdaw-knob label="Res" min="0.1" max="25" unit="Q" value="${p.resonance ?? 8.0}" default="8.0" data-param="resonance"></scdaw-knob>
        <scdaw-knob label="EnvMod" min="0" max="6000" unit="Hz" value="${p.envMod ?? 2000}" default="2000" data-param="envMod"></scdaw-knob>
        <scdaw-knob label="Decay" min="0.05" max="2.0" unit="s" value="${p.decay ?? 0.3}" default="0.3" data-param="decay"></scdaw-knob>
        <scdaw-knob label="Accent" min="0" max="1.0" unit="" value="${p.accent ?? 0.5}" default="0.5" data-param="accent"></scdaw-knob>
      `;
    case "pluck":
      return `
        <scdaw-knob label="Tone" min="0.1" max="1.0" unit="" value="${p.tone ?? 0.7}" default="0.7" data-param="tone"></scdaw-knob>
        <scdaw-knob label="Decay" min="0.1" max="5.0" unit="s" value="${p.decay ?? 1.5}" default="1.5" data-param="decay"></scdaw-knob>
        <scdaw-knob label="Drive" min="0" max="1.0" unit="" value="${p.drive ?? 0.2}" default="0.2" data-param="drive"></scdaw-knob>
        <scdaw-knob label="Width" min="0" max="2.0" unit="" value="${p.width ?? 1.0}" default="1.0" data-param="width"></scdaw-knob>
      `;
    case "tubular":
      return `
        <scdaw-knob label="Algo" min="1" max="32" step="1" unit="#" value="${p.algorithm ?? 1}" default="1" data-param="algorithm"></scdaw-knob>
        <scdaw-knob label="Feedback" min="0" max="7" step="1" unit="" value="${p.feedback ?? 0}" default="0" data-param="feedback"></scdaw-knob>
        <scdaw-knob label="Brightness" min="0.1" max="2.0" unit="" value="${p.brightness ?? 1.0}" default="1.0" data-param="brightness"></scdaw-knob>
        <scdaw-knob label="Decay" min="0.1" max="4.0" unit="s" value="${p.decay ?? 1.5}" default="1.5" data-param="decay"></scdaw-knob>
      `;
    case "neon":
      return `
        <scdaw-knob label="DCW" min="0" max="1.0" unit="" value="${p.dcw ?? 0.5}" default="0.5" data-param="dcw"></scdaw-knob>
        <scdaw-knob label="DCA" min="0" max="1.0" unit="" value="${p.dca ?? 0.8}" default="0.8" data-param="dca"></scdaw-knob>
        <scdaw-knob label="Detune" min="-24" max="24" unit="st" value="${p.detune ?? 0}" default="0" data-param="detune"></scdaw-knob>
        <scdaw-knob label="Glide" min="0" max="480" unit="t" value="${p.glide ?? 0}" default="0" data-param="glide"></scdaw-knob>
      `;
    case "noise-pad":
      return `
        <scdaw-knob label="Attack" min="0.05" max="3.0" unit="s" value="${p.attack ?? 0.6}" default="0.6" data-param="attack"></scdaw-knob>
        <scdaw-knob label="Decay" min="0.1" max="4.0" unit="s" value="${p.decay ?? 1.8}" default="1.8" data-param="decay"></scdaw-knob>
        <scdaw-knob label="Sustain" min="0" max="1.0" unit="" value="${p.sustain ?? 0.7}" default="0.7" data-param="sustain"></scdaw-knob>
        <scdaw-knob label="Release" min="0.1" max="5.0" unit="s" value="${p.release ?? 2.0}" default="2.0" data-param="release"></scdaw-knob>
        <scdaw-knob label="Texture" min="0" max="1.0" unit="" value="${p.texture ?? 0.3}" default="0.3" data-param="texture"></scdaw-knob>
      `;
    case "korpus":
      return `
        <scdaw-knob label="Intensity" min="0.1" max="2.0" unit="" value="${p.intensity ?? 1.0}" default="1.0" data-param="intensity"></scdaw-knob>
        <scdaw-knob label="Coupling" min="0" max="1.0" unit="" value="${p.coupling ?? 0.5}" default="0.5" data-param="coupling"></scdaw-knob>
        <scdaw-knob label="Damping" min="0" max="1.0" unit="" value="${p.damping ?? 0.3}" default="0.3" data-param="damping"></scdaw-knob>
        <scdaw-knob label="Air" min="0" max="1.0" unit="" value="${p.air ?? 0.2}" default="0.2" data-param="air"></scdaw-knob>
      `;
    case "nano":
      return `
        <scdaw-knob label="RootKey" min="0" max="127" step="1" unit="st" value="${p.rootKey ?? 60}" default="60" data-param="rootKey"></scdaw-knob>
        <scdaw-knob label="Attack" min="0.001" max="2.0" unit="s" value="${p.attack ?? 0.01}" default="0.01" data-param="attack"></scdaw-knob>
        <scdaw-knob label="Release" min="0.01" max="3.0" unit="s" value="${p.release ?? 0.2}" default="0.2" data-param="release"></scdaw-knob>
      `;
    case "soundfont":
      return `
        <scdaw-knob label="Program" min="0" max="127" step="1" unit="#" value="${p.programNumber ?? 0}" default="0" data-param="programNumber"></scdaw-knob>
        <scdaw-knob label="Bank" min="0" max="127" step="1" unit="#" value="${p.bank ?? 0}" default="0" data-param="bank"></scdaw-knob>
      `;
    case "synth":
    case "vaporisateur":
      return `
        <scdaw-knob label="Cutoff" min="20" max="20000" scaling="exponential" unit="Hz" value="${p.cutoff || 1200}" default="1200" data-param="cutoff"></scdaw-knob>
        <scdaw-knob label="Res" min="0.1" max="24" unit="Q" value="${p.resonance || 2.0}" default="2.0" data-param="resonance"></scdaw-knob>
        <scdaw-knob label="EnvAmt" min="0" max="8000" unit="Hz" value="${p.filterEnvAmount || 0}" default="1000" data-param="filterEnvAmount"></scdaw-knob>
        <scdaw-knob label="Attack" min="0.005" max="1.5" unit="s" value="${p.attack || 0.01}" default="0.01" data-param="attack"></scdaw-knob>
        <scdaw-knob label="Decay" min="0.01" max="2.0" unit="s" value="${p.decay || 0.15}" default="0.15" data-param="decay"></scdaw-knob>
      `;
    case "drums":
      return `
        <div style="font-size:0.75rem; color:var(--shadow-claw-text-secondary, #94a3b8); padding:0.5rem 0;">
          Procedural 12-Drum Physical Synthesizer active.
        </div>
      `;
    case "autotune":
      return `
        <scdaw-knob label="Retune" min="0" max="1.0" unit="" value="${p.retune ?? 0.8}" default="0.8" data-param="retune"></scdaw-knob>
        <scdaw-knob label="Amount" min="0" max="1.0" unit="" value="${p.amount ?? 1.0}" default="1.0" data-param="amount"></scdaw-knob>
        <scdaw-knob label="Shift" min="-12" max="12" step="1" unit="st" value="${p.shift ?? 0}" default="0" data-param="shift"></scdaw-knob>
      `;
    case "vocoder":
      return `
        <scdaw-knob label="Bands" min="8" max="16" step="4" unit="#" value="${p.bands ?? 16}" default="16" data-param="bands"></scdaw-knob>
        <scdaw-knob label="Release" min="0.01" max="0.2" unit="s" value="${p.release ?? 0.04}" default="0.04" data-param="release"></scdaw-knob>
        <scdaw-knob label="Carrier" min="0" max="2.0" unit="" value="${p.carrierGain ?? 1.0}" default="1.0" data-param="carrierGain"></scdaw-knob>
      `;
    case "maximizer":
      return `
        <scdaw-knob label="Thresh" min="-24" max="0" unit="dB" value="${p.threshold ?? -6.0}" default="-6.0" data-param="threshold"></scdaw-knob>
        <scdaw-knob label="Ceiling" min="-6" max="0" unit="dB" value="${p.ceiling ?? -0.1}" default="-0.1" data-param="ceiling"></scdaw-knob>
        <scdaw-knob label="Release" min="0.02" max="1.0" unit="s" value="${p.release ?? 0.15}" default="0.15" data-param="release"></scdaw-knob>
      `;
    case "tidal":
      return `
        <scdaw-knob label="Rate" min="0.1" max="16.0" unit="Hz" value="${p.rate ?? 4}" default="4" data-param="rate"></scdaw-knob>
        <scdaw-knob label="Depth" min="0" max="1.0" unit="" value="${p.depth ?? 0.8}" default="0.8" data-param="depth"></scdaw-knob>
        <scdaw-knob label="Offset" min="-180" max="180" unit="°" value="${p.channelOffset ?? 90}" default="90" data-param="channelOffset"></scdaw-knob>
      `;
    case "transient":
      return `
        <scdaw-knob label="Attack" min="-1.0" max="1.0" unit="" value="${p.attack ?? 0.0}" default="0.0" data-param="attack"></scdaw-knob>
        <scdaw-knob label="Sustain" min="-1.0" max="1.0" unit="" value="${p.sustain ?? 0.0}" default="0.0" data-param="sustain"></scdaw-knob>
      `;
    case "sidechain":
      return `
        <scdaw-knob label="Thresh" min="-40" max="0" unit="dB" value="${p.thresholdDb ?? -18}" default="-18" data-param="thresholdDb"></scdaw-knob>
        <scdaw-knob label="Depth" min="0" max="36" unit="dB" value="${p.depthDb ?? 18}" default="18" data-param="depthDb"></scdaw-knob>
      `;
    case "fold":
      return `
        <scdaw-knob label="Drive" min="0" max="24" unit="dB" value="${p.driveDb ?? 6}" default="6" data-param="driveDb"></scdaw-knob>
        <scdaw-knob label="Mix" min="0" max="1.0" unit="" value="${p.mix ?? 1.0}" default="1.0" data-param="mix"></scdaw-knob>
      `;
    case "crusher":
      return `
        <scdaw-knob label="Bits" min="4" max="16" step="1" unit="b" value="${p.bits ?? 8}" default="8" data-param="bits"></scdaw-knob>
        <scdaw-knob label="Down" min="1" max="16" step="1" unit="x" value="${p.downsample ?? 1}" default="1" data-param="downsample"></scdaw-knob>
      `;
    case "delay":
      return `
        <scdaw-knob label="TimeL" min="1" max="16" step="1" unit="st" value="${p.timeStepsL ?? 3}" default="3" data-param="timeStepsL"></scdaw-knob>
        <scdaw-knob label="TimeR" min="1" max="16" step="1" unit="st" value="${p.timeStepsR ?? 4}" default="4" data-param="timeStepsR"></scdaw-knob>
        <scdaw-knob label="FdBk" min="0" max="0.9" unit="" value="${p.feedback ?? 0.35}" default="0.35" data-param="feedback"></scdaw-knob>
        <scdaw-knob label="Wet" min="0" max="1.0" unit="" value="${p.wet ?? 0.3}" default="0.3" data-param="wet"></scdaw-knob>
      `;
    case "reverb":
      return `
        <scdaw-knob label="Decay" min="0.1" max="5.0" unit="s" value="${p.decay ?? 1.5}" default="1.5" data-param="decay"></scdaw-knob>
        <scdaw-knob label="Damp" min="0" max="1.0" unit="" value="${p.damping ?? 0.5}" default="0.5" data-param="damping"></scdaw-knob>
        <scdaw-knob label="Wet" min="0" max="1.0" unit="" value="${p.wet ?? 0.25}" default="0.25" data-param="wet"></scdaw-knob>
      `;
    case "stereo":
    case "stereoTool":
      return `
        <scdaw-knob label="Width" min="0" max="2.0" unit="" value="${p.width ?? 1.0}" default="1.0" data-param="width"></scdaw-knob>
        <scdaw-knob label="Pan" min="-1.0" max="1.0" unit="" value="${p.pan ?? 0.0}" default="0.0" data-param="pan"></scdaw-knob>
      `;
    case "zeitgeist":
      return `
        <scdaw-knob label="Amount" min="0" max="1.0" unit="" value="${p.amount ?? 0.5}" default="0.5" data-param="amount"></scdaw-knob>
      `;
    case "notefilter":
      return `
        <scdaw-knob label="MinPitch" min="0" max="127" step="1" unit="st" value="${p.minPitch ?? 0}" default="0" data-param="minPitch"></scdaw-knob>
        <scdaw-knob label="MaxPitch" min="0" max="127" step="1" unit="st" value="${p.maxPitch ?? 127}" default="127" data-param="maxPitch"></scdaw-knob>
      `;
    case "chord":
      return `
        <scdaw-knob label="Strum" min="0" max="120" step="5" unit="t" value="${p.strumTicks ?? 0}" default="0" data-param="strumTicks"></scdaw-knob>
      `;
    case "humanize":
      return `
        <scdaw-knob label="Timing" min="0" max="120" unit="t" value="${p.timingTicks ?? 15}" default="15" data-param="timingTicks"></scdaw-knob>
        <scdaw-knob label="Velocity" min="0" max="64" unit="" value="${p.velocity ?? 10}" default="10" data-param="velocity"></scdaw-knob>
      `;
    case "arpeggio":
      return `
        <scdaw-knob label="Steps" min="1" max="4" step="1" unit="st" value="${p.rateSteps ?? 1}" default="1" data-param="rateSteps"></scdaw-knob>
        <scdaw-knob label="Gate" min="0.1" max="1.0" unit="" value="${p.gate ?? 0.8}" default="0.8" data-param="gate"></scdaw-knob>
      `;
    case "pitch":
      return `
        <scdaw-knob label="Shift" min="-24" max="24" step="1" unit="st" value="${p.semitones ?? 0}" default="0" data-param="semitones"></scdaw-knob>
      `;
    case "velocity":
      return `
        <scdaw-knob label="Drive" min="-1.0" max="1.0" unit="" value="${p.drive ?? 0}" default="0" data-param="drive"></scdaw-knob>
      `;
    default:
      return `<div style="font-size:0.75rem; color:var(--text-secondary); padding:0.4rem;">${dev.name} active</div>`;
  }
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
      const sharedTrackId = scdaw.selectedTrackId?.get();
      if (sharedTrackId) {
        this._selectedTrackId = sharedTrackId;
      }
      this.render();
    });
  }

  disconnectedCallback() {
    if (this._dispose) this._dispose();
  }

  render() {
    if (!this.shadowRoot) return;
    const p = scdaw.getProject();
    const sharedTrackId = scdaw.selectedTrackId?.get();
    if (sharedTrackId && p.tracks.some((t) => t.id === sharedTrackId)) {
      this._selectedTrackId = sharedTrackId;
    } else if (
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
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          container-type: inline-size;
          container-name: scdaw-devices;
        }
        .scdaw-devices__rack,
        .rack-container {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem;
          padding: 0.75rem;
          overflow-x: auto;
          background: rgba(0, 0, 0, 0.2);
          min-height: 120px;
          box-sizing: border-box;
        }
        .scdaw-devices__card,
        .device-card {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 0.6rem;
          min-width: min(240px, 100%);
          flex: 1 1 240px;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          box-sizing: border-box;
        }
        .scdaw-devices__card-header,
        .device-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid var(--border-subtle);
          padding-bottom: 4px;
          gap: 0.4rem;
        }
        .scdaw-devices__controls,
        .controls-row {
          display: flex;
          align-items: center;
          justify-content: space-around;
          gap: 0.5rem;
          flex-wrap: wrap;
        }
      </style>
      <div class="scdaw-devices daw-panel" role="region" aria-label="Track Device Rack">
        <div class="scdaw-devices__header daw-panel-header">
          <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
            <span>🎛️ Device Rack: <strong>${track?.name || "None"}</strong></span>
            <span class="badge">${chain.length} Devices</span>
          </div>
          <div style="display:flex; gap:4px; flex-shrink:0;">
            <button id="reset-device-btn" class="btn btn-icon" title="Reset instrument parameters to factory defaults">🔄 Reset Device</button>
          </div>
        </div>
        <div class="scdaw-devices__rack rack-container">
          ${chain
            .map(
              (dev) => `
            <div class="scdaw-devices__card device-card" data-role="${dev.role}" data-type="${dev.type}" data-id="${dev.params?.id || ""}">
              <div class="scdaw-devices__card-header device-card-header">
                <span style="font-weight:700; font-size:0.78rem; color:var(--accent);">${dev.name}</span>
                <span class="badge" style="font-size:0.65rem;">${dev.role}</span>
              </div>
              <div class="scdaw-devices__controls controls-row">
                ${renderDeviceControls(dev)}
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
        const card = knob.closest(".scdaw-devices__card");
        const role = card?.dataset.role;
        const devType = card?.dataset.type;
        const devId = card?.dataset.id;
        const param = knob.dataset.param;
        const val = e.detail.value;

        if (role === "instrument") {
          scdaw.sendCommand("set_track", {
            trackId: this._selectedTrackId,
            params: { [param]: val },
          });
        } else if (role === "audio-fx" || role === "midi-fx") {
          scdaw.sendCommand("manage_fx", {
            action: "update",
            trackId: this._selectedTrackId,
            fxType: devType,
            fxId: devId || undefined,
            params: { [param]: val },
          });
        }
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
