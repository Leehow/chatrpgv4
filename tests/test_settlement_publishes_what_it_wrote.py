"""A settlement must name every pool it moved, or it cannot prove its own write.

The rules.settle envelope was shaped for the first graph-owned family
(healing), so it published one hardcoded resource -- `current_hp` -- and
whatever single `event` that family happened to set. Sanity was promoted to
the graph later. A Sanity check that costs SAN therefore produced a state
delta the state-effect authority could not prove: no `current_san`, no
`conditions`, and no primary event carrying `san_before`/`san_after`.

Seen live on 2026-09-02 in campaign amaranthine-loop: the Keeper settled a
Sanity check, `turn.finalize` rejected the turn with `unproven_state_delta`,
the Keeper retried the identical finalize four times, the repeat circuit shut
the turn, and the player received nothing at all. Any Sanity loss -- the most
ordinary thing in Call of Cthulhu -- made a turn undeliverable.
"""
from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_operation_kernel as kernel  # noqa: E402


def _sanity_adapter_row() -> dict:
    """The shape a graph-owned Sanity settlement actually returns."""
    return {
        "schema_version": 1,
        "authority": "canonical-resolver-state-receipts",
        "investigator_id": "inv-thomas-reed-1895",
        "player_state_receipt": {
            "schema_version": 1,
            "investigator_id": "inv-thomas-reed-1895",
            "hp": {"before": 12, "after": 12},
            "san": {"before": 50, "after": 49},
            "conditions_before": [],
            "conditions_after": [],
        },
        "results": [{
            "command_id": "roll-san:command",
            "kind": "sanity_check",
            "status": "completed",
            "events": [
                # The percentile check names the pool too; it is not the
                # proving event, and electing it would be wrong.
                {
                    "roll_id": "roll-san:command",
                    "kind": "sanity_check",
                    "san_before": 50,
                    "san_after": 49,
                },
                {
                    "event_id": "ev-1",
                    "event_type": "sanity",
                    "san_before": 50,
                    "san_after": 49,
                },
                {"event_id": "ev-2", "event_type": "note", "summary": "no pool"},
            ],
        }],
    }


def test_settlement_publishes_the_pool_it_moved() -> None:
    row = _sanity_adapter_row()
    kernel._publish_settled_resources(row, row)
    assert row["current_san"] == 49
    # hp did not move, so the settlement must not claim to have written it.
    assert "current_hp" not in row
    assert row["conditions"] == []
    assert row["event"]["event_type"] == "sanity"


def test_unmoved_pools_are_never_claimed() -> None:
    row = _sanity_adapter_row()
    row["player_state_receipt"]["san"] = {"before": 50, "after": 50}
    kernel._publish_settled_resources(row, row)
    assert "current_san" not in row
    assert row.get("event") is None


def test_an_ambiguous_event_is_left_unelected() -> None:
    row = _sanity_adapter_row()
    row["results"][0]["events"].append(
        {"event_id": "ev-3", "event_type": "sanity", "san_before": 50, "san_after": 49}
    )
    kernel._publish_settled_resources(row, row)
    # The pool is still published -- the receipt says so plainly -- but two
    # equally qualified events mean the settlement cannot say which proves it.
    assert row["current_san"] == 49
    assert row.get("event") is None
