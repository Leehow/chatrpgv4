"""Tests for the live Keeper turn runner.

These cover the production/live path rather than the offline playtest driver:
one player input should run through the director/enrichment/rules/apply stack,
default to fast background recording, and compress low-agency continuation until
the next real interrupt.
"""
import importlib.util
import json
from pathlib import Path


def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, rel)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


live_runner = _load("coc_live_turn_runner", "plugins/coc-keeper/scripts/coc_live_turn_runner.py")


def _build_live_campaign(tmp_path):
    camp = tmp_path / "campaigns" / "live"
    scn = camp / "scenario"
    save = camp / "save"
    logs = camp / "logs"
    (save / "investigator-state").mkdir(parents=True)
    scn.mkdir(parents=True)
    logs.mkdir(parents=True)
    (logs / "events.jsonl").write_text("")
    (logs / "rolls.jsonl").write_text("")
    (save / "world-state.json").write_text(json.dumps({
        "schema_version": 1,
        "campaign_id": "live",
        "scenario_id": "live-mod",
        "active_scene_id": "scene-1",
        "discovered_clue_ids": [],
        "major_decisions": [],
    }))
    (save / "pacing-state.json").write_text(json.dumps({
        "schema_version": 1,
        "tension_level": "low",
        "lethal_chances_used": 0,
        "recent_intent_classes": [],
        "turn_number": 0,
        "luck_spent_last": 0,
    }))
    (save / "investigator-state" / "inv1.json").write_text(json.dumps({
        "schema_version": 1,
        "campaign_id": "live",
        "investigator_id": "inv1",
        "current_hp": 12,
        "current_san": 55,
        "current_mp": 11,
        "conditions": [],
        "skill_checks_earned": [],
    }))
    char_dir = tmp_path / "investigators" / "inv1"
    char_dir.mkdir(parents=True)
    char_path = char_dir / "character.json"
    char_path.write_text(json.dumps({
        "schema_version": 1,
        "id": "inv1",
        "occupation": "Antiquarian",
        "era": "1920s",
        "characteristics": {
            "STR": 60,
            "CON": 55,
            "SIZ": 65,
            "DEX": 50,
            "APP": 45,
            "INT": 70,
            "POW": 55,
            "EDU": 75,
            "LUCK": 55,
        },
        "derived": {"HP": 12, "MP": 11, "SAN": 55, "MOV": 7},
        "skills": {"Spot Hidden": 60, "Library Use": 55, "Credit Rating": 50},
        "backstory": {},
    }))
    (scn / "story-graph.json").write_text(json.dumps({"scenes": [
        {
            "scene_id": "scene-1",
            "scene_type": "investigation",
            "dramatic_question": "Can the investigator find the first lead?",
            "entry_conditions": [],
            "exit_conditions": ["c1 discovered"],
            "available_clues": ["c1"],
            "npc_ids": [],
            "pressure_moves": [],
            "tone": ["tense"],
            "allowed_improvisation": [],
        },
        {
            "scene_id": "scene-2",
            "scene_type": "investigation",
            "dramatic_question": "What happens after the first lead?",
            "entry_conditions": [],
            "exit_conditions": [],
            "available_clues": [],
            "npc_ids": [],
            "pressure_moves": [],
            "tone": ["tense"],
            "allowed_improvisation": [],
        },
    ]}))
    (scn / "clue-graph.json").write_text(json.dumps({"conclusions": [{
        "conclusion_id": "conclusion-1",
        "importance": "critical",
        "minimum_routes": 1,
        "clues": [{"clue_id": "c1", "delivery": "Handout", "delivery_kind": "handout", "visibility": "player-safe"}],
        "fallback_policy": "",
    }]}))
    (scn / "npc-agendas.json").write_text(json.dumps({"npcs": []}))
    (scn / "threat-fronts.json").write_text(json.dumps({"fronts": []}))
    (scn / "pacing-map.json").write_text(json.dumps({"pacing_curve": []}))
    (scn / "improvisation-boundaries.json").write_text(json.dumps({
        "invent_allowed": [],
        "never_invent": [],
        "keeper_secrets": [],
    }))
    (scn / "module-meta.json").write_text(json.dumps({
        "schema_version": 1,
        "scenario_id": "live-mod",
        "structure_type": "linear_acts",
        "era": "1920s",
        "content_flags": [],
        "win_condition": "continue live play",
    }))
    return camp, char_path


