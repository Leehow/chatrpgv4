"""Timeline DAG: fork, confluence, history query/diff, active selector."""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


hist = load_module("coc_git_history", SCRIPTS / "coc_git_history.py")
tm = load_module(
    "coc_temporal_memory_contract", SCRIPTS / "coc_temporal_memory_contract.py"
)
coc_state = load_module("coc_state", SCRIPTS / "coc_state.py")
coc_time = load_module("coc_time", SCRIPTS / "coc_time.py")

SCHEMA = hist.format_schema_generation(coc_state.CURRENT_SCHEMA_VERSIONS)
CAMPAIGN_ID = "tl-dag-camp"


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


def _repo(root: Path, campaign_id: str = CAMPAIGN_ID) -> Path:
    return root / ".coc" / "repos" / "campaigns" / f"{campaign_id}.git"


def _worktree(root: Path, campaign_id: str = CAMPAIGN_ID) -> Path:
    return root / ".coc" / "campaigns" / campaign_id


def _git(root: Path, *args: str, campaign_id: str = CAMPAIGN_ID) -> str:
    completed = subprocess.run(
        [
            "git",
            f"--git-dir={_repo(root, campaign_id)}",
            f"--work-tree={_worktree(root, campaign_id)}",
            *args,
        ],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return completed.stdout


def _seed(root: Path, campaign_id: str = CAMPAIGN_ID) -> Path:
    worktree = _worktree(root, campaign_id)
    (worktree / "save").mkdir(parents=True, exist_ok=True)
    (worktree / "logs").mkdir(parents=True, exist_ok=True)
    (worktree / "memory").mkdir(parents=True, exist_ok=True)
    (worktree / "campaign.json").write_text(
        json.dumps({"campaign_id": campaign_id, "title": "DAG"}) + "\n",
        encoding="utf-8",
    )
    (worktree / "save" / "world-state.json").write_text(
        json.dumps({"status": "setup", "turn": 0}) + "\n", encoding="utf-8"
    )
    (worktree / "logs" / "events.jsonl").write_text("", encoding="utf-8")
    return worktree


def _commit_turn(
    root: Path,
    turn_number: int,
    finalization_id: str,
    *,
    campaign_id: str = CAMPAIGN_ID,
) -> str:
    return hist.commit_finalized_turn(
        root,
        campaign_id,
        turn_number=turn_number,
        finalization_id=finalization_id,
        journal_decision_id=f"journal-{turn_number}",
        settlement_snapshot_id=f"settle-{turn_number}",
        rendered_text_sha256="a" * 64,
        schema_generation=SCHEMA,
    )


def _prepare_main_turn(root: Path) -> tuple[Path, str]:
    worktree = _seed(root)
    hist.ensure_repo(root, CAMPAIGN_ID)
    hist.commit_baseline(
        root, CAMPAIGN_ID, schema_generation=SCHEMA, note="dag baseline"
    )
    (worktree / "save" / "world-state.json").write_text(
        json.dumps({"status": "active", "turn": 1, "branch": "main"}) + "\n",
        encoding="utf-8",
    )
    sha = _commit_turn(root, 1, "fin-0001")
    return worktree, sha


def test_fork_creation_activation_and_immutability(tmp_path):
    worktree, source = _prepare_main_turn(tmp_path)
    main_before = _git(tmp_path, "rev-parse", "refs/heads/main").strip()
    assert main_before == source

    created = hist.fork_timeline(
        tmp_path,
        CAMPAIGN_ID,
        timeline_id="tl-door-retry",
        source_timeline_id="tl-main",
        source_turn=1,
        game_reason="player asked to retry the door",
        created_by="player_request",
        activate=True,
    )
    assert created["idempotent"] is False
    assert created["source_commit"] == source
    assert created["ref"] == "refs/heads/timelines/tl-door-retry"
    assert created["game_reason"] == "player asked to retry the door"
    fork_sha = _git(tmp_path, "rev-parse", created["ref"]).strip()
    assert fork_sha == source
    assert _git(tmp_path, "rev-parse", "HEAD").strip() == source
    assert _git(tmp_path, "rev-parse", "refs/heads/main").strip() == main_before
    assert hist.active_timeline_id(tmp_path, CAMPAIGN_ID) == "tl-door-retry"

    replay = hist.fork_timeline(
        tmp_path,
        CAMPAIGN_ID,
        timeline_id="tl-door-retry",
        source_timeline_id="tl-main",
        source_turn=1,
        game_reason="player asked to retry the door",
        created_by="player_request",
    )
    assert replay["idempotent"] is True
    assert replay["source_commit"] == source
    assert _git(tmp_path, "rev-parse", "refs/heads/main").strip() == main_before
    assert _git(tmp_path, "rev-parse", created["ref"]).strip() == source

    state = hist.load_timeline_state(tmp_path, CAMPAIGN_ID)
    tm.validate_timeline_set(
        state["timelines"], active_timeline_id=state["active_timeline_id"]
    )
    assert (worktree / hist.TIMELINE_STATE_RELPATH).is_file()


def test_active_timeline_switching_commits_without_moving_main(tmp_path):
    worktree, source = _prepare_main_turn(tmp_path)
    hist.fork_timeline(
        tmp_path,
        CAMPAIGN_ID,
        timeline_id="tl-alt",
        source_turn=1,
        game_reason="kp forks for a second approach",
        activate=True,
    )
    (worktree / "save" / "world-state.json").write_text(
        json.dumps({"status": "active", "turn": 2, "branch": "alt"}) + "\n",
        encoding="utf-8",
    )
    fork_sha = _commit_turn(tmp_path, 2, "fin-0002")
    assert fork_sha != source
    assert _git(tmp_path, "rev-parse", "refs/heads/main").strip() == source
    assert _git(tmp_path, "rev-parse", "HEAD").strip() == source
    assert _git(tmp_path, "rev-parse", "refs/heads/timelines/tl-alt").strip() == fork_sha
    trailers = hist.parse_trailers(_git(tmp_path, "log", "-1", "--format=%B", fork_sha))
    assert trailers["Timeline-Id"] == "tl-alt"
    assert trailers["COC-Commit-Type"] == "turn"
    assert trailers["Finalization-Id"] == "fin-0002"

    replay = _commit_turn(tmp_path, 2, "fin-0002")
    assert replay == fork_sha

    hist.set_active_timeline(tmp_path, CAMPAIGN_ID, "tl-main")
    assert hist.active_timeline_id(tmp_path, CAMPAIGN_ID) == "tl-main"
    assert _git(tmp_path, "rev-parse", "refs/heads/main").strip() == source


def _prepare_confluence_parents(
    root: Path,
    *,
    left_extra: Path | None = None,
    right_extra: Path | None = None,
) -> tuple[Path, str, str, str]:
    """Seed main turn 1 plus tl-left/tl-right turn-2 commits.

    ``left_extra``/``right_extra`` are (relpath, text) pairs committed only on
    that side, for testing unmanifested diffs.
    """
    worktree, source = _prepare_main_turn(root)
    hist.fork_timeline(
        root,
        CAMPAIGN_ID,
        timeline_id="tl-left",
        source_turn=1,
        game_reason="left fork",
        activate=True,
    )
    (worktree / "save" / "world-state.json").write_text(
        json.dumps({"status": "active", "turn": 2, "branch": "left"}) + "\n",
        encoding="utf-8",
    )
    if left_extra is not None:
        relpath, text = left_extra
        target = worktree / relpath
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
    left_sha = _commit_turn(root, 2, "fin-left-2")

    hist.set_active_timeline(root, CAMPAIGN_ID, "tl-main")
    hist.fork_timeline(
        root,
        CAMPAIGN_ID,
        timeline_id="tl-right",
        source_turn=1,
        game_reason="right fork",
        activate=True,
    )
    (worktree / "save" / "world-state.json").write_text(
        json.dumps({"status": "active", "turn": 2, "branch": "right"}) + "\n",
        encoding="utf-8",
    )
    if right_extra is not None:
        relpath, text = right_extra
        target = worktree / relpath
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
    right_sha = _commit_turn(root, 2, "fin-right-2")
    return worktree, source, left_sha, right_sha


def _confluence_conflicts(
    confluence_id: str,
    *,
    mode: str = "choose_left",
    conflict_class: str = "world_fact",
    disposition_extra: dict | None = None,
) -> list[dict]:
    conflict_id = tm.conflict_id_for(confluence_id, "world-state")
    disposition = {"mode": mode, "receipt": "disp-world-state"}
    if disposition_extra:
        disposition = {**disposition, **disposition_extra}
    return [
        {
            "conflict_id": conflict_id,
            "class": conflict_class,
            "left": {
                "timeline": "tl-left",
                "refs": ["save/world-state.json"],
                "value": "left",
            },
            "right": {
                "timeline": "tl-right",
                "refs": ["save/world-state.json"],
                "value": "right",
            },
            "disposition": disposition,
        }
    ]


def _run_confluence(
    root: Path,
    confluence_id: str,
    conflicts: list[dict],
    *,
    path_resolutions=None,
    timeline_id: str = "tl-merged",
    game_reason: str = "timeline confluence",
):
    return hist.confluence_timelines(
        root,
        CAMPAIGN_ID,
        timeline_id=timeline_id,
        left_timeline_id="tl-left",
        right_timeline_id="tl-right",
        receipt="confluence-receipt-1",
        schema_generation=SCHEMA,
        conflicts=conflicts,
        path_resolutions=path_resolutions,
        confluence_id=confluence_id,
        game_reason=game_reason,
    )


def _ref_exists(root: Path, ref: str) -> bool:
    completed = subprocess.run(
        [
            "git",
            f"--git-dir={_repo(root)}",
            "rev-parse",
            "--verify",
            "-q",
            ref,
        ],
        capture_output=True,
        text=True,
    )
    return completed.returncode == 0


def test_confluence_rejects_resolutions_contradicting_manifest(tmp_path):
    _prepare_confluence_parents(tmp_path)
    confluence_id = f"confluence-{CAMPAIGN_ID}-tl-merged"
    conflicts = _confluence_conflicts(confluence_id)  # choose_left
    with pytest.raises(hist.GitHistoryError, match="contradicts the manifest"):
        _run_confluence(
            tmp_path,
            confluence_id,
            conflicts,
            path_resolutions={"save/world-state.json": "choose_right"},
        )
    with pytest.raises(hist.GitHistoryError, match="contradicts the manifest"):
        _run_confluence(
            tmp_path,
            confluence_id,
            conflicts,
            path_resolutions={
                "save/world-state.json": {
                    "mode": "choose_left",
                    "content": '{"smuggled": true}\n',
                }
            },
        )
    assert not _ref_exists(tmp_path, "refs/heads/timelines/tl-merged")


def test_confluence_rejects_unmanifested_path_resolution(tmp_path):
    _prepare_confluence_parents(tmp_path)
    confluence_id = f"confluence-{CAMPAIGN_ID}-tl-merged"
    conflicts = _confluence_conflicts(confluence_id)
    with pytest.raises(
        hist.GitHistoryError, match="does not correspond to any conflict"
    ):
        _run_confluence(
            tmp_path,
            confluence_id,
            conflicts,
            path_resolutions={"save/unrelated.json": "choose_left"},
        )


def test_confluence_uncovered_tree_diff_fails_closed(tmp_path):
    _prepare_confluence_parents(
        tmp_path,
        left_extra=("campaign.json", '{"campaign_id": "x", "title": "L"}\n'),
        right_extra=("campaign.json", '{"campaign_id": "x", "title": "R"}\n'),
    )
    confluence_id = f"confluence-{CAMPAIGN_ID}-tl-merged"
    conflicts = _confluence_conflicts(confluence_id)  # covers world-state only
    with pytest.raises(
        hist.GitHistoryError, match="unresolved confluence tree paths: campaign.json"
    ):
        _run_confluence(tmp_path, confluence_id, conflicts)
    assert not _ref_exists(tmp_path, "refs/heads/timelines/tl-merged")


def test_confluence_transform_requires_hard_state_and_content(tmp_path):
    _prepare_confluence_parents(tmp_path)
    confluence_id = f"confluence-{CAMPAIGN_ID}-tl-merged"
    soft = _confluence_conflicts(confluence_id, mode="transform")
    with pytest.raises(
        hist.GitHistoryError, match="transform dispositions require a hard-state"
    ):
        _run_confluence(
            tmp_path,
            confluence_id,
            soft,
            path_resolutions={"save/world-state.json": '{"merged": true}\n'},
        )

    hard = _confluence_conflicts(
        confluence_id,
        mode="transform",
        conflict_class="stat_value",
        disposition_extra={"resolver_receipt": "resolver-dec-1"},
    )
    with pytest.raises(
        hist.GitHistoryError, match="requires canonical resolver content"
    ):
        _run_confluence(tmp_path, confluence_id, hard, path_resolutions=None)

    merged = _run_confluence(
        tmp_path,
        confluence_id,
        hard,
        path_resolutions={"save/world-state.json": '{"merged": true}\n'},
    )
    assert merged["idempotent"] is False
    shown = _git(tmp_path, "show", f"{merged['merge_commit']}:save/world-state.json")
    assert '"merged": true' in shown


def test_confluence_state_write_failure_rolls_back_ref(tmp_path, monkeypatch):
    worktree, source, left_sha, right_sha = _prepare_confluence_parents(tmp_path)
    confluence_id = f"confluence-{CAMPAIGN_ID}-tl-merged"
    conflicts = _confluence_conflicts(confluence_id)
    state_path = worktree / hist.TIMELINE_STATE_RELPATH
    state_before = state_path.read_bytes()
    main_before = _git(tmp_path, "rev-parse", "refs/heads/main").strip()

    def boom(*_args, **_kwargs):
        raise hist.GitHistoryError("injected: timeline-state write failed")

    monkeypatch.setattr(hist, "_write_timeline_state", boom)
    with pytest.raises(hist.GitHistoryError, match="injected"):
        _run_confluence(
            tmp_path,
            confluence_id,
            conflicts,
            path_resolutions={"save/world-state.json": "choose_left"},
        )
    # Rollback: the unregistered confluence ref is gone, every parent ref,
    # main, HEAD, and the persisted timeline state stay coherent, and no
    # confluence commit is reachable from any ref.
    assert not _ref_exists(tmp_path, "refs/heads/timelines/tl-merged")
    assert _git(tmp_path, "rev-parse", "refs/heads/main").strip() == main_before
    assert (
        _git(tmp_path, "rev-parse", "refs/heads/timelines/tl-left").strip() == left_sha
    )
    assert (
        _git(tmp_path, "rev-parse", "refs/heads/timelines/tl-right").strip()
        == right_sha
    )
    assert _git(tmp_path, "rev-parse", "HEAD").strip() == main_before
    assert state_path.read_bytes() == state_before
    bodies = _git(tmp_path, "log", "--all", "--format=%B")
    assert "coc confluence:" not in bodies

    # Retry with the writer restored registers cleanly.
    monkeypatch.undo()
    merged = _run_confluence(
        tmp_path,
        confluence_id,
        conflicts,
        path_resolutions={"save/world-state.json": "choose_left"},
    )
    assert merged["idempotent"] is False
    assert _ref_exists(tmp_path, "refs/heads/timelines/tl-merged")
    state = hist.load_timeline_state(tmp_path, CAMPAIGN_ID)
    assert [c["confluence_id"] for c in state["confluences"]] == [confluence_id]


def test_confluence_recovers_ref_from_state_write_crash_window(tmp_path, monkeypatch):
    worktree, _source, _left, _right = _prepare_confluence_parents(tmp_path)
    confluence_id = f"confluence-{CAMPAIGN_ID}-tl-merged"
    conflicts = _confluence_conflicts(confluence_id)
    state_path = worktree / hist.TIMELINE_STATE_RELPATH
    state_before = state_path.read_bytes()

    swallowed: list[dict] = []

    def swallow(_worktree, state):
        # Simulate a hard crash between update-ref and the state write.
        swallowed.append(dict(state))

    monkeypatch.setattr(hist, "_write_timeline_state", swallow)
    crashed = _run_confluence(
        tmp_path,
        confluence_id,
        conflicts,
        path_resolutions={"save/world-state.json": "choose_left"},
    )
    assert crashed["idempotent"] is False
    assert _ref_exists(tmp_path, "refs/heads/timelines/tl-merged")
    assert state_path.read_bytes() == state_before  # registration never landed

    monkeypatch.undo()
    recovered = _run_confluence(
        tmp_path,
        confluence_id,
        conflicts,
        path_resolutions={"save/world-state.json": "choose_left"},
    )
    assert recovered.get("recovered") is True
    assert recovered["merge_commit"] == crashed["merge_commit"]
    state = hist.load_timeline_state(tmp_path, CAMPAIGN_ID)
    assert [c["confluence_id"] for c in state["confluences"]] == [confluence_id]
    assert state_path.read_bytes() != state_before

    replay = _run_confluence(
        tmp_path,
        confluence_id,
        conflicts,
        path_resolutions={"save/world-state.json": "choose_left"},
    )
    assert replay["idempotent"] is True
    assert replay["merge_commit"] == crashed["merge_commit"]


def test_confluence_recovery_rejects_foreign_orphan_ref(tmp_path, monkeypatch):
    _prepare_confluence_parents(tmp_path)
    confluence_id = f"confluence-{CAMPAIGN_ID}-tl-merged"
    conflicts = _confluence_conflicts(confluence_id)

    def swallow(_worktree, _state):
        pass

    monkeypatch.setattr(hist, "_write_timeline_state", swallow)
    _run_confluence(
        tmp_path,
        confluence_id,
        conflicts,
        path_resolutions={"save/world-state.json": "choose_left"},
    )
    monkeypatch.undo()

    # A different confluence (different game reason) must not adopt the
    # orphan ref: recovery fails closed instead of registering silently.
    with pytest.raises(
        hist.GitHistoryError, match="does not match this confluence"
    ):
        _run_confluence(
            tmp_path,
            confluence_id,
            conflicts,
            path_resolutions={"save/world-state.json": "choose_left"},
            game_reason="a different reason",
        )


def test_fork_state_write_failure_rolls_back_and_recovers(tmp_path, monkeypatch):
    worktree, source = _prepare_main_turn(tmp_path)
    state_path = worktree / hist.TIMELINE_STATE_RELPATH
    assert not state_path.exists()

    def boom(*_args, **_kwargs):
        raise hist.GitHistoryError("injected: fork state write failed")

    monkeypatch.setattr(hist, "_write_timeline_state", boom)
    with pytest.raises(hist.GitHistoryError, match="injected"):
        hist.fork_timeline(
            tmp_path,
            CAMPAIGN_ID,
            timeline_id="tl-door-retry",
            source_turn=1,
            game_reason="player asked to retry the door",
        )
    assert not _ref_exists(tmp_path, "refs/heads/timelines/tl-door-retry")
    assert _git(tmp_path, "rev-parse", "refs/heads/main").strip() == source
    assert not state_path.exists()

    # Crash-window recovery: ref created, state write lost.
    monkeypatch.setattr(
        hist, "_write_timeline_state", lambda *_args, **_kwargs: None
    )
    hist.fork_timeline(
        tmp_path,
        CAMPAIGN_ID,
        timeline_id="tl-door-retry",
        source_turn=1,
        game_reason="player asked to retry the door",
    )
    assert _ref_exists(tmp_path, "refs/heads/timelines/tl-door-retry")
    assert not state_path.exists()

    monkeypatch.undo()
    recovered = hist.fork_timeline(
        tmp_path,
        CAMPAIGN_ID,
        timeline_id="tl-door-retry",
        source_turn=1,
        game_reason="player asked to retry the door",
    )
    assert recovered.get("recovered") is True
    assert recovered["source_commit"] == source
    state = hist.load_timeline_state(tmp_path, CAMPAIGN_ID)
    assert [t["timeline_id"] for t in state["timelines"]] == [
        "tl-main",
        "tl-door-retry",
    ]


def test_confluence_two_parent_commit_and_trailer_completeness(tmp_path):
    worktree, source = _prepare_main_turn(tmp_path)
    hist.fork_timeline(
        tmp_path,
        CAMPAIGN_ID,
        timeline_id="tl-left",
        source_turn=1,
        game_reason="left fork",
        activate=True,
    )
    (worktree / "save" / "world-state.json").write_text(
        json.dumps({"status": "active", "turn": 2, "branch": "left"}) + "\n",
        encoding="utf-8",
    )
    left_sha = _commit_turn(tmp_path, 2, "fin-left-2")

    hist.set_active_timeline(tmp_path, CAMPAIGN_ID, "tl-main")
    hist.fork_timeline(
        tmp_path,
        CAMPAIGN_ID,
        timeline_id="tl-right",
        source_turn=1,
        game_reason="right fork",
        activate=True,
    )
    (worktree / "save" / "world-state.json").write_text(
        json.dumps({"status": "active", "turn": 2, "branch": "right"}) + "\n",
        encoding="utf-8",
    )
    right_sha = _commit_turn(tmp_path, 2, "fin-right-2")
    assert left_sha != right_sha
    assert _git(tmp_path, "rev-parse", "refs/heads/main").strip() == source

    confluence_id = f"confluence-{CAMPAIGN_ID}-tl-merged"
    conflict_id = tm.conflict_id_for(confluence_id, "world-state")
    conflicts = [
        {
            "conflict_id": conflict_id,
            "class": "world_fact",
            "left": {
                "timeline": "tl-left",
                "refs": ["save/world-state.json"],
                "value": "left",
            },
            "right": {
                "timeline": "tl-right",
                "refs": ["save/world-state.json"],
                "value": "right",
            },
            "disposition": {
                "mode": "choose_left",
                "receipt": "disp-world-state",
            },
        }
    ]
    tm.validate_confluence(
        {
            "confluence_id": confluence_id,
            "campaign_id": CAMPAIGN_ID,
            "timeline_id": "tl-merged",
            "parents": ["tl-left", "tl-right"],
            "merge_commit": "0" * 40,
            "receipt": "confluence-receipt-1",
            "conflicts": conflicts,
        }
    )
    merged = hist.confluence_timelines(
        tmp_path,
        CAMPAIGN_ID,
        timeline_id="tl-merged",
        left_timeline_id="tl-left",
        right_timeline_id="tl-right",
        receipt="confluence-receipt-1",
        schema_generation=SCHEMA,
        conflicts=conflicts,
        path_resolutions={"save/world-state.json": "choose_left"},
        confluence_id=confluence_id,
        activate=False,
    )
    assert merged["idempotent"] is False
    merge_sha = merged["merge_commit"]
    parents = _git(tmp_path, "rev-list", "--no-walk", "--parents", merge_sha).split()
    assert parents[0] == merge_sha
    assert set(parents[1:]) == {left_sha, right_sha}
    assert parents[1] == left_sha
    assert parents[2] == right_sha
    assert _git(tmp_path, "rev-parse", "refs/heads/main").strip() == source
    assert _git(tmp_path, "rev-parse", "refs/heads/timelines/tl-left").strip() == left_sha
    assert _git(tmp_path, "rev-parse", "refs/heads/timelines/tl-right").strip() == right_sha
    assert _git(tmp_path, "rev-parse", "HEAD").strip() == source

    trailers = hist.parse_trailers(_git(tmp_path, "log", "-1", "--format=%B", merge_sha))
    assert trailers["COC-Commit-Type"] == "confluence"
    assert trailers["Timeline-Id"] == "tl-merged"
    assert trailers["Confluence-Id"] == confluence_id
    assert trailers["Parent-Timeline-Left"] == "tl-left"
    assert trailers["Parent-Timeline-Right"] == "tl-right"
    assert len(trailers["Conflict-Manifest-SHA256"]) == 64
    assert len(trailers["Disposition-Manifest-SHA256"]) == 64
    assert trailers["Conflict-Manifest-SHA256"] == tm.record_digest(
        {"conflicts": conflicts}
    )
    shown = _git(tmp_path, "show", f"{merge_sha}:save/world-state.json")
    assert '"branch": "left"' in shown

    again = hist.confluence_timelines(
        tmp_path,
        CAMPAIGN_ID,
        timeline_id="tl-merged",
        left_timeline_id="tl-left",
        right_timeline_id="tl-right",
        receipt="confluence-receipt-1",
        schema_generation=SCHEMA,
        conflicts=conflicts,
        path_resolutions={"save/world-state.json": "choose_left"},
        confluence_id=confluence_id,
    )
    assert again["idempotent"] is True
    assert again["merge_commit"] == merge_sha
    assert _git(tmp_path, "rev-parse", "refs/heads/main").strip() == source


def test_history_query_and_diff(tmp_path):
    worktree, source = _prepare_main_turn(tmp_path)
    hist.fork_timeline(
        tmp_path,
        CAMPAIGN_ID,
        timeline_id="tl-query",
        source_turn=1,
        game_reason="query fork",
        activate=True,
    )
    (worktree / "save" / "world-state.json").write_text(
        json.dumps({"status": "active", "turn": 2, "branch": "query"}) + "\n",
        encoding="utf-8",
    )
    fork_sha = _commit_turn(tmp_path, 2, "fin-query-2")

    tip = hist.history_query(tmp_path, CAMPAIGN_ID, {"timeline_id": "tl-query"})
    assert tip["commit"] == fork_sha
    assert tip["timeline_id"] == "tl-query"
    assert any(item["path"] == "save/world-state.json" for item in tip["tree"])

    turn1 = hist.history_query(
        tmp_path,
        CAMPAIGN_ID,
        {"timeline_id": "tl-main", "turn": 1, "path": "save/world-state.json"},
    )
    assert turn1["commit"] == source
    assert '"branch": "main"' in turn1["content"]["save/world-state.json"]

    diff = hist.history_diff(
        tmp_path,
        CAMPAIGN_ID,
        {"timeline_id": "tl-main", "turn": 1},
        {"timeline_id": "tl-query", "turn": 2},
    )
    paths = {item["path"]: item for item in diff["changes"]}
    assert "save/world-state.json" in paths
    assert paths["save/world-state.json"]["status"] == "M"
    assert paths["save/world-state.json"]["from_blob"] != paths["save/world-state.json"]["to_blob"]
    assert diff["from"]["commit"] == source
    assert diff["to"]["commit"] == fork_sha


def test_time_fork_calls_coordinator(tmp_path):
    worktree, source = _prepare_main_turn(tmp_path)
    coc_time.initialize_time_state(
        worktree,
        start={"campaign_id": CAMPAIGN_ID, "timeline_id": "tl-main"},
    )
    created = coc_time._fork_timeline(
        worktree,
        new_branch_id="night-path",
        forked_from={
            "timeline_id": "tl-main",
            "turn": 1,
            "game_reason": "if they wait until night",
        },
    )
    assert created["timeline_id"] == "tl-night-path"
    assert created["source_commit"] == source
    clock = coc_time.read_time_state(worktree)
    assert clock["timeline_id"] == "tl-night-path"
    assert clock["branch_id"] == "night-path"
    assert hist.active_timeline_id(tmp_path, CAMPAIGN_ID) == "tl-night-path"
    assert _git(tmp_path, "rev-parse", "refs/heads/main").strip() == source
