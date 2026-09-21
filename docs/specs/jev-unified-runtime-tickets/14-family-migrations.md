Status: needs-triage
Execution: inactive; select one consumer family per assignment
Parent design: #101
Stage: S6
Model: gpt-5.6-sol; gpt-5.6-luna only for later mechanical sub-slices

# Migrate bounded drafting, audit, and presentation families

Migrate one closed consumer family at a time from model-copy work to host extraction and typed checks. Keep genuinely novel prose, voice, translation, and complex repair with their existing LLM owners.

## Depends on

- T03, T05, T06, and T07 accepted.
- T08/T09/T10/T11/T12 only when selected family consumes that evidence or execution result.
- #99 owner alignment before public hybrid rollout.
- #92–#98 remain references for any KIC-dependent context claim.

## First triage decision

Choose exactly one family from audit, correction, post-delivery verification, NPC journal, document/map/UI presentation, or setup. Close its inventory and write set before activation. Do not authorize the entire inventory as one worker scope.

## Proposed initial write set

- `extensions/mods/index.ts`
- `extensions/kernel/verifier.ts`
- `tests/extension/jev-presentation-family.test.mjs`

Any additional production path requires re-triage and exclusive ownership. Luna may edit only an Astra/Sol-approved closed mapping whose work is mechanical.

## Acceptance per family

- Producer → reader → actor trace reaches a real consumer.
- Exact adverse excerpts and unchanged source text are host-extracted; cross-field review dependencies remain in cache binding.
- No private disclosure, extra post-close action, or hard-blocking advisory verifier.
- Whole foreground slice reports calls, tokens, cost, latency, false blocking, missed material, and quality.
- Every model-copy request has an explicit disposition; an old mandatory call retires only after its family passes.

## Retirement and rollback

Rollback is per family and attempt, preserves accepted refs/evidence/history, and returns novel work to the incumbent Keeper/reviewer. No new progress judge. Missing #99 alignment blocks public rollout. KIC presence or cache hits are not a latency win.
