#!/usr/bin/env python3
"""Operation adapter cell: npc-world."""
from __future__ import annotations

import json
import re
from pathlib import Path

from coc_operation_kernel_runtime import (
    Any,
    Ctx,
    ToolError,
    _NPC_PRESENCE_SCHEMA_VERSION,
    _active_scene,
    _advice_id,
    _campaign_document,
    _campaign_npc_projection_index,
    _campaign_play_language,
    _ensure_first_impression_roll,
    _ensure_npc_receipt_event,
    _ensure_operation_event,
    _intent_evidence,
    _load_npc_presence_document,
    _load_sibling,
    _new_source_receipt,
    _now_iso,
    _npc_by_id,
    _npc_engagement_operation,
    _npc_identity_contract,
    _npc_presence_live_record,
    _npc_receipt_path,
    _npc_receipt_warnings,
    _npc_receipts_for_decision,
    _operation_event_id,
    _put_source_receipt,
    _reconcile_all_npc_source_receipts,
    _replay_source_receipt,
    _resolve_investigator,
    _rng,
    _scene_by_id,
    _settle_engagement_route_completion,
    _source_receipt,
    _source_receipt_manifest,
    _validate_source_receipt,
    coc_first_impression,
    coc_flag_state,
    coc_language,
    coc_npc_event_chain,
    coc_npc_identity,
    coc_npc_state,
    coc_roll,
    coc_state,
    deepcopy,
    tool,
)

coc_npc_persona = _load_sibling("coc_npc_persona_toolbox", "coc_npc_persona.py")


# --- Canonical event wiring (coc-events-1, plan task t4) -------------------
#
# npc-relationship-changed mirrors settled NPC relationship writes:
# - ``npc.reaction`` new-pair first contact (public D100 vs max(APP, CR))
#   with channel=first-impression, after=reaction tier, source roll bound;
# - ``state.npc_update`` investigator-scoped trust/fear/suspicion movement
#   with before/after values and channel=<field>.
# Derived evidence only, emitted strictly after the authoritative write;
# every emission failure is swallowed and never breaks play.


def _canonical_npc_token(value: Any) -> str | None:
    text = re.sub(r"[^a-z0-9.-]+", "-", str(value or "").strip().lower())
    text = re.sub(r"^[^a-z0-9]+", "", text)
    return (text.rstrip("-.")[:64]) or None


def _canonical_npc_scalar(value: Any) -> Any:
    if isinstance(value, bool) or isinstance(value, (int, float)):
        return value
    return _canonical_npc_token(value)


def _canonical_npc_clock_context(ctx: Ctx) -> tuple[int, str, str]:
    """(turn, timeline, game_time) provenance for this campaign's emissions."""
    pacing = ctx.pacing()
    raw_turn = pacing.get("turn_number") if isinstance(pacing, dict) else None
    try:
        turn = max(1, int(raw_turn))
    except (TypeError, ValueError):
        turn = 1
    timeline = "tl-main"
    game_time = ""
    path = Path(ctx.campaign_dir) / "save" / "time-state.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        timeline_token = _canonical_npc_token(
            payload.get("timeline_id") if isinstance(payload, dict) else None
        )
        timeline = timeline_token or "tl-main"
        clock = payload.get("clock") if isinstance(payload, dict) else None
        if isinstance(clock, dict):
            game_time = str(clock.get("display") or "").strip()[:400]
    except (OSError, UnicodeError, json.JSONDecodeError):
        pass
    return turn, timeline, game_time or f"turn-{turn}"


def _emit_npc_relationship_changed(
    ctx: Ctx,
    *,
    source: str,
    decision_id: Any,
    npc_id: Any,
    investigator_id: Any,
    channel: str,
    before: Any = None,
    after: Any = None,
    reason: Any = None,
    source_roll_id: Any = None,
) -> None:
    decision = _canonical_npc_token(decision_id)
    npc = _canonical_npc_token(npc_id)
    investigator = _canonical_npc_token(investigator_id)
    channel_token = _canonical_npc_token(channel)
    after_value = _canonical_npc_scalar(after)
    if not (decision and npc and investigator and channel_token and after_value is not None):
        return
    data: dict[str, Any] = {
        "_v": 1,
        "npc": npc,
        "investigator": investigator,
        "channel": channel_token,
        "after": after_value,
    }
    if before is not None:
        before_value = _canonical_npc_scalar(before)
        if before_value is not None:
            data["before"] = before_value
    reason_text = str(reason or "").strip()
    if reason_text:
        data["reason"] = reason_text[:400]
    roll_id = str(source_roll_id or "").strip().lower()
    if roll_id:
        data["source_roll_id"] = roll_id
    turn, timeline, game_time = _canonical_npc_clock_context(ctx)
    campaign_dir = Path(ctx.campaign_dir)
    for suffix in ("", "-2", "-3", "-4"):
        try:
            import coc_canonical_events as cem

            cem.emit(
                campaign_logs_dir=campaign_dir / "logs",
                event_type="npc-relationship-changed",
                campaign=_canonical_npc_token(
                    coc_npc_event_chain.resolve_campaign_id(campaign_dir)
                ) or "campaign",
                timeline=timeline,
                turn=turn,
                slug=(f"{npc[:32]}-{investigator[:32]}-{channel_token}{suffix}")[:110],
                source=source,
                game_time=game_time,
                privacy="public",
                decision_id=f"{decision}:npc-{channel_token}",
                data=data,
            )
            return
        except Exception:
            continue

def _first_contact_localized_name(
    npc: dict[str, Any] | None,
    stored_card: dict[str, Any] | None,
    accepted_table_name: str | None,
    play_language: str,
) -> str | None:
    """Use only an explicitly localized or campaign-accepted table name."""
    for key in ("localized_names", "localized_text"):
        localized = (
            npc.get(key, {}).get(play_language)
            if isinstance(npc, dict) and isinstance(npc.get(key), dict)
            else None
        )
        if isinstance(localized, str) and localized.strip():
            return localized.strip()
        if isinstance(localized, dict):
            value = next(
                (localized.get(field) for field in ("display_name", "name", "title")
                 if isinstance(localized.get(field), str)
                 and localized.get(field).strip()),
                None,
            )
            if value:
                return value.strip()
    if accepted_table_name:
        return str(accepted_table_name)
    if npc is not None or not isinstance(stored_card, dict):
        return None
    name = stored_card.get("name")
    if isinstance(name, dict):
        if name.get("source") == "scenario_data":
            return None
        name = name.get("value")
    return str(name).strip() if isinstance(name, str) and name.strip() else None

