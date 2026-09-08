"""#76: downtime healing through the real table.

`apply` with `time` effects reaches `_stage_recovery` (gated by `REST_MINUTES`), which hands
the batch's minutes to `healing.handle_time_trigger`. That function counted a day as 480
minutes and cut every rest to seven of them, so one night healed three days and a month in
hospital healed a week. The rulebook's units (Keeper Rulebook, Wounds and Healing, p.121):
with no major wound "the character recovers 1 hit point per day"; with one, "a CON roll should
be made at the end of each week of game time that the Major Wound box is ticked".

What the table lets a test see is hit points: the `recovered` rows, the `delta:hp` receipt,
the sheet. A weekly CON roll that fails leaves no receipt (`restore` only mints one when HP
moved), so the day conversions are pinned outright and the weekly roll is pinned under a locked
seed (`COC_KERNEL_SEED`, §15.1) by what its dice do. Seed 4's first recovery roll succeeds.
"""

import pytest
from conftest import RpcClient, campaign_dir, open_turn, read_json

#: the-haunting's pregen: HP 12, CON 55. Half maximum is 6, so one blow of six or more is a
#: major wound (the table's own triage, `apply_wound_conditions`), and anything under it is not.
INVESTIGATOR = "thomas-hayes"
DAY = 24 * 60
WEEK = 7 * DAY


def sheet(client):
    return read_json(campaign_dir(client.workspace) / "party" / f"{INVESTIGATOR}.json")


def hp(client):
    return client.table("look", focus="investigator")["hp"]


def hp_rows(result):
    return [row for row in result.get("recovered") or [] if row["resource"] == "hp"]


def hurt(client, call_id, points):
    """One blow of exactly `points` (a `1D1+n` roll): deterministic damage on the real path."""
    return client.table("apply", call_id=call_id,
                        effects=[{"kind": "damage", "dice": f"1D1+{points - 1}", "why": "从楼梯上摔下来"}])


def rest(client, call_id, minutes):
    return client.table("apply", call_id=call_id, effects=[{"kind": "time", "minutes": minutes, "why": "静养"}])


def test_a_day_of_rest_is_one_hit_point_not_three(kernel):
    open_turn(kernel)
    hurt(kernel, "t1-c1", 4)
    assert hp(kernel) == 8 and "major_wound" not in sheet(kernel)["conditions"]
    rested = rest(kernel, "t1-c2", DAY)
    assert hp(kernel) == 9
    assert hp_rows(rested) == [{"investigator": INVESTIGATOR, "resource": "hp", "before": 8, "after": 9}]
    assert any(r.startswith("delta:hp-t1") for r in rested["receipts"])


def test_the_day_turns_at_twenty_four_hours(kernel):
    """Anything from six hours up to a full day is the one night's rest the table heals for;
    the second hit point comes with the second full day, not with the second eight hours."""
    open_turn(kernel)
    hurt(kernel, "t1-c1", 4)
    rest(kernel, "t1-c2", 2 * DAY - 1)
    assert hp(kernel) == 9
    rest(kernel, "t1-c3", 2 * DAY)
    assert hp(kernel) == 11


def test_a_week_of_rest_is_seven_hit_points(kernel):
    open_turn(kernel)
    hurt(kernel, "t1-c1", 5)
    hurt(kernel, "t1-c2", 5)  # two blows, each under half maximum: no major wound
    assert hp(kernel) == 2 and "major_wound" not in sheet(kernel)["conditions"]
    rested = rest(kernel, "t1-c3", WEEK)
    assert hp(kernel) == 9
    assert hp_rows(rested) == [{"investigator": INVESTIGATOR, "resource": "hp", "before": 2, "after": 9}]


def test_a_month_of_rest_is_as_long_as_the_month(kernel):
    """Thirty days heal thirty days (to the ceiling), not the seven the cap left."""
    open_turn(kernel)
    hurt(kernel, "t1-c1", 5)
    hurt(kernel, "t1-c2", 5)
    rested = rest(kernel, "t1-c3", 30 * DAY)
    assert hp(kernel) == 12
    assert hp_rows(rested) == [{"investigator": INVESTIGATOR, "resource": "hp", "before": 2, "after": 12}]


def test_a_major_wound_gets_no_weekly_roll_from_two_days_and_a_third(seeded_four):
    """3360 minutes was seven of the old 480-minute days, and seven days rolled the weekly CON.
    It is two days and eight hours: no week has ended, so no roll — and no per-day healing
    either, because the box is ticked. On seed 4 the first recovery roll succeeds (the
    three-week test below stands on the same fact), so a roll made here would show as HP."""
    kernel = seeded_four
    open_turn(kernel)
    hurt(kernel, "t1-c1", 8)
    assert hp(kernel) == 4 and "major_wound" in sheet(kernel)["conditions"]
    rested = rest(kernel, "t1-c2", 3360)
    assert "recovered" not in rested
    assert not [r for r in rested["receipts"] if r.startswith("delta:hp")]
    assert hp(kernel) == 4
    assert "major_wound" in sheet(kernel)["conditions"]


@pytest.fixture
def same_dice(tmp_path):
    """Two tables on one locked seed draw the same dice in the same order, so what differs
    between them is only what the test does differently."""
    tables = [RpcClient(tmp_path / f"ws{n}", env={"COC_KERNEL_SEED": "4"}) for n in (1, 2)]
    yield tables
    for table in tables:
        table.close()


def test_three_weeks_with_a_major_wound_roll_three_times(same_dice):
    """One advance of three weeks makes three weekly CON rolls. The old code made one — its
    days were capped at seven, and seven of them were one week — and healed nothing for the
    fortnight after. Two tables on the same dice: after one week each has rolled once; after
    three weeks the longer stay has rolled twice more, and stands higher. (Seed 4: the first
    roll heals +3, from 1 to 4; the three-week stay goes on to the ceiling.)"""
    one_week, three_weeks = same_dice
    for table in (one_week, three_weeks):
        open_turn(table)
        hurt(table, "t1-c1", 11)
        assert hp(table) == 1 and "major_wound" in sheet(table)["conditions"]
    rest(one_week, "t1-c2", WEEK)
    rested = rest(three_weeks, "t1-c2", 3 * WEEK)
    assert hp(one_week) > 1, "seed 4: the first week's recovery roll succeeds"
    assert hp(three_weeks) > hp(one_week)
    assert hp_rows(rested) == [{"investigator": INVESTIGATOR, "resource": "hp", "before": 1, "after": hp(three_weeks)}]
