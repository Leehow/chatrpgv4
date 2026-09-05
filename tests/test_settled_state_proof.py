"""A settlement must be able to prove the state it moved.

`turn.finalize` refuses a typed state effect that no successful canonical
operation backs (`unproven_state_delta`), and it refuses terminally:
`recoverable_by: none`, no allowed next action. So a settlement that cannot
prove its own write does not merely lose a line in the state block -- it makes
the turn unclosable, and the Keeper retries finalize until the lane dies.

`_rules_settle_writer_domains` grants a settlement no write domain unless its
envelope shows, in agreement, the receipt, the canonical event, and the
resource's current value; a `conditions` mismatch voids every other domain
with it. A sanity settlement carried none of the three: no `event` (the
executor nests events under `results[].events[]`), no `current_san` (the
envelope forwarded only `current_hp`), and `conditions: None` against the
receipt's `[]`.

This is older than the rewiring of decision:coc7:sanity:check -- the same
probe fails identically at 35f7aa45^ -- but it could not bite while every SAN
check in a diagnostic lane was failing for other reasons. Once they started
succeeding on 2026-09-02, three lanes settled rules, advanced bouts, and not
one of them closed its turn.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import coc_starter  # noqa: E402
import coc_state_effect_authority as authority  # noqa: E402
import coc_toolbox  # noqa: E402
import coc_turn_finalization as finalization  # noqa: E402


@pytest.fixture
def campaign_ws(tmp_path: Path):
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    coc_root.mkdir(parents=True)
    (coc_root / "runtime.json").write_text(
        json.dumps({
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        }),
        encoding="utf-8",
    )
    campaign_id = "settled-state-proof"
    coc_starter.quick_start(
        coc_root, "the-haunting", "thomas-hayes",
        campaign_id=campaign_id, title="Settled State Proof",
    )
    return {"workspace": workspace, "campaign_id": campaign_id}


def _settled_sanity_call(campaign_ws, decision_id="proof-0001"):
    ws, cid = campaign_ws["workspace"], campaign_ws["campaign_id"]
    coc_toolbox.run_tool(
        "rules.context", ws, cid,
        {"family": "sanity", "investigator": "thomas-hayes"},
    )
    args = {
        "decision_ref": "decision:coc7:sanity:check",
        "decision_id": decision_id,
        "investigator": "thomas-hayes",
        "seed": 10,
        "semantic_inputs": {
            "source": "the sealed-chamber corpse sits up",
            "loss_success": "20", "loss_failure": "20",
            "involuntary_kind": "freeze",
            "involuntary_summary": "the flashlight beam stops moving",
        },
    }
    settled = coc_toolbox.run_tool("rules.settle", ws, cid, args)
    assert settled.get("ok"), settled
    return {
        "tool": "rules.settle",
        "ok": True,
        "data": settled["data"],
        "args": args,
    }


def test_a_settled_sanity_check_proves_the_san_it_spent(campaign_ws):
    call = _settled_sanity_call(campaign_ws)
    effects = finalization._project_state_deltas([call])
    san = [
        effect for effect in effects
        if str(effect.get("resource") or "").upper() == "SAN"
    ]
    assert san, f"the settlement recorded no SAN delta to prove: {effects}"
    assert san[0]["before"] != san[0]["after"], san[0]

    assert authority.state_delta_proof_violations([call], effects) == [], (
        "the turn cannot be finalized while its own settlement cannot prove "
        "the SAN it spent"
    )


def test_the_envelope_carries_all_three_things_the_proof_cross_checks(campaign_ws):
    """Named individually because each was absent, and because the proof
    reports one opaque `mismatch` whichever is missing."""
    call = _settled_sanity_call(campaign_ws, "proof-0002")
    data = call["data"]
    result = data["settlement"]["result"]
    receipt = data["player_state_receipt"]

    event = data.get("event")
    assert isinstance(event, dict) and event.get("event_type"), data
    assert result.get("event") == event, "result and envelope must agree"

    assert data.get("current_san") == receipt["san"]["after"], data
    assert result.get("current_san") == receipt["san"]["after"], result

    assert data.get("conditions") == list(receipt["conditions_after"]), data
    assert result.get("conditions") == list(receipt["conditions_after"]), result

    assert "san" in authority.writer_domains("rules.settle", call)
