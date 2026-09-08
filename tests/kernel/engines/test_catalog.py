"""Catalog records and candidate recall. Ported from the old tree's
`tests/test_catalog_search.py` and `tests/test_equipment_prices.py` (subject:
`coc_catalog.py` plus `rulesets/coc7/catalog.py`'s record builders, now merged
into `kernel/coc/rules/catalog.py`'s `Catalog` class).

`catalog.py` is not in T6's explicitly named module list (combat/chase/sanity/
healing/magic/mp/mythos/development/roll/skills/rules/character), but it is one
of the ported engine modules the ticket names in context, and the old tree
carries a direct, sizeable unit-test file for it -- ported here for the same
reason `rule_options.py` was.

API change from the port: every module-level function
(`coc_catalog.search_catalog(query=..., kinds=..., era=..., limit=...)`,
`coc_catalog.resolve_name(kind=..., name=...)`, `coc_catalog.resolve_family_parameter`)
is now a `Catalog` instance bound to a `RuleTables`, or (for the pure
`resolve_family_parameter` helper) a module-level function taking the same
positional args. The record/DTO shape (kind, entity_id, name, localized_name,
aliases, era, secret, source, summary, params, match_reasons[, parameterisation])
is unchanged.

Dropped (subject deleted, or out of this port's time budget):
- `test_spark_does_not_borrow_coc7` -- exercised a separate "spark" ruleset
  registry (`coc_rulesets.RULESETS_ROOT` swap); not part of the coc7 engine
  port at all.
- `test_toolbox_list_describe_and_dot38_dual_candidates`,
  `test_ruleset_capability_and_mcp_archive_include_catalog_search` -- bound to
  the deleted MCP/toolbox dispatch layer.
- The module-authored-spell family
  (`test_a_module_authored_spell_resolves_under_the_shorthand_its_profile_uses`,
  `test_the_module_candidate_is_marked_and_an_ordinary_row_is_untouched`,
  `test_the_rulebook_row_wins_a_name_the_module_also_carries`,
  `test_a_module_spell_says_it_is_unpriced_rather_than_costing_nothing`,
  `test_module_visibility_reaches_the_result_as_the_secret_flag`,
  `test_a_module_spell_does_not_answer_for_a_kind_nobody_asked_for`) --
  `module_spell_records(graph)` and `demoted_module_block`/`module_record_named`
  do exist in the port and look wired for this, but exercising it needs a
  starter module-graph fixture and was time-boxed out of this pass; flagged
  here for the lead rather than silently skipped.
- `test_legacy_periods_shape_fails_closed` (equipment schema-v2 guard) is
  already ported in `tests/kernel/engines/test_tables.py`
  (`RuleTables.equipment_table`); not duplicated here.
"""

from __future__ import annotations

import json
import sys
from collections import Counter

import pytest
from conftest import CONTENT_DIR, KERNEL_DIR

sys.path.insert(0, str(KERNEL_DIR))

from coc.rules.catalog import Catalog, resolve_family_parameter  # noqa: E402
from coc.rules.tables import RuleTables  # noqa: E402

RULES = CONTENT_DIR / "rulesets" / "coc7" / "rules-json"
EQUIPMENT_PATH = RULES / "equipment.json"
WEAPONS_PATH = RULES / "weapons.json"

DTO_KEYS = {
    "kind", "entity_id", "name", "localized_name", "aliases", "era", "secret",
    "source", "summary", "params", "match_reasons",
}

PRICE_KINDS = {"fixed", "range", "per_unit", "minimum", "formula", "unlisted"}
COMMON_REQUIRED = ("kind", "currency", "source_display")
VARIANT_FIELDS = {
    "fixed": ({"amount"}, {"min", "max", "unit", "dice", "multiplier", "addend", "reason"}),
    "range": ({"min", "max"}, {"amount", "unit", "dice", "multiplier", "addend", "reason"}),
    "per_unit": ({"amount", "unit"}, {"min", "max", "dice", "multiplier", "addend", "reason"}),
    "minimum": ({"amount"}, {"min", "max", "unit", "dice", "multiplier", "addend", "reason"}),
    "formula": ({"dice", "multiplier"}, {"amount", "min", "max", "unit", "reason"}),
    "unlisted": ({"reason"}, {"amount", "min", "max", "unit", "dice", "multiplier", "addend"}),
}


@pytest.fixture(scope="module")
def tables() -> RuleTables:
    return RuleTables(RULES)


@pytest.fixture(scope="module")
def catalog(tables) -> Catalog:
    return Catalog(tables)


def _ids(result: dict) -> list[str]:
    return [row["entity_id"] for row in result["candidates"]]


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


