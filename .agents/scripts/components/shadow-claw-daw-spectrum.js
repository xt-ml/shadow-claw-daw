/**
 * .agents/scripts/components/shadow-claw-daw-spectrum.js
 *
 * Mobile-First, Responsive, ARIA-Compliant Plot Spectrum Analyzer Web Component (<shadow-claw-daw-spectrum>).
 * Ported from Audacity PlotSpectrumBase & FreqWindow.
 */

import { SHARED_STYLES } from "./shadow-claw-daw-styles.js";
import { scdaw } from "../shadow-claw-daw-engine.js";
import { effect } from "../shadow-claw-daw-signals.js";
import {
  WINDOW_FUNCTIONS,
  computePowerSpectrum,
  freqToNoteName,
} from "../shadow-claw-daw-spectral-dsp.js";

import {
  BaseElement,
  defineElement,
} from "shadow-claw/components/shadow-claw-element";

/**
 * Find nearest frequency bin in power spectrum arrays.
 * @param {Float32Array|number[]} frequencies
 * @param {Float32Array|number[]} magnitudesDb
 * @param {number} targetFreq
 * @returns {{ index: number, freq: number, db: number, note: string }}
 */
export function findNearestSpectrumBin(
  frequencies = [],
  magnitudesDb = [],
  targetFreq = 440,
) {
  const len = Math.min(frequencies.length, magnitudesDb.length);
  if (len === 0) {
    return { index: 0, freq: 0, db: -120, note: "--" };
  }
  let bestIdx = 0;
  let minDiff = Infinity;
  for (let i = 0; i < len; i++) {
    const diff = Math.abs(frequencies[i] - targetFreq);
    if (diff < minDiff) {
      minDiff = diff;
      bestIdx = i;
    }
  }
  const freq = Number(frequencies[bestIdx] || 0);
  const db = Number(magnitudesDb[bestIdx] ?? -120);
  return {
    index: bestIdx,
    freq,
    db,
    note: freqToNoteName(freq),
  };
}

/**
 * Render an accessible SVG magnitude spectrum plot (log or linear frequency axis).
 */
