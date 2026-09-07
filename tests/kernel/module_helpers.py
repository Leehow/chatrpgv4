"""Helpers for the module-store tests (contract §14): the tiny bundle fixture, the
plan/packet shortcuts, and a reader-shaped shard builder that cites only spans the
packet actually carries."""

from __future__ import annotations

import copy
import json
import shutil
import sys
from pathlib import Path
from typing import Any

from conftest import KERNEL_DIR, RpcClient, read_json

# In-process imports of `coc.modules.*` (the store, the deepen lane) in these tests.
if str(KERNEL_DIR) not in sys.path:
    sys.path.insert(0, str(KERNEL_DIR))

FIXTURES = Path(__file__).resolve().parent / "fixtures"
BUNDLE_TINY = FIXTURES / "bundle-tiny"
TINY_ID = "grey-heron-dock"
ALL_ASPECTS = ["structure", "world", "actors", "knowledge", "causal", "mechanics", "assets", "direction"]


def copy_bundle(tmp_path: Path, name: str = "bundle") -> Path:
    target = tmp_path / name
    shutil.copytree(BUNDLE_TINY, target)
    return target


def module_dir(workspace: Path, module_id: str = TINY_ID) -> Path:
    return workspace / ".coc" / "modules" / module_id


def write_bundle(target: Path, pages: list[str], *, title: str, slug: str,
                 language: str = "en") -> Path:
    """A bundle of the §14.2 shape from page texts: the manifest the binder byte-checks."""
    import hashlib

    (target / "pages").mkdir(parents=True, exist_ok=True)
    rows = []
    for index, text in enumerate(pages):
        path = f"pages/{index:04d}.md"
        (target / path).write_text(text, encoding="utf-8")
        rows.append({"pdf_index": index, "path": path,
                     "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
                     "chars": len(text)})
    manifest = {
        "contract": "coc.pdf-bundle.v1",
        "producer": "test-fixture",
        "module_identity": {"title": title, "slug": slug, "language": language},
        "source": {"file_sha256": hashlib.sha256(slug.encode("utf-8")).hexdigest(),
                   "page_count": len(pages), "filename": f"{slug}.pdf"},
        "pages": rows,
    }
    (target / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1),
                                          encoding="utf-8")
    return target


CHAPTER_BOOK_ID = "eleven-chapter-book"


def chapter_book_pages(*, chapters: int = 11, pages_per_chapter: int = 4,
                       lines_per_page: int = 7) -> list[str]:
    """A book with a clean `#` chapter structure and about 50,000 characters: every page
    carries unique prose (so no page reads as a table of contents) and every chapter
    starts on a page of its own."""
    pages: list[str] = []
    for chapter in range(1, chapters + 1):
        for page in range(pages_per_chapter):
            lines = []
            if page == 0:
                lines.append(f"# Chapter {chapter}: The Long Winter Of Station {chapter}")
            for line in range(lines_per_page):
                lines.append(
                    f"Chapter {chapter}, page {page}, line {line}: the surveyors counted "
                    f"{chapter * 100 + page * 10 + line} crates on the frozen siding and wrote "
                    f"the tally into the station ledger before the light failed entirely."
                )
            pages.append("\n\n".join(lines) + "\n")
    return pages


def bind_chapter_book(client: RpcClient, tmp_path: Path, **kwargs: Any) -> dict[str, Any]:
    bundle = write_bundle(tmp_path / "chapter-bundle", chapter_book_pages(**kwargs),
                          title="The Long Winter", slug=CHAPTER_BOOK_ID)
    return client.ok("module.bind", {"bundle": str(bundle)})


def bind_tiny(client: RpcClient, tmp_path: Path) -> dict[str, Any]:
    return client.ok("module.bind", {"bundle": str(copy_bundle(tmp_path))})


def plan_whole_book(client: RpcClient, module_id: str = TINY_ID) -> str:
    plan = client.ok("module.plan", {"module_id": module_id})
    assert len(plan["sections"]) == 1
    section_id = plan["sections"][0]["id"]
    client.ok("module.plan.accept", {"module_id": module_id,
                                     "sections": [{"id": section_id, "kind": "scene", "priority": 100}]})
    return section_id


