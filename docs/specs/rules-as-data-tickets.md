# Rules are data — tickets

Spec: [rules-as-data.md](rules-as-data.md) (`Status: ready-for-human`; owner questions Q1–Q5 open).
Parent plan: [pi-native-single-loop.md](pi-native-single-loop.md), Rulings, "Rules are data"; first two shapes: [scene-obligations-as-candidates.md](scene-obligations-as-candidates.md) (§134) and [07-npc-standing-defense.md](pi-native-single-loop-tickets/07-npc-standing-defense.md) (SL-07, on `0.9.5a`).

State: **every ticket is `needs-triage`** until the owner has answered Q1–Q5 and accepted the spec. The order below is the dependency order; nothing here is scheduled yet.

Common constraints for every ticket (from `Agents.md` and the spec): contract first (`docs/kernel-rpc.md`, one new section at the next free number, amending the sections the spec's Further Notes names); `kernel-ts/` is the only kernel; system language English, no CJK in code; no hard-coded semantic lists (closed enums of mechanical forms and ruleset table keys are fine; word lists over text are not); no code ever parses prose into a shape; build before pytest, one pytest at a time, on the ticket's own worktree, never while the tree changes; stage only the ticket's paths; no packaging unless the ticket says so; never modify playtest evidence or the original replay fixtures; `mystery-house`, `voice-bench` and `the-haunting-rulebook` stay byte-identical (capsule, `table.apply.options`, `table.resolve.options`, module lookup, walked scene by scene, against goldens recorded on the ticket's parent commit) unless the ticket says otherwise; every product-behaviour test is killed by a named mutation recorded in the report.

## Dependency graph

```
SO-01 (landed) ── RD-01 validator + contract ─┬─ RD-02 readers + mech line ── RD-03 action.rule / stated ── RD-04 haunting migration ─┬─ RD-07 side table out
                                              │                                                                                   └─ RD-08 mystery-house (after a live table)
SO-03 (in progress) ──────────────────────────┴─ RD-05 PDF reader
SL-02 merged + SO-04 + RD-02 ──────────────────── RD-06 Jev seams
SL-07 landed ───────────────────────────────────── RD-09 tactic registered
```

RD-02 and RD-05 can run in parallel after RD-01 (RD-05 also waits for SO-03 to merge). RD-06 needs the single-loop driver's candidate builder on the branch. The live table (real Keeper, the main session as the one player, one sentence a turn, `tests/play/driver.py`) after RD-04 is the owner's gate, not a worker ticket.

---

## RD-01 — The catalog's contract and its one validator

Status: ready-for-agent
Depends on: SO-01 (landed: `kernel-ts/modules/obligation-shape.ts`); the spec is accepted (Owner rulings, 2026-09-23).

**What.** Write the contract section for spec D4 (container, registered seats, `_unstated` convention, the dice grammar, the effect vocabulary, the fifteen shapes) and D5 (refusal rules). Implement `kernel-ts/modules/mechanics-shape.ts` with `mechanicsRefusals(graph, rules, {starter})`; extend `checkDeclarationRefusals` with the owner `rule` (selection `{maximum, approach}`, scope `{actor, actor-target, opposed}`, result entry `{effects?, book?}`, any subset of the six levels). Call it from starter registration (`registerStarter`, after `obligationRefusals`) and keep the Mod manifest check on the shared form. Dice slots validate with `definitionExpression` (`kernel-ts/mods/definition.ts:30-47`), sanity halves also with `validateSanLossExpression`. The `stat_block` closure accepts, on starters only, a listed legacy allowance (`attacks`, `attacks_per_round`, `san_loss_to_see`) that shrinks as starters migrate; the reader's drafts get no allowance (RD-05). No reader, no data.

**Acceptance.**
- `tests/extension/mechanics-shape.test.mjs` through `module.register` on a derived content root and `mods.install` on a package derived from `natural-npc`: one refusal per D5 rule by its `rule`, each shown to go green when the rule is removed (mutation record in the report); the minimal node of every shape and an `_unstated` variant of every needable slot accepted; a dice table test (`1D4+2 hit points`, `1D6+DB`, `½DB` refused; every accepted string rolled by `rollExpression` and `CombatSession.rollDamageExpression`).
- `natural-npc` 1.4.2 loads at its version and digest.
- Every shipped starter registers unchanged; every golden of every starter is unchanged (no shape is authored yet, so no read may move).

**Not in this ticket.** Any reader (RD-02), the reader's draft check (RD-05), any data change.

---

## RD-02 — Kernel readers and the capsule's `mech` line

Status: needs-triage
Depends on: RD-01.

**What.** Spec D6.1–D6.2: `ModuleGraph.mechanicsOf(node)` (the only reader of `mechanics`, owning the spell flat-key bridge); `where.rules[]` rows gain `mech` (code-rendered English from typed values, ≤ 160 characters compact, `mech_truncated`), absent when the node has no shapes; §13.2's source table row; `npcProfileOf` reads `creature` nodes; `sanity:check` reads `profile.sanity_loss` before its legacy keys; `moduleSpellRecords` reads `mechanics.spell`; `moduleWeapons` reads graph weapon shapes after the ruleset table; `magicLearningSources` reads `mechanics.tome.spells`; the module lookup's `endings[]` reads `reward` shapes of rules linked from the ending or conclusion scene; the threat pressure row reads `clock.advances_on`.

