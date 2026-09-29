Status: ready-for-agent
Spec: docs/specs/jev-decides-llm-writes.md D-D · Contract §150.5 · Ticket SL-79 (`pi-native-single-loop-tickets/79-narrator-only-keeper.md`)

# 06 — Narrator-only compose catalog as a setting (default off)

Implement SL-79's scope 1–4 behind a setting (env over data, default off). Before narrowing, read the SL-78 residual rows available in this checkout for the reads the Keeper still made and check §135.31's carried views cover them; record gaps as findings in this ticket (no prompt workaround).

Tests: default catalog unchanged; with the setting on, compose exposes exactly narrate/ask/say/propose, bind/adjudicate keep theirs; `propose` on an offered key executes through admission; on a free handle refuses with the offered keys; the per-turn cap refuses the N+1th; a settled run delivers prose with zero Keeper tool calls.

## Comments
