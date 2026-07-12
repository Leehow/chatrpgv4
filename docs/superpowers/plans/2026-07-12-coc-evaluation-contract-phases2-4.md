# COC Evaluation Contract Phases 2–4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete `eval-spec-v1` beyond the Phase 1 dice gate: report schema v2, deterministic case registry and baseline differentials, structured AI-player and semantic-judge lanes, long-run/chapter-transition release evidence, and fail-closed nightly/release orchestration.

**Architecture:** Keep `coc_eval.py` as the only official entry point. Split responsibilities into focused sibling modules: report identity/rendering remains in `coc_eval_contract.py`; case discovery/execution lives in `coc_eval_cases.py`; aggregate comparison and confidence intervals live in `coc_eval_compare.py`; personas, blinded judge artifacts, and matrix planning live in `coc_eval_semantic.py` and `coc_eval_matrix.py`; long-run and chapter-transition evidence validation lives in `coc_eval_longrun.py`. Versioned JSON under `evaluation/spec/v1/` remains the source of truth. Missing credentials, human calibration, holdouts, or required artifacts produce `NOT_RUN` or `INELIGIBLE`, never a synthetic `PASS`.

**Tech Stack:** Python 3.11+ standard library, pytest, existing COC Keeper runtime/playtest modules, JSON/JSONL artifacts, GitHub Actions.

## Global Constraints

- `plugins/coc-keeper/` remains the only canonical plugin implementation.
- Official evaluation enters through `python3 plugins/coc-keeper/scripts/coc_eval.py`.
- Structured logs and versioned manifests are authoritative; Markdown is a deterministic view.
- Meaning-bearing classifications must come from recorded semantic evaluator results, not keyword matching.
- Deterministic failures cannot be offset by subjective scores.
- Missing required cases or evidence cannot become `PASS`.
- Keeper-only facts and rolls never enter the player-facing battle report.
- All writes to evidence/report artifacts are atomic.
- Every production behavior begins with a failing test.

---

### Task 1: Complete Battle and Evaluation Report Schema v2

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_eval_contract.py`
- Modify: `tests/test_eval_report_schema.py`
- Modify: `evaluation/spec/v1/benchmark-manifest.json`
- Modify: `.github/workflows/tests.yml`

**Interfaces:**
- Consumes: `playtest.json`, optional `run-manifest.json`, `evidence.json`, `artifacts/battle-report.md`, `artifacts/evaluation-report.md`, and `report-completeness.json` inputs.
- Produces: `inject_report_schema_v2(report_text, metadata, evidence) -> str`, `build_report_completeness(...) -> dict[str, Any]` with schema/identity fields, and `update_evaluation_contract_section(path, status, completeness, evidence) -> Path`.

- [ ] **Step 1: Keep the existing failing schema tests as RED evidence**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_eval_report_schema.py -q -p no:cacheprovider
```

Expected before implementation: failures for missing `report-schema-version: 2`, missing `run-identity-and-evidence`, and missing `evaluation-contract` output.

- [ ] **Step 2: Add stable schema and identity helpers**

Implement constants and helpers with these exact public effects:

```python
REPORT_SCHEMA_MARKER = "<!-- report-schema-version: 2 -->"
RUN_IDENTITY_ANCHOR = "run-identity-and-evidence"
EVALUATION_CONTRACT_ANCHOR = "evaluation-contract"


def render_run_identity_section(
    metadata: dict[str, Any],
    run_manifest: dict[str, Any],
    evidence: dict[str, Any],
    *,
    language: str,
) -> str:
    """Render one deterministic player-safe identity/evidence section."""


def inject_report_schema_v2(
    report_text: str,
    section: str,
) -> str:
    """Ensure one schema marker and one anchored identity section."""
```

The player-facing section may expose eligibility and model/runner identities already present in public provenance, but must not expose secret findings or Keeper-only evidence reasons beyond stable reason codes.

- [ ] **Step 3: Extend completeness verification**

