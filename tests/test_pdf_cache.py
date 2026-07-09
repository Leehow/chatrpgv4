"""Tests for pdf_cache: unified markdown extraction with caching.

The real backends (pymupdf4llm, fitz/PyMuPDF) are never invoked here -- the
backend parse is monkeypatched and OCR inference uses the ``_open_doc``
injection seam so no real PDF is required. This keeps the suite fast and free
of the heavy OCR dependency.
"""
import importlib.util
import json
from pathlib import Path

import pytest


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


pdf_cache = _load(
    "pdf_cache",
    "plugins/coc-keeper/skills/trpg-pdf-ingest/scripts/pdf_cache.py",
)


# ---------------------------------------------------------------------------
# cache_key
# ---------------------------------------------------------------------------

def test_cache_key_single_page():
    k = pdf_cache.cache_key("pdf/Book.pdf", [294])
    assert k == "book/pages-294.md"


def test_cache_key_contiguous_range():
    k = pdf_cache.cache_key("pdf/My Book.pdf", [294, 295, 296])
    assert k == "my-book/pages-294-296.md"


def test_cache_key_sorts_and_dedupes():
    k = pdf_cache.cache_key("pdf/X.pdf", [296, 294, 294, 295])
    assert "pages-294-296" in k


def test_cache_key_slug_lowercases_and_replaces_special():
    k = pdf_cache.cache_key("pdf/Call Of Cthulhu (7e).pdf", [1])
    # special chars collapsed to single dash, lowercased
    assert k.startswith("call-of-cthulhu-7e/pages-1.md")


def test_cache_key_non_contiguous_underscore_joins():
    # Non-contiguous pages: spec joins with underscores.
    k = pdf_cache.cache_key("pdf/X.pdf", [294, 296, 301])
    assert k == "x/pages-294_296_301.md"


def test_cache_key_collapses_special_runs():
    # Multiple special chars collapse to a single dash.
    k = pdf_cache.cache_key("pdf/A   B!!!C.pdf", [1])
    assert k == "a-b-c/pages-1.md"


def test_cache_key_empty_slug_fallback():
    # A basename made entirely of special chars still yields a relative key.
    k = pdf_cache.cache_key("pdf/!!!.pdf", [1])
    assert k == "pdf/pages-1.md"


# ---------------------------------------------------------------------------
# cache_path / is_cached
# ---------------------------------------------------------------------------

def test_cache_path_under_cache_root():
    p = pdf_cache.cache_path("pdf/Book.pdf", [1], cache_root=Path("/tmp/c"))
    assert p == Path("/tmp/c/book/pages-1.md")


def test_cache_path_default_root():
    # Without cache_root, lives under the default cache root.
    p = pdf_cache.cache_path("pdf/Book.pdf", [1])
    assert p == Path(".coc/pdf-cache") / "book" / "pages-1.md"


def test_is_cached_false_when_missing(tmp_path):
    assert pdf_cache.is_cached("pdf/Book.pdf", [1], cache_root=tmp_path) is False


