# Rules are data — tickets

Spec: [rules-as-data.md](rules-as-data.md) (`Status: ready-for-human`; owner questions Q1–Q5 open).
Parent plan: [pi-native-single-loop.md](pi-native-single-loop.md), Rulings, "Rules are data"; first two shapes: [scene-obligations-as-candidates.md](scene-obligations-as-candidates.md) (§134) and [07-npc-standing-defense.md](pi-native-single-loop-tickets/07-npc-standing-defense.md) (SL-07, on `0.9.5a`).

State: **spec accepted 2026-09-23 (Owner rulings Q1–Q5).** RD-01 is `ready-for-agent` and dispatched; the rest follow in the dependency order below as each predecessor merges.

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

Status: ready-for-human (implemented on `claude/rd01-mechanics-shape-20260923`; awaiting review and merge)
Depends on: SO-01 (landed: `kernel-ts/modules/obligation-shape.ts`); the spec is accepted (Owner rulings, 2026-09-23).

**What.** Write the contract section for spec D4 (container, registered seats, `_unstated` convention, the dice grammar, the effect vocabulary, the fifteen shapes) and D5 (refusal rules). Implement `kernel-ts/modules/mechanics-shape.ts` with `mechanicsRefusals(graph, rules, {starter})`; extend `checkDeclarationRefusals` with the owner `rule` (selection `{maximum, approach}`, scope `{actor, actor-target, opposed}`, result entry `{effects?, book?}`, any subset of the six levels). Call it from starter registration (`registerStarter`, after `obligationRefusals`) and keep the Mod manifest check on the shared form. Dice slots validate with `definitionExpression` (`kernel-ts/mods/definition.ts:30-47`), sanity halves also with `validateSanLossExpression`. The `stat_block` closure accepts, on starters only, a listed legacy allowance (`attacks`, `attacks_per_round`, `san_loss_to_see`) that shrinks as starters migrate; the reader's drafts get no allowance (RD-05). No reader, no data.

**Acceptance.**
- `tests/extension/mechanics-shape.test.mjs` through `module.register` on a derived content root and `mods.install` on a package derived from `natural-npc`: one refusal per D5 rule by its `rule`, each shown to go green when the rule is removed (mutation record in the report); the minimal node of every shape and an `_unstated` variant of every needable slot accepted; a dice table test (`1D4+2 hit points`, `1D6+DB`, `½DB` refused; every accepted string rolled by `rollExpression` and `CombatSession.rollDamageExpression`).
- `natural-npc` 1.4.2 loads at its version and digest.
- Every shipped starter registers unchanged; every golden of every starter is unchanged (no shape is authored yet, so no read may move).

**Not in this ticket.** Any reader (RD-02), the reader's draft check (RD-05), any data change.

---

## RD-02 — Kernel readers and the capsule's `mech` line

Status: ready-for-human (implemented on `claude/rd02-mechanics-readers-20260923`; awaiting review and merge)
Depends on: RD-01.

**What.** Spec D6.1–D6.2: `ModuleGraph.mechanicsOf(node)` (the only reader of `mechanics`, owning the spell flat-key bridge); `where.rules[]` rows gain `mech` (code-rendered English from typed values, ≤ 160 characters compact, `mech_truncated`), absent when the node has no shapes; §13.2's source table row; `npcProfileOf` reads `creature` nodes; `sanity:check` reads `profile.sanity_loss` before its legacy keys; `moduleSpellRecords` reads `mechanics.spell`; `moduleWeapons` reads graph weapon shapes after the ruleset table; `magicLearningSources` reads `mechanics.tome.spells`; the module lookup's `endings[]` reads `reward` shapes of rules linked from the ending or conclusion scene; the threat pressure row reads `clock.advances_on`.

