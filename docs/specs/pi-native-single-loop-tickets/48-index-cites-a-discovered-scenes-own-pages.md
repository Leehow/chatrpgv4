Status: ready (filed 2026-09-24 from SL-47's replay and the 血色公路 batch-5 table; batch 6)
Stage: SL-48 (P2, index / in-play reading)
Spec: docs/kernel-rpc.md §14.16 (index passages), §22.4.7 (SL-47), §20 (index rows)

# SL-48 — The index cites a discovered scene's own pages, so the text a move lands on is the scene's

## Evidence
- SL-47 replay (ticket 47): the bar's node cites only page 17 (the town's arrival page, one mention); its own pages are 28–30, found by the detail reader but unreachable by structure because no index row names the bar.
- 血色公路 batch-5 table (ticket 29, `claude/sl29a-b5-20260924`@dd58f89c9): `esso-station` cited pages [17, 18, 19] (its own section starts on 19: right); `last-stop` cited only [17] (its section is 28–30: wrong). The move landed on one mention of the bar.

## Scope
1. Contract (§14.16/§20 addendum): a scene discovered by a reading records the pages that reading found for it on its own index row (the reader already knows them: the pages it read for the detail); a scene's landing text is its own pages first, the arrival page only when nothing else is cited.
2. Kernel/reader: when a detail read for a scene completes or is refused after reading, the scene's index row gains the pages the reader visited for that scene (structural: the reader's page set, no text judgement). The index's per-scene citation is used by SL-47's landing (`kernel-ts/apply/index.ts` refusal's `pages`).
3. Tests, mutation-killable: a scene whose detail read visited pages 28–30 cites them after the read; a later move into it lands on those pages' text; a scene never read keeps the arrival page.

## Comments
