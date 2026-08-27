"""Behavior tests owned by the temporal-history operation cell.

Covers the first canonical Pi-Coc host-integration slice: ``history.query``,
``history.diff``, ``memory.recall``, ``memory.adjudicate`` — normal
``coc_toolbox`` execution, exact typed schemas, typed catalog visibility,
read-only guarantees, privacy/campaign isolation, semantic-ID surface,
structured errors, idempotency/fingerprint rejection, and no legacy-card
dependency. Deterministic contracts only; semantic adoption stays with the
live KP and real play.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import subprocess
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


coc_toolbox = _load("coc_toolbox_temporal_history", SCRIPTS / "coc_toolbox.py")
coc_starter = _load("coc_starter_temporal_history", SCRIPTS / "coc_starter.py")
coc_temporal_memory = _load(
    "coc_temporal_memory_ops", SCRIPTS / "coc_temporal_memory.py"
)
coc_temporal_memory_contract = _load(
    "coc_temporal_memory_contract_ops", SCRIPTS / "coc_temporal_memory_contract.py"
)
coc_history_projection = _load(
    "coc_history_projection_ops", SCRIPTS / "coc_history_projection.py"
)
coc_history_projection_schema = _load(
    "coc_history_projection_schema_ops",
    SCRIPTS / "coc_history_projection_schema.py",
)
coc_mcp_contract_archive = _load(
    "coc_mcp_contract_archive_ops", SCRIPTS / "coc_mcp_contract_archive.py"
)

contract = coc_temporal_memory_contract
ARCHIVE_PATH = REPO / "plugins" / "coc-keeper" / "references" / "mcp-operation-contracts.json"
POLICY_TS_PATH = (
    REPO / "plugins" / "coc-keeper" / "pi" / "lib" / "operation-policy.generated.ts"
)

HISTORY_CAMPAIGN = "hist-ops-camp"
MEMORY_CAMPAIGN = "temporal-ops"
COMMIT_A = "b" * 40


_PRIVATE_MODULE_ALIASES = {
    "coc_toolbox": "coc_toolbox_temporal_history",
    "coc_starter": "coc_starter_temporal_history",
    "coc_temporal_memory": "coc_temporal_memory_ops",
    "coc_temporal_memory_contract": "coc_temporal_memory_contract_ops",
    "coc_history_projection": "coc_history_projection_ops",
    "coc_history_projection_schema": "coc_history_projection_schema_ops",
    "coc_mcp_contract_archive": "coc_mcp_contract_archive_ops",
}


def _exec_dispatch_module_specs() -> tuple:
    """Re-execute this file's private module aliases in original order."""
    return (
        _load("coc_toolbox_temporal_history", SCRIPTS / "coc_toolbox.py"),
        _load("coc_starter_temporal_history", SCRIPTS / "coc_starter.py"),
        _load("coc_temporal_memory_ops", SCRIPTS / "coc_temporal_memory.py"),
        _load(
            "coc_temporal_memory_contract_ops",
            SCRIPTS / "coc_temporal_memory_contract.py",
        ),
        _load("coc_history_projection_ops", SCRIPTS / "coc_history_projection.py"),
        _load(
            "coc_history_projection_schema_ops",
            SCRIPTS / "coc_history_projection_schema.py",
        ),
        _load(
            "coc_mcp_contract_archive_ops",
            SCRIPTS / "coc_mcp_contract_archive.py",
        ),
    )


def _bind_module_globals(modules: tuple) -> None:
    host = sys.modules[__name__]
    for canonical, module in zip(_PRIVATE_MODULE_ALIASES, modules):
        setattr(host, canonical, module)
    host.contract = host.coc_temporal_memory_contract


@pytest.fixture()
def fresh_dispatch_modules():
    """Make dispatch identity self-sufficient against cross-suite leaks.

    Several suites (tests/test_git_history*.py, tests/test_timeline_*.py)
    re-execute production scripts under their canonical ``sys.modules``
    names, so a same-process ordering that imported the canonical
    adapters/projection chain first can leave adapter-level exception
    handlers bound to one generation of classes while a later lazy import
    raises from another generation — the structured error mapping then
    escapes unmapped (raw ``ProjectionQueryError`` instead of
    ``invalid_state``).

    This fixture purges every ``coc_*`` entry from ``sys.modules`` and
    re-executes this file's whole dispatch universe from disk, so adapter,
    projection query, and schema share single-copy class identity no
    matter what earlier suites did. Teardown restores the previous
    namespace and bindings byte-for-byte, so no other suite changes.
    """
    host = sys.modules[__name__]
    canonical_snapshot = {
        key: module
        for key, module in list(sys.modules.items())
        if key.startswith("coc_")
    }
    original_globals = {
        canonical: getattr(host, canonical, None)
        for canonical in _PRIVATE_MODULE_ALIASES
    }
    try:
        for key in canonical_snapshot:
            del sys.modules[key]
        _bind_module_globals(_exec_dispatch_module_specs())
        yield
    finally:
        stale_keys = [
            name
            for name in list(sys.modules)
            if name.startswith("coc_")
        ]
        for key in stale_keys:
            del sys.modules[key]
        sys.modules.update(canonical_snapshot)
        restored = []
        for canonical in _PRIVATE_MODULE_ALIASES:
            value = original_globals.get(canonical)
            if value is not None:
                restored.append(value)
            else:
                # Degenerate case: the global was absent pre-fixture; never
                # leave a stale binding behind.
                try:
                    delattr(host, canonical)
                except AttributeError:
                    pass
                restored.append(None)
        host.contract = host.coc_temporal_memory_contract


