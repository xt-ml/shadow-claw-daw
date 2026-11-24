/**
 * .agents/scripts/components/scdaw-wave-editor.js
 *
 * Mobile-First, Responsive, ARIA-Compliant Audio Clip Waveform & Envelope Editor (<scdaw-wave-editor>).
 * Ported from Audacity 4 waveform/envelope interaction models & builtin DSP collection.
 */

import { SHARED_STYLES } from "./scdaw-styles.js";
import { scdaw } from "../scdaw-engine.js";
import { effect } from "../scdaw-signals.js";
import { evaluateClipGainEnvelope } from "../scdaw.js";
import { findNearestZeroCrossing } from "../scdaw-audio-dsp.js";
import { extractDroppedAudioFiles } from "./scdaw-timeline.js";
import {
  SPECTROGRAM_PALETTES,
  SPECTROGRAM_SCALES,
  computeSpectrogram,
  mapSpectrogramColor,
} from "../scdaw-spectral-dsp.js";
import "./scdaw-spectrum.js";

const BaseElement = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

/**
 * Compute min, max, and RMS amplitude buckets over a slice of PCM samples.
 *
 * @param {Float32Array|number[]} pcm
 * @param {number} [buckets=200]
 * @param {{ startFrame?: number, endFrame?: number|null }} [range]
 * @returns {Array<{ min: number, max: number, rms: number }>}
 */
export function computeWaveformEnvelope(
  pcm,
  buckets = 200,
  { startFrame = 0, endFrame = null } = {},
) {
  if (!pcm || pcm.length === 0 || buckets <= 0) return [];
  const total = pcm.length;
  const s = Math.max(0, Math.min(total - 1, Math.floor(startFrame || 0)));
  const e =
    endFrame === null || endFrame === undefined
      ? total
      : Math.max(s + 1, Math.min(total, Math.ceil(endFrame)));
  const span = e - s;
  if (span <= 0) return [];

  const count = Math.max(1, Math.round(buckets));
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const bStart = s + Math.floor((i * span) / count);
    const bEnd = Math.max(bStart + 1, s + Math.floor(((i + 1) * span) / count));
    let min = Infinity;
    let max = -Infinity;
    let sumSq = 0;
    let n = 0;
    for (let j = bStart; j < bEnd && j < e; j++) {
      const v = pcm[j];
      if (v < min) min = v;
      if (v > max) max = v;
      sumSq += v * v;
      n++;
    }
    if (n === 0) {
      out[i] = { min: 0, max: 0, rms: 0 };
    } else {
      out[i] = {
        min,
        max,
        rms: Math.sqrt(sumSq / n),
      };
    }
  }
  return out;
}

/**
 * Clamp and order a time-range selection inside [0, durationSec].
 */
export function clampWaveSelection({
  startSec = 0,
  endSec = 0,
  durationSec = 0,
} = {}) {
  const maxDur = Math.max(0, Number(durationSec) || 0);
  const a = Math.max(0, Math.min(maxDur, Number(startSec) || 0));
  const b = Math.max(0, Math.min(maxDur, Number(endSec) || 0));
  const start = Math.min(a, b);
  const end = Math.max(a, b);
  return {
    startSec: Number(start.toFixed(6)),
    endSec: Number(end.toFixed(6)),
    lengthSec: Number((end - start).toFixed(6)),
  };
}

/**
 * Snap selection endpoints to nearest upward zero crossings.
 */
export function snapSelectionToZeroCrossings(
  channels,
  selection = {},
  sampleRate = 44100,
) {
  const sr = Math.max(1, Number(sampleRate) || 44100);
  const len = channels?.[0]?.length || 0;
  if (!len) {
    return clampWaveSelection(selection);
  }
  const durSec = len / sr;
  const clamped = clampWaveSelection({ ...selection, durationSec: durSec });
  const startSample = Math.round(clamped.startSec * sr);
  const endSample = Math.round(clamped.endSec * sr);

  const zcStart = findNearestZeroCrossing(channels, startSample, sr);
  const zcEnd = findNearestZeroCrossing(channels, endSample, sr);
  return clampWaveSelection({
    startSec: zcStart.timeSec,
    endSec: zcEnd.timeSec,
    durationSec: durSec,
  });
}

/**
 * Audacity 4 drag-eat/restore semantics for clip gain envelope control points.
 * Dragging a point past neighboring points consumes them; dragging back restores
 * them from originalPoints.
 *
 * @param {Array<{ time: number, value: number }>} points
 * @param {{ index: number, timeSec: number, value: number, durationSec?: number, originalPoints?: Array<{ time: number, value: number }>|null }} options
 * @returns {{ points: Array<{ time: number, value: number }>, draggedIndex: number }}
 */
