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


@pytest.mark.parametrize("seed", list(range(1, 13)))
def test_an_active_bout_always_has_a_keeper_choice_waiting(campaign_ws, seed):
    """Whenever the graph's own SAN check leaves a bout active, exactly one
    `bout_keeper_action` choice must be waiting -- that choice is what
    `sanity.bout.pending` reads to offer bout-tick, and what bout-tick's
    host-locked slots are drawn from.

    Whether a bout opens at all is a roll (four of these twelve seeds close
    without one), so the invariant is stated as the implication rather than as
    "a bout triggers", which would be a flaky assertion about dice.

    Before the rewiring every seed that opened a bout landed here with zero
    choices: the bout lived in save/sanity.json and the subsystem executor had
    never heard of it.
    """
    ws, cid = campaign_ws["workspace"], campaign_ws["campaign_id"]
    coc_toolbox.run_tool(
        "rules.context", ws, cid,
        {"family": "sanity", "investigator": "thomas-hayes"},
    )
    settled = coc_toolbox.run_tool(
        "rules.settle", ws, cid,
        {
            "decision_ref": "decision:coc7:sanity:check",
            "decision_id": f"forced-bout-{seed:04d}",
            "investigator": "thomas-hayes",
            "seed": seed,
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

    snapshot = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "sanity.json")
        .read_text(encoding="utf-8")
    )
    choices = [
        row for row in
        coc_subsystem_executor.get_current_pending_choices(
            campaign_ws["campaign_dir"],
        )
        if row.get("kind") == "bout_keeper_action"
    ]
    if not snapshot.get("bout_active"):
        return
    assert len(choices) == 1, (
        f"a bout is active ({snapshot.get('bout_rounds_remaining')} rounds "
        "remaining) and nothing can advance or end it; further SAN checks are "
        "blocked while it runs (p.157), so the family is wedged"
    )
