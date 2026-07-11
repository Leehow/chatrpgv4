#!/usr/bin/env python3
"""COC Narration Contract — verifies a DirectorPlan is narration-ready.

Parallel to coc_story_harness's GM-quality assertions, this checker verifies
the CONTRACT between the Story Director's output and the narration layer
(coc-keeper-play SKILL step 5: "Narrate consequences per
DirectorPlan.narrative_directives"). We cannot unit-test LLM narration output
(non-deterministic), but we CAN assert that every DirectorPlan carries
sufficient directives for an LLM narrator to write a compliant scene without
violating constraints.

Spec: docs/superpowers/specs/2026-07-05-story-director-design.md (Section 6)
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from coc_narration_style import (
    guard_player_visible_text,
    player_facing_style_contract as _player_facing_style_contract,
)

# guard_player_visible_text findings use severity "rewrite" (advisory).
# Only "block" would gate a turn; the prose guard does not emit it today.
NARRATION_GUARD_BLOCKING_SEVERITY = "block"


class NarrationGuardBlockedError(RuntimeError):
    """Raised when a player-visible guard finding has blocking severity."""


def is_blocking_severity(severity: str | None) -> bool:
    """True only for the guard's hard-gate severity (``block``)."""
    return str(severity or "") == NARRATION_GUARD_BLOCKING_SEVERITY


def _append_text_field(
    fields: list[tuple[str, str]], path: str, value: Any
) -> None:
    if isinstance(value, str) and value.strip():
        fields.append((path, value))


def _append_list_text_fields(
    fields: list[tuple[str, str]],
    path_prefix: str,
    items: Any,
    *,
    dict_keys: tuple[str, ...] = ("text", "summary", "cue", "prompt", "title"),
) -> None:
    if not isinstance(items, list):
        return
    for index, item in enumerate(items):
        if isinstance(item, str):
            _append_text_field(fields, f"{path_prefix}[{index}]", item)
            continue
        if not isinstance(item, dict):
            continue
        for key in dict_keys:
            _append_text_field(
                fields, f"{path_prefix}[{index}].{key}", item.get(key)
            )


def iter_player_visible_text_fields(
    envelope: dict[str, Any] | None,
    *,
    turn: dict[str, Any] | None = None,
) -> list[tuple[str, str]]:
    """Collect (field_path, text) pairs for player-visible prose.

    Walks the narration envelope (and optional turn overlays) for strings that
    may reach the player. Keeper-only fields such as ``rationale`` and
    ``must_not_reveal`` secret refs are intentionally skipped.
    """
    fields: list[tuple[str, str]] = []
    env = envelope if isinstance(envelope, dict) else {}
    turn_rec = turn if isinstance(turn, dict) else {}

    _append_text_field(
        fields,
        "narration_envelope.dramatic_question",
        env.get("dramatic_question"),
    )

    reveals = env.get("approved_reveals") or {}
    if isinstance(reveals, dict):
        _append_list_text_fields(
            fields,
            "narration_envelope.approved_reveals.must_include",
            reveals.get("must_include"),
            dict_keys=("text", "summary", "cue", "player_visible_anchor"),
        )
        _append_list_text_fields(
            fields,
            "narration_envelope.approved_reveals.leads",
            reveals.get("leads"),
        )
        _append_list_text_fields(
            fields,
            "narration_envelope.approved_reveals.clues",
            reveals.get("clues"),
            dict_keys=("player_safe_summary", "summary", "text"),
        )

    _append_list_text_fields(
        fields,
        "narration_envelope.rule_results",
        env.get("rule_results"),
        dict_keys=(
            "bonus_reveal",
            "player_visible_cost",
            "investigator_display_name",
            "skill",
            "outcome",
            "consequence_summary",
        ),
    )

    scene_anchor = env.get("scene_anchor")
    if isinstance(scene_anchor, dict):
        for key in ("display_name", "player_safe_summary"):
            _append_text_field(
                fields, f"narration_envelope.scene_anchor.{key}", scene_anchor.get(key)
            )
        _append_list_text_fields(
            fields,
            "narration_envelope.scene_anchor.sensory_anchors",
            scene_anchor.get("sensory_anchors"),
        )
        _append_list_text_fields(
            fields,
            "narration_envelope.scene_anchor.location_tags",
            scene_anchor.get("location_tags"),
        )

    _append_list_text_fields(
        fields,
        "narration_envelope.npc_moves",
        env.get("npc_moves"),
        dict_keys=("display_name", "dialogue_seed", "emotional_tone", "voice"),
    )

    choice_frame = env.get("choice_frame")
    if not isinstance(choice_frame, dict):
        choice_frame = turn_rec.get("choice_frame") or {}
    if isinstance(choice_frame, dict):
        for key in ("prompt", "question", "summary", "player_entry"):
            _append_text_field(
                fields, f"narration_envelope.choice_frame.{key}", choice_frame.get(key)
            )
        _append_list_text_fields(
            fields,
            "narration_envelope.choice_frame.visible_affordances",
            choice_frame.get("visible_affordances"),
            dict_keys=("cue", "label", "text", "summary"),
        )

    storylet_moves = env.get("storylet_moves")
    if not isinstance(storylet_moves, list):
        storylet_moves = turn_rec.get("storylet_moves") or []
    _append_list_text_fields(
        fields,
        "narration_envelope.storylet_moves",
        storylet_moves,
        dict_keys=("cue", "title", "summary", "player_visible_summary"),
    )

    pressure_moves = env.get("pressure_moves")
    if not isinstance(pressure_moves, list):
        pressure_moves = turn_rec.get("pressure_moves") or []
    _append_list_text_fields(
        fields,
        "narration_envelope.pressure_moves",
        pressure_moves,
        dict_keys=("text", "summary", "cue", "description"),
    )

    return fields


