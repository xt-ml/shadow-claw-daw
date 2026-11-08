/**
 * .agents/scripts/components/scdaw-knob.js
 *
 * Rotary Parameter Knob Web Component (<scdaw-knob>).
 * Ported concepts from openDAW ParameterLabelKnob and RelativeUnitValueDragging.
 */

import { SHARED_STYLES } from "./scdaw-styles.js";

const BaseElement = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

export function mapNormalizedToValue(
  norm,
  min = 0,
  max = 1,
  scaling = "linear",
) {
  const clampedNorm = Math.max(0, Math.min(1, Number(norm)));
  if (scaling === "exponential") {
    const positiveMin = Math.max(0.0001, min);
    return positiveMin * Math.pow(max / positiveMin, clampedNorm);
  }
  return min + (max - min) * clampedNorm;
}

export function mapValueToNormalized(
  val,
  min = 0,
  max = 1,
  scaling = "linear",
) {
  const clampedVal = Math.max(min, Math.min(max, Number(val)));
  if (scaling === "exponential") {
    const positiveMin = Math.max(0.0001, min);
    return Math.log(clampedVal / positiveMin) / Math.log(max / positiveMin);
  }
  return (clampedVal - min) / (max - min || 1);
}

export function formatValueWithUnit(val, unit = "") {
  const num = Number(val);
  if (unit === "Hz") {
    return `${Math.round(num)} Hz`;
  }
  if (unit === "s") {
    return num < 1.0 ? `${Math.round(num * 1000)} ms` : `${num.toFixed(2)} s`;
  }
  if (unit === "dB" || unit === "db") {
    return `${num > 0 ? "+" : ""}${Number.isInteger(num) ? num : num.toFixed(1)} dB`;
  }
  if (unit === "pan") {
    if (Math.abs(num) < 0.05) return "C";
    return num < 0
      ? `L${Math.round(Math.abs(num) * 100)}`
      : `R${Math.round(num * 100)}`;
  }
  if (unit === "%") {
    return `${Math.round(num * 100)}%`;
  }
  return Number.isInteger(num)
    ? `${num}`
    : `${num.toFixed(2)}${unit ? " " + unit : ""}`;
}

export class DawKnobElement extends BaseElement {
  static get observedAttributes() {
    return ["value", "min", "max", "scaling", "unit", "label", "default"];
  }

  constructor() {
    super();
    if (this.attachShadow) {
      this.attachShadow({ mode: "open" });
    }
    this._value = 0.5;
    this._isDragging = false;
    this._startY = 0;
    this._startNorm = 0;
  }

  connectedCallback() {
    this._syncFromAttributes();
    this.render();
    this._attachListeners();
  }

  attributeChangedCallback() {
    this._syncFromAttributes();
    this._updateVisuals();
  }

  _syncFromAttributes() {
    this.min = Number(this.getAttribute("min") ?? 0);
    this.max = Number(this.getAttribute("max") ?? 1);
    this.scaling = this.getAttribute("scaling") ?? "linear";
    this.unit = this.getAttribute("unit") ?? "";
    this.label = this.getAttribute("label") ?? "";
    this.defaultValue = Number(this.getAttribute("default") ?? this.min);
    if (this.hasAttribute("value")) {
      this._value = Number(this.getAttribute("value"));
    }
  }

  get value() {
    return this._value;
  }

  set value(v) {
    this._value = Number(v);
    this.setAttribute("value", String(v));
    this._updateVisuals();
  }

