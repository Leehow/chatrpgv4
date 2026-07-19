#!/usr/bin/env python3
"""COC Narration Contract — verifies a DirectorPlan is narration-ready.

This checker verifies the contract between the Story Director's output and the narration layer
(coc-keeper-play SKILL step 5: "Narrate consequences per
DirectorPlan.narrative_directives"). We cannot unit-test LLM narration output
(non-deterministic), but we CAN assert that every DirectorPlan carries
sufficient directives for an LLM narrator to write a compliant scene without
violating constraints.

Historical spec retired; see tombstone index docs/status/DIAGNOSIS-LEDGER.md
"""
from __future__ import annotations

import json
import math
import sys
import time
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from coc_narration_style import (
    build_crisis_scene_render_frame,
    guard_player_visible_text,
    player_facing_style_contract as _player_facing_style_contract,
    validate_crisis_scene_render_frame,
)
import coc_npc_state
import coc_epistemic_narration

# guard_player_visible_text findings use severity "rewrite" (advisory).
# Only "block" would gate a turn; the prose guard does not emit it today.
NARRATION_GUARD_BLOCKING_SEVERITY = "block"

_RENDER_MODES = frozenset({"investigation", "social", "pressure", "crisis"})
_HORROR_AXES = (
    "dread", "uncertainty", "isolation", "helplessness",
    "body_horror", "cosmic_scale", "urgency",
)


def _project_render_mode(value: Any) -> str:
    return value if value in _RENDER_MODES else "investigation"


def _project_horror_profile(value: Any) -> dict[str, float]:
    fallback = {axis: 0.0 for axis in _HORROR_AXES}
    if not isinstance(value, dict) or set(value) != set(_HORROR_AXES):
        return fallback
    projected: dict[str, float] = {}
    for axis in _HORROR_AXES:
        raw = value.get(axis)
        if (not isinstance(raw, (int, float)) or isinstance(raw, bool)
                or not math.isfinite(float(raw)) or not 0.0 <= float(raw) <= 1.0):
            return fallback
        projected[axis] = float(raw)
    return projected


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
    _append_list_text_fields(
        fields,
        "narration_envelope.disclosure_decisions",
        env.get("disclosure_decisions"),
        dict_keys=("player_safe_line",),
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


def _clue_lookup_player_safe(
    clue_graph: dict[str, Any] | None, language: str = "zh-Hans"
) -> dict[str, str]:
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
            summary = _localized_clue_summary(clue, language)
            if summary:
                lookup[clue_id] = summary
    return lookup


def _approved_reveal_clue_ids(
    plan: dict[str, Any], applied_events: list[dict[str, Any]] | None = None,
) -> list[str]:
    """Prefer committed reveals after rules backfill; else planned reveal ids."""
    if applied_events is not None:
        return list(dict.fromkeys(
            str(event.get("clue_id"))
            for event in applied_events
            if isinstance(event, dict) and event.get("event_type") == "clue_reveal"
            and event.get("clue_id")
        ))
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
    applied_events: list[dict[str, Any]] | None = None,
) -> list[dict[str, str]]:
    style = (plan.get("narrative_directives") or {}).get("player_facing_style") or {}
    language = str(style.get("language") or "zh-Hans") if isinstance(style, dict) else "zh-Hans"
    lookup = _clue_lookup_player_safe(clue_graph, language)
    clues: list[dict[str, str]] = []
    for clue_id in _approved_reveal_clue_ids(plan, applied_events):
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


def _localized_summary(value: Any, play_language: str) -> str | None:
    if not isinstance(value, dict):
        return None
    localized = value.get("localized_summaries")
    summary = (
        localized.get(play_language)
        if isinstance(localized, dict)
        else None
    ) or value.get("summary")
    return summary.strip() if isinstance(summary, str) and summary.strip() else None