`build_report_completeness` must add and gate:

```python
{
    "report_schema_marker_present": bool,
    "report_schema_marker_count": int,
    "run_identity_anchor_count": int,
}
```

`passed` requires exactly one schema marker and exactly one identity anchor in addition to all existing roll gates.

- [ ] **Step 4: Synchronize the engineering evaluation report**

Implement an idempotent anchored section containing:

```text
## Evaluation Contract <!-- report-anchor: evaluation-contract -->
- Contract status: PASS|FAIL|INELIGIBLE
- Report schema version: 2
- Required public rolls: N
- Rendered public rolls: N
- Keeper-only rolls: N
- Missing roll IDs: none|comma-separated ids
- Evidence eligibility: eligible|ineligible
```

`compile_report_contract` and `verify_report_contract` must update this section after computing the final status.

- [ ] **Step 5: Add the schema tests to official smoke/pr suites and CI**

Add `tests/test_eval_report_schema.py` to the focused evaluation job and to both deterministic suite command lists.

- [ ] **Step 6: Verify and commit**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_eval_contract.py \
  tests/test_eval_contract_hardening.py \
  tests/test_eval_report_schema.py \
  -q -p no:cacheprovider
```

Expected: all pass.

---

### Task 2: Add a Versioned Deterministic Case Registry

**Files:**
- Create: `evaluation/spec/v1/case-registry.json`
- Create: `evaluation/spec/v1/case-schema.json`
- Create: `plugins/coc-keeper/scripts/coc_eval_cases.py`
- Create: `tests/test_eval_cases.py`
- Modify: `evaluation/spec/v1/benchmark-manifest.json`
- Modify: `plugins/coc-keeper/scripts/coc_eval.py`

**Interfaces:**
- Produces: `load_case_registry(root) -> dict[str, Any]`, `resolve_suite_cases(manifest, registry, suite) -> list[dict[str, Any]]`, `run_case(case, *, root, output, env) -> dict[str, Any]`.
- Case result fields: `case_id`, `kind`, `status`, `gate`, `started_at`, `completed_at`, `duration_seconds`, `command`, `returncode`, `stdout_path`, `stderr_path`, `artifact_hashes`, `not_run_reasons`.

- [ ] **Step 1: Write failing registry tests**

Tests must prove:

```python
assert registry["schema_version"] == 1
assert all(case["case_id"] for case in registry["cases"])
assert len({case["case_id"] for case in registry["cases"]}) == len(registry["cases"])
assert resolve_suite_cases(manifest, registry, "pr")
```

Unknown case kinds, duplicate IDs, missing suites, missing gates, and commands outside the repository must fail validation.

- [ ] **Step 2: Define the registry schema**

Supported deterministic case kinds in v1:

```text
pytest_node
python_command
artifact_verification
```

Each case must declare `case_id`, `kind`, `suites`, `gate`, `required_capabilities`, `command`, and `evidence_requirements`.

- [ ] **Step 3: Seed the recent-defect corpus**

Registry entries must point to existing permanent regression tests for:

```text
flag-set-scene-gates
separator-normalized-location-tags
investigator-state-party-seeding
epistemic-sidecar-chapter-switch
stale-roll-signal-expiry
invalidated-checkpoint-resume
narrator-secret-audit-persistence
battle-report-roll-omission
```

No duplicated rule/runtime implementation is allowed; cases invoke existing test nodes.

- [ ] **Step 4: Execute cases through `coc_eval.py run`**

Replace suite-level opaque commands with case results. A suite status is:

```python
if any(hard_case["status"] in {"FAIL", "NOT_RUN"}):
    status = "FAIL"
elif any(case["status"] == "INELIGIBLE"):
    status = "INELIGIBLE"
else:
    status = "PASS"
