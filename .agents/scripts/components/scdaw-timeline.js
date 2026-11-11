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
import { computeWaveformPeaks } from "../scdaw-recorder.js";

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

/**
 * Computes non-overlapping lane rows for clips on a timeline track.
 * Used to arrange multiple takes or overlapping clips without visual masking.
 *
 * @param {Array<{ id?: string, name?: string, time?: number, duration?: number }>} clips
 * @returns {Array<{ clip: any, rowIndex: number, rowCount: number }>}
 */
export function computeClipOverlapLayout(clips = []) {
  if (!Array.isArray(clips) || clips.length === 0) return [];

  const items = clips.map((clip, origIndex) => ({
    clip,
    origIndex,
    start: Number(clip.time || 0),
    end: Number(clip.time || 0) + Number(clip.duration || 4),
    rowIndex: 0,
    rowCount: 1,
  }));

  // Sort by start time ascending, then longer duration first
  items.sort((a, b) => a.start - b.start || b.end - a.end);

  const laneEndTimes = [];
  for (const item of items) {
    let placed = false;
    for (let r = 0; r < laneEndTimes.length; r++) {
      if (laneEndTimes[r] <= item.start) {
        item.rowIndex = r;
        laneEndTimes[r] = item.end;
        placed = true;
        break;
      }
    }
    if (!placed) {
      item.rowIndex = laneEndTimes.length;
      laneEndTimes.push(item.end);
    }
  }

  // Calculate local maximum overlapping row count for each clip
  for (const item of items) {
    const overlapping = items.filter(
      (other) => item.start < other.end && item.end > other.start,
    );
    const maxRowInCluster = Math.max(...overlapping.map((o) => o.rowIndex));
    item.rowCount = maxRowInCluster + 1;
  }

  // Restore original ordering
  items.sort((a, b) => a.origIndex - b.origIndex);

  return items.map(({ clip, rowIndex, rowCount }) => ({
    clip,
    rowIndex,
    rowCount,
  }));
}

/**
 * Calculates new beat position when dragging an audio clip horizontally.
 *
 * @param {Object} options
 * @param {number} options.startBeat - Initial clip start beat
 * @param {number} options.deltaX - Horizontal pointer movement in pixels
 * @param {number} options.laneWidth - Width of the timeline lane in pixels
 * @param {number} options.totalBeats - Total musical beats in the project
 * @param {number} [options.snap=1] - Standard grid snap in beats
 * @param {boolean} [options.shiftKey=false] - When true, enables fine snap (0.25 beat)
 * @returns {number} Clamped and snapped beat position
 */
export function calculateClipDragPosition({
  startBeat = 0,
  deltaX = 0,
  laneWidth = 400,
  totalBeats = 16,
  snap = 1,
  snapMode = "magnetic",
  snapThresholdPx = 10,
  shiftKey = false,
}) {
  if (laneWidth <= 0 || totalBeats <= 0) return Math.max(0, startBeat);
  const pixelsPerBeat = laneWidth / totalBeats;
  const deltaBeats = deltaX / pixelsPerBeat;
  const rawBeat = startBeat + deltaBeats;
  const maxBeat = Math.max(0, totalBeats - 0.25);

  if (shiftKey || snapMode === "none" || snapMode === "off" || snap <= 0) {
    return Math.max(0, Math.min(maxBeat, Number(rawBeat.toFixed(3))));
  }

  if (snapMode === "grid") {
    const snapped = Math.round(rawBeat / snap) * snap;
    return Math.max(0, Math.min(maxBeat, Number(snapped.toFixed(3))));
  }

  // Magnetic snap to beat/grid line within threshold, otherwise continuous free positioning
  const nearestBeat = Math.round(rawBeat / snap) * snap;
  const distPx = Math.abs(rawBeat - nearestBeat) * pixelsPerBeat;
  if (distPx <= snapThresholdPx) {
    return Math.max(0, Math.min(maxBeat, Number(nearestBeat.toFixed(3))));
  }

  return Math.max(0, Math.min(maxBeat, Number(rawBeat.toFixed(3))));
}

/**
 * Calculates updated clip time, duration, and audio sample offset when trimming/resizing edges.
 * Supports magnetic snapping to beats/bars within a pixel threshold, while allowing
 * free, continuous duration and start trimming at any point.
 *
 * @param {Object} options
 * @param {number} options.startTime - Clip start beat
 * @param {number} options.startDuration - Initial clip duration in beats
 * @param {number} [options.startOffset=0] - Initial audio playback offset in seconds
 * @param {number} options.deltaX - Horizontal movement in pixels
 * @param {number} options.laneWidth - Lane width in pixels
 * @param {number} options.totalBeats - Total project beats
 * @param {"left"|"right"} [options.edge="right"] - Which handle is being dragged
 * @param {number} [options.bpm=120] - Tempo in beats per minute
 * @param {number} [options.snap=1] - Snap division in beats
 * @param {"magnetic"|"grid"|"none"|"off"} [options.snapMode="magnetic"] - Snapping mode
 * @param {number} [options.snapThresholdPx=10] - Magnetic snap window in pixels
 * @param {boolean} [options.shiftKey=false] - Free trimming bypass when true
 * @returns {{ time: number, duration: number, offset: number }}
 */
