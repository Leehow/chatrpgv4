"""CORE mechanics canonical-events wiring tests (plan task t3).

Every wired typed operation on a fixture campaign asserts envelope type,
payload fidelity to already-authoritative inputs/results, privacy, sequence
ordering, idempotent replay (no duplicate events), and that a failed mutation
leaves no canonical event behind.

Loads the scripts the way production consumers do: plain ``sys.path``
insertion against ``plugins/coc-keeper/scripts``, sharing one emission
runtime instance across ``coc_state``/``coc_toolbox`` and these tests.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_canonical_events as cem
import coc_starter
import coc_toolbox

CAMPAIGN = "wiring-core-test"


@pytest.fixture(autouse=True)
def _fresh_emission_runtime():
    cem.reset_emission_runtime_state()
    yield
    cem.reset_emission_runtime_state()


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )


@pytest.fixture()
def ws(tmp_path: Path) -> dict[str, object]:
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    _write_json(coc_root / "runtime.json", {
        "schema_version": 2,
        "planner": {"kind": "deterministic"},
        "rules": {"kind": "deterministic"},
        "narrator": {"kind": "template"},
        "player": {"kind": "human"},
    })
    quick = coc_starter.quick_start(
        coc_root,
        "the-haunting",
        "thomas-hayes",
        campaign_id=CAMPAIGN,
        title="Canonical Wiring Core Test",
    )
    return {
        "workspace": workspace,
        "campaign_id": CAMPAIGN,
        "campaign_dir": Path(quick["campaign_dir"]),
        "investigator_id": str(quick["investigator_id"]),
    }


def _call(ws: dict[str, object], tool: str, args: dict | None = None) -> dict:
    return coc_toolbox.run_tool(
        tool, Path(ws["workspace"]), str(ws["campaign_id"]), dict(args or {}),
    )


def _ok(ws: dict[str, object], tool: str, args: dict | None = None) -> dict:
    result = _call(ws, tool, args)
    assert result.get("ok") is True, {tool: result.get("error")}
    return result


def _stream_rows(ws: dict[str, object]) -> list[dict]:
    stream = (
        Path(ws["campaign_dir"]) / "logs" / cem.CANONICAL_STREAM_NAME
    )
    if not stream.is_file():
        return []
    return [
        json.loads(line)
        for line in stream.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def _rows_of_type(ws: dict[str, object], event_type: str) -> list[dict]:
    return [row for row in _stream_rows(ws) if row.get("type") == event_type]


# ---------------------------------------------------------------------------
# Envelope invariants shared by every wired site
# ---------------------------------------------------------------------------


def test_all_wired_rows_are_valid_ordered_events(ws: dict[str, object]) -> None:
    _ok(ws, "rules.roll", {
        "investigator": ws["investigator_id"],
        "skill": "Library Use",
        "difficulty": "regular",
        "goal": "从目录中找到房屋旧档案",
        "stakes": {"on_success": "找到卷宗", "on_failure": "暂时找不到"},
        "difficulty_basis": "keeper_judgment",
        "seed": 11,
        "decision_id": "seq-roll-1",
    })
    _ok(ws, "state.move_scene", {
        "scene_id": "newspaper-morgue",
        "decision_id": "seq-move-1",
        "reason": "前往调查",
    })

    rows = _stream_rows(ws)
    assert rows
    sequences = [row["sequence"] for row in rows]
    assert sequences == sorted(sequences)
    assert len(set(sequences)) == len(sequences)
    for row in rows:
        cem.validate_event(row)
        assert row["specversion"] == cem.SPECVERSION
        assert row["campaign"] == CAMPAIGN
        assert isinstance(row["turn"], int) and not isinstance(row["turn"], bool)
        assert row["turn"] >= 1
        assert isinstance(row["game_time"], str) and row["game_time"].strip()
        assert row["id"].startswith(f"{row['type']}-")
        assert row["decision_id"]


# ---------------------------------------------------------------------------
# roll-resolved
# ---------------------------------------------------------------------------


def test_roll_resolved_matches_authoritative_result(ws: dict[str, object]) -> None:
    result = _ok(ws, "rules.roll", {
        "investigator": ws["investigator_id"],
        "skill": "Library Use",
        "difficulty": "regular",
        "goal": "从目录中找到房屋旧档案",
        "stakes": {"on_success": "找到卷宗", "on_failure": "暂时找不到"},
        "difficulty_basis": "keeper_judgment",
        "seed": 11,
        "decision_id": "roll-wire-1",
    })["data"]

    events = _rows_of_type(ws, "roll-resolved")
    assert len(events) == 1
    row = events[0]
    assert row["privacy"] == "public"
    assert row["source"] == "coc_operation_kernel.rules.roll"
    # decision_id is the enclosing operation's own key.
    assert row["decision_id"] == "roll-wire-1"
    data = row["data"]
    assert data["_v"] == 1
    assert data["roll_id"] == result["roll_id"]
    assert data["check"] == result["skill"]
    assert data["actor"] == result["investigator_id"]
    assert data["result_level"] == result["outcome"]
    assert data["target_value"] == result["target"]
    # Dice rendering only from the authoritative die value.
    assert data["dice"] == f"1d100={result['roll']}"


def test_failed_mutation_leaves_no_canonical_event(ws: dict[str, object]) -> None:
    # Pre-write parameter failure.
    missing_decision = _call(ws, "state.journal", {
        "summary": "缺少幂等键的声明不能落账",
        "player_text": "我检查墙根的划痕。",
    })
    assert missing_decision.get("ok") is False
    # In-handler validation failure before any settlement write.
    bad_expression = _call(ws, "rules.sanity_check", {
        "investigator": ws["investigator_id"],
        "source": "wiring-bad-source",
        "loss_failure": "这 不是 掷骰 表达式",
        "loss_success": "0",
        "decision_id": "bad-san-1",
    })
    assert bad_expression.get("ok") is False
    assert _stream_rows(ws) == []


def test_replayed_decision_does_not_duplicate_the_event(
    ws: dict[str, object],
) -> None:
    args = {
        "investigator": ws["investigator_id"],
        "skill": "Library Use",
        "difficulty": "regular",
        "goal": "从目录中找到房屋旧档案",
        "stakes": {"on_success": "找到卷宗", "on_failure": "暂时找不到"},
        "difficulty_basis": "keeper_judgment",
        "seed": 11,
        "decision_id": "replay-roll-1",
    }
    first = _ok(ws, "rules.roll", args)["data"]
    replayed = _ok(ws, "rules.roll", args)["data"]
    assert replayed["roll_id"] == first["roll_id"]
    assert len(_rows_of_type(ws, "roll-resolved")) == 1


# ---------------------------------------------------------------------------
# sanity-changed
# ---------------------------------------------------------------------------


def _sanity_loss(ws: dict[str, object]) -> tuple[dict, dict | None]:
    for seed in range(1, 12):
        result = _ok(ws, "rules.sanity_check", {
            "investigator": ws["investigator_id"],
            "source": f"wiring-probe-{seed}",
            "loss_failure": "1D6",
            "loss_success": "0",
            "seed": seed,
            "decision_id": f"sanity-seed-{seed}",
        })["data"]
        if result["san_before"] != result["san_after"]:
            return result, next(
                (
                    row for row in _rows_of_type(ws, "sanity-changed")
                    if row["decision_id"] == f"sanity-seed-{seed}"
                ),
                None,
            )
    raise AssertionError("no deterministic SAN loss found across seeds")


def test_sanity_changed_carries_authoritative_delta(ws: dict[str, object]) -> None:
    result, event = _sanity_loss(ws)
    assert event is not None
    assert event["privacy"] == "public"
    assert event["decision_id"] == "sanity-seed-" + str(
        event["data"]["cause"]
    ).replace("wiring-probe-", "")
    data = event["data"]
    assert data["_v"] == 1
    assert data["investigator"] == result["investigator_id"]
    assert data["delta"] == result["san_after"] - result["san_before"]
    assert data["delta"] < 0
    assert data["before"] == result["san_before"]
    assert data["after"] == result["san_after"]
    assert data["cause"] == result["source"]
    if result.get("loss_roll_id"):
        assert data["source_roll_id"] == result["loss_roll_id"]


def test_zero_sanity_delta_emits_no_event(ws: dict[str, object]) -> None:
    _ok(ws, "rules.sanity_check", {
        "investigator": ws["investigator_id"],
        "source": "wiring-probe-zero",
        "loss_failure": "0",
        "loss_success": "0",
        "seed": 4,
        "decision_id": "sanity-zero-1",
    })
    assert _rows_of_type(ws, "sanity-changed") == []


# ---------------------------------------------------------------------------
# item-transferred
# ---------------------------------------------------------------------------


def test_item_transferred_to_investigator_is_public(ws: dict[str, object]) -> None:
    _ok(ws, "state.item_grant", {
        "investigator": ws["investigator_id"],
        "kind": "gear",
        "item_id": "old-flashlight",
        "label": "旧手电筒",
        "consumable": True,
        "quantity": 3,
        "note": "从储物间捡到",
        "decision_id": "grant-inv-1",
    })
    events = _rows_of_type(ws, "item-transferred")
    assert len(events) == 1
    row = events[0]
    assert row["privacy"] == "public"
    assert row["decision_id"] == "grant-inv-1"
    data = row["data"]
    assert data["item"] == "old-flashlight"
    assert data["from_holder"] == "keeper"
    assert data["to_holder"] == ws["investigator_id"]
    assert data["qty"] == 3


def test_npc_gear_grant_is_secret_keeper_evidence(ws: dict[str, object]) -> None:
    _ok(ws, "state.item_grant", {
        "npc_id": "probe-npc-1",
        "kind": "gear",
        "item_id": "hidden-revolver",
        "label": "隐藏的左轮",
        "decision_id": "grant-npc-1",
    })
    events = _rows_of_type(ws, "item-transferred")
    assert len(events) == 1
    row = events[0]
    assert row["privacy"] == "secret"
    data = row["data"]
    assert data["to_holder"] == "probe-npc-1"
    # Secret rows never reach player-facing projections.
    view_types = [entry["type"] for entry in cem.project_player_view(_stream_rows(ws))]
    assert "item-transferred" not in view_types


def test_item_remove_has_no_transfer_counterpart_yet(
    ws: dict[str, object],
) -> None:
    """Documented t3 gap: removal settles without any receiving holder, so
    no ``item-transferred`` fact exists to emit; the store keeps flowing."""
    _ok(ws, "state.item_grant", {
        "investigator": ws["investigator_id"],
        "kind": "gear",
        "item_id": "old-flashlight",
        "label": "旧手电筒",
        "decision_id": "grant-remove-setup",
    })
    granted = len(_rows_of_type(ws, "item-transferred"))
    assert granted == 1
    removed = _ok(ws, "state.item_remove", {
        "investigator": ws["investigator_id"],
        "item_id": "old-flashlight",
        "decision_id": "remove-inv-1",
    })["data"]
    assert removed["changed"] is True
    assert len(_rows_of_type(ws, "item-transferred")) == 1


def test_non_conforming_store_key_degrades_without_breaking_play(
    ws: dict[str, object],
) -> None:
    """A label-derived inventory key can violate the canonical ref grammar;
    the authoritative grant still succeeds and the fault lands in audit."""
    result = _ok(ws, "state.item_grant", {
        "investigator": ws["investigator_id"],
        "kind": "gear",
        "label": "旧手电筒",
        "decision_id": "grant-nonascii-1",
    })
    assert result["data"]["changed"] is True
    assert _rows_of_type(ws, "item-transferred") == []
    audits = [
        json.loads(line)
        for line in (
            Path(ws["campaign_dir"]) / "logs" / "events.jsonl"
        ).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert any(row.get("event_type") == "canonical_emit_failed" for row in audits)


# ---------------------------------------------------------------------------
# scene-moved / clue-discovered
# ---------------------------------------------------------------------------


def test_scene_moved_records_transition(ws: dict[str, object]) -> None:
    result = _ok(ws, "state.move_scene", {
        "scene_id": "newspaper-morgue",
        "decision_id": "move-1",
        "reason": "前往报社档案室",
    })["data"]
    events = _rows_of_type(ws, "scene-moved")
    assert len(events) == 1
    row = events[0]
    assert row["privacy"] == "public"
    assert row["decision_id"] == "move-1"
    data = row["data"]
    assert data["to_scene"] == result["to_scene_id"]
    assert data["from_scene"] == result["from_scene_id"]
    assert data["moved_by"] == "kp"


def test_clue_discovered_binds_single_party_member(ws: dict[str, object]) -> None:
    clues = _ok(ws, "clues.query")["data"]["clues"]
    clue_id = str(clues[0]["clue_id"])
    result = _ok(ws, "state.record_clue", {
        "clue_id": clue_id,
        "method": "exploration",
        "decision_id": "clue-1",
    })["data"]
    assert result["already_discovered"] is False
    events = _rows_of_type(ws, "clue-discovered")
    assert len(events) == 1
    row = events[0]
    assert row["privacy"] == "public"
    assert row["decision_id"] == "clue-1"
    data = row["data"]
    assert data["clue_id"] == clue_id
    assert data["discovered_by"] == ws["investigator_id"]
    assert data["method"] == "exploration"


# ---------------------------------------------------------------------------
# turn-started / player-declared / turn-finalized
# ---------------------------------------------------------------------------


def _journal(ws: dict[str, object], *, decision_id: str) -> dict:
    return _ok(ws, "state.journal", {
        "summary": f"玩家行动已在 {decision_id} 中得到连续回应。",
        "player_action": "按当前场景中的既定方法继续调查",
        "player_text": "我把灯压低，沿着墙根检查那些新鲜划痕。",
        "player_speaker": "玩家",
        "run_id": "wiring-core-run",
        "intent_class": "investigate",
        "decision_id": decision_id,
    })


def _finalize(ws: dict[str, object], *, decision_id: str) -> dict:
    output = _ok(ws, "turn.output_context")["data"]
    draft = "调查员把刚才声明的方法落实在眼前的场景里。\n\n环境与在场人物据此给出明确、连续而带有自身立场的回应。"
    coverage = [
        {
            "obligation_id": row["obligation_id"],
            "realization": "fictional_beat",
            "action_realization": "调查员的具体方法已经在场景中发生",
            "response": "场景和相关人物作出了有因果联系的回应",
            "causal_explanation": "回应直接来自本轮已记录的玩家行动",
            "persona_fit": "保持调查员与在场人物既有的身份和立场",
            "player_input_handling": "specific_preserved",
            "exact_excerpt": "环境与在场人物据此给出明确、连续而带有自身立场的回应。",
            "exceptional_beat": "",
        }
        for row in output["obligations"]
    ]
    placements = []
    for segment_type, source_key, after in (
        ("public_check", "roll_id", 0),
        ("state_delta", "effect_id", 1),
        ("exceptional_effect", "event_id", 1),
    ):
        rows = output["mechanics_bundle"].get(segment_type) or []
        if rows:
            placements.append({
                "after_paragraph": after,
                "segment_type": segment_type,
                "source_ids": [str(entry[source_key]) for entry in rows],
            })
    return _ok(ws, "turn.finalize", {
        "draft": draft,
        "coverage": coverage,
        "mechanics_placements": placements,
        "revision": 1,
        "decision_id": decision_id,
    })


def test_journal_emits_declared_then_turn_started(
    ws: dict[str, object],
) -> None:
    _journal(ws, decision_id="journal-wire-1")

    declared = _rows_of_type(ws, "player-declared")
    started = _rows_of_type(ws, "turn-started")
    assert len(declared) == 1
    assert len(started) == 1
    assert declared[0]["sequence"] < started[0]["sequence"]
    # Both facts share the enclosing journal transaction via its id plus a
    # deterministic fact suffix (one decision would otherwise fork two types).
    assert declared[0]["decision_id"] == "journal-wire-1-declared"
    assert started[0]["decision_id"] == "journal-wire-1-turn-started"
    assert declared[0]["data"]["declared_kind"] == "investigate"
    assert declared[0]["data"]["note"] == "按当前场景中的既定方法继续调查"
    assert started[0]["data"] == {"_v": 1}
    assert started[0]["turn"] >= 1


def test_finalize_binds_receipt_and_orders_stream_tail(
    ws: dict[str, object],
) -> None:
    roll = _ok(ws, "rules.roll", {
        "investigator": ws["investigator_id"],
        "skill": "Library Use",
        "difficulty": "regular",
        "goal": "找档案",
        "stakes": {"on_success": "找到", "on_failure": "没找到"},
        "difficulty_basis": "keeper_judgment",
        "seed": 11,
        "decision_id": "finalize-roll-1",
    })["data"]
    _journal(ws, decision_id="finalize-journal-1")
    finalized = _finalize(ws, decision_id="finalize-wire-1")["data"]

    events = _rows_of_type(ws, "turn-finalized")
    assert len(events) == 1
    row = events[0]
    assert row["privacy"] == "public"
    assert row["decision_id"] == "finalize-wire-1"
    started = _rows_of_type(ws, "turn-started")
    assert len(started) == 1
    assert row["turn"] == started[0]["turn"] >= 1
    data = row["data"]
    assert data["_v"] == 1
    assert data["finalization_id"] == finalized["finalization_id"]
    assert roll["roll_id"] in (data.get("settled_roll_ids") or [])
    # `turn-finalized` is the played turn's release boundary, not its
    # physical tail row: every same-turn authoritative event must precede
    # it, while any later same-turn rows may only be the v1-allowed
    # post-finalization advisory derivation (`memory-written`). Consumers
    # order on `type` + `sequence`, never on file-tail position.
    stream = _stream_rows(ws)
    same_turn = [entry for entry in stream if entry["turn"] == row["turn"]]
    after_finalize = same_turn[same_turn.index(row) + 1:]
    assert all(entry["type"] == "memory-written" for entry in after_finalize)
    assert all(
        entry["sequence"] < row["sequence"]
        for entry in same_turn
        if entry["type"] not in ("turn-finalized", "memory-written")
    )
