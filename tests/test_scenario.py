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
