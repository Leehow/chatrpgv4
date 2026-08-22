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
            "localized_text": {"zh-Hans": ["must stay secret"]},
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
        "entity-bad-localized": {
            "localized_text": {"zh-Hans": ["must stay secret"]}
        },
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
    assert [
        card["asset_id"] for card in keeper["data"]["handouts"]["cards"]
    ] == ["handout-globe-unpublished-1918"]
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


def _append_handout_clue(
    ws,
    *,
    clue_id: str,
    handout_asset_id: str | None = None,
) -> None:
    path = ws["campaign_dir"] / "scenario" / "clue-graph.json"
    graph = json.loads(path.read_text(encoding="utf-8"))
    clue = {
        "clue_id": clue_id,
        "delivery_kind": "handout",
        "visibility": "player-safe",
        "player_safe_summary": f"Player-safe summary for {clue_id}.",
    }
    if handout_asset_id is not None:
        clue["handout_asset_id"] = handout_asset_id
    graph["conclusions"].append({
        "conclusion_id": f"conclusion-{clue_id}",
        "importance": "supporting",
        "minimum_routes": 1,
        "clues": [clue],
    })
    _write_json(path, graph)


def _install_deep_cards(ws, cards: list[dict]) -> None:
    root_id = "deep-linked-handouts"
    _write_json(ws["campaign_dir"] / "scenario" / "scenario.json", {
        "schema_version": 1,
        "scenario_id": "the-haunting",
        "progressive_asset_root_id": root_id,
    })
    entities = ws["coc_root"] / "module-assets" / root_id / "entities"
    for card in cards:
        asset_id = card["asset_id"]
        _write_json(entities / f"handout-{asset_id}.json", {
            "handout_id": asset_id,
            "kind": "document",
            "title": f"Deep card {asset_id}",
            "text": f"Exact deep body for {asset_id}.",
            "localized_text": f"{asset_id} 的深层卡片正文。",
            "source_refs": ["pdf_index-0"],
            "player_visible": True,
            "parse_state": "deep",
            "evidence_gap": False,
            **card,
        })


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


def test_fresh_quick_start_shipped_clues_deliver_one_card_exactly_once(
    campaign_ws,
):
    first = _run(campaign_ws, "state.record_clue", {
        "clue_id": "clue-globe-unpublished-story",
        "method": "newspaper research",
        "decision_id": "fresh-handout-first",
    })
    second = _run(campaign_ws, "state.record_clue", {
        "clue_id": "clue-macario-tragedy",
        "method": "read the same feature",
        "decision_id": "fresh-handout-second",
    })

    asset_id = "handout-globe-unpublished-1918"
    assert first["ok"] is True, first
    assert second["ok"] is True, second
    assert first["data"]["delivered_handout_id"] == asset_id
    assert second["data"]["delivered_handout_id"] == asset_id
    world = _world(campaign_ws)
    assert world["delivered_handout_ids"] == [asset_id]
    assert world["discovered_clue_ids"].count(
        "clue-globe-unpublished-story"
    ) == 1
    assert world["discovered_clue_ids"].count("clue-macario-tragedy") == 1
    delivered = [
        event for event in _events(campaign_ws)
        if event.get("event_type") == "handout_delivered"
        and event.get("asset_id") == asset_id
    ]
    assert len(delivered) == 1
    player = _run(
        campaign_ws, "clues.query", {"handouts_projection": "player"}
    )
    card = player["data"]["handouts"]["cards"][0]
    assert card["content_origin"] == "authored_derivative"
    assert card["title"].startswith("《波士顿环球报》")
    assert card["summary"].startswith("由项目贡献者")
    assert card["source_refs"] == []


def test_authored_derivative_falls_back_to_its_english_body_for_english_play(
    campaign_ws,
):
    campaign_path = campaign_ws["campaign_dir"] / "campaign.json"
    campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    campaign["play_language"] = "en"
    _write_json(campaign_path, campaign)

    result = _run(campaign_ws, "state.record_clue", {
        "clue_id": "clue-globe-unpublished-story",
        "method": "newspaper research",
        "decision_id": "english-authored-prop",
    })

    assert result["ok"] is True, result
    card = result["data"]["delivered_handout_id"]
    assert card == "handout-globe-unpublished-1918"
    player = _run(
        campaign_ws, "clues.query", {"handouts_projection": "player"}
    )["data"]["handouts"]["cards"][0]
    assert player["title"].startswith("Boston Globe")
    assert player["text"].startswith("BOSTON GLOBE")
    assert "波士顿" not in json.dumps(player, ensure_ascii=False)


