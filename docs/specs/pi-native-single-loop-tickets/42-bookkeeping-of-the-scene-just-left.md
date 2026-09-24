Status: ready-for-human (filed 2026-09-24 from SL-38's replay; batch 4, blocks the next long gate; implemented 2026-09-24 on `claude/sl38-20260924`)
Stage: SL-42 (P1, admission/kernel; follows SL-38)
Spec: docs/kernel-rpc.md §135.30.5 (SL-38), §32.12.3, the `not_here` refusal (apply clue/handout/item locality), scene trail

# SL-42 — The Keeper's bookkeeping for the scene the party left this turn is accepted at that scene

## Evidence (SL-38 replay of long gate #3 t1, `experiments/single-loop-routing/results/sl38-longgate3-t1-after`)
- With SL-38 the compile selects the research-leads clue then the move to the Globe, both admitted at 0 ms, before the Keeper's first step. The recorded Keeper's first batch (the keys clue `knott-keys`, the $20, the key item, the commission handout) was then refused `not_here` in 3 of 3 runs: the party was already at the morgue and the kernel refuses a clue located in a scene the party has left. In the before arm the whole accept landed. The keys clue unlocks the house (t9): losing it breaks the table later.
- Not new with SL-38: any clerk-selected move runs before the Keeper's first step; this is the first turn where one sentence carried both the bookkeeping and the move.

## Ruling (owner, 2026-09-24)
Within one turn, an effect located in a scene the party left during that turn is accepted and recorded at that scene (the scene trail knows the departure); `not_here` keeps refusing effects located anywhere else. The clerk's move is not delayed for the Keeper.

## Scope
1. Contract first: the locality rule for `apply clue/handout/item/cash` (wherever `not_here` is specified) gains the same-turn departed-scene case; the receipt carries `at: <that scene>`; §135.30.5 cross-reference.
2. Kernel: the `not_here` check consults the turn's scene trail; nothing else about locality changes.
3. Tests, mutation-killable, on the emitted Haunting kernel: the gate #3 t1 sentence (SL-38's fixture) lands the leads clue, the move, then the keys clue, cash, key item and handout, all with receipts; a clue located in a scene the party did not visit this turn is still refused `not_here`; the replay of t1 shows the keys clue landed.

## Comments

### 2026-09-24 — implemented, tested, replayed (branch `claude/sl38-20260924`, merged with the integration branch at `8dd93b3b7`)

**Finding.** Probed one effect at a time on the emitted kernel, after the clerk's leads clue and move to the morgue: only the keys clue is refused (`not_here`). `person` Knott, `cash`, `item` and `handout` are not scene-located in `table.apply` and land at the morgue. In the replay, the recorded batch was refused whole because its keys clue was refused. So the kernel's one locality check is `stageClue`'s, and that is the only code change.

**Contract** (written first, new subsection only). §135.30.7:
- An `apply clue` not discoverable at the active scene is accepted when it is discoverable at a scene the party left during this turn: the `from` of a `move` receipt of the current turn (a rename is not a departure), from an earlier call or earlier in the same batch, latest departure first.
- Everything else stays `not_here`.
- The clue is recorded at that scene: receipt `scene` and the `clue-discovered` event's `scene`, plus `left_this_turn: true`.
- Cross-references: the `clue` rule of `table.apply` (§5), the `not_here` enum entry, §51, and §135.30.5.

One deviation from the ruling's wording: `at` is already every receipt's timestamp, so "receipt `at: <that scene>`" is the receipt's existing `scene` key. Renaming the timestamp would break every reader of `at`.

**Changes.**
- `kernel-ts/apply/entities.ts` (`departedThisTurn`, `stageClue`).
- `kernel-ts/apply/index.ts`: `ApplyContext.staged()`, the receipts staged so far in this call.

**Tests.**
- `tests/kernel/test_apply.py`:
  - `test_a_clue_of_the_scene_left_this_turn_lands_at_that_scene`:
    - after leads + move in turn 1, a never-visited scene's clue (`chapel-eye-symbol`) is still `not_here`;
    - the keys clue lands at `commission-briefing` with `left_this_turn`, and the event says the same;
    - the party stays at the morgue;
    - on turn 2 an unfound office clue is `not_here`;
  - `test_a_move_then_the_old_scenes_clue_in_one_batch_lands`.
- `tests/extension/single-loop-guard-unlock.test.mjs`, "§135.30.7 on the emitted kernel": gate #3's turn-1 sentence through the vendored driver. The clerk's clue and move land, then the Keeper's accept (Knott, keys clue, cash, key item, handout) is taken. The turn record has receipts for all of them, the keys clue at the office with `left_this_turn`.

**Mutations** (copy-revert). All killed:

| id | mutation | tests failed |
| --- | --- | --- |
| N1 | no departures | 2 pytest, and the extension test |
| N2 | only earlier calls' receipts, not this batch's | 1 |
| N3 | departures read from `world.scene_trail` instead of this turn's receipts | 1 (the earlier-turn case) |
| N4 | recorded at the active scene | 2 |
| N5 | no `left_this_turn` | 1 |
| N6 | any scene of the book | 2 |

**Suites** (leehow-pc; the box prints the merge HEAD because the working tree was overlaid):
- `== py on leehow-pc @ 8dd93b3b7d98ce98e5c735761757837e1f0c07e6: exit=0 wall=174s` (1723 passed, 2 skipped)
- `== loop on leehow-pc @ 8dd93b3b7d98ce98e5c735761757837e1f0c07e6: exit=0 wall=32s` (164/164)
- `== ext on leehow-pc @ 8dd93b3b7d98ce98e5c735761757837e1f0c07e6: exit=0 wall=138s` (3013/3013)

**Replay of gate #3 turn 1.** Same arm as SL-38's: recorded Keeper and lane at live latency, live Jev, seed 1, 3 runs. Results: `experiments/single-loop-routing/results/sl42-longgate3-t1`.
- The compile selects the leads clue and the move, both admitted by the compile at 0 ms, 3 of 3.
- The Keeper's first batch (person Knott, `knott-keys`, cash, key item, handout) is taken 3 of 3 (`M:apply` ok, where SL-38's after arm had `M:apply!not_here`). The match rows show the keys clue, Knott, the item and the handout `yes(model)`.
- `cash null` is never matched in any arm, before included: that is the replay matcher, not the table (a cash baseline has no name). The cash rode in the same batch, which landed whole.
- Wall: 55.2, 53.7 and 51.2 s. SL-38 after: 53.4, 50.6, 51.3. Before: 53.6, 50.1, 51.3.
- The remaining `M:apply!needs` is the Keeper's second batch (`define`/`object`, `mod_generation_required`), as in the before arm.

