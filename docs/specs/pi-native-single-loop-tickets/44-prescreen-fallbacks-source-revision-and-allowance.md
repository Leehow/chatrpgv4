Status: ready-for-human (filed 2026-09-24 from long gate #4; batch 5; implemented 2026-09-24)
Stage: SL-44 (P2, prescreen)
Spec: docs/kernel-rpc.md §124.11 (binding drift), §135.6, SL-22 (own budget)

# SL-44 — The prescreen neither falls back on a source-revision bump nor runs on a 138 ms allowance

## Evidence (long gate #4, `longgate4-evidence.txt` section E)
- t14: `status: fallback`, `fallback: binding_changed`, `key: source_revision`, after 7 Jev calls and 1.9 s: a memoised answer landing (SL-36) bumped the source revision while the prescreen ran; the compile then fell through and the turn cost 98 s.
- t19: `status: fallback`, `allowance_ms: 138`, aborted "due to timeout" after 41 ms: the prescreen was given 138 ms although SL-22 gives it its own budget.

## Scope
1. Contract: §124.11 amendment: the reading store's revision is not a binding key for the prescreen (what it binds to is the scene/npc state it packed; an answer landing is carried on the note, §135.31.2); SL-22 restated: the allowance is the prescreen's own, never derived from the turn's remainder.
2. `extensions/table/prescreen.ts`: drop `source_revision` from the drift keys; find where the 138 ms came from and make the allowance the named default.
3. Tests, mutation-killable: a source-revision bump mid-prescreen keeps `prepared`; the allowance on a late-turn read equals the default.

## Comments

### 2026-09-24 — implemented on `claude/sl43-20260924` (from the integration branch at `c31f483dd`)

**Commits.** `d937803d7` (contract §124.11.1 and §135.6.1, `extensions/table/prescreen.ts`, `runtime/jev/hybrid-engine.ts`,
tests); `bf83e822c` (the source-request test the retired key covered; a load-robust deadline check). SL-43's `95559a8c5` is the
commit before them on the same branch.

**Where the source_revision fallback came from.** The kernel's `source_revision` digests the module's `meta` whole
(`sourceRevision`, `kernel-ts/read/context.ts`), and the reader's bookkeeping (`meta.reading`: jobs, accepted answers) is in
`meta`. Probed on the emitted kernel: writing `meta.reading.answers` moves `source_revision` and leaves `task_source_revision`.
§124.11 had it among the run keys, so t14's landing voided the whole prepared result.

**What changed (§124.11.1).** `source_revision` is no longer a prescreen binding key: out of `RUN_BINDING_KEYS` (so out of the
page keys), not sent with the final check (`withoutUnbound`; the owner compares only the keys a request binds), not compared at
the catalog's opening check or the locate's index check. The index cache stays keyed by it (reuse, not binding). A packet that
carries the reading store's own answers keeps their checkpoint (`checkPrescreenSourceCheckpoint`, the answers' revision): an
answer that lands after they were read still voids them (`source_stale`).

**Where the 138 ms came from.** `run.allowanceDeadline` in the hybrid engine: one deadline per run, set at the run's start
(`Date.now() + readJevPreselectAllowanceMs`), and every read's prescreen got `deadlineAt: run.allowanceDeadline` -- SL-22's
"what is left of the allowance". At t19 the read after the Keeper's move began 11 781 ms into the run (7.2 s of it the Keeper's
step), so its prescreen was given the remainder: `allowance_ms: 138`, aborted after 41 ms. Now (§135.6.1) every read that runs a
prescreen gets `run.prescreenAllowanceMs` (= `readJevPreselectAllowanceMs`, default `PRESELECT_ALLOWANCE_DEFAULT_MS`, 12 000 ms)
from its own start, and `allowance_ms` reports it. The provider budget (24 actions) stays per input; `allowance_spent` now means
it is spent.

**Tests.** `prescreen-binding-drift.test.mjs` (real kernel, the Haunting): a source answer landing before the finish decision
moves `source_revision` (asserted, with `task_source_revision` unchanged) and the prescreen still prepares with its graph
material; landing before a later catalog page, the page is taken; landing between the run's binding and the first catalog page,
the catalog and the index are taken. `single-loop-prescreen-budget.test.mjs`: the gate #7 test now asserts the read after the
move runs its prescreen with `allowance_ms` 3000 and every batch deadline inside its own read; a new test: the late read's
allowance equals the configured one (first prescreen spending all 2 s of it) and, unconfigured, `PRESELECT_ALLOWANCE_DEFAULT_MS`.
`prescreen-source-request.test.mjs`: its case "a public source-owner answer change during selection prevents the stale packet"
asserted the voiding by `source_revision` that §124.11.1 retires (the answer landed during the locate, before the source
materials were read, so the published packet actually contains it); replaced by two cases: landing before the source read, the
landed answer is among the materials and the packet reaches the provider; landing after it (at the loop's first request), the
source checkpoint voids it (`source_stale`) and no packet reaches provider conversion.

**Mutations** (copy-revert; every one killed):

| mutation | killed by |
| --- | --- |
| S1 `source_revision` a run key again | the two landing-mid-run drift tests |
| S2 the final check sends `source_revision` | the two landing-mid-run drift tests |
| S3 the pages bind `source_revision` | the later-catalog-page drift test |
| S4 the catalog opening check compares it | the landing-before-read drift test, the source-request "before" case |
| S5 the index check compares it | the landing-before-read drift test (locate `index_unavailable`) |
| S6 the engine at `c31f483dd` (run-wide deadline) | gate #7 test and both late-read subtests |
| S7 deadline from the run's start, `allowance_ms` reported whole | gate #7 test (the late read runs no prescreen) |

**Not done.** No live replay of t14 or t19 (the brief asked for t2's); the drift and allowance paths are covered at the seams
above. `reusePrescreen` (a packet reused across requests by the context hook) still compares `source_revision`: it is not the
drift check and was left as it was.

**Suites** (leehow-pc, at `bf83e822c`): `ext` — "ℹ tests 3044 / ℹ pass 3044 / ℹ fail 0" (`== ext on leehow-pc @ bf83e822c...: exit=0 wall=145s`; the first run at `d937803d7` had 2 failures, the source-request case and a load-sensitive deadline check, both fixed in `bf83e822c`); `loop` — "# tests 175 / # pass 175 / # fail 0" (exit=0 wall=41s); `py` — "1725 passed, 2 skipped in 181.74s" (exit=0 wall=183s).
