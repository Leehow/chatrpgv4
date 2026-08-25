#!/usr/bin/env python3
"""Operation adapter cell: steward."""
from __future__ import annotations

from coc_operation_kernel_runtime import (
    Any,
    Ctx,
    ToolError,
    _now_iso,
    coc_state,
    deepcopy,
    tool,
)

def _load_steward_state(ctx: Ctx) -> dict[str, Any]:
    try:
        return coc_state.load_steward_state(ctx.campaign_dir)
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc

def _save_steward_state(ctx: Ctx, payload: dict[str, Any]) -> None:
    coc_state.save_steward_state(ctx.campaign_dir, payload)

def _steward_validated_segments(value: Any) -> list[dict[str, Any]]:
    try:
        return coc_state.validated_steward_segments(value, field="segments")
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc

def _steward_optional_text(
    value: Any, *, field: str, maximum: int,
) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ToolError("invalid_param", f"{field} must be a string or null")
    text = value.strip()
    if not text:
        return None
    if len(text) > maximum:
        raise ToolError(
            "invalid_param", f"{field} exceeds {maximum} characters"
        )
    return text

def _steward_required_text(
    value: Any, *, field: str, maximum: int,
) -> str:
    text = _steward_optional_text(value, field=field, maximum=maximum)
    if not text:
        raise ToolError("invalid_param", f"{field} must be a non-empty string")
    return text

def _steward_validated_id(value: Any, *, field: str) -> str:
    return _steward_required_text(
        value, field=field, maximum=coc_state._STEWARD_MAX_ID_CHARS
    )

def _tool_steward_domain_put(ctx: Ctx, args: dict[str, Any]):
    tool_name = "steward.domain_put"
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previous parser-domain receipt"
        ], []

    domain = str(args.get("domain") or "").strip()
    if domain not in coc_state.STEWARD_PARSE_DOMAINS:
        raise ToolError(
            "invalid_param",
            "domain must be one of " + ", ".join(sorted(coc_state.STEWARD_PARSE_DOMAINS)),
        )
    status = str(args.get("status") or "").strip()
    if status not in coc_state.STEWARD_DOMAIN_STATUSES:
        raise ToolError(
            "invalid_param",
            "status must be one of " + ", ".join(sorted(coc_state.STEWARD_DOMAIN_STATUSES)),
        )
    try:
        content = coc_state.validated_steward_domain_content(args.get("content"))
        failed_chunks = coc_state.validated_steward_failed_chunks(
            args.get("failed_chunks"), domain=domain,
        )
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc

    document = _load_steward_state(ctx)
    document["domains"][domain] = {"status": status, **content}
    now = _now_iso()
    for failed_chunk in failed_chunks:
        failed_chunk["decision_id"] = decision_id
        failed_chunk["ts"] = now
    document["failed_chunks"].extend(failed_chunks)
    _save_steward_state(ctx, document)

    data = {
        "domain": domain,
        "status": status,
        "content_keys": sorted(content),
        "failed_chunks_recorded": len(failed_chunks),
    }
    ctx.log_event({
        "event_type": "steward_domain_put",
        "domain": domain,
        "status": status,
        "decision_id": decision_id,
        "failed_chunks_recorded": len(failed_chunks),
    })
    ctx.ledger_record(decision_id, tool_name, data)
    return data, [], [
        "parser-domain content is keeper-only source preparation; it is not campaign core state and must not be copied to player-visible output",
        "keep source_refs and secrecy on extracted entities so the KP can trace material and preserve the player boundary",
    ]

def _steward_scene_minimal_fallback(
    scene_domain: dict[str, Any], scene_id: str,
) -> dict[str, Any] | None:
    """Return only an indexed, source-bound minimal scene; never invent a fallback."""
    for key in ("index", "items", "locations", "scenes"):
        rows = scene_domain.get(key)
        if not isinstance(rows, list):
            continue
        for raw in rows:
            if not isinstance(raw, dict):
                continue
            candidate_id = str(
                raw.get("id", raw.get("scene_id", raw.get("location_id", "")))
            ).strip()
            refs = raw.get("source_refs")
            if candidate_id != scene_id or not isinstance(refs, list) or not refs:
                continue
            try:
                current = coc_state._validated_steward_scene_entity(raw, "scene fallback")
            except ValueError:
                continue
            fallback = {
                "id": current["id"],
                "name": current["name"],
                "source_refs": current["source_refs"],
            }
            clues = raw.get("clues_index")
            if isinstance(clues, list):
                fallback["clues_index"] = deepcopy(clues)
            return fallback
    return None

