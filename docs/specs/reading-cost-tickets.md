# Reading cost — tickets

Spec: `docs/specs/reading-cost.md`. Contract: §186. Integration branch: `claude/reading-cost-20261006`.

Every ticket: contract first (already written; a shape that does not fit is reported back, not improvised); system
language English; no semantic lists or regex classification; single test files locally, full suites only on the LAN
box and only by the lead; every product change has a test that a mutation of the change makes fail; tests travel the
real entry (`checkDraft` through `module.read.finish` / `submit_reading`, the reader context hook through a real
`pi` child or its hook harness, not hand-built normalized dictionaries).

## RC-01 Image retention keeps the request prefix (§186.1)

Status: ready-for-agent

- Replay the retained logs (App home work directories, 2026-10-02..10-06: `*.images.jsonl`, the matching
  `message_end` usages) to price candidate count budgets (current 4; 8; 12; the hook default 24) and the
  submission-retirement on/off, with the provider's real cached/uncached prices (flapcode luna and grok-build). Report
  the table and choose the budget; write it to `host-budgets.json` `reading_images`.
- Implement §186.1 in `extensions/module/reader-context.ts` (`boundImages`, the context hook, the submission
  retirement) and wherever `imageHistory: 4` is passed (`reading-service.ts`, `reader-review.ts`, `reader.ts`).
- Tests: an author child that views 10 pages one at a time rewrites no earlier message until the budget overflows,
  then once; a submission keeps images; receipts still require successful delivery; the eviction row is written.

## RC-02 One cache identity per reading round, shared content first (§186.2)

Status: ready-for-agent

- `--no-session --session-id <uuid from (module, job, round)>` for the author and every review unit of the round
  (`extensions/module/reader.ts` `readerCommand`, the `runTask` request). Check Pi's accepted id format.
- Reorder the review unit brief (`extensions/module/reader-review.ts`) shared-first; instructions' words unchanged.
- Telemetry `cache_id` and `first_call_uncached`.
- Tests: two units of one round get the same id, different rounds/jobs differ; brief order; flags reach the child
  command line; the grok hook sends the id; `prompt_cache_key` equals it (Pi transport).

## RC-03 The draft check reports every independent finding (§186.3)

Status: ready-for-agent

- `kernel-ts/modules/visual.ts` `checkDraft` and its callers (`kernel-ts/check.ts`, `Reading.finish`), staged
  collection with today's first finding preserved; `details.findings`; vocabulary findings with pointer, value and
  allowed values.
- `extensions/module/reader-submit.ts` shows the full list; `reader-normalize.ts` drops verbatim task-field copies and
  fills a visual scan's coverage, both listed in the receipt's `normalized`.
- Existing tests that assert a specific first message must keep passing unchanged; new tests: a draft with seven
  independent findings returns all seven in one call; a later stage does not run while an earlier is dirty; a
  vocabulary finding names `allowed`; nothing is translated.
- Report how many retained rejected drafts (App home `draft.json` at each rejected submission, where reconstructible)
  would have shown all their findings at the first submission.

## RC-04 Coverage review reuse after a records-only targeted repair (§186.4)

Status: ready-for-agent

- `extensions/module/reader-review.ts` (coverage unit carry, `carriedReviewUnits`, `review-plan.json`) and the kernel
  gate if a carried coverage row needs acceptance there (`kernel-ts/modules/visual.ts` `checkReview`).
- Measure on retained App home jobs how many of the 229 coverage repeats would have qualified.
- Tests: a records-only repair carries the coverage verdict; an added record, a deleted record, a changed
  `ready_nodes`, or a previous blocking `missing` each runs the unit; the carried row has `carried_from`.

## RC-05 Jev closed labels

Status: wontfix (superseded by RC-03, §186.5). Reopen only on §186.5's condition.

## RC-06 Claim check redesign and pre-registered calibration (§186.6)

Status: ready-for-agent (data assembly and judging first; code second)

1. Assemble splits exactly as §186.6 says; freeze them (file list with digests) before any Jev call of the redesign.
2. Judge the held-out strict negatives and the 60-record sample: two independent judges per record, cited page images
   rendered from the bound PDF plus native text, blind to Jev and vision.
3. Implement the redesigned eligibility and statements in `runtime/jev/source-claim-support.ts`,
   `kernel-ts/modules/claim-support.ts` (eligibility is shared), `extensions/module/claim-support.ts`; extend
   `tests/play/jev-claim-calibrate.mjs` to replay both splits.
4. Choose (S, C) on tuning; read held-out once; write the outcome here and in §151.3's spec ticket.

## Acceptance (lead)

Fresh home, Blood Road `book-4`, `flapcode/gpt-6-luna` low, real table through `tests/play/driver.py`; compare per
source unit with the 2026-10-03 luna fork reads, as the spec's success list says. Results and evidence paths recorded
below.