def test_live_turn_defaults_to_fast_background_recording_and_receipt(tmp_path, monkeypatch):
    camp, char_path = _build_live_campaign(tmp_path)
    spawned = []

    def fake_spawn_background_flush(campaign_dir, *, limit=None):
        spawned.append({"campaign_dir": Path(campaign_dir), "limit": limit})
        return {"started": True, "pid": 4242}

    monkeypatch.setattr(
        live_runner.coc_async_recorder,
        "spawn_background_flush",
        fake_spawn_background_flush,
    )

    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "我检查桌上的文件。",
        intent_class="investigate",
        rng_seed=7,
    )

    assert result["recording"]["mode"] == "fast"
    assert result["recording"]["flush_policy"] == "background"
    assert result["recording"]["background_flush_started"] is True
    assert spawned
    assert any(turn["apply_path"] == "coc_director_apply.apply_plan" for turn in result["turns"])
    assert sorted((camp / "logs" / "pending-turns").glob("*.json"))

    receipts = [
        json.loads(line)
        for line in (camp / "logs" / "live-turn-runtime.jsonl").read_text().splitlines()
    ]
    assert receipts[-1]["event_type"] == "live_turn_runtime"
    assert receipts[-1]["recording_mode"] == "fast"
    assert receipts[-1]["recording_flush"] == "background"
    assert receipts[-1]["background_flush_requested"] is True


def test_live_turn_foreground_can_return_before_background_flush_finishes(tmp_path, monkeypatch):
    camp, char_path = _build_live_campaign(tmp_path)
    spawned = []

    def fake_spawn_background_flush(campaign_dir, *, limit=None):
        spawned.append({"campaign_dir": Path(campaign_dir), "limit": limit})
        return {"started": True, "pid": 4343}

    monkeypatch.setattr(
        live_runner.coc_async_recorder,
        "spawn_background_flush",
        fake_spawn_background_flush,
    )
    monkeypatch.setattr(
        live_runner.coc_async_recorder,
        "flush_pending_records",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("live turn must not flush synchronously")),
    )

    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "我检查桌上的文件。",
        intent_class="investigate",
        rng_seed=17,
    )

    assert result["foreground"]["narration_can_return_before_flush"] is True
    assert result["foreground"]["waited_for_background_flush"] is False
    assert result["recording"]["background_work"]["status"] == "scheduled"
    assert sorted((camp / "logs" / "pending-turns").glob("*.json"))
    assert spawned

    receipts = [
        json.loads(line)
        for line in (camp / "logs" / "live-turn-runtime.jsonl").read_text().splitlines()
    ]
    assert receipts[-1]["foreground"]["narration_can_return_before_flush"] is True
    assert receipts[-1]["foreground"]["waited_for_background_flush"] is False


def test_live_turn_npc_assist_rule_requests_do_not_interrupt_auto_advance():
    assert live_runner._turn_interrupt_reason({
        "scene_transition": False,
        "event_types": [],
        "rules_requests": [{"kind": "npc_assist", "npc_id": "bruno"}],
        "clue_revealed": [],
        "choice_frame": {},
        "npc_moves": [],
        "narrative_directives": {"dramatic_progress": {"current_interrupts": []}},
    }) is None

    assert live_runner._turn_interrupt_reason({
        "scene_transition": False,
        "event_types": [],
        "rules_requests": [{"kind": "skill_check", "skill": "Spot Hidden"}],
        "clue_revealed": [],
        "choice_frame": {},
        "npc_moves": [],
        "narrative_directives": {"dramatic_progress": {"current_interrupts": []}},
    }) == "risk_requires_roll"


def test_live_turn_low_agency_choice_handles_missing_rich_intent():
    next_choice = live_runner._semantic_low_agency_choice({
        "player_text": "我继续跟着走。",
        "intent_class": "move",
        "player_intent_rich": None,
    })

    assert next_choice["auto_advanced"] is True
    assert next_choice["player_intent_rich"]["primary_intent"] == "move"
    assert "low_agency_continue" in next_choice["player_intent_rich"]["secondary_intents"]