# --------------------------------------------------------------------------- #
# Fixtures
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
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.delenv("COC_HOST", raising=False)


def _env() -> dict[str, str]:
    env = os.environ.copy()
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    env["GIT_CONFIG_GLOBAL"] = os.devnull
    env["GIT_CONFIG_SYSTEM"] = os.devnull
    env["GIT_TERMINAL_PROMPT"] = "0"
    return env


def _git(*args: str, cwd: Path | None = None, repo: Path | None = None) -> str:
    cmd = [
        "git",
        "-c",
        "user.name=temporal-ops-test",
        "-c",
        "user.email=temporal-ops-test@localhost",
        "-c",
        "commit.gpgsign=false",
    ]
    if repo is not None:
        cmd.append(f"--git-dir={repo}")
    cmd.extend(args)
    completed = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        env=_env(),
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    assert completed.returncode == 0, f"git {args} failed: {completed.stderr}"
    return completed.stdout


def _worktree(root: Path) -> Path:
    return root / ".coc" / "campaigns" / HISTORY_CAMPAIGN


def _repo(root: Path) -> Path:
    return root / ".coc" / "repos" / "campaigns" / f"{HISTORY_CAMPAIGN}.git"


def _write(worktree: Path, relpath: str, text: str) -> None:
    path = worktree / relpath
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _commit(worktree: Path, subject: str, trailers: list[tuple[str, str]]) -> str:
    message = subject + "\n\n" + "\n".join(f"{key}: {value}" for key, value in trailers)
    _git("add", "-A", cwd=worktree)
    _git("commit", "--allow-empty", "-m", message, cwd=worktree)
    return _git("rev-parse", "HEAD", cwd=worktree).strip()


def _push(root: Path) -> None:
    _git("push", str(_repo(root)), "main", cwd=_worktree(root))


def build_history_workspace(tmp_path: Path, *, duplicate_latest_turn: bool = False):
    """Synthetic campaign with baseline + turn 1 + turn 2 git history, the
    sidecar bare repo, and a rebuilt history projection."""
    root = tmp_path / "workspace"
    worktree = _worktree(root)
    worktree.parent.mkdir(parents=True, exist_ok=True)
    _git("init", "-b", "main", str(worktree))

    _write(
        worktree,
        "campaign.json",
        json.dumps({"campaign_id": HISTORY_CAMPAIGN, "title": "history ops"}) + "\n",
    )
    _write(worktree, "party.json", json.dumps({"members": []}) + "\n")
    _write(worktree, "save/world-state.json", '{"day": 1, "era": "1925"}\n')
    _write(
        worktree,
        "logs/turn-finalizations.jsonl",
        '{"finalization_id": "fin-base"}\n',
    )
    _commit(
        worktree,
        "coc baseline",
        [
            ("COC-Commit-Type", "baseline"),
            ("Campaign-Id", HISTORY_CAMPAIGN),
            ("Timeline-Id", "tl-main"),
        ],
    )

    _write(worktree, "save/world-state.json", '{"day": 2, "era": "1925"}\n')
    _write(
        worktree,
        "logs/turn-finalizations.jsonl",
        '{"finalization_id": "fin-base"}\n{"finalization_id": "fin-t1"}\n',
    )
    _commit(
        worktree,
        "coc turn 0001",
        [
            ("COC-Commit-Type", "turn"),
            ("Campaign-Id", HISTORY_CAMPAIGN),
            ("Timeline-Id", "tl-main"),
            ("Turn-Number", "1"),
            ("Finalization-Id", "fin-t1"),
        ],
    )

    _write(worktree, "save/world-state.json", '{"day": 3, "era": "1926"}\n')
    _write(
        worktree,
        "logs/turn-finalizations.jsonl",
        '{"finalization_id": "fin-base"}\n'
        '{"finalization_id": "fin-t1"}\n'
        '{"finalization_id": "fin-t2"}\n',
    )
    _commit(
        worktree,
        "coc turn 0002",
        [
            ("COC-Commit-Type", "turn"),
            ("Campaign-Id", HISTORY_CAMPAIGN),
            ("Timeline-Id", "tl-main"),
            ("Turn-Number", "2"),
            ("Finalization-Id", "fin-t2"),
        ],
    )

    if duplicate_latest_turn:
        # A second commit claiming the same newest turn: the latest turn is
        # ambiguous and must never be guessed.
        _write(worktree, "save/world-state.json", '{"day": 4, "era": "1926"}\n')
        _commit(
            worktree,
            "coc turn 0002 again",
            [
                ("COC-Commit-Type", "turn"),
                ("Campaign-Id", HISTORY_CAMPAIGN),
                ("Timeline-Id", "tl-main"),
                ("Turn-Number", "2"),
                ("Finalization-Id", "fin-t2b"),
            ],
        )

    _git("init", "--bare", "-b", "main", str(_repo(root)))
    _push(root)
    coc_history_projection.rebuild_history_projection(root, HISTORY_CAMPAIGN)
    return {"workspace": root, "campaign_id": HISTORY_CAMPAIGN}


