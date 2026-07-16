#!/usr/bin/env python3
"""Structured authored-NPC identity contracts shared by event producers.

The helpers in this module compare only stable IDs and authored structured
fields.  They deliberately do not inspect narration, summaries, or other free
text to decide whether an NPC was portrayed correctly.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import unicodedata
from typing import Any


IDENTITY_CONTRACT_SCHEMA_VERSION = 1
IDENTITY_BINDING_SCHEMA_VERSION = 1


def _entity_key(value: Any) -> str:
    normalized = unicodedata.normalize("NFKC", str(value)).casefold()
    return " ".join(
        "".join(
            character if character.isalnum() else " " for character in normalized
        ).split()
    )


def resolve_authored_npc(
    npc_agendas: dict[str, Any] | None,
    npc_id: str,
) -> dict[str, Any] | None:
    """Resolve an authored ID/name/alias, allowing only unambiguous short IDs."""
    query = _entity_key(npc_id)
    if not query:
        return None
    agendas = npc_agendas if isinstance(npc_agendas, dict) else {}
    npcs = [npc for npc in (agendas.get("npcs") or []) if isinstance(npc, dict)]
    exact: list[dict[str, Any]] = []
    short: list[dict[str, Any]] = []
    ignored_tokens = {"npc", "mr", "mrs", "ms", "miss", "dr", "the", "of"}
    for npc in npcs:
        aliases = npc.get("aliases") or []
        if isinstance(aliases, str):
            aliases = [aliases]
        values = [npc.get("npc_id"), npc.get("name"), *aliases]
        keys = {_entity_key(value) for value in values if value not in (None, "")}
        if query in keys:
            exact.append(npc)
            continue
        tokens: set[str] = set()
        for key in keys:
            tokens.update(
                token for token in key.split() if token not in ignored_tokens
            )
        if query in tokens:
            short.append(npc)
    matches = exact or short
    return matches[0] if len(matches) == 1 else None


def identity_contract(
    npc: dict[str, Any],
    active_scene_id: str | None,
) -> dict[str, Any]:
    """Build a versioned digest over the complete structured identity producer."""
    schedule = deepcopy(npc.get("schedule") or [])
    schedule_rows = schedule if isinstance(schedule, list) else [schedule]
    authored_scene_ids: set[str] = set()
    for row in schedule_rows:
        if not isinstance(row, dict):
            continue
        for scene_id in row.get("scene_ids") or []:
            if scene_id not in (None, ""):
                authored_scene_ids.add(str(scene_id))
    identity_source = {
        "npc_id": npc.get("npc_id"),
        "name": npc.get("name"),
        "origin": npc.get("origin"),
        "agenda": npc.get("agenda"),
        "voice": npc.get("voice"),
        "relationship_to_investigators": npc.get(
            "relationship_to_investigators"
        ),
        "social_role": deepcopy(npc.get("social_role")),
        "schedule": schedule,
        "source_refs": deepcopy(npc.get("source_refs") or []),
    }
    encoded = json.dumps(
        identity_source,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    identity_ref = (
        f"npc-identity-v{IDENTITY_CONTRACT_SCHEMA_VERSION}:"
        f"{hashlib.sha256(encoded).hexdigest()[:24]}"
    )
    active = str(active_scene_id) if active_scene_id not in (None, "") else None
    scene_match: bool | None = None
    if authored_scene_ids:
        scene_match = bool(active and active in authored_scene_ids)
    return {
        "schema_version": IDENTITY_CONTRACT_SCHEMA_VERSION,
        "keeper_only": True,
        "npc_id": npc.get("npc_id"),
        "name": npc.get("name"),
        "origin": npc.get("origin"),
        "identity_ref": identity_ref,
        "role": {
            "relationship_to_investigators": npc.get(
                "relationship_to_investigators"
            ),
            "social_role": deepcopy(npc.get("social_role")),
        },
        "agenda": npc.get("agenda"),
        "voice": npc.get("voice"),
        "schedule": schedule,
        "location_provenance": {
            "active_scene_id": active,
            "authored_scene_ids": sorted(authored_scene_ids),
            "active_scene_matches_schedule": scene_match,
        },
        "source_refs": deepcopy(npc.get("source_refs") or []),
    }


def identity_binding(
    contract: dict[str, Any] | None,
    *,
    supplied_identity_ref: str | None = None,
    structured_producer: str | None = None,
) -> dict[str, Any]:
    """Return one versioned, advisory identity-attestation result.

    ``structured_producer`` means the producer selected the authored NPC from
    structured scenario data itself.  An LLM-facing caller instead supplies
    the exact ref it received.  Either path remains non-blocking when missing,
    mismatched, or outside the authored scene schedule.
    """
    expected_ref = (
        str(contract.get("identity_ref")) if isinstance(contract, dict) else None
    )
    supplied_ref = str(supplied_identity_ref or "").strip() or None
    schedule_match = (
        (contract.get("location_provenance") or {}).get(
            "active_scene_matches_schedule"
        )
        if isinstance(contract, dict)
        else None
    )
    reasons: list[str] = []
    if contract is None:
        status = "improvised"
        reasons.append("npc_id_not_in_authored_agendas")
    elif schedule_match is False:
        status = "mismatch"
        reasons.append("active_scene_outside_authored_schedule")
    elif structured_producer:
        status = "authored_bound"
        supplied_ref = expected_ref
    elif supplied_ref is None:
        status = "unverified"
        reasons.append("identity_ref_missing")
    elif supplied_ref != expected_ref:
        status = "mismatch"
        reasons.append("identity_ref_mismatch")
    else:
        status = "authored_bound"
    eligible = status == "authored_bound"
    return {
        "schema_version": IDENTITY_BINDING_SCHEMA_VERSION,
        "status": status,
        "authored_identity_attested": eligible,
        "coverage_eligible": eligible,
        "supplied_identity_ref": supplied_ref,
        "expected_identity_ref": expected_ref,
        "attestation_source": structured_producer or "keeper_supplied_identity_ref",
        "reasons": reasons,
    }
