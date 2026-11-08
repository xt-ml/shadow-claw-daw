---
name: scdaw-doctor
description: Diagnose workbench connectivity, browser audio autoplay unlock state, and leader election.
user-invocable: true
metadata:
  allowed-tools: scdaw_get_status scdaw_get_levels
  execution:
    type: tools
    tools:
      - name: scdaw_get_status
        input: {}
---

# DAW Diagnostics & Doctor Skill

Diagnoses local audio workstation health and common runtime issues.

## Diagnostic Checks

1. **Workbench Tab**: Validates that an active workbench tab is open at `/main/scdaw/`.
2. **Autoplay Policy**: Checks if `audio` context is `locked` waiting for a user gesture.
3. **Leader Status**: Confirms Web Locks leadership status (`isLeader`).
4. **Levels & Signal Flow**: Confirms audio nodes are connected and signal flow is active.
