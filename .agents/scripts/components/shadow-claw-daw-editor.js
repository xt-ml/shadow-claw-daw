/**
 * .agents/scripts/components/shadow-claw-daw-editor.js
 *
 * Piano Roll & Note Inspector Web Component (<shadow-claw-daw-editor>).
 * Ported concepts from openDAW PianoRoll & OpenStudio NoteInspector.
 */

import { SHARED_STYLES } from "./shadow-claw-daw-styles.js";
import { scdaw } from "../scdaw-engine.js";
import { effect } from "../scdaw-signals.js";
import {
  pitchToName,
  PPQN,
  stepToPpqn,
  ppqnToStep,
  stepsPerBar,
} from "../scdaw.js";

import {
  BaseElement,
  defineElement,
} from "shadow-claw/components/shadow-claw-element";

const MIN_PITCH = 0; // C-1
const MAX_PITCH = 127; // G9

const CHORD_ROOTS = [
  { name: "C", semitone: 0 },
  { name: "C#", semitone: 1 },
  { name: "D", semitone: 2 },
  { name: "D#", semitone: 3 },
  { name: "E", semitone: 4 },
  { name: "F", semitone: 5 },
  { name: "F#", semitone: 6 },
  { name: "G", semitone: 7 },
  { name: "G#", semitone: 8 },
  { name: "A", semitone: 9 },
  { name: "A#", semitone: 10 },
  { name: "B", semitone: 11 },
];

export const CHORD_OPTIONS = Object.freeze([
  ...CHORD_ROOTS.map((r) =>
    Object.freeze({
      id: `${r.name}:maj`,
      label: `${r.name} Major`,
      quality: "major",
      semitone: r.semitone,
      intervals: Object.freeze([0, 4, 7]),
    }),
  ),
  ...CHORD_ROOTS.map((r) =>
    Object.freeze({
      id: `${r.name}:min`,
      label: `${r.name} Minor`,
      quality: "minor",
      semitone: r.semitone,
      intervals: Object.freeze([0, 3, 7]),
    }),
  ),
]);

export function buildChordNotes(
  chordId,
  { step = 0, durationSteps = 4, velocity = 0.8, octave = 3 } = {},
) {
  const chord = CHORD_OPTIONS.find((c) => c.id === chordId);
  if (!chord) return [];
  const rootPitch = (octave + 1) * 12 + chord.semitone;
  return chord.intervals.map((interval) => ({
    step,
    pitch: rootPitch + interval,
    durationSteps,
    velocity,
  }));
}

export function pitchToPianoRollRow(pitch) {
  const p = Math.max(MIN_PITCH, Math.min(MAX_PITCH, Math.round(pitch)));
  return MAX_PITCH - p;
}

export function pianoRollRowToPitch(row) {
  return MAX_PITCH - row;
}

export function computeCellActiveMap(notes = []) {
  const map = new Set();
  if (!Array.isArray(notes)) return map;
  for (const n of notes) {
    if (n && n.pitch !== undefined && n.position !== undefined) {
      const step = ppqnToStep(n.position);
      map.add(`${n.pitch}:${step}`);
    }
  }
  return map;
}

export function computeStepVelocity(notes = [], step = 0) {
  if (!Array.isArray(notes) || notes.length === 0) return 0;
  let maxVel = 0;
  for (const n of notes) {
    if (n && n.position !== undefined && ppqnToStep(n.position) === step) {
      const v = typeof n.velocity === "number" ? n.velocity : 0.85;
      if (v > maxVel) maxVel = v;
    }
  }
  return maxVel;
}

export function calculateVelocityFromPointer({ clientY, rect } = {}) {
  if (!rect || !rect.height || rect.height <= 0) return 0.85;
  const raw = 1 - (clientY - rect.top) / rect.height;
  const clamped = Math.max(0.05, Math.min(1, raw));
  return Math.round(clamped * 100) / 100;
}