## Comments

### 2026-10-06 RC-06 phase A: splits frozen, held-out negatives packed for judging (worker, branch `claude/reading-cost-20261006-claim`)

Frozen before any Jev call of the redesign. Tool `tests/play/jev-claim-splits.mjs` (read-only on both homes); data
under `.tmp/rc06/` in that worktree (gitignored, not committed).

- **Manifest** `.tmp/rc06/manifest.json` sha256 `a5ce0bbcf13cf8deecc7be30f6dbfc6de6c1f9348027f7e61d424ba3531e2bed`
  (every source file with its sha256, every record root with its label and unique key). Split files: `tuning.json`
  `5e398bdcbfbd07da037e3b6c8b29801a1ebc5d3f841d30d44e74affe60f7cc04`, `heldout.json`
  `68ffb5b0206420f667c0b6f9fcce62f7231a7ceda25601f18a39658c289965d1`. A rebuild from the same homes reproduces all three
  digests.
- **Sources.** Corpus 2026-09-29: 3,460 rows; 23 instances (3 rounds of the deleted worktree `.pi/worktrees/pacing-ab-a`,
  all supported) are excluded because their candidate is no longer retained; 3,437 instances in 183 rounds. Cited
  pages' native text from the module's `native-navigation-v2.json`, the corpus's `native/`, else `sourceText` on the
  module PDF (one extraction version, digests checked, 0 disagreements). App home: 600 `claim-support.json` files, of
  which the 35 under `.coc/modules/book-4/work/merged/` are byte-identical copies of held-out campaign rounds and are
  counted once (the 8,702 / 66 / 25 quoted in §186.6 counted them twice; without the copies the held-out counts are
  7,976 / 64 / 23). 565 rounds: 265 tuning, 300 held-out by the file's mtime against 2026-10-04T00:00Z.
- **Exact candidate.** Each round carries the unit attempt `draft.json` whose records re-render to the statements the
  shipped v1 check recorded (448 / 448 tuning rounds, 300 / 300 held-out rounds matched), the records the v1 check asked
  (root, paths, cited pages), the known nodes they name and the task's `classification_fields` (absent in 89 corpus
  rounds' tasks), and the cited pages' text and digests. No Jev distribution is copied into the split files.
- **Labels and deduplication.** Per instance from the vision verdict words on the record's paths: `strict_negative`
  (any `unsupported | contradicted | unclear`), `contested_only`, `supported`, `unreviewed` (not scored). Unique record
  = sha256 of [source sha256, judged content (node: kind, name, aliases, summary, properties; claim: subject and object
  as kind/name/aliases, predicate, truth status, validity, asserting and knowing nodes), cited pages, their text
  digests]; a unique is strict negative if any instance is, else contested-only if any is, else supported.

| split | rounds | supported (inst / unique) | strict negative | contested-only | unreviewed (inst) |
|---|---|---|---|---|---|
| tuning: corpus 09-29 | 183 | 3,374 / 2,239 | 59 / 55 | 4 / 4 | 0 |
| tuning: App before cut | 265 | 1,921 / 1,338 | 78 / 76 | 29 / 29 | 23 |
| **tuning** | 448 | 5,295 / 3,573 | 137 / 131 | 33 / 33 | 23 |
| **held-out** (App from cut) | 300 | 7,976 / 6,215 | 64 / 61 | 23 / 21 | 304 |

- Overlap: 50 held-out unique records also occur in tuning (49 supported there, 1 a strict negative there); all 50 are
  supported in held-out; no held-out strict negative occurs in tuning. Kept as is: §186.6 splits by time.
- **Judge packets.** 61 (the held-out unique strict negatives, 64 instances), 65 cited pages. Index
  `.tmp/rc06/judge/heldout-neg/index.json` (sha256 `43185ceb84e49fca45ce10bca96cc064e2140249981d6dee272b64ae2ec204c7`);
  per packet `record.json` (raw record, the names of the nodes it references, its instances), `statement.txt` (English
  labels: a claim's subject, relation, object, truth status, condition, asserting/knowing nodes; a node's kind, name,
  aliases, summary, properties; the cited pages; the names of the record's other fields, e.g. `visibility`, `reason`,
  which only `record.json` carries), `pages/<page>.png` (`pdftoppm -r 110 -png -singlefile` of the bound `source.pdf`,
  digest checked, physical 1-based) and `native-<page>.txt`. No Jev distribution, no vision verdict.

### 2026-10-06 RC-06 phase B: redesign implemented, (S, C) chosen on tuning (worker, branch `claude/reading-cost-20261006-claim`)

