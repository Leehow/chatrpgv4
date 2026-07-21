#!/usr/bin/env python3
"""Settled-turn source window, player mechanics, and exact output composition.

The Keeper still owns fictional meaning.  This module owns only structural
closure: find the latest unfinalized journal, discover canonical receipts,
require one semantic coverage row per obligation, and place immutable public
mechanics at Keeper-selected paragraph boundaries without allowing their text
or arithmetic to be edited.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from pathlib import Path
from typing import Any, Iterable

import coc_first_impression
import coc_language
import coc_roll
import coc_exceptional_effects
import coc_rulesets
import coc_turn_manifest


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
MECHANIC_SEGMENT_TYPES = frozenset({
    "public_check", "state_delta", "exceptional_effect",
})
MECHANICS_PLACEMENT_FIELDS = frozenset({
    "after_paragraph", "segment_type", "source_ids",
})
class TurnContractError(ValueError):
    def __init__(
        self,
        code: str,
        message: str,
        violations: list[dict[str, str]] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.violations = violations


def _resource_projection_order(ruleset_id: str | None = None) -> tuple[tuple[str, str], ...]:
    """Resolve resource display order lazily for the active package."""
    active = ruleset_id or coc_rulesets.DEFAULT_RULESET_ID
    return tuple(
        (str(resource["display"]), str(resource["key"]))
        for resource in coc_rulesets.ruleset_resources(active)
        if isinstance(resource.get("display"), str)
        and isinstance(resource.get("key"), str)
    )


def _resource_display_map(ruleset_id: str | None = None) -> dict[str, str]:
    return {
        key: display for display, key in _resource_projection_order(ruleset_id)
    }


def _campaign_ruleset_id(campaign_dir: Path) -> str:
    path = Path(campaign_dir) / "campaign.json"
    try:
        campaign = json.loads(path.read_text(encoding="utf-8"))
        ruleset_id = coc_rulesets.get_campaign_ruleset_id(campaign)
        schema_version = campaign.get("schema_version")
        if isinstance(schema_version, bool) or not isinstance(schema_version, int):
            raise ValueError("campaign schema version is invalid")
        return coc_rulesets.require_registered_ruleset(
            ruleset_id,
            campaign_schema_version=schema_version,
        )
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        raise TurnContractError(
            "state_corrupt", "campaign ruleset binding is missing or invalid"
        ) from exc


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


def _campaign_play_language(campaign_dir: Path) -> str:
    campaign_path = Path(campaign_dir) / "campaign.json"
    try:
        campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        campaign = {}
    if isinstance(campaign, dict):
        language = str(campaign.get("play_language") or "").strip()
        if language:
            return language
    return coc_language.DEFAULT_PLAY_LANGUAGE


def _infer_play_language_from_rendered(rendered_text: str) -> str:
    """Best-effort language recovery for validating stored finalization receipts."""
    if "【Public roll】" in rendered_text or "【Change】" in rendered_text:
        return "en-US"
    if "【公開ロール】" in rendered_text or "【変化】" in rendered_text:
        return "ja-JP"
    return coc_language.DEFAULT_PLAY_LANGUAGE


def _structured_skill_labels(
    campaign_dir: Path, investigator_id: str, play_language: str
) -> dict[str, str]:
    """Return skill key → player-facing display label for the campaign language.

    Order: built-in `default_localized_terms(play_language)`, then any
    investigator language-specific player-facing skill sheet overrides.
    Machine skill keys stay English; only the display map is localized.
    """
    labels: dict[str, str] = {}
    for key, label in coc_language.default_localized_terms(play_language).items():
        if isinstance(key, str) and key.strip() and isinstance(label, str) and label.strip():
            labels[key] = label
    if Path(investigator_id).name != investigator_id:
        return labels
    sheet_candidates = [
        f"player_facing_sheet_{play_language.replace('-', '_')}",
    ]
    if play_language == "zh-Hans":
        sheet_candidates.append("player_facing_sheet_zh")
    character_path = (
        Path(campaign_dir).parent.parent
        / "investigators"
        / investigator_id
        / "character.json"
    )
    try:
        character = json.loads(character_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return labels
    if not isinstance(character, dict):
        return labels
    sheet = None
    for field in sheet_candidates:
        candidate = character.get(field)
        if isinstance(candidate, dict):
            sheet = candidate
            break
    rows = sheet.get("skills") if isinstance(sheet, dict) else None
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
    play_language = _campaign_play_language(campaign_dir)
    labels_by_investigator: dict[str, dict[str, str]] = {}
    terms = coc_language.default_localized_terms(play_language)
    chrome = coc_language.table_mechanics_labels(play_language)
    for raw in rolls:
        # Re-localize First Impression chrome so a frozen Chinese label is not
        # forced onto a non-zh campaign (or vice versa).
        if raw.get("kind") == "npc_first_impression" or raw.get("skill") in {
            "First Impression", "初印象",
        }:
            raw["display_skill"] = chrome.get(
                "first_impression_tag",
                coc_language.player_facing_skill_label(
                    "First Impression", play_language, terms=terms
                ),
            )
            continue
        skill = raw.get("skill")
        if not isinstance(skill, str):
            continue
        existing = raw.get("display_skill")
        # Canonical English left in display_skill is not localization — resolve.
        if (
            isinstance(existing, str)
            and existing.strip()
            and existing.strip() != skill
        ):
            continue
        investigator_id = raw.get("investigator_id") or raw.get("actor")
        display_skill = None
        if isinstance(investigator_id, str):
            if investigator_id not in labels_by_investigator:
                labels_by_investigator[investigator_id] = _structured_skill_labels(
                    Path(campaign_dir), investigator_id, play_language
                )
            display_skill = labels_by_investigator[investigator_id].get(skill)
        if not display_skill:
            display_skill = coc_language.player_facing_skill_label(
                skill, play_language, terms=terms
            )
        if display_skill:
            raw["display_skill"] = display_skill


def _legacy_context_effect_sources(
    bundle: dict[str, Any],
) -> set[tuple[str, str]] | None:
    """Return source identities from the retired player-visible context bundle.

    Early schema-v1 receipts rendered NPC context effects as deterministic
    mechanics. Current receipts keep that material Keeper-only. The historical
    row's hashes remain authoritative, so stored reads need only recover and
    validate the retired source identity set; new receipt validation never uses
    this compatibility path.
    """
    effects = bundle.get("context_effect")
    if effects is None:
        return set()
    if not isinstance(effects, list):
        return None
    identities: set[tuple[str, str]] = set()
    for effect in effects:
        effect_id = effect.get("effect_id") if isinstance(effect, dict) else None
        if not isinstance(effect_id, str) or not effect_id:
            return None
        identity = ("context_effect", effect_id)
        if identity in identities:
            return None
        identities.add(identity)
    return identities


def _valid_finalization_contract(
    row: Any, *, allow_legacy_context_effect: bool = False
) -> bool:
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
    segments = row["segments"]
    if not segments or not isinstance(segments[0], dict):
        return False
    seen_sources: set[tuple[str, str]] = set()
    fiction_parts: list[str] = []
    allowed_segment_types = {"fiction", *MECHANIC_SEGMENT_TYPES}
    if allow_legacy_context_effect:
        allowed_segment_types.add("context_effect")
    for segment in segments:
        if (
            not isinstance(segment, dict)
            or set(segment) != {"segment_type", "text", "source_ids"}
            or segment.get("segment_type") not in allowed_segment_types
            or not isinstance(segment.get("text"), str)
            or not segment["text"].strip()
            or not isinstance(segment.get("source_ids"), list)
            or not all(isinstance(value, str) and value for value in segment["source_ids"])
        ):
            return False
        segment_type = str(segment["segment_type"])
        if segment_type == "fiction":
            if segment["source_ids"]:
                return False
            fiction_parts.append(segment["text"])
            continue
        if not segment["source_ids"]:
            return False
        identities = {(segment_type, source_id) for source_id in segment["source_ids"]}
        if len(identities) != len(segment["source_ids"]) or seen_sources & identities:
            return False
        seen_sources.update(identities)
    if segments[0].get("segment_type") != "fiction":
        return False
    if canonical_digest("\n\n".join(fiction_parts)) != row["draft_sha256"]:
        return False
    if "\n\n".join(segment["text"] for segment in segments) != row["rendered_text"]:
        return False
    try:
        play_language = _infer_play_language_from_rendered(
            str(row.get("rendered_text") or "")
        )
        expected_sources = {
            (segment_type, source_id)
            for segment_type, values in _mechanic_source_lines(
                row["bundle"], play_language=play_language
            ).items()
            for source_id in values
        }
    except (KeyError, TypeError, TurnContractError):
        return False
    if allow_legacy_context_effect:
        legacy_sources = _legacy_context_effect_sources(row["bundle"])
        if legacy_sources is None:
            return False
        expected_sources.update(legacy_sources)
    if seen_sources != expected_sources:
        return False
    if (
        row.get("coverage_sha256") != canonical_digest(row["coverage"])
        or row.get("bundle_sha256") != canonical_digest(row["bundle"])
        or row.get("rendered_sha256") != canonical_digest(row["rendered_text"])
    ):
        return False
    body = {key: deepcopy(value) for key, value in row.items() if key != "integrity_digest"}
    return row.get("integrity_digest") == canonical_digest(body)


def _valid_finalization(row: Any) -> bool:
    """Validate only the current receipt contract used for new appends."""
    return _valid_finalization_contract(row)


def _valid_legacy_context_finalization(row: Any) -> bool:
    """Validate the retired schema-v1 context-mechanics receipt contract.

    This read-only branch is intentionally unreachable from generation and
    append validation. Historical rows must carry a non-empty context bundle,
    matching context segments, every current hash, and their original complete
    integrity digest.
    """
    if not isinstance(row, dict) or not isinstance(row.get("bundle"), dict):
        return False
    legacy_sources = _legacy_context_effect_sources(row["bundle"])
    if not legacy_sources:
        return False
    segments = row.get("segments")
    if not isinstance(segments, list) or not any(
        isinstance(segment, dict)
        and segment.get("segment_type") == "context_effect"
        for segment in segments
    ):
        return False
    return _valid_finalization_contract(
        row, allow_legacy_context_effect=True
    )


def _valid_stored_finalization(row: Any) -> bool:
    return _valid_finalization(row) or _valid_legacy_context_finalization(row)


def load_finalizations(campaign_dir: Path) -> list[dict[str, Any]]:
    rows = _read_jsonl(Path(campaign_dir) / "logs" / FINALIZATION_FILENAME)
    seen_decisions: set[str] = set()
    seen_journals: set[str] = set()
    for row in rows:
        if not _valid_stored_finalization(row):
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


def finalization_by_id(
    campaign_dir: Path, finalization_id: str
) -> dict[str, Any] | None:
    matches = [
        row for row in load_finalizations(campaign_dir)
        if row["finalization_id"] == finalization_id
    ]
    return deepcopy(matches[0]) if matches else None


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
    effects: dict[str, dict[str, Any]],
    decision_id: str,
    receipt: Any,
    *,
    resource_projection_order: tuple[tuple[str, str], ...],
) -> None:
    if not isinstance(receipt, dict):
        return
    investigator_id = str(receipt.get("investigator_id") or "").strip()
    if not investigator_id:
        return
    for resource, key in resource_projection_order:
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
    ruleset_id: str | None = None,
) -> list[dict[str, Any]]:
    effects: dict[str, dict[str, Any]] = {}
    hidden_rolls = superseded_roll_ids or set()
    resource_projection_order = _resource_projection_order(ruleset_id)
    resource_display = {
        key: display for display, key in resource_projection_order
    }
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
                decision_id, resource_display.get("hp", "HP"), data.get("hp_before"), data.get("hp_after"),
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
                decision_id, resource_display.get("san", "SAN"), data.get("san_before"), data.get("san_after"),
                investigator_id=investigator_id,
            )
            if effect:
                _add_effect(effects, effect)
        elif tool == "rules.luck_spend" and investigator_id:
            effect = _scalar_effect(
                decision_id, resource_display.get("luck", "Luck"), data.get("luck_before"), data.get("luck_after"),
                investigator_id=investigator_id,
            )
            if effect:
                _add_effect(effects, effect)
        elif tool in {
            "rules.first_aid",
            "rules.medicine",
            "rules.weekly_recovery",
            "rules.dying_check",
        } and investigator_id:
            # Backward compatibility for healing receipts written before
            # those tools emitted the shared player_state_receipt contract.
            # New receipts are projected again below; _add_effect verifies
            # that both views agree on the same deterministic effect id.
            event = data.get("event") if isinstance(data.get("event"), dict) else {}
            effect = _scalar_effect(
                decision_id,
                resource_display.get("hp", "HP"),
                event.get("hp_before"),
                event.get("hp_after"),
                investigator_id=investigator_id,
            )
            if effect:
                _add_effect(effects, effect)
        elif tool == "state.advance_time":
            before, after = data.get("from_elapsed"), data.get("to_elapsed")
            if _exact_int(before) and _exact_int(after) and before != after:
                previous_time = (
                    data.get("previous_time")
                    if isinstance(data.get("previous_time"), dict) else {}
                )
                current_time = (
                    data.get("current_time")
                    if isinstance(data.get("current_time"), dict) else {}
                )
                before_player = previous_time.get("player_time")
                after_player = current_time.get("player_time")
                def visible_time_key(value: Any) -> tuple[Any, Any, Any] | None:
                    if not isinstance(value, dict):
                        return None
                    return (
                        value.get("phase"),
                        value.get("appearance_mode"),
                        value.get("display_label"),
                    )
                # Exact elapsed time remains authoritative in state/time logs.
                # The player mechanics block changes only when its broad
                # semantic projection changes; repeating “still morning” for
                # every five-minute action is noise, not useful information.
                if (
                    visible_time_key(before_player) is None
                    or visible_time_key(before_player) != visible_time_key(after_player)
                ):
                    _add_effect(effects, {
                        "schema_version": 1,
                        "category": "state_delta",
                        "effect_id": _stable_effect_id(decision_id, "time", "elapsed_minutes"),
                        "effect_kind": "time",
                        "before": before,
                        "delta_minutes": after - before,
                        "after": after,
                        "player_time_before": deepcopy(before_player),
                        "player_time_after": deepcopy(after_player),
                        "source_decision_id": decision_id,
                    })
        elif tool == "state.time_appearance":
            previous_time = (
                data.get("previous_time")
                if isinstance(data.get("previous_time"), dict) else {}
            )
            current_time = (
                data.get("current_time")
                if isinstance(data.get("current_time"), dict) else {}
            )
            before_projection = previous_time.get("player_time")
            after_projection = current_time.get("player_time")
            if before_projection != after_projection:
                _add_effect(effects, {
                    "schema_version": 1,
                    "category": "state_delta",
                    "effect_id": _stable_effect_id(
                        decision_id, "time_appearance", "player_time"
                    ),
                    "effect_kind": "time_appearance",
                    "player_time_before": deepcopy(before_projection),
                    "player_time_after": deepcopy(after_projection),
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
        elif tool == "rules.resource_delta":
            result = data.get("result") if isinstance(data.get("result"), dict) else {}
            resource_key = str(result.get("resource") or "").strip()
            if (
                data.get("ruleset_id") == (ruleset_id or coc_rulesets.DEFAULT_RULESET_ID)
                and data.get("state_bound") is True
                and bool(investigator_id)
                and resource_key in resource_display
            ):
                effect = _scalar_effect(
                    decision_id,
                    resource_display[resource_key],
                    result.get("before"),
                    result.get("after"),
                    investigator_id=investigator_id,
                )
                if effect:
                    effect["ruleset_id"] = str(data["ruleset_id"])
                    effect["resource_key"] = resource_key
                    effect["source_receipt_id"] = data.get("receipt_id")
                    _add_effect(effects, effect)
        _project_player_state_receipt(
            effects,
            decision_id,
            data.get("player_state_receipt"),
            resource_projection_order=resource_projection_order,
        )
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
        if action not in {"apply", "consume", "resolve"} or not coc_exceptional_effects.valid_effect(effect):
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


def _render_public_roll(
    raw: dict[str, Any], *, play_language: str | None = None
) -> str:
    language = play_language or coc_language.DEFAULT_PLAY_LANGUAGE
    chrome = coc_language.table_mechanics_labels(language)
    tag = chrome.get("public_check_tag", "Public roll")
    explicit_skill = (
        raw.get("display_skill")
        or raw.get("skill")
        or raw.get("characteristic")
    )
    if explicit_skill:
        skill = str(explicit_skill)
    elif str(raw.get("kind") or "").casefold() == "dice":
        # ``kind`` is a machine enum, not table prose.  Falling through to
        # raw["kind"] leaked the literal English word ``dice`` at zh/ja tables.
        skill = str(chrome.get("die_fallback", "Die"))
    else:
        # Amount kinds such as ``hp_damage`` are machine enums too.  Render a
        # play-language label when known, and a neutral check/die fallback for
        # unknown enums; never put an internal identifier on the table.
        kind = str(raw.get("kind") or "").casefold()
        localized_kind = chrome.get(f"roll_kind_{kind}")
        if localized_kind:
            skill = str(localized_kind)
        elif _roll_kind(raw) == "amount":
            skill = str(chrome.get("die_fallback", "Die"))
        else:
            skill = str(chrome.get("check_fallback", "Check"))
    if _roll_kind(raw) == "check" and all(
        key in raw for key in (
            "roll", "base_target", "required_level", "required_target",
            "achieved_level", "passed", "surplus_levels", "outcome",
        )
    ):
        detail = coc_roll.format_percentile_result(
            raw, language=language, compact=True
        )
        if all(_exact_int(raw.get(key)) for key in ("original_roll", "luck_spent", "adjusted_roll")):
            # Rewrite luck-spend clause in the active play language.
            if language == "zh-Hans" or language.startswith("zh"):
                detail = detail.replace(
                    f"掷骰：{raw['adjusted_roll']}；",
                    (
                        f"原始：{raw['original_roll']}；幸运 -{raw['luck_spent']}；"
                        f"调整：{raw['adjusted_roll']}；"
                    ),
                    1,
                )
            else:
                detail = detail.replace(
                    f"roll: {raw['adjusted_roll']};",
                    (
                        f"raw: {raw['original_roll']}; luck -{raw['luck_spent']}; "
                        f"adjusted: {raw['adjusted_roll']};"
                    ),
                    1,
                )
        if raw.get("kind") == "npc_first_impression":
            governing = (
                chrome.get("credit_rating", "Credit Rating")
                if raw.get("governing_attribute") == "credit_rating"
                else chrome.get("app", "APP")
            )
            fi = chrome.get("first_impression_tag", "First impression")
            person = raw.get("npc_display_name") or chrome.get("this_person", "this person")
            app_l = chrome.get("app", "APP")
            cr_l = chrome.get("credit_rating", "Credit Rating")
            using = chrome.get("using", "using")
            return (
                f"【{tag}】{fi}·{person}｜"
                f"{app_l} {raw.get('app')} / {cr_l} {raw.get('credit_rating')}；"
                f"{using}{governing} {raw.get('governing_value')}｜{detail}"
            )
        return f"【{tag}】{skill}｜{detail}"
    dice = raw.get("dice") if isinstance(raw.get("dice"), dict) else {}
    expression = str(
        dice.get("expression")
        or raw.get("die_expression")
        or raw.get("expression")
        or raw.get("die")
        or chrome.get("die_fallback", "Die")
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
        # empty "faces — →" placeholder when component faces were not stored.
        face_text = str(total)
    else:
        face_text = "—"
    faces_l = chrome.get("die_faces", "faces")
    total_l = chrome.get("total", "total")
    rendered = f"【{tag}】{skill}（{expression}）：{faces_l} {face_text} → {total_l} {total}"
    damage_receipt = raw.get("combat_damage_receipt")
    if isinstance(damage_receipt, dict):
        raw_damage = damage_receipt.get("raw_damage")
        rolled_total = damage_receipt.get("rolled_total")
        if (
            _exact_int(raw_damage)
            and _exact_int(rolled_total)
            and raw_damage != rolled_total
        ):
            if language == "zh-Hans" or language.startswith("zh"):
                rendered += f"；极难穿刺结算：{raw_damage} 点伤害"
            else:
                rendered += f"; extreme impale settlement: {raw_damage} damage"
    return rendered


def _render_state_delta(
    effect: dict[str, Any], *, play_language: str | None = None
) -> str:
    language = play_language or coc_language.DEFAULT_PLAY_LANGUAGE
    chrome = coc_language.table_mechanics_labels(language)
    tag = chrome.get("change_tag", "Change")
    kind = effect["effect_kind"]
    if kind == "scalar":
        resource = effect["resource"]
        try:
            default_display = _resource_display_map()
        except ValueError:
            # A relocated/test registry may intentionally contain no coc7
            # package. Scalar rendering must remain package-neutral.
            default_display = {}
        if resource == default_display.get("luck"):
            resource = chrome.get("luck", resource)
        return f"【{tag}】{resource}：{effect['before']} → {effect['after']}（{effect['delta']:+d}）"
    if kind in {"time", "time_appearance"}:
        phase_l = chrome.get("time_phase", "time of day")
        label = coc_language.player_time_label(
            effect.get("player_time_after"), language,
        )
        return f"【{tag}】{phase_l}：{label}"
    if kind == "rest":
        if language == "zh-Hans" or language.startswith("zh"):
            reset = "；理智日计数已重置" if effect.get("sanity_day_reset") else ""
            return f"【{tag}】休息：完成安全的整夜睡眠{reset}"
        reset = (
            f"; {_resource_display_map().get('san', 'SAN')} day counter reset"
            if effect.get("sanity_day_reset") else ""
        )
        return f"【{tag}】rest: completed a safe full sleep{reset}"
    if kind == "item":
        if language == "zh-Hans" or language.startswith("zh"):
            action = "获得" if effect["action"] == "acquired" else "失去"
            return f"【{tag}】物品：{action}「{effect['label']}」"
        action = "gained" if effect["action"] == "acquired" else "lost"
        return f"【{tag}】item: {action} “{effect['label']}”"
    if kind == "condition":
        if language == "zh-Hans" or language.startswith("zh"):
            action = "新增" if effect["action"] == "added" else "解除"
            return f"【{tag}】状态：{action}「{effect['condition']}」"
        action = "added" if effect["action"] == "added" else "cleared"
        return f"【{tag}】condition: {action} “{effect['condition']}”"
    if kind == "loaded_ammunition":
        delta = effect["change"]
        if language == "zh-Hans" or language.startswith("zh"):
            action = f"装填 {delta} 发" if delta > 0 else f"消耗 {-delta} 发"
            return (
                f"【{tag}】当前弹匣·{effect['weapon_label']}：{effect['before']} → "
                f"{effect['after']}（{action}；不含未建账的备用弹药）"
            )
        action = f"load {delta}" if delta > 0 else f"expend {-delta}"
        return (
            f"【{tag}】magazine·{effect['weapon_label']}: {effect['before']} → "
            f"{effect['after']} ({action}; excludes untracked spare ammo)"
        )
    raise TurnContractError("state_corrupt", f"unknown player state delta kind: {kind}")


def _render_exceptional_effect(
    effect: dict[str, Any], *, play_language: str | None = None
) -> str:
    language = play_language or coc_language.DEFAULT_PLAY_LANGUAGE
    chrome = coc_language.table_mechanics_labels(language)
    zh = language == "zh-Hans" or language.startswith("zh")
    if zh:
        kind_labels = {
            "bonus_die": "奖励骰",
            "penalty_die": "惩罚骰",
            "condition": "状态",
            "restriction": "限制",
            "relationship_or_clock": "关系/时钟",
            "scene_event": "场景事件",
            "resource_delta": "资源",
        }
    else:
        kind_labels = {
            "bonus_die": "bonus die",
            "penalty_die": "penalty die",
            "condition": "condition",
            "restriction": "restriction",
            "relationship_or_clock": "relationship/clock",
            "scene_event": "scene event",
            "resource_delta": "resource",
        }
    boundary = effect["boundary"]
    boundary_kind = boundary["kind"]
    if zh:
        if boundary_kind == "immediate":
            boundary_text = "立即生效"
        elif boundary_kind == "until_consumed":
            boundary_text = "下一次符合范围的检定（一次）"
        elif boundary_kind == "until_scene_end":
            boundary_text = "持续至本场景结束"
        elif boundary_kind == "until_time_marker":
            boundary_text = "持续至约定时限"
        else:
            boundary_text = f"持续至：{boundary['description']}"
        if effect.get("status") == "consumed":
            status = "；已用于本次检定"
        elif effect.get("status") == "resolved":
            status = "；解除条件已满足"
        else:
            status = ""
        direction = "收益" if effect["direction"] == "benefit" else "代价"
        relationship_reward = bool(
            effect["direction"] == "benefit"
            and effect["effect_kind"] == "bonus_die"
            and (effect.get("mechanics") or {}).get("target_id")
        )
        heading = "关系/印象奖励" if relationship_reward else chrome.get(
            "exceptional_tag", "特殊影响"
        )
        target = (
            f"｜适用对象：{effect['mechanics']['target_display_name']}"
            if relationship_reward else ""
        )
        return (
            f"【{heading}】{direction}·{kind_labels[effect['effect_kind']]}："
            f"{effect['player_visible_impact']}｜"
            f"{chrome.get('cause', '因果')}：{effect['causal_link']}｜"
            f"边界：{boundary_text}{target}{status}"
        )
    if boundary_kind == "immediate":
        boundary_text = "immediate"
    elif boundary_kind == "until_consumed":
        boundary_text = "until next matching check (once)"
    elif boundary_kind == "until_scene_end":
        boundary_text = "until the current scene ends"
    elif boundary_kind == "until_time_marker":
        boundary_text = "until the recorded time limit"
    else:
        boundary_text = f"until: {boundary['description']}"
    if effect.get("status") == "consumed":
        status = "; consumed this check"
    elif effect.get("status") == "resolved":
        status = "; end condition met"
    else:
        status = ""
    direction = "benefit" if effect["direction"] == "benefit" else "cost"
    relationship_reward = bool(
        effect["direction"] == "benefit"
        and effect["effect_kind"] == "bonus_die"
        and (effect.get("mechanics") or {}).get("target_id")
    )
    heading = (
        "Relationship/impression reward"
        if relationship_reward
        else chrome.get("exceptional_tag", "Exceptional")
    )
    target = (
        f"| applies to: {effect['mechanics']['target_display_name']}"
        if relationship_reward else ""
    )
    return (
        f"【{heading}】{direction}·{kind_labels[effect['effect_kind']]}: "
        f"{effect['player_visible_impact']}|{chrome.get('cause', 'cause')}: "
        f"{effect['causal_link']}|boundary: {boundary_text}{target}{status}"
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
    ruleset_id = _campaign_ruleset_id(campaign_dir)
    try:
        manifest, window, journal = coc_turn_manifest.refresh_pending_window(
            campaign_dir
        )
    except coc_turn_manifest.TurnManifestError as exc:
        raise TurnContractError(exc.code, str(exc)) from exc
    finalizations = load_finalizations(campaign_dir)
    start = int(manifest["source_start_index"])
    end = int(manifest["journal_call_index"])
    rolls = _source_rolls(campaign_dir, window, finalizations)
    _attach_structured_skill_labels(campaign_dir, rolls)
    public_rolls = [raw for raw in rolls if is_player_facing_roll(raw)]
    state_deltas = _project_state_deltas(
        window,
        superseded_roll_ids=_superseded_roll_ids(campaign_dir),
        ruleset_id=ruleset_id,
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
        "exceptional_effect": exceptional_events,
        "concealed_consequence": concealed,
    }
    source_digest = str(manifest["source_digest"])
    return {
        "schema_version": 1,
        "turn_id": manifest["turn_id"],
        "manifest_revision": manifest["revision"],
        "repair_call_count": manifest["repair_call_count"],
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
        # Keeper-only portrayal context. Keeping this outside mechanics_bundle
        # prevents turn.finalize from printing NPC interpretation, expectations,
        # reservations, or hidden limits as a player-facing rules block.
        "npc_performance_constraints": deepcopy(context_effects),
        "candidate_factors": candidate_factors,
        "missing_substantive_effects": missing_effects,
        "pending_modifier_consumptions": pending_modifiers,
        "composition_mode": "causal_paragraph_placements",
        "placement_segment_types": sorted(MECHANIC_SEGMENT_TYPES),
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


def _draft_paragraphs(draft: str) -> list[str]:
    paragraphs = draft.split("\n\n")
    if not paragraphs or any(not paragraph.strip() for paragraph in paragraphs):
        raise TurnContractError(
            "invalid_draft",
            "draft must contain non-empty paragraphs separated by one blank line",
        )
    return paragraphs


def _mechanic_source_lines(
    bundle: dict[str, Any], *, play_language: str | None = None
) -> dict[str, dict[str, str]]:
    language = play_language or coc_language.DEFAULT_PLAY_LANGUAGE
    sources: dict[str, dict[str, str]] = {
        segment_type: {} for segment_type in MECHANIC_SEGMENT_TYPES
    }
    for raw in bundle.get("public_check") or []:
        sources["public_check"][str(raw["roll_id"])] = _render_public_roll(
            raw, play_language=language
        )
    for effect in bundle.get("state_delta") or []:
        sources["state_delta"][str(effect["effect_id"])] = _render_state_delta(
            effect, play_language=language
        )
    for effect in bundle.get("exceptional_effect") or []:
        sources["exceptional_effect"][str(effect["event_id"])] = (
            _render_exceptional_effect(effect, play_language=language)
        )
    return sources


def _reject_mechanics_in_draft(
    draft: str,
    sources: dict[str, dict[str, str]],
) -> None:
    """Keep deterministic public blocks out of Keeper-authored fiction.

    The structured labels are part of the finalizer wire format, not prose
    semantics.  Rejecting them here prevents an otherwise valid placement
    from rendering the same authoritative roll or state delta twice.
    """
    for rows in sources.values():
        for rendered in rows.values():
            label = None
            if rendered.startswith("【") and "】" in rendered:
                label = rendered.split("】", 1)[0] + "】"
            if rendered in draft or (label is not None and label in draft):
                raise TurnContractError(
                    "mechanics_text_in_draft",
                    "draft contains a deterministic public mechanics block; "
                    "remove it and let mechanics_placements render the source exactly once",
                )


def _normalize_mechanics_placements(
    placements: Any,
    *,
    paragraph_count: int,
    sources: dict[str, dict[str, str]],
) -> list[dict[str, Any]]:
    if not isinstance(placements, list):
        raise TurnContractError("invalid_param", "mechanics_placements must be an array")
    normalized: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    previous_paragraph = -1
    for index, row in enumerate(placements):
        if not isinstance(row, dict) or set(row) != MECHANICS_PLACEMENT_FIELDS:
            raise TurnContractError(
                "invalid_mechanics_placement",
                f"mechanics_placements[{index}] has an invalid shape",
            )
        after = row.get("after_paragraph")
        segment_type = row.get("segment_type")
        source_ids = row.get("source_ids")
        if (
            isinstance(after, bool) or not isinstance(after, int)
            or after < 0 or after >= paragraph_count
        ):
            raise TurnContractError(
                "invalid_mechanics_placement",
                f"mechanics_placements[{index}].after_paragraph is out of range",
            )
        if after < previous_paragraph:
            raise TurnContractError(
                "invalid_mechanics_placement",
                "mechanics_placements must be ordered by after_paragraph",
            )
        if segment_type not in MECHANIC_SEGMENT_TYPES:
            raise TurnContractError(
                "invalid_mechanics_placement",
                f"mechanics_placements[{index}].segment_type is invalid",
            )
        if (
            not isinstance(source_ids, list) or not source_ids
            or not all(isinstance(value, str) and value for value in source_ids)
            or len(source_ids) != len(set(source_ids))
        ):
            raise TurnContractError(
                "invalid_mechanics_placement",
                f"mechanics_placements[{index}].source_ids is invalid",
            )
        for source_id in source_ids:
            identity = (str(segment_type), source_id)
            if source_id not in sources[str(segment_type)]:
                raise TurnContractError(
                    "unknown_mechanics_source",
                    f"{segment_type}:{source_id} is not in this turn's mechanics bundle",
                )
            if identity in seen:
                raise TurnContractError(
                    "duplicate_mechanics_source",
                    f"{segment_type}:{source_id} is placed more than once",
                )
            seen.add(identity)
        normalized.append({
            "after_paragraph": after,
            "segment_type": str(segment_type),
            "source_ids": list(source_ids),
        })
        previous_paragraph = after
    expected = {
        (segment_type, source_id)
        for segment_type, rows in sources.items()
        for source_id in rows
    }
    missing = sorted(expected - seen)
    extra = sorted(seen - expected)
    if missing or extra:
        detail = []
        if missing:
            detail.append("missing=" + ",".join(f"{kind}:{source}" for kind, source in missing))
        if extra:
            detail.append("extra=" + ",".join(f"{kind}:{source}" for kind, source in extra))
        raise TurnContractError(
            "incomplete_mechanics_placement",
            "every public mechanic must be placed exactly once (" + "; ".join(detail) + ")",
        )
    return normalized


def _default_mechanics_placements(
    *,
    paragraphs: list[str],
    sources: dict[str, dict[str, str]],
    coverage: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Derive a safe causal layout without making a narrative decision.

    Public checks are inserted immediately before the first paragraph that
    contains their already-KP-authored causal excerpt.  Other authoritative
    changes are grouped after the final fictional paragraph.  If a public
    result begins in paragraph zero there is no representable safe boundary,
    so the Keeper must provide an explicit placement instead of the runtime
    guessing or rewriting prose.
    """
    coverage_by_id = {row["obligation_id"]: row for row in coverage}
    grouped: dict[tuple[int, str], list[str]] = {}
    for source_id in sources["public_check"]:
        row = coverage_by_id.get(f"roll:{source_id}")
        excerpt = str((row or {}).get("exact_excerpt") or "")
        result_indices = [
            index
            for index, paragraph in enumerate(paragraphs)
            if excerpt and excerpt in paragraph
        ]
        if not result_indices or result_indices[0] == 0:
            raise TurnContractError(
                "default_mechanics_placement_unavailable",
                f"public roll {source_id} has no safe preceding paragraph; "
                "provide mechanics_placements explicitly or split setup and result prose",
            )
        grouped.setdefault(
            (result_indices[0] - 1, "public_check"), []
        ).append(source_id)
    final_paragraph = len(paragraphs) - 1
    for segment_type in ("state_delta", "exceptional_effect"):
        source_ids = list(sources[segment_type])
        if source_ids:
            grouped[(final_paragraph, segment_type)] = source_ids
    segment_order = {
        "public_check": 0,
        "state_delta": 1,
        "exceptional_effect": 2,
    }
    return [
        {
            "after_paragraph": after,
            "segment_type": segment_type,
            "source_ids": source_ids,
        }
        for (after, segment_type), source_ids in sorted(
            grouped.items(),
            key=lambda item: (item[0][0], segment_order[item[0][1]]),
        )
    ]