export function shouldPreserveEditorDom({
  renderedTrackId = null,
  targetTrackId = null,
  renderedSteps = null,
  targetSteps = null,
  hasSkeleton = false,
} = {}) {
  if (!hasSkeleton) return false;
  if (!renderedTrackId || renderedTrackId !== targetTrackId) return false;
  if (!renderedSteps || renderedSteps !== targetSteps) return false;
  return true;
}

export function resolveEditorScrollPosition({
  currentScrollTop = null,
  notes = [],
  rowHeight = 22,
  viewportHeight = 340,
  minPitch = MIN_PITCH,
  maxPitch = MAX_PITCH,
} = {}) {
  if (
    currentScrollTop !== null &&
    currentScrollTop !== undefined &&
    !Number.isNaN(currentScrollTop)
  ) {
    return Math.max(0, currentScrollTop);
  }

  // If there are notes, center the viewport around the average note pitch; otherwise C4 (60)
  const pitches = Array.isArray(notes)
    ? notes.map((n) => n.pitch).filter((p) => typeof p === "number")
    : [];
  const targetPitch =
    pitches.length > 0
      ? Math.round(pitches.reduce((a, b) => a + b, 0) / pitches.length)
      : 60;
  const clampedPitch = Math.max(minPitch, Math.min(maxPitch, targetPitch));
  const row = maxPitch - clampedPitch;
  const targetY = row * rowHeight;
  const centered =
    targetY - Math.floor(viewportHeight / 2) + Math.floor(rowHeight / 2);
  return Math.max(0, centered);
}

export function resolvePianoRollKeyFromPoint(root, clientX, clientY) {
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
  const keyEl = el?.closest?.(".pr-key[data-pitch]") || null;
  if (!keyEl) return null;
  if (typeof root.contains === "function" && !root.contains(keyEl)) {
    return null;
  }
  return keyEl;
}

export function setupPianoRollKeyAudition(
  gridArea,
  { root, getTrackId, previewNote } = {},
) {
  if (!gridArea) return;
  const activePointers = new Map();
  let suppressClickKey = null;

  const setKeyPressed = (keyEl, pressed) => {
    keyEl?.setAttribute?.("aria-pressed", pressed ? "true" : "false");
  };

  const isKeyHeldByAnyPointer = (targetKeyEl) => {
    if (!targetKeyEl) return false;
    for (const state of activePointers.values()) {
      if (state.keyEl === targetKeyEl) return true;
    }
    return false;
  };

  const audition = (pitch) => {
    const trackId = getTrackId?.();
    if (!trackId || !Number.isFinite(pitch)) return;
    previewNote?.(trackId, pitch, 0.85, 240);
  };

  const endPointer = (e, { isCancel = false } = {}) => {
    if (!activePointers.has(e.pointerId)) return;
    const state = activePointers.get(e.pointerId);
    activePointers.delete(e.pointerId);
    if (state.keyEl && !isKeyHeldByAnyPointer(state.keyEl)) {
      setKeyPressed(state.keyEl, false);
    }
    if (
      (isCancel || state.keyEl !== state.downKeyEl) &&
      suppressClickKey === state.downKeyEl
    ) {
      suppressClickKey = null;
    }
  };

  gridArea.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const keyEl = e.target?.closest?.(".pr-key[data-pitch]");
    if (!keyEl) return;
    const pitch = Number(keyEl.dataset.pitch);
    if (!Number.isFinite(pitch)) return;

    if (typeof keyEl.setPointerCapture === "function") {
      try {
        keyEl.setPointerCapture(e.pointerId);
      } catch (_) {}
    }
    activePointers.set(e.pointerId, { pitch, keyEl, downKeyEl: keyEl });
    suppressClickKey = keyEl;
    setKeyPressed(keyEl, true);
    audition(pitch);
  });

  gridArea.addEventListener("pointermove", (e) => {
    const state = activePointers.get(e.pointerId);
    if (!state) return;
    if (
      e.pointerType === "mouse" &&
      typeof e.buttons === "number" &&
      e.buttons === 0
    ) {
      endPointer(e, { isCancel: true });
      return;
    }
    if (!Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return;

    const nextKey = resolvePianoRollKeyFromPoint(root, e.clientX, e.clientY);
    const rawPitch = nextKey ? Number(nextKey.dataset.pitch) : null;
    const newPitch = Number.isFinite(rawPitch) ? rawPitch : null;
    const newKeyEl = newPitch !== null ? nextKey : null;
    if (newPitch === state.pitch && newKeyEl === state.keyEl) return;

    const prevKeyEl = state.keyEl;
    state.pitch = newPitch;
    state.keyEl = newKeyEl;
    if (
      prevKeyEl &&
      prevKeyEl !== newKeyEl &&
      !isKeyHeldByAnyPointer(prevKeyEl)
    ) {
      setKeyPressed(prevKeyEl, false);
    }
    if (newKeyEl) {
      setKeyPressed(newKeyEl, true);
      audition(newPitch);
    }
  });

  gridArea.addEventListener("pointerup", (e) =>
    endPointer(e, { isCancel: false }),
  );
  gridArea.addEventListener("pointercancel", (e) =>
    endPointer(e, { isCancel: true }),
  );
  gridArea.addEventListener("lostpointercapture", (e) =>
    endPointer(e, { isCancel: true }),
  );

  gridArea.addEventListener("click", (e) => {
    const keyEl = e.target?.closest?.(".pr-key[data-pitch]");
    if (!keyEl) return;
    if (suppressClickKey === keyEl) {
      suppressClickKey = null;
      return;
    }
    e.preventDefault?.();
    const pitch = Number(keyEl.dataset.pitch);
    audition(pitch);
  });

  gridArea.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const keyEl = e.target?.closest?.(".pr-key[data-pitch]");
    if (!keyEl) return;
    e.preventDefault?.();
    const pitch = Number(keyEl.dataset.pitch);
    audition(pitch);
  });
}

