#!/usr/bin/env python3
"""Settled-turn source window, player mechanics, and exact output composition.

The Keeper still owns fictional meaning.  This module owns only structural
closure: find the latest unfinalized journal, discover canonical receipts,
require one semantic coverage row per obligation, and compose immutable public
mechanics after the Keeper's fiction.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
from typing import Any, Iterable

import coc_first_impression
import coc_roll
import coc_exceptional_effects


FINALIZATION_SCHEMA_VERSION = 1
FINALIZATION_FILENAME = "turn-finalizations.jsonl"
FINALIZATION_FIELDS = frozenset({
    "schema_version", "finalization_id", "decision_id", "journal_decision_id",
    "journal_call_index", "source_start_index", "source_end_index",
    "source_digest", "source_roll_ids", "obligation_ids", "coverage_ids",
    "draft_sha256", "coverage_sha256", "bundle_sha256", "rendered_sha256",
    "bundle", "coverage", "segments", "rendered_text", "integrity_digest",
})
COVERAGE_FIELDS = frozenset({
    "obligation_id", "realization", "action_realization", "response",
    "causal_explanation", "persona_fit", "player_input_handling",
    "exact_excerpt", "exceptional_beat",
})
REALIZATION_VALUES = frozenset({
    "fictional_beat", "concealed_no_player_visible_beat",
})
PLAYER_INPUT_HANDLING_VALUES = frozenset({
    "abstract_completed", "specific_preserved", "not_applicable",
})
POST_JOURNAL_ALLOWED_TOOLS = frozenset({
    "turn.output_context", "narration.brief", "narration.review",
})


class TurnContractError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def canonical_digest(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise TurnContractError("state_corrupt", f"cannot read {path.name}") from exc
    rows: list[dict[str, Any]] = []
    for line_number, raw in enumerate(text.splitlines(), start=1):
        if not raw.strip():
            continue
        try:
            row = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise TurnContractError(
                "state_corrupt", f"{path.name} line {line_number} is malformed"
            ) from exc
        if not isinstance(row, dict):
            raise TurnContractError(
                "state_corrupt", f"{path.name} line {line_number} is not an object"
            )
        rows.append(row)
    return rows


def _structured_skill_labels(
    campaign_dir: Path, investigator_id: str, play_language: str
) -> dict[str, str]:
    """Return exact character-card skill key/label pairs for display only."""
    if play_language != "zh-Hans" or Path(investigator_id).name != investigator_id:
        return {}
    character_path = (
        Path(campaign_dir).parent.parent
        / "investigators"
        / investigator_id
        / "character.json"
    )
    try:
        character = json.loads(character_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {}
    sheet = (
        character.get("player_facing_sheet_zh")
        if isinstance(character, dict) else None
    )
    rows = sheet.get("skills") if isinstance(sheet, dict) else None
    labels: dict[str, str] = {}
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        key = row.get("key")
        label = row.get("label")
        if (
            isinstance(key, str) and key.strip()
            and isinstance(label, str) and label.strip()
        ):
            labels[key] = label
    return labels


def _attach_structured_skill_labels(
    campaign_dir: Path, rolls: list[dict[str, Any]]
) -> None:
    campaign_path = Path(campaign_dir) / "campaign.json"
    try:
        campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        campaign = {}
    play_language = str(
        campaign.get("play_language") or "zh-Hans"
    ) if isinstance(campaign, dict) else "zh-Hans"
    labels_by_investigator: dict[str, dict[str, str]] = {}
    for raw in rolls:
        skill = raw.get("skill")
        investigator_id = raw.get("investigator_id") or raw.get("actor")
        if not isinstance(skill, str) or not isinstance(investigator_id, str):
            continue
        if investigator_id not in labels_by_investigator:
            labels_by_investigator[investigator_id] = _structured_skill_labels(
                Path(campaign_dir), investigator_id, play_language
            )
        display_skill = labels_by_investigator[investigator_id].get(skill)
        if display_skill:
            raw["display_skill"] = display_skill


def _valid_finalization(row: Any) -> bool:
    if not isinstance(row, dict) or set(row) != FINALIZATION_FIELDS:
        return False
    if row.get("schema_version") != FINALIZATION_SCHEMA_VERSION:
        return False
    for key in (
        "finalization_id", "decision_id", "journal_decision_id",
        "source_digest", "draft_sha256", "coverage_sha256", "bundle_sha256",
        "rendered_sha256", "rendered_text", "integrity_digest",
    ):
        if not isinstance(row.get(key), str) or not row[key]:
            return False
    for key in (
        "journal_call_index", "source_start_index", "source_end_index",
    ):
        if isinstance(row.get(key), bool) or not isinstance(row.get(key), int):
            return False
    for key in ("source_roll_ids", "obligation_ids", "coverage_ids", "coverage", "segments"):
        if not isinstance(row.get(key), list):
            return False
    if not isinstance(row.get("bundle"), dict):
        return False
    body = {key: deepcopy(value) for key, value in row.items() if key != "integrity_digest"}
    return row.get("integrity_digest") == canonical_digest(body)


def load_finalizations(campaign_dir: Path) -> list[dict[str, Any]]:
    rows = _read_jsonl(Path(campaign_dir) / "logs" / FINALIZATION_FILENAME)
    seen_decisions: set[str] = set()
    seen_journals: set[str] = set()
    for row in rows:
        if not _valid_finalization(row):
            raise TurnContractError("state_corrupt", "turn finalization receipt is invalid")
        if row["decision_id"] in seen_decisions or row["journal_decision_id"] in seen_journals:
            raise TurnContractError("state_corrupt", "turn finalization identity is duplicated")
        seen_decisions.add(row["decision_id"])
        seen_journals.add(row["journal_decision_id"])
    return rows


def finalization_by_decision(
    campaign_dir: Path, decision_id: str
) -> dict[str, Any] | None:
    matches = [
        row for row in load_finalizations(campaign_dir)
        if row["decision_id"] == decision_id
    ]
    return deepcopy(matches[0]) if matches else None


def _successful_calls(campaign_dir: Path) -> list[dict[str, Any]]:
    return _read_jsonl(Path(campaign_dir) / "logs" / "toolbox-calls.jsonl")


def _source_window(
    campaign_dir: Path,
) -> tuple[list[dict[str, Any]], dict[str, Any], int, int, list[dict[str, Any]]]:
    calls = _successful_calls(campaign_dir)
    finalizations = load_finalizations(campaign_dir)
    finalized_journals = {row["journal_decision_id"] for row in finalizations}
    candidates: list[tuple[int, dict[str, Any]]] = []
    for index, row in enumerate(calls):
        args = row.get("args") if isinstance(row.get("args"), dict) else {}
        decision_id = str(args.get("decision_id") or "").strip()
        if (
            row.get("ok") is True
            and row.get("tool") == "state.journal"
            and decision_id
            and decision_id not in finalized_journals
        ):
            candidates.append((index, row))
    if not candidates:
        raise TurnContractError(
            "no_unfinalized_journal",
            "record one successful state.journal before requesting final output",
        )
    journal_index, journal = candidates[-1]
    later = calls[journal_index + 1 :]
    illegal = [
        str(row.get("tool") or "")
        for row in later
        if row.get("ok") is True
        and row.get("tool") not in POST_JOURNAL_ALLOWED_TOOLS
    ]
    if illegal:
        raise TurnContractError(
            "settlement_after_journal",
            "successful settlement occurred after state.journal: " + ", ".join(illegal),
        )
    start_index = (
        int(finalizations[-1]["journal_call_index"]) + 1
        if finalizations else 0
    )
    if start_index > journal_index:
        raise TurnContractError("state_corrupt", "turn source window is inverted")
    return calls[start_index : journal_index + 1], journal, start_index, journal_index, finalizations


def _walk_dicts(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk_dicts(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_dicts(child)


def _referenced_roll_ids(window: list[dict[str, Any]]) -> set[str]:
    found: set[str] = set()
    for call in window:
        for row in _walk_dicts(call.get("data")):
            for key, value in row.items():
                if (key == "roll_id" or key.endswith("_roll_id")) and isinstance(value, str) and value:
                    found.add(value)
    return found


def _flatten_roll(row: dict[str, Any]) -> dict[str, Any]:
    payload = row.get("payload")
    flat = deepcopy(payload) if isinstance(payload, dict) else {}
    for key, value in row.items():
        if key != "payload":
            flat[key] = deepcopy(value)
    if not flat.get("roll_id") and row.get("roll_id"):
        flat["roll_id"] = row["roll_id"]
    return flat


def _source_rolls(
    campaign_dir: Path,
    window: list[dict[str, Any]],
    prior_finalizations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    referenced = _referenced_roll_ids(window)
    previously_used = {
        roll_id
        for receipt in prior_finalizations
        for roll_id in receipt.get("source_roll_ids") or []
    }
    rows = _read_jsonl(Path(campaign_dir) / "logs" / "rolls.jsonl")
    by_id: dict[str, dict[str, Any]] = {}
    for raw in rows:
        flat = _flatten_roll(raw)
        roll_id = str(flat.get("roll_id") or "").strip()
        if not roll_id:
            raise TurnContractError("state_corrupt", "canonical roll row lacks roll_id")
        if roll_id in by_id:
            raise TurnContractError("state_corrupt", f"canonical roll_id is duplicated: {roll_id}")
        by_id[roll_id] = flat
    missing = sorted(referenced - set(by_id))
    if missing:
        raise TurnContractError(
            "state_corrupt", "tool receipts reference missing roll rows: " + ", ".join(missing)
        )
    # Luck changes an already-settled public check without fabricating a new
    # die row.  Freeze the current canonical Luck receipt over that source so
    # the final player result shows raw die -> spend -> adjusted settlement.
    for call in window:
        if call.get("ok") is not True or call.get("tool") != "rules.luck_spend":
            continue
        data = call.get("data") if isinstance(call.get("data"), dict) else {}
        source_roll_id = str(data.get("source_roll_id") or "").strip()
        if source_roll_id not in by_id:
            raise TurnContractError(
                "state_corrupt", "Luck receipt references a missing public source roll"
            )
        visibility = by_id[source_roll_id].get("visibility")
        by_id[source_roll_id].update(deepcopy(data))
        by_id[source_roll_id]["roll_id"] = source_roll_id
        by_id[source_roll_id]["visibility"] = visibility
    return [
        by_id[roll_id]
        for roll_id in sorted(referenced - previously_used)
    ]


def _stable_effect_id(decision_id: str, category: str, key: str) -> str:
    digest = canonical_digest(["turn-player-effect-v1", decision_id, category, key]).split(":", 1)[1]
    return f"turn-effect-v1:{digest[:40]}"


def _exact_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _add_effect(target: dict[str, dict[str, Any]], effect: dict[str, Any]) -> None:
    effect_id = str(effect["effect_id"])
    prior = target.get(effect_id)
    if prior is not None and prior != effect:
        raise TurnContractError("state_corrupt", f"player effect {effect_id} conflicts")
    target[effect_id] = effect


def _scalar_effect(
    decision_id: str,
    resource: str,
    before: Any,
    after: Any,
    *,
    investigator_id: str,
) -> dict[str, Any] | None:
    if not (_exact_int(before) and _exact_int(after)) or before == after:
        return None
    return {
        "schema_version": 1,
        "category": "state_delta",
        "effect_id": _stable_effect_id(decision_id, "scalar", resource),
        "effect_kind": "scalar",
        "resource": resource,
        "investigator_id": investigator_id,
        "before": before,
        "delta": after - before,
        "after": after,
        "source_decision_id": decision_id,
    }


def _project_conditions(
    effects: dict[str, dict[str, Any]],
    *,
    decision_id: str,
    investigator_id: str,
    before: Any,
    after: Any,
) -> None:
    if not isinstance(before, list) or not isinstance(after, list):
        return
    before_set = {str(value) for value in before}
    after_set = {str(value) for value in after}
    for action, values in (("added", after_set - before_set), ("removed", before_set - after_set)):
        for condition in sorted(values):
            _add_effect(effects, {
                "schema_version": 1,
                "category": "state_delta",
                "effect_id": _stable_effect_id(decision_id, "condition", f"{action}:{condition}"),
                "effect_kind": "condition",
                "investigator_id": investigator_id,
                "condition": condition,
                "action": action,
                "source_decision_id": decision_id,
            })


def _project_player_state_receipt(
    effects: dict[str, dict[str, Any]], decision_id: str, receipt: Any
) -> None:
    if not isinstance(receipt, dict):
        return
    investigator_id = str(receipt.get("investigator_id") or "").strip()
    if not investigator_id:
        return
    for resource, key in (("HP", "hp"), ("SAN", "san"), ("MP", "mp"), ("Luck", "luck")):
        values = receipt.get(key)
        if isinstance(values, dict):
            effect = _scalar_effect(
                decision_id, resource, values.get("before"), values.get("after"),
                investigator_id=investigator_id,
            )
            if effect:
                _add_effect(effects, effect)
    _project_conditions(
        effects,
        decision_id=decision_id,
        investigator_id=investigator_id,
        before=receipt.get("conditions_before"),
        after=receipt.get("conditions_after"),
    )
    for ammo in receipt.get("loaded_ammunition") or []:
        if not isinstance(ammo, dict):
            continue
        before = ammo.get("before")
        after = ammo.get("after")
        weapon_id = str(ammo.get("weapon_id") or "").strip()
        if not weapon_id or not (_exact_int(before) and _exact_int(after)) or before == after:
            continue
        _add_effect(effects, {
            "schema_version": 1,
            "category": "state_delta",
            "effect_id": _stable_effect_id(decision_id, "loaded_ammunition", weapon_id),
            "effect_kind": "loaded_ammunition",
            "investigator_id": investigator_id,
            "weapon_id": weapon_id,
            "weapon_label": str(ammo.get("weapon_label") or weapon_id),
            "before": before,
            "change": after - before,
            "after": after,
            "scope": "current_loaded_magazine_only",
            "source_decision_id": decision_id,
        })


def _superseded_roll_ids(campaign_dir: Path) -> set[str]:
    """Roll ids marked superseded/voided so player-facing deltas can hide them."""
    hidden: set[str] = set()
    for raw in _read_jsonl(Path(campaign_dir) / "logs" / "rolls.jsonl"):
        flat = _flatten_roll(raw)
        if not is_player_facing_roll(flat):
            roll_id = str(flat.get("roll_id") or "").strip()
            if roll_id:
                hidden.add(roll_id)
    return hidden


def _project_state_deltas(
    window: list[dict[str, Any]],
    *,
    superseded_roll_ids: set[str] | None = None,
) -> list[dict[str, Any]]:
    effects: dict[str, dict[str, Any]] = {}
    hidden_rolls = superseded_roll_ids or set()
    for call in window:
        if call.get("ok") is not True:
            continue
        tool = str(call.get("tool") or "")
        args = call.get("args") if isinstance(call.get("args"), dict) else {}
        data = call.get("data") if isinstance(call.get("data"), dict) else {}
        decision_id = str(args.get("decision_id") or data.get("decision_id") or "").strip()
        if not decision_id:
            continue
        investigator_id = str(data.get("investigator_id") or args.get("investigator") or "").strip()
        if tool == "rules.damage" and investigator_id:
            roll_id = str(data.get("roll_id") or "").strip()
            if (
                data.get("player_facing") is False
                or data.get("superseded") is True
                or (roll_id and roll_id in hidden_rolls)
            ):
                continue
            effect = _scalar_effect(
                decision_id, "HP", data.get("hp_before"), data.get("hp_after"),
                investigator_id=investigator_id,
            )
            if effect:
                _add_effect(effects, effect)
            _project_conditions(
                effects,
                decision_id=decision_id,
                investigator_id=investigator_id,
                before=data.get("conditions_before"),
                after=data.get("conditions_after", data.get("conditions")),
            )
        elif tool == "rules.sanity_check" and investigator_id:
            effect = _scalar_effect(
                decision_id, "SAN", data.get("san_before"), data.get("san_after"),
                investigator_id=investigator_id,
            )
            if effect:
                _add_effect(effects, effect)
        elif tool == "rules.luck_spend" and investigator_id:
            effect = _scalar_effect(
                decision_id, "Luck", data.get("luck_before"), data.get("luck_after"),
                investigator_id=investigator_id,
            )
            if effect:
                _add_effect(effects, effect)
        elif tool == "state.advance_time":
            before, after = data.get("from_elapsed"), data.get("to_elapsed")
            if _exact_int(before) and _exact_int(after) and before != after:
                _add_effect(effects, {
                    "schema_version": 1,
                    "category": "state_delta",
                    "effect_id": _stable_effect_id(decision_id, "time", "elapsed_minutes"),
                    "effect_kind": "time",
                    "before": before,
                    "delta_minutes": after - before,
                    "after": after,
                    "source_decision_id": decision_id,
                })
        elif tool == "state.mark_safe_rest" and investigator_id:
            at_elapsed = data.get("at_elapsed")
            if _exact_int(at_elapsed):
                _add_effect(effects, {
                    "schema_version": 1,
                    "category": "state_delta",
                    "effect_id": _stable_effect_id(
                        decision_id, "rest", investigator_id
                    ),
                    "effect_kind": "rest",
                    "investigator_id": investigator_id,
                    "rest_kind": str(data.get("rest_kind") or "full_sleep"),
                    "at_elapsed": at_elapsed,
                    "sanity_day_reset": bool(data.get("sanity_day_reset")),
                    "source_decision_id": decision_id,
                })
        elif tool in {"state.item_grant", "state.item_remove"} and investigator_id and data.get("changed") is True:
            action = "acquired" if tool.endswith("grant") else "lost"
            item_id = str(data.get("item_id") or "").strip()
            label = str(data.get("label") or item_id).strip()
            if item_id and label:
                _add_effect(effects, {
                    "schema_version": 1,
                    "category": "state_delta",
                    "effect_id": _stable_effect_id(decision_id, "item", item_id),
                    "effect_kind": "item",
                    "investigator_id": investigator_id,
                    "item_id": item_id,
                    "label": label,
                    "action": action,
                    "present_before": action == "lost",
                    "present_after": action == "acquired",
                    "source_decision_id": decision_id,
                })
        elif tool == "state.clear_transient_condition" and investigator_id:
            _project_conditions(
                effects,
                decision_id=decision_id,
                investigator_id=investigator_id,
                before=data.get("conditions_before"),
                after=data.get("conditions_after"),
            )
        _project_player_state_receipt(effects, decision_id, data.get("player_state_receipt"))
    # Dict insertion order is the canonical successful toolbox-call order from
    # ``window``.  Keep it for non-time effects: effect ids are content hashes
    # and sorting by them can scramble causal chains such as
    # A.before -> A.after -> B.after.
    # Time effects are a special case: same-turn multi-advance display must
    # stay chronological by elapsed minutes, never reverse.
    ordered = list(effects.values())
    return _order_state_deltas_chronologically(ordered)


def _order_state_deltas_chronologically(
    effects: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Keep non-time insertion order; force time effects ascending by ``before``."""
    if not effects:
        return []
    time_indices = [
        index for index, effect in enumerate(effects)
        if effect.get("effect_kind") == "time"
    ]
    if len(time_indices) <= 1:
        return effects
    time_effects = [effects[index] for index in time_indices]
    time_effects.sort(
        key=lambda effect: (
            int(effect.get("before") or 0),
            int(effect.get("after") or 0),
            str(effect.get("source_decision_id") or ""),
        )
    )
    rebuilt: list[dict[str, Any]] = []
    time_iter = iter(time_effects)
    for effect in effects:
        if effect.get("effect_kind") == "time":
            rebuilt.append(next(time_iter))
        else:
            rebuilt.append(effect)
    return rebuilt


