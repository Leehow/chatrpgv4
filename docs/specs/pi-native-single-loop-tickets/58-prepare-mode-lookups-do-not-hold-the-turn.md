Status: ready (filed 2026-09-25 from the 血色公路 batch-8 table; batch 9)
Stage: SL-58 (P1, in-play reading on PDF modules; the last foreground read without an allowance)
Spec: docs/kernel-rpc.md §22.4.3 (SL-36 answers), §22.4.7 (SL-47 scenes), §22.4.7.1 (SL-56 persons), §22.4 (`prepare`)

# SL-58 — `lookup kind=source source_mode=prepare` gets the same allowance and landing as an answer: never the full reading timeout in the foreground

## Evidence (ticket 29 batch-8 entry, `claude/sl29a-b8-20260925`@4b5664fd0; campaign `sl29ab8-xuese-0512`)
- Three `lookup {kind: "source", source_mode: "prepare"}` calls (t4, t7, t20) each blocked exactly 120,003 ms (`reading_timeout`), 360 s of the table's wall (29%). `answer` mode held perfectly (5 of 5 at 8,002 ms, SL-36); `prepare` mode has no allowance, no `pending`, no landing.

## Ruling (owner, 2026-09-25)
The umbrella rule covers every in-turn read the Keeper can raise: a `prepare` consultation gets the source-answer allowance, returns `pending` with what the index holds, continues in the background on a blocking slot, and lands on a later note once; the foreground wait exists only for a scene's or person's text the book nowhere has.

## Scope
1. Contract: §22.4.3 addendum for `prepare` (allowance, pending row, landing, memo by focus).
2. `extensions/kernel/source-answers.ts` / the lookup path: route `prepare` through the answer machinery (or unify the two modes if they differ only in purpose); telemetry names the mode.
3. Tests, mutation-killable: a prepare lookup past the allowance returns `pending`; its result is carried once on a later note; then the replay of the b8 table's t4 (recorded Keeper, live reader) reporting the wall.

## Comments
