"""§145.3 / §145.4: a time skip the host read in a delivery, held against the kernel's own clock.

The kernel reads no prose: the host sends `time_reading` only when Jev read a cut (§145.2). Table npc-acts-b2, turn 8,
is the case: the prose left at closing time and came back "the next morning"; the clock read 1920-10-12 10:00 with no
time landed. The Haunting opens at that same reading.

§166 (owner ruling 2026-10-01) supersedes §145.3's refusal: a prose-implied time gap no longer refuses the delivery.
The first draft goes out, and the gap is the finding §145.3 already kept for a delivery that went out anyway -- one
`time_unrecorded` row on the turn record (with `suggest` when the kernel can name the `until`) and a `lane: "delivery"`
telemetry row with `outcome: "delivered"`. There is no `time_gate` and no same-turn answer: the Keeper acts on the
finding on a later turn (§145.4's `unrecorded`). The detection these tests guard is read from those two records.
"""

from conftest import campaign_dir, open_turn, read_json, read_jsonl

TEXT = "你出门时身后的门慢慢合上。夜里没有别的事。第二天早上你回到这条街口，剪报室的灯已经亮了。"


def reading(cut="next_day", floor=240, ends_at="morning", refusable=True, confidence=0.98):
    return {"cut": cut, "confidence": confidence, "floor": floor, "refusable": refusable,
            **({"ends_at": ends_at} if ends_at else {})}


def deliver(client, call_id, **params):
    return client.table("narrate", call_id=call_id, text=TEXT, **params)


def record(client, turn=1):
    return read_json(campaign_dir(client.workspace) / "turns" / f"{turn:04d}.json")


def time_rows(client):
    return [row for row in read_jsonl(campaign_dir(client.workspace) / "telemetry.jsonl") if row.get("reason") == "time_unrecorded"]


def time_warnings(rec):
    return [row for row in rec.get("warnings") or [] if row.get("kind") == "time_unrecorded"]


def delivered_gap(client, call_id, turn=1, **params):
    """§166: the delivery goes out on its first attempt; returns the gap's finding on the record and its telemetry row."""
    assert deliver(client, call_id, **params)["turn"] == turn
    [warning] = time_warnings(record(client, turn))
    [row] = [row for row in time_rows(client) if row["call_id"] == call_id]
    assert (row["ok"], row["outcome"], row["lane"], row["turn"]) == (True, "delivered", "delivery", turn), row
    return warning, row


def test_a_skip_with_no_time_is_delivered_with_the_finding_that_names_the_call(kernel):
    """§166: no refusal and no `time_gate`; what the refusal carried is on the finding and its telemetry row."""
    open_turn(kernel)
    warning, row = delivered_gap(kernel, "t1-c1", time_reading=reading())
    assert warning["lane"] == "delivery" and warning["quote"] is None
    assert warning["cut"] == "next_day" and warning["ends_at"] == "morning"
    assert warning["suggest"] == {"until": {"days": 1, "time": "08:00"}}
    assert "apply time" in warning["fix"] and "until" in warning["fix"]
    assert "1920-10-12T10:00 (morning)" in warning["why"]
    assert (row["cut"], row["ends_at"], row["landed"], row["floor"], row["day_part"]) == ("next_day", "morning", 0, 240, "morning")
    assert "time_gate" not in read_json(campaign_dir(kernel.workspace) / "turn.json")
    assert [(row["ok"], row["outcome"]) for row in time_rows(kernel)] == [(True, "delivered")]


def test_not_refusable_goes_out_with_the_finding(kernel):
    open_turn(kernel)
    deliver(kernel, "t1-c1", time_reading=reading(refusable=False))
    assert len(time_warnings(record(kernel))) == 1
    assert "time_gate" not in read_json(campaign_dir(kernel.workspace) / "turn.json")


def test_too_little_time_is_a_gap(kernel):
    """Turn 8's own number: fifteen minutes for a night."""
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 15}])
    warning, row = delivered_gap(kernel, "t1-c2", time_reading=reading())
    assert row["landed"] == 15 and row["floor"] == 240 and "15 minutes landed" in warning["why"]


def test_the_suggestion_counts_from_the_day_the_turn_began(kernel):
    """Turn 5's shape: 1050 minutes put the clock at 03:30 the next day; the prose is in the next morning. The
    small hours are two parts from the morning, so it is a gap, and the suggestion is tomorrow as the turn began
    (counted from the staged clock it would have been days 0).

    §166: the delivery closes the turn, so the suggestion can no longer be landed on the turn it was counted for;
    `until` binding from the turn's own day after such a batch is test_time_until.py's
    test_days_count_from_the_day_the_turn_began."""
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 1050}])
    warning, row = delivered_gap(kernel, "t1-c2", time_reading=reading())
    assert row["day_part"] == "small_hours" and row["landed"] == 1050
    assert warning["suggest"] == {"until": {"days": 1, "time": "08:00"}}


def test_enough_minutes_to_the_wrong_part_of_the_day_is_a_gap(kernel):
    """Six hours from 10:00 is 16:00, the afternoon; the prose is in the next morning: two parts away."""
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 360}])
    warning, row = delivered_gap(kernel, "t1-c2", time_reading=reading())
    assert row["landed"] == 360 and row["floor"] == 240 and row["day_part"] == "afternoon"
    assert warning["ends_at"] == "morning"