# --------------------------------------------------------------------------- #
# Equipment price records (schema, anchors)
# --------------------------------------------------------------------------- #

def _records(tables):
    return list(tables.equipment_table()["records"])


def test_equipment_records_have_stable_ids_structured_prices_and_provenance(tables):
    records = _records(tables)
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


def test_equipment_known_visual_anchors(tables):
    by_name = {}
    for row in _records(tables):
        by_name.setdefault((row["era"], row["name"]), []).append(row)
    rope = by_name[("1920s", "Rope (50 feet)")][0]
    assert rope["price"] == {"kind": "fixed", "amount": 8.6, "currency": "USD", "source_display": "$8.60"}
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


def test_weapon_price_refs_are_single_authority(tables):
    weapons = json.loads(WEAPONS_PATH.read_text(encoding="utf-8"))["weapons"]
    for row in weapons.values():
        assert "cost" not in row
        assert "price" not in row
        assert "cost_by_era" not in row
    linked = [row for row in _records(tables) if row.get("entity_ref")]
    assert linked
    for row in linked:
        ref = row["entity_ref"]
        assert ref["kind"] == "weapon"
        assert ref["entity_id"] in weapons
        assert row["category"] == "weapon_table"


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
def test_malformed_price_variants_fail(price: dict):
    with pytest.raises(AssertionError):
        assert_price_variant(price)


def test_catalog_item_exposes_structured_price_variants(catalog):
    kinds_seen: set[str] = set()
    for kind in PRICE_KINDS:
        query = {
            "fixed": "Electric Torch", "range": "Outdoor coat", "per_unit": "Average Hotel",
            "minimum": "Chic Designer Dress", "formula": "Thompson SMG", "unlisted": "M16A2",
        }[kind]
        result = catalog.search(query, kinds=["item"], limit=20)
        assert result["ok"]
        hits = [row for row in result["candidates"] if row["params"].get("price", {}).get("kind") == kind]
        assert hits, f"missing catalog projection for price kind {kind}"
        for row in hits:
            price = row["params"]["price"]
            assert_price_variant(price)
            assert row["entity_id"] == row["params"]["price_id"]
            kinds_seen.add(kind)
    assert kinds_seen == PRICE_KINDS


def test_catalog_keeps_duplicate_display_names(catalog):
    result = catalog.search("Khaki Jean Material", kinds=["item"], limit=20)
    assert result["ok"]
    hits = [row for row in result["candidates"] if row["name"] == "Khaki Jean Material"]
    assert len(hits) == 2
    amounts = sorted(row["params"]["price"]["amount"] for row in hits)
    assert amounts == [1.79, 41.79]


def test_catalog_weapon_projects_price_ref_without_second_authority(catalog, tables):
    result = catalog.search("revolver_38", kinds=["weapon"])
    assert result["ok"]
    row = result["candidates"][0]
    assert row["entity_id"] == "revolver_38"
    refs = row["params"]["price_ref"]
    assert refs
    projection = row["params"]["price_projection"]
    assert {item["price_id"] for item in projection} == set(refs)
    assert "price" not in row["params"] or row["params"].get("price") is projection
    equipment_ids = {rec["price_id"] for rec in _records(tables)
                     if rec.get("entity_ref", {}).get("entity_id") == "revolver_38"}
    assert set(refs) == equipment_ids


# --------------------------------------------------------------------------- #
# Recall core: deterministic candidates, no auto-select
# --------------------------------------------------------------------------- #

def test_weapon_dot38_is_ambiguous_not_auto_selected(catalog):
    first = catalog.search(".38", kinds=["weapon"])
    second = catalog.search(".38", kinds=["weapon"])
    assert first["ok"] is True
    assert first["selected"] is None
    ids = set(_ids(first))
    assert {"revolver_38", "revolver_38_or_9mm"} <= ids
    assert _ids(first) == _ids(second)
    for row in first["candidates"]:
        assert set(row) == DTO_KEYS
        assert row["kind"] == "weapon"
        assert row["secret"] is False
        assert row["source"]["table"] == "weapons.json"
        assert "presentation" not in row
        assert "description" not in row["summary"]


def test_exact_id_ranks_first(catalog):
    result = catalog.search("revolver_38", kinds=["weapon"])
    assert result["ok"]
    assert result["candidates"][0]["entity_id"] == "revolver_38"
    assert "exact_id" in result["candidates"][0]["match_reasons"]


