Status: ready (filed 2026-09-25 from the 血色公路 batch-6/7 tables; batch 8)
Stage: SL-57 (P2, in-play reading publication; follows SL-49)
Spec: docs/kernel-rpc.md §22.3.2 (SL-49 per-field verdicts), §22 (review rounds), §107.1 (unusable settlement)

# SL-57 — A detail read refused at review is retried once on a later turn with the reviewer's reasons; a second refusal settles it as unusable

## Evidence (ticket 29 batch-6 and batch-7 entries)
- Batch 6: the church-steeple detail read was refused at review and never retried; batch 7: the same shape on another node (`read-5`, the NPC, and the scene it belongs to), and the module fork never advanced past generation 2 for the whole table. The scene or person then plays on the index text alone (SL-47/56), which is the right floor but not the ceiling: the reviewer's reasons are on disk and nobody re-reads with them.

## Scope
1. Contract: §22 addendum: a detail read whose publication is refused for an `unsupported` fact is re-queued once as background (not blocking), with the refused fields and reasons as the reader's context; a second refusal settles the focus `unusable` (SL-34's settlement shape) and is not raised again; `retry: true` from the Keeper may replace it.
2. `kernel-ts/modules/reading.ts` finish/refusal path and the queue; the Keeper's note shows the settlement once.
3. Tests, mutation-killable: a refused read is re-queued once with the reasons; a second refusal settles; the settlement is shown once.

## Comments
