"""#77: p.168's one-fifth rule is *one game day*, and nothing on the product path ever closed
a day. `SanitySession.end_day()` was right and had three unit tests that called it directly,
which is exactly why the missing caller was never noticed: `daily_san_lost` counted from the
campaign's first minute against the opening SAN, and an investigator at 55 went indefinitely
insane on the fifteenth point lost, whether that took one night or twenty scenes.

These tests never touch the engine. The clock moves through `table.apply` (time and travel),
SAN is lost through `table.resolve` (`sanity:check`), and the assertions read back what the
table projects (`apply`'s result, `table.view`'s clock, the resolve outcome) and what it
persisted (`save/sanity-state/<inv>.json`)."""


from conftest import CAMPAIGN, campaign_dir, open_turn, read_json
from test_rules_families import resolve


INVESTIGATOR = "thomas-hayes"
OPENING_SAN = 55
#: The Haunting opens at 1920-10-12T10:00 (`start_clock.local_datetime`), so its first
#: midnight is fourteen hours in.
TO_MIDNIGHT = 14 * 60
DAY = 24 * 60


def snapshot(client):
    return read_json(campaign_dir(client.workspace) / "save" / "sanity-state" / f"{INVESTIGATOR}.json")


def clock_at(client):
    return client.ok("table.view", {"campaign": CAMPAIGN})["clock"]["at"]


def advance(client, call_id, minutes):
    return client.table("apply", call_id=call_id, effects=[{"kind": "time", "minutes": minutes}])


def lose(client, call_id, points):
    """A SAN check that costs the same whether the roll passes or fails (`X/X`), so the day's
    arithmetic is exact on an unseeded kernel."""
    outcome = resolve(client, call_id, intent="investigate", goal="又一样不该看见的东西", method="",
                      decision="sanity:check", san_loss=f"{points}/{points}", involuntary="freeze")["outcome"]
    assert outcome["san_loss"] == points
    return outcome


def test_midnight_closes_the_sanity_day(kernel):
    """The day ends where `where.clock.at` turns its date over, not a minute before: the
    counter is zeroed and the one-fifth threshold re-anchored to the SAN the new day starts with."""
    open_turn(kernel)
    lose(kernel, "t1-c1", 3)
    state = snapshot(kernel)
    assert (state["daily_san_lost"], state["day_start_san"]) == (3, OPENING_SAN)

    late = advance(kernel, "t1-c2", TO_MIDNIGHT - 1)
    assert clock_at(kernel) == "1920-10-12T23:59"
    assert "day_ended" not in late
    state = snapshot(kernel)
    assert (state["daily_san_lost"], state["day_start_san"]) == (3, OPENING_SAN)

    midnight = advance(kernel, "t1-c3", 1)
    assert clock_at(kernel) == "1920-10-13T00:00"
    assert midnight["day_ended"] == {"days": 1, "sanity": [
        {"investigator": INVESTIGATOR, "day_start_san": OPENING_SAN - 3, "went_indefinitely_insane": False}]}
    state = snapshot(kernel)
    assert (state["daily_san_lost"], state["day_start_san"]) == (0, OPENING_SAN - 3)
    closed = [e for e in state["events"] if e["type"] == "day_ended"]
    assert len(closed) == 1
    assert closed[0]["payload"] == {**closed[0]["payload"], "daily_san_lost": 3, "threshold": 11,
                                    "day_start_san": OPENING_SAN, "next_day_start_san": OPENING_SAN - 3,
                                    "indefinite_insanity_triggered": False}


def test_travel_across_midnight_ends_the_day_though_it_is_no_rest(kernel):
    """`_stage_recovery` rightly says nobody heals while driving; the calendar does not care.
    A move whose travel minutes carry the party past midnight closes the day like rest does."""
    open_turn(kernel)
    lose(kernel, "t1-c1", 3)
    driven = kernel.table("apply", call_id="t1-c2", effects=[{"kind": "move", "to": "Hall of Records",
                                                              "travel_minutes": TO_MIDNIGHT + 30}])
    assert clock_at(kernel) == "1920-10-13T00:30"
    assert driven["day_ended"]["days"] == 1
    assert (snapshot(kernel)["daily_san_lost"], snapshot(kernel)["day_start_san"]) == (0, OPENING_SAN - 3)


