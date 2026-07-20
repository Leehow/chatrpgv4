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

# Textual relationship memory is semantic prompt context.  It is deliberately
# bounded so one NPC cannot grow an unbounded prompt or turn state into a prose
# log.  Numeric psych fields remain the canonical mechanical state.
IMPRESSION_SCHEMA_VERSION = 1
IMPRESSION_MAX_SUMMARY = 800
IMPRESSION_MAX_ITEM = 300
IMPRESSION_MAX_ITEMS = 6
IMPRESSION_MAX_MEMORIES = 12

# Disposition thresholds (structured numeric — see npc_disposition).
HOSTILE_TRUST_MAX = -3      # trust <= -3 -> hostile
HOSTILE_SUSPICION_MIN = 3   # suspicion >= 3 -> hostile
HOSTILE_FEAR_MIN = 4        # fear >= 4 -> cornered-animal hostility
WARM_TRUST_MIN = 3          # trust >= 3 (and no wary/hostile driver) -> warm
WARY_FEAR_MIN = 2           # fear >= 2 -> wary
WARY_SUSPICION_MIN = 1      # suspicion >= 1 -> wary
WARY_TRUST_MAX = -1         # trust <= -1 -> wary

A21_LIST_FIELDS = (
    "known_fact_ids", "revealable_fact_ids", "disclosure_order", "leverage_ids",
)

SOCIAL_CLUE_DELIVERY_KINDS = frozenset({"npc_dialogue", "social"})


def is_social_clue_plan(plan: Any) -> bool:
    """Classify an A21-gated plan from structured fields only.

    Apply and narration must use this same predicate: otherwise a social plan
    with zero disclosure decisions can be denied by apply while its pre-gate
    prose still crosses the narrator boundary.
    """
    if not isinstance(plan, dict):
        return False
    policy = plan.get("clue_policy")
    delivery_kind = policy.get("delivery_kind") if isinstance(policy, dict) else None
    decisions = plan.get("disclosure_decisions")
    return delivery_kind in SOCIAL_CLUE_DELIVERY_KINDS or bool(
        isinstance(decisions, list) and decisions
    )


def _domains_overlap(left: dict[str, Any], right: dict[str, Any], field: str) -> bool:
    left_values = set(_string_list(left.get(field)))
    right_values = set(_string_list(right.get(field)))
    return not left_values or not right_values or bool(left_values & right_values)


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
        # Pair-scoped textual impressions live under investigator id.  Keep
        # this separate from the legacy NPC-global numeric psychology above.
        "impressions": {},
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


