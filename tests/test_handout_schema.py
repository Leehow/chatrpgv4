"""Verbatim info card (原文信息卡) schema contracts.

Covers the card field validator, the campaign asset-index loader, the
scenario skeleton card store, and module-assets handout entity validation
(kind enum, text⇒source_refs tracing).
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


coc_scenario = _load("coc_scenario_handout_schema", SCRIPTS / "coc_scenario.py")
coc_module_assets = _load(
    "coc_module_assets_handout_schema", SCRIPTS / "coc_module_assets.py"
)


def _card(**overrides):
    card = {
        "asset_id": "handout-letter",
        "kind": "document",
        "title": "The unsigned letter",
        "text": "To the party who finds this: the chapel records were moved.",
        "source_refs": ["pdf_index-16"],
        "player_visible": True,
    }
    card.update(overrides)
    return card


def _write_index(campaign_dir: Path, assets: list[dict]) -> None:
    index_dir = campaign_dir / "index"
    index_dir.mkdir(parents=True, exist_ok=True)
    (index_dir / "handout-assets.json").write_text(
        json.dumps({
            "schema_version": 1,
            "scenario_id": "schema-test",
            "asset_root": "assets/handouts",
            "assets": assets,
            "display": {},
        }),
        encoding="utf-8",
    )


# ---------------------------------------------------------------- validator


def test_card_kind_is_required_enum():
    assert coc_scenario.validate_handout_card(_card()) == []
    for bad_kind in (None, "pamphlet", 3):
        errors = coc_scenario.validate_handout_card(_card(kind=bad_kind))
        assert any("kind" in error for error in errors)
    for good_kind in ("document", "read_aloud", "map"):
        assert coc_scenario.validate_handout_card(_card(kind=good_kind)) == []


def test_card_text_requires_source_refs():
    card = _card()
    card.pop("source_refs")
    errors = coc_scenario.validate_handout_card(card)
    assert any("source_refs" in error for error in errors)

    errors = coc_scenario.validate_handout_card(_card(source_refs=[]))
    assert any("source_refs" in error for error in errors)

    # A card without any text body needs no source_refs.
    textless = _card()
    textless.pop("text")
    textless.pop("source_refs")
    assert coc_scenario.validate_handout_card(textless) == []


def test_card_optional_field_shapes():
    errors = coc_scenario.validate_handout_card(_card(localized_text=7))
    assert any("localized_text" in error for error in errors)
    errors = coc_scenario.validate_handout_card(_card(when_to_deliver=True))
    assert any("when_to_deliver" in error for error in errors)
    errors = coc_scenario.validate_handout_card(_card(source_refs=[1, 2]))
    assert any("source_refs" in error for error in errors)
    errors = coc_scenario.validate_handout_card(_card(scene_refs=["a"], clue_refs=[]))
    assert errors == []


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"asset_id": 7}, "asset_id"),
        ({"handout_id": ["handout-letter"]}, "handout_id"),
        ({"player_visible": "false"}, "player_visible"),
        ({"opening_card": "true"}, "opening_card"),
        ({"image_ref": ["images/letter.png"]}, "image_ref"),
    ],
)
def test_card_identity_visibility_and_asset_shapes_are_strict(overrides, field):
    errors = coc_scenario.validate_handout_card(_card(**overrides))
    assert any(field in error for error in errors)


def test_card_source_index_derivation():
    assert coc_scenario.handout_card_source_indices(
        ["pdf_index-16", "pdf_index-3", "note"]
    ) == [3, 16]
    assert coc_scenario.handout_card_source_indices(None) == []
    assert coc_scenario.handout_card_source_indices("pdf_index-1") == []


# ------------------------------------------------------------- index loader


def test_load_handout_assets_skips_invalid_cards(tmp_path):
    campaign_dir = tmp_path / ".coc" / "campaigns" / "schema-test"
    campaign_dir.mkdir(parents=True)
    _write_index(campaign_dir, [
        _card(),
        # missing kind -> skipped
        {k: v for k, v in _card(asset_id="handout-no-kind").items() if k != "kind"},
        # text without source_refs -> skipped
        _card(asset_id="handout-untraced", source_refs=None),
        # not an object -> skipped
        "not-a-card",
    ])

    loaded = coc_scenario.load_handout_assets(campaign_dir)

    assert list(loaded) == ["handout-letter"]


def test_skeleton_writes_card_store_object(tmp_path):
    campaign_dir = tmp_path / ".coc" / "campaigns" / "skeleton-test"
    coc_scenario.create_scenario_skeleton(
        campaign_dir,
        "skeleton-test",
        "Skeleton Test",
        {"type": "pdf", "path": "pdf/module.pdf", "page_start": 1, "page_end": 3},
    )

    store = json.loads((campaign_dir / "scenario" / "handouts.json").read_text())
    assert store == {"schema_version": 1, "handouts": []}
    # The starter index stays an empty skeleton; card validation still loads {}.
    assert coc_scenario.load_handout_assets(campaign_dir) == {}


# ------------------------------------------------- handout entity validation


@pytest.fixture
def source_bound_root(tmp_path):
    """Module-assets root with a registered 2-page source bundle."""
    import hashlib

    pdf = tmp_path / "handout-schema.pdf"
    pdf.write_bytes(b"%PDF handout schema fixture")
    bundle = tmp_path / "handout-schema-src"
    bundle.mkdir()
    pages = []
    for pdf_index in (0, 1):
        page_bytes = f"# Page {pdf_index}\n\nfixture".encode()
        markdown_path = f"page-{pdf_index}.md"
        (bundle / markdown_path).write_bytes(page_bytes)
        pages.append({
            "pdf_index": pdf_index,
            "markdown_path": markdown_path,
            "text_sha256": hashlib.sha256(page_bytes).hexdigest(),
            "review_state": "manual_accepted",
            "parse_confidence": 0.99,
            "grep_anchors": [],
        })
    (bundle / "manifest.json").write_text(
        json.dumps({
            "schema_version": 1,
            "producer": "codex-pdf-skill",
            "source": {
                "source_id": "pdf:handout-schema",
                "title": "Handout Schema",
                "path": str(pdf),
                "file_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(),
                "page_count": 2,
            },
            "pages": pages,
        }),
        encoding="utf-8",
    )
    coc_module_assets.register_source_bundle(
        tmp_path,
        bundle,
        asset_root_id="handout-schema",
        module_identity={"canonical_module_id": "handout-schema"},
    )
    return tmp_path


def _handout_pack(**overrides):
    pack = {
        "handout_id": "handout-letter",
        "asset_id": "handout-letter",
        "kind": "document",
        "title": "The unsigned letter",
        "text": "Verbatim letter body from the module page.",
        "source_refs": ["pdf_index-0"],
        "player_visible": True,
        "parse_state": "deep",
        "evidence_gap": False,
        "origin": "source",
        "provenance": {"authority": "source_authored", "basis": "test"},
    }
    pack.update(overrides)
    return pack


def test_put_entity_accepts_valid_handout_card(source_bound_root):
    stored = coc_module_assets.put_entity(
        source_bound_root, "handout-schema", "handout", "handout-letter",
        _handout_pack(),
    )
    assert stored is not None
    reloaded = coc_module_assets.get_entity(
        source_bound_root, "handout-schema", "handout", "handout-letter",
    )
    assert reloaded["kind"] == "document"
    assert reloaded["source_refs"] == ["pdf_index-0"]


def test_put_entity_rejects_handout_without_kind(source_bound_root):
    pack = _handout_pack()
    pack.pop("kind")
    with pytest.raises(coc_module_assets.ModuleAssetsError) as excinfo:
        coc_module_assets.put_entity(
            source_bound_root, "handout-schema", "handout", "handout-letter", pack,
        )
    assert "kind" in str(excinfo.value)


def test_put_entity_rejects_text_without_source_refs(source_bound_root):
    with pytest.raises(coc_module_assets.ModuleAssetsError) as excinfo:
        coc_module_assets.put_entity(
            source_bound_root, "handout-schema", "handout", "handout-letter",
            _handout_pack(source_refs=[]),
        )
    assert "source_refs" in str(excinfo.value)


def test_put_entity_accepts_label_string_alongside_page_ref(source_bound_root):
    """Label strings share the index card source_refs language verbatim.

    Only ``pdf_index-<n>`` strings derive a page index; other labels stay
    valid provenance. A deep source-bound pack still needs at least one
    derivable index, so a label-only refs array fails closed.
    """
    stored = coc_module_assets.put_entity(
        source_bound_root, "handout-schema", "handout", "handout-letter",
        _handout_pack(source_refs=["pdf_index-0", "appendix/handouts-3"]),
    )
    assert stored is not None
    reloaded = coc_module_assets.get_entity(
        source_bound_root, "handout-schema", "handout", "handout-letter",
    )
    assert reloaded["source_refs"] == ["pdf_index-0", "appendix/handouts-3"]
    assert reloaded["source_page_indices"] == [0]


def test_put_entity_rejects_label_only_source_refs(source_bound_root):
    with pytest.raises(coc_module_assets.ModuleAssetsError) as excinfo:
        coc_module_assets.put_entity(
            source_bound_root, "handout-schema", "handout", "handout-letter",
            _handout_pack(source_refs=["page sixteen"]),
        )
    assert "requires source_refs, source_page_indices, or source_span" in str(
        excinfo.value
    )


def test_string_source_refs_stay_object_only_for_other_kinds(source_bound_root):
    """Non-handout packs keep the object-form source_refs contract."""
    with pytest.raises(coc_module_assets.ModuleAssetsError) as excinfo:
        coc_module_assets.put_entity(
            source_bound_root, "handout-schema", "clue", "clue-string-refs",
            {
                "clue_id": "clue-string-refs",
                "delivery_kind": "obvious",
                "player_safe_summary": "summary",
                "parse_state": "deep",
                "evidence_gap": False,
                "source_refs": ["pdf_index-0"],
            },
        )
    assert "must be an object" in str(excinfo.value)