def test_authored_derivative_uses_japanese_fields_for_japanese_play(campaign_ws):
    campaign_path = campaign_ws["campaign_dir"] / "campaign.json"
    campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    campaign["play_language"] = "ja-JP"
    _write_json(campaign_path, campaign)

    result = _run(campaign_ws, "state.record_clue", {
        "clue_id": "clue-globe-unpublished-story",
        "method": "新聞調査",
        "decision_id": "japanese-authored-prop",
    })

    assert result["ok"] is True, result
    player = _run(
        campaign_ws, "clues.query", {"handouts_projection": "player"}
    )["data"]["handouts"]["cards"][0]
    assert player["title"].startswith("『ボストン・グローブ』")
    assert player["text"].startswith("『ボストン・グローブ』")
    assert "波士顿" not in json.dumps(player, ensure_ascii=False)


@pytest.mark.parametrize("write_order", ["clue-first", "card-first"])
def test_record_clue_resolves_unique_deep_card_reverse_ref_in_either_merge_order(
    campaign_ws,
    write_order,
):
    clue_id = f"clue-deep-reverse-{write_order}"
    card = {
        "asset_id": f"handout-deep-reverse-{write_order}",
        "clue_refs": [clue_id],
    }
    if write_order == "clue-first":
        _append_handout_clue(campaign_ws, clue_id=clue_id)
        _install_deep_cards(campaign_ws, [card])
    else:
        _install_deep_cards(campaign_ws, [card])
        _append_handout_clue(campaign_ws, clue_id=clue_id)

    first = _run(campaign_ws, "state.record_clue", {
        "clue_id": clue_id,
        "method": "source-backed research",
        "decision_id": f"discover-{write_order}",
    })
    replay = _run(campaign_ws, "state.record_clue", {
        "clue_id": clue_id,
        "method": "source-backed research",
        "decision_id": f"discover-{write_order}",
    })

    assert first["ok"] is True, first
    assert first["data"]["delivered_handout_id"] == card["asset_id"]
    assert replay["data"] == first["data"]
    world = _world(campaign_ws)
    assert world["discovered_clue_ids"].count(clue_id) == 1
    assert world["delivered_handout_ids"].count(card["asset_id"]) == 1
    delivery_events = [
        event for event in _events(campaign_ws)
        if event.get("event_type") == "handout_delivered"
        and event.get("asset_id") == card["asset_id"]
    ]
    assert len(delivery_events) == 1


@pytest.mark.parametrize(
    ("explicit_id", "cards", "error_code"),
    [
        (None, [], "handout_link_missing"),
        (
            None,
            [{
                "asset_id": "handout-near-match",
                "clue_refs": ["clue-bad-link-extra"],
                "when_to_deliver": "prose mentions clue-bad-link",
            }],
            "handout_link_missing",
        ),
        ("handout-unknown", [], "unknown_handout"),
        (
            "handout-explicit",
            [
                {"asset_id": "handout-explicit"},
                {"asset_id": "handout-reverse", "clue_refs": ["clue-bad-link"]},
            ],
            "handout_link_conflict",
        ),
        (
            None,
            [
                {"asset_id": "handout-a", "clue_refs": ["clue-bad-link"]},
                {"asset_id": "handout-b", "clue_refs": ["clue-bad-link"]},
            ],
            "handout_link_ambiguous",
        ),
        (
            None,
            [{
                "asset_id": "handout-hidden",
                "clue_refs": ["clue-bad-link"],
                "player_visible": False,
            }],
            "handout_not_player_visible",
        ),
    ],
)
def test_record_clue_invalid_handout_link_warns_but_preserves_discovery(
    campaign_ws,
    explicit_id,
    cards,
    error_code,
):
    _append_handout_clue(
        campaign_ws,
        clue_id="clue-bad-link",
        handout_asset_id=explicit_id,
    )
    if cards:
        _install_deep_cards(campaign_ws, cards)
    result = _run(campaign_ws, "state.record_clue", {
        "clue_id": "clue-bad-link",
        "method": "invalid structured linkage",
        "decision_id": f"reject-{error_code}",
    })

    assert result["ok"] is True, result
    assert result["data"]["delivered_handout_id"] is None
    assert result["data"]["handout_delivery_warning"]["code"] == error_code
    assert any(error_code in warning for warning in result["warnings"])
    world = _world(campaign_ws)
    assert "clue-bad-link" in world["discovered_clue_ids"]
    assert "delivered_handout_ids" not in world
    assert [
        event for event in _events(campaign_ws)
        if event.get("event_type") == "clue_discovered"
        and event.get("clue_id") == "clue-bad-link"
    ]
    assert not [
        event for event in _events(campaign_ws)
        if event.get("event_type") == "handout_delivered"
        and event.get("clue_id") == "clue-bad-link"
    ]