def _first_contact_readiness(
    ctx: Ctx,
    *,
    npc_id: str,
    authored_npc: dict[str, Any] | None,
    npc_state: dict[str, Any],
    accepted_table_name: str | None,
    active_scene_id: str | None,
    investigator_id: str | None,
    impression_document: dict[str, Any],
) -> dict[str, Any]:
    """Build one compact, read-only readiness row for the normal NPC query."""
    stored_cards = npc_state.get("npcs")
    stored_card = stored_cards.get(npc_id) if isinstance(stored_cards, dict) else None
    stored_card = stored_card if isinstance(stored_card, dict) else None
    authored = authored_npc if isinstance(authored_npc, dict) else None
    localized_name = _first_contact_localized_name(
        authored, stored_card, accepted_table_name, _campaign_play_language(ctx),
    )

    if authored is not None:
        authored_persona = (
            authored.get("persona") if isinstance(authored.get("persona"), dict)
            else {}
        )
        voice = authored.get("voice")
        tags = list(authored_persona.get("tags") or [])[:6]
        persona_status = (
            "authored" if (isinstance(voice, str) and voice.strip()) or tags
            else "authored_incomplete"
        )
        persona = {
            "source_status": persona_status,
            "authority": "authored",
            "keeper_only": True,
            "voice": voice,
            "tags": tags,
        }
    elif stored_card is not None and isinstance(stored_card.get("persona"), dict):
        persona = {
            "source_status": "campaign_persisted",
            "authority": "campaign_state",
            "keeper_only": True,
            "tags": list(stored_card["persona"].get("tags") or [])[:6],
        }
    else:
        candidate = coc_npc_persona.build_persona_card(
            {"npc_id": npc_id, "origin": "improvised"},
            seed_parts=[ctx.campaign_id, npc_id, "first-contact-readiness-v1"],
            context={"campaign_id": ctx.campaign_id, "scene_id": active_scene_id},
        )
        persona = {
            "source_status": "seed_stable_proposal",
            "authority": "advisory",
            "keeper_only": True,
            "seed": (candidate.get("generation") or {}).get("seed"),
            "tags": list((candidate.get("persona") or {}).get("tags") or [])[:6],
        }

    authored_mechanics = (
        authored.get("mechanics")
        if authored is not None and isinstance(authored.get("mechanics"), dict)
        else {}
    )
    stored_mechanics = stored_card.get("mechanics") if stored_card else None
    stored_mechanics = stored_mechanics if isinstance(stored_mechanics, dict) else {}
    if (
        stored_mechanics.get("status") == "generated"
        and isinstance(stored_mechanics.get("profile"), dict)
    ):
        mechanics_ready = True
        mechanics_source_status = "campaign_generated"
    elif (
        authored_mechanics.get("status") == "authored"
        and isinstance(authored_mechanics.get("profile"), dict)
    ):
        mechanics_ready = True
        mechanics_source_status = "authored"
    else:
        mechanics_ready = False
        raw_source_status = str(authored_mechanics.get("status") or "").strip()
        mechanics_source_status = raw_source_status or (
            "source_unresolved" if authored is not None
            else "campaign_fallback_eligible"
        )

    pending_source_dependency = (
        {
            "consumer": "mechanics.ensure", "subject_id": npc_id,
            "source_status": mechanics_source_status,
            "blocks_only_when": "this_npc_mechanics_are_required",
        }
        if not mechanics_ready and authored is not None
        and mechanics_source_status != "not_authored" else None
    )

    next_operation_cards: list[dict[str, Any]] = []
    requested_pair: dict[str, Any]
    if investigator_id is None:
        requested_pair = {
            "status": "investigator_selection_required",
            "investigator_id": None,
            "receipt_exists": None,
            "first_impression_ref": None,
        }
    else:
        receipt = coc_first_impression.find_by_pair(
            impression_document, investigator_id, npc_id,
        )
        exists = isinstance(receipt, dict)
        requested_pair = {
            "status": "settled" if exists else "missing",
            "investigator_id": investigator_id,
            "receipt_exists": exists,
            "first_impression_ref": receipt.get("receipt_id") if exists else None,
        }
        if not exists:
            prefilled = {
                "npc_id": npc_id,
                "investigator": investigator_id,
                "run_id": coc_npc_event_chain.resolve_run_id(ctx.campaign_dir),
            }
            missing = [
                "context.player_conduct",
                "context.scene_constraints",
                "context.authored_or_relationship_boundary",
                "context.semantic_reason",
                "decision_id",
            ]
            if localized_name is not None:
                prefilled["npc_display_name"] = localized_name
            else:
                missing.insert(0, "npc_display_name")
            next_operation_cards.append({
                "campaign_id": ctx.campaign_id,
                "operation": "npc.reaction",
                "invoke_via": "coc_invoke",
                "prefilled_arguments": prefilled,
                "missing_arguments": missing,
                "fresh_decision_id_required": True,
                "roll_created": False,
            })

    social_adjudication_operation = None
    if investigator_id is not None:
        fact_refs = [
            f"npc_fact:{npc_id}/{fact_id}"
            for fact_id in (
                str(row.get("fact_id") or "").strip()
                for row in ((authored or {}).get("facts") or [])
                if isinstance(row, dict)
            )
            if fact_id
        ]
        social_adjudication_operation = {
            "operation": "rules.social_adjudicate",
            "invoke_via": "coc_rules_social_adjudicate",
            "prefilled_arguments": {
                "investigator": investigator_id,
                "npc_id": npc_id,
            },
            "missing_arguments": [
                "conversation_window_id",
                "commitment_id",
                "approach",
                "goal_summary",
                "decision_id",
            ],
            "valid_optional_evidence_refs": fact_refs,
            "safe_omissions": {
                "motive": "omit to use neutral intensity 0",
                "leverage": (
                    "omit when no exact player-known typed source applies"
                ),
                "feasibility": "omit to derive the canonical default",
                "feasibility_refs": "omit together with feasibility",
            },
            "argument_boundary": {
                "submission_shape": "prefilled_plus_missing_and_grounded_optional_only",
                "do_not_invent_refs": True,
            },
        }

    if not mechanics_ready:
        mechanics_missing = ["purpose", "decision_id"]
        if mechanics_source_status in {
            "not_authored", "campaign_fallback_eligible",
        }:
            mechanics_missing.insert(1, "fallback_archetype_id")
        mechanics_prefilled = {"subject_kind": "npc", "subject_id": npc_id}
        if localized_name is not None:
            mechanics_prefilled["label"] = localized_name
        next_operation_cards.append({
            "operation": "mechanics.ensure",
            "invoke_via": "coc_invoke",
            "prefilled_arguments": mechanics_prefilled,
            "missing_arguments": mechanics_missing,
        })

    return {
        "npc_id": npc_id,
        "identity_ready": bool(authored is not None or stored_card is not None),
        "localized_name_ready": localized_name is not None,
        "localized_name": localized_name,
        "agenda_ready": bool(
            authored is not None
            and authored.get("parse_state") != "named_only"
            and isinstance(authored.get("agenda"), str)
            and authored.get("agenda", "").strip()
        ),
        "persona_ready": persona["source_status"] in {
            "authored", "campaign_persisted",
        },
        "persona_candidate_ready": persona["source_status"] == "seed_stable_proposal",
        "persona": persona,
        "mechanics_ready": mechanics_ready,
        "mechanics_source_status": mechanics_source_status,
        "pending_source_dependency": pending_source_dependency,
        "requested_pair_first_impression": requested_pair,
        "next_operation_cards": next_operation_cards,
        "social_adjudication_operation": social_adjudication_operation,
    }

