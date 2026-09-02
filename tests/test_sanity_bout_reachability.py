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
import random
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


def test_a_check_during_a_bout_says_so_and_names_the_way_out(campaign_ws):
    """p.157 blocks Sanity loss during a bout. The engine says so by returning
    `sanity_check_skipped` with no roll; this path read `roll` as 0 and carried
    it into the percentile projection, where success_level() rejects it --
    "roll must be between 1 and 100". The branch was unreachable while the
    graph settled checks through the advisory surface, so rewiring made it
    live and every SAN check in three lanes died there.

    Two further layers hid the answer even once it was raised.
    SubsystemExecutorError subclasses ValueError, so the toolbox's generic
    catch flattened the typed code into `invalid_request`; and the executor's
    transaction wrapper relabelled every rolled-back rejection
    `subsystem_transaction_failed`, which the toolbox treats as transient --
    so a refusal that can never succeed was retried three times a lane.
    """
    import coc_toolbox  # noqa: PLC0415

    ws, cid = campaign_ws["workspace"], campaign_ws["campaign_id"]
    inputs = {
        "source": "the sealed-chamber corpse sits up",
        "loss_success": "20",
        "loss_failure": "20",
        "involuntary_kind": "freeze",
        "involuntary_summary": "the flashlight beam stops moving",
    }
    for attempt in (1, 2):
        coc_toolbox.run_tool(
            "rules.context", ws, cid,
            {"family": "sanity", "investigator": "thomas-hayes"},
        )
        settled = coc_toolbox.run_tool(
            "rules.settle", ws, cid,
            {
                "decision_ref": "decision:coc7:sanity:check",
                "decision_id": f"during-bout-{attempt}",
                "investigator": "thomas-hayes",
                "seed": 2,
                "semantic_inputs": inputs,
            },
        )
        if attempt == 1:
            assert settled.get("ok"), settled

    # Two guards can answer, and both must name the way out. A bout with its
    # choice still waiting is refused earlier, by the executor's one-open-
    # choice rule; a bout left active with no pending choice -- the shape every
    # campaign that opened one under the old wiring is in -- reaches the
    # skip itself.
    error = settled.get("error") or {}
    assert error.get("code") in (
        "blocked_by_pending_choice", "sanity_check_blocked_by_bout",
    ), settled
    assert "bout-tick" in error.get("message", ""), error


def _open_an_orphan_bout(campaign_ws):
    """Reproduce, faithfully, the state every campaign that opened a bout
    under the old wiring is in: the bout written straight into
    save/sanity.json by the session, and no executor history at all.

    Deleting subsystem-state.json after an executor-opened bout is NOT the
    same thing -- the result ledger still references it, and the executor
    catches that hand-made corruption on the next load.
    """
    import coc_sanity  # noqa: PLC0415

    campaign_dir = campaign_ws["campaign_dir"]
    session = coc_sanity.SanitySession.load(
        campaign_dir, "thomas-hayes", int_value=50, rng=random.Random(2),
        cm_value=0,
    )
    session.sanity_check(
        source="the sealed-chamber corpse sits up",
        san_loss_success="20",
        san_loss_fail_expr="20",
        involuntary_kind="freeze",
        involuntary_summary="the flashlight beam stops moving",
    )
    session.save(campaign_dir, strict_mirror=True)
    snapshot = json.loads(
        (campaign_dir / "save" / "sanity.json").read_text(encoding="utf-8")
    )
    assert snapshot["bout_active"] is True, snapshot
    assert not (campaign_dir / "save" / "subsystem-state.json").is_file()
    return snapshot


