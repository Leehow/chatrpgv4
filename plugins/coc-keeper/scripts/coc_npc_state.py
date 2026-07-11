#!/usr/bin/env python3
"""Persistent NPC psychological state (G3).

Per-campaign store under ``save/npc-state.json["psych"]`` — namespaced beside
the persona cards the apply layer writes wholesale under ``"npcs"``, so card
overwrites never clobber accumulated psychology.

Each NPC entry:
    {trust: int, fear: int, suspicion: int,          # clamped -5..+5
     known_facts: [fact_id],
     lies_told: [{lie_id, about}],
     promises: [{promise_id, kept: bool|null}]}

``npc_disposition`` derives a stance (hostile|wary|neutral|warm) plus
structured drivers from numeric thresholds only — never from agenda prose
(Semantic Matcher Constitution).
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent


def _load_sibling(name: str, filename: str):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_fileio = _load_sibling("coc_fileio", "coc_fileio.py")

NUMERIC_FIELDS = ("trust", "fear", "suspicion")
FIELD_MIN = -5
FIELD_MAX = 5

# Disposition thresholds (structured numeric — see npc_disposition).
HOSTILE_TRUST_MAX = -3      # trust <= -3 -> hostile
HOSTILE_SUSPICION_MIN = 3   # suspicion >= 3 -> hostile
HOSTILE_FEAR_MIN = 4        # fear >= 4 -> cornered-animal hostility
WARM_TRUST_MIN = 3          # trust >= 3 (and no wary/hostile driver) -> warm
WARY_FEAR_MIN = 2           # fear >= 2 -> wary
WARY_SUSPICION_MIN = 1      # suspicion >= 1 -> wary
WARY_TRUST_MAX = -1         # trust <= -1 -> wary


def _state_path(campaign_dir: Path) -> Path:
    return Path(campaign_dir) / "save" / "npc-state.json"


def _default_entry() -> dict[str, Any]:
    return {
        "trust": 0,
        "fear": 0,
        "suspicion": 0,
        "known_facts": [],
        "lies_told": [],
        "promises": [],
        "revealable_facts": [],
        "lie_options": [],
        "deflect_options": [],
        "deflections": [],
        "leverage": [],
        "active_reactions": [],
        "availability": {"status": "available"},
        "schedule": [],
    }


def _string_list(value: Any) -> list[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item.strip() or item.strip() in result:
            continue
        result.append(item.strip())
    return result


def _dict_list(value: Any, *, id_keys: tuple[str, ...] = ()) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, dict):
            continue
        copy = dict(item)
        identity = next((str(copy.get(k)) for k in id_keys if copy.get(k)), "")
        if identity and identity in seen:
            continue
        if identity:
            seen.add(identity)
        result.append(copy)
    return result


def normalize_entry(value: Any) -> dict[str, Any]:
    """Return a canonical read view for legacy or malformed psych records.

    This is intentionally a read-time compatibility normalizer, not a global
    state migration. Unknown fields are ignored so Keeper-only scenario prose
    cannot accidentally cross into the runtime state contract.
    """
    raw = value if isinstance(value, dict) else {}
    result = _default_entry()
    for field in NUMERIC_FIELDS:
        try:
            number = int(raw.get(field, 0) or 0)
        except (TypeError, ValueError):
            number = 0
        result[field] = max(FIELD_MIN, min(FIELD_MAX, number))
    result["known_facts"] = _string_list(raw.get("known_facts"))
    result["revealable_facts"] = _string_list(
        raw.get("revealable_facts", raw.get("revealable_fact_ids"))
    )
    result["lies_told"] = _dict_list(raw.get("lies_told"), id_keys=("lie_id",))
    result["promises"] = _dict_list(raw.get("promises"), id_keys=("promise_id",))
    result["lie_options"] = _dict_list(raw.get("lie_options"), id_keys=("lie_id",))
    result["deflect_options"] = _dict_list(
        raw.get("deflect_options"), id_keys=("deflect_id",)
    )
    result["deflections"] = _dict_list(
        raw.get("deflections"), id_keys=("deflect_id",)
    )
    result["leverage"] = _string_list(raw.get("leverage", raw.get("leverage_ids")))
    result["active_reactions"] = _dict_list(
        raw.get("active_reactions"), id_keys=("reaction_id",)
    )
    availability = raw.get("availability")
    if isinstance(availability, str) and availability.strip():
        availability = {"status": availability.strip()}
    if not isinstance(availability, dict):
        availability = {"status": "available"}
    status = str(availability.get("status") or "available")
    if status not in {"available", "unavailable"}:
        status = "unavailable"
    result["availability"] = {"status": status}
    result["schedule"] = _dict_list(raw.get("schedule"), id_keys=("schedule_id",))
    return result


def load_npc_state(campaign_dir: Path) -> dict[str, Any]:
    """Load the full npc-state.json document (persona cards + psych)."""
    path = _state_path(campaign_dir)
    try:
        state = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        state = {}
    if not isinstance(state, dict):
        state = {}
    state.setdefault("schema_version", 1)
    if not isinstance(state.get("npcs"), dict):
        state["npcs"] = {}
    if not isinstance(state.get("psych"), dict):
        state["psych"] = {}
    return state


def save_npc_state(campaign_dir: Path, state: dict[str, Any]) -> None:
    """Atomically persist the full npc-state.json document."""
    coc_fileio.write_json_atomic(_state_path(campaign_dir), state)


def _psych_entry(state: dict[str, Any], npc_id: str) -> dict[str, Any]:
    psych = state["psych"]
    entry = psych.get(str(npc_id))
    if not isinstance(entry, dict):
        entry = _default_entry()
        psych[str(npc_id)] = entry
    else:
        entry = normalize_entry(entry)
        psych[str(npc_id)] = entry
    return entry


def get_npc_entry(campaign_dir: Path, npc_id: str) -> dict[str, Any]:
    """Read one NPC's psych entry (defaults when absent). Does not write."""
    state = load_npc_state(campaign_dir)
    entry = state["psych"].get(str(npc_id))
    if not isinstance(entry, dict):
        return _default_entry()
    return normalize_entry(entry)


