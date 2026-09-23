Status: ready-for-human
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

## Extension (owner, 2026-09-23, "An NPC's fight behaviour follows the NPC's own parameters")

The rules default is no longer "attack while hostile". It is the ruleset table `npc-combat-disposition.json` applied to the NPC's **combat disposition** (closed enum `fights_to_the_end` / `fights_then_flees` / `avoids_fighting` / `surrenders`) and the fight's state (HP fraction, outnumbered, stance). Disposition sources, in order: authored `combat.disposition` on the record; inferred once per campaign by Jev from the record's own text parameters (`agenda`, `fear`, `secret`, `relationship_to_investigators`, `voice`, natural-npc's disposition if present) as a closed-choice question, written to `world.npc_disposition[handle]` with a receipt, `basis: inferred` and the list of parameters read (below the gate: the Keeper is asked once through the existing needs path and writes it); Keeper override `apply npc {disposition, why}`. The standing action enum becomes `{attack, hold, flee}`: `attack` binds as above; `hold` and `flee` issue no attack candidate and hand the turn to the Keeper with the disposition line (the flight or surrender is narrated; the engine's NPC actions do not include flee). Every threshold lives in the table; code holds no literal. Acceptance adds: the table's rows are exercised by kernel tests (each disposition at full HP and below its threshold); a Jev-inferred disposition is a receipt that survives resume and is never inferred twice; the fight-round replay reports Knott's disposition and its basis. If the inference and the table do not fit this ticket's time, deliver the enum, the sources and the table first and leave the Jev inference as SL-09, saying so.

## Not in this ticket

- Creatures' attack routines (multiple attacks per round, `attacks_per_round`) — rules-as-data RD tickets.
- Any change to the opposed-roll order or damage rules.
- The live table (owner's gate at SL-03).

## Comments

### 2026-09-23 — implemented on `claude/sl08-npc-standing-action-20260923` (from `4f9331a87`, with the Extension)

**Commits.** `d706b0a80` (the Extension ruling, cherry-picked from `3671e2538`); `d6ddaaf27` contract §11.5.3,
§135.2, §136 seats; `b8c6adf3f` kernel (table, standing action, overrides, validator, the defence's `npc` stamp);
`bc9e0aaea` candidate builder + Keeper note + tool schema; `06ddc1880` contract (the inference, §135.3 authority);
`f9e327594` kernel (inferred disposition, card input); `d8bd517c0` builder/engine/extension (the inference);
`f3ee3418b` and `93b69ab87` fixes found by the suites; merges `f1bdffb44` (0.9.5a, §11.5.1 test fixes and
`009b1f287`) and `45e3901e9` (0.9.5a with RD-02 `172b80065`; the lookups go through `ModuleGraph.actor`);
`6de789115` replay pre-registration; `a55de752c` scored replays; this comment's commit.

**Contract.** §11.5.3 (a sibling of §11.5.2; nothing renumbered), plus lines in §11.5, §11.9, §17.8, §135.2, §135.3,
§136.1/§136.6 item 11/§136.8, §136.10, §136.12.

- **The standing action** `session.standing_action: {action, basis, disposition?, read?}`, on an NPC's own turn
  with no pending attack. Order: a live Keeper override (`apply npc {action, why}`, `attack` stands, `hold` holds
  for its fight and round), else the record's authored `combat.action` (`attack`), else the ruleset table over the
  NPC's combat disposition and the fight's state. The NPC must be able to act; an `attack` needs a legal target.
- **The disposition** (`fights_to_the_end` / `fights_then_flees` / `avoids_fighting` / `surrenders`): a Keeper
  override (`apply npc {disposition, why}`), else the authored `combat.disposition`, else one Jev inferred once per
  campaign (`basis: "inferred"`, `read`).
- **The table** `content/rulesets/coc7/rules-json/npc-combat-disposition.json` (`coc.npc-combat-disposition.v1`),
  first matching rule wins, conditions `hp_fraction_at_most` / `outnumbered` / `stance_in`, every threshold in the
  file:

  | disposition | rules, in order |
  | --- | --- |
  | `fights_to_the_end` | `attack` |
  | `fights_then_flees` | hp ≤ 0.5 → `flee`; hp ≤ 0.75 and outnumbered → `flee`; stance wary/neutral/warm → `hold`; `attack` |
  | `avoids_fighting` | outnumbered → `flee`; hp ≤ 0.75 → `flee`; `hold` |
  | `surrenders` | hp ≤ 0.75 → `hold`; outnumbered → `hold`; stance wary/neutral/warm → `hold`; `attack` |

- **The inference's question shape.** On an NPC's turn without a standing, the run reads that NPC's card. A card
  with no disposition and no action word carries `combat_disposition.options` (the four words with the table's
  `description`s) and `material` (the contract's actor-dossier `profile_keys` the book states). The builder adds a
  settled natural-npc first impression and makes a forced candidate `apply npc {name, disposition, why}` (authority
  `disposition_inference`). It is one Jev `single-loop-bind` question: key `disposition`, type choice, criteria the
  four descriptions plus `unknown`, instruction "judged only from their own parameters", state = the candidate
  with `detail.person` (the material) and `detail.fight`. At or above the gate the clerk writes it; the kernel
  extension adds `_inferred: {read}` to that one call and deletes it from every other. Below the gate the Keeper
  completes the write (`infer(bind)`) as an override. The kernel refuses a second inference
  (`disposition_already_set`).

**Where things live.** Default and table: `kernel-ts/combat/standing.ts` (`dispositionTable`, `tableAction`,
`stanceNow`, `dispositionOf`, `keeperAction`, `authoredAction`, `standingAction`, `cardAction`,
`inferenceInput`), enums in `kernel-ts/combat/standing-words.ts`. Issuance: `SessionView.npcAction`/`combatView`
(`kernel-ts/read/session-view.ts`), tables and ledger preloaded during a fight (`kernel-ts/read/campaign.ts`).
Writer: `stageNpc` in `kernel-ts/apply/entities.ts` (`world.npc_action`, `world.npc_disposition`). Card:
`look focus=npc` → `combat_disposition`, `combat_standing` (`kernel-ts/read/capsule.ts`, `handlers.ts`). Named
`combat_standing` because `combat_action` is already the public mechanics row's field. Validator:
`kernel-ts/modules/mechanics-shape.ts`. Candidates: `sessionCandidates`/`dispositionInference` in
`runtime/jev/candidates.ts`, the card read and the `npc_turn` note in `runtime/jev/hybrid-engine.ts`, the authority
in `runtime/jev/step-policy.ts`, the marker in `extensions/kernel/index.ts`, the schema in
`extensions/kernel/tools.ts`.

**Found and fixed beside it.** A combat defence is its own `resolve` with no `target`, so the investigator's roll
against an NPC defender never carried `npc`, and §17.3's "a combat target is hostile" never folded for such a
fight (`kernel-ts/resolve/projection.ts`). The Extension's stance reading depends on it.

**Verified (shown, not claimed).**

- Kernel, `tests/kernel/test_npc_standing_action.py` (31 tests, emitted kernel): every table row (14, each
  disposition at full HP and below its thresholds, outnumbered, stance); the open-turn fold; no standing out of the
  fight, without a legal target, or while an attack is pending; authored `attack`; authored words outside the
  enums refused at registration; Keeper `hold` (receipt, survives a restart, lapses with its round); Keeper
  `attack` and disposition; refusals; the Keeper-only card; the inference input on the card; an inferred
  disposition (receipt, `read`, written once, survives a restart, refused over the book's); an unreadable ledger
  withholds the table's reading.
- Policy/seam: `single-loop-candidates.test.mjs` +4 (one target and weapon → direct; several → `decide(bind)` over
  `targets`/`weapons`; `hold`/`flee` → nothing; no or untrusted standing → the previous route; the inference bind
  above and below the gate). `single-loop-domain-policy.test.mjs` +4 (the clerk's standing attack with its row and
  one LLM step; a hold with the `npc_turn` note; Jev infers and the clerk writes `basis: "inferred"`; a model call
  carrying `_inferred` is written `basis: "keeper"`). `mechanics-shape.test.mjs` +5.
- Mutations, each killed by a named test (run in a scratch worktree, then restored):

  | mutation | killed by |
  | --- | --- |
  | flip the stance condition | `test_the_rules_default_reads_the_disposition_table` (5 rows) |
  | drop the legal-target condition | `test_an_attack_without_a_legal_target_is_not_issued` |
  | drop the action override's receipt | `test_a_keeper_hold_is_a_receipt_survives_a_restart_and_lapses_with_its_round` |
  | drop the open turn from the stance fold | `test_the_stance_is_the_ledger_folded_with_the_open_turn` |
  | the defence's rolls stop naming the NPC | `test_the_stance_is_the_ledger_folded_with_the_open_turn` |
  | a disposition inferred twice | `test_an_inferred_disposition_is_a_receipt_is_written_once_and_survives_a_restart` |
  | a hold not scoped to its round | `test_a_keeper_hold_is_a_receipt_survives_a_restart_and_lapses_with_its_round` |
  | the builder ignores the standing | 6 SL-08 tests in the two single-loop suites |
  | the extension passes a model's `_inferred` | "a model's apply cannot carry the host-only inference marker" |
  | a book may author a flight | "shape_prose: a standing action a book cannot author" |

- Suites. Baseline on `4f9331a87`: test:ext 2705 tests, 4 failing (the four named in the brief:
  `admission.test.mjs` ×2, `refused-effect-is-told.test.mjs`, `skills.test.mjs`); pytest 1640 passed, 1 skipped,
  1 failed (`test_npc_standing_defense.py::test_an_authored_word_outside_the_enum_falls_through_to_the_rules_default`,
  RD-01's validator against SL-07's test, fixed on 0.9.5a by `009b1f287`). 0.9.5a at `009b1f287`: test:ext
  2706/2706. 0.9.5a at `172b80065`: test:ext 2715 tests, 2713 in a run under load, and the two failing files
  (`npc-preparation-integration`, `ts-kernel-git`) passed 11/11 alone. The coordinator reported 2715/2715 and
  pytest 1645 passed, 1 skipped; I did not rerun that pytest. **Final merged state `45e3901e9`:**
  `npm run build:runtime` exit 0; `npm run test:ext` 2728/2728 (+13); `uv run --frozen python -m pytest
  tests/kernel tests/play` 1676 passed, 1 skipped (+31, the new file). Legacy engine untouched.
- Replays (pre-registered in `6de789115`, scored in `a55de752c`, RESULTS "SL-08"). Fight round: **refuted 0/3, as
  predicted**, 2 LLM steps in each run. Jev leaned `fights_then_flees` for Knott (0.39–0.45 of the distribution)
  at confidence 0.24–0.31, below the gate, so the Keeper was asked. The replayed Keeper cannot write a disposition,
  so none was written and Knott's attack was the recorded model call. Every clerk row carries its kernel row;
  Knott's defence was clerk `dodge` (`rule-default`); the player's defence was the host's. Turn 3: 8/8 ×3, 5 LLM
  steps, no disposition question.

**Assumed, not verified.** No live table (SL-03). The replay cannot show the Keeper writing a disposition, or
narrating a `hold`/`flee`. The `inferred` path above the gate is shown by the seam test with a stub Jev, not live.

**Left out, and why.**
- A question asked below the gate and left unanswered is asked again on the NPC's next turn: nothing records it.
  "Asked once" holds per run, not per campaign (§11.5.3 says so).
- Creatures: RD-02's `actor` lookups are used, but the stance ledger is `npc`-only and the NPC card is `npc`-only,
  so a creature's stance reads the initial word and its disposition is never inferred (§11.5.3 says so).
- A Mod-declared disposition: no Mod contribution kind carries one (as §11.5.2 for the defence).
- The Keeper override `action` stays `{attack, hold}` as the ticket wrote it; `flee` comes only from the table.
- Flee, manoeuvre, aim and reload as clerk steps; attack routines: out of scope.

**Scratch left behind.** Two detached worktrees in the session scratchpad (`sl08/base` at `172b80065`,
`sl08/mut` at `45e3901e9`, both clean), and `.venv` in this worktree (ignored), which `uv` created. Nothing was
removed, because removing worktrees needs the owner's word.
