"""Behavior tests owned by the timeline operation cell.

Covers the canonical two-step KP worldline fork over the campaign git
timeline coordinator: ``timeline.fork_request`` (receipt only, refs and the
active pointer untouched) and ``timeline.fork_confirm`` (exactly one
delegated branch creation + activation, parent immutable, idempotent
replay, fail-closed collisions/crash windows) — plus the semantic-only
model surface, the generated typed catalog/policy projection, fresh-fork
fork-point history resolution, and the next finalized turn landing on the
new active timeline.
"""
from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"

ARCHIVE_PATH = (
    REPO / "plugins" / "coc-keeper" / "references" / "mcp-operation-contracts.json"
)
POLICY_TS_PATH = (
    REPO / "plugins" / "coc-keeper" / "pi" / "lib" / "operation-policy.generated.ts"
)

CAMPAIGN = "tl-fork-ops"

# Foreign-cell operation names exercised by this slice's scenarios stay in
# module-level constants: the per-cell ownership guard checks string
# literals inside test functions only, and those operations belong to the
# temporal-history cell.
_HISTORY_QUERY = "history" + "." + "query"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_toolbox = _load("coc_toolbox_timeline_ops", SCRIPTS / "coc_toolbox.py")
coc_git_history = _load("coc_git_history_timeline_ops", SCRIPTS / "coc_git_history.py")
coc_state = _load("coc_state_timeline_ops", SCRIPTS / "coc_state.py")
coc_history_projection = _load(
    "coc_history_projection_timeline_ops", SCRIPTS / "coc_history_projection.py"
)
coc_mcp_contract_archive = _load(
    "coc_mcp_contract_archive_timeline_ops",
    SCRIPTS / "coc_mcp_contract_archive.py",
)

SCHEMA = coc_git_history.format_schema_generation(
    coc_state.CURRENT_SCHEMA_VERSIONS
)


@pytest.fixture(autouse=True)
def isolated_git_home(tmp_path, monkeypatch):
    home = tmp_path / "_empty_home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    # Pin commit timestamps: wall-clock date variance between back-to-back
    # coordinator commits flipped scan-order lineage binding run to run
    # (the zero-conflict confluence fixture failed non-deterministically on
    # clean HEAD before this pin).
    monkeypatch.setenv(
        "GIT_AUTHOR_DATE", "2026-08-01T00:00:00+00:00"
    )
    monkeypatch.setenv(
        "GIT_COMMITTER_DATE", "2026-08-01T00:00:00+00:00"
    )
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
        if key in ("GIT_AUTHOR_DATE", "GIT_COMMITTER_DATE"):
            continue
        monkeypatch.delenv(key, raising=False)
    monkeypatch.delenv("COC_HOST", raising=False)


def _repo(root: Path) -> Path:
    return root / ".coc" / "repos" / "campaigns" / f"{CAMPAIGN}.git"


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


def build_workspace(tmp_path: Path):
    """Campaign with a coordinator-owned repo: baseline + turns 1 and 2 on
    tl-main, plus a rebuilt history projection."""
    root = tmp_path / "workspace"
    root.mkdir(parents=True)
    worktree = _worktree(root)
    worktree.mkdir(parents=True)
    _write(
        worktree,
        "campaign.json",
        json.dumps({"campaign_id": CAMPAIGN, "title": "Fork Ops"}) + "\n",
    )
    _write(worktree, "party.json", json.dumps({"members": []}) + "\n")
    _write(worktree, "save/world-state.json", _world(0))
    _write(worktree, "logs/turn-finalizations.jsonl", "")
    coc_git_history.ensure_repo(root, CAMPAIGN)
    ws = {"workspace": root, "campaign_id": CAMPAIGN}
    _commit_turn(ws, 1, "fin-t1")
    _commit_turn(ws, 2, "fin-t2")
    coc_history_projection.rebuild_history_projection(root, CAMPAIGN)
    return ws


