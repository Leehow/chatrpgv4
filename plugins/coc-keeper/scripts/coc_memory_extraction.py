#!/usr/bin/env python3
"""Deterministic extraction-job core for the Git-backed temporal memory.

Repository code never semantically interprets prose and never calls an LLM.
The semantic producer (a KP-side model workflow, integrated by a later plan
task) receives the model-facing packet — semantic refs only — and returns
semantic candidate assertions. This module owns the deterministic boundary
around that producer:

- ``build_extraction_job(campaign_dir, commit_record, finalization_receipt,
  episode)`` — one finalized turn commit → one deterministic semantic
  extraction job id (``extract-<campaign>-<timeline>-turn-<n>``). Pure over
  its inputs; touches no store.
- ``validate_extraction_result(job, result)`` — closed result validation.
  Unknown fields, machine-provenance fields, cross-record supersession
  edges, off-job bindings and id-grammar violations are errors.
  ``source_commit`` / ``source_turn`` / ``source_receipts`` are
  machine-internal integrity evidence: this module reattaches them from the
  job; a producer response that carries them is rejected (anti-drift).
- ``apply_extraction_result(campaign_dir, job, result)`` — persists the
  entire validated candidate batch as **one immutable per-job result
  artifact** (``memory/temporal/extraction-jobs/<job_id>.json``) written
  whole through temp-file + atomic create. The batch is all-or-nothing
  by construction: a failing candidate, a write failure, or a divergent
  replay leaves no visible completed job and never touches the shared
  append-only stores, so another writer's evidence can never be lost.
  Same-job exact replay is idempotent (byte-identical artifact, receipt
  re-issued); a divergent replay fails closed as provenance drift.
  Candidates remain non-authoritative pending KP adjudication and are
  not published into the shared assertion store by extraction — the
  adjudication/materialization bridge is a later integration task.
  Every successful validated extraction — including a legitimate
  zero-candidate result — produces a completed job record and recovers a
  matching pending backlog row. Extraction failure never raises into
  ``turn.finalize``: every extraction-domain failure is converted into an
  explicit backlog row with status ``pending`` plus a failure receipt
  (``status="backlog_pending"``).
- ``record_extraction_failure(campaign_dir, job, error_kind, detail)`` —
  explicit, recoverable backlog recording with a closed error-kind enum.

Persistence writes only under ``memory/temporal/`` (assertions and backlog
rows through the temporal facade, plus this module's machine-side
``extraction-events.jsonl`` audit sidecar). Hard state (``state.*`` /
``rules.*``) is never touched; memory stays advisory.

Schema generation ``temporal-memory-1`` (inherited from the frozen
contract): no migrations, no dual readers.
"""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any, Mapping

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_temporal_memory_contract as contract
import coc_temporal_memory as temporal

SCHEMA_GENERATION = contract.SCHEMA_GENERATION
AUTHORITY = "advisory"
HARD_GATE = False

EXTRACTION_ID_PREFIX = "extract-"
BACKLOG_SLOT = "extract"
MAX_CANDIDATES = 32
MAX_DETAIL_CHARS = 500

#: Candidate kinds a semantic producer may return. ``summary`` is excluded:
#: summaries are auditable compression bound to ``covers_commits`` (opaque
#: commit shas) and are produced by a different, machine-bound path.
EXTRACTABLE_ASSERTION_KINDS: tuple[str, ...] = tuple(
    kind for kind in contract.ASSERTION_KINDS if kind != "summary"
)

#: Closed producer-failure taxonomy. ``invalid_result`` / ``provenance_drift``
#: / ``persistence_error`` are raised by this module's own boundary; the
#: producer_* kinds are recorded by the (later) runner when the external
#: semantic producer cannot answer.
EXTRACTION_ERROR_KINDS: tuple[str, ...] = (
    "producer_unavailable",
    "producer_timeout",
    "producer_error",
    "invalid_result",
    "provenance_drift",
    "persistence_error",
)

# Machine provenance: always reattached by code from the job, never accepted
# from a producer response (Model-Facing Identifier Law).
_PROVENANCE_FIELDS: tuple[str, ...] = (
    "source_commit",
    "source_turn",
    "source_receipts",
    "covers_commits",
)
# Cross-record lifecycle edges: an extraction result contains only new, open
# candidates. Supersession/contradiction/confirmation and transfer binding
# happen later through play and KP adjudication, never at extraction time.
_EDGE_FIELDS: tuple[str, ...] = (
    "superseded_by",
    "valid_until_turn",
    "contradicts",
    "confirms",
    "transfer_ref",
)

#: Closed candidate field set (the semantic half of ASSERTION_FIELDS).
CANDIDATE_FIELDS: tuple[str, ...] = (
    "assertion_id",
    "kind",
    "scope",
    "campaign_id",
    "timeline_id",
    "subject_id",
    "knowers",
    "privacy",
    "state",
    "statement",
    "entities",
    "occurred_turn",
    "valid_from_turn",
)
CANDIDATE_REQUIRED_FIELDS: tuple[str, ...] = (
    "assertion_id",
    "kind",
    "subject_id",
    "privacy",
    "state",
    "statement",
    "valid_from_turn",
)

