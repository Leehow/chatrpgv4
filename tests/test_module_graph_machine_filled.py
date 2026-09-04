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
        "relation_id": "rel-kloppe-in-camp",
        "relation_kind": "present-in",
        "from_node_id": "npc-kloppe",
        "to_node_id": "scene-camp",
        "claim_id": "claim-kloppe-in-camp",
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
    assert out["relations"] == authored


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
