/**
 * .agents/scripts/components/shadow-claw-daw-transport.js
 *
 * Header Transport Bar Web Component (<shadow-claw-daw-transport>).
 * Ported concepts from openDAW TransportGroup & OpenStudio TransportBar.
 * Redesigned Mobile-First, Responsive, BEM, and ARIA compliant.
 */

import { SHARED_STYLES } from "./shadow-claw-daw-styles.js";
import { scdaw, formatUserError } from "../shadow-claw-daw-engine.js";
import { effect } from "../shadow-claw-daw-signals.js";
import {
  PPQN,
  RESERVED_MIDI_CCS,
  MIDI_CONTROLLER_PRESETS,
} from "../shadow-claw-daw.js";

/**
 * Format an audio/recording error into user-facing modal dialog copy.
 * @param {Error|string} err
 * @param {string} [context="Recording"]
 * @returns {{ title: string, message: string, hint: string }}
 */
export function formatRecordingErrorDialog(err, context = "Recording") {
  const name = String(err?.name || "");
  const message = formatUserError(err, context);
  let hint = "";
  if (
    name === "NotFoundError" ||
    name === "DevicesNotFoundError" ||
    /no microphone|requested device not found/i.test(message)
  ) {
    hint =
      "Tip: Connect or select an audio input microphone, or import/generate audio clips in the 🌊 Audio Wave Editor.";
  } else if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    hint =
      "Tip: Click the camera/microphone icon in your browser address bar to allow microphone access.";
  } else if (name === "NotReadableError" || name === "TrackStartError") {
    hint =
      "Tip: Close other applications or browser tabs currently capturing your microphone.";
  }
  return {
    title: `${context || "Audio"} Error`,
    message,
    hint,
  };
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

import {
  BaseElement,
  defineElement,
} from "shadow-claw/components/shadow-claw-element";

export function formatMidiStatusBadge(midiState = {}) {
  const status = midiState?.status || "idle";
  const inputs = Array.isArray(midiState?.inputs) ? midiState.inputs : [];
  if (status === "ready") {
    return {
      label: `MIDI (${inputs.length})`,
      title: `Web MIDI ready (${inputs.length} input${inputs.length === 1 ? "" : "s"})`,
    };
  }
  if (status === "unsupported" || status === "denied") {
    return {
      label: "MIDI (Keys)",
      title:
        status === "denied"
          ? "MIDI permission denied — using Software MIDI Keyboard"
          : "Web MIDI unavailable — using Software MIDI Keyboard",
    };
  }
  return {
    label: "MIDI (--)",
    title: "Click to connect Web MIDI devices",
  };
}

export function formatCaptureButtonState(
  captureCount = 0,
  recentlyCaptured = 0,
) {
  const rec = Math.max(0, Math.round(Number(recentlyCaptured) || 0));
  if (rec > 0) {
    return {
      label: `✓ Captured ${rec}`,
      active: true,
      hasNotes: false,
      title: `Captured ${rec} MIDI note${rec === 1 ? "" : "s"} onto the selected track`,
    };
  }
  const count = Math.max(0, Math.round(Number(captureCount) || 0));
  if (count > 0) {
    return {
      label: `⏺ Capture (${count})`,
      active: true,
      hasNotes: true,
      title: `Capture ${count} recently played MIDI note${count === 1 ? "" : "s"} onto the selected track`,
    };
  }
  return {
    label: "⏺ Capture",
    active: false,
    hasNotes: false,
    title:
      "Retroactive MIDI Capture — play notes first (MIDI or ⌨ Keys), then click to keep them",
  };
}

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

export const SIGNATURE_PRESETS = [
  "4/4",
  "3/4",
  "6/8",
  "12/8",
  "9/8",
  "2/4",
  "2/2",
  "5/4",
  "7/8",
  "3/8",
];

/**
 * Adjusts project length in bars with Shift+click x4 multiplier and [1, 512] clamping.
 */
export function calculateBarsAdjustment(currentBars, delta, shiftKey = false) {
  const base = Number.isFinite(Number(currentBars)) ? Number(currentBars) : 1;
  const step = shiftKey ? delta * 4 : delta;
  return Math.max(1, Math.min(512, Math.round(base + step)));
}

/**
 * Parses a "num/den" time signature string into a validated [num, den] tuple.
 */
