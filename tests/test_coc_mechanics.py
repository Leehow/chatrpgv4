#!/usr/bin/env python3
"""Source-first NPC/item mechanics contracts."""
from __future__ import annotations

import importlib.util
import re
from pathlib import Path

import pytest


SCRIPTS = Path("plugins/coc-keeper/scripts")


def _load(name: str, rel: Path):
    spec = importlib.util.spec_from_file_location(name, rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


mechanics = _load("coc_mechanics_test", SCRIPTS / "coc_mechanics.py")

FAKE_SHA = "a" * 64


def _full_actor_fields(
    *,
    extracted: set[str] | None = None,
) -> tuple[list[str], list[str], list[str]]:
    closed = sorted(mechanics.ACTOR_FIELD_IDS)
    extracted_ids = extracted or {
        "characteristics.STR",
        "characteristics.CON",
        "characteristics.SIZ",
        "characteristics.DEX",
        "characteristics.POW",
        "derived.HP",
        "derived.MP",
        "derived.SAN",
        "derived.MOV",
        "derived.Build",
        "skills",
        "weapons",
    }
    # Revised accounting: observed == extracted; not_authored is the complement.
    observed = sorted(extracted_ids)
    not_authored = [field for field in closed if field not in extracted_ids]
    return observed, sorted(extracted_ids), not_authored


def _locator_scope(indices: list[int] | None = None, sha: str = FAKE_SHA) -> dict:
    return {
        "scope_kind": "explicit_pdf_indices",
        "pdf_indices": list(indices or [373]),
        "scope_label": "appendix_roster",
        "source_file_sha256": sha,
    }


def _not_authored_record(
    *,
    indices: list[int] | None = None,
    checked_scope: object | None = None,
    digest: str = FAKE_SHA,
    extra: dict | None = None,
) -> dict:
    scope = _locator_scope(indices)
    receipt_scope = (
        checked_scope
        if checked_scope is not None
        else {
            "scope_kind": "explicit_pdf_indices",
            "pdf_indices": list(scope["pdf_indices"]),
            "source_file_sha256": digest,
        }
    )
    record = {
        "status": "not_authored",
        "locator_pass_status": "complete",
        "locator_scope": scope,
        "absence_receipt": {
            "review_state": "manual_accepted",
            "checked_scope": receipt_scope,
            "source_file_sha256": digest,
        },
    }
    if extra:
        record.update(extra)
    return record


def _actor_record() -> dict:
    observed, extracted, not_authored = _full_actor_fields()
    return {
        "status": "authored",
        "source_refs": [{"source_id": "pdf:test", "pdf_index": 33}],
        "fields_observed": observed,
        "fields_extracted": extracted,
        "fields_not_authored": not_authored,
        "provenance": {
            "authority": "source_authored",
            "basis": "host_pack",
        },
        "profile": {
            "profile_kind": "actor",
            "characteristic_scale": "percentile",
            "characteristics": {
                "STR": 60, "CON": 50, "SIZ": 65, "DEX": 55, "POW": 45,
            },
            "skills": {"Fighting (Brawl)": 50, "Dodge": 27},
            "derived": {"HP": 11, "MP": 9, "SAN": 45, "MOV": 8, "Build": 1},
            "weapons": [{"weapon_id": "unarmed", "extends": "unarmed"}],
        },
    }


def test_authored_actor_profile_is_source_bound_and_combat_ready():
    record = _actor_record()
    mechanics.validate_mechanics_record(record, subject_kind="npc")

    actor = mechanics.actor_combat_participant("robert", record["profile"])

    assert actor["actor_id"] == "robert"
    assert actor["combat_skill"] == 50
    assert actor["dodge_skill"] == 27
    assert actor["hp_current"] == 11


def test_authored_mechanics_without_exact_page_ref_fails_closed():
    record = _actor_record()
    record["source_refs"] = []

    with pytest.raises(mechanics.MechanicsError, match="requires source_refs"):
        mechanics.validate_mechanics_record(record, subject_kind="npc")


def test_source_fallback_requires_reviewed_absence_receipt():
    subject = {
        "origin": "source",
        "mechanics": {"status": "not_authored"},
    }
    assert mechanics.fallback_allowed(subject) is True
    with pytest.raises(mechanics.MechanicsError, match="locator_pass_status=complete"):
        mechanics.validate_mechanics_record(
            subject["mechanics"], subject_kind="npc",
        )

    mechanics.validate_mechanics_record(
        _not_authored_record(), subject_kind="npc",
    )


def test_weak_not_authored_receipt_is_rejected():
    with pytest.raises(mechanics.MechanicsError, match="review_state|locator_pass"):
        mechanics.validate_mechanics_record(
            {
                "status": "not_authored",
                "absence_receipt": {
                    "reason": "named_in_opening_no_stat_block",
                    "source_page_indices": [361],
                },
            },
            subject_kind="npc",
        )


def test_not_authored_rejects_flat_payload_and_non_hex_digest():
    with pytest.raises(mechanics.MechanicsError, match="rejects payload keys"):
        mechanics.validate_mechanics_record(
            _not_authored_record(extra={
                "characteristics": {"STR": 50},
                "weapons": [{"name": "knife"}],
                "spells": ["Bind"],
            }),
            subject_kind="npc",
        )

    with pytest.raises(mechanics.MechanicsError, match="64-char hex"):
        mechanics.validate_mechanics_record(
            _not_authored_record(digest="not-a-hash"),
            subject_kind="npc",
        )


def test_not_authored_rejects_string_or_list_checked_scope():
    with pytest.raises(mechanics.MechanicsError, match="checked_scope|object"):
        mechanics.validate_mechanics_record(
            _not_authored_record(checked_scope="opening pages only"),
            subject_kind="npc",
        )
    with pytest.raises(mechanics.MechanicsError, match="checked_scope|object"):
        mechanics.validate_mechanics_record(
            _not_authored_record(checked_scope=[361]),
            subject_kind="npc",
        )


def test_not_authored_without_complete_or_scope_is_rejected():
    with pytest.raises(mechanics.MechanicsError, match="locator_pass_status=complete"):
        mechanics.validate_mechanics_record(
            {
                "status": "not_authored",
                "absence_receipt": {
                    "review_state": "manual_accepted",
                    "checked_scope": _locator_scope([361]),
                    "source_file_sha256": FAKE_SHA,
                },
            },
            subject_kind="npc",
        )


def test_located_with_flat_stats_is_rejected():
    with pytest.raises(mechanics.MechanicsError, match="locator-thin"):
        mechanics.validate_mechanics_record(
            {
                "status": "located",
                "source_page_indices": [373],
                "characteristics": {"STR": 70, "CON": 60, "SIZ": 65, "DEX": 50, "POW": 55},
                "skills": {"Fighting (Brawl)": 55},
                "weapons": [{"name": "knife"}],
                "spells": ["Bind"],
            },
            subject_kind="npc",
        )


def test_unresolved_rejects_embedded_profile():
    with pytest.raises(mechanics.MechanicsError, match="locator-thin|must not carry profile"):
        mechanics.validate_mechanics_record(
            {
                "status": "unresolved",
                "profile": {
                    "profile_kind": "actor",
                    "characteristic_scale": "percentile",
                    "characteristics": {
                        "STR": 50, "CON": 50, "SIZ": 50, "DEX": 50, "POW": 50,
                    },
                },
            },
            subject_kind="npc",
        )


def test_fields_accounting_requires_closed_partition():
    record = _actor_record()
    record["fields_not_authored"] = [
        field for field in record["fields_not_authored"] if field != "spells"
    ]
    with pytest.raises(
        mechanics.MechanicsError,
        match="closed actor schema|fields_observed",
    ):
        mechanics.validate_mechanics_record(record, subject_kind="npc")

    record = _actor_record()
    record["fields_extracted"] = list(record["fields_extracted"]) + ["spells"]
    record["fields_observed"] = list(record["fields_observed"]) + ["spells"]
    record["fields_not_authored"] = [
        field for field in record["fields_not_authored"] if field != "spells"
    ]
    with pytest.raises(mechanics.MechanicsError, match="missing, hollow, or invalid"):
        mechanics.validate_mechanics_record(record, subject_kind="npc")

    record = _actor_record()
    record["profile"]["spells"] = ["Bind Enemy"]
    # spells still listed as not_authored → reject
    with pytest.raises(mechanics.MechanicsError, match="must be absent"):
        mechanics.validate_mechanics_record(record, subject_kind="npc")


def test_fields_accounting_allows_empty_not_authored_full_extract():
    observed, extracted, not_authored = _full_actor_fields(
        extracted=set(mechanics.ACTOR_FIELD_IDS)
    )
    assert not_authored == []
    record = {
        "status": "authored",
        "source_refs": [{"source_id": "pdf:test", "pdf_index": 373}],
        "fields_observed": observed,
        "fields_extracted": extracted,
        "fields_not_authored": not_authored,
        "provenance": {"authority": "source_authored"},
        "profile": {
            "profile_kind": "actor",
            "characteristic_scale": "percentile",
            "characteristics": {
                "STR": 70, "CON": 65, "SIZ": 70, "DEX": 50,
                "INT": 60, "APP": 45, "POW": 55, "EDU": 50,
            },
            "derived": {
                "HP": 13, "MP": 11, "SAN": 55, "MOV": 7, "Build": 1, "DB": "+1D4",
            },
            "skills": {"Fighting (Brawl)": 60, "Dodge": 25},
            "weapons": [{"weapon_id": "knife_medium", "extends": "knife_medium"}],
            "attacks": [{"name": "knife", "skill": "Fighting (Brawl)", "damage": "1D4+2"}],
            "attacks_per_round": 1,
            "spells": ["Bind"],
            "san_loss_to_see": "1/1D8",
            "armor": 0,
            "armor_rule": "none",
        },
    }
    mechanics.validate_mechanics_record(record, subject_kind="npc")


def test_hollow_extracted_containers_are_rejected():
    record = _actor_record()
    record["fields_observed"] = list(record["fields_observed"]) + ["spells"]
    record["fields_extracted"] = list(record["fields_extracted"]) + ["spells"]
    record["fields_not_authored"] = [
        field for field in record["fields_not_authored"] if field != "spells"
    ]
    record["profile"]["spells"] = []
    with pytest.raises(mechanics.MechanicsError, match="missing, hollow, or invalid"):
        mechanics.validate_mechanics_record(record, subject_kind="npc")

    record = _actor_record()
    # skills already extracted with content in base record; replace with hollow
    record["profile"]["skills"] = {}
    with pytest.raises(mechanics.MechanicsError, match="missing, hollow, or invalid"):
        mechanics.validate_mechanics_record(record, subject_kind="npc")


def test_unknown_field_ids_rejected_in_all_accounting_sets():
    record = _actor_record()
    record["fields_extracted"] = list(record["fields_extracted"]) + ["magic_resistance"]
    record["fields_observed"] = list(record["fields_observed"]) + ["magic_resistance"]
    with pytest.raises(mechanics.MechanicsError, match="unknown field ids"):
        mechanics.validate_mechanics_record(record, subject_kind="npc")


def test_joseph_shaped_profile_preserves_apr_and_authored_fields():
    """Exact values from source-bundle/pages/0016.md; no production branch."""
    observed, extracted, not_authored = _full_actor_fields(
        extracted={
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
        }
    )
    record = {
        "status": "authored",
        "source_refs": [{"source_id": "pdf:test", "pdf_index": 373}],
        "fields_observed": observed,
        "fields_extracted": extracted,
        "fields_not_authored": not_authored,
        "provenance": {"authority": "source_authored"},
        "profile": {
            "profile_kind": "actor",
            "characteristic_scale": "percentile",
            "characteristics": {
                "STR": 70, "CON": 120, "SIZ": 80, "DEX": 55,
                "INT": 65, "APP": 0, "POW": 75, "EDU": 0,
            },
            "derived": {
                "HP": 20, "MP": 15, "SAN": 0, "MOV": 7, "Build": 1, "DB": "+1D4",
            },
            "skills": {
                "Fighting (Brawl)": 50,
                "Dodge": 15,
                "Stealth": 55,
            },
            "weapons": [{
                "weapon_id": "module:servant-knife",
                "skill": "Fighting (Brawl)",
                "damage": "1D6+1+DB",
                "adds_damage_bonus": True,
                "impales": True,
            }],
            "attacks": [
                {"name": "unarmed", "skill": "Fighting (Brawl)", "damage": "1D3+DB"},
                {"name": "knife", "skill": "Fighting (Brawl)", "damage": "1D6+1+DB"},
            ],
            "attacks_per_round": 1,
            "spells": [
                "Dominate",
                "Wither Limb",
                "Create Barrier of Naach-Tith",
            ],
            "san_loss_to_see": "1/1D8",
        },
    }
    mechanics.validate_mechanics_record(record, subject_kind="npc")
    actor = mechanics.actor_combat_participant("subject-a", record["profile"])
    assert actor["magic_points"] == 15
    assert actor["build"] == 1
    assert actor["damage_bonus"] == "+1D4"
    assert actor["attacks_per_round"] == 1
    assert actor["attacks"][1]["damage"] == "1D6+1+DB"
    assert actor["weapons"][0]["damage"] == "1D6+1+DB"
    assert record["profile"]["characteristics"]["CON"] == 120
    assert record["profile"]["derived"]["HP"] == 20
    assert record["profile"]["derived"]["SAN"] == 0
    assert record["profile"]["derived"]["MOV"] == 7
    assert record["profile"]["spells"] == [
        "Dominate", "Wither Limb", "Create Barrier of Naach-Tith",
    ]
    assert record["profile"]["san_loss_to_see"] == "1/1D8"


def test_authored_fields_accounting_accepts_full_source_block():
    observed, extracted, not_authored = _full_actor_fields(
        extracted={
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
            "spells",
            "san_loss_to_see",
        }
    )
    record = {
        "status": "authored",
        "source_refs": [{"source_id": "pdf:test", "pdf_index": 373}],
        "fields_observed": observed,
        "fields_extracted": extracted,
        "fields_not_authored": not_authored,
        "provenance": {"authority": "source_authored"},
        "profile": {
            "profile_kind": "actor",
            "characteristic_scale": "percentile",
            "characteristics": {
                "STR": 70, "CON": 65, "SIZ": 70, "DEX": 50,
                "INT": 60, "APP": 45, "POW": 55, "EDU": 50,
            },
            "derived": {
                "HP": 13, "MP": 11, "SAN": 55, "MOV": 7, "Build": 1, "DB": "+1D4",
            },
            "skills": {"Fighting (Brawl)": 60, "Dodge": 25},
            "weapons": [{"weapon_id": "knife_medium", "extends": "knife_medium"}],
            "spells": ["Bind"],
            "san_loss_to_see": "1/1D8",
        },
    }
    mechanics.validate_mechanics_record(record, subject_kind="npc")


def test_source_authored_vs_improvised_provenance():
    record = _actor_record()
    record["provenance"] = {
        "authority": "campaign_improvised",
        "source_refs": [{"pdf_index": 10}],
    }
    with pytest.raises(mechanics.MechanicsError, match="must be 'source_authored'|must not borrow"):
        mechanics.validate_mechanics_record(record, subject_kind="npc")

    record = _actor_record()
    record["provenance"] = {"authority": "campaign_generated"}
    with pytest.raises(mechanics.MechanicsError, match="must be 'source_authored'"):
        mechanics.validate_mechanics_record(record, subject_kind="npc")

    improvised_subject = {
        "origin": "improvised",
        "provenance": {"authority": "campaign_improvised"},
        "mechanics": {"status": "unresolved"},
    }
    assert mechanics.fallback_allowed(improvised_subject) is True


@pytest.mark.parametrize(
    "authority",
    ["source_authored", "campaign_improvised", "campaign_generated"],
)
def test_fact_provenance_basis_accepts_nonempty_string_for_every_authority(
    authority: str,
):
    fact = {
        "provenance": {"authority": authority, "basis": "host_pack"},
    }
    if authority == "source_authored":
        fact["source_refs"] = [{"source_id": "pdf:test", "pdf_index": 33}]

    mechanics.validate_fact_provenance(fact)
    assert fact["provenance"]["basis"] == "host_pack"


@pytest.mark.parametrize(
    "authority",
    ["source_authored", "campaign_improvised", "campaign_generated"],
)
@pytest.mark.parametrize(
    "invalid_basis",
    [
        pytest.param({}, id="object"),
        pytest.param([], id="list"),
        pytest.param(None, id="null"),
        pytest.param("", id="empty"),
        pytest.param(" \t\n", id="whitespace"),
        pytest.param(7, id="number"),
        pytest.param(True, id="boolean"),
    ],
)
def test_fact_provenance_basis_rejects_every_non_string_or_empty_value(
    authority: str,
    invalid_basis: object,
):
    fact = {
        "provenance": {"authority": authority, "basis": invalid_basis},
    }
    if authority == "source_authored":
        fact["source_refs"] = [{"source_id": "pdf:test", "pdf_index": 33}]

    with pytest.raises(
        mechanics.MechanicsError,
        match=r"provenance\.basis must be a non-empty string",
    ):
        mechanics.validate_fact_provenance(fact)


def test_source_authored_provenance_must_match_record_scope_exactly():
    record = _actor_record()
    record["provenance"]["source_refs"] = [
        {"source_id": "pdf:test", "pdf_index": 34},
    ]

    with pytest.raises(mechanics.MechanicsError, match="bind exactly"):
        mechanics.validate_mechanics_record(record, subject_kind="npc")


@pytest.mark.parametrize(
    ("parallel_field", "parallel_value"),
    [
        ("source_page_indices", [999]),
        ("source_span", {"pdf_index_start": 999, "pdf_index_end": 999}),
        ("page_text_sha256", ["b" * 64]),
        ("source_evidence", {
            "file_sha256": "b" * 64,
            "pdf_indices": [999],
        }),
    ],
)
def test_source_authored_provenance_rejects_parallel_source_fields(
    parallel_field: str,
    parallel_value: object,
):
    record = _actor_record()
    record["provenance"][parallel_field] = parallel_value

    with pytest.raises(mechanics.MechanicsError, match=parallel_field):
        mechanics.validate_mechanics_record(record, subject_kind="npc")


def test_authored_record_rejects_campaign_generated_profile_authority():
    record = _actor_record()
    record["profile"]["authority"] = "campaign_generated"

    with pytest.raises(mechanics.MechanicsError, match="profile.authority"):
        mechanics.validate_mechanics_record(record, subject_kind="npc")


@pytest.mark.parametrize(
    ("profile_path", "mutate"),
    [
        (
            "profile.source_evidence",
            lambda profile: profile.update({
                "source_evidence": {
                    "source_id": "pdf:foreign",
                    "file_sha256": "b" * 64,
                    "pdf_indices": [999],
                },
            }),
        ),
        (
            "profile.weapons[0].source_refs",
            lambda profile: profile["weapons"][0].update({
                "source_refs": [{"source_id": "pdf:foreign", "pdf_index": 999}],
            }),
        ),
        (
            "profile.weapons[0].file_sha256",
            lambda profile: profile["weapons"][0].update({
                "file_sha256": "b" * 64,
            }),
        ),
        (
            "profile.weapons[0].effects[0].pdf_indices",
            lambda profile: profile["weapons"][0].update({
                "effects": [{
                    "effect_id": "foreign-page-scope",
                    "resolution": "keeper_advisory",
                    "applicability": {"scene_tags_any": ["cramped"]},
                    "pdf_indices": [999],
                }],
            }),
        ),
    ],
)
def test_authored_profile_rejects_second_source_boundary_recursively(
    profile_path: str,
    mutate,
):
    record = _actor_record()
    mutate(record["profile"])

    with pytest.raises(mechanics.MechanicsError, match=re.escape(profile_path)):
        mechanics.validate_mechanics_record(record, subject_kind="npc")


def test_campaign_fact_without_pdf_scope_passes_but_borrowed_scope_rejects():
    generated = {"provenance": {"authority": "campaign_generated"}}
    mechanics.validate_fact_provenance(generated)

    generated["source_page_indices"] = [3]
    with pytest.raises(mechanics.MechanicsError, match="must not borrow"):
        mechanics.validate_fact_provenance(generated)

    for parallel_field, parallel_value in (
        ("source_refs", []),
        ("source_evidence", {"file_sha256": "b" * 64}),
        ("page_text_sha256", ["b" * 64]),
    ):
        generated = {
            "provenance": {
                "authority": "campaign_generated",
                parallel_field: parallel_value,
            },
        }
        with pytest.raises(mechanics.MechanicsError, match=parallel_field):
            mechanics.validate_fact_provenance(generated)


def test_located_pages_must_stay_inside_completed_locator_scope():
    with pytest.raises(mechanics.MechanicsError, match="contained in locator_scope"):
        mechanics.validate_mechanics_record(
            {
                "status": "located",
                "locator_pass_status": "complete",
                "locator_scope": _locator_scope([2]),
                "source_page_indices": [3],
            },
            subject_kind="npc",
        )


def test_generated_actor_is_stable_for_campaign_subject_pair():
    first, first_log = mechanics.generate_actor_profile(
        npc_id="roadside-stranger",
        archetype_id="ordinary_adult",
        campaign_id="campaign-a",
        reason="combat",
    )
    second, second_log = mechanics.generate_actor_profile(
        npc_id="roadside-stranger",
        archetype_id="ordinary_adult",
        campaign_id="campaign-a",
        reason="a later check",
    )

    assert first == second
    assert first_log["seed"] == second_log["seed"]
    assert first["authority"] == "campaign_generated"


def test_item_cannot_smuggle_an_actor_profile():
    with pytest.raises(mechanics.MechanicsError, match="cannot use"):
        mechanics.validate_mechanics_record(_actor_record(), subject_kind="item")


def test_pre7_characteristics_must_be_normalized_before_runtime_use():
    record = _actor_record()
    record["profile"]["characteristic_scale"] = "coc_3_18"
    with pytest.raises(mechanics.MechanicsError, match="must be percentile"):
        mechanics.validate_mechanics_record(record, subject_kind="npc")

    record["profile"].update({
        "characteristic_scale": "percentile",
        "source_characteristic_scale": "coc_3_18",
        "source_characteristics": {
            "STR": 14, "CON": 12, "SIZ": 14, "DEX": 11, "POW": 12,
        },
        "normalization_note": "Host converted the authored pre-7e 3-18 values to percentile values.",
    })
    mechanics.validate_mechanics_record(record, subject_kind="npc")


def test_authored_profile_source_characteristics_and_ordinary_nested_weapon_pass():
    record = _actor_record()
    record["profile"].update({
        "source_characteristic_scale": "coc_3_18",
        "source_characteristics": {
            "STR": 12, "CON": 10, "SIZ": 13, "DEX": 11, "POW": 9,
        },
        "normalization_note": "Host normalized the authored pre-7e values.",
    })
    record["profile"]["weapons"][0]["effects"] = [{
        "effect_id": "close-quarters",
        "resolution": "keeper_advisory",
        "applicability": {"scene_tags_any": ["cramped"]},
    }]

    mechanics.validate_mechanics_record(record, subject_kind="npc")


def test_special_weapon_effect_has_typed_applicability_and_multiplier():
    profile = {
        "weapon_id": "module:tomahawk",
        "extends": "knife_medium",
        "effects": [{
            "effect_id": "double-vs-outer-god-servant",
            "resolution": "combat_damage_multiplier",
            "applicability": {"target_tags_any": ["outer_god_servant"]},
            "multiplier": 2,
        }],
    }
    mechanics.validate_weapon_profile(profile)

    profile["effects"][0]["applicability"] = None
    with pytest.raises(mechanics.MechanicsError, match="applicability"):
        mechanics.validate_weapon_profile(profile)


@pytest.mark.parametrize("weapon_id", [
    "unarmed",
    "knife_small",
    "knife_medium",
    "knife_large",
    "30_06_bolt_action_rifle",
    "shotgun_12g",
])
def test_weapon_profile_extends_active_canonical_catalog(weapon_id: str):
    mechanics.validate_weapon_profile({
        "weapon_id": f"module:{weapon_id}",
        "extends": weapon_id,
    })


@pytest.mark.parametrize("weapon_id", ["brawl", "knife", "rifle", "shotgun"])
def test_weapon_profile_rejects_generic_noncanonical_extends(weapon_id: str):
    with pytest.raises(
        mechanics.MechanicsError,
        match="not an active canonical weapon id",
    ):
        mechanics.validate_weapon_profile({
            "weapon_id": f"module:{weapon_id}",
            "extends": weapon_id,
            "skill": "Fighting (Brawl)",
            "damage": "1D6+DB",
            "adds_damage_bonus": True,
            "impales": False,
        })


def test_weapon_profile_without_extends_still_accepts_complete_inline_shape():
    mechanics.validate_weapon_profile({
        "weapon_id": "module:custom-cudgel",
        "skill": "Fighting (Brawl)",
        "damage": "1D6+DB",
        "adds_damage_bonus": True,
        "impales": False,
    })


def test_absence_receipt_must_bind_locator_scope_when_provided():
    scope = _locator_scope([373])
    with pytest.raises(mechanics.MechanicsError, match="bind exactly to locator_scope"):
        mechanics.validate_mechanics_record(
            {
                "status": "not_authored",
                "locator_pass_status": "complete",
                "locator_scope": scope,
                "absence_receipt": {
                    "review_state": "manual_accepted",
                    "checked_scope": {
                        "scope_kind": "explicit_pdf_indices",
                        "pdf_indices": [361],
                        "source_file_sha256": FAKE_SHA,
                    },
                    "source_file_sha256": FAKE_SHA,
                },
            },
            subject_kind="npc",
        )

    mechanics.validate_mechanics_record(
        {
            "status": "not_authored",
            "locator_pass_status": "complete",
            "locator_scope": scope,
            "absence_receipt": {
                "review_state": "manual_accepted",
                "checked_scope": {
                    "scope_kind": "explicit_pdf_indices",
                    "pdf_indices": [373],
                    "source_file_sha256": FAKE_SHA,
                },
                "source_file_sha256": FAKE_SHA,
            },
        },
        subject_kind="npc",
    )


def test_not_authored_expected_scope_mismatch_from_caller_is_rejected():
    entity_scope = _locator_scope([373])
    other_scope = _locator_scope([361])
    with pytest.raises(mechanics.MechanicsError, match="skeleton locator row|bind exactly"):
        mechanics.validate_mechanics_record(
            {
                "status": "not_authored",
                "locator_pass_status": "complete",
                "locator_scope": entity_scope,
                "absence_receipt": {
                    "review_state": "manual_accepted",
                    "checked_scope": {
                        "scope_kind": "explicit_pdf_indices",
                        "pdf_indices": [373],
                        "source_file_sha256": FAKE_SHA,
                    },
                    "source_file_sha256": FAKE_SHA,
                },
            },
            subject_kind="npc",
            expected_locator_scope=other_scope,
        )