def _placements_from_segments(receipt: dict[str, Any]) -> list[dict[str, Any]]:
    """Recover immutable placement intent for an idempotent replay."""
    placements: list[dict[str, Any]] = []
    paragraph_index = -1
    for segment in receipt.get("segments") or []:
        if not isinstance(segment, dict):
            continue
        segment_type = segment.get("segment_type")
        if segment_type == "fiction":
            paragraph_index += 1
        elif segment_type in MECHANIC_SEGMENT_TYPES:
            placements.append({
                "after_paragraph": paragraph_index,
                "segment_type": segment_type,
                "source_ids": list(segment.get("source_ids") or []),
            })
    return placements


def _validate_roll_result_placement(
    *,
    paragraphs: list[str],
    placements: list[dict[str, Any]],
    coverage: list[dict[str, Any]],
) -> None:
    roll_after: dict[str, int] = {}
    for row in placements:
        if row["segment_type"] == "public_check":
            for source_id in row["source_ids"]:
                roll_after[source_id] = row["after_paragraph"]
    coverage_by_id = {row["obligation_id"]: row for row in coverage}
    for roll_id, after in roll_after.items():
        if after >= len(paragraphs) - 1:
            raise TurnContractError(
                "roll_after_consequence",
                f"public roll {roll_id} must be followed by a fictional result paragraph",
            )
        row = coverage_by_id.get(f"roll:{roll_id}")
        if row is None or row.get("realization") == "concealed_no_player_visible_beat":
            continue
        excerpt = str(row.get("exact_excerpt") or "")
        result_paragraphs = [
            index for index, paragraph in enumerate(paragraphs)
            if excerpt and excerpt in paragraph
        ]
        if not any(index > after for index in result_paragraphs):
            raise TurnContractError(
                "roll_after_consequence",
                f"public roll {roll_id} must appear before its coverage exact_excerpt",
            )


