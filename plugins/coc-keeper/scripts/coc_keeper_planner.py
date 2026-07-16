#!/usr/bin/env python3
"""Private LLM Keeper proposal contract and deterministic capability firewall.

The Keeper model owns semantic and dramatic judgment.  This module does not
play the game for it: it projects compiled private context and rulebook advice,
validates the model's capability references, and exposes a small public-safe
rendering plan.  Dice, secret authorization, exact state writes, and idempotent
transactions remain outside this module in the deterministic runtime.
"""
from __future__ import annotations

import json
from typing import Any


SCENE_ACTIONS = frozenset({
    "REVEAL", "DEEPEN", "PRESSURE", "CHARACTER", "CHOICE", "CUT",
    "MONTAGE", "SUBSYSTEM", "RECOVER", "PAYOFF",
})
RESOLUTION_MODES = frozenset({"authored", "improvised", "clarify", "subsystem"})
RULE_DECISIONS = frozenset({"no_roll", "roll", "defer"})
RULE_OPERATION_KINDS = frozenset({"skill_check", "characteristic_check"})
DIFFICULTIES = frozenset({"regular", "hard", "extreme"})
NPC_TACTICS = frozenset({
    "none", "answer", "deflect", "lie", "bargain", "pressure",
    "question", "reassure", "react",
})
NARRATIVE_BEATS = frozenset({
    "advance", "deepen", "character", "pressure", "transition",
    "clarify", "aftermath", "quiet",
})
ENDING_MODES = frozenset({
    "actionable_hook", "open_question", "consequence", "choice", "silence",
})

KEEPER_PROPOSAL_CONTRACT = {
    "schema_version": 1,
    "authority": (
        "The private Keeper chooses semantic and dramatic rulings. Python advice "
        "is advisory unless marked hard_invariant. The Keeper may override advice "
        "with a reason, but may reference only supplied capabilities and may not "
        "write state directly."
    ),
    "required_fields": [
        "schema_version", "source", "resolution_mode", "scene_action",
        "player_goal", "fictional_method", "rule_ruling", "npc_ruling",
        "narration_plan", "rationale",
    ],
    "resolution_modes": sorted(RESOLUTION_MODES),
    "scene_actions": sorted(SCENE_ACTIONS),
    "scene_action_semantics": {
        "REVEAL": "Commit an authorized clue/fact capability now; not generic investigation.",
        "DEEPEN": "Handle or deepen the present action without committing a new clue or scene transition.",
        "PRESSURE": "Activate an available scene/threat pressure consequence.",
        "CHARACTER": "Let an available NPC act or respond from agenda and state.",
        "CHOICE": "Ask a necessary clarification or surface a genuine meaningful fork; never a route menu fallback.",
        "CUT": "Commit immediate travel to the exact selected legal destination.",
        "MONTAGE": "Compress a longer low-risk sequence of actions or elapsed work.",
        "SUBSYSTEM": "Enter or continue combat, chase, sanity, magic, or another typed subsystem.",
        "RECOVER": "Recover a missed investigative lead/Idea-Roll valve; never means physical rest or catching breath.",
        "PAYOFF": "Bring a relevant established memory, prior choice, or fear back into the current beat.",
    },
    "rule_decisions": sorted(RULE_DECISIONS),
    "npc_tactics": sorted(NPC_TACTICS),
    "hard_invariants": [
        "only supplied capability IDs may authorize durable effects",
        "the model never chooses numeric dice results",
        "the model never writes campaign state or logs",
        "Keeper-only facts require a supplied revealable fact/clue capability",
        "Push uses only the supplied opaque continuation candidate",
    ],
}


def _copy(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False))


def _text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _string_list(value: Any, field: str, *, max_items: int = 8) -> list[str]:
    if not isinstance(value, list):
        raise RuntimeError(f"keeper_proposal.{field} must be a list")
    rows: list[str] = []
    for item in value:
        text = _text(item)
        if text is None:
            raise RuntimeError(
                f"keeper_proposal.{field} must contain non-empty strings"
            )
        if text not in rows:
            rows.append(text)
    # Presentation/advice list length is not a gameplay invariant. Normalize a
    # verbose Keeper plan instead of rejecting the entire semantic judgment.
    return rows[:max_items]