def _npc_engagement_advisory_hints(
    authored_npc: dict[str, Any] | None, npc_id: str
) -> list[str]:
    """Project authored contact-route constraints and improvisation advice."""
    if authored_npc is None:
        return [
            f"improvised npc '{npc_id}' — the KP adjudicates whether this "
            "person's existence is plausible against module truth and "
            "established fiction"
        ]
    keeper_note = authored_npc.get("keeper_note")
    if isinstance(keeper_note, str) and keeper_note.strip():
        return [
            f"authored npc '{npc_id}' keeper_note: {keeper_note.strip()} — "
            "treat it as binding module advice; a deliberate bypass needs an "
            "earned in-fiction reason"
        ]
    return []

def _first_impression_hint(
    ctx: Ctx,
    npc_id: str,
    investigator_id: str | None,
    impression_document: dict[str, Any],
) -> str | None:
    """Advisory pointer for the pair's one public first-impression check."""
    stats: tuple[str, int, int] | None = None
    if investigator_id is not None:
        try:
            sheet = ctx.sheet(investigator_id)
            chars = sheet.get("characteristics") or {}
            skills = sheet.get("skills") or {}
            app_raw = chars.get("APP", 50)
            cr_raw = skills.get("Credit Rating", 0)
            stats = (
                investigator_id,
                int(app_raw) if app_raw is not None else 50,
                int(cr_raw) if cr_raw is not None else 0,
            )
        except ToolError:
            stats = None
    if stats is None:
        return (
            f"first impression: call npc.reaction once before the first substantive "
            f"engagement with '{npc_id}'; the APP/Credit Rating D100 is public"
        )
    investigator_id, app, credit_rating = stats
    if (
        coc_first_impression.find_by_pair(
            impression_document, investigator_id, npc_id
        )
        is not None
    ):
        return None
    return (
        f"first impression: call npc.reaction once for {investigator_id}/'{npc_id}' "
        f"before their first substantive engagement; public D100 uses max(APP {app}, "
        f"Credit Rating {credit_rating}) and the KP realizes the result within authored, "
        "relationship, scene, and conduct boundaries"
    )

def _save_npc_receipt_document(ctx: Ctx, document: dict[str, Any]) -> None:
    coc_state.write_json_atomic(_npc_receipt_path(ctx), document)

def _tool_npc_query(ctx: Ctx, args: dict[str, Any]):
    npc_state = coc_npc_state.load_npc_state(ctx.campaign_dir)
    active_scene_id = ctx.world().get("active_scene_id")
    authored_npcs = [
        npc for npc in (ctx.npc_agendas.get("npcs") or [])
        if isinstance(npc, dict) and str(npc.get("npc_id") or "").strip()
    ]
    authored_by_id = {
        str(npc["npc_id"]): npc
        for npc in authored_npcs
    }
    psych_by_id = (
        npc_state.get("psych") if isinstance(npc_state.get("psych"), dict) else {}
    )
    (
        campaign_npc_ids,
        campaign_names,
        name_conflicts,
        impression_document,
        accepted_table_names,
    ) = _campaign_npc_projection_index(ctx, npc_state)

    out = []
    requested_id = str(args.get("npc_id") or "").strip()
    requested_npc = _npc_by_id(ctx.npc_agendas, requested_id) if requested_id else None
    if requested_npc is not None:
        canonical_requested_id = str(requested_npc.get("npc_id"))
    elif requested_id and requested_id in campaign_npc_ids:
        canonical_requested_id = requested_id
    elif requested_id:
        raise ToolError(
            "unknown_npc",
            f"npc not found or short name is ambiguous: {requested_id}",
        )
    else:
        canonical_requested_id = ""
    impression_investigator: str | None = None
    if args.get("investigator") is not None:
        impression_investigator = _resolve_investigator(ctx, args)
    elif len(ctx.party_ids()) == 1:
        impression_investigator = ctx.party_ids()[0]
    projected_ids = [str(npc["npc_id"]) for npc in authored_npcs]
    projected_ids.extend(sorted(campaign_npc_ids - set(projected_ids)))
    for npc_id in projected_ids:
        npc = authored_by_id.get(npc_id)
        if canonical_requested_id and npc_id != canonical_requested_id:
            continue
        psych = psych_by_id.get(npc_id) or {}
        normalized_psych = coc_npc_state.normalize_entry(psych)
        impression = (
            normalized_psych.get("impressions", {}).get(impression_investigator)
            if impression_investigator
            else None
        )
        identity_contract = (
            _npc_identity_contract(npc, active_scene_id) if npc is not None else None
        )
        campaign_name = campaign_names.get(npc_id)
        out.append({
            "npc_id": npc_id,
            "name": npc.get("name") if npc is not None else campaign_name,
            "identity_ref": (
                identity_contract["identity_ref"] if identity_contract else None
            ),
            "profile_revision_ref": (
                identity_contract["profile_revision_ref"]
                if identity_contract else None
            ),
            "identity_contract": identity_contract,
            # Preserve the authored identity contract.  The module compiler
            # already distinguishes source NPCs from inferred/improvised
            # people and expands their structured social role; dropping those
            # fields here invited downstream Keepers to recast a court contact
            # as a police detective merely because both touch the same file.
            "origin": npc.get("origin") if npc is not None else "improvised",
            "voice": npc.get("voice") if npc is not None else None,
            "agenda": npc.get("agenda") if npc is not None else None,
            "fear": npc.get("fear") if npc is not None else None,
            "relationship_to_investigators": (
                npc.get("relationship_to_investigators") if npc is not None else None
            ),
            "social_role": deepcopy(npc.get("social_role")) if npc is not None else None,
            "role_label": npc.get("role_label") if npc is not None else None,
            "secret": {
                "value": npc.get("secret") if npc is not None else None,
                "secret": True,
            },
            "keeper_note": {
                "value": npc.get("keeper_note") if npc is not None else None,
                "secret": True,
            },
            "facts": npc.get("facts") if npc is not None else None,
            "known_fact_ids": npc.get("known_fact_ids") if npc is not None else None,
            "revealable_fact_ids": (
                npc.get("revealable_fact_ids") if npc is not None else None
            ),
            "lie_options": npc.get("lie_options") if npc is not None else None,
            "deflect_options": npc.get("deflect_options") if npc is not None else None,
            "schedule": npc.get("schedule") if npc is not None else None,
            "psych": {
                "trust": normalized_psych.get("trust", 0),
                "fear": normalized_psych.get("fear", 0),
                "suspicion": normalized_psych.get("suspicion", 0),
                "known_facts": normalized_psych.get("known_facts", []),
                "lies_told": normalized_psych.get("lies_told", []),
                "promises": normalized_psych.get("promises", []),
                "availability": normalized_psych.get("availability"),
                "impression": deepcopy(impression) if isinstance(impression, dict) else None,
            },
            **(
                {
                    "first_contact_readiness": _first_contact_readiness(
                        ctx,
                        npc_id=npc_id,
                        authored_npc=npc,
                        npc_state=npc_state,
                        accepted_table_name=accepted_table_names.get(npc_id),
                        active_scene_id=(
                            str(active_scene_id) if active_scene_id else None
                        ),
                        investigator_id=impression_investigator,
                        impression_document=impression_document,
                    )
                }
                if canonical_requested_id
                else {}
            ),
        })
    hints = [
        "fields marked secret:true are your reference only — reveal through play, not exposition",
        "origin=source plus relationship_to_investigators/social_role is an authored identity contract: preserve that NPC's institution and role; introduce a new stable NPC id for a different role",
        "role_label is source-authored display context only; never infer structured authority from its free prose",
        "origin=improvised is a campaign-local canonical contact projected from first-impression/persona/psych state; identity_contract stays null because the module did not author that identity",
        "pass the returned identity_ref to state.record_npc_engagement only when this authored identity is the one portrayed; a missing or mismatched ref records the interaction but is not authored-NPC coverage",
        "when an authored NPC has no pronoun or gender field, repeat the authored name; never invent a gendered pronoun",
    ]
    if impression_investigator:
        hints.append(
            f"psych.impression is the bounded, caller-authored textual memory for investigator '{impression_investigator}'; use it as semantic context, never as a hard action gate"
        )
    elif len(ctx.party_ids()) > 1:
        hints.append(
            "npc.query has multiple investigators; pass investigator explicitly to project one pair-scoped textual impression"
        )
    if name_conflicts:
        hints.append(
            "campaign-local first-impression receipts disagree on player-safe "
            f"display name for: {', '.join(sorted(name_conflicts))}; the earliest "
            "canonical receipt name is projected and the KP should preserve one stable identity"
        )
    if requested_id and requested_id != canonical_requested_id:
        hints.append(
            f"resolved NPC alias '{requested_id}' to authored id '{canonical_requested_id}'"
        )
    if canonical_requested_id:
        first_impression = _first_impression_hint(
            ctx,
            canonical_requested_id,
            impression_investigator,
            impression_document,
        )
        if first_impression:
            hints.append(first_impression)
    return {"npcs": out}, [], hints