# --------------------------------------------------------------------------- #
# Collect-all validation diagnostics
#
# The raising helpers above stay the single source of truth for the clean
# path.  The collect variants below mirror them check-for-check and in the
# same order, appending one violation per failure instead of raising the
# first, so a Keeper submission sees every problem in one round trip.
# --------------------------------------------------------------------------- #


def _collect_coverage_violations(
    obligations: list[dict[str, Any]], coverage: Any, draft: str
) -> tuple[list[dict[str, str]], list[dict[str, Any]]]:
    violations: list[dict[str, str]] = []

    def add(code: str, message: str) -> None:
        violations.append({"stage": "coverage", "code": code, "message": message})

    best_rows: list[dict[str, Any]] = []
    if not isinstance(coverage, list):
        add("invalid_coverage", "coverage must be an array")
        return violations, best_rows
    required = {str(row["obligation_id"]): row for row in obligations}
    seen: dict[str, dict[str, Any]] = {}
    for index, row in enumerate(coverage):
        if not isinstance(row, dict) or set(row) != COVERAGE_FIELDS:
            add("invalid_coverage", f"coverage[{index}] must use the exact closed schema")
            continue
        obligation_id = str(row.get("obligation_id") or "").strip()
        if not obligation_id or obligation_id in seen:
            add("duplicate_obligation", f"duplicate coverage: {obligation_id}")
            continue
        if obligation_id not in required:
            add("unknown_obligation", f"unknown coverage: {obligation_id}")
            continue
        realization = row.get("realization")
        if realization not in REALIZATION_VALUES:
            add("invalid_coverage", f"invalid realization for {obligation_id}")
        handling = row.get("player_input_handling")
        if handling not in PLAYER_INPUT_HANDLING_VALUES:
            add("invalid_coverage", f"invalid player_input_handling for {obligation_id}")
        if realization == "concealed_no_player_visible_beat":
            if required[obligation_id]["source_kind"] != "concealed_roll":
                add(
                    "invalid_coverage",
                    "only a concealed roll may close without a visible beat",
                )
            for key in (
                "action_realization", "response", "causal_explanation",
                "persona_fit", "exact_excerpt", "exceptional_beat",
            ):
                if row.get(key) not in (None, ""):
                    add(
                        "invalid_coverage",
                        f"{obligation_id} hidden no-effect row must not cite player prose",
                    )
                    break
        else:
            for key in (
                "action_realization", "response", "causal_explanation",
                "persona_fit", "exact_excerpt",
            ):
                value = row.get(key)
                if not isinstance(value, str) or not value.strip():
                    add("invalid_coverage", f"{obligation_id} lacks non-empty {key}")
            excerpt = row.get("exact_excerpt")
            if (
                isinstance(excerpt, str) and excerpt.strip()
                and excerpt not in draft
            ):
                add(
                    "excerpt_mismatch",
                    f"{obligation_id} exact_excerpt is not verbatim in draft",
                )
        if required[obligation_id].get("exceptional_required"):
            beat = row.get("exceptional_beat")
            if not isinstance(beat, str) or not beat.strip():
                add("exceptional_beat_required", f"{obligation_id} is critical/fumble")
        seen[obligation_id] = deepcopy(row)
        best_rows.append(deepcopy(row))
    missing = sorted(set(required) - set(seen))
    if missing:
        add("missing_obligation", "missing causal coverage: " + ", ".join(missing))
    return violations, best_rows