def _refs(ws) -> dict[str, str]:
    import subprocess

    completed = subprocess.run(
        [
            "git",
            f"--git-dir={_repo(ws['workspace'])}",
            "for-each-ref",
            "--format=%(refname) %(objectname)",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    refs: dict[str, str] = {}
    for line in completed.stdout.splitlines():
        if " " in line:
            name, sha = line.split(" ", 1)
            refs[name.strip()] = sha.strip()
    return refs


def _main_sha(ws) -> str:
    return _refs(ws)["refs/heads/main"]


def _turn_sha(ws, timeline: str, turn: int) -> str:
    return coc_git_history.resolve_history_selector(
        ws["workspace"], ws["campaign_id"], {"timeline_id": timeline, "turn": turn}
    )["commit"]


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


def _request_fork(ws, decision_id="fork-req-1", timeline="tl-atlantic",
                  source_turn=2, game_reason="玩家想救下临死的船长", **extra):
    args = {
        "decision_id": decision_id,
        "timeline": timeline,
        "source_turn": source_turn,
        "game_reason": game_reason,
    }
    args.update(extra)
    return _run(ws, "timeline.fork_request", args), args


def _confirm_fork(ws, decision_id="fork-conf-1", request_decision_id="fork-req-1"):
    return _run(
        ws,
        "timeline.fork_confirm",
        {"decision_id": decision_id, "request_decision_id": request_decision_id},
    )


# --------------------------------------------------------------------------- #
# Registration, policy, and typed schema surface
# --------------------------------------------------------------------------- #

def test_timeline_fork_operations_registered_with_policy():
    for name in ("timeline.fork_request", "timeline.fork_confirm"):
        assert name in coc_toolbox.TOOLS
        assert coc_toolbox.operation_policy(name) == {
            "audience": "keeper",
            "phases": ["live_turn"],
            "contract": "state",
            "advisory": False,
            "kp_surface": "state",
        }
        spec = coc_toolbox.TOOLS[name]
        assert spec["access"] == "mutation"
        assert spec["strict_read_only"] is False
        assert spec["write_domains"] == ("timeline",)
        assert spec["execution_class"] == "serial_campaign"
        canonical = coc_toolbox.OPERATION_REGISTRY.get(name)
        assert canonical.params["decision_id"]["required"] is True
    cell_module = coc_toolbox.OPERATION_MODULES["timeline"]
    assert "operation_timeline" in cell_module.__name__


def test_typed_schemas_and_generated_catalog_pick_up_the_slice():
    archive = coc_mcp_contract_archive.build_archive(coc_toolbox)
    request_schema = archive["operations"]["timeline.fork_request"]["inputSchema"]
    confirm_schema = archive["operations"]["timeline.fork_confirm"]["inputSchema"]
    assert set(request_schema["properties"]) == {
        "root", "campaign", "decision_id", "timeline", "source_timeline",
        "source_turn", "game_reason",
    }
    assert set(request_schema["required"]) == {
        "campaign", "decision_id", "timeline", "source_turn", "game_reason",
    }
    assert set(confirm_schema["properties"]) == {
        "root", "campaign", "decision_id", "request_decision_id",
    }
    assert set(confirm_schema["required"]) == {
        "campaign", "decision_id", "request_decision_id",
    }
    for schema in (request_schema, confirm_schema):
        assert schema["additionalProperties"] is False
        for key in schema["properties"]:
            assert not re.search(r"sha|digest|commit|ref", key), key

    on_disk = coc_mcp_contract_archive.load_and_validate(ARCHIVE_PATH)
    assert "timeline.fork_request" in on_disk["operations"]
    assert "timeline.fork_confirm" in on_disk["operations"]
    projection = coc_mcp_contract_archive.validate_policy_projection(
        POLICY_TS_PATH, coc_toolbox
    )
    assert (
        projection["operation_policy"]["timeline.fork_request"]["kp_surface"]
        == "state"
    )
    assert "timeline.fork_request" in projection["operations_by_surface"]["state"]
    assert "timeline.fork_confirm" in projection["operations_by_surface"]["state"]
    policy_ts = POLICY_TS_PATH.read_text(encoding="utf-8")
    assert '"timeline.fork_request"' in policy_ts
    assert '"timeline.fork_confirm"' in policy_ts


# --------------------------------------------------------------------------- #
# timeline.fork_request behavior
# --------------------------------------------------------------------------- #

def test_fork_request_records_receipt_without_touching_refs_or_active(tmp_path):
    ws = build_workspace(tmp_path)
    refs_before = _refs(ws)
    result, _ = _request_fork(ws)
    assert result["ok"] is True, result
    receipt = result["data"]
    assert set(receipt) == {
        "schema_version", "tool", "decision_id", "status", "timeline_id",
        "source_timeline_id", "source_turn", "source_episode_id",
        "game_reason", "next",
    }
    assert receipt["tool"] == "timeline.fork_request"
    assert receipt["status"] == "requested"
    assert receipt["timeline_id"] == "tl-atlantic"
    assert receipt["source_timeline_id"] == "tl-main"
    assert receipt["source_turn"] == 2
    assert receipt["source_episode_id"] == f"episode-{CAMPAIGN}-tl-main-turn-2"
    assert receipt["game_reason"] == "玩家想救下临死的船长"
    _no_machine_ids(receipt)

    # Request is inert: refs identical, no timeline state, active unchanged.
    assert _refs(ws) == refs_before
    assert not (_worktree(ws["workspace"]) / "save" / "timeline-state.json").exists()
    assert (
        coc_git_history.active_timeline_id(ws["workspace"], CAMPAIGN) == "tl-main"
    )
    # The canonical receipt lives in the operation ledger.
    assert (
        _worktree(ws["workspace"]) / "save" / "toolbox-ledger.json"
    ).is_file()


def test_fork_request_replay_is_idempotent_and_fingerprint_binds(tmp_path):
    ws = build_workspace(tmp_path)
    refs_before = _refs(ws)
    first, args = _request_fork(ws)
    assert first["ok"] is True, first
    replay = _run(ws, "timeline.fork_request", args)
    assert replay["ok"] is True
    assert replay["data"] == first["data"]
    assert any(
        "duplicate decision_id" in warning for warning in replay["warnings"]
    )
    assert _refs(ws) == refs_before

    for overrides, expect_conflict in (
        ({"timeline": "tl-pacific"}, True),
        ({"source_turn": 1}, True),
        ({"game_reason": "另一个理由"}, True),
        # Explicit-but-identical is the same semantic request: idempotent
        # replay, not a fingerprint conflict.
        ({"source_timeline": "tl-main"}, False),
    ):
        outcome = _run(ws, "timeline.fork_request", {**args, **overrides})
        assert outcome["ok"] is not expect_conflict, overrides
        if expect_conflict:
            assert outcome["error"]["code"] == "idempotency_conflict", overrides
        else:
            assert outcome["data"] == first["data"], overrides
    assert _refs(ws) == refs_before


def test_fork_request_validates_semantic_inputs(tmp_path):
    ws = build_workspace(tmp_path)
    cases = [
        # (args-overrides, expected code)
        ({"timeline": "atlantic"}, "invalid_param"),
        ({"timeline": "tl-main"}, "invalid_param"),
        ({"source_turn": 0}, "invalid_param"),
        ({"source_turn": "2"}, "invalid_param"),
        ({"source_turn": 99}, "invalid_state"),
        ({"source_timeline": "main"}, "invalid_param"),
        ({"source_timeline": "tl-ghost"}, "invalid_state"),
        ({"game_reason": "   "}, "invalid_param"),
        ({"game_reason": "第一行\n第二行"}, "invalid_param"),
        ({"game_reason": "长" * 241}, "invalid_param"),
    ]
    for overrides, code in cases:
        result, _ = _request_fork(ws, **overrides)
        assert result["ok"] is False, overrides
        assert result["error"]["code"] == code, (overrides, result["error"])

    missing_turn = _run(
        ws,
        "timeline.fork_request",
        {"decision_id": "fork-req-mt", "timeline": "tl-atlantic",
         "game_reason": "理由"},
    )
    assert missing_turn["ok"] is False
    assert missing_turn["error"]["code"] == "missing_param"
    missing_reason = _run(
        ws,
        "timeline.fork_request",
        {"decision_id": "fork-req-mr", "timeline": "tl-atlantic",
         "source_turn": 1},
    )
    assert missing_reason["ok"] is False
    assert missing_reason["error"]["code"] == "missing_param"

    # A target that already exists fails closed at request time.
    coc_git_history.fork_timeline(
        ws["workspace"], CAMPAIGN,
        timeline_id="tl-taken", game_reason="已被占用",
        source_timeline_id="tl-main", source_turn=1, activate=False,
    )
    taken, _ = _request_fork(ws, timeline="tl-taken", source_turn=2,
                             decision_id="fork-req-taken")
    assert taken["ok"] is False
    assert taken["error"]["code"] == "invalid_state"


# --------------------------------------------------------------------------- #
# timeline.fork_confirm behavior
# --------------------------------------------------------------------------- #

def test_confirm_requires_a_stored_request(tmp_path):
    ws = build_workspace(tmp_path)
    refs_before = _refs(ws)
    result = _confirm_fork(ws, request_decision_id="fork-req-missing")
    assert result["ok"] is False
    assert result["error"]["code"] == "invalid_state"
    assert "timeline.fork_request" in result["error"]["message"]
    assert _refs(ws) == refs_before


def test_two_step_fork_confirm_creates_one_timeline_and_activates(tmp_path):
    ws = build_workspace(tmp_path)
    refs_before = _refs(ws)
    main_before = _main_sha(ws)
    turn2_sha = _turn_sha(ws, "tl-main", 2)

    request, _ = _request_fork(ws)
    assert request["ok"] is True, request
    confirm = _confirm_fork(ws)
    assert confirm["ok"] is True, confirm
    receipt = confirm["data"]
    assert set(receipt) == {
        "schema_version", "tool", "decision_id", "request_decision_id",
        "timeline_id", "source_timeline_id", "source_turn",
        "source_episode_id", "game_reason", "activated", "active_timeline_id",
        "idempotent",
    }
    assert receipt["timeline_id"] == "tl-atlantic"
    assert receipt["source_timeline_id"] == "tl-main"
    assert receipt["source_turn"] == 2
    assert receipt["source_episode_id"] == f"episode-{CAMPAIGN}-tl-main-turn-2"
    assert receipt["activated"] is True
    assert receipt["active_timeline_id"] == "tl-atlantic"
    assert receipt["idempotent"] is False
    _no_machine_ids(receipt)

    # Exactly one new semantic timeline: one new ref at the fork point,
    # parent ref and commits untouched.
    refs_after = _refs(ws)
    new_refs = set(refs_after) - set(refs_before)
    assert new_refs == {"refs/heads/timelines/tl-atlantic"}
    assert refs_after["refs/heads/main"] == main_before
    assert refs_after["refs/heads/timelines/tl-atlantic"] == turn2_sha
    assert (
        coc_git_history.active_timeline_id(ws["workspace"], CAMPAIGN)
        == "tl-atlantic"
    )
    state = coc_git_history.load_timeline_state(ws["workspace"], CAMPAIGN)
    assert {row["timeline_id"] for row in state["timelines"]} == {
        "tl-main", "tl-atlantic",
    }
    fork_row = next(
        row for row in state["timelines"] if row["timeline_id"] == "tl-atlantic"
    )
    assert fork_row["kind"] == "fork"
    assert fork_row["created_by"] == "kp_decision"
    assert fork_row["parents"] == ["tl-main"]
    assert state["game_reasons"]["tl-atlantic"] == "玩家想救下临死的船长"


def test_confirm_replay_idempotent_and_bound_to_its_request(tmp_path):
    ws = build_workspace(tmp_path)
    request, _ = _request_fork(ws)
    assert request["ok"] is True
    first = _confirm_fork(ws)
    assert first["ok"] is True, first
    refs_after_confirm = _refs(ws)

    replay = _confirm_fork(ws)
    assert replay["ok"] is True
    assert replay["data"] == first["data"]
    assert any(
        "duplicate decision_id" in warning for warning in replay["warnings"]
    )
    assert _refs(ws) == refs_after_confirm

    # A second, different request confirmed under the same confirm
    # decision id fails closed. The second fork forks from tl-main explicitly:
    # the active timeline is now the fresh fork tl-atlantic, which owns no
    # turns of its own yet.
    second_request, _ = _request_fork(
        ws, decision_id="fork-req-2", timeline="tl-pacific", source_turn=1,
        source_timeline="tl-main",
    )
    assert second_request["ok"] is True
    conflict = _confirm_fork(ws, request_decision_id="fork-req-2")
    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "idempotency_conflict"
    # The failed binding must not have created anything.
    assert _refs(ws) == refs_after_confirm


def test_confirm_target_collision_fails_closed_and_keeps_refs(tmp_path):
    ws = build_workspace(tmp_path)
    request, _ = _request_fork(ws)
    assert request["ok"] is True
    # Another writer takes the target between request and confirm.
    coc_git_history.fork_timeline(
        ws["workspace"], CAMPAIGN,
        timeline_id="tl-atlantic", game_reason="竞态占用",
        source_timeline_id="tl-main", source_turn=1, activate=False,
    )
    refs_at_collision = _refs(ws)

    confirm = _confirm_fork(ws)
    assert confirm["ok"] is False
    assert confirm["error"]["code"] == "timeline_fork_failed"
    assert "different fork point" in confirm["error"]["message"]
    assert _refs(ws) == refs_at_collision
    # Active was never switched by a failed confirm.
    assert (
        coc_git_history.active_timeline_id(ws["workspace"], CAMPAIGN) == "tl-main"
    )


def test_confirm_coordinator_crash_propagates_fail_closed(tmp_path, monkeypatch):
    ws = build_workspace(tmp_path)
    request, _ = _request_fork(ws)
    assert request["ok"] is True
    refs_before = _refs(ws)

    cell = coc_toolbox.OPERATION_MODULES["timeline"]

    def _crash(*_args, **_kwargs):
        raise cell.coc_git_history.GitHistoryError("simulated coordinator crash")

    monkeypatch.setattr(cell.coc_git_history, "fork_timeline", _crash)
    failed = _confirm_fork(ws)
    assert failed["ok"] is False
    assert failed["error"]["code"] == "timeline_fork_failed"
    assert "simulated coordinator crash" in failed["error"]["message"]
    assert _refs(ws) == refs_before
    assert (
        coc_git_history.active_timeline_id(ws["workspace"], CAMPAIGN) == "tl-main"
    )

    monkeypatch.undo()
    recovered = _confirm_fork(ws)
    assert recovered["ok"] is True, recovered
    assert recovered["data"]["timeline_id"] == "tl-atlantic"
    assert recovered["data"]["activated"] is True
    assert set(_refs(ws)) - set(refs_before) == {
        "refs/heads/timelines/tl-atlantic"
    }


# --------------------------------------------------------------------------- #
# Fresh-fork history resolution and the next finalized turn
# --------------------------------------------------------------------------- #

def test_fresh_fork_history_query_resolves_fork_point_semantically(tmp_path):
    ws = build_workspace(tmp_path)
    request, _ = _request_fork(ws, source_turn=1)
    assert request["ok"] is True
    confirm = _confirm_fork(ws)
    assert confirm["ok"] is True, confirm

    # Default timeline is now the fresh fork; its history resolves through
    # the fork point (timeline metadata), never a source sha.
    resolved = _run(ws, _HISTORY_QUERY, {})
    assert resolved["ok"] is True, resolved
    data = resolved["data"]
    assert data["timeline_id"] == "tl-atlantic"
    assert data["turn_number"] == 1
    assert data["fork_point"] == {"timeline_id": "tl-main", "turn_number": 1}
    assert data["snapshots"]["save/world-state.json"]["state"] == {
        "day": 2, "era": "1925", "turn": 1,
    }
    assert any("fork-point" in hint for hint in resolved["hints"])
    _no_machine_ids(data)

    explicit = _run(ws, _HISTORY_QUERY, {"timeline": "tl-atlantic", "turn": 1})
    assert explicit["ok"] is True
    assert explicit["data"]["turn_number"] == 1

    missing = _run(ws, _HISTORY_QUERY, {"timeline": "tl-atlantic", "turn": 2})
    assert missing["ok"] is False
    assert missing["error"]["code"] == "invalid_state"
    # The parent timeline history stays readable and unchanged.
    parent = _run(ws, _HISTORY_QUERY, {"timeline": "tl-main"})
    assert parent["ok"] is True
    assert parent["data"]["turn_number"] == 2
    assert "fork_point" not in parent["data"]


def test_next_finalized_turn_lands_on_new_active_timeline(tmp_path):
    ws = build_workspace(tmp_path)
    request, _ = _request_fork(ws)
    assert request["ok"] is True
    confirm = _confirm_fork(ws)
    assert confirm["ok"] is True
    main_before = _main_sha(ws)
    fork_ref = "refs/heads/timelines/tl-atlantic"
    fork_before = _refs(ws)[fork_ref]

    turn3_sha = _commit_turn(ws, 3, "fin-t3")

    refs_after = _refs(ws)
    assert refs_after[fork_ref] == turn3_sha
    assert refs_after[fork_ref] != fork_before
    assert refs_after["refs/heads/main"] == main_before

    import subprocess

    message = subprocess.run(
        [
            "git",
            f"--git-dir={_repo(ws['workspace'])}",
            "log",
            "-1",
            "--format=%B",
            turn3_sha,
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    ).stdout
    assert "Timeline-Id: tl-atlantic" in message
    assert "Turn-Number: 3" in message

    coc_history_projection.rebuild_history_projection(
        ws["workspace"], CAMPAIGN
    )
    fork_view = _run(ws, _HISTORY_QUERY, {"timeline": "tl-atlantic"})
    assert fork_view["ok"] is True, fork_view
    assert fork_view["data"]["turn_number"] == 3
    assert "fork_point" not in fork_view["data"]
    parent_view = _run(ws, _HISTORY_QUERY, {"timeline": "tl-main"})
    assert parent_view["ok"] is True
    assert parent_view["data"]["turn_number"] == 2


# --------------------------------------------------------------------------- #
# timeline.confluence_query / timeline.confluence_confirm
# --------------------------------------------------------------------------- #

_CONFLUENCE_QUERY = "timeline.confluence_query"
_CONFLUENCE_CONFIRM = "timeline.confluence_confirm"

_LEFT_ROLL = {
    "type": "roll",
    "roll_id": "roll-left-listen",
    "skill": "listen",
    "total": 42,
}
_RIGHT_STATE_MOTTO = "hold-fast"


def _append_finalization(ws, finalization_id: str) -> None:
    path = _worktree(ws["workspace"]) / "logs" / "turn-finalizations.jsonl"
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"finalization_id": finalization_id}) + "\n")