def audit_player_visible_fields(
    envelope: dict[str, Any] | None,
    *,
    turn: dict[str, Any] | None = None,
    decision_id: str | None = None,
    ts: str | None = None,
    language: str = "zh-Hans",
) -> dict[str, Any]:
    """Run ``guard_player_visible_text`` over player-visible envelope fields.

    Returns structured audit records suitable for ``narration-audit.jsonl``.
    Findings with severity ``rewrite`` are advisory (audit trail only).
    Severity ``block`` sets ``blocking=True``; callers may raise
    ``NarrationGuardBlockedError``.
    """
    stamp = ts or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    records: list[dict[str, Any]] = []
    blocking = False
    for field, text in iter_player_visible_text_fields(envelope, turn=turn):
        guarded = guard_player_visible_text(text, language=language)
        for finding in guarded.get("findings") or []:
            if not isinstance(finding, dict):
                continue
            severity = str(finding.get("severity") or "rewrite")
            records.append({
                "decision_id": decision_id,
                "ts": stamp,
                "field": field,
                "finding_code": finding.get("rule_id"),
                "severity": severity,
            })
            if is_blocking_severity(severity):
                blocking = True
    return {
        "records": records,
        "findings_count": len(records),
        "blocking": blocking,
        "decision_id": decision_id,
        "ts": stamp,
    }


def append_narration_audit_records(
    campaign_dir: Path | str,
    records: list[dict[str, Any]],
) -> None:
    """Append structured audit records to ``logs/narration-audit.jsonl``."""
    if not records:
        return
    path = Path(campaign_dir) / "logs" / "narration-audit.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def audit_final_text(
    text: str,
    *,
    decision_id: str | None = None,
    language: str = "zh-Hans",
    ts: str | None = None,
) -> dict[str, Any]:
    """Guard ``final_text`` and return audit records with ``field=final_text``.

    Callers should apply ``guarded["final_text"]`` when ``changed`` is true and
    rewrite-severity findings are present, then append ``records`` via
    ``append_narration_audit_records``.
    """
    stamp = ts or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    guarded = guard_player_visible_text(text, language=language)
    records: list[dict[str, Any]] = []
    for finding in guarded.get("findings") or []:
        if not isinstance(finding, dict):
            continue
        severity = str(finding.get("severity") or "rewrite")
        records.append({
            "decision_id": decision_id,
            "ts": stamp,
            "field": "final_text",
            "finding_code": finding.get("rule_id"),
            "severity": severity,
        })
    return {
        "guarded": guarded,
        "records": records,
        "findings_count": len(records),
        "decision_id": decision_id,
        "ts": stamp,
    }


ACTIONS = ["REVEAL", "DEEPEN", "PRESSURE", "CHARACTER", "CHOICE", "CUT",
           "MONTAGE", "SUBSYSTEM", "RECOVER", "PAYOFF"]
HORROR_STAGES = {"ordinary", "wrongness", "pattern", "revelation"}


def player_facing_style_contract(language: str = "zh-Hans") -> dict[str, Any]:
    """Return narrator-facing style constraints for player-visible prose."""
    return _player_facing_style_contract(language)


def _read_json(path: Path, fallback: Any = None) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def _looks_like_secret_id(token: str) -> bool:
    """True when token is a compact structured id, not free-form secret prose.

    Position-based fallback ids (secret_001) and authored ids
    (secret-polyp-horror-full-stat-block) qualify. Long prose without an
    id:description split does not — those get secret_NNN at normalize time.
    """
    if not token or " " in token or "\n" in token:
        return False
    if len(token) > 80:
        return False
    return True