def _project_rule_results(
    plan: dict[str, Any],
    *,
    investigator_display_name: str | None = None,
    applied_events: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Player-safe settled rule outcomes for the narrator (no dice math)."""
    raw = plan.get("rules_results")
    if not isinstance(raw, list):
        raw = plan.get("rule_results")
    if not isinstance(raw, list):
        raw = []

    # A Keeper may consult the Director before deciding that the player's
    # concrete method needs a roll.  In that natural order the candidate plan
    # cannot already contain the later toolbox result, so narration.brief's
    # documented ``applied_events`` input is the authoritative handoff.  Merge
    # direct settled roll receipts without asking the Keeper to mutate the
    # advisory plan or recompute an outcome.  Other state/event receipts are
    # ignored here and handled by their own projections below.
    settled_results = list(raw)
    seen_roll_ids = {
        str(result.get("roll_id"))
        for result in settled_results
        if isinstance(result, dict) and str(result.get("roll_id") or "").strip()
    }
    for event in applied_events or []:
        if not isinstance(event, dict):
            continue
        roll_id = str(event.get("roll_id") or "").strip()
        if not roll_id or roll_id in seen_roll_ids or event.get("outcome") is None:
            continue
        if event.get("roll") is None and event.get("unmodified_roll") is None:
            continue
        settled_results.append(event)
        seen_roll_ids.add(roll_id)

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
    style = (plan.get("narrative_directives") or {}).get("player_facing_style") or {}
    play_language = (
        str(style.get("language") or "zh-Hans")
        if isinstance(style, dict) else "zh-Hans"
    )
    completed_route_ids = {
        str(event.get("route_id"))
        for event in (applied_events or [])
        if isinstance(event, dict)
        and event.get("event_type") == "route_completed"
        and event.get("status") == "completed"
        and event.get("success") is True
        and str(event.get("route_id") or "").strip()
    }

    projected: list[dict[str, Any]] = []
    successful_outcomes = {
        "critical",
        "extreme",
        "extreme_success",
        "hard",
        "hard_success",
        "regular",
        "regular_success",
        "success",
    }
    for result in settled_results:
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
        explicit_success = result.get("success")
        success = (
            explicit_success
            if isinstance(explicit_success, bool)
            else str(result.get("outcome") or "").strip().lower()
            in successful_outcomes
        )
        entry: dict[str, Any] = {
            "skill": skill,
            "investigator_display_name": inv_name,
            "outcome": result.get("outcome"),
            "success": success,
        }
        if result.get("roll_id"):
            entry["roll_id"] = str(result["roll_id"])
        contract = result.get("roll_contract")
        if isinstance(contract, dict):
            goal = contract.get("goal")
            success_effect = contract.get("success_effect")
            if isinstance(goal, str) and goal.strip():
                entry["goal"] = goal.strip()
            if entry["success"] and isinstance(success_effect, str) and success_effect.strip():
                entry["success_effect"] = success_effect.strip()
            localized_failures = contract.get("localized_failure_effects")
            ordinary_failure = (
                localized_failures.get(play_language)
                if isinstance(localized_failures, dict)
                else None
            ) or contract.get("failure_effect")
            if (
                not entry["success"]
                and result.get("outcome") != "fumble"
                and result.get("pushed") is not True
                and contract.get("authored_roll_gate") is True
                and contract.get("failure_outcome_mode") == "no_progress"
                and isinstance(ordinary_failure, str)
                and ordinary_failure.strip()
            ):
                # Authored roll gates are compiler-validated player-safe source
                # material. Preserve their concrete settled failure for both the
                # production narrator and deterministic fallback path.
                entry["ordinary_failure_summary"] = ordinary_failure.strip()
        resolution_context = result.get("resolution_context")
        route_resolution = (
            resolution_context.get("route_resolution")
            if isinstance(resolution_context, dict)
            else None
        )
        if isinstance(route_resolution, dict):
            route_ids = [
                str(value)
                for value in route_resolution.get("matched_route_ids") or []
                if str(value or "").strip()
            ]
            if route_ids:
                entry["matched_route_ids"] = list(dict.fromkeys(route_ids))
        matched_route_ids = set(entry.get("matched_route_ids") or [])
        if entry["success"] and matched_route_ids:
            route_state_committed = matched_route_ids.issubset(completed_route_ids)
            entry["settlement_scope"] = (
                "committed_route" if route_state_committed else "check_only"
            )
            entry["state_change_committed"] = route_state_committed
            if not route_state_committed:
                # A percentile outcome is not state-settlement authority. The
                # narrator may say the check succeeded, but may not turn it
                # into access, a clue, an NPC agreement, or route completion.
                entry.pop("success_effect", None)
                entry["must_not_claim_state_change"] = True
        if result.get("san_loss") is not None:
            entry["san_loss"] = result.get("san_loss")
        consequence = result.get("announced_consequence")
        consequence_summary = _localized_summary(consequence, play_language)
        if (
            result.get("pushed") is True
            and not entry["success"]
            and consequence_summary
        ):
            # Only the already-announced player-safe summary crosses this
            # boundary. The typed effect and private push context stay Keeper-side.
            entry["consequence_summary"] = consequence_summary
        fumble_consequence = result.get("fumble_consequence")
        fumble_summary = _localized_summary(fumble_consequence, play_language)
        if (
            result.get("outcome") == "fumble"
            and fumble_summary
        ):
            entry["consequence_summary"] = fumble_summary

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


_ZH_ROLL_SKILL_LABELS = {
    "Persuade": "说服",
    "Charm": "魅惑",
    "Fast Talk": "话术",
    "Intimidate": "恐吓",
    "Spot Hidden": "侦查",
    "Library Use": "图书馆使用",
    "Listen": "聆听",
    "Psychology": "心理学",
    "Dodge": "闪避",
    "Credit Rating": "信用评级",
}
_ZH_ROLL_DIFFICULTY_LABELS = {
    "regular": "常规",
    "hard": "困难",
    "extreme": "极难",
    "opposed": "对抗",
    "damage": "伤害",
    "healing": "治疗",
}
_ZH_ROLL_OUTCOME_LABELS = {
    "critical": "大成功",
    "extreme": "极难成功",
    "extreme_success": "极难成功",
    "hard": "困难成功",
    "hard_success": "困难成功",
    "regular": "常规成功",
    "regular_success": "常规成功",
    "success": "成功",
    "failure": "失败",
    "fumble": "大失败",
}


def build_rules_owned_public_roll_block(
    rule_results: Any,
    *,
    decision_id: str,
    play_language: str = "zh-Hans",
) -> dict[str, Any]:
    """Render authoritative public dice independently of narrator prose.

    This consumes settled structured rule results only. The narrator receives
    outcome semantics but never owns numeric dice rendering, so a raw model
    cannot omit, alter, or duplicate the rules-owned marker.
    """
    entries: list[dict[str, Any]] = []
    lines: list[str] = []
    seen_roll_ids: set[str] = set()
    for raw in rule_results if isinstance(rule_results, list) else []:
        if not isinstance(raw, dict) or raw.get("skipped"):
            continue
        roll_role = raw.get("roll_role")
        if roll_role == "amount":
            rolled_total = raw.get("rolled_total")
            dice = raw.get("dice")
            if (
                isinstance(rolled_total, bool)
                or not isinstance(rolled_total, int)
                or not isinstance(dice, dict)
                or dice.get("total") != rolled_total
                or not isinstance(dice.get("expression"), str)
                or not isinstance(dice.get("raw"), list)
            ):
                raise ValueError("public amount roll lacks canonical dice evidence")
        elif roll_role in {None, "percentile_check"}:
            if "roll" not in raw:
                continue
            rolled_total = None
            dice = raw.get("dice")
        else:
            raise ValueError(f"unsupported public roll_role: {roll_role!r}")
        visibility = raw.get("visibility")
        if visibility is None:
            visibility = "keeper_only" if raw.get("hidden") is True else "public"
        if visibility not in {"public", "consequence_public"}:
            continue
        roll_id = str(raw.get("roll_id") or raw.get("command_id") or "").strip()
        if not roll_id or roll_id in seen_roll_ids:
            continue
        seen_roll_ids.add(roll_id)
        skill = str(
            raw.get("skill")
            or raw.get("characteristic")
            or raw.get("purpose")
            or raw.get("kind")
            or "roll"
        ).strip()
        die = str(raw.get("die_expression") or raw.get("die") or "").strip()
        skill_or_die = f"{skill} ({die})" if die and die != skill else skill
        outcome = str(raw.get("outcome") or "unknown").strip()
        fumble_consequence = raw.get("fumble_consequence")
        fumble_summary = (
            fumble_consequence.get("summary", "").strip()
            if outcome == "fumble" and isinstance(fumble_consequence, dict)
            and isinstance(fumble_consequence.get("summary"), str)
            else ""
        )
        entry: dict[str, Any] = {
            "roll_id": roll_id,
            "decision_id": str(raw.get("decision_id") or decision_id),
            "visibility": visibility,
            "roll_role": roll_role or "percentile_check",
            "skill_or_die": skill_or_die,
            "outcome": outcome,
            "source_ref": str(
                raw.get("source_ref") or f"logs/rolls.jsonl#{roll_id}"
            ),
        }
        if roll_role == "amount":
            entry["rolled_total"] = rolled_total
            entry["dice"] = dice
            if raw.get("target_actor_id") is not None:
                entry["target_actor_id"] = raw["target_actor_id"]
            raw_faces = "+".join(str(value) for value in dice["raw"]) or "—"
            if play_language == "zh-Hans":
                display_skill = _ZH_ROLL_SKILL_LABELS.get(skill, skill)
                lines.append(
                    f"【明骰】{display_skill} ({dice['expression']})："
                    f"骰面 {raw_faces} → 总值 {rolled_total}。"
                    f"【来源：{entry['source_ref']}】"
                )
            else:
                lines.append(
                    f"[Public roll] {skill} ({dice['expression']}): "
                    f"faces {raw_faces} -> total {rolled_total}. "
                    f"[Source: {entry['source_ref']}]"
                )
            entries.append(entry)
            continue
        entry["roll"] = raw.get("roll")
        target = raw.get("required_target", raw.get("effective_target", raw.get("target")))
        if target is not None:
            entry["target"] = target
        difficulty = raw.get("difficulty")
        if difficulty is not None:
            entry["difficulty"] = difficulty
        for key in (
            "bonus_penalty_dice", "bonus", "penalty", "die", "die_expression",
            "die_rolls", "flat_modifier", "pushed",
        ):
            if raw.get(key) is not None:
                entry[key] = raw[key]
        dice_details: list[str] = []
        if int(raw.get("bonus", 0) or 0) or int(raw.get("penalty", 0) or 0):
            dice_details.append(
                (
                    f"奖励骰 {raw.get('bonus', 0)} / 惩罚骰 {raw.get('penalty', 0)}"
                    if play_language == "zh-Hans"
                    else f"bonus {raw.get('bonus', 0)} / penalty {raw.get('penalty', 0)}"
                )
            )
        elif int(raw.get("bonus_penalty_dice", 0) or 0):
            dice_details.append(
                (
                    f"奖惩骰 {raw.get('bonus_penalty_dice')}"
                    if play_language == "zh-Hans"
                    else f"bonus/penalty dice {raw.get('bonus_penalty_dice')}"
                )
            )
        if play_language == "zh-Hans":
            display_skill = _ZH_ROLL_SKILL_LABELS.get(skill, skill)
            display_skill_or_die = (
                f"{display_skill} ({die})" if die and die != skill else display_skill
            )
            display_difficulty = _ZH_ROLL_DIFFICULTY_LABELS.get(
                str(difficulty), str(difficulty)
            ) if difficulty is not None else None
            display_outcome = _ZH_ROLL_OUTCOME_LABELS.get(outcome, outcome)
            target_text = f" / 目标 {target}" if target is not None else ""
            difficulty_text = f"（{display_difficulty}）" if display_difficulty is not None else ""
            detail_text = f"；{'；'.join(dice_details)}" if dice_details else ""
            pushed_text = "（推骰）" if raw.get("pushed") is True else ""
            consequence_text = f"；后果：{fumble_summary}" if fumble_summary else ""
            if all(
                isinstance(raw.get(key), int)
                and not isinstance(raw.get(key), bool)
                for key in ("original_roll", "luck_spent", "adjusted_roll")
            ):
                entry.update({
                    "original_roll": raw["original_roll"],
                    "luck_spent": raw["luck_spent"],
                    "adjusted_roll": raw["adjusted_roll"],
                    "achieved_level": raw.get("achieved_level"),
                    "passed": raw.get("passed"),
                })
                lines.append(
                    f"【明骰】{display_skill_or_die}：原始 {raw['original_roll']} "
                    f"→ 幸运-{raw['luck_spent']} → 调整 {raw['adjusted_roll']}"
                    f"{target_text}{difficulty_text} → {display_outcome}。"
                    f"【来源：{entry['source_ref']}】"
                )
            else:
                lines.append(
                    f"【明骰】{pushed_text}{display_skill_or_die}：{raw.get('roll')}"
                    f"{target_text}{difficulty_text} → {display_outcome}{detail_text}"
                    f"{consequence_text}。"
                    f"【来源：{entry['source_ref']}】"
                )
        else:
            target_text = f" / target {target}" if target is not None else ""
            difficulty_text = f" ({difficulty})" if difficulty is not None else ""
            detail_text = f"; {'; '.join(dice_details)}" if dice_details else ""
            pushed_text = " [Pushed]" if raw.get("pushed") is True else ""
            consequence_text = (
                f"; consequence: {fumble_summary}" if fumble_summary else ""
            )
            if all(
                isinstance(raw.get(key), int)
                and not isinstance(raw.get(key), bool)
                for key in ("original_roll", "luck_spent", "adjusted_roll")
            ):
                entry.update({
                    "original_roll": raw["original_roll"],
                    "luck_spent": raw["luck_spent"],
                    "adjusted_roll": raw["adjusted_roll"],
                    "achieved_level": raw.get("achieved_level"),
                    "passed": raw.get("passed"),
                })
                lines.append(
                    f"[Public roll] {skill_or_die}: raw {raw['original_roll']} "
                    f"-> Luck -{raw['luck_spent']} -> adjusted {raw['adjusted_roll']}"
                    f"{target_text}{difficulty_text} -> {outcome}. "
                    f"[Source: {entry['source_ref']}]"
                )
            else:
                lines.append(
                    f"[Public roll]{pushed_text} {skill_or_die}: {raw.get('roll')}{target_text}{difficulty_text} "
                    f"-> {outcome}{detail_text}{consequence_text}. "
                    f"[Source: {entry['source_ref']}]"
                )
        if fumble_summary:
            entry["fumble_consequence_summary"] = fumble_summary
        entries.append(entry)
    return {
        "schema_version": 1,
        "owner": "deterministic_rules_renderer",
        "decision_id": decision_id,
        "public_roll_count": len(entries),
        "entries": entries,
        "text": "\n".join(lines),
    }


def compose_rules_owned_public_roll_block(
    narrator_text: str,
    block: Any,
) -> str:
    """Compose one prebuilt rules block without inspecting generated prose."""
    base = str(narrator_text or "").strip()
    if (
        not isinstance(block, dict)
        or block.get("owner") != "deterministic_rules_renderer"
        or not isinstance(block.get("entries"), list)
        or block.get("public_roll_count") != len(block["entries"])
        or not block["entries"]
        or not isinstance(block.get("text"), str)
        or not block["text"].strip()
    ):
        return base
    return f"{base}\n\n{block['text'].strip()}" if base else block["text"].strip()


def _project_action_outcomes(
    applied_events: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Project committed public action outcomes from apply events.

    Only ``route_completed`` events cross this boundary.  Their goal/outcome
    strings originate from the already-public authored affordance, never from
    Keeper secrets or report prose.
    """
    outcomes: list[dict[str, Any]] = []
    for event in applied_events or []:
        if not isinstance(event, dict) or event.get("event_type") != "route_completed":
            continue
        if event.get("success") is not True or event.get("status") != "completed":
            continue
        row: dict[str, Any] = {
            "route_id": event.get("route_id"),
            "status": "completed",
            "success": True,
            "source": event.get("source") or "route_completed",
        }
        for key in ("player_visible_goal", "player_visible_outcome"):
            value = event.get(key)
            if isinstance(value, str) and value.strip():
                row[key] = value.strip()
        rule_outcomes = [
            str(value) for value in event.get("rule_outcomes") or []
            if str(value or "").strip()
        ]
        if rule_outcomes:
            row["rule_outcomes"] = rule_outcomes
        outcomes.append(row)
    return outcomes


def _scene_display_name(scene: dict[str, Any], play_language: str) -> str:
    identity = scene.get("destination_identity")
    if isinstance(identity, dict):
        localized_names = identity.get("localized_names")
        localized = (
            localized_names.get(play_language)
            if isinstance(localized_names, dict)
            else None
        )
        if isinstance(localized, dict):
            for key in ("display_name", "name", "title"):
                value = localized.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
        elif isinstance(localized, str) and localized.strip():
            return localized.strip()
    for container_key in ("localized_text", "localized_names"):
        container = scene.get(container_key)
        localized = container.get(play_language) if isinstance(container, dict) else None
        if isinstance(localized, dict):
            for key in ("display_name", "name", "title"):
                value = localized.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
    for key in ("display_name", "title", "player_safe_summary", "live_summary"):
        value = scene.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    if isinstance(identity, dict):
        canonical_name = identity.get("canonical_name")
        if isinstance(canonical_name, str) and canonical_name.strip():
            return canonical_name.strip()
    return "当前地点" if play_language == "zh-Hans" else "the current location"


def _present_scene_npc_ids(
    scene: dict[str, Any],
    route_completion_receipts: list[dict[str, Any]] | None,
) -> list[str]:
    """Project physical NPC presence from structured scene prerequisites."""
    scene_id = str(scene.get("scene_id") or "").strip()
    declared = list(dict.fromkeys(
        str(value).strip()
        for value in (scene.get("npc_ids") or [])
        if str(value or "").strip()
    ))
    requirements = {
        str(row.get("npc_id")): row
        for row in (scene.get("npc_presence_requirements") or [])
        if isinstance(row, dict) and str(row.get("npc_id") or "").strip()
    }
    completed_route_ids = {
        str(row.get("route_id"))
        for row in (route_completion_receipts or [])
        if isinstance(row, dict)
        and row.get("status") == "consumed"
        and str(row.get("route_id") or "").strip()
        and (
            not str(row.get("scene_id") or "").strip()
            or not scene_id
            or str(row.get("scene_id")) == scene_id
        )
    }
    visible: list[str] = []
    for npc_id in declared:
        requirement = requirements.get(npc_id)
        if not isinstance(requirement, dict):
            visible.append(npc_id)
            continue
        required_route_ids = {
            str(value).strip()
            for value in (requirement.get("requires_completed_route_ids") or [])
            if str(value or "").strip()
        }
        if required_route_ids.issubset(completed_route_ids):
            visible.append(npc_id)
    return visible


def _build_scene_anchor(
    active_scene: dict[str, Any] | None,
    *,
    play_language: str = "zh-Hans",
) -> dict[str, Any]:
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
        "display_name": _scene_display_name(scene, play_language),
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


def _npc_display_name(move: dict[str, Any], play_language: str = "zh-Hans") -> str:
    for container_key in ("localized_text", "localized_names"):
        container = move.get(container_key)
        localized = container.get(play_language) if isinstance(container, dict) else None
        if isinstance(localized, dict):
            for key in ("display_name", "name"):
                value = localized.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
        elif isinstance(localized, str) and localized.strip():
            return localized.strip()
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
    return "在场人物" if play_language == "zh-Hans" else "a present person"


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
        safe.append({
            key: move.get(key) for key in (
                "move_id", "kind", "player_safe_summary", "line_seed",
                "requires_player_decision",
            ) if move.get(key) is not None
        })
    return safe


def _sanitize_npc_move(
    move: dict[str, Any],
    play_language: str = "zh-Hans",
) -> dict[str, Any]:
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
        "display_name": _npc_display_name(move, play_language),
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
    impression = move.get("impression")
    if isinstance(impression, dict):
        # Pair-scoped textual memory is bounded and caller-authored.  Keep it
        # as semantic narration context while preserving the secret boundary;
        # it is not a deterministic action gate or player-facing label.
        safe_move["impression"] = {
            "summary": str(impression.get("summary") or "")[:800],
            "expectations": [
                str(item)[:300] for item in (impression.get("expectations") or [])
                if isinstance(item, str) and item.strip()
            ][:6],
            "reservations": [
                str(item)[:300] for item in (impression.get("reservations") or [])
                if isinstance(item, str) and item.strip()
            ][:6],
            "memories": [
                {
                    key: str(row.get(key) or "")[:300]
                    for key in ("memory_id", "event", "interpretation", "reason", "source_ref")
                    if row.get(key) is not None
                }
                for row in (impression.get("memories") or [])
                if isinstance(row, dict)
            ][:12],
        }
    return safe_move


def _sanitize_disclosure_decisions(value: Any) -> list[dict[str, Any]]:
    """Whitelist public outcome metadata; drop facts, lies, gates and schedules."""
    safe: list[dict[str, Any]] = []
    for decision in value or []:
        if not isinstance(decision, dict):
            continue
        row = {
            "npc_id": decision.get("npc_id"),
            # Never tell the narrator that a spoken line is a lie. Only an
            # approved reveal is semantically distinguished in the public view.
            "outcome": (
                "reveal" if decision.get("outcome") == "reveal" else "response"
            ),
            "clue_id": decision.get("clue_id") if decision.get("outcome") == "reveal" else None,
        }
        line = decision.get("player_safe_line")
        if isinstance(line, str) and line.strip():
            row["player_safe_line"] = line.strip()
        safe.append(row)
    return safe


def _sanitize_keeper_plan(value: Any) -> dict[str, Any] | None:
    """Whitelist non-factual presentation guidance from the private Keeper."""
    if not isinstance(value, dict) or value.get("schema_version") != 1:
        return None
    narration = value.get("narration")
    if not isinstance(narration, dict):
        narration = {}
    return {
        "schema_version": 1,
        "resolution_mode": value.get("resolution_mode"),
        "scene_action": value.get("scene_action"),
        "rule_decision": value.get("rule_decision"),
        "npc_tactic": value.get("npc_tactic"),
        "npc_id": value.get("npc_id"),
        "narration": {
            "beat": narration.get("beat"),
            "tone": [
                str(item) for item in narration.get("tone") or []
                if isinstance(item, str) and item.strip()
            ][:4],
            # Private free-form focus/objective/rationale never cross privilege.
            "sensory_focus": [],
            "end_with": narration.get("end_with"),
        },
        "authority": (
            "Presentation guidance only; facts and state require dedicated "
            "approved envelope fields."
        ),
    }


def _sanitize_choice_frame(value: Any) -> dict[str, Any]:
    """Whitelist the public choice-frame contract and route affordances."""
    if not isinstance(value, dict):
        return {}
    safe: dict[str, Any] = {}
    for key in (
        "prompt", "mode", "is_real_fork", "open_route_count",
        "open_route_ids", "visible_affordances", "do_not_render_as_menu",
    ):
        if key in value:
            safe[key] = value[key]
    routes = []
    for route in value.get("routes") or []:
        if not isinstance(route, dict):
            continue
        public_route = {
            key: route.get(key) for key in (
                # clue_id is Keeper-side routing data.  The narrator needs only
                # the authored player-visible affordance, never the identity of
                # the undiscovered clue behind it.
                "route_id", "id", "cue", "cue_scope", "label", "summary",
                "player_safe_summary", "kind", "available",
            ) if route.get(key) is not None
        }
        if public_route:
            routes.append(public_route)
    if routes:
        safe["routes"] = routes
    if not routes and not safe.get("prompt") and not safe.get("visible_affordances"):
        return {}
    return safe


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


def _project_grounded_pressure_moves(
    plan: dict[str, Any],
    *,
    active_scene_id: str,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Expose only pressure consequences with a structured source receipt.

    The narrator must never turn an unbound threat-clock fallback into a local
    observable fact. Legacy moves can still be recognized when their structured
    source is the active scene or their affinity receipt has non-empty matches.
    No pressure prose is inspected to make this decision.
    """
    accepted: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    receipts: list[dict[str, Any]] = []
    for index, move in enumerate(plan.get("pressure_moves") or []):
        if not isinstance(move, dict):
            rejected.append({"index": index, "reason": "malformed_pressure_move"})
            continue
        receipt = move.get("grounding_receipt")
        authorized = isinstance(receipt, dict) and receipt.get("status") == "authorized"
        if not authorized and move.get("source") == "active_scene.pressure_moves":
            receipt = {
                "schema_version": 1,
                "status": "authorized",
                "source": "active_scene.pressure_moves",
                "active_scene_id": active_scene_id,
                "rule": "Narrate only the authored active-scene consequence.",
            }
            authorized = True
        selection = move.get("selection_reason")
        if not authorized and isinstance(selection, dict):
            matched = [str(value) for value in selection.get("matched_ids") or [] if value]
            affinity_kind = str(selection.get("affinity_kind") or "")
            if affinity_kind and affinity_kind != "fallback" and matched:
                receipt = {
                    "schema_version": 1,
                    "status": "authorized",
                    "source": "threat_fronts.clock",
                    "active_scene_id": active_scene_id,
                    "front_id": selection.get("front_id"),
                    "clock_id": move.get("clock_id"),
                    "affinity_kind": affinity_kind,
                    "matched_ids": matched,
                    "rule": "Narrate only the symptom authorized by this structured affinity.",
                }
                authorized = True
        if not authorized:
            rejected.append({
                "index": index,
                "clock_id": move.get("clock_id"),
                "reason": "missing_structured_scene_affinity",
            })
            continue
        projected = dict(move)
        projected["grounding_receipt"] = receipt
        accepted.append(projected)
        receipts.append(dict(receipt))
    return accepted, {
        "schema_version": 1,
        "status": "authorized" if not rejected else "filtered",
        "active_scene_id": active_scene_id,
        "authorized_count": len(accepted),
        "rejected_count": len(rejected),
        "authorized_sources": receipts,
        "rejected": rejected,
        "rule": (
            "Narrate only pressure_moves with an authorized source receipt; "
            "do not add symptoms, objects, routes, or locations beyond it."
        ),
    }


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
        # A request may carry ``resolution_context`` containing the whole
        # pre-gate DirectorPlan. Narration needs only the public roll prompt;
        # settled fictional consequences arrive separately in rule_results.
        safe_request = {
            key: request.get(key)
            for key in (
                "kind", "skill", "characteristic", "difficulty", "reason",
                "request_id", "bonus_penalty_dice",
            )
            if request.get(key) is not None
        }
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


def _approved_reveal_must_include(
    plan: dict[str, Any], directives: dict[str, Any]
) -> list[Any]:
    """Keep presentation-only storylet cues out of approved fact authority.

    Older enriched plans copied every storylet cue into ``must_include`` even
    when the move's structured grounding explicitly disallowed a new
    actionable fact.  The move remains available in ``storylet_moves`` for
    presentation, but it must not become a required approved reveal.  Matching
    here is a structured provenance join (move.cue -> directive entry), not a
    semantic classification of prose.
    """
    presentation_only_cues: set[str] = set()
    for move in plan.get("storylet_moves") or []:
        if not isinstance(move, dict):
            continue
        grounding = move.get("grounding_contract")
        if not isinstance(grounding, dict):
            continue
        if grounding.get("allow_new_actionable_fact") is not False:
            continue
        cue = move.get("cue")
        if isinstance(cue, str) and cue.strip():
            presentation_only_cues.add(cue.strip())

    projected: list[Any] = []
    for item in directives.get("must_include") or []:
        if isinstance(item, str) and item.strip() in presentation_only_cues:
            continue
        projected.append(item)
    return projected


def _project_storylet_moves(plan: dict[str, Any]) -> list[dict[str, Any]]:
    """Project only source-authorized storylet facts or exact public routes.

    Entity binding is scheduling metadata, not fact authority.  Unverified
    library prose, beats, titles, and variants therefore never enter the
    narrator payload.  A bound open route may survive only as the exact cue
    already present in the settled choice frame.
    """
    route_cues = {
        str(route.get("route_id") or route.get("id")): str(route.get("cue")).strip()
        for route in (plan.get("choice_frame") or {}).get("routes", [])
        if isinstance(route, dict)
        and str(route.get("route_id") or route.get("id") or "")
        and isinstance(route.get("cue"), str)
        and route.get("cue").strip()
        and str(route.get("status") or "open") == "open"
    }
    active_scene_id = str(
        (plan.get("active_scene") or {}).get("scene_id")
        or (plan.get("turn_input") or {}).get("active_scene_id")
        or ""
    )
    projected: list[dict[str, Any]] = []
    for move in plan.get("storylet_moves") or []:
        if not isinstance(move, dict):
            continue
        grounding = move.get("grounding_contract")
        grounding = grounding if isinstance(grounding, dict) else {}
        authorization = grounding.get("fact_authorization")
        fact_authorized = (
            grounding.get("allow_new_actionable_fact") is True
            and isinstance(authorization, dict)
            and authorization.get("status") == "authorized"
            and str(authorization.get("storylet_id") or "")
            == str(move.get("storylet_id") or "")
            and (
                not active_scene_id
                or str(authorization.get("scene_id") or "") == active_scene_id
            )
            and bool(authorization.get("source_refs"))
        )
        if fact_authorized:
            projected.append(dict(move))
            continue
        bound = move.get("bound_entities")
        route_id = str(bound.get("route_id") or "") if isinstance(bound, dict) else ""
        route_cue = route_cues.get(route_id)
        if not route_cue:
            continue
        projected.append({
            "schema_version": 1,
            "presentation_mode": "existing_route_only",
            "cue": route_cue,
            "beat": None,
            "bound_entities": {"route_id": route_id},
            "rolled_variants": {},
            "grounding_contract": {
                "allow_new_actionable_fact": False,
                "authorized_route_ids": [route_id],
                "fallback_mode": "existing_route_only_or_suppress",
                "source": "narrator_storylet_projection",
            },
        })
    return projected


def build_narration_envelope(
    plan: dict[str, Any],
    *,
    clue_graph: dict[str, Any] | None = None,
    epistemic_graph: dict[str, Any] | None = None,
    active_scene: dict[str, Any] | None = None,
    investigator_display_name: str | None = None,
    applied_events: list[dict[str, Any]] | None = None,
    route_completion_receipts: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build the minimum-privilege narrator payload from a DirectorPlan.

    Includes this-turn approved reveals (with player_safe_summary bodies when
    the clue-graph is supplied), settled rule_results, scene sensory anchors,
    tone, constraints, and must_not_reveal as {id, category} only. Keeper
    secret prose must never appear in the serialized envelope.
    """
    directives = plan.get("narrative_directives") or {}
    style = directives.get("player_facing_style")
    play_language = (
        str(style.get("language") or "zh-Hans")
        if isinstance(style, dict)
        else "zh-Hans"
    )
    clue_policy = plan.get("clue_policy") or {}
    mnr_refs = normalize_keeper_secret_refs(directives.get("must_not_reveal") or [])
    clue_ids = _approved_reveal_clue_ids(plan, applied_events)
    disclosure_decisions = list(plan.get("disclosure_decisions") or [])
    if applied_events is not None:
        approved_set = set(clue_ids)
        disclosure_decisions = [
            ({**decision, "outcome": "withhold"}
             if isinstance(decision, dict) and decision.get("outcome") == "reveal"
             and str(decision.get("clue_id") or "") not in approved_set
             else decision)
            for decision in disclosure_decisions
        ]
    reveal_must_include = _approved_reveal_must_include(plan, directives)
    social_post_apply = (
        applied_events is not None and coc_npc_state.is_social_clue_plan(plan)
    )
    if social_post_apply:
        # Social prose may have been compiled before the apply-side disclosure
        # gate. Only canonical clue summaries from actual clue_reveal events are
        # authorized here; lie/deflect lines travel through their safe field.
        reveal_must_include = []
    npc_moves = [
        _sanitize_npc_move(move, play_language)
        for move in (plan.get("npc_moves") or [])
        if isinstance(move, dict)
    ]
    scene = active_scene
    if not isinstance(scene, dict) or not scene:
        scene = plan.get("active_scene") if isinstance(plan.get("active_scene"), dict) else {}
    declared_scene_npc_ids = {
        str(value).strip()
        for value in (scene.get("npc_ids") or [])
        if str(value or "").strip()
    }
    present_scene_npc_ids = _present_scene_npc_ids(
        scene,
        route_completion_receipts,
    )
    present_scene_npc_id_set = set(present_scene_npc_ids)
    if declared_scene_npc_ids:
        npc_moves = [
            move for move in npc_moves
            if not str(move.get("npc_id") or "").strip()
            or str(move.get("npc_id")).strip() in present_scene_npc_id_set
        ]
    scene_before_id = str(
        plan.get("turn_input", {}).get("active_scene_id")
        or scene.get("scene_id")
        or ""
    )
    transition_events = [
        event for event in (applied_events or [])
        if isinstance(event, dict) and event.get("event_type") == "scene_transition"
    ]
    canonical_scene_id = str(scene.get("scene_id") or "")
    receipt_scene_id = ""
    if transition_events:
        receipt_scene_id = str(
            transition_events[-1].get("to_scene")
            or transition_events[-1].get("scene_id")
            or ""
        )
    # Current transactional world state is the location authority.  A receipt
    # supplies trace evidence (and a fallback for direct library use), but a
    # stale or incorrectly assembled receipt must not override canonical state.
    scene_after_id = canonical_scene_id or receipt_scene_id or scene_before_id
    canonical_scene_changed = bool(
        canonical_scene_id and canonical_scene_id != scene_before_id
    )
    scene_transition_committed = bool(transition_events) or canonical_scene_changed
    grounded_pressure_moves, pressure_grounding = _project_grounded_pressure_moves(
        plan,
        active_scene_id=scene_after_id,
    )
    turn_input = plan.get("turn_input") if isinstance(plan.get("turn_input"), dict) else {}
    turn_rich = turn_input.get("player_intent_rich") if isinstance(turn_input.get("player_intent_rich"), dict) else {}
    player_text = str(turn_input.get("player_intent") or "").strip()
    primary_intent = str(
        turn_rich.get("primary_intent")
        or turn_input.get("player_intent_class")
        or ""
    ).strip()
    action_uptake = None
    if player_text:
        action_uptake = {
            "player_text": player_text,
            "primary_intent": primary_intent,
            "authority": "player_message",
            "render_policy": {
                "when": "the player commits to an in-fiction action or speech",
                "instruction": (
                    "Naturally enact the player's declared action from the "
                    "investigator's in-world viewpoint before or while revealing "
                    "its settled outcome. Preserve the player's method, target, "
                    "stated precautions, constraints, and meaningful spoken words."
                ),
                "do_not": [
                    "quote_or_paraphrase_the_whole_message_as_a_summary",
                    "invent_additional_investigator_actions",
                    "force_meta_questions_planning_or_hypotheticals_into_fiction",
                    "treat_current_action_uptake_as_semantic_repetition",
                ],
                "hard_gate": False,
            },
        }
    action_resolution = turn_rich.get("action_resolution") if isinstance(turn_rich.get("action_resolution"), dict) else {}
    keeper_proposal = (
        action_resolution.get("keeper_proposal")
        if isinstance(action_resolution.get("keeper_proposal"), dict)
        else {}
    )
    understood_unbound = keeper_proposal.get("resolution_mode") in {
        "authored", "improvised", "subsystem",
    }
    recovery_required = bool(
        not scene_transition_committed
        and action_resolution
        and (
            (
                action_resolution.get("no_match") is True
                and not understood_unbound
            )
            or (
                action_resolution.get("matched_destination_scene_id") is None
                and turn_input.get("player_intent_class") == "move"
            )
        )
    )
    redirection = _sanitize_redirection(plan.get("redirection"))
    redirection_grounding = (
        redirection.get("grounding")
        if isinstance(redirection, dict)
        and isinstance(redirection.get("grounding"), dict)
        else {}
    )
    redirection_npc_id = str(redirection_grounding.get("npc_id") or "").strip()
    if (
        redirection_npc_id
        and declared_scene_npc_ids
        and redirection_npc_id not in present_scene_npc_id_set
    ):
        redirection = None
        redirection_grounding = {}
    present_npc_names = list(dict.fromkeys(
        name
        for name in (
            *(_npc_display_name(move) for move in npc_moves),
            redirection_grounding.get("display_name"),
        )
        if isinstance(name, str) and name.strip()
    ))
    present_npc_ids = list(dict.fromkeys(
        npc_id
        for npc_id in (
            *present_scene_npc_ids,
            str(redirection_grounding.get("npc_id") or "").strip(),
        )
        if npc_id
    ))
    envelope: dict[str, Any] = {
        "decision_id": plan.get("decision_id"),
        "action_uptake": action_uptake,
        "scene_action": plan.get("scene_action"),
        "dramatic_question": plan.get("dramatic_question"),
        "handoff": plan.get("handoff"),
        "approved_reveals": {
            "clue_ids": list(clue_ids),
            "clues": _project_approved_reveal_clues(plan, clue_graph, applied_events),
            "must_include": reveal_must_include,
            "leads": [] if social_post_apply else list(clue_policy.get("leads") or []),
            "fallback_routes": (
                [] if social_post_apply else list(clue_policy.get("fallback_routes") or [])
            ),
        },
        "tone": list(directives.get("tone") or []),
        "must_not_reveal": mnr_refs,
        "improvisation_allowed": list(directives.get("improvisation_allowed") or []),
        "horror_escalation_stage": directives.get("horror_escalation_stage"),
        "horror_profile": _project_horror_profile(directives.get("horror_profile")),
        "render_mode": _project_render_mode(directives.get("render_mode")),
        "content_constraints": list(directives.get("content_constraints") or []),
        "player_facing_style": directives.get("player_facing_style"),
        "keeper_plan": _sanitize_keeper_plan(directives.get("keeper_plan")),
        "typed_player_safe_limitation": None,
        "npc_moves": npc_moves,
        "disclosure_decisions": _sanitize_disclosure_decisions(
            disclosure_decisions
        ),
        "pressure_moves": grounded_pressure_moves,
        "pressure_grounding": pressure_grounding,
        "storylet_moves": _project_storylet_moves(plan),
        # The frame has already been rebuilt from settled post-apply state.
        # Keep its player-visible cues so narration remains actionable, while
        # _sanitize_choice_frame strips the undiscovered clue IDs behind them.
        "choice_frame": _sanitize_choice_frame(plan.get("choice_frame") or {}),
        "rules_requests": _project_rules_requests(plan),
        "rule_results": _project_rule_results(
            plan,
            investigator_display_name=investigator_display_name,
            applied_events=applied_events,
        ),
        "action_outcomes": _project_action_outcomes(applied_events),
        "scene_anchor": _build_scene_anchor(
            scene,
            play_language=play_language,
        ),
        "state_grounding": {
            "active_scene_before_id": scene_before_id,
            "active_scene_after_id": scene_after_id,
            "scene_transition_committed": scene_transition_committed,
            "recovery_required": recovery_required,
            "present_npc_names": present_npc_names,
            "present_npc_ids": present_npc_ids,
            "npc_presence_authority": {
                "scope": "physical_presence_only",
                "source": "scene.npc_presence_requirements+route_completion_receipts",
                "does_not_authorize": [
                    "prior_npc_knowledge",
                    "relationships",
                    "recommendations",
                    "quoted_dialogue",
                ],
                "relationship_or_knowledge_requires_structured_ref": True,
            },
            "attempted_destination_id": (
                ((plan.get("turn_input") or {}).get("player_intent_rich") or {})
                .get("action_resolution", {})
                .get("matched_destination_scene_id")
                if isinstance(
                    ((plan.get("turn_input") or {}).get("player_intent_rich") or {}).get("action_resolution"),
                    dict,
                )
                else None
            ),
            "rule": (
                "Narrate the investigator as located in active_scene_after_id. "
                "If scene_transition_committed is false, do not claim arrival at, "
                "or introduce observable facts from, another location. When "
                "recovery_required is true, explicitly and naturally state that "
                "the attempted change did not occur, anchor the current scene, "
                "and keep present_npc_names physically present."
            ),
        },
        "rationale": plan.get("rationale"),
    }
    limitation = directives.get("typed_player_safe_limitation")
    if isinstance(limitation, dict):
        style = directives.get("player_facing_style")
        language = (
            str(style.get("language") or "zh-Hans")
            if isinstance(style, dict) else "zh-Hans"
        )
        localized = limitation.get("localized_messages")
        message = (
            localized.get(language)
            if isinstance(localized, dict)
            else None
        ) or limitation.get("message")
        if isinstance(message, str) and message.strip():
            envelope["typed_player_safe_limitation"] = {
                "kind": (
                    str(limitation.get("kind"))
                    if limitation.get("kind") in {
                        "push_resolution_required",
                        "destination_not_known_and_reachable",
                    }
                    else "action_not_available"
                ),
                "message": message.strip(),
                "must_render_exactly_once": True,
            }
    if envelope["render_mode"] == "crisis":
        affordances = []
        for raw in scene.get("visible_affordances") or []:
            if isinstance(raw, str) and raw.strip():
                affordances.append(raw.strip())
            elif isinstance(raw, dict):
                cue = raw.get("cue") or raw.get("player_safe_summary")
                if isinstance(cue, str) and cue.strip():
                    affordances.append(cue.strip())
        frame = build_crisis_scene_render_frame(
            viewpoint_anchor=str(scene.get("viewpoint_anchor") or "").strip(),
            spatial_anchor=str(scene.get("spatial_anchor") or "").strip(),
            active_motion=str(scene.get("active_motion") or "").strip(),
            connection_or_force=str(scene.get("connection_or_force") or "").strip(),
            risk_progression=str(scene.get("risk_progression") or "").strip(),
            visible_affordances=affordances,
            player_entry=str(scene.get("player_entry") or "").strip(),
        )
        findings = validate_crisis_scene_render_frame(frame)
        if findings:
            envelope["render_frame_findings"] = findings
            envelope["render_mode"] = "pressure"
        else:
            envelope["render_frame"] = frame
    belief_update = coc_epistemic_narration.build_belief_update_projection(
        plan.get("epistemic_contract"), epistemic_graph
    )
    if belief_update is not None:
        envelope["belief_update"] = belief_update
    if redirection is not None:
        envelope["redirection"] = redirection
    return envelope


def project_pending_choice(value: Any) -> dict[str, Any] | None:
    """Whitelist a typed player choice for narrator/fallback presentation."""
    if not isinstance(value, dict) or value.get("responder") != "player":
        return None
    if value.get("kind") not in {"push_confirm", "chase_action", "combat_defense"}:
        return None
    prompt = value.get("prompt")
    options = value.get("options")
    if not isinstance(prompt, str) or not prompt.strip() or not isinstance(options, list):
        return None
    safe_options: list[dict[str, str]] = []
    for option in options:
        if (
            not isinstance(option, dict)
            or set(option) != {"action", "label"}
            or not isinstance(option.get("action"), str)
            or not option["action"].strip()
            or not isinstance(option.get("label"), str)
            or not option["label"].strip()
        ):
            return None
        safe_options.append({
            "action": option["action"].strip(),
            "label": option["label"].strip(),
        })
    return {
        "kind": value["kind"],
        "prompt": prompt.strip(),
        "options": safe_options,
    }


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
            and final_output_pass.get("reviewer") == "keeper_llm_semantic_review"
            and final_output_pass.get("tool") == "narration.review"
            and final_output_pass.get("authority") == "advisory"
            and final_output_pass.get("hard_gate") is False
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
# CLI: uv run --frozen python coc_narration_contract.py <plan.json> <scenario_dir>
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