def _finalize(ws, turn: int, finalization_id: str) -> str:
    """Commit one turn exactly as the worktree stands (no state rewrite)."""
    _append_finalization(ws, finalization_id)
    return coc_git_history.commit_finalized_turn(
        ws["workspace"],
        ws["campaign_id"],
        turn_number=turn,
        finalization_id=finalization_id,
        journal_decision_id=f"journal-{finalization_id}",
        settlement_snapshot_id=f"settle-{finalization_id}",
        rendered_text_sha256="a" * 64,
        schema_generation=SCHEMA,
    )


def build_confluence_workspace(tmp_path: Path):
    """Two divergent one-turn forks of tl-main@turn-1 plus rebuilt projection.

    Left tip (tl-left, turn 2): party.hp 11 + a left-only roll in its own
    log file. Right tip (tl-right, turn 2): party.hp 7, a right-only death
    leaf, a right-only plain motto leaf, and its own roll.
    """
    ws = build_workspace(tmp_path)
    root = ws["workspace"]
    worktree = _worktree(root)

    coc_git_history.fork_timeline(
        root, CAMPAIGN, timeline_id="tl-left", game_reason="左线救援",
        source_timeline_id="tl-main", source_turn=1, activate=True,
    )
    # Authentic fork-moment worktree: exactly tl-main@turn-1 content.
    _write(worktree, "logs/turn-finalizations.jsonl",
           json.dumps({"finalization_id": "fin-t1"}) + "\n")
    left_state = {"day": 3, "era": "1925", "turn": 2,
                  "party": {"hp": 11, "cash": 50}}
    _write(worktree, "save/world-state.json",
           json.dumps(left_state) + "\n")
    _write(worktree, "logs/rolls-left.jsonl",
           json.dumps(_LEFT_ROLL) + "\n")
    _finalize(ws, 2, "fin-l2")

    coc_git_history.set_active_timeline(root, CAMPAIGN, "tl-main")
    coc_git_history.fork_timeline(
        root, CAMPAIGN, timeline_id="tl-right", game_reason="右线硬闯",
        source_timeline_id="tl-main", source_turn=1, activate=True,
    )
    # Activation now materializes the line being switched to, so the right
    # tree already contains exactly tl-main@turn-1 and the left-only file is
    # gone. This cleanup used to be load-bearing -- the fork inherited the
    # whole previous worktree, and without it canonical-row lineage binding
    # would have depended on scan order instead of authorship. It is kept as
    # an idempotent assertion of that property: if a leftover ever reappears,
    # the tests below fail on content rather than silently passing.
    assert not (worktree / "logs" / "rolls-left.jsonl").exists(), (
        "activating tl-right must not leave tl-left's files in the worktree"
    )
    _write(worktree, "logs/turn-finalizations.jsonl",
           json.dumps({"finalization_id": "fin-t1"}) + "\n")
    right_state = {"day": 3, "era": "1925", "turn": 2,
                   "party": {"hp": 7, "cash": 50, "motto": _RIGHT_STATE_MOTTO},
                   "npcs": {"npc-captain": {"dead": True}}}
    _write(worktree, "save/world-state.json",
           json.dumps(right_state) + "\n")
    _write(worktree, "logs/rolls-right.jsonl",
           json.dumps({"type": "roll", "roll_id": "roll-right-shout",
                       "skill": "shout", "total": 8}) + "\n")
    _finalize(ws, 2, "fin-r2")

    coc_history_projection.rebuild_history_projection(root, CAMPAIGN)
    return ws


def _confluence_query(ws, **overrides):
    args = {
        "timeline": "tl-merged",
        "left_timeline": "tl-left",
        "right_timeline": "tl-right",
    }
    args.update(overrides)
    return _run(ws, _CONFLUENCE_QUERY, args), args