export function renderSpectrumSvg({
  frequencies = [],
  magnitudesDb = [],
  scale = "log",
  minFreq = 20,
  maxFreq = 20000,
  minDb = -90,
  maxDb = 0,
  peakFreq = 0,
  peakDb = -90,
  peakNote = "--",
  cursorFreq = null,
  width = 600,
  height = 180,
} = {}) {
  const len = Math.min(frequencies.length, magnitudesDb.length);
  const fMin = Math.max(20, Number(minFreq) || 20);
  const fMax = Math.max(fMin + 10, Number(maxFreq) || 20000);
  const dbMin = Number(minDb ?? -90);
  const dbMax = Math.max(dbMin + 10, Number(maxDb ?? 0));

  const freqToX = (f) => {
    const clamped = Math.max(fMin, Math.min(fMax, f));
    if (scale === "linear") {
      return ((clamped - fMin) / (fMax - fMin)) * width;
    }
    const logMin = Math.log10(fMin);
    const logMax = Math.log10(fMax);
    return ((Math.log10(clamped) - logMin) / (logMax - logMin)) * width;
  };

  const dbToY = (db) => {
    const norm = Math.max(0, Math.min(1, (db - dbMin) / (dbMax - dbMin)));
    return height - norm * (height - 18) - 10;
  };

  let pathD = "";
  let fillD = "";
  if (len > 1) {
    const pts = [];
    const stride = Math.max(1, Math.floor(len / 240));
    for (let i = 1; i < len; i += stride) {
      const f = frequencies[i];
      if (f < fMin || f > fMax) continue;
      const x = freqToX(f);
      const y = dbToY(magnitudesDb[i]);
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    if (pts.length > 0) {
      pathD = `M ${pts.join(" L ")}`;
      const firstX = pts[0].split(",")[0];
      const lastX = pts[pts.length - 1].split(",")[0];
      fillD = `${pathD} L ${lastX},${height} L ${firstX},${height} Z`;
    }
  }

  const gridFreqs =
    scale === "linear"
      ? [2000, 5000, 10000, 15000]
      : [50, 100, 200, 500, 1000, 2000, 5000, 10000];
  const gridHtml = gridFreqs
    .filter((f) => f >= fMin && f <= fMax)
    .map((f) => {
      const x = freqToX(f);
      const label = f >= 1000 ? `${f / 1000}k` : String(f);
      return `<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${height}" stroke="rgba(255,255,255,0.08)" stroke-width="1" />
        <text x="${(x + 3).toFixed(1)}" y="${height - 3}" fill="rgba(148,163,184,0.8)" font-size="9">${label}</text>`;
    })
    .join("");

  const peakX = peakFreq >= fMin ? freqToX(peakFreq) : 0;
  const peakY = dbToY(peakDb);
  const peakMarker =
    peakFreq >= fMin
      ? `<circle cx="${peakX.toFixed(1)}" cy="${peakY.toFixed(1)}" r="4" fill="#fde047" stroke="#0f172a" stroke-width="1.2" />
         <text x="${Math.min(width - 95, peakX + 6).toFixed(1)}" y="${Math.max(12, peakY - 4).toFixed(1)}" fill="#fde047" font-size="10">${Math.round(peakFreq)} Hz (${peakNote})</text>`
      : "";

  const cursorLine =
    cursorFreq && cursorFreq >= fMin && cursorFreq <= fMax
      ? `<line x1="${freqToX(cursorFreq).toFixed(1)}" y1="0" x2="${freqToX(cursorFreq).toFixed(1)}" y2="${height}" stroke="rgba(255,255,255,0.45)" stroke-dasharray="3 3" stroke-width="1" />`
      : "";

  return `
    <svg class="scdaw-spectrum__svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Frequency spectrum plot, peak ${Math.round(peakFreq)} Hz (${peakNote}) at ${peakDb.toFixed(1)} dB">
      ${gridHtml}
      ${fillD ? `<path d="${fillD}" fill="rgba(128, 212, 219, 0.2)" />` : ""}
      ${pathD ? `<path d="${pathD}" fill="none" stroke="var(--accent, #80d4db)" stroke-width="1.8" />` : ""}
      ${cursorLine}
      ${peakMarker}
    </svg>
  `.trim();
}

export class ShadowClawDawSpectrum extends BaseElement {
  constructor() {
    super();
    if (this.attachShadow) {
      this.attachShadow({ mode: "open" });
    }
    this._selectedClipId = null;
    this._fftSize = 2048;
    this._windowType = "hann";
    this._scale = "log";
    this._cursorFreq = null;
  }

  connectedCallback() {
    this.render();
    this._dispose = effect(() => {
      scdaw.project.get();
      scdaw.selectedTrackId?.get();
      scdaw.liveRevision?.get?.();
      this.render();
    });
  }

  disconnectedCallback() {
    if (this._dispose) this._dispose();
  }

  _resolveActiveClip() {
    const p = scdaw.getProject();
    const selTrackId = scdaw.selectedTrackId?.get?.();
    const audioTracks = (p.tracks || []).filter((t) => t.kind === "audio");
    const track =
      audioTracks.find((t) => t.id === selTrackId) ||
      audioTracks.find((t) => (t.audioClips || []).length > 0) ||
      audioTracks[0] ||
      null;
    if (!track) return { track: null, clip: null, clips: [] };
    const clips = track.audioClips || [];
    const clip =
      clips.find((c) => c.id === this._selectedClipId) || clips[0] || null;
    if (clip) this._selectedClipId = clip.id;
    return { track, clip, clips };
  }

  render() {
    if (!this.shadowRoot) return;
    const { track, clip, clips } = this._resolveActiveClip();
    const sampleBuf = clip ? scdaw.getSample?.(clip.sample) : null;
    const sr = sampleBuf?.sampleRate || 44100;
    const pcm = sampleBuf ? sampleBuf.getChannelData(0) : new Float32Array(0);
    const spec = computePowerSpectrum(pcm, {
      fftSize: this._fftSize,
      windowType: this._windowType,
      sampleRate: sr,
    });
    const svgHtml = renderSpectrumSvg({
      ...spec,
      scale: this._scale,
      maxFreq: Math.min(20000, sr / 2),
      cursorFreq: this._cursorFreq,
    });

    let cursorText = `Peak: ${Math.round(spec.peakFreq)} Hz (${spec.peakNote}) · ${spec.peakDb.toFixed(1)} dB`;
    if (this._cursorFreq) {
      const bin = findNearestSpectrumBin(
        spec.frequencies,
        spec.magnitudesDb,
        this._cursorFreq,
      );
      cursorText = `Cursor: ${Math.round(bin.freq)} Hz (${bin.note}) · ${bin.db.toFixed(1)} dB | ${cursorText}`;
    }

    this.shadowRoot.innerHTML = `
      <style>
        ${SHARED_STYLES}
        :host {
          display: block;
          width: 100%;
          box-sizing: border-box;
          container-type: inline-size;
          container-name: shadow-claw-daw-spectrum;
        }
        .scdaw-spectrum {
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
          padding: 0.65rem;
          background: var(--bg-panel, #12181a);
          border: 1px solid var(--border, #3f4849);
          border-radius: 6px;
          color: var(--text, #dde4e4);
        }
        .scdaw-spectrum__header {
          display: flex;
          flex-direction: column;
          gap: 0.35rem;
        }
        .scdaw-spectrum__controls {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.35rem;
        }
        .scdaw-spectrum select,
        .scdaw-spectrum button {
          font: inherit;
          color: inherit;
          min-height: 30px;
        }
        .scdaw-spectrum__plot {
          width: 100%;
          height: 170px;
          background: var(--bg-app, #0b1011);
          border: 1px solid var(--border, #3f4849);
          border-radius: 4px;
          overflow: hidden;
        }
        .scdaw-spectrum__svg {
          width: 100%;
          height: 100%;
          display: block;
        }
        .scdaw-spectrum__readout {
          font-size: 0.74rem;
          color: var(--shadow-claw-text-secondary, #94a3b8);
        }
        @container shadow-claw-daw-spectrum (min-width: 640px) {
          .scdaw-spectrum__header {
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
          }
          .scdaw-spectrum__plot {
            height: 200px;
          }
        }
        @supports not (container-type: inline-size) {
          @media (min-width: 640px) {
            .scdaw-spectrum__header {
              flex-direction: row;
              justify-content: space-between;
              align-items: center;
            }
          }
        }
        @media (pointer: coarse) {
          .scdaw-spectrum select,
          .scdaw-spectrum button {
            min-height: 44px;
            min-width: 44px;
          }
        }
      </style>
      <section class="scdaw-spectrum" role="region" aria-label="Plot Spectrum Frequency Analyzer">
        <div class="scdaw-spectrum__header">
          <strong>📊 Plot Spectrum</strong>
          <div class="scdaw-spectrum__controls">
            <select id="spec-clip-select" aria-label="Select audio clip for spectrum">
              ${
                clips.length
                  ? clips
                      .map(
                        (c) =>
                          `<option value="${c.id}" ${c.id === clip?.id ? "selected" : ""}>${track?.name || "Audio"}: ${c.name}</option>`,
                      )
                      .join("")
                  : `<option value="">No audio clips</option>`
              }
            </select>
            <select id="spec-fft-select" aria-label="FFT Size">
              ${[256, 512, 1024, 2048, 4096, 8192]
                .map(
                  (n) =>
                    `<option value="${n}" ${n === this._fftSize ? "selected" : ""}>FFT ${n}</option>`,
                )
                .join("")}
            </select>
            <select id="spec-win-select" aria-label="FFT Window Function">
              ${WINDOW_FUNCTIONS.map(
                (w) =>
                  `<option value="${w}" ${w === this._windowType ? "selected" : ""}>${w}</option>`,
              ).join("")}
            </select>
            <select id="spec-scale-select" aria-label="Frequency Axis Scale">
              <option value="log" ${this._scale === "log" ? "selected" : ""}>Log Hz</option>
              <option value="linear" ${this._scale === "linear" ? "selected" : ""}>Linear Hz</option>
            </select>
          </div>
        </div>
        <div id="spec-plot" class="scdaw-spectrum__plot" tabindex="0" role="region" aria-label="Spectrum graph">
          ${svgHtml}
        </div>
        <div id="spec-readout" class="scdaw-spectrum__readout" aria-live="polite">${cursorText}</div>
      </section>
    `;

    this._attachListeners(sr);
  }

  _attachListeners(sr) {
    const root = this.shadowRoot;
    root.getElementById("spec-clip-select")?.addEventListener("change", (e) => {
      this._selectedClipId = e.target.value || null;
      this.render();
    });
    root.getElementById("spec-fft-select")?.addEventListener("change", (e) => {
      this._fftSize = Number(e.target.value) || 2048;
      this.render();
    });
    root.getElementById("spec-win-select")?.addEventListener("change", (e) => {
      this._windowType = e.target.value || "hann";
      this.render();
    });
    root
      .getElementById("spec-scale-select")
      ?.addEventListener("change", (e) => {
        this._scale = e.target.value || "log";
        this.render();
      });
    const plot = root.getElementById("spec-plot");
    plot?.addEventListener("pointermove", (e) => {
      const rect = plot.getBoundingClientRect?.();
      if (!rect || !rect.width) return;
      const frac = Math.max(
        0,
        Math.min(1, (e.clientX - rect.left) / rect.width),
      );
      const fMin = 20;
      const fMax = Math.min(20000, sr / 2);
      this._cursorFreq =
        this._scale === "linear"
          ? fMin + frac * (fMax - fMin)
          : fMin * Math.pow(fMax / fMin, frac);
      this.render();
    });
  }
}

defineElement("shadow-claw-daw-spectrum", ShadowClawDawSpectrum);
