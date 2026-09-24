Status: ready-for-human
Stage: SL-12 (with SL-10/SL-11; before SL-03)
Spec: docs/specs/pi-native-single-loop.md (Rulings: "Parameter binding never goes to the LLM", "Parameters-only steps never go to the LLM", "An NPC's defence is data")

# SL-12 — Binding without the LLM: rules defaults for closed choices, code-composed explanations

## Evidence

- SO-04's replay (`turn3-obligations`, 6 runs): after the clerk staged Arty, Jev answered the approach bind `unknown` (0.76–0.80) every time, so `infer(bind)` sent the choice to the Keeper: one model call per run for a four-way closed choice among the investigator's own skills.
- `runtime/jev/candidates.ts` and `obligation-candidates.ts` mark `why`, `goal` (manoeuvre) and `outcome` (`combat:end`) as `open` parameters; `step-policy.ts` routes any required open parameter, and any closed one Jev could not settle, to `infer(bind)` followed by `direct llm_proposal`.

## Scope

1. **Rules defaults for closed binds** (`step-policy.ts`, the bind step): when Jev's answer is `unknown` or below the gates, the bind resolves to the rules default and the step continues as `direct`: the approach → the actor's highest current value among the offered skills (ties: the first in the obligation's stated order; the value read from the actor's sheet the kernel already issues in `table.resolve.options` profiles), dice modifiers → none, intent → the one the obligation/Mod/session declares, a target or weapon among several → no default (Jev only; a session step with several targets stays `decide(bind)` and, unresolved, hands the turn to the Keeper as today). The receipt carries `basis.binding: rule-default` (contract: the field on the operation's `basis`, beside `obligation`/`standing`); the Keeper may re-resolve with its own choice (a normal Keeper operation, no new verb).
2. **Explanatory parameters composed by code**: the candidate builder fills `why` / `how` / `goal` from its sources — the player's declaration quoted (`player: "<input>"`), the obligation's demand, a clue's or handout's authored `how`/cue, a move's declared destination — under the §135.21 one-sentence limit; these parameters are no longer `open`. `outcome` for `combat:end` and a manoeuvre `goal` stay open and those candidates stay Keeper-proposed (they are not issued to the clerk).
3. **`infer(bind)` on the clerk's path is removed**: a clerk candidate never reaches `infer(bind)`; the policy either binds (Jev / rules default / code) or drops the candidate for the run and hands the turn to the Keeper. Contract §135.x records the four binding ways and the one remaining `infer(bind)` case (Keeper-proposed operations only).
4. Telemetry: every bind records `path: jev | rule-default | stated | composed` with the value and, for Jev, the distribution.

## Acceptance

- Policy tests with stub ports: approach `unknown` → highest offered skill bound, `basis.binding: rule-default`, no infer; Jev confident → Jev's choice; several targets unresolved → Keeper, no infer; `why` composed from the player's words and the demand within the limit; a clerk candidate never produces an `infer(bind)` step (structural test over the policy's transitions). Mutations named and killed: default ignored (infer returns); the wrong tie-break; `why` generated instead of composed (a fake port that would answer an infer(bind) is never called).
- Replay `turn3-obligations` (product driver, 3 runs per seed, pre-registered): the approach bound without a model call in 3/3; passing roll LLM steps reported (expected 4, from 5); 11/11 rows kept; turn-3 original and fight-round unchanged.
- `npm run test:ext`, `uv run --frozen python -m pytest tests/kernel tests/play` green on the branch baseline (record it first); legacy untouched.

## Comments

### 2026-09-23 — implemented (branch `claude/sl12-binding-20260923`, base `6588f8538`)

Commits: `9a6404aba` contract (written as §135.27); `42e6f1808` implementation and tests; `846d39439` replay
pre-registration; `97227859d` addendum registration (passing-roll arm); `a8ce669a8` scored replays; `48340e50d` the section
renumbered §135.28 (0.9.5a's `cebffa0e1` took §135.27 first); `73457dceb` merge of 0.9.5a; this ticket's close.

**Where each binding way lives** (contract §135.28):

| path | code |
| --- | --- |
| `jev` | `interpretBind` → `clerkBind` (`runtime/jev/step-policy.ts`) for a clerk candidate; `settleOrdinaryBind` for the ordinary binder |
| `rule-default` | the default is computed by the builder and rides on `Unbound.ruleDefault`: `highestOffered` / `approachDefault` (`runtime/jev/obligation-candidates.ts`, over `table.resolve.options` profile values; tie → stated order), `no_modifier` on the dice; `clerkBind` applies it and stamps `basis.binding: "rule-default"`, `basis.rule_default` |
| `stated` | the builders (`candidates.ts`, `obligation-candidates.ts`): every bound value read from a kernel row |
| `composed` | `composeSentence` (`runtime/jev/composed-arguments.ts`): the meeting's, the roster person's and the disposition's `why`; `Candidate.composed` names them (plus `goal`/`method`, the declaration) |
| the Keeper's turn | `keeperOwns` (step-policy): `infer(adjudicate)`, reason `clerk_unbound`, key consumed at step start; `itemsFor` (open parameters), `clerkBind` (no default), `settleOrdinaryBind` (binder unsettled); a spent Jev budget → `decide(bind)` with `offline: "jev_budget"` (no Jev question) |
| telemetry | `hybrid-engine.ts`: `lane: "run"`, `event: "bind"` per clerk write (`bindRecords`), `outcome: "keeper"` for a handed-over candidate; the note's `clerk_did[].binding` and `left_to_you` |

**Decisions recorded in §135.28 (flagged for the owner):**

- **The intent has no rules default today.** The ruling says "the intent the obligation or session declares"; the
  session's is bound from the view (never asked), but neither the obligation row (§134.9) nor the Mod contact row issues
  an intent, so an obligation or Mod check whose intent Jev cannot settle goes to the Keeper. In the replays Jev bound it
  (`social` 0.84–0.89) every time. Adding a declared intent to those rows is a kernel change for later.
- **A clue's `how` is not composed.** It is on the player's clue card (§80; `kernel-ts/read/mechanics.ts`), so a
  code-composed English sentence there would be system language on a player surface, and the clue's authored cue (the
  kernel's `gate`) is Keeper-only. `why` is on no player projection and is composed. A handout and a move have no
  explanatory field.
- **Not issued to the clerk** (the ruling: "such operations are the Keeper's to propose, not the clerk's to issue"): a
  roster person without the table's own label (an improvised name), the player's manoeuvre and ending. An NPC's issued
  manoeuvre/ending stays among its turn's variants and goes to the Keeper when chosen.

**Mutations** (each applied in a scratch worktree at `42e6f1808`, the seven single-loop test files run, restored). All 13 killed:

| mutation | file | killed | failing tests |
| --- | --- | --- | --- |
| M1 default ignored (infer(bind) returns) | `step-policy.ts` | yes | 13 |
| M2 wrong tie-break (last of the highest wins) | `obligation-candidates.ts` | yes | 3 |
| M3a meeting `why` generated, not composed (left open) | `obligation-candidates.ts` | yes | 6 |
| M3b roster `why` generated, not composed (left open) | `candidates.ts` | yes | 2 |
| M4 spent Jev budget escalates a clerk bind to the LLM | `step-policy.ts` | yes | 2 |
| M5 an open clerk parameter goes to infer(bind) | `step-policy.ts` | yes | 2 |
| M6 an unsettled ordinary check goes to infer(bind) | `step-policy.ts` | yes | 1 |
| M7 the default is not stamped on the basis | `step-policy.ts` | yes | 6 |
| M8 no bind row | `hybrid-engine.ts` | yes | 2 |
| M9 composed sentence not fitted to the ceiling | `composed-arguments.ts` | yes | 1 |
| M10 unlabelled roster person issued again | `candidates.ts` | yes | 3 |
| M11 a dropped candidate is not consumed | `step-policy.ts` | yes | 1 |
| M12 dice default ignored | `obligation-candidates.ts` | yes | 4 |

M1–M3 are the ticket's three named mutations. M1 and M3 are killed, among others, by the vendored-driver test whose fake
model engine throws on an `infer(bind)`, and by the structural test over every clerk authority × binding shape × Jev
outcome.

**Replays** (product driver, replayed Keeper, `--admission lane`; tables in `experiments/single-loop-routing/RESULTS-20260923.md`):

- `turn3-obligations`: the approach was bound without a model call in **5/5 runs where the check was selected** (all
  rules default, Jev `unknown` 0.69–0.80 → Persuade 70), no `infer(bind)` in any of 15 runs. The check was selected in
  5/9 runs (seed 1 0/3, seed 19 3/3, seed 4 2/3): the gate's `seeks` fact straddles the margin gate run to run
  (0.49–0.67 vs `not` 0.28–0.36), so "3/3 per arm" is not met as a run count. Passing roll: **4 LLM steps (from 5) in 2/2
  passing runs** (seed 4, an addendum arm registered before it ran after seeds 1/19 gave no passing claimed roll: seed 19's
  claimed Persuade failed 3/3 without the replayed Keeper's recorded bonus die). 11/11 live rows in 9/9.
- `turn3` original: 11/11, 5 LLM steps, no bind — unchanged; the morgue route no longer offers the unlabelled Arty/Ruth.
- `fight-round`: 5/5, 2 LLM steps — unchanged in count; the first is now `adjudicate` (`clerk_unbound`: the disposition
  inference below the gate) instead of `bind`.

**Counts:**

| suite | baseline `6588f8538` | branch `a8ce669a8` (before the merge) | merged `73457dceb` |
| --- | --- | --- | --- |
| `npm run build:runtime` | exit 0 | exit 0 | exit 0 |
| `npm run test:ext` | 2806/2806 | 2816/2816 (+10 SL-12 tests) | 2818/2818 (0.9.5a's 2808 + 10) |
| loop suites (`loop.test.mjs`, `single-loop-*.test.mjs`, `scene-obligation-candidates.test.mjs`) | — | pass | 84/84 |
| `uv run --frozen python -m pytest tests/kernel tests/play` | 1699 passed, 1 skipped | 1699 passed, 1 skipped, exit 0 | not re-run: the merge touched no kernel input (launch list, runtime dependencies, docs, extension tests) |

**Not shown:** a live Keeper reading `binding` / `left_to_you`; a live table.

### 2026-09-24 — the approach default amended by SL-21

Live gate #7 turn 2: this ticket's `highest_offered_skill` took Intimidate for a player who explained and asked, over
Jev's Persuade 0.67 at confidence 0.59, and the lane refused the clerk's check. The owner's ruling "The approach follows
the declaration's manner, not the actor's numbers" amends the approach default: Jev's leading offered skill at any
confidence (`jev_lead`), with `highest_offered_skill` only when Jev answers `unknown` or does not answer. Contract
§135.28 (dated amendment); implementation, tests and replays in
`docs/specs/pi-native-single-loop-tickets/21-approach-follows-the-manner.md`. Dice modifiers keep `no_modifier`.
