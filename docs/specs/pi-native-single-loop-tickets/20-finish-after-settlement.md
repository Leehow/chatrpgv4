Status: ready-for-human
Stage: SL-20 (measure first, then rule; after SL-13 follow-up)
Spec: docs/specs/pi-native-single-loop.md (Ruling: "Once the clerk has settled the player's declaration, the run leans to finish")

# SL-20 — After the clerk settles the declaration, the run leans to finish

## Evidence (live gate #6, turn 2, campaign gate6-haunting-0335)
- The compile selected the obligation check; the clerk executed it (Persuade 16, hard success, `settled: true`) at 3.0 s. Then route s6 answered exit low_confidence → LLM: the Keeper ran a first-impression check and proposed a step on the next obligation (Ruth Blake), refused after a 57 s review; compose came at 96 s. The turn took 112 s for a declaration the clerk had settled by second 10.

## Scope
1. Measure on SL-13's fixtures (gate3-t2, gate4-t1, the gate6 turn-2 state) with live Jev, 5 runs each: the exit distribution right after a compile-selected candidate succeeded; how often `finish` would have been chosen under the proposed rule; what the Keeper did in those LLM steps in the recorded runs. Pre-register.
2. Rule from the numbers (write it as a dated addendum in §135.30 / §135.11): after the declaration's own step succeeded, `finish` is the default exit unless `continue`/`ask_llm` clears the gate on its own; the compose still receives the settlement's receipts and the obligation's book line; forced session steps (a pending defence) still run.
3. Implement in runtime/jev/step-policy.ts with tests (mutation-killable: default removed; forced step skipped), replay the three fixtures again, and report LLM steps and wall before/after.

## Comments

### 2026-09-24 — measured, ruled, implemented (branch `claude/sl20-20260924`, base `b8dd818bd`; merged with the integration branch at `e07e575af` as `edbea8c66`)

**Measurement (pre-registered in `10fa6683b`, scored in `0d90211ae`; `RESULTS-20260923.md`, "SL-20").** 5 runs per fixture on
the base policy, live Jev, recorded Keeper, `--seed 4 --latency live` (seed 4 is the one that passes the clerk's Persuade on
both morgue fixtures; seeds 1, 2, 3, 5 fail it). New fixture `gate6s-t2` (live gate #6 turn 2, from the read-only campaign;
named `gate6s` so it does not collide with SL-19's `gate6` tarball). Reader: `experiments/single-loop-routing/sl20-settlement.mjs`.

| fixture | settled | exit after it (ask_llm / continue / finish) | clears on its own | rule | model steps after (today) |
| --- | --- | --- | --- | --- | --- |
| gate6s-t2 | 5/5 (obligation check passed, `settled`) | 0.41–0.46 / 0.32–0.37 / 0.18–0.25 | 0/5 | finish 5/5 | first impression on Arty (fails) → batch_fallen → delivery |
| gate3-t2 | 5/5 | 0.44–0.49 / 0.29–0.32 / 0.19–0.23 | 0/5 | finish 5/5 | the recorded narrate |
| gate4-t1 | 5/5 (the move) | 0.61–0.63 / 0.18–0.21 / 0.02–0.03 | 5/5 (ask_llm, margin) | Keeper 5/5 | Arty staged + 25 min, then budget compose |

The recorded live Keepers: gate #6 made first impressions on Arty and Ruth, then Ruth's again and a keys define/object
(refused after 57 s) -- none declared; gate #3's made nothing but the delivery; gate #4's staged the gatekeeper, the
declaration's own second half, and the exit said so.

**Ruling as written** (contract §135.11, "Addendum 2026-09-24 (SL-20)", `bb21d431e`, amended `a8828645a`, `70a851f43`): a
clerk step settles the declaration when a compile of the run selected it, the kernel took it, and a resolve's check did not
fail (`outcome.passed`/`success` false); after that, needs the route selects still run, and with none selected the exit is
the compose (reason `settled`) unless `continue` or `ask_llm` clears the gates on its own (a cleared `finish` is the compose
as always). The lean holds until the run's next model step. Forced steps run before the route, the compose's note carries
the settlement's `clerk_did` (receipts, the obligation's book line) and a `settled_note`. The first blow (SL-19) settles
like any compile-selected step.

