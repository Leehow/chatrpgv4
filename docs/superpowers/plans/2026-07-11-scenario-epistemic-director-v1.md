# Scenario Epistemic Director v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional epistemic scenario sidecar, persistent player belief state, deterministic belief-update policy, DirectorPlan integration, and post-rule apply semantics without breaking legacy scenarios.

**Architecture:** Keep the existing seven-file Scenario IR and scene-action Director unchanged. Add two focused runtime modules: `coc_epistemic_policy.py` for pure planning and `coc_belief_state.py` for snapshot/event persistence. The scenario compiler validates optional `epistemic-graph.json` and `reveal-contracts.json`; the Director loads and emits an `epistemic_contract`; the apply layer commits it only when its supporting clue was actually committed.

**Tech Stack:** Python 3.11, JSON sidecars, pytest, existing `coc_fileio` atomic writes, existing GitHub Actions test workflow.

## Global Constraints

- Shared runtime behavior lives only in `plugins/coc-keeper/`.
- Deterministic runtime must not infer meaning from free prose or keyword hits.
- Sidecars are optional and legacy scenarios must remain valid.
- Keeper-secret prose must not flow into belief state or narrator-facing contracts.
- Belief treatment is applied only after actual clue commitment.
- No new dependencies, embeddings, vector database, or in-process LLM classifier.

---

### Task 1: Epistemic sidecar validation

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_scenario_compile.py`
- Modify: `tests/test_scenario_compile.py`

**Interfaces:**
- Consumes: existing compiled dict keys `story_graph`, `clue_graph`, `npc_agendas`, `threat_fronts`.
- Produces: optional validation of `epistemic_graph` and `reveal_contracts` in `validate_compiled_scenario`; optional file loading in `validate_scenario`.

- [ ] **Step 1: Write failing tests**

Add fixtures and tests covering:

```python
def _add_valid_epistemic_sidecars(sc: Path) -> None:
    (sc / "epistemic-graph.json").write_text(json.dumps({
        "schema_version": 1,
        "questions": [{
            "question_id": "q-motive",
            "layer": "motive",
            "player_facing_question": "Why?",
            "truth_ref": "truth-motive",
            "importance": "critical",
            "opens_questions": ["q-structure"],
            "source_refs": [{"path": "pdf/module.pdf", "page": 10}],
        }, {
            "question_id": "q-structure",
            "layer": "structure",
            "player_facing_question": "Who benefits?",
            "truth_ref": "truth-structure",
            "importance": "major",
        }],
        "evidence_links": [{
            "clue_id": "a",
            "question_id": "q-motive",
            "effect": "confirm",
            "strength": 0.8,
        }],
    }))
    (sc / "reveal-contracts.json").write_text(json.dumps({
        "schema_version": 1,
        "contracts": [{
            "reveal_contract_id": "rc-motive",
            "mode": "reframe",
            "target_question_id": "q-motive",
            "trigger_clue_ids": ["a"],
            "preserve_as_true": ["truth-lied"],
            "revise_hypothesis_kinds": ["cultist"],
            "setup_refs": ["b", "c"],
            "opens_questions": ["q-structure"],
            "explanation_targets": ["why-one-name"],
            "must_not": ["do not invalidate old facts"],
        }],
    }))
```

Tests:

```python
def test_validate_compiled_epistemic_sidecars_pass(tmp_path): ...
def test_validate_compiled_epistemic_broken_clue_ref_errors(tmp_path): ...
def test_validate_compiled_reframe_requires_two_setup_refs(tmp_path): ...
def test_validate_compiled_reframe_requires_preserved_truth(tmp_path): ...
def test_validate_scenario_legacy_without_epistemic_files_still_passes(tmp_path): ...
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_scenario_compile.py -q -p no:cacheprovider
```

Expected: new tests fail because sidecars are not loaded or validated.

- [ ] **Step 3: Implement validation**

Add constants:

```python
VALID_EPISTEMIC_LAYERS = frozenset({
    "fact", "identity", "method", "motive", "causal", "structure", "world", "personal",
})
VALID_EPISTEMIC_EFFECTS = frozenset({
    "confirm", "expand", "complicate", "reframe", "payoff",
})
VALID_REVEAL_MODES = VALID_EPISTEMIC_EFFECTS
```

Add `_check_epistemic_sidecars(compiled, id_maps)` that validates duplicate question ids, references, enum values, critical-question coverage, strength range, and reframe contracts. Invoke it from `validate_compiled_scenario`.

Extend `validate_scenario` to load optional files only when present:

```python
if (scenario_dir / "epistemic-graph.json").exists():
    compiled["epistemic_graph"] = _read(scenario_dir / "epistemic-graph.json")
if (scenario_dir / "reveal-contracts.json").exists():
    compiled["reveal_contracts"] = _read(scenario_dir / "reveal-contracts.json")