def _first_impression_display_skill(ctx: Ctx) -> str:
    """First-impression public-roll label in the campaign play language."""
    language = _campaign_play_language(ctx)
    labels = coc_language.table_mechanics_labels(language)
    return str(
        labels.get("first_impression_tag")
        or coc_language.player_facing_skill_label("First Impression", language)
    )

def _first_impression_engagement_card(
    receipt: dict[str, Any],
) -> dict[str, Any]:
    """Carry the normal first-contact write without forcing rediscovery."""
    return {
        "operation": "state.record_npc_engagement",
        "invoke_via": "coc_invoke",
        "prefilled_arguments": {
            "npc_id": str(receipt["npc_id"]),
            "investigator": str(receipt["investigator_id"]),
            "first_impression_ref": str(receipt["receipt_id"]),
            "run_id": str(receipt["run_id"]),
        },
        "missing_arguments": [
            "interaction_kind",
            "decision_id",
            "first_impression_realization",
        ],
        "authority": "advisory",
        "hard_gate": False,
    }

def _tool_npc_reaction(ctx: Ctx, args: dict[str, Any]):
    investigator_id = _resolve_investigator(ctx, args)
    sheet = ctx.sheet(investigator_id)
    characteristics = sheet.get("characteristics") or {}
    skills = sheet.get("skills") or {}
    # APP 0 is a legitimate value (p.31); never truthiness-fallback.
    _app_raw = characteristics.get("APP", 50)
    app = int(_app_raw) if _app_raw is not None else 50
    _cr_raw = skills.get("Credit Rating", 0)
    credit_rating = int(_cr_raw) if _cr_raw is not None else 0
    decision_id = str(args["decision_id"]).strip()
    requested_npc_id = str(args["npc_id"]).strip()
    if not requested_npc_id:
        raise ToolError("invalid_param", "npc_id must be non-empty")
    agenda = _npc_by_id(ctx.npc_agendas, requested_npc_id)
    npc_id = str(agenda.get("npc_id")) if agenda is not None else requested_npc_id
    npc_display_name = str(args.get("npc_display_name") or "").strip()
    if npc_display_name:
        npc_display_name = coc_language.player_facing_display_name(
            npc_display_name,
            _campaign_play_language(ctx),
            _campaign_document(ctx),
        )
    campaign_id = coc_npc_event_chain.resolve_campaign_id(ctx.campaign_dir)
    run_id = coc_npc_event_chain.resolve_run_id(
        ctx.campaign_dir, structured_source=args
    )
    try:
        document = coc_first_impression.load_document(
            ctx.campaign_dir, campaign_id
        )
        decision_receipt = coc_first_impression.find_by_decision(
            document, decision_id
        )
        pair_receipt = coc_first_impression.find_by_pair(
            document, investigator_id, npc_id
        )
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    if decision_receipt is not None and (
        decision_receipt["investigator_id"] != investigator_id
        or decision_receipt["npc_id"] != npc_id
        or decision_receipt["run_id"] != run_id
    ):
        raise ToolError(
            "idempotency_conflict",
            f"decision_id '{decision_id}' already owns another first impression",
        )
    if pair_receipt is not None:
        if pair_receipt.get("schema_version") == 2:
            _ensure_first_impression_roll(ctx, pair_receipt)
        data = deepcopy(pair_receipt)
        data["first_impression_ref"] = pair_receipt["receipt_id"]
        data["record_engagement_operation"] = (
            _first_impression_engagement_card(pair_receipt)
        )
        return data, [
            "first impression already settled for this investigator/NPC pair; returned the frozen receipt without rerolling"
        ], [
            (
                "legacy schema-v1 receipt preserved without rerolling"
                if pair_receipt.get("schema_version") == 1
                else "the public die and reaction tier are frozen; use the receipt's context plus current fiction to realize the first response"
            )
        ]

    context = deepcopy(args.get("context"))
    if not npc_display_name or npc_display_name == npc_id:
        raise ToolError(
            "invalid_param",
            "a new first-impression pair requires a localized player-safe npc_display_name distinct from npc_id",
        )
    if not isinstance(context, dict) or set(context) != coc_first_impression.CONTEXT_FIELDS:
        raise ToolError(
            "invalid_param",
            "a new first-impression pair requires context exactly: player_conduct, scene_constraints, authored_or_relationship_boundary, semantic_reason",
        )
    if not all(
        isinstance(context.get(key), str)
        and bool(context[key].strip())
        and context[key] == context[key].strip()
        for key in coc_first_impression.CONTEXT_FIELDS
    ):
        raise ToolError("invalid_param", "all first-impression context fields must be non-empty strings")

    governing_attribute = "credit_rating" if credit_rating > app else "app"
    governing_value = max(app, credit_rating)
    result = coc_roll.percentile_check(
        governing_value, difficulty="regular", rng=_rng(args)
    )
    achieved_level = str(result["achieved_level"])
    reaction_tier = coc_first_impression.REACTION_TIERS[achieved_level]
    roll_id = coc_first_impression.current_roll_id(
        campaign_id, investigator_id, npc_id
    )
    roll_record = ctx.prepare_roll({
        "roll_id": roll_id,
        "kind": "npc_first_impression",
        "actor": investigator_id,
        "investigator_id": investigator_id,
        "npc_id": npc_id,
        "npc_display_name": npc_display_name,
        "skill": "First Impression",
        "display_skill": _first_impression_display_skill(ctx),
        "app": app,
        "credit_rating": credit_rating,
        "governing_attribute": governing_attribute,
        "governing_value": governing_value,
        **result,
        "reaction_tier": reaction_tier,
        "visibility": "public",
        "source": "keeper_toolbox",
    })
    try:
        receipt = coc_first_impression.new_receipt(
            campaign_id=campaign_id,
            run_id=run_id,
            decision_id=decision_id,
            investigator_id=investigator_id,
            npc_id=npc_id,
            npc_display_name=npc_display_name,
            app=app,
            credit_rating=credit_rating,
            roll_record=roll_record,
            achieved_level=achieved_level,
            outcome=str(result["outcome"]),
            passed=bool(result["passed"]),
            surplus_levels=int(result["surplus_levels"]),
            context=context,
        )
        coc_first_impression.put_receipt(document, receipt)
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    coc_state.write_json_atomic(
        coc_first_impression.document_path(ctx.campaign_dir), document
    )
    _ensure_first_impression_roll(ctx, receipt)
    _emit_npc_relationship_changed(
        ctx,
        source="coc_operation_npc_world.npc_reaction",
        decision_id=receipt["decision_id"],
        npc_id=receipt["npc_id"],
        investigator_id=receipt["investigator_id"],
        channel="first-impression",
        after=receipt.get("reaction_tier"),
        reason=(receipt.get("context") or {}).get("semantic_reason"),
        source_roll_id=receipt.get("roll_id"),
    )
    data = deepcopy(receipt)
    data["first_impression_ref"] = receipt["receipt_id"]
    data["record_engagement_operation"] = (
        _first_impression_engagement_card(receipt)
    )
    hints = [
        "the D100 is public and frozen; do not alter it with authored hostility, relationship state, scene constraints, or bonus/penalty dice",
        "the reaction_tier changes immediate opportunity or friction, not the NPC's agenda, allegiance, safety policy, authority, or established relationship",
        "supply first_impression_realization to the matching first state.record_npc_engagement call using the stored context and current fiction",
        "pass first_impression_ref to the matching first state.record_npc_engagement call",
    ]
    if achieved_level in {"critical", "fumble"}:
        hints.insert(
            0,
            "before state.journal, apply an independent source-bound state.exceptional_effect for this first-impression roll; prose, a flag, or elapsed time is insufficient",
        )
        hints.insert(
            1,
            "before applying that effect, write player_visible_impact, causal_link, "
            "and any until_condition boundary.description in the campaign's active "
            "play_language; turn.finalize renders all three verbatim",
        )
    return data, [], hints

