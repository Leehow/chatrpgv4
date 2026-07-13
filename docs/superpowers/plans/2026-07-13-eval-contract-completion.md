# Eval Contract v1 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the canonical evaluation CLI execute real GLM-Keeper/Luna-player/Sol-judge nightly lanes, continuity and chapter-transition validation, and fail-closed release evidence while restoring a green full repository suite.

**Architecture:** Keep `coc_eval.py` as the only official entry point and extend the existing matrix, semantic, long-run, calibration, report, and completion-audit contracts. Explicit runtime model selection is injected into the existing Pi adapters; a focused live-cell runner materializes neutral benchmark workspaces and invokes the canonical live match; a focused suite orchestrator aggregates deterministic cases, real gameplay, judge, continuity, and externally supplied release evidence.

**Tech Stack:** Python 3.11, pytest, JSON/JSONL evidence, Node.js ESM, `@earendil-works/pi-coding-agent`, OpenAI-compatible Chat Completions, SHA-256 content binding.

## Global Constraints

- Canonical plugin behavior remains under `plugins/coc-keeper/`; do not create another plugin or evaluation skill tree.
- Official evaluation always enters through `python3 plugins/coc-keeper/scripts/coc_eval.py`.
- Keeper model identity is exactly `zhipu-coding/glm-5.2`.
- Player model identity is exactly `coding-relay/gpt-5.6-luna`.
- Judge model identity is exactly `coding-relay/gpt-5.6-sol`.
- Model roles use independent sessions and never silently fall back to a different model.
- API keys, auth files, private endpoints, module prose, and Keeper secrets must not enter the repository or player/judge evidence.
- The Semantic Matcher Constitution forbids new keyword/regex classification of free prose.
- Status vocabulary is exactly `PASS`, `FAIL`, `INELIGIBLE`, `NOT_RUN`, and `NON_COMPARABLE`; missing evidence never becomes `PASS`.
- Structured evidence is authoritative; fixture self-tests do not become gameplay battle reports.
- Genuine human calibration remains external; AI output must never be labeled human review.
- Use Python 3.11 via `export PATH="/tmp/coc-eval-venv/bin:$PATH"` for every test and official CLI command.
- Preserve the user-owned untracked `.tools/` and `docs/superpowers/plans/2026-07-13-eval-contract-grok-execution.md` paths.
- Before completion, run the plugin metadata minimum gate required by `AGENTS.md`.

## File Structure

- Modify `runtime/adapters/player/run_player_turn.mjs`: resolve and pin the requested player model before creating the Pi session.
- Modify `runtime/adapters/narrator/run_narration.mjs`: resolve and pin the requested Keeper model before creating the Pi session.
- Create `plugins/coc-keeper/scripts/coc_eval_live_cell.py`: materialize a neutral benchmark workspace, execute canonical live matches, and normalize cell evidence.
- Create `plugins/coc-keeper/scripts/coc_eval_judge.py`: invoke Sol over Chat Completions and validate its structured blind result.
- Create `plugins/coc-keeper/scripts/coc_eval_pipeline.py`: aggregate registered cases, matrix, continuity, chapter, calibration, holdout, comparison, and suite status.
- Modify `plugins/coc-keeper/scripts/coc_eval_matrix.py`: derive prompt hashes, execute real cells, compare against prior cell evidence, and call the judge.
- Modify `plugins/coc-keeper/scripts/coc_eval_longrun.py`: produce and validate external continuity evidence from segmented canonical matches.
- Modify `plugins/coc-keeper/scripts/coc_eval.py`: expose pipeline inputs on the official `run` command.
- Modify `runtime/engine/session.py`: fix the confirmed narrator retry/worker-pool regression without weakening coverage validation.
- Modify `evaluation/spec/v1/benchmark-manifest.json`: replace model/hash placeholders and declare only executable capabilities.
- Create `evaluation/spec/v1/fixtures/matrix/nightly-scenario.json`: neutral public benchmark scenario.
- Create `evaluation/spec/v1/fixtures/matrix/nightly-initial-state.json`: neutral canonical initial state and investigator card.
- Create `evaluation/spec/v1/fixtures/review/review-instructions.md`: human calibration instructions.
- Create `evaluation/spec/v1/fixtures/review/review-template.json`: schema-valid empty external-review submission template.
- Modify `.github/workflows/tests.yml`, `README.md`, `docs/status/CURRENT.md`, and `plugins/coc-keeper/skills/coc-playtest/SKILL.md`: document and run the finished contract.
- Modify focused tests under `tests/test_runtime_player_adapter_contract.py`, `tests/test_narrator_adapter.py`, `tests/test_eval_matrix.py`, `tests/test_eval_semantic.py`, `tests/test_eval_longrun.py`, `tests/test_eval_integration.py`, `tests/test_eval_calibration.py`, and `tests/test_runtime_sdk_debug.py`.

