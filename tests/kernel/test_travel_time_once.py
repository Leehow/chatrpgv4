"""§156: a move already advances the clock by its journey; a `time` beside it in the same batch is refused unless the
Keeper declares it `beyond_travel`.

2026-09-29, five live driver tables: 8 of 8 `apply` batches that carried a `move` also carried a `time` for the same
trip (move `{to: newspaper-morgue, travel_minutes: 30}` + time `{minutes: 30, why: 从诺特办公室到环球报馆的路程}`), and the
event log showed two `time-advanced` rows per trip. The guard is structural: it never reads `why` or compares minutes.
The Haunting's roads out of Knott's office carry 30 minutes; the clock opens at 1920-10-12 10:00.
"""

from conftest import OPENING_SCENE, campaign_dir, open_turn, read_json, read_jsonl

ROAD = 30  # every road out of commission-briefing in the shipped graph


def clock(client):
    return read_json(campaign_dir(client.workspace) / "world.json")["clock"]["minutes"]


def scene(client):
    return read_json(campaign_dir(client.workspace) / "world.json")["active_scene"]


def time_rows(client):
    return [e["data"] for e in read_jsonl(campaign_dir(client.workspace) / "events.jsonl") if e["type"] == "time-advanced"]


def receipts(client):
    return client.table("status")["receipts"]


def refused(client, call_id, effects):
    error = client.table_err("apply", call_id=call_id, effects=effects)
    assert error["code"] == "invalid_params", error
    assert error["details"]["reason"] == "travel_time_duplicated", error
    # the whole batch is refused: nothing written
    assert clock(client) == 0 and scene(client) == OPENING_SCENE and receipts(client) == [] and time_rows(client) == []
    return error


def test_a_time_beside_a_travelling_move_is_refused_with_a_literal_fix(kernel):
    open_turn(kernel)
    error = refused(kernel, "t1-c1", [{"kind": "move", "to": "newspaper-morgue", "travel_minutes": 30},
                                      {"kind": "time", "minutes": 30, "why": "从诺特办公室到环球报馆的路程"}])
    assert error["details"]["index"] == 1
    assert error["details"]["field"] == "beyond_travel"
    assert error["details"]["minutes"] == 30 and error["details"]["travel_minutes"] == 30
    assert error["details"]["moves"] == [{"index": 0, "to": "newspaper-morgue", "minutes": 30}]
    assert error["fix"].startswith("Remove this time effect and send the batch again")
    assert "beyond_travel: true" in error["fix"]


def test_the_edge_default_travel_counts_and_order_does_not_matter(kernel):
    """No travel_minutes: the road's 30 minutes drive the clock, so the guard reads the staged move, not the field."""
    open_turn(kernel)
    error = refused(kernel, "t1-c1", [{"kind": "time", "minutes": 45}, {"kind": "move", "to": "hall-of-records"}])
    assert error["details"]["index"] == 0 and error["details"]["travel_minutes"] == ROAD


def test_amounts_the_kernel_binds_are_guarded_too(kernel):
    """A banded time is still minutes added (the band row is rolled by the kernel)."""
    open_turn(kernel)
    refused(kernel, "t1-c1", [{"kind": "move", "to": "newspaper-morgue"}, {"kind": "time", "band": "single_room_search"}])


def test_an_until_before_the_move_is_guarded(kernel):
    open_turn(kernel)
    refused(kernel, "t1-c1", [{"kind": "time", "until": {"days": 0, "time": "11:00"}}, {"kind": "move", "to": "newspaper-morgue"}])


def test_beyond_travel_lands_and_the_clock_advances_by_both(kernel):
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[
        {"kind": "move", "to": "newspaper-morgue", "travel_minutes": 30},
        {"kind": "time", "minutes": 45, "why": "翻旧报纸", "beyond_travel": True}])
    assert clock(kernel) == 75 and scene(kernel) == "newspaper-morgue"
    time = [r for r in receipts(kernel) if r["kind"] == "time"]
    assert len(time) == 1 and time[0]["minutes"] == 45 and time[0]["beyond_travel"] is True
    assert [(row["minutes"], row["why"]) for row in time_rows(kernel)] == [(30, "travel"), (45, "翻旧报纸")]


def test_a_move_alone_advances_once(kernel):
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "move", "to": "newspaper-morgue"}])
    assert clock(kernel) == ROAD
    assert [(row["minutes"], row["why"]) for row in time_rows(kernel)] == [(ROAD, "travel")]


def test_a_time_alone_is_unchanged(kernel):
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 20}])
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "time", "minutes": 5, "beyond_travel": True}])
    assert clock(kernel) == 25
    time = [r for r in receipts(kernel) if r["kind"] == "time"]
    assert "beyond_travel" not in time[0] and time[1]["beyond_travel"] is True


def test_forms_that_add_no_elapsed_time_are_not_refused(kernel):
    open_turn(kernel)
    # zero minutes beside a travelling move
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "move", "to": "newspaper-morgue"}, {"kind": "time", "minutes": 0}])
    assert clock(kernel) == ROAD
    # a move that travels no minutes: the time is the only clock movement
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "move", "to": "central-library", "travel_minutes": 0},
                                                   {"kind": "time", "minutes": 20}])
    assert clock(kernel) == ROAD + 20
    # a rename in place moves nothing
    kernel.table("apply", call_id="t1-c3", effects=[{"kind": "move", "to": "central-library", "label": "中央图书馆"},
                                                   {"kind": "time", "minutes": 10}])
    assert clock(kernel) == ROAD + 30
    # `until` after the move names the moment reached, counted from the arrival: it cannot repeat the journey
    kernel.table("apply", call_id="t1-c4", effects=[{"kind": "move", "to": "hall-of-records"},
                                                   {"kind": "time", "until": {"days": 0, "time": "12:00"}}])
    assert clock(kernel) == 120 and scene(kernel) == "hall-of-records"


def test_the_clerk_s_separate_time_write_after_a_move_still_lands(kernel):
    """Host paths write one candidate per apply (runtime/jev/candidates.ts `keeperCall`): the clerk's banded time for
    the declared action is its own call after the move's, never the same batch, so the per-batch guard leaves it be."""
    open_turn(kernel)
    kernel.table("apply", call_id="t1-c1", effects=[{"kind": "move", "to": "newspaper-morgue"}])
    kernel.table("apply", call_id="t1-c2", effects=[{"kind": "time", "band": "single_room_search", "why": "the clerk's band"}])
    assert clock(kernel) > ROAD


def test_beyond_travel_must_be_a_boolean(kernel):
    open_turn(kernel)
    error = kernel.table_err("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 5, "beyond_travel": "yes"}])
    assert error["code"] == "invalid_params" and error["details"]["reason"] == "beyond_travel_invalid"
    assert clock(kernel) == 0
