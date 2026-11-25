/**
 * .agents/scripts/components/shadow-claw-daw-devices.js
 *
 * Selected Track Device Rack Web Component (<shadow-claw-daw-devices>).
 * Ported concepts from openDAW DeviceEditor & OpenStudio FXChainPanel.
 */

import { SHARED_STYLES } from "./shadow-claw-daw-styles.js";
import { scdaw } from "../shadow-claw-daw-engine.js";
import { effect } from "../shadow-claw-daw-signals.js";
import "./shadow-claw-daw-knob.js";

import {
  BaseElement,
  defineElement,
} from "shadow-claw/components/shadow-claw-element";

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
    track.instrument !== undefined
      ? track.instrument
      : track.kind === "drums"
        ? "drums"
        : "synth";
  const instKind = rawInst ? String(rawInst).toLowerCase() : "none";
  if (instKind !== "none") {
    const instNames = {
      808: "808 Sub Bass",
      cubed: "Cubed (TB-303 Acid)",
      pluck: "Pluck (Karplus-Strong)",
      tubular: "Tubular (DX7 6-Op FM)",
      neon: "Neon (CZ-101 PD)",
      "noise-pad": "Noise Pad (Atmospheric)",
      korpus: "Korpus (Modal Resonator)",
      nano: "Nano (Micro-Sampler)",
      psg: "PSG (Chiptune Synth)",
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
  }

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
        <shadow-claw-daw-knob label="Decay" min="0.1" max="4.0" unit="s" value="${p.decay ?? 1.2}" default="1.2" data-param="decay"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Glide" min="0" max="480" unit="t" value="${p.glide ?? 120}" default="120" data-param="glide"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Drive" min="0" max="1.0" unit="" value="${p.drive ?? 0.3}" default="0.3" data-param="drive"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Tone" min="0.1" max="1.0" unit="" value="${p.tone ?? 0.8}" default="0.8" data-param="tone"></shadow-claw-daw-knob>
      `;
    case "cubed":
      return `
        <shadow-claw-daw-knob label="Cutoff" min="50" max="6000" scaling="exponential" unit="Hz" value="${p.cutoff ?? 600}" default="600" data-param="cutoff"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Res" min="0.1" max="25" unit="Q" value="${p.resonance ?? 8.0}" default="8.0" data-param="resonance"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="EnvMod" min="0" max="6000" unit="Hz" value="${p.envMod ?? 2000}" default="2000" data-param="envMod"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Decay" min="0.05" max="2.0" unit="s" value="${p.decay ?? 0.3}" default="0.3" data-param="decay"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Accent" min="0" max="1.0" unit="" value="${p.accent ?? 0.5}" default="0.5" data-param="accent"></shadow-claw-daw-knob>
      `;
    case "pluck":
      return `
        <shadow-claw-daw-knob label="Tone" min="0.1" max="1.0" unit="" value="${p.tone ?? 0.7}" default="0.7" data-param="tone"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Decay" min="0.1" max="5.0" unit="s" value="${p.decay ?? 1.5}" default="1.5" data-param="decay"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Drive" min="0" max="1.0" unit="" value="${p.drive ?? 0.2}" default="0.2" data-param="drive"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Width" min="0" max="2.0" unit="" value="${p.width ?? 1.0}" default="1.0" data-param="width"></shadow-claw-daw-knob>
      `;
    case "tubular":
      return `
        <shadow-claw-daw-knob label="Algo" min="1" max="32" step="1" unit="#" value="${p.algorithm ?? 1}" default="1" data-param="algorithm"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Feedback" min="0" max="7" step="1" unit="" value="${p.feedback ?? 0}" default="0" data-param="feedback"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Brightness" min="0.1" max="2.0" unit="" value="${p.brightness ?? 1.0}" default="1.0" data-param="brightness"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Decay" min="0.1" max="4.0" unit="s" value="${p.decay ?? 1.5}" default="1.5" data-param="decay"></shadow-claw-daw-knob>
      `;
    case "neon":
      return `
        <shadow-claw-daw-knob label="DCW" min="0" max="1.0" unit="" value="${p.dcw ?? 0.5}" default="0.5" data-param="dcw"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="DCA" min="0" max="1.0" unit="" value="${p.dca ?? 0.8}" default="0.8" data-param="dca"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Detune" min="-24" max="24" unit="st" value="${p.detune ?? 0}" default="0" data-param="detune"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Glide" min="0" max="480" unit="t" value="${p.glide ?? 0}" default="0" data-param="glide"></shadow-claw-daw-knob>
      `;
    case "noise-pad":
      return `
        <shadow-claw-daw-knob label="Attack" min="0.05" max="3.0" unit="s" value="${p.attack ?? 0.6}" default="0.6" data-param="attack"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Decay" min="0.1" max="4.0" unit="s" value="${p.decay ?? 1.8}" default="1.8" data-param="decay"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Sustain" min="0" max="1.0" unit="" value="${p.sustain ?? 0.7}" default="0.7" data-param="sustain"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Release" min="0.1" max="5.0" unit="s" value="${p.release ?? 2.0}" default="2.0" data-param="release"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Texture" min="0" max="1.0" unit="" value="${p.texture ?? 0.3}" default="0.3" data-param="texture"></shadow-claw-daw-knob>
      `;
    case "korpus":
      return `
        <shadow-claw-daw-knob label="Intensity" min="0.1" max="2.0" unit="" value="${p.intensity ?? 1.0}" default="1.0" data-param="intensity"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Coupling" min="0" max="1.0" unit="" value="${p.coupling ?? 0.5}" default="0.5" data-param="coupling"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Damping" min="0" max="1.0" unit="" value="${p.damping ?? 0.3}" default="0.3" data-param="damping"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Air" min="0" max="1.0" unit="" value="${p.air ?? 0.2}" default="0.2" data-param="air"></shadow-claw-daw-knob>
      `;
    case "nano":
      return `
        <shadow-claw-daw-knob label="RootKey" min="0" max="127" step="1" unit="st" value="${p.rootKey ?? 60}" default="60" data-param="rootKey"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Attack" min="0.001" max="2.0" unit="s" value="${p.attack ?? 0.01}" default="0.01" data-param="attack"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Release" min="0.01" max="3.0" unit="s" value="${p.release ?? 0.2}" default="0.2" data-param="release"></shadow-claw-daw-knob>
      `;
    case "psg":
      return `
        <shadow-claw-daw-knob label="Duty" min="0.125" max="0.875" step="0.125" unit="" value="${p.duty ?? 0.5}" default="0.5" data-param="duty"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Noise" min="1" max="31" step="1" unit="" value="${p.noisePeriod ?? 16}" default="16" data-param="noisePeriod"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Tune" min="-24" max="24" step="1" unit="st" value="${p.tune ?? 0}" default="0" data-param="tune"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Arp" min="0" max="12" step="1" unit="st" value="${p.arpSteps ?? 0}" default="0" data-param="arpSteps"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Release" min="0.01" max="3.0" unit="s" value="${p.release ?? 0.2}" default="0.2" data-param="release"></shadow-claw-daw-knob>
      `;
    case "soundfont":
      return `
        <shadow-claw-daw-knob label="Program" min="0" max="127" step="1" unit="#" value="${p.programNumber ?? 0}" default="0" data-param="programNumber"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Bank" min="0" max="127" step="1" unit="#" value="${p.bank ?? 0}" default="0" data-param="bank"></shadow-claw-daw-knob>
      `;
    case "synth":
    case "vaporisateur":
      return `
        <shadow-claw-daw-knob label="Cutoff" min="20" max="20000" scaling="exponential" unit="Hz" value="${p.cutoff || 1200}" default="1200" data-param="cutoff"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Res" min="0.1" max="24" unit="Q" value="${p.resonance || 2.0}" default="2.0" data-param="resonance"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="EnvAmt" min="0" max="8000" unit="Hz" value="${p.filterEnvAmount || 0}" default="1000" data-param="filterEnvAmount"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Attack" min="0.005" max="1.5" unit="s" value="${p.attack || 0.01}" default="0.01" data-param="attack"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Decay" min="0.01" max="2.0" unit="s" value="${p.decay || 0.15}" default="0.15" data-param="decay"></shadow-claw-daw-knob>
      `;
    case "drums":
      return `
        <div style="font-size:0.75rem; color:var(--shadow-claw-text-secondary, #94a3b8); padding:0.5rem 0;">
          Procedural 12-Drum Physical Synthesizer active.
        </div>
      `;
    case "autotune":
      return `
        <shadow-claw-daw-knob label="Retune" min="0" max="1.0" unit="" value="${p.retune ?? 0.8}" default="0.8" data-param="retune"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Amount" min="0" max="1.0" unit="" value="${p.amount ?? 1.0}" default="1.0" data-param="amount"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Shift" min="-12" max="12" step="1" unit="st" value="${p.shift ?? 0}" default="0" data-param="shift"></shadow-claw-daw-knob>
      `;
    case "vocoder":
      return `
        <shadow-claw-daw-knob label="Bands" min="8" max="16" step="4" unit="#" value="${p.bands ?? 16}" default="16" data-param="bands"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Release" min="0.01" max="0.2" unit="s" value="${p.release ?? 0.04}" default="0.04" data-param="release"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Carrier" min="0" max="2.0" unit="" value="${p.carrierGain ?? 1.0}" default="1.0" data-param="carrierGain"></shadow-claw-daw-knob>
      `;
    case "maximizer":
      return `
        <shadow-claw-daw-knob label="Thresh" min="-24" max="0" unit="dB" value="${p.threshold ?? -6.0}" default="-6.0" data-param="threshold"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Ceiling" min="-6" max="0" unit="dB" value="${p.ceiling ?? -0.1}" default="-0.1" data-param="ceiling"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Release" min="0.02" max="1.0" unit="s" value="${p.release ?? 0.15}" default="0.15" data-param="release"></shadow-claw-daw-knob>
      `;
    case "tidal":
      return `
        <shadow-claw-daw-knob label="Rate" min="0.1" max="16.0" unit="Hz" value="${p.rate ?? 4}" default="4" data-param="rate"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Depth" min="0" max="1.0" unit="" value="${p.depth ?? 0.8}" default="0.8" data-param="depth"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Offset" min="-180" max="180" unit="°" value="${p.channelOffset ?? 90}" default="90" data-param="channelOffset"></shadow-claw-daw-knob>
      `;
    case "transient":
      return `
        <shadow-claw-daw-knob label="Attack" min="-1.0" max="1.0" unit="" value="${p.attack ?? 0.0}" default="0.0" data-param="attack"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Sustain" min="-1.0" max="1.0" unit="" value="${p.sustain ?? 0.0}" default="0.0" data-param="sustain"></shadow-claw-daw-knob>
      `;
    case "sidechain":
      return `
        <shadow-claw-daw-knob label="Thresh" min="-40" max="0" unit="dB" value="${p.thresholdDb ?? -18}" default="-18" data-param="thresholdDb"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Depth" min="0" max="36" unit="dB" value="${p.depthDb ?? 18}" default="18" data-param="depthDb"></shadow-claw-daw-knob>
      `;
    case "fold":
      return `
        <shadow-claw-daw-knob label="Drive" min="0" max="24" unit="dB" value="${p.driveDb ?? 6}" default="6" data-param="driveDb"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Mix" min="0" max="1.0" unit="" value="${p.mix ?? 1.0}" default="1.0" data-param="mix"></shadow-claw-daw-knob>
      `;
    case "crusher":
      return `
        <shadow-claw-daw-knob label="Bits" min="4" max="16" step="1" unit="b" value="${p.bits ?? 8}" default="8" data-param="bits"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Down" min="1" max="16" step="1" unit="x" value="${p.downsample ?? 1}" default="1" data-param="downsample"></shadow-claw-daw-knob>
      `;
    case "delay":
      return `
        <shadow-claw-daw-knob label="TimeL" min="1" max="16" step="1" unit="st" value="${p.timeStepsL ?? 3}" default="3" data-param="timeStepsL"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="TimeR" min="1" max="16" step="1" unit="st" value="${p.timeStepsR ?? 4}" default="4" data-param="timeStepsR"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="FdBk" min="0" max="0.9" unit="" value="${p.feedback ?? 0.35}" default="0.35" data-param="feedback"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Wet" min="0" max="1.0" unit="" value="${p.wet ?? 0.3}" default="0.3" data-param="wet"></shadow-claw-daw-knob>
      `;
    case "reverb":
      return `
        <shadow-claw-daw-knob label="Decay" min="0.1" max="5.0" unit="s" value="${p.decay ?? 1.5}" default="1.5" data-param="decay"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Damp" min="0" max="1.0" unit="" value="${p.damping ?? 0.5}" default="0.5" data-param="damping"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Wet" min="0" max="1.0" unit="" value="${p.wet ?? 0.25}" default="0.25" data-param="wet"></shadow-claw-daw-knob>
      `;
    case "stereo":
    case "stereoTool":
      return `
        <shadow-claw-daw-knob label="Width" min="0" max="2.0" unit="" value="${p.width ?? 1.0}" default="1.0" data-param="width"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Pan" min="-1.0" max="1.0" unit="" value="${p.pan ?? 0.0}" default="0.0" data-param="pan"></shadow-claw-daw-knob>
      `;
    case "zeitgeist":
      return `
        <shadow-claw-daw-knob label="Amount" min="0" max="1.0" unit="" value="${p.amount ?? 0.5}" default="0.5" data-param="amount"></shadow-claw-daw-knob>
      `;
    case "notefilter":
      return `
        <shadow-claw-daw-knob label="MinPitch" min="0" max="127" step="1" unit="st" value="${p.minPitch ?? 0}" default="0" data-param="minPitch"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="MaxPitch" min="0" max="127" step="1" unit="st" value="${p.maxPitch ?? 127}" default="127" data-param="maxPitch"></shadow-claw-daw-knob>
      `;
    case "chord":
      return `
        <shadow-claw-daw-knob label="Strum" min="0" max="120" step="5" unit="t" value="${p.strumTicks ?? 0}" default="0" data-param="strumTicks"></shadow-claw-daw-knob>
      `;
    case "humanize":
      return `
        <shadow-claw-daw-knob label="Timing" min="0" max="120" unit="t" value="${p.timingTicks ?? 15}" default="15" data-param="timingTicks"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Velocity" min="0" max="64" unit="" value="${p.velocity ?? 10}" default="10" data-param="velocity"></shadow-claw-daw-knob>
      `;
    case "arpeggio":
      return `
        <shadow-claw-daw-knob label="Steps" min="1" max="4" step="1" unit="st" value="${p.rateSteps ?? 1}" default="1" data-param="rateSteps"></shadow-claw-daw-knob>
        <shadow-claw-daw-knob label="Gate" min="0.1" max="1.0" unit="" value="${p.gate ?? 0.8}" default="0.8" data-param="gate"></shadow-claw-daw-knob>
      `;
    case "pitch":
      return `
        <shadow-claw-daw-knob label="Shift" min="-24" max="24" step="1" unit="st" value="${p.semitones ?? 0}" default="0" data-param="semitones"></shadow-claw-daw-knob>
      `;
    case "velocity":
      return `
        <shadow-claw-daw-knob label="Drive" min="-1.0" max="1.0" unit="" value="${p.drive ?? 0}" default="0" data-param="drive"></shadow-claw-daw-knob>
      `;
    default:
      return `<div style="font-size:0.75rem; color:var(--text-secondary); padding:0.4rem;">${dev.name} active</div>`;
  }
}

export function shouldPreserveDevicesDom({
  renderedTrackId = null,
  targetTrackId = null,
  renderedChain = [],
  targetChain = [],
  hasContainer = false,
} = {}) {
  if (!hasContainer) return false;
  if (!renderedTrackId || renderedTrackId !== targetTrackId) return false;
  if (!Array.isArray(renderedChain) || !Array.isArray(targetChain))
    return false;
  if (renderedChain.length !== targetChain.length) return false;
  for (let i = 0; i < renderedChain.length; i++) {
    const r = renderedChain[i];
    const t = targetChain[i];
    if (!r || !t) return false;
    if (r.role !== t.role || r.type !== t.type) return false;
    if ((r.params?.id || "") !== (t.params?.id || "")) return false;
  }
  return true;
}

export class ShadowClawDawDevices extends BaseElement {
  constructor() {
    super();
    if (this.attachShadow) {
      this.attachShadow({ mode: "open" });
    }
    this._selectedTrackId = null;
    this._renderedTrackId = null;
    this._renderedChain = [];
  }

  connectedCallback() {
    this.render();
    this._dispose = effect(() => {
      const p = scdaw.project.get();
      scdaw.liveRevision?.get?.();
      const sharedTrackId = scdaw.selectedTrackId?.get();
      const activeTrackId =
        sharedTrackId && p.tracks.some((t) => t.id === sharedTrackId)
          ? sharedTrackId
          : p.tracks[0]?.id || null;
      this._selectedTrackId = activeTrackId;

      const track = p.tracks.find((t) => t.id === activeTrackId);
      const chain = getDeviceChainForTrack(track);
      const hasContainer = Boolean(
        this.shadowRoot &&
        this.shadowRoot.querySelector(".scdaw-devices__rack"),
      );

      if (
        shouldPreserveDevicesDom({
          renderedTrackId: this._renderedTrackId,
          targetTrackId: activeTrackId,
          renderedChain: this._renderedChain,
          targetChain: chain,
          hasContainer,
        })
      ) {
        this._syncDevices(track, chain);
      } else {
        this.render();
      }
    });
  }

  disconnectedCallback() {
    if (this._dispose) this._dispose();
  }

  _syncDevices(track, chain) {
    if (!this.shadowRoot) return;
    this._renderedTrackId = track?.id || null;
    this._renderedChain = chain;

    // 1. Update track name in header if changed
    const trackNameEl = this.shadowRoot.querySelector(
      ".scdaw-devices__header strong",
    );
    if (trackNameEl && trackNameEl.textContent !== (track?.name || "None")) {
      trackNameEl.textContent = track?.name || "None";
    }

    // 2. Sync knob values in each device card without disrupting active dragging
    const cards = this.shadowRoot.querySelectorAll(".scdaw-devices__card");
    cards.forEach((card, idx) => {
      const dev = chain[idx];
      if (!dev) return;
      const p = dev.params || {};

      card.querySelectorAll("shadow-claw-daw-knob").forEach((knob) => {
        const param = knob.dataset.param;
        if (!param) return;
        const targetVal = p[param];
        if (targetVal !== undefined && !knob._isDragging) {
          const numVal = Number(targetVal);
          if (knob.value !== numVal) {
            knob.value = numVal;
          }
        }
      });
    });
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

    this._renderedTrackId = this._selectedTrackId;
    this._renderedChain = chain;

    this.shadowRoot.innerHTML = `
      <style>
        ${SHARED_STYLES}
        :host {
          display: block;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          container-type: inline-size;
          container-name: shadow-claw-daw-devices;
        }
        .scdaw-devices__rack,
        .rack-container {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem;
          padding: 0.75rem;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          touch-action: pan-x pan-y;
          overscroll-behavior-x: contain;
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
        .scdaw-devices__card-actions {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          flex-shrink: 0;
        }
        .scdaw-devices__remove-btn {
          padding: 0.15rem 0.35rem;
          font-size: 0.7rem;
          line-height: 1;
        }
        .scdaw-devices__empty {
          font-size: 0.8rem;
          color: var(--text-secondary);
          padding: 1rem;
          margin: auto;
          text-align: center;
        }
        .scdaw-devices__controls,
        .controls-row {
          display: flex;
          align-items: center;
          justify-content: space-around;
          gap: 0.5rem;
          flex-wrap: wrap;
          touch-action: none;
        }
        @container shadow-claw-daw-devices (min-width: 640px) {
          .scdaw-devices__rack,
          .rack-container {
            padding: 0.9rem;
            gap: 0.9rem;
          }
          .scdaw-devices__card,
          .device-card {
            flex: 1 1 280px;
          }
        }
        @supports not (container-type: inline-size) {
          @media (min-width: 640px) {
            .scdaw-devices__rack,
            .rack-container {
              padding: 0.9rem;
              gap: 0.9rem;
            }
          }
        }
        @media (pointer: coarse) {
          #reset-device-btn,
          .scdaw-devices__remove-btn {
            min-width: 36px;
            min-height: 36px;
          }
        }
      </style>
      <div class="scdaw-devices daw-panel" role="region" aria-label="Track Device Rack">
        <div class="scdaw-devices__header daw-panel-header">
          <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
            <span>🎛️ Device Rack: <strong>${track?.name || "None"}</strong></span>
            <span class="badge">${chain.length} Devices</span>
          </div>
          <div style="display:flex; gap:4px; flex-shrink:0;">
            <button id="reset-device-btn" type="button" class="btn btn-icon" aria-label="Reset track device parameters to factory defaults" title="Reset instrument parameters to factory defaults">🔄 Reset Device</button>
          </div>
        </div>
        <div class="scdaw-devices__rack rack-container">
          ${
            chain.length === 0
              ? `<div class="scdaw-devices__empty">No devices loaded. Click an instrument or effect in the Browser to add one.</div>`
              : chain
                  .map(
                    (dev) => `
            <div class="scdaw-devices__card device-card" data-role="${dev.role}" data-type="${dev.type}" data-id="${dev.params?.id || ""}">
              <div class="scdaw-devices__card-header device-card-header">
                <span style="font-weight:700; font-size:0.78rem; color:var(--accent);">${dev.name}</span>
                <div class="scdaw-devices__card-actions">
                  <span class="badge" style="font-size:0.65rem;">${dev.role}</span>
                  <button
                    type="button"
                    class="btn btn-icon btn-danger scdaw-devices__remove-btn remove-device-btn"
                    data-role="${dev.role}"
                    data-type="${dev.type}"
                    data-id="${dev.params?.id || ""}"
                    aria-label="Remove ${dev.name}"
                    title="Remove ${dev.name}"
                  >✕</button>
                </div>
              </div>
              <div class="scdaw-devices__controls controls-row">
                ${renderDeviceControls(dev)}
              </div>
            </div>
          `,
                  )
                  .join("")
          }
        </div>
      </div>
    `;

    // Knob parameter adjustments
    this.shadowRoot.querySelectorAll("shadow-claw-daw-knob").forEach((knob) => {
      knob.addEventListener("input", (e) => {
        if (!this._selectedTrackId) return;
        const card = knob.closest(".scdaw-devices__card");
        const role = card?.dataset.role;
        const param = knob.dataset.param;
        const val = e.detail.value;
        if (
          role === "instrument" &&
          typeof scdaw.setLiveTrackParam === "function"
        ) {
          scdaw.setLiveTrackParam(this._selectedTrackId, {
            params: { [param]: val },
          });
        }
      });

      knob.addEventListener("change", (e) => {
        if (!this._selectedTrackId) return;
        const card = knob.closest(".scdaw-devices__card");
        const role = card?.dataset.role;
        const devType = card?.dataset.type;
        const devId = card?.dataset.id;
        const param = knob.dataset.param;
        const val = e.detail.value;

        if (role === "instrument") {
          if (typeof scdaw.commitLiveTrackParam === "function") {
            scdaw.setLiveTrackParam?.(this._selectedTrackId, {
              params: { [param]: val },
            });
            scdaw.commitLiveTrackParam(this._selectedTrackId);
          } else {
            scdaw.sendCommand("set_track", {
              trackId: this._selectedTrackId,
              params: { [param]: val },
            });
          }
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
      knob.addEventListener("contextmenu", (e) => {
        if (!this._selectedTrackId) return;
        const param = knob.dataset.param;
        if (!param) return;
        e.preventDefault?.();
        e.stopPropagation?.();
        scdaw.midi?.startMidiLearn?.({
          trackId: this._selectedTrackId,
          param,
          min: Number(knob.min ?? 0),
          max: Number(knob.max ?? 1),
          scaling: knob.scaling || "linear",
          channel: "omni",
        });
      });
    });

    // Remove device buttons
    this.shadowRoot
      .querySelectorAll(".scdaw-devices__remove-btn")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          if (!this._selectedTrackId) return;
          const role = btn.dataset.role;
          const devType = btn.dataset.type;
          const devId = btn.dataset.id;

          if (role === "instrument") {
            scdaw.sendCommand("set_instrument", {
              trackId: this._selectedTrackId,
              instrument: "none",
            });
          } else if (role === "audio-fx" || role === "midi-fx") {
            scdaw.sendCommand("manage_fx", {
              action: "remove",
              trackId: this._selectedTrackId,
              fxType: devType,
              fxId: devId || undefined,
            });
          }
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

defineElement("shadow-claw-daw-devices", ShadowClawDawDevices);
