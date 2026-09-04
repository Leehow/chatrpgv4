"""What the machine owes the model: the parts of a shard it fills itself.

Every case here is a measurement off the accepted shards on record, not a
preference. A model asked to write bookkeeping writes it wrong forever, and
it writes it slowly: relations alone were a fifth of every generation, and
across 966 of them not one said anything its claim had not already said.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))

spec = importlib.util.spec_from_file_location(
    "coc_module_graph_mf", SCRIPTS / "coc_module_graph.py"
)
graph = importlib.util.module_from_spec(spec)
spec.loader.exec_module(graph)


def _claim(claim_id: str = "claim-kloppe-in-camp", **over):
    base = {
        "claim_id": claim_id,
        "subject_id": "npc-kloppe",
        "predicate": "present-in",
        "object": {"node_id": "scene-camp"},
        "truth_status": "authored-fact",
        "evidence_span_ids": ["span-a"],
        "confidence": 1.0,
        "reason": "书上写着",
    }
    base.update(over)
    return base


def test_a_relation_is_derived_from_every_claim_that_states_one():
    out = graph.assemble_model_shard({"claims": [_claim()]})
    assert out["relations"] == [{
        "relation_id": "rel-npc-kloppe-present-in-scene-camp",
        "relation_kind": "present-in",
        "from_node_id": "npc-kloppe",
        "to_node_id": "scene-camp",
        "claim_id": "claim-npc-kloppe-present-in-scene-camp",
        "properties": {},
    }]


def test_a_derived_relation_cannot_disagree_with_its_claim():
    """The gate class this retires: a derived relation restates its source."""
    shard = {"claims": [_claim(), _claim("claim-camp-in-valley",
                                        subject_id="location-camp",
                                        predicate="located-in",
                                        object={"node_id": "location-valley"})]}
    out = graph.assemble_model_shard(shard)
    by_id = {c["claim_id"]: c for c in out["claims"]}
    for relation in out["relations"]:
        claim = by_id[relation["claim_id"]]
        assert relation["relation_kind"] == claim["predicate"]
        assert relation["from_node_id"] == claim["subject_id"]
        assert relation["to_node_id"] == claim["object"]["node_id"]


def test_relations_the_model_did_write_are_left_alone():
    """Deriving is a fallback, not a rewrite; an explicit list still wins."""
    authored = [{"relation_id": "rel-x", "relation_kind": "present-in",
                 "from_node_id": "npc-kloppe", "to_node_id": "scene-camp",
                 "claim_id": "claim-kloppe-in-camp", "properties": {"note": "kept"}}]
    out = graph.assemble_model_shard({"claims": [_claim()], "relations": authored})
    assert out["relations"][0]["properties"] == {"note": "kept"}
    assert out["relations"][0]["relation_id"] == "rel-x"
    # The claim it points at was renamed, so the pointer moved with it: a
    # rename that leaves references behind is a dangling reference.
    assert out["relations"][0]["claim_id"] == out["claims"][0]["claim_id"]


def test_a_claim_that_states_no_relation_derives_none():
    out = graph.assemble_model_shard({"claims": [_claim(predicate="not-a-relation-kind")]})
    assert out["relations"] == []


def test_constant_claim_fields_come_from_the_packet_default():
    out = graph.assemble_model_shard(
        {"claims": [_claim()]}, default_visibility="player-safe"
    )
    claim = out["claims"][0]
    assert claim["visibility"] == "player-safe"
    assert claim["asserted_by_ids"] == []
    assert claim["known_by_ids"] == []
    assert claim["validity"] is None


def test_a_claim_that_states_its_own_visibility_keeps_it():
    """Filling a default must never overwrite what the model actually said."""
    out = graph.assemble_model_shard(
        {"claims": [_claim(visibility="revealable")]}, default_visibility="keeper-only"
    )
    assert out["claims"][0]["visibility"] == "revealable"


def test_a_positionally_numbered_claim_id_is_refused():
    """`c1` restarts in every section and collides at merge -- 32 on record."""
    findings = graph.validate_shard({"claims": [_claim("c1")]})
    codes = {f["code"] for f in findings}
    assert "claim_id_prefix_missing" in codes


def test_a_fact_named_claim_id_passes_the_prefix_gate():
    findings = graph.validate_shard({"claims": [_claim("claim-kloppe-in-camp")]})
    codes = {f["code"] for f in findings}
    assert "claim_id_prefix_missing" not in codes


def test_the_contract_declares_which_keys_the_machine_fills():
    contract = json.loads(
        (ROOT / "plugins" / "coc-keeper" / "references"
         / "module-graph-contract-v3.json").read_text("utf-8")
    )
    filled = contract["machine_filled_keys"]
    assert "relations" in filled["shard"]
    assert set(filled["claim"]) == {
        "visibility", "asserted_by_ids", "known_by_ids", "validity"
    }
    # Anything declared machine-filled must actually be filled, or the
    # instruction stops naming a key nothing supplies.
    out = graph.assemble_model_shard({"claims": [_claim()]})
    for key in filled["claim"]:
        assert key in out["claims"][0]
    for key in filled["shard"]:
        assert key in out


def _catalog(pages):
    return {("pdf:demo", index): {"pdf_index": index} for index in pages}


def test_a_slice_declares_how_much_book_lies_outside_it():
    """Every fabricated span id on record named a page just past the packet."""
    window = graph._page_window(
        _catalog(range(0, 20)), [("pdf:demo", index) for index in (5, 6, 7)]
    )
    assert window == {"first_page": 5, "last_page": 7,
                      "pages_before": 5, "pages_after": 12}


def test_a_whole_book_packet_says_nothing_lies_outside_it():
    window = graph._page_window(
        _catalog(range(0, 3)), [("pdf:demo", index) for index in (0, 1, 2)]
    )
    assert window["pages_before"] == 0
    assert window["pages_after"] == 0


def test_the_window_counts_only_pages_the_bundle_carries():
    """A book with declared holes must not report pages that do not exist."""
    window = graph._page_window(
        _catalog([0, 1, 8, 9]), [("pdf:demo", 1)]
    )
    assert window == {"first_page": 1, "last_page": 1,
                      "pages_before": 1, "pages_after": 2}


def test_the_instruction_tells_a_slice_not_to_cite_forward():
    text = (ROOT / "plugins" / "coc-keeper" / "pi" / "prompts"
            / "module-graph-extraction.md").read_text("utf-8")
    assert "page_window" in text
    assert "不要引用 `evidence_view` 里没有的 span id" in text


def test_a_claim_is_named_by_what_it_says():
    """Two sections naming one fact must land on one id, and two facts must
    never land on the same one. A reader naming them by hand did both wrong:
    `c1` restarted every section, and `claim-elias-present-peru` was written
    once for "Elias is in the Peru section" and once for "Elias is in the Peru
    prologue scene" -- both true, neither the other."""
    coarse = graph.canonical_claim_id({
        "subject_id": "npc-jackson-elias", "predicate": "present-in",
        "object": {"node_id": "section-peru"}})
    fine = graph.canonical_claim_id({
        "subject_id": "npc-jackson-elias", "predicate": "present-in",
        "object": {"node_id": "scene-peru-prologue"}})
    assert coarse == "claim-npc-jackson-elias-present-in-section-peru"
    assert coarse != fine