```

Subjective optional cases may be `NOT_RUN` without blocking `pr`; suite definitions explicitly declare that policy.

- [ ] **Step 5: Verify and commit**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_eval_cases.py tests/test_eval_contract.py -q -p no:cacheprovider
python3 plugins/coc-keeper/scripts/coc_eval.py run --suite smoke --root . --output /tmp/coc-eval-smoke
```

Expected: registry tests pass and smoke returns `PASS` with per-case evidence.

---

### Task 3: Implement Baseline Differentials and Non-Inferiority Gates

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_eval_compare.py`
- Create: `tests/test_eval_compare.py`
- Modify: `plugins/coc-keeper/scripts/coc_eval_contract.py`
- Modify: `plugins/coc-keeper/scripts/coc_eval.py`
- Modify: `evaluation/spec/v1/thresholds.json`

**Interfaces:**
- Produces: `compare_evaluation_runs(baseline, candidate, thresholds) -> dict[str, Any]`, `paired_bootstrap_ci(deltas, *, seed, samples, confidence) -> tuple[float, float]`.
- Comparison statuses remain `PASS`, `FAIL`, `NON_COMPARABLE`.

- [ ] **Step 1: Write failing comparison tests**

Cover:

```python
assert compare(identity_mismatch)["status"] == "NON_COMPARABLE"
assert compare(hard_gate_regression)["status"] == "FAIL"
assert compare(subjective_delta_with_lower_ci_below_minus_point_25)["status"] == "FAIL"
assert compare(latency_degradation_below_threshold)["status"] == "PASS"
```

- [ ] **Step 2: Implement identity and evidence binding**

Comparison requires equal `eval_spec`, benchmark version, report schema, case/persona/seed sets, initial-state hashes, model identities, prompt hashes, and runner hashes for stochastic lanes.

Baseline manifests must bind hashes for run manifest, completeness receipt, case-results JSON, metric-results JSON, and reports.

- [ ] **Step 3: Implement dimension-by-dimension thresholds**

Use `thresholds.json` exactly:

```text
hard gates: zero tolerance
completion rate: no decrease > 0.05
stuck/fallback rates: no increase > 0.05
p95 latency: no degradation > max(20%, 1 second)
tokens/turn: no increase > 15% unless accepted trade-off recorded
subjective paired 1–5 dimensions: 95% CI lower bound > -0.25
```

Never compute a weighted total that can override a failed dimension.

- [ ] **Step 4: Write `artifacts/baseline-comparison.json` and Markdown differential**

Every regression contains stable `finding_id`, `case_id`, baseline/candidate values, evidence paths, and release-blocking status.

- [ ] **Step 5: Verify and commit**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_eval_compare.py tests/test_eval_contract_hardening.py -q -p no:cacheprovider
```

Expected: all pass.

---

### Task 4: Add Host Parity and Deterministic Snapshot/Replay Contracts

**Files:**
- Create: `evaluation/spec/v1/cases/snapshots.json`
- Create: `evaluation/spec/v1/cases/fixed-replays.json`
- Create: `plugins/coc-keeper/scripts/coc_eval_replay.py`
- Create: `tests/test_eval_replay.py`
- Modify: `evaluation/spec/v1/case-registry.json`

**Interfaces:**
- Produces: `normalize_report_for_host_parity(text) -> str`, `normalized_report_sha256(path) -> str`, `run_fixed_replay(case, *, root, output) -> dict[str, Any]`.

- [ ] **Step 1: Write failing host-parity and replay tests**

The same fixture with `host_id` values `codex`, `zcode`, `cursor`, `ci`, and `local` must produce the same normalized report hash. Volatile host/timestamp fields are normalized only in the parity hash, not removed from source evidence.

A fixed replay test must detect the first structural divergence in scene, rules request, state hash, reveal set, or pending-choice revision.

- [ ] **Step 2: Implement normalized hashing**

Only explicitly volatile provenance fields may be normalized. Roll IDs, source comments, decisions, state hashes, model IDs, and report content remain binding.

- [ ] **Step 3: Implement fixed replay evidence**

