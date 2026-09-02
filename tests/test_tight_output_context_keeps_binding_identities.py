"""An oversized output context may shed bulk, never the binding identities.

`_project_output_context_review_card` is the fallback when the compact output
context does not fit. It dropped `mechanics_summary` outright, which took with
it the three id lists the Pi coverage binding is built from. With no coverage
binding facts, no `turn.finalize` binding is armed; the working set for
`review_ready` then filters finalize and narration.review away and leaves only
the context producer, which cannot advance the turn. The Keeper loops on it.

Seen live on 2026-09-02 in campaign amaranthine-loop: thirty identical
`turn.output_context` calls, then the settled-output recovery exhausted and
the turn was lost. It appeared on the first turn whose context was large
enough to take this path -- six NPC first-impression obligations.
"""
from __future__ import annotations

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_mcp_wire as wire  # noqa: E402


def _oversized_output_context() -> dict:
    return {
        "schema_version": 1,
        "turn_id": "turn-v1-abc",
        "journal_decision_id": "pi-state-journal:d6:player-epoch-4:revision-1",
        "turn_number": 4,
        "source_digest": "sha256:" + "0" * 64,
        "settlement_snapshot_id": "snapshot-1",
        "mechanics_bundle_sha256": "sha256:" + "1" * 64,
        "contract_projection": {"agency_review_required": False},
        "obligations": [{
            "obligation_id": "roll:npc-first-impression-roll-v2:" + "a" * 40,
            "source_kind": "check",
            "source_id": "roll:san-check",
            "visibility": "public",
            "exceptional_required": False,
            "goal": "q" * 4000,
        }],
        "mechanics_bundle": {
            "journal_decision_id": "pi-state-journal:d6:player-epoch-4:revision-1",
            "public_check": [
                {"roll_id": "roll:san-check", "prose": "x" * 4000},
            ],
            "state_delta": [
                {"effect_id": "turn-effect-v1:abc", "narration": "y" * 4000},
            ],
            "exceptional_effect": [
                {"event_id": "event:bout", "detail": "z" * 4000},
            ],
            "concealed_consequence": [{"secret": "w" * 4000}],
        },
    }


def test_the_identities_survive_and_the_bulk_does_not() -> None:
    projected = wire._project_output_context_review_card(_oversized_output_context())
    summary = projected.get("mechanics_summary")
    assert summary is not None, (
        "dropping the summary drops the coverage binding, which strands the "
        "Keeper in review_ready with nothing that can advance the turn"
    )
    assert [row["roll_id"] for row in summary["public_check"]] == ["roll:san-check"]
    assert [row["effect_id"] for row in summary["state_delta"]] == [
        "turn-effect-v1:abc"
    ]
    assert [row["event_id"] for row in summary["exceptional_effect"]] == [
        "event:bout"
    ]

    # The bulk this projection exists to shed is gone.
    rendered = repr(projected)
    assert "x" * 100 not in rendered
    assert "y" * 100 not in rendered
    assert "z" * 100 not in rendered
    assert "w" * 100 not in rendered
    assert summary["concealed_consequence"] == []

    # The obligations travel with them: the binding checks that every public
    # check source belongs to a retained obligation, so keeping the checks
    # while dropping the obligations only moves the failure.
    obligations = projected.get("obligations")
    assert obligations, "the binding cannot match a public check to nothing"
    assert obligations[0]["source_id"] == "roll:san-check"
    assert obligations[0]["exceptional_required"] is False
    assert "goal" not in obligations[0], "obligation prose is bulk, not identity"
    assert "q" * 100 not in repr(projected)


def test_absent_mechanics_stays_absent() -> None:
    context = _oversized_output_context()
    del context["mechanics_bundle"]
    projected = wire._project_output_context_review_card(context)
    # Nothing is invented: a turn that carried no bundle still carries none.
    assert projected.get("mechanics_summary") is None