def _tool_npc_advise(ctx: Ctx, args: dict[str, Any]):
    intent = _intent_evidence(args.get("intent_evidence"))
    scene = _active_scene(ctx)
    npc_state = coc_npc_state.load_npc_state(ctx.campaign_dir)
    result = coc_npc_persona.build_scene_npc_agency(
        scene,
        ctx.npc_agendas,
        npc_state,
        seed_parts=[ctx.campaign_id, scene.get("scene_id"), args.get("seed", 0)],
        player_intent_rich=intent,
    )
    return {
        "schema_version": 1,
        "advice_id": _advice_id("npc", ctx, result),
        "authority": "advisory",
        "intent_evidence": intent,
        "candidate_agency": result,
    }, [], [
        "choose, modify, or ignore these moves according to the actual conversation",
        "npc_state_writes are proposals; no persona or psych state was persisted",
    ]

def _tool_state_record_npc_engagement(ctx: Ctx, args: dict[str, Any]):
    tool_name = "state.record_npc_engagement"
    (
        decision_id,
        requested_npc_id,
        requested_interaction_kind,
        run_id,
        operation,
    ) = _npc_engagement_operation(ctx, args)
    supplied_route_completion = deepcopy(operation.get("route_completion"))
    supplied_identity_ref = str(args.get("identity_ref") or "").strip()
    supplied_first_impression_ref = str(
        args.get("first_impression_ref") or ""
    ).strip()
    supplied_realization = deepcopy(args.get("first_impression_realization"))
    investigator_id = str(operation["investigator_id"])
    campaign_id = coc_npc_event_chain.resolve_campaign_id(ctx.campaign_dir)

    document = _reconcile_all_npc_source_receipts(ctx)
    prior_receipts = _npc_receipts_for_decision(
        document, producer=tool_name, decision_id=decision_id
    )
    if prior_receipts:
        if len(prior_receipts) != 1:
            raise ToolError(
                "state_corrupt",
                f"{tool_name} decision_id '{decision_id}' has multiple source receipts",
            )
        receipt = prior_receipts[0]
        if receipt.get("run_id") != run_id:
            raise ToolError(
                "idempotency_conflict",
                f"decision_id '{decision_id}' was already applied in a different play run",
            )
        if receipt.get("operation_digest") != coc_npc_event_chain.canonical_digest(
            operation
        ):
            raise ToolError(
                "idempotency_conflict",
                f"decision_id '{decision_id}' was already applied to a different NPC engagement payload",
            )
        prior_event = receipt.get("event") if isinstance(receipt.get("event"), dict) else {}
        prior_effect = prior_event.get("context_effect") if isinstance(prior_event.get("context_effect"), dict) else {}
        if prior_event.get("first_contact") and all(
            isinstance(prior_effect.get(field), str) and prior_effect.get(field, "").strip()
            for field in (
                "source_receipt_id", "observable_manner", "causal_explanation",
                "boundary_preserved", "opportunity_or_friction",
            )
        ):
            coc_npc_state.initialize_first_impression(
                ctx.campaign_dir,
                str(prior_event.get("npc_id") or requested_npc_id),
                str(prior_event.get("investigator_id") or investigator_id),
                receipt_id=str(prior_effect["source_receipt_id"]),
                observable_manner=str(prior_effect["observable_manner"]),
                causal_explanation=str(prior_effect["causal_explanation"]),
                boundary_preserved=str(prior_effect["boundary_preserved"]),
                opportunity_or_friction=str(prior_effect["opportunity_or_friction"]),
                decision_id=decision_id,
            )
        _ensure_npc_receipt_event(ctx, receipt)
        route_receipt, route_warnings = _settle_engagement_route_completion(
            ctx,
            (receipt.get("operation") or {}).get("route_completion"),
            decision_id=decision_id,
            evidence_ref=f"logs/events.jsonl#{receipt['event_id']}",
        )
        replay_hints = []
        if route_receipt is not None:
            replay_hints.append(
                f"the engagement also completed authored route '{route_receipt['route_id']}' by recorded KP semantic judgment"
            )
        return deepcopy(receipt["event"]), [
            *_npc_receipt_warnings(receipt),
            *route_warnings,
            "duplicate decision_id: recovered the source-owned NPC engagement receipt",
        ], replay_hints

    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        raise ToolError(
            "state_corrupt",
            f"toolbox ledger entry for {tool_name} decision_id '{decision_id}' has no canonical source receipt",
        )

    authored_npc = _npc_by_id(ctx.npc_agendas, requested_npc_id)
    npc_id = str(authored_npc.get("npc_id")) if authored_npc else requested_npc_id
    prior_pair_engagements = [
        receipt
        for receipt in (document.get("receipts") or {}).values()
        if isinstance(receipt, dict)
        and receipt.get("producer") == tool_name
        and isinstance(receipt.get("event"), dict)
        and receipt["event"].get("investigator_id") == investigator_id
        and receipt["event"].get("npc_id") == npc_id
    ]
    first_contact = not prior_pair_engagements
    first_impression_receipt: dict[str, Any] | None = None
    context_effect: dict[str, Any] | None = None
    if first_contact:
        if not supplied_first_impression_ref:
            raise ToolError(
                "first_impression_required",
                "first contact requires first_impression_ref from npc.reaction before the engagement is written",
            )
        try:
            impression_document = coc_first_impression.load_document(
                ctx.campaign_dir, campaign_id
            )
            first_impression_receipt = coc_first_impression.find_by_ref(
                impression_document, supplied_first_impression_ref
            )
        except ValueError as exc:
            raise ToolError("state_corrupt", str(exc)) from exc
        if first_impression_receipt is None:
            raise ToolError(
                "first_impression_mismatch",
                "first_impression_ref does not identify a canonical current receipt",
            )
        if (
            first_impression_receipt.get("campaign_id") != campaign_id
            or first_impression_receipt.get("run_id") != run_id
            or first_impression_receipt.get("investigator_id") != investigator_id
            or first_impression_receipt.get("npc_id") != npc_id
        ):
            raise ToolError(
                "first_impression_mismatch",
                "first_impression_ref belongs to another campaign/run/investigator/NPC",
            )
        if first_impression_receipt.get("schema_version") == 2:
            if not coc_first_impression.valid_realization(supplied_realization):
                raise ToolError(
                    "first_impression_realization_required",
                    "schema-v2 first contact requires a complete causal realization grounded in NPC/scene/relationship/conduct boundaries",
                )
            _ensure_first_impression_roll(ctx, first_impression_receipt)
            context_effect = coc_first_impression.player_context_effect(
                first_impression_receipt, supplied_realization
            )
        else:
            if supplied_realization is not None:
                raise ToolError(
                    "invalid_param",
                    "legacy first-impression receipts already own their frozen observable manner",
                )
            context_effect = coc_first_impression.player_context_effect(
                first_impression_receipt
            )
    elif supplied_first_impression_ref:
        raise ToolError(
            "first_impression_already_consumed",
            "later meetings do not repeat or replace the pair's first-impression effect",
        )
    elif supplied_realization is not None:
        raise ToolError(
            "first_impression_already_consumed",
            "later meetings do not submit another first-impression realization",
        )
    interaction_kind = requested_interaction_kind
    allowed = {
        "dialogue", "assistance", "opposition", "accompaniment", "witness", "other",
    }
    if interaction_kind not in allowed:
        interaction_kind = "other"
    scene_id = str(ctx.world().get("active_scene_id") or "scene:unknown")
    identity_contract = (
        _npc_identity_contract(authored_npc, scene_id) if authored_npc else None
    )
    identity_binding = coc_npc_identity.identity_binding(
        identity_contract,
        supplied_identity_ref=supplied_identity_ref,
    )
    binding_status = str(identity_binding["status"])
    binding_reasons = list(identity_binding.get("reasons") or [])
    event_id = coc_npc_event_chain.stable_event_id(
        producer=tool_name,
        campaign_id=campaign_id,
        run_id=run_id,
        decision_id=decision_id,
        scene_id=scene_id,
        npc_id=npc_id,
        event_type="npc_engagement",
        ordinal=0,
    )
    event = {
        "schema_version": coc_npc_identity.ENGAGEMENT_EVENT_SCHEMA_VERSION,
        "event_type": "npc_engagement",
        "event_id": event_id,
        "source_receipt_schema_version": coc_npc_event_chain.RECEIPT_SCHEMA_VERSION,
        "producer": tool_name,
        "campaign_id": campaign_id,
        "run_id": run_id,
        "decision_id": decision_id,
        "investigator_id": investigator_id,
        "npc_id": npc_id,
        "scene_id": scene_id,
        "ts": _now_iso(),
        "interaction_kind": interaction_kind,
        "first_contact": first_contact,
        "first_impression_ref": (
            first_impression_receipt["receipt_id"]
            if first_impression_receipt is not None else None
        ),
        "context_effect": context_effect,
        "identity_contract": identity_contract,
        "identity_binding": identity_binding,
    }
    if supplied_route_completion is not None:
        event["route_completion"] = deepcopy(supplied_route_completion)
    warnings: list[str] = []
    if authored_npc is None:
        warnings.append(
            f"npc '{npc_id}' is not in the authored agendas — recorded as an improvised NPC"
        )
    elif binding_status == "unverified":
        warnings.append(
            f"authored npc '{npc_id}' engagement was recorded, but identity_ref is missing; it is not authored-NPC coverage"
        )
    elif binding_status == "mismatch" and "identity_ref_mismatch" in binding_reasons:
        warnings.append(
            f"supplied identity_ref does not match authored npc '{npc_id}'; engagement was recorded without authored-NPC coverage"
        )
    elif binding_status == "mismatch":
        warnings.append(
            f"authored npc '{npc_id}' is outside its structured scene schedule; engagement was recorded without authored-NPC coverage"
        )
    if authored_npc is not None and requested_npc_id != npc_id:
        warnings.append(
            f"resolved NPC alias '{requested_npc_id}' to authored id '{npc_id}'"
        )
    if requested_interaction_kind != interaction_kind:
        event["interaction_label"] = requested_interaction_kind
        warnings.append(
            f"unrecognized interaction_kind '{requested_interaction_kind}' was preserved as interaction_label and normalized to 'other'"
        )
    receipt = coc_npc_event_chain.new_receipt(
        producer=tool_name,
        campaign_id=campaign_id,
        run_id=run_id,
        decision_id=decision_id,
        scene_id=scene_id,
        npc_id=npc_id,
        event_type="npc_engagement",
        ordinal=0,
        operation=operation,
        event=event,
    )
    if first_contact and isinstance(context_effect, dict) and all(
        isinstance(context_effect.get(field), str) and context_effect.get(field, "").strip()
        for field in (
            "source_receipt_id", "observable_manner", "causal_explanation",
            "boundary_preserved", "opportunity_or_friction",
        )
    ):
        coc_npc_state.initialize_first_impression(
            ctx.campaign_dir,
            npc_id,
            investigator_id,
            receipt_id=str(context_effect["source_receipt_id"]),
            observable_manner=str(context_effect["observable_manner"]),
            causal_explanation=str(context_effect["causal_explanation"]),
            boundary_preserved=str(context_effect["boundary_preserved"]),
            opportunity_or_friction=str(context_effect["opportunity_or_friction"]),
            decision_id=decision_id,
        )
    try:
        coc_npc_event_chain.put_receipt(document, receipt)
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    # Source first: a crash before event/ledger is repaired by the next
    # mutating tool, even if the host chooses a different decision id.
    _save_npc_receipt_document(ctx, document)
    _ensure_npc_receipt_event(ctx, receipt)
    route_receipt, route_warnings = _settle_engagement_route_completion(
        ctx,
        supplied_route_completion,
        decision_id=decision_id,
        evidence_ref=f"logs/events.jsonl#{event_id}",
    )
    warnings.extend(route_warnings)
    hints = _npc_engagement_advisory_hints(authored_npc, npc_id)
    if first_contact:
        hints.append(
            "first contact settled exactly once for this pair: realize its observable manner, cause, and bounded opportunity/friction in the same fictional beat; other NPC pairs in this journal remain independent"
        )
    if route_receipt is not None:
        hints.append(
            f"this engagement completed authored route '{route_receipt['route_id']}' by explicit KP semantic judgment; dependent route cards are now discoverable without replaying its authored roll gate"
        )
    data = deepcopy(event)
    ctx.ledger_record(decision_id, tool_name, data)
    return data, warnings, hints