**Acceptance.**
- Tests over a derived content root carrying one node of every shape (the shipped starters carry none yet): each reader returns the typed value; a creature with a stat block is fought; `sanity:check` on an actor with a typed `sanity_loss` rolls it without `action.san_loss`; a spell with `mechanics.spell` is priced; the `mech` line renders from typed values only (a mutation that reads `summary` instead is killed).
- Goldens: all four shipped starters byte-identical (behaviour moves only with data).
- `npm run test:ext` and `uv run --frozen python -m pytest tests/kernel tests/play` green against the rebuilt emitted kernel; the §31 world-state seam test passes (no new world key).

**Not in this ticket.** `action.rule`, `stated` (RD-03); any starter data.

---

## RD-03 — Operations name a shape: `action.rule`, `action.step`, `stated`

Status: ready-for-human (implemented on `claude/rd03-stated-operations-20260923`; awaiting review and merge)
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

Status: ready-for-human (implemented on `claude/rd05-reader-shapes-20260923`, 0.9.5a merged in; awaiting review and merge)
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

### 2026-09-23 — RD-01 implementation record (branch `claude/rd01-mechanics-shape-20260923`, parent `7709b5ded`)

- **Rulings first.** The worker stopped before code on four contradictions between the spec and the shipped starter data; the coordinator's decisions A–D are in the spec's Comments and applied to P1, D4.1, D4.5 and D5 (`94731c1ff`). One further consequence was decided in the implementation and is stated in §136.1: while the starter allowance stands, a starter's lone registered `profile` is not held to `mechanics_unsourced`, because the curated starters cite their stat blocks inside the allowance's container `source_refs` and three of the four carriers have no node-level citation.
- **Contract §136** (`1460da0a2`; §136 was free: SL-07 took §11.5.2, SL-02 §135). Amends §26 and §134.2–§134.3 for the owner `rule`. §136.3 narrows the dice law to what both rollers read: `definitionExpression` plus canonical spelling, at least one die and no subtracted die (a bare constant is refused by `rollExpression`, a subtracted die by `rollDamageExpression`); a Sanity half is `"0"` or passes both grammars.
- **Validator** `kernel-ts/modules/mechanics-shape.ts` `mechanicsRefusals(graph, rules, {starter})`; `checkDeclarationRefusals` gains the owner `rule` (`kernel-ts/modules/obligation-shape.ts`); called from `registerStarterLocked` (`kernel-ts/write/source.ts`) after `obligationRefusals`, reason `mechanics_invalid` (`818ad940f`). The Mod manifest check is unchanged.
- **Tests** `tests/extension/mechanics-shape.test.mjs` (46 cases, `a18707cb1`, `9679feb80`): one refusal per §136.8 rule through `module.register`, the fifteen minimal shapes, `_unstated` variants, the dice table rolled through both rollers, the reader-draft branch getting no allowance, Mod-owner cases through `mods.install`, `natural-npc` 1.4.2 at digest `623c126f…25b2`. All 16 rules and 13 targeted mutations killed (the canonical-spelling mutation survived the first run and gained its case).
- **Numbers.** `test:ext` 2626/0 on the parent → 2672/0 on the branch (a first branch run under load average 109 timed out 8 and cancelled 2 in unrelated files; those files passed 86/86 on rerun and the full rerun is 2672/0). `uv run --frozen python -m pytest tests/kernel tests/play` 1625 passed, 1 skipped. Goldens — capsule, `table.apply.options`, `table.resolve.options` and the secret lookups (module and scene) of every scene of all four starters, each reached along authored exits in a fresh seeded campaign — byte-identical to the parent (46 scenes; per-run digests masked).
- **Not done here** (RD-05/RD-09): the reader's draft check and its page-view law; confirming `combat.defense` once SL-07 lands.

### 2026-09-23 — RD-02 implementation record (branch `claude/rd02-mechanics-readers-20260923`, parent `fb4ddbb50`, 0.9.5a merged in at `b40015c0e`)

