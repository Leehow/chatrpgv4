#!/usr/bin/env python3
"""Operation adapter cell: timeline.

Two-step KP worldline fork over the campaign Git timeline coordinator:

- ``timeline.fork_request`` — record the semantic fork intent (target
  timeline, source timeline + turn, concise game reason) as a canonical
  operation-ledger receipt only. No Git ref is created, timeline state is
  not mutated, and the active timeline never switches: a request alone is
  inert. Reuse of a ``decision_id`` under any different request fails
  closed through a machine-attached canonical fingerprint.
- ``timeline.fork_confirm`` — confirm one stored request by its semantic
  decision id. The model repeats no opaque identifiers and no source
  details: branch creation and activation are delegated exactly once to
  ``coc_git_history.fork_timeline(..., activate=True,
  created_by='kp_decision')``. The old timeline, its ref, and its commits
  stay immutable; replay is idempotent; a decision id reused against
  another request fails closed.

Model-facing surfaces stay semantic (timeline/turn/episode/reason ids);
commit SHAs, Git refs, and digests are machine-internal and never appear
in a request, a receipt, or an error.

The same cell also carries the two-step KP worldline confluence surface:

- ``timeline.confluence_query`` — strict read-only enumeration of every
  structured disagreement between two parent worldline tips. Both sides
  are projected from the rebuildable history projection through the one
  canonical read adapter
  (``coc_history_projection_query.query_authority_projection``), then the
  reviewed ``coc_timeline_confluence.enumerate_conflicts`` produces the
  complete ordered conflict list (semantic conflict ids, left/right refs
  and values, explicit zero on agreement) plus surfaced one-sided
  additions and semantic parent anchors. No sha, ref, digest, or other
  opaque machine identifier is returned.
- ``timeline.confluence_confirm`` — the serial worldline-merge mutation.
  Re-resolves both parent tips first and fails closed if either parent
  advanced since the query; recomputes the enumeration and requires
  exactly one valid disposition per conflict (pure planning via
  ``coc_timeline_confluence.build_confluence_plan``), then delegates the
  one Git merge to ``coc_git_history.confluence_timelines(...,
  activate=True)``. The merged line is a third timeline with exactly two
  distinct immutable parents; replay is bound to a canonical request
  fingerprint; and a post-commit history-projection rebuild failure never
  rolls back or rewrites canonical Git history — it returns an explicit
  warning so ``session.resume`` can rebuild later.
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

coc_git_history = _load_sibling("coc_git_history", "coc_git_history.py")

coc_history_projection = _load_sibling(
    "coc_history_projection", "coc_history_projection.py"
)

coc_history_projection_query = _load_sibling(
    "coc_history_projection_query", "coc_history_projection_query.py"
)

coc_history_projection_schema = _load_sibling(
    "coc_history_projection_schema", "coc_history_projection_schema.py"
)

coc_timeline_confluence = _load_sibling(
    "coc_timeline_confluence", "coc_timeline_confluence.py"
)

coc_state = _load_sibling("coc_state", "coc_state.py")

coc_temporal_memory_contract = _load_sibling(
    "coc_temporal_memory_contract", "coc_temporal_memory_contract.py"
)

_TIMELINE_RE = re.compile(r"^tl-[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$")
_ROOT_TIMELINE_ID = "tl-main"
_GAME_REASON_MAX = 240

_FORK_REQUEST_TOOL = "timeline.fork_request"
_FORK_CONFIRM_TOOL = "timeline.fork_confirm"
_CONFLUENCE_QUERY_TOOL = "timeline.confluence_query"
_CONFLUENCE_CONFIRM_TOOL = "timeline.confluence_confirm"

_FORK_REQUEST_HINTS = [
    "fork_request only records the intent: no branch, ref, or state "
    "changes and the active timeline stays where it is until a confirm",
    "confirm the fork with timeline.fork_confirm, passing only "
    "request_decision_id and a fresh decision_id for the confirmation",
]

_FORK_CONFIRM_HINTS = [
    "the new timeline is now active: the next turn.finalize commits land "
    "on it, and history.query on it resolves its fork-point state until "
    "it owns finalized turns",
    "the parent timeline, its ref, and its commits are immutable; every "
    "timeline keeps its own append-only history",
]

_CONFLUENCE_QUERY_HINTS = [
    "confluence_query is read-only: nothing is merged and no timeline "
    "changes until a confluence_confirm decision",
    "dispose every conflict exactly once in timeline.confluence_confirm: "
    "hard-state conflicts need a resolver_receipt, and rolls, one-time "
    "effects, consumptions, and death never accept combine/duplicate",
    "one-sided post-fork mechanics (a roll or death only one branch "
    "recorded) are conflicts with an absent marker side, not additions — "
    "decide explicitly whether each survives the merged world",
]

_CONFLUENCE_CONFIRM_HINTS = [
    "the merged timeline is now active: the next turn.finalize commits "
    "land on it, and both parent timelines stay immutable",
    "a disposition may only choose a parent side, sacrifice/defer/paradox, "
    "or (hard state only, with resolver evidence) transform content — "
    "numbers are never re-settled here",
]


def _require_decision_id(value: Any, label: str) -> str:
    token = str(value or "").strip()
    if not token:
        raise ToolError("invalid_param", f"{label} is required")
    return token


def _require_target_timeline(value: Any) -> str:
    timeline = str(value or "").strip()
    if not _TIMELINE_RE.match(timeline):
        raise ToolError(
            "invalid_param",
            "timeline must be a semantic timeline id matching tl-<slug> "
            f"for the new fork, got {value!r}",
        )
    if timeline == _ROOT_TIMELINE_ID:
        raise ToolError(
            "invalid_param",
            "tl-main is the root timeline and cannot be a fork target",
        )
    return timeline


def _require_source_timeline(value: Any) -> str:
    timeline = str(value or "").strip()
    if not _TIMELINE_RE.match(timeline):
        raise ToolError(
            "invalid_param",
            "source_timeline must be a semantic timeline id matching "
            f"tl-<slug>, got {value!r}",
        )
    return timeline


def _require_source_turn(value: Any) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < 1
    ):
        raise ToolError(
            "invalid_param",
            f"source_turn must be an integer turn number >= 1, got {value!r}",
        )
    return value


def _require_game_reason(value: Any) -> str:
    reason = str(value or "").strip()
    if not reason:
        raise ToolError("invalid_param", "game_reason is required")
    if "\n" in reason or "\r" in reason:
        raise ToolError(
            "invalid_param", "game_reason must be a single line"
        )
    if len(reason) > _GAME_REASON_MAX:
        raise ToolError(
            "invalid_param",
            f"game_reason must be concise (<= {_GAME_REASON_MAX} chars)",
        )
    return reason


def _fork_request_fingerprint(
    *,
    campaign_id: str,
    timeline_id: str,
    source_timeline_id: str,
    source_turn: int,
    game_reason: str,
) -> str:
    """Machine-attached canonical digest of the full fork request.

    Integrity evidence only: the machine stores and compares it; the model
    never reads, echoes, or produces it.
    """
    payload = json.dumps(
        [
            "timeline-fork-request-1",
            campaign_id,
            timeline_id,
            source_timeline_id,
            source_turn,
            game_reason,
        ],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _fork_confirm_fingerprint(
    *, campaign_id: str, request_decision_id: str
) -> str:
    """Machine-attached digest binding one confirm decision to its request."""
    payload = json.dumps(
        ["timeline-fork-confirm-1", campaign_id, request_decision_id],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _timeline_state(ctx: Ctx) -> dict[str, Any]:
    try:
        return coc_git_history.load_timeline_state(ctx.root, ctx.campaign_id)
    except coc_git_history.GitHistoryError as exc:
        raise ToolError(
            "invalid_state",
            f"cannot read campaign timeline metadata: {exc}",
        ) from exc


def _validate_free_target(ctx: Ctx, timeline_id: str) -> None:
    state = _timeline_state(ctx)
    existing = {
        str(row.get("timeline_id"))
        for row in state.get("timelines") or []
    }
    if timeline_id in existing:
        raise ToolError(
            "invalid_state",
            f"timeline {timeline_id} already exists in this campaign; a "
            "fork target must be a fresh semantic timeline id",
        )


def _validate_source_selector(
    ctx: Ctx, source_timeline_id: str, source_turn: int
) -> None:
    """Read-only existence check of the semantic source selector."""
    try:
        coc_git_history.resolve_history_selector(
            ctx.root,
            ctx.campaign_id,
            {"timeline_id": source_timeline_id, "turn": source_turn},
        )
    except coc_git_history.GitHistoryError as exc:
        raise ToolError(
            "invalid_state",
            f"source selector does not resolve: {exc}",
        ) from exc
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc


def _request_receipt(entry_data: Any) -> dict[str, Any]:
    """Project a stored ledger entry onto the semantic model-facing receipt."""
    if not isinstance(entry_data, dict):
        raise ToolError("invalid_state", "stored fork request is malformed")
    receipt = entry_data.get("receipt")
    if not isinstance(receipt, dict):
        raise ToolError("invalid_state", "stored fork request is malformed")
    return receipt


def _tool_timeline_fork_request(ctx: Ctx, args: dict[str, Any]):
    decision_id = _require_decision_id(args.get("decision_id"), "decision_id")
    timeline_id = _require_target_timeline(args.get("timeline"))
    source_raw = args.get("source_timeline")
    if source_raw in (None, ""):
        try:
            source_timeline_id = coc_git_history.active_timeline_id(
                ctx.root, ctx.campaign_id
            )
        except (coc_git_history.GitHistoryError, ValueError) as exc:
            raise ToolError(
                "invalid_state",
                f"cannot resolve the active source timeline: {exc}",
            ) from exc
    else:
        source_timeline_id = _require_source_timeline(source_raw)
    source_turn = _require_source_turn(args.get("source_turn"))
    game_reason = _require_game_reason(args.get("game_reason"))

    fingerprint = _fork_request_fingerprint(
        campaign_id=ctx.campaign_id,
        timeline_id=timeline_id,
        source_timeline_id=source_timeline_id,
        source_turn=source_turn,
        game_reason=game_reason,
    )
    prior = ctx.ledger_lookup(_FORK_REQUEST_TOOL, decision_id)
    if prior is not None:
        prior_data = prior.get("data")
        if (
            not isinstance(prior_data, dict)
            or prior_data.get("request_fingerprint") != fingerprint
        ):
            raise ToolError(
                "idempotency_conflict",
                f"decision_id {decision_id!r} is already bound to a "
                "different timeline.fork_request; a decision is immutable "
                "once recorded — use a fresh decision_id",
            )
        return _request_receipt(prior_data), [
            "duplicate decision_id: returning the previous receipt"
        ], list(_FORK_REQUEST_HINTS)

    # Read-only preflight: the target must be free and the semantic source
    # selector must resolve against committed history. Nothing below mutates
    # refs, timeline state, or the active pointer.
    _validate_free_target(ctx, timeline_id)
    _validate_source_selector(ctx, source_timeline_id, source_turn)

    try:
        episode_id = coc_temporal_memory_contract.episode_id_for(
            ctx.campaign_id, source_timeline_id, source_turn
        )
    except coc_temporal_memory_contract.TemporalMemoryContractError as exc:
        raise ToolError("invalid_param", str(exc)) from exc

    receipt = {
        "schema_version": 1,
        "tool": _FORK_REQUEST_TOOL,
        "decision_id": decision_id,
        "status": "requested",
        "timeline_id": timeline_id,
        "source_timeline_id": source_timeline_id,
        "source_turn": source_turn,
        "source_episode_id": episode_id,
        "game_reason": game_reason,
        "next": _FORK_CONFIRM_TOOL,
    }
    ctx.ledger_record(
        decision_id,
        _FORK_REQUEST_TOOL,
        {
            "schema_version": 1,
            "request_fingerprint": fingerprint,
            "receipt": receipt,
        },
    )
    return receipt, [], list(_FORK_REQUEST_HINTS)


def _stored_request(ctx: Ctx, request_decision_id: str) -> dict[str, Any]:
    entry = ctx.ledger_lookup(_FORK_REQUEST_TOOL, request_decision_id)
    if entry is None:
        raise ToolError(
            "invalid_state",
            f"no timeline.fork_request is recorded under decision id "
            f"{request_decision_id!r}; record the request first",
        )
    receipt = _request_receipt(entry.get("data"))
    if receipt.get("tool") != _FORK_REQUEST_TOOL or receipt.get("status") != "requested":
        raise ToolError(
            "invalid_state",
            "stored fork request is stale or malformed; record a fresh "
            "timeline.fork_request",
        )
    return receipt


def _tool_timeline_fork_confirm(ctx: Ctx, args: dict[str, Any]):
    decision_id = _require_decision_id(args.get("decision_id"), "decision_id")
    request_decision_id = _require_decision_id(
        args.get("request_decision_id"), "request_decision_id"
    )

    fingerprint = _fork_confirm_fingerprint(
        campaign_id=ctx.campaign_id,
        request_decision_id=request_decision_id,
    )
    prior = ctx.ledger_lookup(_FORK_CONFIRM_TOOL, decision_id)
    if prior is not None:
        prior_data = prior.get("data")
        if (
            not isinstance(prior_data, dict)
            or prior_data.get("confirm_fingerprint") != fingerprint
        ):
            raise ToolError(
                "idempotency_conflict",
                f"decision_id {decision_id!r} is already bound to a "
                "different timeline.fork_confirm request; a decision is "
                "immutable once recorded — use a fresh decision_id",
            )
        receipt = prior_data.get("receipt")
        if not isinstance(receipt, dict):
            raise ToolError(
                "invalid_state", "stored fork confirmation is malformed"
            )
        return receipt, [
            "duplicate decision_id: returning the previous receipt"
        ], list(_FORK_CONFIRM_HINTS)

    request = _stored_request(ctx, request_decision_id)
    timeline_id = str(request.get("timeline_id") or "")
    source_timeline_id = str(request.get("source_timeline_id") or "")
    game_reason = str(request.get("game_reason") or "")
    source_turn = request.get("source_turn")
    if (
        not _TIMELINE_RE.match(timeline_id)
        or not _TIMELINE_RE.match(source_timeline_id)
        or not game_reason
        or isinstance(source_turn, bool)
        or not isinstance(source_turn, int)
        or source_turn < 1
    ):
        raise ToolError(
            "invalid_state",
            "stored fork request is stale or malformed; record a fresh "
            "timeline.fork_request",
        )

    try:
        result = coc_git_history.fork_timeline(
            ctx.root,
            ctx.campaign_id,
            timeline_id=timeline_id,
            game_reason=game_reason,
            source_timeline_id=source_timeline_id,
            source_turn=source_turn,
            activate=True,
            created_by="kp_decision",
        )
    except coc_git_history.GitHistoryError as exc:
        raise ToolError("timeline_fork_failed", str(exc)) from exc
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc

    try:
        episode_id = str(
            result.get("episode_id")
            or coc_temporal_memory_contract.episode_id_for(
                ctx.campaign_id, source_timeline_id, source_turn
            )
        )
        active = coc_git_history.active_timeline_id(ctx.root, ctx.campaign_id)
    except (
        coc_git_history.GitHistoryError,
        coc_temporal_memory_contract.TemporalMemoryContractError,
        ValueError,
    ) as exc:
        raise ToolError(
            "invalid_state",
            f"fork landed but the campaign timeline metadata is now "
            f"unreadable: {exc}",
        ) from exc
    if active != timeline_id:
        raise ToolError(
            "invalid_state",
            f"fork landed but the active timeline is {active!r}, not the "
            f"new timeline {timeline_id!r}",
        )

    receipt = {
        "schema_version": 1,
        "tool": _FORK_CONFIRM_TOOL,
        "decision_id": decision_id,
        "request_decision_id": request_decision_id,
        "timeline_id": timeline_id,
        "source_timeline_id": source_timeline_id,
        "source_turn": source_turn,
        "source_episode_id": episode_id,
        "game_reason": game_reason,
        "activated": True,
        "active_timeline_id": active,
        "idempotent": bool(result.get("idempotent")),
    }
    ctx.ledger_record(
        decision_id,
        _FORK_CONFIRM_TOOL,
        {
            "schema_version": 1,
            "confirm_fingerprint": fingerprint,
            "receipt": receipt,
        },
    )
    return receipt, [], list(_FORK_CONFIRM_HINTS)


def _timeline_record(ctx: Ctx, timeline_id: str) -> dict[str, Any] | None:
    state = _timeline_state(ctx)
    return next(
        (
            row
            for row in state.get("timelines") or []
            if isinstance(row, dict) and row.get("timeline_id") == timeline_id
        ),
        None,
    )


def _own_latest_turn(ctx: Ctx, timeline_id: str) -> int | None:
    """Latest finalized turn a timeline owns in the projection, or None.

    Fails closed on an ambiguous latest turn: the caller must never guess
    which commit is the tip.
    """
    import sqlite3

    try:
        connection = coc_history_projection_schema.open_projection_db(
            ctx.root, ctx.campaign_id
        )
    except coc_history_projection_schema.HistoryProjectionError as exc:
        raise ToolError(
            "invalid_state",
            f"history projection is unavailable: {exc}",
        ) from exc
    try:
        try:
            rows = connection.execute(
                "SELECT turn_number FROM commits"
                " WHERE timeline_id = ? AND turn_number IS NOT NULL",
                (timeline_id,),
            ).fetchall()
        except sqlite3.Error as exc:
            raise ToolError(
                "invalid_state",
                f"cannot read history projection: {exc}",
            ) from exc
    finally:
        connection.close()
    turns = [int(row["turn_number"]) for row in rows]
    if not turns:
        return None
    latest = max(turns)
    if turns.count(latest) > 1:
        raise ToolError(
            "invalid_state",
            f"timeline {timeline_id!r} has {turns.count(latest)} commits at "
            f"turn {latest}; its latest turn is ambiguous",
        )
    return latest


def _resolve_semantic_tip(
    ctx: Ctx, timeline_id: str, *, _depth: int = 0
) -> dict[str, Any]:
    """Resolve one timeline's current semantic tip as (owner, turn).

    A timeline that owns finalized turns tips at its latest own turn. A
    fresh fork (or confluence line) that owns none yet resolves through
    timeline metadata only — its inherited fork point on its first parent
    — never through a commit sha. Semantic alias resolution only; no
    prose or keyword inference.
    """
    own_turn = _own_latest_turn(ctx, timeline_id)
    if own_turn is not None:
        return {"owner_timeline_id": timeline_id, "turn_number": own_turn}
    if _depth >= 8:
        raise ToolError(
            "invalid_state",
            f"timeline {timeline_id!r} cannot be resolved to a settled tip: "
            "its fork chain owns no finalized turns",
        )
    record = _timeline_record(ctx, timeline_id)
    if record is None:
        raise ToolError(
            "invalid_state",
            f"timeline {timeline_id!r} is not registered and owns no "
            "finalized turns in the history projection",
        )
    fork_point = record.get("fork_point") or {}
    parents = record.get("parents") or []
    turn = fork_point.get("turn")
    parent = parents[0] if parents else None
    if (
        isinstance(turn, bool)
        or not isinstance(turn, int)
        or turn < 1
        or not isinstance(parent, str)
        or not parent.strip()
    ):
        raise ToolError(
            "invalid_state",
            f"timeline {timeline_id!r} owns no finalized turns and carries "
            "no resolvable fork point",
        )
    return _resolve_semantic_tip(ctx, parent.strip(), _depth=_depth + 1)


def _lineage_projection(
    ctx: Ctx, timeline_id: str
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Closed authority projection of one timeline's tip + its tip anchor."""
    tip = _resolve_semantic_tip(ctx, timeline_id)
    try:
        projection = coc_history_projection_query.query_authority_projection(
            ctx.root,
            ctx.campaign_id,
            timeline_id=tip["owner_timeline_id"],
            turn_number=tip["turn_number"],
            projection_timeline_id=timeline_id,
        )
    except coc_history_projection_schema.HistoryProjectionError as exc:
        raise ToolError(
            "invalid_state",
            f"cannot project the history of timeline {timeline_id!r}: {exc}",
        ) from exc
    return projection, tip


