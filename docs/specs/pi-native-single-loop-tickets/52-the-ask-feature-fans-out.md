Status: ready-for-human (stage 3 implemented and replayed 2026-09-25 on a fresh campaign: leads 3/3, keys 3/3, move 3/3, fire-cutoff 0/3) (filed 2026-09-25 from long gates #4–#6; batch 7)
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

### 2026-09-25 — stage 2 implemented, tested, replayed: the fire-cutoff is no longer filed; the keys still are not, and confidence-only drops the leads in 2 of 3

Branch `claude/sl52-20260925`, fast-forwarded to `claude/integ-single-loop-20260923` at `fddb5689b` first (no conflicts). **Commit**
`c88c7f5a1` (contract §135.30.9.1 and §135.30.9.2, the kernel's clue cues, the policy and engine, the tests); the probe script,
the replay results and this entry in the commit after it.

**Contract.**
- §135.30.9.1: an `ask` row clears when it is `yes`/`no` with a reported confidence ≥ 0.6; no margin rule, no clearing without a
  reported confidence. Every other choice question keeps §135.2's two gates.
- §135.30.9.2: the re-ask. **One reading to confirm:** the ruling says "when the compile settles an obligation in the same
  declaration (the commission)", but the haunting states no obligation at Knott's office (its only stated obligations are the
  Globe's two); the office's book condition is its exits' guard `clue_discovered: knott-research-leads`. Read literally, the
  re-ask would never fire on the turn the ruling names. Implemented: a compile *settles a step of the book* when it selects an
  obligation's check (`obligation_check`) or the clue that meets the guard of the destination the declaration goes to
  (`guard_unlock`). Nothing else settles (a plain move, a clue `ask_clue` files, the ordinary check, a meeting, the first blow).
  Then, once per run and before the batch runs, one Jev call (`single-loop-compile-reask`) asks about each issued clue of the scene
  the compile did not select, that is not found by a check, and whose kernel row carries `cues`. The state is the declaration plus
  `settled` (the settling step's row words and the place it opens). There is one yes/no per clue, the target carrying the clue's
  words and its cues, and each clears on confidence only. A `yes` is filed as `settled_clue` (a named predicate only the re-ask
  selects, so `compileAdmission` admits it line by line). It is staged after the last settling step and runs among the batch's
  reveals before a staged move. It is dropped when that step is refused or its check fails. Handouts: never.
- The kernel: `table.apply.options` clue rows gain `cues`, the `cue` of each affordance of the active scene that grants the clue
  (the book's data: the keys row carries "Accept the commission explicitly and take the key, address, and cash advance.").

**Tests.**
- `tests/extension/single-loop-ask-fanout.test.mjs`, 16 tests (6 new or rewritten for stage 2):
  - a margin-only `yes` (0.5, distribution 0.7/0.25) is not filed; one at 0.6 is;
  - the morgue's gate #6 fire-cutoff case (0.29 with 0.53/0.29) is not filed;
  - the accept with the keys row `no` 0.88: one re-ask over the commission, Macario and keys rows with their cues and the leads as
    the settlement, whose `yes` on the keys is filed after the leads and before the move, admitted `settled_clue` on its own
    record;
  - a re-ask `yes` under the gate (margin included) files nothing;
  - a skill-check clue and a clue without cues are not re-asked;
  - no re-ask for a plain move, an `ask_clue`-only filing, or nothing selected;
  - a refused settling step and a failed obligation check each take the staged clue with them (a passed check files it);
  - on the emitted kernel through the hybrid engine: leads, keys (by the re-ask) and move, admitted `guard_unlock` / `settled_clue`
    / `move`, the keys receipt at the office.
- `tests/kernel/test_jev_apply.py`: the office's clue rows carry the book's cues.
- Two obligation seam tests in `scene-obligation-candidates.test.mjs` now expect the re-ask ahead of the check's bind.

**Mutations** (copy-revert, `mutate2.py` in the session scratchpad; B11 rebuilt the emitted kernel before and after; all killed):

| id | mutation | killed by |
| --- | --- | --- |
| B1 | the margin rule clears an ask row again | the margin test, the fire-cutoff test |
| B2 | no re-ask | 6 |
| B3 | any selection settles (a re-ask after every selecting compile) | the no-re-ask test, the row-order test |
| B4 | the re-ask clears on the margin rule | the re-ask under-the-gate test |
| B5 | a staged clue runs whether its settling step settled or not | the refused / failed-check test |
| B6 | a skill-check clue is re-asked | the eligibility test |
| B7 | a clue without cues is re-asked | the eligibility test |
| B8 | `settled_clue` not a named predicate (admission cannot read it) | the accept test, the emitted-kernel test |
| B9 | a failed check still files its staged clue | the refused / failed-check test |
| B10 | the re-ask carries no settlement words | the accept test |
| B11 | the kernel's clue rows carry no cues | the emitted-kernel test; `test_jev_apply.py` 1 failed |

Not mutation-covered: "once per run" (`reasked`) needs a second settling compile in one run; the flag is asserted set.

**Replay of gate #6 t1** (the same fixture, flags and seed as stage 1: recorded Keeper and lane at live latency, live Jev,
`--latency live --seed 1`, 3 runs). Results `experiments/single-loop-routing/results/sl52-longgate6-t1-stage2`; the earlier arms
are unchanged.

| arm | leads clue | keys clue | move | fire-cutoff | re-ask | model steps | wall (s) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| before `95a3970c5` | clerk 3/3 | none 3/3 | clerk 3/3 | none | -- | 2, 2, 2 | 36.7, 32.0, 32.4 |
| stage 1 `925176f10` | clerk 3/3 | none 3/3 | clerk 3/3 | clerk 3/3 | -- | 2, 2, 2 | 33.3, 31.9, 31.9 |
| stage 2 `c88c7f5a1` | clerk 1/3; **not filed 2/3** | none 3/3 | clerk 1/3, replayed Keeper 2/3 | none 3/3 | 1/3: keys `no` 0.72 | 2, 2, 2 | 34.4, 30.2, 30.2 |

- **Confidence-only costs the leads.** Jev's leads `yes` came at a reported confidence of 0.61, 0.55, 0.53 (yes 0.74, 0.70, 0.69):
  under the gate in runs 2 and 3, so the compile selected nothing. No clerk step meant no settlement and no re-ask. The replayed
  Keeper's own move (the clerk's live write) landed; the kernel takes a model-origin move under a pacing guard. **The leads clue was
  then never filed that turn**, because the recorded Keeper never filed it (the live clerk had). In stage 1 the same row cleared 3/3
  on the margin rule (confidence 0.50–0.61). So ruling (2) stops the fire-cutoff (`yes` 0.41 in run 1: not filed) and also drops
  the accept's own clue on this sentence in 2 of 3.
- **The re-ask asked the keys against their cue and Jev said no.** Run 1 settled (leads 0.61) and re-asked the commission, Macario
  and keys rows: `no` 0.93 / 0.77 / 0.72 (keys `yes` 0.05). A pre-registered wording probe
  (`results/sl52-reask-wording/PREREGISTERED.md`, `sl52-reask-probe.mjs`, 5 live calls per arm on the product's batch) compared the
  committed question with the ruling's own framing ("does settling that step, as declared, yield this clue as its cue states"). The
  committed question gave keys `no` 0.83–0.87 5/5; the ruling's framing gave `no` 0.53–0.58 5/5; the commission and Macario were
  `no` everywhere. By the pre-registered rule the committed question stays. Jev does not read "我接。先去《环球报》剪报室…" as doing
  "accept the commission explicitly and take the key, address, and cash advance", even with the leads settled as context.
- Wall: no material change (median 30.2 s stage 2, 31.9 s stage 1, 32.4 s before). The two runs without a compile selection skipped
  the clerk writes the replayed Keeper then did itself.

**For the owner (nothing decided here):**
(a) Rule (2) against the leads: a confidence-only gate at 0.6 drops the t1 accept's leads 2/3. Options are a lower gate for fan-out
rows, the margin rule within the yes/no distribution kept for rows (it is the row's own distribution, not a choice among rows),
or accepting that the Keeper files the leads.
(b) The keys: two question framings both fail on this sentence. What the book ties the keys to is the commission's acceptance,
which no kernel row states as a step. A settled step the re-ask can name ("the commission accepted") would have to be book data
(an obligation or a flag the accept sets), not a question wording.
(c) The settlement reading (guard_unlock counts) is mine; say if it should be obligations only.

**Suites** (leehow-pc, at `c88c7f5a1`):
- `ext` -- "ℹ tests 3106 / ℹ pass 3106 / ℹ fail 0" (`== ext on leehow-pc @ c88c7f5a1235237a56ef3b713d693fd1eff1df15: exit=0 wall=159s`);
- `loop` -- "# tests 193 / # pass 193 / # fail 0" (`== loop on leehow-pc @ c88c7f5a1235237a56ef3b713d693fd1eff1df15: exit=0 wall=43s`);
- `py` -- "1726 passed, 2 skipped in 185.97s (0:03:05)" (`== py on leehow-pc @ c88c7f5a1235237a56ef3b713d693fd1eff1df15: exit=0 wall=187s`).

- **2026-09-25, owner, after the stage-2 replay (leads 1/3, keys 0/3).** (a) The flat 0.6 confidence gate is withdrawn: a fan-out row clears on its own within-row margin, `yes ≥ 0.5` and `yes ≥ 2 × no` (named defaults, from the two recorded cases: the leads at 0.53–0.61 against a no near 0.01 clears; the fire-cutoff at 0.53 against 0.29 does not). (b) The keys are book data, not wording: the starter's graph models the commission as an obligation node at `commission-briefing` (accept Knott's commission) whose settlement yields `knott-keys`, `knott-research-leads`, the key item and the $20 (the same shape an imported module's scene obligations take, §134.17); the obligation fold files the yields when the compile settles the accept, so no re-ask is needed for them. The re-ask (stage 2) stays for clues whose cue names a settlement the graph does not model. (c) Settling = an obligation check the compile selects, or the clue `guard_unlock` files: confirmed. Stage 3 scope: (a), (b) in `content/starters/the-haunting/` (module graph + re-stamped bundles as SL-28 did) and in the fold, tests, and the same t1 replay (target: leads 3/3, keys 3/3, move 3/3, fire-cutoff 0/3).

### 2026-09-25 — stage 3: within-row margin, the commission as an accept obligation; the replay meets the target

Branch `claude/sl52-20260925`, fast-forwarded to `claude/integ-single-loop-20260923` at `34e6cc352` first (no conflicts).
**Commits:**
- `c8cd0e4f1`: the contract, the runtime, the kernel, the starter graph with re-stamped bundles, and the tests.
- `1436784f9`: the node renamed, plus the fixtures that follow the office's new gate. The handle `knott-commission` already
  named a quest and a clue, so module lookup returned two nodes.
- `09fe98682`: the prescreen relationship test.
- The next commit: the fresh-fixture tool, the fixture, the replay and this entry.

**(a) The within-row margin** (§135.30.9.1, amended in place). A fan-out row clears when its reported confidence is at least
`ROW_MIN` (0.5) and at least `ROW_RATIO` (2) times the opposite option's probability. Both are named defaults in
`route-compile.ts` (`rowClears`), used by the `ask` rows and the re-ask rows. **Which numbers:** the answer's own reported
confidence against the opposite option's probability. On every recorded row this clears the leads (6 of 6: 0.50–0.61 against
`no` 0.16–0.19) and never the fire-cutoff (0 of 4: confidence 0.29–0.46). Reading the `yes` *probability* instead would have
filed the cutoff in 2 of those 4 (0.64 against 0.24, 0.61 against 0.28), which your ruling rules out.

**(b) The commission is book data.**
- **The node.** `requirement-knott-accept-commission` "Accept Knott's commission" at `scene-commission-briefing` (handle
  `knott-accept-commission`; the flag is `knott-commission-accepted`). It is cited as `clue-knott-keys` is (pdf index 446, "gives
  you the keys"). It is an `attempt` guarding the keys and the leads, `who` Knott, demand `[accept Knott]`, and yields the two
  clues, "Corbitt House key" and $20.
- **The kernel** (contract §134.18, new):
  - a demand step `accept`, and `yields`, allowed only with an accept (rule `obligation_yields`);
  - an open accept's row carries `next.settle`: the one `apply` that settles it, flag first, then clues, item and cash, built
    from the graph;
  - `action.obligation` on it is refused `obligation_step`, with the fix naming the apply;
  - an accept is never settled by meeting the person;
  - the capsule cue is short, because the 1 KB obligations section trims the rows after it.
- **The fold.** The kernel files the yields through its own `apply` of `next.settle`, one atomic call, so the clerk's write is
  exactly the kernel's settlement (§135.30.9.3, new):
  - the candidate is `apply:obligation:<h>`, family `obligation_check`, bound to the kernel's effects;
  - `obligation_check` fires on its demand row being sought; a cleared `none` addressee does not stop it, someone else does;
  - it settles no act (it is not a check);
  - its settlement's clue meets the research exits' guard, so the move is staged after it (§135.30.5 gains that case);
  - the stage-2 re-ask still runs after it for the office's other clue rows with cues.
- **Re-stamped** guidance bundles: `guidanceFingerprint` reproduced the committed stamps on the parent graph first.
  `source-binding.json` carries no graph digest, and no other file carries the old one.

**(c)** Settling = an obligation check or the clue `guard_unlock` files, as confirmed. An accept counts as an obligation step.

**Tests.**
- `tests/kernel/test_scene_obligations.py`:
  - a fresh campaign carries the commission open, with its `next.settle`, guards and yields;
  - `action.obligation` on it is refused;
  - the settlement files flag, both clues, item and cash in one call, crossing nothing, and opens the research exits;
  - the reading-as-before case moves to a scene without obligations.
- `tests/extension/obligation-shape.test.mjs`: the shipped commission, eight `obligation_yields` cases, an accept not seated,
  and an accept with a key of its own.
- `tests/extension/single-loop-ask-fanout.test.mjs`, at the policy seam:
  - the margin cases (the leads' 0.55/0.19 files; 0.53/0.29, 0.5/0.3 and 0.49/0.01 do not);
  - the accept selected with the kernel's effects as one apply, and the addressee cases;
  - the move staged after the accept, no act settled.
- The emitted-kernel cases now use the office's remaining clue rows:
  - `single-loop-guard-unlock.test.mjs`: turn 1's sentence settles the commission, with receipts for flag, leads, keys, key
    item and $20, then the move, both admitted `path: compile`;
  - the Keeper's office bookkeeping after that move lands at the office (§135.30.7, now with the Macario summary);
  - `single-loop-ask-fanout.test.mjs`: two sought office clues are filed in row order; the re-ask after the accept files a
    clue against its cue and never re-asks the commission's yields.
- Fixtures that followed the office's new gate:
  - the leads' gate string names the commission's guard (director scoring, story thread);
  - the promise-consumer case reads a scene without obligations;
  - the pre-RD-04 inventory lists the three added records;
  - the prescreen relationship case follows a link to another entity (a has-requirement link's target is the obligation's
    own small row, delivered whole on follow);
  - `ts-kernel-read` compares against the freeze-time graph (`POST_FREEZE_NODES` in `oracle-fixture.mjs`, the
    `POST_FREEZE_ENTITY_FIELDS` precedent); the captured oracle is not edited.

**Mutations** (copy-revert, `mutate3.py` in the session scratchpad, rerun after the rename; all killed):

| id | mutation | killed by |
| --- | --- | --- |
| C1 | the row margin without its ratio | the margin cases, the re-ask margin |
| C2 | the row margin without its minimum | the margin cases |
| C3 | the yes probability in place of the reported confidence | the margin cases, the re-ask margin |
| C4 | a cleared `none` addressee refuses the accept | the accept addressee test |
| C5 | no candidate for an accept step | 5 |
| C6 | an accept's yields unlock nothing | the emitted accept test, the policy unlock test |
| C7 | the accept settles its act | the policy unlock test |
| C8 | `keeperCall` ignores the settlement effects | 4 |
| C9 | the kernel settlement without its flag | the emitted accept test; pytest 2 failed |
| C10 | the flag after the yields (the clues cross the open guard) | the emitted accept test; pytest 2 failed |
| C11 | an accept obligation settled by meeting the person | 3 |
| C12 | yields allowed without an accept step | `obligation_yields` test |
| C13 | the graph's commission yields no keys | the emitted accept test; pytest 2 failed |

**The replay, on a fresh campaign.**
- **The fixture.** `experiments/single-loop-routing/fresh-fixture.mjs` re-creates the turn on a fresh campaign
  (`longgate6fresh-t1`). It creates the campaign from the current starter (module digest `650ee295…`, generation 1) and replays
  gate #6's opening on it through the kernel's RPC: Knott's first-impression roll, `apply person` Knott with the recorded
  label, the recorded narration. The recorded Keeper of turn 1 is copied as the baseline. The opening's eight Mod object
  definitions, queued for generation, are skipped and listed in `turn.json`.
- **Runs.** Recorded Keeper and lane at live latency, live Jev, `--latency live --seed 1`, 3 runs. Results:
  `experiments/single-loop-routing/results/sl52-longgate6fresh-t1-stage3`.

| arm | leads clue | keys clue | key item, $20 | move | fire-cutoff | model steps | wall (s) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| stage 3 (`1436784f9`, fresh campaign) | clerk 3/3 | clerk 3/3 | clerk 3/3 | clerk 3/3 | not filed 3/3 | 2, 2, 2 | 34.1, 32.3, 32.1 |

- **The compile.** The commission's demand row answered `yes` at 0.72, 0.60 and 0.59 (`no` 0.14–0.19), cleared by the row
  margin. `obligation_check` fired, and `unlocked` named the morgue after the accept. One clerk `apply` landed all five effects,
  admitted `path: compile` at 0 ms. The move followed, admitted `move` with `unlocked_by` the accept.
- **The re-ask** after the accept asked the commission terms and the Macario summary: `no` 0.63–0.82, nothing filed.
- **At the morgue**, the fire-cutoff row answered `yes` at 0.16–0.28 against `no` 0.32–0.38: not cleared, not filed. The Arty
  obligation's demand cleared, but the addressee `none` decided it (it stays the Keeper's), as before.
- **The recorded Keeper's batch** (person Arty, $20, define/object key, time) was refused `needs` 3/3, as in every earlier
  arm (its `define` needs Mod generation). In a live run the Keeper would see the clerk's settlement in `clerk_did` and should
  not file the $20 and the key again. The kernel does not stop a second cash receipt (it never did).
- **Walls** are not comparable with the earlier arms' 32–37 s: this is another campaign, without the opening's queued
  definitions.

**Not done / for the owner.**
- The accept's demand cleared at 0.59 and 0.60 in two runs, 0.09–0.10 above the 0.5 minimum. It is the thinnest margin on
  this path.
- **Existing campaigns** see the commission only after their module is re-registered: a campaign is a compile snapshot.
- **The capsule's obligations section** at the office now starts with the commission's row (about 250 bytes, until it is
  settled). In the memory test's office state, two promise rows no longer fit the 1 KB budget; that case now reads its
  promises at another scene.
- **A has-requirement link** is offered to the prescreen as a follow whose target is the obligation's own small row. This is
  already the case at the morgue, and it is not changed here.

**Suites** (leehow-pc):
- `ext` at `09fe98682` -- "ℹ tests 3123 / ℹ pass 3123 / ℹ fail 0" (`== ext on leehow-pc @ 09fe98682c8bea992fce820ab3daaa4893f84f67: exit=0 wall=161s`);
- `loop` at `09fe98682` -- "# tests 195 / # pass 195 / # fail 0" (`== loop on leehow-pc @ 09fe98682c8bea992fce820ab3daaa4893f84f67: exit=0 wall=43s`);
- `py` at `09fe98682` -- "1728 passed, 2 skipped in 177.89s (0:02:57)" (`== py on leehow-pc @ 09fe98682c8bea992fce820ab3daaa4893f84f67: exit=0 wall=179s`).
