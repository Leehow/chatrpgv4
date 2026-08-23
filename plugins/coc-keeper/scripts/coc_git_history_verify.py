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
from typing import Any

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


@dataclass(frozen=True)
class Finding:
    kind: str
    detail: str
    sha: str | None = None
    finalization_id: str | None = None

    def render(self) -> str:
        parts = [self.kind]
        if self.sha:
            parts.append(f"sha={self.sha}")
        if self.finalization_id:
            parts.append(f"finalization_id={self.finalization_id}")
        if self.detail:
            parts.append(self.detail)
        return " ".join(parts)


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


def _looks_like_git_repo(repo: Path) -> bool:
    return repo.is_dir() and (repo / "HEAD").is_file() and (repo / "objects").is_dir()


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


def verify_campaign(root: Path | str, campaign_id: str) -> VerifyReport:
    """Inspect one campaign's sidecar history. Read-only."""
    try:
        repo = hist.repo_path_for(root, campaign_id)
        worktree = hist.worktree_path_for(root, campaign_id)
    except ValueError as exc:
        return VerifyReport(exit_code=2, error=f"ERROR: {exc}")

    if not worktree.is_dir():
        return VerifyReport(
            exit_code=2,
            error=f"ERROR: campaign directory not found: {worktree}",
        )
    if not repo.exists():
        return VerifyReport(
            exit_code=2,
            error=f"ERROR: sidecar git repo not found: {repo}",
        )
    if not _looks_like_git_repo(repo):
        return VerifyReport(
            exit_code=2,
            error=f"ERROR: sidecar path is not a git repo: {repo}",
        )

    try:
        _git_executable()
    except hist.GitHistoryUnavailableError as exc:
        return VerifyReport(exit_code=2, error=f"ERROR: {exc}")

    findings: list[Finding] = []
    infos: list[str] = []

    try:
        fsck = _run_git_readonly(
            ["fsck", "--strict"],
            repo=repo,
            worktree=worktree,
        )
    except hist.GitHistoryUnavailableError as exc:
        return VerifyReport(exit_code=2, error=f"ERROR: {exc}")
    if fsck.returncode != 0:
        detail = (fsck.stderr or fsck.stdout).strip().replace("\n", " ")
        findings.append(
            Finding(
                kind="fsck_failed",
                detail=detail or f"exit={fsck.returncode}",
            )
        )

    findings.extend(_read_schema_via_state(worktree))
    expected_schema = hist.format_schema_generation(coc_state.CURRENT_SCHEMA_VERSIONS)

    receipt_ids, receipt_findings = _load_receipt_ids(worktree)
    findings.extend(receipt_findings)

    try:
        records = _commit_log_records(repo, worktree)
    except (hist.GitHistoryError, hist.GitHistoryUnavailableError) as exc:
        return VerifyReport(exit_code=2, error=f"ERROR: {exc}")

    commits_by_fid: dict[str, list[str]] = {}
    turn_commit_count = 0
    for sha, body in records:
        try:
            trailers = hist.parse_trailers(body)
        except hist.GitHistoryUnavailableError as exc:
            return VerifyReport(exit_code=2, error=f"ERROR: {exc}")
        except hist.GitHistoryError as exc:
            findings.append(
                Finding(kind="trailer_parse_failed", detail=str(exc), sha=sha)
            )
            continue
        commit_type = trailers.get("COC-Commit-Type", "")
        if commit_type == "baseline":
            infos.append(f"baseline sha={sha}")
        if trailers.get("COC-History-Reset"):
            infos.append(
                f"history-reset sha={sha} reason={trailers['COC-History-Reset']}"
            )
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

    if findings:
        exit_code = 1
    elif turn_commit_count == 0 and len(receipt_ids) == 0:
        exit_code = 2
    else:
        exit_code = 0
    return VerifyReport(
        exit_code=exit_code,
        findings=findings,
        infos=infos,
        turn_commit_count=turn_commit_count,
        receipt_count=len(receipt_ids),
    )


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
    args = parser.parse_args(argv)
    try:
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
