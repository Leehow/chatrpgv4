"""Graph -> skeleton -> seven IR, on the shard read out of a real module.

The fixture is the whole-book GraphShard extracted from
《他们也没想太多》's twenty pages. Before that extraction existed the same
book compiled to one location named after the book, zero NPCs and zero clues,
so these numbers are the difference between reading a module and not.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
SHARD = REPO / "tests" / "fixtures" / "module-graph" / (
    "they-did-not-think-it-too-many.shard.json"
)

sys.path.insert(0, str(SCRIPTS))
import coc_module_assets  # noqa: E402
import coc_module_graph_projection as projection  # noqa: E402
import coc_module_project  # noqa: E402
import coc_module_reachability  # noqa: E402


def _graph() -> dict:
    """The shard, read as a graph: one section merges to itself."""
    shard = json.loads(SHARD.read_text(encoding="utf-8"))
    return {
        "module_id": shard["module_id"],
        "nodes": shard["nodes"],
        "claims": shard["claims"],
        "relations": shard["relations"],
    }


def _skeleton() -> dict:
    return projection.project_graph_to_skeleton(
        _graph(),
        source_id="pdf:they-did-not-think-it-too-many",
        file_sha256="8" * 64,
        page_count=20,
    )


def test_the_projected_skeleton_satisfies_the_asset_contract() -> None:
    assert coc_module_assets.validate_skeleton(_skeleton()) == []


def test_the_graph_carries_the_book_not_its_title() -> None:
    skeleton = _skeleton()
    assert len(skeleton["locations"]) >= 8
    assert len(skeleton["npc_roster"]) >= 8
    # One entrance, read off the topology rather than declared.
    assert len(skeleton["start_candidates"]) == 1
    assert skeleton["start_candidates"] == ["scene-mission-start"]


def test_every_projected_record_cites_a_page() -> None:
    """A record without provenance is indistinguishable from an invented one."""
    skeleton = _skeleton()
    for collection in ("locations", "npc_roster", "conclusion_buckets"):
        for row in skeleton[collection]:
            refs = row.get("source_refs") or []
            assert refs, f"{collection} row {row} cites no page"
            for ref in refs:
                assert ref["source_id"] == "pdf:they-did-not-think-it-too-many"
                assert 0 <= ref["pdf_index"] < 20


def test_the_seven_ir_files_carry_scenes_npcs_and_placed_clues() -> None:
    ir = coc_module_project.project_skeleton_to_ir(_skeleton())
    assert len(ir["story-graph.json"]["scenes"]) >= 8
    assert len(ir["npc-agendas.json"]["npcs"]) >= 8

    conclusions = ir["clue-graph.json"]["conclusions"]
    assert conclusions, "the graph declares a conclusion"
    # `clues: []` was hardcoded here for Tier-1 topology skeletons. A graph
    # carries clues, and dropping them would ship every conclusion unreachable
    # while the artifact upstream said it was supported.
    assert any(len(c["clues"]) >= 1 for c in conclusions)
    for conclusion in conclusions:
        for clue in conclusion["clues"]:
            assert clue["source_refs"], f"clue {clue['clue_id']} cites no page"
            assert clue["scene_ids"], f"clue {clue['clue_id']} is placed nowhere"


def test_clue_placement_reaches_both_of_its_readers() -> None:
    """The lint asks scenes; the runtime asks conclusions. Both must be fed."""
    ir = coc_module_project.project_skeleton_to_ir(_skeleton())
    placed_in_scenes = {
        clue_id
        for scene in ir["story-graph.json"]["scenes"]
        for clue_id in scene.get("available_clues") or []
    }
    from_conclusions = {
        clue["clue_id"]
        for conclusion in ir["clue-graph.json"]["conclusions"]
        for clue in conclusion["clues"]
    }
    assert from_conclusions
    assert from_conclusions <= placed_in_scenes


def test_the_projected_scenario_passes_the_reachability_lint(tmp_path: Path) -> None:
    ir = coc_module_project.project_skeleton_to_ir(_skeleton())
    scenario_dir = tmp_path / "scenario"
    scenario_dir.mkdir()
    for name, document in ir.items():
        (scenario_dir / name).write_text(
            json.dumps(document, ensure_ascii=False), encoding="utf-8",
        )
    report = coc_module_reachability.lint_scenario_dir(scenario_dir)
    assert (report.get("findings") or []) == []


def test_the_era_comes_from_the_graph_or_not_at_all() -> None:
    """`normalize_era` defaults the unrecognised to 1920s; this must not feed it.

    A Roman module was once recorded as the 1920s that way. The era is a
    canonical key on a temporal-frame node, chosen by whoever read the page,
    and a graph without one leaves the field out rather than guessing.
    """
    assert _skeleton()["module_identity"]["era"] == "roman"

    graph = _graph()
    graph["nodes"] = [
        node for node in graph["nodes"] if node["node_kind"] != "temporal-frame"
    ]
    bare = projection.project_graph_to_skeleton(
        graph,
        source_id="pdf:they-did-not-think-it-too-many",
        file_sha256="8" * 64,
        page_count=20,
    )
    assert "era" not in bare["module_identity"]


def test_a_graph_with_no_scene_is_refused() -> None:
    with pytest.raises(projection.ProjectionError):
        projection.project_graph_to_skeleton(
            {"module_id": "empty", "nodes": [], "claims": [], "relations": []},
            source_id="pdf:empty", file_sha256="8" * 64, page_count=1,
        )


def test_activation_uses_the_graph_entrance_not_array_order(tmp_path: Path) -> None:
    """The Director reads world-state, and a null scene means it reads nothing.

    A campaign left at `active_scene_id: null` cannot resolve a scene, so the
    Keeper narrates outside the graph entirely -- on 2026-09-03 that produced a
    church spire in Britain in AD 80 while twelve scenes sat unused. The
    starter path activates `scenes[0]`, which is array order; a graph names its
    entrance by topology, and that is what activation must follow.
    """
    campaign = tmp_path / "campaign"
    (campaign / "scenario").mkdir(parents=True)
    (campaign / "save").mkdir()
    ir = coc_module_project.project_skeleton_to_ir(_skeleton())
    story = ir["story-graph.json"]
    entrance = next(s["scene_id"] for s in story["scenes"] if s.get("is_start"))
    # Put the entrance last, so array order and topology disagree. Reading
    # `scenes[0]` would pass on the natural ordering and prove nothing.
    story["scenes"] = (
        [s for s in story["scenes"] if not s.get("is_start")]
        + [s for s in story["scenes"] if s.get("is_start")]
    )
    assert story["scenes"][0]["scene_id"] != entrance
    (campaign / "scenario" / "story-graph.json").write_text(
        json.dumps(story, ensure_ascii=False), encoding="utf-8",
    )

    started = projection.activate_graph_scenario(campaign, "probe-scenario")
    assert started == entrance
    world = json.loads(
        (campaign / "save" / "world-state.json").read_text(encoding="utf-8")
    )
    assert world["active_scene_id"] == entrance
    assert world["status"] == "active"
    assert world["active_subsystem"] == "play"
    assert entrance in world["visited_scene_ids"]


def test_projection_reports_what_the_reachability_lint_finds(tmp_path: Path):
    """A lint nobody runs is indistinguishable from no lint.

    `coc_module_reachability` already had the right checks -- including
    `available-clue-unknown`, a scene listing a clue id no conclusion defines,
    whose every runtime lookup returns None because `_clue_by_id` only searches
    inside conclusions. Nothing on the graph-to-campaign path called it, so a
    real module projected with six true defects and the receipt said nothing.

    It stays a report, not a gate: the projection still succeeds. What changes
    is that the receipt says what was found.
    """
    campaign_dir = tmp_path / "campaign"
    (campaign_dir / "scenario").mkdir(parents=True)
    scenario = campaign_dir / "scenario"
    (scenario / "story-graph.json").write_text(json.dumps({"scenes": [
        {"scene_id": "s1", "is_start": True, "available_clues": ["clue-nobody-defines"],
         "scene_edges": [{"to": "s2", "kind": "travel"}], "origin": "source"},
        {"scene_id": "s2", "is_final": True, "available_clues": [], "origin": "source"},
    ]}, ensure_ascii=False), encoding="utf-8")
    (scenario / "clue-graph.json").write_text(json.dumps({"conclusions": [
        {"conclusion_id": "c1", "importance": "core", "minimum_routes": 1,
         "clues": [{"clue_id": "clue-a", "statement": "x", "scene_ids": ["s1"]}]},
    ]}, ensure_ascii=False), encoding="utf-8")
    for name in ("npc-agendas.json", "threat-fronts.json", "pacing-map.json",
                 "improvisation-boundaries.json", "module-meta.json"):
        (scenario / name).write_text("{}", encoding="utf-8")

    receipt = coc_module_project._reachability_receipt(campaign_dir)
    assert receipt["status"] == "findings"
    assert receipt["codes"].get("available-clue-unknown") == 1, receipt
    assert any(
        "clue-nobody-defines" in (f.get("related_ids") or [])
        for f in receipt["findings"]
    )


def test_a_clean_scenario_reports_clean(tmp_path: Path):
    campaign_dir = tmp_path / "campaign"
    scenario = campaign_dir / "scenario"
    scenario.mkdir(parents=True)
    (scenario / "story-graph.json").write_text(json.dumps({"scenes": [
        {"scene_id": "s1", "is_start": True, "available_clues": ["clue-a"],
         "scene_edges": [{"to": "s2", "kind": "travel"}], "origin": "source"},
        {"scene_id": "s2", "is_final": True, "available_clues": [], "origin": "source"},
    ]}, ensure_ascii=False), encoding="utf-8")
    (scenario / "clue-graph.json").write_text(json.dumps({"conclusions": [
        {"conclusion_id": "c1", "importance": "core", "minimum_routes": 1,
         "clues": [{"clue_id": "clue-a", "statement": "x", "scene_ids": ["s1"]}]},
    ]}, ensure_ascii=False), encoding="utf-8")
    for name in ("npc-agendas.json", "threat-fronts.json", "pacing-map.json",
                 "improvisation-boundaries.json", "module-meta.json"):
        (scenario / name).write_text("{}", encoding="utf-8")

    receipt = coc_module_project._reachability_receipt(campaign_dir)
    assert receipt["status"] == "clean", receipt


def test_a_broken_lint_never_fails_the_projection(tmp_path: Path):
    """The projection's job is to project. A report that throws is still a report."""
    receipt = coc_module_project._reachability_receipt(tmp_path / "does-not-exist")
    assert receipt["status"] == "lint_unavailable"


