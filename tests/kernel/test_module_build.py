"""§14.3: plan, packet, the three gates, machine fills, accept, assemble, install."""

from __future__ import annotations

import json
from pathlib import Path

from conftest import RpcClient, read_json
from module_helpers import (CHAPTER_BOOK_ID, TINY_ID, bind_chapter_book, bind_tiny, build_whole_book,
                            claim, codes, module_dir, node, packet_for, plan_four_sections,
                            plan_whole_book, reader_shard, review, span_with, write_shard)


def test_plan_cuts_by_budget_and_leaves_classification_to_the_agent(kernel: RpcClient, tmp_path: Path):
    bind_tiny(kernel, tmp_path)
    whole = kernel.ok("module.plan", {"module_id": TINY_ID})
    assert whole["basis"] == "whole_book_within_target"
    assert [s["pages"] for s in whole["sections"]] == [[0, 3]]
    assert whole["sections"][0]["kind"] is None and whole["sections"][0]["priority"] is None
    assert whole["measured"]["pages"] == 4 and whole["measured"]["chars"] == 503
    assert [p["pdf_index"] for p in whole["pages"]] == [0, 1, 2, 3]
    assert all(len(p["head"]) <= 2 for p in whole["pages"]), "the classifier sees two lines per page, not the book"

    cut = kernel.ok("module.plan", {"module_id": TINY_ID, "budget": 200})
    assert cut["basis"] == "heading_depth_2_within_target"
    assert [s["pages"] for s in cut["sections"]] == [[0, 0], [1, 1], [2, 2], [3, 3]]
    assert [s["title"] for s in cut["sections"]][1:3] == ["场景：码头茶棚", "场景：废弃货栈"]
    assert all(s["chars"] <= 200 for s in cut["sections"])

    partial = kernel.err("module.plan.accept", {"module_id": TINY_ID,
                                                 "sections": [{"id": cut["sections"][0]["id"], "kind": "front", "priority": 1}]})
    assert partial["code"] == "invalid_params"
    assert partial["details"]["problems"][0]["code"] == "unclassified_sections"
    bad_kind = kernel.err("module.plan.accept", {"module_id": TINY_ID, "sections": [
        {"id": s["id"], "kind": "chapter", "priority": 1} for s in cut["sections"]]})
    assert bad_kind["details"]["problems"][0]["code"] == "unknown_kind"

    accepted = kernel.ok("module.plan.accept", {"module_id": TINY_ID, "sections": [
        {"id": s["id"], "kind": k, "priority": p} for s, (k, p) in
        zip(cut["sections"], [("front", 90), ("scene", 100), ("scene", 80), ("appendix", 10)])]})
    assert accepted["sections"] == 4 and accepted["status"] == "planned"
    assert accepted["order"][0] == cut["sections"][1]["id"], "priority orders the build"
    table = read_json(module_dir(kernel.workspace) / "sections.json")
    assert [row["status"] for row in table] == ["planned"] * 4
    assert table[1] == {"id": cut["sections"][1]["id"], "title": "场景：码头茶棚", "pages": [1, 1], "chars": 188,
                        "kind": "scene", "priority": 100, "status": "planned", "shard": None, "rounds": 0}


