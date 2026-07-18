#!/usr/bin/env python3
"""COC Story Director — deterministic planner.

Each turn, reads rule state + scenario story-graph + player intent, produces
a DirectorPlan JSON guiding coc-keeper-play's narrative direction. Read-only
with respect to rule state; never modifies save/combat/sanity.

Historical spec retired; see tombstone index docs/status/DIAGNOSIS-LEDGER.md
"""
from __future__ import annotations

import json
import random
import re
from copy import deepcopy
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent


def _load_sibling(name: str, filename: str):
    import importlib.util
    import sys
    existing = sys.modules.get(name)
    if existing is not None and getattr(existing, "__file__", None):
        return existing
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

coc_cache = _load_sibling("coc_cache", "coc_cache.py")
coc_rule_signals = _load_sibling("coc_rule_signals", "coc_rule_signals.py")
coc_mythos = _load_sibling("coc_mythos", "coc_mythos.py")
coc_narration_style = _load_sibling("coc_narration_style", "coc_narration_style.py")
coc_narration_contract = _load_sibling("coc_narration_contract", "coc_narration_contract.py")
coc_npc_persona = _load_sibling("coc_npc_persona", "coc_npc_persona.py")
coc_npc_state = _load_sibling("coc_npc_state", "coc_npc_state.py")
coc_exit_conditions = _load_sibling("coc_exit_conditions", "coc_exit_conditions.py")
coc_scene_graph = _load_sibling("coc_scene_graph", "coc_scene_graph.py")
coc_threat_state = _load_sibling("coc_threat_state", "coc_threat_state.py")
coc_scenario_compile = _load_sibling("coc_scenario_compile", "coc_scenario_compile.py")
coc_investigator_guard = _load_sibling(
    "coc_investigator_guard_story_director", "coc_investigator_guard.py"
)
coc_director_strategies = _load_sibling("coc_director_strategies", "coc_director_strategies.py")
coc_epistemic_policy = _load_sibling("coc_epistemic_policy", "coc_epistemic_policy.py")
coc_belief_state = _load_sibling("coc_belief_state", "coc_belief_state.py")
coc_rules = _load_sibling("coc_story_director_rules", "coc_rules.py")
coc_keeper_planner = _load_sibling("coc_keeper_planner", "coc_keeper_planner.py")
coc_inventory = _load_sibling("coc_inventory", "coc_inventory.py")

coc_time = None
try:
    coc_time = _load_sibling("coc_time", "coc_time.py")
except Exception:
    coc_time = None  # time layer optional; director degrades gracefully

coc_memory = None
try:
    coc_memory = _load_sibling("coc_memory", "coc_memory.py")
except Exception:
    coc_memory = None  # memory layer optional; director degrades gracefully

_NON_PLAYER_ROLL_ROLES = {"npc", "enemy", "opponent", "adversary", "monster"}
_SCENE_PROGRESS_KEYS = (
    "scene_kind",
    "scene_tags",
    "time_profile",
    "authority_demands",
    "responsibility_threats",
    "progress_contract",
    "source_event_type",
    "location_tags",
    "module_id",
    "era",
)
_BRIDGE_SCENE_KINDS = {"bridge", "transition", "travel", "transit"}
ROLL_REQUEST_KINDS = {
    "skill_check",
    "characteristic_check",
    "sanity_check",
    "opposed_check",
    "idea_roll",
}

# Rulebook Idea Roll signpost ladder (Keeper Rulebook ~p.199):
# never mentioned → free delivery; mentioned → Regular; obvious but missed → Extreme.
_IDEA_SIGNPOST_FREE = "unmentioned"
_IDEA_SIGNPOST_REGULAR = "mentioned"
_IDEA_SIGNPOST_EXTREME = "obvious"
_IDEA_SIGNPOST_ALIASES = {
    "unmentioned": _IDEA_SIGNPOST_FREE,
    "never": _IDEA_SIGNPOST_FREE,
    "none": _IDEA_SIGNPOST_FREE,
    "mentioned": _IDEA_SIGNPOST_REGULAR,
    "signposted": _IDEA_SIGNPOST_REGULAR,
    "regular": _IDEA_SIGNPOST_REGULAR,
    "obvious": _IDEA_SIGNPOST_EXTREME,
    "obvious_missed": _IDEA_SIGNPOST_EXTREME,
    "extreme": _IDEA_SIGNPOST_EXTREME,
}


def _roll_contract(
    *,
    goal: str,
    success_effect: str,
    failure_effect: str,
    failure_outcome_mode: str,
    roll_density_group: str,
    push_eligible: bool = True,
    must_not: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "goal": goal,
        "success_effect": success_effect,
        "failure_effect": failure_effect,
        "failure_outcome_mode": failure_outcome_mode,
        "push_policy": {
            "eligible": bool(push_eligible),
            "requires_changed_method": bool(push_eligible),
            "keeper_must_foreshadow_failure": bool(push_eligible),
        },
        "roll_density_group": roll_density_group,
        "must_not": list(must_not or ["do not narrate no progress on ordinary failure"]),
    }


def _generated_clue_fumble_consequence(
    clue_policy: dict[str, Any], clue_id: str
) -> dict[str, Any]:
    """Return a bounded, source-owned cost for a generated clue-gate fumble."""
    route_ids = [
        str(route_id).strip()
        for route_id in (clue_policy.get("matched_route_ids") or [])
        if isinstance(route_id, str) and route_id.strip()
    ]
    source_binding: dict[str, Any] = {
        "schema_version": 1,
        "kind": "generated_obscured_clue_gate",
        "clue_id": str(clue_id),
        "route_ids": list(dict.fromkeys(route_ids)),
    }
    if len(source_binding["route_ids"]) == 1:
        route_id = source_binding["route_ids"][0]
        effect = {"kind": "route_closed", "route_id": route_id}
        summary = (
            "The fumble exhausts this investigative method and closes the "
            "current route before the clue is secured."
        )
        localized = "大失败耗尽了这种调查手段；取得线索前，当前路线已经关闭。"
    else:
        effect = {"kind": "fictional_position", "severity": "serious"}
        summary = (
            "The fumble immediately creates a serious adverse fictional "
            "position and exhausts this investigative method."
        )
        localized = "大失败立刻造成严重不利局面，而且这种调查手段已经耗尽。"
    return {
        "summary": summary,
        "localized_summaries": {"zh-Hans": localized},
        "effect": effect,
        "source_binding": source_binding,
    }


def _generated_clue_push_consequence(
    clue_policy: dict[str, Any], clue_id: str
) -> dict[str, Any]:
    """Seal the bounded Push risk beside the original generated clue roll."""
    fumble = _generated_clue_fumble_consequence(clue_policy, clue_id)
    effect = json.loads(json.dumps(fumble["effect"]))
    if effect.get("kind") == "route_closed":
        return {
            "summary": (
                "Another failed pushed attempt exhausts this method and closes "
                "the current investigative route before the clue is secured."
            ),
            "localized_summaries": {
                "zh-Hans": (
                    "若孤注一掷后仍然失败，这种查法将彻底失去机会；"
                    "当前调查路线会在取得线索前关闭。"
                ),
            },
            "effect": effect,
        }
    return {
        "summary": (
            "Another failed pushed attempt leaves a serious adverse fictional "
            "position and exhausts this method."
        ),
        "localized_summaries": {
            "zh-Hans": "若孤注一掷后仍然失败，局面会严重恶化，而且这种做法将无法再试。",
        },
        "effect": effect,
    }


def _read_json(path: Path, fallback: Any = None) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def _roll_payload_is_player_side(payload: dict[str, Any]) -> bool:
    role = str(payload.get("actor_role") or payload.get("source_role") or "").strip().lower()
    if role in _NON_PLAYER_ROLL_ROLES:
        return False
    return True


_LAST_ROLL_DECISION_RE = re.compile(r"turn-(\d+)", re.IGNORECASE)


def _parse_decision_turn(value: Any) -> int | None:
    """Extract the integer turn number from a ``turn-NNN`` decision id."""
    if not isinstance(value, str):
        return None
    match = _LAST_ROLL_DECISION_RE.search(value)
    if match is None:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def _read_last_roll_outcome(campaign_dir: Path) -> str | None:
    """Read the last player-side roll outcome, turn-aware.

    A fumble/critical is meant to drive the *immediately following* turn
    (``apply_rule_signal_overrides`` forces PRESSURE on a fumble). The signal
    must not stick: once the next turn has resolved, the outcome is stale.

    We therefore return the last player-side roll's outcome only when that roll
    belongs to the current or previous decision (``turn-NNN``). Specifically,
    with the roll's turn ``R`` and the current ``pacing-state.turn_number`` ``C``,
    the outcome is returned while ``C - R <= 1`` and ``C - R >= 0``; once a
    second turn passes (``C - R >= 2``) the signal clears.

    Backward compatibility: if the roll has no parseable ``decision_id`` *or*
    ``pacing-state`` has no ``turn_number`` (older fixtures / partial state),
    we fall back to the legacy "last roll wins" behavior so the fumble/critical
    semantics still work in single-turn tests that don't attribute turns.
    """
    rolls_path = campaign_dir / "logs" / "rolls.jsonl"
    if not rolls_path.exists():
        return None
    pacing = _read_json(campaign_dir / "save" / "pacing-state.json", {})
    current_turn = pacing.get("turn_number") if isinstance(pacing, dict) else None
    current_turn = current_turn if isinstance(current_turn, int) else None
    for line in reversed(rolls_path.read_text(encoding="utf-8").splitlines()):
        if line.strip():
            try:
                record = json.loads(line)
                payload = record.get("payload", {})
            except (json.JSONDecodeError, AttributeError):
                continue
            if isinstance(payload, dict) and _roll_payload_is_player_side(payload):
                outcome = payload.get("outcome")
                roll_turn = _parse_decision_turn(payload.get("decision_id"))
                # No turn attribution on the roll or on pacing-state: legacy
                # "last roll wins" behavior (keeps existing single-turn tests).
                if roll_turn is None or current_turn is None:
                    return outcome
                # Turn-aware staleness: only the current or immediately prior
                # turn's outcome can still drive this turn's rule signals.
                delta = current_turn - roll_turn
                if 0 <= delta <= 1:
                    return outcome
                return None
    return None


