Status: ready-for-human (filed 2026-09-25 from the 血色公路 batch-8 table; batch 9; implemented 2026-09-25 on `claude/sl58-20260925`)
Stage: SL-60 (P3, telemetry; follows SL-54)
Spec: docs/kernel-rpc.md §22.4.6.1 (SL-54)

# SL-60 — A displaced read that resumes writes its `resumed` row

## Evidence (ticket 29 batch-8 entry)
- SL-54's displacement and resume worked at the state level on the b8 table (the job went back to queued and later completed), but no `resumed {from_generation, generation, reread}` telemetry row was written; the triage had to infer it from the queue file.

## Scope
1. The host writes the `resumed` row on every claim that resumes a displaced job (the kernel already returns the marker); one test on the reading service asserting the row.

## Comments

### 2026-09-25 — SL-58/59/60 worker (branch `claude/sl58-20260925`, base `e919a4024`)

**Commits.** `20da4c3d9` contract (an addendum to §22.4.6.1, beside the SL-58/59 sections in the same
docs commit); `3e42889c6` implementation and test; this entry.

**What was already there, and what was missing.** The kernel already binds a resuming claim to the
current generation and returns `job.resumed {from_generation, generation, reread}` (SL-54, landed).
`extensions/module/reading-service.ts`'s pump already folded that marker into its per-claim
`{event: "concurrency", ...}` row (also SL-54) -- confirmed by `tests/extension/displaced-read-resumes.test.mjs`'s
existing assertion that a `concurrency` row for the resumed job carries `resumed`. The gap ticket 29
batch-8 found was not that the marker is missing; it is that a triage grepping telemetry for
`event: "resumed"` finds nothing, because it only ever rode as a field inside a row named for something
else -- the same gap `event: "requeued"` (SL-55, addendum to this same section) had already closed on the
finish side.

**The fix.** The host's claim loop (`ReadingService`'s `pump`, right where the `concurrency` row is
written) now also writes `{lane: "reading", event: "resumed", module_id, campaign, job_id, purpose,
focus, from_generation, generation, reread}` via `this.note(...)` (unwrapped, like `requeued`, not the
job's own heartbeat) whenever `job.resumed` is present. Additive: the `concurrency` row keeps its
`resumed` field unchanged.

**Test, mutation-killed.** Extended the existing SL-54 test in
`tests/extension/displaced-read-resumes.test.mjs` (a real displacement: `read-8` displaces `read-7`,
another focus publishes while it is parked, the other readers finish and it resumes and lands) with an
assertion that a dedicated `event: "resumed"` row exists for the resumed job, carrying the same
`{from_generation, generation, reread}` the job itself records, plus its `purpose` and `focus`.
Copy-revert (commenting out the new `this.note(...)` call), runtime rebuilt, confirmed the assertion
fails without the fix and passes with it restored.

**Suites** (leehow-pc, `e919a4024`): ext `ℹ tests 3138`, `ℹ pass 3138`, `ℹ fail 0` (wall 166 s); loop
`# tests 196`, `# pass 196`, `# fail 0` (wall 43 s); py `1728 passed, 2 skipped` (wall 179 s). No replay:
this ticket's scope is a telemetry row, not a wall-time or behavior change, and asks for one reading-
service test only.
