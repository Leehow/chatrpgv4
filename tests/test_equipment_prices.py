"""Authoritative CoC7 equipment price records: schema, anchors, catalog projection."""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_catalog
import coc_rules
EQUIPMENT_PATH = ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7" / "rules-json" / "equipment.json"
WEAPONS_PATH = ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7" / "rules-json" / "weapons.json"

PRICE_KINDS = {"fixed", "range", "per_unit", "minimum", "formula", "unlisted"}
COMMON_REQUIRED = ("kind", "currency", "source_display")
# kind -> (required extra fields, forbidden extra fields)
VARIANT_FIELDS = {
    "fixed": ({"amount"}, {"min", "max", "unit", "dice", "multiplier", "addend", "reason"}),
    "range": ({"min", "max"}, {"amount", "unit", "dice", "multiplier", "addend", "reason"}),
    "per_unit": ({"amount", "unit"}, {"min", "max", "dice", "multiplier", "addend", "reason"}),
    "minimum": ({"amount"}, {"min", "max", "unit", "dice", "multiplier", "addend", "reason"}),
    "formula": ({"dice", "multiplier"}, {"amount", "min", "max", "unit", "reason"}),
    "unlisted": ({"reason"}, {"amount", "min", "max", "unit", "dice", "multiplier", "addend"}),
}


def assert_price_variant(price: dict) -> None:
    assert isinstance(price, dict)
    for key in COMMON_REQUIRED:
        assert price.get(key), f"missing {key} in {price!r}"
    kind = price["kind"]
    assert kind in VARIANT_FIELDS, f"unknown price kind {kind!r}"
    required, forbidden = VARIANT_FIELDS[kind]
    missing = required - price.keys()
    extra = forbidden & price.keys()
    assert not missing, f"{kind} missing {sorted(missing)} in {price!r}"
    assert not extra, f"{kind} forbids {sorted(extra)} in {price!r}"
    if kind in {"fixed", "per_unit", "minimum"}:
        assert isinstance(price["amount"], (int, float))
    if kind == "range":
        assert price["min"] <= price["max"]
    if kind == "per_unit":
        assert isinstance(price["unit"], str) and price["unit"].strip()


def _records() -> list[dict]:
    data = coc_rules.equipment_table()
    return list(data["records"])


def test_equipment_schema_v2_rejects_legacy_periods() -> None:
    raw = json.loads(EQUIPMENT_PATH.read_text(encoding="utf-8"))
    assert raw["schema_version"] == 2
    assert "periods" not in raw
    assert isinstance(raw["records"], list)
    assert len(raw["records"]) >= 500
    eq = coc_rules.equipment_table()
    assert eq["schema_version"] == 2
    assert "periods" not in eq


def test_equipment_records_have_stable_ids_structured_prices_and_provenance() -> None:
    records = _records()
    ids = [row["price_id"] for row in records]
    assert len(ids) == len(set(ids))
    kinds = {row["price"]["kind"] for row in records}
    assert PRICE_KINDS <= kinds
    names = Counter((row["era"], row["name"]) for row in records)
    assert names[("1920s", "Khaki Jean Material")] == 2
    assert names[("1920s", "(with service, per week)")] == 2
    assert names[("1920s", "Bathing Suit")] == 2
    for row in records:
        assert row["era"] in {"1920s", "modern"}
        assert row["price_id"].startswith(f"eq.{row['era']}.")
        assert_price_variant(row["price"])
        prov = row["provenance"]
        assert prov["print_page"] in range(396, 406)
        assert prov["pdf_index"] == prov["print_page"] + 12
        assert prov["review_state"] == "visually_verified"


def test_equipment_known_visual_anchors() -> None:
    by_name = {}
    for row in _records():
        by_name.setdefault((row["era"], row["name"]), []).append(row)
    rope = by_name[("1920s", "Rope (50 feet)")][0]
    assert rope["price"] == {
        "kind": "fixed",
        "amount": 8.6,
        "currency": "USD",
        "source_display": "$8.60",
    }
    model_t = by_name[("1920s", "Ford Model T")][0]
    assert model_t["price"]["amount"] == 360.0
    assert model_t["price"]["source_display"] == "$360.00"
    torch = by_name[("1920s", "Electric Torch")][0]
    assert torch["price"]["amount"] == 2.4
    hotel = by_name[("1920s", "Average Hotel")][0]
    assert hotel["price"]["kind"] == "per_unit"
    assert hotel["price"]["amount"] == 4.5
    assert hotel["price"]["unit"] == "night"
    phone = by_name[("modern", "Cell Phone")][0]
    assert phone["price"]["amount"] == 50.0
    ammo = by_name[("1920s", ".22 Long Rifle (100)")][0]
    assert ammo["price"]["kind"] == "fixed"
    assert ammo["price"]["amount"] == 0.54
    modern_ammo = by_name[("modern", ".22 Long Rifle (500)")][0]
    assert modern_ammo["price"]["amount"] == 21.0
    khaki = by_name[("1920s", "Khaki Jean Material")]
    amounts = sorted(row["price"]["amount"] for row in khaki)
    assert amounts == [1.79, 41.79]
    weekly = by_name[("1920s", "(with service, per week)")]
    assert len(weekly) == 2
    assert {row["price"]["amount"] for row in weekly} == {10.0, 24.0}
    for row in weekly:
        assert row["price"]["kind"] == "per_unit"
        assert row["price"]["unit"] == "week"
        assert_price_variant(row["price"])