def _tool_steward_scene_bundle_put(ctx: Ctx, args: dict[str, Any]):
    tool_name = "steward.scene_bundle_put"
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previous scene-bundle receipt"
        ], []
    try:
        bundles = coc_state.validated_steward_scene_bundles(args.get("bundles"))
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    document = _load_steward_state(ctx)
    scene_domain = deepcopy(document["domains"]["scene"])
    cache = scene_domain.get("bundles")
    if not isinstance(cache, dict):
        cache = {}
    for bundle in bundles:
        cache[bundle["current"]["id"]] = bundle
    scene_domain["bundles"] = cache
    scene_domain["status"] = "ready"
    document["domains"]["scene"] = scene_domain
    _save_steward_state(ctx, document)
    data = {
        "status": "ready",
        "bundle_ids": sorted(bundle["current"]["id"] for bundle in bundles),
        "cache_size": len(cache),
    }
    ctx.log_event({
        "event_type": "steward_scene_bundle_put",
        "decision_id": decision_id,
        "bundle_ids": data["bundle_ids"],
    })
    ctx.ledger_record(decision_id, tool_name, data)
    return data, [], [
        "SceneBundle content is keeper-only source preparation; never expose it directly to players",
        "every current scene and edge is source-bound; semantic-inference edges still require provenance and source_refs",
    ]

def _tool_steward_scene_supply(ctx: Ctx, args: dict[str, Any]):
    scene_id = _steward_validated_id(args.get("scene_id"), field="scene_id")
    document = _load_steward_state(ctx)
    scene_domain = document["domains"]["scene"]
    supply_config = scene_domain.get("scene_supply")
    enforced = isinstance(supply_config, dict) and supply_config.get("enabled") is True
    if not enforced:
        return {
            "schema_version": 1,
            "scene_id": scene_id,
            "enforced": False,
            "status": "not_configured",
            "ready": True,
        }, [], []
    cache = scene_domain.get("bundles")
    bundle = cache.get(scene_id) if isinstance(cache, dict) else None
    if isinstance(bundle, dict):
        return {
            "schema_version": 1,
            "scene_id": scene_id,
            "enforced": True,
            "status": "ready",
            "ready": True,
            "cache_hit": bool(bundle.get("prefetched_from")),
            "bundle": deepcopy(bundle),
            "source_cache_path": supply_config.get("source_cache_path"),
        }, [], [
            "use this SceneBundle only as Keeper source material; it is not player-visible prose",
        ]
    fallback = _steward_scene_minimal_fallback(scene_domain, scene_id)
    if args.get("allow_minimal_fallback") is True and fallback is not None:
        return {
            "schema_version": 1,
            "scene_id": scene_id,
            "enforced": True,
            "status": "minimal_ready",
            "ready": True,
            "degraded": True,
            "cache_hit": False,
            "minimal_scene": fallback,
            "source_cache_path": supply_config.get("source_cache_path"),
        }, [
            "full SceneBundle is unavailable; using the explicitly source-bound minimal fallback after Pi retry policy",
        ], []
    status = str(scene_domain.get("status") or "pending")
    pending_status = "failed" if status == "failed" else "pending"
    return {
        "schema_version": 1,
        "scene_id": scene_id,
        "enforced": True,
        "status": pending_status,
        "ready": False,
        "cache_hit": False,
        "fallback_available": fallback is not None,
        "source_cache_path": supply_config.get("source_cache_path"),
    }, [], [
        "SceneBundle is not ready: wait for steward-scene rather than improvising destination material",
    ]

