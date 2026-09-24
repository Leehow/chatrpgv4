Status: ready-for-agent
Stage: SL-22 (amends §135.6 / §135.25; after SL-17)
Spec: docs/specs/pi-native-single-loop.md (Ruling: "The prescreen has its own budget; the policy's Jev budget is for decisions")

# SL-22 — The prescreen's calls do not spend the policy's decision budget

## Evidence (live gate #7, campaign gate7-haunting-0534, turn 3, run under `"turn":3`)
- read s1: prescreen prepared, 7 Jev calls, 10,119 ms, stop_reason timeout; read s4 (after the clerk's move): prescreen fallback "The operation was aborted due to timeout", 4 calls, 852 ms, 0 materials.
- Then: bind s13 `unavailable` (0 ms) → disposition to the Keeper; composes at s6, s10, s16, s18 with reason `jev_budget` (7.5 + 2.2 + 2.5 + 6.2 s), plus the turn-close audit-repair compose: seven model calls, 30.8 s.
- Since SL-17 the read row counts the prescreen's Jev calls; find whether the policy's `jevCalls`/`jevMs` budget (§135.25 / step-policy `exhausted`) includes them, and what the budget's numbers are.

## Scope
1. Contract first: dated addenda to §135.6 and §135.25 per the ruling: the prescreen's calls/time are reported but excluded from the decision budget; the per-turn prescreen allowance governs a second read (reuse when the scene is unchanged; else the remainder, never past it); a run whose decision budget is spent composes at most once for that reason and then lets the Keeper's proposals carry the run.
2. Implement in runtime/jev/hybrid-engine.ts (read step accounting) and step-policy.ts (`exhausted`, the `jev_budget` compose), with the second-read reuse.
3. Tests, mutation-killable (prescreen calls counted; second read re-runs a full prescreen on an unchanged scene; repeated jev_budget composes). Replay gate6-t3 / gate7 turn-3 fixture (build from the campaign, read-only) with live Jev, 3 runs: disposition bind asked (not unavailable), at most one `jev_budget` compose, model calls ≤ 5.

## Comments
