/**
 * .agents/scripts/components/scdaw-timeline.js
 *
 * Arrangement Timeline & Track Headers Web Component (<scdaw-timeline>).
 * Ported concepts from openDAW Timeline & TrackHeader.
 */

import { SHARED_STYLES } from "./scdaw-styles.js";
import { scdaw } from "../scdaw-engine.js";
import { effect } from "../scdaw-signals.js";
import { PPQN } from "../scdaw.js";

const BaseElement = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

export function computeTimelineTicks(bars = 2, signature = [4, 4]) {
  const [numBeats] = signature;
  const ticks = [];
  for (let b = 1; b <= bars; b++) {
    for (let beat = 1; beat <= numBeats; beat++) {
      ticks.push({
        bar: b,
        beat,
        posPpqn: (b - 1) * PPQN.Bar + (beat - 1) * PPQN.Quarter,
      });
    }
  }
  return ticks;
}

export class DawTimelineElement extends BaseElement {
  constructor() {
    super();
    if (this.attachShadow) {
      this.attachShadow({ mode: "open" });
    }
    this._rafId = null;
  }

  connectedCallback() {
    this.render();
    this._startPlayheadLoop();
    this._dispose = effect(() => {
      scdaw.project.get();
      this.render();
    });
  }

  disconnectedCallback() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._dispose) this._dispose();
  }

  _startPlayheadLoop() {
    let lastPpqn = -1;
    const update = () => {
      const s = scdaw.getState();
      if (s.positionPpqn !== lastPpqn) {
        lastPpqn = s.positionPpqn;
        this._updatePlayhead(s.positionPpqn);
      }
      this._rafId = requestAnimationFrame(update);
    };
    this._rafId = requestAnimationFrame(update);
  }

  _updatePlayhead(posPpqn) {
    if (!this.shadowRoot) return;
    const p = scdaw.getProject();
    const total = (p.lengthBars || 1) * PPQN.Bar;
    const pct = (posPpqn / total) * 100;
    const marker = this.shadowRoot.getElementById("playhead-marker");
    if (marker) {
      marker.style.left = `${pct}%`;
    }
  }

  render() {
    if (!this.shadowRoot) return;
    const p = scdaw.getProject();
    const ticks = computeTimelineTicks(p.lengthBars, p.signature);
    const totalPulses = (p.lengthBars || 1) * PPQN.Bar;

    this.shadowRoot.innerHTML = `
      <style>
        ${SHARED_STYLES}
        :host {
          display: block;
        }
        .timeline-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.4rem 0.75rem;
          background: rgba(0,0,0,0.25);
          border-bottom: 1px solid var(--border);
        }
        .ruler-container {
          display: flex;
          position: relative;
          height: 24px;
          border-bottom: 1px solid var(--border);
          background: var(--bg-elevated);
          margin-left: 180px;
        }
        .ruler-tick {
          flex: 1;
          border-left: 1px solid var(--border-subtle);
          font-size: 0.65rem;
          font-family: var(--mono);
          padding-left: 4px;
          color: var(--shadow-claw-text-secondary, #94a3b8);
          display: flex;
          align-items: center;
        }
        .ruler-tick.bar-start {
          border-left: 2px solid var(--accent);
          color: var(--accent);
          font-weight: 700;
        }
        .track-row {
          display: flex;
          border-bottom: 1px solid var(--border-subtle);
          min-height: 48px;
        }
        .track-header {
          width: 180px;
          padding: 0.4rem 0.6rem;
          background: var(--bg-card);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 4px;
        }
        .track-name {
          font-size: 0.78rem;
          font-weight: 700;
          text-overflow: ellipsis;
          overflow: hidden;
          white-space: nowrap;
        }
        .lane-area {
          flex: 1;
          position: relative;
          background: rgba(0, 0, 0, 0.15);
        }
        .clip-block {
          position: absolute;
          top: 6px;
          bottom: 6px;
          border-radius: 4px;
          background: rgba(128, 212, 219, 0.25);
          border: 1px solid var(--accent);
          display: flex;
          align-items: center;
          padding-left: 6px;
          font-size: 0.7rem;
          color: #ffffff;
        }
        .playhead {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 2px;
          background: #ef4444;
          pointer-events: none;
          z-index: 10;
        }
      </style>
      <div class="daw-panel">
        <div class="timeline-header">
          <div style="display:flex; align-items:center; gap:0.6rem;">
            <span style="font-weight:700; font-size:0.8rem;">⏱ Timeline</span>
            <span class="badge">${p.lengthBars} Bars (${p.signature.join("/")})</span>
          </div>
          <div style="display:flex; gap:0.4rem;">
            <button id="add-drums-btn" class="btn btn-icon">+ Drums</button>
            <button id="add-synth-btn" class="btn btn-icon">+ Synth</button>
          </div>
        </div>
        <div class="ruler-container">
          ${ticks
            .map(
              (t) => `
            <div class="ruler-tick ${t.beat === 1 ? "bar-start" : ""}">
              ${t.beat === 1 ? t.bar : "."}
            </div>
          `,
            )
            .join("")}
          <div id="playhead-marker" class="playhead" style="left:0%;"></div>
        </div>
        <div class="track-list">
          ${p.tracks
            .map((t) => {
              return `
              <div class="track-row" data-track="${t.id}">
                <div class="track-header">
                  <div class="track-name">${t.kind === "drums" ? "🥁" : "🎹"} ${t.name}</div>
                  <div style="display:flex; gap:4px; align-items:center;">
                    <button class="btn btn-icon ${t.mute ? "btn-danger" : ""} mute-btn" data-track="${t.id}">M</button>
                    <button class="btn btn-icon ${t.solo ? "btn-primary" : ""} solo-btn" data-track="${t.id}">S</button>
                    <span style="font-size:0.65rem; color:var(--shadow-claw-text-secondary, #94a3b8);">${t.notes.length} notes</span>
                  </div>
                </div>
                <div class="lane-area">
                  <div class="clip-block" style="left:0%; width:100%;">
                    <span>${t.name} Pattern</span>
                  </div>
                </div>
              </div>
            `;
            })
            .join("")}
        </div>
      </div>
    `;

    // Add track buttons
    this.shadowRoot
      .getElementById("add-drums-btn")
      ?.addEventListener("click", () => {
        scdaw.sendCommand("add_track", { kind: "drums", name: "Drums" });
      });
    this.shadowRoot
      .getElementById("add-synth-btn")
      ?.addEventListener("click", () => {
        scdaw.sendCommand("add_track", { kind: "synth", name: "Synth" });
      });

    // Mute/Solo
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
  }
}

if (
  typeof customElements !== "undefined" &&
  !customElements.get("scdaw-timeline")
) {
  customElements.define("scdaw-timeline", DawTimelineElement);
}
