Status: ready-for-human
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

## Comments

### 2026-09-23 — implemented on `claude/sl07-npc-standing-defense-20260923` (from `2b5d116be`)

**Commits.**

- `666b30425`: contract §11.5.2, and the §11.9, §17.3, §23, §32.1 and §135.2 lines it touches;
- `82b6f9bda`: kernel, with the emitted-kernel tests;
- `b2e18b1f6`: candidate builder and the Keeper tool schema, with the policy tests;
- `a20bf74d5`: the replay pre-registration and the one instrument change it declares;
- `767f32052`: the scored replays on `a20bf74d5`, before the merge;
- `618667e9b`: merge of `0.9.5a` (§11.5.1 `d8e116ead`, and the SO-01/02/03 + SL-02 integration). Conflicts were
  in `extensions/kernel/tools.ts` and `tests/kernel/test_sessions.py`, and the resolutions are in the merge
  message. No kernel conflict needed a design choice;
- `3452d3766`: the registration for the merged state, and the replay's second instrument change;
- `f0ce6192a`: the scored replays on the merged state;
- the commit that carries this comment: this comment, the ticket status, the manifest.

**Contract: §11.5.2** (a `####` beside §11.5.1 after the merge, numbering unchanged). §11.5.1 (the
investigator's preference, `d8e116ead`) and §11.5.2 share no seat. `pending_defense.standing` appears only when
`for: "npc"`, beside §11.5.1's `attack_command_id` and `revision`. The authored seat is `combat.defense`, enum
`{dodge, fight_back, none}`, as ruled for RD-01. An NPC defender's `pending_defense` carries
`standing: {defense, basis}`; the Keeper's override replaces the record's authored `combat.defense`, which replaces
the rules default. `options` are unchanged.

**Where things live.**

- **The default:** `kernel-ts/combat/profiles.ts`. `npcDefenceSkills` is now the one definition of the two numbers
  a defence is rolled with (`npcCombatParticipant` spreads it), and `defaultDefense` is the comparison.
- **The standing:** `kernel-ts/combat/standing.ts` (`standingDefense`, the three sources and the firearm mapping;
  `cardTactic` for the card).
- **The issuance:** `SessionView.npcStanding` and `combatView` in `kernel-ts/read/session-view.ts`. The keeper
  pending choice is left as it was: `table.view` hands the pending choice to the player's client, so the standing
  rides only on the session view, which the Keeper reads.
- **The writer:** `apply npc {name, defense, why}`, a variant of the existing NPC state writer
  (`stageNpc`, `kernel-ts/apply/entities.ts`; §17.3). It writes `world.npc_defense[<handle>]` and mints the
  ordinary `npc` receipt with `defense`, `previous`, `why`, `visibility: "keeper"`. It stands alone in its effect
  and needs `why`. Declared in the Keeper's tool schema (`extensions/kernel/tools.ts`).
- **The card:** `look focus=npc` carries `combat_tactic` (`npcView`, `kernel-ts/read/capsule.ts`). `table.lookup`
  has no card of one person (its kinds are catalog, module, rule, secret and continuity); the
  Keeper's NPC card is `table.look focus=npc`.
- **The candidate change:** `sessionCandidates` in `runtime/jev/candidates.ts`. A standing whose word is an issued
  option binds `defense`, so the step is `direct`. Its `basis` carries `standing`, which reaches the tool and
  admission rows (§135.7) unchanged.
- **Defect 1 (`none`):** `ask` in `kernel-ts/write/index.ts`. I followed §11.5 as it stood before the merge,
  "守方是调查员时它是给玩家的选择（`dodge` / `fight_back` / 不防）", together with §11.11's "`none` 处处合法": the
  player's options keep `none`, and the kernel's `ask` accepts it. After the merge, §11.5.1 retires the defence
  `ask` altogether: the extension refuses it as `stale_choice`, and the tool lists only push, spend_luck, accept and
  flee. The kernel-level fix still removes the refusal of a word the kernel itself offers. The rewritten
  paragraph in §11.5.2 says so.
- **Defect 2 (handout):** the capsule marks a handout row `shown: true` from `world.handouts_shown`
  (`ModuleGraph.sceneAssets`), and `table.apply.options.context.handouts_shown` carries the handles for located
  handouts. The builder reads those two and no text.

**Verified (shown, not claimed).**

- **Emitted-kernel tests,** `tests/kernel/test_npc_standing_defense.py`, 13 tests:
  - authored `dodge` → `authored`, on the pending defence and on the card;
  - an authored word outside the enum falls through to the rules default;
  - the rules default fights back at Fighting 50 ≥ Dodge 17, dodges at Dodge 60, fights back on the tie at 50;
  - a firearm attack reads `fight_back` as `dodge`, and the engine rolls `dive_for_cover`;
  - a player defender has no standing;
  - the Keeper override is a receipt, and a second one records the first as `previous`. Both reach the card and
    the pending defence, and survive a narrate, a new kernel process and a new turn;
  - the override is refused whole without `why`, with another change, or with an unknown word, and nothing is
    written;
  - the tactic is Keeper-only: it is in no `narrate` result or mechanics row, and not in `table.view`;
  - `ask` accepts `none`;
  - a shown handout is marked by world state.
- **Mutations,** each run against the emitted kernel and then reverted:

  | mutation | killed by |
  | --- | --- |
  | flip the default comparison (`combatSkill < dodgeSkill`) | `test_rule_default_fights_back_when_fighting_is_at_least_dodge`, `test_rule_default_dodges_when_dodge_is_higher`, `test_rule_default_fights_back_on_a_tie` |
  | the boundary only (`>` for `>=`) | `test_rule_default_fights_back_on_a_tie` |
  | drop the override's receipt (apply skips the receipt of an `npc` effect carrying `defense`; the world write stays) | `test_a_keeper_override_is_a_receipt_changes_the_standing_and_survives_a_restart` (`StopIteration` looking up the receipt) |
  | the candidate builder ignores the standing | both SL-07 tests in `single-loop-candidates.test.mjs` and `single-loop-domain-policy.test.mjs` |
  | the builder drops the `shown` filter | the handout test in `single-loop-candidates.test.mjs` |

- **The `none` seam:** `test_ask_accepts_the_none_the_kernel_offers_the_player`. On the parent build it fails with
  the refusal SL-02 saw (`invalid_params`, `unknown mechanics choice option`); after the fix it passes.
- **Policy tests.**
  - `single-loop-candidates.test.mjs` (real kernel, pure policy): a standing is bound, and the run's first step
    is `direct execute`, so there is no decide. `basis.standing` equals the kernel's. A standing whose word the
    kernel did not issue is not trusted. Without a standing, SL-02's closed bind is unchanged. A handed-over
    handout is offered neither as a scene asset nor as a located entity, and the same row with its state withheld
    would be.
  - `single-loop-domain-policy.test.mjs` (hybrid engine on a real Pi session, stub Jev that would answer `unknown`
    to any defence question): the NPC's defence is the clerk's with `defense` equal to the standing. There is no
    bind question and no `llm_bound` row for it. Its tool row names `basis.standing.basis: "rule-default"`. After
    the merge, the player's defence is the host's under §11.5.1, and the run's only LLM step is the compose.
- **Suites.**
  - **Baselines on `2b5d116be`:** `npm run test:ext` 2595/2595; pytest 1614 passed, 1 skipped.
  - **On the pre-merge branch (`a20bf74d5` code):** test:ext 2598/2598; pytest 1627 passed, 1 skipped (+13, the
    new file). The +3 in test:ext:
    - the candidates suite's defence test, rewritten and split (1 → 2);
    - the handout test;
    - the hybrid seam test.
  - **On the merged state (`f0ce6192a`):**
    - `npm run build:runtime`: exit 0.
    - `npm run test:ext`: 2659 tests, 2655 pass, 4 fail. The same 4 fail on `0.9.5a`'s head `d8ac91733` (a
      detached worktree, built there): 2656 tests, 4 persistent failures, and 2 more that pass when run alone
      (`resolve.test.mjs`, 10/10). All 4 expect the pre-§11.5.1 defence `ask`, which `d8e116ead` now refuses as
      `stale_choice`:
      - `admission.test.mjs`: "the player's answer to an ask is not a new proposal…" and "a kernel-required
        authored encounter move…";
      - `refused-effect-is-told.test.mjs`: "a successful terminal ask delivery…";
      - `skills.test.mjs`: "required choice and active session are divergence…".

      They belong to §11.5.1's owner, and this branch does not change them. The +3 are this ticket's.
    - `uv run --frozen python -m pytest tests/kernel tests/play`: 1641 passed, 1 skipped, exit 0. `0.9.5a`'s
      own pytest count was not measured; the +13 here are the new file.
    - `tsc -p tsconfig.kernel.json`: exit 0.
  - **Edited, not added:**
    - `ts-kernel-read.test.mjs` asserts the new card line on the oracle's doctor, and compares the rest with the
      frozen oracle unchanged;
    - `test_sessions.py` pins Corbitt's standing beside §11.5.1's fields;
    - after the merge, the hybrid seam test's stub Keeper composes with `narrate`, because a defence `ask` is now
      refused.
