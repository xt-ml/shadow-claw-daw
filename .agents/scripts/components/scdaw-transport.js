/**
 * .agents/scripts/components/scdaw-transport.js
 *
 * Header Transport Bar Web Component (<scdaw-transport>).
 * Ported concepts from openDAW TransportGroup & OpenStudio TransportBar.
 */

import { SHARED_STYLES } from "./scdaw-styles.js";
import { scdaw } from "../scdaw-engine.js";
import { effect } from "../scdaw-signals.js";

const BaseElement = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

export function formatPosition(bar = 1, beat = 1, step = 0) {
  const padBar = String(bar).padStart(3, "0");
  const subStep = (step % 4) + 1;
  return `${padBar} : ${beat} : ${subStep}`;
}

export function calculateTransportWheelValue({
  currentValue,
  deltaY,
  min = 0,
  max = 100,
  step = 1,
  shiftMultiplier = 5,
  shiftKey = false,
}) {
  if (deltaY === 0) {
    return Math.max(min, Math.min(max, Math.round(currentValue)));
  }
  const direction = -Math.sign(deltaY);
  const effectiveStep = shiftKey ? step * shiftMultiplier : step;
  const nextVal = Math.round(currentValue + direction * effectiveStep);
  return Math.max(min, Math.min(max, nextVal));
}

export function setupTransportWheelControls({
  bpmInput,
  swingInput,
  onBpmChange,
  onSwingChange,
}) {
  if (bpmInput) {
    bpmInput.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault?.();
        const curVal = Number(bpmInput.value || 120);
        const nextVal = calculateTransportWheelValue({
          currentValue: curVal,
          deltaY: e.deltaY,
          min: Number(bpmInput.min || 40),
          max: Number(bpmInput.max || 240),
          step: 1,
          shiftMultiplier: 5,
          shiftKey: Boolean(e.shiftKey),
        });
        if (curVal !== nextVal) {
          bpmInput.value = String(nextVal);
          onBpmChange?.(nextVal);
        }
      },
      { passive: false },
    );
  }

  if (swingInput) {
    swingInput.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault?.();
        const curVal = Number(swingInput.value || 0);
        const nextVal = calculateTransportWheelValue({
          currentValue: curVal,
          deltaY: e.deltaY,
          min: Number(swingInput.min || 0),
          max: Number(swingInput.max || 50),
          step: 1,
          shiftMultiplier: 5,
          shiftKey: Boolean(e.shiftKey),
        });
        if (curVal !== nextVal) {
          swingInput.value = String(nextVal);
          onSwingChange?.(nextVal);
        }
      },
      { passive: false },
    );
  }
}

