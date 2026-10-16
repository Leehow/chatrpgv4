Status: planned
Execution: inactive until every selected family gate passes
Parent design: #101
Stage: S7
Models: codex-relay/gpt-6-luna/high for the live Keeper, final author, and supporting lanes; current session ownership for evidence and release review

# Run migration, restart, performance, and real-table product acceptance

Exercise the whole shipped seam and make a per-domain release decision. The evidence owner handles test orchestration and evidence only; the integrator owns the final decision and any separate core/kernel repair ticket.

## Depends on

- T02–T14 for every family selected for rollout.
- #99 compatibility evidence.
- #92–#98 evidence only for claims that rely on KIC.

## Scope

- Verify backward/forward readers before writers, attempt-pinned domain rollout, disabled/unconfigured incumbent, restart/lost reply, source-vs-compiled alignment, source outage, incomplete DecisionBatch, secrets/worldline, Git-delivery failure after settled effect, queue/drain, and rollback readability.
- Measure whole task/root turn: Keeper calls avoided, provider/LLM/fallback usage and cost, latency median/tails, quality, false blocks, missed needed material, false merges, cold/warm behavior.
- Run genuine play through `node tests/play/driver.ts` in RPC mode with the real host launcher, Codex Relay `codex-relay/gpt-6-luna` with `high` reasoning for the Keeper, final author, and supporting lanes, and main session as the only player, one natural line at a time. This test profile leaves product model defaults unchanged.
- If Codex Relay reports saturated upstream concurrency, preserve the failed Luna evidence and use a new run with `--model grok-build/grok-4.5 --thinking low`, including the final author and supporting lanes. Subsequent tests default to Luna/high.

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

The integrator may retire an old mandatory path only for a domain whose evidence passes. Rollback disables routing at a new task boundary and retains accepted graph material, refs, memory, evidence, receipts, effects, and Git history. Missing real-table/product evidence means not accepted.

## Operational boundary

No fake Keeper, scripted player, push, package, app restart, worktree cleanup, history rewrite, or production Python. Ticket publication remains a lead-owned repository-tracker action.
