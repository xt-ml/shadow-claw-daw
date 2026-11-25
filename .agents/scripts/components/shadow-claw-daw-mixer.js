/**
 * .agents/scripts/components/shadow-claw-daw-mixer.js
 *
 * Mixing Console & Channel Strips Web Component (<shadow-claw-daw-mixer>).
 * Ported concepts from openDAW Mixer, ChannelStrip, and PeakMeter.
 */

import { SHARED_STYLES } from "./shadow-claw-daw-styles.js";
import { scdaw } from "../scdaw-engine.js";
import { effect } from "../scdaw-signals.js";
import "./shadow-claw-daw-knob.js";

import {
  BaseElement,
  defineElement,
} from "shadow-claw/components/shadow-claw-element";

export function computeMeterSegments(peakDb, numSegments = 12) {
  if (peakDb <= -60) {
    return { litCount: 0, isClipping: false };
  }
  // Range: -48 dB to 0 dB
  const minDb = -48;
  const maxDb = 0;
  const norm = Math.max(0, Math.min(1, (peakDb - minDb) / (maxDb - minDb)));
  const litCount = Math.round(norm * numSegments);
  const isClipping = peakDb > 0.0;
  return { litCount, isClipping };
}

export function formatDb(db) {
  if (db <= -70) return "-∞ dB";
  return `${db.toFixed(1)} dB`;
}

export function calculateSliderValueFromPointer({
  clientY,
  rect,
  min = 0,
  max = 100,
  padding = 8,
}) {
  if (!rect || rect.height <= 0) return min;
  const usableHeight =
    rect.height > padding * 2 ? rect.height - padding * 2 : rect.height;
  const y =
    rect.height > padding * 2
      ? rect.bottom - padding - clientY
      : rect.bottom - clientY;
  const norm = Math.max(0, Math.min(1, y / usableHeight));
  return Math.round(min + norm * (max - min));
}

export function calculateSliderValueFromWheel({
  currentValue,
  deltaY,
  min = 0,
  max = 100,
  step = 2,
  shiftKey = false,
}) {
  if (deltaY === 0)
    return Math.max(min, Math.min(max, Math.round(currentValue)));
  const direction = -Math.sign(deltaY);
  const effectiveStep = shiftKey ? Math.max(1, Math.round(step / 2)) : step;
  const nextVal = Math.round(currentValue + direction * effectiveStep);
  return Math.max(min, Math.min(max, nextVal));
}

export function shouldPreserveMixerDom({
  renderedTrackIds = [],
  targetTrackIds = [],
  hasContainer = false,
}) {
  if (!hasContainer) return false;
  if (renderedTrackIds.length !== targetTrackIds.length) return false;
  for (let i = 0; i < renderedTrackIds.length; i++) {
    if (renderedTrackIds[i] !== targetTrackIds[i]) return false;
  }
  return true;
}

export function setupVolumeSlider(
  slider,
  { onVolumeChange, onVolumeCommit, onReset },
) {
  if (!slider) return;

  const handlePointerDown = (e) => {
    slider._isDragging = true;
    try {
      slider.setPointerCapture?.(e.pointerId);
    } catch {}
    try {
      slider.focus?.();
    } catch {}

    const rect = slider.getBoundingClientRect?.() || null;
    const nextVal = calculateSliderValueFromPointer({
      clientY: e.clientY,
      rect,
      min: Number(slider.min || 0),
      max: Number(slider.max || 100),
    });
    slider.value = String(nextVal);
    onVolumeChange?.(nextVal);
    e.preventDefault?.();
  };

  const handlePointerMove = (e) => {
    if (!slider._isDragging) return;
    const rect = slider.getBoundingClientRect?.() || null;
    const nextVal = calculateSliderValueFromPointer({
      clientY: e.clientY,
      rect,
      min: Number(slider.min || 0),
      max: Number(slider.max || 100),
    });
    if (Number(slider.value) !== nextVal) {
      slider.value = String(nextVal);
      onVolumeChange?.(nextVal);
    }
  };

  const handlePointerUp = (e) => {
    if (slider._isDragging) {
      slider._isDragging = false;
      try {
        slider.releasePointerCapture?.(e.pointerId);
      } catch {}
      onVolumeCommit?.(Number(slider.value));
    }
  };

  const handleWheel = (e) => {
    e.preventDefault?.();
    const curVal = Number(slider.value || 0);
    const nextVal = calculateSliderValueFromWheel({
      currentValue: curVal,
      deltaY: e.deltaY,
      min: Number(slider.min || 0),
      max: Number(slider.max || 100),
      step: 2,
      shiftKey: Boolean(e.shiftKey),
    });
    if (curVal !== nextVal) {
      slider.value = String(nextVal);
      onVolumeChange?.(nextVal);
    }
  };

  const handleInput = (e) => {
    if (slider._isDragging) return;
    const val = Number(e.target.value);
    onVolumeChange?.(val);
  };

  const handleChange = (e) => {
    if (slider._isDragging) return;
    const val = Number(e.target.value);
    onVolumeCommit?.(val);
  };

  const handleDblClick = () => {
    onReset?.();
  };

  slider.addEventListener("pointerdown", handlePointerDown);
  slider.addEventListener("pointermove", handlePointerMove);
  slider.addEventListener("pointerup", handlePointerUp);
  slider.addEventListener("pointercancel", handlePointerUp);
  slider.addEventListener("wheel", handleWheel, { passive: false });
  slider.addEventListener("input", handleInput);
  slider.addEventListener("change", handleChange);
  slider.addEventListener("dblclick", handleDblClick);
}