**Acceptance.**
- Tests over a derived content root carrying one node of every shape (the shipped starters carry none yet): each reader returns the typed value; a creature with a stat block is fought; `sanity:check` on an actor with a typed `sanity_loss` rolls it without `action.san_loss`; a spell with `mechanics.spell` is priced; the `mech` line renders from typed values only (a mutation that reads `summary` instead is killed).
- Goldens: all four shipped starters byte-identical (behaviour moves only with data).
- `npm run test:ext` and `uv run --frozen python -m pytest tests/kernel tests/play` green against the rebuilt emitted kernel; the §31 world-state seam test passes (no new world key).

**Not in this ticket.** `action.rule`, `stated` (RD-03); any starter data.

---

## RD-03 — Operations name a shape: `action.rule`, `action.step`, `stated`

Status: needs-triage
Depends on: RD-02; SO-02 (landed: `kernel-ts/resolve/obligation.ts`, reused, not copied); Q1 ruled (spec Owner rulings).

**What.** Spec D6.3–D6.4: `resolve` accepts `action.rule` (and `action.step` for a hazard), binds through the obligation binder's validation, runs the decision the check maps to (ordinary, opposed, Luck), returns `stated: {rule, step?, level, effects, next_step?, book?}`, writes nothing beyond the roll's receipts, and stamps `basis: {rule}`; the refusal table of D6.3. `apply damage|time|threat|flag|cash` accept `stated: <handle>` with `stated_conflict` and `stated_ambiguous`; without it `basis: keeper`. `sanity:check` with `action.rule` builds `san_loss` from the shape. The offer ledger registers `stated:<handle>` and `kpi.py` counts it. The `resolve` and `apply` tool descriptions gain the optional fields; the base Keeper prompt gains one English sentence (stated mechanics are the book's numbers; name them with `action.rule`/`stated`, or use your own amount). The fake kernel (`tests/extension/fixtures/fake-kernel.mjs`) learns the fields.

**Acceptance.**
- pytest over the emitted kernel on a derived content root: a hazard's step sequence with forced results (`next_step`, the bound damage, no HP written); `apply damage {stated}` rolls the stated dice with `basis: stated`; `stated` plus `dice` refused; `apply damage {dice}` alone lands with `basis: keeper`; every refusal of D6.3 by its reason; the offer ledger rows.
- No refusal of any Keeper operation because a shape exists (a test crosses a stated hazard with an unrelated `apply` and `resolve`).
- Goldens unchanged for all four starters; `test:ext` and pytest green.

**Not in this ticket.** The clerk using any of it (RD-06); starter data (RD-04).

---

## RD-04 — The haunting migrates to shapes

Status: needs-triage
Depends on: RD-03; Q3 and Q4 ruled (spec Owner rulings).

**What.** Spec D9, every row except the ruleset side table's weapons: `rule-bed-attack` (hazard + witnesses' `sanity_loss`), Corbitt's typed `profile.sanity_loss`, the deleted `on_enter.danger_attacks` and `attack_profiles`, the clock's `advances_on`, `rule-chapel-floor-collapse`, `tome-liber-ivonis.mechanics.tome`, the library/records `time_cost` per Q3/Q4, `rule-victory-rewards.reward`, the profile's weapon shapes under one id, and the deletion of the affordance `skills[]`/`skill_minimums`/`clues[].affordance`/`sets_flags` only where an existing owner holds the check (the police and Hall of Records rows stay SO-05's). Every new node cites the pages the starter's neighbouring nodes cite (`source_refs` + `evidence_span_ids`). Shrink RD-01's legacy allowance by the keys the haunting no longer carries. Re-stamp the starter's character-guidance bundles if the graph digest moves (as §134.6 did).

**Acceptance.**
- pytest on a fresh seeded haunting campaign: the chapel row's `mech` line; the chapel hazard through `action.rule` and `action.step` to a bound `damage 1D6`; `apply damage {stated: chapel-floor-collapse}`; `sanity:check` on Corbitt rolls `1/1D8` from the typed profile; `development:end-session` without an expression uses `1D6`; the Liber Ivonis read check binds Language (Latin) with the 50 threshold.
- No field listed in D9 remains typed and unread (a test walks the haunting graph for the removed keys).
- Controls byte-identical; the haunting's capsule and options differ only at the D9 scenes and its lookup ending row, reviewed row by row.
- `test:ext` and pytest green.

**Not in this ticket.** `the-haunting.json` (RD-07); SO-05's rows; `mystery-house` (RD-08); packaging.

---

## RD-05 — The PDF reader writes shapes

Status: needs-triage
Depends on: RD-01; SO-03 merged (its `contract.rules`, `checkObligations` overlay and `obligationReviewPaths` are the pattern and the plumbing).