@pytest.fixture
def memory_ws(tmp_path: Path):
    workspace = tmp_path / "mem-workspace"
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
        campaign_id=MEMORY_CAMPAIGN,
        title="Temporal Ops Test",
    )
    return {
        "workspace": workspace,
        "campaign_id": MEMORY_CAMPAIGN,
        "campaign_dir": Path(quick["campaign_dir"]),
    }


def _run(ws, tool: str, args: dict | None = None) -> dict:
    return coc_toolbox.run_tool(tool, ws["workspace"], ws["campaign_id"], args or {})


def _seed_assertion(campaign_dir: Path, **overrides) -> dict:
    cid = campaign_dir.name
    base = {
        "assertion_id": f"mem-{cid}-seed",
        "kind": "knowledge",
        "scope": "campaign",
        "campaign_id": cid,
        "timeline_id": "tl-main",
        "subject_id": contract.subject_id_for("party", cid, ""),
        "knowers": [contract.subject_id_for("party", cid, "")],
        "privacy": "player_safe",
        "state": "accurate",
        "statement": "地窖里的敲击声尚未解释。",
        "entities": ["entity-location-cellar"],
        "occurred_turn": 1,
        "valid_from_turn": 1,
        "source_commit": COMMIT_A,
        "source_turn": 1,
        "source_receipts": ["receipt-seed-1"],
    }
    base.update(overrides)
    return coc_temporal_memory.record_assertion(base, campaign_dir=campaign_dir)


def _seed_player_assertion(campaign_dir: Path, slug: str) -> dict:
    cid = campaign_dir.name
    return _seed_assertion(
        campaign_dir,
        assertion_id=f"mem-{cid}-{slug}",
        kind="player_assertion",
        subject_id="subject-player-table",
        knowers=["subject-player-table"],
        privacy="player_safe",
        statement="玩家断言：地下室没有别的东西。",
        entities=[],
    )


# --------------------------------------------------------------------------- #
# Registration, policy, and typed schema surface
# --------------------------------------------------------------------------- #

def test_temporal_history_operations_registered_with_policy():
    for name in (
        "history.query",
        "history.diff",
        "memory.recall",
        "memory.adjudicate",
    ):
        assert name in coc_toolbox.TOOLS
        policy = coc_toolbox.operation_policy(name)
        assert policy["audience"] == "keeper"
    for name in ("history.query", "history.diff", "memory.recall"):
        spec = coc_toolbox.TOOLS[name]
        policy = coc_toolbox.operation_policy(name)
        assert spec["access"] == "query"
        assert spec["strict_read_only"] is True
        assert spec["write_domains"] == ()
        assert spec["recovery_domains"] == ()
        assert spec["audit_mode"] == "reference"
        assert policy["contract"] == "none"
        assert policy["kp_surface"] == "context"
    assert "recovery" in coc_toolbox.operation_policy("history.query")["phases"]
    assert "recovery" in coc_toolbox.operation_policy("history.diff")["phases"]
    assert "live_turn" in coc_toolbox.operation_policy("memory.recall")["phases"]
    adjudicate_policy = coc_toolbox.operation_policy("memory.adjudicate")
    assert adjudicate_policy["contract"] == "state"
    assert adjudicate_policy["kp_surface"] == "state"
    assert "live_turn" in adjudicate_policy["phases"]
    assert coc_toolbox.TOOLS["memory.adjudicate"]["access"] == "mutation"
    assert (
        coc_toolbox.OPERATION_REGISTRY.get("memory.adjudicate").params["decision_id"][
            "required"
        ]
        is True
    )