def _tool_steward_deliver(ctx: Ctx, args: dict[str, Any]):
    tool_name = "steward.deliver"
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previous delivery receipt"
        ], []

    delivery_id = _steward_validated_id(
        args.get("delivery_id"), field="delivery_id"
    ) if args.get("delivery_id") is not None else decision_id
    if len(delivery_id) > coc_state._STEWARD_MAX_ID_CHARS:
        raise ToolError(
            "invalid_param",
            f"delivery_id exceeds {coc_state._STEWARD_MAX_ID_CHARS} characters",
        )
    why_now = _steward_required_text(
        args.get("why_now"),
        field="why_now",
        maximum=coc_state._STEWARD_MAX_WHY_NOW_CHARS,
    )
    created_turn = _steward_required_text(
        args.get("created_turn"),
        field="created_turn",
        maximum=coc_state._STEWARD_MAX_TURN_REF_CHARS,
    )
    secrecy = str(args.get("secrecy") or "").strip()
    if secrecy not in coc_state.STEWARD_SECRECY_LEVELS:
        raise ToolError(
            "invalid_param",
            "secrecy must be one of "
            + ", ".join(sorted(coc_state.STEWARD_SECRECY_LEVELS)),
        )
    scene_annotation = _steward_optional_text(
        args.get("scene_annotation"),
        field="scene_annotation",
        maximum=coc_state._STEWARD_MAX_ANNOTATION_CHARS,
    )

    notebook_refs_value = args.get("notebook_entry_ids")
    notebook_entry_ids: list[str] = []
    if notebook_refs_value is not None:
        if (
            not isinstance(notebook_refs_value, list)
            or any(
                not isinstance(ref, str) or not ref.strip()
                for ref in notebook_refs_value
            )
        ):
            raise ToolError(
                "invalid_param", "notebook_entry_ids must be an array of strings"
            )
        notebook_entry_ids = [ref.strip() for ref in notebook_refs_value]
        if len(notebook_entry_ids) != len(set(notebook_entry_ids)):
            raise ToolError(
                "invalid_param", "notebook_entry_ids must not contain duplicates"
            )

    segments_value = args.get("segments")
    document = _load_steward_state(ctx)
    if delivery_id in document["deliveries"]:
        raise ToolError(
            "steward_conflict",
            f"delivery_id {delivery_id!r} already exists; refusing to overwrite",
        )

    for entry_id in notebook_entry_ids:
        entry = document["notebook"].get(entry_id)
        if entry is None:
            raise ToolError(
                "invalid_param",
                f"notebook_entry_id {entry_id!r} is not in the notebook",
            )
        if entry["paid"]:
            raise ToolError(
                "steward_conflict",
                f"notebook entry {entry_id!r} is already paid; refusing to re-pay",
            )

    if segments_value is not None:
        segments = _steward_validated_segments(segments_value)
    elif notebook_entry_ids:
        segments = [
            deepcopy(segment)
            for entry_id in notebook_entry_ids
            for segment in document["notebook"][entry_id]["segments"]
        ]
    else:
        raise ToolError(
            "invalid_param",
            "provide segments or at least one notebook_entry_id",
        )

    now = _now_iso()
    record = {
        "delivery_id": delivery_id,
        "created_turn": created_turn,
        "segments": segments,
        "why_now": why_now,
        "scene_annotation": scene_annotation,
        "secrecy": secrecy,
        "consumed": False,
        "consumed_turn": None,
        "decision_id": decision_id,
        "notebook_entry_ids": notebook_entry_ids,
        "ts": now,
    }
    document["deliveries"][delivery_id] = record
    for entry_id in notebook_entry_ids:
        entry = document["notebook"][entry_id]
        entry["paid"] = True
        entry["paid_turn"] = now
        entry["paid_delivery_id"] = delivery_id
        entry["updated_turn"] = now
    _save_steward_state(ctx, document)

    data = {
        "delivery_id": delivery_id,
        "created_turn": created_turn,
        "secrecy": secrecy,
        "scene_annotation": scene_annotation,
        "segment_count": len(segments),
        "notebook_entries_paid": notebook_entry_ids,
    }
    ctx.ledger_record(decision_id, tool_name, data)
    return data, [], [
        "the delivery is a canon candidate for the KP; the KP stays free to improvise but must not override it",
        "keeper_only segments are KP-internal knowledge and must never reach player-visible narration or handouts",
    ]

