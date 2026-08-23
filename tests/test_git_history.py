"""Commit Coordinator: per-campaign sidecar git history."""
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
coc_state = load_module("coc_state", SCRIPTS / "coc_state.py")

SCHEMA = hist.format_schema_generation(coc_state.CURRENT_SCHEMA_VERSIONS)
CAMPAIGN_ID = "hist-camp"


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


def _commit_count(root: Path, campaign_id: str = CAMPAIGN_ID) -> int:
    repo = _repo(root, campaign_id)
    if not (repo / "HEAD").is_file():
        return 0
    probe = subprocess.run(
        [
            "git",
            f"--git-dir={repo}",
            f"--work-tree={_worktree(root, campaign_id)}",
            "rev-parse",
            "--verify",
            "-q",
            "HEAD",
        ],
        capture_output=True,
        text=True,
    )
    if probe.returncode != 0:
        return 0
    return int(_git(root, "rev-list", "--count", "HEAD", campaign_id=campaign_id).strip())


def _trailers(root: Path, rev: str = "HEAD", campaign_id: str = CAMPAIGN_ID) -> dict[str, str]:
    message = _git(root, "log", "-1", "--format=%B", rev, campaign_id=campaign_id)
    return hist.parse_trailers(message)


def _tree_names(root: Path, rev: str = "HEAD", campaign_id: str = CAMPAIGN_ID) -> set[str]:
    text = _git(root, "ls-tree", "-r", "--name-only", rev, campaign_id=campaign_id)
    return {line for line in text.splitlines() if line}


def _seed_campaign_files(root: Path, campaign_id: str = CAMPAIGN_ID) -> Path:
    worktree = _worktree(root, campaign_id)
    (worktree / "save").mkdir(parents=True, exist_ok=True)
    (worktree / "logs").mkdir(parents=True, exist_ok=True)
    (worktree / "memory").mkdir(parents=True, exist_ok=True)
    (worktree / "campaign.json").write_text(
        json.dumps({"campaign_id": campaign_id, "title": "Seed"}, indent=2) + "\n",
        encoding="utf-8",
    )
    (worktree / "save" / "world-state.json").write_text(
        json.dumps({"status": "setup"}) + "\n", encoding="utf-8"
    )
    (worktree / "logs" / "events.jsonl").write_text("", encoding="utf-8")
    (worktree / "memory" / "session-summaries.jsonl").write_text("", encoding="utf-8")
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


def test_ensure_repo_creates_bare_repo_and_exclude(tmp_path):
    repo = hist.ensure_repo(tmp_path, CAMPAIGN_ID)
    assert repo == _repo(tmp_path)
    assert (repo / "HEAD").is_file()
    assert (repo / "objects").is_dir()
    assert not (_worktree(tmp_path) / ".git").exists()
    head = (repo / "HEAD").read_text(encoding="utf-8")
    assert "refs/heads/main" in head
    exclude = (repo / "info" / "exclude").read_text(encoding="utf-8").splitlines()
    assert exclude == list(hist.IGNORE_PATHS)
    assert _commit_count(tmp_path) == 0

    hist.ensure_repo(tmp_path, CAMPAIGN_ID)
    assert _commit_count(tmp_path) == 0
    assert (repo / "info" / "exclude").read_text(encoding="utf-8").splitlines() == list(
        hist.IGNORE_PATHS
    )


def test_commit_baseline_trailers_tree_and_second_call_returns_head(tmp_path):
    _seed_campaign_files(tmp_path)
    hist.ensure_repo(tmp_path, CAMPAIGN_ID)
    sha = hist.commit_baseline(
        tmp_path, CAMPAIGN_ID, schema_generation=SCHEMA, note="initial campaign generation"
    )
    assert sha == _git(tmp_path, "rev-parse", "HEAD").strip()
    assert _commit_count(tmp_path) == 1
    subject = _git(tmp_path, "log", "-1", "--format=%s").strip()
    assert subject == "coc baseline: initial campaign generation"
    trailers = _trailers(tmp_path)
    assert trailers["COC-Commit-Type"] == "baseline"
    assert trailers["Campaign-Id"] == CAMPAIGN_ID
    assert trailers["Timeline-Id"] == "tl-main"
    assert trailers["Schema-Generation"] == SCHEMA
    names = _tree_names(tmp_path)
    assert "campaign.json" in names
    assert "save/world-state.json" in names
    assert "logs/events.jsonl" in names
    assert "memory/session-summaries.jsonl" in names

    again = hist.commit_baseline(
        tmp_path, CAMPAIGN_ID, schema_generation=SCHEMA, note="should not land twice"
    )
    assert again == sha
    assert _commit_count(tmp_path) == 1


