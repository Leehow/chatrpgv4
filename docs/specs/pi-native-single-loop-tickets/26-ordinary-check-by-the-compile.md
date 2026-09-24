Status: ready-for-human
Stage: SL-26 (P2; extends SL-13)
Spec: docs/specs/pi-native-single-loop.md (Ruling: "The declared ordinary check is the clerk's")

# SL-26 — The compile selects the declared ordinary check

## Evidence (long live gate, campaign longgate-haunting-0624 — first recorded as longgate-haunting-1010 — turns 11–13)
- "先站在楼梯口听一会儿" → Keeper Listen 72; "搜床底、床垫和衣柜" → Keeper Spot Hidden 96 (fumble); "把窗户和地板敲一遍，找暗格" → Keeper Spot Hidden 99, 83, then Dodge 71 / SAN / CON on the flying bed. Six rolls by the Keeper at 3–6 s of review each; the compile answered `decided_none` / `fell_through` because no predicate reads `resolve:core-check:ordinary-check`.
- The ordinary binder (`bind-ordinary`, runtime/jev/ordinary-resolve-domain.ts, step-policy settleOrdinaryBind) already settles skill/intent/modifiers from the declaration when asked.

## Scope
1. Contract first (§135.30 amendment): an `ordinary_check` predicate: when act clears to investigate (or social with an addressee present) and the ordinary binder settles the skill from the declaration, the compile selects the ordinary check; the binder's bind row carries the paths; admission by compile evidence applies (§32.12) when the binder's skill cleared.
2. Implement; tests, mutation-killable; replays with live Jev on fixtures from the long gate's turns 11 and 12 states: the check selected and executed by the clerk, Listen/Spot Hidden as the binder reads them.

## Comments

### 2026-09-24 — contract, implementation and the replay pre-registration (before any scored run)

**Campaign id.** The long gate's campaign is `longgate-haunting-0624` in `chatrpgv4-wt-integ-sl/.coc/campaigns` (playtest
`longgate-haunting-0624-20260924T102454Z`); `longgate-haunting-1010` in this ticket and in SL-02's Comments is not a
directory there (the turn texts and receipts match 0624). Read only; the fixtures copy it.

**Contract** §135.30.3 (`3e2826490`, test notes amended in the implementation commit): the `ordinary_check` predicate, the
binder's bind records, admission's fifth condition (`cleared: false` refuses the exemption), the Keeper's roll taking the
check, and the cost (a run whose read offers only the check now owes a compile). §135.3's `declared_check` and §32.12's
family list point at it.

**Where the predicate lives.** `COMPILE_PREDICATES` in `runtime/jev/route-compile.ts`, after `first_blow`; row building
(`compile-rows.ts`) is untouched. It fires when `act` clears on `investigate`, or on `social` with `addressee` cleared on a
person; not when `destination` cleared on a place row (the check is the destination's), nor when `ask` cleared on an open
obligation's demand (that obligation's check is the declared one); it binds `intent` from the act (`Fired.from` names the
family a parameter was read from) and never decides the check, so the route's `need` question still reads it when it does
not fire. Not `sole`.

**Fixtures.** `longgate-t11` and `longgate-t12` (shared `longgate/workspace.tar.gz`), built with `gate-fixture.mjs --home
chatrpgv4-wt-integ-sl --campaign longgate-haunting-0624 --turns 11,12 --name longgate`. The recorded Keeper of turn 11:
three `lookup`s, `resolve` Listen (intent investigate, no decision), `apply` move to the bedroom + time + threat, `resolve`
the bed-attack rule step 0 (skill Spot Hidden). Turn 12: `resolve` the bed-attack rule step 0 (no skill), then a refused
`resolve` (flee, not replayed). The harness's `resolveKey` now counts the clerk's ordinary check and a Keeper's roll of the
same skill as one roll (`product-entry.ts`), so the replayed Keeper drops its recorded Listen/Spot Hidden when the clerk
already rolled that skill; the bed-attack rule step (another key) is still replayed.

**Instrument.** `node experiments/single-loop-routing/run.mjs --fixture <f> --runs 3 --llm replay --seed 1 --out
experiments/single-loop-routing/results/sl26-<f>` on this branch: the product driver, the recorded Keeper, **live Jev**,
prescreen on, lane admission replayed. One replay process at a time. Control: `longgate-t12` with the predicate removed
(mutation M1 below, applied for that arm only), 3 runs.

