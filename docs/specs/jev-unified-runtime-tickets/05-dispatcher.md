Status: accepted
Execution: complete for the canonical dispatcher foundation; production TaskRuntime callers remain T06
Parent design: #101
Stage: S1/S2 seam
Model: gpt-6-astra
Helper: gpt-5.6-sol for guard-parity tests only

# Extract CanonicalOperationDispatcher

Complete the guarded operation seam used by ordinary Pi tool calls and later Jev-selected proposals. T02 may already have extracted a bounded read-only subset; this ticket proves parity and extends the seam to the full accepted operation surface without duplicating guards.

## Depends on

- T02 passed.
- T04 accepted.

## Scope

- Extract complete preflight/call-state guards, admission, preparation, material readiness, kernel invocation, idempotency, post-bookkeeping, trace, and delivery termination from the current registration path.
- Keep classified reads read-only and parallel only over a fixed snapshot.
- Serialize mutations under current campaign/kernel ordering; make an apply batch atomic.
- Reject child scope escalation and map incomplete decisions to their owning domain policy.

## Actual owned paths

- `extensions/kernel/index.ts`
- `extensions/kernel/canonical-operation-dispatcher.ts`
- `tests/extension/canonical-operation-dispatcher.test.mjs`
- `kernel-ts/handlers.ts`
- `kernel-ts/write/index.ts`
- `tests/kernel/test_jev_call_status.py`

T11/T12 may later edit only their predeclared resolve/apply registration blocks after T05 closes.

**Subassignment boundary:** Sol may own dispatcher parity tests only. Astra owns the dispatcher and registration extraction.

## Acceptance

- Parity tests cover all seven registered verbs and tool-call guards.
- Direct and proposal paths produce the same ordered guard trace and real result.
- Answer-only reads cannot mutate; mutation replay is idempotent; narrate/ask termination prevents another Keeper call.
- There is no independently evolving second guard implementation.

## Retirement and rollback

Keep existing registration as a thin caller until parity passes. Feature routing can return to incumbent calls without deleting traces, receipts, or settled effects.

## Completion evidence

- Sol dispatcher parity/recovery suite passes 11/11, including real TypeScript-kernel exactly-once apply reconciliation.
- Terra's current TypeScript RPC `table.call_status` suite passes 4/4 and independent re-review is GO.
- The lead ran the combined focused set: 35/35, including deadlines, closed-turn behavior, and commit outage; the prior normal-turn/split-delivery set remains 39/39.
- Final runtime build, kernel typecheck, and focused strict TypeScript checks passed.
- Acceptance is dispatcher-foundation only. There is no production TaskRuntime caller until T06, and no live hybrid mutation, source, memory, consumer-migration, or product-rollout claim.