export function applyEnvelopePointDrag(
  points = [],
  {
    index = 0,
    timeSec = 0,
    value = 1,
    durationSec = Infinity,
    originalPoints = null,
  } = {},
) {
  const baseline = Array.isArray(originalPoints)
    ? originalPoints.map((p) => ({
        time: Number(p.time),
        value: Number(p.value),
      }))
    : (Array.isArray(points) ? points : []).map((p) => ({
        time: Number(p.time),
        value: Number(p.value),
      }));

  baseline.sort((a, b) => a.time - b.time);
  if (baseline.length === 0) {
    const t = Math.max(
      0,
      Number.isFinite(durationSec) ? Math.min(durationSec, timeSec) : timeSec,
    );
    const v = Math.max(0, Math.min(2, Number(value)));
    return { points: [{ time: t, value: v }], draggedIndex: 0 };
  }

  const origIdx = Math.max(0, Math.min(baseline.length - 1, Math.round(index)));
  const origTime = baseline[origIdx].time;
  const clampedTime = Math.max(
    0,
    Number.isFinite(durationSec)
      ? Math.min(durationSec, Number(timeSec) || 0)
      : Math.max(0, Number(timeSec) || 0),
  );
  const clampedValue = Math.max(0, Math.min(2, Number(value ?? 1)));

  const minBound = Math.min(origTime, clampedTime);
  const maxBound = Math.max(origTime, clampedTime);

  const kept = baseline.filter((pt, i) => {
    if (i === origIdx) return false;
    // Any original point lying strictly between original position and current drag position is consumed ("eaten")
    if (clampedTime >= origTime) {
      return !(pt.time >= origTime && pt.time <= clampedTime);
    }
    return !(pt.time <= origTime && pt.time >= clampedTime);
  });

  const movedPoint = {
    time: Number(clampedTime.toFixed(6)),
    value: Number(clampedValue.toFixed(6)),
    _isDragged: true,
  };

  const next = [...kept, movedPoint].sort((a, b) => a.time - b.time);
  const draggedIndex = next.findIndex((p) => p._isDragged);
  const cleanPoints = next.map(({ time, value: val }) => ({
    time,
    value: val,
  }));

  return {
    points: cleanPoints,
    draggedIndex: draggedIndex === -1 ? 0 : draggedIndex,
  };
}

/**
 * Compute visible [viewStartSec, viewEndSec] window from zoom and scroll fraction.
 */
export function computeWaveViewport({
  durationSec = 1,
  zoom = 1,
  scrollFrac = 0,
} = {}) {
  const dur = Math.max(0.01, Number(durationSec) || 1);
  const z = Math.max(1, Math.min(64, Number(zoom) || 1));
  const viewDurSec = dur / z;
  const maxStart = Math.max(0, dur - viewDurSec);
  const frac = Math.max(0, Math.min(1, Number(scrollFrac) || 0));
  const viewStartSec = maxStart * frac;
  const viewEndSec = Math.min(dur, viewStartSec + viewDurSec);
  return {
    viewStartSec: Number(viewStartSec.toFixed(6)),
    viewEndSec: Number(viewEndSec.toFixed(6)),
    viewDurSec: Number(viewDurSec.toFixed(6)),
  };
}

/**
 * Render accessible SVG waveform, RMS core, selection highlight, fade wedges, and gain envelope handles.
 */
