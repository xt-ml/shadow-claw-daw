---
name: scdaw-automate
description: Create, edit, and clear continuous parameter automation envelopes (volume fades, pan sweeps, and filter cutoff modulation) on DAW tracks.
user-invocable: true
metadata:
  allowed-tools: scdaw_set_automation scdaw_clear_automation scdaw_get_project scdaw_set_track
  execution:
    type: prompt
---

# Parameter Automation Skill

Automates continuous track parameters across time (measured in musical beats) for dynamic expression, filter sweeps, sidechain-like ducking, and volume fades.

## Instructions for Agent

1. Inspect project tracks and length using `scdaw_get_project`. Total beats = `lengthBars * 4`.
2. Determine which parameter to automate:
   - `volume`: 0.0 (silent) to 1.5 (boosted), nominal 0.8
   - `pan`: -1.0 (hard left) to 1.0 (hard right), center 0.0
   - `cutoff`: 20 Hz to 20000 Hz (for synth tracks)
3. To create a continuous curve (e.g. 4-beat filter sweep or volume fade-in):
   - Call `scdaw_set_automation` with `trackId`, `param`, and a `points` array sorted by beat `time`:
     ```json
     {
       "trackId": "trk_bass",
       "param": "cutoff",
       "points": [
         { "time": 0.0, "value": 300 },
         { "time": 2.0, "value": 1800 },
         { "time": 4.0, "value": 400 }
       ]
     }
     ```
4. To add or adjust a single point:
   - Call `scdaw_set_automation` with `trackId`, `param`, `time`, and `value`.
5. To clear automation on a track:
   - Call `scdaw_clear_automation` with `trackId` and optional `param`.
6. Verify automation by playing back with `scdaw_play` or rendering a bounce with `scdaw_bounce`.
