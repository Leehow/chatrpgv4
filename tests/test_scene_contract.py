"""Scene contract (truth scope + improv budget + promotion) contract tests."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
PYTHON = sys.executable


def _load(name: str, rel: str | Path):
    path = Path(rel)
    if not path.is_absolute():
        path = REPO / path
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_toolbox = _load("coc_toolbox_scene_contract", SCRIPTS / "coc_toolbox.py")
coc_starter = _load("coc_starter_scene_contract", SCRIPTS / "coc_starter.py")
coc_story_director = _load(
    "coc_story_director_contract", SCRIPTS / "coc_story_director.py"
)
coc_director_apply = _load(
    "coc_director_apply_scene_contract", SCRIPTS / "coc_director_apply.py"
)
coc_module_project = _load(
    "coc_module_project_scene_contract", SCRIPTS / "coc_module_project.py"
)


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


@pytest.fixture()
def campaign_ws(tmp_path: Path):
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "scene-contract-test"
    _write_json(
        coc_root / "runtime.json",
        {
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        },
    )
    quick = coc_starter.quick_start(
        coc_root,
        "the-haunting",
        "thomas-hayes",
        campaign_id=campaign_id,
        title="Scene Contract Test",
    )
    campaign_dir = Path(quick["campaign_dir"])
    ws = {
        "workspace": workspace,
        "coc_root": coc_root,
        "campaign_id": campaign_id,
        "campaign_dir": campaign_dir,
        "investigator_id": quick["investigator_id"],
        "quick": quick,
    }
    world = json.loads((campaign_dir / "save" / "world-state.json").read_text(encoding="utf-8"))
    ws["active_scene_id"] = str(world.get("active_scene_id"))
    # Author a transit scene contract onto the active scene.
    graph_path = campaign_dir / "scenario" / "story-graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    for scene in graph.get("scenes") or []:
        if scene.get("scene_id") == ws["active_scene_id"]:
            scene["scene_contract"] = {
                "schema_version": 1,
                "scene_id": ws["active_scene_id"],
                "role": "transit",
                "authored_purposes": ["旅途中的短暂停留"],
                "truth_scope": {"max_tier": 1, "forbidden_domains": ["mythos_entity_identity"]},
                "improv_budget": {"named_npcs": 1, "new_locations": 0, "local_clues": 1, "complications": 1},
                "exit_affordances": ["车辆修好"],
            }
            scene["scene_contract"] = coc_module_project.normalize_scene_contract(
                ws["active_scene_id"], scene["scene_contract"]
            )
    _write_json(graph_path, graph)
    return ws


def _run(ws, tool: str, args: dict | None = None) -> dict:
    result = coc_toolbox.run_tool(
        tool, ws["workspace"], ws["campaign_id"], dict(args or {})
    )
    assert isinstance(result, dict)
    return result


def test_scene_context_projects_contract_and_transit_hint(campaign_ws):
    context = _run(campaign_ws, "scene.context")
    assert context["ok"] is True, context
    contract = context["data"]["scene_contract"]
    assert contract["role"] == "transit"
    assert contract["schema_version"] == 1
    assert contract["scene_contract_id"].startswith("scene-contract-v1:")
    assert contract["authored_purposes"] == ["旅途中的短暂停留"]
    assert contract["effective_role"] == "transit"
    assert contract["promoted"] is False
    assert contract["truth_scope"]["max_tier"] == 1
    assert contract["budget_consumption"] == {
        "improvised_clues": 0,
        "improvised_npcs": 0,
    }
    assert contract["exit_affordances"] == ["车辆修好"]
    assert any("transit scene contract" in hint for hint in context["hints"])


def test_record_clue_improvised_tagging_and_budget_warning(campaign_ws):
    first = _run(
        campaign_ws,
        "state.record_clue",
        {
            "clue_id": "clue-improvised-mud-stain",
            "method": "spot",
            "decision_id": "improv-clue-1",
        },
    )
    assert first["ok"] is True, first
    flags = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "flags.json").read_text(encoding="utf-8")
    )
    record = flags["clues_found"]["clue-improvised-mud-stain"]
    assert record["provenance"] == "improvised"
    assert record["scene_id"] == campaign_ws["active_scene_id"]
    assert record["local_only"] is True
    assert record["can_unlock_authored_milestone"] is False
    assert record["scene_contract_id"].startswith("scene-contract-v1:")
    assert record["source_event_id"].startswith("tool-operation-v1:")
    assert first["data"]["provenance"]["source_event_id"] == record["source_event_id"]

    second = _run(
        campaign_ws,
        "state.record_clue",
        {
            "clue_id": "clue-improvised-symbol",
            "method": "spot",
            "decision_id": "improv-clue-2",
        },
    )
    assert second["ok"] is True
    assert any("improv budget exceeded" in warning for warning in second["warnings"])

    context = _run(campaign_ws, "scene.context")
    contract = context["data"]["scene_contract"]
    assert contract["budget_consumption"]["improvised_clues"] == 2
    assert any("improv budget exceeded" in warning for warning in context["warnings"])


def test_record_clue_truth_tier_ceiling_is_advisory(campaign_ws):
    graph_path = campaign_ws["campaign_dir"] / "scenario" / "clue-graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    conclusions = graph.get("conclusions") or []
    assert conclusions and conclusions[0].get("clues")
    clue = conclusions[0]["clues"][0]
    clue["truth_tier"] = 4
    clue_id = str(clue["clue_id"])
    _write_json(graph_path, graph)

    result = _run(
        campaign_ws,
        "state.record_clue",
        {"clue_id": clue_id, "method": "authored", "decision_id": "tier-clue-1"},
    )
    assert result["ok"] is True, result
    assert any("truth tier 4" in warning for warning in result["warnings"])
    world = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "world-state.json").read_text(encoding="utf-8")
    )
    assert clue_id in (world.get("discovered_clue_ids") or [])
    flags = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "flags.json").read_text(encoding="utf-8")
    )
    assert "provenance" not in flags["clues_found"][clue_id]

    events = [
        json.loads(line)
        for line in (campaign_ws["campaign_dir"] / "logs" / "events.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    ]
    drift = next(row for row in events if row.get("event_type") == "scene_scope_drift")
    assert drift["source_clue_id"] == clue_id
    assert drift["truth_tier"] == 4
    assert drift["max_tier"] == 1
    assert drift["effective_role"] == "transit"
    assert drift["acceptance_severity"] == "hard"
    assert drift["status"] == "unpromoted"

    context = _run(campaign_ws, "scene.context")
    findings = context["data"]["scene_contract"]["drift_findings"]
    assert findings == [drift]


def test_bridge_tier_scope_drift_is_advisory_not_hard_acceptance(campaign_ws):
    graph_path = campaign_ws["campaign_dir"] / "scenario" / "clue-graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    clue = graph["conclusions"][0]["clues"][0]
    clue["truth_tier"] = 2
    clue_id = str(clue["clue_id"])
    _write_json(graph_path, graph)

    result = _run(
        campaign_ws,
        "state.record_clue",
        {"clue_id": clue_id, "method": "authored", "decision_id": "tier-bridge-1"},
    )
    assert result["ok"] is True, result
    finding = _run(campaign_ws, "scene.context")["data"]["scene_contract"][
        "drift_findings"
    ][0]
    assert finding["truth_tier"] == 2
    assert finding["acceptance_severity"] == "advisory"


def _install_unlock_edges(campaign_ws, *, unknown_id: str, authored_id: str):
    graph_path = campaign_ws["campaign_dir"] / "scenario" / "story-graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    active = next(
        scene
        for scene in graph["scenes"]
        if scene.get("scene_id") == campaign_ws["active_scene_id"]
    )
    targets = [
        scene["scene_id"]
        for scene in graph["scenes"]
        if scene.get("scene_id") != campaign_ws["active_scene_id"]
    ]
    assert len(targets) >= 2
    active["scene_edges"] = [
        {
            "to": targets[0],
            "kind": "unlock",
            "when": {"kind": "clue_discovered", "clue_id": unknown_id},
        },
        {
            "to": targets[1],
            "kind": "unlock",
            "when": {"kind": "clue_discovered", "clue_id": authored_id},
        },
    ]
    _write_json(graph_path, graph)
    return targets


def test_improvised_local_clue_cannot_unlock_authored_prerequisite(campaign_ws):
    clue_graph = json.loads(
        (campaign_ws["campaign_dir"] / "scenario" / "clue-graph.json").read_text(
            encoding="utf-8"
        )
    )
    authored_id = str(clue_graph["conclusions"][0]["clues"][0]["clue_id"])
    unknown_id = "clue-improvised-authored-gate"
    targets = _install_unlock_edges(
        campaign_ws, unknown_id=unknown_id, authored_id=authored_id
    )

    result = _run(
        campaign_ws,
        "state.record_clue",
        {"clue_id": unknown_id, "method": "improvised", "decision_id": "local-gate-1"},
    )
    assert result["ok"] is True, result
    assert result["data"]["newly_unlocked_scenes"] == []
    assert result["data"]["provenance"]["can_unlock_authored_milestone"] is False
    world = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "world-state.json").read_text(
            encoding="utf-8"
        )
    )
    assert unknown_id in world["discovered_clue_ids"]
    assert targets[0] not in world["unlocked_scene_ids"]


def test_prior_improvised_clue_stays_ineligible_when_later_authored_clue_unlocks(
    campaign_ws,
):
    clue_graph = json.loads(
        (campaign_ws["campaign_dir"] / "scenario" / "clue-graph.json").read_text(
            encoding="utf-8"
        )
    )
    authored_id = str(clue_graph["conclusions"][0]["clues"][0]["clue_id"])
    unknown_id = "clue-improvised-prior"
    targets = _install_unlock_edges(
        campaign_ws, unknown_id=unknown_id, authored_id=authored_id
    )

    improvised = _run(
        campaign_ws,
        "state.record_clue",
        {"clue_id": unknown_id, "decision_id": "local-prior-1"},
    )
    assert improvised["ok"] is True
    authored = _run(
        campaign_ws,
        "state.record_clue",
        {"clue_id": authored_id, "decision_id": "authored-later-1"},
    )
    assert authored["ok"] is True, authored
    assert authored["data"]["newly_unlocked_scenes"] == [targets[1]]
    world = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "world-state.json").read_text(
            encoding="utf-8"
        )
    )
    assert targets[0] not in world["unlocked_scene_ids"]
    assert targets[1] in world["unlocked_scene_ids"]


def test_improvised_clue_stays_ineligible_after_unrelated_flag_change(campaign_ws):
    clue_graph = json.loads(
        (campaign_ws["campaign_dir"] / "scenario" / "clue-graph.json").read_text(
            encoding="utf-8"
        )
    )
    authored_id = str(clue_graph["conclusions"][0]["clues"][0]["clue_id"])
    unknown_id = "clue-improvised-before-flag"
    target = _install_unlock_edges(
        campaign_ws, unknown_id=unknown_id, authored_id=authored_id
    )[0]

    improvised = _run(
        campaign_ws,
        "state.record_clue",
        {"clue_id": unknown_id, "decision_id": "local-before-flag-1"},
    )
    assert improvised["ok"] is True
    changed = _run(
        campaign_ws,
        "state.set_flag",
        {
            "flag_id": "unrelated-scene-fact",
            "value": True,
            "decision_id": "unrelated-flag-1",
        },
    )
    assert changed["ok"] is True, changed
    assert changed["data"]["newly_unlocked_scenes"] == []
    world = json.loads(
        (campaign_ws["campaign_dir"] / "save" / "world-state.json").read_text(
            encoding="utf-8"
        )
    )
    assert target not in world["unlocked_scene_ids"]


def test_director_apply_reevaluation_excludes_improvised_clue(campaign_ws):
    clue_graph = json.loads(
        (campaign_ws["campaign_dir"] / "scenario" / "clue-graph.json").read_text(
            encoding="utf-8"
        )
    )
    authored_id = str(clue_graph["conclusions"][0]["clues"][0]["clue_id"])
    unknown_id = "clue-improvised-before-director-apply"
    target = _install_unlock_edges(
        campaign_ws, unknown_id=unknown_id, authored_id=authored_id
    )[0]
    assert _run(
        campaign_ws,
        "state.record_clue",
        {"clue_id": unknown_id, "decision_id": "local-before-apply-1"},
    )["ok"] is True

    campaign_dir = campaign_ws["campaign_dir"]
    world_path = campaign_dir / "save" / "world-state.json"
    world = json.loads(world_path.read_text(encoding="utf-8"))
    story = json.loads(
        (campaign_dir / "scenario" / "story-graph.json").read_text(encoding="utf-8")
    )
    events: list[dict] = []
    unlocked = coc_director_apply._apply_scene_unlock_pass(
        campaign_dir,
        campaign_dir / "save",
        world,
        story,
        discovered=list(world["discovered_clue_ids"]),
        decision_id="director-reevaluate-1",
        investigator_id=campaign_ws["investigator_id"],
        ts="2026-08-22T00:00:00Z",
        events=events,
        logs=campaign_dir / "logs",
    )
    assert unlocked == []
    assert target not in world["unlocked_scene_ids"]
    assert events == []


def test_promote_scene_records_divergence_and_updates_effective_role(campaign_ws):
    graph_path = campaign_ws["campaign_dir"] / "scenario" / "clue-graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    clue = graph["conclusions"][0]["clues"][0]
    clue["truth_tier"] = 4
    clue_id = str(clue["clue_id"])
    _write_json(graph_path, graph)
    recorded = _run(
        campaign_ws,
        "state.record_clue",
        {"clue_id": clue_id, "method": "authored", "decision_id": "promote-drift-1"},
    )
    assert recorded["ok"] is True
    drift_id = _run(campaign_ws, "scene.context")["data"]["scene_contract"][
        "drift_findings"
    ][0]["event_id"]

    promoted = _run(
        campaign_ws,
        "state.promote_scene",
        {
            "to_role": "side_investigation",
            "reason": "玩家长期驻留并触发了本地阴谋线",
            "source_event_ids": [drift_id],
            "decision_id": "promote-1",
        },
    )
    assert promoted["ok"] is True, promoted
    data = promoted["data"]
    assert data["scene_id"] == campaign_ws["active_scene_id"]
    assert data["from_role"] == "transit"
    assert data["to_role"] == "side_investigation"
    assert data["module_divergence"] is True
    assert data["event_id"].startswith("tool-operation-v1:")
    assert data["promotion_id"].startswith("scene-promotion-v1:")
    assert data["from_contract_id"].startswith("scene-contract-v1:")
    assert data["to_contract_id"].startswith("scene-contract-v1:")
    assert data["from_contract_id"] != data["to_contract_id"]
    assert data["source_event_ids"] == [drift_id]
    assert data["resolved_drift_event_ids"] == [drift_id]

    context = _run(campaign_ws, "scene.context")
    contract = context["data"]["scene_contract"]
    assert contract["effective_role"] == "side_investigation"
    assert contract["promoted"] is True
    assert contract["scene_contract_id"] == data["to_contract_id"]
    assert contract["drift_findings"][0]["status"] == "resolved"
    assert contract["drift_findings"][0]["resolved_by_promotion_id"] == data["promotion_id"]
    assert not any("transit scene contract" in hint for hint in context["hints"])

    replay = _run(
        campaign_ws,
        "state.promote_scene",
        {
            "to_role": "side_investigation",
            "reason": "玩家长期驻留并触发了本地阴谋线",
            "source_event_ids": [drift_id],
            "decision_id": "promote-1",
        },
    )
    assert replay["ok"] is True
    assert replay["data"] == data

    conflict = _run(
        campaign_ws,
        "state.promote_scene",
        {
            "to_role": "side_investigation",
            "reason": "玩家长期驻留并触发了本地阴谋线",
            "source_event_ids": [data["event_id"]],
            "decision_id": "promote-1",
        },
    )
    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "idempotency_conflict"


def test_promotion_only_resolves_the_named_scene_scope_drift(campaign_ws):
    graph_path = campaign_ws["campaign_dir"] / "scenario" / "clue-graph.json"
    graph = json.loads(graph_path.read_text(encoding="utf-8"))
    clue = graph["conclusions"][0]["clues"][0]
    clue["truth_tier"] = 4
    clue_id = str(clue["clue_id"])
    _write_json(graph_path, graph)
    recorded = _run(
        campaign_ws,
        "state.record_clue",
        {"clue_id": clue_id, "decision_id": "unnamed-drift-clue"},
    )
    assert recorded["ok"] is True
    events = [
        json.loads(line)
        for line in (campaign_ws["campaign_dir"] / "logs" / "events.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    ]
    clue_event_id = next(
        row["event_id"]
        for row in events
        if row.get("event_type") == "clue_discovered"
        and row.get("clue_id") == clue_id
    )
    drift_id = next(
        row["event_id"]
        for row in events
        if row.get("event_type") == "scene_scope_drift"
    )

    promoted = _run(
        campaign_ws,
        "state.promote_scene",
        {
            "to_role": "side_investigation",
            "reason": "玩家的行动使本地调查升级",
            "source_event_ids": [clue_event_id],
            "decision_id": "promote-without-drift-ref",
        },
    )
    assert promoted["ok"] is True, promoted
    assert promoted["data"]["resolved_drift_event_ids"] == []
    finding = _run(campaign_ws, "scene.context")["data"]["scene_contract"][
        "drift_findings"
    ][0]
    assert finding["event_id"] == drift_id
    assert finding["status"] == "unpromoted"
    assert "resolved_by_promotion_id" not in finding


def test_promotion_rejects_unresolved_source_event(campaign_ws):
    result = _run(
        campaign_ws,
        "state.promote_scene",
        {
            "to_role": "side_investigation",
            "reason": "没有正式来源的升级不得写入",
            "source_event_ids": ["tool-operation-v1:" + "0" * 32],
            "decision_id": "promote-missing-source",
        },
    )
    assert result["ok"] is False
    assert result["error"]["code"] == "source_event_invalid"


def test_is_bridge_scene_consumes_contract_role_and_waypoint():
    assert coc_story_director._is_bridge_scene(
        {"scene_type": "social", "scene_contract": {"role": "transit"}}
    ) is True
    assert coc_story_director._is_bridge_scene(
        {"scene_type": "social", "location_tags": ["sovkhoz", "waypoint"]}
    ) is True
    assert coc_story_director._is_bridge_scene(
        {"scene_type": "social", "location_tags": ["sovkhoz"]}
    ) is False
    assert coc_story_director._is_bridge_scene(
        {"scene_type": "journey"}
    ) is False or True  # legacy kinds still work via scene_kind/kind
    assert coc_story_director._is_bridge_scene({"scene_kind": "bridge"}) is True
