Status: planned
Execution: inactive until every selected family gate passes
Parent design: #101
Stage: S7
Models: gpt-5.6-terra for evidence; gpt-6-astra for final go/no-go and core follow-up

# Run migration, restart, performance, and real-table product acceptance

Exercise the whole shipped seam and make a per-domain release decision. Terra owns test orchestration and evidence only; Astra owns the final decision and any separate core/kernel repair ticket.

## Depends on

- T02–T14 for every family selected for rollout.
- #99 compatibility evidence.
- #92–#98 evidence only for claims that rely on KIC.

## Scope

- Verify backward/forward readers before writers, attempt-pinned domain rollout, disabled/unconfigured incumbent, restart/lost reply, source-vs-compiled alignment, source outage, incomplete DecisionBatch, secrets/worldline, Git-delivery failure after settled effect, queue/drain, and rollback readability.
- Measure whole task/root turn: Keeper calls avoided, provider/LLM/fallback usage and cost, latency median/tails, quality, false blocks, missed needed material, false merges, cold/warm behavior.
- Run genuine play through `tests/play/driver.py` in RPC mode with the real host launcher, configured Grok Keeper, and main session as the only player, one natural line at a time.

## Proposed exclusive write set

- `tests/jev/product-acceptance/`
- `.tmp/team-lead/jev-ticket-plan/s7-evidence/`

No production file is writable in this ticket.

## Acceptance

- Complete traces and receipts survive restart and replay.
- Source/reference, memory, resolve/apply, promise join, decision boundary, and delivery reach their real consumers.
- Zero additional critical agency, disclosure, duplicate-commit, or duplicate-effect errors.
- At least one measured foreground slice improves without semantic regression; cache hits and component microtimings do not count.
- Synthetic fixtures supplement but never replace the true-table evidence.

## Retirement and rollback

Astra may retire an old mandatory path only for a domain whose evidence passes. Rollback disables routing at a new task boundary and retains accepted graph material, refs, memory, evidence, receipts, effects, and Git history. Missing real-table/product evidence means not accepted.

## Operational boundary

No fake Keeper, scripted player, push, package, app restart, worktree cleanup, history rewrite, or production Python. Ticket publication remains a lead-owned repository-tracker action.
