/**
 * .agents/scripts/components/scdaw-resize-handle.js
 *
 * Accessible, touch-friendly split-pane resize handle Web Component (<scdaw-resize-handle>).
 * Conforms to WCAG 2.1 AA (role="separator", keyboard navigation, ARIA values)
 * and supports pointer capture for mouse and touch dragging.
 * Supports directional inversion (invert) for panels positioned on the right/bottom of handles.
 */

import { SHARED_STYLES } from "./scdaw-styles.js";

const BaseElement = typeof HTMLElement !== "undefined" ? HTMLElement : class {};

export function clampSize(val, min = 100, max = 800) {
  const num = Number(val);
  if (Number.isNaN(num)) return min;
  return Math.max(min, Math.min(max, num));
}

export function computeKeyboardResize(
  key,
  shiftKey,
  current,
  min,
  max,
  step = 10,
  invert = false,
) {
  const delta = shiftKey ? step * 5 : step;
  const effectiveDelta = invert ? -delta : delta;
  if (key === "ArrowRight" || key === "ArrowDown") {
    return clampSize(current + effectiveDelta, min, max);
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return clampSize(current - effectiveDelta, min, max);
  }
  if (key === "Home") {
    return invert ? max : min;
  }
  if (key === "End") {
    return invert ? min : max;
  }
  return current;
}

export function getAriaAttributes(
  orientation = "vertical",
  val = 200,
  min = 100,
  max = 500,
  label = "Resize panel",
) {
  return {
    role: "separator",
    tabindex: "0",
    "aria-orientation": orientation,
    "aria-valuenow": String(Math.round(val)),
    "aria-valuemin": String(Math.round(min)),
    "aria-valuemax": String(Math.round(max)),
    "aria-label": label,
  };
}

export class DawResizeHandleElement extends BaseElement {
  static get observedAttributes() {
    return [
      "orientation",
      "value",
      "min",
      "max",
      "label",
      "invert",
      "direction",
    ];
  }

  constructor() {
    super();
    if (this.attachShadow) {
      this.attachShadow({ mode: "open" });
    }
    this._orientation = "vertical"; // "vertical" | "horizontal"
    this._value = 240;
    this._min = 150;
    this._max = 500;
    this._label = "Resize panel";
    this._invert = false;
    this._isDragging = false;
    this._startPos = 0;
    this._startValue = 0;
  }

  connectedCallback() {
    this._syncAttributes();
    this.render();
    this._attachListeners();
  }

  attributeChangedCallback() {
    this._syncAttributes();
    this._updateAria();
  }

  _syncAttributes() {
    this._orientation =
      this.getAttribute("orientation") === "horizontal"
        ? "horizontal"
        : "vertical";
    this._min = Number(this.getAttribute("min") ?? 120);
    this._max = Number(this.getAttribute("max") ?? 600);
    this._value = clampSize(
      this.getAttribute("value") ?? 240,
      this._min,
      this._max,
    );
    this._label =
      this.getAttribute("label") || `Resize ${this._orientation} panel`;
    this._invert =
      (this.hasAttribute("invert") &&
        this.getAttribute("invert") !== "false") ||
      this.getAttribute("direction") === "reverse";
  }

  _updateAria() {
    if (!this.shadowRoot) return;
    const handle = this.shadowRoot.querySelector(".scdaw-resize-handle");
    if (!handle) return;
    const attrs = getAriaAttributes(
      this._orientation,
      this._value,
      this._min,
      this._max,
      this._label,
    );
    for (const [k, v] of Object.entries(attrs)) {
      handle.setAttribute(k, v);
    }
  }

