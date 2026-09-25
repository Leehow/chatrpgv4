Status: ready-for-human (filed 2026-09-24 from the 血色公路 batch-5 table; batch 6)
Stage: SL-49 (P1, reading publication)
Spec: docs/kernel-rpc.md §22 (review, publication gate), §22.3.1 (SL-33 same-span), §90.5

# SL-49 — A reviewer's disagreement on one field is a recorded conflict; it does not refuse the scene's record

## Evidence (ticket 29 batch-5 entry, `claude/sl29a-b5-20260924`@dd58f89c9; fork under `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b5/.coc/playtests/sl29a-b5/home/.coc/module-campaigns/<campaign>/modules/book-1/` `deepen-queue.json` and `findings.json`, verbatim refusal kept)
- `last-stop`'s detail read reached its own pages (25–30) in both attempts and was refused at review with `reading_failed`, `visual review did not support ['/nodes/4', …]`: the reviewer judged a detail's `delivery_kind` to be `skill_check` where the reader wrote what the book's wording gives the Keeper. One classification field, disputed, and the whole scene record (exits, people, things, clues) never published; the bar plays on the arrival text alone. Same shape as SL-47's replay (both rounds refused, reason then lost).
- Independent of any budget (SL-41 fixed those); a second content-level refusal class after SL-33's same-span.

## Ruling (owner, 2026-09-24)
The review gate refuses a record for what is not in the book (a fabricated node, a span that does not say it), never for a disagreement about how a supported fact is classified. A field the reviewer disputes is published with the reader's value and a `contested` mark carrying the reviewer's reason; the Keeper sees the mark; a later reading may settle it.

## Scope
1. Contract first: §22 amendment (new subsection): the review verdicts per field (`supported`, `contested`, `unsupported`); only `unsupported` on a fact field refuses; classification fields (`delivery_kind` and its kin, listed by the schema not by name in code) can only be `contested`.
2. `extensions/module/reader-review.ts` and the kernel's publication check: publish with `contested` marks; the refusal text names the field and the reason only when a fact is unsupported.
3. Tests, mutation-killable: the bar's recorded review (from the fork) publishes the record with one contested field; an unsupported fact still refuses; the Keeper's carried scene record shows the mark. Then the replay of the b5 table's t17 with the recorded review.

## Comments

### 2026-09-24 — SL-49 worker (branch `claude/sl48-20260924`, base `0af64595a`)

**Commits.** `277a91e3a` contract (§22.3.2, with `classification_fields` in `content/modules/module-graph-contract-v3.json`);
`e54b7c35b` implementation and tests; `c580fd535` the replay tool (`experiments/single-loop-routing/sl49-bar-replay.mjs`) and
a test fix; this entry in the last commit.

**What the recorded reviews actually said.** The bar's `read-6` was refused in two rounds, and each merged review held more
than its message named. Round 1: `/nodes/0` with its summary and dramatic question, `contradicted` (Keeper-box material in a
player-safe scene), and `/nodes/5/.../results/regular/book`. Round 2, four entries, all `contradicted`: **`/nodes/4`** (the
long-pig clue's *root*; its reason is about `delivery_kind`), `/nodes/5/.../check/selection`, `/nodes/6/.../check/selection`
(no `maximum` in the book) and **`/claims/4`** (the *root* of the clue's `discoverable-at` claim; its reason says the
investigators do not learn it there). `/nodes/4/properties/delivery_kind` was not among the reviewer's assigned pointers, so
the dispute was written on the record's root. The first message alone read as "one classification field".

**Changes (contract §22.3.2).**
1. Verdicts `supported` / `contested` / `unsupported`; `contradicted` and `unclear` read as `unsupported`; any other word is
   the reviewer's slip (`checkReviewEvidence`, host and `submit_reading`: a schema error on the unit's one retry). The word
   list and the pattern matcher are one import-free module both ends load: `kernel-ts/modules/review-verdicts.ts`.
