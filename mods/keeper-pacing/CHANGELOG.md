# Keeper Pacing

## 1.0.2
- Says when to advance a threat clock with the new `apply` `threat` effect (contract §30.9). Before it, nothing moved a clock, so `threat_clocks` stood at its authored segment forever and `on_tick_visible` had no reader.

## 1.0.1
- Adds `brief.md`, the per-turn reminder form of the instructions (contract §30.7); the first turn of a process still carries the full text.

## 1.0.0
- First release: fair-warning ladder from `context.pacing.v1` close calls, threat clock symptoms, compression and recovery guidance.
