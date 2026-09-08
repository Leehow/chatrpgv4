"""§14.9: the projected starter loads, opens a campaign, reproduces byte for byte,
and is accounted for by the kernel's playability check."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest
from setup_helpers import confirmed_investigator
from conftest import CONTENT_DIR, KERNEL_DIR, WORKTREE, campaign_dir, read_json

sys.path.insert(0, str(KERNEL_DIR))

from coc.module_graph import ModuleGraph  # noqa: E402
from coc.modules.store import ModuleStore  # noqa: E402
from coc.rules.graph_digest import compute_graph_content_digest  # noqa: E402

SCRIPT = WORKTREE / "scripts" / "starter_graph.py"
OLD_HAUNTING = Path("/Users/haoli/leehow/code/chatrpgv4/plugins/coc-keeper/references/starter-scenarios/the-haunting")


def test_starter_installs_both_reviewed_languages_without_generation(tmp_path):
    store = ModuleStore(tmp_path)
    first = store.register_starter("the-haunting", CONTENT_DIR / "starters")
    assert first["bundled_guidance_required"] is True
    assert len(first["character_guidance"]) == 2
    for key, reference in first["character_guidance"].items():
        folder = store.module_dir("the-haunting") / "character-guidance" / key
        saved = read_json(folder / "accepted.json")
        assert saved["play_language"] == reference["play_language"]
        assert saved["graph_sha256"] == first["graph_digest"]
        assert not (folder / "attempts").exists()
    # An older installed module needs its index upgraded even with unchanged graph.
    first.pop("character_guidance")
    store.write_module(first)
    upgraded = store.register_starter("the-haunting", CONTENT_DIR / "starters")
    assert len(upgraded["character_guidance"]) == 2
    assert upgraded["generation"] == first["generation"]
    assert store.register_starter("the-haunting", CONTENT_DIR / "starters") == upgraded
STARTERS = {
    "mystery-house": {"start": "crane-office", "languages": ["en"], "absent": []},
}
#: What K5a's check reports on the projected starter beyond `node_without_page` (a starter
#: without a source document has no page to cite; the reference starter the-haunting
#: gets the same finding on 32 nodes). These are IR facts, listed so a fix is noticed.
KNOWN_IR_FINDINGS = {
    "mystery-house": {("actor_in_no_scene", "npc-rat-swarm")},
}


def run_script(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["uv", "run", "--frozen", "python", str(SCRIPT), *args], cwd=WORKTREE,
                          capture_output=True, text=True)


@pytest.mark.parametrize("module_id", sorted(STARTERS))
def test_graph_loads_with_one_start_scene(module_id):
    graph = ModuleGraph(module_id, CONTENT_DIR / "starters" / module_id / "module-graph.json")
    assert graph.title()
    assert graph.handle(graph.start_scene()) == STARTERS[module_id]["start"]
    assert graph.scene_exits(graph.start_scene()), "the start scene has exits"
    assert graph.raw["source_languages"] == STARTERS[module_id]["languages"]


@pytest.mark.parametrize("module_id", sorted(STARTERS))
def test_manifest_matches_the_graph_and_accounts_for_the_projection(module_id):
    root = CONTENT_DIR / "starters" / module_id
    graph = read_json(root / "module-graph.json")
    manifest = read_json(root / "module-graph-manifest.json")
    assert manifest["graph_content_digest"] == compute_graph_content_digest(graph)
    assert manifest["node_count"] == len(graph["nodes"]) and manifest["relation_count"] == len(graph["relations"])
    projection = manifest["projection"]
    assert projection["absent_documents"] == STARTERS[module_id]["absent"]
    module_node = next(n for n in graph["nodes"] if n["node_kind"] == "module")
    documents = {d["filename"]: d for d in module_node["properties"]["runtime_projection"]["documents"]}
    for filename in STARTERS[module_id]["absent"]:
        assert documents[filename]["absent"] is True
        assert all(c["node_ids"] == [] for c in documents[filename]["collections"])
    assert projection["derived"] == {}
    assert projection["cjk_outside_declared_languages"] == {"module-meta.json": 49, "story-graph.json": 229}
    assert all(status == "accepted" for status in graph["coverage"].values())


@pytest.mark.parametrize("module_id", sorted(STARTERS))
def test_reprojection_reproduces_the_committed_graph(module_id):
    args = ["diff", "--starter-dir", str(CONTENT_DIR / "starters" / module_id),
            "--against", str(CONTENT_DIR / "starters" / module_id / "module-graph.json")]
    result = run_script(*args)
    assert result.returncode == 0, result.stdout + result.stderr
    assert json.loads(result.stdout)["identical"] is True


@pytest.mark.skipif(not OLD_HAUNTING.exists(), reason="the old tree's the-haunting IR is not on this machine")
def test_the_haunting_reprojects_byte_for_byte_given_the_three_literals_the_old_script_hardcoded():
    result = run_script("diff", "--starter-dir", str(OLD_HAUNTING),
                        "--against", str(CONTENT_DIR / "starters" / "the-haunting" / "module-graph.json"),
                        "--module-summary", "A source-bound 1920s Boston investigation of the Corbitt House.",
                        "--source-document-id", "source-document-keeper-rulebook-40th-the-haunting",
                        "--source-document-name", "Keeper Rulebook 40th Anniversary - The Haunting")
    assert result.returncode == 0, result.stdout + result.stderr
    assert json.loads(result.stdout)["identical"] is True


@pytest.mark.parametrize("module_id", sorted(STARTERS))
def test_playability_findings_are_accounted_for(module_id):
    pytest.importorskip("coc.modules.playability")
    from coc.modules.playability import check
    graph = read_json(CONTENT_DIR / "starters" / module_id / "module-graph.json")
    report = check(graph)
    hard = {"dangling_relation", "no_entrance_declared", "no_ending_declared", "scene_graph_fragmented",
            "scene_unreachable_from_entrance", "conclusion_without_support", "clue_supports_nothing"}
    assert not (set(report["finding_counts"]) & hard), report["finding_counts"]
    assert report["measures"]["scene_components"] == 1 and report["measures"]["endings"] >= 1
    other = {(f["code"], f["subject"]) for f in report["findings"] if f["code"] != "node_without_page"}
    assert other == KNOWN_IR_FINDINGS[module_id]
    # a starter without a source document cites no page on any node; the reference
    # starter gets the same finding — the checker has no way to be told "no pages" yet
    assert report["finding_counts"]["node_without_page"] == len(graph["nodes"])


@pytest.mark.parametrize("module_id", sorted(STARTERS))
def test_starter_opens_a_campaign_and_plays_a_turn(kernel, module_id):
    created = kernel.ok("campaign.create", {"id": "c1", "module": module_id, "play_language": "zh-Hans"})["campaign"]
    assert created["opening_scene"] == STARTERS[module_id]["start"] and created["status"] == "setting_up"
    assert read_json(kernel.workspace / ".coc" / "modules" / module_id / "module.json")["status"] == "installed"
    confirmed_investigator(kernel)
    kernel.ok("setup.complete", {"campaign": "c1"})
    opened = kernel.table("open")
    assert opened["scene"]["name"] == STARTERS[module_id]["start"]
    kernel.table("narrate", call_id="t0-c1", text="开场。")
    capsule = kernel.table("player_input", text="我看看四周。")["capsule"]
    assert capsule["where"]["scene"] == STARTERS[module_id]["start"]
    assert capsule["where"]["material"] == "ready"
    assert capsule["where"]["exits"] and all(e["material"] == "ready" for e in capsule["where"]["exits"])
    destination = capsule["where"]["exits"][0]["to"]
    moved = kernel.table("apply", call_id="t1-c1", effects=[{"kind": "move", "to": destination}])
    assert moved["world"]["active_scene"] == destination and moved["material"] == "ready"
    assert moved["deepen_queued"] == []
    assert read_json(campaign_dir(kernel.workspace, "c1") / "world.json")["active_scene"] == destination