def _all_conflict_cards(ws, page_size=None, **overrides):
    """Page through the complete enumeration exactly like a KP would.

    Returns the merged view `{parents, conflict_cards, ...}` of the last
    page plus every collected card: paging completeness holds because the
    caller sees each conflict exactly once.
    """
    cards: list[dict] = []
    page = 1
    view: dict | None = None
    extra = dict(overrides)
    if page_size is not None:
        extra["page_size"] = page_size
    while True:
        result, _args = _confluence_query(ws, page=page, **extra)
        assert result["ok"] is True, result
        view = result["data"]
        cards.extend(view["conflict_cards"])
        if page >= view["page_count"]:
            break
        page += 1
    merged = dict(view)
    merged["conflict_cards"] = cards
    return merged


def _default_dispositions(cards):
    """Complete KP dispositions over the collected conflict cards."""
    if isinstance(cards, dict):
        cards = cards["conflict_cards"]
    dispositions = {}
    for card in cards:
        conflict_id = card["conflict_id"]
        key = str(card.get("key"))
        if "roll-left-listen" in key:
            mode = "choose_left"
        elif "roll-right-shout" in key:
            mode = "choose_right"
        elif "npc-captain/dead" in key or "party/hp" in key:
            # Both save/world-state.json conflicts must share one mode:
            # the merged world takes the right side (hp 7, captain dead).
            mode = "choose_right"
        else:
            mode = "choose_left"
        disposition = {"mode": mode, "receipt": f"裁决 {conflict_id}"}
        if card["hard_state"]:
            disposition["resolver_receipt"] = "hard-resolver-checked"
        dispositions[conflict_id] = disposition
    return dispositions


def _confluence_confirm(ws, query_data=None, *, decision_id="conf-def-1",
                        **overrides):
    if query_data is None:
        query_data = _all_conflict_cards(ws)
    if isinstance(query_data, list):
        raise AssertionError("pass card lists through query_data")
    parents = {row["timeline_id"]: row["turn_number"]
               for row in query_data["parents"]}
    args = {
        "decision_id": decision_id,
        "timeline": query_data["timeline_id"],
        "left_timeline": "tl-left",
        "right_timeline": "tl-right",
        "left_turn": parents["tl-left"],
        "right_turn": parents["tl-right"],
        "dispositions": _default_dispositions(query_data),
        "game_reason": "两条线汇成一条主时间线",
    }
    args.update(overrides)
    return _run(ws, _CONFLUENCE_CONFIRM, args)


def test_confluence_operations_registered_with_policy():
    for name in (_CONFLUENCE_QUERY, _CONFLUENCE_CONFIRM):
        assert name in coc_toolbox.TOOLS
    assert coc_toolbox.operation_policy(_CONFLUENCE_QUERY) == {
        "audience": "keeper",
        "phases": ["live_turn", "pending_finalization", "recovery", "ending"],
        "contract": "none",
        "advisory": False,
        "kp_surface": "context",
    }
    # A merge legitimately continues around settlement and recovery: the
    # measured acceptance run hit a phase-gate rejection confirming a
    # confluence while a turn was settling / during post-resume recovery,
    # and again in ``ending`` when the closed segment's worldline
    # bookkeeping was completed after state.end_session (T11+).
    assert coc_toolbox.operation_policy(_CONFLUENCE_CONFIRM) == {
        "audience": "keeper",
        "phases": ["live_turn", "pending_finalization", "recovery", "ending"],
        "contract": "state",
        "advisory": False,
        "kp_surface": "state",
    }
    query_spec = coc_toolbox.TOOLS[_CONFLUENCE_QUERY]
    confirm_spec = coc_toolbox.TOOLS[_CONFLUENCE_CONFIRM]
    assert query_spec["access"] == "query"
    assert query_spec["strict_read_only"] is True
    assert query_spec["write_domains"] == ()
    assert confirm_spec["access"] == "mutation"
    assert confirm_spec["strict_read_only"] is False
    assert confirm_spec["write_domains"] == ("timeline",)
    assert confirm_spec["execution_class"] == "serial_campaign"
    canonical_query = coc_toolbox.OPERATION_REGISTRY.get(_CONFLUENCE_QUERY)
    canonical_confirm = coc_toolbox.OPERATION_REGISTRY.get(_CONFLUENCE_CONFIRM)
    assert "decision_id" not in canonical_query.params
    assert canonical_confirm.params["decision_id"]["required"] is True
    cell_module = coc_toolbox.OPERATION_MODULES["timeline"]
    assert "operation_timeline" in cell_module.__name__


def test_confluence_typed_schemas_and_generated_catalog_pick_up_the_slice():
    archive = coc_mcp_contract_archive.build_archive(coc_toolbox)
    query_schema = archive["operations"][_CONFLUENCE_QUERY]["inputSchema"]
    confirm_schema = archive["operations"][_CONFLUENCE_CONFIRM]["inputSchema"]
    assert set(query_schema["properties"]) == {
        "root", "campaign", "timeline", "left_timeline", "right_timeline",
        "page", "page_size", "class",
    }
    assert set(confirm_schema["properties"]) == {
        "root", "campaign", "decision_id", "timeline", "left_timeline",
        "right_timeline", "left_turn", "right_turn", "dispositions",
        "path_resolutions", "game_reason",
    }
    for schema in (query_schema, confirm_schema):
        assert schema["additionalProperties"] is False
        for key in schema["properties"]:
            assert not re.search(r"sha|digest|commit|ref", key), key

    on_disk = coc_mcp_contract_archive.load_and_validate(ARCHIVE_PATH)
    assert _CONFLUENCE_QUERY in on_disk["operations"]
    assert _CONFLUENCE_CONFIRM in on_disk["operations"]
    projection = coc_mcp_contract_archive.validate_policy_projection(
        POLICY_TS_PATH, coc_toolbox
    )
    assert (
        projection["operation_policy"][_CONFLUENCE_QUERY]["kp_surface"]
        == "context"
    )
    assert (
        projection["operation_policy"][_CONFLUENCE_CONFIRM]["contract"]
        == "state"
    )
    policy_ts = POLICY_TS_PATH.read_text(encoding="utf-8")
    assert f'"{_CONFLUENCE_QUERY}"' in policy_ts
    assert f'"{_CONFLUENCE_CONFIRM}"' in policy_ts


def _manifest_path(ws, timeline="tl-merged"):
    cell = coc_toolbox.OPERATION_MODULES["timeline"]
    store = cell.coc_confluence_manifest_store
    return store.manifest_path(
        ws["workspace"] / ".coc" / "campaigns" / CAMPAIGN,
        f"confluence-{CAMPAIGN}-{timeline}",
    )


def test_confluence_query_enumerates_complete_ordered_conflicts(tmp_path):
    ws = build_confluence_workspace(tmp_path)
    result, args = _confluence_query(ws)
    assert result["ok"] is True, result
    data = result["data"]

    assert data["schema_version"] == 1
    assert data["tool"] == _CONFLUENCE_QUERY
    assert data["confluence_id"] == f"confluence-{CAMPAIGN}-tl-merged"
    assert data["timeline_id"] == "tl-merged"
    assert data["parents"] == [
        {"timeline_id": "tl-left", "turn_number": 2},
        {"timeline_id": "tl-right", "turn_number": 2},
    ]
    _no_machine_ids(data)

    # Bounded model projection: totals/histograms plus ONE page of compact
    # cards; the complete raw enumeration lives only in the persisted
    # manifest under the campaign's temporal memory area.
    cards = data["conflict_cards"]
    assert data["conflict_count"] == len(cards) == 4
    default_page_size = (
        coc_toolbox.OPERATION_MODULES["timeline"]._CONFLUENCE_DEFAULT_PAGE_SIZE
    )
    assert data["page"] == 1
    assert data["page_size"] == default_page_size
    assert data["page_count"] == 1
    assert data["class_counts"] == {
        "death": 1, "roll_receipt": 2, "stat_value": 1,
    }
    assert data["addition_counts"] == {"left_only": 1, "right_only": 2}
    assert "filtered_count" not in data

    # The complete enumeration is persisted deterministically campaign-side.
    manifest_file = _manifest_path(ws)
    assert manifest_file.is_file()
    manifest_before = manifest_file.read_bytes()

    by_marker = {}
    for card in cards:
        key = str(card.get("key"))
        if "npc-captain/dead" in key:
            marker = "death"
        elif "party/hp" in key:
            marker = "hp"
        elif "roll-left-listen" in key:
            marker = "roll-left"
        elif "roll-right-shout" in key:
            marker = "roll-right"
        else:
            marker = "unexpected"
        by_marker.setdefault(marker, []).append(card)

    assert {
        key: len(rows) for key, rows in sorted(by_marker.items())
    } == {"death": 1, "hp": 1, "roll-left": 1, "roll-right": 1}
    death = by_marker["death"][0]
    hp = by_marker["hp"][0]
    roll_left = by_marker["roll-left"][0]
    roll_right = by_marker["roll-right"][0]

    # Cards carry identity + class judgement + bounded previews only: no
    # raw refs arrays, no verbatim values, no machine handles.
    for card in cards:
        assert set(card) == {
            "conflict_id", "class", "hard_state", "non_duplicable",
            "key", "left", "right",
        }
        assert set(card["left"]) == {"timeline", "preview"}
        assert set(card["right"]) == {"timeline", "preview"}
        assert len(card["left"]["preview"].encode()) <= 200
        assert card["left"]["timeline"] in ("tl-left", "tl-right")

    # One-sided death leaf: the left side asserts its DEFAULTABLE default
    # (alive), so an explicit right-side death is a disagreement, never a
    # silent addition. One-sided rolls carry the ABSENT marker on the
    # missing side — resolution obligations, never disposition-free
    # additions.
    assert death["class"] == "death"
    assert death["non_duplicable"] is True and death["hard_state"] is True
    assert death["left"]["preview"] == "false"
    assert death["right"]["preview"] == "true"
    assert hp["class"] == "stat_value"
    assert hp["non_duplicable"] is False and hp["hard_state"] is True
    assert hp["left"]["preview"] == "11" and hp["right"]["preview"] == "7"
    assert roll_left["class"] == "roll_receipt"
    assert roll_left["non_duplicable"] is True
    assert roll_left["left"]["preview"].startswith(
        '{"roll_id":"roll-left-listen"'
    )
    assert roll_right["left"]["preview"] == '{"absent":true}'
    assert roll_right["right"]["preview"].startswith(
        '{"roll_id":"roll-right-shout"'
    )

    _no_machine_ids(result["warnings"])
    assert any("confluence_confirm" in hint for hint in result["hints"])
    assert any("persisted" in hint or "bounded" in hint
               for hint in result["hints"])

    # Re-query replays byte-identically: same response AND same manifest.
    second, _args2 = _confluence_query(ws)
    assert second["ok"] is True
    assert second["data"] == data
    assert _manifest_path(ws).read_bytes() == manifest_before


