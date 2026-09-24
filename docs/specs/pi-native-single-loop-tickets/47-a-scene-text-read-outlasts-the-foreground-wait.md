Status: ready-for-human (filed 2026-09-24 from SL-45's replay; implemented 2026-09-24 on `claude/sl45-20260924`)
Stage: SL-47 (P1, in-play reading on PDF modules)
Spec: docs/kernel-rpc.md §22.4 (the foreground wait), §22.4.3/§22.4.5/§22.4.6 (reading never holds a turn), §14.16 (index passages); docs/specs/pi-native-single-loop.md ruling "Reading never holds a turn"

# SL-47 — A scene's text read outlasts the foreground wait: the move lands on the index's text, the detail lands when read

## Evidence (SL-45 replay of the batch-4 血色公路 table's t18, `claude/sl45-20260924`@5c5c2a13a, ticket 45's Comments)
- With the lease fixed (SL-41) and the slot given at once (SL-45), t18 still walled 141.7 s in every arm: one `detail` read of the bar scene plus its review takes 98–118 s with the reader's thinking off and longer with it on, against the 120 s foreground wait; the move was then refused `reading_timeout` and re-sent. On the live table t17/t18/t20 were 147/240/149 s. No sub-location discovered in play was entered in 20 turns.
- The book's per-page text is already extracted at import (the index; §14.16 passages ride in the carried view). The detail read adds the reviewed scene record (exits, people, things, clues).

## Ruling (owner, 2026-09-24)
The umbrella rule applies to text too: a move into a scene whose detail is not yet read lands on the index's passages for that scene (the Keeper narrates from the book's own text, carried once), the detail read continues in the background with a blocking slot, and the reviewed scene record lands on the next turn's note; the Keeper is told what is not yet known (exits, people) and does not invent it. The foreground wait remains only for a scene with no index text at all.

## Scope
1. Contract: §22.4 amendment (new subsection): the text gate is index-level; the detail is delivered late like a map (§107.1) and an answer (§22.4.3); the note's `pending` row names the scene.
2. `kernel-ts/apply/index.ts` (`requireMaterial` for the move's destination) and the host's reading wait: land with passages, queue the detail as blocking, fold the record on the next turn.
3. Tests, mutation-killable: a move into an unread scene with index text lands and carries the passages; the detail lands on the next turn once; a scene with no index text still waits; then the replay of t18 reporting the wall.

## Comments

### 2026-09-24 — SL-47 worker (branch `claude/sl45-20260924`, merged forward to `90a15cbe0`)

**Commits.** `b9816579b` contract (§22.4.7); `6ceab4287` implementation and tests; the replay tooling fix and this entry in
the last commit of the branch (see the report).

**Changes (contract §22.4.7).**
1. Kernel. `Reading.sceneIndexPages`: the scene node's own `source_refs` pages, then the pages of index rows whose name or
   entities meet the scene's focus identity, at most `SCENE_INDEX_PAGES` (3). `requireMaterial(graph, names, gate)`: a move
   destination not ready refuses `material_pending` with `details.index {pages}` and `details.effect`; a move flagged
   `_land_on_index` by the host lands when the scene has pages (returned to `apply`); a scene in `world.index_scenes` passes
   the gate as the party's place (`apply` and `resolve`). `apply` stamps the receipt `material: "index"`, writes
   `index_scenes` and returns `scene_text: [{scene, pages}]`.
2. Host. `landOnIndex` (kernel extension): on that refusal it reads the pages' native text through the new
   `ReadingBridge.sourcePages` (`ReadingService.sourcePages`: `module.source.snapshot` + `sourceText`), re-sends the same call
   with the flag, queues the scene's `detail` read with `ensure(..., {allowanceMs: 0, blocking: true})` (new option: never
   demoted by §61, so it keeps the blocking class of §22.4.6), and keeps the pages in `SceneReadings`
   (`extensions/kernel/scene-readings.ts`) behind the `coc:source-answers` port. Empty text, a failed extraction or an owned
   preparation keep §22.4's wait. On the legacy engine the pages ride the apply result.
3. Engine. The port's `texts` become a `scene_text` view once (ceiling `SCENE_TEXT_VIEW_BYTES` 8 KiB, whole pages in order,
   a page that does not fit dropped and named), `pending` rows name the scene (`scene`), and a settled record is carried
   once: the `scene` view when the party is there, else `scene_record {status}`. Heads say what is not yet known (exits,
   people, things, clues) and not to invent it.