- **Replays** (product driver, `--admission lane`, 3 runs each, every run pre-registered). Details are in
  `experiments/single-loop-routing/RESULTS-20260923.md`.

  | state | fixture | LLM steps | Knott's defence | basis | player's defence | live actions | Handout 1 offered |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | `a20bf74d5` (pre-merge) | fight round | 2 ×3 (Knott's own action, `ask`) | clerk `dodge`, no Jev, no LLM ×3 | `rule-default` ×3 | Keeper `ask` | 3/3 ×3 | 0 (SL-02: 2 per run) |
  | merged | fight round | **1** in run 2; 2 in runs 1 and 3 (Knott's own action, prose close) | clerk `dodge`, no Jev, no LLM ×3 | `rule-default` ×3 | host, §11.5.1, `dodge` ×3 | 3/3 ×3 | 0 |
  | pre-merge | turn 3 | 5 ×3 | — | — | — | 8/8 ×3, move clerk (`now` 0.70–0.84) | 0 (SL-02: 1 per run) |
  | merged | turn 3 | 5 ×3 | — | — | — | 8/8 ×3, move clerk (`now` 0.73–0.76) | 0 |

  **The fight round's "one LLM step": confirmed 1/3 on the merged state, refuted 2/3 (and 0/3 before the
  merge).** The step this ticket targeted is gone in all six scored runs: Knott's defence was never a Jev question
  or an LLM step. What remains beside the prose is Knott's own action. Jev picks `combat:attack` at the gate's
  edge: 0.57 / 0.60 / 0.57 merged, and 0.49–0.57 pre-merge, where SL-02's re-run had 0.72–0.73. Run 2 cleared
  the 0.6 gate and closed on one step. The bind batch's state is not in the trace, so I cannot say what moved the
  confidence down from SL-02's. The state before the question differs: Knott dodged by his standing, where SL-02
  replayed the live Keeper's `fight_back`.

**Assumed, not verified.**

- No live table (SL-03 is the owner's gate).
- The fixture NPC has no authored tactic, so the `authored` basis is shown only by the kernel tests, on a content
  copy.
- The "Mod's declaration" source of the ruling has no carrier. No Mod contribution kind holds a closed defence
  word (§28's `actor_profile_keys` are free text asked of a book). §11.5.2 says so, and the source is the book's
  alone until one is contracted.

**Left out, and why.**

- **A caption for `none`.** §11.5.1 retires defence controls for new player defences, so no caption is added.
- **Knott's own action (the step that still decides 2 of 3 runs).** The ruling's parameters-only line sends an NPC's free choice among options the kernel
  cannot rank to the LLM. Whether the NPC's action choice should also become data, like the defence, or whether
  the bind's gate should differ for it, is the owner's decision, not this ticket's.
- **Resolving an NPC defence without `defense`.** The kernel still requires the word; the standing does not
  become an implicit default in `resolve`. The ticket did not ask for it.
- **The `authored` source from PDFs.** No reader asks for `combat.defense`. Hand-authored starters and module JSON
  can carry it today.

**Scratch left behind.** None in the worktree. The replay workspaces are removed per run. One detached worktree
at `0.9.5a` (`d8ac91733`) is left in the session scratchpad (`sl07-base-095a`), used for the baseline above. It
is not removed, because removing worktrees needs the owner's word.