export function parseSignatureString(sigStr) {
  if (typeof sigStr !== "string") return [4, 4];
  const match = sigStr.trim().match(/^(\d{1,2})\s*\/\s*(\d{1,2})$/);
  if (!match) return [4, 4];
  const num = Math.max(1, Math.min(16, Number(match[1])));
  const den = Number(match[2]);
  return [num, [2, 4, 8, 16].includes(den) ? den : 4];
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
  min = 20,
  max = 300,
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
      const min = Number(bpmInput.min || 20);
      const max = Number(bpmInput.max || 300);
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
          min: Number(bpmInput.min || 20),
          max: Number(bpmInput.max || 300),
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

export class ShadowClawDawTransport extends BaseElement {
  constructor() {
    super();
    if (this.attachShadow) {
      this.attachShadow({ mode: "open" });
    }
    this._rafId = null;
    this._captureFeedbackCount = 0;
    this._captureFeedbackUntil = 0;
    this._midiDialogOpen = false;
    this._renderMidiDialogBody = null;
    this._learnForm = {
      trackId: "selected",
      param: "volume",
      mode: "",
      preset: "smc-mixer",
      bankOffset: 0,
    };
  }

  connectedCallback() {
    this.render();
    this._startLoop();
    this._dispose = effect(() => {
      const p = scdaw.project.get();
      scdaw.liveRevision?.get?.();
      scdaw.midi?.state?.get?.();
      this._syncProject(p);
      if (this._midiDialogOpen) {
        this._renderMidiDialogBody?.();
      }
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
      playBtn.textContent = s.playing ? "⏸ Pause" : "▶ Play";
      playBtn.classList.toggle("btn-primary", s.playing);
      playBtn.setAttribute(
        "aria-label",
        s.playing ? "Pause playback" : "Start playback",
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

    const midiBtn = this.shadowRoot.getElementById("midi-btn");
    if (midiBtn) {
      const m = scdaw.midi?.state?.get?.();
      const badge = formatMidiStatusBadge(m);
      if (midiBtn.textContent !== `🎹 ${badge.label}`) {
        midiBtn.textContent = `🎹 ${badge.label}`;
      }
      midiBtn.title = badge.title;
    }

    const captureBtn = this.shadowRoot.getElementById("capture-midi-btn");
    if (captureBtn) {
      const count = scdaw.midiCaptureCount?.get?.() || 0;
      const recent =
        Date.now() < this._captureFeedbackUntil
          ? this._captureFeedbackCount
          : 0;
      const cap = formatCaptureButtonState(count, recent);
      if (captureBtn.textContent !== cap.label) {
        captureBtn.textContent = cap.label;
      }
      captureBtn.classList.toggle("btn-primary", cap.active);
      captureBtn.title = cap.title;
      captureBtn.setAttribute("aria-label", cap.title);
    }
  }

  _syncProject(p) {
    if (!this.shadowRoot || !p) return;
    const bpmInput = this.shadowRoot.getElementById("bpm-input");
    const swingInput = this.shadowRoot.getElementById("swing-input");
    const swingVal = this.shadowRoot.getElementById("swing-val");
    const barsInput = this.shadowRoot.getElementById("bars-input");
    const barsDecBtn = this.shadowRoot.getElementById("bars-dec-btn");
    const barsIncBtn = this.shadowRoot.getElementById("bars-inc-btn");
    const sigSelect = this.shadowRoot.getElementById("signature-select");

    if (bpmInput && document.activeElement !== bpmInput) {
      bpmInput.value = p.bpm;
    }
    if (swingInput && document.activeElement !== swingInput) {
      const val = Math.round((p.swing || 0) * 100);
      swingInput.value = val;
      if (swingVal) swingVal.textContent = `${val}%`;
    }
    const bars = Math.max(1, Math.min(512, Number(p.lengthBars || 1)));
    if (barsInput && document.activeElement !== barsInput) {
      barsInput.value = bars;
    }
    if (barsDecBtn) barsDecBtn.disabled = bars <= 1;
    if (barsIncBtn) barsIncBtn.disabled = bars >= 512;
    if (sigSelect && Array.isArray(p.signature)) {
      const sigVal = p.signature.join("/");
      if (
        sigSelect.options &&
        !Array.from(sigSelect.options).some((o) => o.value === sigVal)
      ) {
        const opt = document.createElement("option");
        opt.value = sigVal;
        opt.textContent = sigVal;
        sigSelect.appendChild(opt);
      }
      if (document.activeElement !== sigSelect) {
        sigSelect.value = sigVal;
      }
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
          container-name: shadow-claw-daw-transport;
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
          flex: 1 1 auto;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.25rem;
        }

        .scdaw-transport__bars-stepper {
          display: inline-flex;
          align-items: center;
          gap: 0.2rem;
          background: var(--bg-panel, #111317);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm, 4px);
          padding: 0 0.2rem;
          min-height: 36px;
        }

        .scdaw-transport__step-btn {
          min-width: 32px;
          min-height: 32px;
          padding: 0 0.35rem;
          font-weight: 700;
          line-height: 1;
        }

        .scdaw-transport__input--bars {
          width: 44px;
          min-width: 38px;
          text-align: center;
          border: none;
          background: transparent;
          padding: 0.15rem 0;
        }

        .scdaw-transport__select {
          background: var(--bg-panel, #111317);
          color: var(--text-main);
          border: 1px solid var(--border);
          border-radius: var(--radius-sm, 4px);
          font-family: var(--mono);
          font-size: 0.72rem;
          min-height: 36px;
          padding: 0.2rem 0.35rem;
          cursor: pointer;
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
        @container shadow-claw-daw-transport (min-width: 640px) {
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

        dialog:modal {
          overscroll-behavior: contain;
        }

        dialog::backdrop {
          overflow: hidden;
          overscroll-behavior: contain;
        }

        .scdaw-dialog--error {
          border-color: rgba(248, 113, 113, 0.7);
        }

        .scdaw-dialog__hint {
          margin: 0;
          font-size: 0.78rem;
          color: var(--accent, #80d4db);
          line-height: 1.4;
        }

        @media (pointer: coarse) {
          .scdaw-transport__btn,
          .scdaw-transport__step-btn,
          .scdaw-transport__select,
          .scdaw-transport__input,
          .scdaw-dialog__footer .btn,
          .scdaw-dialog__header .btn-icon {
            min-height: 44px;
          }
          .scdaw-transport__step-btn,
          .scdaw-dialog__header .btn-icon {
            min-width: 44px;
          }
        }
      </style>
      <div class="scdaw-transport transport-bar" role="region" aria-label="Audio Transport Controls">
        <div class="scdaw-transport__group scdaw-transport__group--playback transport-group" role="group" aria-label="Playback Controls">
          <button id="play-btn" type="button" class="scdaw-transport__btn scdaw-transport__btn--play btn ${s.playing ? "btn-primary" : ""}" aria-label="${s.playing ? "Pause playback" : "Start playback"}">
            ${s.playing ? "⏸ Pause" : "▶ Play"}
          </button>
          <button id="stop-btn" type="button" class="scdaw-transport__btn scdaw-transport__btn--stop btn" aria-label="Stop playback and return to start">
            ⏹ Stop
          </button>
          <button id="rec-btn" type="button" class="scdaw-transport__btn scdaw-transport__btn--rec btn ${s.recording ? "btn-danger" : ""}" aria-label="${s.recording ? "Stop recording" : "Record audio"}" aria-pressed="${Boolean(s.recording)}">
            ${s.recording ? "⏹ Stop REC" : "● REC"}
          </button>
          <button id="metro-btn" type="button" class="scdaw-transport__btn scdaw-transport__btn--metro btn ${p.metronome?.enabled ? "btn-primary" : ""}" aria-label="Toggle Metronome" aria-pressed="${Boolean(p.metronome?.enabled)}" title="Metronome click track">
            🔔 Metro
          </button>
          <button id="midi-btn" type="button" class="scdaw-transport__btn btn" aria-haspopup="dialog" aria-label="MIDI Devices and Routing" title="Configure Web MIDI Devices & Routing">
            🎹 MIDI
          </button>
          <button id="capture-midi-btn" type="button" class="scdaw-transport__btn btn" aria-label="Capture recent MIDI notes" title="Capture recent live MIDI notes to selected track">
            ⏺ Capture
          </button>
          <button id="keys-btn" type="button" class="scdaw-transport__btn btn" aria-pressed="false" aria-label="Toggle Software MIDI Keyboard" title="Toggle on-screen / QWERTY MIDI Keyboard">
            ⌨ Keys
          </button>
          <button id="audio-btn" type="button" class="scdaw-transport__btn scdaw-transport__btn--audio btn btn-primary" style="${s.audio === "running" ? "display:none;" : ""}" aria-label="Start Audio Processing Engine">
            🔊 Start Audio
          </button>
          <span id="pos-badge" class="scdaw-transport__pos pos-display" role="status" aria-live="off" aria-label="Current musical position (Bar, Beat, Step)">
            001 : 1 : 1
          </span>
        </div>

        <div class="scdaw-transport__group scdaw-transport__group--tempo transport-group" role="group" aria-label="Tempo, Groove and Transport Settings">
          <div class="scdaw-transport__item scdaw-transport__item--bpm" title="Touch & drag up/down or mouse wheel to adjust BPM (Shift for fine control). Double-click to reset to 120">
            <label for="bpm-input" class="scdaw-transport__label" title="Touch & drag up/down to adjust BPM">BPM:</label>
            <input id="bpm-input" class="scdaw-transport__input" type="number" min="20" max="300" value="${p.bpm}" title="Touch & drag up/down or mouse wheel to adjust (Shift for fine control). Double-click to reset to 120" aria-label="Tempo in beats per minute" />
          </div>

          <div class="scdaw-transport__item scdaw-transport__item--swing">
            <label for="swing-input" class="scdaw-transport__label">Swing:</label>
            <input id="swing-input" class="scdaw-transport__slider" type="range" min="0" max="50" value="${Math.round((p.swing || 0) * 100)}" title="Mouse wheel to adjust (Shift for +/-5%). Double-click to reset to 0%" aria-label="Groove swing percentage" />
            <span id="swing-val" class="scdaw-transport__val" aria-hidden="true">${Math.round((p.swing || 0) * 100)}%</span>
          </div>

          <div class="scdaw-transport__item scdaw-transport__item--length" role="group" aria-label="Project length and time signature">
            <div class="scdaw-transport__bars-stepper">
              <button
                id="bars-dec-btn"
                type="button"
                class="scdaw-transport__step-btn btn btn-icon"
                aria-label="Decrease project length by 1 bar (Shift+Click for -4)"
                title="Decrease bars (-1, Shift+Click -4)"
                ${(p.lengthBars || 1) <= 1 ? "disabled" : ""}
              >−</button>
              <label for="bars-input" class="scdaw-transport__label">Bars:</label>
              <input
                id="bars-input"
                class="scdaw-transport__input scdaw-transport__input--bars"
                type="number"
                min="1"
                max="512"
                value="${p.lengthBars || 1}"
                aria-label="Project length in bars (1 to 512)"
                title="Project length in bars (1-512). Scroll or type to change"
              />
              <button
                id="bars-inc-btn"
                type="button"
                class="scdaw-transport__step-btn btn btn-icon"
                aria-label="Increase project length by 1 bar (Shift+Click for +4)"
                title="Increase bars (+1, Shift+Click +4)"
                ${(p.lengthBars || 1) >= 512 ? "disabled" : ""}
              >+</button>
            </div>
            <select
              id="signature-select"
              class="scdaw-transport__select"
              aria-label="Time signature"
              title="Musical time signature"
            >
              ${(() => {
                const curSig = (p.signature || [4, 4]).join("/");
                const opts = SIGNATURE_PRESETS.includes(curSig)
                  ? SIGNATURE_PRESETS
                  : [curSig, ...SIGNATURE_PRESETS];
                return opts
                  .map(
                    (sig) =>
                      `<option value="${sig}" ${sig === curSig ? "selected" : ""}>${sig}</option>`,
                  )
                  .join("");
              })()}
            </select>
          </div>

          <div class="scdaw-transport__item scdaw-transport__item--panic">
            <button id="panic-btn" type="button" class="scdaw-transport__btn scdaw-transport__btn--panic btn btn-icon btn-danger" title="All Notes Off (Emergency Mute)" aria-label="Panic: stop all playing notes and sounds immediately">
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

      <dialog id="scdaw-midi-dialog" class="scdaw-dialog" aria-labelledby="midi-dialog-title">
        <form method="dialog" class="scdaw-dialog__form">
          <div class="scdaw-dialog__header">
            <h3 id="midi-dialog-title" class="scdaw-dialog__title">MIDI Devices &amp; Routing</h3>
            <button type="button" id="midi-dialog-close" class="btn btn-icon" aria-label="Close MIDI dialog">✕</button>
          </div>
          <div id="midi-dialog-body" class="scdaw-dialog__body"></div>
          <div class="scdaw-dialog__footer">
            <button type="button" id="midi-dialog-done" class="btn btn-primary">Done</button>
          </div>
        </form>
      </dialog>

      <dialog id="scdaw-capture-dialog" class="scdaw-dialog" aria-labelledby="capture-dialog-title">
        <form method="dialog" class="scdaw-dialog__form">
          <div class="scdaw-dialog__header">
            <h3 id="capture-dialog-title" class="scdaw-dialog__title">Capture MIDI (Retroactive Recording)</h3>
            <button type="button" id="capture-dialog-close" class="btn btn-icon" aria-label="Close Capture MIDI dialog">✕</button>
          </div>
          <div id="capture-dialog-body" class="scdaw-dialog__body">
            <p>No recent MIDI notes are in the capture buffer yet.</p>
            <p>Play notes anytime using a connected MIDI controller or the on-screen <strong>⌨ Keys</strong> keyboard—even without pressing Record. When notes are played, the button updates to <strong>⏺ Capture (N)</strong>; click it to drop what you just played onto the selected track.</p>
            <p id="capture-dialog-target"></p>
          </div>
          <div class="scdaw-dialog__footer" style="display:flex;justify-content:flex-end;gap:8px;">
            <button type="button" id="capture-open-keys" class="btn">Open ⌨ Keys</button>
            <button type="button" id="capture-dialog-ok" class="btn btn-primary">Got it</button>
          </div>
        </form>
      </dialog>

      <dialog id="scdaw-error-dialog" class="scdaw-dialog scdaw-dialog--error" closedby="any" aria-labelledby="error-dialog-title" aria-describedby="error-dialog-message">
        <form method="dialog" class="scdaw-dialog__form">
          <div class="scdaw-dialog__header">
            <h1 id="error-dialog-title" class="scdaw-dialog__title">Recording Error</h1>
            <button type="button" id="error-dialog-close" class="btn btn-icon" aria-label="Close error dialog">✕</button>
          </div>
          <div class="scdaw-dialog__body">
            <p id="error-dialog-message" class="scdaw-dialog__desc"></p>
            <p id="error-dialog-hint" class="scdaw-dialog__hint"></p>
          </div>
          <div class="scdaw-dialog__footer">
            <button id="error-dialog-ok" type="submit" value="ok" class="btn btn-primary" autofocus>OK</button>
          </div>
        </form>
      </dialog>

      <span id="transport-live-msg" role="status" aria-live="polite" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;"></span>
    `;

    const errorDialog = this.shadowRoot.getElementById("scdaw-error-dialog");
    const errorTitleEl = this.shadowRoot.getElementById("error-dialog-title");
    const errorMsgEl = this.shadowRoot.getElementById("error-dialog-message");
    const errorHintEl = this.shadowRoot.getElementById("error-dialog-hint");
    const errorCloseBtn = this.shadowRoot.getElementById("error-dialog-close");

    errorCloseBtn?.addEventListener("click", () => errorDialog?.close?.());
    errorDialog?.addEventListener("close", () => {
      errorDialog.returnValue = "";
    });
    if (
      errorDialog &&
      typeof HTMLDialogElement !== "undefined" &&
      !("closedBy" in HTMLDialogElement.prototype)
    ) {
      let pressedOutside = false;
      const isOutside = (e) => {
        const r = errorDialog.getBoundingClientRect?.();
        if (!r) return false;
        return (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        );
      };
      errorDialog.addEventListener("pointerdown", (e) => {
        pressedOutside = isOutside(e);
      });
      errorDialog.addEventListener("pointerup", (e) => {
        if (pressedOutside && isOutside(e)) errorDialog.close?.();
      });
    }

    const showErrorDialog = (
      err,
      { title = null, context = "Recording" } = {},
    ) => {
      const info = formatRecordingErrorDialog(err, context);
      const finalTitle = title || info.title;
      scdaw.reportError?.(err, { title: finalTitle, context });
      if (errorTitleEl) errorTitleEl.textContent = finalTitle;
      if (errorMsgEl) errorMsgEl.textContent = info.message;
      if (errorHintEl) {
        errorHintEl.textContent = info.hint || "";
        errorHintEl.hidden = !info.hint;
      }
      if (
        errorDialog &&
        typeof errorDialog.showModal === "function" &&
        !errorDialog.open
      ) {
        errorDialog.showModal();
      }
    };

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

    const midiDialog = this.shadowRoot.getElementById("scdaw-midi-dialog");
    const midiDialogBody = this.shadowRoot.getElementById("midi-dialog-body");
    const transportParams = new Set([
      "play",
      "stop",
      "pause",
      "toggle_play",
      "record",
      "metronome",
      "bpm",
      "swing",
      "panic",
    ]);

    const renderMidiDialogBody = () => {
      if (!midiDialogBody) return;
      const m = scdaw.midi?.state?.get?.() || {
        status: "unsupported",
        inputs: [],
        outputs: [],
      };
      const proj = scdaw.getProject();
      const selId = scdaw.selectedTrackId?.get?.();
      const track = proj.tracks?.find((t) => t.id === selId);
      const mappings = proj.midiMappings || [];

      if (
        this._learnForm.trackId !== "selected" &&
        this._learnForm.trackId !== "master" &&
        this._learnForm.trackId !== "transport" &&
        !proj.tracks?.some((t) => t.id === this._learnForm.trackId)
      ) {
        this._learnForm.trackId = selId || "selected";
      }

      const statusMsg =
        m.status === "ready"
          ? `Web MIDI Connected (${m.inputs.length} in, ${m.outputs.length} out)`
          : m.status === "denied"
            ? "Web MIDI permission denied. Use the Software MIDI Keyboard (⌨ Keys) as fallback."
            : "Web MIDI API is unavailable in this browser. Use the Software MIDI Keyboard (⌨ Keys) as fallback.";

      const lastMsg = m.lastMessage;
      const monitorHtml = lastMsg
        ? `<strong>${escapeHtml(lastMsg.portName)}</strong> · Ch ${Number(lastMsg.channel ?? 0) + 1} (0-idx ${lastMsg.channel ?? 0}) · ${
            lastMsg.type === "cc"
              ? `CC ${lastMsg.controller}`
              : lastMsg.type === "pitch-bend"
                ? "Pitch Bend"
                : `Note ${lastMsg.pitch}`
          } = <strong>${lastMsg.value}</strong>`
        : "Move any control on your MIDI controller to inspect incoming messages.";

      const inputsHtml =
        m.inputs.length > 0
          ? m.inputs
              .map(
                (p) => `
              <li style="display:flex;align-items:center;gap:6px;margin:2px 0;">
                <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
                  <input type="checkbox" class="midi-port-toggle" data-port-id="${escapeHtml(p.id)}" aria-label="Enable MIDI input ${escapeHtml(p.name)}" ${p.enabled !== false ? "checked" : ""} />
                  <span>${escapeHtml(p.name)} (${escapeHtml(p.manufacturer || "MIDI")})</span>
                </label>
              </li>`,
              )
              .join("")
          : "<li>No MIDI inputs detected</li>";
      const outputsHtml =
        m.outputs.length > 0
          ? m.outputs
              .map(
                (p) =>
                  `<li>${escapeHtml(p.name)} (${escapeHtml(p.manufacturer || "MIDI")})</li>`,
              )
              .join("")
          : "<li>No MIDI outputs detected</li>";

      const presetOptionsHtml = Object.values(MIDI_CONTROLLER_PRESETS)
        .map(
          (preset) =>
            `<option value="${escapeHtml(preset.id)}" ${this._learnForm.preset === preset.id ? "selected" : ""}>${escapeHtml(preset.name)}</option>`,
        )
        .join("");

      const trackOptionsHtml = [
        `<option value="selected" ${this._learnForm.trackId === "selected" ? "selected" : ""}>Selected Track${track ? ` (${escapeHtml(track.name)})` : ""}</option>`,
        ...(proj.tracks || []).map(
          (t) =>
            `<option value="${escapeHtml(t.id)}" ${this._learnForm.trackId === t.id ? "selected" : ""}>${escapeHtml(t.name)}</option>`,
        ),
        `<option value="master" ${this._learnForm.trackId === "master" ? "selected" : ""}>Master Bus</option>`,
        `<option value="transport" ${this._learnForm.trackId === "transport" ? "selected" : ""}>Transport</option>`,
      ].join("");

      const learnParamOptions = [
        { value: "volume", label: "Volume (Track 0–1.5 / Master 0–1)" },
        { value: "pan", label: "Pan (-1..1)" },
        { value: "mute", label: "Mute [Toggle]" },
        { value: "solo", label: "Solo [Toggle]" },
        { value: "recordArm", label: "Record Arm [Toggle]" },
        { value: "play", label: "Transport: Play [Trigger]" },
        { value: "stop", label: "Transport: Stop [Trigger]" },
        { value: "toggle_play", label: "Transport: Play/Pause [Toggle]" },
        { value: "metronome", label: "Transport: Metronome [Toggle]" },
        { value: "bpm", label: "Transport: BPM (20–300)" },
        { value: "swing", label: "Transport: Swing (0–50%)" },
        { value: "cutoff", label: "Synth: Filter Cutoff (Hz)" },
        { value: "resonance", label: "Synth: Resonance (Q)" },
        { value: "drive", label: "Synth: Drive" },
        { value: "attack", label: "Synth: Attack (s)" },
        { value: "decay", label: "Synth: Decay (s)" },
        { value: "sustain", label: "Synth: Sustain" },
        { value: "release", label: "Synth: Release (s)" },
        { value: "lfoRate", label: "Synth: LFO Rate (Hz)" },
      ];
      const paramOptionsHtml = learnParamOptions
        .map(
          (opt) =>
            `<option value="${opt.value}" ${this._learnForm.param === opt.value ? "selected" : ""}>${opt.label}</option>`,
        )
        .join("");

      const channelsOverlap = (a, b) => {
        const ca = a === undefined || a === null || a === "" ? "omni" : a;
        const cb = b === undefined || b === null || b === "" ? "omni" : b;
        return ca === "omni" || cb === "omni" || Number(ca) === Number(cb);
      };

      const mappingsHtml =
        mappings.length > 0
          ? mappings
              .map((map) => {
                const targetLabel =
                  map.trackId === "master"
                    ? "Master"
                    : map.trackId === "transport"
                      ? "Transport"
                      : proj.tracks?.find((t) => t.id === map.trackId)?.name ||
                        map.trackId ||
                        "Selected";
                const chLabel =
                  map.channel === undefined ||
                  map.channel === null ||
                  map.channel === "" ||
                  map.channel === "omni"
                    ? "Omni"
                    : `Ch ${Number(map.channel) + 1}`;
                const modeLabel = map.mode ? ` [${map.mode}]` : "";
                const rangeLabel =
                  map.mode === "toggle" ||
                  map.mode === "trigger" ||
                  map.mode === "momentary"
                    ? ""
                    : ` (${map.min ?? 0}..${map.max ?? 1})`;
                const reservedName = RESERVED_MIDI_CCS[map.cc];
                const hasConflict = mappings.some(
                  (other) =>
                    other.id !== map.id &&
                    Number(other.cc) === Number(map.cc) &&
                    channelsOverlap(other.channel, map.channel),
                );
                const warnParts = [];
                if (reservedName) warnParts.push(`Reserved: ${reservedName}`);
                if (hasConflict) warnParts.push("Duplicate CC/Channel");
                const warnHtml =
                  warnParts.length > 0
                    ? `<span style="color:var(--warning);font-size:0.72rem;margin-left:4px;">⚠ ${escapeHtml(warnParts.join(", "))}</span>`
                    : "";
                return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:4px;padding:4px 6px;border-radius:4px;background:var(--bg-elevated);border:1px solid var(--border);">
                    <span style="font-size:0.78rem;">CC ${map.cc} (${chLabel}) → <strong>${escapeHtml(targetLabel)}</strong>.${escapeHtml(map.param)}${escapeHtml(modeLabel)}${escapeHtml(rangeLabel)}${warnHtml}</span>
                    <button type="button" class="btn btn-icon midi-del-map" data-id="${escapeHtml(map.id)}" aria-label="Remove mapping CC ${map.cc}">✕</button>
                  </div>`;
              })
              .join("")
          : "<p>No MIDI Learn mappings yet.</p>";

      const isLearning = Boolean(m.learning?.active);
      const learningInfo = isLearning
        ? `<p style="color:var(--accent);font-size:0.78rem;margin:4px 0 0 0;">Waiting for CC for <strong>${escapeHtml(m.learning?.target?.trackId || "selected")}.${escapeHtml(m.learning?.target?.param || "param")}</strong> — move a fader, knob, or button on your controller.</p>`
        : "";

      midiDialogBody.innerHTML = `
        <p>${statusMsg}</p>
        <div style="padding:6px 8px;border-radius:4px;background:var(--bg-elevated);border:1px solid var(--border);font-size:0.78rem;margin-bottom:8px;">
          <div style="font-weight:700;margin-bottom:2px;">Live MIDI Monitor</div>
          <div id="midi-live-monitor" role="status" aria-live="polite">${monitorHtml}</div>
        </div>
        <h4>Inputs <span class="badge" style="font-size:0.68rem;">Twin-port dedup: 80ms</span></h4>
        <ul style="list-style:none;padding-left:0;margin:4px 0 8px 0;">${inputsHtml}</ul>
        <label style="display:inline-flex;align-items:center;gap:6px;font-size:0.8rem;cursor:pointer;margin-bottom:8px;">
          <input type="checkbox" id="midi-soft-takeover" aria-label="Enable Soft Takeover pick-up mode" ${m.softTakeover ? "checked" : ""} />
          <span>Soft Takeover (pick-up mode prevents fader jumps)</span>
        </label>
        <h4>Outputs</h4>
        <ul>${outputsHtml}</ul>
        ${track ? `<h4>Selected Track: ${escapeHtml(track.name)}</h4><p>Input: ${escapeHtml(track.midiInput?.deviceId || "All / Selected")} (Ch: ${escapeHtml(track.midiInput?.channel ?? "omni")})</p>` : ""}
        <h4>Controller Presets</h4>
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:10px;">
          <select id="midi-preset-select" aria-label="MIDI controller preset" style="flex:1 1 160px;background:var(--bg-elevated);color:var(--shadow-claw-text-primary);border:1px solid var(--border);border-radius:4px;padding:4px 6px;">${presetOptionsHtml}</select>
          <select id="midi-preset-bank" aria-label="Controller preset track bank" style="flex:0 1 135px;background:var(--bg-elevated);color:var(--shadow-claw-text-primary);border:1px solid var(--border);border-radius:4px;padding:4px 6px;">
            <option value="0" ${Number(this._learnForm.bankOffset || 0) === 0 ? "selected" : ""}>Bank 1 (Tracks 1–7)</option>
            <option value="7" ${Number(this._learnForm.bankOffset || 0) === 7 ? "selected" : ""}>Bank 2 (Tracks 8–14)</option>
            <option value="14" ${Number(this._learnForm.bankOffset || 0) === 14 ? "selected" : ""}>Bank 3 (Tracks 15–21)</option>
            <option value="21" ${Number(this._learnForm.bankOffset || 0) === 21 ? "selected" : ""}>Bank 4 (Tracks 22–28)</option>
          </select>
          <button type="button" id="midi-apply-preset-btn" class="btn btn-primary">⚡ Apply Preset</button>
          <button type="button" id="midi-clear-mappings-btn" class="btn">🗑 Clear All</button>
        </div>
        <h4>MIDI Learn</h4>
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px;">
          <select id="midi-learn-track" aria-label="MIDI Learn target track or bus" style="flex:1 1 130px;background:var(--bg-elevated);color:var(--shadow-claw-text-primary);border:1px solid var(--border);border-radius:4px;padding:4px 6px;">${trackOptionsHtml}</select>
          <select id="midi-learn-param" aria-label="MIDI Learn target parameter" style="flex:1 1 150px;background:var(--bg-elevated);color:var(--shadow-claw-text-primary);border:1px solid var(--border);border-radius:4px;padding:4px 6px;">${paramOptionsHtml}</select>
          <select id="midi-learn-mode" aria-label="MIDI Learn control mode" style="flex:0 1 110px;background:var(--bg-elevated);color:var(--shadow-claw-text-primary);border:1px solid var(--border);border-radius:4px;padding:4px 6px;">
            <option value="" ${this._learnForm.mode === "" ? "selected" : ""}>Auto Mode</option>
            <option value="continuous" ${this._learnForm.mode === "continuous" ? "selected" : ""}>Continuous</option>
            <option value="toggle" ${this._learnForm.mode === "toggle" ? "selected" : ""}>Toggle (Latch)</option>
            <option value="momentary" ${this._learnForm.mode === "momentary" ? "selected" : ""}>Momentary</option>
            <option value="trigger" ${this._learnForm.mode === "trigger" ? "selected" : ""}>Trigger</option>
          </select>
          <button type="button" id="midi-learn-btn" class="btn ${isLearning ? "btn-danger" : "btn-primary"}" aria-pressed="${isLearning}">${isLearning ? "⏹ Cancel Learn" : "🎯 Learn CC"}</button>
        </div>
        ${learningInfo}
        <p style="font-size:0.72rem;color:var(--shadow-claw-text-secondary);margin:4px 0 8px 0;">Tip: You can also right-click any mixer fader, pan knob, M/S button, synth knob, or transport control to arm MIDI Learn. Mappings persist with the project.</p>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;margin:8px 0 4px 0;">
          <h4 style="margin:0;">MIDI Learn Mappings (${mappings.length})</h4>
          <div style="display:flex;gap:4px;">
            <button type="button" id="midi-export-mappings-btn" class="btn btn-icon" aria-label="Export MIDI Learn mappings as JSON">💾 Export JSON</button>
            <button type="button" id="midi-import-mappings-btn" class="btn btn-icon" aria-label="Import MIDI Learn mappings from JSON">📂 Import JSON</button>
            <input type="file" id="midi-import-mappings-input" accept=".json,application/json" style="display:none;" aria-hidden="true" />
          </div>
        </div>
        <div style="max-height:180px;overflow-y:auto;">${mappingsHtml}</div>
      `;
    };
    this._renderMidiDialogBody = renderMidiDialogBody;

    this.shadowRoot
      .getElementById("midi-btn")
      ?.addEventListener("click", async () => {
        if (scdaw.midi?.state?.get?.().status === "idle") {
          await scdaw.midi.init();
        }
        this._midiDialogOpen = true;
        renderMidiDialogBody();
        midiDialog?.showModal?.();
      });
    const closeMidiDialog = () => {
      this._midiDialogOpen = false;
      midiDialog?.close?.();
    };
    this.shadowRoot
      .getElementById("midi-dialog-close")
      ?.addEventListener("click", closeMidiDialog);
    this.shadowRoot
      .getElementById("midi-dialog-done")
      ?.addEventListener("click", closeMidiDialog);
    midiDialog?.addEventListener?.("close", () => {
      this._midiDialogOpen = false;
    });
    midiDialogBody?.addEventListener("change", async (e) => {
      const target = e.target;
      if (!target) return;
      if (target.id === "midi-learn-track") {
        this._learnForm.trackId = target.value;
        if (target.value === "master" && this._learnForm.param !== "volume") {
          this._learnForm.param = "volume";
          renderMidiDialogBody();
        } else if (
          target.value === "transport" &&
          !transportParams.has(this._learnForm.param)
        ) {
          this._learnForm.param = "play";
          renderMidiDialogBody();
        }
        return;
      }
      if (target.id === "midi-learn-param") {
        this._learnForm.param = target.value;
        if (transportParams.has(target.value)) {
          this._learnForm.trackId = "transport";
          renderMidiDialogBody();
        }
        return;
      }
      if (target.id === "midi-learn-mode") {
        this._learnForm.mode = target.value;
        return;
      }
      if (target.id === "midi-preset-select") {
        this._learnForm.preset = target.value;
        return;
      }
      if (target.id === "midi-preset-bank") {
        this._learnForm.bankOffset = Math.max(0, Number(target.value) || 0);
        return;
      }
      if (target.id === "midi-soft-takeover") {
        scdaw.midi?.setSoftTakeover?.(Boolean(target.checked));
        return;
      }
      if (target.id === "midi-import-mappings-input") {
        const file = target.files?.[0];
        if (!file) return;
        try {
          const text = await file.text();
          const parsed = JSON.parse(text);
          await scdaw.sendCommand("import_midi_learn_mappings", {
            mappings: parsed.midiMappings || parsed,
          });
          renderMidiDialogBody();
        } catch (err) {
          console.error("Failed to import MIDI mappings:", err);
          showErrorDialog(err, {
            title: "MIDI Import Error",
            context: "MIDI Mappings",
          });
        } finally {
          target.value = "";
        }
        return;
      }
      if (target.classList?.contains("midi-port-toggle")) {
        const portId = target.dataset?.portId;
        if (portId) {
          scdaw.midi?.setInputPortEnabled?.(portId, Boolean(target.checked));
        }
      }
    });
    midiDialogBody?.addEventListener("click", async (e) => {
      const del = e.target.closest?.(".midi-del-map");
      if (del) {
        await scdaw.sendCommand("remove_midi_learn_mapping", {
          id: del.dataset.id,
        });
        renderMidiDialogBody();
        return;
      }
      if (e.target.closest?.("#midi-learn-btn")) {
        const isLearning = Boolean(
          scdaw.midi?.state?.get?.()?.learning?.active,
        );
        if (isLearning) {
          scdaw.midi?.cancelMidiLearn?.();
        } else {
          const trackVal =
            this.shadowRoot?.getElementById?.("midi-learn-track")?.value ||
            this._learnForm.trackId;
          const paramVal =
            this.shadowRoot?.getElementById?.("midi-learn-param")?.value ||
            this._learnForm.param;
          const modeVal =
            this.shadowRoot?.getElementById?.("midi-learn-mode")?.value ??
            this._learnForm.mode;
          const resolvedTrackId =
            trackVal === "selected"
              ? scdaw.selectedTrackId?.get?.() ||
                scdaw.getProject().tracks?.[0]?.id
              : trackVal;
          scdaw.midi?.startMidiLearn?.({
            trackId: resolvedTrackId,
            param: paramVal,
            channel: "omni",
            ...(modeVal ? { mode: modeVal } : {}),
          });
        }
        renderMidiDialogBody();
        return;
      }
      if (e.target.closest?.("#midi-apply-preset-btn")) {
        const presetId =
          this.shadowRoot?.getElementById?.("midi-preset-select")?.value ||
          this._learnForm.preset ||
          "smc-mixer";
        const bankOffset = Number(
          this.shadowRoot?.getElementById?.("midi-preset-bank")?.value ??
            this._learnForm.bankOffset ??
            0,
        );
        await scdaw.sendCommand("apply_midi_controller_preset", {
          preset: presetId,
          bankOffset,
        });
        renderMidiDialogBody();
        return;
      }
      if (e.target.closest?.("#midi-export-mappings-btn")) {
        const proj = scdaw.getProject();
        const payload = {
          version: 2,
          midiMappings: (proj.midiMappings || []).map((map) => ({
            ...map,
            trackIndex: proj.tracks.findIndex((t) => t.id === map.trackId),
          })),
        };
        if (
          typeof Blob !== "undefined" &&
          typeof URL !== "undefined" &&
          typeof URL.createObjectURL === "function" &&
          typeof document !== "undefined"
        ) {
          const blob = new Blob([JSON.stringify(payload, null, 2)], {
            type: "application/json",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "midi-mappings.json";
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        return;
      }
      if (e.target.closest?.("#midi-import-mappings-btn")) {
        this.shadowRoot
          ?.getElementById?.("midi-import-mappings-input")
          ?.click?.();
        return;
      }
      if (e.target.closest?.("#midi-clear-mappings-btn")) {
        await scdaw.sendCommand("clear_midi_learn_mappings", {});
        renderMidiDialogBody();
      }
    });

    const captureDialog = this.shadowRoot.getElementById(
      "scdaw-capture-dialog",
    );
    const captureTargetEl = this.shadowRoot.getElementById(
      "capture-dialog-target",
    );
    const liveMsgEl = this.shadowRoot.getElementById("transport-live-msg");

    this.shadowRoot
      .getElementById("capture-midi-btn")
      ?.addEventListener("click", async () => {
        const res = await scdaw.commitCapturedMidi?.();
        if (res && res.addedCount > 0) {
          this._captureFeedbackCount = res.addedCount;
          this._captureFeedbackUntil = Date.now() + 1800;
          if (liveMsgEl) {
            liveMsgEl.textContent = `Captured ${res.addedCount} MIDI note${res.addedCount === 1 ? "" : "s"} onto the selected track.`;
          }
          this._sync();
          return;
        }
        if (captureTargetEl) {
          const selId = scdaw.selectedTrackId?.get?.();
          const trk = scdaw.getProject().tracks?.find((t) => t.id === selId);
          captureTargetEl.textContent = trk
            ? `Target track: ${trk.name} (${trk.kind})`
            : "Tip: Add or select a Synth or Drums track first.";
        }
        captureDialog?.showModal?.();
      });

    this.shadowRoot
      .getElementById("capture-dialog-close")
      ?.addEventListener("click", () => captureDialog?.close());
    this.shadowRoot
      .getElementById("capture-dialog-ok")
      ?.addEventListener("click", () => captureDialog?.close());
    this.shadowRoot
      .getElementById("capture-open-keys")
      ?.addEventListener("click", () => {
        captureDialog?.close();
        const keysBtn = this.shadowRoot?.getElementById("keys-btn");
        if (keysBtn) keysBtn.setAttribute("aria-pressed", "true");
        this.dispatchEvent(
          new CustomEvent("toggle-midi-keyboard", {
            detail: { visible: true },
            bubbles: true,
            composed: true,
          }),
        );
      });

    this.shadowRoot
      .getElementById("keys-btn")
      ?.addEventListener("click", (e) => {
        const btn = e.currentTarget;
        const next = btn.getAttribute("aria-pressed") !== "true";
        btn.setAttribute("aria-pressed", String(next));
        this.dispatchEvent(
          new CustomEvent("toggle-midi-keyboard", {
            detail: { visible: next },
            bubbles: true,
            composed: true,
          }),
        );
      });

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
            showErrorDialog(err, {
              title: "Recording Error",
              context: "Recording",
            });
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
            showErrorDialog(err, {
              title: "Recording Error",
              context: "Recording",
            });
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
            showErrorDialog(err, {
              title: "Recording Error",
              context: "Recording",
            });
          }
        }
      });

    const bindTransportContextLearn = (el, target) => {
      el?.addEventListener("contextmenu", (e) => {
        e.preventDefault?.();
        scdaw.midi?.startMidiLearn?.({
          ...target,
          channel: "omni",
        });
      });
    };

    const playBtnEl = this.shadowRoot.getElementById("play-btn");
    playBtnEl?.addEventListener("click", () => {
      const state = scdaw.getState();
      if (state.playing) scdaw.pause();
      else scdaw.play();
    });
    bindTransportContextLearn(playBtnEl, {
      trackId: "transport",
      param: "play",
    });

    const stopBtnEl = this.shadowRoot.getElementById("stop-btn");
    stopBtnEl?.addEventListener("click", () => {
      scdaw.stop();
    });
    bindTransportContextLearn(stopBtnEl, {
      trackId: "transport",
      param: "stop",
    });

    const recBtnEl = this.shadowRoot.getElementById("rec-btn");
    recBtnEl?.addEventListener("click", async () => {
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
          targetTrack = p.tracks.find((t) => t.recordArm && t.kind === "audio");
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
            showErrorDialog(err, {
              title: "Recording Error",
              context: "Recording",
            });
          }
        }
      }
    });

    const metroBtnEl = this.shadowRoot.getElementById("metro-btn");
    metroBtnEl?.addEventListener("click", async () => {
      const currentP = scdaw.getProject();
      const nextEnabled = !currentP.metronome?.enabled;
      if (nextEnabled) {
        try {
          await scdaw.unlockAudio?.();
        } catch (_) {}
      }
      await scdaw.sendCommand("set_metronome", { enabled: nextEnabled });
      if (nextEnabled) {
        const s = scdaw.getState();
        if (!s.playing) {
          scdaw.previewMetronomeClick?.(true);
        }
      }
    });
    bindTransportContextLearn(recBtnEl, {
      trackId: "transport",
      param: "record",
    });
    bindTransportContextLearn(metroBtnEl, {
      trackId: "transport",
      param: "metronome",
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
      bindTransportContextLearn(bpmInput, {
        trackId: "transport",
        param: "bpm",
        min: 20,
        max: 300,
      });
    }

    const swingInput = this.shadowRoot.getElementById("swing-input");
    if (swingInput) {
      swingInput.addEventListener("input", (e) => {
        const val = Number(e.target.value);
        this.shadowRoot.getElementById("swing-val").textContent = `${val}%`;
        if (typeof scdaw.setLiveTransportParam === "function") {
          scdaw.setLiveTransportParam({ swing: val / 100 });
        } else {
          scdaw.sendCommand("set_transport", { swing: val / 100 });
        }
      });
      swingInput.addEventListener("change", (e) => {
        const val = Number(e.target.value);
        if (typeof scdaw.commitLiveTransportParam === "function") {
          scdaw.setLiveTransportParam?.({ swing: val / 100 });
          scdaw.commitLiveTransportParam();
        } else {
          scdaw.sendCommand("set_transport", { swing: val / 100 });
        }
      });
      swingInput.addEventListener("dblclick", () => {
        scdaw.sendCommand("set_transport", { swing: 0 });
      });
      bindTransportContextLearn(swingInput, {
        trackId: "transport",
        param: "swing",
        min: 0,
        max: 0.5,
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

    const barsInput = this.shadowRoot.getElementById("bars-input");
    const barsDecBtn = this.shadowRoot.getElementById("bars-dec-btn");
    const barsIncBtn = this.shadowRoot.getElementById("bars-inc-btn");
    const sigSelect = this.shadowRoot.getElementById("signature-select");

    if (barsDecBtn) {
      barsDecBtn.addEventListener("click", (e) => {
        const cur = scdaw.getProject().lengthBars || 1;
        const lengthBars = calculateBarsAdjustment(cur, -1, e.shiftKey);
        scdaw.sendCommand("set_transport", { lengthBars });
      });
    }
    if (barsIncBtn) {
      barsIncBtn.addEventListener("click", (e) => {
        const cur = scdaw.getProject().lengthBars || 1;
        const lengthBars = calculateBarsAdjustment(cur, 1, e.shiftKey);
        scdaw.sendCommand("set_transport", { lengthBars });
      });
    }
    if (barsInput) {
      barsInput.addEventListener("change", (e) => {
        const val = Number(e.target.value);
        if (!Number.isNaN(val)) {
          const lengthBars = Math.max(1, Math.min(512, Math.round(val)));
          scdaw.sendCommand("set_transport", { lengthBars });
        }
      });
      barsInput.addEventListener(
        "wheel",
        (e) => {
          e.preventDefault();
          const cur = scdaw.getProject().lengthBars || 1;
          const lengthBars = calculateBarsAdjustment(
            cur,
            e.deltaY < 0 ? 1 : -1,
            e.shiftKey,
          );
          scdaw.sendCommand("set_transport", { lengthBars });
        },
        { passive: false },
      );
    }
    if (sigSelect) {
      sigSelect.addEventListener("change", (e) => {
        const signature = parseSignatureString(e.target.value);
        scdaw.sendCommand("set_transport", { signature });
      });
    }
  }
}

defineElement("shadow-claw-daw-transport", ShadowClawDawTransport);
