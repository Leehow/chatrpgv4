Status: ready (stage 2, 2026-09-25) (filed 2026-09-25 from long gates #4–#6; batch 7; implemented and replayed 2026-09-25 -- the fan-out works, but on gate #6 t1 live Jev answers the keys row `no`, so the keys are still not filed; see Comments)
Stage: SL-52 (P2, compile routing)
Spec: docs/kernel-rpc.md §135.30.x (compile rows, the `ask` feature), §135.30.5 (SL-38 guard_unlock), §134.17; docs/specs/pi-native-single-loop.md "fan-out not pick-one"

# SL-52 — The ask feature fans out: every clue the question clears at the gate is the clerk's

## Evidence (long gates #4, #5, #6: campaigns `longgate4-haunting-1308`, `longgate5-haunting-1447`, `longgate6-haunting-2155`)
- Three tables in a row the accept at t1 filed the leads clue (or nothing), the cash and the key item, but not `knott-keys`; the house was then guarded at t9 and the Keeper filed the clue when the guarded row said so: 54, 60, 69 s turns. At gate #6 t1 the compile's `ask` feature listed five rows (commission, research-leads, macario-summary, keys, handout 1), chose `knott-research-leads` at 0.89 (cleared, filed by SL-38's `guard_unlock`), and left `knott-keys` (ask_4) unread: the feature is single-choice.
- The prototype's own finding (RESULTS-20260923): fan-out, not pick-one.

## Ruling (owner, 2026-09-25)
The ask feature is a fan-out: each clue row is its own yes/no at the gate; every row that clears is filed by the clerk in that compile, in row order, admitted line by line; a row that does not clear is left to the Keeper as today. `guard_unlock` (SL-38) remains the special case that also stages the move.

## Scope
1. Contract: §135.30 addendum (new subsection): the ask feature's rows are independent questions; selection is the set that clears; the compile row records `ask_cleared: [...]`.
2. `runtime/jev/compile-rows.ts` / `route-compile.ts`: the ask question becomes per-row (one Jev call with per-row probabilities is fine if the port supports it; otherwise a batch of rows); the clerk files each cleared clue.
3. Tests, mutation-killable: the t1 accept sentence on the Haunting fixture files both the leads and the keys clue (and the move); a sentence that names one clue files one; a row under the gate stays the Keeper's. Then the replay of gate #6 t1 (recorded Keeper, live Jev) reporting the receipts.

## Comments

### 2026-09-25 — implemented (contract first), mutation-tested, replayed; the keys are still not filed on gate #6 t1: Jev answers their row `no`

Branch `claude/sl52-20260925` from `95a3970c5`. **Commit** `925176f10` (contract §135.30.9 and SL-50's §135.11.2, the code, the tests);
the fixture, the replay results and these Comments in the commit after it.

**Contract** (§135.30.9, new subsection; cross-references added in §135.30's table, §135.30.3's condition 3 and §135.30.5):
- The `ask` family is asked as one question per row, key `ask_<n>` (the row's alias), in the same compile batch (one Jev call),
  options `yes` / `no` / `unclear`, the target carrying the row's words. Each row clears by §135.2's gates on its own; a row whose
  `yes` cleared is *sought*. The compile row's `features.ask` is `{rows, answers, cleared}` and the row gains **`ask_cleared`**.
- Predicates read the row they own: `obligation_check` fires on its obligation's row sought and is decided by that row's cleared
  answer (no longer by any cleared ask); `stated_meeting` likewise; `ordinary_check` condition 3 is "no obligation row sought";
  `guard_unlock` unchanged in effect; **`ask_clue`** (new, not sole, never decides) files any other sought clue. A candidate is read
  by every predicate that reads and reaches it, in order; the first that fires selects it (so a clue is `guard_unlock`, else
  `ask_clue`).
- Per-candidate evidence: a clue's `basis.compile.features.ask` / `read_features.ask` are its own row's, so §32.12 admits each
  clue line by line; a candidate without an ask row records the sought set.
- Order: within a rank, the batch runs in the ask rows' order; `guard_unlock`'s staged move now runs after the batch's other
  pending reveals (accept first, then the move; SL-38 ran it immediately after the unlocking step).
- **Decided by me, for the owner to confirm:** a sought clue whose kernel row states `delivery_kind: skill_check` is not filed by
  `ask_clue` (its attempt is the check; filing it would skip the roll the book puts in front of it). The ruling names no such gate;
  without it a declared search ("I search the desk") would file the hidden clue and roll the check beside it. One comparison of a
  kernel enum value. The handout rows are asked and recorded but have no reader (the ruling is about clues).

**Code.** `runtime/jev/route-compile.ts` (the per-row questions, `readFeatures`' ask record and `Cleared.ask` keyed by row,
`sought`/`soughtRows`, `askRow` on the predicates, `ask_clue`, `predicatesOf`, `readOf`/`evidenceOf`, `askIndex`, `askCleared`),
`runtime/jev/step-policy.ts` (the batch order, the staged move's place, `ask_cleared` on the compile step), `runtime/jev/hybrid-engine.ts`
(`ask_cleared` on the compile row).

**Tests.** `tests/extension/single-loop-ask-fanout.test.mjs` (new, 10): the per-row questions; turn 1's accept seeking the leads
and the keys files both in row order with the move staged after both and each clue admitted on its own record (a tampered keys
record refuses the keys alone); one sought clue files one; a row under the gate, `unclear`, a cleared `no` or `unknown` is not
filed and stays the route's (the margin rule still clears); a sought skill-check clue is not filed and the declared search is the
ordinary check; row order whatever the candidates' order; an obligation decided only by its own row; a sought obligation row keeps
the ordinary check off even when the obligation's check does not fire; on the emitted kernel over the haunting through the
hybrid engine, turn 1's sentence with per-row answers files the leads, the keys, then the move (binds in that order, admissions
`compile` `guard_unlock` / `ask_clue` / `move`, no lane request, receipts for all three, the keys at the office without
`left_this_turn`, `ask_cleared` on the compile row). Eight existing test files move their ask stubs to per-row answers
(`tests/extension/compile-ask.mjs`: a single-choice ask authored the old way fans out to "that row yes, every other no"); two
assertions changed meaning with the ruling (a sought clue with no guarded destination is now filed by `ask_clue`; a move's
`features.ask` is the sought set).

**Mutations** (copy-revert, `mutate.py` in the session scratchpad, over the fan-out, guard-unlock and compile test files; all killed):

| id | mutation | killed by |
| --- | --- | --- |
| A1 | ask asked as one choice again | 12 tests |
| A2 | pick-one: only the first sought row counts | the t1 policy test, the row-order test, the emitted-kernel test |
| A3 | `ask_clue` reads nothing | 7 |
| A4 | a skill-check clue is filed | the skill-check test |
| A5 | an ask row clears without the gate | the under-the-gate test |
| A6 | the staged move runs right after the unlocking step (SL-38's order) | the t1 policy test, the emitted-kernel test |
| A7 | the batch not ordered by the ask rows within a rank | the row-order test |
| A8 | the compile row without `ask_cleared` | the emitted-kernel test |
| A9 | only the first reaching predicate is tried | 5 |
| A10 | a clue's evidence is the sought set, not its own row | the t1 policy test |
| A11 | an obligation decided by any cleared ask row | the own-row test (added after A11 first survived) |
| A12 | the ordinary check ignores a sought obligation row | the ordinary-check test (added after A12 first survived) |

**Replay of gate #6 t1** (new fixture `longgate6-t1` from `longgate6-haunting-2155`, `gate-fixture.mjs`; recorded Keeper and
recorded lane at their live latencies, live Jev, `--latency live --seed 1`, 3 runs per arm). *Before* is the base `95a3970c5`
as a `git archive` export built in the scratchpad; *after* is `925176f10`. Results:
`experiments/single-loop-routing/results/sl52-longgate6-t1-{before,after,after-v2}`.

| arm | leads clue | keys clue | move | other clerk writes | model steps | wall (s) |
| --- | --- | --- | --- | --- | --- | --- |
| before `95a3970c5` | clerk (`guard_unlock`), 3/3 | not filed, 3/3 | clerk, 3/3 | -- | 2, 2, 2 | 36.7, 32.0, 32.4 |
| after `925176f10` | clerk (`guard_unlock`), 3/3 | not filed, 3/3 | clerk, 3/3 | `globe-fire-cutoff` at the morgue (`ask_clue`), 3/3 | 2, 2, 2 | 33.3, 31.9, 31.9 |

Every clerk write was admitted `path: compile` at 0 ms. The recorded Keeper's own batch (person Arty, cash, `define`/`object`
refused `mod_generation_required`, the first-impression resolve) is unchanged in both arms; it never filed the keys live either.

- **The keys: the fan-out asked them and Jev answered `no`.** Per-row answers at the office (after arm): the leads `yes` 0.50–0.61
  (yes 0.67–0.74), **the keys `no` 0.82–0.88 (yes 0.01)**, the commission `no` 0.63–0.69, the Macario summary `no` 0.48–0.60,
  handout 1 `no` 0.79–0.82. The single-choice question was not what hid the keys: asked on its own, Jev reads "我接。先去《环球报》剪报室…"
  as not seeking the keys; Knott handing them over is what the acceptance brings about, not what the sentence asks for. So the
  ruling's aim for this turn (the accept files the keys, the house is not guarded at t9) is **not met** by the fan-out on this
  sentence. A wording probe (pre-registered, `sl52-longgate6-t1-after-v2/PREREGISTERED.md`) asked the route `need` question's
  frame instead ("the declared action, or its direct consequence in the current fiction, gets … it"): outcome B, worse -- the keys
  `no` 0.81–0.82 and the leads `no` 0.42–0.45 too, nothing selected, 3/3; reverted. The committed question is the `seek` one.
- **New: the morgue's `globe-fire-cutoff` is filed at t1.** The second compile (after the move) asked the morgue's rows:
  `obligation:globe-clippings-access` `yes` 0.88–0.93 (decided, not fired: the addressee cleared `none`), `clue:globe-fire-cutoff`
  `yes` 0.29–0.46 with `yes` 0.53–0.64 against `no` 0.24–0.30 -- cleared by the margin rule (run 1: 0.53 against 0.29, 1.83x) --
  and `ask_clue` filed it. The live Keeper filed that clue at t2, after Arty's Persuade; the clerk now files it a turn earlier,
  before anyone has let the investigator at the files. It is kernel-legal (the obligation's guard names only the 1918 story, not
  the cutoff) and exactly what the ruling says ("every row that clears"), so it is not changed here.
- Wall: no difference (median 32.4 s before, 31.9 s after); the replay's recorded Keeper takes the same two model steps.

**Owner's call (none decided here):** (1) the keys -- the ask question cannot file a consequence of acceptance that the sentence
does not seek; options include a link in the book's own data (the keys handed over with the accepted commission, issued by the
kernel), a compile feature for what the declaration accepts rather than seeks, or leaving the keys to the Keeper and the t9 guard; (2) the margin rule on a three-option yes/no row is weak evidence (1.83x at 0.53);
the clerk could file a sought clue only when its `yes` clears by confidence, or not file an `npc_dialogue` clue whose book speaker
is not on stage (both structural; neither ruled).

**Suites** (leehow-pc, at `925176f10`):
- `ext` -- "ℹ tests 3091 / ℹ pass 3091 / ℹ fail 0" (`== ext on leehow-pc @ 925176f103aa2617c0ffbb1b9a0e79a04b0ec512: exit=0 wall=245s`);
- `loop` -- "# tests 186 / # pass 186 / # fail 0" (`== loop on leehow-pc @ 925176f103aa2617c0ffbb1b9a0e79a04b0ec512: exit=0 wall=42s`);
- `py` -- "1725 passed, 2 skipped in 265.26s (0:04:25)" (`== py on leehow-pc @ 925176f103aa2617c0ffbb1b9a0e79a04b0ec512: exit=0 wall=268s`).

- **2026-09-25, owner, after the gate #6 t1 replay.** Three decisions. (1) Confirmed: a clue whose kernel row says it is found by a skill check is never filed by the ask feature; it belongs to the check. (2) A fan-out row clears on confidence only: the margin rule chooses among rows of one question and has no meaning for an independent yes/no; the morgue's fire-cutoff clue (yes 0.53 against no 0.29) must not have been filed on turn 1 before Arty spoke. (3) The accept case: when the compile settles an obligation in the same declaration (the commission), the scene's clue rows are re-asked once with the settlement as context, the question being whether settling that obligation yields the clue as the clue's own `found_at.cues` state (the book's data, Jev judging; no list). The keys row's cue says "Accept the commission explicitly and take the key, address, and cash advance": that is the yes the first question could not give. Stage 2 scope: (2) and (3), tests for both, the same t1 replay. Handouts stay unfiled by the ask feature.
