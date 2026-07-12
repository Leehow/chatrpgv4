# COC Evaluation Contract Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the host-neutral evaluation entry point and a fail-closed report contract that makes omitted public dice a hard failure.

**Architecture:** Add a focused `coc_eval_contract.py` library that reads existing structured playtest evidence, renders a canonical `rules-and-dice` section, writes `report-completeness.json`, and verifies source-to-report traceability. Add a thin `coc_eval.py` CLI that loads a versioned benchmark manifest, delegates base report generation to the existing canonical modules, applies the contract, runs named deterministic suites, and emits only the status vocabulary defined by `eval-spec-v1`. Existing runtime/rules/report implementations remain single-track and are not copied.

**Tech Stack:** Python 3.11+ standard library, pytest, existing COC Keeper scripts and `.coc/playtests/<run-id>/` artifacts, GitHub Actions.

## Global Constraints

- `plugins/coc-keeper/` remains the only canonical plugin implementation.
- `runtime/` must not fork Keeper skills or rules.
- Official evaluation enters through `python3 plugins/coc-keeper/scripts/coc_eval.py`.
- Structured logs are authoritative; Markdown prose never fabricates a roll or state change.
- Public and consequence-public rolls must be source-traceable in the report.
- Keeper-only rolls must not be rendered in the player-facing report.
- A required roll omitted from the report is a hard failure.
- A run with missing provenance or non-gameplay fixtures is `INELIGIBLE`, not `PASS`.
- Meaning-bearing classifications must not be inferred by free-text keyword matching.
- Production code follows red-green-refactor; every behavior begins with a failing test.

---

## File Structure

- Create `evaluation/spec/v1/benchmark-manifest.json`: suite membership, commands, implemented capabilities, benchmark/report versions.
- Create `evaluation/spec/v1/thresholds.json`: phase-one hard-gate thresholds and future non-inferiority defaults.
- Create `evaluation/spec/v1/report-contract.json`: mandatory report anchor and roll-field contract.
- Create `plugins/coc-keeper/scripts/coc_eval_contract.py`: roll loading, structured visibility projection, canonical rendering, injection, completeness receipt, verification, and baseline comparison.
- Create `plugins/coc-keeper/scripts/coc_eval.py`: CLI parser and orchestration for `run`, `report`, `verify`, `compare`, and `baseline`.
- Create `plugins/coc-keeper/skills/coc-eval/SKILL.md`: host-neutral official evaluation workflow.
- Create `tests/test_eval_contract.py`: contract, CLI, and regression tests.
- Modify `AGENTS.md`: require the canonical CLI and roll-completeness gate for official reports.
- Update PR documentation after verification.

---

### Task 1: Freeze the Phase-One Benchmark Contract

**Files:**
- Create: `evaluation/spec/v1/benchmark-manifest.json`
- Create: `evaluation/spec/v1/thresholds.json`
- Create: `evaluation/spec/v1/report-contract.json`
- Test: `tests/test_eval_contract.py`

**Interfaces:**
- Consumes: repository root supplied to `load_benchmark_manifest(root: Path)`.
- Produces: `load_benchmark_manifest(root: Path) -> dict[str, Any]` and `resolve_suite(manifest: dict[str, Any], suite: str) -> dict[str, Any]`.

- [ ] **Step 1: Write the failing manifest tests**

```python
def test_benchmark_manifest_exposes_only_named_suites():
    manifest = contract.load_benchmark_manifest(REPO)
    assert manifest["eval_spec"] == "eval-spec-v1"
    assert set(manifest["suites"]) == {"smoke", "pr", "nightly", "release", "diagnostic"}
    with pytest.raises(ValueError, match="unknown evaluation suite"):
        contract.resolve_suite(manifest, "whatever-this-agent-invented")


def test_phase_one_release_suite_fails_closed_for_unimplemented_capabilities():
    manifest = contract.load_benchmark_manifest(REPO)
    release = contract.resolve_suite(manifest, "release")
    assert "ai_player_matrix" in release["required_capabilities"]
    assert "ai_player_matrix" not in manifest["implemented_capabilities"]
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_eval_contract.py::test_benchmark_manifest_exposes_only_named_suites tests/test_eval_contract.py::test_phase_one_release_suite_fails_closed_for_unimplemented_capabilities -q -p no:cacheprovider
```

Expected: collection/import failure because `coc_eval_contract.py` does not exist.

