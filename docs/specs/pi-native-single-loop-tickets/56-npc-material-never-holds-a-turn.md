Status: ready-for-human (filed 2026-09-25 from the 血色公路 batch-7 table; batch 8; implemented 2026-09-25 on `claude/sl56-20260925`)
Stage: SL-56 (P1, in-play reading on PDF modules; the NPC face of SL-47)
Spec: docs/kernel-rpc.md §22.4.7 (SL-47 scene text lands on the index), §11.5.4 (SL-51 persons from carried text), §22.4 (`requireMaterial` for names), the reading wait

# SL-56 — NPC material never holds a turn: a resolve or act on a person whose detail read is pending lands on what the book's text says, the record lands later

## Evidence (ticket 29 batch-7 entry, `claude/sl29a-b7-20260925`@cde26d84; campaign `sl29ab7-xuese-0445`, job `read-5`)
- t10 124.5 s and t11 131.4 s: a `resolve` targeting an NPC whose own `detail` read (`read-5`) never completed was refused `material_pending` and the turn waited the full `reading_timeout` cycle, twice for the same job; the prose was still delivered (SL-37 holds). SL-47 gave scenes an index-level landing; `requireMaterial` for a person still holds the turn until the person's record is read.

## Ruling (owner, 2026-09-25)
The umbrella rule ("reading never holds a turn") covers persons: a write or check that names a person the index or the carried text names (SL-51's `from_passage` shape) lands on that text; the person's detail read continues on a blocking slot and the record lands on a later note; the foreground wait remains only for a person the book's text nowhere names.

## Scope
1. Contract: §22.4.7 addendum (persons) with a cross-reference from §11.5.4; the `pending` row names the person.
2. `requireMaterial` (`kernel-ts/modules/reading.ts`) for name-typed material: when the index or the carried passages name the person, do not throw; register provisionally as SL-51 does and queue the detail read as blocking; fold the record on landing (replacing the provisional entry once, SL-51's path).
3. Tests, mutation-killable: a resolve on a person named by the index lands and carries the passage; the record lands on the next turn once; a person named nowhere still waits; then the replay of the b7 table's t10 (recorded Keeper, live reader) reporting the wall.

## Comments

### 2026-09-25 — SL-56/SL-57 worker (branch `claude/sl56-20260925`, base `f62f2a13b`)

**Commits.** `d234e932a` contract (§22.4.7.1, a subsection of §22.4.7, with a cross-reference at the end of §11.5.4; §22.3.3
for SL-57; no number moves); `7c9059a4d` implementation and tests (SL-56 and SL-57 share `reading.ts`); this entry.

**What t10 actually was.** The resolve's `target` was not a book person. At t10 the Keeper wrote `apply npc
最靠边的那个男人 to: here` (and `person`), which established a **table** person (§87; the book had given the man no name),
then checked him. `Reading.requireMaterial` asked the published graph *file* whether that name was ready; the loaded
graph has the table person installed, so `graph.find` found him, `materialReady` (raw file) said no, and the gate raised
`material_pending` with `focus: "最靠边的那个男人"`. `withTablePeople` already answers `ready` for a table person on the loaded
module ("a table person needs no source reading"), but the reading's gate never consulted it. `read-5` was therefore a
detail read of the Keeper's appellation; it read twelve pages for five minutes (the reader went and read the gas station
and its three men) and was still running at table end. The book-person half of the ruling (an index-named person held for
their record) is the same shape one step removed and is what §22.4.7.1 mainly builds; t10 itself is the first cause.

**What changed (§22.4.7.1).**
- *Table persons are never held.* `requireMaterial` passes a table person (`established: "table"` or `"passage"`) and
  queues nothing.
- *A person's seat.* The caller says which names stand where a person stands: `resolve`'s `actor`/`target`, `apply npc`'s
  `name`. No name is classified by its words.
- *A book person not yet read* (an `npc`/`creature` node not ready, or an index-only name in a person's seat) is refused
  as before, now with `details.person {key, name, names, book}` and `details.index {pages}` (`personIndexPages`: the node's
  own `source_refs`, then the index rows that meet its focus identity, at most `SCENE_INDEX_PAGES`).
- *The landing.* The host (`landPerson`, §22.4's wait path, never an owned preparation) looks for the person in the
  turn's carried text, then in the index pages' native text (`sourcePages`), and resends the same call with the host-only
  `_land_on_text: [{key, passage?}]` (stripped when a model sends it). The kernel lets a book node through on its index
  pages or a passage, and an index-only name only on a passage whose sentence holds the name (§11.5.4's comparison);
  an index-only name is registered provisionally in §11.5.4's shape (`table_people` with `from_passage`), and the focus
  joins `world.index_people`, which the gate passes from then on (a `resolve` writes this at the gate, before any roll).
  `apply`'s result carries `person_text`.
- *The reading and the note.* The host queues the person's detail read blocking with no waiter, in the scene-readings
  list as a person's entry: the pending row names the person (`person`), the index pages' text (when used) is carried
  once as `person_text` (8 KiB ceiling, its own head), and the record lands once as `person_record` (`landed` /
  `unavailable` / `unusable`). The record replaces the provisional entry by name once (SL-51's `withTablePeople`, unchanged).
- *The wait remains* for a person the book's text nowhere names (no index pages and no carried passage; an index-only name
  no sentence holds; no `sourcePages`).

**Tests** (`tests/extension/person-text-landing.test.mjs`, new): (1) emitted kernel: t10's shape (table person, then a
check) passes; a book npc not yet read is refused with `details.person` and her page for a check and a write; landing on
the check writes `index_people`, after which a write and a check pass without landing; an index-only person is refused
naming the index row's pages, is not landed without a passage nor with a sentence that does not hold the name, lands with
one, is registered `from_passage`, and the write's result carries `person_text`. (2) seam (hybrid-v1, faux Keeper, emitted
kernel, stub reading bridge): the write lands in one call; pages extracted once; one blocking ensure with no waiter; the
next step's note carries `person_text` once with a pending row naming the person; after the read lands the next turn's
first step carries `person_record` once, never again. (3) seam: a person whose name the pages do not hold keeps the
foreground wait and nobody is registered. `tests/extension/scene-own-pages.test.mjs`'s helper now requests in the
foreground (SL-57 queues a background retry of each refused read in that fixture; a foreground request claims first).

**Mutations** (copy-revert, runtime rebuilt each time; all killed):

| # | mutation | killed by |
| --- | --- | --- |
| M1 | a table person gated again | 1 (t10's shape) |
| M2 | the host's landing never honoured | 1, 2 |
| M3 | `index_people` not consulted | 1 |
| M4 | any passage accepted | 1 |
| M5 | an index-only name landed on pages without a passage | 1 |
| M6 | the host never lands a person | 2 |
| M7 | the pending row does not name the person | 2 |
| M8 | a person's text rides as scene text | 2 |
| M9 | the landing registers nobody | 1, 2 |

**Suites (leehow-pc, `7c9059a4d`).** ext: `ℹ tests 3130`, `ℹ pass 3130`, `ℹ fail 0` (wall 179 s); loop: `# tests 195`,
`# pass 195`, `# fail 0` (44 s); py: `1728 passed, 2 skipped in 175.88s (0:02:55)`.

**Replay of the b7 table's t10** (fixture `gate-fixture.mjs --fork --queue-at 2026-09-25T04:55:16.600Z --turns 10`, the
fork's queue as t10 began: `read-2` failed, `read-3`/`read-4` completed; `run.mjs --llm replay --latency live --reader live
--wait-reads 600000 --keep-workspace`; recorded Keeper and admission verdict, live `grok-build/grok-4.7-build-fast` reader,
live Jev). Not committed: the fixture and fork hold the book.

| | live table | this branch, replay |
| --- | --- | --- |
| t10 wall | 172.1 s (resolve 124.6 s) | **36.0 s**, delivered (`implicit_narrate`) |
| `apply npc` + `person` | ok | ok, 60 ms, `最靠边的那个男人` established `table` |
| `resolve` on him | `needs: reading_timeout` after the 120 s wait, `read-5` queued | **ok**, 4.6 s (the replayed admission verdict's 4.5 s), a check (failure) |
| reads raised | `read-5` (detail of the appellation) | none; the fork's queue has nothing queued or running (`wait_reads: settled` at once) |

What the note carried: the step after the write carried the man's card (`npc` view, 1,408 bytes); no `person_text` and
no pending row, correctly: a table person has no book text to land on. The rest of the wall is the recorded Keeper
latency (17.4 + 6.1 + 12.1 s) and the prescreen (2.8 s). t11's resolve on the same man takes the same path (not replayed).
The kept fork, summary, trace, telemetry and dumped requests are in the worker's scratchpad (`sl56/replay-after/`).

**Not done, and why.**
- The live replay does not exercise the book-person landing (t10 has no book-named person); that path is shown by tests
  1-3. A table that checks an index-named person before their record lands would exercise it live.
- A person established from a passage by SL-51's `apply` path gets no detail read of their own; their record still arrives
  with the scene's reading, as §11.5.4 has it. Not changed.
- The manifest's status lines are left to the integrator.
