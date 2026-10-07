# Reading cost: keep the request prefix, say every check finding at once, reuse coverage, redesign the claim check

Status: in progress (owner approved 2026-10-06, 「按你的建议做」)
Date: 2026-10-06
Baseline: `0.9.7a` at `a3ae7e396`. Integration branch: `claude/reading-cost-20261006`.
Contract: §186 of `docs/kernel-rpc.md` (written with this spec, before code). Amends §147.3 (image window), §151.2 (review reuse), §151.3 (claim check), §22's draft check.
Tickets: `docs/specs/reading-cost-tickets.md`.
Load the `typesafe-jev` skill before writing or reviewing any Jev question in this spec.

## Problem Statement

The owner asked whether PDF reading is mostly LLM work, whether its cache hit rate is low, and whether part of it can move to Jev. Measured on the installed App home (`~/Library/Application Support/Pipi/pipicoc/pi-coc/.coc`, reading work directories and `reading-telemetry.jsonl`, 2026-10-02 to 2026-10-06; no reading ran on 10-05):

1. **Almost all reading tokens are LLM tokens, and Jev already does the locating.** On 2026-10-04 Jev answered about 1,450 calls with 10.7M input tokens (about $0.45: page leads, guidance sections, need kind/answered, search scope, claim check). The Pi reading children made about 14,000 calls with 110M uncached and 333M cached input tokens. The author (a vision Pi agent that writes the graph draft) and the independent reviewers (one fresh vision Pi child per review unit) are the cost.
2. **The author's 76–82 % cache hit hides misses.** An author job is about 26 calls that each resend about 50K tokens. On 2026-10-06, 65 % of the author's uncached tokens were a prefix already sent that did not hit. Over 10-02..10-06 the read-phase misses were 46.5M tokens:
   - 20.3M at the call after a submission retired every delivered page image (`extensions/module/reader-context.ts`, `retiredHostImages`/`retiredImageCalls`): 895 events, about 22.7K uncached each;
   - 10.6M where the active window (`imageHistory: 4`) dropped an older image to admit a new one: 370 events;
   - 11.7M where the prefix only grew and still missed (provider side).
   Both rewrites replace image blocks in *early* messages with placeholder text, so everything after that message is recomputed.
3. **Review units are cold by construction.** Every unit attempt is `pi -p --no-session` with a fresh in-memory session id, so a fresh `prompt_cache_key` and (on grok) a fresh `x-grok-conv-id`. A unit makes a median of 2 calls; its first call pays 10–17K uncached. 2,011 review children ran on 2026-10-04. Review hit rate is 38–57 %. The unit's first user message starts with its own assignment, so even the job-level context identical across units is not a shared prefix. Review misses over 10-02..10-06: 16.8M (7.1M window eviction, 7.3M provider side).
4. **40 % of author calls are the fix loop after the first submission** (43 % of author input, 36 % of author uncached). `checkDraft` (`kernel-ts/modules/visual.ts`) throws at the first finding, so an author with seven independent mistakes needs seven submissions. Cost of the fix loop by the class of the rejection that started it (uncached tokens): shape and envelope 55 % (`coverage must be an object…` 668, `A visual scan records navigation coverage separately` 421, unknown draft keys, `must be an array`); graph and evidence 32 %; vocabulary 9 %; other 4 %. The vocabulary errors do not name the field, the value or the allowed values: authors cycle `keeper → private → keeper-only` and `asserted → authored_fact → fact → authored-fact` although `task.json` carries the vocabulary.
5. **Coverage review is 31 % of review units and 40 % of review uncached tokens.** 229 of 791 jobs ran the coverage unit again in a later round; the repeats are 22 % of coverage uncached (about 9 % of all review uncached). The fact units are reused per record (§151.2); the coverage unit is keyed by the whole candidate.
6. **The Jev claim check (§151.3) still fails its bar on new data.** 10,821 paired records retained since 2026-10-02 (after the 2026-09-29 calibration): AUC of Jev's `supported` score against the vision verdict 0.63 (claims 0.81, whole nodes 0.58). No (S, C) meets §151.3.1; the best passing point clears 6.8 % of supported records. At the shipped 0.8 / 0.1 it would clear 19.4 % and pass 16 vision negatives, of which 8 are only `contested` classification disputes. One Noul over a whole node (name, summary and every property) asks several things at once.

