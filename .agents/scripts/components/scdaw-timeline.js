/**
 * .agents/scripts/components/scdaw-timeline.js
 *
 * Arrangement Timeline & Track Headers Web Component (<scdaw-timeline>).
 * Ported concepts from openDAW Timeline & TrackHeader.
 * Redesigned Mobile-First, Responsive, BEM, and ARIA compliant.
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
      scdaw.selectedTrackId?.get();
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
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          container-type: inline-size;
          container-name: scdaw-timeline;
          --track-header-w: 120px;
        }

        @container scdaw-timeline (min-width: 520px) {
          :host {
            --track-header-w: 180px;
          }
        }

        @supports not (container-type: inline-size) {
          @media (min-width: 640px) {
            :host {
              --track-header-w: 180px;
            }
          }
        }

        .scdaw-timeline,
        .daw-panel {
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          overflow: hidden;
        }

        .scdaw-timeline__header,
        .timeline-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.4rem 0.6rem;
          background: rgba(0, 0, 0, 0.25);
          border-bottom: 1px solid var(--border);
          flex-wrap: wrap;
          gap: 0.4rem;
        }

        .scdaw-timeline__title-group {
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
          flex-wrap: nowrap;
          white-space: nowrap;
        }

        .scdaw-timeline__actions {
          display: inline-flex;
          gap: 0.35rem;
          flex-shrink: 0;
        }

        .scdaw-timeline__scroll {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
          overscroll-behavior-x: contain;
          width: 100%;
          box-sizing: border-box;
        }

        .scdaw-timeline__ruler,
        .ruler-container {
          display: flex;
          position: relative;
          height: 24px;
          border-bottom: 1px solid var(--border);
          background: var(--bg-elevated);
          margin-left: var(--track-header-w);
          min-width: 280px;
        }

        .scdaw-timeline__tick,
        .ruler-tick {
          flex: 1;
          border-left: 1px solid var(--border-subtle);
          font-size: 0.65rem;
          font-family: var(--mono);
          padding-left: 4px;
          color: var(--shadow-claw-text-secondary, #94a3b8);
          display: flex;
          align-items: center;
          user-select: none;
        }

        .scdaw-timeline__tick--bar,
        .ruler-tick.bar-start {
          border-left: 2px solid var(--accent);
          color: var(--accent);
          font-weight: 700;
        }

        .scdaw-timeline__tracks,
        .track-list {
          display: flex;
          flex-direction: column;
          width: 100%;
        }

        .scdaw-timeline__track,
        .track-row {
          display: flex;
          border-bottom: 1px solid var(--border-subtle);
          min-height: 48px;
          min-width: 280px;
          cursor: pointer;
          transition: background 0.12s ease;
        }

        .scdaw-timeline__track--selected,
        .track-row--selected {
          background: rgba(128, 212, 219, 0.08);
        }

        .scdaw-timeline__track--selected .scdaw-timeline__track-header {
          border-left: 3px solid var(--accent);
        }

        .scdaw-timeline__track-header,
        .track-header {
          width: var(--track-header-w);
          min-width: var(--track-header-w);
          padding: 0.35rem 0.5rem;
          background: var(--bg-card);
          border-right: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 3px;
          box-sizing: border-box;
          position: sticky;
          left: 0;
          z-index: 2;
        }

        .scdaw-timeline__track-name,
        .track-name {
          font-size: 0.76rem;
          font-weight: 700;
          text-overflow: ellipsis;
          overflow: hidden;
          white-space: nowrap;
        }

        .scdaw-timeline__lane,
        .lane-area {
          flex: 1;
          position: relative;
          background: rgba(0, 0, 0, 0.15);
          min-width: 160px;
        }

        .scdaw-timeline__clip,
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
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          transition: opacity 0.12s ease;
        }

        .scdaw-timeline__clip--muted {
          opacity: 0.38;
          border-style: dashed;
          background: rgba(148, 163, 184, 0.12);
        }

        .scdaw-timeline__playhead,
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
      <div class="scdaw-timeline daw-panel" role="region" aria-label="Arrangement Timeline and Tracks">
        <div class="scdaw-timeline__header timeline-header">
          <div class="scdaw-timeline__title-group">
            <span style="font-weight:700; font-size:0.8rem;">⏱ Timeline</span>
            <span class="badge">${p.lengthBars} Bars (${p.signature.join("/")})</span>
          </div>
          <div class="scdaw-timeline__actions">
            <button id="add-drums-btn" class="btn btn-icon" aria-label="Add drum track">+ Drums</button>
            <button id="add-synth-btn" class="btn btn-icon" aria-label="Add synth track">+ Synth</button>
          </div>
        </div>

        <div class="scdaw-timeline__scroll">
          <div class="scdaw-timeline__ruler ruler-container" role="presentation">
            ${ticks
              .map(
                (t) => `
              <div class="scdaw-timeline__tick ruler-tick ${t.beat === 1 ? "scdaw-timeline__tick--bar bar-start" : ""}">
                ${t.beat === 1 ? t.bar : "."}
              </div>
            `,
              )
              .join("")}
            <div id="playhead-marker" class="scdaw-timeline__playhead playhead" style="left:0%;"></div>
          </div>

          <div class="scdaw-timeline__tracks track-list" role="list" aria-label="Audio and MIDI tracks">
            ${(() => {
              const hasSolo = p.tracks.some((trk) => trk.solo);
              return p.tracks
                .map((t) => {
                  const isSelected = scdaw.selectedTrackId?.get() === t.id;
                  const isSilenced = Boolean(t.mute || (hasSolo && !t.solo));
                  return `
                <div class="scdaw-timeline__track track-row ${isSelected ? "scdaw-timeline__track--selected track-row--selected" : ""}" data-track="${t.id}" role="listitem" aria-current="${isSelected ? "true" : "false"}">
                  <div class="scdaw-timeline__track-header track-header">
                    <div class="scdaw-timeline__track-name track-name" title="${t.name}">${t.kind === "drums" ? "🥁" : "🎹"} ${t.name}</div>
                    <div style="display:flex; gap:4px; align-items:center;">
                      <button type="button" class="btn btn-icon ${t.mute ? "btn-danger" : ""} mute-btn" data-track="${t.id}" aria-label="Mute ${t.name}" aria-pressed="${Boolean(t.mute)}" title="${t.mute ? `Unmute ${t.name}` : `Mute ${t.name}`}">M</button>
                      <button type="button" class="btn btn-icon ${t.solo ? "btn-primary" : ""} solo-btn" data-track="${t.id}" aria-label="Solo ${t.name}" aria-pressed="${Boolean(t.solo)}" title="${t.solo ? `Unsolo ${t.name}` : `Solo ${t.name}`}">S</button>
                      <span style="font-size:0.65rem; color:var(--shadow-claw-text-secondary, #94a3b8);">${t.notes.length} notes</span>
                    </div>
                  </div>
                  <div class="scdaw-timeline__lane lane-area">
                    <div class="scdaw-timeline__clip clip-block ${isSilenced ? "scdaw-timeline__clip--muted" : ""}" style="left:0%; width:100%;">
                      <span>${t.name} Pattern${t.mute ? " (Muted)" : ""}</span>
                    </div>
                  </div>
                </div>
              `;
                })
                .join("");
            })()}
          </div>
        </div>
      </div>
    `;

    // Track row click selects active track across Editor, Device Rack, and Mixer
    this.shadowRoot.querySelectorAll(".track-row").forEach((row) => {
      row.addEventListener("click", (e) => {
        if (e.target.closest?.("button")) return;
        const id = row.dataset.track;
        if (id && typeof scdaw.selectTrack === "function") {
          scdaw.selectTrack(id);
        }
      });
    });

    // Add track buttons
    this.shadowRoot
      .getElementById("add-drums-btn")
      ?.addEventListener("click", () => {
        scdaw.sendCommand("add_track", { kind: "drums", name: "Drum Kit" });
      });

    this.shadowRoot
      .getElementById("add-synth-btn")
      ?.addEventListener("click", () => {
        scdaw.sendCommand("add_track", { kind: "synth", name: "Lead Synth" });
      });

    // Mute & Solo
    this.shadowRoot.querySelectorAll(".mute-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation?.();
        const id = btn.dataset.track;
        const currentProj = scdaw.getProject();
        const t = currentProj.tracks.find((x) => x.id === id);
        if (t) scdaw.sendCommand("set_track", { trackId: id, mute: !t.mute });
      });
    });

    this.shadowRoot.querySelectorAll(".solo-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation?.();
        const id = btn.dataset.track;
        const currentProj = scdaw.getProject();
        const t = currentProj.tracks.find((x) => x.id === id);
        if (t) scdaw.sendCommand("set_track", { trackId: id, solo: !t.solo });
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