- [ ] **Step 3: Add the three versioned JSON contracts**

`benchmark-manifest.json` must declare:

```json
{
  "schema_version": 1,
  "eval_spec": "eval-spec-v1",
  "benchmark_version": "2026.07.1",
  "report_schema_version": 2,
  "implemented_capabilities": ["canonical_cli", "report_contract", "roll_completeness", "baseline_identity_compare"],
  "suites": {
    "smoke": {
      "required_capabilities": ["canonical_cli", "report_contract", "roll_completeness"],
      "commands": [["python3", "-m", "pytest", "tests/test_eval_contract.py", "tests/test_plugin_metadata.py", "-q", "-p", "no:cacheprovider"]]
    },
    "pr": {
      "required_capabilities": ["canonical_cli", "report_contract", "roll_completeness", "baseline_identity_compare"],
      "commands": [["python3", "-m", "pytest", "tests/test_eval_contract.py", "tests/test_playtest_report.py", "tests/test_playtest_audit.py", "tests/test_plugin_metadata.py", "-q", "-p", "no:cacheprovider"]]
    },
    "nightly": {
      "required_capabilities": ["canonical_cli", "report_contract", "roll_completeness", "baseline_identity_compare", "ai_player_matrix", "long_memory"],
      "commands": []
    },
    "release": {
      "required_capabilities": ["canonical_cli", "report_contract", "roll_completeness", "baseline_identity_compare", "ai_player_matrix", "long_memory", "chapter_transition", "human_calibration"],
      "commands": []
    },
    "diagnostic": {
      "required_capabilities": ["canonical_cli", "report_contract", "roll_completeness"],
      "commands": []
    }
  }
}
```

`thresholds.json` must set zero tolerance for crashes, secret leaks, illegal state transitions, stale choices, duplicate command application, deterministic rule failures, and missing required rolls.

`report-contract.json` must declare report schema 2, anchor `rules-and-dice`, the explicit zero-roll statement, accepted visibility values, and the required percentile/non-percentile fields.

- [ ] **Step 4: Implement manifest loading and suite resolution**

```python
EVAL_SPEC_DIR = Path("evaluation/spec/v1")


def load_benchmark_manifest(root: Path) -> dict[str, Any]:
    path = Path(root) / EVAL_SPEC_DIR / "benchmark-manifest.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != 1 or payload.get("eval_spec") != "eval-spec-v1":
        raise ValueError("invalid eval-spec-v1 benchmark manifest")
    if not isinstance(payload.get("suites"), dict):
        raise ValueError("benchmark manifest missing suites")
    return payload


def resolve_suite(manifest: dict[str, Any], suite: str) -> dict[str, Any]:
    suites = manifest.get("suites") or {}
    if suite not in suites:
        raise ValueError(f"unknown evaluation suite: {suite}")
    value = suites[suite]
    if not isinstance(value, dict):
        raise ValueError(f"invalid suite definition: {suite}")
    return value
```

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the command from Step 2. Expected: two tests pass.

- [ ] **Step 6: Commit**

```bash
git add evaluation/spec/v1 tests/test_eval_contract.py plugins/coc-keeper/scripts/coc_eval_contract.py
git commit -m "feat(eval): add versioned benchmark contract"
```

---

### Task 2: Render Source-Traceable Public Dice

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_eval_contract.py`
- Modify: `tests/test_eval_contract.py`

**Interfaces:**
- Consumes: `load_roll_records(run_dir: Path) -> RollSource` where `RollSource.records` contains parsed structured rows and `RollSource.source_paths` records log provenance.
- Produces: `render_rules_and_dice(records: list[dict[str, Any]], *, play_language: str, actor_names: dict[str, str]) -> RenderedDiceSection`.

- [ ] **Step 1: Write failing tests for percentile, bonus die, damage, Keeper-only, and zero-roll cases**

```python
def test_public_percentile_roll_renders_value_target_difficulty_and_outcome(tmp_path):
    run_dir = make_run(tmp_path, rolls=[{
        "roll_id": "r-001",
        "type": "roll",
        "actor": "ada",
        "visibility": "public",
        "payload": {"skill": "Spot Hidden", "roll": 73, "effective_target": 60, "difficulty": "regular", "outcome": "failure"},
    }])
    rendered = contract.compile_report_contract(run_dir, generate_base_report=False)
    text = Path(rendered["report_path"]).read_text(encoding="utf-8")
    assert "[roll-id: r-001]" in text
    assert "73 / 目标 60" in text
    assert "regular" in text
    assert "failure" in text