function computeNotesSignature(notes) {
  if (!Array.isArray(notes) || notes.length === 0) return "0";
  let hash = notes.length;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    hash =
      ((hash * 31) ^
        ((n.position | 0) +
          ((n.pitch | 0) << 7) +
          ((n.duration | 0) << 14) +
          Math.round((n.velocity ?? 0.8) * 1000))) |
      0;
  }
  return `${notes.length}:${hash}`;
}

export class ShadowClawDawEditor extends BaseElement {
  constructor() {
    super();
    if (this.attachShadow) {
      this.attachShadow({ mode: "open" });
    }
    this._selectedTrackId = null;
    this._selectedNote = null;
    this._renderedTrackId = null;
    this._renderedNumSteps = null;
    this._gridScrollTop = null;
    this._gridScrollLeft = null;
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
    const p = scdaw.project.get();
    const sharedTrackId = scdaw.selectedTrackId?.get();
    if (sharedTrackId && p.tracks.some((t) => t.id === sharedTrackId)) {
      this._selectedTrackId = sharedTrackId;
    } else if (
      !this._selectedTrackId ||
      !p.tracks.some((t) => t.id === this._selectedTrackId)
    ) {
      this._selectedTrackId =
        p.tracks.find((t) => t.kind === "synth")?.id || p.tracks[0]?.id;
    }

    const currentTrack = p.tracks.find((t) => t.id === this._selectedTrackId);
    const numSteps = (p.lengthBars || 1) * stepsPerBar(p.signature);

    const gridEl = this.shadowRoot.querySelector(".grid-area");
    const hasSkeleton = Boolean(gridEl);

    // Fast in-place DOM update when track and dimensions haven't changed:
    // Preserves scroll position, pointer/touch state, and active focus.
    if (
      shouldPreserveEditorDom({
        renderedTrackId: this._renderedTrackId,
        targetTrackId: this._selectedTrackId,
        renderedSteps: this._renderedNumSteps,
        targetSteps: numSteps,
        hasSkeleton,
      })
    ) {
      const notesSig = computeNotesSignature(currentTrack?.notes);
      if (
        this._lastSyncedTrackId !== this._selectedTrackId ||
        this._lastSyncedNotesSig !== notesSig ||
        this._lastSyncedNumSteps !== numSteps
      ) {
        this._syncNotes(currentTrack, numSteps);
      }
      return;
    }

    // Save previous scroll position before full render
    const savedScrollTop = gridEl ? gridEl.scrollTop : this._gridScrollTop;
    const savedScrollLeft = gridEl ? gridEl.scrollLeft : this._gridScrollLeft;

    this._renderSkeleton(p, currentTrack, numSteps);

    // Restore or compute initial scroll position
    const newGrid = this.shadowRoot.querySelector(".grid-area");
    if (newGrid) {
      const targetScrollTop = resolveEditorScrollPosition({
        currentScrollTop: savedScrollTop,
        notes: currentTrack?.notes,
        rowHeight: 22,
        viewportHeight: newGrid.clientHeight || 340,
      });
      newGrid.scrollTop = targetScrollTop;
      if (savedScrollLeft !== null) {
        newGrid.scrollLeft = savedScrollLeft;
      }

      newGrid.addEventListener(
        "scroll",
        () => {
          this._gridScrollTop = newGrid.scrollTop;
          this._gridScrollLeft = newGrid.scrollLeft;
        },
        { passive: true },
      );
    }

    this._renderedTrackId = this._selectedTrackId;
    this._renderedNumSteps = numSteps;
    this._lastSyncedTrackId = this._selectedTrackId;
    this._lastSyncedNotesSig = computeNotesSignature(currentTrack?.notes);
    this._lastSyncedNumSteps = numSteps;
    this._attachEventListeners();
  }