  _attachListeners() {
    if (!this.shadowRoot) return;
    const knob = this.shadowRoot.getElementById("knob");
    if (!knob) return;

    knob.addEventListener("pointerdown", (e) => {
      this._isDragging = true;
      this._startY = e.clientY;
      this._startNorm = mapValueToNormalized(
        this._value,
        this.min,
        this.max,
        this.scaling,
      );
      knob.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    });

    knob.addEventListener("pointermove", (e) => {
      if (!this._isDragging) return;
      const deltaY = this._startY - e.clientY;
      const sensitivity = e.shiftKey ? 0.001 : 0.005;
      const newNorm = Math.max(
        0,
        Math.min(1, this._startNorm + deltaY * sensitivity),
      );
      const nextVal = mapNormalizedToValue(
        newNorm,
        this.min,
        this.max,
        this.scaling,
      );
      this.value = nextVal;
      this.dispatchEvent(
        new CustomEvent("change", { detail: { value: nextVal } }),
      );
    });

    const stopDrag = () => {
      this._isDragging = false;
    };
    knob.addEventListener("pointerup", stopDrag);
    knob.addEventListener("pointercancel", stopDrag);

    // Double-click to reset
    knob.addEventListener("dblclick", () => {
      this.value = this.defaultValue;
      this.dispatchEvent(
        new CustomEvent("reset", { detail: { value: this.defaultValue } }),
      );
      this.dispatchEvent(
        new CustomEvent("change", { detail: { value: this.defaultValue } }),
      );
    });

    // Wheel adjustment
    knob.addEventListener("wheel", (e) => {
      e.preventDefault();
      const norm = mapValueToNormalized(
        this._value,
        this.min,
        this.max,
        this.scaling,
      );
      const step = (e.deltaY > 0 ? -1 : 1) * 0.03;
      const nextNorm = Math.max(0, Math.min(1, norm + step));
      const nextVal = mapNormalizedToValue(
        nextNorm,
        this.min,
        this.max,
        this.scaling,
      );
      this.value = nextVal;
      this.dispatchEvent(
        new CustomEvent("change", { detail: { value: nextVal } }),
      );
    });

    // Keyboard adjustment (WCAG 2.1 AA slider pattern)
    knob.addEventListener("keydown", (e) => {
      const norm = mapValueToNormalized(
        this._value,
        this.min,
        this.max,
        this.scaling,
      );
      const step = e.shiftKey ? 0.1 : 0.02;
      let nextNorm = null;
      if (e.key === "ArrowUp" || e.key === "ArrowRight") {
        nextNorm = Math.min(1, norm + step);
      } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
        nextNorm = Math.max(0, norm - step);
      } else if (e.key === "Home") {
        nextNorm = 0;
      } else if (e.key === "End") {
        nextNorm = 1;
      }
      if (nextNorm !== null) {
        e.preventDefault?.();
        const nextVal = mapNormalizedToValue(
          nextNorm,
          this.min,
          this.max,
          this.scaling,
        );
        this.value = nextVal;
        this.dispatchEvent(
          new CustomEvent("change", { detail: { value: nextVal } }),
        );
      }
    });
  }

  _updateVisuals() {
    if (!this.shadowRoot) return;
    const norm = mapValueToNormalized(
      this._value,
      this.min,
      this.max,
      this.scaling,
    );
    // Angle: from -135deg to +135deg (total 270 degrees)
    const angle = -135 + norm * 270;
    const knob = this.shadowRoot.getElementById("knob");
    const indicator = this.shadowRoot.getElementById("indicator");
    const arc = this.shadowRoot.getElementById("val-arc");
    const valText = this.shadowRoot.getElementById("val-text");
    const formatted = formatValueWithUnit(this._value, this.unit);

    if (knob) {
      knob.setAttribute("aria-valuenow", String(this._value));
      knob.setAttribute("aria-valuetext", formatted);
    }
    if (indicator) {
      indicator.setAttribute("transform", `rotate(${angle} 20 20)`);
    }
    if (arc) {
      const circumference = 2 * Math.PI * 14;
      const dashLength = (norm * 270 * circumference) / 360;
      arc.style.strokeDasharray = `${dashLength} ${circumference}`;
    }
    if (valText) {
      valText.textContent = formatted;
    }
  }

  render() {
    if (!this.shadowRoot) return;
    const formatted = formatValueWithUnit(this._value, this.unit);
    this.shadowRoot.innerHTML = `
      <style>
        ${SHARED_STYLES}
        :host {
          display: inline-flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          user-select: none;
        }
        .scdaw-knob__control,
        .knob-container {
          width: 40px;
          height: 40px;
          cursor: ns-resize;
          position: relative;
          touch-action: none;
          border-radius: 50%;
        }
        .scdaw-knob__svg,
        .knob-svg {
          width: 40px;
          height: 40px;
          display: block;
        }
        .scdaw-knob__label,
        .knob-label {
          font-size: 0.68rem;
          color: var(--shadow-claw-text-secondary, #94a3b8);
          font-weight: 600;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .scdaw-knob__value,
        .knob-value {
          font-size: 0.68rem;
          font-family: var(--mono);
          color: var(--accent);
          white-space: nowrap;
        }
      </style>
      <span class="scdaw-knob__label knob-label">${this.label}</span>
      <div class="scdaw-knob scdaw-knob__control knob-container" id="knob" role="slider" tabindex="0" aria-label="${this.label || "Parameter"}" aria-valuemin="${this.min}" aria-valuemax="${this.max}" aria-valuenow="${this._value}" aria-valuetext="${formatted}" title="${this.label} (Double-click to reset)">
        <svg class="scdaw-knob__svg knob-svg" viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r="14" fill="var(--bg-elevated)" stroke="var(--border)" stroke-width="2" />
          <circle id="val-arc" cx="20" cy="20" r="14" fill="none" stroke="var(--accent)" stroke-width="2.5"
            stroke-dasharray="0 100" transform="rotate(135 20 20)" stroke-linecap="round" />
          <line id="indicator" x1="20" y1="20" x2="20" y2="8" stroke="#ffffff" stroke-width="2" stroke-linecap="round" />
        </svg>
      </div>
      <span class="scdaw-knob__value knob-value" id="val-text" aria-hidden="true">${formatted}</span>
    `;
    this._updateVisuals();
  }
}

if (
  typeof customElements !== "undefined" &&
  !customElements.get("scdaw-knob")
) {
  customElements.define("scdaw-knob", DawKnobElement);
}