#: Closed extraction-result envelope.
RESULT_FIELDS: tuple[str, ...] = ("job_id", "candidates")

#: Shared commit-record shape from the history projection contract
#: (``coc_history_projection_git``); only the binding fields are consumed.
COMMIT_RECORD_FIELDS: tuple[str, ...] = (
    "sha",
    "campaign_id",
    "timeline_id",
    "turn_number",
    "finalization_id",
    "commit_type",
    "parents",
    "tree_digest",
    "files",
)

#: Machine-side audit sidecar for extraction jobs (failures and applied
#: receipts). Not model-facing; lives beside the facade's JSONL stores.
EVENTS_FILENAME = "extraction-events.jsonl"

#: Completed extraction jobs are stored as **one immutable per-job result
#: artifact** under ``memory/temporal/extraction-jobs/<job_id>.json``
#: (semantic job-id path). The artifact is written whole through
#: temp-file + atomic hard-link create, so a job is either fully visible
#: or not visible at all — extraction never appends into, truncates, or
#: rewrites the shared append-only stores (``assertions`` / ``entities`` /
#: ``subjects``). Candidates therefore stay non-authoritative inside the
#: artifact until KP adjudication; materializing adjudicated candidates
#: into the shared assertion store is a later integration task's concern.
#: The artifact is machine-side integrity evidence (it carries the commit
#: sha and digests) and is never model-facing.
ARTIFACT_DIRNAME = "extraction-jobs"
ARTIFACT_FILENAME_SUFFIX = ".json"
ARTIFACT_FIELDS: tuple[str, ...] = (
    "job_id",
    "schema_generation",
    "episode_id",
    "campaign_id",
    "timeline_id",
    "turn_number",
    "provenance",
    "candidates",
    "candidate_count",
    "artifact_digest",
)
#: Machine provenance half carried on the artifact (closed field set).
PROVENANCE_HALF_FIELDS: tuple[str, ...] = (
    "commit",
    "finalization_receipt",
    "source_receipts",
    "episode_digest",
)
# Defensive path gate: job ids used as filenames must stay inside the
# semantic charset (no separators, no traversal).
_JOB_ID_PATH_RE = re.compile(r"^extract-[a-z0-9][a-z0-9._:-]*$")


class MemoryExtractionError(ValueError):
    """Closed validation/binding error for the extraction boundary."""

    def __init__(
        self,
        message: str,
        *,
        record_kind: str = "",
        field: str = "",
        value: Any = None,
    ) -> None:
        super().__init__(message)
        self.record_kind = record_kind
        self.field = field
        self.value = value


class _ExtractionFailure(Exception):
    """Internal: an extraction-domain failure already classified."""

    def __init__(self, error_kind: str, detail: str) -> None:
        super().__init__(detail)
        self.error_kind = error_kind
        self.detail = detail


# ---------------------------------------------------------------------------
# Deterministic ids
# ---------------------------------------------------------------------------


def extraction_job_id_for(
    campaign_id: str, timeline_id: str, turn_number: int
) -> str:
    """One finalized turn commit → one semantic extraction job id.

    The episode binds (campaign, timeline, turn) to exactly one immutable
    commit, so this id is 1:1 with the finalized commit.
    """
    job_id = f"{EXTRACTION_ID_PREFIX}{campaign_id}-{timeline_id}-turn-{turn_number}"
    if len(job_id) > contract._MAX_ID_LEN or not contract.SEMANTIC_ID_RE.match(job_id):
        raise MemoryExtractionError(
            f"extraction job id {job_id!r} violates the semantic id grammar",
            record_kind="extraction_job",
            field="job_id",
            value=job_id,
        )
    return job_id


def candidate_id_prefix(campaign_id: str, turn_number: int) -> str:
    """Deterministic candidate-id prefix: ``mem-<campaign>-t<turn>-c``."""
    return f"mem-{campaign_id}-t{turn_number}-c"


# ---------------------------------------------------------------------------
# Small shared helpers
# ---------------------------------------------------------------------------


