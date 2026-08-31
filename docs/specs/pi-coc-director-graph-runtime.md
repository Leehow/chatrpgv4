# Pi-Coc DirectorGraph specification

> **Status:** Proposed — not implementation-authorized. Slice D0 (this document)
> only. D1–D5 each require their own authorization.
> **ID:** `pi-coc-director-graph-runtime`
> **Track:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`; Codex-host implementation,
> adapters, prompts, launchers, tests, and documentation remain off-limits.
> **Scope owner:** the Director decision surface inside `plugins/coc-keeper/`.
> **Last updated:** 2026-08-31
> **Depends on:** [ADR 0003 system ontology composition registry](../adr/0003-system-ontology-composition-registry.md),
> [DebugExperiment](pi-coc-debug-experiment.md),
> [`docs/ruleset-contract.md`](../ruleset-contract.md).
> **Evidence base:** [Director doctrine inventory](../status/director-doctrine-inventory.md)
> — measured on `0.8.1a@60c1c4b4`, read-only.

The words MUST, MUST NOT, SHOULD, and MAY below are acceptance requirements.

---

## 1. User job, success condition, and hollow delivery

The user wants the Director's pacing doctrine to become an accountable,
versioned artifact instead of ~119 unexplained numbers spread across a 4672-line
Python file and three unsourced JSON tables.

Success looks like:

- every Director action, signal tag, structure type and storylet is a node in
  one source-controlled artifact rather than a literal in code;
- every score, weight, threshold and ladder position carries an explicit
  evidence class, and an `authored-doctrine` value additionally carries a
  rationale, an origin, and a statement of what experiment could refute it;
- the values that *can* be traced to a rulebook page are bound to that page the
  same way RuleGraph binds its rules;
- the scoring algorithm itself stays exactly where it is — the graph supplies
  data, not control flow;
- `graph:director:production` stops being `absent-production-artifact` in the
  system ontology registry, and its links to ModuleGraph and RuleGraph are
  machine-validated;
- a Director tuning change becomes a reviewable data change with a stated
  hypothesis and a DebugExperiment result, instead of an unexplained diff;
- the Keeper's turn-facing surface does not change at all.

Hollow delivery includes:

- copying the 119 numbers into JSON and calling that accountability — a value
  without `rationale`, `origin` and `falsifiable_by` has not been made
  accountable, only moved;
- inventing rationales for numbers whose origin is genuinely unknown, instead
  of recording `origin: unknown-legacy-tuning`;
- letting DirectorGraph gate, block, reorder, or veto a player action, a
  Keeper choice, or a scene transition;
- building a universal graph interpreter that walks the graph to *produce* the
  decision, superseding `select_action` (ADR 0003 rejects this by name);
- adding a new model-visible operation for the Director;
- reading module or player prose anywhere in this layer;
- absorbing `coc_director_apply.py` receipts, NPC agency persistence, clue-gate
  disclosure, or state commits into the graph;
- tuning any value during the migration slices, so that the "before" baseline
  is lost;
- claiming DirectorGraph completeness while `coc_story_director.py` still holds
  doctrine literals not represented in the artifact.

### 1.1 Scope

| In scope | Out of scope |
| --- | --- |
| Director action / signal / structure / storylet vocabulary | The scoring algorithm itself |
| Scores, weights, thresholds, ladders and their evidence | `coc_director_apply.py` receipts, NPC agency, state commits |
| `grounded-by` links to ModuleGraph / RuleGraph / live state | Any new authority for the Director |
| Registry promotion of `graph:director:production` | New model-visible operations |
| DebugExperiment baseline and falsification protocol | Retuning values during migration |
| Recording unexplained values as unexplained | Inventing explanations |

---

## 2. Why this graph is not like the other two

| Graph | Evidence is | A defect looks like |
| --- | --- | --- |
| ModuleGraph | module PDF pages | wrong or missing extraction |
| RuleGraph | rulebook pages | disagreement with the book |
| **DirectorGraph** | **there is no book** | **nobody can say why the number is that number** |

No rulebook states that PRESSURE scores `0.85` when a player has yielded the
scene twice. DirectorGraph is therefore **not a source-fidelity graph**. It is a
**doctrine graph**: an artifact whose job is to make design claims explicit,
attributable, and falsifiable.

This changes the acceptance regime. RuleGraph's §14.2 gates ask "does it match
the source". DirectorGraph's gates ask instead:

1. is every value represented, with nothing left behind in code?
2. does every value declare an evidence class?
3. does every `authored-doctrine` value carry `rationale`, `origin` and
   `falsifiable_by`?
4. is behavior bit-identical to the pre-migration baseline?

Fidelity is replaced by **accountability plus behavioral identity**.

---

## 3. Binding design decisions

1. **DirectorGraph is data, not control flow.** `_base_score`, `select_action`,
   and the override chain keep their current implementation and read their
   constants from the graph.
2. **The authority plane is `advisory`,** as ADR 0003 already fixed. The graph
   MUST NOT gate play. Its only outward relation is `grounded-by`.
3. **Three planes:** vocabulary, doctrine, grounding (§4).
4. **Three evidence classes,** with `authored-doctrine` carrying mandatory
   accountability fields (§5).
5. **No new model-visible operation.** `director.advise`, `storylets.suggest`,
   `actions.advise`, `npc.advise` and `threat.query` keep their exact current
   schemas. The operation count does not change.
6. **No prose is read.** The Director already consumes only structured ids,
   counters and booleans; the contract fixes that so it cannot regress.
7. **Migration never retunes.** Slices D1–D4 MUST produce bit-identical
   behavior. Only D5 changes a value, and only with a recorded experiment.
8. **Storage is ordinary validated JSON.** No graph database, embedding store,
   or scoring DSL.
9. **`coc_director_apply.py` is out of scope** and MUST NOT be edited by any
   slice of this specification.

---

## 4. Graph shape

Artifact: `plugins/coc-keeper/references/director-graph.json`
Contract: `plugins/coc-keeper/references/director-graph-contract-v1.json`

### 4.1 Vocabulary plane

| `node_kind` | Migrates from | Count |
| --- | --- | --- |
| `director-action` | `ACTIONS` | 10 |
| `player-signal` | `_LOW_AGENCY_TAGS`, `_ROUTINE_PROGRESS_TAGS`, `_DRAMATIC_PROGRESS_ADVANCE_UNTIL`, request/delivery kind sets | 28 (11+8+6+1+2) |
| `structure-type` | `structure-weights.json` `types` | 7 |
| `conflict-level` | `storylet-library.json` `conflict_levels` | 4 |
| `storylet` | `storylet-library.json` `storylets` | 77 |
| `time-cost-category` | `time-costs.json` | 16 |

### 4.2 Doctrine plane

| `node_kind` | Purpose | Migrates from |
| --- | --- | --- |
| `scoring-rule` | one action's score under one condition | `_base_score` branches |
| `structure-weight` | one (structure-type, action) multiplier | the 70 weight cells |
| `tiebreak-order` | deterministic tie resolution | `tiebreak_order` |
| `threshold` | a named counter/fraction gate | `stalled_turns >= n`, `low_agency_continue_count >= 2`, clock `2/3`, `lethal_chances_used >= 3`, compression bounds |
| `affinity-ladder` | ordered structured-match preference | `_build_pressure_moves` rank ladder |
| `craft-directive` | advisory Keeper-craft guidance | the page-cited directives |

### 4.3 Relations

Internal: `part-of`, `sourced-from`, `scores`, `weights`, `gates`, `ranks`,
`advises`, `supersedes`.

Cross-graph: **only** `grounded-by`, per ADR 0003 —
`director → module.scene | rule.rule | rule.decision | rule.effect |
live-state.live-state-fact`, `authority_effect: advisory-only`.

---

## 5. Evidence classes

Every doctrine node MUST declare exactly one:

| Class | Meaning | Required fields |
| --- | --- | --- |
| `rule-derived` | the value follows from a rulebook rule | `evidence_span_ids` bound to real pages, or a `grounded-by` edge to a RuleGraph node |
| `module-derived` | the value follows from authored module structure | `grounded-by` edge to a ModuleGraph node |
| `authored-doctrine` | a design claim this project makes | `rationale`, `origin`, `falsifiable_by` |

`authored-doctrine` field semantics:

- **`rationale`** — why this value, in one sentence, in design terms.
- **`origin`** — where it came from: a commit, a playtest finding, a retired
  spec, or the literal token `unknown-legacy-tuning`. Guessing is prohibited.
- **`falsifiable_by`** — the DebugExperiment shape that could refute it: which
  checkpoint, which lanes, what observable difference would count as evidence
  against. A value for which no such experiment can be described is by
  definition not a design claim, and that fact MUST be recorded rather than
  papered over.

The inventory establishes the expected starting distribution: roughly 119
values will enter as `authored-doctrine` with `origin: unknown-legacy-tuning`.
**That is the correct D2 outcome, not a failure.** The deliverable of D2 is an
honest ledger, not 119 invented explanations.

---

## 6. Authority laws

These MUST appear verbatim in the contract's `authority_laws`:

1. DirectorGraph is advisory. It never gates, blocks, reorders or vetoes a
   player action, a Keeper choice, a scene transition, or a rules settlement.
2. DirectorGraph supplies data to the existing scoring implementation. It is
   never traversed to produce a decision, and no universal graph interpreter
   may be built over it.
3. DirectorGraph never reads module, scene, or player prose. Only structured
   ids, enums, counters, thresholds and booleans.
4. DirectorGraph never selects player intent, clue relevance, NPC motive, or
   narration content. Those remain Keeper or LLM semantic judgments.
5. Absence is not prohibition. An action, beat, or pacing move not present in
   the graph is not thereby forbidden to the Keeper.
6. DirectorGraph holds no execution or state authority. Receipts, NPC agency
   persistence, clue-gate disclosure and state commits stay in
   `coc_director_apply.py`.

---

## 7. Runtime seam

```text
DirectorRuntime.vocabulary()             -> actions, signals, structure_types,
                                            conflict_levels, storylets,
                                            time_cost_categories
