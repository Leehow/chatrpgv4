"""Behavior tests owned by the combat operation cell."""
from toolbox_test_support import *

def test_bonus_die_only_combat_success_preserves_06_66_evidence_without_tick(
    campaign_ws,
):
    investigator_id = campaign_ws["investigator_id"]
    session = coc_combat.CombatSession(
        "combat-bonus-tick",
        "scene/bonus-tick",
        0,
        random.Random(0),
    )
    session.add_participant(
        investigator_id,
        "investigator",
        dex=50,
        combat_skill=50,
        build=0,
        hp_max=10,
    )
    outcome, record = session._percentile(
        investigator_id,
        "Spot Hidden",
        50,
        "notice the hidden attacker",
        bonus=1,
    )
    assert outcome == "extreme"
    assert record["roll"] == 6
    assert record["tens_values"] == [6, 0]
    assert record["units"] == 6
    assert record["effective_modifier"] == {
        "bonus": 1,
        "penalty": 0,
        "net": 1,
    }
    assert record["bonus_die_only_success"] is True
    assert record["excluded_outcome"] == "bonus_die_only_success"
    assert record["unmodified_roll"] == 66
    pending_rolls, pending_events = session.drain_pending()
    assert pending_rolls == [record]
    assert pending_events == []

    state_path = (
        campaign_ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{investigator_id}.json"
    )
    legacy_tick_path = (
        campaign_ws["coc_root"]
        / "investigators"
        / investigator_id
        / "development.jsonl"
    )
    state_before = state_path.read_bytes()
    legacy_before = legacy_tick_path.read_bytes()
    ctx = coc_toolbox.Ctx(campaign_ws["workspace"], campaign_ws["campaign_id"])
    recorded = coc_toolbox._record_combat_improvement_ticks(
        ctx,
        investigator_id=investigator_id,
        events=[{"event_type": "combat_roll", **pending_rolls[0]}],
    )
    assert recorded == []
    assert state_path.read_bytes() == state_before
    assert legacy_tick_path.read_bytes() == legacy_before

    natural = coc_combat.CombatSession(
        "combat-natural-bonus-order",
        "scene/bonus-tick",
        0,
        random.Random(5),
    )
    natural.add_participant(
        investigator_id,
        "investigator",
        dex=50,
        combat_skill=50,
        build=0,
        hp_max=10,
    )
    natural_outcome, natural_record = natural._percentile(
        investigator_id,
        "Spot Hidden",
        50,
        "notice without needing the bonus die",
        bonus=1,
    )
    assert natural_outcome == "regular"
    assert natural_record["tens_values"] == [4, 5]
    assert natural_record["units"] == 9
    assert natural_record["roll"] == 49
    assert natural_record["unmodified_roll"] == 49
    assert natural_record["bonus_die_only_success"] is False
    assert natural_record["excluded_outcome"] is None
    assert coc_toolbox.coc_development.skill_tick_eligible(
        "Spot Hidden", natural_record
    ) is True
