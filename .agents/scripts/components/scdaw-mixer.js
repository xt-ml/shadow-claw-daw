/**
 * .agents/scripts/components/scdaw-mixer.js
 *
 * Mixing Console & Channel Strips Web Component (<scdaw-mixer>).
 * Ported concepts from openDAW Mixer, ChannelStrip, and PeakMeter.
 */

import { SHARED_STYLES } from "./scdaw-styles.js";
import { scdaw } from "../scdaw-engine.js";
import { effect } from "../scdaw-signals.js";
import "./scdaw-knob.js";

const BaseElement = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

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

export function setupVolumeSlider(slider, { onVolumeChange, onReset }) {
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
    const val = Number(e.target.value);
    onVolumeChange?.(val);
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
  slider.addEventListener("dblclick", handleDblClick);
}

export class DawMixerElement extends BaseElement {
  constructor() {
    super();
    if (this.attachShadow) {
      this.attachShadow({ mode: "open" });
    }
    this._rafId = null;
    this._renderedTrackIds = [];
  }

  connectedCallback() {
    this.render();
    this._startMeterLoop();
    this._dispose = effect(() => {
      const p = scdaw.project.get();
      scdaw.selectedTrackId?.get();
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

      const knob = strip.querySelector("scdaw-knob");
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
      }

      const soloBtn = strip.querySelector(".solo-btn");
      if (soloBtn) {
        soloBtn.classList.toggle("btn-primary", Boolean(t.solo));
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
  }

  render() {
    if (!this.shadowRoot) return;
    const p = scdaw.getProject();
    this._renderedTrackIds = p.tracks.map((t) => t.id);

    this.shadowRoot.innerHTML = `
      <style>
        ${SHARED_STYLES}
        :host {
          display: block;
          width: 100%;
          box-sizing: border-box;
          container-type: inline-size;
          container-name: scdaw-mixer;
        }
        .mixer-container {
          display: flex;
          gap: 0.75rem;
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          touch-action: pan-x;
          overscroll-behavior-x: contain;
          padding: 0.75rem;
          align-items: stretch;
          background: rgba(0, 0, 0, 0.2);
          box-sizing: border-box;
        }
        .strip {
          width: 105px;
          min-width: 95px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 0.5rem;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.4rem;
          box-sizing: border-box;
          cursor: pointer;
          transition: border-color 0.12s ease;
        }
        .strip--selected {
          border-color: var(--accent);
          box-shadow: 0 0 0 1px rgba(128, 212, 219, 0.35);
        }
        .strip-name {
          font-size: 0.72rem;
          font-weight: 700;
          text-overflow: ellipsis;
          overflow: hidden;
          white-space: nowrap;
          max-width: 90px;
        }
        .meter-fader-row {
          display: flex;
          gap: 8px;
          align-items: center;
          height: 130px;
        }
        .vol-slider {
          writing-mode: vertical-lr;
          direction: rtl;
          height: 120px;
          width: 32px;
          cursor: ns-resize;
          touch-action: none;
          user-select: none;
          -webkit-user-select: none;
        }
        .meter-canvas {
          width: 14px;
          height: 120px;
          background: #090e10;
          border-radius: 2px;
          border: 1px solid var(--border-subtle);
        }

        @container scdaw-mixer (max-width: 480px) {
          .mixer-container {
            gap: 0.5rem;
            padding: 0.5rem;
          }
          .strip {
            width: 88px;
            min-width: 88px;
            padding: 0.4rem;
          }
        }
      </style>
      <div class="daw-panel">
        <div class="daw-panel-header">
          <span>🎛 Mixer Console</span>
          <span class="badge">${p.tracks.length + 1} Channels</span>
        </div>
        <div class="mixer-container">
          ${p.tracks
            .map((t) => {
              const isSelected = scdaw.selectedTrackId?.get() === t.id;
              return `
            <div class="strip ${isSelected ? "strip--selected" : ""}" data-track="${t.id}">
              <div class="strip-name">${t.name}</div>
              <scdaw-knob label="Pan" min="-1" max="1" unit="pan" value="${t.pan || 0}" default="0" data-track="${t.id}"></scdaw-knob>
              <div class="meter-fader-row">
                <canvas class="meter-canvas" data-track="${t.id}" width="14" height="110"></canvas>
                <input type="range" class="vol-slider track-vol" data-track="${t.id}" min="0" max="150" value="${Math.round(t.volume * 100)}" title="Volume (Double-click to reset)" />
              </div>
              <div style="display:flex; gap:3px;">
                <button class="btn btn-icon ${t.mute ? "btn-danger" : ""} mute-btn" data-track="${t.id}">M</button>
                <button class="btn btn-icon ${t.solo ? "btn-primary" : ""} solo-btn" data-track="${t.id}">S</button>
                <button class="btn btn-icon reset-track-btn" data-track="${t.id}" title="Reset Strip">🔄</button>
              </div>
            </div>
          `;
            })
            .join("")}

          <!-- Master Strip -->
          <div class="strip" style="border-left: 2px solid var(--accent); margin-left: auto;">
            <div class="strip-name" style="color:var(--accent);">MASTER</div>
            <div style="height:28px;"></div>
            <div class="meter-fader-row">
              <canvas class="meter-canvas" data-track="master" width="14" height="110"></canvas>
              <input type="range" id="master-fader" class="vol-slider" min="0" max="100" value="${Math.round((p.master.volume ?? 0.8) * 100)}" title="Master Volume (Double-click to reset)" />
            </div>
            <div style="font-size:0.65rem; font-family:var(--mono); color:var(--accent); margin-top:auto;">0 dBFS</div>
          </div>
        </div>
      </div>
    `;

    // Selecting a channel strip updates global selectedTrackId
    this.shadowRoot.querySelectorAll(".strip[data-track]").forEach((strip) => {
      strip.addEventListener("click", (e) => {
        if (e.target.closest?.("button")) return;
        const id = strip.dataset.track;
        if (id && typeof scdaw.selectTrack === "function") {
          scdaw.selectTrack(id);
        }
      });
    });

    // Sliders & Knobs
    this.shadowRoot.querySelectorAll(".track-vol").forEach((s) => {
      const id = s.dataset.track;
      setupVolumeSlider(s, {
        onVolumeChange: (val) => {
          scdaw.sendCommand("set_track", { trackId: id, volume: val / 100 });
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

    this.shadowRoot.querySelectorAll("scdaw-knob").forEach((k) => {
      k.addEventListener("change", (e) => {
        const id = k.dataset.track;
        scdaw.sendCommand("set_track", { trackId: id, pan: e.detail.value });
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
      b.addEventListener("click", (e) => {
        const id = e.target.dataset.track;
        const trk = p.tracks.find((t) => t.id === id);
        if (trk)
          scdaw.sendCommand("set_track", { trackId: id, mute: !trk.mute });
      });
    });

    this.shadowRoot.querySelectorAll(".solo-btn").forEach((b) => {
      b.addEventListener("click", (e) => {
        const id = e.target.dataset.track;
        const trk = p.tracks.find((t) => t.id === id);
        if (trk)
          scdaw.sendCommand("set_track", { trackId: id, solo: !trk.solo });
      });
    });

    this.shadowRoot.querySelectorAll(".reset-track-btn").forEach((b) => {
      b.addEventListener("click", (e) => {
        const id = e.target.dataset.track;
        scdaw.sendCommand("reset_track", { trackId: id, mode: "mixer" });
      });
    });

    // Master fader
    const masterFader = this.shadowRoot.getElementById("master-fader");
    if (masterFader) {
      setupVolumeSlider(masterFader, {
        onVolumeChange: (val) => {
          scdaw.sendCommand("set_master", { volume: val / 100 });
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
              scdaw.sendCommand("set_master", { volume: nextVal / 100 });
            } else if (slider.dataset.track) {
              scdaw.sendCommand("set_track", {
                trackId: slider.dataset.track,
                volume: nextVal / 100,
              });
            }
          }
        },
        { passive: false },
      );
    });
  }
}

if (
  typeof customElements !== "undefined" &&
  !customElements.get("scdaw-mixer")
) {
  customElements.define("scdaw-mixer", DawMixerElement);
}
