#!/usr/bin/env python3
"""Structural contracts for deterministic source-outline extraction."""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path

import pytest

os.environ["COC_DISABLE_QUEUE_WORKER"] = "1"

SCRIPTS = Path("plugins/coc-keeper/scripts")
FAKE_SHA = "d" * 64


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, rel)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


outline = _load("coc_source_outline_test", str(SCRIPTS / "coc_source_outline.py"))


def _line(page, order, text, weight, *, y0=0.0, emphasis=False, width=100.0):
    return {
        "pdf_index": page,
        "order": order,
        "text": text,
        "weight": weight,
        "emphasis": emphasis,
        "width": width,
        "y0": y0,
        "y1": y0 + weight,
        "page_height": 800.0,
    }


def _body(page, start_order, count, *, weight=10.0, y0=100.0, width=100.0):
    return [
        _line(page, start_order + i, f"body prose line number {i} on this page",
              weight, y0=y0 + i * 12, width=width)
        for i in range(count)
    ]


def test_body_weight_is_character_mass_mode_not_line_count():
    lines = [*_body(1, 1, 20), _line(1, 90, "T", 40.0), _line(1, 91, "U", 40.0)]
    assert outline.body_weight(lines) == 10.0


def test_larger_glyphs_become_headings_and_body_does_not():
    lines = [*_body(1, 1, 20), _line(1, 90, "Keeper Background", 18.0, y0=50)]
    rows = outline.select_headings(lines, body=10.0)
    assert [row["text"] for row in rows] == ["Keeper Background"]
    assert rows[0]["size_rank"] == 1


def test_running_header_repeating_across_pages_is_dropped():
    lines = []
    order = 0
    for page in range(1, 6):
        order += 1
        lines.append(_line(page, order, "Call of Cthulhu", 14.0, y0=10.0))
        for row in _body(page, order * 100, 12):
            lines.append(row)
    rows = outline.select_headings(lines, body=10.0)
    assert rows == []


def test_page_numbers_carry_no_wordlike_glyph_and_are_dropped():
    lines = [*_body(1, 1, 20)]
    for page in range(1, 4):
        lines.append(_line(page, 500 + page, str(page), 14.0, y0=760.0))
    rows = outline.select_headings(lines, body=10.0)
    assert rows == []


def test_read_aloud_block_is_mass_suppressed_even_when_interleaved():
    """A boxed read-aloud passage is above body weight but is prose.

    It is emitted interleaved with the body column, so page adjacency cannot
    identify it; only typographic mass can.
    """
    lines = list(_body(1, 1, 20))
    for i in range(18):
        lines.append(_line(
            1, 200 + i,
            "你把餐点从袋子里拿出来放到桌上，香料味扑鼻",
            12.0, y0=100 + i * 26,
        ))
    lines.append(_line(1, 400, "开幕", 22.0, y0=40.0))
    rows = outline.select_headings(lines, body=10.0)
    assert [row["text"] for row in rows] == ["开幕"]


def test_short_same_weight_list_survives_mass_rule():
    """A pregen roster is many same-size lines but carries little mass."""
    lines = list(_body(1, 1, 20))
    for i, name in enumerate(["史蒂夫", "克雷格", "杰夫", "崔佛", "卡尔"]):
        lines.append(_line(1, 300 + i, name, 13.0, y0=200 + i * 30))
    rows = outline.select_headings(lines, body=10.0)
    assert len(rows) == 5


def test_emphasis_at_body_size_is_a_heading_when_emphasis_is_rare():
    lines = [
        *_body(1, 1, 30),
        _line(1, 90, "6.1 阿布拉莫夫一家", 10.0, y0=300, emphasis=True, width=40.0),
    ]
    assert outline.emphasis_is_discriminative(lines) is True
    rows = outline.select_headings(lines, body=10.0)
    assert [row["text"] for row in rows] == ["6.1 阿布拉莫夫一家"]


def test_emphasis_is_ignored_when_most_of_the_document_is_emphasized():
    lines = [
        *[_line(1, i, f"emphasized body prose line {i}", 10.0,
                y0=100 + i * 12, emphasis=True) for i in range(30)],
        _line(1, 90, "Also Emphasized", 10.0, y0=500, emphasis=True, width=40.0),
    ]
    assert outline.emphasis_is_discriminative(lines) is False
    assert outline.select_headings(lines, body=10.0) == []


