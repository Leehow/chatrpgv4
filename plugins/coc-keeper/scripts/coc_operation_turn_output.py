#!/usr/bin/env python3
"""Operation adapter cell: turn-output."""
from __future__ import annotations

from coc_operation_kernel_runtime import (
    Any,
    Ctx,
    Path,
    ToolError,
    _SAFE_ID,
    _TABLE_TRANSCRIPT_RELATIVE,
    _TOOL_TRANSIENT_RETRY_ATTEMPTS,
    _TOOL_TRANSIENT_RETRY_DELAY_SECONDS,
    _active_scene,
    _adjudication_gap_hints,
    _campaign_play_language,
    _canonical_digest,
    _ending_rng,
    _jsonl_rows,
    _latest_narrative_opportunity,
    _load_sibling,
    _now_iso,
    _pi_play_agency_review_required,
    _read_optional_json,
    _record_table_transcript_entry,
    _resolve_investigator,
    _resolve_storylet_candidate_ref,
    _run_segment_binding,
    _scene_contract_projection,
    _storylet_advice_matches_candidate,
    _storylet_candidate_ref,
    _table_transcript_entry_id,
    _table_transcript_rows,
    _tool_evidence_record_adoption,
    _turn_recovery_meaningful_tools,
    coc_continuation,
    coc_development,
    coc_fileio,
    coc_npc_event_chain,
    coc_runtime_ops,
    coc_state,
    coc_turn_finalization,
    coc_turn_manifest,
    deepcopy,
    emit_core_canonical_event,
    hashlib,
    json,
    re,
    time,
    tool,
)

from contextlib import ExitStack


_PENDING_DRAFT_RELATIVE = Path("logs") / "pending-narration-drafts.jsonl"
_PENDING_DRAFT_MAX_UTF8_BYTES = 8192
_PENDING_DRAFT_KIND = "pending_narration_draft"
_PENDING_DRAFT_SOURCE_OPERATION = "narration.review"
_PENDING_DRAFT_PRODUCER_KINDS = frozenset({
    "narration_review_submission",
    "toolbox_audit_recovery",
})
# Closed receipt schema: exactly these keys (``ts`` is the append timestamp
# carried only in the stored row). No extra or missing field is canonical.
_PENDING_DRAFT_FIELDS = frozenset({
    "schema_version", "kind", "secrecy", "campaign_id", "receipt_id",
    "review_decision_id", "review_id", "turn_id", "source_digest",
    "revision", "draft_sha256", "draft_text", "draft_utf8_bytes",
    "review_digest", "request_digest", "producer_kind", "source_operation",
    "materialization_decision_id", "provenance", "receipt_digest",
})
_PENDING_DRAFT_SUBMISSION_PROVENANCE_FIELDS = frozenset({"kind"})
_PENDING_DRAFT_RECOVERY_PROVENANCE_FIELDS = frozenset({
    "kind", "source_path", "source_row_count", "primary_row_digest",
    "corroboration_digest",
})
# Deterministic maximum count of corroborating audit rows a materialized
# receipt may bind; more physical rows is an evidence anomaly, not inflation.
_PENDING_DRAFT_MAX_PROVENANCE_ROWS = 8
# Closed, bounded span-repair contract (coc.span-repairs.v1). The producer
# emits exactly this shape; anything else is not repair evidence. The same
# bounds are enforced by the Pi hydration validator (recovery-guidance.ts).
_SPAN_REPAIRS_CONTRACT_ID = "coc.span-repairs.v1"
_SPAN_REPAIRS_MODE = "excerpt_only"
_SPAN_REPAIRS_REPAIR_ACTION = "rephrase_or_remove"
_SPAN_REPAIRS_FIELDS = frozenset({
    "schema_version", "contract_id", "mode", "spans", "instruction",
})
_SPAN_REPAIRS_ENTRY_FIELDS = frozenset({
    "exact_excerpt", "claim_kind", "reason", "repair",
})
_SPAN_REPAIRS_MAX_SPANS = 16
_SPAN_REPAIRS_MAX_EXCERPT_UTF8_BYTES = 2048
_SPAN_REPAIRS_MAX_CLAIM_KIND_UTF8_BYTES = 128
_SPAN_REPAIRS_MAX_REASON_UTF8_BYTES = 1024
_SPAN_REPAIRS_MAX_INSTRUCTION_UTF8_BYTES = 512
_SPAN_REPAIRS_MAX_AGGREGATE_EXCERPT_UTF8_BYTES = 4096


def _utf8_len(value: str) -> int:
    return len(value.encode("utf-8"))


def _bounded_span_string(value: Any, max_bytes: int) -> bool:
    return (
        isinstance(value, str)
        and bool(value.strip())
        and _utf8_len(value) <= max_bytes
    )


def _valid_span_repair_entries(spans: Any, *, baseline_text: str | None) -> bool:
    """Closed bounded repair-entry list: at least one and at most the
    deterministic span cap, exact field set per entry, non-empty bounded
    strings, canonical repair action, no duplicate (excerpt, kind) pair,
    each excerpt occurring in the frozen baseline when one is given, and a
    deterministic aggregate excerpt-byte bound."""
    if not isinstance(spans, list) or not 1 <= len(spans) <= _SPAN_REPAIRS_MAX_SPANS:
        return False
    seen: set[tuple[str, str]] = set()
    aggregate_excerpt_bytes = 0
    for entry in spans:
        if not isinstance(entry, dict) or set(entry) != _SPAN_REPAIRS_ENTRY_FIELDS:
            return False
        excerpt = entry.get("exact_excerpt")
        claim_kind = entry.get("claim_kind")
        if (
            not _bounded_span_string(excerpt, _SPAN_REPAIRS_MAX_EXCERPT_UTF8_BYTES)
            or not _bounded_span_string(
                claim_kind, _SPAN_REPAIRS_MAX_CLAIM_KIND_UTF8_BYTES
            )
            or not _bounded_span_string(entry.get("reason"), _SPAN_REPAIRS_MAX_REASON_UTF8_BYTES)
            or entry.get("repair") != _SPAN_REPAIRS_REPAIR_ACTION
        ):
            return False
        key = (excerpt, claim_kind)
        if key in seen:
            return False
        seen.add(key)
        if baseline_text is not None and excerpt not in baseline_text:
            return False
        aggregate_excerpt_bytes += _utf8_len(excerpt)
        if aggregate_excerpt_bytes > _SPAN_REPAIRS_MAX_AGGREGATE_EXCERPT_UTF8_BYTES:
            return False
    return True


def _valid_span_repairs(value: Any, *, baseline_text: str | None = None) -> bool:
    if not isinstance(value, dict) or set(value) != _SPAN_REPAIRS_FIELDS:
        return False
    return (
        value.get("schema_version") == 1
        and value.get("contract_id") == _SPAN_REPAIRS_CONTRACT_ID
        and value.get("mode") == _SPAN_REPAIRS_MODE
        and _bounded_span_string(value.get("instruction"), _SPAN_REPAIRS_MAX_INSTRUCTION_UTF8_BYTES)
        and _valid_span_repair_entries(value.get("spans"), baseline_text=baseline_text)
    )


def _journal_declared_kind(args: dict[str, Any]) -> str:
    """Authoritative declared-kind token: the KP-supplied intent class when
    it already satisfies the canonical token grammar, otherwise the plain
    free-form declaration shape. Never classified from player prose."""
    raw = str(args.get("intent_class") or "").strip()
    if raw and re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,127}", raw):
        return raw
    return "freeform"

coc_narration_style = _load_sibling(
    "coc_narration_style_toolbox", "coc_narration_style.py"
)

coc_narration_contract = _load_sibling(
    "coc_narration_contract_toolbox", "coc_narration_contract.py"
)

coc_state_authority = _load_sibling(
    "coc_state_authority_toolbox", "coc_state_authority.py"
)