def _require_confluence_id(campaign_id: str, timeline_id: str) -> str:
    confluence_id = f"confluence-{campaign_id}-{timeline_id}"
    try:
        coc_temporal_memory_contract._check_semantic_id(
            confluence_id,
            kind="confluence",
            field="confluence_id",
            prefix=coc_temporal_memory_contract.ID_PREFIX["confluence"],
        )
    except coc_temporal_memory_contract.TemporalMemoryContractError as exc:
        raise ToolError(
            "invalid_param",
            f"timeline {timeline_id!r} cannot seed a valid semantic "
            f"confluence id in this campaign: {exc}",
        ) from exc
    return confluence_id


def _confluence_parents(args: dict[str, Any]) -> tuple[str, str, str]:
    """Validate (target, left, right) timeline ids as a third-line merge."""
    timeline_id = _require_target_timeline(args.get("timeline"))
    left_timeline = _require_source_timeline(args.get("left_timeline"))
    right_timeline = _require_source_timeline(args.get("right_timeline"))
    if left_timeline == right_timeline:
        raise ToolError(
            "invalid_param",
            "a confluence merges two distinct timelines; pass different "
            f"left_timeline and right_timeline ids (got {left_timeline!r} "
            "twice)",
        )
    if timeline_id in (left_timeline, right_timeline):
        raise ToolError(
            "invalid_param",
            "the merged timeline must be a third timeline, not one of its "
            f"parents (got {timeline_id!r})",
        )
    return timeline_id, left_timeline, right_timeline


