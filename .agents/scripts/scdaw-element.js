/**
 * .agents/scripts/scdaw-element.js
 *
 * Modular Custom Elements barrel for Daw workbench:
 * - <scdaw-workbench>
 * - <scdaw-transport>
 * - <scdaw-browser>
 * - <scdaw-timeline>
 * - <scdaw-editor>
 * - <scdaw-sequencer>
 * - <scdaw-devices>
 * - <scdaw-mixer>
 * - <scdaw-knob>
 * - <scdaw-statusbar>
 * - <scdaw-resize-handle>
 *
 * Operates in direct mode (reading globalThis.__scdaw) or remote mode
 * (over BroadcastChannel) when embedded in preview iframes.
 */

export { DawKnobElement } from "./components/scdaw-knob.js";
export { DawTransportElement } from "./components/scdaw-transport.js";
export { DawBrowserElement } from "./components/scdaw-browser.js";
export { DawTimelineElement } from "./components/scdaw-timeline.js";
export { DawEditorElement } from "./components/scdaw-editor.js";
export { DawSequencerElement } from "./components/scdaw-sequencer.js";
export { DawDevicesElement } from "./components/scdaw-devices.js";
export { DawMixerElement } from "./components/scdaw-mixer.js";
export { DawStatusBarElement } from "./components/scdaw-statusbar.js";
export { DawWorkbenchElement } from "./components/scdaw-workbench.js";
export { DawResizeHandleElement } from "./components/scdaw-resize-handle.js";