def test_a_fifth_lost_within_one_day_is_indefinite_insanity(kernel):
    """55 opening SAN: the threshold is 11 (a fifth of current SAN as the day starts, p.168),
    and the twelfth point lost before midnight crosses it."""
    open_turn(kernel)
    for n in (1, 2, 3):
        assert lose(kernel, f"t1-c{n}", 3)["indefinite_insane"] is False
    fourth = lose(kernel, "t1-c4", 3)
    assert fourth["indefinite_insane"] is True and fourth["san_after"] == OPENING_SAN - 12
    assert snapshot(kernel)["indefinite_insane"] is True


def test_the_same_loss_spread_over_days_never_reaches_a_fifth(kernel):
    """The defect itself. Nine points on the first day, six on the second, six on the third:
    twenty-one lost in all and never a fifth of any day's starting SAN -- the fourth check
    used to tip the investigator over because the count had never been reset. The threshold
    moves with the days too: on the third day it is a fifth of 40, so nine points that day do it."""
    open_turn(kernel)
    n = 1
    for _ in range(3):  # day one: 9 of 55 (threshold 11)
        assert lose(kernel, f"t1-c{n}", 3)["indefinite_insane"] is False
        n += 1
    advance(kernel, f"t1-c{n}", TO_MIDNIGHT)
    n += 1
    assert snapshot(kernel)["day_start_san"] == OPENING_SAN - 9
    for _ in range(2):  # day two: 6 of 46 (threshold 9); 15 lost in all
        assert lose(kernel, f"t1-c{n}", 3)["indefinite_insane"] is False
        n += 1
    advance(kernel, f"t1-c{n}", DAY)
    n += 1
    assert snapshot(kernel)["day_start_san"] == OPENING_SAN - 15
    for _ in range(2):  # day three: 6 of 40 (threshold 8); 21 lost in all
        assert lose(kernel, f"t1-c{n}", 3)["indefinite_insane"] is False
        n += 1
    state = snapshot(kernel)
    assert state["indefinite_insane"] is False and state["san_current"] == OPENING_SAN - 21
    assert (state["daily_san_lost"], state["day_start_san"]) == (6, OPENING_SAN - 15)
    # A fifth of *this* day's 40 is 8, not the opening day's 11: the ninth point today does it.
    assert lose(kernel, f"t1-c{n}", 3)["indefinite_insane"] is True


def test_one_advance_across_several_midnights_closes_each_day_in_turn(kernel):
    """The ruling for a long advance: three midnights are three closes. Nothing can move SAN
    inside an advance, so only the first close has anything to judge (the three points of the
    day being left); the other two meet a zero counter and re-anchor to the same SAN. The
    state is what one close would leave, and the record says three days passed."""
    open_turn(kernel)
    lose(kernel, "t1-c1", 3)
    skipped = advance(kernel, "t1-c2", 3 * DAY)
    assert clock_at(kernel) == "1920-10-15T10:00"
    assert skipped["day_ended"] == {"days": 3, "sanity": [
        {"investigator": INVESTIGATOR, "day_start_san": OPENING_SAN - 3, "went_indefinitely_insane": False}]}
    state = snapshot(kernel)
    assert (state["daily_san_lost"], state["day_start_san"], state["indefinite_insane"]) == (0, OPENING_SAN - 3, False)
    judged = [e["payload"]["daily_san_lost"] for e in state["events"] if e["type"] == "day_ended"]
    assert judged == [3, 0, 0]
    # The new day's threshold is a fifth of 52 -- ten -- and three more points are not it.
    assert lose(kernel, "t1-c3", 3)["indefinite_insane"] is False


def test_an_investigator_who_has_lost_nothing_is_not_given_a_snapshot_by_midnight(kernel):
    """Closing a day someone has not lost anything in would only write a file whose
    `day_start_san` the first real load seeds from the sheet anyway."""
    open_turn(kernel)
    passed = advance(kernel, "t1-c1", TO_MIDNIGHT)
    assert passed["day_ended"] == {"days": 1, "sanity": []}
    assert not (campaign_dir(kernel.workspace) / "save" / "sanity-state" / f"{INVESTIGATOR}.json").exists()
    lose(kernel, "t1-c2", 3)
    assert (snapshot(kernel)["daily_san_lost"], snapshot(kernel)["day_start_san"]) == (3, OPENING_SAN)
