#!/usr/bin/env python3
"""Read-only diagnostic for per-campaign sidecar git history.

Reports fsck, trailer completeness, and 1:1 pairing between
``logs/turn-finalizations.jsonl`` receipts and ``Finalization-Id`` commits,
plus the worldline/temporal sweeps:

- timeline DAG validity (unique ``tl-main`` root, parent reachability,
  no cycles, fork exactly-one-parent / confluence exactly-two-distinct
  parents, active pointer valid);
- trailer completeness for turn/confluence commits across *all* timeline
  lineages, confluence manifest binding, and recorded-confluence coverage;
- projection-vs-Git identity: the facade's ``projection_runs`` row must
  carry the current generation marker and match a deterministic shadow
  rebuild of the same Git history (digest/head/commit_count);
- explicit zero-record reporting for timelines/confluences/transfers/
  episodes/backlog/ambiguous-canonical-ids — zero is reported as zero,
  never omitted;
- one advisory introduction-lineage sweep: every canonical id (roll /
  effect / transaction / receipt ids extracted from the tracked JSONL
  stores, plus episode ledger ids) must have a SINGLE introducing
  timeline lineage. Two sibling lineages whose introducing commits are
  mutually unrelated ancestors make lineage binding rebuild-order-
  dependent; such ids are reported as structured worldline advisories
  without ever flipping the core proof status (see
  ``worldline_advisories`` / ``worldline_counts``).

Never writes the campaign tree, the sidecar repo, or any cache file.
The projection database itself is opened read-only and the shadow rebuild
is built in a system temp directory; missing/corrupt stores are findings,
never exceptions. All worldline/projection results are advisory evidence
for closeout/acceptance — this tool adds no runtime gate.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_git_history as hist
import coc_state
import coc_history_projection as proj_facade
import coc_history_projection_events as proj_events
import coc_history_projection_git as proj_git
import coc_history_projection_schema as proj_schema

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

CONFLUENCE_TRAILER_KEYS: tuple[str, ...] = (
    "COC-Commit-Type",
    "Campaign-Id",
    "Timeline-Id",
    "Confluence-Id",
    "Parent-Timeline-Left",
    "Parent-Timeline-Right",
    "Conflict-Manifest-SHA256",
    "Disposition-Manifest-SHA256",
    "Schema-Generation",
)

_ALLOWED_COMMIT_TYPES = frozenset({"", "baseline", "turn", "confluence"})

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
CODE_TIMELINE_REF_MISSING = "timeline_ref_missing"
CODE_FORK_TOPOLOGY = "fork_topology"
CODE_CONFLUENCE_PARENTS = "confluence_parents"
CODE_CONFLUENCE_TRAILER = "confluence_trailer"
CODE_CONFLUENCE_MANIFEST = "confluence_manifest_mismatch"
CODE_CONFLUENCE_TREE = "confluence_tree_unbound"
CODE_ORPHAN_TIMELINE_REF = "orphan_timeline_ref"
# Worldline DAG sweep (timeline-state structure).
CODE_DAG_DUPLICATE = "duplicate_timeline"
CODE_DAG_MALFORMED = "timeline_record_malformed"
CODE_DAG_ROOT = "dag_root_invalid"
CODE_DAG_CYCLE = "dag_cycle"
CODE_DAG_PARENT_UNKNOWN = "dag_parent_unknown"
CODE_DAG_DISCONNECTED = "dag_disconnected"
CODE_ACTIVE_TIMELINE_INVALID = "active_timeline_invalid"
CODE_CONFLUENCE_UNRECORDED = "confluence_unrecorded"
# Temporal store integrity (advisory JSONL stores beside the projector).
CODE_TEMPORAL_STORE_CORRUPT = "temporal_store_corrupt"
# Projection-vs-Git identity (history-projection cache).
CODE_PROJECTION_REBUILD_NEEDED = "projection_rebuild_needed"
CODE_PROJECTION_UNREADABLE = "projection_unreadable"
CODE_PROJECTION_DRIFT = "projection_drift"
GIT_SCAN_FAILED = "git_scan_failed"

#: Record categories whose counts are reported explicitly, including zero.
WORLDLINE_COUNT_KEYS: tuple[str, ...] = (
    "timelines",
    "confluences",
    "transfers",
    "episodes",
    "backlog",
    # Advisory count: canonical ids whose introducing timeline lineage is
    # ambiguous (minted independently on mutually unrelated siblings).
    "ambiguous_canonical_ids",
)

#: Advisory append-only temporal stores living under ``memory/temporal/``.
_TEMPORAL_STORE_FILES: tuple[tuple[str, str], ...] = (
    ("transfers", "transfers.jsonl"),
    ("episodes", "episodes.jsonl"),
    ("backlog", "backlog.jsonl"),
)

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

#: Projection-identity verdicts that fail their dimension outright.
#: They live in ``projection_findings`` / ``projection_status`` and hold
#: the sweep exit at 1, but never enter the core finalize/git findings.
_PROJECTION_HARD_CODES = frozenset(
    {
        CODE_PROJECTION_DRIFT,
        CODE_PROJECTION_UNREADABLE,
        GIT_SCAN_FAILED,
    }
)

#: Advisory severity marker for ambiguous canonical-id introductions.
#: Never a Finding kind: the finding must not flip core proof status; it
#: surfaces as ``worldline_advisories`` payload entries plus the
#: ``ambiguous_canonical_ids`` machine count.
CODE_AMBIGUOUS_CANONICAL_ID = "ambiguous_canonical_id"
#: Structured examples rendered per ambiguous id, capped deterministically.
AMBIGUOUS_ID_EXAMPLES_MAX = 5
#: Tracked episode ledger the introduction sweep scans for episode ids.
_EPISODE_STORE_RELPATH = "memory/temporal/episodes.jsonl"


def _projection_dimension_status(
    projection_findings: Iterable[Finding],
) -> str:
    """Collapse projection-sweep findings into one dimension verdict.

    PASS when identity was proven; NOT_PROVEN when the rebuildable cache
    simply does not exist yet (an explicit "rebuild needed" gap that must
    never downgrade the core finalize/git proof); FAIL on a present-but-
    wrong cache (drift, corrupt store, unreadable generation).
    """
    kinds = {finding.kind for finding in projection_findings}
    if kinds & _PROJECTION_HARD_CODES:
        return STATUS_FAIL
    if CODE_PROJECTION_REBUILD_NEEDED in kinds:
        return STATUS_NOT_PROVEN
    return STATUS_PASS


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
    core_pass_worldline_gap: bool = False

    def render_lines(self) -> list[str]:
        lines: list[str] = []
        if self.error:
            lines.append(self.error)
        elif self.core_pass_worldline_gap:
            # Core finalize/git proof passed but the projection dimension
            # still owes a rebuild; the sweep holds exit at 2.
            lines.append(
                "GIT HISTORY CHECK PASSED (core): "
                f"{self.turn_commit_count} turn commit(s), "
                f"{self.receipt_count} receipt(s)"
            )
            lines.append(
                "WORLDLINE GAP: history projection missing — deterministic "
                "rebuild pending (exit held at 2, advisory)"
            )
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
    worldline_counts: dict[str, int] = field(default_factory=dict)
    #: Projection-vs-Git dimension verdict (PASS/FAIL/NOT_PROVEN); ``None``
    #: when the sweep did not run. Non-authoritative rebuildable cache —
    #: never downgrades the core finalize/git proof status.
    projection_status: str | None = None
    projection_findings: tuple[Finding, ...] = ()
    #: Advisory introduction-lineage findings for canonical ids minted
    #: independently on mutually unrelated sibling timelines (ordered by
    #: canonical id, capped at ``AMBIGUOUS_ID_EXAMPLES_MAX``). Never part
    #: of core ``findings`` and never flips the core status.
    worldline_advisories: tuple[dict[str, Any], ...] = ()
    #: Exact rev this proof signed. ``HEAD`` for a default single-line
    #: campaign; the active timeline's ref once an active pointer exists
    #: (post-fork/post-confluence campaigns sign their own tip, not main).
    #: ``None`` only when resolution never ran (early structural exits).
    signed_ref: str | None = None
    #: Semantic timeline id that selected ``signed_ref`` when no explicit
    #: ref was pinned by the caller; ``None`` otherwise. Reports the
    #: active-vs-main distinction explicitly.
    signed_timeline_id: str | None = None

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
            "worldline_counts": dict(self.worldline_counts),
            "projection_status": self.projection_status,
            "projection_findings": [
                finding.to_dict() for finding in self.projection_findings
            ],
            "worldline_advisories": [
                dict(advisory) for advisory in self.worldline_advisories
            ],
            "signed_ref": self.signed_ref,
            "signed_timeline_id": self.signed_timeline_id,
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


def _rev_exists(repo: Path, worktree: Path, rev: str) -> bool:
    completed = _run_git_readonly(
        ["rev-parse", "--verify", "-q", rev],
        repo=repo,
        worktree=worktree,
    )
    return completed.returncode == 0 and bool(completed.stdout.strip())


def _head_exists(repo: Path, worktree: Path) -> bool:
    return _rev_exists(repo, worktree, "HEAD")


def _commit_log_records(
    repo: Path, worktree: Path, *, rev: str = "HEAD"
) -> list[tuple[str, str]]:
    if not _rev_exists(repo, worktree, rev):
        return []
    completed = _run_git_readonly(
        ["log", "--format=%H%x1e%B%x1d", rev],
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


def _read_rev_sha(repo: Path, worktree: Path, rev: str) -> str | None:
    completed = _run_git_readonly(
        ["rev-parse", "--verify", "-q", rev],
        repo=repo,
        worktree=worktree,
    )
    if completed.returncode != 0:
        return None
    sha = completed.stdout.strip()
    return sha or None


def _read_head_sha(repo: Path, worktree: Path) -> str | None:
    return _read_rev_sha(repo, worktree, "HEAD")


def _head_trailers(
    repo: Path, worktree: Path, *, rev: str = "HEAD"
) -> tuple[dict[str, str] | None, Finding | None]:
    if _read_rev_sha(repo, worktree, rev) is None:
        return None, None
    completed = _run_git_readonly(
        ["log", "-1", "--format=%B", rev],
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


def _head_tree_blobs(
    repo: Path, worktree: Path, *, rev: str = "HEAD"
) -> dict[str, str]:
    completed = _run_git_readonly(
        ["ls-tree", "-r", "--full-tree", rev],
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
    rev: str = "HEAD",
) -> tuple[TreeProof, list[Finding]]:
    findings: list[Finding] = []
    blobs = _head_tree_blobs(repo, worktree, rev=rev)
    missing: list[str] = []
    drifted: list[str] = []
    dirty: list[str] = []
    drifted_set: set[str] = set()
    if hist.PENDING_TURN_RELPATH in blobs:
        findings.append(
            Finding(
                kind=CODE_COMMITTED_PENDING_TURN,
                detail="commit contains a pending turn; a finalized turn commit must not",
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
    proven_sha = _read_rev_sha(repo, worktree, rev)
    head_sha = _read_head_sha(repo, worktree)
    if proven_sha is not None and proven_sha == head_sha:
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
    worldline_counts: dict[str, int] | None = None,
    projection_status: str | None = None,
    projection_findings: Iterable[Finding] = (),
    worldline_advisories: Iterable[dict[str, Any]] = (),
    signed_ref: str | None = None,
    signed_timeline_id: str | None = None,
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
        worldline_counts=dict(worldline_counts) if worldline_counts else {},
        projection_status=projection_status,
        projection_findings=tuple(projection_findings),
        worldline_advisories=tuple(
            dict(advisory) for advisory in worldline_advisories
        ),
        signed_ref=signed_ref,
        signed_timeline_id=signed_timeline_id,
    )


def _validate_confluence_trailers(
    sha: str,
    trailers: dict[str, str],
    *,
    campaign_id: str,
) -> list[Finding]:
    findings: list[Finding] = []
    missing = [
        key
        for key in CONFLUENCE_TRAILER_KEYS
        if not (trailers.get(key) or "").strip()
    ]
    if missing:
        findings.append(
            Finding(
                kind=CODE_CONFLUENCE_TRAILER,
                detail=f"missing={','.join(missing)}",
                sha=sha,
            )
        )
    commit_type = trailers.get("COC-Commit-Type", "")
    if commit_type and commit_type != "confluence":
        findings.append(
            Finding(
                kind=CODE_CONFLUENCE_TRAILER,
                detail=f"COC-Commit-Type={commit_type}",
                sha=sha,
            )
        )
    recorded_campaign = trailers.get("Campaign-Id")
    if recorded_campaign and recorded_campaign != campaign_id:
        findings.append(
            Finding(
                kind=CODE_CONFLUENCE_TRAILER,
                detail=f"Campaign-Id={recorded_campaign}",
                sha=sha,
            )
        )
    for digest_key in ("Conflict-Manifest-SHA256", "Disposition-Manifest-SHA256"):
        value = (trailers.get(digest_key) or "").strip()
        if value and len(value) != 64:
            findings.append(
                Finding(
                    kind=CODE_CONFLUENCE_TRAILER,
                    detail=f"{digest_key} is not a sha256 digest",
                    sha=sha,
                )
            )
    return findings


def _commit_parent_count(repo: Path, worktree: Path, sha: str) -> int:
    completed = _run_git_readonly(
        ["rev-list", "--no-walk", "--parents", sha],
        repo=repo,
        worktree=worktree,
    )
    if completed.returncode != 0:
        return -1
    parts = completed.stdout.strip().split()
    return max(0, len(parts) - 1)


def _confluence_parent_shas(
    repo: Path, worktree: Path, merge: str
) -> tuple[str, str] | None:
    completed = _run_git_readonly(
        ["rev-list", "--no-walk", "--parents", merge],
        repo=repo,
        worktree=worktree,
    )
    if completed.returncode != 0:
        return None
    parts = completed.stdout.strip().split()
    if len(parts) != 3:
        return None
    return parts[1], parts[2]


def _check_confluence_manifest_binding(
    repo: Path,
    worktree: Path,
    *,
    record: dict[str, Any],
    trailers: dict[str, str],
    merge: str,
) -> list[Finding]:
    """Recompute the manifest/tree binding of one confluence commit.

    The committed conflict and disposition manifest digests must match the
    recorded timeline-state conflicts, the semantic parent trailers must
    match the recorded parents, and the merge tree must follow the
    deterministic per-path resolutions derived from those conflicts
    (mechanical dispositions carry the chosen parent blob exactly; dropped
    paths stay absent; content-producing dispositions keep the path).
    Any drift between the recorded manifest and the committed evidence
    fails closed.
    """
    findings: list[Finding] = []
    parents = record.get("parents") or []
    recorded_left = (trailers.get("Parent-Timeline-Left") or "").strip()
    recorded_right = (trailers.get("Parent-Timeline-Right") or "").strip()
    if (
        len(parents) == 2
        and [recorded_left, recorded_right] != [parents[0], parents[1]]
    ):
        findings.append(
            Finding(
                kind=CODE_CONFLUENCE_MANIFEST,
                detail=(
                    f"parent_trailers={recorded_left},{recorded_right} "
                    f"record_parents={','.join(str(item) for item in parents)}"
                ),
                sha=merge,
            )
        )
    conflicts = [
        item for item in (record.get("conflicts") or []) if isinstance(item, dict)
    ]
    conflict_digest = hist.tm_contract.record_digest({"conflicts": conflicts})
    if (trailers.get("Conflict-Manifest-SHA256") or "") != conflict_digest:
        findings.append(
            Finding(
                kind=CODE_CONFLUENCE_MANIFEST,
                detail="conflict manifest digest does not match the recorded conflicts",
                sha=merge,
            )
        )
    dispositions = [
        {
            "conflict_id": item.get("conflict_id"),
            "disposition": item.get("disposition"),
        }
        for item in conflicts
    ]
    disposition_digest = hist.tm_contract.record_digest(
        {"dispositions": dispositions}
    )
    if (trailers.get("Disposition-Manifest-SHA256") or "") != disposition_digest:
        findings.append(
            Finding(
                kind=CODE_CONFLUENCE_MANIFEST,
                detail=(
                    "disposition manifest digest does not match the recorded "
                    "dispositions"
                ),
                sha=merge,
            )
        )
    parent_shas = _confluence_parent_shas(repo, worktree, merge)
    if parent_shas is None:
        return findings
    left_sha, right_sha = parent_shas
    for problem in hist.check_confluence_tree_binding(
        repo,
        worktree,
        merge_sha=merge,
        left_sha=left_sha,
        right_sha=right_sha,
        conflicts=conflicts,
    ):
        findings.append(
            Finding(kind=CODE_CONFLUENCE_TREE, detail=problem, sha=merge)
        )
    return findings


def _default_signed_timeline(root: Path | str, campaign_id: str) -> str | None:
    """Semantic id of the timeline new turns commit to, or ``None``.

    Resolved through the Git coordinator (``active_timeline_id``), never by
    hardcoding a branch name. ``None`` means no readable active pointer —
    the caller keeps the legacy HEAD default and the structural worldline
    sweep reports the underlying state problem.
    """
    try:
        return hist.active_timeline_id(root, campaign_id)
    except (ValueError, hist.GitHistoryError):
        return None


def _resolve_proof_rev(
    repo: Path, worktree: Path, timeline_ref: str | None
) -> tuple[str, list[Finding]]:
    if not timeline_ref:
        return "HEAD", []
    token = timeline_ref.strip()
    if token in {"HEAD", hist.DEFAULT_BRANCH, f"refs/heads/{hist.DEFAULT_BRANCH}"}:
        return "HEAD", []
    if token.startswith("refs/"):
        if not _rev_exists(repo, worktree, token):
            return token, [
                Finding(
                    kind=CODE_TIMELINE_REF_MISSING,
                    detail=f"timeline ref not found: {token}",
                )
            ]
        return token, []
    try:
        ref = hist.timeline_ref_name(token)
    except (ValueError, hist.GitHistoryError) as exc:
        return token, [
            Finding(kind=CODE_TIMELINE_REF_MISSING, detail=str(exc))
        ]
    if not _rev_exists(repo, worktree, ref):
        return ref, [
            Finding(
                kind=CODE_TIMELINE_REF_MISSING,
                detail=f"timeline ref not found: {token}",
            )
        ]
    return ref, []


def _foreign_finalization_ids(
    repo: Path, worktree: Path, proven_rev: str
) -> set[str]:
    proven: set[str] = set()
    for _sha, body in _commit_log_records(repo, worktree, rev=proven_rev):
        try:
            trailers = hist.parse_trailers(body)
        except hist.GitHistoryError:
            continue
        fid = (trailers.get("Finalization-Id") or "").strip()
        if fid:
            proven.add(fid)
    refs = ["HEAD", "refs/heads/main"]
    listed = _run_git_readonly(
        ["for-each-ref", "--format=%(refname)", hist.TIMELINE_REF_PREFIX],
        repo=repo,
        worktree=worktree,
    )
    if listed.returncode == 0:
        refs.extend(
            line.strip() for line in listed.stdout.splitlines() if line.strip()
        )
    foreign: set[str] = set()
    seen_refs: set[str] = set()
    for ref in refs:
        if ref in seen_refs or not _rev_exists(repo, worktree, ref):
            continue
        seen_refs.add(ref)
        for _sha, body in _commit_log_records(repo, worktree, rev=ref):
            try:
                trailers = hist.parse_trailers(body)
            except hist.GitHistoryError:
                continue
            fid = (trailers.get("Finalization-Id") or "").strip()
            if fid and fid not in proven:
                foreign.add(fid)
    return foreign


def _list_timeline_git_refs(repo: Path, worktree: Path) -> set[str]:
    """Timeline heads known to the sidecar repo (read-only)."""
    listed = _run_git_readonly(
        ["for-each-ref", "--format=%(refname)", hist.TIMELINE_REF_PREFIX],
        repo=repo,
        worktree=worktree,
    )
    if listed.returncode != 0:
        return set()
    return {
        line.strip()
        for line in listed.stdout.splitlines()
        if line.strip()
    }


def _load_raw_timeline_state(
    worktree: Path,
) -> tuple[dict[str, Any] | None, list[Finding]]:
    """Parse ``save/timeline-state.json`` without contract hard-failing.

    A file that is absent means a single-default-timeline campaign (the
    implied state). Anything present but unreadable/not-current-generation
    is a structured finding so the caller can keep sweeping the rest.
    """
    path = worktree / hist.TIMELINE_STATE_RELPATH
    if not path.is_file():
        return None, []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return None, [
            Finding(
                kind="timeline_state_unreadable",
                detail=f"timeline-state.json is unreadable: {exc}",
            )
        ]
    if not isinstance(payload, dict):
        return None, [
            Finding(
                kind="timeline_state_unreadable",
                detail="timeline-state.json must be a JSON object",
            )
        ]
    generation = payload.get("schema_generation")
    if generation != hist.TIMELINE_STATE_SCHEMA:
        return None, [
            Finding(
                kind="timeline_state_unreadable",
                detail=(
                    "timeline-state.json schema_generation must be "
                    f"{hist.TIMELINE_STATE_SCHEMA!r}"
                ),
            )
        ]
    return payload, []


def _verify_timeline_structure(
    state: dict[str, Any],
) -> tuple[list[Finding], dict[str, int]]:
    """Structural worldline DAG rules over the raw timeline-state.

    Covers: unique ids, unique ``tl-main`` root, resolvable parents,
    acyclicity, root reachability, fork exactly-one-parent, confluence
    exactly-two-distinct-parents, and a valid active pointer. Every rule
    reports separately so one broken save never masks the others.
    """
    findings: list[Finding] = []
    counts = {"timelines": 0, "confluences": 0}
    timelines_value = state.get("timelines")
    if timelines_value is None:
        timelines_value = []
    if not isinstance(timelines_value, list):
        findings.append(
            Finding(CODE_DAG_MALFORMED, detail="timelines must be a list")
        )
        timelines_value = []
    by_id: dict[str, dict[str, Any]] = {}
    for record in timelines_value:
        if not isinstance(record, dict):
            findings.append(
                Finding(
                    CODE_DAG_MALFORMED,
                    detail="timeline entry must be a JSON object",
                )
            )
            continue
        tid = record.get("timeline_id")
        if not isinstance(tid, str) or not tid.strip():
            findings.append(
                Finding(
                    CODE_DAG_MALFORMED,
                    detail="timeline entry without timeline_id",
                )
            )
            continue
        if tid in by_id:
            findings.append(
                Finding(CODE_DAG_DUPLICATE, detail=f"timeline_id={tid}")
            )
            continue
        by_id[tid] = record
    counts["timelines"] = len(by_id)

    roots = sorted(
        tid for tid, record in by_id.items() if record.get("kind") == "root"
    )
    if len(roots) != 1 or roots[0] != hist.DEFAULT_TIMELINE_ID:
        findings.append(
            Finding(
                CODE_DAG_ROOT,
                detail=(
                    "roots="
                    + (",".join(roots) if roots else "none")
                    + f" expected exactly one root at {hist.DEFAULT_TIMELINE_ID}"
                ),
            )
        )

    edges: dict[str, list[str]] = {}
    for tid in sorted(by_id):
        record = by_id[tid]
        kind = str(record.get("kind") or "")
        parents_value = record.get("parents")
        if parents_value is None:
            parents_value = []
        parents: list[str] = []
        if not isinstance(parents_value, list):
            findings.append(
                Finding(
                    CODE_DAG_MALFORMED,
                    detail=f"timeline_id={tid} parents must be a list",
                )
            )
        else:
            for parent in parents_value:
                if not isinstance(parent, str) or not parent.strip():
                    findings.append(
                        Finding(
                            CODE_DAG_MALFORMED,
                            detail=f"timeline_id={tid} invalid parent {parent!r}",
                        )
                    )
                    continue
                parents.append(parent)
                if parent not in by_id:
                    findings.append(
                        Finding(
                            CODE_DAG_PARENT_UNKNOWN,
                            detail=f"timeline_id={tid} parent={parent}",
                        )
                    )
        edges[tid] = parents
        if kind == "fork" and len(parents) != 1:
            findings.append(
                Finding(
                    CODE_FORK_TOPOLOGY,
                    detail=(
                        f"timeline_id={tid} fork requires exactly one "
                        f"parent, got {len(parents)}"
                    ),
                )
            )
        if kind == "confluence" and (
            len(parents) != 2 or len(set(parents)) != 2
        ):
            findings.append(
                Finding(
                    CODE_CONFLUENCE_PARENTS,
                    detail=(
                        f"timeline_id={tid} confluence requires exactly two "
                        f"distinct parents, got {','.join(parents) or 'none'}"
                    ),
                )
            )

    # Cycles: white/gray/black DFS. Reaching a node through two paths is
    # the normal confluence diamond; only a gray node on the current path
    # is a true cycle.
    color: dict[str, int] = {}
    reported_cycles: set[tuple[str, ...]] = set()

    def visit(node: str, trail: list[str]) -> None:
        mark = color.get(node, 0)
        if mark == 1:
            start = trail.index(node)
            cycle = tuple(trail[start:])
            if cycle not in reported_cycles:
                reported_cycles.add(cycle)
                findings.append(
                    Finding(
                        CODE_DAG_CYCLE,
                        detail="cycle=" + "->".join((*cycle, node)),
                    )
                )
            return
        if mark == 2:
            return
        color[node] = 1
        trail.append(node)
        for parent in edges.get(node, ()):
            if parent in by_id:
                visit(parent, trail)
        trail.pop()
        color[node] = 2

    for tid in sorted(by_id):
        if color.get(tid, 0) == 0:
            visit(tid, [])

    # Root reachability: walk child edges down from tl-main.
    children: dict[str, list[str]] = {tid: [] for tid in by_id}
    for tid, parents in edges.items():
        for parent in parents:
            if parent in children and tid not in children[parent]:
                children[parent].append(tid)
    reachable: set[str] = set()
    queue = (
        [hist.DEFAULT_TIMELINE_ID]
        if hist.DEFAULT_TIMELINE_ID in by_id
        else []
    )
    while queue:
        current = queue.pop()
        if current in reachable:
            continue
        reachable.add(current)
        queue.extend(children[current])
    for tid in sorted(set(by_id) - reachable):
        findings.append(
            Finding(
                CODE_DAG_DISCONNECTED,
                detail=(
                    f"timeline_id={tid} not reachable from "
                    f"{hist.DEFAULT_TIMELINE_ID}"
                ),
            )
        )

    active = state.get("active_timeline_id")
    if not isinstance(active, str) or not active.strip() or active not in by_id:
        findings.append(
            Finding(
                CODE_ACTIVE_TIMELINE_INVALID,
                detail=f"active_timeline_id={active!r}",
            )
        )

    confluences_value = state.get("confluences")
    if confluences_value is None:
        confluences_value = []
    if not isinstance(confluences_value, list):
        findings.append(
            Finding(CODE_DAG_MALFORMED, detail="confluences must be a list")
        )
        confluences_value = []
    else:
        for item in confluences_value:
            if isinstance(item, dict) and isinstance(
                item.get("confluence_id"), str
            ):
                counts["confluences"] += 1
    return findings, counts


def _count_jsonl_rows(path: Path) -> tuple[int, list[Finding]]:
    """Count advisory-store JSONL rows; corrupt lines are findings."""
    if not path.exists():
        return 0, []
    if not path.is_file() or path.is_symlink():
        return 0, [
            Finding(
                CODE_TEMPORAL_STORE_CORRUPT,
                detail=f"path={path.as_posix()} is not a regular file",
            )
        ]
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        return 0, [
            Finding(
                CODE_TEMPORAL_STORE_CORRUPT,
                detail=f"cannot read {path.name}: {exc}",
            )
        ]
    rows = 0
    findings: list[Finding] = []
    for lineno, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped:
            continue
        try:
            payload = json.loads(stripped)
        except json.JSONDecodeError as exc:
            findings.append(
                Finding(
                    CODE_TEMPORAL_STORE_CORRUPT,
                    detail=f"{path.name} line {lineno} is not JSON: {exc}",
                )
            )
            continue
        if isinstance(payload, dict):
            rows += 1
    return rows, findings


def _worldline_store_counts(
    worktree: Path,
) -> tuple[list[Finding], dict[str, int]]:
    """Zero-explicit counts of transfers/episodes/backlog rows."""
    findings: list[Finding] = []
    counts = {key: 0 for key in WORLDLINE_COUNT_KEYS}
    temporal_dir = worktree / "memory" / "temporal"
    for key, filename in _TEMPORAL_STORE_FILES:
        rows, store_findings = _count_jsonl_rows(temporal_dir / filename)
        counts[key] = rows
        findings.extend(store_findings)
    return findings, counts


def _all_lineage_records(
    repo: Path, worktree: Path
) -> list[tuple[str, str]]:
    """Commit (sha, body) pairs across every ref; empty repo -> [].

    ``_commit_log_records`` guards on ``--rev-parse --verify <rev>`` which
    cannot resolve the pseudo-rev ``--all``, so the worldline sweep needs
    its own unconditional fetch.
    """
    completed = _run_git_readonly(
        ["log", "--format=%H%x1e%B%x1d", "--all"],
        repo=repo,
        worktree=worktree,
    )
    if completed.returncode != 0:
        # No refs yet (fresh bare repo) is an empty graph, not a failure.
        return []
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


def _sweep_all_lineages(
    repo: Path,
    worktree: Path,
    *,
    campaign_id: str,
    expected_schema: str,
    skip_shas: frozenset[str],
) -> list[Finding]:
    """Validate every commit in the sidecar repo, all lineages.

    Turn commits living off the proved lineage (fork/confluence branches)
    get the same trailer completeness rules as the main lineage; confluence
    commits additionally get exactly-two-distinct-parents and recorded-in-
    timeline-state coverage. Commits already validated by the caller are
    skipped to avoid duplicate findings; the parentless-commit census still
    covers every commit, since more than one root object means rewritten
    or grafted history regardless of lineage.
    """
    findings: list[Finding] = []
    try:
        records = _all_lineage_records(repo, worktree)
    except hist.GitHistoryError as exc:
        return [Finding(kind=CODE_GIT_LOG_FAILED, detail=str(exc))]
    rootless_commits = 0
    for sha, body in records:
        try:
            trailers = hist.parse_trailers(body)
        except hist.GitHistoryUnavailableError as exc:
            return [Finding(kind=CODE_GIT_UNAVAILABLE, detail=str(exc))]
        except hist.GitHistoryError as exc:
            findings.append(
                Finding(kind="trailer_parse_failed", detail=str(exc), sha=sha)
            )
            trailers = {}
        try:
            parent_count = _commit_parent_count(repo, worktree, sha)
        except hist.GitHistoryUnavailableError as exc:
            return [Finding(kind=CODE_GIT_UNAVAILABLE, detail=str(exc))]
        if parent_count == 0:
            rootless_commits += 1
        if sha in skip_shas:
            continue
        commit_type = trailers.get("COC-Commit-Type", "")
        if commit_type == "turn":
            findings.extend(
                _validate_turn_trailers(
                    sha,
                    trailers,
                    campaign_id=campaign_id,
                    expected_schema=expected_schema,
                )
            )
        elif commit_type == "confluence":
            findings.extend(
                _validate_confluence_trailers(
                    sha, trailers, campaign_id=campaign_id
                )
            )
            if parent_count != 2:
                findings.append(
                    Finding(
                        CODE_CONFLUENCE_PARENTS,
                        detail=f"parent_count={parent_count}",
                        sha=sha,
                    )
                )
            else:
                parent_shas = _confluence_parent_shas(repo, worktree, sha)
                if parent_shas is not None and parent_shas[0] == parent_shas[1]:
                    findings.append(
                        Finding(
                            CODE_CONFLUENCE_PARENTS,
                            detail=f"duplicate_parent_sha={parent_shas[0]}",
                            sha=sha,
                        )
                    )
            if sha not in skip_shas:
                findings.append(
                    Finding(
                        CODE_CONFLUENCE_UNRECORDED,
                        detail=(
                            "confluence commit has no timeline-state record"
                        ),
                        sha=sha,
                    )
                )
        elif (
            commit_type not in _ALLOWED_COMMIT_TYPES
            and "COC-History-Reset" not in trailers
        ):
            findings.append(
                Finding(
                    kind="unexpected_commit_type",
                    detail=f"COC-Commit-Type={commit_type}",
                    sha=sha,
                )
            )
    if rootless_commits > 1:
        findings.append(
            Finding(
                CODE_DAG_ROOT,
                detail=f"rootless_commit_count={rootless_commits}",
            )
        )
    return findings


def _commit_canonical_ids(record: dict[str, Any]) -> set[str]:
    """Canonical ids recorded in one commit's JSONL stores.

    Reuses the projection extractor so identity rules stay single-sourced:
    receipt / roll / effect / transaction ids lifted from explicit
    structured payload keys only (synthetic commit-inclusive row ids can
    never collide across lineages by construction).
    """
    extracted = proj_events.extract_events(record)
    ids: set[str] = set()
    for row_kind, id_key in (
        ("receipts", "receipt_id"),
        ("rolls", "roll_id"),
        ("effects", "effect_id"),
        ("transactions", "transaction_id"),
    ):
        for row in extracted[row_kind]:
            value = row.get(id_key)
            if isinstance(value, str) and value:
                ids.add(value)
    return ids


def _episode_ids_from_record(record: dict[str, Any]) -> set[str]:
    """Episode ledger ids carried by one commit record.

    ``extract_events`` treats episode rows as generic events, so the
    semantic ``episode_id`` is lifted here from the tracked episodes.jsonl
    blob text with the same parse-or-skip discipline.
    """
    ids: set[str] = set()
    for entry in record.get("files") or []:
        if entry.get("path") != _EPISODE_STORE_RELPATH:
            continue
        for line in (entry.get("text") or "").split("\n"):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                row = json.loads(stripped)
            except ValueError:
                continue
            if isinstance(row, dict):
                value = row.get("episode_id")
                if isinstance(value, str) and value:
                    ids.add(value)
    return ids


def _reachable_ancestor(
    parents_by_sha: dict[str, tuple[str, ...]], start: str, target: str
) -> bool:
    """True when ``target`` is an ancestor-or-self of ``start``.

    Pure-Python walk over the parents edges of the deterministic all-ref
    scan — no wall clock, no ordering ambiguity.
    """
    stack = [start]
    seen: set[str] = set()
    while stack:
        sha = stack.pop()
        if sha == target:
            return True
        if sha in seen:
            continue
        seen.add(sha)
        stack.extend(parents_by_sha.get(sha, ()))
    return False


def _sweep_ambiguous_canonical_introductions(
    root: Path | str,
    campaign_id: str,
) -> list[dict[str, Any]]:
    """Canonical ids minted independently on sibling timeline lineages.

    Reads every ref through the projection scanner (deterministic topo
    order), then reduces each canonical id to its introducing commits:
    a commit introduces an id only when no parent tree already recorded
    it. Fork/confluence replays therefore resolve through ancestry and
    are never flagged; only two mutually unrelated introductions on
    distinct lineages make lineage binding rebuild-order-dependent and
    are reported. Read-only; scan failures leave the advisory silent
    (the projection dimension already reports them as hard findings).

    Returns one structured entry per ambiguous id — sorted by canonical
    id, each carrying its first introduction per involved lineage —
    uncapped; callers cap rendered examples at ``AMBIGUOUS_ID_EXAMPLES_MAX``.
    """
    try:
        records = proj_git.scan_campaign_history(root, campaign_id)
    except (proj_git.GitScanUnavailableError, proj_git.GitScanError):
        return []
    parents_by_sha = {
        record["sha"]: tuple(record.get("parents") or ())
        for record in records
    }
    # Ancestors precede descendants in scan order: one first pass records
    # every id each snapshot carries; the second derives introductions as
    # "present here, absent from every parent tree".
    ids_by_sha: dict[str, set[str]] = {}
    for record in records:
        ids_by_sha[record["sha"]] = _commit_canonical_ids(
            record
        ) | _episode_ids_from_record(record)
    introduced: dict[str, dict[str, dict[str, Any]]] = {}
    for record in records:
        sha = record["sha"]
        inherited: set[str] = set()
        for parent in parents_by_sha[sha]:
            inherited |= ids_by_sha.get(parent, set())
        lineage = record.get("timeline_id") or hist.DEFAULT_TIMELINE_ID
        turn_number = record.get("turn_number")
        for canonical_id in sorted(ids_by_sha[sha] - inherited):
            lineages = introduced.setdefault(canonical_id, {})
            if lineage not in lineages:
                lineages[lineage] = {
                    "timeline_id": lineage,
                    "turn_number": turn_number,
                    "commit": sha,
                }
    advisories: list[dict[str, Any]] = []
    for canonical_id in sorted(introduced):
        lineages = introduced[canonical_id]
        if len(lineages) < 2:
            continue
        names = sorted(lineages)
        ambiguous_pair: tuple[str, str] | None = None
        for index, left in enumerate(names):
            for right in names[index + 1 :]:
                left_sha = lineages[left]["commit"]
                right_sha = lineages[right]["commit"]
                if not _reachable_ancestor(
                    parents_by_sha, left_sha, right_sha
                ) and not _reachable_ancestor(parents_by_sha, right_sha, left_sha):
                    ambiguous_pair = (left, right)
                    break
            if ambiguous_pair is not None:
                break
        if ambiguous_pair is None:
            continue
        advisories.append(
            {
                "canonical_id": canonical_id,
                "introductions": [
                    lineages[ambiguous_pair[0]],
                    lineages[ambiguous_pair[1]],
                ],
            }
        )
    return advisories


def _open_projection_readonly(db_path: Path) -> sqlite3.Connection:
    uri = f"file:{db_path.as_posix()}?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def _verify_projection_identity(
    root: Path | str,
    campaign_id: str,
) -> list[Finding]:
    """Compare the cached history projection against a shadow rebuild.

    Reads the cache strictly read-only (``mode=ro``), then deterministically
    rebuilds the projection in a system temp directory from a fresh Git
    scan and compares the facade's ``projection_runs`` row: generation
    markers, head commit, commit count, and the full deterministic digest.
    A missing database is an explicit "rebuild needed" finding; a corrupt
    or stale one is drift. Never writes anything under ``root``.
    """
    db_path = proj_schema.projection_path(root, campaign_id)
    label = db_path.as_posix()
    if not db_path.exists():
        return [
            Finding(
                kind=CODE_PROJECTION_REBUILD_NEEDED,
                detail=f"projection database missing, rebuild needed: {label}",
            )
        ]
    try:
        records = proj_git.scan_campaign_history(root, campaign_id)
    except proj_git.GitScanUnavailableError as exc:
        return [Finding(kind=CODE_GIT_UNAVAILABLE, detail=str(exc))]
    except proj_git.GitScanError as exc:
        return [Finding(kind=GIT_SCAN_FAILED, detail=str(exc))]
    expected_head = records[-1]["sha"] if records else None
    expected_count = len(records)

    # Shadow rebuild in a temp dir: same scanner + extractor pipeline the
    # facade publishes, minus publication. Nothing under root is touched.
    try:
        with tempfile.TemporaryDirectory(
            prefix="coc-projection-verify-"
        ) as scratch:
            scratch_db = Path(scratch) / "expected.db"
            connection = proj_schema.create_projection_db(scratch_db)
            try:
                proj_facade._build_projection(connection, records, campaign_id)
                expected_digest = proj_schema.projection_digest(connection)
            finally:
                connection.close()
    except (
        proj_schema.HistoryProjectionError,
        ValueError,
        OSError,
        sqlite3.Error,
    ) as exc:
        return [
            Finding(
                kind=CODE_PROJECTION_UNREADABLE,
                detail=f"deterministic shadow rebuild failed: {exc}",
            )
        ]

    findings: list[Finding] = []
    try:
        stored_conn = _open_projection_readonly(db_path)
    except sqlite3.Error as exc:
        return [
            Finding(
                kind=CODE_PROJECTION_UNREADABLE,
                detail=f"cannot open projection database read-only: {label} ({exc})",
            )
        ]
    try:
        try:
            version_row = stored_conn.execute(
                "PRAGMA user_version"
            ).fetchone()
            user_version = int(version_row[0]) if version_row else None
        except sqlite3.Error as exc:
            raise sqlite3.DatabaseError(str(exc))
        if user_version != proj_schema.PROJECTION_USER_VERSION:
            findings.append(
                Finding(
                    kind=CODE_PROJECTION_DRIFT,
                    detail=(
                        "projection generation marker mismatch: "
                        f"user_version={user_version!r} expected "
                        f"{proj_schema.PROJECTION_USER_VERSION!r} "
                        f"({proj_schema.SCHEMA_GENERATION}); rebuild needed"
                    ),
                )
            )
        try:
            campaign_rows = stored_conn.execute(
                "SELECT campaign_id, schema_generation, head_commit_sha,"
                " commit_count FROM campaigns WHERE campaign_id = ?",
                (campaign_id,),
            ).fetchall()
            run_rows = stored_conn.execute(
                "SELECT run_id, schema_generation, head_commit_sha,"
                " commit_count, projection_digest FROM projection_runs"
            ).fetchall()
        except sqlite3.Error as exc:
            raise sqlite3.DatabaseError(str(exc))
        if len(campaign_rows) != 1:
            findings.append(
                Finding(
                    kind=CODE_PROJECTION_DRIFT,
                    detail=f"campaign_rows={len(campaign_rows)} expected 1",
                )
            )
        else:
            row = campaign_rows[0]
            if row["schema_generation"] != proj_schema.SCHEMA_GENERATION:
                findings.append(
                    Finding(
                        kind=CODE_PROJECTION_DRIFT,
                        detail=(
                            "campaigns.schema_generation="
                            f"{row['schema_generation']!r} expected "
                            f"{proj_schema.SCHEMA_GENERATION!r}; rebuild needed"
                        ),
                    )
                )
            if row["head_commit_sha"] != expected_head:
                findings.append(
                    Finding(
                        kind=CODE_PROJECTION_DRIFT,
                        detail=(
                            f"campaigns.head_commit_sha={row['head_commit_sha']!r} "
                            f"git_head={expected_head!r}"
                        ),
                    )
                )
        if expected_count == 0:
            # An empty Git history legitimately publishes no run row.
            if run_rows:
                findings.append(
                    Finding(
                        kind=CODE_PROJECTION_DRIFT,
                        detail=f"run_rows={len(run_rows)} expected 0 for empty history",
                    )
                )
            return findings
        if len(run_rows) != 1:
            findings.append(
                Finding(
                    kind=CODE_PROJECTION_DRIFT,
                    detail=(
                        f"projection_runs rows={len(run_rows)} expected 1; "
                        "rebuild needed"
                    ),
                )
            )
            return findings
        run_row = run_rows[0]
        if run_row["schema_generation"] != proj_schema.SCHEMA_GENERATION:
            findings.append(
                Finding(
                    kind=CODE_PROJECTION_DRIFT,
                    detail=(
                        "projection_runs.schema_generation="
                        f"{run_row['schema_generation']!r} expected "
                        f"{proj_schema.SCHEMA_GENERATION!r}; rebuild needed"
                    ),
                )
            )
        if run_row["head_commit_sha"] != expected_head:
            findings.append(
                Finding(
                    kind=CODE_PROJECTION_DRIFT,
                    detail=(
                        "projection_runs.head_commit_sha="
                        f"{run_row['head_commit_sha']!r} git_head={expected_head!r}"
                    ),
                )
            )
        if run_row["commit_count"] != expected_count:
            findings.append(
                Finding(
                    kind=CODE_PROJECTION_DRIFT,
                    detail=(
                        f"projection_runs.commit_count={run_row['commit_count']!r} "
                        f"git_commit_count={expected_count}"
                    ),
                )
            )
        if run_row["projection_digest"] != expected_digest:
            findings.append(
                Finding(
                    kind=CODE_PROJECTION_DRIFT,
                    detail=(
                        "projection_digest does not match the deterministic "
                        f"shadow rebuild (stored={run_row['projection_digest']} "
                        f"rebuild={expected_digest})"
                    ),
                )
            )
        return findings
    except sqlite3.Error as exc:
        return [
            Finding(
                kind=CODE_PROJECTION_UNREADABLE,
                detail=f"projection database is unreadable or corrupt: {label} ({exc})",
            )
        ]
    finally:
        stored_conn.close()


def _verify_timeline_dag(
    root: Path | str,
    campaign_id: str,
    repo: Path,
    worktree: Path,
    *,
    expected_schema: str | None = None,
    visited_shas: frozenset[str] | set[str] = frozenset(),
    validated_confluence_shas: frozenset[str] | set[str] = frozenset(),
) -> tuple[
    list[Finding],
    dict[str, int],
    list[dict[str, Any]],
]:
    """Worldline/temporal sweep: DAG structure, refs, stores, all lineages.

    Returns the accumulated findings, explicit record counts (zero is
    a real result, never omitted), plus advisory structured entries for
    canonical ids whose introducing timeline lineage is ambiguous.
    """
    findings: list[Finding] = []
    store_findings, store_counts = _worldline_store_counts(worktree)
    findings.extend(store_findings)
    canonical_advisories = _sweep_ambiguous_canonical_introductions(
        root, campaign_id
    )
    store_counts["ambiguous_canonical_ids"] = len(canonical_advisories)
    state_path = worktree / hist.TIMELINE_STATE_RELPATH
    if not state_path.is_file():
        # Implied default: a campaign without a persisted timeline-state is
        # the single tl-main world. Report it explicitly, never as zero.
        store_counts["timelines"] = 1
        git_refs = _list_timeline_git_refs(repo, worktree)
        for ref in sorted(git_refs):
            findings.append(
                Finding(
                    kind=CODE_ORPHAN_TIMELINE_REF,
                    detail=f"ref={ref} has no timeline-state",
                )
            )
        skip = frozenset(visited_shas) | frozenset(validated_confluence_shas)
        findings.extend(
            _sweep_all_lineages(
                repo,
                worktree,
                campaign_id=campaign_id,
                expected_schema=expected_schema or "",
                skip_shas=skip,
            )
        )
        return findings, store_counts, canonical_advisories
    raw_state, parse_findings = _load_raw_timeline_state(worktree)
    if raw_state is None:
        findings.extend(parse_findings)
        return findings, store_counts, canonical_advisories
    structure_findings, structure_counts = _verify_timeline_structure(raw_state)
    findings.extend(structure_findings)
    counts = dict(store_counts)
    counts.update(structure_counts)

    listed_refs = _list_timeline_git_refs(repo, worktree)
    expected_refs: set[str] = set()
    for record in raw_state.get("timelines") or []:
        tid = record.get("timeline_id")
        if not isinstance(tid, str) or tid == hist.DEFAULT_TIMELINE_ID:
            continue
        try:
            ref = hist.timeline_ref_name(tid)
        except (ValueError, hist.GitHistoryError) as exc:
            findings.append(Finding(kind=CODE_FORK_TOPOLOGY, detail=str(exc)))
            continue
        expected_refs.add(ref)
        sha = _read_rev_sha(repo, worktree, ref)
        if sha is None:
            findings.append(
                Finding(
                    kind=CODE_TIMELINE_REF_MISSING,
                    detail=f"timeline_id={tid}",
                )
            )
            continue
        if record.get("kind") == "fork":
            point = (record.get("fork_point") or {}).get("commit")
            if isinstance(point, str) and point and not _is_ancestor(
                repo, worktree, point, sha
            ):
                findings.append(
                    Finding(
                        kind=CODE_FORK_TOPOLOGY,
                        detail=(
                            f"timeline {tid} tip is not a descendant of fork_point"
                        ),
                        sha=sha,
                    )
                )
        if record.get("kind") == "confluence":
            # Merge commit is recorded on the confluence record; the timeline
            # tip may have later turns.
            pass
    for ref in sorted(listed_refs - expected_refs):
        findings.append(
            Finding(
                kind=CODE_ORPHAN_TIMELINE_REF,
                detail=f"ref={ref}",
            )
        )
    recorded_merge_shas: set[str] = set()
    for conf in raw_state.get("confluences") or []:
        merge = conf.get("merge_commit") if isinstance(conf, dict) else None
        if not isinstance(merge, str) or not merge:
            findings.append(
                Finding(
                    kind=CODE_CONFLUENCE_PARENTS,
                    detail="confluence record missing merge_commit",
                )
            )
            continue
        recorded_merge_shas.add(merge)
        count = _commit_parent_count(repo, worktree, merge)
        if count != 2:
            findings.append(
                Finding(
                    kind=CODE_CONFLUENCE_PARENTS,
                    detail=f"parent_count={count}",
                    sha=merge,
                )
            )
        else:
            parent_shas = _confluence_parent_shas(repo, worktree, merge)
            if parent_shas is not None and parent_shas[0] == parent_shas[1]:
                findings.append(
                    Finding(
                        kind=CODE_CONFLUENCE_PARENTS,
                        detail=f"duplicate_parent_sha={parent_shas[0]}",
                        sha=merge,
                    )
                )
        trailers, trailer_finding = _head_trailers(repo, worktree, rev=merge)
        if trailer_finding is not None:
            findings.append(trailer_finding)
        elif trailers is not None:
            findings.extend(
                _validate_confluence_trailers(
                    merge, trailers, campaign_id=campaign_id
                )
            )
            findings.extend(
                _check_confluence_manifest_binding(
                    repo,
                    worktree,
                    record=conf,
                    trailers=trailers,
                    merge=merge,
                )
            )
    skip_shas = (
        frozenset(visited_shas)
        | frozenset(validated_confluence_shas)
        | frozenset(recorded_merge_shas)
    )
    findings.extend(
        _sweep_all_lineages(
            repo,
            worktree,
            campaign_id=campaign_id,
            expected_schema=expected_schema or "",
            skip_shas=skip_shas,
        )
    )
    return findings, counts, canonical_advisories


def state_integrity_proof(
    root: Path | str,
    campaign_id: str,
    *,
    expected_finalization_id: str | None = None,
    valid_finalization_ids: Iterable[str] | None = None,
    timeline_ref: str | None = None,
) -> StateIntegrityProof:
    """Return a structured, fail-closed Git state proof. Read-only.

    ``expected_finalization_id`` binds HEAD to one receipt (exporter latest
    valid row). ``valid_finalization_ids`` replaces the pairing set when the
    caller has already filtered invalid receipts. ``timeline_ref`` selects a
    timeline (semantic id or git ref); with no explicit ref the proof signs
    the campaign's ACTIVE timeline tip resolved via the Git coordinator —
    the implied single-line default still resolves to HEAD/main.
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

    signed_timeline_id: str | None = None
    selected_ref = timeline_ref
    if timeline_ref is None:
        # Default signing target is the campaign's active timeline (semantic
        # resolution through the coordinator). ``tl-main`` maps back to
        # main/HEAD inside _resolve_proof_rev, so single-line campaigns keep
        # byte-identical outputs.
        signed_timeline_id = _default_signed_timeline(root, campaign_id)
        if signed_timeline_id is not None:
            try:
                active_ref_exists = _rev_exists(
                    repo, worktree, hist.timeline_ref_name(signed_timeline_id)
                )
            except (ValueError, hist.GitHistoryError):
                active_ref_exists = False
            if active_ref_exists:
                selected_ref = signed_timeline_id
            else:
                # A dangling or unreadable active pointer keeps legacy
                # HEAD/main signing so the full worldline sweep below still
                # reports ``active_timeline_invalid`` explicitly instead of
                # short-circuiting before the structural checks.
                signed_timeline_id = None
                infos.append(
                    "signed_ref=HEAD signed_timeline_id=fallback-"
                    "active-pointer-unresolvable"
                )
    proof_rev, rev_findings = _resolve_proof_rev(repo, worktree, selected_ref)
    if rev_findings:
        return _build_proof(
            campaign_id=campaign_id,
            status=STATUS_NOT_PROVEN,
            history_enabled=True,
            repo_present=True,
            repo_healthy=fsck_ok,
            git_available=True,
            fsck_ok=fsck_ok,
            repo_path=repo_s,
            worktree_path=worktree_s,
            receipt_count=len(receipt_ids),
            findings=[*rev_findings, *findings],
            signed_ref=proof_rev,
            signed_timeline_id=(
                signed_timeline_id if timeline_ref is None else None
            ),
        )

    try:
        records = _commit_log_records(repo, worktree, rev=proof_rev)
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
            signed_ref=proof_rev,
            signed_timeline_id=(
                signed_timeline_id if timeline_ref is None else None
            ),
        )

    commits_by_fid: dict[str, list[str]] = {}
    turn_commit_count = 0
    history_reset = False
    reset_reason: str | None = None
    validated_confluence_shas: set[str] = set()
    # Report which ref the proof signed vs. the active pointer explicitly:
    # this is the active-vs-main distinction carriers of multi-timeline
    # campaigns must be able to read from the evidence. When an explicit
    # caller ref drove selection, mark it; when the state fallback above
    # already emitted its line, do not append twice.
    if timeline_ref is None:
        if not any(item.startswith("signed_ref=") for item in infos):
            infos.append(
                f"signed_ref={proof_rev} "
                f"signed_timeline_id={signed_timeline_id or 'default'}"
            )
    else:
        infos.append(f"signed_ref={proof_rev} signed_timeline_id=explicit")
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
        elif commit_type == "confluence":
            validated_confluence_shas.add(sha)
            findings.extend(
                _validate_confluence_trailers(
                    sha, trailers, campaign_id=campaign_id
                )
            )
            parent_count = _commit_parent_count(repo, worktree, sha)
            if parent_count != 2:
                findings.append(
                    Finding(
                        kind=CODE_CONFLUENCE_PARENTS,
                        detail=f"parent_count={parent_count}",
                        sha=sha,
                    )
                )
            else:
                parent_shas = _confluence_parent_shas(repo, worktree, sha)
                if (
                    parent_shas is not None
                    and parent_shas[0] == parent_shas[1]
                ):
                    findings.append(
                        Finding(
                            kind=CODE_CONFLUENCE_PARENTS,
                            detail=f"duplicate_parent_sha={parent_shas[0]}",
                            sha=sha,
                        )
                    )
        elif commit_type not in _ALLOWED_COMMIT_TYPES and "COC-History-Reset" not in trailers:
            findings.append(
                Finding(
                    kind="unexpected_commit_type",
                    detail=f"COC-Commit-Type={commit_type}",
                    sha=sha,
                    finalization_id=fid or None,
                )
            )

    try:
        foreign_ids = _foreign_finalization_ids(repo, worktree, proof_rev)
    except hist.GitHistoryError:
        foreign_ids = set()
    if foreign_ids:
        receipt_ids = [item for item in receipt_ids if item not in foreign_ids]
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

    head_sha = _read_rev_sha(repo, worktree, proof_rev)
    head_trailers, head_trailer_finding = _head_trailers(
        repo, worktree, rev=proof_rev
    )
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
                signed_ref=proof_rev,
                signed_timeline_id=(
                    signed_timeline_id if timeline_ref is None else None
                ),
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
            rev=proof_rev,
        )
        findings.extend(tree_findings)

    worldline_findings, worldline_counts, canonical_advisories = (
        _verify_timeline_dag(
            root,
            campaign_id,
            repo,
            worktree,
            expected_schema=expected_schema,
            visited_shas={sha for sha, _body in records},
            validated_confluence_shas=validated_confluence_shas,
        )
    )
    findings.extend(worldline_findings)
    infos.append(
        "record_counts "
        + " ".join(
            f"{key}={worldline_counts.get(key, 0)}"
            for key in WORLDLINE_COUNT_KEYS
        )
    )
    for advisory in canonical_advisories[:AMBIGUOUS_ID_EXAMPLES_MAX]:
        introductions = " ".join(
            f"{intro['timeline_id']}@turn{intro['turn_number']}"
            for intro in advisory["introductions"]
        )
        infos.append(
            f"{CODE_AMBIGUOUS_CANONICAL_ID} "
            f"{advisory['canonical_id']}: introductions {introductions}"
        )
    # The projection is a rebuildable non-authoritative cache: its verdict
    # lives in a dedicated dimension and never downgrades the core
    # finalize/git proof (missing cache = advisory "rebuild needed" gap).
    projection_findings = _verify_projection_identity(root, campaign_id)
    projection_status = _projection_dimension_status(projection_findings)

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
        worldline_counts=worldline_counts,
        projection_status=projection_status,
        projection_findings=projection_findings,
        worldline_advisories=tuple(
            canonical_advisories[:AMBIGUOUS_ID_EXAMPLES_MAX]
        ),
        signed_ref=proof_rev,
        signed_timeline_id=(
            signed_timeline_id if timeline_ref is None else None
        ),
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
    infos = list(proof.infos)
    report_findings = list(cli_findings)
    core_pass_worldline_gap = False
    if proof.projection_status == STATUS_FAIL:
        # A present-but-wrong cache fails its dimension outright.
        report_findings.extend(proof.projection_findings)
        exit_code = max(exit_code, 1)
    elif proof.projection_status == STATUS_NOT_PROVEN and proof.status == STATUS_PASS:
        core_pass_worldline_gap = True
        if exit_code == 0:
            exit_code = 2
        infos.append(
            "worldline gap: history projection not built — run "
            "coc_history_projection.rebuild_history_projection (advisory)"
        )
    return VerifyReport(
        exit_code=exit_code,
        findings=report_findings,
        infos=infos,
        turn_commit_count=proof.turn_commit_count,
        receipt_count=proof.receipt_count,
        core_pass_worldline_gap=core_pass_worldline_gap,
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
            code = {STATUS_PASS: 0, STATUS_FAIL: 1, STATUS_NOT_PROVEN: 2}[
                proof.status
            ]
            # Sweep exit: zero only when EVERY dimension proves. A failed
            # projection dimension exits 1; a rebuild-needed gap holds 2.
            if proof.projection_status == STATUS_FAIL:
                code = max(code, 1)
            elif code == 0 and proof.projection_status == STATUS_NOT_PROVEN:
                code = 2
            return code
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
