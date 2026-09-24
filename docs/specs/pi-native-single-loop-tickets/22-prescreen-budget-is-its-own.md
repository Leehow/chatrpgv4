Status: ready-for-human
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

### 2026-09-24 — established, reproduced, fixed (branch `claude/sl22-20260924`, base `97285f39f`)

**Before the fix, the decision budget was 24 Jev calls and 12 000 ms.** The calls come from `PREPARATION_DECISION_BUDGET.actions`
(`runtime/jev/step-policy.ts:135`). The milliseconds are the preselect allowance: `maxJevMs: allowance` at
`runtime/jev/hybrid-engine.ts:711`, the default 12 000, which gate #7 ran with (the `prepared` row says `allowance_ms: 11913`
at s1). `exhausted` (`step-policy.ts:219`) is calls ≥ 24, ms ≥ 12 000, or steps ≥ 40.

**What spent it.** `settleRead` (`step-policy.ts:724`) added each read's `calls` and `ms` to `jevCalls`/`jevMs`. The read port
reported the prescreen's calls (`hybrid-engine.ts:349`). For `ms` it reported the whole read step, not only the prescreen
(`hybrid-engine.ts:380`). Gate #7's turn 3 then summed as:
- read s1, 10 166 ms and 7 calls;
- compile s2, 628 ms and 1 call;
- read s4, 1 116 ms and 4 calls;
- compile s5, 313 ms and 1 call.

That is 12 223 ms and 13 calls, so the budget was exhausted by milliseconds after s5. From there, `next`
(`step-policy.ts:268`) made each decision point a `compose` with reason `jev_budget` (s6, s10, s16, s18). The disposition
bind at s13 went `offline: "jev_budget"` and then to the Keeper as `clerk_unbound`.

The allowance also reached decisions directly. The ordinary binder's lease ended at the allowance deadline, with a floor of
1 s (`hybrid-engine.ts:523`). The second read ran under the same deadline (`:346`, `:709`), which is correct.

**Reproduced before the fix.**
- `tests/extension/single-loop-prescreen-budget.test.mjs` failed 5 of 5 at the base. On the gate #7 shape (real kernel, a
  slow prescreen), the run made one read and a `jev_budget` compose, and never reached the route or the move.
- BEFORE replay of `gate7-t3`: new fixture `fixtures/gate7` + `gate7-t3`, built read-only from `gate7-haunting-0534`. The
  arms and pass criteria were pre-registered in the session scratchpad before any run. Run 1 reproduced by calls instead of
  milliseconds. Two prescreens of 10 calls each plus 4 decisions came to 24 of 24. The run made 3 `jev_budget` composes, and
  the disposition bind was `unavailable`. Runs 2 and 3 had 5-call prescreens and did not reproduce.

**The fix** (contract §135.6 and §135.25 SL-22 addenda; §124.11's telemetry bullet amended):
- `settleRead` charges nothing. The read row and the new summary field `prescreen: {reads, jev_calls, ms}` report the
  prescreen, and the read artifact's `ms` is now the prescreen's own.
- A read on the scene of the run's previous read reuses that read's prescreen outcome: its materials, and the packet
  re-emitted with the new issued bodies. Its row is `status: "reused", from, jev_calls: 0, ms: 0`.
- A read on a changed scene runs under the remainder of the per-input allowance, never past it. The read row carries
  `allowance_ms`.
- `next` composes once for a spent decision budget. That compose's `coc-clerk` note carries `decision_budget` and a note
  saying the Keeper's own calls carry the rest of the turn. Later points are `infer(adjudicate)` with reason
  `keeper_carries`.
- The ordinary binder's lease is 15 s of its own.
- The budget summary gains `decision_budget: {jev_calls, jev_ms, max_jev_calls, max_jev_ms, spent}`.
- Nothing in the bind's rules defaults or in admission changed; that is SL-21's area.

**Replay** (`gate7-t3`, `--llm replay`, live Jev, 3 runs per arm, one process at a time; results in
`experiments/single-loop-routing/results/sl22-gate7-t3-{before,after}`):

| arm | run | read s1 prescreen | read after the move | decision budget at end | disposition bind | `jev_budget` composes | model calls |
|---|---|---|---|---|---|---|---|
| before | 1 | 10 calls, 4.5 s | 10 calls, 3.6 s | 24/24 calls (spent) | `unavailable` | 3 | 5 |
| before | 2 | 5 calls, 2.9 s | 5 calls, 2.7 s | not spent | asked (complete) | 0 | 5 |
| before | 3 | 5 calls, 3.0 s | 5 calls, 3.0 s | not spent | asked (complete) | 0 | 5 |
| after | 1 | 11 calls, 5.1 s | 8 calls, 2.8 s (allowance left 6.1 s) | 8 calls, 3.3 s | asked (complete) | 0 | 5 |
| after | 2 | 5 calls, 3.1 s | 3 calls, 1.7 s (8.1 s left) | 8 calls, 2.8 s | asked (complete) | 0 | 5 |
| after | 3 | 5 calls, 2.9 s | 3 calls, 1.7 s (8.3 s left) | 8 calls, 2.9 s | asked (complete) (and the first blow's bind) | 0 | 4 |

Pre-registered criteria, AFTER arm: disposition bind asked 3/3; at most one `jev_budget` compose 3/3 (0 each); model calls
≤ 5, 3/3.

After-run 1 is the case the fix is for. Its prescreens spent 19 calls, and under the old accounting 19 + 8 = 27 ≥ 24 would
have spent the budget. In all six runs the disposition bind that was asked still went to the Keeper (`clerk_unbound`):
Jev's answer did not clear the gate, and no rules default applied. That belongs to SL-19/SL-21, not to this ticket. The
fixture's scene changes at the move, so the replays never exercise the same-scene reuse; the driver test covers it.

**Mutations** (each applied to the final code, then restored; tests numbered in file order):

| mutation | killed by |
|---|---|
| M1 `settleRead` charges the prescreen again | 1 (policy seam, gate #7's numbers), 3 (gate #7 shape, real kernel) |
| M2 a compose per decision (once-guard removed) | 2 (policy seam), 6 (extension seam) |
| M3 no reuse: a full prescreen on an unchanged scene | 4 |
| M4 binder lease bound to the allowance remainder | 5 |
| M5 allowance renewed per read | 3 |
| M6 no note on the `jev_budget` compose | 6 |
| M7 summary does not report the prescreen | 3 |

**Suites** (leehow-pc, on this branch's working tree):
- `loop`: 129/129 pass.
- `ext`: 2890/2890 pass.
- `py`: not run. Nothing the kernel reads changed.