def test_live_turn_state_patch_syncs_minimal_scene_and_defers_detail_log(tmp_path, monkeypatch):
    camp, char_path = _build_live_campaign(tmp_path)
    spawned = []

    def fake_spawn_background_flush(campaign_dir, *, limit=None):
        spawned.append({"campaign_dir": Path(campaign_dir), "limit": limit})
        return {"started": True, "pid": 4444}

    monkeypatch.setattr(
        live_runner.coc_async_recorder,
        "spawn_background_flush",
        fake_spawn_background_flush,
    )
    monkeypatch.setattr(
        live_runner.coc_async_recorder,
        "flush_pending_records",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("state patch detail must not flush synchronously")),
    )

    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "我跟着电话线走。",
        intent_class="move",
        max_auto_advance=1,
        rng_seed=23,
        state_patch={
            "scene_id": "relay-dugout",
            "summary": "队伍抵达第二个电话掩体门口。",
            "scene_type": "investigation",
            "scene_tags": ["wire", "dugout"],
            "visible_affordances": [
                {"cue": "电话线从门缝下方继续伸进去。", "route": "inspect_wire"}
            ],
            "pressure_moves": [
                {"id": "wire-click", "visible_symptom": "掩体里传来短促的咔哒声。"}
            ],
            "npc_ids": ["bruno", "matteo"],
            "details": {
                "draft_summary": "Long-form recap for replay and debugging, not needed before narration.",
            },
        },
    )

    active_scene = json.loads((camp / "save" / "active-scene.json").read_text())
    assert active_scene["scene_id"] == "relay-dugout"
    assert active_scene["summary"] == "队伍抵达第二个电话掩体门口。"
    assert active_scene["visible_affordances"][0]["route"] == "inspect_wire"
    assert active_scene["pressure_moves"][0]["id"] == "wire-click"
    assert result["state_patch"]["applied"] is True
    assert result["state_patch"]["detail_record_deferred"] is True
    assert result["stop_actionability"]["must_surface_handles"] is True
    assert result["stop_actionability"]["immediate_handles"][0]["route_id"] == "inspect_wire"
    assert result["stop_actionability"]["forbidden_menu_rendering"] is True
    assert result["foreground"]["sync_state_writes_completed"] is True
    assert spawned

    pending_payloads = [
        json.loads(path.read_text())
        for path in sorted((camp / "logs" / "pending-turns").glob("*.json"))
    ]
    assert any(
        entry["relative_path"] == "logs/scene-state-patches.jsonl"
        for payload in pending_payloads
        for entry in payload["entries"]
    )


def test_live_turn_auto_advances_low_agency_posture_until_interrupt(tmp_path, monkeypatch):
    camp, char_path = _build_live_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"] = [
        {
            "scene_id": "snow-bridge",
            "scene_type": "travel",
            "scene_kind": "bridge",
            "dramatic_question": "Can the patrol reach the next actionable point?",
            "entry_conditions": [],
            "exit_conditions": [],
            "available_clues": [],
            "npc_ids": [],
            "pressure_moves": [],
            "tone": ["cold"],
            "allowed_improvisation": [],
            "progress_contract": {
                "kind": "bridge",
                "max_low_agency_turns": 1,
                "fallback_action": "MONTAGE",
                "exit_directive": "Montage the march and cut to the next actionable point.",
            },
        },
        {
            "scene_id": "wire-shelter",
            "scene_type": "investigation",
            "dramatic_question": "What is wrong with the wire shelter?",
            "entry_conditions": [],
            "exit_conditions": [],
            "available_clues": [],
            "npc_ids": [],
            "pressure_moves": [{"id": "wire-rattle", "visible_symptom": "掩体里的电话线忽然绷紧。"}],
            "tone": ["tense"],
            "allowed_improvisation": [],
        },
    ]
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "snow-bridge"
    (camp / "save" / "world-state.json").write_text(json.dumps(world))

    monkeypatch.setattr(
        live_runner.coc_async_recorder,
        "spawn_background_flush",
        lambda campaign_dir, *, limit=None: {"started": True, "pid": 4243},
    )

    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "我继续跟着班长走。",
        intent_class="move",
        player_intent_rich={
            "primary_intent": "move",
            "secondary_intents": ["low_agency_continue", "follow_group", "yield_initiative"],
            "target_entities": ["patrol"],
            "risk_posture": "neutral",
            "explicit_roll_request": False,
            "player_hypothesis": None,
            "action_atoms": [],
        },
        max_auto_advance=3,
        rng_seed=11,
    )

    assert result["auto_advance"]["enabled"] is True
    assert result["auto_advance"]["turns_run"] >= 2
    assert result["auto_advance"]["stop_reason"] in {
        "scene_arrival_or_transition",
        "threat_approaches",
        "meaningful_interrupt",
    }
    assert result["final_state"]["active_scene"] == "wire-shelter"
    assert any(turn["auto_advanced"] for turn in result["turns"][1:])


