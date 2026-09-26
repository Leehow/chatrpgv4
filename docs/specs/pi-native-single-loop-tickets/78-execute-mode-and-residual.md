Status: ready (opened 2026-09-26 by the owner for `clue_follow_up` only: "线索跟进先放权，NPC 反应继续影子"; batch 14)
Stage: SL-78 (P1, Stage 2b of `docs/specs/jev-driven-steps.md`: cleared consequence candidates execute; residual telemetry)
Spec: docs/specs/jev-driven-steps.md D3/D4/D6; §135.32; §135.8 (clerk did), §135.28 (rules-default line), §32.12 (admission on compile evidence)

# SL-78 — `COC_JEV_STEPS=on`: consequence candidates run as clerk steps; the loop re-routes after each; the Keeper's residual is measured

## Scope
1. Execute path for the three classes through the one operation gateway; admission on compile evidence; a fell step returns to the Keeper as today.
2. Re-route after an executed D1 step (a cleared clue or reaction may issue a `time_cost`; a move issues the next scene's classes) under the existing anti-loop gates and `maxSteps`.
3. Projection: the executed steps under "clerk did" with the rules-default line; the Keeper reconciles or reverses (no silent undo).
4. Residual telemetry per turn `{lane:"residual", keeper_calls:{apply,resolve,look,lookup,recall}, compile_calls, clerk_calls}`; the triage script reports it.
5. Tests: execute only when `on`; re-route once per executed step; the projection carries the step; residual row shape; an outage mid-run leaves the run deliverable.
6. Gate #15 pre-registered on D6 2b before launch.

## Comments

## Ruling (owner, 2026-09-26, after SL-77 on gates #14/#15/#16)
Execute mode is **per class**. `clue_follow_up` met D6 2a on three tables (agreement 6/6, 6/6, false positives 0/0/1) and executes; `npc_reaction` stays shadow (corrected agreement 0.50–0.60; the remaining misses are the Keeper not staging a first impression when engaged, SL-83 pending) until a later report meets the bar; `time_cost` never issued a candidate on the starter and stays shadow. The switch is data: `content/rulesets/coc7/host-budgets.json` `jev_steps.execute: ["clue_follow_up"]` (the env `COC_JEV_STEPS=on` enables execution for the listed classes; unlisted classes are routed and paired in shadow exactly as today). Everything else in Scope stands: the one gateway, admission on compile evidence, re-route after an executed step, the "clerk did" projection line, the `residual` row, and gate #17's pre-registration on D6 2b for this class (Keeper-chosen `apply clue` on handles the clerk already filed = 0; no clue the player did not reach; every executed clue appears in the prose or is reversed with a receipt).