export class DawTransportElement extends BaseElement {
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
      const p = scdaw.project.get();
      this._syncProject(p);
    });
  }

  disconnectedCallback() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._dispose) this._dispose();
  }

  _startLoop() {
    const update = () => {
      this._sync();
      this._rafId = requestAnimationFrame(update);
    };
    this._rafId = requestAnimationFrame(update);
  }

  _sync() {
    if (!this.shadowRoot) return;
    const s = scdaw.getState();

    const playBtn = this.shadowRoot.getElementById("play-btn");
    const posBadge = this.shadowRoot.getElementById("pos-badge");
    const audioBtn = this.shadowRoot.getElementById("audio-btn");

    if (playBtn) {
      playBtn.textContent = s.playing ? "⏸ Stop" : "▶ Play";
      playBtn.classList.toggle("btn-primary", s.playing);
    }
    if (posBadge) {
      posBadge.textContent = formatPosition(s.bar, s.beat, s.step);
    }
    if (audioBtn) {
      audioBtn.style.display = s.audio === "running" ? "none" : "inline-flex";
    }
  }

  _syncProject(p) {
    if (!this.shadowRoot || !p) return;
    const bpmInput = this.shadowRoot.getElementById("bpm-input");
    const swingInput = this.shadowRoot.getElementById("swing-input");
    const swingVal = this.shadowRoot.getElementById("swing-val");
    const lengthBadge = this.shadowRoot.getElementById("length-badge");

    if (bpmInput && document.activeElement !== bpmInput) {
      bpmInput.value = p.bpm;
    }
    if (swingInput && document.activeElement !== swingInput) {
      const val = Math.round((p.swing || 0) * 100);
      swingInput.value = val;
      if (swingVal) swingVal.textContent = `${val}%`;
    }
    if (lengthBadge) {
      lengthBadge.textContent = `${p.lengthBars} Bar${p.lengthBars > 1 ? "s" : ""} (${p.signature.join("/")})`;
    }
  }

  render() {
    if (!this.shadowRoot) return;
    const s = scdaw.getState();
    const p = scdaw.getProject();

    this.shadowRoot.innerHTML = `
      <style>
        ${SHARED_STYLES}
        :host {
          display: block;
        }
        .transport-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.5rem 0.75rem;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 8px;
          flex-wrap: wrap;
          gap: 0.75rem;
        }
        .transport-group {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .pos-display {
          font-family: var(--mono);
          font-size: 0.85rem;
          font-weight: 700;
          color: var(--accent);
          background: #090e10;
          padding: 0.25rem 0.6rem;
          border-radius: 4px;
          border: 1px solid var(--border-subtle);
          letter-spacing: 0.05em;
        }
      </style>
      <div class="transport-bar">
        <div class="transport-group">
          <button id="play-btn" class="btn ${s.playing ? "btn-primary" : ""}">▶ Play</button>
          <button id="audio-btn" class="btn btn-primary" style="${s.audio === "running" ? "display:none;" : ""}">🔊 Start Audio</button>
          <span id="pos-badge" class="pos-display">001 : 1 : 1</span>
        </div>

        <div class="transport-group" style="font-size:0.8rem;">
          <label style="display:flex; align-items:center; gap:0.4rem;">
            <span>BPM:</span>
            <input id="bpm-input" type="number" min="40" max="240" value="${p.bpm}" style="width:55px; background:var(--bg-elevated); border:1px solid var(--border); color:inherit; border-radius:4px; padding:2px 4px;" title="Mouse wheel to adjust (Shift for +/-5 BPM). Double-click to reset to 120" aria-label="Tempo in beats per minute" />
          </label>
          <label style="display:flex; align-items:center; gap:0.4rem;">
            <span>Swing:</span>
            <input id="swing-input" type="range" min="0" max="50" value="${Math.round((p.swing || 0) * 100)}" style="width:65px;" title="Mouse wheel to adjust (Shift for +/-5%). Double-click to reset to 0%" aria-label="Groove swing percentage" />
            <span id="swing-val">${Math.round((p.swing || 0) * 100)}%</span>
          </label>
          <span id="length-badge" class="badge">${p.lengthBars} Bar${p.lengthBars > 1 ? "s" : ""} (${p.signature.join("/")})</span>
          <button id="panic-btn" class="btn btn-icon btn-danger" title="All Notes Off">⏹ Panic</button>
        </div>
      </div>
    `;

    this.shadowRoot
      .getElementById("play-btn")
      ?.addEventListener("click", () => {
        const state = scdaw.getState();
        if (state.playing) scdaw.stop();
        else scdaw.play();
      });

    this.shadowRoot
      .getElementById("audio-btn")
      ?.addEventListener("click", () => {
        scdaw.unlockAudio();
      });

    const bpmInput = this.shadowRoot.getElementById("bpm-input");
    if (bpmInput) {
      bpmInput.addEventListener("change", (e) => {
        const bpm = Number(e.target.value);
        if (!Number.isNaN(bpm)) scdaw.sendCommand("set_transport", { bpm });
      });
      bpmInput.addEventListener("dblclick", () => {
        scdaw.sendCommand("set_transport", { bpm: 120 });
      });
    }

    const swingInput = this.shadowRoot.getElementById("swing-input");
    if (swingInput) {
      swingInput.addEventListener("input", (e) => {
        const val = Number(e.target.value);
        this.shadowRoot.getElementById("swing-val").textContent = `${val}%`;
        scdaw.sendCommand("set_transport", { swing: val / 100 });
      });
      swingInput.addEventListener("dblclick", () => {
        scdaw.sendCommand("set_transport", { swing: 0 });
      });
    }

    setupTransportWheelControls({
      bpmInput,
      swingInput,
      onBpmChange: (bpm) => {
        scdaw.sendCommand("set_transport", { bpm });
      },
      onSwingChange: (val) => {
        const swingVal = this.shadowRoot.getElementById("swing-val");
        if (swingVal) swingVal.textContent = `${val}%`;
        scdaw.sendCommand("set_transport", { swing: val / 100 });
      },
    });

    this.shadowRoot
      .getElementById("panic-btn")
      ?.addEventListener("click", () => {
        scdaw.sendCommand("panic");
      });
  }
}

if (
  typeof customElements !== "undefined" &&
  !customElements.get("scdaw-transport")
) {
  customElements.define("scdaw-transport", DawTransportElement);
}
