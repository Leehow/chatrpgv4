#!/usr/bin/env python3
"""Operation adapter cell: memory-extraction.

KP-facing typed surface over the reviewed deterministic extraction core
(``coc_memory_extraction``) and the canonical temporal-memory facade
(``coc_temporal_memory``). This cell composes them; it is never a second
engine: no queue, no store, no replay machinery of its own.

- ``memory.extraction_status`` — strict read-only listing of the
  campaign's semantic extraction backlog (one entry per finalized turn),
  each with its backlog id, timeline, turn, enqueue reason, and current
  status, deterministically ordered by (timeline, turn, backlog id).
  Missing store is an explicit empty list; nothing is ever created,
  bootstrapped, or reordered by a read.
- ``memory.extraction_settle`` — the KP resolves exactly one pending
  backlog entry. ``recovered`` routes the KP-supplied semantic producer
  result through the reviewed core (deterministic job rebuild from the
  backlog binding → closed result validation → immutable per-job artifact)
  and then materializes every digest-verified candidate as a contract-
  valid assertion through the same facade writer ``memory.adjudicate``
  uses beneath ``adjudicate_candidate``; ``abandoned`` records the KP's
  reason on the receipt and flips only the entry status — candidate data
  is never deleted. Decision ids are immutable once bound to their
  request fingerprint (same rules as every other temporal mutation); a
  byte-equal replay returns the stored receipt.

Model-facing surfaces stay semantic (backlog/job/timeline/turn/receipt
ids); commit shas, digests, and episode provenance are machine-internal.
Memory stays advisory: state.*/rules.* remain authoritative, and settled
candidates land at the privacy tier the producer declared.
"""
from __future__ import annotations

import hashlib
import json

from coc_operation_kernel_runtime import (
    Any,
    Ctx,
    ToolError,
    _load_sibling,
    re,
    tool,
)

coc_memory_extraction = _load_sibling(
    "coc_memory_extraction", "coc_memory_extraction.py"
)

coc_temporal_memory = _load_sibling("coc_temporal_memory", "coc_temporal_memory.py")

coc_temporal_memory_contract = _load_sibling(
    "coc_temporal_memory_contract", "coc_temporal_memory_contract.py"
)

_STATUS_TOOL = "memory.extraction_status"
_SETTLE_TOOL = "memory.extraction_settle"

_RECOVERED = "recovered"
_ABANDONED = "abandoned"
_SETTLE_DISPOSITIONS = (_RECOVERED, _ABANDONED)

_BACKLOG_ID_RE = re.compile(r"^backlog-[A-Za-z0-9][A-Za-z0-9._:-]{0,100}$")

_EXTRACTION_STATUS_HINTS = [
    "this backlog is advisory recovery bookkeeping: entries exist so no "
    "finalized turn's memory is silently lost — clearing them never gates "
    "play",
    "settle a pending entry with memory.extraction_settle: recovered "
    "materializes the candidates you supply for that turn's job, abandoned "
    "records your reason and keeps all data intact",
]

_EXTRACTION_SETTLE_HINTS = [
    "settled candidates are advisory memory at the privacy tier you "
    "declared — keeper_only rows never reach player_safe views",
    "nothing is ever deleted by settlement: an abandonment keeps the "
    "episode evidence, and materialized assertions keep their provenance",
]


def _require_decision_id(value: Any) -> str:
    token = str(value or "").strip()
    if not token:
        raise ToolError("invalid_param", "decision_id is required")
    return token


def _require_backlog_id(value: Any) -> str:
    token = str(value or "").strip()
    if not _BACKLOG_ID_RE.match(token):
        raise ToolError(
            "invalid_param",
            f"backlog_id must be the semantic backlog id exactly as returned "
            f"by memory.extraction_status, got {value!r}",
        )
    return token


def _require_disposition(value: Any) -> str:
    disposition = str(value or "").strip()
    if disposition not in _SETTLE_DISPOSITIONS:
        raise ToolError(
            "invalid_param",
            "disposition must be one of "
            + ", ".join(_SETTLE_DISPOSITIONS)
            + f", got {disposition!r}",
        )
    return disposition


