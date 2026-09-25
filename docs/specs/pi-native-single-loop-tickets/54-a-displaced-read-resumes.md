Status: ready (filed 2026-09-25 from the 血色公路 batch-6 table; batch 7)
Stage: SL-54 (P2, reading priority; follows SL-45)
Spec: docs/kernel-rpc.md §22.4.6 (SL-45 displace/yield), §22.4.3 (SL-36 context generation)

# SL-54 — A displaced background read resumes, under the context at resume time, instead of failing on the old one

## Evidence (ticket 29 batch-6 entry)
- SL-45's displacement fired live for the first time: a blocking detail read displaced a background `answer` job (yield, back to `queued` with its attempt kept). When the answer job was retried, it failed outright on stale context (`source_context_changed` class: the module's generation had moved while it was parked) instead of resuming, so the consultation was lost.

## Scope
1. Contract: §22.4.6 addendum: a displaced job resumes under the generation current at resume time; if its focus's material changed meanwhile it re-reads from its saved attempt rather than failing; the `pending` row on the Keeper's note survives the displacement.
2. `kernel-ts/modules/reading.ts` (`module.read.yield` / the claim path): resume re-binds the job's `context_generation`; the SL-36 attach rule ("only within the current context generation") applies to new questions, not to a parked job.
3. Tests, mutation-killable: a displaced answer job whose module generation advanced resumes and completes; a displaced detail job likewise; the note's pending row persists across the displacement.

## Comments