def _text_or_none(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _short_text(value: Any, limit: int = 96) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "..."


def _choice_affordance(choice: Any, index: int) -> dict[str, Any] | None:
    if isinstance(choice, dict):
        cue = _text_or_none(
            choice.get("cue")
            or choice.get("label")
            or choice.get("text")
            or choice.get("summary")
            or choice.get("action")
        )
        if not cue:
            return None
        route_id = _text_or_none(choice.get("id") or choice.get("route_id")) or f"live-choice-{index}"
        return {
            "id": route_id,
            "route_type": choice.get("route_type", "live_resume_affordance"),
            "cue": _short_text(cue, 80),
            "promise": choice.get("promise") or choice.get("visible_benefit"),
            "cost": choice.get("cost") or choice.get("visible_cost"),
            "risk": choice.get("risk") or choice.get("visible_risk"),
            "status": choice.get("status", "open"),
            "fork_eligible": choice.get("fork_eligible", True),
            "source": "save.active-scene.pending_choices",
        }
    cue = _text_or_none(choice)
    if not cue:
        return None
    return {
        "id": f"live-choice-{index}",
        "route_type": "live_resume_affordance",
        "cue": _short_text(cue, 80),
        "promise": "推进当前场景",
        "source": "save.active-scene.pending_choices",
    }


def _visible_affordance(affordance: Any, index: int) -> dict[str, Any] | None:
    if isinstance(affordance, dict):
        cue = _text_or_none(
            affordance.get("cue")
            or affordance.get("player_visible_cue")
            or affordance.get("summary")
            or affordance.get("text")
            or affordance.get("action")
        )
        if not cue:
            return None
        route_id = _text_or_none(
            affordance.get("id") or affordance.get("route_id") or affordance.get("route")
        ) or f"live-visible-{index}"
        return {
            "id": route_id,
            "route_type": affordance.get("route_type", "live_visible_affordance"),
            "cue": _short_text(cue, 80),
            "promise": affordance.get("promise") or affordance.get("visible_benefit"),
            "cost": affordance.get("cost") or affordance.get("visible_cost"),
            "risk": affordance.get("risk") or affordance.get("visible_risk"),
            "status": affordance.get("status", "open"),
            "fork_eligible": affordance.get("fork_eligible", True),
            "source": "save.active-scene.visible_affordances",
        }
    cue = _text_or_none(affordance)
    if not cue:
        return None
    return {
        "id": f"live-visible-{index}",
        "route_type": "live_visible_affordance",
        "cue": _short_text(cue, 80),
        "promise": "推进当前场景",
        "source": "save.active-scene.visible_affordances",
    }


def _live_scene_affordances(active_scene_state: dict[str, Any], scenario_doc: dict[str, Any]) -> list[dict[str, Any]]:
    affordances: list[dict[str, Any]] = []
    pending = active_scene_state.get("pending_choices")
    if isinstance(pending, list):
        for index, choice in enumerate(pending, start=1):
            route = _choice_affordance(choice, index)
            if route is not None:
                affordances.append(route)
            if len(affordances) >= 3:
                break

    visible = active_scene_state.get("visible_affordances")
    if isinstance(visible, list):
        for index, affordance in enumerate(visible, start=1):
            route = _visible_affordance(affordance, index)
            if route is not None:
                affordances.append(route)
            if len(affordances) >= 3:
                break

    if len(affordances) < 2:
        summary = (
            active_scene_state.get("summary")
            or scenario_doc.get("opening_scene")
            or scenario_doc.get("player_safe_summary")
            or scenario_doc.get("summary")
            or scenario_doc.get("current_phase")
            or "当前场景"
        )
        affordances.append({
            "id": "live-scene-thread",
            "route_type": "live_resume_affordance",
            "cue": "当前场景的核心问题仍未解决。",
            "promise": "沿着当前场景继续推进",
            "visible_benefit": _short_text(summary, 80),
            "status": "resume",
            "fork_eligible": False,
            "source": "save.active-scene.summary",
        })
    if len(affordances) < 2:
        affordances.append({
            "id": "live-investigator-angle",
            "route_type": "live_resume_affordance",
            "cue": "调查员仍可从随身记录、装备、现场人物或既有判断重新切入。",
            "promise": "换一个角度寻找行动入口",
            "risk": "拖延会让局势继续变化",
            "status": "resume",
            "fork_eligible": False,
            "source": "live-story-bridge.default",
        })

    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for affordance in affordances:
        cue = str(affordance.get("cue", ""))
        if cue in seen:
            continue
        seen.add(cue)
        deduped.append(affordance)
    return deduped[:3]


def _merge_live_active_scene(
    compiled_scene: dict[str, Any],
    active_scene_state: dict[str, Any],
    scenario_doc: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    """Overlay live save affordances onto the compiled scene without changing plot data."""
    warnings: list[dict[str, str]] = []
    merged = dict(compiled_scene)
    if "time_profile" in merged:
        profile, reason_code = _validate_time_profile(merged.get("time_profile"))
        if profile is None:
            merged.pop("time_profile", None)
            if reason_code is not None:
                warnings.append({
                    "field": "time_profile",
                    "source": "compiled_scene",
                    "reason_code": reason_code,
                })
        else:
            merged["time_profile"] = profile
    if not active_scene_state:
        return merged, warnings
    if active_scene_state.get("summary"):
        merged["live_summary"] = active_scene_state.get("summary")

    live_affordances = _live_scene_affordances(active_scene_state, scenario_doc)
    existing = [
        affordance for affordance in (merged.get("affordances") or [])
        if isinstance(affordance, dict)
    ]
    combined: list[dict[str, Any]] = []
    seen: set[str] = set()
    for affordance in existing + live_affordances:
        key = str(affordance.get("id") or affordance.get("route_id") or affordance.get("cue") or "")
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        combined.append(affordance)
    if combined:
        merged["affordances"] = combined[:6]

    for key in ("npc_ids", "pressure_moves"):
        live_value = active_scene_state.get(key)
        if not isinstance(live_value, list) or not live_value:
            continue
        current = list(merged.get(key) or [])
        for item in live_value:
            if item not in current:
                current.append(item)
        merged[key] = current

    for key in _SCENE_PROGRESS_KEYS:
        if key == "time_profile":
            continue
        live_value = active_scene_state.get(key)
        if live_value not in (None, [], {}):
            merged[key] = live_value

    compiled_scene_id = _text_or_none(compiled_scene.get("scene_id"))
    live_scene_id = _text_or_none(active_scene_state.get("scene_id"))
    same_scene = not compiled_scene_id or not live_scene_id or compiled_scene_id == live_scene_id
    if same_scene and "time_profile" in active_scene_state:
        profile, reason_code = _validate_time_profile(active_scene_state.get("time_profile"))
        if profile is not None:
            merged["time_profile"] = profile
        elif reason_code is not None:
            warnings.append({
                "field": "time_profile",
                "source": "runtime_active_scene",
                "reason_code": reason_code,
            })

    merged["source"] = "live-story-bridge.merged-active-scene"
    return merged, warnings


def _runtime_scene_from_live_state(
    active_scene_state: dict[str, Any],
    world: dict[str, Any],
    scenario_doc: dict[str, Any],
) -> tuple[dict[str, Any] | None, list[dict[str, str]]]:
    scene_id = _text_or_none(active_scene_state.get("scene_id")) or _text_or_none(world.get("active_scene_id"))
    if not scene_id:
        scene_id = _text_or_none(scenario_doc.get("current_phase")) or "live-current-scene"
    summary = (
        active_scene_state.get("summary")
        or scenario_doc.get("opening_scene")
        or scenario_doc.get("player_safe_summary")
        or scenario_doc.get("summary")
        or scene_id
    )
    runtime_scene = {
        "scene_id": scene_id,
        "scene_type": active_scene_state.get("scene_type", "investigation"),
        "dramatic_question": (
            active_scene_state.get("dramatic_question")
            or f"调查员如何推进当前场景：{_short_text(summary)}"
        ),
        "entry_conditions": active_scene_state.get("entry_conditions", []),
        "exit_conditions": active_scene_state.get("exit_conditions", []),
        "available_clues": active_scene_state.get("available_clues", []),
        "npc_ids": active_scene_state.get("npc_ids", []),
        "pressure_moves": active_scene_state.get("pressure_moves", []),
        "tone": active_scene_state.get("tone", ["tense"]),
        "allowed_improvisation": active_scene_state.get("allowed_improvisation", []),
        "affordances": _live_scene_affordances(active_scene_state, scenario_doc),
        "excluded_storylet_tropes": active_scene_state.get("excluded_storylet_tropes", ["animal_instinct"]),
        **{
            key: active_scene_state[key]
            for key in _SCENE_PROGRESS_KEYS
            if key != "time_profile"
            if active_scene_state.get(key) not in (None, [], {})
        },
        "source": "live-story-bridge.active-scene",
    }
    warnings: list[dict[str, str]] = []
    if "time_profile" in active_scene_state:
        profile, reason_code = _validate_time_profile(active_scene_state.get("time_profile"))
        if profile is not None:
            runtime_scene["time_profile"] = profile
        elif reason_code is not None:
            warnings.append({
                "field": "time_profile",
                "source": "runtime_active_scene",
                "reason_code": reason_code,
            })
    return runtime_scene, warnings


def _story_graph_with_live_fallback(
    story_graph: dict[str, Any],
    active_scene_state: dict[str, Any],
    world: dict[str, Any],
    scenario_doc: dict[str, Any],
) -> tuple[
    dict[str, Any],
    str | None,
    dict[str, Any] | None,
    list[dict[str, str]],
]:
    story_graph = dict(story_graph or {"scenes": []})
    scenes = [s for s in story_graph.get("scenes", []) if isinstance(s, dict)]
    world_scene_id = _text_or_none(world.get("active_scene_id"))
    if world_scene_id:
        active_scene = next((s for s in scenes if s.get("scene_id") == world_scene_id), None)
        if active_scene is not None:
            active_scene, warnings = _merge_live_active_scene(
                active_scene, active_scene_state, scenario_doc
            )
            scenes = [active_scene if s.get("scene_id") == world_scene_id else s for s in scenes]
            story_graph["scenes"] = scenes
            return story_graph, world_scene_id, active_scene, warnings

    live_scene_id = _text_or_none(active_scene_state.get("scene_id"))
    if live_scene_id:
        active_scene = next((s for s in scenes if s.get("scene_id") == live_scene_id), None)
        if active_scene is not None:
            active_scene, warnings = _merge_live_active_scene(
                active_scene, active_scene_state, scenario_doc
            )
            scenes = [active_scene if s.get("scene_id") == live_scene_id else s for s in scenes]
            story_graph["scenes"] = scenes
            return story_graph, live_scene_id, active_scene, warnings

    runtime_scene, warnings = _runtime_scene_from_live_state(
        active_scene_state, world, scenario_doc
    )
    if runtime_scene is None:
        story_graph["scenes"] = scenes
        return story_graph, world_scene_id, None, warnings

    runtime_id = runtime_scene.get("scene_id")
    scenes = [s for s in scenes if s.get("scene_id") != runtime_id]
    scenes.insert(0, runtime_scene)
    story_graph["schema_version"] = story_graph.get("schema_version", 1)
    story_graph["source"] = story_graph.get("source", "live-story-bridge")
    story_graph["scenes"] = scenes
    return story_graph, str(runtime_id), runtime_scene, warnings


def build_director_context(
    campaign_dir: Path,
    character_path: Path,
    investigator_id: str,
    player_intent: str,
    player_intent_class: str,
    rng: random.Random | None = None,
    player_intent_rich: dict[str, Any] | None = None,
    character_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Assemble DirectorContext: rule signals + active scene + scenario graph.

    Read-only. Pulls investigator-state, character, world-state, flags,
    pacing-state, and the 7 scenario story-graph files.

    ``player_intent_rich`` is an optional enrichment dict (the 6-field
    structure from coc_intent_router.parse_intent: primary_intent,
    secondary_intents, target_entities, risk_posture,
    explicit_roll_request, player_hypothesis). When provided, it augments
    scoring (see ``_base_score``) and memory retrieval; when None, behavior
    is identical to the legacy single-class path.
    """
    rng = rng or random.Random()
    save = campaign_dir / "save"
    # When a rich intent is supplied, derive the legacy single class from it
    # so _base_score's existing branches and turn_input stay consistent.
    if player_intent_rich and "primary_intent" in player_intent_rich:
        player_intent_class = player_intent_rich["primary_intent"]
    scenario = campaign_dir / "scenario"

    inv_state = _read_json(save / "investigator-state" / f"{investigator_id}.json", {})
    character = (
        json.loads(json.dumps(character_snapshot, ensure_ascii=False))
        if isinstance(character_snapshot, dict)
        else coc_investigator_guard.read_reusable_character(
            coc_investigator_guard.coc_root_for_campaign(campaign_dir),
            investigator_id,
            character_path,
        )
    )
    world = _read_json(save / "world-state.json", {})
    pacing = _read_json(save / "pacing-state.json", {})
    combat_state = _read_json(save / "combat.json", {})
    _last_outcome = _read_last_roll_outcome(campaign_dir)
    module_meta = _read_json(scenario / "module-meta.json", {})
    scenario_doc = _read_json(scenario / "scenario.json", {})
    active_scene_state = _read_json(save / "active-scene.json", {})
    story_graph, active_scene_id, active_scene, validation_warnings = (
        _story_graph_with_live_fallback(
            _read_json(scenario / "story-graph.json", {"scenes": []}),
            active_scene_state if isinstance(active_scene_state, dict) else {},
            world if isinstance(world, dict) else {},
            scenario_doc if isinstance(scenario_doc, dict) else {},
        )
    )
    scene_contract_findings = [
        *coc_scenario_compile._check_scene_function_contract({
            "story_graph": story_graph,
        }),
        *coc_scenario_compile._check_scene_affinity_contract({
            "story_graph": story_graph,
        }),
    ]
    if scene_contract_findings:
        raise ValueError(scene_contract_findings[0]["message"])
    if active_scene_id:
        world = dict(world)
        world["active_scene_id"] = active_scene_id
    active_scene_function = coc_scenario_compile.normalize_scene_function(active_scene or {})
    if active_scene is not None:
        active_scene = dict(active_scene)
        active_scene.update(active_scene_function)
        story_graph = dict(story_graph)
        story_graph["scenes"] = [
            active_scene if isinstance(item, dict) and item.get("scene_id") == active_scene_id
            else item
            for item in story_graph.get("scenes", [])
        ]

    # --- rule signals ---
    char_derived = character.get("derived", {})
    char_chars = character.get("characteristics", {})
    char_skills = character.get("skills", {})
    conditions = inv_state.get("conditions", []) or []
    current_hp = inv_state.get("current_hp", char_derived.get("HP", 10))
    max_hp = char_derived.get("HP", 10)
    current_san = inv_state.get("current_san", char_derived.get("SAN", 50))
    damage_profile = coc_rules.damage_bonus_build(
        int(char_chars.get("STR", 50)), int(char_chars.get("SIZ", 50))
    )
    authored_weapons = coc_inventory.effective_weapons(
        character.get("weapons", []) or [],
        coc_inventory.normalize_inventory(inv_state),
    )
    if not any(weapon.get("weapon_id") == "unarmed" for weapon in authored_weapons):
        authored_weapons.append({"weapon_id": "unarmed"})
    investigator_combat_profile = {
        "actor_id": investigator_id,
        "side": "investigator",
        "dex": int(char_chars.get("DEX", 50)),
        "combat_skill": int(char_skills.get("Fighting (Brawl)", 25)),
        "dodge_skill": int(char_skills.get("Dodge", max(1, int(char_chars.get("DEX", 50)) // 2))),
        "firearms_skill": int(char_skills.get("Firearms (Handgun)", 0)),
        "has_ready_firearm": False,
        "build": int(damage_profile["build"]),
        "damage_bonus": str(damage_profile["damage_bonus"]),
        "hp_max": int(max_hp),
        "hp_current": int(current_hp),
        "con": int(char_chars.get("CON", 50)),
        "magic_points": int(inv_state.get("current_mp", char_derived.get("MP", 0))),
        "armor": 0,
        "armor_rule": None,
        # Weapon identity is authored structure.  Legacy display names are not
        # guessed here; semantic intent may select only stable owned IDs.
        "weapons": authored_weapons,
        "conditions": list(conditions),
    }
    # Max SAN = 99 - Cthulhu Mythos (p.167 F9); see coc_mythos.max_san_for.
    cthulhu_mythos = int(char_skills.get("Cthulhu Mythos", 0))
    max_san = coc_mythos.max_san_for(cthulhu_mythos)
    credit_rating = char_skills.get("Credit Rating", 0)
    app = char_chars.get("APP", 50)
    # E1: Luck=0 is a legitimate depleted value — never truthiness-fallback.
    _luck_derived = char_derived.get("Luck")
    if _luck_derived is not None:
        luck = _luck_derived
    else:
        _luck_char = char_chars.get("LUCK")
        luck = 50 if _luck_char is None else _luck_char

    recent_intents = pacing.get("recent_intent_classes", [])
    recent_intent_tags = pacing.get("recent_intent_tags", [])
    rule_signals = {
        "hp_state": coc_rule_signals.read_hp_state(current_hp, max_hp, conditions),
        "sanity_state": coc_rule_signals.read_sanity_state(
            current_san, max_san,
            bout_active=bool(inv_state.get("bout_active")) or "bout_active" in conditions,
            lost_this_event=inv_state.get("san_lost_this_event", 0),
        ),
        "indefinite_insane": bool(inv_state.get("indefinite_insane", False)),
        "credit_tier": coc_rule_signals.read_credit_tier(credit_rating),
        "credit_rating": credit_rating,  # raw value for roll_npc_reaction
        "app": app,  # raw value for roll_npc_reaction
        "npc_reaction_roll": None,  # populated per-NPC at scoring time
        "luck_level": coc_rule_signals.read_luck_signal(luck, pacing.get("luck_spent_last", 0))[0],
        "luck_spent_last": pacing.get("luck_spent_last", 0) > 0,
        "last_roll_critical": _last_outcome == "critical",
        "last_roll_fumble": _last_outcome == "fumble",
        "active_conditions": conditions,
        "stalled_turns": coc_rule_signals.read_stalled_turns(recent_intents),
        "tension_clock": coc_rule_signals.read_tension_clock(
            pacing.get("tension_level", "low"), pacing.get("lethal_chances_used", 0),
        ),
        # W2-3 leftover: one-shot pacing flag from a legal pushed-roll failure
        # (apply writes via read_pushed_fail_pending; PRESSURE scoring consumes;
        # apply clears when the plan's rule_signals carried the flag).
        "pushed_fail_pending": bool(pacing.get("pushed_fail_pending")),
        "bout_active": bool(inv_state.get("bout_active")) or "bout_active" in conditions,
        "delusion_active": bool(inv_state.get("active_delusion")),
    }
    # Structured phobia/mania exposure (W1-4): scene threat_tags ∩ stored
    # phobia_tags/mania_tags. No free-text scanning.
    threat_tags = {
        str(t) for t in (active_scene.get("threat_tags") or []) if t
    }
    owned_tags = {
        str(t) for t in (
            list(inv_state.get("phobia_tags") or [])
            + list(inv_state.get("mania_tags") or [])
        ) if t
    }
    matched_exposure = sorted(threat_tags & owned_tags)
    insane_for_exposure = bool(
        inv_state.get("temporary_insane")
        or inv_state.get("indefinite_insane")
        or inv_state.get("permanently_insane")
        or rule_signals["bout_active"]
        or rule_signals["sanity_state"] in ("temp_insane", "bout_active")
    )
    rule_signals["phobia_exposure"] = {
        "penalty_die": bool(insane_for_exposure and matched_exposure),
        "matched_tags": matched_exposure if insane_for_exposure else [],
    }
    signal_ctx = {
        "player_intent_class": player_intent_class,
        "player_intent_rich": player_intent_rich,
        "validation_warnings": validation_warnings,
        "active_scene": active_scene,
    }
    rule_signals["low_agency_continue_count"] = _low_agency_continue_count(
        recent_intents, signal_ctx, recent_intent_tags=recent_intent_tags
    )
    rule_signals["scene_pressure_available"] = _scene_pressure_available(signal_ctx)

    # --- time signals (deterministic world-clock layer) ---
    time_signals: dict[str, Any] = {}
    if coc_time is not None:
        time_state = coc_time.read_time_state(campaign_dir)
        if time_state:
            due = coc_time.peek_due_triggers(campaign_dir)
            time_signals = coc_time.build_time_signals(time_state, due)

    # --- engine-state signals (SanitySession / ChaseSession awareness) ---
    sanity_engine_state: dict[str, Any] | None = None
    if hasattr(coc_rule_signals, "read_sanity_engine_state"):
        sanity_engine_state = coc_rule_signals.read_sanity_engine_state(
            campaign_dir, investigator_id
        )
    chase_state: dict[str, Any] | None = None
    if hasattr(coc_rule_signals, "read_chase_state"):
        chase_state = coc_rule_signals.read_chase_state(campaign_dir)

    # E2: structured play language from campaign.json (default zh-Hans).
    campaign_doc = _read_json(campaign_dir / "campaign.json", {})
    play_language = campaign_doc.get("play_language") or "zh-Hans"

    authored_threats = _read_json(scenario / "threat-fronts.json", {"fronts": []})
    affinity_findings = coc_scenario_compile._check_threat_affinity_contract({
        "threat_fronts": authored_threats,
    })
    identity_findings = coc_scenario_compile._check_threat_clock_identity_contract({
        "threat_fronts": authored_threats,
    })
    threat_findings = [*affinity_findings, *identity_findings]
    if threat_findings:
        raise ValueError(threat_findings[0]["message"])
    persisted_threats = coc_threat_state.load_threat_state(save)
    merged_threats = coc_threat_state.merge_threat_fronts(
        authored_threats, persisted_threats
    )
    clue_graph = _read_json(scenario / "clue-graph.json", {"conclusions": []})
    npc_agendas = _read_json(scenario / "npc-agendas.json", {"npcs": []})
    a21_findings = coc_npc_state.validate_a21_contract(npc_agendas, clue_graph)
    if a21_findings:
        raise ValueError(a21_findings[0]["message"])

    return {
        "campaign_dir": campaign_dir,
        "investigator_id": investigator_id,
        "player_intent": player_intent,
        "player_intent_class": player_intent_class,
        "player_intent_rich": player_intent_rich,
        "validation_warnings": validation_warnings,
        "play_language": play_language,
        # P1-8: expose the investigator's structured skills so downstream
        # enrichment (dialogue_comprehension tier) can gate foreign-dialogue
        # translation on the actual Language skill value without re-reading
        # the character sheet. Slim dict only; the full sheet stays private.
        "investigator_skills": char_skills,
        "investigator_combat_profile": investigator_combat_profile,
        # W1-2: structured personal-horror hooks (p.193-194). CHARACTER beats
        # weave unwoven hooks; PAYOFF echoes woven ones.
        "personal_horror_hooks": list(inv_state.get("personal_horror_hooks") or []),
        # W2-6 / p.212: believer flag drives mythos_bleak tone injection.
        "believer": inv_state.get("believer") is True,
        "active_scene_id": active_scene_id,
        "active_scene": active_scene,
        "active_scene_function": active_scene_function,
        "structure_type": module_meta.get("structure_type", "branching_investigation"),
        "module_meta": module_meta,
        "story_graph": story_graph,
        "clue_graph": clue_graph,
        "npc_agendas": npc_agendas,
        "epistemic_graph": _read_json(scenario / "epistemic-graph.json", {"questions": [], "evidence_links": []}),
        "reveal_contracts": _read_json(scenario / "reveal-contracts.json", {"contracts": []}),
        "compile_confidence": _read_json(scenario / "compile-confidence.json", {"schema_version": 1, "nodes": []}),
        "belief_state": coc_belief_state.read_belief_state(campaign_dir),
        "npc_state": _read_json(save / "npc-state.json", {"schema_version": 1, "npcs": {}}),
        "director_strategy_state": _read_json(
            save / "director-strategy-state.json", {"schema_version": 1}
        ),
        "npc_state_writes": [],
        "threat_fronts": merged_threats,
        "pacing_map": _read_json(scenario / "pacing-map.json", {"pacing_curve": []}),
        "improvisation_boundaries": _read_json(scenario / "improvisation-boundaries.json", {}),
        "world_state": world,
        "rule_signals": rule_signals,
        "combat_state": combat_state,
        "time_signals": time_signals,
        "sanity_engine_state": sanity_engine_state,
        "chase_state": chase_state,
        "rng": rng,
        "turn_number": pacing.get("turn_number", 0),
    }


def write_director_plan(plan: dict[str, Any], artifacts_dir: Path) -> Path:
    """Persist DirectorPlan to artifacts/<decision_id>.json. Returns path."""
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    out = artifacts_dir / f"{plan['decision_id']}.json"
    out.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return out


# =============================================================================
# Three-layer scoring engine
# Historical spec retired; see tombstone index docs/status/DIAGNOSIS-LEDGER.md
# =============================================================================

RULES_DIR = SCRIPT_DIR.parent / "references" / "rules-json"


def _load_structure_weights() -> dict[str, Any]:
    path = RULES_DIR / "structure-weights.json"
    if not path.exists():
        return {"weights": {}, "tiebreak_order": []}
    return coc_cache.load_json_cached(path)


ACTIONS = ["REVEAL", "DEEPEN", "PRESSURE", "CHARACTER", "CHOICE", "CUT", "MONTAGE", "SUBSYSTEM", "RECOVER", "PAYOFF"]

# P0-2: 低主动身份单一来源。所有 tag/class 字符串统一在此定义，
# 消除 _LOW_AGENCY_RECENT_CLASSES / _LOW_AGENCY_CONTINUE_TAGS / 部分 routine tag 的分裂。
_LOW_AGENCY_TAGS = frozenset({
    "move",
    "continue",
    "follow",
    "follow_group",
    "low_agency_continue",
    "passive_follow",
    "continue_without_new_goal",
    "keep_following",
    "move_with_group",
    "yield_initiative",
    "continue_existing_strategy",
})
# 派生：用于 class 字符串匹配（保持向后兼容子集）
_LOW_AGENCY_RECENT_CLASSES = frozenset({
    "move", "continue", "follow", "follow_group", "low_agency_continue", "passive_follow",
})
# continue_existing_strategy 同时保留为 routine 标记（用于压缩进度），但不再是"非低主动"
_ROUTINE_PROGRESS_TAGS = frozenset({
    "routine_action", "routine_search", "routine_travel", "routine_professional_action",
    "connective_action", "continue_existing_strategy", "maintain_posture", "low_risk_action",
})
# _LOW_AGENCY_CONTINUE_TAGS 由 _LOW_AGENCY_TAGS 派生（向后兼容）
_LOW_AGENCY_CONTINUE_TAGS = _LOW_AGENCY_TAGS
_DRAMATIC_PROGRESS_ADVANCE_UNTIL = [
    "threat_approaches",
    "new_clue_or_obvious_information",
    "npc_requests_specialist_judgment",
    "meaningful_choice",
    "risk_requires_roll",
    "scene_arrival_or_transition",
]
_NON_BLOCKING_RULE_REQUEST_KINDS = {"npc_assist"}
_SOCIAL_REVEAL_DELIVERY_KINDS = {"npc_dialogue", "social"}


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return [value]


def _rich_intent_tags(ctx: dict[str, Any]) -> set[str]:
    rich = ctx.get("player_intent_rich") or {}
    tags = {str(ctx.get("player_intent_class") or "")}
    tags.add(str(rich.get("primary_intent") or ""))
    for key in ("secondary_intents", "target_entities"):
        for value in _as_list(rich.get(key)):
            if value:
                tags.add(str(value))
    return {tag for tag in tags if tag}


def _is_low_agency_continue(ctx: dict[str, Any]) -> bool:
    tags = _rich_intent_tags(ctx)
    if tags & _LOW_AGENCY_CONTINUE_TAGS:
        return True
    return str(ctx.get("player_intent_class") or "") in _LOW_AGENCY_TAGS


def _normalize_recent_intent_tags(recent_tags: list[Any]) -> list[list[str]]:
    """P0-2b: normalize persisted recent_intent_tags to list[list[str]].

    Tolerates missing/old save files (returns []).
    """
    normalized: list[list[str]] = []
    for entry in (recent_tags or []):
        if isinstance(entry, list):
            normalized.append([str(t) for t in entry if str(t)])
        else:
            normalized.append([])
    return normalized


def _low_agency_continue_count(
    recent_intents: list[Any],
    ctx: dict[str, Any],
    *,
    recent_intent_tags: list[Any] | None = None,
) -> int:
    count = 1 if _is_low_agency_continue(ctx) else 0
    classes = list(recent_intents or [])
    tags_history = _normalize_recent_intent_tags(recent_intent_tags)
    n_tags = len(tags_history)
    for i in range(len(classes) - 1, -1, -1):
        cls = str(classes[i])
        turn_tags = set(tags_history[i]) if i < n_tags else set()
        cls_is_low = cls in _LOW_AGENCY_RECENT_CLASSES
        tags_low = bool(turn_tags & _LOW_AGENCY_CONTINUE_TAGS)
        if cls_is_low or tags_low:
            count += 1
        else:
            break
    return count


def _scene_pressure_available(ctx: dict[str, Any]) -> bool:
    scene = ctx.get("active_scene") or {}
    return bool(scene.get("pressure_moves"))


def _progress_contract(scene: dict[str, Any]) -> dict[str, Any]:
    contract = scene.get("progress_contract")
    return dict(contract) if isinstance(contract, dict) else {}


def _positive_int(value: Any, default: int = 1) -> int:
    try:
        return max(1, int(value or default))
    except (TypeError, ValueError):
        return default


def _is_bridge_scene(scene: dict[str, Any]) -> bool:
    contract = _progress_contract(scene)
    kind = str(contract.get("kind") or scene.get("scene_kind") or scene.get("scene_type") or "")
    if kind in _BRIDGE_SCENE_KINDS:
        return True
    return scene.get("source_event_type") == "scene_transition"


def _bridge_low_agency_exhausted(ctx: dict[str, Any]) -> bool:
    scene = ctx.get("active_scene") or {}
    if not _is_bridge_scene(scene):
        return False
    if _scene_pressure_available(ctx):
        return False
    if _available_reveal_clues(ctx):
        return False
    contract = _progress_contract(scene)
    max_turns_int = _positive_int(contract.get("max_low_agency_turns"), 1)
    return int((ctx.get("rule_signals") or {}).get("low_agency_continue_count", 0) or 0) > max_turns_int


def _bridge_transition_override(ctx: dict[str, Any]) -> dict[str, Any] | None:
    if not _bridge_low_agency_exhausted(ctx):
        return None
    scene = ctx.get("active_scene") or {}
    contract = _progress_contract(scene)
    action = str(contract.get("fallback_action") or "MONTAGE").upper()
    if action not in {"MONTAGE", "CUT"}:
        action = "MONTAGE"
    return {
        "scene_action": action,
        "handoff": "narration",
        "rationale": "low-agency bridge scene exhausted; force transition to next actionable beat",
        "scene_progress": {
            "schema_version": 1,
            "action": "force_transition",
            "reason": "low_agency_bridge_exhausted",
            "scene_kind": (
                contract.get("kind")
                or scene.get("scene_kind")
                or ("live_transition" if scene.get("source_event_type") == "scene_transition" else scene.get("scene_type"))
            ),
            "low_agency_continue_count": int((ctx.get("rule_signals") or {}).get("low_agency_continue_count", 0) or 0),
            "max_low_agency_turns": _positive_int(contract.get("max_low_agency_turns"), 1),
            "exit_directive": contract.get("exit_directive")
                or "Resolve this bridge briefly and cut to the next meaningful decision point.",
            "fallback_action": action,
        },
    }


def _move_transition_override(ctx: dict[str, Any]) -> dict[str, Any] | None:
    """Force CUT when structured move intent has an unlocked reachable target.

    Beats structure-weight demotion of CUT (e.g. hub_sandbox 0.7) so CHARACTER
    cannot trap the party in the start scene after R-3 unlock.

    When ``player_intent_rich.target_entities`` uniquely intersects a
    candidate's ``location_tags`` / ``scene_id``, that scene becomes
    ``transition_to`` and ``matched_target`` evidence is attached. Zero
    matches or ties keep the existing deterministic candidate order.

    When no unlocked candidates exist but the move uniquely matches a still-
    locked destination gated solely by ``flag_set``, emit CUT plus
    ``flags_set`` so apply can commit the departure flag, unlock, then travel.
    """
    scene = ctx.get("active_scene") or {}
    story_graph = ctx.get("story_graph")
    world = ctx.get("world_state") or {}
    rich = ctx.get("player_intent_rich") or {}
    resolution = rich.get("action_resolution") if isinstance(rich, dict) else None
    resolved_destination = (
        str(resolution.get("matched_destination_scene_id") or "").strip()
        if isinstance(resolution, dict)
        else ""
    )
    # Keep planning consistent with the action-resolver projection when an
    # authored clue/flag gate is already satisfied but the durable unlock list
    # has not yet been refreshed (for example, a newly hydrated scene added to
    # a live campaign). This is a read-only structured projection; apply still
    # owns persistence and emits the authoritative scene_unlocked event.
    planning_world = deepcopy(world)
    direct_entry_authority: dict[str, Any] | None = None
    if resolved_destination:
        flags_doc = ctx.get("flags") if isinstance(ctx.get("flags"), dict) else {}
        raw_flags = flags_doc.get("flags") if isinstance(flags_doc.get("flags"), dict) else {}
        planning_unlocks = coc_scene_graph.evaluate_unlocks(
            story_graph,
            planning_world,
            discovered_clue_ids={
                str(value) for value in (planning_world.get("discovered_clue_ids") or [])
                if value
            },
            flags_set={str(key) for key, value in raw_flags.items() if value},
        )
        coc_scene_graph.apply_unlocks_to_world(planning_world, planning_unlocks)
        raw_authority = resolution.get("destination_entry_authority")
        target_scene = next(
            (
                item for item in (story_graph or {}).get("scenes", [])
                if isinstance(item, dict)
                and str(item.get("scene_id") or "") == resolved_destination
            ),
            None,
        )
        canonical_authority = coc_scene_graph.public_direct_entry_authority(
            target_scene
        )
        if (
            isinstance(raw_authority, dict)
            and canonical_authority is not None
            and raw_authority == canonical_authority
        ):
            direct_entry_authority = canonical_authority
            unlocked = list(planning_world.get("unlocked_scene_ids") or [])
            if resolved_destination not in {str(value) for value in unlocked}:
                unlocked.append(resolved_destination)
                planning_world["unlocked_scene_ids"] = unlocked
    candidates = coc_scene_graph.transition_candidates(
        ctx.get("active_scene_id") or scene.get("scene_id"),
        story_graph,
        planning_world,
    )
    if str(ctx.get("player_intent_class") or "") != "move":
        return None
    target_entities = rich.get("target_entities") if isinstance(rich, dict) else None
    targets = target_entities if isinstance(target_entities, list) else None
    # Once the KP semantic resolver has evaluated the bounded destination
    # candidates, a null destination is authoritative.  Falling through to
    # the legacy ranker would turn an unavailable requested destination into
    # whichever unrelated unlocked scene happens to sort first (for example,
    # asking to visit the still-locked newspaper archive teleported play to
    # the already-unlocked Corbitt House).  Hosts without action_resolution
    # keep the structured target-tag compatibility path below.
    if isinstance(resolution, dict) and not resolved_destination:
        return None
    if candidates:
        if resolved_destination and resolved_destination in candidates:
            override = {
                "scene_action": "CUT",
                "handoff": "narration",
                "rationale": "KP semantic action resolution selected an unlocked destination",
                "transition_to": resolved_destination,
                "matched_target": resolved_destination,
            }
            if direct_entry_authority is not None:
                override["destination_entry_authority"] = direct_entry_authority
                override["rationale"] = (
                    "KP semantic action resolution selected an exact public "
                    "independent-entry destination"
                )
            return override
        chosen, matched = coc_scene_graph.rank_move_targets(
            candidates, story_graph, targets
        )
        result: dict[str, Any] = {
            "scene_action": "CUT",
            "handoff": "narration",
            "rationale": "structured move intent with unlocked reachable scene; commit transition",
            "transition_to": chosen or candidates[0],
        }
        if matched is not None:
            result["matched_target"] = matched
            result["rationale"] = (
                "structured move intent matched unlocked scene via location_tags; commit transition"
            )
        return result

    # A single player action may both take a current public affordance and
    # depart through the clue gate it satisfies (for example accepting keys
    # and immediately heading to the house).  The semantic resolver can name
    # that exact destination, but only authored clue IDs on the matched
    # affordance authorize the same-turn unlock.  Apply commits clues, runs the
    # unlock pass, and only then validates/commits the requested transition.
    if resolved_destination and isinstance(resolution, dict):
        matched_ids = {
            str(item) for item in (resolution.get("matched_affordance_ids") or []) if item
        }
        granted: set[str] = set()
        for affordance in scene.get("affordances") or []:
            if not isinstance(affordance, dict):
                continue
            affordance_id = str(
                affordance.get("id") or affordance.get("route_id") or affordance.get("route") or ""
            )
            if affordance_id not in matched_ids:
                continue
            for clue_id in [affordance.get("clue_id"), *(affordance.get("grants_clue_ids") or [])]:
                if clue_id:
                    granted.add(str(clue_id))
        for edge in scene.get("scene_edges") or []:
            if not isinstance(edge, dict) or str(edge.get("to") or "") != resolved_destination:
                continue
            when = edge.get("when") if isinstance(edge.get("when"), dict) else {}
            if when.get("kind") == "clue_discovered" and str(when.get("clue_id") or "") in granted:
                return {
                    "scene_action": "CUT",
                    "handoff": "narration",
                    "rationale": "matched public affordance grants the destination clue before same-turn travel",
                    "transition_to": resolved_destination,
                    "matched_target": resolved_destination,
                }

    gated = coc_scene_graph.resolve_move_flag_commits(
        ctx.get("active_scene_id") or scene.get("scene_id"),
        story_graph,
        world,
        targets,
    )
    if gated is None:
        return None
    return {
        "scene_action": "CUT",
        "handoff": "narration",
        "rationale": (
            "structured move intent commits flag-gated unlock then transition"
        ),
        "transition_to": gated["to_scene"],
        "flags_set": list(gated["flag_ids"]),
        "matched_target": gated["matched_target"],
    }


def _bounded_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def _compression_budget(scene: dict[str, Any]) -> dict[str, int]:
    contract = _progress_contract(scene)
    raw = contract.get("compression_budget") or contract.get("progress_budget") or {}
    if not isinstance(raw, dict):
        raw = {}
    max_beats = _bounded_int(raw.get("max_beats"), 4, 2, 8)
    min_beats = _bounded_int(raw.get("min_beats"), 2, 1, max_beats)
    return {
        "min_beats": min_beats,
        "max_beats": max_beats,
        "max_minutes": _bounded_int(raw.get("max_minutes"), 10, 1, 30),
    }


def _has_explicit_compression_budget(scene: dict[str, Any]) -> bool:
    contract = _progress_contract(scene)
    return isinstance(contract.get("compression_budget"), dict) or isinstance(contract.get("progress_budget"), dict)


def _low_agency_max_beats(scene: dict[str, Any]) -> int:
    if _has_explicit_compression_budget(scene):
        return _compression_budget(scene).get("max_beats", 4)
    contract = _progress_contract(scene)
    fallback_turns = contract.get("max_low_agency_turns")
    if fallback_turns is not None:
        return _positive_int(fallback_turns, 4)
    return _compression_budget(scene).get("max_beats", 4)


def _ordered_unique(values: list[Any]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if not value:
            continue
        item = str(value)
        if item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


def _has_roll_facing_action_atoms(ctx: dict[str, Any]) -> bool:
    rich = ctx.get("player_intent_rich") or {}
    for atom in _as_list(rich.get("action_atoms")):
        if not isinstance(atom, dict):
            continue
        if atom.get("skill") or atom.get("characteristic") or atom.get("difficulty"):
            return True
        if atom.get("stakes") or atom.get("opposed_by") or atom.get("rules_kind"):
            return True
    return False


def _blocking_rule_requests(rules_requests: list[dict[str, Any]]) -> list[dict[str, Any]]:
    blocking: list[dict[str, Any]] = []
    for request in rules_requests:
        if not isinstance(request, dict):
            continue
        if str(request.get("kind") or "") in _NON_BLOCKING_RULE_REQUEST_KINDS:
            continue
        blocking.append(request)
    return blocking


def _dramatic_progress_interrupts(
    action: str,
    pressure_moves: list[dict[str, Any]],
    clue_policy: dict[str, Any],
) -> list[str]:
    interrupts: list[str] = []
    if pressure_moves:
        interrupts.append("threat_approaches")
    if action == "REVEAL" and clue_policy.get("reveal"):
        interrupts.append("new_clue_or_obvious_information")
    if action == "CHOICE":
        interrupts.append("meaningful_choice")
    return interrupts


def _dramatic_progress_directive(
    ctx: dict[str, Any],
    action: str,
    clue_policy: dict[str, Any],
    rules_requests: list[dict[str, Any]],
    pressure_moves: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """Tell narration to compress routine beats until a real interrupt appears.

    This controller does not infer intent from prose. It consumes semantic tags
    emitted by the intent layer plus scene contracts and rule requests.
    """
    scene = ctx.get("active_scene") or {}
    rich = ctx.get("player_intent_rich") or {}
    tags = sorted(_rich_intent_tags(ctx))
    low_agency = _is_low_agency_continue(ctx)
    routine_or_connective = bool(set(tags) & _ROUTINE_PROGRESS_TAGS)
    if not low_agency and not routine_or_connective:
        return None
    if bool(rich.get("explicit_roll_request")):
        return None
    if _has_roll_facing_action_atoms(ctx):
        return None
    if action in {"CHOICE", "SUBSYSTEM", "RECOVER"}:
        return None
    if _blocking_rule_requests(rules_requests):
        return None
    if action == "REVEAL" and clue_policy.get("clue_type", "obscured") != "obvious":
        return None

    contract = _progress_contract(scene)
    advance_until = _ordered_unique(
        list(_DRAMATIC_PROGRESS_ADVANCE_UNTIL)
        + _as_list(contract.get("interrupts"))
        + _as_list(contract.get("advance_until"))
    )
    return {
        "schema_version": 1,
        "mode": "compressed_progress",
        "reason": "low_agency_or_routine_posture",
        "trigger_tags": tags,
        "compression_budget": _compression_budget(scene),
        "advance_until": advance_until,
        "current_interrupts": _dramatic_progress_interrupts(action, pressure_moves, clue_policy),
        "must_change_state": True,
        "must_not": [
            "do not ask for another equivalent low-agency action",
            "do not repeat the same scene state with only cosmetic wording",
            "do not make irreversible player choices during compression",
            "do not skip a risk that requires a roll",
        ],
    }


def _first_unresolved_conclusion(ctx: dict[str, Any]) -> dict[str, Any] | None:
    discovered = set((ctx.get("world_state") or {}).get("discovered_clue_ids", []))
    for conclusion in (ctx.get("clue_graph") or {}).get("conclusions", []):
        clue_ids = [clue.get("clue_id") for clue in conclusion.get("clues", []) if clue.get("clue_id")]
        if clue_ids and not any(clue_id in discovered for clue_id in clue_ids):
            return conclusion
    return None


def _normalize_idea_signpost_level(raw: Any) -> str:
    key = str(raw or "").strip().lower()
    return _IDEA_SIGNPOST_ALIASES.get(key, _IDEA_SIGNPOST_FREE)


def _clue_signpost_level(ctx: dict[str, Any], clue_id: str | None) -> str:
    """Read structured signpost level for a clue from world-state.clue_signposts."""
    if not clue_id:
        return _IDEA_SIGNPOST_FREE
    posts = (ctx.get("world_state") or {}).get("clue_signposts") or {}
    if not isinstance(posts, dict):
        return _IDEA_SIGNPOST_FREE
    return _normalize_idea_signpost_level(posts.get(clue_id))


def _idea_roll_difficulty_for_signpost(signpost_level: str) -> str | None:
    """Map signpost level to Idea Roll difficulty.

    Returns None when the Keeper should give the lead free (never mentioned).
    """
    level = _normalize_idea_signpost_level(signpost_level)
    if level == _IDEA_SIGNPOST_FREE:
        return None
    if level == _IDEA_SIGNPOST_EXTREME:
        return "extreme"
    return "regular"


def _idea_roll_plan(
    ctx: dict[str, Any],
    action: str,
    *,
    missed_clue_id: str | None = None,
) -> dict[str, Any] | None:
    if action != "RECOVER":
        return None
    if missed_clue_id is None:
        conclusion = _first_unresolved_conclusion(ctx)
        discovered = set((ctx.get("world_state") or {}).get("discovered_clue_ids", []))
        for clue in (conclusion or {}).get("clues", []) or []:
            if not isinstance(clue, dict):
                continue
            clue_id = clue.get("clue_id")
            if clue_id and clue_id not in discovered:
                missed_clue_id = clue_id
                break
    signpost_level = _clue_signpost_level(ctx, missed_clue_id)
    difficulty = _idea_roll_difficulty_for_signpost(signpost_level)
    # p.199: success and failure both advance the lead; failure delivers it
    # in the worst possible way (cost / exposure / alert) via structured fields.
    return {
        "schema_version": 1,
        "missed_clue_id": missed_clue_id,
        "roll_target": "INT",
        "signpost_level": signpost_level,
        "difficulty": difficulty,
        "success_delivery": "surface a clean in-world inference or overlooked lead",
        "failure_delivery_with_cost": "surface the lead in a worse position",
        "failure_delivery": "worst_possible_way",
        "directive": {
            "mode": "worst_possible_way",
            "channels": ["cost", "exposure", "alert"],
            "instruction": (
                "on Idea Roll failure, deliver the same lead with immediate "
                "cost, exposure, or alert — never as a clean free insight"
            ),
        },
        "costs": ["time_pressure"] if difficulty is not None else [],
        "must_not": [
            "do not present this as table-level advice",
            "do not ask the player to guess the same missing route again",
        ],
    }


def _low_agency_budget_exceeded(ctx: dict[str, Any]) -> bool:
    """P1-1: True when the scene's low-agency beat count has reached its cap.

    Cap resolution prefers ``compression_budget.max_beats`` (as written by
    ``_compression_budget``), then falls back to ``progress_contract.
    max_low_agency_turns`` (used by the bridge-exhausted rule), then defaults
    to 4. Scene-agnostic: does not inspect scene_type / bridge kind.
    """
    scene = ctx.get("active_scene") or {}
    max_beats = _low_agency_max_beats(scene)
    count = int((ctx.get("rule_signals") or {}).get("low_agency_continue_count", 0) or 0)
    return count >= max_beats


def _scene_exit_pressure_directive(
    ctx: dict[str, Any],
    action: str,
    clue_policy: dict[str, Any],
    rules_requests: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if _blocking_rule_requests(rules_requests):
        return None
    scene = ctx.get("active_scene") or {}
    continue_count = int((ctx.get("rule_signals") or {}).get("low_agency_continue_count", 0) or 0)
    reasons: list[str] = []
    if _is_low_agency_continue(ctx) and continue_count >= 2:
        reasons.append("low_agency_repetition")
    if _low_agency_budget_exceeded(ctx):
        reasons.append("budget_exceeded")
    tags = _rich_intent_tags(ctx)
    if tags & _ROUTINE_PROGRESS_TAGS and not _available_reveal_clues(ctx):
        reasons.append("no_new_axis")
    if _is_bridge_scene(scene) and _bridge_low_agency_exhausted(ctx):
        reasons.append("bridge_exhausted")
    if not reasons:
        return None
    reason_map = {
        "low_agency_repetition": "repetition_detected",
        "bridge_exhausted": "routine_exhausted",
        "no_new_axis": "no_new_axis",
        "budget_exceeded": "budget_exceeded",
    }
    public_reasons = _ordered_unique(reason_map.get(reason, reason) for reason in reasons)
    state = "compress"
    if "bridge_exhausted" in reasons:
        state = str((_progress_contract(scene).get("fallback_action") or "montage")).lower()
    return {
        "schema_version": 1,
        "state": state if state in {"compress", "cut", "montage"} else "compress",
        "reasons": public_reasons,
        "internal_reasons": _ordered_unique(reasons),
        "scene_goal_status": "exhausted" if "no_new_axis" in reasons else "open",
        "advance_until": list(_DRAMATIC_PROGRESS_ADVANCE_UNTIL),
        "must_change_state": True,
        "low_agency_continue_count": continue_count,
        "max_beats": _low_agency_max_beats(scene),
        "must_not": [
            "do not ask for another equivalent low-agency action",
            "do not repeat the same scene state with cosmetic wording",
        ],
    }


def _clue_supports_social_reveal(clue_id: str, clue_graph: dict[str, Any]) -> bool:
    clue = _find_clue(clue_id, clue_graph)
    if clue is None:
        return False
    delivery_kind = clue.get("delivery_kind")
    return isinstance(delivery_kind, str) and delivery_kind in _SOCIAL_REVEAL_DELIVERY_KINDS


def _available_reveal_clues(ctx: dict[str, Any], intent: str | None = None) -> list[str]:
    scene = ctx.get("active_scene") or {}
    discovered = set(ctx["world_state"].get("discovered_clue_ids", []))
    available = [c for c in scene.get("available_clues", []) if c not in discovered]
    intent = intent or str(ctx.get("player_intent_class") or "")
    if intent == "social":
        clue_graph = ctx.get("clue_graph", {})
        return [cid for cid in available if _clue_supports_social_reveal(cid, clue_graph)]
    return available


def _player_facing_style(language: str = "zh-Hans") -> dict[str, Any]:
    return coc_narration_style.player_facing_style_contract(language)


def _clock_segments(clock: dict, key: str, default: int = 0) -> int:
    """Read a clock segment count, tolerating null/missing/non-int values.
    Director consumes LLM-compiled JSON which may have type inconsistencies."""
    val = clock.get(key, default)
    if val is None:
        return default
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def _base_score(action: str, ctx: dict[str, Any]) -> float:
    """Layer 1: structure-agnostic trigger conditions. Returns 0.0-1.0."""
    scene = ctx.get("active_scene") or {}
    sig = ctx["rule_signals"]
    intent = ctx["player_intent_class"]
    clue_graph = ctx.get("clue_graph", {})
    discovered = set(ctx["world_state"].get("discovered_clue_ids", []))

    if action == "REVEAL":
        avail = _available_reveal_clues(ctx, intent)
        if not avail:
            return 0.0
        if intent == "investigate":
            return 0.9
        if intent == "social":
            return 0.75
        return 0.0

    if action == "DEEPEN":
        if intent not in ("investigate", "social"):
            return 0.0
        return 0.5 if scene.get("dramatic_question") else 0.0

    if action == "PRESSURE":
        fronts = ctx.get("threat_fronts", {}).get("fronts", [])
        near_full = any(
            any(_clock_segments(c, "current_segments", 0) >= _clock_segments(c, "segments", 6) * 2 / 3
                for c in f.get("clocks", []))
            for f in fronts
        )
        yielded_scene = (
            sig.get("low_agency_continue_count", 0) >= 2
            and sig.get("scene_pressure_available", False)
        )
        base = 0.85 if yielded_scene else (0.8 if (near_full or sig["stalled_turns"] >= 1) else 0.2)
        # Rich-intent risk posture adjustment: a reckless player invites more
        # pressure (clocks tick faster toward them); a cautious player tempers
        # it. No-op when rich intent is absent (legacy single-class path).
        rich = ctx.get("player_intent_rich")
        if rich:
            posture = rich.get("risk_posture", "neutral")
            if posture == "reckless":
                base = min(0.95, base + 0.1)
            elif posture == "cautious":
                base = max(0.05, base - 0.1)
        # p.83-85: legal pushed-roll failure pending → nudge PRESSURE once.
        # Flag is a structured pacing bool (set by apply); cleared when apply
        # lands a plan whose rule_signals carried the consumed signal.
        if sig.get("pushed_fail_pending"):
            base = min(0.95, round(base + 0.1, 4))
        return base

    if action == "CHARACTER":
        npcs_in_scene = scene.get("npc_ids", [])
        agendas = ctx.get("npc_agendas", {}).get("npcs", [])
        has_agenda_npc = any(n["npc_id"] in npcs_in_scene and n.get("agenda") for n in agendas)
        return 0.7 if has_agenda_npc else 0.0

    if action == "CHOICE":
        if intent not in ("idle", "ambiguous", "stuck"):
            return 0.0
        avail = [c for c in scene.get("available_clues", []) if c not in discovered]
        return 0.7 if len(avail) >= 2 else 0.0

    if action == "CUT":
        # CUT needs structured movement authority. A satisfied exit condition
        # makes destinations available; it does not itself select one. Explicit
        # move intent remains compatible for hosts without the semantic action
        # resolver, while a resolver receipt with a null destination is
        # authoritative and therefore cannot fall through to candidates[0].
        candidates = coc_scene_graph.transition_candidates(
            ctx.get("active_scene_id") or scene.get("scene_id"),
            ctx.get("story_graph"),
            ctx.get("world_state") or {},
        )
        if not candidates:
            return 0.0
        if intent == "move":
            rich = ctx.get("player_intent_rich")
            resolution = (
                rich.get("action_resolution")
                if isinstance(rich, dict)
                and isinstance(rich.get("action_resolution"), dict)
                else None
            )
            if isinstance(resolution, dict) and not str(
                resolution.get("matched_destination_scene_id") or ""
            ).strip():
                return 0.0
            return 1.0
        if not _is_low_agency_continue(ctx):
            return 0.0
        exit_met = any(_eval_exit(e, ctx) for e in scene.get("exit_conditions", []))
        if exit_met:
            return 0.8
        # Existing stalled_turns pacing raises transition pressure when a
        # reachable unlocked target already exists (no new keyword system).
        stalled = int(sig.get("stalled_turns", 0) or 0)
        if stalled >= 2:
            return min(0.85, 0.45 + 0.15 * stalled)
        return 0.0

    if action == "MONTAGE":
        return 0.6 if intent == "montage" else 0.0

    if action == "SUBSYSTEM":
        return 0.9 if intent in ("combat", "flee", "cast") else 0.0

    if action == "RECOVER":
        return 0.85 if sig["stalled_turns"] >= 2 else 0.0

    if action == "PAYOFF":
        if coc_memory is None:
            return 0.0
        cards = _retrieve_memory_for_ctx(ctx)
        if not cards:
            return 0.0
        # Discriminative scoring: normalize the raw retrieval score.
        # A single weak match (entity OR cue, top~4-6) should score ~0.3-0.4
        # (below REVEAL's 0.55-0.85, so PAYOFF only wins when memory is clearly relevant).
        # A strong match (multiple entities + cues, top~12+) scores ~0.7-0.85.
        # This keeps PAYOFF from firing on incidental overlap.
        top = max(float(c.get("score", 0)) for c in cards)
        return min(0.85, 0.15 + top * 0.05)

    return 0.0


def _eval_exit(condition: Any, ctx: dict[str, Any]) -> bool:
    """Structured exit-condition eval (shared normalizer in coc_exit_conditions).

    Machine-checkable kinds: ``clue_discovered``, ``clock_reaches``,
    ``flag_set``, ``always``. ``narrative`` conditions always evaluate False —
    such scenes wait for an explicit CUT / force_transition.
    """
    discovered = set(ctx["world_state"].get("discovered_clue_ids", []))
    flags_doc = ctx.get("flags") if isinstance(ctx.get("flags"), dict) else {}
    raw_flags = flags_doc.get("flags") if isinstance(flags_doc.get("flags"), dict) else {}
    flags_set = {str(k) for k, v in raw_flags.items() if v}

    def clock_reached(clock_id: str | None, threshold: int) -> bool:
        fronts = ctx.get("threat_fronts", {}).get("fronts", [])
        for front in fronts:
            for clock in front.get("clocks", []):
                if clock_id and str(clock.get("clock_id") or "") != clock_id:
                    continue
                if _clock_segments(clock, "current_segments", 0) >= threshold:
                    return True
        return False

    return coc_exit_conditions.evaluate_exit_condition(
        condition,
        discovered_clue_ids=discovered,
        clock_reached=clock_reached,
        flags_set=flags_set,
    )


def _authoritative_route_clue_ids(ctx: dict[str, Any]) -> list[str]:
    """Return undiscovered clues explicitly granted by resolver-matched routes.

    This is an exact structured binding: the semantic resolver may select only
    a currently projected authored route, and the route itself must name the
    clue.  Free-text clue affinity is deliberately not consulted here.
    """
    scene = ctx.get("active_scene") if isinstance(ctx.get("active_scene"), dict) else {}
    rich = (
        ctx.get("player_intent_rich")
        if isinstance(ctx.get("player_intent_rich"), dict)
        else {}
    )
    resolution = (
        rich.get("action_resolution")
        if isinstance(rich.get("action_resolution"), dict)
        else {}
    )
    if not resolution or resolution.get("no_match") is True:
        return []
    matched_route_ids = {
        str(value).strip()
        for value in (resolution.get("matched_affordance_ids") or [])
        if str(value or "").strip()
    }
    if not matched_route_ids:
        return []
    discovered = {
        str(value) for value in (ctx.get("world_state") or {}).get("discovered_clue_ids", [])
        if value
    }
    clue_graph = ctx.get("clue_graph") if isinstance(ctx.get("clue_graph"), dict) else {}
    resolved: list[str] = []
    for route in scene.get("affordances") or []:
        if not isinstance(route, dict):
            continue
        route_id = str(route.get("id") or route.get("route_id") or route.get("route") or "")
        if route_id not in matched_route_ids:
            continue
        for raw_clue_id in [route.get("clue_id"), *(route.get("grants_clue_ids") or [])]:
            clue_id = str(raw_clue_id or "").strip()
            if (
                clue_id
                and clue_id not in discovered
                and clue_id not in resolved
                and _find_clue(clue_id, clue_graph) is not None
            ):
                resolved.append(clue_id)
    return resolved


def apply_rule_signal_overrides(ctx: dict[str, Any]) -> dict[str, Any] | None:
    """Layer 3: hard overrides. Returns a forced action dict or None.

    Fair Warning (p.209 / Spec Layer 3): lethal outcomes are not a separate
    ACTIONS entry. While ``lethal_chances_used < 3``, ``generate_director_plan``
    downgrades structured lethal evidence (pressure_move / danger with
    ``lethal: true``, or positive ``lethality``) into
    ``narrative_directives["fair_warning"]`` via ``_apply_fair_warning_ladder``.
    After 3 warnings, ``death_allowed`` lets lethal outcomes through.
    """
    sig = ctx["rule_signals"]
    if sig["bout_active"]:
        return {"scene_action": "SUBSYSTEM", "subsystem": "sanity", "handoff": "rules",
                "rationale": "bout_active forces sanity subsystem"}
    if sig["hp_state"] == "dying":
        return {"scene_action": "SUBSYSTEM", "subsystem": "combat", "handoff": "rules",
                "rationale": "dying forces combat CON-clock + pressure",
                "extra_pressure": True}
    # NOTE: temp_insane (underlying insanity, p.158) deliberately does NOT
    # force a subsystem takeover — the player retains full control between
    # bouts; only bout_active (handled above) hands control to the Keeper.
    if sig["last_roll_fumble"]:
        return {"scene_action": "PRESSURE", "handoff": "narration",
                "rationale": "fumble forces immediate misfortune, cannot be pushed off"}
    bridge_override = _bridge_transition_override(ctx)
    if bridge_override is not None:
        return bridge_override
    move_override = _move_transition_override(ctx)
    if move_override is not None:
        return move_override
    keeper_proposal = coc_keeper_planner.proposal_from_context(ctx)
    if (
        isinstance(keeper_proposal, dict)
        and keeper_proposal.get("source") == "model"
        and keeper_proposal.get("scene_action") in ACTIONS
    ):
        # The private Keeper, not a Python score table, owns discretionary
        # scene direction. Mechanical emergencies and exact movement authority
        # above remain hard invariants. All other fixed scoring stays available
        # only as an explicit degraded-mode fallback.
        return {
            "scene_action": keeper_proposal["scene_action"],
            "handoff": (
                "rules"
                if keeper_proposal["scene_action"] == "SUBSYSTEM"
                or (keeper_proposal.get("rule_ruling") or {}).get("decision")
                == "roll"
                else "narration"
            ),
            "rationale": "validated private KeeperProposal",
            "keeper_proposal_authority": "llm_keeper_discretion",
        }
    route_clue_ids = _authoritative_route_clue_ids(ctx)
    if route_clue_ids:
        return {
            "scene_action": "REVEAL",
            "handoff": "narration",
            "rationale": (
                "resolver matched an authored route with explicit undiscovered "
                "clue grants; settle that route before generic scene scoring"
            ),
            "route_clue_ids": route_clue_ids,
        }
    rich = (
        ctx.get("player_intent_rich")
        if isinstance(ctx.get("player_intent_rich"), dict)
        else {}
    )
    resolution = (
        rich.get("action_resolution")
        if isinstance(rich.get("action_resolution"), dict)
        else {}
    )
    scene = ctx.get("active_scene") if isinstance(ctx.get("active_scene"), dict) else {}
    has_open_authored_route = any(
        isinstance(item, dict)
        and str(item.get("status") or "open") in {"open", "resume"}
        for item in (scene.get("affordances") or [])
    )
    if resolution and resolution.get("no_match") is True and has_open_authored_route:
        return {
            "scene_action": "CHOICE",
            "handoff": "narration",
            "rationale": (
                "KP semantic resolver found no current authored route; surface "
                "the public choices without inventing a clue or rolling"
            ),
        }
    if sig.get("low_agency_continue_count", 0) >= 2 and sig.get("scene_pressure_available", False):
        return {"scene_action": "PRESSURE", "handoff": "narration",
                "rationale": "repeated low-agency continuation yields initiative to authored scene pressure"}
    if sig["stalled_turns"] >= 3:
        return {"scene_action": "RECOVER", "handoff": "narration",
                "rationale": "3 stalled turns forces Idea Roll recovery valve"}
    return None


def select_action(ctx: dict[str, Any]) -> tuple[str, dict[str, float]]:
    """Three-layer scoring. Returns (chosen_action, scores_dict)."""
    overrides = apply_rule_signal_overrides(ctx)
    if overrides is not None:
        # Layer 3 hit — bypass scoring
        scores = {a: 0.0 for a in ACTIONS}
        scores[overrides["scene_action"]] = 1.0
        scores["_override"] = 1.0  # type: ignore
        return overrides["scene_action"], scores

    weights_cfg = _load_structure_weights()
    stype = ctx["structure_type"]
    weights = weights_cfg.get("weights", {}).get(stype, {})
    tiebreak = weights_cfg.get("tiebreak_order", ACTIONS)

    scores: dict[str, float] = {}
    for action in ACTIONS:
        base = _base_score(action, ctx)
        w = weights.get(action, 1.0)
        scores[action] = round(base * w, 4)

    # pick max; tiebreak by order
    max_score = max(scores.values()) if scores else 0.0
    if max_score <= 0.0:
        return "CHOICE", scores  # no-trigger default

    candidates = [a for a, s in scores.items() if s == max_score]
    if len(candidates) == 1:
        return candidates[0], scores
    for action in tiebreak:
        if action in candidates:
            return action, scores
    return candidates[0], scores


# =============================================================================
# Narrative redirection (SENNA / Narrative Adherence in LLM-driven Games)
# =============================================================================

_OFF_TRACK_INTENT_CLASSES = frozenset({"stuck", "ambiguous", "meta"})
_REDIRECTION_STRATEGIES = frozenset({
    "in_world_consequences",
    "npc_influence",
    "more_information",
})
_STALLED_REDIRECTION_THRESHOLD = 2


def redirection_should_trigger(
    *,
    intent_class: str,
    target_unmatched: bool = False,
    boundary_violation: dict[str, Any] | None = None,
    stalled_turns: int = 0,
) -> bool:
    """Pure predicate: emit redirection only on structured off-track signals.

    Normal on-track turns (e.g. investigate/move without unmatched target or
    boundary violation) return False. Never scans free-text player prose.
    """
    intent = str(intent_class or "").strip().lower()
    if intent in _OFF_TRACK_INTENT_CLASSES:
        return True
    if target_unmatched:
        return True
    if isinstance(boundary_violation, dict) and (
        boundary_violation.get("id") or boundary_violation.get("boundary_id")
    ):
        return True
    try:
        stalled = int(stalled_turns or 0)
    except (TypeError, ValueError):
        stalled = 0
    return stalled >= _STALLED_REDIRECTION_THRESHOLD


def _structured_boundary_violation(ctx: dict[str, Any]) -> dict[str, Any] | None:
    """Return a structured boundary violation with a consequence hint, if any."""
    rich = ctx.get("player_intent_rich") if isinstance(ctx.get("player_intent_rich"), dict) else {}
    candidates = [
        rich.get("boundary_violation") if isinstance(rich, dict) else None,
        ctx.get("boundary_violation"),
    ]
    for raw in candidates:
        if not isinstance(raw, dict):
            continue
        boundary_id = _text_or_none(raw.get("id") or raw.get("boundary_id"))
        hint = _text_or_none(raw.get("consequence_hint"))
        if boundary_id and hint:
            return {
                "id": boundary_id,
                "category": _text_or_none(raw.get("category")) or "improvisation_boundary",
                "consequence_hint": hint,
            }

    # Match structured violated_boundary_ids against scenario consequence_boundaries.
    violated_ids = rich.get("violated_boundary_ids") if isinstance(rich, dict) else None
    if not isinstance(violated_ids, list) or not violated_ids:
        return None
    boundaries = (ctx.get("improvisation_boundaries") or {}).get("consequence_boundaries") or []
    wanted = {str(v).strip() for v in violated_ids if str(v or "").strip()}
    for entry in boundaries:
        if not isinstance(entry, dict):
            continue
        eid = _text_or_none(entry.get("id") or entry.get("boundary_id"))
        hint = _text_or_none(entry.get("consequence_hint"))
        if eid and eid in wanted and hint:
            return {
                "id": eid,
                "category": _text_or_none(entry.get("category")) or "improvisation_boundary",
                "consequence_hint": hint,
            }
    return None


def _move_target_unmatched(ctx: dict[str, Any]) -> bool:
    """True when move intent names target_entities that fail structured matching."""
    if str(ctx.get("player_intent_class") or "").strip().lower() != "move":
        return False
    rich = ctx.get("player_intent_rich") if isinstance(ctx.get("player_intent_rich"), dict) else {}
    target_entities = rich.get("target_entities") if isinstance(rich, dict) else None
    if not isinstance(target_entities, list) or not any(str(t or "").strip() for t in target_entities):
        return False
    scene = ctx.get("active_scene") or {}
    story_graph = ctx.get("story_graph")
    world = ctx.get("world_state") or {}
    from_id = ctx.get("active_scene_id") or scene.get("scene_id")
    candidates = coc_scene_graph.transition_candidates(from_id, story_graph, world)
    if candidates:
        _chosen, matched = coc_scene_graph.rank_move_targets(
            candidates, story_graph, target_entities
        )
        return matched is None
    gated = coc_scene_graph.resolve_move_flag_commits(
        from_id, story_graph, world, target_entities
    )
    return gated is None


def _redirection_reason_code(
    *,
    intent_class: str,
    target_unmatched: bool,
    boundary_violation: dict[str, Any] | None,
    stalled_turns: int,
) -> str:
    if boundary_violation:
        return "boundary_violation"
    if target_unmatched:
        return "target_unmatched"
    intent = str(intent_class or "").strip().lower()
    if intent == "stuck":
        return "stuck_player"
    if intent == "ambiguous":
        return "ambiguous_intent"
    if intent == "meta":
        return "meta_intent"
    if int(stalled_turns or 0) >= _STALLED_REDIRECTION_THRESHOLD:
        return "stalled_turns"
    return "off_track"


def _scene_has_npc_presence(ctx: dict[str, Any], npc_moves: list[dict[str, Any]] | None = None) -> bool:
    if npc_moves:
        return True
    scene = ctx.get("active_scene") or {}
    npc_ids = scene.get("npc_ids") or []
    return bool(isinstance(npc_ids, list) and any(str(n or "").strip() for n in npc_ids))


def _first_scene_npc_grounding(ctx: dict[str, Any], npc_moves: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    for move in npc_moves or []:
        if not isinstance(move, dict):
            continue
        npc_id = _text_or_none(move.get("npc_id"))
        if not npc_id:
            continue
        return {
            "npc_id": npc_id,
            "display_name": _text_or_none(move.get("display_name") or move.get("name")) or npc_id,
        }
    scene = ctx.get("active_scene") or {}
    agendas = (ctx.get("npc_agendas") or {}).get("npcs") or []
    agenda_by_id = {
        str(n.get("npc_id")): n
        for n in agendas
        if isinstance(n, dict) and n.get("npc_id")
    }
    for raw_id in scene.get("npc_ids") or []:
        npc_id = _text_or_none(raw_id)
        if not npc_id:
            continue
        agenda = agenda_by_id.get(npc_id) or {}
        display = _text_or_none(agenda.get("name") or agenda.get("display_name")) or npc_id
        return {"npc_id": npc_id, "display_name": display}
    return {}


def _more_information_grounding(ctx: dict[str, Any]) -> dict[str, Any]:
    scene = ctx.get("active_scene") or {}
    grounding: dict[str, Any] = {}
    scene_id = _text_or_none(ctx.get("active_scene_id") or scene.get("scene_id"))
    if scene_id:
        grounding["scene_id"] = scene_id
    discovered = set((ctx.get("world_state") or {}).get("discovered_clue_ids") or [])
    for clue_id in scene.get("available_clues") or []:
        cid = _text_or_none(clue_id)
        if cid and cid not in discovered:
            grounding["clue_id"] = cid
            break
    return grounding


def build_redirection_block(
    ctx: dict[str, Any],
    *,
    npc_moves: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    """Select an explicit redirection strategy when off-track signals fire.

    Strategy priority mirrors the paper ranking (never hard_denial):
    1. in_world_consequences — boundary violation with consequence hint
    2. npc_influence — NPC present in the active scene
    3. more_information — environmental / knowledge cue
    """
    intent = str(ctx.get("player_intent_class") or "").strip().lower()
    boundary = _structured_boundary_violation(ctx)
    target_unmatched = _move_target_unmatched(ctx)
    stalled = int((ctx.get("rule_signals") or {}).get("stalled_turns", 0) or 0)
    if not redirection_should_trigger(
        intent_class=intent,
        target_unmatched=target_unmatched,
        boundary_violation=boundary,
        stalled_turns=stalled,
    ):
        return None

    reason_code = _redirection_reason_code(
        intent_class=intent,
        target_unmatched=target_unmatched,
        boundary_violation=boundary,
        stalled_turns=stalled,
    )

    if boundary:
        strategy = "in_world_consequences"
        grounding = {
            "boundary_id": boundary["id"],
            "category": boundary["category"],
            "consequence_hint": boundary["consequence_hint"],
        }
    elif _scene_has_npc_presence(ctx, npc_moves):
        strategy = "npc_influence"
        grounding = _first_scene_npc_grounding(ctx, npc_moves)
    else:
        strategy = "more_information"
        grounding = _more_information_grounding(ctx)

    assert strategy in _REDIRECTION_STRATEGIES
    return {
        "strategy": strategy,
        "reason_code": reason_code,
        "grounding": grounding,
    }


# =============================================================================
# DirectorPlan assembly
# =============================================================================

# Default time deltas (minutes) the director proposes per scene_action when the
# world-clock layer is present. These are conservative proposals that the
# apply layer will still validate/clamp against time-costs.json categories.
_ACTION_TIME_PROFILES: dict[str, dict[str, Any]] = {
    "REVEAL":   {"mode": "elapsed", "category": "single_room_search", "delta_minutes": 20},
    "DEEPEN":   {"mode": "elapsed", "category": "single_room_search", "delta_minutes": 15},
    "PRESSURE": {"mode": "instant", "category": None, "delta_minutes": 1},
    "CHARACTER":{"mode": "elapsed", "category": "speak_briefly",      "delta_minutes": 5},
    "CHOICE":   {"mode": "instant", "category": None, "delta_minutes": 1},
    "CUT":      {"mode": "elapsed", "category": "local_travel",       "delta_minutes": 30},
    "MONTAGE":  {"mode": "downtime","category": "short_rest",         "delta_minutes": 120},
    "SUBSYSTEM":{"mode": "instant", "category": None, "delta_minutes": 1},
    "RECOVER":  {"mode": "elapsed", "category": "investigation_recovery", "delta_minutes": 30},
    "PAYOFF":   {"mode": "instant", "category": None, "delta_minutes": 0},
}

_TIME_PROFILE_KEYS = frozenset({"mode", "category", "delta_minutes"})
_TIME_PROFILE_MODES = frozenset({
    "none", "instant", "elapsed", "until", "downtime", "subsystem",
})


def _time_cost_categories() -> dict[str, dict[str, Any]]:
    catalog = coc_cache.load_json_cached(RULES_DIR / "time-costs.json")
    categories = catalog.get("categories") if isinstance(catalog, dict) else None
    return categories if isinstance(categories, dict) else {}


def _validate_time_profile(
    value: Any,
) -> tuple[dict[str, Any] | None, str | None]:
    """Validate a structured time profile against the canonical catalog."""
    if value is None:
        return None, None
    if not isinstance(value, dict):
        return None, "profile_must_be_object"
    if set(value) - _TIME_PROFILE_KEYS:
        return None, "unsupported_profile_fields"

    category = value.get("category")
    categories = _time_cost_categories()
    if not isinstance(category, str) or category not in categories:
        return None, "category_not_in_time_cost_catalog"

    mode = value.get("mode")
    if mode is not None and mode not in _TIME_PROFILE_MODES:
        return None, "mode_not_in_time_profile_enum"

    delta = value.get("delta_minutes")
    if delta is not None:
        if isinstance(delta, bool) or not isinstance(delta, int):
            return None, "delta_minutes_must_be_integer"
        if delta < 0:
            return None, "delta_minutes_must_be_nonnegative"
        bounds = categories[category]
        if delta < int(bounds["min"]) or delta > int(bounds["max"]):
            return None, "delta_minutes_outside_category_bounds"

    normalized = {"category": category}
    if mode is not None:
        normalized["mode"] = mode
    if delta is not None:
        normalized["delta_minutes"] = delta
    return normalized, None


def _record_time_profile_warning(
    ctx: dict[str, Any],
    *,
    source: str,
    reason_code: str,
) -> None:
    warning = {
        "field": "time_profile",
        "source": source,
        "reason_code": reason_code,
    }
    warnings = ctx.setdefault("validation_warnings", [])
    if isinstance(warnings, list) and warning not in warnings:
        warnings.append(warning)


def _complete_time_profile(
    profile: dict[str, Any],
    *,
    fallback: dict[str, Any],
) -> dict[str, Any]:
    """Fill a structured time profile without interpreting free text."""
    completed = dict(fallback)
    completed.update(profile)
    category = completed.get("category")
    if "delta_minutes" not in profile and isinstance(category, str):
        bounds = _time_cost_categories().get(category)
        if isinstance(bounds, dict) and "default" in bounds:
            completed["delta_minutes"] = int(bounds["default"])
    return completed


def _structured_intent_time_category(ctx: dict[str, Any]) -> str | None:
    """Return an exact catalog category emitted by structured intent routing."""
    rich = ctx.get("player_intent_rich")
    if not isinstance(rich, dict):
        rich = {}
    categories = _time_cost_categories()
    for candidate in (
        ctx.get("intent_detail"),
        rich.get("intent_detail"),
    ):
        if isinstance(candidate, str) and candidate in categories:
            return candidate
    return None


def _matched_route_time_profile(ctx: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    """Return one unambiguous authored time profile from resolved route IDs.

    Route IDs are structured semantic-resolver output.  This lets an authored
    half-day research action own its exact elapsed-time cost without making all
    actions in the surrounding library scene (including travel) cost half a
    day.  Multiple matched routes must agree on the exact profile or the
    override fails closed.
    """
    scene = ctx.get("active_scene")
    rich = ctx.get("player_intent_rich")
    resolution = rich.get("action_resolution") if isinstance(rich, dict) else None
    if not isinstance(scene, dict) or not isinstance(resolution, dict):
        return None, None
    matched_ids = {
        str(value).strip()
        for value in (resolution.get("matched_affordance_ids") or [])
        if str(value or "").strip()
    }
    if not matched_ids:
        return None, None
    profiles: list[dict[str, Any]] = []
    for affordance in scene.get("affordances") or []:
        if not isinstance(affordance, dict):
            continue
        route_id = str(
            affordance.get("id") or affordance.get("route_id") or ""
        ).strip()
        if route_id not in matched_ids:
            continue
        if isinstance(affordance.get("authored_operation"), dict):
            profiles.append({"mode": "none"})
            continue
        if "time_profile" not in affordance:
            continue
        normalized, reason = _validate_time_profile(affordance.get("time_profile"))
        if normalized is None:
            return None, reason
        profiles.append(normalized)
    if not profiles:
        return None, None
    first = profiles[0]
    if any(profile != first for profile in profiles[1:]):
        return None, "matched_route_time_profiles_conflict"
    return first, None


def _time_profile_for_action(action: str, ctx: dict[str, Any]) -> dict[str, Any]:
    """Select an action's structured time profile in author-first priority.

    Priority is an authored matched-route ``time_profile``, an authored
    active-scene ``time_profile``, then an exact category enum from structured
    intent metadata, then the action default. Scene tags and player prose are
    never interpreted as intent.
    """
    fallback = dict(_ACTION_TIME_PROFILES.get(action, {"mode": "none"}))
    scene = ctx.get("active_scene")
    if not isinstance(scene, dict):
        scene = {}

    route_authored, route_reason = _matched_route_time_profile(ctx)
    if route_authored is not None:
        return _complete_time_profile(route_authored, fallback=fallback)
    if route_reason is not None:
        _record_time_profile_warning(
            ctx,
            source="matched_route",
            reason_code=route_reason,
        )

    authored, reason_code = _validate_time_profile(scene.get("time_profile"))
    if authored is not None:
        return _complete_time_profile(authored, fallback=fallback)
    if reason_code is not None:
        _record_time_profile_warning(
            ctx,
            source="director_context",
            reason_code=reason_code,
        )

    intent_category = _structured_intent_time_category(ctx)
    if intent_category is not None:
        return _complete_time_profile(
            {"mode": "elapsed", "category": intent_category},
            fallback=fallback,
        )

    return fallback


def _derive_time_advance(
    action: str,
    time_signals: dict[str, Any],
    *,
    ctx: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Derive a time_advance proposal for the DirectorPlan.

    Combines the action's default time profile with the live time_signals
    (e.g. escalate to downtime sleep when the investigator is exhausted, or
    suppress advancement for OOC-style actions). Falls back to mode=none when
    the time layer is absent (no time_signals).
    """
    if not time_signals:
        return {"mode": "none", "reason": "time layer not initialized"}

    profile = _time_profile_for_action(action, ctx or {})
    mode = profile.get("mode", "none")
    category = profile.get("category")
    delta = int(profile.get("delta_minutes", 0))
    confidence = 0.7
    reason = f"director proposal for {action}"

    # Exhaustion override: if the investigator has not rested in >18h and the
    # action is not already a recovery, propose a long downtime so the apply
    # layer can advance the clock through a sleep period (which fires healing
    # / sanity-day-reset triggers).
    hours_since_rest = float(time_signals.get("hours_since_last_rest", 0) or 0)
    if hours_since_rest > 18 and action not in ("RECOVER", "MONTAGE", "PAYOFF"):
        mode = "downtime"
        category = "sleep_night"
        delta = 480
        confidence = 0.85
        reason = f"exhausted ({hours_since_rest}h since last rest) → propose sleep"

    # High time-pressure: don't propose large jumps when a deadline is imminent.
    if time_signals.get("time_pressure") == "high" and mode == "downtime":
        mode = "elapsed"
        category = "quick_observation"
        delta = 5
        confidence = 0.6
        reason = "deadline imminent; minimal time advance"

    return {
        "mode": mode,
        "category": category,
        "delta_minutes": delta,
        "confidence": round(confidence, 2),
        "reason": reason,
    }




def _find_clue(clue_id: str, clue_graph: dict[str, Any]) -> dict[str, Any] | None:
    """Find a clue dict by id across all conclusions. Returns None if not found."""
    for concl in clue_graph.get("conclusions", []):
        for clue in concl.get("clues", []):
            if clue.get("clue_id") == clue_id:
                return clue
    return None


def _find_clue_conclusion(clue_id: str, clue_graph: dict[str, Any]) -> dict[str, Any] | None:
    for concl in clue_graph.get("conclusions", []):
        for clue in concl.get("clues", []):
            if clue.get("clue_id") == clue_id:
                return concl
    return None


def _clue_route_priority(clue_id: str | None, clue_graph: dict[str, Any]) -> float:
    """Read a clue's route_priority (default 0.5 if absent). Higher = more direct route."""
    if not clue_id:
        return 0.5
    clue = _find_clue(clue_id, clue_graph)
    if clue is None:
        return 0.5
    try:
        return float(clue.get("route_priority", 0.5))
    except (TypeError, ValueError):
        return 0.5


def _resolve_clue_delivery(clue_id: str | None, clue_graph: dict[str, Any]) -> tuple[str, str | None, str | None]:
    """Resolve a clue's delivery type + skill + difficulty from structured fields.

    Returns (clue_type, skill, difficulty):
    - clue_type: "obvious" | "obscured"
    - skill: skill name if clue_type is obscured via skill_check, else None
    - difficulty: "regular"|"hard"|"extreme" or None

    Only the structured ``delivery_kind`` field decides obvious vs obscured.
    Per the Semantic Matcher Constitution, the delivery prose is never scanned
    for skill-name keywords. A clue missing ``delivery_kind`` defaults to
    "obscured" (conservative — require a roll) and ``_select_clue_policy``
    records a delivery warning so the clue-graph can be migrated.
    """
    if not clue_id:
        return ("obscured", None, None)
    clue = _find_clue(clue_id, clue_graph)
    if clue is None:
        return ("obscured", None, None)
    delivery_kind = clue.get("delivery_kind")
    if delivery_kind:
        if delivery_kind == "skill_check":
            return ("obscured", clue.get("skill"), clue.get("difficulty", "regular"))
        # obvious, handout, npc_dialogue, environmental -> obvious
        return ("obvious", None, None)
    # No structured field: conservative default, no prose inference.
    return ("obscured", None, None)


_AFFORDANCE_SCORE_WEIGHT = 0.5  # per matched dimension (entities/verbs/skills)


def _select_clue_policy(ctx: dict[str, Any], action: str) -> dict[str, Any]:
    """Choose reveal/withhold/fallback/leads per clue-graph.

    Clue selection is priority-aware: clues carry an optional `route_priority`
    (0.0-1.0, higher = more direct/likely route, default 0.5). REVEAL/RECOVER
    pick the highest-priority eligible clue; CHOICE surfaces the top 2 leads
    so the narrator can offer them to an idle/ambiguous player.

    G1: when the router's structured intent matches an available clue's
    compile-time `affordance` block (entities/verbs/skills set intersection,
    computed by coc_rule_signals.match_clue_affordances — never prose), the
    match score feeds into the route_priority ranking so the earned clue wins
    REVEAL, and the winning match is attached as `matched_affordance` for the
    narrator to make the discovery feel earned.
    """
    scene = ctx.get("active_scene") or {}
    discovered = set(ctx["world_state"].get("discovered_clue_ids", []))
    available = _available_reveal_clues(ctx)
    secret_ids = coc_narration_contract.secret_ref_ids(
        ctx.get("improvisation_boundaries", {}).get("keeper_secrets", [])
    )
    clue_graph = ctx.get("clue_graph", {})

    affordance_hits = coc_rule_signals.match_clue_affordances(
        ctx.get("player_intent_rich"), clue_graph, available
    )
    hit_by_clue = {hit["clue_id"]: hit for hit in affordance_hits}
    rich = ctx.get("player_intent_rich") if isinstance(ctx.get("player_intent_rich"), dict) else {}
    resolution = rich.get("action_resolution") if isinstance(rich.get("action_resolution"), dict) else {}
    matched_affordance_ids = {
        str(item) for item in (resolution.get("matched_affordance_ids") or []) if item
    }
    # Once the shared KP resolver is in the loop, authored public routes are a
    # closed set.  A miss (including a fail-closed unresolved receipt) must not
    # fall back to the scene's highest-priority clue: that would narrate and
    # roll for knowledge the player did not actually pursue, while the apply
    # layer may correctly refuse to persist it.  Hosts that supply reviewed
    # structured intent without an action_resolution keep the legacy semantic
    # affordance path for compatibility.
    has_authored_affordances = any(
        isinstance(item, dict)
        and str(item.get("status") or "open") in {"open", "resume"}
        for item in (scene.get("affordances") or [])
    )
    resolution_is_authoritative = bool(resolution) and has_authored_affordances
    # Exact authored route grants outrank conclusion-sufficiency pruning.  A
    # conclusion may already have enough evidence while a concrete handoff
    # item is still unknown and required by a later structured gate.
    resolved_clue_ids = _authoritative_route_clue_ids(ctx)
    def _rank_score(cid: str) -> float:
        boost = _AFFORDANCE_SCORE_WEIGHT * (hit_by_clue.get(cid) or {}).get("score", 0)
        return _clue_route_priority(cid, clue_graph) + boost

    # REVEAL: an authoritative public route may reveal only its explicitly
    # authored clue_id/grants_clue_ids.  Scene-wide clue-affordance similarity
    # is not a route binding: shared skills such as Spot Hidden can match an
    # unrelated clue and prematurely unlock another scene.  Unbound authored
    # routes therefore fail closed.  Hosts without an authoritative route keep
    # the legacy structured clue-affordance ranking below.
    if resolved_clue_ids:
        reveal = resolved_clue_ids
    elif action == "REVEAL" and available and not resolution_is_authoritative:
        ranked = sorted(available, key=_rank_score, reverse=True)
        reveal = [ranked[0]]
    else:
        reveal = []

    delivery_warnings: list[dict[str, Any]] = []

    # Resolve obvious vs obscured (+ skill/difficulty) from the first revealed
    # clue's structured delivery_kind. Clues without delivery_kind default to
    # obscured (no prose inference — Semantic Matcher Constitution) and emit a
    # delivery warning so the clue-graph can be migrated. This gates whether
    # _build_rules_requests emits a skill check (and which skill/difficulty).
    _clue_type, _clue_skill, _clue_diff = _resolve_clue_delivery(
        reveal[0] if reveal else None, clue_graph)
    selected_clue_id = reveal[0] if reveal else None
    if selected_clue_id:
        selected_clue = _find_clue(selected_clue_id, clue_graph)
        selected_conclusion = _find_clue_conclusion(selected_clue_id, clue_graph)
        if selected_clue is not None and not selected_clue.get("delivery_kind"):
            is_critical = (
                isinstance(selected_conclusion, dict)
                and str(selected_conclusion.get("importance") or "").lower() == "critical"
            )
            reason = (
                f"legacy delivery without delivery_kind for critical clue {selected_clue_id}; "
                "defaulted to obscured"
                if is_critical
                else f"clue {selected_clue_id} missing delivery_kind; defaulted to obscured"
            )
            delivery_warnings.append({
                "clue_id": selected_clue_id,
                "reason": reason,
                "fallback_mode": "conservative_obscured_default",
            })

    # fallback: if stalled (RECOVER), pull the highest-priority not-yet-found route.
    fallback = []
    if action == "RECOVER":
        for concl in clue_graph.get("conclusions", []):
            not_found = [c["clue_id"] for c in concl.get("clues", []) if c["clue_id"] not in discovered]
            if not_found:
                not_found_ranked = sorted(not_found, key=lambda cid: _clue_route_priority(cid, clue_graph), reverse=True)
                fallback.append(not_found_ranked[0])
                break

    # leads: for CHOICE (idle/ambiguous intent with ≥2 clues), surface the top 2
    # routes ranked by priority so the narrator can offer them to the player.
    leads: list[str] = []
    if action == "CHOICE":
        ranked = sorted(available, key=lambda cid: _clue_route_priority(cid, clue_graph), reverse=True)
        leads = ranked[:2]

    policy = {"reveal": reveal, "withhold": list(secret_ids), "fallback_routes": fallback,
              "clue_type": _clue_type, "skill": _clue_skill, "difficulty": _clue_diff,
              "leads": leads, "delivery_warnings": delivery_warnings}
    if selected_clue_id and isinstance(selected_clue, dict):
        policy["delivery_kind"] = selected_clue.get("delivery_kind")
        policy["source_npc_ids"] = [
            str(npc_id) for npc_id in (selected_clue.get("source_npc_ids") or [])
            if isinstance(npc_id, str) and npc_id.strip()
        ]
    # G1: attach the winning affordance match so the narrator can make the
    # discovery feel earned (structured entities/verbs/skills only, no prose).
    if selected_clue_id and selected_clue_id in hit_by_clue:
        policy["matched_affordance"] = hit_by_clue[selected_clue_id]
    if matched_affordance_ids:
        policy["matched_route_ids"] = sorted(matched_affordance_ids)
    # Optional non-gating bonus block. Runtime repeats the compiler's
    # provenance/fumble-safety gate because hydrated or legacy scenario data
    # may reach play without a fresh compile.
    bonus_source_id = selected_clue_id
    if not bonus_source_id and action == "RECOVER" and fallback:
        bonus_source_id = fallback[0]
    if bonus_source_id:
        bonus_clue = _find_clue(bonus_source_id, clue_graph)
        bonus = (bonus_clue or {}).get("bonus") if isinstance(bonus_clue, dict) else None
        projected_bonus = _project_clue_bonus_contract(bonus)
        if projected_bonus is not None:
            policy["bonus"] = projected_bonus
    return policy


def _typed_fumble_effect(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    kind = value.get("kind")
    if kind == "fictional_position":
        return set(value) in ({"kind"}, {"kind", "severity"}) and (
            "severity" not in value
            or value.get("severity") in {"minor", "serious", "critical"}
        )
    if kind == "pressure_tick":
        return (
            set(value) == {"kind", "clock_id", "ticks"}
            and isinstance(value.get("clock_id"), str)
            and bool(value["clock_id"].strip())
            and isinstance(value.get("ticks"), int)
            and not isinstance(value.get("ticks"), bool)
            and 1 <= value["ticks"] <= 4
        )
    if kind == "condition":
        return (
            set(value) == {"kind", "condition_id"}
            and isinstance(value.get("condition_id"), str)
            and bool(value["condition_id"].strip())
        )
    if kind == "route_closed":
        return (
            set(value) == {"kind", "route_id"}
            and isinstance(value.get("route_id"), str)
            and bool(value["route_id"].strip())
        )
    return False


def _project_clue_bonus_contract(value: Any) -> dict[str, Any] | None:
    """Return only a versioned, provenance-bound, fumble-safe bonus."""
    if not isinstance(value, dict) or value.get("schema_version") != 1:
        return None
    origin = value.get("origin")
    if origin not in {"source", "inferred", "improvised"}:
        return None
    if origin == "source":
        refs = value.get("source_refs")
        if not isinstance(refs, list) or not refs or any(
            not isinstance(ref, dict)
            or not (
                bool(ref.get("path")) and isinstance(ref.get("page"), int)
                or bool(ref.get("source_id")) and (
                    isinstance(ref.get("printed_page"), int)
                    or isinstance(ref.get("pdf_index"), int)
                )
            )
            for ref in refs
        ):
            return None
    skill = value.get("skill")
    extra = value.get("extra_summary")
    difficulty = value.get("difficulty", "regular")
    on_fail = value.get("on_fail_cost", "time")
    fumble = value.get("fumble_consequence")
    if (
        not isinstance(skill, str) or not skill.strip()
        or not isinstance(extra, str) or not extra.strip()
        or difficulty not in {"regular", "hard", "extreme"}
        or on_fail not in {"time", "pressure"}
        or not isinstance(fumble, dict)
        or set(fumble) != {"summary", "effect"}
        or not isinstance(fumble.get("summary"), str)
        or not fumble["summary"].strip()
        or not _typed_fumble_effect(fumble.get("effect"))
    ):
        return None
    projected = {
        "schema_version": 1,
        "origin": origin,
        "skill": skill.strip(),
        "difficulty": difficulty,
        "extra_summary": extra.strip(),
        "on_fail_cost": on_fail,
        "fumble_consequence": json.loads(json.dumps(fumble)),
    }
    if isinstance(value.get("source_refs"), list):
        projected["source_refs"] = json.loads(json.dumps(value["source_refs"]))
    return projected


def _clue_bonus_eligible(ctx: dict[str, Any], clue_policy: dict[str, Any] | None) -> bool:
    """Offer a non-gating bonus roll on investigate intent or affordance skill hit."""
    if (
        not isinstance(clue_policy, dict)
        or _project_clue_bonus_contract(clue_policy.get("bonus")) is None
    ):
        return False
    intent = str(ctx.get("player_intent_class") or "").strip().lower()
    if intent == "investigate":
        return True
    matched = clue_policy.get("matched_affordance") or {}
    matched_skills = set()
    if isinstance(matched, dict):
        matched_skills = {
            str(s).strip().lower()
            for s in ((matched.get("matched") or {}).get("skills") or [])
            if s
        }
    bonus_skill = str((clue_policy.get("bonus") or {}).get("skill") or "").strip().lower()
    return bool(bonus_skill and bonus_skill in matched_skills)


def _localized_clue_summary(clue: dict[str, Any], language: str) -> str:
    localized = clue.get("localized_text")
    language_keys = [str(language or "").strip()]
    if "-" in language_keys[0]:
        language_keys.append(language_keys[0].split("-", 1)[0])
    if isinstance(localized, dict):
        for key in language_keys:
            row = localized.get(key)
            if isinstance(row, str) and row.strip():
                return row.strip()
            if isinstance(row, dict):
                for field in ("player_safe_summary", "summary", "text"):
                    value = row.get(field)
                    if isinstance(value, str) and value.strip():
                        return value.strip()
    return str(
        clue.get("player_safe_summary") or clue.get("player_visible_anchor") or ""
    ).strip()


def _collect_anchors(
    clue_ids: list[str], clue_graph: dict[str, Any], language: str = "zh-Hans"
) -> list[str]:
    """Collect player-visible anchor strings for given clue ids from clue-graph.
    Used to populate narrative_directives.must_include so the narrator knows
    what concrete visible detail a REVEAL must surface.

    Reads the structured `player_safe_summary` field (preferred) and falls back
    to the legacy `player_visible_anchor` field for old clue-graphs.
    """
    anchors: list[str] = []
    for concl in clue_graph.get("conclusions", []):
        for clue in concl.get("clues", []):
            if clue.get("clue_id") in clue_ids:
                anchor = _localized_clue_summary(clue, language)
                if anchor:
                    anchors.append(anchor)
    return anchors


VALID_HORROR_STAGES = {"ordinary", "wrongness", "pattern", "revelation"}


def _current_pacing_entry(ctx: dict[str, Any]) -> dict[str, Any]:
    """Find the pacing-map entry for the active scene. Returns {} if none."""
    active_scene_id = ctx.get("active_scene_id")
    if not active_scene_id:
        return {}
    for entry in ctx.get("pacing_map", {}).get("pacing_curve", []):
        if entry.get("scene_id") == active_scene_id:
            return entry
    return {}


def _retrieve_memory_for_ctx(ctx: dict[str, Any]) -> list[dict[str, Any]]:
    """Retrieve memory cards matching the current scene/intent. Returns [] if no memory layer."""
    if coc_memory is None:
        return []
    campaign_dir = ctx.get("campaign_dir")
    if campaign_dir is None:
        return []
    # query terms: explicit overrides first, else derive from scene + intent
    entities = ctx.get("memory_query_entities") or _derive_memory_entities(ctx)
    cues = ctx.get("memory_query_cues") or [ctx.get("player_intent", "")]
    tags = ctx.get("memory_query_tags") or []
    # Rich-intent enrichment: the player's explicit target entities sharpen
    # memory recall (e.g. "the neighbor" surfaces neighbor-related cards).
    # No-op when rich intent is absent.
    rich = ctx.get("player_intent_rich")
    if rich and not ctx.get("memory_query_entities"):
        for ent in rich.get("target_entities") or []:
            if ent and ent not in entities:
                entities.append(ent)
    cards = coc_memory.retrieve_memory_cards(
        campaign_dir=Path(campaign_dir),
        query_entities=[e for e in entities if e],
        query_cues=[c for c in cues if c],
        query_tags=tags,
        privacy_filter="player_safe",
        limit=5,
    )
    return cards


def _derive_memory_entities(ctx: dict[str, Any]) -> list[str]:
    """Default memory query: active scene id + npc ids + available clue ids."""
    scene = ctx.get("active_scene") or {}
    ents = [ctx.get("active_scene_id", "")]
    ents += scene.get("npc_ids", [])
    ents += scene.get("available_clues", [])
    return [e for e in ents if e]


def _disposition_to_tone(disposition: str) -> str:
    return {"helpful": "warm and cooperative",
            "neutral": "guarded but civil",
            "hostile": "cold and suspicious"}.get(disposition, "neutral")


def _stance_to_tone(stance: str) -> str:
    """G3: persisted psych stance -> narrator emotional tone (structured map)."""
    return {"hostile": "cold and suspicious",
            "wary": "guarded but civil",
            "neutral": "guarded but civil",
            "warm": "warm and cooperative"}.get(stance, "guarded but civil")


def _npc_is_forced_adversary(agenda: dict[str, Any]) -> bool:
    # Only trust structured/semantic fields produced upstream. Do not infer
    # hostility from free-text agenda wording here; that belongs in semantic
    # compilation, not keyword scans inside the deterministic director.
    relation = str(agenda.get("relationship_to_investigators") or "").lower()
    if relation in {"adversary", "enemy", "hostile", "monster", "danger"}:
        return True
    if agenda.get("hostile_by_default") is True:
        return True
    return False


def _npc_default_tone(agenda: dict[str, Any]) -> str:
    if _npc_is_forced_adversary(agenda):
        if agenda.get("fear"):
            return "panicked and hostile"
        return "hostile"
    return "neutral"


def _should_roll_npc_reaction(action: str, agenda: dict[str, Any]) -> bool:
    if action != "CHARACTER":
        return False
    return not _npc_is_forced_adversary(agenda)


def _build_npc_moves(ctx: dict[str, Any], action: str) -> list[dict[str, Any]]:
    """Activate NPCs in scene with agenda + disposition from rule signal."""
    scene = ctx.get("active_scene") or {}
    agendas = ctx.get("npc_agendas", {}).get("npcs", [])
    seed_parts = [
        (ctx.get("world_state") or {}).get("campaign_id", "campaign"),
        ctx.get("active_scene_id") or scene.get("scene_id") or "scene",
        ctx.get("turn_number", 0),
    ]
    agency_bundle = coc_npc_persona.build_scene_npc_agency(
        scene,
        {"npcs": agendas},
        ctx.get("npc_state", {}),
        seed_parts=seed_parts,
        player_intent_rich=ctx.get("player_intent_rich"),
    )
    ctx["npc_state_writes"] = agency_bundle.get("npc_state_writes", [])
    agency_by_npc = agency_bundle.get("by_npc", {})
    psych = (ctx.get("npc_state") or {}).get("psych") or {}
    moves = []
    for npc_id in scene.get("npc_ids", []):
        agenda = next((n for n in agendas if n["npc_id"] == npc_id), None)
        if not agenda:
            continue
        # G3: persisted psychological state (trust/fear/suspicion accumulated
        # across turns) drives disposition ahead of a fresh per-turn reaction
        # roll — structured numeric thresholds only, never agenda prose. Forced
        # adversaries (structured relationship field) stay on the legacy path.
        psych_entry = psych.get(npc_id) if isinstance(psych, dict) else None
        disposition = None
        if (
            not _npc_is_forced_adversary(agenda)
            and coc_npc_state.has_signal(psych_entry)
        ):
            disposition = coc_npc_state.npc_disposition(psych_entry)
        reaction = coc_rule_signals.roll_npc_reaction(
            app=ctx["rule_signals"].get("app", 50),
            credit_rating=ctx["rule_signals"].get("credit_rating", 50),
            rng=ctx["rng"],
        ) if disposition is None and _should_roll_npc_reaction(action, agenda) else None
        if reaction is not None and ctx["rule_signals"].get("npc_reaction_roll") is None:
            # Hold the FIRST rolled NPC reaction on the shared rule_signal so the
            # emitted plan reflects at least one reaction (generate_director_plan
            # copies rule_signals verbatim). Per-NPC rolls still live in npc_moves.
            ctx["rule_signals"]["npc_reaction_roll"] = reaction
        # B1: never interpolate secret prose into the plan (Chinese secrets have
        # no spaces, so split()[:3] used to leak the full text to narration).
        has_secret = bool(
            agenda.get("secret_id")
            or (isinstance(agenda.get("secret"), str) and agenda.get("secret").strip())
            or agenda.get("secret")
        )
        if disposition is not None:
            emotional_tone = _stance_to_tone(disposition["stance"])
            disposition_source = "npc_state:psych"
        elif reaction is not None:
            emotional_tone = _disposition_to_tone(reaction["disposition"])
            disposition_source = "rule_signal:npc_reaction_roll"
        else:
            emotional_tone = _npc_default_tone(agenda)
            disposition_source = None
        persona_card = (agency_by_npc.get(npc_id) or {}).get("persona_card") or {}
        name_rec = persona_card.get("name")
        persona_name = (
            name_rec.get("value")
            if isinstance(name_rec, dict)
            else (name_rec if isinstance(name_rec, str) else None)
        )
        display_name = (
            agenda.get("name")
            or agenda.get("display_name")
            or persona_name
            or npc_id
        )
        move: dict[str, Any] = {
            "npc_id": npc_id,
            "display_name": display_name,
            "agenda": agenda.get("agenda", ""),
            "emotional_tone": emotional_tone,
            "has_secret": has_secret,
            "secret_limit": "do not reveal this NPC's secret" if has_secret else "",
            "disposition_source": disposition_source,
            "psych_stance": disposition["stance"] if disposition else None,
            "relationship_to_investigators": agenda.get("relationship_to_investigators"),
            "social_role": persona_card.get("social_role"),
            "persona": persona_card.get("persona"),
            "agency_moves": (agency_by_npc.get(npc_id) or {}).get("agency_moves", []),
        }
        # Player-safe demeanor hint for narrator dialogue seeds (not secret prose).
        voice = agenda.get("voice")
        if isinstance(voice, str) and voice.strip():
            move["voice"] = voice.strip()
        foreign = agenda.get("foreign_dialogue")
        if isinstance(foreign, dict):
            sample = foreign.get("sample_line")
            if isinstance(sample, str) and sample.strip():
                move["dialogue_seed"] = sample.strip()
        if disposition is not None:
            move["stance_drivers"] = disposition["drivers"]
        secret_id = agenda.get("secret_id")
        if secret_id:
            move["secret_id"] = secret_id
        moves.append(move)
    return coc_keeper_planner.apply_npc_ruling(
        moves, coc_keeper_planner.proposal_from_context(ctx)
    )


def _personal_horror_directive(ctx: dict[str, Any], action: str) -> dict[str, Any] | None:
    """W1-2 (p.193-194): pick a personal-horror hook for the narrator.

    CHARACTER beats weave the first unwoven hook into the scene; PAYOFF beats
    echo an already-woven hook as a callback. Hooks are structured records on
    investigator-state — no backstory prose is scanned here.
    """
    hooks = [h for h in (ctx.get("personal_horror_hooks") or []) if isinstance(h, dict)]
    if not hooks:
        return None
    if action == "CHARACTER":
        pick = next((h for h in hooks if not h.get("woven")), None)
        use = "weave"
    elif action == "PAYOFF":
        pick = next((h for h in hooks if h.get("woven")), None)
        use = "echo"
    else:
        return None
    if pick is None:
        return None
    return {
        "hook_id": pick.get("hook_id"),
        "backstory_field": pick.get("backstory_field"),
        "summary": pick.get("summary", ""),
        "use": use,
    }


def _delusion_directive(ctx: dict[str, Any], action: str) -> dict[str, Any] | None:
    """W1-3 (p.162-163): seed a subtle delusion during the underlying phase.

    Only fires on DEEPEN/PRESSURE while the investigator is insane and no bout
    is active. Prefers a woven personal-horror hook as the structured anchor;
    never scans free-text prose (Semantic Matcher Constitution).
    """
    if action not in ("DEEPEN", "PRESSURE"):
        return None
    sig = ctx.get("rule_signals") or {}
    if sig.get("bout_active"):
        return None
    engine = ctx.get("sanity_engine_state") or {}
    underlying = bool(
        sig.get("indefinite_insane")
        or engine.get("temporary_insane")
        or sig.get("temporary_insane")
    )
    if not underlying:
        return None
    hooks = [h for h in (ctx.get("personal_horror_hooks") or []) if isinstance(h, dict)]
    if not hooks:
        return None
    pick = next((h for h in hooks if h.get("woven")), None) or hooks[0]
    return {
        "hook_id": pick.get("hook_id"),
        "backstory_field": pick.get("backstory_field"),
        "summary": pick.get("summary", ""),
        "instruction": (
            "During the underlying-insanity phase you may weave one subtle "
            "false sensory detail tied to this personal-horror hook. Narrate "
            "it as if real; never confirm to the player which details are false. "
            "If the player declares suspicion, run SanitySession.reality_check()."
        ),
    }


# W1-5 (p.207-211): early-stage scare craft prefers expectation-break tropes.
_EARLY_HORROR_TROPE_IDS = ("mundane_expectation_break", "cognitive_dissonance")
_EARLY_HORROR_TROPE_MULTIPLIER = 2.5


def _early_horror_trope_boosts(horror_stage: str, action: str) -> dict[str, float] | None:
    """Boost early-horror tropes on PRESSURE/DEEPEN before revelation.

    Consumed by coc_storylets._score_storylet via narrative_directives.
    """
    if horror_stage not in ("ordinary", "wrongness"):
        return None
    if action not in ("PRESSURE", "DEEPEN"):
        return None
    return {trope: _EARLY_HORROR_TROPE_MULTIPLIER for trope in _EARLY_HORROR_TROPE_IDS}


def _load_monsters_table() -> dict[str, Any]:
    path = RULES_DIR / "monsters.json"
    if not path.exists():
        return {}
    data = coc_cache.load_json_cached(path)
    monsters = data.get("monsters") if isinstance(data, dict) else {}
    return monsters if isinstance(monsters, dict) else {}


def _structured_monster_ids(ctx: dict[str, Any]) -> list[str]:
    """Collect monster ids from structured scene / threat-front fields only."""
    found: list[str] = []
    seen: set[str] = set()

    def _add(value: Any) -> None:
        if isinstance(value, str) and value.strip() and value not in seen:
            seen.add(value)
            found.append(value)
        elif isinstance(value, list):
            for item in value:
                _add(item)

    scene = ctx.get("active_scene") or {}
    for key in ("monster_ids", "monster_id"):
        _add(scene.get(key))

    fronts = (ctx.get("threat_fronts") or {}).get("fronts") or []
    for front in fronts:
        if not isinstance(front, dict):
            continue
        for key in ("monster_ids", "monster_id"):
            _add(front.get(key))
        for clock in _as_list(front.get("clocks")):
            if isinstance(clock, dict):
                for key in ("monster_ids", "monster_id"):
                    _add(clock.get(key))
    return found


def _mythos_presentation_directive(ctx: dict[str, Any], action: str) -> dict[str, Any] | None:
    """W1-5 (p.280-282): inject monster presentation contract for the narrator.

    Looks up a structured monster id on the active scene or threat fronts and
    samples sensory_signature from monsters.json. Never scans free-text names.
    """
    del action  # available for future action gating; presentation is stage-driven
    monster_ids = _structured_monster_ids(ctx)
    if not monster_ids:
        return None
    monsters = _load_monsters_table()
    monster_id = next((mid for mid in monster_ids if mid in monsters), None)
    if monster_id is None:
        return None
    presentation = (monsters.get(monster_id) or {}).get("presentation") or {}
    if not isinstance(presentation, dict):
        return None
    signature = [s for s in _as_list(presentation.get("sensory_signature")) if isinstance(s, str) and s.strip()]
    if not signature:
        return None
    rng = ctx.get("rng") or random.Random()
    sample_n = min(2, len(signature))
    sample = rng.sample(signature, sample_n) if sample_n else []
    pacing_entry = _current_pacing_entry(ctx)
    raw_horror = pacing_entry.get("horror_stage", "wrongness")
    horror_stage = raw_horror if raw_horror in VALID_HORROR_STAGES else "wrongness"
    return {
        "monster_id": monster_id,
        "never_name_until": presentation.get("never_name_until", "revelation"),
        "sensory_signature_sample": sample,
        "horror_stage": horror_stage,
    }


def _build_scene_pressure_move(ctx: dict[str, Any]) -> dict[str, Any] | None:
    scene = ctx.get("active_scene") or {}
    pressure_moves = [move for move in _as_list(scene.get("pressure_moves")) if move]
    if not pressure_moves:
        return None
    count = max(1, int((ctx.get("rule_signals") or {}).get("low_agency_continue_count", 1) or 1))
    pressure_index = min(count - 1, len(pressure_moves) - 1)
    raw = pressure_moves[pressure_index]
    scene_id = str(ctx.get("active_scene_id") or scene.get("scene_id") or "")
    grounding_receipt = {
        "schema_version": 1,
        "status": "authorized",
        "source": "active_scene.pressure_moves",
        "active_scene_id": scene_id,
        "pressure_move_index": pressure_index,
        "rule": (
            "Narrate only this authored active-scene consequence; do not add "
            "a threat symptom, object, route, or location from another source."
        ),
    }
    if isinstance(raw, dict):
        symptom = (
            raw.get("visible_symptom")
            or raw.get("cue")
            or raw.get("text")
            or raw.get("summary")
            or raw.get("move")
            or "the scene's pressure comes due"
        )
        tick = raw.get("tick", 0)
        try:
            tick = int(tick or 0)
        except (TypeError, ValueError):
            tick = 0
        move = {
            "clock_id": raw.get("clock_id"),
            "tick": tick,
            "visible_symptom": _short_text(symptom, 140),
            "reason": "low_agency_scene_pressure",
            "source": "active_scene.pressure_moves",
            "pressure_move_id": raw.get("id"),
            "grounding_receipt": grounding_receipt,
        }
        # Optional structured lethal flag (schema: pressure_moves[].lethal).
        if raw.get("lethal") is True:
            move["lethal"] = True
        return move
    return {
        "clock_id": None,
        "tick": 0,
        "visible_symptom": _short_text(raw, 140),
        "reason": "low_agency_scene_pressure",
        "source": "active_scene.pressure_moves",
        "grounding_receipt": grounding_receipt,
    }


def _collect_lethal_evidence(
    ctx: dict[str, Any],
    pressure_moves: list[dict[str, Any]],
    rules_requests: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Structured lethal evidence only — no free-text scanning (p.209).

    Sources: pressure_moves with ``lethal: true``, threat dangers with
    ``lethal: true``, and danger attack profiles / rules_requests carrying
    a positive ``lethality`` rating or ``lethal: true``.
    """
    evidence: list[dict[str, Any]] = []
    for move in pressure_moves or []:
        if isinstance(move, dict) and move.get("lethal") is True:
            evidence.append({"kind": "pressure_move", "ref": move})
    for front in (ctx.get("threat_fronts") or {}).get("fronts", []) or []:
        if not isinstance(front, dict):
            continue
        for danger in front.get("dangers") or []:
            if not isinstance(danger, dict):
                continue
            if danger.get("lethal") is True:
                evidence.append({"kind": "danger", "ref": danger})
            for profile in danger.get("attack_profiles") or []:
                if not isinstance(profile, dict):
                    continue
                lethality = profile.get("lethality")
                if profile.get("lethal") is True or (
                    isinstance(lethality, (int, float)) and lethality > 0
                ):
                    evidence.append({
                        "kind": "danger_attack",
                        "danger_id": danger.get("id"),
                        "ref": profile,
                    })
    for req in rules_requests or []:
        if not isinstance(req, dict):
            continue
        lethality = req.get("lethality")
        if req.get("lethal") is True or (
            isinstance(lethality, (int, float)) and lethality > 0
        ):
            evidence.append({"kind": "rules_request", "ref": req})
    return evidence


def _apply_fair_warning_ladder(
    ctx: dict[str, Any],
    pressure_moves: list[dict[str, Any]],
    rules_requests: list[dict[str, Any]],
    narrative_directives: dict[str, Any],
) -> list[dict[str, Any]]:
    """Layer-3 fair-warning: downgrade lethal outcomes while used < 3 (p.209).

    When ``lethal_chances_used < 3`` and structured lethal evidence is present,
    strip/downgrade lethal flags on pressure_moves and rules_requests and attach
    ``narrative_directives["fair_warning"] = {warning_number, remaining}``.
    At ``>= 3`` (``death_allowed``), lethal outcomes pass through unchanged.
    """
    tclock = (ctx.get("rule_signals") or {}).get("tension_clock") or {}
    used = int(tclock.get("lethal_chances_used", 0) or 0)
    if used >= 3 or tclock.get("death_allowed") is True:
        return pressure_moves

    evidence = _collect_lethal_evidence(ctx, pressure_moves, rules_requests)
    if not evidence:
        return pressure_moves

    narrative_directives["fair_warning"] = {
        "warning_number": used + 1,
        "remaining": max(0, 3 - used - 1),
        "rule_ref": "core.pacing.fair_warning",
    }

    downgraded: list[dict[str, Any]] = []
    for move in pressure_moves or []:
        if not isinstance(move, dict):
            downgraded.append(move)
            continue
        if move.get("lethal") is True:
            m = dict(move)
            m["lethal"] = False
            m["lethal_downgraded"] = True
            m["fair_warning"] = True
            downgraded.append(m)
        else:
            downgraded.append(move)

    for req in rules_requests or []:
        if not isinstance(req, dict):
            continue
        lethality = req.get("lethality")
        if req.get("lethal") is True or (
            isinstance(lethality, (int, float)) and lethality > 0
        ):
            req["lethal"] = False
            req["lethal_downgraded"] = True
            req["fair_warning"] = True
            # Preserve original rating for narration; zero out active lethality.
            if "lethality" in req and req.get("lethality_deferred") is None:
                req["lethality_deferred"] = req.get("lethality")
            req["lethality"] = None

    return downgraded


def _build_pressure_moves(ctx: dict[str, Any], action: str) -> list[dict[str, Any]]:
    """Tick clocks when PRESSURE or stalled."""
    moves = []
    if action not in ("PRESSURE", "RECOVER") and ctx["rule_signals"]["stalled_turns"] < 1:
        return moves
    if (
        action == "PRESSURE"
        and ctx["rule_signals"].get("low_agency_continue_count", 0) >= 2
        and _scene_pressure_available(ctx)
    ):
        scene_move = _build_scene_pressure_move(ctx)
        if scene_move is not None:
            return [scene_move]
    scene = ctx.get("active_scene") or {}
    scene_id = str(ctx.get("active_scene_id") or scene.get("scene_id") or "")
    scene_tags = {str(value) for value in scene.get("scene_tags", []) if value}
    scene_factions = {str(value) for value in scene.get("faction_ids", []) if value}
    scene_front_ids = set(scene.get("threat_front_ids") or [])
    scene_clock_ids = {
        str(item.get("clock_id"))
        for item in ((scene.get("on_enter") or {}).get("clock_ticks") or [])
        if isinstance(item, dict) and item.get("clock_id")
    }
    scene_danger_ids = {
        str(item.get("danger_id"))
        for item in ((scene.get("on_enter") or {}).get("danger_attacks") or [])
        if isinstance(item, dict) and item.get("danger_id")
    }
    candidates: list[tuple[Any, ...]] = []
    for front_index, front in enumerate(ctx.get("threat_fronts", {}).get("fronts", [])):
        if not isinstance(front, dict):
            continue
        front_id = str(front.get("front_id") or "")
        front_danger_ids = {
            str(item.get("id"))
            for item in front.get("dangers", []) or []
            if isinstance(item, dict) and item.get("id")
        }
        front_severity = front.get("severity", 0)
        front_severity = front_severity if isinstance(front_severity, int) and not isinstance(front_severity, bool) else 0
        for clock_index, clock in enumerate(front.get("clocks", [])):
            if not isinstance(clock, dict):
                continue
            current = _clock_segments(clock, "current_segments", 0)
            if current >= _clock_segments(clock, "segments", 6):
                continue
            severity_raw = clock.get("severity", front_severity)
            severity = severity_raw if isinstance(severity_raw, int) and not isinstance(severity_raw, bool) else front_severity
            scene_ids = {
                str(value) for value in
                [*(front.get("scene_ids") or []), *(clock.get("scene_ids") or [])]
                if value
            }
            tags = {
                str(value) for value in
                [*(front.get("scene_tags_any") or []), *(clock.get("scene_tags_any") or [])]
                if value
            }
            factions = {
                str(value) for value in
                [*(front.get("faction_ids") or []), *(clock.get("faction_ids") or [])]
                if value
            }
            clock_id = str(clock.get("clock_id") or "")
            if clock_id and clock_id in scene_clock_ids:
                affinity_kind, matched, affinity_rank = "scene_clock_refs", [clock_id], 6
            elif scene_danger_ids & front_danger_ids:
                affinity_kind, matched, affinity_rank = (
                    "danger_ids", sorted(scene_danger_ids & front_danger_ids), 5
                )
            elif scene_id and scene_id in scene_ids:
                affinity_kind, matched, affinity_rank = "scene_ids", [scene_id], 4
            elif front_id and front_id in scene_front_ids:
                affinity_kind, matched, affinity_rank = "threat_front_ids", [front_id], 3
            elif scene_tags & tags:
                affinity_kind, matched, affinity_rank = "scene_tags_any", sorted(scene_tags & tags), 2
            elif scene_factions & factions:
                affinity_kind, matched, affinity_rank = "faction_ids", sorted(scene_factions & factions), 1
            else:
                affinity_kind, matched, affinity_rank = "fallback", [], 0
            # A scenario-wide clock is not automatically observable in every
            # location. Without a structured scene/front/tag/faction match its
            # symptom could instantiate a supernatural object or route in the
            # wrong scene. Fail closed below to active-scene pressure or none;
            # never select affinity_kind=fallback merely because a clock exists.
            if affinity_rank > 0:
                candidates.append((
                    -affinity_rank, -severity, front_id, str(clock.get("clock_id") or ""),
                    front_index, clock_index, front, {**clock, "_selection_reason": {
                        "affinity_kind": affinity_kind,
                        "matched_ids": matched,
                        "front_id": front_id,
                        "severity": severity,
                    }},
                ))
    if candidates:
        _, _, _, _, _, _, _front, clock = min(candidates)
        current = _clock_segments(clock, "current_segments", 0)
        symptom = clock.get("on_tick_visible", ["tension rises"])
        idx = min(current, len(symptom) - 1) if isinstance(symptom, list) and symptom else 0
        moves.append({
            "clock_id": clock["clock_id"], "tick": 1,
            "visible_symptom": symptom[idx] if isinstance(symptom, list) and symptom else "tension rises",
            "reason": f"stalled_{ctx['rule_signals']['stalled_turns']}_turns" if ctx["rule_signals"]["stalled_turns"] else "pressure_action",
            "selection_reason": clock["_selection_reason"],
            "grounding_receipt": {
                "schema_version": 1,
                "status": "authorized",
                "source": "threat_fronts.clock",
                "active_scene_id": scene_id,
                "front_id": clock["_selection_reason"].get("front_id"),
                "clock_id": clock.get("clock_id"),
                "affinity_kind": clock["_selection_reason"].get("affinity_kind"),
                "matched_ids": list(clock["_selection_reason"].get("matched_ids") or []),
                "rule": (
                    "This threat symptom is authorized only by the recorded "
                    "structured affinity; do not extend it beyond the matched scene source."
                ),
            },
        })
        return moves
    scene_move = _build_scene_pressure_move(ctx)
    return [scene_move] if scene_move is not None else []


def _build_rules_requests(ctx: dict[str, Any], action: str,
                          clue_policy: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """Request skill checks only when justified."""
    # Scene-level SAN triggers: when the active scene defines on_enter.san_triggers
    # that haven't fired yet, emit a sanity_check so the driver can settle SAN
    # loss via SanitySession. This makes horror scenes (seeing carnage, witnessing
    # the entity) auto-trigger SAN checks without requiring a stalled player.
    requests: list[dict[str, Any]] = []
    keeper_proposal = coc_keeper_planner.proposal_from_context(ctx)
    keeper_rule_ruling = (
        keeper_proposal.get("rule_ruling")
        if isinstance(keeper_proposal, dict)
        and keeper_proposal.get("source") == "model"
        and isinstance(keeper_proposal.get("rule_ruling"), dict)
        else {}
    )
    keeper_waived_discretionary_roll = (
        keeper_rule_ruling.get("decision") == "no_roll"
    )
    combat_state = ctx.get("combat_state") or {}
    pending_attack = combat_state.get("pending_attack")
    rich_intent = ctx.get("player_intent_rich") or {}
    defense = rich_intent.get("combat_defense")
    if isinstance(pending_attack, dict) and isinstance(defense, dict):
        allowed = pending_attack.get("allowed_defenses") or []
        defense_kind = defense.get("kind")
        combat_revision = combat_state.get("revision")
        if (
            set(defense) == {"kind", "attack_command_id"}
            and defense.get("attack_command_id")
            == pending_attack.get("attack_command_id")
            and pending_attack.get("target_actor_id") == ctx.get("investigator_id")
            and defense_kind in allowed
            and isinstance(combat_revision, int)
            and not isinstance(combat_revision, bool)
            and combat_revision >= 0
        ):
            # Defense is selected only from semantic-router structured output;
            # never infer dodge/fight-back by scanning player prose.
            return [{
                "kind": "combat_defend",
                "revision": combat_revision,
                "actor_id": ctx["investigator_id"],
                "attack_command_id": pending_attack["attack_command_id"],
                "defense_kind": defense_kind,
                "reason": "structured player combat defense",
            }]
    chase_action = rich_intent.get("chase_action")
    chase_state = ctx.get("chase_state") or {}
    if isinstance(chase_action, dict) and chase_state.get("active") is True:
        action_kind = chase_action.get("kind")
        request_kind = {
            "move": "chase_move", "hazard": "chase_hazard",
            "barrier": "chase_barrier", "conflict": "chase_conflict",
            "end": "chase_end",
        }.get(action_kind)
        revision = chase_action.get("revision")
        if (
            request_kind is not None
            and isinstance(revision, int) and not isinstance(revision, bool)
            and revision >= 0
            and revision == chase_state.get("revision")
        ):
            required = {"kind", "revision"}
            if action_kind != "end":
                required |= {"actor_id", "action_id"}
            optional_by_kind = {
                "move": set(), "hazard": {"skill", "target", "difficulty"},
                "barrier": {"method", "skill", "target", "difficulty"},
                "conflict": {"target_actor_id", "combat_command_id"},
                "end": {"outcome"},
            }
            if set(chase_action) <= required | optional_by_kind[action_kind] and required <= set(chase_action):
                return [{
                    "kind": request_kind,
                    **{key: value for key, value in chase_action.items() if key != "kind"},
                    **(
                        {"chase_id": chase_state.get("chase_id")}
                        if action_kind == "end" else {}
                    ),
                    "reason": "structured semantic chase action",
                }]
    scene = ctx.get("active_scene") or {}
    fired = set(ctx.get("world_state", {}).get("san_triggers_fired", []))
    for trig in (scene.get("on_enter") or {}).get("san_triggers", []) or []:
        if not isinstance(trig, dict):
            continue
        tid = trig.get("trigger_id") or trig.get("source", "")
        if tid and tid in fired:
            continue
        involuntary = trig.get("involuntary_action")
        if not isinstance(involuntary, dict):
            involuntary = {}
        involuntary_kind = trig.get(
            "involuntary_kind", involuntary.get("kind", "freeze")
        )
        involuntary_summary = trig.get(
            "involuntary_summary",
            involuntary.get("summary", "freezes for a moment"),
        )
        request = {
            "kind": "sanity_check", "skill": "SAN",
            "reason": trig.get("source", "scene horror"),
            "difficulty": "regular", "bonus_penalty_dice": 0,
            "san_loss_success": int(trig.get("san_loss_success", 0)),
            "san_loss_fail_expr": str(trig.get("san_loss_fail_expr", "1")),
            "source": trig.get("source", "scene horror"),
            "creature_type": trig.get("creature_type"),
            "alone": trig.get("alone", False),
            "involuntary_kind": involuntary_kind,
            "involuntary_summary": involuntary_summary,
            "san_trigger_id": tid,
            "roll_contract": _roll_contract(
                goal=trig.get("source", "withstand the immediate horror"),
                success_effect="contain the shock and keep moving",
                failure_effect="lose SAN and let the horror leave a lasting mark",
                failure_outcome_mode="pressure_cost",
                roll_density_group=f"san:{tid or scene.get('scene_id') or 'scene'}",
                push_eligible=False,
            ),
        }
        if "module_bout_override" in trig:
            request["module_bout_override"] = trig["module_bout_override"]
        requests.append(request)

    # Danger attack profiles: in combat scenes (or when the player fights/flees),
    # resolve danger attacks as opposed checks so the engine drives combat
    # mechanically (Dodge vs tentacle slash, Athletics vs wind blast).
    intent = ctx.get("player_intent_class", "")
    is_combat = (scene.get("scene_type") == "combat") or intent in ("combat", "flee")
    if is_combat:
        fronts = ctx.get("threat_fronts", {}).get("fronts", [])
        danger_map: dict[str, dict[str, Any]] = {}
        for f in fronts:
            for d in (f.get("dangers") or []):
                if d.get("id"):
                    danger_map[d["id"]] = d
        danger_specs = (scene.get("on_enter") or {}).get("danger_attacks", []) or []
        # If scene doesn't list specific dangers, use all dangers with profiles.
        if not danger_specs:
            danger_specs = [{"danger_id": did, "attack_name": None}
                            for did, d in danger_map.items() if d.get("attack_profiles")]
        for spec in danger_specs:
            if not isinstance(spec, dict):
                continue
            did = spec.get("danger_id", "")
            danger = danger_map.get(did, {})
            profiles = danger.get("attack_profiles") or []
            attack_name = spec.get("attack_name")
            profile = None
            if attack_name:
                profile = next((p for p in profiles if p.get("name") == attack_name), None)
            if profile is None and profiles:
                profile = profiles[0]
            if not profile:
                continue
            requests.append({
                "kind": "opposed_check",
                "skill": profile.get("resist_skill", "Dodge"),
                "reason": f"{danger.get('id', did)} uses {profile.get('name', 'attack')}",
                "difficulty": "regular", "bonus_penalty_dice": 0,
                "resist_skill": profile.get("resist_skill", "Dodge"),
                "opposed_skill": profile.get("attack_skill", "Fighting"),
                "opposed_target_percent": int(profile.get("attack_target_percent", 50)),
                "damage": profile.get("damage", "1D6"),
                "lethality": profile.get("lethality"),
                "ignores_armor": bool(profile.get("ignores_armor", False)),
                "attack_name": profile.get("name", "attack"),
                "danger_id": did,
                "roll_contract": _roll_contract(
                    goal=f"avoid {profile.get('name', 'the incoming attack')}",
                    success_effect="avoid the immediate hit or blunt its impact",
                    failure_effect="the attack lands or forces a costly setback",
                    failure_outcome_mode="goal_with_cost",
                    roll_density_group=f"danger:{did}:{profile.get('name', 'attack')}",
                    push_eligible=False,
                ),
            })

    if action == "SUBSYSTEM":
        sig = ctx["rule_signals"]
        if sig["bout_active"]:
            # p.156-157: a bout of madness is a Keeper-takeover playout, not a
            # dice procedure — there is no SAN roll to "regain control". The
            # apply layer passes this directive straight to narration.
            return [{"kind": "bout_playout",
                     "reason": "bout of madness in progress",
                     "keeper_controls_investigator": True,
                     "rule_ref": "core.sanity.bout_of_madness",
                     "narrative_directives": {
                         "instruction": ("Keeper dictates the investigator's "
                                         "actions this round per the rolled bout "
                                         "result; no SAN roll; no further SAN "
                                         "loss during the bout; the bout ends "
                                         "when its rounds run out or the scene "
                                         "resolves (tick_bout_round/end_bout)."),
                     }}]
        if sig["hp_state"] == "dying":
            # The rescue engine owns the death clock and durable dead state.
            # A generic CON check could narrate death without applying it.
            return [{
                "kind": "dying_tick",
                "clock_kind": (
                    "hour"
                    if "stabilized" in set(sig.get("active_conditions") or [])
                    else "round"
                ),
                "reason": "structured death-clock continuation",
            }]
    if (
        action == "REVEAL"
        and (clue_policy or {}).get("reveal")
        and not keeper_waived_discretionary_roll
    ):
        # Only request a skill check when the revealed clue is obscured (its
        # delivery requires a die roll). Obvious clues — Handouts, direct gives,
        # plain location/event descriptions — are delivered by the narrator
        # without a roll. Skill + difficulty come from the structured
        # delivery_kind resolution (falling back to Spot Hidden / regular when
        # the legacy heuristic was used).
        clue_type = (clue_policy or {}).get("clue_type", "obscured")
        if clue_type != "obvious":
            skill = (clue_policy or {}).get("skill") or "Spot Hidden"
            difficulty = (clue_policy or {}).get("difficulty") or "regular"
            clue_id = (clue_policy or {}).get("reveal")[0]
            fumble_consequence = _generated_clue_fumble_consequence(
                clue_policy or {}, str(clue_id)
            )
            roll_contract = _roll_contract(
                goal="surface the current obscured clue",
                success_effect="commit the exact planned clue",
                failure_effect="withhold the exact clue while keeping a fallback route or cost in motion",
                failure_outcome_mode="clue_with_cost",
                roll_density_group=f"clue:{clue_id}",
                must_not=[
                    "do not narrate no progress on ordinary failure",
                    "do not reveal exact withheld clue on failure",
                ],
            )
            roll_contract.update({
                "generated_clue_gate": True,
                "fumble_consequence": fumble_consequence,
                "push_failure_consequence": _generated_clue_push_consequence(
                    clue_policy or {}, str(clue_id)
                ),
            })
            requests.append({"kind": "skill_check", "skill": skill, "reason": "obscured clue in scene",
                     "difficulty": difficulty, "bonus_penalty_dice": 0,
                     "clue_gate": True, "clue_id": clue_id,
                     "roll_contract": roll_contract})
    if (
        action in ("REVEAL", "RECOVER")
        and _clue_bonus_eligible(ctx, clue_policy)
        and not keeper_waived_discretionary_roll
    ):
        # Non-gating dice texture: core clue still lands; bonus success adds
        # extra_summary, failure costs time/pressure. Density group keeps
        # enrichment from merging unrelated rolls into this axis.
        bonus = _project_clue_bonus_contract((clue_policy or {}).get("bonus"))
        if bonus is None:
            bonus = {}
        clue_id = ((clue_policy or {}).get("reveal") or (clue_policy or {}).get("fallback_routes") or ["clue"])[0]
        density_group = f"clue-bonus:{clue_id}"
        already = any(
            isinstance(req, dict)
            and ((req.get("roll_contract") or {}).get("roll_density_group") == density_group)
            for req in requests
        )
        if not already and bonus.get("skill"):
            on_fail = str(bonus.get("on_fail_cost") or "time")
            roll_contract = _roll_contract(
                goal="gain extra investigative detail without gating the core clue",
                success_effect="attach bonus_reveal (extra_summary) alongside the core clue",
                failure_effect=(
                    "core clue still lands; spend time"
                    if on_fail == "time"
                    else "core clue still lands; pressure rises"
                ),
                failure_outcome_mode="bonus_with_cost",
                roll_density_group=density_group,
                must_not=[
                    "do not withhold the core clue on bonus failure",
                    "do not narrate no progress on ordinary failure",
                ],
            )
            roll_contract.update({
                "authored_clue_bonus": True,
                "fumble_consequence": json.loads(json.dumps(
                    bonus["fumble_consequence"]
                )),
                "push_failure_consequence": {
                    key: json.loads(json.dumps(value))
                    for key, value in bonus["fumble_consequence"].items()
                    if key in {"summary", "effect", "localized_summaries"}
                },
            })
            requests.append({
                "kind": "skill_check",
                "skill": bonus.get("skill"),
                "reason": "clue bonus detail",
                "difficulty": bonus.get("difficulty") or "regular",
                "bonus_penalty_dice": 0,
                "clue_bonus": True,
                "clue_id": clue_id,
                "bonus": bonus,
                "roll_contract": roll_contract,
            })
    if action == "RECOVER" and not keeper_waived_discretionary_roll:
        # Idea Roll recovery valve (Keeper Rulebook ~p.199). Never-signposted
        # leads are given free; mentioned → Regular; obvious-but-missed → Extreme.
        fallback_ids = [
            cid for cid in ((clue_policy or {}).get("fallback_routes") or []) if cid
        ]
        missed_clue_id = fallback_ids[0] if fallback_ids else None
        idea_plan = _idea_roll_plan(ctx, action, missed_clue_id=missed_clue_id)
        difficulty = (idea_plan or {}).get("difficulty")
        if idea_plan is not None and difficulty is not None:
            clue_id = idea_plan.get("missed_clue_id") or "recover"
            requests.append({
                "kind": "idea_roll",
                "skill": "INT",
                "reason": "idea roll recovery valve",
                "difficulty": difficulty,
                "bonus_penalty_dice": 0,
                "signpost_level": idea_plan.get("signpost_level"),
                "missed_clue_id": idea_plan.get("missed_clue_id"),
                "roll_contract": _roll_contract(
                    goal="recover a missed investigative lead",
                    success_effect="surface the lead cleanly without increasing danger",
                    failure_effect="surface the lead in a worse position (in the thick of it)",
                    failure_outcome_mode="goal_with_cost",
                    roll_density_group=f"idea:{clue_id}",
                    push_eligible=False,
                    must_not=[
                        "do not present this as table-level advice",
                        "do not ask the player to guess the same missing route again",
                        "do not withhold the recovery lead after the Idea Roll resolves",
                    ],
                ),
            })
    return requests


def generate_director_plan(ctx: dict[str, Any], decision_id: str) -> dict[str, Any]:
    """Produce full DirectorPlan. The core output of the director."""
    action, scores = select_action(ctx)
    overrides = apply_rule_signal_overrides(ctx)
    scene = ctx.get("active_scene") or {}

    # Compute clue_policy once and thread it through to _build_rules_requests so
    # the REVEAL skill-check decision matches the clue_type that lands in the
    # emitted plan (Spec v1.1 gap #1: obvious clues should not roll Spot Hidden).
    clue_policy = _select_clue_policy(ctx, action)
    requested_action = action
    empty_reveal_adjustment = None
    if action == "REVEAL" and not clue_policy.get("reveal"):
        # REVEAL is a claim about a concrete module fact, not a generic synonym
        # for "the investigator did something investigative".  When no clue is
        # bound, keep any structured action-atom gate for its declared goal/cost
        # but do not emit reveal progress or manufacture a default Spot Hidden
        # check against a sentinel clue.
        action = "DEEPEN"
        empty_reveal_adjustment = {
            "schema_version": 1,
            "requested_action": requested_action,
            "effective_action": action,
            "reason": "no_concrete_planned_clue",
            "source": "clue_policy.reveal",
        }
    epistemic_contract = coc_epistemic_policy.plan_epistemic_contract(
        ctx, clue_policy, action
    )
    rules_requests = _build_rules_requests(ctx, action, clue_policy)
    rich = ctx.get("player_intent_rich") if isinstance(ctx.get("player_intent_rich"), dict) else {}
    resolution = rich.get("action_resolution") if isinstance(rich.get("action_resolution"), dict) else {}
    matched_operation_routes = {
        str(value) for value in (resolution.get("matched_affordance_ids") or []) if value
    } if resolution.get("no_match") is not True else set()
    for affordance in scene.get("affordances") or []:
        if not isinstance(affordance, dict):
            continue
        route_id = str(affordance.get("id") or affordance.get("route_id") or "")
        operation = affordance.get("authored_operation")
        if route_id not in matched_operation_routes or not isinstance(operation, dict):
            continue
        kind = operation.get("kind")
        payload = operation.get("payload")
        if kind not in {"environmental_hazard", "mythos_tome_study"} or not isinstance(payload, dict):
            continue
        rules_requests = [
            request for request in rules_requests
            if route_id not in (
                (request.get("route_resolution") or {}).get("matched_route_ids", [])
                if isinstance(request, dict)
                and isinstance(request.get("route_resolution"), dict)
                else []
            )
        ]
        rules_requests.append({
            "kind": kind,
            **json.loads(json.dumps(payload, ensure_ascii=False)),
            "request_id": f"route:{route_id}:operation",
            "route_resolution": {"matched_route_ids": [route_id]},
        })
    for interaction in rich.get("npc_interactions") or []:
        if not isinstance(interaction, dict):
            continue
        skill = interaction.get("skill")
        request_id = interaction.get("request_id")
        if not isinstance(skill, str) or not skill.strip() or not isinstance(request_id, str) or not request_id.strip():
            continue
        rules_requests.append({
            "kind": "skill_check",
            "skill": skill.strip(),
            "difficulty": interaction.get("difficulty")
            if interaction.get("difficulty") in {"regular", "hard", "extreme"}
            else "regular",
            "request_id": request_id.strip(),
            "reason": "structured_npc_interaction",
            "roll_contract": _roll_contract(
                goal="resolve the declared NPC interaction tactic",
                success_effect="apply the tactic's bounded structured success effect",
                failure_effect="apply the tactic's bounded structured failure effect",
                failure_outcome_mode="social_position_change",
                roll_density_group=f"npc-interaction:{request_id.strip()}",
                push_eligible=False,
            ),
        })
    npc_moves = _build_npc_moves(ctx, action)
    npc_agency_requests: list[dict[str, Any]] = []
    for move in npc_moves:
        npc_agency_requests.extend(
            coc_npc_persona.rules_requests_from_agency_moves(move.get("agency_moves", []))
        )
    if npc_agency_requests:
        rules_requests.extend(npc_agency_requests)

    handoff = "narration"
    subsystem = None
    if overrides:
        handoff = overrides.get("handoff", "narration")
        subsystem = overrides.get("subsystem")
    elif action == "SUBSYSTEM":
        handoff = "rules"
    elif action in ("REVEAL", "DEEPEN", "PRESSURE", "CHARACTER", "CHOICE", "CUT", "MONTAGE", "RECOVER", "PAYOFF"):
        handoff = "rules" if rules_requests else "narration"
    # Idea Roll / other emitted requests always need the rules handoff, even when
    # Layer-3 forced RECOVER with a narration default.
    if rules_requests and handoff != "rules":
        handoff = "rules"

    pacing_entry = _current_pacing_entry(ctx)
    # horror stage from pacing-map, validated; fallback to wrongness
    raw_horror = pacing_entry.get("horror_stage", "wrongness")
    horror_stage = raw_horror if raw_horror in VALID_HORROR_STAGES else "wrongness"
    # D4: pacing_mode is action-derived only; tension_target is a separate field.
    pacing_mode = (
        "investigation" if action in ("REVEAL", "DEEPEN")
        else ("pressure" if action == "PRESSURE" else "social")
    )
    tension_target = pacing_entry.get("tension_target") or None
    # tension_delta: action-driven, but escalation scenes add +1
    tension_delta = 1 if action in ("PRESSURE", "SUBSYSTEM") else (0 if action in ("REVEAL", "DEEPEN", "RECOVER") else -1)
    if tension_target in ("high", "climax") and action not in ("RECOVER", "MONTAGE"):
        tension_delta = max(tension_delta, 1)

    explicit_mode = scene.get("render_mode")
    if explicit_mode not in {"investigation", "social", "pressure", "crisis"}:
        if scene.get("scene_type") == "crisis" or action == "SUBSYSTEM":
            explicit_mode = "crisis"
        elif action == "PRESSURE":
            explicit_mode = "pressure"
        elif action in {"REVEAL", "DEEPEN", "RECOVER"}:
            explicit_mode = "investigation"
        else:
            explicit_mode = "social"

    structure_type = (ctx.get("module_meta") or {}).get("structure_type")
    strategy_signal_findings: list[dict[str, Any]] = []
    if structure_type == "time_loop":
        time_loop_signals, strategy_signal_findings = (
            coc_director_strategies.validate_time_loop_signals({
                "loop_boundary": scene.get("loop_boundary", False),
                "player_retained_memory_ids": scene.get(
                    "player_retained_memory_ids", []
                ),
            })
        )
        strategy_signals = time_loop_signals
    elif structure_type == "multi_faction":
        strategy_signals = {
            "factions": (ctx.get("module_meta") or {}).get("factions") or [],
        }
    else:
        strategy_signals = {}
    strategy_result = coc_director_strategies.compile_strategy(
        ctx.get("module_meta") or {}, ctx.get("director_strategy_state") or {}, strategy_signals
    )
    if strategy_signal_findings:
        strategy_result["capability_findings"] = [
            *strategy_signal_findings,
            *(strategy_result.get("capability_findings") or []),
        ]

    # Dying (and any future override carrying extra_pressure) forces PRESSURE
    # clock-ticks even though the chosen action is SUBSYSTEM. _build_pressure_moves
    # gates on action ∈ {PRESSURE, RECOVER}, so feed it "PRESSURE" directly here.
    if overrides and overrides.get("extra_pressure"):
        pressure_moves = _build_pressure_moves(ctx, "PRESSURE")
    else:
        pressure_moves = _build_pressure_moves(ctx, action)

    personal_horror = _personal_horror_directive(ctx, action)
    delusion_seed = _delusion_directive(ctx, action)
    mythos_presentation = _mythos_presentation_directive(ctx, action)
    trope_boosts = _early_horror_trope_boosts(horror_stage, action)

    # tone is a list of scene tone tags; believer appends mythos_bleak (p.212).
    tone = list(scene.get("tone") or [])
    if ctx.get("believer") is True and "mythos_bleak" not in tone:
        tone.append("mythos_bleak")

    # R-2: narrator-facing must_not_reveal carries {id, category} only.
    # Full keeper_secrets prose stays in improvisation-boundaries (planner-side).
    secret_refs = coc_narration_contract.normalize_keeper_secret_refs(
        ctx.get("improvisation_boundaries", {}).get("keeper_secrets", [])
    )
    narrative_directives = {
        "tone": tone,
        "must_include": _collect_anchors(
            clue_policy.get("reveal", []) + clue_policy.get("fallback_routes", []),
            ctx.get("clue_graph", {}),
            ctx.get("play_language") or "zh-Hans",
        ),
        "must_not_reveal": secret_refs,
        "improvisation_allowed": ctx.get("improvisation_boundaries", {}).get("invent_allowed", []),
        "horror_escalation_stage": horror_stage,
        "content_constraints": ctx.get("module_meta", {}).get("content_flags", []),
        "player_facing_style": _player_facing_style(ctx.get("play_language") or "zh-Hans"),
        "render_mode": explicit_mode,
        "horror_profile": coc_narration_style.build_horror_profile(
            ctx.get("module_meta") or {}, scene,
            {"horror_stage": horror_stage},
        ),
    }
    keeper_proposal = coc_keeper_planner.proposal_from_context(ctx)
    keeper_public_plan = coc_keeper_planner.public_projection(keeper_proposal)
    if keeper_public_plan is not None:
        narrative_directives["keeper_plan"] = keeper_public_plan
    # Layer-3 Fair Warning (p.209): downgrade lethal structured evidence while
    # lethal_chances_used < 3; attach fair_warning directive for apply/narration.
    pressure_moves = _apply_fair_warning_ladder(
        ctx, pressure_moves, rules_requests, narrative_directives,
    )
    if personal_horror is not None:
        narrative_directives["personal_horror_hook"] = personal_horror
    if delusion_seed is not None:
        narrative_directives["delusion_seed"] = delusion_seed
    if mythos_presentation is not None:
        narrative_directives["mythos_presentation"] = mythos_presentation
    if trope_boosts is not None:
        narrative_directives["storylet_trope_weight_boosts"] = trope_boosts
    if overrides and isinstance(overrides.get("scene_progress"), dict):
        narrative_directives["scene_progress"] = overrides["scene_progress"]
    dramatic_progress = _dramatic_progress_directive(
        ctx, action, clue_policy, rules_requests, pressure_moves
    )
    if dramatic_progress is not None:
        narrative_directives["dramatic_progress"] = dramatic_progress
    idea_fallback = None
    for cid in (clue_policy.get("fallback_routes") or []):
        if cid:
            idea_fallback = cid
            break
    idea_plan = _idea_roll_plan(ctx, action, missed_clue_id=idea_fallback)
    if idea_plan is not None:
        narrative_directives["idea_roll_plan"] = idea_plan
    exit_pressure = _scene_exit_pressure_directive(ctx, action, clue_policy, rules_requests)
    if exit_pressure is not None:
        narrative_directives["scene_exit_pressure"] = exit_pressure

    # v2: populate memory_reads from the memory layer. PAYOFF actions mark the
    # card use as PAYOFF (recalled payoff); everything else is TONE color.
    # memory_writes stays empty here — writeback is decided by the M5 apply layer.
    mem_cards = _retrieve_memory_for_ctx(ctx)
    memory_reads = [
        {"memory_id": c.get("memory_id"), "path": c.get("path"),
         "reason": "entity/scene match", "use": "PAYOFF" if action == "PAYOFF" else "TONE"}
        for c in mem_cards
    ]

    time_advance = _derive_time_advance(
        action,
        ctx.get("time_signals", {}),
        ctx=ctx,
    )

    plan: dict[str, Any] = {
        "decision_id": decision_id,
        "turn_input": {
            "player_intent": ctx["player_intent"],
            "player_intent_class": ctx["player_intent_class"],
            "player_intent_rich": ctx.get("player_intent_rich") or {},
            "active_scene_id": ctx["active_scene_id"],
            "turn_number": ctx["turn_number"],
        },
        "scene_action": action,
        "subsystem": subsystem,
        "dramatic_question": scene.get("dramatic_question", ""),
        "scene_function": dict(ctx["active_scene_function"]),
        "pacing_mode": pacing_mode,
        "tension_target": tension_target,
        "tension_delta": tension_delta,
        "rule_signals": ctx["rule_signals"],
        # Advisory rendering of notable parameter signals (credit tier, low
        # luck). Fixed copy from structured enums; the KP may adopt or ignore.
        "rule_signal_notes": coc_rule_signals.describe_parameter_signals(
            ctx["rule_signals"]
        ),
        "time_signals": ctx.get("time_signals", {}),
        "time_advance": time_advance,
        "validation_warnings": list(ctx.get("validation_warnings") or []),
        "clue_policy": clue_policy,
        "epistemic_contract": epistemic_contract,
        "npc_moves": npc_moves,
        "npc_state_writes": ctx.get("npc_state_writes", []),
        "pressure_moves": pressure_moves,
        "rules_requests": rules_requests,
        "memory_reads": memory_reads,
        "memory_writes": [],
        "director_strategy_state": strategy_result.get("strategy_state") or {},
        "faction_rankings": strategy_result.get("faction_rankings") or [],
        "capability_findings": strategy_result.get("capability_findings") or [],
        "narrative_directives": narrative_directives,
        "handoff": handoff,
        "rationale": overrides["rationale"] if overrides else f"top-scored action {action} (score={scores.get(action, 0)})",
    }
    if isinstance(keeper_proposal, dict):
        plan["keeper_proposal"] = deepcopy(keeper_proposal)
        resolution_receipt = (
            rich.get("action_resolution")
            if isinstance(rich.get("action_resolution"), dict)
            else {}
        )
        plan["keeper_ruling_receipt"] = {
            "schema_version": 1,
            "source": keeper_proposal.get("source"),
            "rule_advice": deepcopy(resolution_receipt.get("rule_advice") or []),
            "rule_ruling": deepcopy(keeper_proposal.get("rule_ruling") or {}),
            "proposal_rejection": deepcopy(
                resolution_receipt.get("keeper_proposal_rejection")
            ),
            "hard_invariants_remain_kernel_owned": True,
        }
    if empty_reveal_adjustment is not None:
        plan["action_adjustment"] = empty_reveal_adjustment
    if action == "CUT":
        candidates = coc_scene_graph.transition_candidates(
            ctx.get("active_scene_id") or scene.get("scene_id"),
            ctx.get("story_graph"),
            ctx.get("world_state") or {},
        )
        if overrides and isinstance(overrides.get("flags_set"), list):
            plan["flags_set"] = [
                str(flag_id).strip()
                for flag_id in overrides["flags_set"]
                if str(flag_id).strip()
            ]
        if candidates:
            override_target = None
            if overrides and isinstance(overrides.get("transition_to"), str):
                override_target = overrides["transition_to"]
            if override_target in candidates:
                plan["transition_to"] = override_target
            elif overrides and isinstance(
                overrides.get("destination_entry_authority"), dict
            ):
                # The original durable world does not contain a public direct
                # entry until apply validates and persists its exact receipt.
                # Never replace that explicit selection with candidates[0].
                plan["transition_to"] = override_target
                candidates = [str(override_target)]
            else:
                plan["transition_to"] = candidates[0]
            plan["transition_candidates"] = candidates
            if overrides and isinstance(
                overrides.get("destination_entry_authority"), dict
            ):
                plan["destination_entry_authority"] = deepcopy(
                    overrides["destination_entry_authority"]
                )
            if overrides and isinstance(overrides.get("matched_target"), dict):
                plan["matched_target"] = overrides["matched_target"]
        elif overrides and isinstance(overrides.get("transition_to"), str):
            # Flag-gated move: destination unlocks during apply after flags_set.
            plan["transition_to"] = overrides["transition_to"]
            plan["transition_candidates"] = [overrides["transition_to"]]
            if isinstance(overrides.get("destination_entry_authority"), dict):
                plan["destination_entry_authority"] = deepcopy(
                    overrides["destination_entry_authority"]
                )
            if overrides and isinstance(overrides.get("matched_target"), dict):
                plan["matched_target"] = overrides["matched_target"]

    # A clue-less authored route may declare a deterministic no-roll
    # completion effect (for example, a courteous clerk giving the address of
    # the correct records office).  Only an exact semantic-resolver match can
    # commit these flags, and any rule request bound to the same route disables
    # this shortcut so failed checks never become successful route effects.
    resolution = (
        rich.get("action_resolution")
        if isinstance(rich.get("action_resolution"), dict)
        else {}
    )
    matched_route_ids = {
        str(route_id)
        for route_id in (resolution.get("matched_affordance_ids") or [])
        if route_id
    } if resolution.get("no_match") is not True else set()
    rule_bound_route_ids: set[str] = set()
    for request in rules_requests:
        if not isinstance(request, dict):
            continue
        route_resolution = request.get("route_resolution")
        if not isinstance(route_resolution, dict):
            continue
        for route_id in route_resolution.get("matched_route_ids") or []:
            if route_id:
                rule_bound_route_ids.add(str(route_id))
    completion_flags: list[str] = []
    for affordance in scene.get("affordances") or []:
        if not isinstance(affordance, dict):
            continue
        route_id = str(affordance.get("id") or affordance.get("route_id") or "")
        if (
            route_id not in matched_route_ids
            or route_id in rule_bound_route_ids
            or affordance.get("completion_policy") != "matched_no_roll"
        ):
            continue
        for flag_id in affordance.get("sets_flags") or []:
            normalized = str(flag_id or "").strip()
            if normalized and normalized not in completion_flags:
                completion_flags.append(normalized)
    if completion_flags:
        plan["flags_set"] = list(dict.fromkeys([
            *(plan.get("flags_set") or []), *completion_flags,
        ]))

    # Authored scene flag_commits (structured intent ∩ target_tags).
    scene_flags = coc_scene_graph.resolve_scene_flag_commits(
        scene,
        intent_class=str(ctx.get("player_intent_class") or ""),
        target_entities=(
            rich.get("target_entities")
            if isinstance(rich.get("target_entities"), list)
            else None
        ),
    )
    if scene_flags:
        existing = [
            str(flag_id).strip()
            for flag_id in (plan.get("flags_set") or [])
            if str(flag_id).strip()
        ]
        merged = existing[:]
        for flag_id in scene_flags:
            if flag_id not in merged:
                merged.append(flag_id)
        plan["flags_set"] = merged

    # SENNA-style explicit redirection: only when structured off-track signals fire.
    redirection = build_redirection_block(ctx, npc_moves=npc_moves)
    if redirection is not None:
        plan["redirection"] = redirection
    return plan