def _bounded_text(value: Any, *, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    text = value.strip()
    return text[:limit] if text else ""


def _bounded_text_list(value: Any, *, limit: int, max_items: int) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        text = _bounded_text(item, limit=limit)
        if text and text not in result:
            result.append(text)
        if len(result) >= max_items:
            break
    return result


def _normalize_impression_memory(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None
    memory_id = _bounded_text(value.get("memory_id"), limit=160)
    event = _bounded_text(value.get("event"), limit=IMPRESSION_MAX_ITEM)
    interpretation = _bounded_text(value.get("interpretation"), limit=IMPRESSION_MAX_ITEM)
    reason = _bounded_text(value.get("reason"), limit=IMPRESSION_MAX_ITEM)
    if not memory_id or not event or not interpretation or not reason:
        return None
    result = {
        "memory_id": memory_id,
        "event": event,
        "interpretation": interpretation,
        "reason": reason,
    }
    source_ref = _bounded_text(value.get("source_ref"), limit=200)
    if source_ref:
        result["source_ref"] = source_ref
    return result


def normalize_impression(value: Any) -> dict[str, Any]:
    """Return a bounded pair-scoped impression projection.

    This is a read-time normalizer.  It never invents a summary or derives
    meaning from free text; only caller-authored fields survive.
    """
    raw = value if isinstance(value, dict) else {}
    summary = _bounded_text(raw.get("summary"), limit=IMPRESSION_MAX_SUMMARY)
    expectations = _bounded_text_list(
        raw.get("expectations"), limit=IMPRESSION_MAX_ITEM,
        max_items=IMPRESSION_MAX_ITEMS,
    )
    reservations = _bounded_text_list(
        raw.get("reservations"), limit=IMPRESSION_MAX_ITEM,
        max_items=IMPRESSION_MAX_ITEMS,
    )
    memories: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for item in raw.get("memories") if isinstance(raw.get("memories"), list) else []:
        memory = _normalize_impression_memory(item)
        if memory is None or memory["memory_id"] in seen_ids:
            continue
        seen_ids.add(memory["memory_id"])
        memories.append(memory)
        if len(memories) >= IMPRESSION_MAX_MEMORIES:
            break
    return {
        "schema_version": IMPRESSION_SCHEMA_VERSION,
        "summary": summary,
        "expectations": expectations,
        "reservations": reservations,
        "memories": memories,
        "initialized_from_first_impression": bool(
            raw.get("initialized_from_first_impression") is True
        ),
    }


def _normalize_impressions(value: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, dict[str, Any]] = {}
    for investigator_id, raw in value.items():
        identifier = _bounded_text(investigator_id, limit=160)
        if not identifier:
            continue
        impression = normalize_impression(raw)
        # Avoid materializing empty pair records from malformed legacy input.
        if any((impression["summary"], impression["expectations"],
                impression["reservations"], impression["memories"],
                impression["initialized_from_first_impression"])):
            result[identifier] = impression
    return result


def _validate_impression_update(value: Any) -> dict[str, Any] | None:
    """Strictly validate one semantic, caller-authored impression update."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError("impression_update must be an object")
    allowed = {"summary", "expectations", "reservations", "memory", "reason"}
    unknown = set(value) - allowed
    if unknown:
        raise ValueError(f"impression_update has unknown fields: {sorted(unknown)}")
    reason = value.get("reason")
    if not isinstance(reason, str) or not reason.strip() or len(reason.strip()) > IMPRESSION_MAX_ITEM:
        raise ValueError("impression_update.reason must be a non-empty bounded string")
    result: dict[str, Any] = {"reason": reason.strip()}
    for field in ("summary",):
        if field in value:
            raw = value[field]
            if not isinstance(raw, str) or not raw.strip() or len(raw.strip()) > IMPRESSION_MAX_SUMMARY:
                raise ValueError(f"impression_update.{field} must be a non-empty bounded string")
            result[field] = raw.strip()
    for field in ("expectations", "reservations"):
        if field in value:
            raw = value[field]
            if not isinstance(raw, list) or not raw or len(raw) > IMPRESSION_MAX_ITEMS:
                raise ValueError(f"impression_update.{field} must be a non-empty list")
            if any(
                not isinstance(item, str) or not item.strip() or len(item.strip()) > IMPRESSION_MAX_ITEM
                for item in raw
            ):
                raise ValueError(f"impression_update.{field} contains an invalid item")
            result[field] = _bounded_text_list(
                raw, limit=IMPRESSION_MAX_ITEM, max_items=IMPRESSION_MAX_ITEMS,
            )
    if "memory" in value:
        memory = _normalize_impression_memory(value["memory"])
        if memory is None:
            raise ValueError(
                "impression_update.memory requires memory_id, event, interpretation, reason"
            )
        result["memory"] = memory
    if not any(field in result for field in ("summary", "expectations", "reservations", "memory")):
        raise ValueError("impression_update must include summary, expectations, reservations, or memory")
    return result


def _valid_string_list(value: Any, *, unique: bool = True) -> bool:
    if not isinstance(value, list):
        return False
    strings = [item for item in value if isinstance(item, str) and item.strip()]
    return len(strings) == len(value) and (not unique or len(set(strings)) == len(strings))


def validate_a21_contract(
    npc_agendas: Any, clue_graph: Any,
) -> list[dict[str, str]]:
    """Canonical A21 authoring validator used by compile, runtime and apply.

    Legacy NPCs without A21 fields remain valid. Once an NPC declares any A21
    field, every declared field is checked by exact structured type and all
    fact/clue/NPC references are checked without prose inference.
    """
    findings: list[dict[str, str]] = []

    def fail(path: str, message: str) -> None:
        findings.append({
            "code": "npc_a21_contract_invalid", "severity": "error",
            "path": path, "message": f"A21 {message}",
        })

    if not isinstance(npc_agendas, dict) or not isinstance(npc_agendas.get("npcs", []), list):
        fail("npc_agendas.npcs", "npc_agendas.npcs must be a list")
        return findings
    if not isinstance(clue_graph, dict) or not isinstance(clue_graph.get("conclusions", []), list):
        fail("clue_graph.conclusions", "clue_graph.conclusions must be a list")
        return findings

    clues: dict[str, list[dict[str, Any]]] = {}
    for ci, conclusion in enumerate(clue_graph.get("conclusions") or []):
        if not isinstance(conclusion, dict) or not isinstance(conclusion.get("clues", []), list):
            continue
        for li, clue in enumerate(conclusion.get("clues") or []):
            if not isinstance(clue, dict):
                continue
            clue_id = clue.get("clue_id")
            if isinstance(clue_id, str) and clue_id.strip():
                clues.setdefault(clue_id.strip(), []).append(clue)

    npcs = npc_agendas.get("npcs") or []
    npc_ids = [
        npc.get("npc_id").strip() for npc in npcs
        if isinstance(npc, dict) and isinstance(npc.get("npc_id"), str)
        and npc.get("npc_id").strip()
    ]
    if len(set(npc_ids)) != len(npc_ids):
        fail("npc_agendas.npcs", "npc_id values must be globally unique")
    npc_id_set = set(npc_ids)

    for clue_id, rows in clues.items():
        for clue in rows:
            if clue.get("delivery_kind") not in {"npc_dialogue", "social"}:
                continue
            sources = clue.get("source_npc_ids")
            if not _valid_string_list(sources):
                fail(f"clue_graph.clues[{clue_id}].source_npc_ids",
                     "social clue source_npc_ids must be a unique non-empty string list")
            elif any(source not in npc_id_set for source in sources):
                fail(f"clue_graph.clues[{clue_id}].source_npc_ids",
                     "social clue has unknown source NPC; source_npc_ids must reference authored NPCs")

    a21_markers = {
        *A21_LIST_FIELDS, "facts", "lie_options", "deflect_options",
        "active_reactions", "availability", "schedule", "knowledge",
    }
    for index, npc in enumerate(npcs):
        if not isinstance(npc, dict):
            continue
        path = f"npc_agendas.npcs[{index}]"
        if not (a21_markers & set(npc)):
            continue
        knowledge = npc.get("knowledge", {})
        if "knowledge" in npc and not isinstance(knowledge, dict):
            fail(f"{path}.knowledge", "knowledge must be an object")
            knowledge = {}
        source = {**knowledge, **npc}
        for field in A21_LIST_FIELDS:
            if field in source and not _valid_string_list(source[field]):
                fail(f"{path}.{field}", f"{field} must be a unique non-empty string list")

        facts = source.get("facts", [])
        if not isinstance(facts, list):
            fail(f"{path}.facts", "facts must be a list")
            facts = []
        authored_fact_ids = {
            fact["fact_id"].strip()
            for fact in facts
            if isinstance(fact, dict) and isinstance(fact.get("fact_id"), str)
            and fact["fact_id"].strip()
        }
        fact_ids: list[str] = []
        for fi, fact in enumerate(facts):
            fpath = f"{path}.facts[{fi}]"
            if not isinstance(fact, dict):
                fail(fpath, "fact must be an object")
                continue
            fact_id = fact.get("fact_id")
            clue_id = fact.get("clue_id")
            if not isinstance(fact_id, str) or not fact_id.strip():
                fail(f"{fpath}.fact_id", "fact_id must be a non-empty string")
            else:
                fact_ids.append(fact_id.strip())
            if not isinstance(clue_id, str) or clue_id not in clues or len(clues.get(clue_id, [])) != 1:
                fail(f"{fpath}.clue_id", "clue_id must reference exactly one authored clue")
            min_trust = fact.get("min_trust", 0)
            if isinstance(min_trust, bool) or not isinstance(min_trust, int) or not FIELD_MIN <= min_trust <= FIELD_MAX:
                fail(f"{fpath}.min_trust", "min_trust must be an integer from -5 to 5")
            required = fact.get("required_leverage_ids", [])
            if not _valid_string_list(required):
                fail(f"{fpath}.required_leverage_ids", "required_leverage_ids must be a unique string list")
            for option_field, id_field in (("lie_option", "lie_id"), ("deflect_option", "deflect_id")):
                option = fact.get(option_field)
                if option is not None and not _valid_disclosure_option(option, id_field, authored_fact_ids):
                    fail(f"{fpath}.{option_field}", f"{option_field} has invalid exact types or fact reference")
        if len(fact_ids) != len(set(fact_ids)):
            fail(f"{path}.facts", "fact_id values must be unique per NPC")
        fact_set = set(fact_ids)
        for field in ("known_fact_ids", "revealable_fact_ids", "disclosure_order"):
            values = source.get(field, [])
            if isinstance(values, list) and any(value not in fact_set for value in values):
                fail(f"{path}.{field}", f"{field} must reference authored facts")
        revealable = source.get("revealable_fact_ids", [])
        known = source.get("known_fact_ids", [])
        if isinstance(revealable, list) and isinstance(known, list) and not set(revealable) <= set(known):
            fail(f"{path}.revealable_fact_ids", "revealable facts must also be known")

        for option_field, id_field in (("lie_options", "lie_id"), ("deflect_options", "deflect_id")):
            options = source.get(option_field, [])
            if not isinstance(options, list):
                fail(f"{path}.{option_field}", f"{option_field} must be a list")
                continue
            ids: list[str] = []
            for oi, option in enumerate(options):
                if not _valid_disclosure_option(option, id_field, fact_set):
                    fail(f"{path}.{option_field}[{oi}]", f"{option_field} item has invalid exact types or fact reference")
                elif isinstance(option, dict):
                    ids.append(str(option[id_field]))
            if len(ids) != len(set(ids)):
                fail(f"{path}.{option_field}", f"{id_field} values must be unique")

        reactions = source.get("active_reactions", [])
        if not isinstance(reactions, list):
            fail(f"{path}.active_reactions", "active_reactions must be a list")
        else:
            reaction_ids: list[str] = []
            for ri, reaction in enumerate(reactions):
                if (not isinstance(reaction, dict)
                        or not isinstance(reaction.get("reaction_id"), str)
                        or not reaction["reaction_id"].strip()
                        or not isinstance(reaction.get("blocks_disclosure"), bool)):
                    fail(f"{path}.active_reactions[{ri}]", "reaction requires reaction_id and boolean blocks_disclosure")
                else:
                    reaction_ids.append(reaction["reaction_id"])
            if len(reaction_ids) != len(set(reaction_ids)):
                fail(f"{path}.active_reactions", "reaction_id values must be unique")

        availability = source.get("availability")
        if availability is not None and (
            not isinstance(availability, dict)
            or set(availability) != {"status"}
            or availability.get("status") not in {"available", "unavailable"}
        ):
            fail(f"{path}.availability", "availability must be exactly {status: available|unavailable}")
        schedule = source.get("schedule", [])
        if not isinstance(schedule, list):
            fail(f"{path}.schedule", "schedule must be a list")
        else:
            schedule_ids: list[str] = []
            valid_slots: list[dict[str, Any]] = []
            for si, slot in enumerate(schedule):
                spath = f"{path}.schedule[{si}]"
                if not isinstance(slot, dict) or not isinstance(slot.get("schedule_id"), str) or not slot["schedule_id"].strip():
                    fail(spath, "schedule item requires schedule_id")
                    continue
                allowed = {"schedule_id", "scene_ids", "time_categories", "status"}
                if set(slot) - allowed or slot.get("status") not in {"available", "unavailable"}:
                    fail(spath, "schedule item has unknown fields or invalid status")
                if "scene_ids" in slot and not _valid_string_list(slot["scene_ids"]):
                    fail(f"{spath}.scene_ids", "scene_ids must be a unique string list")
                if "time_categories" in slot and not _valid_string_list(slot["time_categories"]):
                    fail(f"{spath}.time_categories", "time_categories must be a unique string list")
                schedule_ids.append(slot["schedule_id"])
                if (not (set(slot) - allowed)
                        and slot.get("status") in {"available", "unavailable"}
                        and ("scene_ids" not in slot or _valid_string_list(slot["scene_ids"]))
                        and ("time_categories" not in slot or _valid_string_list(slot["time_categories"]))):
                    valid_slots.append(slot)
            if len(schedule_ids) != len(set(schedule_ids)):
                fail(f"{path}.schedule", "schedule_id values must be unique")
            for left_index, left in enumerate(valid_slots):
                for right in valid_slots[left_index + 1:]:
                    if (left["status"] != right["status"]
                            and _domains_overlap(left, right, "scene_ids")
                            and _domains_overlap(left, right, "time_categories")):
                        fail(
                            f"{path}.schedule",
                            "schedule has overlapping condition domains with conflicting statuses",
                        )
    return findings


def _valid_disclosure_option(option: Any, id_field: str, fact_ids: set[str]) -> bool:
    if not isinstance(option, dict):
        return False
    allowed = {id_field, "fact_id", "about", "player_safe_line"}
    if set(option) - allowed:
        return False
    if not isinstance(option.get(id_field), str) or not option[id_field].strip():
        return False
    if "fact_id" in option and option["fact_id"] not in fact_ids:
        return False
    return all(
        field not in option or (isinstance(option[field], str) and option[field].strip())
        for field in ("about", "player_safe_line")
    )


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
    result["impressions"] = _normalize_impressions(raw.get("impressions"))
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


def get_npc_impression(
    campaign_dir: Path, npc_id: str, investigator_id: str,
) -> dict[str, Any]:
    """Read one investigator/NPC textual impression without exposing others."""
    entry = get_npc_entry(campaign_dir, npc_id)
    identifier = _bounded_text(investigator_id, limit=160)
    if not identifier:
        return normalize_impression(None)
    return deepcopy_impression(entry.get("impressions", {}).get(identifier))


def deepcopy_impression(value: Any) -> dict[str, Any]:
    """Return a detached normalized impression (keeps this module stdlib-only)."""
    return json.loads(json.dumps(normalize_impression(value), ensure_ascii=False))


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
    bindings = _interaction_result_bindings(interactions, results)
    if bindings is None:
        return []
    effects: list[dict[str, Any]] = []
    for interaction in interactions or []:
        if not isinstance(interaction, dict):
            continue
        npc_id = interaction.get("npc_id")
        request_id = interaction.get("request_id")
        tactic = interaction.get("tactic")
        if not npc_id or not request_id or not isinstance(tactic, str):
            continue
        result = bindings.get(str(request_id))
        if result is None:
            continue
        success = result.get("success")
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


def _interaction_result_bindings(
    interactions: Any, results: list[dict[str, Any]],
) -> dict[str, dict[str, Any]] | None:
    rows = [row for row in (interactions or []) if isinstance(row, dict)]
    ids = [str(row.get("request_id") or "").strip() for row in rows]
    if not ids or any(not rid for rid in ids) or len(ids) != len(set(ids)):
        return None
    required_ids = {
        str(row.get("request_id") or "").strip()
        for row in rows
        if isinstance(row.get("skill"), str) and row["skill"].strip()
    }
    wanted = set(ids)
    bindings: dict[str, dict[str, Any]] = {}
    used_rows: set[int] = set()
    for rid in ids:
        matches: list[tuple[int, dict[str, Any]]] = []
        for index, result in enumerate(results):
            aliases = {
                str(result.get(key) or "").strip()
                for key in ("request_id", "rule_request_id", "source_request_id", "command_id")
            } - {""}
            bound = aliases & wanted
            if len(bound) > 1:
                return None
            if rid in bound:
                matches.append((index, result))
        if not matches and rid not in required_ids:
            continue
        if len(matches) != 1 or matches[0][0] in used_rows:
            return None
        used_rows.add(matches[0][0])
        bindings[rid] = matches[0][1]
    return bindings


def interaction_result_bindings_valid(interactions: Any, results: Any) -> bool:
    """Public validity predicate for the live post-rule boundary."""
    rows = [result for result in (results or []) if isinstance(result, dict)]
    return _interaction_result_bindings(interactions, rows) is not None


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
    revealable = _string_list(
        authored.get("revealable_fact_ids", knowledge.get("revealable_fact_ids"))
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
    persisted_has_availability = (
        isinstance(persisted, dict) and isinstance(persisted.get("availability"), dict)
        and persisted["availability"].get("status") in {"available", "unavailable"}
    )
    authored_availability = authored.get("availability")
    if isinstance(authored_availability, str):
        authored_availability = {"status": authored_availability}
    if isinstance(authored_availability, dict) and not persisted_has_availability:
        status = str(authored_availability.get("status") or "available")
        entry["availability"] = {"status": status if status in {"available", "unavailable"} else "unavailable"}
    schedule = _dict_list(authored.get("schedule"), id_keys=("schedule_id",))
    entry["schedule"] = schedule or entry["schedule"]
    if entry["schedule"]:
        # An authored schedule is an allow-list. Being generally available
        # does not make the NPC appear outside every scheduled slot.
        entry["availability"] = {"status": "unavailable"}
    matched_statuses: set[str] = set()
    for slot in entry["schedule"]:
        scene_ids = _string_list(slot.get("scene_ids"))
        categories = _string_list(slot.get("time_categories"))
        if scene_ids and str(scene_id or "") not in scene_ids:
            continue
        if categories and str(time_category or "") not in categories:
            continue
        status = str(slot.get("status") or "unavailable")
        matched_statuses.add(status if status in {"available", "unavailable"} else "unavailable")
    if len(matched_statuses) == 1:
        entry["availability"] = {"status": next(iter(matched_statuses))}
    elif len(matched_statuses) > 1:
        # Invalid/unvalidated conflicting schedules fail closed and remain
        # deterministic regardless of authoring order.
        entry["availability"] = {"status": "unavailable"}
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
    route_ids = [
        str(atom.get("route_id"))
        for atom in (rich.get("action_atoms") or [])
        if isinstance(atom, dict) and atom.get("route_id")
    ]
    resolution = (
        rich.get("action_resolution")
        if isinstance(rich.get("action_resolution"), dict)
        else {}
    )
    if resolution.get("no_match") is not True:
        route_ids.extend(
            str(route_id)
            for route_id in (resolution.get("matched_affordance_ids") or [])
            if str(route_id or "").strip()
        )
    route_ids = list(dict.fromkeys(route_ids))
    clue_rows = {
        str(clue.get("clue_id")): clue
        for conclusion in ((ctx.get("clue_graph") or {}).get("conclusions") or [])
        if isinstance(conclusion, dict)
        for clue in (conclusion.get("clues") or [])
        if isinstance(clue, dict) and clue.get("clue_id")
    }
    agenda_rows = {
        str(agenda.get("npc_id")): agenda
        for agenda in ((ctx.get("npc_agendas") or {}).get("npcs") or [])
        if isinstance(agenda, dict) and agenda.get("npc_id")
    }
    authored_routes: dict[str, list[dict[str, Any]]] = {}
    for route in (ctx.get("active_scene") or {}).get("affordances") or []:
        if not isinstance(route, dict):
            continue
        route_id = route.get("id") or route.get("route_id")
        interaction = route.get("npc_interaction")
        if isinstance(route_id, str) and isinstance(interaction, dict):
            authored_routes.setdefault(route_id, []).append(interaction)
            continue
        # Imported modules do not always duplicate an NPC fact binding onto
        # the public route.  An exact one-to-one route clue -> clue source NPC
        # -> authored NPC fact relation is sufficient structured evidence to
        # compile a no-roll request_fact interaction.  Ambiguity fails closed;
        # no prose, names, or agenda text are scanned.
        direct_grants = list(dict.fromkeys(
            str(clue_id).strip()
            for clue_id in [route.get("clue_id"), *(route.get("grants_clue_ids") or [])]
            if str(clue_id or "").strip()
        ))
        if not isinstance(route_id, str) or len(direct_grants) != 1:
            continue
        clue = clue_rows.get(direct_grants[0])
        if not isinstance(clue, dict) or clue.get("delivery_kind") not in SOCIAL_CLUE_DELIVERY_KINDS:
            continue
        source_npc_ids = _string_list(clue.get("source_npc_ids"))
        if len(source_npc_ids) != 1:
            continue
        npc_id = source_npc_ids[0]
        agenda = agenda_rows.get(npc_id)
        if not isinstance(agenda, dict):
            continue
        fact_matches = [
            fact
            for fact in _authored_fact_specs(agenda)
            if str(fact.get("clue_id") or "") == direct_grants[0]
            and str(fact.get("fact_id") or "").strip()
        ]
        if len(fact_matches) != 1:
            continue
        authored_routes.setdefault(route_id, []).append({
            "npc_id": npc_id,
            "fact_id": str(fact_matches[0]["fact_id"]),
            "tactic": "request_fact",
            "binding_source": "route_clue_source_fact",
        })
    for route_id in route_ids:
        matches = authored_routes.get(route_id, [])
        if len(matches) != 1:
            continue
        source = matches[0]
        npc_id = source.get("npc_id")
        fact_id = source.get("fact_id")
        if (
            not isinstance(npc_id, str)
            or not npc_id
            or not isinstance(fact_id, str)
            or not fact_id
        ):
            continue
        if any(
            str(item.get("npc_id") or "") == npc_id
            and str(item.get("fact_id") or "") == fact_id
            for item in interactions
        ):
            continue
        compiled = {
            "npc_id": npc_id,
            "tactic": str(source.get("tactic") or "request_fact"),
            "request_id": f"route:{route_id}",
            "fact_id": fact_id,
        }
        if source.get("binding_source"):
            compiled["binding_source"] = source["binding_source"]
        skill = source.get("skill")
        if isinstance(skill, str) and skill:
            compiled["skill"] = skill
            difficulty = source.get("difficulty")
            compiled["difficulty"] = (
                difficulty
                if difficulty in {"regular", "hard", "extreme"}
                else "regular"
            )
        interactions.append(compiled)
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
    if not interaction_result_bindings_valid(interactions, rule_results or []):
        warnings.append({
            "field": "player_intent_rich.npc_interactions",
            "reason_code": "interaction_request_binding_invalid",
        })
        enriched["validation_warnings"] = warnings
        enriched["npc_effects"] = list(enriched.get("npc_effects") or [])
        enriched["npc_interactions"] = []
        enriched["disclosure_decisions"] = []
        return enriched
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
        agenda = agendas[npc_id]
        specs = _authored_fact_specs(agenda)
        spec = next((s for s in specs if str(s.get("fact_id") or "") == fact_id), None)
        if not fact_id:
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


def apply_psych_update(
    campaign_dir: Path,
    npc_id: str,
    *,
    investigator_id: str | None = None,
    deltas: dict[str, Any] | None = None,
    record_fact_id: Any = None,
    record_lie_id: Any = None,
    record_promise_id: Any = None,
    resolve_promise: dict[str, Any] | None = None,
    availability: Any = None,
    impression_update: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Validate and atomically apply one complete ``state.npc_update``.

    Every request field is normalized before the state document is loaded, so
    an invalid late field cannot leave earlier deltas persisted.  The complete
    update is then written through one atomic file replacement.
    """
    identifier = str(npc_id).strip()
    if not identifier:
        raise ValueError("npc_id must be a non-empty string")

    pair_identifier: str | None = None
    if investigator_id is not None:
        if not isinstance(investigator_id, str) or not investigator_id.strip():
            raise ValueError("investigator_id must be a non-empty string")
        pair_identifier = investigator_id.strip()
    normalized_impression = _validate_impression_update(impression_update)

    normalized_deltas: dict[str, int] = {}
    for field, raw_delta in (deltas or {}).items():
        if field not in NUMERIC_FIELDS:
            raise ValueError(
                f"unknown npc psych field {field!r}; expected one of {NUMERIC_FIELDS}"
            )
        if isinstance(raw_delta, bool) or not isinstance(raw_delta, int):
            raise ValueError(f"{field}_delta must be an integer")
        normalized_deltas[field] = raw_delta

    normalized_records: dict[str, str] = {}
    for label, raw_value in (
        ("record_fact", record_fact_id),
        ("record_lie", record_lie_id),
        ("record_promise", record_promise_id),
    ):
        if raw_value is None:
            continue
        if not isinstance(raw_value, str) or not raw_value.strip():
            raise ValueError(f"{label} must be a non-empty string")
        normalized_records[label] = raw_value.strip()

    normalized_promise_resolution: dict[str, Any] | None = None
    if resolve_promise is not None:
        if not isinstance(resolve_promise, dict):
            raise ValueError("resolve_promise must be an object")
        unknown = set(resolve_promise) - {"promise_id", "kept"}
        if unknown:
            raise ValueError(
                f"resolve_promise has unknown fields: {sorted(unknown)}"
            )
        promise_id = resolve_promise.get("promise_id")
        kept = resolve_promise.get("kept")
        if not isinstance(promise_id, str) or not promise_id.strip():
            raise ValueError(
                "resolve_promise.promise_id must be a non-empty string"
            )
        if not isinstance(kept, bool):
            raise ValueError("resolve_promise.kept must be a boolean")
        normalized_promise_resolution = {
            "promise_id": promise_id.strip(),
            "kept": kept,
        }
        if normalized_records.get("record_promise") == promise_id.strip():
            raise ValueError(
                "record_promise and resolve_promise cannot target the same promise"
            )

    normalized_availability: str | None = None
    if availability is not None:
        if not isinstance(availability, str) or availability not in {
            "available", "unavailable",
        }:
            raise ValueError("availability status must be available or unavailable")
        normalized_availability = availability

    if (
        not normalized_deltas
        and not normalized_records
        and normalized_promise_resolution is None
        and normalized_availability is None
        and normalized_impression is None
    ):
        return {}, get_npc_entry(campaign_dir, identifier)

    if normalized_impression is not None and pair_identifier is None:
        raise ValueError("investigator_id is required for impression_update")

    state = load_npc_state(campaign_dir)
    entry = _psych_entry(state, identifier)
    applied: dict[str, Any] = {}
    for field, delta in normalized_deltas.items():
        value = int(entry.get(field, 0) or 0) + delta
        value = max(FIELD_MIN, min(FIELD_MAX, value))
        entry[field] = value
        applied[field] = value

    fact_id = normalized_records.get("record_fact")
    if fact_id is not None:
        if fact_id not in entry["known_facts"]:
            entry["known_facts"].append(fact_id)
        applied["recorded_fact"] = fact_id

    lie_id = normalized_records.get("record_lie")
    if lie_id is not None:
        if not any(row.get("lie_id") == lie_id for row in entry["lies_told"]):
            entry["lies_told"].append({"lie_id": lie_id, "about": None})
        applied["recorded_lie"] = lie_id

    promise_id = normalized_records.get("record_promise")
    if promise_id is not None:
        existing = next((
            row for row in entry["promises"] if row.get("promise_id") == promise_id
        ), None)
        if existing is None:
            entry["promises"].append({"promise_id": promise_id, "kept": None})
        else:
            existing["kept"] = None
        applied["recorded_promise"] = promise_id

    if normalized_promise_resolution is not None:
        resolved_id = normalized_promise_resolution["promise_id"]
        existing = next((
            row
            for row in entry["promises"]
            if row.get("promise_id") == resolved_id
        ), None)
        if existing is None:
            raise ValueError(
                f"cannot resolve unknown promise {resolved_id!r} for npc {identifier!r}"
            )
        existing["kept"] = normalized_promise_resolution["kept"]
        applied["resolved_promise"] = dict(normalized_promise_resolution)

    if normalized_availability is not None:
        entry["availability"] = {"status": normalized_availability}
        applied["availability"] = normalized_availability

    if normalized_impression is not None and pair_identifier is not None:
        prior_impression = normalize_impression(
            entry["impressions"].get(pair_identifier)
        )
        current = dict(prior_impression)
        if "summary" in normalized_impression:
            current["summary"] = normalized_impression["summary"]
        if "expectations" in normalized_impression:
            current["expectations"] = normalized_impression["expectations"]
        if "reservations" in normalized_impression:
            current["reservations"] = normalized_impression["reservations"]
        memory = normalized_impression.get("memory")
        if isinstance(memory, dict):
            current["memories"] = [
                row for row in current.get("memories", [])
                if row.get("memory_id") != memory["memory_id"]
            ]
            current["memories"].append(memory)
            current["memories"] = current["memories"][-IMPRESSION_MAX_MEMORIES:]
        current["schema_version"] = IMPRESSION_SCHEMA_VERSION
        entry["impressions"][pair_identifier] = normalize_impression(current)
        applied["impression"] = deepcopy_impression(entry["impressions"][pair_identifier])
        applied["impression_update_reason"] = normalized_impression["reason"]

    save_npc_state(campaign_dir, state)
    return applied, normalize_entry(entry)


def initialize_first_impression(
    campaign_dir: Path,
    npc_id: str,
    investigator_id: str,
    *,
    receipt_id: str,
    observable_manner: str,
    causal_explanation: str,
    boundary_preserved: str,
    opportunity_or_friction: str,
    decision_id: str,
) -> dict[str, Any]:
    """Persist the first-contact impression seed exactly once for a pair.

    The four strings come from the Keeper's causal first-impression
    realization; this helper stores them as evidence/context and never tries
    to infer an interpretation from the prose.
    """
    pair_identifier = str(investigator_id).strip()
    if not pair_identifier:
        raise ValueError("investigator_id must be a non-empty string")
    values = {
        "observable_manner": observable_manner,
        "causal_explanation": causal_explanation,
        "boundary_preserved": boundary_preserved,
        "opportunity_or_friction": opportunity_or_friction,
    }
    if any(
        not isinstance(value, str)
        or not value.strip()
        or len(value.strip()) > IMPRESSION_MAX_ITEM
        for value in values.values()
    ):
        raise ValueError("first-impression realization contains invalid text")
    memory_id = f"first-impression:{str(receipt_id).strip()}"
    update = {
        "summary": causal_explanation.strip(),
        "expectations": [opportunity_or_friction.strip()],
        "reservations": [boundary_preserved.strip()],
        "memory": {
            "memory_id": memory_id,
            "event": observable_manner.strip(),
            "interpretation": causal_explanation.strip(),
            "reason": "first_impression_result",
            "source_ref": str(receipt_id).strip(),
        },
        "reason": "initialize_from_first_impression",
    }
    state = load_npc_state(campaign_dir)
    entry = _psych_entry(state, str(npc_id).strip())
    existing = normalize_impression(entry["impressions"].get(pair_identifier))
    if existing.get("initialized_from_first_impression"):
        return deepcopy_impression(existing)
    normalized = _validate_impression_update(update)
    assert normalized is not None
    current = normalize_impression({
        "summary": normalized["summary"],
        "expectations": normalized["expectations"],
        "reservations": normalized["reservations"],
        "memories": [normalized["memory"]],
        "initialized_from_first_impression": True,
    })
    current["initialized_from_first_impression"] = True
    entry["impressions"][pair_identifier] = current
    save_npc_state(campaign_dir, state)
    return deepcopy_impression(current)


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
    return bool(
        entry.get("known_facts")
        or entry.get("lies_told")
        or entry.get("promises")
        or entry.get("impressions")
    )