def test_typed_schemas_are_semantic_only():
    archive = coc_mcp_contract_archive.build_archive(coc_toolbox)
    expected_params = {
        "history.query": {"timeline", "turn"},
        "history.diff": {
            "timeline", "from_timeline", "from_turn", "to_timeline", "to_turn",
        },
        "memory.recall": {
            "subject_id", "timeline", "turn", "entities", "scene", "kinds",
            "view", "include_superseded", "limit",
        },
        "memory.adjudicate": {
            "decision_id", "candidate_id", "action", "statement", "kind",
            "subject_id", "privacy", "state",
        },
    }
    for name, params in expected_params.items():
        contract_row = archive["operations"][name]
        schema = contract_row["inputSchema"]
        assert schema["additionalProperties"] is False
        assert set(schema["properties"]) == params | {"root", "campaign"}
        # Semantic-ID surface: no sha/digest/commit-hash selectors anywhere
        # on the model-visible input schema.
        for key in schema["properties"]:
            assert not re.search(r"sha|digest|commit", key), (name, key)
        assert "campaign" in schema["required"]
        for param in params:
            assert param in schema["properties"]
    diff_schema = archive["operations"]["history.diff"]["inputSchema"]
    assert set(diff_schema["required"]) == {"campaign", "from_turn", "to_turn"}
    adjudicate_schema = archive["operations"]["memory.adjudicate"]["inputSchema"]
    assert set(adjudicate_schema["required"]) == {
        "campaign", "decision_id", "candidate_id", "action",
    }
    assert adjudicate_schema["properties"]["action"]["enum"] == [
        "accept", "modify", "reject",
    ]


def test_generated_catalog_and_policy_projection_pick_up_the_slice():
    archive = coc_mcp_contract_archive.load_and_validate(ARCHIVE_PATH)
    for name in (
        "history.query",
        "history.diff",
        "memory.recall",
        "memory.adjudicate",
    ):
        assert name in archive["operations"]
    projection = coc_mcp_contract_archive.validate_policy_projection(
        POLICY_TS_PATH, coc_toolbox
    )
    assert projection["operation_policy"]["history.query"]["kp_surface"] == "context"
    assert projection["operation_policy"]["memory.recall"]["kp_surface"] == "context"
    assert projection["operation_policy"]["memory.adjudicate"]["kp_surface"] == "state"
    assert "history.query" in projection["operations_by_surface"]["context"]
    assert "history.diff" in projection["operations_by_surface"]["context"]
    assert "memory.recall" in projection["operations_by_surface"]["context"]
    assert "memory.adjudicate" in projection["operations_by_surface"]["state"]
    policy_ts = POLICY_TS_PATH.read_text(encoding="utf-8")
    assert '"history.query"' in policy_ts


# --------------------------------------------------------------------------- #
# history.query / history.diff behavior
# --------------------------------------------------------------------------- #

def _no_internal_hash_values(node) -> None:
    if isinstance(node, dict):
        for key, value in node.items():
            assert not re.search(r"sha|digest|parents|files", str(key)), key
            _no_internal_hash_values(value)
    elif isinstance(node, list):
        for item in node:
            _no_internal_hash_values(item)
    elif isinstance(node, str):
        assert not re.fullmatch(r"[0-9a-f]{40}", node), node


def test_history_query_resolves_default_timeline_and_latest_turn(tmp_path):
    ws = build_history_workspace(tmp_path)
    result = _run(ws, "history.query", {})
    assert result["ok"] is True, result
    data = result["data"]
    assert data["timeline_id"] == "tl-main"
    assert data["turn_number"] == 2
    assert data["authority"] == "structured_state"
    assert data["commit"] == {
        "timeline_id": "tl-main",
        "turn_number": 2,
        "commit_type": "turn",
        "finalization_id": "fin-t2",
        "ordinal": data["commit"]["ordinal"],
    }
    world = data["snapshots"]["save/world-state.json"]["state"]
    assert world == {"day": 3, "era": "1926"}
    _no_internal_hash_values(data)


def test_history_query_explicit_turn_and_semantic_selectors(tmp_path):
    ws = build_history_workspace(tmp_path)
    first = _run(ws, "history.query", {"timeline": "tl-main", "turn": 1})
    assert first["ok"] is True, first
    assert first["data"]["turn_number"] == 1
    assert first["data"]["snapshots"]["save/world-state.json"]["state"] == {
        "day": 2, "era": "1925",
    }
    explicit = _run(ws, "history.query", {"timeline": "tl-main"})
    assert explicit["ok"] is True
    assert explicit["data"]["turn_number"] == 2