def test_no_interrupt_when_two_routes_but_not_real_fork():
    # Scene has 2 routes but player already committed (is_real_fork=False) -> no stop
    assert live_runner._turn_interrupt_reason({
        "scene_transition": False,
        "event_types": [],
        "rules_requests": [],
        "clue_revealed": [],
        "choice_frame": {"route_count": 2, "is_real_fork": False, "open_route_count": 2},
        "npc_moves": [],
        "narrative_directives": {"dramatic_progress": {"current_interrupts": []}},
    }) is None


def test_interrupt_when_real_fork():
    assert live_runner._turn_interrupt_reason({
        "scene_transition": False,
        "event_types": [],
        "rules_requests": [],
        "clue_revealed": [],
        "choice_frame": {"route_count": 2, "is_real_fork": True, "open_route_count": 2},
        "npc_moves": [],
        "narrative_directives": {"dramatic_progress": {"current_interrupts": []}},
    }) == "meaningful_choice"


def test_no_interrupt_for_npc_assist_move():
    # npc_moves with only npc_assist (non-decisional) -> no stop
    assert live_runner._turn_interrupt_reason({
        "scene_transition": False,
        "event_types": [],
        "rules_requests": [],
        "clue_revealed": [],
        "choice_frame": {"route_count": 0, "is_real_fork": False, "open_route_count": 0},
        "npc_moves": [{"npc_id": "bruno", "kind": "npc_assist"}],
        "narrative_directives": {"dramatic_progress": {"current_interrupts": []}},
    }) is None


def test_interrupt_for_npc_requires_player_decision():
    assert live_runner._turn_interrupt_reason({
        "scene_transition": False,
        "event_types": [],
        "rules_requests": [],
        "clue_revealed": [],
        "choice_frame": {"route_count": 0, "is_real_fork": False, "open_route_count": 0},
        "npc_moves": [{"npc_id": "bruno", "requires_player_decision": True}],
        "narrative_directives": {"dramatic_progress": {"current_interrupts": []}},
    }) == "npc_requests_specialist_judgment"


def test_live_turn_low_agency_stops_at_real_fork(tmp_path, monkeypatch):
    """P0-2d reverse: even low-agency input must stop when the scene is a real
    fork (two open routes), handing the choice to the player. Verifies the
    is_real_fork gate from Task 4 actually stops (not just route_count)."""
    camp, char_path = _build_live_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"] = [
        {
            "scene_id": "crossroads",
            "scene_type": "investigation",
            "dramatic_question": "Which lead does the investigator pursue?",
            "entry_conditions": [],
            "exit_conditions": [],
            "available_clues": [],
            "npc_ids": [],
            "pressure_moves": [],
            "tone": ["tense"],
            "allowed_improvisation": [],
            "affordances": [
                {"id": "ask-tenants", "cue": "可以去问前租客。", "status": "open", "route_priority": 0.5},
                {"id": "check-records", "cue": "可以去查公共记录。", "status": "open", "route_priority": 0.5},
            ],
        },
    ]
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "crossroads"
    (camp / "save" / "world-state.json").write_text(json.dumps(world))

    monkeypatch.setattr(
        live_runner.coc_async_recorder,
        "spawn_background_flush",
        lambda campaign_dir, *, limit=None: {"started": True, "pid": 4244},
    )

    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "继续吧。",
        intent_class="move",
        player_intent_rich={
            "primary_intent": "move",
            "secondary_intents": ["low_agency_continue", "yield_initiative"],
            "target_entities": [],
            "risk_posture": "neutral",
            "explicit_roll_request": False,
            "player_hypothesis": None,
            "action_atoms": [],
        },
        max_auto_advance=3,
        rng_seed=5,
    )

    # Two open affordances -> is_real_fork True -> must stop after the first turn.
    assert result["auto_advance"]["turns_run"] == 1
    assert result["auto_advance"]["stop_reason"] == "meaningful_choice"


# --- P1-2: don't stop on a turn with no actionable content ---