---

### Task 1: Pin Independent Runtime Model Roles

**Files:**
- Modify: `runtime/adapters/player/run_player_turn.mjs`
- Modify: `runtime/adapters/narrator/run_narration.mjs`
- Test: `tests/test_runtime_player_adapter_contract.py`
- Test: `tests/test_narrator_adapter.py`

**Interfaces:**
- Consumes: Pi `AuthStorage.create()`, `ModelRegistry.create()`, and `createAgentSession({model, modelRegistry, ...})`.
- Produces: `resolveRequestedModel({agentDir, provider, modelId}) -> {model, modelRegistry}` in each runner and exact `model_identity` evidence.

- [ ] **Step 1: Add failing source-contract and subprocess tests**

```python
def test_player_runner_pins_luna_without_mutating_global_default():
    source = (PLAYER_DIR / "run_player_turn.mjs").read_text(encoding="utf-8")
    assert 'COC_PLAYER_MODEL_PROVIDER' in source
    assert 'COC_PLAYER_MODEL_ID' in source
    assert 'createAgentSession({' in source and 'modelRegistry' in source
    assert 'setModel(' not in source


def test_narrator_runner_pins_glm_without_mutating_global_default():
    source = (NARRATOR_DIR / "run_narration.mjs").read_text(encoding="utf-8")
    assert 'COC_NARRATOR_MODEL_PROVIDER' in source
    assert 'COC_NARRATOR_MODEL_ID' in source
    assert 'createAgentSession({' in source and 'modelRegistry' in source
    assert 'setModel(' not in source
```

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
export PATH="/tmp/coc-eval-venv/bin:$PATH"
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_runtime_player_adapter_contract.py \
  tests/test_narrator_adapter.py -q -p no:cacheprovider
```

Expected: FAIL because explicit role environment variables and registry binding are absent.

- [ ] **Step 3: Resolve an exact configured model without changing settings**

Add the equivalent helper to both ESM runners:

```javascript
function resolveRequestedModel({ agentDir, provider, modelId }) {
  const authStorage = AuthStorage.create(path.join(agentDir, "auth.json"));
  const modelRegistry = ModelRegistry.create(
    authStorage,
    path.join(agentDir, "models.json"),
  );
  const model = modelRegistry.find(provider, modelId);
  if (!model || !modelRegistry.hasConfiguredAuth(model)) {
    throw new Error(`requested model unavailable: ${provider}/${modelId}`);
  }
  return { model, modelRegistry };
}
```

Player defaults:

```javascript
const provider = process.env.COC_PLAYER_MODEL_PROVIDER || "coding-relay";
const modelId = process.env.COC_PLAYER_MODEL_ID || "gpt-5.6-luna";
```

Narrator defaults:

```javascript
const provider = process.env.COC_NARRATOR_MODEL_PROVIDER || "zhipu-coding";
const modelId = process.env.COC_NARRATOR_MODEL_ID || "glm-5.2";
```

Pass `model` and `modelRegistry` directly into `createAgentSession`; do not call `session.setModel()`.

- [ ] **Step 4: Verify exact identity and fail-closed behavior**

Run the focused pytest command from Step 2 plus one minimal request through each runner. Expected: configured roles return their exact identity; an unknown provider/model exits nonzero and does not call another model.

- [ ] **Step 5: Commit**

```bash
git add runtime/adapters/player/run_player_turn.mjs \
  runtime/adapters/narrator/run_narration.mjs \
  tests/test_runtime_player_adapter_contract.py tests/test_narrator_adapter.py
git commit -m "feat(runtime): pin evaluation model roles"
```

### Task 2: Materialize and Execute Real Matrix Cells

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_eval_live_cell.py`
- Create: `evaluation/spec/v1/fixtures/matrix/nightly-scenario.json`
- Create: `evaluation/spec/v1/fixtures/matrix/nightly-initial-state.json`
- Modify: `plugins/coc-keeper/scripts/coc_eval_matrix.py`
- Modify: `evaluation/spec/v1/benchmark-manifest.json`
- Test: `tests/test_eval_matrix.py`

**Interfaces:**
- Consumes: `coc_live_match.run_live_match(...)`, matrix cell input JSON, canonical player/narrator runner paths.
- Produces: `run_live_cell(cell_input: dict[str, Any], cell_dir: Path, *, env: Mapping[str, str]) -> dict[str, Any]` and evidence-grade `run-manifest.json`, `transcript.jsonl`, `player-view.jsonl`, `keeper-view.jsonl`, `runner-invocations.jsonl`, and reports. The script entry point reads the cell-input path passed by `coc_eval_matrix.py` before calling this function.

- [ ] **Step 1: Add failing tests for real-runner dispatch and neutral fixtures**

