# Page readings duplicate what the graph already has (NR-07 survey)

Status: survey, read-only, 2026-10-07. Ticket NR-07 (`docs/specs/names-in-the-request-rename-tickets.md`). Contract
sections read: §22 (reading, publication), §152.4 (one printed visual is one node), §177/§188.2 (the cast and its
duplicates), §180.7 (one being, one node), §184 (the library follows the leading fork), §185.4–185.6 (name-free
handles), §187.5 (the cut packet). No product code changed. The data homes were only read.

Method, in short: the census runs the kernel's own `ModuleGraph`, `bookNames`, `normalize` and `bookCast` from this
worktree's `kernel-ts/`, bundled with esbuild, over every graph in both homes (6 in the acceptance home, 43 in the App's
home: 6 library modules, 37 campaign forks). A second script reads every retained reader attempt
(`work/read-*/attempt-*`: `task.json`, `draft.json`, the session log) in both homes. The scripts are not in the repo; the
appendix lists them and what each one reads.

## Summary

- **Cause.** Publication merges a draft into the graph by `node_id` alone (`assembleVisual`, `kernel-ts/modules/visual.ts:1015`:
  a drafted id the graph lacks is simply added). Nothing compares a drafted *new* node with the published nodes of the same
  kind by name, except for npc/creature pairs (§180.7) and printed visuals with crops (§152.4). The reader is supposed to
  reuse known ids, but in generation 55 it never saw them: they sat at line 2,211 of a 68,652-line `task.json` and it read
  lines 1–400. Across all retained attempts, the existing node's id appears in the reader's session for 11 of 99
  same-name mints.
- **Extent.** 109 distinct same-kind name-sharing pairs across all graphs. By the survey's reading of each pair (names,
  pages and summaries; the appendix lists every call), 88 are true duplicates, 12 are different things sharing a name and
  9 are borderline. Blood Road holds 48 duplicated entities in 121 nodes, so 73 extra copies across its lineages, and Dust
  to Dust holds 7. The NR-02 fork at generation 60 has 22 duplicated entities, 25 extra nodes out of 448: 6 people, 10
  scenes, and one each of clue, faction, handout, object, rule and tome. Source-unit readings mint most of them, then need
  reads, then visual-asset readings.
- **Consequences.** Places, objects and clues resolve `ambiguous`; a real table lost a round on it (nr06-blood-road-3, t3).
  Facts split across copies (a tome in one shop copy, its clues in the other). A copy that was never read makes a read name
  look unread to the material gate. Each copy gets its own handle and epithet, and its own line in the brief, and copies
  often carry the opposite visibility. A duplicate minted in one campaign's fork moves into the library a second later
  (§184.1) and so into every campaign created after it.
- **Recommendation.** (a) Prevent new duplicates in the draft check: "one thing, one node", the §180.7 rule extended to
  same-kind pairs. The kernel raises the question when a drafted node's own name meets a published node's names (for people,
  also the §188.2 cast join). The reader answers by reusing the published id or by declaring `distinct_from`, which the
  reviewer checks. `module.read.finish` judges the same rule again against the landing generation. (b) Group existing
  duplicates at read time for every kind. Generalize §152.4's `variant-of` survivors and §188.2's `individuals` into one
  survivor map, written as kernel identity relations in a new generation. Nothing is deleted and no id is rewritten, and
  facts the survivor lacks are carried onto it. Do not merge the graph by deleting nodes.

## 1. Which path mints the duplicate: generation 55, traced

Campaign `nfh-accept-blood-road-1`, fork `module-campaigns/nfh-accept-blood-road-1/modules/book-4`.

