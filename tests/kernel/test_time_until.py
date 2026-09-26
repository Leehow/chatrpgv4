"""§142.1: `apply time {until: {days, time}}` -- the Keeper names the time the fiction reaches, the kernel counts.

Table npc-acts-b2, turn 8: the Keeper wrote `minutes: 15` for leaving at closing time and coming back "the next
morning". The Haunting opens at 1920-10-12 10:00, the same reading that table's clock showed all game.
"""

import json
import shutil

from conftest import CONTENT_DIR, RpcClient, campaign_dir, open_turn, read_json

DAY = 24 * 60


def clock(client):
    return client.table("capsule")["where"]["clock"]


def turn_receipts(client):
    return read_json(campaign_dir(client.workspace) / "turn.json")["receipts"]


def time_until(client, call_id, days, time, **extra):
    return client.table("apply", call_id=call_id, effects=[{"kind": "time", "until": {"days": days, "time": time}, **extra}])


def test_until_tomorrow_morning_counts_the_night(kernel):
    open_turn(kernel)
    time_until(kernel, "t1-c1", 1, "08:00", why="出门，第二天早上回来")
    assert clock(kernel) == {"minutes": 22 * 60, "elapsed": "22 h 0 min", "at": "1920-10-13T08:00", "day_part": "morning"}
    receipt = turn_receipts(kernel)[-1]
    assert receipt["kind"] == "time" and receipt["minutes"] == 22 * 60
    assert receipt["until"] == {"days": 1, "time": "08:00"}


def test_until_later_today(kernel):
    open_turn(kernel)
    time_until(kernel, "t1-c1", 0, "18:30")
    assert clock(kernel)["at"] == "1920-10-12T18:30" and clock(kernel)["minutes"] == 8 * 60 + 30


def test_until_binds_after_the_batch_s_earlier_time(kernel):
    """The base is the staged clock: an hour first, then noon is one more hour, not two."""
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 60},
                                                     {"kind": "time", "until": {"days": 0, "time": "12:00"}}])
    assert clock(kernel)["at"] == "1920-10-12T12:00"
    assert [r["minutes"] for r in turn_receipts(kernel) if r["kind"] == "time"] == [60, 60]


_ids = iter(range(10, 99))


def refused(client, effects, reason):
    error = client.table_err("apply", call_id=f"t1-c{next(_ids)}", effects=effects)
    assert error["code"] == "invalid_params", error
    assert error["details"]["field"] == "until" and error["details"]["reason"] == reason, error
    assert clock(client)["minutes"] == 0  # nothing written
    return error


def test_until_refusals_write_nothing(kernel):
    open_turn(kernel)
    conflict = refused(kernel, [{"kind": "time", "minutes": 30, "until": {"days": 0, "time": "12:00"}}], "until_conflict")
    assert conflict["details"]["fields"] == ["minutes"]
    assert refused(kernel, [{"kind": "time", "stated": "anything", "until": {"days": 0, "time": "12:00"}}],
                   "until_conflict")["details"]["fields"] == ["stated"]
    for bad in ({"days": -1, "time": "08:00"}, {"days": 0, "time": "8:00"}, {"days": 0, "time": "24:00"},
                {"days": 0.5, "time": "08:00"}, {"days": 1}):
        refused(kernel, [{"kind": "time", "until": bad}], "until_invalid")
    early = refused(kernel, [{"kind": "time", "until": {"days": 0, "time": "09:00"}}], "until_not_forward")
    assert early["details"]["clock"] == {"at": "1920-10-12T10:00", "day_part": "morning"}
    assert "days 1" in early["fix"]
    refused(kernel, [{"kind": "damage", "dice": "1D3", "until": {"days": 0, "time": "12:00"}}], "until_none")


def test_days_count_from_the_day_the_turn_began(kernel):
    """Live table time-skip-a, turn 5: the Keeper landed 1050 minutes for the night, then 'corrected' it with
    until {days: 1, time: 10:30}. Counted from the staged clock (already day 2, 03:30) that was day 3; counted from
    the day the turn began it is the next morning the prose told."""
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 1050}])
    assert clock(kernel)["at"] == "1920-10-13T03:30"
    time_until(kernel, "t1-c2", 1, "10:30")
    assert clock(kernel)["at"] == "1920-10-13T10:30"
    assert turn_receipts(kernel)[-1]["minutes"] == 7 * 60


def test_the_same_until_again_lands_nothing(kernel):
    """Within a turn `until` names a time, not an amount: saying it twice leaves the clock where it stands."""
    open_turn(kernel)
    time_until(kernel, "t1-c1", 1, "08:00")
    time_until(kernel, "t1-c2", 1, "08:00")
    assert clock(kernel)["at"] == "1920-10-13T08:00"
    assert [r["minutes"] for r in turn_receipts(kernel) if r["kind"] == "time"] == [22 * 60, 0]


def test_a_later_turn_counts_from_its_own_day(kernel):
    open_turn(kernel)
    time_until(kernel, "t1-c1", 1, "10:30")
    kernel.table("narrate", call_id="t1-c2", text="第二天上午，你到了疗养院。")
    kernel.table("player_input", text="我等到第二天早上再来。")
    time_until(kernel, "t2-c1", 1, "08:00")
    assert clock(kernel)["at"] == "1920-10-14T08:00"


def test_until_replays_the_journaled_receipt(kernel):
    open_turn(kernel)
    first = time_until(kernel, "t1-c1", 1, "08:00")
    again = time_until(kernel, "t1-c1", 1, "08:00")
    assert again["receipts"] == first["receipts"] and again.get("replayed") is True
    assert clock(kernel)["minutes"] == 22 * 60


def test_a_night_by_until_heals_like_the_minutes_would(kernel):
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "damage", "dice": "1D1+3", "why": "摔了一跤"}])
    assert kernel.table("look", focus="investigator")["hp"] == 8
    rested = time_until(kernel, "t1-c2", 1, "08:00")
    assert kernel.table("look", focus="investigator")["hp"] == 9
    assert [row["after"] for row in rested["recovered"] if row["resource"] == "hp"] == [9]


def test_an_undated_clock_binds_the_same_way(tmp_path):
    """A book with no opening date reads day/hh/mm from 09:00 (`clockStart`); `until` counts against that.
    The Haunting with its date removed, as tests/kernel/test_clock_anchor.py derives it."""
    content = tmp_path / "content"
    shutil.copytree(CONTENT_DIR, content)

    def undate(value):
        if isinstance(value, dict):
            value.pop("start_clock", None)
            value.pop("start_time", None)
            for child in value.values():
                undate(child)
        elif isinstance(value, list):
            for child in value:
                undate(child)

    for name in ("module-meta.json", "module-graph.json"):
        path = content / "starters/the-haunting" / name
        if path.exists():
            data = json.loads(path.read_text())
            undate(data)
            path.write_text(json.dumps(data))
    client = RpcClient(tmp_path / "ws", content=content)
    try:
        open_turn(client)
        before = clock(client)
        assert "at" not in before and (before["day"], before["hh"], before["mm"]) == (1, "09", "00"), before
        time_until(client, "t1-c1", 0, "20:00")
        after = clock(client)
        assert (after["day"], after["hh"], after["mm"], after["day_part"]) == (1, "20", "00", "evening")
        time_until(client, "t1-c2", 1, "06:15")
        assert (clock(client)["day"], clock(client)["hh"], clock(client)["mm"]) == (2, "06", "15")
    finally:
        client.close()
