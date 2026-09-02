# Pi-Coc module reachability lint specification

> **Status:** Implemented — L0 through L3 delivered on `0.8.1a`, uncommitted at
> the time of writing. The lint is `plugins/coc-keeper/scripts/coc_module_reachability.py`,
> reached through `coc_module_projection.py lint --ir-dir`. The user authorized
> the L3 edit to the shared `coc-scenario-import` skill explicitly; no other
> shared kernel, state, registry, contract, Codex-track, or historical
> playtest-evidence file was touched, and the model-facing operation surface is
> unchanged. Five statements in the original draft were refuted during
> implementation and are corrected in place; see the revision log.
> **ID:** `pi-coc-module-reachability-lint`
> **Track:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`; Codex-host implementation,
> adapters, prompts, launchers, tests, and documentation remain off-limits.
> **Scope owner:** the module compile and projection surface inside
> `plugins/coc-keeper/`.
> **Last updated:** 2026-09-02
> **Depends on:** [module source pipeline unification](pi-coc-module-source-pipeline-unification.md),
> [module knowledge graph extraction](module-knowledge-graph-extraction.md),
> [ADR 0003 system ontology composition registry](../adr/0003-system-ontology-composition-registry.md),
> the on-demand skeleton plan in [`coc-on-demand-module-skeleton`](../active-plans/coc-on-demand-module-skeleton.md).
> **Evidence base:** measured on `0.8.1a@5a51c84a` across the committed starter
> and four real compiled campaigns; every number in §2 is a measurement, not an
> estimate.

The words MUST, MUST NOT, SHOULD, and MAY below are acceptance requirements.

---

## 1. User job, success condition, and hollow delivery

A compiled scenario can be structurally broken in ways no current check
notices: a scene nothing routes to, a clue nobody can obtain, an exit gated on
a clue that only exists behind that exit, a conclusion that declares three
independent acquisition routes and has one. None of these are prose problems
and none of them need a model to detect. They are arithmetic over structure
that the scenario already declares, and today nobody does that arithmetic.

The user wants a compile-time check that answers **"can this module actually be
played through?"** deterministically, before a table opens, without inventing
content and without becoming another gate in front of the Keeper.

Success looks like:

- every structural claim the scenario makes about routes, placements, and gates
  is checked against the rest of the scenario, and a contradiction is named with
  the exact ids involved;
- criticality and route redundancy come **from what the module declares**
  (`importance`, `minimum_routes`), never from a phrase list, a keyword scan, or
  a compiler opinion about which clue matters;
- a progressive skeleton that has not been deepened yet is reported as
  *not yet materialized*, never as a broken module;
- a finding is a reviewable data statement, and a clean report is a real
  statement about structure rather than a statement about how much was
  extracted;
- the check runs on the same records the Keeper consumes at the table, so a
  pass cannot mean "correct in the compiler, absent at the table";
- nothing about the Keeper's turn-facing surface changes.

Hollow delivery includes:

- a lint that fails a module for having one acquisition route, which pressures
  the compiler into fabricating a second one — the module's own design is never
  a defect;
- inferring which clue or conclusion is "critical" from its text;
- a checker that reads the ModuleGraph only, reports 39 unobtainable clues on a
  starter that plays correctly (§2.2), and calls that a finding;
- a new model-facing operation, a play-time gate, or anything that can block
  `turn.finalize`;
- counting checks implemented rather than checks that fire on real modules;
- a green report on a progressive skeleton whose scenes were never parsed,
  presented as "the module is reachable".

---

## 2. Evidence base

Measured on `0.8.1a@5a51c84a`. Five scenario sets: the committed starter
`plugins/coc-keeper/references/starter-scenarios/the-haunting`, and the
`scenario/` directories of `pdf-coc-the-king-of-shreds-and-patches-fixed-20260826T055400`,
`pdf-coc-let-the-children-come-to-me-20260827T052546`, `amaranthine-20260822`,
and `pdf-coc-an-amaranthine-desire-20260824T132450`.

### 2.1 The checks fire on real modules

| Scenario | Scenes | Findings | Classes |
| --- | --- | --- | --- |
| the-haunting (complete) | 12 | 1 `declared-minimum-shortfall` — a conclusion declares `minimum_routes: 3` and all three of its clues sit in one scene behind one skill | 1 `dead` |
| king-of-shreds-and-patches | 2 | 1 `scene-unreachable` (`london-bridge-vandervick-shop`), 2 `scene-terminal-undeclared` | 3 `dead` |
| amaranthine-20260822 | 1 | 1 `edge-target-unknown` — an edge points at `dunwich-1287`, which no scene record defines | 1 `pending-materialization` |
| let-the-children-come-to-me | 1 | 1 `conclusion-without-clues`, 1 `declared-minimum-shortfall`, 1 `scene-terminal-undeclared` | 3 `not-measured` |
| an-amaranthine-desire (later import) | 1 | same three codes | 3 `not-measured` |

All five produce findings, and the classes separate the two shapes cleanly. The
one and only `defect` in the entire corpus is on the complete starter, which
contradicts its own declared redundancy. Every finding on a progressive skeleton
comes back as an `observation` — `pending-materialization` where the target is
source-bound, `not-measured` where the scene was parsed only to
`parse_state: "partial"`. §3.2 is the rule that produces that separation, and
this table is the evidence that it works: a skeleton is never reported as a
broken module.

The Haunting's other five conclusions satisfy their declared minimums, all 12
scenes are reachable from its single `is_start`, no clue is unplaced, no scene
edge dangles, and its one scene without an outbound edge is exactly the one
scene declaring `is_final`. So the lint is not a machine that always finds
something: on the shipped starter it produces one finding and is otherwise
silent.

### 2.2 The ModuleGraph alone cannot answer the question

The committed Haunting graph carries 145 nodes, 322 relations, 322 claims, and
reports all ten coverage domains `accepted`. Its relation kinds are dominated by
`contains` (149) and `route-to` (56). Against that graph:

- all 39 `clue` nodes have **zero** acquisition relations. `discoverable-at`
  exists 13 times and binds handouts and one tome, never a clue. A graph-only
  reachability check reports 39 unobtainable clues on a starter that plays.
- the same clues are all correctly placed in the projected
  `story-graph.json` through scene `available_clues`, and all 39 resolve.
- the graph holds **zero** `ending`, `requirement`, `outcome`, and `clock`
  nodes, so requirement-closure and ending reachability are not measurable on
  any graph that exists today.
- `coverage.causal` reads `accepted` while none of the causal placement lives in
  relations. **Coverage is a self-report about which domains an extraction
  reviewed. It is not evidence that the structure was captured**, and the lint
  MUST NOT substitute one for the other.

The conclusion that shapes the whole design: **the lint's input is the projected
ProjectionSet, not the graph** (§4).

### 2.3 A naive duplicate-entity check would be wrong here

The Haunting graph holds 12 `scene-*` and 12 `beat-*` nodes whose slugs match
one-for-one. They are not duplicates: `scene-*` nodes project into
`story-graph.json/scenes` and `beat-*` nodes project into
`pacing-map.json/pacing_curve`. A same-name collision check would produce 12
false positives on the shipped starter. Duplicate detection is out of scope
(§10) for exactly this measured reason.

---

## 3. The two laws

### 3.1 Declared, never inferred

Every threshold the lint applies MUST come from a registered field the scenario
itself declares. The only thresholds in this specification are
`clue-graph.json` conclusions' `minimum_routes` and the presence of
`importance`, both already in `RECORD_FIELD_REGISTRY`.

- The lint MUST NOT decide that a clue, conclusion, scene, or NPC is important.
- The lint MUST NOT apply a default minimum route count. A conclusion that
  declares no `minimum_routes` yields `routes-not-declared`, which is an
  observation about the module's accounting, not a route deficiency.
- The lint MUST NOT read free prose. No keyword list, regex over `description`,
  `player_safe_summary`, `delivery`, or `read_aloud`, and no phrase table may
  appear in any check. Inputs are ids, enums, booleans, integers, and structural
  arrays.
- The lint MUST NOT propose, generate, or write a repair. It reports; a human or
  the import workflow decides.

This is the same boundary the repository already holds for validators: a
required-field list is itself a hardcoded semantic judgement, so a checker earns
its authority by doing arithmetic over declarations rather than by having
opinions about content.

### 3.2 Every finding carries a completeness class

A missing target means different things in a complete module and in a
progressive skeleton. Each finding MUST carry exactly one class:

| Class | Meaning | Determined by |
| --- | --- | --- |
| `dead` | the scenario is complete and the target genuinely does not exist | `module-meta.json` has no `progressive: true` |
| `pending-materialization` | progressive scenario, and the missing target is source-bound or named for later deepening | `progressive: true` **and** the referencing record carries `source_refs` for the target, or the target appears in a scene's `mentions` |
| `not-measured` | the containing scene was never parsed deeply enough for the check to mean anything | the scene's `parse_state` is not `deep`, or it carries a non-empty `evidence_gap` |

`not-measured` MUST NOT be reported as a pass, and `pending-materialization`
MUST NOT be reported as a defect. A report whose findings are entirely
`not-measured` MUST say so in its summary rather than presenting a clean bill.

That rule needs a mechanism, not just prose. The report's summary therefore
carries `codes_measured` and `codes_total`. Without them, a scenario where all
fifteen checks ran and found nothing and a scenario where nothing could be
checked at all produce byte-identical summaries — every count zero, reading as
a pass. This was not hypothetical. It is exactly what the lint returned the
first time it was pointed at a real campaign that had been bound but not yet
projected: `documents_present` empty, all fifteen codes unmeasured, and a
summary of zeros. `codes_measured: 0` is the signal that the lint ran too
early, and a reader MUST NOT have to derive it by counting
`codes_not_measured` themselves.

The measured `dunwich-1287` case in §2.1 is `pending-materialization`: the edge
carries `source_refs` to a real source page and a matching clue exists in the
campaign's compiled archive, while the destination scene has not been built yet.

**The `mentions` disjunct is currently inert, and that is recorded rather than
hidden.** Measured across all five scenario sets: not one scene populates
`mentions`. The progressive importer renames it at the boundary and writes
`source_context_mentions` instead. That sibling field cannot stand in for it
either — its entries carry entity references such as `npc-john-croft` and bare
names, never scene ids, so it could not resolve a missing scene-edge target. So
every `pending-materialization` classification observed today rests entirely on
the `source_refs` disjunct. The rule keeps both disjuncts as written, and the
lint carries a comment at that branch saying it is inert and why. Reading a
field that no producer populates is a rule that only looks like it works, and
this repository has been burned by exactly that shape before.

---

## 4. Input: one carrier-agnostic ProjectionSet

The lint MUST consume the ProjectionSet that `coc_module_projection.py` already
loads, so that it works identically for the two carriers that exist — embedded
node properties (the committed starter form) and the digest-bound
`runtime-projection.json` sidecar (the forward path) — and so that a pass is a
statement about the records the Keeper actually reads at the table.

Fields consumed, every one of them already in `RECORD_FIELD_REGISTRY`:

| Document / collection | Fields |
| --- | --- |
| `story-graph.json` / `scenes` | `scene_id`, `is_start`, `is_final`, `scene_edges`, `available_clues`, `exit_conditions`, `entry_conditions`, `mentions`, `loop_boundary`, `origin` |
| `clue-graph.json` / `conclusions` | `conclusion_id`, `importance`, `minimum_routes`, `clues[].clue_id`, `clues[].delivery_kind`, `clues[].skill`, `clues[].origin` |
| `quests.json` / `quests` | `quest_id`, `destination_scene_id`, `target_refs` |
| `threat-fronts.json` / `fronts` | `front_id`, `scene_ids` |
| `handouts.json` / `handouts` | `clue_refs` |
| `module-meta.json` | `progressive`, `parse_tier`, `structure_type` |

The document set is not identical across carriers, and the lint MUST tolerate
that. Measured: `clue-graph.json`, `story-graph.json`, `module-meta.json`,
`npc-agendas.json`, `pacing-map.json`, `threat-fronts.json`, `handouts.json`,
and `improvisation-boundaries.json` are present in all three scenario sets
examined; `quests.json` is present in the starter and in
`king-of-shreds-and-patches` but absent from `amaranthine-20260822`. A document
absent from a scenario set MUST yield `not-measured` for every code that reads
it, never a clean pass and never a finding. `clue-graph.json` is the clue
authority: the `clues.json` that progressive scenarios also carry is an empty
list in every measured campaign and MUST NOT be read as a second clue source.

Reading an unregistered field is a specification violation. If a check needs a
field that is not registered, the registry is extended first, with its consumer
named, exactly as the projection core already requires.

**One known prerequisite.** The completeness signals §3.2 depends on,
`parse_state` and `evidence_gap`, are **not** in `RECORD_FIELD_REGISTRY` today.
They exist on progressive scenario scenes, which are written by
`coc_module_project.py` rather than projected from a graph, so the registry has
never seen them. Measured: the committed starter carries neither on any of its
12 scenes; the progressive `amaranthine-20260822` scene carries
`parse_state: "deep"` and `evidence_gap: false`. Before L1 implements §3.2,
these two fields MUST either be registered with their consumer named, or the
registry MUST explicitly record that progressive-only scene fields are outside
its scope. Reading them while they sit in neither state is exactly the
unregistered-field class the registry exists to make loud.

---

## 5. Check catalogue

Each check has a stable semantic code. Codes are part of the contract and MUST
NOT be renamed once emitted.

### R1 — Referential integrity

A contradiction inside one scenario set. Severity `defect` when the class is
`dead`.

| Code | Statement |
| --- | --- |
| `edge-target-unknown` | a `scene_edges[].to` names no scene record |
| `available-clue-unknown` | a scene's `available_clues[]` names no clue in any conclusion |
| `clue-unplaced` | a conclusion clue appears in no scene's `available_clues` |
| `gate-clue-unobtainable` | an `exit_conditions` or `scene_edges[].when` of kind `clue_discovered` names a clue no scene provides |
| `quest-destination-unknown` | a quest `destination_scene_id` names no scene |
| `front-scene-unknown` | a threat front `scene_ids[]` entry names no scene |
| `duplicate-record-id` | two records in one collection share an id |

### R2 — Reachability

Structural facts about traversal. Severity `observation`, because a module may
legitimately hold an unentered scene the Keeper places by judgment.

| Code | Statement |
| --- | --- |
| `start-scene-count` | zero or more than one scene declares `is_start` |
| `scene-unreachable` | no path of `scene_edges` reaches the scene from any start |
| `scene-terminal-undeclared` | a scene has no outbound edge and does not declare `is_final` |
| `conclusion-behind-unreachable-scenes` | every clue of a conclusion sits only in unreachable scenes |
| `gate-self-locks` | the only placements of a gate's clue are in scenes reachable only through that gate |

`gate-self-locks` is the permanent-lock check. It MUST be computed as a
fixed-point over the gated traversal, not as a single-hop test, and it is the
one R2 code that SHOULD be raised to `defect` when its class is `dead`, because
a self-locking gate cannot be opened by any play.

**Only `clue_discovered` gates are examined.** Measured on the starter: its 56
scene edges carry 43 `always`, 11 `clue_discovered`, and 2 `flag_set`
conditions. Both `flag_set` edges lead to `higher-courts-central-police` and
require the flag `records-serious-crime-destination-known`, which is set by an
affordance on `hall-of-records`, a scene reachable from the start. Treating a
flag gate as closed would therefore report a self-lock that play can open, and
resolving one honestly means reading `affordances[].sets_flags` — a field this
slice does not consume. So a flag gate is neither examined nor guessed at. A
flag whose only setter sits in an unreachable scene is a genuine self-lock this
slice cannot see; it is named in §10 as future work rather than approximated
here.

**A scenario with no start scene makes traversal unmeasurable, not universally
broken.** When no scene declares `is_start`, `scene-unreachable`,
`conclusion-behind-unreachable-scenes` and `gate-self-locks` MUST go to
`codes_not_measured` rather than firing on every scene: reachability has no
origin to compute from, and `start-scene-count` already names the gap once.
Reporting every scene as unreachable would bury that one real finding under
noise proportional to the module's size. This follows the same principle as the
`is_final` rule below.

`scene-terminal-undeclared` fires only where the scenario uses the field. The
committed starter declares `is_final` on exactly one scene,
`corbitt-confrontation`, and that is exactly the one scene with no outbound
edge, so the starter produces no finding here. On a scenario where `is_final`
is absent from every scene the check MUST report `not-measured` rather than
flagging every leaf.

### R3 — Declared-minimum accounting

Pure accounting against the module's own declaration.

| Code | Statement |
| --- | --- |
| `declared-minimum-shortfall` | counted independent routes are fewer than `minimum_routes` |
| `routes-not-declared` | a conclusion declares `importance` but no `minimum_routes` |
| `conclusion-without-clues` | a conclusion carries an empty `clues[]` |

Route independence MUST be reported at two granularities and neither may be
invented by the lint:

- **scene-independent routes**: the count of distinct scenes in which any of the
  conclusion's clues is available. This is the count compared against
  `minimum_routes`, because a route the players cannot reach separately is not a
  separate route.
- **context-independent routes**: the count of distinct
  `(scene, delivery_kind, skill)` triples, reported alongside for review.

`declared-minimum-shortfall` is severity `defect` when its class is `dead`,
because it is an internal contradiction rather than a design opinion: the module
states a redundancy that its own placements do not provide. The measured
Haunting case declares 3 and provides 1.

---

## 6. Findings contract

A finding MUST be a closed record:

```json
{
  "code": "declared-minimum-shortfall",
  "severity": "defect",
  "completeness": "dead",
  "subject_id": "corbitt-house-documentary-history",
  "subject_kind": "conclusion",
  "related_ids": ["central-library", "clue-house-built-1835"],
  "declared": {"minimum_routes": 3},
  "counted": {"scene_independent_routes": 1, "context_independent_routes": 1},
  "reason": "declared minimum route count exceeds distinct scene placements"
}
```

- `severity` is `defect` or `observation`; `completeness` is one of §3.2.
- Every id is a semantic id already present in the scenario records. The lint
  MUST NOT mint an identifier, and MUST NOT require any model to relay one.
- `declared` and `counted` carry only values read or computed from registered
  fields, so any finding can be re-derived from the scenario set alone.
- `reason` is a fixed English clause per code, not generated prose.
- Findings MUST be emitted in a deterministic order: code, then `subject_id`.
- A finding MUST survive projection into whatever surface displays it. An
  actionable code MUST NOT be collapsed into a generic error on the way out.

---

## 7. Seam and interface

The lint is a **compile-time and import-time report**. It has no play-time role.

- It MUST be exposed as one new CLI verb on the existing projection module,
  `coc_module_projection.py lint`, and as one library function beside
  `validate` / `project` / `parity`.
- The verb MUST accept `--ir-dir` and MUST NOT require `--graph`. Progressive
  campaigns have a scenario directory and no `module-graph.json` in it, so a
  graph-only entry point would exclude exactly the imports that most need
  checking. Where a graph is supplied instead, the lint projects it and checks
  the result, so both carriers reach the same code path. Note this is a genuinely
  new entry shape rather than a copy of an existing one: all eight pre-existing
  verbs require `--graph`, and `parity` takes `--ir-dir` in addition to it, not
  instead of it.
- It MUST NOT add a model-facing toolbox operation, MCP operation, or Pi policy
  entry. Nothing about the operation surface, its archive, or its generated
  projections changes, so this work cannot conflict on `operation_count`.
- `coc-scenario-import` SHOULD run it after a scenario is projected and surface
  the findings to the human running the import. That is a documentation change
  in the import skill, not a gate.
- It MUST NOT block `build_module_graph_asset`, `install_projected_scenario`,
  campaign creation, `state.move_scene`, or `turn.finalize`. A module with
  findings still installs and still plays.
- It MUST NOT write to the graph, the ProjectionSet, campaign state, or the
  campaign Git history.

The rationale for staying off the operation surface is not only conflict
avoidance: the Keeper has no use for this report mid-table. A defect found
during play is handled by the Keeper's own judgment and improvisation law, not
by a lint result appearing in a tool response.

---

## 8. Report artifact

Slice L2 adds `docs/status/module-reachability-ledger.md`, generated by
`scripts/gen_module_reachability_ledger.py` over the committed starter, in the
same drift-proof pattern the text-grounding ledger already uses: the generator
writes it, and a test regenerates and compares it, so it cannot rot.

The ledger MUST report, per check code, how many findings the committed starter
produces and at which completeness class, and MUST state the coverage that
§2.2 measured, so that a future reader can see the difference between "no
findings" and "nothing measurable".

---

## 9. Testing

- **Per-check deterministic tests.** Each code in §5 gets a minimal synthetic
  ProjectionSet that triggers exactly it, and a near-miss that does not.
- **Mutation resistance.** Each check MUST have at least one case that fails if
  the check is deleted. A suite that stays green with a check removed does not
  cover it, and a worker report of "all green" is not evidence of coverage.
- **Golden real input.** The committed starter is a fixture with an exact
  expected finding set: one `declared-minimum-shortfall` on
  `corbitt-house-documentary-history`, and nothing else. If a later starter
  change alters that set, the change is reviewed, not the expectation quietly
  updated.
- **Progressive fixture.** A `progressive: true` scenario with a source-bound
  edge to an unbuilt scene MUST produce `pending-materialization`, and the same
  scenario with `progressive` removed MUST produce `dead`. This is the single
  most important regression: getting it backwards turns every in-progress import
  into a wall of false defects.
- **Prose isolation.** A test MUST assert that no check reads
  `description`, `player_safe_summary`, `delivery`, `read_aloud`, `summary`, or
  `note`, so §3.1 cannot decay into a phrase matcher later.
- **Field registration.** A test MUST assert every field the lint reads is in
  `RECORD_FIELD_REGISTRY`.
- `tests/test_plugin_metadata.py` MUST pass, as for any plugin change.

No live Pi-Coc RPC play is required to accept this work, and none may be claimed
as its evidence. The lint changes nothing a Keeper does at a table; a playtest
would prove nothing about it. What must be true instead is that a real module
import surfaces real findings, which §2.1 already measures.

---

## 10. Out of scope

Each exclusion below has a measured reason, not a preference.

- **Ending and requirement-closure reachability.** No `ending`, `requirement`,
  `outcome`, or `clock` node exists in any built graph (§2.2). There is nothing
  to check yet. When the causal quest system lands its requirement records, this
  spec gains an R4 section.
- **Duplicate and same-name entity detection.** Would produce 12 false positives
  on the committed starter (§2.3), and deciding whether two similarly named
  records are one thing is a semantic judgement.
- **NPC knowledge-time violations.** "An NPC knows something they could not know
  yet" needs a knowledge-time axis the records do not carry. Noted as a design
  gap, not attempted here.
- **Contradictory dates and timeline causality.** Same reason; `temporal-frame`
  and `schedule` structure is not populated in any measured module.
- **Rule-override conflict detection.** ADR 0003 and the RuleGraph own
  `uses-rule` validation. This lint does not touch rules.
- **Any repair, backfill, or route generation.** §3.1.
- **Any play-time or build-time gate.** §7.
- **Flag-gate self-locks.** `gate-self-locks` examines `clue_discovered` gates
  only. Resolving a `flag_set` gate honestly requires reading
  `affordances[].sets_flags` to learn where a flag can be set, and this slice
  does not consume that field. Measured: the starter's two flag gates are opened
  by an affordance in a reachable scene, so guessing they are closed would
  manufacture a false finding. A flag whose only setter sits in an unreachable
  scene is a real self-lock that today's checks cannot see.
- **Cycle detection over `route-to` and `contains`.** Measured: the Haunting has
  a legitimate `route-to` cycle between two adjacent scenes. Only the contract's
  declared ordering relations could ever be acyclic-by-law, and none of them
  appears in a built graph today.

---

## 11. Slices

| Slice | Content | Delivered |
| --- | --- | --- |
| L0 | Findings contract, ProjectionSet input, R1 codes, `lint` CLI verb | yes — `edge-target-unknown` fires on `amaranthine-20260822` naming `dunwich-1287` and R1 is silent on the other four sets |
| L1 | R2 codes, completeness classification (§3.2), progressive fixtures | yes — `scene-unreachable` fires on `king-of-shreds-and-patches`; the progressive/complete fixture pair separates `pending-materialization` from `dead` |
| L2 | R3 codes, route-independence counting, ledger and drift test | yes — the starter produces exactly one `declared-minimum-shortfall`, and the ledger regenerates byte-identically |
| L3 | `coc-scenario-import` surfaces findings to the human running an import | yes — both import tracks carry the shell step, and the skill's existing "at least 3 clue paths" doctrine is connected to the check |

Delivered artifacts: the lint module; a `lint` verb on `coc_module_projection.py`;
38 fixture cases with a trigger and a near-miss for each of the fifteen codes;
`tests/test_module_reachability.py`, `_cli.py` and `_ledger.py`;
`scripts/gen_module_reachability_ledger.py` with
`docs/status/module-reachability-ledger.md`.

Measured at delivery: 260 tests pass across the lint, CLI, ledger, projection
and graph suites. Every one of the fifteen checks was verified to be
individually mutation-killable. One mutant did survive the first sweep —
inverting the finding sort key changed nothing, because every fixture happened
to sort identically under both orders — and a discriminating case was added
until that mutant died.

L0 through L2 touch only `coc_module_projection.py`, a new generator script,
new tests, and this specification. L3 edits one skill file, which is
cross-track scope and requires explicit authorization at that point.

Completeness classification arrives in L1, so L0 MUST emit findings without a
`completeness` field and MUST NOT label any of them a defect. Until L1 lands, an
L0 report is a list of referential contradictions awaiting classification, and
saying otherwise would mark every in-progress progressive import as broken —
the exact failure §3.2 exists to prevent.

---

## Revision log

| Date | Change |
| --- | --- |
| 2026-09-02 | Initial specification. Evidence base measured on `0.8.1a@5a51c84a` across five scenario sets. Originating idea: the compiler-lint section of `docs/新 pi-coc 的重新设计.md`, narrowed to the checks the existing records can actually answer. |
| 2026-09-02 | Implemented L0–L3. An independent verification pass re-derived every §2 measurement from the raw JSON and confirmed all of them, then refuted five statements elsewhere in the draft, all corrected here: §2.1 undercounted the findings on four of the five sets; §5's `gate-self-locks` was not computable as written, because the starter's two `flag_set` gates are opened by a reachable affordance and treating them as closed manufactures a false finding; §6's worked example used a module-graph node id where the scenario record id differs; §7 cited a `parity --ir-dir` precedent that does not exist, since all eight pre-existing verbs require `--graph`; and §3.2's `mentions` disjunct is inert because no producer populates that field. Two rules that implementation settled by agreement rather than by specification are now written down: the zero-start-scene rule in §5, and the flag-gate scope in §5 and §10. |
