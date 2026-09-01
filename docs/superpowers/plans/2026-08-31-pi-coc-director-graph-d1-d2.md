# Pi-Coc DirectorGraph D1–D2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Director layer's vocabulary (28 signal tags + 10 actions + 7 structure types + 4 conflict levels + 77 storylets + 16 time-cost categories) and its ~119 doctrine values out of Python literals and unsourced JSON into one source-controlled DirectorGraph artifact, **with bit-identical behavior**, and publish an honest ledger of which values nobody can explain.

**Architecture:** DirectorGraph is data, not control flow. `_base_score`, `select_action`, the override chain and the ladders keep their exact implementation and read named constants from `DirectorRuntime`. No new model-visible operation. `coc_director_apply.py` is not edited by any task in this plan.

**Tech Stack:** CPython 3.14.6, uv 0.11.16, pytest, existing `coc_rule_graph.py` compiler pattern, existing `coc_system_ontology.py` validator.

**Spec:** [`docs/specs/pi-coc-director-graph-runtime.md`](../../specs/pi-coc-director-graph-runtime.md)
**Evidence base:** [`docs/status/director-doctrine-inventory.md`](../../status/director-doctrine-inventory.md)

**Status: completed 2026-08-31** on `claude/pi-coc-director-graph-20260831-docs`
(`121e8908` for D1/D2, `ca472e01` for D3/D4/D5a). Director tests stayed at 337
with no assertion edited; the ontology validator stayed clean. See the
Implementation log in the spec for the four corrections the plan needed.

**Non-negotiable:** no value changes in this plan. Every migrated number must be bit-identical to the literal it replaces. Retuning is slice D5 and is out of scope here.

---

## Pre-migration baseline (measured 2026-08-31 on `0.8.1a@60c1c4b4`)

```text
tests/test_story_director.py tests/test_storylets.py tests/test_director_apply.py
tests/test_director_projection.py tests/test_director_strategies.py
  -> 337 passed in 13.35s

plugins/coc-keeper/scripts/coc_system_ontology.py
  -> {"ok": true, "findings": []}   exit 0
```

Every task below must preserve both numbers. A drop in the 337, or any
ontology finding, is a stop condition.

---

## File responsibilities

- `plugins/coc-keeper/references/director-graph-contract-v1.json`: closed schema, node/relation kinds, evidence classes, authority laws.
- `plugins/coc-keeper/references/director-graph.json`: the built production artifact.
- `plugins/coc-keeper/scripts/coc_director_graph.py`: `prepare` / `accept` / `build` compiler, mirroring `coc_rule_graph.py`.
- `plugins/coc-keeper/scripts/coc_director_runtime.py`: `vocabulary()` / `doctrine(structure_type)` loader; fails closed.
- `plugins/coc-keeper/scripts/coc_story_director.py`: reads vocabulary and doctrine from the runtime; control flow unchanged.
- `plugins/coc-keeper/references/system-ontology-registry-v1.json`: promote `graph:director:production`.
- `tests/test_director_graph.py`: new — contract, compiler, accountability and residue gates.
- `tests/fixtures/_gen_director_graph.py`: reproducible generator for the committed artifact.

---

## Task 1: Contract

**Files:**
- Create: `plugins/coc-keeper/references/director-graph-contract-v1.json`

- [ ] Declare `contract_id: "coc.director-graph.v1"`, `schema_version: 1`, Draft 2020-12 closed schema.
- [ ] Declare the six vocabulary `node_kinds` and the six doctrine `node_kinds` from spec §4.
- [ ] Declare internal `relation_kinds` (`part-of`, `sourced-from`, `scores`, `weights`, `gates`, `ranks`, `advises`, `supersedes`).
- [ ] Declare the three `evidence_classes` and make `rationale` / `origin` / `falsifiable_by` **required** whenever `evidence_class == "authored-doctrine"`.
- [ ] Copy the six `authority_laws` from spec §6 verbatim.
- [ ] Reuse the RuleGraph `semantic_id_pattern`; do not invent a second id grammar.

## Task 2: RED — compiler and vocabulary package test

**Files:**
- Create: `tests/test_director_graph.py`
- Create: `plugins/coc-keeper/scripts/coc_director_graph.py`
- Create: `tests/fixtures/_gen_director_graph.py`

- [ ] Write a failing package test asserting:

```python
assert graph["contract_id"] == "coc.director-graph.v1"
assert counts(graph, "director-action") == 10
assert counts(graph, "player-signal") == 28
assert counts(graph, "structure-type") == 7
assert counts(graph, "conflict-level") == 4
assert counts(graph, "storylet") == 77
assert counts(graph, "time-cost-category") == 16
```

- [ ] Run it and verify RED because no artifact exists.
- [ ] Implement `prepare` / `accept` / `build` following `coc_rule_graph.py`'s three-stage shape; `build` writes a content digest.
- [ ] Implement the generator to read the current `structure-weights.json`, `storylet-library.json`, `time-costs.json` and the `coc_story_director.py` declarations as **input**, so the artifact is reproducible rather than hand-typed.
- [ ] Run to GREEN.