def _tool_state_npc_presence(ctx: Ctx, args: dict[str, Any]):
    tool_name = "state.npc_presence"
    decision_id = str(args["decision_id"])
    requested_npc_id = str(args["npc_id"]).strip()
    authored_npc = _npc_by_id(ctx.npc_agendas, requested_npc_id)
    npc_id = (
        str(authored_npc.get("npc_id")) if authored_npc else requested_npc_id
    )
    scene_id = str(args["scene_id"]).strip()
    status = str(args["status"]).strip().lower()
    reason = str(args["reason"]).strip()
    if not npc_id:
        raise ToolError("invalid_param", "npc_id must be non-empty")
    if not scene_id:
        raise ToolError("invalid_param", "scene_id must be non-empty")
    if status not in {"present", "absent"}:
        raise ToolError("invalid_param", "status must be present or absent")
    if not reason:
        raise ToolError("invalid_param", "reason must be non-empty")

    operation = {
        "npc_id": npc_id,
        "scene_id": scene_id,
        "status": status,
        "reason": reason,
    }
    document = _load_npc_presence_document(ctx)
    receipt = _source_receipt(document, tool_name, decision_id)
    if receipt is not None:
        _validate_source_receipt(
            receipt,
            tool_name=tool_name,
            decision_id=decision_id,
            operation=operation,
        )
        return _replay_source_receipt(ctx, receipt)
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        raise ToolError(
            "state_corrupt",
            f"toolbox ledger entry for {tool_name} decision_id '{decision_id}' has no canonical source receipt",
        )

    previous = deepcopy(document["presence"].get(npc_id))
    source_sequence = int(document["presence_source_sequence"]) + 1
    changed_at = _now_iso()
    record = {
        "schema_version": _NPC_PRESENCE_SCHEMA_VERSION,
        "npc_id": npc_id,
        "scene_id": scene_id,
        "status": status,
        "reason": reason,
        "revision": int((previous or {}).get("revision") or 0) + 1,
        "changed_at": changed_at,
        "decision_id": decision_id,
        "source_sequence": source_sequence,
        "producer": tool_name,
    }
    document["presence"][npc_id] = record
    live_record = _npc_presence_live_record(document, npc_id)
    entity_head = coc_flag_state.entity_head(
        entity_kind="npc_presence",
        entity_id=npc_id,
        decision_id=decision_id,
        source_sequence=source_sequence,
        producer=tool_name,
        live_record=live_record,
    )
    document["presence_heads"][npc_id] = deepcopy(entity_head)
    document["presence_source_sequence"] = source_sequence
    event = {
        "npc_presence_schema_version": _NPC_PRESENCE_SCHEMA_VERSION,
        "event_type": "npc_presence_changed",
        "event_id": _operation_event_id(tool_name, decision_id),
        "npc_id": npc_id,
        "scene_id": scene_id,
        "status": status,
        "previous_scene_id": (previous or {}).get("scene_id"),
        "previous_status": (previous or {}).get("status"),
        "reason": reason,
        "decision_id": decision_id,
        "source_sequence": source_sequence,
        "ts": changed_at,
        "live_head_digest": coc_flag_state.canonical_digest(entity_head),
    }
    warnings: list[str] = []
    if authored_npc is None:
        warnings.append(
            f"npc '{npc_id}' is campaign-local/improvised; explicit presence is tracked without inventing an authored identity contract"
        )
    elif requested_npc_id != npc_id:
        warnings.append(
            f"resolved NPC alias '{requested_npc_id}' to authored id '{npc_id}'"
        )
    if _scene_by_id(ctx.story_graph, scene_id) is None:
        warnings.append(
            f"scene '{scene_id}' is not in the current authored graph; presence remains campaign-local continuity"
        )
    hints = [
        "scene.context overlays this explicit live record over authored initial npc_ids; update it again when the NPC leaves or relocates",
        "do not derive current presence from state.record_npc_engagement history",
    ]
    data = {
        "npc_id": npc_id,
        "presence": deepcopy(record),
        "previous_presence": previous,
    }
    receipt = _new_source_receipt(
        tool_name=tool_name,
        decision_id=decision_id,
        operation=operation,
        event=event,
        data=data,
        warnings=warnings,
        hints=hints,
        entity_head=entity_head,
    )
    _put_source_receipt(document, receipt)
    coc_npc_state.save_npc_state(ctx.campaign_dir, document)
    _ensure_operation_event(ctx, receipt)
    ctx.ledger_record(
        decision_id,
        tool_name,
        data,
        source_receipt_manifest=_source_receipt_manifest(receipt),
    )
    return data, warnings, hints