export function calculateClipResize({
  startTime = 0,
  startDuration = 4,
  startOffset = 0,
  deltaX = 0,
  laneWidth = 400,
  totalBeats = 16,
  edge = "right",
  bpm = 120,
  snap = 1,
  snapMode = "magnetic",
  snapThresholdPx = 10,
  shiftKey = false,
}) {
  if (laneWidth <= 0 || totalBeats <= 0) {
    return { time: startTime, duration: startDuration, offset: startOffset };
  }
  const pixelsPerBeat = laneWidth / totalBeats;
  const deltaBeats = deltaX / pixelsPerBeat;
  const isSnapOff =
    shiftKey || snapMode === "none" || snapMode === "off" || snap <= 0;

  if (edge === "right") {
    const maxDur = Math.max(0.25, totalBeats - startTime);
    const baseDuration = Math.min(startDuration, maxDur);
    const rawDur = baseDuration + deltaBeats;

    let targetDur = rawDur;
    if (!isSnapOff) {
      if (snapMode === "grid") {
        targetDur = Math.round(rawDur / snap) * snap;
      } else {
        const rawEndBeat = startTime + rawDur;
        const nearestEndBeat = Math.round(rawEndBeat / snap) * snap;
        const distPx = Math.abs(rawEndBeat - nearestEndBeat) * pixelsPerBeat;
        if (distPx <= snapThresholdPx) {
          targetDur = nearestEndBeat - startTime;
        }
      }
    }

    const clampedDur = Math.max(0.25, Math.min(maxDur, targetDur));
    return {
      time: startTime,
      duration: Number(clampedDur.toFixed(3)),
      offset: startOffset,
    };
  }

  // Left edge trim:
  // Moving right delays start time, shortens duration, and advances sample offset.
  let targetDelta = deltaBeats;
  if (!isSnapOff) {
    if (snapMode === "grid") {
      targetDelta = Math.round(deltaBeats / snap) * snap;
    } else {
      const rawTime = startTime + deltaBeats;
      const nearestTime = Math.round(rawTime / snap) * snap;
      const distPx = Math.abs(rawTime - nearestTime) * pixelsPerBeat;
      if (distPx <= snapThresholdPx) {
        targetDelta = nearestTime - startTime;
      }
    }
  }

  const maxDelta = startDuration - 0.25;
  const minDelta = -startTime;
  const clampedDelta = Math.max(minDelta, Math.min(maxDelta, targetDelta));

  const newTime = Math.max(0, startTime + clampedDelta);
  const newDuration = Math.max(0.25, startDuration - clampedDelta);
  const secondsPerBeat = 60 / Math.max(20, bpm);
  const newOffset = Math.max(0, startOffset + clampedDelta * secondsPerBeat);

  return {
    time: Number(newTime.toFixed(3)),
    duration: Number(newDuration.toFixed(3)),
    offset: Number(newOffset.toFixed(3)),
  };
}

/**
 * Computes move or resize delta from keyboard arrow keys.
 *
 * @param {Object} options
 * @param {number} options.currentBeat
 * @param {number} options.currentDuration
 * @param {string} options.key - Keyboard event key
 * @param {boolean} [options.shiftKey=false] - Fine resolution (0.25 beat)
 * @param {boolean} [options.altKey=false] - Resize mode instead of move
 * @param {number} [options.totalBeats=16]
 * @returns {{ action: "move"|"resize", time?: number, duration?: number } | null}
 */
export function calculateClipKeyboardNudge({
  currentBeat = 0,
  currentDuration = 4,
  key,
  shiftKey = false,
  altKey = false,
  totalBeats = 16,
}) {
  const step = shiftKey ? 0.25 : 1;

  if (key === "Home") {
    return { action: "move", time: 0 };
  }
  if (key === "End") {
    return { action: "move", time: Math.max(0, totalBeats - currentDuration) };
  }

  if (altKey) {
    if (key === "ArrowRight") {
      const maxDur = Math.max(0.25, totalBeats - currentBeat);
      const nextDur = Math.min(maxDur, currentDuration + step);
      return { action: "resize", duration: Number(nextDur.toFixed(3)) };
    }
    if (key === "ArrowLeft") {
      const maxDur = Math.max(0.25, totalBeats - currentBeat);
      const baseDur = Math.min(currentDuration, maxDur);
      const nextDur = Math.max(0.25, baseDur - step);
      return { action: "resize", duration: Number(nextDur.toFixed(3)) };
    }
    return null;
  }

  if (key === "ArrowRight") {
    const maxTime = Math.max(0, totalBeats - 0.25);
    const nextTime = Math.min(maxTime, currentBeat + step);
    return { action: "move", time: Number(nextTime.toFixed(3)) };
  }
  if (key === "ArrowLeft") {
    const nextTime = Math.max(0, currentBeat - step);
    return { action: "move", time: Number(nextTime.toFixed(3)) };
  }

  return null;
}

/**
 * Calculates new track index when dragging track reorder handle vertically.
 *
 * @param {Object} options
 * @param {number} options.currentIndex - Current track index (0-based)
 * @param {number} options.deltaY - Vertical pointer displacement in pixels
 * @param {number} [options.rowHeight=48] - Track row height in pixels
 * @param {number} options.totalTracks - Total number of tracks
 * @returns {number} Clamped target track index
 */
export function calculateTrackReorderIndex({
  currentIndex = 0,
  deltaY = 0,
  rowHeight = 48,
  totalTracks = 1,
}) {
  if (totalTracks <= 1 || rowHeight <= 0) return currentIndex;
  const rowsMoved = Math.round(deltaY / rowHeight);
  const targetIndex = currentIndex + rowsMoved;
  return Math.max(0, Math.min(totalTracks - 1, targetIndex));
}