```python
def test_checked_in_matrix_case_is_ready_from_pi_credentials_not_env_keys():
    matrix = _load()
    plan = matrix.build_matrix_plan(
        root=REPO,
        suite="nightly",
        model_preflight=lambda provider, model: True,
        credential_env={},
    )
    assert plan["ready_count"] == plan["cell_count"]
    cell = plan["cells"][0]
    assert cell["player_model"] == {"provider": "coding-relay", "id": "gpt-5.6-luna"}
    assert cell["kp_model"] == {"provider": "zhipu-coding", "id": "glm-5.2"}
    assert set(cell["prompt_hashes"]) == {"player", "kp"}
    assert all(len(value) == 64 for value in cell["prompt_hashes"].values())


def test_live_cell_runner_writes_evidence_from_canonical_match(tmp_path, monkeypatch):
    runner = _load_live_cell()
    def fake_canonical_match(*args, **kwargs):
        run_dir = Path(kwargs["run_dir"])
        run_dir.mkdir(parents=True)
        (run_dir / "battle-report.md").write_text("# fixture\n", encoding="utf-8")
        return {
            "run_dir": str(run_dir),
            "turns": [{"turn_number": 1, "narration": "门轴轻响。"}],
            "player_turns": [{"player_text": "我检查门锁。"}],
            "evidence": {"eligible": True},
            "metadata": {"runner_kind": "external_model_bridge"},
        }
    monkeypatch.setattr(runner.live_match, "run_live_match", fake_canonical_match)
    neutral_scenario = {"scene_id": "neutral-entry", "dramatic_question": "What changed?"}
    neutral_initial_state = {
        "campaign_id": "eval-neutral",
        "investigator_id": "inv1",
        "character": {"schema_version": 1, "id": "inv1"},
        "public_state": {"active_scene_id": "neutral-entry"},
    }
    cell_input = {
        "cell_id": "careful__seed-3__nightly",
        "seed": 3,
        "max_turns": 1,
        "scenario": neutral_scenario,
        "initial_state": neutral_initial_state,
        "player_model": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
        "kp_model": {"provider": "zhipu-coding", "id": "glm-5.2"},
    }
    result = runner.run_live_cell(cell_input, tmp_path / "cell", env={})
    assert result["status"] == "PASS"
    assert result["evidence_eligible"] is True
    assert (tmp_path / "cell" / "transcript.jsonl").is_file()
```

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
export PATH="/tmp/coc-eval-venv/bin:$PATH"
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_eval_matrix.py -q -p no:cacheprovider
```

Expected: FAIL because the live-cell module, checked-in fixtures, model preflight, and derived prompt hashes do not exist.

- [ ] **Step 3: Implement neutral workspace materialization**

Create a strict fixture loader and materializer:

```python
def materialize_workspace(
    scenario: dict[str, Any], initial: dict[str, Any], destination: Path
) -> tuple[Path, str, str]:
    campaign_id = str(initial["campaign_id"])
    investigator_id = str(initial["investigator_id"])
    campaign = destination / ".coc" / "campaigns" / campaign_id
    investigator = destination / ".coc" / "investigators" / investigator_id
    # Write only allowlisted canonical JSON artifacts with atomic helpers.
    write_canonical_campaign(campaign, scenario, initial)
    write_canonical_character(investigator, initial["character"])
    return destination, campaign_id, investigator_id
```

The checked-in fixture must contain only neutral IDs and original benchmark prose, with all canonical scenario/state fields needed by the existing runtime.

- [ ] **Step 4: Execute the canonical live match and normalize evidence**

```python
result = live_match.run_live_match(
    workspace,
    campaign_id,
    investigator_id,
    player_runner=root / "runtime/adapters/player/run_player_turn.mjs",
    narrator_runner=root / "runtime/adapters/narrator/run_narration.mjs",
    max_turns=int(cell_input["max_turns"]),
    rng_seed=int(cell_input["seed"]),
    live=True,
    run_dir=cell_dir / "playtest",
    evidence_provenance={"eval_spec": "eval-spec-v1", "cell_id": cell_id},
)
```

Normalize only structured runtime artifacts. Mark the cell `INELIGIBLE` when observed model identities, secret audit, or runner attestation do not match the declared identities.

- [ ] **Step 5: Replace placeholder manifest fields**

Use:

```json
{
  "player_model": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
  "kp_model": {"provider": "zhipu-coding", "id": "glm-5.2"},
  "judge_model": {"provider": "coding-relay", "id": "gpt-5.6-sol"},
  "prompt_sources": {
    "player": "runtime/adapters/player/run_player_turn.mjs",
    "kp": "runtime/adapters/narrator/run_narration.mjs"
  },
  "max_turns": 3
}
```

Derive hashes from `prompt_sources`; reject a missing source instead of storing a placeholder hash. Nightly uses a bounded proof matrix; release retains the complete persona/seed matrix.

- [ ] **Step 6: Run focused matrix and live-match tests**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_eval_matrix.py tests/test_live_match.py -q -p no:cacheprovider
```

