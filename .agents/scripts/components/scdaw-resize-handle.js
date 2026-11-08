/**
 * .agents/scripts/components/scdaw-resize-handle.js
 *
 * Accessible, touch-friendly split-pane resize handle Web Component (<scdaw-resize-handle>).
 * Conforms to WCAG 2.1 AA (role="separator", keyboard navigation, ARIA values)
 * and supports pointer capture for mouse and touch dragging.
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
) {
  const delta = shiftKey ? step * 5 : step;
  if (key === "ArrowRight" || key === "ArrowDown") {
    return clampSize(current + delta, min, max);
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return clampSize(current - delta, min, max);
  }
  if (key === "Home") {
    return min;
  }
  if (key === "End") {
    return max;
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
    return ["orientation", "value", "min", "max", "label"];
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
      const delta = currentPos - this._startPos;
      const nextVal = clampSize(this._startValue + delta, this._min, this._max);
      if (nextVal !== this._value) {
        this._value = nextVal;
        this.setAttribute("value", String(nextVal));
        this._updateAria();
        this.dispatchEvent(
          new CustomEvent("scdaw-resize", {
            bubbles: true,
            composed: true,
            detail: { value: nextVal, delta, orientation: this._orientation },
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
          detail: { value: this._value, orientation: this._orientation },
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
          display: inline-block;
          user-select: none;
          touch-action: none;
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
          min-height: 80px;
        }
        .scdaw-resize-handle--horizontal {
          width: 100%;
          height: 8px;
        }
        /* Visual indicator line */
        .scdaw-resize-handle__indicator {
          background: var(--border-subtle, #1e293b);
          border-radius: 2px;
          transition: background 0.15s ease, box-shadow 0.15s ease;
        }
        .scdaw-resize-handle--vertical .scdaw-resize-handle__indicator {
          width: 2px;
          height: 32px;
        }
        .scdaw-resize-handle--horizontal .scdaw-resize-handle__indicator {
          width: 32px;
          height: 2px;
        }
        /* Expanded touch target hit area (min 44px touch compliant) */
        .scdaw-resize-handle::after {
          content: "";
          position: absolute;
          inset: ${isVert ? "0 -18px" : "-18px 0"};
          z-index: 10;
        }
        .scdaw-resize-handle:hover .scdaw-resize-handle__indicator,
        .scdaw-resize-handle--active .scdaw-resize-handle__indicator {
          background: var(--accent, #00f2fe);
          box-shadow: 0 0 8px var(--accent-glow, rgba(0, 242, 254, 0.4));
        }
        .scdaw-resize-handle:focus-visible .scdaw-resize-handle__indicator {
          background: var(--accent, #00f2fe);
          outline: 2px solid var(--accent, #00f2fe);
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