def _public_conflict(conflict: dict[str, Any]) -> dict[str, Any]:
    """Project one conflict record onto the semantic model-facing surface.

    Contract flags come from the frozen contract constants; digests and
    machine handles never appear (the enumeration digest is integrity
    evidence for the machine only).
    """
    conflict_class = str(conflict.get("class"))
    return {
        "conflict_id": conflict.get("conflict_id"),
        "class": conflict_class,
        "hard_state": (
            conflict_class
            in coc_temporal_memory_contract.HARD_STATE_CONFLICT_CLASSES
        ),
        "non_duplicable": (
            conflict_class
            in coc_temporal_memory_contract.NON_DUPLICABLE_CONFLICT_CLASSES
        ),
        "left": conflict.get("left"),
        "right": conflict.get("right"),
        "disposition": conflict.get("disposition"),
    }


def _tool_timeline_confluence_query(ctx: Ctx, args: dict[str, Any]):
    timeline_id, left_timeline, right_timeline = _confluence_parents(args)
    confluence_id = _require_confluence_id(ctx.campaign_id, timeline_id)
    _validate_free_target(ctx, timeline_id)

    left_projection, left_tip = _lineage_projection(ctx, left_timeline)
    right_projection, right_tip = _lineage_projection(ctx, right_timeline)
    try:
        enumeration = coc_timeline_confluence.enumerate_conflicts(
            left_projection,
            right_projection,
            confluence_id=confluence_id,
        )
    except coc_timeline_confluence.ConfluenceConflictError as exc:
        raise ToolError(
            "invalid_param", f"confluence enumeration failed: {exc}"
        ) from exc

    conflicts = [
        _public_conflict(conflict)
        for conflict in enumeration.get("conflicts") or []
    ]
    additions = enumeration.get("additions") or {}
    left_only = list(additions.get("left_only") or [])
    right_only = list(additions.get("right_only") or [])
    data = {
        "schema_version": 1,
        "tool": _CONFLUENCE_QUERY_TOOL,
        "confluence_id": confluence_id,
        "campaign_id": ctx.campaign_id,
        "timeline_id": timeline_id,
        "parents": [
            {"timeline_id": left_timeline, "turn_number": left_tip["turn_number"]},
            {"timeline_id": right_timeline, "turn_number": right_tip["turn_number"]},
        ],
        "conflict_count": len(conflicts),
        "conflicts": conflicts,
        "additions": {"left_only": left_only, "right_only": right_only},
        "addition_counts": {
            "left_only": len(left_only),
            "right_only": len(right_only),
        },
        "next": _CONFLUENCE_CONFIRM_TOOL,
    }
    hints = list(_CONFLUENCE_QUERY_HINTS)
    if not conflicts:
        hints.append(
            "the two tips agree on every structured value: a confluence "
            "confirm would carry zero dispositions and still merge the "
            "worldlines"
        )
    return data, [], hints


