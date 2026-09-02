#!/usr/bin/env python3
"""Host-side Pi-Coc debug experiment coordinator.

The public seam is ``DebugExperiment.dispatch``.  Slash-command adapters pass
closed ``run``/``status``/``cancel`` commands here; checkpoint identity,
processes, campaign copies, credentials, and evidence paths remain host-owned.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import traceback
from typing import Any


_PLUGIN_ROOT = Path(__file__).resolve().parents[2]
_SCRIPTS = _PLUGIN_ROOT / "scripts"
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

import coc_git_history  # noqa: E402


_LANE_ID = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
_CAMPAIGN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_PROFILE_IDS = frozenset({
    "production",
    "rules-all-single-draft",
    "rules-director-single-draft",
})
_RECORD_KINDS = frozenset({
    "final",
    "rules",
    "director",
    "working_set",
    "timing",
    "state_diff",
    "tools",
    "rpc",
    "provider_stream",
    "stderr",
})
_DEFAULT_RECORD = (
    "final", "rules", "director", "working_set", "timing", "state_diff",
)
_TERMINAL = frozenset({"completed", "partial", "cancelled", "failed"})
_POST_FINALIZATION_AUDIT_PATHS = frozenset({
    "logs/canonical-events-sequence.json",
    "logs/canonical-events.jsonl",
    "logs/delivery-receipts.jsonl",
    "logs/toolbox-calls.jsonl",
})
_POST_FINALIZATION_OVERLAY_PATHS = frozenset({
    "memory/temporal/backlog.jsonl",
    "memory/temporal/episode-evidence.jsonl",
    "memory/temporal/episodes.jsonl",
    "save/continuation/delivery-receipts.jsonl",
})
_POST_FINALIZATION_ALLOWED_PATHS = (
    _POST_FINALIZATION_AUDIT_PATHS | _POST_FINALIZATION_OVERLAY_PATHS
)
_MAX_POST_FINALIZATION_OVERLAY_BYTES = 64 * 1024 * 1024
_MAX_LANES = 20
_MAX_CONCURRENCY = 20


class DebugExperimentError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _strict_object(value: Any, *, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise DebugExperimentError("debug_request_invalid", f"{label} must be an object")
    return value


def _exact_keys(value: dict[str, Any], allowed: set[str], *, label: str) -> None:
    unknown = sorted(set(value) - allowed)
    if unknown:
        raise DebugExperimentError(
            "debug_request_invalid",
            f"{label} has unknown fields: {', '.join(unknown)}",
        )


def _nonempty_text(value: Any, *, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise DebugExperimentError("debug_request_invalid", f"{label} must be non-empty")
    if "\x00" in value:
        raise DebugExperimentError("debug_request_invalid", f"{label} contains NUL")
    return value.strip()


def _lane_id(value: Any) -> str:
    token = _nonempty_text(value, label="lane.id")
    if _LANE_ID.fullmatch(token) is None or len(token) > 64:
        raise DebugExperimentError(
            "debug_request_invalid",
            "lane.id must be a short semantic kebab-case id",
        )
    if re.fullmatch(r"[0-9a-f]{24,}", token):
        raise DebugExperimentError("debug_request_invalid", "lane.id is opaque")
    return token


_DIRECTOR_GRAPH_PATH = (
    _PLUGIN_ROOT / "references" / "director-graph.json"
)


def _normalize_doctrine_overrides(raw: Any, *, label: str) -> dict[str, Any]:
    """Validate a lane's per-value doctrine overrides against the real graph.

    An override may only change the value of a doctrine node that already
    exists. It cannot add a node, change a node kind, or introduce a value of
    a different shape — so a lane can differ from production by exactly one
    recorded number and nothing else.
    """
    if raw is None:
        return {}
    overrides = _strict_object(raw, label=label)
    if not overrides:
        raise DebugExperimentError(
            "debug_request_invalid", f"{label} must not be empty when present",
        )
    try:
        graph = json.loads(_DIRECTOR_GRAPH_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise DebugExperimentError(
            "debug_request_invalid", f"DirectorGraph is unreadable: {exc}",
        ) from exc
    nodes = {
        row["node_id"]: row
        for row in graph.get("nodes", [])
        if isinstance(row, dict) and row.get("plane") == "doctrine"
    }
    normalized: dict[str, Any] = {}
    for node_id, value in overrides.items():
        node = nodes.get(node_id)
        if node is None:
            raise DebugExperimentError(
                "debug_request_invalid",
                f"{label}: {node_id!r} is not a doctrine node in the DirectorGraph",
            )
        current = (node.get("properties") or {}).get("value")
        if current is None:
            raise DebugExperimentError(
                "debug_request_invalid",
                f"{label}: {node_id!r} carries no value to override",
            )
        if type(value) is not type(current) or (
            isinstance(current, list) and len(value) != len(current)
        ):
            raise DebugExperimentError(
                "debug_request_invalid",
                f"{label}: {node_id!r} expects a value shaped like {current!r}",
            )
        if value == current:
            raise DebugExperimentError(
                "debug_request_invalid",
                f"{label}: {node_id!r} override equals the production value",
            )
        normalized[node_id] = value
    return normalized


def _write_lane_director_graph(
    destination: Path, overrides: dict[str, Any]
) -> Path:
    """Write a lane-private DirectorGraph carrying the lane's overrides."""
    graph = json.loads(_DIRECTOR_GRAPH_PATH.read_text(encoding="utf-8"))
    for row in graph.get("nodes", []):
        if isinstance(row, dict) and row.get("node_id") in overrides:
            row["properties"]["value"] = overrides[row["node_id"]]
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    destination.write_text(
        json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return destination


def _normalize_run_spec(raw: Any) -> dict[str, Any]:
    spec = _strict_object(raw, label="run spec")
    _exact_keys(
        spec,
        {"player_input", "lanes", "record", "concurrency", "timeout_seconds"},
        label="run spec",
    )
    player_input = _nonempty_text(spec.get("player_input"), label="player_input")
    raw_lanes = spec.get("lanes")
    if not isinstance(raw_lanes, list) or not 1 <= len(raw_lanes) <= _MAX_LANES:
        raise DebugExperimentError(
            "debug_request_invalid",
            f"lanes must contain between 1 and {_MAX_LANES} cases",
        )
    lanes: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, item in enumerate(raw_lanes):
        lane = _strict_object(item, label=f"lanes[{index}]")
        _exact_keys(
            lane,
            {"id", "profile", "player_input", "doctrine_overrides"},
            label=f"lanes[{index}]",
        )
        semantic_id = _lane_id(lane.get("id"))
        if semantic_id in seen:
            raise DebugExperimentError("debug_request_invalid", "lane ids must be unique")
        seen.add(semantic_id)
        profile = lane.get("profile", "production")
        if profile not in _PROFILE_IDS:
            raise DebugExperimentError(
                "debug_request_invalid", f"unsupported lane profile: {profile!r}",
            )
        lane_input = (
            player_input
            if "player_input" not in lane
            else _nonempty_text(lane["player_input"], label=f"lanes[{index}].player_input")
        )
        overrides = _normalize_doctrine_overrides(
            lane.get("doctrine_overrides"), label=f"lanes[{index}].doctrine_overrides"
        )
        lanes.append({
            "id": semantic_id,
            "profile": profile,
            "player_input": lane_input,
            "doctrine_overrides": overrides,
        })

    timeout = spec.get("timeout_seconds", 180)
    if not isinstance(timeout, int) or isinstance(timeout, bool) or not 1 <= timeout <= 180:
        raise DebugExperimentError(
            "debug_request_invalid", "timeout_seconds must be an integer from 1 to 180",
        )
    concurrency = spec.get("concurrency", min(2, len(lanes)))
    if (
        not isinstance(concurrency, int)
        or isinstance(concurrency, bool)
        or not 1 <= concurrency <= _MAX_CONCURRENCY
        or concurrency > len(lanes)
    ):
        raise DebugExperimentError(
            "debug_request_invalid",
            "concurrency must be an integer from 1 to "
            f"min({_MAX_CONCURRENCY}, lane count)",
        )
    raw_record = spec.get("record", list(_DEFAULT_RECORD))
    if not isinstance(raw_record, list) or any(not isinstance(row, str) for row in raw_record):
        raise DebugExperimentError("debug_request_invalid", "record must be a string list")
    if any(row not in _RECORD_KINDS for row in raw_record) or len(set(raw_record)) != len(raw_record):
        raise DebugExperimentError("debug_request_invalid", "record contains invalid or duplicate kinds")
    record = ["final", *(row for row in raw_record if row != "final")]
    return {
        "player_input": player_input,
        "lanes": lanes,
        "record": record,
        "concurrency": concurrency,
        "timeout_seconds": timeout,
    }


def _validate_context(raw: Any, *, require_run: bool = False) -> dict[str, Any]:
    context = _strict_object(raw, label="debug context")
    if require_run:
        if context.get("role") != "play":
            raise DebugExperimentError("debug_not_play", "debug experiments require play role")
        if context.get("host_is_idle") is not True:
            raise DebugExperimentError(
                "debug_command_not_idle", "the current Pi-Coc host must be idle",
            )
        if context.get("provider") != "xai":
            raise DebugExperimentError(
                "debug_xai_required", "debug experiments require the official xAI provider",
            )
    campaign_id = context.get("campaign_id")
    if not isinstance(campaign_id, str) or _CAMPAIGN_ID.fullmatch(campaign_id) is None:
        raise DebugExperimentError("debug_request_invalid", "campaign_id is invalid")
    for field in ("workspace_root", "model", "thinking", "agent_home"):
        _nonempty_text(context.get(field), label=field)
    return dict(context)


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    payload = json.dumps(value, ensure_ascii=False, indent=2) + "\n"
    temp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    descriptor = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
    except BaseException:
        try:
            os.unlink(temp)
        except FileNotFoundError:
            pass
        raise


def _run_command(arguments: list[str], *, cwd: Path | None = None) -> str:
    completed = subprocess.run(
        arguments,
        cwd=cwd,
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        message = (completed.stderr or completed.stdout).strip()
        raise DebugExperimentError(
            "checkpoint_materialization_failed",
            message or f"command failed: {arguments[0]}",
        )
    return completed.stdout.rstrip("\r\n")


def _git(repo: Path, worktree: Path, *arguments: str) -> str:
    return _run_command([
        "git",
        "--git-dir", str(repo),
        "--work-tree", str(worktree),
        "-c", "core.hooksPath=/dev/null",
        *arguments,
    ])


def _copy_workspace_support(source_coc: Path, destination_coc: Path) -> None:
    destination_coc.mkdir(parents=True, mode=0o700)
    for source in sorted(source_coc.iterdir(), key=lambda path: path.name):
        if source.name in {"campaigns", "repos", "debug"}:
            continue
        if source.is_symlink():
            raise DebugExperimentError(
                "checkpoint_materialization_failed",
                f"workspace support path is a symlink: {source.name}",
            )
        destination = destination_coc / source.name
        if source.is_dir():
            for nested in source.rglob("*"):
                if nested.is_symlink():
                    raise DebugExperimentError(
                        "checkpoint_materialization_failed",
                        f"workspace support contains a symlink: {source.name}",
                    )
            shutil.copytree(source, destination)
        elif source.is_file():
            shutil.copy2(source, destination)


def _delivery_receipt_for_tip(
    campaign: Path,
    *,
    campaign_id: str,
    finalization_id: str,
    rendered_text_sha256: str,
) -> dict[str, Any]:
    path = campaign / "save" / "continuation" / "delivery-receipts.jsonl"
    if not path.is_file() or path.is_symlink():
        raise DebugExperimentError(
            "checkpoint_delivery_unconfirmed",
            "the finalized tip has no confirmed delivery receipt",
        )
    selected: dict[str, Any] | None = None
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            if (
                isinstance(row, dict)
                and row.get("campaign_id") == campaign_id
                and row.get("finalization_id") == finalization_id
            ):
                selected = row
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise DebugExperimentError(
            "checkpoint_delivery_unconfirmed",
            "the delivery receipt log is unreadable",
        ) from exc
    if (
        selected is None
        or selected.get("status") != "confirmed"
        or selected.get("rendered_text_sha256") != rendered_text_sha256
        or selected.get("ack_kind") not in {"displayed", "replayed"}
    ):
        raise DebugExperimentError(
            "checkpoint_delivery_unconfirmed",
            "the finalized tip delivery is not confirmed",
        )
    return selected


class GitCheckpointAdapter:
    """Read and materialize only the current tl-main finalized tip."""

    def seal_latest(self, context: dict[str, Any]) -> dict[str, Any]:
        workspace = Path(context["workspace_root"]).resolve()
        campaign_id = context["campaign_id"]
        source_coc = workspace / ".coc"
        if not source_coc.is_dir() or source_coc.is_symlink():
            raise DebugExperimentError("checkpoint_not_found", "workspace has no safe .coc root")
        try:
            repo = coc_git_history.repo_path_for(workspace, campaign_id)
            campaign = coc_git_history.worktree_path_for(workspace, campaign_id)
            timeline_id = coc_git_history.active_timeline_id(workspace, campaign_id)
        except (OSError, ValueError, coc_git_history.GitHistoryError) as exc:
            raise DebugExperimentError("checkpoint_not_found", str(exc)) from exc
        if timeline_id != coc_git_history.DEFAULT_TIMELINE_ID:
            raise DebugExperimentError(
                "checkpoint_timeline_unsupported",
                "MVP debug snapshots require the active tl-main timeline",
            )
        if (campaign / coc_git_history.PENDING_TURN_RELPATH).is_file():
            raise DebugExperimentError(
                "checkpoint_unsettled", "the campaign has a pending player turn",
            )
        if not repo.is_dir() or not campaign.is_dir():
            raise DebugExperimentError("checkpoint_not_found", "campaign Git is unavailable")
        status = _git(repo, campaign, "status", "--porcelain", "--untracked-files=no")
        dirty_paths = [
            line[3:].strip().strip('"')
            for line in status.splitlines()
            if len(line) >= 4
        ]
        unsafe_dirty = sorted(
            path for path in dirty_paths
            if path not in _POST_FINALIZATION_ALLOWED_PATHS
        )
        if unsafe_dirty:
            raise DebugExperimentError(
                "checkpoint_dirty",
                "the canonical campaign tree has non-audit tracked changes",
            )
        reference = coc_git_history.timeline_ref_name(timeline_id)
        commit = _git(repo, campaign, "rev-parse", "--verify", reference)
        message = _git(repo, campaign, "log", "-1", "--format=%B", commit)
        trailers = coc_git_history.parse_trailers(message)
        if (
            trailers.get("COC-Commit-Type") != "turn"
            or trailers.get("Campaign-Id") != campaign_id
            or trailers.get("Timeline-Id") != timeline_id
            or not str(trailers.get("Turn-Number") or "").isdigit()
            or not trailers.get("Finalization-Id")
        ):
            raise DebugExperimentError(
                "checkpoint_unsettled",
                "the active timeline tip is not one canonical finalized turn",
            )
        delivery_receipt = _delivery_receipt_for_tip(
            campaign,
            campaign_id=campaign_id,
            finalization_id=trailers["Finalization-Id"],
            rendered_text_sha256=str(trailers.get("Rendered-Text-SHA256") or ""),
        )
        overlays: list[dict[str, Any]] = []
        for relative in sorted(
            set(dirty_paths) & _POST_FINALIZATION_OVERLAY_PATHS
        ):
            source = campaign / relative
            if not source.is_file() or source.is_symlink():
                raise DebugExperimentError(
                    "checkpoint_tree_mismatch",
                    "post-finalization overlay is unavailable or unsafe",
                )
            payload = source.read_bytes()
            if len(payload) > _MAX_POST_FINALIZATION_OVERLAY_BYTES:
                raise DebugExperimentError(
                    "checkpoint_tree_mismatch",
                    "post-finalization overlay exceeds the debug snapshot limit",
                )
            overlays.append({
                "path": relative,
                "size_bytes": len(payload),
                "sha256": hashlib.sha256(payload).hexdigest(),
            })
        return {
            "campaign_id": campaign_id,
            "timeline_id": timeline_id,
            "turn": int(trailers["Turn-Number"]),
            "finalization_id": trailers["Finalization-Id"],
            "commit": commit,
            "source_workspace": str(workspace),
            "source_repo": str(repo),
            "source_campaign": str(campaign),
            "source_status": status,
            "post_finalization_audit_paths": sorted(dirty_paths),
            "post_finalization_overlays": overlays,
            "delivery_receipt": delivery_receipt,
        }

    def materialize(
        self,
        checkpoint: dict[str, Any],
        lane_workspace: Path | str,
    ) -> dict[str, Any]:
        destination = Path(lane_workspace)
        if destination.exists():
            raise DebugExperimentError(
                "checkpoint_materialization_failed", "lane workspace already exists",
            )
        source_workspace = Path(checkpoint["source_workspace"])
        source_repo = Path(checkpoint["source_repo"])
        source_campaign = Path(checkpoint["source_campaign"])
        campaign_id = checkpoint["campaign_id"]
        expected_commit = checkpoint["commit"]
        before_ref = _git(source_repo, source_campaign, "rev-parse", "refs/heads/main")
        before_status = _git(
            source_repo, source_campaign, "status", "--porcelain", "--untracked-files=no",
        )

        lane_coc = destination / ".coc"
        _copy_workspace_support(source_workspace / ".coc", lane_coc)
        lane_repo = lane_coc / "repos" / "campaigns" / f"{campaign_id}.git"
        lane_campaign = lane_coc / "campaigns" / campaign_id
        lane_repo.parent.mkdir(parents=True, mode=0o700)
        lane_campaign.parent.mkdir(parents=True, mode=0o700)
        _run_command([
            "git", "clone", "--mirror", "--no-local",
            str(source_repo), str(lane_repo),
        ])
        _run_command([
            "git", "--git-dir", str(lane_repo),
            "-c", "core.hooksPath=/dev/null",
            "worktree", "add", str(lane_campaign), "main",
        ])
        actual_commit = _git(lane_repo, lane_campaign, "rev-parse", "HEAD")
        if actual_commit != expected_commit:
            raise DebugExperimentError(
                "checkpoint_tree_mismatch", "lane checkpoint identity drifted",
            )
        materialized_overlay_paths: set[str] = set()
        for row in checkpoint.get("post_finalization_overlays") or []:
            if not isinstance(row, dict):
                raise DebugExperimentError(
                    "checkpoint_tree_mismatch",
                    "post-finalization overlay manifest is invalid",
                )
            relative = row.get("path")
            if relative not in _POST_FINALIZATION_OVERLAY_PATHS:
                raise DebugExperimentError(
                    "checkpoint_tree_mismatch",
                    "post-finalization overlay path is not allowed",
                )
            source = source_campaign / str(relative)
            if not source.is_file() or source.is_symlink():
                raise DebugExperimentError(
                    "checkpoint_tree_mismatch",
                    "post-finalization overlay source drifted",
                )
            payload = source.read_bytes()
            if (
                len(payload) != row.get("size_bytes")
                or hashlib.sha256(payload).hexdigest() != row.get("sha256")
            ):
                raise DebugExperimentError(
                    "checkpoint_tree_mismatch",
                    "post-finalization overlay content drifted",
                )
            target = lane_campaign / str(relative)
            if target.is_symlink():
                raise DebugExperimentError(
                    "checkpoint_tree_mismatch",
                    "post-finalization overlay target is unsafe",
                )
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            target.write_bytes(payload)
            materialized_overlay_paths.add(str(relative))
        delivery_path = (
            lane_campaign / "save" / "continuation" / "delivery-receipts.jsonl"
        )
        existing_delivery = (
            delivery_path.read_text(encoding="utf-8")
            if delivery_path.is_file() and not delivery_path.is_symlink()
            else ""
        )
        serialized_delivery = json.dumps(
            checkpoint["delivery_receipt"], ensure_ascii=False,
            separators=(",", ":"),
        )
        if (
            "save/continuation/delivery-receipts.jsonl"
            not in materialized_overlay_paths
            and serialized_delivery not in existing_delivery.splitlines()
        ):
            _append_jsonl(delivery_path, checkpoint["delivery_receipt"])
        if _git(source_repo, source_campaign, "rev-parse", "refs/heads/main") != before_ref:
            raise DebugExperimentError(
                "debug_production_write_forbidden", "source campaign ref changed",
            )
        if _git(
            source_repo, source_campaign, "status", "--porcelain", "--untracked-files=no",
        ) != before_status:
            raise DebugExperimentError(
                "debug_production_write_forbidden", "source campaign tree changed",
            )
        return {
            "workspace_root": str(destination.resolve()),
            "campaign_dir": str(lane_campaign.resolve()),
            "repo": str(lane_repo.resolve()),
            "commit": actual_commit,
        }


_SECRET_FIELD = re.compile(
    r"(?:authorization|api[_-]?key|token|password|secret|cookie)", re.IGNORECASE,
)
_AUTHORIZATION_TEXT = re.compile(
    r"(authorization\s*[:=]\s*(?:bearer\s+)?)([^\s,;]+)",
    re.IGNORECASE,
)
_SECRET_ASSIGNMENT_TEXT = re.compile(
    r"((?:api[_-]?key|token|password|secret|cookie)\s*[:=]\s*)([^\s,;]+)",
    re.IGNORECASE,
)


def _redact_free_text(value: str) -> str:
    redacted = _AUTHORIZATION_TEXT.sub(r"\1<REDACTED>", value)
    return _SECRET_ASSIGNMENT_TEXT.sub(r"\1<REDACTED>", redacted)


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): (
                "<REDACTED>" if _SECRET_FIELD.search(str(key)) else _redact(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return value


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(_redact(row), ensure_ascii=False) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def _append_jsonl(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    descriptor = os.open(
        path,
        os.O_WRONLY | os.O_CREAT | os.O_APPEND,
        0o600,
    )
    with os.fdopen(descriptor, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(_redact(row), ensure_ascii=False) + "\n")
        handle.flush()


class DebugRunCoordinator:
    """Inline coordinator; subprocess execution uses the same execute method."""

    def __init__(self, *, store: "FileRunStore", checkpoint: Any, lane: Any) -> None:
        self.store = store
        self.checkpoint = checkpoint
        self.lane = lane
        self._manifest_lock = threading.Lock()

    def _set_lane_status(
        self,
        run: dict[str, Any],
        lane_id: str,
        value: dict[str, Any],
    ) -> None:
        with self._manifest_lock:
            run["lane_statuses"] = [
                value if row.get("id") == lane_id else row
                for row in run.get("lane_statuses", [])
            ]
            self.store.save(run)

    def _cancelled(self, run: dict[str, Any]) -> bool:
        return (self.store.root / run["experiment_id"] / "CANCEL").is_file()

    def _record_lane(
        self,
        run: dict[str, Any],
        lane: dict[str, Any],
        result: dict[str, Any],
    ) -> dict[str, Any]:
        lane_root = (
            self.store.root / run["experiment_id"] / "lanes" / lane["id"]
        )
        lane_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        final = result.get("final")
        if not isinstance(final, dict):
            final = {
                "player_input": lane["player_input"],
                "rendered_text": None,
                "finalized": False,
                "exact_delivery": False,
            }
        _atomic_json(lane_root / "final.json", _redact(final))
        selected = set(run["spec"]["record"])
        events = [
            event for event in (result.get("events") or [])
            if isinstance(event, dict)
        ]
        filenames = {
            "rules": "rules.jsonl",
            "director": "director.jsonl",
            "working_set": "working-set.jsonl",
            "timing": "timing.jsonl",
            "tools": "tools.jsonl",
            "rpc": "rpc.jsonl",
            "provider_stream": "provider-stream.jsonl",
            "stderr": "stderr.jsonl",
        }
        for category, filename in filenames.items():
            if category not in selected:
                continue
            rows = [event for event in events if event.get("category") == category]
            if rows:
                _write_jsonl(lane_root / filename, rows)
        if "state_diff" in selected and isinstance(result.get("state_diff"), dict):
            _atomic_json(lane_root / "state-diff.json", _redact(result["state_diff"]))

        status = str(result.get("status") or "failed")
        summary: dict[str, Any] = {
            "id": lane["id"],
            "status": status,
            "resume_first": result.get("resume_first") is True,
            "duration_ms": result.get("duration_ms"),
            "finalized": final.get("finalized") is True,
            "exact_delivery": final.get("exact_delivery") is True,
        }
        error = result.get("error")
        if isinstance(error, dict):
            summary["error"] = _redact(error)
        if isinstance(result.get("abort_count"), int):
            summary["abort_count"] = result["abort_count"]
        if isinstance(result.get("abort_confirmed"), bool):
            summary["abort_confirmed"] = result["abort_confirmed"]
        return summary

    def _comparison_lane(
        self,
        run: dict[str, Any],
        summary: dict[str, Any],
    ) -> dict[str, Any]:
        lane_root = (
            self.store.root / run["experiment_id"] / "lanes" / summary["id"]
        )
        final: dict[str, Any] = {}
        final_path = lane_root / "final.json"
        if final_path.is_file():
            value = json.loads(final_path.read_text(encoding="utf-8"))
            if isinstance(value, dict):
                final = value
        operation_rows: list[dict[str, Any]] = []
        tool_path = lane_root / "tools.jsonl"
        candidate_paths = (
            [tool_path]
            if tool_path.is_file()
            else [lane_root / "rules.jsonl", lane_root / "director.jsonl"]
        )
        for path in candidate_paths:
            if not path.is_file():
                continue
            for line in path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                value = json.loads(line)
                if isinstance(value, dict) and isinstance(value.get("operation"), str):
                    operation_rows.append(value)
        operations: list[str] = []
        for row in operation_rows:
            if row.get("phase") not in {None, "start"}:
                continue
            operation = row["operation"]
            if operation not in operations:
                operations.append(operation)
        state_diff: dict[str, Any] | None = None
        state_path = lane_root / "state-diff.json"
        if state_path.is_file():
            value = json.loads(state_path.read_text(encoding="utf-8"))
            if isinstance(value, dict):
                state_diff = value
        return {
            **summary,
            "player_input": final.get("player_input"),
            "rendered_text": final.get("rendered_text"),
            "canonical_operations": operations,
            "state_diff": state_diff,
        }

    def _run_lane(
        self,
        run: dict[str, Any],
        lane: dict[str, Any],
    ) -> dict[str, Any]:
        if self._cancelled(run):
            return {
                "id": lane["id"],
                "status": "cancelled",
                "resume_first": False,
                "duration_ms": 0,
                "finalized": False,
                "exact_delivery": False,
            }
        sandbox = self.store.root / run["experiment_id"] / "sandboxes" / lane["id"]
        try:
            self._set_lane_status(run, lane["id"], {
                "id": lane["id"], "status": "materializing",
            })
            materialized = self.checkpoint.materialize(run["checkpoint"], sandbox)
            self._set_lane_status(run, lane["id"], {
                "id": lane["id"], "status": "running",
            })
            result = self.lane.run(
                lane=lane,
                run=run,
                materialized=materialized,
                cancelled=lambda: self._cancelled(run),
            )
            if not isinstance(result, dict):
                raise DebugExperimentError(
                    "debug_lane_contract_drift", "lane returned no result object",
                )
            return self._record_lane(run, lane, result)
        except Exception as exc:
            result = {
                "status": "failed",
                "resume_first": False,
                "duration_ms": 0,
                "error": {
                    "code": getattr(exc, "code", "debug_lane_failed"),
                    "message": str(exc),
                },
                "events": [],
                "final": {
                    "player_input": lane["player_input"],
                    "rendered_text": None,
                    "finalized": False,
                    "exact_delivery": False,
                },
            }
            return self._record_lane(run, lane, result)

    def start(self, run: dict[str, Any]) -> None:
        lanes = run["spec"]["lanes"]
        by_id: dict[str, dict[str, Any]] = {}
        with ThreadPoolExecutor(max_workers=run["spec"]["concurrency"]) as pool:
            futures = {
                pool.submit(self._run_lane, run, lane): lane["id"]
                for lane in lanes
            }
            for future in as_completed(futures):
                lane_id = futures[future]
                by_id[lane_id] = future.result()
                self._set_lane_status(run, lane_id, by_id[lane_id])
        summaries = [by_id[lane["id"]] for lane in lanes]
        completed = sum(row["status"] == "completed" for row in summaries)
        if completed == len(summaries):
            run["status"] = "completed"
        elif completed:
            run["status"] = "partial"
        elif self._cancelled(run):
            run["status"] = "cancelled"
        else:
            run["status"] = "failed"
        run["lane_statuses"] = summaries
        self.store.save(run)
        comparison_lanes = [
            self._comparison_lane(run, summary) for summary in summaries
        ]
        _atomic_json(
            self.store.root / run["experiment_id"] / "comparison.json",
            {
                "schema_version": 1,
                "contract_id": "coc.pi-debug-comparison.v1",
                "experiment_id": run["experiment_id"],
                "status": run["status"],
                "lanes": comparison_lanes,
            },
        )

    def cancel(self, run: dict[str, Any]) -> None:
        target = self.store.root / run["experiment_id"] / "CANCEL"
        if not target.exists():
            descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.close(descriptor)


def _semantic_operation(tool_name: Any) -> str:
    name = str(tool_name or "")
    if not name.startswith("coc_"):
        return name
    body = name[4:]
    domain, separator, operation = body.partition("_")
    return f"{domain}.{operation}" if separator else body


def _assistant_text(message: Any) -> str:
    if not isinstance(message, dict) or message.get("role") != "assistant":
        return ""
    content = message.get("content")
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    return "".join(
        str(part.get("text") or "")
        for part in content
        if isinstance(part, dict) and part.get("type") == "text"
    )


def _tool_result_details(event: dict[str, Any]) -> dict[str, Any]:
    result = event.get("result")
    if isinstance(result, dict):
        details = result.get("details")
        if isinstance(details, dict):
            return details
        content = result.get("content")
        if isinstance(content, list):
            for part in content:
                if not isinstance(part, dict) or not isinstance(part.get("text"), str):
                    continue
                try:
                    parsed = json.loads(part["text"])
                except json.JSONDecodeError:
                    continue
                if isinstance(parsed, dict):
                    return parsed
    return {}


def _tool_result_success(event: dict[str, Any]) -> bool:
    if event.get("isError") is True:
        return False
    details = _tool_result_details(event)
    return details.get("ok") is not False


def _rendered_text_from_tool(event: dict[str, Any]) -> str:
    details = _tool_result_details(event)
    data = details.get("data")
    if isinstance(data, dict) and isinstance(data.get("rendered_text"), str):
        return data["rendered_text"]
    if isinstance(details.get("rendered_text"), str):
        return details["rendered_text"]
    return ""


class PiRpcLaneAdapter:
    """One real Pi RPC process, one resume, one player send, one deadline."""

    def __init__(
        self,
        *,
        repo_root: Path | str,
        private_root: Path | str,
        command_builder: Any | None = None,
        extra_env: dict[str, str] | None = None,
    ) -> None:
        self.repo_root = Path(repo_root).resolve()
        self.private_root = Path(private_root)
        self.command_builder = command_builder
        self.extra_env = dict(extra_env or {})

    def _command(
        self,
        lane: dict[str, Any],
        run: dict[str, Any],
        materialized: dict[str, Any],
    ) -> list[str]:
        if self.command_builder is not None:
            value = self.command_builder(lane, run, materialized)
            if not isinstance(value, list) or not value or any(
                not isinstance(part, str) or not part for part in value
            ):
                raise DebugExperimentError(
                    "rpc_spawn_failed", "debug command builder returned invalid argv",
                )
            return value
        launcher = self.repo_root / "plugins" / "coc-keeper" / "pi" / "bin" / "pi-coc"
        model = str(run["context"]["model"])
        model_ref = model if "/" in model else f"xai/{model}"
        return [
            str(launcher),
            "--mode", "rpc",
            "--campaign", str(run["context"]["campaign_id"]),
            "--model", model_ref,
            "--thinking", str(run["context"]["thinking"]),
            "--no-session",
        ]

    def _private_home(self, run: dict[str, Any], lane: dict[str, Any]) -> Path:
        source = Path(run["context"]["agent_home"])
        if not source.is_dir() or source.is_symlink():
            raise DebugExperimentError("rpc_spawn_failed", "source Pi home is unavailable")
        for entry in source.rglob("*"):
            if not entry.is_symlink():
                continue
            try:
                resolved = entry.resolve(strict=True)
            except OSError as exc:
                raise DebugExperimentError(
                    "rpc_spawn_failed", "source Pi home contains a broken symlink",
                ) from exc
            if not resolved.is_file():
                raise DebugExperimentError(
                    "rpc_spawn_failed",
                    "source Pi home contains a directory symlink",
                )
        target = self.private_root / run["experiment_id"] / lane["id"] / "pi-home"
        if target.exists():
            raise DebugExperimentError("rpc_spawn_failed", "private Pi home already exists")
        target.parent.mkdir(parents=True, mode=0o700)

        def ignored(_directory: str, names: list[str]) -> set[str]:
            return {name for name in names if name == "sessions"}

        shutil.copytree(source, target, ignore=ignored, symlinks=False)
        os.chmod(target, 0o700)
        auth = target / "auth.json"
        if auth.exists():
            os.chmod(auth, 0o600)
        return target

    @staticmethod
    def _safe_env() -> dict[str, str]:
        allowed = {
            "HOME", "PATH", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TERM",
            "USER", "LOGNAME", "SHELL", "NODE_PATH", "SSL_CERT_FILE",
            "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "UV_CACHE_DIR",
        }
        return {key: value for key, value in os.environ.items() if key in allowed}

    @staticmethod
    def _terminate(process: subprocess.Popen[str]) -> None:
        if process.poll() is not None:
            return
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        try:
            process.wait(timeout=1.0)
            return
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            return
        try:
            process.wait(timeout=1.0)
        except subprocess.TimeoutExpired:
            pass

    def run(
        self,
        *,
        lane: dict[str, Any],
        run: dict[str, Any],
        materialized: dict[str, Any],
        cancelled: Any,
    ) -> dict[str, Any]:
        started = time.monotonic()
        deadline = started + float(run["spec"]["timeout_seconds"])
        private_home = self._private_home(run, lane)
        environment = self._safe_env()
        environment.update({
            "COC_WORKSPACE": str(materialized["workspace_root"]),
            "PI_COC_AGENT_DIR": str(private_home),
            "PI_COC_SESSION_ID": (
                f"{run['experiment_id']}-{lane['id']}"
            ),
            **self.extra_env,
        })
        if lane.get("profile") != "production":
            environment["COC_PI_ACCEPTANCE_PROFILE"] = str(lane["profile"])
        overrides = lane.get("doctrine_overrides") or {}
        if overrides:
            environment["COC_DIRECTOR_GRAPH"] = str(_write_lane_director_graph(
                Path(materialized["workspace_root"]) / ".coc" / "director-graph.json",
                overrides,
            ))
        command = self._command(lane, run, materialized)
        process: subprocess.Popen[str] | None = None
        stderr_thread: threading.Thread | None = None
        event_queue: queue.Queue[tuple[str, Any]] = queue.Queue()
        stderr_parts: list[str] = []
        events: list[dict[str, Any]] = []
        abort_count = 0
        abort_confirmed = False
        abort_id = f"abort-{lane['id']}"
        visible_text = ""
        rendered_text = ""
        finalized = False
        resume_first = False
        resume_success = False
        provider_verified = False
        provider_identity_error: str | None = None
        first_operation: str | None = None
        current_phase = "launching"
        last_event_type = ""
        evidence_value = run.get("evidence_root")
        live_root = (
            Path(evidence_value) / "lanes" / lane["id"]
            if isinstance(evidence_value, str) and evidence_value
            else None
        )

        def progress(stage: str) -> None:
            if live_root is None:
                return
            _atomic_json(live_root / "progress.json", {
                "schema_version": 1,
                "lane_id": lane["id"],
                "stage": stage,
                "last_event_type": last_event_type,
                "elapsed_ms": round((time.monotonic() - started) * 1000),
            })

        def read_stdout() -> None:
            assert process is not None and process.stdout is not None
            try:
                for line in process.stdout:
                    try:
                        event_queue.put(("event", json.loads(line)))
                    except json.JSONDecodeError:
                        event_queue.put(("error", "rpc_protocol_corrupt"))
            finally:
                event_queue.put(("eof", None))

        def read_stderr() -> None:
            assert process is not None and process.stderr is not None
            for chunk in iter(lambda: process.stderr.read(4096), ""):
                if not chunk:
                    break
                if sum(len(part) for part in stderr_parts) < 65536:
                    stderr_parts.append(chunk)

        def send(value: dict[str, Any]) -> None:
            assert process is not None and process.stdin is not None
            process.stdin.write(json.dumps(value, ensure_ascii=False) + "\n")
            process.stdin.flush()

        def observe(event: dict[str, Any]) -> None:
            nonlocal first_operation, resume_success, visible_text
            nonlocal rendered_text, finalized, last_event_type, abort_confirmed
            nonlocal provider_verified, provider_identity_error
            event_type = event.get("type")
            last_event_type = str(event_type or "")
            if live_root is not None and "rpc" in run["spec"]["record"]:
                _append_jsonl(live_root / "live-rpc.jsonl", event)
            if (
                event_type == "response"
                and event.get("id") == abort_id
                and event.get("command") == "abort"
                and event.get("success") is True
            ):
                abort_confirmed = True
            if event_type != "message_update":
                progress(current_phase)
            tool_name = event.get("toolName") or event.get("tool")
            if event_type == "message_start":
                message = event.get("message")
                if isinstance(message, dict) and message.get("role") == "assistant":
                    provider = message.get("provider")
                    model = message.get("model")
                    if isinstance(provider, str) and isinstance(model, str):
                        if (
                            provider == "xai"
                            and model == str(run["context"]["model"])
                        ):
                            provider_verified = True
                        else:
                            provider_identity_error = "xai_provider_mismatch"
            if event_type in {"tool_execution_start", "tool_execution_end"}:
                operation = _semantic_operation(tool_name)
                if (
                    event_type == "tool_execution_start"
                    and first_operation is None
                    and "." in operation
                ):
                    first_operation = operation
                tool_row = {
                    "category": "tools",
                    "phase": "start" if event_type.endswith("start") else "end",
                    "operation": operation,
                    "event": _redact(event),
                }
                events.append(tool_row)
                if operation.startswith("rules."):
                    events.append({**tool_row, "category": "rules"})
                if operation.split(".", 1)[0] in {
                    "scene", "actions", "director", "storylets",
                }:
                    events.append({**tool_row, "category": "director"})
                if event_type == "tool_execution_end" and operation == "session.resume":
                    resume_success = _tool_result_success(event)
                if event_type == "tool_execution_end" and operation == "turn.finalize":
                    finalized = _tool_result_success(event)
                    if finalized:
                        rendered_text = _rendered_text_from_tool(event)
            elif event_type == "message_end":
                text = _assistant_text(event.get("message"))
                if text:
                    visible_text = text
            elif event_type == "entry_appended":
                entry = event.get("entry")
                custom = entry.get("customType") if isinstance(entry, dict) else None
                category = (
                    "working_set" if custom == "coc-tool-working-set"
                    else "timing" if custom == "coc-turn-timing"
                    else "rpc"
                )
                events.append({"category": category, "event": _redact(event)})
            else:
                events.append({"category": "rpc", "event": _redact(event)})
                if event_type in {"message_start", "message_update"}:
                    events.append({"category": "provider_stream", "event": _redact(event)})

        def wait_terminal(*, phase: str) -> tuple[bool, str | None]:
            nonlocal abort_count, current_phase
            current_phase = phase
            progress(phase)
            while True:
                if cancelled():
                    if abort_count == 0:
                        send({"type": "abort", "id": abort_id})
                        abort_count = 1
                    return False, "cancelled"
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    if abort_count == 0:
                        send({"type": "abort", "id": abort_id})
                        abort_count = 1
                    drain_until = time.monotonic() + 1.5
                    settled_seen = False
                    while time.monotonic() < drain_until:
                        try:
                            kind, payload = event_queue.get(timeout=0.1)
                        except queue.Empty:
                            continue
                        if kind == "event" and isinstance(payload, dict):
                            observe(payload)
                            if payload.get("type") == "agent_settled":
                                settled_seen = True
                            if settled_seen and abort_confirmed:
                                break
                    return False, "timeout"
                try:
                    kind, payload = event_queue.get(timeout=min(0.1, remaining))
                except queue.Empty:
                    if process is not None and process.poll() is not None:
                        return False, "process_exit"
                    continue
                if kind == "error":
                    return False, str(payload)
                if kind == "eof":
                    return False, "process_exit"
                if not isinstance(payload, dict):
                    continue
                observe(payload)
                if provider_identity_error is not None:
                    return False, provider_identity_error
                if phase == "resume" and first_operation not in {None, "session.resume"}:
                    return False, "resume_order_violation"
                if payload.get("type") == "agent_settled":
                    return True, None

        try:
            progress("launching")
            process = subprocess.Popen(
                command,
                cwd=self.repo_root,
                env=environment,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                start_new_session=True,
            )
            threading.Thread(target=read_stdout, daemon=True).start()
            stderr_thread = threading.Thread(target=read_stderr, daemon=True)
            stderr_thread.start()
            send({
                "type": "prompt",
                "id": f"resume-{lane['id']}",
                "message": (
                    "Host debug resume. session.resume must be the first canonical "
                    "campaign operation. Stop at awaiting_player and do not act for the player."
                ),
            })
            settled, failure = wait_terminal(phase="resume")
            resume_first = first_operation == "session.resume"
            if not settled or not resume_first or not resume_success or not provider_verified:
                if failure == "timeout":
                    status = "timed_out"
                    code = "lane_absolute_budget_exceeded"
                elif failure == "cancelled":
                    status = "cancelled"
                    code = "debug_cancelled"
                else:
                    status = "failed"
                    code = failure or (
                        "xai_provider_unverified"
                        if not provider_verified else "resume_failed"
                    )
                return {
                    "status": status,
                    "resume_first": resume_first,
                    "duration_ms": round((time.monotonic() - started) * 1000),
                    "abort_count": abort_count,
                    "abort_confirmed": abort_confirmed,
                    "error": {"code": code},
                    "events": events,
                    "final": {
                        "player_input": lane["player_input"],
                        "rendered_text": None,
                        "finalized": False,
                        "exact_delivery": False,
                    },
                }
            first_operation = None
            send({
                "type": "prompt",
                "id": f"turn-{lane['id']}",
                "message": lane["player_input"],
            })
            settled, failure = wait_terminal(phase="turn")
            if failure == "timeout":
                status = "timed_out"
                code = "turn_absolute_budget_exceeded"
            elif failure == "cancelled":
                status = "cancelled"
                code = "debug_cancelled"
            elif not settled:
                status = "failed"
                code = failure or "player_turn_undelivered"
            else:
                exact = bool(visible_text and rendered_text == visible_text)
                status = "completed" if finalized and exact else "failed"
                code = None if status == "completed" else "player_turn_undelivered"
            state_diff: dict[str, Any] = {}
            repo_value = materialized.get("repo")
            if isinstance(repo_value, str) and repo_value:
                repo = Path(repo_value)
                worktree = Path(materialized["workspace_root"]) / ".coc" / "campaigns" / run["context"]["campaign_id"]
                try:
                    current = _git(repo, worktree, "rev-parse", "refs/heads/main")
                    paths = _git(
                        repo, worktree, "diff", "--name-only",
                        run["checkpoint"]["commit"], current,
                    ).splitlines()
                    state_diff = {"changed_paths": paths}
                except DebugExperimentError:
                    state_diff = {"status": "unavailable"}
            result = {
                "status": status,
                "resume_first": resume_first,
                "duration_ms": round((time.monotonic() - started) * 1000),
                "abort_count": abort_count,
                "abort_confirmed": abort_confirmed,
                "events": events,
                "state_diff": state_diff,
                "final": {
                    "player_input": lane["player_input"],
                    "rendered_text": visible_text or None,
                    "finalized": finalized,
                    "exact_delivery": bool(visible_text and rendered_text == visible_text),
                },
            }
            if code is not None:
                result["error"] = {"code": code}
            return result
        except (OSError, ValueError) as exc:
            return {
                "status": "failed",
                "resume_first": False,
                "duration_ms": round((time.monotonic() - started) * 1000),
                "abort_count": abort_count,
                "abort_confirmed": abort_confirmed,
                "error": {"code": "rpc_spawn_failed", "message": str(exc)},
                "events": events,
                "final": {
                    "player_input": lane["player_input"],
                    "rendered_text": None,
                    "finalized": False,
                    "exact_delivery": False,
                },
            }
        finally:
            if process is not None:
                try:
                    if process.stdin is not None:
                        process.stdin.close()
                except OSError:
                    pass
                self._terminate(process)
            if stderr_thread is not None:
                stderr_thread.join(timeout=1.0)
            stderr_text = _redact_free_text("".join(stderr_parts).strip())
            if stderr_text:
                events.append({"category": "stderr", "text": stderr_text})
            try:
                shutil.rmtree(private_home)
            except OSError:
                pass
            current_phase = "terminal"
            progress("terminal")


class FileRunStore:
    def __init__(self, root: Path | str) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)

    def allocate(self, campaign_id: str) -> str:
        stem = re.sub(r"[^A-Za-z0-9-]", "-", campaign_id).strip("-").lower()
        for ordinal in range(1, 10000):
            experiment_id = f"debug-{stem}-r{ordinal}"
            if not (self.root / experiment_id).exists():
                return experiment_id
        raise DebugExperimentError("debug_request_invalid", "debug run ordinal exhausted")

    def create(self, run: dict[str, Any]) -> None:
        target = self.root / run["experiment_id"]
        try:
            target.mkdir(mode=0o700)
        except FileExistsError as exc:
            raise DebugExperimentError("debug_request_invalid", "debug run already exists") from exc
        _atomic_json(target / "run.json", run)
        _atomic_json(self.root / f"current-{run['context']['campaign_id']}.json", {
            "experiment_id": run["experiment_id"],
        })

    def save(self, run: dict[str, Any]) -> None:
        _atomic_json(self.root / run["experiment_id"] / "run.json", run)

    def load(self, reference: str, campaign_id: str) -> dict[str, Any]:
        experiment_id = reference
        if reference == "current":
            pointer = self.root / f"current-{campaign_id}.json"
            if not pointer.is_file():
                raise DebugExperimentError("debug_run_not_found", "no current debug run")
            experiment_id = json.loads(pointer.read_text(encoding="utf-8"))[
                "experiment_id"
            ]
        path = self.root / experiment_id / "run.json"
        if not path.is_file():
            raise DebugExperimentError("debug_run_not_found", "debug run not found")
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict) or value.get("experiment_id") != experiment_id:
            raise DebugExperimentError("debug_run_corrupt", "debug run manifest is corrupt")
        return value

    def load_exact(self, experiment_id: str) -> dict[str, Any]:
        path = self.root / experiment_id / "run.json"
        if not path.is_file():
            raise DebugExperimentError("debug_run_not_found", "debug run not found")
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict) or value.get("experiment_id") != experiment_id:
            raise DebugExperimentError("debug_run_corrupt", "debug run manifest is corrupt")
        return value


def _public_run(run: dict[str, Any]) -> dict[str, Any]:
    checkpoint = run["checkpoint"]
    return {
        "status": run["status"],
        "experiment_id": run["experiment_id"],
        "checkpoint": {
            "campaign_id": checkpoint["campaign_id"],
            "timeline_id": checkpoint["timeline_id"],
            "turn": checkpoint["turn"],
        },
        "lanes": [row["id"] for row in run["spec"]["lanes"]],
        "spec": run["spec"],
        "lane_statuses": run.get("lane_statuses", []),
    }


def _coordinator_alive(run: dict[str, Any]) -> bool:
    pid = run.get("coordinator_pid")
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except (ProcessLookupError, PermissionError):
        return False
    completed = subprocess.run(
        ["ps", "-p", str(pid), "-o", "command="],
        check=False,
        capture_output=True,
        text=True,
    )
    command = completed.stdout.strip()
    return (
        completed.returncode == 0
        and "pi_coc_debug_experiment.py execute" in command
        and f"--experiment-id {run.get('experiment_id')}" in command
    )


def _mark_coordinator_failure(run: dict[str, Any], message: str) -> None:
    run["status"] = "failed"
    run["error"] = {
        "code": "coordinator_exited_unsettled",
        "message": message,
    }
    run["lane_statuses"] = [
        row if row.get("status") in {
            "completed", "failed", "timed_out", "cancelled",
        } else {
            "id": row.get("id"),
            "status": "failed",
            "error": {"code": "coordinator_exited_unsettled"},
        }
        for row in run.get("lane_statuses", [])
    ]


class DebugExperiment:
    """One deep host-control interface over debug run lifecycle."""

    def __init__(self, *, store: FileRunStore, checkpoint: Any, executor: Any) -> None:
        self.store = store
        self.checkpoint = checkpoint
        self.executor = executor

    def dispatch(self, command: str, raw_context: dict[str, Any]) -> dict[str, Any]:
        action, separator, payload = command.strip().partition(" ")
        context = _validate_context(raw_context, require_run=action == "run")
        if action == "run":
            if not separator:
                raise DebugExperimentError("debug_request_invalid", "run requires one JSON spec")
            try:
                raw_spec = json.loads(payload)
            except json.JSONDecodeError as exc:
                raise DebugExperimentError("debug_request_invalid", "run spec is invalid JSON") from exc
            spec = _normalize_run_spec(raw_spec)
            checkpoint = self.checkpoint.seal_latest(context)
            experiment_id = self.store.allocate(context["campaign_id"])
            run = {
                "schema_version": 1,
                "contract_id": "coc.pi-debug-experiment.v1",
                "experiment_id": experiment_id,
                "evidence_root": str(self.store.root / experiment_id),
                "status": "running",
                "context": context,
                "checkpoint": checkpoint,
                "spec": spec,
                "lane_statuses": [
                    {"id": lane["id"], "status": "queued"}
                    for lane in spec["lanes"]
                ],
            }
            self.store.create(run)
            try:
                self.executor.start(run)
            except Exception as exc:
                run["status"] = "failed"
                run["error"] = {"code": "debug_spawn_failed", "message": str(exc)}
                self.store.save(run)
                raise DebugExperimentError("debug_spawn_failed", "debug executor failed") from exc
            public = _public_run(run)
            return {
                "status": "started",
                "experiment_id": public["experiment_id"],
                "checkpoint": public["checkpoint"],
                "lanes": public["lanes"],
            }

        if action not in {"status", "cancel", "report"} or not separator:
            raise DebugExperimentError(
                "debug_request_invalid",
                "expected run <json>, status <id>, cancel <id>, or report <id>",
            )
        reference = payload.strip()
        if reference != "current" and _LANE_ID.fullmatch(reference) is None:
            raise DebugExperimentError("debug_request_invalid", "debug run reference is invalid")
        run = self.store.load(reference, context["campaign_id"])
        coordinator_died = (
            run.get("status") in {"running", "cancelling"}
            and isinstance(run.get("coordinator_pid"), int)
            and not _coordinator_alive(run)
        )
        stale_failed_lanes = (
            run.get("status") == "failed"
            and any(
                row.get("status") not in {
                    "completed", "failed", "timed_out", "cancelled",
                }
                for row in run.get("lane_statuses", [])
            )
        )
        if coordinator_died or stale_failed_lanes:
            _mark_coordinator_failure(
                run,
                "the debug coordinator exited before sealing the run",
            )
            self.store.save(run)
        if action == "status":
            return _public_run(run)
        if action == "report":
            if run.get("status") not in _TERMINAL:
                raise DebugExperimentError(
                    "debug_run_not_terminal", "debug report requires a terminal run",
                )
            report_path = self.store.root / run["experiment_id"] / "comparison.json"
            if not report_path.is_file():
                raise DebugExperimentError(
                    "debug_report_unavailable", "debug comparison report is unavailable",
                )
            report = json.loads(report_path.read_text(encoding="utf-8"))
            if (
                not isinstance(report, dict)
                or report.get("experiment_id") != run["experiment_id"]
            ):
                raise DebugExperimentError(
                    "debug_report_integrity_mismatch", "debug comparison report drifted",
                )
            lane_summary = ", ".join(
                f"{row.get('id')}={row.get('status')}"
                for row in report.get("lanes", [])
                if isinstance(row, dict)
            )
            return {
                "status": run["status"],
                "experiment_id": run["experiment_id"],
                "message": (
                    f"Debug {run['experiment_id']} {run['status']}: {lane_summary}"
                ),
                "report": report,
            }
        if run["status"] in _TERMINAL:
            return _public_run(run)
        run["status"] = "cancelling"
        self.store.save(run)
        self.executor.cancel(run)
        return _public_run(run)


class SubprocessDebugExecutor:
    """Detach one coordinator so `/system debug run` returns immediately."""

    def __init__(self, *, store: FileRunStore, repo_root: Path | str) -> None:
        self.store = store
        self.repo_root = Path(repo_root).resolve()

    def start(self, run: dict[str, Any]) -> None:
        run_root = self.store.root / run["experiment_id"]
        log_path = run_root / "coordinator.log"
        descriptor = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        log_handle = os.fdopen(descriptor, "a", encoding="utf-8")
        try:
            process = subprocess.Popen(
                [
                    sys.executable,
                    str(Path(__file__).resolve()),
                    "execute",
                    "--store-root", str(self.store.root),
                    "--experiment-id", run["experiment_id"],
                    "--repo-root", str(self.repo_root),
                ],
                cwd=self.repo_root,
                env={
                    **PiRpcLaneAdapter._safe_env(),
                    "PYTHONDONTWRITEBYTECODE": "1",
                },
                stdin=subprocess.DEVNULL,
                stdout=log_handle,
                stderr=log_handle,
                start_new_session=True,
                text=True,
            )
        finally:
            log_handle.close()
        run["coordinator_pid"] = process.pid
        self.store.save(run)

    def cancel(self, run: dict[str, Any]) -> None:
        target = self.store.root / run["experiment_id"] / "CANCEL"
        if target.exists():
            return
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(descriptor)


def _default_store(context: dict[str, Any]) -> FileRunStore:
    workspace = Path(context["workspace_root"]).resolve()
    coc_root = workspace / ".coc"
    debug_root = coc_root / "debug"
    runs_root = debug_root / "runs"
    if coc_root.is_symlink() or debug_root.is_symlink() or runs_root.is_symlink():
        raise DebugExperimentError(
            "evidence_root_unsafe", "debug evidence root must not be a symlink",
        )
    try:
        runs_root.resolve(strict=False).relative_to(coc_root.resolve(strict=False))
    except ValueError as exc:
        raise DebugExperimentError(
            "evidence_root_unsafe", "debug evidence root escapes .coc",
        ) from exc
    return FileRunStore(runs_root)


def _dispatch_cli(command: str, context_json: str, repo_root: Path) -> dict[str, Any]:
    try:
        context = json.loads(context_json)
    except json.JSONDecodeError as exc:
        raise DebugExperimentError(
            "debug_request_invalid", "debug context is invalid JSON",
        ) from exc
    validated = _validate_context(context)
    store = _default_store(validated)
    experiment = DebugExperiment(
        store=store,
        checkpoint=GitCheckpointAdapter(),
        executor=SubprocessDebugExecutor(store=store, repo_root=repo_root),
    )
    return experiment.dispatch(command, validated)


def _execute_cli(store_root: Path, experiment_id: str, repo_root: Path) -> None:
    store = FileRunStore(store_root)
    run = store.load_exact(experiment_id)
    coordinator = DebugRunCoordinator(
        store=store,
        checkpoint=GitCheckpointAdapter(),
        lane=PiRpcLaneAdapter(
            repo_root=repo_root,
            private_root=store.root / experiment_id / "private",
        ),
    )
    coordinator.start(run)


def _argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Pi-Coc debug experiment host")
    subparsers = parser.add_subparsers(dest="action", required=True)
    dispatch = subparsers.add_parser("dispatch")
    dispatch.add_argument("--command", required=True)
    dispatch.add_argument("--context-json", required=True)
    dispatch.add_argument("--repo-root", default=str(_PLUGIN_ROOT.parents[1]))
    execute = subparsers.add_parser("execute")
    execute.add_argument("--store-root", required=True)
    execute.add_argument("--experiment-id", required=True)
    execute.add_argument("--repo-root", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _argument_parser().parse_args(argv)
    try:
        if args.action == "dispatch":
            receipt = _dispatch_cli(
                args.command,
                args.context_json,
                Path(args.repo_root).resolve(),
            )
            print(json.dumps({"ok": True, "receipt": receipt}, ensure_ascii=False))
            return 0
        _execute_cli(
            Path(args.store_root).resolve(),
            args.experiment_id,
            Path(args.repo_root).resolve(),
        )
        return 0
    except DebugExperimentError as exc:
        print(json.dumps({
            "ok": False,
            "error": {"code": exc.code, "message": str(exc)},
        }, ensure_ascii=False))
        return 2
    except Exception as exc:
        if args.action == "execute":
            try:
                store = FileRunStore(Path(args.store_root).resolve())
                run = store.load_exact(args.experiment_id)
                _mark_coordinator_failure(run, str(exc))
                store.save(run)
            except Exception:
                pass
            traceback.print_exc(file=sys.stderr)
        print(json.dumps({
            "ok": False,
            "error": {
                "code": "debug_host_failed",
                "message": "debug host failed; inspect private coordinator evidence",
            },
        }, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
