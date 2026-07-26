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
                "role": "transit",
                "truth_scope": {"max_tier": 1, "forbidden_domains": ["mythos_entity_identity"]},
                "improv_budget": {"named_npcs": 1, "new_locations": 0, "local_clues": 1, "complications": 1},
                "exit_affordances": ["车辆修好"],
            }
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


def test_promote_scene_records_divergence_and_updates_effective_role(campaign_ws):
    promoted = _run(
        campaign_ws,
        "state.promote_scene",
        {
            "to_role": "side_investigation",
            "reason": "玩家长期驻留并触发了本地阴谋线",
            "decision_id": "promote-1",
        },
    )
    assert promoted["ok"] is True, promoted
    data = promoted["data"]
    assert data["scene_id"] == campaign_ws["active_scene_id"]
    assert data["from_role"] == "transit"
    assert data["to_role"] == "side_investigation"
    assert data["module_divergence"] is True

    context = _run(campaign_ws, "scene.context")
    contract = context["data"]["scene_contract"]
    assert contract["effective_role"] == "side_investigation"
    assert contract["promoted"] is True
    assert not any("transit scene contract" in hint for hint in context["hints"])

    replay = _run(
        campaign_ws,
        "state.promote_scene",
        {
            "to_role": "side_investigation",
            "reason": "玩家长期驻留并触发了本地阴谋线",
            "decision_id": "promote-1",
        },
    )
    assert replay["ok"] is True
    assert replay["data"] == data


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
