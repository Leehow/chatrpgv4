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
