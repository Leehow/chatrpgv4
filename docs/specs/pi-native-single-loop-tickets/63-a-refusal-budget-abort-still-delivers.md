Status: ready-for-human (implemented 2026-09-25)
Stage: SL-63 (P1, turn close)
Spec: docs/kernel-rpc.md §135.11 (turn close; SL-16 fallback), the refusal budget (§ three strikes)

# SL-63 — A run the refusal budget aborts is a delivery drop like any other: the fallback narrates

## Evidence (long gate #10 t4)
- After three `unknown_entity` refusals the refusal budget blocked the Keeper's further calls, the run ended `aborted_during_operate`, the host sent `turn_unfinished_notice`, the turn settled `settled_without_delivery` and was recorded stranded; the player saw no fiction although the compile's move had landed (the party is at the Hall of Records) and the Keeper had material. SL-16's fallback ("a turn never strands") covers refused deliveries and preparation waits, not a run the refusal budget aborts.

## Ruling (owner, 2026-09-25)
The refusal budget ends the Keeper's attempts, not the turn: when it aborts a run, the turn closes through SL-16's fallback with what landed (receipts, the carried scene) and the Keeper's last draft if any; the notice is the fallback's fallback, never the whole delivery.

## Scope
1. Contract: §135.11 addendum: `aborted_during_operate` by the refusal budget is a drop with reason `refusal_budget`; the fallback narrate runs once.
2. `runtime/jev/hybrid-engine.ts` / `extensions/kernel/index.ts` turn close: route the abort into the SL-16 path.
3. Tests, mutation-killable: a run aborted by the refusal budget delivers the fallback and is not stranded; the stranded record is not written; the gate #10 t4 replay delivers.

## Comments

**2026-09-25, implemented (worker, branch `claude/sl62-20260925`, base `07b306a22`).**

- Contract: docs/kernel-rpc.md §135.11.3 (new subsection, no renumbering; placed after §135.11.2, before
  §135.20).
- Host, `extensions/kernel/index.ts`: a new `TableState.refusalBudgetCut` flag, set alongside the existing
  `runCut` at the one `blockedAfterExhausted >= RUNAWAY_ABORT_AT` cut inside the refusal-budget's own
  `shut` branch (the turn-has-no-door cut of §34.16 is untouched -- different scenario, same shared
  thresholds); a `lane: "delivery", ok: false, reason: "refusal_budget"` drop row recorded there, since no
  later `message_end` runs to record it the usual way. At `agent_settled`, before the run is judged
  undelivered, `refusalBudgetCut` (read once, cleared) gates one call to `deliverRefusalBudgetFallback`:
  the table's own `floorDraft` if the turn already dropped one, else a new localised service line
  (`refusal_budget_fallback_notice`, added to `content/ui/en/extension.json` and
  `content/ui/zh-Hans/extension.json` beside `turn_unfinished_notice`), delivered with one host-initiated
  `table.narrate` call (the same host-owned-operation shape `settleStandingDefense` already uses). Success
  updates the table's turn/state/`closedThisRun` so the stranding path below never runs; failure is
  swallowed and the ordinary undelivered/notice path is unchanged -- the fallback's own fallback.
- Confirmed (root-caused before implementing, not guessed): `ctx.abort()` at this cut sets the run's
  abort signal; the vendored run driver's `operate` loop (`vendor/pi/packages/agent/src/run-driver.ts`)
  only observes it on a *later* proposal in the batch (or the next), which is why the reproducing test
  needed extra calls past the abort threshold to actually trigger `aborted_during_operate` -- verified
  empirically (11 calls did not trigger it; 16 did, 8 genuine + 6 blocked + 2 to observe the signal).

**Tests** (`tests/extension/refusal-budget-fallback.test.mjs`, mutation-verified by copy-revert):
- A 16-call `resolve` barrage (varied wording so the identical-resend guard, §67, never intercepts before
  the refusal budget does) trips the class/turn budgets (§34.12) then the runaway abort
  (`lane: "runaway", after: "refusal_budget", aborted: true`); the one `reason: "refusal_budget"` drop
  lands; the fallback narrate succeeds (`ok: true, reason: "refusal_budget_fallback"`); exactly one
  `table.narrate` reaches the kernel and no `table.release {release: "stranded"}` call, or stranded
  telemetry, is ever sent. Mutation: `if (false && table.refusalBudgetCut && ...)` -- caught (no fallback
  row, `narrateCalls` empty).
- A run whose floor steer already delivered a held draft through the *legacy* engine's own pre-existing
  recovery before this section's check runs is not double-delivered (`closedThisRun` already true,
  `deliverRefusalBudgetFallback` never called a second time; verified directly with a debug probe, not
  just inferred). **Honesty note:** this second test runs on the legacy engine, where the gap this ticket
  closes does not exist (legacy's own `message_end`/`agent_end` recovery already reaches a held draft
  before `agent_settled` runs); it therefore cannot exercise this section's own "prefer the Keeper's
  draft over the notice" branch, only that this section composes safely alongside legacy's existing
  behaviour. I could not construct a suite-level (non-live) reproduction of the hybrid-only
  `aborted_during_operate` path this ticket is actually about — the gate #10 t4 replay below is the real
  test of that.

**Suites, on leehow-pc** (same run as SL-62's, one combined session; base `07b306a22`, worker commit
`843fd798`): `test:ext` 3148/3148, `loop` 196/196, `py` 1728 passed/2 skipped -- see SL-62's Comments for
the verbatim lines (both tickets landed in one commit and one suite pass).

**Replay finding (gate #10 t4, recorded Keeper, live Jev; same two runs as SL-62's).** Neither run reached
the `aborted_during_operate` shape this ticket fixes: the fresh policy (live Jev compile/route/turn-close)
ended the run after 5 model steps on the recorded `look npc 档案处的办事员` refusal (SL-62's own evidence)
followed by a spent steer, `status: "undelivered", reason:
"turn_close_steer_spent:no_delivered_evidence"` -- a different, pre-existing undelivered path this ticket
does not touch, not the refusal-budget runaway abort. `refusalBudgetCut` was never set in this run (no
`lane: "runaway"` telemetry, confirmed by grepping the trace), so this section's fallback was not
exercised, and I cannot report from this replay whether it would have delivered instead of stranding for
gate #10 t4 specifically. **Left undone:** the live end-to-end confirmation this ticket's scope 3 asks
for. The suite-level test above proves the mechanism fires and delivers correctly when the runaway abort
does happen (constructed directly, not from this fixture); what remains unverified against the recorded
evidence is that the *same* trajectory that lived through three `resolve` refusals and a runaway abort at
the table is reachable at all through replay's fresh policy, independent of anything in this ticket.
Recommend either a fresh live table re-triggering the same shape end to end (not a replay), or accepting
the suite-level test plus the confirmed vendor-driver mechanics above as sufficient evidence and closing
this open item on review.
