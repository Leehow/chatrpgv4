Status: ready (filed 2026-09-24 from the 血色公路 batch-5 table; batch 6)
Stage: SL-49 (P1, reading publication)
Spec: docs/kernel-rpc.md §22 (review, publication gate), §22.3.1 (SL-33 same-span), §90.5

# SL-49 — A reviewer's disagreement on one field is a recorded conflict; it does not refuse the scene's record

## Evidence (ticket 29 batch-5 entry, `claude/sl29a-b5-20260924`@dd58f89c9; fork under `/Users/haoli/leehow/code/chatrpgv4-wt-sl29a-b5/.coc/playtests/sl29a-b5/home/.coc/module-campaigns/<campaign>/modules/book-1/` `deepen-queue.json` and `findings.json`, verbatim refusal kept)
- `last-stop`'s detail read reached its own pages (25–30) in both attempts and was refused at review with `reading_failed`, `visual review did not support ['/nodes/4', …]`: the reviewer judged a detail's `delivery_kind` to be `skill_check` where the reader wrote what the book's wording gives the Keeper. One classification field, disputed, and the whole scene record (exits, people, things, clues) never published; the bar plays on the arrival text alone. Same shape as SL-47's replay (both rounds refused, reason then lost).
- Independent of any budget (SL-41 fixed those); a second content-level refusal class after SL-33's same-span.

## Ruling (owner, 2026-09-24)
The review gate refuses a record for what is not in the book (a fabricated node, a span that does not say it), never for a disagreement about how a supported fact is classified. A field the reviewer disputes is published with the reader's value and a `contested` mark carrying the reviewer's reason; the Keeper sees the mark; a later reading may settle it.

## Scope
1. Contract first: §22 amendment (new subsection): the review verdicts per field (`supported`, `contested`, `unsupported`); only `unsupported` on a fact field refuses; classification fields (`delivery_kind` and its kin, listed by the schema not by name in code) can only be `contested`.
2. `extensions/module/reader-review.ts` and the kernel's publication check: publish with `contested` marks; the refusal text names the field and the reason only when a fact is unsupported.
3. Tests, mutation-killable: the bar's recorded review (from the fork) publishes the record with one contested field; an unsupported fact still refuses; the Keeper's carried scene record shows the mark. Then the replay of the b5 table's t17 with the recorded review.

## Comments
