"""Long-term story memory layer: card schema, memory.* toolbox ops, CALLBACK.

Deterministic contracts only: schema validation (kind/status lifecycle),
memory.search filtering + privacy labels, memory.write / memory.resolve_hook
decision_id idempotency, and Director CALLBACK candidate generation. Semantic
adoption stays with the live KP and real play.
"""
from __future__ import annotations

import importlib.util
import json
import random
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"


def _load(name: str, rel: str | Path):
    path = Path(rel)
    if not path.is_absolute():
        path = REPO / path
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_memory = _load("coc_memory_ops_under_test", SCRIPTS / "coc_memory.py")
coc_toolbox = _load("coc_toolbox_memory_ops", SCRIPTS / "coc_toolbox.py")
coc_starter = _load("coc_starter_memory_ops", SCRIPTS / "coc_starter.py")
coc_story_director = _load(
    "coc_story_director_memory_ops", SCRIPTS / "coc_story_director.py"
)
coc_state = _load("coc_state_memory_ops", SCRIPTS / "coc_state.py")
coc_flag_state = _load("coc_flag_state_memory_ops", SCRIPTS / "coc_flag_state.py")


def _campaign(tmp_path: Path) -> Path:
    camp = tmp_path / "campaigns" / "memtest"
    (camp / "memory" / "cards" / "player-safe").mkdir(parents=True)
    (camp / "memory" / "cards" / "keeper-only").mkdir(parents=True)
    return camp


def _hook_card(camp: Path, memory_id: str = "mem-hook-cellar", **overrides):
    kwargs = dict(
        campaign_dir=camp,
        memory_id=memory_id,
        privacy="keeper_only",
        salience=0.8,
        summary="地窖里传来的敲击声还没有解释。",
        entities=["corbitt-house", "cellar"],
        tags=["thread"],
        reactivation_cues=["敲击声"],
        kind="unresolved_hook",
        introduced_at="turn-3",
    )
    kwargs.update(overrides)
    return coc_memory.create_memory_card(**kwargs)


# --------------------------------------------------------------------------- #
# Schema validation
# --------------------------------------------------------------------------- #


def test_create_card_without_kind_fails(tmp_path):
    camp = _campaign(tmp_path)
    with pytest.raises(TypeError):
        coc_memory.create_memory_card(
            campaign_dir=camp, memory_id="mem-x", privacy="player_safe",
            summary="x", entities=[], tags=[], reactivation_cues=[],
        )


def test_create_card_with_unknown_kind_fails(tmp_path):
    camp = _campaign(tmp_path)
    with pytest.raises(ValueError, match="kind"):
        coc_memory.create_memory_card(
            campaign_dir=camp, memory_id="mem-x", privacy="player_safe",
            summary="x", entities=[], tags=[], reactivation_cues=[],
            kind="rumor",
        )


def test_status_only_valid_for_hook_kinds(tmp_path):
    camp = _campaign(tmp_path)
    with pytest.raises(ValueError, match="status"):
        coc_memory.create_memory_card(
            campaign_dir=camp, memory_id="mem-x", privacy="player_safe",
            summary="x", entities=[], tags=[], reactivation_cues=[],
            kind="fact", status="open",
        )
    with pytest.raises(ValueError, match="status"):
        coc_memory.create_memory_card(
            campaign_dir=camp, memory_id="mem-y", privacy="player_safe",
            summary="y", entities=[], tags=[], reactivation_cues=[],
            kind="unresolved_hook", status="pending",
        )


def test_hook_defaults_to_open_and_records_lifecycle_fields(tmp_path):
    camp = _campaign(tmp_path)
    path = _hook_card(camp)
    text = path.read_text(encoding="utf-8")
    assert "kind: unresolved_hook" in text
    assert "status: open" in text
    assert "introduced_at: turn-3" in text
    index = json.loads((camp / "memory" / "index.json").read_text(encoding="utf-8"))
    row = next(r for r in index["cards"] if r["memory_id"] == "mem-hook-cellar")
    assert row["kind"] == "unresolved_hook"
    assert row["status"] == "open"
    assert row["introduced_at"] == "turn-3"