def test_multi_kind_and_limit_and_era_filter(catalog):
    mixed = catalog.search("car", kinds=["vehicle", "rule"], limit=5)
    assert mixed["ok"]
    assert mixed["limit"] == 5
    assert len(mixed["candidates"]) <= 5
    kinds = {row["kind"] for row in mixed["candidates"]}
    assert kinds <= {"vehicle", "rule"}

    modern = catalog.search("beretta", kinds=["weapon"], era="modern")
    twenties = catalog.search("beretta", kinds=["weapon"], era="1920s")
    assert modern["ok"]
    assert any(row["entity_id"] == "beretta_m9" for row in modern["candidates"])
    assert twenties["ok"]
    assert twenties["candidates"] == []


def test_secret_kinds_are_marked_and_have_no_player_projection(catalog):
    spells = catalog.search("ward", kinds=["spell"])
    creatures = catalog.search("Byakhee", kinds=["creature"])
    assert spells["ok"] and creatures["ok"]
    assert spells["candidates"]
    assert all(row["secret"] is True for row in spells["candidates"])
    assert creatures["candidates"][0]["secret"] is True
    assert "player" not in spells
    assert "projection" not in spells
    assert "player_safe" not in spells


def test_optional_kinds_exist_without_invented_tables(catalog):
    poison = catalog.search("Arsenic", kinds=["poison"])
    tome = catalog.search("Al Azif", kinds=["tome"])
    assert poison["ok"] and poison["candidates"]
    assert poison["candidates"][0]["secret"] is True
    assert tome["ok"] and tome["candidates"]
    missing = catalog.search("plate", kinds=["armor"])
    cond = catalog.search("prone", kinds=["condition"])
    assert missing["ok"] is False
    assert missing["error"]["code"] == "unsupported_catalog_kind"
    assert "armor" in missing["error"]["kinds"]
    assert cond["error"]["code"] == "unsupported_catalog_kind"


def test_empty_and_unknown_query(catalog):
    empty = catalog.search("   ")
    assert empty["ok"] is False
    assert empty["error"]["code"] == "invalid_catalog_query"
    unknown = catalog.search("zzzz-no-such-catalog-row-999")
    assert unknown["ok"] is True
    assert unknown["candidates"] == []
    assert unknown["selected"] is None


def test_skill_and_item_and_hazard_recall(catalog):
    skill = catalog.search("Library Use", kinds=["skill"])
    assert skill["ok"]
    assert any(row["entity_id"] == "Library Use" for row in skill["candidates"])
    item = catalog.search("Electric Torch", kinds=["item"])
    assert item["ok"]
    assert any(row["name"] == "Electric Torch" for row in item["candidates"])
    hazard = catalog.search("drowning", kinds=["hazard"])
    assert hazard["ok"]
    assert any(row["entity_id"] == "drowning" for row in hazard["candidates"])


# --------------------------------------------------------------------------- #
# Parameterised families: one catalogue entry, the entity in the name
# --------------------------------------------------------------------------- #

def test_a_parameterised_summon_bind_name_reaches_its_family_entry(catalog):
    """CoC7 prints "Summon/Bind Spells" once; content writes the creature in.

    Recall alone can never reach it: the authored name shares no token set with
    the family row, so before family resolution existed a search for the name
    the-haunting actually authors returned nothing at all.
    """
    result = catalog.search("Summon/Bind Dimensional Shambler", kinds=["spell"])
    assert result["ok"] is True
    assert _ids(result) == ["summon_bind_spells"]
    row = result["candidates"][0]
    assert set(row) == DTO_KEYS | {"parameterisation"}
    assert "family_parameter" in row["match_reasons"]
    parameterisation = row["parameterisation"]
    assert parameterisation["family_name"] == "Summon/Bind Spells"
    assert parameterisation["family_entity_id"] == "summon_bind_spells"
    assert parameterisation["canonical_name"] == "Summon/Bind Dimensional Shambler"
    assert parameterisation["requested_name"] == "Summon/Bind Dimensional Shambler"
    assert parameterisation["parameter"] == {
        "kind": "creature", "entity_id": "dimensional_shambler", "name": "Dimensional Shambler",
    }
    assert "not a separate catalogue entry" in parameterisation["note"]
    assert row["params"]["cost_sanity"] == "1D4"
    # #83: was 255, a drifted page. "Summoning Spells" is printed on p.263.
    assert row["params"]["source_page"] == 263


def test_the_creature_is_validated_against_catalogue_rows_not_a_written_list(catalog):
    """Every Mythos entity the catalogue carries parameterises the family."""
    for creature, entity_id in (
        ("Byakhee", "byakhee"), ("Mi-Go", "mi_go"), ("Hunting Horror", "hunting_horror"),
    ):
        result = catalog.search(f"Summon/Bind {creature}", kinds=["spell"])
        assert _ids(result) == ["summon_bind_spells"], creature
        parameter = result["candidates"][0]["parameterisation"]["parameter"]
        assert parameter["entity_id"] == entity_id
    # ... and a creature no catalogue row carries is a content gap, reported
    # rather than papered over with an invented entry.
    missing = catalog.search("Summon/Bind Gug", kinds=["spell"])
    assert missing["ok"] is True
    assert missing["candidates"] == []
    assert missing["unresolved_family_parameters"] == [{
        "family_name": "Summon/Bind Spells", "family_entity_id": "summon_bind_spells",
        "parameter_kind": "creature", "parameter_query": "gug",
    }]


