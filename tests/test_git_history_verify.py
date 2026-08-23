"""Read-only git-history diagnostic."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
VERIFY_SCRIPT = SCRIPTS / "coc_git_history_verify.py"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


hist = load_module("coc_git_history", SCRIPTS / "coc_git_history.py")
verify = load_module("coc_git_history_verify", VERIFY_SCRIPT)
coc_state = load_module("coc_state", SCRIPTS / "coc_state.py")

SCHEMA = hist.format_schema_generation(coc_state.CURRENT_SCHEMA_VERSIONS)
CAMPAIGN_ID = "hist-verify"


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


def _git(
    root: Path,
    *args: str,
    campaign_id: str = CAMPAIGN_ID,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    env["GIT_CONFIG_GLOBAL"] = os.devnull
    env["GIT_CONFIG_SYSTEM"] = os.devnull
    env["GIT_TERMINAL_PROMPT"] = "0"
    completed = subprocess.run(
        [
            "git",
            "-c",
            "user.name=coc-keeper",
            "-c",
            "user.email=coc-keeper@localhost",
            "-c",
            "commit.gpgsign=false",
            "-c",
            "safe.directory=*",
            f"--git-dir={_repo(root, campaign_id)}",
            f"--work-tree={_worktree(root, campaign_id)}",
            *args,
        ],
        check=check,
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=env,
    )
    return completed


def _tree_fingerprint(path: Path) -> str:
    digest = hashlib.sha256()
    if not path.exists():
        return "missing"
    for item in sorted(path.rglob("*"), key=lambda p: p.as_posix()):
        rel = item.relative_to(path).as_posix().encode("utf-8")
        if item.is_symlink():
            digest.update(b"L")
            digest.update(rel)
            digest.update(os.readlink(item).encode("utf-8", errors="replace"))
        elif item.is_file():
            digest.update(b"F")
            digest.update(rel)
            digest.update(item.read_bytes())
        elif item.is_dir():
            digest.update(b"D")
            digest.update(rel)
    return digest.hexdigest()


def _workspace_fingerprint(root: Path) -> tuple[str, str, str]:
    return (
        _tree_fingerprint(root / ".coc"),
        _tree_fingerprint(_worktree(root)),
        _tree_fingerprint(_repo(root)),
    )


def _write_receipts(root: Path, finalization_ids: list[str]) -> None:
    path = _worktree(root) / "logs" / "turn-finalizations.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = []
    for index, fid in enumerate(finalization_ids, start=1):
        lines.append(
            json.dumps(
                {
                    "finalization_id": fid,
                    "decision_id": f"dec-{index}",
                    "journal_decision_id": f"journal-{index}",
                },
                ensure_ascii=False,
            )
        )
    path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def _commit_turn(
    root: Path,
    turn_number: int,
    finalization_id: str,
    *,
    schema_generation: str = SCHEMA,
) -> str:
    return hist.commit_finalized_turn(
        root,
        CAMPAIGN_ID,
        turn_number=turn_number,
        finalization_id=finalization_id,
        journal_decision_id=f"journal-{turn_number}",
        settlement_snapshot_id=f"settle-{turn_number}",
        rendered_text_sha256="a" * 64,
        schema_generation=schema_generation,
    )


def _prepare_campaign(root: Path) -> Path:
    coc_state.create_campaign(root, CAMPAIGN_ID, "Verify Fixture")
    hist.ensure_repo(root, CAMPAIGN_ID)
    hist.commit_baseline(
        root,
        CAMPAIGN_ID,
        schema_generation=SCHEMA,
        note="initial campaign generation",
    )
    return _worktree(root)


def _run_verify(root: Path, campaign_id: str = CAMPAIGN_ID) -> tuple[int, str, str]:
    completed = subprocess.run(
        [
            sys.executable,
            str(VERIFY_SCRIPT),
            "--root",
            str(root),
            "--campaign",
            campaign_id,
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    return completed.returncode, completed.stdout, completed.stderr


def test_clean_history_exit_0(tmp_path):
    _prepare_campaign(tmp_path)
    _write_receipts(tmp_path, ["fin-0001", "fin-0002"])
    sha1 = _commit_turn(tmp_path, 1, "fin-0001")
    sha2 = _commit_turn(tmp_path, 2, "fin-0002")

    code, stdout, stderr = _run_verify(tmp_path)
    assert code == 0, stdout + stderr
    assert "GIT HISTORY CHECK PASSED" in stdout
    assert "2 turn commit(s)" in stdout
    assert "2 receipt(s)" in stdout
    assert f"info: baseline sha=" in stdout
    assert sha1 in _git(tmp_path, "rev-parse", "HEAD~1").stdout
    assert sha2 in _git(tmp_path, "rev-parse", "HEAD").stdout
    assert stderr == ""


def test_missing_commit_exit_1_points_at_finalization_id(tmp_path):
    _prepare_campaign(tmp_path)
    _write_receipts(tmp_path, ["fin-0001", "fin-0002"])
    _commit_turn(tmp_path, 1, "fin-0001")
    dropped = _commit_turn(tmp_path, 2, "fin-0002")
    parent = _git(tmp_path, "rev-parse", "HEAD^").stdout.strip()
    _git(tmp_path, "update-ref", "HEAD", parent)

    code, stdout, stderr = _run_verify(tmp_path)
    assert code == 1, stdout + stderr
    assert "missing_commit" in stdout
    assert "finalization_id=fin-0002" in stdout
    assert dropped not in _git(tmp_path, "log", "--format=%H").stdout


def test_orphan_commit_exit_1_points_at_finalization_id(tmp_path):
    _prepare_campaign(tmp_path)
    _write_receipts(tmp_path, ["fin-0001"])
    _commit_turn(tmp_path, 1, "fin-0001")
    orphan = _commit_turn(tmp_path, 2, "fin-0002")

    code, stdout, stderr = _run_verify(tmp_path)
    assert code == 1, stdout + stderr
    assert "orphan_commit" in stdout
    assert f"sha={orphan}" in stdout
    assert "finalization_id=fin-0002" in stdout


def test_incomplete_trailer_exit_1(tmp_path):
    _prepare_campaign(tmp_path)
    _write_receipts(tmp_path, ["fin-bad"])
    message = "\n".join(
        [
            "coc turn 0001: fin-bad",
            "",
            "COC-Commit-Type: turn",
            f"Campaign-Id: {CAMPAIGN_ID}",
            "Timeline-Id: tl-main",
            "Turn-Number: 1",
            "Finalization-Id: fin-bad",
            "Settlement-Snapshot-Id: settle-1",
            "Rendered-Text-SHA256: " + ("a" * 64),
            f"Schema-Generation: {SCHEMA}",
            "",
        ]
    )
    _git(tmp_path, "commit", "--allow-empty", "-m", message)

    code, stdout, stderr = _run_verify(tmp_path)
    assert code == 1, stdout + stderr
    assert "incomplete_trailer" in stdout
    assert "finalization_id=fin-bad" in stdout
    assert "missing=Journal-Decision-Id" in stdout


def test_schema_generation_mismatch_exit_1(tmp_path):
    _prepare_campaign(tmp_path)
    _write_receipts(tmp_path, ["fin-old"])
    sha = _commit_turn(
        tmp_path,
        1,
        "fin-old",
        schema_generation="campaign-1/world-1/pacing-1/investigator-1",
    )

    code, stdout, stderr = _run_verify(tmp_path)
    assert code == 1, stdout + stderr
    assert "schema_generation_mismatch" in stdout
    assert f"sha={sha}" in stdout
    assert "finalization_id=fin-old" in stdout
    assert f"expected={SCHEMA}" in stdout
    assert "actual=campaign-1/world-1/pacing-1/investigator-1" in stdout


def test_baseline_only_exit_2(tmp_path):
    _prepare_campaign(tmp_path)

    code, stdout, stderr = _run_verify(tmp_path)
    assert code == 2, stdout + stderr
    assert "refusing a vacuous pass" in stdout
    assert "0 turn commits, 0 receipts" in stdout
    assert "info: baseline sha=" in stdout
    assert "GIT HISTORY CHECK PASSED" not in stdout


def test_repo_missing_exit_nonzero_with_clear_message(tmp_path):
    coc_state.create_campaign(tmp_path, CAMPAIGN_ID, "No Repo")
    hist.remove_repo(tmp_path, CAMPAIGN_ID)

    code, stdout, stderr = _run_verify(tmp_path)
    assert code != 0
    message = stdout + stderr
    assert "sidecar git repo not found" in message
    assert str(_repo(tmp_path)) in message


def test_verify_writes_nothing(tmp_path):
    _prepare_campaign(tmp_path)
    _write_receipts(tmp_path, ["fin-0001"])
    _commit_turn(tmp_path, 1, "fin-0001")
    before = _workspace_fingerprint(tmp_path)

    code, stdout, stderr = _run_verify(tmp_path)
    assert code == 0, stdout + stderr
    after = _workspace_fingerprint(tmp_path)
    assert after == before


def test_main_requires_campaign(tmp_path):
    completed = subprocess.run(
        [sys.executable, str(VERIFY_SCRIPT), "--root", str(tmp_path)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    assert completed.returncode != 0
    assert "campaign" in (completed.stderr + completed.stdout).lower()
