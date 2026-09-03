"""Catalog-core: deterministic candidate recall, no auto-select."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
FIXTURE_RULESETS = ROOT / "tests" / "fixtures" / "rulesets"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_catalog
import coc_rulesets


DTO_KEYS = {
    "kind",
    "entity_id",
    "name",
    "localized_name",
    "aliases",
    "era",
    "secret",
    "source",
    "summary",
    "params",
    "match_reasons",
}


@pytest.fixture
def spark_registry(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(coc_rulesets, "RULESETS_ROOT", FIXTURE_RULESETS)
    coc_rulesets._MANIFEST_CACHE.clear()
    coc_rulesets._RESOLVER_CACHE.clear()
    yield
    coc_rulesets._MANIFEST_CACHE.clear()
    coc_rulesets._RESOLVER_CACHE.clear()


def _ids(result: dict) -> list[str]:
    return [row["entity_id"] for row in result["candidates"]]


def test_weapon_dot38_is_ambiguous_not_auto_selected() -> None:
    first = coc_catalog.search_catalog(query=".38", kinds=["weapon"])
    second = coc_catalog.search_catalog(query=".38", kinds=["weapon"])
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


def test_exact_id_ranks_first() -> None:
    result = coc_catalog.search_catalog(query="revolver_38", kinds=["weapon"])
    assert result["ok"]
    assert result["candidates"][0]["entity_id"] == "revolver_38"
    assert "exact_id" in result["candidates"][0]["match_reasons"]


def test_multi_kind_and_limit_and_era_filter() -> None:
    mixed = coc_catalog.search_catalog(query="car", kinds=["vehicle", "rule"], limit=5)
    assert mixed["ok"]
    assert mixed["limit"] == 5
    assert len(mixed["candidates"]) <= 5
    kinds = {row["kind"] for row in mixed["candidates"]}
    assert kinds <= {"vehicle", "rule"}

    modern = coc_catalog.search_catalog(query="beretta", kinds=["weapon"], era="modern")
    twenties = coc_catalog.search_catalog(query="beretta", kinds=["weapon"], era="1920s")
    assert modern["ok"]
    assert any(row["entity_id"] == "beretta_m9" for row in modern["candidates"])
    assert twenties["ok"]
    assert twenties["candidates"] == []


def test_secret_kinds_are_marked_and_have_no_player_projection() -> None:
    spells = coc_catalog.search_catalog(query="ward", kinds=["spell"])
    creatures = coc_catalog.search_catalog(query="Byakhee", kinds=["creature"])
    assert spells["ok"] and creatures["ok"]
    assert spells["candidates"]
    assert all(row["secret"] is True for row in spells["candidates"])
    assert creatures["candidates"][0]["secret"] is True
    assert "player" not in spells
    assert "projection" not in spells
    assert "player_safe" not in spells


def test_optional_kinds_exist_without_invented_tables() -> None:
    poison = coc_catalog.search_catalog(query="Arsenic", kinds=["poison"])
    tome = coc_catalog.search_catalog(query="Al Azif", kinds=["tome"])
    assert poison["ok"] and poison["candidates"]
    assert poison["candidates"][0]["secret"] is True
    assert tome["ok"] and tome["candidates"]
    missing = coc_catalog.search_catalog(query="plate", kinds=["armor"])
    cond = coc_catalog.search_catalog(query="prone", kinds=["condition"])
    assert missing["ok"] is False
    assert missing["error"]["code"] == "unsupported_catalog_kind"
    assert "armor" in missing["error"]["kinds"]
    assert cond["error"]["code"] == "unsupported_catalog_kind"


def test_empty_and_unknown_query() -> None:
    empty = coc_catalog.search_catalog(query="   ")
    assert empty["ok"] is False
    assert empty["error"]["code"] == "invalid_catalog_query"
    unknown = coc_catalog.search_catalog(query="zzzz-no-such-catalog-row-999")
    assert unknown["ok"] is True
    assert unknown["candidates"] == []
    assert unknown["selected"] is None


def test_skill_and_item_and_hazard_recall() -> None:
    skill = coc_catalog.search_catalog(query="Library Use", kinds=["skill"])
    assert skill["ok"]
    assert any(row["entity_id"] == "Library Use" for row in skill["candidates"])
    item = coc_catalog.search_catalog(query="Electric Torch", kinds=["item"])
    assert item["ok"]
    assert any(row["name"] == "Electric Torch" for row in item["candidates"])
    hazard = coc_catalog.search_catalog(query="drowning", kinds=["hazard"])
    assert hazard["ok"]
    assert any(row["entity_id"] == "drowning" for row in hazard["candidates"])


# --------------------------------------------------------------------------- #
# Parameterised families: one catalogue entry, the entity in the name
# --------------------------------------------------------------------------- #
def test_a_parameterised_summon_bind_name_reaches_its_family_entry() -> None:
    """CoC7 prints "Summon/Bind Spells" once; content writes the creature in.

    Recall alone can never reach it: the authored name shares no token set with
    the family row, so before family resolution existed a search for the name
    the-haunting actually authors returned nothing at all.
    """
    result = coc_catalog.search_catalog(
        query="Summon/Bind Dimensional Shambler", kinds=["spell"]
    )
    assert result["ok"] is True
    assert _ids(result) == ["summon_bind_spells"]
    row = result["candidates"][0]
    assert set(row) == DTO_KEYS | {"parameterisation"}
    assert "family_parameter" in row["match_reasons"]
    # The Keeper must be able to see this is the family bound to a creature,
    # not a separate spell the search just discovered.
    parameterisation = row["parameterisation"]
    assert parameterisation["family_name"] == "Summon/Bind Spells"
    assert parameterisation["family_entity_id"] == "summon_bind_spells"
    assert parameterisation["canonical_name"] == "Summon/Bind Dimensional Shambler"
    assert parameterisation["requested_name"] == "Summon/Bind Dimensional Shambler"
    assert parameterisation["parameter"] == {
        "kind": "creature",
        "entity_id": "dimensional_shambler",
        "name": "Dimensional Shambler",
    }
    assert "not a separate catalogue entry" in parameterisation["note"]
    # Costs still come from the family row, which is the only row that has any.
    assert row["params"]["cost_sanity"] == "1D4"
    assert row["params"]["source_page"] == 255


def test_the_creature_is_validated_against_catalogue_rows_not_a_written_list() -> None:
    """Every Mythos entity the catalogue carries parameterises the family."""
    for creature, entity_id in (
        ("Byakhee", "byakhee"),
        ("Mi-Go", "mi_go"),
        ("Hunting Horror", "hunting_horror"),
    ):
        result = coc_catalog.search_catalog(
            query=f"Summon/Bind {creature}", kinds=["spell"]
        )
        assert _ids(result) == ["summon_bind_spells"], creature
        parameter = result["candidates"][0]["parameterisation"]["parameter"]
        assert parameter["entity_id"] == entity_id
    # ... and a creature no catalogue row carries is a content gap, reported
    # rather than papered over with an invented entry.
    missing = coc_catalog.search_catalog(query="Summon/Bind Gug", kinds=["spell"])
    assert missing["ok"] is True
    assert missing["candidates"] == []
    assert missing["unresolved_family_parameters"] == [{
        "family_name": "Summon/Bind Spells",
        "family_entity_id": "summon_bind_spells",
        "parameter_kind": "creature",
        "parameter_query": "gug",
    }]


def test_the_family_shape_is_the_shape_not_one_hardcoded_family() -> None:
    """Contact and Contact Deity are written the same way and resolve alike.

    The longest stem wins, so "Contact Deity Nyarlathotep" belongs to the deity
    family rather than to Contact Spells over a parameter starting with "Deity".
    """
    contact = coc_catalog.search_catalog(query="Contact Ghoul", kinds=["spell"])
    assert _ids(contact) == ["contact_spells"]
    assert contact["candidates"][0]["parameterisation"]["canonical_name"] == (
        "Contact Ghoul"
    )
    deity = coc_catalog.search_catalog(
        query="Contact Deity Nyarlathotep", kinds=["spell"]
    )
    assert _ids(deity) == ["contact_deity_spells"]
    assert deity["candidates"][0]["parameterisation"]["parameter"]["name"] == (
        "Nyarlathotep"
    )


def test_the_family_row_itself_still_recalls_and_reports_no_gap() -> None:
    """A family's own name is an entry, not a stem over the word "Spells"."""
    result = coc_catalog.search_catalog(query="Contact Deity Spells", kinds=["spell"])
    assert _ids(result) == ["contact_deity_spells"]
    assert "exact_name" in result["candidates"][0]["match_reasons"]
    assert "parameterisation" not in result["candidates"][0]
    assert result["unresolved_family_parameters"] == []


