# Epistemic Compiler and Lifecycle v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate epistemic sidecars through a provenance-valid semantic exchange, gate them by confidence, support deterministic question lifecycle, and safely carry multiple cognitive effects per clue.

**Architecture:** Add `coc_epistemic_compile.py` for request/result artifacts, `coc_compile_confidence.py` for runtime readiness, and `coc_epistemic_lifecycle.py` for question transitions. Extend policy, resolver, and belief reducer with a backward-compatible schema-v2 `effects` list.

**Tech Stack:** Python 3.11, JSON, SHA-256, pytest, existing atomic file writer.

## Global Constraints

- Deterministic code never infers semantics from prose.
- Compiler results require evaluator id, matching request SHA, and reasons.
- Sidecars remain optional; v1 contracts remain valid.
- Critical confidence threshold is `0.80`.
- Reframes require authored reveal contracts.

---

### Task 1: Artifact-mediated compiler

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_epistemic_compile.py`
- Create: `tests/test_epistemic_compile.py`

**Interfaces:**
- `build_compile_request(scenario_dir, source_bundle=None) -> dict`
- `request_sha256(request) -> str`
- `write_compile_request(scenario_dir, artifacts_dir=None) -> Path`
- `validate_compile_result(request, result) -> list[str]`
- `install_compile_result(scenario_dir, request, result) -> dict`
- CLI: `request`, `install`, `scan`, `request-all`.

- [ ] **Step 1: Write failing tests**

```python
def test_request_excludes_raw_keeper_prose(tmp_path): ...
def test_request_sha_is_stable(tmp_path): ...
def test_result_rejects_wrong_evaluator(tmp_path): ...
def test_result_rejects_stale_request_sha(tmp_path): ...
def test_result_requires_reasons_for_critical_nodes(tmp_path): ...
def test_install_writes_three_validated_sidecars(tmp_path): ...
```

- [ ] **Step 2: Run RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_epistemic_compile.py -q -p no:cacheprovider
```

Expected: module import fails.

- [ ] **Step 3: Implement**

Use evaluator id `codex-epistemic-compiler-v1`. The request includes structured IDs, enums, player-safe summaries, source refs, confidence summaries, expected schema, and semantic constraints. Installation writes temporary files, validates the combined scenario, then atomically replaces `epistemic-graph.json`, `reveal-contracts.json`, and `compile-confidence.json`.

- [ ] **Step 4: Run GREEN**

Run Task 1 tests. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_epistemic_compile.py tests/test_epistemic_compile.py
git commit -m "feat(compiler): add epistemic artifact exchange"
```

---

### Task 2: Compile confidence gate

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_compile_confidence.py`
- Create: `tests/test_compile_confidence.py`
- Modify: `plugins/coc-keeper/scripts/coc_story_director.py`
- Modify: `plugins/coc-keeper/scripts/coc_epistemic_policy.py`

**Interfaces:**
- `load_compile_confidence(scenario_dir) -> dict`
- `find_node_confidence(doc, node_type, node_id) -> dict | None`
- `effective_confidence(record) -> float | None`
- `node_ready(doc, node_type, node_id, threshold=None) -> dict`
- DirectorContext key: `compile_confidence`.

- [ ] **Step 1: Write failing tests**

```python
def test_effective_confidence_uses_minimum(): ...
def test_needs_review_is_not_ready(): ...
def test_missing_confidence_keeps_legacy_mode(): ...
def test_low_confidence_critical_effect_becomes_hold(): ...
def test_hold_requests_source_resolution(): ...
```

- [ ] **Step 2: Run RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_compile_confidence.py tests/test_epistemic_policy.py -q -p no:cacheprovider
```

- [ ] **Step 3: Implement**

A low-confidence critical node emits `HOLD`, `hold_reason=low_compile_confidence`, and a minimum-privilege `source_resolution_request`. Absence of the confidence sidecar preserves v1 behavior.

- [ ] **Step 4: Run GREEN**

Run Task 2 tests. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_compile_confidence.py plugins/coc-keeper/scripts/coc_story_director.py plugins/coc-keeper/scripts/coc_epistemic_policy.py tests/test_compile_confidence.py
git commit -m "feat(director): gate epistemic moves by confidence"
```

---

### Task 3: Multi-effect contract v2

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_epistemic_policy.py`
- Modify: `plugins/coc-keeper/scripts/coc_epistemic_resolve.py`
- Modify: `plugins/coc-keeper/scripts/coc_belief_state.py`
- Create: `tests/test_epistemic_multi_effect.py`

**Interfaces:**
- Contract schema v2 adds `effects: list[dict]`.
- Primary top-level fields mirror `effects[0]`.
- Every effect has stable `effect_id`.

- [ ] **Step 1: Write failing tests**

```python
def test_one_clue_confirms_fact_and_complicates_motive(): ...
def test_primary_effect_uses_player_model_ranking(): ...
def test_unready_reframe_does_not_suppress_ready_confirm(): ...
def test_failed_clue_holds_all_dependent_effects(): ...
def test_reducer_applies_each_effect_once(): ...
def test_v1_contract_remains_supported(): ...
```

- [ ] **Step 2: Run RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_epistemic_multi_effect.py -q -p no:cacheprovider
```

