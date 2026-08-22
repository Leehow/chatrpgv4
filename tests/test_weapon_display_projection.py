"""Player weapon projection uses structured authority, never display labels."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import runtime.sdk.web_views as web_views
from runtime.sdk.web_views import display_character
from runtime.sdk.weapon_display import (
    enrich_weapon_row,
    load_weapon_presets,
    resolve_weapon_preset,
)


UNKNOWN_LABELS = ("铁锹", "手斧", "crowbar", "蒸汽扳手", "a rusty pipe")
MECHANICS_FIELDS = (
    "damage",
    "skill_label",
    "ammo",
    "range",
    "weapon_class",
    "template_weapon_id",
)


@pytest.mark.parametrize("label", UNKNOWN_LABELS)
def test_true_unknown_labels_never_receive_fabricated_mechanics(label: str) -> None:
    row = enrich_weapon_row({"label": label, "weapon_id": ""})

    assert row["label"] == label
    assert row["params_source"] == "unresolved"
    assert row["mechanics_available"] is False
    for field in MECHANICS_FIELDS:
        assert field not in row


def test_label_only_known_content_is_not_resolved_from_prose() -> None:
    assert resolve_weapon_preset(weapon_id=None, label="卡卡诺步枪") is None

    row = enrich_weapon_row({"label": "卡卡诺步枪", "weapon_id": ""})
    assert row["params_source"] == "unresolved"
    assert row["mechanics_available"] is False
    for field in MECHANICS_FIELDS:
        assert field not in row


def test_exact_ruleset_catalog_id_resolves_authoritative_params() -> None:
    row = enrich_weapon_row({"weapon_id": "revolver_45", "label": ".45 左轮"})

    assert row["weapon_id"] == "revolver_45"
    assert row["label"] == ".45 左轮"
    assert row["damage"]
    assert row["skill_label"]
    assert row["ammo"] is not None
    assert row["params_source"] == "ruleset_catalog"
    assert row["mechanics_available"] is True


def test_exact_module_weapon_id_resolves_authoritative_params() -> None:
    presets = load_weapon_presets(module_id="the-white-war")
    row = enrich_weapon_row(
        {"weapon_id": "mannlicher_carcano_rifle", "label": "卡卡诺步枪"},
        presets=presets,
    )

    assert row["damage"] == "1D12+2"
    assert row["skill_label"] == "Firearms (Rifle)"
    assert row["ammo"] == 6
    assert row["range"] == 150
    assert row["params_source"] == "module_preset"
    assert row["mechanics_available"] is True


def test_exact_module_weapon_id_inherits_its_structured_catalog_base() -> None:
    presets = load_weapon_presets(module_id="the-haunting")
    row = enrich_weapon_row(
        {"weapon_id": "corbitt-ritual-dagger", "label": "科比特的仪式匕首"},
        presets=presets,
    )

    assert row["damage"] == "1D4+2"
    assert row["skill_label"] == "Fighting (Brawl)"
    assert row["params_source"] == "module_preset"
    assert row["mechanics_available"] is True


def test_complete_explicit_row_keeps_its_own_mechanics() -> None:
    row = enrich_weapon_row(
        {
            "weapon_id": "campaign-custom-blade",
            "label": "旧船刀",
            "damage": "1D6+DB",
            "skill_label": "Fighting (Brawl)",
            "range": "melee",
        }
    )

    assert row["damage"] == "1D6+DB"
    assert row["skill_label"] == "Fighting (Brawl)"
    assert row["range"] == "melee"
    assert row["params_source"] == "explicit"
    assert row["mechanics_available"] is True


def test_incomplete_unknown_row_does_not_publish_partial_mechanics() -> None:
    row = enrich_weapon_row(
        {
            "weapon_id": "campaign-custom-object",
            "label": "沉重铁管",
            "damage": "1D6",
        }
    )

    assert row["params_source"] == "unresolved"
    assert row["mechanics_available"] is False
    assert row["damage"] == "1D6"
    for field in set(MECHANICS_FIELDS) - {"damage"}:
        assert field not in row


def test_module_ids_are_source_bound_to_the_active_campaign(tmp_path: Path) -> None:
    investigator = "ada"
    character_path = (
        tmp_path / ".coc" / "investigators" / investigator / "character.json"
    )
    character_path.parent.mkdir(parents=True)
    character_path.write_text(
        json.dumps(
            {
                "name": "Ada",
                "characteristics": {},
                "derived": {},
                "skills": {},
                "weapons": [
                    {
                        "weapon_id": "mannlicher_carcano_rifle",
                        "label": "卡卡诺步枪",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    campaign_path = tmp_path / ".coc" / "campaigns" / "camp" / "campaign.json"
    campaign_path.parent.mkdir(parents=True)
    campaign_path.write_text(
        json.dumps({"active_scenario_id": "the-haunting"}), encoding="utf-8"
    )

    inactive = display_character(
        tmp_path, investigator, "zh-Hans", campaign_id="camp"
    )
    assert inactive is not None
    assert inactive["weapons"][0]["params_source"] == "unresolved"
    assert inactive["weapons"][0]["mechanics_available"] is False

    campaign_path.write_text(
        json.dumps({"active_scenario_id": "the-white-war"}), encoding="utf-8"
    )
    active = display_character(
        tmp_path, investigator, "zh-Hans", campaign_id="camp"
    )
    assert active is not None
    assert active["weapons"][0]["damage"] == "1D12+2"
    assert active["weapons"][0]["params_source"] == "module_preset"


@pytest.mark.parametrize(
    (
        "play_language",
        "expected_skill",
        "expected_section_title",
        "expected_item_title",
        "expected_status",
        "expected_range",
        "expected_ammo",
    ),
    (
        (
            "zh-Hans",
            "射击（手枪）",
            "武器",
            "武器",
            "武器参数未配置",
            "射程",
            "弹药",
        ),
        (
            "en-US",
            "Firearms (Handgun)",
            "Weapons",
            "Weapon",
            "Weapon mechanics unavailable",
            "Range",
            "Ammo",
        ),
        (
            "ja-JP",
            "射撃（拳銃）",
            "武器",
            "武器",
            "武器データ未設定",
            "射程",
            "弾薬",
        ),
    ),
)
def test_exact_catalog_skill_uses_canonical_player_language_projection(
    tmp_path: Path,
    play_language: str,
    expected_skill: str,
    expected_section_title: str,
    expected_item_title: str,
    expected_status: str,
    expected_range: str,
    expected_ammo: str,
) -> None:
    investigator = "ada"
    character_path = (
        tmp_path / ".coc" / "investigators" / investigator / "character.json"
    )
    character_path.parent.mkdir(parents=True)
    character_path.write_text(
        json.dumps(
            {
                "name": "Ada",
                "characteristics": {},
                "derived": {},
                "skills": {},
                "weapons": [{"weapon_id": "revolver_45", "label": ".45"}],
            }
        ),
        encoding="utf-8",
    )

    projected = display_character(tmp_path, investigator, play_language)
    assert projected is not None
    assert projected["weapon_section_label"] == expected_section_title
    resolved = projected["weapons"][0]
    assert resolved["skill_label"] == expected_skill
    assert resolved["range_label"] == expected_range
    assert resolved["ammo_label"] == expected_ammo

    character_path.write_text(
        json.dumps(
            {
                "name": "Ada",
                "characteristics": {},
                "derived": {},
                "skills": {},
                "weapons": [{"weapon_id": "", "label": ""}],
            }
        ),
        encoding="utf-8",
    )
    unresolved = display_character(tmp_path, investigator, play_language)
    assert unresolved is not None
    assert unresolved["weapons"][0]["title_fallback_label"] == expected_item_title
    assert unresolved["weapons"][0]["mechanics_status_label"] == expected_status


def test_weapon_chrome_fails_closed_when_canonical_source_is_unavailable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    investigator = "ada"
    character_path = (
        tmp_path / ".coc" / "investigators" / investigator / "character.json"
    )
    character_path.parent.mkdir(parents=True)
    character_path.write_text(
        json.dumps(
            {
                "name": "Ada",
                "characteristics": {},
                "derived": {},
                "skills": {},
                "weapons": [
                    {"weapon_id": "revolver_45", "label": ".45"},
                    {"weapon_id": "", "label": "crowbar"},
                ],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(web_views, "_table_chrome", lambda *_args: {})

    projected = display_character(tmp_path, investigator, "ja-JP")
    assert projected is not None
    assert "weapon_section_label" not in projected
    resolved, unresolved = projected["weapons"]
    assert "range_label" not in resolved
    assert "ammo_label" not in resolved
    assert "mechanics_status_label" not in unresolved
    assert "title_fallback_label" not in unresolved


@pytest.mark.parametrize(
    ("play_language", "expected_skill"),
    (
        ("zh-Hans", "射击（步枪）"),
        ("en-US", "Firearms (Rifle)"),
        ("ja-JP", "射撃（ライフル）"),
    ),
)
def test_exact_rifle_skill_uses_canonical_player_language_projection(
    tmp_path: Path,
    play_language: str,
    expected_skill: str,
) -> None:
    investigator = "ada"
    character_path = (
        tmp_path / ".coc" / "investigators" / investigator / "character.json"
    )
    character_path.parent.mkdir(parents=True)
    character_path.write_text(
        json.dumps(
            {
                "name": "Ada",
                "characteristics": {},
                "derived": {},
                "skills": {},
                "weapons": [
                    {
                        "weapon_id": "garand_m1_m2_rifle",
                        "label": "Garand M1",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    projected = display_character(tmp_path, investigator, play_language)
    assert projected is not None
    assert projected["weapons"][0]["skill_label"] == expected_skill


def test_imported_active_module_authored_weapon_profile_resolves_by_exact_id(
    tmp_path: Path,
) -> None:
    investigator = "ada"
    character_path = (
        tmp_path / ".coc" / "investigators" / investigator / "character.json"
    )
    character_path.parent.mkdir(parents=True)
    character_path.write_text(
        json.dumps(
            {
                "name": "Ada",
                "characteristics": {},
                "derived": {},
                "skills": {},
                "weapons": [
                    {"weapon_id": "module:ritual-knife", "label": "仪式刀"}
                ],
            }
        ),
        encoding="utf-8",
    )
    campaign_dir = tmp_path / ".coc" / "campaigns" / "camp"
    campaign_dir.mkdir(parents=True)
    (campaign_dir / "campaign.json").write_text(
        json.dumps({"active_scenario_id": "imported-demo"}), encoding="utf-8"
    )
    scenario_dir = campaign_dir / "scenario"
    scenario_dir.mkdir()
    (scenario_dir / "module-meta.json").write_text(
        json.dumps(
            {
                "scenario_id": "imported-demo",
                "module_mechanics": {
                    "schema_version": 1,
                    "items": {
                        "ritual-knife": {
                            "item_id": "ritual-knife",
                            "mechanics": {
                                "status": "authored",
                                "source_refs": [
                                    {"source_id": "pdf:imported-demo", "pdf_index": 2}
                                ],
                                "fields_observed": ["weapon_id", "extends", "name"],
                                "fields_extracted": ["weapon_id", "extends", "name"],
                                "fields_not_authored": [],
                                "provenance": {"authority": "source_authored"},
                                "profile": {
                                    "profile_kind": "weapon",
                                    "weapon_id": "module:ritual-knife",
                                    "extends": "knife_medium",
                                    "name": "Ritual Knife",
                                },
                            },
                        }
                    },
                },
            }
        ),
        encoding="utf-8",
    )

    projected = display_character(
        tmp_path, investigator, "zh-Hans", campaign_id="camp"
    )
    assert projected is not None
    weapon = projected["weapons"][0]
    assert weapon["damage"] == "1D4+2"
    assert weapon["skill_label"] == "斗殴"
    assert weapon["params_source"] == "module_preset"
    assert weapon["mechanics_available"] is True