export function renderWaveformSvg({
  channels = [],
  durationSec = 1,
  viewStartSec = 0,
  viewEndSec = null,
  selection = null,
  clip = null,
  sampleRate = 44100,
  width = 600,
  height = 160,
} = {}) {
  const dur = Math.max(0.01, Number(durationSec) || 1);
  const vStart = Math.max(0, Number(viewStartSec) || 0);
  const vEnd =
    viewEndSec === null || viewEndSec === undefined
      ? dur
      : Math.max(vStart + 0.001, Math.min(dur, Number(viewEndSec)));
  const vSpan = vEnd - vStart;
  const midY = height / 2;
  const ampScale = height * 0.44;

  const pcm = channels?.[0] || new Float32Array(0);
  const sr = Math.max(1, Number(sampleRate) || 44100);
  const startFrame = Math.floor(vStart * sr);
  const endFrame = Math.min(pcm.length, Math.ceil(vEnd * sr));
  const buckets = computeWaveformEnvelope(
    pcm,
    Math.min(240, Math.max(40, Math.round(width / 3))),
    { startFrame, endFrame },
  );

  let peakPolygon = "";
  let rmsPolygon = "";
  if (buckets.length > 0) {
    const topPts = [];
    const botPts = [];
    const rmsTop = [];
    const rmsBot = [];
    for (let i = 0; i < buckets.length; i++) {
      const x = (i / Math.max(1, buckets.length - 1)) * width;
      const yMax = midY - Math.max(-1, Math.min(1, buckets[i].max)) * ampScale;
      const yMin = midY - Math.max(-1, Math.min(1, buckets[i].min)) * ampScale;
      const yRmsT = midY - Math.min(1, buckets[i].rms) * ampScale;
      const yRmsB = midY + Math.min(1, buckets[i].rms) * ampScale;
      topPts.push(`${x.toFixed(1)},${yMax.toFixed(1)}`);
      botPts.unshift(`${x.toFixed(1)},${yMin.toFixed(1)}`);
      rmsTop.push(`${x.toFixed(1)},${yRmsT.toFixed(1)}`);
      rmsBot.unshift(`${x.toFixed(1)},${yRmsB.toFixed(1)}`);
    }
    peakPolygon = `<polygon class="scdaw-wave__peak" points="${topPts.concat(botPts).join(" ")}" fill="rgba(128, 212, 219, 0.35)" stroke="var(--accent, #80d4db)" stroke-width="1" />`;
    rmsPolygon = `<polygon class="scdaw-wave__rms" points="${rmsTop.concat(rmsBot).join(" ")}" fill="rgba(157, 240, 248, 0.55)" />`;
  }

  let selectionRect = "";
  if (selection && selection.lengthSec > 0.001) {
    const x1 = Math.max(
      0,
      Math.min(width, ((selection.startSec - vStart) / vSpan) * width),
    );
    const x2 = Math.max(
      0,
      Math.min(width, ((selection.endSec - vStart) / vSpan) * width),
    );
    if (x2 > x1) {
      selectionRect = `<rect class="scdaw-wave__selection" x="${x1.toFixed(1)}" y="0" width="${(x2 - x1).toFixed(1)}" height="${height}" fill="rgba(250, 204, 21, 0.18)" stroke="rgba(250, 204, 21, 0.75)" stroke-width="1" />`;
    }
  }

  let envOverlay = "";
  if (clip) {
    const envPts = Array.isArray(clip.gainEnvelope) ? clip.gainEnvelope : [];
    const hasFades =
      (Number(clip.fadeIn) || 0) > 0 || (Number(clip.fadeOut) || 0) > 0;
    if (hasFades || envPts.length > 0) {
      const curvePts = [];
      const steps = 40;
      for (let i = 0; i <= steps; i++) {
        const t = vStart + (i / steps) * vSpan;
        const g = evaluateClipGainEnvelope(clip, t, dur);
        const x = (i / steps) * width;
        const y = height - Math.max(0, Math.min(1, g / 2)) * height;
        curvePts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      }
      envOverlay += `<polyline class="scdaw-wave__env-curve" points="${curvePts.join(" ")}" fill="none" stroke="#fde047" stroke-width="1.8" />`;
    }
    envOverlay += envPts
      .map((pt, idx) => {
        if (pt.time < vStart || pt.time > vEnd) return "";
        const cx = ((pt.time - vStart) / vSpan) * width;
        const cy = height - Math.max(0, Math.min(1, pt.value / 2)) * height;
        return `<circle class="scdaw-wave__env-point" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="#fde047" stroke="#0f172a" stroke-width="1.5" data-index="${idx}" role="slider" tabindex="0" aria-label="Envelope point ${idx + 1} at ${pt.time.toFixed(2)} seconds, gain ${pt.value.toFixed(2)}" aria-valuemin="0" aria-valuemax="2" aria-valuenow="${pt.value.toFixed(2)}" />`;
      })
      .join("");
  }

  return `
    <svg class="scdaw-wave__svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Waveform display${clip ? ` for ${clip.name}` : ""}">
      <line x1="0" y1="${midY}" x2="${width}" y2="${midY}" stroke="rgba(255,255,255,0.18)" stroke-width="1" />
      ${peakPolygon}
      ${rmsPolygon}
      ${selectionRect}
      ${envOverlay}
    </svg>
  `.trim();
}

/**
 * Render an accessible SVG spectrogram heatmap with optional spectral selection overlay.
 */
export function renderSpectrogramSvg({
  spectrogram,
  palette = "roseus",
  width = 600,
  height = 160,
  freqSelection = null,
} = {}) {
  const cols = Math.max(1, spectrogram?.columns || 1);
  const rows = Math.max(1, spectrogram?.rows || 1);
  const data = spectrogram?.data || new Float32Array(cols * rows);

  // Downsample horizontally to <= 64 columns so SVG stays lightweight
  const drawCols = Math.min(64, cols);
  const cellW = width / drawCols;
  const cellH = height / rows;
  const rects = [];

  for (let dc = 0; dc < drawCols; dc++) {
    const srcCol = Math.min(cols - 1, Math.floor((dc * cols) / drawCols));
    const x = dc * cellW;
    for (let r = 0; r < rows; r++) {
      const val = data[srcCol * rows + r] || 0;
      const [cr, cg, cb] = mapSpectrogramColor(val, palette);
      const y = height - (r + 1) * cellH;
      rects.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(cellW + 0.5).toFixed(1)}" height="${(cellH + 0.5).toFixed(1)}" fill="rgb(${cr},${cg},${cb})" />`,
      );
    }
  }

  let freqSelRect = "";
  if (
    freqSelection &&
    Number.isFinite(freqSelection.lowFreq) &&
    Number.isFinite(freqSelection.highFreq)
  ) {
    const fMin = spectrogram?.minFreq ?? 20;
    const fMax = freqSelection.maxFreq ?? spectrogram?.maxFreq ?? 22050;
    const lo = Math.max(
      fMin,
      Math.min(fMax, Math.min(freqSelection.lowFreq, freqSelection.highFreq)),
    );
    const hi = Math.max(
      fMin,
      Math.min(fMax, Math.max(freqSelection.lowFreq, freqSelection.highFreq)),
    );
    const span = Math.max(1, fMax - fMin);
    const yTop = height - ((hi - fMin) / span) * height;
    const yBot = height - ((lo - fMin) / span) * height;
    freqSelRect = `<rect class="scdaw-wave__freq-selection" x="0" y="${yTop.toFixed(1)}" width="${width}" height="${Math.max(2, yBot - yTop).toFixed(1)}" fill="rgba(250, 204, 21, 0.18)" stroke="#fde047" stroke-width="1" />`;
  }

  return `
    <svg class="scdaw-wave__svg scdaw-wave__svg--spectrogram" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Spectrogram view (${palette})">
      ${rects.join("")}
      ${freqSelRect}
    </svg>
  `.trim();
}

