#!/usr/bin/env python3
"""Operation adapter cell: temporal-history.

First canonical Pi-Coc host-integration slice for the git temporal memory
and worldline kernel:

- ``history.query`` / ``history.diff`` — strict read-only views over the
  already-built authority history projection
  (``coc_history_projection_query``). Model-facing selectors stay semantic
  (timeline id + turn number); commit shas and digests are machine-internal
  and never appear on the typed input surface or in the returned commit
  records. Projection errors map to structured ``ToolError`` without
  rebuilding or mutating anything inside a query.
- ``memory.recall`` — deterministic narrowing over the canonical temporal
  assertions and subject binding records through the reviewed
  ``coc_temporal_retrieval`` closed context. Semantic relevance and
  adoption stay with the KP; memory is advisory, never authoritative.
- ``memory.adjudicate`` — KP accept/modify/reject of one candidate via
  ``coc_temporal_memory.adjudicate_candidate``. Operation-level ledger
  replay plus the underlying request fingerprint reject semantic reuse of
  a ``decision_id``; old assertions are never edited or deleted.

This cell never consults legacy ``coc_memory`` cards. Their former
model-facing operations (``memory.search``/``memory.write``/
``memory.resolve_hook``) have been retired from the registry entirely;
``coc_memory`` internals remain available to non-model callers only.
"""
from __future__ import annotations

from coc_operation_kernel_runtime import (
    Any,
    Ctx,
    ToolError,
    _load_sibling,
    re,
    tool,
)

coc_git_history = _load_sibling("coc_git_history", "coc_git_history.py")

coc_history_projection_schema = _load_sibling(
    "coc_history_projection_schema", "coc_history_projection_schema.py"
)

coc_history_projection_query = _load_sibling(
    "coc_history_projection_query", "coc_history_projection_query.py"
)

coc_temporal_memory = _load_sibling(
    "coc_temporal_memory", "coc_temporal_memory.py"
)

coc_temporal_retrieval = _load_sibling(
    "coc_temporal_retrieval", "coc_temporal_retrieval.py"
)

coc_temporal_memory_contract = _load_sibling(
    "coc_temporal_memory_contract", "coc_temporal_memory_contract.py"
)

# Machine-internal commit handles never appear on the model-facing surface:
# selectors are semantic timeline/turn pairs, and returned commit records
# carry only semantic identity fields (timeline, turn, type, finalization,
# ordinal). Digests and shas stay machine-attached integrity evidence.
_TIMELINE_RE = re.compile(r"^tl-[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$")

_HISTORY_QUERY_HINTS = [
    "history.query reads the rebuildable projection of committed history; "
    "state.*/rules.* remain the live authority for the current turn",
]

_HISTORY_DIFF_HINTS = [
    "history.diff is a structured leaf-level comparison between two settled "
    "turns; interpreting what the changes mean for play stays with the KP",
]


def _require_timeline(value: Any, label: str) -> str:
    timeline = str(value or "").strip()
    if not _TIMELINE_RE.match(timeline):
        raise ToolError(
            "invalid_param",
            f"{label} must be a semantic timeline id matching tl-<slug>, "
            f"got {value!r}",
        )
    return timeline


def _resolve_timeline(ctx: Ctx, args: dict[str, Any]) -> str:
    """Resolve the requested timeline, defaulting to the campaign's canonical
    active timeline metadata. Never guesses a turn."""
    raw = args.get("timeline")
    if raw in (None, ""):
        try:
            state = coc_git_history.load_timeline_state(
                ctx.root, ctx.campaign_id
            )
        except coc_git_history.GitHistoryError as exc:
            raise ToolError(
                "invalid_state",
                f"cannot read campaign timeline metadata: {exc}",
            ) from exc
        active = state.get("active_timeline_id")
        if not isinstance(active, str) or not active.strip():
            raise ToolError(
                "invalid_state",
                "campaign timeline metadata carries no active_timeline_id; "
                "pass an explicit timeline",
            )
        return active.strip()
    return _require_timeline(raw, "timeline")