def _secret_id(secret: Any, *, index: int | None = None) -> str:
    """Extract a stable secret id from a keeper_secrets entry.

    Accepts:
    - structured {id, ...} refs (preferred narrator-facing form)
    - 'id: description' strings (prose stays planner-side only)
    - bare id tokens
    - bare prose → secret_NNN by position (no prose classification)
    """
    if isinstance(secret, dict):
        sid = str(secret.get("id") or "").strip()
        if sid:
            return sid
        if index is not None:
            return f"secret_{index + 1:03d}"
        return ""
    text = str(secret or "").strip()
    if not text:
        if index is not None:
            return f"secret_{index + 1:03d}"
        return ""
    if ": " in text:
        prefix = text.split(": ", 1)[0].strip()
        if _looks_like_secret_id(prefix):
            return prefix
    if _looks_like_secret_id(text):
        return text
    if index is not None:
        return f"secret_{index + 1:03d}"
    return text


def normalize_keeper_secret_refs(secrets: Any) -> list[dict[str, str]]:
    """Normalize keeper_secrets to narrator-safe {id, category} refs.

    Prose bodies stay in improvisation-boundaries (planner-side). Narrator-
    facing plans and envelopes must only carry these refs — never the prose.
    Does not classify meaning by scanning secret text (Semantic Matcher
    Constitution); bare prose entries get stable positional ids.
    """
    if not isinstance(secrets, list):
        return []
    refs: list[dict[str, str]] = []
    for index, secret in enumerate(secrets):
        if isinstance(secret, dict):
            sid = _secret_id(secret, index=index)
            category = str(secret.get("category") or "keeper_secret").strip() or "keeper_secret"
        else:
            sid = _secret_id(secret, index=index)
            category = "keeper_secret"
        if not sid:
            continue
        refs.append({"id": sid, "category": category})
    return refs


def secret_ref_ids(secrets: Any) -> list[str]:
    """Return ordered secret ids from raw or normalized keeper_secrets."""
    return [ref["id"] for ref in normalize_keeper_secret_refs(secrets)]


def _clue_lookup_player_safe(clue_graph: dict[str, Any] | None) -> dict[str, str]:
    """Map clue_id -> player_safe_summary from a clue-graph (structured fields only)."""
    lookup: dict[str, str] = {}
    if not isinstance(clue_graph, dict):
        return lookup
    for conclusion in clue_graph.get("conclusions") or []:
        if not isinstance(conclusion, dict):
            continue
        for clue in conclusion.get("clues") or []:
            if not isinstance(clue, dict):
                continue
            clue_id = str(clue.get("clue_id") or clue.get("id") or "").strip()
            if not clue_id:
                continue
            visibility = str(clue.get("visibility") or "player-safe").strip().lower()
            if visibility in {"keeper-only", "keeper_only", "secret"}:
                continue
            summary = (
                clue.get("player_safe_summary")
                or clue.get("player_visible_anchor")
                or ""
            )
            summary = str(summary).strip()
            if summary:
                lookup[clue_id] = summary
    return lookup


def _approved_reveal_clue_ids(plan: dict[str, Any]) -> list[str]:
    """Prefer committed reveals after rules backfill; else planned reveal ids."""
    resolved = plan.get("resolved_clue_policy") or {}
    if isinstance(resolved, dict):
        committed = [
            str(cid) for cid in (resolved.get("committed_reveals") or []) if cid
        ]
        if committed:
            return committed
        recovered = [
            str(cid) for cid in (resolved.get("fallback_recovered") or []) if cid
        ]
        if recovered:
            return recovered
    clue_policy = plan.get("clue_policy") or {}
    return [str(cid) for cid in (clue_policy.get("reveal") or []) if cid]


def _project_approved_reveal_clues(
    plan: dict[str, Any],
    clue_graph: dict[str, Any] | None,
) -> list[dict[str, str]]:
    lookup = _clue_lookup_player_safe(clue_graph)
    clues: list[dict[str, str]] = []
    for clue_id in _approved_reveal_clue_ids(plan):
        summary = lookup.get(clue_id, "")
        entry: dict[str, str] = {"clue_id": clue_id}
        if summary:
            entry["player_safe_summary"] = summary
        clues.append(entry)
    return clues


def _is_bonus_rule_result(result: dict[str, Any]) -> bool:
    if result.get("clue_bonus") is True:
        return True
    contract = result.get("roll_contract") or {}
    if isinstance(contract, dict):
        mode = str(contract.get("failure_outcome_mode") or "")
        group = str(contract.get("roll_density_group") or "")
        if mode == "bonus_with_cost":
            return True
        if group.startswith("clue-bonus:"):
            return True
    return False


