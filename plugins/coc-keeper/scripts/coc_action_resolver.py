#!/usr/bin/env python3
"""Keeper-side semantic binding for natural player actions.

This is deliberately separate from the player brain.  The player continues to
see only KP narration; the resolver receives a bounded Keeper projection and
returns stable IDs that the deterministic director can consume.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Any, Callable


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_scene_graph = _load_module("coc_action_scene_graph", SCRIPT_DIR / "coc_scene_graph.py")
coc_subsystem_executor = _load_module(
    "coc_action_subsystem_executor", SCRIPT_DIR / "coc_subsystem_executor.py"
)
coc_keeper_planner = _load_module(
    "coc_action_keeper_planner", SCRIPT_DIR / "coc_keeper_planner.py"
)
coc_investigator_guard = _load_module(
    "coc_investigator_guard_action_resolver",
    SCRIPT_DIR / "coc_investigator_guard.py",
)


def _guarded_character(
    campaign_dir: Path,
    character_path: Path | str | None,
    investigator_id: str | None,
    character_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if isinstance(character_snapshot, dict):
        return json.loads(json.dumps(character_snapshot, ensure_ascii=False))
    if character_path is None:
        return {}
    if not isinstance(investigator_id, str) or not investigator_id:
        raise ValueError("character_path requires investigator_id")
    return coc_investigator_guard.read_reusable_character(
        coc_investigator_guard.coc_root_for_campaign(campaign_dir),
        investigator_id,
        Path(character_path),
    )


class AuthoredOperationNotImplementedError(RuntimeError):
    """A source-authored route was selected but lacks its required typed runtime."""

    def __init__(self, route_ids: list[str], operations: list[str]) -> None:
        self.route_ids = list(route_ids)
        self.operations = list(operations)
        super().__init__(
            "authored route requires NOT_IMPLEMENTED typed operations: "
            + ", ".join(self.operations)
        )


def _read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def _text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _affordance_clue_ids(raw: dict[str, Any]) -> list[str]:
    clue_ids: list[str] = []
    for value in [raw.get("clue_id"), *(raw.get("grants_clue_ids") or [])]:
        clue_id = _text(value)
        if clue_id is not None and clue_id not in clue_ids:
            clue_ids.append(clue_id)
    return clue_ids


def _roll_gate_projection(raw: Any) -> dict[str, Any] | None:
    if raw is None:
        return None
    if not isinstance(raw, dict) or raw.get("kind") != "skill_check":
        raise RuntimeError("authored roll_gate has an invalid kind or shape")
    approaches: list[dict[str, str]] = []
    for item in raw.get("approaches") or []:
        if not isinstance(item, dict):
            continue
        verb = _text(item.get("verb"))
        skill = _text(item.get("skill"))
        if verb is not None and skill is not None:
            approaches.append({"verb": verb, "skill": skill})
    difficulty = _text(raw.get("difficulty"))
    stakes = _text(raw.get("stakes"))
    ordinary_failure = raw.get("ordinary_failure")
    fumble_consequence = raw.get("fumble_consequence")
    push_consequence = raw.get("push_failure_consequence")
    if (
        not approaches
        or difficulty not in {"regular", "hard", "extreme"}
        or stakes is None
        or not isinstance(ordinary_failure, dict)
        or ordinary_failure.get("mode") != "no_progress"
        or _text(ordinary_failure.get("summary")) is None
        or not isinstance(ordinary_failure.get("localized_summaries", {}), dict)
        or not all(
            _text(key) is not None and _text(value) is not None
            for key, value in ordinary_failure.get("localized_summaries", {}).items()
        )
        or not isinstance(fumble_consequence, dict)
        or _text(fumble_consequence.get("summary")) is None
        or not isinstance(fumble_consequence.get("effect"), dict)
        or not isinstance(push_consequence, dict)
        or _text(push_consequence.get("summary")) is None
        or not isinstance(push_consequence.get("effect"), dict)
        or any(
            not isinstance(item.get("localized_summaries", {}), dict)
            or not all(
                _text(key) is not None and _text(value) is not None
                for key, value in item.get("localized_summaries", {}).items()
            )
            for item in (fumble_consequence, push_consequence)
        )
    ):
        return None
    projected = {
        "kind": "skill_check",
        "difficulty": difficulty,
        "stakes": stakes,
        "ordinary_failure": json.loads(json.dumps(ordinary_failure, ensure_ascii=False)),
        "fumble_consequence": json.loads(json.dumps(fumble_consequence, ensure_ascii=False)),
        "push_failure_consequence": json.loads(json.dumps(push_consequence, ensure_ascii=False)),
        "approaches": approaches,
    }
    retry_policy = raw.get("retry_policy")
    if isinstance(retry_policy, dict):
        mode = _text(retry_policy.get("mode"))
        minimum = retry_policy.get("minimum_elapsed_minutes")
        if (
            mode == "elapsed_time_reset"
            and isinstance(minimum, int)
            and not isinstance(minimum, bool)
            and minimum > 0
        ):
            projected["retry_policy"] = {
                "mode": mode,
                "minimum_elapsed_minutes": minimum,
            }
    return projected


def _open_affordances(
    scene: dict[str, Any],
    discovered_clue_ids: set[str] | None = None,
    completed_route_ids: set[str] | None = None,
    blocked_route_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    discovered = discovered_clue_ids or set()
    completed = completed_route_ids or set()
    blocked = blocked_route_ids or set()
    rows: list[dict[str, Any]] = []
    for raw in scene.get("affordances") or []:
        if not isinstance(raw, dict) or str(raw.get("status") or "open") not in {
            "open", "resume", "repeatable",
        }:
            continue
        affordance_id = _text(raw.get("id") or raw.get("route_id") or raw.get("route"))
        cue = _text(raw.get("cue") or raw.get("player_visible_cue"))
        if affordance_id is None or cue is None:
            continue
        if affordance_id in blocked:
            continue
        required_route_ids = {
            str(item).strip()
            for item in (raw.get("requires_completed_route_ids") or [])
            if str(item or "").strip()
        }
        # Route prerequisites are compiled module state, not prose semantics.
        # Fail closed here so the semantic model never receives a route which
        # the current world cannot legally execute.
        if not required_route_ids.issubset(completed):
            continue
        required_clue_ids = {
            str(item).strip()
            for item in (raw.get("requires_discovered_clue_ids") or [])
            if str(item or "").strip()
        }
        if not required_clue_ids.issubset(discovered):
            continue
        if affordance_id in completed and not (
            raw.get("repeatable") is True
            or str(raw.get("status") or "") in {"repeatable", "resume"}
            or str(raw.get("completion_policy") or "") == "repeatable"
        ):
            continue
        clue_ids = _affordance_clue_ids(raw)
        # Authored clue-granting routes are one-shot by default. Once all of
        # their structured grants are already in player knowledge, keeping the
        # route in the current candidate set lets acknowledgements such as
        # "I pocket the key" replay the earlier action and its side effects.
        # Reusable interactions must opt in explicitly in scenario data.
        if clue_ids and all(clue_id in discovered for clue_id in clue_ids) and not raw.get("repeatable"):
            continue
        row = {
            "affordance_id": affordance_id,
            "route_owner_scene_id": str(scene.get("scene_id") or ""),
            "route_type": str(raw.get("route_type") or "public_affordance"),
            "player_visible_cue": cue,
            "target_entities": [str(item) for item in (raw.get("target_entities") or []) if _text(item)],
            "verbs": [str(item) for item in (raw.get("verbs") or []) if _text(item)],
            "skills": [str(item) for item in (raw.get("skills") or []) if _text(item)],
            "grants_clue_ids": clue_ids,
        }
        time_profile = raw.get("time_profile")
        if isinstance(time_profile, dict):
            row["time_profile"] = json.loads(json.dumps(
                time_profile, ensure_ascii=False
            ))
        skill_minimums = raw.get("skill_minimums")
        if isinstance(skill_minimums, dict):
            row["skill_minimums"] = {
                str(skill): int(minimum)
                for skill, minimum in skill_minimums.items()
                if _text(skill)
                and isinstance(minimum, int)
                and not isinstance(minimum, bool)
                and 0 <= minimum <= 100
            }
        if raw.get("allow_before_departure") is True:
            row["allow_before_departure"] = True
        if required_route_ids:
            row["requires_completed_route_ids"] = sorted(required_route_ids)
        if isinstance(raw.get("npc_interaction"), dict):
            row["npc_interaction"] = dict(raw["npc_interaction"])
        roll_gate = _roll_gate_projection(raw.get("roll_gate"))
        if roll_gate is not None:
            row["roll_gate"] = roll_gate
        if raw.get("runtime_status") == "NOT_IMPLEMENTED":
            row["runtime_status"] = "NOT_IMPLEMENTED"
            row["required_typed_operations"] = [
                str(item).strip()
                for item in (raw.get("required_typed_operations") or [])
                if _text(item)
            ]
        rows.append(row)
    return rows


_INTERNAL_EXECUTION_GATE_FIELDS = frozenset({
    "requires_completed_route_ids",
    "requires_discovered_clue_ids",
})


def _semantic_executable_affordance(
    affordance: dict[str, Any],
) -> dict[str, Any]:
    """Project one already-authorized capability to the semantic model.

    The deterministic kernel has the world receipts needed to adjudicate route
    prerequisites.  The semantic resolver only binds present
    player meaning to capabilities that survived those checks; it must not see
    raw gate data and attempt the same decision without the authority context.
    """
    projected = json.loads(json.dumps(affordance, ensure_ascii=False))
    for field in _INTERNAL_EXECUTION_GATE_FIELDS:
        projected.pop(field, None)
    projected["preconditions_satisfied"] = True
    return projected


def _push_limitation_request(
    candidate: dict[str, Any],
    *,
    reason_code: str,
    binding_rejected: bool = False,
) -> dict[str, Any]:
    if binding_rejected:
        message = (
            "The requested Push could not be bound safely to the exact failed "
            "action. No roll was made. Restate the exact failed action and a "
            "materially changed method, or take another route."
        )
        localized = (
            "这次孤注一掷无法安全绑定到刚才那次失败，因此没有投骰。请明确指出"
            "原失败行动和实质不同的新做法，或者改走别的路线。"
        )
    else:
        message = (
            "This failed action cannot be rolled again as an ordinary attempt. "
            "Propose a materially changed method to Push it, or take a different route."
        )
        localized = (
            "这次失败不能当作普通检定直接重骰。请提出实质不同的做法来"
            "孤注一掷，或者改走别的调查路线。"
        )
    return {
        "kind": "push_limitation",
        "original_command_id": candidate["original_command_id"],
        "route_id": candidate["route_id"],
        "reason_code": reason_code,
        "player_safe_message": message,
        "localized_messages": {"zh-Hans": localized},
    }


def _destination_limitation_request(
    destinations: list[dict[str, Any]],
    affordance_index: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    cues: list[str] = []
    for destination in destinations:
        if not isinstance(destination, dict) or destination.get("available_now") is True:
            continue
        for route_id in destination.get("required_affordance_ids") or []:
            route = affordance_index.get(str(route_id))
            cue = _text(route.get("player_visible_cue")) if isinstance(route, dict) else None
            if cue and cue not in cues:
                cues.append(cue)
    if cues:
        message = (
            "That destination is not yet established as known and reachable. "
            "First follow one of the currently visible lead routes, or choose "
            "another known public destination."
        )
        localized = (
            "这个目的地目前还没有被确认为已知且可到达，因此没有移动。"
            "请先沿当前可见的调查线取得地点依据，或选择另一个已知的公共地点。"
        )
    else:
        message = (
            "That destination is not currently established as known and reachable. "
            "Obtain an explicit location lead, or choose another known public destination."
        )
        localized = (
            "这个目的地目前尚未被确认为调查员已知且可到达，因此没有移动。"
            "请先取得明确的地点线索，或选择另一个已知的公共地点。"
        )
    return {
        "kind": "destination_limitation",
        "reason_code": "destination_not_known_and_reachable",
        "player_safe_message": message,
        "localized_messages": {"zh-Hans": localized},
        "public_prerequisite_cues": cues[:3],
    }


def _edge_requirement(edge: dict[str, Any]) -> tuple[str | None, str | None]:
    when = edge.get("when") if isinstance(edge.get("when"), dict) else {}
    kind = str(when.get("kind") or "always")
    if kind == "clue_discovered":
        return kind, _text(when.get("clue_id"))
    if kind == "flag_set":
        return kind, _text(when.get("flag_id") or when.get("flag"))
    return kind, None


def _destination_candidates(
    scene: dict[str, Any],
    story_graph: dict[str, Any],
    world: dict[str, Any],
    affordances: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    scenes = {
        str(item.get("scene_id")): item
        for item in (story_graph.get("scenes") or [])
        if isinstance(item, dict) and _text(item.get("scene_id"))
    }
    unlocked = {str(item) for item in (world.get("unlocked_scene_ids") or []) if _text(item)}
    discovered = {str(item) for item in (world.get("discovered_clue_ids") or []) if _text(item)}
    affordance_by_clue: dict[str, list[str]] = {}
    for affordance in affordances:
        for clue_id in affordance.get("grants_clue_ids") or []:
            affordance_by_clue.setdefault(str(clue_id), []).append(str(affordance["affordance_id"]))
    rows: list[dict[str, Any]] = []
    for edge in scene.get("scene_edges") or []:
        if not isinstance(edge, dict):
            continue
        scene_id = _text(edge.get("to"))
        target = scenes.get(scene_id or "")
        if scene_id is None or not isinstance(target, dict):
            continue
        kind, requirement = _edge_requirement(edge)
        required_affordance_ids: list[str] = []
        available = scene_id in unlocked or kind == "always"
        if kind == "clue_discovered" and requirement:
            available = available or requirement in discovered
            if not available:
                required_affordance_ids = list(affordance_by_clue.get(requirement, []))
        direct_entry_authority = coc_scene_graph.public_direct_entry_authority(
            target
        )
        if direct_entry_authority is not None:
            # A public, independently reachable place does not become secret or
            # unreachable merely because an authored NPC hint has not been
            # consumed. This is a schema enum, never a name/prose heuristic.
            available = True
            required_affordance_ids = []
        # Do not offer a hidden locked destination unless a current public
        # affordance can satisfy its exact structured gate in this same action.
        if not available and not required_affordance_ids:
            continue
        identity = target.get("destination_identity")
        destination_identity: dict[str, Any] | None = None
        if isinstance(identity, dict):
            canonical_name = _text(identity.get("canonical_name"))
            aliases = list(dict.fromkeys(
                str(item).strip()
                for item in (identity.get("aliases") or [])
                if _text(item)
            ))
            if canonical_name is not None:
                destination_identity = {
                    "canonical_name": canonical_name,
                    "aliases": aliases,
                }
        row = {
            "scene_id": scene_id,
            "location_tags": [str(item) for item in (target.get("location_tags") or []) if _text(item)],
            "scene_type": str(target.get("scene_type") or "scene"),
            "available_now": bool(available),
            "required_affordance_ids": required_affordance_ids,
        }
        if direct_entry_authority is not None:
            row["entry_authority"] = direct_entry_authority
        if destination_identity is not None:
            row["destination_identity"] = destination_identity
        rows.append(row)
    return rows


def _route_receipt_ids(
    world: dict[str, Any], scene_id: str, status: str,
) -> set[str]:
    return {
        str(item.get("route_id"))
        for item in world.get("route_completion_receipts") or []
        if isinstance(item, dict)
        and item.get("status") == status
        and _text(item.get("route_id"))
        and (
            not _text(item.get("scene_id"))
            or _text(item.get("scene_id")) == scene_id
        )
    }


def _post_arrival_affordances(
    destinations: list[dict[str, Any]],
    story_graph: dict[str, Any],
    world: dict[str, Any],
) -> list[dict[str, Any]]:
    """Project public actions that can run immediately after an exact move.

    These rows remain Keeper-side semantic evidence.  Their explicit phase and
    owner prevent a destination action from being executed in the origin scene.
    Runtime settlement revalidates the sealed route after the move commits.
    """
    scenes = {
        str(item.get("scene_id")): item
        for item in story_graph.get("scenes") or []
        if isinstance(item, dict) and _text(item.get("scene_id"))
    }
    discovered = {
        str(item) for item in world.get("discovered_clue_ids") or [] if _text(item)
    }
    rows: list[dict[str, Any]] = []
    for destination in destinations:
        scene_id = str(destination.get("scene_id") or "")
        scene = scenes.get(scene_id)
        if not scene_id or not isinstance(scene, dict):
            continue
        completed = _route_receipt_ids(world, scene_id, "consumed")
        blocked = _route_receipt_ids(world, scene_id, "blocked")
        for affordance in _open_affordances(scene, discovered, completed, blocked):
            row = json.loads(json.dumps(affordance, ensure_ascii=False))
            row["execution_phase"] = "post_arrival"
            row["destination_scene_id"] = scene_id
            rows.append(row)
    return rows


def _build_action_request_with_authority(
    campaign_dir: Path | str,
    player_text: str,
    player_intent_rich: dict[str, Any] | None,
    *,
    character_path: Path | str | None = None,
    investigator_id: str | None = None,
    character_snapshot: dict[str, Any] | None = None,
) -> tuple[
    dict[str, Any],
    dict[str, dict[str, Any]],
    dict[str, dict[str, Any]],
    dict[str, dict[str, Any]],
]:
    campaign = Path(campaign_dir)
    world = _read_json(campaign / "save" / "world-state.json", {})
    story = _read_json(campaign / "scenario" / "story-graph.json", {"scenes": []})
    active_id = _text(world.get("active_scene_id"))
    scene = next(
        (
            item for item in (story.get("scenes") or [])
            if isinstance(item, dict) and _text(item.get("scene_id")) == active_id
        ),
        None,
    )
    if not isinstance(scene, dict):
        raise RuntimeError("action resolver requires a compiled active scene")
    discovered = {str(item) for item in (world.get("discovered_clue_ids") or []) if _text(item)}
    completed = _route_receipt_ids(world, str(active_id), "consumed")
    blocked = _route_receipt_ids(world, str(active_id), "blocked")
    affordances = _open_affordances(scene, discovered, completed, blocked)
    affordance_index = {
        str(row["affordance_id"]): row for row in affordances
    }
    destinations = _destination_candidates(scene, story, world, affordances)
    post_arrival_affordances = _post_arrival_affordances(
        destinations, story, world
    )
    post_arrival_index = {
        str(row["affordance_id"]): row for row in post_arrival_affordances
    }
    post_arrival_ids = [
        str(row["affordance_id"]) for row in post_arrival_affordances
    ]
    if len(post_arrival_ids) != len(set(post_arrival_ids)):
        raise RuntimeError(
            "post-arrival affordance IDs must be unique across destinations"
        )
    character = _guarded_character(
        campaign, character_path, investigator_id, character_snapshot
    )
    weapon_candidates = [
        {
            "weapon_id": str(weapon["weapon_id"]),
            "player_visible_name": str(
                weapon.get("name") or weapon.get("display_name") or weapon["weapon_id"]
            ),
        }
        for weapon in character.get("weapons", []) or []
        if isinstance(weapon, dict)
        and _text(weapon.get("weapon_id"))
    ]
    if not any(row["weapon_id"] == "unarmed" for row in weapon_candidates):
        weapon_candidates.append({
            "weapon_id": "unarmed", "player_visible_name": "unarmed",
        })
    rule_advice = coc_keeper_planner.build_rule_advice(
        [*affordances, *post_arrival_affordances], character
    )
    keeper_context = coc_keeper_planner.build_private_keeper_context(
        scene=scene,
        story_graph=story,
        world=world,
        character=character,
        npc_agendas=_read_json(campaign / "scenario" / "npc-agendas.json", {"npcs": []}),
        clue_graph=_read_json(campaign / "scenario" / "clue-graph.json", {"conclusions": []}),
        public_affordances=affordances,
        post_arrival_affordances=post_arrival_affordances,
        destinations=destinations,
    )
    push_candidate = None
    push_limitation_candidate = None
    character_id = _text(character.get("id"))
    if character_id is not None:
        actor_id = _text(investigator_id) or character_id
        projected_candidate = coc_subsystem_executor.project_latest_eligible_push_candidate(
            campaign, str(actor_id), str(character_id)
        )
        if isinstance(projected_candidate, dict):
            route = affordance_index.get(str(projected_candidate.get("route_id") or ""))
            consequence = projected_candidate.get("announced_consequence")
            consequence_source: dict[str, Any] | None = {
                "schema_version": 2,
                "kind": "continuation_capsule",
            }
            if isinstance(projected_candidate.get("source_time_profile"), dict):
                consequence_source["time_profile"] = json.loads(json.dumps(
                    projected_candidate["source_time_profile"], ensure_ascii=False
                ))
            if isinstance(consequence, dict):
                push_candidate = {
                    **projected_candidate,
                    "announced_consequence": json.loads(json.dumps(
                        consequence, ensure_ascii=False
                    )),
                    "consequence_source": consequence_source,
                }
            else:
                push_limitation_candidate = {
                    "candidate_id": projected_candidate["candidate_id"],
                    "original_command_id": projected_candidate["original_command_id"],
                    "route_id": projected_candidate["route_id"],
                    "reason_code": "structured_push_consequence_unavailable",
                }
    request = {
        "schema_version": 1,
        "player_text": str(player_text),
        "player_intent_rich": json.loads(json.dumps(player_intent_rich or {}, ensure_ascii=False)),
        "active_scene": {
            "scene_id": active_id,
            "scene_type": str(scene.get("scene_type") or "scene"),
            "location_tags": [str(item) for item in (scene.get("location_tags") or []) if _text(item)],
        },
        "player_knowledge": {
            "discovered_clue_ids": [
                str(item) for item in (world.get("discovered_clue_ids") or []) if _text(item)
            ],
        },
        "public_affordances": [
            _semantic_executable_affordance(row) for row in affordances
        ],
        "post_arrival_affordances": [
            _semantic_executable_affordance(row)
            for row in post_arrival_affordances
        ],
        "destination_candidates": destinations,
        "weapon_candidates": weapon_candidates,
        "push_candidate": push_candidate,
        "push_limitation_candidate": push_limitation_candidate,
        # Private Keeper planning input. This never crosses into the player or
        # public narrator view. The model may rule against advisory guidance,
        # but durable effects still require a supplied capability reference.
        "keeper_context": keeper_context,
        "rule_advice": rule_advice,
        "keeper_proposal_contract": json.loads(json.dumps(
            coc_keeper_planner.KEEPER_PROPOSAL_CONTRACT, ensure_ascii=False
        )),
        "semantic_match_contract": {
            "capability_authority_rule": (
                "Every supplied affordance is currently executable and has "
                "preconditions_satisfied=true. The deterministic runtime has "
                "already adjudicated all omitted internal gates. Bind meaning "
                "only; never infer or re-adjudicate prerequisites."
            ),
            "accepted_relations": [
                "complete_current_action",
                "direct_route_step",
                "route_progress_action",
                "implementation_means",
            ],
            "match_rule": (
                "Match only when the structured action atoms presently begin, "
                "continue, or complete a concrete step that causally advances "
                "the public affordance goal. The player need not restate the "
                "entire player_visible_cue."
            ),
            "no_match_rule": (
                "Use no_match only when the action is genuinely ambiguous or "
                "cannot be handled safely. A reasonable action with no authored "
                "route is an understood improvised Keeper beat: select no durable "
                "affordance ID, set no_match=false, and explain it in KeeperProposal."
            ),
            "roll_gate_rule": (
                "An authored roll_gate is strong cited rule advice, not final "
                "Keeper discretion. Accept it, or cite its advice_id as overridden "
                "and explain a no-roll, alternate legal skill, or changed difficulty. "
                "Only a final roll ruling emits one matching requires_roll atom."
            ),
            "push_rule": (
                "A push_candidate is the sole eligible persisted failed roll. "
                "Select it only when the player presently requests a pushed "
                "attempt of that exact failed action AND describes a materially "
                "changed method. Return its exact candidate_id plus a concise "
                "summary of the changed method. Do not emit a roll atom: the "
                "runtime must first announce the supplied consequence and wait "
                "for typed confirmation. An alternate action is not a push."
            ),
            "evidence_fields": [
                "player_intent_rich.action_atoms",
                "player_intent_rich.target_entities",
                "public_affordances.player_visible_cue",
                "public_affordances.target_entities",
                "public_affordances.verbs",
                "public_affordances.skills",
                "public_affordances.roll_gate.approaches",
                "public_affordances.preconditions_satisfied",
                "post_arrival_affordances.affordance_id",
                "post_arrival_affordances.destination_scene_id",
                "post_arrival_affordances.player_visible_cue",
                "post_arrival_affordances.target_entities",
                "post_arrival_affordances.verbs",
                "post_arrival_affordances.skills",
                "post_arrival_affordances.roll_gate.approaches",
                "post_arrival_affordances.preconditions_satisfied",
                "push_candidate.candidate_id",
                "push_candidate.route_id",
                "push_candidate.skill_or_characteristic",
                "push_candidate.requires_changed_method",
                "push_candidate.consequence_source",
                "push_limitation_candidate.reason_code",
                "weapon_candidates.weapon_id",
                "destination_candidates.destination_identity.canonical_name",
                "destination_candidates.destination_identity.aliases",
                "destination_candidates.location_tags",
                "destination_candidates.entry_authority",
            ],
        },
        "destination_match_contract": {
            "identity_fields": [
                "destination_identity.canonical_name",
                "destination_identity.aliases",
            ],
            "descriptive_fields": ["location_tags"],
            "match_rule": (
                "For immediate travel, bind the requested place to exactly one "
                "candidate's authored canonical_name or aliases. Use location_tags "
                "only as supporting structured context; do not select when identity "
                "remains ambiguous. entry_authority only states whether an exact "
                "candidate is independently reachable; never infer it from names."
            ),
        },
        "post_arrival_match_contract": {
            "execution_phase": "post_arrival",
            "max_selected_affordances": 3,
            "executed_goals": 1,
            "match_rule": (
                "Select only supplied post-arrival affordances owned by the exact "
                "immediate destination. If one natural goal touches multiple "
                "affordances, order them from the most immediate executable goal "
                "to later goals; the runtime compiles exactly one goal. Never "
                "select one for planning, mention, or travel alone."
            ),
        },
    }
    return (
        request,
        affordance_index,
        post_arrival_index,
        {str(row["scene_id"]): row for row in destinations},
    )


def build_action_request(
    campaign_dir: Path | str,
    player_text: str,
    player_intent_rich: dict[str, Any] | None,
    *,
    character_path: Path | str | None = None,
    investigator_id: str | None = None,
    character_snapshot: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    """Return the model request plus internal current-scene authority indexes."""
    request, affordance_index, _post_arrival_index, destination_index = (
        _build_action_request_with_authority(
            campaign_dir,
            player_text,
            player_intent_rich,
            character_path=character_path,
            investigator_id=investigator_id,
            character_snapshot=character_snapshot,
        )
    )
    return request, affordance_index, destination_index


def _default_evaluator(request: dict[str, Any]) -> dict[str, Any]:
    adapter = _load_module(
        "runtime_action_adapter",
        REPO_ROOT / "runtime" / "adapters" / "compiler" / "action_adapter.py",
    )
    return adapter.resolve_action(request)


def _compile_post_arrival_route(
    route_ids: list[str],
    route_index: dict[str, dict[str, Any]],
    action_atoms: list[Any],
) -> tuple[str, dict[str, Any]]:
    """Compile touched destination affordances into one executable goal.

    Ranking consumes only supplied structured IDs/tags.  Authored prerequisite
    routes win first; otherwise exact atom bindings, roll-gate approaches,
    verbs, skills, and target tags provide deterministic evidence.  Stable
    semantic output order is the final tie-breaker.
    """
    selected_routes = [route_index[route_id] for route_id in route_ids]
    ranking: list[dict[str, Any]] = []
    for ordinal, route_id in enumerate(route_ids):
        route = route_index[route_id]
        prerequisite_for = sum(
            route_id in set(other.get("requires_completed_route_ids") or [])
            for other in selected_routes
            if other is not route
        )
        approaches = {
            (str(item.get("verb") or ""), str(item.get("skill") or ""))
            for item in (route.get("roll_gate") or {}).get("approaches") or []
            if isinstance(item, dict)
        }
        verbs = {str(value) for value in route.get("verbs") or []}
        skills = {str(value) for value in route.get("skills") or []}
        targets = {str(value) for value in route.get("target_entities") or []}
        evidence = {
            "prerequisite_for_selected_count": prerequisite_for,
            "exact_route_atom_count": 0,
            "roll_approach_atom_count": 0,
            "verb_atom_count": 0,
            "skill_atom_count": 0,
            "target_atom_count": 0,
        }
        for atom in action_atoms:
            if not isinstance(atom, dict):
                continue
            verb = str(atom.get("verb") or "")
            skill = str(atom.get("skill") or atom.get("roll_skill") or "")
            target = str(atom.get("target") or "")
            evidence["exact_route_atom_count"] += int(
                atom.get("route_id") == route_id
            )
            evidence["roll_approach_atom_count"] += int(
                (verb, skill) in approaches
            )
            evidence["verb_atom_count"] += int(bool(verb and verb in verbs))
            evidence["skill_atom_count"] += int(bool(skill and skill in skills))
            evidence["target_atom_count"] += int(
                bool(target and target in targets)
            )
        score = (
            evidence["prerequisite_for_selected_count"],
            evidence["exact_route_atom_count"],
            evidence["roll_approach_atom_count"],
            evidence["verb_atom_count"],
            evidence["skill_atom_count"],
            evidence["target_atom_count"],
            -ordinal,
        )
        ranking.append({
            "route_id": route_id,
            "semantic_order": ordinal,
            "structured_evidence": evidence,
            "_score": score,
        })
    winner = max(ranking, key=lambda row: row["_score"])
    selected = str(winner["route_id"])
    receipt = {
        "schema_version": 1,
        "kind": "single_post_arrival_goal_compilation",
        "policy": "prerequisite_then_structured_semantic_evidence",
        "selected_route_id": selected,
        "suppressed_route_ids": [
            route_id for route_id in route_ids if route_id != selected
        ],
        "ranking": [
            {key: value for key, value in row.items() if key != "_score"}
            for row in ranking
        ],
    }
    return selected, receipt


def _compile_post_arrival_atom(
    route: dict[str, Any], action_atoms: list[Any]
) -> tuple[dict[str, Any], dict[str, Any]]:
    route_id = str(route["affordance_id"])
    approaches = {
        (str(item.get("verb") or ""), str(item.get("skill") or ""))
        for item in (route.get("roll_gate") or {}).get("approaches") or []
        if isinstance(item, dict)
    }
    verbs = {str(value) for value in route.get("verbs") or []}
    skills = {str(value) for value in route.get("skills") or []}
    targets = {str(value) for value in route.get("target_entities") or []}
    candidates: list[tuple[tuple[int, ...], int, dict[str, Any]]] = []
    for ordinal, atom in enumerate(action_atoms):
        if not isinstance(atom, dict) or str(atom.get("verb") or "") == "move":
            continue
        verb = str(atom.get("verb") or "")
        skill = str(atom.get("skill") or atom.get("roll_skill") or "")
        target = str(atom.get("target") or "")
        score = (
            int(atom.get("route_id") == route_id),
            int((verb, skill) in approaches),
            int(bool(verb and verb in verbs)),
            int(bool(skill and skill in skills)),
            int(bool(target and target in targets)),
            int(atom.get("requires_roll") is True),
            -ordinal,
        )
        candidates.append((score, ordinal, atom))
    if candidates:
        _score, selected_ordinal, selected_atom = max(
            candidates, key=lambda row: row[0]
        )
        compiled = json.loads(json.dumps(selected_atom, ensure_ascii=False))
        compiled["route_id"] = route_id
        suppressed = [
            str(atom.get("id") or f"atom-{ordinal}")
            for _candidate_score, ordinal, atom in candidates
            if ordinal != selected_ordinal
        ]
        source = "semantic_atom_ranking"
    else:
        if isinstance(route.get("roll_gate"), dict):
            raise RuntimeError(
                "roll-gated post-arrival goal lacks a normalized approach atom"
            )
        route_verbs = [str(value) for value in route.get("verbs") or [] if _text(value)]
        route_targets = [
            str(value) for value in route.get("target_entities") or [] if _text(value)
        ]
        compiled = {
            "id": f"post-arrival-{route_id}",
            "verb": route_verbs[0] if route_verbs else "complete-affordance",
            "requires_roll": False,
            "route_id": route_id,
        }
        if route_targets:
            compiled["target"] = route_targets[0]
        suppressed = []
        source = "authored_route_default"
    receipt = {
        "schema_version": 1,
        "kind": "single_post_arrival_atom_compilation",
        "source": source,
        "selected_atom_id": str(compiled.get("id") or ""),
        "suppressed_atom_ids": suppressed,
        "suppressed_atoms_execution_policy": "audit_only_not_executable",
        "suppressed_atoms_may_authorize_rolls": False,
    }
    return compiled, receipt


def resolve_player_action(
    campaign_dir: Path | str,
    player_text: str,
    player_intent_rich: dict[str, Any] | None,
    *,
    character_path: Path | str | None = None,
    investigator_id: str | None = None,
    evaluator: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    character_snapshot: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return enriched intent plus a fail-closed semantic resolution receipt."""
    if character_snapshot is None and character_path is not None:
        character_snapshot = _guarded_character(
            Path(campaign_dir), character_path, investigator_id
        )
    original = json.loads(json.dumps(player_intent_rich or {}, ensure_ascii=False))
    post_arrival_action: dict[str, Any] | None = None
    post_goal_compilation: dict[str, Any] | None = None
    try:
        (
            request,
            affordance_index,
            post_arrival_index,
            destination_index,
        ) = _build_action_request_with_authority(
            campaign_dir, player_text, original, character_path=character_path,
            investigator_id=investigator_id,
            character_snapshot=character_snapshot,
        )
        result = (evaluator or _default_evaluator)(request)
        raw_proposal = result.get("keeper_proposal")
        proposal_rejection: dict[str, Any] | None = None
        if not isinstance(raw_proposal, dict):
            raw_proposal = coc_keeper_planner.compatibility_proposal(result, request)
        try:
            keeper_proposal = coc_keeper_planner.validate_keeper_proposal(
                raw_proposal,
                request=request,
                resolution=result,
            )
        except Exception as proposal_exc:
            # A malformed discretionary plan must not crash or mutate the turn.
            # Degrade explicitly to the legacy semantic receipt; hard capability
            # and state validation below remains unchanged.
            proposal_rejection = {
                "schema_version": 1,
                "status": "rejected_to_compatibility_fallback",
                "error_type": type(proposal_exc).__name__,
                "reason": str(proposal_exc),
            }
            keeper_proposal = coc_keeper_planner.validate_keeper_proposal(
                coc_keeper_planner.compatibility_proposal(result, request),
                request=request,
                resolution=result,
            )
        result = dict(result)
        result["keeper_proposal"] = keeper_proposal
        result["rule_advice"] = json.loads(json.dumps(
            request.get("rule_advice") or [], ensure_ascii=False
        ))
        if proposal_rejection is not None:
            result["keeper_proposal_rejection"] = proposal_rejection
        ruling = keeper_proposal["rule_ruling"]
        if ruling["decision"] == "roll":
            normalized_atoms = json.loads(json.dumps(
                result.get("normalized_action_atoms") or [], ensure_ascii=False
            ))
            for atom in normalized_atoms:
                if not isinstance(atom, dict):
                    continue
                if _text(atom.get("skill") or atom.get("roll_skill")) == ruling["skill"]:
                    atom["kind"] = ruling["operation_kind"]
                    atom["difficulty"] = ruling["difficulty"]
                    atom["bonus_penalty_dice"] = ruling["bonus_penalty_dice"]
            result["normalized_action_atoms"] = normalized_atoms
        push_request = result.get("push_request")
        selected_ids = [
            str(item) for item in (result.get("matched_affordance_ids") or [])
        ]
        duplicate_ids = set(affordance_index).intersection(post_arrival_index)
        if duplicate_ids:
            raise RuntimeError(
                "action resolver candidate IDs are ambiguous across execution phases"
            )
        combined_affordance_index = {**affordance_index, **post_arrival_index}
        if any(item not in combined_affordance_index for item in selected_ids):
            raise RuntimeError("action resolver selected an unavailable affordance")
        post_arrival_ids = [
            item for item in selected_ids if item in post_arrival_index
        ]
        matched_ids = [item for item in selected_ids if item in affordance_index]
        destination = result.get("matched_destination_scene_id")
        if post_arrival_ids and push_request is None:
            if destination is None:
                raise RuntimeError(
                    "post-arrival action requires an exact selected destination"
                )
            if any(
                post_arrival_index[item].get("destination_scene_id")
                != str(destination)
                for item in post_arrival_ids
            ):
                raise RuntimeError(
                    "post-arrival action does not belong to the selected destination"
                )
            semantic_atoms = result.get("normalized_action_atoms")
            if not isinstance(semantic_atoms, list) or not semantic_atoms:
                semantic_atoms = original.get("action_atoms") or []
            selected_post_id, post_goal_compilation = (
                _compile_post_arrival_route(
                    post_arrival_ids, post_arrival_index, semantic_atoms
                )
            )
            post_arrival_ids = [selected_post_id]
            result = dict(result)
            result["matched_affordance_ids"] = [
                *matched_ids, selected_post_id,
            ]
            result["post_arrival_goal_compilation"] = json.loads(json.dumps(
                post_goal_compilation, ensure_ascii=False
            ))
        if destination is not None:
            candidate = destination_index.get(str(destination))
            if candidate is None:
                raise RuntimeError("action resolver selected an unavailable destination")
            required = set(candidate.get("required_affordance_ids") or [])
            if required and not required.intersection(matched_ids):
                raise RuntimeError("locked destination resolution lacks its public unlocking affordance")
            result = dict(result)
            if isinstance(candidate.get("entry_authority"), dict):
                result["destination_entry_authority"] = json.loads(json.dumps(
                    candidate["entry_authority"], ensure_ascii=False
                ))
            else:
                result.pop("destination_entry_authority", None)
            # A selected destination executes movement, not an arbitrary
            # active-scene route that happened to look semantically similar to
            # the destination action.  Keep only routes explicitly required to
            # unlock this exact destination, or routes authored as legal before
            # departure.  All ownership comes from the bounded active-scene
            # index; no player prose is inspected.
            allowed_before_departure = required | {
                affordance_id
                for affordance_id, affordance in affordance_index.items()
                if affordance.get("allow_before_departure") is True
            }
            dropped_source_routes = [
                affordance_id for affordance_id in matched_ids
                if affordance_id not in allowed_before_departure
            ]
            if dropped_source_routes:
                matched_ids = [
                    affordance_id for affordance_id in matched_ids
                    if affordance_id in allowed_before_departure
                ]
                result = dict(result)
                result["matched_affordance_ids"] = [
                    *matched_ids, *post_arrival_ids,
                ]
                result["source_route_normalization"] = {
                    "owner_scene_id": request["active_scene"]["scene_id"],
                    "destination_scene_id": str(destination),
                    "dropped_route_ids": dropped_source_routes,
                    "reason": "destination_move_does_not_consume_source_scene_route",
                }
            # Selecting an exact bounded reachable destination is itself the
            # structured movement effect.  Semantic models may reasonably call
            # a compound action such as "go to the library and research" an
            # investigation; preserve that secondary meaning for audit while
            # normalizing the executable intent to movement. Candidate and gate
            # validation above remain fail closed, so this cannot authorize an
            # invented or unavailable location.
            if result.get("primary_intent") != "move":
                result = dict(result)
                result["reported_primary_intent"] = result.get("primary_intent")
                result["primary_intent"] = "move"
                result["intent_normalization"] = (
                    "bounded_destination_selection_implies_move"
                )
        semantic_subsystem_request: dict[str, Any] | None = None
        push_binding_rejection = result.get("push_binding_rejection")
        if push_binding_rejection is not None:
            candidate = request.get("push_candidate")
            if not isinstance(candidate, dict):
                raise RuntimeError("push binding rejection lacks its canonical candidate")
            semantic_subsystem_request = _push_limitation_request(
                candidate,
                reason_code=(
                    "push_binding_rejected:"
                    + str(push_binding_rejection.get("reason") or "invalid_binding")
                ),
                binding_rejected=True,
            )
        elif push_request is not None:
            candidate = request.get("push_candidate")
            valid_binding = (
                isinstance(push_request, dict)
                and set(push_request) == {"candidate_id", "changed_method_summary"}
                and isinstance(candidate, dict)
                and push_request.get("candidate_id") == candidate.get("candidate_id")
                and _text(push_request.get("changed_method_summary")) is not None
                and candidate.get("requires_changed_method") is True
                and result.get("matched_destination_scene_id") is None
                and result.get("no_match") is not True
                and not post_arrival_ids
            )
            if not valid_binding:
                if not isinstance(candidate, dict):
                    raise RuntimeError("semantic push request lacks a canonical candidate")
                result = dict(result)
                result.update({
                    "matched_affordance_ids": [],
                    "matched_destination_scene_id": None,
                    "normalized_action_atoms": [],
                    "push_request": None,
                    "no_match": True,
                    "push_binding_rejection": {
                        "schema_version": 1,
                        "field": "push_request",
                        "action": "rejected_to_typed_limitation",
                        "reason": "invalid_exact_binding",
                    },
                })
                matched_ids = []
                post_arrival_ids = []
                semantic_subsystem_request = _push_limitation_request(
                    candidate,
                    reason_code="push_binding_rejected:invalid_exact_binding",
                    binding_rejected=True,
                )
            else:
                atoms = result.get("normalized_action_atoms") or []
                matched_ids = []
                result = dict(result)
                result["matched_affordance_ids"] = []
                if atoms:
                    result["normalized_action_atoms"] = []
                    result.setdefault("push_action_normalization", {
                        "schema_version": 1,
                        "field": "normalized_action_atoms",
                        "action": "suppressed_for_canonical_push",
                        "reason": "push_request_owns_exact_failed_action",
                        "suppressed_atom_count": len(atoms),
                    })
                semantic_subsystem_request = {
                    "kind": "push_offer",
                    "continuation_id": candidate["continuation_id"],
                    "changed_method_evidence": {
                        "changed": True,
                        "source": "player_proposal",
                        "summary": push_request["changed_method_summary"].strip(),
                    },
                    "announced_consequence": json.loads(json.dumps(
                        candidate["announced_consequence"], ensure_ascii=False
                    )),
                    "source_time_profile": json.loads(json.dumps(
                        (candidate.get("consequence_source") or {}).get("time_profile"),
                        ensure_ascii=False,
                    )),
                }
        else:
            candidate = request.get("push_candidate")
            limitation = request.get("push_limitation_candidate")
            unresolved_candidate = (
                candidate if isinstance(candidate, dict)
                else limitation if isinstance(limitation, dict)
                else None
            )
            if (
                isinstance(unresolved_candidate, dict)
                and matched_ids == [unresolved_candidate.get("route_id")]
                and result.get("matched_destination_scene_id") is None
                and result.get("no_match") is not True
            ):
                semantic_subsystem_request = _push_limitation_request(
                    unresolved_candidate,
                    reason_code=(
                        "eligible_failed_roll_requires_push_resolution"
                        if isinstance(candidate, dict)
                        else str(unresolved_candidate["reason_code"])
                    ),
                )
        if (
            semantic_subsystem_request is None
            and result.get("no_match") is True
            and str(
                original.get("primary_intent")
                or result.get("primary_intent")
                or ""
            ) == "move"
        ):
            semantic_subsystem_request = _destination_limitation_request(
                request.get("destination_candidates") or [],
                affordance_index,
            )
        candidate_atoms = result.get("normalized_action_atoms")
        if not isinstance(candidate_atoms, list) or not candidate_atoms:
            candidate_atoms = original.get("action_atoms") or []
        character = _guarded_character(
            Path(campaign_dir), character_path, investigator_id,
            character_snapshot,
        )
        character_skills = character.get("skills") if isinstance(character.get("skills"), dict) else {}
        matched_affordances = [
            combined_affordance_index[route_id]
            for route_id in [*matched_ids, *post_arrival_ids]
        ]
        claimed_gate_atoms: set[int] = set()
        keeper_rule_ruling = keeper_proposal.get("rule_ruling") or {}
        keeper_overrides = set(keeper_rule_ruling.get("overridden_advice_ids") or [])
        for route in matched_affordances:
            gate = route.get("roll_gate")
            if not isinstance(gate, dict) or semantic_subsystem_request is not None:
                continue
            route_advice_id = (
                f"route:{route['affordance_id']}:authored-roll-gate"
            )
            if (
                keeper_rule_ruling.get("decision") == "no_roll"
                and keeper_proposal.get("source") == "model"
            ):
                # Authored roll gates are strong Keeper advice, not state or dice
                # invariants. The private Keeper may waive one explicitly; the
                # ruling and cited override remain in the audit receipt.
                if route_advice_id not in keeper_overrides:
                    raise RuntimeError(
                        "Keeper waived an authored roll gate without citing its advice override"
                    )
                continue
            approaches = {
                (str(item["verb"]), str(item["skill"]))
                for item in gate.get("approaches") or []
                if isinstance(item, dict)
                and _text(item.get("verb"))
                and _text(item.get("skill"))
            }
            matching_atoms = [
                atom for atom in candidate_atoms
                if isinstance(atom, dict)
                and atom.get("requires_roll") is True
                and (
                    str(atom.get("verb") or ""),
                    str(atom.get("skill") or ""),
                ) in approaches
            ]
            if not matching_atoms and keeper_rule_ruling.get("decision") == "roll":
                matching_atoms = [
                    atom for atom in candidate_atoms
                    if isinstance(atom, dict)
                    and atom.get("requires_roll") is True
                    and _text(atom.get("skill") or atom.get("roll_skill"))
                    == keeper_rule_ruling.get("skill")
                ]
                if (
                    matching_atoms
                    and keeper_proposal.get("source") == "model"
                    and route_advice_id not in keeper_overrides
                ):
                    raise RuntimeError(
                        "Keeper selected a non-authored roll approach without citing its advice override"
                    )
            if (
                len(matching_atoms) != 1
                or id(matching_atoms[0]) in claimed_gate_atoms
            ):
                raise RuntimeError(
                    "matched roll-gated affordance requires exactly one supplied approach"
                )
            atom = matching_atoms[0]
            claimed_gate_atoms.add(id(atom))
            atom["route_id"] = route["affordance_id"]
            atom.setdefault("difficulty", gate["difficulty"])
            atom.setdefault("stakes", gate["stakes"])
            ordinary_failure = gate.get("ordinary_failure")
            if isinstance(ordinary_failure, dict):
                atom.setdefault("failure_outcome_mode", ordinary_failure.get("mode"))
                atom.setdefault("failure_effect", ordinary_failure.get("summary"))
                atom.setdefault(
                    "localized_failure_effects",
                    json.loads(json.dumps(
                        ordinary_failure.get("localized_summaries") or {},
                        ensure_ascii=False,
                    )),
                )
            atom["authored_roll_gate"] = True
            atom["fumble_consequence"] = json.loads(json.dumps(
                gate["fumble_consequence"], ensure_ascii=False
            ))
            atom["push_failure_consequence"] = json.loads(json.dumps(
                gate["push_failure_consequence"], ensure_ascii=False
            ))
            if isinstance(route.get("time_profile"), dict):
                atom["push_time_profile"] = json.loads(json.dumps(
                    route["time_profile"], ensure_ascii=False
                ))
        blocked_routes = [
            route for route in matched_affordances
            if route.get("runtime_status") == "NOT_IMPLEMENTED"
        ]
        if blocked_routes:
            operations = list(dict.fromkeys(
                str(operation)
                for route in blocked_routes
                for operation in (route.get("required_typed_operations") or [])
                if _text(operation)
            ))
            raise AuthoredOperationNotImplementedError(
                [str(route["affordance_id"]) for route in blocked_routes],
                operations,
            )
        for atom in candidate_atoms:
            if not isinstance(atom, dict) or atom.get("requires_roll") is False:
                continue
            if (
                post_arrival_ids
                and str(atom.get("verb") or "") != "move"
                and atom.get("route_id") not in {
                    *matched_ids, *post_arrival_ids,
                }
            ):
                # Extra semantic decomposition atoms are audit evidence for
                # the one compiled destination goal, not independent roll
                # authority. Only route-bound atoms proceed to rules checks.
                continue
            skill = _text(atom.get("skill") or atom.get("roll_skill"))
            if skill is None:
                continue
            declaring_routes = [
                route for route in matched_affordances
                if route.get("skills")
            ]
            legal_routes = [
                route for route in matched_affordances
                if not route.get("skills") or skill in route.get("skills", [])
            ]
            keeper_skill_override = bool(
                keeper_proposal.get("source") == "model"
                and keeper_rule_ruling.get("decision") == "roll"
                and skill == keeper_rule_ruling.get("skill")
                and any(
                    f"route:{route['affordance_id']}:authored-roll-gate"
                    in keeper_overrides
                    for route in declaring_routes
                )
            )
            if declaring_routes and not legal_routes and not keeper_skill_override:
                raise RuntimeError(
                    f"action resolver selected skill {skill!r} outside matched affordance skills"
                )
            if not legal_routes and keeper_skill_override:
                legal_routes = list(declaring_routes)
            minimums = [
                int((route.get("skill_minimums") or {})[skill])
                for route in legal_routes
                if skill in (route.get("skill_minimums") or {})
            ]
            if minimums:
                raw_score = character_skills.get(skill)
                if isinstance(raw_score, dict):
                    raw_score = raw_score.get("value")
                if (
                    not isinstance(raw_score, int)
                    or isinstance(raw_score, bool)
                    or raw_score < max(minimums)
                ) and not keeper_skill_override:
                    raise RuntimeError(
                        f"action resolver selected {skill!r} below authored minimum {max(minimums)}"
                    )
        if post_arrival_ids:
            route_id = post_arrival_ids[0]
            route = post_arrival_index[route_id]
            post_atom, atom_compilation = _compile_post_arrival_atom(
                route, candidate_atoms
            )
            post_primary = str(
                result.get("reported_primary_intent")
                or result.get("primary_intent")
                or "ambiguous"
            )
            if post_primary == "move":
                original_primary = str(original.get("primary_intent") or "")
                post_primary = (
                    original_primary if original_primary and original_primary != "move"
                    else "ambiguous"
                )
            post_arrival_action = {
                "schema_version": 1,
                "kind": "post_arrival_action",
                "destination_scene_id": str(destination),
                "route_id": route_id,
                "route_owner_scene_id": str(route.get("route_owner_scene_id") or ""),
                "primary_intent": post_primary,
                "target_entities": [
                    str(value)
                    for value in (result.get("normalized_target_entities") or [])
                    if _text(value)
                ],
                "action_atom": json.loads(json.dumps(post_atom, ensure_ascii=False)),
                "route_snapshot": json.loads(json.dumps(route, ensure_ascii=False)),
                "semantic_evidence": {
                    "evaluator_id": str(result.get("evaluator_id") or ""),
                    "confidence": result.get("confidence"),
                    "reason": str(result.get("reason") or ""),
                    "goal_compilation": json.loads(json.dumps(
                        post_goal_compilation or {}, ensure_ascii=False
                    )),
                    "atom_compilation": atom_compilation,
                },
            }
            if isinstance(route.get("npc_interaction"), dict):
                post_arrival_action["npc_interaction"] = json.loads(json.dumps(
                    route["npc_interaction"], ensure_ascii=False
                ))
            result = dict(result)
            result["semantic_matched_affordance_ids"] = list(selected_ids)
            result["matched_affordance_ids"] = list(matched_ids)
            result["normalized_action_atoms"] = [
                json.loads(json.dumps(atom, ensure_ascii=False))
                for atom in candidate_atoms
                if isinstance(atom, dict)
                and (
                    str(atom.get("verb") or "") == "move"
                    or atom.get("route_id") in matched_ids
                )
            ]
            result["post_arrival_action"] = json.loads(json.dumps(
                post_arrival_action, ensure_ascii=False
            ))
    except Exception as exc:  # fail closed: preserve intent, never guess by prose
        blocked = isinstance(exc, AuthoredOperationNotImplementedError)
        receipt = {
            "schema_version": 1,
            "status": "blocked" if blocked else "unresolved",
            "source": "kp_semantic_action_resolver",
            "error_type": type(exc).__name__,
            "error": str(exc),
            "matched_affordance_ids": [],
            "matched_destination_scene_id": None,
            "no_match": True,
        }
        if blocked:
            receipt["blocker_code"] = "AUTHORED_TYPED_OPERATION_NOT_IMPLEMENTED"
            receipt["blocked_route_ids"] = list(exc.route_ids)
            receipt["required_typed_operations"] = list(exc.operations)
        original["action_resolution"] = receipt
        return original, receipt

    normalized_entities = [
        str(item) for item in (result.get("normalized_target_entities") or []) if _text(item)
    ]
    original_entities = [
        str(item) for item in (original.get("target_entities") or []) if _text(item)
    ]
    original["target_entities"] = list(dict.fromkeys([*normalized_entities, *original_entities]))
    normalized_atoms = result.get("normalized_action_atoms")
    if semantic_subsystem_request is not None:
        original["action_atoms"] = []
        original["semantic_subsystem_request"] = semantic_subsystem_request
    elif isinstance(normalized_atoms, list) and normalized_atoms:
        original["action_atoms"] = json.loads(json.dumps(normalized_atoms, ensure_ascii=False))
    if result.get("primary_intent"):
        original["primary_intent"] = str(result["primary_intent"])
    if post_arrival_action is not None:
        original["post_arrival_action"] = json.loads(json.dumps(
            post_arrival_action, ensure_ascii=False
        ))
    npc_interactions: list[dict[str, Any]] = []
    for index, affordance_id in enumerate(matched_ids, start=1):
        interaction = affordance_index[affordance_id].get("npc_interaction")
        if not isinstance(interaction, dict):
            continue
        row = {
            key: value for key, value in interaction.items()
            if key in {"npc_id", "tactic", "fact_id", "leverage_id", "skill", "difficulty"}
        }
        row["request_id"] = f"action-resolution-{index}-{affordance_id}"
        npc_interactions.append(row)
    if npc_interactions:
        original["npc_interactions"] = npc_interactions
    receipt = {
        key: value for key, value in result.items()
        if key not in {"normalized_action_atoms", "normalized_target_entities"}
    }
    receipt.update({"status": "resolved", "source": "kp_semantic_action_resolver"})
    original["action_resolution"] = receipt
    return original, receipt
