Status: accepted
Execution: complete for shared foundations only; consumer/runtime integration remains T06
Parent design: #101
Stage: S1
Model: gpt-6-astra
Helper: gpt-5.6-terra for deterministic lifecycle tests only

# Add version, read-set, budget, checkpoint, and outcome foundations

Implement the shared lifecycle primitives needed by the guarded runtime. These are hybrid foundations and therefore wait for the S0 gate.

## Depends on

- T01 accepted.
- T02 passed.

## Scope

- Absolute deadlines; inherited foreground scope, priority, and cancellation; separate post-commit memory root-job budgets.
- Action/token/cost ceilings and real root/child replay sequence.
- Read-set matrix for source, graph/adaptation, world, memory/index, draft, and model/question-family versions.
- Own-operation advancement, relevant foreign invalidation, checkpoints, stale/late-result handling, and owner-specific outcome mapping.
- Distinguish awaiter YIELD from owner CANCEL and never let retry renew a parent deadline.

## Proposed exclusive write set

- `runtime/jev/task-context.ts`
- `runtime/jev/read-set.ts`
- `runtime/jev/task-outcome.ts`
- `tests/extension/jev-task-foundations.test.mjs`

**Subassignment boundary:** Terra may own the deterministic test file and clock fixtures only. Astra owns all shared runtime foundations.

## Acceptance

- Deterministic-clock tests prove deadline inheritance and no retry renewal.
- Own receipts advance captured state without self-staling; relevant foreign revisions invalidate only affected proposals.
- Late/cancelled outputs cannot publish; background memory budget is not borrowed from a closed foreground task.
- Owner interfaces retain their existing unavailable/incomplete/refusal distinctions.

## Retirement and rollback

No owner-specific timeout or failure path retires yet. Foundations remain bypassable while runtime routing is disabled. Checkpoints never authorize a replayed mutation by themselves.

## Completion evidence

- Terra's deterministic task-foundation suite passes 10/10 on the final interface.
- The lead reviewed the complete tests and ran the combined contract, SourceRef, and foundation set: 29/29 passed.
- Strict TypeScript checking passed.
- Independent core review in `.tmp/team-lead/jev-t04-review.md` is GO with both earlier findings resolved.
- Acceptance is foundation-only. These APIs are not connected to product callers until T06, and `authorizeResume` durable revocation/current-intent policy remains the owning runtime's responsibility.