/**
 * Binds touch-friendly, mobile-first pointer dragging and keyboard accessibility
 * on a timeline track reorder grab handle.
 *
 * @param {Object} options
 * @param {HTMLElement} options.handleEl
 * @param {HTMLElement} options.trackRowEl
 * @param {string} options.trackId
 * @param {number} options.index
 * @param {number} options.totalTracks
 * @param {number} [options.rowHeight=48]
 * @param {Function} options.onReorder
 * @returns {Function} Cleanup function
 */
export function setupTrackReorderInteraction({
  handleEl,
  trackRowEl,
  trackId,
  index,
  totalTracks,
  rowHeight = 48,
  onReorder,
}) {
  if (!handleEl) return () => {};

  let isDragging = false;
  let startY = 0;
  let targetIndex = index;

  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.stopPropagation?.();
    isDragging = true;
    startY = e.clientY;
    targetIndex = index;

    try {
      handleEl.setPointerCapture?.(e.pointerId);
    } catch {}

    trackRowEl?.classList?.add("scdaw-timeline__track--reordering");
    if (trackRowEl?.style) {
      trackRowEl.style.zIndex = "10";
    }
  };

  const onPointerMove = (e) => {
    if (!isDragging) return;
    e.preventDefault?.();
    const deltaY = e.clientY - startY;
    if (trackRowEl?.style) {
      trackRowEl.style.transform = `translateY(${deltaY}px)`;
    }
    targetIndex = calculateTrackReorderIndex({
      currentIndex: index,
      deltaY,
      rowHeight: trackRowEl?.getBoundingClientRect?.()?.height || rowHeight,
      totalTracks,
    });
  };

  const onPointerUp = (e) => {
    if (!isDragging) return;
    isDragging = false;
    trackRowEl?.classList?.remove("scdaw-timeline__track--reordering");
    if (trackRowEl?.style) {
      trackRowEl.style.transform = "";
      trackRowEl.style.zIndex = "";
    }

    try {
      handleEl.releasePointerCapture?.(e.pointerId);
    } catch {}

    if (targetIndex !== index && typeof onReorder === "function") {
      onReorder(targetIndex);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowUp") {
      e.preventDefault?.();
      e.stopPropagation?.();
      if (index > 0 && typeof onReorder === "function") {
        onReorder(index - 1);
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault?.();
      e.stopPropagation?.();
      if (index < totalTracks - 1 && typeof onReorder === "function") {
        onReorder(index + 1);
      }
    }
  };

  handleEl.addEventListener("pointerdown", onPointerDown);
  handleEl.addEventListener("pointermove", onPointerMove);
  handleEl.addEventListener("pointerup", onPointerUp);
  handleEl.addEventListener("pointercancel", onPointerUp);
  handleEl.addEventListener("keydown", onKeyDown);

  return () => {
    handleEl.removeEventListener("pointerdown", onPointerDown);
    handleEl.removeEventListener("pointermove", onPointerMove);
    handleEl.removeEventListener("pointerup", onPointerUp);
    handleEl.removeEventListener("pointercancel", onPointerUp);
    handleEl.removeEventListener("keydown", onKeyDown);
  };
}

/**
 * Binds pointer dragging (move), edge resizing (trim), and keyboard accessibility
 * on a timeline audio clip element.
 *
 * @param {Object} options
 * @param {HTMLElement} options.clipEl
 * @param {HTMLElement} [options.laneEl]
 * @param {Object} options.clip
 * @param {string} options.trackId
 * @param {number} [options.totalBeats=16]
 * @param {number} [options.bpm=120]
 * @param {Function} [options.onUpdate]
 * @param {Function} [options.onRemove]
 * @returns {Function} Cleanup function
 */
