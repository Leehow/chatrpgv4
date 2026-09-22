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

## Audit family: continuity review timing (2026-09-22, kernel contract §130)

Measured on the 2026-09-22 GUI table (`game-21ac44b7-5f91-41a5-8ea7-9faf5b801a29`): the continuity review was the largest fixed foreground wait between the Keeper's finished text and the player reading it (review rows 14.3 s, 20.1 s, 15.3 s on turns 0-2, all `pass`). This slice changes **when** the audit family's incumbent reviewer runs, not what it reads or who owns novel repair:

- Default `PI_COC_CONTINUITY_GATE=post`: `narrate`/`ask` keep only the deterministic evidence pin (`mods.job`) and the kernel commit on the critical path. The reviewer child, `mods.accept {after_delivery: true}` and every subreview run after `turn-closed`; the verdict is projected by the kernel onto the delivered record (`table.warn`, `lane: "continuity-review"`) and carried by the next capsule with a forward-looking `fix`. No re-draft, no reopened turn. `pre` keeps the §36.14/§91 gate unchanged.
- It fits this ticket's audit acceptance: the host sends no model-copied finding text — the kernel reads the accepted report from the job and anchors only a claim that is a substring of the rendered delivery; the reviewer's draft-rewrite `fix` is not forwarded. It is advisory, so it adds no hard block.
- Not claimed: the whole-foreground-slice calls/tokens/cost/quality report, false-blocking and missed-material measurement, and the live gate. The latency effect is structural (the review is removed from the wait) and must be measured on a genuine table (live Keeper, one real player line at a time) before this family is marked accepted. Whether a post-delivery warning changes the Keeper's next turn is measured by reading those turns, as §12.5 does for the verifier.