Replay output writes `artifacts/state-diffs.jsonl` with:

```json
{"turn": 3, "decision_id": "...", "baseline_state_sha256": "...", "candidate_state_sha256": "...", "classification": "allowed|beneficial|regression"}
```

Semantic classifications are supplied as structured expected values or evaluator artifacts; the replay engine does not infer them from prose.

- [ ] **Step 4: Verify and commit**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_eval_replay.py -q -p no:cacheprovider
```

Expected: all pass.

---

### Task 5: Add Structured Personas and Blinded Semantic Judge Artifacts

**Files:**
- Create: `evaluation/spec/v1/personas/personas.json`
- Create: `evaluation/spec/v1/rubrics/agency-and-fun.json`
- Create: `evaluation/spec/v1/rubrics/zh-prose.json`
- Create: `evaluation/spec/v1/rubrics/module-fidelity.json`
- Create: `plugins/coc-keeper/scripts/coc_eval_semantic.py`
- Create: `tests/test_eval_semantic.py`

**Interfaces:**
- Produces: `load_personas(root)`, `load_rubrics(root)`, `build_blind_pair_request(...)`, `validate_judge_result(request, result)`, `aggregate_judge_results(results)`.

- [ ] **Step 1: Write failing persona/rubric schema tests**

Require the twelve approved persona IDs and bounded numeric fields:

```text
risk_tolerance
rules_knowledge
metagame_tendency
social_preference
combat_preference
persistence_after_failure
verbosity
goal_orientation
```

Values are integers 0–4. The canonical JSON hash is recorded in every matrix run.

- [ ] **Step 2: Implement blind A/B request generation**

Requests contain randomized labels `A` and `B`, shared public context, turn IDs, and rubric version. They must not contain baseline/candidate labels, Keeper secrets, expected routes, or forbidden outcomes.

- [ ] **Step 3: Implement judge result validation**

A result requires evaluator identity, request SHA-256, winner `A|B|tie|uncertain`, dimension scores, evidence spans tied to turn IDs, labels from the versioned rubric, and reasons. Deterministic failures cannot be overridden.

- [ ] **Step 4: Implement aggregate metrics**

Compute pair preference, uncertain rate, label frequencies, scores, and per-thousand-Han-character Chinese prose findings from structured evaluator results. Do not scan prose for meaning-bearing fixed phrases.

- [ ] **Step 5: Verify and commit**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_eval_semantic.py -q -p no:cacheprovider
```

Expected: all pass.

---

### Task 6: Implement the AI-Player Persona Matrix Orchestrator

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_eval_matrix.py`
- Create: `tests/test_eval_matrix.py`
- Modify: `plugins/coc-keeper/scripts/coc_eval.py`
- Modify: `evaluation/spec/v1/benchmark-manifest.json`

**Interfaces:**
- Produces: `build_matrix_plan(...) -> dict[str, Any]`, `execute_matrix_plan(...) -> dict[str, Any]`, and CLI command `coc_eval.py matrix --suite nightly|release ...`.

- [ ] **Step 1: Write failing matrix planning tests**

A nightly plan expands required personas × configured seeds × cases deterministically and records player model, KP model, profile hash, prompt hashes, runner hashes, and initial-state hash.

- [ ] **Step 2: Implement planning and fail-closed prerequisites**

Missing runner path, model identity, credentials, scenario fixture, or initial-state fixture produces per-cell `NOT_RUN` with explicit reason. The orchestrator must not substitute a deterministic template and call it the requested model lane.

- [ ] **Step 3: Execute through existing canonical play paths**

Use `coc_live_match.py` or `coc_interactive_playtest.py` as configured by the case. The matrix layer only orchestrates and validates outputs; it does not duplicate runtime rules or story logic.

- [ ] **Step 4: Preserve view separation**

Player requests contain only public state, player-safe narration, character card, transcript tail, and player-owned pending choice. Player evaluation notes never enter KP input.

- [ ] **Step 5: Write matrix evidence**

Produce `matrix-plan.json`, `matrix-results.json`, per-cell run manifests, judge requests/results, and an aggregate evaluation report.

- [ ] **Step 6: Verify with deterministic fake adapters**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_eval_matrix.py tests/test_live_match.py -q -p no:cacheprovider
```