def test_a_book_with_headings_is_cut_even_though_it_fits_the_budget(kernel: RpcClient, tmp_path: Path):
    """§14.13: the budget is a ceiling, the target is the aim. A 50,000-character book fits
    a 60,000 budget whole, and swallowing it whole is exactly what left the real 48-page
    book with one section, a reader that failed both grounding gates and a deepening queue
    with nothing to read (issue #33)."""
    bind_chapter_book(kernel, tmp_path)
    plan = kernel.ok("module.plan", {"module_id": CHAPTER_BOOK_ID})
    measured = plan["measured"]
    assert 45_000 <= measured["chars"] <= 60_000, measured["chars"]
    assert measured["fits_whole_book"] is True, "the whole book is under the budget"
    assert measured["fits_target"] is False, "and over the target, which is why it is cut"

    assert len(plan["sections"]) == 11, [s["pages"] for s in plan["sections"]]
    assert plan["basis"] == "heading_depth_1_within_target", "the basis says which rule chose this cut"
    assert all(section["chars"] <= measured["target"] for section in plan["sections"])
    assert [section["title"] for section in plan["sections"]][:2] == [
        "Chapter 1: The Long Winter Of Station 1", "Chapter 2: The Long Winter Of Station 2"]
    # The alternatives it beat are on the record beside it.
    depth_one = next(row for row in measured["heading_depth_cuts"] if row["depth"] == 1)
    assert depth_one["sections"] == 11 and depth_one["within_target"] is True
    assert plan["measured"]["target"] < plan["measured"]["budget"]

    written = read_json(module_dir(kernel.workspace, CHAPTER_BOOK_ID) / "work" / "plan.json")
    assert written["basis"] == plan["basis"] and written["target"] == measured["target"]
    # Several sections means a classification pass, and a deepening queue with something in it.
    assert plan["section_count"] == 11 and "brief" in plan

    # The target is a number a caller may name; raised above the book it keeps it whole.
    whole = kernel.ok("module.plan", {"module_id": CHAPTER_BOOK_ID, "target": 90_000})
    assert whole["basis"] == "whole_book_within_target" and len(whole["sections"]) == 1
    # ...but never above the ceiling: a budget below the target is the smaller of the two.
    clamped = kernel.ok("module.plan", {"module_id": CHAPTER_BOOK_ID, "budget": 9_000, "target": 90_000})
    assert clamped["measured"]["target"] == 9_000
    assert all(section["chars"] <= 9_000 for section in clamped["sections"])


def test_packet_carries_spans_window_skeleton_and_no_raw_pages(kernel: RpcClient, tmp_path: Path):
    bind_tiny(kernel, tmp_path)
    section_id = plan_whole_book(kernel)
    result = kernel.ok("module.packet", {"module_id": TINY_ID, "section_id": section_id})
    assert result["spans"] == 21 and result["page_window"] == {"first_page": 0, "last_page": 3,
                                                               "pages_before": 0, "pages_after": 0}
    packet = read_json(Path(result["packet"]))
    assert packet["contract_id"] == "coc.module-packet.v1"
    assert [s["span_id"] for s in packet["spans"]][:4] == ["span-p0-1", "span-p0-2", "span-p0-3", "span-p0-4"]
    assert all(set(s) == {"span_id", "page", "text"} for s in packet["spans"])
    assert "pages" not in packet and "bundle" not in packet, "no raw page dump beside the spans"
    assert packet["skeleton"]["module_node"]["node_id"] == "module-grey-heron-dock"
    assert packet["skeleton"]["known_nodes"] == []
    assert set(packet["vocabulary"]["node_kinds"]) >= {"scene", "npc", "clue", "conclusion"}
    assert packet["coverage_domains"] == ["structure", "world", "actors", "relationships", "events",
                                          "knowledge", "causal", "mechanics", "assets", "direction"]
    assert set(packet["machine_filled_keys"]["shard"]) >= {"relations", "coverage", "evidence_span_ids"}
    assert set(packet["machine_filled_keys"]["claim"]) >= {"visibility", "asserted_by_ids", "known_by_ids",
                                                           "validity", "claim_id"}
    brief = result["brief"]
    assert "bin/coc-evidence" in brief and "bin/coc-review" in brief and "span-p4-1" in brief
    assert result["commands"]["review"].endswith(f"--module {TINY_ID} --section {section_id}")
    assert kernel.ok("module.status", {"module_id": TINY_ID})["status"] == "building"
    assert read_json(module_dir(kernel.workspace) / "sections.json")[0]["status"] == "reading"


