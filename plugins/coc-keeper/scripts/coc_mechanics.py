#!/usr/bin/env python3
"""Source-first NPC/item mechanics for progressive COC modules.

This module is deliberately small and semantic-free.  A host PDF capability
decides whether an authored stat/item block belongs to a structured subject;
the repository validates that result, derives rule-owned combat values, and
freezes campaign-local fallback profiles only after source authority permits
one.  No player prose or PDF text is scanned here.
"""
from __future__ import annotations

from copy import deepcopy
import importlib.util
import json
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
LEGACY_RULES_DIR = SCRIPT_DIR.parent / "references" / "rules-json"

MECHANICS_STATUSES = frozenset({"unresolved", "located", "authored", "not_authored"})
PROFILE_KINDS = frozenset({"actor", "weapon", "artifact", "tome", "gear"})
ACCEPTED_REVIEW_STATES = frozenset({"manual_accepted", "auto_accepted"})
SOURCE_CHARACTERISTIC_SCALES = frozenset({"percentile", "coc_3_18", "mixed"})
LOCATOR_PASS_STATUSES = frozenset({"pending", "complete"})
PROVENANCE_AUTHORITIES = frozenset({
    "source_authored", "campaign_improvised", "campaign_generated",
})
FACT_PROVENANCE_FIELDS = frozenset({"authority", "source_refs", "basis"})
FACT_RECORD_CANONICAL_SOURCE_FIELDS = frozenset({
    "source_refs",
    "source_page_indices",
    "source_span",
    "page_text_sha256",
    "source_evidence",
})
FACT_RECORD_PARALLEL_SOURCE_FIELDS = frozenset({
    "source_id",
    "file_sha256",
    "source_file_sha256",
    "bundle_sha256",
    "bundle_sha256s",
    "pdf_index",
    "pdf_indices",
    "text_sha256",
    "cached_page_refs",
})
AUTHORED_PROFILE_RESERVED_SOURCE_FIELDS = (
    FACT_RECORD_CANONICAL_SOURCE_FIELDS | FACT_RECORD_PARALLEL_SOURCE_FIELDS
)

# Locator-thin mechanics records may carry only these keys. Anything else is
# authored payload and must not launder through status=located|unresolved.
LOCATOR_THIN_KEYS = frozenset({
    "status",
    "source_page_indices",
    "source_refs",
    "locator_pass_status",
    "locator_scope",
    "provenance",
})

# not_authored is receipt-only: same thin keys plus absence_receipt.
NOT_AUTHORED_KEYS = LOCATOR_THIN_KEYS | frozenset({"absence_receipt"})

# Closed field set for actor mechanics completeness accounting.
ACTOR_FIELD_IDS = frozenset({
    "characteristics.STR",
    "characteristics.CON",
    "characteristics.SIZ",
    "characteristics.DEX",
    "characteristics.INT",
    "characteristics.APP",
    "characteristics.POW",
    "characteristics.EDU",
    "derived.HP",
    "derived.MP",
    "derived.SAN",
    "derived.MOV",
    "derived.Build",
    "derived.DB",
    "skills",
    "weapons",
    "attacks",
    "attacks_per_round",
    "spells",
    "san_loss_to_see",
    "armor",
    "armor_rule",
})

CHARACTERISTIC_FIELD_IDS = frozenset(
    field_id for field_id in ACTOR_FIELD_IDS if field_id.startswith("characteristics.")
)
DERIVED_FIELD_IDS = frozenset(
    field_id for field_id in ACTOR_FIELD_IDS if field_id.startswith("derived.")
)