def test_history_query_is_strictly_read_only(tmp_path):
    ws = build_history_workspace(tmp_path)
    db_path = coc_history_projection_schema.projection_path(
        ws["workspace"], HISTORY_CAMPAIGN
    )
    before = hashlib.sha256(db_path.read_bytes()).hexdigest()
    repo_refs_before = _git(
        "for-each-ref", "--format=%(refname)%(objectname)", repo=_repo(ws["workspace"])
    )
    result = _run(ws, "history.query", {"turn": 1})
    assert result["ok"] is True
    assert hashlib.sha256(db_path.read_bytes()).hexdigest() == before
    assert (
        _git(
            "for-each-ref",
            "--format=%(refname)%(objectname)",
            repo=_repo(ws["workspace"]),
        )
        == repo_refs_before
    )


def test_history_query_structured_errors(tmp_path):
    ws = build_history_workspace(tmp_path)
    unknown_turn = _run(ws, "history.query", {"turn": 99})
    assert unknown_turn["ok"] is False
    assert unknown_turn["error"]["code"] == "invalid_state"

    bad_timeline = _run(ws, "history.query", {"timeline": "main"})
    assert bad_timeline["ok"] is False
    assert bad_timeline["error"]["code"] == "invalid_param"

    string_turn = _run(ws, "history.query", {"turn": "2"})
    assert string_turn["ok"] is False
    assert string_turn["error"]["code"] == "invalid_param"

    negative_turn = _run(ws, "history.query", {"turn": -1})
    assert negative_turn["ok"] is False
    assert negative_turn["error"]["code"] == "invalid_param"


def test_history_query_fails_closed_without_projection(tmp_path):
    root = tmp_path / "workspace"
    campaign_dir = root / ".coc" / "campaigns" / HISTORY_CAMPAIGN
    campaign_dir.mkdir(parents=True)
    (campaign_dir / "campaign.json").write_text("{}", encoding="utf-8")
    ws = {"workspace": root, "campaign_id": HISTORY_CAMPAIGN}
    result = _run(ws, "history.query", {"timeline": "tl-main", "turn": 1})
    assert result["ok"] is False
    assert result["error"]["code"] == "invalid_state"
    assert "projection" in result["error"]["message"]


def test_history_query_never_guesses_an_ambiguous_latest_turn(
    tmp_path,
    fresh_dispatch_modules,
):
    ws = build_history_workspace(tmp_path, duplicate_latest_turn=True)
    default_turn = _run(ws, "history.query", {})
    assert default_turn["ok"] is False
    assert default_turn["error"]["code"] == "invalid_state"
    assert "ambiguous" in default_turn["error"]["message"]
    explicit = _run(ws, "history.query", {"turn": 1})
    assert explicit["ok"] is True
    ambiguous_explicit = _run(ws, "history.query", {"turn": 2})
    assert ambiguous_explicit["ok"] is False
    assert ambiguous_explicit["error"]["code"] == "invalid_state"


def test_history_diff_between_turns(tmp_path):
    ws = build_history_workspace(tmp_path)
    result = _run(
        ws,
        "history.diff",
        {"from_turn": 1, "to_turn": 2},
    )
    assert result["ok"] is True, result
    data = result["data"]
    assert data["from_commit"]["turn_number"] == 1
    assert data["to_commit"]["turn_number"] == 2
    world_changes = [
        row
        for row in data["changes"]
        if row["path"] == "save/world-state.json"
    ]
    day_change = next(row for row in world_changes if row["pointer"] == "/day")
    assert day_change["change_type"] == "replace"
    assert day_change["old_value"] == 2
    assert day_change["new_value"] == 3
    era_change = next(row for row in world_changes if row["pointer"] == "/era")
    assert era_change["change_type"] == "replace"
    assert era_change["new_value"] == "1926"
    _no_internal_hash_values(data)

    same = _run(ws, "history.diff", {"from_turn": 2, "to_turn": 2})
    assert same["ok"] is True
    assert same["data"]["change_count"] == 0


def test_history_diff_structured_errors(
    tmp_path,
    fresh_dispatch_modules,
):
    ws = build_history_workspace(tmp_path)
    unknown_from = _run(ws, "history.diff", {"from_turn": 40, "to_turn": 2})
    assert unknown_from["ok"] is False
    assert unknown_from["error"]["code"] == "invalid_state"

    missing_from = _run(ws, "history.diff", {"to_turn": 2})
    assert missing_from["ok"] is False
    assert missing_from["error"]["code"] == "missing_param"

    bad_side = _run(
        ws, "history.diff", {"from_turn": 1, "to_turn": 2, "to_timeline": "tl-fork"}
    )
    assert bad_side["ok"] is False
    assert bad_side["error"]["code"] == "invalid_state"


# --------------------------------------------------------------------------- #
# memory.recall behavior
# --------------------------------------------------------------------------- #

