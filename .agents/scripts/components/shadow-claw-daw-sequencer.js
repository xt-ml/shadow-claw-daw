/**
 * .agents/scripts/components/shadow-claw-daw-sequencer.js
 *
 * 16-Step Pattern Step Sequencer Web Component (<shadow-claw-daw-sequencer>).
 * Ported concepts from openDAW Pattern Sequencer with step-memory fixes.
 */

import { SHARED_STYLES } from "./shadow-claw-daw-styles.js";
import { scdaw } from "../scdaw-engine.js";
import { effect } from "../scdaw-signals.js";
import { pitchToName, ppqnToStep, stepsPerBar } from "../scdaw.js";

import {
  BaseElement,
  defineElement,
} from "shadow-claw/components/shadow-claw-element";

export class ShadowClawDawSequencer extends BaseElement {
  constructor() {
    super();
    if (this.attachShadow) {
      this.attachShadow({ mode: "open" });
    }
    this._rafId = null;
  }

  connectedCallback() {
    this._dirty = false;
    this._lastRenderSignature = null;
    if (!this.classList?.contains("hidden")) {
      this.render();
    } else {
      this._dirty = true;
    }
    this._startLoop();
    if (
      typeof MutationObserver !== "undefined" &&
      typeof this.getAttribute === "function"
    ) {
      try {
        this._classObserver = new MutationObserver(() => {
          if (this._dirty && !this.classList?.contains("hidden")) {
            this.render();
          }
        });
        this._classObserver.observe(this, {
          attributes: true,
          attributeFilter: ["class"],
        });
      } catch (_) {}
    }
    this._dispose = effect(() => {
      const p = scdaw.project.get();
      if (this.classList?.contains("hidden")) {
        this._dirty = true;
        return;
      }
      const sig = this._computeRenderSignature(p);
      const hasGrid = Boolean(
        this.shadowRoot?.querySelector(".grid-container"),
      );
      if (sig === this._lastRenderSignature && hasGrid) {
        this._syncSteps(p);
      } else {
        this.render();
      }
    });
  }