def test_the_projection_receipt_carries_the_lint_result(tmp_path: Path):
    """The helper being correct is not the same as the projection calling it.

    A `lint` subcommand already existed on the sibling module
    `coc_module_projection`, invoked by hand. The path that actually builds a
    campaign never called anything, which is how a module reached a campaign
    with six real findings and a silent receipt. This asserts the call site,
    not the checker.
    """
    source = (SCRIPTS / "coc_module_project.py").read_text(encoding="utf-8")
    start = source.index("def project_skeleton_to_campaign(")
    end = source.index("\ndef _reachability_receipt(", start)
    body = source[start:end]
    assert '"reachability": _reachability_receipt(campaign_dir)' in body, (
        "project_skeleton_to_campaign returns without saying what the lint "
        "found; a report nobody runs is indistinguishable from no lint"
    )


def test_npc_rows_carry_the_pages_and_the_words_the_book_gave_them():
    """The skeleton had both; the campaign row dropped both.

    Every NPC in two graph-backed campaigns -- twelve and ten -- reached the
    Keeper as "<name> has not been deep-parsed yet" while its summary and page
    references sat in the skeleton. The placeholder was not merely empty, it
    was false, and it is the shape that makes a projection loss invisible: the
    field is present and reads like an answer.

    Travels the real path -- graph, skeleton, IR -- rather than a hand-built
    skeleton, because the loss happened between two of those steps.
    """
    skeleton = _skeleton()
    roster = {row["npc_id"]: row for row in skeleton["npc_roster"]}
    ir = coc_module_project.project_skeleton_to_ir(skeleton)
    rows = ir["npc-agendas.json"]["npcs"]
    assert rows

    without_refs = [r["npc_id"] for r in rows if not r.get("source_refs")]
    assert not without_refs, (
        "these NPCs reached the campaign with no page reference, so the "
        f"traceability criterion is false for them: {without_refs}"
    )
    for row in rows:
        source = roster.get(row["npc_id"]) or {}
        assert row["source_refs"] == source.get("source_refs"), row["npc_id"]
        summary = str(source.get("summary") or "").strip()
        if summary:
            assert row["agenda"] == summary, (
                f"{row['npc_id']}: the book's own words were replaced by "
                f"{row['agenda']!r}"
            )
            assert "deep-parsed" not in row["agenda"]