def test_memory_recall_narrows_deterministically(memory_ws):
    camp = memory_ws["campaign_dir"]
    party = contract.subject_id_for("party", MEMORY_CAMPAIGN, "")
    _seed_assertion(
        camp,
        assertion_id=f"mem-{MEMORY_CAMPAIGN}-public",
        statement="公开的地窖记忆。",
    )
    _seed_assertion(
        camp,
        assertion_id=f"mem-{MEMORY_CAMPAIGN}-secret",
        privacy="keeper_only",
        statement="Corbitt 埋在地下室。",
    )
    _seed_assertion(
        camp,
        assertion_id=f"mem-{MEMORY_CAMPAIGN}-other-scene",
        entities=["entity-location-attic"],
        statement="阁楼的低语。",
    )

    keeper = _run(memory_ws, "memory.recall", {})
    assert keeper["ok"] is True, keeper
    env = keeper["data"]
    assert env["authority"] == "advisory"
    assert env["hard_gate"] is False
    assert env["tier"] == "warm"
    assert env["view"] == "keeper"
    assert env["timeline_id"] == "tl-main"
    ids = {row["assertion_id"] for row in env["candidates"]}
    assert ids == {
        f"mem-{MEMORY_CAMPAIGN}-public",
        f"mem-{MEMORY_CAMPAIGN}-secret",
        f"mem-{MEMORY_CAMPAIGN}-other-scene",
    }

    player = _run(memory_ws, "memory.recall", {"view": "player_safe"})
    assert player["ok"] is True
    player_ids = {row["assertion_id"] for row in player["data"]["candidates"]}
    assert f"mem-{MEMORY_CAMPAIGN}-secret" not in player_ids
    assert player["data"]["view"] == "player_safe"

    narrowed = _run(
        memory_ws,
        "memory.recall",
        {"entities": ["entity-location-cellar"], "subject_id": party},
    )
    assert narrowed["ok"] is True
    narrowed_ids = {row["assertion_id"] for row in narrowed["data"]["candidates"]}
    assert narrowed_ids == {
        f"mem-{MEMORY_CAMPAIGN}-public",
        f"mem-{MEMORY_CAMPAIGN}-secret",
    }

    replay = _run(memory_ws, "memory.recall", {})
    assert replay["data"]["candidates"] == keeper["data"]["candidates"]


def test_memory_recall_valid_time_and_supersession(memory_ws):
    camp = memory_ws["campaign_dir"]
    _seed_assertion(
        camp,
        assertion_id=f"mem-{MEMORY_CAMPAIGN}-later",
        valid_from_turn=5,
        occurred_turn=5,
        source_turn=5,
        statement="第五回合才成立的记忆。",
    )
    closed = _seed_assertion(
        camp,
        assertion_id=f"mem-{MEMORY_CAMPAIGN}-closed",
        statement="已被取代的记忆。",
    )
    superseding = dict(closed)
    superseding["assertion_id"] = f"mem-{MEMORY_CAMPAIGN}-closed-new"
    superseding["statement"] = "取代后的记忆。"
    coc_temporal_memory.record_assertion(superseding, campaign_dir=camp)
    closed_row = contract.plan_supersession(
        closed, superseding["assertion_id"], valid_until_turn=4
    )
    coc_temporal_memory.record_assertion(closed_row, campaign_dir=camp)

    anchored = _run(memory_ws, "memory.recall", {"turn": 3})
    assert anchored["ok"] is True, anchored
    ids = {row["assertion_id"] for row in anchored["data"]["candidates"]}
    assert f"mem-{MEMORY_CAMPAIGN}-later" not in ids
    assert f"mem-{MEMORY_CAMPAIGN}-closed" in ids

    current = _run(memory_ws, "memory.recall", {})
    current_ids = {row["assertion_id"] for row in current["data"]["candidates"]}
    assert f"mem-{MEMORY_CAMPAIGN}-closed" not in current_ids
    with_superseded = _run(memory_ws, "memory.recall", {"include_superseded": True})
    superseded_ids = {
        row["assertion_id"] for row in with_superseded["data"]["candidates"]
    }
    assert f"mem-{MEMORY_CAMPAIGN}-closed" in superseded_ids


def test_memory_recall_campaign_isolation(memory_ws):
    camp = memory_ws["campaign_dir"]
    _seed_assertion(camp, assertion_id=f"mem-{MEMORY_CAMPAIGN}-own")
    # A foreign campaign-scoped row inside this store: campaign pinning must
    # exclude it from this campaign's recall.
    _seed_assertion(
        camp,
        assertion_id="mem-other-camp-foreign",
        campaign_id="other-camp",
        statement="另一场战役的记忆。",
    )
    # A cross-campaign row whose global subject has no explicit binding to
    # this campaign: must fail closed out of a campaign-pinned recall.
    _seed_assertion(
        camp,
        assertion_id="mem-xc-unbound",
        scope="cross_campaign",
        campaign_id=None,
        timeline_id=None,
        kind="player_preference",
        subject_id="subject-player-table",
        knowers=["subject-player-table"],
        statement="跨战役偏好。",
        entities=[],
    )

    result = _run(memory_ws, "memory.recall", {})
    assert result["ok"] is True, result
    ids = {row["assertion_id"] for row in result["data"]["candidates"]}
    assert ids == {f"mem-{MEMORY_CAMPAIGN}-own"}


