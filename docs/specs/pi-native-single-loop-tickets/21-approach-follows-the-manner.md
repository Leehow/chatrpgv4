Status: ready-for-human
Stage: SL-21 (amends SL-12's approach default; after SL-18)
Spec: docs/specs/pi-native-single-loop.md (Ruling: "The approach follows the declaration's manner, not the actor's numbers")

# SL-21 — The approach's default is Jev's lead, never the actor's highest skill

## Evidence (live gate #7, campaign gate7-haunting-0534, turn 2, run run-01a0d2c6-2549-7171-a3d9-b9ee6eaddf9a)
- bind s4: skill Persuade 0.67 / unknown 0.31 / Intimidate 0, confidence 0.59 (< 0.6) → rules default `highest_offered_skill` = Intimidate; the clerk executed `resolve:obligation:globe-clippings-access` with skill Intimidate; the admission lane refused: grounds "explaining purpose and asking a favor; nothing chooses coercion".
- The admission row for that write shows `path: lane` with no `compile_refused` reason although the compile had selected the candidate with ask 0.91 and addressee 0.51 cleared: find why the compile-evidence exemption (§32.12) was not applied or not recorded on a candidate that went through a bind step (`clerkBind` rebuilds the candidate; check `basis.compile` and the bind records survive to admission).

## Scope
1. Contract first: amend §135.28 (rules defaults) with the dated ruling: the approach's default is `jev_lead` (Jev's leading stated skill, any confidence, recorded with its distribution); `highest_offered_skill` only when Jev answers `unknown`/does not answer. Update SL-12's ticket with a pointer.
2. Implement in runtime/jev/obligation-candidates.ts / step-policy.ts (`ruleDefaultOf`/`clerkBind`): the bind record carries `path: rule-default, rule: jev_lead, confidence, distribution`.
3. Fix the exemption path so a compile-selected candidate that went through a bind keeps `basis.compile` and its `read_features`, and the admission row records `compile_refused` when the exemption is refused; add a test with the gate-7 shape (compile selected, bind under the gate, admitted by compile evidence).
4. Tests, mutation-killable (jev lead ignored; highest skill used with a lead; compile basis lost on bind). Replay gate3-t2 and a fixture from gate7 turn 2 (campaign under chatrpgv4-wt-integ-sl/.coc/campaigns, read-only), live Jev, 3 runs each: the approach is Persuade with rule jev_lead when under the gate, and the admission row is path compile.

## Comments

### 2026-09-24 — cause found, reproduced, and the replay pre-registration (before any scored run)

**Why the gate #7 check was reviewed with no `compile_refused`.** `runtime/jev/step-policy.ts` `settleExecute` (the
§135.26 hand-on, `const follow = … view.candidates.find(value => value.key === item.candidate!.then)`, line 772 at
`97285f39f`): after a carried step lands, the policy takes the candidate it was carried for **as the fresh read re-issues
it**. `basis.compile` lives only on the candidate `interpretCompile` returned, and `itemsFor` (line 695) replaced that
candidate by its `before` step, keeping only the key in `then`. The fresh read's candidate is the builder's: kernel row,
no `compile`. So the bind (s4) stamped `binding`/`rule_default` on a basis with no `compile`, the host origin carried
none, and `compileAdmission` returned `undefined` ("not a compile selection"), which is exactly `path: "lane"` without a
reason. The admission row's own `basis` shows it: `obligation`, `step`, `row`, `binding`, `rule_default`, no `compile`.
`clerkBind` itself keeps the basis (it spreads `candidate.basis`); the loss is one step earlier. Gates #3 and #6 never hit
it: Arty was already on stage, so the check carried no meeting.