def test_full_width_emphasis_run_inside_a_paragraph_is_dropped():
    lines = [
        *_body(1, 1, 30, width=100.0),
        _line(1, 90, "械维修(Mechanical Repair)的调查员会发现", 10.0,
              y0=300, emphasis=True, width=100.0),
        _line(1, 91, "6.2 尸体", 10.0, y0=340, emphasis=True, width=30.0),
    ]
    rows = outline.select_headings(lines, body=10.0)
    assert [row["text"] for row in rows] == ["6.2 尸体"]


def test_emphasis_outranks_same_size_plain_text():
    lines = [
        *_body(1, 1, 30),
        _line(1, 90, "Big Title", 20.0, y0=40),
        _line(1, 91, "Bold Subhead", 10.0, y0=300, emphasis=True, width=30.0),
    ]
    ranks = {row["text"]: row["size_rank"]
             for row in outline.select_headings(lines, body=10.0)}
    assert ranks["Big Title"] < ranks["Bold Subhead"]


def test_body_band_widens_for_jittery_geometry_measurements():
    """Continuous producers measure one nominal size at several heights."""
    lines = []
    order = 0
    for height in (21.0, 22.0, 23.0):
        for i in range(20):
            order += 1
            lines.append(_line(1, order, "recognized body text line", height))
    order += 1
    lines.append(_line(1, order, "TITLE", 40.0))
    narrow = outline.body_band(lines, band_mass=0.60)
    wide = outline.body_band(lines, band_mass=0.90)
    assert narrow[1] < wide[1]
    assert wide[1] == 23.0


def test_outline_digest_binds_rows_to_the_source_file():
    rows = [{"pdf_index": 1, "order": 1, "text": "A", "weight": 1.0,
             "emphasis": False, "size_rank": 1}]
    first = outline.outline_digest(rows, FAKE_SHA)
    assert first == outline.outline_digest(rows, FAKE_SHA)
    assert first != outline.outline_digest(rows, "e" * 64)
    assert first != outline.outline_digest([{**rows[0], "text": "B"}], FAKE_SHA)


def test_build_outline_rejects_an_unknown_producer():
    with pytest.raises(outline.SourceOutlineError):
        outline.build_outline(
            producer="guesswork", source=Path("x"),
            file_sha256=FAKE_SHA, source_id="s",
        )


def test_build_outline_requires_a_real_source_digest():
    with pytest.raises(outline.SourceOutlineError):
        outline.build_outline(
            producer="host_outline", source=Path("x"),
            file_sha256="not-a-digest", source_id="s",
        )


def test_no_producer_opens_a_pdf():
    # The repository contains no PDF parser by contract; exact font metrics
    # arrive as a host-produced line list instead.
    assert outline.PRODUCERS == {"host_outline", "ocr_boxes", "mineru_md"}


def test_host_line_list_feeds_the_same_selector(tmp_path):
    path = tmp_path / "host-outline.json"
    body = [
        {"pdf_index": 1, "text": f"body prose line {i}", "weight": 10.0,
         "y0": 100 + i * 12, "page_height": 800, "width": 100}
        for i in range(20)
    ]
    path.write_text(json.dumps({"lines": [
        *body,
        {"pdf_index": 1, "text": "给守密人的信息", "weight": 18.0,
         "y0": 50, "page_height": 800, "width": 60},
    ]}), encoding="utf-8")
    payload = outline.build_outline(
        producer="host_outline", source=path,
        file_sha256=FAKE_SHA, source_id="pdf:test",
    )
    assert payload["confidence_class"] == "exact"
    assert [row["text"] for row in payload["rows"]] == ["给守密人的信息"]


def test_a_host_line_list_with_bad_geometry_is_rejected(tmp_path):
    path = tmp_path / "host-outline.json"
    path.write_text(json.dumps({"lines": [
        {"pdf_index": 0, "text": "T", "weight": 18.0},
    ]}), encoding="utf-8")
    with pytest.raises(outline.SourceOutlineError):
        outline.build_outline(
            producer="host_outline", source=path,
            file_sha256=FAKE_SHA, source_id="pdf:test",
        )


def test_mineru_producer_reads_heading_levels(tmp_path):
    path = tmp_path / "full.md"
    path.write_text(
        "# 血色公路\n\nordinary paragraph text that forms the body mass here\n"
        "more ordinary paragraph text so the body mode is unambiguous\n"
        "## 附录I-狩猎\n",
        encoding="utf-8",
    )
    payload = outline.build_outline(
        producer="mineru_md", source=path,
        file_sha256=FAKE_SHA, source_id="mineru",
    )
    assert payload["confidence_class"] == "exact"
    assert [row["text"] for row in payload["rows"]] == ["血色公路", "附录I-狩猎"]
