Status: ready-for-human (worked 2026-09-26 on `claude/sl83-20260926`, head `1e57df6ea`, off `claude/integ-single-loop-2-20260926@f34ee2a51`; filed 2026-09-26 from SL-77's report; batch 14)
Stage: SL-83 (P2, SL-76 follow-up: the shadow pairing for `npc_reaction`)
Spec: docs/specs/jev-driven-steps.md D4; docs/kernel-rpc.md §135.32; `runtime/jev/hybrid-engine.ts` `keeperDidFor`; SL-77's `tests/play/jev-steps-report.py` (`corrected_npc_reaction` shows the fix's effect)

# SL-83 — `keeperDidFor` compares the `npc_reaction` candidate's display label ("Vittorio Macario") with the first-impression receipt's handle (`vittorio-macario`): it can never pair

## Evidence (SL-77 on gates #14/#15)
- `npc_reaction` agreement 0/4 and 0/2 raw. Every cleared row is a real engagement (t6 the sanatorium visit, t7 Gabriela addressed by name; the compile's own `addressee` feature at 1.0 on one). t6's receipts DO carry `roll decision: natural-npc:first-impression, npc: vittorio-macario` — the pairing missed it because it compared the label. With label→handle resolution through the turn's own `person` receipts the agreement is 3/6 = 0.50 (#14) and 3/5 = 0.60 (#15).
- `clue_follow_up` pairs by handle and is clean (6/6, 6/6).

## Ruling
The candidate carries the NPC's handle (it is built from the roster/graph node) and the pairing compares handles, never labels; the label stays on the row for humans. Also count, for the report, the Keeper's `say`/speech to the same handle as `other` (it engaged but did not roll), so a definitional miss (the Keeper simply never stages a first impression) is separated from a pairing miss.

## Scope
- `runtime/jev/hybrid-engine.ts` `keeperDidFor` (+ the candidate's `bound.target` = handle, label in `label`); tests: a first-impression receipt on the handle pairs `true`; a label-only comparison is the mutation; a speech to the handle pairs `other`.
- Re-run `tests/play/jev-steps-report.py` on #14/#15 after the fix and paste the corrected tables into SL-77.

## Comments

### 2026-09-26 — implemented, `1e57df6ea`

**Where the two sides were made.** The kernel writes both. `kernel-ts/read/mods.ts` `modContext` built each
`pending_contacts[]`/`relationships[]` row with `target: graph.displayName(npc)`; `kernel-ts/mods/resolve.ts` writes
the first-impression `roll` receipt with `npc: graph.handle(target)`. Nothing in between could make them equal.
`clue_follow_up` is the template because the kernel already hands the candidate builder the clue's handle
(`apply.options.candidates[].effect.clue`) and writes the same handle on the `clue` receipt.

**What landed (three layers, one test each, each test killed by reverting its own layer by copy):**
- `kernel-ts/read/mods.ts`: every `pending_contacts[]` and `relationships[]` row carries `handle: graph.handle(npc)`
  beside the display-name `target`. pytest `test_pending_contact_carries_the_handle_the_first_impression_receipt_carries`
  (`tests/kernel/test_mods.py`) reads the capsule row, runs the first impression, and asserts the roll receipt's `npc`
  equals the row's `handle`, then that the settled `relationships[]` row carries the same handle. Reverting: `KeyError: 'handle'`.
- `runtime/jev/consequence-candidates.ts` `npcReactionCandidates`: `key` and `bound.target` are the handle
  (`graph.resolve` matches a handle exactly, so `on` mode's `resolve` gets the same identifier); `label` and the Noul
  keep the display name, and the handle never reaches the Noul. The withholding checks (`guards.people`,
  `preordained`) stay on the display name because `kernel-ts/read/obligations.ts` names people that way. A row
  without `handle` falls back to `target`. Tests in `tests/extension/consequence-candidates.test.mjs`. Reverting: the
  key test fails.
- `runtime/jev/hybrid-engine.ts` `keeperDidFor`: handle to handle; a display-name `target` (a row from a kernel
  older than this fix) is resolved through the turn's own `person` receipts (`name` → `who`) before the comparison;
  one no receipt this turn names reads `other`/`false` as a stranger would. Tests in
  `tests/extension/consequence-shadow-gate.test.mjs` (label target + handle receipt + person receipt → `true`;
  without the person receipt → `other`). Reverting: the label test fails.
- Contract §135.32 and design D4 say the pairing compares handles; `tests/play/jev-steps-report.py` knows both
  row shapes (its `corrected_npc_reaction` equals the raw figure on a table played after this fix).

**Before/after on the same two tables (read-only; the stored rows are unchanged, the fixed `keeperDidFor` was
replayed over each row's key and its turn's receipts):**

| table | rows | raw `keeper_did` (old build) | fixed, handle on the row | fixed, name-only row (fallback) |
|---|---|---|---|---|
| gate #14 `longgate14-haunting-0505` (21 turns) | 9 | true 0 / false 4 / other 5 = **0/4** | true 3 / false 3 / other 3 = **3/6 = 0.50** | 3/6 |
| gate #15 `longgate15-haunting-0538` (finished since SL-77's snapshot: 21 turns, same 7 rows) | 7 | true 0 / false 2 / other 5 = **0/2** | true 3 / false 2 / other 2 = **3/5 = 0.60** | 2/4 |

Exactly SL-77's prediction. The one row the fallback cannot reach (gate #15 turn 7, Gabriela Macario: her
`person` receipt is in turn 6, the roll in turn 7) is why the handle belongs on the row and the fallback is only for
rows an older kernel wrote.

**Not done, and why.** The ruling's second line — count the Keeper's `say`/speech to the same handle as `other` —
has no receipt to read: speech is not a receipt (the receipt kinds on these two tables are `definition, roll, move,
clue, person, time, npc, threat, flag, item, cash, handout, map`), and `keeperDidFor` reads receipts only, by design
(never a model-origin call's arguments). Separating a definitional miss from a pairing miss that way needs a speech
record the pairing can see; owner's call whether that is worth a receipt. The live `mod_contact` candidate
(`runtime/jev/candidates.ts`) still keys by display name, unchanged per this ticket's own scope and SL-02.

**Suites (leehow-pc, `remote-test.sh`, HEAD `1e57df6ea`).**
- `== ext on leehow-pc @ 1e57df6ea6c63dc2c4946bc207726512e9f4f714: exit=0 wall=187s` -- 3270 tests, 3270 pass, 0 fail.
- `== py on leehow-pc @ 1e57df6ea6c63dc2c4946bc207726512e9f4f714: exit=0 wall=20s` -- `tests/kernel/test_mods.py`,
  `test_scene_obligations.py`, `test_read_projections.py`: 70 passed.
