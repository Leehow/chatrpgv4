#!/usr/bin/env python3
"""Read-only diagnostic for per-campaign sidecar git history.

Reports fsck, trailer completeness, and 1:1 pairing between
``logs/turn-finalizations.jsonl`` receipts and ``Finalization-Id`` commits.
Never writes the campaign tree, the sidecar repo, or any cache file.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_git_history as hist
import coc_state

FINALIZATION_LOG = "turn-finalizations.jsonl"

TURN_TRAILER_KEYS: tuple[str, ...] = (
    "COC-Commit-Type",
    "Campaign-Id",
    "Timeline-Id",
    "Turn-Number",
    "Finalization-Id",
    "Journal-Decision-Id",
    "Settlement-Snapshot-Id",
    "Rendered-Text-SHA256",
    "Schema-Generation",
)

_TURN_NUMBER_RE = re.compile(r"^(0|[1-9][0-9]*)$")

STATUS_PASS = "PASS"
STATUS_FAIL = "FAIL"
STATUS_NOT_PROVEN = "NOT_PROVEN"

# Fail-closed reason codes. Existing CLI kinds stay stable.
CODE_UNSAFE_PATH = "unsafe_path"
CODE_CAMPAIGN_MISSING = "campaign_missing"
CODE_MISSING_SIDECAR_REPO = "missing_sidecar_repo"
CODE_REPO_NOT_GIT = "repo_not_git"
CODE_GIT_UNAVAILABLE = "git_unavailable"
CODE_GIT_LOG_FAILED = "git_log_failed"
CODE_BASELINE_ONLY = "baseline_only"
CODE_MISSING_RECEIPT = "missing_receipt"
CODE_WRONG_HEAD = "wrong_head"
CODE_DIRTY_AUTHORITATIVE_STATE = "dirty_authoritative_state"
CODE_HASH_DRIFT = "hash_drift"
CODE_MISSING_CANONICAL_PATH = "missing_canonical_path"
CODE_COMMITTED_PENDING_TURN = "committed_pending_turn"
CODE_HISTORY_RESET = "history_reset"
CODE_LATER_NON_TURN = "later_non_turn"

_NOT_PROVEN_CODES = frozenset(
    {
        CODE_UNSAFE_PATH,
        CODE_CAMPAIGN_MISSING,
        CODE_MISSING_SIDECAR_REPO,
        CODE_GIT_UNAVAILABLE,
        CODE_BASELINE_ONLY,
        CODE_HISTORY_RESET,
    }
)
_RESET_EXPLAINED_CODES = frozenset(
    {
        "missing_commit",
        CODE_WRONG_HEAD,
        CODE_MISSING_RECEIPT,
        "orphan_commit",
        CODE_BASELINE_ONLY,
        CODE_LATER_NON_TURN,
    }
)
_CLI_OMIT_FINDING_CODES = frozenset(
    {
        CODE_UNSAFE_PATH,
        CODE_CAMPAIGN_MISSING,
        CODE_MISSING_SIDECAR_REPO,
        CODE_REPO_NOT_GIT,
        CODE_GIT_UNAVAILABLE,
        CODE_GIT_LOG_FAILED,
        CODE_BASELINE_ONLY,
        CODE_HISTORY_RESET,
        CODE_LATER_NON_TURN,
    }
)
_PERMITTED_LATER_NON_TURN = frozenset({CODE_HISTORY_RESET})


@dataclass(frozen=True)
class Finding:
    kind: str
    detail: str
    sha: str | None = None
    finalization_id: str | None = None
    path: str | None = None

    @property
    def code(self) -> str:
        return self.kind

    def render(self) -> str:
        parts = [self.kind]
        if self.sha:
            parts.append(f"sha={self.sha}")
        if self.finalization_id:
            parts.append(f"finalization_id={self.finalization_id}")
        if self.path:
            parts.append(f"path={self.path}")
        if self.detail:
            parts.append(self.detail)
        return " ".join(parts)

    def to_dict(self) -> dict[str, Any]:
        return {
            "code": self.kind,
            "detail": self.detail,
            "sha": self.sha,
            "finalization_id": self.finalization_id,
            "path": self.path,
        }


@dataclass
class VerifyReport:
    exit_code: int
    findings: list[Finding] = field(default_factory=list)
    infos: list[str] = field(default_factory=list)
    error: str | None = None
    turn_commit_count: int = 0
    receipt_count: int = 0

    def render_lines(self) -> list[str]:
        lines: list[str] = []
        if self.error:
            lines.append(self.error)
        elif self.exit_code == 0:
            lines.append(
                "GIT HISTORY CHECK PASSED: "
                f"{self.turn_commit_count} turn commit(s), "
                f"{self.receipt_count} receipt(s)"
            )
        elif self.exit_code == 2 and not self.findings:
            lines.append(
                "ERROR: no turn history found — refusing a vacuous pass "
                f"({self.turn_commit_count} turn commits, "
                f"{self.receipt_count} receipts)"
            )
        else:
            lines.append(
                f"GIT HISTORY CHECK FAILED: {len(self.findings)} finding(s)"
            )
        for finding in self.findings:
            lines.append(f"  - {finding.render()}")
        for info in self.infos:
            lines.append(f"info: {info}")
        return lines


@dataclass(frozen=True)
class HeadProof:
    sha: str | None
    commit_type: str | None
    finalization_id: str | None
    turn_number: str | None
    trailers: dict[str, str] | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "sha": self.sha,
            "commit_type": self.commit_type,
            "finalization_id": self.finalization_id,
            "turn_number": self.turn_number,
            "trailers": dict(self.trailers) if self.trailers is not None else None,
        }


@dataclass(frozen=True)
class ReceiptBinding:
    finalization_id: str | None
    commit_sha: str | None
    paired: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "finalization_id": self.finalization_id,
            "commit_sha": self.commit_sha,
            "paired": self.paired,
        }


@dataclass(frozen=True)
class LaterNonTurnCommit:
    sha: str
    commit_type: str
    reason_code: str
    reason: str | None
    permitted: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "sha": self.sha,
            "commit_type": self.commit_type,
            "reason_code": self.reason_code,
            "reason": self.reason,
            "permitted": self.permitted,
        }


@dataclass(frozen=True)
class TreeProof:
    clean: bool | None
    canonical_paths_present: bool | None
    dirty_paths: tuple[str, ...]
    missing_paths: tuple[str, ...]
    drifted_paths: tuple[str, ...]

    def to_dict(self) -> dict[str, Any]:
        return {
            "clean": self.clean,
            "canonical_paths_present": self.canonical_paths_present,
            "dirty_paths": list(self.dirty_paths),
            "missing_paths": list(self.missing_paths),
            "drifted_paths": list(self.drifted_paths),
        }


@dataclass(frozen=True)
class StateIntegrityProof:
    """Machine-consumable Git state proof for battle-report completeness.

    Exporter (t3) should call ``state_integrity_proof(...).to_dict()`` and
    read ``status`` plus ``findings[].code``. Do not parse CLI prose.
    """

    status: str
    campaign_id: str
    history_enabled: bool
    history_valid: bool
    repo_present: bool
    repo_healthy: bool
    git_available: bool
    fsck_ok: bool | None
    repo_path: str | None
    worktree_path: str | None
    head: HeadProof
    latest_receipt: ReceiptBinding
    expected_head_sha: str | None
    head_matches_latest_receipt: bool | None
    later_non_turn_commit: LaterNonTurnCommit | None
    turn_commit_count: int
    receipt_count: int
    paired_receipt_count: int
    tree: TreeProof
    history_reset: bool
    findings: tuple[Finding, ...]
    infos: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "campaign_id": self.campaign_id,
            "history_enabled": self.history_enabled,
            "history_valid": self.history_valid,
            "repo_present": self.repo_present,
            "repo_healthy": self.repo_healthy,
            "git_available": self.git_available,
            "fsck_ok": self.fsck_ok,
            "repo_path": self.repo_path,
            "worktree_path": self.worktree_path,
            "head": self.head.to_dict(),
            "latest_receipt": self.latest_receipt.to_dict(),
            "expected_head_sha": self.expected_head_sha,
            "head_matches_latest_receipt": self.head_matches_latest_receipt,
            "later_non_turn_commit": (
                self.later_non_turn_commit.to_dict()
                if self.later_non_turn_commit is not None
                else None
            ),
            "counts": {
                "turn_commits": self.turn_commit_count,
                "receipts": self.receipt_count,
                "paired_receipts": self.paired_receipt_count,
            },
            "tree": self.tree.to_dict(),
            "history_reset": self.history_reset,
            "findings": [finding.to_dict() for finding in self.findings],
        }


def _isolated_git_env() -> dict[str, str]:
    env = os.environ.copy()
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    env["GIT_CONFIG_GLOBAL"] = os.devnull
    env["GIT_CONFIG_SYSTEM"] = os.devnull
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_OPTIONAL_LOCKS"] = "0"
    env.pop("GIT_DIR", None)
    env.pop("GIT_WORK_TREE", None)
    env.pop("GIT_INDEX_FILE", None)
    env.pop("GIT_OBJECT_DIRECTORY", None)
    env.pop("GIT_ALTERNATE_OBJECT_DIRECTORIES", None)
    return env


def _git_executable() -> str:
    git = shutil.which("git")
    if not git:
        raise hist.GitHistoryUnavailableError(
            "git is required for campaign history but was not found on PATH"
        )
    return git


def _run_git_readonly(
    args: list[str],
    *,
    repo: Path,
    worktree: Path,
) -> subprocess.CompletedProcess[str]:
    git = _git_executable()
    cmd = [
        git,
        "--no-optional-locks",
        "-c",
        "safe.directory=*",
        f"--git-dir={repo}",
        f"--work-tree={worktree}",
        *args,
    ]
    try:
        return subprocess.run(
            cmd,
            cwd=str(worktree) if worktree.is_dir() else None,
            env=_isolated_git_env(),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
    except FileNotFoundError as exc:
        raise hist.GitHistoryUnavailableError(
            "git is required for campaign history but was not found on PATH"
        ) from exc


def _head_exists(repo: Path, worktree: Path) -> bool:
    completed = _run_git_readonly(
        ["rev-parse", "--verify", "-q", "HEAD"],
        repo=repo,
        worktree=worktree,
    )
    return completed.returncode == 0 and bool(completed.stdout.strip())


def _commit_log_records(repo: Path, worktree: Path) -> list[tuple[str, str]]:
    if not _head_exists(repo, worktree):
        return []
    completed = _run_git_readonly(
        ["log", "--format=%H%x1e%B%x1d"],
        repo=repo,
        worktree=worktree,
    )
    if completed.returncode != 0:
        raise hist.GitHistoryError(
            f"git log failed: {(completed.stderr or completed.stdout).strip()}"
        )
    records: list[tuple[str, str]] = []
    for chunk in completed.stdout.split("\x1d"):
        piece = chunk.strip("\n")
        if not piece:
            continue
        sha, sep, body = piece.partition("\x1e")
        if not sep:
            continue
        records.append((sha.strip(), body))
    return records


def _load_receipt_ids(campaign_dir: Path) -> tuple[list[str], list[Finding]]:
    path = campaign_dir / "logs" / FINALIZATION_LOG
    if not path.exists():
        return [], []
    if not path.is_file() or path.is_symlink():
        return [], [
            Finding(
                kind="invalid_receipt_log",
                detail=f"path={path.as_posix()} is not a regular file",
            )
        ]
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        return [], [
            Finding(
                kind="invalid_receipt_log",
                detail=f"cannot read {FINALIZATION_LOG}: {exc}",
            )
        ]
    ids: list[str] = []
    findings: list[Finding] = []
    for line_number, raw in enumerate(text.splitlines(), start=1):
        if not raw.strip():
            continue
        try:
            row = json.loads(raw)
        except json.JSONDecodeError as exc:
            findings.append(
                Finding(
                    kind="invalid_receipt",
                    detail=f"line={line_number} malformed:{exc.msg}",
                )
            )
            continue
        if not isinstance(row, dict):
            findings.append(
                Finding(
                    kind="invalid_receipt",
                    detail=f"line={line_number} not_an_object",
                )
            )
            continue
        fid = row.get("finalization_id")
        if not isinstance(fid, str) or not fid.strip():
            findings.append(
                Finding(
                    kind="invalid_receipt",
                    detail=f"line={line_number} missing_finalization_id",
                )
            )
            continue
        ids.append(fid.strip())
    return ids, findings


def _read_schema_via_state(campaign_dir: Path) -> list[Finding]:
    findings: list[Finding] = []
    readers: tuple[tuple[str, Any], ...] = (
        ("campaign", coc_state.load_campaign_state),
        ("world", coc_state.load_world_state),
        ("pacing", coc_state.load_pacing_state),
    )
    for kind, reader in readers:
        try:
            reader(campaign_dir)
        except coc_state.UnsupportedSaveSchema as exc:
            reason = getattr(exc, "reason", None) or str(exc)
            findings.append(
                Finding(
                    kind="schema_unreadable",
                    detail=f"kind={kind} reason={reason}",
                )
            )
        except (OSError, ValueError) as exc:
            findings.append(
                Finding(
                    kind="schema_unreadable",
                    detail=f"kind={kind} reason={exc}",
                )
            )
    return findings


def _turn_number_ok(value: str) -> bool:
    return _TURN_NUMBER_RE.fullmatch(value) is not None


def _validate_turn_trailers(
    sha: str,
    trailers: dict[str, str],
    *,
    campaign_id: str,
    expected_schema: str,
) -> list[Finding]:
    findings: list[Finding] = []
    fid = trailers.get("Finalization-Id") or None
    missing = [
        key
        for key in TURN_TRAILER_KEYS
        if not (trailers.get(key) or "").strip()
    ]
    if missing:
        findings.append(
            Finding(
                kind="incomplete_trailer",
                detail=f"missing={','.join(missing)}",
                sha=sha,
                finalization_id=fid,
            )
        )
    commit_type = trailers.get("COC-Commit-Type", "")
    if commit_type and commit_type != "turn":
        findings.append(
            Finding(
                kind="incomplete_trailer",
                detail=f"COC-Commit-Type={commit_type}",
                sha=sha,
                finalization_id=fid,
            )
        )
    recorded_campaign = trailers.get("Campaign-Id")
    if recorded_campaign and recorded_campaign != campaign_id:
        findings.append(
            Finding(
                kind="incomplete_trailer",
                detail=f"Campaign-Id={recorded_campaign}",
                sha=sha,
                finalization_id=fid,
            )
        )
    turn_number = trailers.get("Turn-Number")
    if turn_number and not _turn_number_ok(turn_number):
        findings.append(
            Finding(
                kind="incomplete_trailer",
                detail=f"Turn-Number={turn_number}",
                sha=sha,
                finalization_id=fid,
            )
        )
    actual_schema = trailers.get("Schema-Generation")
    if actual_schema and actual_schema != expected_schema:
        findings.append(
            Finding(
                kind="schema_generation_mismatch",
                detail=f"expected={expected_schema} actual={actual_schema}",
                sha=sha,
                finalization_id=fid,
            )
        )
    return findings


def _pair_receipts_and_commits(
    receipt_ids: list[str],
    commits_by_fid: dict[str, list[str]],
) -> list[Finding]:
    findings: list[Finding] = []
    seen_receipts: dict[str, int] = {}
    for fid in receipt_ids:
        seen_receipts[fid] = seen_receipts.get(fid, 0) + 1
    for fid, count in seen_receipts.items():
        if count > 1:
            findings.append(
                Finding(
                    kind="duplicate_receipt",
                    detail=f"count={count}",
                    finalization_id=fid,
                )
            )
        shas = commits_by_fid.get(fid, [])
        if not shas:
            findings.append(
                Finding(kind="missing_commit", detail="", finalization_id=fid)
            )
        elif len(shas) > 1:
            for sha in shas:
                findings.append(
                    Finding(
                        kind="duplicate_commit",
                        detail=f"count={len(shas)}",
                        sha=sha,
                        finalization_id=fid,
                    )
                )
    receipt_set = set(seen_receipts)
    for fid, shas in commits_by_fid.items():
        if fid not in receipt_set:
            for sha in shas:
                findings.append(
                    Finding(
                        kind="orphan_commit",
                        detail="",
                        sha=sha,
                        finalization_id=fid,
                    )
                )
    return findings


def _empty_head() -> HeadProof:
    return HeadProof(
        sha=None,
        commit_type=None,
        finalization_id=None,
        turn_number=None,
        trailers=None,
    )


def _empty_receipt() -> ReceiptBinding:
    return ReceiptBinding(finalization_id=None, commit_sha=None, paired=False)


def _empty_tree() -> TreeProof:
    return TreeProof(
        clean=None,
        canonical_paths_present=None,
        dirty_paths=(),
        missing_paths=(),
        drifted_paths=(),
    )


def _read_head_sha(repo: Path, worktree: Path) -> str | None:
    completed = _run_git_readonly(
        ["rev-parse", "--verify", "-q", "HEAD"],
        repo=repo,
        worktree=worktree,
    )
    if completed.returncode != 0:
        return None
    sha = completed.stdout.strip()
    return sha or None


def _head_trailers(repo: Path, worktree: Path) -> tuple[dict[str, str] | None, Finding | None]:
    if _read_head_sha(repo, worktree) is None:
        return None, None
    completed = _run_git_readonly(
        ["log", "-1", "--format=%B"],
        repo=repo,
        worktree=worktree,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip()
        return None, Finding(
            kind=CODE_GIT_LOG_FAILED,
            detail=detail or "git log -1 failed",
        )
    try:
        return hist.parse_trailers(completed.stdout), None
    except hist.GitHistoryUnavailableError as exc:
        return None, Finding(kind=CODE_GIT_UNAVAILABLE, detail=str(exc))
    except hist.GitHistoryError as exc:
        return None, Finding(kind="trailer_parse_failed", detail=str(exc))


def _is_ancestor(repo: Path, worktree: Path, ancestor: str, descendant: str) -> bool:
    completed = _run_git_readonly(
        ["merge-base", "--is-ancestor", ancestor, descendant],
        repo=repo,
        worktree=worktree,
    )
    return completed.returncode == 0


def _head_tree_blobs(repo: Path, worktree: Path) -> dict[str, str]:
    completed = _run_git_readonly(
        ["ls-tree", "-r", "--full-tree", "HEAD"],
        repo=repo,
        worktree=worktree,
    )
    if completed.returncode != 0:
        return {}
    blobs: dict[str, str] = {}
    for line in completed.stdout.splitlines():
        if "\t" not in line:
            continue
        meta, path = line.split("\t", 1)
        parts = meta.split()
        if len(parts) >= 3 and parts[1] == "blob" and path:
            blobs[path] = parts[2]
    return blobs


def _worktree_blob_sha(repo: Path, worktree: Path, relpath: str) -> str | None:
    path = worktree / relpath
    if not path.is_file() or path.is_symlink():
        return None
    completed = _run_git_readonly(
        ["hash-object", "--", str(path)],
        repo=repo,
        worktree=worktree,
    )
    if completed.returncode != 0:
        return None
    sha = completed.stdout.strip()
    return sha or None


def _porcelain_paths(text: str) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    for line in text.splitlines():
        if len(line) < 4:
            continue
        status = line[:2]
        rest = line[3:]
        if " -> " in rest:
            rest = rest.split(" -> ", 1)[1]
        if len(rest) >= 2 and rest[0] == '"' and rest[-1] == '"':
            rest = rest[1:-1]
        if rest:
            rows.append((status, rest))
    return rows


def _required_state_paths(*, require_receipts_log: bool) -> tuple[str, ...]:
    paths = ["campaign.json", "save/world-state.json"]
    if require_receipts_log:
        paths.append("logs/turn-finalizations.jsonl")
    return tuple(paths)


def _inspect_tree(
    repo: Path,
    worktree: Path,
    *,
    require_receipts_log: bool,
) -> tuple[TreeProof, list[Finding]]:
    findings: list[Finding] = []
    blobs = _head_tree_blobs(repo, worktree)
    missing: list[str] = []
    drifted: list[str] = []
    dirty: list[str] = []
    drifted_set: set[str] = set()
    if hist.PENDING_TURN_RELPATH in blobs:
        findings.append(
            Finding(
                kind=CODE_COMMITTED_PENDING_TURN,
                detail="HEAD contains a pending turn; a finalized turn commit must not",
                path=hist.PENDING_TURN_RELPATH,
            )
        )
    for relpath in _required_state_paths(require_receipts_log=require_receipts_log):
        if relpath not in blobs:
            missing.append(relpath)
            findings.append(
                Finding(
                    kind=CODE_MISSING_CANONICAL_PATH,
                    detail="required tracked path absent from HEAD",
                    path=relpath,
                )
            )
    for relpath, head_blob in blobs.items():
        if not hist.is_authoritative_state_path(relpath):
            continue
        worktree_blob = _worktree_blob_sha(repo, worktree, relpath)
        if worktree_blob is None:
            dirty.append(relpath)
            findings.append(
                Finding(
                    kind=CODE_DIRTY_AUTHORITATIVE_STATE,
                    detail="authoritative path missing from worktree",
                    path=relpath,
                )
            )
            continue
        if worktree_blob != head_blob:
            drifted.append(relpath)
            drifted_set.add(relpath)
            findings.append(
                Finding(
                    kind=CODE_HASH_DRIFT,
                    detail=f"head_blob={head_blob} worktree_blob={worktree_blob}",
                    path=relpath,
                )
            )
    status = _run_git_readonly(
        ["status", "--porcelain", "-uall"],
        repo=repo,
        worktree=worktree,
    )
    if status.returncode == 0:
        seen_dirty = set(dirty)
        for _flag, relpath in _porcelain_paths(status.stdout):
            if not hist.is_authoritative_state_path(relpath):
                continue
            if relpath in drifted_set or relpath in seen_dirty:
                continue
            dirty.append(relpath)
            seen_dirty.add(relpath)
            findings.append(
                Finding(
                    kind=CODE_DIRTY_AUTHORITATIVE_STATE,
                    detail="authoritative path differs from HEAD",
                    path=relpath,
                )
            )
    return (
        TreeProof(
            clean=not dirty and not drifted,
            canonical_paths_present=not missing,
            dirty_paths=tuple(dirty),
            missing_paths=tuple(missing),
            drifted_paths=tuple(drifted),
        ),
        findings,
    )


def _decide_status(
    *,
    findings: list[Finding],
    history_enabled: bool,
    git_available: bool,
    history_reset: bool,
    turn_commit_count: int,
    receipt_count: int,
) -> str:
    fail_findings = [item for item in findings if item.kind not in _NOT_PROVEN_CODES]
    if history_reset:
        unexplained = [
            item for item in fail_findings if item.kind not in _RESET_EXPLAINED_CODES
        ]
        if unexplained:
            return STATUS_FAIL
        return STATUS_NOT_PROVEN
    if fail_findings:
        return STATUS_FAIL
    if not history_enabled or not git_available:
        return STATUS_NOT_PROVEN
    if turn_commit_count == 0 and receipt_count == 0:
        return STATUS_NOT_PROVEN
    if findings:
        return STATUS_NOT_PROVEN
    return STATUS_PASS


def _build_proof(
    *,
    campaign_id: str,
    status: str,
    history_enabled: bool,
    repo_present: bool,
    repo_healthy: bool,
    git_available: bool,
    fsck_ok: bool | None,
    repo_path: str | None,
    worktree_path: str | None,
    head: HeadProof | None = None,
    latest_receipt: ReceiptBinding | None = None,
    expected_head_sha: str | None = None,
    head_matches_latest_receipt: bool | None = None,
    later_non_turn_commit: LaterNonTurnCommit | None = None,
    turn_commit_count: int = 0,
    receipt_count: int = 0,
    paired_receipt_count: int = 0,
    tree: TreeProof | None = None,
    history_reset: bool = False,
    findings: Iterable[Finding] = (),
    infos: Iterable[str] = (),
) -> StateIntegrityProof:
    finding_tuple = tuple(findings)
    history_valid = (
        history_enabled
        and git_available
        and fsck_ok is True
        and not any(
            item.kind in {CODE_REPO_NOT_GIT, "fsck_failed", CODE_GIT_LOG_FAILED}
            for item in finding_tuple
        )
    )
    return StateIntegrityProof(
        status=status,
        campaign_id=campaign_id,
        history_enabled=history_enabled,
        history_valid=history_valid,
        repo_present=repo_present,
        repo_healthy=repo_healthy,
        git_available=git_available,
        fsck_ok=fsck_ok,
        repo_path=repo_path,
        worktree_path=worktree_path,
        head=head or _empty_head(),
        latest_receipt=latest_receipt or _empty_receipt(),
        expected_head_sha=expected_head_sha,
        head_matches_latest_receipt=head_matches_latest_receipt,
        later_non_turn_commit=later_non_turn_commit,
        turn_commit_count=turn_commit_count,
        receipt_count=receipt_count,
        paired_receipt_count=paired_receipt_count,
        tree=tree or _empty_tree(),
        history_reset=history_reset,
        findings=finding_tuple,
        infos=tuple(infos),
    )


def state_integrity_proof(
    root: Path | str,
    campaign_id: str,
    *,
    expected_finalization_id: str | None = None,
    valid_finalization_ids: Iterable[str] | None = None,
) -> StateIntegrityProof:
    """Return a structured, fail-closed Git state proof. Read-only.

    ``expected_finalization_id`` binds HEAD to one receipt (exporter latest
    valid row). ``valid_finalization_ids`` replaces the pairing set when the
    caller has already filtered invalid receipts.
    """
    try:
        repo = hist.repo_path_for(root, campaign_id)
        worktree = hist.worktree_path_for(root, campaign_id)
    except ValueError as exc:
        return _build_proof(
            campaign_id=str(campaign_id),
            status=STATUS_NOT_PROVEN,
            history_enabled=False,
            repo_present=False,
            repo_healthy=False,
            git_available=True,
            fsck_ok=None,
            repo_path=None,
            worktree_path=None,
            findings=[
                Finding(kind=CODE_UNSAFE_PATH, detail=str(exc)),
            ],
        )

    repo_s = repo.as_posix()
    worktree_s = worktree.as_posix()
    receipt_ids: list[str] = []
    receipt_findings: list[Finding] = []
    if worktree.is_dir():
        receipt_ids, receipt_findings = _load_receipt_ids(worktree)
    if valid_finalization_ids is not None:
        allowed = {item for item in valid_finalization_ids if isinstance(item, str) and item}
        receipt_ids = [item for item in receipt_ids if item in allowed]

    if not worktree.is_dir():
        return _build_proof(
            campaign_id=campaign_id,
            status=STATUS_NOT_PROVEN,
            history_enabled=False,
            repo_present=repo.exists(),
            repo_healthy=False,
            git_available=True,
            fsck_ok=None,
            repo_path=repo_s,
            worktree_path=worktree_s,
            receipt_count=len(receipt_ids),
            findings=[
                Finding(
                    kind=CODE_CAMPAIGN_MISSING,
                    detail=f"campaign directory not found: {worktree_s}",
                ),
                *receipt_findings,
            ],
        )
    if not repo.exists():
        return _build_proof(
            campaign_id=campaign_id,
            status=STATUS_NOT_PROVEN,
            history_enabled=False,
            repo_present=False,
            repo_healthy=False,
            git_available=True,
            fsck_ok=None,
            repo_path=repo_s,
            worktree_path=worktree_s,
            receipt_count=len(receipt_ids),
            latest_receipt=ReceiptBinding(
                finalization_id=(
                    expected_finalization_id or (receipt_ids[-1] if receipt_ids else None)
                ),
                commit_sha=None,
                paired=False,
            ),
            findings=[
                Finding(
                    kind=CODE_MISSING_SIDECAR_REPO,
                    detail=f"sidecar git repo not found: {repo_s}",
                ),
                *receipt_findings,
            ],
        )
    if not hist.looks_like_git_repo(repo):
        return _build_proof(
            campaign_id=campaign_id,
            status=STATUS_FAIL,
            history_enabled=False,
            repo_present=True,
            repo_healthy=False,
            git_available=True,
            fsck_ok=None,
            repo_path=repo_s,
            worktree_path=worktree_s,
            receipt_count=len(receipt_ids),
            findings=[
                Finding(
                    kind=CODE_REPO_NOT_GIT,
                    detail=f"sidecar path is not a git repo: {repo_s}",
                ),
                *receipt_findings,
            ],
        )

    try:
        _git_executable()
        git_available = True
    except hist.GitHistoryUnavailableError as exc:
        return _build_proof(
            campaign_id=campaign_id,
            status=STATUS_NOT_PROVEN,
            history_enabled=True,
            repo_present=True,
            repo_healthy=False,
            git_available=False,
            fsck_ok=None,
            repo_path=repo_s,
            worktree_path=worktree_s,
            receipt_count=len(receipt_ids),
            findings=[
                Finding(kind=CODE_GIT_UNAVAILABLE, detail=str(exc)),
                *receipt_findings,
            ],
        )

    findings: list[Finding] = list(receipt_findings)
    infos: list[str] = []
    try:
        fsck = _run_git_readonly(
            ["fsck", "--strict"],
            repo=repo,
            worktree=worktree,
        )
    except hist.GitHistoryUnavailableError as exc:
        return _build_proof(
            campaign_id=campaign_id,
            status=STATUS_NOT_PROVEN,
            history_enabled=True,
            repo_present=True,
            repo_healthy=False,
            git_available=False,
            fsck_ok=None,
            repo_path=repo_s,
            worktree_path=worktree_s,
            receipt_count=len(receipt_ids),
            findings=[
                Finding(kind=CODE_GIT_UNAVAILABLE, detail=str(exc)),
                *findings,
            ],
        )
    fsck_ok = fsck.returncode == 0
    if not fsck_ok:
        detail = (fsck.stderr or fsck.stdout).strip().replace("\n", " ")
        findings.append(
            Finding(
                kind="fsck_failed",
                detail=detail or f"exit={fsck.returncode}",
            )
        )

    findings.extend(_read_schema_via_state(worktree))
    expected_schema = hist.format_schema_generation(coc_state.CURRENT_SCHEMA_VERSIONS)

    try:
        records = _commit_log_records(repo, worktree)
    except (hist.GitHistoryError, hist.GitHistoryUnavailableError) as exc:
        kind = (
            CODE_GIT_UNAVAILABLE
            if isinstance(exc, hist.GitHistoryUnavailableError)
            else CODE_GIT_LOG_FAILED
        )
        status = (
            STATUS_NOT_PROVEN if kind == CODE_GIT_UNAVAILABLE else STATUS_FAIL
        )
        return _build_proof(
            campaign_id=campaign_id,
            status=status,
            history_enabled=True,
            repo_present=True,
            repo_healthy=fsck_ok,
            git_available=kind != CODE_GIT_UNAVAILABLE,
            fsck_ok=fsck_ok,
            repo_path=repo_s,
            worktree_path=worktree_s,
            receipt_count=len(receipt_ids),
            findings=[Finding(kind=kind, detail=str(exc)), *findings],
        )

    commits_by_fid: dict[str, list[str]] = {}
    turn_commit_count = 0
    history_reset = False
    reset_reason: str | None = None
    for sha, body in records:
        try:
            trailers = hist.parse_trailers(body)
        except hist.GitHistoryUnavailableError as exc:
            return _build_proof(
                campaign_id=campaign_id,
                status=STATUS_NOT_PROVEN,
                history_enabled=True,
                repo_present=True,
                repo_healthy=fsck_ok,
                git_available=False,
                fsck_ok=fsck_ok,
                repo_path=repo_s,
                worktree_path=worktree_s,
                receipt_count=len(receipt_ids),
                findings=[
                    Finding(kind=CODE_GIT_UNAVAILABLE, detail=str(exc)),
                    *findings,
                ],
            )
        except hist.GitHistoryError as exc:
            findings.append(
                Finding(kind="trailer_parse_failed", detail=str(exc), sha=sha)
            )
            continue
        commit_type = trailers.get("COC-Commit-Type", "")
        if commit_type == "baseline":
            infos.append(f"baseline sha={sha}")
        reset_value = trailers.get("COC-History-Reset")
        if reset_value:
            history_reset = True
            reset_reason = reset_value
            infos.append(f"history-reset sha={sha} reason={reset_value}")
        fid = (trailers.get("Finalization-Id") or "").strip()
        if fid:
            commits_by_fid.setdefault(fid, []).append(sha)
        if commit_type == "turn":
            turn_commit_count += 1
            findings.extend(
                _validate_turn_trailers(
                    sha,
                    trailers,
                    campaign_id=campaign_id,
                    expected_schema=expected_schema,
                )
            )
        elif commit_type not in {"", "baseline"} and "COC-History-Reset" not in trailers:
            findings.append(
                Finding(
                    kind="unexpected_commit_type",
                    detail=f"COC-Commit-Type={commit_type}",
                    sha=sha,
                    finalization_id=fid or None,
                )
            )

    findings.extend(_pair_receipts_and_commits(receipt_ids, commits_by_fid))

    latest_receipt_id = expected_finalization_id or (
        receipt_ids[-1] if receipt_ids else None
    )
    if expected_finalization_id and expected_finalization_id not in receipt_ids:
        findings.append(
            Finding(
                kind=CODE_MISSING_RECEIPT,
                detail="expected finalization is not in the receipt log",
                finalization_id=expected_finalization_id,
            )
        )
    elif turn_commit_count > 0 and not receipt_ids:
        findings.append(
            Finding(
                kind=CODE_MISSING_RECEIPT,
                detail="turn commits exist but no finalization receipt was found",
            )
        )

    expected_shas = (
        list(commits_by_fid.get(latest_receipt_id, []))
        if latest_receipt_id
        else []
    )
    expected_head_sha = expected_shas[0] if len(expected_shas) == 1 else None
    paired_receipt_count = sum(
        1
        for fid in dict.fromkeys(receipt_ids)
        if len(commits_by_fid.get(fid, [])) == 1
    )

    head_sha = _read_head_sha(repo, worktree)
    head_trailers, head_trailer_finding = _head_trailers(repo, worktree)
    if head_trailer_finding is not None:
        findings.append(head_trailer_finding)
        if head_trailer_finding.kind == CODE_GIT_UNAVAILABLE:
            return _build_proof(
                campaign_id=campaign_id,
                status=STATUS_NOT_PROVEN,
                history_enabled=True,
                repo_present=True,
                repo_healthy=fsck_ok,
                git_available=False,
                fsck_ok=fsck_ok,
                repo_path=repo_s,
                worktree_path=worktree_s,
                receipt_count=len(receipt_ids),
                turn_commit_count=turn_commit_count,
                findings=findings,
                infos=infos,
                history_reset=history_reset,
            )
    head_commit_type = (head_trailers or {}).get("COC-Commit-Type") or None
    head_fid = ((head_trailers or {}).get("Finalization-Id") or "").strip() or None
    head_turn = ((head_trailers or {}).get("Turn-Number") or "").strip() or None
    head = HeadProof(
        sha=head_sha,
        commit_type=head_commit_type,
        finalization_id=head_fid,
        turn_number=head_turn,
        trailers=dict(head_trailers) if head_trailers is not None else None,
    )
    latest_binding = ReceiptBinding(
        finalization_id=latest_receipt_id,
        commit_sha=expected_head_sha,
        paired=bool(latest_receipt_id and expected_head_sha),
    )

    later_non_turn: LaterNonTurnCommit | None = None
    head_matches: bool | None = None
    if latest_receipt_id:
        head_matches = (
            head_sha is not None
            and expected_head_sha is not None
            and head_sha == expected_head_sha
            and head_commit_type == "turn"
            and head_fid == latest_receipt_id
        )
        if not head_matches:
            is_later = bool(
                head_sha
                and expected_head_sha
                and head_commit_type != "turn"
                and _is_ancestor(repo, worktree, expected_head_sha, head_sha)
            )
            if is_later and head_sha is not None:
                reason_code = (
                    CODE_HISTORY_RESET if history_reset else "unpermitted_non_turn"
                )
                later_non_turn = LaterNonTurnCommit(
                    sha=head_sha,
                    commit_type=head_commit_type or "",
                    reason_code=reason_code,
                    reason=reset_reason,
                    permitted=reason_code in _PERMITTED_LATER_NON_TURN,
                )
                findings.append(
                    Finding(
                        kind=CODE_LATER_NON_TURN,
                        detail=(
                            f"reason_code={reason_code} "
                            f"commit_type={head_commit_type or ''}"
                        ),
                        sha=head_sha,
                        finalization_id=latest_receipt_id,
                    )
                )
                if not later_non_turn.permitted:
                    findings.append(
                        Finding(
                            kind=CODE_WRONG_HEAD,
                            detail=(
                                f"head={head_sha} expected={expected_head_sha} "
                                f"head_finalization_id={head_fid or ''} "
                                f"latest_receipt_id={latest_receipt_id}"
                            ),
                            sha=head_sha,
                            finalization_id=latest_receipt_id,
                        )
                    )
            else:
                findings.append(
                    Finding(
                        kind=CODE_WRONG_HEAD,
                        detail=(
                            f"head={head_sha or ''} "
                            f"expected={expected_head_sha or ''} "
                            f"head_finalization_id={head_fid or ''} "
                            f"latest_receipt_id={latest_receipt_id}"
                        ),
                        sha=head_sha,
                        finalization_id=latest_receipt_id,
                    )
                )
    elif head_sha is not None and turn_commit_count == 0:
        findings.append(
            Finding(
                kind=CODE_BASELINE_ONLY,
                detail="no finalized turn commit or receipt",
                sha=head_sha,
            )
        )

    if history_reset:
        findings.append(
            Finding(
                kind=CODE_HISTORY_RESET,
                detail=reset_reason or "COC-History-Reset present",
                sha=head_sha,
            )
        )

    tree = _empty_tree()
    if head_sha is not None:
        tree, tree_findings = _inspect_tree(
            repo,
            worktree,
            require_receipts_log=bool(latest_receipt_id or turn_commit_count),
        )
        findings.extend(tree_findings)

    status = _decide_status(
        findings=findings,
        history_enabled=True,
        git_available=True,
        history_reset=history_reset,
        turn_commit_count=turn_commit_count,
        receipt_count=len(receipt_ids),
    )
    return _build_proof(
        campaign_id=campaign_id,
        status=status,
        history_enabled=True,
        repo_present=True,
        repo_healthy=fsck_ok,
        git_available=git_available,
        fsck_ok=fsck_ok,
        repo_path=repo_s,
        worktree_path=worktree_s,
        head=head,
        latest_receipt=latest_binding,
        expected_head_sha=expected_head_sha,
        head_matches_latest_receipt=head_matches,
        later_non_turn_commit=later_non_turn,
        turn_commit_count=turn_commit_count,
        receipt_count=len(receipt_ids),
        paired_receipt_count=paired_receipt_count,
        tree=tree,
        history_reset=history_reset,
        findings=findings,
        infos=infos,
    )


def _cli_error(proof: StateIntegrityProof) -> str | None:
    for finding in proof.findings:
        if finding.kind == CODE_UNSAFE_PATH:
            return f"ERROR: {finding.detail}"
        if finding.kind == CODE_CAMPAIGN_MISSING:
            return f"ERROR: campaign directory not found: {proof.worktree_path}"
        if finding.kind == CODE_MISSING_SIDECAR_REPO:
            return f"ERROR: sidecar git repo not found: {proof.repo_path}"
        if finding.kind == CODE_REPO_NOT_GIT:
            return f"ERROR: sidecar path is not a git repo: {proof.repo_path}"
        if finding.kind == CODE_GIT_UNAVAILABLE:
            return f"ERROR: {finding.detail}"
        if finding.kind == CODE_GIT_LOG_FAILED:
            return f"ERROR: {finding.detail}"
    return None


def _report_from_proof(proof: StateIntegrityProof) -> VerifyReport:
    error = _cli_error(proof)
    if error:
        return VerifyReport(
            exit_code=2,
            error=error,
            turn_commit_count=proof.turn_commit_count,
            receipt_count=proof.receipt_count,
        )
    cli_findings = [
        finding
        for finding in proof.findings
        if finding.kind not in _CLI_OMIT_FINDING_CODES
    ]
    if proof.status == STATUS_PASS:
        exit_code = 0
    elif proof.status == STATUS_NOT_PROVEN and not cli_findings:
        exit_code = 2
    elif cli_findings:
        exit_code = 1
    else:
        exit_code = 2
    return VerifyReport(
        exit_code=exit_code,
        findings=cli_findings,
        infos=list(proof.infos),
        turn_commit_count=proof.turn_commit_count,
        receipt_count=proof.receipt_count,
    )


def verify_campaign(root: Path | str, campaign_id: str) -> VerifyReport:
    """Inspect one campaign's sidecar history. Read-only."""
    return _report_from_proof(state_integrity_proof(root, campaign_id))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Read-only diagnostic for a campaign sidecar git history "
            "(fsck, trailers, finalization 1:1). Reports only; never repairs."
        )
    )
    parser.add_argument(
        "--root",
        default=".",
        help="project root containing .coc/",
    )
    parser.add_argument(
        "--campaign",
        required=True,
        help="campaign id",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="emit the machine-readable state integrity proof",
    )
    args = parser.parse_args(argv)
    try:
        if args.json:
            proof = state_integrity_proof(args.root, args.campaign)
            sys.stdout.write(
                json.dumps(proof.to_dict(), ensure_ascii=False, indent=2) + "\n"
            )
            return {STATUS_PASS: 0, STATUS_FAIL: 1, STATUS_NOT_PROVEN: 2}[
                proof.status
            ]
        report = verify_campaign(args.root, args.campaign)
    except hist.GitHistoryUnavailableError as exc:
        sys.stderr.write(f"ERROR: {exc}\n")
        return 2
    lines = report.render_lines()
    text = "\n".join(lines) + "\n"
    if report.error:
        sys.stderr.write(text)
    else:
        sys.stdout.write(text)
    return report.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
