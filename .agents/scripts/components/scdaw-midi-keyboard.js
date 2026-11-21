/**
 * .agents/scripts/components/scdaw-midi-keyboard.js
 *
 * Accessible, mobile-first, responsive Software MIDI Keyboard (<scdaw-midi-keyboard>).
 * Supports multi-touch pointer play, drag glissando, Hold (latch) mode,
 * Sustain toggle, QWERTY shortcut playback, and real-time 3D depressed key feedback.
 */

import { scdaw } from "../scdaw-engine.js";
import { effect } from "../scdaw-signals.js";
import { QWERTY_LAYOUTS, getQwertyKeyMapForLayout } from "../scdaw-midi-io.js";
import { SHARED_STYLES } from "./scdaw-styles.js";

const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];
const BLACK_SEMITONES = new Set([1, 3, 6, 8, 10]);

const BaseElement = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

export function pitchToNoteName(pitch) {
  const p = Math.max(0, Math.min(127, Math.round(Number(pitch) || 0)));
  const name = NOTE_NAMES[p % 12];
  const octave = Math.floor(p / 12) - 1;
  return `${name}${octave}`;
}

export function buildPianoKeys(
  startOctave = 4,
  octaveCount = 2,
  keyLayout = "ableton",
) {
  const keys = [];
  const startPitch = Math.max(0, (Math.round(startOctave) + 1) * 12);
  const count = Math.max(1, Math.round(octaveCount) * 12);
  const shortcutMap = getQwertyKeyMapForLayout(keyLayout);
  for (let i = 0; i < count; i++) {
    const pitch = startPitch + i;
    if (pitch > 127) break;
    const semitone = pitch % 12;
    keys.push({
      pitch,
      name: pitchToNoteName(pitch),
      isBlack: BLACK_SEMITONES.has(semitone),
      isC: semitone === 0,
      shortcut: shortcutMap.get(i) || null,
    });
  }
  return keys;
}

export function resolveKeyElementFromPoint(
  root,
  clientX,
  clientY,
  selector = ".piano-key",
) {
  if (!root || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
    return null;
  }
  const el =
    typeof root.elementFromPoint === "function"
      ? root.elementFromPoint(clientX, clientY)
      : typeof document !== "undefined" &&
          typeof document.elementFromPoint === "function"
        ? document.elementFromPoint(clientX, clientY)
        : null;
  const keyEl = el?.closest?.(selector) || null;
  if (!keyEl) return null;
  if (typeof root.contains === "function" && !root.contains(keyEl)) {
    return null;
  }
  return keyEl;
}

export class DawMidiKeyboardElement extends BaseElement {
  constructor() {
    super();
    this.attachShadow?.({ mode: "open" });
    this._octave = 4;
    this._octaveCount = 2;
    this._keyLayout = "ableton";
    this._sustain = false;
    this._holdMode = false;
    this._activePointers = new Map();
    this._latchedPitches = new Set();
    this._pressedPitches = new Set();
    this._boundRoot = null;
    this._dispose = null;
    this._disposeSoftwareState = null;
  }

  connectedCallback() {
    const sw = scdaw.midi?.software;
    if (sw) {
      if (Number.isFinite(sw.octave)) this._octave = sw.octave;
      if (sw.keyLayout) this._keyLayout = sw.keyLayout;
    }
    this.render();
    this._bindEvents();
    this._dispose = effect(() => {
      const live = scdaw.activeLivePitches?.get?.() || [];
      this._syncPressedStates(live);
    });
    if (sw?.state?.get) {
      this._disposeSoftwareState = effect(() => {
        const next = sw.state.get();
        if (!next) return;
        let changed = false;
        if (Number.isFinite(next.octave) && next.octave !== this._octave) {
          this._octave = next.octave;
          changed = true;
        }
        if (next.keyLayout && next.keyLayout !== this._keyLayout) {
          this._keyLayout = next.keyLayout;
          changed = true;
        }
        if (changed) this.render();
      });
    }
  }

  disconnectedCallback() {
    if (this._dispose) {
      this._dispose();
      this._dispose = null;
    }
    if (this._disposeSoftwareState) {
      this._disposeSoftwareState();
      this._disposeSoftwareState = null;
    }
    this._releaseAllPointers();
    scdaw.midi?.software?.releaseAll?.();
  }

  _isPitchHeldByActivePointer(pitch) {
    for (const activePitch of this._activePointers.values()) {
      if (activePitch === pitch) return true;
    }
    return false;
  }