def test_memory_recall_is_strictly_read_only_and_legacy_card_free(memory_ws):
    camp = memory_ws["campaign_dir"]
    _seed_assertion(camp, assertion_id=f"mem-{MEMORY_CAMPAIGN}-ro")

    def snapshot() -> dict[Path, bytes]:
        return {
            path.relative_to(camp): path.read_bytes()
            for path in camp.rglob("*")
            if path.is_file()
            and "locks" not in path.relative_to(camp).parts
            and not path.name.endswith(".lock")
            and "toolbox-calls.jsonl" not in path.name
        }

    before = snapshot()
    result = _run(memory_ws, "memory.recall", {})
    assert result["ok"] is True
    assert snapshot() == before
    # The temporal path never consults or creates the legacy card store.
    assert not (camp / "memory" / "cards").exists()
    cell_module = coc_toolbox.OPERATION_MODULES["temporal-history"]
    assert not hasattr(cell_module, "coc_memory")
    cell_source = (
        SCRIPTS / "coc_operation_temporal_history.py"
    ).read_text(encoding="utf-8")
    assert "coc_memory." not in cell_source


def test_memory_recall_structured_errors(memory_ws):
    bad_view = _run(memory_ws, "memory.recall", {"view": "secret"})
    assert bad_view["ok"] is False
    assert bad_view["error"]["code"] == "invalid_param"

    bad_kind = _run(memory_ws, "memory.recall", {"kinds": ["rumor"]})
    assert bad_kind["ok"] is False
    assert bad_kind["error"]["code"] == "invalid_param"

    string_entities = _run(memory_ws, "memory.recall", {"entities": "entity-x"})
    assert string_entities["ok"] is False
    assert string_entities["error"]["code"] == "invalid_param"

    bad_subject = _run(memory_ws, "memory.recall", {"subject_id": "party"})
    assert bad_subject["ok"] is False
    assert bad_subject["error"]["code"] == "invalid_param"

    bad_limit = _run(memory_ws, "memory.recall", {"limit": 500})
    assert bad_limit["ok"] is False
    assert bad_limit["error"]["code"] == "invalid_param"


def test_memory_recall_matches_facade_adapter(memory_ws):
    """One recall semantics: the facade adapter returns the same canonical
    warm projection the typed memory.recall operation returns."""
    camp = memory_ws["campaign_dir"]
    _seed_assertion(camp, assertion_id=f"mem-{MEMORY_CAMPAIGN}-parity-a")
    _seed_assertion(
        camp,
        assertion_id=f"mem-{MEMORY_CAMPAIGN}-parity-b",
        entities=["entity-location-attic"],
        statement="阁楼的低语。",
    )
    typed = _run(memory_ws, "memory.recall", {"view": "keeper"})
    assert typed["ok"] is True, typed
    adapted = coc_temporal_memory.recall(
        None, {"campaign_dir": camp, "view": "keeper"}
    )
    # Byte-equal candidates: both surfaces share one implementation.
    assert adapted["candidates"] == typed["data"]["candidates"]
    assert [row["assertion_id"] for row in adapted["candidates"]] == [
        f"mem-{MEMORY_CAMPAIGN}-parity-a",
        f"mem-{MEMORY_CAMPAIGN}-parity-b",
    ]


# --------------------------------------------------------------------------- #
# memory.adjudicate behavior
# --------------------------------------------------------------------------- #

def test_memory_adjudicate_accept_and_reject(memory_ws):
    camp = memory_ws["campaign_dir"]
    accepted = _seed_player_assertion(camp, "guess-a")
    rejected = _seed_player_assertion(camp, "guess-b")

    ok = _run(
        memory_ws,
        "memory.adjudicate",
        {
            "decision_id": "adj-accept-1",
            "candidate_id": accepted["assertion_id"],
            "action": "accept",
        },
    )
    assert ok["ok"] is True, ok
    receipt = ok["data"]
    assert receipt["action"] == "accept"
    assert receipt["candidate_id"] == accepted["assertion_id"]
    promoted_id = receipt["promoted_assertion_id"]
    assert promoted_id
    assertions = coc_temporal_memory.load_assertions(camp)
    promoted = assertions[promoted_id]
    assert promoted["confirms"] == [accepted["assertion_id"]]
    # The candidate is never rewritten by an accept.
    assert assertions[accepted["assertion_id"]] == accepted

    rejected_ok = _run(
        memory_ws,
        "memory.adjudicate",
        {
            "decision_id": "adj-reject-1",
            "candidate_id": rejected["assertion_id"],
            "action": "reject",
        },
    )
    assert rejected_ok["ok"] is True
    assert rejected_ok["data"]["promoted_assertion_id"] is None
    after = coc_temporal_memory.load_assertions(camp)
    assert after[rejected["assertion_id"]] == rejected


