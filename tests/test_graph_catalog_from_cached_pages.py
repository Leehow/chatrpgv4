"""A campaign at the table has cached pages, not a source bundle."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


graph = _load("coc_module_graph_catalog", SCRIPTS / "coc_module_graph.py")


def _page(tmp_path: Path, pdf_index: int, text: str) -> dict:
    path = tmp_path / f"{pdf_index:04d}.md"
    payload = text.encode("utf-8")
    path.write_bytes(payload)
    return {
        "source_id": "masks-of-nyarlathotep",
        "pdf_index": pdf_index,
        "path": str(path),
        "text_sha256": hashlib.sha256(payload).hexdigest(),
        "review_state": "auto_accepted",
        "parse_confidence": 0.9,
        "grep_anchors": [],
    }


def test_cached_pages_build_the_same_catalog_a_bundle_would(tmp_path: Path):
    refs = [_page(tmp_path, 12, "# 停尸房\n\n档案员抬眼。"), _page(tmp_path, 13, "# 走廊")]
    catalog = graph.catalog_from_page_refs(refs)
    assert set(catalog) == {("masks-of-nyarlathotep", 12), ("masks-of-nyarlathotep", 13)}
    row = catalog[("masks-of-nyarlathotep", 12)]
    assert row["text"].startswith("# 停尸房")
    assert row["review_state"] == "auto_accepted"
    assert row["parse_confidence"] == 0.9


def test_the_refs_own_digest_is_not_trusted(tmp_path: Path):
    """The digest travels beside the file; only the bytes decide.

    A ref whose recorded digest disagrees with what is on disk describes a page
    that is not there any more. Reading it anyway would feed the extractor text
    the accounting says is something else -- silently, and with a source_ref
    that looks perfectly well formed.
    """
    refs = [_page(tmp_path, 12, "# 停尸房")]
    (tmp_path / "0012.md").write_text("# 被替换过的内容", encoding="utf-8")
    with pytest.raises(graph.ModuleGraphError) as caught:
        graph.catalog_from_page_refs(refs)
    assert any(f["code"] == "source_page_hash_mismatch" for f in caught.value.findings)


def test_an_unreadable_page_is_a_finding_not_an_empty_string(tmp_path: Path):
    refs = [_page(tmp_path, 12, "# 停尸房")]
    (tmp_path / "0012.md").unlink()
    with pytest.raises(graph.ModuleGraphError) as caught:
        graph.catalog_from_page_refs(refs)
    assert any(f["code"] == "source_page_unreadable" for f in caught.value.findings)


def test_no_cached_page_is_refused_rather_than_read_as_an_empty_book(tmp_path: Path):
    with pytest.raises(graph.ModuleGraphError) as caught:
        graph.catalog_from_page_refs([])
    assert any(f["code"] == "source_bundle_required" for f in caught.value.findings)
