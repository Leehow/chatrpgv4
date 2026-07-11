# Cognitive Storylets, Narration, and Metrics v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make storylet selection, narrator payloads, and playtest reports explicitly serve the resolved player-belief update rather than only generic scene action and tension.

**Architecture:** Extend the existing storylet scheduler with optional cognitive tags and needs. Add a focused minimum-privilege projection module consumed by `build_narration_envelope`. Add a pure metrics module and integrate its output into playtest reports without changing the existing rules/event pipeline.

**Tech Stack:** Python 3.11, JSON storylet library, pytest, existing narration and report modules.

## Global Constraints

- Generic storylets never create new module truth.
- Storylet cognitive tags are structured enums, not prose matching.
- Narrator projection contains IDs, player-safe labels, and approved constraints only.
- Metrics are diagnostic; none mechanically forces a reversal.
- Legacy storylets and reports remain valid.

---

### Task 1: Cognitive storylet schema and validation

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_storylets.py`
- Modify: `plugins/coc-keeper/references/rules-json/storylet-library.json`
- Modify: `plugins/coc-keeper/skills/coc-scenario-import/references/storylet-schema.md`
- Create: `tests/test_epistemic_storylets.py`

**Interfaces:**
- Storylet fields: `epistemic_functions`, `question_layers`, `requires_reveal_contract`.
- Allowed functions: `confirm`, `expand`, `complicate`, `reframe`, `payoff`.
- Allowed layers match the epistemic question-layer enum.

- [ ] **Step 1: Write failing tests**

```python
def test_library_accepts_valid_epistemic_tags(tmp_path): ...
def test_library_rejects_unknown_epistemic_function(tmp_path): ...
def test_library_rejects_unknown_question_layer(tmp_path): ...
def test_legacy_storylet_without_epistemic_tags_still_loads(tmp_path): ...
```

- [ ] **Step 2: Run RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_epistemic_storylets.py -q -p no:cacheprovider
```

- [ ] **Step 3: Implement validation and seed generic cards**

Tag existing generic cards only where their presentation genuinely serves a cognitive function. No card receives `reframe` unless it also sets `requires_reveal_contract=true`.

- [ ] **Step 4: Run GREEN**

Run Task 1 tests and existing storylet tests. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_storylets.py plugins/coc-keeper/references/rules-json/storylet-library.json plugins/coc-keeper/skills/coc-scenario-import/references/storylet-schema.md tests/test_epistemic_storylets.py
git commit -m "feat(storylets): add cognitive function tags"
```

---

### Task 2: Cognitive story-need scheduling

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_storylets.py`
- Modify: `tests/test_epistemic_storylets.py`

**Interfaces:**
- New needs: `belief_confirmation`, `belief_expansion`, `belief_complication`, `belief_reframe`, `question_payoff`.
- `infer_story_need` reads the resolved `epistemic_contract` before falling back to generic scene-action scheduling.

- [ ] **Step 1: Write failing tests**

```python
def test_confirm_contract_requests_belief_confirmation(): ...
def test_complicate_contract_requests_belief_complication(): ...
def test_hold_contract_falls_back_to_generic_need(): ...
def test_reframe_storylet_requires_ready_reveal_contract(): ...
def test_question_layer_filters_incompatible_storylet(): ...
def test_generic_storylet_remains_eligible_when_no_epistemic_contract(): ...
```

- [ ] **Step 2: Run RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_epistemic_storylets.py -q -p no:cacheprovider
```

- [ ] **Step 3: Implement scheduler integration**

Add cognitive need decks and candidate filtering. A multi-effect contract contributes all ready modes/layers, while the primary mode determines the need id. `HOLD` and `NONE` do not request cognitive storylets.

- [ ] **Step 4: Run GREEN**

Run Task 2 tests and `tests/test_storylets.py`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_storylets.py tests/test_epistemic_storylets.py
git commit -m "feat(storylets): schedule cognitive beats"
```

---

### Task 3: Narrator belief-update projection

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_epistemic_narration.py`
- Create: `tests/test_epistemic_narration.py`
- Modify: `plugins/coc-keeper/scripts/coc_narration_contract.py`
- Modify: `tests/test_narration_envelope.py`

**Interfaces:**
- `build_belief_update_projection(resolved_contract, epistemic_graph=None) -> dict | None`.
- Narration envelope key: `belief_update`.

- [ ] **Step 1: Write failing tests**

```python
def test_projection_preserves_only_ids_and_player_safe_questions(): ...
def test_projection_maps_confirm_to_newly_supported(): ...
def test_projection_maps_complicate_to_newly_uncertain(): ...
def test_projection_maps_reframe_preserve_and_new_question(): ...
def test_hold_projection_forbids_planned_update(): ...
def test_envelope_includes_projection(): ...
def test_projection_never_contains_truth_body_or_keeper_prose(): ...
```

- [ ] **Step 2: Run RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_epistemic_narration.py tests/test_narration_envelope.py -q -p no:cacheprovider
```

- [ ] **Step 3: Implement minimum-privilege projection**