def test_damage_roll_renders_faces_modifier_total_and_state_delta(tmp_path):
    run_dir = make_run(tmp_path, rolls=[{
        "roll_id": "r-014",
        "type": "damage",
        "actor": "cultist",
        "visibility": "consequence_public",
        "payload": {"purpose": "damage", "die": "1d6+1", "die_rolls": [4], "flat_modifier": 1, "roll": 5, "hp_before": 11, "hp_after": 6},
    }])
    result = contract.compile_report_contract(run_dir, generate_base_report=False)
    text = Path(result["report_path"]).read_text(encoding="utf-8")
    assert "1d6+1：4 + 1 = 5" in text
    assert "HP 11 → 6" in text


def test_keeper_only_roll_is_counted_but_not_rendered(tmp_path):
    run_dir = make_run(tmp_path, rolls=[{
        "roll_id": "secret-1",
        "type": "roll",
        "actor": "keeper_under_test",
        "visibility": "keeper_only",
        "payload": {"skill": "Listen", "roll": 12, "effective_target": 50, "outcome": "hard_success"},
    }])
    result = contract.compile_report_contract(run_dir, generate_base_report=False)
    text = Path(result["report_path"]).read_text(encoding="utf-8")
    receipt = json.loads((run_dir / "artifacts" / "report-completeness.json").read_text())
    assert "secret-1" not in text
    assert receipt["keeper_only_roll_count"] == 1
    assert receipt["required_public_roll_count"] == 0


def test_zero_public_rolls_emit_explicit_zero_statement(tmp_path):
    run_dir = make_run(tmp_path, rolls=[])
    result = contract.compile_report_contract(run_dir, generate_base_report=False)
    text = Path(result["report_path"]).read_text(encoding="utf-8")
    assert "本场没有发生需要记录的公开检定（公开骰数：0）。" in text
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_eval_contract.py -k "percentile or damage or keeper_only or zero_public" -q -p no:cacheprovider
```

Expected: failures because roll loading/rendering and report compilation are absent.

- [ ] **Step 3: Implement structured roll projection**

Define immutable result containers:

```python
@dataclass(frozen=True)
class RollSource:
    records: list[dict[str, Any]]
    source_paths: list[str]
    source_logs_present: bool
    parse_errors: list[dict[str, Any]]


@dataclass(frozen=True)
class RenderedDiceSection:
    markdown: str
    source_roll_ids: list[str]
    required_public_roll_ids: list[str]
    keeper_only_roll_ids: list[str]
    incomplete_roll_ids: list[str]
```

Visibility projection uses structured fields only:

```python
def roll_visibility(event: dict[str, Any]) -> str:
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    explicit = event.get("visibility") or payload.get("visibility")
    if explicit in {"public", "consequence_public", "keeper_only"}:
        return str(explicit)
    if event.get("hidden") is True or payload.get("hidden") is True:
        return "keeper_only"
    if any(payload.get(key) is not None for key in ("hp_before", "hp_after", "san_before", "san_after")):
        return "consequence_public"
    if str(event.get("actor") or "") in {"keeper_under_test", "KP", "system"}:
        return "keeper_only"
    return "public"
```

Legacy rows without `roll_id` receive a report-local `legacy-roll-####` source key and are added to `incomplete_roll_ids`; no dice value is invented.

- [ ] **Step 4: Implement canonical rendering**

Percentile rows render the source roll, target, difficulty, outcome, bonus/penalty candidates, push/Luck information, and source marker. Non-percentile rows render die expression, individual faces, modifier, final total, and structured HP/SAN delta. Values absent from the source are displayed as `?` only in the engineering diagnostic and the roll is marked incomplete; the renderer never guesses a number.

- [ ] **Step 5: Implement deterministic section injection**

```python
def inject_rules_and_dice(report_text: str, section: str) -> str:
    report_text = remove_anchored_section(report_text, "rules-and-dice")
    marker = "report-anchor: Mechanical Log"
    idx = report_text.find(marker)
    if idx < 0:
        return report_text.rstrip() + "\n\n" + section.rstrip() + "\n"
    heading_start = report_text.rfind("\n## ", 0, idx)
    insert_at = 0 if heading_start < 0 else heading_start + 1
    return report_text[:insert_at].rstrip() + "\n\n" + section.rstrip() + "\n\n" + report_text[insert_at:].lstrip()
```

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests pass.