def test_legacy_card_missing_kind_fails_validation_clean_slate(tmp_path):
    camp = _campaign(tmp_path)
    legacy = camp / "memory" / "cards" / "player-safe" / "mem-legacy.md"
    legacy.write_text(
        "---\nmemory_id: mem-legacy\nscope: campaign\nprivacy: player_safe\n"
        "salience: 0.9\nentities:\n  - corbitt-house\ntags:\n  - x\n"
        "reactivation_cues:\n  - door\n---\n\n旧卡没有 kind。\n",
        encoding="utf-8",
    )
    assert coc_memory.card_validation_errors({"memory_id": "mem-legacy"})
    results = coc_memory.retrieve_memory_cards(
        campaign_dir=camp, query_entities=["corbitt-house"],
        query_cues=[], query_tags=[], privacy_filter="keeper", limit=5,
    )
    assert all(r["memory_id"] != "mem-legacy" for r in results)
    coc_memory.update_memory_index(camp)
    index = json.loads((camp / "memory" / "index.json").read_text(encoding="utf-8"))
    assert all(r["memory_id"] != "mem-legacy" for r in index["cards"])
    invalid = {r["memory_id"]: r for r in index.get("invalid_cards") or []}
    assert "mem-legacy" in invalid
    assert any("kind" in err for err in invalid["mem-legacy"]["errors"])


def test_retrieve_filters_by_kind_and_status(tmp_path):
    camp = _campaign(tmp_path)
    _hook_card(camp, memory_id="mem-hook-open")
    _hook_card(camp, memory_id="mem-hook-done")
    coc_memory.resolve_hook_card(camp, "mem-hook-done", "paid_off")
    coc_memory.create_memory_card(
        campaign_dir=camp, memory_id="mem-fact", privacy="keeper_only",
        salience=0.9, summary="事实卡", entities=["corbitt-house"],
        tags=[], reactivation_cues=[], kind="fact",
    )
    open_hooks = coc_memory.retrieve_memory_cards(
        campaign_dir=camp, query_entities=["corbitt-house"],
        query_cues=[], query_tags=[], privacy_filter="keeper", limit=10,
        kinds=["unresolved_hook", "foreshadowing"], statuses=["open"],
    )
    assert {c["memory_id"] for c in open_hooks} == {"mem-hook-open"}


# --------------------------------------------------------------------------- #
# Hook lifecycle
# --------------------------------------------------------------------------- #


def test_resolve_hook_transitions_and_is_idempotent(tmp_path):
    camp = _campaign(tmp_path)
    _hook_card(camp)
    receipt = coc_memory.resolve_hook_card(
        camp, "mem-hook-cellar", "paid_off",
        resolved_at="turn-9", reason="敲击声的来源在第九回合揭晓",
    )
    assert receipt == {
        "memory_id": "mem-hook-cellar",
        "kind": "unresolved_hook",
        "status": "paid_off",
        "resolved_at": "turn-9",
        "already_resolved": False,
    }
    card = coc_memory.find_card(camp, "mem-hook-cellar")
    assert card["status"] == "paid_off"
    assert card["resolved_at"] == "turn-9"
    again = coc_memory.resolve_hook_card(camp, "mem-hook-cellar", "paid_off")
    assert again["already_resolved"] is True
    assert again["resolved_at"] == "turn-9"


def test_resolve_hook_rejects_non_hook_kinds_and_bad_status(tmp_path):
    camp = _campaign(tmp_path)
    coc_memory.create_memory_card(
        campaign_dir=camp, memory_id="mem-fact", privacy="player_safe",
        salience=0.5, summary="事实", entities=[], tags=[],
        reactivation_cues=[], kind="fact",
    )
    with pytest.raises(ValueError, match="lifecycle"):
        coc_memory.resolve_hook_card(camp, "mem-fact", "resolved")
    _hook_card(camp)
    with pytest.raises(ValueError, match="resolution"):
        coc_memory.resolve_hook_card(camp, "mem-hook-cellar", "open")
    with pytest.raises(ValueError, match="not found"):
        coc_memory.resolve_hook_card(camp, "mem-missing", "resolved")


# --------------------------------------------------------------------------- #
# Toolbox memory.* operations
# --------------------------------------------------------------------------- #


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