- [ ] **Step 3: Implement**

Build every valid evidence link for the selected clue, rank deterministically, resolve each effect independently after rules, and store applied effect IDs so replay cannot duplicate treatment.

- [ ] **Step 4: Run GREEN**

Run Task 3 and existing epistemic tests. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_epistemic_policy.py plugins/coc-keeper/scripts/coc_epistemic_resolve.py plugins/coc-keeper/scripts/coc_belief_state.py tests/test_epistemic_multi_effect.py
git commit -m "feat(director): support multi-effect clue updates"
```

---

### Task 4: Question lifecycle

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_epistemic_lifecycle.py`
- Create: `tests/test_epistemic_lifecycle.py`
- Modify: `plugins/coc-keeper/scripts/coc_scenario_compile.py`
- Modify: `plugins/coc-keeper/scripts/coc_belief_state.py`
- Modify: `plugins/coc-keeper/scripts/coc_director_apply.py`

**Interfaces:**
- `evaluate_question_transitions(graph, belief_state, world_state, committed_clue_ids, flags_set=None, visited_scene_ids=None, explicit_close_ids=None) -> dict`.
- Closure kinds: `clue_any`, `clue_all`, `evidence_count`, `flag_set`, `scene_entered`, `payoff`, `explicit`.

- [ ] **Step 1: Write failing tests**

```python
def test_clue_any_closes_question(): ...
def test_clue_all_waits_for_all(): ...
def test_evidence_count_uses_distinct_clues(): ...
def test_flag_and_scene_closures_use_structured_state(): ...
def test_payoff_requires_resolved_payoff_effect(): ...
def test_answered_question_does_not_reopen(): ...
def test_validator_rejects_unknown_closure_kind(): ...
```

- [ ] **Step 2: Run RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_epistemic_lifecycle.py -q -p no:cacheprovider
```

- [ ] **Step 3: Implement**

Evaluate transitions after clue commitment and world-state update. Pass explicit transitions to the belief reducer; do not infer closure from prose.

- [ ] **Step 4: Run GREEN**

Run lifecycle, compiler, and apply tests. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_epistemic_lifecycle.py plugins/coc-keeper/scripts/coc_scenario_compile.py plugins/coc-keeper/scripts/coc_belief_state.py plugins/coc-keeper/scripts/coc_director_apply.py tests/test_epistemic_lifecycle.py
git commit -m "feat(epistemic): add question lifecycle"
```

---

### Task 5: Migration request generation

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_epistemic_compile.py`
- Create: `tests/test_epistemic_migration.py`
- Modify: `plugins/coc-keeper/skills/coc-scenario-import/SKILL.md`
- Modify: `plugins/coc-keeper/skills/coc-scenario-import/references/compile-protocol.md`

**Interfaces:**
- `scan_scenarios(root) -> list[dict]`
- `write_requests_for_missing(root, artifacts_root) -> list[Path]`.

- [ ] **Step 1: Write failing tests**

```python
def test_scan_finds_only_missing_or_partial_sidecars(tmp_path): ...
def test_request_all_uses_stable_scenario_directories(tmp_path): ...
def test_migration_never_installs_without_result(tmp_path): ...
```

- [ ] **Step 2: Run RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_epistemic_migration.py -q -p no:cacheprovider
```

- [ ] **Step 3: Implement and document**

Scan compiled scenario directories only; skip logs and PDF cache. A complete migration has all three sidecars.

- [ ] **Step 4: Run GREEN**

Run Task 5 tests. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_epistemic_compile.py plugins/coc-keeper/skills/coc-scenario-import tests/test_epistemic_migration.py
git commit -m "feat(compiler): queue scenarios for epistemic migration"
```

---

### Task 6: Documentation and full verification

**Files:**
- Modify: `plugins/coc-keeper/skills/coc-scenario-import/references/story-graph-schema.md`
- Modify: `plugins/coc-keeper/references/director-protocol.md`

- [ ] **Step 1: Document compiler, confidence, effects, and closure schemas**
- [ ] **Step 2: Run focused tests**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_epistemic_compile.py tests/test_compile_confidence.py tests/test_epistemic_multi_effect.py tests/test_epistemic_lifecycle.py tests/test_epistemic_migration.py tests/test_epistemic_policy.py tests/test_belief_state.py tests/test_epistemic_runtime_integration.py -q -p no:cacheprovider
```

- [ ] **Step 3: Run metadata test**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_plugin_metadata.py -q -p no:cacheprovider
```

- [ ] **Step 4: Run full suite**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/ -q -p no:cacheprovider
```

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/skills/coc-scenario-import/references/story-graph-schema.md plugins/coc-keeper/references/director-protocol.md
git commit -m "docs(epistemic): document compiler and lifecycle v2"
```

## Self-review

- Semantic inference remains artifact-mediated.
- Confidence, multi-effect resolution, and closure have explicit APIs.
- V1 and legacy paths remain supported.
- Every installed authored ID is validated.

## Implementation Status

**Completed on 2026-07-11.** The implementation and verification mapping is in
`docs/superpowers/reviews/2026-07-11-scenario-epistemic-blueprint-completion-review.md`.
