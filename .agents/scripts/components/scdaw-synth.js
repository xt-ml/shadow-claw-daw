/**
 * .agents/scripts/components/scdaw-synth.js
 *
 * Dedicated Multi-Engine Synthesizer Workbench (<scdaw-synth>).
 * Supports Vaporisateur (30-param subtractive), Tubular (6-Op / 32-Algo DX7 FM + .syx),
 * PSG (YM2149 chiptune), Cubed (303), 808, Pluck, Neon, Korpus, Noise Pad, Nano,
 * SoundFont, live AnalyserNode oscilloscope, and per-step parameter locks.
 * Mobile-first, container-query responsive, BEM & WCAG 2.1 AA ARIA compliant.
 */

import { SHARED_STYLES } from "./scdaw-styles.js";
import { scdaw } from "../scdaw-engine.js";
import { effect } from "../scdaw-signals.js";
import { INSTRUMENT_SCHEMAS, getDefaultParams } from "../scdaw-schema.js";
import { INSTRUMENT_PRESETS } from "../scdaw-presets.js";
import { ppqnToStep, stepsPerBar } from "../scdaw.js";
import {
  describeDx7Algorithm,
  renderAlgorithmSvg,
  parseDx7Sysex,
  encodeDx7SysexVoice,
} from "../scdaw-syx.js";
import "./scdaw-knob.js";

const BaseElement = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

export const SYNTH_ENGINES = Object.freeze([
  { id: "synth", label: "Vaporisateur (Subtractive)" },
  { id: "tubular", label: "Tubular (DX7 6-Op FM)" },
  { id: "psg", label: "PSG (YM2149 Chiptune)" },
  { id: "cubed", label: "Cubed (TB-303 Acid)" },
  { id: "808", label: "808 Sub Bass" },
  { id: "pluck", label: "Pluck (Karplus-Strong)" },
  { id: "neon", label: "Neon (CZ-101 Phase Dist)" },
  { id: "korpus", label: "Korpus (Modal Resonator)" },
  { id: "noise-pad", label: "Noise Pad (Atmospheric)" },
  { id: "nano", label: "Nano (Micro-Sampler)" },
  { id: "soundfont", label: "SoundFont (GM Synth)" },
]);

/**
 * Returns the ordered workbench section tabs for a given instrument engine.
 *
 * @param {string} [instrument="synth"]
 * @returns {Array<{ id: string, label: string }>}
 */
export function getSynthSectionsForInstrument(instrument = "synth") {
  const inst = String(instrument || "synth").toLowerCase();
  return [
    {
      id: "osc",
      label: inst === "tubular" ? "🎛️ Macro & Pitch" : "🎛️ Oscillators & Core",
    },
    { id: "ops", label: "⚡ FM Operators 1–6" },
    { id: "filter", label: "🌊 Filter & Envelopes" },
    { id: "mod", label: "🌀 Mod, Locks & .syx" },
  ];
}

/**
 * Determines whether the existing <scdaw-synth> DOM can be synchronized in-place
 * without rebuilding Shadow DOM (preserves active knob pointer drags & scroll).
 *
 * @param {object} opts
 * @returns {boolean}
 */
export function shouldPreserveSynthDom({
  renderedTrackId = null,
  targetTrackId = null,
  renderedInstrument = null,
  targetInstrument = null,
  renderedSection = null,
  targetSection = null,
  renderedAlgorithm = null,
  targetAlgorithm = null,
  renderedLockSig = null,
  targetLockSig = null,
  hasContainer = false,
} = {}) {
  if (!hasContainer) return false;
  if (!renderedTrackId || renderedTrackId !== targetTrackId) return false;
  if (renderedInstrument !== targetInstrument) return false;
  if (renderedSection !== targetSection) return false;
  if (
    targetInstrument === "tubular" &&
    Number(renderedAlgorithm) !== Number(targetAlgorithm)
  ) {
    return false;
  }
  if (targetSection === "mod" && renderedLockSig !== targetLockSig) {
    return false;
  }
  return true;
}

/**
 * Builds an SVG path string visualizing an ADSR envelope inside `width x height`.
 *
 * @param {object} [opts]
 * @returns {string}
 */
export function computeAdsrSvgPath({
  attack = 0.01,
  decay = 0.2,
  sustain = 0.5,
  release = 0.2,
  width = 260,
  height = 96,
} = {}) {
  const padX = 10;
  const padY = 10;
  const innerW = Math.max(40, width - padX * 2);
  const innerH = Math.max(20, height - padY * 2);
  const baseY = padY + innerH;

  const atk = Math.max(0.002, Number(attack || 0.01));
  const dec = Math.max(0.01, Number(decay || 0.2));
  const sus = Math.max(0, Math.min(1, Number(sustain ?? 0.5)));
  const rel = Math.max(0.01, Number(release || 0.2));

  const sustainHold = 0.35;
  const totalTime = Math.max(0.1, atk + dec + sustainHold + rel);

  const x0 = padX;
  const x1 = x0 + (atk / totalTime) * innerW;
  const x2 = x1 + (dec / totalTime) * innerW;
  const x3 = x2 + (sustainHold / totalTime) * innerW;
  const x4 = padX + innerW;

  const yPeak = padY;
  const ySus = baseY - sus * innerH;

  return `M ${x0.toFixed(1)} ${baseY.toFixed(1)} L ${x1.toFixed(1)} ${yPeak.toFixed(1)} L ${x2.toFixed(1)} ${ySus.toFixed(1)} L ${x3.toFixed(1)} ${ySus.toFixed(1)} L ${x4.toFixed(1)} ${baseY.toFixed(1)}`;
}