2. Classification fields come from the schema: `classification_fields.node` patterns in the graph contract (no names in
   code). Declared: `properties/delivery_kind` and a check's `selection` in its three seats. **Decided, not declared**
   (so a dispute on them still refuses): `visibility`, `truth_status`, a claim's `predicate`, a check's `difficulty` and
   `scope`, `node_kind` -- reasons in §22.3.2 (a contested `visibility` would publish Keeper material player-safe; a
   predicate can be the fact itself). This is my call on the ruling's "delivery_kind and its kin"; widening it is one line
   of the contract JSON.
3. The gate (`checkReview`): a classification field with any non-supported verdict is a contest (reviewed, never refuses);
   anything else refuses with `details {path: <the field>, rule: "review_unsupported", verdict}` and the message
   `visual review found <path> unsupported (<verdict>): <reason>` (was `details.path: "/"`). **A record's root is a fact**,
   so a non-supported verdict on `/nodes/<i>` or `/claims/<i>` refuses whatever its reason names: the gate never reads a
   reason.
4. Publication writes the graph's `contested` map (`/nodes/<node_id><field>` -> value, verdict, reason, reviewer pages,
   job, generation); a later review supporting the field (or an ancestor) settles it.
5. `look focus=scene` carries `where.contested` (scene node and records one relation away, at most 8, reasons cut at 240)
   and `where.contested_note`; the carried scene view orders them right after `where.obligations`.
6. The reviewer is told (visual-reader.md verify phase, the detail review brief): the three words, name the deepest
   pointer (any existing pointer under the assigned record), a root only when the record is not in the book, and
   `contested` for a pointer in `task.classification_fields` (copied into the focused review input; the packet's
   `vocabulary` carries it too).

**Tests, each killed by a mutation** (copy-revert runner and record in the scratchpad: `sl48/mutate48.py`,
`sl48/mutations48.json`; the restored tree passes). `tests/extension/review-contested-field.test.mjs` (3): the emitted
kernel over a structural replica of the bar's round-2 draft (same kinds, fields, pointers, claims; English, no book
text) -- the recorded dispute shape refuses naming `/nodes/4` with the reason and `rule`; the two `selection` disputes
alone publish; the clue's dispute named on its field publishes with the reader's value and three marks, and `look
focus=scene` at the bar shows them; a later supporting review settles one; `unsupported` on a fact, `contested` on a fact
and an unknown word each refuse; the host rejects an unknown word and passes the declaration to the review input; the
matcher is exact token for token; the carried scene view keeps the marks when it cuts.

| mutation | killed |
| --- | --- |
| C1 a classification dispute refuses like a fact | yes |
| C2 every dispute is a contest (a root too) | yes |
| C3 the refusal names `/` again | yes |
| C4 an unknown word on a classification field is a contest | yes |
| C5 publication writes no marks | yes |
| C6 a supported field never settles its mark | yes |
| C7 the mark keeps no value | yes |
| C8 the matcher takes a prefix | yes |
| C9 the schema does not declare `delivery_kind` | yes |
| C10 the scene view carries no marks | yes |
| C11 marks only on the scene node itself | yes |
| C12 the carried scene view does not order the marks | yes |
| C13 the reader packet does not carry the declaration | yes |
| C14 the host takes any verdict word | yes |
| C15 the focused review input drops the declaration | yes |

**Suites (leehow-pc, `c580fd535`).** ext: `ℹ tests 3064`, `ℹ pass 3064`, `ℹ fail 0` (wall 165 s); loop: `# tests 175`,
`# pass 175`, `# fail 0`; py: `1725 passed, 2 skipped in 316.80s (0:05:16)`.

**Replay of the b5 table's t17 with the recorded reviews** (`sl49-bar-replay.mjs` over a disposable copy of the fork
`sl29ab5-xuese-5001`: both recorded rounds -- round 1's candidate copy and unit reviews, round 2's draft and merged
review -- finished through this branch's emitted kernel, then t17's recorded move, then the Keeper's note as the hybrid
engine builds it; no model called):

| round | disputes | result |
| --- | --- | --- |
| 1 | `/nodes/0` (root), `/nodes/0/summary`, `/nodes/0/properties/dramatic_question`, `.../results/regular/book` | refused at `/nodes/0`, `review_unsupported`, `contradicted` |
| 2 | `/nodes/4` (root), two `selection`s, `/claims/4` (root) | refused at `/nodes/4`, `review_unsupported`, `contradicted`; the two `selection`s were contests and did not refuse |