def test_commit_finalized_turn_trailers_and_tree(tmp_path):
    _seed_campaign_files(tmp_path)
    hist.ensure_repo(tmp_path, CAMPAIGN_ID)
    hist.commit_baseline(
        tmp_path, CAMPAIGN_ID, schema_generation=SCHEMA, note="initial campaign generation"
    )
    worktree = _worktree(tmp_path)
    (worktree / "campaign.json").write_text(
        json.dumps({"campaign_id": CAMPAIGN_ID, "title": "Turn 1"}) + "\n",
        encoding="utf-8",
    )
    (worktree / "save" / "world-state.json").write_text(
        json.dumps({"status": "active", "turn": 1}) + "\n", encoding="utf-8"
    )
    with (worktree / "logs" / "events.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({"turn": 1}) + "\n")
    (worktree / "memory" / "session-summaries.jsonl").write_text(
        json.dumps({"note": "remembered"}) + "\n", encoding="utf-8"
    )

    sha = _commit_turn(tmp_path, 1, "fin-0001")
    assert _commit_count(tmp_path) == 2
    assert sha == _git(tmp_path, "rev-parse", "HEAD").strip()
    assert _git(tmp_path, "log", "-1", "--format=%s").strip() == "coc turn 0001: fin-0001"
    trailers = _trailers(tmp_path)
    assert trailers == {
        "COC-Commit-Type": "turn",
        "Campaign-Id": CAMPAIGN_ID,
        "Timeline-Id": "tl-main",
        "Turn-Number": "1",
        "Finalization-Id": "fin-0001",
        "Journal-Decision-Id": "journal-1",
        "Settlement-Snapshot-Id": "settle-1",
        "Rendered-Text-SHA256": "a" * 64,
        "Schema-Generation": SCHEMA,
    }
    names = _tree_names(tmp_path)
    assert "campaign.json" in names
    assert "save/world-state.json" in names
    assert "logs/events.jsonl" in names
    assert "memory/session-summaries.jsonl" in names
    shown = _git(tmp_path, "show", "HEAD:campaign.json")
    assert "Turn 1" in shown
    shown_save = _git(tmp_path, "show", "HEAD:save/world-state.json")
    assert "active" in shown_save
    shown_log = _git(tmp_path, "show", "HEAD:logs/events.jsonl")
    assert '"turn": 1' in shown_log
    shown_mem = _git(tmp_path, "show", "HEAD:memory/session-summaries.jsonl")
    assert "remembered" in shown_mem


def test_commit_finalized_turn_is_idempotent_on_finalization_id(tmp_path):
    _seed_campaign_files(tmp_path)
    hist.ensure_repo(tmp_path, CAMPAIGN_ID)
    hist.commit_baseline(
        tmp_path, CAMPAIGN_ID, schema_generation=SCHEMA, note="initial campaign generation"
    )
    first = _commit_turn(tmp_path, 1, "fin-same")
    (_worktree(tmp_path) / "save" / "world-state.json").write_text(
        '{"mutated": true}\n', encoding="utf-8"
    )
    second = _commit_turn(tmp_path, 1, "fin-same")
    assert second == first
    assert _commit_count(tmp_path) == 2


def test_ignored_paths_are_absent_from_tree(tmp_path):
    worktree = _seed_campaign_files(tmp_path)
    hist.ensure_repo(tmp_path, CAMPAIGN_ID)
    hist.commit_baseline(
        tmp_path, CAMPAIGN_ID, schema_generation=SCHEMA, note="initial campaign generation"
    )
    (worktree / "save" / "session-state.json").write_text('{"junk": 1}\n', encoding="utf-8")
    (worktree / "save" / "toolbox-ledger.json").write_text('{"junk": 2}\n', encoding="utf-8")
    pending = worktree / "logs" / "pending-turns"
    pending.mkdir(parents=True)
    (pending / "queued.json").write_text("{}\n", encoding="utf-8")
    snapshots = worktree / "save" / "commit-snapshots" / "fin-x"
    snapshots.mkdir(parents=True)
    (snapshots / "world-state.json").write_text("{}\n", encoding="utf-8")
    (worktree / "memory" / "index.json").write_text('{"cards": []}\n', encoding="utf-8")
    (worktree / "save" / "world-state.json").write_text('{"ok": true}\n', encoding="utf-8")

    _commit_turn(tmp_path, 1, "fin-ignore")
    names = _tree_names(tmp_path)
    assert "save/session-state.json" not in names
    assert "save/toolbox-ledger.json" not in names
    assert "memory/index.json" not in names
    assert not any(name.startswith("logs/pending-turns/") for name in names)
    assert not any(name.startswith("save/commit-snapshots/") for name in names)
    assert "save/world-state.json" in names


def test_git_missing_raises_unavailable(tmp_path, monkeypatch):
    empty_bin = tmp_path / "_empty_bin"
    empty_bin.mkdir()
    monkeypatch.setenv("PATH", str(empty_bin))
    monkeypatch.setattr(hist.shutil, "which", lambda _name: None)

    def boom(*_args, **_kwargs):
        raise FileNotFoundError("git")

    monkeypatch.setattr(hist.subprocess, "run", boom)
    with pytest.raises(hist.GitHistoryUnavailableError, match="git"):
        hist.ensure_repo(tmp_path, CAMPAIGN_ID)


def test_five_turns_fsck_strict_and_log_count(tmp_path):
    worktree = _seed_campaign_files(tmp_path)
    hist.ensure_repo(tmp_path, CAMPAIGN_ID)
    hist.commit_baseline(
        tmp_path, CAMPAIGN_ID, schema_generation=SCHEMA, note="initial campaign generation"
    )
    for turn in range(1, 6):
        payload = json.loads((worktree / "save" / "world-state.json").read_text(encoding="utf-8"))
        payload["turn"] = turn
        (worktree / "save" / "world-state.json").write_text(
            json.dumps(payload) + "\n", encoding="utf-8"
        )
        with (worktree / "logs" / "events.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"turn": turn, "event": f"e{turn}"}) + "\n")
        _commit_turn(tmp_path, turn, f"fin-{turn:04d}")

    fsck = subprocess.run(
        [
            "git",
            f"--git-dir={_repo(tmp_path)}",
            f"--work-tree={worktree}",
            "fsck",
            "--strict",
        ],
        capture_output=True,
        text=True,
    )
    assert fsck.returncode == 0, fsck.stderr
    assert _commit_count(tmp_path) == 6
    subjects = _git(tmp_path, "log", "--reverse", "--format=%s").splitlines()
    assert subjects[0] == "coc baseline: initial campaign generation"
    assert subjects[-1] == "coc turn 0005: fin-0005"


def test_create_campaign_lands_repo_and_baseline(tmp_path):
    coc_state.create_campaign(tmp_path, CAMPAIGN_ID, "Git Create")
    repo = _repo(tmp_path)
    assert repo.is_dir()
    assert (_repo(tmp_path) / "info" / "exclude").is_file()
    assert not (_worktree(tmp_path) / ".git").exists()
    assert _commit_count(tmp_path) == 1
    trailers = _trailers(tmp_path)
    assert trailers["COC-Commit-Type"] == "baseline"
    assert trailers["Campaign-Id"] == CAMPAIGN_ID
    assert trailers["Schema-Generation"] == SCHEMA
    names = _tree_names(tmp_path)
    assert "campaign.json" in names
    assert "save/world-state.json" in names
    assert "save/session-state.json" not in names


def test_rejects_unsafe_campaign_id(tmp_path):
    with pytest.raises(ValueError, match="stable safe id"):
        hist.ensure_repo(tmp_path, "../escape")
    with pytest.raises(ValueError, match="stable safe id"):
        hist.ensure_repo(tmp_path, "has/slash")
    assert not (tmp_path / ".coc" / "repos").exists()


def test_no_global_git_identity_required(tmp_path):
    assert "HOME" in os.environ
    home = Path(os.environ["HOME"])
    assert home.is_dir()
    assert list(home.iterdir()) == []
    _seed_campaign_files(tmp_path)
    hist.ensure_repo(tmp_path, CAMPAIGN_ID)
    sha = hist.commit_baseline(
        tmp_path, CAMPAIGN_ID, schema_generation=SCHEMA, note="clean-home"
    )
    ident = _git(tmp_path, "log", "-1", "--format=%an <%ae>")
    assert ident.strip() == "coc-keeper <coc-keeper@localhost>"
    assert sha