def test_turn_has_actionable_content_true_for_fork_clue_routes_npc():
    """The conservative helper must report actionable content whenever the turn
    carries any structured handle (real fork, clue, routes, npc decision). When
    ambiguous it returns True so the runner does not over-advance."""
    # real fork
    assert live_runner._turn_has_actionable_content({
        "choice_frame": {"is_real_fork": True, "routes": [], "open_route_count": 0},
        "clue_revealed": [],
        "npc_moves": [],
    }) is True
    # non-empty routes (even if not a real fork) — a route is still a handle
    assert live_runner._turn_has_actionable_content({
        "choice_frame": {"is_real_fork": False, "routes": [{"route_id": "x"}], "open_route_count": 1},
        "clue_revealed": [],
        "npc_moves": [],
    }) is True
    # clue revealed
    assert live_runner._turn_has_actionable_content({
        "choice_frame": {"is_real_fork": False, "routes": [], "open_route_count": 0},
        "clue_revealed": ["c1"],
        "npc_moves": [],
    }) is True
    # npc requires player decision
    assert live_runner._turn_has_actionable_content({
        "choice_frame": {"is_real_fork": False, "routes": [], "open_route_count": 0},
        "clue_revealed": [],
        "npc_moves": [{"npc_id": "bruno", "requires_player_decision": True}],
    }) is True


def test_turn_has_actionable_content_false_when_truly_empty():
    """A turn with no fork, no routes, no clue, no npc decision has nothing the
    player can act on — the helper reports False so the runner keeps advancing."""
    assert live_runner._turn_has_actionable_content({
        "choice_frame": {"is_real_fork": False, "routes": [], "open_route_count": 0},
        "clue_revealed": [],
        "npc_moves": [],
    }) is False


def test_turn_has_actionable_content_conservative_on_missing_fields():
    """When structured fields are absent/ambiguous the helper must default to
    True (stop) rather than risk an over-advance into an infinite feeling loop."""
    assert live_runner._turn_has_actionable_content({}) is True
    # choice_frame present but missing routes list — ambiguous, treat as content
    assert live_runner._turn_has_actionable_content({"choice_frame": {}}) is True


def test_live_turn_keeps_advancing_when_no_actionable_content(tmp_path, monkeypatch):
    """P1-2: a turn that surfaces no handle (no real fork, no clue, no routes,
    no npc decision) and is not a low-agency compressed-progress turn must NOT
    stop at awaiting_player_input — the runner should keep advancing (up to the
    max_turns cap) so the director gets another chance to surface a handle."""
    camp, char_path = _build_live_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"] = [
        {
            "scene_id": "empty-hall",
            "scene_type": "investigation",
            "dramatic_question": "What is in the empty hall?",
            "entry_conditions": [],
            "exit_conditions": [],
            "available_clues": [],
            "npc_ids": [],
            "pressure_moves": [],
            "tone": ["quiet"],
            "allowed_improvisation": [],
        },
    ]
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "empty-hall"
    (camp / "save" / "world-state.json").write_text(json.dumps(world))

    monkeypatch.setattr(
        live_runner.coc_async_recorder,
        "spawn_background_flush",
        lambda campaign_dir, *, limit=None: {"started": True, "pid": 4255},
    )

    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "我仔细搜寻这个房间。",
        intent_class="investigate",
        # A concrete (non-low-agency) investigative posture: the director will
        # NOT emit a compressed_progress directive, so _should_auto_advance is
        # False. Combined with an empty scene this is exactly the P1-2 trap.
        player_intent_rich={
            "primary_intent": "investigate",
            "secondary_intents": ["search"],
            "action_atoms": [{"topic": "room", "verb": "search"}],
        },
        max_auto_advance=3,
        rng_seed=5,
    )

    # Before the fix this stopped at turn 1 with "awaiting_player_input" leaving
    # the player with nothing to act on. Now it must keep going.
    assert result["auto_advance"]["turns_run"] >= 2
    # It must NOT have given up with awaiting_player_input on an empty turn.
    assert result["auto_advance"]["stop_reason"] != "awaiting_player_input"
    # Continuation turns are marked as auto-advanced low-agency beats.
    assert any(turn["auto_advanced"] for turn in result["turns"][1:])
    # The max_turns cap still holds (no runaway).
    assert result["auto_advance"]["turns_run"] <= result["auto_advance"]["max_turns"]


