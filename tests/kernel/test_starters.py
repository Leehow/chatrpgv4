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

SCRIPT = KERNEL_DIR.parent / "scripts" / "starter_graph.py"
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


#: Contract §134.6: the two stated obligations authored into the haunting after the old projection.
HAUNTING_OBLIGATIONS = ["requirement-globe-archivist", "requirement-globe-clippings-access"]
#: Contract §136.28: the haunting's graph before RD-04 migrated it to shapes. The old script's diff stops after 40
#: differences, so the chain is compared in two links: the old projection against this graph (below), and this graph
#: against the shipped one, whose every difference is pinned by the next test.
PRE_RD04 = "566dca9da"


def pre_rd04_graph() -> dict | None:
    shown = subprocess.run(["git", "show", f"{PRE_RD04}:content/starters/the-haunting/module-graph.json"], cwd=WORKTREE,
                           capture_output=True, text=True)
    return json.loads(shown.stdout) if shown.returncode == 0 else None


@pytest.mark.skipif(not OLD_HAUNTING.exists(), reason="the old tree's the-haunting IR is not on this machine")
def test_the_haunting_old_projection_diff_is_only_the_new_typescript_map_metadata_and_the_morgue_obligations(tmp_path):
    graph = pre_rd04_graph()
    if graph is None:
        pytest.skip(f"the pre-RD-04 graph ({PRE_RD04}) is not in this checkout's history")
    # The old script's diff is positional: an added node shifts every later row. The §134 additions are
    # therefore set aside and pinned by name, so the diff below still names each remaining edit.
    assert [n["node_id"] for n in graph["nodes"] if n["node_kind"] == "requirement"] == HAUNTING_OBLIGATIONS
    assert [(c["subject_id"], c["object"]["node_id"]) for c in graph["claims"] if c["predicate"] == "has-requirement"] \
        == [("scene-newspaper-morgue", node) for node in HAUNTING_OBLIGATIONS]
    assert [r["claim_id"] for r in graph["relations"] if r["relation_kind"] == "has-requirement"] \
        == [f"claim-has-requirement-{node.removeprefix('requirement-')}" for node in HAUNTING_OBLIGATIONS]
    graph["nodes"] = [n for n in graph["nodes"] if n["node_kind"] != "requirement"]
    graph["claims"] = [c for c in graph["claims"] if c["predicate"] != "has-requirement"]
    graph["relations"] = [r for r in graph["relations"] if r["relation_kind"] != "has-requirement"]
    without = tmp_path / "module-graph.json"
    without.write_text(json.dumps(graph, ensure_ascii=False, indent=2))
    result = run_script("diff", "--starter-dir", str(OLD_HAUNTING),
                        "--against", str(without),
                        "--module-summary", "A source-bound 1920s Boston investigation of the Corbitt House.",
                        "--source-document-id", "source-document-keeper-rulebook-40th-the-haunting",
                        "--source-document-name", "Keeper Rulebook 40th Anniversary - The Haunting")
    assert result.returncode == 1, result.stdout + result.stderr
    morgue = "/nodes[scene-newspaper-morgue]/properties/runtime_projection/record"
    assert json.loads(result.stdout) == {
        "identical": False,
        "differences": [
            "/nodes[asset-corbitt-house-keeper-map-basement]/properties/image_sources: missing in new",
            "/nodes[asset-player-corbitt-house-map]/properties/image_sources: missing in new",
            "/nodes[asset-player-corbitt-house-map]/properties/map_regions: missing in new",
            '/nodes[asset-player-corbitt-house-map]/properties/role: "player-map" -> "player-delivery"',
            # §134.6's migration: the gate moved into the obligations; Ruth's invented roll removed (ruling Q3).
            f"{morgue}/affordances[0]/roll_gate: missing in old",
            f"{morgue}/affordances[1]/requires_completed_route_ids: missing in old",
            f"{morgue}/affordances[2]/requires_completed_route_ids: missing in old",
            f"{morgue}/affordances[2]/roll_gate: missing in old",
            f"{morgue}/npc_presence_requirements: missing in old",
        ],
    }


def _paths(before, after, path=""):
    """Every leaf path where two JSON values differ; lists of id-carrying rows are matched by id, not position."""
    if isinstance(before, dict) and isinstance(after, dict):
        for key in sorted(set(before) | set(after)):
            if key not in after:
                yield f"{path}/{key}: removed"
            elif key not in before:
                yield f"{path}/{key}: added"
            else:
                yield from _paths(before[key], after[key], f"{path}/{key}")
    elif isinstance(before, list) and isinstance(after, list):
        ident = next((k for k in ("node_id", "relation_id", "claim_id", "id", "clue_id", "clock_id", "weapon_id")
                      if before and all(isinstance(r, dict) and k in r for r in before + after)), None)
        if ident is None or len({r[ident] for r in before}) != len(before):
            if before != after:
                yield f"{path}: changed"
            return
        old, new = {r[ident]: r for r in before}, {r[ident]: r for r in after}
        for key in list(old) + [k for k in new if k not in old]:
            if key not in new:
                yield f"{path}[{key}]: removed"
            elif key not in old:
                yield f"{path}[{key}]: added"
            else:
                yield from _paths(old[key], new[key], f"{path}[{key}]")
    elif before != after:
        yield f"{path}: changed"


