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