**Reproduced before the fix** (`tests/extension/admission-within-turn.test.mjs`, "SL-21 (§32.12): the check the compile
selected keeps its evidence through the book's meeting and its bind", emitted kernel, Arty not yet staged, the gate #7
compile 0.91 / 0.51 by the margin / 0.97): with Jev's approach above the gate the admission row had no `basis.compile`
(`path: lane`); with the gate #7 approach (Persuade 0.67 at 0.59) the clerk also rolled **Intimidate** by
`highest_offered_skill` (the test investigator's highest of the four, like Hayes).

**Replay pre-registration.** Instrument: `node experiments/single-loop-routing/run.mjs --fixture <f> --runs 3 --llm replay
--seed 1 --out experiments/single-loop-routing/results/sl21-<f>` on this branch: product driver, the recorded Keeper,
**live Jev**, prescreen on, lane admission replayed. Fixtures: `gate3-t2` (existing; Arty already on stage) and `gate7-t2`
(new, built with `gate-fixture.mjs` from `chatrpgv4-wt-integ-sl/.coc/campaigns/gate7-haunting-0534`, read-only; Arty not
on stage, so the check carries the meeting). One replay process at a time.

Registered acceptance (the ticket's): in each fixture, 3/3 runs where the compile selects the check have the approach
**Persuade**, with `rule: jev_lead` whenever Jev's answer is under the gate, and the check's admission row **`path:
"compile"`** with no lane request for it.

Registered predictions (mine):
- `gate3-t2`: the compile selects the check 3/3 (SL-18/SL-20 replays: ask 0.73–0.84). Jev's approach clears the gate
  (SL-18: Persuade `jev` 0.77–0.78) in most runs, so the record is `path: jev`; a run under the gate is `rule-default` /
  `jev_lead` Persuade. Admission `path: compile` 3/3 (the fork ruling: an unclear addressee is not evidence against).
- `gate7-t2`: the compile selects the check 3/3; the clerk stages Arty first (`apply:person:Arty Wilmot`), then binds and
  rolls the check. Approach Persuade 3/3 (`jev` or `jev_lead`; live gate #7 answered Persuade 0.67 at 0.59). Admission
  `path: compile` 3/3 with `basis.compile.predicate: obligation_check`; no `Intimidate` anywhere in the clerk's writes.
- What would falsify the fix rather than the model: a compile-selected check with a lane row and no `compile_refused`, or
  a `rule: highest_offered_skill` record while Jev's answer led with an offered skill. A run in which Jev leads with
  `unknown` and the fallback takes Intimidate is the rule doing what it says (reported, not a defect).

### 2026-09-24 — implemented (branch `claude/sl21-20260924`, base `97285f39f`)

**Commits.** `fccce8f18` contract: §135.28's approach bullet (dated SL-21 amendment: `jev_lead`, then
`highest_offered_skill`), the path table and the Keeper line; new §32.12.1 (the compile's evidence survives the step the
book puts first); §135.30's `basis.compile` line. `d30f84488` implementation and tests. `5e0f7b1ad` the cause, the
reproduction, this ticket's pre-registration and the `gate7-t2` fixture. The commit carrying this comment has the replay
results, the SL-12 pointer and the manifest.

**What changed.**

- `runtime/jev/obligation-candidates.ts`: the approach's parameter carries `ruleDefault: {rule: "jev_lead", fallback?:
  {rule: "highest_offered_skill", value | by}}`. The fallback is absent when the kernel binds no value.
- `runtime/jev/step-policy.ts`:
  - `RuleDefault` gains `jev_lead` and `fallback`.
  - `ruleDefaultOf` takes Jev's leading choice and returns the rule that decided. `jev_lead` takes the lead when it is an
    offered option (never `unknown`), else the fallback.
  - `clerkBind` keeps each unsettled parameter's lead. The record is `path: rule-default, rule: jev_lead` with the
    answer's confidence and distribution. The basis gets `rule_default: {skill: {value, rule: "jev_lead"}}`.
- The exemption path:
  - `itemsFor` puts the selected candidate's `basis.compile` on the carried step as `thenCompile`.
  - `settleExecute` re-applies it to the re-issued candidate through `carryCompile` (`runtime/jev/route-compile.ts`).
    `carryCompile` keeps the fresh row, adds `basis.compile`, and re-binds any compile-settled parameter. It fails
    closed when that value is no longer offered.
- `runtime/jev/hybrid-engine.ts`: the Keeper's rules-default line glosses `jev_lead`.
- SL-22's areas (the read step's Jev accounting, `exhausted`/`jev_budget`) are untouched.

**Tests.**

- `tests/extension/single-loop-binding.test.mjs`, 4 new, 3 updated:
  - gate #7's answer binds Persuade `jev_lead` with its distribution over Hayes-like values, at any confidence; above
    the gate it is `jev`;
  - the fallback is taken only on `unknown`, unanswered, unavailable, a non-offered lead, or a spent budget; with no
    fallback a lead still binds and `unknown` goes to the Keeper;
  - through the carried meeting, the hand-on and the bind, `basis.compile` survives and `compileAdmission` admits;
  - a compile-settled parameter is re-bound, and not carried when no longer offered;
  - the structural test gains two `jev_lead` shapes.
- `tests/extension/admission-within-turn.test.mjs`, 1 new with 3 subtests: the gate #7 shape at the seam, with the
  emitted kernel and Arty not staged. Jev at 0.9 gives `jev`; at 0.59 it gives `jev_lead`. Both are admitted `path:
  compile` with no lane. The carried check with its ask under the gate goes to the lane with `compile_refused:
  feature_not_cleared:ask`. The first two subtests failed before the fix: no `basis.compile`, and Intimidate.
- `scene-obligation-candidates.test.mjs`: the rule shape.

**Mutations.** Run in this worktree. Each mutation was applied in turn, then the binding, admission, scene-obligation,
compile and domain-policy suites ran, then the file was restored. All 8 were killed.

| mutation | file | failing tests |
| --- | --- | --- |
| M1 Jev's lead ignored (always the fallback) | `step-policy.ts` | 5 |
| M2 the highest skill used although there is a lead (fallback first) | `step-policy.ts` | 4 |
| M3 compile basis lost on the hand-on (`follow = found`) | `step-policy.ts` | 7 |
| M4 `thenCompile` not recorded on the carried step | `step-policy.ts` | 5 |
| M5 compile basis lost on the bind (`clerkBind` drops `compile`) | `step-policy.ts` | 3 |
| M6 `carryCompile` fails open | `route-compile.ts` | 1 |
| M7 a lead outside the offered options taken | `step-policy.ts` | 1 |
| M8 compile-settled values not re-bound | `route-compile.ts` | 1 |

M3's 7 includes `§32.12 (a)`. That is the 12 s real-socket timing test, which does not read the hand-on. It passes at
HEAD here and on leehow-pc, so treat it as load noise and not as a kill.

**Replays.** Live Jev, the replayed Keeper, lane admission replayed, prescreen on, one process at a time.

| fixture / arm | run | compile ask / addressee / act | meeting | approach record | check's admission row |
| --- | --- | --- | --- | --- | --- |
| `gate3-t2` (seed 1) | 1 | 0.76 / 0.52 ✓ / 0.97 | — (Arty on stage) | Persuade `jev` 0.76 | **compile**, 0 ms, no lane |
| | 2 | 0.78 / 0.49 ✓ / 0.97 | — | Persuade `jev` 0.76 | **compile**, 0 ms, no lane |
| | 3 | 0.84 / 0.56 ✓ / 0.97 | — | Persuade `jev` 0.75 | **compile**, 0 ms, no lane |
| `gate7-t2` (seed 1) | 1 | 0.88 / 0.52 ✓ / 0.95 | Arty staged | Persuade `jev` 0.65 | **compile**, 0 ms, `basis.compile` present, no lane |
| | 2 | 0.87 / 0.43 ✗ / 0.96 | Arty staged | Persuade `jev` 0.67 | **compile**, 0 ms, no lane |
| | 3 | 0.84 / 0.40 ✗ / 0.96 | Arty staged | Persuade `jev` 0.62 | **compile**, 0 ms, no lane |
| `gate7-t2` extra (seed 2, not registered) | 1 | 0.92 / 0.44 ✗ / 0.96 | Arty staged | Persuade `jev` 0.68 | **compile**, no lane |
| | 2 | 0.90 / 0.42 ✗ / 0.95 | Arty staged | **Persuade `rule-default`, `rule: jev_lead`, 0.55** | **compile**, `binding_paths.skill: rule-default`, no lane |
| | 3 | 0.92 / 0.44 ✗ / 0.97 | Arty staged | Persuade `jev` 0.63 | **compile**, no lane |
| `gate7-t2` control: M3 applied for this arm only (seed 1) | 1 | 0.90 / 0.53 ✓ / 0.97 | Arty staged | Persuade `jev_lead` 0.56 | **lane, no `compile_refused`, no `basis.compile`** |
| | 2 | 0.90 / 0.49 ✗ / 0.96 | Arty staged | Persuade `jev` 0.63 | **lane, no `compile_refused`** |
| | 3 | 0.81 / 0.67 ✓ / 0.97 | Arty staged | Persuade `jev` 0.68 | **lane, no `compile_refused`** |

The registered acceptance is met in both fixtures, 3/3 each. The compile selected the check, and every approach was
Persuade. The check's admission row was `path: compile` with zero lane requests for it, including the three `gate7-t2`
runs where the addressee did not clear.

No registered run fell under the gate, so `jev_lead` was not exercised in the scored arms. The extra arm's run 2 was
under the gate: it bound `jev_lead` Persuade and was admitted by the compile, the gate #7 case end to end. The
control's run 1 also bound `jev_lead` at 0.56.

The control reproduces the live defect 3/3: `path: lane`, no `compile_refused`, no `basis.compile` on the row. The
lane's `not_authorized` in the control is the recorded gate #7 verdict replayed, not a new judgment. Predictions held.
No `Intimidate` appeared in any clerk write. Results are in `experiments/single-loop-routing/results/sl21-{gate3-t2,
gate7-t2,gate7-t2-extra,gate7-t2-control-no-carry}`.

**Suites** (leehow-pc, at `5e0f7b1ad`):

- `test:ext` 2892/2892, exit 0.
- Loop suites 127/127, exit 0.
- pytest not run: no kernel input changed (`kernel-ts/`, `content/`, `prompts/`, `tests/kernel` and `tests/play` are
  untouched).

**Not done.** No live table and no packaging.
