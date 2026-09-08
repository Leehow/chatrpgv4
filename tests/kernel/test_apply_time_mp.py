"""Product-path coverage for defect #75: time advancing gave away free Magic
points. `tests/kernel/engines/test_mp.py` proves the engine fix
(`kernel/coc/rules/mp.py::MPool.regen_mp`) in isolation; these tests drive the
same fix through the real `apply` seam (`kernel.table("apply", ...)`, a
subprocess RPC call to `python -m coc.rpc`, exactly like a keeper would) and
read the result back off the party sheet, the way `tests/kernel/test_apply.py`
already does for HP/MP rest recovery (see its
`test_magic_points_come_back_over_an_hour_of_rest`, which this file does not
duplicate or modify).

Important finding, not something this file can fix: `kernel/coc/table.py`'s
`_stage_recovery` gates the MP engine behind `minutes >= MP_REGEN_MINUTES`
(60) checked against EACH `apply` call's own total, not against real elapsed
time across calls. That means a single `apply` call under an hour never
reaches `mp_time_trigger` at all, and two separate sub-hour `apply` calls
never accumulate through this seam even though the engine's own banked
remainder (proven in `test_mp.py`) would sum them correctly if it were ever
asked to. `test_apply_time_two_separate_thirty_minute_advances_do_not_yet_accumulate`
below pins that current, known gap; the ticket owner asked for it to be
reported rather than fixed here (`table.py` is out of this change's scope).
"""

from __future__ import annotations

import json

from conftest import campaign_dir, open_turn, read_json

PREGEN_ID = "thomas-hayes"
# thomas-hayes: POW 55 -> mp_max == derived.MP == 55 // 5 == 11, regen_per_hour == 1
# (POW <= 100, the default tier from content/rulesets/coc7/rules-json/spells.json's
# mp_economy -- untouched by this change).


def _sheet_path(kernel):
    return campaign_dir(kernel.workspace) / "party" / f"{PREGEN_ID}.json"


def _set_current_mp(kernel, value: int) -> None:
    path = _sheet_path(kernel)
    sheet = read_json(path)
    sheet["current_mp"] = value
    path.write_text(json.dumps(sheet, ensure_ascii=False), encoding="utf-8")


def _mp_recovered(result: dict) -> list[dict]:
    return [row for row in result.get("recovered") or [] if row["resource"] == "mp"]


def test_apply_time_five_minutes_leaves_mp_untouched(kernel):
    """A keeper who advances the clock by 5 minutes must never see MP appear
    from nowhere -- defect #75's exact repro shape ("KP 推进 5 分钟").

    This assertion currently holds at the `apply` boundary regardless of the
    `mp.py` fix, because `table.py` already refuses to call into the MP
    engine at all below 60 minutes in a single call (see this file's module
    docstring). Reverting the fix in `regen_mp` alone will NOT turn this test
    red -- the fix-sensitive version of "5 minutes changes nothing" is
    `tests/kernel/engines/test_mp.py::test_regen_under_an_hour_gains_nothing_yet`,
    which calls the engine directly and bypasses this outer gate. This test
    still earns its place: it pins the end-to-end guarantee a keeper actually
    experiences, at the real product seam.
    """
    open_turn(kernel)
    _set_current_mp(kernel, 3)

    result = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 5}])
    assert "recovered" not in result
    assert read_json(_sheet_path(kernel))["current_mp"] == 3


def test_apply_time_sixty_minutes_grants_exactly_one_point(kernel):
    """60 minutes is both the rulebook's unit (Chapter 10: one Magic point
    per hour) and `table.py`'s own `MP_REGEN_MINUTES` threshold, so it is the
    smallest single `apply` call that reaches the MP engine at all. This is a
    baseline wiring check, not the fix-sensitive assertion -- 90 minutes
    below is where the fix and the old rounding actually disagree.
    """
    open_turn(kernel)
    _set_current_mp(kernel, 0)

    result = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 60}])
    regained = _mp_recovered(result)
    assert regained and regained[0]["before"] == 0 and regained[0]["after"] == 1
    assert read_json(_sheet_path(kernel))["current_mp"] == 1


def test_apply_time_ninety_minutes_grants_one_point_not_a_rounded_two(kernel):
    """90 minutes is 1.5 hours: exactly one whole hour paid out, and 30
    minutes banked for next time (Chapter 10 states the rate per whole hour,
    not as a continuously accruing fraction -- see `regen_mp`'s docstring).

    The OLD code (`int(round(regen_per_hour * hours))`, no banking) computed
    `round(1 * 1.5)` = 2 via Python's round-half-to-even, inventing a second
    point 30 minutes early. Revert the fix in `kernel/coc/rules/mp.py` and
    this goes red (`after` becomes 2, not 1) -- this is the mutation-killing
    assertion for the fix, reached through the real `apply` seam rather than
    the engine directly.
    """
    open_turn(kernel)
    _set_current_mp(kernel, 0)

    result = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 90}])
    regained = _mp_recovered(result)
    assert regained and regained[0]["before"] == 0 and regained[0]["after"] == 1
    assert read_json(_sheet_path(kernel))["current_mp"] == 1


def test_apply_time_two_separate_thirty_minute_advances_do_not_yet_accumulate(kernel):
    """KNOWN GAP -- see this file's module docstring and the task report;
    `table.py` is out of scope for this change and its owner was asked to
    rule on it.

    The engine's banked remainder DOES correctly sum two 30-minute
    advances into +1 when it is actually invoked twice
    (`tests/kernel/engines/test_mp.py::test_regen_banked_minutes_pay_out_once_an_hour_completes`
    and `::test_regen_remainder_survives_save_and_load` prove this with a
    save/load round trip, exactly how `handle_time_trigger` is really
    called). But two separate `apply` calls of 30 minutes each -- a keeper
    narrating two half-hour turns, i.e. defect #75's "20 turns of 5 minutes"
    scenario writ larger -- never reach the MP engine at all, because
    `_stage_recovery` re-checks `minutes >= MP_REGEN_MINUTES` against EACH
    call's own total, not against real elapsed time across calls. This test
    pins that CURRENT reality; it is not an endorsement of it, and a future
    change to `table.py` should have to touch this test consciously rather
    than silently start passing (or failing) it.
    """
    open_turn(kernel)
    _set_current_mp(kernel, 0)

    first = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 30}])
    assert "recovered" not in first
    second = kernel.table("apply", call_id="t1-c2", effects=[{"kind": "time", "minutes": 30}])
    assert "recovered" not in second
    assert read_json(_sheet_path(kernel))["current_mp"] == 0


def test_apply_time_long_rest_never_exceeds_the_pow_over_five_ceiling(kernel):
    """Chapter 10: "The number of Magic points cannot regenerate to a value
    above one-fifth of the character's POW." A very long advance (10 hours,
    worth 10 points at 1/hr) must still stop at mp_max (11 for POW 55), not
    overshoot it -- whether it is `MPool`'s own cap or `table.py`'s outer
    `restore()` ceiling that actually stops it.
    """
    open_turn(kernel)
    _set_current_mp(kernel, 9)  # mp_max is 11 (POW 55 // 5)

    result = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "time", "minutes": 600}])
    regained = _mp_recovered(result)
    assert regained and regained[0]["before"] == 9 and regained[0]["after"] == 11
    assert read_json(_sheet_path(kernel))["current_mp"] == 11