  _isPitchHeldByQwerty(pitch) {
    return Boolean(scdaw.midi?.software?.isPitchHeldByKey?.(pitch));
  }

  _releaseActivePointers() {
    const activePitches = new Set();
    for (const pitch of this._activePointers.values()) {
      if (Number.isFinite(pitch)) activePitches.add(pitch);
    }
    this._activePointers.clear();
    for (const pitch of activePitches) {
      if (
        !this._latchedPitches.has(pitch) &&
        !this._isPitchHeldByQwerty(pitch)
      ) {
        scdaw.midi?.software?.noteOff?.(pitch);
      }
    }
  }

  releaseTransientNotes() {
    this._releaseActivePointers();
    scdaw.midi?.software?.releaseHeldKeys?.({
      shouldReleasePitch: (pitch) => !this._latchedPitches.has(pitch),
    });
    this._syncPressedStates();
  }

  _shiftOctave(delta) {
    const nextOctave = Math.max(0, Math.min(7, this._octave + delta));
    if (nextOctave === this._octave) return;
    this._releaseActivePointers();
    this._octave = nextOctave;
    scdaw.midi?.software?.setOctave?.(nextOctave);
    this.render();
  }

  _toggleKeyLayout() {
    const nextLayout =
      this._keyLayout === "two-octave" ? "ableton" : "two-octave";
    this._keyLayout = nextLayout;
    scdaw.midi?.software?.setKeyLayout?.(nextLayout);
    this.render();
  }

  handleQwertyKeyDown(e) {
    const sw = scdaw.midi?.software;
    if (!sw || !e) return false;

    const delta = sw.resolveOctaveDelta?.(e.key, { code: e.code }) || 0;
    if (delta !== 0) {
      if (!e.repeat) {
        this._shiftOctave(delta);
      }
      e.preventDefault?.();
      return true;
    }

    const resolved = sw.resolveNotePitch?.(e.key, { code: e.code });
    if (!resolved) return false;

    e.preventDefault?.();
    if (e.repeat) return true;

    if (this._holdMode) {
      const pitch = resolved.pitch;
      if (this._latchedPitches.has(pitch)) {
        this._latchedPitches.delete(pitch);
        if (
          !this._isPitchHeldByActivePointer(pitch) &&
          !this._isPitchHeldByQwerty(pitch)
        ) {
          sw.noteOff?.(pitch);
        }
      } else {
        this._latchedPitches.add(pitch);
        sw.noteOn?.(pitch, 0.8);
      }
      this._syncPressedStates();
      return true;
    }

    sw.keyDown?.(e.key, { code: e.code, repeat: e.repeat });
    this._syncPressedStates();
    return true;
  }

  handleQwertyKeyUp(e) {
    const sw = scdaw.midi?.software;
    if (!sw || !e) return;
    sw.keyUp?.(e.key, {
      code: e.code,
      shouldReleasePitch: (pitch) =>
        !this._latchedPitches.has(pitch) &&
        !this._isPitchHeldByActivePointer(pitch),
    });
    this._syncPressedStates();
  }

  _syncPressedStates(livePitches = scdaw.activeLivePitches?.get?.() || []) {
    const activePointerPitches = [];
    for (const pitch of this._activePointers.values()) {
      if (Number.isFinite(pitch)) activePointerPitches.push(pitch);
    }
    const next = new Set([
      ...livePitches,
      ...this._latchedPitches,
      ...activePointerPitches,
    ]);
    this._pressedPitches = next;
    if (!this.shadowRoot) return;
    const keyEls = this.shadowRoot.querySelectorAll(".piano-key");
    for (const el of keyEls) {
      const pitch = Number(el.dataset.pitch);
      const isDown = next.has(pitch);
      const cur = el.getAttribute("aria-pressed") === "true";
      if (cur !== isDown) {
        el.setAttribute("aria-pressed", String(isDown));
      }
    }
  }

  _releaseAllPointers() {
    this._releaseActivePointers();
    for (const pitch of this._latchedPitches) {
      if (Number.isFinite(pitch)) {
        scdaw.midi?.software?.noteOff?.(pitch);
      }
    }
    this._latchedPitches.clear();
    this._pressedPitches.clear();
    this._syncPressedStates([]);
  }

