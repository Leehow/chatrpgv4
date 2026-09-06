"""§14.3 as the module extension drives it: a single-section book needs no classifier,
several sections get a classification packet whose reader writes work/_plan/plan.json,
and the last review round of a bad shard marks the section failed."""

import json

from module_helpers import TINY_ID, bind_tiny, module_dir, packet_for, review, write_shard


def _mcall(client, method, **params):
    return client.ok(f"module.{method}", params)


def test_single_section_book_is_planned_without_a_classifier(kernel, tmp_path):
    bind_tiny(kernel, tmp_path)
    plan = _mcall(kernel, "plan", module_id=TINY_ID)
    assert plan.get("auto") == "single-section book" and "brief" not in plan
    rows = json.loads((module_dir(kernel.workspace) / "sections.json").read_text(encoding="utf-8"))
    rows = rows["sections"] if isinstance(rows, dict) else rows
    assert [(r["id"], r["kind"], r["priority"], r["status"]) for r in rows] == [("section-01", "scene", 100, "planned")]
    status = _mcall(kernel, "status", module_id=TINY_ID)
    assert status["sections"]["rows"][0]["id"] == "section-01"


def test_several_sections_get_a_classification_packet_the_reader_answers(kernel, tmp_path):
    bind_tiny(kernel, tmp_path)
    plan = _mcall(kernel, "plan", module_id=TINY_ID, budget=1)
    assert plan["section_count"] > 1 and plan["brief"] and plan["packet"].endswith("packet.json")
    packet = json.loads(open(plan["packet"], encoding="utf-8").read())
    assert [c["id"] for c in packet["candidates"]] == [c["id"] for c in plan["sections"]]
    assert all("text" not in page for page in packet["pages"]), "the classifier sees heads, never the book"
    # without the reader's answer there is nothing to accept
    error = kernel.err("module.plan.accept", {"module_id": TINY_ID})
    assert error["code"] == "invalid_params"
    # the reader writes plan.json in the work dir; accept reads it
    answer = {"sections": [{"id": c["id"], "kind": "scene", "priority": 100 - i} for i, c in enumerate(packet["candidates"])]}
    (module_dir(kernel.workspace) / "work" / "_plan" / "plan.json").write_text(json.dumps(answer), encoding="utf-8")
    accepted = _mcall(kernel, "plan.accept", module_id=TINY_ID)
    assert accepted["sections"] == len(packet["candidates"])
    assert accepted["order"][0] == packet["candidates"][0]["id"]


def test_final_review_round_marks_the_section_failed(kernel, tmp_path):
    bind_tiny(kernel, tmp_path)
    _mcall(kernel, "plan", module_id=TINY_ID)
    packet, work_dir = packet_for(kernel, "section-01")
    write_shard(work_dir, {"contract_id": "coc.module-graph-shard.v3", "schema_version": 3, "module_id": TINY_ID,
                           "section_id": "section-01", "source_language": "zh-Hans", "aspects": [],
                           "evidence_span_ids": [], "node_refs": [], "coverage": {}, "nodes": [], "claims": [], "relations": []})
    first = kernel.ok("module.review", {"module_id": TINY_ID, "section_id": "section-01", "round": 1})
    assert first["accepted"] is False and "status" not in first
    last = kernel.ok("module.review", {"module_id": TINY_ID, "section_id": "section-01", "round": 3, "final": True})
    assert last["accepted"] is False and last["status"] == "failed"
    rows = _mcall(kernel, "status", module_id=TINY_ID)["sections"]["rows"]
    assert rows[0]["status"] == "failed"