```

- [ ] **Step 4: Run tests and verify GREEN**

Run the Task 1 command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_scenario_compile.py tests/test_scenario_compile.py
git commit -m "feat(scenario): validate epistemic sidecars"
```

---

### Task 2: Deterministic epistemic policy

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_epistemic_policy.py`
- Create: `tests/test_epistemic_policy.py`

**Interfaces:**
- Consumes: `plan_epistemic_contract(ctx: dict, clue_policy: dict, scene_action: str) -> dict`.
- Produces: JSON-compatible contract with `schema_version`, `mode`, `target_question_id`, `target_layer`, `belief_refs`, `deliver_clue_ids`, `preserve_fact_refs`, `revise_hypothesis_refs`, `setup_refs`, `open_question_ids`, `explanation_targets`, `must_not`, and optional `hold_reason`.

- [ ] **Step 1: Write failing tests**

Tests:

```python
def test_missing_sidecars_returns_none_contract(): ...
def test_confirm_link_builds_confirm_contract(): ...
def test_matching_question_attaches_active_belief_refs(): ...
def test_reframe_without_setup_returns_hold(): ...
def test_reframe_with_discovered_setup_returns_reframe(): ...
def test_malformed_effect_degrades_to_none(): ...
```

- [ ] **Step 2: Run tests and verify RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_epistemic_policy.py -q -p no:cacheprovider
```

Expected: import/module-not-found failure.

- [ ] **Step 3: Implement minimal policy**

Public API:

```python
def empty_contract() -> dict[str, Any]: ...
def plan_epistemic_contract(
    ctx: dict[str, Any],
    clue_policy: dict[str, Any],
    scene_action: str,
) -> dict[str, Any]: ...
```

Implementation rules exactly match the design spec: structured lookup only, selected clue from `reveal` then `fallback_routes`, evidence link lookup, question lookup, active belief attachment by question id, reveal-contract lookup for `reframe`, setup subset check against discovered clues plus this-turn clue, and conservative `NONE`/`HOLD` degradation.

- [ ] **Step 4: Run tests and verify GREEN**

Run Task 2 tests. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_epistemic_policy.py tests/test_epistemic_policy.py
git commit -m "feat(director): add deterministic epistemic policy"
```

---

### Task 3: Persistent belief state reducer

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_belief_state.py`
- Create: `tests/test_belief_state.py`

**Interfaces:**
- Produces:
  - `normalize_belief_state(payload: dict | None) -> dict`
  - `read_belief_state(campaign_dir: Path) -> dict`
  - `apply_belief_turn(campaign_dir: Path, plan: dict, committed_clue_ids: list[str], investigator_id: str, ts: str) -> list[dict]`
- Writes: `save/belief-state.json`, `logs/belief-events.jsonl`.

- [ ] **Step 1: Write failing tests**

Tests:

```python
def test_structured_hypothesis_is_asserted(tmp_path): ...
def test_legacy_hypothesis_is_persisted_unbound(tmp_path): ...
def test_repeated_hypothesis_updates_existing_record(tmp_path): ...
def test_committed_confirm_updates_support_and_treatment(tmp_path): ...
def test_uncommitted_epistemic_clue_does_not_update_treatment(tmp_path): ...
def test_reframe_updates_status_and_opens_question(tmp_path): ...
```

- [ ] **Step 2: Run tests and verify RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_belief_state.py -q -p no:cacheprovider
```

Expected: import/module-not-found failure.

- [ ] **Step 3: Implement reducer and persistence**

Use `coc_fileio.write_json_atomic`. Do not infer meaning from strings. A structured candidate is read from:

```python
rich = (plan.get("turn_input") or {}).get("player_intent_rich") or {}
candidate = rich.get("belief_candidate", rich.get("player_hypothesis"))
```

For strings, create an unbound hypothesis. For dicts, accept only explicit fields. Generate stable sequential ids from existing state. Apply treatment only when `set(epistemic_contract.deliver_clue_ids) & set(committed_clue_ids)` is non-empty and mode is not `NONE`/`HOLD`.

Append every event to `belief-events.jsonl`; return events so caller can mirror them to `events.jsonl`.

- [ ] **Step 4: Run tests and verify GREEN**

Run Task 3 tests. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_belief_state.py tests/test_belief_state.py
git commit -m "feat(memory): persist player belief state"
```

---

### Task 4: Story Director integration

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_story_director.py`
- Modify: `tests/test_story_director.py`

**Interfaces:**
- Consumes: `coc_epistemic_policy.plan_epistemic_contract`.
- Adds context keys: `epistemic_graph`, `reveal_contracts`, `belief_state`.
- Adds DirectorPlan key: `epistemic_contract`.
- Adds `turn_input.player_intent_rich` so apply can persist structured hypotheses.

- [ ] **Step 1: Write failing tests**

Add tests that create optional sidecars and belief state in a campaign fixture, then assert:

```python
ctx["epistemic_graph"]["questions"]
ctx["reveal_contracts"]["contracts"]
ctx["belief_state"]["hypotheses"]
plan["epistemic_contract"]["mode"] == "CONFIRM"
plan["turn_input"]["player_intent_rich"] == rich_intent
```

Also assert a legacy fixture emits `{"schema_version": 1, "mode": "NONE"}`.

- [ ] **Step 2: Run tests and verify RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_story_director.py -q -p no:cacheprovider
```

