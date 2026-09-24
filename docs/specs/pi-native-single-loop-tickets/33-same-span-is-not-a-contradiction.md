Status: ready-for-human (implemented 2026-09-24 on `claude/sl33-20260924` from `claude/integ-single-loop-20260923`@6b12a2e75, merged forward to cdfb06c85 (SL-31, SL-28); awaiting review)
Stage: SL-33 (P0, PDF reading path; blocks SL-29)
Spec: docs/kernel-rpc.md §20, §22 (publication gate, contradictions), §90.5

# SL-33 — A re-transcription of the same span is not a contradiction; no duplicate reading of a focus in flight

## Evidence (SL-29A, 2026-09-24, worktree chatrpgv4-wt-pdf-a; module `.coc/modules/book-1/`, both refusals in its `findings.json`; worker logs `.coc/playtests/sl29-a-import/`)
- guidance published the module node's `investigator_hook` with two misreadings of one sentence (卡片 for 车卡, 轰蹭 for 轰趴). Both opening readings read the same page more accurately; the publication gate refused each as "the new reading contradicts a published value", not retryable; the App-style retry failed the same way. About 3 min and 35–50 calls per attempt; whether an import succeeds depends on whether the second reader happens to copy the first's errors.
- When the worker's 120 s foreground wait expired it re-entered preparation and a connection-point repair job (`read-4`, focus `xu-mu`) read the same pages while the first opening reading was still running: 18 calls, 286K tokens, cancelled at exit.
- The player only sees "The preparation stopped before it answered"; the reason stays in the hidden detail.

## Scope
1. Contract first (§22 amendment): two readings of the same source span (same page anchor / evidence span) for one field are the same fact transcribed twice, never a contradiction: the later, reviewed reading replaces the earlier value and records the replacement; a contradiction is a different value from a different span or a claim the book states elsewhere. No word-level comparison, no similarity threshold in code: the rule is structural (span identity); where spans are not recorded, record them.
2. A focus already being read is not read again by a repair or preparation job until that reading settles; the worker's re-entry after the foreground wait attaches to the running job.
3. The player-visible refusal names the field and the reason from `findings.json` (one sentence, data-derived).
4. Tests, mutation-killable, on a fixture PDF the suite owns (two readings of one page differing in transcription; the gate accepts the second); a duplicate-focus test; then the manual check: a fresh module id for 血色公路, the App's worker order through `opening`, reporting stages and calls; stop before `converse`.

## Comments

