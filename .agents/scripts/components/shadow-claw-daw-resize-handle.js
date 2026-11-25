/**
 * .agents/scripts/components/shadow-claw-daw-resize-handle.js
 *
 * Accessible, touch-friendly split-pane resize handle Web Component (<shadow-claw-daw-resize-handle>).
 * Delegates to ShadowClaw's shared `<shadow-claw-resize-handle>` base element while
 * preserving the `scdaw-resize` / `scdaw-resize-end` custom event contract.
 */

import { defineElement } from "shadow-claw/components/shadow-claw-element";
import {
  ShadowClawResizeHandle,
  clampSize,
  computeKeyboardResize,
  getResizeHandleAriaAttributes,
} from "shadow-claw/components/shadow-claw-resize-handle";

export {
  clampSize,
  computeKeyboardResize,
  getResizeHandleAriaAttributes as getAriaAttributes,
};

export class ShadowClawDawResizeHandle extends ShadowClawResizeHandle {
  connectedCallback() {
    super.connectedCallback();

    if (typeof this.addEventListener === "function") {
      const onResize = (e) => {
        this.dispatchEvent(
          new CustomEvent("scdaw-resize", {
            bubbles: true,
            composed: true,
            detail: e.detail,
          }),
        );
      };
      const onResizeEnd = (e) => {
        this.dispatchEvent(
          new CustomEvent("scdaw-resize-end", {
            bubbles: true,
            composed: true,
            detail: e.detail,
          }),
        );
      };
      this.addEventListener("shadow-claw-resize", onResize);
      this.addEventListener("shadow-claw-resize-end", onResizeEnd);
      this.addCleanup(() => {
        this.removeEventListener("shadow-claw-resize", onResize);
        this.removeEventListener("shadow-claw-resize-end", onResizeEnd);
      });
    }
  }
}

defineElement("shadow-claw-daw-resize-handle", ShadowClawDawResizeHandle);