| time (Z) | what | evidence |
| --- | --- | --- |
| 01:56:26 | `read-2` queued: `detail`, `source_unit {Original pages 25-26}`, background | `deepen-queue.json` |
| 01:56–01:59 | attempt-1 dies with `runtime_closed`; its draft is kept | `work/read-2/attempt-1/findings.json` |
| 01:59:44 | attempt-2 claimed, `base_generation` 54, `resume_from` attempt-1 | `work/read-2/attempt-2/packet.json` |
| 02:04 | the reader's own check passes on the 7th `submit_reading` | `attempt-2/read-1.jsonl` |
| 02:05:43 | `module.read.finish` publishes fork generation 55, 438 → 446 nodes | `generations/generation-55-*/module-graph-manifest.json` |
| 02:05:44 | `library_sync` published, library generation 55 | campaign `telemetry.jsonl` line 1622 |
| 02:06:05 | the handles lane names the 8 new nodes in the **book's** `handles.json` | library `modules/book-4/handles.json` |
| 02:06:29 | the epithet lane words the copy's handle 「站在基地里的住民」 | campaign `epithets.json` |

**The landing path.** `Reading.finish` (`kernel-ts/modules/reading.ts:1892`) → `finishHeld` → the detail branch:
- `checkDraft` (`:2049`) and `checkReview` (`:2058`) pass;
- `draftIdentityPairs` (`:2062`) looks only at `asset`/`handout` nodes with crops, so it finds none;
- `assembleVisual` (`:2069`, `visual.ts:997`) merges by `node_id` and adds the 8 new ids;
- `writeGraph` (`:2168`) writes the generation, then `libraryFollows` (`:1900`) offers it to the library.

No settle, identity or index path is involved. Campaign-scope adoption is the plain lineage sync of §184.1, not the
replay of §184.5.

**The reader wrote the ids.** The kernel minted nothing. The retained draft (`attempt-2/draft.json`) declares
`npc-pete`, `npc-daniel-mather`, `npc-desert-hicks`, `scene-town-center`, `scene-mather-general-store`,
`scene-tom-barber-shop`, `object-cough-medicine` and `object-dynamite-crate`. Its `ready_nodes` is empty. The published
graph already had `npc-book-4-pete` (pages 24–25), `npc-book-4-daniel-mather` (p. 26), `npc-book-4-sand-rats` (沙漠地痞),
`scene-book-4-town-center` (pp. 17, 25, 26, the very same name 「阿巴托尔镇中心（主干道）」) and
`scene-book-4-mather-store` (p. 26). All five were in the packet's `known_nodes`.

The other three new nodes:
- `scene-tom-barber-shop` (「汤姆理发店」, p. 26) is probably `scene-book-4-barbershop` (「理发店」, p. 27) under another
  name. No name rule can see that.
- The two objects (the cough syrup and the dynamite crate under the sink) are new facts.

**Why the existing nodes were not recognised.**
1. **The reader never saw them.** `task.json` was 1.86 MB of pretty-printed JSON, 68,652 lines, not inlined (the prompt
   said "Read task.json"). The host writes `cast_names` and `index` before `known_nodes`
   (`extensions/module/reading-service.ts:1163-1166`). `known_nodes` started at line 2,211 and Mather's entry at line
   6,697. Attempt-1's reader read lines 1–200; attempt-2's read lines 1–400 and then the retained draft. Both stopped
   inside `cast_names`, and neither session contains the string `npc-book-4-daniel-mather`.
   - The run predates RD-04's cut (§187.5): its `task.json` still carried `field_spans` and all 438 nodes.
   - The cut shrinks `known_nodes` but does not move it. `cast_names` and `index`, the ~2,200 lines in front of it, are
     unchanged.
2. **Nothing at landing compares names.** The draft check refuses an npc and a creature that share a normalized name
   (§180.7, `checkBeings`, `visual.ts:773`), and §152.4 compares visual crops. A second `npc` or `scene` named exactly like a
   published one passes both.
3. **The id scheme is not the cause.** The library's readers wrote `npc-book-4-<slug>`; this reader wrote `npc-<slug>`.
   Same-scheme duplicates are just as common: `npc-book-4-robert-brenner` beside `npc-book-4-robert-l-brenner`, and four
   church scenes under `scene-book-4-*`.
