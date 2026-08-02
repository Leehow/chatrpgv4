"""Contract tests for the steward (管家) delivery + notebook state surface (0.5.1a S2).

Covers: transactional writes and decision_id idempotency for the steward.*
mutation ops, the read-op projections (keeper_only must never leak through the
player projection), notebook put/pay/即付 lifecycle, fail-closed corruption
handling, and MCP contract archive registration.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


toolbox = _load("coc_toolbox_steward_test", SCRIPTS / "coc_toolbox.py")
state = _load("coc_state_steward_test", SCRIPTS / "coc_state.py")


@pytest.fixture
def campaign(tmp_path: Path):
    root = tmp_path / "workspace"
    state.create_campaign(root, "steward-camp", "Steward Test Campaign")
    (root / ".coc" / "runtime.json").write_text(
        json.dumps({
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        }),
        encoding="utf-8",
    )
    return root


def _run(campaign, tool: str, args: dict | None = None) -> dict:
    return toolbox.run_tool(tool, campaign, "steward-camp", args or {})


def _doc(campaign) -> dict:
    return state.load_steward_state(campaign / ".coc" / "campaigns" / "steward-camp")


def _segments(extra: str = "a") -> list[dict]:
    return [{
        "text": f"模组正文片段 {extra}",
        "page": 12,
        "source_refs": ["module-assets/pdf-abc123/pages/0012.md#pdf_index-12"],
    }]


def test_steward_deliver_writes_document_and_replays_idempotently(campaign):
    first = _run(campaign, "steward.deliver", {
        "delivery_id": "del-1",
        "segments": _segments(),
        "why_now": "西尔登场，KP 需要真面目设定",
        "scene_annotation": "西尔真面目",
        "secrecy": "keeper_only",
        "created_turn": "turn-7",
        "decision_id": "steward-decision-1",
    })
    assert first["ok"] is True, first
    assert first["data"]["delivery_id"] == "del-1"
    assert first["data"]["segment_count"] == 1
    assert first["data"]["notebook_entries_paid"] == []

    document = _doc(campaign)
    record = document["deliveries"]["del-1"]
    assert record["secrecy"] == "keeper_only"
    assert record["consumed"] is False
    assert record["created_turn"] == "turn-7"
    assert record["segments"][0]["page"] == 12
    assert record["segments"][0]["source_refs"] == _segments()[0]["source_refs"]

    replay = _run(campaign, "steward.deliver", {
        "delivery_id": "del-1",
        "segments": [{"text": "不同文本", "page": None, "source_refs": ["x"]}],
        "why_now": "应被幂等忽略",
        "secrecy": "player_safe",
        "created_turn": "turn-7",
        "decision_id": "steward-decision-1",
    })
    assert replay["ok"] is True
    assert replay["data"] == first["data"]
    assert replay["warnings"] and "duplicate decision_id" in replay["warnings"][0]
    assert len(_doc(campaign)["deliveries"]) == 1
    assert _doc(campaign)["deliveries"]["del-1"]["segments"][0]["text"] == "模组正文片段 a"


def test_steward_deliver_rejects_overwrite_and_invalid_input(campaign):
    args = {
        "delivery_id": "del-1",
        "segments": _segments(),
        "why_now": "w",
        "secrecy": "keeper_only",
        "created_turn": "turn-1",
        "decision_id": "d-1",
    }
    assert _run(campaign, "steward.deliver", args)["ok"] is True

    conflict = dict(args, decision_id="d-2")
    result = _run(campaign, "steward.deliver", conflict)
    assert result["ok"] is False
    assert result["error"]["code"] == "steward_conflict"
    assert len(_doc(campaign)["deliveries"]) == 1

    bad_secrecy = dict(args, decision_id="d-3", secrecy="public")
    assert _run(campaign, "steward.deliver", bad_secrecy)["error"]["code"] == "invalid_param"

    bad_segment = dict(
        args, decision_id="d-4", delivery_id="del-bad-segment",
        segments=[{"text": "x", "page": "12", "source_refs": ["r"]}],
    )
    result = _run(campaign, "steward.deliver", bad_segment)
    assert result["ok"] is False
    assert result["error"]["code"] == "invalid_param"

    no_segments = dict(args, decision_id="d-5", delivery_id="del-no-segments", segments=None)
    result = _run(campaign, "steward.deliver", no_segments)
    assert result["ok"] is False
    assert result["error"]["code"] == "invalid_param"


def test_steward_notebook_put_pay_and_deliver_payoff(campaign):
    put = _run(campaign, "steward.notebook_put", {
        "entry_id": "nb-xier",
        "scene_annotation": "西尔真面目",
        "segments": _segments("b"),
        "note": "西尔登场时即付",
        "decision_id": "nb-decision-1",
    })
    assert put["ok"] is True, put
    assert put["data"]["paid"] is False

    nb = _run(campaign, "steward.notebook", {"scene_annotation": "西尔真面目"})
    assert nb["ok"] is True
    assert nb["data"]["count"] == 1
    entry = nb["data"]["entries"][0]
    assert entry["entry_id"] == "nb-xier"
    assert entry["paid"] is False
    assert entry["note"] == "西尔登场时即付"

    # 即付: steward.deliver with notebook_entry_ids pays the entry and links it.
    delivered = _run(campaign, "steward.deliver", {
        "delivery_id": "del-xier",
        "why_now": "西尔真面目登场",
        "scene_annotation": "西尔真面目",
        "secrecy": "keeper_only",
        "created_turn": "turn-9",
        "notebook_entry_ids": ["nb-xier"],
        "decision_id": "payoff-decision-1",
    })
    assert delivered["ok"] is True, delivered
    assert delivered["data"]["notebook_entries_paid"] == ["nb-xier"]
    # segments derived from the notebook entry when none are provided
    assert delivered["data"]["segment_count"] == 1

    document = _doc(campaign)
    assert document["deliveries"]["del-xier"]["segments"][0]["text"] == "模组正文片段 b"
    assert document["notebook"]["nb-xier"]["paid"] is True
    assert document["notebook"]["nb-xier"]["paid_delivery_id"] == "del-xier"
    assert document["notebook"]["nb-xier"]["paid_turn"] is not None

    # Paid entries are immutable: notebook_put on a paid entry fails closed.
    result = _run(campaign, "steward.notebook_put", {
        "entry_id": "nb-xier",
        "scene_annotation": "西尔真面目",
        "segments": _segments("c"),
        "decision_id": "nb-decision-2",
    })
    assert result["ok"] is False
    assert result["error"]["code"] == "steward_conflict"

    # Re-delivering the same notebook entry is also refused.
    result = _run(campaign, "steward.deliver", {
        "delivery_id": "del-xier-2",
        "why_now": "重复即付",
        "secrecy": "keeper_only",
        "created_turn": "turn-9",
        "notebook_entry_ids": ["nb-xier"],
        "decision_id": "payoff-decision-2",
    })
    assert result["ok"] is False
    assert result["error"]["code"] == "steward_conflict"


def test_steward_notebook_pay_flag_only_and_scene_scope(campaign):
    for i in range(2):
        result = _run(campaign, "steward.notebook_put", {
            "entry_id": f"nb-{i}",
            "scene_annotation": "酒馆之夜",
            "segments": _segments(str(i)),
            "decision_id": f"nb-put-{i}",
        })
        assert result["ok"] is True

    paid = _run(campaign, "steward.notebook_pay", {
        "scene_annotation": "酒馆之夜",
        "decision_id": "pay-all-1",
    })
    assert paid["ok"] is True, paid
    assert paid["data"]["paid_entries"] == ["nb-0", "nb-1"]
    assert paid["data"]["already_paid_entries"] == []
    document = _doc(campaign)
    assert document["notebook"]["nb-0"]["paid"] is True
    assert document["notebook"]["nb-1"]["paid_delivery_id"] is None  # flag only

    # Paying again is a no-op with a warning.
    again = _run(campaign, "steward.notebook_pay", {
        "scene_annotation": "酒馆之夜",
        "decision_id": "pay-all-2",
    })
    assert again["ok"] is True
    assert again["data"]["paid_entries"] == []
    assert again["data"]["already_paid_entries"] == ["nb-0", "nb-1"]
    assert again["warnings"]

    # Replay of the same decision_id is idempotent.
    replay = _run(campaign, "steward.notebook_pay", {
        "scene_annotation": "酒馆之夜",
        "decision_id": "pay-all-1",
    })
    assert replay["ok"] is True
    assert replay["data"] == paid["data"]

    # Exactly one of entry_id / scene_annotation.
    result = _run(campaign, "steward.notebook_pay", {"decision_id": "pay-none-1"})
    assert result["ok"] is False
    assert result["error"]["code"] == "invalid_param"

    # Unknown entry fails closed.
    result = _run(campaign, "steward.notebook_pay", {
        "entry_id": "nb-missing",
        "decision_id": "pay-missing-1",
    })
    assert result["ok"] is False
    assert result["error"]["code"] == "invalid_param"

    # include_paid=false hides paid entries.
    view = _run(campaign, "steward.notebook", {"include_paid": False})
    assert view["ok"] is True
    assert view["data"]["count"] == 0


def test_steward_deliveries_projection_never_leaks_keeper_only(campaign):
    _run(campaign, "steward.deliver", {
        "delivery_id": "del-secret",
        "segments": [{
            "text": "房间暗格里藏着一本《死者之书》",
            "page": 40,
            "source_refs": ["module-assets/pdf-abc123/pages/0040.md"],
        }],
        "why_now": "KP 需知道暗格内容",
        "scene_annotation": "书房搜查",
        "secrecy": "keeper_only",
        "created_turn": "turn-3",
        "decision_id": "del-secret-1",
    })
    _run(campaign, "steward.deliver", {
        "delivery_id": "del-handout",
        "segments": [{
            "text": "信纸上的字迹：『明晚子时，码头仓库见。』",
            "page": 21,
            "source_refs": ["module-assets/pdf-abc123/pages/0021.md"],
        }],
        "why_now": "可交给玩家的信",
        "scene_annotation": "码头线索",
        "secrecy": "player_safe",
        "created_turn": "turn-4",
        "decision_id": "del-handout-1",
    })

    keeper = _run(campaign, "steward.deliveries")
    assert keeper["ok"] is True
    assert keeper["data"]["projection"] == "keeper"
    assert keeper["data"]["count"] == 2
    by_id = {row["delivery_id"]: row for row in keeper["data"]["deliveries"]}
    assert "房间暗格里藏着一本《死者之书》" in by_id["del-secret"]["segments"][0]["text"]
    assert by_id["del-secret"]["why_now"] == "KP 需知道暗格内容"

    player = _run(campaign, "steward.deliveries", {"projection": "player"})
    assert player["ok"] is True
    assert player["data"]["projection"] == "player"
    rows = {row["delivery_id"]: row for row in player["data"]["deliveries"]}
    assert rows["del-secret"]["withheld"] is True
    assert rows["del-secret"]["segment_count"] == 1
    assert "segments" not in rows["del-secret"]
    assert "why_now" not in rows["del-secret"]
    assert rows["del-handout"]["segments"][0]["text"] == "信纸上的字迹：『明晚子时，码头仓库见。』"
    assert "why_now" not in rows["del-handout"]

    payload = json.dumps(player, ensure_ascii=False)
    assert "死者之书" not in payload
    assert "暗格" not in payload
    assert "KP 需知道暗格内容" not in payload

    single = _run(campaign, "steward.deliveries", {"delivery_id": "del-secret"})
    assert single["ok"] is True
    assert single["data"]["count"] == 1
    missing = _run(campaign, "steward.deliveries", {"delivery_id": "nope"})
    assert missing["ok"] is False
    assert missing["error"]["code"] == "invalid_param"


def test_steward_mark_consumed_separates_current_from_history(campaign):
    for i in range(2):
        result = _run(campaign, "steward.deliver", {
            "delivery_id": f"del-{i}",
            "segments": _segments(str(i)),
            "why_now": "w",
            "secrecy": "player_safe",
            "created_turn": f"turn-{i}",
            "decision_id": f"del-{i}-1",
        })
        assert result["ok"] is True

    marked = _run(campaign, "steward.mark_consumed", {
        "delivery_id": "del-0",
        "decision_id": "consume-1",
    })
    assert marked["ok"] is True, marked
    assert marked["data"]["consumed"] is True
    assert marked["data"]["consumed_turn"] is not None
    assert _doc(campaign)["deliveries"]["del-0"]["consumed"] is True

    current = _run(campaign, "steward.deliveries", {"include_consumed": False})
    assert [row["delivery_id"] for row in current["data"]["deliveries"]] == ["del-1"]
    history = _run(campaign, "steward.deliveries", {"include_consumed": True})
    assert history["data"]["count"] == 2

    # Already-consumed mark is a no-op with a warning; replay is idempotent.
    again = _run(campaign, "steward.mark_consumed", {
        "delivery_id": "del-0",
        "decision_id": "consume-2",
    })
    assert again["ok"] is True
    assert again["warnings"]
    replay = _run(campaign, "steward.mark_consumed", {
        "delivery_id": "del-0",
        "decision_id": "consume-1",
    })
    assert replay["data"] == marked["data"]

    missing = _run(campaign, "steward.mark_consumed", {
        "delivery_id": "nope",
        "decision_id": "consume-3",
    })
    assert missing["ok"] is False
    assert missing["error"]["code"] == "invalid_param"


def test_steward_document_corruption_fails_closed_without_overwrite(campaign):
    _run(campaign, "steward.deliver", {
        "delivery_id": "del-1",
        "segments": _segments(),
        "why_now": "w",
        "secrecy": "player_safe",
        "created_turn": "turn-1",
        "decision_id": "d-1",
    })
    path = campaign / ".coc" / "campaigns" / "steward-camp" / "save" / "steward-state.json"
    original = path.read_bytes()
    broken = b'{"schema_version": 1, "campaign_id": "steward-camp", "deliveries": {}, "notebook": "broken"}'
    path.write_bytes(broken)

    result = _run(campaign, "steward.deliveries")
    assert result["ok"] is False
    assert result["error"]["code"] == "state_corrupt"
    result = _run(campaign, "steward.notebook_put", {
        "scene_annotation": "x",
        "segments": _segments(),
        "decision_id": "nb-1",
    })
    assert result["ok"] is False
    assert result["error"]["code"] == "state_corrupt"
    assert path.read_bytes() == broken


def test_steward_ops_registered_in_mcp_contract_archive(campaign):
    archive_mod = _load(
        "coc_mcp_contract_archive_steward_test",
        SCRIPTS / "coc_mcp_contract_archive.py",
    )
    archive_path = SCRIPTS.parent / "references" / "mcp-operation-contracts.json"
    on_disk = archive_mod.load_and_validate(archive_path, toolbox)
    rebuilt = archive_mod.build_archive(toolbox)

    steward_ops = sorted(
        name for name in on_disk["operations"] if name.startswith("steward.")
    )
    assert steward_ops == [
        "steward.deliver",
        "steward.deliveries",
        "steward.mark_consumed",
        "steward.notebook",
        "steward.notebook_pay",
        "steward.notebook_put",
    ]
    assert on_disk["content_sha256"] == rebuilt["content_sha256"]

    deliver_contract = on_disk["operations"]["steward.deliver"]
    assert "decision_id" in deliver_contract["inputSchema"]["required"]
    assert deliver_contract["inputSchema"]["properties"]["secrecy"]["enum"] == [
        "keeper_only", "player_safe",
    ]
    player_projection = on_disk["operations"]["steward.deliveries"]["inputSchema"][
        "properties"
    ]["projection"]
    assert player_projection["enum"] == ["keeper", "player"]
    assert deliver_contract["inputSchema"]["properties"]["segments"]["items"][
        "additionalProperties"
    ] is False