- **Contract** `983224d31`: §136.10–§136.19 (one reader, the `mech` line, the actor's stat block, typed SAN loss, spell pricing, graph weapons, tome spells, ending rewards, the clock's `advances_on`, three ends and tests), two §13.2 rows, one sentence in the §136 preamble. Nothing renumbered.
- **Code** `eea9d8679`: `ModuleGraph.mechanicsOf` (`kernel-ts/read/module-graph.ts`) is the only reader of `mechanics` (kind-filtered by one import-free table, `kernel-ts/modules/mechanics-catalog.ts`, shared with the validator; spell flat-key bridge); `mechLine` (`kernel-ts/read/mech-line.ts`) renders the line from typed values only; `whereSection` cuts it at 160 with `mech_truncated`. Readers: `npcProfileOf`/`engineWeapon` (`resolve/context.ts`, `combat/profiles.ts`), `statedSanLoss` (`sanity/index.ts`), `moduleSpellRecords` (`rules/catalog.ts`), `moduleWeapons` (`combat/profiles.ts`), `bookSpellSources` (`magic/facts.ts`, now shared by `read/rule-facts.ts`), `statedRewards` (`module-graph.ts`, read by the module lookup), `bookAdvances` (`read/pressures.ts`).
- **Decided in the implementation, recorded in §136.12** (the spec said "`npcProfileOf` reads creature nodes"; fighting one needs the creature found and present): `ModuleGraph.actor(name)` — the `npc` first, else a `creature` that carries a stat block — replaces the `npc`-only lookup on the paths that act with or against a body (resolve target, acting NPC, combat/chase opponents, `npcNode`, standing defence, chase-ready fact, `sceneNpcIds` presence seeding, `npcsPresent`, and `apply npc` before minting a table person). A creature without a stat block is not an actor, so the shipped `creature-rat-pack` nodes change nothing, and the haunting's `npc-rat-pack` keeps its handle. A §136.14 detail: a `cost_mp_chosen` spell stays unpriced (`missing`), with `costs.chosen` saying why.
- **Tests** `38cd8723f`, `cb94ea99f`: `tests/extension/mechanics-readers.test.mjs` (9, derived haunting with one node of every container shape plus creature, tome, spell, reward, clock; real entries) and `tests/kernel/test_mechanics_readers.py` (4, emitted kernel: the creature fought with its book numbers and weapon, typed `1D6` rolled without `action.san_loss`, an unstated half refused to `needs`, a tome-taught spell cast at MP 3). One stale stub (`ts-kernel-write.test.mjs`: a fake graph without the new `actor` port) updated. 20 named mutations, all killed (the report lists each and its killer), including the `summary`-reading renderer.
- **Numbers.** Parent `fb4ddbb50`: `test:ext` 2705 / 2701 pass / 4 fail (the four named standing-defence tests); pytest 1640 passed, 1 failed (`test_npc_standing_defense.py::test_an_authored_word_outside_the_enum_falls_through_to_the_rules_default`, fixed on 0.9.5a by `009b1f287`), 1 skipped. Branch after merging 0.9.5a: `test:ext` 2715/2715; pytest 1645 passed, 1 skipped. Goldens (capsule, both option lists, module and scene lookups, `look focus=scene`; 46 scenes of the four starters, each in a fresh seeded campaign) byte-identical to the parent.
- **Not here:** `action.rule`, `stated`, the `stated:` offer kind, the development binder reading `reward` (RD-03/RD-04); any starter data.

### 2026-09-23 — RD-03 implementation record (branch `claude/rd03-stated-operations-20260923`, parent `172b80065`)

