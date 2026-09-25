Status: ready (filed 2026-09-25 from the 血色公路 batch-7 table; batch 8)
Stage: SL-56 (P1, in-play reading on PDF modules; the NPC face of SL-47)
Spec: docs/kernel-rpc.md §22.4.7 (SL-47 scene text lands on the index), §11.5.4 (SL-51 persons from carried text), §22.4 (`requireMaterial` for names), the reading wait

# SL-56 — NPC material never holds a turn: a resolve or act on a person whose detail read is pending lands on what the book's text says, the record lands later

## Evidence (ticket 29 batch-7 entry, `claude/sl29a-b7-20260925`@cde26d84; campaign `sl29ab7-xuese-0445`, job `read-5`)
- t10 124.5 s and t11 131.4 s: a `resolve` targeting an NPC whose own `detail` read (`read-5`) never completed was refused `material_pending` and the turn waited the full `reading_timeout` cycle, twice for the same job; the prose was still delivered (SL-37 holds). SL-47 gave scenes an index-level landing; `requireMaterial` for a person still holds the turn until the person's record is read.

## Ruling (owner, 2026-09-25)
The umbrella rule ("reading never holds a turn") covers persons: a write or check that names a person the index or the carried text names (SL-51's `from_passage` shape) lands on that text; the person's detail read continues on a blocking slot and the record lands on a later note; the foreground wait remains only for a person the book's text nowhere names.

## Scope
1. Contract: §22.4.7 addendum (persons) with a cross-reference from §11.5.4; the `pending` row names the person.
2. `requireMaterial` (`kernel-ts/modules/reading.ts`) for name-typed material: when the index or the carried passages name the person, do not throw; register provisionally as SL-51 does and queue the detail read as blocking; fold the record on landing (replacing the provisional entry once, SL-51's path).
3. Tests, mutation-killable: a resolve on a person named by the index lands and carries the passage; the record lands on the next turn once; a person named nowhere still waits; then the replay of the b7 table's t10 (recorded Keeper, live reader) reporting the wall.

## Comments