def _project_rule_results(
    plan: dict[str, Any],
    *,
    investigator_display_name: str | None = None,
) -> list[dict[str, Any]]:
    """Player-safe settled rule outcomes for the narrator (no dice math)."""
    raw = plan.get("rules_results")
    if not isinstance(raw, list):
        raw = plan.get("rule_results")
    if not isinstance(raw, list):
        return []

    resolved = plan.get("resolved_clue_policy") or {}
    if not isinstance(resolved, dict):
        resolved = {}
    failure = (plan.get("narrative_directives") or {}).get("failure_consequence") or {}
    if not isinstance(failure, dict):
        failure = {}
    failure_costs = [
        str(c) for c in (failure.get("costs") or []) if str(c).strip()
    ]
    bonus_cost = resolved.get("bonus_cost")
    bonus_reveal = resolved.get("bonus_reveal")
    inv_name = str(investigator_display_name or "").strip()

    projected: list[dict[str, Any]] = []
    for result in raw:
        if not isinstance(result, dict) or result.get("skipped"):
            continue
        if "outcome" not in result and "success" not in result and "roll" not in result:
            continue
        skill = (
            result.get("skill")
            or result.get("characteristic")
            or result.get("kind")
            or ""
        )
        entry: dict[str, Any] = {
            "skill": skill,
            "investigator_display_name": inv_name,
            "outcome": result.get("outcome"),
            "success": bool(result.get("success")),
        }
        if result.get("san_loss") is not None:
            entry["san_loss"] = result.get("san_loss")
        consequence = result.get("announced_consequence")
        if (
            result.get("pushed") is True
            and not entry["success"]
            and isinstance(consequence, dict)
            and isinstance(consequence.get("summary"), str)
            and consequence["summary"].strip()
        ):
            # Only the already-announced player-safe summary crosses this
            # boundary. The typed effect and private push context stay Keeper-side.
            entry["consequence_summary"] = consequence["summary"].strip()

        if not entry["success"]:
            costs: list[str] = []
            if _is_bonus_rule_result(result) and bonus_cost:
                costs.append(str(bonus_cost))
            for cost in failure_costs:
                if cost not in costs:
                    costs.append(cost)
            if len(costs) == 1:
                entry["player_visible_cost"] = costs[0]
            elif costs:
                entry["player_visible_cost"] = costs
        elif entry["success"] and bonus_reveal and _is_bonus_rule_result(result):
            entry["bonus_reveal"] = str(bonus_reveal)

        projected.append(entry)
    return projected


def _scene_display_name(scene: dict[str, Any]) -> str:
    for key in ("display_name", "title", "player_safe_summary", "live_summary"):
        value = scene.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    tags = scene.get("location_tags")
    if isinstance(tags, list):
        for tag in tags:
            text = str(tag or "").strip()
            if text:
                return text
    return str(scene.get("scene_id") or "").strip()


def _build_scene_anchor(active_scene: dict[str, Any] | None) -> dict[str, Any]:
    """Player-safe scene grounding: display name + sensory anchors only."""
    scene = active_scene if isinstance(active_scene, dict) else {}
    if not scene:
        return {}

    sensory: list[str] = []
    seen: set[str] = set()

    def _push(value: Any) -> None:
        text = str(value or "").strip()
        if not text or text in seen:
            return
        seen.add(text)
        sensory.append(text)

    for item in scene.get("sensory_anchors") or []:
        _push(item)
    for item in scene.get("tone") or []:
        _push(item)

    location_tags = [
        str(tag).strip()
        for tag in (scene.get("location_tags") or [])
        if str(tag or "").strip()
    ]

    anchor: dict[str, Any] = {
        "scene_id": scene.get("scene_id"),
        "display_name": _scene_display_name(scene),
        "sensory_anchors": sensory,
    }
    if location_tags:
        anchor["location_tags"] = location_tags
    return anchor


def _npc_dialogue_seed(move: dict[str, Any]) -> str:
    """Short player-safe dialogue seed or demeanor hint from structured fields."""
    for reaction in move.get("active_reactions") or []:
        if not isinstance(reaction, dict):
            continue
        visibility = str(reaction.get("visibility") or "player_visible").strip().lower()
        if visibility not in {"player_visible", "player-safe", "public", ""}:
            continue
        seed = reaction.get("line_seed")
        if isinstance(seed, str) and seed.strip():
            return seed.strip()
    for key in ("dialogue_seed", "voice"):
        value = move.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    persona = move.get("persona") or {}
    if isinstance(persona, dict):
        for cue in persona.get("surface_cues") or []:
            text = str(cue or "").strip()
            if text:
                return text
    tone = move.get("emotional_tone")
    if isinstance(tone, str) and tone.strip():
        return tone.strip()
    return ""