const SECTION_PARAM_KEYS = Object.freeze({
  osc: {
    synth: [
      "waveform",
      "pulseWidth",
      "osc2Waveform",
      "osc2Octave",
      "osc2Detune",
      "osc2Mix",
      "subMix",
      "noiseMix",
      "unisonCount",
      "unisonDetune",
      "unisonStereo",
      "detune",
      "glide",
    ],
    vaporisateur: [
      "waveform",
      "pulseWidth",
      "osc2Waveform",
      "osc2Octave",
      "osc2Detune",
      "osc2Mix",
      "subMix",
      "noiseMix",
      "unisonCount",
      "unisonDetune",
      "unisonStereo",
      "detune",
      "glide",
    ],
    tubular: [
      "algorithm",
      "feedback",
      "modIndex",
      "brightness",
      "lfoRate",
      "lfoPitchDepth",
    ],
    psg: ["mode", "duty", "noisePeriod", "tune", "arpSteps"],
    cubed: [
      "waveform",
      "tuning",
      "cutoff",
      "resonance",
      "envMod",
      "decay",
      "accent",
    ],
    808: ["preset", "glide", "drive", "tone", "decay"],
    pluck: ["preset", "tone", "decay", "drive", "width"],
    neon: ["mode", "wave1", "wave2", "dcw", "detune"],
    korpus: [
      "exciter",
      "materialA",
      "materialB",
      "intensity",
      "coupling",
      "damping",
    ],
    "noise-pad": ["preset", "tone", "texture", "width"],
    nano: ["samplePreset", "rootKey", "loop", "reverse"],
    soundfont: ["bank", "program"],
  },
  filter: {
    synth: [
      "filterType",
      "cutoff",
      "resonance",
      "highpassCutoff",
      "formantFreq",
      "filterEnvAmount",
      "filterDecay",
      "drive",
      "attack",
      "decay",
      "sustain",
      "release",
      "pitchEnvAmount",
      "pitchAttack",
      "pitchReleaseDrop",
    ],
    vaporisateur: [
      "filterType",
      "cutoff",
      "resonance",
      "highpassCutoff",
      "formantFreq",
      "filterEnvAmount",
      "filterDecay",
      "drive",
      "attack",
      "decay",
      "sustain",
      "release",
      "pitchEnvAmount",
      "pitchAttack",
      "pitchReleaseDrop",
    ],
    tubular: ["attack", "decay", "sustain", "release"],
    psg: ["attack", "decay", "sustain", "release"],
    cubed: ["cutoff", "resonance", "envMod", "decay", "accent"],
    808: ["tone", "drive", "decay"],
    pluck: ["tone", "decay", "drive"],
    neon: ["dcw", "attack", "release"],
    korpus: ["intensity", "coupling", "damping"],
    "noise-pad": ["attack", "decay", "sustain", "release"],
    nano: [
      "highpassCutoff",
      "formantFreq",
      "cutoff",
      "resonance",
      "drive",
      "attack",
      "release",
      "pitchEnvAmount",
      "pitchAttack",
      "pitchReleaseDrop",
    ],
    soundfont: ["bank", "program"],
  },
});

const SHORT_LABELS = Object.freeze({
  waveform: "Wave 1",
  pulseWidth: "Pulse W",
  osc2Waveform: "Wave 2",
  osc2Octave: "Osc2 Oct",
  osc2Detune: "Osc2 Det",
  osc2Mix: "Osc2 Mix",
  subMix: "Sub Mix",
  noiseMix: "Noise",
  unisonCount: "Unison",
  unisonDetune: "Uni Det",
  unisonStereo: "Uni Width",
  detune: "Detune",
  glide: "Glide",
  filterType: "Filter",
  cutoff: "Cutoff",
  resonance: "Resonance",
  highpassCutoff: "HPF",
  formantFreq: "Formant",
  filterEnvAmount: "Env Amt",
  filterDecay: "Flt Dec",
  drive: "Drive",
  attack: "Attack",
  decay: "Decay",
  sustain: "Sustain",
  release: "Release",
  pitchEnvAmount: "Pitch Env",
  pitchAttack: "Pitch Atk",
  pitchReleaseDrop: "Pitch Sag",
  lfoWaveform: "LFO Wave",
  lfoRate: "LFO Rate",
  lfoPitchDepth: "LFO Pitch",
  lfoFilterDepth: "LFO Flt",
  algorithm: "Algorithm",
  feedback: "Feedback",
  modIndex: "Mod Index",
  brightness: "Bright",
  noisePeriod: "Noise Freq",
  arpSteps: "Arp Step",
  samplePreset: "SFX Sample",
  rootKey: "Root Key",
  materialA: "Material A",
  materialB: "Material B",
});

export class DawSynthElement extends BaseElement {
  constructor() {
    super();
    if (this.attachShadow) {
      this.attachShadow({ mode: "open" });
    }
    this._selectedTrackId = null;
    this._activeSection = "osc";
    this._activeOp = 1;
    this._lockStep = 0;
    this._lockParam = "cutoff";
    this._syxVoices = [];
    this._syxStatus = "";
    this._renderedTrackId = null;
    this._renderedInstrument = null;
    this._renderedSection = null;
    this._renderedAlgorithm = null;
    this._renderedLockSig = null;
    this._rafId = null;
    this._scopeBuf = new Float32Array(256);
    this._classObserver = null;
  }

  connectedCallback() {
    this.render();
    this._startScopeLoop();

    if (
      typeof MutationObserver !== "undefined" &&
      typeof this.getAttribute === "function"
    ) {
      try {
        this._classObserver = new MutationObserver(() => {
          if (!this._isContainerHidden()) {
            this.render();
          }
        });
        this._classObserver.observe(this, {
          attributes: true,
          attributeFilter: ["class", "hidden"],
        });
      } catch (_) {}
    }

    this._dispose = effect(() => {
      const p = scdaw.project.get();
      const track = this._resolveActiveTrack(p);
      const inst = this._resolveInstrument(track);
      const hasContainer = Boolean(
        this.shadowRoot && this.shadowRoot.querySelector(".scdaw-synth"),
      );
      const targetLockSig = this._computeLockSig(track);

      if (
        shouldPreserveSynthDom({
          renderedTrackId: this._renderedTrackId,
          targetTrackId: track?.id || null,
          renderedInstrument: this._renderedInstrument,
          targetInstrument: inst,
          renderedSection: this._renderedSection,
          targetSection: this._activeSection,
          renderedAlgorithm: this._renderedAlgorithm,
          targetAlgorithm: track?.params?.algorithm ?? 1,
          renderedLockSig: this._renderedLockSig,
          targetLockSig,
          hasContainer,
        })
      ) {
        this._syncDom(p, track, inst);
      } else {
        this.render();
      }
    });
  }

