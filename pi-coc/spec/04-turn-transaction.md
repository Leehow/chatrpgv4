# 04 — Turn transaction

**TRN-001 — Ordered phases.** Receive/deduplicate input; load head/state; compile context; obtain plan; validate; resolve rules; advance time/materialize due events; project event batch; atomically commit; build public frame; render; verify; publish.

**TRN-002 — Atomic world commit.** Commit, event rows, branch-head movement, idempotency record, RNG receipts, and outbox are one database transaction.

**TRN-003 — Post-commit rendering.** Narration happens after world commit. Narrator failure yields `COMMITTED_UNPUBLISHED`; retrying prose never reruns rules or time.

**TRN-004 — Pending choice.** Luck spending, pushed rolls, fight back/dodge, and player-owned choices suspend before the affected event batch commits.

**TRN-005 — Plan validation.** Plans reference current entities/rules, respect permissions, establish failure consequences where required, and cannot smuggle Keeper claims into public fields.
