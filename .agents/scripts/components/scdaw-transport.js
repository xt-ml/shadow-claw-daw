/**
 * .agents/scripts/components/scdaw-transport.js
 *
 * Header Transport Bar Web Component (<scdaw-transport>).
 * Ported concepts from openDAW TransportGroup & OpenStudio TransportBar.
 * Redesigned Mobile-First, Responsive, BEM, and ARIA compliant.
 */

import { SHARED_STYLES } from "./scdaw-styles.js";
import { scdaw } from "../scdaw-engine.js";
import { effect } from "../scdaw-signals.js";
import { PPQN } from "../scdaw.js";

const BaseElement = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

/**
 * Checks whether starting recording on a track at a specific beat position
 * would collide with existing audio clips and therefore warrant prompting the user.
 *
 * @param {Object} options
 * @param {Object} [options.targetTrack] - Audio track to evaluate
 * @param {number} [options.currentBeat=0] - Playhead beat position
 * @returns {boolean} True if an existing clip overlaps currentBeat
 */
export function shouldPromptRecordOptions({ targetTrack, currentBeat = 0 }) {
  if (!targetTrack || targetTrack.kind !== "audio") return false;
  if (
    !Array.isArray(targetTrack.audioClips) ||
    targetTrack.audioClips.length === 0
  )
    return false;
  return targetTrack.audioClips.some((c) => {
    const start = Number(c.time || 0);
    const end = start + Number(c.duration || 4);
    return currentBeat >= start && currentBeat < end;
  });
}

export function formatPosition(bar = 1, beat = 1, step = 0) {
  const padBar = String(bar).padStart(3, "0");
  const subStep = (step % 4) + 1;
  return `${padBar} : ${beat} : ${subStep}`;
}

export function calculateTransportWheelValue({
  currentValue,
  deltaY,
  min = 0,
  max = 100,
  step = 1,
  shiftMultiplier = 5,
  shiftKey = false,
}) {
  if (deltaY === 0) {
    return Math.max(min, Math.min(max, Math.round(currentValue)));
  }
  const direction = -Math.sign(deltaY);
  const effectiveStep = shiftKey ? step * shiftMultiplier : step;
  const nextVal = Math.round(currentValue + direction * effectiveStep);
  return Math.max(min, Math.min(max, nextVal));
}

export function calculateBpmDragValue({
  startY,
  currentY,
  startValue = 120,
  min = 40,
  max = 240,
  pixelsPerUnit = 2,
  shiftKey = false,
  shiftMultiplier = 0.2,
}) {
  if (typeof startY !== "number" || typeof currentY !== "number") {
    return Math.max(min, Math.min(max, Math.round(startValue)));
  }
  const deltaY = startY - currentY;
  const rate = shiftKey
    ? (1 / pixelsPerUnit) * shiftMultiplier
    : 1 / pixelsPerUnit;
  const deltaValue = Math.round(deltaY * rate);
  const nextVal = Math.round(startValue + deltaValue);
  return Math.max(min, Math.min(max, nextVal));
}

