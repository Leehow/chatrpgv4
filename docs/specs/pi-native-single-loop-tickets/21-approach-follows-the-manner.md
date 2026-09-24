Status: ready-for-agent
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