def _iter_clues(clue_graph: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for conclusion in clue_graph.get("conclusions") or []:
        if not isinstance(conclusion, dict):
            continue
        for clue in conclusion.get("clues") or []:
            if isinstance(clue, dict) and _text(clue.get("clue_id")):
                rows.append(clue)
    return rows


def build_rule_advice(
    affordances: list[dict[str, Any]],
    character: dict[str, Any],
) -> list[dict[str, Any]]:
    """Build cited Keeper guidance without turning discretion into rejection."""
    advice: list[dict[str, Any]] = [{
        "advice_id": "core:roll-only-for-meaningful-uncertainty",
        "classification": "keeper_discretion",
        "recommendation": (
            "Do not roll for routine or consequence-free actions. Roll only when "
            "the outcome is uncertain and both success and failure change play."
        ),
        "may_override": True,
    }]
    skills = character.get("skills") if isinstance(character.get("skills"), dict) else {}
    for route in affordances:
        if not isinstance(route, dict):
            continue
        route_id = _text(route.get("affordance_id"))
        gate = route.get("roll_gate")
        if route_id is None or not isinstance(gate, dict):
            continue
        approaches = [
            {
                "verb": str(item.get("verb")),
                "skill": str(item.get("skill")),
                "investigator_value": (
                    (skills.get(str(item.get("skill"))) or {}).get("value")
                    if isinstance(skills.get(str(item.get("skill"))), dict)
                    else skills.get(str(item.get("skill")))
                ),
            }
            for item in gate.get("approaches") or []
            if isinstance(item, dict)
            and _text(item.get("verb"))
            and _text(item.get("skill"))
        ]
        advice.append({
            "advice_id": f"route:{route_id}:authored-roll-gate",
            "classification": "authored_rule_advice",
            "route_id": route_id,
            "recommendation": {
                "decision": "roll",
                "operation_kind": "skill_check",
                "difficulty": gate.get("difficulty"),
                "stakes": gate.get("stakes"),
                "approaches": approaches,
            },
            "may_override": True,
            "override_requirement": (
                "Explain why the fictional method warrants no roll, another legal "
                "skill, or another difficulty."
            ),
        })
    return advice


def build_private_keeper_context(
    *,
    scene: dict[str, Any],
    story_graph: dict[str, Any],
    world: dict[str, Any],
    character: dict[str, Any],
    npc_agendas: dict[str, Any],
    clue_graph: dict[str, Any],
    public_affordances: list[dict[str, Any]],
    post_arrival_affordances: list[dict[str, Any]],
    destinations: list[dict[str, Any]],
) -> dict[str, Any]:
    """Project compiled Keeper-only context for one private planner call."""
    scene_npc_ids = {
        str(value) for value in scene.get("npc_ids") or [] if _text(value)
    }
    relevant_npcs = [
        _copy(row)
        for row in npc_agendas.get("npcs") or []
        if isinstance(row, dict) and str(row.get("npc_id") or "") in scene_npc_ids
    ]
    relevant_clue_ids = {
        str(value) for value in scene.get("available_clues") or [] if _text(value)
    }
    for route in [*public_affordances, *post_arrival_affordances]:
        if not isinstance(route, dict):
            continue
        for clue_id in route.get("grants_clue_ids") or []:
            if _text(clue_id):
                relevant_clue_ids.add(str(clue_id))
    relevant_clues = [
        _copy(clue)
        for clue in _iter_clues(clue_graph)
        if str(clue.get("clue_id") or "") in relevant_clue_ids
    ]
    npc_fact_capabilities: list[dict[str, Any]] = []
    for npc in relevant_npcs:
        known = {str(value) for value in npc.get("known_fact_ids") or []}
        revealable = {str(value) for value in npc.get("revealable_fact_ids") or []}
        for fact in npc.get("facts") or []:
            if not isinstance(fact, dict) or not _text(fact.get("fact_id")):
                continue
            fact_id = str(fact["fact_id"])
            npc_fact_capabilities.append({
                "npc_id": str(npc.get("npc_id") or ""),
                "fact_id": fact_id,
                "clue_id": fact.get("clue_id"),
                "known_by_npc": fact_id in known,
                "revealable": fact_id in revealable,
                "min_trust": fact.get("min_trust", 0),
            })
    completed = [
        str(row.get("route_id"))
        for row in world.get("route_completion_receipts") or []
        if isinstance(row, dict)
        and row.get("status") == "consumed"
        and _text(row.get("route_id"))
    ]
    blocked = [
        str(row.get("route_id"))
        for row in world.get("route_completion_receipts") or []
        if isinstance(row, dict)
        and row.get("status") == "blocked"
        and _text(row.get("route_id"))
    ]
    return {
        "schema_version": 1,
        "privilege": "keeper_private_compiled_ir",
        "active_scene": _copy(scene),
        "legal_destinations": _copy(destinations),
        "present_or_scene_npcs": relevant_npcs,
        "npc_fact_capabilities": npc_fact_capabilities,
        "relevant_clues": relevant_clues,
        "world_summary": {
            "active_scene_id": world.get("active_scene_id"),
            "discovered_clue_ids": list(world.get("discovered_clue_ids") or []),
            "completed_route_ids": completed,
            "blocked_route_ids": blocked,
            "unlocked_scene_ids": list(world.get("unlocked_scene_ids") or []),
            "flags": _copy(world.get("flags") or {}),
            "current_time": world.get("current_time"),
        },
        "investigator": {
            "id": character.get("id"),
            "name": character.get("name") or character.get("display_name"),
            "skills": _copy(character.get("skills") or {}),
            "characteristics": _copy(character.get("characteristics") or {}),
            "conditions": _copy(character.get("conditions") or []),
        },
        "improvisation_boundary": _copy(
            scene.get("allowed_improvisation")
            or scene.get("improvisation_boundaries")
            or []
        ),
        "story_structure": {
            "scene_count": len(story_graph.get("scenes") or []),
            "current_dramatic_question": scene.get("dramatic_question"),
            "scene_type": scene.get("scene_type"),
            "tone": _copy(scene.get("tone") or []),
            "pressure_moves": _copy(scene.get("pressure_moves") or []),
        },
    }


def _canonical_rule_ruling(
    raw: Any,
    *,
    known_advice_ids: set[str],
) -> dict[str, Any]:
    if not isinstance(raw, dict) or set(raw) != {
        "decision", "operation_kind", "skill", "difficulty",
        "bonus_penalty_dice", "accepted_advice_ids",
        "overridden_advice_ids", "reason",
    }:
        raise RuntimeError("keeper_proposal.rule_ruling has an invalid shape")
    decision = raw.get("decision")
    if decision not in RULE_DECISIONS:
        raise RuntimeError("keeper_proposal.rule_ruling.decision is invalid")
    accepted = _string_list(
        raw.get("accepted_advice_ids"), "rule_ruling.accepted_advice_ids"
    )
    overridden = _string_list(
        raw.get("overridden_advice_ids"), "rule_ruling.overridden_advice_ids"
    )
    if set(accepted) & set(overridden):
        raise RuntimeError("Keeper advice cannot be both accepted and overridden")
    if (set(accepted) | set(overridden)) - known_advice_ids:
        raise RuntimeError("keeper_proposal references unknown rule advice")
    reason = _text(raw.get("reason"))
    if reason is None:
        raise RuntimeError("keeper_proposal.rule_ruling.reason is required")
    operation_kind = raw.get("operation_kind")
    skill = raw.get("skill")
    difficulty = raw.get("difficulty")
    bonus = raw.get("bonus_penalty_dice")
    normalizations: list[dict[str, Any]] = []
    if isinstance(bonus, bool) or not isinstance(bonus, int) or not -2 <= bonus <= 2:
        raise RuntimeError("keeper_proposal bonus_penalty_dice must be an integer -2..2")
    if decision == "roll":
        if operation_kind not in RULE_OPERATION_KINDS:
            raise RuntimeError("a Keeper roll requires a supported operation_kind")
        if _text(skill) is None or difficulty not in DIFFICULTIES:
            raise RuntimeError("a Keeper roll requires skill and canonical difficulty")
    elif any(value is not None for value in (operation_kind, skill, difficulty)) or bonus != 0:
        # These fields have no executable meaning when the Keeper explicitly
        # declined/deferred a roll. Normalize harmless model verbosity instead
        # of throwing away the semantic/dramatic ruling.
        normalizations.append({
            "field": "rule_ruling.roll_operation",
            "action": "cleared_for_non_roll_decision",
            "reason": "no_roll/defer carries no executable roll authority",
        })
        operation_kind = None
        skill = None
        difficulty = None
        bonus = 0
    return {
        "decision": decision,
        "operation_kind": operation_kind,
        "skill": _text(skill),
        "difficulty": difficulty,
        "bonus_penalty_dice": bonus,
        "accepted_advice_ids": accepted,
        "overridden_advice_ids": overridden,
        "reason": reason,
        "normalizations": normalizations,
    }


def _canonical_npc_ruling(raw: Any, request: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(raw, dict) or set(raw) != {
        "npc_id", "tactic", "fact_id", "reason",
    }:
        raise RuntimeError("keeper_proposal.npc_ruling has an invalid shape")
    npc_id = _text(raw.get("npc_id"))
    fact_id = _text(raw.get("fact_id"))
    tactic = raw.get("tactic")
    reason = _text(raw.get("reason"))
    if tactic not in NPC_TACTICS or reason is None:
        raise RuntimeError("keeper_proposal.npc_ruling is invalid")
    context = request.get("keeper_context") or {}
    npc_ids = {
        str(row.get("npc_id"))
        for row in context.get("present_or_scene_npcs") or []
        if isinstance(row, dict) and _text(row.get("npc_id"))
    }
    if npc_id is not None and npc_id not in npc_ids:
        raise RuntimeError("keeper_proposal selected an unavailable NPC")
    if tactic == "none" and (npc_id is not None or fact_id is not None):
        raise RuntimeError("npc tactic none must not select an NPC or fact")
    if tactic != "none" and npc_id is None:
        raise RuntimeError("an NPC tactic requires an available npc_id")
    if fact_id is not None:
        allowed = {
            (str(row.get("npc_id")), str(row.get("fact_id")))
            for row in context.get("npc_fact_capabilities") or []
            if isinstance(row, dict)
            and row.get("known_by_npc") is True
            and row.get("revealable") is True
        }
        if (str(npc_id), fact_id) not in allowed:
            raise RuntimeError("keeper_proposal selected an unauthorized NPC fact")
    return {
        "npc_id": npc_id,
        "tactic": tactic,
        "fact_id": fact_id,
        "reason": reason,
    }


def _canonical_narration_plan(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict) or set(raw) != {
        "beat", "tone", "sensory_focus", "end_with", "objective",
    }:
        raise RuntimeError("keeper_proposal.narration_plan has an invalid shape")
    if raw.get("beat") not in NARRATIVE_BEATS or raw.get("end_with") not in ENDING_MODES:
        raise RuntimeError("keeper_proposal narration beat/end mode is invalid")
    objective = _text(raw.get("objective"))
    if objective is None:
        raise RuntimeError("keeper_proposal narration objective is required")
    return {
        "beat": raw["beat"],
        "tone": _string_list(raw.get("tone"), "narration_plan.tone", max_items=4),
        "sensory_focus": _string_list(
            raw.get("sensory_focus"), "narration_plan.sensory_focus", max_items=3
        ),
        "end_with": raw["end_with"],
        # Keeper-private prose. public_projection intentionally drops it.
        "objective": objective,
    }


def validate_keeper_proposal(
    proposal: Any,
    *,
    request: dict[str, Any],
    resolution: dict[str, Any],
) -> dict[str, Any]:
    """Validate proposal shape/references, never its discretionary judgment."""
    expected = set(KEEPER_PROPOSAL_CONTRACT["required_fields"])
    if not isinstance(proposal, dict) or set(proposal) != expected:
        raise RuntimeError("keeper_proposal has unsupported or missing fields")
    if proposal.get("schema_version") != 1 or proposal.get("source") not in {
        "model", "compatibility_fallback",
    }:
        raise RuntimeError("keeper_proposal identity is invalid")
    mode = proposal.get("resolution_mode")
    scene_action = proposal.get("scene_action")
    if mode not in RESOLUTION_MODES or scene_action not in SCENE_ACTIONS:
        raise RuntimeError("keeper_proposal mode or scene_action is invalid")
    player_goal = _text(proposal.get("player_goal"))
    fictional_method = _text(proposal.get("fictional_method"))
    rationale = _text(proposal.get("rationale"))
    if player_goal is None or fictional_method is None or rationale is None:
        raise RuntimeError("keeper_proposal goal, method, and rationale are required")
    advice_ids = {
        str(row.get("advice_id"))
        for row in request.get("rule_advice") or []
        if isinstance(row, dict) and _text(row.get("advice_id"))
    }
    rule_ruling = _canonical_rule_ruling(
        proposal.get("rule_ruling"), known_advice_ids=advice_ids
    )
    atoms = [
        atom for atom in resolution.get("normalized_action_atoms") or []
        if isinstance(atom, dict) and atom.get("requires_roll") is not False
    ]
    if rule_ruling["decision"] == "roll":
        matching = [
            atom for atom in atoms
            if _text(atom.get("skill") or atom.get("roll_skill"))
            == rule_ruling["skill"]
        ]
        if len(matching) != 1:
            raise RuntimeError(
                "Keeper roll ruling requires exactly one matching action atom"
            )
    elif atoms:
        raise RuntimeError("Keeper no_roll/defer ruling conflicts with roll atoms")
    if mode == "clarify" and resolution.get("no_match") is not True:
        raise RuntimeError("clarify mode must remain explicitly unresolved")
    if mode in {"authored", "improvised", "subsystem"} and resolution.get("no_match") is True:
        raise RuntimeError("understood Keeper proposals must not use no_match")
    return {
        "schema_version": 1,
        "source": proposal["source"],
        "resolution_mode": mode,
        "scene_action": scene_action,
        "player_goal": player_goal,
        "fictional_method": fictional_method,
        "rule_ruling": rule_ruling,
        "npc_ruling": _canonical_npc_ruling(proposal.get("npc_ruling"), request),
        "narration_plan": _canonical_narration_plan(proposal.get("narration_plan")),
        "rationale": rationale,
    }


def compatibility_proposal(
    resolution: dict[str, Any], request: dict[str, Any]
) -> dict[str, Any]:
    """Explicit degraded-mode proposal for fixtures or older hosts."""
    primary = str(resolution.get("primary_intent") or "ambiguous")
    matched = list(resolution.get("matched_affordance_ids") or [])
    destination = resolution.get("matched_destination_scene_id")
    no_match = resolution.get("no_match") is True
    if no_match:
        mode, scene_action, beat = "clarify", "CHOICE", "clarify"
    elif destination is not None:
        mode, scene_action, beat = "authored", "CUT", "transition"
    elif primary in {"combat", "flee", "cast"}:
        mode, scene_action, beat = "subsystem", "SUBSYSTEM", "pressure"
    elif primary == "social":
        mode, scene_action, beat = (
            "authored" if matched else "improvised", "CHARACTER", "character"
        )
    elif primary == "montage":
        mode, scene_action, beat = "improvised", "MONTAGE", "advance"
    elif primary == "investigate":
        mode = "authored" if matched else "improvised"
        scene_action, beat = ("REVEAL", "advance") if matched else ("DEEPEN", "deepen")
    else:
        mode, scene_action, beat = "improvised", "DEEPEN", "deepen"
    atoms = [
        atom for atom in resolution.get("normalized_action_atoms") or []
        if isinstance(atom, dict) and atom.get("requires_roll") is not False
    ]
    atom = atoms[0] if len(atoms) == 1 else None
    decision = "roll" if atom is not None else ("defer" if no_match else "no_roll")
    skill = _text((atom or {}).get("skill") or (atom or {}).get("roll_skill"))
    difficulty = (atom or {}).get("difficulty") or ("regular" if atom else None)
    operation_kind = (
        str((atom or {}).get("kind") or "skill_check") if atom else None
    )
    if operation_kind not in RULE_OPERATION_KINDS and atom:
        operation_kind = "skill_check"
    return {
        "schema_version": 1,
        "source": "compatibility_fallback",
        "resolution_mode": mode,
        "scene_action": scene_action,
        "player_goal": str(request.get("player_text") or "resolve the declared action").strip(),
        "fictional_method": str(request.get("player_text") or "declared method").strip(),
        "rule_ruling": {
            "decision": decision,
            "operation_kind": operation_kind,
            "skill": skill,
            "difficulty": difficulty,
            "bonus_penalty_dice": int((atom or {}).get("bonus_penalty_dice", 0) or 0),
            "accepted_advice_ids": [],
            "overridden_advice_ids": [],
            "reason": "Compatibility ruling derived from legacy semantic output.",
        },
        "npc_ruling": {
            "npc_id": None,
            "tactic": "none",
            "fact_id": None,
            "reason": "Legacy semantic output supplied no private NPC judgment.",
        },
        "narration_plan": {
            "beat": beat,
            "tone": [],
            "sensory_focus": [],
            "end_with": "actionable_hook" if not no_match else "open_question",
            "objective": "Render the settled action without inventing durable facts.",
        },
        "rationale": "Legacy host compatibility fallback; deterministic director remains available.",
    }


def proposal_from_context(ctx: dict[str, Any]) -> dict[str, Any] | None:
    rich = ctx.get("player_intent_rich")
    resolution = rich.get("action_resolution") if isinstance(rich, dict) else None
    proposal = resolution.get("keeper_proposal") if isinstance(resolution, dict) else None
    return proposal if isinstance(proposal, dict) else None


def public_projection(proposal: Any) -> dict[str, Any] | None:
    """Return only non-factual rendering directives; drop private rationale."""
    if not isinstance(proposal, dict):
        return None
    narration = proposal.get("narration_plan") or {}
    npc = proposal.get("npc_ruling") or {}
    return {
        "schema_version": 1,
        "resolution_mode": proposal.get("resolution_mode"),
        "scene_action": proposal.get("scene_action"),
        "rule_decision": (proposal.get("rule_ruling") or {}).get("decision"),
        "npc_tactic": npc.get("tactic"),
        "npc_id": npc.get("npc_id"),
        "narration": {
            "beat": narration.get("beat"),
            "tone": list(narration.get("tone") or []),
            # Free-form private sensory planning can accidentally encode a
            # Keeper-only fact. The public renderer chooses sensory detail from
            # its independently sanitized scene_anchor instead.
            "sensory_focus": [],
            "end_with": narration.get("end_with"),
        },
        "authority": (
            "This is presentation guidance only. Facts, clues, permissions, state "
            "changes, and numeric rolls still require their dedicated envelope fields."
        ),
    }


_TACTIC_SEEDS = {
    "answer": "Answer the investigator directly, but only with approved facts.",
    "deflect": "Deflect the question naturally without inventing a factual answer.",
    "lie": "Respond evasively; do not expose that the response is a lie.",
    "bargain": "Make the exchange feel conditional without inventing a settled agreement.",
    "pressure": "Press the investigator for an immediate response or concession.",
    "question": "Ask a pointed question about what the investigator really wants.",
    "reassure": "Offer human reassurance without inventing new facts or promises.",
    "react": "React in character to the investigator's method before play moves on.",
}


def apply_npc_ruling(
    moves: list[dict[str, Any]], proposal: dict[str, Any] | None
) -> list[dict[str, Any]]:
    """Apply the model-selected conversational tactic without authorizing facts."""
    if not isinstance(proposal, dict):
        return moves
    ruling = proposal.get("npc_ruling")
    if not isinstance(ruling, dict) or ruling.get("tactic") in {None, "none"}:
        return moves
    npc_id = str(ruling.get("npc_id") or "")
    tactic = str(ruling.get("tactic") or "")
    decorated: list[dict[str, Any]] = []
    for move in moves:
        row = _copy(move)
        if str(row.get("npc_id") or "") == npc_id:
            row["keeper_tactic"] = tactic
            row["keeper_tactic_source"] = "validated_private_keeper_proposal"
            row["dialogue_seed"] = _TACTIC_SEEDS.get(tactic, row.get("dialogue_seed", ""))
        decorated.append(row)
    return decorated
