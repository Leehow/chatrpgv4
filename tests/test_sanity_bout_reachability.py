"""A bout the graph opens must be a bout the graph can advance.

`decision:coc7:sanity:check` declares `implementation.kind =
"rules.sanity_check"` -- the advisory surface, which the module itself
describes as not persisting ("use sanity.execute for full checks, bouts, and
their persisted consequences"). Its continuations,
`decision:coc7:sanity:bout-tick` and `bout-end`, declare `kind =
"sanity.execute"`, and every one of their payload slots is host-locked from a
subsystem pending choice: pending_choice_ref, origin_command_id,
bout_revision.

So the graph wires a bout's opening to one engine and its continuation to
another. The bout lands in save/sanity.json with bout_active true, the
subsystem executor never hears of it, no `bout_keeper_action` choice is ever
registered, and `sanity.bout.pending` -- which reads the choice queue -- stays
false, so rules.context never offers bout-tick either. The bout cannot be
advanced or ended by anything.

Measured 2026-09-02: gate9-depth-10 sat at `bout_active: true,
bout_rounds_remaining: 2` with no subsystem-state.json at all. Three
diagnostic lanes in a row read "a bout is active" from the canonical snapshot,
reached for bout-tick, and were told no bout was waiting on them. Because
p.157 blocks further SAN checks while a bout is active, the sanity family is
wedged from the first triggered bout onward.

This test is xfail until the opening and the continuation share an engine.
Fixing it is a rules-layer change (which adapter `sanity:check` invokes), not
a projection or wording change, so it is recorded rather than papered over.
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
import coc_subsystem_executor  # noqa: E402
import coc_toolbox  # noqa: E402


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
    campaign_id = "sanity-bout-reachability"
    coc_starter.quick_start(
        coc_root, "the-haunting", "thomas-hayes",
        campaign_id=campaign_id, title="Bout Reachability",
    )
    return {"workspace": workspace, "campaign_id": campaign_id,
            "campaign_dir": coc_root / "campaigns" / campaign_id}


@pytest.mark.xfail(
    strict=True,
    reason="decision:coc7:sanity:check invokes rules.sanity_check while its "
           "bout continuations invoke sanity.execute",
)
def test_the_graph_declares_one_engine_for_a_bout(campaign_ws):
    """The opening and the continuation must invoke the same executor."""
    graph = json.loads(
        (ROOT / "plugins/coc-keeper/rulesets/coc7/rule-graph.json")
        .read_text(encoding="utf-8")
    )
    kinds = {
        node["node_id"]: node["properties"]["implementation"]["kind"]
        for node in graph["nodes"]
        if node.get("node_id", "").startswith("decision:coc7:sanity:")
        and isinstance(node.get("properties", {}).get("implementation"), dict)
    }
    opening = kinds["decision:coc7:sanity:check"]
    assert opening == kinds["decision:coc7:sanity:bout-tick"] == kinds[
        "decision:coc7:sanity:bout-end"
    ], (
        "a bout opened by one engine cannot be advanced by another: "
        f"check={opening}, "
        f"bout-tick={kinds['decision:coc7:sanity:bout-tick']}"
    )


@pytest.mark.xfail(
    strict=True,
    reason="the graph opens a bout through rules.sanity_check, which never "
           "registers the subsystem pending choice bout-tick is locked to",
)
def test_a_triggered_bout_can_be_advanced(campaign_ws):
    ws, cid = campaign_ws["workspace"], campaign_ws["campaign_id"]
    coc_toolbox.run_tool(
        "rules.context", ws, cid,
        {"family": "sanity", "investigator": "thomas-hayes"},
    )
    # A 20-point loss on either branch: the bout is certain, not a coin flip.
    settled = coc_toolbox.run_tool(
        "rules.settle", ws, cid,
        {
            "decision_ref": "decision:coc7:sanity:check",
            "decision_id": "forced-bout-0001",
            "investigator": "thomas-hayes",
            "semantic_inputs": {
                "source": "the sealed-chamber corpse sits up",
                "loss_success": "20",
                "loss_failure": "20",
                "involuntary_kind": "freeze",
                "involuntary_summary": "the flashlight beam stops moving",
            },
        },
    )
    assert settled.get("ok"), settled
    result = (settled["data"].get("settlement") or {}).get("result") or {}
    assert result.get("bout_triggered") is True, result

    choices = [
        row for row in
        coc_subsystem_executor.get_current_pending_choices(
            campaign_ws["campaign_dir"],
        )
        if row.get("kind") == "bout_keeper_action"
    ]
    assert len(choices) == 1, (
        "a bout is active and nothing can advance or end it; further SAN "
        "checks are blocked while it runs (p.157), so the family is wedged"
    )
