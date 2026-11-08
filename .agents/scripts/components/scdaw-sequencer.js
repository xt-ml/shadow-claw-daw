/**
 * .agents/scripts/components/scdaw-sequencer.js
 *
 * 16-Step Pattern Step Sequencer Web Component (<scdaw-sequencer>).
 * Ported concepts from openDAW Pattern Sequencer with step-memory fixes.
 */

import { SHARED_STYLES } from "./scdaw-styles.js";
import { scdaw } from "../scdaw-engine.js";
import { effect } from "../scdaw-signals.js";
import { pitchToName, ppqnToStep } from "../scdaw.js";

const BaseElement = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

export class DawSequencerElement extends BaseElement {
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
      scdaw.project.get();
      this.render();
    });
  }

  disconnectedCallback() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._dispose) this._dispose();
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
    const p = scdaw.getProject();
    const numSteps = (p.lengthBars || 1) * 16;

    let rowsHtml = "";
    for (const track of p.tracks) {
      if (track.kind === "drums") {
        const drumLanes = [
          { pitch: 36, name: "Kick" },
          { pitch: 38, name: "Snare" },
          { pitch: 39, name: "Clap" },
          { pitch: 42, name: "Hi-Hat" },
          { pitch: 46, name: "Open Hat" },
        ];
        for (const lane of drumLanes) {
          rowsHtml += `
            <div class="seq-row">
              <div class="seq-label">${lane.name}</div>
              <div class="seq-cells">
                ${Array.from({ length: numSteps }, (_, step) => {
                  const hasNote = track.notes.some(
                    (n) =>
                      n.pitch === lane.pitch && ppqnToStep(n.position) === step,
                  );
                  const isBeatStart = step % 4 === 0;
                  return `<div class="seq-cell ${hasNote ? "active" : ""} ${isBeatStart ? "beat-start" : ""}" data-track="${track.id}" data-pitch="${lane.pitch}" data-step="${step}"></div>`;
                }).join("")}
              </div>
            </div>
          `;
        }
      } else {
        // Synth track overview row
        rowsHtml += `
          <div class="seq-row">
            <div class="seq-label">${track.name}</div>
            <div class="seq-cells">
              ${Array.from({ length: numSteps }, (_, step) => {
                const note = track.notes.find(
                  (n) => ppqnToStep(n.position) === step,
                );
                const hasNote = Boolean(note);
                const isBeatStart = step % 4 === 0;
                return `<div class="seq-cell ${hasNote ? "active" : ""} ${isBeatStart ? "beat-start" : ""}" data-track="${track.id}" data-pitch="${note ? note.pitch : track.defaultPitch || 60}" data-step="${step}" title="${note ? pitchToName(note.pitch) : ""}"></div>`;
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
          container-name: scdaw-sequencer;
        }
        .grid-container {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          touch-action: pan-x;
          overscroll-behavior-x: contain;
          padding: 0.75rem;
          background: rgba(0, 0, 0, 0.2);
          box-sizing: border-box;
        }
        .seq-row {
          display: flex;
          align-items: center;
          margin-bottom: 6px;
        }
        .seq-label {
          width: 90px;
          min-width: 90px;
          font-size: 0.75rem;
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
        .seq-cells {
          display: flex;
          gap: 4px;
        }
        .seq-cell {
          width: 30px;
          height: 30px;
          min-width: 30px;
          min-height: 30px;
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

        @container scdaw-sequencer (max-width: 600px) {
          .seq-label {
            width: 72px;
            min-width: 72px;
            font-size: 0.68rem;
          }
          .seq-cell {
            width: 34px;
            height: 34px;
            min-width: 34px;
            min-height: 34px;
          }
        }
      </style>
      <div class="daw-panel">
        <div class="daw-panel-header">
          <span>🥁 Step Sequencer (16ths)</span>
          <span class="badge">${numSteps} Steps</span>
        </div>
        <div class="grid-container">
          ${rowsHtml}
        </div>
      </div>
    `;

    this.shadowRoot.querySelectorAll(".seq-cell").forEach((cell) => {
      cell.addEventListener("click", () => {
        const trackId = cell.dataset.track;
        const rawPitch = cell.dataset.pitch;
        const pitch =
          rawPitch !== undefined &&
          rawPitch !== "" &&
          !Number.isNaN(Number(rawPitch))
            ? Number(rawPitch)
            : undefined;
        const step = Number(cell.dataset.step);

        scdaw.sendCommand("toggle_step", {
          trackId,
          step,
          pitch,
        });
      });
    });
  }
}

if (
  typeof customElements !== "undefined" &&
  !customElements.get("scdaw-sequencer")
) {
  customElements.define("scdaw-sequencer", DawSequencerElement);
}