- **Contract** §136.20–§136.25 (`action.rule`/`action.step` and their refusals; the stated result and `basis`; `apply … {stated}` and its refusals; `sanity:check` with `action.rule`; three ends, ledger, tools, prompt; tests), with pointer sentences in §5 `table.apply`, §11.1 and §31.2 and one in the §136 preamble. Nothing renumbered.
- **Decided in the implementation, recorded in the contract** (the spec and rulings left them open; none contradicts them): which check a node without `action.step` rolls (its `check`, else a tome's `read_check`, else hazard step 0); where a tome/object is "present or held" (the scene's asset links, or a party equipment entry naming it); the level of an opposed check (the actor's own if the actor won, `failure` when a success lost); `rule_intent`/`rule_decision` as the mirrors of §134.11's `obligation_intent`/`obligation_decision`; the apply-side reasons `stated_unknown`/`stated_none`/`stated_unstated` beside the spec's `stated_conflict`/`stated_ambiguous`; a stated cash reward defaults to `source: "quote"` (§58, the spec's reading); a dice time amount is rolled and recorded as `stated_roll`; the node's own amounts also include its hazard's no-roll `effects`.
- **Found in passing and fixed (the one behaviour outside `action.rule`)**: `push-luck:luck-roll` had never settled in the TypeScript kernel — the action slots sent the Luck characteristic as a skill slot the decision does not declare, so every Luck roll was refused `unknown_semantic_input`. The chapel floor's Luck step exposed it; the slot is now left to the decision's payload constant, and a test pins the bare decision too.
- **Code.** The binder is one function, `bindCheckStep` (`kernel-ts/resolve/obligation.ts`), called by `bindObligation` and by `bindRule` (`kernel-ts/resolve/rule.ts`, which also holds `continuedRule` and `settleRule`). The stated vocabulary — which check a node rolls, a level's bound effects, the opposed level, a turn's latest rule result, the candidates for `stated` — is `kernel-ts/read/stated.ts`. The `stated` writer binding is `bindStated`/`stampBasis` in `kernel-ts/apply/stated.ts`, called from the apply loop (`kernel-ts/apply/index.ts`). The ledger row is `offerLedger` (`kernel-ts/write/text.ts`, resolved to a handle by `statedHandleOf` in `kernel-ts/write/index.ts`); `kpi.py` needed no change (its `offers` reads the kind from the id prefix) and a test counts `stated` through it. `ModuleGraph.sceneAssetNodes` backs `sceneAssets` and the tome/object presence rule. Tool fields in `extensions/kernel/tools.ts`; the prompt sentence in `prompts/keeper.md` after the scene-obligations sentence; the fake kernel answers `action.rule` and refuses `stated` beside an amount.
- **Tests.** `tests/kernel/test_stated_operations.py` (12, emitted kernel, derived haunting with eight stated rules at the opening scene, one elsewhere, a creature, a clock `advances_on`; seeds recorded per sequence) and `tests/extension/stated-operations.test.mjs` (2). Mutations, each killed (run in a throwaway copy, rebuilt per mutation): the kernel applying the stated damage (M1); the roll receipt's `basis` removed (M2a) and the apply receipts' (M2b); `stated_conflict` not raised (M3); the ledger not registering `stated:` (M4) or never marking it taken (M5); `next_step` not returned (M6); a stated hazard refusing an unrelated resolve (M7); the Luck step run as an ordinary check (M8); the opposed level left as the actor's own when a success loses (M9 — survived its first seed, which never produced a losing success; the seed was re-recorded to one that does); `stated_ambiguous` (M10), `rule_not_here` (M11), `rule_step` (M12), `rule_difficulty` (M14) and `stated_unstated` (M15) not raised; the sanity path not filling `san_loss` (M13); apply ignoring `stated` (M16); a push not continuing the rule (M17); the Luck-roll slot fix reverted (M18); the fake kernel's conflict and the schema's `step` field removed (extension test).
- **Numbers.** Parent `172b80065`: `test:ext` 2715 / 2714 pass / 1 fail (`npc-preparation-integration.test.mjs` "actual Keeper preparation overlaps…", a timing overlap under load average 75; it passed in every later run), pytest 1645 passed, 1 skipped. Branch before the merge: `test:ext` 2717/2717. After merging 0.9.5a (SL-08, `e1b4176d3`; baseline there 2728 / 1676+1): `test:ext` 2730/2730, pytest 1688 passed, 1 skipped. Goldens (capsule, both option lists, module and scene lookups, `look focus=scene`; 46 scenes of the four starters, each in a fresh seeded campaign) byte-identical to `172b80065` before the merge and to `e1b4176d3` after it.
- **Not here:** the clerk binding any of it (RD-06); starter data (RD-04); the development binder reading `reward` (RD-04).

