/**
 * .agents/scripts/shadow-claw-daw-element.js
 *
 * Modular Custom Elements barrel for Daw workbench:
 * - <shadow-claw-daw-workbench>
 * - <shadow-claw-daw-transport>
 * - <shadow-claw-daw-browser>
 * - <shadow-claw-daw-timeline>
 * - <shadow-claw-daw-editor>
 * - <shadow-claw-daw-sequencer>
 * - <shadow-claw-daw-synth>
 * - <shadow-claw-daw-devices>
 * - <shadow-claw-daw-mixer>
 * - <shadow-claw-daw-knob>
 * - <shadow-claw-daw-status-bar>
 * - <shadow-claw-daw-resize-handle>
 *
 * Operates in direct mode (reading globalThis.__scdaw) or remote mode
 * (over BroadcastChannel) when embedded in preview iframes.
 */

export { ShadowClawDawKnob } from "./components/shadow-claw-daw-knob.js";
export { ShadowClawDawTransport } from "./components/shadow-claw-daw-transport.js";
export { ShadowClawDawBrowser } from "./components/shadow-claw-daw-browser.js";
export { ShadowClawDawTimeline } from "./components/shadow-claw-daw-timeline.js";
export { ShadowClawDawEditor } from "./components/shadow-claw-daw-editor.js";
export { ShadowClawDawWaveEditor } from "./components/shadow-claw-daw-wave-editor.js";
export { ShadowClawDawSpectrum } from "./components/shadow-claw-daw-spectrum.js";
export { ShadowClawDawSequencer } from "./components/shadow-claw-daw-sequencer.js";
export { ShadowClawDawSynth } from "./components/shadow-claw-daw-synth.js";
export { ShadowClawDawDevices } from "./components/shadow-claw-daw-devices.js";
export { ShadowClawDawMixer } from "./components/shadow-claw-daw-mixer.js";
export { ShadowClawDawStatusBar } from "./components/shadow-claw-daw-status-bar.js";
export { ShadowClawDawWorkbench } from "./components/shadow-claw-daw-workbench.js";
export { ShadowClawDawResizeHandle } from "./components/shadow-claw-daw-resize-handle.js";
