"""Contract tests for host-produced PDF source bundles."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

import pytest


def _load(name: str, relative: str):
    spec = importlib.util.spec_from_file_location(name, relative)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


bundle_module = _load(
    "coc_pdf_bundle_tests", "plugins/coc-keeper/scripts/coc_pdf_bundle.py"
)
hydration = _load(
    "coc_scenario_hydration_bundle_tests",
    "plugins/coc-keeper/scripts/coc_scenario_hydration.py",
)


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _bundle(tmp_path: Path) -> Path:
    root = tmp_path / "host-bundle"
    pages = root / "pages"
    pages.mkdir(parents=True)
    pdf = tmp_path / "module.pdf"
    pdf.write_bytes(b"%PDF host-owned fixture")
    page = b"# Page 1  \r\n\r\nExtracted text.   \r\n"
    (pages / "0000.md").write_bytes(page)
    manifest = {
        "schema_version": 1,
        "producer": "codex-pdf-skill",
        "source": {
            "source_id": "pdf:module",
            "title": "Module",
            "path": str(pdf),
            "file_sha256": _sha(pdf.read_bytes()),
            "page_count": 1,
        },
        "pages": [{
            "pdf_index": 0,
            "printed_page": 1,
            "markdown_path": "pages/0000.md",
            "text_sha256": _sha(page),
            "review_state": "manual_accepted",
            "parse_confidence": 0.93,
            "grep_anchors": ["Extracted text."],
        }],
        "assets": [],
    }
    (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return root


def _manifest(root: Path) -> dict:
    return json.loads((root / "manifest.json").read_text(encoding="utf-8"))


def _write_manifest(root: Path, manifest: dict) -> None:
    (root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


def test_valid_bundle_is_deterministically_formatted_and_hydration_ready(tmp_path):
    root = _bundle(tmp_path)

    formatted = bundle_module.load_host_bundle(root)
    source, pages = hydration._extract_source({
        "source": dict(formatted["source"])
    })

    assert formatted["producer"] == "codex-pdf-skill"
    assert pages == formatted["pages"]
    assert pages[0]["text"] == "# Page 1\n\nExtracted text.\n"
    assert pages[0]["pdf_index"] == 0
    assert pages[0]["review_state"] == "manual_accepted"
    assert pages[0]["parse_confidence"] == 0.93
    assert pages[0]["grep_anchors"] == ["Extracted text."]
    assert source["file_sha256"] == _manifest(root)["source"]["file_sha256"]
    assert source["bundle_sha256"] == formatted["bundle_sha256"]
    assert "source_bundle_path" not in source


def test_ocr_revision_is_closed_normalized_and_digest_bound(tmp_path):
    root = _bundle(tmp_path)
    manifest = _manifest(root)
    manifest["pages"][0]["ocr_revision"] = {
        "stable_id": "page:0:fast",
        "pdf_index": 0,
        "layer": "fast",
        "revision": 2,
        "content_sha256": "a" * 64,
        "fast_confidence_revision": 2,
    }
    _write_manifest(root, manifest)
    first = bundle_module.load_host_bundle(root)
    assert first["pages"][0]["ocr_revision"] == manifest["pages"][0]["ocr_revision"]

    manifest["pages"][0]["ocr_revision"]["revision"] = 3
    _write_manifest(root, manifest)
    second = bundle_module.load_host_bundle(root)
    assert second["bundle_sha256"] != first["bundle_sha256"]


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (lambda row: row.update(extra=True), "unknown keys"),
        (lambda row: row.update(stable_id="page:1:fast"), "stable_id"),
        (lambda row: row.update(pdf_index=1), "pdf_index"),
        (lambda row: row.update(layer="layout"), "layer"),
        (lambda row: row.update(revision=0), "positive integer"),
        (lambda row: row.update(content_sha256="A" * 64), "lowercase"),
        (lambda row: row.update(fast_confidence_revision=0), "positive integer"),
    ],
)
def test_rejects_invalid_ocr_revision_identity(tmp_path, mutation, message):
    root = _bundle(tmp_path)
    manifest = _manifest(root)
    revision = {
        "stable_id": "page:0:fast", "pdf_index": 0, "layer": "fast",
        "revision": 1, "content_sha256": "a" * 64,
    }
    mutation(revision)
    manifest["pages"][0]["ocr_revision"] = revision
    _write_manifest(root, manifest)
    with pytest.raises(bundle_module.PdfSourceBundleError, match=message):
        bundle_module.load_host_bundle(root)


def test_valid_bundle_preserves_hashed_paddleocr_page_structure(tmp_path):
    root = _bundle(tmp_path)
    structured = {
        "schema_version": 1,
        "producer": "baidu-paddleocr-jobs",
        "model": "PaddleOCR-VL-1.6",
        "source_page_ordinal": 0,
        "dataInfo": {"width": 1200, "height": 1600, "type": "image"},
        "prunedResult": {
            "width": 1200,
            "height": 1600,
            "parsing_res_list": [{
                "block_label": "text",
                "block_content": "Extracted text.",
                "block_bbox": [1, 2, 3, 4],
            }],
        },
    }
    structured_bytes = (
        json.dumps(structured, ensure_ascii=False, sort_keys=True) + "\n"
    ).encode("utf-8")
    (root / "pages/0000.ocr.json").write_bytes(structured_bytes)
    manifest = _manifest(root)
    manifest["pages"][0]["structured_data"] = {
        "path": "pages/0000.ocr.json",
        "sha256": _sha(structured_bytes),
        "format": "paddleocr-vl-layout-v1",
        "producer": "baidu-paddleocr-jobs",
        "model": "PaddleOCR-VL-1.6",
    }
    _write_manifest(root, manifest)

    formatted = bundle_module.load_host_bundle(root)

    structured_page = formatted["pages"][0]["structured_data"]
    assert structured_page["sha256"] == _sha(structured_bytes)
    assert structured_page["format"] == "paddleocr-vl-layout-v1"
    assert json.loads(structured_page["text"])["prunedResult"][
        "parsing_res_list"
    ][0]["block_label"] == "text"


def test_rejects_paddleocr_structured_page_hash_drift(tmp_path):
    root = _bundle(tmp_path)
    structured_path = root / "pages/0000.ocr.json"
    structured_path.write_text("{}\n", encoding="utf-8")
    manifest = _manifest(root)
    manifest["pages"][0]["structured_data"] = {
        "path": "pages/0000.ocr.json",
        "sha256": "0" * 64,
        "format": "paddleocr-vl-layout-v1",
        "producer": "baidu-paddleocr-jobs",
        "model": "PaddleOCR-VL-1.6",
    }
    _write_manifest(root, manifest)

    with pytest.raises(bundle_module.PdfSourceBundleError, match="SHA-256"):
        bundle_module.load_host_bundle(root)


def test_hydration_rejects_missing_bundle_with_codex_pdf_skill_instruction():
    with pytest.raises(
        hydration.ScenarioHydrationError,
        match="host source bundle|external host PDF skill|openai/skills",
    ):
        hydration._extract_source({"source": {"path": "/tmp/module.pdf"}})


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (lambda value: value.update(schema_version=2), "schema_version"),
        (lambda value: value.update(producer="local-parser"), "producer"),
        (lambda value: value["source"].update(file_sha256="0" * 64), "PDF SHA-256"),
        (lambda value: value["pages"][0].update(text_sha256="0" * 64), "Markdown SHA-256"),
    ],
)
def test_rejects_schema_producer_and_hash_drift(tmp_path, mutation, message):
    root = _bundle(tmp_path)
    manifest = _manifest(root)
    mutation(manifest)
    _write_manifest(root, manifest)

    with pytest.raises(bundle_module.PdfSourceBundleError, match=message):
        bundle_module.load_host_bundle(root)


def test_rejects_duplicate_pdf_indices(tmp_path):
    root = _bundle(tmp_path)
    manifest = _manifest(root)
    manifest["pages"].append(dict(manifest["pages"][0]))
    _write_manifest(root, manifest)

    with pytest.raises(bundle_module.PdfSourceBundleError, match="duplicate pdf_index"):
        bundle_module.load_host_bundle(root)


def test_rejects_markdown_path_traversal(tmp_path):
    root = _bundle(tmp_path)
    outside = tmp_path / "outside.md"
    outside.write_text("outside", encoding="utf-8")
    manifest = _manifest(root)
    manifest["pages"][0].update(
        markdown_path="../outside.md", text_sha256=_sha(outside.read_bytes())
    )
    _write_manifest(root, manifest)

    with pytest.raises(bundle_module.PdfSourceBundleError, match="escapes"):
        bundle_module.load_host_bundle(root)


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (lambda page: page.pop("review_state"), "review_state"),
        (lambda page: page.update(review_state="needs_review"), "review_state"),
        (lambda page: page.update(parse_confidence=1.01), "parse_confidence"),
        (lambda page: page.update(parse_confidence=True), "parse_confidence"),
        (lambda page: page.update(grep_anchors="not-a-list"), "grep_anchors"),
        (lambda page: page.update(grep_anchors=[""]), "grep_anchors"),
    ],
)
def test_rejects_missing_or_invalid_host_review_evidence(
    tmp_path, mutation, message
):
    root = _bundle(tmp_path)
    manifest = _manifest(root)
    mutation(manifest["pages"][0])
    _write_manifest(root, manifest)

    with pytest.raises(bundle_module.PdfSourceBundleError, match=message):
        bundle_module.load_host_bundle(root)


def test_rejects_grep_anchor_missing_from_normalized_markdown(tmp_path):
    root = _bundle(tmp_path)
    manifest = _manifest(root)
    manifest["pages"][0]["grep_anchors"] = ["Phrase absent from this page."]
    _write_manifest(root, manifest)

    with pytest.raises(
        bundle_module.PdfSourceBundleError,
        match="grep_anchors\\[0\\].*not present",
    ):
        bundle_module.load_host_bundle(root)


def test_host_review_evidence_is_persisted_without_invented_quality(tmp_path):
    root = _bundle(tmp_path)
    formatted = bundle_module.load_host_bundle(root)
    campaign = tmp_path / "campaign"

    hydration._persist_source_bundle(
        campaign,
        {"scenario_id": "scenario-review"},
        formatted["source"],
        formatted["pages"],
    )

    page_map = json.loads((campaign / "index/page-map.json").read_text())
    parse_manifest = json.loads(
        (campaign / "index/parse-manifest.json").read_text()
    )
    segment = json.loads(
        (campaign / "index/evidence-segments.jsonl").read_text().strip()
    )
    source_entry = page_map["sources"][0]
    assert "source_bundle_path" not in source_entry
    assert source_entry["bundle_sha256"] == formatted["bundle_sha256"]
    assert parse_manifest["ranges"][0]["review_state"] == "manual_accepted"
    assert parse_manifest["ranges"][0]["quality"]["overall"] == 0.93
    assert parse_manifest["ranges"][0]["quality"]["overall"] != 1.0
    assert segment["review_state"] == "manual_accepted"
    assert segment["parse_confidence"] == 0.93
    assert segment["grep_anchors"] == ["Extracted text."]


def test_bound_bundle_digest_rejects_replaced_valid_content(tmp_path):
    root = _bundle(tmp_path)
    bound = bundle_module.load_host_bundle(root)
    hydration._extract_source({"source": dict(bound["source"])})

    replacement = b"# Page 1\n\nDifferent but valid extracted text.\n"
    (root / "pages/0000.md").write_bytes(replacement)
    manifest = _manifest(root)
    manifest["pages"][0]["text_sha256"] = _sha(replacement)
    manifest["pages"][0]["grep_anchors"] = ["Different but valid extracted text."]
    _write_manifest(root, manifest)
    changed = bundle_module.load_host_bundle(root)
    assert changed["bundle_sha256"] != bound["bundle_sha256"]

    with pytest.raises(hydration.ScenarioHydrationError, match="differs from"):
        hydration._extract_source({"source": dict(bound["source"])})


def test_bundle_digest_is_independent_of_manifest_json_formatting(tmp_path):
    root = _bundle(tmp_path)
    before = bundle_module.load_host_bundle(root)["bundle_sha256"]
    manifest = _manifest(root)
    (root / "manifest.json").write_text(
        json.dumps(manifest, indent=4, sort_keys=True), encoding="utf-8"
    )

    assert bundle_module.load_host_bundle(root)["bundle_sha256"] == before