def _npc_display_name(move: dict[str, Any]) -> str:
    for key in ("display_name", "name"):
        value = move.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    persona = move.get("persona") or {}
    if isinstance(persona, dict):
        name_rec = persona.get("name")
        if isinstance(name_rec, dict):
            value = name_rec.get("value")
            if isinstance(value, str) and value.strip():
                return value.strip()
        elif isinstance(name_rec, str) and name_rec.strip():
            return name_rec.strip()
    return str(move.get("npc_id") or "").strip()


def _sanitize_persona(persona: Any) -> dict[str, Any]:
    """Whitelist persona to structured tags + player-safe surface cues."""
    if not isinstance(persona, dict):
        return {}
    safe: dict[str, Any] = {}
    tags = [str(t) for t in (persona.get("tags") or []) if str(t or "").strip()]
    if tags:
        safe["tags"] = tags
    cues = [str(c) for c in (persona.get("surface_cues") or []) if str(c or "").strip()]
    if cues:
        safe["surface_cues"] = cues
    return safe


def _sanitize_agency_moves(agency_moves: Any) -> list[dict[str, Any]]:
    """Keep only agency moves whose structured visibility is player-visible."""
    safe: list[dict[str, Any]] = []
    for move in agency_moves or []:
        if not isinstance(move, dict):
            continue
        visibility = str(move.get("visibility") or "player_visible").strip().lower()
        if visibility not in {"player_visible", "player-safe", "public"}:
            continue
        safe.append(move)
    return safe


def _sanitize_npc_move(move: dict[str, Any]) -> dict[str, Any]:
    """Minimum-privilege NPC move for the narrator (no secret prose).

    Structured gate (Semantic Matcher Constitution): when ``has_secret`` is
    true, the raw ``agenda`` prose is keeper-facing (it often IS the secret,
    e.g. an undead NPC's true motive) and is dropped from the envelope. The
    narrator still gets emotional_tone / relationship / dialogue_seed for
    surface behavior. NPCs without a secret keep their agenda, which by
    construction describes observable surface wants.
    """
    has_secret = bool(move.get("has_secret"))
    safe_move: dict[str, Any] = {
        "npc_id": move.get("npc_id"),
        "display_name": _npc_display_name(move),
        "dialogue_seed": _npc_dialogue_seed(move),
        "emotional_tone": move.get("emotional_tone"),
        "has_secret": has_secret,
        "secret_limit": move.get("secret_limit") or "",
        "disposition_source": move.get("disposition_source"),
        "relationship_to_investigators": move.get("relationship_to_investigators"),
        "social_role": move.get("social_role"),
        "persona": _sanitize_persona(move.get("persona")),
        "agency_moves": _sanitize_agency_moves(move.get("agency_moves")),
    }
    if not has_secret:
        safe_move["agenda"] = move.get("agenda")
    if move.get("secret_id"):
        safe_move["secret_id"] = move["secret_id"]
    return safe_move


_REDIRECTION_PLAYER_SAFE_STRATEGIES = frozenset({
    "in_world_consequences",
    "npc_influence",
    "more_information",
})


def _sanitize_redirection(redirection: Any) -> dict[str, Any] | None:
    """Player-safe redirection passthrough: strategy + display grounding only.

    Drops reason_code / internal rationale / keeper-only grounding keys.
    Never emits hard_denial.
    """
    if not isinstance(redirection, dict):
        return None
    strategy = str(redirection.get("strategy") or "").strip()
    if strategy not in _REDIRECTION_PLAYER_SAFE_STRATEGIES:
        return None
    raw_grounding = redirection.get("grounding") if isinstance(redirection.get("grounding"), dict) else {}
    grounding: dict[str, Any] = {}
    for key in (
        "npc_id",
        "display_name",
        "boundary_id",
        "category",
        "consequence_hint",
        "scene_id",
        "clue_id",
    ):
        value = raw_grounding.get(key)
        if isinstance(value, str) and value.strip():
            grounding[key] = value.strip()
        elif value is not None and key in {"npc_id", "boundary_id", "scene_id", "clue_id"} and str(value).strip():
            grounding[key] = str(value).strip()
    return {"strategy": strategy, "grounding": grounding}


def _project_rules_requests(plan: dict[str, Any]) -> list[dict[str, Any]]:
    """Return narrator-safe rule requests without Keeper-only effect data.

    A push consequence has two deliberately different views: its summary is
    announced to the player before confirmation, while its structured effect
    remains in the subsystem's private pending context until resolution.  The
    DirectorPlan needs the full request to execute the command, but the
    narration envelope must expose only the announced summary.
    """
    projected: list[dict[str, Any]] = []
    for request in plan.get("rules_requests") or []:
        if not isinstance(request, dict):
            continue
        safe_request = dict(request)
        if request.get("kind") == "push_offer":
            consequence = request.get("announced_consequence")
            if isinstance(consequence, dict):
                summary = consequence.get("summary")
                safe_request["announced_consequence"] = (
                    {"summary": summary}
                    if isinstance(summary, str) and summary.strip()
                    else {}
                )
        projected.append(safe_request)
    return projected