def test_the_family_shape_is_the_shape_not_one_hardcoded_family(catalog):
    """Contact and Contact Deity are written the same way and resolve alike.

    The longest stem wins, so "Contact Deity Nyarlathotep" belongs to the deity
    family rather than to Contact Spells over a parameter starting with "Deity".
    """
    contact = catalog.search("Contact Ghoul", kinds=["spell"])
    assert _ids(contact) == ["contact_spells"]
    assert contact["candidates"][0]["parameterisation"]["canonical_name"] == "Contact Ghoul"
    deity = catalog.search("Contact Deity Nyarlathotep", kinds=["spell"])
    assert _ids(deity) == ["contact_deity_spells"]
    assert deity["candidates"][0]["parameterisation"]["parameter"]["name"] == "Nyarlathotep"


def test_the_family_row_itself_still_recalls_and_reports_no_gap(catalog):
    """A family's own name is an entry, not a stem over the word "Spells"."""
    result = catalog.search("Contact Deity Spells", kinds=["spell"])
    assert _ids(result) == ["contact_deity_spells"]
    assert "exact_name" in result["candidates"][0]["match_reasons"]
    assert "parameterisation" not in result["candidates"][0]
    assert result["unresolved_family_parameters"] == []


def test_the_rulebooks_own_alternative_family_name_canonicalises_to_one_spell(catalog):
    """"Summoning Spells" is the same family, so its stem names the same spell."""
    result = catalog.search("Summoning Byakhee", kinds=["spell"])
    assert _ids(result) == ["summon_bind_spells"]
    parameterisation = result["candidates"][0]["parameterisation"]
    assert parameterisation["requested_name"] == "Summoning Byakhee"
    assert parameterisation["canonical_name"] == "Summon/Bind Byakhee"


def test_an_ordinary_row_is_untouched_by_family_resolution(catalog):
    """Nothing that is not a family grows a parameterisation block."""
    result = catalog.search("Flesh Ward", kinds=["spell"])
    assert _ids(result) == ["flesh_ward"]
    assert set(result["candidates"][0]) == DTO_KEYS
    assert result["unresolved_family_parameters"] == []
    weapons = catalog.search(".38", kinds=["weapon"])
    assert all("parameterisation" not in row for row in weapons["candidates"])


def test_the_longest_family_stem_wins_when_two_stems_both_resolve():
    """Directed at the ambiguity coc7's own tables cannot currently produce.

    "Contact Spells" is a prefix of "Contact Deity Spells", so a creature whose
    own name began with "Deity" would make both stems resolve. The tie-break is
    exercised here on synthetic records rather than left to a future table that
    would silently bind the wrong family.
    """
    records = [
        {"kind": "spell", "entity_id": "contact_spells", "name": "Contact Spells",
         "family_parameter_kind": "creature"},
        {"kind": "spell", "entity_id": "contact_deity_spells", "name": "Contact Deity Spells",
         "family_parameter_kind": "creature"},
        {"kind": "creature", "entity_id": "nyarlathotep", "name": "Nyarlathotep"},
        {"kind": "creature", "entity_id": "deity_nyarlathotep", "name": "Deity Nyarlathotep"},
    ]
    resolved = resolve_family_parameter("Contact Deity Nyarlathotep", records)
    assert [row["family"]["entity_id"] for row in resolved["hits"]] == ["contact_deity_spells"]
    assert resolved["hits"][0]["parameter"]["entity_id"] == "nyarlathotep"
    assert resolved["gaps"] == []


def test_resolve_name_returns_the_family_row_under_the_parameterised_name(catalog):
    """The runtime's entry point: what to persist, and which row prices it."""
    resolved = catalog.resolve_name("spell", "Summon/Bind Dimensional Shambler")
    assert resolved["canonical_name"] == "Summon/Bind Dimensional Shambler"
    assert resolved["record"]["entity_id"] == "summon_bind_spells"
    assert resolved["parameterisation"]["parameter"]["name"] == "Dimensional Shambler"
    plain = catalog.resolve_name("spell", "flesh ward")
    assert plain["canonical_name"] == "Flesh Ward"
    assert plain["parameterisation"] is None
    assert catalog.resolve_name("spell", "Summon/Bind Gug") is None
