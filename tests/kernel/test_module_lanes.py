"""§14.6 the deepen queue and `section_for_scene`; §14.8 the asset registry."""

from __future__ import annotations

from pathlib import Path

from conftest import MODULE, RpcClient, read_json
from module_helpers import (TINY_ID, bind_tiny, build_whole_book, module_dir, packet_for,
                            plan_four_sections, reader_shard, review, write_shard)


def test_deepen_enqueue_claim_complete(kernel: RpcClient, tmp_path: Path):
    bind_tiny(kernel, tmp_path)
    front, teahouse, warehouse, appendix = plan_four_sections(kernel)
    queued = kernel.ok("module.deepen.enqueue", {"module_id": TINY_ID, "section_ids": [teahouse, warehouse],
                                                  "reason": "opening", "priority": 90})
    assert queued["queued"] == [teahouse, warehouse]
    kernel.ok("module.deepen.enqueue", {"module_id": TINY_ID, "section_ids": [warehouse], "reason": "move",
                                        "priority": 100})
    first = kernel.ok("module.deepen.claim", {"module_id": TINY_ID, "claimed_by": "lane-1"})
    assert first == {"section_id": warehouse, "reason": "move", "priority": 100}, "highest priority first"
    assert kernel.ok("module.deepen.claim", {"module_id": TINY_ID}) == {"section_id": None}, "one claim at a time"
    table = {row["id"]: row for row in read_json(module_dir(kernel.workspace) / "sections.json")}
    assert table[warehouse]["status"] == "reading"

    failed = kernel.ok("module.deepen.complete", {"module_id": TINY_ID, "section_id": warehouse, "ok": False,
                                                  "detail": {"why": "reader exited without a shard"}})
    assert failed["status"] == "failed"
    queue = read_json(module_dir(kernel.workspace) / "deepen-queue.json")
    assert [(q["section_id"], q["status"]) for q in queue] == [(teahouse, "queued"), (warehouse, "failed")]
    table = {row["id"]: row for row in read_json(module_dir(kernel.workspace) / "sections.json")}
    assert table[warehouse]["status"] == "failed"

    # A failed section stays in the queue and is retried once at the next enqueue.
    assert kernel.ok("module.deepen.enqueue", {"module_id": TINY_ID, "section_ids": [warehouse], "reason": "move",
                                               "priority": 100})["queued"] == [warehouse]
    assert kernel.ok("module.deepen.claim", {"module_id": TINY_ID})["section_id"] == warehouse
    kernel.ok("module.deepen.complete", {"module_id": TINY_ID, "section_id": warehouse, "ok": False})
    assert kernel.ok("module.deepen.enqueue", {"module_id": TINY_ID, "section_ids": [warehouse], "reason": "move",
                                               "priority": 100})["queued"] == [], "only one retry"
    claimed = kernel.ok("module.deepen.claim", {"module_id": TINY_ID})
    assert claimed["section_id"] == teahouse
    done = kernel.ok("module.deepen.complete", {"module_id": TINY_ID, "section_id": teahouse, "ok": True})
    assert done["status"] == "done"
    assert [q["section_id"] for q in read_json(module_dir(kernel.workspace) / "deepen-queue.json")] == [warehouse]
    error = kernel.err("module.deepen.complete", {"module_id": TINY_ID, "section_id": teahouse, "ok": True})
    assert error["code"] == "invalid_params"