- [ ] **Step 7: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_eval_contract.py tests/test_eval_contract.py
git commit -m "feat(eval): render canonical source-traceable dice"
```

---

### Task 3: Enforce Report Completeness

**Files:**
- Modify: `plugins/coc-keeper/scripts/coc_eval_contract.py`
- Modify: `tests/test_eval_contract.py`

**Interfaces:**
- Consumes: `RenderedDiceSection`, final report Markdown, and evidence eligibility.
- Produces: `build_report_completeness(...) -> dict[str, Any]`, `verify_report_contract(run_dir: Path) -> dict[str, Any]`, and `artifacts/report-completeness.json`.

- [ ] **Step 1: Write failing omission, duplicate, fabricated, and missing-log tests**

```python
def test_deleting_rendered_public_roll_makes_verification_fail(tmp_path):
    run_dir = make_run(tmp_path, rolls=[public_roll("r-001")])
    result = contract.compile_report_contract(run_dir, generate_base_report=False)
    report = Path(result["report_path"])
    report.write_text(report.read_text().replace("[roll-id: r-001]", "[removed]", 1))
    verified = contract.verify_report_contract(run_dir)
    assert verified["status"] == "FAIL"
    assert verified["report_completeness"]["missing_roll_ids"] == ["r-001"]


def test_duplicate_roll_marker_makes_verification_fail(tmp_path):
    run_dir = make_run(tmp_path, rolls=[public_roll("r-001")])
    result = contract.compile_report_contract(run_dir, generate_base_report=False)
    report = Path(result["report_path"])
    report.write_text(report.read_text() + "\n[roll-id: r-001]\n")
    verified = contract.verify_report_contract(run_dir)
    assert verified["status"] == "FAIL"
    assert verified["report_completeness"]["duplicate_roll_ids"] == ["r-001"]


def test_unlogged_roll_marker_makes_traceability_fail(tmp_path):
    run_dir = make_run(tmp_path, rolls=[])
    result = contract.compile_report_contract(run_dir, generate_base_report=False)
    report = Path(result["report_path"])
    report.write_text(report.read_text() + "\n[roll-id: fabricated-99]\n")
    verified = contract.verify_report_contract(run_dir)
    assert verified["status"] == "FAIL"
    assert verified["report_completeness"]["untraced_roll_ids"] == ["fabricated-99"]
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_eval_contract.py -k "deleting or duplicate_roll_marker or unlogged" -q -p no:cacheprovider
```

Expected: failures because verification does not yet recompute markers.

- [ ] **Step 3: Implement marker accounting and fail-closed receipt**

`report-completeness.json` must contain:

```json
{
  "schema_version": 1,
  "report_schema_version": 2,
  "source_roll_count": 0,
  "required_public_roll_count": 0,
  "rendered_public_roll_count": 0,
  "keeper_only_roll_count": 0,
  "missing_roll_ids": [],
  "duplicate_roll_ids": [],
  "untraced_roll_ids": [],
  "incomplete_roll_ids": [],
  "source_logs_present": true,
  "parse_errors": [],
  "passed": true
}
```

Marker parsing uses the machine-controlled syntax `\[roll-id: ([A-Za-z0-9_.:-]+)\]`. `passed` is true only when required public IDs are present exactly once, no untraced IDs exist, no required public record is incomplete, source logs are present, and JSONL parsing succeeded.

- [ ] **Step 4: Derive final status without false PASS**

```python
def contract_status(*, completeness_passed: bool, eligible: bool) -> str:
    if not completeness_passed:
        return "FAIL"
    return "PASS" if eligible else "INELIGIBLE"
```

Verification recomputes from source logs and current Markdown; it does not trust a previously written receipt.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: all selected tests pass.

- [ ] **Step 6: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_eval_contract.py tests/test_eval_contract.py
git commit -m "feat(eval): fail closed on omitted or untraceable dice"
```

---

### Task 4: Add the Canonical CLI and Baseline Identity Comparison

**Files:**
- Create: `plugins/coc-keeper/scripts/coc_eval.py`
- Modify: `plugins/coc-keeper/scripts/coc_eval_contract.py`
- Modify: `tests/test_eval_contract.py`