**Registered acceptance (the ticket's).** In `longgate-t12`, 3/3: the compile selects `resolve:core-check:ordinary-check`
(`fired` names `ordinary_check`), the binder binds **Spot Hidden**, the clerk executes it (a policy-origin `resolve` the
kernel took, a roll receipt), its intent is `investigate` (the compile's act), and its admission row is `path: "compile"`
with no lane request for it when the skill record says `cleared: true` (a `cleared: false` run is reviewed with
`compile_refused: parameter_not_cleared:skill`, which is the rule, reported). In `longgate-t11`, see the branches below.

**Registered predictions (mine).**
- `longgate-t12`: `act` investigate ≥ 0.9 (live 1.0) and `destination` `none` ≈ 0.96 → fires 3/3. Profile Spot Hidden,
  cleared in at least 2/3. No double roll: no Keeper Spot Hidden ordinary roll after the clerk's (the recorded rule step is
  a different call and may still run). Control arm: the compile `decided_none`/`fell_through` as at the table, the route's
  `need` for the check `later`, no clerk roll.
- `longgate-t11` ("我上二楼，先站在楼梯口听一会儿，再去主卧。"). The first compile is on the ground floor with the bedroom as a
  destination row. Live it read `act` move 0.61 (cleared) and `destination` none 0.54 / bedroom 0.37 (not cleared).
  Branches, each counted:
  (a) `act` move (or anything but investigate/social) at the first compile: no fire; the Keeper's recorded Listen runs,
      consumes the check (`consumedByResolve`), and no later compile or route adds a clerk roll: **one** Listen in the run;
  (b) `destination` cleared on the bedroom: the clerk's move, then the bedroom's compile (owed by its new exits) may fire
      the check with the binder's Listen; the replayed Keeper's Listen is then dropped: **one** Listen;
  (c) `act` investigate and no destination: the clerk rolls Listen before the move; **one** Listen.
  My expectation: (a) in most runs, as live. What falsifies the change rather than the model: two Listen rolls in one run,
  a clerk ordinary check whose intent is not the compile's act, or a compile-selected check admitted without its skill
  record cleared.

### 2026-09-24 — implemented, replays, mutations, suites (branch `claude/sl26-20260924`, base `1dccf4578`)

**Commits.** `3e2826490` contract (§135.30.3; §135.3's `declared_check`; §32.12's family list). `4be7922ee` implementation
and tests. `54aae1308` pre-registration and fixtures. `b0f9f6d9d` the `bind-ordinary` row records the binder's `route` and
`consent` answers (added after the first `longgate-t12` run: a `no_roll` there had no distribution; telemetry only). The
commit carrying this comment has the results, the contract's note on that row and the manifest.

**What changed.**
- `runtime/jev/route-compile.ts`: `ordinary_check` in `COMPILE_PREDICATES` (after `first_blow`); `Fired.from` (the family a
  bound parameter was read from, so the intent's record carries the `act` answer); `ORDINARY_CHECK`. Row building untouched.
- `runtime/jev/step-policy.ts`: `ordinaryBindings(candidate, action, skill, gate)` (decision and a single actor `stated`,
  goal/method `composed`, the intent the compile's `jev`, the skill `jev` with confidence, distribution and `cleared`; no
  evidence is `cleared: false`); `settleOrdinaryBind` takes the policy gate and puts the compile's intent on the action;
  `consumedByResolve` (a model-origin resolve the kernel took consumes `resolve:core-check:ordinary-check`); `ORDINARY_CHECK_KEY`.
- `runtime/jev/check-preflight.ts`: `CheckPreflightResult.evidence` (`profile` by skill name, `route`, `consent`); the
  advisory action is unchanged. `runtime/jev/hybrid-engine.ts`: the binder's evidence onto `OrdinaryBinding.skill` and the
  `bind-ordinary` row; `admissionBindings` carries `cleared: false`.
- `extensions/kernel/admission.ts`: `compileAdmission` refuses `parameter_not_cleared:<name>`.
- `experiments/single-loop-routing/product-entry.ts`: `resolveKey` counts the clerk's ordinary check and the Keeper's roll
  of the same skill as one roll.

**Tests.** `single-loop-compile.test.mjs` +2 (the check owes a compile alone; turn 12's answers select it with the act as
intent and the binder next; the fire/no-fire table: under the gate, social without / with a `none` / with a person, move,
a cleared destination, an unclear ask, unclear; never decided; the obligation's demand selects only the obligation check),
1 updated (gate #4 turn 1: the first read now owes a compile, which selects nothing; the route follows as before).
`single-loop-binding.test.mjs` +2 (the bind records at, under and without evidence, and for another skill; the
route-selected check keeps the binder's intent; the Keeper's resolve consumes the check, a refused one does not).
`admission-within-turn.test.mjs` +2 (the emitted kernel and hybrid engine: the office search selected, bound and rolled,
admitted `path: compile` at skill 0.9 and reviewed `compile_refused: parameter_not_cleared:skill` at 0.45, rolled either
way; `compileAdmission` and `admissionBindings` pure).

**Mutations** (each applied alone; the compile, binding, admission, check-preflight ×2, domain-policy and
scene-obligation suites; restored after; all 15 killed).

| mutation | file | failing tests |
| --- | --- | --- |
| M1 the predicate reads nothing | `route-compile.ts` | 6 |
| M2 social without an addressee fires | `route-compile.ts` | 1 |
| M3 the destination guard removed | `route-compile.ts` | 1 |
| M4 the obligation-ask guard removed | `route-compile.ts` | 4 (incl. SL-21's gate #7 seam test: a second roll at the morgue) |
| M5 any cleared act fires | `route-compile.ts` | 3 (incl. SL-19's first blow) |
| M6 the intent not bound by the compile | `route-compile.ts` | 4 |
| M7 the binder's intent kept | `step-policy.ts` | 4 |
| M8 the skill always cleared | `step-policy.ts` | 3 |
| M9 no evidence counts as cleared | `step-policy.ts` | 1 |
| M10 admission ignores `cleared` | `admission.ts` | 3 |
| M11 `admissionBindings` drops `cleared` | `hybrid-engine.ts` | 4 |
| M12 the Keeper's resolve does not consume the check | `step-policy.ts` | 1 |
| M13 the engine drops the binder's evidence | `hybrid-engine.ts` | 2 |
| M14 the evidence keyed by alias, not skill name | `check-preflight.ts` | 3 |
| M15 the decision recorded `jev`, not `stated` | `step-policy.ts` | 4 |

**Replays** (live Jev, the recorded Keeper, lane admission replayed, prescreen on, one process at a time;
`experiments/single-loop-routing/results/sl26-*`).

| fixture / arm | run | compile act / destination | fired | binder (route; skill) | clerk's roll | its admission | Keeper's rolls |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `longgate-t12` (seed 1) | 1 | investigate 1.0 / none 0.96 | `ordinary_check` | **no_roll** (distribution not yet recorded) | none (consumed) | — | the bed-attack rule step (lane) |
| | 2 | investigate 1.0 / none 0.95 | `ordinary_check` | ordinary; **Spot Hidden** 0.86, cleared | **yes**, intent investigate | **compile**, 0 ms, no lane | the rule step (lane) |
| | 3 | investigate 1.0 / none 0.96 | `ordinary_check` | ordinary; **Spot Hidden** 0.89, cleared | **yes**, intent investigate | **compile**, 0 ms, no lane | the rule step (lane) |
| `longgate-t12` extra (seed 2, not registered; `route`/`consent` recorded) | 1 | investigate 1.0 | `ordinary_check` | ordinary 0.56 / no_roll 0.42; Spot Hidden 0.90 | yes | compile, 0 ms | the rule step |
| | 2 | investigate 1.0 | `ordinary_check` | ordinary 0.55 / no_roll 0.43; Spot Hidden 0.88 | yes | compile, 0 ms | the rule step |
| | 3 | investigate 1.0 | `ordinary_check` | ordinary 0.49 / no_roll 0.49; Spot Hidden 0.91 | yes | compile, 0 ms | the rule step |
| `longgate-t12` control (M1 for this arm) | 1–3 | investigate 1.0 / none 0.95–0.97 | none (`decided_none`) | — (route `need` later 0.94–0.97) | none | — | the rule step (lane) |
| `longgate-t11` (seed 1) | 1 | move 0.57 ✗ / none 0.48 ✗; in the bedroom investigate 0.65 / none 0.96 | none; none (consumed) | — | none | — | Listen (lane), then the rule step's Spot Hidden |
| | 2 | move 0.61 / none 0.50 ✗; in the bedroom investigate 0.63 / none 0.95 | none; none (consumed) | — | none | — | Listen, then the rule step |
| | 3 | move 0.58 / none 0.46 ✗; in the bedroom investigate 0.67 / none 0.96 | none; none (consumed) | — | none | — | Listen, then the rule step |

**Against the registration.** `longgate-t12`: the compile selected the check 3/3 and every executed check was Spot Hidden
with the compile's intent, admitted `path: compile` with no lane request; **executed 2/3, not 3/3**: in run 1 the binder's
route question answered `no_roll`, which consumes the check (the binder's disposition is unchanged by §135.30.3). The extra
seed-2 runs recorded why: for "搜床底、床垫和衣柜" the binder's route question sits on a coin flip between `ordinary`
(0.49–0.56) and `no_roll` (0.42–0.49), and its answer is taken ungated (the ordinary binder always did). The skill itself is
not in doubt (0.86–0.91, cleared every time). Control: as predicted, no clerk roll. `longgate-t11`: branch (a) 3/3 as
expected (the first compile reads the stair-and-bedroom sentence as a move; the Keeper's Listen consumed the check, so the
bedroom's second compile, `act` investigate 0.63–0.67, had nothing to select): one Listen per run, no clerk roll. No
falsifier seen: no double ordinary roll, no clerk check with an intent other than the compile's act, no compile admission
without a cleared skill record.

**Open, for the owner (not changed here).** (1) The binder's `route` disposition is an ungated argmax of a question that
splits about 0.5/0.5 on a plain search; with the compile already reading `act` investigate at 1.0, "does a declared search
need a roll" is the one judgment left on this clerk path. To rule on: gate the disposition (below the gates the check goes
to the Keeper), or let the compile's cleared act settle it as it settles the intent. (2) In turn 11 the declared check
comes before the declared move; the destination guard leaves such a check to the Keeper unless the first compile reads
`act` investigate. (3) The replayed Keeper still runs the module's bed-attack rule step 0 (Spot Hidden) after the clerk's
Spot Hidden; a live Keeper sees `clerk_did`. Worth watching at the next live gate.

**Suites (leehow-pc).** At `4be7922ee`: `ext` 2906/2906 (exit 0, 134 s), `loop` 137/137 (exit 0, 29 s). At `a64164a4a`
(after the telemetry commit): `loop` 137/137 (exit 0); `ext` 2904/2906 twice, with a different pair each time
(`continuity-audit`/`workspace-lifecycle`, then two `jev-source-domain` timing tests) while the box ran at load 50–55 on
16 threads; each of those files passes on the Mac at the same HEAD (3/3 and 1/1), and none is touched by this change.

### 2026-09-24 — owner rulings on the three open points, implemented; merged with the integration branch

**Rulings.** (1) When the compile's act cleared (investigate, or social with the addressee) and the binder settled a skill
that cleared the gate, the roll happens: the cleared act settles roll-or-not as it settles the intent; the binder's
roll-or-not answer is recorded and does not decide. (2) The destination guard stands as written. (3) Stands; it is a watch
item (below).

**Contract.** §135.30.3 gains "The cleared act settles roll-or-not". **Commits.** `d9e5d0b77` (the ruling: `compiled` /
roll-or-not in the binder, `settleOrdinaryBind`'s `ordinary_compile_act` and `basis.roll: {rule: "compile_act", binder:
"no_roll", confidence}`; an uncleared skill keeps the binder's `no_roll`). `0f1563bb8`: the first replay after `d9e5d0b77`
had a run left unbound on the binder's **actor** question (it answers 0.10–0.19 on this table: `actor_0` or `unknown`), so
the same argument is applied to the two parameters the compile and the kernel already give: the intent is the compile's act
and a single issued actor is stated (§135.28); consent, difficulty and the dice stay the binder's; the binder's parameter
answers are now on the `bind-ordinary` row (`parameters`). `418d3c689` and `7e32f6400` merge the integration branch at
`f0d90d626` and then `c538a0ef5` (SL-23, SL-25, SL-27); §135.30.3 stays before §135.30.4; the shared `longgate` tarball is
the integration's (the same campaign, positioned later; replays reset to `commit_before`).

**Tests.** `admission-within-turn.test.mjs` "SL-26 (owner ruling …)": the t12 run-1 shape at the seam (the binder's route
`no_roll` 0.52 / `ordinary` 0.46): Spot Hidden 0.9 is rolled, admitted `path: compile`, `basis.roll` recorded; Spot Hidden
0.45 is not rolled. It failed on `8e5c538a7` ("the binder was still asked for the skill", both subtests). `single-loop-binding`
+2: the policy's decision on the three shapes (compile + cleared, compile + uncleared, route-selected unchanged), and
`interpretOrdinaryRoute` with and without `compiled` (unknown actor and intent; two actors stay Jev's; consent still decides).

**Mutations** (all killed): R1 the engine does not pass `compiled` (3); R2 `no_roll` still ends the binding (4); R3 `no_roll`
rolled with an uncleared skill (3); R4 `basis.roll` not stamped (3); R5 the engine drops the binder's route answer (3); R6
the single actor not stated (1); R7 the binder's intent decides (1).

**Replays of `longgate-t12`** (seed 1, live Jev, recorded Keeper, lane replayed, one process at a time).

| tree | run | compile act / destination | binder route (ordinary / no_roll) | actor answer | skill | executed by the clerk | admission |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `d9e5d0b77` (ruling only) | 1 | investigate 1.0 / none 0.96 | ordinary 0.51 / 0.47 | not recorded yet (unbound) | not asked | **no** (`ordinary_unknown`: actor) | — |
| | 2 | investigate 1.0 / none 0.96 | **no_roll** 0.48 / 0.50 | — | Spot Hidden 0.89 | **yes**, `basis.roll` compile_act | compile, 0 ms |
| | 3 | investigate 1.0 / none 0.95 | ordinary 0.55 / 0.43 | — | Spot Hidden 0.88 | yes | compile, 0 ms |
| `7e32f6400` (final, merged) | 1 | investigate 1.0 / none 0.96 | ordinary 0.53 / 0.45 | actor_0 | Spot Hidden 0.88 | **yes**, actor stated | compile, 0 ms |
| | 2 | investigate 1.0 / none 0.96 | ordinary 0.55 / 0.43 | actor_0 | Spot Hidden 0.88 | **yes** | compile, 0 ms |
| | 3 | investigate 1.0 / none 0.95 | ordinary 0.52 / 0.46 | **unknown** | Spot Hidden 0.90 | **yes**, actor stated | compile, 0 ms |

Executed 3/3 on the final tree, every one Spot Hidden with the compile's intent, admitted on the compile's evidence with no
lane request. The first tree's run 2 shows the ruling itself live (the binder said `no_roll`; the clerk rolled; the basis says
why); its run 1 is what `0f1563bb8` fixed, and the final run 3 is that shape again, now rolled. The first tree's traces were
overwritten by the final ones (`results/sl26-longgate-t12-ruling`); the rows above are from its console summary.

**Watch item (3).** The replayed Keeper still runs the module's bed-attack rule step 0 (a Spot Hidden) after the clerk's
Spot Hidden (lane-reviewed, `entailed`/`authorized`). A live Keeper sees `clerk_did`; at the next live gate, check whether a
declared search in the bedroom is rolled twice (the clerk's ordinary check and the rule's step) and whether the Keeper
folds the rule's step into the clerk's roll.

**Final suites (leehow-pc, after merging the integration branch at `36edf3abf`, SL-24).** `eda3a81b9`: `ext` 2941/2941
(exit 0, 129 s, box load ~5); `loop` 149/149 (exit 0, 31 s). Before that merge, at `0742b6a91` (integration `c538a0ef5`):
`ext` 2931/2931 (exit 0, load 22), `loop` 149/149.