- **2026-09-24, implementation (claude/sl33-20260924: f4dc99252, 4b9a3bd0c, 8501ee184; merges f1e39ba15, f5a82dcbb).**
  - The gate as it was: `mergeValue` (`kernel-ts/modules/visual.ts:88-108` at 6b12a2e75) threw `needs_choice` "the new
    reading contradicts a published value" for any leaf where a new value neither equalled the published one, unioned a
    list, nor recursed into an object -- no notion of where either value came from. Called from `checkDraft` for known
    ready nodes (:215; a non-ready module node skipped) and claims (:261), and from `assembleVisual` (:493), which is
    where SL-29A's two refusals came from.
  - The rule (contract §22.3.1, amends §22.3): a field's span is the set of original-page anchors `{page, box?}` it was
    read from; two spans are the same when they share an anchor (same physical page and, when both carry a box,
    overlapping boxes). Same span, different value = re-transcription: the draft check adds the pointer to
    `required_review`, and publication replaces the value only if a review covers that pointer (or an ancestor), and
    records `{path, previous, value, source_refs, job_id, generation}` in `module.json` `reading.retranscriptions`.
    Different span = contradiction, `needs_choice` as before, now with both page sets and an actionable fix, refused
    already at the reader's own `check`. No word comparison, no threshold. Spans are recorded where they were not:
    `graph.field_spans` (per field, from the writing reading's refs; equal values union, a replacement takes the new
    refs); an unrecorded field answers with its item's refs. Packet and `task.json` carry `field_spans` in page form.
  - Where it lives: `kernel-ts/modules/transcription.ts` (anchors, same-span, span lookup/recording);
    `visual.ts` `contradiction`/`mergeValue` (:102, :113), the draft-check judge (:246, `unseen` defers only a claim
    whose refs the host task omits), `assembleVisual` recording (:557-566); `reading.ts` packet spans (:796),
    retranscription record (:951).
  - One reading of a focus at a time (§22.2.1): the SL-29A duplicate was not the worker's re-entry (that rejoins its own
    request and key); it was the index publication's read-ahead queueing the way-on repair `read-4` on `xu-mu` while
    `read-3` read `序幕`. `request` now attaches a focused (`opening`, `detail`) request to a *running* reading of the
    same focus (`attached: true`, foreground promoted; `reading.ts:597`), and `claim` serializes by the same identity
    instead of the spelled focus (`:733`). Focus identity = graph nodes named by id/handle/name/alias, else the
    normalized focus (`focusIdentity`, `:497`). A request while the other is only queued still queues (22.2: only
    identical requests merge); owned source preparations keep their own job. The host never cancels an attached job
    (`reading-service.ts:421, :503-509`).
  - Refusal to the player: the host passes `refusal {message, path, rule?, reason?}` (the same record as
    `findings.json`) in `module.read.finish {outcome: failed}` (`reading-service.ts:848`); the kernel keeps it
    (`refusalOf`, `reading.ts:34, :845`) and the blocked request returns it (`:634`); `refusedReading`
    (`reading-service.ts:125, :518`) says `The reading of "<focus>" was refused at <path>: <message>.` branded `said`,
    so the worker emits it instead of `PREPARATION_STOPPED` (§48.2 pointer added).
  - Tests: `tests/extension/same-span-retranscription.test.mjs` (11, emitted kernel, a two-page PDF the test writes and
    binds): same-page re-transcription replaced only through a review naming it, and recorded; different page refused
    at the draft check with both pages; boxes; a recorded span outlives the node's growing refs; an older reading
    cannot write the old transcription back unreviewed; the reader's own offline check (judges nodes, defers task
    claims, honours `field_spans`); repair-by-handle attaches to a running reading-by-name and queues after it settles;
    two queued readings of one focus spelled two ways are claimed one after the other; refusal kept and returned; the
    said sentence; an attached wait's cancellation does not cancel the job. All 11 fail on 6b12a2e75 (the
    first with SL-29A's `needs_choice`). Mutations, each killed: same-span always true; boxes ignored;
    recorded span ignored; re-transcription not required in review; publication ignores review coverage; no attach;
    attach to queued too; focus by spelling only; claim by spelled focus; refusal not kept; module node still skipped;
    host cancels attached; refusal sentence dropped; replacement not recorded; host check never defers; check ignores
    recorded spans. Updated: `test_visual_reading.py::test_a_prepared_summary_cannot_be_silently_replaced` (same page:
    refused until reviewed by pointer; other page: `needs_choice`), and `ts-kernel-modules.test.mjs` asserts the two
    post-freeze changes beside the frozen oracle (oracle bytes untouched).
  - Replay of SL-29A's own drafts (book-1 `read-1` guidance, then `read-3` opening, files copied into fresh attempts of a
    scratch home, emitted kernel): at 6b12a2e75 `read-3` is refused `needs_choice` at
    `/nodes/module-book-1/properties/investigator_hook`, generation stays 1, `assembled`; on this branch it publishes
    generation 2, `opening_ready`, `installed`, with one `retranscriptions` row (卡片→车卡, 轰蹭→轰趴, pages 6, 7, 8, 16).
  - Manual check, 血色公路 (111 pp), the App's worker order (`inspect` → `guidance` → `opening`, built worker spawned as
    `runtime/preparation.ts` does, App grok login in the worktree's agent home, Jev key from the vault,
    `grok-build/grok-4.7-build-fast` low, zh-Hans), fresh home `.coc/playtests/sl33-import-2/home` on 4b9a3bd0c (SL-33 +
    SL-28); stopped before `converse`:

    | step | wall | stages | model calls (reader+review), tokens | outcome |
    |---|---|---|---|---|
    | inspect | 1.0 s | bind | 0 | fresh registration (`book-1` of that home), 111 pages |
    | guidance #1 | 68 s | read r1 26.6 s, read r2 39.9 s, both failed | 7+0, 8.4K in | provider `Connection error.` both rounds; generic stop (no gate refusal, so no sentence -- as designed) |
    | guidance #2 (App retry) | 84 s | read 63 s → verify 1 unit 20 s | 3+2, 74.5K in / 7.1K out | ready, key `d333f169…`, scene 序幕, gen 1 |
    | opening | 178 s | read 55 s → verify 8 units 47 s → read r2 31 s → verify 44 s | 9+16, 371K in / 32K out | ready, `opening_ready`, `installed`, gen 2 |

    Round 2 of the opening repaired a reviewer-contradicted `dramatic_question`. This time neither reader redrafted the
    module node differently, so no re-transcription arose live (`retranscriptions` absent) -- the replay above is the
    evidence for that path. No duplicate reading: the only other job after the opening published was the read-ahead's
    `detail` prefetch of `abattoir`, cancelled when the worker exited. An earlier run on f1e39ba15 (before SL-28):
    guidance 158 s (11 calls, 167K in), opening 223 s (48 calls, 817K in), ready, no re-transcription either.
  - Suites (leehow-pc): ext 2968/2968 @8501ee184; loop 152/152 @4b9a3bd0c; py 1719 passed, 2 skipped @4b9a3bd0c (nothing
    after 4b9a3bd0c touches code). An earlier ext run showed 31 failures that were my own doing: ext and py launched
    together on the same box worktree, and py's rebuild of `build/` pulled Pi out from under ext.
  - Not covered by a test: that `reading-service.ts` copies `job.field_spans` into `task.json` (removing it only makes the
    reader's check fall back to node refs; publication is unaffected).

