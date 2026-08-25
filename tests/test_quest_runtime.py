"""Quest runtime: state machine, typed ops, machine settlement, projections.

Covers the runtime side of quest v1: the `save/quest-state.json` state
machine (authored -> offered -> active -> completed|failed|abandoned) with
decision_id-idempotent transitions, the `quest.*` toolbox ops, automatic
settlement of machine-checkable conditions on the settled-event path, the
narrative-only-through-quest.settle boundary, the offered-before-invisible
player-safe rule, and campaign-improvised provenance.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from toolbox_test_support import (
    REPO,
    SCRIPTS,
    _load,
    _run,
    _write_json,
    campaign_ws,
)

coc_quest_state = _load("coc_quest_state_runtime", SCRIPTS / "coc_quest_state.py")
coc_module_assets = _load("coc_module_assets_quest_runtime", SCRIPTS / "coc_module_assets.py")
coc_director_apply = _load(
    "coc_director_apply_quest_runtime", SCRIPTS / "coc_director_apply.py"
)
coc_toolbox = _load("coc_toolbox_quest_runtime", SCRIPTS / "coc_toolbox.py")

FAKE_SHA = "a" * 64


# --- fixtures ------------------------------------------------------------------


def _quest_row(quest_id: str, **overrides) -> dict:
    row = {
        "quest_id": quest_id,
        "title": "送还账本",
        "quest_kinds": ["escort-deliver"],
        "importance": "core",
        "giver": {"kind": "npc", "ref_id": "npc-clerk"},
        "brief": "keeper 侧：把账本送回县档案馆。",
        "target_refs": [],
        "destination_scene_id": None,
        "deadline": None,
        "completion": {"all": [{"kind": "flag_set", "flag_id": "ledger_returned"}]},
        "failure": {
            "any": [{"kind": "clock_reaches", "clock_id": "storm", "threshold": 4}],
        },
        "mainline_links": [],
        "secret": False,
        "provenance": "source",
    }
    row.update(overrides)
    return row


def _campaign(tmp_path: Path, quests: list[dict] | None = None) -> Path:
    camp = tmp_path / "campaigns" / "quest-test"
    (camp / "save").mkdir(parents=True)
    (camp / "scenario").mkdir(parents=True)
    (camp / "logs").mkdir(parents=True)
    (camp / "save" / "world-state.json").write_text(json.dumps({
        "schema_version": 1,
        "campaign_id": "quest-test",
        "discovered_clue_ids": [],
        "active_scene_id": "scene-1",
    }))
    (camp / "save" / "flags.json").write_text(json.dumps(
        coc_director_apply.coc_flag_state.new_flag_document(campaign_id="quest-test")
    ))
    (camp / "scenario" / "threat-fronts.json").write_text(json.dumps({
        "fronts": [
            {"front_id": "f1", "scope": "scenario", "dangers": [],
             "clocks": [{"clock_id": "storm", "segments": 4, "on_tick_visible": [],
                         "on_full": "storm hits"}]},
        ],
    }))
    if quests is not None:
        (camp / "scenario" / "quests.json").write_text(json.dumps(
            {"schema_version": 1, "quests": quests}
        ))
    return camp


def _set_flag(camp: Path, flag_id: str) -> None:
    flags = json.loads((camp / "save" / "flags.json").read_text())
    flags.setdefault("flags", {})[flag_id] = True
    (camp / "save" / "flags.json").write_text(json.dumps(flags))


def _set_clock(camp: Path, clock_id: str, segments: int) -> None:
    # tick_clock advances one segment per call; each tick needs its own
    # stable source id.
    for index in range(segments):
        coc_director_apply.coc_threat_state.tick_clock(
            camp / "save", clock_id, 4,
            source_id=f"test-tick-{clock_id}-{index}",
        )


def _offer_and_activate(camp: Path, quest_id: str, decision: str) -> None:
    state = coc_quest_state.read_quest_state(camp)
    coc_quest_state.apply_quest_transition(state, quest_id, "offer", f"{decision}:offer")
    coc_quest_state.apply_quest_transition(state, quest_id, "activate", f"{decision}:activate")
    coc_quest_state._write_state(camp, state)


def _active_campaign(tmp_path: Path, quest: dict) -> Path:
    camp = _campaign(tmp_path, quests=[quest])
    _offer_and_activate(camp, quest["quest_id"], "d-boot")
    return camp


def _quests_toolbox_ws(tmp_path: Path, quests: list[dict]) -> dict:
    """Full quick-start workspace carrying an authored quests.json IR."""
    ws = _quick_ws(tmp_path, campaign_id="quest-toolbox")
    _write_json(ws["campaign_dir"] / "scenario" / "quests.json", {
        "schema_version": 1, "quests": quests,
    })
    return ws


def _quick_ws(tmp_path: Path, campaign_id: str) -> dict:
    coc_starter = _load("coc_starter_quest_runtime", SCRIPTS / "coc_starter.py")
    workspace = tmp_path / f"ws-{campaign_id}"
    quick = coc_starter.quick_start(
        workspace / ".coc", "the-haunting", "thomas-hayes",
        campaign_id=campaign_id, title=campaign_id,
    )
    return {
        "workspace": workspace,
        "campaign_id": campaign_id,
        "campaign_dir": Path(quick["campaign_dir"]),
    }


# --- 1. state machine -----------------------------------------------------------


def test_state_machine_happy_path_with_receipts(tmp_path):
    camp = _campaign(tmp_path, quests=[_quest_row("quest-ledger")])
    state = coc_quest_state.read_quest_state(camp)

    receipt = coc_quest_state.apply_quest_transition(
        state, "quest-ledger", "offer", "d1",
    )
    assert receipt["status"] == "offered"
    record = state["quests"]["quest-ledger"]
    assert record["status"] == "offered"
    assert record["offered_at"] == "d1"
    assert record["decision_history"] == ["d1"]
    assert record.get("closed_at") is None

    coc_quest_state.apply_quest_transition(state, "quest-ledger", "activate", "d2")
    assert state["quests"]["quest-ledger"]["status"] == "active"

    receipt = coc_quest_state.apply_quest_transition(
        state, "quest-ledger", "settle-completed", "d3",
        settled_by="keeper", basis="报告已当面交付", ts="2024-01-01T00:00:00Z",
    )
    record = state["quests"]["quest-ledger"]
    assert record["status"] == "completed"
    assert record["closed_at"] == "d3"
    assert record["close_receipt"]["outcome"] == "completed"
    assert record["close_receipt"]["settled_by"] == "keeper"
    assert record["close_receipt"]["basis"] == "报告已当面交付"
    assert record["decision_history"] == ["d1", "d2", "d3"]

    coc_quest_state._write_state(camp, state)
    reread = coc_quest_state.read_quest_state(camp)
    assert reread["quests"]["quest-ledger"] == record


def test_authored_and_offered_may_only_abandon(tmp_path):
    camp = _campaign(
        tmp_path,
        quests=[
            _quest_row("quest-shelved"),
            _quest_row("quest-declined"),
        ],
    )
    state = coc_quest_state.read_quest_state(camp)
    # authored -> abandoned is the drop path for a never-offered quest.
    coc_quest_state.apply_quest_transition(
        state, "quest-shelved", "settle-abandoned", "d-shelf",
    )
    assert state["quests"]["quest-shelved"]["status"] == "abandoned"
    # offered -> abandoned is the declined-offer path.
    coc_quest_state.apply_quest_transition(state, "quest-declined", "offer", "d-offer")
    coc_quest_state.apply_quest_transition(
        state, "quest-declined", "settle-abandoned", "d-decline",
    )
    assert state["quests"]["quest-declined"]["status"] == "abandoned"


@pytest.mark.parametrize(
    "setup_actions, bad_action",
    [
        # offer is only legal from authored
        (["offer d1", "activate d2"], "offer d3"),
        (["offer d1"], "offer d2"),
        (["offer d1", "activate d2", "settle-completed d3"], "offer d4"),
        # activate is only legal from offered
        ([], "activate d1"),
        (["offer d1", "activate d2"], "activate d3"),
        # completed/failed close only from active
        (["offer d1"], "settle-completed d2"),
        (["offer d1"], "settle-failed d2"),
        # terminal is terminal
        (["offer d1", "activate d2", "settle-failed d3"], "settle-completed d4"),
        (["offer d1", "activate d2", "settle-abandoned d3"], "activate d4"),
        (["settle-abandoned d1"], "offer d2"),
    ],
)
def test_illegal_transitions_fail_closed(tmp_path, setup_actions, bad_action):
    camp = _campaign(tmp_path, quests=[_quest_row("quest-x")])
    state = coc_quest_state.read_quest_state(camp)
    for step in setup_actions:
        action, decision = step.rsplit(" ", 1)
        coc_quest_state.apply_quest_transition(state, "quest-x", action, decision)
    with pytest.raises(coc_quest_state.QuestStateError):
        coc_quest_state.apply_quest_transition(state, "quest-x", bad_action, "d-bad")
    # A failed transition leaves no partial record behind.
    if setup_actions:
        last = setup_actions[-1].rsplit(" ", 1)[1]
        assert state["quests"]["quest-x"]["decision_history"][-1] == last


def test_malformed_state_file_rejected(tmp_path):
    camp = _campaign(tmp_path)
    (camp / "save" / "quest-state.json").write_text(json.dumps({
        "schema_version": 2, "quests": {},
    }))
    with pytest.raises(coc_quest_state.QuestStateError):
        coc_quest_state.read_quest_state(camp)
    (camp / "save" / "quest-state.json").write_text(json.dumps({
        "schema_version": 1,
        "quests": {"quest-x": {"status": "wrapped", "decision_history": []}},
    }))
    with pytest.raises(coc_quest_state.QuestStateError):
        coc_quest_state.read_quest_state(camp)


# --- 2. decision_id idempotency ---------------------------------------------------


def test_same_decision_never_applies_twice_at_state_level(tmp_path):
    camp = _campaign(tmp_path, quests=[_quest_row("quest-x")])
    state = coc_quest_state.read_quest_state(camp)
    coc_quest_state.apply_quest_transition(state, "quest-x", "offer", "d1")
    with pytest.raises(coc_quest_state.QuestStateError, match="already applied"):
        coc_quest_state.apply_quest_transition(state, "quest-x", "offer", "d1")
    # Even under a different action: one decision, one transition, ever.
    with pytest.raises(coc_quest_state.QuestStateError, match="already applied"):
        coc_quest_state.apply_quest_transition(state, "quest-x", "activate", "d1")


def test_typed_ops_replay_returns_prior_receipt(tmp_path, campaign_ws):
    ws = campaign_ws
    camp = ws["campaign_dir"]
    _write_json(camp / "scenario" / "quests.json", {
        "schema_version": 1,
        "quests": [_quest_row("quest-ledger")],
    })
    first = _run(ws, "quest.offer", {
        "quest_id": "quest-ledger", "decision_id": "d-offer-1",
    })
    assert first["ok"] is True
    assert first["data"]["status"] == "offered"

    replay = _run(ws, "quest.offer", {
        "quest_id": "quest-ledger", "decision_id": "d-offer-1",
    })
    assert replay["ok"] is True
    assert replay["data"] == first["data"]
    assert replay.get("idempotent_replay") is True or replay.get("warnings")

    # A different decision id cannot re-offer an already-offered quest.
    again = _run(ws, "quest.offer", {
        "quest_id": "quest-ledger", "decision_id": "d-offer-2",
    })
    assert again["ok"] is False
    assert again["error"]["code"] == "invalid_state"

    state = coc_quest_state.read_quest_state(camp)
    assert state["quests"]["quest-ledger"]["decision_history"] == ["d-offer-1"]


# --- 3. machine conds auto-settle --------------------------------------------------


def test_flag_set_completion_auto_settles_active_quest(tmp_path):
    camp = _active_campaign(tmp_path, _quest_row("quest-ledger"))
    _set_flag(camp, "ledger_returned")
    events = coc_quest_state.settle_machine_settled_quests(
        camp, world={"discovered_clue_ids": []}, decision_id="d-turn-1",
        ts="2024-01-01T00:00:00Z",
    )
    assert len(events) == 1
    event = events[0]
    assert event["event_type"] == "quest_settled"
    assert event["quest_id"] == "quest-ledger"
    assert event["outcome"] == "completed"
    assert event["settled_by"] == "machine"
    assert event["decision_id"] == "d-turn-1:quest-auto:quest-ledger:completed"

    record = coc_quest_state.read_quest_state(camp)["quests"]["quest-ledger"]
    assert record["status"] == "completed"
    assert record["close_receipt"]["settled_by"] == "machine"
    assert record["close_receipt"]["outcome"] == "completed"

    # Replaying the same turn decision settles nothing new.
    replay = coc_quest_state.settle_machine_settled_quests(
        camp, world={"discovered_clue_ids": []}, decision_id="d-turn-1",
    )
    assert replay == []


def test_clue_and_clock_conditions_settle(tmp_path):
    clue_quest = _quest_row(
        "quest-find-proof",
        completion={"all": [{"kind": "clue_discovered", "clue_id": "clue-ledger"}]},
        failure=None,
    )
    clock_quest = _quest_row(
        "quest-beat-storm",
        completion={"narrative": "在风暴前赶到。"},
        failure={"all": [{"kind": "clock_reaches", "clock_id": "storm", "threshold": 3}]},
    )
    camp = _campaign(tmp_path, quests=[clue_quest, clock_quest])
    _offer_and_activate(camp, "quest-find-proof", "d-a")
    _offer_and_activate(camp, "quest-beat-storm", "d-b")

    events = coc_quest_state.settle_machine_settled_quests(
        camp, world={"discovered_clue_ids": ["clue-ledger"]}, decision_id="d-turn",
    )
    assert [e["quest_id"] for e in events] == ["quest-find-proof"]
    assert events[0]["outcome"] == "completed"

    _set_clock(camp, "storm", 4)
    events = coc_quest_state.settle_machine_settled_quests(
        camp, world={"discovered_clue_ids": []}, decision_id="d-turn-2",
    )
    assert [e["quest_id"] for e in events] == ["quest-beat-storm"]
    assert events[0]["outcome"] == "failed"


def test_completion_wins_when_both_groups_met(tmp_path):
    quest = _quest_row(
        "quest-race",
        completion={"all": [{"kind": "flag_set", "flag_id": "won"}]},
        failure={"all": [{"kind": "flag_set", "flag_id": "lost"}]},
    )
    camp = _active_campaign(tmp_path, quest)
    _set_flag(camp, "won")
    _set_flag(camp, "lost")
    events = coc_quest_state.settle_machine_settled_quests(
        camp, world={"discovered_clue_ids": []}, decision_id="d",
    )
    assert [e["outcome"] for e in events] == ["completed"]


def test_offered_and_authored_quests_never_auto_settle(tmp_path):
    camp = _campaign(tmp_path, quests=[
        _quest_row("quest-authored"),
        _quest_row("quest-offered-only"),
    ])
    state = coc_quest_state.read_quest_state(camp)
    coc_quest_state.apply_quest_transition(state, "quest-offered-only", "offer", "d-o")
    coc_quest_state._write_state(camp, state)
    _set_flag(camp, "ledger_returned")
    events = coc_quest_state.settle_machine_settled_quests(
        camp, world={"discovered_clue_ids": []}, decision_id="d",
    )
    assert events == []
    assert "quest-authored" not in coc_quest_state.read_quest_state(camp)["quests"]


def test_settlement_pass_never_raises_into_the_apply_path(tmp_path):
    camp = _campaign(tmp_path)  # no quests.json at all
    assert coc_quest_state.settle_machine_settled_quests(
        camp, world={}, decision_id="d",
    ) == []
    # Even a poisoned state file produces a skip event, not an exception.
    _write_json(camp / "scenario" / "quests.json", {
        "schema_version": 1, "quests": [_quest_row("quest-x")],
    })
    (camp / "save" / "quest-state.json").write_text("{not json")
    events = coc_quest_state.settle_machine_settled_quests(
        camp, world={}, decision_id="d",
    )
    assert len(events) == 1
    assert events[0]["event_type"] == "quest_settlement_skipped"


def test_director_apply_settles_quests_on_the_settled_event_path(tmp_path):
    camp = _campaign(tmp_path, quests=[_quest_row("quest-ledger")])
    _offer_and_activate(camp, "quest-ledger", "d-boot")

    events = coc_director_apply.apply_plan(
        camp,
        {
            "decision_id": "d-turn-7",
            "scene_action": "HOLD",
            "flags_set": ["ledger_returned"],
            "clue_policy": {"reveal": []},
            "pressure_moves": [],
            "memory_writes": [],
            "rule_signals": {},
            "rules_requests": [],
            "narrative_directives": {},
        },
        "inv1",
    )
    settled = [
        event for event in events
        if event.get("event_type") == "quest_settled"
    ]
    assert [e["quest_id"] for e in settled] == ["quest-ledger"]
    record = coc_quest_state.read_quest_state(camp)["quests"]["quest-ledger"]
    assert record["status"] == "completed"
    assert record["close_receipt"]["settled_by"] == "machine"

    log_lines = (camp / "logs" / "events.jsonl").read_text().strip().splitlines()
    assert any(
        json.loads(line).get("event_type") == "quest_settled" for line in log_lines
    )


# --- 4. narrative closes only through quest.settle ---------------------------------


def test_narrative_group_is_machine_false_forever(tmp_path):
    quest = _quest_row(
        "quest-report",
        completion={
            "all": [{"kind": "flag_set", "flag_id": "ledger_returned"}],
            "narrative": "KP 确认报告交付并被接受。",
        },
        failure=None,
    )
    camp = _active_campaign(tmp_path, quest)
    _set_flag(camp, "ledger_returned")
    events = coc_quest_state.settle_machine_settled_quests(
        camp, world={"discovered_clue_ids": []}, decision_id="d",
    )
    assert events == []
    state = coc_quest_state.read_quest_state(camp)
    assert state["quests"]["quest-report"]["status"] == "active"

    # The Keeper closes it explicitly, with the semantic basis on the receipt.
    coc_quest_state.apply_quest_transition(
        state, "quest-report", "settle-completed", "d-kp",
        settled_by="keeper", basis="诺特接受了调查报告",
    )
    coc_quest_state._write_state(camp, state)
    record = coc_quest_state.read_quest_state(camp)["quests"]["quest-report"]
    assert record["status"] == "completed"
    assert record["close_receipt"]["basis"] == "诺特接受了调查报告"


def test_projection_marks_narrative_closure(tmp_path):
    quest = _quest_row(
        "quest-report",
        completion={"narrative": "KP 语义关闭。"},
    )
    camp = _active_campaign(tmp_path, quest)
    projection = coc_quest_state.quest_projection(
        camp, world={"discovered_clue_ids": []},
    )
    row = next(r for r in projection["quests"] if r["quest_id"] == "quest-report")
    assert row["narrative_closure_required"] is True
    assert row["machine_settle_ready"] is None


def test_settle_op_requires_active_for_completed(tmp_path, campaign_ws):
    ws = campaign_ws
    camp = ws["campaign_dir"]
    _write_json(camp / "scenario" / "quests.json", {
        "schema_version": 1,
        "quests": [_quest_row("quest-ledger")],
    })
    offered = _run(ws, "quest.offer", {
        "quest_id": "quest-ledger", "decision_id": "d-o",
    })
    assert offered["ok"] is True
    # completed from offered is off the frozen machine...
    bad = _run(ws, "quest.settle", {
        "quest_id": "quest-ledger", "outcome": "completed",
        "decision_id": "d-s", "basis": "试图直接关闭",
    })
    assert bad["ok"] is False
    assert bad["error"]["code"] == "invalid_state"
    # ...but declining the offer is a legal abandonment.
    declined = _run(ws, "quest.settle", {
        "quest_id": "quest-ledger", "outcome": "abandoned",
        "decision_id": "d-s2", "basis": "调查员拒绝委托",
    })
    assert declined["ok"] is True
    assert declined["data"]["outcome"] == "abandoned"


# --- 5. offered before any player-safe surface --------------------------------------


def test_projection_hides_authored_quests_from_player_safe_face(tmp_path):
    quests = [
        _quest_row("quest-open", player_safe_summary="把账本送回县档案馆。"),
        _quest_row(
            "quest-secret",
            secret=True,
            player_safe_summary=None,
            completion={"narrative": "..."},
        ),
    ]
    camp = _campaign(tmp_path, quests=quests)

    projection = coc_quest_state.quest_projection(
        camp, world={"discovered_clue_ids": []},
    )
    by_id = {row["quest_id"]: row for row in projection["quests"]}
    # Authored quests are keeper-known only: no player-safe face at all.
    assert "player_safe" not in by_id["quest-open"]
    assert "player_safe" not in by_id["quest-secret"]
    # Machine progress is not evaluated for authored quests either.
    assert "completion" not in by_id["quest-open"]

    state = coc_quest_state.read_quest_state(camp)
    coc_quest_state.apply_quest_transition(state, "quest-open", "offer", "d-offer")
    coc_quest_state._write_state(camp, state)
    projection = coc_quest_state.quest_projection(
        camp, world={"discovered_clue_ids": []},
    )
    by_id = {row["quest_id"]: row for row in projection["quests"]}
    # Offered: the player-safe face exists and carries title + summary.
    face = by_id["quest-open"]["player_safe"]
    assert face["player_safe_summary"]
    assert face["title"] == "送还账本"
    # A secret quest stays faceless even after being offered: the pack never
    # carried player-safe text, and the projection does not invent one.
    assert "player_safe" not in by_id["quest-secret"]


def test_story_progress_summary_lists_only_live_quests(tmp_path):
    camp = _campaign(tmp_path, quests=[
        _quest_row("quest-a"),
        _quest_row("quest-b", importance="supporting"),
    ])
    state = coc_quest_state.read_quest_state(camp)
    coc_quest_state.apply_quest_transition(state, "quest-a", "offer", "d-1")
    coc_quest_state.apply_quest_transition(state, "quest-a", "activate", "d-2")
    coc_quest_state.apply_quest_transition(state, "quest-b", "offer", "d-3")
    coc_quest_state.apply_quest_transition(state, "quest-b", "settle-abandoned", "d-4")
    coc_quest_state._write_state(camp, state)

    summary = coc_quest_state.quest_progress_summary(
        camp, world={"discovered_clue_ids": []},
    )
    assert summary["keeper_only"] is True
    # Only offered/active quests are live on the story-progress board.
    assert [row["quest_id"] for row in summary["live"]] == ["quest-a"]
    assert summary["status_counts"]["active"] == 1
    assert summary["status_counts"]["abandoned"] == 1
    assert summary["status_counts"]["authored"] == 0


# --- 6. improvise provenance --------------------------------------------------------


def _improvise_ws(tmp_path: Path) -> dict:
    ws = _quick_ws(tmp_path, campaign_id="quest-improvise")
    campaign_dir = ws["campaign_dir"]
    workspace = ws["workspace"]
    asset_root_id = "test-quest-mod"
    coc_module_assets.init_module_root(
        workspace,
        asset_root_id=asset_root_id,
        identity={"canonical_module_id": asset_root_id},
        file_sha256=FAKE_SHA,
    )
    _write_json(campaign_dir / "scenario" / "scenario.json", {
        "schema_version": 1,
        "progressive_asset_root_id": asset_root_id,
    })
    return ws


def test_improvise_writes_campaign_improvised_pack(tmp_path):
    ws = _improvise_ws(tmp_path)
    result = _run(ws, "quest.improvise", {
        "quest": _quest_row(
            "quest-help-widow",
            provenance="source",  # handler must force campaign-improvised
            completion={"narrative": "寡妇得到交代。"},
        ),
        "decision_id": "d-improvise",
    })
    assert result["ok"] is True, result.get("error")
    assert result["data"]["provenance"] == "campaign-improvised"
    assert result["data"]["status"] == "authored"

    pack = json.loads(
        Path(result["data"]["pack_path"]).read_text(encoding="utf-8")
    )
    assert pack["provenance"] == "campaign-improvised"
    assert pack["quest_id"] == "quest-help-widow"

    # The improvised quest is now a definition the campaign knows...
    definitions = coc_quest_state.read_quest_definitions(
        ws["campaign_dir"], root=ws["workspace"],
    )
    assert definitions["quest-help-widow"]["provenance"] == "campaign-improvised"
    # ...and it can be offered like any authored quest.
    offered = _run(ws, "quest.offer", {
        "quest_id": "quest-help-widow", "decision_id": "d-offer",
    })
    assert offered["ok"] is True


def test_improvise_replay_is_idempotent(tmp_path):
    ws = _improvise_ws(tmp_path)
    args = {
        "quest": _quest_row("quest-once", completion={"narrative": "..."}),
        "decision_id": "d-improvise",
    }
    first = _run(ws, "quest.improvise", dict(args))
    assert first["ok"] is True
    replay = _run(ws, "quest.improvise", dict(args))
    assert replay["ok"] is True
    assert replay["data"] == first["data"]


def test_improvise_without_asset_root_fails_closed(tmp_path, campaign_ws):
    ws = campaign_ws
    result = _run(ws, "quest.improvise", {
        "quest": _quest_row("quest-nowhere", completion={"narrative": "..."}),
        "decision_id": "d-improvise",
    })
    assert result["ok"] is False
    assert result["error"]["code"] == "invalid_state"


def test_improvise_rejects_malformed_definitions(tmp_path):
    ws = _improvise_ws(tmp_path)
    result = _run(ws, "quest.improvise", {
        "quest": _quest_row(
            "quest-bad",
            quest_kinds=["fetch-quest"],  # off the frozen nine-kind enum
            completion={"narrative": "..."},
        ),
        "decision_id": "d-improvise",
    })
    assert result["ok"] is False
    assert result["error"]["code"] == "invalid_param"
    assert "fetch-quest" in result["error"]["message"] or "quest_kinds" in result["error"]["message"]


# --- registry exposure ---------------------------------------------------------------


def test_quest_ops_registered_on_the_canonical_contract_surface():
    for name in ("quest.map", "quest.offer", "quest.activate", "quest.settle", "quest.improvise"):
        assert name in coc_toolbox.TOOLS
        assert coc_toolbox.TOOLS[name]["handler"] is not None
    archive = json.loads(
        (REPO / "plugins" / "coc-keeper" / "references" / "mcp-operation-contracts.json")
        .read_text(encoding="utf-8")
    )
    archived = set(archive["operations"])
    assert archived >= {
        "quest.map", "quest.offer", "quest.activate", "quest.settle", "quest.improvise",
    }
