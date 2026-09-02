"""A characteristic must be changeable during play, and change everything it feeds.

Characteristics were writable only at chargen. `rules.resource_delta` declares
just the four coc7 pools (hp/san/mp/luck), and the compiled rule graph has no
decision node touching a characteristic, so an authored consequence that costs
one -- a spell's POW cost, a ghost's drain, the time-loop ageing this module's
own reset requires -- had no canonical path for anyone, host included.

On 2026-09-01 the live table reached exactly that: the ghost struck, and the
Keeper recorded the POW drain as `rules.damage kind=damage 2D10`, taking HP to
0 with `dying` and `major_wound`, then issued a compensating heal. The wrong
operation was the only one it had.

The risk in fixing it is silent desync: HP, MP, SAN, damage bonus, Build and
MOV are all derived from characteristics, so writing one without re-deriving
would be worse than the missing capability. These tests hold that line.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


coc_state = _load("coc_state_characteristic_tests", SCRIPTS / "coc_state.py")
policy = _load("coc_operation_policy_characteristic_tests", SCRIPTS / "coc_operation_policy.py")


SHEET = {
    "schema_version": 1,
    "id": "probe-investigator",
    "name": "Probe",
    "characteristics": {
        "STR": 40, "CON": 60, "SIZ": 50, "DEX": 50,
        "APP": 50, "INT": 80, "POW": 60, "EDU": 70,
    },
    "derived": {
        "HP": 11, "SAN": 60, "MP": 12, "Luck": 55,
        "DB": "none", "Build": 0, "MOV": 8,
    },
    "skills": {},
}


@pytest.fixture()
def campaign(tmp_path: Path, monkeypatch) -> Path:
    coc_root = tmp_path / ".coc"
    inv = coc_root / "investigators" / "probe-investigator"
    inv.mkdir(parents=True)
    (inv / "character.json").write_text(
        json.dumps(SHEET, ensure_ascii=False), encoding="utf-8",
    )
    campaign_dir = coc_root / "campaigns" / "probe-campaign"
    (campaign_dir / "save" / "investigator-state").mkdir(parents=True)
    (campaign_dir / "save" / "investigator-state" / "probe-investigator.json").write_text(
        json.dumps({
            "schema_version": 1,
            "campaign_id": "probe-campaign",
            "investigator_id": "probe-investigator",
            "current_hp": 11, "current_mp": 12, "current_san": 59, "current_luck": 55,
        }, ensure_ascii=False),
        encoding="utf-8",
    )
    # The guard reads the shared sheet; this probe has no reuse transaction.
    monkeypatch.setattr(
        coc_state.coc_investigator_guard,
        "read_reusable_character",
        lambda base, investigator_id, path: json.loads(
            Path(path).read_text(encoding="utf-8")
        ),
    )
    return campaign_dir


def _apply(campaign: Path, stat: str, delta: int):
    return coc_state.apply_stat_delta(
        campaign, "probe-investigator", stat=stat, delta=delta,
    )


def _sheet(campaign: Path) -> dict:
    return json.loads(
        (campaign.parents[1] / "investigators" / "probe-investigator"
         / "character.json").read_text(encoding="utf-8")
    )


def _state(campaign: Path) -> dict:
    return json.loads(
        (campaign / "save" / "investigator-state" / "probe-investigator.json")
        .read_text(encoding="utf-8")
    )


def test_the_characteristic_actually_changes_on_the_shared_sheet(campaign):
    result = _apply(campaign, "POW", -15)
    assert (result["before"], result["after"]) == (60, 45)
    assert _sheet(campaign)["characteristics"]["POW"] == 45


def test_everything_derived_from_it_is_recomputed(campaign):
    # POW feeds MP (POW/5) and starting SAN. Nothing else reads POW, so HP,
    # damage bonus, Build and MOV must not drift.
    result = _apply(campaign, "POW", -15)
    after = result["derived_after"]
    assert after["MP"] == 9
    assert after["SAN"] == 45
    assert (after["HP"], after["DB"], after["Build"], after["MOV"]) == (11, "none", 0, 8)
    assert _sheet(campaign)["derived"] == after


def test_luck_is_carried_not_rederived(campaign):
    # Luck is rolled 3D6x5, never derived from a characteristic.
    assert _apply(campaign, "POW", -15)["derived_after"]["Luck"] == 55


def test_a_dropped_maximum_clamps_the_current_pool(campaign):
    result = _apply(campaign, "POW", -15)
    assert result["clamped_pools"] == {
        "current_mp": {"before": 12, "after": 9},
        "current_san": {"before": 59, "after": 45},
    }
    state = _state(campaign)
    assert (state["current_mp"], state["current_san"]) == (9, 45)


def test_a_pool_below_its_new_maximum_is_never_topped_up(campaign):
    """Losing POW does not heal you."""
    _apply(campaign, "POW", -15)
    before_hp = _state(campaign)["current_hp"]
    _apply(campaign, "POW", +15)
    state = _state(campaign)
    assert state["current_mp"] == 9, "a restored maximum must not refill the pool"
    assert state["current_san"] == 45
    assert state["current_hp"] == before_hp


def test_con_and_siz_move_hit_points(campaign):
    # The other direction: a characteristic that does feed HP.
    result = _apply(campaign, "CON", -20)
    assert result["derived_after"]["HP"] == 9
    assert result["clamped_pools"]["current_hp"] == {"before": 11, "after": 9}


def test_a_characteristic_never_falls_below_its_floor(campaign):
    result = _apply(campaign, "POW", -999)
    assert result["after"] == coc_state.CHARACTERISTIC_FLOOR
    assert result["floored"] is True


def test_an_ordinary_change_is_not_reported_as_floored(campaign):
    assert _apply(campaign, "POW", -15)["floored"] is False


def test_a_derived_value_can_be_overridden_and_the_override_sticks(campaign):
    """House rules move derived values too, and a recomputation must not
    quietly revert them."""
    result = _apply(campaign, "MOV", +2)
    assert result["stat_kind"] == "derived_override"
    assert (result["before"], result["after"]) == (8, 10)
    assert _sheet(campaign)["derived"]["MOV"] == 10
    # Now move a characteristic, which recomputes everything. MOV is derived
    # from STR/DEX/SIZ, so an unprotected override would be erased here.
    _apply(campaign, "POW", -5)
    assert _sheet(campaign)["derived"]["MOV"] == 10


def test_luck_is_adjustable_and_clamps_its_pool(campaign):
    # Luck is rolled, not derived, and tables spend and award it freely.
    result = _apply(campaign, "Luck", -20)
    assert result["after"] == 35
    assert result["clamped_pools"]["current_luck"] == {"before": 55, "after": 35}


def test_a_house_rule_stat_is_accepted_and_kept_apart(campaign):
    result = _apply(campaign, "Corruption", +3)
    assert result["stat_kind"] == "house_rule"
    assert (result["before"], result["after"]) == (0, 3)
    assert result["house_rule_stats"]["Corruption"] == 3
    # It is stored, and it never leaks into the derived block the rules own.
    assert "Corruption" not in _sheet(campaign)["derived"]
    assert _sheet(campaign)["stat_overrides"]["Corruption"] == 3


def test_a_house_rule_stat_accumulates(campaign):
    _apply(campaign, "Corruption", +3)
    assert _apply(campaign, "Corruption", +2)["after"] == 5


def test_case_is_folded_for_known_stats_but_kept_for_house_rules(campaign):
    assert _apply(campaign, "pow", -5)["stat"] == "POW"
    assert _apply(campaign, "mov", +1)["stat"] == "MOV"
    assert _apply(campaign, "Blood Debt", +1)["stat"] == "Blood Debt"


def test_a_non_numeric_stat_is_refused_with_its_value_named(campaign):
    # DB is a string ("none", "+1D4"); a delta cannot move it, and silently
    # coercing it would corrupt the sheet.
    with pytest.raises(ValueError, match="not a number"):
        _apply(campaign, "DB", +1)


def test_an_empty_stat_name_is_refused(campaign):
    with pytest.raises(ValueError):
        _apply(campaign, "   ", +1)


@pytest.mark.parametrize("bad", [0, True, "3", None])
def test_the_delta_must_be_a_real_signed_integer(campaign, bad):
    with pytest.raises(ValueError):
        coc_state.apply_stat_delta(
            campaign, "probe-investigator", stat="POW", delta=bad,
        )


def test_lowercase_is_accepted_because_the_grammar_lowercases_refs(campaign):
    # `characteristic:pow` is the closed semantic form the Keeper sends.
    assert _apply(campaign, "pow", -5)["stat"] == "POW"


def test_the_operation_is_on_the_keepers_surface():
    """The permission half: an operation the KP cannot reach is not a fix."""
    row = policy.policy_for_operation("state.characteristic_delta")
    assert row["audience"] == "keeper"
    assert row["kp_surface"] == "state"
    assert policy.model_invocation_tool("state.characteristic_delta") == "coc_state"


def test_the_change_reaches_the_player_visible_state_block():
    """A drain the player is never told about is a drain that did not happen.

    The first live use wrote POW 60 -> 48 correctly and the turn's visible
    state block said nothing: `_project_state_deltas` did not know the
    operation, so the sheet moved silently.
    """
    finalization = _load(
        "coc_turn_finalization_characteristic_tests",
        SCRIPTS / "coc_turn_finalization.py",
    )
    projected = finalization._project_state_deltas([{
        "ok": True,
        "tool": "state.characteristic_delta",
        "args": {"decision_id": "npc-ghost-drain-1"},
        "data": {
            "investigator_id": "probe-investigator",
            "stat": "POW",
            "before": 60, "after": 48,
            "derived_before": {"HP": 11, "MP": 12, "SAN": 60},
            "derived_after": {"HP": 11, "MP": 9, "SAN": 48},
            "clamped_pools": {
                "current_mp": {"before": 12, "after": 9},
                "current_san": {"before": 59, "after": 48},
            },
        },
    }], ruleset_id="coc7")
    by_resource = {row["resource"]: row for row in projected}
    assert by_resource["POW"]["delta"] == -12
    # The maxima that moved, and only those: HP did not change.
    assert by_resource["max MP"]["after"] == 9
    assert by_resource["max SAN"]["after"] == 48
    assert "max HP" not in by_resource
    # And the pools that had to be clamped under them.
    assert {row["resource"] for row in projected} >= {"POW", "max MP", "max SAN"}


def test_an_unchanged_characteristic_projects_nothing():
    finalization = _load(
        "coc_turn_finalization_characteristic_noop_tests",
        SCRIPTS / "coc_turn_finalization.py",
    )
    assert finalization._project_state_deltas([{
        "ok": True,
        "tool": "state.characteristic_delta",
        "args": {"decision_id": "noop-1"},
        "data": {
            "investigator_id": "probe-investigator",
            "stat": "POW",
            "before": 60, "after": 60,
            "derived_before": {"MP": 12}, "derived_after": {"MP": 12},
            "clamped_pools": {},
        },
    }], ruleset_id="coc7") == []


def test_the_operation_keeps_the_name_the_keeper_guesses():
    """Discoverability is part of the capability, not a cosmetic concern.

    Renaming this to `state.stat_delta` -- more accurate, since it takes
    derived values and house-rule stats too -- made it unreachable in one live
    turn: the Keeper guessed `state.characteristic_adjust`,
    `state.adjust_characteristic`, `rules.characteristic_damage` and
    `state.resource_adjust`, found none of them, and narrated a STR loss that
    never reached the sheet. Listing the namespace is not a fallback: `state`
    is over the discovery budget. Under this name it guessed right first try.
    """
    row = policy.policy_for_operation("state.characteristic_delta")
    assert row["audience"] == "keeper"
    contracts = json.loads(
        (ROOT / "plugins" / "coc-keeper" / "references"
         / "mcp-operation-contracts.json").read_text(encoding="utf-8")
    )["operations"]
    assert "state.characteristic_delta" in contracts, (
        "the generated contract projection must carry the operation under the "
        "name the Keeper searches for"
    )
    schema = contracts["state.characteristic_delta"]["inputSchema"]
    assert "characteristic" in schema["required"]
    # ...and the argument must say it is not limited to STR..EDU, or the
    # Keeper will not try it for Luck or a house-rule stat.
    assert "house-rule" in schema["properties"]["characteristic"]["description"]


# ---------------------------------------------------------------------------
# The proof half: a visible delta must be provable, and only the real one.
# ---------------------------------------------------------------------------

def _authority():
    return _load(
        "coc_state_effect_authority_characteristic_tests",
        SCRIPTS / "coc_state_effect_authority.py",
    )


PROVING_CALL = {
    "ok": True,
    "tool": "state.characteristic_delta",
    "args": {"decision_id": "npc-ghost-drain-1", "investigator": "probe"},
    "data": {
        "investigator_id": "probe",
        "stat": "POW", "before": 48, "after": 36,
        "derived_before": {"HP": 11, "MP": 9, "SAN": 48},
        "derived_after": {"HP": 11, "MP": 7, "SAN": 36},
        "clamped_pools": {
            "current_mp": {"before": 9, "after": 7},
            "current_san": {"before": 48, "after": 36},
        },
    },
}


def _effect(resource, before, after, key=None):
    effect = {
        "schema_version": 1, "category": "state_delta",
        "effect_id": f"e-{resource}", "effect_kind": "scalar",
        "resource": resource, "investigator_id": "probe",
        "before": before, "delta": after - before, "after": after,
        "source_decision_id": "npc-ghost-drain-1",
    }
    if key:
        effect["resource_key"] = key
    return effect


def test_every_projected_effect_can_be_proven():
    """Otherwise turn.finalize refuses and the player gets nothing at all.

    That is what happened live: POW 48 -> 36 landed, `turn.finalize` rejected
    the turn with `unproven_state_delta` because the state-proof authority did
    not know the operation, and the turn ended with zero characters delivered.
    """
    finalization = _load(
        "coc_turn_finalization_proof_tests", SCRIPTS / "coc_turn_finalization.py",
    )
    effects = finalization._project_state_deltas([PROVING_CALL], ruleset_id="coc7")
    assert {row["resource"] for row in effects} == {
        "POW", "max MP", "max SAN", "MP", "SAN",
    }
    assert _authority().state_delta_proof_violations([PROVING_CALL], effects) == []


def test_the_proof_is_as_narrow_as_the_write():
    """A registered operation must not become a blanket permit."""
    authority = _authority()
    for label, effect in [
        ("a pool it never touched", _effect("HP", 11, 3)),
        ("a stat it never moved", _effect("STR", 40, 20, "STR")),
        ("the right stat, invented numbers", _effect("POW", 48, 10, "POW")),
        ("a maximum that did not move", _effect("max HP", 11, 5, "max HP")),
    ]:
        assert authority.state_delta_proof_violations([PROVING_CALL], [effect]), (
            f"{label} was accepted as proven"
        )


def test_the_writer_domains_come_from_the_receipt():
    domains = _authority().writer_domains("state.characteristic_delta", PROVING_CALL)
    assert set(domains) == {"POW", "max MP", "max SAN", "mp", "san"}
    # HP did not move, so it is not claimable.
    assert "hp" not in domains
    assert "max HP" not in domains
