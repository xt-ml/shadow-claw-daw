# AGENTS.md — ShadowClaw DAW (Daw)

> Guidance for AI agents working on the ShadowClaw DAW site, tools, and agentic skills.

## Project Snapshot

In-browser Digital Audio Workstation (DAW) workbench, Web Audio API synthesis engine, TC39 Signals, declarative WebMCP tools, and autonomous skills:

- **Assistant Name**: `Daw`
- **Prefix Isolation**:
  - Tools prefix: `scdaw_*`
  - Custom Elements prefix: `scdaw-*`
  - Broadcast Channels: `scdaw-commands`, `scdaw-results`, `scdaw-state`
  - Pinned workbench: `pages/main/scdaw.html` (portal at `pages/main/index.html`)

## Subsystem Architecture & Guardrails

1. **Direct-Rendered Pinned Workbench (`scdaw.html`)**:
   - `AudioContext` requires top-level execution contexts and user gestures to resume audio rendering.
   - `scdaw.html` specifies `iframe: false` in frontmatter and is listed in `pages.directPages` in `shadow-claw.config.json`.
   - The audio engine singleton lives in `globalThis.__scdaw` to survive page transitions.
   - Leader election via Web Locks (`navigator.locks.request("scdaw-engine")`) ensures only one active workbench tab controls the AudioContext and replies to agent tool requests over `BroadcastChannel`.

2. **Namespace Isolation**:
   - Strictly enforced by `npm run check:compat` (`bin/check-namespace.mjs`).
   - Every tool must start with `scdaw_`.
   - Every custom element must start with `scdaw-`.
   - All BroadcastChannels must start with `scdaw-`.

3. **Pure Logic & Transports Separation**:
   - Core musical math, PPQN conversions, project validation, transaction reducers, and WAV encoding live in `.agents/scripts/scdaw.js` (zero DOM / Web Audio dependencies, 100% unit tested).
   - Reactive signal primitives live in `.agents/scripts/scdaw-signals.js`.
   - Audio graph creation, instrument synthesis, lookahead scheduling, and offline bouncing live in `.agents/scripts/scdaw-engine.js` and `.agents/scripts/scdaw-instruments.js`.
   - UI Web Components live in `.agents/scripts/scdaw-element.js`.
   - Worker-to-main IPC bridge and WebMCP registration live in `.agents/scripts/scdaw-adapter.js`.

4. **Declarative Tools & WebMCP**:
   - Single source of truth is `bin/tool-manifest.mjs`.
   - Generated into `.agents/tools/*.json` via `npm run build:tools` (`bin/generate-tools.mjs`).
   - Includes WebMCP boolean annotations (`readOnlyHint`, `consequentialHint`).

5. **Agent Skills**:
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