def test_record_clue_optional_companion_card_failure_preserves_discovery(
    campaign_ws,
):
    _append_handout_clue(
        campaign_ws,
        clue_id="clue-optional-card",
        handout_asset_id="handout-missing-companion",
    )
    path = campaign_ws["campaign_dir"] / "scenario" / "clue-graph.json"
    graph = json.loads(path.read_text(encoding="utf-8"))
    graph["conclusions"][-1]["clues"][0]["delivery_kind"] = "obvious"
    _write_json(path, graph)

    result = _run(campaign_ws, "state.record_clue", {
        "clue_id": "clue-optional-card",
        "method": "ordinary discovery with broken companion metadata",
        "decision_id": "optional-card-failure",
    })

    assert result["ok"] is True, result
    assert result["data"]["delivered_handout_id"] is None
    assert "handout_delivery_warning" in result["data"], result
    assert result["data"]["handout_delivery_warning"]["code"] == "unknown_handout"
    world = _world(campaign_ws)
    assert "clue-optional-card" in world["discovered_clue_ids"]
    assert "delivered_handout_ids" not in world


def test_record_clue_without_card_linkage_is_unchanged(campaign_ws):
    before = _run(campaign_ws, "clues.query", {})
    assert before["ok"] is True
    assert [
        card["asset_id"] for card in before["data"]["handouts"]["cards"]
    ] == ["handout-globe-unpublished-1918"]

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


def test_deep_handout_wins_over_scenario_and_index_for_keeper_and_player(
    campaign_ws,
):
    """The freshest valid deep entity wins the complete public-tool path."""
    _install_cards(campaign_ws)
    store = campaign_ws["campaign_dir"] / "scenario" / "handouts.json"
    _write_json(store, {
        "schema_version": 1,
        "handouts": [
            {
                "asset_id": "handout-newspaper",
                "kind": "document",
                "title": "Scenario clipping",
                "text": "Scenario IR card body.",
                "localized_text": "战役 IR 卡片正文。",
                "source_refs": ["pdf_index-18"],
                "player_visible": True,
            },
        ],
    })
    scenario_path = campaign_ws["campaign_dir"] / "scenario" / "scenario.json"
    _write_json(scenario_path, {
        "schema_version": 1,
        "scenario_id": "the-haunting",
        "progressive_asset_root_id": "deep-priority-handouts",
    })
    deep_card = (
        campaign_ws["coc_root"]
        / "module-assets"
        / "deep-priority-handouts"
        / "entities"
        / "handout-handout-newspaper.json"
    )
    _write_json(deep_card, {
        "handout_id": "handout-newspaper",
        "asset_id": "handout-newspaper",
        "kind": "document",
        "content_origin": "source_verbatim",
        "title": "Deep clipping",
        "text": "Deep entity card body.",
        "localized_text": "深层实体卡片正文。",
        "source_refs": ["pdf_index-19"],
        "player_visible": True,
        "parse_state": "deep",
        "evidence_gap": False,
    })

    keeper = _run(campaign_ws, "clues.query", {})
    keeper_cards = {
        card["asset_id"]: card for card in keeper["data"]["handouts"]["cards"]
    }
    assert keeper_cards["handout-newspaper"]["title"] == "Deep clipping"
    assert keeper_cards["handout-newspaper"]["text"] == "Deep entity card body."

    delivered = _run(campaign_ws, "state.deliver_handout", {
        "handout_id": "handout-newspaper",
        "decision_id": "deliver-deep-priority-card",
    })
    assert delivered["ok"] is True, delivered
    assert delivered["data"]["card"]["text"] == "深层实体卡片正文。"
    player = _run(campaign_ws, "clues.query", {"handouts_projection": "player"})
    assert player["data"]["handouts"]["cards"] == [
        {
            "asset_id": "handout-newspaper",
            "kind": "document",
            "content_origin": "source_verbatim",
            "title": "Deep clipping",
            "text": "深层实体卡片正文。",
            "localized_text": "深层实体卡片正文。",
            "image_ref": None,
            "source_refs": ["pdf_index-19"],
            "player_visible": True,
            "delivered": True,
            "secret": False,
        },
    ]