  disconnectedCallback() {
    if (this._rafId && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._dispose) {
      this._dispose();
      this._dispose = null;
    }
    if (this._classObserver) {
      this._classObserver.disconnect();
      this._classObserver = null;
    }
  }

  _computeLockSig(track) {
    if (!track || !Array.isArray(track.notes)) return "";
    return track.notes
      .filter((n) => n.locks && Object.keys(n.locks).length > 0)
      .map((n) => `${ppqnToStep(n.position)}:${JSON.stringify(n.locks)}`)
      .join("|");
  }

  _isContainerHidden() {
    if (this.hidden || this.classList?.contains?.("hidden")) return true;
    const parent = this.parentElement;
    if (parent && (parent.hidden || parent.classList?.contains?.("hidden"))) {
      return true;
    }
    return false;
  }

  _resolveActiveTrack(p) {
    const tracks = p?.tracks || [];
    const sharedId = scdaw.selectedTrackId?.get?.();
    if (sharedId && tracks.some((t) => t.id === sharedId)) {
      this._selectedTrackId = sharedId;
    } else if (
      !this._selectedTrackId ||
      !tracks.some((t) => t.id === this._selectedTrackId)
    ) {
      const synthTrack = tracks.find((t) => t.kind !== "audio");
      this._selectedTrackId = synthTrack?.id || tracks[0]?.id || null;
    }
    return tracks.find((t) => t.id === this._selectedTrackId) || null;
  }

  _resolveInstrument(track) {
    if (!track) return "synth";
    const raw =
      track.instrument !== undefined
        ? track.instrument
        : track.kind === "drums"
          ? "drums"
          : "synth";
    return String(raw || "synth").toLowerCase();
  }

  _getSchemaForInstrument(inst) {
    return INSTRUMENT_SCHEMAS[inst] || INSTRUMENT_SCHEMAS.synth;
  }