def test_one_fact_read_twice_gets_one_id():
    left = graph.assemble_model_shard({"claims": [_claim("c1")]})
    right = graph.assemble_model_shard({"claims": [_claim("claim-whatever-else")]})
    assert left["claims"][0]["claim_id"] == right["claims"][0]["claim_id"]


def test_a_claim_id_stays_a_legal_semantic_id_however_long_the_nodes_are():
    long_id = "npc-" + "a" * 200
    claim_id = graph.canonical_claim_id({
        "subject_id": long_id, "predicate": "present-in",
        "object": {"node_id": long_id}})
    assert len(claim_id) <= 160
    assert graph._valid_semantic_id(claim_id)
    assert claim_id.startswith("claim-")


def test_a_claim_too_thin_to_name_keeps_what_it_had():
    out = graph.assemble_model_shard({"claims": [
        {"claim_id": "claim-partial", "subject_id": "npc-a",
         "predicate": "present-in", "object": {}, "truth_status": "authored-fact",
         "evidence_span_ids": ["span-a"], "reason": "x"}]})
    assert out["claims"][0]["claim_id"] == "claim-partial"
    assert out["relations"] == []


def _mergeable(section: str, *, reason: str, confidence):
    span = "span-page-1-block-1"
    return graph.assemble_model_shard({
        "contract_id": "coc.module-graph-shard.v3", "schema_version": 3,
        "module_id": "mod", "section_id": section, "source_language": "zh-Hans",
        "aspects": ["structure"], "evidence_span_ids": [span],
        "node_refs": [], "coverage": {},
        "nodes": [
            {"node_id": "npc-kloppe", "node_kind": "npc", "name": "克洛普",
             "visibility": "keeper-only", "aliases": [], "summary": "",
             "evidence_span_ids": [span], "properties": {}},
            {"node_id": "scene-camp", "node_kind": "scene", "name": "营地",
             "visibility": "keeper-only", "aliases": [], "summary": "",
             "evidence_span_ids": [span], "properties": {}},
        ],
        "claims": [{
            "claim_id": f"claim-{section}-whatever", "subject_id": "npc-kloppe",
            "predicate": "present-in", "object": {"node_id": "scene-camp"},
            "truth_status": "authored-fact", "evidence_span_ids": [span],
            "confidence": confidence, "reason": reason,
        }],
    })


def _span_catalog():
    return {"span-page-1-block-1": {
        "span_id": "span-page-1-block-1", "text": "克洛普在营地。",
        "source_ref": {"source_id": "pdf:mod", "pdf_index": 1,
                       "grep_anchor": "克洛普", "text_sha256": "0" * 64},
    }}


def test_two_readings_of_one_fact_merge_though_they_word_it_differently():
    """One pair of identically-meant claims, annotated once as "书结构列出该
    核心/附属分节。" and once as "书结构列出 Introduction 章。", refused a whole
    book with "same id has different meaning" -- when nothing about the meaning
    differed. `reason` is the reader's own prose, not an assertion."""
    merged = graph.merge_shards(
        [_mergeable("a", reason="第一次这么记的", confidence=1.0),
         _mergeable("b", reason="第二次换了个说法", confidence=None)],
        evidence_catalog=_span_catalog(),
    )
    claims = [c for c in merged["claims"]
              if c["subject_id"] == "npc-kloppe"]
    assert len(claims) == 1, "one fact became two"
    assert claims[0]["reason"] == "第一次这么记的"
    assert claims[0]["confidence"] == 1.0, "a stated confidence lost to an absent one"


def test_a_real_difference_in_meaning_still_refuses():
    left = _mergeable("a", reason="x", confidence=1.0)
    right = _mergeable("b", reason="x", confidence=1.0)
    right["claims"][0]["truth_status"] = "authored-rumor"
    try:
        graph.merge_shards([left, right], evidence_catalog=_span_catalog())
    except graph.ModuleGraphError as error:
        codes = {f["code"] for f in error.findings}
        assert "claim_conflict" in codes
        message = " ".join(f["message"] for f in error.findings)
        assert "truth_status" in message, "the refusal did not name what differed"
    else:
        raise AssertionError("a claim asserted as fact and as rumour merged")
