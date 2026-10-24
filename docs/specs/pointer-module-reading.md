# Pointer reading: the host owns the book's words, models give pointers

Status: slice 1 implemented (contract `docs/kernel-rpc.md` §263). Design: owner project file `模组解析设计-v2.1.md`
(two external review rounds, 2026-10-24). History and root cause: project file `解析历史与根因.md`.

## Problem Statement

Module reading kept swinging between a thick graph (the model copies the book into nodes: 58–117M tokens for a 111-page
book) and a thin skeleton (every content need re-reads pages with a reader: 150–550K tokens and minutes each, or the
Keeper invents). Finding, understanding and permitting disclosure of book content were one step, and book content could
only be re-told by a model, so every fetch was a reader session and every feature added its own background reading lane.

## Solution

The host keeps the book's words (layout blocks, byte-range refs). One background pass of tool-free calls writes a
sparse pointer index (entities and the uses of their blocks, Keeper truth, protected facts, release candidates). A
release check certifies candidates against the protected facts. At play, released words in scope are issued to the
Keeper as `source_N` and handed to the author by reference (and automatically for a person's first look and a place's
first description); the book's plans and the Keeper's bounded evidence window reach the Keeper only. The author never
receives a testimony's stance. Transcript, scene-exhibits and arrival-map readers no longer run by default.

## Tickets (design W01–W12)

| Ticket | State |
| --- | --- |
| W01 SourceRef | done (§263.1) |
| W02 Evidence units and continuations | done for index-proposed continuations (§263.2) |
| W03 Sparse index and protected facts | done (§263.3; six-thousand-token sections, halves, page by page) |
| W04 Static release check | done (§263.4) |
| W05 Permit and revocation | done as the per-turn catalog plus `revoked` (§263.5) |
| W06 Author projection | testimony stance removed, `delivery` added (§263.6); free-text channels not yet audited |
| W07 Scene working set | book truth and evidence window (§263.10); the opening pages still ride whole |
| W08 Mechanics cards | not done: the lean detail read still writes cards when asked |
| W09 Reading ledger | partial: caps, per-lane telemetry, no idle stop yet |
| W10 Slice acceptance | four live Blood Road tables, 2026-10-24 |
| W11 Whole-book recall | not run against G01–G30 |
| W12 Continuous play and an English book | not run |

## Testing Decisions

`tests/extension/pointer-reading.test.mjs` (refs, index lists, merge, release statuses, scope, auto handover, book
truth, evidence window); updated `lean-reading`, `exhibit-reveal`, SL-00 inventory. Live: MiniMax-M3.1-Flash/medium,
real driver, one input per turn.
