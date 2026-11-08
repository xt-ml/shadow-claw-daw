---
name: mixdown
description: Analyze audio meter levels and automatically adjust track gains to eliminate clipping and achieve balanced headroom.
user-invocable: true
metadata:
  allowed-tools: scdaw_get_levels scdaw_get_project scdaw_set_track scdaw_manage_fx scdaw_reset
  execution:
    type: prompt
---

# Mixdown & Gain Staging Skill

Balances track faders and inserts mix bus processing to achieve a clean master bus mix with −6 dBFS target peak headroom.

## Instructions for Agent

1. Query current audio levels using `scdaw_get_levels`.
2. Inspect `master.peakDb`, `master.clipping`, and per-track `peakDb`.
3. If master is clipping (`clipping === true` or `peakDb > -1`), identify the hottest tracks and lower their volumes using `scdaw_set_track`.
4. Insert bus compressors or EQs using `scdaw_manage_fx` (`action: "add"`, `fxType: "compressor"` or `"revamp"`) if a track requires dynamic control.
5. Ensure balanced relative loudness between drum kick/snare and synth channels.
6. Report before/after peak levels in a clean markdown table.