@pytest.fixture
def campaign_ws(tmp_path: Path):
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "memory-ops-test"
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
        title="Memory Ops Test",
    )
    return {
        "workspace": workspace,
        "campaign_id": campaign_id,
        "campaign_dir": Path(quick["campaign_dir"]),
    }


def _run(ws, tool: str, args: dict | None = None) -> dict:
    return coc_toolbox.run_tool(tool, ws["workspace"], ws["campaign_id"], args or {})


def test_memory_ops_registered_with_policy():
    for name in ("memory.search", "memory.write", "memory.resolve_hook"):
        assert name in coc_toolbox.TOOLS
        policy = coc_toolbox.operation_policy(name)
        assert policy["audience"] == "keeper"
    search = coc_toolbox.operation_policy("memory.search")
    assert search["kp_surface"] == "context"
    assert search["contract"] == "none"
    assert coc_toolbox.TOOLS["memory.search"]["access"] == "query"
    for name in ("memory.write", "memory.resolve_hook"):
        policy = coc_toolbox.operation_policy(name)
        assert policy["kp_surface"] == "state"
        assert policy["contract"] == "state"
        assert policy["phases"] == ["live_turn"]
        # decision_id is a required idempotency key on mutations.
        assert coc_toolbox.TOOLS[name]["params"]["decision_id"]["required"] is True


def test_memory_write_is_idempotent_via_decision_id(campaign_ws):
    args = {
        "memory_id": "mem-hook-attic",
        "kind": "foreshadowing",
        "privacy": "keeper_only",
        "summary": "阁楼的冷风与低语尚未兑现。",
        "entities": ["attic"],
        "tags": ["thread"],
        "reactivation_cues": ["低语"],
        "introduced_at": "turn-2",
        "decision_id": "memwrite-1",
    }
    first = _run(campaign_ws, "memory.write", args)
    assert first["ok"] is True, first
    assert first["data"]["kind"] == "foreshadowing"
    assert first["data"]["status"] == "open"
    replay = _run(campaign_ws, "memory.write", args)
    assert replay["ok"] is True
    assert replay["data"] == first["data"]
    assert any("duplicate decision_id" in w for w in replay["warnings"])
    cards_dir = campaign_ws["campaign_dir"] / "memory" / "cards" / "keeper-only"
    assert len(list(cards_dir.glob("mem-hook-attic*.md"))) == 1
    # A new decision may not silently overwrite an existing card.
    conflict = _run(
        campaign_ws, "memory.write", {**args, "decision_id": "memwrite-2"}
    )
    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "invalid_param"


def test_memory_write_rejects_schema_violations(campaign_ws):
    base = {
        "memory_id": "mem-bad",
        "privacy": "player_safe",
        "summary": "x",
        "decision_id": "membad-1",
    }
    bad_kind = _run(campaign_ws, "memory.write", {**base, "kind": "rumor"})
    assert bad_kind["ok"] is False
    assert bad_kind["error"]["code"] == "invalid_param"
    bad_status = _run(
        campaign_ws, "memory.write",
        {**base, "kind": "fact", "status": "open", "decision_id": "membad-2"},
    )
    assert bad_status["ok"] is False
    assert bad_status["error"]["code"] == "invalid_param"


def test_memory_search_filters_and_labels_privacy(campaign_ws):
    _run(campaign_ws, "memory.write", {
        "memory_id": "mem-hook-cellar",
        "kind": "unresolved_hook",
        "privacy": "keeper_only",
        "summary": "地窖敲击声未解。",
        "entities": ["cellar"],
        "reactivation_cues": ["敲击声"],
        "decision_id": "memsearch-w1",
    })
    _run(campaign_ws, "memory.write", {
        "memory_id": "mem-pref-doors",
        "kind": "player_preference",
        "privacy": "player_safe",
        "summary": "玩家喜欢仔细检查门。",
        "entities": ["cellar"],
        "reactivation_cues": ["门"],
        "decision_id": "memsearch-w2",
    })
    keeper_view = _run(campaign_ws, "memory.search", {
        "entities": ["cellar"],
        "kinds": ["unresolved_hook"],
        "statuses": ["open"],
    })
    assert keeper_view["ok"] is True, keeper_view
    assert keeper_view["data"]["authority"] == "advisory"
    assert keeper_view["data"]["hard_gate"] is False
    rows = keeper_view["data"]["cards"]
    assert [r["memory_id"] for r in rows] == ["mem-hook-cellar"]
    assert rows[0]["privacy"] == "keeper_only"
    assert rows[0]["status"] == "open"
    player_view = _run(campaign_ws, "memory.search", {
        "entities": ["cellar"],
        "view": "player_safe",
    })
    assert player_view["ok"] is True
    assert {r["memory_id"] for r in player_view["data"]["cards"]} == {
        "mem-pref-doors"
    }
    assert all(r["privacy"] == "player_safe" for r in player_view["data"]["cards"])
    bad = _run(campaign_ws, "memory.search", {"kinds": ["rumor"]})
    assert bad["ok"] is False
    assert bad["error"]["code"] == "invalid_param"