def test_live_turn_stops_on_single_route_content_does_not_over_advance(tmp_path, monkeypatch):
    """P1-2 reverse: a turn that DOES surface a handle (one open affordance ->
    choice_frame.routes has 1 entry, is_real_fork=False, no clue, no npc
    decision) reached via a non-low-agency intent must STOP at turn 1 with
    awaiting_player_input. The over-advance guard in the empty-handle branch
    must NOT fire here, because ``_turn_has_actionable_content`` returns True.

    This is the critical coverage gap left by the keep-advancing test: that
    test proves an empty turn keeps going; this one proves a turn WITH content
    (a single route) does not get over-advanced past the player."""
    camp, char_path = _build_live_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"] = [
        {
            "scene_id": "single-door",
            "scene_type": "investigation",
            "dramatic_question": "What is behind the single door?",
            "entry_conditions": [],
            "exit_conditions": [],
            "available_clues": [],
            "npc_ids": [],
            "pressure_moves": [],
            "tone": ["tense"],
            "allowed_improvisation": [],
            # A single open affordance: routes non-empty (content True) but
            # is_real_fork=False (open_route_count=1, < 2) and no clue/npc to
            # trigger _turn_interrupt_reason. This is the exact frame shape
            # that lands in the P1-2 empty-handle branch.
            "affordances": [
                {"id": "open-door", "cue": "门虚掩着。", "status": "open", "route_priority": 0.5},
            ],
        },
    ]
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "single-door"
    (camp / "save" / "world-state.json").write_text(json.dumps(world))

    monkeypatch.setattr(
        live_runner.coc_async_recorder,
        "spawn_background_flush",
        lambda campaign_dir, *, limit=None: {"started": True, "pid": 4266},
    )

    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "我搜查这个地方。",
        intent_class="investigate",
        # A concrete (non-low-agency) investigative posture: the director does
        # NOT emit a compressed_progress directive, so _should_auto_advance is
        # False and the run reaches the P1-2 branch. Unlike the empty-hall case,
        # this turn carries a single route -> helper True -> stop normally.
        player_intent_rich={
            "primary_intent": "investigate",
            "secondary_intents": ["search"],
            "action_atoms": [{"topic": "room", "verb": "search"}],
        },
        max_auto_advance=3,
        rng_seed=5,
    )

    # The turn had a single route (content present), so the helper returned
    # True and the loop must stop at turn 1 rather than over-advancing.
    first_turn = result["turns"][0]
    choice_frame = first_turn["choice_frame"]
    assert len(choice_frame["routes"]) == 1
    assert choice_frame["is_real_fork"] is False
    assert live_runner._turn_has_actionable_content(first_turn) is True
    # No other handle should have surfaced to stop via a different reason.
    assert not first_turn["clue_revealed"]
    assert not any(
        (move.get("requires_player_decision") if isinstance(move, dict) else False)
        for move in first_turn["npc_moves"]
    )

    assert len(result["turns"]) == 1
    assert result["auto_advance"]["turns_run"] == 1
    assert result["auto_advance"]["stop_reason"] == "awaiting_player_input"


def test_live_resume_affordance_does_not_create_false_real_fork(tmp_path, monkeypatch):
    """A synthetic live resume affordance keeps narration actionable, but must
    not turn one real visible route into a meaningful player fork."""
    camp, char_path = _build_live_campaign(tmp_path)
    story = json.loads((camp / "scenario" / "story-graph.json").read_text())
    story["scenes"] = [
        {
            "scene_id": "relay-dugout",
            "scene_type": "investigation",
            "dramatic_question": "How does the patrol proceed?",
            "entry_conditions": [],
            "exit_conditions": [],
            "available_clues": [],
            "npc_ids": [],
            "pressure_moves": [],
            "tone": ["tense"],
            "allowed_improvisation": [],
        },
    ]
    (camp / "scenario" / "story-graph.json").write_text(json.dumps(story))
    world = json.loads((camp / "save" / "world-state.json").read_text())
    world["active_scene_id"] = "relay-dugout"
    (camp / "save" / "world-state.json").write_text(json.dumps(world))
    (camp / "save" / "active-scene.json").write_text(json.dumps({
        "schema_version": 1,
        "scene_id": "relay-dugout",
        "summary": "队伍抵达第二个电话掩体门口。",
        "visible_affordances": [
            {"cue": "电话线从门缝下方继续伸进去。", "route": "inspect_wire"},
        ],
    }, ensure_ascii=False))

    monkeypatch.setattr(
        live_runner.coc_async_recorder,
        "spawn_background_flush",
        lambda campaign_dir, *, limit=None: {"started": True, "pid": 4277},
    )

    result = live_runner.run_live_turn(
        camp,
        char_path,
        "inv1",
        "我继续跟着班长走。",
        intent_class="move",
        player_intent_rich={
            "primary_intent": "move",
            "secondary_intents": ["low_agency_continue", "follow_group", "yield_initiative"],
            "target_entities": ["patrol"],
            "risk_posture": "neutral",
            "explicit_roll_request": False,
            "player_hypothesis": None,
            "action_atoms": [],
        },
        max_auto_advance=3,
        recording_mode="sync",
        rng_seed=11,
    )

    choice_frame = result["turns"][0]["choice_frame"]
    assert "inspect_wire" in choice_frame["open_route_ids"]
    assert "live-scene-thread" not in choice_frame["open_route_ids"]
    assert choice_frame["is_real_fork"] is False
    assert result["auto_advance"]["stop_reason"] != "meaningful_choice"