def test_weapon_price_refs_are_single_authority() -> None:
    weapons = json.loads(WEAPONS_PATH.read_text(encoding="utf-8"))["weapons"]
    for row in weapons.values():
        assert "cost" not in row
        assert "price" not in row
        assert "cost_by_era" not in row
    linked = [row for row in _records() if row.get("entity_ref")]
    assert linked
    for row in linked:
        ref = row["entity_ref"]
        assert ref["kind"] == "weapon"
        assert ref["entity_id"] in weapons
        assert row["category"] == "weapon_table"


def test_catalog_item_exposes_structured_price_variants() -> None:
    kinds_seen: set[str] = set()
    for kind in PRICE_KINDS:
        query = {
            "fixed": "Electric Torch",
            "range": "Outdoor coat",
            "per_unit": "Average Hotel",
            "minimum": "Chic Designer Dress",
            "formula": "Thompson SMG",
            "unlisted": "M16A2",
        }[kind]
        result = coc_catalog.search_catalog(query=query, kinds=["item"], limit=20)
        assert result["ok"]
        hits = [row for row in result["candidates"] if row["params"].get("price", {}).get("kind") == kind]
        assert hits, f"missing catalog projection for price kind {kind}"
        for row in hits:
            price = row["params"]["price"]
            assert_price_variant(price)
            assert row["entity_id"] == row["params"]["price_id"]
            kinds_seen.add(kind)
    assert kinds_seen == PRICE_KINDS


@pytest.mark.parametrize(
    "price",
    [
        {"kind": "fixed", "currency": "USD", "source_display": "$1"},
        {"kind": "per_unit", "amount": 10.0, "currency": "USD", "source_display": "$10.00"},
        {"kind": "range", "min": 1.0, "currency": "USD", "source_display": "$1-$2"},
        {"kind": "minimum", "amount": 90.0, "unit": "week", "currency": "USD", "source_display": "$90+"},
        {"kind": "formula", "multiplier": 50, "currency": "USD", "source_display": "1D6 x $50"},
        {"kind": "unlisted", "amount": 0, "reason": "n/a", "currency": "USD", "source_display": "N/A"},
        {"kind": "mystery", "currency": "USD", "source_display": "$1"},
    ],
)
def test_malformed_price_variants_fail(price: dict) -> None:
    with pytest.raises(AssertionError):
        assert_price_variant(price)


def test_catalog_keeps_duplicate_display_names() -> None:
    result = coc_catalog.search_catalog(query="Khaki Jean Material", kinds=["item"], limit=20)
    assert result["ok"]
    hits = [row for row in result["candidates"] if row["name"] == "Khaki Jean Material"]
    assert len(hits) == 2
    amounts = sorted(row["params"]["price"]["amount"] for row in hits)
    assert amounts == [1.79, 41.79]


def test_catalog_weapon_projects_price_ref_without_second_authority() -> None:
    result = coc_catalog.search_catalog(query="revolver_38", kinds=["weapon"])
    assert result["ok"]
    row = result["candidates"][0]
    assert row["entity_id"] == "revolver_38"
    refs = row["params"]["price_ref"]
    assert refs
    projection = row["params"]["price_projection"]
    assert {item["price_id"] for item in projection} == set(refs)
    assert "price" not in row["params"] or row["params"].get("price") is projection
    equipment_ids = {rec["price_id"] for rec in _records() if rec.get("entity_ref", {}).get("entity_id") == "revolver_38"}
    assert set(refs) == equipment_ids


def test_legacy_periods_shape_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_load(name: str):
        if name == "equipment":
            return {"source_note": "old", "periods": {"1920s": [{"item": "Flashlight", "price": "$2"}]}}
        raise AssertionError(name)

    monkeypatch.setattr(coc_rules, "load_rule_table", fake_load)
    with pytest.raises(ValueError, match="schema-v2"):
        coc_rules.equipment_table()