def _require_mapping(value: Any, kind: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise MemoryExtractionError(
            f"{kind} must be a mapping, got {type(value).__name__}",
            record_kind=kind,
        )
    return value


def _check_no_unknown(
    record: Mapping[str, Any], allowed: tuple[str, ...], kind: str, field: str
) -> None:
    unknown = sorted(set(record) - set(allowed))
    if unknown:
        hint = ""
        if any(name in _PROVENANCE_FIELDS for name in unknown):
            hint = (
                "; machine provenance is reattached by code from the job and"
                " must never appear in a producer response"
            )
        raise MemoryExtractionError(
            f"{kind} has unknown fields {unknown}; the extraction schema is"
            f" closed{hint}",
            record_kind=kind,
            field=field,
            value=unknown[0],
        )


def _bound_detail(detail: Any) -> str:
    text = str(detail or "")
    if len(text) > MAX_DETAIL_CHARS:
        return text[:MAX_DETAIL_CHARS]
    return text


def _closed(record: Mapping[str, Any], fields: tuple[str, ...]) -> dict[str, Any]:
    return {key: record.get(key) for key in fields}


def _append_event(camp: Path, row: Mapping[str, Any]) -> None:
    temporal._append_jsonl(temporal.temporal_dir(camp) / EVENTS_FILENAME, row)


def _load_events(campaign_dir: Path | str) -> list[dict[str, Any]]:
    return temporal._read_jsonl(temporal.temporal_dir(campaign_dir) / EVENTS_FILENAME)


def _job_binding(job: Mapping[str, Any]) -> tuple[str, str, int]:
    packet = job.get("packet")
    if not isinstance(packet, Mapping):
        raise MemoryExtractionError(
            "job is missing its model-facing packet", record_kind="extraction_job"
        )
    campaign_id = packet.get("campaign_id")
    timeline_id = packet.get("timeline_id")
    turn_number = packet.get("turn_number")
    if not isinstance(campaign_id, str) or not campaign_id:
        raise MemoryExtractionError(
            "job packet is missing campaign_id", record_kind="extraction_job"
        )
    if not isinstance(timeline_id, str) or not timeline_id:
        raise MemoryExtractionError(
            "job packet is missing timeline_id", record_kind="extraction_job"
        )
    if not isinstance(turn_number, int) or isinstance(turn_number, bool) or turn_number < 1:
        raise MemoryExtractionError(
            "job packet turn_number must be an int >= 1",
            record_kind="extraction_job",
            field="turn_number",
            value=turn_number,
        )
    return campaign_id, timeline_id, turn_number


# ---------------------------------------------------------------------------
# build_extraction_job
# ---------------------------------------------------------------------------


def build_extraction_job(
    campaign_dir: Path | str,
    commit_record: Mapping[str, Any],
    finalization_receipt: str,
    episode: Mapping[str, Any],
) -> dict[str, Any]:
    """Build the deterministic extraction job for one finalized turn commit.

    Pure function of its inputs (no store access, no wall clock): building
    twice from the same inputs yields byte-identical canonical JSON. The
    returned job has three parts:

    - ``job_id`` — semantic id, 1:1 with the finalized commit;
    - ``packet`` — the model-facing half: semantic refs only (episode,
      campaign, timeline, turn, present subjects/entities, and the closed
      result contract). No commit shas, no receipts, no digests.
    - ``provenance`` — the machine half: commit sha, finalization receipt,
      attached source receipts, and the episode record digest used for
      anti-drift verification at apply time.
    """
    if campaign_dir is None:
        raise MemoryExtractionError(
            "campaign_dir is required", record_kind="extraction_job"
        )
    record = _require_mapping(commit_record, "commit_record")
    _check_no_unknown(record, COMMIT_RECORD_FIELDS, "commit_record", "sha")
    sha = record.get("sha")
    if not isinstance(sha, str) or not contract.COMMIT_SHA_RE.match(sha):
        raise MemoryExtractionError(
            "commit_record.sha must be a commit sha (40/64 lowercase hex)",
            record_kind="commit_record",
            field="sha",
            value=sha,
        )
    if record.get("commit_type") not in (None, "turn"):
        raise MemoryExtractionError(
            "extraction binds finalized turn commits only "
            f"(commit_type={record.get('commit_type')!r})",
            record_kind="commit_record",
            field="commit_type",
            value=record.get("commit_type"),
        )
    try:
        contract.validate_episode(episode)
    except contract.TemporalMemoryContractError as exc:
        raise MemoryExtractionError(
            f"episode record is not contract-valid: {exc}",
            record_kind="episode",
        ) from exc

    campaign_id = episode["campaign_id"]
    timeline_id = episode["timeline_id"]
    turn_number = episode["turn_number"]
    if record.get("campaign_id") != campaign_id:
        raise MemoryExtractionError(
            "commit_record.campaign_id does not match the episode binding",
            record_kind="commit_record",
            field="campaign_id",
            value=record.get("campaign_id"),
        )
    if record.get("timeline_id") != timeline_id:
        raise MemoryExtractionError(
            "commit_record.timeline_id does not match the episode binding",
            record_kind="commit_record",
            field="timeline_id",
            value=record.get("timeline_id"),
        )
    if record.get("turn_number") != turn_number:
        raise MemoryExtractionError(
            "commit_record.turn_number does not match the episode binding",
            record_kind="commit_record",
            field="turn_number",
            value=record.get("turn_number"),
        )
    if episode["commit"] != sha:
        raise MemoryExtractionError(
            "episode is bound to a different commit than commit_record.sha",
            record_kind="episode",
            field="commit",
            value=episode["commit"],
        )
    receipt = finalization_receipt
    if not isinstance(receipt, str) or not receipt.strip():
        raise MemoryExtractionError(
            "finalization_receipt must be a non-empty string",
            record_kind="extraction_job",
            field="finalization_receipt",
            value=receipt,
        )
    if receipt != episode["finalization_receipt"]:
        raise MemoryExtractionError(
            "finalization_receipt does not match the episode record",
            record_kind="extraction_job",
            field="finalization_receipt",
            value=receipt,
        )

    job_id = extraction_job_id_for(campaign_id, timeline_id, turn_number)
    packet = {
        "job_id": job_id,
        "episode_id": episode["episode_id"],
        "campaign_id": campaign_id,
        "timeline_id": timeline_id,
        "turn_number": turn_number,
        "subjects_present": list(episode.get("subjects_present") or []),
        "entities": list(episode.get("entities") or []),
        "result_contract": {
            "fields": list(CANDIDATE_FIELDS),
            "required_fields": list(CANDIDATE_REQUIRED_FIELDS),
            "forbidden_fields": list(_PROVENANCE_FIELDS + _EDGE_FIELDS),
            "id_prefix": candidate_id_prefix(campaign_id, turn_number),
            "id_rule": "id_prefix + ordinal; ordinal >= 1; unique within result",
            "allowed_kinds": list(EXTRACTABLE_ASSERTION_KINDS),
            "allowed_states": list(contract.MEMORY_STATES),
            "allowed_privacy": list(contract.PRIVACY_LEVELS),
            "max_candidates": MAX_CANDIDATES,
        },
    }
    provenance = {
        "commit": sha,
        "finalization_receipt": receipt,
        "source_receipts": [receipt],
        "episode_digest": contract.record_digest(_closed(episode, contract.EPISODE_FIELDS)),
    }
    return {
        "job_id": job_id,
        "schema_generation": SCHEMA_GENERATION,
        "packet": packet,
        "provenance": provenance,
    }


# ---------------------------------------------------------------------------
# validate_extraction_result
# ---------------------------------------------------------------------------


def validate_extraction_result(
    job: Mapping[str, Any], result: Mapping[str, Any]
) -> dict[str, Any]:
    """Closed validation of a semantic producer result against its job.

    Returns the normalized result: contract-valid, provenance-attached
    assertion payloads ready for facade persistence. Raises
    ``MemoryExtractionError`` (never persists, never calls out) when the
    result shape, ids, bindings, or candidate schemas are invalid —
    including any attempt by the producer to supply machine provenance or
    cross-record lifecycle edges.
    """
    job = _require_mapping(job, "extraction_job")
    campaign_id, timeline_id, turn_number = _job_binding(job)
    provenance = job.get("provenance")
    if not isinstance(provenance, Mapping):
        raise MemoryExtractionError(
            "job is missing its machine provenance half",
            record_kind="extraction_job",
        )
    commit = provenance.get("commit")
    if not isinstance(commit, str) or not contract.COMMIT_SHA_RE.match(commit):
        raise MemoryExtractionError(
            "job provenance commit is not a commit sha",
            record_kind="extraction_job",
            field="commit",
            value=commit,
        )
    receipts = list(provenance.get("source_receipts") or [])
    if not receipts:
        raise MemoryExtractionError(
            "job provenance source_receipts must not be empty",
            record_kind="extraction_job",
            field="source_receipts",
        )

    result = _require_mapping(result, "extraction_result")
    _check_no_unknown(result, RESULT_FIELDS, "extraction_result", "candidates")
    missing = [name for name in RESULT_FIELDS if result.get(name) is None]
    if missing:
        raise MemoryExtractionError(
            f"extraction_result is missing required fields {missing}",
            record_kind="extraction_result",
            field=missing[0],
        )
    if result["job_id"] != job.get("job_id"):
        raise MemoryExtractionError(
            f"result job_id {result['job_id']!r} does not match the job "
            f"{job.get('job_id')!r}",
            record_kind="extraction_result",
            field="job_id",
            value=result["job_id"],
        )
    raw_candidates = result["candidates"]
    if not isinstance(raw_candidates, (list, tuple)):
        raise MemoryExtractionError(
            "extraction_result.candidates must be a list",
            record_kind="extraction_result",
            field="candidates",
        )
    if len(raw_candidates) > MAX_CANDIDATES:
        raise MemoryExtractionError(
            f"extraction_result has {len(raw_candidates)} candidates; "
            f"max is {MAX_CANDIDATES}",
            record_kind="extraction_result",
            field="candidates",
            value=len(raw_candidates),
        )

    prefix = candidate_id_prefix(campaign_id, turn_number)
    id_pattern = re.compile(re.escape(prefix) + r"([1-9]\d*)$")
    seen_ids: set[str] = set()
    payloads: list[dict[str, Any]] = []
    for index, candidate in enumerate(raw_candidates):
        kind_name = f"candidate[{index}]"
        candidate = _require_mapping(candidate, kind_name)
        _check_no_unknown(
            candidate, CANDIDATE_FIELDS, kind_name, "assertion_id"
        )
        absent = [name for name in CANDIDATE_REQUIRED_FIELDS if candidate.get(name) is None]
        if absent:
            raise MemoryExtractionError(
                f"{kind_name} is missing required fields {absent}",
                record_kind=kind_name,
                field=absent[0],
            )
        assertion_id = candidate["assertion_id"]
        if not isinstance(assertion_id, str) or not id_pattern.match(assertion_id):
            raise MemoryExtractionError(
                f"{kind_name}.assertion_id {assertion_id!r} must bind this "
                f"job's campaign/turn via the deterministic prefix {prefix!r}"
                " plus a unique ordinal",
                record_kind=kind_name,
                field="assertion_id",
                value=assertion_id,
            )
        if assertion_id in seen_ids:
            raise MemoryExtractionError(
                f"duplicate candidate assertion_id {assertion_id!r}",
                record_kind=kind_name,
                field="assertion_id",
                value=assertion_id,
            )
        seen_ids.add(assertion_id)
        if candidate["kind"] not in EXTRACTABLE_ASSERTION_KINDS:
            raise MemoryExtractionError(
                f"{kind_name}.kind {candidate['kind']!r} is not extractable; "
                f"allowed kinds are {list(EXTRACTABLE_ASSERTION_KINDS)}",
                record_kind=kind_name,
                field="kind",
                value=candidate["kind"],
            )
        for field, expected in (
            ("scope", "campaign"),
            ("campaign_id", campaign_id),
            ("timeline_id", timeline_id),
        ):
            provided = candidate.get(field)
            if provided is not None and provided != expected:
                raise MemoryExtractionError(
                    f"{kind_name}.{field} {provided!r} does not match the "
                    f"job binding {expected!r}",
                    record_kind=kind_name,
                    field=field,
                    value=provided,
                )
        payload = {
            "assertion_id": assertion_id,
            "kind": candidate["kind"],
            "scope": "campaign",
            "campaign_id": campaign_id,
            "timeline_id": timeline_id,
            "subject_id": candidate["subject_id"],
            "knowers": list(candidate.get("knowers") or []),
            "privacy": candidate["privacy"],
            "state": candidate["state"],
            "statement": candidate["statement"],
            "entities": list(candidate.get("entities") or []),
            "occurred_turn": candidate.get("occurred_turn"),
            "valid_from_turn": candidate["valid_from_turn"],
            # Fresh, open candidates: lifecycle edges start empty and are
            # owned by later play/adjudication, never by extraction.
            "superseded_by": [],
            "valid_until_turn": None,
            "contradicts": [],
            "confirms": [],
            "covers_commits": [],
            "transfer_ref": None,
            # Machine provenance: reattached from the job by code.
            "source_commit": commit,
            "source_turn": turn_number,
            "source_receipts": list(receipts),
        }
        try:
            contract.validate_assertion(payload)
        except contract.TemporalMemoryContractError as exc:
            raise MemoryExtractionError(
                f"{kind_name} ({assertion_id}) is not contract-valid: {exc}",
                record_kind=kind_name,
                field=getattr(exc, "field", ""),
                value=getattr(exc, "value", None),
            ) from exc
        payloads.append(payload)
    return {"job_id": job["job_id"], "candidates": payloads}


# ---------------------------------------------------------------------------
# apply_extraction_result
# ---------------------------------------------------------------------------


def _verify_job_against_store(camp: Path, job: Mapping[str, Any]) -> None:
    """Machine anti-drift: the job must still match the recorded episode."""
    campaign_id, timeline_id, turn_number = _job_binding(job)
    provenance = job.get("provenance")
    if not isinstance(provenance, Mapping):
        raise _ExtractionFailure(
            "provenance_drift", "job is missing its machine provenance half"
        )
    expected_job_id = extraction_job_id_for(campaign_id, timeline_id, turn_number)
    if job.get("job_id") != expected_job_id:
        raise _ExtractionFailure(
            "provenance_drift",
            f"job_id {job.get('job_id')!r} is not the deterministic id "
            f"{expected_job_id!r} for this binding",
        )
    episode_id = contract.episode_id_for(campaign_id, timeline_id, turn_number)
    packet = job.get("packet") or {}
    if packet.get("episode_id") != episode_id:
        raise _ExtractionFailure(
            "provenance_drift",
            f"packet episode_id {packet.get('episode_id')!r} does not match "
            f"the deterministic episode id {episode_id!r}",
        )
    stored = temporal.load_episodes(camp).get(episode_id)
    if stored is None:
        raise _ExtractionFailure(
            "provenance_drift",
            f"episode {episode_id!r} is not recorded in the temporal store",
        )
    if stored.get("commit") != provenance.get("commit"):
        raise _ExtractionFailure(
            "provenance_drift",
            f"job commit {provenance.get('commit')!r} differs from the "
            f"immutable episode commit {stored.get('commit')!r}",
        )
    if stored.get("finalization_receipt") != provenance.get("finalization_receipt"):
        raise _ExtractionFailure(
            "provenance_drift",
            "job finalization_receipt differs from the episode record",
        )
    if contract.record_digest(stored) != provenance.get("episode_digest"):
        raise _ExtractionFailure(
            "provenance_drift",
            "episode record digest differs from the job's episode digest",
        )


def _backlog_status(
    camp: Path, backlog_id: str, *, recover: bool
) -> str:
    latest = temporal._load_latest(temporal._path(camp, "backlog"), "backlog_id")
    row = latest.get(backlog_id)
    if row is None:
        return "none"
    if recover and row.get("status") == "pending":
        updated = dict(row)
        updated["status"] = "recovered"
        contract.validate_backlog_record(updated)
        temporal._append_jsonl(temporal._path(camp, "backlog"), updated)
        return "recovered"
    return str(row.get("status") or "pending")


def _failure_receipt(
    camp: Path,
    job: Mapping[str, Any],
    error_kind: str,
    detail: str,
    applied_ids: list[str] | None = None,
) -> dict[str, Any]:
    applied = list(applied_ids or [])
    detail = _bound_detail(detail)
    backlog_id: str | None = None
    backlog_status = "unrecorded"
    try:
        row = record_extraction_failure(camp, job, error_kind, detail)
        backlog_id = row["backlog_id"]
        backlog_status = row["status"]
    except (MemoryExtractionError, contract.TemporalMemoryContractError):
        # Structurally impossible job (never produced by
        # build_extraction_job): still never raise into the caller, and
        # leave an audit event with whatever the job can name.
        packet = job.get("packet") if isinstance(job, Mapping) else None
        packet = packet if isinstance(packet, Mapping) else {}
        _append_event(
            camp,
            {
                "event": "failed",
                "job_id": job.get("job_id") if isinstance(job, Mapping) else None,
                "episode_id": None,
                "campaign_id": packet.get("campaign_id"),
                "timeline_id": packet.get("timeline_id"),
                "turn_number": packet.get("turn_number"),
                "error_kind": error_kind,
                "detail": detail,
                "applied": len(applied),
                "assertion_ids": applied,
            },
        )
    return {
        "job_id": job.get("job_id") if isinstance(job, Mapping) else None,
        "status": "backlog_pending",
        "applied": len(applied),
        "assertion_ids": applied,
        "backlog_id": backlog_id,
        "backlog_status": backlog_status,
        "error_kind": error_kind,
        "detail": detail,
        "authority": AUTHORITY,
        "hard_gate": HARD_GATE,
    }


def _artifact_path(campaign_dir: Path | str, job_id: str) -> Path:
    """Semantic per-job artifact path (defensive charset gate first)."""
    if not isinstance(job_id, str) or not _JOB_ID_PATH_RE.match(job_id):
        raise MemoryExtractionError(
            f"job_id {job_id!r} is not a valid semantic artifact path "
            "component",
            record_kind="extraction_job",
            field="job_id",
            value=job_id,
        )
    return (
        temporal.temporal_dir(campaign_dir)
        / ARTIFACT_DIRNAME
        / (job_id + ARTIFACT_FILENAME_SUFFIX)
    )


def build_job_artifact(
    job: Mapping[str, Any], normalized: Mapping[str, Any]
) -> dict[str, Any]:
    """Assemble the immutable completed-job artifact from a validated result."""
    campaign_id, timeline_id, turn_number = _job_binding(job)
    provenance = job.get("provenance")
    if not isinstance(provenance, Mapping):
        raise MemoryExtractionError(
            "job is missing its machine provenance half",
            record_kind="extraction_job",
        )
    candidates = [dict(payload) for payload in normalized["candidates"]]
    artifact = {
        "job_id": job["job_id"],
        "schema_generation": SCHEMA_GENERATION,
        "episode_id": contract.episode_id_for(campaign_id, timeline_id, turn_number),
        "campaign_id": campaign_id,
        "timeline_id": timeline_id,
        "turn_number": turn_number,
        "provenance": _closed(provenance, PROVENANCE_HALF_FIELDS),
        "candidates": candidates,
        "candidate_count": len(candidates),
    }
    artifact["artifact_digest"] = artifact_content_digest(artifact)
    return artifact


def artifact_content_digest(artifact: Mapping[str, Any]) -> str:
    """Documented digest formula for completed-job artifacts.

    SHA-256 (:func:`coc_temporal_memory_contract.record_digest`) over the
    canonical JSON of the artifact with **exactly the ``artifact_digest``
    field removed** — every other field, including ``candidates`` and
    ``provenance``, is covered. ``build_job_artifact`` computes the stored
    digest with this same formula, and every load/replay recomputes it and
    requires equality before the content is trusted.
    """
    content = {key: value for key, value in artifact.items() if key != "artifact_digest"}
    return contract.record_digest(content)


def _verify_artifact_integrity(
    artifact: Mapping[str, Any], *, name: str, job_id: str
) -> None:
    """Fail closed on any closed-schema, binding, or digest mismatch."""
    unknown = sorted(set(artifact) - set(ARTIFACT_FIELDS))
    if unknown:
        raise MemoryExtractionError(
            f"completed job artifact {name} has unknown fields {unknown}; "
            "the artifact schema is closed",
            record_kind="extraction_job",
            field=unknown[0] if unknown else "",
            value=unknown,
        )
    missing = [
        field for field in ARTIFACT_FIELDS if artifact.get(field) is None
    ]
    if missing:
        raise MemoryExtractionError(
            f"completed job artifact {name} is corrupt: missing fields "
            f"{missing}",
            record_kind="extraction_job",
            field=missing[0],
            value=missing,
        )
    if artifact["job_id"] != job_id:
        raise MemoryExtractionError(
            f"completed job artifact {name} carries job_id "
            f"{artifact['job_id']!r} instead of {job_id!r}",
            record_kind="extraction_job",
            field="job_id",
            value=artifact["job_id"],
        )
    stored = artifact.get("artifact_digest")
    recomputed = artifact_content_digest(artifact)
    if not isinstance(stored, str) or stored != recomputed:
        raise MemoryExtractionError(
            f"completed job artifact {name} failed integrity verification: "
            "the stored artifact_digest does not match the recomputed "
            "digest of its content (tampered or corrupt); failing closed",
            record_kind="extraction_job",
            field="artifact_digest",
            value=stored,
        )


def load_completed_job(
    campaign_dir: Path | str, job_id: str
) -> dict[str, Any] | None:
    """Read, verify, and return the completed-job artifact for ``job_id``.

    Every load verifies integrity before the content is trusted: the
    closed schema, the job-id binding, and the canonical digest recomputed
    from the stored content per :func:`artifact_content_digest` must all
    match the stored ``artifact_digest``. ``None`` means only "no artifact
    for this job"; anything present-but-wrong — malformed JSON, unknown or
    missing fields, a foreign job id, tampered content, or a stale digest —
    raises ``MemoryExtractionError`` (fail closed).
    """
    path = _artifact_path(campaign_dir, job_id)
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    try:
        artifact = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise MemoryExtractionError(
            f"completed job artifact {path.name} is unreadable: {exc}",
            record_kind="extraction_job",
            field="artifact_digest",
        ) from exc
    if not isinstance(artifact, dict):
        raise MemoryExtractionError(
            f"completed job artifact {path.name} is not a mapping",
            record_kind="extraction_job",
        )
    _verify_artifact_integrity(artifact, name=path.name, job_id=job_id)
    return artifact


def _write_temp_artifact(tmp: Path, text: str) -> None:
    """Write the canonical artifact bytes to a temp file (fsynced)."""
    with tmp.open("w", encoding="utf-8") as handle:
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())


