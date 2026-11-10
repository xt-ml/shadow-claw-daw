# AGENTS.md — ShadowClaw DAW (Daw)

> Guidance for AI agents working on the ShadowClaw DAW site, tools, and agentic skills.

## Project Snapshot

In-browser Digital Audio Workstation (DAW) workbench, Web Audio API synthesis engine, TC39 Signals, declarative WebMCP tools, and autonomous skills:

- **Assistant Name**: `ShadowClaw DAW` (`Daw`)
- **Prefix Isolation**:
  - Tools prefix: `scdaw_*` (36 declarative tools)
  - Custom Elements prefix: `scdaw-*` (11 modular Web Components)
  - Broadcast Channels: `scdaw-commands`, `scdaw-results`, `scdaw-state`
  - Pinned workbench: `pages/main/index.html` (`/main/`)

## Subsystem Architecture & Guardrails

1. **Direct-Rendered Pinned Workbench (`pages/main/index.html`)**:
   - `AudioContext` requires top-level execution contexts and user gestures to resume audio rendering.
   - `pages/main/index.html` specifies `iframe: false` in frontmatter and is configured as `defaultPinnedPage` and listed in `pages.directPages` in `shadow-claw.config.json`.
   - The audio engine singleton lives in `globalThis.__scdaw` to survive page transitions.
   - Leader election via Web Locks (`navigator.locks.request("scdaw-engine")`) ensures only one active workbench tab controls the AudioContext and replies to agent tool requests over `BroadcastChannel`.

2. **Namespace Isolation**:
   - Strictly enforced by `npm run check:compat` (`bin/check-namespace.mjs`).
   - Every tool must start with `scdaw_`.
   - Every custom element must start with `scdaw-`.
   - All BroadcastChannels must start with `scdaw-`.

3. **Pure Logic, Storage & Transports Separation**:
   - Core musical math, PPQN conversions (`PPQN.Quarter = 960`), project validation, transaction reducers, audio clip scheduling, continuous parameter automation interpolation (`automationValueAt`), and WAV encoding live in `.agents/scripts/scdaw.js` (zero DOM / Web Audio dependencies, 100% unit tested).
   - Parameter schemas, automatable parameter definitions (`AUTOMATABLE_PARAMS`), curated presets, and custom DSP curves/processors live in `.agents/scripts/scdaw-schema.js`, `.agents/scripts/scdaw-presets.js`, and `.agents/scripts/scdaw-dsp.js`.
   - SMF MIDI codec, DAWproject v1.0 XML/ZIP interchange (including Points automation lanes and embedded Audio sample stems), zero-dependency ZIP archive encoding/decoding, and OPFS conversation storage live in `.agents/scripts/scdaw-midi.js`, `.agents/scripts/scdaw-dawproject.js`, `.agents/scripts/scdaw-zip.js`, and `.agents/scripts/scdaw-fs.js`.
   - Reactive signal primitives live in `.agents/scripts/scdaw-signals.js`.
   - Audio graph creation, instrument synthesis (`Vaporisateur` synth & `Playfield` drums), timeline audio clip buffer playback, real-time lookahead scheduling, parameter ramping (`linearRampToValueAtTime`), auxiliary send/bus routing, reactive track selection (`selectedTrackId`), and offline WAV/stems bouncing live in `.agents/scripts/scdaw-engine.js` and `.agents/scripts/scdaw-instruments.js`.
   - UI Web Components live in `.agents/scripts/scdaw-element.js` and `.agents/scripts/components/scdaw-*.js`.
   - Worker-to-main IPC bridge and WebMCP registration live in `.agents/scripts/scdaw-adapter.js`.

4. **Mobile-First Responsive Layout, BEM & Accessibility**:
   - All UI components follow a **Mobile-First** architecture with progressive enhancement via `min-width` `@container` queries (`< 640px` stacked mobile layout, `>= 640px` and `>= 1024px` multi-pane studio CSS Grid) and `@supports not (container-type: inline-size)` isolated `@media` fallbacks so desktop viewport widths never override narrow docked containers.
   - In `<scdaw-workbench>`, the 4 toolbar groups (`--project`, `--docks`, `--actions`, `--views`) are flattened sibling flex children of `.scdaw-workbench__toolbar` with `flex: 0 0 auto` at `>= 640px` so groups flow directly to the right of `Reset` and wrap cleanly as whole units without `overflow-x: auto` scrollbars or overlapping adjacent buttons.
   - Styling uses strict BEM naming conventions (`.scdaw-workbench__*`, `.scdaw-transport__*`, `.scdaw-statusbar__*`, `.scdaw-timeline__*`, `.scdaw-devices__*`, `.scdaw-knob__*`) and WCAG 2.1 AA ARIA landmarks, `role="slider"` / `role="separator"` keyboard navigation, `aria-pressed` / `aria-selected` states, and `:focus-visible` outlines.
   - Panel and splitter visibility in `<scdaw-workbench>` is controlled via `.hidden` / `[hidden]` (`display: none !important`). Never force `<scdaw-resize-handle>` visible with `!important` in container queries, and ensure `#mixer-handle` retains the `invert` attribute so dragging left expands the right-hand Mixer dock.
   - When checking Web IDL interfaces such as `LaunchParams`, always test property existence with `"files" in window.LaunchParams.prototype` rather than invoking prototype getters directly.

5. **Declarative Tools & WebMCP**:
   - Single source of truth for all 36 tools is `bin/tool-manifest.mjs`.
   - Generated into `.agents/tools/*.json` via `npm run build:tools` (`bin/generate-tools.mjs`).
   - Includes WebMCP boolean annotations (`readOnlyHint`, `consequentialHint`).

6. **Agent Skills**:
   - Defined in `.agents/skills/<name>/SKILL.md`.
   - Agent skills discovery index generated at `.well-known/agent-skills/index.json`.

## Commands

```bash
npm test                  # Run node:test unit suites
npm run check             # Run compatibility and tool manifest checks
npm run build:tools       # Regenerate .agents/tools/*.json
npm run skills:index      # Regenerate .well-known/agent-skills/index.json
npx shadow-claw dev       # Launch local preview server
npx shadow-claw build     # Production build to dist/public
```