#: Contract §136.28, as the graph shows it: every difference RD-04 made to the haunting, and nothing else.
RD04_CHANGES = sorted(
    [f"/claims[claim-uses-rule-{scene}-{rule}]: added" for scene, rule in [
        ("central-library", "library-research"), ("chapel-of-contemplation-ruins", "chapel-floor-collapse"),
        ("corbitt-confrontation", "victory-rewards"), ("hall-of-records", "library-research"), ("upper-floor-bedroom", "bed-attack")]]
    + [f"/relations[relation-uses-rule-{scene}-{rule}]: added" for scene, rule in [
        ("central-library", "library-research"), ("chapel-of-contemplation-ruins", "chapel-floor-collapse"),
        ("corbitt-confrontation", "victory-rewards"), ("hall-of-records", "library-research"), ("upper-floor-bedroom", "bed-attack")]]
    + [f"/nodes[rule-{rule}]: added" for rule in ("bed-attack", "chapel-floor-collapse", "library-research", "victory-rewards")]
    + [f"/nodes[{conclusion}]/properties/runtime_projection/record/clues[{clue}]/affordance: removed" for conclusion, clue in [
        ("conclusion-corbitt-buried-in-basement", "clue-basement-burial-lawsuit"), ("conclusion-corbitt-buried-in-basement", "clue-will-executor-chapel"),
        ("conclusion-corbitt-is-undead-sorcerer", "clue-corbitt-diaries"), ("conclusion-house-haunted-by-corbitt", "clue-globe-unpublished-story")]]
    + [f"/nodes[{npc}]/properties/runtime_projection/record/mechanics/{key}: removed" for npc in ("npc-rat-pack", "npc-walter-corbitt")
       for key in ("fields_extracted", "fields_not_authored", "fields_observed", "provenance", "source_refs", "status", "subject_kind")]
    + [f"/nodes[{npc}]/properties/runtime_projection/record/mechanics/profile/{key}: removed" for npc in ("npc-rat-pack", "npc-walter-corbitt")
       for key in ("attacks", "attacks_per_round")]
    + ["/nodes[npc-rat-pack]/properties/runtime_projection/record/mechanics/profile/weapons: added",
       "/nodes[npc-rat-pack]/evidence_span_ids: changed", "/nodes[npc-rat-pack]/source_refs: changed",
       "/nodes[npc-walter-corbitt]/source_refs: changed",
       "/nodes[npc-walter-corbitt]/properties/runtime_projection/record/mechanics/profile/san_loss_to_see: removed",
       "/nodes[npc-walter-corbitt]/properties/runtime_projection/record/mechanics/profile/sanity_loss: added",
       "/nodes[npc-walter-corbitt]/properties/runtime_projection/record/mechanics/profile/weapons[floating-dagger]: removed",
       "/nodes[npc-walter-corbitt]/properties/runtime_projection/record/mechanics/profile/weapons[floating-knife]: added"]
    + [f"/nodes[npc-walter-corbitt]/properties/runtime_projection/record/mechanics/profile/weapons[claws]/{key}" for key in (
        "adds_damage_bonus: added", "book: added", "damage: added", "note: removed", "uses_per_round: added")]
    + [f"/nodes[scene-{scene}]/properties/runtime_projection/record/on_enter: removed" for scene in (
        "basement-rites", "corbitt-confrontation", "upper-floor-bedroom")]
    + ["/nodes[scene-corbitt-confrontation]/properties/runtime_projection/record/conclusion_contract/sanity_reward: removed",
       "/nodes[scene-chapel-of-contemplation-ruins]/properties/runtime_projection/record/optional_rules: removed"]
    + [f"/nodes[scene-{scene}]/properties/runtime_projection/record/affordances[{affordance}]/{key}: removed" for scene, affordance, key in [
        ("central-library", "central-library-search-1835", "time_profile"), ("central-library", "central-library-search-1852", "time_profile"),
        ("central-library", "central-library-search-1866", "time_profile"), ("central-library", "central-library-search-lawsuit-outcome", "time_profile"),
        ("hall-of-records", "library-use-civil", "time_profile"),
        ("chapel-of-contemplation-ruins", "descend-ruined-chapel-cellar", "authored_operation"),
        ("chapel-of-contemplation-ruins", "search-under-chapel-cabinet", "skills"),
        ("chapel-of-contemplation-ruins", "study-liber-ivonis", "authored_operation"),
        ("chapel-of-contemplation-ruins", "study-liber-ivonis", "skills"),
        ("newspaper-morgue", "persuade-arty", "skills"), ("newspaper-morgue", "befriend-ruth", "skills")]]
    + [f"/nodes[threat-corbitt-haunting]/properties/runtime_projection/record/dangers[{danger}]/attack_profiles: removed"
       for danger in ("floating-knife", "walter-corbitt")]
    + ["/nodes[threat-corbitt-haunting]/properties/runtime_projection/record/clocks[corbitt-awareness]/advances_on: added",
       "/nodes[tome-liber-ivonis]/evidence_span_ids: changed", "/nodes[tome-liber-ivonis]/source_refs: changed",
       "/nodes[tome-liber-ivonis]/properties/mechanics: added"])


def test_the_haunting_differs_from_its_pre_rd04_graph_only_by_the_migration():
    before = pre_rd04_graph()
    if before is None:
        pytest.skip(f"the pre-RD-04 graph ({PRE_RD04}) is not in this checkout's history")
    after = read_json(CONTENT_DIR / "starters" / "the-haunting" / "module-graph.json")
    assert sorted(_paths(before, after)) == RD04_CHANGES


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
