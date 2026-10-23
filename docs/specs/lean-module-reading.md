# Lean module reading: bounded readers, source blocks and a sectioned skeleton

Status: ready-for-agent

Contract: `docs/kernel-rpc.md` §262 (written by ticket 01). Owner thread "模组解析消耗审查" (2026-10-23): the owner
asked why one Blood Road read costs 60–120M tokens when the whole book is ~100K tokens, and asked for a redesign
co-reviewed with web GPT, then implemented and sandbox-tested. Review record (two rounds, raw):
`~/leehow/code/module-graph-lazy-docs/gpt-review-r1.md`, `gpt-review-r2.md`; cost evidence:
`~/leehow/code/module-graph-lazy-docs/design-v1.md` §1.

## Problem Statement

A reference book (one bound through §261 page-open, e.g. Blood Road, 111 pages) is read in the background as 56
two-page `referenceSourceUnits`, streamed unconditionally by `queueAheadReading` for as long as a kernel is alive.
Each unit is a full reader child that reads a ~65KB task.json in three chunks (it exceeds `READER_INLINE_BYTES`),
views the pages, writes the draft, then resends ~80K tokens of context on every check/edit/submit; the draft is split
into review units, each its own vision reviewer child (up to 40 in parallel), plus two person-state children, plus
targeted/full repair rounds. Measured on four runs: 1.2–2.1M tokens per two-page unit, 58–117M per book, ~88% of it
cache reads of the same prefix. On 2026-10-23 three playtests that had ended kept streaming the book and spent 60% of
the day's MiniMax quota after play stopped.

The work the book needs is small: its native text is ~110K non-space characters. What costs is the shape: fixed
two-page windows, an unbounded agent loop, a large resent packet, and a review fan-out that re-reads every page.

The review also found correctness gaps that a cheaper reader must not widen (GPT review r1/r2, checked on the PDF):
- p20: Steve Brown's Keeper note ("unless there is ironclad evidence, any related roll needs a Hard success before he
  will listen") runs from the bottom of the left column to the top of the right column; native text emits the Keeper
  boxes after the body text, so page order alone loses the continuation. The gate has an *unless* (an exception), not
  an *and*. Name-in-span string checks would refuse the correct reading and accept a wrong owner.
- p13 (Keeper background: the reverend has Russ stall the car repair) and p76 (event timeline) carry facts the Esso
  station scene needs; a scene-local read alone loses them.
- p18–19 are maps with no text layer; "no text" is not "no material".

## Solution

Keep the graph contract, the publication gate, the material entry points (`requireMaterial`, `lookup`,
`queueSceneExhibits`, adjacent reads) and every play-time consumer unchanged. Replace what runs behind them:

1. **No background stream for reference books.** Under lean reading, `queueAheadReading` asks no
   `referenceSourceUnits`, and a claim never starts a queued `source_unit` job. Material is read when play asks for it.
2. **Source blocks (L0).** The host builds a deterministic layout index from pdfjs text items: lines grouped by
   column, font height and gap into blocks, ordered by column then position, Keeper boxes kept as their own blocks.
   Each block has a stable id, page, bbox, column, order, raw text and hash; image-only pages get one image-region
   block. Cached per document and layout version next to the page cache. No semantics.
3. **Sectioned skeleton (L1).** Once per book, in the background, the host partitions the blocks at bookmark
   boundaries into sections of ≤ 12K tokens and runs one bounded reader per section. Each writes only names (entity
   mentions with block ids), cross-section reference candidates, conditional events and Keeper-truth candidates. The
   host merges them into `skeleton.json` (aliases unified, unresolved names kept unresolved, per-section coverage
   `indexed`/`failed`, image-only pages `image_only`). A missing row is never `absent`. Table open never waits for it.
4. **Bounded detail reader (L2).** A lean detail read inlines its pages' blocks (text with block ids), the skeleton
   rows that cite its entities from other sections (with their block text: e.g. p13 for Russ), and a compact roster
   (id, kind, name, aliases) instead of `known_nodes`/`known_claims` dumps; the task fits `READER_INLINE_BYTES`. One
   round, at most 6 requests, tools `read,write,edit,pdf,submit_reading` (pdf for image or uncertain pages). On a
   refused check after its requests, the job fails with its findings; there is no second full round.
5. **Lean review.** The per-unit vision review, person-state double read and repair rounds are replaced by:
   - host checks (no tokens): every `source_refs` page is one the reader was given; every exhibit `surface.text`
     marked verbatim occurs in the blocks of its cited pages (whitespace-normalised); claim subjects/objects resolve.
   - one bounded semantic verifier per job over the high-risk records only: claims of `knows`, `uses-rule`,
     `discoverable-at`, any claim or node property carrying a condition/gate/threshold, Keeper-only truth on a node,
     and exhibits (player safety). Its input is each candidate plus the blocks it cites (and their neighbours); its
     answer per candidate is `supported | unsupported | uncertain` with a reason, written as review rows.
   - `unsupported` and `uncertain` records are pruned from the draft before publication (an uncertain gate is not
     compiled); the prune is recorded as a `source_need` (`deferred`) so the Keeper can still read the original
     pages. Everything else gets a host review row. The existing gate (`checkReview`) then publishes as today.