def test_table_opening_lists_only_valid_visible_undelivered_cards(campaign_ws):
    """Opening evidence exposes stable metadata, never bodies or hidden cards."""
    index = campaign_ws["campaign_dir"] / "index" / "handout-assets.json"
    _write_json(index, {
        "schema_version": 1,
        "scenario_id": "the-haunting",
        "asset_root": "assets/handouts",
        "assets": [
            {
                "asset_id": "opening-zulu",
                "kind": "document",
                "title": "Zulu opening card",
                "text": "Zulu body must stay outside pending metadata.",
                "source_refs": ["pdf_index-30"],
                "player_visible": True,
                "opening_card": True,
                "when_to_deliver": "when the envelope is opened",
            },
            {
                "asset_id": "opening-alpha",
                "kind": "read_aloud",
                "title": "Alpha opening card",
                "text": "Alpha body must stay outside pending metadata.",
                "source_refs": ["pdf_index-31"],
                "player_visible": True,
                "opening_card": True,
                "when_to_deliver": "as the table opens",
            },
            {
                "asset_id": "opening-delivered",
                "kind": "document",
                "title": "Already delivered",
                "text": "Already delivered body.",
                "source_refs": ["pdf_index-32"],
                "player_visible": True,
                "opening_card": True,
            },
            {
                "asset_id": "opening-hidden",
                "kind": "document",
                "title": "Keeper opening note",
                "text": "Hidden opening body.",
                "source_refs": ["pdf_index-33"],
                "player_visible": False,
                "opening_card": True,
            },
            {
                "asset_id": "opening-malformed",
                "kind": "document",
                "title": "Malformed opening card",
                "text": "Malformed opening body.",
                "source_refs": ["pdf_index-34"],
                "player_visible": True,
                "opening_card": "true",
            },
            {
                "asset_id": "not-an-opening-card",
                "kind": "document",
                "title": "Later card",
                "text": "Later card body.",
                "source_refs": ["pdf_index-35"],
                "player_visible": True,
                "opening_card": False,
            },
        ],
        "display": {},
    })
    delivered = _run(campaign_ws, "state.deliver_handout", {
        "handout_id": "opening-delivered",
        "decision_id": "deliver-before-opening",
    })
    assert delivered["ok"] is True, delivered

    opening = _run(campaign_ws, "evidence.table_opening", {
        "text": "[in_game]\n测试开场。\n[/in_game]",
        "run_id": "handout-opening-run",
        "presented_roll_ids": [],
        "decision_id": "handout-opening-evidence",
    })

    assert opening["ok"] is True, opening
    assert opening["data"]["pending_opening_handouts"] == [
        {
            "asset_id": "opening-alpha",
            "kind": "read_aloud",
            "title": "Alpha opening card",
            "when_to_deliver": "as the table opens",
        },
        {
            "asset_id": "opening-zulu",
            "kind": "document",
            "title": "Zulu opening card",
            "when_to_deliver": "when the envelope is opened",
        },
    ]
    pending_payload = json.dumps(
        opening["data"]["pending_opening_handouts"], ensure_ascii=False
    )
    assert "body" not in pending_payload
    assert "opening-hidden" not in pending_payload
    assert "opening-delivered" not in pending_payload
    assert "opening-malformed" not in pending_payload
    assert "not-an-opening-card" not in pending_payload


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


def test_record_clue_linkage_skips_keeper_card_but_keeps_discovery(campaign_ws):
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
    assert result["data"]["handout_delivery_warning"]["code"] == "handout_not_player_visible"
    assert "clue-kp-marginalia" in _world(campaign_ws)["discovered_clue_ids"]
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
