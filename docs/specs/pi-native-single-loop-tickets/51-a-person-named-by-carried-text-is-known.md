Status: ready-for-human (filed 2026-09-24 from the 血色公路 batch-5 table; batch 6; implemented 2026-09-24)
Stage: SL-51 (P2, admission / kernel entities; follows SL-47)
Spec: docs/kernel-rpc.md §22.4.7 (SL-47 landing text), §135.31 (carried views), the `unknown_entity` refusal, §11.5 (NPC definition)

# SL-51 — A person the carried source text names is known to the run: a write about them registers them from the passage

## Evidence (ticket 29 batch-5 entry)
- `esso-station`'s carried pages (17–19) name three NPCs verbatim, 内特·帕特森 among them. At t7, before the scene's detail record landed (`read-5`), the Keeper placed him as present and was refused `unknown_entity: no npc named '内特·帕特森'`: the book named him in the text the host itself carried, and the product treated the write as an invention. A race inherent to SL-47's landing: the text arrives before the record.

## Ruling (owner, 2026-09-24)
What the carried source text names is not invented. A `person`/`npc` write whose name appears in the passages carried this run is accepted and registers the person provisionally from that passage (name, the page, the sentence), marked `from_passage`; the detail record, when it lands, replaces the provisional entry by name. The typed reviewer's grounds include the carried passages.

## Scope
1. Contract: §11.5 / §22.4.7 amendment (new subsection): provisional persons from carried passages; replacement on record landing; `unknown_entity` only when neither the graph nor the carried text names them.
2. Kernel (`kernel-ts/apply/entities.ts`, the npc registry) and the host (the carried view's names passed with the write): the name check consults the run's carried passages (structural: exact name match in the carried text, no fuzzy matching in code; a Jev question for a variant spelling is allowed).
3. Tests, mutation-killable: a person named in the carried text is accepted and registered `from_passage`; a person named nowhere is still refused; the record landing replaces the provisional entry once.

## Comments

### 2026-09-24 — implemented on `claude/sl50-20260924` (from `0af64595a`, with SL-50)

**Commits.** `bf88d96fd` (contract §11.5.4, the host's carried text, the kernel's passage persons and replacement, the typed reviewer's
`bookText`, tests), `56df308c1` (fix: the engine's new `carriedRows` had shadowed `carriedFor`'s `text()` helper -- a TDZ `ReferenceError`
whenever a step handed the Keeper an operation; caught by `test:ext` on leehow-pc in `single-loop-domain-policy` and
`single-loop-prescreen-budget`), `6436a1633` (a `person`-alone test).

**What was built** (contract §11.5.4, a new subsection of §11.5; amends §87.2, §22.4.7, §32.10):

- *The turn's carried text* (`extensions/kernel/carried-text.ts`): per campaign and turn, the source text the Keeper was shown. Hybrid: the
  engine's note reports what it actually carried after fitting (`coc:carried-text`: each page of a `scene_text` view that went, each book
  passage of a `source` view with a string `content`; `carriedPassages` in `runtime/jev/hybrid-engine.ts`). Legacy: the pages a landed move
  put in the apply result. A new turn forgets the last turn's.
- *The write carries the passage*: before admission, the host deletes any model-sent `_passage` from every `apply` effect, then for each
  `npc` (`name`) and `person` (`who`) effect looks the name up in the turn's carried text -- exact after the kernel's name normalization
  with all whitespace removed on both sides (page 17 breaks 拉斯·威廉姆斯 across a line), never under two characters -- and sets the
  host-only `_passage {scene, page, label, sentence}` (the sentence by `Intl.Segmenter`, page line breaks read as spaces, ≤ 300 chars
  around the name). Row: `lane: people, event: passage_named`.
- *The kernel* (`kernel-ts/apply/entities.ts`, `kernel-ts/apply/person.ts`, `kernel-ts/read/table-people.ts`): the graph answers first;
  only a name it refuses consults `_passage`, and only when the sentence holds the name under the same comparison. `apply npc` now
  establishes such a person even when the graph offered near-name candidates (t7's case); `apply person` establishes them instead of
  "nobody at this table". Pins (`skill`, `archetype`), `conditions` and `reunion` keep §87.2's refusal. Record: §87's `table_people` entry
  with `from_passage {scene, page, label, sentence}`; receipt `established: "passage"` + `from_passage`. `unknown_entity` otherwise, with
  its candidates unchanged.
- *Replacement once*: every load (`withTablePeople`) asks the loaded graph for each un-replaced `from_passage` name before installing it;
  a non-table person of that name (the detail record landed) takes its place: the per-person world maps (`npc_presence`, `npc_resources`,
  `npc_character`, `npc_profiles`, `npc_disposition`, `npc_defense`, `npc_action`, `person_labels`) move from the provisional handle and
  node id to the book's (the book's entry wins where both exist), and the entry gains `replaced_by`. A write persists it with its commit;
  a read computes the same in memory.