def _tool_steward_notebook_put(ctx: Ctx, args: dict[str, Any]):
    tool_name = "steward.notebook_put"
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previous notebook receipt"
        ], []

    entry_id = _steward_validated_id(
        args.get("entry_id"), field="entry_id"
    ) if args.get("entry_id") is not None else decision_id
    scene_annotation = _steward_required_text(
        args.get("scene_annotation"),
        field="scene_annotation",
        maximum=coc_state._STEWARD_MAX_ANNOTATION_CHARS,
    )
    segments = _steward_validated_segments(args.get("segments"))
    note = _steward_optional_text(
        args.get("note"), field="note", maximum=coc_state._STEWARD_MAX_NOTE_CHARS
    )

    document = _load_steward_state(ctx)
    existing = document["notebook"].get(entry_id)
    if existing is not None and existing["paid"]:
        raise ToolError(
            "steward_conflict",
            f"notebook entry {entry_id!r} is already paid; paid content is immutable",
        )
    now = _now_iso()
    entry = {
        "entry_id": entry_id,
        "scene_annotation": scene_annotation,
        "segments": segments,
        "note": note,
        "paid": False,
        "paid_turn": None,
        "paid_delivery_id": None,
        "created_turn": existing["created_turn"] if existing is not None else now,
        "updated_turn": now,
        "decision_id": decision_id,
    }
    document["notebook"][entry_id] = entry
    _save_steward_state(ctx, document)

    replaced = existing is not None
    data = {
        "entry_id": entry_id,
        "scene_annotation": scene_annotation,
        "segment_count": len(segments),
        "replaced": replaced,
        "paid": False,
    }
    ctx.ledger_record(decision_id, tool_name, data)
    warnings = (
        [f"replaced unpaid notebook entry {entry_id!r} with the same entry_id"]
        if replaced
        else []
    )
    return data, warnings, [
        "the notebook is a KP-side feed surface; pay entries with steward.deliver (notebook_entry_ids) or steward.notebook_pay when the scene truly arrives",
    ]

def _tool_steward_notebook_pay(ctx: Ctx, args: dict[str, Any]):
    tool_name = "steward.notebook_pay"
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previous pay receipt"
        ], []

    entry_id_value = args.get("entry_id")
    scene_value = args.get("scene_annotation")
    if (entry_id_value is None) == (scene_value is None):
        raise ToolError(
            "invalid_param",
            "provide exactly one of entry_id or scene_annotation",
        )

    document = _load_steward_state(ctx)
    now = _now_iso()
    paid_ids: list[str] = []
    already_paid_ids: list[str] = []
    if entry_id_value is not None:
        entry_id = _steward_validated_id(entry_id_value, field="entry_id")
        entry = document["notebook"].get(entry_id)
        if entry is None:
            raise ToolError(
                "invalid_param", f"notebook entry {entry_id!r} is not in the notebook"
            )
        if entry["paid"]:
            already_paid_ids.append(entry_id)
        else:
            entry["paid"] = True
            entry["paid_turn"] = now
            entry["updated_turn"] = now
            paid_ids.append(entry_id)
    else:
        scene_annotation = _steward_required_text(
            scene_value,
            field="scene_annotation",
            maximum=coc_state._STEWARD_MAX_ANNOTATION_CHARS,
        )
        matched = [
            entry for entry in document["notebook"].values()
            if entry["scene_annotation"] == scene_annotation
        ]
        if not matched:
            raise ToolError(
                "invalid_param",
                f"no notebook entries carry scene_annotation {scene_annotation!r}",
            )
        for entry in matched:
            if entry["paid"]:
                already_paid_ids.append(entry["entry_id"])
            else:
                entry["paid"] = True
                entry["paid_turn"] = now
                entry["updated_turn"] = now
                paid_ids.append(entry["entry_id"])

    if paid_ids:
        _save_steward_state(ctx, document)
    data = {
        "paid_entries": paid_ids,
        "already_paid_entries": already_paid_ids,
    }
    ctx.ledger_record(decision_id, tool_name, data)
    warnings = (
        ["the listed entries were already paid; nothing changed"]
        if already_paid_ids and not paid_ids
        else []
    )
    return data, warnings, [
        "paying is a flag-only disposition; deliver the actual module text through steward.deliver",
    ]