def _write_artifact_atomic(camp: Path, artifact: Mapping[str, Any]) -> str:
    """Publish the artifact whole, or not at all. Never rewrites anything.

    The temp file is created exclusively (``O_EXCL`` via ``mkstemp``) with
    a machine-internal unique nonce **in the target directory**, so two
    concurrent calls in the same process — even for the same job — never
    share, truncate, or unlink each other's temp path; each call cleans
    only the temp it created. ``temp write + os.link`` then gives an atomic
    create-if-absent publication: the target either does not exist or is a
    complete artifact. When the target already exists, the stored artifact
    is loaded (digest-verified) and an exact replay (matching
    ``artifact_digest``) returns ``"replayed"`` idempotently; any
    divergence or corruption fails closed as provenance drift with the
    stored artifact left untouched. No shared append-only store is ever
    opened for write.
    """
    target = _artifact_path(camp, artifact["job_id"])
    target.parent.mkdir(parents=True, exist_ok=True)
    text = contract.canonical_json(artifact)
    handle_fd, tmp_name = tempfile.mkstemp(
        dir=str(target.parent), prefix=f".{target.name}.", suffix=".tmp"
    )
    os.close(handle_fd)
    tmp = Path(tmp_name)
    try:
        _write_temp_artifact(tmp, text)
        try:
            os.link(tmp, target)
        except FileExistsError:
            try:
                existing = load_completed_job(camp, artifact["job_id"])
            except MemoryExtractionError as exc:
                raise _ExtractionFailure(
                    "provenance_drift",
                    f"completed job {artifact['job_id']!r} exists but cannot "
                    f"be verified for replay comparison: {exc}",
                ) from exc
            if (
                isinstance(existing, dict)
                and existing.get("artifact_digest") == artifact["artifact_digest"]
            ):
                return "replayed"
            raise _ExtractionFailure(
                "provenance_drift",
                f"completed job {artifact['job_id']!r} already exists with "
                "different content; artifacts are immutable and divergent "
                "replays fail closed",
            ) from None
        os.chmod(target, 0o644)
        return "created"
    finally:
        # Only this invocation's own exclusively-created temp is removed.
        tmp.unlink(missing_ok=True)