No held-out Jev result was produced or read. `tests/play/jev-claim-replay.mjs` refuses the held-out split without
`--heldout-once`, which was never passed.

- **Code.** `kernel-ts/modules/claim-support.ts` (a record carrying any classification-field pointer is ineligible,
  `classification_field`; the shared rule takes the classifier), `kernel-ts/modules/visual.ts` (the gate passes its
  contract classifier, so such a Jev row is `review_jev_ineligible`), `runtime/jev/source-claim-support.ts` (family v2:
  aliases on claims, per-field node statements, per-statement batching, weakest-judgment clearing, alias-tolerant
  wording), `extensions/module/claim-support.ts` (task's declaration, the shipped contract's as fallback; evidence
  records gain `fields`). Evidence protocol unchanged (`source-claim-support-v1`): the part the gate reads did not change.
  Mode stays `shadow`; `host-budgets.json` untouched. Decisions: the "Implementation (RC-06, 2026-10-06)" paragraph under
  §186.6.
- **Replay.** Tuning split (manifest `a5ce0bbc…`), shipped clip/bound/page cap, real adapter `jev-1.13.0`, ≤ 4 requests
  in flight. 448 rounds, 5,488 record instances, 5,069 asked, 17,348 statements, 937 requests, 10.25M input tokens,
  $0.43, 93 s; 6 instances `packing_limit`. The classification rule made ineligible 362 supported, 24 strict-negative,
  30 contested-only and 3 unreviewed instances (unique: 274 / 22 / 28; all nodes: 282 clue, 132 rule, 5 other).
  Scored population (unique): supported 3,573 (claims 1,616, nodes 1,957), strict negatives 131 (claims 33, nodes 98);
  ineligible records count as not cleared.
- **Two runs, one wording fix.** Run 1 used the v1 claim wording with the aliased statements: claims with aliases lost
  0.108 mean `supported` against v1 on the same corpus records (claims without aliases 0.021), because "every name must
  be stated" was read as every alias. Run 2 adds, only where a statement's names carry aliases, that any one name
  suffices (aliased claims then −0.065). Run 2 is the implementation; run 1's chosen point was (0.85, 0.05), 87 / 3,573
  (2.4 %). Between the runs the same negatives' weakest `supported` moved by up to 0.06 with batch composition alone
  (a claim negative without aliases: 0.80 → 0.86), which by itself moved the zero-negative point from S 0.85 to 0.93.
- **Grid (run 2, unique records; full 12 × 7 grid in `.tmp/rc06/tuning-run-2/grid.md`).**

| S | C | cleared supported | claims | nodes | cleared strict negatives |
|---|---|---|---|---|---|
| 0.5 | 0.1 | 1,223 / 3,573 (34.2 %) | 790 / 1,616 | 433 / 1,957 | 9 / 131 |
| 0.5 | 0.2 | 1,617 (45.3 %) | 854 | 763 | 13 |
| 0.7 | 0.1 | 788 (22.1 %) | 464 | 324 | 5 |
| 0.8 | 0.05 | 225 (6.3 %) | 209 | 16 | 1 |
| 0.8 | 0.1 | 435 (12.2 %) | 224 | 211 | 5 |
| 0.85 | 0.05 | 110 (3.1 %) | 97 | 13 | 1 |
| 0.9 | 0.05 | 23 (0.6 %) | 16 | 7 | 0 |
| 0.9 | 0.2 | 84 (2.4 %) | 16 | 68 | 1 |
| **0.93** | **0.2** | **25 (0.7 %)** | **1** | **24** | **0** |
| 0.95 | 0.2 | 7 (0.2 %) | 0 | 7 | 0 |

- **Chosen (§186.6: zero cleared strict negatives, most supported cleared; ties to higher S, lower C): S 0.93, C 0.2**
  — 25 / 3,573 supported cleared on tuning (0.7 %; claims 1 / 1,616, nodes 24 / 1,957), 0 / 131 strict negatives.
  This is the point the held-out read uses. On tuning the redesign is far from the 50 % share; the read is still due
  as pre-registered.
- **Why (tuning only).** Instance AUC of the weakest `supported`, vision-supported vs strict negative: claims 0.78, nodes
  0.77. Per statement, vision-supported nodes' summary sentences have median `supported` 0.85 and identities 0.94, but
  strict negatives' summary sentences have 0.80 and identities 0.93: the negatives' fields look like the supported
  ones, and the record-level error sits in one field among many that a zero-negative gate must be strict enough to
  catch. Reader-derived fields (median `supported` on vision-supported nodes: `relationship_to_investigators` 0.63,
  `is_entrance` 0.34, `exit_conditions` 0.28, `runtime_projection` 0.13) cap most nodes. The claim negative that sets the S floor is a knowledge-boundary
  overclaim (an NPC said to know a group the page only says he belongs to).