def _rewrite_roll_visibilities(
    campaign_dir: Path,
    roll_ids: set[str],
    *,
    visibility: str,
    supersession_id: str,
    reason: str,
) -> list[str]:
    """Mark canonical roll rows as non-player-facing after a correction.

    Audit rows remain; only player-facing projection (turn.finalize, battle
    report) hides them. Returns the roll_ids that were rewritten.
    """
    path = Path(campaign_dir) / "logs" / "rolls.jsonl"
    if not path.is_file() or not roll_ids:
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    rewritten: list[str] = []
    out_lines: list[str] = []
    for raw in lines:
        if not raw.strip():
            continue
        try:
            row = json.loads(raw)
        except json.JSONDecodeError:
            out_lines.append(raw)
            continue
        if not isinstance(row, dict):
            out_lines.append(raw)
            continue
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        roll_id = str(
            row.get("roll_id")
            or payload.get("roll_id")
            or row.get("command_id")
            or ""
        ).strip()
        if roll_id not in roll_ids:
            out_lines.append(raw)
            continue
        row["visibility"] = visibility
        row["superseded"] = True
        row["supersession_id"] = supersession_id
        row["supersession_reason"] = reason
        if isinstance(payload, dict):
            payload = dict(payload)
            payload["visibility"] = visibility
            payload["superseded"] = True
            payload["supersession_id"] = supersession_id
            payload["supersession_reason"] = reason
            row["payload"] = payload
        out_lines.append(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
        rewritten.append(roll_id)
    coc_fileio.write_text_atomic(
        path,
        "\n".join(out_lines) + ("\n" if out_lines else ""),
        encoding="utf-8",
    )
    return rewritten

def _hide_related_hp_events(
    campaign_dir: Path,
    roll_ids: set[str],
    *,
    supersession_id: str,
    reason: str,
) -> int:
    """Hide hp_change events bound to superseded damage rolls from player view."""
    path = Path(campaign_dir) / "logs" / "events.jsonl"
    if not path.is_file() or not roll_ids:
        return 0
    lines = path.read_text(encoding="utf-8").splitlines()
    changed = 0
    out_lines: list[str] = []
    for raw in lines:
        if not raw.strip():
            continue
        try:
            row = json.loads(raw)
        except json.JSONDecodeError:
            out_lines.append(raw)
            continue
        if not isinstance(row, dict) or row.get("event_type") != "hp_change":
            out_lines.append(raw)
            continue
        event_roll = str(row.get("roll_id") or "").strip()
        if event_roll not in roll_ids:
            out_lines.append(raw)
            continue
        row["visibility"] = "superseded"
        row["player_facing"] = False
        row["superseded"] = True
        row["supersession_id"] = supersession_id
        row["supersession_reason"] = reason
        out_lines.append(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
        changed += 1
    if changed:
        coc_fileio.write_text_atomic(
            path,
            "\n".join(out_lines) + ("\n" if out_lines else ""),
            encoding="utf-8",
        )
    return changed

def _tool_state_supersede_settlement(ctx: Ctx, args: dict[str, Any]):
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup("state.supersede_settlement", decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    raw_ids = args.get("roll_ids")
    if not isinstance(raw_ids, list) or not raw_ids:
        raise ToolError("invalid_param", "roll_ids must be a non-empty array")
    roll_ids = {
        str(value).strip()
        for value in raw_ids
        if isinstance(value, str) and value.strip()
    }
    if not roll_ids:
        raise ToolError("invalid_param", "roll_ids must contain non-empty strings")
    reason = str(args.get("reason") or "").strip()
    if not reason:
        raise ToolError("invalid_param", "reason is required")
    supersession_id = f"supersede-{decision_id}"
    rewritten = _rewrite_roll_visibilities(
        ctx.campaign_dir,
        roll_ids,
        visibility="superseded",
        supersession_id=supersession_id,
        reason=reason,
    )
    _hide_related_hp_events(
        ctx.campaign_dir,
        roll_ids,
        supersession_id=supersession_id,
        reason=reason,
    )
    hp_receipt: dict[str, Any] | None = None
    restore_to = args.get("restore_hp_to")
    if restore_to is not None:
        if isinstance(restore_to, bool) or not isinstance(restore_to, int) or restore_to < 0:
            raise ToolError("invalid_param", "restore_hp_to must be a non-negative integer")
        investigator_id = _resolve_investigator(ctx, args)
        state = ctx.inv_state(investigator_id)
        sheet = ctx.sheet(investigator_id)
        max_hp = int((sheet.get("derived") or {}).get("HP") or 10)
        before = int(state.get("current_hp", max_hp))
        after = min(max_hp, int(restore_to))
        state["current_hp"] = after
        conditions_before = list(state.get("conditions") or [])
        conditions = list(conditions_before)
        if after > 0:
            for gone in ("dying", "unconscious"):
                if gone in conditions:
                    conditions.remove(gone)
        state["conditions"] = conditions
        ctx.save_inv_state(investigator_id, state)
        hp_receipt = {
            "investigator_id": investigator_id,
            "kind": "heal" if after >= before else "damage",
            "amount": abs(after - before),
            "hp_before": before,
            "hp_after": after,
            "max_hp": max_hp,
            "conditions_before": conditions_before,
            "conditions_after": list(conditions),
            "source": f"supersession:{supersession_id}",
            "player_facing": False,
            "superseded_correction": True,
        }
        ctx.log_event({
            "event_type": "hp_change",
            **hp_receipt,
            "visibility": "superseded",
            "supersession_id": supersession_id,
        })
    data = {
        "supersession_id": supersession_id,
        "decision_id": decision_id,
        "reason": reason,
        "requested_roll_ids": sorted(roll_ids),
        "rewritten_roll_ids": sorted(set(rewritten)),
        "hp_correction": hp_receipt,
        "player_facing_hidden": True,
    }
    ctx.log_event({
        "event_type": "settlement_superseded",
        **data,
        "ts": _now_iso(),
    })
    ctx.ledger_record(decision_id, "state.supersede_settlement", data)
    hints = [
        "superseded settlements stay in the audit log but are hidden from "
        "player-facing final mechanics and battle-report public dice"
    ]
    if hp_receipt is not None:
        hints.append(
            f"HP corrected to {hp_receipt['hp_after']} "
            f"(was {hp_receipt['hp_before']}); correction itself is non-player-facing"
        )
    return data, [], hints

def _narration_budget(
    ctx: Ctx, investigator_id: str, applied_events: list[dict[str, Any]]
) -> dict[str, Any]:
    """Deterministic length budget by turn type; advisory guidance, never a gate."""
    event_types = {
        str(row.get("event_type") or "")
        for row in applied_events
        if isinstance(row, dict)
    }
    snapshot = _read_optional_json(
        ctx.campaign_dir / "save" / "sanity-state" / f"{investigator_id}.json", None
    )
    bout_active = bool(isinstance(snapshot, dict) and snapshot.get("bout_active"))
    if bout_active or event_types & {
        "bout_of_madness", "indefinite_insanity", "permanent_insanity", "session_ending",
    }:
        return {"mode": "climax_or_madness", "max_chars": 1500, "max_paragraphs": 8}
    if event_types & {"scene_transition", "major_reveal", "exceptional_effect_apply"}:
        return {"mode": "reveal_or_transition", "max_chars": 900, "max_paragraphs": 5}
    if event_types & {"hp_change", "sanity_loss", "luck_spend"}:
        return {"mode": "costly_result", "max_chars": 550, "max_paragraphs": 3}
    return {"mode": "routine_resolution", "max_chars": 350, "max_paragraphs": 2}

def _control_overrides(ctx: Ctx, investigator_id: str) -> list[dict[str, Any]]:
    """Active control-override receipts: the only scope in which the KP may
    portray the investigator's involuntary behavior (ownership matrix)."""
    overrides: list[dict[str, Any]] = []
    snapshot = _read_optional_json(
        ctx.campaign_dir / "save" / "sanity-state" / f"{investigator_id}.json", None
    )
    if isinstance(snapshot, dict):
        if snapshot.get("bout_active"):
            bout_id = str(snapshot.get("active_bout_id") or "").strip()
            overrides.append({
                "override_id": bout_id or (
                    "control-override-v1:"
                    + hashlib.sha256(
                        f"{investigator_id}:bout_of_madness".encode("utf-8")
                    ).hexdigest()[:32]
                ),
                "subject_ref": f"pc:{investigator_id}",
                "override_type": "bout_of_madness",
                "source_rule_id": "core.sanity.bout_realtime",
                "source_ref": f"sanity_bout:{bout_id or investigator_id}",
                "active": True,
                "active_bout_id": bout_id or None,
                "bout_rounds_remaining": snapshot.get("bout_rounds_remaining"),
                "expiry": {
                    "kind": "rounds_remaining",
                    "value": snapshot.get("bout_rounds_remaining"),
                },
                "allowed_scope": [
                    "forced behavior per the rolled bout table entry",
                    "no normal investigation actions while the bout lasts",
                ],
            })
        for kind in ("phobia", "mania"):
            trigger = snapshot.get(f"active_{kind}_trigger")
            if snapshot.get(kind) and isinstance(trigger, dict):
                source_ref = str(trigger.get("source_ref") or "").strip()
                if not source_ref:
                    continue
                overrides.append({
                    "override_id": "control-override-v1:" + hashlib.sha256(
                        f"{investigator_id}:{kind}:{source_ref}".encode("utf-8")
                    ).hexdigest()[:32],
                    "subject_ref": f"pc:{investigator_id}",
                    "override_type": kind,
                    "source_rule_id": f"core.sanity.{kind}",
                    "source_ref": source_ref,
                    "active": True,
                    "expiry": deepcopy(trigger.get("expiry")),
                    "name": snapshot[kind],
                    "allowed_scope": [
                        "rulebook-triggered avoidance/compulsion beats only",
                    ],
                })
    try:
        state = ctx.inv_state(investigator_id)
    except ToolError:
        state = {}
    conditions = {str(value) for value in (state.get("conditions") or [])}
    if "unconscious" in conditions or "dying" in conditions:
        condition = "dying" if "dying" in conditions else "unconscious"
        source_ref = f"investigator_state:{investigator_id}:condition:{condition}"
        overrides.append({
            "override_id": "control-override-v1:" + hashlib.sha256(
                f"{investigator_id}:{condition}".encode("utf-8")
            ).hexdigest()[:32],
            "subject_ref": f"pc:{investigator_id}",
            "override_type": "unconscious",
            "source_rule_id": "core.combat.unconscious",
            "source_ref": source_ref,
            "active": True,
            "expiry": {"kind": "condition_cleared", "condition": condition},
            "allowed_scope": ["no voluntary actions; physiological description only"],
        })
    return overrides

def _settled_narration_budget(
    ctx: Ctx, investigator_id: str, output_context: dict[str, Any]
) -> dict[str, Any]:
    bundle = output_context.get("mechanics_bundle") or {}
    events: list[dict[str, Any]] = []
    for effect in bundle.get("state_delta") or []:
        if not isinstance(effect, dict):
            continue
        kind = str(effect.get("effect_kind") or "")
        if kind == "scalar" and str(effect.get("resource") or "") in {"HP", "SAN"}:
            events.append({"event_type": "hp_change" if effect.get("resource") == "HP" else "sanity_loss"})
        elif kind == "scene_transition":
            events.append({"event_type": "scene_transition"})
    if bundle.get("exceptional_effect"):
        events.append({"event_type": "exceptional_effect_apply"})
    budget = _narration_budget(ctx, investigator_id, events)
    public_check_count = len([
        row for row in bundle.get("public_check") or []
        if isinstance(row, dict)
    ])
    # Default causal placement inserts each public check before the paragraph
    # containing its result. In the worst case every check has an independent
    # result paragraph, so all N results need one preceding setup paragraph.
    required_paragraphs = max(2, public_check_count + 1)
    if required_paragraphs > int(budget["max_paragraphs"]):
        extra_paragraphs = required_paragraphs - int(budget["max_paragraphs"])
        budget = {
            **budget,
            "max_chars": int(budget["max_chars"]) + 175 * extra_paragraphs,
            "max_paragraphs": required_paragraphs,
        }
    return budget

def _turn_contract_projection(
    ctx: Ctx, output_context: dict[str, Any]
) -> dict[str, Any]:
    journal_id = str(output_context.get("journal_decision_id") or "")
    player_rows = [
        row for row in _table_transcript_rows(ctx)
        if row.get("role") == "player"
        and row.get("journal_decision_id") == journal_id
    ]
    if len(player_rows) != 1:
        raise ToolError(
            "state_corrupt", "pending turn must have exactly one player transcript source"
        )
    player = player_rows[0]
    run_segment_id = str(player.get("run_segment_id") or "").strip()
    session_id = str(player.get("session_id") or "").strip()
    existing_projection = output_context.get("contract_projection")
    existing_authority = (
        existing_projection.get("agency_authority")
        if isinstance(existing_projection, dict) else None
    )
    settled_refs = [
        str(value)
        for value in (existing_authority or {}).get("pc_subject_refs") or []
        if isinstance(value, str) and value.strip()
    ]
    party_subject_refs = settled_refs or [f"pc:{value}" for value in ctx.party_ids()]
    investigator_id = (ctx.party_ids() or [""])[0]
    if not run_segment_id or not session_id:
        raise ToolError("state_corrupt", "pending turn identity is incomplete")
    try:
        identity = coc_state.load_run_identity(ctx.campaign_dir)
    except coc_state.UnsupportedSaveSchema as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    if identity is None:
        raise ToolError("state_corrupt", "canonical run identity is missing")
    if (
        identity["run_segment_id"] != run_segment_id
        or identity["session_id"] != session_id
        or identity["campaign_id"] != str(ctx.campaign_id)
    ):
        raise ToolError(
            "run_identity_conflict",
            "pending turn identity does not match the frozen run identity",
        )
    active_id = str(ctx.world().get("active_scene_id") or "") or None
    projection = {
        "schema_version": 1,
        "run_segment_id": run_segment_id,
        "session_id": session_id,
        "run_segment_identity": {
            "source": str(player.get("run_segment_source") or "transcript_frozen"),
            "trust": str(player.get("run_segment_trust") or "fallback"),
        },
        "session_identity": {
            "source": str(player.get("session_source") or "direct_toolbox_fallback"),
            "trust": str(player.get("session_trust") or "fallback"),
        },
        "turn_id": output_context["turn_id"],
        "source_digest": output_context["source_digest"],
        "settlement_snapshot_id": output_context["settlement_snapshot_id"],
        "player_input": {
            "source_ref": f"player_input:{journal_id}",
            "text_sha256": player["text_sha256"],
            "text": player["text"],
        },
        "scene_contract": _scene_contract_projection(ctx, active_id, ctx.world()),
        "narration_budget": _settled_narration_budget(
            ctx, investigator_id, output_context
        ),
        "control_overrides": (
            _control_overrides(ctx, investigator_id) if investigator_id else []
        ),
        "agency_authority": {
            "pc_subject_refs": party_subject_refs,
            "involuntary_physiology_sources": [{
                "source_ref": "narration_contract:involuntary_physiology",
                "source_type": "ownership_contract",
            }],
        },
        "agency_review_required": _pi_play_agency_review_required(),
        "settlement_source": {
            "journal_decision_id": journal_id,
            "mechanics_bundle_sha256": output_context["mechanics_bundle_sha256"],
            "obligation_ids": deepcopy(output_context["required_obligation_ids"]),
        },
    }
    return projection

def _tool_narration_brief(ctx: Ctx, args: dict[str, Any]):
    plan = args.get("candidate_plan")
    if not isinstance(plan, dict):
        raise ToolError("invalid_param", "candidate_plan must be an object")
    investigator_id = _resolve_investigator(ctx, args)
    sheet = ctx.sheet(investigator_id)
    events = args.get("applied_events") or []
    if not isinstance(events, list) or any(not isinstance(row, dict) for row in events):
        raise ToolError("invalid_param", "applied_events must be an array of objects")
    envelope = coc_narration_contract.build_narration_envelope(
        plan,
        clue_graph=ctx.clue_graph,
        epistemic_graph=ctx.scenario("epistemic-graph.json"),
        active_scene=_active_scene(ctx),
        investigator_display_name=str(
            sheet.get("name") or sheet.get("display_name") or investigator_id
        ),
        applied_events=events,
        route_completion_receipts=ctx.world().get("route_completion_receipts") or [],
    )
    budget = _narration_budget(ctx, investigator_id, events)
    control_overrides = _control_overrides(ctx, investigator_id)
    hints = [
        "when action_uptake contains a committed in-fiction action, naturally enact it before or alongside the settled outcome; do not merely echo the player",
        "write fresh player-facing prose from this envelope; never paste internal labels or raw JSON",
        "the KP owns the final narration and must preserve authoritative numerical results exactly",
        f"length budget ({budget['mode']}): ≤{budget['max_chars']} chars / ≤{budget['max_paragraphs']} paragraphs — write only what changed; never restate the player's own action",
    ]
    if control_overrides:
        hints.append(
            "portray investigator involuntary behavior ONLY within the listed "
            "control_overrides scope; everything else about the investigator's "
            "thoughts, beliefs, and decisions belongs to the player"
        )
    else:
        hints.append(
            "no active control override: the investigator's thoughts, beliefs, "
            "and decisions belong to the player — narrate only the world, NPCs, "
            "and involuntary physiology"
        )
    return {
        "schema_version": 1,
        "authority": "drafting_brief",
        "narration_envelope": envelope,
        "budget": budget,
        "control_overrides": control_overrides,
        "style_contract": coc_narration_style.player_facing_style_contract(
            _campaign_play_language(ctx)
        ),
    }, [], hints

def _review_has_agency_violation(review: dict[str, Any]) -> bool:
    return any(
        isinstance(finding, dict)
        and finding.get("rule_id") == "agency_violation"
        for finding in review.get("findings") or []
    )

_SPAN_REPAIR_INSTRUCTION = (
    "Only change the listed excerpts. Leave every other sentence byte-stable. "
    "Do not regenerate the scene."
)


def _span_repairs_for_review(
    *,
    draft: str,
    state_authority_review: dict[str, Any] | None,
    state_claim_compilation: dict[str, Any] | None,
    state_authority_gate: str,
    agency_gate: str,
) -> dict[str, Any] | None:
    if (
        state_authority_gate != "rewrite_required"
        and agency_gate != "rewrite_required"
    ):
        return None
    kp_claims = (
        state_authority_review.get("claims")
        if isinstance(state_authority_review, dict) else None
    ) or []
    kp_by_id = {
        str(claim.get("claim_id")): claim
        for claim in kp_claims
        if isinstance(claim, dict) and claim.get("claim_id")
    }
    spans: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    def add_span(excerpt: str, kind: str, reason: str) -> None:
        key = (excerpt, kind)
        if not excerpt or excerpt not in draft or key in seen:
            return
        seen.add(key)
        spans.append({
            "exact_excerpt": excerpt,
            "claim_kind": kind,
            "reason": reason,
            "repair": "rephrase_or_remove",
        })

    result = (
        state_claim_compilation.get("result")
        if isinstance(state_claim_compilation, dict) else None
    )
    for claim in (result.get("claims") if isinstance(result, dict) else []) or []:
        if not isinstance(claim, dict):
            continue
        matched_id = claim.get("matched_review_claim_id")
        matched = kp_by_id.get(matched_id) if isinstance(matched_id, str) else None
        grounded = (
            isinstance(matched, dict)
            and matched.get("subject_ref") == claim.get("subject_ref")
            and matched.get("claim_kind") == claim.get("claim_kind")
            and matched.get("source_effect_id")
        )
        if grounded:
            continue
        add_span(
            str(claim.get("exact_excerpt") or ""),
            str(claim.get("claim_kind") or ""),
            str(claim.get("reason") or ""),
        )
    for claim in kp_claims:
        if not isinstance(claim, dict) or claim.get("source_effect_id"):
            continue
        add_span(
            str(claim.get("exact_excerpt") or ""),
            str(claim.get("claim_kind") or ""),
            str(claim.get("reason") or ""),
        )
    if not spans:
        return None
    candidate = {
        "schema_version": 1,
        "contract_id": _SPAN_REPAIRS_CONTRACT_ID,
        "mode": _SPAN_REPAIRS_MODE,
        "spans": spans,
        "instruction": _SPAN_REPAIR_INSTRUCTION,
    }
    if not _valid_span_repairs(candidate):
        return None
    return candidate


def _latest_span_repairs(
    ctx: Ctx,
    *,
    turn_id: str,
    source_digest: str,
    baseline_text: str | None = None,
) -> dict[str, Any] | None:
    latest: dict[str, Any] | None = None
    for row in _jsonl_rows(ctx.campaign_dir / "logs" / "narration-reviews.jsonl"):
        if (
            row.get("turn_id") != turn_id
            or row.get("source_digest") != source_digest
        ):
            continue
        repairs = row.get("span_repairs")
        if isinstance(repairs, dict) and repairs.get("spans"):
            latest = deepcopy(repairs)
    if latest is None:
        return None
    # Never project malformed or unbounded repair evidence onto a card; the
    # excerpt-occurrence baseline is enforced by the Pi hydration validator.
    if not _valid_span_repairs(latest):
        return None
    return latest


def _review_requires_rewrite(review: dict[str, Any]) -> bool:
    return (
        _review_has_agency_violation(review)
        or review.get("state_authority_gate") == "rewrite_required"
    )

def _valid_narration_review_digest(review: dict[str, Any]) -> bool:
    digest = review.get("review_digest")
    if not isinstance(digest, str) or not digest:
        return False
    payload = deepcopy(review)
    payload.pop("review_digest", None)
    payload.pop("ts", None)
    return digest == _canonical_digest(payload)

def _tool_narration_advisory_review(
    ctx: Ctx, args: dict[str, Any]
) -> tuple[dict[str, Any], list[str], list[str]]:
    """Preserve the non-Pi advisory review without granting finalization authority."""
    decision_id = str(args.get("decision_id") or "").strip()
    if not decision_id:
        raise ToolError("invalid_param", "narration.review requires decision_id")
    prior = ctx.ledger_lookup("narration.review", decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previous review"
        ], []
    draft = str(args.get("draft_text") or "")
    if not draft.strip():
        raise ToolError("invalid_param", "draft_text is required")
    raw_findings = args.get("findings") or []
    if not isinstance(raw_findings, list):
        raise ToolError("invalid_param", "findings must be an array")
    findings: list[dict[str, str]] = []
    for index, finding in enumerate(raw_findings):
        if not isinstance(finding, dict):
            raise ToolError("invalid_param", f"findings[{index}] must be an object")
        rule_id = str(finding.get("rule_id") or "").strip()
        reason = str(finding.get("reason") or "").strip()
        if not rule_id or not reason:
            raise ToolError(
                "invalid_param",
                f"findings[{index}] requires rule_id and semantic reason",
            )
        findings.append({"rule_id": rule_id, "reason": reason})
    investigator_id = (
        _resolve_investigator(ctx, args)
        if args.get("investigator") is not None
        else ((ctx.party_ids() or [None])[0])
    )
    if investigator_id is not None:
        recent_events: list[dict[str, Any]] = []
        events_path = ctx.campaign_dir / "logs" / "events.jsonl"
        if events_path.is_file():
            for raw in events_path.read_text(encoding="utf-8").splitlines()[-12:]:
                try:
                    row = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if isinstance(row, dict):
                    recent_events.append(row)
        budget = _narration_budget(ctx, investigator_id, recent_events)
        if len(draft) > 2 * int(budget["max_chars"]):
            findings.append({
                "rule_id": "over_length",
                "reason": (
                    f"draft is {len(draft)} chars, over 2x the '{budget['mode']}' "
                    f"length budget ({budget['max_chars']}); recorded for audit, "
                    "delivery not blocked"
                ),
            })
    data = {
        "schema_version": 1,
        "visibility": "keeper_internal",
        "authority": "advisory",
        "hard_gate": False,
        "agency_hard_gate": False,
        "decision_id": decision_id,
        "draft_sha256": _canonical_digest(draft),
        "findings": findings,
        "recommendation": "consider_revision" if findings else "no_revision_suggested",
    }
    ctx.ledger_record(decision_id, "narration.review", data)
    coc_state.append_jsonl(
        ctx.campaign_dir / "logs" / "narration-reviews.jsonl",
        {**data, "ts": _now_iso()},
    )
    return data, [], [
        "the KP decides whether and how to revise; this advisory review never blocks delivery"
    ]

def _pending_authority_review_revision(
    ctx: Ctx, settled: dict[str, Any]
) -> int:
    """Return the only review revision legal for the frozen pending turn."""
    prior_rows = [
        row
        for row in _jsonl_rows(ctx.campaign_dir / "logs" / "narration-reviews.jsonl")
        if row.get("turn_id") == settled.get("turn_id")
        and row.get("source_digest") == settled.get("source_digest")
        and row.get("revision") == 1
        and _valid_narration_review_digest(row)
    ]
    return 2 if any(_review_requires_rewrite(row) for row in prior_rows) else 1

def _clear_review_replay_identity(
    *,
    turn_id: str,
    source_digest: str,
    revision: int,
    draft: str,
    findings: list[dict[str, Any]],
    kp_review: dict[str, Any] | None,
    settled: dict[str, Any],
) -> dict[str, Any]:
    return {
        "turn_id": turn_id,
        "source_digest": source_digest,
        "revision": revision,
        "draft_sha256": _canonical_digest(draft),
        "findings_digest": _canonical_digest(findings),
        "kp_review_digest": _canonical_digest(kp_review),
        "settlement_snapshot_id": settled.get("settlement_snapshot_id"),
        "mechanics_bundle_sha256": settled.get("mechanics_bundle_sha256"),
    }


def _row_clear_review_replay_identity(row: dict[str, Any]) -> dict[str, Any] | None:
    compilation = row.get("state_claim_compilation")
    binding = compilation.get("binding") if isinstance(compilation, dict) else None
    if not isinstance(binding, dict):
        return None
    snapshot = binding.get("settlement_snapshot_id")
    mechanics = binding.get("mechanics_bundle_sha256")
    if not snapshot or not mechanics:
        return None
    return {
        "turn_id": row.get("turn_id"),
        "source_digest": row.get("source_digest"),
        "revision": row.get("revision"),
        "draft_sha256": row.get("draft_sha256"),
        "findings_digest": _canonical_digest(row.get("findings") or []),
        "kp_review_digest": _canonical_digest(row.get("state_authority_review")),
        "settlement_snapshot_id": snapshot,
        "mechanics_bundle_sha256": mechanics,
    }


def _lookup_clear_review_replay(
    ctx: Ctx, identity: dict[str, Any]
) -> dict[str, Any] | None:
    matches: list[dict[str, Any]] = []
    for row in _jsonl_rows(ctx.campaign_dir / "logs" / "narration-reviews.jsonl"):
        if row.get("agency_gate") != "clear":
            continue
        if row.get("state_authority_gate") != "clear":
            continue
        if _row_clear_review_replay_identity(row) != identity:
            continue
        matches.append(row)
    return matches[0] if matches else None


def _narration_review_request_digest(args: dict[str, Any]) -> str:
    return _canonical_digest({
        key: deepcopy(args.get(key))
        for key in (
            "turn_id", "source_digest", "revision", "draft_text", "findings",
            "state_authority_review", "state_claim_compilation", "investigator",
        )
    })


def _validated_pending_draft_text(value: Any) -> tuple[str, int]:
    if not isinstance(value, str) or not value.strip():
        raise ToolError("invalid_param", "draft_text is required")
    if "\x00" in value:
        raise ToolError("invalid_param", "draft_text must not contain NUL")
    try:
        encoded = value.encode("utf-8", errors="strict")
    except UnicodeEncodeError as exc:
        raise ToolError("invalid_param", "draft_text must be valid Unicode") from exc
    if len(encoded) > _PENDING_DRAFT_MAX_UTF8_BYTES:
        raise ToolError(
            "draft_too_large",
            f"draft_text exceeds {_PENDING_DRAFT_MAX_UTF8_BYTES} UTF-8 bytes",
        )
    return value, len(encoded)


def _pending_draft_digest_payload(receipt: dict[str, Any]) -> dict[str, Any]:
    payload = deepcopy(receipt)
    payload.pop("receipt_digest", None)
    payload.pop("ts", None)
    return payload


def _sha256_digest_string(value: Any) -> bool:
    return (
        isinstance(value, str)
        and value.startswith("sha256:")
        and len(value) == 71
        and all(char in "0123456789abcdef" for char in value[7:])
    )


def _valid_pending_draft_provenance(receipt: dict[str, Any]) -> bool:
    provenance = receipt.get("provenance")
    if not isinstance(provenance, dict):
        return False
    producer_kind = receipt.get("producer_kind")
    if producer_kind == "narration_review_submission":
        return (
            set(provenance) == _PENDING_DRAFT_SUBMISSION_PROVENANCE_FIELDS
            and provenance.get("kind") == "direct_review_submission"
        )
    if producer_kind == "toolbox_audit_recovery":
        if set(provenance) != _PENDING_DRAFT_RECOVERY_PROVENANCE_FIELDS:
            return False
        row_count = provenance.get("source_row_count")
        return (
            provenance.get("kind") == "verified_toolbox_audit_recovery"
            and provenance.get("source_path")
            == "logs/toolbox-calls.jsonl"
            and isinstance(row_count, int)
            and not isinstance(row_count, bool)
            and 1 <= row_count <= _PENDING_DRAFT_MAX_PROVENANCE_ROWS
            and _sha256_digest_string(provenance.get("primary_row_digest"))
            and _sha256_digest_string(provenance.get("corroboration_digest"))
        )
    return False


def _valid_pending_draft_receipt(receipt: dict[str, Any]) -> bool:
    if not isinstance(receipt, dict):
        return False
    if set(receipt) - {"ts"} != _PENDING_DRAFT_FIELDS:
        return False
    revision = receipt.get("revision")
    if (
        receipt.get("schema_version") != 1
        or receipt.get("kind") != _PENDING_DRAFT_KIND
        or receipt.get("secrecy") != "keeper_only"
        or not isinstance(receipt.get("campaign_id"), str)
        or not receipt["campaign_id"].strip()
        or not isinstance(receipt.get("review_decision_id"), str)
        or not receipt["review_decision_id"].strip()
        or not isinstance(receipt.get("review_id"), str)
        or not receipt["review_id"].strip()
        or not isinstance(receipt.get("turn_id"), str)
        or not receipt["turn_id"].strip()
        or not isinstance(receipt.get("source_digest"), str)
        or not receipt["source_digest"].strip()
        or isinstance(revision, bool)
        or not isinstance(revision, int)
        or not 1 <= revision <= coc_turn_finalization.MAX_ACCEPTED_REVISION
        or receipt.get("source_operation") != _PENDING_DRAFT_SOURCE_OPERATION
        or not isinstance(receipt.get("materialization_decision_id"), str)
        or not receipt["materialization_decision_id"].strip()
        or receipt.get("producer_kind") not in _PENDING_DRAFT_PRODUCER_KINDS
    ):
        return False
    # Producer-specific materialization identity: a direct review submission
    # materializes under the review's own decision; an audit recovery
    # materializes under its own distinct recovery decision. Truthy
    # acceptance of either relationship is not valid.
    if receipt["producer_kind"] == "narration_review_submission":
        if receipt["materialization_decision_id"] != receipt["review_decision_id"]:
            return False
    elif receipt["materialization_decision_id"] == receipt["review_decision_id"]:
        return False
    if receipt.get("receipt_id") != (
        f"pending-narration-draft:{receipt['review_decision_id']}:"
        f"revision-{revision}"
    ):
        return False
    if not (
        isinstance(receipt.get("draft_text"), str)
        and isinstance(receipt.get("draft_utf8_bytes"), int)
        and not isinstance(receipt.get("draft_utf8_bytes"), bool)
        and _sha256_digest_string(receipt.get("draft_sha256"))
        and _sha256_digest_string(receipt.get("review_digest"))
        and _sha256_digest_string(receipt.get("request_digest"))
        and _sha256_digest_string(receipt.get("receipt_digest"))
        and _valid_pending_draft_provenance(receipt)
    ):
        return False
    try:
        encoded = receipt["draft_text"].encode("utf-8", errors="strict")
    except UnicodeEncodeError:
        return False
    return (
        b"\x00" not in encoded
        and 0 < len(encoded) <= _PENDING_DRAFT_MAX_UTF8_BYTES
        and receipt["draft_utf8_bytes"] == len(encoded)
        and receipt["draft_sha256"] == _canonical_digest(receipt["draft_text"])
        and receipt["receipt_digest"]
        == _canonical_digest(_pending_draft_digest_payload(receipt))
    )


def _build_pending_draft_receipt(
    ctx: Ctx,
    *,
    review: dict[str, Any],
    draft: str,
    draft_utf8_bytes: int,
    producer_kind: str,
    materialization_decision_id: str,
    provenance: dict[str, Any],
) -> dict[str, Any]:
    receipt = {
        "schema_version": 1,
        "kind": _PENDING_DRAFT_KIND,
        "secrecy": "keeper_only",
        "campaign_id": str(ctx.campaign_id),
        "receipt_id": (
            f"pending-narration-draft:{review['decision_id']}:"
            f"revision-{review['revision']}"
        ),
        "review_decision_id": str(review["decision_id"]),
        "review_id": str(review["review_id"]),
        "turn_id": str(review["turn_id"]),
        "source_digest": str(review["source_digest"]),
        "revision": int(review["revision"]),
        "draft_sha256": str(review["draft_sha256"]),
        "draft_text": draft,
        "draft_utf8_bytes": draft_utf8_bytes,
        "review_digest": str(review["review_digest"]),
        "request_digest": str(review["request_digest"]),
        "producer_kind": producer_kind,
        "source_operation": "narration.review",
        "materialization_decision_id": materialization_decision_id,
        "provenance": deepcopy(provenance),
    }
    receipt["receipt_digest"] = _canonical_digest(receipt)
    return receipt


def _append_or_reuse_pending_draft(
    ctx: Ctx, receipt: dict[str, Any]
) -> dict[str, Any]:
    rows = [
        row for row in _jsonl_rows(ctx.campaign_dir / _PENDING_DRAFT_RELATIVE)
        if row.get("review_id") == receipt.get("review_id")
        or row.get("receipt_id") == receipt.get("receipt_id")
    ]
    if rows:
        if len(rows) != 1 or not _valid_pending_draft_receipt(rows[0]):
            raise ToolError("pending_draft_corrupt", "pending narration draft identity is duplicated or invalid")
        prior = deepcopy(rows[0])
        prior.pop("ts", None)
        if prior != receipt:
            raise ToolError("idempotency_conflict", "pending narration draft identity owns different bytes or binding")
        return prior
    coc_state.append_jsonl(
        ctx.campaign_dir / _PENDING_DRAFT_RELATIVE,
        {**receipt, "ts": _now_iso()},
    )
    return deepcopy(receipt)


def _append_or_reuse_narration_review(ctx: Ctx, review: dict[str, Any]) -> None:
    rows = [
        row for row in _jsonl_rows(ctx.campaign_dir / "logs" / "narration-reviews.jsonl")
        if row.get("review_id") == review.get("review_id")
        or row.get("decision_id") == review.get("decision_id")
    ]
    if rows:
        if len(rows) != 1:
            raise ToolError("state_corrupt", "narration review identity is duplicated")
        prior = deepcopy(rows[0])
        prior.pop("ts", None)
        if prior != review:
            raise ToolError("idempotency_conflict", "narration review identity owns different evidence")
        return
    coc_state.append_jsonl(
        ctx.campaign_dir / "logs" / "narration-reviews.jsonl",
        {**review, "ts": _now_iso()},
    )


def _tool_narration_review(ctx: Ctx, args: dict[str, Any]):
    bound_fields = ("turn_id", "source_digest", "revision")
    if not _pi_play_agency_review_required() and not any(
        args.get(key) is not None for key in bound_fields
    ):
        return _tool_narration_advisory_review(ctx, args)
    decision_id = str(args.get("decision_id") or "").strip()
    revision = args.get("revision")
    if (
        not decision_id or isinstance(revision, bool) or not isinstance(revision, int)
        or revision < 1 or revision > coc_turn_finalization.MAX_ACCEPTED_REVISION
    ):
        raise ToolError("invalid_param", "narration.review requires decision_id and revision 1 or 2")
    request_digest = _narration_review_request_digest(args)
    prior = ctx.ledger_lookup("narration.review", args.get("decision_id"))
    if prior is not None:
        if (prior.get("data") or {}).get("request_digest") != request_digest:
            raise ToolError(
                "idempotency_conflict",
                "narration.review decision_id already owns another turn/revision/draft/findings request",
            )
        return prior.get("data"), ["duplicate decision_id: returning the previous review"], []
    draft, draft_utf8_bytes = _validated_pending_draft_text(args.get("draft_text"))
    raw_findings = args.get("findings") or []
    if not isinstance(raw_findings, list):
        raise ToolError("invalid_param", "findings must be an array")
    allowed_rule_ids = {
        "agency_violation", "semantic_repetition", "scope_overreach", "over_length",
    }
    findings: list[dict[str, Any]] = []
    for index, finding in enumerate(raw_findings):
        if not isinstance(finding, dict):
            raise ToolError("invalid_param", f"findings[{index}] must be an object")
        if set(finding) != {"rule_id", "subject_ref", "source_ref", "reason"}:
            raise ToolError("invalid_param", f"findings[{index}] must use the exact closed schema")
        rule_id = str(finding.get("rule_id") or "").strip()
        reason = str(finding.get("reason") or "").strip()
        if rule_id not in allowed_rule_ids or not reason:
            raise ToolError(
                "invalid_param",
                f"findings[{index}] requires rule_id and semantic reason",
            )
        subject_ref = finding.get("subject_ref")
        source_ref = finding.get("source_ref")
        if subject_ref is not None and (not isinstance(subject_ref, str) or not subject_ref.strip()):
            raise ToolError("invalid_param", f"findings[{index}].subject_ref is invalid")
        if source_ref is not None and (not isinstance(source_ref, str) or not source_ref.strip()):
            raise ToolError("invalid_param", f"findings[{index}].source_ref is invalid")
        findings.append({
            "rule_id": rule_id,
            "subject_ref": subject_ref,
            "source_ref": source_ref,
            "reason": reason,
        })
    pending = coc_turn_manifest.pending_manifest(ctx.campaign_dir)
    if pending is not None:
        settled = coc_turn_finalization.build_output_context(ctx.campaign_dir)
        expected_revision = 1
    else:
        finalizations = coc_turn_finalization.load_finalizations(ctx.campaign_dir)
        settled = finalizations[-1] if finalizations else {}
        expected_revision = int(settled.get("accepted_revision") or 0) + 1
    pending_review_revision = None
    if pending is not None and _pi_play_agency_review_required():
        pending_review_revision = _pending_authority_review_revision(ctx, settled)
    if (
        args.get("turn_id") != settled.get("turn_id")
        or args.get("source_digest") != settled.get("source_digest")
        or revision != (
            pending_review_revision
            if pending_review_revision is not None
            else expected_revision
        )
        or revision > coc_turn_finalization.MAX_ACCEPTED_REVISION
    ):
        raise ToolError(
            "turn_source_changed",
            "narration.review does not match the current frozen turn/source/next revision",
        )
    investigator_id = (
        _resolve_investigator(ctx, args)
        if args.get("investigator") is not None
        else ((ctx.party_ids() or [None])[0])
    )
    if investigator_id is not None:
        recent_events: list[dict[str, Any]] = []
        events_path = ctx.campaign_dir / "logs" / "events.jsonl"
        if events_path.is_file():
            for raw in events_path.read_text(encoding="utf-8").splitlines()[-12:]:
                try:
                    row = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if isinstance(row, dict):
                    recent_events.append(row)
        budget = _narration_budget(ctx, investigator_id, recent_events)
        if len(draft) > 2 * int(budget["max_chars"]):
            findings.append({
                "rule_id": "over_length",
                "subject_ref": None,
                "source_ref": None,
                "reason": (
                    f"draft is {len(draft)} chars, over 2x the '{budget['mode']}' "
                    f"length budget ({budget['max_chars']}); recorded for audit, "
                    "delivery not blocked"
                ),
            })
    pc_subject_refs = {f"pc:{value}" for value in ctx.party_ids()}
    for index, finding in enumerate(findings):
        if finding["rule_id"] != "agency_violation":
            continue
        if (
            finding.get("subject_ref") not in pc_subject_refs
            or finding.get("source_ref") is not None
        ):
            raise ToolError(
                "invalid_param",
                f"findings[{index}] agency_violation must name a current PC and source_ref=null; authorized claims belong in turn.finalize.agency_claims",
            )
    try:
        state_authority_review, state_authority_gate = (
            coc_state_authority.normalize_review(
                args.get("state_authority_review"),
                draft=draft,
                settled=settled,
                party_ids=ctx.party_ids(),
                required=_pi_play_agency_review_required(),
            )
        )
        if _pi_play_agency_review_required():
            prior_clear = _lookup_clear_review_replay(
                ctx,
                _clear_review_replay_identity(
                    turn_id=str(args["turn_id"]),
                    source_digest=str(args["source_digest"]),
                    revision=revision,
                    draft=draft,
                    findings=findings,
                    kp_review=state_authority_review,
                    settled=settled,
                ),
            )
            if prior_clear is not None:
                data = deepcopy(prior_clear)
                data.pop("ts", None)
                ctx.ledger_record(args["decision_id"], "narration.review", {
                    **data,
                    "decision_id": decision_id,
                    "request_digest": request_digest,
                    "replayed_from_review_id": data.get("review_id"),
                })
                return data, [], [
                    "replayed existing clear review_id for this exact draft and KP review; host compiler was not required",
                    "in Pi, use the refreshed finalize_agency_binding semantic spans; the host binds this review, frozen draft, exact agency excerpts, and canonical sources",
                ]
        state_claim_compilation, compiler_gate = (
            coc_state_authority.normalize_compiler_receipt(
                args.get("state_claim_compilation"),
                draft=draft,
                settled=settled,
                party_ids=ctx.party_ids(),
                turn_id=str(args["turn_id"]),
                source_digest=str(args["source_digest"]),
                revision=revision,
                kp_review=state_authority_review,
                required=_pi_play_agency_review_required(),
            )
        )
        state_claim_review_disagreement = compiler_gate == "rewrite_required"
        if compiler_gate == "rewrite_required":
            state_authority_gate = "rewrite_required"
    except coc_state_authority.StateAuthorityError as exc:
        raise ToolError(exc.code, str(exc)) from exc
    review_id = "narration-review-v1:" + hashlib.sha256(
        f"{ctx.campaign_id}:{decision_id}".encode("utf-8")
    ).hexdigest()[:40]
    data = {
        "schema_version": 1,
        "visibility": "keeper_internal",
        "authority": "advisory",
        "hard_gate": False,
        "agency_hard_gate": _pi_play_agency_review_required(),
        "state_authority_hard_gate": _pi_play_agency_review_required(),
        "decision_id": decision_id,
        "review_id": review_id,
        "turn_id": str(args["turn_id"]),
        "source_digest": str(args["source_digest"]),
        "revision": revision,
        "draft_sha256": _canonical_digest(draft),
        "request_digest": request_digest,
        "findings": findings,
        "agency_gate": (
            (
                "rewrite_required"
                if _review_has_agency_violation({"findings": findings})
                else "clear"
            )
            if _pi_play_agency_review_required() else "advisory"
        ),
        "state_authority_review": state_authority_review,
        "state_claim_compilation": state_claim_compilation,
        "state_claim_review_disagreement": state_claim_review_disagreement,
        "state_authority_gate": state_authority_gate,
    }
    if _review_requires_rewrite(data):
        data["recommendation"] = "revision_required"
    elif findings:
        data["recommendation"] = "consider_revision"
    else:
        data["recommendation"] = "no_revision_suggested"
    span_repairs = _span_repairs_for_review(
        draft=draft,
        state_authority_review=state_authority_review,
        state_claim_compilation=state_claim_compilation,
        state_authority_gate=str(state_authority_gate),
        agency_gate=str(data["agency_gate"]),
    )
    if span_repairs is not None:
        data["span_repairs"] = span_repairs
    data["review_digest"] = _canonical_digest(data)
    _append_or_reuse_pending_draft(
        ctx,
        _build_pending_draft_receipt(
            ctx,
            review=data,
            draft=draft,
            draft_utf8_bytes=draft_utf8_bytes,
            producer_kind="narration_review_submission",
            materialization_decision_id=decision_id,
            provenance={"kind": "direct_review_submission"},
        ),
    )
    _append_or_reuse_narration_review(ctx, data)
    ctx.ledger_record(args["decision_id"], "narration.review", data)
    hints = [
        "non-agency findings remain advisory; the KP decides whether and how to revise them"
    ]
    if data["agency_gate"] == "rewrite_required":
        hints.append(
            "agency ownership is a hard review boundary: do not finalize this draft or rerun settlement; rewrite prose only and review revision 2; prose-quality findings remain advisory"
        )
    if data["state_authority_gate"] == "rewrite_required":
        hints.append(
            "player-state authority is ungrounded: do not finalize or mutate the frozen settlement; remove/defer the claim in narration-only revision 2"
        )
    if data.get("span_repairs"):
        hints.append(
            "span_repairs lists the only excerpts to change; leave every other sentence byte-stable and do not regenerate the scene"
        )
    if (
        data["agency_gate"] != "rewrite_required"
        and data["state_authority_gate"] != "rewrite_required"
    ):
        hints.append(
            "in Pi, use the refreshed finalize_agency_binding semantic spans; the host binds this review, frozen draft, exact agency excerpts, and canonical sources"
        )
    return data, [], hints


def _pending_draft_for_review(
    ctx: Ctx, review: dict[str, Any]
) -> tuple[dict[str, Any] | None, str]:
    related = [
        row for row in _jsonl_rows(ctx.campaign_dir / _PENDING_DRAFT_RELATIVE)
        if row.get("review_id") == review.get("review_id")
        or row.get("review_decision_id") == review.get("decision_id")
    ]
    if not related:
        return None, "missing"
    if len(related) != 1:
        return None, "ambiguous"
    receipt = related[0]
    if not _valid_pending_draft_receipt(receipt):
        return None, "invalid"
    expected = {
        "campaign_id": str(ctx.campaign_id),
        "review_decision_id": review.get("decision_id"),
        "review_id": review.get("review_id"),
        "turn_id": review.get("turn_id"),
        "source_digest": review.get("source_digest"),
        "revision": review.get("revision"),
        "draft_sha256": review.get("draft_sha256"),
        "review_digest": review.get("review_digest"),
        "request_digest": review.get("request_digest"),
    }
    if any(receipt.get(key) != value for key, value in expected.items()):
        return None, "binding_mismatch"
    clean = deepcopy(receipt)
    clean.pop("ts", None)
    return clean, "available"


def _active_pending_review(
    ctx: Ctx, *, turn_id: str, source_digest: str, required_revision: int
) -> tuple[dict[str, Any] | None, str]:
    rows = [
        row for row in _jsonl_rows(ctx.campaign_dir / "logs" / "narration-reviews.jsonl")
        if row.get("turn_id") == turn_id
        and row.get("source_digest") == source_digest
        and isinstance(row.get("revision"), int)
        and not isinstance(row.get("revision"), bool)
        and row.get("revision") <= required_revision
        and _valid_narration_review_digest(row)
    ]
    if not rows:
        return None, "not_submitted"
    highest = max(int(row["revision"]) for row in rows)
    active = [row for row in rows if row.get("revision") == highest]
    if len(active) != 1:
        return None, "ambiguous_review"
    return active[0], "submitted"


def _tool_state_recover_pending_narration_draft(
    ctx: Ctx, args: dict[str, Any]
):
    decision_id = str(args.get("decision_id") or "").strip()
    review_decision_id = str(args.get("review_decision_id") or "").strip()
    if not decision_id or not review_decision_id:
        raise ToolError(
            "invalid_param",
            "state.recover_pending_narration_draft requires decision_id and review_decision_id",
        )
    recovery_request_digest = _canonical_digest({
        "review_decision_id": review_decision_id,
    })
    prior = ctx.ledger_lookup(
        "state.recover_pending_narration_draft", decision_id
    )
    if prior is not None:
        prior_data = prior.get("data") or {}
        if prior_data.get("recovery_request_digest") != recovery_request_digest:
            raise ToolError(
                "idempotency_conflict",
                "recovery decision_id already owns another review identity",
            )
        return deepcopy(prior_data), [
            "duplicate decision_id: returning the canonical pending draft receipt"
        ], []
    reviews = [
        row for row in _jsonl_rows(ctx.campaign_dir / "logs" / "narration-reviews.jsonl")
        if row.get("decision_id") == review_decision_id
    ]
    if len(reviews) != 1 or not _valid_narration_review_digest(reviews[0]):
        raise ToolError(
            "pending_draft_recovery_review_invalid",
            "review identity is missing, duplicated, or digest-invalid",
        )
    review = reviews[0]
    pending = coc_turn_manifest.pending_manifest(ctx.campaign_dir)
    if pending is None:
        raise ToolError("no_unfinalized_journal", "pending narration draft recovery requires an unfinalized turn")
    settled = coc_turn_finalization.build_output_context(ctx.campaign_dir)
    if (
        review.get("turn_id") != settled.get("turn_id")
        or review.get("source_digest") != settled.get("source_digest")
    ):
        raise ToolError(
            "pending_draft_recovery_identity_mismatch",
            "review does not bind the current pending turn/source",
        )
    existing, existing_status = _pending_draft_for_review(ctx, review)
    if existing is not None:
        data = {
            **existing,
            "recovery_request_digest": recovery_request_digest,
        }
        ctx.ledger_record(
            decision_id, "state.recover_pending_narration_draft", data
        )
        return data, ["canonical pending draft receipt already existed"], []
    if existing_status != "missing":
        raise ToolError(
            "pending_draft_corrupt",
            f"canonical pending draft receipt is {existing_status}",
        )
    matching_audit_rows: list[dict[str, Any]] = []
    invalid_matching_rows = 0
    for row in _jsonl_rows(ctx.campaign_dir / "logs" / "toolbox-calls.jsonl"):
        args_row = row.get("args") if isinstance(row.get("args"), dict) else {}
        if row.get("tool") != "narration.review" or args_row.get("decision_id") != review_decision_id:
            continue
        data_row = row.get("data") if isinstance(row.get("data"), dict) else {}
        draft_value = args_row.get("draft_text")
        try:
            draft_text, draft_utf8_bytes = _validated_pending_draft_text(draft_value)
        except ToolError:
            invalid_matching_rows += 1
            continue
        if (
            row.get("ok") is not True
            or args_row.get("turn_id") != review.get("turn_id")
            or args_row.get("source_digest") != review.get("source_digest")
            or args_row.get("revision") != review.get("revision")
            or _narration_review_request_digest(args_row) != review.get("request_digest")
            or _canonical_digest(draft_text) != review.get("draft_sha256")
            or data_row.get("review_id") != review.get("review_id")
            or data_row.get("review_digest") != review.get("review_digest")
            or data_row.get("request_digest") != review.get("request_digest")
        ):
            invalid_matching_rows += 1
            continue
        matching_audit_rows.append({
            "draft_text": draft_text,
            "draft_utf8_bytes": draft_utf8_bytes,
            "row_digest": _canonical_digest(row),
            "request_digest": review.get("request_digest"),
            "review_id": review.get("review_id"),
        })
    if invalid_matching_rows:
        raise ToolError(
            "pending_draft_recovery_evidence_mismatch",
            "matching narration.review audit evidence is malformed or identity-mismatched",
        )
    unique = {
        _canonical_digest({
            "draft_text": row["draft_text"],
            "request_digest": row["request_digest"],
            "review_id": row["review_id"],
        })
        for row in matching_audit_rows
    }
    if not matching_audit_rows:
        raise ToolError(
            "pending_draft_recovery_evidence_missing",
            "no matching successful narration.review audit candidate exists",
        )
    if len(unique) != 1:
        raise ToolError(
            "pending_draft_recovery_evidence_ambiguous",
            "matching narration.review audit evidence contains distinct drafts or identities",
        )
    if len(matching_audit_rows) > _PENDING_DRAFT_MAX_PROVENANCE_ROWS:
        raise ToolError(
            "pending_draft_recovery_evidence_ambiguous",
            "matching narration.review audit evidence exceeds the bounded corroboration count",
        )
    candidate = matching_audit_rows[0]
    row_digests = sorted({
        row["row_digest"] for row in matching_audit_rows
    })
    receipt = _build_pending_draft_receipt(
        ctx,
        review=review,
        draft=candidate["draft_text"],
        draft_utf8_bytes=candidate["draft_utf8_bytes"],
        producer_kind="toolbox_audit_recovery",
        materialization_decision_id=decision_id,
        provenance={
            "kind": "verified_toolbox_audit_recovery",
            "source_path": "logs/toolbox-calls.jsonl",
            "source_row_count": len(matching_audit_rows),
            "primary_row_digest": row_digests[0],
            "corroboration_digest": _canonical_digest(row_digests),
        },
    )
    receipt = _append_or_reuse_pending_draft(ctx, receipt)
    data = {**receipt, "recovery_request_digest": recovery_request_digest}
    ctx.ledger_record(decision_id, "state.recover_pending_narration_draft", data)
    return data, [], [
        "materialized one exact keeper-only pending draft from verified structured narration.review audit evidence"
    ]


_UNDELIVERED_OUTPUT_REPAIR_RELATIVE = (
    Path("logs") / "undelivered-output-repairs.jsonl"
)

def _required_exact_player_text(args: dict[str, Any]) -> str:
    """Validate transcript evidence without interpreting the player's meaning."""
    player_text = args.get("player_text")
    if not isinstance(player_text, str) or not player_text.strip():
        raise ToolError(
            "invalid_param",
            "state.journal requires nonblank exact player_text",
        )
    return player_text

def _record_journal_player_transcript_entry(
    ctx: Ctx,
    *,
    player_text: str,
    run_id: str,
    turn_number: int,
    turn_id: str,
    journal_decision_id: str,
    speaker: str,
    run_segment_source: str,
    run_segment_trust: str,
) -> dict[str, Any]:
    """Write or recover the one exact player row owned by a journal receipt."""
    player_rows = [
        row for row in _table_transcript_rows(ctx)
        if row.get("role") == "player"
        and row.get("journal_decision_id") == journal_decision_id
    ]
    if len(player_rows) > 1:
        raise ToolError(
            "state_corrupt",
            f"journal '{journal_decision_id}' has multiple exact player transcript rows",
        )
    if player_rows:
        prior = player_rows[0]
        if prior.get("text") != player_text:
            raise ToolError(
                "idempotency_conflict",
                f"journal '{journal_decision_id}' already owns different exact player_text",
            )
        return deepcopy(prior)
    return _record_table_transcript_entry(
        ctx,
        role="player",
        text=player_text,
        run_id=run_id,
        turn_number=turn_number,
        turn_id=turn_id,
        journal_decision_id=journal_decision_id,
        source_id=journal_decision_id,
        speaker=speaker,
        run_segment_source=run_segment_source,
        run_segment_trust=run_segment_trust,
    )

def _record_finalized_keeper_text(ctx: Ctx, receipt: dict[str, Any]) -> dict[str, Any]:
    journal_decision_id = str(receipt.get("journal_decision_id") or "")
    player_rows = [
        row for row in _table_transcript_rows(ctx)
        if row.get("role") == "player"
        and row.get("journal_decision_id") == journal_decision_id
    ]
    if len(player_rows) > 1:
        raise ToolError(
            "state_corrupt",
            f"journal '{journal_decision_id}' has multiple exact player transcript rows",
        )
    player_row = player_rows[0] if player_rows else {}
    run_id = str(player_row.get("run_id") or coc_npc_event_chain.resolve_run_id(ctx.campaign_dir))
    turn_number = player_row.get("turn")
    if isinstance(turn_number, bool) or not isinstance(turn_number, int):
        turn_number = int(ctx.pacing().get("turn_number") or 0)
    turn_id = str(player_row.get("turn_id") or f"journal:{journal_decision_id}")
    finalization_id = str(receipt.get("finalization_id") or "")
    return _record_table_transcript_entry(
        ctx,
        role="keeper",
        text=str(receipt.get("rendered_text") or ""),
        run_id=run_id,
        turn_number=turn_number,
        turn_id=turn_id,
        journal_decision_id=journal_decision_id,
        source_id=finalization_id,
        speaker="KP",
        finalization_id=finalization_id,
        session_id=str(receipt["session_id"]),
        accepted_revision=int(receipt["accepted_revision"]),
        rendered_text_sha256=str(receipt["rendered_text_sha256"]),
    )

def _replace_undelivered_finalization_artifacts(
    ctx: Ctx,
    *,
    source_receipt: dict[str, Any],
    replacement_receipt: dict[str, Any],
) -> dict[str, Any]:
    """Atomically swap the unpublished canonical tail and retain an audit copy."""
    finalization_path = (
        ctx.campaign_dir
        / "logs"
        / coc_turn_finalization.FINALIZATION_FILENAME
    )
    transcript_path = ctx.campaign_dir / _TABLE_TRANSCRIPT_RELATIVE
    try:
        original_finalization_text = finalization_path.read_text(encoding="utf-8")
        original_transcript_text = transcript_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise ToolError(
            "state_corrupt", "cannot read finalized output artifacts for repair"
        ) from exc

    finalizations = coc_turn_finalization.load_finalizations(ctx.campaign_dir)
    if not finalizations or finalizations[-1] != source_receipt:
        raise ToolError(
            "repair_conflict", "repair source is not the latest finalization"
        )
    transcript_rows = _table_transcript_rows(ctx)
    matches = [
        index
        for index, row in enumerate(transcript_rows)
        if row.get("role") == "keeper"
        and row.get("journal_decision_id")
        == source_receipt["journal_decision_id"]
        and row.get("finalization_id") == source_receipt["finalization_id"]
    ]
    if len(matches) != 1:
        raise ToolError(
            "state_corrupt",
            "undelivered finalization does not have exactly one Keeper transcript row",
        )
    transcript_index = matches[0]
    original_transcript_row = deepcopy(transcript_rows[transcript_index])
    replacement_id = str(replacement_receipt["finalization_id"])
    replacement_text = str(replacement_receipt["rendered_text"])
    replacement_transcript_row = {
        **original_transcript_row,
        "entry_id": _table_transcript_entry_id("keeper", replacement_id),
        "text": replacement_text,
        "text_sha256": str(replacement_receipt["rendered_text_sha256"]),
        "rendered_text_sha256": str(replacement_receipt["rendered_text_sha256"]),
        "source_id": replacement_id,
        "source_ref": f"logs/turn-finalizations.jsonl#{replacement_id}",
        "finalization_id": replacement_id,
        "accepted_revision": int(replacement_receipt["accepted_revision"]),
        "run_segment_id": str(replacement_receipt["run_segment_id"]),
        "session_id": str(replacement_receipt["session_id"]),
        "ts": _now_iso(),
    }
    finalizations[-1] = deepcopy(replacement_receipt)
    transcript_rows[transcript_index] = replacement_transcript_row
    repaired_finalization_text = "".join(
        json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n"
        for row in finalizations
    )
    repaired_transcript_text = "".join(
        json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n"
        for row in transcript_rows
    )
    repair_audit = {
        "schema_version": 1,
        "kind": "coc_undelivered_output_repair",
        "repair_id": (
            "undelivered-output-repair-v1:"
            + hashlib.sha256(
                json.dumps(
                    [
                        source_receipt["finalization_id"],
                        replacement_id,
                        replacement_receipt["decision_id"],
                    ],
                    ensure_ascii=False,
                    separators=(",", ":"),
                ).encode("utf-8")
            ).hexdigest()[:40]
        ),
        "campaign_id": ctx.campaign_id,
        "journal_decision_id": source_receipt["journal_decision_id"],
        "source_finalization": deepcopy(source_receipt),
        "source_transcript_row": original_transcript_row,
        "replacement_finalization_id": replacement_id,
        "source_accepted_revision": source_receipt["accepted_revision"],
        "source_rendered_text_sha256": source_receipt["rendered_text_sha256"],
        "replacement_accepted_revision": replacement_receipt["accepted_revision"],
        "replacement_rendered_text_sha256": replacement_receipt["rendered_text_sha256"],
        "decision_id": replacement_receipt["decision_id"],
        "created_at": _now_iso(),
    }
    audit_path = ctx.campaign_dir / _UNDELIVERED_OUTPUT_REPAIR_RELATIVE
    try:
        coc_fileio.write_text_atomic(
            finalization_path, repaired_finalization_text
        )
        coc_fileio.write_text_atomic(transcript_path, repaired_transcript_text)
        coc_state.append_jsonl(audit_path, repair_audit)
    except Exception as exc:
        coc_fileio.write_text_atomic(
            finalization_path, original_finalization_text
        )
        coc_fileio.write_text_atomic(transcript_path, original_transcript_text)
        raise ToolError(
            "repair_failed", "undelivered output repair did not commit atomically"
        ) from exc
    return {
        "repair": repair_audit,
        "transcript": replacement_transcript_row,
    }

def _tool_state_journal(ctx: Ctx, args: dict[str, Any]):
    decision_id = str(args.get("decision_id") or "").strip()
    if not decision_id:
        raise ToolError("invalid_param", "state.journal requires a stable decision_id")
    player_text = _required_exact_player_text(args)
    try:
        source_boundary = coc_turn_manifest.effective_source_boundary(
            ctx.campaign_dir
        )
    except coc_turn_manifest.TurnManifestError as exc:
        raise ToolError(exc.code, str(exc)) from exc
    if source_boundary["cursor_close_owner"] == "evidence.table_opening":
        raise ToolError(
            "table_opening_required",
            "record evidence.table_opening before the first player journal",
        )
    prior = ctx.ledger_lookup("state.journal", decision_id)
    if prior is not None:
        prior_data = prior.get("data") or {}
        try:
            replay_delta = coc_continuation.normalize_semantic_delta(
                args.get("continuation"),
                turn_number=int(prior_data.get("turn_number") or 0),
            )
        except coc_continuation.ContinuationError as exc:
            raise ToolError(exc.code, str(exc)) from exc
        if replay_delta != (prior_data.get("continuation_delta") or {}):
            raise ToolError(
                "idempotency_conflict",
                "state.journal decision_id already owns a different continuation delta",
            )
        run_binding = _run_segment_binding(
            ctx, supplied_alias=args.get("run_id")
        )
        run_id = str(run_binding["run_segment_id"])
        _record_journal_player_transcript_entry(
            ctx,
            player_text=player_text,
            run_id=run_id,
            turn_number=int(prior_data.get("turn_number") or 0),
            turn_id=str(prior_data.get("turn_id") or ""),
            journal_decision_id=decision_id,
            speaker=str(args.get("player_speaker") or "Player"),
            run_segment_source=str(run_binding["source"]),
            run_segment_trust=str(run_binding["trust"]),
        )
        return prior.get("data"), ["duplicate decision_id: returning the previously settled result"], []
    # Resolve and validate the immutable run segment before delivery
    # acknowledgement or any pacing/event/summary/manifest/transcript write.
    # A conflicting fresh decision must leave the entire turn tail untouched.
    run_binding = _run_segment_binding(
        ctx, supplied_alias=args.get("run_id")
    )
    run_id = str(run_binding["run_segment_id"])
    try:
        pending = coc_turn_manifest.pending_manifest(ctx.campaign_dir)
    except coc_turn_manifest.TurnManifestError as exc:
        raise ToolError(exc.code, str(exc)) from exc
    if pending is not None and pending["journal_decision_id"] != decision_id:
        raise ToolError(
            "turn_finalization_pending",
            "the previous journaled turn must be finalized or repaired before another turn can close",
        )
    pacing = ctx.pacing()
    next_turn_number = int(pacing.get("turn_number") or 0) + 1
    try:
        continuation_delta = coc_continuation.normalize_semantic_delta(
            args.get("continuation"), turn_number=next_turn_number
        )
    except coc_continuation.ContinuationError as exc:
        raise ToolError(exc.code, str(exc)) from exc
    pacing["turn_number"] = next_turn_number
    warnings: list[str] = []
    # A later player message is not transport evidence for the preceding
    # Keeper output. Only the host may acknowledge the exact hash-bound text
    # through session.delivery_ack after it was actually streamed.
    if args.get("tension"):
        tension = str(args["tension"])
        if tension in ("low", "medium", "high", "climax"):
            pacing["tension_level"] = tension
        else:
            warnings.append(f"unknown tension '{tension}' — kept '{pacing.get('tension_level')}'")
    if args.get("intent_class"):
        recent = [str(i) for i in (pacing.get("recent_intent_classes") or [])]
        recent.append(str(args["intent_class"]))
        pacing["recent_intent_classes"] = recent[-8:]
    ctx.save_pacing(pacing)

    ctx.log_event({
        "event_type": "turn",
        "turn_number": pacing["turn_number"],
        "player_action": args.get("player_action"),
        "summary": str(args["summary"]),
    })
    _declared_payload: dict[str, Any] = {
        "_v": 1,
        "declared_kind": _journal_declared_kind(args),
    }
    _declared_note = str(args.get("player_action") or "").strip()
    if _declared_note:
        _declared_payload["note"] = _declared_note[:400]
    emit_core_canonical_event(
        ctx,
        event_type="player-declared",
        source="coc_operation_turn_output.journal",
        decision_id=f"{decision_id}-declared",
        data=_declared_payload,
        turn=int(pacing["turn_number"]),
    )
    emit_core_canonical_event(
        ctx,
        event_type="turn-started",
        source="coc_operation_turn_output.journal",
        decision_id=f"{decision_id}-turn-started",
        data={"_v": 1},
        turn=int(pacing["turn_number"]),
    )
    coc_state.append_jsonl(
        ctx.campaign_dir / "memory" / "session-summaries.jsonl",
        {
            "ts": _now_iso(),
            "turn_number": pacing["turn_number"],
            "summary": str(args["summary"]),
            "continuation_delta": continuation_delta,
        },
    )
    try:
        manifest = coc_turn_manifest.start_pending_turn(
            ctx.campaign_dir,
            journal_decision_id=decision_id,
            turn_number=pacing["turn_number"],
        )
    except coc_turn_manifest.TurnManifestError as exc:
        raise ToolError(exc.code, str(exc)) from exc
    data = {
        "turn_number": pacing["turn_number"],
        "tension_level": pacing.get("tension_level"),
        "turn_id": manifest["turn_id"],
        "continuation_delta": continuation_delta,
    }
    _record_journal_player_transcript_entry(
        ctx,
        player_text=player_text,
        run_id=run_id,
        turn_number=pacing["turn_number"],
        turn_id=manifest["turn_id"],
        journal_decision_id=decision_id,
        speaker=str(args.get("player_speaker") or "Player"),
        run_segment_source=str(run_binding["source"]),
        run_segment_trust=str(run_binding["trust"]),
    )
    ctx.ledger_record(decision_id, "state.journal", data)
    return data, warnings, []

def _normalize_finalized_advisory_uptake(
    ctx: Ctx,
    raw: Any,
    *,
    draft: Any,
) -> dict[str, Any] | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ToolError("invalid_param", "advisory_uptake must be an object")
    common = {
        "advice_id", "disposition", "reason", "adopted_fields",
        "exact_excerpt",
    }
    candidate_fields = {"candidate_ref", "storylet_candidate"}
    if not common.issubset(raw) or not set(raw).issubset(common | candidate_fields):
        raise ToolError(
            "invalid_param", "advisory_uptake must use the exact closed schema"
        )
    present_candidate_fields = [
        field for field in candidate_fields if raw.get(field) is not None
    ]
    if len(present_candidate_fields) != 1:
        raise ToolError(
            "invalid_param",
            "advisory_uptake requires exactly one of candidate_ref or legacy storylet_candidate",
        )
    disposition = str(raw.get("disposition") or "").strip()
    if disposition not in {"adopted", "modified"}:
        raise ToolError(
            "invalid_param",
            "turn.finalize advisory_uptake records only adopted or modified candidates; ignored advice stays optional evidence.record_adoption",
        )
    candidate_ref = str(raw.get("candidate_ref") or "").strip()
    if candidate_ref:
        candidate = _resolve_storylet_candidate_ref(
            ctx,
            advice_id=raw.get("advice_id"),
            candidate_ref=candidate_ref,
        )
    else:
        candidate = raw.get("storylet_candidate")
        if not isinstance(candidate, dict) or not str(
            candidate.get("storylet_id") or ""
        ).strip():
            raise ToolError(
                "invalid_param", "advisory_uptake requires the exact Storylet candidate"
            )
        candidate_ref = _storylet_candidate_ref(raw.get("advice_id"), candidate)
    if not _storylet_advice_matches_candidate(raw.get("advice_id"), candidate):
        raise ToolError(
            "invalid_param", "advisory_uptake advice_id does not bind this candidate"
        )
    reason = str(raw.get("reason") or "").strip()
    fields = raw.get("adopted_fields")
    excerpt = str(raw.get("exact_excerpt") or "").strip()
    if not reason:
        raise ToolError("invalid_param", "advisory_uptake.reason is required")
    if (
        not isinstance(fields, list) or not fields
        or any(not isinstance(value, str) or not value.strip() for value in fields)
    ):
        raise ToolError(
            "invalid_param", "advisory_uptake.adopted_fields must be non-empty strings"
        )
    if not isinstance(draft, str) or not excerpt or excerpt not in draft:
        raise ToolError(
            "excerpt_mismatch",
            "advisory_uptake.exact_excerpt must occur verbatim in the finalized draft",
        )
    return {
        "advice_id": str(raw["advice_id"]),
        "disposition": disposition,
        "reason": reason,
        "adopted_fields": [str(value).strip() for value in fields],
        "candidate_ref": candidate_ref,
        "storylet_candidate": deepcopy(candidate),
        "exact_excerpt": excerpt,
    }

def _record_finalized_advisory_uptake(
    ctx: Ctx,
    *,
    uptake: dict[str, Any] | None,
    finalization: dict[str, Any],
) -> tuple[list[str], list[str]]:
    if uptake is None:
        return [], []
    _data, warnings, hints = _tool_evidence_record_adoption(ctx, {
        "decision_id": str(finalization["decision_id"]) + ":storylet-uptake",
        "advice_id": uptake["advice_id"],
        "disposition": uptake["disposition"],
        "reason": uptake["reason"],
        "adopted_fields": uptake["adopted_fields"],
        "candidate_ref": uptake["candidate_ref"],
        "finalization_id": finalization["finalization_id"],
        "exact_excerpt": uptake["exact_excerpt"],
    })
    return warnings, hints

def _recompute_state_authority_gate(
    ctx: Ctx,
    *,
    row: dict[str, Any],
    draft: str,
    settled: dict[str, Any],
    turn_id: str,
    source_digest: str,
    revision: int,
) -> str:
    """Re-evaluate the bound review against current settlement, not its stamp."""
    try:
        review, kp_gate = coc_state_authority.normalize_review(
            row.get("state_authority_review"),
            draft=draft,
            settled=settled,
            party_ids=ctx.party_ids(),
            required=True,
        )
        _compilation, compiler_gate = coc_state_authority.normalize_compiler_receipt(
            row.get("state_claim_compilation"),
            draft=draft,
            settled=settled,
            party_ids=ctx.party_ids(),
            turn_id=turn_id,
            source_digest=source_digest,
            revision=revision,
            kp_review=review,
            required=True,
        )
    except coc_state_authority.StateAuthorityError:
        return str(row.get("state_authority_gate") or "rewrite_required")
    if kp_gate == "rewrite_required" or compiler_gate == "rewrite_required":
        return "rewrite_required"
    return "clear"


def _resolve_bound_narration_review(
    ctx: Ctx,
    *,
    review_id: Any,
    turn_id: str | None,
    source_digest: str | None,
    revision: int,
    draft: str,
) -> dict[str, Any] | None:
    pending = coc_turn_manifest.pending_manifest(ctx.campaign_dir)
    if pending is not None:
        current = coc_turn_finalization.build_output_context(ctx.campaign_dir)
        current_projection = _turn_contract_projection(ctx, current)
    else:
        finalizations = coc_turn_finalization.load_finalizations(ctx.campaign_dir)
        current = finalizations[-1] if finalizations else {}
        current_projection = (
            current.get("contract_projection")
            if isinstance(current.get("contract_projection"), dict) else {}
        )
    agency_review_required = current_projection.get("agency_review_required") is True
    if review_id is None:
        if agency_review_required:
            raise ToolError(
                "narration_review_required",
                "Pi play turn.finalize requires an exact bound narration.review for this draft revision",
            )
        return None
    clean_id = str(review_id).strip()
    if not clean_id:
        raise ToolError("invalid_param", "narration_review_id must be non-empty")
    matches = [
        row for row in _jsonl_rows(
            ctx.campaign_dir / "logs" / "narration-reviews.jsonl"
        )
        if row.get("review_id") == clean_id
    ]
    if len(matches) != 1:
        raise ToolError("narration_review_mismatch", "narration review id is missing or duplicated")
    row = matches[0]
    if not _valid_narration_review_digest(row):
        raise ToolError(
            "narration_review_mismatch", "narration review digest is invalid"
        )
    expected_turn = turn_id
    expected_source = source_digest
    if expected_turn is None or expected_source is None:
        if pending is not None:
            expected_turn = str(current["turn_id"])
            expected_source = str(current["source_digest"])
        else:
            expected_turn = str(current.get("turn_id") or "")
            expected_source = str(current.get("source_digest") or "")
    if (
        row.get("turn_id") != expected_turn
        or row.get("source_digest") != expected_source
        or row.get("revision") != revision
        or row.get("draft_sha256") != _canonical_digest(draft)
    ):
        raise ToolError(
            "narration_review_mismatch",
            "narration review does not bind this exact turn/source/revision/draft",
        )
    if agency_review_required:
        if _recompute_state_authority_gate(
            ctx,
            row=row,
            draft=draft,
            settled=current,
            turn_id=str(expected_turn),
            source_digest=str(expected_source),
            revision=revision,
        ) == "rewrite_required":
            raise ToolError(
                "state_authority_review_blocked",
                "the bound review identifies a player-state claim without a matching current frozen effect; keep the settlement frozen, rewrite narration only, and review revision 2",
            )
        if _review_has_agency_violation(row):
            raise ToolError(
                "agency_review_blocked",
                "the bound review identifies an unauthorized PC agency claim; keep the settlement frozen, rewrite narration only, and review revision 2",
            )
        if pending is not None:
            expected_revision = _pending_authority_review_revision(ctx, current)
            if revision != expected_revision:
                raise ToolError(
                    "narration_review_mismatch",
                    f"the frozen pending turn requires narration review revision {expected_revision}",
                )
    return {
        "review_id": clean_id,
        "review_digest": str(row.get("review_digest") or ""),
        "draft_sha256": str(row.get("draft_sha256") or ""),
    }

_DRAFTING_INJECTION_PUBLIC_KEYS = (
    "effect_id",
    "effect_kind",
    "investigator_id",
    "resource",
    "before",
    "after",
    "delta",
    "label",
    "item_id",
    "action",
    "quantity",
    "condition",
    "amount",
    "currency",
    "charged_amount",
    "balance_before",
    "balance_after",
    "player_time_after",
    "delta_minutes",
    "rest_kind",
)

_DRAFTING_INJECTION_RULE = (
    "Finalize will insert these settled player-state changes as mechanical "
    "blocks keyed by effect_id. Narrate the fictional beat; do not assert a "
    "second current completion of the same cash, item, condition, time, rest, "
    "or scalar change unless that excerpt is bound to the listed effect_id in "
    "state_authority_review."
)


def _drafting_injection_brief(settled: dict[str, Any]) -> dict[str, Any]:
    """Project finalize-inserted player-state effects for drafting, not keywords."""
    bundle = settled.get("mechanics_bundle")
    rows: list[dict[str, Any]] = []
    if isinstance(bundle, dict):
        for bucket in ("state_delta", "asset_delta"):
            for raw in bundle.get(bucket) or []:
                if not isinstance(raw, dict):
                    continue
                effect_id = str(raw.get("effect_id") or "").strip()
                effect_kind = str(raw.get("effect_kind") or "").strip()
                if not effect_id or not effect_kind:
                    continue
                injection = {
                    key: deepcopy(raw[key])
                    for key in _DRAFTING_INJECTION_PUBLIC_KEYS
                    if key in raw and raw[key] is not None
                }
                injection["effect_id"] = effect_id
                injection["effect_kind"] = effect_kind
                rows.append(injection)
    return {
        "schema_version": 1,
        "contract_id": "coc.drafting-injection-brief.v1",
        "injections": rows,
        "drafting_rule": _DRAFTING_INJECTION_RULE,
    }


def _tool_turn_output_context(ctx: Ctx, args: dict[str, Any]):
    try:
        data = coc_turn_finalization.build_output_context(ctx.campaign_dir)
    except coc_turn_finalization.TurnContractError as exc:
        raise ToolError(exc.code, str(exc)) from exc
    current_window = coc_turn_manifest.resume_window(
        ctx.campaign_dir,
        meaningful_tools=_turn_recovery_meaningful_tools(),
    )
    data["narrative_opportunity"] = _latest_narrative_opportunity(
        current_window
    )
    data["drafting_injection_brief"] = _drafting_injection_brief(data)
    contract_projection = _turn_contract_projection(ctx, data)
    data["contract_projection"] = contract_projection
    data["contract_projection_sha256"] = _canonical_digest(contract_projection)
    agency_review_required = contract_projection["agency_review_required"] is True
    agency_review_revision = (
        _pending_authority_review_revision(ctx, data)
        if agency_review_required else 1
    )
    draft_contract_usable = True
    draft_status = "not_applicable"
    if agency_review_required:
        active_review, draft_status = _active_pending_review(
            ctx,
            turn_id=str(data["turn_id"]),
            source_digest=str(data["source_digest"]),
            required_revision=agency_review_revision,
        )
        if active_review is not None:
            frozen_draft, draft_status = _pending_draft_for_review(
                ctx, active_review
            )
            if frozen_draft is not None:
                data["frozen_narration_draft"] = frozen_draft
            else:
                draft_contract_usable = False
        elif draft_status != "not_submitted":
            draft_contract_usable = False
    data["pending_narration_draft_status"] = {
        "schema_version": 1,
        "secrecy": "keeper_only",
        "status": draft_status,
        "actionable": draft_contract_usable,
        **(
            {}
            if draft_contract_usable
            else {
                "diagnostic": (
                    "canonical pending narration draft evidence is unavailable, "
                    "ambiguous, invalid, or identity-mismatched; run the explicit "
                    "operator recovery operation and refresh output context"
                )
            }
        ),
    }
    if agency_review_required and draft_contract_usable:
        data["agency_review_operation"] = {
            "operation": "narration.review",
            "invoke_via": "coc_narration_review",
            "prefilled_arguments": {
                "turn_id": data["turn_id"],
                "source_digest": data["source_digest"],
                "revision": agency_review_revision,
            },
            "missing_arguments": [
                "decision_id", "draft_text", "findings",
                "state_authority_review",
            ],
            "discovery_required": False,
            "authority": "semantic_agency_and_player_state_review",
            "hard_gate_scope": "agency_and_player_state_authority_only",
            "host_state_claim_compiler_required": True,
        }
        prior_span_repairs = _latest_span_repairs(
            ctx,
            turn_id=str(data["turn_id"]),
            source_digest=str(data["source_digest"]),
        )
        if prior_span_repairs is not None:
            data["agency_review_operation"]["span_repairs"] = prior_span_repairs
    required_obligation_ids = [
        str(obligation_id)
        for obligation_id in data.get("required_obligation_ids") or []
        if isinstance(obligation_id, str) and obligation_id
    ]
    prefilled_arguments: dict[str, Any] = {}
    journal_decision_id = data.get("journal_decision_id")
    if isinstance(journal_decision_id, str) and journal_decision_id:
        prefilled_arguments["decision_id"] = (
            f"{journal_decision_id}:finalize"
        )
    missing_arguments = ["draft"]
    prefilled_arguments["revision"] = agency_review_revision
    if required_obligation_ids:
        missing_arguments.append("coverage")
    else:
        prefilled_arguments["coverage"] = []
    if agency_review_required:
        missing_arguments.extend(["narration_review_id", "agency_claims"])
    if draft_contract_usable:
        data["finalize_operation"] = {
            "operation": "turn.finalize",
            "invoke_via": (
                "coc_turn_finalize" if agency_review_required else "coc_invoke"
            ),
            "prefilled_arguments": prefilled_arguments,
            "missing_arguments": missing_arguments,
            "discovery_required": False,
            "authority": "settled_output_completeness",
            "hard_gate": True,
        }
    return data, [], [
        "draft fiction from obligations; related sources may share an exact_excerpt, but every obligation_id needs exactly one coverage row",
        "npc_performance_constraints are Keeper-only: portray observable_manner naturally, but never print causal_explanation, opportunity_or_friction, or boundary_preserved as a player-facing analysis block",
        "missing_substantive_effects and pending_modifier_consumptions are hard blockers proving settlement was incomplete; never disguise them in prose",
        "split the draft into causal paragraphs and normally omit mechanics_placements: the finalizer inserts each public roll before its coverage result paragraph and groups later changes exactly once; provide explicit placements only when deliberate interleaving improves the scene",
        "mechanics_bundle text and arithmetic are deterministic; do not copy, recompute, or paraphrase their numbers in fictional paragraphs",
        "draft from drafting_injection_brief: those effect_id rows are finalize-inserted; do not assert a second current completion unless bound in state_authority_review",
        "if narrative_opportunity actually shaped the draft, pass advisory_uptake with an exact draft excerpt to turn.finalize; only then is the Storylet ledger updated",
        *(
            [
                "Pi play authority boundary: review this exact draft through agency_review_operation before turn.finalize; declare every player-state claim in state_authority_review and bind it to the exact current effect id; unauthorized PC agency or ungrounded state claims require prose-only revision 2, while prose-quality findings remain advisory",
                "do not rerun rules, state writes, state.journal, coverage, or mechanics when rewriting a rejected narration revision",
            ]
            if agency_review_required else []
        ),
    ]

def _tool_turn_finalize(ctx: Ctx, args: dict[str, Any]):
    decision_id = str(args["decision_id"])
    revision = args.get("revision")
    if isinstance(revision, bool) or not isinstance(revision, int):
        raise ToolError("invalid_param", "turn.finalize revision is required")
    agency_claims = args.get("agency_claims") or []
    narration_review = _resolve_bound_narration_review(
        ctx,
        review_id=args.get("narration_review_id"),
        turn_id=None,
        source_digest=None,
        revision=revision,
        draft=str(args.get("draft") or ""),
    )
    uptake = _normalize_finalized_advisory_uptake(
        ctx,
        args.get("advisory_uptake"), draft=args.get("draft")
    )

    def record_uptake(
        finalization: dict[str, Any],
    ) -> tuple[list[str], list[str]]:
        try:
            return _record_finalized_advisory_uptake(
                ctx, uptake=uptake, finalization=finalization
            )
        except (OSError, ValueError, ToolError) as exc:
            return [
                "finalized Storylet uptake evidence was not persisted; replay "
                f"this exact turn.finalize call to recover it: {exc}"
            ], []

    existing = coc_turn_finalization.finalization_by_decision(
        ctx.campaign_dir, decision_id
    )
    if existing is not None:
        if not coc_turn_finalization.replay_matches(
            existing,
            draft=args.get("draft"),
            coverage=args.get("coverage"),
            mechanics_placements=args.get("mechanics_placements"),
            revision=revision,
            narration_review=narration_review,
            agency_claims=agency_claims,
            campaign_dir=ctx.campaign_dir,
        ):
            raise ToolError(
                "revision_conflict",
                f"decision_id '{decision_id}' already owns a different narration revision or draft",
            )
        _record_finalized_keeper_text(ctx, existing)
        uptake_warnings, uptake_hints = record_uptake(existing)
        return deepcopy(existing), [
            "duplicate decision_id: returning the immutable final turn output",
            *uptake_warnings,
        ], [
            "echo rendered_text exactly; do not prepend, append, or rewrite it",
            *uptake_hints,
        ]
    if args.get("validate_only"):
        try:
            coc_turn_finalization.build_finalization_receipt(
                ctx.campaign_dir,
                decision_id=decision_id,
                draft=args.get("draft"),
                coverage=args.get("coverage"),
                mechanics_placements=args.get("mechanics_placements"),
                revision=revision,
                contract_projection=_turn_contract_projection(
                    ctx, coc_turn_finalization.build_output_context(ctx.campaign_dir)
                ),
                narration_review=narration_review,
                agency_claims=agency_claims,
            )
        except coc_turn_finalization.TurnContractError as exc:
            raise ToolError(exc.code, str(exc), violations=exc.violations) from exc
        return (
            {"would_finalize": True, "violations": []},
            [],
            [
                "validate_only preflight: no receipt was written; call "
                "turn.finalize without validate_only to commit this exact payload",
            ],
        )
    repair_finalization_id = str(
        args.get("repair_finalization_id") or ""
    ).strip()
    if repair_finalization_id:
        finalizations = coc_turn_finalization.load_finalizations(
            ctx.campaign_dir
        )
        if (
            not finalizations
            or finalizations[-1].get("finalization_id")
            != repair_finalization_id
        ):
            raise ToolError(
                "repair_conflict",
                "repair_finalization_id must name the latest canonical output",
            )
        checkpoint, checkpoint_warnings = (
            coc_continuation.ensure_latest_checkpoint(ctx.campaign_dir)
        )
        if checkpoint is None:
            raise ToolError(
                "state_corrupt", "latest finalized output has no recovery checkpoint"
            )
        delivery = coc_continuation.delivery_projection(
            ctx.campaign_dir, checkpoint
        )
        if (
            delivery.get("finalization_id") != repair_finalization_id
            or delivery.get("status") != "unconfirmed"
        ):
            raise ToolError(
                "delivery_conflict",
                "only the latest delivery-unconfirmed output may receive a narration repair",
            )
        try:
            receipt = coc_turn_finalization.build_undelivered_repair_receipt(
                ctx.campaign_dir,
                source_receipt=finalizations[-1],
                decision_id=decision_id,
                draft=args.get("draft"),
                coverage=args.get("coverage"),
                mechanics_placements=args.get("mechanics_placements"),
                revision=revision,
                narration_review=narration_review,
                agency_claims=agency_claims,
            )
        except coc_turn_finalization.TurnContractError as exc:
            raise ToolError(exc.code, str(exc), violations=exc.violations) from exc
        replacement = _replace_undelivered_finalization_artifacts(
            ctx,
            source_receipt=finalizations[-1],
            replacement_receipt=receipt,
        )
        uptake_warnings, uptake_hints = record_uptake(receipt)
        return receipt, [*checkpoint_warnings, *uptake_warnings], [
            "undelivered narration repaired without rerunning rules, state, or the journal",
            f"repair audit: logs/undelivered-output-repairs.jsonl#{replacement['repair']['repair_id']}",
            "echo rendered_text exactly; direct-host output is contract-invalid if any text or number is changed",
            *uptake_hints,
        ]
    try:
        receipt = coc_turn_finalization.build_finalization_receipt(
            ctx.campaign_dir,
            decision_id=decision_id,
            draft=args.get("draft"),
            coverage=args.get("coverage"),
            mechanics_placements=args.get("mechanics_placements"),
            revision=revision,
            contract_projection=_turn_contract_projection(
                ctx, coc_turn_finalization.build_output_context(ctx.campaign_dir)
            ),
            narration_review=narration_review,
            agency_claims=agency_claims,
        )
        coc_turn_finalization.append_finalization(ctx.campaign_dir, receipt)
        _record_finalized_keeper_text(ctx, receipt)
    except coc_turn_finalization.TurnContractError as exc:
        raise ToolError(exc.code, str(exc), violations=exc.violations) from exc
    uptake_warnings, uptake_hints = record_uptake(receipt)
    return receipt, uptake_warnings, [
        "echo rendered_text exactly; direct-host output is contract-invalid if any text or number is changed",
        "a narration-only repair uses the same settled journal and never reruns rules or state",
        *uptake_hints,
    ]

def _development_finalizer(
    ctx: Ctx,
    ending: dict[str, Any] | None,
) -> dict[str, Any]:
    """Synchronously settle deterministic post-ending bookkeeping.

    This is deliberately not a narrative gate.  Exhausted retries leave the
    ending in place and return structured pending evidence for later replay.
    """
    if ending is None:
        return {
            "status": "PENDING",
            "ending_id": None,
            "settlements": [],
            "error": "persisted ending evidence is unavailable",
        }
    frozen = ending.get("investigator_ids")
    if not isinstance(frozen, list) or not all(
        isinstance(value, str) for value in frozen
    ):
        return {
            "status": "PENDING",
            "ending_id": ending.get("ending_id"),
            "settlements": [],
            "error": "persisted ending target contract is invalid",
        }
    unique_ids = list(dict.fromkeys(value for value in frozen if value))
    if not unique_ids:
        return {
            "status": "PASS",
            "ending_id": ending["ending_id"],
            "settlements": [],
        }
    settlements: list[dict[str, Any]] = []
    for investigator_id in unique_ids:
        last_error: str | None = None
        for attempt in range(1, _TOOL_TRANSIENT_RETRY_ATTEMPTS + 1):
            try:
                receipt = coc_runtime_ops.settle_development(
                    ctx.campaign_dir,
                    investigator_id,
                    rng=_ending_rng(ending, investigator_id),
                    ending_id=str(ending["ending_id"]),
                )
            except Exception as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                if attempt < _TOOL_TRANSIENT_RETRY_ATTEMPTS:
                    time.sleep(_TOOL_TRANSIENT_RETRY_DELAY_SECONDS * attempt)
                    continue
                settlements.append({
                    "investigator_id": investigator_id,
                    "status": "PENDING",
                    "attempts": attempt,
                    "error": last_error,
                })
            else:
                settlements.append({
                    "investigator_id": investigator_id,
                    "status": "PASS",
                    "attempts": attempt,
                    "receipt": receipt,
                })
            break
    status = (
        "PASS"
        if settlements and all(row.get("status") == "PASS" for row in settlements)
        else "PENDING"
    )
    return {
        "status": status,
        "ending_id": ending["ending_id"],
        "settlements": settlements,
    }

def _record_settlement_pending(ctx: Ctx, development: dict[str, Any]) -> None:
    ending_id = development.get("ending_id")
    path = ctx.campaign_dir / "logs" / "events.jsonl"
    existing: set[tuple[str, str]] = set()
    if path.is_file():
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict) and row.get("event_type") == "development_settlement_pending":
                existing.add((
                    str(row.get("ending_id") or ""),
                    str(row.get("investigator_id") or ""),
                ))
    for settlement in development.get("settlements") or []:
        if not isinstance(settlement, dict) or settlement.get("status") != "PENDING":
            continue
        investigator_id = str(settlement.get("investigator_id") or "")
        key = (str(ending_id or ""), investigator_id)
        if key in existing:
            continue
        ctx.log_event({
            "event_type": "development_settlement_pending",
            "ending_id": ending_id,
            "investigator_id": investigator_id,
            "attempts": settlement.get("attempts"),
            "error": settlement.get("error"),
        })
        existing.add(key)

def _normalized_investigator_ids(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    normalized: list[str] = []
    for value in values:
        if not isinstance(value, str) or not value:
            continue
        if _SAFE_ID.fullmatch(value) is None:
            raise ToolError(
                "invalid_param", "investigator id must be a stable safe id"
            )
        if value not in normalized:
            normalized.append(value)
    return normalized

def _requested_ending_targets(ctx: Ctx, args: dict[str, Any]) -> list[str]:
    return _normalized_investigator_ids(
        [str(args["investigator"])]
        if args.get("investigator") else ctx.party_ids()
    )

def _ending_target_retry_conflict(
    ctx: Ctx,
    args: dict[str, Any],
    frozen_ids: list[str],
) -> dict[str, Any] | None:
    requested_ids = _requested_ending_targets(ctx, args)
    if requested_ids == frozen_ids:
        return None
    return {
        "code": "SETTLEMENT_TARGET_CONFLICT",
        "frozen_investigator_ids": list(frozen_ids),
        "retry_investigator_ids": requested_ids,
        "resolution": "frozen_targets_preserved",
    }

def _tool_state_end_session(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("state.end_session", args.get("decision_id"))
    if prior is not None:
        data = deepcopy(prior.get("data") or {})
        frozen_present = isinstance(data.get("investigator_ids"), list)
        frozen_ids = _normalized_investigator_ids(data.get("investigator_ids"))
        if not frozen_present:
            frozen_ids = _normalized_investigator_ids([
                row.get("investigator_id")
                for row in (data.get("development") or {}).get("settlements", [])
                if isinstance(row, dict)
            ])
            frozen_present = bool(frozen_ids)
        target_conflict = _ending_target_retry_conflict(
            ctx, args, frozen_ids
        ) if frozen_present else None
        if target_conflict is not None:
            data["retry_target_conflict"] = target_conflict
        development = data.get("development")
        if not isinstance(development, dict) or development.get("status") != "PASS":
            ending = coc_development.structured_ending_evidence(
                ctx.campaign_dir,
                ending_id=(
                    str(data["ending_id"]) if data.get("ending_id") else None
                ),
                decision_id=(
                    None if data.get("ending_id") else str(args["decision_id"])
                ),
            )
            development = _development_finalizer(ctx, ending)
            data["development"] = development
            if development.get("ending_id") is not None:
                data["ending_id"] = development.get("ending_id")
            data["investigator_ids"] = frozen_ids
            ctx.ledger_record(args.get("decision_id"), "state.end_session", data)
            if development.get("status") != "PASS":
                _record_settlement_pending(ctx, development)
                warnings = [
                    "duplicate ending receipt replayed; development settlement remains pending"
                ]
                if target_conflict is not None:
                    warnings.append(
                        "SETTLEMENT_TARGET_CONFLICT: retry target set differed; the persisted ending targets were preserved"
                    )
                return data, warnings, [
                    "retry state.end_session or development.settle with the same decision identity"
                ]
            warnings = [
                "duplicate ending receipt replayed; pending development settlement completed"
            ]
            if target_conflict is not None:
                warnings.append(
                    "SETTLEMENT_TARGET_CONFLICT: retry target set differed; the persisted ending targets were preserved"
                )
            return data, warnings, []
        warnings = ["duplicate decision_id: returning the previously settled result"]
        if target_conflict is not None:
            warnings.append(
                "SETTLEMENT_TARGET_CONFLICT: retry target set differed; the persisted ending targets were preserved"
            )
        return data, warnings, []
    decision_id = str(args["decision_id"])
    existing_ending: dict[str, Any] | None = None
    target_conflict: dict[str, Any] | None = None
    event_path = ctx.campaign_dir / "logs" / "events.jsonl"
    if event_path.is_file():
        for line in reversed(event_path.read_text(encoding="utf-8").splitlines()):
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if (
                isinstance(row, dict)
                and row.get("event_type") == "session_ending"
                and row.get("decision_id") == decision_id
            ):
                existing_ending = row
                break
    if existing_ending is not None:
        scene_id = existing_ending.get("scene_id")
        kind = str(existing_ending.get("kind") or "conclusion")
        frozen_present = isinstance(existing_ending.get("investigator_ids"), list)
        targets = _normalized_investigator_ids(existing_ending.get("investigator_ids"))
        if not frozen_present:
            # Legacy crash receipts predate frozen targets.  Freeze them once
            # in the reconstructed toolbox receipt; new endings always persist
            # them in the event itself before settlement begins.
            targets = _requested_ending_targets(ctx, args)
        else:
            target_conflict = _ending_target_retry_conflict(ctx, args, targets)
        ending = coc_development.structured_ending_evidence(
            ctx.campaign_dir,
            ending_id=(
                str(existing_ending["ending_id"])
                if existing_ending.get("ending_id") else None
            ),
            decision_id=(
                None if existing_ending.get("ending_id") else decision_id
            ),
        )
    else:
        try:
            ending = coc_development.ending_settlement_capsule_for_decision(
                ctx.campaign_dir, decision_id
            )
        except ValueError as exc:
            raise ToolError(
                "development_settlement_failed", str(exc)
            ) from exc
        if ending is not None:
            # A capsule may be the sole durable artifact after a process exit
            # between capsule persistence and event append.  Reconstruct the
            # event from that capsule, never from the now-current scene/party.
            scene_id = ending.get("scene_id")
            kind = str(ending.get("kind") or "conclusion")
            targets = _normalized_investigator_ids(
                ending.get("investigator_ids")
            )
            target_conflict = _ending_target_retry_conflict(
                ctx, args, targets
            )
            record = {
                "event_type": "session_ending",
                "event_id": ending["event_id"],
                "ending_id": ending["ending_id"],
                "scene_id": scene_id,
                "kind": kind,
                "decision_id": decision_id,
                "investigator_ids": targets,
                "ts": ending["captured_at"],
            }
            if ending.get("summary") is not None:
                record["summary"] = ending["summary"]
            capsule_path = coc_development.ending_settlement_capsule_path(
                ctx.campaign_dir, ending["ending_id"]
            )
        else:
            world = ctx.world()
            scene_id = world.get("active_scene_id")
            kind = str(args.get("kind") or "conclusion")
            if kind not in {"conclusion", "tpk", "retreat", "cliffhanger"}:
                raise ToolError(
                    "invalid_param",
                    "kind must be conclusion, tpk, retreat, or cliffhanger",
                )
            targets = _requested_ending_targets(ctx, args)
            record = {
                "event_type": "session_ending",
                "scene_id": scene_id,
                "kind": kind,
                "decision_id": decision_id,
                "investigator_ids": targets,
                "ts": _now_iso(),
            }
            if args.get("summary"):
                record["summary"] = str(args["summary"])
            record["ending_id"] = coc_development.ending_id_for_event(record)
            record["event_id"] = coc_development.ending_event_id(
                record["ending_id"]
            )
            # Claim shared reusable tick inputs while holding every target's
            # lock.  The surrounding transaction owns the campaign lock, so
            # the global order remains campaign -> investigator.
            with ExitStack() as input_locks:
                for investigator_id in sorted(set(targets)):
                    lock_path = (
                        ctx.coc_root
                        / "locks"
                        / "investigators"
                        / investigator_id
                        / ".investigator.lock"
                    )
                    if not coc_development._safe_campaign_child_target(
                        ctx.coc_root, lock_path
                    ):
                        raise ToolError(
                            "development_settlement_failed",
                            "investigator lock target is unsafe",
                        )
                    input_locks.enter_context(coc_fileio.advisory_file_lock(
                        lock_path,
                        wait_seconds=5.0,
                    ))
                capsule_path = coc_development.ending_settlement_capsule_path(
                    ctx.campaign_dir, record["ending_id"]
                )
                if capsule_path.exists() or capsule_path.is_symlink():
                    raise ToolError(
                        "development_settlement_failed",
                        "persisted ending settlement capsule is invalid",
                    )
                ending = coc_development.build_ending_settlement_capsule(
                    ctx.campaign_dir, record
                )
                capsule_path = coc_development.persist_ending_settlement_capsule(
                    ctx.campaign_dir, ending
                )
        if (
            ending.get("decision_id") != decision_id
            or ending.get("event_id") != record.get("event_id")
            or ending.get("captured_at") != record.get("ts")
            or ending.get("summary") != record.get("summary")
            or ending.get("scene_id") != scene_id
            or ending.get("kind") != kind
            or ending.get("investigator_ids") != targets
        ):
            raise ToolError(
                "development_settlement_failed",
                "persisted ending capsule identity conflicts with this decision",
            )
        record["settlement_capsule_ref"] = capsule_path.relative_to(
            ctx.campaign_dir
        ).as_posix()
        record["settlement_capsule_sha256"] = ending["capsule_sha256"]
        ctx.log_event(record)
    development = _development_finalizer(ctx, ending)
    data = {
        "session_ending": True,
        "scene_id": scene_id,
        "kind": kind,
        "investigator_ids": targets,
        "ending_id": development.get("ending_id"),
        "development": development,
    }
    if target_conflict is not None:
        data["retry_target_conflict"] = target_conflict
    ctx.ledger_record(args.get("decision_id"), "state.end_session", data)
    gap_hints = _adjudication_gap_hints(ctx)
    if development.get("status") != "PASS":
        _record_settlement_pending(ctx, development)
        warnings = [
            "session ending is durable, but development settlement remains pending after bounded retries"
        ]
        if target_conflict is not None:
            warnings.append(
                "SETTLEMENT_TARGET_CONFLICT: retry target set differed; the persisted ending targets were preserved"
            )
        return data, warnings, [
            "retry state.end_session or development.settle with the same decision identity; do not reopen narration",
            *gap_hints,
        ]
    warnings = []
    if target_conflict is not None:
        warnings.append(
            "SETTLEMENT_TARGET_CONFLICT: retry target set differed; the persisted ending targets were preserved"
        )
    return data, warnings, [
        "development settlement completed synchronously",
        *gap_hints,
    ]

def register_operations(registry) -> None:
    global TOOLS
    TOOLS = registry.legacy_tools
    registry.tool(
    "state.supersede_settlement",
    "Correct a prior public settlement and hide the voided dice/HP from player-facing final output while keeping the audit trail.",
    {
        "roll_ids": {
            "type": "array",
            "required": True,
            "desc": "canonical roll_id values to hide from player-facing mechanics (damage, dodge error, etc.)",
        },
        "reason": {
            "type": "string",
            "required": True,
            "desc": "structured correction reason (e.g. same-level dodge voids hit)",
        },
        "investigator": {
            "type": "string",
            "desc": "investigator id when also reversing HP",
        },
        "restore_hp_to": {
            "type": "integer",
            "desc": "optional absolute current HP after correction (e.g. 12 when an erroneous 12→9 is voided)",
        },
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key"},
    },
)(_tool_state_supersede_settlement)
    registry.tool(
    "narration.brief",
    "Build a minimum-privilege player-safe narration envelope plus the "
    "active campaign play_language style contract.",
    {
        "candidate_plan": {"type": "object", "required": True, "desc": "KP-adopted or modified Director plan"},
        "investigator": {"type": "string", "desc": "investigator id"},
        "applied_events": {"type": "array", "desc": "authoritative state/rules receipts already applied this turn"},
    },
)(_tool_narration_brief)
    registry.tool(
    "narration.review",
    "Semantically review the exact pending narration before Pi-play finalization. Declare every player-state change claim in state_authority_review and bind it to the exact current frozen mechanics effect; an unbound claim or agency_violation requires narration-only revision 2 with the same frozen settlement. Then finalize only a clean review and bind authorized PC propositions through agency_claims. Length, repetition, scope, and style findings remain advisory; no keyword matcher, second Keeper, or prose-quality hard gate.",
    {
        "decision_id": {"type": "string", "required": True, "desc": "stable turn decision id"},
        "turn_id": {"type": "string", "required": True},
        "source_digest": {"type": "string", "required": True},
        "revision": {"type": "integer", "minimum": 1, "required": True},
        "draft_text": {"type": "string", "required": True, "desc": "exact draft reviewed by the KP"},
        "findings": {"type": "array", "desc": "closed semantic findings {rule_id,subject_ref,source_ref,reason}. For agency_violation, subject_ref must be the exact current pc:<id> and source_ref must be null because no player_input/active override authorizes it. Authorized PC propositions are not findings: bind them in turn.finalize.agency_claims. Other findings remain advisory"},
        "state_authority_review": {
            "type": "object",
            "required": True,
            "desc": "required Pi semantic declaration of player-state claims. Bind every listed claim to one exact current mechanics effect id; use null only to audit an ungrounded claim that must be removed in revision 2",
            "properties": {
                "disposition": {
                    "type": "string",
                    "enum": ["no_player_state_change_claimed", "claims_listed"],
                },
                "reason": {"type": "string", "minLength": 1},
                "claims": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "claim_id": {"type": "string", "minLength": 1},
                            "subject_ref": {"type": "string", "minLength": 1},
                            "claim_kind": {
                                "type": "string",
                                "enum": sorted(coc_state_authority.CLAIM_KINDS),
                            },
                            "exact_excerpt": {"type": "string", "minLength": 1},
                            "source_effect_id": {"type": ["string", "null"]},
                            "reason": {"type": "string", "minLength": 1},
                        },
                        "required_fields": sorted(coc_state_authority.CLAIM_FIELDS),
                        "additionalProperties": False,
                    },
                },
            },
            "required_fields": sorted(coc_state_authority.REVIEW_FIELDS),
            "additionalProperties": False,
        },
        "state_claim_compilation": {
            "type": "object",
            "required": True,
            "desc": "Pi-host-owned independent semantic claim receipt. The Pi adapter injects it for the exact draft; the Keeper must not author or modify it.",
        },
        "investigator": {"type": "string", "desc": "investigator id for budget derivation (defaults to the party's first member)"},
    },
    access="mutation",
    write_domains=("narration_advisory",),
    execution_class="serial_campaign",
)(_tool_narration_review)
    registry.tool(
    "state.recover_pending_narration_draft",
    "Operator/host recovery mutation that materializes one exact keeper-only pending narration draft from identity- and hash-matched structured narration.review audit evidence. It never reads transcripts and is not an ordinary KP play method.",
    {
        "decision_id": {
            "type": "string",
            "required": True,
            "desc": "semantic idempotency key for this explicit materialization",
        },
        "review_decision_id": {
            "type": "string",
            "required": True,
            "desc": "existing semantic narration.review decision identity; all other binding is derived from canonical review evidence",
        },
    },
    access="mutation",
    write_domains=("narration_advisory",),
    execution_class="serial_campaign",
)(_tool_state_recover_pending_narration_draft)
    registry.tool(
    "state.journal",
    "Close out a narrated turn: bump the turn counter, optionally set tension, and write player-safe receipts.",
    {
        "summary": {"type": "string", "required": True, "desc": "player-safe summary of what just happened"},
        "player_action": {"type": "string", "desc": "what the player did (verbatim or condensed)"},
        "player_text": {"type": "string", "required": True, "desc": "nonblank exact byte-for-byte player message for the readable transcript; player_action cannot substitute"},
        "player_speaker": {"type": "string", "desc": "player-facing speaker name"},
        "run_id": {"type": "string", "desc": "current play/report segment id"},
        "intent_class": {"type": "string", "desc": "your read of the intent (investigate/social/move/stuck/meta/...)"},
        "tension": {"type": "string", "desc": "set tension level: low | medium | high | climax"},
        "continuation": {
            "type": "object",
            "desc": "optional KP-authored semantic delta for recovery after compaction; record only meaning that changed this turn",
            "properties": {
                "unresolved_intent": {"type": "string"},
                "clear_unresolved_intent": {"type": "boolean"},
                "open_threads": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "thread_id": {"type": "string"},
                            "summary": {"type": "string"},
                            "reason": {"type": "string"},
                            "status": {
                                "type": "string",
                                "enum": ["active", "deferred", "resolved", "archived"],
                            },
                        },
                        "required": ["thread_id", "summary", "reason", "status"],
                        "additionalProperties": False,
                    },
                },
                "confirmed_decisions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "decision_id": {"type": "string"},
                            "summary": {"type": "string"},
                            "reason": {"type": "string"},
                        },
                        "required": ["decision_id", "summary", "reason"],
                        "additionalProperties": False,
                    },
                },
                "do_not_repeat": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "item_id": {"type": "string"},
                            "instruction": {"type": "string"},
                            "reason": {"type": "string"},
                        },
                        "required": ["item_id", "instruction", "reason"],
                        "additionalProperties": False,
                    },
                },
                "style_commitments": {
                    "type": "array",
                    "items": {"type": "string"},
                },
            },
            "additionalProperties": False,
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_state_journal)
    registry.tool(
    "turn.output_context",
    "Read the latest unfinalized journal's causal obligations, Keeper-only NPC performance constraints, source-bound exceptional-effect status, and deterministic player-mechanics bundle. Call only after all settlement and state.journal.",
    {},
    access="query",
)(_tool_turn_output_context)
    registry.tool(
    "turn.finalize",
    "Hard final boundary for one journaled turn. In Pi play, first call the narration.review operation returned by turn.output_context for this exact draft/revision, including its closed state_authority_review, then pass its review_id plus all authorized agency_claims. Rewrite only narration as revision 2 if agency ownership or player-state authority is rejected; never rerun rules/state/journal. Prose-quality review findings stay advisory. Finalize validates causal coverage and mechanic placement, inserts authoritative mechanics, persists hashes, and returns rendered_text that direct hosts must echo verbatim.",
    {
        "draft": {
            "type": "string",
            "required": True,
            "desc": "exact player-facing fictional prose, without deterministic dice/change blocks",
        },
        "coverage": {
            "type": "array",
            "required": True,
            "desc": "one closed semantic coverage row per obligation from turn.output_context",
            "items": {
                "type": "object",
                "properties": {
                    **{
                        field: {"type": ["string", "null"]}
                        for field in sorted(
                            coc_turn_finalization.COVERAGE_FIELDS
                            - {
                                "obligation_id",
                                "realization",
                                "player_input_handling",
                            }
                        )
                    },
                    "obligation_id": {"type": "string", "minLength": 1},
                    "realization": {
                        "type": "string",
                        "enum": sorted(coc_turn_finalization.REALIZATION_VALUES),
                    },
                    "player_input_handling": {
                        "type": "string",
                        "enum": sorted(
                            coc_turn_finalization.PLAYER_INPUT_HANDLING_VALUES
                        ),
                    },
                },
                "required": sorted(coc_turn_finalization.COVERAGE_FIELDS),
                "additionalProperties": False,
            },
        },
        "mechanics_placements": {
            "type": "array",
            "desc": "optional override rows {after_paragraph (zero-based), segment_type, source_ids}; omit for safe causal defaults, or supply every source exactly once when deliberate interleaving is needed",
            "items": {
                "type": "object",
                "properties": {
                    "after_paragraph": {"type": "integer", "minimum": 0},
                    "segment_type": {
                        "type": "string",
                        "enum": sorted(
                            coc_turn_finalization.MECHANIC_SEGMENT_TYPES
                        ),
                    },
                    "source_ids": {
                        "type": "array",
                        "items": {"type": "string", "minLength": 1},
                        "minItems": 1,
                        "uniqueItems": True,
                    },
                },
                "required": sorted(
                    coc_turn_finalization.MECHANICS_PLACEMENT_FIELDS
                ),
                "additionalProperties": False,
            },
        },
        "decision_id": {
            "type": "string", "required": True, "desc": "idempotency key",
        },
        "revision": {
            "type": "integer", "minimum": 1,
            "required": True,
            "desc": "narration-only revision; initial=1, one undelivered repair=2",
        },
        "narration_review_id": {
            "type": "string",
            "desc": "exact narration.review id bound to this turn/source/revision/draft; required for Pi play accepted output",
        },
        "agency_claims": {
            "type": "array",
            "desc": "all authorized PC propositions found during semantic review: voluntary claims bind the exact current player_input; physiology binds the ownership contract; forced behavior binds an active frozen override. Empty is valid only when the bound clean review found no PC proposition",
            "items": {
                "type": "object",
                "properties": {
                    "claim_id": {"type": "string", "minLength": 1},
                    "subject_ref": {"type": "string", "minLength": 1},
                    "claim_type": {
                        "type": "string",
                        "enum": sorted(coc_turn_finalization.AGENCY_CLAIM_TYPES),
                    },
                    "exact_excerpt": {"type": "string", "minLength": 1},
                    "source_ref": {"type": ["string", "null"]},
                    "override_id": {"type": ["string", "null"]},
                },
                "required": sorted(coc_turn_finalization.AGENCY_CLAIM_FIELDS),
                "additionalProperties": False,
            },
        },
        "repair_finalization_id": {
            "type": "string",
            "desc": "optional latest finalization id; permits a prose/placement-only replacement only while that exact output remains delivery-unconfirmed",
        },
        "validate_only": {
            "type": "boolean",
            "desc": "optional preflight: run the full finalize validation and return every violation at once (error.violations) without writing any receipt",
        },
        "advisory_uptake": {
            "type": "object",
            "desc": "optional proof that one actions.advise Storylet candidate actually shaped this finalized draft; use candidate_ref, while storylet_candidate remains a legacy compatibility input",
            "properties": {
                "advice_id": {"type": "string", "minLength": 1},
                "disposition": {
                    "type": "string", "enum": ["adopted", "modified"],
                },
                "reason": {"type": "string", "minLength": 1},
                "adopted_fields": {
                    "type": "array",
                    "items": {"type": "string", "minLength": 1},
                    "minItems": 1,
                },
                "candidate_ref": {"type": "string", "minLength": 1},
                "storylet_candidate": {"type": "object"},
                "exact_excerpt": {"type": "string", "minLength": 1},
            },
            "required_fields": [
                "advice_id", "disposition", "reason", "adopted_fields",
                "exact_excerpt",
            ],
            "additionalProperties": False,
        },
    },
)(_tool_turn_finalize)
    registry.tool(
    "state.end_session",
    "Declare a structured story ending, then synchronously finalize deterministic development bookkeeping without gating narration.",
    {
        "kind": {"type": "string", "desc": "ending flavor: conclusion | tpk | retreat | cliffhanger (default conclusion)"},
        "summary": {"type": "string", "desc": "player-safe closing summary"},
        "investigator": {"type": "string", "desc": "optional investigator id; defaults to every linked party member"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_state_end_session)


OPERATION_EXPORTS = (
    'ExitStack',
    '_UNDELIVERED_OUTPUT_REPAIR_RELATIVE',
    '_control_overrides',
    '_development_finalizer',
    '_ending_target_retry_conflict',
    '_hide_related_hp_events',
    '_narration_budget',
    '_normalize_finalized_advisory_uptake',
    '_normalized_investigator_ids',
    '_pending_authority_review_revision',
    '_record_finalized_advisory_uptake',
    '_record_finalized_keeper_text',
    '_record_journal_player_transcript_entry',
    '_record_settlement_pending',
    '_replace_undelivered_finalization_artifacts',
    '_requested_ending_targets',
    '_required_exact_player_text',
    '_resolve_bound_narration_review',
    '_review_has_agency_violation',
    '_review_requires_rewrite',
    '_rewrite_roll_visibilities',
    '_settled_narration_budget',
    '_tool_narration_advisory_review',
    '_tool_narration_brief',
    '_tool_narration_review',
    '_tool_state_end_session',
    '_tool_state_journal',
    '_tool_state_recover_pending_narration_draft',
    '_tool_state_supersede_settlement',
    '_tool_turn_finalize',
    '_tool_turn_output_context',
    '_turn_contract_projection',
    '_valid_narration_review_digest',
    'coc_narration_contract',
    'coc_narration_style',
    'coc_state_authority',
)
