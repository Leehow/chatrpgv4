# Reading serves the table: deliver what is read, cut what is read to what the table needs

Status: in progress (owner approved 2026-10-06, 「按你的建议来就行」 on the measured assessment below)
Date: 2026-10-06
Baseline: `0.9.7a` at `9431c8d48`, with the `claude/reading-cost-20261006` integration branch (§186) merged in. Integration branch: `claude/reading-delivery-20261006`.
Contract: §187 of `docs/kernel-rpc.md` (written with this spec, before code). Amends the §22 implementation decision on reviewers, §151.2's targeted repair, §151.4's candidate pages, §135.30's `source_presence` candidates, the `establish` of `apply move` (§49, §168.3), the module brief of §30 and the roster fit of §180.4, and the window anchor of §182.3.
Tickets: `docs/specs/reading-delivery-tickets.md`.
Load the `typesafe-jev` skill before writing or reviewing the Jev question of RD-01.

## Problem Statement

The owner asked whether the reading system should be rebuilt so that it serves the Keeper better, faster and cheaper, "毕竟最终目的不是空跑而是为了能让 KP 知道有什么内容，怎么演好这个模组". Two investigations on 2026-10-06 (one real table: 554 reading calls, 15.8M input tokens; the App home's reading work directories since 10-02) and a read of `0.9.7a` give two findings.

**1. The five cost items are structural and share one cause: the job unit.** Reading works in two-page author jobs whose product is a fragment of a whole-book graph with every record reviewed by vision. Every item below is a symptom of that mismatch, and the §186 slice (prefix, findings, coverage reuse) touched only item 3 and half of item 4:

| # | share | mechanism on `0.9.7a` |
|---|---|---|
| 1 | author exploration ~29 % of calls | the claim packet (`kernel-ts/modules/reading.ts`, `const packet`) carries every known node, every claim, `field_spans` and the whole vocabulary; nothing scopes it to the job's pages; `field_spans` is read only by the checker (`kernel-ts/modules/visual.ts` `row(packet.field_spans)`), never by the prompt; above 48 KiB `readerInput` (`extensions/module/reader.ts`) stops inlining and the author reads `task.json` in slices. 32 of 42 authors on the measured table did this. |
| 2 | review 35 % of calls, 53 % of uncached | `reviewUnits` (`extensions/module/reader-review.ts`) batches records only when they cite the identical page set, at most 8 records / 24 KB, and always adds a `/coverage` unit; each unit is a cold `pi -p --no-session` child; the unit brief says "review … against original images using pdf" while `content/setup/visual-reader.md` line 72 says the host-supplied images are usable and must not be reopened; 84 of 94 reviews reopened the pages the host had already delivered. |
| 3 | fix loop ~23 % | §186.3 now reports every finding with allowed values; the 61.8 KB instruction file is still one document for index, opening, detail, visual, map and review work, and about two thirds of it does not apply to a two-page detail author. |
| 4 | full rework ~23 % | `repairDecision` (`extensions/module/targeted-repair.ts`): `review.missing` non-empty ⇒ `{kind: "full"}`; 7 of 9 repairs on the measured table were coverage `missing` and re-read the pages and re-reviewed everything. |
| 5 | need reads: 6 jobs, 36 % of input | `runtime/jev/source-reader-driver.ts` unions the structural pages, every facet's top leads and the short-section pages, then `slice(0, 20)`; each candidate page carries up to 6,000 characters of native text and the author gets 6–8 page images; Jev's need leads (2–5 pages) decide whether to read, not what. |

**2. What is read does not reach the Keeper, and the three symptoms have one cause: every delivery path starts from the active scene's graph adjacency.**

- A scene the Keeper mints with `apply move establish` (`kernel-ts/apply/move.ts` → `establishTableEntity` → `ModuleGraph.addTableEntity`) is a node with name keys and no relation. `where.exits` (`graph.sceneExits`), `cluesHere`, `source_presence` candidates (`kernel-ts/runtime/apply-operation.ts`) and `queueAdjacentReading` all follow relations from the active scene, so a minted "阿巴托尔" beside the book's "阿巴托尔镇 → 埃索加油站" has no exits, no clues, no people and no read-ahead. The adaptation path (`kernel-ts/adaptation/graph.ts`, `add_scene`) already writes a `route-to` edge back to `based_on`; the move path writes nothing.
- `npc_presence` is seeded once in `initialWorld` (`kernel-ts/write/index.ts`), not at all for a `source_reference` book, and never on a new graph generation. The live `source_presence` offer does read the current graph, but only for a book scene with `present-in` edges or `npc_ids`; a minted scene yields nothing.
- The book's roster is the module brief's `people` (`kernel-ts/read/capsule.ts` `moduleSection`), rebuilt when the source revision changes, cut from the end at 2,048 bytes (`fittedModuleSection`). It is not turn-one only, as one analysis said; it is budget-cut, so the persons read latest are the first to be lost, and it is ordered by graph order, not by where the table is.

On 2026-10-04 four Blood Road tables each added 174–707 nodes while their Keeper saw the names of 7–17 % of them. Cheaper reading that still does not arrive is a hollow delivery; so is a delivery that puts a dead or departed person back in a room because the book seats them there.

A second opinion (another assistant's read of the same analysis) agreed on the direction and added three constraints this spec adopts: define what the Keeper receives per turn before changing what is read; later-read persons enter as *references* and the table's own state decides who is actually present; the 2–5 lead pages of a need read are a starting point, not a hard cap.

## Solution

Eight tickets, in four groups, in this order: deliver first, then cut the author's input, then the repair and need paths, then the review organisation. No ticket changes what counts as evidence: every published record is still reviewed against original page images by a reviewer independent of its author.

**A. Delivery (RD-01..03, §187.1–§187.4).** The Keeper's module material is stated as three tiers (whole-book brief; the scene's material; original text on demand) and each tier names its producer. A minted place always gets the way back to the scene the party left (`route-to`, deterministic, no model) and, when the host's placement clears its bar, a `located-in` edge to the book place it lies inside; a destination the placement finds to be the *same* book place is moved to, not minted. The capsule's `where` gains `within`: the book place's name, summary, exits and people, so the book's topology and cast are one hop from any minted room. `source_presence` offers are computed from the active scene and its `within` place on every capsule, and a person the table's ledger holds dead or moved out is never offered again by the book. The brief's rosters are ordered by the reading window of §182.3 (persons and places whose pages lie in the window first) and say how many lines the budget cut.

**B. The author's input (RD-04, §187.5).** The task packet carries the nodes that cite a page in the job's pages or in the window around them plus their one-hop neighbours, the module node and the cast names; `field_spans` leaves the packet (the checker reads the graph); the vocabulary is the job purpose's fields; the instructions are assembled per purpose from split files. Measured, not promised: packet bytes and the inline/slice outcome per job go to telemetry.

**C. Repair and need reads (RD-05, RD-06, §187.6–§187.7).** A coverage `missing` whose pages lie inside the job's pages becomes an *append* repair: the author gets its draft, the missing list and those pages, adds records and changes nothing else; review runs the new records and coverage. Full re-reads stay for `missing` outside the job's pages and unbound reviews. A need read's candidate pages are the need facet's leads at or above the gate (at least two, up to `need_read.lead_pages`) and the pages the entity's accepted material cites; structural and short-section pages leave the need read; native text is complete for lead pages and a title line elsewhere; the author keeps `pdf` and search to go further.

**D. Review organisation (RD-07, §187.8).** One independent reviewer per page set per round: records whose page sets overlap share a reviewer up to an image budget (`reading_review.images`) instead of 8 records / 24 KB; the coverage questions ride in the unit whose page set is the job's pages. The reviewer brief states that the host-delivered images are the evidence and `pdf` is for a page not delivered or a closer view. Independence is from the author and from the previous round, as §22 asks; a reviewer is still a fresh session.

RD-08 is the product-path acceptance.

## Success, measured on the product path

A fresh home (empty library) reading the same Blood Road PDF (`book-4`, 111 pages) with the same reading model (`flapcode/gpt-6-luna`, low) through a real table (`tests/play/driver.py start --launcher bin/pi-coc-setup`, then 20 player turns including one minted room, one return to a book scene and one question about a person read after turn 5), compared against the §186 acceptance table `rc-accept-blood-01`:

Delivery (read from the turn records and the request log, not from the graph):
- a minted room's capsule shows `where.exits` non-empty and `where.within` naming a book place; the Keeper's next narration names a book exit or person (turn record);
- a person published by background reading after turn N is a `source_presence` candidate by turn N+1 and reaches a request by turn N+2;
- the brief's `people` and `places` list the window's entries first; a person the ledger holds dead is never re-offered;
- no "book says vs table says" regression: `present` still comes from `npc_presence` only.

Cost (per `Original pages N-N+1` job, medians, against `rc-accept-blood-01`: author uncached 88K, author calls 13.5, submissions 4, review uncached per job 86K, review children per job 4):
- author uncached input down at least 30 %; author calls at most 10; `task.json` slice reads zero when the packet inlines;
- review children per job at most 2; review uncached per job down at least 30 %; page reopens of host-delivered pages zero;
- full re-reads caused by an in-page `missing`: zero; append repairs reviewed by their new records only;
- need-read input per job down at least 50 %, with the need's answered rate not down.

Unchanged evidence: the same verdict gates, every published record vision-reviewed, published graphs pass the same checks.

## Out of Scope

- Changing the evidence standard (dropping images or reviews; Jev as a verdict): §186.6 recorded the claim check's failure and it stays shadow.
- Re-cutting the job unit from two pages to chapters or scenes (the fourth step of the assessment). It is the real unit refactor and waits until A–D are measured; §187.9 records the intent.
- The library and window rules of §182 and §184; provider-side cache misses.
- Merging into the main line, packaging and the App: separate owner decision after RD-08.

## Comments