def _tool_steward_mark_consumed(ctx: Ctx, args: dict[str, Any]):
    tool_name = "steward.mark_consumed"
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previous receipt"
        ], []

    delivery_id = _steward_validated_id(args.get("delivery_id"), field="delivery_id")
    document = _load_steward_state(ctx)
    record = document["deliveries"].get(delivery_id)
    if record is None:
        raise ToolError(
            "invalid_param", f"unknown delivery_id {delivery_id!r}"
        )
    now = _now_iso()
    if record["consumed"]:
        already = True
        data = {
            "delivery_id": delivery_id,
            "consumed": True,
            "consumed_turn": record["consumed_turn"],
        }
    else:
        already = False
        record["consumed"] = True
        record["consumed_turn"] = now
        _save_steward_state(ctx, document)
        data = {
            "delivery_id": delivery_id,
            "consumed": True,
            "consumed_turn": now,
        }
    ctx.ledger_record(decision_id, tool_name, data)
    warnings = ["delivery was already consumed; nothing changed"] if already else []
    return data, warnings, [
        "consumed deliveries remain readable history through steward.deliveries",
    ]

def _tool_steward_deliveries(ctx: Ctx, args: dict[str, Any]):
    document = _load_steward_state(ctx)
    rows = [deepcopy(record) for record in document["deliveries"].values()]
    rows.sort(key=lambda record: (str(record.get("ts") or ""), str(record.get("delivery_id") or "")))
    delivery_id = args.get("delivery_id")
    if delivery_id is not None:
        delivery_id = _steward_validated_id(delivery_id, field="delivery_id")
        matched = [row for row in rows if row["delivery_id"] == delivery_id]
        if not matched:
            raise ToolError("invalid_param", f"unknown delivery_id {delivery_id!r}")
        rows = matched
    if args.get("include_consumed", True) is False:
        rows = [row for row in rows if not row["consumed"]]
    projection = str(args.get("projection") or "keeper").strip()
    if projection not in {"keeper", "player"}:
        raise ToolError("invalid_param", "projection must be 'keeper' or 'player'")
    if projection == "player":
        projected: list[dict[str, Any]] = []
        for row in rows:
            head = {
                "delivery_id": row["delivery_id"],
                "secrecy": row["secrecy"],
                "scene_annotation": row["scene_annotation"],
                "created_turn": row["created_turn"],
                "consumed": row["consumed"],
                "consumed_turn": row["consumed_turn"],
            }
            if row["secrecy"] == "player_safe":
                head["segments"] = row["segments"]
            else:
                head["withheld"] = True
                head["segment_count"] = len(row["segments"])
            projected.append(head)
        rows = projected
    return {
        "schema_version": 1,
        "projection": projection,
        "count": len(rows),
        "deliveries": rows,
    }, [], [
        "keeper_only segments are KP-internal knowledge; never quote, paraphrase, or hand them to players",
        "projection=player is the only surface from which module text may reach players verbatim",
    ]

def _tool_steward_notebook(ctx: Ctx, args: dict[str, Any]):
    document = _load_steward_state(ctx)
    rows = [deepcopy(entry) for entry in document["notebook"].values()]
    rows.sort(key=lambda entry: (str(entry.get("created_turn") or ""), str(entry.get("entry_id") or "")))
    entry_id = args.get("entry_id")
    if entry_id is not None:
        entry_id = _steward_validated_id(entry_id, field="entry_id")
        matched = [row for row in rows if row["entry_id"] == entry_id]
        if not matched:
            raise ToolError("invalid_param", f"unknown entry_id {entry_id!r}")
        rows = matched
    scene_annotation = args.get("scene_annotation")
    if scene_annotation is not None:
        scene_annotation = _steward_required_text(
            scene_annotation,
            field="scene_annotation",
            maximum=coc_state._STEWARD_MAX_ANNOTATION_CHARS,
        )
        rows = [
            row for row in rows
            if row["scene_annotation"] == scene_annotation
        ]
    if args.get("include_paid", True) is False:
        rows = [row for row in rows if not row["paid"]]
    return {
        "schema_version": 1,
        "count": len(rows),
        "entries": rows,
    }, [], [
        "the notebook is steward-internal preparation; only delivery segments with player_safe secrecy may reach players verbatim",
    ]

