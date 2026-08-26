"""Behavior tests owned by the memory-extraction operation cell.

Covers the KP-facing extraction-backlog surface: ``memory.extraction_status``
(strict read-only, deterministic ordering, explicit empty) and
``memory.extraction_settle`` (recovered materialization through the reviewed
``coc_memory_extraction`` core and the same facade writer ``memory.adjudicate``
uses; abandoned preserves candidate data; decision_id + fingerprint replay
rules identical to every other temporal mutation). Also regression-covers the
smallest sanctioned facade APIs this cell required (``load_backlog`` /
``settle_backlog``). Deterministic contracts only; no queue or store engine is
introduced here.
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_toolbox = _load("coc_toolbox_extraction_ops", SCRIPTS / "coc_toolbox.py")
coc_starter = _load("coc_starter_extraction_ops", SCRIPTS / "coc_starter.py")
coc_temporal_memory = _load(
    "coc_temporal_memory_extract_ops", SCRIPTS / "coc_temporal_memory.py"
)
coc_memory_extraction = _load(
    "coc_memory_extraction_ops", SCRIPTS / "coc_memory_extraction.py"
)
coc_temporal_memory_contract = _load(
    "coc_temporal_memory_contract_ops", SCRIPTS / "coc_temporal_memory_contract.py"
)
coc_temporal_retrieval = _load(
    "coc_temporal_retrieval_ops", SCRIPTS / "coc_temporal_retrieval.py"
)
coc_mcp_contract_archive = _load(
    "coc_mcp_contract_archive_ops", SCRIPTS / "coc_mcp_contract_archive.py"
)

contract = coc_temporal_memory_contract
ARCHIVE_PATH = REPO / "plugins" / "coc-keeper" / "references" / "mcp-operation-contracts.json"
POLICY_TS_PATH = (
    REPO / "plugins" / "coc-keeper" / "pi" / "lib" / "operation-policy.generated.ts"
)

STATUS_TOOL = "memory.extraction_status"
SETTLE_TOOL = "memory.extraction_settle"

CAMPAIGN = "extract-ops"
COMMIT_A = "a" * 40


# --------------------------------------------------------------------------- #
# Fixtures / helpers
# --------------------------------------------------------------------------- #

@pytest.fixture(autouse=True)
def isolated_git_home(tmp_path, monkeypatch):
    home = tmp_path / "_empty_home"
    home.mkdir()
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
        "COC_HOST",
    ):
        monkeypatch.delenv(key, raising=False)


@pytest.fixture
def ws(tmp_path: Path):
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    coc_root.mkdir(parents=True)
    (coc_root / "runtime.json").write_text(
        json.dumps(
            {
                "schema_version": 2,
                "planner": {"kind": "deterministic"},
                "rules": {"kind": "deterministic"},
                "narrator": {"kind": "template"},
                "player": {"kind": "human"},
            }
        )
        + "\n",
        encoding="utf-8",
    )
    quick = coc_starter.quick_start(
        coc_root,
        "the-haunting",
        "thomas-hayes",
        campaign_id=CAMPAIGN,
        title="Extraction Ops Test",
    )
    return {
        "workspace": workspace,
        "campaign_id": CAMPAIGN,
        "campaign_dir": Path(quick["campaign_dir"]),
    }


def _run(ws_, tool: str, args: dict | None = None) -> dict:
    return coc_toolbox.run_tool(tool, ws_["workspace"], ws_["campaign_id"], args or {})


def _seed_backlog(
    camp: Path,
    turn: int,
    *,
    timeline_id: str = "tl-main",
    commit: str = COMMIT_A,
) -> dict:
    """Canonical enqueue path: one episode + one pending extract backlog row."""
    return coc_temporal_memory.record_episode(
        commit,
        timeline_id,
        turn,
        [f"fin-t{turn}"],
        None,
        None,
        campaign_dir=camp,
        campaign_id=camp.name,
        finalization_receipt=f"fin-t{turn}",
    )


def _backlog_id(turn: int, *, campaign: str = CAMPAIGN, slot: str = "extract") -> str:
    return contract.backlog_id_for(campaign, turn, slot)


def _candidates(camp: Path, turn: int) -> list[dict]:
    prefix = f"mem-{camp.name}-t{turn}-c"
    party = contract.subject_id_for("party", camp.name, "")
    return [
        {
            "assertion_id": f"{prefix}1",
            "kind": "knowledge",
            "subject_id": party,
            "knowers": [party],
            "privacy": "player_safe",
            "state": "accurate",
            "statement": "地窖的敲击声每晚十点响起。",
            "entities": ["entity-location-cellar"],
            "valid_from_turn": turn,
        },
        {
            "assertion_id": f"{prefix}2",
            "kind": "belief",
            "subject_id": party,
            "knowers": [party],
            "privacy": "keeper_only",
            "state": "uncertain",
            "statement": "敲击声可能是伪造的。",
            "entities": [],
            "occurred_turn": turn,
            "valid_from_turn": turn,
        },
    ]


def _recovered_args(camp: Path, turn: int, decision_id: str) -> dict:
    return {
        "decision_id": decision_id,
        "backlog_id": _backlog_id(turn),
        "disposition": "recovered",
        "candidates": _candidates(camp, turn),
    }


def _core_apply_directly(ws_, turn: int, candidates: list[dict]) -> None:
    """Apply a producer result through the core alone (no operation ledger).

    Simulates the crash window between artifact application and candidate
    materialization that a later settle must converge from.
    """
    camp = ws_["campaign_dir"]
    row = coc_temporal_memory.load_backlog(camp)[_backlog_id(turn)]
    episode = coc_temporal_memory.load_episodes(camp)[
        contract.episode_id_for(camp.name, row["timeline_id"], row["turn_number"])
    ]
    job = coc_memory_extraction.build_extraction_job(
        camp,
        {
            "sha": row["commit"],
            "campaign_id": camp.name,
            "timeline_id": row["timeline_id"],
            "turn_number": row["turn_number"],
            "commit_type": "turn",
        },
        episode["finalization_receipt"],
        {key: value for key, value in episode.items() if key != "evidence"},
    )
    receipt = coc_memory_extraction.apply_extraction_result(
        camp,
        job,
        {"job_id": job["job_id"], "candidates": candidates},
    )
    assert receipt["status"] == "applied", receipt


def _assertion_copies(camp: Path) -> dict[str, int]:
    counts: dict[str, int] = {}
    path = camp / "memory" / "temporal" / "assertions.jsonl"
    if not path.exists():
        return counts
    for line in path.read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if not text:
            continue
        payload = json.loads(text)
        counts[payload.get("assertion_id")] = (
            counts.get(payload.get("assertion_id"), 0) + 1
        )
    return counts


def _store_snapshot(camp: Path) -> dict[Path, bytes]:
    temporal = camp / "memory" / "temporal"
    if not temporal.is_dir():
        return {}
    return {
        path.relative_to(temporal): path.read_bytes()
        for path in sorted(temporal.rglob("*"))
        if path.is_file()
    }


# --------------------------------------------------------------------------- #
# Registration, policy, typed schema surface
# --------------------------------------------------------------------------- #

def test_extraction_operations_registered_with_policy_and_mutating_set():
    status_spec = coc_toolbox.TOOLS[STATUS_TOOL]
    assert status_spec["access"] == "query"
    assert status_spec["strict_read_only"] is True
    assert status_spec["write_domains"] == ()
    assert status_spec["audit_mode"] == "reference"
    status_policy = coc_toolbox.operation_policy(STATUS_TOOL)
    assert status_policy["audience"] == "keeper"
    assert status_policy["contract"] == "none"
    assert status_policy["kp_surface"] == "context"
    assert {"live_turn", "pending_finalization", "recovery"} <= set(
        status_policy["phases"]
    )

    settle_spec = coc_toolbox.TOOLS[SETTLE_TOOL]
    assert settle_spec["access"] == "mutation"
    assert settle_spec["write_domains"] == ("memory",)
    settle_policy = coc_toolbox.operation_policy(SETTLE_TOOL)
    assert settle_policy["audience"] == "keeper"
    assert settle_policy["contract"] == "state"
    assert settle_policy["kp_surface"] == "state"
    assert "recovery" in settle_policy["phases"]

    assert SETTLE_TOOL in coc_toolbox._MUTATING_TOOLS
    assert STATUS_TOOL not in coc_toolbox._MUTATING_TOOLS
    assert (
        coc_toolbox.OPERATION_REGISTRY.get(SETTLE_TOOL).params["decision_id"][
            "required"
        ]
        is True
    )


def test_typed_schemas_are_semantic_only():
    archive = coc_mcp_contract_archive.build_archive(coc_toolbox)
    status_schema = archive["operations"][STATUS_TOOL]["inputSchema"]
    assert set(status_schema["properties"]) == {"root", "campaign"}
    assert status_schema["required"] == ["campaign"]

    settle_schema = archive["operations"][SETTLE_TOOL]["inputSchema"]
    assert settle_schema["additionalProperties"] is False
    assert set(settle_schema["properties"]) == {
        "root", "campaign", "decision_id", "backlog_id", "disposition",
        "candidates", "reason",
    }
    assert set(settle_schema["required"]) == {
        "campaign", "decision_id", "backlog_id", "disposition",
    }
    assert settle_schema["properties"]["disposition"]["enum"] == [
        "recovered", "abandoned",
    ]
    # Semantic-ID surface only: no machine evidence travels as input.
    for schema in (status_schema, settle_schema):
        for key in schema["properties"]:
            assert not re.search(r"sha|digest|commit", key), key


def test_generated_catalog_and_policy_projection_pick_up_the_slice():
    archive = coc_mcp_contract_archive.load_and_validate(ARCHIVE_PATH)
    assert STATUS_TOOL in archive["operations"]
    assert SETTLE_TOOL in archive["operations"]
    assert archive["operation_count"] == len(coc_toolbox.TOOLS) == 141
    projection = coc_mcp_contract_archive.validate_policy_projection(
        POLICY_TS_PATH, coc_toolbox
    )
    assert projection["operation_policy"][STATUS_TOOL]["kp_surface"] == "context"
    assert projection["operation_policy"][SETTLE_TOOL]["kp_surface"] == "state"
    assert STATUS_TOOL in projection["operations_by_surface"]["context"]
    assert SETTLE_TOOL in projection["operations_by_surface"]["state"]
    policy_ts = POLICY_TS_PATH.read_text(encoding="utf-8")
    assert f'"{STATUS_TOOL}"' in policy_ts


# --------------------------------------------------------------------------- #
# memory.extraction_status behavior
# --------------------------------------------------------------------------- #

def test_status_lists_entries_deterministically_excluding_foreign_campaigns(ws):
    camp = ws["campaign_dir"]
    # Backlog ids are (campaign, turn, slot)-shaped: one extract slot per
    # turn of this campaign's store, its timeline carried on the row itself.
    _seed_backlog(camp, 3)
    _seed_backlog(camp, 1)
    _seed_backlog(camp, 2, timeline_id="tl-fork")
    # Settle turn 3 through the facade transition so the listing shows more
    # than one status.
    coc_temporal_memory.settle_backlog(camp, _backlog_id(3), status="abandoned")
    # A foreign campaign's row inside this store must never surface here.
    foreign = dict(
        coc_temporal_memory.load_backlog(camp)[_backlog_id(1)]
    )
    foreign["backlog_id"] = _backlog_id(1, campaign="other-camp")
    foreign["campaign_id"] = "other-camp"
    contract.validate_backlog_record(foreign)
    with (camp / "memory" / "temporal" / "backlog.jsonl").open(
        "a", encoding="utf-8"
    ) as handle:
        handle.write(json.dumps(foreign, sort_keys=True) + "\n")

    result = _run(ws, STATUS_TOOL)
    assert result["ok"] is True, result
    data = result["data"]
    assert data["authority"] == "advisory"
    assert data["campaign_id"] == CAMPAIGN
    entries = data["entries"]
    # Deterministic ordering: timeline-major (forks group contiguously),
    # then turn, then the full semantic id.
    assert [(row["timeline_id"], row["turn_number"]) for row in entries] == [
        ("tl-fork", 2),
        ("tl-main", 1),
        ("tl-main", 3),
    ]
    by_key = {(row["timeline_id"], row["turn_number"]): row for row in entries}
    assert by_key[("tl-main", 1)]["status"] == "pending"
    assert by_key[("tl-main", 1)]["reason"] == "review_required"
    assert by_key[("tl-fork", 2)]["status"] == "pending"
    assert by_key[("tl-main", 3)]["status"] == "abandoned"
    for row in entries:
        assert set(row) == {
            "backlog_id", "timeline_id", "turn_number", "reason", "status",
        }
    assert all("campaign_id" not in row for row in entries)

    replay = _run(ws, STATUS_TOOL)
    assert replay["data"]["entries"] == entries
    assert replay["data"]["pending_count"] == 2


def test_status_is_explicitly_empty_and_strictly_read_only(ws):
    empty = _run(ws, STATUS_TOOL)
    assert empty["ok"] is True, empty
    assert empty["data"]["count"] == 0
    assert empty["data"]["entries"] == []
    assert empty["data"]["pending_count"] == 0

    camp = ws["campaign_dir"]
    _seed_backlog(camp, 1)
    _seed_backlog(camp, 3)
    before = _store_snapshot(camp)
    seeded = _run(ws, STATUS_TOOL)
    assert seeded["ok"] is True
    assert seeded["data"]["count"] == 2
    ordered = [
        (row["turn_number"], row["timeline_id"]) for row in seeded["data"]["entries"]
    ]
    assert ordered == [(1, "tl-main"), (3, "tl-main")]
    assert _store_snapshot(camp) == before


def test_fresh_store_is_never_bootstrapped_by_a_read(ws):
    camp = ws["campaign_dir"]
    assert not (camp / "memory" / "temporal" / "backlog.jsonl").exists()
    assert coc_temporal_memory.load_backlog(camp) == {}
    assert not (camp / "memory" / "temporal").exists()
    result = _run(ws, STATUS_TOOL)
    assert result["ok"] is True
    assert not (camp / "memory" / "temporal" / "backlog.jsonl").exists()


# --------------------------------------------------------------------------- #
# memory.extraction_settle — recovered
# --------------------------------------------------------------------------- #

def test_recover_materializes_candidates_through_core_exactly_once(ws):
    camp = ws["campaign_dir"]
    _seed_backlog(camp, 1)
    args = _recovered_args(camp, 1, "settle-recover-1")

    first = _run(ws, SETTLE_TOOL, args)
    assert first["ok"] is True, first
    receipt = first["data"]
    assert receipt["tool"] == SETTLE_TOOL
    assert receipt["decision_id"] == "settle-recover-1"
    assert receipt["disposition"] == "recovered"
    assert receipt["entry_status_before"] == "pending"
    assert receipt["job_id"] == f"extract-{CAMPAIGN}-tl-main-turn-1"
    assert receipt["episode_id"] == contract.episode_id_for(
        CAMPAIGN, "tl-main", 1
    )
    expected_ids = [candidate["assertion_id"] for candidate in args["candidates"]]
    assert receipt["assertion_ids"] == sorted(expected_ids)
    assert receipt["materialized_count"] == 2

    backlog_latest = coc_temporal_memory.load_backlog(camp)[_backlog_id(1)]
    assert backlog_latest["status"] == "recovered"

    artifact = coc_memory_extraction.load_completed_job(
        camp, receipt["job_id"]
    )
    assert artifact is not None
    assert artifact["candidate_count"] == 2
    provenance_commits = {
        candidate["source_commit"] for candidate in artifact["candidates"]
    }
    assert provenance_commits == {COMMIT_A}

    copies = _assertion_copies(camp)
    for assertion_id in expected_ids:
        assert copies.get(assertion_id) == 1, assertion_id
        stored = coc_temporal_memory.load_assertions(camp)[assertion_id]
        assert stored["source_commit"] == COMMIT_A
        assert stored["source_turn"] == 1

    # Byte-equal replay returns the stored receipt and writes nothing new.
    lines_before = len(
        (camp / "memory" / "temporal" / "assertions.jsonl").read_text(
            encoding="utf-8"
        ).splitlines()
    )
    replay = _run(ws, SETTLE_TOOL, args)
    assert replay["ok"] is True, replay
    assert replay["data"] == receipt
    assert any(
        "duplicate decision_id" in warning for warning in replay["warnings"]
    )
    assert len(
        (camp / "memory" / "temporal" / "assertions.jsonl").read_text(
            encoding="utf-8"
        ).splitlines()
    ) == lines_before
    assert _assertion_copies(camp) == copies


def test_recover_converges_after_partial_core_apply_without_new_materialization(ws):
    camp = ws["campaign_dir"]
    _seed_backlog(camp, 1)
    candidates = _candidates(camp, 1)
    # Crash-window simulation: the core applied (artifact durable, backlog
    # flipped recovered) but nothing was materialized yet.
    _core_apply_directly(ws, 1, candidates)
    assert _assertion_copies(camp) == {}

    args = _recovered_args(camp, 1, "settle-converge-1")
    result = _run(ws, SETTLE_TOOL, args)
    assert result["ok"] is True, result
    assert any(
        "already recovered" in warning for warning in result["warnings"]
    ), result["warnings"]
    receipt = result["data"]
    assert receipt["entry_status_before"] == "recovered"
    expected_ids = [candidate["assertion_id"] for candidate in candidates]
    assert receipt["assertion_ids"] == sorted(expected_ids)
    copies = _assertion_copies(camp)
    for assertion_id in expected_ids:
        assert copies.get(assertion_id) == 1, assertion_id
    assert coc_temporal_memory.load_backlog(camp)[_backlog_id(1)][
        "status"
    ] == "recovered"


def test_recover_of_settled_entry_binds_to_stored_evidence_not_caller_input(ws):
    camp = ws["campaign_dir"]
    _seed_backlog(camp, 1)
    ok = _run(ws, SETTLE_TOOL, _recovered_args(camp, 1, "settle-bind-1"))
    assert ok["ok"] is True, ok
    # A fresh decision replaying drifted candidates against the settled job
    # must fail closed on the core's immutable-artifact comparison — never
    # overwrite or append candidate data. A content-valid subset still
    # diverges from the stored artifact: that is store-level drift and maps
    # to invalid_state.
    conflict_drift = _run(
        ws,
        SETTLE_TOOL,
        {
            **_recovered_args(camp, 1, "settle-bind-drift"),
            "candidates": _candidates(camp, 1)[:1],
        },
    )
    assert conflict_drift["ok"] is False
    assert conflict_drift["error"]["code"] == "invalid_state"
    # The immutable artifact itself was never rewritten; the core re-pends
    # the entry explicitly so the divergence stays reviewable evidence.
    artifact_after = coc_memory_extraction.load_completed_job(
        camp, ok["data"]["job_id"]
    )
    assert artifact_after["candidate_count"] == 2
    assert (
        coc_temporal_memory.load_backlog(camp)[_backlog_id(1)]["status"]
        == "pending"
    )


def test_recover_structured_errors_write_nothing(ws):
    camp = ws["campaign_dir"]
    _seed_backlog(camp, 1)
    prefix = f"mem-{CAMPAIGN}-t1-c"

    def probe(label: str, candidates: list[dict]) -> dict:
        return _run(
            ws,
            SETTLE_TOOL,
            {
                "decision_id": f"probe-{label}",
                "backlog_id": _backlog_id(1),
                "disposition": "recovered",
                "candidates": candidates,
            },
        )

    cases = {
        "provenance-smuggle": [
            {**_candidates(camp, 1)[0], "source_commit": "b" * 40},
        ],
        "bad-kind": [{**_candidates(camp, 1)[0], "kind": "summary"}],
        "wrong-prefix": [{**_candidates(camp, 1)[0], "assertion_id": "mem-x-t9-c1"}],
        "duplicate-id": [_candidates(camp, 1)[0], _candidates(camp, 1)[0]],
    }
    snapshot_after: dict[str, bytes] | None = None
    for label, candidates in cases.items():
        # Neutralize duplicate-id case by making ids distinct-ish but keep
        # grammar violations for the rest.
        result = probe(label, candidates)
        assert result["ok"] is False, (label, result)
        assert result["error"]["code"] == "invalid_param", (label, result)
        latest = coc_temporal_memory.load_backlog(camp)[_backlog_id(1)]
        assert latest["status"] == "pending", label
        assert _assertion_copies(camp) == {}, label
        jobs_dir = camp / "memory" / "temporal" / "extraction-jobs"
        assert not jobs_dir.exists() or not list(jobs_dir.iterdir()), label

    unknown_entry = _run(
        ws,
        SETTLE_TOOL,
        {
            "decision_id": "probe-unknown",
            "backlog_id": "backlog-nope-t1-extract",
            "disposition": "recovered",
            "candidates": _candidates(camp, 1),
        },
    )
    assert unknown_entry["ok"] is False
    assert unknown_entry["error"]["code"] == "invalid_state"


def test_recover_rejects_reason_and_empty_candidates_parametrized(ws):
    camp = ws["campaign_dir"]
    _seed_backlog(camp, 1)
    base = {
        "decision_id": "recover-shape",
        "backlog_id": _backlog_id(1),
        "disposition": "recovered",
    }
    with_reason = _run(ws, SETTLE_TOOL, {**base, "reason": "不是放弃", "candidates": _candidates(camp, 1)})
    assert with_reason["ok"] is False
    assert with_reason["error"]["code"] == "invalid_param"

    empty_candidates = _run(
        ws, SETTLE_TOOL, {**base, "candidates": []}
    )
    assert empty_candidates["ok"] is False
    assert empty_candidates["error"]["code"] == "invalid_param"

    missing_candidates = _run(ws, SETTLE_TOOL, base)
    assert missing_candidates["ok"] is False
    assert missing_candidates["error"]["code"] == "invalid_param"

    bad_disposition = _run(
        ws,
        SETTLE_TOOL,
        {**base, "disposition": "promote", "candidates": _candidates(camp, 1)},
    )
    assert bad_disposition["ok"] is False
    assert bad_disposition["error"]["code"] == "invalid_param"
    assert coc_temporal_memory.load_backlog(camp)[_backlog_id(1)]["status"] == "pending"


def test_decision_fingerprint_misuse_fails_closed_across_dispositions(ws):
    camp = ws["campaign_dir"]
    _seed_backlog(camp, 1)
    args = _recovered_args(camp, 1, "settle-fp-1")
    first = _run(ws, SETTLE_TOOL, args)
    assert first["ok"] is True, first

    reused_abandoned = _run(
        ws,
        SETTLE_TOOL,
        {
            "decision_id": "settle-fp-1",
            "backlog_id": _backlog_id(1),
            "disposition": "abandoned",
            "reason": "改主意改为放弃。",
        },
    )
    assert reused_abandoned["ok"] is False
    assert reused_abandoned["error"]["code"] == "idempotency_conflict"

    reused_candidates = _run(
        ws,
        SETTLE_TOOL,
        {
            **args,
            "candidates": [
                {**args["candidates"][0], "statement": "漂移后的表述。"},
            ],
        },
    )
    assert reused_candidates["ok"] is False
    assert reused_candidates["error"]["code"] == "idempotency_conflict"

    # The settled state is untouched by every rejected reuse.
    assert (
        coc_temporal_memory.load_backlog(camp)[_backlog_id(1)]["status"]
        == "recovered"
    )
    copies = _assertion_copies(camp)
    assert all(count == 1 for count in copies.values())


# --------------------------------------------------------------------------- #
# memory.extraction_settle — abandoned
# --------------------------------------------------------------------------- #

def test_abandon_preserves_candidate_data_and_is_single_shot(ws):
    camp = ws["campaign_dir"]
    _seed_backlog(camp, 1)
    episode = coc_temporal_memory.load_episodes(camp)[
        contract.episode_id_for(CAMPAIGN, "tl-main", 1)
    ]

    args = {
        "decision_id": "settle-abandon-1",
        "backlog_id": _backlog_id(1),
        "disposition": "abandoned",
        "reason": "该回合无可提炼的记忆：纯等待场景。",
    }
    first = _run(ws, SETTLE_TOOL, args)
    assert first["ok"] is True, first
    receipt = first["data"]
    assert receipt["disposition"] == "abandoned"
    assert receipt["status"] == "abandoned"
    assert receipt["reason"] == "该回合无可提炼的记忆：纯等待场景。"
    assert receipt["materialized_count"] == 0
    assert receipt["assertion_ids"] == []
    assert coc_temporal_memory.load_backlog(camp)[_backlog_id(1)]["status"] == "abandoned"

    # Candidate/episode data stays byte-intact; nothing was ever deleted.
    assert coc_temporal_memory.load_episodes(camp)[episode["episode_id"]] == episode
    assert not (camp / "memory" / "temporal" / "extraction-jobs").exists()

    # Ledger-level replay returns the previous receipt.
    replay = _run(ws, SETTLE_TOOL, args)
    assert replay["ok"] is True
    assert replay["data"] == receipt
    assert any(
        "duplicate decision_id" in warning for warning in replay["warnings"]
    )

    # A settled entry never moves again under either disposition.
    again_abandon = _run(
        ws,
        SETTLE_TOOL,
        {
            "decision_id": "settle-abandon-2",
            "backlog_id": _backlog_id(1),
            "disposition": "abandoned",
            "reason": "再次放弃。",
        },
    )
    assert again_abandon["ok"] is False
    assert again_abandon["error"]["code"] == "invalid_state"
    recover_late = _run(
        ws, SETTLE_TOOL, _recovered_args(camp, 1, "settle-abandon-3")
    )
    assert recover_late["ok"] is False
    assert recover_late["error"]["code"] == "invalid_state"


def test_abandon_requires_reason_and_forbids_candidates(ws):
    camp = ws["campaign_dir"]
    _seed_backlog(camp, 1)
    missing_reason = _run(
        ws,
        SETTLE_TOOL,
        {
            "decision_id": "abandon-shape-1",
            "backlog_id": _backlog_id(1),
            "disposition": "abandoned",
        },
    )
    assert missing_reason["ok"] is False
    assert missing_reason["error"]["code"] == "invalid_param"

    with_candidates = _run(
        ws,
        SETTLE_TOOL,
        {
            "decision_id": "abandon-shape-2",
            "backlog_id": _backlog_id(1),
            "disposition": "abandoned",
            "reason": "带着候选也是无效的。",
            "candidates": _candidates(camp, 1),
        },
    )
    assert with_candidates["ok"] is False
    assert with_candidates["error"]["code"] == "invalid_param"

    assert coc_temporal_memory.load_backlog(camp)[_backlog_id(1)]["status"] == "pending"
    assert _assertion_copies(camp) == {}


# --------------------------------------------------------------------------- #
# Privacy projection of materialized rows (keeper view)
# --------------------------------------------------------------------------- #

def test_privacy_projection_over_materialized_candidates(ws):
    camp = ws["campaign_dir"]
    _seed_backlog(camp, 1)
    prefix = f"mem-{CAMPAIGN}-t1-c"
    party = contract.subject_id_for("party", CAMPAIGN, "")
    args = {
        "decision_id": "settle-privacy-1",
        "backlog_id": _backlog_id(1),
        "disposition": "recovered",
        "candidates": [
            {
                "assertion_id": f"{prefix}1",
                "kind": "knowledge",
                "subject_id": party,
                "knowers": [party],
                "privacy": "player_safe",
                "state": "accurate",
                "statement": "公开线索：日记缺页。",
                "valid_from_turn": 1,
            },
            {
                "assertion_id": f"{prefix}2",
                "kind": "belief",
                "subject_id": party,
                "knowers": [party],
                "privacy": "keeper_only",
                "state": "accurate",
                "statement": "幕后真相：Corbitt 仍在地下室。",
                "valid_from_turn": 1,
            },
        ],
    }
    settled = _run(ws, SETTLE_TOOL, args)
    assert settled["ok"] is True, settled

    retrieval = coc_temporal_retrieval
    assertions = list(coc_temporal_memory.load_assertions(camp).values())
    subjects = list(coc_temporal_memory.load_subjects(camp).values())
    projected = {}
    for view in ("keeper", "player_safe"):
        context = retrieval.build_recall_context(
            subject_id=None,
            timeline_id="tl-main",
            turn_number=None,
            entities=[],
            scene_id=None,
            privacy=view,
            campaign_id=CAMPAIGN,
            kinds=[],
            include_superseded=False,
            limit=24,
            identity_bindings=subjects,
        )
        envelope = retrieval.build_warm_projection(assertions, context)
        projected[view] = envelope
    keeper_ids = {row["assertion_id"] for row in projected["keeper"]["candidates"]}
    player_ids = {
        row["assertion_id"] for row in projected["player_safe"]["candidates"]
    }
    assert f"{prefix}1" in keeper_ids and f"{prefix}1" in player_ids
    assert f"{prefix}2" in keeper_ids
    assert f"{prefix}2" not in player_ids
    # keeper_only materializes at its declared tier verbatim.
    assert (
        coc_temporal_memory.load_assertions(camp)[f"{prefix}2"]["privacy"]
        == "keeper_only"
    )


# --------------------------------------------------------------------------- #
# Facade regressions: the smallest sanctioned APIs
# --------------------------------------------------------------------------- #

def test_facade_load_backlog_read_and_transition_rules(ws):
    camp = ws["campaign_dir"]
    _seed_backlog(camp, 4)
    backlog_id = _backlog_id(4)

    history_path = camp / "memory" / "temporal" / "backlog.jsonl"
    assert len(history_path.read_text(encoding="utf-8").splitlines()) == 1

    updated = coc_temporal_memory.settle_backlog(
        camp, backlog_id, status="abandoned"
    )
    assert updated["status"] == "abandoned"
    # Append-only: both generations stay on disk.
    rows = coc_temporal_memory._read_jsonl(history_path)
    assert [row["status"] for row in rows if row["backlog_id"] == backlog_id] == [
        "pending", "abandoned",
    ]

    with pytest.raises(coc_temporal_memory.TemporalMemoryError):
        coc_temporal_memory.settle_backlog(camp, backlog_id, status="recovered")
    with pytest.raises(coc_temporal_memory.TemporalMemoryError, match="unknown|not found"):
        coc_temporal_memory.settle_backlog(camp, "backlog-x-t99-extract", status="recovered")
    with pytest.raises(coc_temporal_memory.TemporalMemoryError):
        coc_temporal_memory.settle_backlog(camp, backlog_id, status="pending")


def test_recovery_flow_reports_explicit_zero_against_wrapped_up_backlog(ws):
    """After every entry settles, pending_count reaches an explicit zero."""
    camp = ws["campaign_dir"]
    _seed_backlog(camp, 1)
    _seed_backlog(camp, 2)
    assert _run(ws, SETTLE_TOOL, _recovered_args(camp, 1, "wrap-1"))["ok"] is True
    abandon = _run(
        ws,
        SETTLE_TOOL,
        {
            "decision_id": "wrap-2",
            "backlog_id": _backlog_id(2),
            "disposition": "abandoned",
            "reason": "无记忆可留。",
        },
    )
    assert abandon["ok"] is True
    status = _run(ws, STATUS_TOOL)
    assert status["data"]["count"] == 2
    assert status["data"]["pending_count"] == 0