  _syncNotes(currentTrack, numSteps) {
    if (!this.shadowRoot) return;
    this._lastSyncedTrackId = this._selectedTrackId;
    this._lastSyncedNotesSig = computeNotesSignature(currentTrack?.notes);
    this._lastSyncedNumSteps = numSteps;

    // Update note inspector text
    const trackNameEl = this.shadowRoot.getElementById("inspector-track-name");
    if (trackNameEl) {
      trackNameEl.textContent = currentTrack?.name || "None";
    }
    const notesCountEl = this.shadowRoot.getElementById(
      "inspector-notes-count",
    );
    if (notesCountEl) {
      notesCountEl.textContent = String(currentTrack?.notes.length || 0);
    }

    // Fast O(1) set lookup for active cells
    const activeMap = computeCellActiveMap(currentTrack?.notes);
    const cells = this.shadowRoot.querySelectorAll(".pr-cell");
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const key = `${cell.dataset.pitch}:${cell.dataset.step}`;
      const active = activeMap.has(key);
      cell.classList.toggle("active", active);
      cell.setAttribute?.("aria-pressed", String(active));
    }

    // Pre-index step velocities in O(N) instead of 1,728 x N scans
    const stepVelMap = new Map();
    if (Array.isArray(currentTrack?.notes)) {
      for (const n of currentTrack.notes) {
        const st = ppqnToStep(n.position);
        const v = n.velocity ?? 0.8;
        const prev = stepVelMap.get(st) ?? 0;
        if (v > prev) stepVelMap.set(st, v);
      }
    }

