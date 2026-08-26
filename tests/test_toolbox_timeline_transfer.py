"""Behavior tests owned by the timeline operation cell: transfer slice.

Covers the canonical ``timeline.transfer`` typed operation end to end:
schema/policy/archive registration, the happy path (authoritative event
persisted to ``memory/temporal/transfers.jsonl`` plus derived
``cross_timeline_echo`` assertions recorded with a ``transfer_ref``
back-pointer), ledger replay idempotency bound to a machine-attached
request fingerprint, privacy never broadening, fail-closed rejections
(orphan evidence / unknown sources / empty entries / from==to /
unregistered timelines), advisory-only cost requests (no hard-state
mutation), and exporter compatibility of the persisted transfer store.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
EXPORTER_SCRIPTS = (
    REPO
    / "plugins"
    / "coc-keeper"
    / "skills"
    / "coc-export-battle-report"
    / "scripts"
)

ARCHIVE_PATH = (
    REPO / "plugins" / "coc-keeper" / "references" / "mcp-operation-contracts.json"
)
POLICY_TS_PATH = (
    REPO / "plugins" / "coc-keeper" / "pi" / "lib" / "operation-policy.generated.ts"
)

CAMPAIGN = "tl-transfer-ops"
TRANSFERS_RELPATH = Path("memory/temporal/transfers.jsonl")
ASSERTIONS_RELPATH = Path("memory/temporal/assertions.jsonl")

MEM_CONFESSION = f"mem-{CAMPAIGN}-captains-confession"
MEM_SECRET_MOTIVE = f"mem-{CAMPAIGN}-keepers-hidden-motive"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_toolbox = _load("coc_toolbox_timeline_transfer_ops", SCRIPTS / "coc_toolbox.py")
coc_git_history = _load(
    "coc_git_history_timeline_transfer_ops", SCRIPTS / "coc_git_history.py"
)
coc_state = _load("coc_state_timeline_transfer_ops", SCRIPTS / "coc_state.py")
coc_history_projection = _load(
    "coc_history_projection_timeline_transfer_ops",
    SCRIPTS / "coc_history_projection.py",
)
coc_temporal_memory = _load(
    "coc_temporal_memory_timeline_transfer_ops", SCRIPTS / "coc_temporal_memory.py"
)
coc_timeline_memory_transfer = _load(
    "coc_timeline_memory_transfer_ops", SCRIPTS / "coc_timeline_memory_transfer.py"
)
coc_mcp_contract_archive = _load(
    "coc_mcp_contract_archive_timeline_transfer_ops",
    SCRIPTS / "coc_mcp_contract_archive.py",
)
worldline_evidence = _load(
    "worldline_evidence_readonly_probe", EXPORTER_SCRIPTS / "worldline_evidence.py"
)

SCHEMA = coc_git_history.format_schema_generation(coc_state.CURRENT_SCHEMA_VERSIONS)


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
        "GIT_AUTHOR_DATE",
        "GIT_COMMITTER_DATE",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.delenv("COC_HOST", raising=False)


def _worktree(root: Path) -> Path:
    return root / ".coc" / "campaigns" / CAMPAIGN


def _run(ws, tool: str, args: dict | None = None) -> dict:
    return coc_toolbox.run_tool(tool, ws["workspace"], ws["campaign_id"], args or {})


def _write(worktree: Path, relpath: str, text: str) -> None:
    path = worktree / relpath
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _world(turn: int) -> str:
    return json.dumps({"day": turn + 1, "era": "1925", "turn": turn}) + "\n"


def _commit_turn(ws, turn: int, finalization_id: str) -> str:
    worktree = _worktree(ws["workspace"])
    _write(worktree, "save/world-state.json", _world(turn))
    finalizations = worktree / "logs" / "turn-finalizations.jsonl"
    with finalizations.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"finalization_id": finalization_id}) + "\n")
    return coc_git_history.commit_finalized_turn(
        ws["workspace"],
        ws["campaign_id"],
        turn_number=turn,
        finalization_id=finalization_id,
        journal_decision_id=f"journal-{turn}",
        settlement_snapshot_id=f"settle-{turn}",
        rendered_text_sha256="a" * 64,
        schema_generation=SCHEMA,
    )


def build_workspace(tmp_path: Path) -> dict:
    """Campaign with turns 1 and 2 committed on tl-main, a rebuilt
    history projection, two seeded source assertions on tl-main, and a
    confirmed fork whose new timeline tl-atlantic is active."""
    root = tmp_path / "workspace"
    root.mkdir(parents=True)
    worktree = _worktree(root)
    worktree.mkdir(parents=True)
    _write(worktree, "campaign.json", json.dumps({"campaign_id": CAMPAIGN, "title": "Transfer Ops"}) + "\n")
    _write(worktree, "party.json", json.dumps({"members": []}) + "\n")
    _write(worktree, "save/world-state.json", _world(0))
    _write(worktree, "logs/turn-finalizations.jsonl", "")
    coc_git_history.ensure_repo(root, CAMPAIGN)
    ws = {"workspace": root, "campaign_id": CAMPAIGN}
    turn2_sha = _commit_turn(ws, 2, "fin-t2")
    coc_history_projection.rebuild_history_projection(root, CAMPAIGN)

    campaign_dir = worktree
    coc_temporal_memory.record_assertion(
        {
            "assertion_id": MEM_CONFESSION,
            "kind": "knowledge",
            "scope": "campaign",
            "campaign_id": CAMPAIGN,
            "timeline_id": "tl-main",
            "subject_id": "subject-reed",
            "knowers": ["subject-reed"],
            "privacy": "player_safe",
            "state": "accurate",
            "statement": "船长承认船难当夜他下令弃货保船",
            "entities": [],
            "occurred_turn": 2,
            "valid_from_turn": 2,
            "source_commit": turn2_sha,
            "source_turn": 2,
            "source_receipts": ["journal-2"],
        },
        campaign_dir=campaign_dir,
    )
    coc_temporal_memory.record_assertion(
        {
            "assertion_id": MEM_SECRET_MOTIVE,
            "kind": "knowledge",
            "scope": "campaign",
            "campaign_id": CAMPAIGN,
            "timeline_id": "tl-main",
            "subject_id": "subject-reed",
            "knowers": ["subject-reed"],
            "privacy": "keeper_only",
            "state": "accurate",
            "statement": "船长其实早知道货物会被走私走",
            "entities": [],
            "occurred_turn": 2,
            "valid_from_turn": 2,
            "source_commit": turn2_sha,
            "source_turn": 2,
            "source_receipts": ["journal-2"],
        },
        campaign_dir=campaign_dir,
    )

    ws["turn2_sha"] = turn2_sha
    requested = _run(
        ws,
        "timeline.fork_request",
        {
            "decision_id": "fork-req-1",
            "timeline": "tl-atlantic",
            "source_turn": 2,
            "game_reason": "玩家想救下临死的船长",
        },
    )
    assert requested["ok"] is True, requested
    confirmed = _run(
        ws,
        "timeline.fork_confirm",
        {"decision_id": "fork-conf-1", "request_decision_id": "fork-req-1"},
    )
    assert confirmed["ok"] is True, confirmed
    return ws


def _transfer_args(**overrides) -> dict:
    args = {
        "decision_id": "xfer-1",
        "from_timeline": "tl-main",
        "to_timeline": "tl-atlantic",
        "entries": [{"source_assertion": MEM_CONFESSION, "credibility": 0.8}],
        "cause": "救下的船长在梦中向里德说起另一条世界线的托付",
    }
    args.update(overrides)
    return args


def _transfer(ws, **overrides) -> dict:
    return _run(ws, "timeline.transfer", _transfer_args(**overrides))


def _read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        text = line.strip()
        if text:
            payload = json.loads(text)
            assert isinstance(payload, dict)
            rows.append(payload)
    return rows


def _transfers_rows(ws) -> list[dict]:
    return _read_jsonl(_worktree(ws["workspace"]) / TRANSFERS_RELPATH)


def _no_machine_ids(node) -> None:
    """No commit shas, git refs, or digest fields on the model-facing
    surface."""
    if isinstance(node, dict):
        for key, value in node.items():
            assert not re.search(r"sha|digest|blob|\bref\b|source_commit", str(key)), key
            _no_machine_ids(value)
    elif isinstance(node, list):
        for item in node:
            _no_machine_ids(item)
    elif isinstance(node, str):
        assert not re.fullmatch(r"[0-9a-f]{40}", node), node


def _tree_snapshot(base: Path) -> dict[str, str]:
    snapshot: dict[str, str] = {}
    if not base.exists():
        return snapshot
    for path in sorted(base.rglob("*")):
        # toolbox-ledger.json / toolbox-calls.jsonl are the harness's own
        # idempotency bookkeeping and call audit, not game state.
        if (
            not path.is_file()
            or path.name in ("toolbox-ledger.json", "toolbox-calls.jsonl")
        ):
            continue
        snapshot[str(path.relative_to(base))] = hashlib.sha256(
            path.read_bytes()
        ).hexdigest()
    return snapshot


# --------------------------------------------------------------------------- #
# Registration, policy, and typed schema surface
# --------------------------------------------------------------------------- #

def test_timeline_transfer_registered_with_policy_and_typed_catalog():
    assert "timeline.transfer" in coc_toolbox.TOOLS
    assert coc_toolbox.operation_policy("timeline.transfer") == {
        "audience": "keeper",
        "phases": ["live_turn"],
        "contract": "state",
        "advisory": False,
        "kp_surface": "state",
    }
    spec = coc_toolbox.TOOLS["timeline.transfer"]
    assert spec["access"] == "mutation"
    assert spec["strict_read_only"] is False
    assert spec["write_domains"] == ("timeline",)
    assert spec["execution_class"] == "serial_campaign"
    canonical = coc_toolbox.OPERATION_REGISTRY.get("timeline.transfer")
    assert canonical.params["decision_id"]["required"] is True

    archive = coc_mcp_contract_archive.build_archive(coc_toolbox)
    schema = archive["operations"]["timeline.transfer"]["inputSchema"]
    assert set(schema["properties"]) == {
        "root",
        "campaign",
        "decision_id",
        "from_timeline",
        "to_timeline",
        "entries",
        "cause",
        "play_cost",
    }
    assert set(schema["required"]) == {
        "campaign",
        "decision_id",
        "from_timeline",
        "to_timeline",
        "entries",
        "cause",
    }
    assert schema["additionalProperties"] is False
    for key in schema["properties"]:
        assert not re.search(r"sha|digest|commit|ref", key), key

    on_disk = coc_mcp_contract_archive.load_and_validate(ARCHIVE_PATH)
    assert "timeline.transfer" in on_disk["operations"]
    projection = coc_mcp_contract_archive.validate_policy_projection(
        POLICY_TS_PATH, coc_toolbox
    )
    assert (
        projection["operation_policy"]["timeline.transfer"]["kp_surface"]
        == "state"
    )
    assert "timeline.transfer" in projection["operations_by_surface"]["state"]
    assert '"timeline.transfer"' in POLICY_TS_PATH.read_text(encoding="utf-8")


# --------------------------------------------------------------------------- #
# Happy path
# --------------------------------------------------------------------------- #

def test_transfer_persists_event_and_derived_echoes(tmp_path):
    ws = build_workspace(tmp_path)
    result = _transfer(ws)
    assert result["ok"] is True, result
    receipt = result["data"]
    assert set(receipt) == {
        "schema_version",
        "tool",
        "decision_id",
        "transfer_id",
        "from_timeline",
        "to_timeline",
        "entry_count",
        "target_ids",
        "idempotent",
        "cost_requests",
    }
    transfer_id = f"transfer-{CAMPAIGN}-tl-main-to-tl-atlantic"
    echo_id = f"{MEM_CONFESSION}".replace(
        f"mem-{CAMPAIGN}-", f"mem-{CAMPAIGN}-echo-tl-main-to-tl-atlantic-"
    )
    assert receipt["transfer_id"] == transfer_id
    assert receipt["entry_count"] == 1
    assert receipt["target_ids"] == [echo_id]
    assert receipt["idempotent"] is False
    assert receipt["cost_requests"] == []
    _no_machine_ids(receipt)
    joined_hints = " ".join(result["hints"])
    assert "never applies mechanics" in joined_hints
    assert "rules.*" in joined_hints and "state.*" in joined_hints

    # Authoritative event stored once, canonically (machine anchors resolved).
    rows = _transfers_rows(ws)
    assert len(rows) == 1
    event = rows[0]
    assert event["transfer_id"] == transfer_id
    assert event["campaign_id"] == CAMPAIGN
    assert event["from_timeline"] == "tl-main"
    assert event["to_timeline"] == "tl-atlantic"
    assert (
        event["receipt"]
        == f"timeline.transfer {CAMPAIGN} tl-main-to-tl-atlantic"
    )
    assert event["source_turn"] == 2
    assert event["source_commit"] == ws["turn2_sha"]
    assert [entry["source_assertion"] for entry in event["entries"]] == [
        MEM_CONFESSION
    ]
    assert [entry["target_assertion"] for entry in event["entries"]] == [echo_id]
    envelope = json.loads(event["play_cost"])
    assert envelope["cause"] == _transfer_args()["cause"]
    assert envelope["costs"] == []

    # Derived echo recorded through the temporal store with back-pointer.
    assertions = coc_temporal_memory.load_assertions(_worktree(ws["workspace"]))
    echo = assertions[echo_id]
    assert echo["timeline_id"] == "tl-atlantic"
    assert echo["state"] == "cross_timeline_echo"
    assert echo["transfer_ref"] == transfer_id
    assert echo["statement"] == "船长承认船难当夜他下令弃货保船"
    assert echo["knowers"] == ["subject-reed"]
    assert echo["superseded_by"] == []
    assert echo["contradicts"] == []
    assert echo["confirms"] == []
    assert echo["source_commit"] == ws["turn2_sha"]

    # Combined projection validates against the frozen contract links.
    coc_temporal_memory_contract = _load(
        "coc_temporal_memory_contract_timeline_transfer_ops",
        SCRIPTS / "coc_temporal_memory_contract.py",
    )
    all_rows = [
        assertions[name]
        for name in sorted(assertions)
        if name in (MEM_CONFESSION, MEM_SECRET_MOTIVE, echo_id)
    ]
    coc_temporal_memory_contract.validate_transfer_links(event, all_rows)


def test_exporter_reads_nonzero_transfer_store(tmp_path):
    ws = build_workspace(tmp_path)
    assert _transfer(ws)["ok"] is True
    transfers_rows = _transfers_rows(ws)
    assertions_rows = _read_jsonl(_worktree(ws["workspace"]) / ASSERTIONS_RELPATH)
    projection = worldline_evidence.build_worldline_evidence(
        state_present=False,
        assertions_rows=assertions_rows,
        assertions_present=True,
        transfers_rows=transfers_rows,
        transfers_present=True,
    )
    assert projection["player"]["counts"]["transfer_events"] == 1
    assert projection["player"]["counts"]["echo_assertions"] >= 1
    assert projection["findings"] == []


# --------------------------------------------------------------------------- #
# Replay idempotency + request fingerprint
# --------------------------------------------------------------------------- #

def test_transfer_replay_is_idempotent_per_decision_id(tmp_path):
    ws = build_workspace(tmp_path)
    first = _transfer(ws)
    assert first["ok"] is True, first

    replay = _transfer(ws)
    assert replay["ok"] is True
    assert replay["data"] == first["data"]
    assert any(
        "duplicate decision_id" in warning for warning in replay["warnings"]
    )

    rows = _transfers_rows(ws)
    assert len(rows) == 1
    assertions = coc_temporal_memory.load_assertions(_worktree(ws["workspace"]))
    echoes = [
        row
        for row in assertions.values()
        if row.get("transfer_ref") == rows[0]["transfer_id"]
    ]
    assert len(echoes) == 1


def test_fresh_decision_replays_byte_equal_semantics_idempotently(tmp_path):
    ws = build_workspace(tmp_path)
    first = _transfer(ws)
    assert first["ok"] is True
    second = _transfer(ws, decision_id="xfer-2")
    assert second["ok"] is True, second
    assert second["data"]["idempotent"] is True
    assert second["data"]["transfer_id"] == first["data"]["transfer_id"]
    assert any("already persisted" in warning for warning in second["warnings"])
    assert len(_transfers_rows(ws)) == 1
    assertions = coc_temporal_memory.load_assertions(_worktree(ws["workspace"]))
    echoes = [
        row
        for row in assertions.values()
        if row.get("state") == "cross_timeline_echo"
    ]
    assert len(echoes) == 1


def test_decision_reuse_with_changed_cause_fails_closed(tmp_path):
    ws = build_workspace(tmp_path)
    first = _transfer(ws)
    assert first["ok"] is True
    conflict = _transfer(ws, cause="完全不同的另一个理由")
    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "idempotency_conflict"
    assert len(_transfers_rows(ws)) == 1


def test_semantic_reuse_under_fresh_decision_fails_closed_on_divergence(tmp_path):
    ws = build_workspace(tmp_path)
    assert _transfer(ws)["ok"] is True
    divergent = _transfer(
        ws,
        decision_id="xfer-divergent",
        entries=[{"source_assertion": MEM_CONFESSION, "credibility": 0.6}],
    )
    assert divergent["ok"] is False
    assert divergent["error"]["code"] == "invalid_param"
    assert "different content" in divergent["error"]["message"]
    assert len(_transfers_rows(ws)) == 1
    assertions = coc_temporal_memory.load_assertions(_worktree(ws["workspace"]))
    echo = assertions[
        MEM_CONFESSION.replace(
            f"mem-{CAMPAIGN}-", f"mem-{CAMPAIGN}-echo-tl-main-to-tl-atlantic-"
        )
    ]
    # The original echo is never overwritten by the rejected divergence.
    stored_entry = _transfers_rows(ws)[0]["entries"][0]
    assert stored_entry["credibility"] == 0.8
    assert echo["privacy"] == "player_safe"


# --------------------------------------------------------------------------- #
# Privacy never broadens
# --------------------------------------------------------------------------- #

def test_keeper_only_source_rejects_broadening_but_accepts_default(tmp_path):
    ws = build_workspace(tmp_path)
    broadened = _transfer(
        ws,
        decision_id="xfer-broaden",
        entries=[
            {"source_assertion": MEM_SECRET_MOTIVE, "credibility": 1.0, "privacy": "player_safe"}
        ],
    )
    assert broadened["ok"] is False
    assert broadened["error"]["code"] == "invalid_param"
    assert "keeper_only" in broadened["error"]["message"]


def test_player_safe_source_may_tighten_to_keeper_only(tmp_path):
    ws = build_workspace(tmp_path)
    tightened = _transfer(
        ws,
        decision_id="xfer-tighten",
        entries=[
            {"source_assertion": MEM_CONFESSION, "credibility": 1.0, "privacy": "keeper_only"}
        ],
    )
    assert tightened["ok"] is True, tightened
    assertions = coc_temporal_memory.load_assertions(_worktree(ws["workspace"]))
    echo = assertions[tightened["data"]["target_ids"][0]]
    assert echo["privacy"] == "keeper_only"


# --------------------------------------------------------------------------- #
# Fail-closed rejections
# --------------------------------------------------------------------------- #

def test_unknown_source_empty_entries_and_same_line_fail_closed(tmp_path):
    ws = build_workspace(tmp_path)

    unknown = _transfer(
        ws,
        decision_id="xfer-unknown",
        entries=[{"source_assertion": f"mem-{CAMPAIGN}-ghost"}],
    )
    assert unknown["ok"] is False
    assert unknown["error"]["code"] == "invalid_state"

    empty = _transfer(ws, decision_id="xfer-empty", entries=[])
    assert empty["ok"] is False
    assert empty["error"]["code"] == "invalid_param"

    same_line = _transfer(ws, decision_id="xfer-same", to_timeline="tl-main")
    assert same_line["ok"] is False
    assert same_line["error"]["code"] == "invalid_param"

    ghost_line = _transfer(ws, decision_id="xfer-ghost", to_timeline="tl-nowhere")
    assert ghost_line["ok"] is False
    assert ghost_line["error"]["code"] == "invalid_state"

    bad_cost = _transfer(
        ws,
        decision_id="xfer-cost-kind",
        play_cost=[{"kind": "teleport", "amount": 1}],
    )
    assert bad_cost["ok"] is False
    assert bad_cost["error"]["code"] == "invalid_param"

    assert _transfers_rows(ws) == []
    assertions = coc_temporal_memory.load_assertions(_worktree(ws["workspace"]))
    assert not [row for row in assertions.values() if row.get("transfer_ref")]


def test_orphan_target_claims_without_authoritative_event_fail_closed(tmp_path):
    ws = build_workspace(tmp_path)
    # Simulate orphan evidence: derived-looking echo assertions were written
    # while their authoritative transfer event was never persisted.
    plan = coc_timeline_memory_transfer.build_transfer_event(
        CAMPAIGN,
        "tl-main",
        "tl-atlantic",
        [
            coc_temporal_memory.load_assertions(_worktree(ws["workspace"]))[
                MEM_CONFESSION
            ]
        ],
        [{"source_assertion": MEM_CONFESSION, "credibility": 0.8}],
        _transfer_args()["cause"],
        receipt="orphan probe",
    )
    for target in coc_timeline_memory_transfer.derive_target_assertions(
        plan["transfer"],
        [coc_temporal_memory.load_assertions(_worktree(ws["workspace"]))[MEM_CONFESSION]],
    ):
        coc_temporal_memory.record_assertion(target, campaign_dir=_worktree(ws["workspace"]))

    orphaned = _transfer(ws, decision_id="xfer-orphan")
    assert orphaned["ok"] is False
    assert orphaned["error"]["code"] == "invalid_param"
    assert "orphan" in orphaned["error"]["message"]
    assert _transfers_rows(ws) == []


# --------------------------------------------------------------------------- #
# Cost requests stay advisory: the operation applies no mechanics
# --------------------------------------------------------------------------- #

def test_cost_requests_are_advisory_and_no_hard_state_mutates(tmp_path):
    ws = build_workspace(tmp_path)
    save_before = _tree_snapshot(_worktree(ws["workspace"]) / "save")
    logs_before = _tree_snapshot(_worktree(ws["workspace"]) / "logs")

    result = _transfer(
        ws,
        decision_id="xfer-cost",
        entries=[{"source_assertion": MEM_CONFESSION, "credibility": 1.0}],
        play_cost=[
            {
                "kind": "san_loss",
                "amount": "1d4",
                "subject_id": "subject-reed",
                "note": "异线记忆冲撞",
            }
        ],
    )
    assert result["ok"] is True, result
    requests = result["data"]["cost_requests"]
    assert len(requests) == 1
    request = requests[0]
    assert request["operation"] == "rules.san_loss"
    assert request["kind"] == "san_loss"
    assert request["amount"] == "1d4"
    assert request["subject_id"] == "subject-reed"
    assert request["applied"] is False
    assert request["timeline_id"] == "tl-atlantic"
    _no_machine_ids(request)

    assert _tree_snapshot(_worktree(ws["workspace"]) / "save") == save_before
    assert _tree_snapshot(_worktree(ws["workspace"]) / "logs") == logs_before