export class ShadowClawDawMixer extends BaseElement {
  constructor() {
    super();
    if (this.attachShadow) {
      this.attachShadow({ mode: "open" });
    }
    this._rafId = null;
    this._renderedTrackIds = [];
    this._learnMode = false;
  }

  connectedCallback() {
    this.render();
    this._startMeterLoop();
    this._dispose = effect(() => {
      const p = scdaw.project.get();
      scdaw.selectedTrackId?.get();
      scdaw.liveRevision?.get?.();
      scdaw.midi?.state?.get?.();
      const currentTrackIds = p.tracks.map((t) => t.id);
      const hasContainer = Boolean(
        this.shadowRoot && this.shadowRoot.querySelector(".mixer-container"),
      );
      if (
        shouldPreserveMixerDom({
          renderedTrackIds: this._renderedTrackIds,
          targetTrackIds: currentTrackIds,
          hasContainer,
        })
      ) {
        this._syncProject(p);
      } else {
        this.render();
      }
    });
  }

  disconnectedCallback() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._dispose) this._dispose();
  }

  _startMeterLoop() {
    const update = () => {
      this._drawMeters();
      this._rafId = requestAnimationFrame(update);
    };
    this._rafId = requestAnimationFrame(update);
  }

  _drawMeters() {
    if (!this.shadowRoot) return;
    const levels = scdaw.getLevels();
    const canvases = this.shadowRoot.querySelectorAll(".meter-canvas");

    canvases.forEach((canvas) => {
      const id = canvas.dataset.track;
      const stat =
        id === "master"
          ? levels.master
          : levels.tracks[id] || { peakDb: -100, clipping: false };
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Draw background meter segments (14 ticks)
      const numSegments = 14;
      const segH = h / numSegments;
      const { litCount, isClipping } = computeMeterSegments(
        stat.peakDb,
        numSegments,
      );

      for (let i = 0; i < numSegments; i++) {
        const segY = h - (i + 1) * segH;
        const isLit = i < litCount;

        // Color ramp: green -> yellow -> red
        let color = "#1e293b";
        if (isLit) {
          if (i > 11) color = "#ef4444";
          else if (i > 8) color = "#eab308";
          else color = "#22c55e";
        }
        ctx.fillStyle = color;
        ctx.fillRect(1, segY + 1, w - 2, segH - 2);
      }

      if (isClipping || stat.clipping) {
        ctx.fillStyle = "#ff0000";
        ctx.fillRect(0, 0, w, 4);
      }
    });

    // Render Gain Reduction (GR) meters for compressor / maximizer
    this.shadowRoot.querySelectorAll(".gr-meter-canvas").forEach((canvas) => {
      const id = canvas.dataset.track;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
      ctx.fillRect(0, 0, w, h);

      const stat =
        id === "master" ? levels.master : levels.tracks[id] || { peakDb: -100 };
      let grDb = 0;
      if (stat.peakDb > -6) {
        grDb = Math.min(12, (stat.peakDb + 6) * 1.5);
      }
      if (grDb > 0.1) {
        const grH = Math.min(h, (grDb / 12) * h);
        ctx.fillStyle = "#f97316";
        ctx.fillRect(0, 0, w, grH);
      }
    });
  }

  _syncProject(p) {
    if (!this.shadowRoot) return;

    const selectedId = scdaw.selectedTrackId?.get();
    for (const t of p.tracks) {
      const strip = this.shadowRoot.querySelector(
        `.strip[data-track="${t.id}"]`,
      );
      if (!strip) continue;
      strip.classList.toggle("strip--selected", t.id === selectedId);

      const nameEl = strip.querySelector(".strip-name");
      if (nameEl && nameEl.textContent !== t.name) {
        nameEl.textContent = t.name;
      }

      const knob = strip.querySelector("shadow-claw-daw-knob");
      if (knob && !knob._isDragging && knob.value !== (t.pan || 0)) {
        knob.value = t.pan || 0;
      }

      const slider = strip.querySelector(".track-vol");
      if (slider && !slider._isDragging) {
        const expected = String(Math.round(t.volume * 100));
        if (slider.value !== expected) {
          slider.value = expected;
        }
      }

      const muteBtn = strip.querySelector(".mute-btn");
      if (muteBtn) {
        muteBtn.classList.toggle("btn-danger", Boolean(t.mute));
        muteBtn.setAttribute?.("aria-pressed", String(Boolean(t.mute)));
      }

      const soloBtn = strip.querySelector(".solo-btn");
      if (soloBtn) {
        soloBtn.classList.toggle("btn-primary", Boolean(t.solo));
        soloBtn.setAttribute?.("aria-pressed", String(Boolean(t.solo)));
      }
    }

    const masterFader = this.shadowRoot.getElementById("master-fader");
    if (masterFader && !masterFader._isDragging) {
      const expected = String(Math.round((p.master?.volume ?? 0.8) * 100));
      if (masterFader.value !== expected) {
        masterFader.value = expected;
      }
    }

    const badge = this.shadowRoot.querySelector(".daw-panel-header .badge");
    if (badge) {
      const expectedBadge = `${p.tracks.length + 1} Channels`;
      if (badge.textContent !== expectedBadge) {
        badge.textContent = expectedBadge;
      }
    }

    this._syncLearnButton();
  }

  _syncLearnButton() {
    const learnBtn = this.shadowRoot?.getElementById("mixer-learn-btn");
    if (!learnBtn) return;
    const learning = scdaw.midi?.state?.get?.()?.learning;
    const active = Boolean(this._learnMode || learning?.active);
    learnBtn.classList?.toggle?.("btn-primary", active);
    learnBtn.setAttribute?.("aria-pressed", String(active));
    learnBtn.textContent = learning?.active
      ? `🎯 Learn: ${learning.target?.param || "CC"}...`
      : this._learnMode
        ? "🎯 Click Control..."
        : "🎯 Learn";
  }

  render() {
    if (!this.shadowRoot) return;
    const p = scdaw.getProject();
    this._renderedTrackIds = p.tracks.map((t) => t.id);
    const learning = scdaw.midi?.state?.get?.()?.learning;
    const learnActive = Boolean(this._learnMode || learning?.active);
    const learnLabel = learning?.active
      ? `🎯 Learn: ${learning.target?.param || "CC"}...`
      : this._learnMode
        ? "🎯 Click Control..."
        : "🎯 Learn";

    this.shadowRoot.innerHTML = `
      <style>
        ${SHARED_STYLES}
        :host {
          display: block;
          width: 100%;
          box-sizing: border-box;
          container-type: inline-size;
          container-name: shadow-claw-daw-mixer;
        }
        /* Mobile-First Base Styles (Compact Dock & Mobile Viewports) */
        .scdaw-mixer__channels,
        .mixer-container {
          display: flex;
          gap: 0.4rem;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          touch-action: pan-x;
          overscroll-behavior-x: contain;
          padding: 0.5rem;
          align-items: stretch;
          background: rgba(0, 0, 0, 0.2);
          box-sizing: border-box;
        }
        .scdaw-mixer__strip,
        .strip {
          flex: 1 0 76px;
          width: 76px;
          min-width: 72px;
          max-width: 110px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 0.4rem 0.3rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.35rem;
          box-sizing: border-box;
          cursor: pointer;
          transition: border-color 0.12s ease;
        }
        .strip--selected {
          border-color: var(--accent);
          box-shadow: 0 0 0 1px rgba(128, 212, 219, 0.35);
        }
        .scdaw-mixer__strip-name,
        .strip-name {
          font-size: 0.7rem;
          font-weight: 700;
          text-overflow: ellipsis;
          overflow: hidden;
          white-space: nowrap;
          max-width: 100%;
        }
        .meter-fader-row {
          display: flex;
          gap: 6px;
          align-items: center;
          height: 124px;
        }
        .vol-slider {
          writing-mode: vertical-lr;
          direction: rtl;
          height: 114px;
          width: 28px;
          cursor: ns-resize;
          touch-action: none;
          user-select: none;
          -webkit-user-select: none;
        }
        .meter-canvas {
          width: 12px;
          height: 114px;
          background: #090e10;
          border-radius: 2px;
          border: 1px solid var(--border-subtle);
        }

        /* Progressive Enhancement: Wide Mixer Console / Full View (>= 420px) */
        @container shadow-claw-daw-mixer (min-width: 420px) {
          .scdaw-mixer__channels,
          .mixer-container {
            gap: 0.75rem;
            padding: 0.75rem;
          }
          .scdaw-mixer__strip,
          .strip {
            flex: 0 0 105px;
            width: 105px;
            min-width: 95px;
            padding: 0.5rem;
            gap: 0.4rem;
          }
          .scdaw-mixer__strip-name,
          .strip-name {
            font-size: 0.72rem;
            max-width: 90px;
          }
          .meter-fader-row {
            gap: 8px;
            height: 130px;
          }
          .vol-slider {
            height: 120px;
            width: 32px;
          }
          .meter-canvas {
            width: 14px;
            height: 120px;
          }
        }

        @supports not (container-type: inline-size) {
          @media (min-width: 420px) {
            .scdaw-mixer__channels,
            .mixer-container {
              gap: 0.75rem;
              padding: 0.75rem;
            }
            .scdaw-mixer__strip,
            .strip {
              flex: 0 0 105px;
              width: 105px;
              min-width: 95px;
              padding: 0.5rem;
              gap: 0.4rem;
            }
          }
        }

        @media (pointer: coarse) {
          .mute-btn,
          .solo-btn,
          .reset-track-btn {
            min-width: 36px;
            min-height: 36px;
          }
          .vol-slider {
            width: 44px;
          }
        }
      </style>
      <div class="daw-panel" role="region" aria-label="Mixer Console">
        <div class="daw-panel-header">
          <span>🎛 Mixer Console</span>
          <div style="display:flex;align-items:center;gap:0.4rem;">
            <button id="mixer-learn-btn" type="button" class="btn btn-icon ${learnActive ? "btn-primary" : ""}" aria-pressed="${learnActive}" aria-label="Toggle MIDI Learn mode" title="Click then touch any mixer control (or right-click any control) to map a MIDI CC">${learnLabel}</button>
            <span class="badge">${p.tracks.length + 1} Channels</span>
          </div>
        </div>
        <div class="mixer-container">
          ${p.tracks
            .map((t) => {
              const isSelected = scdaw.selectedTrackId?.get() === t.id;
              const kindIcon =
                t.kind === "drums" ? "🥁" : t.kind === "audio" ? "🎙️" : "🎹";
              const sendsHtml =
                Array.isArray(t.sends) && t.sends.length > 0
                  ? `
                <div class="scdaw-mixer__sends-list" style="display:flex; flex-direction:column; gap:2px; width:100%; font-size:0.6rem; margin-top:2px;" aria-label="Sends">
                  ${t.sends
                    .map((s) => {
                      const tgt = p.tracks.find(
                        (x) => x.id === s.targetTrackId,
                      );
                      const tgtName = tgt ? tgt.name : "Aux";
                      return `<div style="display:flex; justify-content:space-between; color:var(--accent); font-family:var(--mono); text-overflow:ellipsis; overflow:hidden; white-space:nowrap;" title="Send to ${tgtName}: ${Math.round(s.level * 100)}%"><span>→${tgtName.slice(0, 4)}:</span><span>${Math.round(s.level * 100)}%</span></div>`;
                    })
                    .join("")}
                </div>
              `
                  : "";

              const hasDynamics =
                Array.isArray(t.fx) &&
                t.fx.some(
                  (f) =>
                    f.type === "compressor" ||
                    f.type === "maximizer" ||
                    f.type === "sidechain",
                );

              return `
            <div class="strip ${isSelected ? "strip--selected" : ""}" role="group" aria-label="${t.name} channel strip" data-track="${t.id}">
              <div class="strip-name" title="${t.name}">${kindIcon} ${t.name}</div>
              <shadow-claw-daw-knob label="Pan" min="-1" max="1" unit="pan" value="${t.pan || 0}" default="0" data-track="${t.id}"></shadow-claw-daw-knob>
              <div class="meter-fader-row">
                <div style="display:flex; gap:2px; height:110px;">
                  <canvas class="meter-canvas" data-track="${t.id}" width="12" height="110"></canvas>
                  ${hasDynamics ? `<canvas class="gr-meter-canvas" data-track="${t.id}" width="5" height="110" title="Gain Reduction"></canvas>` : ""}
                </div>
                <input type="range" class="vol-slider track-vol" aria-label="${t.name} volume" data-track="${t.id}" min="0" max="150" value="${Math.round(t.volume * 100)}" title="Volume (Double-click to reset)" />
              </div>
              ${sendsHtml}
              <div style="display:flex; gap:3px;">
                <button type="button" class="btn btn-icon ${t.mute ? "btn-danger" : ""} mute-btn" data-track="${t.id}" aria-label="Mute ${t.name}" aria-pressed="${Boolean(t.mute)}">M</button>
                <button type="button" class="btn btn-icon ${t.solo ? "btn-primary" : ""} solo-btn" data-track="${t.id}" aria-label="Solo ${t.name}" aria-pressed="${Boolean(t.solo)}">S</button>
                <button type="button" class="btn btn-icon reset-track-btn" data-track="${t.id}" aria-label="Reset ${t.name} channel strip" title="Reset Strip">🔄</button>
              </div>
            </div>
          `;
            })
            .join("")}

          <!-- Master Strip -->
          <div class="strip" role="group" aria-label="Master channel strip" style="border-left: 2px solid var(--accent); margin-left: auto;">
            <div class="strip-name" style="color:var(--accent);">MASTER</div>
            <div style="height:28px;"></div>
            <div class="meter-fader-row">
              <div style="display:flex; gap:2px; height:110px;">
                <canvas class="meter-canvas" data-track="master" width="12" height="110"></canvas>
                <canvas class="gr-meter-canvas" data-track="master" width="5" height="110" title="Master Limiter Gain Reduction"></canvas>
              </div>
              <input type="range" id="master-fader" class="vol-slider" aria-label="Master volume" min="0" max="100" value="${Math.round((p.master.volume ?? 0.8) * 100)}" title="Master Volume (Double-click to reset)" />
            </div>
            <div style="font-size:0.65rem; font-family:var(--mono); color:var(--accent); margin-top:auto;">0 dBFS</div>
          </div>
        </div>
      </div>
    `;

    const armLearn = (target) => {
      this._learnMode = false;
      scdaw.midi?.startMidiLearn?.({
        channel: "omni",
        ...target,
      });
      this._syncLearnButton();
    };

    const learnBtn = this.shadowRoot.getElementById("mixer-learn-btn");
    if (learnBtn) {
      learnBtn.addEventListener("click", (e) => {
        e.stopPropagation?.();
        if (scdaw.midi?.state?.get?.()?.learning?.active) {
          scdaw.midi.cancelMidiLearn();
          this._learnMode = false;
        } else {
          this._learnMode = !this._learnMode;
        }
        this._syncLearnButton();
      });
    }

    // Selecting a channel strip updates global selectedTrackId
    this.shadowRoot.querySelectorAll(".strip[data-track]").forEach((strip) => {
      strip.addEventListener("click", (e) => {
        if (e.target.closest?.("button, input, shadow-claw-daw-knob")) return;
        const id = strip.dataset.track;
        if (id && typeof scdaw.selectTrack === "function") {
          scdaw.selectTrack(id);
        }
      });
    });

    // Sliders & Knobs
    this.shadowRoot.querySelectorAll(".track-vol").forEach((s) => {
      const id = s.dataset.track;
      const learnTarget = {
        trackId: id,
        param: "volume",
        min: 0,
        max: 1.5,
        scaling: "linear",
        mode: "continuous",
      };
      s.addEventListener("contextmenu", (e) => {
        e.preventDefault?.();
        e.stopPropagation?.();
        armLearn(learnTarget);
      });
      s.addEventListener("click", (e) => {
        if (!this._learnMode) return;
        e.preventDefault?.();
        e.stopPropagation?.();
        armLearn(learnTarget);
      });
      setupVolumeSlider(s, {
        onVolumeChange: (val) => {
          if (this._learnMode) return;
          if (typeof scdaw.setLiveTrackParam === "function") {
            scdaw.setLiveTrackParam(id, { volume: val / 100 });
          } else {
            scdaw.sendCommand("set_track", { trackId: id, volume: val / 100 });
          }
        },
        onVolumeCommit: (val) => {
          if (this._learnMode) return;
          if (typeof scdaw.commitLiveTrackParam === "function") {
            scdaw.commitLiveTrackParam(id);
          } else {
            scdaw.sendCommand("set_track", { trackId: id, volume: val / 100 });
          }
        },
        onReset: () => {
          scdaw.sendCommand("reset_param", {
            scope: "track",
            trackId: id,
            param: "volume",
          });
        },
      });
    });

    this.shadowRoot.querySelectorAll("shadow-claw-daw-knob").forEach((k) => {
      const learnTarget = () => ({
        trackId: k.dataset.track,
        param: "pan",
        min: -1,
        max: 1,
        scaling: "linear",
        mode: "continuous",
      });
      k.addEventListener("contextmenu", (e) => {
        e.preventDefault?.();
        e.stopPropagation?.();
        armLearn(learnTarget());
      });
      k.addEventListener("click", (e) => {
        if (!this._learnMode) return;
        e.preventDefault?.();
        e.stopPropagation?.();
        armLearn(learnTarget());
      });
      k.addEventListener("input", (e) => {
        if (this._learnMode) return;
        const id = k.dataset.track;
        if (typeof scdaw.setLiveTrackParam === "function") {
          scdaw.setLiveTrackParam(id, { pan: e.detail.value });
        }
      });
      k.addEventListener("change", (e) => {
        if (this._learnMode) return;
        const id = k.dataset.track;
        if (typeof scdaw.commitLiveTrackParam === "function") {
          scdaw.setLiveTrackParam?.(id, { pan: e.detail.value });
          scdaw.commitLiveTrackParam(id);
        } else {
          scdaw.sendCommand("set_track", { trackId: id, pan: e.detail.value });
        }
      });
      k.addEventListener("reset", (e) => {
        const id = k.dataset.track;
        scdaw.sendCommand("reset_param", {
          scope: "track",
          trackId: id,
          param: "pan",
        });
      });
    });

    // Mute/Solo/Reset
    this.shadowRoot.querySelectorAll(".mute-btn").forEach((b) => {
      const getTarget = (e) => ({
        trackId: b.dataset.track || e?.target?.dataset?.track,
        param: "mute",
        min: 0,
        max: 1,
        mode: "toggle",
      });
      b.addEventListener("contextmenu", (e) => {
        e.preventDefault?.();
        e.stopPropagation?.();
        armLearn(getTarget(e));
      });
      b.addEventListener("click", (e) => {
        e.stopPropagation?.();
        const id = b.dataset.track || e.target?.dataset?.track;
        if (this._learnMode) {
          e.preventDefault?.();
          armLearn({
            trackId: id,
            param: "mute",
            min: 0,
            max: 1,
            mode: "toggle",
          });
          return;
        }
        const currentProj = scdaw.getProject();
        const trk = currentProj.tracks.find((t) => t.id === id);
        if (trk)
          scdaw.sendCommand("set_track", { trackId: id, mute: !trk.mute });
      });
    });

    this.shadowRoot.querySelectorAll(".solo-btn").forEach((b) => {
      const getTarget = (e) => ({
        trackId: b.dataset.track || e?.target?.dataset?.track,
        param: "solo",
        min: 0,
        max: 1,
        mode: "toggle",
      });
      b.addEventListener("contextmenu", (e) => {
        e.preventDefault?.();
        e.stopPropagation?.();
        armLearn(getTarget(e));
      });
      b.addEventListener("click", (e) => {
        e.stopPropagation?.();
        const id = b.dataset.track || e.target?.dataset?.track;
        if (this._learnMode) {
          e.preventDefault?.();
          armLearn({
            trackId: id,
            param: "solo",
            min: 0,
            max: 1,
            mode: "toggle",
          });
          return;
        }
        const currentProj = scdaw.getProject();
        const trk = currentProj.tracks.find((t) => t.id === id);
        if (trk)
          scdaw.sendCommand("set_track", { trackId: id, solo: !trk.solo });
      });
    });

    this.shadowRoot.querySelectorAll(".reset-track-btn").forEach((b) => {
      b.addEventListener("click", (e) => {
        e.stopPropagation?.();
        const id = b.dataset.track || e.target?.dataset?.track;
        scdaw.sendCommand("reset_track", { trackId: id, mode: "mixer" });
      });
    });

    // Master fader
    const masterFader = this.shadowRoot.getElementById("master-fader");
    if (masterFader) {
      const masterTarget = {
        trackId: "master",
        param: "volume",
        min: 0,
        max: 1,
        scaling: "linear",
        mode: "continuous",
      };
      masterFader.addEventListener("contextmenu", (e) => {
        e.preventDefault?.();
        e.stopPropagation?.();
        armLearn(masterTarget);
      });
      masterFader.addEventListener("click", (e) => {
        if (!this._learnMode) return;
        e.preventDefault?.();
        e.stopPropagation?.();
        armLearn(masterTarget);
      });
      setupVolumeSlider(masterFader, {
        onVolumeChange: (val) => {
          if (this._learnMode) return;
          if (typeof scdaw.setLiveMasterParam === "function") {
            scdaw.setLiveMasterParam({ volume: val / 100 });
          } else {
            scdaw.sendCommand("set_master", { volume: val / 100 });
          }
        },
        onVolumeCommit: (val) => {
          if (this._learnMode) return;
          if (typeof scdaw.commitLiveMasterParam === "function") {
            scdaw.commitLiveMasterParam();
          } else {
            scdaw.sendCommand("set_master", { volume: val / 100 });
          }
        },
        onReset: () => {
          scdaw.sendCommand("reset_param", {
            scope: "master",
            param: "volume",
          });
        },
      });
    }

    // Fader row wheel delegation (allows scrolling over meter canvas or row)
    this.shadowRoot.querySelectorAll(".meter-fader-row").forEach((row) => {
      row.addEventListener(
        "wheel",
        (e) => {
          const slider = row.querySelector(".vol-slider");
          if (!slider || e.target === slider) return;
          e.preventDefault?.();
          const curVal = Number(slider.value || 0);
          const nextVal = calculateSliderValueFromWheel({
            currentValue: curVal,
            deltaY: e.deltaY,
            min: Number(slider.min || 0),
            max: Number(slider.max || 100),
            step: 2,
            shiftKey: Boolean(e.shiftKey),
          });
          if (curVal !== nextVal) {
            slider.value = String(nextVal);
            if (slider.id === "master-fader") {
              if (typeof scdaw.setLiveMasterParam === "function") {
                scdaw.setLiveMasterParam({ volume: nextVal / 100 });
                scdaw.commitLiveMasterParam?.();
              } else {
                scdaw.sendCommand("set_master", { volume: nextVal / 100 });
              }
            } else if (slider.dataset.track) {
              if (typeof scdaw.setLiveTrackParam === "function") {
                scdaw.setLiveTrackParam(slider.dataset.track, {
                  volume: nextVal / 100,
                });
                scdaw.commitLiveTrackParam?.(slider.dataset.track);
              } else {
                scdaw.sendCommand("set_track", {
                  trackId: slider.dataset.track,
                  volume: nextVal / 100,
                });
              }
            }
          }
        },
        { passive: false },
      );
    });
  }
}

defineElement("shadow-claw-daw-mixer", ShadowClawDawMixer);
