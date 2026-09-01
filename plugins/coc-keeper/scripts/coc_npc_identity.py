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


IDENTITY_CONTRACT_SCHEMA_VERSION = 2
SUPPORTED_IDENTITY_CONTRACT_SCHEMA_VERSIONS = frozenset({1, 2})
IDENTITY_BINDING_SCHEMA_VERSION = 1
ENGAGEMENT_EVENT_SCHEMA_VERSION = 2
SUPPORTED_ENGAGEMENT_EVENT_SCHEMA_VERSIONS = frozenset({
    ENGAGEMENT_EVENT_SCHEMA_VERSION,
})
SUPPORTED_ATTESTATION_SOURCES = frozenset({
    "keeper_supplied_identity_ref",
    "director_apply.npc_move",
})


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


def _authored_scene_ids(schedule: Any) -> list[str]:
    schedule_rows = schedule if isinstance(schedule, list) else [schedule]
    authored_scene_ids: set[str] = set()
    for row in schedule_rows:
        if not isinstance(row, dict):
            continue
        for scene_id in row.get("scene_ids") or []:
            if scene_id not in (None, ""):
                authored_scene_ids.add(str(scene_id))
    return sorted(authored_scene_ids)


def _identity_ref(identity_source: dict[str, Any], *, schema_version: int) -> str:
    encoded = json.dumps(
        identity_source,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return (
        f"npc-identity-v{schema_version}:"
        f"{hashlib.sha256(encoded).hexdigest()[:24]}"
    )


def _stable_identity_source(npc: dict[str, Any]) -> dict[str, Any]:
    """Fields that identify an authored entity, not its progressively parsed profile."""
    return {
        "npc_id": npc.get("npc_id"),
        "origin": npc.get("origin"),
    }


def _profile_source(npc: dict[str, Any], schedule: Any) -> dict[str, Any]:
    return {
        "npc_id": npc.get("npc_id"),
        "name": npc.get("name"),
        "origin": npc.get("origin"),
        "agenda": npc.get("agenda"),
        "voice": npc.get("voice"),
        "relationship_to_investigators": npc.get(
            "relationship_to_investigators"
        ),
        "social_role": deepcopy(npc.get("social_role")),
        "schedule": deepcopy(schedule),
        "source_refs": deepcopy(npc.get("source_refs") or []),
    }


def identity_contract(
    npc: dict[str, Any],
    active_scene_id: str | None,
) -> dict[str, Any]:
    """Build a versioned digest over the complete structured identity producer."""
    schedule = deepcopy(npc.get("schedule") or [])
    authored_scene_ids = _authored_scene_ids(schedule)
    identity_ref = _identity_ref(
        _stable_identity_source(npc),
        schema_version=IDENTITY_CONTRACT_SCHEMA_VERSION,
    )
    profile_revision_ref = _identity_ref(
        _profile_source(npc, schedule),
        schema_version=IDENTITY_CONTRACT_SCHEMA_VERSION,
    ).replace("npc-identity-", "npc-profile-")
    active = str(active_scene_id) if active_scene_id not in (None, "") else None
    scene_match: bool | None = None
    if authored_scene_ids:
        scene_match = bool(active and active in set(authored_scene_ids))
    return {
        "schema_version": IDENTITY_CONTRACT_SCHEMA_VERSION,
        "keeper_only": True,
        "npc_id": npc.get("npc_id"),
        "name": npc.get("name"),
        "origin": npc.get("origin"),
        "identity_ref": identity_ref,
        "profile_revision_ref": profile_revision_ref,
        "role": {
            "relationship_to_investigators": npc.get(
                "relationship_to_investigators"
            ),
            "social_role": deepcopy(npc.get("social_role")),
            # Free-prose source titles are display identity, not structured
            # authority.  Preserve them without feeding them into role logic
            # or changing the stable authored identity digest.
            "role_label": npc.get("role_label"),
        },
        "agenda": npc.get("agenda"),
        "voice": npc.get("voice"),
        "schedule": schedule,
        "location_provenance": {
            "active_scene_id": active,
            "authored_scene_ids": authored_scene_ids,
            "active_scene_matches_schedule": scene_match,
        },
        "source_refs": deepcopy(npc.get("source_refs") or []),
    }


# ``npc.query`` returns the authored identity fields on each npc record AND
# again inside that record's ``identity_contract``.  Both copies come from the
# same authored NPC, so the second one is transport duplication: measured on the
# live 9-NPC roster of `pi-coc-gate9-depth-20260901-03`, it is 7,796 of the
# result's 27,998 payload bytes.  These are the contract fields the record
# already carries, keyed by contract path -> npc record field.
RECORD_CARRIED_CONTRACT_FIELDS: dict[str, str] = {
    "npc_id": "npc_id",
    "name": "name",
    "origin": "origin",
    "identity_ref": "identity_ref",
    "profile_revision_ref": "profile_revision_ref",
    "agenda": "agenda",
    "voice": "voice",
    "schedule": "schedule",
    "role.relationship_to_investigators": "relationship_to_investigators",
    "role.social_role": "social_role",
    "role.role_label": "role_label",
}
RECORD_CARRIED_CONTRACT_SCHEMA_VERSION = 1


def record_carried_contract_projection() -> dict[str, Any]:
    """One block-level description of the record-carried contract elision.

    The mapping is structural and identical for every record, so it ships once
    per result rather than once per NPC.  A consumer rebuilds the full contract
    by reading each named record field; a field kept inline differs from the
    record and wins over it.
    """
    # The mapping ships as string lists, not as an object keyed by the field
    # names.  `identity_ref` and `profile_revision_ref` are denied identity
    # field NAMES in the Pi model projection, so an object keyed by them would
    # reach the Keeper with those entries silently deleted -- a table that
    # cannot be read is worse than the duplication it replaced.
    return {
        "schema_version": RECORD_CARRIED_CONTRACT_SCHEMA_VERSION,
        "carried_by_record": [
            path for path in RECORD_CARRIED_CONTRACT_FIELDS if "." not in path
        ],
        "role_carried_by_record": [
            path.split(".", 1)[1]
            for path in RECORD_CARRIED_CONTRACT_FIELDS
            if path.startswith("role.")
        ],
        "resolution": (
            "identity_contract omits a listed field when it is exactly the "
            "same-named field on its own npc record; a field present inline "
            "differs from the record and is authoritative"
        ),
    }


def _contract_path_value(contract: dict[str, Any], path: str) -> tuple[bool, Any]:
    node: Any = contract
    for part in path.split("."):
        if not isinstance(node, dict) or part not in node:
            return False, None
        node = node[part]
    return True, node


def _drop_contract_path(contract: dict[str, Any], path: str) -> None:
    parts = path.split(".")
    node: Any = contract
    for part in parts[:-1]:
        if not isinstance(node, dict):
            return
        node = node.get(part)
    if isinstance(node, dict):
        node.pop(parts[-1], None)


def record_scoped_contract(
    contract: dict[str, Any] | None,
    record: dict[str, Any],
) -> dict[str, Any] | None:
    """Return ``contract`` without the fields ``record`` already carries.

    Elision is guarded by exact equality, so this is lossless by construction:
    anything the record does not reproduce byte-for-byte stays inline.  The
    authored ``schedule`` is the live case that keeps a field — the contract
    normalizes a missing schedule to ``[]`` while the record leaves it ``None``.

    An emptied ``role`` object is removed rather than left as ``{}``: a
    half-populated ``role`` would read as an authored role that lost its
    fields.  A contract reduced this way intentionally fails
    ``validate_authored_attestation`` — receipts must build their own complete
    contract from the authored NPC, never adopt this transport projection.
    """
    if not isinstance(contract, dict):
        return contract
    reduced = deepcopy(contract)
    for path, field in RECORD_CARRIED_CONTRACT_FIELDS.items():
        present, value = _contract_path_value(reduced, path)
        if present and field in record and value == record[field]:
            _drop_contract_path(reduced, path)
    if isinstance(reduced.get("role"), dict) and not reduced["role"]:
        reduced.pop("role")
    return reduced


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


def validate_authored_attestation(
    npc_id: str,
    contract: dict[str, Any] | None,
    binding: dict[str, Any] | None,
    *,
    event_scene_id: str | None = None,
    event_scene_present: bool = False,
    event_schema_version: int | None = None,
) -> bool:
    """Validate one supported producer contract without reading prose meaning."""
    if not isinstance(contract, dict) or not isinstance(binding, dict):
        return False
    if (
        type(event_schema_version) is not int
        or event_schema_version not in SUPPORTED_ENGAGEMENT_EVENT_SCHEMA_VERSIONS
    ):
        return False
    contract_version = contract.get("schema_version")
    if contract_version not in SUPPORTED_IDENTITY_CONTRACT_SCHEMA_VERSIONS:
        return False
    if binding.get("schema_version") != IDENTITY_BINDING_SCHEMA_VERSION:
        return False
    if contract.get("keeper_only") is not True:
        return False
    stable_npc_id = str(contract.get("npc_id") or "")
    if not stable_npc_id or stable_npc_id != str(npc_id):
        return False

    role = contract.get("role")
    if not isinstance(role, dict):
        return False
    schedule = deepcopy(contract.get("schedule") or [])
    contract_as_npc = {
        "npc_id": contract.get("npc_id"),
        "name": contract.get("name"),
        "origin": contract.get("origin"),
        "agenda": contract.get("agenda"),
        "voice": contract.get("voice"),
        "relationship_to_investigators": role.get(
            "relationship_to_investigators"
        ),
        "social_role": deepcopy(role.get("social_role")),
        "schedule": schedule,
        "source_refs": deepcopy(contract.get("source_refs") or []),
    }
    if contract_version == 1:
        expected_ref = _identity_ref(contract_as_npc, schema_version=1)
    else:
        expected_ref = _identity_ref(
            _stable_identity_source(contract_as_npc), schema_version=2,
        )
    if str(contract.get("identity_ref") or "") != expected_ref:
        return False
    if contract_version == 2:
        expected_profile_ref = _identity_ref(
            _profile_source(contract_as_npc, schedule), schema_version=2,
        ).replace("npc-identity-", "npc-profile-")
        if contract.get("profile_revision_ref") != expected_profile_ref:
            return False

    location = contract.get("location_provenance")
    if not isinstance(location, dict):
        return False
    authored_scene_ids = _authored_scene_ids(schedule)
    if location.get("authored_scene_ids") != authored_scene_ids:
        return False
    active_scene_id = location.get("active_scene_id")
    expected_schedule_match: bool | None = None
    if authored_scene_ids:
        expected_schedule_match = bool(
            active_scene_id not in (None, "")
            and str(active_scene_id) in set(authored_scene_ids)
        )
    if location.get("active_scene_matches_schedule") is not expected_schedule_match:
        return False
    contract_scene = location.get("active_scene_id")
    if event_scene_present:
        if (
            not isinstance(event_scene_id, str)
            or not event_scene_id
            or not isinstance(contract_scene, str)
            or not contract_scene
            or event_scene_id != contract_scene
        ):
            return False
    else:
        # Every supported event version promises an exact scene binding.
        return False

    return bool(
        binding.get("status") == "authored_bound"
        and binding.get("authored_identity_attested") is True
        and binding.get("coverage_eligible") is True
        and str(binding.get("expected_identity_ref") or "") == expected_ref
        and str(binding.get("supplied_identity_ref") or "") == expected_ref
        and binding.get("attestation_source") in SUPPORTED_ATTESTATION_SOURCES
        and binding.get("reasons") == []
    )


def engagement_evidence_digest(evidence: dict[str, Any]) -> str:
    """Digest the narrow public identity-evidence object for producer binding."""
    encoded = json.dumps(
        evidence,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"