def build_narration_envelope(
    plan: dict[str, Any],
    *,
    clue_graph: dict[str, Any] | None = None,
    active_scene: dict[str, Any] | None = None,
    investigator_display_name: str | None = None,
) -> dict[str, Any]:
    """Build the minimum-privilege narrator payload from a DirectorPlan.

    Includes this-turn approved reveals (with player_safe_summary bodies when
    the clue-graph is supplied), settled rule_results, scene sensory anchors,
    tone, constraints, and must_not_reveal as {id, category} only. Keeper
    secret prose must never appear in the serialized envelope.
    """
    directives = plan.get("narrative_directives") or {}
    clue_policy = plan.get("clue_policy") or {}
    mnr_refs = normalize_keeper_secret_refs(directives.get("must_not_reveal") or [])
    clue_ids = _approved_reveal_clue_ids(plan)
    npc_moves = [
        _sanitize_npc_move(move)
        for move in (plan.get("npc_moves") or [])
        if isinstance(move, dict)
    ]
    scene = active_scene
    if not isinstance(scene, dict) or not scene:
        scene = plan.get("active_scene") if isinstance(plan.get("active_scene"), dict) else {}
    envelope: dict[str, Any] = {
        "decision_id": plan.get("decision_id"),
        "scene_action": plan.get("scene_action"),
        "dramatic_question": plan.get("dramatic_question"),
        "handoff": plan.get("handoff"),
        "approved_reveals": {
            "clue_ids": list(clue_ids),
            "clues": _project_approved_reveal_clues(plan, clue_graph),
            "must_include": list(directives.get("must_include") or []),
            "leads": list(clue_policy.get("leads") or []),
            "fallback_routes": list(clue_policy.get("fallback_routes") or []),
        },
        "tone": list(directives.get("tone") or []),
        "must_not_reveal": mnr_refs,
        "improvisation_allowed": list(directives.get("improvisation_allowed") or []),
        "horror_escalation_stage": directives.get("horror_escalation_stage"),
        "content_constraints": list(directives.get("content_constraints") or []),
        "player_facing_style": directives.get("player_facing_style"),
        "npc_moves": npc_moves,
        "pressure_moves": list(plan.get("pressure_moves") or []),
        "storylet_moves": list(plan.get("storylet_moves") or []),
        "choice_frame": plan.get("choice_frame") or {},
        "rules_requests": _project_rules_requests(plan),
        "rule_results": _project_rule_results(
            plan, investigator_display_name=investigator_display_name
        ),
        "scene_anchor": _build_scene_anchor(scene),
        "rationale": plan.get("rationale"),
    }
    redirection = _sanitize_redirection(plan.get("redirection"))
    if redirection is not None:
        envelope["redirection"] = redirection
    return envelope