def test_memory_adjudicate_modify_requires_statement(memory_ws):
    camp = memory_ws["campaign_dir"]
    candidate = _seed_player_assertion(camp, "guess-mod")
    missing = _run(
        memory_ws,
        "memory.adjudicate",
        {
            "decision_id": "adj-mod-1",
            "candidate_id": candidate["assertion_id"],
            "action": "modify",
        },
    )
    assert missing["ok"] is False
    assert missing["error"]["code"] == "invalid_param"
    with_statement = _run(
        memory_ws,
        "memory.adjudicate",
        {
            "decision_id": "adj-mod-2",
            "candidate_id": candidate["assertion_id"],
            "action": "modify",
            "statement": "KP 修正后的记忆表述。",
        },
    )
    assert with_statement["ok"] is True
    promoted = coc_temporal_memory.load_assertions(camp)[
        with_statement["data"]["promoted_assertion_id"]
    ]
    assert promoted["statement"] == "KP 修正后的记忆表述。"


def test_memory_adjudicate_idempotent_replay_and_fingerprint_reuse(memory_ws):
    camp = memory_ws["campaign_dir"]
    candidate = _seed_player_assertion(camp, "guess-idem")
    args = {
        "decision_id": "adj-idem-1",
        "candidate_id": candidate["assertion_id"],
        "action": "accept",
    }
    first = _run(memory_ws, "memory.adjudicate", args)
    assert first["ok"] is True, first
    replay = _run(memory_ws, "memory.adjudicate", args)
    assert replay["ok"] is True
    assert replay["data"] == first["data"]
    assert any(
        "duplicate decision_id" in warning for warning in replay["warnings"]
    )

    # Semantic reuse of the same decision id under a different request
    # fails closed at the operation layer.
    conflict = _run(
        memory_ws,
        "memory.adjudicate",
        {**args, "action": "reject"},
    )
    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "idempotency_conflict"

    conflict_modify = _run(
        memory_ws,
        "memory.adjudicate",
        {**args, "action": "modify", "statement": "不同的请求。"},
    )
    assert conflict_modify["ok"] is False
    assert conflict_modify["error"]["code"] == "idempotency_conflict"


def test_memory_adjudicate_underlying_fingerprint_still_binds(memory_ws):
    camp = memory_ws["campaign_dir"]
    candidate = _seed_player_assertion(camp, "guess-underlying")
    # A decision recorded through the module (not the toolbox ledger): the
    # underlying request fingerprint must still reject a drifted replay even
    # when the operation ledger has no entry yet.
    coc_temporal_memory.adjudicate_candidate(
        "adj-underlying-1",
        candidate["assertion_id"],
        "reject",
        campaign_dir=camp,
    )
    drifted = _run(
        memory_ws,
        "memory.adjudicate",
        {
            "decision_id": "adj-underlying-1",
            "candidate_id": candidate["assertion_id"],
            "action": "accept",
        },
    )
    assert drifted["ok"] is False
    assert drifted["error"]["code"] == "invalid_param"
    exact = _run(
        memory_ws,
        "memory.adjudicate",
        {
            "decision_id": "adj-underlying-1",
            "candidate_id": candidate["assertion_id"],
            "action": "reject",
        },
    )
    assert exact["ok"] is True
    assert exact["data"]["candidate_id"] == candidate["assertion_id"]


def test_memory_adjudicate_structured_errors(memory_ws):
    camp = memory_ws["campaign_dir"]
    candidate = _seed_player_assertion(camp, "guess-err")
    unknown_candidate = _run(
        memory_ws,
        "memory.adjudicate",
        {
            "decision_id": "adj-err-1",
            "candidate_id": f"mem-{MEMORY_CAMPAIGN}-missing",
            "action": "accept",
        },
    )
    assert unknown_candidate["ok"] is False
    assert unknown_candidate["error"]["code"] == "invalid_param"

    bad_action = _run(
        memory_ws,
        "memory.adjudicate",
        {
            "decision_id": "adj-err-2",
            "candidate_id": candidate["assertion_id"],
            "action": "promote",
        },
    )
    assert bad_action["ok"] is False
    assert bad_action["error"]["code"] == "invalid_param"

    missing_decision = _run(
        memory_ws,
        "memory.adjudicate",
        {"candidate_id": candidate["assertion_id"], "action": "reject"},
    )
    assert missing_decision["ok"] is False
    assert missing_decision["error"]["code"] == "missing_param"