Expected: PASS with fake runner tests still supported and checked-in real cells reported `READY` when model preflight succeeds.

- [ ] **Step 7: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_eval_live_cell.py \
  plugins/coc-keeper/scripts/coc_eval_matrix.py \
  evaluation/spec/v1/fixtures/matrix/nightly-scenario.json \
  evaluation/spec/v1/fixtures/matrix/nightly-initial-state.json \
  evaluation/spec/v1/benchmark-manifest.json tests/test_eval_matrix.py
git commit -m "feat(eval): execute attested live matrix cells"
```

### Task 3: Execute the Blinded Sol Judge

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_eval_judge.py`
- Modify: `plugins/coc-keeper/scripts/coc_eval_matrix.py`
- Modify: `plugins/coc-keeper/scripts/coc_eval_semantic.py`
- Test: `tests/test_eval_semantic.py`
- Test: `tests/test_eval_matrix.py`

**Interfaces:**
- Consumes: `build_blind_pair_request(...)`, rubric JSON, prior baseline cell public turns, candidate cell public turns.
- Produces: `invoke_sol_judge(request, rubric, *, base_url, api_key, timeout_s) -> dict[str, Any]` and validated `judge-result.json`.

- [ ] **Step 1: Add failing judge transport and privacy tests**

```python
def test_sol_judge_uses_chat_completions_and_exact_identity(monkeypatch):
    rubric = semantic.load_rubrics(REPO)["agency-and-fun"]
    request, _ = semantic.build_blind_pair_request(
        pair_id="pair-1", rubric_id="agency-and-fun",
        rubric_version=rubric["rubric_version"],
        public_context={"case_id": "neutral"}, turn_ids=["t1"],
        baseline_turns=[{"turn_id": "t1", "text": "A"}],
        candidate_turns=[{"turn_id": "t1", "text": "B"}], seed=3,
    )
    dimension = rubric["dimensions"][0]["dimension_id"]
    valid_result = {
        "request_sha256": request["request_sha256"], "winner": "tie",
        "dimension_scores": {dimension: 3}, "findings": [],
        "reasons": ["The cited public turn supports a tie."],
    }
    response = {
        "choices": [{"message": {"content": json.dumps(valid_result)}}]
    }
    calls = []
    monkeypatch.setattr(judge, "_post_json", lambda url, headers, payload, timeout: calls.append((url, payload)) or response)
    result = judge.invoke_sol_judge(request, rubric, base_url="http://127.0.0.1:18888/v1", api_key="local", timeout_s=3)
    assert calls[0][0].endswith("/chat/completions")
    assert calls[0][1]["model"] == "gpt-5.6-sol"
    assert result["evaluator"] == {"provider": "coding-relay", "id": "gpt-5.6-sol"}


def test_judge_payload_contains_no_private_mapping_or_keeper_fields():
    rubric = semantic.load_rubrics(REPO)["agency-and-fun"]
    request, _ = semantic.build_blind_pair_request(
        pair_id="pair-private", rubric_id="agency-and-fun",
        rubric_version=rubric["rubric_version"],
        public_context={"case_id": "neutral", "keeper_secret": "drop-me"},
        turn_ids=["t1"],
        baseline_turns=[{"turn_id": "t1", "text": "A"}],
        candidate_turns=[{"turn_id": "t1", "text": "B"}], seed=4,
    )
    payload = judge.build_chat_payload(request, rubric)
    encoded = json.dumps(payload, ensure_ascii=False).lower()
    for forbidden in ("baseline", "candidate", "keeper_secret", "forbidden_outcome"):
        assert forbidden not in encoded
```