def assert_narration_ready(plan: dict[str, Any], scenario_dir: Path) -> dict[str, dict[str, Any]]:
    """Verify a DirectorPlan carries everything an LLM narrator needs.

    Returns {check_id: {passed, detail}}. A plan is narration-ready iff every
    check passes.
    """
    findings: dict[str, dict[str, Any]] = {}
    directives = plan.get("narrative_directives", {}) or {}
    boundaries = _read_json(scenario_dir / "improvisation-boundaries.json", {})
    keeper_secrets = boundaries.get("keeper_secrets", []) or []
    keeper_secret_ids = set(secret_ref_ids(keeper_secrets))

    # 1. tone_present -------------------------------------------------------
    tone = directives.get("tone", [])
    tone_ok = isinstance(tone, list) and len(tone) > 0
    findings["tone_present"] = {
        "passed": bool(tone_ok),
        "detail": f"tone={tone!r}",
    }

    # 2. must_not_reveal_populated -----------------------------------------
    mnr = directives.get("must_not_reveal", []) or []
    mnr_set = set(secret_ref_ids(mnr))
    secrets_set = set(secret_ref_ids(keeper_secrets))
    populated = len(mnr) > 0
    superset = secrets_set.issubset(mnr_set)
    missing = sorted(secrets_set - mnr_set)
    findings["must_not_reveal_populated"] = {
        "passed": bool(populated and superset),
        "detail": (f"mnr_count={len(mnr)} secrets_count={len(keeper_secrets)} "
                   f"missing_from_mnr={missing}"),
    }

    # 2b. content_constraints_passed_through --------------------------------
    # If the scenario has content_flags in module-meta, they MUST appear in the
    # plan's narrative_directives.content_constraints. This verifies the safety
    # constraint chain is closed (flags -> plan -> narrator). We do NOT judge
    # whether content "crosses a line" — that is LLM semantic judgment.
    meta_path = scenario_dir / "module-meta.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        meta_flags = set(meta.get("content_flags", []) or [])
        plan_flags = set(directives.get("content_constraints", []) or [])
        chain_closed = meta_flags.issubset(plan_flags)
        findings["content_constraints_passed_through"] = {
            "passed": chain_closed,
            "detail": f"meta_flags={sorted(meta_flags)} plan_flags={sorted(plan_flags)} missing={sorted(meta_flags - plan_flags)}",
        }
    else:
        findings["content_constraints_passed_through"] = {
            "passed": True, "detail": "no module-meta (cannot verify)",
        }

    # 2c. player_facing_style_present ---------------------------------------
    style = directives.get("player_facing_style")
    if isinstance(style, dict):
        avoid = set(style.get("avoid", []) or [])
        prefer = set(style.get("prefer", []) or [])
        policy = style.get("repetition_policy") or {}
        guard = style.get("style_guard") or {}
        render_contract = style.get("render_contract") or {}
        required_avoid = {
            "ai_summary_voice",
            "log_style_summary",
            "semantic_repetition",
            "abstract_psychological_explanation",
        }
        if style.get("language") == "zh-Hans":
            required_avoid.add("translationese")
        required_prefer = {"short_sentences", "observable_behavior", "open_ended_prompt"}
        required_guard_rules = {
            "observable_before_interpretation",
            "rewrite_abstract_explanation_to_action",
            "crisis_scene_clarity",
            "final_prose_guard_before_output",
        }
        required_render_slots = {
            "viewpoint_anchor",
            "spatial_anchor",
            "active_motion",
            "connection_or_force",
            "risk_progression",
            "visible_affordance",
            "player_entry",
        }
        missing_avoid = sorted(required_avoid - avoid)
        missing_prefer = sorted(required_prefer - prefer)
        missing_guard_rules = sorted(required_guard_rules - set(guard.get("required_rules", []) or []))
        missing_render_slots = sorted(
            required_render_slots - set(render_contract.get("required_slots", []) or [])
        )
        policy_ok = (
            isinstance(policy, dict)
            and policy.get("established_fact_mode") == "compress"
            and policy.get("repeat_foreign_dialogue") == "summarize_unless_new_information"
        )
        final_output_pass = guard.get("final_output_pass") if isinstance(guard, dict) else {}
        final_output_pass_ok = (
            isinstance(final_output_pass, dict)
            and final_output_pass.get("required") is True
            and final_output_pass.get("function") == "guard_player_visible_text"
            and final_output_pass.get("applies_to") == "player_visible_narration_only"
            and final_output_pass.get("not_for") == [
                "scene_routing",
                "storylet_selection",
                "rules_adjudication",
            ]
        )
        guard_ok = (
            isinstance(guard, dict)
            and not missing_guard_rules
            and final_output_pass_ok
            and guard.get("not_for") == ["scene_routing", "storylet_selection", "rules_adjudication"]
        )
        render_contract_ok = (
            isinstance(render_contract, dict)
            and render_contract.get("frame_type") == "crisis_scene_render"
            and not missing_render_slots
            and render_contract.get("player_visible_must_not") == [
                "slot_labels",
                "expository_choice_summary",
                "if_then_option_dump",
            ]
        )
        style_ok = (
            bool(style.get("register"))
            and not missing_avoid
            and not missing_prefer
            and policy_ok
            and guard_ok
            and render_contract_ok
        )
        detail = (
            f"player_facing_style language={style.get('language')!r} "
            f"register={style.get('register')!r} missing_avoid={missing_avoid} "
            f"missing_prefer={missing_prefer} repetition_policy_ok={policy_ok} "
            f"missing_guard_rules={missing_guard_rules} style_guard_ok={guard_ok} "
            f"final_output_pass_ok={final_output_pass_ok} "
            f"missing_render_slots={missing_render_slots} render_contract_ok={render_contract_ok}"
        )
    else:
        style_ok = False
        detail = "player_facing_style missing or not an object"
    findings["player_facing_style_present"] = {
        "passed": bool(style_ok),
        "detail": detail,
    }

    # 3. dramatic_question_present -----------------------------------------
    dq = plan.get("dramatic_question", "")
    findings["dramatic_question_present"] = {
        "passed": bool(dq and str(dq).strip()),
        "detail": f"dramatic_question={dq!r}",
    }

    # 4. horror_stage_valid -------------------------------------------------
    stage = directives.get("horror_escalation_stage", "")
    findings["horror_stage_valid"] = {
        "passed": stage in HORROR_STAGES,
        "detail": f"horror_escalation_stage={stage!r} valid={sorted(HORROR_STAGES)}",
    }

    # 5. handoff_consistency ------------------------------------------------
    handoff = plan.get("handoff", "")
    if handoff == "rules":
        rules_req = plan.get("rules_requests", []) or []
        passed = len(rules_req) > 0
        detail = f"handoff=rules rules_requests_count={len(rules_req)}"
    elif handoff == "narration":
        tone_present = bool(isinstance(tone, list) and len(tone) > 0)
        mnr_present = len(mnr) > 0
        passed = tone_present and mnr_present
        detail = (f"handoff=narration tone_present={tone_present} "
                  f"must_not_reveal_present={mnr_present}")
    else:
        passed = False
        detail = f"handoff={handoff!r} not in (rules, narration)"
    findings["handoff_consistency"] = {"passed": bool(passed), "detail": detail}

    # 6. clue_policy_no_secret_leak ----------------------------------------
    reveal = plan.get("clue_policy", {}).get("reveal", []) or []
    leaked = sorted(set(reveal) & keeper_secret_ids)
    findings["clue_policy_no_secret_leak"] = {
        "passed": len(leaked) == 0,
        "detail": f"reveal={reveal} leaked_secrets={leaked}",
    }

    # 6b. must_not_reveal_has_no_secret_prose ------------------------------
    # Narrator-facing must_not_reveal must be {id, category} (or bare ids),
    # never the full keeper_secrets prose from improvisation-boundaries.
    prose_bodies: list[str] = []
    for secret in keeper_secrets:
        if isinstance(secret, dict):
            body = str(secret.get("prose") or secret.get("text") or "").strip()
            if body:
                prose_bodies.append(body)
            continue
        text = str(secret or "").strip()
        if ": " in text:
            prefix, _, rest = text.partition(": ")
            if _looks_like_secret_id(prefix.strip()) and rest.strip():
                prose_bodies.append(rest.strip())
        elif text and not _looks_like_secret_id(text):
            prose_bodies.append(text)
    mnr_blob = json.dumps(mnr, ensure_ascii=False)
    prose_hits = [body for body in prose_bodies if body and body in mnr_blob]
    findings["must_not_reveal_has_no_secret_prose"] = {
        "passed": len(prose_hits) == 0,
        "detail": f"prose_hits={len(prose_hits)}",
    }

    # 7. scene_action_narratable -------------------------------------------
    action = plan.get("scene_action", "")
    findings["scene_action_narratable"] = {
        "passed": action in ACTIONS,
        "detail": f"scene_action={action!r} valid={ACTIONS}",
    }

    # 8. rationale_present --------------------------------------------------
    rationale = plan.get("rationale", "")
    findings["rationale_present"] = {
        "passed": bool(rationale and str(rationale).strip()),
        "detail": f"rationale={rationale!r}",
    }

    return findings