export class DawWaveEditorElement extends BaseElement {
  constructor() {
    super();
    if (this.attachShadow) {
      this.attachShadow({ mode: "open" });
    }
    this._selectedClipId = null;
    this._zoom = 1;
    this._scrollFrac = 0;
    this._zeroCrossingSnap = true;
    this._envelopeMode = false;
    this._viewMode = "waveform"; // "waveform" | "spectrogram" | "split"
    this._palette = "roseus";
    this._specScale = "logarithmic";
    this._showSpectrum = false;
    this._selection = null;
    this._statusMessage = "";
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

  async _runAction(label, fn) {
    try {
      await fn();
      this._statusMessage = `${label} applied`;
      this._updateStatusEl();
    } catch (err) {
      this._statusMessage = err?.message || `Failed: ${label}`;
      this._updateStatusEl();
      scdaw.reportError?.(err, {
        title: "Audio Editor Error",
        context: label,
      });
    }
  }

  _updateStatusEl() {
    const el = this.shadowRoot?.getElementById("wave-status");
    if (el) el.textContent = this._statusMessage || "Ready";
  }

  render() {
    if (!this.shadowRoot) return;
    const p = scdaw.getProject();
    const { track, clip, clips } = this._resolveActiveClip();
    const sampleBuf = clip ? scdaw.getSample?.(clip.sample) : null;
    const sr = sampleBuf?.sampleRate || 44100;
    const channels = sampleBuf
      ? Array.from({ length: sampleBuf.numberOfChannels || 1 }, (_, i) =>
          sampleBuf.getChannelData(i),
        )
      : [];
    const bpm = p.bpm || 120;
    const clipDurSec = clip
      ? sampleBuf?.duration || ((clip.duration || 4) * 60) / bpm
      : 1;
    const vp = computeWaveViewport({
      durationSec: clipDurSec,
      zoom: this._zoom,
      scrollFrac: this._scrollFrac,
    });
    const waveSvgHtml = clip
      ? renderWaveformSvg({
          channels,
          durationSec: clipDurSec,
          viewStartSec: vp.viewStartSec,
          viewEndSec: vp.viewEndSec,
          selection: this._selection,
          clip,
          sampleRate: sr,
        })
      : `<div class="scdaw-wave__empty">Select an audio track or generate/import an audio clip to edit waveforms.</div>`;

    let stageBodyHtml = waveSvgHtml;
    if (
      clip &&
      (this._viewMode === "spectrogram" || this._viewMode === "split")
    ) {
      const pcm = channels[0] || new Float32Array(0);
      const sFrame = Math.floor(vp.viewStartSec * sr);
      const eFrame = Math.min(pcm.length, Math.ceil(vp.viewEndSec * sr));
      const sg = computeSpectrogram(
        pcm.subarray(sFrame, Math.max(sFrame + 1, eFrame)),
        {
          fftSize: 512,
          hopSize: 128,
          rows: 28,
          scale: this._specScale,
          sampleRate: sr,
        },
      );
      const sgSvg = renderSpectrogramSvg({
        spectrogram: sg,
        palette: this._palette,
        height: this._viewMode === "split" ? 90 : 160,
      });
      stageBodyHtml =
        this._viewMode === "split"
          ? `<div style="display:flex;flex-direction:column;height:100%;">${waveSvgHtml.replace('class="scdaw-wave__svg"', 'class="scdaw-wave__svg" style="height:50%;"')}${sgSvg.replace('class="scdaw-wave__svg scdaw-wave__svg--spectrogram"', 'class="scdaw-wave__svg scdaw-wave__svg--spectrogram" style="height:50%;"')}</div>`
          : sgSvg;
    }

    const selSummary =
      this._selection && this._selection.lengthSec > 0.001
        ? `Sel: ${this._selection.startSec.toFixed(2)}s–${this._selection.endSec.toFixed(2)}s (${this._selection.lengthSec.toFixed(2)}s)`
        : "No range selected (full clip)";

    this.shadowRoot.innerHTML = `
      <style>
        ${SHARED_STYLES}
        :host {
          display: block;
          width: 100%;
          box-sizing: border-box;
          container-type: inline-size;
          container-name: scdaw-wave-editor;
        }
        .scdaw-wave {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          padding: 0.65rem;
          background: var(--bg-panel, #12181a);
          border: 1px solid var(--border, #3f4849);
          border-radius: 6px;
          color: var(--text, #dde4e4);
        }
        .scdaw-wave__header,
        .scdaw-wave__toolbar {
          display: flex;
          flex-direction: column;
          gap: 0.4rem;
        }
        .scdaw-wave__controls-row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.35rem;
        }
        .scdaw-wave button,
        .scdaw-wave select,
        .scdaw-wave input {
          font: inherit;
          color: inherit;
          min-height: 30px;
        }
        .scdaw-wave__stage {
          position: relative;
          width: 100%;
          height: 150px;
          background: var(--bg-app, #0b1011);
          border: 1px solid var(--border, #3f4849);
          border-radius: 4px;
          overflow: hidden;
          cursor: crosshair;
          touch-action: none;
          user-select: none;
        }
        .scdaw-wave__stage--drop-target {
          outline: 2px dashed var(--shadow-claw-accent, #80d4db);
          outline-offset: -2px;
          background: rgba(128, 212, 219, 0.12);
        }
        .scdaw-wave__stage:focus-visible,
        .scdaw-wave button:focus-visible,
        .scdaw-wave select:focus-visible {
          outline: 2px solid var(--accent, #80d4db);
          outline-offset: 2px;
        }
        .scdaw-wave__svg {
          width: 100%;
          height: 100%;
          display: block;
        }
        .scdaw-wave__empty {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          padding: 1rem;
          text-align: center;
          font-size: 0.8rem;
          color: var(--shadow-claw-text-secondary, #94a3b8);
        }
        .scdaw-wave__footer {
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          gap: 0.4rem;
          font-size: 0.72rem;
          color: var(--shadow-claw-text-secondary, #94a3b8);
        }
        @container scdaw-wave-editor (min-width: 640px) {
          .scdaw-wave__header {
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
          }
          .scdaw-wave__toolbar {
            flex-direction: row;
            flex-wrap: wrap;
            justify-content: space-between;
            align-items: center;
          }
          .scdaw-wave__stage {
            height: 180px;
          }
        }
        @supports not (container-type: inline-size) {
          @media (min-width: 640px) {
            .scdaw-wave__header {
              flex-direction: row;
              justify-content: space-between;
              align-items: center;
            }
            .scdaw-wave__toolbar {
              flex-direction: row;
              flex-wrap: wrap;
              justify-content: space-between;
              align-items: center;
            }
            .scdaw-wave__stage {
              height: 180px;
            }
          }
        }
        @media (pointer: coarse) {
          .scdaw-wave button,
          .scdaw-wave select {
            min-height: 44px;
            min-width: 44px;
          }
        }
      </style>
      <section class="scdaw-wave" role="region" aria-label="Waveform and Audio Clip Editor">
        <div class="scdaw-wave__header">
          <div class="scdaw-wave__controls-row">
            <strong>🌊 Wave Editor</strong>
            <select id="wave-clip-select" aria-label="Select audio clip to edit">
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
          </div>
          <div class="scdaw-wave__controls-row">
            <button id="wave-zoom-out" type="button" class="btn btn-icon" aria-label="Zoom out waveform">−</button>
            <button id="wave-zoom-reset" type="button" class="btn btn-icon" aria-label="Reset waveform zoom">${this._zoom}x</button>
            <button id="wave-zoom-in" type="button" class="btn btn-icon" aria-label="Zoom in waveform">+</button>
            <button id="wave-zc-toggle" type="button" class="btn btn-icon ${this._zeroCrossingSnap ? "btn-primary" : ""}" aria-pressed="${this._zeroCrossingSnap}" title="Snap selection to zero crossings">ZC Snap</button>
            <button id="wave-env-toggle" type="button" class="btn btn-icon ${this._envelopeMode ? "btn-primary" : ""}" aria-pressed="${this._envelopeMode}" title="Toggle clip gain envelope editing">Envelope</button>
            <select id="wave-view-select" aria-label="Waveform or Spectrogram display mode">
              <option value="waveform" ${this._viewMode === "waveform" ? "selected" : ""}>Waveform</option>
              <option value="spectrogram" ${this._viewMode === "spectrogram" ? "selected" : ""}>Spectrogram</option>
              <option value="split" ${this._viewMode === "split" ? "selected" : ""}>Split View</option>
            </select>
            <select id="wave-palette-select" aria-label="Spectrogram color palette">
              ${SPECTROGRAM_PALETTES.map((pal) => `<option value="${pal}" ${this._palette === pal ? "selected" : ""}>${pal}</option>`).join("")}
            </select>
            <select id="wave-scale-select" aria-label="Spectrogram frequency scale">
              ${SPECTROGRAM_SCALES.map((sc) => `<option value="${sc}" ${this._specScale === sc ? "selected" : ""}>${sc}</option>`).join("")}
            </select>
            <button id="wave-spectrum-toggle" type="button" class="btn btn-icon ${this._showSpectrum ? "btn-primary" : ""}" aria-pressed="${this._showSpectrum}" title="Toggle Plot Spectrum frequency analyzer">📊 Spectrum</button>
            <select id="wave-gen-select" aria-label="Audio generator type">
              <option value="tone">Tone</option>
              <option value="noise">Noise</option>
              <option value="dtmf">DTMF</option>
              <option value="silence">Silence</option>
            </select>
            <button id="wave-gen-btn" type="button" class="btn btn-icon" aria-label="Generate new audio clip">+ Generate</button>
          </div>
        </div>

        <div id="wave-stage" class="scdaw-wave__stage" tabindex="0" role="region" aria-label="Interactive audio waveform canvas">
          ${stageBodyHtml}
        </div>

        <div class="scdaw-wave__toolbar" role="toolbar" aria-label="Audio clip editing and DSP actions">
          <div class="scdaw-wave__controls-row" role="group" aria-label="Clip edit operations">
            <button type="button" class="btn btn-icon wave-op-btn" data-op="split" ${!clip ? "disabled" : ""}>Split</button>
            <button type="button" class="btn btn-icon wave-op-btn" data-op="split_at_silences" ${!clip ? "disabled" : ""}>Split Silences</button>
            <button type="button" class="btn btn-icon wave-op-btn" data-op="trim" ${!clip || !this._selection?.lengthSec ? "disabled" : ""}>Trim</button>
            <button type="button" class="btn btn-icon wave-op-btn" data-op="silence_range" ${!clip || !this._selection?.lengthSec ? "disabled" : ""}>Silence</button>
            <button type="button" class="btn btn-icon wave-op-btn" data-op="duplicate" ${!clip ? "disabled" : ""}>Duplicate</button>
            <button type="button" class="btn btn-icon wave-op-btn" data-op="mute" ${!clip ? "disabled" : ""}>${clip?.muted ? "Unmute" : "Mute"}</button>
            <button id="wave-add-label-btn" type="button" class="btn btn-icon" ${!clip ? "disabled" : ""}>+ Label</button>
          </div>
          <div class="scdaw-wave__controls-row" role="group" aria-label="Offline DSP processors">
            <button type="button" class="btn btn-icon wave-dsp-btn" data-effect="normalize" ${!clip ? "disabled" : ""}>Normalize</button>
            <button type="button" class="btn btn-icon wave-dsp-btn" data-effect="loudness" ${!clip ? "disabled" : ""}>Loudness</button>
            <button type="button" class="btn btn-icon wave-dsp-btn" data-effect="amplify" ${!clip ? "disabled" : ""}>Amplify +3dB</button>
            <button type="button" class="btn btn-icon wave-dsp-btn" data-effect="remove_dc" ${!clip ? "disabled" : ""}>Remove DC</button>
            <button type="button" class="btn btn-icon wave-dsp-btn" data-effect="reverse" ${!clip ? "disabled" : ""}>Reverse</button>
            <button type="button" class="btn btn-icon wave-dsp-btn" data-effect="invert" ${!clip ? "disabled" : ""}>Invert</button>
            <button type="button" class="btn btn-icon wave-dsp-btn" data-effect="click_removal" ${!clip ? "disabled" : ""}>De-Click</button>
            <button type="button" class="btn btn-icon wave-dsp-btn" data-effect="fade_in" ${!clip ? "disabled" : ""}>Fade In</button>
            <button type="button" class="btn btn-icon wave-dsp-btn" data-effect="fade_out" ${!clip ? "disabled" : ""}>Fade Out</button>
            <button type="button" class="btn btn-icon wave-dsp-btn" data-effect="bake_fades" ${!clip ? "disabled" : ""}>Bake Fades</button>
            <button type="button" class="btn btn-icon wave-dsp-btn" data-effect="truncate_silence" ${!clip ? "disabled" : ""}>Truncate Silence</button>
            <button type="button" class="btn btn-icon wave-dsp-btn" data-effect="change_tempo" ${!clip ? "disabled" : ""}>Tempo +10%</button>
            <button type="button" class="btn btn-icon wave-dsp-btn" data-effect="change_pitch" ${!clip ? "disabled" : ""}>Pitch +2st</button>
            <button type="button" class="btn btn-icon wave-dsp-btn" data-effect="change_speed" ${!clip ? "disabled" : ""}>Speed +10%</button>
            <button type="button" class="btn btn-icon wave-dsp-btn" data-effect="noise_profile" ${!clip ? "disabled" : ""}>Get Noise Profile</button>
            <button type="button" class="btn btn-icon wave-dsp-btn" data-effect="noise_reduction" ${!clip ? "disabled" : ""}>Reduce Noise</button>
          </div>
        </div>

        ${this._showSpectrum ? `<scdaw-spectrum></scdaw-spectrum>` : ""}

        <div class="scdaw-wave__footer">
          <span id="wave-selection-readout">${selSummary}</span>
          <span id="wave-status" aria-live="polite">${this._statusMessage || "Ready"}</span>
        </div>
      </section>
    `;

    this._attachListeners({ track, clip, channels, sr, clipDurSec, vp, bpm });
  }

  _attachListeners({ track, clip, channels, sr, clipDurSec, vp, bpm }) {
    const srRoot = this.shadowRoot;
    srRoot
      .getElementById("wave-clip-select")
      ?.addEventListener("change", (e) => {
        this._selectedClipId = e.target.value || null;
        this._selection = null;
        this.render();
      });

    srRoot.getElementById("wave-zoom-in")?.addEventListener("click", () => {
      this._zoom = Math.min(64, this._zoom * 2);
      this.render();
    });
    srRoot.getElementById("wave-zoom-out")?.addEventListener("click", () => {
      this._zoom = Math.max(1, this._zoom / 2);
      this.render();
    });
    srRoot.getElementById("wave-zoom-reset")?.addEventListener("click", () => {
      this._zoom = 1;
      this._scrollFrac = 0;
      this.render();
    });
    srRoot.getElementById("wave-zc-toggle")?.addEventListener("click", () => {
      this._zeroCrossingSnap = !this._zeroCrossingSnap;
      this.render();
    });
    srRoot.getElementById("wave-env-toggle")?.addEventListener("click", () => {
      this._envelopeMode = !this._envelopeMode;
      this.render();
    });
    srRoot
      .getElementById("wave-view-select")
      ?.addEventListener("change", (e) => {
        this._viewMode = e.target.value || "waveform";
        this.render();
      });
    srRoot
      .getElementById("wave-palette-select")
      ?.addEventListener("change", (e) => {
        this._palette = e.target.value || "roseus";
        this.render();
      });
    srRoot
      .getElementById("wave-scale-select")
      ?.addEventListener("change", (e) => {
        this._specScale = e.target.value || "logarithmic";
        this.render();
      });
    srRoot
      .getElementById("wave-spectrum-toggle")
      ?.addEventListener("click", () => {
        this._showSpectrum = !this._showSpectrum;
        this.render();
      });
    srRoot.getElementById("wave-gen-btn")?.addEventListener("click", () => {
      const generator =
        srRoot.getElementById("wave-gen-select")?.value || "tone";
      this._runAction(`Generate ${generator}`, async () => {
        const res = await scdaw.sendCommand("generate_audio_clip", {
          trackId: track?.id || null,
          generator,
          params: { durationSec: 1.0 },
        });
        if (res?.clipId) this._selectedClipId = res.clipId;
      });
    });

    // DSP processor buttons
    srRoot.querySelectorAll(".wave-dsp-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!track || !clip) return;
        const effect = btn.dataset.effect;
        const defaultParams =
          effect === "amplify"
            ? { gainDb: 3 }
            : effect === "loudness"
              ? { mode: "lufs", targetLufs: -14 }
              : effect === "normalize"
                ? { targetDb: -1 }
                : effect === "change_tempo"
                  ? { tempoMultiplier: 1.1 }
                  : effect === "change_pitch"
                    ? { semitones: 2 }
                    : effect === "change_speed"
                      ? { rate: 1.1 }
                      : effect === "truncate_silence"
                        ? {
                            thresholdDb: -40,
                            minDurationSec: 0.25,
                            truncateToSec: 0.05,
                          }
                        : {};
        this._runAction(btn.textContent || effect, async () => {
          await scdaw.sendCommand("process_audio_clip", {
            trackId: track.id,
            clipId: clip.id,
            effect,
            params: defaultParams,
            startSec: this._selection?.lengthSec
              ? this._selection.startSec
              : null,
            endSec: this._selection?.lengthSec ? this._selection.endSec : null,
          });
        });
      });
    });

    // Edit operation buttons
    srRoot.querySelectorAll(".wave-op-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!track || !clip) return;
        const op = btn.dataset.op;
        const secToBeat = (s) => (s * bpm) / 60;
        this._runAction(btn.textContent || op, async () => {
          if (op === "split") {
            const splitSec = this._selection?.lengthSec
              ? this._selection.startSec
              : clipDurSec / 2;
            await scdaw.sendCommand("split_audio_clip", {
              trackId: track.id,
              clipId: clip.id,
              splitBeat: Number((clip.time + secToBeat(splitSec)).toFixed(3)),
            });
          } else if (op === "trim" && this._selection?.lengthSec) {
            await scdaw.sendCommand("trim_audio_clip", {
              trackId: track.id,
              clipId: clip.id,
              startBeat: Number(
                (clip.time + secToBeat(this._selection.startSec)).toFixed(3),
              ),
              endBeat: Number(
                (clip.time + secToBeat(this._selection.endSec)).toFixed(3),
              ),
            });
            this._selection = null;
          } else if (op === "silence_range" && this._selection?.lengthSec) {
            await scdaw.sendCommand("silence_clip_range", {
              trackId: track.id,
              clipId: clip.id,
              startBeat: Number(
                (clip.time + secToBeat(this._selection.startSec)).toFixed(3),
              ),
              endBeat: Number(
                (clip.time + secToBeat(this._selection.endSec)).toFixed(3),
              ),
            });
            this._selection = null;
          } else if (op === "split_at_silences") {
            await scdaw.sendCommand("split_at_silences", {
              trackId: track.id,
              clipId: clip.id,
              thresholdDb: -40,
              minDurationSec: 0.25,
            });
            this._selection = null;
          } else if (op === "duplicate") {
            await scdaw.sendCommand("duplicate_audio_clip", {
              trackId: track.id,
              clipId: clip.id,
            });
          } else if (op === "mute") {
            await scdaw.sendCommand("silence_audio_clip", {
              trackId: track.id,
              clipId: clip.id,
            });
          }
        });
      });
    });

    srRoot
      .getElementById("wave-add-label-btn")
      ?.addEventListener("click", () => {
        if (!clip) return;
        const secToBeat = (s) => (s * bpm) / 60;
        const startBeat = this._selection?.lengthSec
          ? Number((clip.time + secToBeat(this._selection.startSec)).toFixed(3))
          : Number((clip.time || 0).toFixed(3));
        const endBeat = this._selection?.lengthSec
          ? Number((clip.time + secToBeat(this._selection.endSec)).toFixed(3))
          : startBeat;
        this._runAction("Add Label", async () => {
          await scdaw.sendCommand("add_label", {
            title: clip.name || "Clip Marker",
            startBeat,
            endBeat,
          });
        });
      });

    // Stage pointer selection, envelope dragging & drag-and-drop import
    const stage = srRoot.getElementById("wave-stage");
    if (stage) {
      stage.addEventListener("dragover", (e) => {
        e.preventDefault?.();
        stage.classList?.add("scdaw-wave__stage--drop-target");
      });
      stage.addEventListener("dragleave", () => {
        stage.classList?.remove("scdaw-wave__stage--drop-target");
      });
      stage.addEventListener("drop", (e) => {
        e.preventDefault?.();
        stage.classList?.remove("scdaw-wave__stage--drop-target");
        const files = extractDroppedAudioFiles(e.dataTransfer);
        if (files.length === 0) return;
        this._runAction("Import Audio", async () => {
          for (const file of files) {
            const res = await scdaw.importAudioFile(track?.id || null, file, {
              time: 0,
            });
            if (res?.clipId) this._selectedClipId = res.clipId;
          }
        });
      });
    }
    if (stage && clip) {
      let draggingSel = false;
      let selAnchorSec = 0;
      let draggingEnvIdx = -1;
      let originalEnvPts = null;

      const xToSec = (clientX) => {
        const rect = stage.getBoundingClientRect?.() || { left: 0, width: 600 };
        const frac = Math.max(
          0,
          Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)),
        );
        return vp.viewStartSec + frac * vp.viewDurSec;
      };
      const yToVal = (clientY) => {
        const rect = stage.getBoundingClientRect?.() || { top: 0, height: 160 };
        const frac = Math.max(
          0,
          Math.min(1, (clientY - rect.top) / Math.max(1, rect.height)),
        );
        return Number(((1 - frac) * 2).toFixed(3));
      };

      stage.addEventListener("pointerdown", (e) => {
        const ptEl = e.target?.closest?.(".scdaw-wave__env-point");
        if (ptEl) {
          draggingEnvIdx = Number(ptEl.dataset.index);
          originalEnvPts = (clip.gainEnvelope || []).map((p) => ({ ...p }));
          stage.setPointerCapture?.(e.pointerId);
          return;
        }
        if (this._envelopeMode) {
          const t = xToSec(e.clientX);
          const v = yToVal(e.clientY);
          this._runAction("Add Envelope Point", async () => {
            await scdaw.sendCommand("set_clip_gain_envelope", {
              trackId: track.id,
              clipId: clip.id,
              point: { time: t, value: v },
            });
          });
          return;
        }
        draggingSel = true;
        selAnchorSec = xToSec(e.clientX);
        this._selection = clampWaveSelection({
          startSec: selAnchorSec,
          endSec: selAnchorSec,
          durationSec: clipDurSec,
        });
        stage.setPointerCapture?.(e.pointerId);
      });

      stage.addEventListener("pointermove", (e) => {
        if (draggingEnvIdx >= 0 && originalEnvPts) {
          const t = xToSec(e.clientX);
          const v = yToVal(e.clientY);
          const res = applyEnvelopePointDrag(originalEnvPts, {
            index: draggingEnvIdx,
            timeSec: t,
            value: v,
            durationSec: clipDurSec,
            originalPoints: originalEnvPts,
          });
          clip.gainEnvelope = res.points;
          this.render();
          return;
        }
        if (!draggingSel) return;
        this._selection = clampWaveSelection({
          startSec: selAnchorSec,
          endSec: xToSec(e.clientX),
          durationSec: clipDurSec,
        });
      });

      const finishPointer = () => {
        if (draggingEnvIdx >= 0 && originalEnvPts) {
          const committed = clip.gainEnvelope || [];
          draggingEnvIdx = -1;
          originalEnvPts = null;
          this._runAction("Update Envelope", async () => {
            await scdaw.sendCommand("set_clip_gain_envelope", {
              trackId: track.id,
              clipId: clip.id,
              points: committed,
            });
          });
          return;
        }
        if (!draggingSel) return;
        draggingSel = false;
        if (this._zeroCrossingSnap && this._selection?.lengthSec > 0.002) {
          this._selection = snapSelectionToZeroCrossings(
            channels,
            this._selection,
            sr,
          );
        }
        this.render();
      };
      stage.addEventListener("pointerup", finishPointer);
      stage.addEventListener("pointercancel", finishPointer);

      stage.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          this._selection = null;
          this.render();
        } else if (e.key.toLowerCase() === "z" && this._selection?.lengthSec) {
          this._selection = snapSelectionToZeroCrossings(
            channels,
            this._selection,
            sr,
          );
          this.render();
        }
      });
    }
  }
}

if (
  typeof customElements !== "undefined" &&
  !customElements.get("scdaw-wave-editor")
) {
  customElements.define("scdaw-wave-editor", DawWaveEditorElement);
}