**Interfaces:**
- Consumes: benchmark manifest, existing report generator, playtest run directory, baseline/candidate run manifests.
- Produces: CLI commands `run`, `report`, `verify`, `compare`, and `baseline`; JSON stdout; deterministic exit codes `0=PASS`, `1=FAIL`, `2=INELIGIBLE|NOT_RUN|NON_COMPARABLE`.

- [ ] **Step 1: Write failing CLI and comparison tests**

```python
def test_cli_rejects_agent_invented_suite(capsys):
    code = cli.main(["run", "--suite", "invented", "--root", str(REPO)])
    assert code == 1
    assert "unknown evaluation suite" in capsys.readouterr().err


def test_release_suite_is_not_run_until_required_capabilities_exist(tmp_path, capsys):
    code = cli.main(["run", "--suite", "release", "--root", str(REPO), "--output", str(tmp_path / "out")])
    payload = json.loads(capsys.readouterr().out)
    assert code == 2
    assert payload["status"] == "NOT_RUN"
    assert "ai_player_matrix" in payload["missing_capabilities"]


def test_compare_rejects_mismatched_benchmark_identity(tmp_path):
    baseline = write_manifest(tmp_path / "base", benchmark_version="2026.07.1")
    candidate = write_manifest(tmp_path / "candidate", benchmark_version="2026.08.0")
    result = contract.compare_run_manifests(baseline, candidate)
    assert result["status"] == "NON_COMPARABLE"
    assert "benchmark_version" in result["identity_mismatches"]
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_eval_contract.py -k "cli or compare" -q -p no:cacheprovider
```

Expected: import/function failures.

- [ ] **Step 3: Implement CLI parsing**

```python
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="coc_eval.py")
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run")
    run.add_argument("--suite", required=True)
    run.add_argument("--root", type=Path, default=Path.cwd())
    run.add_argument("--output", type=Path)
    report = sub.add_parser("report")
    report.add_argument("run_dir", type=Path)
    verify = sub.add_parser("verify")
    verify.add_argument("run_dir", type=Path)
    compare = sub.add_parser("compare")
    compare.add_argument("--baseline", type=Path, required=True)
    compare.add_argument("--candidate", type=Path, required=True)
    baseline = sub.add_parser("baseline")
    baseline.add_argument("--from", dest="source", type=Path, required=True)
    baseline.add_argument("--output", type=Path, required=True)
    return parser
```

- [ ] **Step 4: Implement named-suite execution**

The runner validates required capabilities before executing commands. It writes `run-manifest.json` before execution and finalizes it atomically with command results, status, timestamps, benchmark identity, host ID, and artifact hashes. `nightly`/`release` return `NOT_RUN` while required phase-three/four capabilities are absent; they never downgrade to a misleading deterministic-only PASS.

- [ ] **Step 5: Integrate existing report generation**

`report` imports `coc_playtest_report.generate_battle_report` lazily, then applies `compile_report_contract`. `verify` recomputes completeness. `compare` compares identity and phase-one hard gates. `baseline` copies a normalized, hash-bound manifest and completeness receipt; it does not copy gameplay secrets into the repository.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the Step 2 command. Expected: selected tests pass.

- [ ] **Step 7: Commit**

```bash
git add plugins/coc-keeper/scripts/coc_eval.py plugins/coc-keeper/scripts/coc_eval_contract.py tests/test_eval_contract.py
git commit -m "feat(eval): add canonical host-neutral evaluation CLI"
```

---

### Task 5: Route All Agents Through the Contract

**Files:**
- Create: `plugins/coc-keeper/skills/coc-eval/SKILL.md`
- Modify: `AGENTS.md`
- Test: `tests/test_eval_contract.py`
- Test: `tests/test_plugin_metadata.py`

**Interfaces:**
- Consumes: official requests such as “跑测试并给我战报”.
- Produces: one documented command path and explicit prohibition on hand-authored substitute PASS/battle reports.

- [ ] **Step 1: Write failing documentation contract tests**

```python
def test_project_rules_require_canonical_eval_cli():
    text = (REPO / "AGENTS.md").read_text(encoding="utf-8")
    assert "coc_eval.py" in text
    assert "missing required public roll" in text


def test_coc_eval_skill_forbids_handwritten_substitute_reports():
    text = (REPO / "plugins/coc-keeper/skills/coc-eval/SKILL.md").read_text(encoding="utf-8")
    assert "coc_eval.py run --suite" in text
    assert "must not rewrite" in text.lower()
    assert "report-completeness.json" in text
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_eval_contract.py -k "project_rules or coc_eval_skill" -q -p no:cacheprovider
```

