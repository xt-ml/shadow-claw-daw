/**
 * .agents/scripts/components/scdaw-editor.js
 *
 * Piano Roll & Note Inspector Web Component (<scdaw-editor>).
 * Ported concepts from openDAW PianoRoll & OpenStudio NoteInspector.
 */

import { SHARED_STYLES } from "./scdaw-styles.js";
import { scdaw } from "../scdaw-engine.js";
import { effect } from "../scdaw-signals.js";
import { pitchToName, PPQN, stepToPpqn, ppqnToStep } from "../scdaw.js";

const BaseElement = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

const MIN_PITCH = 24; // C1
const MAX_PITCH = 84; // C6

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
  minPitch = 36,
  maxPitch = 72,
} = {}) {
  if (
    currentScrollTop !== null &&
    currentScrollTop !== undefined &&
    !Number.isNaN(currentScrollTop)
  ) {
    return Math.max(0, currentScrollTop);
  }

  // If there are notes, center the viewport around the median/lowest note pitch
  if (notes && notes.length > 0) {
    const pitches = notes
      .map((n) => n.pitch)
      .filter((p) => typeof p === "number");
    if (pitches.length > 0) {
      const avgPitch = Math.round(
        pitches.reduce((a, b) => a + b, 0) / pitches.length,
      );
      const clampedPitch = Math.max(minPitch, Math.min(maxPitch, avgPitch));
      const row = maxPitch - clampedPitch;
      const targetY = row * rowHeight;
      const centered =
        targetY - Math.floor(viewportHeight / 2) + Math.floor(rowHeight / 2);
      return Math.max(0, centered);
    }
  }

  return 0;
}