4. **Names were the intended identity.** The reader did read `cast_names` and gave Mather the book's printed name, as the
   instruction says: "so the same individual keeps one identity across readings". But publication keys on ids, so the
   right name under a new id is a second node.

Two side findings from the same attempt:
- The check's own messages produced orphans. The reader first wrote two claims (Mather `present-in` the store, the store
  `located-in` the town centre) with `truth_status: "sourced"`. The check refused `claims must declare authored fact,
  belief, rumor, lie or inference using the vocabulary` at path `/`. The reader deleted the claims rather than fixing the
  word.
- It also minted `npc-desert-hicks` only to satisfy `A retained source need must name a candidate or accepted entity`
  (tool calls 11–14).
- So all 8 copies landed with zero relations and zero claims. They are reachable only by name or handle, which is
  exactly where they collide.

**How it spread.**
- Fork → library one second later.
- The book-level `handles.json` gave every copy a permanent handle (`covered-porch-general-store`,
  `rough-red-haired-smoking-shopkeeper`, …).
- `nr06-blood-road-1`, `-2` and `-3` were forked from library generations 60, 60 and 62, so all three carry the 8 copies.

## 2. Extent

### 2.1 What counts

- **A pair:** two nodes of the same `node_kind` that share a whole normalized name. The names are the node's name, its
  display name and its aliases (`bookNames`), compared under `normalize`, which is the key of the `names` index that
  `resolve` reads.
- **Strength of the shared name:**
  - `name=name`: the two own names are equal;
  - `name~alias`: one node's own name is among the other's names;
  - `alias-only`: they share only an alias.
- **Page relation:** overlapping, adjacent (±1) or disjoint pages, from `source_refs`.
- **People:** the cast's grouping (`bookCast` / `CastPerson.nodes`, §188.2) is reported beside the pairs.
- **The verdicts are the survey's reading** of names, pages and summaries:
  - `true`: the same entity;
  - `different`: different things that share a name;
  - `borderline`: cannot be told from the graph.

  No code made these calls. The appendix lists every non-`true` call with its reason.

### 2.2 Distinct pairs across every graph (deduplicated by node-id pair per book)

| | pairs | true | different | borderline |
| --- | ---: | ---: | ---: | ---: |
| all | 109 | 88 | 12 | 9 |
| `name=name` | 70 | 64 | 0 | 6 |
| `name~alias` | 28 | 21 | 6 | 1 |
| `alias-only` | 11 | 3 | 6 | 2 |
| pages overlap | 53 | 50 | 2 | 1 |
| pages adjacent | 18 | 15 | 1 | 2 |
| pages disjoint | 38 | 23 | 9 | 6 |
| `name=name` **and** pages overlap | 39 | 39 | 0 | 0 |

- Every "different" pair shares only a short form or an alias: 皮特 for Pete and Peter Benson, 约翰, 劳伦斯, 罗伯特, 大院
  for the compound and its courtyard, 卫生间, a double-barrel shotgun. None shares an own name.
- A page-overlap condition would miss 38 of the 88 true pairs. Examples:
  - Alissya, p. 13 vs pp. 31, 53, 54;
  - Brenner's p. 50 node;
  - the red house, pp. 47–48 vs 49–50;
  - 14J cells, p. 52 vs 53–54.

### 2.3 Duplicated entities (connected components of `true` pairs)

| book | entities | nodes | extra copies | by kind (entities) |
| --- | ---: | ---: | ---: | --- |
| book-4 Blood Road, all lineages | 48 | 121 | 73 | scene 20, npc 15, faction 3, creature 2, rule 2, asset, clue, handout, location, object, tome 1 each |
| book-5 Dust to Dust | 7 | 16 | 9 | handout 2, location 3, npc 1, rule 1 |

Book-5's two handout groups are already read as one by §152.4's `variant-of` relations in fork `game-5d82fd23`. They are
the case §152.4 was written for.

Per graph (pairs present in that graph):