- *Admission*: the typed reviewer's state gains `bookText` (≤ 1 500 chars a passage, 4 000 in all) and its `basis` may name a `book:<n>`
  passage; the lane's prompt is unchanged. `npc`/`person` are not triggering kinds, so this matters only for a batch reviewed for another
  line.

**Tests.** `tests/extension/passage-person.test.mjs` (10): t7's batch (`npc` + `person`, a name with a near-name book NPC among its
candidates) lands `established: "passage"` with page and sentence, presence and label; a `person` write alone does the same; the same
batch without `_passage`, or with a sentence that does not hold the name, is refused `unknown_entity` (candidates still returned); a pin
stays refused; a later generation published through the module store naming her → the next write replaces the entry once (`replaced_by`,
presence and label re-keyed, the write lands on the book's handle, `look` resolves without ambiguity), a further write changes nothing; the
host's lookup (line break inside the name, near name, one character, turn scoping); the engine's report of carried views; the typed state
with and without `bookText`; the seam (legacy, emitted kernel): marks only the page-named person, strips a model-sent `_passage` (that
call is refused), forgets at the next turn; the typed reviewer at the seam sees `bookText` only on the turn that carried it.
`tests/extension/scene-text-landing.test.mjs`: the hybrid seam asserts the note's pages are reported once as carried text; a new legacy
test asserts the apply result's pages are, and a person they name is established from them.

**Mutations** (copy-revert, `mutate.py` in the session scratchpad; every one killed. The seam test's row comparison was order-sensitive at
first (rows are appended without awaiting each other); K7, K8, H1, H2, H4 and H6 were re-run after it was made order-insensitive, and K8
survived until the `person`-alone test was added):

| mutation | killed by |
| --- | --- |
| K1 the kernel never reads `_passage` | t7's shape, the replacement test |
| K2 a name with candidates is minted without a passage | named nowhere is refused |
| K3 the sentence is not checked for the name | named nowhere is refused |
| K4 a pin is accepted with a passage | the pin test |
| K5 no replacement on load | the replacement test |
| K6 the replacement not marked `replaced_by` | the replacement test |
| K7 the world maps not re-keyed | the replacement test |
| K8 `apply person` ignores the passage | the `person`-alone test |
| H1 a model-sent `_passage` not stripped | the seam test |
| H2 the carried text read for any turn | the lookup test, the seam test, the typed-reviewer seam test |
| H3 whitespace kept in the comparison | the lookup test, the seam test |
| H4 the host never marks an effect | the seam test |
| H5 `bookText` not passed to the typed attempt | the typed-reviewer seam test |
| H6 `bookText` not put in the typed state | the typed-state test, the typed-reviewer seam test |
| E1 the engine drops `scene_text` pages from its report | the carried-views test |
| E2 the engine never reports | the SL-47 hybrid seam test (its new assertion) |
| L1 the legacy apply result's pages not noted | the new legacy scene-text test |

**Not done / noted.**
- No live or replayed book-A table was run: the batch-5 campaign is a user-imported PDF (the owner's instruction: import no PDF), and the
  t7 shape is reproduced on the emitted kernel with the haunting and a carried page instead.
- The replay of gate #5 t3 (SL-50's Comments) is where this reached a live-Jev run: the `source` view that run carried held graph units
  only, so `bookText` was empty and the typed reviews' inputs were byte-identical to the base's.
- A Jev question for a variant spelling (the ruling allows it) is not built: only the exact occurrence establishes.
- Known edge of an exact occurrence: a name that is the front of a longer one in the text (内特·帕特 inside 内特·帕特森) counts; the
  record keeps the sentence so it can be read back.
- The NPC ledger, journal and voice masks keep what they filed under the provisional name; turn receipts are history and are not rewritten.

**Suites** (leehow-pc): all at `6436a1633`:
- `ext` -- "ℹ tests 3074 / ℹ pass 3074 / ℹ fail 0" (`== ext on leehow-pc @ 6436a1633…: exit=0 wall=151s`). The first run at `bf88d96fd`
  had 2 failures: the TDZ in the engine (fixed in `56df308c1`) and `gate #7's shape` in `single-loop-prescreen-budget`, a timing assertion
  (a read's prescreen deadline ≥ 2 s from its start, measured 1 637 ms) that failed again at `56df308c1` with the box at load 33 and passed
  in the full runs after (box load 15), and 3/3 on the Mac;
- `loop` -- "# tests 175 / # pass 175 / # fail 0" (`== loop on leehow-pc @ 6436a1633…: exit=0 wall=42s`);
- `py` -- "1725 passed, 2 skipped in 177.71s" (`== py on leehow-pc @ 6436a1633…: exit=0 wall=179s`).