def _require_turn(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ToolError(
            "invalid_param",
            f"{label} must be a non-negative integer turn number, "
            f"got {value!r}",
        )
    return value


def _timeline_turns(ctx: Ctx, timeline_id: str) -> list[int]:
    """Deterministically list the finalized turns on one timeline."""
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
    return [int(row["turn_number"]) for row in rows]


def _latest_turn(ctx: Ctx, timeline_id: str) -> int:
    """Deterministically resolve the latest turn on one timeline.

    Never guesses: a missing history or two commits sharing the newest turn
    fails closed and asks for an explicit turn."""
    turns = _timeline_turns(ctx, timeline_id)
    if not turns:
        raise ToolError(
            "invalid_state",
            f"no finalized turns on timeline {timeline_id!r} in the history "
            "projection",
        )
    latest = max(turns)
    if turns.count(latest) > 1:
        raise ToolError(
            "invalid_state",
            f"timeline {timeline_id!r} has {turns.count(latest)} commits at "
            f"turn {latest}; the latest turn is ambiguous — pass an explicit "
            "turn",
        )
    return latest


def _fork_point_of(ctx: Ctx, timeline_id: str) -> dict[str, Any] | None:
    """Semantic fork point of a timeline, from timeline metadata only.

    A freshly forked timeline owns no turn commits of its own yet: its
    state is the fork point it inherited from its parent. This resolves
    that point as (parent timeline, turn) — never a commit sha — so the
    model-facing query path never needs or exposes the source commit.
    """
    try:
        state = coc_git_history.load_timeline_state(
            ctx.root, ctx.campaign_id
        )
    except coc_git_history.GitHistoryError as exc:
        raise ToolError(
            "invalid_state",
            f"cannot read campaign timeline metadata: {exc}",
        ) from exc
    record = next(
        (
            row
            for row in state.get("timelines") or []
            if row.get("timeline_id") == timeline_id
        ),
        None,
    )
    if not isinstance(record, dict) or record.get("kind") != "fork":
        return None
    fork_point = record.get("fork_point") or {}
    parents = record.get("parents") or []
    turn = fork_point.get("turn")
    parent = parents[0] if parents else None
    if (
        isinstance(turn, bool)
        or not isinstance(turn, int)
        or turn < 1
        or not isinstance(parent, str)
    ):
        return None
    return {"source_timeline_id": parent, "turn": turn}


def _public_commit(commit: dict[str, Any]) -> dict[str, Any]:
    """Project one projection commit record onto semantic model-facing
    fields; shas, parents, tree digests, and file blobs stay internal."""
    return {
        "timeline_id": commit.get("timeline_id"),
        "turn_number": commit.get("turn_number"),
        "commit_type": commit.get("commit_type"),
        "finalization_id": commit.get("finalization_id"),
        "ordinal": commit.get("ordinal"),
    }


def _tool_history_query(ctx: Ctx, args: dict[str, Any]):
    timeline_id = _resolve_timeline(ctx, args)
    turn = args.get("turn")
    explicit = turn is not None
    if explicit:
        turn = _require_turn(turn, "turn")
    turns = _timeline_turns(ctx, timeline_id)
    fork_point: dict[str, Any] | None = None
    if (explicit and turn not in turns) or (not explicit and not turns):
        # A freshly forked timeline owns no turn commits yet: resolve its
        # inherited fork-point state semantically through timeline metadata
        # instead of failing or exposing the source commit.
        fork_point = _fork_point_of(ctx, timeline_id)
        if fork_point is None or (explicit and turn != fork_point["turn"]):
            if explicit:
                raise ToolError(
                    "invalid_state",
                    f"no turn {turn} on timeline {timeline_id!r} in the "
                    "history projection",
                )
            raise ToolError(
                "invalid_state",
                f"no finalized turns on timeline {timeline_id!r} in the "
                "history projection",
            )
        query_timeline = fork_point["source_timeline_id"]
        query_turn = fork_point["turn"]
    else:
        query_timeline = timeline_id
        query_turn = _latest_turn(ctx, timeline_id) if not explicit else turn
    try:
        result = coc_history_projection_query.query_history_at(
            ctx.root,
            ctx.campaign_id,
            timeline_id=query_timeline,
            turn_number=query_turn,
        )
    except coc_history_projection_schema.HistoryProjectionError as exc:
        raise ToolError(
            "invalid_state", f"history projection query failed: {exc}"
        ) from exc
    snapshots = {
        str(path): {"state": row.get("state")}
        for path, row in sorted((result.get("snapshots") or {}).items())
    }
    data: dict[str, Any] = {
        "schema_version": 1,
        "authority": "structured_state",
        "timeline_id": timeline_id,
        "turn_number": query_turn,
        "commit": _public_commit(result.get("commit") or {}),
        "snapshot_count": len(snapshots),
        "snapshots": snapshots,
    }
    hints = list(_HISTORY_QUERY_HINTS)
    if fork_point is not None:
        data["fork_point"] = {
            "timeline_id": fork_point["source_timeline_id"],
            "turn_number": fork_point["turn"],
        }
        hints.append(
            f"timeline {timeline_id!r} has no finalized turns of its own "
            "yet; this is the fork-point state inherited from timeline "
            f"{fork_point['source_timeline_id']!r}"
        )
    return data, [], hints


def _tool_history_diff(ctx: Ctx, args: dict[str, Any]):
    default_timeline = _resolve_timeline(ctx, args)
    from_raw, to_raw = args.get("from_timeline"), args.get("to_timeline")
    from_timeline = (
        _require_timeline(from_raw, "from_timeline")
        if from_raw not in (None, "")
        else default_timeline
    )
    to_timeline = (
        _require_timeline(to_raw, "to_timeline")
        if to_raw not in (None, "")
        else default_timeline
    )
    from_turn = _require_turn(args.get("from_turn"), "from_turn")
    to_turn = _require_turn(args.get("to_turn"), "to_turn")
    try:
        result = coc_history_projection_query.query_history_diff(
            ctx.root,
            ctx.campaign_id,
            {"timeline_id": from_timeline, "turn_number": from_turn},
            {"timeline_id": to_timeline, "turn_number": to_turn},
        )
    except coc_history_projection_schema.HistoryProjectionError as exc:
        raise ToolError(
            "invalid_state", f"history projection diff failed: {exc}"
        ) from exc
    changes = list(result.get("changes") or [])
    data = {
        "schema_version": 1,
        "authority": "structured_state",
        "from_commit": _public_commit(result.get("from_commit") or {}),
        "to_commit": _public_commit(result.get("to_commit") or {}),
        "change_count": len(changes),
        "changes": changes,
    }
    return data, [], list(_HISTORY_DIFF_HINTS)


def _optional_str(args: dict[str, Any], key: str) -> str | None:
    value = args.get(key)
    if value in (None, ""):
        return None
    return str(value)


def _tool_memory_recall(ctx: Ctx, args: dict[str, Any]):
    timeline_id = _resolve_timeline(ctx, args)
    turn = _optional_turn(args)
    entities = args.get("entities")
    if entities is not None and (
        isinstance(entities, (str, bytes)) or not isinstance(entities, list)
    ):
        raise ToolError("invalid_param", "entities must be an array of entity- ids")
    kinds = args.get("kinds")
    if kinds is not None and (
        isinstance(kinds, (str, bytes)) or not isinstance(kinds, list)
    ):
        raise ToolError(
            "invalid_param", "kinds must be an array of assertion kinds"
        )
    # Read-only load of the canonical temporal store. The legacy card store
    # (coc_memory) is never consulted, and no store is bootstrapped here:
    # a query never writes.
    assertions = list(
        coc_temporal_memory.load_assertions(ctx.campaign_dir).values()
    )
    subjects = list(
        coc_temporal_memory.load_subjects(ctx.campaign_dir).values()
    )
    try:
        context = coc_temporal_retrieval.build_recall_context(
            subject_id=_optional_str(args, "subject_id"),
            timeline_id=timeline_id,
            turn_number=turn,
            entities=[str(item) for item in (entities or [])],
            scene_id=_optional_str(args, "scene"),
            privacy=str(args.get("view") or "keeper"),
            campaign_id=ctx.campaign_id,
            kinds=[str(item) for item in (kinds or [])],
            include_superseded=bool(args.get("include_superseded")),
            limit=args.get("limit"),
            identity_bindings=subjects,
        )
        envelope = coc_temporal_retrieval.build_warm_projection(
            assertions, context
        )
    except coc_temporal_retrieval.TemporalRetrievalError as exc:
        raise ToolError(
            "invalid_param",
            f"memory.recall context is invalid: {exc}",
        ) from exc
    return envelope, [], [
        "recall is deterministic advisory narrowing; which candidates matter "
        "is your semantic judgment, and adoption happens only through "
        "memory.adjudicate",
        "memory is never authoritative truth; state.*/rules.* own hard facts",
        "privacy is enforced by the view: player_safe never returns "
        "keeper_only rows",
    ]


def _optional_turn(args: dict[str, Any]) -> int | None:
    turn = args.get("turn")
    if turn in (None, ""):
        return None
    return _require_turn(turn, "turn")


def _tool_memory_adjudicate(ctx: Ctx, args: dict[str, Any]):
    tool_name = "memory.adjudicate"
    decision_id = str(args.get("decision_id") or "").strip()
    if not decision_id:
        raise ToolError("invalid_param", "decision_id is required")
    candidate_id = str(args.get("candidate_id") or "").strip()
    if not candidate_id:
        raise ToolError("invalid_param", "candidate_id is required")
    action = str(args.get("action") or "")
    if action not in coc_temporal_memory.ADJUDICATION_ACTIONS:
        raise ToolError(
            "invalid_param",
            "action must be one of "
            + ", ".join(coc_temporal_memory.ADJUDICATION_ACTIONS)
            + f", got {action!r}",
        )
    statement = _optional_str(args, "statement")
    kind = _optional_str(args, "kind")
    subject_id = _optional_str(args, "subject_id")
    privacy = _optional_str(args, "privacy")
    state = _optional_str(args, "state")

    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        prior_receipt = (
            prior.get("data") if isinstance(prior.get("data"), dict) else {}
        )
        # Operation-level replay guard on top of the underlying request
        # fingerprint: the same decision_id may replay only the byte-equal
        # request. Semantic reuse of a decision id fails closed.
        expected = coc_temporal_memory._adjudication_request_fingerprint(
            candidate_id,
            action,
            statement=statement,
            kind=kind,
            subject_id=subject_id,
            privacy=privacy,
            state=state,
        )
        if prior_receipt.get("request_fingerprint") != expected:
            raise ToolError(
                "idempotency_conflict",
                f"decision_id {decision_id!r} is already bound to a "
                "different memory.adjudicate request; a decision is "
                "immutable once recorded — use a fresh decision_id",
            )
        return prior_receipt, [
            "duplicate decision_id: returning the previous receipt"
        ], []

    try:
        receipt = coc_temporal_memory.adjudicate_candidate(
            decision_id,
            candidate_id,
            action,
            campaign_dir=ctx.campaign_dir,
            statement=statement,
            kind=kind,
            subject_id=subject_id,
            privacy=privacy,
            state=state,
        )
    except coc_temporal_memory.TemporalMemoryError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    ctx.ledger_record(decision_id, tool_name, receipt)
    return receipt, [], [
        "adjudication records your semantic decision; the promoted "
        "assertion is advisory memory, never authoritative state",
        "reject records the decision only — the candidate is never edited "
        "or deleted",
    ]


def register_operations(registry) -> None:
    global TOOLS
    TOOLS = registry.legacy_tools
    registry.tool(
    "history.query",
    "Read the campaign's committed state history at one timeline turn from the rebuildable history projection. Strict read-only; semantic timeline/turn selectors only, never a commit hash.",
    {
        "timeline": {"type": "string", "desc": "timeline id (tl-<slug>); defaults to the campaign's active timeline"},
        "turn": {"type": "integer", "desc": "turn number; defaults to the latest unambiguous turn on the timeline"},
    },
    access="query",
    read_domains=("history",),
    write_domains=(),
    recovery_domains=(),
    response_mode="full",
    audit_mode="reference",
    strict_read_only=True,
    execution_class="serial_campaign",
)(_tool_history_query)
    registry.tool(
    "history.diff",
    "Compare committed state between two settled turns (same or different timelines) as a deterministic leaf-level change list from the history projection. Strict read-only; semantic timeline/turn selectors only.",
    {
        "timeline": {"type": "string", "desc": "default timeline for both sides (tl-<slug>); defaults to the campaign's active timeline"},
        "from_timeline": {"type": "string", "desc": "timeline of the from side (defaults to timeline)"},
        "from_turn": {"type": "integer", "required": True, "desc": "turn number of the from side"},
        "to_timeline": {"type": "string", "desc": "timeline of the to side (defaults to timeline)"},
        "to_turn": {"type": "integer", "required": True, "desc": "turn number of the to side"},
    },
    access="query",
    read_domains=("history",),
    write_domains=(),
    recovery_domains=(),
    response_mode="full",
    audit_mode="reference",
    strict_read_only=True,
    execution_class="serial_campaign",
)(_tool_history_diff)
    registry.tool(
    "memory.recall",
    "Deterministically narrow canonical temporal memory assertions (subject knowledge/beliefs) by subject, timeline, valid-time turn, entities, scene, and privacy. Advisory candidates for KP semantic judgment; never authoritative truth. Strict read-only.",
    {
        "subject_id": {"type": "string", "desc": "subject-<slug> id whose knowledge/beliefs to recall"},
        "timeline": {"type": "string", "desc": "timeline id (tl-<slug>); defaults to the campaign's active timeline"},
        "turn": {"type": "integer", "desc": "valid-time anchor turn; omit for currently-effective assertions only"},
        "entities": {"type": "array", "items": {"type": "string"}, "desc": "entity-<slug> ids to narrow by (structured overlap only, never prose)"},
        "scene": {"type": "string", "desc": "scene id to narrow by"},
        "kinds": {"type": "array", "items": {"type": "string"}, "desc": "assertion kinds filter (world_event/knowledge/belief/relationship/player_assertion/player_preference/keeper_correction/summary)"},
        "view": {"type": "string", "enum": ["keeper", "player_safe"], "desc": "privacy view; player_safe never returns keeper_only rows"},
        "include_superseded": {"type": "boolean", "desc": "include closed/superseded assertions when no turn anchor is given"},
        "limit": {"type": "integer", "desc": "max candidates (default 12, max 64)"},
    },
    access="query",
    read_domains=("memory",),
    write_domains=(),
    recovery_domains=(),
    response_mode="full",
    audit_mode="reference",
    strict_read_only=True,
    execution_class="serial_campaign",
)(_tool_memory_recall)
    registry.tool(
    "memory.adjudicate",
    "Record the KP's accept/modify/reject decision on one temporal memory candidate. Accept/modify write a new confirming assertion; nothing is ever edited or deleted. Idempotent per decision_id; a decision id is immutable once bound to its request.",
    {
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key; immutable once bound to a request"},
        "candidate_id": {"type": "string", "required": True, "desc": "candidate assertion id (mem-<slug>)"},
        "action": {"type": "string", "required": True, "enum": ["accept", "modify", "reject"], "desc": "KP adjudication of the candidate"},
        "statement": {"type": "string", "desc": "promoted statement text (required for modify)"},
        "kind": {"type": "string", "desc": "promoted assertion kind (default belief; player_assertion cannot be promoted)"},
        "subject_id": {"type": "string", "desc": "subject-<slug> id of the promoted record (defaults to the party)"},
        "privacy": {"type": "string", "enum": ["player_safe", "keeper_only"], "desc": "promoted privacy tier (defaults to the candidate's)"},
        "state": {"type": "string", "enum": ["accurate", "uncertain", "distorted", "suppressed", "forgotten", "implanted", "dreamlike", "cross_timeline_echo", "contradictory"], "desc": "promoted memory state (default accurate)"},
    },
    write_domains=("memory",),
)(_tool_memory_adjudicate)


OPERATION_EXPORTS = (
    '_HISTORY_DIFF_HINTS',
    '_HISTORY_QUERY_HINTS',
    '_TIMELINE_RE',
    '_fork_point_of',
    '_latest_turn',
    '_optional_str',
    '_optional_turn',
    '_public_commit',
    '_require_timeline',
    '_require_turn',
    '_resolve_timeline',
    '_timeline_turns',
    '_tool_history_diff',
    '_tool_history_query',
    '_tool_memory_adjudicate',
    '_tool_memory_recall',
    'coc_git_history',
    'coc_history_projection_query',
    'coc_history_projection_schema',
    'coc_temporal_memory',
    'coc_temporal_memory_contract',
    'coc_temporal_retrieval',
)
