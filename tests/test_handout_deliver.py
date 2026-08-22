"""Verbatim info card delivery contracts (state.deliver_handout & friends).

Covers: idempotent delivery via decision_id, the authoritative
``delivered_handout_ids`` world field + evidence events, record_clue
same-transaction linked delivery, KP/player query projections, and the hard
secrecy boundary (undelivered card bodies never reach player projections).
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_toolbox = _load("coc_toolbox_handout_deliver", SCRIPTS / "coc_toolbox.py")
coc_starter = _load("coc_starter_handout_deliver", SCRIPTS / "coc_starter.py")


@pytest.fixture
def campaign_ws(tmp_path: Path):
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "handout-deliver-test"
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
        campaign_id=campaign_id,
        title="Handout Deliver Test",
    )
    campaign_dir = Path(quick["campaign_dir"])
    return {
        "workspace": workspace,
        "coc_root": coc_root,
        "campaign_id": campaign_id,
        "campaign_dir": campaign_dir,
        "investigator_id": quick["investigator_id"],
    }


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )


def _run(ws, tool: str, args: dict | None = None) -> dict:
    return coc_toolbox.run_tool(
        tool, ws["workspace"], ws["campaign_id"], dict(args or {}),
    )


def _install_cards(ws, *, delivered_hint_card: bool = True) -> None:
    """Register two index cards plus one keeper-facing (player_visible:false) card."""
    index = ws["campaign_dir"] / "index" / "handout-assets.json"
    _write_json(index, {
        "schema_version": 1,
        "scenario_id": "the-haunting",
        "asset_root": "assets/handouts",
        "assets": [
            {
                "asset_id": "handout-newspaper",
                "kind": "document",
                "title": "1920 Newspaper Clipping",
                "summary": "A clipping mentioning the chapel lawsuit.",
                "text": "Chapel records were moved to the county archive.",
                "localized_text": "教堂记录被移交县档案馆。",
                "when_to_deliver": "调查员在档案馆检索到剪报时",
                "source_refs": ["pdf_index-16"],
                "player_visible": True,
            },
            {
                "asset_id": "handout-kp-notes",
                "kind": "document",
                "title": "KP 侧手稿批注",
                "summary": "Keeper-facing marginalia.",
                "text": "KP ONLY MARGINALIA about the chapel lawsuit.",
                "when_to_deliver": "永不向玩家出示",
                "source_refs": ["pdf_index-17"],
                "player_visible": False,
            },
        ],
        "display": {},
    })
    store = ws["campaign_dir"] / "scenario" / "handouts.json"
    _write_json(store, {"schema_version": 1, "handouts": [
        {
            "asset_id": "handout-cellar-map",
            "kind": "map",
            "title": "宅邸地下室草图",
            "image_ref": "images/map-supply/cellar.png",
            "player_visible": True,
            "source_refs": ["pdf_index-21"],
        },
    ]})


def _world(ws) -> dict:
    return json.loads(
        (ws["campaign_dir"] / "save" / "world-state.json").read_text(encoding="utf-8")
    )


def _events(ws) -> list[dict]:
    path = ws["campaign_dir"] / "logs" / "events.jsonl"
    if not path.is_file():
        return []
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


# ---------------------------------------------------------------- delivery


def test_deliver_handout_writes_authoritative_state_and_evidence(campaign_ws):
    _install_cards(campaign_ws)

    result = _run(campaign_ws, "state.deliver_handout", {
        "handout_id": "handout-newspaper",
        "decision_id": "deliver-1",
        "scene_id": "scene-archive",
        "reason": "调查员翻阅档案找到剪报",
    })

    assert result["ok"] is True, result
    data = result["data"]
    assert data["newly_delivered"] == ["handout-newspaper"]
    assert data["card"]["text"] == "教堂记录被移交县档案馆。"
    world = _world(campaign_ws)
    assert world["delivered_handout_ids"] == ["handout-newspaper"]
    events = [e for e in _events(campaign_ws) if e.get("event_type") == "handout_delivered"]
    assert len(events) == 1
    assert events[0]["source"] == "state.deliver_handout"
    assert events[0]["scene_id"] == "scene-archive"
    assert events[0]["reason"] == "调查员翻阅档案找到剪报"


def test_deliver_handout_is_idempotent_by_decision_id(campaign_ws):
    _install_cards(campaign_ws)
    args = {
        "handout_id": "handout-newspaper",
        "decision_id": "deliver-once",
    }
    first = _run(campaign_ws, "state.deliver_handout", args)
    second = _run(campaign_ws, "state.deliver_handout", args)

    assert first["ok"] is True and second["ok"] is True
    assert second["data"] == first["data"]
    assert any("duplicate decision_id" in w for w in second["warnings"])
    world = _world(campaign_ws)
    assert world["delivered_handout_ids"] == ["handout-newspaper"]
    delivered_events = [
        e for e in _events(campaign_ws)
        if e.get("event_type") == "handout_delivered"
    ]
    assert len(delivered_events) == 1

    # A fresh decision_id for an already-delivered card is a no-op replay.
    again = _run(campaign_ws, "state.deliver_handout", {
        "handout_id": "handout-newspaper",
        "decision_id": "deliver-again",
    })
    assert again["data"]["already_delivered"] == ["handout-newspaper"]
    assert again["data"]["newly_delivered"] == []
    assert _world(campaign_ws)["delivered_handout_ids"] == ["handout-newspaper"]


def test_deliver_unknown_handout_fails_closed(campaign_ws):
    result = _run(campaign_ws, "state.deliver_handout", {
        "handout_id": "handout-improvised",
        "decision_id": "deliver-unknown",
    })
    assert result["ok"] is False
    assert result["error"]["code"] == "unknown_handout"
    assert "delivered_handout_ids" not in _world(campaign_ws)


def test_malformed_scenario_cards_cannot_be_queried_or_delivered(campaign_ws):
    store = campaign_ws["campaign_dir"] / "scenario" / "handouts.json"
    malformed = [
        {
            "asset_id": "bad-visible",
            "kind": "document",
            "text": "must stay secret",
            "source_refs": ["pdf_index-1"],
            "player_visible": "false",
        },
        {
            "asset_id": "bad-localized",
            "kind": "document",
            "localized_text": {"zh-Hans": "must stay secret"},
        },
        {
            "asset_id": "bad-body",
            "kind": "document",
            "text": {"body": "must stay secret"},
            "source_refs": ["pdf_index-2"],
        },
        {
            "asset_id": "bad-asset",
            "kind": "map",
            "image_ref": ["assets/handouts/secret.png"],
        },
        {
            "asset_id": 17,
            "kind": "document",
            "text": "numeric id must stay secret",
            "source_refs": ["pdf_index-3"],
        },
    ]
    _write_json(store, {"schema_version": 1, "handouts": malformed})

    keeper = _run(campaign_ws, "clues.query", {})
    player = _run(campaign_ws, "clues.query", {"handouts_projection": "player"})
    assert keeper["data"]["handouts"]["cards"] == []
    assert player["data"]["handouts"]["cards"] == []
    payload = json.dumps([keeper, player], ensure_ascii=False)
    assert "must stay secret" not in payload

    for index, handout_id in enumerate(
        ["bad-visible", "bad-localized", "bad-body", "bad-asset", "17"]
    ):
        result = _run(campaign_ws, "state.deliver_handout", {
            "handout_id": handout_id,
            "decision_id": f"reject-malformed-{index}",
        })
        assert result["ok"] is False
        assert result["error"]["code"] == "unknown_handout"
    assert "delivered_handout_ids" not in _world(campaign_ws)
    assert not [
        event for event in _events(campaign_ws)
        if event.get("event_type") == "handout_delivered"
    ]


def test_malformed_progressive_entities_cannot_be_queried_or_delivered(campaign_ws):
    scenario_path = campaign_ws["campaign_dir"] / "scenario" / "scenario.json"
    _write_json(scenario_path, {
        "schema_version": 1,
        "scenario_id": "the-haunting",
        "progressive_asset_root_id": "malformed-handouts",
    })
    entities = (
        campaign_ws["coc_root"]
        / "module-assets" / "malformed-handouts" / "entities"
    )
    malformed = {
        "entity-bad-visible": {"player_visible": "false"},
        "entity-bad-localized": {"localized_text": {"zh-Hans": "must stay secret"}},
        "entity-bad-body": {"text": {"body": "must stay secret"}},
        "entity-bad-asset": {"image_ref": ["assets/handouts/secret.png"]},
        "entity-bad-id": {"asset_id": 17},
    }
    for handout_id, override in malformed.items():
        pack = {
            "handout_id": handout_id,
            "asset_id": handout_id,
            "kind": "document",
            "text": "must stay secret",
            "source_refs": ["pdf_index-1"],
            "player_visible": True,
            "parse_state": "deep",
            "evidence_gap": False,
            **override,
        }
        _write_json(entities / f"handout-{handout_id}.json", pack)

    keeper = _run(campaign_ws, "clues.query", {})
    assert keeper["data"]["handouts"]["cards"] == []
    assert "must stay secret" not in json.dumps(keeper, ensure_ascii=False)
    for index, handout_id in enumerate(malformed):
        result = _run(campaign_ws, "state.deliver_handout", {
            "handout_id": handout_id,
            "decision_id": f"reject-malformed-entity-{index}",
        })
        assert result["ok"] is False
        assert result["error"]["code"] == "unknown_handout"
    assert "delivered_handout_ids" not in _world(campaign_ws)


# --------------------------------------------------------- clue linkage


def _add_clue_with_handout(ws) -> None:
    path = ws["campaign_dir"] / "scenario" / "clue-graph.json"
    graph = json.loads(path.read_text(encoding="utf-8"))
    graph["conclusions"].append({
        "conclusion_id": "handout-linkage-test",
        "importance": "supporting",
        "minimum_routes": 1,
        "clues": [{
            "clue_id": "clue-chapel-records",
            "delivery_kind": "handout",
            "visibility": "player-safe",
            "player_safe_summary": "档案显示教堂记录被转移。",
            "handout_asset_id": "handout-newspaper",
        }],
    })
    path.write_text(
        json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )


def test_record_clue_delivers_linked_handout_same_transaction(campaign_ws):
    _install_cards(campaign_ws)
    _add_clue_with_handout(campaign_ws)

    result = _run(campaign_ws, "state.record_clue", {
        "clue_id": "clue-chapel-records",
        "method": "archive research",
        "decision_id": "clue-1",
    })

    assert result["ok"] is True, result
    assert result["data"]["delivered_handout_id"] == "handout-newspaper"
    world = _world(campaign_ws)
    # Discovery and delivery landed in one authoritative world write.
    assert world["delivered_handout_ids"] == ["handout-newspaper"]
    assert "clue-chapel-records" in world["discovered_clue_ids"]
    events = [
        e for e in _events(campaign_ws)
        if e.get("event_type") == "handout_delivered"
    ]
    assert len(events) == 1
    assert events[0]["source"] == "clue_linkage"
    assert events[0]["clue_id"] == "clue-chapel-records"

    # Re-recording via a fresh decision_id must not duplicate the delivery.
    again = _run(campaign_ws, "state.record_clue", {
        "clue_id": "clue-chapel-records",
        "method": "recheck",
        "decision_id": "clue-2",
    })
    assert again["data"]["delivered_handout_id"] == "handout-newspaper"
    assert _world(campaign_ws)["delivered_handout_ids"] == ["handout-newspaper"]


def test_record_clue_without_card_linkage_is_unchanged(campaign_ws):
    before = _run(campaign_ws, "clues.query", {})
    assert before["ok"] is True
    assert before["data"]["handouts"]["cards"] == []

    result = _run(campaign_ws, "state.record_clue", {
        "clue_id": "clue-house-built-1835",
        "method": "library research",
        "decision_id": "clue-no-linkage",
    })
    assert result["ok"] is True
    assert result["data"]["delivered_handout_id"] is None
    assert "delivered_handout_ids" not in _world(campaign_ws)


# ------------------------------------------------------------ projections


def test_clues_query_keeper_projection_lists_all_cards(campaign_ws):
    _install_cards(campaign_ws)

    result = _run(campaign_ws, "clues.query", {})
    handouts = result["data"]["handouts"]
    assert handouts["projection"] == "keeper"
    assert handouts["delivered_handout_ids"] == []
    by_id = {card["asset_id"]: card for card in handouts["cards"]}
    assert set(by_id) == {
        "handout-newspaper", "handout-cellar-map", "handout-kp-notes",
    }
    # Keeper sees the verbatim body and the timing hint even before delivery.
    assert by_id["handout-newspaper"]["text"].startswith("Chapel records")
    assert by_id["handout-newspaper"]["when_to_deliver"] == "调查员在档案馆检索到剪报时"
    assert by_id["handout-cellar-map"]["delivered"] is False
    # Keeper-facing reference cards stay fully visible to the Keeper.
    assert by_id["handout-kp-notes"]["player_visible"] is False
    assert by_id["handout-kp-notes"]["text"].startswith("KP ONLY MARGINALIA")

    _run(campaign_ws, "state.deliver_handout", {
        "handout_id": "handout-cellar-map",
        "decision_id": "deliver-map",
    })
    after = _run(campaign_ws, "clues.query", {})
    by_id = {card["asset_id"]: card for card in after["data"]["handouts"]["cards"]}
    assert by_id["handout-cellar-map"]["delivered"] is True
    assert after["data"]["handouts"]["delivered_handout_ids"] == ["handout-cellar-map"]


def test_handout_catalog_prefers_scenario_over_asset_index(campaign_ws):
    """The campaign IR card is fresher than its imported asset-index row."""
    _install_cards(campaign_ws)
    store = campaign_ws["campaign_dir"] / "scenario" / "handouts.json"
    _write_json(store, {
        "schema_version": 1,
        "handouts": [
            {
                "asset_id": "handout-newspaper",
                "kind": "document",
                "title": "Scenario-projected clipping",
                "text": "Scenario IR replaces the older imported card body.",
                "localized_text": "战役 IR 覆盖较旧的导入卡片正文。",
                "source_refs": ["pdf_index-18"],
                "player_visible": True,
            },
        ],
    })

    result = _run(campaign_ws, "clues.query", {})

    cards = {
        card["asset_id"]: card for card in result["data"]["handouts"]["cards"]
    }
    assert cards["handout-newspaper"]["title"] == "Scenario-projected clipping"
    assert cards["handout-newspaper"]["text"] == (
        "Scenario IR replaces the older imported card body."
    )


def test_player_projection_hides_undelivered_and_keeper_facing_cards(campaign_ws):
    _install_cards(campaign_ws)
    # Deliver the player-visible map card only. The keeper-facing card is
    # force-delivered straight into world state to prove the player
    # projection stays fail-closed even against a corrupted delivery set.
    _run(campaign_ws, "state.deliver_handout", {
        "handout_id": "handout-cellar-map",
        "decision_id": "deliver-map",
    })
    world_path = campaign_ws["campaign_dir"] / "save" / "world-state.json"
    world = json.loads(world_path.read_text(encoding="utf-8"))
    # Force the keeper-facing card into the delivered set to prove the
    # player projection stays fail-closed even against a corrupted set.
    world["delivered_handout_ids"] = ["handout-cellar-map", "handout-kp-notes"]
    world_path.write_text(json.dumps(world, ensure_ascii=False), encoding="utf-8")

    result = _run(campaign_ws, "clues.query", {
        "handouts_projection": "player",
    })
    handouts = result["data"]["handouts"]
    assert handouts["projection"] == "player"
    # Only delivered AND player-visible cards appear at all.
    assert [card["asset_id"] for card in handouts["cards"]] == ["handout-cellar-map"]
    card = handouts["cards"][0]
    assert card["delivered"] is True
    assert card["image_ref"] == "images/map-supply/cellar.png"

    # Neither the undelivered card's nor the keeper-facing card's verbatim
    # body may leak anywhere in the player projection payload.
    payload = json.dumps(result["data"], ensure_ascii=False)
    assert "Chapel records were moved" not in payload
    assert "教堂记录被移交县档案馆" not in payload
    assert "handout-newspaper" not in payload
    assert "KP ONLY MARGINALIA" not in payload
    assert "handout-kp-notes" not in payload


def test_deliver_handout_refuses_keeper_facing_card(campaign_ws):
    _install_cards(campaign_ws)

    result = _run(campaign_ws, "state.deliver_handout", {
        "handout_id": "handout-kp-notes",
        "decision_id": "deliver-kp-notes",
    })

    assert result["ok"] is False
    assert result["error"]["code"] == "handout_not_player_visible"
    # Refusal is fail-closed: no delivery write, no evidence event.
    assert "delivered_handout_ids" not in _world(campaign_ws)
    assert not [
        e for e in _events(campaign_ws)
        if e.get("event_type") == "handout_delivered"
    ]


def test_record_clue_linkage_skips_keeper_facing_card(campaign_ws):
    _install_cards(campaign_ws)
    path = campaign_ws["campaign_dir"] / "scenario" / "clue-graph.json"
    graph = json.loads(path.read_text(encoding="utf-8"))
    graph["conclusions"].append({
        "conclusion_id": "kp-notes-linkage-test",
        "importance": "supporting",
        "minimum_routes": 1,
        "clues": [{
            "clue_id": "clue-kp-marginalia",
            "delivery_kind": "handout",
            "visibility": "player-safe",
            "player_safe_summary": "档案馆页边有批注。",
            "handout_asset_id": "handout-kp-notes",
        }],
    })
    path.write_text(
        json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
    )

    result = _run(campaign_ws, "state.record_clue", {
        "clue_id": "clue-kp-marginalia",
        "method": "archive research",
        "decision_id": "clue-kp-notes",
    })

    assert result["ok"] is True, result
    assert result["data"]["delivered_handout_id"] is None
    assert any(
        "player_visible:false" in hint for hint in result["hints"]
    )
    assert "delivered_handout_ids" not in _world(campaign_ws)
    assert not [
        e for e in _events(campaign_ws)
        if e.get("event_type") == "handout_delivered"
    ]


def test_player_projection_prefers_localized_text(campaign_ws):
    _install_cards(campaign_ws)
    _run(campaign_ws, "state.deliver_handout", {
        "handout_id": "handout-newspaper",
        "decision_id": "deliver-news",
    })
    result = _run(campaign_ws, "clues.query", {"handouts_projection": "player"})
    card = result["data"]["handouts"]["cards"][0]
    assert card["text"] == "教堂记录被移交县档案馆。"
    assert card["localized_text"] == "教堂记录被移交县档案馆。"