def disclosure_decision(
    npc_state_entry: dict[str, Any] | None,
    fact_id: str,
    *,
    clue_id: str | None = None,
    min_trust: int = 0,
    required_leverage_ids: list[str] | None = None,
    lie_option: dict[str, Any] | None = None,
    deflect_option: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Evaluate disclosure in the fixed A21 gate order.

    The function consumes only structured state and authored enums. It never
    scans agenda, player, or clue prose. Lie is preferred over deflection only
    when the author supplied a matching structured option.
    """
    entry = normalize_entry(npc_state_entry)
    fid = str(fact_id or "").strip()
    base = {"fact_id": fid, "clue_id": clue_id}
    if entry["availability"]["status"] != "available":
        return {"outcome": "withhold", "reason_code": "npc_unavailable", **base}
    if fid not in entry["known_facts"]:
        return {"outcome": "withhold", "reason_code": "fact_not_known", **base}
    if fid not in entry["revealable_facts"]:
        return {"outcome": "withhold", "reason_code": "fact_not_revealable", **base}
    blockers = [
        str(r.get("reaction_id") or "reaction")
        for r in entry["active_reactions"]
        if r.get("blocks_disclosure") is True
    ]
    if blockers:
        return {
            "outcome": "withhold", "reason_code": "active_reaction_blocks",
            "blocking_reaction_ids": blockers, **base,
        }
    required = _string_list(required_leverage_ids)
    has_leverage = bool(required and set(required) & set(entry["leverage"]))
    if entry["trust"] < int(min_trust or 0) and not has_leverage:
        option = lie_option if isinstance(lie_option, dict) else None
        if option is None:
            option = next((o for o in entry["lie_options"] if o.get("fact_id") in {None, fid}), None)
        if option:
            return {
                "outcome": "lie", "reason_code": "willingness_lie",
                "lie_id": option.get("lie_id"), "about": option.get("about") or fid,
                **base,
            }
        option = deflect_option if isinstance(deflect_option, dict) else None
        if option is None:
            option = next((o for o in entry["deflect_options"] if o.get("fact_id") in {None, fid}), None)
        if option:
            return {
                "outcome": "deflect", "reason_code": "willingness_deflect",
                "deflect_id": option.get("deflect_id"), **base,
            }
        return {"outcome": "withhold", "reason_code": "willingness_insufficient", **base}
    return {"outcome": "reveal", "reason_code": "approved_reveal", **base}


_INTERACTION_EFFECTS: dict[tuple[str, bool], tuple[tuple[str, int], ...]] = {
    ("build_rapport", True): (("trust", 1),),
    ("build_rapport", False): (("suspicion", 1),),
    ("intimidate", True): (("fear", 1), ("trust", -1)),
    ("intimidate", False): (("suspicion", 1),),
    ("deceive", True): (("suspicion", -1),),
    ("deceive", False): (("suspicion", 2), ("trust", -1)),
    ("reassure", True): (("fear", -1), ("trust", 1)),
    ("reassure", False): (("suspicion", 1),),
}


def derive_interaction_effects(
    interactions: Any, rule_results: Any
) -> list[dict[str, Any]]:
    """Compile successful/failed structured social tactics into bounded effects."""
    results = [r for r in (rule_results or []) if isinstance(r, dict)]
    effects: list[dict[str, Any]] = []
    for interaction in interactions or []:
        if not isinstance(interaction, dict):
            continue
        npc_id = interaction.get("npc_id")
        request_id = interaction.get("request_id")
        tactic = interaction.get("tactic")
        if not npc_id or not request_id or not isinstance(tactic, str):
            continue
        matches = [
            row for row in results
            if request_id in {
                row.get("request_id"), row.get("rule_request_id"),
                row.get("source_request_id"), row.get("command_id"),
            }
        ]
        if len(matches) != 1:
            continue
        success = matches[0].get("success")
        if not isinstance(success, bool):
            continue
        for field, delta in _INTERACTION_EFFECTS.get((tactic, success), ()):
            effects.append({
                "npc_id": str(npc_id), "kind": "adjust", "field": field,
                "delta": delta, "interaction_request_id": str(request_id),
            })
        if tactic == "offer_leverage" and success and interaction.get("leverage_id"):
            effects.append({
                "npc_id": str(npc_id), "kind": "record_leverage",
                "leverage_id": str(interaction["leverage_id"]),
                "interaction_request_id": str(request_id),
            })
    return effects


def _authored_fact_specs(agenda: dict[str, Any]) -> list[dict[str, Any]]:
    knowledge = agenda.get("knowledge") if isinstance(agenda.get("knowledge"), dict) else {}
    raw = agenda.get("facts")
    if not isinstance(raw, list):
        raw = knowledge.get("facts")
    return _dict_list(raw, id_keys=("fact_id",))


def effective_npc_entry(
    agenda: dict[str, Any] | None,
    persisted: dict[str, Any] | None,
    *,
    scene_id: str | None = None,
    time_category: str | None = None,
) -> dict[str, Any]:
    """Merge authored A21 fields over a normalized persistent psych entry."""
    authored = agenda if isinstance(agenda, dict) else {}
    entry = normalize_entry(persisted)
    knowledge = authored.get("knowledge") if isinstance(authored.get("knowledge"), dict) else {}
    specs = _authored_fact_specs(authored)
    known = _string_list(authored.get("known_fact_ids", knowledge.get("known_fact_ids")))
    known.extend(str(s["fact_id"]) for s in specs if s.get("fact_id") and str(s["fact_id"]) not in known)
    revealable = _string_list(
        authored.get("revealable_fact_ids", knowledge.get("revealable_fact_ids"))
    )
    revealable.extend(
        str(s["fact_id"]) for s in specs
        if s.get("fact_id") and s.get("revealable") is not False and str(s["fact_id"]) not in revealable
    )
    for key, values in (("known_facts", known), ("revealable_facts", revealable)):
        entry[key] = _string_list([*entry[key], *values])
    for key, id_key in (
        ("lie_options", "lie_id"), ("deflect_options", "deflect_id"),
        ("active_reactions", "reaction_id"),
    ):
        value = authored.get(key, knowledge.get(key))
        entry[key] = _dict_list([*entry[key], *_dict_list(value)], id_keys=(id_key,))
    entry["leverage"] = _string_list([
        *entry["leverage"],
        *_string_list(authored.get("leverage_ids", authored.get("leverage"))),
    ])
    authored_availability = authored.get("availability")
    if isinstance(authored_availability, str):
        authored_availability = {"status": authored_availability}
    if isinstance(authored_availability, dict):
        status = str(authored_availability.get("status") or "available")
        entry["availability"] = {"status": status if status in {"available", "unavailable"} else "unavailable"}
    schedule = _dict_list(authored.get("schedule"), id_keys=("schedule_id",))
    entry["schedule"] = schedule or entry["schedule"]
    if entry["schedule"]:
        # An authored schedule is an allow-list. Being generally available
        # does not make the NPC appear outside every scheduled slot.
        entry["availability"] = {"status": "unavailable"}
    for slot in entry["schedule"]:
        scene_ids = _string_list(slot.get("scene_ids"))
        categories = _string_list(slot.get("time_categories"))
        if scene_ids and str(scene_id or "") not in scene_ids:
            continue
        if categories and str(time_category or "") not in categories:
            continue
        status = str(slot.get("status") or "unavailable")
        entry["availability"] = {"status": status if status in {"available", "unavailable"} else "unavailable"}
        break
    return entry


def enrich_plan_after_rules(
    plan: dict[str, Any],
    ctx: dict[str, Any],
    rule_results: list[dict[str, Any]] | None,
) -> dict[str, Any]:
    """Add live A20 effects and A21 decisions after rule settlement.

    Interactions are semantic-router output, not inferred from player prose.
    Targeting must name exactly one NPC in the active scene; otherwise the
    interaction is recorded as fail-closed and has no psychological effect.
    """
    rich = ctx.get("player_intent_rich") if isinstance(ctx.get("player_intent_rich"), dict) else {}
    interactions = [i for i in (rich.get("npc_interactions") or []) if isinstance(i, dict)]
    enriched = json.loads(json.dumps(plan))
    if not interactions:
        return enriched
    scene_ids = _string_list((ctx.get("active_scene") or {}).get("npc_ids"))
    agendas = {
        str(a.get("npc_id")): a for a in ((ctx.get("npc_agendas") or {}).get("npcs") or [])
        if isinstance(a, dict) and a.get("npc_id")
    }
    valid: list[dict[str, Any]] = []
    decisions: list[dict[str, Any]] = []
    warnings = list(enriched.get("validation_warnings") or [])
    psych = ((ctx.get("npc_state") or {}).get("psych") or {})
    for interaction in interactions:
        npc_id = str(interaction.get("npc_id") or "").strip()
        if not npc_id and len(scene_ids) == 1:
            npc_id = scene_ids[0]
        if not npc_id or npc_id not in scene_ids or npc_id not in agendas:
            warnings.append({
                "field": "player_intent_rich.npc_interactions",
                "reason_code": "npc_target_missing_or_ambiguous",
            })
            continue
        normalized = dict(interaction)
        normalized["npc_id"] = npc_id
        valid.append(normalized)
        fact_id = str(normalized.get("fact_id") or "").strip()
        if not fact_id:
            continue
        agenda = agendas[npc_id]
        specs = _authored_fact_specs(agenda)
        spec = next((s for s in specs if str(s.get("fact_id") or "") == fact_id), None)
        if spec is None:
            order = _string_list(
                agenda.get("disclosure_order")
                or ((agenda.get("knowledge") or {}).get("disclosure_order") if isinstance(agenda.get("knowledge"), dict) else [])
            )
            spec = next((s for fid in order for s in specs if s.get("fact_id") == fid), None)
        if spec is None:
            decisions.append({
                "outcome": "withhold", "reason_code": "fact_not_authored",
                "npc_id": npc_id, "fact_id": fact_id, "clue_id": None,
            })
            continue
        entry = effective_npc_entry(
            agenda, psych.get(npc_id) if isinstance(psych, dict) else None,
            scene_id=ctx.get("active_scene_id"),
            time_category=(ctx.get("time_signals") or {}).get("time_category"),
        )
        # Willingness observes this turn's settled tactic result before clue
        # backfill, while durable mutation remains apply_plan's responsibility.
        for preview in derive_interaction_effects([normalized], rule_results or []):
            if preview.get("kind") == "adjust" and preview.get("field") in NUMERIC_FIELDS:
                field = str(preview["field"])
                entry[field] = max(
                    FIELD_MIN,
                    min(FIELD_MAX, int(entry.get(field, 0)) + int(preview.get("delta", 0))),
                )
            elif preview.get("kind") == "record_leverage" and preview.get("leverage_id"):
                entry["leverage"] = _string_list([
                    *entry["leverage"], str(preview["leverage_id"]),
                ])
        decision = disclosure_decision(
            entry, str(spec.get("fact_id")), clue_id=spec.get("clue_id"),
            min_trust=int(spec.get("min_trust", 0) or 0),
            required_leverage_ids=_string_list(spec.get("required_leverage_ids")),
            lie_option=spec.get("lie_option") if isinstance(spec.get("lie_option"), dict) else None,
            deflect_option=spec.get("deflect_option") if isinstance(spec.get("deflect_option"), dict) else None,
        )
        decision["npc_id"] = npc_id
        clue = next((
            clue
            for conclusion in ((ctx.get("clue_graph") or {}).get("conclusions") or [])
            if isinstance(conclusion, dict)
            for clue in (conclusion.get("clues") or [])
            if isinstance(clue, dict) and clue.get("clue_id") == decision.get("clue_id")
        ), None)
        sources = _string_list((clue or {}).get("source_npc_ids"))
        if decision.get("outcome") == "reveal" and (not sources or npc_id not in sources):
            decision = {
                "outcome": "withhold", "reason_code": "clue_source_npc_mismatch",
                "fact_id": decision.get("fact_id"), "clue_id": decision.get("clue_id"),
                "npc_id": npc_id,
            }
        option = (
            spec.get("lie_option") if decision.get("outcome") == "lie"
            else spec.get("deflect_option")
        )
        if isinstance(option, dict) and isinstance(option.get("player_safe_line"), str):
            decision["player_safe_line"] = option["player_safe_line"].strip()
        decisions.append(decision)
    enriched["validation_warnings"] = warnings
    effects = derive_interaction_effects(valid, rule_results or [])
    enriched["npc_effects"] = [*(enriched.get("npc_effects") or []), *effects]
    enriched["npc_interactions"] = valid
    enriched["disclosure_decisions"] = decisions
    return enriched


def adjust(campaign_dir: Path, npc_id: str, field: str, delta: int) -> int:
    """Adjust a numeric field (clamped to -5..+5) and persist. Returns new value."""
    if field not in NUMERIC_FIELDS:
        raise ValueError(
            f"unknown npc psych field {field!r}; expected one of {NUMERIC_FIELDS}"
        )
    state = load_npc_state(campaign_dir)
    entry = _psych_entry(state, npc_id)
    value = int(entry.get(field, 0) or 0) + int(delta)
    value = max(FIELD_MIN, min(FIELD_MAX, value))
    entry[field] = value
    save_npc_state(campaign_dir, state)
    return value


def record_fact(campaign_dir: Path, npc_id: str, fact_id: str) -> None:
    """Record a fact this NPC now knows (deduplicated by fact_id)."""
    fact = str(fact_id)
    state = load_npc_state(campaign_dir)
    entry = _psych_entry(state, npc_id)
    if fact not in entry["known_facts"]:
        entry["known_facts"].append(fact)
        save_npc_state(campaign_dir, state)


def record_lie(campaign_dir: Path, npc_id: str, lie_id: str, about: str | None = None) -> None:
    """Record a lie this NPC told (deduplicated by lie_id)."""
    state = load_npc_state(campaign_dir)
    entry = _psych_entry(state, npc_id)
    if any(l.get("lie_id") == str(lie_id) for l in entry["lies_told"]):
        return
    entry["lies_told"].append({"lie_id": str(lie_id), "about": about})
    save_npc_state(campaign_dir, state)


def record_promise(
    campaign_dir: Path, npc_id: str, promise_id: str, kept: bool | None = None
) -> None:
    """Record a promise (kept=None while open); re-recording updates kept."""
    state = load_npc_state(campaign_dir)
    entry = _psych_entry(state, npc_id)
    for promise in entry["promises"]:
        if promise.get("promise_id") == str(promise_id):
            promise["kept"] = kept
            save_npc_state(campaign_dir, state)
            return
    entry["promises"].append({"promise_id": str(promise_id), "kept": kept})
    save_npc_state(campaign_dir, state)


def record_leverage(campaign_dir: Path, npc_id: str, leverage_id: str) -> None:
    """Persist a structured leverage token (never its prose description)."""
    state = load_npc_state(campaign_dir)
    entry = _psych_entry(state, npc_id)
    value = str(leverage_id or "").strip()
    if value and value not in entry["leverage"]:
        entry["leverage"].append(value)
        save_npc_state(campaign_dir, state)


def record_deflection(
    campaign_dir: Path, npc_id: str, deflect_id: str, about: str | None = None
) -> None:
    state = load_npc_state(campaign_dir)
    entry = _psych_entry(state, npc_id)
    value = str(deflect_id or "").strip()
    if value and not any(row.get("deflect_id") == value for row in entry["deflections"]):
        entry["deflections"].append({"deflect_id": value, "about": about})
        save_npc_state(campaign_dir, state)


def set_active_reaction(
    campaign_dir: Path, npc_id: str, reaction: dict[str, Any]
) -> None:
    reaction_id = str(reaction.get("reaction_id") or "").strip()
    if not reaction_id:
        raise ValueError("active reaction requires reaction_id")
    state = load_npc_state(campaign_dir)
    entry = _psych_entry(state, npc_id)
    entry["active_reactions"] = [
        row for row in entry["active_reactions"] if row.get("reaction_id") != reaction_id
    ]
    entry["active_reactions"].append(dict(reaction))
    save_npc_state(campaign_dir, state)


def clear_active_reaction(campaign_dir: Path, npc_id: str, reaction_id: str) -> None:
    state = load_npc_state(campaign_dir)
    entry = _psych_entry(state, npc_id)
    entry["active_reactions"] = [
        row for row in entry["active_reactions"]
        if row.get("reaction_id") != str(reaction_id)
    ]
    save_npc_state(campaign_dir, state)


def set_availability(campaign_dir: Path, npc_id: str, status: str) -> None:
    if status not in {"available", "unavailable"}:
        raise ValueError("availability status must be available or unavailable")
    state = load_npc_state(campaign_dir)
    entry = _psych_entry(state, npc_id)
    entry["availability"] = {"status": status}
    save_npc_state(campaign_dir, state)


def npc_disposition(npc_state_entry: dict[str, Any] | None) -> dict[str, Any]:
    """Derive stance + drivers from numeric thresholds. Pure; no prose.

    Returns {stance: "hostile|wary|neutral|warm", drivers: [{driver, field, value}]}.
    Precedence: hostile > wary > warm > neutral (accumulated suspicion/fear
    is never masked by high trust).
    """
    entry = npc_state_entry if isinstance(npc_state_entry, dict) else {}
    trust = int(entry.get("trust", 0) or 0)
    fear = int(entry.get("fear", 0) or 0)
    suspicion = int(entry.get("suspicion", 0) or 0)

    hostile: list[dict[str, Any]] = []
    wary: list[dict[str, Any]] = []
    warm: list[dict[str, Any]] = []

    if trust <= HOSTILE_TRUST_MAX:
        hostile.append({"driver": "low_trust", "field": "trust", "value": trust})
    if suspicion >= HOSTILE_SUSPICION_MIN:
        hostile.append({"driver": "high_suspicion", "field": "suspicion", "value": suspicion})
    if fear >= HOSTILE_FEAR_MIN:
        hostile.append({"driver": "high_fear", "field": "fear", "value": fear})
    if hostile:
        return {"stance": "hostile", "drivers": hostile}

    if fear >= WARY_FEAR_MIN:
        wary.append({"driver": "moderate_fear", "field": "fear", "value": fear})
    if suspicion >= WARY_SUSPICION_MIN:
        wary.append({"driver": "mild_suspicion", "field": "suspicion", "value": suspicion})
    if trust <= WARY_TRUST_MAX:
        wary.append({"driver": "eroded_trust", "field": "trust", "value": trust})
    if wary:
        return {"stance": "wary", "drivers": wary}

    if trust >= WARM_TRUST_MIN:
        warm.append({"driver": "high_trust", "field": "trust", "value": trust})
    if warm:
        return {"stance": "warm", "drivers": warm}

    return {"stance": "neutral", "drivers": []}


def has_signal(npc_state_entry: dict[str, Any] | None) -> bool:
    """True when the entry carries any accumulated psychology (nonzero numeric
    field or any memory record) — i.e. the persisted stance should drive tone."""
    entry = npc_state_entry if isinstance(npc_state_entry, dict) else {}
    if any(int(entry.get(f, 0) or 0) != 0 for f in NUMERIC_FIELDS):
        return True
    return bool(entry.get("known_facts") or entry.get("lies_told") or entry.get("promises"))