def test_the_rulebooks_own_alternative_family_name_canonicalises_to_one_spell() -> None:
    """"Summoning Spells" is the same family, so its stem names the same spell."""
    result = coc_catalog.search_catalog(query="Summoning Byakhee", kinds=["spell"])
    assert _ids(result) == ["summon_bind_spells"]
    parameterisation = result["candidates"][0]["parameterisation"]
    assert parameterisation["requested_name"] == "Summoning Byakhee"
    assert parameterisation["canonical_name"] == "Summon/Bind Byakhee"


def test_an_ordinary_row_is_untouched_by_family_resolution() -> None:
    """Nothing that is not a family grows a parameterisation block."""
    result = coc_catalog.search_catalog(query="Flesh Ward", kinds=["spell"])
    assert _ids(result) == ["flesh_ward"]
    assert set(result["candidates"][0]) == DTO_KEYS
    assert result["unresolved_family_parameters"] == []
    weapons = coc_catalog.search_catalog(query=".38", kinds=["weapon"])
    assert all("parameterisation" not in row for row in weapons["candidates"])


def test_the_longest_family_stem_wins_when_two_stems_both_resolve() -> None:
    """Directed at the ambiguity coc7's own tables cannot currently produce.

    "Contact Spells" is a prefix of "Contact Deity Spells", so a creature whose
    own name began with "Deity" would make both stems resolve. The tie-break is
    exercised here on synthetic records rather than left to a future table that
    would silently bind the wrong family.
    """
    records = [
        {"kind": "spell", "entity_id": "contact_spells", "name": "Contact Spells",
         "family_parameter_kind": "creature"},
        {"kind": "spell", "entity_id": "contact_deity_spells",
         "name": "Contact Deity Spells", "family_parameter_kind": "creature"},
        {"kind": "creature", "entity_id": "nyarlathotep", "name": "Nyarlathotep"},
        {"kind": "creature", "entity_id": "deity_nyarlathotep",
         "name": "Deity Nyarlathotep"},
    ]
    resolved = coc_catalog.resolve_family_parameter(
        "Contact Deity Nyarlathotep", records
    )
    assert [row["family"]["entity_id"] for row in resolved["hits"]] == [
        "contact_deity_spells"
    ]
    assert resolved["hits"][0]["parameter"]["entity_id"] == "nyarlathotep"
    assert resolved["gaps"] == []