def _tool_state_npc_update(ctx: Ctx, args: dict[str, Any]):
    prior = ctx.ledger_lookup("state.npc_update", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previously settled result"], []
    requested_npc_id = str(args["npc_id"])
    investigator_id = (
        _resolve_investigator(ctx, args)
        if args.get("investigator") is not None
        else None
    )
    authored_npc = _npc_by_id(ctx.npc_agendas, requested_npc_id)
    npc_id = str(authored_npc.get("npc_id")) if authored_npc else requested_npc_id
    applied, entry = coc_npc_state.apply_psych_update(
        ctx.campaign_dir,
        npc_id,
        deltas={
            field: args[key]
            for field, key in (
                ("trust", "trust_delta"),
                ("fear", "fear_delta"),
                ("suspicion", "suspicion_delta"),
            )
            if args.get(key) is not None
        },
        record_fact_id=args.get("record_fact") or None,
        record_lie_id=args.get("record_lie") or None,
        record_promise_id=args.get("record_promise") or None,
        resolve_promise=deepcopy(args.get("resolve_promise")),
        availability=args.get("availability") or None,
        investigator_id=investigator_id,
        impression_update=deepcopy(args.get("impression_update")),
    )
    ctx.log_event({"event_type": "npc_update", "npc_id": npc_id, "applied": applied})
    if investigator_id is not None and args.get("decision_id") is not None:
        for field in ("trust", "fear", "suspicion"):
            if field not in applied:
                continue
            raw_delta = args.get(f"{field}_delta")
            new_value = int(applied[field])
            try:
                before_value = max(-5, min(5, new_value - int(raw_delta)))
            except (TypeError, ValueError):
                before_value = None
            _emit_npc_relationship_changed(
                ctx,
                source="coc_operation_npc_world.state_npc_update",
                decision_id=args.get("decision_id"),
                npc_id=npc_id,
                investigator_id=investigator_id,
                channel=field,
                before=before_value,
                after=new_value,
            )
    warnings: list[str] = []
    if authored_npc is None:
        warnings.append(f"npc '{npc_id}' is not in the authored agendas — tracking state anyway (improvised NPC)")
    elif requested_npc_id != npc_id:
        warnings.append(
            f"resolved NPC alias '{requested_npc_id}' to authored id '{npc_id}'"
        )
    hints = _npc_engagement_advisory_hints(authored_npc, npc_id)
    if args.get("impression_update") is not None:
        hints.append(
            "textual impression updated for this investigator/NPC pair; later NPC portrayals should treat it as semantic context, not a deterministic gate"
        )
    data = {
        "npc_id": npc_id,
        "investigator_id": investigator_id,
        "applied": applied,
        "psych": entry,
    }
    ctx.ledger_record(args.get("decision_id"), "state.npc_update", data)
    return data, warnings, hints

def register_operations(registry) -> None:
    global TOOLS
    TOOLS = registry.legacy_tools
    registry.tool(
    "npc.query",
    "NPC agendas, live psych state, and compact first-contact readiness for one requested NPC. 'secret'-marked fields are keeper-only reference — never reveal verbatim.",
    {
        "npc_id": {"type": "string", "desc": "a single NPC (default: all)"},
        "investigator": {"type": "string", "desc": "investigator whose pair-scoped impression should be projected"},
        "since_revision": {
            "type": "string",
            "desc": "revision returned by the previous identical query; matching state returns not_modified instead of the full projection",
        },
    },
    access="query",
    read_domains=("npc", "scene", "party"),
    recovery_domains=("npc",),
    response_mode="full_or_not_modified",
    audit_mode="reference",
)(_tool_npc_query)
    registry.tool(
    "npc.reaction",
    "Settle exactly one public first-impression D100 for an investigator/NPC pair against max(APP, Credit Rating). Returns the frozen achieved level and reaction tier; the KP supplies the context-sensitive causal realization when recording the first engagement.",
    {
        "npc_id": {"type": "string", "required": True, "desc": "stable authored or improvised NPC id"},
        "npc_display_name": {"type": "string", "desc": "required for a new pair: localized player-safe table name for this stable NPC; never pass the raw npc_id"},
        "investigator": {"type": "string", "desc": "investigator id (optional when party has one member)"},
        "run_id": {"type": "string", "desc": "current play/report segment run id; use the same value for the first engagement"},
        "context": {
            "type": "object",
            "desc": "required for a new pair: exactly {player_conduct, scene_constraints, authored_or_relationship_boundary, semantic_reason}; structured semantic grounding only, never used to alter the die",
        },
        "seed": {"type": "integer", "desc": "deterministic advisory seed"},
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key; a second decision for the same pair returns the frozen receipt"},
    },
)(_tool_npc_reaction)
    registry.tool(
    "npc.advise",
    "Build existing persona cards and optional NPC agency moves for NPCs in the active scene. Advice only.",
    {
        "intent_evidence": {"type": "object", "required": True, "desc": "KP semantic intent result"},
        "seed": {"type": "integer", "desc": "deterministic advisory seed"},
    },
)(_tool_npc_advise)
    registry.tool(
    "state.record_npc_engagement",
    "Record one NPC's material participation. Each first investigator/NPC contact binds that pair's canonical npc.reaction receipt plus a KP-authored causal realization; one journal may contain zero to many independent engagements.",
    {
        "npc_id": {"type": "string", "required": True, "desc": "stable authored or improvised NPC id"},
        "investigator": {"type": "string", "desc": "investigator id (optional when party has one member)"},
        "interaction_kind": {
            "type": "string",
            "required": True,
            "desc": "dialogue | assistance | opposition | accompaniment | witness | other",
        },
        "identity_ref": {
            "type": "string",
            "desc": "exact identity_ref returned by npc.query/scene.context when the authored identity was portrayed",
        },
        "first_impression_ref": {
            "type": "string",
            "desc": "receipt ref from npc.reaction; mandatory on the first contact for this investigator/NPC pair",
        },
        "first_impression_realization": {
            "type": "object",
            "desc": "required for a new schema-v2 receipt: exactly {observable_manner, causal_explanation, boundary_preserved, opportunity_or_friction}; semantic KP judgment grounded in persona/agenda/relationship/scene/conduct",
            "properties": {
                "observable_manner": {"type": "string"},
                "causal_explanation": {"type": "string"},
                "boundary_preserved": {"type": "string"},
                "opportunity_or_friction": {"type": "string"},
            },
            "required_fields": [
                "observable_manner",
                "causal_explanation",
                "boundary_preserved",
                "opportunity_or_friction",
            ],
        },
        "route_completion": {
            "type": "object",
            "desc": "optional exact {scene_id, route_id, semantic_reason}; include only when this engagement causally completes that authored route by KP semantic judgment, never by prose matching",
        },
        "run_id": {
            "type": "string",
            "desc": "current play/report segment run id; live play hosts supply this automatically",
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_state_record_npc_engagement)
    registry.tool(
    "state.npc_presence",
    "Explicitly place or remove one stable authored/improvised NPC in a scene. This is live scene state; engagement history never implies continued presence.",
    {
        "npc_id": {
            "type": "string",
            "required": True,
            "desc": "stable authored or campaign-local NPC id",
        },
        "scene_id": {
            "type": "string",
            "required": True,
            "desc": "scene whose live presence is being asserted or ended",
        },
        "status": {
            "type": "string",
            "required": True,
            "enum": ["present", "absent"],
            "desc": "present places the NPC here; absent records that they are no longer here",
        },
        "reason": {
            "type": "string",
            "required": True,
            "desc": "fictional cause for this explicit presence change",
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
    write_domains=("npc_presence",),
)(_tool_state_npc_presence)
    registry.tool(
    "state.npc_update",
    "Update an NPC's live psych state: trust/fear/suspicion deltas, facts told, lies, promises made or resolved, availability, and a bounded investigator-specific textual impression authored by the KP.",
    {
        "npc_id": {"type": "string", "required": True, "desc": "npc id"},
        "investigator": {"type": "string", "desc": "investigator whose action changed this relationship; required when linking an NPC-scoped reward"},
        "trust_delta": {"type": "integer", "desc": "trust adjustment (-5..5 clamped)"},
        "fear_delta": {"type": "integer", "desc": "fear adjustment"},
        "suspicion_delta": {"type": "integer", "desc": "suspicion adjustment"},
        "record_fact": {"type": "string", "desc": "fact_id the NPC just disclosed"},
        "record_lie": {"type": "string", "desc": "lie_id the NPC just told"},
        "record_promise": {"type": "string", "desc": "promise_id made"},
        "resolve_promise": {
            "type": "object",
            "desc": "close an existing promise as exactly {promise_id, kept:boolean}",
            "properties": {
                "promise_id": {"type": "string"},
                "kept": {"type": "boolean"},
            },
            "additionalProperties": False,
        },
        "availability": {"type": "string", "desc": "availability status: available | unavailable"},
        "impression_update": {
            "type": "object",
            "desc": "semantic KP-authored update: {summary?, expectations?, reservations?, memory?, reason}; memory requires memory_id, event, interpretation, reason",
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_state_npc_update)


OPERATION_EXPORTS = (
    '_first_contact_localized_name',
    '_first_contact_readiness',
    '_first_impression_display_skill',
    '_first_impression_engagement_card',
    '_first_impression_hint',
    '_npc_engagement_advisory_hints',
    '_save_npc_receipt_document',
    '_tool_npc_advise',
    '_tool_npc_query',
    '_tool_npc_reaction',
    '_tool_state_npc_presence',
    '_tool_state_npc_update',
    '_tool_state_record_npc_engagement',
    'coc_npc_persona',
)