## Task 3: Vocabulary plane cutover

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_director_runtime.py`
- Modify: `plugins/coc-keeper/scripts/coc_story_director.py`

- [ ] Implement `DirectorRuntime.vocabulary()`; a missing or invalid graph raises at load. **No fallback to embedded literals.**
- [ ] Replace `ACTIONS`, `_LOW_AGENCY_TAGS`, `_ROUTINE_PROGRESS_TAGS`, `_DRAMATIC_PROGRESS_ADVANCE_UNTIL`, `_NON_BLOCKING_RULE_REQUEST_KINDS`, `_SOCIAL_REVEAL_DELIVERY_KINDS` with runtime lookups. Keep `_LOW_AGENCY_RECENT_CLASSES` derived exactly as today.
- [ ] Run the five director test files:

```bash
PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest \
  tests/test_story_director.py tests/test_storylets.py \
  tests/test_director_apply.py tests/test_director_projection.py \
  tests/test_director_strategies.py -q -p no:cacheprovider
```

- [ ] Verify GREEN **with zero assertion edits**. Any assertion that needs editing is a behavior change and must stop the task.

## Task 4: RED — doctrine accountability gate

**Files:**
- Modify: `tests/test_director_graph.py`

- [ ] Write a failing test asserting that for every doctrine node:

```python
assert node["evidence_class"] in {"rule-derived", "module-derived", "authored-doctrine"}
if node["evidence_class"] == "authored-doctrine":
    for field in ("rationale", "origin", "falsifiable_by"):
        assert node[field].strip()
```

- [ ] Write a failing test asserting the two page-cited tunables are **not** `authored-doctrine`:

```python
assert node_for("pushed-fail-pressure-nudge")["evidence_class"] == "rule-derived"
assert node_for("fair-warning-lethal-ladder")["evidence_class"] == "rule-derived"
```

- [ ] Verify RED against an empty doctrine plane.

## Task 5: Doctrine plane transcription

**Files:**
- Modify: `plugins/coc-keeper/references/director-graph.json` (generated)
- Modify: `tests/fixtures/_gen_director_graph.py`
- Modify: `plugins/coc-keeper/scripts/coc_story_director.py`

- [ ] Transcribe the 70 `structure-weight` cells and the 10-entry `tiebreak-order` from `structure-weights.json`.
- [ ] Transcribe the 24 Layer-1 `scoring-rule` values from `_base_score` (inventory §2 table).
- [ ] Transcribe the ~15 Layer-3 `threshold` and `affinity-ladder` values (inventory §3 table).
- [ ] For each: set `evidence_class`. Only `pushed-fail-pressure-nudge` (p.83-85) and `fair-warning-lethal-ladder` (p.209) are `rule-derived`. **Everything else is `authored-doctrine` with `origin: "unknown-legacy-tuning"` unless a real origin is found in git history or a live document. Do not invent a rationale — for unknown values, `rationale` states the observable behavior the value produces, and `falsifiable_by` names the DebugExperiment shape.**
- [ ] Implement `DirectorRuntime.doctrine(structure_type)`.
- [ ] Replace the literals in `_base_score`, `select_action`, `_compression_budget`, `_low_agency_max_beats`, `_scene_exit_pressure_directive`, `apply_rule_signal_overrides`, `_build_pressure_moves`, `_clue_route_priority` with named doctrine lookups.
- [ ] Run the five director test files to GREEN with zero assertion edits.

## Task 6: Bit-identity and residue gates

**Files:**
- Modify: `tests/test_director_graph.py`

- [ ] Add a bit-identity test that pins every migrated value against a frozen table of the pre-migration literals (transcribed from the inventory), so a future accidental retune fails.
- [ ] Add a residue gate: AST-walk the migrated functions in `coc_story_director.py` and assert no non-trivial numeric literal remains outside an allowlist of plumbing constants (schema versions, truncation limits, list indices).
- [ ] Run both to GREEN. A residue failure means a doctrine value was missed — add it to the graph rather than to the allowlist.

## Task 7: Registry promotion

**Files:**
- Modify: `plugins/coc-keeper/references/system-ontology-registry-v1.json`
- Modify: `tests/test_system_ontology.py` only if it pins the absent-artifact row

- [ ] Flip `graph:director:production` from `absent-production-artifact` to `production-artifact` with `ontology_contract: "coc.director-graph.v1"` and the artifact path.
- [ ] Update the `coverage` row for `director` from `absent-production-artifact` / `not-applicable`.
- [ ] Run:

```bash
PYTHONDONTWRITEBYTECODE=1 uv run --frozen python \
  plugins/coc-keeper/scripts/coc_system_ontology.py
```

- [ ] Expect exit 0 with no findings. Do **not** add `grounded-by` relations in this plan — that is slice D3.

## Task 8: Ledger and final verification

**Files:**
- Create: `docs/status/director-doctrine-ledger.md`
- Modify: `docs/status/director-doctrine-inventory.md` (append a "superseded by ledger" note)

- [ ] Generate the ledger from the built artifact: every doctrine node, its value, evidence class, origin, and — for `unknown-legacy-tuning` rows — its `falsifiable_by`. This is the plan's headline deliverable.
- [ ] Run the full suite:

```bash
PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest tests -q -p no:cacheprovider
```

- [ ] Reproduce the artifact from the generator and require byte-identical output.
- [ ] Inspect the staged diff; confirm `coc_director_apply.py` is untouched and no test assertion was edited.
- [ ] Commit the scoped files and report the commit hash in the handoff.

---

## Stop conditions

Stop and report instead of improvising if any of these occur:

- a director test assertion would have to change to stay green;
- a migrated value cannot be made bit-identical;
- the residue gate keeps failing on a literal that is genuinely doctrine but has no clean home in the contract;
- a task would require editing `coc_director_apply.py`;
- the ontology validator reports an authority violation.