export class DawEditorElement extends BaseElement {
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
    const p = scdaw.getProject();
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
    const numSteps = (p.lengthBars || 1) * 16;

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
      this._syncNotes(currentTrack, numSteps);
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
    this._attachEventListeners();
  }

  _syncNotes(currentTrack, numSteps) {
    if (!this.shadowRoot) return;

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
    cells.forEach((cell) => {
      const pitch = Number(cell.dataset.pitch);
      const step = Number(cell.dataset.step);
      const isActive = activeMap.has(`${pitch}:${step}`);
      cell.classList.toggle("active", isActive);
    });

    // Update velocity stalks
    const stalks = this.shadowRoot.querySelectorAll(".vel-stalk");
    const bars = this.shadowRoot.querySelectorAll(".vel-bar");
    for (let step = 0; step < numSteps && step < bars.length; step++) {
      const vel = computeStepVelocity(currentTrack?.notes, step);
      const hasNote = vel > 0;
      const velPct = hasNote ? Math.round(vel * 100) : 0;
      if (bars[step]) {
        bars[step].style.height = `${velPct}%`;
        bars[step].style.opacity = hasNote ? "1" : "0.1";
      }
      if (stalks[step]) {
        stalks[step].classList.toggle("has-note", hasNote);
        stalks[step].title = hasNote
          ? `Step ${step + 1}: Velocity ${velPct}% (drag to adjust)`
          : `Step ${step + 1}: Empty`;
      }
    }
  }

  _renderSkeleton(p, currentTrack, numSteps) {
    // Build octave pitch rows (C6 down to C1)
    const rows = [];
    for (let pitch = 72; pitch >= 36; pitch--) {
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
          container-name: scdaw-editor;
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
          user-select: none;
          position: sticky;
          left: 0;
          z-index: 2;
        }
        .pr-key.black {
          background: rgba(0, 0, 0, 0.4);
          color: #64748b;
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
        @container scdaw-editor (min-width: 601px) {
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
      <div class="daw-panel">
        <div class="daw-panel-header">
          <div style="display:flex; align-items:center; gap:0.6rem;">
            <span>🎹 Note Editor (Piano Roll)</span>
            <select id="track-select" style="background:var(--bg-elevated); color:inherit; border:1px solid var(--border); border-radius:4px; font-size:0.75rem; padding:2px 4px;">
              ${p.tracks
                .map(
                  (t) =>
                    `<option value="${t.id}" ${t.id === this._selectedTrackId ? "selected" : ""}>${t.name} (${t.kind})</option>`,
                )
                .join("")}
            </select>
          </div>
          <button id="clear-track-notes-btn" class="btn btn-icon btn-danger">Clear Notes</button>
        </div>
        <div class="editor-container">
          <div class="inspector">
            <span style="font-weight:700; color:var(--accent);">Note Inspector</span>
            <div>Track: <strong id="inspector-track-name">${currentTrack?.name || "None"}</strong></div>
            <div>Total Notes: <strong id="inspector-notes-count">${currentTrack?.notes.length || 0}</strong></div>
            <div style="margin-top:auto;">
              <button id="add-chord-btn" class="btn" style="width:100%; justify-content:center;">+ C Minor Chord</button>
            </div>
          </div>
          <div class="grid-area">
            ${rows
              .map(
                (r) => `
              <div class="pr-row">
                <div class="pr-key ${r.isBlack ? "black" : ""}">${r.name}</div>
                <div class="pr-cells">
                  ${Array.from({ length: numSteps }, (_, step) => {
                    const hasNote = currentTrack?.notes.some(
                      (n) =>
                        n.pitch === r.pitch && ppqnToStep(n.position) === step,
                    );
                    const isBeatStart = step % 4 === 0;
                    return `<div class="pr-cell ${hasNote ? "active" : ""} ${isBeatStart ? "beat-start" : ""}" data-pitch="${r.pitch}" data-step="${step}"></div>`;
                  }).join("")}
                </div>
              </div>
            `,
              )
              .join("")}
            <div class="velocity-stalks" role="group" aria-label="Note Velocity Lane">
              <div class="pr-key vel-key" title="Note Velocity (drag stalks vertically to adjust)">VEL</div>
              <div class="pr-cells vel-cells">
                ${Array.from({ length: numSteps }, (_, step) => {
                  const vel = computeStepVelocity(currentTrack?.notes, step);
                  const hasNote = vel > 0;
                  const velPct = hasNote ? Math.round(vel * 100) : 0;
                  const isBeatStart = step % 4 === 0;
                  const title = hasNote
                    ? `Step ${step + 1}: Velocity ${velPct}% (drag to adjust)`
                    : `Step ${step + 1}: Empty`;
                  return `
                    <div class="vel-stalk ${isBeatStart ? "beat-start" : ""} ${hasNote ? "has-note" : ""}" data-step="${step}" title="${title}">
                      <div class="vel-bar" style="height:${velPct}%; opacity:${hasNote ? 1 : 0.1};"></div>
                    </div>
                  `;
                }).join("")}
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

    // Add chord shortcut
    this.shadowRoot
      .getElementById("add-chord-btn")
      ?.addEventListener("click", () => {
        if (this._selectedTrackId) {
          const chordNotes = [
            { step: 0, pitch: 48, durationSteps: 4, velocity: 0.8 },
            { step: 0, pitch: 51, durationSteps: 4, velocity: 0.8 },
            { step: 0, pitch: 55, durationSteps: 4, velocity: 0.8 },
          ];
          scdaw.sendCommand("write_notes", {
            trackId: this._selectedTrackId,
            notes: chordNotes,
            units: "steps",
            mode: "merge",
          });
        }
      });

    // Note cell clicks
    this.shadowRoot.querySelectorAll(".pr-cell").forEach((cell) => {
      cell.addEventListener("click", (e) => {
        e.preventDefault();
        if (!this._selectedTrackId) return;
        const pitch = Number(cell.dataset.pitch);
        const step = Number(cell.dataset.step);
        scdaw.sendCommand("toggle_step", {
          trackId: this._selectedTrackId,
          step,
          pitch,
        });
      });
    });

    // Velocity stalk click / vertical drag
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

if (
  typeof customElements !== "undefined" &&
  !customElements.get("scdaw-editor")
) {
  customElements.define("scdaw-editor", DawEditorElement);
}