  _startScopeLoop() {
    if (typeof requestAnimationFrame !== "function") return;
    const tick = () => {
      this._drawOscilloscope();
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _drawOscilloscope() {
    if (!this.shadowRoot || this._isContainerHidden()) return;
    const canvas = this.shadowRoot.getElementById("synth-scope-canvas");
    if (!canvas || typeof canvas.getContext !== "function") return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;

    const analyser =
      scdaw.graph?.tracks?.get?.(this._selectedTrackId)?.analyser ||
      scdaw.graph?.masterAnalyser ||
      null;

    const w = canvas.width || 280;
    const h = canvas.height || 114;

    ctx2d.fillStyle = "rgba(8, 13, 15, 0.92)";
    ctx2d.fillRect(0, 0, w, h);

    // Subtle center baseline
    ctx2d.strokeStyle = "rgba(128, 212, 219, 0.16)";
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    ctx2d.moveTo(0, h / 2);
    ctx2d.lineTo(w, h / 2);
    ctx2d.stroke();

    if (analyser && typeof analyser.getFloatTimeDomainData === "function") {
      if (this._scopeBuf.length !== analyser.fftSize) {
        this._scopeBuf = new Float32Array(analyser.fftSize);
      }
      analyser.getFloatTimeDomainData(this._scopeBuf);
    } else {
      this._scopeBuf.fill(0);
    }

    ctx2d.strokeStyle = "#80d4db";
    ctx2d.lineWidth = 1.8;
    ctx2d.beginPath();
    const len = this._scopeBuf.length;
    const sliceW = w / Math.max(1, len);
    for (let i = 0; i < len; i++) {
      const x = i * sliceW;
      const y =
        h / 2 - Math.max(-1, Math.min(1, this._scopeBuf[i])) * (h * 0.44);
      if (i === 0) ctx2d.moveTo(x, y);
      else ctx2d.lineTo(x, y);
    }
    ctx2d.stroke();
  }

  _syncDom(p, track, inst) {
    if (!this.shadowRoot || !track) return;
    const params = { ...getDefaultParams(inst), ...(track.params || {}) };

    this.shadowRoot.querySelectorAll("scdaw-knob").forEach((knob) => {
      const param = knob.dataset.param;
      if (!param || knob._isDragging) return;
      const nextVal = params[param];
      if (nextVal !== undefined && Number(knob.value) !== Number(nextVal)) {
        knob.value = Number(nextVal);
      }
    });

    this.shadowRoot.querySelectorAll("[data-param-select]").forEach((sel) => {
      const param = sel.dataset.paramSelect;
      if (
        param &&
        params[param] !== undefined &&
        sel.value !== String(params[param])
      ) {
        sel.value = String(params[param]);
      }
    });

    this.shadowRoot.querySelectorAll("[data-param-toggle]").forEach((btn) => {
      const param = btn.dataset.paramToggle;
      if (param) {
        const active = Boolean(params[param]);
        btn.setAttribute("aria-pressed", String(active));
        btn.classList.toggle("btn-primary", active);
      }
    });

    const adsrPathEl = this.shadowRoot.getElementById("synth-adsr-path");
    if (adsrPathEl) {
      adsrPathEl.setAttribute(
        "d",
        computeAdsrSvgPath({
          attack: params.attack,
          decay: params.decay,
          sustain: params.sustain,
          release: params.release,
        }),
      );
    }

    const patchBadge = this.shadowRoot.getElementById("synth-patch-badge");
    if (patchBadge) {
      patchBadge.textContent = params.patchName || inst.toUpperCase();
    }
  }

  _renderControlHtml(key, spec, value) {
    if (!spec) return "";
    const label = SHORT_LABELS[key] || key;
    if (spec.type === "enum" && Array.isArray(spec.values)) {
      return `
        <div class="scdaw-synth__field">
          <label class="scdaw-synth__field-label" for="synth-ctrl-${key}">${label}</label>
          <select id="synth-ctrl-${key}" class="scdaw-synth__select" data-param-select="${key}" aria-label="${label}">
            ${spec.values
              .map(
                (v) =>
                  `<option value="${v}" ${String(value) === String(v) ? "selected" : ""}>${v}</option>`,
              )
              .join("")}
          </select>
        </div>
      `;
    }
    if (spec.type === "boolean") {
      const active = Boolean(value);
      return `
        <div class="scdaw-synth__field">
          <span class="scdaw-synth__field-label">${label}</span>
          <button type="button" class="btn btn-icon ${active ? "btn-primary" : ""}" data-param-toggle="${key}" aria-pressed="${active}">${label}: ${active ? "ON" : "OFF"}</button>
        </div>
      `;
    }
    if (spec.type === "string") {
      return `
        <div class="scdaw-synth__field">
          <label class="scdaw-synth__field-label" for="synth-ctrl-${key}">${label}</label>
          <input id="synth-ctrl-${key}" type="text" maxlength="16" class="scdaw-synth__input" data-param-text="${key}" value="${String(value ?? spec.default ?? "")}" aria-label="${label}" />
        </div>
      `;
    }
    return `
      <scdaw-knob
        label="${label}"
        min="${spec.min ?? 0}"
        max="${spec.max ?? 1}"
        step="${spec.step ?? 0.01}"
        scaling="${spec.scaling || "linear"}"
        unit="${spec.unit || ""}"
        value="${value ?? spec.default ?? 0}"
        default="${spec.default ?? 0}"
        data-param="${key}"
      ></scdaw-knob>
    `;
  }

  _renderActiveSectionHtml(p, track, inst, params, schema) {
    if (this._activeSection === "ops") {
      if (inst !== "tubular") {
        return `
          <div class="scdaw-synth__callout" role="status">
            <p>6-Operator FM editing applies to the <strong>Tubular (DX7 6-Op FM)</strong> engine. Current track uses <strong>${inst.toUpperCase()}</strong>.</p>
            <button id="synth-switch-tubular-btn" type="button" class="btn btn-primary">⚡ Switch Track to Tubular 6-Op FM</button>
          </div>
        `;
      }
      const algo = Math.max(
        1,
        Math.min(32, Math.round(Number(params.algorithm ?? 1))),
      );
      const desc = describeDx7Algorithm(algo);
      return `
        <div class="scdaw-synth__op-grid" role="group" aria-label="DX7 Operators 1 to 6">
          ${desc.operators
            .map((info) => {
              const k = info.op;
              const isSelected = this._activeOp === k;
              const roleBadge = info.isCarrier
                ? "CARRIER → OUT"
                : `MOD → ${info.targets.map((t) => `OP${t}`).join(",") || "OUT"}`;
              return `
                <article class="scdaw-synth__op-card ${isSelected ? "scdaw-synth__op-card--selected" : ""}" data-op="${k}" tabindex="0" aria-label="Operator ${k}: ${roleBadge}">
                  <header class="scdaw-synth__op-header">
                    <strong>OP ${k}</strong>
                    <span class="badge ${info.isCarrier ? "scdaw-synth__badge--carrier" : ""}">${roleBadge}</span>
                    ${info.hasFeedback ? `<span class="badge" title="Feedback operator">⟲ FB</span>` : ""}
                  </header>
                  <div class="scdaw-synth__op-knobs">
                    ${["Ratio", "Level", "Detune", "Attack", "Decay"]
                      .map((field) => {
                        const paramKey = `op${k}${field}`;
                        return this._renderControlHtml(
                          paramKey,
                          schema[paramKey],
                          params[paramKey],
                        );
                      })
                      .join("")}
                  </div>
                </article>
              `;
            })
            .join("")}
        </div>
      `;
    }

    if (this._activeSection === "mod") {
      const totalSteps =
        (p.lengthBars || 1) * stepsPerBar(p.signature || [4, 4]);
      const stepLocksMap = new Map();
      for (const n of track?.notes || []) {
        const s = ppqnToStep(n.position);
        if (
          n.locks &&
          typeof n.locks === "object" &&
          Object.keys(n.locks).length > 0
        ) {
          stepLocksMap.set(s, n.locks);
        }
      }
      const currentStepLocks = stepLocksMap.get(this._lockStep) || {};
      const lockableParams = [
        "cutoff",
        "resonance",
        "modIndex",
        "feedback",
        "drive",
        "decay",
        "pitchEnvAmount",
        "duty",
        "arpSteps",
      ];
      const activeLockSummary = [...stepLocksMap.entries()]
        .map(
          ([st, obj]) =>
            `<span class="badge">Step ${st + 1}: ${Object.entries(obj)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ")}</span>`,
        )
        .join(" ");

      const lfoHtml =
        inst === "synth" || inst === "vaporisateur"
          ? `
            <div class="scdaw-synth__subpanel">
              <h3 class="scdaw-synth__subheading">LFO &amp; Voicing</h3>
              <div class="scdaw-synth__controls-grid">
                ${[
                  "lfoWaveform",
                  "lfoRate",
                  "lfoPitchDepth",
                  "lfoFilterDepth",
                  "monophonic",
                ]
                  .map((k) => this._renderControlHtml(k, schema[k], params[k]))
                  .join("")}
              </div>
            </div>
          `
          : "";

      return `
        <div class="scdaw-synth__mod-stack">
          ${lfoHtml}
          <div class="scdaw-synth__subpanel scdaw-synth__locks" role="group" aria-label="Per-Step Parameter Locks">
            <h3 class="scdaw-synth__subheading">Per-Step Parameter Locks</h3>
            <div class="scdaw-synth__locks-row">
              <label class="scdaw-synth__field">
                <span class="scdaw-synth__field-label">Step</span>
                <select id="synth-lock-step" class="scdaw-synth__select" aria-label="Sequencer step to lock">
                  ${Array.from({ length: Math.min(64, totalSteps) }, (_, s) => {
                    const hasLock = stepLocksMap.has(s);
                    return `<option value="${s}" ${s === this._lockStep ? "selected" : ""}>Step ${s + 1}${hasLock ? " 🔒" : ""}</option>`;
                  }).join("")}
                </select>
              </label>
              <label class="scdaw-synth__field">
                <span class="scdaw-synth__field-label">Parameter</span>
                <select id="synth-lock-param" class="scdaw-synth__select" aria-label="Parameter to lock on step">
                  ${lockableParams
                    .map(
                      (k) =>
                        `<option value="${k}" ${k === this._lockParam ? "selected" : ""}>${SHORT_LABELS[k] || k}</option>`,
                    )
                    .join("")}
                </select>
              </label>
              <label class="scdaw-synth__field">
                <span class="scdaw-synth__field-label">Value</span>
                <input id="synth-lock-value" type="number" step="any" class="scdaw-synth__input" value="${currentStepLocks[this._lockParam] ?? params[this._lockParam] ?? 800}" aria-label="Parameter lock value" />
              </label>
              <div class="scdaw-synth__locks-actions">
                <button id="synth-lock-apply-btn" type="button" class="btn btn-primary">🔒 Lock Step</button>
                <button id="synth-lock-clear-btn" type="button" class="btn">🔓 Clear Step</button>
              </div>
            </div>
            <div class="scdaw-synth__lock-badges" aria-live="polite">
              ${activeLockSummary || `<span class="scdaw-synth__muted">No step parameter locks on this track yet.</span>`}
            </div>
          </div>

          <div class="scdaw-synth__subpanel scdaw-synth__syx-bar" role="group" aria-label="DX7 SysEx Patch Librarian">
            <h3 class="scdaw-synth__subheading">DX7 SysEx (.syx) Cartridge Librarian</h3>
            <div class="scdaw-synth__syx-row">
              <input id="synth-syx-input" type="file" accept=".syx" style="display:none;" aria-hidden="true" />
              <button id="synth-syx-import-btn" type="button" class="btn btn-icon">📂 Load DX7 .syx</button>
              <select id="synth-syx-voice-select" class="scdaw-synth__select" aria-label="Select voice from loaded DX7 cartridge" ${this._syxVoices.length === 0 ? "disabled" : ""}>
                ${
                  this._syxVoices.length === 0
                    ? `<option value="">No .syx cartridge loaded</option>`
                    : this._syxVoices
                        .map(
                          (v, i) =>
                            `<option value="${i}">${String(i + 1).padStart(2, "0")}: ${v.name} (Alg ${v.algorithm})</option>`,
                        )
                        .join("")
                }
              </select>
              <button id="synth-syx-export-btn" type="button" class="btn btn-icon">💾 Export .syx</button>
            </div>
            ${this._syxStatus ? `<p class="scdaw-synth__syx-status" role="status">${this._syxStatus}</p>` : ""}
          </div>
        </div>
      `;
    }

    const sectionMap =
      SECTION_PARAM_KEYS[this._activeSection] || SECTION_PARAM_KEYS.osc;
    const keys = sectionMap[inst] || Object.keys(schema);
    if (!keys || keys.length === 0) {
      return `
        <div class="scdaw-synth__callout" role="status">
          <p><strong>${inst.toUpperCase()}</strong> uses procedural synthesis. Select another engine above to sculpt oscillators, 6-op FM, or chiptune PSG.</p>
        </div>
      `;
    }

    return `
      <div class="scdaw-synth__controls-grid">
        ${keys.map((k) => this._renderControlHtml(k, schema[k], params[k])).join("")}
      </div>
    `;
  }

  render() {
    if (!this.shadowRoot) return;
    const p = scdaw.getProject();
    const track = this._resolveActiveTrack(p);
    const inst = this._resolveInstrument(track);
    const schema = this._getSchemaForInstrument(inst);
    const params = { ...getDefaultParams(inst), ...(track?.params || {}) };
    const sections = getSynthSectionsForInstrument(inst);
    if (!sections.some((s) => s.id === this._activeSection)) {
      this._activeSection = sections[0].id;
    }

    this._renderedTrackId = track?.id || null;
    this._renderedInstrument = inst;
    this._renderedSection = this._activeSection;
    this._renderedAlgorithm = params.algorithm ?? 1;
    this._renderedLockSig = this._computeLockSig(track);

    const tracks = p.tracks || [];
    const presetEntries = Object.entries(INSTRUMENT_PRESETS);

    const visualRightHtml =
      inst === "tubular"
        ? `
          <div class="scdaw-synth__diagram-card">
            <div class="scdaw-synth__diagram-head">
              <label for="synth-algo-select" class="scdaw-synth__field-label">Algorithm</label>
              <select id="synth-algo-select" class="scdaw-synth__select" aria-label="DX7 Algorithm (1 to 32)">
                ${Array.from({ length: 32 }, (_, i) => i + 1)
                  .map(
                    (a) =>
                      `<option value="${a}" ${Number(params.algorithm ?? 1) === a ? "selected" : ""}>Alg ${a}</option>`,
                  )
                  .join("")}
              </select>
              <scdaw-knob label="FB" min="0" max="7" step="1" unit="" value="${params.feedback ?? 4}" default="4" data-param="feedback"></scdaw-knob>
            </div>
            <div class="scdaw-synth__svg-wrap">
              ${renderAlgorithmSvg(params.algorithm ?? 1, this._activeOp)}
            </div>
          </div>
        `
        : `
          <div class="scdaw-synth__diagram-card">
            <div class="scdaw-synth__diagram-head">
              <span class="scdaw-synth__field-label">Amplitude Envelope (ADSR)</span>
              <span id="synth-patch-badge" class="badge">${params.patchName || inst.toUpperCase()}</span>
            </div>
            <div class="scdaw-synth__svg-wrap">
              <svg class="scdaw-synth__adsr-svg" viewBox="0 0 260 96" role="img" aria-label="ADSR envelope curve">
                <rect x="0.5" y="0.5" width="259" height="95" rx="6" fill="rgba(8, 13, 15, 0.7)" stroke="rgba(255,255,255,0.1)" />
                <path id="synth-adsr-path" d="${computeAdsrSvgPath({ attack: params.attack, decay: params.decay, sustain: params.sustain, release: params.release })}" fill="none" stroke="#80d4db" stroke-width="2.2" stroke-linejoin="round" />
              </svg>
            </div>
          </div>
        `;

    this.shadowRoot.innerHTML = `
      <style>
        ${SHARED_STYLES}
        :host {
          display: block;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          container-type: inline-size;
          container-name: scdaw-synth;
          overflow-x: hidden;
        }
        /* 1. Mobile-First Base Styles (< 640px) */
        .scdaw-synth {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          padding: 0.75rem;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          overflow-x: hidden;
        }
        .scdaw-synth__header {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          border-bottom: 1px solid var(--border);
          padding-bottom: 0.6rem;
        }
        .scdaw-synth__selectors {
          display: grid;
          grid-template-columns: 1fr;
          gap: 0.45rem;
        }
        .scdaw-synth__header-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.45rem;
        }
        .scdaw-synth__visuals {
          display: grid;
          grid-template-columns: 1fr;
          gap: 0.65rem;
        }
        .scdaw-synth__scope-card,
        .scdaw-synth__diagram-card {
          background: rgba(0, 0, 0, 0.25);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 0.55rem;
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
          min-width: 0;
        }
        .scdaw-synth__diagram-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 0.5rem;
          flex-wrap: wrap;
        }
        #synth-scope-canvas {
          width: 100%;
          height: 110px;
          display: block;
          border-radius: 5px;
          border: 1px solid rgba(255, 255, 255, 0.08);
        }
        .scdaw-synth__svg-wrap {
          width: 100%;
          display: flex;
          justify-content: center;
        }
        .scdaw-synth__algo-svg,
        .scdaw-synth__adsr-svg {
          width: 100%;
          max-width: 320px;
          height: auto;
          display: block;
        }
        .scdaw-synth__tabs {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 0.35rem;
        }
        .scdaw-synth__tab {
          width: 100%;
          min-height: 34px;
          font-size: 0.74rem;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .scdaw-synth__panel {
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 0.75rem;
          min-width: 0;
        }
        .scdaw-synth__controls-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
          gap: 0.65rem;
          align-items: center;
          justify-items: center;
        }
        .scdaw-synth__field {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
          width: 100%;
          min-width: 0;
        }
        .scdaw-synth__field-label {
          font-size: 0.7rem;
          font-weight: 600;
          color: var(--text-secondary, #94a3b8);
        }
        .scdaw-synth__select,
        .scdaw-synth__input {
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
          background: var(--bg-elevated, #1e2627);
          color: inherit;
          border: 1px solid var(--border);
          border-radius: 4px;
          padding: 0.35rem 0.45rem;
          font-size: 0.75rem;
        }
        .scdaw-synth__op-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 0.6rem;
        }
        .scdaw-synth__op-card {
          background: var(--bg-card, #161b1c);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 0.55rem;
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
          cursor: pointer;
        }
        .scdaw-synth__op-card--selected {
          border-color: var(--accent, #80d4db);
        }
        .scdaw-synth__op-header {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          flex-wrap: wrap;
          font-size: 0.76rem;
        }
        .scdaw-synth__badge--carrier {
          color: #0e1415;
          background: var(--accent, #80d4db);
        }
        .scdaw-synth__op-knobs {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(64px, 1fr));
          gap: 0.35rem;
          justify-items: center;
        }
        .scdaw-synth__mod-stack {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }
        .scdaw-synth__subpanel {
          background: rgba(0, 0, 0, 0.22);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 0.65rem;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .scdaw-synth__subheading {
          margin: 0;
          font-size: 0.8rem;
          color: var(--accent, #80d4db);
        }
        .scdaw-synth__locks-row,
        .scdaw-synth__syx-row {
          display: grid;
          grid-template-columns: 1fr;
          gap: 0.5rem;
          align-items: end;
        }
        .scdaw-synth__locks-actions {
          display: flex;
          gap: 0.4rem;
          flex-wrap: wrap;
        }
        .scdaw-synth__lock-badges {
          display: flex;
          gap: 0.35rem;
          flex-wrap: wrap;
        }
        .scdaw-synth__muted,
        .scdaw-synth__syx-status {
          margin: 0;
          font-size: 0.74rem;
          color: var(--text-secondary, #94a3b8);
        }
        .scdaw-synth__callout {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 0.5rem;
          font-size: 0.8rem;
        }

        /* 2. Progressive Enhancement: Tablet (>= 640px) */
        @container scdaw-synth (min-width: 640px) {
          .scdaw-synth__selectors {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
          .scdaw-synth__header-actions {
            display: flex;
            justify-content: flex-end;
          }
          .scdaw-synth__visuals {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .scdaw-synth__tabs {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
          .scdaw-synth__op-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .scdaw-synth__locks-row {
            grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
          }
          .scdaw-synth__syx-row {
            grid-template-columns: auto minmax(0, 1fr) auto;
          }
        }

        /* 3. Progressive Enhancement: Desktop (>= 1024px) */
        @container scdaw-synth (min-width: 1024px) {
          .scdaw-synth__header {
            flex-direction: row;
            align-items: flex-end;
            justify-content: space-between;
          }
          .scdaw-synth__selectors {
            flex: 1;
          }
          .scdaw-synth__op-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }

        /* Fallback for environments lacking container queries */
        @supports not (container-type: inline-size) {
          @media (min-width: 640px) {
            .scdaw-synth__selectors {
              grid-template-columns: repeat(3, minmax(0, 1fr));
            }
            .scdaw-synth__visuals {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
            .scdaw-synth__tabs {
              grid-template-columns: repeat(4, minmax(0, 1fr));
            }
            .scdaw-synth__op-grid {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
          }
        }
      </style>
      <div class="scdaw-synth daw-panel" role="region" aria-label="Synthesizer Workbench">
        <div class="scdaw-synth__header">
          <div class="scdaw-synth__selectors">
            <label class="scdaw-synth__field">
              <span class="scdaw-synth__field-label">Track</span>
              <select id="synth-track-select" class="scdaw-synth__select" aria-label="Select track for synthesizer editing">
                ${tracks
                  .map(
                    (t) =>
                      `<option value="${t.id}" ${t.id === track?.id ? "selected" : ""}>${t.name} (${this._resolveInstrument(t)})</option>`,
                  )
                  .join("")}
              </select>
            </label>
            <label class="scdaw-synth__field">
              <span class="scdaw-synth__field-label">Engine</span>
              <select id="synth-engine-select" class="scdaw-synth__select" aria-label="Select synthesizer engine">
                ${SYNTH_ENGINES.map(
                  (eng) =>
                    `<option value="${eng.id}" ${inst === eng.id || (inst === "vaporisateur" && eng.id === "synth") ? "selected" : ""}>${eng.label}</option>`,
                ).join("")}
              </select>
            </label>
            <label class="scdaw-synth__field">
              <span class="scdaw-synth__field-label">Preset</span>
              <select id="synth-preset-select" class="scdaw-synth__select" aria-label="Load synthesizer preset">
                <option value="">-- Load Preset --</option>
                ${presetEntries
                  .map(
                    ([name, data]) =>
                      `<option value="${name}">${name} (${data.instrument || "synth"})</option>`,
                  )
                  .join("")}
              </select>
            </label>
          </div>
          <div class="scdaw-synth__header-actions">
            <button id="synth-audition-btn" type="button" class="btn btn-icon btn-primary" aria-label="Audition current synthesizer patch">🔊 Audition</button>
            <button id="synth-reset-btn" type="button" class="btn btn-icon" aria-label="Reset synthesizer parameters to default">🔄 Reset</button>
          </div>
        </div>

        <div class="scdaw-synth__visuals">
          <div class="scdaw-synth__scope-card">
            <div class="scdaw-synth__diagram-head">
              <span class="scdaw-synth__field-label">Live Oscilloscope</span>
              <span class="badge">${inst.toUpperCase()}</span>
            </div>
            <canvas id="synth-scope-canvas" width="280" height="110" role="img" aria-label="Live audio waveform oscilloscope"></canvas>
          </div>
          ${visualRightHtml}
        </div>

        <div class="scdaw-synth__tabs" role="tablist" aria-label="Synthesizer Parameter Sections">
          ${sections
            .map(
              (sec) => `
              <button
                type="button"
                role="tab"
                id="synth-tab-${sec.id}"
                class="scdaw-synth__tab btn btn-icon ${this._activeSection === sec.id ? "btn-primary" : ""}"
                data-section="${sec.id}"
                aria-selected="${this._activeSection === sec.id}"
                aria-controls="synth-panel"
              >${sec.label}</button>
            `,
            )
            .join("")}
        </div>

        <div id="synth-panel" class="scdaw-synth__panel" role="tabpanel" aria-labelledby="synth-tab-${this._activeSection}">
          ${this._renderActiveSectionHtml(p, track, inst, params, schema)}
        </div>
      </div>
    `;

    this._attachListeners(track, inst);
  }

  _attachListeners(track, inst) {
    if (!this.shadowRoot) return;
    const trackId = track?.id || this._selectedTrackId;

    this.shadowRoot
      .getElementById("synth-track-select")
      ?.addEventListener("change", (e) => {
        scdaw.selectTrack?.(e.target.value);
      });

    this.shadowRoot
      .getElementById("synth-engine-select")
      ?.addEventListener("change", (e) => {
        if (!trackId) return;
        const nextInst = e.target.value;
        scdaw.sendCommand("set_instrument", {
          trackId,
          instrument: nextInst,
          params: getDefaultParams(nextInst),
        });
      });

    this.shadowRoot
      .getElementById("synth-preset-select")
      ?.addEventListener("change", (e) => {
        if (!trackId || !e.target.value) return;
        scdaw.sendCommand("apply_preset", {
          trackId,
          preset: e.target.value,
        });
      });

    this.shadowRoot
      .getElementById("synth-audition-btn")
      ?.addEventListener("click", async () => {
        if (!trackId) return;
        await scdaw.ensureContext?.();
        const pitch =
          track?.defaultPitch || (track?.kind === "drums" ? 36 : 60);
        scdaw.previewNote?.(trackId, pitch, 0.9, 480);
      });

    this.shadowRoot
      .getElementById("synth-reset-btn")
      ?.addEventListener("click", () => {
        if (!trackId) return;
        scdaw.sendCommand("reset_track", { trackId, mode: "params" });
      });

    this.shadowRoot
      .getElementById("synth-algo-select")
      ?.addEventListener("change", (e) => {
        if (!trackId) return;
        scdaw.sendCommand("set_track", {
          trackId,
          params: { algorithm: Number(e.target.value) },
        });
      });

    this.shadowRoot
      .getElementById("synth-switch-tubular-btn")
      ?.addEventListener("click", () => {
        if (!trackId) return;
        scdaw.sendCommand("set_instrument", {
          trackId,
          instrument: "tubular",
          params: getDefaultParams("tubular"),
        });
      });

    this.shadowRoot.querySelectorAll(".scdaw-synth__tab").forEach((tabBtn) => {
      tabBtn.addEventListener("click", () => {
        this._activeSection = tabBtn.dataset.section;
        this.render();
      });
    });

    this.shadowRoot
      .querySelectorAll(".scdaw-synth__op-card")
      .forEach((card) => {
        card.addEventListener("click", () => {
          const op = Number(card.dataset.op);
          if (op && op !== this._activeOp) {
            this._activeOp = op;
            this.render();
          }
        });
      });

    // Knobs: live ramp on input, commit on change, reset on reset
    this.shadowRoot.querySelectorAll("scdaw-knob").forEach((knob) => {
      knob.addEventListener("input", (e) => {
        if (!trackId) return;
        const param = knob.dataset.param;
        if (!param) return;
        scdaw.setLiveTrackParam?.(trackId, {
          params: { [param]: e.detail.value },
        });
      });
      knob.addEventListener("change", (e) => {
        if (!trackId) return;
        const param = knob.dataset.param;
        if (!param) return;
        if (typeof scdaw.commitLiveTrackParam === "function") {
          scdaw.setLiveTrackParam?.(trackId, {
            params: { [param]: e.detail.value },
          });
          scdaw.commitLiveTrackParam(trackId);
        } else {
          scdaw.sendCommand("set_track", {
            trackId,
            params: { [param]: e.detail.value },
          });
        }
      });
      knob.addEventListener("reset", () => {
        if (!trackId) return;
        const param = knob.dataset.param;
        if (!param) return;
        scdaw.sendCommand("reset_param", {
          scope: "synth",
          trackId,
          param,
        });
      });
    });

    // Select & toggle & text parameter bindings
    this.shadowRoot.querySelectorAll("[data-param-select]").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        if (!trackId) return;
        scdaw.sendCommand("set_track", {
          trackId,
          params: { [sel.dataset.paramSelect]: e.target.value },
        });
      });
    });
    this.shadowRoot.querySelectorAll("[data-param-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!trackId) return;
        const current = btn.getAttribute("aria-pressed") === "true";
        scdaw.sendCommand("set_track", {
          trackId,
          params: { [btn.dataset.paramToggle]: !current },
        });
      });
    });
    this.shadowRoot.querySelectorAll("[data-param-text]").forEach((inp) => {
      inp.addEventListener("change", (e) => {
        if (!trackId) return;
        scdaw.sendCommand("set_track", {
          trackId,
          params: { [inp.dataset.paramText]: e.target.value },
        });
      });
    });

    // Step parameter locks
    this.shadowRoot
      .getElementById("synth-lock-step")
      ?.addEventListener("change", (e) => {
        this._lockStep = Number(e.target.value) || 0;
        this.render();
      });
    this.shadowRoot
      .getElementById("synth-lock-param")
      ?.addEventListener("change", (e) => {
        this._lockParam = e.target.value || "cutoff";
      });
    this.shadowRoot
      .getElementById("synth-lock-apply-btn")
      ?.addEventListener("click", () => {
        if (!trackId) return;
        const valInput = this.shadowRoot.getElementById("synth-lock-value");
        const val = Number(valInput?.value ?? 0);
        scdaw.sendCommand("set_step_lock", {
          trackId,
          step: this._lockStep,
          param: this._lockParam,
          value: val,
        });
      });
    this.shadowRoot
      .getElementById("synth-lock-clear-btn")
      ?.addEventListener("click", () => {
        if (!trackId) return;
        scdaw.sendCommand("set_step_lock", {
          trackId,
          step: this._lockStep,
          clear: true,
        });
      });

    // DX7 .syx librarian
    const syxInput = this.shadowRoot.getElementById("synth-syx-input");
    this.shadowRoot
      .getElementById("synth-syx-import-btn")
      ?.addEventListener("click", () => syxInput?.click());

    syxInput?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const buf = await file.arrayBuffer();
        const voices = parseDx7Sysex(buf);
        this._syxVoices = voices;
        this._syxStatus = `Loaded ${voices.length} DX7 voice(s) from ${file.name}.`;
        if (voices[0] && trackId) {
          await scdaw.sendCommand("set_instrument", {
            trackId,
            instrument: "tubular",
            params: voices[0].params,
          });
        }
      } catch (err) {
        this._syxStatus = `SysEx import failed: ${err.message}`;
      } finally {
        syxInput.value = "";
        this.render();
      }
    });

    this.shadowRoot
      .getElementById("synth-syx-voice-select")
      ?.addEventListener("change", async (e) => {
        const idx = Number(e.target.value);
        const voice = this._syxVoices[idx];
        if (!voice || !trackId) return;
        this._syxStatus = `Active cartridge voice: ${voice.name} (Alg ${voice.algorithm})`;
        await scdaw.sendCommand("set_instrument", {
          trackId,
          instrument: "tubular",
          params: voice.params,
        });
      });

    this.shadowRoot
      .getElementById("synth-syx-export-btn")
      ?.addEventListener("click", () => {
        const bytes = encodeDx7SysexVoice(
          track?.params || {},
          track?.params?.patchName || track?.name || "SCDAW FM",
        );
        if (
          typeof Blob !== "undefined" &&
          typeof URL !== "undefined" &&
          typeof URL.createObjectURL === "function" &&
          typeof document !== "undefined"
        ) {
          const blob = new Blob([bytes], { type: "application/octet-stream" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${(track?.params?.patchName || track?.name || "tubular").replace(/[^a-zA-Z0-9_-]/g, "_")}.syx`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        this._syxStatus = `Exported ${bytes.length}-byte DX7 .syx voice.`;
        this.render();
      });
  }
}

if (
  typeof customElements !== "undefined" &&
  !customElements.get("scdaw-synth")
) {
  customElements.define("scdaw-synth", DawSynthElement);
}