  _attachListeners() {
    if (!this.shadowRoot) return;
    const handle = this.shadowRoot.querySelector(".scdaw-resize-handle");
    if (!handle) return;

    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this._isDragging = true;
      handle.classList.add("scdaw-resize-handle--active");
      this._startPos = this._orientation === "vertical" ? e.clientX : e.clientY;
      this._startValue = this._value;
      if (typeof handle.setPointerCapture === "function") {
        handle.setPointerCapture(e.pointerId);
      }
    });

    handle.addEventListener("pointermove", (e) => {
      if (!this._isDragging) return;
      const currentPos =
        this._orientation === "vertical" ? e.clientX : e.clientY;
      const rawDelta = currentPos - this._startPos;
      const delta = this._invert ? -rawDelta : rawDelta;
      const nextVal = clampSize(this._startValue + delta, this._min, this._max);
      if (nextVal !== this._value) {
        this._value = nextVal;
        this.setAttribute("value", String(nextVal));
        this._updateAria();
        this.dispatchEvent(
          new CustomEvent("scdaw-resize", {
            bubbles: true,
            composed: true,
            detail: {
              value: nextVal,
              delta,
              rawDelta,
              orientation: this._orientation,
              invert: this._invert,
            },
          }),
        );
      }
    });

    const endDrag = (e) => {
      if (!this._isDragging) return;
      this._isDragging = false;
      handle.classList.remove("scdaw-resize-handle--active");
      if (
        e &&
        typeof handle.releasePointerCapture === "function" &&
        e.pointerId
      ) {
        try {
          handle.releasePointerCapture(e.pointerId);
        } catch (_) {}
      }
      this.dispatchEvent(
        new CustomEvent("scdaw-resize-end", {
          bubbles: true,
          composed: true,
          detail: {
            value: this._value,
            orientation: this._orientation,
            invert: this._invert,
          },
        }),
      );
    };

    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);

    // Keyboard navigation (WCAG 2.1 AA)
    handle.addEventListener("keydown", (e) => {
      const next = computeKeyboardResize(
        e.key,
        e.shiftKey,
        this._value,
        this._min,
        this._max,
        10,
        this._invert,
      );
      if (next !== this._value) {
        e.preventDefault();
        this._value = next;
        this.setAttribute("value", String(next));
        this._updateAria();
        this.dispatchEvent(
          new CustomEvent("scdaw-resize", {
            bubbles: true,
            composed: true,
            detail: {
              value: next,
              delta: next - this._value,
              orientation: this._orientation,
              invert: this._invert,
            },
          }),
        );
      }
    });
  }

  render() {
    if (!this.shadowRoot) return;
    const isVert = this._orientation === "vertical";
    const attrs = getAriaAttributes(
      this._orientation,
      this._value,
      this._min,
      this._max,
      this._label,
    );

    this.shadowRoot.innerHTML = `
      <style>
        ${SHARED_STYLES}
        :host {
          display: inline-flex;
          align-self: stretch;
          user-select: none;
          touch-action: none;
        }
        :host(.hidden),
        :host([hidden]) {
          display: none !important;
        }
        .scdaw-resize-handle {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          cursor: ${isVert ? "col-resize" : "row-resize"};
          outline: none;
          touch-action: none;
        }
        .scdaw-resize-handle--vertical {
          width: 8px;
          height: 100%;
          min-height: 100%;
        }
        .scdaw-resize-handle--horizontal {
          width: 100%;
          height: 8px;
        }
        /* Continuous subtle split line */
        .scdaw-resize-handle::before {
          content: "";
          position: absolute;
          background: var(--border-subtle, rgba(255, 255, 255, 0.08));
          transition: background 0.15s ease;
        }
        .scdaw-resize-handle--vertical::before {
          top: 0;
          bottom: 0;
          left: 50%;
          width: 1px;
          transform: translateX(-50%);
        }
        .scdaw-resize-handle--horizontal::before {
          left: 0;
          right: 0;
          top: 50%;
          height: 1px;
          transform: translateY(-50%);
        }
        /* Visual indicator pill */
        .scdaw-resize-handle__indicator {
          position: relative;
          z-index: 1;
          background: var(--border, #3f4849);
          border-radius: 2px;
          transition: background 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
        }
        .scdaw-resize-handle--vertical .scdaw-resize-handle__indicator {
          width: 3px;
          height: 36px;
        }
        .scdaw-resize-handle--horizontal .scdaw-resize-handle__indicator {
          width: 36px;
          height: 3px;
        }
        /* Expanded touch target hit area (min 44px touch compliant) */
        .scdaw-resize-handle::after {
          content: "";
          position: absolute;
          inset: ${isVert ? "0 -10px" : "-10px 0"};
          z-index: 10;
        }
        .scdaw-resize-handle:hover::before,
        .scdaw-resize-handle--active::before {
          background: var(--accent, #80d4db);
        }
        .scdaw-resize-handle:hover .scdaw-resize-handle__indicator,
        .scdaw-resize-handle--active .scdaw-resize-handle__indicator {
          background: var(--accent, #80d4db);
          box-shadow: 0 0 8px var(--accent-glow, rgba(128, 212, 219, 0.45));
        }
        .scdaw-resize-handle:focus-visible .scdaw-resize-handle__indicator {
          background: var(--accent, #80d4db);
          outline: 2px solid var(--accent, #80d4db);
          outline-offset: 2px;
        }
      </style>
      <div class="scdaw-resize-handle scdaw-resize-handle--${this._orientation}"
           role="${attrs.role}"
           tabindex="${attrs.tabindex}"
           aria-orientation="${attrs["aria-orientation"]}"
           aria-valuenow="${attrs["aria-valuenow"]}"
           aria-valuemin="${attrs["aria-valuemin"]}"
           aria-valuemax="${attrs["aria-valuemax"]}"
           aria-label="${attrs["aria-label"]}">
        <div class="scdaw-resize-handle__indicator"></div>
      </div>
    `;
  }
}

if (
  typeof customElements !== "undefined" &&
  !customElements.get("scdaw-resize-handle")
) {
  customElements.define("scdaw-resize-handle", DawResizeHandleElement);
}