6. **Hard budget and lifecycle.** A module's background reading stops asking once its recorded spend reaches
   `PI_COC_READING_CAP_TOKENS` (sum of input+cache read+output); the cap is recorded and visible in telemetry.

Lean reading is on by `PI_COC_LEAN_READING=1` (and the launcher's setting); the old path stays for comparison until
the sandbox comparison passes, then lean becomes the default.

## User Stories

1. As the owner, a 111-page book costs on the order of 1–3M tokens to play through, not 60–120M.
2. As the owner, a table whose players stopped reading stops spending: no background stream, a hard cap.
3. As a player, the table opens as fast as today (§261 page-open is unchanged) and the first scene's material is
   ready without waiting for the book.
4. As the Keeper, when the investigators reach Esso station I have Russ, Nate and Steve with the right Keeper notes,
   and Russ's stalling instruction from p13 is attached to Russ, not lost.
5. As the Keeper, Steve's listening gate is Steve's, reads "unless ironclad evidence", or is absent and the original
   page is offered — never attached to Russ and never compiled as `all(evidence, hard)`.
6. As the Keeper, asking about a far place reads it on demand, whether or not the skeleton is finished.
7. As the author, exhibits I receive are the book's words (host-checked) and safe for the players.

## Implementation Decisions

- **Shape of model work (Agents.md single-completion rule).** Section skeleton, detail reader and verifier are all
  tool-carrying pi children (`runtime.runTask({kind:'reader'})`) with inlined input, `maxRequests` bounds and a file
  answer — the §261 page-open shape. No new zero-tool lane.
- **Budgets (first experiment).** Skeleton section: source ≤ 12K tokens, ≤ 4 requests, answer ≤ ~3K. Detail reader:
  source ≤ 12K tokens, ≤ 6 requests. Verifier: candidates + cited blocks ≤ ~6K tokens per batch, ≤ 3 requests,
  ≤ 12 candidates per batch.
- **Source blocks** are computed by the source worker (`sourceBlocks`, same document owner and validation as
  `sourceLines`), cached as `<pdf dir>/cache/blocks-<layout_version>-<sha>.json`. Block ids:
  `b<page>-<order>-<hash8>`. A page whose text layer is empty is `image_only`. Layout is geometry only.
- **Skeleton file** lives in the module's work tree (`skeleton.json`), is host-written, never published as graph
  material, and is consumed only as reader input. It records per section `status`, `blocks`, `usage`.
- **Pruning instead of refusal.** Lean review never makes `checkReview` refuse a whole job for one bad record: it
  removes the record and every claim that names a removed node, then writes rows only for what remains. A node root
  the verifier rejects is removed with its claims; if the job's focus node itself is removed, the job fails.
- **Accounting.** Every lean child records `lane:'reading'` rows with `phase` (`lean-read`, `lean-verify`,
  `skeleton`), `usage` and the job key, so per-scene token cost is a sum over one focus.
- **Not changed:** §261 page-open and opening readiness; `answer` lookups; transcripts; identity jobs; visual scans and
  map scope; the graph contract and the claim fields (`truth_status`, `visibility`, `known_by_ids`, `validity`); §258
  runtime records.

## Testing Decisions

- Unit (node --test, single files): block layout on a fixture page reproducing p20 (left body, left Keeper boxes,
  right-column continuation) and an image-only page; skeleton merge (alias unification, unresolved kept, coverage);
  lean review (host verbatim check, pruning, rows accepted by `checkReview`); aheadReading asks no reference units
  under lean; cap stops background asks.
- Sandbox on the owner's Mac (MiniMax M3.1 Flash, fallback DeepSeek v4.1 via opencode go), Blood Road, cap set,
  every process stopped at the end: tokens per focus (Esso station, Steve, Red Road, a far place), table-open time,
  and the 30-row golden set from GPT r2 (G01–G30) checked by hand against the produced graph, G21 first.
- Old vs lean on the same foci, with cost split by job kind (index/opening/detail/verify/answer/repair).

## Out of Scope

Cross-page logical flow reconstruction; map topology extraction; full-book §258 precompute; a new KP tool;
predictive prefetch; changing `answer` lookups; the graph schema.

## Further Notes

GPT r2's golden set and probe list are the acceptance truth candidates; they must be confirmed against the PDF before
freezing. Phase 2: answer lookups on blocks; skeleton rows offered to the Keeper as navigation; prefetch.

## Comments