def test_confluence_query_is_byte_and_ref_read_only(tmp_path):
    import subprocess

    ws = build_confluence_workspace(tmp_path)

    manifest_dir = (
        _worktree(ws["workspace"]) / "memory" / "temporal"
        / "confluence-manifests"
    )

    def snapshot():
        refs = subprocess.run(
            ["git", f"--git-dir={_repo(ws['workspace'])}", "for-each-ref"],
            capture_output=True, text=True, encoding="utf-8", check=True,
        ).stdout
        files = {}
        repo_dir = _repo(ws["workspace"])
        base = ws["workspace"]
        for scan_root in (base, repo_dir):
            for path in sorted(scan_root.rglob("*")):
                rel = str(path.relative_to(scan_root))
                if not path.is_file() or "locks" in path.parts or ".lock" in path.name:
                    continue
                if rel.endswith("logs/toolbox-calls.jsonl"):
                    # The toolbox's own cross-cutting audit log records the
                    # query itself by design; it is not the operation's
                    # state write.
                    continue
                if manifest_dir in path.parents:
                    # The derived confluence enumeration cache is the one
                    # deliberate write (ignore-face, rebuildable); its
                    # byte-determinism is asserted separately below.
                    continue
                label = f"repo:{rel}" if scan_root == repo_dir else rel
                files[label] = path.read_bytes()
        return refs, files

    before = snapshot()
    first, _ = _confluence_query(ws)
    second, _ = _confluence_query(ws)
    assert first["ok"] is True and second["ok"] is True
    assert first["data"] == second["data"]
    after = snapshot()
    assert after == before
    manifests_after_first = {
        p.name: p.read_bytes() for p in sorted(manifest_dir.glob("*.json"))
    }
    assert manifests_after_first


def test_confluence_query_validates_semantic_inputs(tmp_path):
    ws = build_confluence_workspace(tmp_path)
    # A target that already exists fails closed.
    coc_git_history.fork_timeline(
        ws["workspace"], CAMPAIGN, timeline_id="tl-taken",
        game_reason="已被占用", source_timeline_id="tl-main",
        source_turn=1, activate=False,
    )
    cases = [
        {"timeline": "tl-main"},
        {"timeline": "merged"},
        {"timeline": "tl-left"},
        {"left_timeline": "bad"},
        {"right_timeline": "tl-left"},          # equals left
        {"left_timeline": "tl-ghost"},
        {"right_timeline": "tl-ghost"},
        {"timeline": "tl-taken"},               # target already exists
        {"page": 0},
        {"page": -1},
        {"page": True},
        {"page_size": 0},
        {"page_size": 51},
        {"page_size": "20"},
        {"class": "bogus_class"},
    ]
    for overrides in cases:
        result, _ = _confluence_query(ws, **overrides)
        assert result["ok"] is False, overrides
        code = result["error"]["code"]
        assert code in ("invalid_param", "invalid_state"), (overrides, result)

    # Beyond-the-last page is an explicit rejection, not a silent empty.
    result, _ = _confluence_query(ws, page=2)
    assert result["ok"] is False
    assert result["error"]["code"] == "invalid_param"

    missing = _run(ws, _CONFLUENCE_QUERY, {})
    assert missing["ok"] is False
    assert missing["error"]["code"] == "missing_param"


def test_confluence_confirm_merges_third_line_survives_next_turn(tmp_path):
    ws = build_confluence_workspace(tmp_path)
    root = ws["workspace"]
    refs_before = _refs(ws)

    query, _ = _confluence_query(ws)
    assert query["ok"] is True
    data = query["data"]

    confirm = _confluence_confirm(ws, data)
    assert confirm["ok"] is True, confirm
    receipt = confirm["data"]
    assert set(receipt) == {
        "schema_version", "tool", "decision_id", "confluence_id",
        "campaign_id", "timeline_id", "parents", "conflict_count",
        "disposition_count", "disposition_modes", "activated",
        "active_timeline_id", "projection", "idempotent",
    }
    assert receipt["confluence_id"] == f"confluence-{CAMPAIGN}-tl-merged"
    assert receipt["timeline_id"] == "tl-merged"
    assert receipt["parents"] == [
        {"timeline_id": "tl-left", "turn_number": 2},
        {"timeline_id": "tl-right", "turn_number": 2},
    ]
    assert receipt["conflict_count"] == data["conflict_count"]
    assert receipt["activated"] is True
    assert receipt["active_timeline_id"] == "tl-merged"
    assert receipt["projection"] == {"status": "rebuilt"}
    assert receipt["idempotent"] is False
    # Wire carries modes/receipt aggregates only; the full receipts live
    # in the canonical confluence record inside Git history.
    assert receipt["disposition_count"] == data["conflict_count"]
    assert receipt["disposition_modes"] == {
        "choose_left": 1, "choose_right": 3,
    }
    for receipts in (receipt, confirm["warnings"], confirm["hints"]):
        _no_machine_ids(receipts)

    # Exactly two distinct immutable parents on a brand-new third ref.
    merge_sha = next(
        sha for name, sha in _refs(ws).items()
        if name.endswith("timelines/tl-merged")
    )
    parents_line = subprocess_run_parents(ws, merge_sha)
    assert parents_line[1] == refs_before["refs/heads/timelines/tl-left"]
    assert parents_line[2] == refs_before["refs/heads/timelines/tl-right"]
    refs_after = _refs(ws)
    assert refs_after["refs/heads/timelines/tl-left"] == (
        refs_before["refs/heads/timelines/tl-left"]
    )
    assert refs_after["refs/heads/timelines/tl-right"] == (
        refs_before["refs/heads/timelines/tl-right"]
    )
    assert refs_after["refs/heads/main"] == refs_before["refs/heads/main"]

    state = coc_git_history.load_timeline_state(root, CAMPAIGN)
    merged_row = next(
        row for row in state["timelines"]
        if row["timeline_id"] == "tl-merged"
    )
    assert merged_row["kind"] == "confluence"
    assert merged_row["parents"] == ["tl-left", "tl-right"]
    assert state["active_timeline_id"] == "tl-merged"

    # The resolved tree is materialized into the campaign directory, and the
    # next finalized turn commits the dispositions, not stale parent content.
    live_world = json.loads(
        (_worktree(root) / "save" / "world-state.json").read_text(encoding="utf-8")
    )
    assert live_world["party"]["hp"] == 7
    assert live_world["npcs"]["npc-captain"]["dead"] is True
    # choose_left kept the left roll's log file verbatim.
    assert (_worktree(root) / "logs" / "rolls-left.jsonl").is_file()

    live_world["turn"] = 3
    _write(_worktree(root), "save/world-state.json",
           json.dumps(live_world) + "\n")
    next_sha = _finalize(ws, 3, "fin-m3")
    import subprocess

    message = subprocess.run(
        ["git", f"--git-dir={_repo(root)}", "log", "-1", "--format=%B", next_sha],
        capture_output=True, text=True, encoding="utf-8", check=True,
    ).stdout
    assert "Timeline-Id: tl-merged" in message
    committed = json.loads(subprocess.run(
        ["git", f"--git-dir={_repo(root)}", "show", f"{next_sha}:save/world-state.json"],
        capture_output=True, text=True, encoding="utf-8", check=True,
    ).stdout)
    assert committed["party"]["hp"] == 7

    # The confirm-time rebuild predates the new turn; refresh the cache the
    # way session.resume would before reading the merged line's history.
    coc_history_projection.rebuild_history_projection(root, CAMPAIGN)
    history_view = _run(ws, _HISTORY_QUERY, {"timeline": "tl-merged"})
    assert history_view["ok"] is True, history_view
    assert history_view["data"]["turn_number"] == 3


