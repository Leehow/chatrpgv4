from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO / "plugins" / "coc-keeper" / "scripts" / "coc_eval_replay.py"
HOST_IDS = ("codex", "zcode", "cursor", "ci", "local")


def _load():
    assert MODULE_PATH.is_file(), f"missing implementation module: {MODULE_PATH}"
    spec = importlib.util.spec_from_file_location("coc_eval_replay_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules["coc_eval_replay_test"] = module
    spec.loader.exec_module(module)
    return module


def _write(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def _write_json(path: Path, payload: object) -> Path:
    return _write(path, json.dumps(payload, indent=2, sort_keys=True) + "\n")


def _report_for_host(host_id: str, *, run_id: str = "run-abc") -> str:
    return "\n".join(
        [
            "<!-- report-schema-version: 2 -->",
            "## Run Identity and Evidence <!-- report-anchor: run-identity-and-evidence -->",
            f"- Run ID: {run_id}",
            f"- Host: {host_id}",
            "- Started at: 2026-07-13T01:00:00Z",
            "- Completed at: 2026-07-13T01:05:00Z",
            "- Duration seconds: 12.345678",
            f"- Absolute path: /tmp/{host_id}/artifacts/battle-report.md",
            "- KP model: fixture/kp-1",
            "- Player model: fixture/player-1",
            "- Decision: accept-clue-door",
            "- State hash: " + ("a" * 64),
            "- Roll ID: roll-public-001",
            "- Source comment: <!-- roll-source: campaign-rolls.jsonl -->",
            "",
            "The investigator notices the green door.",
            "",
        ]
    )


def test_host_parity_normalized_hash_matches_across_five_hosts(tmp_path: Path):
    replay = _load()
    digests = []
    for host_id in HOST_IDS:
        path = _write(
            tmp_path / host_id / "battle-report.md",
            _report_for_host(host_id, run_id=f"run-{host_id}"),
        )
        digests.append(replay.normalized_report_sha256(path))

    assert len(set(digests)) == 1
    assert all(len(item) == 64 for item in digests)


def test_normalization_is_volatile_allowlist_only():
    replay = _load()
    base = _report_for_host("codex")
    changed_roll = base.replace("roll-public-001", "roll-public-002")
    changed_model = base.replace("fixture/kp-1", "fixture/kp-2")
    changed_decision = base.replace("accept-clue-door", "refuse-clue-door")
    changed_state = base.replace("a" * 64, "b" * 64)
    changed_prose = base.replace(
        "The investigator notices the green door.",
        "The investigator notices the red door.",
    )

    assert replay.normalize_report_for_host_parity(base) == replay.normalize_report_for_host_parity(
        _report_for_host("cursor", run_id="run-other")
    )
    assert replay.normalize_report_for_host_parity(base) != replay.normalize_report_for_host_parity(
        changed_roll
    )
    assert replay.normalize_report_for_host_parity(base) != replay.normalize_report_for_host_parity(
        changed_model
    )
    assert replay.normalize_report_for_host_parity(base) != replay.normalize_report_for_host_parity(
        changed_decision
    )
    assert replay.normalize_report_for_host_parity(base) != replay.normalize_report_for_host_parity(
        changed_state
    )
    assert replay.normalize_report_for_host_parity(base) != replay.normalize_report_for_host_parity(
        changed_prose
    )


def _turn(
    *,
    turn: int,
    decision_id: str,
    scene: str,
    rules_request: str,
    state_sha256: str,
    reveal_set: list[str],
    pending_choice_revision: int,
) -> dict:
    return {
        "turn": turn,
        "decision_id": decision_id,
        "scene": scene,
        "rules_request": rules_request,
        "state_sha256": state_sha256,
        "reveal_set": reveal_set,
        "pending_choice_revision": pending_choice_revision,
    }


def test_fixed_replay_detects_first_structural_divergence(tmp_path: Path):
    replay = _load()
    baseline_turns = [
        _turn(
            turn=1,
            decision_id="d1",
            scene="lobby",
            rules_request="listen",
            state_sha256="1" * 64,
            reveal_set=["clue-a"],
            pending_choice_revision=1,
        ),
        _turn(
            turn=2,
            decision_id="d2",
            scene="hall",
            rules_request="spot_hidden",
            state_sha256="2" * 64,
            reveal_set=["clue-a", "clue-b"],
            pending_choice_revision=2,
        ),
        _turn(
            turn=3,
            decision_id="d3",
            scene="study",
            rules_request="library_use",
            state_sha256="3" * 64,
            reveal_set=["clue-a", "clue-b"],
            pending_choice_revision=2,
        ),
    ]
    candidate_turns = [
        dict(baseline_turns[0]),
        dict(baseline_turns[1]),
        {
            **baseline_turns[2],
            "scene": "garden",
            "state_sha256": "9" * 64,
        },
    ]
    case = {
        "case_id": "fixed-replay-self-test",
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "baseline_turns": baseline_turns,
        "candidate_turns": candidate_turns,
        "divergence_classifications": {
            "d3": "regression",
        },
    }
    output = tmp_path / "replay-out"
    result = replay.run_fixed_replay(case, root=REPO, output=output)

    assert result["status"] == "FAIL"
    assert result["first_divergence"]["turn"] == 3
    assert result["first_divergence"]["decision_id"] == "d3"
    assert result["first_divergence"]["field"] == "scene"
    diffs_path = output / "artifacts" / "state-diffs.jsonl"
    assert diffs_path.is_file()
    rows = [
        json.loads(line)
        for line in diffs_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert rows
    assert rows[0] == {
        "turn": 3,
        "decision_id": "d3",
        "baseline_state_sha256": "3" * 64,
        "candidate_state_sha256": "9" * 64,
        "classification": "regression",
    }


def test_state_diffs_classification_comes_from_structured_values_not_prose(
    tmp_path: Path,
):
    replay = _load()
    baseline_turns = [
        _turn(
            turn=1,
            decision_id="d1",
            scene="lobby",
            rules_request="listen",
            state_sha256="1" * 64,
            reveal_set=[],
            pending_choice_revision=1,
        )
    ]
    candidate_turns = [
        {
            **baseline_turns[0],
            "reveal_set": ["note"],
            "narration": "This prose says the change is beneficial and should be ignored.",
        }
    ]
    case = {
        "case_id": "fixed-replay-prose-independence",
        "schema_version": 1,
        "eval_spec": "eval-spec-v1",
        "baseline_turns": baseline_turns,
        "candidate_turns": candidate_turns,
        "divergence_classifications": {
            "d1": "allowed",
        },
    }
    output = tmp_path / "replay-prose"
    result = replay.run_fixed_replay(case, root=REPO, output=output)
    rows = [
        json.loads(line)
        for line in (output / "artifacts" / "state-diffs.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    ]

    assert result["first_divergence"]["field"] == "reveal_set"
    assert rows[0]["classification"] == "allowed"
    assert "beneficial" not in json.dumps(rows[0])


def test_snapshots_and_fixed_replays_specs_are_versioned():
    snapshots = json.loads(
        (REPO / "evaluation" / "spec" / "v1" / "cases" / "snapshots.json").read_text(
            encoding="utf-8"
        )
    )
    replays = json.loads(
        (REPO / "evaluation" / "spec" / "v1" / "cases" / "fixed-replays.json").read_text(
            encoding="utf-8"
        )
    )
    assert snapshots["schema_version"] == 1
    assert snapshots["eval_spec"] == "eval-spec-v1"
    assert all(item["case_id"] for item in snapshots["cases"])
    assert replays["schema_version"] == 1
    assert replays["eval_spec"] == "eval-spec-v1"
    assert all(item["case_id"] for item in replays["cases"])


def test_case_registry_includes_host_parity_and_fixed_replay_self_tests():
    registry = json.loads(
        (REPO / "evaluation" / "spec" / "v1" / "case-registry.json").read_text(
            encoding="utf-8"
        )
    )
    by_id = {case["case_id"]: case for case in registry["cases"]}
    assert "host-parity-normalized-hash" in by_id
    assert "fixed-replay-first-divergence" in by_id
    for case_id in ("host-parity-normalized-hash", "fixed-replay-first-divergence"):
        case = by_id[case_id]
        assert "pr" in case["suites"]
        assert case["gate"] == "hard"
        assert case["kind"] == "pytest_node"
        assert "tests/test_eval_replay.py" in " ".join(case["command"])