| graph | nodes | pairs | true | diff | border | cast persons with ≥2 nodes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| acceptance library book-4 (gen 63) | 453 | 39 | 29 | 9 | 1 | 6 |
| fork nfh-accept-blood-road-1 (gen 60) | 448 | 36 | 27 | 8 | 1 | 6 |
| forks nr06-blood-road-1 / -2 / -3 | 448 / 452 / 453 | 36 / 39 / 39 | 27 / 29 / 29 | 8 / 9 / 9 | 1 | 6 |
| App library book-4 (gen 73) | 457 | 29 | 22 | 7 | 0 | 4 |
| App fork game-24bb66cb (727 nodes) | 727 | 28 | 22 | 3 | 3 | 4 |
| App fork game-7e9db15c | 449 | 25 | 18 | 7 | 0 | 3 |
| App fork game-f4d8e72b | 400 | 12 | 10 | 0 | 2 | 0 |
| App fork game-5d82fd23 (book-5) | 232 | 13 | 11 | 0 | 2 | 0 |

- 11 other App forks have 1–14 pairs.
- 22 forks have none: the two starter forks of the-haunting and 20 PDF forks of at most 91 nodes.
- Libraries book-1, 2, 3, 5 and the-haunting have none.
- The count grows with reading volume.

**The NR-02 fork at generation 60**, the 22 entities:
- people (6):
  - 丹尼尔·马瑟 ×2;
  - 皮特 ×2;
  - 威廉·斯柯特牧师 ×2;
  - 布伦纳 ×3 (`npc-book-4-dr-brenner` on p. 50 too);
  - 艾尔伊希娅 ×2;
  - 马修/彼得·萨顿 ×2;
- scenes (10):
  - 羔羊之血圣灵降临教堂 ×4;
  - one pair each: 马瑟综合商店, 阿巴托尔镇中心, 雷鸟礼品店, 凯利药店, 文森特兄弟废品回收站, 14C 教堂, 14F 奥斯庭的家,
    14G 红房子, 14J 牢房;
- one each: the clue 书如何到约翰手里, the faction 沙漠地痞, handout #2, 正义之怒, 最后一站租房, 《蠕虫的秘密》.

The cast groups all six people. Brenner's third node is not grouped because it lacks the row's fullest form, as NR-02
noted. Borderline: `npc-book-4-sand-rats` (the group, p. 15) vs `npc-desert-hicks` (two hicks in a trailer, p. 25).

**Cross-kind name twins** are not in the counts above, because most are different things. A map or photo of a place
named like the place, for example, is a different node. Only two families can be the same thing:
- scene/location twins, 9 in the NR-02 fork. `ModuleGraph.projectSourcePlaces` (`module-graph.ts:575`) already keeps the
  scene and does not project the location as a second scene, by the same normalized-name rule.
- faction/npc nodes for 沙漠地痞, 4 pairs.

### 2.4 Which readings mint them, and whether the reader had seen the original

Over the last attempt of every completed job in both homes (890 jobs):
- readers declared 3,936 new nodes and reused 775 known ids;
- 99 new nodes share a whole name with a same-kind node in that job's own `known_nodes`.

| job kind | jobs | new nodes | same-name mints | jobs with one | original's id anywhere in the session | original shares a page |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| source unit | 315 | 3,114 | 75 | 54 | 9 | 19 |
| need read | 60 | 118 | 12 | 9 | 1 | 12 |
| visual asset | 359 | 413 | 10 | 9 | 0 | 7 |
| plain detail | 131 | 214 | 2 | 2 | 1 | 1 |
| opening, guidance, map scope | 25 | 77 | 0 | 0 | – | – |

"Anywhere in the session" means the existing node's id string occurs in the reader's log: prompt, tool results or its
own writes. The 11 positives show the probe can find an id. Readers do page and grep `task.json`: most sessions contain
*some* known id. But in 88 of 99 same-name mints, the one node it duplicated never appeared.

Attribution over the library's generations and App fork `game-7e9db15c` agrees:
- adjacent source units: the Thunderbird shop from units 29–30 and 31–32, the junkyard from 35–36 and 37–38;
- need reads: `read-39` for the Last Stop minted the Brenner and room-rate copies;
- a visual-asset reading: `read-47` minted a church scene.

