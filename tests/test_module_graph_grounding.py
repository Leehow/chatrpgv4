"""Gate two: does a shard's content live on the pages it cites?

The contract gate checks that cited span ids exist. It does not check that the
cited span says anything about the thing citing it, so a shard whose scenes
connect, whose clues are placed and whose NPCs the book has never heard of
passes it clean. That matters because the extractor is a self-review loop:
with only a structure gate, the loop converges on pleasing the structure gate.

Each test below pairs a real module's shard (known-good) with a deliberately
fabricated variant (known-bad), because a check that is quiet on good output
proves nothing until it is also loud on bad output.
"""
from __future__ import annotations

import copy
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
FIXTURES = ROOT / "tests" / "fixtures" / "module-graph"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


gate = _load("coc_module_graph_grounding_tests", SCRIPTS / "coc_module_graph_grounding.py")

SHARD = json.loads((FIXTURES / "cursed-be-the-city.shard.json").read_text("utf-8"))
CATALOG = gate.build_catalog(
    json.loads((FIXTURES / "cursed-be-the-city.evidence.json").read_text("utf-8"))
)


def _codes(findings, code):
    return [f for f in findings if f["code"] == code]


def _subjects(findings, code):
    return {f.get("node_id") or f.get("claim_id") for f in _codes(findings, code)}


def test_an_npc_the_book_never_names_is_reported():
    """The load-bearing case: a whole fabricated actor citing real pages.

    Seventeen of nineteen invented records once passed a validator that only
    checked citations exist. This is the check that makes that impossible.
    """
    shard = copy.deepcopy(SHARD)
    real = next(n for n in shard["nodes"] if n["node_id"] == "creature-formless-spawn")
    shard["nodes"].append({
        **copy.deepcopy(real),
        "node_id": "npc-drusilla-vane",
        "node_kind": "npc",
        "name": "德鲁西拉·凡恩",
        "aliases": [],
        "summary": "神殿的女祭司，独自守着雕像。",
        "properties": {},
    })
    findings = gate.check_grounding(shard, CATALOG)
    assert "npc-drusilla-vane" in _subjects(findings, "name-not-on-cited-pages")


def test_a_quietly_altered_stat_is_reported_and_the_rest_is_not():
    """The spawn's whip is 75%. Changing it to 45% must name 45 and nothing else.

    The node keeps every other number, every name and every citation, so this
    is the case a check that only counts fields or matches an anchor misses.
    """
    shard = copy.deepcopy(SHARD)
    node = next(n for n in shard["nodes"] if n["node_id"] == "creature-formless-spawn")
    whip = next(w for w in node["properties"]["weapons"] if w["name"] == "Whip")
    assert whip["skill"] == 75, "fixture drifted; this test asserts on the real value"
    whip["skill"] = 45

    findings = gate.check_grounding(shard, CATALOG)
    reported = _codes(findings, "number-not-on-cited-pages")
    spawn = [f for f in reported if f.get("node_id") == "creature-formless-spawn"]
    assert spawn, "a changed stat on a correctly cited node went unreported"
    assert spawn[0]["numbers"] == ["45"], (
        "the finding must name the altered number, not the node's whole stat "
        f"block: {spawn[0]['numbers']}"
    )


def test_an_invented_sanity_loss_is_reported():
    """1/1D6 rewritten as 2/1D8 -- the rules live in the single digits."""
    shard = copy.deepcopy(SHARD)
    node = next(n for n in shard["nodes"] if n["node_id"] == "rule-san-mist-manifest")
    node["summary"] = "目睹迷雾显形并涌出形体需要进行理智检定 2/1D8。"
    findings = gate.check_grounding(shard, CATALOG)
    reported = [f for f in _codes(findings, "number-not-on-cited-pages")
                if f.get("node_id") == "rule-san-mist-manifest"]
    assert reported and set(reported[0]["numbers"]) == {"2", "8"}


def test_an_analytic_label_is_not_held_to_verbatim_containment():
    """No module prints the line "clue: the wasted carcasses".

    Holding a clue, conclusion, rule or secret to page containment reported 22
    findings on a faithful shard. A gate that loud on good output does not
    survive its own loop: the model learns to name things badly to quiet it.
    """
    findings = gate.check_grounding(copy.deepcopy(SHARD), CATALOG)
    named = _subjects(findings, "name-not-on-cited-pages")
    kinds = {n["node_id"]: n["node_kind"] for n in SHARD["nodes"]}
    analytic = {nid for nid in named
                if kinds.get(nid) in {"clue", "conclusion", "rule", "secret", "scene", "ending"}}
    assert not analytic, f"analytic labels held to page containment: {sorted(analytic)}"


def test_a_source_named_kind_is_held_to_containment():
    """The complement of the rule above: the book does name its actors."""
    assert "npc" in gate.SOURCE_NAMED_KINDS
    assert "location" in gate.SOURCE_NAMED_KINDS
    assert "clue" not in gate.SOURCE_NAMED_KINDS
    assert "rule" not in gate.SOURCE_NAMED_KINDS


def test_paraphrase_whitespace_does_not_fabricate_a_finding():
    """OCR keeps the book's line wrapping; a summary written from it will not.

    Folding width and dropping whitespace is what lets "4-6 小时" match the
    page's "4-6小时" without loosening what the check actually measures.
    """
    # The page wraps mid-name, exactly as the real bundle's OCR does; the
    # graph cites it under the name a reader would write.
    catalog = {"span-x": "黄岩洞部\n族正在紧随猛犸和野牛群迁徙，一路向北。"}
    shard = {
        "nodes": [{
            "node_id": "faction-x", "node_kind": "faction", "name": "黄岩洞部族",
            "aliases": [], "summary": "紧随兽群向北。",
            "properties": {}, "evidence_span_ids": ["span-x"],
        }],
        "claims": [],
    }
    assert gate.check_grounding(shard, catalog) == [], (
        "a name the page wraps across a line read as absent"
    )