DirectorRuntime.doctrine(structure_type) -> scoring_rules, structure_weights,
                                            tiebreak_order, thresholds,
                                            affinity_ladders, craft_directives
```

`_load_structure_weights()` is replaced by `DirectorRuntime.doctrine(...)`.
`_base_score` and `select_action` read named constants from the returned
doctrine instead of literals. Their control flow does not change.

Failure semantics: a missing or invalid DirectorGraph MUST fail closed at load
with a host-internal finding. It MUST NOT silently fall back to embedded
literals, because a silent fallback would reintroduce the untracked values this
specification exists to eliminate.

---

## 8. Implementation slices

Each slice requires separate authorization.

### D0 — this specification
Deliverables: this document and the inventory it cites.
Gate: reviewed; no conflict with ADR 0003 authority laws.

### D1 — contract, compiler, vocabulary plane
Deliverables: `director-graph-contract-v1.json`; `coc_director_graph.py`
(`prepare` / `accept` / `build`, mirroring `coc_rule_graph.py`); the six
vocabulary node kinds populated; code reads vocabulary from the graph.
Gates:
1. compiler round-trip is byte-stable;
2. `tests/test_story_director.py`, `test_storylets.py`, `test_director_apply.py`,
   `test_director_projection.py`, `test_director_strategies.py` pass **with no
   assertion edited**;
3. registry flips `graph:director:production` to `production-artifact` and
   `coc_system_ontology.py` validates clean;
4. no behavior change.

### D2 — doctrine plane (transcribe, do not tune)
Deliverables: all ~119 values as doctrine nodes with evidence classes; the
`unknown-legacy-tuning` ledger; `_base_score` / `select_action` /
`_compression_budget` / ladders reading from the graph.
Gates:
1. every value in the graph is **bit-identical** to the value it replaced;
2. no director test assertion is edited;
3. every `authored-doctrine` node has all three accountability fields present
   and non-empty;
4. a `grep` gate proves no doctrine literal remains in the migrated functions;
5. the ledger is published as a status document.

### D3 — grounding plane
Deliverables: `grounded-by` edges from signals to RuleGraph decisions/effects
and from storylets to ModuleGraph scenes/clues; registry references and
relations.
Gates: ontology validator clean; dangling references fail closed; at least the
three production healing effects carry a real `grounded-by` edge; the two
page-cited scoring tunables (p.83-85, p.209) are reclassified from
`authored-doctrine` to `rule-derived` with real span bindings.

### D4 — behavioral baseline
Deliverables: a DebugExperiment `production`-profile baseline over one settled
checkpoint, recording selected action, score distribution and directives.
Gates: repeated runs over the same checkpoint reproduce the same Director
decisions; the baseline is committed as evidence.

### D5 — first accountable retune
Deliverables: one or two `unknown-legacy-tuning` values changed, each with a
multi-lane DebugExperiment result written back into its node's `rationale` and
`origin`.
Gates:
1. `production` profile lanes only — the narrow `rules-director-single-draft`
   profile MUST NOT be used as Director acceptance evidence, because the
   Director runs on every turn and has no "could not be reached" excuse;
2. one value per experiment;
3. the outcome is recorded whether it supports or refutes the change.

D5 is deliberately open-ended. DirectorGraph is complete when D1–D4 land; D5 is
the ongoing practice the artifact exists to enable.

---

## 9. Validation matrix

| Area | Check |
| --- | --- |
| Contract | closed schema; unknown fields rejected |
| Compiler | `prepare`/`accept`/`build` round-trip byte-stable |
| Identity | D1–D4 behavior bit-identical to baseline |
| Accountability | no `authored-doctrine` node missing a required field |
| Residue | no doctrine literal left in migrated functions |
| Authority | no `grounded-by` target outside the ADR 0003 allowed kinds |
| Registry | `coc_system_ontology.py` clean with director promoted |
| Determinism | repeated DebugExperiment runs reproduce decisions |

---

## 10. Known findings carried in from the inventory

Recorded, not repaired by this specification:

1. `structure-weights.json` and `rule-index.json` both cite a design spec that
   no longer exists in the tree.
2. The PAYOFF branch comment justifies its scale against a REVEAL range
   (`0.55-0.85`) that the code no longer produces (`0.9` / `0.75`).
3. `rule-index.json` records `storylet_count: 64` against 77 actual storylets,
   and `category_count: 15` against 16 actual time-cost categories.
4. No director test asserts any doctrine value, so no value is protected by a
   regression net today.