def apply_extraction_result(
    campaign_dir: Path | str,
    job: Mapping[str, Any],
    result: Mapping[str, Any],
) -> dict[str, Any]:
    """Validate, reattach provenance, and complete the extraction job.

    Never raises for extraction-domain failures (invalid result, provenance
    drift, artifact write error): each is recorded as an explicit pending
    backlog row and returned as ``status="backlog_pending"`` so nothing can
    propagate into ``turn.finalize``. A failed write leaves **no visible
    completed job** and deletes nothing — pre-existing and concurrent
    records in the shared stores are untouched by construction.

    The whole validated batch is persisted as one immutable per-job
    artifact (all-or-nothing visibility): extraction never publishes
    candidates into the shared append-only stores, and promotion to world
    truth stays with KP adjudication. Same-job exact replay is idempotent;
    divergent replay fails closed. Every successful validated extraction
    — including a legitimate zero-candidate result — produces a completed
    job record and recovers a matching pending backlog row. Only a
    structurally impossible ``campaign_dir`` (``None``) raises; jobs always
    come from ``build_extraction_job``.
    """
    if campaign_dir is None:
        raise MemoryExtractionError(
            "campaign_dir is required", record_kind="extraction_job"
        )
    camp = Path(campaign_dir)
    job = _require_mapping(job, "extraction_job")

    try:
        _verify_job_against_store(camp, job)
        normalized = validate_extraction_result(job, result)
        artifact = build_job_artifact(job, normalized)
    except _ExtractionFailure as failure:
        return _failure_receipt(camp, job, failure.error_kind, failure.detail)
    except MemoryExtractionError as exc:
        return _failure_receipt(camp, job, "invalid_result", str(exc))

    try:
        temporal.ensure_store(camp)
        outcome = _write_artifact_atomic(camp, artifact)
    except _ExtractionFailure as failure:
        return _failure_receipt(camp, job, failure.error_kind, failure.detail)
    except OSError as exc:
        return _failure_receipt(
            camp,
            job,
            "persistence_error",
            f"no completed job is visible (artifact write failed): {exc}",
        )

    campaign_id = artifact["campaign_id"]
    timeline_id = artifact["timeline_id"]
    turn_number = artifact["turn_number"]
    episode_id = artifact["episode_id"]
    applied_ids = [payload["assertion_id"] for payload in artifact["candidates"]]

    # Every successful validated extraction — including a zero-candidate
    # result and an exact replay — recovers a matching pending backlog row.
    backlog_id = contract.backlog_id_for(campaign_id, turn_number, BACKLOG_SLOT)
    backlog_status = _backlog_status(camp, backlog_id, recover=True)
    _append_event(
        camp,
        {
            "event": "applied",
            "job_id": artifact["job_id"],
            "episode_id": episode_id,
            "campaign_id": campaign_id,
            "timeline_id": timeline_id,
            "turn_number": turn_number,
            "outcome": outcome,
            "error_kind": None,
            "detail": "",
            "applied": len(applied_ids),
            "assertion_ids": applied_ids,
            "artifact_digest": artifact["artifact_digest"],
        },
    )
    return {
        "job_id": artifact["job_id"],
        "episode_id": episode_id,
        "campaign_id": campaign_id,
        "timeline_id": timeline_id,
        "turn_number": turn_number,
        "status": "applied",
        "applied": len(applied_ids),
        "assertion_ids": applied_ids,
        "artifact_digest": artifact["artifact_digest"],
        "backlog_id": backlog_id,
        "backlog_status": backlog_status,
        "authority": AUTHORITY,
        "hard_gate": HARD_GATE,
    }


