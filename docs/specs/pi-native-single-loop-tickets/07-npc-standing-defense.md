Status: ready-for-agent
Stage: SL-07 (runs right after SL-02; before the SL-03 live gate)
Spec: docs/specs/pi-native-single-loop.md (Rulings: "Parameters-only steps never go to the LLM", "An NPC's defence is data")

# SL-07 — The NPC's defence is data; the fight round closes on one LLM step

SL-02's pre-registered fight-round replay (experiments/single-loop-routing/RESULTS-20260923.md, "打斗测试" turn 6) refuted the one-LLM-step line 6/6: the clerk ran the player's attack and the NPC's counter-attack, but the NPC's choice of `dodge` / `fight_back` went to the LLM because Jev answered `unknown` (0.54–0.66). Nothing states an NPC's tactic today. This ticket makes it data and closes the two defects SL-02 found beside it.

## Depends on

- SL-02 on the branch (its candidate builder `runtime/jev/candidates.ts` and hybrid engine are what this ticket extends).
- Independent of §11.5.1 (the investigator's standing defence, another session's in-flight work): the NPC side lives in the kernel's combat profile and `pending_defense`, not in host settings. If §11.5.1 has landed by the time this ticket runs, the acceptance line below counts the player's defence as automatic; if not, the Keeper's `ask` for the player's defence is the one LLM step.

## Scope

- **Contract first** (`docs/kernel-rpc.md`, a new subsection under §11.5 or the next free section; §133–§135 are taken): the NPC's standing defence and its three sources in order — (1) authored: the NPC record's combat tactic (starter/module `combat.defense`, or a Mod's declaration for the NPC), (2) the rules default computed from the profile the engine already builds (`kernel-ts/combat/profiles.ts`: fight back when the best fighting skill ≥ `dodge_skill`, otherwise dodge; `dive_for_cover` for a firearm attack as today), (3) a Keeper override written through an existing NPC state writer with an ordinary receipt and a `why`. `pending_defense` for an NPC defender carries `standing: {defense, basis: "authored" | "rule-default" | "keeper"}`; `options` stays as issued.
- **Kernel:** the profile builder computes the default; the session view issues `standing`; the writer records the override; `table.lookup`/the NPC card show the tactic as a Keeper-only line.
- **Candidate builder:** an NPC's pending defence with a `standing` is a bound step (`direct`), never a `decide` and never an `infer`; the clerk basis on the receipt names the standing's `basis`. Without a standing (should not happen once the default exists) the previous closed-choice path stays.
- **Defect 1 (SL-02):** the kernel offers `none` in `pending_defense.options` but `ask` refuses `none` as a choice, costing the live table a model call on turns 6 and 8. Reconcile per contract §11.5: either the options omit `none` for the player or `ask` accepts it; pick what the contract says and cite it.
- **Defect 2 (SL-02):** a scene handout already given is offered as a candidate every turn. Consumed by world state (`handouts_shown`), never by a text match.

## Acceptance

- Kernel tests over the emitted kernel: an NPC with an authored tactic issues it with basis `authored`; one without issues the rules default with the right comparison (both branches, and the firearm mapping); a Keeper override is a receipt, changes the standing to `keeper`, and survives resume; the NPC card shows it Keeper-only. A mutation that flips the default comparison and one that drops the override's receipt are each killed by a named test.
- Policy tests with stub ports: an NPC defence with a standing never produces a `decide` or `infer`; the receipt carries the basis.
- **Pre-registered fight-round replay** (the SL-02 fixture, product driver, 3 runs, outcomes written in RESULTS before the run): with the player naming the target, the round closes on **one** LLM step (the Keeper's `ask` for the player's defence, or the compose once §11.5.1 automates that defence); every clerk step carries its kernel row; the NPC defence step's basis is `rule-default` on this fixture unless the fixture NPC carries an authored tactic (say which).
- The `none` defect: a test at the seam that reproduces the refused choice on the parent and passes after.
- The handout defect: a candidate test that a given handout is not offered; the turn-3 replay still 8/8 with ≤ 5 LLM steps.
- `npm run test:ext` and `uv run --frozen python -m pytest tests/kernel tests/play` green on the branch's baseline; legacy path untouched.

## Not in this ticket

- The investigator's standing defence (§11.5.1, another session).
- Any change to the opposed-roll order or damage rules.
- The live table (owner's gate at SL-03).
