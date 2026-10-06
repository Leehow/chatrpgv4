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