def register_operations(registry) -> None:
    global TOOLS
    TOOLS = registry.legacy_tools
    registry.tool(
    "steward.domain_put",
    "Atomically replace one asynchronous steward parser domain snapshot and append any chunk failures. Domains are init, npc, scene, clue, and rule; content is a thin, extensible JSON object, while status is explicit. This writes only save/steward-state.json and never campaign core state.",
    {
        "domain": {
            "type": "string",
            "enum": ["init", "npc", "scene", "clue", "rule"],
            "required": True,
            "desc": "parser domain to replace",
        },
        "status": {
            "type": "string",
            "enum": ["pending", "ready", "partial", "failed"],
            "required": True,
            "desc": "current parser-domain status",
        },
        "content": {
            "type": "object",
            "required": True,
            "additionalProperties": True,
            "desc": "extensible domain content; omit status because it is supplied separately",
        },
        "failed_chunks": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": True,
                "properties": {
                    "chunk_id": {"type": "string"},
                    "reason": {"type": "string"},
                    "attempts": {"type": "integer", "minimum": 1},
                    "source_refs": {"type": "array", "items": {"type": "string"}},
                },
                "required_fields": ["chunk_id", "reason"],
            },
            "desc": "failed child chunks to append; their domain is bound to domain",
        },
        "decision_id": {"type": "string", "desc": "idempotency key and stable source id"},
    },
)(_tool_steward_domain_put)
    registry.tool(
    "steward.scene_bundle_put",
    "Merge source-bound SceneBundle records into the steward scene cache. Each bundle has current plus source-traceable neighboring SceneEdge records, so a later arrival can consume a prefetched current bundle without re-parsing.",
    {
        "bundles": {
            "type": "array",
            "required": True,
            "minItems":1,
            "items": {"type": "object", "additionalProperties": True},
            "desc": "one or more source-bound SceneBundle records; each current scene id is the cache key",
        },
        "decision_id": {"type": "string", "desc": "idempotency key and stable source id"},
    },
)(_tool_steward_scene_bundle_put)
    registry.tool(
    "steward.scene_supply",
    "Read one Pi scene-supply readiness snapshot. A ready bundle is the only full scene material surface; an optional minimal fallback is limited to source-bound indexed name/clue references after the Pi retry policy is exhausted.",
    {
        "scene_id": {"type": "string", "required": True, "desc": "destination scene id to check"},
        "allow_minimal_fallback": {
            "type": "boolean",
            "desc": "permit only the source-bound minimal indexed fallback when no full bundle is ready",
        },
    },
    access="query",
    read_domains=("steward",),
    write_domains=(),
    recovery_domains=(),
    response_mode="full",
    audit_mode="reference",
    strict_read_only=True,
)(_tool_steward_scene_supply)
    registry.tool(
    "steward.deliver",
    "Write one steward delivery: module text segments the KP needs now, with why_now, expected scene annotation, and a keeper_only/player_safe secrecy label. Optionally pays linked notebook entries (即付). The KP reads it through steward.deliveries; this record is canon-candidate feed, never rules/state authority.",
    {
        "delivery_id": {"type": "string", "desc": "stable delivery id (defaults to the decision_id)"},
        "segments": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "text": {"type": "string", "desc": "verbatim module text (markdown page body excerpt)"},
                    "page": {"type": "integer", "desc": "zero-based pdf_index of the source page, or null"},
                    "source_refs": {"type": "array", "items": {"type": "string"}, "desc": "module-assets refs for this excerpt"},
                },
                "required_fields": ["text", "page", "source_refs"],
            },
            "desc": "module text segments; provide here or derive from notebook_entry_ids",
        },
        "why_now": {"type": "string", "required": True, "desc": "why the KP needs this module text at this turn"},
        "scene_annotation": {"type": "string", "desc": "expected scene this delivery serves (short label)"},
        "secrecy": {
            "type": "string",
            "enum": ["keeper_only", "player_safe"],
            "required": True,
            "desc": "keeper_only = KP-internal knowledge, never player-visible; player_safe = verbatim module text the KP may hand to players",
        },
        "created_turn": {"type": "string", "required": True, "desc": "campaign turn / event identity this delivery serves"},
        "notebook_entry_ids": {"type": "array", "items": {"type": "string"}, "desc": "unpaid notebook entries to pay and link to this delivery"},
        "decision_id": {"type": "string", "desc": "idempotency key and stable source id"},
    },
)(_tool_steward_deliver)
    registry.tool(
    "steward.notebook_put",
    "Add or refine one notebook entry: pre-cut module segments for an expected scene, paid when the scene truly arrives. Unpaid entries may be replaced to refine pre-cuts; paid entries are immutable.",
    {
        "entry_id": {"type": "string", "desc": "stable notebook entry id (defaults to the decision_id)"},
        "scene_annotation": {"type": "string", "required": True, "desc": "expected scene this pre-cut serves (short label)"},
        "segments": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "text": {"type": "string", "desc": "verbatim module text (markdown page body excerpt)"},
                    "page": {"type": "integer", "desc": "zero-based pdf_index of the source page, or null"},
                    "source_refs": {"type": "array", "items": {"type": "string"}, "desc": "module-assets refs for this excerpt"},
                },
                "required_fields": ["text", "page", "source_refs"],
            },
            "required": True,
            "desc": "pre-cut module text segments",
        },
        "note": {"type": "string", "desc": "steward note: why this scene is expected / what to watch for"},
        "decision_id": {"type": "string", "desc": "idempotency key and stable source id"},
    },
)(_tool_steward_notebook_put)
    registry.tool(
    "steward.notebook_pay",
    "Mark notebook entries for an expected scene as paid when the scene truly arrives (flag only; deliver the text through steward.deliver). Already-paid entries are left unchanged.",
    {
        "entry_id": {"type": "string", "desc": "pay exactly one notebook entry (exactly one of entry_id / scene_annotation)"},
        "scene_annotation": {"type": "string", "desc": "pay every unpaid notebook entry of this expected scene"},
        "decision_id": {"type": "string", "desc": "idempotency key and stable source id"},
    },
)(_tool_steward_notebook_pay)
    registry.tool(
    "steward.mark_consumed",
    "Mark one delivery as consumed once the scene it served has passed, so steward.deliveries can separate current deliveries from history.",
    {
        "delivery_id": {"type": "string", "required": True, "desc": "delivery id to mark consumed"},
        "decision_id": {"type": "string", "desc": "idempotency key and stable source id"},
    },
)(_tool_steward_mark_consumed)
    registry.tool(
    "steward.deliveries",
    "Read steward deliveries: module text the steward judged the KP needs now, with why_now, expected scene annotation, secrecy labels, page and source refs. projection=keeper returns full records; projection=player returns only player_safe segments (never keeper_only text or KP reasoning) and is the only surface from which module text may reach players verbatim.",
    {
        "delivery_id": {"type": "string", "desc": "read exactly one delivery"},
        "projection": {
            "type": "string",
            "enum": ["keeper", "player"],
            "desc": "keeper = full records (default); player = player_safe segments only",
        },
        "include_consumed": {
            "type": "boolean",
            "desc": "include consumed (historical) deliveries; default true",
        },
    },
    access="query",
    read_domains=("steward",),
    write_domains=(),
    recovery_domains=(),
    response_mode="full",
    audit_mode="reference",
    strict_read_only=True,
)(_tool_steward_deliveries)
    registry.tool(
    "steward.notebook",
    "Read the steward notebook: pre-cut module segments per expected scene with paid status and steward notes. KP-only surface; notebook content is never player-projected.",
    {
        "entry_id": {"type": "string", "desc": "read exactly one notebook entry"},
        "scene_annotation": {"type": "string", "desc": "filter entries by expected scene"},
        "include_paid": {
            "type": "boolean",
            "desc": "include already-paid entries; default true",
        },
    },
    access="query",
    read_domains=("steward",),
    write_domains=(),
    recovery_domains=(),
    response_mode="full",
    audit_mode="reference",
    strict_read_only=True,
)(_tool_steward_notebook)


OPERATION_EXPORTS = (
    '_load_steward_state',
    '_save_steward_state',
    '_steward_optional_text',
    '_steward_required_text',
    '_steward_scene_minimal_fallback',
    '_steward_validated_id',
    '_steward_validated_segments',
    '_tool_steward_deliver',
    '_tool_steward_deliveries',
    '_tool_steward_domain_put',
    '_tool_steward_mark_consumed',
    '_tool_steward_notebook',
    '_tool_steward_notebook_pay',
    '_tool_steward_notebook_put',
    '_tool_steward_scene_bundle_put',
    '_tool_steward_scene_supply',
)