## 3. Consequences today

| where | what goes wrong | code |
| --- | --- | --- |
| `resolve` for places, objects, clues | Two nodes answer one name; refused `unknown_entity ... is ambiguous` with two handles. On nr06-blood-road-3 t3, `apply move 马瑟综合商店` was refused (`dusty-town-general-store` / `covered-porch-general-store`) and cost a `lookup` round (`chatrpgv4-wt-names/.coc/playtests/nr06-blood-road-3-play-1/turn-3.json`). `placeOf` answers null on a tie. Only people are collapsed (`oneEach` through `individuals`, NR-02). | `kernel-ts/read/module-graph.ts:685-760, 816` |
| facts split across copies | The two Thunderbird copies hold different halves: the tome and two clues sit on one copy, four other clues on the other. `cluesHere` walks one copy's relations. The 8 copies of generation 55 have no relations at all, so their facts (the copy Mather's `knowledge`, `beliefs`, `motives`) reach the Keeper only through an ambiguous name. | `kernel-ts/read/capsule.ts:542` |
| material gate | `materialReady(name)` requires *every* node matching the name to be ready. The copies are never in `reading.materials`, so 马瑟综合商店, 丹尼尔·马瑟, 皮特 and the town centre now read as unread by name. A request or gate by name can queue reading of material already read. | `kernel-ts/modules/reading.ts:544-551`, used at `:809`, `:1449` |
| presence | `npcsPresent` reads `world.npc_presence` by stored handle. The copy Mather is present nowhere, and a copy scene shows nobody. | `capsule.ts:534` |
| the brief | `moduleSection` writes one roster line per node: two Mathers, and three 沙漠地痞 factions in fork 24bb. It is fitted to 2,048 bytes from the end (§187.4), so the copies push other people out. | `capsule.ts:1179` |
| handles | Each copy gets a book-level handle in `handles.json` (first writer wins, never removed) and a `world.node_handles` entry. Stored state is keyed by whichever handle the table used. | §185.4–185.6 |
| epithets | The copy's handle was worded 「站在基地里的住民」 from the copy's biography, which reads as a different man. NR-02 keeps the roster on the first node's word, but the lane still works per node. | `epithets.json` |
| visibility | The originals are `player-safe`; the generation-55 copies are `keeper-only`, scenes included. The two clue copies of 书如何到约翰手里 differ the same way. | graph |
| clue state | `discovered_clues` is matched by the clue view's name, so finding one copy leaves the other undiscovered. | `capsule.ts:542-551` |
| reading cost | A copy carries its own source needs (`npc-desert-hicks` has a `source_read` need), so the book is read again for something it already has. | graph `source_needs` |
| propagation | A fork's duplicate becomes library data (§184.1) and enters every later campaign. Old campaigns keep theirs (compile snapshots). | `campaign-scope.ts:245` |
| people | NR-02 fixed the roster, told, undo, protected spans and `resolve`. Presence, the brief and the capsule still show each copy, and Brenner's p. 50 node stays separate. | §188.7 NR-02 |

## 4. Design options

### 4.1 (a) Preventing new duplicates at landing

**Where.** Two places. The kernel has both already for visuals and beings:
- **In `checkDraft`** (`visual.ts:281`). This is the pure check the reader runs itself (`coc-read-check`,
  `submit_reading`), so it meets the refusal before any review is spent (§22.3.1, §186.3 report every finding at once).
  Its published graph is `graph-view.json`, the claim-time view (§187.5.4).
- **Again in `module.read.finish`, inside the module lock, against the landing generation.** Two readings claimed in
  parallel can both mint the same thing, which is the Dust to Dust map case §152.4 was written for. The call sits beside
  `draftIdentityPairs` at `reading.ts:2062`.

