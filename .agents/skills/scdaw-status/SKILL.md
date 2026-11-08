---
name: scdaw-status
description: Check DAW playback state, BPM, current playhead position, and audio engine status.
user-invocable: true
metadata:
  allowed-tools: scdaw_get_status scdaw_get_project
  execution:
    type: tools
    tools:
      - name: scdaw_get_status
        input: {}
---

# DAW Status Skill

Queries the live Web Audio engine state and returns transport, tempo, and track composition metrics.

## Capabilities

1. **Engine Health**: Inspects audio context state (`running`, `locked`, `suspended`, or `unsupported`).
2. **Transport Position**: Reads current bar, beat, and 16th-note step index.
3. **Project Summary**: Reports tempo (BPM), track count, swing factor, and recent bounce results.

## Instructions for Agent

1. Call `scdaw_get_status` to inspect the engine.
2. If `audio` reports `"locked"`, remind the user to visit `/main/scdaw/` and click **Start Audio** to enable sound.
3. Report transport metrics clearly in markdown.