def test_section_for_scene_and_scene_enqueue(kernel: RpcClient, tmp_path: Path):
    from coc.modules.deepen import material_state
    from coc.modules.store import ModuleStore
    bind_tiny(kernel, tmp_path)
    front, teahouse, warehouse, appendix = plan_four_sections(kernel)
    store = ModuleStore(kernel.workspace)
    assert store.section_for_scene(TINY_ID, "dock-teahouse") is None, "no graph yet"

    packet, work_dir = packet_for(kernel, teahouse)
    write_shard(work_dir, reader_shard(packet))
    assert review(kernel, teahouse)["accepted"]
    kernel.ok("module.accept", {"module_id": TINY_ID, "section_id": teahouse})
    kernel.ok("module.assemble", {"module_id": TINY_ID})
    assert store.section_for_scene(TINY_ID, "dock-teahouse") == {"section_id": teahouse, "status": "accepted"}
    assert store.section_for_scene(TINY_ID, "abandoned-warehouse") is None, "referenced, not yet defined"
    assert store.section_for_scene(TINY_ID, "nowhere") is None
    assert material_state(store, TINY_ID, "dock-teahouse") == "ready"
    assert material_state(store, TINY_ID, "abandoned-warehouse") == "missing"

    # Moving into the teahouse queues nothing for it (accepted) and cannot see the
    # warehouse's section until that scene is in the graph.
    result = kernel.ok("module.deepen.enqueue", {"module_id": TINY_ID, "scene": "dock-teahouse", "reason": "move"})
    assert result["here"] == teahouse and result["adjacent"] == [] and result["queued"] == []

    packet2, work_dir2 = packet_for(kernel, warehouse)
    write_shard(work_dir2, reader_shard(packet2))
    assert review(kernel, warehouse)["accepted"]
    kernel.ok("module.accept", {"module_id": TINY_ID, "section_id": warehouse})
    kernel.ok("module.assemble", {"module_id": TINY_ID})
    assert store.section_for_scene(TINY_ID, "abandoned-warehouse") == {"section_id": warehouse, "status": "accepted"}
    assert material_state(store, TINY_ID, "abandoned-warehouse") == "ready"
    assert store.section_for_scene(MODULE, "commission-briefing") is None, "unregistered module"
    kernel.ok("module.register", {"module_id": MODULE})
    assert store.section_for_scene(MODULE, "commission-briefing") == {"section_id": None, "status": "accepted"}
    assert material_state(store, MODULE, "commission-briefing") == "ready"


def test_assets_resolve_by_name_with_visibility(kernel: RpcClient, tmp_path: Path):
    build_whole_book(kernel, tmp_path)
    registry = read_json(module_dir(kernel.workspace) / "assets.json")
    assert [a["id"] for a in registry["assets"]] == ["asset-dock-map"]
    entry = registry["assets"][0]
    assert entry["kind"] == "map" and entry["pages"] == [3] and entry["visibility"] == "player-safe"
    assert entry["bundle_asset_id"] == "map-dock" and entry["path"] == "bundle/assets/map-dock.png"
    for name in ("码头与货栈平面图", "dock-map", "asset-dock-map", "map-dock"):
        found = kernel.ok("module.asset", {"module_id": TINY_ID, "name": name})
        assert found["player_visible"] is True
        assert Path(found["asset"]["path"]).is_file() and found["asset"]["media_type"] == "image/png"
    missing = kernel.err("module.asset", {"module_id": TINY_ID, "name": "藏宝图"})
    assert missing["code"] == "unknown_entity" and missing["details"]["candidates"][0]["name"] == "码头与货栈平面图"


def test_starter_assets_come_from_the_graph(kernel: RpcClient):
    from coc.modules.store import ModuleStore
    kernel.ok("module.register", {"module_id": MODULE})
    store = ModuleStore(kernel.workspace)
    assets = store.assets(MODULE)
    assert len(assets) == 30 and {a["kind"] for a in assets} <= {"handout", "map", "illustration"}
    handout = store.asset(MODULE, "Handout 2: Unpublished Boston Globe Story (1918)")
    assert handout is not None and handout["visibility"] == "player-safe" and handout["kind"] == "handout"
    assert handout["authored_text"].startswith("BOSTON GLOBE") and handout["node_id"] == "handout-globe-unpublished-1918"
    assert store.asset(MODULE, "globe-unpublished-1918") == handout
    keeper_only = kernel.ok("module.asset", {"module_id": MODULE, "name": "Bed attack illustration"})
    assert keeper_only["player_visible"] is False and keeper_only["asset"]["visibility"] == "keeper-only"
    assert keeper_only["asset"]["pages"] == [454]