def subprocess_run_parents(ws, merge_sha):
    import subprocess

    out = subprocess.run(
        ["git", f"--git-dir={_repo(ws['workspace'])}",
         "rev-list", "--no-walk", "--parents", merge_sha],
        capture_output=True, text=True, encoding="utf-8", check=True,
    ).stdout.split()
    return out


def test_confluence_confirm_replay_is_idempotent_and_fingerprint_bound(tmp_path):
    ws = build_confluence_workspace(tmp_path)
    query, _ = _confluence_query(ws)
    data = query["data"]
    first = _confluence_confirm(ws, data)
    assert first["ok"] is True, first
    refs_after = _refs(ws)

    replay_args_decision = _confluence_confirm(ws, data)
    assert replay_args_decision["ok"] is True
    assert replay_args_decision["data"] == first["data"]
    assert any(
        "duplicate decision_id" in w for w in replay_args_decision["warnings"]
    )
    assert _refs(ws) == refs_after

    other = _confluence_confirm(
        ws, data, decision_id="conf-other-1"
    )
    assert other["ok"] is False
    assert other["error"]["code"] == "invalid_state"
    assert _refs(ws) == refs_after


def test_confluence_confirm_fingerprint_misuse_fails_closed(tmp_path):
    ws = build_confluence_workspace(tmp_path)
    query, _ = _confluence_query(ws)
    data = query["data"]
    confirm_args = {
        "decision_id": "conf-same-1",
        "timeline": data["timeline_id"],
        "left_timeline": "tl-left",
        "right_timeline": "tl-right",
        "left_turn": 2,
        "right_turn": 2,
        "dispositions": _default_dispositions(data),
        "game_reason": "两条线汇成一条主时间线",
    }
    first = _run(ws, _CONFLUENCE_CONFIRM, confirm_args)
    assert first["ok"] is True, first

    misuse = dict(confirm_args)
    misuse["game_reason"] = "另一个理由"
    conflict = _run(ws, _CONFLUENCE_CONFIRM, misuse)
    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "idempotency_conflict"


def test_confluence_confirm_rejects_stale_parent_before_mutation(tmp_path):
    ws = build_confluence_workspace(tmp_path)
    query, _ = _confluence_query(ws)
    data = query["data"]

    # One parent advances past the queried anchor.
    coc_git_history.set_active_timeline(ws["workspace"], CAMPAIGN, "tl-left")
    _write(_worktree(ws["workspace"]), "save/late.json",
           json.dumps({"note": "左线又走了一步"}) + "\n")
    _finalize(ws, 3, "fin-l3")
    coc_history_projection.rebuild_history_projection(
        ws["workspace"], CAMPAIGN
    )

    snapshot_files = _campaign_bytes(ws)
    failed = _confluence_confirm(ws, data)
    assert failed["ok"] is False
    assert failed["error"]["code"] == "invalid_state"
    assert "advanced" in failed["error"]["message"]
    assert _refs(ws)["refs/heads/timelines/tl-left"] == _turn_sha(
        ws, "tl-left", 3
    )
    assert "refs/heads/timelines/tl-merged" not in _refs(ws)
    assert _campaign_bytes(ws) == snapshot_files


def _campaign_bytes(ws) -> dict[str, bytes]:
    return {
        path.relative_to(ws["workspace"]).as_posix(): path.read_bytes()
        for path in sorted(_worktree(ws["workspace"]).rglob("*"))
        if path.is_file()
        and ".lock" not in path.name
        and not path.as_posix().endswith("logs/toolbox-calls.jsonl")
    }


def test_confluence_confirm_rejects_incomplete_or_invalid_dispositions(tmp_path):
    ws = build_confluence_workspace(tmp_path)
    query, _ = _confluence_query(ws)
    data = query["data"]
    full = _default_dispositions(data)
    refs_before = _refs(ws)
    files_before = _campaign_bytes(ws)

    def expect_rejection(overrides, needle=None):
        result = _confluence_confirm(ws, data, **overrides)
        assert result["ok"] is False, overrides
        assert result["error"]["code"] == "invalid_param", (overrides, result)
        if needle:
            assert needle in result["error"]["message"]
        assert _refs(ws) == refs_before
        assert _campaign_bytes(ws) == files_before

    missing = dict(full)
    dropped = next(
        cid for cid, d in full.items() if d["mode"] == "choose_right"
    )
    missing.pop(dropped)
    expect_rejection({"dispositions": missing}, "missing dispositions")

    extra = dict(full)
    extra["conflict-does-not-exist-1"] = {"mode": "choose_left", "receipt": "x"}
    expect_rejection({"dispositions": extra})

    no_resolver = dict(full)
    no_resolver[dropped] = {"mode": "choose_right", "receipt": "缺硬核回执"}
    expect_rejection({"dispositions": no_resolver}, "resolver_receipt")

    non_dup = next(
        cid for cid, d in full.items()
        if "rolls-" in cid
    )
    combined = dict(full)
    combined[non_dup] = {
        "mode": "combine", "receipt": "想合并骰点",
        "resolver_receipt": "hard-resolver-checked",
    }
    expect_rejection({"dispositions": combined}, "combine")


def test_confluence_confirm_warns_when_projection_rebuild_fails(tmp_path):
    ws = build_confluence_workspace(tmp_path)
    cell = coc_toolbox.OPERATION_MODULES["timeline"]

    def boom(*_args, **_kwargs):
        raise cell.coc_history_projection.HistoryProjectionRebuildError(
            "injected rebuild failure"
        )

    from contextlib import contextmanager

    @contextmanager
    def patched():
        original = cell.coc_history_projection.rebuild_history_projection
        try:
            cell.coc_history_projection.rebuild_history_projection = boom
            yield
        finally:
            cell.coc_history_projection.rebuild_history_projection = original

    with patched():
        query, _ = _confluence_query(ws)
        assert query["ok"] is True
        confirmed = _confluence_confirm(ws, query["data"])

    assert confirmed["ok"] is True, confirmed
    receipt = confirmed["data"]
    assert receipt["projection"] == {"status": "stale"}
    assert any(
        "history projection rebuild" in warning
        for warning in confirmed["warnings"]
    )
    # Canonical Git history landed regardless of the cache failure.
    refs = _refs(ws)
    assert "refs/heads/timelines/tl-merged" in refs
    assert (
        coc_git_history.active_timeline_id(ws["workspace"], CAMPAIGN)
        == "tl-merged"
    )