export function setupBpmDragControl({
  bpmInput,
  bpmContainer,
  onBpmChange,
  pixelsPerUnit = 2,
}) {
  if (!bpmInput) return () => {};
  const target = bpmContainer || bpmInput;

  let isDragging = false;
  let startY = 0;
  let startBpm = Number(bpmInput.value || 120);
  let hasMoved = false;

  const handlePointerDown = (e) => {
    isDragging = true;
    hasMoved = false;
    startY = e.clientY;
    startBpm = Number(bpmInput.value || 120);
    try {
      target.setPointerCapture?.(e.pointerId);
    } catch {}
  };

  const handlePointerMove = (e) => {
    if (!isDragging) return;
    const deltaY = startY - e.clientY;
    if (Math.abs(deltaY) >= 2) {
      hasMoved = true;
    }
    if (hasMoved) {
      e.preventDefault?.();
      const min = Number(bpmInput.min || 40);
      const max = Number(bpmInput.max || 240);
      const nextBpm = calculateBpmDragValue({
        startY,
        currentY: e.clientY,
        startValue: startBpm,
        min,
        max,
        pixelsPerUnit,
        shiftKey: Boolean(e.shiftKey),
      });
      if (Number(bpmInput.value) !== nextBpm) {
        bpmInput.value = String(nextBpm);
        onBpmChange?.(nextBpm);
      }
    }
  };

  const handlePointerUp = (e) => {
    if (!isDragging) return;
    isDragging = false;
    try {
      target.releasePointerCapture?.(e.pointerId);
    } catch {}
    if (hasMoved) {
      e.preventDefault?.();
      bpmInput.blur?.();
    } else {
      bpmInput.focus?.();
      bpmInput.select?.();
    }
  };

  target.addEventListener("pointerdown", handlePointerDown);
  target.addEventListener("pointermove", handlePointerMove);
  target.addEventListener("pointerup", handlePointerUp);
  target.addEventListener("pointercancel", handlePointerUp);

  return () => {
    target.removeEventListener("pointerdown", handlePointerDown);
    target.removeEventListener("pointermove", handlePointerMove);
    target.removeEventListener("pointerup", handlePointerUp);
    target.removeEventListener("pointercancel", handlePointerUp);
  };
}

export function setupTransportWheelControls({
  bpmInput,
  swingInput,
  onBpmChange,
  onSwingChange,
}) {
  if (bpmInput) {
    bpmInput.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault?.();
        const curVal = Number(bpmInput.value || 120);
        const nextVal = calculateTransportWheelValue({
          currentValue: curVal,
          deltaY: e.deltaY,
          min: Number(bpmInput.min || 40),
          max: Number(bpmInput.max || 240),
          step: 1,
          shiftMultiplier: 5,
          shiftKey: Boolean(e.shiftKey),
        });
        if (curVal !== nextVal) {
          bpmInput.value = String(nextVal);
          onBpmChange?.(nextVal);
        }
      },
      { passive: false },
    );
  }

  if (swingInput) {
    swingInput.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault?.();
        const curVal = Number(swingInput.value || 0);
        const nextVal = calculateTransportWheelValue({
          currentValue: curVal,
          deltaY: e.deltaY,
          min: Number(swingInput.min || 0),
          max: Number(swingInput.max || 50),
          step: 1,
          shiftMultiplier: 5,
          shiftKey: Boolean(e.shiftKey),
        });
        if (curVal !== nextVal) {
          swingInput.value = String(nextVal);
          onSwingChange?.(nextVal);
        }
      },
      { passive: false },
    );
  }
}

export class DawTransportElement extends BaseElement {
  constructor() {
    super();
    if (this.attachShadow) {
      this.attachShadow({ mode: "open" });
    }
    this._rafId = null;
  }

  connectedCallback() {
    this.render();
    this._startLoop();
    this._dispose = effect(() => {
      const p = scdaw.project.get();
      this._syncProject(p);
    });
  }

