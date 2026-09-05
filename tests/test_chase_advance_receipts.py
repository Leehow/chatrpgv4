"""An advance that did not advance is still a receipt the snapshot must accept.

`_resolve_advance` returns two receipts for a move that goes nowhere: the
location chain ran out, or a live barrier blocks the next location. Neither
moved the actor or spent an action, so neither carries the position keys the
moving contract requires -- and both were validated against that contract and
refused, failing the whole transaction with `chase snapshot turn action
contract is invalid`.

Every slot on decision:coc7:chase:move is host-locked, so the Keeper sends
nothing and nothing it did could have helped: a chase that reached the end of
its chain, or a barrier, simply stopped being settleable. Measured 2026-09-02
r41, the first run in which a chase move got that far.

The key sets stay pinned exactly. This is an audit gate on reload, and a loose
widening would admit a malformed receipt in the name of a legitimate one.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import coc_chase  # noqa: E402

LOCATIONS = [{"label": "corridor"}, {"label": "stairs"}]


def _validate(action):
    return coc_chase._validate_chase_action_receipt(
        action,
        turn_actor="thomas-hayes",
        actor_ids={"thomas-hayes"},
        locations=LOCATIONS,
    )


def test_the_end_of_the_chain_is_a_receipt_the_snapshot_accepts():
    # Verbatim from _resolve_advance.
    # The function returns (roll_ids, new_position, position_before).
    rolls, moved_to, moved_from = _validate(
        {"type": "advance", "result": "end_of_chain", "actions_spent": 0}
    )
    assert rolls == [] and moved_to is None and moved_from is None


def test_a_barrier_blocking_the_next_location_is_too():
    rolls, moved_to, moved_from = _validate({
        "type": "advance",
        "result": "blocked_by_barrier",
        "barrier_id": "cellar-door",
        "actions_spent": 0,
    })
    assert rolls == [] and moved_to is None and moved_from is None


def test_a_move_that_did_move_still_needs_its_position_evidence():
    _rolls, moved_to, moved_from = _validate({
        "type": "advance",
        "position_before": 0,
        "new_position": 1,
        "location_label": "stairs",
        "actions_spent": 1,
    })
    assert (moved_from, moved_to) == (0, 1)


@pytest.mark.parametrize("action", [
    # A non-advance that claims to have spent an action.
    {"type": "advance", "result": "end_of_chain", "actions_spent": 1},
    # ...or carries keys its outcome does not have.
    {"type": "advance", "result": "end_of_chain", "actions_spent": 0,
     "new_position": 1},
    # ...or names an outcome nothing produces.
    {"type": "advance", "result": "teleported", "actions_spent": 0},
    # A blocked advance missing the barrier it was blocked by.
    {"type": "advance", "result": "blocked_by_barrier", "actions_spent": 0},
])
def test_a_receipt_the_engine_never_emits_is_still_refused(action):
    with pytest.raises(ValueError):
        _validate(action)
