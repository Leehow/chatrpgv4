Status: ready (filed 2026-09-24 from SL-45's replay; next batch)
Stage: SL-47 (P1, in-play reading on PDF modules)
Spec: docs/kernel-rpc.md §22.4 (the foreground wait), §22.4.3/§22.4.5/§22.4.6 (reading never holds a turn), §14.16 (index passages); docs/specs/pi-native-single-loop.md ruling "Reading never holds a turn"

# SL-47 — A scene's text read outlasts the foreground wait: the move lands on the index's text, the detail lands when read

## Evidence (SL-45 replay of the batch-4 血色公路 table's t18, `claude/sl45-20260924`@5c5c2a13a, ticket 45's Comments)
- With the lease fixed (SL-41) and the slot given at once (SL-45), t18 still walled 141.7 s in every arm: one `detail` read of the bar scene plus its review takes 98–118 s with the reader's thinking off and longer with it on, against the 120 s foreground wait; the move was then refused `reading_timeout` and re-sent. On the live table t17/t18/t20 were 147/240/149 s. No sub-location discovered in play was entered in 20 turns.
- The book's per-page text is already extracted at import (the index; §14.16 passages ride in the carried view). The detail read adds the reviewed scene record (exits, people, things, clues).

## Ruling (owner, 2026-09-24)
The umbrella rule applies to text too: a move into a scene whose detail is not yet read lands on the index's passages for that scene (the Keeper narrates from the book's own text, carried once), the detail read continues in the background with a blocking slot, and the reviewed scene record lands on the next turn's note; the Keeper is told what is not yet known (exits, people) and does not invent it. The foreground wait remains only for a scene with no index text at all.

## Scope
1. Contract: §22.4 amendment (new subsection): the text gate is index-level; the detail is delivered late like a map (§107.1) and an answer (§22.4.3); the note's `pending` row names the scene.
2. `kernel-ts/apply/index.ts` (`requireMaterial` for the move's destination) and the host's reading wait: land with passages, queue the detail as blocking, fold the record on the next turn.
3. Tests, mutation-killable: a move into an unread scene with index text lands and carries the passages; the detail lands on the next turn once; a scene with no index text still waits; then the replay of t18 reporting the wall.

## Comments
