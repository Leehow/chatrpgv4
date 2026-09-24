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