### 2026-09-23 — RD-05 implementation record (branch `claude/rd05-reader-shapes-20260923`, parent `172b80065`, 0.9.5a merged in twice: SL-08 at `9bffd50df`, RD-03 at the merge after `1f0fb57b7`)

- **Contract** `62d120dcd` (then amended in `6d3205c1c`, `e983a291c`, `56c66bff8`): §136.26 (the reader's instruction, the review instruction, the draft check in five steps, three ends) and §136.27 (tests), one pointer paragraph in §22.3. Written as §136.20–§136.21 and renumbered §136.26–§136.27 before merge, because RD-03 landed §136.20–§136.25 first; no landed number moved.
- **Code** `14a23c07f`, `6d3205c1c`: `shapeReviewPaths(node, base)` and `statesMechanics` in the import-free `kernel-ts/modules/shape-review.ts`, called by `checkDraft` (`kernel-ts/modules/visual.ts`) and by `reviewUnits` (`extensions/module/reader-review.ts`); every leaf of the record view's `mechanics` and `combat` (SL-08's `defense`/`action`/`disposition`) enters `required_review`. `checkDraft` runs `mechanicsSourceLaw` (`mechanics_unsourced`, before the generic reference law, viewed-page half at publication) and `checkMechanics` (`mechanicsRefusals(view, contract.rules, {starter: false})` over the known graph overlaid by the draft, merged all the way down as `mergeValue` merges; only refusals the draft introduces refuse it: the known graph's own refusals are subtracted). `actorNumbersLaw` refuses a loose characteristic number on an `npc` or `creature` (`profile_outside_seat`, path `/nodes/<i>/properties/<key>`) and extends §22's standalone-dictionary refusal, bytes unchanged, to creatures. `mechanicsRules(tables)` (`mechanics-shape.ts`) is now the one loader of the ruleset names for starter registration and `loadModuleContract`.
- **Prompt** `130be01de`, `05668fbc2`, `e983a291c`: one container paragraph (keys and kinds, accounting, dice, `book`, skill names), one paragraph per shape with a worked example, the actor's `combat` words, and one reviewer paragraph, in `content/setup/visual-reader.md`; English, no book wording. `tests/extension/mechanics-reader.test.mjs` builds its valid draft from those examples and asserts they are in the file verbatim.
- **Decided in the implementation** (recorded in §136.26): the known graph's own refusals are not the draft's (otherwise one pre-RD-05 published profile with an `attacks` key would block every later shape draft of that module); the dictionary refusal keeps its bytes (a frozen-oracle case pins them); `combat` leaves are reviewed like `mechanics` leaves; the threat clock's `advances_on` is not taught (the reader writes no clocks).
- **Tests** `d1d2f9866`, `53d57b094`, `e983a291c`: `tests/extension/mechanics-reader.test.mjs` (16, through `checkDraft`, `checkReview` and `checkSourceDraft`): `"1D4+2 hit points"` → `shape_dice` at `…/mechanics/damage/dice`; an unviewed page → `mechanics_unsourced` at `/nodes/1/source_refs/1` (and no refs → `/source_refs`); `skills.Leap` → `shape_unknown_skill` at `…/hazard/steps/1/values/0/path` with `details.ruleset`; value plus `_unstated` → `shape_unstated`; `weapon` on a rule → `mechanics_wrong_kind`; `attacks` in a draft profile → `shape_unknown_key` (no allowance); flat `STR: 90` on an npc and a creature → `profile_outside_seat`; `combat.action: "flee"` → `shape_prose`; a valid draft stating every taught shape with `critical: []` gets all 70+ leaves in `required_review` (dice strings, flags, enums, `combat/*`) and `reviewUnits` assigns every one; a review missing one dice string does not publish; a delta merged into a known shape is checked whole; a known node's published refusal does not refuse a delta. Parent golden `tests/extension/fixtures/mechanics-reader-parent.json` (8 cases without shapes, recorded on `172b80065` in a throwaway detached worktree) byte-identical. `tests/kernel/test_mechanics_reader.py` (3, `module.read.finish` on the emitted kernel): publication only when every shape leaf is reviewed; worded dice and an unviewed citation refused there with path and rule. Two existing tests changed deliberately: `ts-kernel-modules.test.mjs` loads the real contract (its hand-built one had no ruleset names) and asserts the one post-freeze change (a profile integer beyond 2^53 is `shape_prose`) without touching oracle bytes; `test_npc_layer.py`'s legacy-fixture walk no longer carries the fixture's book-language skill names into a drafted profile.
- **Mutations** (throwaway worktree): 16 on the node suite — each rule removed (`shape_dice`, source law, unviewed half, `shape_unknown_skill`, `shape_unstated`, `mechanics_wrong_kind`, flat numbers, creature kind), the starter allowance given to drafts, `checkMechanics` not called, review paths dropped from `checkDraft`, `reviewUnits` ignoring shapes, known refusals not subtracted, shallow overlay, `details.ruleset` dropped, review leaves numbers only — all killed, each by its named case; 3 on the emitted kernel (validator, review paths, source law) killed by the publication tests.
- **Real read** (scratch copy of the Keeper Rulebook, product `ReadingService`, `grok-build/grok-4.7-build-fast` low, reader + checker + independent reviewers + publication; focus "The Corbitt House basement", question on the basement stairs and Corbitt's statistics, attacks and Sanity loss). Published at generation 1 after five review rounds (jobs read-1, read-3..read-6 via `retry: true`; one reader child died mid-write with empty stderr): 17 nodes on pages 456–460, among them `rule-basement-stairs-descent` (`check` DEX or Climb, `maximum`, `difficulty_unstated`, push → `damage 1D6`), `npc-walter-corbitt` (`profile` STR 90 … EDU 80, HP 16, MP 18, MOV 8, Build 1, SAN 0, DB `+1D4`, Fighting 50, Dodge 17, weapons floating dagger `1D4+2` and regular attacks `1D3` + DB, `sanity_loss` 1/1D8; `combat.defense: fight_back`), `creature-rat-pack` (`profile` with Overwhelm `2D6`), `rule-corbitt-floating-dagger` (`resource_cost` 1 MP per round, opposed POW vs Dodge, `damage 1D4+2`, `sanity_loss` 1/1D4), `rule-corbitt-claw-infection` (`hazard` Luck then CON), `rule-corbitt-body-animation` (2 MP, 5 rounds). The checker refused, and the reader repaired: `check_results` (a non-level result key), `check_values` (values beside `approaches_unstated`), `shape_unknown_skill` four times (`characteristics.Sanity`/`SAN`). Review contradicted: the weapon name "Clawed fighting attack" (a string leaf the reader had not listed in `critical`), a `fumble` line that was another procedure, an `approaches_unstated` and an `amount_unstated` where the page prints the value, Fighting (Brawl)/Firearms (Handgun) specializations the page does not print, and a CON result attached to `regular` only; plus six coverage omissions in round 1. Evidence stays in the session scratch workspace; the committed twin was not rebuilt.
- **Found, not fixed** (each needs the owner): a Sanity roll cannot be a check value (`SAN` is not in `characteristic-dice.json`), so the reader could not type "ask for a Sanity roll"; readers before RD-05 were told to use the book's skill names in a profile, so published non-English profiles carry names the catalog now refuses in new drafts (they do not block later drafts); the opposed check's orientation for an NPC-initiated attack (the reader wrote the dagger as `target: npc-walter-corbitt` with POW as `values`) is not settled by §136.6.
- **Numbers.** Parent `172b80065`: `test:ext` 2715 / 2713 pass / 2 fail under load (`lanes.test.mjs` #67 header timeout, `npc-preparation-integration`; both 38/38 on rerun); pytest 1645 passed, 1 skipped. Merged branch: `test:ext` 2744/2744 (0.9.5a baseline 2728 + 16); pytest see the report.