The hollow deliveries to avoid: lowering the evidence standard (dropping images or reviews) to make the numbers move; component timings or unit-test greens presented as savings; tuning a threshold on the data that then "passes" it; a vocabulary-to-label table in code.

## Solution

Five tickets, each a system path, none changing what counts as evidence:

- **RC-01 Image retention keeps the prefix.** Images enter the outgoing context once and stay; an earlier message is rewritten only when a hard budget overflows, then in one batch down to half the budget. A submission no longer retires images.
- **RC-02 One cache identity per reading round, shared content first.** Every child of one reading job round carries the same session id (`--no-session --session-id <id>`, which Pi supports), so the same `prompt_cache_key` and grok conversation; a review unit's brief puts the instructions and job-level context identical across units before its own assignment.
- **RC-03 The draft check says everything it can at once.** `checkDraft` collects independent findings per stage and returns all of them; each finding names its path, the offending value and, for a closed vocabulary, the allowed values. A top-level key that is a verbatim copy of a host task field is dropped; a field the contract makes host-owned for that job kind is filled by the host. Vocabulary errors name the allowed values, which removes the reason for a Jev labeling step (the earlier suggestion "Jev picks closed labels" is deferred, RC-05).
- **RC-04 Coverage review is reused after a targeted repair that changed no record's existence.** Under the same conditions as §151.2 targeted repair plus: no record added or deleted, only refused paths edited, and the previous coverage verdict had no blocking `missing`.
- **RC-06 Claim check redesign, pre-registered.** Records with classification fields are ineligible (their contest marks need vision); claims render names with aliases; a node is asked one Noul per field statement and clears only if every field clears. Two independent judges adjudicate the vision negatives of the held-out split before the bar is read. The §151.3.1 bar is unchanged. Splits and procedure are fixed in §186.6 before any run.

## Success, measured on the product path

A fresh home (empty library) reading the same Blood Road PDF (`book-4`, 111 pages) with the same reading model (`flapcode/gpt-6-luna`, low) through a real table (`tests/play/driver.py`, `bin/pi-coc`), compared per source unit (`Original pages N-N+1`) against the 2026-10-03 luna fork reads of the same units:

- author uncached input per unit job: down at least 30 % (median);
- author misses caused by our own rewrites: down at least 80 %;
- submissions per author job: median down; fix-loop share of author calls down;
- review first-call uncached per unit: down; coverage repeats where the rule applies: zero;
- unchanged evidence: the same review units, the same verdict gates, published graphs pass the same checks; reopen count (`pdf` page reopen) not up more than 10 %.

RC-06 succeeds only by its pre-registered bar; a failed bar is recorded, not tuned.

## Out of scope

- Reading less (§182 chapter windows, §184 library write-back) already landed; not re-litigated.
- Provider-side misses (prefix grew, still missed) beyond the shared identity of RC-02.
- Visual asset jobs, maps, scans: Jev reads text only.
- Merging into the main line, packaging and the App: separate owner decision after acceptance.

## Comments

### 2026-10-06 RC-06 outcome: the claim-check redesign failed its pre-registered bar

Held-out (App home rounds from 2026-10-04T00:00Z) read once at the tuning point S 0.93 / C 0.2. With the adjudicated
labels (two blind judges, 15 of 61 strict negatives relabeled supported), the check clears 20 / 6,230 supported records
(0.32 %; claims 4 / 3,189, nodes 16 / 3,041) and 0 / 46 strict negatives. The bar (≤ 1 and ≤ 1 % cleared negatives,
≥ 50 % cleared supported) is not met. The data default stays `shadow` with the redesign's questions; S/C in the data
are the pre-registered point. Numbers, splits and evidence paths: `docs/specs/reading-cost-tickets.md`, RC-06 Comments.