- **Tests** (single files, this Mac): `claim-support.test.mjs` 10/10, `claim-support-gate.test.mjs` 2/2,
  `system-language` + `reading-accounting` 7/7, `consequence-host-budgets` 13/13; `control-flow-inventory` 3/4, the
  failure is `extensions/openai-fast/test/offline.test.mjs` sites outside this change. Mutations (copy aside, mutate,
  run, copy back): 15/15 killed — kernel rule ignores classification fields; gate passes no classifier; host ignores the
  task declaration; extension asks with no classifier; extension drops the contract fallback; any statement clears the
  record; the first statement decides; claims lose aliases; summary not asked; summary not segmented; property leaves
  not asked; node ids in values not named; identity not asked; aliased statements lose the any-name sentence; aliased
  values not flagged.

### 2026-10-06 RC-06 phase C: held-out read once; the bar is not met (worker, lead-authorized)

- **Inputs, checked before the read.** `heldout.json` sha256 `68ffb5b0…965d1` (the manifest's), the judge index
  `43185ceb…04c7`, the adjudication `scratchpad/adjudication.json` sha256
  `ac27b7b0fe8dd097107093be1c2493d9da89afb6cf1dd0ef4eb9077e03fe1eb9`: two judges, blind to Jev and vision, agreed
  on 51 / 61 packets; both said "stated" on packets 3, 4, 19, 35, 37, 38, 40, 44, 46, 52, 53, 57, 59, 60, 61. Each maps
  through the index's instances to exactly one unique key of the split (14 nodes, 1 claim); those 15 become supported,
  the other 46 stay strict negatives. Point: the tuning choice S 0.93 / C 0.2, unchanged.
- **The read.** `node tests/play/jev-claim-replay.mjs --split .tmp/rc06/heldout.json --out .tmp/rc06/heldout-run
  --heldout-once`, once: 300 rounds, 8,367 record instances, 7,509 asked, 23,945 statements, 766 requests, 11.84M input
  tokens, $0.50, 91 s, no unanswered record. `records.jsonl` sha256
  `3ade1b50943a6110ac8d072313731a5432390562f603e6f8307b1918c689c3d0`; scored with `--score 0.93,0.2 --relabel
  … --packets …` into `score-0.93-0.2.json`. The classification rule made ineligible 791 supported, 19 strict-negative,
  22 contested-only and 26 unreviewed instances (unique: 652 / 16 / 21 / 1; every contested-only record).

| labels | cleared supported | claims | nodes | cleared strict negatives | claims | nodes | cleared contested-only |
|---|---|---|---|---|---|---|---|
| raw vision | 20 / 6,215 (0.32 %) | 4 / 3,188 | 16 / 3,027 | 0 / 61 (0 %) | 0 / 29 | 0 / 32 | 0 / 21 |
| **adjudicated** | **20 / 6,230 (0.32 %)** | 4 / 3,189 | 16 / 3,041 | **0 / 46 (0 %)** | 0 / 28 | 0 / 18 | 0 / 21 |

- **Bar (§151.3.1 on the adjudicated labels): not met.** Cleared strict negatives 0 (≤ 1 and ≤ 1 %: met); cleared
  share of supported 0.32 % (≥ 50 %: not met). None of the 15 relabeled records clears at this point. Per §186.6 the
  data default stays `shadow` with the redesign's questions, and there is no second attempt on this held-out.
- **Data.** `content/rulesets/coc7/host-budgets.json` `source_claim_support`: mode `shadow` unchanged; `supported_min`
  0.8 → 0.93 and `contradicted_max` 0.1 → 0.2. In shadow these only set the `cleared` flag and the paired telemetry; the
  previous values were v1's zero-false-accept point and mean nothing for the v2 questions (on tuning, v2 at 0.8 / 0.1
  clears 5 strict negatives), so the shadow rows on new books now measure the pre-registered point, as 2026-09-29 did
  for v1. No review outcome changes.
- **Context, descriptive only (not used for any choice).** Instance AUC of the weakest `supported`, vision-supported vs
  strict negative: claims 0.83, nodes 0.80. The cleared 20: 4 claims, 8 object, 3 location, 2 scene, 2 npc, 1 rule nodes.
- **Cleared vision-supported records, judge packets (reporting only, not part of the bar):** all 20 (fewer than 60),
  `.tmp/rc06/judge/heldout-cleared/` (index sha256
  `0c7354e5e8e6801c3e6ce45d847590aa0a6516163eab50a65fe75fc32b71790b`), same format as `heldout-neg`, no Jev score and
  no vision verdict. They come from the frozen split (`jev-claim-splits.mjs --from-split`), not a rebuild; regenerating
  the 61 `heldout-neg` packets the same way reproduced them byte for byte.