- [ ] **Step 2: Run focused tests and confirm RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_eval_semantic.py tests/test_eval_matrix.py -q -p no:cacheprovider
```

Expected: FAIL because the Sol transport and real judge result path are absent.

- [ ] **Step 3: Implement strict Chat Completions transport**

```python
def invoke_sol_judge(request, rubric, *, base_url, api_key, timeout_s):
    payload = build_chat_payload(request, rubric)
    raw = _post_json(
        f"{base_url.rstrip('/')}/chat/completions",
        {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        payload,
        timeout_s,
    )
    result = parse_single_json_result(raw)
    result["evaluator"] = {"provider": "coding-relay", "id": "gpt-5.6-sol"}
    semantic.validate_judge_result(request, result, rubric=rubric)
    return result
```

The API key source order is `CODING_RELAY_API_KEY`, `OPENAI_API_KEY`, then a harmless local placeholder. Never log authorization headers or environment values.

- [ ] **Step 4: Replace fixture A/B text with real baseline/candidate public turns**

Add `baseline_dir` to `execute_matrix_plan`. Resolve matching cells by stable `cell_id`, load only public transcript fields, create the blinded request, invoke Sol, validate it, and keep the private label mapping outside the request. Missing baseline evidence yields `NOT_RUN`; mismatched identities yield `NON_COMPARABLE`.

- [ ] **Step 5: Run judge and matrix tests**

Expected: PASS; hard findings continue to override favorable judge output.

- [ ] **Step 6: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_eval_judge.py \
  plugins/coc-keeper/scripts/coc_eval_matrix.py \
  plugins/coc-keeper/scripts/coc_eval_semantic.py \
  tests/test_eval_semantic.py tests/test_eval_matrix.py
git commit -m "feat(eval): run blinded sol semantic judge"
```

### Task 4: Produce Real 25/50-Turn Continuity Evidence

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_eval_live_cell.py`
- Modify: `plugins/coc-keeper/scripts/coc_eval_longrun.py`
- Test: `tests/test_eval_longrun.py`
- Test: `tests/test_eval_matrix.py`

**Interfaces:**
- Consumes: long-memory lane definitions, live-cell workspace materialization, canonical live match.
- Produces: `run_continuity_lane(...) -> dict[str, Any]` and a validator-compatible `continuity-evidence.json`.

- [ ] **Step 1: Add failing segmented-run evidence tests**

```python
def test_continuity_runner_restarts_at_required_turn_and_preserves_hash(tmp_path, monkeypatch):
    def fake_segment(*, start_turn, turn_count, workspace, output, model_roles):
        return {
            "accepted_turns": list(range(start_turn, start_turn + turn_count)),
            "snapshot_sha256": "a" * 64,
            "attestation": {"player_model": model_roles["player"], "kp_model": model_roles["kp"]},
        }
    monkeypatch.setattr(longrun, "_run_segment", fake_segment)
    lane = json.loads((REPO / "evaluation/spec/v1/cases/long-memory.json").read_text())["lanes"][0]
    model_roles = {
        "player": {"provider": "coding-relay", "id": "gpt-5.6-luna"},
        "kp": {"provider": "zhipu-coding", "id": "glm-5.2"},
    }
    evidence = longrun.run_continuity_lane(
        lane=lane,
        workspace=tmp_path / "workspace",
        output=tmp_path / "lane",
        model_roles=model_roles,
    )
    assert evidence["accepted_turns"] == list(range(1, 26))
    assert evidence["restart"]["at_turn"] == 13
    assert evidence["restart"]["pre_checkpoint_sha256"] == evidence["restart"]["post_checkpoint_sha256"]
    assert evidence["attestation"]["attested"] is True
```

- [ ] **Step 2: Run long-run tests and confirm RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_eval_longrun.py -q -p no:cacheprovider
```

Expected: FAIL because continuity evidence can only be validated, not produced.

- [ ] **Step 3: Implement two-segment execution with a stable logical session**

Run turns `1..restart_at_turn`, hash the canonical mutable campaign snapshot, close all model workers, reopen from the same workspace, verify the snapshot hash before the next turn, and run the remaining turns. Record a stable evaluation `session_id` across both process segments while preserving each runner invocation ID separately.

```python
restart = {
    "at_turn": restart_at,
    "pre_checkpoint_sha256": snapshot_hash,
    "post_checkpoint_sha256": resumed_hash,
    "session_id_before": logical_session_id,
    "session_id_after": logical_session_id,
    "resumed": snapshot_hash == resumed_hash,
}
```

Recall anchors come from structured state IDs written before restart and read back afterward; do not infer them from narration text.

- [ ] **Step 4: Validate generated evidence immediately**

Call `validate_continuity_run(lane_dir, lane["requirements"])` after atomic evidence write. A generated lane is `PASS` only when that validator returns `PASS` and observed model identities match GLM/Luna.

- [ ] **Step 5: Run long-run, matrix, and live-match tests**

Expected: PASS for complete fake segments; contradiction tests remain `FAIL`; missing evidence remains `NOT_RUN`.

- [ ] **Step 6: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_eval_live_cell.py \
  plugins/coc-keeper/scripts/coc_eval_longrun.py \
  tests/test_eval_longrun.py tests/test_eval_matrix.py
git commit -m "feat(eval): execute continuity restart lanes"
```

### Task 5: Aggregate Executable Nightly Through the Canonical CLI

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_eval_pipeline.py`
- Modify: `plugins/coc-keeper/scripts/coc_eval.py`
- Modify: `plugins/coc-keeper/scripts/coc_eval_cases.py`
- Modify: `plugins/coc-keeper/scripts/coc_completion_audit.py`
- Modify: `plugins/coc-keeper/scripts/coc_playtest_suite.py`
- Modify: `evaluation/spec/v1/benchmark-manifest.json`
- Test: `tests/test_eval_integration.py`
- Test: `tests/test_eval_cases.py`

**Interfaces:**
- Consumes: registered case results, matrix output, continuity results, optional baseline directory.
- Produces: `run_extended_suite(...) -> dict[str, Any]`, canonical aggregate status, and content-hashed lane artifacts under one run directory.

- [ ] **Step 1: Add failing official-nightly aggregation tests**

```python
def test_nightly_runs_registered_cases_matrix_continuity_and_judge(tmp_path, monkeypatch):
    monkeypatch.setattr(
        pipeline, "run_matrix",
        lambda **kwargs: {"status": "PASS", "cells": [{"status": "PASS"}]},
    )
    monkeypatch.setattr(
        pipeline, "run_continuity",
        lambda lane_id, **kwargs: {"status": "PASS", "lane_id": lane_id},
    )
    result = cli.run_suite(
        root=REPO,
        suite="nightly",
        output=tmp_path / "nightly",
        host_id="local",
        baseline=tmp_path / "baseline",
    )
    assert result["status"] == "PASS"
    assert result["lanes"]["matrix"]["status"] == "PASS"
    assert result["lanes"]["continuity-25"]["status"] == "PASS"
    assert result["lanes"]["continuity-50"]["status"] == "PASS"
```

- [ ] **Step 2: Run integration tests and confirm RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_eval_integration.py tests/test_eval_cases.py -q -p no:cacheprovider
```

Expected: FAIL because `run_suite` currently returns after registry execution and nightly capabilities remain undeclared.

- [ ] **Step 3: Implement lane-aware suite aggregation**

```python
STATUS_RANK = {"FAIL": 5, "INELIGIBLE": 4, "NON_COMPARABLE": 3, "NOT_RUN": 2, "PASS": 1}

def aggregate_lane_status(lanes):
    return max((lane["status"] for lane in lanes.values()), key=STATUS_RANK.__getitem__)
```

Registered deterministic cases run first. Nightly then runs matrix and both continuity lanes. A deterministic failure stops model-backed work; other nonterminal statuses are retained verbatim in the aggregate evidence.

- [ ] **Step 4: Extend the official CLI without adding a second entry point**

Add:

```text
--baseline <nightly-run-dir>
--matrix-limit <positive-int>   # diagnostic only; prevents official PASS
--timeout <seconds>
```

`run --suite nightly` without a baseline may capture candidate evidence but returns `NOT_RUN` with `baseline_evidence_missing`. Re-running with that captured directory as `--baseline` performs real blinded judging and comparison.

- [ ] **Step 5: Declare capabilities only after routes are executable**

Add `ai_player_matrix`, `semantic_judge`, and `long_memory` to `implemented_capabilities`; update completion audit to consume evidence-grade matrix and continuity results rather than mere observed IDs.

- [ ] **Step 6: Run official deterministic suites**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_eval_*.py -q -p no:cacheprovider
PYTHONDONTWRITEBYTECODE=1 python3 plugins/coc-keeper/scripts/coc_eval.py run --suite smoke --root . --output /tmp/eval-smoke
PYTHONDONTWRITEBYTECODE=1 python3 plugins/coc-keeper/scripts/coc_eval.py run --suite pr --root . --output /tmp/eval-pr
```

Expected: all eval tests pass; smoke and PR return `PASS`; nightly fake integration returns `PASS` only with complete baseline evidence.

- [ ] **Step 7: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_eval_pipeline.py \
  plugins/coc-keeper/scripts/coc_eval.py \
  plugins/coc-keeper/scripts/coc_eval_cases.py \
  plugins/coc-keeper/scripts/coc_completion_audit.py \
  plugins/coc-keeper/scripts/coc_playtest_suite.py \
  evaluation/spec/v1/benchmark-manifest.json \
  tests/test_eval_integration.py tests/test_eval_cases.py
git commit -m "feat(eval): run executable nightly pipeline"
```

### Task 6: Complete Release Chapter, Holdout, and Human Review Gates

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_eval_pipeline.py`
- Modify: `plugins/coc-keeper/scripts/coc_eval_calibration.py`
- Create: `evaluation/spec/v1/fixtures/review/review-instructions.md`
- Create: `evaluation/spec/v1/fixtures/review/review-template.json`
- Modify: `evaluation/spec/v1/benchmark-manifest.json`
- Test: `tests/test_eval_calibration.py`
- Test: `tests/test_eval_integration.py`
- Test: `tests/test_eval_longrun.py`

**Interfaces:**
- Consumes: `--chapter-run`, `--holdout-bundle`, `--calibration-reviews`, Masks structured evidence, blind judge bundles.
- Produces: release lane results and `artifacts/human-review-bundle.json` without fabricated reviews.

- [ ] **Step 1: Add failing release external-input tests**

```python
def test_release_missing_external_inputs_writes_review_bundle_and_not_run(tmp_path):
    blind_request = {
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "pair_id": "pair-1",
        "labels": ["A", "B"],
        "sides": {"A": [{"turn_id": "t1", "text": "A"}], "B": [{"turn_id": "t1", "text": "B"}]},
        "turn_ids": ["t1"],
        "rubric_id": "agency-and-fun",
        "rubric_version": 1,
        "request_sha256": "a" * 64,
    }
    result = pipeline.run_release_external_gates(
        root=REPO,
        output=tmp_path,
        chapter_run=None,
        holdout_bundle=None,
        calibration_reviews=None,
        judge_requests=[blind_request],
    )
    assert result["status"] == "NOT_RUN"
    assert set(result["missing"]) == {"chapter_run", "holdout_bundle", "human_calibration"}
    bundle = json.loads((tmp_path / "artifacts/human-review-bundle.json").read_text())
    assert bundle["reviews"] == []
    assert bundle["evidence_kind"] == "human_review_requested"
```

- [ ] **Step 2: Run calibration/integration tests and confirm RED**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_eval_calibration.py tests/test_eval_longrun.py \
  tests/test_eval_integration.py -q -p no:cacheprovider
```

Expected: FAIL because release has no external-input aggregation or generated human-review bundle.

- [ ] **Step 3: Add release CLI inputs and fail-closed aggregation**

Add:

```text
--chapter-run <run-dir>
--holdout-bundle <bundle-dir>
--calibration-reviews <reviews.json>
```

Validate the chapter directory with `validate_chapter_transition`, holdouts with `validate_holdout_bundle`, and genuine reviews with `validate_calibration_reviews` plus `compute_agreement`. Never synthesize reviewer IDs, labels, timestamps, or agreement scores.

- [ ] **Step 4: Generate a ready-to-fill review bundle**

```json
{
  "schema_version": 1,
  "eval_spec": "eval-spec-v1",
  "evidence_kind": "human_review_requested",
  "blind_requests": [],
  "reviews": [],
  "required_reviewer_count": 2
}
```

The accompanying instructions identify the canonical `calibrate --reviews` command and state that model-generated reviews are invalid human calibration.

- [ ] **Step 5: Declare release capabilities conservatively**

Add `chapter_transition` and `human_calibration` to implemented software capabilities only when the CLI routes exist. A release run still returns `NOT_RUN` until the external evidence paths validate; software capability is not evidence completion.

- [ ] **Step 6: Run release fail-closed tests**

Expected: missing inputs produce a complete review bundle and exact `NOT_RUN` reasons; contradictory chapter/holdout/review evidence produces `FAIL`; valid fixture evidence exercises `PASS` paths without being called gameplay or human evidence.

- [ ] **Step 7: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_eval_pipeline.py \
  plugins/coc-keeper/scripts/coc_eval_calibration.py \
  evaluation/spec/v1/fixtures/review/review-instructions.md \
  evaluation/spec/v1/fixtures/review/review-template.json \
  evaluation/spec/v1/benchmark-manifest.json \
  tests/test_eval_calibration.py tests/test_eval_longrun.py \
  tests/test_eval_integration.py
git commit -m "feat(eval): complete fail-closed release gates"
```

### Task 7: Fix the Runtime Worker-Pool Regression

**Files:**
- Modify: `runtime/engine/session.py` only if the current test proves a runtime defect.
- Modify: `tests/test_runtime_sdk_debug.py` only if the current assertion is stale relative to the approved coverage-retry contract.
- Test: `tests/test_runtime_sdk_debug.py`

**Interfaces:**
- Consumes: `_narrate_with_coverage_retry(...)`, stable narrator worker keys, structured secret-audit requirements.
- Produces: one stable worker scope per session/runner and an assertion that counts logical turns separately from retry attempts.

- [ ] **Step 1: Reproduce the exact failure with full traceback**

```bash
export PATH="/tmp/coc-eval-venv/bin:$PATH"
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_runtime_sdk_debug.py::test_sdk_legacy_pi_runs_deterministic_turn_then_safe_narrator_only \
  -vv -p no:cacheprovider
```

Expected current evidence: FAIL because two logical turns produce six pool requests through the three-attempt coverage retry path.

- [ ] **Step 2: Determine whether behavior or assertion violates the contract**

Inspect each request and retry reason. If all retries use one identical worker key and are caused by the fixture omitting mandatory `secret_audit_complete`, `asserted_fact_refs`, and `semantic_audit`, repair the fixture response:

```python
return {
    "ok": True,
    "final_text": "雨声压住了门后的脚步。",
    "secret_audit_complete": True,
    "asserted_fact_refs": [],
    "semantic_audit": [],
    "model_identity": {"provider": "zhipu-coding", "id": "glm-5.2"},
    "response_mode": "tool",
}
```

If retries show different worker keys or duplicate valid requests, add a failing runtime assertion and fix `_narrator_worker_key` or retry termination minimally.

- [ ] **Step 3: Run lifecycle and narrator safety tests**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_runtime_sdk_debug.py tests/test_runtime_session_lifecycle.py \
  tests/test_narrator_adapter.py -q -p no:cacheprovider
```

Expected: PASS; coverage retries, secret audit, model identity, and scope cleanup remain enforced.

- [ ] **Step 4: Commit the proven minimal change**

```bash
git add runtime/engine/session.py tests/test_runtime_sdk_debug.py
git diff --cached --check
git commit -m "fix(runtime): align narrator retry lifecycle evidence"
```

Stage only the file actually changed.

### Task 8: Documentation, CI, Real Runs, and Final Verification

**Files:**
- Modify: `.github/workflows/tests.yml`
- Modify: `README.md`
- Modify: `docs/status/CURRENT.md`
- Modify: `plugins/coc-keeper/skills/coc-playtest/SKILL.md`
- Test: `tests/test_plugin_metadata.py`
- Test: `tests/test_release_consistency.py`

**Interfaces:**
- Consumes: finished canonical CLI and generated evidence directories.
- Produces: one documented local/CI workflow and final verified evidence.

- [ ] **Step 1: Add failing documentation/CI consistency assertions**

```python
def test_official_docs_name_real_model_roles_and_nightly_baseline_flow():
    combined = README.read_text() + PLAYTEST_SKILL.read_text()
    for value in ("glm-5.2", "gpt-5.6-luna", "gpt-5.6-sol", "--baseline"):
        assert value in combined
```

- [ ] **Step 2: Update CI and user-facing instructions**

CI runs eval-focused tests plus canonical smoke/PR. Nightly remains an explicitly configured model-backed job because local relay/Zhipu credentials are not available on ordinary GitHub-hosted runners. Documentation gives exact capture-then-compare commands and the release external-input commands.

- [ ] **Step 3: Run the complete deterministic verification set**

```bash
export PATH="/tmp/coc-eval-venv/bin:$PATH"
python3 --version
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/ -q -p no:cacheprovider
PYTHONDONTWRITEBYTECODE=1 python3 plugins/coc-keeper/scripts/coc_eval.py run --suite smoke --root . --output /tmp/final-eval-smoke
PYTHONDONTWRITEBYTECODE=1 python3 plugins/coc-keeper/scripts/coc_eval.py run --suite pr --root . --output /tmp/final-eval-pr
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_plugin_metadata.py -q -p no:cacheprovider
```

Expected: Python 3.11.x, zero test failures, smoke `PASS`, PR `PASS`, plugin metadata PASS.

- [ ] **Step 4: Capture a real GLM/Luna nightly baseline**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 plugins/coc-keeper/scripts/coc_eval.py run \
  --suite nightly --root . --output /tmp/final-eval-nightly-baseline
```

Expected: real matrix/continuity artifacts are produced; aggregate is `NOT_RUN` only because baseline comparison/judging has not yet been supplied. Read every generated manifest, report, completeness receipt, transcript, and model attestation.

- [ ] **Step 5: Run the real compared nightly**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 plugins/coc-keeper/scripts/coc_eval.py run \
  --suite nightly --root . \
  --baseline /tmp/final-eval-nightly-baseline \
  --output /tmp/final-eval-nightly-candidate
PYTHONDONTWRITEBYTECODE=1 python3 plugins/coc-keeper/scripts/coc_eval.py report \
  /tmp/final-eval-nightly-candidate
PYTHONDONTWRITEBYTECODE=1 python3 plugins/coc-keeper/scripts/coc_eval.py verify \
  /tmp/final-eval-nightly-candidate
```

Expected: exact GLM/Luna/Sol identities, no model fallback, complete evidence, spoiler-safe judge requests, and an evidence-justified nightly terminal status. Any `FAIL`, `INELIGIBLE`, `NON_COMPARABLE`, or unexpected `NOT_RUN` is investigated and fixed before completion.

- [ ] **Step 6: Validate release fail-closed behavior against local Masks evidence**

Run release with the local structured Masks chapter run when available. Without genuine human reviews and bound holdouts, expected status is `NOT_RUN` with only those external reasons and a generated human review bundle; it must not claim release readiness.

- [ ] **Step 7: Commit documentation and CI**

```bash
git add .github/workflows/tests.yml README.md docs/status/CURRENT.md \
  plugins/coc-keeper/skills/coc-playtest/SKILL.md \
  tests/test_plugin_metadata.py tests/test_release_consistency.py
git commit -m "docs(eval): document executable nightly and release"
```

- [ ] **Step 8: Review branch scope**

```bash
git status --short --branch
git diff main...HEAD --check
git diff --stat main...HEAD
```

Expected: only approved eval/runtime/test/docs changes; user-owned untracked paths remain untouched; no secrets or generated private gameplay artifacts are staged.