def test_a_bout_no_engine_owns_is_closed_instead_of_wedging_the_family(campaign_ws):
    """Until the rewiring the graph opened bouts through the advisory surface,
    which wrote `bout_active` and told the executor nothing. Nothing can
    advance such a bout, and p.157 blocks every further Sanity check while it
    runs, so the family is wedged -- and the refusal that names bout-tick as
    the way out points at a choice that does not exist. Measured live
    2026-09-02: eight blocked checks and six unavailable bout-ticks across
    three lanes, and not one settlement.

    It is ended, never adopted: adopting means writing an origin command, a
    revision and a private pending context no command ever produced, which
    `_migrate_schema_v2` already refuses on principle.
    """
    import coc_subsystem_executor  # noqa: PLC0415
    import coc_toolbox  # noqa: PLC0415

    before = _open_an_orphan_bout(campaign_ws)
    orphan_id = before["active_bout_id"]

    ws, cid = campaign_ws["workspace"], campaign_ws["campaign_id"]
    settled = coc_toolbox.run_tool(
        "rules.settle", ws, cid,
        {
            "decision_ref": "decision:coc7:sanity:check",
            "decision_id": "after-orphan-0001",
            "investigator": "thomas-hayes",
            "seed": 5,
            "semantic_inputs": {
                "source": "the corridor light dies",
                "loss_success": "1", "loss_failure": "1D8",
                "involuntary_kind": "freeze",
                "involuntary_summary": "the beam stops moving",
            },
        },
    )
    assert settled.get("ok"), settled

    after = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "sanity.json")
        .read_text(encoding="utf-8")
    )
    # Nothing settled is erased: the orphan keeps its table result, duration
    # and backstory suggestion, and the insanity it caused still stands.
    kept = {row["bout_id"]: row for row in after["bouts_of_madness"]}
    assert orphan_id in kept, after
    assert kept[orphan_id]["bout_result"] == before["bouts_of_madness"][-1]["bout_result"]
    assert kept[orphan_id].get("backstory_amend_suggestion")
    assert after["temporary_insane"] is True

    ledger = (campaign_ws["campaign_dir"] / "logs" / "orphan-bouts.jsonl")
    assert ledger.is_file(), "the reconciliation must leave a receipt"
    row = json.loads(ledger.read_text(encoding="utf-8").splitlines()[0])
    assert row["bout_id"] == orphan_id
    assert row["rounds_remaining_when_closed"] == before["bout_rounds_remaining"]

    # And whatever bout is live now is one this executor owns.
    if after["bout_active"]:
        assert [
            c for c in coc_subsystem_executor.get_current_pending_choices(
                campaign_ws["campaign_dir"],
            )
            if c.get("kind") == "bout_keeper_action"
        ], after


def test_a_bout_its_engine_owns_is_never_closed_behind_the_keepers_back(campaign_ws):
    """The reconciliation must fire only on an ownerless bout. A running bout
    with its Keeper choice waiting is the normal case and must survive."""
    import coc_subsystem_executor  # noqa: PLC0415
    import coc_toolbox  # noqa: PLC0415

    ws, cid = campaign_ws["workspace"], campaign_ws["campaign_id"]
    _open_an_orphan_bout(campaign_ws)
    # Reconcile it, which leaves a real executor-owned bout in its place.
    coc_toolbox.run_tool(
        "rules.settle", ws, cid,
        {
            "decision_ref": "decision:coc7:sanity:check",
            "decision_id": "owned-bout-0001",
            "investigator": "thomas-hayes",
            "seed": 2,
            "semantic_inputs": {
                "source": "the corridor light dies",
                "loss_success": "20", "loss_failure": "20",
                "involuntary_kind": "freeze",
                "involuntary_summary": "the beam stops moving",
            },
        },
    )
    snapshot = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "sanity.json")
        .read_text(encoding="utf-8")
    )
    if not snapshot.get("bout_active"):
        pytest.skip("this seed closed its bout on the same turn")
    owned_id = snapshot["active_bout_id"]

    coc_toolbox.run_tool(
        "rules.settle", ws, cid,
        {
            "decision_ref": "decision:coc7:sanity:check",
            "decision_id": "owned-bout-0002",
            "investigator": "thomas-hayes",
            "seed": 6,
            "semantic_inputs": {
                "source": "something moves in the dark",
                "loss_success": "1", "loss_failure": "1D8",
                "involuntary_kind": "freeze",
                "involuntary_summary": "the beam stops moving",
            },
        },
    )
    still = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "sanity.json")
        .read_text(encoding="utf-8")
    )
    assert still["bout_active"] is True, "an owned bout must not be reconciled away"
    assert still["active_bout_id"] == owned_id
    assert not (campaign_ws["campaign_dir"] / "logs" / "orphan-bouts.jsonl").is_file() \
        or all(
            json.loads(line)["bout_id"] != owned_id
            for line in (campaign_ws["campaign_dir"] / "logs" / "orphan-bouts.jsonl")
            .read_text(encoding="utf-8").splitlines()
        )
    assert [
        c for c in coc_subsystem_executor.get_current_pending_choices(
            campaign_ws["campaign_dir"],
        )
        if c.get("kind") == "bout_keeper_action"
    ]
