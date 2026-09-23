Status: ready-for-agent
Stage: SL-08 (right after SL-07; before the SL-03 live gate)
Spec: docs/specs/pi-native-single-loop.md (Rulings: "Parameters-only steps never go to the LLM", "An NPC's defence is data", "An NPC's action in a fight is data too")

# SL-08 — The NPC's own action in a fight is a standing; the fight round closes on the compose

SL-07's merged replay (experiments/single-loop-routing/RESULTS-20260923.md, "打斗测试" turn 6) closed the fight round on one LLM step in 1 of 3 runs and on two in the others. The NPC's defence was never a question any more; the remaining LLM step was Knott's own action, where Jev chose `combat:attack` at 0.57–0.60 against the 0.6 gate. Nothing states whether a hostile NPC attacks. This ticket makes it data, next to SL-07's defence.

## Depends on

- SL-07 merged (`kernel-ts/combat/standing.ts`, §11.5.2, `runtime/jev/candidates.ts` session candidates).
- The stance state (`stance.value` hostile/wary/neutral/warm, `content/rulesets/coc7/rules-json/npc-stance.json`; any combat target is hostile).

## Scope

- **Contract first:** extend §11.5.2 (a sibling subsection, e.g. §11.5.3; never renumber) with the NPC's standing action and its three sources in order: (1) authored `combat.action` on the NPC record, enum `{attack}` only in this ticket (a book may state that a creature always attacks; nothing else is authored as a standing); (2) rules default `attack` when the NPC's stance is `hostile`, it can act (hp > 0, no out-of-fight condition) and it has at least one legal target; otherwise **no standing** (the Keeper decides); (3) Keeper override `apply npc {action, why}` with `{attack, hold}` (`hold` = do not attack this round; the Keeper narrates why), a normal receipt, `why` required. The session view issues `standing_action: {action, basis: authored|rule-default|keeper}` on the combat view when `turn_of` is an NPC; absent when no standing.
- **Kernel:** compute in `kernel-ts/combat/standing.ts` beside the defence; writer beside SL-07's `defense` variant in `kernel-ts/apply/entities.ts` (`world.npc_action[handle]`); the NPC card shows it Keeper-only beside `combat_tactic`.
- **Candidate builder** (`runtime/jev/candidates.ts` session candidates): on an NPC's turn with `standing_action.action = attack`, the `combat:attack` step is bound (`direct`) when exactly one legal target and one ready weapon exist; with several targets or weapons, `decide(bind)` over the closed lists (the kernel's `targets`/`weapons`); `hold` issues no attack candidate and the turn is the Keeper's; no standing → the previous route (Jev among the issued actions). The receipt's basis names the standing's `basis`.
- Nothing about flee, manoeuvre, aim or reload: those are Keeper actions.

## Acceptance

- Kernel tests over the emitted kernel: hostile + able + target → `rule-default attack`; not hostile, or no target, or out of the fight → no standing; authored `attack` → `authored`; Keeper `hold` → `keeper`, a receipt, survives resume; the card line Keeper-only. Mutations killed by named tests: flip the stance condition; drop the "has a legal target" condition; drop the override's receipt.
- Policy tests with stub ports: one target + one weapon → direct; several → `decide(bind)`; `hold` → no attack candidate; no standing → route.
- **Pre-registered fight-round replay** (the SL-02 fixture, product driver, 3 runs, outcomes in RESULTS before the run): with the player naming the target, the round closes on **one** LLM step (the compose) in 3/3; every clerk step carries its kernel row; Knott's action basis is `rule-default` (he is hostile after being attacked) unless the fixture says otherwise.
- Turn-3 replay still 8/8 with ≤ 5 LLM steps.
- `npm run build:runtime`, `npm run test:ext`, `uv run --frozen python -m pytest tests/kernel tests/play` green on the branch's baseline (record it first); legacy path untouched.

## Not in this ticket

- Creatures' attack routines (multiple attacks per round, `attacks_per_round`) — rules-as-data RD tickets.
- Any change to the opposed-roll order or damage rules.
- The live table (owner's gate at SL-03).
