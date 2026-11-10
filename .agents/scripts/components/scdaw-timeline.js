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
    this._expandedAutomation = new Set();
    this._selectedAutoParam = new Map();
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

        .scdaw-timeline__clip--audio {
          background: rgba(167, 139, 250, 0.25);
          border: 1px solid #a78bfa;
        }

        .scdaw-timeline__automation-row {
          display: flex;
          border-bottom: 1px solid var(--border-subtle);
          background: rgba(0, 0, 0, 0.35);
          min-height: 44px;
        }

        .scdaw-timeline__automation-header {
          width: var(--track-header-w);
          min-width: var(--track-header-w);
          padding: 0.3rem 0.5rem;
          background: var(--bg-card);
          border-right: 1px solid var(--border);
          display: flex;
          align-items: center;
          gap: 4px;
          box-sizing: border-box;
          position: sticky;
          left: 0;
          z-index: 2;
        }

        .scdaw-timeline__auto-select {
          flex: 1;
          font-size: 0.68rem;
          background: var(--bg-input, #12181a);
          color: var(--text, #f1f5f9);
          border: 1px solid var(--border);
          border-radius: 3px;
          padding: 2px 4px;
        }

        .scdaw-timeline__automation-lane {
          flex: 1;
          position: relative;
          height: 44px;
          background: rgba(0, 0, 0, 0.2);
          cursor: crosshair;
        }

        .scdaw-timeline__auto-svg {
          width: 100%;
          height: 100%;
          display: block;
        }

        .scdaw-timeline__auto-point {
          cursor: pointer;
          transition: r 0.1s ease;
        }
        .scdaw-timeline__auto-point:hover {
          r: 6;
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
            <button id="add-audio-btn" class="btn btn-icon" aria-label="Add audio track">+ Audio</button>
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
              const totalBeats = (p.lengthBars || 1) * 4;

              return p.tracks
                .map((t) => {
                  const isSelected = scdaw.selectedTrackId?.get() === t.id;
                  const isSilenced = Boolean(t.mute || (hasSolo && !t.solo));
                  const isAutoExpanded = this._expandedAutomation.has(t.id);
                  const icon =
                    t.kind === "drums"
                      ? "🥁"
                      : t.kind === "audio"
                        ? "🎙️"
                        : "🎹";
                  const countLabel =
                    t.kind === "audio"
                      ? `${t.audioClips?.length || 0} clips`
                      : `${t.notes.length} notes`;

                  const currentParam =
                    this._selectedAutoParam.get(t.id) || "volume";
                  const points =
                    (t.automation && t.automation[currentParam]) || [];

                  const mapValToY = (val) => {
                    if (currentParam === "volume") {
                      return (
                        100 -
                        Math.max(0, Math.min(100, (Number(val) / 1.5) * 100))
                      );
                    }
                    if (currentParam === "pan") {
                      return (
                        100 -
                        Math.max(
                          0,
                          Math.min(100, ((Number(val) + 1) / 2) * 100),
                        )
                      );
                    }
                    if (currentParam === "cutoff") {
                      return (
                        100 -
                        Math.max(0, Math.min(100, (Number(val) / 20000) * 100))
                      );
                    }
                    return 50;
                  };

                  let svgContent = "";
                  if (points.length > 0) {
                    const coords = points.map((pt) => {
                      const x =
                        (Math.max(0, Math.min(totalBeats, pt.time)) /
                          totalBeats) *
                        100;
                      const y = mapValToY(pt.value);
                      return { x, y, pt };
                    });
                    const polyPoints = coords
                      .map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`)
                      .join(" ");
                    svgContent = `
                      <polyline points="${polyPoints}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke" />
                      ${coords
                        .map(
                          (c) => `
                        <circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4" fill="var(--accent)" stroke="#fff" stroke-width="1.5" class="scdaw-timeline__auto-point auto-point" data-track="${t.id}" data-param="${currentParam}" data-time="${c.pt.time}" />
                      `,
                        )
                        .join("")}
                    `;
                  }

                  let laneClipsHtml = "";
                  if (t.kind === "audio") {
                    if (
                      Array.isArray(t.audioClips) &&
                      t.audioClips.length > 0
                    ) {
                      laneClipsHtml = t.audioClips
                        .map((clip) => {
                          const leftPct =
                            (Math.max(0, clip.time || 0) / totalBeats) * 100;
                          const widthPct = Math.min(
                            100 - leftPct,
                            Math.max(
                              3,
                              ((clip.duration || 4) / totalBeats) * 100,
                            ),
                          );
                          return `
                            <div class="scdaw-timeline__clip scdaw-timeline__clip--audio clip-block ${isSilenced ? "scdaw-timeline__clip--muted" : ""}"
                                 style="left:${leftPct}%; width:${widthPct}%;"
                                 role="button"
                                 tabindex="0"
                                 aria-label="Audio clip ${clip.name}, beat ${clip.time}, duration ${clip.duration} beats">
                              <span style="margin-right:4px;" aria-hidden="true">🎙</span>
                              <span>${clip.name}</span>
                            </div>
                          `;
                        })
                        .join("");
                    } else {
                      laneClipsHtml = `
                        <div class="scdaw-timeline__clip scdaw-timeline__clip--audio clip-block" style="left:0%; width:100%; opacity:0.5;">
                          <span>(Empty Audio Track)</span>
                        </div>
                      `;
                    }
                  } else {
                    laneClipsHtml = `
                      <div class="scdaw-timeline__clip clip-block ${isSilenced ? "scdaw-timeline__clip--muted" : ""}" style="left:0%; width:100%;">
                        <span>${t.name} Pattern${t.mute ? " (Muted)" : ""}</span>
                      </div>
                    `;
                  }

                  return `
                <div class="scdaw-timeline__track track-row ${isSelected ? "scdaw-timeline__track--selected track-row--selected" : ""}" data-track="${t.id}" role="listitem" aria-current="${isSelected ? "true" : "false"}">
                  <div class="scdaw-timeline__track-header track-header">
                    <div class="scdaw-timeline__track-name track-name" title="${t.name}">${icon} ${t.name}</div>
                    <div style="display:flex; gap:4px; align-items:center;">
                      <button type="button" class="btn btn-icon ${t.mute ? "btn-danger" : ""} mute-btn" data-track="${t.id}" aria-label="Mute ${t.name}" aria-pressed="${Boolean(t.mute)}" title="${t.mute ? `Unmute ${t.name}` : `Mute ${t.name}`}">M</button>
                      <button type="button" class="btn btn-icon ${t.solo ? "btn-primary" : ""} solo-btn" data-track="${t.id}" aria-label="Solo ${t.name}" aria-pressed="${Boolean(t.solo)}" title="${t.solo ? `Unsolo ${t.name}` : `Solo ${t.name}`}">S</button>
                      <button type="button" class="btn btn-icon ${isAutoExpanded ? "btn-primary" : ""} auto-btn" data-track="${t.id}" aria-label="Toggle automation for ${t.name}" aria-expanded="${isAutoExpanded}" title="Automation lanes">📈</button>
                      <span style="font-size:0.65rem; color:var(--shadow-claw-text-secondary, #94a3b8);">${countLabel}</span>
                    </div>
                  </div>
                  <div class="scdaw-timeline__lane lane-area">
                    ${laneClipsHtml}
                  </div>
                </div>
                ${
                  isAutoExpanded
                    ? `
                  <div class="scdaw-timeline__automation-row automation-row" data-track="${t.id}">
                    <div class="scdaw-timeline__automation-header">
                      <select class="scdaw-timeline__auto-select auto-param-select" data-track="${t.id}" aria-label="Automation parameter for ${t.name}">
                        <option value="volume" ${currentParam === "volume" ? "selected" : ""}>Volume</option>
                        <option value="pan" ${currentParam === "pan" ? "selected" : ""}>Pan</option>
                        ${t.kind === "synth" ? `<option value="cutoff" ${currentParam === "cutoff" ? "selected" : ""}>Cutoff</option>` : ""}
                      </select>
                      <button type="button" class="btn btn-icon clear-auto-btn" data-track="${t.id}" data-param="${currentParam}" aria-label="Clear ${currentParam} automation for ${t.name}" title="Clear points">✕</button>
                    </div>
                    <div class="scdaw-timeline__automation-lane auto-lane" data-track="${t.id}" data-param="${currentParam}" title="Click to add automation point" role="application" aria-label="${currentParam} automation curve for ${t.name}">
                      <svg class="scdaw-timeline__auto-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                        ${svgContent}
                      </svg>
                    </div>
                  </div>
                `
                    : ""
                }
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

    this.shadowRoot
      .getElementById("add-audio-btn")
      ?.addEventListener("click", () => {
        scdaw.sendCommand("add_track", { kind: "audio", name: "Audio Track" });
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

    // Automation Toggle
    this.shadowRoot.querySelectorAll(".auto-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation?.();
        const id = btn.dataset.track;
        if (this._expandedAutomation.has(id)) {
          this._expandedAutomation.delete(id);
        } else {
          this._expandedAutomation.add(id);
        }
        this.render();
      });
    });

    // Automation Param Select
    this.shadowRoot.querySelectorAll(".auto-param-select").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        const id = sel.dataset.track;
        this._selectedAutoParam.set(id, e.target.value);
        this.render();
      });
    });

    // Clear Automation
    this.shadowRoot.querySelectorAll(".clear-auto-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation?.();
        const trackId = btn.dataset.track;
        const param = btn.dataset.param;
        scdaw.sendCommand("clear_automation", { trackId, param });
      });
    });

    // Click on Automation Lane to Add/Update Point
    this.shadowRoot.querySelectorAll(".auto-lane").forEach((lane) => {
      lane.addEventListener("click", (e) => {
        if (e.target.closest?.(".auto-point")) {
          // Click on point to delete it
          const ptEl = e.target.closest(".auto-point");
          const trackId = ptEl.dataset.track;
          const param = ptEl.dataset.param;
          const time = Number(ptEl.dataset.time);
          const currentProj = scdaw.getProject();
          const trk = currentProj.tracks.find((x) => x.id === trackId);
          if (trk?.automation?.[param]) {
            const filtered = trk.automation[param].filter(
              (p) => Math.abs(p.time - time) > 0.001,
            );
            scdaw.sendCommand("set_automation", {
              trackId,
              param,
              points: filtered,
            });
          }
          return;
        }

        const rect = lane.getBoundingClientRect?.() || {
          left: 0,
          top: 0,
          width: 100,
          height: 44,
        };
        const xNorm = Math.max(
          0,
          Math.min(1, (e.clientX - rect.left) / (rect.width || 1)),
        );
        const yNorm = Math.max(
          0,
          Math.min(1, 1 - (e.clientY - rect.top) / (rect.height || 1)),
        );

        const currentProj = scdaw.getProject();
        const totalBeats = (currentProj.lengthBars || 1) * 4;
        const time = Math.round(xNorm * totalBeats * 4) / 4;
        const param = lane.dataset.param;

        let value = yNorm;
        if (param === "volume") {
          value = Math.round(yNorm * 1.5 * 100) / 100;
        } else if (param === "pan") {
          value = Math.round((yNorm * 2 - 1) * 100) / 100;
        } else if (param === "cutoff") {
          value = Math.round(yNorm * 20000);
        }

        scdaw.sendCommand("set_automation", {
          trackId: lane.dataset.track,
          param,
          time,
          value,
        });
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
