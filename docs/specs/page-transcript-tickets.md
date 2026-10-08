# Page transcripts — tickets

Spec: `docs/specs/page-transcript.md`. Contract: §191. Owner 2026-10-07 (see the spec's Status). Integration branch
`claude/page-transcript-20261007`; worker branches `claude/page-transcript-20261007-{producer,window,readers}`.

Same rules as every ticket: contract first (§191 is the shape; a mismatch is settled by the contract); the Python kernel is
retired, only `kernel-ts/` is maintained; English system language, no CJK in code or prompts; no layout rule, column
threshold, font-size heading or regex classification in code (the layout is the agent's; the host only places lines and
checks the permutation); single test files locally, full suites on the LAN box by the lead; a mutation-killed test per
product change; tests through the real entry (`runtime/host.ts` operations, `ReadingService`, `module.read.ahead`).

## PT-01 Producer: lines, the layout child, assembly, the store (§191.1-191.4, 191.6, 191.9)

Status: ready-for-agent

- `extensions/module/source.ts` `sourceLines` (+ `runtime/host.ts`, `runtime/tasks.ts`, `runtime/source-worker.ts`
  plumbing, mirroring `sourceText`).
- `extensions/module/page-transcript.ts`: grammar parse, normalization, repair set, products, the permutation invariant
  (pure functions, no I/O).
- `extensions/module/transcript-store.ts`: home store + seed read-through, record schema, exclusive claims, staleness.
- `extensions/module/transcript-service.ts`: `ensure`, queue (foreground first), background reader slots, `runTask`
  layout children with `deps.model()`, repair attempt, budgets from `host-budgets.json` `transcript`
  (`runtime/jev/host-budgets.ts` reader with coded fallbacks), telemetry rows.
- `content/setup/page-transcript.md`: the agent instructions (start from the probe's `instructions.md`; add the repair
  note and the drop-range form).
- `extensions/module/index.ts`: construct the service beside `ReadingService` (no consumer wiring here).
- Tests (`tests/extension/page-transcript*.test.mjs`): grammar and normalization table; the invariant refuses a record
  that loses or duplicates a line; a fake child that leaves lines out gets one repair, then `unplaced`; the store is
  reused across two module ids of one digest and a seed is read through; two concurrent `ensure` produce one child;
  `mode: off` produces nothing; mutation: drop the invariant check → the refusal test fails.

## PT-02 The window names the transcript pages (§191.5)

Status: ready-for-agent

- `kernel-ts/modules/chapters.ts` / `kernel-ts/modules/reading.ts` `queueAheadReading`: `window.transcript` ranges
  (whole / chapters with reachable scenes' chapters / pages), the `max_window_pages` cap read from the same budget data
  the kernel already reads for `reading` (or passed by the host in `module.read.ahead` params if the kernel cannot read
  that file -- decide by the existing `whole_book_max_pages` path and record it).
- Tests: a chaptered book whose focus scene exits into a scene of a later chapter lists that chapter before the next
  chapter; a short book lists the whole book; a starter has no field; the cap keeps the anchor chapter whole; pytest
  `tests/kernel` and/or `tests/extension` per where the read-ahead is already tested.

## PT-03 Readers (§191.7)

Status: ready-for-agent (after PT-01 lands on the integration branch)

- `sourcePageText` host operation; `ReadingService.sourcePages` (layer + markdown); `readAhead` calls
  `transcripts.ensure(window.transcript)`; foreground `ensure` from landing, consultation and need reads.
- Jev source driver (`runtime/jev/source-reader-driver.ts`) navigation texts; window places `firstLines`.
- `reader-pdf.ts` search and the prescreen literal search over transcripts (+ image text, labelled).
- Prescreen catalog per layer (`runtime/jev/native-source-catalog.ts`, `prescreen-source-provider.ts`): resource ids and
  the checkpoint carry the layer.
- Tests: landing text comes from the transcript when one exists and from native text otherwise, without waiting; a
  search finds a phrase that only image text holds and labels it; a consultation checkpoint taken on the transcript layer
  stays `current` when re-read; the pinned shape tests (`source`, `jev-source-text`, `claim-support`,
  `prescreen-source-materials`, `window-places`, `jev-native-source-catalog`) stay green.

## PT-04 The built-in book (§191.8) — lead

Status: ready-for-human

- `scripts/build-source-transcripts.ts`; run it on `content/starters/the-haunting/source.pdf`; commit the 17 records;
  README note in `content/starters/the-haunting/README.md`.

## PT-05 Corpus through the product path (TR-A, TR-B) — lead

Status: ready-for-human

## PT-06 Real table (TR-C) — lead

Status: ready-for-human

## PT-07 Gates, merge to 0.9.7a, package — lead

Status: ready-for-human (ext/loop/py/electron on the box; merge only green; package from a clean worktree at the merged head)