# ---------------------------------------------------------------------------
# record_extraction_failure
# ---------------------------------------------------------------------------


def record_extraction_failure(
    campaign_dir: Path | str,
    job: Mapping[str, Any],
    error_kind: str,
    detail: str,
) -> dict[str, Any]:
    """Record an explicit, recoverable extraction backlog row (pending).

    The backlog record stays contract-closed (no diagnostic fields); the
    error kind and bounded detail go to the machine-side
    ``extraction-events.jsonl`` audit sidecar. The commit pointer prefers
    the immutable episode recorded in the store, so a drifted job still
    records a recoverable row pointing at the real episode commit.
    """
    if campaign_dir is None:
        raise MemoryExtractionError(
            "campaign_dir is required", record_kind="extraction_job"
        )
    if error_kind not in EXTRACTION_ERROR_KINDS:
        raise MemoryExtractionError(
            f"error_kind {error_kind!r} not in closed enum "
            f"{list(EXTRACTION_ERROR_KINDS)}",
            record_kind="backlog",
            field="error_kind",
            value=error_kind,
        )
    camp = Path(campaign_dir)
    job = _require_mapping(job, "extraction_job")
    campaign_id, timeline_id, turn_number = _job_binding(job)
    provenance = job.get("provenance") or {}
    episode_id = contract.episode_id_for(campaign_id, timeline_id, turn_number)
    temporal.ensure_store(camp)
    stored = temporal.load_episodes(camp).get(episode_id)
    commit = stored.get("commit") if stored is not None else provenance.get("commit")
    if not isinstance(commit, str) or not contract.COMMIT_SHA_RE.match(commit):
        raise MemoryExtractionError(
            "cannot record a backlog row without a valid commit sha "
            "(episode missing and job provenance commit invalid)",
            record_kind="backlog",
            field="commit",
            value=commit,
        )
    backlog_id = contract.backlog_id_for(campaign_id, turn_number, BACKLOG_SLOT)
    row = {
        "backlog_id": backlog_id,
        "campaign_id": campaign_id,
        "timeline_id": timeline_id,
        "commit": commit,
        "turn_number": turn_number,
        "reason": "extraction_error",
        "status": "pending",
    }
    contract.validate_backlog_record(row)
    latest = temporal._load_latest(temporal._path(camp, "backlog"), "backlog_id")
    prior = latest.get(backlog_id)
    if prior is None or contract.record_digest(prior) != contract.record_digest(row):
        temporal._append_jsonl(temporal._path(camp, "backlog"), row)
    _append_event(
        camp,
        {
            "event": "failed",
            "job_id": job.get("job_id"),
            "episode_id": episode_id,
            "campaign_id": campaign_id,
            "timeline_id": timeline_id,
            "turn_number": turn_number,
            "error_kind": error_kind,
            "detail": _bound_detail(detail),
            "applied": 0,
            "assertion_ids": [],
        },
    )
    return row


# ---------------------------------------------------------------------------
# Recovery introspection
# ---------------------------------------------------------------------------


def load_extraction_events(campaign_dir: Path | str) -> list[dict[str, Any]]:
    """Machine-side audit rows (failures, applied receipts), oldest first."""
    return _load_events(campaign_dir)
