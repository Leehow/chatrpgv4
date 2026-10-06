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

### RC-01 (2026-10-06, branch `claude/reading-cost-20261006-cache`): replay, budget 12, and a flapcode finding

**Replay.** `uv run --frozen python tests/play/reading_image_replay.py` (read-only over the App home, logs modified on or
after 2026-10-02; `guidance/opening/detail/answer` children only: 1,373 author and 3,281 review runs). Per request:
Tot = input + cacheRead; new(i) = Tot(i) - Tot(i-1) + T x images dropped; the measured miss is input - new, a rewrite
miss where the run dropped images (submission retirement or the 4-image window) and a provider-side miss elsewhere. A
policy's prompt adds T per image it holds that the run did not; a policy rewrite costs k x (Tot' - position of the
earliest evicted image), k calibrated on the run's own rewrite events (grok 1.46 / 1.82, flapcode 1.17 / 1.34,
author / review); at a provider-side miss the policy also recomputes every extra held image that arrived after the
matched prefix. T (tokens per image) is fitted per model: grok-4.5 2,426, luna 3,612 (flapcode) / 3,601 (codex),
deepseek-flash 990. Reopens: a reopen that followed a drop while the policy still held the page is removed; each image
the policy evicts while the run still held it adds the measured reopen rate after a drop (grok author 0.109 / review
0.252, flapcode 0.068 / 0.031). Cost units = uncached + r x cached, r from the usage cost fields where the provider prices
them (luna $0.10 / $0.01 per M: 0.1; deepseek-flash $0.15 / $0.003: 0.02); **grok-build reports zero cost
(subscription), so r = 0.25 is an assumption** (xAI's published grok-4 cached/uncached ratio); at r = 0.1 the grok
gains roughly double (author keep at 12: -19.1 %).

Measured baseline (window 4 + retirement): own-rewrite misses grok authors 22.2M (retirement 14.6M / 408 events, window
7.6M / 294), flapcode authors 4.6M (retirement 3.4M / 470, window 1.2M / 81); provider-side misses flapcode authors
12.6M (17.7 % of their requests miss at least 2K tokens on their own, against 3.7 % grok and 2.3 % openai-codex luna).

| model, role | measured uncached / cached | batch 4 retire | batch 4 keep | batch 8 keep | **batch 12 keep** | batch 24 keep | 12 retire |
| --- | --- | --- | --- | --- | --- | --- | --- |
| grok-4.5 author | 57.5M / 260.2M | -4.2 % | -7.2 % | -6.8 % | **-6.6 %** (uncached 36.4M) | -5.8 % | -3.2 % |
| grok-4.5 review | 51.0M / 66.6M | -1.7 % | -1.8 % | -3.0 % | **-3.5 %** | -3.2 % | -3.2 % |
| flapcode luna author | 29.9M / 109.1M | -1.8 % | +4.9 % | +7.9 % | **+8.3 %** (uncached 30.3M) | +9.4 % | -0.8 % |
| flapcode luna review | 24.5M / 19.7M | -0.2 % | +1.1 % | +0.8 % | **+0.9 %** | +0.3 % | -0.3 % |
| openai-codex luna author | 3.2M / 8.0M | -0.5 % | -8.9 % | -9.2 % | **-9.0 %** | -9.0 % | -0.6 % |
| deepseek-flash author | 3.6M / 22.4M | -10.6 % | -37.2 % | -41.7 % | **-43.4 %** | -45.1 % | -12.2 % |

Reopens after a drop (net, replay): grok reviews +47 % at 4, +10 % at 8, -16 % at 12; grok authors -3 % / -34 % / -41 %;
flapcode authors -22 % / -48 % / -55 %; deepseek reviews +33 % / +18 % / -17 %. Own-rewrite events at 12 (keep): grok
authors 702 -> 24, flapcode authors 551 -> 10.

**Choice: `reading_images.count = 12`.** The smallest budget whose replay lowers reopens on every provider and role
(the spec's evidence bar: reopens not up more than 10 %), within 0.6 points of the cheapest grok author budget and the
cheapest grok reviewer budget, own rewrites down 96-98 %.

**Flapcode finding (for the owner; the code follows §186.1).** On `flapcode/gpt-6-luna`, the current reading model and
the acceptance model, removing the submission retirement replays more expensive, not less: +8.3 % author cost units
and +1.3 % author uncached at 12 (+11-18 % on the 10-06 runs alone, 59 author runs), against -0.8 % with the retirement
kept. Its retirement misses are small (7.3K uncached per event, not 22.7K: 2 images, short prompts), its fix loops are
long, and its own provider-side misses recompute every image the request still holds. The same model through
openai-codex (2.3 % provider misses) gains 9 % from keeping. If the owner wants flapcode's number, §186.1's third bullet
is the one to revisit; the code change would be one handler in `reader-context.ts`.

Tests: `tests/extension/reader-context.test.mjs` (18 pass; four existing tests updated because §186.1 changed the
behaviour they pinned: the stable-identity test now expects batch eviction to half, the history test expects half of the
byte budget, the retirement test became the §186.1 delivery/eviction test, the host receipt test expects the page kept
after a submission), `source-answer-service` (3, the 4 became the data value), `reading-service` (39), `reader-review`
(32), `reading-cache-identity` (4, new), `reader-image-delivery`, `reader-source-receipt`, `reader-submit` (23),
`reader-idle-allowance` (7), `runtime-reader` (22), `review-repair-salvage` (7) all pass. Mutations M1-M7, M19, M20
(see RC-02) all caught.

### RC-02 (2026-10-06): cache identity per round, shared-first brief, provider evidence

- Pi: `--no-session --session-id <uuid>` opens `SessionManager.inMemory(cwd, {id})` (`main.ts createSessionManager`);
  ids must match `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`. The child's `session` event and every provider call
  carry it (a real child against a local Responses endpoint: `prompt_cache_key`, `session_id` and
  `x-client-request-id` all equal the round id).
- grok-build: `cache-routing.js` sets `x-grok-conv-id` from `ctx.sessionManager.getSessionId()`, now the round id.
- openai-codex: `prompt_cache_key` plus `session-id` / `x-client-request-id` headers = the round id. Its websocket
  continuation is per connection and per process; a websocket connection-limit error before the stream falls back to
  SSE in Pi's transport, so up to 40 concurrent children on one id degrade, not fail (not observed live; no provider
  calls in this ticket).
- deepseek-extended: its models are `openai-responses` too, so the same `prompt_cache_key` / `session_id` /
  `x-client-request-id` carry the round id (its client strips only `previous_response_id`); whether DeepSeek's
  prefix cache uses the key is not documented here and was not probed.
- flapcode: `prompt_cache_key` = the round id (the relay accepts it; `stripUnsupportedFlapcodeParams` keeps it) and
  `session_id` / `x-client-request-id` too, but the relay's own `session-id` header is pinned per provider instance,
  i.e. per child process, by `createFlapcodeProvider()` (the relay 400s without it). Evidence it does not defeat
  cross-child sharing: flapcode review children already start with a median 3,584 cached tokens on their first call
  (94 % above 2K) although every child had a fresh key and a fresh relay header, so the upstream cache is shared across
  children by prefix; evidence it is not a reliable cache either: 17.7 % of flapcode author requests miss with a
  constant header inside one child. Header semantics unchanged; a live A/B (shared header per round vs per process)
  is the way to decide, and it needs provider calls.
- Brief: same sentences, reordered (unit-independent first, job-level input before the unit's pointers, unit notes
  after); two units of a round share their brief up to their own `required_review`.
- Telemetry: `cache_id` on author rows, `usage.jsonl`, verify unit rows; `first_call_uncached` on passed unit rows and
  per phase on `job_accounting` (`{children, tokens}`).

Mutations (each copied aside, mutated, the listed single test files run, restored by copy; all caught): evict only to the
budget (M1), evictions not persisted (M2), retirement restored (M3), undelivered evictable (M4), no eviction row (M5),
author / reviewer budget literal 4 (M6, M7), no `--session-id` (M8), id ignores the round (M9), service does not pass
the id to reviewers (M10), unit request drops it (M11), brief input first (M12), focused task pointers before shared
fields (M13), unit task keeps the whole-review key position (M14), first-call uncached not captured (M15), verify not
tallied (M16), author row / usage file without `cache_id` (M17, M17b), unit rows without it (M18), image budget data
ignored (M19), stale host budget inherited (M20), cache id not validated (M21).

Known unrelated red: `tests/extension/control-flow-inventory.test.mjs` fails on `extensions/openai-fast/test/
offline.test.mjs` call sites (present at the base commit, not touched here).

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