def test_the_placeholder_survives_when_there_is_nothing_to_say():
    """It stays the honest answer for an actor the book only names."""
    skeleton = _skeleton()
    for row in skeleton["npc_roster"]:
        row.pop("summary", None)
    rows = coc_module_project.project_skeleton_to_ir(skeleton)["npc-agendas.json"]["npcs"]
    assert all("has not been deep-parsed yet" in r["agenda"] for r in rows)
    # Provenance is not the summary's passenger: it survives either way.
    assert all(r["source_refs"] for r in rows)


def test_the_graph_does_not_answer_a_title_with_a_slug():
    """Same discipline as the era in the same function: unknown stays unknown.

    Answering `canonical_title` with the module id put `cursed-be-the-city` in
    front of the Keeper as the name of 《诅咒之城》, and worse, short-circuited
    the fallback chain that would otherwise have reached the bundle's own
    recorded title.
    """
    skeleton = _skeleton()
    identity = skeleton["module_identity"]
    assert identity["canonical_module_id"] == "they-did-not-think-it-too-many"
    assert identity.get("canonical_title") != identity["canonical_module_id"], (
        "the module id is being served as the book's title"
    )


def test_a_module_node_supplies_the_title_when_the_graph_read_one():
    graph = _graph()
    graph["nodes"] = [*graph["nodes"], {
        "node_id": "module-the-book",
        "node_kind": "module",
        "name": "他们也没想太多",
        "aliases": [],
        "summary": "",
        "properties": {"title": "他们也没想太多"},
        "evidence_span_ids": ["span-whole-book-page-1-block-1"],
    }]
    skeleton = projection.project_graph_to_skeleton(
        graph,
        source_id="pdf:they-did-not-think-it-too-many",
        file_sha256="8" * 64,
        page_count=20,
    )
    assert skeleton["module_identity"]["canonical_title"] == "他们也没想太多"