Expected: all pass without external credentials; credential-required cells explicitly test `NOT_RUN`.

---

### Task 7: Implement 25/50-Turn Continuity and Masks Chapter-Transition Lanes

**Files:**
- Create: `evaluation/spec/v1/cases/long-memory.json`
- Create: `evaluation/spec/v1/cases/chapter-transition.json`
- Create: `plugins/coc-keeper/scripts/coc_eval_longrun.py`
- Create: `tests/test_eval_longrun.py`
- Modify: `evaluation/spec/v1/case-registry.json`

**Interfaces:**
- Produces: `validate_continuity_run(run_dir, requirements)`, `validate_chapter_transition(run_dir, requirements)`, and structured metric/finding output.

- [ ] **Step 1: Write failing long-run contract tests**

Validate turn count, restart/resume evidence, monotonic accepted-turn sequence, inventory/injury/SAN/relationship/clue/unresolved-thread recall anchors, checkpoint integrity, and no secret leakage.

- [ ] **Step 2: Add deterministic 25/50-turn fixture lanes**

CI uses repository-owned fake runners and structured actions. These are regression evidence, not external-model gameplay evidence.

- [ ] **Step 3: Add evidence-grade external lane prerequisites**

Nightly/release can require attested external player/KP models. Missing attestation yields `INELIGIBLE` or `NOT_RUN` according to whether the run executed.

- [ ] **Step 4: Validate Masks Peru-to-America transition**

Require source module identity, chapter-switch event, pre/post active scenario IDs, preserved epistemic sidecars, investigator/campaign state continuity, and invalidated-segment evidence when code revisions bridge checkpoints.

- [ ] **Step 5: Verify and commit**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_eval_longrun.py tests/test_scenario_chapter_switch.py tests/test_playtest_driver.py -q -p no:cacheprovider
```

Expected: all pass.

---

### Task 8: Add Human Calibration and Hidden Holdout Workflow

**Files:**
- Create: `evaluation/spec/v1/calibration-schema.json`
- Create: `evaluation/spec/v1/holdout-manifest.json`
- Create: `plugins/coc-keeper/scripts/coc_eval_calibration.py`
- Create: `tests/test_eval_calibration.py`
- Modify: `plugins/coc-keeper/scripts/coc_eval.py`

**Interfaces:**
- Produces: `validate_calibration_reviews(...)`, `compute_agreement(...)`, `validate_holdout_bundle(...)`, and CLI commands `calibrate` and `holdouts`.

- [ ] **Step 1: Write failing calibration/holdout tests**

Require blinded item IDs, reviewer IDs, rubric versions, pair decisions, evidence spans, and no baseline/candidate labels in review payloads.

- [ ] **Step 2: Implement deterministic agreement metrics**

Compute exact agreement and Cohen’s kappa for two-reviewer categorical decisions; multi-reviewer data reports pairwise values and aggregate exact agreement. Empty or single-reviewer data is `NOT_RUN`.

- [ ] **Step 3: Implement holdout hash binding**

The repository manifest contains only stable IDs, suites, expected artifact kinds, and hashes. Release requires a separately supplied bundle whose files match those hashes. Missing bundle is `NOT_RUN`; mismatched hashes are `FAIL`.

- [ ] **Step 4: Verify and commit**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_eval_calibration.py -q -p no:cacheprovider
```

Expected: all pass.

---

