import importlib.util
import json
from pathlib import Path

from pypdf import PdfWriter


def load_module(name: str, relative_path: str):
    path = Path(relative_path)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_scenario = load_module("coc_scenario", "plugins/coc-keeper/scripts/coc_scenario.py")


def write_blank_pdf(path: Path, pages: int = 2):
    writer = PdfWriter()
    for _ in range(pages):
        writer.add_blank_page(width=72, height=72)
    with path.open("wb") as handle:
        writer.write(handle)


def test_catalog_pdfs_reports_page_counts(tmp_path):
    pdf_dir = tmp_path / "pdf"
    pdf_dir.mkdir()
    write_blank_pdf(pdf_dir / "module.pdf", pages=3)

    catalog = coc_scenario.catalog_pdfs(pdf_dir)
    assert catalog == [{
        "filename": "module.pdf",
        "path": str(pdf_dir / "module.pdf"),
        "page_count": 3,
        "title": None,
    }]


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
            "zcode": "show title, summary, and source page when inline image display is unavailable",
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
