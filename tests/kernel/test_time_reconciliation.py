"""§142.3 / §142.4: a time skip the host read in a delivery, held against the kernel's own clock.

The kernel reads no prose: the host sends `time_reading` only when Jev read a cut (§142.2). Table npc-acts-b2, turn 8,
is the case: the prose left at closing time and came back "the next morning"; the clock read 1920-10-12 10:00 with no
time landed. The Haunting opens at that same reading.
"""

from conftest import campaign_dir, open_turn, read_json, read_jsonl

TEXT = "你出门时身后的门慢慢合上。夜里没有别的事。第二天早上你回到这条街口，剪报室的灯已经亮了。"


def reading(cut="next_day", floor=240, ends_at="morning", refusable=True, confidence=0.98):
    return {"cut": cut, "confidence": confidence, "floor": floor, "refusable": refusable,
            **({"ends_at": ends_at} if ends_at else {})}


def deliver(client, call_id, **params):
    return client.table("narrate", call_id=call_id, text=TEXT, **params)


def refuse(client, call_id, **params):
    return client.table_err("narrate", call_id=call_id, text=TEXT, **params)


def record(client, turn=1):
    return read_json(campaign_dir(client.workspace) / "turns" / f"{turn:04d}.json")


def time_rows(client):
    return [row for row in read_jsonl(campaign_dir(client.workspace) / "telemetry.jsonl") if row.get("reason") == "time_unrecorded"]


def time_warnings(rec):
    return [row for row in rec.get("warnings") or [] if row.get("kind") == "time_unrecorded"]


def test_a_skip_with_no_time_is_refused_once_with_the_call_that_closes_it(kernel):
    open_turn(kernel)
    error = refuse(kernel, "t1-c1", time_reading=reading())
    assert error["code"] == "needs"
    details = error["details"]
    assert details["reason"] == "time_unrecorded" and details["cut"] == "next_day" and details["ends_at"] == "morning"
    assert details["landed_minutes"] == 0 and details["floor"] == 240
    assert details["clock"] == {"at": "1920-10-12T10:00", "day_part": "morning"}
    assert details["suggest"] == {"until": {"days": 1, "time": "08:00"}}
    assert "apply time" in error["fix"] and "until" in error["message"]
    assert read_json(campaign_dir(kernel.workspace) / "turn.json")["time_gate"] == {"call_id": "t1-c1"}
    assert [(row["ok"], row["outcome"]) for row in time_rows(kernel)] == [(False, "refused")]
    # The gate is spent: the same skip again goes out, with the finding on the record.
    deliver(kernel, "t1-c2", time_reading=reading())
    warnings = time_warnings(record(kernel))
    assert len(warnings) == 1 and warnings[0]["lane"] == "delivery" and warnings[0]["cut"] == "next_day"
    assert warnings[0]["suggest"] == {"until": {"days": 1, "time": "08:00"}} and "apply time" in warnings[0]["fix"]
    assert [(row["ok"], row["outcome"]) for row in time_rows(kernel)] == [(False, "refused"), (True, "delivered")]


def test_not_refusable_goes_out_with_the_finding(kernel):
    open_turn(kernel)
    deliver(kernel, "t1-c1", time_reading=reading(refusable=False))
    assert len(time_warnings(record(kernel))) == 1
    assert "time_gate" not in read_json(campaign_dir(kernel.workspace) / "turn.json")


def test_too_little_time_is_a_gap(kernel):
    """Turn 8's own number: fifteen minutes for a night."""
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 15}])
    error = refuse(kernel, "t1-c2", time_reading=reading())
    assert error["details"]["landed_minutes"] == 15


def test_enough_minutes_to_the_wrong_part_of_the_day_is_a_gap(kernel):
    """Six hours from 10:00 is 16:00, the afternoon; the prose is in the next morning: two parts away."""
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 360}])
    error = refuse(kernel, "t1-c2", time_reading=reading())
    assert error["details"]["landed_minutes"] == 360 and error["details"]["clock"]["day_part"] == "afternoon"


def test_a_neighbouring_day_part_is_not_a_gap(kernel):
    """16:40 is afternoon; prose that ends in the evening is next to it (probe: s02-cont-t2 turn 15)."""
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 400}])
    deliver(kernel, "t1-c2", time_reading=reading(cut="later_today", floor=60, ends_at="evening"))
    assert time_warnings(record(kernel)) == [] and time_rows(kernel) == []


def test_the_suggested_until_closes_the_gap(kernel):
    open_turn(kernel)
    suggest = refuse(kernel, "t1-c1", time_reading=reading())["details"]["suggest"]["until"]
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "time", "until": suggest}])
    deliver(kernel, "t1-c3", time_reading=reading())
    assert time_warnings(record(kernel)) == []
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
    error = refuse(kernel, "t1-c1", time_reading=reading(cut="later_today", floor=60, ends_at="evening"))
    assert error["details"]["suggest"] == {"until": {"days": 0, "time": "18:00"}}


def test_days_suggest_nothing(kernel):
    open_turn(kernel)
    error = refuse(kernel, "t1-c1", time_reading=reading(cut="days", floor=1440, ends_at="morning"))
    assert "suggest" not in error["details"]


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