def test_is_cached_true_after_write(tmp_path):
    # write a fake cache file
    p = pdf_cache.cache_path("pdf/Book.pdf", [1], cache_root=tmp_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("# page 1")
    assert pdf_cache.is_cached("pdf/Book.pdf", [1], cache_root=tmp_path) is True


# ---------------------------------------------------------------------------
# extract_markdown: cache miss -> hit
# ---------------------------------------------------------------------------

def test_extract_markdown_cache_miss_then_hit(tmp_path, monkeypatch):
    """First call parses (via mocked backend), second call hits cache."""
    call_count = {"n": 0}

    def fake_parse(pdf_path, pages, use_ocr):
        call_count["n"] += 1
        return f"# mocked page {pages[0]} (ocr={use_ocr})"

    monkeypatch.setattr(pdf_cache, "_parse_with_pymupdf4llm", fake_parse)

    # first call: miss -> parse (use_ocr pinned to skip real fitz inference)
    r1 = pdf_cache.extract_markdown("pdf/Book.pdf", [50], use_ocr=False,
                                    cache_root=tmp_path)
    assert r1["cached"] is False
    assert "mocked page 50" in r1["markdown"]
    assert call_count["n"] == 1
    # cache_path returned and sidecar written
    assert Path(r1["cache_path"]).is_file()
    assert Path(r1["cache_path"]).with_suffix(".meta.json").is_file()
    assert r1["pages"] == [50]

    # second call: hit -> no parse
    r2 = pdf_cache.extract_markdown("pdf/Book.pdf", [50], cache_root=tmp_path)
    assert r2["cached"] is True
    assert call_count["n"] == 1  # backend NOT called again
    assert "mocked page 50" in r2["markdown"]


def test_extract_markdown_infers_ocr_when_none(tmp_path, monkeypatch):
    """use_ocr=None triggers _infer_ocr_need (mocked) and is recorded in meta."""
    infer_calls = {"n": 0}

    def fake_infer(pdf_path, pages):
        infer_calls["n"] += 1
        return True

    monkeypatch.setattr(pdf_cache, "_parse_with_pymupdf4llm",
                        lambda *a, **k: "# md")
    monkeypatch.setattr(pdf_cache, "_infer_ocr_need", fake_infer)

    pdf_cache.extract_markdown("pdf/Book.pdf", [5], cache_root=tmp_path)
    assert infer_calls["n"] == 1

    # meta.json records the inferred use_ocr=True
    meta = json.loads(
        pdf_cache.cache_path("pdf/Book.pdf", [5], cache_root=tmp_path)
        .with_suffix(".meta.json").read_text())
    assert meta["use_ocr"] is True
    assert meta["backend"] == "pymupdf4llm"


def test_extract_markdown_normalizes_unsorted_pages(tmp_path, monkeypatch):
    monkeypatch.setattr(pdf_cache, "_parse_with_pymupdf4llm",
                        lambda *a, **k: "# md")
    r = pdf_cache.extract_markdown("pdf/Book.pdf", [296, 294, 295],
                                   use_ocr=False, cache_root=tmp_path)
    assert r["pages"] == [294, 295, 296]


def test_extract_markdown_writes_meta_schema(tmp_path, monkeypatch):
    monkeypatch.setattr(pdf_cache, "_parse_with_pymupdf4llm",
                        lambda *a, **k: "# hello")
    pdf_cache.extract_markdown("pdf/Book.pdf", [10, 11], use_ocr=False,
                               cache_root=tmp_path)
    meta = json.loads(
        pdf_cache.cache_path("pdf/Book.pdf", [10, 11], cache_root=tmp_path)
        .with_suffix(".meta.json").read_text())
    assert meta["schema_version"] == 1
    assert meta["pdf"] == "pdf/Book.pdf"
    assert meta["pages"] == [10, 11]
    assert meta["backend"] == "pymupdf4llm"
    assert meta["use_ocr"] is False
    assert meta["char_count"] == len("# hello")
    assert "parsed_at" in meta


def test_extract_markdown_unknown_backend_raises(tmp_path):
    with pytest.raises(ValueError):
        pdf_cache.extract_markdown("pdf/Book.pdf", [1], backend="nope",
                                   cache_root=tmp_path)


# ---------------------------------------------------------------------------
# ingest_external
# ---------------------------------------------------------------------------

def test_ingest_external_copies_md_and_meta(tmp_path):
    src = tmp_path / "external.md"
    src.write_text("# externally parsed content")
    p = pdf_cache.ingest_external("pdf/Book.pdf", [10, 11], src,
                                  cache_root=tmp_path / "cache")
    assert p.exists()
    assert "externally parsed content" in p.read_text()
    meta = json.loads(p.with_suffix(".meta.json").read_text())
    assert meta["backend"] == "external"
    assert meta["pages"] == [10, 11]


# ---------------------------------------------------------------------------
# extract_markdown: external backend
# ---------------------------------------------------------------------------

def test_extract_external_backend_uses_src(tmp_path, monkeypatch):
    """backend='external' ingests external_src without calling pymupdf4llm."""
    src = tmp_path / "out.md"
    src.write_text("# from mineru")
    parsed = {"n": 0}

    def fake_parse(*a, **k):
        parsed["n"] += 1
        return "should not be called"

    monkeypatch.setattr(pdf_cache, "_parse_with_pymupdf4llm", fake_parse)
    r = pdf_cache.extract_markdown("pdf/Book.pdf", [1], backend="external",
                                   external_src=src, cache_root=tmp_path / "c")
    assert "from mineru" in r["markdown"]
    assert parsed["n"] == 0  # pymupdf4llm never called
    assert r["cached"] is False


def test_extract_external_without_src_raises(tmp_path):
    with pytest.raises(ValueError):
        pdf_cache.extract_markdown("pdf/Book.pdf", [1], backend="external",
                                   cache_root=tmp_path)


def test_extract_external_then_cache_hit(tmp_path):
    """External-ingested markdown is served from cache on the next call."""
    src = tmp_path / "out.md"
    src.write_text("# from mineru")
    cache_root = tmp_path / "c"
    r1 = pdf_cache.extract_markdown("pdf/Book.pdf", [1], backend="external",
                                    external_src=src, cache_root=cache_root)
    assert r1["cached"] is False
    r2 = pdf_cache.extract_markdown("pdf/Book.pdf", [1], backend="external",
                                    external_src=src, cache_root=cache_root)
    assert r2["cached"] is True
    assert "from mineru" in r2["markdown"]


# ---------------------------------------------------------------------------
# _infer_ocr_need (uses _open_doc injection -- no real PDF / fitz import)
# ---------------------------------------------------------------------------

class _FakePage:
    def __init__(self, text):
        self._text = text

    def get_text(self, mode):
        return self._text


class _FakeDoc:
    def __init__(self, pages_text):
        self._pages = [_FakePage(t) for t in pages_text]

    def __len__(self):
        return len(self._pages)

    def __getitem__(self, i):
        return self._pages[i]

    def close(self):
        pass


def test_infer_ocr_need_returns_false_for_text_page():
    """A page with >50 chars of text -> OCR not needed."""
    fake_open = lambda p: _FakeDoc(["x" * 200])
    assert pdf_cache._infer_ocr_need("any.pdf", [0], _open_doc=fake_open) is False


def test_infer_ocr_need_returns_true_for_scanned():
    """A page with <50 chars -> OCR needed."""
    fake_open = lambda p: _FakeDoc(["x" * 10])  # <50 = scanned
    assert pdf_cache._infer_ocr_need("any.pdf", [0], _open_doc=fake_open) is True


def test_infer_ocr_need_true_if_any_page_scanned():
    """Only one scanned page in the set is enough to enable OCR."""
    fake_open = lambda p: _FakeDoc(["x" * 200, "x" * 10, "x" * 300])
    assert pdf_cache._infer_ocr_need("any.pdf", [0, 1, 2],
                                     _open_doc=fake_open) is True


def test_infer_ocr_need_skips_out_of_range_indices():
    """Indices >= doc length are skipped rather than erroring."""
    fake_open = lambda p: _FakeDoc(["x" * 200])  # 1 page
    assert pdf_cache._infer_ocr_need("any.pdf", [0, 99],
                                     _open_doc=fake_open) is False
