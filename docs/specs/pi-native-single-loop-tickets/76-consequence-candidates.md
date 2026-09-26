Status: ready (filed 2026-09-26; batch 13; after SL-71/72/73 merge — shares `hybrid-engine.ts`/`candidates.ts`)
Stage: SL-76 (P1, Stage 2a of `docs/specs/jev-driven-steps.md`: the three consequence candidate classes, shadow-routed)
Spec: docs/specs/jev-driven-steps.md D1–D4; docs/kernel-rpc.md §135.32; §135.2/§135.3 (candidates, clerk authority), §135.30 (fan-out rows), §32 affordances, §136 (rules as data); load the `typesafe-jev` skill first

# SL-76 — `npc_reaction`, `clue_follow_up`, `time_cost` become host-issued candidates, routed by Jev in shadow

## Scope
1. Contract §135.32 (written) is the rule; add the `consequence_bookkeeping` clerk authority to §135.3 as an addendum.
2. `runtime/jev/candidates.ts` (+ a new `consequence-candidates.ts`): the three classes exactly as D1 — sources, bound parameters, the Noul text per class with the criteria fields (`what`, `not_for`, `examples` from the person's role/position; the clue's book placement), the per-family `exists` Noul (D2.2). No candidate for a person the graph does not know, for hazards, sanity, pending choices.
3. `runtime/jev/route-compile.ts`/`step-policy.ts`: the new rows enter the same fan-out; thresholds from `content/rulesets/coc7/host-budgets.json` (add `jev_steps: {row_min, row_ratio, shadow: true}` beside `look_budget`); no literals.
4. `runtime/jev/hybrid-engine.ts`: `COC_JEV_STEPS=shadow|on|off` (default `shadow`); in shadow the cleared D1 candidates are never executed; at turn close pair each with the Keeper's own calls of the turn (same NPC first-impression / same clue handle / a time advance) and write `{lane:"route", shadow:true, class, key, cleared, confidence, distribution, keeper_did}`; in `on` they run as clerk steps (SL-78 accepts `on`; this ticket lands the switch and the shadow path).
5. Tests (mutation-killable, `tests/extension/`): each class issues only under its condition (met NPC → no candidate; discovered clue → none; gate unsatisfied → none; stated time cost → direct not a question); the rows carry no kernel tags; shadow never executes (assert zero clerk writes with a stub port that clears everything); the pairing row is written for the three outcomes; `packing_limit`/outage degrade to no D1 rows and a telemetry reason.
6. Keep the run's Jev budget honest: report added Jev ms per turn in the ticket from a replay of gate #12 t1/t7/t14.

## Comments