def test_memory_resolve_hook_op_idempotent_via_decision_id(campaign_ws):
    _run(campaign_ws, "memory.write", {
        "memory_id": "mem-hook-cellar",
        "kind": "unresolved_hook",
        "privacy": "keeper_only",
        "summary": "地窖敲击声未解。",
        "entities": ["cellar"],
        "decision_id": "memresolve-w1",
    })
    args = {
        "memory_id": "mem-hook-cellar",
        "resolution": "paid_off",
        "resolved_at": "turn-9",
        "reason": "来源揭晓",
        "decision_id": "memresolve-1",
    }
    first = _run(campaign_ws, "memory.resolve_hook", args)
    assert first["ok"] is True, first
    assert first["data"]["status"] == "paid_off"
    assert first["data"]["already_resolved"] is False
    replay = _run(campaign_ws, "memory.resolve_hook", args)
    assert replay["ok"] is True
    assert replay["data"] == first["data"]
    assert any("duplicate decision_id" in w for w in replay["warnings"])
    # Same target status under a fresh decision id is a no-op receipt.
    second = _run(
        campaign_ws, "memory.resolve_hook",
        {**args, "decision_id": "memresolve-2"},
    )
    assert second["ok"] is True
    assert second["data"]["already_resolved"] is True
    closed = _run(campaign_ws, "memory.search", {
        "entities": ["cellar"],
        "kinds": ["unresolved_hook"],
        "statuses": ["open"],
    })
    assert closed["data"]["cards"] == []


# --------------------------------------------------------------------------- #
# Director CALLBACK candidates
# --------------------------------------------------------------------------- #


