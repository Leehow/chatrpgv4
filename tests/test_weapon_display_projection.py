"""pi-coc UI sidecar: resolve preset weapons and class-template fallbacks."""

from __future__ import annotations

from runtime.sdk.weapon_display import (
    enrich_weapon_row,
    resolve_weapon_preset,
    synthesize_weapon_params,
)


def test_preset_name_carcano_resolves_module_stats() -> None:
    hit = resolve_weapon_preset(weapon_id=None, label="卡卡诺步枪")
    assert hit is not None
    assert hit["weapon_id"] == "mannlicher_carcano_rifle"
    assert hit["damage"] == "1D12+2"
    assert hit.get("ammo") == 6
    assert hit.get("range") == 150


def test_catalog_id_revolver_resolves_complete_params() -> None:
    hit = resolve_weapon_preset(weapon_id="revolver_45", label=".45 左轮")
    assert hit is not None
    assert hit["damage"]
    assert hit["skill"]
    assert hit.get("ammo") is not None


def test_unknown_rifle_uses_class_template() -> None:
    filled = synthesize_weapon_params(weapon_id="custom_trench_rifle", label="战壕自制步枪")
    assert filled["resolved"] == "fallback"
    assert filled["weapon_class"] == "rifle"
    assert filled["damage"]
    assert filled["skill"]
    assert filled["template_weapon_id"] == "30_06_bolt_action_rifle"


def test_enrich_name_only_row_fills_panel_fields() -> None:
    row = enrich_weapon_row({"label": "卡卡诺步枪", "weapon_id": ""})
    assert row["damage"] == "1D12+2"
    assert row["ammo"] == 6
    assert row["params_source"] == "preset"