def test_review_runs_all_three_gates_and_names_each_refusal(kernel: RpcClient, tmp_path: Path):
    bind_tiny(kernel, tmp_path)
    section_id = plan_whole_book(kernel)
    packet, work_dir = packet_for(kernel, section_id)
    shard = reader_shard(packet)
    # an invented span id (the next page), an unprefixed node id, a number not on the page
    shard["nodes"][0]["evidence_span_ids"].append("span-p4-1")
    shard["nodes"].append(node("npc", "", "码头巡警", [span_with(packet, "雾锁码头")]))
    shard["nodes"][-1]["node_id"] = "dock-patrolman"
    next(n for n in shard["nodes"] if n["node_id"] == "npc-lao-zhou")["properties"]["age"] = 53
    shard["coverage"]["relationships"] = "accepted"
    write_shard(work_dir, shard)
    report = review(kernel, section_id)
    assert report["accepted"] is False
    by_gate = {(f["gate"], f["code"]) for f in report["findings"]}
    assert ("shape", "unknown_evidence_span") in by_gate
    assert ("shape", "node_id_kind_mismatch") in by_gate
    assert ("grounding", "number_not_on_cited_pages") in by_gate
    assert ("coverage", "coverage_outside_aspects") in by_gate
    assert ("grounding", "name_not_on_cited_pages") in by_gate, "the patrolman's name is on no cited span"
    assert report["gates"]["shape"] >= 2 and report["gates"]["grounding"] == 2 and report["gates"]["coverage"] == 1
    numbers = next(f for f in report["findings"] if f["code"] == "number_not_on_cited_pages")
    assert numbers["numbers"] == ["53"] and numbers["node_id"] == "npc-lao-zhou"
    assert all({"gate", "code", "path", "message"} <= set(f) for f in report["findings"])
    assert report["measures"]["available_spans"] == 21 and report["round"] == 1
    assert read_json(work_dir / "findings.json")["accepted"] is False
    refused = kernel.err("module.accept", {"module_id": TINY_ID, "section_id": section_id})
    assert refused["code"] == "invalid_params" and refused["details"]["findings"]
    log = [json.loads(line) for line in (module_dir(kernel.workspace) / "build.jsonl").read_text().splitlines()]
    assert log[-1]["event"] == "review" and "unknown_evidence_span" in log[-1]["findings_codes"]


def test_review_rejects_a_name_the_cited_span_does_not_carry(kernel: RpcClient, tmp_path: Path):
    bind_tiny(kernel, tmp_path)
    section_id = plan_whole_book(kernel)
    packet, work_dir = packet_for(kernel, section_id)
    shard = reader_shard(packet)
    shard["nodes"].append(node("npc", "captain-wang", "王船长", [span_with(packet, "雾锁码头")]))
    shard["claims"].append(claim("npc-captain-wang", "present-in", "scene-dock-teahouse", [span_with(packet, "雾锁码头")]))
    write_shard(work_dir, shard)
    report = review(kernel, section_id)
    assert codes(report) == {"name_not_on_cited_pages"}
    assert report["findings"][0]["gate"] == "grounding" and report["findings"][0]["node_id"] == "npc-captain-wang"


