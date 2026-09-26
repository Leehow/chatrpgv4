Status: ready (filed 2026-09-26, owner's decision after long gate #11; batch 12)
Stage: SL-72 (P2, host; the reading tools' per-turn budget)
Spec: docs/kernel-rpc.md §34.12 (the refusal budget by class), §135.31 (carried views), §135.11 (turn close)

# SL-72 — A per-turn budget for `look`, `lookup` and `recall`: past it the Keeper writes with what it has

## Evidence (long gate #11 t6: eleven `recall` calls in one turn, 71 s; gate #12: 22 looks over the table on a starter whose carried views already hold the scene and its people)
- With thinking off the deepseek Keeper re-reads instead of writing: the carried views (§135.31) already give it the scene, the people and the passages, and every extra look is a model step of 2–5 s. §34.12 counts refusals by class; nothing counts successful looks.

## Ruling (owner, 2026-09-26)
The reading tools have a per-turn budget, a named default (the count is data in rules, not a literal): once a turn's `look`+`lookup`+`recall` calls reach it, further calls of those tools are answered by the host without a kernel read, with a steer that names what the run already carries (the carried views' names) and says to write with it; `narrate`, `apply`, `resolve` and `ask` are never budgeted. A `lookup kind=source` that is `pending` (SL-36) does not count twice. The budget resets with the next player input, like §34.12. Telemetry: `{lane: "looks", reason: "look_budget", count, carried: [...]}` once per turn when it fires.

## Scope
1. Contract: §34.12 addendum (the look budget beside the refusal budget; the default; the steer's structure).
2. `extensions/kernel/index.ts` (where §34.12 counts) and the hybrid engine's steer text; the default in the rules data.
3. Tests, mutation-killable: the (N+1)th look in a turn is answered by the host with the steer and no kernel call; the count resets on player input; a `pending` source lookup counts once; narrate/apply/resolve/ask untouched; the gate #11 t6 replay (recorded Keeper) shows the run stopping its recall loop at the budget and delivering.

## Comments