def _require_candidates(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or not value:
        raise ToolError(
            "invalid_param",
            "candidates must be a non-empty array of candidate mappings for "
            "the recovered disposition (the zero-candidate form of this "
            "turn's result is produced through the extraction core itself)",
        )
    for index, candidate in enumerate(value):
        if not isinstance(candidate, dict):
            raise ToolError(
                "invalid_param",
                f"candidate[{index}] must be a mapping carrying only the "
                "semantic fields of this job's result contract",
            )
    return value


def _optional_reason(value: Any) -> str:
    reason = str(value or "").strip()
    if len(reason) > coc_memory_extraction.MAX_DETAIL_CHARS:
        raise ToolError(
            "invalid_param",
            "reason must be concise (<= "
            f"{coc_memory_extraction.MAX_DETAIL_CHARS} chars)",
        )
    return reason


def _bounded(detail: str) -> str:
    text = str(detail or "").strip()
    if len(text) > coc_memory_extraction.MAX_DETAIL_CHARS:
        return text[: coc_memory_extraction.MAX_DETAIL_CHARS]
    return text


def _extraction_request_fingerprint(
    *,
    campaign_id: str,
    backlog_id: str,
    disposition: str,
    reason: str,
    candidates: Any,
) -> str:
    """Machine-attached canonical digest of the whole settle request.

    Integrity evidence only: the machine stores and compares it; the model
    never reads, echoes, or produces it. A decision_id replays only for the
    byte-equal request; any drift fails closed at the operation ledger.
    """
    payload = json.dumps(
        [
            "memory-extraction-settle-request-1",
            campaign_id,
            backlog_id,
            disposition,
            reason,
            candidates if isinstance(candidates, list) else [],
        ],
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _campaign_backlog(ctx: Ctx) -> dict[str, dict[str, Any]]:
    """Latest backlog rows of this campaign from the canonical facade.

    Read-only: never calls ``ensure_store``, so a strict read cannot
    bootstrap a store that does not exist yet.
    """
    rows = coc_temporal_memory.load_backlog(ctx.campaign_dir)
    return {
        backlog_id: row
        for backlog_id, row in rows.items()
        if isinstance(row, dict) and row.get("campaign_id") == ctx.campaign_id
    }


def _public_entry(row: dict[str, Any]) -> dict[str, Any]:
    """Semantic projection of one backlog row; commit shas stay internal."""
    turn = row.get("turn_number")
    return {
        "backlog_id": row.get("backlog_id"),
        "timeline_id": row.get("timeline_id"),
        "turn_number": int(turn) if isinstance(turn, int) else turn,
        "reason": row.get("reason"),
        "status": row.get("status"),
    }


def _tool_memory_extraction_status(ctx: Ctx, args: dict[str, Any]):
    entries = [
        _public_entry(row)
        for row in _campaign_backlog(ctx).values()
        if isinstance(row.get("turn_number"), int)
    ]
    # Deterministic ordering: newest play relevance last, ties broken by the
    # full semantic id so the projection is byte-stable across replays.
    entries.sort(
        key=lambda entry: (
            str(entry["timeline_id"] or ""),
            int(entry["turn_number"]),
            str(entry["backlog_id"]),
        )
    )
    data = {
        "schema_version": 1,
        "authority": coc_memory_extraction.AUTHORITY,
        "hard_gate": coc_memory_extraction.HARD_GATE,
        "campaign_id": ctx.campaign_id,
        "count": len(entries),
        "pending_count": sum(
            1 for entry in entries if entry["status"] == "pending"
        ),
        "entries": entries,
    }
    return data, [], list(_EXTRACTION_STATUS_HINTS)


def _stored_backlog_row(ctx: Ctx, backlog_id: str) -> dict[str, Any]:
    row = _campaign_backlog(ctx).get(backlog_id)
    if row is None:
        raise ToolError(
            "invalid_state",
            f"unknown backlog entry {backlog_id!r}: resolve it against this "
            "campaign with memory.extraction_status first",
        )
    return row


def _rebuild_job_for_entry(ctx: Ctx, row: dict[str, Any]) -> dict[str, Any]:
    """Deterministically rebuild the entry's extraction job (core path).

    The binding comes from the append-only backlog row plus the immutable
    stored episode — never from caller input — so the rebuilt job is
    byte-identical to the one the finalize hook derived from Git.
    """
    campaign_id = ctx.campaign_id
    timeline_id = str(row.get("timeline_id") or "")
    turn_number = int(row.get("turn_number"))
    episode_id = coc_temporal_memory_contract.episode_id_for(
        campaign_id, timeline_id, turn_number
    )
    stored = coc_temporal_memory.load_episodes(ctx.campaign_dir).get(episode_id)
    if stored is None:
        raise ToolError(
            "invalid_state",
            f"backlog entry {row.get('backlog_id')!r} has no recorded episode "
            f"{episode_id!r}; its provenance cannot be rebuilt",
        )
    episode_core = {
        key: value for key, value in stored.items() if key != "evidence"
    }
    commit_record = {
        "sha": str(row.get("commit") or ""),
        "campaign_id": campaign_id,
        "timeline_id": timeline_id,
        "turn_number": turn_number,
        "commit_type": "turn",
    }
    try:
        return coc_memory_extraction.build_extraction_job(
            ctx.campaign_dir,
            commit_record,
            str(stored.get("finalization_receipt") or ""),
            episode_core,
        )
    except (
        coc_memory_extraction.MemoryExtractionError,
        coc_temporal_memory_contract.TemporalMemoryContractError,
        ValueError,
    ) as exc:
        raise ToolError(
            "invalid_state",
            f"the extraction job for {row.get('backlog_id')!r} cannot be "
            f"rebuilt from its recorded binding: {exc}",
        ) from exc


def _apply_result_to_core(
    ctx: Ctx, job: dict[str, Any], candidates: list[dict[str, Any]]
) -> dict[str, Any]:
    """Route one producer result through the reviewed core boundary.

    The result is pre-validated with the core's own pure validator first so
    a malformed or drifting KP response fails closed without any write:
    the fallback would otherwise let ``apply_extraction_result`` record a
    fresh pending backlog row — silently un-setting an already settled
    entry. Only the write-bearing path may run after pure validation;
    post-apply failure receipts are genuine store-level drift and stay
    mapped to ``invalid_state``.
    """
    try:
        coc_memory_extraction.validate_extraction_result(
            job,
            {"job_id": job["job_id"], "candidates": candidates},
        )
    except (
        coc_memory_extraction.MemoryExtractionError,
        ValueError,
    ) as exc:
        raise ToolError(
            "invalid_param",
            "the extraction core rejected this producer result: "
            f"{_bounded(str(exc))}",
        ) from exc
    receipt = coc_memory_extraction.apply_extraction_result(
        ctx.campaign_dir,
        job,
        {"job_id": job["job_id"], "candidates": candidates},
    )
    if receipt.get("status") != "applied":
        raise ToolError(
            "invalid_state",
            "the extraction core could not complete this result against its "
            f"store ({receipt.get('error_kind') or 'unknown'}): "
            f"{_bounded(str(receipt.get('detail') or 'drift'))}",
        )
    return receipt


def _materialize_artifact_candidates(
    ctx: Ctx, job_id: str
) -> list[str]:
    """Land the completed job's candidates as contract-valid assertions.

    Reads only the digest-verified per-job artifact — the single source of
    truth the core persisted — and writes each candidate through the same
    facade writer ``memory.adjudicate`` uses, so a byte-equal replay stays
    idempotent (exactly-once is enforced by content identity).
    """
    artifact = coc_memory_extraction.load_completed_job(
        ctx.campaign_dir, job_id
    )
    if not isinstance(artifact, dict):
        raise ToolError(
            "invalid_state",
            f"completed extraction job {job_id!r} is missing after apply; "
            "failing closed instead of inventing candidates",
        )
    recorded: list[str] = []
    try:
        for payload in sorted(
            artifact.get("candidates") or [], key=lambda row: row["assertion_id"]
        ):
            written = coc_temporal_memory.record_assertion(
                payload, campaign_dir=ctx.campaign_dir
            )
            recorded.append(written["assertion_id"])
    except (coc_temporal_memory.TemporalMemoryError, KeyError, OSError) as exc:
        raise ToolError(
            "invalid_state",
            f"job {job_id!r} landed but materializing a candidate failed: "
            f"{exc}; replay this settle with a fresh decision_id to complete "
            "the batch — the completed job makes it converge",
        ) from exc
    return recorded


def _tool_memory_extraction_settle(ctx: Ctx, args: dict[str, Any]):
    decision_id = _require_decision_id(args.get("decision_id"))
    backlog_id = _require_backlog_id(args.get("backlog_id"))
    disposition = _require_disposition(args.get("disposition"))
    candidates_raw = args.get("candidates")
    reason = _optional_reason(args.get("reason"))

    if disposition == _RECOVERED:
        if reason:
            raise ToolError(
                "invalid_param",
                "reason belongs to an abandoned settlement; a recovered "
                "settlement carries candidates instead",
            )
        candidates = _require_candidates(candidates_raw)
    else:
        if not reason:
            raise ToolError(
                "invalid_param",
                "an abandoned settlement requires your concise KP reason",
            )
        if candidates_raw not in (None, []):
            raise ToolError(
                "invalid_param",
                "an abandoned settlement carries no candidates; abandon never "
                "writes candidate data — pass none",
            )
        candidates = []

    fingerprint = _extraction_request_fingerprint(
        campaign_id=ctx.campaign_id,
        backlog_id=backlog_id,
        disposition=disposition,
        reason=reason,
        candidates=candidates,
    )
    prior = ctx.ledger_lookup(_SETTLE_TOOL, decision_id)
    if prior is not None:
        prior_data = prior.get("data")
        if (
            not isinstance(prior_data, dict)
            or prior_data.get("request_fingerprint") != fingerprint
        ):
            raise ToolError(
                "idempotency_conflict",
                f"decision_id {decision_id!r} is already bound to a different "
                f"{_SETTLE_TOOL} request; a decision is immutable once "
                "recorded — use a fresh decision_id",
            )
        receipt = prior_data.get("receipt")
        if not isinstance(receipt, dict):
            raise ToolError("invalid_state", "stored settle receipt is malformed")
        return receipt, [
            "duplicate decision_id: returning the previous receipt"
        ], list(_EXTRACTION_SETTLE_HINTS)

    row = _stored_backlog_row(ctx, backlog_id)
    status_before = str(row.get("status") or "pending")

    if disposition == _ABANDONED:
        try:
            updated = coc_temporal_memory.settle_backlog(
                ctx.campaign_dir,
                backlog_id,
                status=_ABANDONED,
            )
        except coc_temporal_memory.TemporalMemoryError as exc:
            raise ToolError(
                "invalid_state",
                f"cannot abandon {backlog_id!r}: {exc}",
            ) from exc
        receipt = {
            "schema_version": 1,
            "tool": _SETTLE_TOOL,
            "decision_id": decision_id,
            "backlog_id": backlog_id,
            "timeline_id": updated.get("timeline_id"),
            "turn_number": updated.get("turn_number"),
            "disposition": _ABANDONED,
            "status": str(updated.get("status")),
            "reason": reason,
            "entry_status_before": status_before,
            "materialized_count": 0,
            "assertion_ids": [],
        }
        ctx.ledger_record(
            decision_id,
            _SETTLE_TOOL,
            {
                "schema_version": 1,
                "request_fingerprint": fingerprint,
                "receipt": receipt,
            },
        )
        warnings = (
            []
            if status_before == "pending"
            else [f"entry was already settled ({status_before}) before this call"]
        )
        return receipt, warnings, list(_EXTRACTION_SETTLE_HINTS)

    # Disposition == recovered. A pending entry settles outright; an already
    # recovered entry can only converge: every downstream step below is
    # content-addressed (immutable per-job artifact + byte-equal assertion
    # writes), so this replay either reproduces exactly once or fails closed.
    if status_before != "pending" and status_before != _RECOVERED:
        raise ToolError(
            "invalid_state",
            f"backlog entry {backlog_id!r} was already settled as "
            f"{status_before!r}; it never moves again",
        )

    job = _rebuild_job_for_entry(ctx, row)
    core_receipt = _apply_result_to_core(ctx, job, candidates)
    assertion_ids = _materialize_artifact_candidates(ctx, job["job_id"])

    receipt = {
        "schema_version": 1,
        "tool": _SETTLE_TOOL,
        "decision_id": decision_id,
        "backlog_id": backlog_id,
        "job_id": job["job_id"],
        "episode_id": str(core_receipt.get("episode_id") or ""),
        "timeline_id": row.get("timeline_id"),
        "turn_number": row.get("turn_number"),
        "disposition": _RECOVERED,
        "status": _RECOVERED,
        "entry_status_before": status_before,
        "materialized_count": len(assertion_ids),
        "assertion_ids": assertion_ids,
    }
    ctx.ledger_record(
        decision_id,
        _SETTLE_TOOL,
        {
            "schema_version": 1,
            "request_fingerprint": fingerprint,
            "receipt": receipt,
        },
    )
    warnings = (
        []
        if status_before == "pending"
        else [
            f"entry was already recovered ({status_before}); replayed "
            "against the completed job evidence and converged without new "
            "candidate materialization beyond what was missing"
        ]
    )
    return receipt, warnings, list(_EXTRACTION_SETTLE_HINTS)


def register_operations(registry) -> None:
    global TOOLS
    TOOLS = registry.legacy_tools
    registry.tool(
    "memory.extraction_status",
    "List this campaign's semantic memory-extraction backlog: one entry per finalized turn awaiting KP settlement, each with backlog id, timeline, turn, enqueue reason, and current status, deterministically ordered. Strict read-only; explicit empty list when nothing is backlogged.",
    {},
    access="query",
    read_domains=("memory",),
    write_domains=(),
    recovery_domains=(),
    response_mode="full",
    audit_mode="reference",
    strict_read_only=True,
    execution_class="serial_campaign",
)(_tool_memory_extraction_status)
    registry.tool(
    "memory.extraction_settle",
    "Resolve exactly one pending extraction-backlog entry as the KP. Recovered routes your candidate result for that turn's job through the extraction core and materializes every verified candidate as a contract-valid assertion; abandoned records your concise reason while keeping all candidate data intact. Idempotent per decision_id; a decision id is immutable once bound to its request.",
    {
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key; immutable once bound to a settle"},
        "backlog_id": {"type": "string", "required": True, "desc": "semantic backlog id exactly as returned by memory.extraction_status"},
        "disposition": {"type": "string", "required": True, "enum": ["recovered", "abandoned"], "desc": "recovered materializes the supplied candidates; abandoned records the reason and changes nothing else"},
        "candidates": {"type": "array", "items": {"type": "object"}, "desc": "for recovered: non-empty array of candidate mappings under this job's semantic result contract (assertion_id/kind/subject_id/privacy/state/statement/valid_from_turn ...); machine provenance is attached by code"},
        "reason": {"type": "string", "desc": "for abandoned: concise KP game reason kept on the decision receipt"},
    },
    access="mutation",
    read_domains=("memory",),
    write_domains=("memory",),
    recovery_domains=(),
    response_mode="full",
    audit_mode="full",
    execution_class="serial_campaign",
)(_tool_memory_extraction_settle)


OPERATION_EXPORTS = (
    '_ABANDONED',
    '_BACKLOG_ID_RE',
    '_EXTRACTION_SETTLE_HINTS',
    '_EXTRACTION_STATUS_HINTS',
    '_RECOVERED',
    '_SETTLE_DISPOSITIONS',
    '_SETTLE_TOOL',
    '_STATUS_TOOL',
    '_apply_result_to_core',
    '_campaign_backlog',
    '_bounded',
    '_extraction_request_fingerprint',
    '_materialize_artifact_candidates',
    '_optional_reason',
    '_public_entry',
    '_rebuild_job_for_entry',
    '_require_backlog_id',
    '_require_candidates',
    '_require_decision_id',
    '_require_disposition',
    '_stored_backlog_row',
    '_tool_memory_extraction_settle',
    '_tool_memory_extraction_status',
    'coc_memory_extraction',
    'coc_temporal_memory',
    'coc_temporal_memory_contract',
)