export function setupClipInteraction({
  clipEl,
  laneEl,
  clip,
  trackId,
  totalBeats = 16,
  bpm = 120,
  snapMode = "beat",
  beatsPerBar = 4,
  snapThresholdPx = 10,
  onUpdate,
  onRemove,
}) {
  if (!clipEl) return () => {};

  let isInteracting = false;
  let interactionMode = null;
  let startX = 0;
  let hasMoved = false;
  let startBeat = Number(clip.time || 0);
  let startDuration = Number(clip.duration || 4);
  let startOffset = Number(clip.offset || 0);

  const snapGrid = snapMode === "bar" ? beatsPerBar : 1;
  const effectiveSnapMode =
    snapMode === "off" || snapMode === "none" ? "none" : "magnetic";

  const getLaneWidth = () => {
    if (laneEl && typeof laneEl.getBoundingClientRect === "function") {
      const rect = laneEl.getBoundingClientRect();
      if (rect.width > 0) return rect.width;
    }
    return 400;
  };

  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.stopPropagation?.();
    const target = e.target;
    const isLeftHandle = target.closest?.(".scdaw-timeline__clip-handle--left");
    const isRightHandle = target.closest?.(
      ".scdaw-timeline__clip-handle--right",
    );

    if (isLeftHandle) {
      interactionMode = "resize-left";
    } else if (isRightHandle) {
      interactionMode = "resize-right";
    } else {
      interactionMode = "move";
    }

    isInteracting = true;
    hasMoved = false;
    startX = e.clientX;
    startBeat = Number(clip.time || 0);
    startDuration = Number(clip.duration || 4);
    startOffset = Number(clip.offset || 0);

    try {
      clipEl.setPointerCapture?.(e.pointerId);
    } catch {}

    clipEl.classList.add(
      interactionMode === "move"
        ? "scdaw-timeline__clip--dragging"
        : "scdaw-timeline__clip--resizing",
    );
  };

  const onPointerMove = (e) => {
    if (!isInteracting) return;
    const deltaX = e.clientX - startX;
    if (Math.abs(deltaX) >= 2) {
      hasMoved = true;
    }
    if (!hasMoved) return;

    e.preventDefault?.();
    const laneWidth = getLaneWidth();

    if (interactionMode === "move") {
      const nextTime = calculateClipDragPosition({
        startBeat,
        deltaX,
        laneWidth,
        totalBeats,
        snap: snapGrid,
        snapMode: effectiveSnapMode,
        snapThresholdPx,
        shiftKey: Boolean(e.shiftKey),
      });
      const leftPct = (nextTime / totalBeats) * 100;
      clipEl.style.left = `${leftPct}%`;
      clipEl.setAttribute("aria-valuenow", String(nextTime));
      clipEl.title = `${clip.name} (Beat ${(nextTime + 1).toFixed(2)}, ${clip.duration} beats)`;
    } else if (interactionMode === "resize-right") {
      const res = calculateClipResize({
        startTime: startBeat,
        startDuration,
        startOffset,
        deltaX,
        laneWidth,
        totalBeats,
        edge: "right",
        bpm,
        snap: snapGrid,
        snapMode: effectiveSnapMode,
        snapThresholdPx,
        shiftKey: Boolean(e.shiftKey),
      });
      const widthPct = (res.duration / totalBeats) * 100;
      clipEl.style.width = `${widthPct}%`;
      clipEl.setAttribute("aria-valuenow", String(res.duration));
      clipEl.title = `${clip.name} (Beat ${(startBeat + 1).toFixed(2)}, ${res.duration.toFixed(2)} beats)`;
    } else if (interactionMode === "resize-left") {
      const res = calculateClipResize({
        startTime: startBeat,
        startDuration,
        startOffset,
        deltaX,
        laneWidth,
        totalBeats,
        edge: "left",
        bpm,
        snap: snapGrid,
        snapMode: effectiveSnapMode,
        snapThresholdPx,
        shiftKey: Boolean(e.shiftKey),
      });
      const leftPct = (res.time / totalBeats) * 100;
      const widthPct = (res.duration / totalBeats) * 100;
      clipEl.style.left = `${leftPct}%`;
      clipEl.style.width = `${widthPct}%`;
      clipEl.setAttribute("aria-valuenow", String(res.time));
      clipEl.title = `${clip.name} (Beat ${(res.time + 1).toFixed(2)}, ${res.duration.toFixed(2)} beats)`;
    }
  };

  const onPointerUp = (e) => {
    if (!isInteracting) return;
    isInteracting = false;
    clipEl.classList.remove(
      "scdaw-timeline__clip--dragging",
      "scdaw-timeline__clip--resizing",
    );
    try {
      clipEl.releasePointerCapture?.(e.pointerId);
    } catch {}

    if (hasMoved) {
      e.preventDefault?.();
      const deltaX = e.clientX - startX;
      const laneWidth = getLaneWidth();

      if (interactionMode === "move") {
        const nextTime = calculateClipDragPosition({
          startBeat,
          deltaX,
          laneWidth,
          totalBeats,
          snap: snapGrid,
          snapMode: effectiveSnapMode,
          snapThresholdPx,
          shiftKey: Boolean(e.shiftKey),
        });
        if (nextTime !== startBeat) {
          onUpdate?.({ time: nextTime });
        }
      } else if (interactionMode === "resize-right") {
        const res = calculateClipResize({
          startTime: startBeat,
          startDuration,
          startOffset,
          deltaX,
          laneWidth,
          totalBeats,
          edge: "right",
          bpm,
          snap: snapGrid,
          snapMode: effectiveSnapMode,
          snapThresholdPx,
          shiftKey: Boolean(e.shiftKey),
        });
        if (res.duration !== startDuration) {
          onUpdate?.({ duration: res.duration });
        }
      } else if (interactionMode === "resize-left") {
        const res = calculateClipResize({
          startTime: startBeat,
          startDuration,
          startOffset,
          deltaX,
          laneWidth,
          totalBeats,
          edge: "left",
          bpm,
          snap: snapGrid,
          snapMode: effectiveSnapMode,
          snapThresholdPx,
          shiftKey: Boolean(e.shiftKey),
        });
        if (res.time !== startBeat || res.duration !== startDuration) {
          onUpdate?.({
            time: res.time,
            duration: res.duration,
            offset: res.offset,
          });
        }
      }
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault?.();
      e.stopPropagation?.();
      if (typeof onRemove === "function") {
        onRemove();
      } else if (
        typeof scdaw !== "undefined" &&
        typeof scdaw.sendCommand === "function"
      ) {
        scdaw.sendCommand("remove_audio_clip", { trackId, clipId: clip.id });
      }
      return;
    }

    const target = e.target;
    const isLeftHandle = target.closest?.(".scdaw-timeline__clip-handle--left");
    const isRightHandle = target.closest?.(
      ".scdaw-timeline__clip-handle--right",
    );

    if (isLeftHandle) {
      const step = e.shiftKey ? 0.25 : 1;
      let deltaBeats = 0;
      if (e.key === "ArrowRight") deltaBeats = step;
      else if (e.key === "ArrowLeft") deltaBeats = -step;
      else return;

      e.preventDefault?.();
      e.stopPropagation?.();
      const currentLaneWidth = getLaneWidth();
      const pixelsPerBeat = currentLaneWidth / totalBeats;
      const res = calculateClipResize({
        startTime: Number(clip.time || 0),
        startDuration: Number(clip.duration || 4),
        startOffset: Number(clip.offset || 0),
        deltaX: deltaBeats * pixelsPerBeat,
        laneWidth: currentLaneWidth,
        totalBeats,
        edge: "left",
        bpm,
        shiftKey: Boolean(e.shiftKey),
      });
      onUpdate?.(res);
      return;
    }

    if (isRightHandle) {
      const step = e.shiftKey ? 0.25 : 1;
      let deltaBeats = 0;
      if (e.key === "ArrowRight") deltaBeats = step;
      else if (e.key === "ArrowLeft") deltaBeats = -step;
      else return;

      e.preventDefault?.();
      e.stopPropagation?.();
      const currentLaneWidth = getLaneWidth();
      const pixelsPerBeat = currentLaneWidth / totalBeats;
      const res = calculateClipResize({
        startTime: Number(clip.time || 0),
        startDuration: Number(clip.duration || 4),
        startOffset: Number(clip.offset || 0),
        deltaX: deltaBeats * pixelsPerBeat,
        laneWidth: currentLaneWidth,
        totalBeats,
        edge: "right",
        shiftKey: Boolean(e.shiftKey),
      });
      onUpdate?.({ duration: res.duration });
      return;
    }

    const nudge = calculateClipKeyboardNudge({
      currentBeat: Number(clip.time || 0),
      currentDuration: Number(clip.duration || 4),
      key: e.key,
      shiftKey: Boolean(e.shiftKey),
      altKey: Boolean(e.altKey),
      totalBeats,
    });

    if (nudge) {
      e.preventDefault?.();
      e.stopPropagation?.();
      if (nudge.action === "move" && nudge.time !== undefined) {
        onUpdate?.({ time: nudge.time });
      } else if (nudge.action === "resize" && nudge.duration !== undefined) {
        onUpdate?.({ duration: nudge.duration });
      }
    }
  };

  clipEl.addEventListener("pointerdown", onPointerDown);
  clipEl.addEventListener("pointermove", onPointerMove);
  clipEl.addEventListener("pointerup", onPointerUp);
  clipEl.addEventListener("pointercancel", onPointerUp);
  clipEl.addEventListener("keydown", onKeyDown);

  return () => {
    clipEl.removeEventListener("pointerdown", onPointerDown);
    clipEl.removeEventListener("pointermove", onPointerMove);
    clipEl.removeEventListener("pointerup", onPointerUp);
    clipEl.removeEventListener("pointercancel", onPointerUp);
    clipEl.removeEventListener("keydown", onKeyDown);
  };
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
    this._snapMode = "beat";
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
    const totalBeats = (p.lengthBars || 1) * 4;

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
          --track-header-w: 136px;
          --timeline-gutter-width: 16px;
          --timeline-gutter-l: var(--timeline-gutter-width);
          --timeline-gutter-r: var(--timeline-gutter-width);
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
          margin-left: calc(var(--track-header-w) + var(--timeline-gutter-l, 16px));
          margin-right: var(--timeline-gutter-r, 16px);
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
          max-width: var(--track-header-w);
          overflow: hidden;
          padding: 0.35rem 0.45rem;
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

        .scdaw-timeline__track-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 4px;
          width: 100%;
          min-width: 0;
        }

        .scdaw-timeline__reorder-group {
          display: inline-flex;
          align-items: center;
          gap: 1px;
          flex-shrink: 0;
        }

        .scdaw-timeline__reorder-handle {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 14px;
          height: 20px;
          cursor: grab;
          cursor: -webkit-grab;
          touch-action: none;
          user-select: none;
          color: var(--shadow-claw-text-secondary, #94a3b8);
          font-size: 0.72rem;
          font-weight: 700;
          line-height: 1;
          padding: 0;
          background: transparent;
          border: none;
          border-radius: 2px;
          transition: color 0.12s ease, background 0.12s ease;
        }

        .scdaw-timeline__reorder-handle:hover,
        .scdaw-timeline__reorder-handle:focus-visible {
          color: var(--accent, #6366f1);
          background: rgba(255, 255, 255, 0.08);
          outline: none;
        }

        .scdaw-timeline__reorder-handle:active {
          cursor: grabbing;
          cursor: -webkit-grabbing;
        }

        .scdaw-timeline__nudge-buttons {
          display: inline-flex;
          flex-direction: column;
          gap: 1px;
        }

        .scdaw-timeline__nudge-btn,
        .scdaw-timeline__nudge-btn--up,
        .scdaw-timeline__nudge-btn--down {
          width: 13px;
          height: 10px;
          padding: 0;
          margin: 0;
          border: none;
          background: rgba(255, 255, 255, 0.06);
          color: var(--shadow-claw-text-secondary, #94a3b8);
          font-size: 0.46rem;
          line-height: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          border-radius: 2px;
          touch-action: manipulation;
          transition: background 0.1s ease, color 0.1s ease;
        }

        .scdaw-timeline__nudge-btn:hover:not(:disabled),
        .scdaw-timeline__nudge-btn:focus-visible:not(:disabled) {
          background: var(--accent, #6366f1);
          color: #ffffff;
          outline: none;
        }

        .scdaw-timeline__nudge-btn:disabled {
          opacity: 0.25;
          cursor: not-allowed;
        }

        .scdaw-timeline__track--reordering {
          opacity: 0.75;
          background: rgba(99, 102, 241, 0.15) !important;
          outline: 1px dashed var(--accent, #6366f1);
        }

        .scdaw-timeline__track-name,
        .track-name {
          font-size: 0.76rem;
          font-weight: 700;
          text-overflow: ellipsis;
          overflow: hidden;
          white-space: nowrap;
          min-width: 0;
          flex: 1 1 auto;
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }

        .scdaw-timeline__track-title {
          text-overflow: ellipsis;
          overflow: hidden;
          white-space: nowrap;
          min-width: 0;
        }

        .scdaw-timeline__track-icon {
          flex-shrink: 0;
        }

        .scdaw-timeline__btn--delete {
          flex-shrink: 0;
          width: 18px;
          height: 18px;
          min-width: 18px;
          padding: 0;
          font-size: 0.65rem;
          line-height: 1;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 3px;
          opacity: 0.65;
          transition: opacity 0.12s ease;
        }

        .scdaw-timeline__btn--delete:hover,
        .scdaw-timeline__btn--delete:focus-visible {
          opacity: 1;
        }

        .scdaw-timeline__controls {
          display: flex;
          gap: 3px;
          align-items: center;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          flex-wrap: wrap;
        }

        .scdaw-timeline__btn {
          height: 20px;
          min-width: 20px;
          padding: 0 4px;
          font-size: 0.68rem;
          line-height: 1;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          box-sizing: border-box;
          border-radius: 3px;
        }

        .scdaw-timeline__btn--arm {
          min-width: 26px;
          padding: 0 3px;
        }

        .scdaw-timeline__track-count {
          font-size: 0.62rem;
          color: var(--shadow-claw-text-secondary, #94a3b8);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex-shrink: 1;
          margin-left: auto;
        }

        .scdaw-timeline__lane,
        .lane-area {
          flex: 1;
          position: relative;
          background: rgba(0, 0, 0, 0.15);
          min-width: 160px;
          margin-left: var(--timeline-gutter-l, 16px);
          margin-right: var(--timeline-gutter-r, 16px);
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
          bottom: auto;
          cursor: grab;
          touch-action: none;
          user-select: none;
          -webkit-user-select: none;
        }

        .scdaw-timeline__clip--dragging {
          cursor: grabbing !important;
          opacity: 0.88;
          z-index: 20 !important;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
        }

        .scdaw-timeline__clip--resizing {
          z-index: 20 !important;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.6);
        }

        .scdaw-timeline__clip-handle {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 14px;
          cursor: ew-resize;
          z-index: 5;
          opacity: 0.65;
          transition: opacity 0.12s ease, background 0.12s ease;
          display: flex;
          align-items: center;
          justify-content: center;
          touch-action: none;
        }

        .scdaw-timeline__clip-handle::after {
          content: "";
          width: 2px;
          height: 14px;
          border-radius: 1px;
          background: rgba(255, 255, 255, 0.45);
          pointer-events: none;
        }

        .scdaw-timeline__clip-handle--left {
          left: 0;
          border-top-left-radius: 4px;
          border-bottom-left-radius: 4px;
          border-left: 3px solid var(--accent, #6366f1);
        }

        .scdaw-timeline__clip-handle--right {
          right: 0;
          border-top-right-radius: 4px;
          border-bottom-right-radius: 4px;
          border-right: 3px solid var(--accent, #6366f1);
        }

        .scdaw-timeline__clip--audio:hover .scdaw-timeline__clip-handle,
        .scdaw-timeline__clip--audio:focus-visible .scdaw-timeline__clip-handle,
        .scdaw-timeline__clip-handle:hover,
        .scdaw-timeline__clip-handle:focus-visible,
        .scdaw-timeline__clip--resizing .scdaw-timeline__clip-handle {
          opacity: 1;
          background: rgba(255, 255, 255, 0.22);
          outline: none;
        }

        .scdaw-timeline__clip-handle:hover::after,
        .scdaw-timeline__clip-handle:focus-visible::after,
        .scdaw-timeline__clip--resizing .scdaw-timeline__clip-handle::after {
          background: #ffffff;
        }

        .scdaw-timeline__clip--stacked {
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
          border: 1px solid var(--scdaw-primary-light, #a78bfa);
        }

        .scdaw-timeline__clip--stacked:hover,
        .scdaw-timeline__clip--stacked:focus-visible {
          z-index: 10 !important;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.7);
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
          max-width: var(--track-header-w);
          overflow: hidden;
          padding: 0.3rem 0.45rem;
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
          margin-left: var(--timeline-gutter-l, 16px);
          margin-right: var(--timeline-gutter-r, 16px);
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
            <button
              id="timeline-snap-btn"
              type="button"
              class="btn btn-icon scdaw-timeline__snap-btn"
              data-snap="${this._snapMode || "beat"}"
              aria-label="Timeline snap: ${this._snapMode || "beat"}. Click to cycle: Beat, Bar, Off"
              title="Snap mode: ${this._snapMode || "beat"}. Click to toggle: Beat (magnetic snap), Bar (bar snap), Off (free)">
              🧲 ${this._snapMode === "off" ? "Off" : this._snapMode === "bar" ? "Bar" : "Beat"}
            </button>
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
                .map((t, idx) => {
                  const isFirst = idx === 0;
                  const isLast = idx === p.tracks.length - 1;
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
                      const layout = computeClipOverlapLayout(t.audioClips);
                      laneClipsHtml = layout
                        .map(({ clip, rowIndex, rowCount }) => {
                          const leftPct =
                            (Math.max(0, clip.time || 0) / totalBeats) * 100;
                          const widthPct = Math.min(
                            100 - leftPct,
                            Math.max(
                              3,
                              ((clip.duration || 4) / totalBeats) * 100,
                            ),
                          );

                          let topStyle = "top: 4px; height: calc(100% - 8px);";
                          if (rowCount > 1) {
                            const rowHeightPct = (100 / rowCount).toFixed(2);
                            const topPct = (
                              rowIndex *
                              (100 / rowCount)
                            ).toFixed(2);
                            topStyle = `top: calc(${topPct}% + 1px); height: calc(${rowHeightPct}% - 2px);`;
                          }

                          let waveformSvg = "";
                          const sampleBuf = scdaw.getSample?.(clip.sample);
                          if (sampleBuf) {
                            const peaks = computeWaveformPeaks(sampleBuf, 24);
                            const pathPoints = peaks
                              .map((p, idx) => {
                                const x = (idx / (peaks.length - 1 || 1)) * 100;
                                const h = p * 40;
                                return `M ${x.toFixed(1)},${(50 - h).toFixed(1)} L ${x.toFixed(1)},${(50 + h).toFixed(1)}`;
                              })
                              .join(" ");
                            waveformSvg = `
                              <svg class="scdaw-timeline__clip-waveform" viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute; inset:0; width:100%; height:100%; opacity:0.35; pointer-events:none;">
                                <path d="${pathPoints}" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" />
                              </svg>
                            `;
                          }

                          const isStacked = rowCount > 1;
                          return `
                            <div class="scdaw-timeline__clip scdaw-timeline__clip--audio clip-block ${isSilenced ? "scdaw-timeline__clip--muted" : ""} ${isStacked ? "scdaw-timeline__clip--stacked" : ""}"
                                 data-clip="${clip.id}"
                                 data-track="${t.id}"
                                 style="left:${leftPct}%; width:${widthPct}%; ${topStyle} position:absolute; z-index:${rowIndex + 1};"
                                 role="button"
                                 tabindex="0"
                                 title="${clip.name} (Beat ${(clip.time || 0) + 1}, ${clip.duration} beats${isStacked ? ` — Layer ${rowIndex + 1} of ${rowCount}` : ""})"
                                 aria-label="Audio clip ${clip.name}, beat ${clip.time}, duration ${clip.duration} beats${isStacked ? `, Layer ${rowIndex + 1} of ${rowCount}` : ""}">
                              <div class="scdaw-timeline__clip-handle scdaw-timeline__clip-handle--left" data-edge="left" role="slider" tabindex="0" aria-label="Trim start for ${clip.name}" aria-valuemin="0" aria-valuemax="${totalBeats}" aria-valuenow="${clip.time || 0}" title="Drag to trim start"></div>
                              ${waveformSvg}
                              <span style="margin-right:4px; z-index:1;" aria-hidden="true">🎙</span>
                              <span style="z-index:1; text-overflow:ellipsis; overflow:hidden; white-space:nowrap; font-size:${rowCount > 1 ? "0.72rem" : "0.85rem"};">${clip.name}</span>
                              <div class="scdaw-timeline__clip-handle scdaw-timeline__clip-handle--right" data-edge="right" role="slider" tabindex="0" aria-label="Resize duration for ${clip.name}" aria-valuemin="0.25" aria-valuemax="${totalBeats}" aria-valuenow="${clip.duration || 4}" title="Drag to resize duration"></div>
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
                    <div class="scdaw-timeline__track-top">
                      <div class="scdaw-timeline__reorder-group" role="group" aria-label="Reorder ${t.name}">
                        <button
                          type="button"
                          class="scdaw-timeline__reorder-handle btn-icon"
                          data-track="${t.id}"
                          data-index="${idx}"
                          aria-label="Drag to reorder ${t.name} or use Up/Down arrow keys"
                          title="Drag or use Up/Down arrows to reorder ${t.name}">
                          ⋮⋮
                        </button>
                        <div class="scdaw-timeline__nudge-buttons">
                          <button
                            type="button"
                            class="scdaw-timeline__nudge-btn scdaw-timeline__nudge-btn--up"
                            data-track="${t.id}"
                            data-dir="up"
                            aria-label="Move ${t.name} up"
                            title="Move ${t.name} up"
                            ${isFirst ? "disabled" : ""}>
                            ▲
                          </button>
                          <button
                            type="button"
                            class="scdaw-timeline__nudge-btn scdaw-timeline__nudge-btn--down"
                            data-track="${t.id}"
                            data-dir="down"
                            aria-label="Move ${t.name} down"
                            title="Move ${t.name} down"
                            ${isLast ? "disabled" : ""}>
                            ▼
                          </button>
                        </div>
                      </div>
                      <div class="scdaw-timeline__track-name track-name" title="${t.name} (${countLabel})">
                        <span class="scdaw-timeline__track-icon" aria-hidden="true">${icon}</span>
                        <span class="scdaw-timeline__track-title">${t.name}</span>
                      </div>
                      <button type="button" class="btn btn-icon btn-danger delete-track-btn scdaw-timeline__btn--delete" data-track="${t.id}" aria-label="Delete ${t.name}" title="Delete ${t.name}">✕</button>
                    </div>
                    <div class="scdaw-timeline__controls">
                      ${
                        t.kind === "audio"
                          ? `
                        <button type="button" class="btn btn-icon ${t.recordArm ? "btn-danger" : ""} record-arm-btn scdaw-timeline__btn scdaw-timeline__btn--arm" data-track="${t.id}" aria-label="${t.recordArm ? `Disarm recording for ${t.name}` : `Arm recording for ${t.name}`}" aria-pressed="${Boolean(t.recordArm)}" title="${t.recordArm ? "Disarm recording" : "Record arm"}">● R</button>
                        <button type="button" class="btn btn-icon import-audio-btn scdaw-timeline__btn" data-track="${t.id}" aria-label="Import audio file into ${t.name}" title="Import WAV or Audio File">📂</button>
                      `
                          : ""
                      }
                      <button type="button" class="btn btn-icon ${t.mute ? "btn-danger" : ""} scdaw-timeline__btn mute-btn" data-track="${t.id}" aria-label="Mute ${t.name}" aria-pressed="${Boolean(t.mute)}" title="${t.mute ? `Unmute ${t.name}` : `Mute ${t.name}`}">M</button>
                      <button type="button" class="btn btn-icon ${t.solo ? "btn-primary" : ""} scdaw-timeline__btn solo-btn" data-track="${t.id}" aria-label="Solo ${t.name}" aria-pressed="${Boolean(t.solo)}" title="${t.solo ? `Unsolo ${t.name}` : `Solo ${t.name}`}">S</button>
                      <button type="button" class="btn btn-icon ${isAutoExpanded ? "btn-primary" : ""} scdaw-timeline__btn auto-btn" data-track="${t.id}" aria-label="Toggle automation for ${t.name}" aria-expanded="${isAutoExpanded}" title="Automation lanes">📈</button>
                      <span class="scdaw-timeline__track-count" title="${countLabel}">${countLabel}</span>
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
      .getElementById("timeline-snap-btn")
      ?.addEventListener("click", () => {
        const modes = ["beat", "bar", "off"];
        const curIdx = modes.indexOf(this._snapMode || "beat");
        this._snapMode = modes[(curIdx + 1) % modes.length];
        this.render();
      });

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

    // Record Arm & Import Audio
    this.shadowRoot.querySelectorAll(".record-arm-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation?.();
        const id = btn.dataset.track;
        const currentProj = scdaw.getProject();
        const t = currentProj.tracks.find((x) => x.id === id);
        if (t) {
          scdaw.sendCommand("set_track_record_arm", {
            trackId: id,
            armed: !t.recordArm,
          });
        }
      });
    });

    this.shadowRoot.querySelectorAll(".import-audio-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation?.();
        const id = btn.dataset.track;
        if (typeof document !== "undefined") {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = "audio/*,.wav,.wave,.mp3,.ogg";
          input.onchange = async () => {
            const file = input.files?.[0];
            if (file) {
              await scdaw.importAudioFile(id, file);
            }
          };
          input.click();
        }
      });
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

    // Delete Track
    this.shadowRoot.querySelectorAll(".delete-track-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation?.();
        const id = btn.dataset.track;
        const currentProj = scdaw.getProject();
        const t = currentProj.tracks.find((x) => x.id === id);
        if (t) {
          await scdaw.sendCommand("remove_track", { trackId: id });
        }
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

    // Track re-ordering: touch & pointer drag handle and touch nudge buttons
    this.shadowRoot
      .querySelectorAll(".scdaw-timeline__nudge-btn")
      .forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation?.();
          const trackId = btn.dataset.track;
          const direction = btn.dataset.dir;
          if (trackId && direction) {
            scdaw.sendCommand("move_track", { trackId, direction });
          }
        });
      });

    this.shadowRoot
      .querySelectorAll(".scdaw-timeline__reorder-handle")
      .forEach((handle) => {
        const trackId = handle.dataset.track;
        const index = Number(handle.dataset.index);
        const rowEl = handle.closest(".scdaw-timeline__track");
        if (trackId && !isNaN(index) && rowEl) {
          setupTrackReorderInteraction({
            handleEl: handle,
            trackRowEl: rowEl,
            trackId,
            index,
            totalTracks: p.tracks.length,
            rowHeight: 48,
            onReorder: (targetIndex) => {
              scdaw.sendCommand("move_track", { trackId, targetIndex });
            },
          });
        }
      });

    // Audio clip dragging, edge trimming/resizing, and keyboard nudging
    const currentBpm = p.bpm || 120;
    this.shadowRoot
      .querySelectorAll(".scdaw-timeline__clip--audio[data-clip]")
      .forEach((clipEl) => {
        const trackId = clipEl.dataset.track;
        const clipId = clipEl.dataset.clip;
        const currentProj = scdaw.getProject();
        const trk = currentProj.tracks?.find((x) => x.id === trackId);
        const clip = trk?.audioClips?.find((c) => c.id === clipId);
        const laneEl = clipEl.closest(".scdaw-timeline__lane");
        if (clip) {
          setupClipInteraction({
            clipEl,
            laneEl,
            clip,
            trackId,
            totalBeats,
            bpm: currentBpm,
            snapMode: this._snapMode || "beat",
            beatsPerBar: p.signature?.[0] || 4,
            onUpdate: (patch) => {
              scdaw.sendCommand("set_audio_clip", { trackId, clipId, patch });
            },
            onRemove: () => {
              scdaw.sendCommand("remove_audio_clip", { trackId, clipId });
            },
          });
        }
      });
  }
}

if (
  typeof customElements !== "undefined" &&
  !customElements.get("scdaw-timeline")
) {
  customElements.define("scdaw-timeline", DawTimelineElement);
}