def plan_four_sections(client: RpcClient, module_id: str = TINY_ID) -> list[str]:
    """budget 200 cuts the tiny book at its `##` headings: front, scene, scene, appendix."""
    plan = client.ok("module.plan", {"module_id": module_id, "budget": 200})
    assert [s["pages"] for s in plan["sections"]] == [[0, 0], [1, 1], [2, 2], [3, 3]]
    kinds = [("front", 90), ("scene", 100), ("scene", 80), ("appendix", 70)]
    rows = [{"id": s["id"], "kind": k, "priority": p} for s, (k, p) in zip(plan["sections"], kinds)]
    client.ok("module.plan.accept", {"module_id": module_id, "sections": rows})
    return [s["id"] for s in plan["sections"]]


def packet_for(client: RpcClient, section_id: str, module_id: str = TINY_ID) -> tuple[dict[str, Any], Path]:
    result = client.ok("module.packet", {"module_id": module_id, "section_id": section_id})
    packet_path = Path(result["packet"])
    return read_json(packet_path), packet_path.parent


def span_with(packet: dict[str, Any], needle: str) -> str | None:
    for span in packet["spans"]:
        if needle in span["text"]:
            return span["span_id"]
    return None


def node(kind: str, slug: str, name: str, spans: list[str], summary: str = "",
         visibility: str = "keeper-only", props: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"node_id": f"{kind}-{slug}", "node_kind": kind, "name": name, "visibility": visibility,
            "aliases": [], "summary": summary, "evidence_span_ids": spans, "properties": props or {}}


def claim(subject: str, predicate: str, obj: str, spans: list[str], reason: str | None = None) -> dict[str, Any]:
    row: dict[str, Any] = {"subject_id": subject, "predicate": predicate, "object": {"node_id": obj},
                           "truth_status": "authored-fact", "evidence_span_ids": spans}
    if reason:
        row["reason"] = reason
    return row


# What a faithful reader writes for the tiny book, keyed by the span text each row needs.
NODE_SPECS: list[tuple[dict[str, Any], list[str]]] = [
    ({"kind": "scene", "slug": "dock-teahouse", "name": "码头茶棚",
      "summary": "雾锁码头，调查员在茶棚接下寻找失踪船工的委托。", "props": {"is_entrance": True}},
     ["## 场景：码头茶棚", "雾锁码头"]),
    ({"kind": "scene", "slug": "abandoned-warehouse", "name": "废弃货栈",
      "summary": "货栈门上挂着 7 号铁牌，地上有拖拽痕迹通向水下。", "props": {"is_ending": True}},
     ["## 场景：废弃货栈", "7 号铁牌"]),
    ({"kind": "npc", "slug": "lao-zhou", "name": "老周",
      "summary": "五十三岁的茶棚老板，嘴碎但胆小；见过船工深夜进货栈。",
      "props": {"skills": {"侦查": 60, "聆听": 55, "说服": 40}, "secret": "见过船工深夜进货栈"}},
     ["### 老周", "五十三岁"]),
    ({"kind": "clue", "slug": "brass-whistle", "name": "船工的铜哨", "summary": "抽屉里的铜哨刻着货栈编号 7。",
      "visibility": "revealable", "props": {"delivery_kind": "skill_check"}}, ["一枚铜哨"]),
    ({"kind": "clue", "slug": "wet-ledger", "name": "湿漉漉的账本",
      "summary": "账本记着每月十五夜取「货」，最后一页是船工的名字；理智 0/1D3。",
      "visibility": "revealable", "props": {"delivery_kind": "search"}}, ["账本记着"]),
    ({"kind": "conclusion", "slug": "sailor-taken-by-deep-ones", "name": "船工被深潜者带走",
      "summary": "铜哨与账本共同指向船工被深潜者带走。"}, ["船工被深潜者带走了"]),
    ({"kind": "asset", "slug": "dock-map", "name": "码头与货栈平面图", "summary": "码头与货栈平面图。",
      "visibility": "player-safe", "props": {"role": "map"}}, ["图 1"]),
]
CLAIM_SPECS: list[tuple[tuple[str, str, str], list[str]]] = [
    (("scene-dock-teahouse", "route-to", "scene-abandoned-warehouse"), ["向北走 10 分钟"]),
    (("scene-abandoned-warehouse", "route-to", "scene-dock-teahouse"), ["向北走 10 分钟"]),
    (("npc-lao-zhou", "present-in", "scene-dock-teahouse"), ["只剩老周"]),
    (("clue-brass-whistle", "discoverable-at", "scene-dock-teahouse"), ["一枚铜哨"]),
    (("clue-wet-ledger", "discoverable-at", "scene-abandoned-warehouse"), ["账本记着"]),
    (("clue-brass-whistle", "supports", "conclusion-sailor-taken-by-deep-ones"), ["铜哨与账本"]),
    (("clue-wet-ledger", "supports", "conclusion-sailor-taken-by-deep-ones"), ["铜哨与账本"]),
    (("asset-dock-map", "depicts", "scene-abandoned-warehouse"), ["图 1"]),
]