def test_machine_fills_relations_coverage_and_claim_defaults(kernel: RpcClient, tmp_path: Path):
    bind_tiny(kernel, tmp_path)
    section_id = plan_whole_book(kernel)
    packet, work_dir = packet_for(kernel, section_id)
    shard = reader_shard(packet, coverage={"structure": "accepted", "actors": "partial"})
    shard["aspects"] = ["structure", "actors"]
    assert "relations" not in shard and all("claim_id" not in c for c in shard["claims"])
    write_shard(work_dir, shard)
    report = review(kernel, section_id)
    assert report["accepted"], report["findings"]
    assert set(report["machine_filled"]) >= {"relations", "coverage", "evidence_span_ids", "node_refs", "contract_id"}
    accepted = kernel.ok("module.accept", {"module_id": TINY_ID, "section_id": section_id})
    assert accepted["relations"] == 8 and accepted["claims"] == 8
    stored = read_json(Path(accepted["shard"]))
    assert stored["contract_id"] == "coc.module-graph-shard.v3" and stored["schema_version"] == 3
    assert stored["coverage"] == {"structure": "accepted", "actors": "partial", "world": "unresolved",
                                  "relationships": "unresolved", "events": "unresolved", "knowledge": "unresolved",
                                  "causal": "unresolved", "mechanics": "unresolved", "assets": "unresolved",
                                  "direction": "unresolved"}
    first = stored["claims"][0]
    assert first["claim_id"] == "claim-scene-dock-teahouse-route-to-scene-abandoned-warehouse"
    assert first["visibility"] == "keeper-only" and first["asserted_by_ids"] == [] and first["validity"] is None
    rel = stored["relations"][0]
    assert rel == {"relation_id": "rel-scene-dock-teahouse-route-to-scene-abandoned-warehouse",
                   "relation_kind": "route-to", "from_node_id": "scene-dock-teahouse",
                   "to_node_id": "scene-abandoned-warehouse", "claim_id": first["claim_id"], "properties": {}}
    assert set(stored["evidence_span_ids"]) == {s for n in stored["nodes"] + stored["claims"] for s in n["evidence_span_ids"]}
    table = read_json(module_dir(kernel.workspace) / "sections.json")
    assert table[0]["status"] == "accepted" and table[0]["rounds"] == 1


def test_assemble_writes_a_graph_the_table_can_load(kernel: RpcClient, tmp_path: Path):
    from coc.module_graph import ModuleGraph
    section_id, result = build_whole_book(kernel, tmp_path)
    assert result["status"] == "assembled" and result["generation"] == 1
    assert result["playability"]["status"] == "playable" and result["playability"]["finding_counts"] == {}
    assert result["merge"] == {"nodes": 8, "claims": 10, "relations": 10, "conflicts": 0,
                               "unresolved_node_refs": 0, "dangling_relations": 0}
    measures = result["playability"]["measures"]
    assert measures["scenes"] == 2 and measures["clues"] == 2 and measures["conclusions"] == 1 and measures["npcs"] == 1
    assert measures["endings"] == 1 and measures["scene_components"] == 1 and measures["pages_covered"] == 4
    assert measures["span_consumption"] > 0.5 and measures["substantive_spans_uncited"] == 0
    assert result["opening_ready"] is True

    root = module_dir(kernel.workspace)
    graph = ModuleGraph(TINY_ID, root / "module-graph.json")
    start = graph.start_scene()
    assert graph.handle(start) == "dock-teahouse" and graph.display_name(start) == "码头茶棚"
    assert graph.scene_exits(start) == [{"to": "abandoned-warehouse"}]
    assert graph.scene_clue_ids(start) == ["clue-brass-whistle"] and graph.scene_npc_ids(start) == ["npc-lao-zhou"]
    assert graph.clue_view(graph.clue("brass-whistle"))["delivery_kind"] == "skill_check"
    assert graph.npc("老周")["node_id"] == "npc-lao-zhou"
    assert graph.title() == "灰鹭码头的雾"
    raw = read_json(root / "module-graph.json")
    assert raw["contract_id"] == "coc.module-graph.v3" and raw["section_ids"] == [section_id]
    assert [n["node_id"] for n in raw["nodes"]] == sorted(n["node_id"] for n in raw["nodes"])
    module_node = next(n for n in raw["nodes"] if n["node_kind"] == "module")
    assert module_node["evidence_span_ids"] == ["span-p0-1", "span-p0-2"], "skeleton span + the reader's"
    assert module_node["name"] == "灰鹭码头的雾" and module_node["summary"] == "灰鹭码头的雾"
    contains = [r for r in raw["relations"] if r["relation_kind"] == "contains"]
    assert {r["to_node_id"] for r in contains} == {"scene-dock-teahouse", "scene-abandoned-warehouse"}
    lao_zhou = next(n for n in raw["nodes"] if n["node_id"] == "npc-lao-zhou")
    assert lao_zhou["source_refs"] == [{"source_id": "pdf:grey-heron-dock", "pdf_index": 1,
                                        "grep_anchor": lao_zhou["source_refs"][0]["grep_anchor"]}]
    manifest = read_json(root / "module-graph-manifest.json")
    assert manifest["generation"] == 1 and manifest["node_count"] == 8
    meta = read_json(root / "module.json")
    assert meta["status"] == "assembled" and meta["generation"] == 1 and meta["opening_ready"] is True
    assert meta["assemble_report"]["counts"]["dangling_relations"] == 0

    installed = kernel.ok("module.install", {"module_id": TINY_ID})
    assert installed["status"] == "installed" and installed["forced"] is False
    assert kernel.ok("module.install", {"module_id": TINY_ID})["replayed"] is True
    again = kernel.ok("module.assemble", {"module_id": TINY_ID})
    assert again["generation"] == 2 and again["status"] == "installed", "status never regresses"