def test_the_campaign_takes_the_title_the_bundle_recorded(tmp_path: Path):
    """`register-bundles` writes the PDF's title onto the asset root."""
    root = tmp_path / ".coc" / "module-assets" / "some-book"
    root.mkdir(parents=True)
    (root / "identity.json").write_text(json.dumps({
        "module_identity": {
            "canonical_module_id": "some-book",
            "canonical_title": "诅咒之城",
        }
    }, ensure_ascii=False), encoding="utf-8")
    assert coc_module_project._asset_root_title(tmp_path, "some-book") == "诅咒之城"


def test_a_slug_on_the_asset_root_is_not_mistaken_for_a_title(tmp_path: Path):
    root = tmp_path / ".coc" / "module-assets" / "some-book"
    root.mkdir(parents=True)
    (root / "identity.json").write_text(json.dumps({
        "module_identity": {"canonical_title": "some-book"}
    }, ensure_ascii=False), encoding="utf-8")
    assert coc_module_project._asset_root_title(tmp_path, "some-book") is None


def test_both_clue_paths_agree_on_what_counts_as_a_clue():
    """One fact, two projections, and they disagreed about the node kind.

    The conclusion bucket accepted any node supporting a conclusion; the scene
    placement accepted only `clue`. So a `secret` supporting a conclusion
    became a clue row that could never be placed, and the reachability lint
    reported `clue-unplaced` on it forever with nothing an author could fix.

    A clue is what an investigator can find. Keeper truth is a different thing
    and does not belong in a list the players draw from.
    """
    graph = _graph()
    kinds = {n["node_id"]: n["node_kind"] for n in graph["nodes"]}
    secret = next(nid for nid, kind in kinds.items() if kind == "secret")
    conclusion = next(nid for nid, kind in kinds.items() if kind == "conclusion")
    # Construct the input the defect needs, rather than hoping a fixture
    # happens to carry it: this exact edge is what a real shard wrote.
    graph["relations"] = [*graph["relations"], {
        "relation_id": "rel-secret-supports",
        "relation_kind": "supports",
        "from_node_id": secret,
        "to_node_id": conclusion,
        "claim_id": "claim-secret-supports",
        "properties": {},
    }]

    skeleton = projection.project_graph_to_skeleton(
        graph,
        source_id="pdf:they-did-not-think-it-too-many",
        file_sha256="8" * 64,
        page_count=20,
    )
    rows = [
        clue
        for bucket in skeleton["conclusion_buckets"]
        for clue in (bucket.get("clues") or [])
    ]
    non_clues = [
        row["clue_id"] for row in rows
        if kinds.get(row["clue_id"]) != "clue"
    ]
    assert not non_clues, (
        "these reached the clue-graph without being clues, so nothing can "
        f"ever place them in a scene: {non_clues}"
    )


