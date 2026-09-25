Status: ready (filed 2026-09-25 from SL-54's replay; next batch)
Stage: SL-55 (P2, in-play reading; follows SL-36/SL-54)
Spec: docs/kernel-rpc.md §22.4.3 (SL-36 context generation), §22.4.6.1 (SL-54 resume)

# SL-55 — An answer still running when the module's generation moves finishes under the new generation instead of being lost

## Evidence (ticket 54's Comments; 血色公路 batch-6 table, `read-8`)
- SL-54 made a parked job resume under the generation current at its claim. A job that is running when a publication moves the generation still fails at finish (`source_context_changed` class): on the batch-6 table t17's own question (`read-8`) went `unavailable` after 15.5 s for that reason, while in the SL-54 replay (no publication mid-flight) it landed 108 s later. On a live table most background answers run across a publication.

## Ruling (owner, 2026-09-25)
A running answer is checked against the generation current at its finish: if no reading published since its start touched its focus, it lands as is (stored under the new generation); if one did, it re-reads from its draft once, like a resumed job (SL-54's `reread`). The pending row survives either way.

## Scope
1. Contract: §22.4.6.1 addendum for the running case.
2. `kernel-ts/modules/reading.ts` finish path: the generation check becomes the touched-focus check; the re-read reuses SL-54's path.
3. Tests, mutation-killable: an answer running across an unrelated publication lands; across a publication touching its focus it re-reads once and lands; the pending row persists. Also: re-asking a question while its job is parked attaches instead of queueing a second reading (SL-54's noted gap).

## Comments
