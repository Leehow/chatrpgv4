"""Private host apply bridge for finalize-after async memory extraction.

Pins the private subprocess boundary (``coc_memory_extraction_host_apply.py``)
that the Pi host's background memory-extraction dispatcher uses:

- ``prepare`` rebuilds the deterministic job from the durable backlog row and
  the immutable stored episode, and serves the exact digest-verified
  finalized ``rendered_text`` as the bounded read payload; it skips (mutating
  nothing) when the row is not pending or no verified payload exists.
- ``apply`` persists one immutable per-job artifact through the core and
  recovers the pending backlog row, but NEVER materializes assertions into
  the shared store — promotion stays with KP adjudication.
- ``apply`` replay converges via the existing artifact without re-running a
  divergent producer result.
- Failures record recoverable pending ``extraction_error`` rows — never
  ``abandoned``.
- The bridge touches nothing outside ``memory/temporal`` and its own audit
  sidecar: no hard state, no rules, no transcripts, no finalization logs.
- Transport-level rejections never mutate anything.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
BRIDGE = SCRIPTS / "coc_memory_extraction_host_apply.py"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


coc_toolbox = _load("coc_toolbox_host_apply", SCRIPTS / "coc_toolbox.py")
coc_starter = _load("coc_starter_host_apply", SCRIPTS / "coc_starter.py")
contract = _load(
    "coc_temporal_memory_contract_host_apply",
    SCRIPTS / "coc_temporal_memory_contract.py",
)
ext = _load("coc_memory_extraction_host_apply_core", SCRIPTS / "coc_memory_extraction.py")


def _run_bridge(request: dict) -> tuple[int, dict]:
    completed = subprocess.run(
        [sys.executable, str(BRIDGE)],
        input=json.dumps(request, ensure_ascii=False),
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=120,
    )
    assert completed.stdout.strip(), completed.stderr
    return completed.returncode, json.loads(completed.stdout)


def _prepare(workspace: Path, campaign_id: str, backlog_id: str) -> tuple[int, dict]:
    return _run_bridge({
        "schema_version": 1,
        "command": "prepare",
        "workspace_root": str(workspace),
        "campaign_id": campaign_id,
        "backlog_id": backlog_id,
    })


def _run_bridge_via_contract_uv(request: dict) -> tuple[int, dict]:
    """Production command shape used by the TypeScript default transport."""
    found = shutil.which("uv")
    assert found, "required uv 0.11.16 must be on PATH"
    uv = Path(found).resolve()
    version = subprocess.run(
        [str(uv), "--version"], check=True, capture_output=True,
        text=True, encoding="utf-8",
    ).stdout.strip()
    assert version.startswith("uv 0.11.16"), version
    completed = subprocess.run(
        [
            str(uv), "run", "--project", str(REPO), "--frozen",
            "python", str(BRIDGE),
        ],
        input=json.dumps(request, ensure_ascii=False),
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=120,
    )
    assert completed.stdout.strip(), completed.stderr
    return completed.returncode, json.loads(completed.stdout)


def _apply(
    workspace: Path,
    campaign_id: str,
    backlog_id: str,
    result: dict,
) -> tuple[int, dict]:
    return _run_bridge({
        "schema_version": 1,
        "command": "apply",
        "workspace_root": str(workspace),
        "campaign_id": campaign_id,
        "backlog_id": backlog_id,
        "result": result,
    })


@pytest.fixture(autouse=True)
def isolated_git_home(tmp_path, monkeypatch):
    home = tmp_path / "_empty_home"
    home.mkdir(exist_ok=True)
    monkeypatch.setenv("HOME", str(home))
    for key in (
        "XDG_CONFIG_HOME",
        "GIT_CONFIG_GLOBAL",
        "GIT_CONFIG_SYSTEM",
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_AUTHOR_NAME",
        "GIT_AUTHOR_EMAIL",
        "GIT_COMMITTER_NAME",
        "GIT_COMMITTER_EMAIL",
        "GIT_AUTHOR_DATE",
        "GIT_COMMITTER_DATE",
    ):
        monkeypatch.delenv(key, raising=False)


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


@pytest.fixture()
def campaign_ws(tmp_path: Path):
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "mem-extract-hook-test"
    _write_json(
        coc_root / "runtime.json",
        {
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        },
    )
    quick = coc_starter.quick_start(
        coc_root,
        "the-haunting",
        "thomas-hayes",
        campaign_id=campaign_id,
        title="Memory Host Apply Bridge Test",
    )
    return {
        "workspace": workspace,
        "campaign_id": campaign_id,
        "campaign_dir": Path(quick["campaign_dir"]),
    }


def _run(ws, tool: str, args: dict | None = None) -> dict:
    return coc_toolbox.run_tool(tool, ws["workspace"], ws["campaign_id"], dict(args or {}))


def _jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    return [
        json.loads(raw)
        for raw in path.read_text(encoding="utf-8").splitlines()
        if raw.strip()
    ]


def _backlog_rows(ws) -> list[dict]:
    return _jsonl(ws["campaign_dir"] / "memory" / "temporal" / "backlog.jsonl")


def _assertions(ws) -> list[dict]:
    return _jsonl(ws["campaign_dir"] / "memory" / "temporal" / "assertions.jsonl")


def _finalize_turn(ws, decision_id: str) -> dict:
    """Journal → output context → finalize one real turn (existing helpers)."""
    import test_toolbox_memory_extract_hook as hook_helpers

    args = hook_helpers._build_finalize_args(ws, decision_id)
    finalized = _run(ws, "turn.finalize", args)
    assert finalized["ok"] is True, finalized
    return finalized


def _candidate(prefix: str, n: int = 1, turn: int = 1, **over) -> dict:
    base = {
        "assertion_id": f"{prefix}{n}",
        "kind": "belief",
        "subject_id": "subject-party-test",
        "knowers": ["subject-party-test"],
        "privacy": "player_safe",
        "state": "accurate",
        "statement": "地窖里有敲击声。",
        "entities": ["entity-location-cellar"],
        "occurred_turn": turn,
        "valid_from_turn": turn,
    }
    base.update(over)
    return base


def _campaign_tree_digest(campaign_dir: Path) -> dict[str, str]:
    snapshot: dict[str, str] = {}
    for path in sorted(campaign_dir.rglob("*")):
        if path.is_file():
            snapshot[str(path.relative_to(campaign_dir))] = hashlib.sha256(
                path.read_bytes()
            ).hexdigest()
    return snapshot


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_prepare_returns_semantic_packet_and_verified_read_payload(campaign_ws):
    finalized = _finalize_turn(campaign_ws, "host-apply-prepare")
    evidence = finalized["data"]["memory_extraction"]
    code, receipt = _prepare(
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        evidence["backlog_id"],
    )
    assert code == 0
    assert receipt["status"] == "ready"
    assert receipt["job_id"] == evidence["job_id"]
    packet = receipt["packet"]
    assert packet["job_id"] == evidence["job_id"]
    assert packet["episode_id"] == evidence["episode_id"]
    assert packet["timeline_id"] == evidence["timeline_id"]
    assert packet["turn_number"] >= 1
    # Semantic packet only: no machine provenance for the model to copy.
    assert "provenance" not in receipt
    packet_text = json.dumps(packet, ensure_ascii=False)
    assert finalized["data"]["finalization_id"] not in packet_text
    assert not re.search(r"\b[0-9a-f]{40,64}\b", packet_text), (
        "packet must not carry machine digests"
    )
    assert set(packet["result_contract"]["fields"]) == set(ext.CANDIDATE_FIELDS)
    # Exact bounded read payload: text is digest-verified by the host, but
    # its machine integrity value is deliberately stripped before model use.
    assert receipt["read"] == {
        "rendered_text": finalized["data"]["rendered_text"],
    }
    assert "rendered_text_sha256" not in json.dumps(receipt["read"])


def test_contract_uv_bridge_receives_stdin_and_returns_ready(campaign_ws):
    finalized = _finalize_turn(campaign_ws, "host-apply-contract-uv")
    evidence = finalized["data"]["memory_extraction"]
    code, receipt = _run_bridge_via_contract_uv({
        "schema_version": 1,
        "command": "prepare",
        "workspace_root": str(campaign_ws["workspace"]),
        "campaign_id": campaign_ws["campaign_id"],
        "backlog_id": evidence["backlog_id"],
    })
    assert code == 0
    assert receipt["status"] == "ready"
    assert receipt["job_id"] == evidence["job_id"]
    assert receipt["read"] == {
        "rendered_text": finalized["data"]["rendered_text"],
    }


def test_apply_persists_artifact_recovers_backlog_and_never_materializes(
    campaign_ws,
):
    finalized = _finalize_turn(campaign_ws, "host-apply-apply")
    evidence = finalized["data"]["memory_extraction"]
    code, prepared = _prepare(
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        evidence["backlog_id"],
    )
    assert code == 0 and prepared["status"] == "ready"
    prefix = prepared["packet"]["result_contract"]["id_prefix"]
    turn = prepared["packet"]["turn_number"]
    result = {
        "job_id": prepared["job_id"],
        "candidates": [
            _candidate(prefix, 1, turn),
            _candidate(prefix, 2, turn, privacy="keeper_only",
                       statement="管家在掩盖地下室的声响。"),
        ],
    }
    code, receipt = _apply(
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        evidence["backlog_id"],
        result,
    )
    assert code == 0
    assert receipt["status"] == "applied"
    assert receipt["applied"] == 2
    assert receipt["backlog_status"] == "recovered"

    # One immutable per-job artifact, digest-verified on load.
    artifact = ext.load_completed_job(campaign_ws["campaign_dir"], receipt["job_id"])
    assert artifact is not None
    assert artifact["artifact_digest"] == receipt["artifact_digest"]
    assert len(artifact["candidates"]) == 2
    provenance_attached = artifact["candidates"][0]
    assert provenance_attached["source_commit"]
    assert provenance_attached["source_receipts"]

    # Pending backlog row recovered; nothing is abandoned.
    latest_backlog = {row["backlog_id"]: row for row in _backlog_rows(campaign_ws)}
    assert latest_backlog[evidence["backlog_id"]]["status"] == "recovered"

    # NEVER materialized: the shared assertion store stays empty. Promotion
    # to world truth remains with KP adjudication.
    assert _assertions(campaign_ws) == []


def test_apply_replay_converges_without_rerunning_divergent_result(campaign_ws):
    finalized = _finalize_turn(campaign_ws, "host-apply-replay")
    evidence = finalized["data"]["memory_extraction"]
    code, prepared = _prepare(
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        evidence["backlog_id"],
    )
    assert code == 0 and prepared["status"] == "ready"
    prefix = prepared["packet"]["result_contract"]["id_prefix"]
    turn = prepared["packet"]["turn_number"]
    first = {
        "job_id": prepared["job_id"],
        "candidates": [_candidate(prefix, 1, turn)],
    }
    code, applied = _apply(
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        evidence["backlog_id"],
        first,
    )
    assert code == 0 and applied["status"] == "applied"
    artifact_before = ext.load_completed_job(
        campaign_ws["campaign_dir"], prepared["job_id"]
    )

    # A later duplicate dispatch with a divergent producer result converges
    # against the immutable artifact instead of duplicating or overwriting.
    divergent = {
        "job_id": prepared["job_id"],
        "candidates": [_candidate(prefix, 9, turn, statement="完全不同的断言。")],
    }
    code, replay = _apply(
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        evidence["backlog_id"],
        divergent,
    )
    assert code == 0
    assert replay["status"] == "already_applied"
    artifact_after = ext.load_completed_job(
        campaign_ws["campaign_dir"], prepared["job_id"]
    )
    assert artifact_after == artifact_before
    assert _assertions(campaign_ws) == []
    latest_backlog = {row["backlog_id"]: row for row in _backlog_rows(campaign_ws)}
    assert latest_backlog[evidence["backlog_id"]]["status"] == "recovered"


def test_apply_invalid_result_stays_pending_never_abandoned(campaign_ws):
    finalized = _finalize_turn(campaign_ws, "host-apply-invalid")
    evidence = finalized["data"]["memory_extraction"]
    code, prepared = _prepare(
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        evidence["backlog_id"],
    )
    assert code == 0 and prepared["status"] == "ready"
    # Producer-supplied provenance is rejected by the core's closed schema.
    forged = _candidate(
        prepared["packet"]["result_contract"]["id_prefix"],
        1,
        prepared["packet"]["turn_number"],
        source_commit="f" * 40,
    )
    code, receipt = _apply(
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        evidence["backlog_id"],
        {"job_id": prepared["job_id"], "candidates": [forged]},
    )
    assert code == 0
    assert receipt["status"] == "backlog_pending"
    assert receipt["error_kind"] == "invalid_result"
    latest_backlog = {row["backlog_id"]: row for row in _backlog_rows(campaign_ws)}
    assert latest_backlog[evidence["backlog_id"]]["status"] == "pending"
    assert latest_backlog[evidence["backlog_id"]]["reason"] == "extraction_error"
    assert ext.load_completed_job(campaign_ws["campaign_dir"], prepared["job_id"]) is None
    events = _jsonl(
        campaign_ws["campaign_dir"] / "memory" / "temporal" / "extraction-events.jsonl"
    )
    assert any(
        event.get("event") == "failed" and event.get("error_kind") == "invalid_result"
        for event in events
    )


def test_record_failure_leaves_recoverable_pending_row(campaign_ws):
    finalized = _finalize_turn(campaign_ws, "host-apply-timeout")
    evidence = finalized["data"]["memory_extraction"]
    code, receipt = _run_bridge({
        "schema_version": 1,
        "command": "record_failure",
        "workspace_root": str(campaign_ws["workspace"]),
        "campaign_id": campaign_ws["campaign_id"],
        "backlog_id": evidence["backlog_id"],
        "error_kind": "producer_timeout",
        "detail": "extractor child timed out after 180s",
    })
    assert code == 0
    assert receipt["status"] == "failure_recorded"
    assert receipt["backlog_status"] == "pending"
    latest_backlog = {row["backlog_id"]: row for row in _backlog_rows(campaign_ws)}
    assert latest_backlog[evidence["backlog_id"]]["status"] == "pending"
    assert latest_backlog[evidence["backlog_id"]]["reason"] == "extraction_error"
    # Bounded detail landed on the machine-side audit sidecar only.
    events = _jsonl(
        campaign_ws["campaign_dir"] / "memory" / "temporal" / "extraction-events.jsonl"
    )
    assert any(
        event.get("event") == "failed" and event.get("error_kind") == "producer_timeout"
        for event in events
    )
    # A pending error row re-arms: prepare is ready again.
    code, prepared = _prepare(
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        evidence["backlog_id"],
    )
    assert code == 0 and prepared["status"] == "ready"


def test_prepare_skips_non_pending_and_unknown_rows(campaign_ws):
    finalized = _finalize_turn(campaign_ws, "host-apply-skip")
    evidence = finalized["data"]["memory_extraction"]
    code, prepared = _prepare(
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        evidence["backlog_id"],
    )
    assert code == 0 and prepared["status"] == "ready"
    prefix = prepared["packet"]["result_contract"]["id_prefix"]
    turn = prepared["packet"]["turn_number"]
    code, applied = _apply(
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        evidence["backlog_id"],
        {"job_id": prepared["job_id"], "candidates": [_candidate(prefix, 1, turn)]},
    )
    assert code == 0 and applied["status"] == "applied"
    # Recovered row: a duplicate dispatcher schedule skips without mutating.
    code, skipped = _prepare(
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        evidence["backlog_id"],
    )
    assert code == 0
    assert skipped == {
        "status": "skipped",
        "reason": "backlog_not_pending",
        "backlog_id": evidence["backlog_id"],
        "backlog_status": "recovered",
    }
    code, unknown = _prepare(
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        "backlog-mem-extract-hook-test-t999-extract",
    )
    assert code == 0
    assert unknown["status"] == "skipped"
    assert unknown["reason"] == "backlog_unknown"


def test_bridge_writes_nothing_outside_memory_stores(campaign_ws):
    finalized = _finalize_turn(campaign_ws, "host-apply-privacy")
    evidence = finalized["data"]["memory_extraction"]
    before = _campaign_tree_digest(campaign_ws["campaign_dir"])
    code, prepared = _prepare(
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        evidence["backlog_id"],
    )
    assert code == 0 and prepared["status"] == "ready"
    prefix = prepared["packet"]["result_contract"]["id_prefix"]
    turn = prepared["packet"]["turn_number"]
    code, applied = _apply(
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        evidence["backlog_id"],
        {"job_id": prepared["job_id"], "candidates": [_candidate(prefix, 1, turn)]},
    )
    assert code == 0 and applied["status"] == "applied"
    after = _campaign_tree_digest(campaign_ws["campaign_dir"])
    touched = {
        path for path in set(before) | set(after) if before.get(path) != after.get(path)
    }
    for path in touched:
        assert path.startswith("memory/"), (
            f"bridge wrote outside memory stores: {path}"
        )
    # Hard state, transcripts, and finalization logs are byte-identical.
    for guarded in (
        "logs/turn-finalizations.jsonl",
        "logs/table-transcript.jsonl",
        "save/continuation/latest.json",
    ):
        assert before.get(guarded) == after.get(guarded)


def test_bridge_transport_rejections_mutate_nothing(campaign_ws):
    finalized = _finalize_turn(campaign_ws, "host-apply-reject")
    before = _campaign_tree_digest(campaign_ws["campaign_dir"])
    code, receipt = _run_bridge({
        "schema_version": 2,
        "command": "prepare",
        "workspace_root": str(campaign_ws["workspace"]),
        "campaign_id": campaign_ws["campaign_id"],
        "backlog_id": finalized["data"]["memory_extraction"]["backlog_id"],
    })
    assert code == 2
    assert receipt["status"] == "rejected"
    code, receipt = _run_bridge({
        "schema_version": 1,
        "command": "vanish",
        "workspace_root": str(campaign_ws["workspace"]),
        "campaign_id": campaign_ws["campaign_id"],
    })
    assert code == 2
    assert receipt["status"] == "rejected"
    # Path traversal via campaign_id never escapes the campaigns root.
    code, receipt = _run_bridge({
        "schema_version": 1,
        "command": "prepare",
        "workspace_root": str(campaign_ws["workspace"]),
        "campaign_id": "../evil",
        "backlog_id": "backlog-x",
    })
    assert code == 2
    assert receipt["status"] == "rejected"
    code, receipt = _prepare(
        campaign_ws["workspace"].parent,
        campaign_ws["campaign_id"],
        finalized["data"]["memory_extraction"]["backlog_id"],
    )
    assert code == 2
    assert receipt["status"] == "rejected"
    assert receipt["error_code"] == "campaign_missing"
    assert _campaign_tree_digest(campaign_ws["campaign_dir"]) == before
