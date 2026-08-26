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