**Tests, each killed by a mutation** (copy-revert runner and record in the scratchpad: `sl45/mutate47.py`,
`sl45/mutations47.json`; the restored tree passes). New `tests/extension/scene-text-landing.test.mjs` (5): the emitted
kernel (refusal names pages [2, 1, 3] and the effect; the flagged move lands, `index_scenes`, the receipt; a check there
passes the gate; a place with no pages still refuses when flagged); the seam (hybrid-v1, faux Keeper, the emitted kernel, a
stub bridge): one apply lands, the pages carried once on the next step, the pending row names the scene, the read queued
blocking with no waiter, the record carried once on the next turn's first step and never again; empty page text keeps the
wait; the reading service extracts a real PDF's pages and a blocking ensure is never demoted; the ceiling keeps a whole
first page.

| mutation | killed by |
| --- | --- |
| P1 the kernel never lands a flagged move | kernel, seam |
| P2 the refusal names no index pages | kernel, seam, no-text seam |
| P3 the party's place entered on its text is held again | kernel |
| P4 a flagged move lands with no pages | kernel |
| P5 index rows do not count as a scene's pages | kernel, seam, no-text seam |
| P6 the world never records the scene | kernel |
| P7 resolve does not pass the entered scenes | kernel |
| P8 the host lands on pages with no text | no-text seam |
| P9 the scene read is queued without blocking | seam |
| P10 a blocking ensure is demoted when its waiter leaves | service |
| P11 the scene text is carried every step | seam |
| P12 the record is carried every step | seam (after tightening: a turn's request is read on its own; the first form survived because identical notes dedupe) |
| P13 the landed record is not the scene view | seam |
| P14 the port drops the scene's pending row | seam |
| P15 the pages ride the result on the hybrid engine too | seam |
| P16 pages are not packed whole | ceiling |
| P17 the scene text gets the ordinary ceiling | ceiling |

**Suites (leehow-pc, `6ceab4287`).** ext: `ℹ tests 3047`, `ℹ pass 3047`, `ℹ fail 0` (wall 145 s); loop: `# tests 166`,
`# pass 166`, `# fail 0`; py: `1725 passed, 2 skipped in 179.23s (0:02:59)`.

**Replay of the batch-4 table's t18 and t19** (the SL-45 fixture `sl45/fixtures/b4-t18`, queue as at t18's start; recorded
Keeper with `--latency live`, live `grok-build/grok-4.7-build-fast` reader, thinking low; t19's input `--then`, answered by
the replayed Keeper's delivery; `SINGLE_LOOP_DUMP_REQUESTS=1` for the notes).

| arm | t18 wall | t19 wall | what the notes carried |
| --- | --- | --- | --- |
| live table | 240.1 s | 46.6 s | t18: the move refused twice after 120 s waits |
| base `c31f483dd` / SL-45 branch, replay | 141.7 s / 141.7 s | -- | the move refused `reading_timeout` |
| this branch, t19 at once | 22.8 s | 16.3 s | t18 step 2: `scene_text` of `last-chance-bar` (page 17, 3,489 bytes), the `scene` view (558 bytes), `pending` naming `last-chance-bar`; t19: `pending` again (the read still in flight) |
| this branch, t19 after the read settled | 23.2 s | 15.0 s | t18 the same; the read settled 263.5 s later, **unavailable** (`reading_failed` after two rounds: read 128.7 s + review, repair read 46.9 s + review, every review unit ok, refused at publication); t19's first step carried `scene_record {status: "unavailable", reason: "reading_failed"}` once, with the record head |

The move landed on the first call in every run (`apply` 7.1 s, the admission lane's recorded 6.6 s included) and the turn
delivered the recorded prose.

**Findings, not fixed here.**
- **The bar's index text is thin.** The bar's own node cites only page 17 (the town's arrival page, which names the bar
  once) and no index row names the bar, so the pages carried were the town's arrival, not the bar's own pages (28-30,
  which the reader found). Structure could not reach them: the index's town section spans pages 17-42 and does not list
  the bar among its entities. A book indexed at scene grain (as §14.16.5 writes for starters) would carry the bar's pages.
- **The detail read failed at publication twice** on this book (the replay deletes its workspace, so the kernel's refusal
  text was not kept; the tool should retain the fork's queue next time). With the record unavailable the table plays on
  the arrival text alone; the Keeper is told the record could not be read.
- A scene node published by a reading always cites a page, so the foreground wait now remains in practice only for pages
  with no native text (a scanned book) or a failed extraction.