def test_fragmented_graph_is_assembled_not_playable_and_install_needs_force(kernel: RpcClient, tmp_path: Path):
    bind_tiny(kernel, tmp_path)
    section_id = plan_whole_book(kernel)
    packet, work_dir = packet_for(kernel, section_id)
    shard = reader_shard(packet)
    # A third scene with no exit chain, a clue nobody can find, and an actor in no scene.
    shard["nodes"].append(node("scene", "sunken-pier", "沉没的栈桥", [span_with(packet, "通向水下")], "拖拽痕迹尽头的水下。"))
    shard["nodes"].append(node("clue", "drag-marks", "拖拽的痕迹", [span_with(packet, "拖拽的痕迹")]))
    shard["nodes"].append(node("creature", "deep-one", "深潜者", [span_with(packet, "深潜者浮出水面")]))
    write_shard(work_dir, shard)
    assert review(kernel, section_id)["accepted"]
    kernel.ok("module.accept", {"module_id": TINY_ID, "section_id": section_id})
    result = kernel.ok("module.assemble", {"module_id": TINY_ID})
    assert result["status"] == "assembled_not_playable"
    assert result["playability"]["finding_counts"] == {"actor_in_no_scene": 1, "clue_nowhere_to_find": 1,
                                                       "clue_supports_nothing": 1, "scene_graph_fragmented": 1,
                                                       "scene_unreachable_from_entrance": 1}
    fragmented = next(f for f in result["playability"]["findings"] if f["code"] == "scene_graph_fragmented")
    assert fragmented["subject"] == "scene-sunken-pier"
    assert result["opening_ready"] is True, "the opening neighbourhood itself is whole"

    refused = kernel.err("module.install", {"module_id": TINY_ID})
    assert refused["code"] == "invalid_params" and "scene_graph_fragmented" in refused["details"]["finding_counts"]
    assert read_json(module_dir(kernel.workspace) / "module.json")["status"] == "assembled_not_playable"
    forced = kernel.ok("module.install", {"module_id": TINY_ID, "force": True})
    assert forced["status"] == "installed" and forced["forced"] is True
    meta = read_json(module_dir(kernel.workspace) / "module.json")
    assert meta["install"]["forced"] is True and meta["install"]["finding_counts"]["scene_graph_fragmented"] == 1