  disconnectedCallback() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._dispose) this._dispose();
  }

  _startLoop() {
    const update = () => {
      this._sync();
      this._rafId = requestAnimationFrame(update);
    };
    this._rafId = requestAnimationFrame(update);
  }

  _sync() {
    if (!this.shadowRoot) return;
    const s = scdaw.getState();

    const playBtn = this.shadowRoot.getElementById("play-btn");
    const recBtn = this.shadowRoot.getElementById("rec-btn");
    const posBadge = this.shadowRoot.getElementById("pos-badge");
    const audioBtn = this.shadowRoot.getElementById("audio-btn");

    if (playBtn) {
      playBtn.textContent = s.playing ? "⏸ Stop" : "▶ Play";
      playBtn.classList.toggle("btn-primary", s.playing);
      playBtn.setAttribute(
        "aria-label",
        s.playing ? "Stop playback" : "Start playback",
      );
    }
    if (recBtn) {
      recBtn.textContent = s.recording ? "⏹ Stop REC" : "● REC";
      recBtn.classList.toggle("btn-danger", Boolean(s.recording));
      recBtn.setAttribute("aria-pressed", String(Boolean(s.recording)));
      recBtn.setAttribute(
        "aria-label",
        s.recording ? "Stop recording" : "Record audio",
      );
    }
    if (posBadge) {
      posBadge.textContent = formatPosition(s.bar, s.beat, s.step);
    }
    if (audioBtn) {
      audioBtn.style.display = s.audio === "running" ? "none" : "inline-flex";
    }
  }

  _syncProject(p) {
    if (!this.shadowRoot || !p) return;
    const bpmInput = this.shadowRoot.getElementById("bpm-input");
    const swingInput = this.shadowRoot.getElementById("swing-input");
    const swingVal = this.shadowRoot.getElementById("swing-val");
    const lengthBadge = this.shadowRoot.getElementById("length-badge");

    if (bpmInput && document.activeElement !== bpmInput) {
      bpmInput.value = p.bpm;
    }
    if (swingInput && document.activeElement !== swingInput) {
      const val = Math.round((p.swing || 0) * 100);
      swingInput.value = val;
      if (swingVal) swingVal.textContent = `${val}%`;
    }
    if (lengthBadge) {
      lengthBadge.textContent = `${p.lengthBars} Bar${p.lengthBars > 1 ? "s" : ""} (${p.signature.join("/")})`;
    }
    const metroBtn = this.shadowRoot.getElementById("metro-btn");
    if (metroBtn) {
      const metroOn = Boolean(p.metronome?.enabled);
      metroBtn.classList.toggle("btn-primary", metroOn);
      metroBtn.setAttribute("aria-pressed", String(metroOn));
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
          container-name: scdaw-transport;
        }

        /* Base styles: Mobile First (Stacked, fluid, no horizontal overflow) */
        .scdaw-transport,
        .transport-bar {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          padding: 0.5rem;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 8px;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          overflow-x: hidden;
        }

        .scdaw-transport__group,
        .transport-group {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          min-width: 0;
        }

        .scdaw-transport__group--playback {
          justify-content: space-between;
          flex-wrap: wrap;
        }

        .scdaw-transport__btn--play {
          flex: 1 1 auto;
          min-width: 75px;
          justify-content: center;
          min-height: 32px;
        }

        .scdaw-transport__btn--rec {
          flex: 1 1 auto;
          min-width: 80px;
          justify-content: center;
          min-height: 32px;
        }

        .scdaw-transport__btn--metro {
          flex: 1 1 auto;
          min-width: 75px;
          justify-content: center;
          min-height: 32px;
        }

        .scdaw-transport__btn--audio {
          flex: 1 1 auto;
          min-width: 95px;
          justify-content: center;
          min-height: 32px;
        }

        .scdaw-transport__pos,
        .pos-display {
          font-family: var(--mono);
          font-size: 0.85rem;
          font-weight: 700;
          color: var(--accent);
          background: #090e10;
          padding: 0.35rem 0.6rem;
          border-radius: 4px;
          border: 1px solid var(--border-subtle);
          letter-spacing: 0.05em;
          min-height: 32px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
          flex: 1 1 auto;
          text-align: center;
        }

        .scdaw-transport__group--tempo {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 0.35rem;
          font-size: 0.78rem;
          width: 100%;
          box-sizing: border-box;
        }

        .scdaw-transport__item {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          box-sizing: border-box;
        }

        .scdaw-transport__item--bpm {
          flex: 0 0 auto;
          touch-action: none;
          user-select: none;
          -webkit-user-select: none;
        }

        .scdaw-transport__label {
          font-weight: 600;
          color: var(--shadow-claw-text-secondary, #94a3b8);
          font-size: 0.75rem;
          cursor: ns-resize;
          user-select: none;
        }

        .scdaw-transport__input {
          width: 50px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          color: inherit;
          border-radius: 4px;
          padding: 3px 5px;
          font-family: var(--mono);
          font-size: 0.78rem;
          box-sizing: border-box;
          cursor: ns-resize;
          touch-action: none;
          user-select: none;
          -webkit-user-select: none;
        }

        .scdaw-transport__input:focus {
          cursor: text;
          user-select: text;
          -webkit-user-select: text;
        }

        .scdaw-transport__item--swing {
          flex: 1 1 auto;
          min-width: 85px;
          max-width: 130px;
        }

        .scdaw-transport__slider {
          width: 100%;
          min-width: 40px;
          accent-color: var(--accent);
          cursor: pointer;
          box-sizing: border-box;
        }

        .scdaw-transport__val {
          font-family: var(--mono);
          font-size: 0.72rem;
          min-width: 26px;
        }

        .scdaw-transport__item--length {
          flex: 0 0 auto;
        }

        .scdaw-transport__badge {
          white-space: nowrap;
          font-size: 0.7rem;
        }

        .scdaw-transport__item--panic {
          flex: 0 0 auto;
        }

        .scdaw-transport__btn--panic {
          min-height: 28px;
          white-space: nowrap;
        }

        /* Progressive Enhancement: Tablet and Desktop (>= 640px) */
        @container scdaw-transport (min-width: 640px) {
          .scdaw-transport,
          .transport-bar {
            flex-direction: row;
            flex-wrap: wrap;
            justify-content: space-between;
            align-items: center;
            gap: 0.5rem 0.75rem;
            padding: 0.5rem 0.75rem;
          }
          .scdaw-transport__group,
          .transport-group {
            width: auto;
            flex: 0 0 auto;
          }
          .scdaw-transport__group--playback {
            justify-content: flex-start;
            flex-wrap: wrap;
          }
          .scdaw-transport__btn--play,
          .scdaw-transport__btn--rec,
          .scdaw-transport__btn--metro,
          .scdaw-transport__btn--audio,
          .scdaw-transport__pos {
            flex: 0 0 auto;
          }
          .scdaw-transport__group--tempo {
            justify-content: flex-end;
            flex-wrap: wrap;
            gap: 0.6rem;
            width: auto;
            margin-inline-start: auto;
          }
          .scdaw-transport__item--swing {
            max-width: 160px;
          }
        }

        @supports not (container-type: inline-size) {
          @media (min-width: 640px) {
            .scdaw-transport,
            .transport-bar {
              flex-direction: row;
              flex-wrap: wrap;
              justify-content: space-between;
              align-items: center;
              gap: 0.5rem 0.75rem;
            }
            .scdaw-transport__group--tempo {
              justify-content: flex-end;
              flex-wrap: wrap;
              gap: 0.6rem;
              width: auto;
              margin-inline-start: auto;
            }
          }
        }
        dialog.scdaw-dialog,
        dialog:modal {
          max-width: 460px;
          width: 92vw;
          background: var(--bg-card, #161b1c);
          border: 1px solid var(--border, #3f4849);
          border-radius: 8px;
          color: var(--shadow-claw-text-primary, #dde4e4);
          padding: 0;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.65), 0 0 0 1px var(--border-subtle, rgba(255, 255, 255, 0.08));
          box-sizing: border-box;
          font-family: inherit;
        }

        dialog::backdrop {
          background: rgba(0, 0, 0, 0.75);
          backdrop-filter: blur(4px);
        }

        .scdaw-dialog__form {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          padding: 1.25rem;
          margin: 0;
        }

        .scdaw-dialog__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid var(--border, #3f4849);
          padding-bottom: 0.75rem;
        }

        .scdaw-dialog__header .btn-icon {
          padding: 4px 8px;
          font-size: 0.85rem;
          line-height: 1;
          background: transparent;
          border-color: transparent;
          color: var(--shadow-claw-text-secondary, #879394);
          border-radius: 4px;
        }

        .scdaw-dialog__header .btn-icon:hover {
          background: var(--border, #3f4849);
          color: var(--shadow-claw-text-primary, #dde4e4);
        }

        .scdaw-dialog__title {
          margin: 0;
          font-size: 1.05rem;
          font-weight: 700;
          color: var(--shadow-claw-text-primary, #dde4e4);
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .scdaw-dialog__desc {
          margin: 0 0 0.85rem 0;
          font-size: 0.85rem;
          color: var(--shadow-claw-text-secondary, #879394);
          line-height: 1.5;
        }

        .scdaw-dialog__actions-vertical {
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
        }

        .scdaw-dialog__btn {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          text-align: left;
          padding: 0.7rem 0.95rem;
          gap: 0.3rem;
          border-radius: 6px;
          cursor: pointer;
          background: var(--bg-elevated, #252b2c);
          border: 1px solid var(--border, #3f4849);
          color: var(--shadow-claw-text-primary, #dde4e4);
          width: 100%;
          box-sizing: border-box;
          transition: border-color 0.15s ease, background 0.15s ease, transform 0.05s ease;
        }

        .scdaw-dialog__btn:hover {
          background: var(--border, #3f4849);
          border-color: var(--accent, #80d4db);
          color: #ffffff;
        }

        .scdaw-dialog__btn:active {
          transform: scale(0.99);
        }

        .scdaw-dialog__btn.btn-primary {
          background: var(--accent, #80d4db);
          color: var(--on-accent, #00363a);
          border-color: var(--accent, #80d4db);
        }

        .scdaw-dialog__btn.btn-primary:hover {
          background: var(--accent-hover, #9df0f8);
          border-color: var(--accent-hover, #9df0f8);
          color: var(--on-accent, #00363a);
        }

        .scdaw-dialog__btn-sub {
          font-size: 0.75rem;
          color: var(--shadow-claw-text-secondary, #879394);
          font-weight: 400;
          line-height: 1.35;
        }

        .scdaw-dialog__btn.btn-primary .scdaw-dialog__btn-sub {
          color: var(--on-accent, #00363a);
          opacity: 0.88;
        }

        .scdaw-dialog__footer {
          display: flex;
          justify-content: flex-end;
          gap: 0.6rem;
          border-top: 1px solid var(--border, #3f4849);
          padding-top: 0.75rem;
          margin-top: 0.25rem;
        }

        .scdaw-dialog__footer .btn {
          height: 32px;
          padding: 0 1rem;
          font-size: 0.82rem;
          background: var(--bg-elevated, #252b2c);
          border: 1px solid var(--border, #3f4849);
          color: var(--shadow-claw-text-primary, #dde4e4);
          border-radius: 4px;
        }

        .scdaw-dialog__footer .btn:hover {
          background: var(--border, #3f4849);
          color: #ffffff;
        }
      </style>
      <div class="scdaw-transport transport-bar" role="region" aria-label="Audio Transport Controls">
        <div class="scdaw-transport__group scdaw-transport__group--playback transport-group" role="group" aria-label="Playback Controls">
          <button id="play-btn" class="scdaw-transport__btn scdaw-transport__btn--play btn ${s.playing ? "btn-primary" : ""}" aria-label="${s.playing ? "Stop playback" : "Start playback"}">
            ${s.playing ? "⏸ Stop" : "▶ Play"}
          </button>
          <button id="rec-btn" class="scdaw-transport__btn scdaw-transport__btn--rec btn ${s.recording ? "btn-danger" : ""}" aria-label="${s.recording ? "Stop recording" : "Record audio"}" aria-pressed="${Boolean(s.recording)}">
            ${s.recording ? "⏹ Stop REC" : "● REC"}
          </button>
          <button id="metro-btn" class="scdaw-transport__btn scdaw-transport__btn--metro btn ${p.metronome?.enabled ? "btn-primary" : ""}" aria-label="Toggle Metronome" aria-pressed="${Boolean(p.metronome?.enabled)}" title="Metronome click track">
            🔔 Metro
          </button>
          <button id="audio-btn" class="scdaw-transport__btn scdaw-transport__btn--audio btn btn-primary" style="${s.audio === "running" ? "display:none;" : ""}" aria-label="Start Audio Processing Engine">
            🔊 Start Audio
          </button>
          <span id="pos-badge" class="scdaw-transport__pos pos-display" role="status" aria-live="off" aria-label="Current musical position (Bar, Beat, Step)">
            001 : 1 : 1
          </span>
        </div>

        <div class="scdaw-transport__group scdaw-transport__group--tempo transport-group" role="group" aria-label="Tempo, Groove and Transport Settings">
          <div class="scdaw-transport__item scdaw-transport__item--bpm" title="Touch & drag up/down or mouse wheel to adjust BPM (Shift for fine control). Double-click to reset to 120">
            <label for="bpm-input" class="scdaw-transport__label" title="Touch & drag up/down to adjust BPM">BPM:</label>
            <input id="bpm-input" class="scdaw-transport__input" type="number" min="40" max="240" value="${p.bpm}" title="Touch & drag up/down or mouse wheel to adjust (Shift for fine control). Double-click to reset to 120" aria-label="Tempo in beats per minute" />
          </div>

          <div class="scdaw-transport__item scdaw-transport__item--swing">
            <label for="swing-input" class="scdaw-transport__label">Swing:</label>
            <input id="swing-input" class="scdaw-transport__slider" type="range" min="0" max="50" value="${Math.round((p.swing || 0) * 100)}" title="Mouse wheel to adjust (Shift for +/-5%). Double-click to reset to 0%" aria-label="Groove swing percentage" />
            <span id="swing-val" class="scdaw-transport__val" aria-hidden="true">${Math.round((p.swing || 0) * 100)}%</span>
          </div>

          <div class="scdaw-transport__item scdaw-transport__item--length">
            <span id="length-badge" class="scdaw-transport__badge badge" title="Project length and musical time signature">${p.lengthBars} Bar${p.lengthBars > 1 ? "s" : ""} (${p.signature.join("/")})</span>
          </div>

          <div class="scdaw-transport__item scdaw-transport__item--panic">
            <button id="panic-btn" class="scdaw-transport__btn scdaw-transport__btn--panic btn btn-icon btn-danger" title="All Notes Off (Emergency Mute)" aria-label="Panic: stop all playing notes and sounds immediately">
              ⏹ Panic
            </button>
          </div>
        </div>
      </div>

      <dialog id="scdaw-rec-dialog" class="scdaw-dialog" aria-labelledby="rec-dialog-title" aria-modal="true">
        <form method="dialog" class="scdaw-dialog__form">
          <div class="scdaw-dialog__header">
            <h3 id="rec-dialog-title" class="scdaw-dialog__title">🎙️ Audio Recording Options</h3>
            <button type="button" id="rec-dialog-close" class="btn btn-icon" aria-label="Close dialog">✕</button>
          </div>
          <div class="scdaw-dialog__body">
            <p id="rec-dialog-desc" class="scdaw-dialog__desc">
              Track already has audio. What would you like to do?
            </p>
            <div class="scdaw-dialog__actions-vertical">
              <button type="button" id="rec-opt-new" class="btn btn-primary scdaw-dialog__btn" autofocus>
                <span>➕ <strong>New Audio Track</strong></span>
                <span id="rec-opt-new-sub" class="scdaw-dialog__btn-sub">Create a new track and record cleanly</span>
              </button>
              <button type="button" id="rec-opt-append" class="btn scdaw-dialog__btn">
                <span>⏩ <strong>Append After Audio</strong></span>
                <span id="rec-opt-append-sub" class="scdaw-dialog__btn-sub">Start recording after existing clips</span>
              </button>
              <button type="button" id="rec-opt-overdub" class="btn scdaw-dialog__btn">
                <span>🎙 <strong>Overdub on This Track</strong></span>
                <span id="rec-opt-overdub-sub" class="scdaw-dialog__btn-sub">Layer as an overlapping take on this track</span>
              </button>
            </div>
          </div>
          <div class="scdaw-dialog__footer">
            <button type="button" id="rec-dialog-cancel" class="btn">Cancel</button>
          </div>
        </form>
      </dialog>
    `;

    const dialog = this.shadowRoot.getElementById("scdaw-rec-dialog");
    const descEl = this.shadowRoot.getElementById("rec-dialog-desc");
    const newSubEl = this.shadowRoot.getElementById("rec-opt-new-sub");
    const appendSubEl = this.shadowRoot.getElementById("rec-opt-append-sub");
    const overdubSubEl = this.shadowRoot.getElementById("rec-opt-overdub-sub");

    let pendingTargetTrack = null;

    const openRecordDialog = (targetTrack, currentBeat) => {
      pendingTargetTrack = targetTrack;
      const audioTracks = scdaw
        .getProject()
        .tracks.filter((t) => t.kind === "audio");
      const nextTakeName = `${targetTrack.name.replace(/ \(Take \d+\)$/, "")} (Take ${audioTracks.length + 1})`;
      const endBeat = Math.max(
        0,
        ...(targetTrack.audioClips || []).map(
          (c) => (c.time || 0) + (c.duration || 4),
        ),
      );

      if (descEl) {
        descEl.textContent = `Track "${targetTrack.name}" already has audio at beat ${currentBeat + 1}. What would you like to do?`;
      }
      if (newSubEl) {
        newSubEl.textContent = `Create "${nextTakeName}" and record cleanly`;
      }
      if (appendSubEl) {
        appendSubEl.textContent = `Start recording at beat ${endBeat + 1} after existing audio`;
      }
      if (overdubSubEl) {
        overdubSubEl.textContent = `Layer as an overlapping take on "${targetTrack.name}"`;
      }

      if (dialog && typeof dialog.showModal === "function") {
        dialog.showModal();
        this.shadowRoot.getElementById("rec-opt-new")?.focus();
      }
    };

    this.shadowRoot
      .getElementById("rec-dialog-close")
      ?.addEventListener("click", () => dialog?.close());
    this.shadowRoot
      .getElementById("rec-dialog-cancel")
      ?.addEventListener("click", () => dialog?.close());

    this.shadowRoot
      .getElementById("rec-opt-new")
      ?.addEventListener("click", async () => {
        dialog?.close();
        if (pendingTargetTrack) {
          try {
            await scdaw.startRecording(pendingTargetTrack.id, {
              mode: "new_track",
            });
          } catch (err) {
            console.error("Recording error:", err);
          }
        }
      });

    this.shadowRoot
      .getElementById("rec-opt-append")
      ?.addEventListener("click", async () => {
        dialog?.close();
        if (pendingTargetTrack) {
          try {
            await scdaw.startRecording(pendingTargetTrack.id, {
              mode: "append",
            });
          } catch (err) {
            console.error("Recording error:", err);
          }
        }
      });

    this.shadowRoot
      .getElementById("rec-opt-overdub")
      ?.addEventListener("click", async () => {
        dialog?.close();
        if (pendingTargetTrack) {
          try {
            await scdaw.startRecording(pendingTargetTrack.id, {
              mode: "overdub",
            });
          } catch (err) {
            console.error("Recording error:", err);
          }
        }
      });

    this.shadowRoot
      .getElementById("play-btn")
      ?.addEventListener("click", () => {
        const state = scdaw.getState();
        if (state.playing) scdaw.stop();
        else scdaw.play();
      });

    this.shadowRoot
      .getElementById("rec-btn")
      ?.addEventListener("click", async () => {
        const state = scdaw.getState();
        if (state.recording) {
          const res = await scdaw.stopRecording();
          if (!res.ok && res.message) {
            console.warn(res.message);
          }
        } else {
          const p = scdaw.getProject();
          let targetTrack = null;
          const selId = scdaw.selectedTrackId?.get();
          if (selId) {
            targetTrack = p.tracks.find(
              (t) => t.id === selId && t.kind === "audio",
            );
          }
          if (!targetTrack) {
            targetTrack = p.tracks.find(
              (t) => t.recordArm && t.kind === "audio",
            );
          }
          if (!targetTrack) {
            targetTrack = p.tracks.find((t) => t.kind === "audio");
          }

          const currentBeat = Math.floor(
            (scdaw.state.get().positionPpqn || 0) / PPQN.Quarter,
          );

          if (shouldPromptRecordOptions({ targetTrack, currentBeat })) {
            openRecordDialog(targetTrack, currentBeat);
          } else {
            try {
              await scdaw.startRecording(targetTrack?.id);
            } catch (err) {
              console.error("Recording error:", err);
              scdaw.requestDialog?.({
                title: "Recording Error",
                body: err.message || "Failed to start audio recording",
              });
            }
          }
        }
      });

    this.shadowRoot
      .getElementById("metro-btn")
      ?.addEventListener("click", () => {
        const currentP = scdaw.getProject();
        const nextEnabled = !currentP.metronome?.enabled;
        scdaw.sendCommand("set_metronome", { enabled: nextEnabled });
      });

    this.shadowRoot
      .getElementById("audio-btn")
      ?.addEventListener("click", () => {
        scdaw.unlockAudio();
      });

    const bpmInput = this.shadowRoot.getElementById("bpm-input");
    if (bpmInput) {
      bpmInput.addEventListener("change", (e) => {
        const bpm = Number(e.target.value);
        if (!Number.isNaN(bpm)) scdaw.sendCommand("set_transport", { bpm });
      });
      bpmInput.addEventListener("dblclick", () => {
        scdaw.sendCommand("set_transport", { bpm: 120 });
      });
    }

    const swingInput = this.shadowRoot.getElementById("swing-input");
    if (swingInput) {
      swingInput.addEventListener("input", (e) => {
        const val = Number(e.target.value);
        this.shadowRoot.getElementById("swing-val").textContent = `${val}%`;
        scdaw.sendCommand("set_transport", { swing: val / 100 });
      });
      swingInput.addEventListener("dblclick", () => {
        scdaw.sendCommand("set_transport", { swing: 0 });
      });
    }

    setupTransportWheelControls({
      bpmInput,
      swingInput,
      onBpmChange: (bpm) => {
        scdaw.sendCommand("set_transport", { bpm });
      },
      onSwingChange: (val) => {
        const swingVal = this.shadowRoot.getElementById("swing-val");
        if (swingVal) swingVal.textContent = `${val}%`;
        scdaw.sendCommand("set_transport", { swing: val / 100 });
      },
    });

    const bpmContainer = this.shadowRoot.querySelector(
      ".scdaw-transport__item--bpm",
    );
    setupBpmDragControl({
      bpmInput,
      bpmContainer,
      onBpmChange: (bpm) => {
        scdaw.sendCommand("set_transport", { bpm });
      },
    });

    this.shadowRoot
      .getElementById("panic-btn")
      ?.addEventListener("click", () => {
        scdaw.sendCommand("panic");
      });
  }
}

if (
  typeof customElements !== "undefined" &&
  !customElements.get("scdaw-transport")
) {
  customElements.define("scdaw-transport", DawTransportElement);
}
