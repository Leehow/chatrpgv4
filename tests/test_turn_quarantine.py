"""Turn commit closure: commit snapshots and resume-time turn-tail quarantine.

Pins W1: finalization is the turn commit point. Public rolls bound to no
finalization (an abandoned turn tail after a crash) are marked voided — never
deleted — and turn-scoped state restores from the latest commit snapshot at
session.resume, so unfinalized branches cannot leak into canonical state or
the battle report.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
PYTHON = sys.executable


def _load(name: str, rel: str | Path):
    path = Path(rel)
    if not path.is_absolute():
        path = REPO / path
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_toolbox = _load("coc_toolbox_turn_quarantine", SCRIPTS / "coc_toolbox.py")
coc_starter = _load("coc_starter_turn_quarantine", SCRIPTS / "coc_starter.py")
coc_turn_finalization = _load(
    "coc_turn_finalization_quarantine", SCRIPTS / "coc_turn_finalization.py"
)


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    return [
        json.loads(raw)
        for raw in path.read_text(encoding="utf-8").splitlines()
        if raw.strip()
    ]


@pytest.fixture()
def campaign_ws(tmp_path: Path):
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "turn-quarantine-test"
    _write_json(
        coc_root / "runtime.json",
        {
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        },
    )
    quick = coc_starter.quick_start(
        coc_root,
        "the-haunting",
        "thomas-hayes",
        campaign_id=campaign_id,
        title="Turn Quarantine Test",
    )
    return {
        "workspace": workspace,
        "coc_root": coc_root,
        "campaign_id": campaign_id,
        "campaign_dir": Path(quick["campaign_dir"]),
        "investigator_id": quick["investigator_id"],
        "quick": quick,
    }


def _run(ws, tool: str, args: dict | None = None) -> dict:
    args = dict(args or {})
    if tool == "rules.roll":
        args.setdefault("difficulty", "regular")
        args.setdefault("difficulty_basis", "keeper_judgment")
        args.setdefault("goal", "settle the focused quarantine test action")
        args.setdefault(
            "stakes",
            {
                "on_success": "the focused test action succeeds",
                "on_failure": "the focused test action does not succeed",
            },
        )
    result = coc_toolbox.run_tool(
        tool, ws["workspace"], ws["campaign_id"], dict(args)
    )
    assert isinstance(result, dict)
    return result


def _finalize_current_turn(ws, decision_id: str) -> dict:
    journaled = _run(
        ws,
        "state.journal",
        {
            "summary": f"journal for {decision_id}",
            "player_text": f"我完成了 {decision_id} 的测试行动。",
            "decision_id": f"{decision_id}-journal",
        },
    )
    assert journaled["ok"] is True, journaled
    output = _run(ws, "turn.output_context")
    assert output["ok"] is True, output
    context = output["data"]
    result_paragraph = "已结算的测试结果按其原有因果关系发生。"
    draft = "测试中的行动继续推进。\n\n" + result_paragraph
    coverage = [
        {
            "obligation_id": obligation["obligation_id"],
            "realization": "fictional_beat",
            "action_realization": "调查员完成了这项已结算的测试行动",
            "response": "场景按权威结算结果作出对应反应",
            "causal_explanation": "该反应直接来自本轮已经结算的行动结果",
            "persona_fit": "这项行动保持调查员既有的测试角色设定",
            "player_input_handling": "abstract_completed",
            "exact_excerpt": result_paragraph,
            "exceptional_beat": (
                "特殊结果已经产生与该行动直接相连的实质影响"
                if obligation["exceptional_required"]
                else ""
            ),
        }
        for obligation in context["obligations"]
    ]
    mechanics_placements = []
    for segment_type, source_key, after_paragraph in (
        ("public_check", "roll_id", 0),
        ("state_delta", "effect_id", 1),
        ("exceptional_effect", "event_id", 1),
    ):
        rows = context["mechanics_bundle"].get(segment_type) or []
        if rows:
            mechanics_placements.append({
                "after_paragraph": after_paragraph,
                "segment_type": segment_type,
                "source_ids": [str(row[source_key]) for row in rows],
            })
    finalized = _run(
        ws,
        "turn.finalize",
        {
            "draft": draft,
            "coverage": coverage,
            "mechanics_placements": mechanics_placements,
            "decision_id": decision_id,
        },
    )
    assert finalized["ok"] is True, finalized
    return finalized


def _inv_state(ws) -> dict:
    return json.loads(
        (ws["campaign_dir"] / "save" / "investigator-state" / f"{ws['investigator_id']}.json")
        .read_text(encoding="utf-8")
    )


def _sanity_snapshot(ws) -> dict:
    return json.loads(
        (ws["campaign_dir"] / "save" / "sanity-state" / f"{ws['investigator_id']}.json")
        .read_text(encoding="utf-8")
    )


def _san_check(ws, *, decision_id: str, seed: int, loss_failure: str, loss_success: str = "0") -> dict:
    result = _run(
        ws,
        "rules.sanity_check",
        {
            "investigator": ws["investigator_id"],
            "source": f"horror {decision_id}",
            "loss_success": loss_success,
            "loss_failure": loss_failure,
            "decision_id": decision_id,
            "seed": seed,
        },
    )
    assert result["ok"] is True, result
    return result


def test_finalize_writes_commit_snapshot(campaign_ws):
    rolled = _run(
        campaign_ws,
        "rules.roll",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": "Spot Hidden",
            "target": 99,
            "seed": 1,
            "decision_id": "committed-roll",
        },
    )
    assert rolled["ok"] is True, rolled
    finalized = _finalize_current_turn(campaign_ws, "committed-turn-finalize")
    finalization_id = finalized["data"]["finalization_id"]
    snapshot_dir = (
        campaign_ws["campaign_dir"]
        / "save"
        / "commit-snapshots"
        / coc_toolbox.coc_turn_manifest._commit_snapshot_safe_id(finalization_id)
    )
    assert snapshot_dir.is_dir()
    assert (snapshot_dir / "investigator-state" / f"{campaign_ws['investigator_id']}.json").is_file()
    assert not (snapshot_dir / "commit-snapshots").exists()
    latest = coc_toolbox.coc_turn_manifest.latest_commit_snapshot(
        campaign_ws["campaign_dir"]
    )
    assert latest is not None
    assert latest[0] == finalization_id


def test_creation_receipts_bind_luck_and_characteristic_rolls():
    luck_reference = {
        "campaign_id": "creation-binding-test",
        "decision_id": "creation-luck",
        "roll_id": "creation-luck-roll",
    }
    bound = coc_turn_finalization.creation_receipt_bound_roll_ids(
        "creation-binding-test",
        [
            {
                "luck_roll_receipt": luck_reference,
                "characteristic_roll_receipts": {
                    "STR": {
                        "campaign_id": "creation-binding-test",
                        "decision_id": "creation-str",
                        "roll_id": "creation-str-roll",
                    },
                    "Luck": luck_reference,
                },
            },
        ],
    )
    assert bound == {"creation-luck-roll", "creation-str-roll"}


def test_resume_skips_creation_bound_luck_roll(campaign_ws):
    creation_luck = _run(
        campaign_ws,
        "rules.roll_dice",
        {
            "expression": "3D6",
            "purpose": "investigator_creation_luck",
            "reason": "canonical Quick Fire Luck source",
            "seed": 7,
            "decision_id": "creation-luck-for-quarantine",
        },
    )
    assert creation_luck["ok"] is True, creation_luck
    creation_path = (
        campaign_ws["coc_root"]
        / "investigators"
        / campaign_ws["investigator_id"]
        / "creation.json"
    )
    creation = json.loads(creation_path.read_text(encoding="utf-8"))
    creation["luck_roll_receipt"] = {
        "campaign_id": campaign_ws["campaign_id"],
        "decision_id": "creation-luck-for-quarantine",
        "roll_id": creation_luck["data"]["roll_id"],
    }
    _write_json(creation_path, creation)

    assert coc_turn_finalization.campaign_creation_receipt_bound_roll_ids(
        campaign_ws["campaign_dir"]
    ) == {creation_luck["data"]["roll_id"]}
    assert coc_turn_finalization.unbound_public_roll_ids(
        campaign_ws["campaign_dir"]
    ) == []

    resumed = _run(campaign_ws, "session.resume", {})
    assert resumed["ok"] is True, resumed
    assert resumed["data"]["turn_tail_quarantine"]["quarantined_orphan_rolls"] == []
    assert not (
        campaign_ws["campaign_dir"] / "save" / "roll-dispositions.json"
    ).exists()


def test_resume_quarantines_unfinalized_turn_tail(campaign_ws):
    # Committed turn A: one SAN loss (55 -> 52), finalized.
    _san_check(campaign_ws, decision_id="committed-san", seed=1, loss_success="1D3", loss_failure="1D3")
    finalized = _finalize_current_turn(campaign_ws, "turn-a-finalize")
    finalization_id = finalized["data"]["finalization_id"]
    assert _inv_state(campaign_ws)["current_san"] == 52

    # Abandoned turn B (crash shape): rolls + state writes, no journal/finalize.
    orphan_san = _san_check(campaign_ws, decision_id="orphan-san", seed=10, loss_failure="5")
    assert orphan_san["data"]["bout_triggered"] is True
    orphan_roll = _run(
        campaign_ws,
        "rules.roll",
        {
            "investigator": campaign_ws["investigator_id"],
            "skill": "Spot Hidden",
            "target": 99,
            "seed": 2,
            "decision_id": "orphan-skill-roll",
        },
    )
    assert orphan_roll["ok"] is True, orphan_roll
    assert _inv_state(campaign_ws)["current_san"] == 47
    assert _inv_state(campaign_ws)["bout_active"] is True
    orphan_roll_ids = set(orphan_san["data"]["session_roll_ids"])
    orphan_roll_ids.add(orphan_roll["data"]["roll_id"])

    resumed = _run(campaign_ws, "session.resume", {})
    assert resumed["ok"] is True, resumed
    quarantine = resumed["data"]["turn_tail_quarantine"]
    assert set(quarantine["quarantined_orphan_rolls"]) == orphan_roll_ids
    assert quarantine["restored_commit_snapshot"] == finalization_id

    # Rolls are never rewritten or deleted; dispositions live in an
    # append-only ledger, so receipt prefix integrity survives.
    rolls = {
        row["roll_id"]: row
        for row in _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "rolls.jsonl")
    }
    for roll_id in orphan_roll_ids:
        assert "superseded" not in rolls[roll_id]
    dispositions = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "roll-dispositions.json").read_text(
            encoding="utf-8"
        )
    )["dispositions"]
    for roll_id in orphan_roll_ids:
        assert dispositions[roll_id]["visibility"] == "voided"
        assert dispositions[roll_id]["reason"] == "unfinalized_turn_tail"
    events = _read_jsonl(campaign_ws["campaign_dir"] / "logs" / "events.jsonl")
    abandoned = [row for row in events if row.get("event_type") == "turn_tail_abandoned"]
    assert len(abandoned) == 1
    assert set(abandoned[0]["roll_ids"]) == orphan_roll_ids

    # The abandoned turn's development tick is discarded, not earned later.
    assert abandoned[0]["discarded_development_ticks"]["queue"] == 1
    assert abandoned[0]["discarded_development_ticks"]["archive"] == 1
    development_log = (
        campaign_ws["coc_root"]
        / "investigators"
        / campaign_ws["investigator_id"]
        / "development.jsonl"
    )
    assert development_log.read_text(encoding="utf-8") == ""

    # Turn-scoped state restored to the commit point; bout never happened.
    assert _inv_state(campaign_ws)["current_san"] == 52
    assert _inv_state(campaign_ws)["bout_active"] is False
    assert _sanity_snapshot(campaign_ws)["san_current"] == 52
    assert _sanity_snapshot(campaign_ws)["bout_active"] is False

    # Everything is now bound or dispositioned; a second resume is a no-op.
    assert coc_turn_finalization.unbound_public_roll_ids(
        campaign_ws["campaign_dir"]
    ) == []
    resumed_again = _run(campaign_ws, "session.resume", {})
    assert resumed_again["ok"] is True, resumed_again
    assert resumed_again["data"]["turn_tail_quarantine"] == {
        "quarantined_orphan_rolls": [],
        "restored_commit_snapshot": None,
        "discarded_development_ticks": {"queue": 0, "claims": 0, "archive": 0},
    }

    # The investigator is still usable: a fresh SAN check applies cleanly.
    after = _san_check(
        campaign_ws,
        decision_id="post-quarantine-san",
        seed=1,
        loss_success="1D3",
        loss_failure="1D3",
    )
    assert after["data"]["san_before"] == 52
    assert after["data"]["san_after"] == 49