  disconnectedCallback() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._dispose) this._dispose();
    if (this._classObserver) this._classObserver.disconnect();
  }

  _computeRenderSignature(p) {
    if (!p) return "";
    const trackSigs = (p.tracks || [])
      .map((t) => `${t.id}|${t.kind}|${t.name}`)
      .join(";");
    return `${p.lengthBars}|${(p.signature || []).join("/")}|${trackSigs}`;
  }

  _syncSteps(p) {
    if (!this.shadowRoot || !p) return;
    const drumSet = new Set();
    const synthStepMap = new Map();
    for (const track of p.tracks) {
      if (track.kind === "drums") {
        for (const n of track.notes || []) {
          drumSet.add(`${track.id}:${n.pitch}:${ppqnToStep(n.position)}`);
        }
      } else {
        for (const n of track.notes || []) {
          const key = `${track.id}:${ppqnToStep(n.position)}`;
          if (!synthStepMap.has(key)) synthStepMap.set(key, n);
        }
      }
    }

    const cells = this.shadowRoot.querySelectorAll(".seq-cell");
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      const trackId = cell.dataset?.track;
      const pitch = cell.dataset?.pitch;
      const step = cell.dataset?.step;
      const isActive =
        drumSet.has(`${trackId}:${pitch}:${step}`) ||
        synthStepMap.has(`${trackId}:${step}`);
      cell.classList.toggle("active", isActive);
      cell.setAttribute?.("aria-pressed", String(isActive));
    }
  }

  _startLoop() {
    let lastStep = -1;
    const update = () => {
      const s = scdaw.getState();
      if (s.step !== lastStep) {
        lastStep = s.step;
        this._highlightStep(s.step);
      }
      this._rafId = requestAnimationFrame(update);
    };
    this._rafId = requestAnimationFrame(update);
  }

  _highlightStep(step) {
    if (!this.shadowRoot) return;
    const cells = this.shadowRoot.querySelectorAll(".seq-cell");
    cells.forEach((c) => {
      const cStep = Number(c.dataset.step);
      c.classList.toggle("playing", cStep === step);
    });
  }

  render() {
    if (!this.shadowRoot) return;
    if (this.classList?.contains("hidden")) {
      this._dirty = true;
      return;
    }
    this._dirty = false;
    const p = scdaw.project.get();
    this._lastRenderSignature = this._computeRenderSignature(p);
    const numSteps = (p.lengthBars || 1) * stepsPerBar(p.signature);

    let rowsHtml = "";
    for (const track of p.tracks) {
      if (track.kind === "drums") {
        const drumStepSet = new Set();
        for (const n of track.notes) {
          drumStepSet.add(`${n.pitch}:${ppqnToStep(n.position)}`);
        }
        const drumLanes = [
          { pitch: 36, name: "Kick" },
          { pitch: 38, name: "Snare" },
          { pitch: 39, name: "Clap" },
          { pitch: 42, name: "Hi-Hat" },
          { pitch: 46, name: "Open Hat" },
        ];
        for (const lane of drumLanes) {
          const barStepCount = stepsPerBar(p.signature || [4, 4]);
          rowsHtml += `
            <div class="seq-row" role="row" aria-label="${lane.name}">
              <div class="seq-label">${lane.name}</div>
              <div class="seq-cells">
                ${Array.from({ length: numSteps }, (_, step) => {
                  const hasNote = drumStepSet.has(`${lane.pitch}:${step}`);
                  const isBarStart = step % barStepCount === 0;
                  const isBeatStart = step % 4 === 0;
                  return `<div class="seq-cell ${hasNote ? "active" : ""} ${isBarStart ? "bar-start" : ""} ${isBeatStart ? "beat-start" : ""}" role="button" tabindex="0" aria-pressed="${hasNote}" aria-label="${lane.name} step ${step + 1}" data-track="${track.id}" data-pitch="${lane.pitch}" data-step="${step}"></div>`;
                }).join("")}
              </div>
            </div>
          `;
        }
      } else {
        // Synth track overview row
        const stepNoteMap = new Map();
        for (const n of track.notes) {
          const st = ppqnToStep(n.position);
          if (!stepNoteMap.has(st)) stepNoteMap.set(st, n);
        }
        const barStepCount = stepsPerBar(p.signature || [4, 4]);
        rowsHtml += `
          <div class="seq-row" role="row" aria-label="${track.name}">
            <div class="seq-label">${track.name}</div>
            <div class="seq-cells">
              ${Array.from({ length: numSteps }, (_, step) => {
                const note = stepNoteMap.get(step);
                const hasNote = Boolean(note);
                const isBarStart = step % barStepCount === 0;
                const isBeatStart = step % 4 === 0;
                return `<div class="seq-cell ${hasNote ? "active" : ""} ${isBarStart ? "bar-start" : ""} ${isBeatStart ? "beat-start" : ""}" role="button" tabindex="0" aria-pressed="${hasNote}" aria-label="${track.name} step ${step + 1}${note ? ` (${pitchToName(note.pitch)})` : ""}" data-track="${track.id}" data-pitch="${note ? note.pitch : track.defaultPitch || 60}" data-step="${step}" title="${note ? pitchToName(note.pitch) : ""}"></div>`;
              }).join("")}
            </div>
          </div>
        `;
      }
    }

    this.shadowRoot.innerHTML = `
      <style>
        ${SHARED_STYLES}
        :host {
          display: block;
          width: 100%;
          box-sizing: border-box;
          container-type: inline-size;
          container-name: shadow-claw-daw-sequencer;
        }
        /* Mobile-First Base Styles */
        .scdaw-sequencer__grid,
        .grid-container {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          touch-action: pan-x;
          overscroll-behavior-x: contain;
          padding: 0.6rem;
          background: rgba(0, 0, 0, 0.2);
          box-sizing: border-box;
        }
        .scdaw-sequencer__row,
        .seq-row {
          display: flex;
          align-items: center;
          margin-bottom: 6px;
        }
        .scdaw-sequencer__label,
        .seq-label {
          width: 72px;
          min-width: 72px;
          font-size: 0.68rem;
          font-family: var(--mono);
          text-overflow: ellipsis;
          overflow: hidden;
          white-space: nowrap;
          position: sticky;
          left: 0;
          background: var(--bg-card);
          padding: 2px 4px;
          border-radius: 3px;
          z-index: 2;
        }
        .scdaw-sequencer__cells,
        .seq-cells {
          display: flex;
          gap: 4px;
        }
        .scdaw-sequencer__cell,
        .seq-cell {
          width: 32px;
          height: 32px;
          min-width: 32px;
          min-height: 32px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 4px;
          cursor: pointer;
          touch-action: manipulation;
          transition: background 0.1s, transform 0.05s;
        }
        .seq-cell:active {
          transform: scale(0.94);
        }
        .seq-cell.beat-start {
          border-left: 2px solid var(--accent);
        }
        .seq-cell.active {
          background: var(--accent);
          border-color: var(--accent);
          box-shadow: 0 0 6px var(--accent-glow, rgba(0, 242, 254, 0.3));
        }
        .seq-cell.playing {
          outline: 2px solid #ffffff;
        }

        /* Progressive Enhancement: Wide Sequencer (>= 601px) */
        @container shadow-claw-daw-sequencer (min-width: 601px) {
          .scdaw-sequencer__grid,
          .grid-container {
            padding: 0.75rem;
          }
          .scdaw-sequencer__label,
          .seq-label {
            width: 90px;
            min-width: 90px;
            font-size: 0.75rem;
          }
          .scdaw-sequencer__cell,
          .seq-cell {
            width: 30px;
            height: 30px;
            min-width: 30px;
            min-height: 30px;
          }
        }

        @supports not (container-type: inline-size) {
          @media (min-width: 601px) {
            .scdaw-sequencer__grid,
            .grid-container {
              padding: 0.75rem;
            }
            .scdaw-sequencer__label,
            .seq-label {
              width: 90px;
              min-width: 90px;
              font-size: 0.75rem;
            }
            .scdaw-sequencer__cell,
            .seq-cell {
              width: 30px;
              height: 30px;
              min-width: 30px;
              min-height: 30px;
            }
          }
        }

        @media (pointer: coarse) {
          .scdaw-sequencer__cell,
          .seq-cell {
            min-width: 34px;
            min-height: 34px;
          }
        }
      </style>
      <div class="daw-panel" role="region" aria-label="Step Sequencer (16ths)">
        <div class="daw-panel-header">
          <span>🥁 Step Sequencer (16ths)</span>
          <span class="badge">${numSteps} Steps</span>
        </div>
        <div class="grid-container" role="grid" aria-label="Step Sequencer Grid">
          ${rowsHtml}
        </div>
      </div>
    `;

    const gridContainer = this.shadowRoot.querySelector(".grid-container");
    const triggerCell = async (cell) => {
      const trackId = cell.dataset.track;
      const rawPitch = cell.dataset.pitch;
      const pitch =
        rawPitch !== undefined &&
        rawPitch !== "" &&
        !Number.isNaN(Number(rawPitch))
          ? Number(rawPitch)
          : undefined;
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
    gridContainer?.addEventListener("click", async (e) => {
      const cell = e.target?.closest?.(".seq-cell");
      if (!cell) return;
      await triggerCell(cell);
    });
    gridContainer?.addEventListener("keydown", async (e) => {
      const cell = e.target?.closest?.(".seq-cell");
      if (!cell) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault?.();
        await triggerCell(cell);
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault?.();
        const curStep = Number(cell.dataset.step);
        const nextStep = curStep + (e.key === "ArrowRight" ? 1 : -1);
        const row = cell.closest?.(".seq-row");
        const target = row?.querySelector?.(
          `.seq-cell[data-step="${nextStep}"]`,
        );
        target?.focus?.();
      }
    });
  }
}

defineElement("shadow-claw-daw-sequencer", ShadowClawDawSequencer);
