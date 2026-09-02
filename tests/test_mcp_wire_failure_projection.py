"""An actionable failure must survive the transport budget.

Observed live on 2026-09-02 in a seeded combat lane: `rules.settle` returned
`rule_decision_stale` — an actionable error naming `rules.context` as the
refresh — inside a 27 KB envelope whose `error.details.refreshed_cards` was
26 KB of it. The bounded projection only ever shrank `data`, so the envelope
could not fit; the last resort then reported `mcp_wire_budget_exceeded` with
the message "the canonical operation succeeded", no next action, and an empty
replay card. The Keeper replayed the same settle, the repeat guard blocked it,
and the turn dead-ended.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import coc_mcp_wire as wire  # noqa: E402


def _stale_settle_envelope(card_count: int = 8) -> dict:
    """A rule_decision_stale failure carrying the whole refreshed card set."""
    card = {
        "schema_version": 1,
        "family": "combat",
        "label": "Combat decision through the existing typed subsystem operation",
        "authority": "canonical-resolver",
        "rule_refs": [f"rule:coc7:combat:{index}" for index in range(40)],
        "prose": "填充" * 400,
    }
    return {
        "ok": False,
        "tool": "rules.settle",
        "error": {
            "code": "rule_decision_stale",
            "message": (
                "no live machine-issued card grant covers this decision; call "
                "rules.context for this family, then settle a decision_ref it "
                "returns"
            ),
            "details": {
                "family": "combat",
                "decision_ref": "decision:coc7:combat:flee",
                "refresh_operation": "rules.context",
                "refreshed_cards": [
                    {**card, "decision_ref": f"decision:coc7:combat:d{index}"}
                    for index in range(card_count)
                ],
            },
        },
        "warnings": [],
        "hints": [],
    }


def _project(envelope: dict) -> dict:
    return wire.project_envelope(
        "rules.settle", envelope, contract_digest="sha256:test",
    )


def _size(value: dict) -> int:
    return len(json.dumps(value, ensure_ascii=False).encode("utf-8"))


def test_an_oversize_failure_keeps_its_own_code_and_remedy():
    envelope = _stale_settle_envelope()
    assert _size(envelope) > wire.MAX_INLINE_BYTES
    projected = _project(envelope)
    assert _size(projected) <= wire.MAX_INLINE_BYTES
    assert projected["ok"] is False
    assert projected["error"]["code"] == "rule_decision_stale"
    details = projected["error"]["details"]
    assert details["refresh_operation"] == "rules.context"
    assert details["family"] == "combat"
    assert details["decision_ref"] == "decision:coc7:combat:flee"


def test_the_bulky_repair_payload_is_summarized_not_dropped():
    projected = _project(_stale_settle_envelope(card_count=8))
    details = projected["error"]["details"]
    assert details["refreshed_cards_count"] == 8
    assert details["refreshed_cards_refs"][:2] == [
        "decision:coc7:combat:d0", "decision:coc7:combat:d1",
    ]
    assert "exceeded the transport budget" in details["refreshed_cards_omitted"]
    assert "refreshed_cards" not in details
    assert projected["wire"]["error_details_bounded"] is True


def test_a_projection_that_still_cannot_fit_never_claims_success():
    """The last resort must not tell the Keeper a failed operation succeeded:
    it replays the same call, and the repeat guard then blocks the only move
    it has left."""
    envelope = _stale_settle_envelope()
    # An error whose own message is pathological: nothing left to bound.
    envelope["error"]["message"] = "巨" * (wire.MAX_INLINE_BYTES // 2)
    projected = _project(envelope)
    assert projected["ok"] is False
    assert projected["error"]["code"] == "mcp_wire_budget_exceeded"
    assert "canonical operation failed" in projected["error"]["message"]
    assert projected["error"]["original_error"]["code"] == "rule_decision_stale"


def test_a_canonical_success_still_reports_success():
    envelope = {
        "ok": True,
        "tool": "rules.settle",
        "data": {"schema_version": 1, "filler": "数" * (wire.MAX_INLINE_BYTES)},
        "warnings": [],
        "hints": [],
    }
    projected = _project(envelope)
    assert _size(projected) <= wire.MAX_INLINE_BYTES
    if projected["ok"] is False:
        assert "canonical operation succeeded" in projected["error"]["message"]