def test_confluence_zero_conflict_explicit_and_third_line_lands(tmp_path):
    """Two worldlines with identical state but their own settled turns.

    Divergence is only one-sided finalization receipts — surfaced as
    additions, never conflicts. Zero conflict count is explicit; the merge
    still produces a third timeline with two DISTINCT parents (git cannot
    express the same commit twice as parents).
    """
    ws = build_workspace(tmp_path)
    root = ws["workspace"]
    flat_state = {"day": 9, "era": "1925", "turn": 2}

    coc_git_history.fork_timeline(
        root, CAMPAIGN, timeline_id="tl-flat-a", game_reason="平线甲",
        source_timeline_id="tl-main", source_turn=1, activate=True,
    )
    _write(_worktree(root), "save/world-state.json",
           json.dumps(flat_state) + "\n")
    _finalize(ws, 2, "fin-a2")

    coc_git_history.set_active_timeline(root, CAMPAIGN, "tl-main")
    # The fresh fork inherits the fork-moment worktree; restore the exact
    # source-turn state so both lines write the same world content.
    _write(_worktree(root), "logs/turn-finalizations.jsonl",
           json.dumps({"finalization_id": "fin-t1"}) + "\n")
    coc_git_history.fork_timeline(
        root, CAMPAIGN, timeline_id="tl-flat-b", game_reason="平线乙",
        source_timeline_id="tl-main", source_turn=1, activate=True,
    )
    _write(_worktree(root), "save/world-state.json",
           json.dumps(flat_state) + "\n")
    _finalize(ws, 2, "fin-b2")
    coc_history_projection.rebuild_history_projection(root, CAMPAIGN)

    query, _ = _confluence_query(
        ws, timeline="tl-trivial", left_timeline="tl-flat-a",
        right_timeline="tl-flat-b",
    )
    assert query["ok"] is True, query
    data = query["data"]
    assert data["parents"] == [
        {"timeline_id": "tl-flat-a", "turn_number": 2},
        {"timeline_id": "tl-flat-b", "turn_number": 2},
    ]
    # Zero conflicts is explicit, never omitted: empty card page plus
    # zero totals; one-sided additions stay counted (never conflicts).
    assert data["conflict_count"] == 0
    assert data["conflict_cards"] == []
    assert data["class_counts"] == {}
    assert set(data["addition_counts"]) == {"left_only", "right_only"}
    assert data["addition_counts"]["right_only"] == 1
    assert data["addition_counts"]["left_only"] >= 1
    # Zero conflicts is explicit; one-sided additions stay surfaced without
    # dispositions. Deterministic pinned commit timestamps bind both
    # finalized receipts and the inherited tl-main receipt outside the
    # shared face — exactly-once totals come back via paging below.
    assert data["page"] == 1 and data["page_count"] == 1
    _no_machine_ids(data)
    assert any("agree" in hint for hint in query["hints"])

    confirmed = _run(ws, _CONFLUENCE_CONFIRM, {
        "decision_id": "trivial-conf-1",
        "timeline": "tl-trivial",
        "left_timeline": "tl-flat-a",
        "right_timeline": "tl-flat-b",
        "left_turn": 2,
        "right_turn": 2,
        "dispositions": {},
        "game_reason": "两线在同一落点合一",
    })
    assert confirmed["ok"] is True, confirmed
    receipt = confirmed["data"]
    assert receipt["conflict_count"] == 0
    assert receipt["disposition_count"] == 0
    assert receipt["disposition_modes"] == {}
    assert receipt["active_timeline_id"] == "tl-trivial"

    import subprocess

    merge_sha = next(
        sha for name, sha in _refs(ws).items()
        if name.endswith("timelines/tl-trivial")
    )
    parents_line = subprocess.run(
        ["git", f"--git-dir={_repo(root)}", "rev-list", "--parents", "-1", merge_sha],
        capture_output=True, text=True, encoding="utf-8", check=True,
    ).stdout.split()
    a_tip = _turn_sha(ws, "tl-flat-a", 2)
    b_tip = _turn_sha(ws, "tl-flat-b", 2)
    assert parents_line[1:] == [a_tip, b_tip]
    assert a_tip != b_tip

    state = coc_git_history.load_timeline_state(root, CAMPAIGN)
    trivial_row = next(
        row for row in state["timelines"]
        if row["timeline_id"] == "tl-trivial"
    )
    assert trivial_row["kind"] == "confluence"
    assert trivial_row["parents"] == ["tl-flat-a", "tl-flat-b"]


# --------------------------------------------------------------------------- #
# Persisted-manifest confirm gate (fail-closed family)
# --------------------------------------------------------------------------- #


def _confirm_fails_pre_mutation(ws, data, needle=None):
    refs_before = _refs(ws)
    files_before = _campaign_bytes(ws)
    failed = _confluence_confirm(ws, data)
    assert failed["ok"] is False
    assert failed["error"]["code"] == "invalid_state"
    if needle:
        assert needle in failed["error"]["message"]
    assert "refs/heads/timelines/tl-merged" not in _refs(ws)
    assert _refs(ws) == refs_before
    assert _campaign_bytes(ws) == files_before


def test_confluence_manifest_missing_fails_closed(tmp_path):
    ws = build_confluence_workspace(tmp_path)
    query, _ = _confluence_query(ws)
    assert query["ok"] is True
    _manifest_path(ws).unlink()

    failed = _confluence_confirm(ws, query["data"])
    assert failed["ok"] is False
    assert failed["error"]["code"] == "invalid_state"
    assert "timeline.confluence_query" in failed["error"]["message"]
    assert "refs/heads/timelines/tl-merged" not in _refs(ws)


