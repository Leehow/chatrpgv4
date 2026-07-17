import importlib.util
import hashlib
import json
from pathlib import Path


def load_module(name: str, relative_path: str):
    path = Path(relative_path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_scenario = load_module("coc_scenario", "plugins/coc-keeper/scripts/coc_scenario.py")


def test_catalog_source_bundles_reports_declared_page_counts(tmp_path):
    root = tmp_path / "bundle"
    root.mkdir()
    pdf = tmp_path / "module.pdf"
    pdf.write_bytes(b"%PDF fixture")
    markdown = b"# page\n"
    (root / "page.md").write_bytes(markdown)
    (root / "manifest.json").write_text(json.dumps({
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": "pdf:module", "title": "Module", "path": str(pdf),
            "file_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(), "page_count": 3,
        },
        "pages": [{
            "pdf_index": 2, "markdown_path": "page.md",
            "text_sha256": hashlib.sha256(markdown).hexdigest(),
            "review_state": "manual_accepted", "parse_confidence": 0.93,
            "grep_anchors": [],
        }],
    }), encoding="utf-8")

    catalog = coc_scenario.catalog_source_bundles(tmp_path)

    assert len(catalog) == 1
    assert catalog[0]["source_id"] == "pdf:module"
    assert catalog[0]["page_count"] == 3
    assert catalog[0]["selected_pdf_indices"] == [2]
    assert catalog[0]["title"] == "Module"
    assert len(catalog[0]["file_sha256"]) == 64


def test_create_scenario_skeleton_writes_required_files(tmp_path):
    campaign_dir = tmp_path / ".coc" / "campaigns" / "case-1"
    result = coc_scenario.create_scenario_skeleton(
        campaign_dir,
        "case-1-scenario",
        "Case 1 Scenario",
        {"type": "pdf", "path": "pdf/module.pdf", "page_start": 1, "page_end": 3},
    )

    assert result["scenario_id"] == "case-1-scenario"
    assert (campaign_dir / "scenario" / "scenario.json").exists()
    assert json.loads((campaign_dir / "scenario" / "locations.json").read_text()) == []
    assert json.loads((campaign_dir / "index" / "source-map.json").read_text())["sources"][0]["path"] == "pdf/module.pdf"


def test_create_scenario_skeleton_initializes_handout_asset_index(tmp_path):
    campaign_dir = tmp_path / ".coc" / "campaigns" / "case-1"
    coc_scenario.create_scenario_skeleton(
        campaign_dir,
        "case-1-scenario",
        "Case 1 Scenario",
        {"type": "pdf", "path": "pdf/module.pdf", "page_start": 1, "page_end": 3},
    )

    index = json.loads((campaign_dir / "index" / "handout-assets.json").read_text())

    assert (campaign_dir / "assets" / "handouts").is_dir()
    assert index == {
        "schema_version": 1,
        "scenario_id": "case-1-scenario",
        "asset_root": "assets/handouts",
        "assets": [],
        "display": {
            "codex": "render absolute Markdown image paths when player_visible is true",
            "text_only": "show title, summary, and source page when inline image display is unavailable",
        },
    }


def test_load_handout_assets_returns_id_indexed_dict(tmp_path):
    campaign_dir = tmp_path / ".coc" / "campaigns" / "case-1"
    campaign_dir.mkdir(parents=True)
    index_dir = campaign_dir / "index"
    index_dir.mkdir()
    asset = {
        "asset_id": "handout-newspaper",
        "title": "1920 Newspaper Clipping",
        "summary": "A clipping mentioning the chapel lawsuit.",
        "source": {"path": "pdf/module.pdf", "page": 12},
        "player_visible": True,
        "scene_refs": ["scene-archive"],
        "clue_refs": ["clue-chapel-link"],
    }
    (index_dir / "handout-assets.json").write_text(json.dumps({
        "schema_version": 1,
        "scenario_id": "case-1-scenario",
        "asset_root": "assets/handouts",
        "assets": [asset],
        "display": {},
    }))

    loaded = coc_scenario.load_handout_assets(campaign_dir)

    assert loaded == {"handout-newspaper": asset}


def test_load_handout_assets_empty_when_file_missing(tmp_path):
    campaign_dir = tmp_path / ".coc" / "campaigns" / "case-1"
    campaign_dir.mkdir(parents=True)

    loaded = coc_scenario.load_handout_assets(campaign_dir)

    assert loaded == {}


def test_load_handout_assets_empty_when_assets_list_empty(tmp_path):
    """The starter-skeleton state: index exists but assets:[] is empty."""
    campaign_dir = tmp_path / ".coc" / "campaigns" / "case-1"
    coc_scenario.create_scenario_skeleton(
        campaign_dir,
        "case-1-scenario",
        "Case 1 Scenario",
        {"type": "pdf", "path": "pdf/module.pdf", "page_start": 1, "page_end": 3},
    )

    loaded = coc_scenario.load_handout_assets(campaign_dir)

    assert loaded == {}