**The bar's record did not publish, and no contested field was published**: both recorded reviews put a dispute on a
record's root, which is a fact under the ruling and the gate. What changed for the table: the refusal names `/nodes/4`
and the reviewer's reason instead of `/`; the index row of SL-48 was written (pages 28-29); the move landed on pages 28-29
(was 17); the note carried `scene_text` (page 28, 4,589 bytes; page 29 dropped whole by the 8 KiB ceiling) and
`scene_record {status: "unavailable"}` -- no `where.contested`, since nothing published. The ticket's expected test ("the
bar's recorded review publishes with one contested field") is therefore **not** what the recorded review does; the test
asserts what it does, and the publishing case is the same review with the clue's dispute on its field and no claim-root
dispute, which is what the new reviewer instruction asks for.

**Not done, and why.**
- **A live re-review of the bar under the new protocol was not run**: the product replay (`run.mjs --llm replay --reader
  live`, fixture built at `sl48/fixtures/b5-t17` with `--fork --queue-at 2026-09-25T00:18:42Z`) stopped at its own guard:
  the App's grok-build token expired (both the App's and this worktree's copy); the tool never refreshes it, and I did not
  sign the App in or switch the reader model. With a fresh App login: `node experiments/single-loop-routing/run.mjs
  --fixture <scratchpad>/sl48/fixtures/b5-t17 --runs 1 --llm replay --reader live --then "<t18 input>" --wait-answer
  600000`. That run answers the real question: does a reviewer told to name fields let the bar publish?
- **Open for the owner.** Round 1's dispute is a `visibility` one (Keeper-box text in a player-safe summary) and round 2's
  `/claims/4` is a `discoverable-at` one; both stay refusals under the declared set. If the owner reads either as "how a
  supported fact is classified", it is one pattern in the contract JSON, and the `predicate` case needs a claim pattern
  (the matcher is nodes-only today).
- The ticket manifest's status lines are left to the integrator (as SL-43/44/47's were).

### 2026-09-24 — SL-49 worker, live re-review of the bar (branch `claude/sl48-20260924` at `779388b68`)

The coordinator's decision stands: no contract change (`visibility` and a claim's `discoverable-at` stay refusals). With the
App's grok-build login refreshed, the product replay of batch 5's t17 then t18 ran with a live reader:
`run.mjs --fixture <scratchpad>/sl48/fixtures/b5-t17 --runs 1 --llm replay --reader live --then "<t18 input>" --wait-answer
600000`, plus `--out` and `SINGLE_LOOP_DUMP_REQUESTS=1` to keep the notes. The Keeper was replayed; the reader and
reviewer were live `grok-build/grok-4.7-build-fast`.
- **t17 (7.8 s, delivered).** The move landed on `scene_text` page 17. There was no own index row yet: the bar had not been
  read before this turn, so SL-48 cannot help here. The bar's `detail` reading `read-6` ran as a blocking read.
- **The bar's record published in round 1.** The read took 107.0 s and viewed pages 28-29. Four review units passed
  (18.0-65.2 s). There was no repair round and no refusal. `scene_record_landed` came 168.5 s after the move.
- **Contested fields: none shown.** t18's carried scene view has no `where.contested`, so no mark sits on the bar's node
  or on any record one relation from it. The replay removes its workspace, so the review files and the graph's
  `contested` map were not kept. A mark on a record not related to the bar cannot be ruled out from this run.
- **t18 (4.1 s, delivered, implicit narrate).** The first step's note carried the record head, the bar's `scene` view
  (3,098 bytes: `material: "ready"`, 2 rules, 0 exits, 0 affordances, `present` empty) and the prescreen's `source`
  passages for `last-stop` (4,211 bytes, cut to budget). There was no `pending` row and no `scene_record` row, since the
  party was in the bar and the record was the scene view itself.

One run, so it cannot say how much the new reviewer instruction (name the field, `contested` for classification
fields) contributed: in batch 5 this reading failed in both rounds; here it passed in its first.
