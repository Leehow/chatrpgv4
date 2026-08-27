#!/usr/bin/env python3
"""Operation adapter cell: canonical-events.

Strict read-only KP surface over the rebuildable canonical-events SQLite
projection (``memory/events-projection.db``):

- ``events.query`` — structured, sequence-ordered narrowing of the campaign
  event stream by timeline id, inclusive turn range, closed enum of event
  types, privacy view, and exact entity refs matched against the projected
  ``event_entities`` table. The default ``"public"`` view can never observe
  secret events; ``"secret"`` / ``"all"`` views stay Keeper-side.

The projection cache self-heals before answering (corrupt/wrong-generation/
stale databases are deleted and rebuilt from ``logs/canonical-events.jsonl``,
never migrated); the JSONL stream stays the sole canonical evidence and this
cell never emits or mutates anything. Semantic judgment over returned facts
stays with the live KP.
"""
from __future__ import annotations

from coc_operation_kernel_runtime import (
    Any,
    Ctx,
    ToolError,
    _load_sibling,
    tool,
)

coc_canonical_events = _load_sibling(
    "coc_canonical_events", "coc_canonical_events.py"
)

_TIMELINE_RE_MAX = 96

_EVENTS_QUERY_HINTS = [
    "events.query reads derived evidence from the rebuildable canonical-events "
    "projection; state.*/rules.* remain authoritative for live play",
    "the default privacy view is public and never returns secret events; "
    "secret/all views are Keeper-side only",
]


def _optional_str(value: Any, label: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ToolError("invalid_param", f"{label} is required")
    if len(text) > _TIMELINE_RE_MAX:
        raise ToolError(
            "invalid_param", f"{label} exceeds {_TIMELINE_RE_MAX} chars"
        )
    return text


def _require_int_param(args: dict[str, Any], name: str) -> int | None:
    value = args.get(name)
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise ToolError(
            "invalid_param",
            f"{name} must be an integer, got {value!r}",
        )
    return value


def _string_list(args: dict[str, Any], name: str) -> list[str]:
    value = args.get(name)
    if value in (None, ""):
        return []
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, (list, tuple)):
        raise ToolError(
            "invalid_param",
            f"{name} must be a list of strings, got {type(value).__name__}",
        )
    items = [str(item).strip() for item in value]
    if any(not item for item in items):
        raise ToolError(
            "invalid_param", f"{name} entries must be non-empty strings"
        )
    return items


def _logs_dir(ctx: Ctx):
    if ctx.campaign_dir is None:
        raise ToolError("unknown_campaign", "events.query needs a campaign")
    return ctx.campaign_dir / "logs"


def _tool_events_query(ctx: Ctx, args: dict[str, Any]):
    timeline = args.get("timeline")
    if timeline not in (None, ""):
        timeline = _optional_str(timeline, "timeline")
    turn_from = _require_int_param(args, "turn_from")
    turn_to = _require_int_param(args, "turn_to")
    types = _string_list(args, "types") or None
    privacy_raw = args.get("privacy")
    privacy = "public" if privacy_raw in (None, "") else str(privacy_raw).strip()
    entity_refs = _string_list(args, "entity_refs") or None
    limit_raw = args.get("limit")
    limit = None if limit_raw in (None, "") else limit_raw

    try:
        result = coc_canonical_events.query_events(
            _logs_dir(ctx),
            timeline=timeline,
            turn_from=turn_from,
            turn_to=turn_to,
            types=types,
            privacy=privacy,
            entity_refs=entity_refs,
            limit=limit,
        )
    except coc_canonical_events.PrivacyError as exc:
        raise ToolError("invalid_param", f"privacy: {exc}") from exc
    except coc_canonical_events.ClosedEnumError as exc:
        raise ToolError("invalid_param", f"types: {exc}") from exc
    except coc_canonical_events.CanonicalEventsContractError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    except coc_canonical_events.EventsProjectionError as exc:
        raise ToolError(
            "invalid_state",
            f"canonical events projection is unreadable: {exc}",
        ) from exc

    result["authority"] = "derived_evidence"
    result["privacy_view"] = privacy
    return result, [], list(_EVENTS_QUERY_HINTS)


def register_operations(registry) -> None:
    registry.tool(
    "events.query",
    "Narrow the campaign's canonical event stream (coc-events/1) through structured filters: timeline, inclusive turn range, closed enum of event types, privacy view, and exact entity refs. Sequence-ordered read-only projection over the emitted stream; default public view never returns secret events.",
    {
        "timeline": {"type": "string", "desc": "timeline id (tl-<slug>); omit to search every timeline"},
        "turn_from": {"type": "integer", "desc": "inclusive lower turn bound"},
        "turn_to": {"type": "integer", "desc": "inclusive upper turn bound"},
        "types": {"type": "array", "items": {"type": "string"}, "desc": "event types from the closed coc-events/1 table (roll-resolved, clue-discovered, sanity-changed, ...)"},
        "privacy": {"type": "string", "enum": ["public", "secret", "all"], "desc": "privacy view; defaults to public which excludes secret events"},
        "entity_refs": {"type": "array", "items": {"type": "string"}, "desc": "structured entity refs to match exactly against projected payload references"},
        "limit": {"type": "integer", "desc": "max rows (default 100)"},
    },
    access="query",
    read_domains=("memory",),
    write_domains=(),
    recovery_domains=(),
    response_mode="full",
    audit_mode="reference",
    strict_read_only=True,
    execution_class="serial_campaign",
)(_tool_events_query)


OPERATION_EXPORTS = (
    '_EVENTS_QUERY_HINTS',
    '_tool_events_query',
)