def test_assemble_reports_conflicts_and_dangling_refs_instead_of_raising(kernel: RpcClient, tmp_path: Path):
    bind_tiny(kernel, tmp_path)
    sections = plan_four_sections(kernel)
    front, teahouse, warehouse, appendix = sections
    # The teahouse section alone: its route-to and supports point at nodes other sections define.
    packet, work_dir = packet_for(kernel, teahouse)
    shard = reader_shard(packet)
    assert shard["node_refs"] == ["scene-abandoned-warehouse"], "both route-to claims cite this page"
    write_shard(work_dir, shard)
    assert review(kernel, teahouse)["accepted"]
    kernel.ok("module.accept", {"module_id": TINY_ID, "section_id": teahouse})
    result = kernel.ok("module.assemble", {"module_id": TINY_ID})
    assert result["status"] == "assembled_not_playable"
    assert result["merge"]["dangling_relations"] == 2 and result["merge"]["unresolved_node_refs"] == 1
    assert {d["node_id"] for d in result["dangling_relations"]} == {"scene-abandoned-warehouse"}
    assert {d["relation_kind"] for d in result["dangling_relations"]} == {"route-to"}
    assert result["playability"]["finding_counts"]["dangling_relation"] == 2
    assert result["playability"]["finding_counts"]["clue_supports_nothing"] == 1, "the supports line is on page 3"
    assert result["opening_ready"] is False and "exit:scene-abandoned-warehouse" in result["opening"]["missing"]

    # A second section redefining a node under another kind: reported, first reading kept.
    packet2, work_dir2 = packet_for(kernel, warehouse)
    shard2 = reader_shard(packet2)
    shard2["nodes"].append(node("location", "lao-zhou", "老周", [span_with(packet2, "货栈门上")]))
    shard2["nodes"][-1]["name"] = "货栈"
    shard2["nodes"][-1]["node_id"] = "npc-lao-zhou"
    write_shard(work_dir2, shard2)
    assert codes(review(kernel, warehouse)) == {"node_id_kind_mismatch"}


def test_opening_ready_waits_for_the_start_neighbourhood(kernel: RpcClient, tmp_path: Path):
    bind_tiny(kernel, tmp_path)
    front, teahouse, warehouse, appendix = plan_four_sections(kernel)

    def read_and_accept(section_id: str) -> dict:
        packet, work_dir = packet_for(kernel, section_id)
        write_shard(work_dir, reader_shard(packet))
        report = review(kernel, section_id)
        assert report["accepted"], report["findings"]
        kernel.ok("module.accept", {"module_id": TINY_ID, "section_id": section_id})
        return kernel.ok("module.assemble", {"module_id": TINY_ID})

    after_warehouse = read_and_accept(warehouse)
    assert after_warehouse["opening_ready"] is False and after_warehouse["opening"]["missing"] == ["start_scene"]
    assert kernel.ok("module.status", {"module_id": TINY_ID})["opening_ready"] is False

    after_teahouse = read_and_accept(teahouse)
    assert after_teahouse["generation"] == 2
    assert after_teahouse["opening_ready"] is False, "the start clue's conclusion is still on an unread page"
    assert after_teahouse["opening"]["finding_counts"] == {"clue_supports_nothing": 1}
    assert after_teahouse["opening"]["missing"] == []
    packet, _ = packet_for(kernel, appendix)
    roster = {n["node_id"]: n["section_id"] for n in packet["skeleton"]["known_nodes"]}
    assert roster["scene-dock-teahouse"] == teahouse and roster["clue-wet-ledger"] == warehouse

    after_appendix = read_and_accept(appendix)
    assert after_appendix["opening_ready"] is True and after_appendix["generation"] == 3
    assert after_appendix["status"] == "assembled", "the whole book is playable before the front matter is read"
    status = kernel.ok("module.status", {"module_id": TINY_ID})
    assert status["opening_ready"] is True and status["sections"]["by_status"] == {"accepted": 3, "planned": 1}
    module_node = next(n for n in read_json(module_dir(kernel.workspace) / "module-graph.json")["nodes"]
                       if n["node_kind"] == "module")
    assert module_node["evidence_span_ids"] == ["span-p1-1"], "page 0 unread: the module cites the first read page"
    after_front = read_and_accept(front)
    assert after_front["status"] == "assembled" and after_front["generation"] == 4
    module_node = next(n for n in read_json(module_dir(kernel.workspace) / "module-graph.json")["nodes"]
                       if n["node_kind"] == "module")
    assert module_node["evidence_span_ids"] == ["span-p0-1", "span-p0-2"]