Use question IDs and optional `player_facing_question`; omit `truth_ref` and all source/secret prose. Preserve `must_not` and add HOLD-specific prohibitions when evidence did not commit.

- [ ] **Step 4: Run GREEN**

Run Task 3 tests and narration-contract tests. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_epistemic_narration.py plugins/coc-keeper/scripts/coc_narration_contract.py tests/test_epistemic_narration.py tests/test_narration_envelope.py
git commit -m "feat(narration): project resolved belief updates"
```

---

### Task 4: Epistemic metrics engine

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_epistemic_metrics.py`
- Create: `tests/test_epistemic_metrics.py`

**Interfaces:**
- `compute_epistemic_metrics(belief_events, belief_state=None, compile_confidence=None, parse_manifest=None) -> dict`.
- Metrics: `belief_gain`, `curiosity_load`, `explanation_compression`, `reframe_fairness`, `confirmation_saturation`, `unexplained_surprise`, `parse_risk_exposure`, `epistemic_health`.

- [ ] **Step 1: Write failing tests**

```python
def test_belief_gain_excludes_hold(): ...
def test_curiosity_load_counts_active_not_answered(): ...
def test_explanation_compression_counts_distinct_setup_and_targets(): ...
def test_reframe_fairness_is_one_only_when_all_setup_available(): ...
def test_confirmation_saturation_preserves_repeated_confirmations(): ...
def test_unexplained_surprise_flags_missing_contract_or_preserved_truth(): ...
def test_parse_risk_exposure_uses_critical_confidence(): ...
def test_health_summary_is_deterministic(): ...
```

- [ ] **Step 2: Run RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_epistemic_metrics.py -q -p no:cacheprovider
```

- [ ] **Step 3: Implement pure metrics**

Use only structured event fields. Return raw counts, normalized scores where defined, and findings with stable codes. Never infer whether prose was surprising.

- [ ] **Step 4: Run GREEN**

Run Task 4 tests. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_epistemic_metrics.py tests/test_epistemic_metrics.py
git commit -m "feat(playtest): compute epistemic metrics"
```

---

### Task 5: Playtest report integration

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_playtest_report.py`
- Create: `tests/test_epistemic_playtest_report.py`

**Interfaces:**
- Report data key: `epistemic_metrics`.
- Markdown section: `## Epistemic Experience` or localized equivalent.

- [ ] **Step 1: Write failing tests**

```python
def test_report_reads_belief_events_from_campaign_logs(tmp_path): ...
def test_report_includes_all_seven_metric_names(tmp_path): ...
def test_report_handles_legacy_run_without_belief_events(tmp_path): ...
def test_report_flags_unfair_reframe_and_parse_risk(tmp_path): ...
```

- [ ] **Step 2: Run RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_epistemic_playtest_report.py -q -p no:cacheprovider
```

- [ ] **Step 3: Integrate metrics**

Read `belief-events.jsonl`, `belief-state.json`, `compile-confidence.json`, and `parse-manifest.json` when present. Keep the existing report shape and add one isolated section.

- [ ] **Step 4: Run GREEN**

Run Task 5 tests and existing playtest-report tests. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_playtest_report.py tests/test_epistemic_playtest_report.py
git commit -m "feat(report): add epistemic experience section"
```

---

### Task 6: End-to-end structural fixtures

**Files:**
- Create: `tests/fixtures/epistemic/branching-investigation.json`
- Create: `tests/fixtures/epistemic/large-chapter-page-offset.json`
- Create: `tests/fixtures/epistemic/multi-faction.json`
- Create: `tests/test_epistemic_blueprint_e2e.py`

- [ ] **Step 1: Write failing end-to-end tests**

```python
def test_branching_fixture_builds_confirm_then_complicate_then_reframe(): ...
def test_large_chapter_fixture_resolves_printed_to_pdf_page_and_gates_confidence(): ...
def test_multi_faction_fixture_updates_only_targeted_hypothesis(): ...
def test_failed_obscured_clue_produces_hold_and_no_belief_gain(): ...
def test_storylet_and_narration_follow_resolved_primary_effect(): ...
```

- [ ] **Step 2: Run RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_epistemic_blueprint_e2e.py -q -p no:cacheprovider
```

- [ ] **Step 3: Add minimal non-copyrighted fixtures**

Fixtures contain invented IDs and summaries only. They exercise the complete source -> compiler -> director -> resolve -> belief -> storylet -> narration -> metrics chain.

- [ ] **Step 4: Run GREEN and full suite**

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_epistemic_blueprint_e2e.py -q -p no:cacheprovider
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/test_plugin_metadata.py -q -p no:cacheprovider
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/ -q -p no:cacheprovider
```

Expected: zero failures.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/epistemic tests/test_epistemic_blueprint_e2e.py
git commit -m "test(epistemic): cover full blueprint end to end"
```

## Self-review

- Storylet eligibility is structured and truth-preserving.
- Narrator payload remains minimum privilege.
- Metrics measure event structure, not prose semantics.
- Three independent scenario structures receive end-to-end coverage.