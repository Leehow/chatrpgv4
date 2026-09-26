Status: ready (filed 2026-09-26; batch 15; test hygiene)
Stage: SL-87 (P3, wall-clock budget tests must not time the box)

# SL-87 — Five budget tests fail only when leehow-pc is loaded: inject a clock where the budget is the subject, widen the allowance where it is not

## Evidence
2026-09-26, separate box runs at load 30–60 failed these, each passed alone at load < 12 on the same commit:
- tests/extension/single-loop-prescreen-budget.test.mjs — "gate #7's shape: a prescreen that spends the whole allowance leaves the decisions theirs -- compile and route asked, the clerk moves, no jev_budget" (subject IS the wall-clock allowance: 3000 ms allowance, a 2 s compile, asserts prescreen.ms >= 1000 and batch deadlines inside each read)
- tests/extension/keeper-support-lookup-host.test.mjs — "Keeper explicitly requests support with preload off, receives the fixed packet, then uses ordinary lookup and recall"
- tests/extension/jev-source-domain.test.mjs — "root consultation completes through a child, actual extraction, independent relevance batches, and exact excerpts" and "source-owned proof refuses an extraction version changed after semantic approval"
- tests/extension/npc-preparation-integration.test.mjs — "actual Keeper preparation overlaps NPC and material decisions and delivers both in one provider payload"
- tests/extension/workspace-lifecycle.test.mjs — "separate store instances compare revisions under one lock"

## Ruling
A test whose subject is a wall-clock budget drives a fake clock / injected now() and never sleeps for real; a test whose budget is incidental uses an allowance of >= 60 s or a step-count bound. No test may assert a real elapsed time under a few seconds. Where the engine reads Date.now()/performance.now() for the budget without an injection point, add the smallest `now` option (hybrid-engine options already carry env). Standing rule from memory: a product budget that is not the test's subject must not time the box.

## Comments

**2026-09-26, implemented (Claude Opus 5.5, worktree `chatrpgv4-wt-load-proof`, branch `claude/load-proof-budgets-20260926` off `claude/integ-single-loop-2-20260926@05e1e254c`).** Each failure was reproduced first on leehow-pc under deliberate load (the full ext suite running beside loops of the five files, plus CPU burners; load 35-110), before any change:

| Test | Failing assertion under load | Subject or incidental | Fix |
| --- | --- | --- | --- |
| prescreen-budget "gate #7's shape" | `given the allowance whole (1424,1424,…)`: the kernel reads inside the prescreen spent the 3 s real allowance, so no semantic batch was sent, only the locate's | **Subject** (the allowance vs the decision budget, and SL-44's whole allowance per read) | A manual clock. `createHybridEngine({clock})` (new, optional `TaskClock`) times the run's steps, each read's prescreen allowance and the decision leases on it; `prepareKeeperSupport({clock})` measures and enforces the allowance on it (its deadlines, `AbortSignal.timeout`s and leases); `prepareCheckPreflight({clock})` bounds its waits on it. Absent, every one of them is `Date.now()`, `AbortSignal.timeout` and `setTimeout` exactly as before. The test's port advances the clock (the compile's 2 s; a slow batch to its lease's deadline) and nothing sleeps. The clerk's operation lease stays on the real clock. |
| keeper-support-lookup-host | (a) `packet.materials.length>0`: the lookup's 12 s allowance ran out in discovery (~10 s of kernel reads at load 80); (b) `assert(support)` with no tool result at all: the opening run was still settling, the table held the player's input and replayed it after the settle, and `waitForIdle`'s short poll returned before that turn began | Incidental | The waits are on the deliveries the test reads next (`waitFor` the opening's and the support turn's `narrate` results, 120 s); `PI_COC_JEV_PRESELECT_ALLOWANCE_MS=30000`, the product's maximum (`PRESELECT_ALLOWANCE_MAX_MS`). |
| jev-source-domain (2 tests) | `Error: source task deadlocked` from the test's own 5 s guard | Incidental | The root lease is 60 s and the deadlock guard 90 s (cleared when the task returns). |
| npc-preparation-integration "overlaps" | `independent NPC and material decisions must coexist` (`false !== true`): the NPC's 1.25 s wait window ended during its own perspective read, before its first decision; the material decisions waited alone until their deadline | Incidental | Allowance `PRESELECT_ALLOWANCE_MAX_MS` (30 s); the host double re-emits the NPC bridge with `automaticWaitMs` equal to that allowance. |
| workspace-lifecycle "separate store instances…" | `Error: EAGAIN` from `flockSync`: one store's write and fsync held the lock past the other's 500 ms wait (4/40 at load ~60) | Incidental (the revision compare under the lock is the subject) | `withWorkspaceCacheLock(root, action, now = Date.now)` and `createWorkpadStore(root, {now})`; the test gives each store a clock that moves 1 ms per poll: a bound of 500 polls, not 500 ms. |

Deviation from the ruling, for the owner: "incidental allowance >= 60 s" is not reachable test-side for the prescreen allowance, because the product clamps `PI_COC_JEV_PRESELECT_ALLOWANCE_MS` to [2 s, 30 s]; the two tests use the maximum, 30 s (2.5x the default; the loaded lookup measured ~10-12 s). Raising the clamp would change product behaviour, so it was not done.

Load proof on leehow-pc, each file alone in a loop beside deliberate load: round 1 (load 36-63) 4/4 green for each of the five files; round 2 (the full ext suite + 16 burners, load 49-80) gate #7 6/6 and the other four files 6/6; round 3 (the ext suite + 8 burners, load 65-95) 4/4 for each of the five tests. The ext-suite runs used as load also passed all five tests.

Mutations (applied to the box copy only, restored by re-syncing from the worktree, sha256 checked equal after each):
- gate #7: charging the read's prescreen to the decision budget in `settleRead` -> red (`the read, and the read after the move`); the late read's deadline from the run's start instead of its own (`run.startedAt + allowance`) -> red (`the read at newspaper-morgue sent prescreen batches`); the semantic lease left on the real clock -> red (`given the allowance whole (1000)`).
- keeper-support: the lookup rewording its query -> red (`packet.request`); the packet stripped of its materials -> red (`invalid_support_parameters`).
- jev-source-domain: an excerpt missing its last byte -> red (byte-for-byte); the proof trusting the approval-time extraction instead of re-reading -> red (`'complete' !== 'partial'`); a proof step that hangs and ignores its signal -> red at 90 s (`source task deadlocked`). Dropping only the `extraction_version` comparison is not caught: the stale-ref check refuses the same change (two guards).
- npc: the NPC preparation serialized after the material prescreen -> red (`must coexist`, after ~32 s).
- workspace: the revision compare removed -> red; the flock removed -> red 3/3.

Same class, outside these five, seen failing in the loaded box runs (not changed here): prescreen-budget "a read_more on the same scene reuses…" and SL-44's "not configured: the named default" (`'fallback' !== 'prepared'`, the real 12 s allowance, at load 75-95); `keeper-call-cap.test.mjs` "a stall before the first byte is cut at the cap…"; `turn.test.mjs` "a settled thinking-only run returns a service notice…"; `continuity-audit.test.mjs` "a stalled preparation is not charged to the reviewer…"; `jev-s0-rpc-lifecycle.test.mjs` (5 s RPC reply wait) "source-only startS0Rpc…" and "source-only exact session id reopens…".