def _project_context_effects(window: list[dict[str, Any]]) -> list[dict[str, Any]]:
    effects: dict[str, dict[str, Any]] = {}
    for call in window:
        if call.get("ok") is not True or call.get("tool") != "state.record_npc_engagement":
            continue
        data = call.get("data") if isinstance(call.get("data"), dict) else {}
        effect = data.get("context_effect")
        if not isinstance(effect, dict):
            continue
        effect_id = str(effect.get("effect_id") or "")
        if not effect_id:
            raise TurnContractError("state_corrupt", "first-contact context effect lacks effect_id")
        prior = effects.get(effect_id)
        if prior is not None and prior != effect:
            raise TurnContractError("state_corrupt", "first-contact context effect conflicts")
        effects[effect_id] = deepcopy(effect)
    return sorted(
        effects.values(),
        key=lambda effect: (
            str(effect.get("investigator_id") or ""),
            str(effect.get("npc_id") or ""),
            str(effect.get("effect_id") or ""),
        ),
    )


def _project_exceptional_effects(
    window: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return player blocks plus full source-bound apply records."""
    player_events: dict[str, dict[str, Any]] = {}
    applied: dict[str, dict[str, Any]] = {}
    for call in window:
        if call.get("ok") is not True or call.get("tool") != "state.exceptional_effect":
            continue
        data = call.get("data") if isinstance(call.get("data"), dict) else {}
        action = str(data.get("action") or "")
        effect = data.get("effect")
        if action not in {"apply", "consume"} or not coc_exceptional_effects.valid_effect(effect):
            raise TurnContractError(
                "state_corrupt", "exceptional effect call lacks a valid canonical effect"
            )
        if action == "apply":
            effect_id = str(effect["effect_id"])
            prior = applied.get(effect_id)
            if prior is not None and prior != effect:
                raise TurnContractError("state_corrupt", "exceptional effect apply conflicts")
            applied[effect_id] = deepcopy(effect)
        player = data.get("player_effect")
        expected = coc_exceptional_effects.project_player_effect(effect)
        if player != expected:
            raise TurnContractError(
                "state_corrupt", "exceptional effect player projection conflicts"
            )
        if isinstance(player, dict):
            event_id = str(player.get("event_id") or "")
            if not event_id:
                raise TurnContractError(
                    "state_corrupt", "exceptional effect player event lacks event_id"
                )
            player_events[event_id] = deepcopy(player)
    return (
        [player_events[key] for key in sorted(player_events)],
        [applied[key] for key in sorted(applied)],
    )


def _roll_kind(raw: dict[str, Any]) -> str:
    if raw.get("roll_role") == "amount":
        return "amount"
    kind = str(raw.get("kind") or raw.get("type") or "")
    if kind in {"san_loss", "hp_damage", "hp_heal", "damage", "healing", "random_table"}:
        return "amount"
    return "check"


def _build_obligations(
    rolls: list[dict[str, Any]],
    context_effects: list[dict[str, Any]],
    exceptional_applies: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    obligations: list[dict[str, Any]] = []
    concealed: list[dict[str, Any]] = []
    for raw in rolls:
        roll_id = str(raw["roll_id"])
        visibility = str(raw.get("visibility") or "public")
        hidden = not is_player_facing_roll(raw)
        outcome = str(raw.get("outcome") or "")
        pushed_failure = bool(raw.get("pushed") is True and outcome == "failure")
        effect_direction = (
            "benefit" if outcome == "critical"
            else "cost" if outcome == "fumble" or pushed_failure
            else None
        )
        source_effects = [
            effect for effect in exceptional_applies
            if (effect.get("source_roll") or {}).get("roll_id") == roll_id
            and effect.get("direction") == effect_direction
        ]
        obligation_id = f"roll:{roll_id}"
        obligations.append({
            "obligation_id": obligation_id,
            "source_kind": "concealed_roll" if hidden else _roll_kind(raw),
            "source_id": roll_id,
            "visibility": "keeper_only" if hidden else visibility,
            "skill": raw.get("skill") or raw.get("characteristic") or raw.get("kind"),
            "goal": raw.get("goal") or raw.get("source") or raw.get("reason"),
            "outcome": outcome or None,
            "required_level": raw.get("required_level"),
            "achieved_level": raw.get("achieved_level"),
            "passed": raw.get("passed"),
            "surplus_levels": raw.get("surplus_levels"),
            "exceptional_required": outcome in {"critical", "fumble"} or pushed_failure,
            "substantive_effect_required": effect_direction is not None,
            "substantive_effect_direction": effect_direction,
            "substantive_effect_ids": sorted(
                str(effect["effect_id"]) for effect in source_effects
            ),
            "substantive_effect_status": (
                "applied" if source_effects else "missing" if effect_direction else "not_required"
            ),
        })
        if hidden:
            concealed.append({
                "schema_version": 1,
                "category": "concealed_consequence",
                "effect_id": f"concealed:{roll_id}",
                "obligation_id": obligation_id,
                "observable": False,
            })
    for effect in context_effects:
        source_id = str(effect["source_receipt_id"])
        obligations.append({
            "obligation_id": f"first-impression:{source_id}",
            "source_kind": "first_impression",
            "source_id": source_id,
            "visibility": "context_effect",
            "skill": None,
            "goal": "realize the NPC's first observable response",
            "outcome": None,
            "required_level": None,
            "achieved_level": None,
            "passed": None,
            "surplus_levels": None,
            "exceptional_required": False,
            "substantive_effect_required": False,
            "substantive_effect_direction": None,
            "substantive_effect_ids": [],
            "substantive_effect_status": "not_required",
        })
    obligations.sort(key=lambda row: row["obligation_id"])
    return obligations, concealed


PLAYER_FACING_ROLL_VISIBILITIES = frozenset({"public", "consequence_public"})
# Settlements corrected after the fact stay in the audit log but must not face
# the player again (battle report, turn.finalize public block, development
# hard output).
SUPERSEDED_ROLL_VISIBILITIES = frozenset({
    "superseded", "voided", "corrected_hidden", "keeper_only",
})


def is_player_facing_roll(raw: dict[str, Any]) -> bool:
    """Return True when a roll may appear in player-facing final mechanics."""
    if not isinstance(raw, dict):
        return False
    if raw.get("player_facing") is False:
        return False
    if raw.get("superseded") is True or raw.get("voided") is True:
        return False
    visibility = str(raw.get("visibility") or "public").casefold()
    if visibility in SUPERSEDED_ROLL_VISIBILITIES:
        return False
    return visibility in {value.casefold() for value in PLAYER_FACING_ROLL_VISIBILITIES}


def _render_public_roll(raw: dict[str, Any]) -> str:
    skill = str(
        raw.get("display_skill")
        or raw.get("skill")
        or raw.get("characteristic")
        or raw.get("kind")
        or "检定"
    )
    if _roll_kind(raw) == "check" and all(
        key in raw for key in (
            "roll", "base_target", "required_level", "required_target",
            "achieved_level", "passed", "surplus_levels", "outcome",
        )
    ):
        detail = coc_roll.format_percentile_result(raw, compact=True)
        if all(_exact_int(raw.get(key)) for key in ("original_roll", "luck_spent", "adjusted_roll")):
            detail = detail.replace(
                f"掷骰：{raw['adjusted_roll']}；",
                f"原始：{raw['original_roll']}；幸运 -{raw['luck_spent']}；调整：{raw['adjusted_roll']}；",
                1,
            )
        if raw.get("kind") == "npc_first_impression":
            governing = (
                "信用评级"
                if raw.get("governing_attribute") == "credit_rating"
                else "外貌"
            )
            return (
                f"【明骰】初印象·{raw.get('npc_display_name', '这名人物')}｜"
                f"外貌 {raw.get('app')} / 信用评级 {raw.get('credit_rating')}；"
                f"采用{governing} {raw.get('governing_value')}｜{detail}"
            )
        return f"【明骰】{skill}｜{detail}"
    dice = raw.get("dice") if isinstance(raw.get("dice"), dict) else {}
    expression = str(
        dice.get("expression")
        or raw.get("die_expression")
        or raw.get("expression")
        or raw.get("die")
        or "骰值"
    )
    faces = (
        dice.get("raw")
        or raw.get("individual_faces")
        or raw.get("rolls")
        or raw.get("die_rolls")
        or []
    )
    total = dice.get("total")
    if not _exact_int(total):
        total = raw.get("rolled_total", raw.get("final_total", raw.get("roll")))
    if isinstance(faces, list) and faces:
        face_text = "+".join(str(value) for value in faces)
    elif _exact_int(total):
        # Single-total public amounts (e.g. 1D6 SAN reward) must not render an
        # empty "骰面 — →" placeholder when component faces were not stored.
        face_text = str(total)
    else:
        face_text = "—"
    return f"【明骰】{skill}（{expression}）：骰面 {face_text} → 总值 {total}"


def _render_state_delta(effect: dict[str, Any]) -> str:
    kind = effect["effect_kind"]
    if kind == "scalar":
        return f"【变化】{effect['resource']}：{effect['before']} → {effect['after']}（{effect['delta']:+d}）"
    if kind == "time":
        return f"【变化】时间：+{effect['delta_minutes']} 分钟（累计 {effect['after']} 分钟）"
    if kind == "rest":
        reset = "；理智日计数已重置" if effect.get("sanity_day_reset") else ""
        return f"【变化】休息：完成安全的整夜睡眠{reset}"
    if kind == "item":
        action = "获得" if effect["action"] == "acquired" else "失去"
        return f"【变化】物品：{action}「{effect['label']}」"
    if kind == "condition":
        action = "新增" if effect["action"] == "added" else "解除"
        return f"【变化】状态：{action}「{effect['condition']}」"
    if kind == "loaded_ammunition":
        delta = effect["change"]
        action = f"装填 {delta} 发" if delta > 0 else f"消耗 {-delta} 发"
        return (
            f"【变化】当前弹匣·{effect['weapon_label']}：{effect['before']} → "
            f"{effect['after']}（{action}；不含未建账的备用弹药）"
        )
    raise TurnContractError("state_corrupt", f"unknown player state delta kind: {kind}")


def _render_context_effect(effect: dict[str, Any]) -> str:
    if effect.get("contract_version") == "public-roll-v2":
        return (
            f"【初次反应】{effect['npc_display_name']}：{effect['observable_manner']}｜"
            f"因果：{effect['causal_explanation']}｜"
            f"当下机会/摩擦：{effect['opportunity_or_friction']}｜"
            f"边界仍在：{effect['boundary_preserved']}"
        )
    governing = "信用评级" if effect["governing_attribute"] == "credit_rating" else "外貌"
    override = ""
    if effect.get("context_basis") in {"既有关系", "既定立场"}:
        override = f"；{effect['context_basis']}优先"
    return (
        f"【初印象】外貌 {effect['app']} / 信用评级 {effect['credit_rating']}"
        f"（采用{governing} {effect['governing_value']}{override}）｜"
        f"初次反应：{effect['observable_manner']}"
    )


def _render_exceptional_effect(effect: dict[str, Any]) -> str:
    kind_labels = {
        "bonus_die": "奖励骰",
        "penalty_die": "惩罚骰",
        "condition": "状态",
        "restriction": "限制",
        "relationship_or_clock": "关系/时钟",
        "scene_event": "场景事件",
        "resource_delta": "资源",
    }
    boundary = effect["boundary"]
    boundary_kind = boundary["kind"]
    if boundary_kind == "immediate":
        boundary_text = "立即生效"
    elif boundary_kind == "until_consumed":
        boundary_text = "下一次符合范围的检定（一次）"
    elif boundary_kind == "until_scene_end":
        boundary_text = f"持续至场景 {boundary['scene_id']} 结束"
    elif boundary_kind == "until_time_marker":
        boundary_text = f"持续至时限 {boundary['marker_id']}"
    else:
        boundary_text = f"持续至：{boundary['description']}"
    status = "；已用于本次检定" if effect.get("status") == "consumed" else ""
    direction = "收益" if effect["direction"] == "benefit" else "代价"
    relationship_reward = bool(
        effect["direction"] == "benefit"
        and effect["effect_kind"] == "bonus_die"
        and (effect.get("mechanics") or {}).get("target_id")
    )
    heading = "关系/印象奖励" if relationship_reward else "特殊影响"
    target = (
        f"｜适用对象：{effect['mechanics']['target_display_name']}"
        if relationship_reward else ""
    )
    return (
        f"【{heading}】{direction}·{kind_labels[effect['effect_kind']]}："
        f"{effect['player_visible_impact']}｜因果：{effect['causal_link']}｜"
        f"边界：{boundary_text}{target}{status}"
    )


def _pending_modifier_consumptions(
    campaign_dir: Path, rolls: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    try:
        document = coc_exceptional_effects.load(campaign_dir)
    except ValueError as exc:
        raise TurnContractError("state_corrupt", str(exc)) from exc
    try:
        world = json.loads(
            (Path(campaign_dir) / "save" / "world-state.json").read_text(encoding="utf-8")
        )
    except (OSError, UnicodeError, json.JSONDecodeError):
        world = {}
    active_scene_id = str(world.get("active_scene_id") or "") if isinstance(world, dict) else ""
    pending: list[dict[str, Any]] = []
    for raw in rolls:
        roll_ts = str(raw.get("ts") or "")
        for effect in document["effects"].values():
            mechanics = effect.get("mechanics") or {}
            if (
                effect.get("status") != "active"
                or effect.get("effect_kind") not in {"bonus_die", "penalty_die"}
                or effect.get("created_at", "") >= roll_ts
                or mechanics.get("investigator_id") != raw.get("investigator_id")
                or str(mechanics.get("skill") or "").casefold()
                != str(raw.get("skill") or "").casefold()
                or (
                    mechanics.get("target_id") is not None
                    and mechanics.get("target_id") != raw.get("npc_id")
                )
                or (
                    mechanics.get("scene_id") is not None
                    and mechanics.get("scene_id") != active_scene_id
                )
            ):
                continue
            pending.append({
                "effect_id": effect["effect_id"],
                "roll_id": raw["roll_id"],
                "effect_kind": effect["effect_kind"],
                "required_dice": mechanics["dice"],
                "investigator_id": mechanics["investigator_id"],
                "skill": mechanics["skill"],
            })
    return sorted(pending, key=lambda row: (row["effect_id"], row["roll_id"]))


def build_output_context(campaign_dir: Path) -> dict[str, Any]:
    window, journal, start, end, finalizations = _source_window(campaign_dir)
    rolls = _source_rolls(campaign_dir, window, finalizations)
    _attach_structured_skill_labels(campaign_dir, rolls)
    public_rolls = [raw for raw in rolls if is_player_facing_roll(raw)]
    state_deltas = _project_state_deltas(
        window,
        superseded_roll_ids=_superseded_roll_ids(campaign_dir),
    )
    context_effects = _project_context_effects(window)
    exceptional_events, exceptional_applies = _project_exceptional_effects(window)
    obligations, concealed = _build_obligations(
        rolls, context_effects, exceptional_applies
    )
    missing_effects = [
        {
            "obligation_id": row["obligation_id"],
            "source_roll_id": row["source_id"],
            "required_direction": row["substantive_effect_direction"],
        }
        for row in obligations
        if row.get("substantive_effect_required")
        and row.get("substantive_effect_status") != "applied"
    ]
    pending_modifiers = _pending_modifier_consumptions(campaign_dir, rolls)
    journal_args = journal.get("args") if isinstance(journal.get("args"), dict) else {}
    journal_decision_id = str(journal_args.get("decision_id") or "")
    candidate_factors = []
    for call in window:
        if call.get("ok") is not True:
            continue
        tool = str(call.get("tool") or "")
        data = call.get("data") if isinstance(call.get("data"), dict) else {}
        if tool in {"rules.build_scale", "rules.cash_assets"}:
            candidate_factors.append({"tool": tool, "data": deepcopy(data)})
        elif tool in {"rules.roll", "rules.push"} and data.get("difficulty_basis"):
            candidate_factors.append({
                "tool": tool,
                "roll_id": data.get("roll_id"),
                "difficulty_basis": data.get("difficulty_basis"),
                "goal": data.get("goal"),
            })
    bundle = {
        "schema_version": 1,
        "journal_decision_id": journal_decision_id,
        "public_check": deepcopy(public_rolls),
        "state_delta": state_deltas,
        "context_effect": context_effects,
        "exceptional_effect": exceptional_events,
        "concealed_consequence": concealed,
    }
    source_digest = canonical_digest(window)
    return {
        "schema_version": 1,
        "journal_decision_id": journal_decision_id,
        "turn_number": (journal.get("data") or {}).get("turn_number"),
        "journal_call_index": end,
        "source_start_index": start,
        "source_end_index": end,
        "source_digest": source_digest,
        "source_roll_ids": sorted(str(raw["roll_id"]) for raw in rolls),
        "obligations": obligations,
        "required_obligation_ids": [row["obligation_id"] for row in obligations],
        "mechanics_bundle": bundle,
        "mechanics_bundle_sha256": canonical_digest(bundle),
        "candidate_factors": candidate_factors,
        "missing_substantive_effects": missing_effects,
        "pending_modifier_consumptions": pending_modifiers,
        "output_order": [
            "fiction", "public_check", "state_delta", "exceptional_effect",
            "context_effect",
        ],
    }


def validate_coverage(
    obligations: list[dict[str, Any]], coverage: Any, draft: str
) -> list[dict[str, Any]]:
    if not isinstance(coverage, list):
        raise TurnContractError("invalid_coverage", "coverage must be an array")
    required = {str(row["obligation_id"]): row for row in obligations}
    seen: dict[str, dict[str, Any]] = {}
    for index, row in enumerate(coverage):
        if not isinstance(row, dict) or set(row) != COVERAGE_FIELDS:
            raise TurnContractError(
                "invalid_coverage", f"coverage[{index}] must use the exact closed schema"
            )
        obligation_id = str(row.get("obligation_id") or "").strip()
        if not obligation_id or obligation_id in seen:
            raise TurnContractError("duplicate_obligation", f"duplicate coverage: {obligation_id}")
        if obligation_id not in required:
            raise TurnContractError("unknown_obligation", f"unknown coverage: {obligation_id}")
        realization = row.get("realization")
        if realization not in REALIZATION_VALUES:
            raise TurnContractError("invalid_coverage", f"invalid realization for {obligation_id}")
        handling = row.get("player_input_handling")
        if handling not in PLAYER_INPUT_HANDLING_VALUES:
            raise TurnContractError("invalid_coverage", f"invalid player_input_handling for {obligation_id}")
        if realization == "concealed_no_player_visible_beat":
            if required[obligation_id]["source_kind"] != "concealed_roll":
                raise TurnContractError(
                    "invalid_coverage", "only a concealed roll may close without a visible beat"
                )
            for key in (
                "action_realization", "response", "causal_explanation",
                "persona_fit", "exact_excerpt", "exceptional_beat",
            ):
                if row.get(key) not in (None, ""):
                    raise TurnContractError(
                        "invalid_coverage", f"{obligation_id} hidden no-effect row must not cite player prose"
                    )
        else:
            for key in (
                "action_realization", "response", "causal_explanation",
                "persona_fit", "exact_excerpt",
            ):
                value = row.get(key)
                if not isinstance(value, str) or not value.strip():
                    raise TurnContractError(
                        "invalid_coverage", f"{obligation_id} lacks non-empty {key}"
                    )
            if row["exact_excerpt"] not in draft:
                raise TurnContractError(
                    "excerpt_mismatch", f"{obligation_id} exact_excerpt is not verbatim in draft"
                )
        if required[obligation_id].get("exceptional_required"):
            beat = row.get("exceptional_beat")
            if not isinstance(beat, str) or not beat.strip():
                raise TurnContractError(
                    "exceptional_beat_required", f"{obligation_id} is critical/fumble"
                )
        seen[obligation_id] = deepcopy(row)
    missing = sorted(set(required) - set(seen))
    if missing:
        raise TurnContractError(
            "missing_obligation", "missing causal coverage: " + ", ".join(missing)
        )
    return [seen[key] for key in sorted(seen)]


def compose_segments(draft: str, bundle: dict[str, Any]) -> tuple[list[dict[str, Any]], str]:
    segments: list[dict[str, Any]] = [{
        "segment_type": "fiction",
        "text": draft,
        "source_ids": [],
    }]
    public_lines = [_render_public_roll(raw) for raw in bundle["public_check"]]
    if public_lines:
        segments.append({
            "segment_type": "public_check",
            "text": "\n".join(public_lines),
            "source_ids": [str(raw["roll_id"]) for raw in bundle["public_check"]],
        })
    delta_lines = [_render_state_delta(effect) for effect in bundle["state_delta"]]
    if delta_lines:
        segments.append({
            "segment_type": "state_delta",
            "text": "\n".join(delta_lines),
            "source_ids": [str(effect["effect_id"]) for effect in bundle["state_delta"]],
        })
    exceptional_lines = [
        _render_exceptional_effect(effect)
        for effect in bundle.get("exceptional_effect") or []
    ]
    if exceptional_lines:
        segments.append({
            "segment_type": "exceptional_effect",
            "text": "\n".join(exceptional_lines),
            "source_ids": [
                str(effect["event_id"])
                for effect in bundle.get("exceptional_effect") or []
            ],
        })
    context_lines = [_render_context_effect(effect) for effect in bundle["context_effect"]]
    if context_lines:
        segments.append({
            "segment_type": "context_effect",
            "text": "\n".join(context_lines),
            "source_ids": [str(effect["effect_id"]) for effect in bundle["context_effect"]],
        })
    rendered = "\n\n".join(segment["text"] for segment in segments)
    return segments, rendered


def build_finalization_receipt(
    campaign_dir: Path,
    *,
    decision_id: str,
    draft: str,
    coverage: Any,
) -> dict[str, Any]:
    if not isinstance(decision_id, str) or not decision_id.strip():
        raise TurnContractError("invalid_param", "decision_id must be non-empty")
    if not isinstance(draft, str) or not draft.strip():
        raise TurnContractError("invalid_param", "draft must be non-empty")
    context = build_output_context(campaign_dir)
    if context["missing_substantive_effects"]:
        missing = ", ".join(
            row["obligation_id"] for row in context["missing_substantive_effects"]
        )
        raise TurnContractError(
            "substantive_exceptional_effect_required",
            "critical/fumble/pushed-failure outcome lacks a source-bound applied effect: "
            + missing,
        )
    if context["pending_modifier_consumptions"]:
        pending = ", ".join(
            f"{row['effect_id']}->{row['roll_id']}"
            for row in context["pending_modifier_consumptions"]
        )
        raise TurnContractError(
            "exceptional_modifier_unconsumed",
            "an applicable one-shot exceptional modifier was not source-bound to its roll: "
            + pending,
        )
    normalized_coverage = validate_coverage(context["obligations"], coverage, draft)
    bundle = context["mechanics_bundle"]
    segments, rendered = compose_segments(draft, bundle)
    finalization_id = _stable_effect_id(
        decision_id, "turn_finalization", context["journal_decision_id"]
    )
    record = {
        "schema_version": FINALIZATION_SCHEMA_VERSION,
        "finalization_id": finalization_id,
        "decision_id": decision_id,
        "journal_decision_id": context["journal_decision_id"],
        "journal_call_index": context["journal_call_index"],
        "source_start_index": context["source_start_index"],
        "source_end_index": context["source_end_index"],
        "source_digest": context["source_digest"],
        "source_roll_ids": context["source_roll_ids"],
        "obligation_ids": context["required_obligation_ids"],
        "coverage_ids": [row["obligation_id"] for row in normalized_coverage],
        "draft_sha256": canonical_digest(draft),
        "coverage_sha256": canonical_digest(normalized_coverage),
        "bundle_sha256": canonical_digest(bundle),
        "rendered_sha256": canonical_digest(rendered),
        "bundle": deepcopy(bundle),
        "coverage": normalized_coverage,
        "segments": segments,
        "rendered_text": rendered,
    }
    record["integrity_digest"] = canonical_digest(record)
    if not _valid_finalization(record):
        raise TurnContractError("state_corrupt", "generated turn finalization is invalid")
    return record


def replay_matches(
    receipt: dict[str, Any], *, draft: Any, coverage: Any
) -> bool:
    if not isinstance(draft, str) or not isinstance(coverage, list):
        return False
    try:
        normalized = sorted(
            (deepcopy(row) for row in coverage),
            key=lambda row: str(row.get("obligation_id") or ""),
        )
    except (TypeError, AttributeError):
        return False
    return (
        receipt.get("draft_sha256") == canonical_digest(draft)
        and receipt.get("coverage_sha256") == canonical_digest(normalized)
    )


def append_finalization(campaign_dir: Path, receipt: dict[str, Any]) -> None:
    if not _valid_finalization(receipt):
        raise TurnContractError("state_corrupt", "refusing invalid turn finalization")
    path = Path(campaign_dir) / "logs" / FINALIZATION_FILENAME
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(receipt, ensure_ascii=False, sort_keys=True) + "\n")