def test_a_neighbouring_day_part_is_not_a_gap(kernel):
    """16:40 is afternoon; prose that ends in the evening is next to it (probe: s02-cont-t2 turn 15)."""
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 400}])
    deliver(kernel, "t1-c2", time_reading=reading(cut="later_today", floor=60, ends_at="evening"))
    assert time_warnings(record(kernel)) == [] and time_rows(kernel) == []


def test_the_suggested_until_closes_the_gap(kernel):
    """§166: the finding is acted on a turn later. Turn 1 landed no time, so turn 2 begins on the same day and the
    suggestion, landed as `until`, puts the clock where the prose is: the same reading on turn 2 is no gap."""
    open_turn(kernel)
    warning, _ = delivered_gap(kernel, "t1-c1", time_reading=reading())
    suggest = warning["suggest"]["until"]
    kernel.table("player_input", text="我等到天亮再来。")
    kernel.table("apply", call_id="t2-c1", effects=[{"kind": "time", "until": suggest}])
    deliver(kernel, "t2-c2", time_reading=reading())
    assert time_warnings(record(kernel, 2)) == []
    assert [row["turn"] for row in time_rows(kernel)] == [1]
    assert kernel.table("capsule")["where"]["clock"]["at"] == "1920-10-13T08:00"


def test_no_ends_at_checks_the_floor_only(kernel):
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 240}])
    deliver(kernel, "t1-c2", time_reading=reading(ends_at=None))
    assert time_warnings(record(kernel)) == []


def test_travel_minutes_count_as_the_clock_moving(kernel):
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "move", "to": "Hall of Records", "travel_minutes": 90}])
    deliver(kernel, "t1-c2", time_reading=reading(cut="later_today", floor=60, ends_at=None))
    assert time_warnings(record(kernel)) == []


def test_later_today_suggests_today_when_the_part_is_still_ahead(kernel):
    open_turn(kernel)
    warning, _ = delivered_gap(kernel, "t1-c1", time_reading=reading(cut="later_today", floor=60, ends_at="evening"))
    assert warning["suggest"] == {"until": {"days": 0, "time": "18:00"}}


def test_no_suggestion_behind_the_clock(kernel):
    """Ten hours landed (20:00) and prose that ends at midday the same day: a gap, but the clock cannot go back to it,
    so nothing is suggested; counted from the staged clock it would have offered tomorrow's midday."""
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 600}])
    warning, row = delivered_gap(kernel, "t1-c2", time_reading=reading(cut="later_today", floor=60, ends_at="midday"))
    assert row["day_part"] == "evening" and row["landed"] == 600
    assert "suggest" not in warning


def test_days_suggest_nothing(kernel):
    open_turn(kernel)
    warning, row = delivered_gap(kernel, "t1-c1", time_reading=reading(cut="days", floor=1440, ends_at="morning"))
    assert warning["cut"] == "days" and row["floor"] == 1440
    assert "suggest" not in warning


def test_the_gap_stays_in_unrecorded_until_time_lands(kernel):
    open_turn(kernel)
    deliver(kernel, "t1-c1", time_reading=reading(refusable=False))
    capsule = kernel.table("player_input", text="我推门进去。")["capsule"]
    rows = [row for row in capsule["unrecorded"] if row.get("operation") == "apply time"]
    assert len(rows) == 1 and rows[0]["time"] == "next_day" and rows[0]["turn"] == 1 and rows[0]["ends_at"] == "morning"
    assert "1920-10-12T10:00" in rows[0]["line"] and "apply time" in rows[0]["line"]
    assert "three kinds" in capsule["head"]
    # Still there a turn later while nothing lands...
    kernel.table("narrate", call_id="t2-c1", text="阿蒂从柜台后抬起头。")
    capsule = kernel.table("player_input", text="我等着。")["capsule"]
    assert [row["turn"] for row in capsule["unrecorded"] if row.get("operation") == "apply time"] == [1]
    # ...and gone once time lands on a later turn.
    kernel.table("apply", call_id="t3-c1", effects=[{"kind": "time", "until": {"days": 1, "time": "08:00"}}])
    kernel.table("narrate", call_id="t3-c2", text="你在街口等到了天亮。")
    capsule = kernel.table("player_input", text="我进门。")["capsule"]
    assert [row for row in capsule["unrecorded"] if row.get("operation") == "apply time"] == []


def test_the_reading_is_not_part_of_the_call_s_digest(kernel):
    open_turn(kernel)
    first = deliver(kernel, "t1-c1", time_reading=reading(refusable=False))
    again = deliver(kernel, "t1-c1")
    assert again["receipt"] == first["receipt"]


def test_no_reading_changes_nothing(kernel):
    open_turn(kernel)
    deliver(kernel, "t1-c1")
    assert time_warnings(record(kernel)) == [] and time_rows(kernel) == []


def test_a_malformed_reading_is_refused(kernel):
    open_turn(kernel)
    for bad in ({"cut": "short", "confidence": 0.9, "floor": 0, "refusable": True},
                {"cut": "next_day", "confidence": 0.9, "floor": 240, "refusable": True, "ends_at": "teatime"},
                {"cut": "next_day", "confidence": 0.9, "floor": -1, "refusable": True},
                {"cut": "next_day", "confidence": 0.9, "floor": 240}):
        assert kernel.table_err("narrate", call_id="t1-c1", text=TEXT, time_reading=bad)["code"] == "invalid_params"