  _bindEvents() {
    const root = this.shadowRoot;
    if (!root || this._boundRoot === root) return;
    this._boundRoot = root;

    root.addEventListener("click", (e) => {
      const btn = e.target?.closest?.("button");
      if (!btn) return;
      if (btn.id === "oct-down") {
        this._shiftOctave(-1);
      } else if (btn.id === "oct-up") {
        this._shiftOctave(1);
      } else if (btn.id === "hold-btn") {
        this._holdMode = !this._holdMode;
        if (!this._holdMode) {
          for (const pitch of this._latchedPitches) {
            if (
              !this._isPitchHeldByActivePointer(pitch) &&
              !this._isPitchHeldByQwerty(pitch)
            ) {
              scdaw.midi?.software?.noteOff?.(pitch);
            }
          }
          this._latchedPitches.clear();
        }
        this.render();
      } else if (btn.id === "sustain-btn") {
        this._sustain = !this._sustain;
        const trackId = scdaw.selectedTrackId.get();
        if (trackId) scdaw.setSustainPedal?.(trackId, this._sustain);
        this.render();
      } else if (btn.id === "layout-btn") {
        this._toggleKeyLayout();
      } else if (btn.id === "panic-btn") {
        this._releaseAllPointers();
        scdaw.midi?.software?.releaseAll?.();
        scdaw.panic?.();
        this.render();
      } else if (btn.id === "close-btn") {
        this.releaseTransientNotes();
        this.hidden = true;
        this.dispatchEvent(new CustomEvent("close", { bubbles: true }));
      }
    });

    root.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      const keyBtn = e.target?.closest?.(".piano-key");
      if (!keyBtn) return;
      const pitch = Number(keyBtn.dataset.pitch);
      if (!Number.isFinite(pitch)) return;

      if (this._holdMode) {
        if (this._latchedPitches.has(pitch)) {
          this._latchedPitches.delete(pitch);
          if (
            !this._isPitchHeldByActivePointer(pitch) &&
            !this._isPitchHeldByQwerty(pitch)
          ) {
            scdaw.midi?.software?.noteOff?.(pitch);
          }
        } else {
          this._latchedPitches.add(pitch);
          scdaw.midi?.software?.noteOn?.(pitch, 0.8);
        }
        this._syncPressedStates();
        return;
      }

      if (typeof keyBtn.setPointerCapture === "function") {
        try {
          keyBtn.setPointerCapture(e.pointerId);
        } catch (_) {}
      }
      this._activePointers.set(e.pointerId, pitch);
      scdaw.midi?.software?.noteOn?.(pitch, 0.8);
      this._syncPressedStates();
    });

    const endPointer = (e) => {
      if (!this._activePointers.has(e.pointerId)) return;
      const pitch = this._activePointers.get(e.pointerId);
      this._activePointers.delete(e.pointerId);
      if (
        Number.isFinite(pitch) &&
        !this._latchedPitches.has(pitch) &&
        !this._isPitchHeldByActivePointer(pitch) &&
        !this._isPitchHeldByQwerty(pitch)
      ) {
        scdaw.midi?.software?.noteOff?.(pitch);
      }
      this._syncPressedStates();
    };

    root.addEventListener("pointermove", (e) => {
      if (!this._activePointers.has(e.pointerId)) return;
      if (this._holdMode) return;
      if (
        e.pointerType === "mouse" &&
        typeof e.buttons === "number" &&
        e.buttons === 0
      ) {
        endPointer(e);
        return;
      }
      if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;

      const keyBtn = resolveKeyElementFromPoint(
        root,
        e.clientX,
        e.clientY,
        ".piano-key",
      );
      const rawPitch = keyBtn ? Number(keyBtn.dataset.pitch) : null;
      const newPitch = Number.isFinite(rawPitch) ? rawPitch : null;
      const oldPitch = this._activePointers.get(e.pointerId);
      if (newPitch === oldPitch) return;

      this._activePointers.set(e.pointerId, newPitch);
      if (
        Number.isFinite(oldPitch) &&
        !this._latchedPitches.has(oldPitch) &&
        !this._isPitchHeldByActivePointer(oldPitch) &&
        !this._isPitchHeldByQwerty(oldPitch)
      ) {
        scdaw.midi?.software?.noteOff?.(oldPitch);
      }
      if (newPitch !== null) {
        scdaw.midi?.software?.noteOn?.(newPitch, 0.8);
      }
      this._syncPressedStates();
    });

    root.addEventListener("pointerup", endPointer);
    root.addEventListener("pointercancel", endPointer);
    root.addEventListener("lostpointercapture", endPointer);

    root.addEventListener("keydown", (e) => {
      const keyBtn = e.target.closest(".piano-key");
      if (!keyBtn) return;
      const pitch = Number(keyBtn.dataset.pitch);
      if (e.key === "ArrowRight") {
        e.preventDefault();
        root.querySelector(`.piano-key[data-pitch="${pitch + 1}"]`)?.focus();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        root.querySelector(`.piano-key[data-pitch="${pitch - 1}"]`)?.focus();
      } else if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
        e.preventDefault();
        if (this._holdMode) {
          if (this._latchedPitches.has(pitch)) {
            this._latchedPitches.delete(pitch);
            scdaw.midi?.software?.noteOff?.(pitch);
          } else {
            this._latchedPitches.add(pitch);
            scdaw.midi?.software?.noteOn?.(pitch, 0.8);
          }
        } else {
          this._pressedPitches.add(pitch);
          scdaw.midi?.software?.noteOn?.(pitch, 0.8);
        }
        this._syncPressedStates();
      }
    });

    root.addEventListener("keyup", (e) => {
      const keyBtn = e.target.closest(".piano-key");
      if (!keyBtn) return;
      const pitch = Number(keyBtn.dataset.pitch);
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (!this._holdMode && !this._latchedPitches.has(pitch)) {
          this._pressedPitches.delete(pitch);
          scdaw.midi?.software?.noteOff?.(pitch);
          this._syncPressedStates();
        }
      }
    });
  }

  render() {
    if (!this.shadowRoot) return;
    const layout = QWERTY_LAYOUTS[this._keyLayout] || QWERTY_LAYOUTS.ableton;
    const keys = buildPianoKeys(this._octave, this._octaveCount, layout.id);

    this.shadowRoot.innerHTML = `
      <style>
        ${SHARED_STYLES}
        :host {
          display: block;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          container-type: inline-size;
          container-name: scdaw-midi-keyboard;
          background: var(--bg-card, rgb(26, 33, 33));
          border-top: 1px solid var(--border, rgb(63, 72, 73));
          -webkit-user-select: none;
          user-select: none;
        }
        :host([hidden]) {
          display: none;
        }
        .kbd-shell {
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 6px 10px 8px;
        }
        .kbd-toolbar {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          font-size: 11px;
        }
        .kbd-controls {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
        }
        .kbd-btn {
          min-width: 28px;
          min-height: 28px;
          padding: 4px 8px;
          border-radius: 4px;
          border: 1px solid var(--border, rgb(63, 72, 73));
          background: var(--bg-elevated, rgb(37, 43, 44));
          color: var(--text-primary, #dde4e4);
          font-size: 11px;
          cursor: pointer;
        }
        .kbd-btn[aria-pressed="true"] {
          background: var(--accent, rgb(128, 212, 219));
          color: var(--on-accent, rgb(0, 54, 58));
          border-color: var(--accent, rgb(128, 212, 219));
          font-weight: 700;
          box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.35);
        }
        .kbd-hint {
          color: var(--text-secondary, #879394);
          font-family: var(--mono, monospace);
        }
        .keys-strip {
          display: flex;
          align-items: stretch;
          overflow-x: auto;
          touch-action: pan-x;
          gap: 2px;
          padding: 2px 2px 6px;
        }
        .piano-key {
          flex: 1 0 28px;
          min-width: 28px;
          height: 84px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-end;
          gap: 2px;
          padding-bottom: 5px;
          border-radius: 0 0 5px 5px;
          border: 1px solid #1e2326;
          background: linear-gradient(180deg, #ffffff 0%, #e5e9ec 100%);
          color: #1f272a;
          font-size: 9px;
          font-weight: 700;
          cursor: pointer;
          touch-action: none;
          box-shadow: 0 3px 0 #9aa3a8, 0 4px 8px rgba(0, 0, 0, 0.35);
          transition: transform 0.04s ease, box-shadow 0.04s ease, background 0.05s ease;
        }
        .piano-key--black {
          flex: 0 0 22px;
          min-width: 22px;
          height: 54px;
          background: linear-gradient(180deg, #2b3038 0%, #14171c 100%);
          color: #cfd8dc;
          z-index: 2;
          margin: 0 -11px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.7), inset 0 -3px 0 #090b0e;
        }
        .piano-key__shortcut {
          pointer-events: none;
          font-family: var(--mono, monospace);
          font-size: 8px;
          line-height: 1;
          padding: 1px 3px;
          border-radius: 3px;
          background: rgba(15, 23, 26, 0.12);
          color: #334145;
        }
        .piano-key--black .piano-key__shortcut {
          background: rgba(255, 255, 255, 0.14);
          color: #e2e8f0;
        }
        .piano-key[aria-pressed="true"] .piano-key__shortcut {
          background: rgba(0, 54, 58, 0.2);
          color: var(--on-accent, rgb(0, 54, 58));
        }
        .piano-key__note {
          pointer-events: none;
          line-height: 1;
        }
        .piano-key[aria-pressed="true"] {
          transform: translateY(2px);
          background: linear-gradient(180deg, rgba(128, 212, 219, 0.9) 0%, var(--accent, rgb(128, 212, 219)) 100%);
          color: var(--on-accent, rgb(0, 54, 58));
          box-shadow: inset 0 3px 8px rgba(0, 0, 0, 0.45), inset 0 1px 2px rgba(0, 0, 0, 0.6), 0 0 10px rgba(128, 212, 219, 0.45);
        }
        .piano-key--black[aria-pressed="true"] {
          transform: translateY(2px);
          background: linear-gradient(180deg, rgb(92, 184, 194) 0%, var(--accent, rgb(128, 212, 219)) 100%);
          color: var(--on-accent, rgb(0, 54, 58));
          box-shadow: inset 0 3px 8px rgba(0, 0, 0, 0.65), 0 0 10px rgba(128, 212, 219, 0.55);
        }
        @container scdaw-midi-keyboard (min-width: 600px) {
          .piano-key {
            height: 96px;
          }
          .piano-key--black {
            height: 62px;
          }
        }
        @supports not (container-type: inline-size) {
          @media (min-width: 600px) {
            .piano-key {
              height: 96px;
            }
          }
        }
        @media (pointer: coarse) {
          .kbd-btn {
            min-width: 44px;
            min-height: 44px;
          }
          .piano-key {
            min-width: 44px;
            flex-basis: 44px;
            height: 110px;
          }
          .piano-key--black {
            min-width: 32px;
            flex-basis: 32px;
            margin: 0 -16px;
            height: 68px;
          }
        }
      </style>
      <div class="kbd-shell" role="group" aria-label="MIDI Piano Keyboard">
        <div class="kbd-toolbar">
          <div class="kbd-controls">
            <button id="oct-down" class="kbd-btn" type="button" aria-label="Octave Down">- Oct</button>
            <span class="kbd-oct-label">Oct ${this._octave}</span>
            <button id="oct-up" class="kbd-btn" type="button" aria-label="Octave Up">+ Oct</button>
            <button id="hold-btn" class="kbd-btn" type="button" aria-pressed="${this._holdMode ? "true" : "false"}" title="Latch/Hold notes on click or tap until clicked again">Hold</button>
            <button id="sustain-btn" class="kbd-btn" type="button" aria-pressed="${this._sustain ? "true" : "false"}" title="Sustain pedal (CC64)">Sustain</button>
            <button id="panic-btn" class="kbd-btn" type="button" aria-label="All Notes Off">Panic</button>
          </div>
          <div class="kbd-controls">
            <button
              id="layout-btn"
              class="kbd-btn"
              type="button"
              aria-pressed="${layout.id === "two-octave" ? "true" : "false"}"
              aria-label="Toggle QWERTY keyboard layout (current: ${layout.label})"
              title="Switch between Ableton (A–', Z/X octave) and 2-Octave (Z–M / Q–U, -/= octave) layouts"
            >Keys: ${layout.label}</button>
            <span class="kbd-hint">${layout.hint}</span>
            <button id="close-btn" class="kbd-btn" type="button" aria-label="Hide MIDI Keyboard">Hide</button>
          </div>
        </div>
        <div class="keys-strip">
          ${keys
            .map(
              (k) => `<button
                type="button"
                class="piano-key ${k.isBlack ? "piano-key--black" : ""}"
                data-pitch="${k.pitch}"
                ${k.shortcut ? `aria-keyshortcuts="${k.shortcut}"` : ""}
                aria-label="${k.name} (MIDI ${k.pitch})"
                aria-pressed="${this._pressedPitches.has(k.pitch) ? "true" : "false"}"
              >${k.shortcut ? `<span class="piano-key__shortcut" aria-hidden="true">${k.shortcut}</span>` : ""}${k.isC ? `<span class="piano-key__note" aria-hidden="true">${k.name}</span>` : ""}</button>`,
            )
            .join("")}
        </div>
      </div>
    `;
  }
}

if (
  typeof customElements !== "undefined" &&
  !customElements.get("scdaw-midi-keyboard")
) {
  customElements.define("scdaw-midi-keyboard", DawMidiKeyboardElement);
}