    // Update velocity stalks
    const stalks = this.shadowRoot.querySelectorAll(".vel-stalk");
    const bars = this.shadowRoot.querySelectorAll(".vel-bar");
    for (let step = 0; step < numSteps && step < bars.length; step++) {
      const vel = stepVelMap.get(step) ?? 0;
      const hasNote = vel > 0;
      const velPct = hasNote ? Math.round(vel * 100) : 0;
      if (bars[step]) {
        bars[step].style.height = `${velPct}%`;
        bars[step].style.opacity = hasNote ? "1" : "0.1";
      }
      if (stalks[step]) {
        stalks[step].classList.toggle("has-note", hasNote);
        stalks[step].setAttribute?.("aria-valuenow", String(velPct));
        stalks[step].title = hasNote
          ? `Step ${step + 1}: Velocity ${velPct}% (drag to adjust)`
          : `Step ${step + 1}: Empty`;
      }
    }
  }

  _renderSkeleton(p, currentTrack, numSteps) {
    // Pre-index active cells & step velocities in O(N) once per skeleton build
    const activeMap = computeCellActiveMap(currentTrack?.notes);
    const stepVelMap = new Map();
    if (Array.isArray(currentTrack?.notes)) {
      for (const n of currentTrack.notes) {
        const st = ppqnToStep(n.position);
        const v = n.velocity ?? 0.8;
        const prev = stepVelMap.get(st) ?? 0;
        if (v > prev) stepVelMap.set(st, v);
      }
    }

    // Build all MIDI octave pitch rows (G9 down to C-1)
    const rows = [];
    for (let pitch = MAX_PITCH; pitch >= MIN_PITCH; pitch--) {
      rows.push({
        pitch,
        name: pitchToName(pitch),
        isBlack: pitchToName(pitch).includes("#"),
      });
    }

    this.shadowRoot.innerHTML = `
      <style>
        ${SHARED_STYLES}
        :host {
          display: block;
          width: 100%;
          box-sizing: border-box;
          container-type: inline-size;
          container-name: shadow-claw-daw-editor;
        }
        /* Mobile First Base Styles (Stacked responsive editor) */
        .scdaw-editor__container,
        .editor-container {
          display: flex;
          flex-direction: column;
          height: auto;
          overflow: hidden;
          box-sizing: border-box;
          width: 100%;
          max-width: 100%;
        }
        .scdaw-editor__inspector,
        .inspector {
          width: 100%;
          min-width: 0;
          background: var(--bg-card);
          border-right: none;
          border-bottom: 1px solid var(--border);
          padding: 0.4rem 0.6rem;
          display: flex;
          flex-direction: row;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: 0.4rem;
          font-size: 0.75rem;
          box-sizing: border-box;
        }
        .scdaw-editor__grid,
        .grid-area {
          height: 260px;
          max-height: 260px;
          flex: none;
          display: flex;
          flex-direction: column;
          overflow: auto;
          background: #090e10;
          -webkit-overflow-scrolling: touch;
          touch-action: pan-x pan-y;
          overscroll-behavior: contain;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
        }
        .pr-row {
          display: flex;
          height: 22px;
          min-height: 22px;
          flex-shrink: 0;
          min-width: max-content;
          width: 100%;
          border-bottom: 1px solid var(--border-subtle);
        }
        .pr-key {
          width: 48px;
          min-width: 48px;
          box-sizing: border-box;
          background: var(--bg-card);
          border-right: 1px solid var(--border);
          font-size: 0.65rem;
          font-family: var(--mono);
          display: flex;
          align-items: center;
          padding-left: 4px;
          color: var(--shadow-claw-text-secondary, #94a3b8);
          -webkit-user-select: none;
          user-select: none;
          position: sticky;
          left: 0;
          z-index: 2;
        }
        .pr-key[data-pitch] {
          cursor: pointer;
          touch-action: none;
        }
        .pr-key.black {
          background: rgba(0, 0, 0, 0.4);
          color: #64748b;
        }
        .pr-key[data-pitch][aria-pressed="true"] {
          background: var(--accent);
          color: var(--on-accent, #00363a);
          font-weight: 700;
        }
        .pr-cells {
          display: flex;
          flex: 1;
        }
        .pr-cell {
          flex: 1;
          min-width: 24px;
          min-height: 22px;
          box-sizing: border-box;
          border-right: 1px solid var(--border-subtle);
          cursor: pointer;
          touch-action: manipulation;
          user-select: none;
          -webkit-user-select: none;
        }
        .pr-cell.beat-start {
          border-left: 1px solid rgba(128, 212, 219, 0.25);
        }
        .pr-cell.active {
          background: var(--accent);
          border-radius: 2px;
          box-shadow: inset 0 0 4px rgba(0,0,0,0.4);
        }

        /* Progressive Enhancement: Desktop Side-by-Side Inspector (>= 601px) */
        @container shadow-claw-daw-editor (min-width: 601px) {
          .scdaw-editor__container,
          .editor-container {
            flex-direction: row;
            height: 340px;
          }
          .scdaw-editor__inspector,
          .inspector {
            width: 170px;
            min-width: 140px;
            border-right: 1px solid var(--border);
            border-bottom: none;
            flex-direction: column;
            flex-wrap: nowrap;
            justify-content: flex-start;
          }
          .scdaw-editor__grid,
          .grid-area {
            flex: 1;
            height: auto;
            max-height: none;
          }
        }

        @supports not (container-type: inline-size) {
          @media (min-width: 601px) {
            .scdaw-editor__container,
            .editor-container {
              flex-direction: row;
              height: 340px;
            }
            .scdaw-editor__inspector,
            .inspector {
              width: 170px;
              min-width: 140px;
              border-right: 1px solid var(--border);
              border-bottom: none;
              flex-direction: column;
              flex-wrap: nowrap;
            }
            .scdaw-editor__grid,
            .grid-area {
              flex: 1;
              height: auto;
              max-height: none;
            }
          }
        }
        @media (pointer: coarse) {
          .pr-cell {
            min-width: 28px;
          }
          .vel-stalk {
            min-width: 28px;
          }
          #clear-track-notes-btn,
          #add-chord-select,
          #track-select {
            min-height: 44px;
          }
        }
        .velocity-stalks {
          display: flex;
          height: 40px;
          min-height: 40px;
          flex-shrink: 0;
          min-width: max-content;
          width: 100%;
          border-top: 1px solid var(--border);
          background: var(--bg-card);
          position: sticky;
          bottom: 0;
          z-index: 4;
        }
        .vel-key {
          z-index: 5;
          font-size: 0.6rem;
          font-weight: 700;
          letter-spacing: 0.04em;
          color: var(--accent);
        }
        .vel-cells {
          display: flex;
          flex: 1;
        }
        .vel-stalk {
          flex: 1;
          min-width: 24px;
          box-sizing: border-box;
          border-right: 1px solid var(--border-subtle);
          display: flex;
          align-items: flex-end;
          justify-content: center;
          padding: 3px 0;
          cursor: ns-resize;
          touch-action: none;
          user-select: none;
        }
        .vel-stalk.beat-start {
          border-left: 1px solid rgba(128, 212, 219, 0.25);
        }
        .vel-stalk:hover {
          background: rgba(128, 212, 219, 0.06);
        }
        .vel-bar {
          width: 4px;
          background: var(--accent);
          border-radius: 2px;
          margin: 0 auto;
          pointer-events: none;
        }
      </style>
      <div class="daw-panel" role="region" aria-label="Piano Roll Note Editor">
        <div class="daw-panel-header">
          <div style="display:flex; align-items:center; gap:0.6rem;">
            <span>🎹 Note Editor (Piano Roll)</span>
            <select id="track-select" aria-label="Select track for Piano Roll editor" style="background:var(--bg-elevated); color:inherit; border:1px solid var(--border); border-radius:4px; font-size:0.75rem; padding:2px 4px;">
              ${p.tracks
                .map(
                  (t) =>
                    `<option value="${t.id}" ${t.id === this._selectedTrackId ? "selected" : ""}>${t.name} (${t.kind})</option>`,
                )
                .join("")}
            </select>
          </div>
          <button id="clear-track-notes-btn" type="button" class="btn btn-icon btn-danger" aria-label="Clear all notes on selected track">Clear Notes</button>
        </div>
        <div class="editor-container">
          <div class="inspector">
            <span style="font-weight:700; color:var(--accent);">Note Inspector</span>
            <div>Track: <strong id="inspector-track-name">${currentTrack?.name || "None"}</strong></div>
            <div>Total Notes: <strong id="inspector-notes-count">${currentTrack?.notes.length || 0}</strong></div>
            <div style="margin-top:auto;">
              <select
                id="add-chord-select"
                class="scdaw-editor__chord-select"
                aria-label="Insert major or minor chord"
                style="width:100%; background:var(--bg-elevated); color:inherit; border:1px solid var(--border); border-radius:4px; font-size:0.78rem; padding:6px 8px; cursor:pointer;"
              >
                <option value="">+ Add Chord...</option>
                <optgroup label="Major Chords">
                  ${CHORD_OPTIONS.filter((c) => c.quality === "major")
                    .map((c) => `<option value="${c.id}">${c.label}</option>`)
                    .join("")}
                </optgroup>
                <optgroup label="Minor Chords">
                  ${CHORD_OPTIONS.filter((c) => c.quality === "minor")
                    .map((c) => `<option value="${c.id}">${c.label}</option>`)
                    .join("")}
                </optgroup>
              </select>
            </div>
          </div>
          <div class="grid-area">
            <div role="grid" aria-label="Piano Roll Grid">
            ${(() => {
              const barStepCount = stepsPerBar(p.signature || [4, 4]);
              return rows
                .map(
                  (r) => `
              <div class="pr-row" role="row">
                <div class="pr-key ${r.isBlack ? "black" : ""}" role="button" tabindex="0" aria-pressed="false" aria-label="Audition ${r.name}" data-pitch="${r.pitch}">${r.name}</div>
                <div class="pr-cells">
                  ${Array.from({ length: numSteps }, (_, step) => {
                    const hasNote = activeMap.has(`${r.pitch}:${step}`);
                    const isBarStart = step % barStepCount === 0;
                    const isBeatStart = step % 4 === 0;
                    return `<div class="pr-cell ${hasNote ? "active" : ""} ${isBarStart ? "bar-start" : ""} ${isBeatStart ? "beat-start" : ""}" role="button" tabindex="0" aria-pressed="${hasNote}" aria-label="${r.name} step ${step + 1}" data-pitch="${r.pitch}" data-step="${step}"></div>`;
                  }).join("")}
                </div>
              </div>
            `,
                )
                .join("");
            })()}
            </div>
            <div class="velocity-stalks" role="group" aria-label="Note Velocity Lane">
              <div class="pr-key vel-key" title="Note Velocity (drag stalks vertically to adjust)">VEL</div>
              <div class="pr-cells vel-cells">
                ${(() => {
                  const barStepCount = stepsPerBar(p.signature || [4, 4]);
                  return Array.from({ length: numSteps }, (_, step) => {
                    const vel = stepVelMap.get(step) ?? 0;
                    const hasNote = vel > 0;
                    const velPct = hasNote ? Math.round(vel * 100) : 0;
                    const isBarStart = step % barStepCount === 0;
                    const isBeatStart = step % 4 === 0;
                    const title = hasNote
                      ? `Step ${step + 1}: Velocity ${velPct}% (drag to adjust)`
                      : `Step ${step + 1}: Empty`;
                    return `
                      <div class="vel-stalk ${isBarStart ? "bar-start" : ""} ${isBeatStart ? "beat-start" : ""} ${hasNote ? "has-note" : ""}" role="slider" tabindex="0" aria-label="Step ${step + 1} velocity" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${velPct}" data-step="${step}" title="${title}">
                        <div class="vel-bar" style="height:${velPct}%; opacity:${hasNote ? 1 : 0.1};"></div>
                      </div>
                    `;
                  }).join("");
                })()}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  _attachEventListeners() {
    if (!this.shadowRoot) return;

    // Track selector
    this.shadowRoot
      .getElementById("track-select")
      ?.addEventListener("change", (e) => {
        this._selectedTrackId = e.target.value;
        if (typeof scdaw.selectTrack === "function") {
          scdaw.selectTrack(e.target.value);
        }
        this.render();
      });

    // Clear notes button
    this.shadowRoot
      .getElementById("clear-track-notes-btn")
      ?.addEventListener("click", () => {
        if (this._selectedTrackId) {
          scdaw.sendCommand("clear_notes", { trackId: this._selectedTrackId });
        }
      });

    // Add chord selector
    this.shadowRoot
      .getElementById("add-chord-select")
      ?.addEventListener("change", (e) => {
        const chordId = e.target?.value;
        if (!chordId || !this._selectedTrackId) return;
        const posPpqn = scdaw.state?.get?.()?.positionPpqn || 0;
        const step = Math.max(0, ppqnToStep(posPpqn));
        const chordNotes = buildChordNotes(chordId, { step });
        if (chordNotes.length > 0) {
          scdaw.sendCommand("write_notes", {
            trackId: this._selectedTrackId,
            notes: chordNotes,
            units: "steps",
            mode: "merge",
          });
        }
        e.target.value = "";
      });

    // Piano key pointer drag glissando, clicks, & keyboard Enter/Space -> audition pitch
    const gridArea = this.shadowRoot.querySelector(".grid-area");
    if (gridArea) {
      setupPianoRollKeyAudition(gridArea, {
        root: this.shadowRoot,
        getTrackId: () => this._selectedTrackId,
        previewNote: (trackId, pitch, velocity, duration) =>
          scdaw.previewNote?.(trackId, pitch, velocity, duration),
      });
    }

    // Note cell clicks & keyboard Enter/Space/Arrow navigation
    this.shadowRoot.querySelectorAll(".pr-cell").forEach((cell) => {
      const toggleCell = async (e) => {
        e.preventDefault?.();
        if (!this._selectedTrackId) return;
        const trackId = this._selectedTrackId;
        const pitch = Number(cell.dataset.pitch);
        const step = Number(cell.dataset.step);
        const res = await scdaw.sendCommand("toggle_step", {
          trackId,
          step,
          pitch,
        });
        if (res?.toggled === "on") {
          scdaw.previewNote?.(
            trackId,
            res.note?.pitch ?? pitch,
            res.note?.velocity ?? 0.85,
            res.note?.duration ?? 240,
          );
        }
      };
      cell.addEventListener("click", toggleCell);
      cell.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          toggleCell(e);
        } else if (
          e.key === "ArrowRight" ||
          e.key === "ArrowLeft" ||
          e.key === "ArrowUp" ||
          e.key === "ArrowDown"
        ) {
          e.preventDefault?.();
          const curPitch = Number(cell.dataset.pitch);
          const curStep = Number(cell.dataset.step);
          const nextPitch =
            e.key === "ArrowUp"
              ? curPitch + 1
              : e.key === "ArrowDown"
                ? curPitch - 1
                : curPitch;
          const nextStep =
            e.key === "ArrowRight"
              ? curStep + 1
              : e.key === "ArrowLeft"
                ? curStep - 1
                : curStep;
          const target = this.shadowRoot?.querySelector?.(
            `.pr-cell[data-pitch="${nextPitch}"][data-step="${nextStep}"]`,
          );
          target?.focus?.();
        }
      });
    });

    // Velocity stalk click / vertical drag / keyboard ArrowUp & ArrowDown
    this.shadowRoot.querySelectorAll(".vel-stalk").forEach((stalk) => {
      const applyVelocityFromEvent = (e) => {
        if (!this._selectedTrackId) return;
        const step = Number(stalk.dataset.step);
        const rect =
          typeof stalk.getBoundingClientRect === "function"
            ? stalk.getBoundingClientRect()
            : null;
        const velocity = calculateVelocityFromPointer({
          clientY: e.clientY,
          rect,
        });
        scdaw.sendCommand("set_step_velocity", {
          trackId: this._selectedTrackId,
          step,
          velocity,
        });
      };

      stalk.addEventListener("keydown", (e) => {
        if (!this._selectedTrackId) return;
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault?.();
        const step = Number(stalk.dataset.step);
        const curPct = Number(stalk.getAttribute("aria-valuenow") || 0);
        const delta = e.shiftKey ? 10 : 5;
        const nextPct = Math.max(
          1,
          Math.min(100, curPct + (e.key === "ArrowUp" ? delta : -delta)),
        );
        scdaw.sendCommand("set_step_velocity", {
          trackId: this._selectedTrackId,
          step,
          velocity: Number((nextPct / 100).toFixed(2)),
        });
      });

      stalk.addEventListener("pointerdown", (e) => {
        if (typeof e.preventDefault === "function") e.preventDefault();
        applyVelocityFromEvent(e);

        if (typeof window !== "undefined") {
          const onMove = (moveEvent) => applyVelocityFromEvent(moveEvent);
          const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
          };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", onUp);
          window.addEventListener("pointercancel", onUp);
        }
      });
    });
  }
}

defineElement("shadow-claw-daw-editor", ShadowClawDawEditor);