def _require_dispositions(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ToolError(
            "invalid_param",
            "dispositions must be a mapping of conflict id -> "
            "{mode, receipt, resolver_receipt?, note?} exactly as returned "
            "by timeline.confluence_query (a zero-conflict confluence "
            "passes an empty mapping)",
        )
    for conflict_id, disposition in value.items():
        if not isinstance(conflict_id, str) or not conflict_id.strip():
            raise ToolError(
                "invalid_param", "dispositions keys must be conflict ids"
            )
        if not isinstance(disposition, dict):
            raise ToolError(
                "invalid_param",
                f"disposition for conflict {conflict_id!r} must be a mapping",
            )
    return value


def _require_path_resolutions(value: Any) -> dict[str, Any]:
    if value in (None, ""):
        return {}
    if not isinstance(value, dict):
        raise ToolError(
            "invalid_param",
            "path_resolutions must be a mapping of tracked file path -> "
            "content resolution",
        )
    return value


def _confluence_confirm_fingerprint(
    *,
    campaign_id: str,
    timeline_id: str,
    left_timeline_id: str,
    right_timeline_id: str,
    left_turn: int,
    right_turn: int,
    dispositions: dict[str, Any],
    path_resolutions: dict[str, Any],
    game_reason: str,
) -> str:
    """Machine-attached canonical digest of the whole confirm request.

    Integrity evidence only: the machine stores and compares it; the model
    never reads, echoes, or produces it.
    """
    payload = json.dumps(
        [
            "timeline-confluence-confirm-1",
            campaign_id,
            timeline_id,
            left_timeline_id,
            right_timeline_id,
            left_turn,
            right_turn,
            dispositions,
            path_resolutions,
            game_reason,
        ],
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _tool_timeline_confluence_confirm(ctx: Ctx, args: dict[str, Any]):
    decision_id = _require_decision_id(args.get("decision_id"), "decision_id")
    timeline_id, left_timeline, right_timeline = _confluence_parents(args)
    left_turn = _require_source_turn(args.get("left_turn"))
    right_turn = _require_source_turn(args.get("right_turn"))
    dispositions = _require_dispositions(args.get("dispositions"))
    path_resolutions = _require_path_resolutions(args.get("path_resolutions"))
    game_reason = _require_game_reason(args.get("game_reason"))
    confluence_id = _require_confluence_id(ctx.campaign_id, timeline_id)

    fingerprint = _confluence_confirm_fingerprint(
        campaign_id=ctx.campaign_id,
        timeline_id=timeline_id,
        left_timeline_id=left_timeline,
        right_timeline_id=right_timeline,
        left_turn=left_turn,
        right_turn=right_turn,
        dispositions=dispositions,
        path_resolutions=path_resolutions,
        game_reason=game_reason,
    )
    prior = ctx.ledger_lookup(_CONFLUENCE_CONFIRM_TOOL, decision_id)
    if prior is not None:
        prior_data = prior.get("data")
        if (
            not isinstance(prior_data, dict)
            or prior_data.get("confirm_fingerprint") != fingerprint
        ):
            raise ToolError(
                "idempotency_conflict",
                f"decision_id {decision_id!r} is already bound to a "
                "different timeline.confluence_confirm request; a decision "
                "is immutable once recorded — use a fresh decision_id",
            )
        receipt = prior_data.get("receipt")
        if not isinstance(receipt, dict):
            raise ToolError(
                "invalid_state", "stored confluence confirmation is malformed"
            )
        return receipt, [
            "duplicate decision_id: returning the previous receipt"
        ], list(_CONFLUENCE_CONFIRM_HINTS)

    # Fail closed before any mutation when either parent advanced since the
    # query the KP is confirming: the dispositions were enumerated against
    # the recorded anchors and must never be applied to moved tips.
    _validate_free_target(ctx, timeline_id)
    left_tip = _resolve_semantic_tip(ctx, left_timeline)
    right_tip = _resolve_semantic_tip(ctx, right_timeline)
    for side, tip, anchored in (
        ("left", left_tip, left_turn),
        ("right", right_tip, right_turn),
    ):
        if tip["turn_number"] != anchored:
            raise ToolError(
                "invalid_state",
                f"{side} parent timeline {tip['owner_timeline_id']!r} is at "
                f"turn {tip['turn_number']}, not the queried turn {anchored}; "
                "the parent advanced since timeline.confluence_query — "
                "re-run the query and dispose against the current anchors",
            )

    left_projection = coc_history_projection_query.query_authority_projection(
        ctx.root,
        ctx.campaign_id,
        timeline_id=left_tip["owner_timeline_id"],
        turn_number=left_tip["turn_number"],
        projection_timeline_id=left_timeline,
    )
    right_projection = coc_history_projection_query.query_authority_projection(
        ctx.root,
        ctx.campaign_id,
        timeline_id=right_tip["owner_timeline_id"],
        turn_number=right_tip["turn_number"],
        projection_timeline_id=right_timeline,
    )
    schema_generation = coc_git_history.format_schema_generation(
        dict(coc_state.CURRENT_SCHEMA_VERSIONS)
    )
    try:
        plan = coc_timeline_confluence.build_confluence_plan(
            campaign_id=ctx.campaign_id,
            timeline_id=timeline_id,
            left_projection=left_projection,
            right_projection=right_projection,
            dispositions=dispositions,
            receipt=f"{confluence_id} decision {decision_id}",
            schema_generation=schema_generation,
            confluence_id=confluence_id,
            created_by="confluence",
            game_reason=game_reason,
            path_resolutions=path_resolutions,
            activate=True,
        )
    except coc_timeline_confluence.ConfluenceConflictError as exc:
        raise ToolError(
            "invalid_param", f"confluence plan is invalid: {exc}"
        ) from exc

    try:
        result = coc_git_history.confluence_timelines(
            ctx.root,
            ctx.campaign_id,
            **plan["git_history_arguments"],
        )
    except coc_git_history.GitHistoryError as exc:
        raise ToolError("timeline_confluence_failed", str(exc)) from exc
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc

    try:
        active = coc_git_history.active_timeline_id(ctx.root, ctx.campaign_id)
    except (coc_git_history.GitHistoryError, ValueError) as exc:
        raise ToolError(
            "invalid_state",
            f"confluence landed but the campaign timeline metadata is now "
            f"unreadable: {exc}",
        ) from exc
    if active != timeline_id:
        raise ToolError(
            "invalid_state",
            f"confluence landed but the active timeline is {active!r}, not "
            f"the merged timeline {timeline_id!r}",
        )

    # The rebuildable cache is refreshed after the canonical commit. A
    # rebuild failure never rolls back or rewrites Git history: surface an
    # explicit warning so session.resume rebuilds it later.
    warnings: list[str] = []
    projection_status = "rebuilt"
    try:
        coc_history_projection.rebuild_history_projection(
            ctx.root, ctx.campaign_id
        )
    except (coc_history_projection.HistoryProjectionError, OSError) as exc:
        projection_status = "stale"
        warnings.append(
            "the confluence commit landed but the history projection rebuild "
            f"failed ({exc}); canonical Git history is unchanged — "
            "session.resume will rebuild the projection later"
        )

    resolved = plan.get("conflicts") or []
    receipt = {
        "schema_version": 1,
        "tool": _CONFLUENCE_CONFIRM_TOOL,
        "decision_id": decision_id,
        "confluence_id": confluence_id,
        "campaign_id": ctx.campaign_id,
        "timeline_id": timeline_id,
        "parents": [
            {"timeline_id": left_timeline, "turn_number": left_turn},
            {"timeline_id": right_timeline, "turn_number": right_turn},
        ],
        "conflict_count": len(resolved),
        "disposition_receipts": [
            {
                "conflict_id": conflict.get("conflict_id"),
                "mode": (conflict.get("disposition") or {}).get("mode"),
                "receipt": (conflict.get("disposition") or {}).get("receipt"),
            }
            for conflict in resolved
        ],
        "activated": True,
        "active_timeline_id": active,
        "projection": {"status": projection_status},
        "idempotent": bool(result.get("idempotent")),
    }
    ctx.ledger_record(
        decision_id,
        _CONFLUENCE_CONFIRM_TOOL,
        {
            "schema_version": 1,
            "confirm_fingerprint": fingerprint,
            "receipt": receipt,
        },
    )
    return receipt, warnings, list(_CONFLUENCE_CONFIRM_HINTS)


def register_operations(registry) -> None:
    global TOOLS
    TOOLS = registry.legacy_tools
    registry.tool(
    "timeline.fork_request",
    "Record the KP's intent to fork the campaign worldline at one settled turn. Persists a request receipt only: no Git branch is created, no timeline state changes, and the active timeline never switches. Confirm separately with timeline.fork_confirm.",
    {
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key; immutable once bound to a request"},
        "timeline": {"type": "string", "required": True, "desc": "fresh semantic id for the new timeline (tl-<slug>); must not exist yet"},
        "source_timeline": {"type": "string", "desc": "timeline to fork from (tl-<slug>); defaults to the campaign's active timeline"},
        "source_turn": {"type": "integer", "required": True, "desc": "settled turn number on the source timeline to fork at"},
        "game_reason": {"type": "string", "required": True, "desc": "concise single-line KP game reason for the fork"},
    },
    access="mutation",
    read_domains=("history",),
    write_domains=("timeline",),
    recovery_domains=(),
    response_mode="full",
    audit_mode="full",
    execution_class="serial_campaign",
)(_tool_timeline_fork_request)
    registry.tool(
    "timeline.fork_confirm",
    "Confirm one recorded timeline.fork_request by its decision id: create the new timeline branch at the stored fork point, make it the active timeline (the next turn.finalize lands there), and keep the parent timeline immutable. Idempotent per decision_id; no opaque identifiers are ever echoed.",
    {
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key for this confirmation; immutable once bound"},
        "request_decision_id": {"type": "string", "required": True, "desc": "decision id of the stored timeline.fork_request being confirmed"},
    },
    access="mutation",
    read_domains=("history",),
    write_domains=("timeline",),
    recovery_domains=(),
    response_mode="full",
    audit_mode="full",
    execution_class="serial_campaign",
)(_tool_timeline_fork_confirm)
    registry.tool(
    "timeline.confluence_query",
    "Enumerate every structured disagreement between two parent worldline tips for a KP confluence (worldline merge): complete ordered conflict list with semantic conflict ids, one-sided post-fork non-duplicable mechanics as explicit conflicts, surfaced additions, and semantic parent anchors. Strict read-only; no branch, ref, or state changes.",
    {
        "timeline": {"type": "string", "required": True, "desc": "fresh semantic id for the merged third timeline (tl-<slug>); must not exist yet"},
        "left_timeline": {"type": "string", "required": True, "desc": "first parent worldline (tl-<slug>)"},
        "right_timeline": {"type": "string", "required": True, "desc": "second parent worldline (tl-<slug>); must differ from left_timeline"},
    },
    access="query",
    read_domains=("history",),
    write_domains=(),
    recovery_domains=(),
    response_mode="full",
    audit_mode="reference",
    strict_read_only=True,
    execution_class="serial_campaign",
)(_tool_timeline_confluence_query)
    registry.tool(
    "timeline.confluence_confirm",
    "Merge two parent worldlines into the new third timeline and activate it, applying exactly one receipted disposition per enumerated conflict. Fails closed when a parent advanced since the query; parents stay immutable; replay is idempotent per decision_id. The next turn.finalize lands on the merged line.",
    {
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key; immutable once bound to a confirm"},
        "timeline": {"type": "string", "required": True, "desc": "semantic id of the merged third timeline, exactly as passed to timeline.confluence_query"},
        "left_timeline": {"type": "string", "required": True, "desc": "first parent worldline"},
        "right_timeline": {"type": "string", "required": True, "desc": "second parent worldline"},
        "left_turn": {"type": "integer", "required": True, "desc": "left parent anchor turn exactly as returned by timeline.confluence_query"},
        "right_turn": {"type": "integer", "required": True, "desc": "right parent anchor turn exactly as returned by timeline.confluence_query"},
        "dispositions": {"type": "object", "required": True, "desc": "complete mapping conflict id -> {mode, receipt, resolver_receipt?, note?}; every enumerated conflict exactly once"},
        "path_resolutions": {"type": "object", "desc": "optional per-file canonical resolver content for transform/combine/duplicate dispositions"},
        "game_reason": {"type": "string", "required": True, "desc": "concise single-line KP game reason for the merge"},
    },
    access="mutation",
    read_domains=("history",),
    write_domains=("timeline",),
    recovery_domains=(),
    response_mode="full",
    audit_mode="full",
    execution_class="serial_campaign",
)(_tool_timeline_confluence_confirm)


OPERATION_EXPORTS = (
    '_CONFLUENCE_CONFIRM_HINTS',
    '_CONFLUENCE_CONFIRM_TOOL',
    '_CONFLUENCE_QUERY_HINTS',
    '_CONFLUENCE_QUERY_TOOL',
    '_FORK_CONFIRM_HINTS',
    '_FORK_CONFIRM_TOOL',
    '_FORK_REQUEST_HINTS',
    '_FORK_REQUEST_TOOL',
    '_confluence_confirm_fingerprint',
    '_confluence_parents',
    '_fork_confirm_fingerprint',
    '_fork_request_fingerprint',
    '_lineage_projection',
    '_own_latest_turn',
    '_public_conflict',
    '_require_confluence_id',
    '_require_dispositions',
    '_require_path_resolutions',
    '_require_decision_id',
    '_require_game_reason',
    '_require_source_timeline',
    '_require_source_turn',
    '_require_target_timeline',
    '_request_receipt',
    '_stored_request',
    '_timeline_record',
    '_tool_timeline_confluence_confirm',
    '_tool_timeline_confluence_query',
    '_tool_timeline_fork_confirm',
    '_tool_timeline_fork_request',
    '_validate_free_target',
    '_validate_source_selector',
    'coc_git_history',
    'coc_history_projection',
    'coc_history_projection_query',
    'coc_history_projection_schema',
    'coc_state',
    'coc_timeline_confluence',
    'coc_temporal_memory_contract',
)