def reader_shard(packet: dict[str, Any], *, coverage: dict[str, str] | None = None) -> dict[str, Any]:
    """The shard a faithful reader would write for this packet: only the nodes and claims
    whose evidence is in the packet, with `node_refs` for anything referenced but defined
    on other pages. Two-page packets get the subset the pages support."""
    nodes: list[dict[str, Any]] = []
    front = [span_with(packet, "# 灰鹭码头的雾"), span_with(packet, "两到四名调查员")]
    if all(front):
        # The front matter names the book: the reader restates the machine's module node
        # (same id) with the page it stands on; the merge keeps the skeleton's fields.
        nodes.append(node("module", packet["module_id"], "灰鹭码头的雾", [s for s in front if s],
                          "一个给两到四名调查员的短篇模组。"))
    for spec, needles in NODE_SPECS:
        spans = [span_with(packet, needle) for needle in needles]
        if all(spans):
            nodes.append(node(spec["kind"], spec["slug"], spec["name"], [s for s in spans if s],
                              spec.get("summary", ""), spec.get("visibility", "keeper-only"),
                              copy.deepcopy(spec.get("props"))))
    defined = {n["node_id"] for n in nodes}
    claims: list[dict[str, Any]] = []
    refs: set[str] = set()
    for (subject, predicate, obj), needles in CLAIM_SPECS:
        spans = [span_with(packet, needle) for needle in needles]
        if not all(spans):
            continue
        if subject not in defined and obj not in defined:
            continue
        claims.append(claim(subject, predicate, obj, [s for s in spans if s]))
        for end in (subject, obj):
            if end not in defined:
                refs.add(end)
    shard: dict[str, Any] = {
        "module_id": packet["module_id"],
        "section_id": packet["section_id"],
        "source_language": packet["source_language"],
        "aspects": list(ALL_ASPECTS),
        "coverage": coverage or {domain: "accepted" for domain in ALL_ASPECTS},
        "nodes": nodes,
        "claims": claims,
    }
    if refs:
        shard["node_refs"] = sorted(refs)
    return shard


def write_shard(work_dir: Path, shard: dict[str, Any]) -> Path:
    path = work_dir / "shard.json"
    path.write_text(json.dumps(shard, ensure_ascii=False, indent=1), encoding="utf-8")
    return path


def review(client: RpcClient, section_id: str, module_id: str = TINY_ID) -> dict[str, Any]:
    return client.ok("module.review", {"module_id": module_id, "section_id": section_id})


def codes(report: dict[str, Any]) -> set[str]:
    return {f["code"] for f in report["findings"]}


def build_whole_book(client: RpcClient, tmp_path: Path) -> tuple[str, dict[str, Any]]:
    """bind → plan (one section) → packet → faithful shard → review → accept → assemble."""
    bind_tiny(client, tmp_path)
    section_id = plan_whole_book(client)
    packet, work_dir = packet_for(client, section_id)
    write_shard(work_dir, reader_shard(packet))
    report = review(client, section_id)
    assert report["accepted"], report["findings"]
    client.ok("module.accept", {"module_id": TINY_ID, "section_id": section_id})
    return section_id, client.ok("module.assemble", {"module_id": TINY_ID})
