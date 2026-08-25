"""Verbatim info card campaign IR projection contracts.

Covers: handout entities entering campaign IR (the former explicit skip),
skeleton projection writing the card store, selected-opening reprojection,
the card projection shape, and the module-init L0 opening card lifter.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
FAKE_SHA = "b" * 64


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


assets = _load("coc_module_assets_handout_proj", str(SCRIPTS / "coc_module_assets.py"))
project = _load("coc_module_project_handout_proj", str(SCRIPTS / "coc_module_project.py"))
runtime_ops = _load("coc_runtime_ops_handout_proj", str(SCRIPTS / "coc_runtime_ops.py"))
state = _load("coc_state_handout_proj", str(SCRIPTS / "coc_state.py"))


@pytest.fixture(autouse=True)
def _disable_async_queue_worker(monkeypatch):
    monkeypatch.setenv("COC_DISABLE_QUEUE_WORKER", "1")


def _skeleton():
    return {
        "schema_version": 1,
        "parse_tier": 1,
        "source": {
            "source_id": "pdf:handout-proj",
            "path": "pdf/handout-proj.pdf",
            "file_sha256": FAKE_SHA,
            "page_count": 4,
        },
        "module_identity": {"canonical_module_id": "handout-proj"},
        "start_candidates": ["opening"],
        "locations": [
            {"location_id": "opening", "title": "Opening", "parse_state": "named_only"},
            {"location_id": "library", "title": "Library", "parse_state": "named_only"},
        ],
        "edges_provisional": [],
        "npc_roster": [],
        "handouts": [],
        "threats": [],
        "conclusion_buckets": [],
        "mechanics_locator_pass_status": "pending",
        "start_clock_status": "unresolved",
    }


def _put_source_bound_skeleton(tmp_path: Path) -> dict:
    import hashlib

    pdf = tmp_path / "handout-proj.pdf"
    pdf.write_bytes(b"%PDF handout projection fixture")
    file_sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
    bundle = tmp_path / "handout-proj-src"
    bundle.mkdir()
    pages = []
    for pdf_index in range(4):
        page_bytes = f"# Page {pdf_index}\n\nfixture".encode()
        markdown_path = f"page-{pdf_index}.md"
        (bundle / markdown_path).write_bytes(page_bytes)
        pages.append({
            "pdf_index": pdf_index,
            "markdown_path": markdown_path,
            "text_sha256": hashlib.sha256(page_bytes).hexdigest(),
            "review_state": "manual_accepted",
            "parse_confidence": 0.99,
            "grep_anchors": [f"Page {pdf_index}"],
        })
    (bundle / "manifest.json").write_text(
        json.dumps({
            "schema_version": 1,
            "producer": "codex-pdf-skill",
            "source": {
                "source_id": "pdf:handout-proj",
                "title": "Handout Projection",
                "path": str(pdf),
                "file_sha256": file_sha,
                "page_count": 4,
            },
            "pages": pages,
        }),
        encoding="utf-8",
    )
    registration = assets.register_source_bundle(
        tmp_path,
        bundle,
        asset_root_id="handout-proj",
        module_identity={"canonical_module_id": "handout-proj"},
    )
    skeleton = _skeleton()
    skeleton["source"] = {
        "source_id": "pdf:handout-proj",
        "path": str(pdf),
        "file_sha256": file_sha,
        "page_count": 4,
        "producer": "codex-pdf-skill",
    }
    assets.put_skeleton(tmp_path, "handout-proj", skeleton)
    return registration


def _handout_pack(**overrides):
    pack = {
        "handout_id": "handout-letter",
        "asset_id": "handout-letter",
        "kind": "document",
        "title": "未署名的信",
        "text": "The verbatim letter body from page 2.",
        "localized_text": "第二页逐字信件正文。",
        "when_to_deliver": "调查员检查书桌时",
        "source_refs": ["pdf_index-2"],
        "clue_refs": ["clue-letter"],
        "player_visible": True,
        "parse_state": "deep",
        "evidence_gap": False,
        "origin": "source",
        "provenance": {"authority": "source_authored", "basis": "test"},
    }
    pack.update(overrides)
    return pack


def _make_campaign(tmp_path: Path, campaign_id: str = "handout-proj-camp") -> Path:
    try:
        state.create_campaign(
            tmp_path, campaign_id=campaign_id, title="Handout Proj", play_language="zh-Hans",
        )
    except TypeError:
        state.create_campaign(tmp_path, campaign_id, "Handout Proj")
    return tmp_path / ".coc" / "campaigns" / campaign_id


def test_skeleton_projection_writes_empty_card_store(tmp_path):
    assets.init_module_root(
        tmp_path, asset_root_id="handout-proj",
        identity={"canonical_module_id": "handout-proj"}, file_sha256=FAKE_SHA,
    )
    assets.put_skeleton(tmp_path, "handout-proj", _skeleton())
    camp = _make_campaign(tmp_path)

    project.project_skeleton_to_campaign(tmp_path, camp.name, "handout-proj")

    store = json.loads((camp / "scenario" / "handouts.json").read_text(encoding="utf-8"))
    assert store == {"schema_version": 1, "handouts": []}


def test_deep_handout_pack_reapplies_into_campaign_ir(tmp_path):
    _put_source_bound_skeleton(tmp_path)
    assets.put_entity(
        tmp_path, "handout-proj", "handout", "handout-letter", _handout_pack(),
    )
    camp = _make_campaign(tmp_path)

    result = project.project_skeleton_to_campaign(tmp_path, camp.name, "handout-proj")

    assert "handout:handout-letter" in result["reapplied_deep_entities"]
    store = json.loads((camp / "scenario" / "handouts.json").read_text(encoding="utf-8"))
    assert [card["asset_id"] for card in store["handouts"]] == ["handout-letter"]
    card = store["handouts"][0]
    # Player-safe card fields survive projection with contract string refs.
    assert card["kind"] == "document"
    assert card["text"] == "The verbatim letter body from page 2."
    assert card["localized_text"] == "第二页逐字信件正文。"
    assert card["source_refs"] == ["pdf_index-2"]
    assert card["clue_refs"] == ["clue-letter"]
    assert card["player_visible"] is True
    assert card["parse_state"] == "deep"
    # Machinery evidence fields do not leak into the card record.
    assert "ingest_timing" not in card
    assert "source_evidence" not in card


def test_merge_deep_entity_into_ir_supports_handout_and_upserts(tmp_path):
    ir = project.project_skeleton_to_ir(_skeleton())
    ir = project.merge_deep_entity_into_ir(
        ir, "handout", _handout_pack(),
    )
    cards = ir["handouts.json"]["handouts"]
    assert [c["asset_id"] for c in cards] == ["handout-letter"]

    # Upsert by asset_id replaces, never duplicates.
    ir = project.merge_deep_entity_into_ir(
        ir, "handout", _handout_pack(title="未署名的信（修订）"),
    )
    cards = ir["handouts.json"]["handouts"]
    assert len(cards) == 1
    assert cards[0]["title"] == "未署名的信（修订）"


@pytest.mark.parametrize(
    "merge_order",
    [("clue", "handout"), ("handout", "clue")],
)
def test_deep_clue_and_handout_merge_order_preserves_reverse_link(merge_order):
    ir = project.project_skeleton_to_ir(_skeleton())
    packs = {
        "clue": {
            "clue_id": "clue-letter",
            "conclusion_id": "conclusion-letter",
            "delivery_kind": "handout",
            "visibility": "player-safe",
            "player_safe_summary": "A letter was recovered.",
            "parse_state": "deep",
            "evidence_gap": False,
        },
        "handout": _handout_pack(),
    }

    for kind in merge_order:
        ir = project.merge_deep_entity_into_ir(ir, kind, packs[kind])

    clue = next(
        row
        for conclusion in ir["clue-graph.json"]["conclusions"]
        for row in conclusion.get("clues", [])
        if row.get("clue_id") == "clue-letter"
    )
    card = next(
        row for row in ir["handouts.json"]["handouts"]
        if row.get("asset_id") == "handout-letter"
    )
    assert "handout_asset_id" not in clue
    assert card["clue_refs"] == ["clue-letter"]


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"asset_id": ["handout-letter"]}, "asset_id"),
        ({"player_visible": "false"}, "player_visible"),
        ({"localized_text": {"zh-Hans": ["伪造正文"]}}, "localized_text"),
        ({"localized_text": {"": "伪造正文"}}, "localized_text"),
        ({"text": {"body": "not verbatim text"}}, "text"),
        ({"image_ref": ["images/letter.png"]}, "image_ref"),
    ],
)
def test_deep_handout_projection_rejects_malformed_card_shapes(overrides, field):
    with pytest.raises(project.ModuleProjectError) as excinfo:
        project.handout_card_from_pack(_handout_pack(**overrides))
    assert field in str(excinfo.value)


def test_stub_and_evidence_gap_handouts_do_not_project(tmp_path):
    _put_source_bound_skeleton(tmp_path)
    assets.put_entity(
        tmp_path, "handout-proj", "handout", "handout-stub",
        _handout_pack(
            handout_id="handout-stub", asset_id="handout-stub",
            text=None, source_refs=None, parse_state="named_only",
        ),
    )
    camp = _make_campaign(tmp_path)

    result = project.project_skeleton_to_campaign(tmp_path, camp.name, "handout-proj")

    assert not any(
        entry.startswith("handout:") for entry in result["reapplied_deep_entities"]
    )
    store = json.loads((camp / "scenario" / "handouts.json").read_text(encoding="utf-8"))
    assert store["handouts"] == []


def test_write_and_load_campaign_ir_round_trip_keeps_card_store(tmp_path):
    camp = _make_campaign(tmp_path)
    (camp / "scenario").mkdir(parents=True, exist_ok=True)
    ir = {
        "module-meta.json": {"schema_version": 1, "scenario_id": "handout-proj"},
        "story-graph.json": {"scenes": []},
        "clue-graph.json": {"conclusions": []},
        "npc-agendas.json": {"npcs": []},
        "threat-fronts.json": {"fronts": []},
        "pacing-map.json": {"curve": []},
        "improvisation-boundaries.json": {
            "invent_allowed": [], "never_invent": [], "keeper_secrets": [],
        },
        "handouts.json": {
            "schema_version": 1,
            "handouts": [project.handout_card_from_pack(_handout_pack())],
        },
    }
    project.write_ir_to_campaign(camp, ir, publish_compiled_archive=False)
    loaded = project.load_campaign_ir(camp)
    assert loaded["handouts.json"]["handouts"][0]["asset_id"] == "handout-letter"


# ------------------------------------------------------- L0 opening lifter


def test_l0_opening_handout_cards_lift_defaults_and_own_refs():
    l0 = {
        "opening_handouts": [
            # Kind remains optional, but exact source provenance does not.
            {
                "id": "briefing", "title": "开场简报", "when_to_give": "开场",
                "source_refs": ["pdf_index-1", "pdf_index-0"],
            },
            # Discovery metadata only: bodies are compiled by deepen_handout.
            {
                "id": "letter",
                "title": "未署名的信",
                "when_to_give": "递上信件时",
                "kind": "document",
                "source_refs": ["pdf_index-3"],
            },
        ],
    }
    cards = runtime_ops.l0_opening_handout_cards(l0, scene_id="opening")
    assert [card["asset_id"] for card in cards] == ["briefing", "letter"]
    assert cards[0]["kind"] == "read_aloud"
    assert cards[0]["source_refs"] == ["pdf_index-0", "pdf_index-1"]
    assert cards[0]["when_to_deliver"] == "开场"
    assert cards[0]["player_visible"] is True
    assert cards[0]["parse_state"] == "named_only"
    assert cards[0]["body_source_page_indices"] == [0, 1]
    assert cards[0]["scene_refs"] == ["opening"]
    assert cards[0]["opening_card"] is True
    assert cards[1]["kind"] == "document"
    assert cards[1]["source_refs"] == ["pdf_index-3"]
    assert cards[1]["body_source_page_indices"] == [3]
    assert "text" not in cards[1]
    assert "image_ref" not in cards[1]
    assert "provenance" not in cards[1]


def test_l0_opening_handout_card_survives_put_entity(tmp_path):
    _put_source_bound_skeleton(tmp_path)
    l0 = {"opening_handouts": [
        {
            "id": "briefing", "title": "开场简报", "when_to_give": "开场",
            "source_refs": ["pdf_index-1"],
        },
    ]}
    card = runtime_ops.l0_opening_handout_cards(l0)[0]
    stored = assets.put_entity(
        tmp_path, "handout-proj", "handout", card["handout_id"], card,
    )
    assert stored is not None
    reloaded = assets.get_entity(
        tmp_path, "handout-proj", "handout", card["handout_id"],
    )
    assert reloaded["source_refs"] == ["pdf_index-1"]
    assert reloaded["kind"] == "read_aloud"
    assert reloaded["parse_state"] == "named_only"


# ---------------------------------------------- reviewed L0 locale fields


def _module_init_l0_with_handouts(rows: list[dict]) -> dict:
    return {
        "schema_version": 1,
        "secrecy": "keeper_only",
        "module_meta": {
            "title_zh": "开场组件",
            "title_en": "Opening Component",
            "authors": [],
            "translator": [],
            "era": "1920s",
            "locale": "Boston",
            "party_size": "1-4",
            "duration_hint": "one session",
            "tone_tags": ["mystery"],
            "mythos_entities": [],
            "campaign_hooks": ["opening"],
            "warnings": [],
            "safety_notes": None,
            "structure_type": "linear_investigation",
        },
        "pregens": [],
        "opening_hooks": [],
        "chargen_deltas": [],
        "opening_handouts": rows,
    }


def test_module_init_l0_accepts_reviewed_handout_locale_maps():
    """Reviewed locale maps pass adoption validation under the card contract."""
    l0 = _module_init_l0_with_handouts([
        {
            "id": "briefing", "title": "小卡片 1：好戏开场",
            "when_to_give": "开场", "source_refs": ["pdf_index-12"],
            "kind": "read_aloud",
            "localized_title": {"zh-Hans": "开场简报"},
            "localized_text": {"zh-Hans": "一段已审阅的开场译文。"},
        },
        {
            "id": "letter", "title": "Unattributed Letter",
            "when_to_give": "opening", "kind": "document",
            "source_refs": ["pdf_index-3"],
            "localized_title": {"zh-Hans": "未署名的信"},
        },
    ])
    assert runtime_ops._validate_module_init_l0(l0) is not None


def test_module_init_l0_rejects_handout_bodies_and_bad_locale_fields():
    base_row = {
        "id": "briefing", "title": "开场简报", "when_to_give": "开场",
        "source_refs": ["pdf_index-1"],
    }

    def expect_rejected(row, *, field_note: str):
        l0 = _module_init_l0_with_handouts([{**base_row, **row}])
        with pytest.raises(runtime_ops.RuntimeOperationError, match=field_note):
            runtime_ops._validate_module_init_l0(l0)

    # The verbatim source body and image refs stay closed to deepen_handout.
    expect_rejected({"text": "verbatim body"}, field_note="deepen_handout")
    expect_rejected({"image_ref": "assets/map.png"}, field_note="deepen_handout")
    # A bare locale string is still a direct body escape: only an explicit
    # play_language-to-string map is a reviewed localization.
    expect_rejected(
        {"localized_text": "一段没有语言标签的正文。"},
        field_note="deepen_handout",
    )
    expect_rejected(
        {"localized_title": "没有语言标签的标题"},
        field_note="deepen_handout",
    )
    # Blank map values never count as reviewed content.
    expect_rejected(
        {"localized_text": {"zh-Hans": "  "}},
        field_note="localized_text",
    )
    expect_rejected(
        {"localized_title": {}},
        field_note="localized_title",
    )


def test_l0_opening_handout_cards_preserve_reviewed_locale_fields():
    """Reviewed L0 locale fields ride into the canonical card verbatim."""
    l0 = {"opening_handouts": [
        {
            "id": "briefing",
            "title": "小卡片 1：好戏开场",
            "when_to_give": "模组开场交给调查员",
            "kind": "read_aloud",
            "source_refs": ["pdf_index-1"],
            "localized_title": {"zh-Hans": "开场简报"},
            "localized_text": {"zh-Hans": "一段已审阅的开场译文。"},
        },
        # Tagged-string form rides along with its language tag.
        {
            "id": "letter",
            "title": "Unattributed Letter",
            "when_to_give": "opening",
            "kind": "document",
            "source_refs": ["pdf_index-2"],
            "localized_title": {"zh-Hans": "未署名的信"},
            "localized_text": {"zh-Hans": "未署名的信件全文。"},
        },
    ]}
    cards = runtime_ops.l0_opening_handout_cards(l0, scene_id="opening")
    reviewed = cards[0]
    assert reviewed["parse_state"] == "body_parsed"
    assert reviewed["localized_title"] == {"zh-Hans": "开场简报"}
    assert reviewed["localized_text"] == {"zh-Hans": "一段已审阅的开场译文。"}
    # A parsed body is a card, not a locator stub.
    assert "body_source_page_indices" not in reviewed
    assert reviewed["source_refs"] == ["pdf_index-1"]
    assert "text" not in reviewed
    assert "image_ref" not in reviewed
    tagged = cards[1]
    assert tagged["parse_state"] == "body_parsed"
    assert tagged["localized_title"] == {"zh-Hans": "未署名的信"}
    assert tagged["localized_text"] == {"zh-Hans": "未署名的信件全文。"}


def test_l0_opening_handout_cards_do_not_fabricate_locales():
    """Source-only rows stay named_only stubs; nothing becomes zh-Hans."""
    l0 = {"opening_handouts": [
        {
            "id": "briefing", "title": "小卡片 1：好戏开场",
            "when_to_give": "开场", "source_refs": ["pdf_index-1"],
        },
        # Title-only locale metadata carries no body: still a locator stub,
        # but the reviewed title translation is preserved verbatim.
        {
            "id": "letter", "title": "Unattributed Letter",
            "when_to_give": "opening", "kind": "document",
            "source_refs": ["pdf_index-2"],
            "localized_title": {"zh-Hans": "未署名的信"},
        },
    ]}
    cards = runtime_ops.l0_opening_handout_cards(l0)
    source_only = cards[0]
    assert source_only["parse_state"] == "named_only"
    assert source_only["body_source_page_indices"] == [1]
    assert "localized_title" not in source_only
    assert "localized_text" not in source_only
    # Source-only prose never masquerades as a localization.
    assert "zh-Hans" not in json.dumps(source_only, ensure_ascii=False)
    title_only = cards[1]
    assert title_only["parse_state"] == "named_only"
    assert title_only["body_source_page_indices"] == [2]
    assert title_only["localized_title"] == {"zh-Hans": "未署名的信"}
    assert "localized_text" not in title_only


def test_l0_reviewed_body_parsed_card_flows_into_campaign_ir(tmp_path):
    """A reviewed body_parsed L0 card survives the store and IR projection."""
    _put_source_bound_skeleton(tmp_path)
    l0 = {"opening_handouts": [
        {
            "id": "briefing", "title": "Opening Briefing",
            "when_to_give": "opening", "kind": "read_aloud",
            "source_refs": ["pdf_index-1"],
            "localized_title": {"zh-Hans": "开场简报"},
            "localized_text": {"zh-Hans": "一段已审阅的开场译文。"},
        },
    ]}
    card = runtime_ops.l0_opening_handout_cards(l0)[0]
    stored = assets.put_entity(
        tmp_path, "handout-proj", "handout", card["handout_id"], card,
    )
    assert stored is not None
    reloaded = assets.get_entity(
        tmp_path, "handout-proj", "handout", card["handout_id"],
    )
    assert reloaded["parse_state"] == "body_parsed"
    assert reloaded["localized_title"] == {"zh-Hans": "开场简报"}
    assert reloaded["localized_text"] == {"zh-Hans": "一段已审阅的开场译文。"}

    camp = _make_campaign(tmp_path)
    result = project.project_skeleton_to_campaign(
        tmp_path, camp.name, "handout-proj",
    )
    assert "handout:briefing" in result["reapplied_deep_entities"]
    store = json.loads(
        (camp / "scenario" / "handouts.json").read_text(encoding="utf-8")
    )
    assert [row["asset_id"] for row in store["handouts"]] == ["briefing"]
    ir_card = store["handouts"][0]
    assert ir_card["parse_state"] == "body_parsed"
    assert ir_card["localized_title"] == {"zh-Hans": "开场简报"}
    assert ir_card["localized_text"] == {"zh-Hans": "一段已审阅的开场译文。"}
