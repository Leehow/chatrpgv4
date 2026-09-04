"""The reader's view of the evidence packet.

Handed the packet as raw JSON, a reading agent spent its first turn converting
the whole thing into `=== span-id ===` blocks before it read a word. Nothing
asked it to; it was paying, out of its own context, to fix the shape. This
serves that shape, and adds the two things a flat file still cannot do: find a
name across every span at once, and answer whether a span id exists before a
shard is written with it.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
_spec = importlib.util.spec_from_file_location(
    "coc_evidence_query_test", SCRIPTS / "coc_evidence_query.py"
)
query = importlib.util.module_from_spec(_spec)
sys.modules["coc_evidence_query_test"] = query
_spec.loader.exec_module(query)


@pytest.fixture
def packet(tmp_path: Path) -> Path:
    spans = [
        {"span_id": "span-page-0-block-1", "text": "STRANGE AEONS II"},
        {"span_id": "span-page-1-block-1", "text": "克洛普是个傀儡。"},
        {"span_id": "span-page-1-block-2", "text": "长老们没有屈服。"},
        {"span_id": "span-page-2-block-1", "text": "克洛普走进神殿。"},
        {"span_id": "span-page-2-block-2", "text": "The cult waits below."},
    ]
    path = tmp_path / "extraction-packet.json"
    path.write_text(json.dumps({
        "evidence_view": {"spans": spans},
        "page_window": {"first_page": 0, "last_page": 2,
                        "pages_before": 0, "pages_after": 40},
    }), encoding="utf-8")
    return path


def _run(packet: Path, *argv: str, capsys) -> tuple[int, str]:
    code = query.main(["--packet", str(packet), *argv])
    return code, capsys.readouterr().out


def test_outline_reports_the_window_and_the_pages(packet, capsys):
    code, out = _run(packet, "outline", capsys=capsys)
    data = json.loads(out)
    assert code == 0
    assert data["spans"] == 5 and data["pages"] == 3
    assert data["page_window"]["pages_after"] == 40
    assert data["per_page"][1] == {"page": 1, "spans": 2, "chars": 16}


def test_read_serves_id_anchored_blocks(packet, capsys):
    _, out = _run(packet, "read", "--pages", "1", capsys=capsys)
    assert out.startswith("=== span-page-1-block-1 ===\n克洛普是个傀儡。")
    assert "span-page-2-block-1" not in out


def test_read_accepts_a_page_range_and_a_list(packet, capsys):
    _, out = _run(packet, "read", "--pages", "0,2", capsys=capsys)
    assert "span-page-0-block-1" in out and "span-page-2-block-1" in out
    assert "span-page-1-block-1" not in out


def test_search_finds_a_name_across_every_page(packet, capsys):
    """This is what stops a relation from having to live inside one chunk."""
    _, out = _run(packet, "search", "克洛普", capsys=capsys)
    assert "2 span(s) matched" in out
    assert "span-page-1-block-1" in out and "span-page-2-block-1" in out


def test_search_can_take_a_regex_and_bring_neighbours(packet, capsys):
    _, out = _run(packet, "search", "(?i)the cult", "--regex", "--context", "1",
                  capsys=capsys)
    assert "span-page-2-block-2" in out
    assert "span-page-2-block-1" in out, "the neighbour was not brought along"


def test_verify_names_an_invented_id_and_says_why(packet, capsys):
    """Every fabricated citation on record extrapolated the numbering past the
    packet's last page. At the gate that costs a generation; here, a call."""
    code, out = _run(packet, "verify", "--ids",
                     "span-page-1-block-1,span-page-40-block-3", capsys=capsys)
    data = json.loads(out)
    assert code == 1
    assert data["unknown"] == ["span-page-40-block-3"]
    assert data["packet_pages"] == [0, 2]
    assert "invented" in data["hint"]


def test_verify_is_silent_when_every_id_is_real(packet, capsys):
    code, out = _run(packet, "verify", "--ids", "span-page-0-block-1", capsys=capsys)
    data = json.loads(out)
    assert code == 0 and data["unknown"] == [] and data["hint"] == ""