def is_narration_ready(plan: dict[str, Any], scenario_dir: Path) -> bool:
    """Convenience: True iff every narration contract check passes."""
    findings = assert_narration_ready(plan, scenario_dir)
    return all(f["passed"] for f in findings.values())


# =============================================================================
# CLI: python3 coc_narration_contract.py <plan.json> <scenario_dir>
# =============================================================================
def _main(argv: list[str]) -> int:
    if len(argv) != 3:
        sys.stderr.write(
            "usage: coc_narration_contract.py <plan.json> <scenario_dir>\n")
        return 2
    plan_path = Path(argv[1])
    scenario_dir = Path(argv[2])
    if not plan_path.exists():
        sys.stderr.write(f"error: plan not found: {plan_path}\n")
        return 2
    if not scenario_dir.is_dir():
        sys.stderr.write(f"error: scenario_dir not found: {scenario_dir}\n")
        return 2
    plan = _read_json(plan_path, {})
    if not isinstance(plan, dict):
        sys.stderr.write(f"error: plan is not a JSON object: {plan_path}\n")
        return 2

    findings = assert_narration_ready(plan, scenario_dir)
    all_passed = True
    for check_id, result in findings.items():
        status = "PASS" if result["passed"] else "FAIL"
        if not result["passed"]:
            all_passed = False
        detail = result["detail"]
        if len(detail) > 120:
            detail = detail[:117] + "..."
        print(f"[{status}] {check_id:32s} {detail}")
    overall = "PASS" if all_passed else "FAIL"
    total = len(findings)
    passed = sum(1 for f in findings.values() if f["passed"])
    print(f"\n{narration_summary(plan_path.name, passed, total)} -> {overall}")
    return 0 if all_passed else 1


def narration_summary(name: str, passed: int, total: int) -> str:
    return f"{name}: {passed}/{total} narration-ready checks passed"


if __name__ == "__main__":
    sys.exit(_main(sys.argv))