# ---------------------------------------------------------------------------
# Semantic intent resolution (Semantic Matcher Constitution)
# ---------------------------------------------------------------------------

class _FixtureIntentEvaluator:
    evaluator_id = "codex-llm-semantic-v1"

    def __init__(self, primary_intent="social"):
        self.calls = []
        self._primary = primary_intent

    def classify(self, player_text, active_scene):
        self.calls.append((player_text, active_scene))
        return {
            "primary_intent": self._primary,
            "secondary_intents": [],
            "target_entities": [],
            "risk_posture": "neutral",
            "explicit_roll_request": False,
            "player_hypothesis": None,
            "action_atoms": [],
        }


def test_live_turn_caller_intent_is_recorded(tmp_path):
    camp, char_path = _build_live_campaign(tmp_path)
    result = live_runner.run_live_turn(
        camp, char_path, "inv1", "我检查桌上的文件。",
        intent_class="investigate", recording_mode="sync", rng_seed=3,
    )
    assert result["intent_resolution"]["source"] == "caller_intent_class"
    assert result["intent_resolution"]["intent_class"] == "investigate"


def test_live_turn_missing_intent_routes_through_intent_router(tmp_path):
    """Without caller intent, the runner consults coc_intent_router (installed
    evaluator), never a hardcoded intent default."""
    camp, char_path = _build_live_campaign(tmp_path)
    fixture = _FixtureIntentEvaluator(primary_intent="social")
    live_runner.coc_intent_router.set_intent_evaluator(fixture)
    try:
        result = live_runner.run_live_turn(
            camp, char_path, "inv1", "我去问问邻居昨晚听到了什么。",
            recording_mode="sync", rng_seed=5,
        )
    finally:
        live_runner.coc_intent_router.set_intent_evaluator(None)

    assert fixture.calls, "semantic evaluator must be consulted"
    assert result["intent_resolution"]["source"] == "intent_router"
    assert result["intent_resolution"]["intent_class"] == "social"
    receipts = [
        json.loads(line)
        for line in (camp / "logs" / "live-turn-runtime.jsonl").read_text().splitlines()
    ]
    assert receipts[-1]["intent_resolution"]["source"] == "intent_router"


def test_live_turn_no_semantic_evidence_degrades_to_ambiguous_not_investigate(tmp_path):
    """With no caller intent and no evaluator result artifact, the intent
    degrades to 'ambiguous' (honest unknown) and the degradation is recorded.
    It must never silently default to 'investigate'."""
    camp, char_path = _build_live_campaign(tmp_path)
    live_runner.coc_intent_router.set_intent_evaluator(None)

    result = live_runner.run_live_turn(
        camp, char_path, "inv1", "我检查桌上的文件。",
        recording_mode="sync", rng_seed=9,
    )

    assert result["intent_resolution"]["source"] == "unresolved_default_ambiguous"
    assert result["intent_resolution"]["intent_class"] == "ambiguous"
    assert result["turns"], "turn should still run with the honest-unknown intent"
    # the file-mediated evaluator request lands under the campaign's logs
    assert (camp / "logs" / "intent-eval" / "intent-eval-request.json").exists()