def test_verify_reads_a_whole_shard(packet, capsys, tmp_path):
    shard = tmp_path / "shard.json"
    shard.write_text(json.dumps({
        "nodes": [{"node_id": "scene-a",
                   "evidence_span_ids": ["span-page-1-block-1"]}],
        "claims": [{"claim_id": "claim-a",
                    "evidence_span_ids": ["span-page-99-block-1"]}],
    }), encoding="utf-8")
    code, out = _run(packet, "verify", "--shard", str(shard), capsys=capsys)
    assert code == 1
    assert json.loads(out)["unknown"] == ["span-page-99-block-1"]


def test_coverage_separates_content_left_behind_from_page_furniture(
    packet, tmp_path, capsys,
):
    """A share alone reads "you left a third of the book". Measured on one
    book: 163 uncited spans, 14 of them long enough to be content, and those
    sat in the appendix -- which is the actionable half of the number."""
    shard = tmp_path / "shard.json"
    shard.write_text(json.dumps({
        "nodes": [{"node_id": "scene-a",
                   "evidence_span_ids": ["span-page-0-block-1"]}],
        "claims": [],
    }), encoding="utf-8")
    code, out = _run(packet, "coverage", "--shard", str(shard),
                     "--substantive", "8", capsys=capsys)
    data = json.loads(out.split("\n\n")[0])
    assert code == 0
    assert data["cited"] == 1 and data["uncited"] == 4
    # "克洛普是个傀儡。" and the others are over the floor; nothing here is
    # under it, so the counts agree.
    assert data["substantive_uncited"] == 4
    # Worst page first, so the reader is pointed at where the content is.
    assert data["by_page"][0]["page"] in (1, 2)
    assert "either extract them or say" in data["note"]


def test_coverage_prints_the_substantive_spans_so_they_can_be_acted_on(
    packet, tmp_path, capsys,
):
    shard = tmp_path / "shard.json"
    shard.write_text(json.dumps({"nodes": [], "claims": []}), encoding="utf-8")
    _, out = _run(packet, "coverage", "--shard", str(shard),
                  "--substantive", "8", "--show", "2", capsys=capsys)
    body = out.split("\n\n", 1)[1]
    assert body.count("=== span-page-") == 2, "the longest uncited were not shown"


def test_page_furniture_is_not_counted_as_content_left_behind(
    packet, tmp_path, capsys,
):
    shard = tmp_path / "shard.json"
    shard.write_text(json.dumps({"nodes": [], "claims": []}), encoding="utf-8")
    _, out = _run(packet, "coverage", "--shard", str(shard),
                  "--substantive", "120", capsys=capsys)
    data = json.loads(out.split("\n\n")[0])
    assert data["uncited"] == 5
    assert data["substantive_uncited"] == 0, (
        "short spans were counted as content, which is how a coverage number "
        "turns into pressure to cite a page number"
    )


def test_coverage_points_at_the_page_holding_content_not_the_noisiest_page(
    tmp_path, capsys,
):
    """Page 9 leaves four scraps; page 3 leaves one real paragraph. Ordering by
    how much went uncited sends the reader to the scraps, which is the wrong
    page: what is actionable is content, not count."""
    spans = [{"span_id": "span-page-3-block-1", "text": "长" * 400}]
    spans += [{"span_id": f"span-page-9-block-{i}", "text": "页 9"} for i in range(1, 5)]
    packet = tmp_path / "extraction-packet.json"
    packet.write_text(json.dumps({"evidence_view": {"spans": spans}}), encoding="utf-8")
    shard = tmp_path / "shard.json"
    shard.write_text(json.dumps({"nodes": [], "claims": []}), encoding="utf-8")

    _, out = _run(packet, "coverage", "--shard", str(shard), capsys=capsys)
    data = json.loads(out.split("\n\n")[0])
    assert data["by_page"][0] == {"page": 3, "uncited": 1, "substantive": 1}
    assert data["by_page"][1]["page"] == 9
