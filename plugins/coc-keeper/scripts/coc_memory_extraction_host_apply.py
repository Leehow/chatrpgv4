#!/usr/bin/env python3
"""Private host apply bridge for finalize-after asynchronous memory extraction.

The Pi host's background memory-extraction dispatcher (a derived, advisory
worker — never a second KP) talks to this script as a subprocess, never as a
canonical operation: no registry entry, no ACL surface, no operation policy,
and nothing model-visible. All work is deterministic:

- ``prepare``   — rebuild the extraction job from the durable backlog row and
  the immutable stored episode, and return the semantic packet plus the exact
  bounded read payload (the digest-verified finalized ``rendered_text`` from
  ``logs/turn-finalizations.jsonl``). Skips (without mutating anything) when
  the backlog row is not pending or no verified read payload exists.
- ``apply``     — route the producer's candidate assertions through
  ``coc_memory_extraction.apply_extraction_result``: closed validation,
  machine provenance reattachment, one immutable per-job artifact, and the
  pending backlog row recovered. NEVER materializes assertions into the
  shared store — promotion to world truth stays with KP adjudication through
  ``memory.extraction_settle`` / ``memory.adjudicate``.
- ``record_failure`` — record an explicit recoverable pending backlog row
  (``extraction_error``) with a bounded detail on the machine-side audit
  sidecar. Never ``abandoned``; abandonment is a KP semantic decision.

Hard state (``state.*`` / ``rules.*``), transcripts, finalization receipts,
and Git history are never written. The whole command runs under the campaign
exclusive lock so the short apply serializes with the next player turn.

Transport: one JSON request on stdin, one JSON receipt on stdout, exit 0 for
every handled request (including semantic ``skipped`` / ``backlog_pending``
receipts). Exit code 2 with a ``rejected`` receipt is reserved for
transport-level failures (bad request shape, unknown campaign, lock timeout).
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from collections import deque
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_fileio
import coc_memory_extraction
import coc_temporal_memory as temporal
import coc_temporal_memory_contract as contract

SCHEMA_VERSION = 1
COMMANDS = ("prepare", "apply", "record_failure")
MAX_REQUEST_BYTES = 2 * 1024 * 1024
# The exact finalized prose is a private read card, not an unbounded prompt.
MAX_MODEL_READ_BYTES = 64 * 1024
LOCK_WAIT_SECONDS = 20.0
MAX_FINALIZATION_TAIL_ROWS = 512

_CAMPAIGN_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


def _canonical_text_digest(text: str) -> str:
    """The canonical digest form used for finalized rendered text."""
    encoded = json.dumps(
        text, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


class Rejected(Exception):
    """Transport-level rejection: nothing was run, nothing was mutated."""

    def __init__(self, error_code: str, detail: str) -> None:
        super().__init__(detail)
        self.error_code = error_code
        self.detail = detail


def _emit(receipt: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(receipt, ensure_ascii=False, sort_keys=True) + "\n")


def _read_request() -> dict[str, Any]:
    try:
        raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    except OSError as exc:
        raise Rejected("request_unreadable", f"stdin read failed: {exc}") from exc
    if len(raw) > MAX_REQUEST_BYTES:
        raise Rejected("request_too_large", f"request exceeds {MAX_REQUEST_BYTES} bytes")
    try:
        request = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise Rejected("request_invalid_json", f"request is not valid JSON: {exc}") from exc
    if not isinstance(request, dict):
        raise Rejected("request_not_object", "request must be a JSON object")
    return request


def _require_field(request: dict[str, Any], name: str) -> Any:
    value = request.get(name)
    if value is None or (isinstance(value, str) and not value.strip()):
        raise Rejected("field_missing", f"request field {name!r} is required")
    return value


def _campaign_dir(request: dict[str, Any]) -> Path:
    workspace_root = Path(str(_require_field(request, "workspace_root")))
    if not workspace_root.is_absolute():
        raise Rejected("workspace_root_not_absolute", "workspace_root must be absolute")
    campaign_id = str(_require_field(request, "campaign_id"))
    if not _CAMPAIGN_ID_PATTERN.match(campaign_id):
        raise Rejected("campaign_id_invalid", "campaign_id is not a canonical campaign id")
    campaign_dir = workspace_root / ".coc" / "campaigns" / campaign_id
    if not campaign_dir.is_dir():
        raise Rejected("campaign_missing", f"campaign directory {campaign_id!r} does not exist")
    return campaign_dir


def _backlog_row(campaign_dir: Path, backlog_id: str) -> dict[str, Any] | None:
    """Latest durable backlog row; read-only, never bootstraps a store."""
    rows = temporal.load_backlog(campaign_dir)
    row = rows.get(backlog_id)
    return row if isinstance(row, dict) else None


def _rebuild_job(campaign_dir: Path, row: dict[str, Any]) -> dict[str, Any]:
    """Deterministically rebuild the job from the row plus the stored episode.

    The binding comes from the append-only backlog row plus the immutable
    stored episode — never from caller input — so the rebuilt job is
    byte-identical to the one the finalize hook derived from Git.
    """
    campaign_id = str(row.get("campaign_id") or "")
    timeline_id = str(row.get("timeline_id") or "")
    turn_number = row.get("turn_number")
    if (
        not campaign_id
        or not timeline_id
        or not isinstance(turn_number, int)
        or isinstance(turn_number, bool)
    ):
        raise Rejected("backlog_row_invalid", "backlog row binding is incomplete")
    episode_id = contract.episode_id_for(campaign_id, timeline_id, turn_number)
    stored = temporal.load_episodes(campaign_dir).get(episode_id)
    if stored is None:
        raise Rejected(
            "episode_missing",
            f"backlog entry has no recorded episode {episode_id!r}",
        )
    episode_core = {key: value for key, value in stored.items() if key != "evidence"}
    commit_record = {
        "sha": str(row.get("commit") or ""),
        "campaign_id": campaign_id,
        "timeline_id": timeline_id,
        "turn_number": turn_number,
        "commit_type": "turn",
    }
    try:
        return coc_memory_extraction.build_extraction_job(
            campaign_dir,
            commit_record,
            str(stored.get("finalization_receipt") or ""),
            episode_core,
        )
    except (
        coc_memory_extraction.MemoryExtractionError,
        contract.TemporalMemoryContractError,
        ValueError,
    ) as exc:
        raise Rejected(
            "job_rebuild_failed",
            f"the extraction job cannot be rebuilt from its recorded binding: {exc}",
        ) from exc


def _verified_rendered_text(
    campaign_dir: Path, finalization_id: str
) -> str | None:
    """Return verified text while keeping its digest host-owned.

    The finalization row's ``rendered_text_sha256`` is checked here, but is
    never returned in the model-visible task. Any drift means the payload is
    not trusted for extraction; the caller skips and the backlog row stays
    pending.
    """
    path = campaign_dir / "logs" / "turn-finalizations.jsonl"
    if not path.is_file():
        return None
    try:
        with path.open("r", encoding="utf-8") as handle:
            tail = deque(handle, maxlen=MAX_FINALIZATION_TAIL_ROWS)
    except OSError:
        return None
    for raw in reversed(tail):
        raw = raw.strip()
        if not raw:
            continue
        try:
            row = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if not isinstance(row, dict) or row.get("finalization_id") != finalization_id:
            continue
        text = row.get("rendered_text")
        sha = row.get("rendered_text_sha256")
        if not isinstance(text, str) or not text or not isinstance(sha, str):
            continue
        if _canonical_text_digest(text) != sha:
            continue
        if len(text.encode("utf-8")) > MAX_MODEL_READ_BYTES:
            # Keep the durable backlog pending for a later KP disposition;
            # never turn an unusually large transcript row into a private
            # model-context escape hatch.
            return None
        return text
    return None


def _command_prepare(
    campaign_dir: Path, request: dict[str, Any]
) -> dict[str, Any]:
    backlog_id = str(_require_field(request, "backlog_id"))
    row = _backlog_row(campaign_dir, backlog_id)
    if row is None:
        return {"status": "skipped", "reason": "backlog_unknown", "backlog_id": backlog_id}
    if row.get("campaign_id") != campaign_dir.name:
        return {"status": "skipped", "reason": "backlog_unknown", "backlog_id": backlog_id}
    status = str(row.get("status") or "")
    if status != "pending":
        return {
            "status": "skipped",
            "reason": "backlog_not_pending",
            "backlog_id": backlog_id,
            "backlog_status": status,
        }
    job = _rebuild_job(campaign_dir, row)
    provenance = job.get("provenance") or {}
    rendered_text = _verified_rendered_text(
        campaign_dir, str(provenance.get("finalization_receipt") or "")
    )
    if rendered_text is None:
        return {
            "status": "skipped",
            "reason": "read_payload_unavailable",
            "backlog_id": backlog_id,
            "job_id": job["job_id"],
        }
    # The host has verified the digest above. Do not hand machine integrity
    # evidence to the model — it receives only the exact text it may reason
    # about; apply rebuilds and verifies provenance from durable records.
    return {
        "status": "ready",
        "backlog_id": backlog_id,
        "job_id": job["job_id"],
        "packet": job["packet"],
        "read": {"rendered_text": rendered_text},
    }


def _command_apply(campaign_dir: Path, request: dict[str, Any]) -> dict[str, Any]:
    backlog_id = str(_require_field(request, "backlog_id"))
    result = _require_field(request, "result")
    if not isinstance(result, dict):
        raise Rejected("result_not_object", "result must be a JSON object")
    job_id = str(result.get("job_id") or "")
    if not job_id:
        raise Rejected("result_job_id_missing", "result.job_id is required")

    # Converged replay: an immutable completed artifact already exists, so the
    # producer result is never re-run, and nothing can duplicate or diverge.
    existing = coc_memory_extraction.load_completed_job(campaign_dir, job_id)
    if existing is not None:
        row = _backlog_row(campaign_dir, backlog_id)
        return {
            "status": "already_applied",
            "job_id": job_id,
            "backlog_id": backlog_id,
            "backlog_status": str((row or {}).get("status") or "none"),
            "artifact_digest": existing.get("artifact_digest"),
            "applied": len(existing.get("candidates") or []),
        }

    row = _backlog_row(campaign_dir, backlog_id)
    if row is None:
        return {"status": "skipped", "reason": "backlog_unknown", "backlog_id": backlog_id}
    job = _rebuild_job(campaign_dir, row)
    receipt = coc_memory_extraction.apply_extraction_result(
        campaign_dir,
        job,
        {"job_id": job_id, "candidates": result.get("candidates")},
    )
    # Never materialize here: the completed artifact is advisory evidence the
    # KP later settles through memory.extraction_settle / memory.adjudicate.
    return {
        "status": (
            "applied" if receipt.get("status") == "applied" else "backlog_pending"
        ),
        **receipt,
    }


def _command_record_failure(
    campaign_dir: Path, request: dict[str, Any]
) -> dict[str, Any]:
    backlog_id = str(_require_field(request, "backlog_id"))
    error_kind = str(_require_field(request, "error_kind"))
    detail = str(request.get("detail") or "")
    if error_kind not in coc_memory_extraction.EXTRACTION_ERROR_KINDS:
        raise Rejected(
            "error_kind_unknown",
            f"error_kind {error_kind!r} is not in the closed failure taxonomy",
        )
    row = _backlog_row(campaign_dir, backlog_id)
    if row is None:
        return {"status": "skipped", "reason": "backlog_unknown", "backlog_id": backlog_id}
    job = _rebuild_job(campaign_dir, row)
    recorded = coc_memory_extraction.record_extraction_failure(
        campaign_dir, job, error_kind, detail
    )
    return {
        "status": "failure_recorded",
        "backlog_id": recorded["backlog_id"],
        "backlog_status": str(recorded.get("status") or "pending"),
        "job_id": job["job_id"],
        "error_kind": error_kind,
    }


def _run_command(request: dict[str, Any]) -> dict[str, Any]:
    if request.get("schema_version") != SCHEMA_VERSION:
        raise Rejected("schema_version_unsupported", "schema_version must be 1")
    command = request.get("command")
    if command not in COMMANDS:
        raise Rejected("command_unknown", f"command must be one of {list(COMMANDS)}")
    campaign_dir = _campaign_dir(request)
    try:
        with coc_fileio.campaign_lock(
            campaign_dir, wait_seconds=LOCK_WAIT_SECONDS
        ):
            if command == "prepare":
                return _command_prepare(campaign_dir, request)
            if command == "apply":
                return _command_apply(campaign_dir, request)
            return _command_record_failure(campaign_dir, request)
    except coc_fileio.CampaignLockError as exc:
        raise Rejected("campaign_lock_timeout", str(exc)) from exc


def main() -> int:
    try:
        request = _read_request()
    except Rejected as exc:
        _emit({
            "status": "rejected",
            "error_code": exc.error_code,
            "detail": exc.detail[: coc_memory_extraction.MAX_DETAIL_CHARS],
        })
        return 2
    try:
        _emit(_run_command(request))
    except Rejected as exc:
        _emit({
            "status": "rejected",
            "error_code": exc.error_code,
            "detail": exc.detail[: coc_memory_extraction.MAX_DETAIL_CHARS],
        })
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
