Status: ready-for-human (implemented 2026-09-24 on `claude/sl14-20260924`, merged with `claude/integ-single-loop-20260923`@721812cac; awaiting review; **the Evidence below is contradicted by the gate's own artifacts, see Comments**)
Stage: SL-14 (kernel; independent of SL-13/SL-15)
Spec: docs/specs/pi-native-single-loop.md (Ruling: "An ordinary check on an obligation's approach is the obligation's attempt"); docs/specs/scene-obligations-as-candidates.md

# SL-14 — An ordinary check that covers an open obligation is that obligation's attempt

## Evidence (live gate #3, campaign `gate3-haunting-2329`, turn 2; corrected 2026-09-24)

- The owner first read `turns/0002.json` as an ordinary Persuade with no `obligation`. That was a misread of a truncated dump: the call `t2-c1` carried `action.obligation`, its result holds `obligation: {handle: globe-clippings-access, settled: false}` with the book's failure and push lines, and the obligation stayed `open` because a failed attempt does not settle it (owner ruling Q4). The claim path worked at the table.
- What the gate did show, and what this ticket fixes: without the claim the same call goes to the social adjudication (no roll, the book's difficulty ignored), and an explicit ordinary check without the claim rolls but counts as nothing. The kernel now folds such a check into the obligation's attempt (§134.17).

## Scope

1. **Kernel fold** (`kernel-ts/resolve/`): when an ordinary check's actor is an investigator, its target (or, absent a target, the person the action's `goal`/`method` cannot name — do not guess: no target means no fold) is the open obligation's `next.target`, and its skill is among the obligation's approaches, the kernel resolves it as the obligation's attempt: the obligation's difficulty and minimum apply, the guards are checked, the attempt is recorded, the failure price applied, the obligation receipt is issued beside the roll's, and the returned outcome carries `obligation: {handle, step, counted: "folded"}`. The ordinary-check outcome shape is otherwise unchanged.
2. **Precedence.** An explicit `action.obligation` is unchanged. A check that matches two open obligations folds into none and says so in the outcome (`obligation_ambiguous`), never refuses.
3. **Contract.** §134.17 in docs/kernel-rpc.md, contract first. Update the obligations spec's tickets file (SO-06 pointer to this ticket).
4. **Reader.** The Keeper's note on such a resolve says what the check counted as (one line, from the receipt), so it does not roll again.

## Acceptance

- pytest kernel tests through the real `resolve` entry with the gate-3 turn-2 arguments against a campaign built from `content/starters/the-haunting`: folded receipt, price applied, obligation state advanced on success / attempt recorded on failure; explicit `action.obligation` unchanged; two-obligation ambiguity; no target → no fold. Mutations: fold disabled, price skipped, ambiguity folded anyway.
- `npm run build:runtime`, `test:ext`, pytest green on the branch and after merging 0.9.5a.

## Comments

### 2026-09-24 — SL-14 implemented (kernel fold, contract §134.17)

Branch `claude/sl14-20260924` from `ef8efdf97`, then merged with `claude/integ-single-loop-20260923`@`721812cac`
(0.9.5a + SL-13), as the coordinator redirected. Commits: `0f424b641` contract, `c32297ca9` kernel, `cb7937656`
tests, `9af3baafb` merge, and this record.

**Read this first: the gate-3 evidence does not show the defect.** The ticket's first Evidence bullet says `t2-c1`
had "no `obligation` on the action". The gate's own artifacts say it had one:
`.coc/playtests/gate3-haunting-2329-20260924T032940Z/events.jsonl` (the `tool_execution_start` of `resolve`,
tool call `call-3a9525fa-…`) shows the Keeper's arguments `{intent: social, goal, method, target: "Arty Wilmot",
skill: "Persuade", obligation: "globe-clippings-access", modifiers: {bonus_dice: 1, reason}}`. The campaign's
`turns/0002.json` agrees: the `t2-c1` result carries
`obligation: {handle: globe-clippings-access, settled: false, book: <failure line>, push: <push line>}`, and the
roll receipt `roll:persuade-t2-c1` carries `obligation: {handle: globe-clippings-access, settled: false}`. So at
gate 3 the Keeper claimed the obligation. The kernel recorded the attempt on the receipt and gave the Keeper
the book's failure line, and the Keeper realised it in prose (Arty refused). The obligation stayed `open`
because a failure does not settle (§134.11), which is the book's rule. The decision (`core-check:ordinary-check`)
came from the claim binding the ordinary check, not from a Keeper choosing an ordinary check instead of the claim.

The ruling still names a real gap, and this change closes it. Before SL-14 the same arguments **without** the
claim went to the social adjudication, which rolls nothing and computes a difficulty from Arty's defences that the
book already states. With `decision: core-check:ordinary-check`, they rolled and counted as nothing (§134.11 D4).
**Owner to confirm** whether SL-14 should land now that its motivating turn turned out to be the claim path
working.

**What landed.**
- Contract §134.17 (after §134.16), with §134.11's D4 line amended in place and §134.15's test record annotated.
- `kernel-ts/resolve/obligation.ts`:
  - `foldCandidate` finds, before the roll, the open obligations of the active scene whose `next` is a check
    against the person `action.target` names (`graph.actor`), with `action.skill` among the approaches
    (resolved against the actor's sheet, normalised names).
  - One match is bound through the claim path's `bindCheckStep`, with the Keeper's difficulty dropped so the
    stated difficulty applies.
  - Two or more matches are `ambiguous`. A binding the claim would refuse is no fold.
  - `settleClaim` adds `step` and `counted: "folded"` to the receipt and the result. `continuedClaim` carries
    the fold through a push or a Luck spend.
- `kernel-ts/resolve/pipeline.ts`: the fold's skill and modifiers apply only in the ordinary-check slots. A
  `social` intent with a fold is routed to the ordinary check, as a claim routes it.
- `kernel-ts/resolve/index.ts`: the fold is computed for an investigator actor only (no claim, no rule, not an
  NPC acting in a session). It becomes the claim when the pipeline actually settled the ordinary check.
  `obligation_ambiguous` and its note are added on a settled ordinary check.
- `kernel-ts/read/obligations.ts`: `foldNote(receipt)` and `ambiguityNote(handles)`, one line each, derived from
  the roll receipt or the handles. Carried as the result's `note`; the precedent is the Mod path's
  "do not reroll" `note`.
- `extensions/kernel/tools.ts`: the `resolve` tool's `obligation` description no longer says "a roll without it
  settles no obligation". That sentence became false, and a false tool sentence is what the model acts on. No
  other prompt text changed.
- `docs/specs/scene-obligations-as-candidates-tickets.md`: SO-06, a pointer to this ticket. The manifest now
  records SL-14 and SO-06 as `ready-for-human`.

**Decisions the owner should confirm.**
1. *"The failure price applied"* means §134.11's failure settlement, unchanged. The attempt is recorded on the
   roll receipt, and the Keeper gets the level's `book` line and the push line. The kernel applies no
   consequence: ruling Q4 and §134.11's "no consequence and no cost" stand, and the obligation's result levels
   carry only `settles`/`book`, so there is no typed effect to apply. Kernel-applied prices would be a data
   change (typed `effects` on obligation results, §136.5) plus a ruling that reverses Q4.
2. *"The obligation receipt beside the roll's"* is the roll receipt's `obligation` key. It is the key the claim
   writes and that `obligationState`/`waivedBy` already read. No new receipt kind was added, so the §16.2
   projections are untouched.
3. **A social intent is re-routed.** The gate-3 arguments (social intent, no decision) folded in one call only
   because a fold routes them from the social adjudication to the ordinary check, as a claim does. An explicit
   `decision: social:adjudicate-difficulty` folds nothing.
4. The **Keeper's `modifiers.difficulty` is replaced** by the stated one on a fold. A claim refuses the mismatch;
   the fold never refuses. When the step records `difficulty_unstated`, the Keeper's difficulty stands.
5. **No skill means no fold**, the same rule as for the target. A skill the pipeline finds in the method text is
   not read for the fold.
6. **A next step that is a meeting means no fold.** The obligation is not at its check yet (the claim refuses it
   with `obligation_step`). Carrying the meeting is the clerk's job (§135.26), not the kernel's.
7. **Ambiguity is reported only on a settled ordinary check.** With two matches no obligation binds, so a social
   intent still goes to the adjudication, and the report comes on the ordinary check that follows.
8. **A step served by a Mod check** (§134.13) never folds: its attempt is that Mod check.
9. `step` is the 0-based index of the check in `demand`: 1 at the morgue.

**Tests** (`tests/kernel/test_obligation_fold.py`, 11 cases, through `table.resolve` over the emitted kernel, fresh
seeded haunting campaigns at the morgue, the gate-3 turn-2 arguments less the claim):
- A pass folds and settles: flag, receipt, event, archivist `open`, note, ordinary outcome keys unchanged.
- A failure records the attempt and hands over the failure and push lines, with no other receipt or world change.
- A push continues the fold.
- The stated difficulty replaces the Keeper's `hard`.
- The explicit claim is unchanged, including its `obligation_difficulty` refusal.
- These fold nothing: no target (Arty named only in the words), no skill (Persuade named only in the method), a
  skill outside the approaches, the social adjudication named explicitly, and a check before Arty is met.
- On a derived haunting with a second open obligation (Persuade or Charm against Arty), the call goes to the
  adjudication. The ordinary check that follows settles and claims nothing, returns
  `obligation_ambiguous: [globe-clippings-access, globe-fire-archive]` with its note, and the Keeper's explicit
  claim then works.

`tests/kernel/test_scene_obligations.py`: SO-02's D4 case ("the same skill without the claim settles nothing") now
asserts the fold (§134.17).

**Mutations** (each applied to `kernel-ts/resolve/obligation.ts`, rebuilt, and run over `test_obligation_fold.py` +
`test_scene_obligations.py`, 22 cases; the source was restored from a copy afterwards):

| mutation | failing tests |
| --- | --- |
| fold disabled (`foldCandidate` returns null) | `test_the_gate3_call_without_the_claim_is_the_attempt_and_a_pass_settles_it`, `test_a_folded_failure_records_the_attempt_and_hands_the_book_price`, `test_a_push_continues_the_fold`, `test_the_book_difficulty_replaces_the_keepers_and_nothing_is_refused`, `test_a_check_that_fits_two_open_obligations_folds_into_none`, `test_scene_obligations.py::test_the_same_skill_without_the_claim_is_the_folded_attempt` (6) |
| price skipped (a folded failure carries no `book`/`push`) | `test_a_folded_failure_records_the_attempt_and_hands_the_book_price` (1) |
| ambiguity folded anyway (two matches fold into the first) | `test_a_check_that_fits_two_open_obligations_folds_into_none` (1) |
| target guessed from words (no `action.target`: an NPC whose name appears in `goal`/`method`) | `test_no_target_no_fold_even_when_the_words_name_the_person` (1) |

**Suites.**
- On the branch before the merge (Mac): `npm run build:runtime` and `npm run check:kernel` clean;
  `npm run test:ext` 2821 pass / 0 fail; `pytest tests/kernel tests/play` 1710 passed, 1 skipped (exit 0).
- After merging the integration branch, on leehow-pc:
  - `== ext on leehow-pc @ 9af3baafb…: exit=0 wall=164s`, 2830 pass / 0 fail.
  - `== py on leehow-pc @ 9af3baafb…: exit=1 wall=290s`, 1707 passed, 2 skipped, 2 failed. Both failures are
    `tests/play/test_driver.py` process-lifecycle cases (`test_status_reports_alive_then_dead`,
    `test_stop_terminates_both_processes_and_writes_final`: "daemon process should be dead after stop").
  - Serial rerun of that file on the box: 1 failed, 62 passed.
- The same file at the same merged HEAD on the Mac: 63 passed. That is a Linux-box process-reaping difference,
  not this change: the fold touches no driver or process code, and the merge touched no `tests/play` file.
- Fold files on the merged HEAD (Mac): 22 passed.

**Not done.** No live table (per the instructions). The "NPC acting in a session never folds" guard is in the code
but has no test of its own. No change to the clerk (`runtime/jev`): its obligation candidates already claim
explicitly.