**What.** Spec D7: one English paragraph per shape in `content/setup/visual-reader.md` (the container, keys, one worked example each, the `_unstated` rule, the dice rule) and one reviewer paragraph; `shapeReviewPaths(node, base)` in an import-free file loaded by both `checkDraft` and `reviewUnits`, adding every leaf under `mechanics` (strings included) to `required_review`; `checkDraft` runs `mechanicsRefusals` over the overlay graph with node, pointer, rule and the D7 `fix`; the NPC-numbers check covers flat characteristic integers on `npc` and `creature` nodes. No prose parsing, no count gate, no backfill.

**Acceptance.**
- Checker tests: a draft with `"1D4+2 hit points"`, an unviewed page, an unknown skill, a value with its `_unstated` flag, a shape on the wrong kind, flat `STR: 90` on an NPC — each refused with its path and rule; a valid draft whose shape leaves are not in `critical` gets them all in `required_review` (the `numericPaths` string gap closed); a draft with no shapes passes unchanged (parent golden, as SO-03 recorded one).
- A detail read on a scratch copy of a book the owner chooses, with a question that reaches a stated hazard and an NPC's stat block, produces independently reviewed shapes; the evidence stays in the scratch workspace; the committed twin is not rebuilt.
- The prompt text is English and carries no book- or language-specific wording.

**Not in this ticket.** Backfilling any existing module; changing the twin.

---

## RD-06 — Jev binds what the book fixed, and never routes a consequence

Status: needs-triage
Depends on: SL-02 merged (`runtime/jev/candidates.ts`, §135); SO-04; RD-02; Q2 ruled (spec Owner rulings).

**What.** Spec D8: a `statedCheckBinding(reads)` seam beside `buildCandidates`' ordinary-check candidate — a declared check that reaches a clue gate or a non-hazard rule/tome `check` stating one skill and a difficulty arrives with them bound and `basis` naming the node; several approaches → closed `decide(bind)`; an unstated slot → `infer(bind)`; an unmet `minimum` withholds it. The builder produces no candidate for `hazard`, `damage`, `sanity_loss`, `time_cost`, `resource_cost`, `reward` or `clock`. Labels per §135.2 (no page, no kernel tags). The clerk authority list is not changed.

**Acceptance.**
- Policy tests with stub ports for each row of the D8 table, including the negative ones (a hazard and each consequence shape never a candidate), killed by named mutations.
- A pre-registered replay on a recorded live haunting turn that reaches a stated hazard (recorded at a real table, never synthesised), outcomes written before the run as in the spec's Testing Decisions; the report separates what the replay verified from what it assumed.
- `test:ext` and pytest green; legacy engine untouched.

**Not in this ticket.** The live table; any clerk-applied consequence.

---

## RD-07 — The ruleset's module side table leaves the ruleset

Status: needs-triage
Depends on: RD-04.

**What.** Move `content/rulesets/coc7/rules-json/the-haunting.json`'s `weapons` (`floating-knife`, `corbitt-ritual-dagger`) into weapon shapes on the haunting's artifact and object nodes; `moduleWeapons` (`kernel-ts/combat/profiles.ts:103-108`) reads graph weapons only; delete the table's `rules` block, the file, and its 8 `module.haunting.*` rows in `rule-index.json`; re-record the ruleset's table digests. The combat operation's `rule_ref`s that name those rows are repointed or removed per the contract.

**Acceptance.** The §102 combat tests (`tests/kernel/test_sessions.py`: Flesh Ward preparations, the floating knife's POW attack and MP cost, the own-dagger exception) pass unchanged in behaviour; `lookup kind rule` no longer returns `module.haunting.*`; controls byte-identical; `test:ext` and pytest green.

**Not in this ticket.** The other ruleset tables' prose (`spells.json`, `weapons.json` `special`), `time-costs.json`.

---

## RD-08 — `mystery-house` follows the haunting

Status: needs-triage
Depends on: RD-04 and a live haunting table that reached the migrated scenes.

**What.** Migrate the rule gym's copies the same way (its `roll_gate`, route and presence copies, `on_enter`, `optional_rules`, `authored_operation`, `time_profile`, profile legacy keys), author its own gym statements as shapes where it states them, and decide its chase `hazard`/`barrier` and its `scene-crowe-lair` `opponent.actor_id` mismatch with the owner first. From this ticket on `mystery-house` is no longer a control; `voice-bench` and the twin remain.

**Acceptance.** Its goldens re-recorded row by row with each diff explained; RD-01's legacy allowance is empty afterwards; `test:ext` and pytest green.

---

## RD-09 — `tactic` registered in the catalog

Status: needs-triage
Depends on: SL-07 landed.

**What.** Register SL-07's standing-defence key as the catalog's `tactic` (spec D4.5, shape 11): at `mechanics.tactic` if SL-07 seated it there, otherwise SL-07's key is the registered seat and the catalog names it; the validator checks its closed enum; the reader's shape paragraph (RD-05) covers it.

**Acceptance.** Validator cases for `tactic`; the SL-07 kernel tests still pass; no second seat for an NPC's defence exists.

## Comments