**Where it lives.** `runtime/jev/step-policy.ts`: `RunView.compileSelected` / `settled`, `settleCompile` records the
selection, `settleExecute` the settlement, `startStep` clears it at a model step, `interpretRoute` the lean, the route
question carries `settled`. `runtime/jev/hybrid-engine.ts`: `check` on the clerk's execute summary, `settled` on the route
row, `settled_note`. `experiments/single-loop-routing/product-entry.ts`: the replayed Keeper answers a `settled` compose
with the delivery. Tests: `tests/extension/single-loop-settlement.test.mjs` (7).

**Mutations** (applied to the worktree, the covering file run, restored; all killed):

| mutation | file | failing tests |
| --- | --- | --- |
| M1 the default removed (no lean) | step-policy.ts | 4 |
| M2 forced step skipped (the lean read ahead of the pending head) | step-policy.ts | 4 |
| M3 a failed check settles | step-policy.ts | 1 |
| M4 any clerk step settles (not only compile-selected) | step-policy.ts | 2 |
| M5 a cleared `continue`/`ask_llm` no longer overrides | step-policy.ts | 1 |
| M6 the compile's selection not recorded | step-policy.ts | 4 |
| M7 the execute summary without `check` | hybrid-engine.ts | 1 |
| M8 no `settled_note` | hybrid-engine.ts | 1 |
| M9 the lean does not end at the next model step | step-policy.ts | 1 |

**A finding the registration caught.** The first version held the lean for every later route of the run. On the two-part
declarations ("go back to the office and punch him", gate #6 / gate #3 turn 3) the clerk's move settled, the exit cleared
`ask_llm`, the Keeper ran the fight, and a later route leaned: the replayed Keeper's `combat:end` never ran in 8/9 runs
(`results/sl20-v1-*`). Fixed in `70a851f43` (M9 covers it); after the fix 9/9.

**Replays before/after** (paired on `edbea8c66`: before = the lean off by M1, after = as committed; `--seed 4 --latency live`):

| fixture | route after settlement | LLM steps | wall (s) | compose at (s) |
| --- | --- | --- | --- | --- |
| gate6s-t2 before | low_confidence 5/5 | 2 | 35.1–38.7 | 23.0–26.6 |
| gate6s-t2 after | settled 5/5 | **1** | **19.0–24.2** | **6.8–11.9** |
| gate3-t2 before | low_confidence 3, ask_llm 2 | 1 | 17.4–18.0 | 6.7–7.4 |
| gate3-t2 after | settled 4, ask_llm 1 | 1 | 13.8–23.0 | 3.2–12.4 |
| gate4-t1 before / after | ask_llm 5/5 both | 4 / 4 | 62.8–63.3 / 65.2–70.3 | 51.7–52.1 / 54.1–59.3 |
| control (check failed) after | no settlement 3/3 | 2 | 35.7–42.1 | — |

Two-part declarations (gate6-t3, gate6-t3-card, gate3-t3, 3 runs each): `combat:end` 3/3 and live rows 8/8, 8/8, 7/7 in both
arms; no `settled` compose. Four after-arm runs where Jev's own latency spent the run's Jev budget before the compile
(read 10.2 s, compile/bind 3.4–15.0 s) never reached a settlement; they are kept and were replaced (RESULTS says which).
The replay cannot show whether a live Keeper obeys `settled_note`; the instrument answers the settled compose with the
recorded delivery. The live table's 57 s refused review is not in any replay (a call the live kernel refused is never
replayed), so the live saving on gate #6's turn is larger than the replay's ~16 s.

**Suites** (leehow-pc, at `cb254d1f7`, which carries the merge and all code): `test:ext` 2884/2884; loop suites 123/123.
pytest not run: the SL-20 change touches no kernel file (the merged SL-19 kernel change is the integration branch's).