def _collect_mechanics_in_draft(
    draft: str, sources: dict[str, dict[str, str]]
) -> list[dict[str, str]]:
    violations: list[dict[str, str]] = []
    seen_labels: set[str] = set()
    for rows in sources.values():
        for rendered in rows.values():
            label = None
            if rendered.startswith("【") and "】" in rendered:
                label = rendered.split("】", 1)[0] + "】"
            if rendered in draft or (label is not None and label in draft):
                marker = label or rendered[:40]
                if marker in seen_labels:
                    continue
                seen_labels.add(marker)
                violations.append({
                    "stage": "mechanics_in_draft",
                    "code": "mechanics_text_in_draft",
                    "message": (
                        f"draft contains a deterministic public mechanics block ({marker}); "
                        "remove it and let mechanics_placements render the source exactly once"
                    ),
                })
    return violations


def _collect_default_placements(
    *,
    paragraphs: list[str],
    sources: dict[str, dict[str, str]],
    coverage: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    violations: list[dict[str, str]] = []
    coverage_by_id = {row["obligation_id"]: row for row in coverage}
    grouped: dict[tuple[int, str], list[str]] = {}
    for source_id in sources["public_check"]:
        row = coverage_by_id.get(f"roll:{source_id}")
        excerpt = str((row or {}).get("exact_excerpt") or "")
        result_indices = [
            index
            for index, paragraph in enumerate(paragraphs)
            if excerpt and excerpt in paragraph
        ]
        if not result_indices or result_indices[0] == 0:
            violations.append({
                "stage": "mechanics_placements",
                "code": "default_mechanics_placement_unavailable",
                "message": (
                    f"public roll {source_id} has no safe preceding paragraph; "
                    "provide mechanics_placements explicitly or split setup and result prose"
                ),
            })
            continue
        grouped.setdefault(
            (result_indices[0] - 1, "public_check"), []
        ).append(source_id)
    final_paragraph = len(paragraphs) - 1
    for segment_type in ("state_delta", "exceptional_effect"):
        source_ids = list(sources[segment_type])
        if source_ids:
            grouped[(final_paragraph, segment_type)] = source_ids
    segment_order = {
        "public_check": 0,
        "state_delta": 1,
        "exceptional_effect": 2,
    }
    requested = [
        {
            "after_paragraph": after,
            "segment_type": segment_type,
            "source_ids": source_ids,
        }
        for (after, segment_type), source_ids in sorted(
            grouped.items(),
            key=lambda item: (item[0][0], segment_order[item[0][1]]),
        )
    ]
    return requested, violations


def _collect_placements_violations(
    placements: Any,
    *,
    paragraph_count: int,
    sources: dict[str, dict[str, str]],
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    violations: list[dict[str, str]] = []

    def add(code: str, message: str) -> None:
        violations.append({"stage": "mechanics_placements", "code": code, "message": message})

    normalized: list[dict[str, Any]] = []
    if not isinstance(placements, list):
        add("invalid_param", "mechanics_placements must be an array")
        return normalized, violations
    seen: set[tuple[str, str]] = set()
    previous_paragraph = -1
    for index, row in enumerate(placements):
        if not isinstance(row, dict) or set(row) != MECHANICS_PLACEMENT_FIELDS:
            add(
                "invalid_mechanics_placement",
                f"mechanics_placements[{index}] has an invalid shape",
            )
            continue
        after = row.get("after_paragraph")
        segment_type = row.get("segment_type")
        source_ids = row.get("source_ids")
        row_usable = True
        if (
            isinstance(after, bool) or not isinstance(after, int)
            or after < 0 or after >= paragraph_count
        ):
            add(
                "invalid_mechanics_placement",
                f"mechanics_placements[{index}].after_paragraph is out of range",
            )
            row_usable = False
        elif after < previous_paragraph:
            add(
                "invalid_mechanics_placement",
                "mechanics_placements must be ordered by after_paragraph",
            )
            row_usable = False
        if segment_type not in MECHANIC_SEGMENT_TYPES:
            add(
                "invalid_mechanics_placement",
                f"mechanics_placements[{index}].segment_type is invalid",
            )
            row_usable = False
        if (
            not isinstance(source_ids, list) or not source_ids
            or not all(isinstance(value, str) and value for value in source_ids)
            or len(source_ids) != len(set(source_ids))
        ):
            add(
                "invalid_mechanics_placement",
                f"mechanics_placements[{index}].source_ids is invalid",
            )
            row_usable = False
        if not row_usable:
            continue
        keep_ids: list[str] = []
        for source_id in source_ids:
            identity = (str(segment_type), source_id)
            if source_id not in sources[str(segment_type)]:
                add(
                    "unknown_mechanics_source",
                    f"{segment_type}:{source_id} is not in this turn's mechanics bundle",
                )
                continue
            if identity in seen:
                add(
                    "duplicate_mechanics_source",
                    f"{segment_type}:{source_id} is placed more than once",
                )
                continue
            seen.add(identity)
            keep_ids.append(source_id)
        normalized.append({
            "after_paragraph": after,
            "segment_type": str(segment_type),
            "source_ids": keep_ids,
        })
        previous_paragraph = after
    expected = {
        (segment_type, source_id)
        for segment_type, rows in sources.items()
        for source_id in rows
    }
    missing = sorted(expected - seen)
    extra = sorted(seen - expected)
    if missing or extra:
        detail = []
        if missing:
            detail.append("missing=" + ",".join(f"{kind}:{source}" for kind, source in missing))
        if extra:
            detail.append("extra=" + ",".join(f"{kind}:{source}" for kind, source in extra))
        add(
            "incomplete_mechanics_placement",
            "every public mechanic must be placed exactly once (" + "; ".join(detail) + ")",
        )
    return normalized, violations


def _collect_roll_after_violations(
    *,
    paragraphs: list[str],
    placements: list[dict[str, Any]],
    coverage: list[dict[str, Any]],
) -> list[dict[str, str]]:
    violations: list[dict[str, str]] = []
    roll_after: dict[str, int] = {}
    for row in placements:
        if row["segment_type"] == "public_check":
            for source_id in row["source_ids"]:
                roll_after[source_id] = row["after_paragraph"]
    coverage_by_id = {row["obligation_id"]: row for row in coverage}
    for roll_id, after in roll_after.items():
        if after >= len(paragraphs) - 1:
            violations.append({
                "stage": "roll_after_consequence",
                "code": "roll_after_consequence",
                "message": f"public roll {roll_id} must be followed by a fictional result paragraph",
            })
            continue
        row = coverage_by_id.get(f"roll:{roll_id}")
        if row is None or row.get("realization") == "concealed_no_player_visible_beat":
            continue
        excerpt = str(row.get("exact_excerpt") or "")
        result_paragraphs = [
            index for index, paragraph in enumerate(paragraphs)
            if excerpt and excerpt in paragraph
        ]
        if not result_paragraphs:
            # An excerpt missing from the draft is already reported in the
            # coverage stage; skip the derived placement-order noise here.
            continue
        if not any(index > after for index in result_paragraphs):
            violations.append({
                "stage": "roll_after_consequence",
                "code": "roll_after_consequence",
                "message": f"public roll {roll_id} must appear before its coverage exact_excerpt",
            })
    return violations


def collect_finalize_violations(
    campaign_dir: Path,
    *,
    draft: Any,
    coverage: Any,
    mechanics_placements: Any,
) -> list[dict[str, str]]:
    """Best-effort diagnostic sweep of every finalize validation stage.

    Returns every violation in the same order the raising helpers would have
    reported them one at a time.  An empty list means a real
    ``build_finalization_receipt`` call with the same inputs succeeds.
    Never writes state.
    """
    violations: list[dict[str, str]] = []
    if not isinstance(draft, str) or not draft.strip():
        return [{
            "stage": "params",
            "code": "invalid_param",
            "message": "draft must be non-empty",
        }]
    try:
        context = build_output_context(campaign_dir)
    except TurnContractError as exc:
        return [{"stage": "output_context", "code": exc.code, "message": str(exc)}]
    if context["missing_substantive_effects"]:
        missing = ", ".join(
            row["obligation_id"] for row in context["missing_substantive_effects"]
        )
        violations.append({
            "stage": "substantive_effects",
            "code": "substantive_exceptional_effect_required",
            "message": (
                "critical/fumble/pushed-failure outcome lacks a source-bound "
                f"applied effect: {missing}"
            ),
        })
    if context["pending_modifier_consumptions"]:
        pending = ", ".join(
            f"{row['effect_id']}->{row['roll_id']}"
            for row in context["pending_modifier_consumptions"]
        )
        violations.append({
            "stage": "substantive_effects",
            "code": "exceptional_modifier_unconsumed",
            "message": (
                "an applicable one-shot exceptional modifier was not "
                f"source-bound to its roll: {pending}"
            ),
        })
    coverage_violations, coverage_rows = _collect_coverage_violations(
        context["obligations"], coverage, draft
    )
    violations.extend(coverage_violations)
    paragraphs: list[str] | None = None
    try:
        paragraphs = _draft_paragraphs(draft)
    except TurnContractError as exc:
        violations.append({"stage": "draft", "code": exc.code, "message": str(exc)})
    play_language = _campaign_play_language(campaign_dir)
    bundle = context["mechanics_bundle"]
    sources = _mechanic_source_lines(bundle, play_language=play_language)
    violations.extend(_collect_mechanics_in_draft(draft, sources))
    normalized_placements: list[dict[str, Any]] = []
    if paragraphs is not None:
        requested = mechanics_placements
        if requested is None:
            requested, default_violations = _collect_default_placements(
                paragraphs=paragraphs,
                sources=sources,
                coverage=coverage_rows,
            )
            violations.extend(default_violations)
        normalized_placements, placement_violations = _collect_placements_violations(
            requested,
            paragraph_count=len(paragraphs),
            sources=sources,
        )
        violations.extend(placement_violations)
        violations.extend(_collect_roll_after_violations(
            paragraphs=paragraphs,
            placements=normalized_placements,
            coverage=coverage_rows,
        ))
    return violations


def compose_segments(
    draft: str,
    bundle: dict[str, Any],
    mechanics_placements: Any,
    *,
    coverage: list[dict[str, Any]] | None = None,
    play_language: str | None = None,
) -> tuple[list[dict[str, Any]], str, list[dict[str, Any]]]:
    paragraphs = _draft_paragraphs(draft)
    sources = _mechanic_source_lines(bundle, play_language=play_language)
    _reject_mechanics_in_draft(draft, sources)
    requested_placements = mechanics_placements
    if requested_placements is None:
        if coverage is None:
            raise TurnContractError(
                "invalid_param",
                "coverage is required when mechanics_placements is omitted",
            )
        requested_placements = _default_mechanics_placements(
            paragraphs=paragraphs,
            sources=sources,
            coverage=coverage,
        )
    placements = _normalize_mechanics_placements(
        requested_placements,
        paragraph_count=len(paragraphs),
        sources=sources,
    )
    by_paragraph: dict[int, list[dict[str, Any]]] = {}
    for placement in placements:
        by_paragraph.setdefault(placement["after_paragraph"], []).append(placement)
    segments: list[dict[str, Any]] = []
    for index, paragraph in enumerate(paragraphs):
        segments.append({
            "segment_type": "fiction",
            "text": paragraph,
            "source_ids": [],
        })
        for placement in by_paragraph.get(index, []):
            segment_type = placement["segment_type"]
            source_ids = placement["source_ids"]
            segments.append({
                "segment_type": segment_type,
                "text": "\n".join(sources[segment_type][source_id] for source_id in source_ids),
                "source_ids": list(source_ids),
            })
    rendered = "\n\n".join(segment["text"] for segment in segments)
    return segments, rendered, placements


def build_undelivered_repair_receipt(
    campaign_dir: Path,
    *,
    source_receipt: dict[str, Any],
    decision_id: str,
    draft: str,
    coverage: Any,
    mechanics_placements: Any,
) -> dict[str, Any]:
    """Recompose only the latest, still-undelivered finalized narration.

    Rules, state, journal identity, source window, obligations, coverage, and
    mechanics bundle are frozen.  The caller separately proves that delivery
    is still unconfirmed and atomically swaps the canonical tail while
    preserving the rejected receipt in an audit log.
    """
    if not isinstance(decision_id, str) or not decision_id.strip():
        raise TurnContractError("invalid_param", "decision_id must be non-empty")
    if not isinstance(draft, str) or not draft.strip():
        raise TurnContractError("invalid_param", "draft must be non-empty")
    if not _valid_finalization(source_receipt):
        raise TurnContractError(
            "state_corrupt", "repair source is not a valid current finalization receipt"
        )
    finalizations = load_finalizations(campaign_dir)
    if not finalizations or finalizations[-1] != source_receipt:
        raise TurnContractError(
            "repair_conflict", "only the latest canonical finalization may be repaired"
        )
    if not isinstance(coverage, list):
        raise TurnContractError("invalid_coverage", "coverage must be an array")
    if canonical_digest(coverage) != source_receipt["coverage_sha256"]:
        raise TurnContractError(
            "repair_scope_expanded",
            "undelivered narration repair must reuse the exact settled coverage",
        )
    repair_obligations = [
        {
            "obligation_id": row["obligation_id"],
            "source_kind": (
                "concealed_roll"
                if row.get("realization") == "concealed_no_player_visible_beat"
                else "repair"
            ),
            "exceptional_required": bool(row.get("exceptional_beat")),
        }
        for row in source_receipt["coverage"]
    ]
    normalized_coverage = validate_coverage(
        repair_obligations, coverage, draft
    )
    bundle = deepcopy(source_receipt["bundle"])
    play_language = _campaign_play_language(campaign_dir)
    segments, rendered, normalized_placements = compose_segments(
        draft,
        bundle,
        mechanics_placements,
        coverage=normalized_coverage,
        play_language=play_language,
    )
    _validate_roll_result_placement(
        paragraphs=_draft_paragraphs(draft),
        placements=normalized_placements,
        coverage=normalized_coverage,
    )
    finalization_id = _stable_effect_id(
        decision_id,
        "turn_finalization_repair",
        source_receipt["journal_decision_id"],
    )
    record = {
        "schema_version": FINALIZATION_SCHEMA_VERSION,
        "finalization_id": finalization_id,
        "decision_id": decision_id,
        "journal_decision_id": source_receipt["journal_decision_id"],
        "journal_call_index": source_receipt["journal_call_index"],
        "source_start_index": source_receipt["source_start_index"],
        "source_end_index": source_receipt["source_end_index"],
        "source_digest": source_receipt["source_digest"],
        "source_roll_ids": deepcopy(source_receipt["source_roll_ids"]),
        "obligation_ids": deepcopy(source_receipt["obligation_ids"]),
        "coverage_ids": deepcopy(source_receipt["coverage_ids"]),
        "draft_sha256": canonical_digest(draft),
        "coverage_sha256": canonical_digest(normalized_coverage),
        "bundle_sha256": canonical_digest(bundle),
        "rendered_sha256": canonical_digest(rendered),
        "bundle": bundle,
        "coverage": normalized_coverage,
        "segments": segments,
        "rendered_text": rendered,
    }
    record["integrity_digest"] = canonical_digest(record)
    if not _valid_finalization(record):
        raise TurnContractError(
            "state_corrupt", "generated undelivered repair receipt is invalid"
        )
    return record


def build_finalization_receipt(
    campaign_dir: Path,
    *,
    decision_id: str,
    draft: str,
    coverage: Any,
    mechanics_placements: Any,
) -> dict[str, Any]:
    if not isinstance(decision_id, str) or not decision_id.strip():
        raise TurnContractError("invalid_param", "decision_id must be non-empty")
    if not isinstance(draft, str) or not draft.strip():
        raise TurnContractError("invalid_param", "draft must be non-empty")
    violations = collect_finalize_violations(
        campaign_dir,
        draft=draft,
        coverage=coverage,
        mechanics_placements=mechanics_placements,
    )
    if violations:
        first = violations[0]
        raise TurnContractError(first["code"], first["message"], violations=violations)
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
    play_language = _campaign_play_language(campaign_dir)
    segments, rendered, normalized_placements = compose_segments(
        draft,
        bundle,
        mechanics_placements,
        coverage=normalized_coverage,
        play_language=play_language,
    )
    _validate_roll_result_placement(
        paragraphs=_draft_paragraphs(draft),
        placements=normalized_placements,
        coverage=normalized_coverage,
    )
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
    receipt: dict[str, Any], *, draft: Any, coverage: Any, mechanics_placements: Any
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
    try:
        play_language = _infer_play_language_from_rendered(
            str(receipt.get("rendered_text") or "")
        )
        _segments, rendered, _placements = compose_segments(
            draft,
            receipt.get("bundle") or {},
            (
                _placements_from_segments(receipt)
                if mechanics_placements is None
                else mechanics_placements
            ),
            coverage=normalized,
            play_language=play_language,
        )
    except TurnContractError:
        return False
    return (
        receipt.get("draft_sha256") == canonical_digest(draft)
        and receipt.get("coverage_sha256") == canonical_digest(normalized)
        and receipt.get("rendered_sha256") == canonical_digest(rendered)
    )


def append_finalization(campaign_dir: Path, receipt: dict[str, Any]) -> None:
    if not _valid_finalization(receipt):
        raise TurnContractError("state_corrupt", "refusing invalid turn finalization")
    path = Path(campaign_dir) / "logs" / FINALIZATION_FILENAME
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(receipt, ensure_ascii=False, sort_keys=True) + "\n")