def test_resolve_name_returns_the_family_row_under_the_parameterised_name() -> None:
    """The runtime's entry point: what to persist, and which row prices it."""
    resolved = coc_catalog.resolve_name(
        kind="spell", name="Summon/Bind Dimensional Shambler"
    )
    assert resolved["canonical_name"] == "Summon/Bind Dimensional Shambler"
    assert resolved["record"]["entity_id"] == "summon_bind_spells"
    assert resolved["parameterisation"]["parameter"]["name"] == "Dimensional Shambler"
    plain = coc_catalog.resolve_name(kind="spell", name="flesh ward")
    assert plain["canonical_name"] == "Flesh Ward"
    assert plain["parameterisation"] is None
    assert coc_catalog.resolve_name(kind="spell", name="Summon/Bind Gug") is None


def test_spark_does_not_borrow_coc7(spark_registry) -> None:
    result = coc_catalog.search_catalog(
        query=".38",
        kinds=["weapon"],
        ruleset_id="spark",
    )
    assert result["ok"] is False
    assert result["error"]["code"] == "unsupported_ruleset_operation"
    assert result["error"]["ruleset_id"] == "spark"
    assert "candidates" not in result


def _load_toolbox():
    name = "coc_toolbox_catalog_search_surface"
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / "coc_toolbox.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_toolbox_list_describe_and_dot38_dual_candidates(tmp_path) -> None:
    toolbox = _load_toolbox()
    names = {row["name"] for row in toolbox.list_tools()}
    assert "rules.catalog_search" in names
    described = toolbox._describe("rules.catalog_search")
    assert described["needs_campaign"] is False
    assert described["access"] == "query"
    assert set(described["params"]) >= {"query", "kinds", "era", "limit"}
    policy = described["policy"]
    assert policy["audience"] == "keeper"
    assert policy["advisory"] is True
    assert policy["contract"] == "advisory"
    assert "live_turn" in policy["phases"]
    assert "cold_start" in policy["phases"]
    assert policy["kp_surface"] == "rules"

    result = toolbox.run_tool(
        "rules.catalog_search",
        tmp_path,
        None,
        {"query": ".38", "kinds": ["weapon"]},
    )
    assert result["ok"] is True, result
    data = result["data"]
    assert data["authority"] == "advisory"
    assert data["candidate_only"] is True
    assert data["selected"] is None
    ids = {row["entity_id"] for row in data["candidates"]}
    assert {"revolver_38", "revolver_38_or_9mm"} <= ids
    assert all(row.get("match_reasons") for row in data["candidates"])
    assert "player" not in data
    assert "player_safe" not in data

    secret = toolbox.run_tool(
        "rules.catalog_search",
        tmp_path,
        None,
        {"query": "ward", "kinds": ["spell"]},
    )
    assert secret["ok"] is True
    assert secret["data"]["secret"] is True
    assert all(row["secret"] is True for row in secret["data"]["candidates"])

    live = set(toolbox.query_operations(audience="keeper"))
    assert "rules.catalog_search" in live
    assert toolbox.operation_policy("rules.catalog_search")["audience"] != "player"


def test_ruleset_capability_and_mcp_archive_include_catalog_search() -> None:
    import coc_rulesets as rulesets

    index = rulesets.get_resolver({"ruleset_id": "coc7"}).public_api_index()
    assert "catalog_search" in index
    toolbox = _load_toolbox()
    assert toolbox._RULE_TOOL_CAPABILITIES["rules.catalog_search"] == "catalog_search"
    archive_path = ROOT / "plugins" / "coc-keeper" / "references" / "mcp-operation-contracts.json"
    archive = json.loads(archive_path.read_text(encoding="utf-8"))
    assert "rules.catalog_search" in archive["operations"]
    assert archive["operation_count"] == len(archive["operations"])
    assert archive["operation_count"] == len(toolbox.TOOLS)
    assert "rules.catalog_search" not in archive.get("listed_hotset", [])