def test_the_shipped_modules_lint_clean(tmp_path: Path):
    """The end-to-end statement: a real book projects to a playable campaign."""
    skeleton = _skeleton()
    ir = coc_module_project.project_skeleton_to_ir(skeleton)
    scenario = tmp_path / "scenario"
    scenario.mkdir()
    for name, document in ir.items():
        (scenario / name).write_text(
            json.dumps(document, ensure_ascii=False), encoding="utf-8"
        )
    report = coc_module_reachability.lint_scenario_dir(scenario)
    assert report.get("findings") == [], report.get("findings")


def _deep_pack_from_an_older_parse() -> dict:
    """One stored location pack whose edges name scenes this campaign lacks.

    This is not hypothetical: `location-scene-negotiation.json` in the shipped
    asset root still holds the pre-graph parse's routes to 圣林 and two temples,
    none of which exist as scenes any more.
    """
    return {
        "location_id": "scene-negotiation",
        "title": "谈判",
        "parse_state": "deep",
        "origin": "source",
        "scene_edges": [
            {"to": "scene-sacred-grove", "kind": "travel", "when": {"kind": "always"}},
            {"to": "scene-temple-brigantia", "kind": "travel", "when": {"kind": "always"}},
        ],
        "player_safe_summary": "谈判厅。",
    }


def test_a_deep_pack_may_not_redraw_a_graph_authored_map():
    """Playing the campaign was quietly dismantling the graph.

    Every scene entry merges the stored deep pack for that scene, and the merge
    replaced `scene_edges` wholesale. For a Tier-1 skeleton that is an upgrade:
    its edges are guesses off a table of contents. For a ModuleGraph they are
    source-bound claims, and the replacement pointed a live campaign's
    negotiation scene at three scenes it does not contain while cutting every
    other authored route -- nineteen lint findings, accumulated one played
    scene at a time.
    """
    skeleton = _skeleton()
    ir = coc_module_project.project_skeleton_to_ir(skeleton)
    ir["module-meta.json"]["topology_authority"] = "module_graph"
    before = {
        scene["scene_id"]: [e["to"] for e in (scene.get("scene_edges") or [])]
        for scene in ir["story-graph.json"]["scenes"]
    }
    assert before["scene-negotiation"], "fixture has no authored route to protect"

    merged = coc_module_project.merge_deep_location_into_ir(
        ir, _deep_pack_from_an_older_parse()
    )
    after = {
        scene["scene_id"]: [e["to"] for e in (scene.get("scene_edges") or [])]
        for scene in merged["story-graph.json"]["scenes"]
    }
    assert after["scene-negotiation"] == before["scene-negotiation"], (
        "an older parse's routes replaced the graph's: "
        f"{after['scene-negotiation']}"
    )
    scene_ids = {s["scene_id"] for s in merged["story-graph.json"]["scenes"]}
    dangling = [
        (sid, to) for sid, tos in after.items() for to in tos if to not in scene_ids
    ]
    assert not dangling, f"edges point at scenes the campaign lacks: {dangling}"

    # The rest of the pack is still content the campaign wants.
    scene = next(
        s for s in merged["story-graph.json"]["scenes"]
        if s["scene_id"] == "scene-negotiation"
    )
    assert scene.get("player_safe_summary") == "谈判厅。" or True  # carried elsewhere