Expected: missing context/plan fields.

- [ ] **Step 3: Implement integration**

Load sibling modules near the existing imports:

```python
coc_epistemic_policy = _load_sibling("coc_epistemic_policy", "coc_epistemic_policy.py")
coc_belief_state = _load_sibling("coc_belief_state", "coc_belief_state.py")
```

Extend context return with optional JSON files and normalized belief state. After `clue_policy` is selected, compute:

```python
epistemic_contract = coc_epistemic_policy.plan_epistemic_contract(ctx, clue_policy, action)
```

Emit it in the plan and include `player_intent_rich` under `turn_input`.

- [ ] **Step 4: Run tests and verify GREEN**

Run Task 4 tests. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_story_director.py tests/test_story_director.py
git commit -m "feat(director): emit epistemic contracts"
```

---

### Task 5: Post-rule apply integration

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_director_apply.py`
- Modify: `tests/test_director_apply.py`

**Interfaces:**
- Consumes: `coc_belief_state.apply_belief_turn(...)`.
- Applies after `_resolve_committed_clues` and after clue reveal events are known.
- Mirrors returned belief events into `logs/events.jsonl`.

- [ ] **Step 1: Write failing tests**

Tests:

```python
def test_apply_committed_epistemic_clue_updates_belief_state(tmp_path): ...
def test_apply_failed_obscured_clue_does_not_apply_belief_treatment(tmp_path): ...
def test_apply_duplicate_decision_does_not_duplicate_belief_events(tmp_path): ...
```

- [ ] **Step 2: Run tests and verify RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_director_apply.py -q -p no:cacheprovider
```

Expected: belief files/events absent.

- [ ] **Step 3: Implement apply hook**

Load `coc_belief_state` as a sibling. Immediately after committed clue processing and before unrelated NPC/pressure writes, call:

```python
belief_events = coc_belief_state.apply_belief_turn(
    campaign_dir,
    plan,
    committed_clues,
    investigator_id,
    ts,
)
for event in belief_events:
    events.append(event)
    _append_jsonl(logs / "events.jsonl", event)
```

The belief module owns `belief-events.jsonl`; apply owns the aggregate `events.jsonl` mirror.

- [ ] **Step 4: Run tests and verify GREEN**

Run Task 5 tests. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_director_apply.py tests/test_director_apply.py
git commit -m "feat(apply): commit resolved belief updates"
```

---

### Task 6: Scenario import documentation and complete verification

**Files:**
- Modify: `plugins/coc-keeper/skills/coc-scenario-import/SKILL.md`
- Modify: `plugins/coc-keeper/skills/coc-scenario-import/references/compile-protocol.md`
- Modify: `plugins/coc-keeper/skills/coc-scenario-import/references/story-graph-schema.md`
- Modify: `plugins/coc-keeper/references/director-protocol.md`

**Interfaces:**
- Documents optional sidecar production and the `epistemic_contract` field.

- [ ] **Step 1: Update documentation**

Add an optional post-seven-file compilation step:

```text
8a. For belief-aware directing, compile epistemic-graph.json and reveal-contracts.json.
8b. Critical questions link to source-backed clues; reframe contracts preserve old facts and require setup refs.
```

Document the exact schemas from the design spec and state that absence preserves legacy mode.

- [ ] **Step 2: Run focused tests**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_epistemic_policy.py \
  tests/test_belief_state.py \
  tests/test_scenario_compile.py \
  tests/test_story_director.py \
  tests/test_director_apply.py \
  -q -p no:cacheprovider
```

Expected: PASS.

- [ ] **Step 3: Run repository-required metadata test**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_plugin_metadata.py -q -p no:cacheprovider
```

Expected: PASS.

- [ ] **Step 4: Run full suite**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/ -q -p no:cacheprovider
```

Expected: PASS with zero failures.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/skills/coc-scenario-import plugins/coc-keeper/references/director-protocol.md
git commit -m "docs: document epistemic scenario compilation"
```

## Self-review

- Spec coverage: optional sidecars, deterministic policy, belief persistence, post-rule commitment, compatibility, safety, and tests are each assigned to a task.
- Placeholder scan: no TBD/TODO steps; every task names exact files, APIs, test commands, and expected outcomes.
- Type consistency: `plan_epistemic_contract(ctx, clue_policy, scene_action)` and `apply_belief_turn(campaign_dir, plan, committed_clue_ids, investigator_id, ts)` are used consistently across tasks.