def _load_sibling(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_rules = _load_sibling("coc_rules_mechanics", "coc_rules.py")
coc_npc_persona = _load_sibling("coc_npc_persona_mechanics", "coc_npc_persona.py")
coc_rulesets = _load_sibling("coc_rulesets_mechanics", "coc_rulesets.py")

PACKAGED_RULES_DIR = coc_rulesets.ruleset_data_dir(coc_rulesets.DEFAULT_RULESET_ID)

# During the single-track ruleset package transition, prefer the packaged
# COC7 tables while retaining compatibility with an installed legacy tree.
if not (LEGACY_RULES_DIR / "damage-bonus-build.json").is_file():
    coc_rules.RULES_DIR = PACKAGED_RULES_DIR


class MechanicsError(ValueError):
    """A mechanics record or profile violates the source/runtime contract."""


def _nonempty(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def canonical_weapon_ids() -> tuple[str, ...]:
    """Return the deterministic active ruleset weapon-extension catalog."""
    table = coc_rules.weapons_table()
    if not isinstance(table, dict) or not table:
        raise MechanicsError("active canonical weapon catalog is unavailable")
    if any(
        not isinstance(weapon_id, str) or not weapon_id.strip()
        for weapon_id in table
    ):
        raise MechanicsError("active canonical weapon catalog contains an invalid id")
    return tuple(sorted(table))


def _int_map(value: Any, *, field: str) -> dict[str, int]:
    if not isinstance(value, dict):
        raise MechanicsError(f"{field} must be an object")
    result: dict[str, int] = {}
    for key, raw in value.items():
        if isinstance(raw, bool) or not isinstance(raw, int):
            raise MechanicsError(f"{field}.{key} must be an integer")
        result[str(key)] = int(raw)
    return result


def _string_field_list(
    value: Any, *, field: str, allow_empty: bool = False,
) -> list[str]:
    if not isinstance(value, list):
        raise MechanicsError(f"{field} must be a list of field ids")
    if not value and not allow_empty:
        raise MechanicsError(f"{field} must be a non-empty list of field ids")
    result: list[str] = []
    seen: set[str] = set()
    for index, item in enumerate(value):
        field_id = _nonempty(item)
        if not field_id:
            raise MechanicsError(f"{field}[{index}] must be a non-empty string")
        if field_id in seen:
            raise MechanicsError(f"{field} contains duplicate {field_id!r}")
        seen.add(field_id)
        result.append(field_id)
    return result


def _is_hex64(value: Any) -> bool:
    text = _nonempty(value)
    if not text or len(text) != 64:
        return False
    return all(ch in "0123456789abcdef" for ch in text.lower())


def validate_locator_scope(scope: Any, *, field: str = "locator_scope") -> dict[str, Any]:
    """Validate an explicit reviewed locator scope (no prose inference)."""
    if not isinstance(scope, dict) or not scope:
        raise MechanicsError(f"{field} must be a non-empty object")
    scope_kind = _nonempty(scope.get("scope_kind"))
    if not scope_kind:
        raise MechanicsError(f"{field}.scope_kind is required")
    pdf_indices = scope.get("pdf_indices")
    if (
        not isinstance(pdf_indices, list)
        or not pdf_indices
        or any(
            isinstance(value, bool) or not isinstance(value, int) or value < 0
            for value in pdf_indices
        )
    ):
        raise MechanicsError(f"{field}.pdf_indices must be a non-empty int list")
    if len(pdf_indices) != len(set(pdf_indices)):
        raise MechanicsError(f"{field}.pdf_indices must not contain duplicates")
    if not _is_hex64(scope.get("source_file_sha256")):
        raise MechanicsError(f"{field}.source_file_sha256 must be a 64-char hex digest")
    return scope


def _scopes_exactly_bound(left: dict[str, Any], right: dict[str, Any]) -> bool:
    return (
        str(left.get("scope_kind") or "").strip()
        == str(right.get("scope_kind") or "").strip()
        and sorted(left.get("pdf_indices") or [])
        == sorted(right.get("pdf_indices") or [])
        and str(left.get("source_file_sha256") or "").lower()
        == str(right.get("source_file_sha256") or "").lower()
    )


def _fact_source_ref_signature(
    rows: Any, *, field: str,
) -> tuple[tuple[str, int, str], ...]:
    """Return one strict fact-source signature without interpreting prose."""
    if not isinstance(rows, list) or not rows:
        raise MechanicsError(f"{field} must be a non-empty list")
    normalized: list[tuple[str, int, str]] = []
    seen_indices: set[int] = set()
    for index, ref in enumerate(rows):
        if not isinstance(ref, dict):
            raise MechanicsError(f"{field}[{index}] must be an object")
        pdf_index = ref.get("pdf_index")
        if (
            isinstance(pdf_index, bool)
            or not isinstance(pdf_index, int)
            or pdf_index < 0
        ):
            raise MechanicsError(
                f"{field}[{index}].pdf_index must be a non-negative integer"
            )
        if pdf_index in seen_indices:
            raise MechanicsError(f"{field} contains duplicate pdf_index {pdf_index}")
        seen_indices.add(pdf_index)
        source_id = str(ref.get("source_id") or "")
        text_sha256 = str(ref.get("text_sha256") or "")
        if text_sha256 and not _is_hex64(text_sha256):
            raise MechanicsError(
                f"{field}[{index}].text_sha256 must be a 64-char hex digest"
            )
        normalized.append((source_id, pdf_index, text_sha256.lower()))
    return tuple(sorted(normalized))


def _validate_closed_fact_provenance_fields(
    provenance: dict[str, Any], *, field: str,
) -> None:
    """Keep fact provenance closed around one optional source selector."""
    unsupported = sorted(set(provenance) - FACT_PROVENANCE_FIELDS)
    if unsupported:
        raise MechanicsError(
            f"{field} rejects unsupported fields: {', '.join(unsupported)}; "
            "source_refs is the only source-bearing provenance field"
        )
    if "basis" in provenance:
        basis = provenance["basis"]
        if not isinstance(basis, str) or not basis.strip():
            raise MechanicsError(f"{field}.basis must be a non-empty string")


def _validate_authored_profile_source_boundary(
    value: Any,
    *,
    field: str = "profile",
) -> None:
    """Reject a second source/evidence container inside authored payload."""
    if isinstance(value, dict):
        for key, child in value.items():
            child_field = f"{field}.{key}"
            if key in AUTHORED_PROFILE_RESERVED_SOURCE_FIELDS:
                raise MechanicsError(
                    f"{child_field} is reserved for the authored mechanics "
                    "record source boundary"
                )
            _validate_authored_profile_source_boundary(child, field=child_field)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _validate_authored_profile_source_boundary(
                child, field=f"{field}[{index}]",
            )


def _reject_parallel_record_source_fields(
    container: dict[str, Any], *, field: str,
) -> None:
    unsupported = sorted(
        set(container).intersection(FACT_RECORD_PARALLEL_SOURCE_FIELDS)
    )
    if unsupported:
        raise MechanicsError(
            f"{field} rejects parallel record source fields: "
            f"{', '.join(unsupported)}"
        )


def validate_fact_provenance(
    container: Any,
    *,
    field: str = "provenance",
    require: bool = True,
    require_authority: str | None = None,
) -> None:
    """Validate structured fact provenance authority + source binding."""
    if not isinstance(container, dict):
        raise MechanicsError(f"{field} container must be an object")
    provenance = container.get("provenance")
    if provenance is None:
        if require:
            raise MechanicsError(f"{field} is required")
        return
    if not isinstance(provenance, dict):
        raise MechanicsError(f"{field} must be an object")
    _validate_closed_fact_provenance_fields(provenance, field=field)
    authority = str(provenance.get("authority") or "")
    if authority not in PROVENANCE_AUTHORITIES:
        raise MechanicsError(
            f"{field}.authority must be one of {sorted(PROVENANCE_AUTHORITIES)}"
        )
    if require_authority is not None and authority != require_authority:
        raise MechanicsError(
            f"{field}.authority must be {require_authority!r}"
        )
    refs = provenance.get("source_refs")
    if refs is None:
        refs = []
    if refs is not None and not isinstance(refs, list):
        raise MechanicsError(f"{field}.source_refs must be a list when present")
    record_refs = container.get("source_refs")
    if authority == "source_authored":
        _reject_parallel_record_source_fields(container, field=field)
        if "source_refs" in provenance and not refs:
            raise MechanicsError(
                f"{field}.source_refs must be omitted or a non-empty exact fact scope"
            )
        effective_refs = refs or record_refs
        if not isinstance(effective_refs, list) or not effective_refs:
            raise MechanicsError(
                f"{field}: source_authored requires non-empty source_refs"
            )
        effective_signature = _fact_source_ref_signature(
            effective_refs, field=f"{field}.source_refs",
        )
        if refs and isinstance(record_refs, list) and record_refs:
            record_signature = _fact_source_ref_signature(
                record_refs, field="source_refs",
            )
            if effective_signature != record_signature:
                raise MechanicsError(
                    f"{field}.source_refs must bind exactly to record source_refs"
                )
    else:
        if "source_refs" in provenance:
            raise MechanicsError(
                f"{field}: {authority} must not borrow PDF source_refs"
            )
        record_source_fields = sorted(
            set(container).intersection(
                FACT_RECORD_CANONICAL_SOURCE_FIELDS
                | FACT_RECORD_PARALLEL_SOURCE_FIELDS
            )
        )
        if record_source_fields:
            raise MechanicsError(
                f"{field}: {authority} must not borrow record-level PDF source "
                f"fields: {', '.join(record_source_fields)}"
            )


def validate_weapon_profile(profile: Any) -> None:
    if not isinstance(profile, dict):
        raise MechanicsError("weapon profile must be an object")
    if not _nonempty(profile.get("weapon_id")):
        raise MechanicsError("weapon profile requires weapon_id")
    parent = _nonempty(profile.get("extends"))
    if parent:
        if parent not in canonical_weapon_ids():
            raise MechanicsError(
                f"weapon profile extends {parent!r} is not an active canonical weapon id"
            )
    else:
        required = ("skill", "damage", "adds_damage_bonus", "impales")
        missing = [key for key in required if key not in profile]
        if missing:
            raise MechanicsError(
                "full weapon profile missing fields: " + ", ".join(missing)
            )
        if not _nonempty(profile.get("skill")) or not _nonempty(profile.get("damage")):
            raise MechanicsError("full weapon profile requires non-empty skill and damage")
        for key in ("adds_damage_bonus", "impales"):
            if not isinstance(profile.get(key), bool):
                raise MechanicsError(f"weapon profile {key} must be boolean")
    effects = profile.get("effects") or []
    if not isinstance(effects, list):
        raise MechanicsError("weapon profile effects must be a list")
    seen_effects: set[str] = set()
    for index, effect in enumerate(effects):
        if not isinstance(effect, dict):
            raise MechanicsError(f"weapon effect[{index}] must be an object")
        effect_id = _nonempty(effect.get("effect_id"))
        if not effect_id or effect_id in seen_effects:
            raise MechanicsError(f"weapon effect[{index}] requires a unique effect_id")
        seen_effects.add(effect_id)
        resolution = str(effect.get("resolution") or "")
        if resolution not in {"combat_damage_multiplier", "keeper_advisory"}:
            raise MechanicsError(f"weapon effect[{index}].resolution is invalid")
        if not isinstance(effect.get("applicability"), dict):
            raise MechanicsError(f"weapon effect[{index}].applicability is required")
        if resolution == "combat_damage_multiplier":
            multiplier = effect.get("multiplier")
            if (
                isinstance(multiplier, bool)
                or not isinstance(multiplier, int)
                or not 2 <= multiplier <= 10
            ):
                raise MechanicsError(
                    f"weapon effect[{index}].multiplier must be an integer 2..10"
                )


def _validate_attacks_per_round(value: Any) -> None:
    if isinstance(value, bool):
        raise MechanicsError("actor.attacks_per_round must be a positive integer or non-empty string")
    if isinstance(value, int):
        if value < 1:
            raise MechanicsError("actor.attacks_per_round must be a positive integer")
        return
    if isinstance(value, str):
        if not value.strip():
            raise MechanicsError("actor.attacks_per_round must be a non-empty string")
        return
    raise MechanicsError(
        "actor.attacks_per_round must be a positive integer or non-empty string"
    )


def validate_actor_profile(profile: Any) -> None:
    if not isinstance(profile, dict):
        raise MechanicsError("actor profile must be an object")
    characteristics = _int_map(
        profile.get("characteristics"), field="actor.characteristics"
    )
    missing = [key for key in ("STR", "CON", "SIZ", "DEX", "POW") if key not in characteristics]
    if missing:
        raise MechanicsError(
            "actor characteristics missing: " + ", ".join(missing)
        )
    if profile.get("characteristic_scale") != "percentile":
        raise MechanicsError(
            "actor.characteristic_scale must be percentile; normalize pre-7e 3-18 source values before runtime use"
        )
    source_scale = profile.get("source_characteristic_scale")
    if source_scale is not None:
        if source_scale not in SOURCE_CHARACTERISTIC_SCALES:
            raise MechanicsError("actor.source_characteristic_scale is invalid")
        if source_scale != "percentile" and (
            not isinstance(profile.get("source_characteristics"), dict)
            or not _nonempty(profile.get("normalization_note"))
        ):
            raise MechanicsError(
                "converted actor profiles require source_characteristics and normalization_note"
            )
    if profile.get("skills") is not None:
        _int_map(profile.get("skills"), field="actor.skills")
    if profile.get("derived") is not None:
        derived = profile.get("derived")
        if not isinstance(derived, dict):
            raise MechanicsError("actor.derived must be an object")
        for key in ("HP", "MP", "SAN", "MOV", "Build"):
            if key in derived and (
                isinstance(derived[key], bool) or not isinstance(derived[key], int)
            ):
                raise MechanicsError(f"actor.derived.{key} must be an integer")
        if "DB" in derived:
            db_value = derived.get("DB")
            if isinstance(db_value, bool) or not isinstance(db_value, (int, str)):
                raise MechanicsError("actor.derived.DB must be a string or integer")
            if isinstance(db_value, str) and not db_value.strip():
                raise MechanicsError("actor.derived.DB must be non-empty")
    weapons = profile.get("weapons")
    if weapons is not None:
        if not isinstance(weapons, list):
            raise MechanicsError("actor.weapons must be a list")
        for weapon in weapons:
            if isinstance(weapon, str):
                if not weapon.strip():
                    raise MechanicsError("actor weapon id must be non-empty")
            else:
                validate_weapon_profile(weapon)
    if profile.get("attacks") is not None and not isinstance(profile.get("attacks"), list):
        raise MechanicsError("actor.attacks must be a list")
    if profile.get("attacks_per_round") is not None:
        _validate_attacks_per_round(profile.get("attacks_per_round"))
    if profile.get("spells") is not None and not isinstance(profile.get("spells"), list):
        raise MechanicsError("actor.spells must be a list")
    if profile.get("san_loss_to_see") is not None and not _nonempty(
        profile.get("san_loss_to_see")
    ):
        raise MechanicsError("actor.san_loss_to_see must be a non-empty string")
    if profile.get("armor") is not None and (
        isinstance(profile.get("armor"), bool)
        or not isinstance(profile.get("armor"), int)
    ):
        raise MechanicsError("actor.armor must be an integer")
    if profile.get("armor_rule") is not None and not _nonempty(profile.get("armor_rule")):
        raise MechanicsError("actor.armor_rule must be a non-empty string")


def _actor_field_present(profile: dict[str, Any], field_id: str) -> bool:
    """True only when a closed field has a non-hollow authored value."""
    if field_id.startswith("characteristics."):
        key = field_id.split(".", 1)[1]
        characteristics = profile.get("characteristics")
        return isinstance(characteristics, dict) and key in characteristics
    if field_id.startswith("derived."):
        key = field_id.split(".", 1)[1]
        derived = profile.get("derived")
        if not isinstance(derived, dict) or key not in derived:
            return False
        value = derived[key]
        if key == "DB":
            if isinstance(value, bool):
                return False
            if isinstance(value, int):
                return True
            return isinstance(value, str) and bool(value.strip())
        return not isinstance(value, bool) and isinstance(value, int)
    if field_id == "skills":
        skills = profile.get("skills")
        return isinstance(skills, dict) and bool(skills)
    if field_id in {"weapons", "attacks", "spells"}:
        values = profile.get(field_id)
        return isinstance(values, list) and bool(values)
    if field_id == "attacks_per_round":
        value = profile.get("attacks_per_round")
        if value is None:
            return False
        try:
            _validate_attacks_per_round(value)
        except MechanicsError:
            return False
        return True
    if field_id == "san_loss_to_see":
        return _nonempty(profile.get("san_loss_to_see")) is not None
    if field_id == "armor":
        value = profile.get("armor")
        return not isinstance(value, bool) and isinstance(value, int)
    if field_id == "armor_rule":
        return _nonempty(profile.get("armor_rule")) is not None
    return False


def _validate_fields_accounting(record: dict[str, Any], profile: dict[str, Any]) -> None:
    """Actor field accounting: observed == extracted; union with not_authored is closed."""
    observed = set(_string_field_list(
        record.get("fields_observed"), field="fields_observed", allow_empty=True,
    ))
    extracted = set(_string_field_list(
        record.get("fields_extracted"), field="fields_extracted", allow_empty=True,
    ))
    not_authored = set(_string_field_list(
        record.get("fields_not_authored"), field="fields_not_authored", allow_empty=True,
    ))
    for label, values in (
        ("fields_observed", observed),
        ("fields_extracted", extracted),
        ("fields_not_authored", not_authored),
    ):
        unknown = values - ACTOR_FIELD_IDS
        if unknown:
            raise MechanicsError(
                f"{label} contains unknown field ids: " + ", ".join(sorted(unknown))
            )
    if observed != extracted:
        raise MechanicsError(
            "fields_observed must equal fields_extracted"
        )
    if observed & not_authored:
        raise MechanicsError(
            "fields_observed and fields_not_authored must be disjoint"
        )
    if observed | not_authored != ACTOR_FIELD_IDS:
        missing = sorted(ACTOR_FIELD_IDS - (observed | not_authored))
        extra = sorted((observed | not_authored) - ACTOR_FIELD_IDS)
        detail = []
        if missing:
            detail.append("missing: " + ", ".join(missing))
        if extra:
            detail.append("unknown: " + ", ".join(extra))
        raise MechanicsError(
            "fields_observed ∪ fields_not_authored must equal the closed actor schema; "
            + "; ".join(detail)
        )
    # Authored actors always have required characteristics, so observed cannot
    # be empty after profile validation. Keep the explicit guard for clarity.
    if not observed:
        raise MechanicsError(
            "authored actor mechanics cannot have empty fields_observed/fields_extracted"
        )
    for field_id in sorted(extracted):
        if not _actor_field_present(profile, field_id):
            raise MechanicsError(
                f"fields_extracted {field_id!r} is missing, hollow, or invalid on profile"
            )
    for field_id in sorted(not_authored):
        if _actor_field_present(profile, field_id):
            raise MechanicsError(
                f"fields_not_authored {field_id!r} must be absent from profile"
            )


def _non_actor_field_present(profile: dict[str, Any], field_id: str) -> bool:
    if field_id not in profile:
        return False
    value = profile[field_id]
    if value is None:
        return False
    if isinstance(value, (list, dict, str)) and not value:
        return False
    return True


def _validate_non_actor_fields_accounting(
    record: dict[str, Any], profile: dict[str, Any],
) -> None:
    observed = set(_string_field_list(
        record.get("fields_observed"), field="fields_observed", allow_empty=True,
    ))
    extracted = set(_string_field_list(
        record.get("fields_extracted"), field="fields_extracted", allow_empty=True,
    ))
    not_authored = set(_string_field_list(
        record.get("fields_not_authored"), field="fields_not_authored", allow_empty=True,
    ))
    if observed != extracted:
        raise MechanicsError(
            "fields_observed must equal fields_extracted"
        )
    if observed & not_authored:
        raise MechanicsError(
            "fields_observed and fields_not_authored must be disjoint"
        )
    for field_id in sorted(extracted):
        if not _non_actor_field_present(profile, field_id):
            raise MechanicsError(
                f"fields_extracted {field_id!r} is missing or hollow on profile"
            )
    for field_id in sorted(not_authored):
        if _non_actor_field_present(profile, field_id):
            raise MechanicsError(
                f"fields_not_authored {field_id!r} must be absent from profile"
            )


def validate_absence_receipt(
    receipt: Any,
    *,
    expected_scope: dict[str, Any] | None = None,
) -> None:
    if not isinstance(receipt, dict):
        raise MechanicsError("not_authored mechanics requires absence_receipt")
    if receipt.get("review_state") not in ACCEPTED_REVIEW_STATES:
        raise MechanicsError(
            "absence_receipt.review_state must be manual_accepted or auto_accepted"
        )
    checked_scope = receipt.get("checked_scope")
    # Fail closed: checked_scope must be a structured locator-scope object.
    checked = validate_locator_scope(
        checked_scope, field="absence_receipt.checked_scope",
    )
    file_hash = receipt.get("source_file_sha256")
    if not _is_hex64(file_hash):
        raise MechanicsError(
            "absence_receipt.source_file_sha256 must be a 64-char hex digest"
        )
    if str(file_hash).lower() != str(checked.get("source_file_sha256") or "").lower():
        raise MechanicsError(
            "absence_receipt.source_file_sha256 must match checked_scope"
        )
    if expected_scope is None:
        raise MechanicsError(
            "not_authored requires a validated locator_scope to bind absence_receipt"
        )
    locator_scope = validate_locator_scope(expected_scope, field="locator_scope")
    if not _scopes_exactly_bound(checked, locator_scope):
        raise MechanicsError(
            "absence_receipt.checked_scope must bind exactly to locator_scope"
        )
    if str(file_hash).lower() != str(
        locator_scope.get("source_file_sha256") or ""
    ).lower():
        raise MechanicsError(
            "absence_receipt.source_file_sha256 must match locator_scope"
        )


def validate_mechanics_record(
    record: Any,
    *,
    subject_kind: str,
    expected_locator_scope: dict[str, Any] | None = None,
) -> None:
    if not isinstance(record, dict):
        raise MechanicsError("mechanics must be an object")
    status = str(record.get("status") or "")
    if status not in MECHANICS_STATUSES:
        raise MechanicsError(
            f"mechanics.status must be one of {sorted(MECHANICS_STATUSES)}"
        )

    locator_pass = record.get("locator_pass_status")
    if locator_pass is not None:
        if locator_pass not in LOCATOR_PASS_STATUSES:
            raise MechanicsError(
                "locator_pass_status must be pending or complete"
            )
        if locator_pass == "pending" and status != "unresolved":
            raise MechanicsError(
                "locator_pass_status=pending may only pair with status=unresolved"
            )
        if locator_pass == "complete" and status not in {
            "located", "not_authored", "authored",
        }:
            raise MechanicsError(
                "locator_pass_status=complete requires located, not_authored, or authored"
            )
        if locator_pass == "complete":
            validate_locator_scope(
                record.get("locator_scope"), field="locator_scope",
            )

    if status in {"unresolved", "located"}:
        unknown = set(record.keys()) - LOCATOR_THIN_KEYS
        if unknown:
            raise MechanicsError(
                f"mechanics.status={status} is locator-thin and rejects payload keys: "
                + ", ".join(sorted(unknown))
            )
        if record.get("profile") is not None:
            raise MechanicsError(f"mechanics.status={status} must not carry profile")
        if status == "located":
            indices = record.get("source_page_indices")
            if (
                not isinstance(indices, list)
                or not indices
                or any(
                    isinstance(value, bool) or not isinstance(value, int) or value < 0
                    for value in indices
                )
            ):
                raise MechanicsError(
                    "mechanics.status=located requires source_page_indices"
                )
            if len(indices) != len(set(indices)):
                raise MechanicsError(
                    "mechanics.status=located source_page_indices must not contain duplicates"
                )
            if locator_pass == "complete":
                scope = validate_locator_scope(
                    record.get("locator_scope"), field="locator_scope",
                )
                if not set(indices).issubset(set(scope.get("pdf_indices") or [])):
                    raise MechanicsError(
                        "mechanics.status=located source_page_indices must be contained "
                        "in locator_scope.pdf_indices"
                    )
        if record.get("provenance") is not None:
            validate_fact_provenance(record, require=True)
        return

    if status == "authored":
        profile = record.get("profile")
        if not isinstance(profile, dict):
            raise MechanicsError("authored mechanics requires profile")
        _validate_authored_profile_source_boundary(profile)
        profile_kind = str(profile.get("profile_kind") or "")
        if profile_kind not in PROFILE_KINDS:
            raise MechanicsError(
                f"profile_kind must be one of {sorted(PROFILE_KINDS)}"
            )
        if subject_kind == "npc" and profile_kind != "actor":
            raise MechanicsError("NPC authored mechanics requires profile_kind=actor")
        if subject_kind == "item" and profile_kind == "actor":
            raise MechanicsError("item authored mechanics cannot use profile_kind=actor")
        source_refs = record.get("source_refs")
        if not isinstance(source_refs, list) or not source_refs:
            raise MechanicsError("authored mechanics requires source_refs")
        for index, ref in enumerate(source_refs):
            if (
                not isinstance(ref, dict)
                or isinstance(ref.get("pdf_index"), bool)
                or not isinstance(ref.get("pdf_index"), int)
            ):
                raise MechanicsError(
                    f"authored mechanics source_refs[{index}].pdf_index is required"
                )
        validate_fact_provenance(
            record, require=True, require_authority="source_authored",
        )
        profile_authority = profile.get("authority")
        if profile_authority is not None and profile_authority != "source_authored":
            raise MechanicsError(
                "authored mechanics profile.authority must be source_authored when present"
            )
        if profile_kind == "actor":
            validate_actor_profile(profile)
            _validate_fields_accounting(record, profile)
        else:
            if profile_kind == "weapon":
                validate_weapon_profile(profile)
            elif not isinstance(profile.get("effects") or [], list):
                raise MechanicsError(f"{profile_kind} profile effects must be a list")
            _validate_non_actor_fields_accounting(record, profile)
        return

    # status == not_authored — receipt-only, fail closed on incomplete absence.
    unknown = set(record.keys()) - NOT_AUTHORED_KEYS
    if unknown:
        raise MechanicsError(
            "mechanics.status=not_authored rejects payload keys: "
            + ", ".join(sorted(unknown))
        )
    if record.get("profile") is not None:
        raise MechanicsError("not_authored mechanics must not carry profile")
    if locator_pass != "complete":
        raise MechanicsError(
            "not_authored requires locator_pass_status=complete"
        )
    entity_scope = validate_locator_scope(
        record.get("locator_scope"), field="locator_scope",
    )
    if expected_locator_scope is None:
        # Pure mechanics validation may bind receipt to the record's own
        # reviewed scope. put_entity always supplies the skeleton row scope.
        expected = entity_scope
    else:
        expected = validate_locator_scope(
            expected_locator_scope, field="expected_locator_scope",
        )
        if not _scopes_exactly_bound(entity_scope, expected):
            raise MechanicsError(
                "not_authored locator_scope must bind exactly to the skeleton locator row"
            )
    validate_absence_receipt(
        record.get("absence_receipt"),
        expected_scope=expected,
    )
    if record.get("provenance") is not None:
        validate_fact_provenance(record, require=True)


def authored_profile(record: Any) -> dict[str, Any] | None:
    if not isinstance(record, dict) or record.get("status") != "authored":
        return None
    profile = record.get("profile")
    return deepcopy(profile) if isinstance(profile, dict) else None


def fallback_allowed(subject: dict[str, Any]) -> bool:
    origin = str(subject.get("origin") or "")
    if origin in {"improvised", "campaign", "campaign_local"}:
        return True
    provenance = subject.get("provenance")
    if isinstance(provenance, dict):
        authority = str(provenance.get("authority") or "")
        if authority in {"campaign_improvised", "campaign_generated"}:
            return True
    mechanics = subject.get("mechanics")
    return isinstance(mechanics, dict) and mechanics.get("status") == "not_authored"


def load_archetypes() -> dict[str, Any]:
    for root in (LEGACY_RULES_DIR, PACKAGED_RULES_DIR):
        path = root / "npc-stat-archetypes.json"
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    raise MechanicsError("npc-stat-archetypes.json is unavailable")


def generate_actor_profile(
    *, npc_id: str, archetype_id: str, campaign_id: str, reason: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    card = {"npc_id": str(npc_id), "lifecycle": "silhouette"}
    upgraded, log = coc_npc_persona.upgrade_npc_stats(
        card,
        load_archetypes(),
        archetype_id=str(archetype_id),
        reason=str(reason),
        seed_parts=[str(campaign_id), str(npc_id), "mechanics-v1"],
    )
    raw = upgraded["stat_profile"]
    characteristics = deepcopy(raw["characteristics"])
    skills = deepcopy(raw["key_skills"])
    damage = coc_rules.damage_bonus_build(
        int(characteristics["STR"]), int(characteristics["SIZ"])
    )
    derived = deepcopy(raw["derived"])
    derived.update({
        "Build": int(damage["build"]),
        "DB": str(damage["damage_bonus"]),
        "MOV": 8,
    })
    profile = {
        "profile_kind": "actor",
        "characteristic_scale": "percentile",
        "characteristics": characteristics,
        "derived": derived,
        "skills": skills,
        "weapons": [{"weapon_id": "unarmed", "extends": "unarmed"}],
        "authority": "campaign_generated",
        "archetype_id": str(archetype_id),
        "generator_version": 1,
        "seed": log["seed"],
    }
    validate_actor_profile(profile)
    return profile, log


def actor_combat_participant(
    actor_id: str,
    profile: dict[str, Any],
    *,
    side: str = "npc",
) -> dict[str, Any]:
    validate_actor_profile(profile)
    characteristics = _int_map(
        profile["characteristics"], field="actor.characteristics"
    )
    skills = _int_map(profile.get("skills") or {}, field="actor.skills")
    derived = deepcopy(profile.get("derived") or {})
    damage = coc_rules.damage_bonus_build(
        characteristics["STR"], characteristics["SIZ"]
    )
    hp = int(derived.get("HP", (characteristics["CON"] + characteristics["SIZ"]) // 10))
    brawl = int(
        skills.get(
            "Fighting (Brawl)",
            skills.get("Brawl", skills.get("Fighting", 25)),
        )
    )
    dodge = int(skills.get("Dodge", max(1, characteristics["DEX"] // 2)))
    firearms = max(
        [int(value) for key, value in skills.items() if key.startswith("Firearms")]
        or [0]
    )
    weapons = deepcopy(profile.get("weapons") or [{"weapon_id": "unarmed"}])
    participant = {
        "actor_id": str(actor_id),
        "side": str(side),
        "dex": characteristics["DEX"],
        "combat_skill": brawl,
        "dodge_skill": dodge,
        "firearms_skill": firearms,
        "has_ready_firearm": bool(profile.get("has_ready_firearm", False)),
        "build": int(derived.get("Build", damage["build"])),
        "damage_bonus": str(derived.get("DB", damage["damage_bonus"])),
        "hp_max": max(1, hp),
        "hp_current": max(1, int(profile.get("hp_current", hp))),
        "con": characteristics["CON"],
        "magic_points": int(derived.get("MP", characteristics["POW"] // 5)),
        "armor": int(profile.get("armor", 0)),
        "armor_rule": profile.get("armor_rule"),
        "weapons": weapons,
        "conditions": list(profile.get("conditions") or []),
    }
    # Preserve authored attacks-per-round as data only; no combat rule here.
    if profile.get("attacks_per_round") is not None:
        participant["attacks_per_round"] = profile["attacks_per_round"]
    if profile.get("attacks") is not None:
        participant["attacks"] = deepcopy(profile.get("attacks"))
    return participant