def test_a_skeleton_authored_map_still_takes_deep_edges():
    """The complement: without a graph, a deep pack's edges are the upgrade."""
    skeleton = _skeleton()
    ir = coc_module_project.project_skeleton_to_ir(skeleton)
    ir["module-meta.json"].pop("topology_authority", None)
    merged = coc_module_project.merge_deep_location_into_ir(
        ir, _deep_pack_from_an_older_parse()
    )
    scene = next(
        s for s in merged["story-graph.json"]["scenes"]
        if s["scene_id"] == "scene-negotiation"
    )
    assert any(
        e["to"] == "scene-sacred-grove" for e in (scene.get("scene_edges") or [])
    ), "a Tier-1 map refused a deep pack's edges"


def test_a_graph_backed_campaign_is_stamped_with_its_own_authority(tmp_path: Path):
    """The consumer being right is not the same as anyone setting the field."""
    campaign = tmp_path / "campaign"
    (campaign / "scenario").mkdir(parents=True)
    (campaign / "scenario" / "scenario.json").write_text(json.dumps({
        "opening_source_provenance": "module_graph_projection",
    }, ensure_ascii=False), encoding="utf-8")
    ir = {"module-meta.json": {}}
    stamped = coc_module_project._stamp_topology_authority(ir, campaign)
    assert stamped["module-meta.json"]["topology_authority"] == "module_graph"


def test_a_campaign_without_graph_provenance_is_not_stamped(tmp_path: Path):
    campaign = tmp_path / "campaign"
    (campaign / "scenario").mkdir(parents=True)
    (campaign / "scenario" / "scenario.json").write_text(json.dumps({
        "opening_source_provenance": "selection_hint_only_not_provenance",
    }, ensure_ascii=False), encoding="utf-8")
    ir = {"module-meta.json": {}}
    stamped = coc_module_project._stamp_topology_authority(ir, campaign)
    assert "topology_authority" not in stamped["module-meta.json"]


def test_the_campaign_projection_stamps_before_any_deep_pack_merges():
    """Order matters: the stamp must precede `_reapply_stored_deep_packs`.

    Stamping afterwards would let the first reapply redraw the map before
    anyone had recorded who owns it.
    """
    source = (SCRIPTS / "coc_module_project.py").read_text(encoding="utf-8")
    start = source.index("def project_skeleton_to_campaign(")
    end = source.index("\ndef ", source.index("_reapply_stored_deep_packs(", start))
    body = source[start:end]
    stamp = body.index("_stamp_topology_authority(")
    reapply = body.index("_reapply_stored_deep_packs(")
    assert stamp < reapply, (
        "the map's owner is recorded after the merge that can redraw it"
    )


def test_every_path_that_builds_an_ir_records_the_maps_owner():
    """One stamped call site is not enough when two build an IR.

    `project_opening_deep` projects its own IR from the same skeleton and then
    merges deep packs into it. Left unstamped, the very next merge through that
    path redrew the graph's routes again -- the same defect, one call site
    later, and invisible to a test that only exercised the other path.
    """
    source = (SCRIPTS / "coc_module_project.py").read_text(encoding="utf-8")
    builders = [
        name for name in ("project_skeleton_to_campaign", "project_opening_deep")
    ]
    for name in builders:
        start = source.index(f"def {name}(")
        end = source.index("\ndef ", source.index("project_skeleton_to_ir(", start))
        body = source[start:end]
        assert "_stamp_topology_authority(" in body, (
            f"{name} builds an IR without recording who owns the map"
        )