def _make_minimal_campaign(tmp_path):
    """Minimal director campaign (same shape as test_story_director)."""
    camp = tmp_path / "campaigns" / "test"
    (camp / "save").mkdir(parents=True)
    (camp / "scenario").mkdir(parents=True)
    (camp / "save" / "investigator-state").mkdir()
    (camp / "save" / "investigator-state" / "inv1.json").write_text(json.dumps({
        "schema_version": 1, "campaign_id": "test", "investigator_id": "inv1",
        "current_hp": 12, "current_san": 55, "current_mp": 11,
        "conditions": [], "skill_checks_earned": [],
    }))
    (camp / "save" / "world-state.json").write_text(json.dumps({
        "schema_version": coc_state.CURRENT_SCHEMA_VERSIONS["world"],
        "campaign_id": "test", "scenario_id": "test-mod",
        "status": "active", "active_scene_id": "scene-1", "active_subsystem": "play",
        "current_phase": "middle", "discovered_clue_ids": [], "major_decisions": [],
    }))
    (camp / "save" / "flags.json").write_text(json.dumps(
        coc_flag_state.new_flag_document(campaign_id="test", scenario_id="test-mod")
    ))
    (camp / "save" / "pacing-state.json").write_text(json.dumps({
        "schema_version": 1, "tension_level": "low", "lethal_chances_used": 0,
        "recent_intent_classes": [],
    }))
    (camp / "scenario" / "module-meta.json").write_text(json.dumps({
        "schema_version": 1, "scenario_id": "test-mod",
        "structure_type": "branching_investigation",
        "era": "1920s", "content_flags": [], "win_condition": "test",
    }))
    (camp / "scenario" / "story-graph.json").write_text(json.dumps({"scenes": [
        {"scene_id": "scene-1", "scene_type": "investigation",
         "dramatic_question": "能否找到线索？",
         "entry_conditions": [], "exit_conditions": ["clue-1 discovered"],
         "available_clues": ["clue-1"], "npc_ids": [], "pressure_moves": [],
         "tone": ["tense"], "allowed_improvisation": []},
    ]}))
    (camp / "scenario" / "clue-graph.json").write_text(json.dumps({"conclusions": [
        {"conclusion_id": "concl-1", "importance": "critical", "minimum_routes": 3,
         "clues": [
             {"clue_id": "clue-1", "delivery": "investigate", "visibility": "player-safe"},
             {"clue_id": "clue-1b", "delivery": "social", "visibility": "player-safe"},
             {"clue_id": "clue-1c", "delivery": "spot hidden", "visibility": "player-safe"},
         ], "fallback_policy": "move clue if 2 missed"},
    ]}))
    (camp / "scenario" / "npc-agendas.json").write_text(json.dumps({"npcs": []}))
    (camp / "scenario" / "threat-fronts.json").write_text(json.dumps({"fronts": []}))
    (camp / "scenario" / "pacing-map.json").write_text(json.dumps({"pacing_curve": []}))
    (camp / "scenario" / "improvisation-boundaries.json").write_text(json.dumps({
        "invent_allowed": [], "never_invent": [], "keeper_secrets": [],
    }))
    char_dir = tmp_path / "investigators" / "inv1"
    char_dir.mkdir(parents=True)
    (char_dir / "character.json").write_text(json.dumps({
        "schema_version": 1, "id": "inv1", "occupation": "Antiquarian", "era": "1920s",
        "characteristics": {"STR": 60, "CON": 55, "SIZ": 65, "DEX": 50, "APP": 45,
                            "INT": 70, "POW": 55, "EDU": 75, "LUCK": 55},
        "derived": {"HP": 12, "MP": 11, "SAN": 55, "MOV": 7,
                    "damage_bonus": "0", "build": 0},
        "skills": {"Credit Rating": 50, "Spot Hidden": 60, "Psychology": 55},
        "backstory": {},
    }))
    return camp, char_dir / "character.json"


def test_director_plan_emits_callback_candidates_for_open_hooks(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    _hook_card(
        camp, memory_id="mem-hook-scene1",
        entities=["scene-1-entity"], reactivation_cues=["scene-1"],
    )
    # A closed hook and a non-hook card must never surface as CALLBACK.
    _hook_card(
        camp, memory_id="mem-hook-closed",
        entities=["scene-1-entity"], reactivation_cues=["scene-1"],
    )
    coc_memory.resolve_hook_card(camp, "mem-hook-closed", "resolved")
    coc_memory.create_memory_card(
        campaign_dir=camp, memory_id="mem-plain-fact", privacy="keeper_only",
        salience=0.9, summary="事实", entities=["scene-1-entity"],
        tags=[], reactivation_cues=["scene-1"], kind="fact",
    )
    ctx = coc_story_director.build_director_context(
        camp, char_path, "inv1",
        player_intent="回到大宅", player_intent_class="investigate",
        rng=random.Random(7),
    )
    ctx["memory_query_entities"] = ["scene-1-entity"]
    ctx["memory_query_cues"] = ["scene-1"]
    plan = coc_story_director.generate_director_plan(ctx, "callback-test")
    candidates = plan["callback_candidates"]
    assert [c["memory_id"] for c in candidates] == ["mem-hook-scene1"]
    beat = candidates[0]
    assert beat["beat"] == "CALLBACK"
    assert beat["kind"] == "unresolved_hook"
    assert beat["status"] == "open"
    assert beat["privacy"] == "keeper_only"
    assert beat["overlap_entities"] == ["scene-1-entity"]
    assert "open unresolved_hook" in beat["reason"]
    assert beat["authority"] == "advisory"
    assert beat["hard_gate"] is False


def test_director_callback_absent_when_no_open_hooks(tmp_path):
    camp, char_path = _make_minimal_campaign(tmp_path)
    ctx = coc_story_director.build_director_context(
        camp, char_path, "inv1",
        player_intent="观察四周", player_intent_class="investigate",
        rng=random.Random(7),
    )
    plan = coc_story_director.generate_director_plan(ctx, "callback-empty")
    assert plan["callback_candidates"] == []