Expected: failures because routing docs are absent.

- [ ] **Step 3: Add `coc-eval` skill**

The skill must state:

```text
Official change validation: coc_eval.py run --suite pr
Fast local validation: coc_eval.py run --suite smoke
Existing run report: coc_eval.py report <run-dir>
Existing run verification: coc_eval.py verify <run-dir>
Release may be claimed only when the release suite itself records PASS.
Generated battle-report.md and evaluation-report.md are delivered without factual rewriting.
```

It must distinguish `PASS`, `FAIL`, `INELIGIBLE`, `NOT_RUN`, and `NON_COMPARABLE` and require the completeness receipt.

- [ ] **Step 4: Strengthen `AGENTS.md`**

Add a `Canonical Evaluation Contract` section requiring the named CLI for official testing and a `Dice Completeness Gate` subsection stating that any missing public roll is a hard failure. Preserve the single-track and semantic-matcher rules.

- [ ] **Step 5: Run focused and metadata tests and verify GREEN**

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_eval_contract.py tests/test_plugin_metadata.py -q -p no:cacheprovider
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add AGENTS.md plugins/coc-keeper/skills/coc-eval/SKILL.md tests/test_eval_contract.py
git commit -m "docs(eval): route official playtests through canonical CLI"
```

---

### Task 6: Full Verification and Pull Request Completion

**Files:**
- Modify only if verification exposes a defect.

**Interfaces:**
- Consumes: completed Phase 1 branch.
- Produces: fresh local and CI evidence, updated PR body, and a reviewable implementation branch.

- [ ] **Step 1: Run focused contract tests**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_eval_contract.py -q -p no:cacheprovider
```

Expected: zero failures.

- [ ] **Step 2: Run required plugin metadata gate**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_plugin_metadata.py -q -p no:cacheprovider
```

Expected: zero failures.

- [ ] **Step 3: Run affected report/audit tests**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_playtest_report.py tests/test_playtest_audit.py tests/test_playtest_completion_audit.py -q -p no:cacheprovider
```

Expected: zero failures.

- [ ] **Step 4: Run the canonical smoke suite itself**

```bash
python3 plugins/coc-keeper/scripts/coc_eval.py run --suite smoke --root .
```

Expected: JSON with `"status": "PASS"` and exit 0.

- [ ] **Step 5: Run the full repository test suite**

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests -q -p no:cacheprovider
```

Expected: zero failures.

- [ ] **Step 6: Inspect GitHub Actions**

Confirm all required jobs for the final commit conclude successfully. Read failing job logs rather than retrying blindly.

- [ ] **Step 7: Review diff against acceptance criteria**

Verify all ten design acceptance criteria that belong to Phase 1: canonical routing, no PASS with missing evidence, complete public dice or explicit zero, deletion regression, fixture separation, host-neutral normalized output, identity mismatch rejection, deterministic hard-gate precedence, stable evidence references, and no implementation fork.

- [ ] **Step 8: Update PR**

Update PR #8 title/body to describe implementation, exact test evidence, current phase boundary, and the fact that nightly/release remain `NOT_RUN` until later capabilities land.

- [ ] **Step 9: Final commit if documentation changed**

```bash
git add docs AGENTS.md
git commit -m "docs(eval): record phase-one verification"
```

---

## Plan Self-Review

- **Spec coverage:** Phase 1 covers the canonical CLI, versioned manifest, report schema anchor, public/keeper roll separation, explicit zero-roll statement, source traceability, hard completeness gate, status vocabulary, host routing, and baseline identity comparison. AI persona matrices, semantic A/B judging, 25/50-turn continuity, Masks chapter transition, and human calibration are intentionally left to separately reviewable Phase 2–4 plans; `nightly` and `release` fail closed as `NOT_RUN` until those capabilities exist.
- **Placeholder scan:** No TODO, TBD, “similar to,” or unspecified error-handling steps remain.
- **Type consistency:** `load_benchmark_manifest`, `resolve_suite`, `RollSource`, `RenderedDiceSection`, `compile_report_contract`, `verify_report_contract`, and `compare_run_manifests` retain the same signatures across tasks.