**What raises the question (deterministic, names only, no meaning read):**
- A drafted node with an id the graph lacks, of the same `node_kind` as a published node.
- The drafted node's own name or display name is one of the published node's whole names, or the published node's own
  name is one of the drafted node's names. This is §177.1's "own" clause, symmetric, under `normalize`.
- For `npc`, also: the drafted node and a published one join the same cast row both ways (§188.2's fold). This catches
  Sutton, Alissya and Brenner, whose own names differ.

On the census, the own-name trigger covers 98 pairs:
- 85 of the 88 true pairs. It misses 3 alias-only pairs, and today's cast fold catches neither of the two people among
  them: Brenner in `game-f4d8e72b`, whose own names differ only by 医生, Scott in `game-d78dd9ec`, and Felder's cottage.
  They are left to (b);
- 6 different-thing pairs and 7 borderline pairs, which the reader has to answer.

Pages are not a condition: 23 true pairs have disjoint pages. They go into the refusal as evidence.

**What answers it.** That two things are the same is a semantic question (Agents.md). The kernel only makes sure it is
answered, as §180.7 and §152.4 do:
- **Reuse.** The fix names the published node (id, kind, names, pages, summary): write only new facts under that id, and
  point the draft's claims at it. This is the same wording as §180.7's `ONE_BEING_FIX` and §152.4's
  `same_print_duplicate` fix.
- **Or `distinct_from: [<published id>]`** on the drafted node. The draft check adds it to `required_review`: the
  reviewer must find that the page names a different one, and an unsupported `distinct_from` refuses (`review_unsupported`,
  §22.3.2). Publication records the verdict in `module.json` `reading.identity[<key>]` so the pair is never raised again.
  The key is the source digest, the kind and the two ids, like `reading.visual_identity`.

**Options considered.**

| option | for | against |
| --- | --- | --- |
| a1. show the reader a compact roster first: the job's pages' known nodes as `{id, kind, name, aliases, pages}`, ahead of `cast_names` and `index`, or inlined | cheap; fewer repair rounds | not sufficient alone. §152.4's newspaper cards were listed in the packet and the reader was told to reuse them, and here 11 of 99 mints had seen the original. |
| a2. the check raises the question and the reader answers it (reuse or reviewed `distinct_from`) | uses the agent already in the loop; no new model call; same shape as §180.7/§152.4; the reader learns the right id while it still holds the pages | one repair round per collision, including the ~6 % of triggers (6 of 98) that are different things |
| a3. the kernel silently rewrites a drafted id to the published one | no round trip | the merge then meets same-span re-transcription or contradiction (§22.3.1) on a value the reader did not write against; the review covered another draft; a semantic decision made by string match |
| a4. a separate identity reviewer at finish, as §152.4 | independent | one more model call on every collision; the reader already reads the pages |

Recommended: **a2, with a1 as the cost saver.** A different-name duplicate (a misspelling, a new transliteration) is
outside any name rule. It falls to (b).

### 4.2 (b) Duplicates already in graphs

| option | what | cost and risk |
| --- | --- | --- |
| b1. graph merge | A new generation without the copies: claims and relations re-pointed, names, `source_refs` and properties unioned. | Everything keyed by node id or handle would dangle: `world.node_handles` (entries never change or go away, §185.4), `handles.json`, stored world state keyed by handle (`npc_presence`, `discovered_clues`, epithets, `journal.entries[node_id]`), history read by identity (`sameNode` needs the node), legacy slugs (§185.3), and the reading metadata keyed by node id (`materials.node_ids`, `field_spans`, `contested`, `source_needs`, `scene_index.scene`, `visual_identity`). Each needs an alias from the removed id to the survivor, which is b2 plus deletions. |
| b2. read-time grouping for every kind | One survivor map: §152.4's `variant-of` survivors (visual only today, `VISUAL_KINDS`, `module-graph.ts:1560`) and §188.2's `individuals` (people only, from the cast), generalized. Written as kernel identity relations (`rel-identity-<later>-to-<earlier>`, `properties.identity_review`, as `writeVariants` writes them) in a new generation. Nothing is deleted and no id changes. Every reader reads through survivors: `resolve`/`oneEach`, `materialReady`, presence, `cluesHere` and discovered clues, scene exits and `sceneNpcIds`/`sceneClueIds` (the union of the group's relations), the brief's rosters, the handles and epithet lanes (skip variants), source needs and focus identity. | A reader list to keep complete (the §31 reader side). A reader-authored `variant-of` claim (Dust to Dust: `npc-virginia-felder-revived` variant-of `npc-virginia-felder`, a state) must not collapse, so for non-visual kinds only kernel identity hops count. |
| b3. carry | On writing an identity relation, copy onto the survivor what only the variant has: aliases, `source_refs`, properties the survivor lacks, through `mergeValue`. This is §152.4's `carried_regions`, for facts. | The copy Mather's `knowledge`/`beliefs`/`motives` vs the original's `secret`/`agenda` would need a key-for-key merge; a contradiction stays on the variant (still readable through it). |

**Where the pairs and verdicts come from.** The same trigger as (a), run by the read-ahead over the published graph. Like
§152.4's identity jobs, it queues one background job per page or pair batch with no recorded verdict. The verdict comes
from a tool-using reader that opens both nodes' pages: `same` writes the identity relation, `different` is recorded. The
earlier node survives (`publicationOrder`, §152.4). The cast's both-ways fold stays the deterministic source for people,
as the owner already ruled in §188.2.

Recommended: **b2 + b3, not b1.** With (a) in place this is a one-time repair per graph, plus the occasional
different-name duplicate.

## 5. Testing it on the real path

1. **Replay generation 55's landing (prevention).** Clone (`cp -c`) the fork at generation 54 into a scratch home, take
   `work/read-2/attempt-2`'s draft and review, and call `module.read.finish` on the emitted kernel.
   - It must refuse, naming `npc-book-4-daniel-mather`, `npc-book-4-pete`, `npc-book-4-sand-rats`,
     `scene-book-4-town-center` and `scene-book-4-mather-store`.
   - `coc-read-check` on the same draft must report the same findings.
   - Reverting the check (mutation by copy) publishes the 8 orphans.
2. **One live source unit.** On the same clone, run a real reader on pages 25–26. Pass when no new same-kind, same-name
   node is published, and when `castNodes` holds Mather as one node without NR-02's fold.
3. **Concurrency.** Two readings claimed on one generation, both minting the same name: the second is refused at finish
   against the landing generation.
4. **Existing pairs.** On a clone of `nfh-accept-blood-road-1` at generation 60, run the read-ahead's identity jobs, then
   load the campaign.
   - `resolve 马瑟综合商店 [scene]` gives one node, where it gave `ambiguous` before.
   - Both handles still resolve.
   - `materialReady('马瑟综合商店')` is true.
   - Presence, the brief and `cluesHere` show one store, holding both copies' clues.
   - The Thunderbird scene lists the tome and the clues of both copies.
   - One mutation per reader converted.
5. **Real table.** `tests/play/driver.py` with the default live Keeper, on a new campaign of the repaired library.
   Campaigns are compile snapshots: an old fork changes only through its own new generation. Walk to the store, the church,
   the pharmacy, the gift shop and the base cells, and ask after Mather and Pete. Pre-registered pass:
   - zero `is ambiguous` on places, objects or clues;
   - one roster line per person;
   - no `material_pending` for a place already read;
   - no new same-name node in the fork after the table.

Run ext, py and loop on the box.

## 6. Open questions for the lead

1. **May the strongest tier be decided without asking?** Same kind, same own name and overlapping pages was 39 of 39 true
   here. §180.7 already decides one being by an equal normalized name. Or must every collision go through the reader or
   reviewer (the recommendation)? It is an owner call: identity is semantic.
2. **Should identity verdicts on existing pairs be a tool-using Pi job?** That is the recommendation: it reads pages, so
   by Agents.md it is text work. Or is a same/different verdict a short closed structure that may run as a lane? It is not
   on the turn's critical path, so the single-completion criteria do not obviously hold.
3. **Cross-kind identity:** scene/location twins (partly handled by `projectSourcePlaces`), and a group as `faction` and
   as `npc` (沙漠地痞). In scope, or left alone?
4. **Group vs member:** `npc-book-4-sand-rats` (the gang) vs `npc-desert-hicks` (two of them). Is that "the same" or not?
   The reader would answer under (a), but the rule needs a stance for (b).
5. **Repair where:**
   - in the library only, so new campaigns get it;
   - in every live fork as well, which needs one identity generation per fork;
   - in old App forks too. §185.3's precedent is "old campaigns are left as they are".
6. **The check messages that made orphans** (claims deleted after a refusal at path `/`; a node minted to satisfy the
   source-need rule). This is a separate ticket: the refusal should name the claim pointer and the vocabulary word, and the
   source-need rule should point at `node_refs` for a published entity.

## 7. Surprises

- Duplicates of one campaign become everyone's: library one second later, a book-level handle 22 seconds later.
- All 8 generation-55 copies are orphans with no relations, so they add nothing a walk can reach, only a second answer to
  a name.
- The kernel already refuses an npc and a creature that share a name (§180.7) but accepts two npcs, or two scenes, with
  the identical name.
- A copy that was never read makes a read name look unread (`materialReady` requires every match).
- Copies flip visibility (`player-safe` → `keeper-only`), scenes included.
- §152.4 misses a visual duplicate whose second node has no `image_sources`: Blood Road's two 矿道地图（守密人用） on
  p. 64, App fork `game-45cd3976`.
- The four Blood Road church scenes came from four different readings:
  - `lambs-blood-pentecost-church`: a source unit, pp. 33–34;
  - `church-lamb-blood`: a need read on Pastor Scott;
  - `lambs-blood-church`: a visual-asset reading of p. 33;
  - `lambs-blood-pentecostal-church`: a need read on William Scott, Scott's own duplicate node.

  So one duplicate breeds the next: a need read on a duplicate person re-reads its pages and mints its place again.

## Appendix: verdicts that are not "true", and the scripts

**Different things** (12 pairs):
- people:
  - Brenner and Robert Taylor (罗伯特);
  - John Thunder and John Vincent (约翰);
  - Lawrence Bell and Lawrence Miller;
  - Pete and Peter Benson (皮特), ×3 node pairs;
- things:
  - Austin's sawed-off shotgun and Scott's 正义之怒, ×2;
- places:
  - the compound (14) and its courtyard (14B), shared alias 大院, ×2;
  - the base cells (14J) and the red-house cells A–E;
  - Austin's bathroom and the red-house bathroom.

**Borderline** (9):
- 伊格眷属, the appendix kind (p. 102) vs the well's spawn (p. 47);
- 泰希罕 on a `creature-tcho-tcho` node (p. 101);
- the mining office as a burned shell (p. 63) vs a sealed wooden office (pp. 57–59);
- Quent McCoy (p. 28 sign) vs Quint McCoy (p. 40). The cast row joins them;
- the sand rats as a group vs two hicks;
- the silver cross in the cells (p. 53) vs Baines's cross (p. 108);
- 15C miner housing vs the area 15;
- Dust to Dust's Helverson revived twice, and Virginia dead and revived (authored states).

**Scripts** (session scratchpad `nr07/`, read-only over the data):
- `census.ts`, bundled to `census.mjs`: imports `ModuleGraph`, `bookCast`, `bookNames` and `normalize` from this
  worktree's `kernel-ts/`. Per graph: same-kind name-sharing pairs with strength and page relation, page-overlap groups,
  cross-kind pairs, the cast's multi-node persons, and each node's first generation;
- `inputs.py`: lists every library and fork graph in both homes;
- `pairs.py`: distinct pairs per book;
- `classify.py`: the verdicts above, each with its reason;
- `seen.py` and `attention.py`: reader attempts, reuse vs new, same-name mints, and whether the original's id appears in
  the session;
- `attrib.py`: first generation of each copy and the job that published it.
