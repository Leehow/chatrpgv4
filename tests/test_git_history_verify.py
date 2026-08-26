"""Read-only git-history diagnostic."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
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
proj = load_module(
    "coc_history_projection", SCRIPTS / "coc_history_projection.py"
)
tm = load_module(
    "coc_temporal_memory_contract", SCRIPTS / "coc_temporal_memory_contract.py"
)

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
    proj.rebuild_history_projection(root, CAMPAIGN_ID)
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
    proj.rebuild_history_projection(tmp_path, CAMPAIGN_ID)

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
    proj.rebuild_history_projection(tmp_path, CAMPAIGN_ID)
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


PROOF_TOP_KEYS = {
    "status",
    "campaign_id",
    "history_enabled",
    "history_valid",
    "repo_present",
    "repo_healthy",
    "git_available",
    "fsck_ok",
    "repo_path",
    "worktree_path",
    "head",
    "latest_receipt",
    "expected_head_sha",
    "head_matches_latest_receipt",
    "later_non_turn_commit",
    "counts",
    "worldline_counts",
    "projection_status",
    "projection_findings",
    "tree",
    "history_reset",
    "findings",
}


def _codes(proof) -> list[str]:
    return [item.code for item in proof.findings]


def _healthy_two_turns(root: Path) -> tuple[str, str]:
    _prepare_campaign(root)
    _write_receipts(root, ["fin-0001", "fin-0002"])
    sha1 = _commit_turn(root, 1, "fin-0001")
    sha2 = _commit_turn(root, 2, "fin-0002")
    proj.rebuild_history_projection(root, CAMPAIGN_ID)
    return sha1, sha2


def test_state_proof_pass_binds_head_receipt_and_tree(tmp_path):
    sha1, sha2 = _healthy_two_turns(tmp_path)
    leftover = _worktree(tmp_path) / "save" / "commit-snapshots" / "fin-0002"
    leftover.mkdir(parents=True)
    (leftover / "world-state.json").write_text("{}\n", encoding="utf-8")

    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    payload = proof.to_dict()
    assert set(payload) == PROOF_TOP_KEYS
    assert payload["status"] == "PASS"
    assert payload["history_enabled"] is True
    assert payload["history_valid"] is True
    assert payload["fsck_ok"] is True
    assert payload["head"]["sha"] == sha2
    assert payload["head"]["commit_type"] == "turn"
    assert payload["head"]["finalization_id"] == "fin-0002"
    assert payload["head"]["trailers"]["Finalization-Id"] == "fin-0002"
    assert payload["latest_receipt"] == {
        "finalization_id": "fin-0002",
        "commit_sha": sha2,
        "paired": True,
    }
    assert payload["expected_head_sha"] == sha2
    assert payload["head_matches_latest_receipt"] is True
    assert payload["later_non_turn_commit"] is None
    assert payload["counts"] == {
        "turn_commits": 2,
        "receipts": 2,
        "paired_receipts": 2,
    }
    assert payload["tree"]["clean"] is True
    assert payload["tree"]["canonical_paths_present"] is True
    assert payload["tree"]["dirty_paths"] == []
    assert payload["tree"]["missing_paths"] == []
    assert payload["tree"]["drifted_paths"] == []
    assert payload["history_reset"] is False
    assert payload["findings"] == []
    assert sha1 != sha2
    assert "commit-snapshot" not in json.dumps(payload)
    assert not any(
        path.startswith("save/commit-snapshots/")
        for path in payload["tree"]["dirty_paths"]
    )


def test_state_proof_json_cli_emits_machine_payload(tmp_path):
    _healthy_two_turns(tmp_path)
    completed = subprocess.run(
        [
            sys.executable,
            str(VERIFY_SCRIPT),
            "--root",
            str(tmp_path),
            "--campaign",
            CAMPAIGN_ID,
            "--json",
        ],
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
    payload = json.loads(completed.stdout)
    assert payload["status"] == "PASS"
    assert set(payload) == PROOF_TOP_KEYS
    assert completed.stderr == ""


def test_state_proof_missing_repo_is_not_proven(tmp_path):
    coc_state.create_campaign(tmp_path, CAMPAIGN_ID, "No Repo")
    hist.remove_repo(tmp_path, CAMPAIGN_ID)
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert proof.status == "NOT_PROVEN"
    assert proof.history_enabled is False
    assert proof.repo_present is False
    assert verify.CODE_MISSING_SIDECAR_REPO in _codes(proof)


def test_state_proof_baseline_only_is_not_proven(tmp_path):
    _prepare_campaign(tmp_path)
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert proof.status == "NOT_PROVEN"
    assert proof.turn_commit_count == 0
    assert proof.receipt_count == 0
    assert verify.CODE_BASELINE_ONLY in _codes(proof)
    assert proof.head_matches_latest_receipt is None


def test_state_proof_missing_receipt_fails(tmp_path):
    _prepare_campaign(tmp_path)
    _commit_turn(tmp_path, 1, "fin-0001")
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert proof.status == "FAIL"
    assert verify.CODE_MISSING_RECEIPT in _codes(proof)
    assert "orphan_commit" in _codes(proof)


def test_state_proof_expected_receipt_missing_fails(tmp_path):
    _healthy_two_turns(tmp_path)
    proof = verify.state_integrity_proof(
        tmp_path,
        CAMPAIGN_ID,
        expected_finalization_id="fin-missing",
    )
    assert proof.status == "FAIL"
    assert verify.CODE_MISSING_RECEIPT in _codes(proof)
    assert proof.latest_receipt.finalization_id == "fin-missing"
    assert proof.latest_receipt.paired is False


def test_state_proof_wrong_head_fails(tmp_path):
    _healthy_two_turns(tmp_path)
    parent = _git(tmp_path, "rev-parse", "HEAD^").stdout.strip()
    _git(tmp_path, "update-ref", "HEAD", parent)
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert proof.status == "FAIL"
    assert verify.CODE_WRONG_HEAD in _codes(proof)
    assert "missing_commit" in _codes(proof)
    assert proof.head_matches_latest_receipt is False
    assert proof.head.finalization_id == "fin-0001"
    assert proof.latest_receipt.finalization_id == "fin-0002"


def test_state_proof_duplicate_receipt_fails(tmp_path):
    _prepare_campaign(tmp_path)
    _write_receipts(tmp_path, ["fin-0001", "fin-0001"])
    _commit_turn(tmp_path, 1, "fin-0001")
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert proof.status == "FAIL"
    assert "duplicate_receipt" in _codes(proof)


def test_state_proof_hash_drift_fails(tmp_path):
    _healthy_two_turns(tmp_path)
    world = _worktree(tmp_path) / "save" / "world-state.json"
    world.write_text('{"drifted": true}\n', encoding="utf-8")
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert proof.status == "FAIL"
    assert verify.CODE_HASH_DRIFT in _codes(proof)
    assert "save/world-state.json" in proof.tree.drifted_paths
    assert proof.tree.clean is False
    finding = next(item for item in proof.findings if item.code == verify.CODE_HASH_DRIFT)
    assert finding.path == "save/world-state.json"
    assert "head_blob=" in finding.detail
    assert "worktree_blob=" in finding.detail


def test_state_proof_committed_pending_turn_fails(tmp_path):
    _healthy_two_turns(tmp_path)
    pending = _worktree(tmp_path) / hist.PENDING_TURN_RELPATH
    pending.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "campaign_id": CAMPAIGN_ID,
                "journal_decision_id": "journal-next",
                "status": "pending",
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    _git(tmp_path, "add", "-A", "--", ".")
    _git(tmp_path, "commit", "--amend", "--no-edit")
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert proof.status == "FAIL"
    assert verify.CODE_COMMITTED_PENDING_TURN in _codes(proof)
    finding = next(
        item for item in proof.findings if item.code == verify.CODE_COMMITTED_PENDING_TURN
    )
    assert finding.path == hist.PENDING_TURN_RELPATH


def test_state_proof_worktree_only_pending_is_not_committed_pending(tmp_path):
    _healthy_two_turns(tmp_path)
    pending = _worktree(tmp_path) / hist.PENDING_TURN_RELPATH
    pending.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "campaign_id": CAMPAIGN_ID,
                "journal_decision_id": "journal-next",
                "status": "pending",
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert verify.CODE_COMMITTED_PENDING_TURN not in _codes(proof)
    assert proof.status == "FAIL"
    assert verify.CODE_DIRTY_AUTHORITATIVE_STATE in _codes(proof)
    assert hist.PENDING_TURN_RELPATH in proof.tree.dirty_paths


def test_state_proof_dirty_untracked_canonical_fails(tmp_path):
    _healthy_two_turns(tmp_path)
    extra = _worktree(tmp_path) / "save" / "extra-state.json"
    extra.write_text('{"extra": true}\n', encoding="utf-8")
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert proof.status == "FAIL"
    assert verify.CODE_DIRTY_AUTHORITATIVE_STATE in _codes(proof)
    assert "save/extra-state.json" in proof.tree.dirty_paths


def test_state_proof_missing_canonical_path_fails(tmp_path):
    _healthy_two_turns(tmp_path)
    _git(tmp_path, "rm", "--cached", "campaign.json")
    _git(tmp_path, "commit", "--allow-empty", "-m", "drop campaign.json")
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert proof.status == "FAIL"
    assert verify.CODE_MISSING_CANONICAL_PATH in _codes(proof)
    assert "campaign.json" in proof.tree.missing_paths
    assert verify.CODE_WRONG_HEAD in _codes(proof)


def test_state_proof_history_reset_later_non_turn_is_not_proven(tmp_path):
    _healthy_two_turns(tmp_path)
    message = "\n".join(
        [
            "coc baseline: history reset after corrupt object database",
            "",
            "COC-Commit-Type: baseline",
            f"Campaign-Id: {CAMPAIGN_ID}",
            "Timeline-Id: tl-main",
            f"Schema-Generation: {SCHEMA}",
            "COC-History-Reset: object database unreadable",
            "",
        ]
    )
    _git(tmp_path, "commit", "--allow-empty", "-m", message)
    head = _git(tmp_path, "rev-parse", "HEAD").stdout.strip()
    proj.rebuild_history_projection(tmp_path, CAMPAIGN_ID)
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert proof.status == "NOT_PROVEN"
    assert proof.history_reset is True
    assert verify.CODE_HISTORY_RESET in _codes(proof)
    assert verify.CODE_LATER_NON_TURN in _codes(proof)
    assert proof.later_non_turn_commit is not None
    assert proof.later_non_turn_commit.sha == head
    assert proof.later_non_turn_commit.reason_code == verify.CODE_HISTORY_RESET
    assert proof.later_non_turn_commit.permitted is True
    assert proof.head_matches_latest_receipt is False


def test_state_proof_unpermitted_later_non_turn_fails(tmp_path):
    _healthy_two_turns(tmp_path)
    message = "\n".join(
        [
            "coc baseline: unexpected extra baseline",
            "",
            "COC-Commit-Type: baseline",
            f"Campaign-Id: {CAMPAIGN_ID}",
            "Timeline-Id: tl-main",
            f"Schema-Generation: {SCHEMA}",
            "",
        ]
    )
    _git(tmp_path, "commit", "--allow-empty", "-m", message)
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert proof.status == "FAIL"
    assert verify.CODE_WRONG_HEAD in _codes(proof)
    assert verify.CODE_LATER_NON_TURN in _codes(proof)
    assert proof.later_non_turn_commit is not None
    assert proof.later_non_turn_commit.permitted is False
    assert proof.later_non_turn_commit.reason_code == "unpermitted_non_turn"


def test_state_proof_fsck_failure_fails(tmp_path):
    _healthy_two_turns(tmp_path)
    objects = _repo(tmp_path) / "objects"
    corrupted = False
    for entry in objects.iterdir():
        if entry.name in {"info", "pack"} or not entry.is_dir():
            continue
        for obj in entry.iterdir():
            if obj.is_file():
                obj.chmod(0o644)
                obj.write_bytes(obj.read_bytes() + b"\x00junk")
                corrupted = True
                break
        if corrupted:
            break
    assert corrupted
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert proof.status == "FAIL"
    assert "fsck_failed" in _codes(proof)
    assert proof.fsck_ok is False
    assert proof.history_valid is False


def test_state_proof_repo_not_git_fails(tmp_path):
    coc_state.create_campaign(tmp_path, CAMPAIGN_ID, "Broken Repo")
    repo = _repo(tmp_path)
    for child in list(repo.iterdir()):
        if child.is_dir() and not child.is_symlink():
            shutil.rmtree(child)
        else:
            child.unlink()
    (repo / "not-git.txt").write_text("nope\n", encoding="utf-8")
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert proof.status == "FAIL"
    assert verify.CODE_REPO_NOT_GIT in _codes(proof)
    assert proof.history_enabled is False


def test_relative_root_cli_and_proof_pass(tmp_path, monkeypatch):
    # Regression: the documented `--root .` invocation must not misreport a
    # healthy campaign as fsck_failed / missing_commit / wrong_head after
    # the git subprocess cwd moves to the worktree.
    _prepare_campaign(tmp_path)
    _write_receipts(tmp_path, ["fin-0001"])
    _commit_turn(tmp_path, 1, "fin-0001")
    proj.rebuild_history_projection(tmp_path, CAMPAIGN_ID)
    monkeypatch.chdir(tmp_path)
    proof = verify.state_integrity_proof(".", CAMPAIGN_ID)
    assert proof.status == verify.STATUS_PASS
    completed = subprocess.run(
        [
            sys.executable,
            str(VERIFY_SCRIPT),
            "--root",
            ".",
            "--campaign",
            CAMPAIGN_ID,
        ],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert "GIT HISTORY CHECK PASSED" in completed.stdout


def test_state_proof_default_head_unchanged_after_fork(tmp_path):
    sha1, sha2 = _healthy_two_turns(tmp_path)
    hist.fork_timeline(
        tmp_path,
        CAMPAIGN_ID,
        timeline_id="tl-side",
        source_turn=2,
        game_reason="side path",
        activate=False,
    )
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert proof.status == "PASS"
    assert proof.head.sha == sha2
    assert proof.head.finalization_id == "fin-0002"
    assert sha1 != sha2


def test_state_proof_timeline_ref_and_confluence_topology(tmp_path):
    _prepare_campaign(tmp_path)
    worktree = _worktree(tmp_path)
    _write_receipts(tmp_path, ["fin-0001", "fin-left-2", "fin-right-2"])
    main_sha = _commit_turn(tmp_path, 1, "fin-0001")
    hist.fork_timeline(
        tmp_path,
        CAMPAIGN_ID,
        timeline_id="tl-left",
        source_turn=1,
        game_reason="left",
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
        game_reason="right",
        activate=True,
    )
    (worktree / "save" / "world-state.json").write_text(
        json.dumps({"status": "active", "turn": 2, "branch": "right"}) + "\n",
        encoding="utf-8",
    )
    right_sha = _commit_turn(tmp_path, 2, "fin-right-2")

    tm = load_module(
        "coc_temporal_memory_contract", SCRIPTS / "coc_temporal_memory_contract.py"
    )
    confluence_id = f"confluence-{CAMPAIGN_ID}-tl-merged"
    conflicts = [
        {
            "conflict_id": tm.conflict_id_for(confluence_id, "world-state"),
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
            "disposition": {"mode": "choose_left", "receipt": "disp-1"},
        }
    ]
    merged = hist.confluence_timelines(
        tmp_path,
        CAMPAIGN_ID,
        timeline_id="tl-merged",
        left_timeline_id="tl-left",
        right_timeline_id="tl-right",
        receipt="conf-1",
        schema_generation=SCHEMA,
        conflicts=conflicts,
        path_resolutions={"save/world-state.json": "choose_left"},
        confluence_id=confluence_id,
    )

    main_proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert main_proof.head.sha == main_sha
    assert verify.CODE_CONFLUENCE_PARENTS not in _codes(main_proof)
    assert verify.CODE_CONFLUENCE_TRAILER not in _codes(main_proof)
    assert verify.CODE_FORK_TOPOLOGY not in _codes(main_proof)
    assert verify.CODE_CONFLUENCE_MANIFEST not in _codes(main_proof)
    assert verify.CODE_CONFLUENCE_TREE not in _codes(main_proof)

    left_proof = verify.state_integrity_proof(
        tmp_path, CAMPAIGN_ID, timeline_ref="tl-left"
    )
    assert left_proof.head.sha == left_sha
    assert left_proof.head.finalization_id == "fin-left-2"
    assert left_proof.head.trailers["Timeline-Id"] == "tl-left"

    merge_proof = verify.state_integrity_proof(
        tmp_path, CAMPAIGN_ID, timeline_ref="tl-merged"
    )
    assert merge_proof.head.sha == merged["merge_commit"]
    assert merge_proof.head.commit_type == "confluence"
    assert merge_proof.head.trailers["Conflict-Manifest-SHA256"]
    assert merge_proof.head.trailers["Disposition-Manifest-SHA256"]
    assert verify.CODE_CONFLUENCE_MANIFEST not in _codes(merge_proof)
    assert verify.CODE_CONFLUENCE_TREE not in _codes(merge_proof)
    parents = _git(
        tmp_path, "rev-list", "--no-walk", "--parents", merged["merge_commit"]
    ).stdout.split()
    assert len(parents) == 3
    assert set(parents[1:]) == {left_sha, right_sha}
    missing = verify.state_integrity_proof(
        tmp_path, CAMPAIGN_ID, timeline_ref="tl-does-not-exist"
    )
    assert missing.status == "NOT_PROVEN"
    assert verify.CODE_TIMELINE_REF_MISSING in _codes(missing)


def _confluence_fixture(root: Path) -> tuple[Path, str, str, str]:
    """main turn 1 + tl-left/tl-right turn 2 (world-state differs only)."""
    _prepare_campaign(root)
    worktree = _worktree(root)
    _write_receipts(root, ["fin-0001", "fin-left-2", "fin-right-2"])
    main_sha = _commit_turn(root, 1, "fin-0001")
    hist.fork_timeline(
        root, CAMPAIGN_ID, timeline_id="tl-left", source_turn=1,
        game_reason="left", activate=True,
    )
    (worktree / "save" / "world-state.json").write_text(
        json.dumps({"status": "active", "turn": 2, "branch": "left"}) + "\n",
        encoding="utf-8",
    )
    left_sha = _commit_turn(root, 2, "fin-left-2")
    hist.set_active_timeline(root, CAMPAIGN_ID, "tl-main")
    hist.fork_timeline(
        root, CAMPAIGN_ID, timeline_id="tl-right", source_turn=1,
        game_reason="right", activate=True,
    )
    (worktree / "save" / "world-state.json").write_text(
        json.dumps({"status": "active", "turn": 2, "branch": "right"}) + "\n",
        encoding="utf-8",
    )
    right_sha = _commit_turn(root, 2, "fin-right-2")
    return worktree, main_sha, left_sha, right_sha


def _world_state_conflicts(
    confluence_id: str, *, mode: str = "choose_left"
) -> list[dict]:
    conflict_id = tm.conflict_id_for(confluence_id, "world-state")
    return [
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
            "disposition": {"mode": mode, "receipt": "disp-1"},
        }
    ]


def test_state_proof_confluence_binding_clean_after_real_confluence(tmp_path):
    worktree, main_sha, _left, _right = _confluence_fixture(tmp_path)
    confluence_id = f"confluence-{CAMPAIGN_ID}-tl-merged"
    merged = hist.confluence_timelines(
        tmp_path,
        CAMPAIGN_ID,
        timeline_id="tl-merged",
        left_timeline_id="tl-left",
        right_timeline_id="tl-right",
        receipt="conf-1",
        schema_generation=SCHEMA,
        conflicts=_world_state_conflicts(confluence_id),
        path_resolutions={"save/world-state.json": "choose_left"},
        confluence_id=confluence_id,
    )
    main_proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert main_proof.head.sha == main_sha
    assert verify.CODE_CONFLUENCE_MANIFEST not in _codes(main_proof)
    assert verify.CODE_CONFLUENCE_TREE not in _codes(main_proof)
    merge_proof = verify.state_integrity_proof(
        tmp_path, CAMPAIGN_ID, timeline_ref="tl-merged"
    )
    assert merge_proof.head.sha == merged["merge_commit"]
    assert verify.CODE_CONFLUENCE_MANIFEST not in _codes(merge_proof)
    assert verify.CODE_CONFLUENCE_TREE not in _codes(merge_proof)
    # The verifier recomputes binding without writing anything.
    before = _workspace_fingerprint(tmp_path)
    verify.state_integrity_proof(tmp_path, CAMPAIGN_ID, timeline_ref="tl-merged")
    assert _workspace_fingerprint(tmp_path) == before


def test_state_proof_confluence_manifest_tamper_fails(tmp_path):
    worktree, _main, _left, _right = _confluence_fixture(tmp_path)
    confluence_id = f"confluence-{CAMPAIGN_ID}-tl-merged"
    hist.confluence_timelines(
        tmp_path,
        CAMPAIGN_ID,
        timeline_id="tl-merged",
        left_timeline_id="tl-left",
        right_timeline_id="tl-right",
        receipt="conf-1",
        schema_generation=SCHEMA,
        conflicts=_world_state_conflicts(confluence_id),
        path_resolutions={"save/world-state.json": "choose_left"},
        confluence_id=confluence_id,
    )
    state_path = worktree / hist.TIMELINE_STATE_RELPATH
    state = json.loads(state_path.read_text(encoding="utf-8"))
    # Post-hoc disposition rewrite: the committed digests no longer match
    # the recorded manifest, and the recorded disposition now contradicts
    # the committed tree.
    state["confluences"][0]["conflicts"][0]["disposition"]["mode"] = "choose_right"
    state_path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert proof.status == "FAIL"
    assert verify.CODE_CONFLUENCE_MANIFEST in _codes(proof)
    assert verify.CODE_CONFLUENCE_TREE in _codes(proof)


def test_state_proof_confluence_tree_unbound_fails(tmp_path):
    worktree, _main, left_sha, right_sha = _confluence_fixture(tmp_path)
    confluence_id = f"confluence-{CAMPAIGN_ID}-tl-rogue"
    conflicts = _world_state_conflicts(confluence_id)  # manifest says choose_left
    conflict_digest = tm.record_digest({"conflicts": conflicts})
    dispositions = [
        {
            "conflict_id": conflict["conflict_id"],
            "disposition": conflict["disposition"],
        }
        for conflict in conflicts
    ]
    disposition_digest = tm.record_digest({"dispositions": dispositions})
    message = "\n".join(
        [
            f"coc confluence: {confluence_id}",
            "",
            "COC-Commit-Type: confluence",
            f"Campaign-Id: {CAMPAIGN_ID}",
            "Timeline-Id: tl-rogue",
            f"Confluence-Id: {confluence_id}",
            "Parent-Timeline-Left: tl-left",
            "Parent-Timeline-Right: tl-right",
            f"Conflict-Manifest-SHA256: {conflict_digest}",
            f"Disposition-Manifest-SHA256: {disposition_digest}",
            f"Schema-Generation: {SCHEMA}",
            "Game-Reason: rogue merge carrying the right blob",
            "",
        ]
    )
    # A hostile writer commits the RIGHT parent's whole tree under a
    # choose_left manifest: correct digests, contradicting tree.
    rogue = (
        _git(
            tmp_path,
            "commit-tree",
            f"{right_sha}^{{tree}}",
            "-p",
            left_sha,
            "-p",
            right_sha,
            "-m",
            message,
        )
        .stdout.strip()
    )
    _git(tmp_path, "update-ref", "refs/heads/timelines/tl-rogue", rogue)
    state = hist.load_timeline_state(tmp_path, CAMPAIGN_ID)
    state["timelines"].append(
        {
            "timeline_id": "tl-rogue",
            "campaign_id": CAMPAIGN_ID,
            "kind": "confluence",
            "parents": ["tl-left", "tl-right"],
            "fork_point": {
                "commit": rogue,
                "turn": 2,
                "episode_id": tm.episode_id_for(CAMPAIGN_ID, "tl-rogue", 2),
            },
            "created_by": "confluence",
        }
    )
    state["confluences"].append(
        {
            "confluence_id": confluence_id,
            "campaign_id": CAMPAIGN_ID,
            "timeline_id": "tl-rogue",
            "parents": ["tl-left", "tl-right"],
            "merge_commit": rogue,
            "receipt": "conf-rogue",
            "conflicts": conflicts,
        }
    )
    state.setdefault("game_reasons", {})["tl-rogue"] = "rogue merge"
    hist._write_timeline_state(worktree, state)

    proof = verify.state_integrity_proof(tmp_path, CAMPAIGN_ID)
    assert proof.status == "FAIL"
    assert verify.CODE_CONFLUENCE_TREE in _codes(proof)
    # The digests themselves are correct; only the tree contradicts them.
    assert verify.CODE_CONFLUENCE_MANIFEST not in _codes(proof)
    finding = next(
        item for item in proof.findings if item.code == verify.CODE_CONFLUENCE_TREE
    )
    assert "save/world-state.json" in finding.detail
    assert "choose_left" in finding.detail