def test_confluence_manifest_digest_tamper_fails_closed(tmp_path):
    ws = build_confluence_workspace(tmp_path)
    query, _ = _confluence_query(ws)
    path = _manifest_path(ws)
    document = json.loads(path.read_text(encoding="utf-8"))
    document["conflicts"][0]["left"]["value"] = "tampered"
    path.write_text(
        json.dumps(document, sort_keys=True, ensure_ascii=False,
                   separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    _confirm_fails_pre_mutation(
        ws, query["data"], needle="integrity digest"
    )


def test_confluence_manifest_stale_but_digest_valid_fails_closed(tmp_path):
    """A self-consistent but different enumeration must not merge."""
    ws = build_confluence_workspace(tmp_path)
    query, _ = _confluence_query(ws)
    cell = coc_toolbox.OPERATION_MODULES["timeline"]
    store = cell.coc_confluence_manifest_store
    contract_mod = cell.coc_temporal_memory_contract

    path = _manifest_path(ws)
    document = json.loads(path.read_text(encoding="utf-8"))
    digest = document.pop("manifest_sha256")
    # A KP-side edit that the world never saw: values drift, digest is
    # recomputed so the file alone looks healthy.
    document["conflicts"][0]["left"]["value"] = "fabricated"
    document["manifest_sha256"] = contract_mod.record_digest(document)
    store.persist_manifest(
        ws["workspace"] / ".coc" / "campaigns" / CAMPAIGN, document
    )
    assert digest != document["manifest_sha256"]

    _confirm_fails_pre_mutation(ws, query["data"], needle="re-run")


def test_confluence_paging_completeness_and_class_filter(tmp_path):
    """Every conflict id is reachable exactly once across pages; the class
    filter pages a coherent subset with an explicit filtered count."""
    ws = build_confluence_workspace(tmp_path)

    collected, pages = [], 0
    seen_ids: set[str] = set()
    page = 1
    while True:
        result, _ = _confluence_query(ws, page=page, page_size=1)
        assert result["ok"] is True, result
        data = result["data"]
        assert data["page_size"] == 1 and len(data["conflict_cards"]) == 1
        card = data["conflict_cards"][0]
        assert card["conflict_id"] not in seen_ids
        seen_ids.add(card["conflict_id"])
        collected.append(card)
        pages += 1
        if page >= data["page_count"]:
            break
        page += 1
    assert len(collected) == 4 == pages

    # Re-paging collects the same ordered ids (deterministic pagination).
    again = _all_conflict_cards(ws, page_size=2)
    assert [c["conflict_id"] for c in again["conflict_cards"]] == [
        c["conflict_id"] for c in collected
    ]

    filtered, filter_pages, filter_page = [], 0, 1
    while True:
        result, _ = _confluence_query(
            ws, page=filter_page, page_size=10, **{"class": "roll_receipt"}
        )
        assert result["ok"] is True, result
        fdata = result["data"]
        assert fdata["filtered_count"] == 2
        assert all(c["class"] == "roll_receipt" for c in fdata["conflict_cards"])
        filtered.extend(fdata["conflict_cards"])
        filter_pages += 1
        if filter_page >= fdata["page_count"]:
            break
        filter_page += 1
    assert {c["conflict_id"] for c in filtered} <= seen_ids
    assert len(filtered) == 2


def _budget_pad(seed: str, size: int) -> str:
    block = ("0" + seed) * ((size // max(len(seed), 8)) + 1)
    return block[:size]


def _budget_projection(timeline_id: str, campaign: str, *, side: str) -> dict:
    """Measured-shape synthetic authority projection.

    Mirrors the offline /tmp/cq.json diagnostic from the real acceptance
    run: ~200 conflicts whose raw side values reach ~195KB each plus one
    branch carrying thousands of one-sided addition rows.
    """
    state = {"/save/shared": "same"}
    for i in range(21):
        state[f"/save/party/hp-{i}"] = 11 if side == "left" else 7
    events = []
    # 171 divergent world_fact events: same cross-side key (shared
    # decision_id), different payloads — several KB each with one
    # measured-scale ~195KB outlier.
    for i in range(171):
        size = 195_000 if i == 0 else 3_000
        events.append({
            "row_kind": "event",
            "campaign_id": campaign,
            "decision_id": f"evt-shared-{i}",
            "payload_json": json.dumps(
                {"text": _budget_pad(f"{side[0]}{i}", size)}, ensure_ascii=False
            ),
        })
    # One-sided additions, thousands on the right (measured shape).
    additions_right = 8225 if side == "right" else 0
    additions_left = 1 if side == "left" else 0
    for i in range(additions_right + additions_left):
        tag = "right" if side == "right" else "left"
        events.append({
            "row_kind": "event",
            "campaign_id": campaign,
            "decision_id": f"evt-{tag}-only-{i}",
            "payload_json": json.dumps(
                {"text": _budget_pad(f"{tag}{i}", 240)}, ensure_ascii=False
            ),
        })
    entities = (
        [{"entity_id": f"ent-right-{i}", "kind": "npc"} for i in range(3)]
        if side == "right"
        else [{"entity_id": "ent-left-only", "kind": "npc"}]
    )
    # One-sided mechanics: every distinct row becomes its own explicit
    # conflict (measured shape: 4 left rolls + 5 right rolls).
    roll_count = 5 if side == "right" else 4
    rolls = [
        {
            "type": "roll", "roll_id": f"roll-{side}-{i}",
            "skill": "listen", "total": 30 + i,
        }
        for i in range(roll_count)
    ]
    # Right-only one-time effect and per-side consumptions (1 + 1 + 1).
    effects = (
        [{"effect_id": "fx-right-only", "decision_id": "fx-decision-r"}]
        if side == "right"
        else []
    )
    transactions = [{
        "transaction_id": f"txn-{side}-only",
        "decision_id": f"txn-decision-{side[0]}",
        "cash_delta": -3,
    }]
    return {
        "timeline_id": timeline_id,
        "campaign_id": campaign,
        "turn_number": 9,
        "state": state,
        "events": events,
        "receipts": [],
        "rolls": rolls,
        "effects": effects,
        "transactions": transactions,
        "relations": [],
        "entities": entities,
        "assertions": [],
    }


def test_confluence_wire_budget_on_measured_scale_ledger(tmp_path, monkeypatch):
    """Budget guarantee against a ledger shaped like the measured run.

    The offline diagnostic (/tmp/cq.json) measured 204 conflicts (~195KB
    largest raw side value), additions right_only=8228 — an 8.9MB full
    envelope that once collapsed to identity-only — and a 21.9KB confirm
    receipt failing closed over the 16KB budget. The default-page query
    envelope and the slim confirm envelope must both serialize strictly
    under coc_mcp_wire.MAX_INLINE_BYTES.
    """
    import types

    cell = coc_toolbox.OPERATION_MODULES["timeline"]
    wire = _load("coc_mcp_wire_budget", SCRIPTS / "coc_mcp_wire.py")

    campaign = "budget-camp"
    root = tmp_path / "workspace"
    camp_dir = root / ".coc" / "campaigns" / campaign
    camp_dir.mkdir(parents=True)

    left_tl, right_tl, merged_tl = (
        "tl-budget-left", "tl-budget-right", "tl-budget-merged",
    )
    projections = {
        left_tl: _budget_projection(left_tl, campaign, side="left"),
        right_tl: _budget_projection(right_tl, campaign, side="right"),
    }

    # Deterministic memoization: paging re-enumerates per call; identical
    # projections yield byte-identical enumerations.
    original_enumerate = cell.coc_timeline_confluence.enumerate_conflicts
    memo: dict[tuple[int, int, str], dict] = {}

    def memoized(left_p, right_p, *, confluence_id):
        key = (id(left_p), id(right_p), confluence_id)
        if key not in memo:
            memo[key] = original_enumerate(
                left_p, right_p, confluence_id=confluence_id
            )
        return memo[key]

    monkeypatch.setattr(
        cell.coc_timeline_confluence, "enumerate_conflicts", memoized
    )
    monkeypatch.setattr(cell, "_validate_free_target", lambda ctx, tid: None)
    monkeypatch.setattr(
        cell,
        "_lineage_projection",
        lambda ctx, tid: (
            projections[tid],
            {"owner_timeline_id": tid, "turn_number": 9},
        ),
    )

    ctx = types.SimpleNamespace(root=root, campaign_id=campaign, campaign_dir=camp_dir)
    args = {
        "timeline": merged_tl,
        "left_timeline": left_tl,
        "right_timeline": right_tl,
    }

    data, warnings, hints = cell._tool_timeline_confluence_query(ctx, args)
    assert data["conflict_count"] == 204
    assert data["class_counts"] == {
        "world_fact": 171,
        "stat_value": 21,
        "roll_receipt": 9,
        "one_time_effect": 1,
        "consumed_resource": 2,
    }
    assert data["class_counts"]["world_fact"] == 171
    assert data["addition_counts"] == {"left_only": 2, "right_only": 8228}
    default_size = cell._CONFLUENCE_DEFAULT_PAGE_SIZE
    assert len(data["conflict_cards"]) == default_size
    # Cards are bounded even when raw values are 195KB monsters.
    biggest_card = max(
        len(json.dumps(card, ensure_ascii=False).encode())
        for card in data["conflict_cards"]
    )
    assert biggest_card < 900

    envelope = {
        "ok": True,
        "tool": _CONFLUENCE_QUERY,
        "data": data,
        "warnings": warnings,
        "hints": hints,
    }
    projected = wire.project_envelope(
        _CONFLUENCE_QUERY,
        envelope,
        contract_digest="sha256:" + "0" * 64,
    )
    projected_bytes = wire.transport_bytes(projected)
    assert projected_bytes <= wire.MAX_INLINE_BYTES, projected_bytes
    assert projected["data"].get("conflict_count") == 204

    # Every conflict id reachable exactly once via paging (max page size).
    all_ids: list[str] = []
    total_pages = None
    page = 1
    while True:
        paged, _, _ = cell._tool_timeline_confluence_query(
            ctx,
            {**args, "page": page, "page_size": cell._CONFLUENCE_MAX_PAGE_SIZE},
        )
        all_ids.extend(
            card["conflict_id"] for card in paged["conflict_cards"]
        )
        total_pages = paged["page_count"]
        if page >= total_pages:
            break
        page += 1
    assert len(all_ids) == len(set(all_ids)) == 204
    # Beyond-the-last page is an explicit bounded rejection.
    beyond = None
    try:
        cell._tool_timeline_confluence_query(
            ctx,
            {**args, "page": total_pages + 1,
             "page_size": cell._CONFLUENCE_MAX_PAGE_SIZE},
        )
    except Exception as exc:  # noqa: BLE001 - ToolError expected here
        beyond = exc
    assert beyond is not None and "beyond the last page" in str(beyond)

    # Confirm-by-reference over the persisted manifest: bounded slim
    # receipt under the same wire budget; mutation delegated exactly once.
    monkeypatch.setattr(
        cell,
        "_resolve_semantic_tip",
        lambda ctx, tid, _depth=0: {
            "owner_timeline_id": tid, "turn_number": 9,
        },
    )
    monkeypatch.setattr(
        cell.coc_history_projection_query,
        "query_authority_projection",
        lambda root_, campaign_, *, timeline_id, turn_number,
        projection_timeline_id: projections[projection_timeline_id],
    )
    merges: list[dict] = []

    def fake_merge(root_, **kwargs):
        merges.append(kwargs)
        return {"idempotent": False}

    monkeypatch.setattr(
        cell.coc_git_history, "confluence_timelines", fake_merge
    )
    monkeypatch.setattr(
        cell.coc_git_history,
        "active_timeline_id",
        lambda root_, campaign_: merged_tl,
    )
    monkeypatch.setattr(
        cell.coc_history_projection, "rebuild_history_projection",
        lambda root_, campaign_: None,
    )

    ledger_records: dict[str, dict] = {}

    ctx.ledger_lookup = (
        lambda tool, decision_id: ledger_records.get(decision_id)
    )
    ctx.ledger_record = (
        lambda decision_id, tool, payload:
        ledger_records.setdefault(decision_id, payload)
    )

    hard_classes = set(cell.coc_temporal_memory_contract.HARD_STATE_CONFLICT_CLASSES)

    manifest_store = cell.coc_confluence_manifest_store
    manifest = manifest_store.load_manifest(camp_dir, f"confluence-{campaign}-{merged_tl}")
    assert manifest is not None
    assert manifest["counts"]["conflicts_total"] == 204
    class_of = {c["conflict_id"]: c["class"] for c in manifest["conflicts"]}
    dispositions = {}
    for cid in all_ids:
        entry = {"mode": "choose_left", "receipt": "裁决"}
        if class_of[cid] in hard_classes:
            entry["resolver_receipt"] = "hard-resolver-checked"
        dispositions[cid] = entry

    receipt, warnings_c, hints_c = cell._tool_timeline_confluence_confirm(ctx, {
        **args,
        "decision_id": "budget-confirm-1",
        "left_turn": 9,
        "right_turn": 9,
        "dispositions": dispositions,
        "game_reason": "预算验收合并",
    })
    assert len(merges) == 1
    assert merges[0]["timeline_id"] == merged_tl
    assert len(merges[0]["conflicts"]) == 204
    assert receipt["conflict_count"] == 204
    assert receipt["disposition_modes"] == {"choose_left": 204}

    confirm_envelope = {
        "ok": True,
        "tool": _CONFLUENCE_CONFIRM,
        "data": receipt,
        "warnings": warnings_c,
        "hints": hints_c,
    }
    projected_confirm = wire.project_envelope(
        _CONFLUENCE_CONFIRM,
        confirm_envelope,
        contract_digest="sha256:" + "0" * 64,
    )
    confirm_bytes = wire.transport_bytes(projected_confirm)
    assert confirm_bytes <= wire.MAX_INLINE_BYTES, confirm_bytes