### Task 9: Integrate Completion Audit, Skills, Documentation, and CI

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_completion_audit.py`
- Modify: `plugins/coc-keeper/scripts/coc_playtest_suite.py`
- Modify: `plugins/coc-keeper/skills/coc-eval/SKILL.md`
- Modify: `plugins/coc-keeper/skills/coc-playtest/SKILL.md`
- Modify: `.cursor/skills/coc-keeper/SKILL.md`
- Modify: `AGENTS.md`
- Modify: `.github/workflows/tests.yml`
- Modify: `README.md`
- Modify: `docs/status/CURRENT.md`
- Test: `tests/test_plugin_metadata.py`
- Create: `tests/test_eval_integration.py`

**Interfaces:**
- Completion audit consumes the benchmark/case registry and matrix results; it no longer treats three historical profiles as the entire release contract.

- [ ] **Step 1: Write failing integration tests**

Tests must prove:

```text
official requests route through coc_eval.py
nightly/release cannot PASS with required NOT_RUN rows
completion audit lists required case/persona/seed gaps
generated battle/evaluation reports are delivered without handwritten factual rewrites
```

- [ ] **Step 2: Update completion and suite aggregation**

Aggregate by benchmark case, persona, seed, language, and evidence eligibility. Historical runs remain visible but cannot satisfy current required cells.

- [ ] **Step 3: Update host skills and project rules**

Document exact CLI commands, status vocabulary, evidence delivery rules, and the distinction between deterministic fixtures and gameplay evidence.

- [ ] **Step 4: Extend CI**

Add focused jobs for deterministic cases, schema/report tests, host parity, semantic artifact validation, matrix planning, long-run fixture validation, and calibration schemas. External-model and human lanes remain scheduled/manual and report `NOT_RUN` without secrets/evidence.

- [ ] **Step 5: Verify and commit**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_eval_contract.py \
  tests/test_eval_contract_hardening.py \
  tests/test_eval_report_schema.py \
  tests/test_eval_cases.py \
  tests/test_eval_compare.py \
  tests/test_eval_replay.py \
  tests/test_eval_semantic.py \
  tests/test_eval_matrix.py \
  tests/test_eval_longrun.py \
  tests/test_eval_calibration.py \
  tests/test_eval_integration.py \
  tests/test_plugin_metadata.py \
  -q -p no:cacheprovider
```

Expected: all pass.

---

### Task 10: Full Verification, Runtime Smoke Triage, and PR Completion

**Files:**
- Modify only files proven necessary by failing full-suite evidence.
- Modify: PR title/body after verification.

**Interfaces:**
- Produces: green deterministic CI, canonical smoke/pr `PASS`, nightly/release honest `PASS|FAIL|INELIGIBLE|NOT_RUN`, and a review-ready PR.

- [ ] **Step 1: Run canonical suites**

```bash
python3 plugins/coc-keeper/scripts/coc_eval.py run --suite smoke --root . --output /tmp/eval-smoke
python3 plugins/coc-keeper/scripts/coc_eval.py run --suite pr --root . --output /tmp/eval-pr
```

Expected: `PASS`.

- [ ] **Step 2: Run the entire repository test suite**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/ -q -p no:cacheprovider
```

Expected: zero failures.

- [ ] **Step 3: Systematically investigate any product smoke failure**

Read the full traceback, reproduce with a dedicated test, identify whether it predates the branch, and fix only the root cause. Do not suppress or mark the job optional.

- [ ] **Step 4: Validate fail-closed nightly/release behavior**

Without external/human/holdout evidence, required cells must be `NOT_RUN`, and the suite must not claim release readiness. With fixture evidence, deterministic validation paths must pass.

- [ ] **Step 5: Review generated artifacts end to end**

Read manifests, case results, completeness receipts, battle reports, evaluation reports, comparison reports, and CI logs. Verify no secret leakage, handwritten factual substitution, duplicate roll sections, placeholders, or unresolved `TODO`/`TBD` text.

- [ ] **Step 6: Update the PR and mark ready only after verification**

Change the PR title/body to describe implemented behavior and exact verification. Keep the PR draft while any required deterministic check fails.
