# Lean module reading: tickets

Spec: `docs/specs/lean-module-reading.md`. Contract: `docs/kernel-rpc.md` §262.

Task graph: 01 first; 02 and 03 in parallel; 04 after 02; 05 after 02 and 04; 06 after 03 and 05; 07 last.

## 01: §262 contract and the lean switch

**What to build:** §262 in `docs/kernel-rpc.md` (blocks, skeleton, lean detail read, lean review, cap); the
`PI_COC_LEAN_READING` switch read once by the host and passed to the kernel's read-ahead as `lean: true`.

**Blocked by:** None.

**Status:** ready-for-agent

- [ ] §262 documents every file, field and limit named in the spec.
- [ ] With the switch off, every existing reading test passes unchanged.

## 02: Source blocks

**What to build:** `sourceBlocks` in the source worker: pdfjs text items grouped into lines and blocks by column,
font height and vertical gap, ordered by column then y; image-only pages give one image block; cached per document and
layout version.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] A fixture page shaped like Blood Road p20 yields its left-column body blocks, its three Keeper-box blocks in
      column order, and the right-column continuation as the first right-column block.
- [ ] Ids are stable across two runs and change with the layout version.
- [ ] A page with no text layer yields one `image_only` block.

## 03: No background stream; the reading cap

**What to build:** under `lean`, `queueAheadReading` asks no `referenceSourceUnits` and a claim skips queued
`source_unit` jobs (cancelled with reason `lean_reading`); background asks stop at `PI_COC_READING_CAP_TOKENS`.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] A reference book under lean queues no `source_unit` job at table open or move.
- [ ] Queued `source_unit` jobs from an earlier kernel are cancelled, not run.
- [ ] A module whose recorded spend reaches the cap gets no further background asks; foreground asks still run.

## 04: The bounded detail reader

**What to build:** the lean executor for `detail` jobs (not visual scans, map scope, identity, answer): inlined
blocks, cross-section skeleton rows, compact roster; one round, ≤ 6 requests; check failure fails the job with
findings.

**Blocked by:** 02.

**Status:** ready-for-agent

- [ ] The brief inlines the task (under `READER_INLINE_BYTES`) and never asks the child to read task.json.
- [ ] `observations.read_pages` are the pages whose blocks were inlined plus any page the child viewed.
- [ ] A refused check after the last request fails the job; there is no round 2.

## 05: Lean review

**What to build:** host checks, one bounded verifier per ≤ 12 high-risk candidates, pruning of unsupported and
uncertain records with a deferred `source_need`, host review rows for the rest; the existing gate publishes.

**Blocked by:** 02, 04.

**Status:** ready-for-agent

- [ ] A verbatim exhibit whose text is not in its cited blocks is pruned without a model call.
- [ ] An `unsupported` claim is pruned; the rest publishes through `checkReview` unchanged.
- [ ] No vision review unit and no person-state child runs on a lean job.

## 06: Sectioned skeleton

**What to build:** sections from bookmarks over blocks (≤ 12K tokens), one bounded reader per section, host merge
into `skeleton.json`; lean detail reads receive the rows that cite their entities from other sections.

**Blocked by:** 03, 05.

**Status:** ready-for-agent

- [ ] Merge unifies aliases, keeps unresolved names unresolved, records per-section coverage; image-only pages are
      `image_only`, never absent.
- [ ] A detail read of Esso station receives the p13 rows naming Russ.
- [ ] Table open does not wait for the skeleton.

## 07: Sandbox comparison on Blood Road

**What to build:** nothing new; run lean and old on the same foci with the cap set, then a short real table.

**Blocked by:** 06.

**Status:** ready-for-human

- [ ] Tokens per focus, by job kind; table-open time; GPT r2 golden set G01–G30 checked by hand (G21 first).
- [ ] Every test process stopped at the end; no background reading after the table closes.
