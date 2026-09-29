Status: blocked (filed 2026-09-26; opens when two consecutive tables meet D6 2b)
Stage: SL-79 (P2, Stage 3 of `docs/specs/jev-driven-steps.md`: the Keeper's compose step keeps narrate/ask/say and one typed `propose`)
Spec: docs/specs/jev-driven-steps.md D5/D6; §135.32; §135.4 (one tool catalog), §34.12/SL-72 (budgets that then become unnecessary for the Keeper)

# SL-79 — Narrator-only Keeper: `apply`/`resolve`/`look`/`lookup`/`recall` leave the compose step's catalog; `propose` names a candidate key, never a handle

## Scope
1. A setting (default off) that narrows the compose step's tool catalog to `narrate`, `ask`, `say`, `propose`.
2. `propose {key}`: one more clerk step from the run's offered candidate set, routed through the same admission; refused with the offered keys when the key is not among them; at most N per turn (data).
3. The read step and carried views must cover what the Keeper used `look`/`recall` for (measure on the residual rows of SL-78 which reads remained and fold them into §135.31's views before switching).
4. Tests: catalog narrowing; `propose` on an offered key executes, on a free handle refuses with keys; the Keeper's prose still delivers with zero tool calls.
5. Gate #16 pre-registered on D6 3.

## Comments
- 2026-09-28: scope 1–4 are built behind the setting by `docs/specs/jev-decides-llm-writes-tickets/06-narrator-only-setting.md` (contract §150.5 and its implementation decision): `COC_NARRATOR_ONLY` over `narrator_only` in the host budget data, default off. Scope 3's measurement is in that ticket's Comments: two view gaps remain for the owner (a present, already-met person no candidate names; the Keeper's own targeted question of the book). This ticket's status is unchanged: turning the setting on stays gated on D6 3 (scope 5).
