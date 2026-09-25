Status: ready-for-human (filed 2026-09-24 from SL-47's replay and the 血色公路 batch-5 table; batch 6)
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

### 2026-09-24 — SL-48 worker (branch `claude/sl48-20260924`, base `0af64595a`)

**Commits.** `277a91e3a` contract (§22.4.8, §20 addendum 4); `e54b7c35b` implementation and tests; `c580fd535` a test fix
(the refused-before-reading case writes the service's empty observations, which is what made S8 killable) and the replay
tool; this entry in the last commit.

**Changes (contract §22.4.8).**
1. When a `detail` reading of a text focus finishes -- `completed`, or `failed` once its read phase wrote
   `observations.json` for the bound source -- the kernel writes the focus's own §22.1 index row `{name, pages, topics: [],
   entities: [<node_id>], references: [], state: "indexed", scene, job_id}` into `module.json` `reading.scene_index` (the
   index file is the index job's evidence and is not rewritten). Later readings add pages.
2. **Its pages: the pages the reading's own draft cites for the scene node** (the drafted node whose identity meets the
   focus), kept where the reader viewed them; the viewed pages only when the draft has no such node. *Deviation from the
   ticket's "the reader's page set":* the bar's read viewed 25-30, and 25-27 are three other storefronts; its draft cited
   28-29. Structure only (a citation, no text read); the row is navigation, not a reviewed fact.
3. `ModuleStore.sections` answers the index file's rows and then these, so the reader packet's `index`, a consultation's
   `index` and the material gate see them; `indexRows` (the file alone) is what an index publication extends.
4. `Reading.sceneIndexPages`: a scene with own rows lands on their pages (book order, at most 3) and nothing else; only a
   scene without one keeps SL-47's rule (the node's refs, then meeting rows).

**Tests, each killed by a mutation** (same runner and record as SL-49's). `tests/extension/scene-own-pages.test.mjs`: on
the emitted kernel over a six-page text PDF -- never read, the Bar lands on page 1; a refused reading (viewed 4-6, draft
citing 5, 6 and an unviewed 2) writes `[[4, 5]]` and a later campaign's move names and lands on [5, 6]; a draft without the
scene's node falls back to the viewed pages; a reading that viewed nothing writes nothing (the Attic keeps page 1); a
completed reading writes the published draft's citation; the next reader's packet index carries the rows.

| mutation | killed |
| --- | --- |
| S1 a refused reading writes no row | yes |
| S2 a completed reading writes no row | yes |
| S3 unviewed cited pages count | yes |
| S4 the whole page set instead of the citation | yes |
| S5 the landing ignores the scene's own rows | yes |
| S6 the arrival page still leads | yes |
| S7 the index omits the scene rows | yes |
| S8 a read phase that viewed nothing still writes a row | yes (after the test fix above; survived the first run) |

Not covered by a test: `finishIndex` extending `indexRows` rather than `sections` -- an index reading cannot be requested
again once complete (`module.read.request {purpose: "index", retry: true}` answers `ready`), so no fixture reaches it; the
change only prevents copying the scene rows into a new index file.

**Suites (leehow-pc, `c580fd535`).** ext: `ℹ tests 3064`, `ℹ pass 3064`, `ℹ fail 0` (wall 165 s); loop: `# tests 175`,
`# pass 175`, `# fail 0`; py: `1725 passed, 2 skipped in 316.80s (0:05:16)`.

**Replay** (with SL-49's, `sl49-bar-replay.mjs` over a copy of the b5 fork, the recorded reviews): both rounds refused (see
SL-49), the bar's row became `{scene: "scene-last-stop", pages: [[27, 28]]}` (pages 28-29), t17's recorded move was refused
`material_pending` naming `[28, 29]` (the live table: `[17]`) and landed on them, and the note carried `scene_text` page 28
(4,589 bytes; page 29 dropped whole by the 8 KiB ceiling). *Timing caveat:* in the live table `read-6` failed at 00:21:17,
after t17 (closed 00:19:24), so t17 itself would still have landed on page 17; the row serves every later move into the
bar (and every later reader's index). The party already standing in the bar on its arrival text gets nothing from the row
-- a possible follow-up: carry the scene's own pages when its record lands `unavailable` (not in this ticket's scope).
