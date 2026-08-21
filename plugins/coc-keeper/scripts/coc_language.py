#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import re
from copy import deepcopy
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent


def _load_sibling(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_rulesets = _load_sibling("coc_rulesets_language", "coc_rulesets.py")

DEFAULT_PLAY_LANGUAGE = "zh-Hans"

# These machine-facing abbreviations are valid visible labels on their own,
# but ordinary prose may contain the same byte sequence inside a larger word.
# ASCII boundaries keep table-label localization exact without classifying prose.
# The term set is package-owned: it is read from the active ruleset manifest
# ``boundary_terms`` (docs/ruleset-contract.md §6), never from kernel literals.
BOUNDARY_SAFE_ASCII_TERMS = coc_rulesets.ruleset_boundary_terms(
    coc_rulesets.DEFAULT_RULESET_ID
)

_LANGUAGE_ALIASES = {
    "de": "german",
    "de-de": "german",
    "german": "german",
    "德语": "german",
    "it": "italian",
    "it-it": "italian",
    "italian": "italian",
    "意大利语": "italian",
    "la": "latin",
    "latin": "latin",
    "拉丁语": "latin",
    "en": "english",
    "en-us": "english",
    "en-gb": "english",
    "english": "english",
    "英语": "english",
    "fi": "finnish",
    "finnish": "finnish",
    "芬兰语": "finnish",
    "sv": "swedish",
    "swedish": "swedish",
    "瑞典语": "swedish",
}

_LANGUAGE_DISPLAY_NAMES = {
    "zh-Hans": {
        "english": "英语",
        "finnish": "芬兰语",
        "german": "德语",
        "italian": "意大利语",
        "latin": "拉丁语",
        "swedish": "瑞典语",
    },
    "ja-JP": {
        "english": "英語",
        "finnish": "フィンランド語",
        "german": "ドイツ語",
        "italian": "イタリア語",
        "latin": "ラテン語",
        "swedish": "スウェーデン語",
    },
}


def _normalize_language_name(value: Any) -> str:
    text = str(value or "").strip().lower()
    return _LANGUAGE_ALIASES.get(text, text)


def _language_name_from_skill_key(skill_key: str) -> tuple[str | None, bool]:
    key = str(skill_key or "").strip()
    if not key:
        return None, False

    prefixes = (
        ("Language (Own:", True),
        ("Language (Other:", False),
        ("Other Language (", False),
    )
    for prefix, is_own in prefixes:
        if key.startswith(prefix) and key.endswith(")"):
            return key[len(prefix):-1].strip(), is_own

    if key.startswith("Language (") and key.endswith(")"):
        body = key[len("Language ("):-1].strip()
        if body == "Own":
            return None, True
        if body == "Other":
            return None, False
        return body, False

    return None, False


def language_skill_for_source(
    investigator: dict[str, Any] | None,
    source_language: str | None,
) -> dict[str, Any]:
    """Read an investigator's structured language skill for a source language."""
    target = _normalize_language_name(source_language)
    skills = (investigator or {}).get("skills") or {}
    best = {
        "source_language": source_language,
        "skill_key": None,
        "skill_value": 0,
        "native": False,
    }
    if not target:
        return best

    for skill_key, raw_value in skills.items():
        language_name, is_own = _language_name_from_skill_key(skill_key)
        if _normalize_language_name(language_name) != target:
            continue
        try:
            value = int(raw_value or 0)
        except (TypeError, ValueError):
            value = 0
        if value >= int(best["skill_value"]):
            best = {
                "source_language": source_language,
                "skill_key": skill_key,
                "skill_value": value,
                "native": bool(is_own and value > 0),
            }
    return best


# Rulebook Other Language bands (full.md 3145-3155): identify / simple ideas /
# transactional / fluent / native-passing. 0-4 cannot identify by language skill.
LANGUAGE_ABILITY_THRESHOLDS = {
    "identify": 5,
    "simple_ideas": 10,
    "transactional": 30,
    "fluent": 50,
    "native_passing": 75,
}

LANGUAGE_ABILITY_BANDS = (
    "unrecognized",
    "identify",
    "simple_ideas",
    "transactional",
    "fluent",
    "native_passing",
)

_LANGUAGE_BAND_BY_THRESHOLD = tuple(
    reversed(tuple(LANGUAGE_ABILITY_THRESHOLDS.items()))
)

LANGUAGE_RECOGNITION_ROUTES = frozenset({
    "language_skill",
    "know",
    "archaeology",
    "history",
    "cthulhu_mythos",
    "occult",
    "none",
})

LANGUAGE_MEDIA = frozenset({
    "speech",
    "writing",
    "inscription",
})

LANGUAGE_DIFFICULTIES = frozenset({
    "regular",
    "hard",
    "extreme",
    "none",
})

_SUCCESS_ROLL_OUTCOMES = frozenset({
    "success",
    "regular",
    "regular_success",
    "hard",
    "hard_success",
    "extreme",
    "extreme_success",
    "critical",
    "critical_success",
    "auto_success",
})

_FAILURE_ROLL_OUTCOMES = frozenset({
    "failure",
    "fumble",
})

_UNSETTLED_ROLL_OUTCOMES = frozenset({
    "not_rolled",
    "pending",
})

LANGUAGE_ROLL_OUTCOMES = (
    _SUCCESS_ROLL_OUTCOMES
    | _FAILURE_ROLL_OUTCOMES
    | _UNSETTLED_ROLL_OUTCOMES
)

# Rulebook push examples / pushed-failure samples (full.md 3169-3173).
# Advisory candidates only — never auto-selected.
LANGUAGE_PUSH_METHOD_CANDIDATES = (
    "take_longer_to_compose",
    "long_pauses_to_answer",
    "reference_other_books",
)

LANGUAGE_PUSHED_FAILURE_CANDIDATES = (
    "alert_enemy_faction",
    "meaning_reversed_or_misunderstood",
    "unintentional_slur_offense",
)

_RENDER_TIER_FOR_BAND = {
    "unrecognized": "none",
    "identify": "none",
    "simple_ideas": "gist",
    "transactional": "partial",
    "fluent": "fluent",
    "native_passing": "fluent",
}

_BANDS_AT_LEAST_SIMPLE = frozenset({
    "simple_ideas",
    "transactional",
    "fluent",
    "native_passing",
})
_BANDS_AT_LEAST_TRANSACTIONAL = frozenset({
    "transactional",
    "fluent",
    "native_passing",
})
_BANDS_AT_LEAST_FLUENT = frozenset({"fluent", "native_passing"})

LANGUAGE_RENDER_DIRECTIONS = ("inbound", "outbound")
LANGUAGE_UNDERSTOOD_LAYERS = (
    "tone_only",
    "language_name",
    "gist",
    "partial",
    "full",
)
LANGUAGE_MEANING_CONFIDENCE = (
    "none",
    "gist",
    "partial",
    "high",
    "native",
    "unreliable",
)


def _coerce_nonneg_int(value: Any, default: int = 0) -> int:
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return default


def language_ability_band(skill_value: int, *, native: bool = False) -> str:
    """Return the rulebook Other-Language capability band.

    Native Own-Language speakers are native-passing. Code never identifies a
    language or infers a family; callers supply an already-decided skill value.
    """
    if native:
        return "native_passing"
    value = _coerce_nonneg_int(skill_value)
    for name, threshold in _LANGUAGE_BAND_BY_THRESHOLD:
        if value >= threshold:
            return name
    return "unrecognized"


def language_ability_facts(skill_value: int, *, native: bool = False) -> dict[str, Any]:
    """Structured capability facts for the five-band scale. No dice."""
    value = _coerce_nonneg_int(skill_value)
    band = language_ability_band(value, native=native)
    identifies = band != "unrecognized"
    simple = band in _BANDS_AT_LEAST_SIMPLE
    transactional = band in _BANDS_AT_LEAST_TRANSACTIONAL
    fluent = band in _BANDS_AT_LEAST_FLUENT
    native_passing = band == "native_passing"
    return {
        "band": band,
        "skill_value": value,
        "native": bool(native),
        "thresholds": dict(LANGUAGE_ABILITY_THRESHOLDS),
        "identifies_without_roll": identifies,
        "simple_ideas": simple,
        "transactional": transactional,
        "fluent": fluent,
        "native_passing": native_passing,
        "accent": bool(simple and not native_passing),
    }


def dialogue_comprehension_tier(skill_value: int, *, native: bool = False) -> str:
    """Rendering-facing four-label view of the five-band language scale."""
    return _RENDER_TIER_FOR_BAND[language_ability_band(skill_value, native=native)]


def _require_choice(field: str, value: Any, allowed: frozenset[str]) -> str:
    text = str(value or "").strip().lower()
    if text not in allowed:
        allowed_list = ", ".join(sorted(allowed))
        raise ValueError(f"invalid {field}: {value!r} (expected one of {allowed_list})")
    return text


def _optional_choice(
    field: str,
    value: Any,
    allowed: frozenset[str],
) -> str | None:
    if value is None or value == "":
        return None
    return _require_choice(field, value, allowed)


def _roll_verdict(outcome: str | None) -> str:
    if outcome is None or outcome in _UNSETTLED_ROLL_OUTCOMES:
        return "unsettled"
    if outcome in _SUCCESS_ROLL_OUTCOMES:
        return "success"
    if outcome in _FAILURE_ROLL_OUTCOMES:
        return "failure"
    return "unsettled"


def _automatic_success(
    *,
    facts: dict[str, Any],
    medium: str,
    difficulty: str | None,
) -> bool:
    # Dice Rule 1 / Own Language (full.md 3179, 7967): KP may waive a roll.
    if difficulty == "none":
        return True
    if facts["native"] and difficulty in (None, "regular") and medium == "speech":
        return True
    if facts["native"] and difficulty is None:
        return True
    # Fluent regular conversation does not require a roll (full.md 3165-3167).
    if facts["fluent"] and medium == "speech" and difficulty in (None, "regular"):
        return True
    return False


def _time_guidance(
    *,
    facts: dict[str, Any],
    recognized: bool,
    medium: str,
    difficulty: str | None,
    translator: bool,
    hurry: bool,
    failure: bool,
    pushed: bool,
    keeper_duration: str | None,
) -> str:
    if keeper_duration:
        return "keeper_specified"
    if translator:
        return "translator_pace"
    if not recognized and not facts["identifies_without_roll"]:
        return "translator_required"
    if pushed or failure:
        return "extra_time"
    if hurry:
        return "hurried"
    if medium in {"writing", "inscription"} and difficulty in {"hard", "extreme"}:
        return "extended_study"
    if medium in {"writing", "inscription"}:
        return "reading_pace"
    return "conversation_pace"


def settle_language(
    *,
    source_language: str,
    skill_value: int | None = None,
    native: bool | None = None,
    investigator: dict[str, Any] | None = None,
    recognition_route: str | None = None,
    recognition_result: str | None = None,
    medium: str = "speech",
    difficulty: str | None = None,
    roll_outcome: str | None = None,
    roll_receipt: dict[str, Any] | None = None,
    pushed: bool = False,
    core_clue: bool = False,
    time_context: dict[str, Any] | None = None,
    corpus_id: str | None = None,
) -> dict[str, Any]:
    """Settle recognition / comprehension / time / accuracy from KP-decided facts.

    This helper does not identify a language, infer a family, translate, or roll
    dice. ``source_language`` must already be a Keeper semantic decision.
    Dice live in ``rules.*``; pass the authoritative outcome or receipt here.
    """
    language = str(source_language or "").strip()
    if not language:
        raise ValueError("source_language is required and must be KP-decided")

    skill = language_skill_for_source(investigator, language)
    if skill_value is None:
        resolved_skill_value = int(skill["skill_value"])
    else:
        resolved_skill_value = _coerce_nonneg_int(skill_value)
    resolved_native = bool(skill["native"] if native is None else native)

    facts = language_ability_facts(resolved_skill_value, native=resolved_native)
    medium_key = _require_choice("medium", medium, LANGUAGE_MEDIA)
    difficulty_key = _optional_choice("difficulty", difficulty, LANGUAGE_DIFFICULTIES)

    route_default = "language_skill" if facts["identifies_without_roll"] else "none"
    route = _require_choice(
        "recognition_route",
        recognition_route if recognition_route is not None else route_default,
        LANGUAGE_RECOGNITION_ROUTES,
    )

    receipt = dict(roll_receipt) if isinstance(roll_receipt, dict) else None
    outcome = roll_outcome
    if outcome is None and receipt is not None:
        outcome = receipt.get("outcome")
    if outcome is None or outcome == "":
        outcome_key = None
    else:
        outcome_key = _require_choice("roll_outcome", outcome, LANGUAGE_ROLL_OUTCOMES)
    verdict = _roll_verdict(outcome_key)

    if recognition_result is None or recognition_result == "":
        recognition_result_key = None
    else:
        recognition_result_key = _require_choice(
            "recognition_result",
            recognition_result,
            LANGUAGE_ROLL_OUTCOMES,
        )
    recognition_verdict = _roll_verdict(recognition_result_key)

    identified_by_ability = bool(facts["identifies_without_roll"])
    requires_other_route = not identified_by_ability
    if identified_by_ability:
        recognized = True
        recognition_used = "language_skill" if route == "language_skill" else route
        recognition_result_out = recognition_result_key or "auto_success"
    elif route in {"know", "archaeology", "history", "cthulhu_mythos", "occult"}:
        recognition_used = route
        if recognition_verdict == "success":
            recognized = True
            recognition_result_out = recognition_result_key
        elif recognition_verdict == "failure":
            recognized = False
            recognition_result_out = recognition_result_key
        else:
            recognized = False
            recognition_result_out = recognition_result_key or "not_rolled"
    else:
        recognition_used = route
        recognized = False
        recognition_result_out = recognition_result_key or "not_rolled"

    auto = _automatic_success(
        facts=facts, medium=medium_key, difficulty=difficulty_key,
    )
    if difficulty_key == "none" or auto:
        check_needed = False
        check_difficulty = None if difficulty_key == "none" else difficulty_key
    else:
        check_needed = True
        check_difficulty = difficulty_key or "regular"

    if outcome_key is None and auto and not check_needed:
        outcome_key = "auto_success"
        verdict = "success"
    roll_settled = verdict != "unsettled"

    ability_scope = facts["band"]
    failure = verdict == "failure"
    success = verdict == "success"
    if success or (auto and not check_needed and not roll_settled):
        realized_scope = ability_scope
        if realized_scope == "unrecognized" and recognized:
            realized_scope = "identify"
    elif failure and core_clue:
        # full.md 8218/8224: obvious/core clues are not gated by the die.
        realized_scope = "necessary_gist"
    elif failure:
        realized_scope = "degraded" if ability_scope != "unrecognized" else "none"
    else:
        realized_scope = "pending" if check_needed else ability_scope

    if core_clue and realized_scope in {"none", "pending", "unrecognized"}:
        realized_scope = "necessary_gist"

    time_ctx = time_context if isinstance(time_context, dict) else {}
    translator = bool(time_ctx.get("translator"))
    hurry = bool(time_ctx.get("hurry"))
    keeper_duration = time_ctx.get("keeper_duration")
    keeper_duration_text = (
        str(keeper_duration).strip() if keeper_duration not in (None, "") else None
    )

    time_key = _time_guidance(
        facts=facts,
        recognized=recognized,
        medium=medium_key,
        difficulty=difficulty_key,
        translator=translator,
        hurry=hurry,
        failure=failure,
        pushed=bool(pushed),
        keeper_duration=keeper_duration_text,
    )

    if not roll_settled and check_needed:
        reliability = "unknown"
        risk = "unsettled_check"
    elif success:
        if facts["native_passing"]:
            reliability = "native"
        elif facts["fluent"]:
            reliability = "high"
        elif facts["transactional"]:
            reliability = "transactional"
        elif facts["simple_ideas"]:
            reliability = "simple_only"
        elif recognized:
            reliability = "identify_only"
        else:
            reliability = "none"
        risk = "none"
    elif failure and core_clue:
        reliability = "degraded"
        risk = "precision_time_or_safety"
    elif failure:
        reliability = "unreliable"
        risk = "misunderstanding"
    else:
        reliability = "unknown"
        risk = "none"

    if failure and pushed:
        risk = "pushed_failure" if not core_clue else "precision_time_or_safety"

    exceptional = outcome_key in {
        "critical",
        "critical_success",
        "fumble",
    }

    return {
        "source_language": language,
        "skill_key": skill["skill_key"],
        "skill_value": facts["skill_value"],
        "native": facts["native"],
        "ability": facts,
        "recognized": recognized,
        "recognition": {
            "route": recognition_used,
            "result": recognition_result_out,
            "by_language_skill": identified_by_ability,
            "requires_other_route": requires_other_route,
        },
        "comprehension": {
            "ability_scope": ability_scope,
            "realized_scope": realized_scope,
            "core_clue_gist_guaranteed": bool(core_clue),
        },
        "check": {
            "needed": check_needed,
            "automatic_success": bool(auto and not check_needed),
            "difficulty": check_difficulty,
            "covers_coherent_corpus": True,
            "corpus_id": str(corpus_id).strip() if corpus_id else None,
            "roll_outcome": outcome_key,
            "roll_receipt": receipt,
            "roll_settled": roll_settled,
            "exceptional": exceptional,
        },
        "time": {
            "guidance": time_key,
            "translator": translator,
            "hurry": hurry,
            "keeper_duration": keeper_duration_text,
            "advisory": True,
        },
        "accuracy": {
            "reliability": reliability,
            "risk": risk,
            "goal_failed": False,
        },
        "push": {
            "pushed": bool(pushed),
            "method_candidates": list(LANGUAGE_PUSH_METHOD_CANDIDATES),
            "failure_consequence_candidates": list(LANGUAGE_PUSHED_FAILURE_CANDIDATES),
            "selected_method": None,
            "selected_consequence": None,
        },
    }


def language_display_label(
    source_language: str,
    play_language: str | None = None,
) -> str:
    """Player-facing name for a KP-decided language. Never infers from text."""
    raw = str(source_language or "").strip()
    language = play_language or DEFAULT_PLAY_LANGUAGE
    mapped = (_LANGUAGE_DISPLAY_NAMES.get(language) or {}).get(
        _normalize_language_name(raw),
    )
    return mapped or raw


def _quote_source_text(source_text: str, play_language: str) -> str:
    text = str(source_text)
    if play_language == "zh-Hans":
        return f"“{text}”"
    return f'"{text}"'


def _settlement_for_render(
    *,
    source_language: str,
    investigator: dict[str, Any] | None,
    settled: dict[str, Any] | None,
    skill_value: int | None,
    native: bool | None,
    recognition_route: str | None,
    recognition_result: str | None,
    medium: str,
    difficulty: str | None,
    roll_outcome: str | None,
    roll_receipt: dict[str, Any] | None,
    pushed: bool,
    core_clue: bool,
    time_context: dict[str, Any] | None,
    corpus_id: str | None,
) -> dict[str, Any]:
    if settled is not None:
        return settled
    return settle_language(
        source_language=source_language,
        skill_value=skill_value,
        native=native,
        investigator=investigator,
        recognition_route=recognition_route,
        recognition_result=recognition_result,
        medium=medium,
        difficulty=difficulty,
        roll_outcome=roll_outcome,
        roll_receipt=roll_receipt,
        pushed=pushed,
        core_clue=core_clue,
        time_context=time_context,
        corpus_id=corpus_id,
    )


def _render_display_scope(settled: dict[str, Any]) -> str:
    realized = str(settled["comprehension"]["realized_scope"])
    ability = str(settled["comprehension"]["ability_scope"])
    check = settled["check"]
    if realized in {"necessary_gist", "degraded", "none"}:
        return realized
    if realized == "pending":
        return ability
    if check.get("roll_settled") or check.get("automatic_success") or not check.get("needed"):
        return realized
    return ability


def _inbound_understood_layer(display_scope: str, recognized: bool) -> str:
    if display_scope == "necessary_gist":
        return "gist"
    if display_scope == "degraded":
        return "gist"
    if display_scope == "simple_ideas":
        return "gist"
    if display_scope == "transactional":
        return "partial"
    if display_scope in {"fluent", "native_passing"}:
        return "full"
    if display_scope == "identify" or recognized:
        return "language_name"
    return "tone_only"


def _meaning_confidence(
    *,
    layer: str,
    native_passing: bool,
    unreliable: bool,
) -> str:
    if unreliable:
        return "unreliable"
    if layer in {"tone_only", "language_name"}:
        return "none"
    if layer == "gist":
        return "gist"
    if layer == "partial":
        return "partial"
    if layer == "full":
        return "native" if native_passing else "high"
    return "none"


def _language_render_contract(
    *,
    direction: str,
    settled: dict[str, Any],
    source_text: str,
    play_language: str,
    understood_text: str | None,
    intended_meaning: str | None,
    delivered_meaning: str | None,
    delivered_meaning_confidence: str,
    comprehension: str,
    understood_layer: str,
    translation_visible: bool,
    language_name_visible: bool,
    visible_text: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    identified = bool(settled["recognized"])
    contract = {
        "direction": direction,
        "source_language": settled["source_language"],
        "source_text": source_text,
        "understood_text": understood_text,
        "intended_meaning": intended_meaning,
        "delivered_meaning": delivered_meaning,
        "delivered_meaning_confidence": delivered_meaning_confidence,
        "play_language": play_language,
        "skill_key": settled["skill_key"],
        "skill_value": settled["skill_value"],
        "native": settled["native"],
        "ability_band": settled["ability"]["band"],
        "comprehension": comprehension,
        "realized_scope": settled["comprehension"]["realized_scope"],
        "understood_layer": understood_layer,
        "translation_visible": translation_visible,
        "language_name_visible": language_name_visible,
        "visible_text": visible_text,
        "player_visible_source_is_not_investigator_knowledge": True,
        "investigator_knowledge": {
            "language_identified": identified,
            "understood_layer": understood_layer,
            "understood_text": understood_text,
        },
        "ability": settled["ability"],
        "accuracy": settled["accuracy"],
        "settlement": settled,
    }
    if extra:
        contract.update(extra)
    return contract


def _inbound_visible_text(
    *,
    play_language: str,
    source_text: str,
    layer: str,
    language_label: str,
    translation: str | None,
    partial_translation: str | None,
    gist: str | None,
    register_note: str | None,
    speaker_background_note: str | None,
    show_register: bool,
    show_background: bool,
    degraded: bool,
    core_gist: bool,
) -> tuple[str, str | None, bool]:
    quoted = _quote_source_text(source_text, play_language)
    zh = play_language == "zh-Hans"

    if layer == "tone_only":
        note = (
            "你听不懂具体意思，只能从语气、表情和动作判断情绪。"
            if zh else
            "You do not understand the exact words; only tone and body language carry through."
        )
        return f"{quoted}\n{note}", None, False

    if layer == "language_name":
        note = (
            f"你听出这是{language_label}，但听不懂具体意思，只能从语气、表情和动作判断情绪。"
            if zh else
            f"You recognize this as {language_label}, but you do not understand the words; only tone and body language carry through."
        )
        return f"{quoted}\n{note}", None, False

    if layer == "gist":
        if zh:
            if gist:
                body = f"你只能抓到零碎意思：{gist}"
            elif core_gist:
                body = "你抓住了关键大意，但措辞和细节并不稳。"
            elif degraded:
                body = "你没能稳定听懂，意思对不上。"
            else:
                body = "你只听出几个零碎词，意思仍很不稳。"
        else:
            if gist:
                body = f"You catch only fragments: {gist}"
            elif core_gist:
                body = "You catch the necessary gist, but wording and detail stay unstable."
            elif degraded:
                body = "You cannot hold the meaning steadily."
            else:
                body = "You catch only fragments."
        return f"{quoted}\n{body}", gist, False

    if layer == "partial":
        understood = partial_translation or gist
        if zh:
            if partial_translation:
                body = f"你大概听出：{partial_translation}"
            elif gist:
                body = f"你大概听出一部分：{gist}，但细节仍不稳。"
            else:
                body = "你大概听懂了一部分，但细节仍不稳。"
        else:
            body = (
                f"You roughly make out: {understood}"
                if understood else
                "You understand part of it, but not reliably."
            )
        return f"{quoted}\n{body}", understood, bool(partial_translation)

    understood = translation
    if zh:
        body = f"你听懂了：{translation}" if translation else "你听懂了这句话。"
    else:
        body = (
            f"You understand: {translation}"
            if translation else
            "You understand the sentence."
        )
    extras: list[str] = []
    if show_background and speaker_background_note:
        extras.append(
            f"你听得出对方并非以这门语言为母语。{speaker_background_note}"
            if zh else
            f"You can tell this is not the speaker's native language. {speaker_background_note}"
        )
    if show_register and register_note:
        extras.append(
            f"你听出语域上的细微之处：{register_note}"
            if zh else
            f"You catch a fine register cue: {register_note}"
        )
    if extras:
        body = body + "\n" + "\n".join(extras)
    return f"{quoted}\n{body}", understood, bool(translation)


def _outgoing_delivery(
    *,
    facts: dict[str, Any],
    display_scope: str,
    failure: bool,
) -> dict[str, Any]:
    band = facts["band"]
    cannot_speak = (
        band in {"unrecognized", "identify"}
        or display_scope in {"none", "unrecognized", "identify"}
    )
    if cannot_speak:
        return {
            "utterance_delivered": False,
            "pauses": band == "identify" or display_scope == "identify",
            "simplified": False,
            "wrong_word_risk": False,
            "missing_professional_phrasing": True,
            "accent_visible": False,
            "native_passing": False,
        }
    simple = band == "simple_ideas" or display_scope == "simple_ideas"
    return {
        "utterance_delivered": True,
        "pauses": bool(simple or (failure and not facts["native_passing"])),
        "simplified": bool(simple),
        "wrong_word_risk": bool(failure),
        "missing_professional_phrasing": not bool(facts["fluent"]),
        "accent_visible": bool(facts["accent"]),
        "native_passing": bool(facts["native_passing"]),
    }


def _outbound_visible_text(
    *,
    play_language: str,
    source_text: str,
    intended_meaning: str,
    language_label: str,
    delivery: dict[str, Any],
    failure: bool,
) -> str:
    zh = play_language == "zh-Hans"
    intent = str(intended_meaning or "").strip()
    intent_line = ""
    if intent:
        intent_line = f"你想说的是：{intent}" if zh else f"You intended: {intent}"

    if not delivery["utterance_delivered"]:
        if delivery["pauses"]:
            body = (
                f"你听得出这是{language_label}，却说不成句，只能靠停顿、语气和动作。"
                if zh else
                f"You recognize this as {language_label}, but you cannot form the sentence; only pauses, tone, and gesture come out."
            )
        else:
            body = (
                "这门语言你说不出来，只能靠语气和动作比划。"
                if zh else
                "You cannot speak this language; only tone and gesture come through."
            )
        return "\n".join(part for part in (body, intent_line) if part)

    quoted = _quote_source_text(source_text, play_language)
    if zh:
        if delivery["native_passing"]:
            speech = f"你用{language_label}说：{quoted}"
            craft = "语域自然，可被当成母语者。"
        elif delivery["accent_visible"] and not delivery["missing_professional_phrasing"]:
            speech = f"你用{language_label}流利地说：{quoted}"
            craft = "母语者仍能听出你不是以这门语言为母语。"
        elif delivery["simplified"]:
            speech = f"你用{language_label}慢慢挤出：{quoted}"
            craft = "停顿很多，只能传达简单意思，专业措辞到不了。"
        else:
            speech = f"你用{language_label}说：{quoted}"
            craft = "能完成交易性表达，但专业措辞仍不到位。"
        risk = "表达并不稳，有被听错或说错的风险。" if failure else ""
    else:
        if delivery["native_passing"]:
            speech = f"You say in {language_label}: {quoted}"
            craft = "The register is native-passing."
        elif delivery["accent_visible"] and not delivery["missing_professional_phrasing"]:
            speech = f"You speak {language_label} fluently: {quoted}"
            craft = "A native listener can still tell this is not your first language."
        elif delivery["simplified"]:
            speech = f"You slowly piece out {language_label}: {quoted}"
            craft = "There are long pauses; only simple ideas land, and professional phrasing is missing."
        else:
            speech = f"You say in {language_label}: {quoted}"
            craft = "Transactional meaning lands, but professional phrasing is still missing."
        risk = "The wording is unstable; there is a risk it will be misunderstood." if failure else ""
    return "\n".join(part for part in (speech, craft, intent_line, risk) if part)


def render_foreign_dialogue_for_investigator(
    *,
    source_text: str,
    source_language: str,
    investigator: dict[str, Any] | None,
    translation: str | None = None,
    partial_translation: str | None = None,
    gist: str | None = None,
    play_language: str = DEFAULT_PLAY_LANGUAGE,
    settled: dict[str, Any] | None = None,
    skill_value: int | None = None,
    native: bool | None = None,
    recognition_route: str | None = None,
    recognition_result: str | None = None,
    medium: str = "speech",
    difficulty: str | None = None,
    roll_outcome: str | None = None,
    roll_receipt: dict[str, Any] | None = None,
    pushed: bool = False,
    core_clue: bool = False,
    time_context: dict[str, Any] | None = None,
    corpus_id: str | None = None,
    language_name: str | None = None,
    register_note: str | None = None,
    speaker_background_note: str | None = None,
) -> dict[str, Any]:
    """Render NPC→investigator diegetic speech through settle_language.

    Always keeps ``source_text`` in the original language. Does not translate.
    Keeper/semantic layer supplies gist, partial, or full meaning; this helper
    only reveals the layer the investigator actually realized.
    """
    settlement = _settlement_for_render(
        source_language=source_language,
        investigator=investigator,
        settled=settled,
        skill_value=skill_value,
        native=native,
        recognition_route=recognition_route,
        recognition_result=recognition_result,
        medium=medium,
        difficulty=difficulty,
        roll_outcome=roll_outcome,
        roll_receipt=roll_receipt,
        pushed=pushed,
        core_clue=core_clue,
        time_context=time_context,
        corpus_id=corpus_id,
    )
    display_scope = _render_display_scope(settlement)
    layer = _inbound_understood_layer(display_scope, bool(settlement["recognized"]))
    ability_tier = dialogue_comprehension_tier(
        settlement["skill_value"], native=bool(settlement["native"]),
    )
    label = str(language_name).strip() if language_name else language_display_label(
        settlement["source_language"], play_language,
    )
    facts = settlement["ability"]
    unreliable = display_scope == "degraded" or settlement["accuracy"]["risk"] in {
        "misunderstanding",
        "pushed_failure",
    }
    visible_text, understood_text, translation_visible = _inbound_visible_text(
        play_language=play_language,
        source_text=source_text,
        layer=layer,
        language_label=label,
        translation=translation,
        partial_translation=partial_translation,
        gist=gist,
        register_note=register_note,
        speaker_background_note=speaker_background_note,
        show_register=bool(facts["native_passing"] and register_note),
        show_background=bool(facts["fluent"] and speaker_background_note),
        degraded=display_scope == "degraded",
        core_gist=display_scope == "necessary_gist",
    )
    return _language_render_contract(
        direction="inbound",
        settled=settlement,
        source_text=source_text,
        play_language=play_language,
        understood_text=understood_text,
        intended_meaning=None,
        delivered_meaning=None,
        delivered_meaning_confidence=_meaning_confidence(
            layer=layer,
            native_passing=bool(facts["native_passing"]),
            unreliable=unreliable,
        ),
        comprehension=ability_tier,
        understood_layer=layer,
        translation_visible=translation_visible,
        language_name_visible=bool(settlement["recognized"]),
        visible_text=visible_text,
    )


def render_investigator_speech_in_language(
    *,
    intended_meaning: str,
    source_text: str,
    source_language: str,
    investigator: dict[str, Any] | None,
    play_language: str = DEFAULT_PLAY_LANGUAGE,
    settled: dict[str, Any] | None = None,
    skill_value: int | None = None,
    native: bool | None = None,
    recognition_route: str | None = None,
    recognition_result: str | None = None,
    medium: str = "speech",
    difficulty: str | None = None,
    roll_outcome: str | None = None,
    roll_receipt: dict[str, Any] | None = None,
    pushed: bool = False,
    core_clue: bool = False,
    time_context: dict[str, Any] | None = None,
    corpus_id: str | None = None,
    language_name: str | None = None,
) -> dict[str, Any]:
    """Render investigator→NPC foreign speech from player intent + KP utterance.

    Code never translates and never rewrites ``intended_meaning``. Failed or
    pushed speech is marked as settlement risk rather than a fabricated
    mistranslation. ``source_text`` stays the KP-supplied target-language line.
    """
    settlement = _settlement_for_render(
        source_language=source_language,
        investigator=investigator,
        settled=settled,
        skill_value=skill_value,
        native=native,
        recognition_route=recognition_route,
        recognition_result=recognition_result,
        medium=medium,
        difficulty=difficulty,
        roll_outcome=roll_outcome,
        roll_receipt=roll_receipt,
        pushed=pushed,
        core_clue=core_clue,
        time_context=time_context,
        corpus_id=corpus_id,
    )
    display_scope = _render_display_scope(settlement)
    facts = settlement["ability"]
    failure = settlement["check"]["roll_outcome"] in _FAILURE_ROLL_OUTCOMES
    delivery = _outgoing_delivery(
        facts=facts, display_scope=display_scope, failure=failure,
    )
    label = str(language_name).strip() if language_name else language_display_label(
        settlement["source_language"], play_language,
    )
    intent = str(intended_meaning or "")
    visible_text = _outbound_visible_text(
        play_language=play_language,
        source_text=source_text,
        intended_meaning=intent,
        language_label=label,
        delivery=delivery,
        failure=failure,
    )
    unreliable = bool(failure or delivery["wrong_word_risk"])
    if delivery["native_passing"]:
        layer = "full"
    elif facts["fluent"]:
        layer = "full"
    elif facts["transactional"]:
        layer = "partial"
    elif facts["simple_ideas"]:
        layer = "gist"
    elif settlement["recognized"] or facts["identifies_without_roll"]:
        layer = "language_name"
    else:
        layer = "tone_only"
    ability_tier = dialogue_comprehension_tier(
        settlement["skill_value"], native=bool(settlement["native"]),
    )
    return _language_render_contract(
        direction="outbound",
        settled=settlement,
        source_text=source_text,
        play_language=play_language,
        understood_text=None,
        intended_meaning=intent,
        delivered_meaning=intent,
        delivered_meaning_confidence=_meaning_confidence(
            layer=layer,
            native_passing=bool(facts["native_passing"]),
            unreliable=unreliable,
        ),
        comprehension=ability_tier,
        understood_layer=layer,
        translation_visible=False,
        language_name_visible=layer != "tone_only",
        visible_text=visible_text,
        extra={"delivery": delivery},
    )

BASE_REPORT_LABELS = {
    "roll_sentence": "- {skill}: {actor} rolled {roll} vs {target} -> {outcome}",
    "die_roll_sentence": "- {skill}: {actor} rolled {die} = {roll} ({breakdown}) -> {outcome}",
    "die_face": "die roll",
    "fixed_modifier": "fixed modifier",
    "roll_breakdown_separator": "; ",
    "difficulty": "Difficulty",
    "goal": "Goal",
    "difficulty_rationale": "Difficulty Rationale",
    "failure_consequence": "Failure Consequence",
    "pushed_roll": "Pushed Roll",
    "push_justification": "Push Justification",
    "foreshadowed_failure": "Foreshadowed Failure",
    "skill_check_earned": "Skill Check Earned",
    "san_loss": "SAN Loss",
    "san_change": "SAN Change",
    "rule_refs": "Rule Refs",
    "yes": "yes",
    "no": "no",
    "localized_terms_summary": "{count} entries (recorded in playtest.json)",
    "feedback_line": "- {category} {score}/5: {voice}: \"{text}\"",
    "feedback_voice_default": "Player feedback",
    "feedback_voice_profile": "{profile} feedback",
}

BASE_EMPTY_REPORT_LINES = {
    "combat_summary": "- No combat summary recorded.",
    "combat_tracker": "- No combat tracker recorded.",
    "chase_summary": "- No chase summary recorded.",
    "chase_tracker": "- No chase tracker recorded.",
    "sanity_summary": "- No sanity summary recorded.",
}

BASE_SPEAKER_LABELS = {
    "keeper": "KP",
    "player": "Player",
    "single_player": "Single Player",
    "system": "system",
}

BASE_TRANSCRIPT_LABELS = {
    "turn_format": "Turn {turn}",
    "mode": "Mode",
    "intent": "Intent",
    "ruling": "Ruling",
}

BASE_TRANSCRIPT_MODE_LABELS = {
    "play": "play",
    "roll": "roll",
    "meta": "meta",
}

BASE_REPORT_HEADING_LABELS = {
    "Battle Report": "Battle Report",
    "Run Setup": "Run Setup",
    "Module": "Module",
    "Handouts": "Handouts",
    "Investigator Creation": "Investigator Creation",
    "Character Dossier": "Character Dossier",
    "Final Recorded State": "Final Recorded State",
    "Investigator Chronicle": "Investigator Chronicle",
    "Scene-by-Scene Replay": "Scene-by-Scene Replay",
    "Actual Play Replay": "Actual Play Replay",
    "Session Transcript": "Session Transcript",
    "Major Player Decisions": "Major Player Decisions",
    "Rules & Rolls Recap": "Rules & Rolls Recap",
    "Mechanical Log": "Mechanical Log",
    "Important Rolls": "Important Rolls",
    "State Changes": "State Changes",
    "Combat Summary": "Combat Summary",
    "Chase Summary": "Chase Summary",
    "Chase Tracker": "Chase Tracker",
    "Sanity Summary": "Sanity Summary",
    "Clues Found": "Clues Found",
    "Session Ending": "Session Ending",
    "Story Recap": "Story Recap",
    "Player Feedback On KP": "Player Feedback On KP",
    "Localization Appendix": "Localization Appendix",
    "Combat Tracker": "Combat Tracker",
    "Epistemic Experience": "Epistemic Experience",
    "Tool Reliability": "Tool Reliability",
    "Narrative Adherence": "Narrative Route Coverage (Not Ending Outcome)",
}

BASE_REPORT_FIELD_LABELS = {
    "Run ID": "Run ID",
    "Campaign ID": "Campaign ID",
    "Campaign": "Campaign",
    "Audit Profile": "Audit Profile",
    "Simulation Method": "Simulation Method",
    "Era": "Era",
    "Dice Mode": "Dice Mode",
    "Spoiler Policy": "Spoiler Policy",
    "Play Language": "Play Language",
    "Language Profile": "Language Profile",
    "Localized Terms": "Localized Terms",
    "Player Profile": "Player Profile",
    "Scenario": "Scenario",
    "Scenario ID": "Scenario ID",
    "Source": "Source",
    "Opening Scene": "Opening Scene",
}

BASE_REPORT_VALUE_LABELS = {
    "baseline": "baseline",
    "rulebook_smoke": "rulebook_smoke",
    "transcript_driven_virtual_table": "transcript_driven_virtual_table",
    "codex": "codex",
    "warn_before_reveal": "warn_before_reveal",
    "Simplified Chinese": "Simplified Chinese",
    "English": "English",
    "Japanese": "Japanese",
    "careful_investigator": "careful_investigator",
    "reckless_investigator": "reckless_investigator",
    "skeptical_rules_lawyer": "skeptical_rules_lawyer",
    "multi_profile_matrix": "multi_profile_matrix",
}

BASE_CHARACTER_DOSSIER_LABELS = {
    "Player": "Player",
    "Occupation": "Occupation",
    "Era": "Era",
    "Characteristics": "Characteristics",
    "Characteristic Half/Fifth Values": "Characteristic Half/Fifth Values",
    "Derived": "Derived",
    "damage_bonus": "DB",
    "build": "Build",
    "Skills": "Skills",
    "Skill Half/Fifth Values": "Skill Half/Fifth Values",
    "Backstory": "Backstory",
    "Description": "Description",
    "Ideology/Beliefs": "Ideology/Beliefs",
    "Traits Detail": "Traits Detail",
    "Significant People": "Significant People",
    "Meaningful Locations": "Meaningful Locations",
    "Treasured Possessions": "Treasured Possessions",
    "Traits": "Traits",
    "Injuries & Scars": "Injuries & Scars",
    "Phobias & Manias": "Phobias & Manias",
}

BASE_CREATION_LABELS = {
    "Rulebook Source": "Rulebook Source",
    "Method": "Method",
    "Rulebook Steps": "Rulebook Steps",
    "Characteristics": "Characteristics",
    "Characteristic Half/Fifth Values": "Characteristic Half/Fifth Values",
    "Age": "Age",
    "Age Adjustments": "Age Adjustments",
    "Derived Attributes": "Derived Attributes",
    "Occupation": "Occupation",
    "Occupation Skill Points": "Occupation Skill Points",
    "Personal Interest Skill Points": "Personal Interest Skill Points",
    "Credit Rating": "Credit Rating",
    "Rulebook Occupation Range": "rulebook occupation range",
    "Living Standard": "Living Standard",
    "Cash": "Cash",
    "Assets": "Assets",
    "Spending Level": "Daily unbooked allowance",
    "Skill Allocation": "Skill Allocation",
    "Skill Half/Fifth Values": "Skill Half/Fifth Values",
    "Base": "Base",
    "Personal Interest": "Personal Interest",
    "Unallocated": "Unallocated",
    "Backstory": "Backstory",
    "Equipment": "Equipment",
    "Notes": "Notes",
    "standard_rulebook_chapter_3": "standard rulebook Chapter 3",
    "Call of Cthulhu Keeper Rulebook Chapter 3": "Call of Cthulhu Keeper Rulebook Chapter 3",
}

BASE_CHRONICLE_LABELS = {
    "History": "History",
    "Development": "Development",
    "Inventory History": "Inventory History",
    "Final HP": "Final HP",
    "Final SAN": "Final SAN",
    "Notable Events": "Notable Events",
    "Unresolved Threads": "Unresolved Threads",
    "Development Entry": "Development Entry",
    "Development Check Earned": "Development Check Earned",
    "Development Phase Summary": "Development Phase Summary",
    "Status": "Status",
    "Roll": "Roll",
    "Source Kind": "Source Kind",
    "Source Event": "Source Event",
    "earned": "earned",
    "Skill Checks Earned": "Skill Checks Earned",
    "Rewards": "Rewards",
    "Permanent Changes": "Permanent Changes",
    "Carryover Notes": "Carryover Notes",
    "Items": "Items",
    "Cash": "Cash",
    "Notes": "Notes",
    "pending_player_rolls": "pending_player_rolls",
}

BASE_FEEDBACK_LABELS = {
    "kp_clarity": "kp_clarity",
    "rules_helpfulness": "rules_helpfulness",
    "immersion": "immersion",
    "pacing": "pacing",
    "fairness": "fairness",
    "agency": "agency",
    "meta_quality": "meta_quality",
    "spoiler_safety": "spoiler_safety",
    "module_fidelity": "module_fidelity",
    "combat_readability": "combat_readability",
    "chase_readability": "chase_readability",
}

BASE_CHASE_TRACKER_LABELS = {
    "Chase ID": "Chase ID",
    "State File": "State File",
    "Status": "Status",
    "Round": "Round",
    "DEX order": "DEX order",
    "Participants": "Participants",
    "Location Chain": "Location Chain",
    "Rounds": "Rounds",
    "Outcome": "Outcome",
    "movement_actions": "actions",
    "position": "position",
    "round_format": "Round {round}",
    "start": "start",
    "clear": "clear",
    "hazard": "hazard",
    "barrier": "barrier",
    "escape": "escape",
    "quarry": "quarry",
    "pursuer": "pursuer",
    "resolved": "resolved",
}

LANGUAGE_PROFILES: dict[str, dict[str, Any]] = {
    "zh-Hans": {
        "language": "zh-Hans",
        "display_name": "Simplified Chinese",
        "output_instruction": "Use Simplified Chinese for player-visible narration, table dialogue, recaps, and reports.",
        "name_policy": "Foreign names should use Chinese transliterations or conventional translated names.",
        "term_policy": "Use localized_terms.zh-Hans for people, places, factions, handouts, campaign titles, scenario titles, player-visible module source labels, player-visible skill display names, and special terms.",
        "report_labels": {
            "roll_sentence": "- {skill}：{actor}掷出 {roll} / {target}，结果{outcome}。",
            "die_roll_sentence": "- {skill}：{actor}掷出 {die} = {roll}（{breakdown}），结果{outcome}。",
            "die_face": "骰面",
            "fixed_modifier": "固定加值",
            "roll_breakdown_separator": "；",
            "difficulty": "难度",
            "goal": "目的",
            "difficulty_rationale": "难度说明",
            "failure_consequence": "失败后果",
            "pushed_roll": "推骰",
            "push_justification": "推骰理由",
            "foreshadowed_failure": "预告失败后果",
            "skill_check_earned": "成长标记",
            "san_loss": "SAN 损失",
            "san_change": "SAN 变化",
            "rule_refs": "规则引用",
            "yes": "是",
            "no": "否",
            "localized_terms_summary": "{count} 条（记录于 playtest.json）",
            "feedback_line": "- {category} {score}/5：{voice}：“{text}”",
            "feedback_voice_default": "玩家反馈",
            "feedback_voice_profile": "{profile}反馈",
        },
        "report_heading_labels": {
            "Battle Report": "跑团战报",
            "Run Setup": "运行设置",
            "Module": "模组",
            "Handouts": "线索资料",
            "Investigator Creation": "角色创建记录",
            "Character Dossier": "角色档案",
            "Final Recorded State": "最终记录状态",
            "Investigator Chronicle": "调查员经历",
            "Scene-by-Scene Replay": "逐场景回放",
            "Actual Play Replay": "实际跑团回放",
            "Session Transcript": "会话记录",
            "Major Player Decisions": "玩家关键决定",
            "Rules & Rolls Recap": "规则与掷骰回顾",
            "Mechanical Log": "机制日志",
            "Important Rolls": "重要掷骰",
            "State Changes": "状态变化",
            "Combat Summary": "战斗摘要",
            "Chase Summary": "追逐摘要",
            "Chase Tracker": "追逐追踪器",
            "Sanity Summary": "理智摘要",
            "Clues Found": "已发现线索",
            "Session Ending": "本次结局",
            "Story Recap": "剧情回顾",
            "Player Feedback On KP": "玩家对 KP 的反馈",
            "Localization Appendix": "本地化附录",
            "Combat Tracker": "战斗追踪器",
            "Epistemic Experience": "认知体验诊断",
            "Tool Reliability": "工具可靠性（诊断）",
            "Narrative Adherence": "叙事路径覆盖（非结局判定）",
        },
        "report_field_labels": {
            "Run ID": "运行编号",
            "Campaign ID": "战役 ID",
            "Campaign": "战役",
            "Audit Profile": "审计画像",
            "Simulation Method": "模拟方式",
            "Era": "年代",
            "Dice Mode": "骰子模式",
            "Spoiler Policy": "剧透策略",
            "Play Language": "游玩语言",
            "Language Profile": "语言配置",
            "Localized Terms": "本地化术语",
            "Player Profile": "游玩风格",
            "Scenario": "模组",
            "Scenario ID": "模组 ID",
            "Source": "来源",
            "Opening Scene": "开场场景",
        },
        "report_value_labels": {
            "baseline": "基线测试",
            "rulebook_smoke": "规则书冒烟测试",
            "transcript_driven_virtual_table": "转录驱动虚拟桌面",
            "codex": "Codex 掷骰",
            "warn_before_reveal": "剧透前警告",
            "Simplified Chinese": "简体中文",
            "English": "英语",
            "Japanese": "日语",
            "careful_investigator": "谨慎风格",
            "reckless_investigator": "鲁莽风格",
            "skeptical_rules_lawyer": "规则质疑风格",
            "multi_profile_matrix": "单人多风格开局",
        },
        "character_dossier_labels": {
            "Player": "玩家",
            "Occupation": "职业",
            "Era": "年代",
            "Characteristics": "属性",
            "Characteristic Half/Fifth Values": "属性半值/五分之一",
            "Derived": "衍生值",
            "damage_bonus": "DB",
            "build": "体格",
            "Skills": "技能",
            "Skill Half/Fifth Values": "技能半值/五分之一",
            "Backstory": "背景",
            "Description": "描述",
            "Ideology/Beliefs": "信念/理念",
            "Traits Detail": "特质详情",
            "Significant People": "重要之人",
            "Meaningful Locations": "重要地点",
            "Treasured Possessions": "珍贵物品",
            "Traits": "特质",
            "Injuries & Scars": "伤疤与伤势",
            "Phobias & Manias": "恐惧与躁狂",
        },
        "creation_labels": {
            "Rulebook Source": "规则书来源",
            "Method": "创建方法",
            "Rulebook Steps": "规则书步骤",
            "Characteristics": "生成属性",
            "Characteristic Half/Fifth Values": "属性半值/五分之一",
            "Age": "年龄",
            "Age Adjustments": "年龄调整",
            "Derived Attributes": "衍生值",
            "Occupation": "职业",
            "Occupation Skill Points": "职业技能点",
            "Personal Interest Skill Points": "个人兴趣技能点",
            "Credit Rating": "信用评级",
            "Rulebook Occupation Range": "规则书职业范围",
            "Living Standard": "生活水平",
            "Cash": "现金",
            "Assets": "资产",
            "Spending Level": "每日免记账额度",
            "Skill Allocation": "技能分配",
            "Skill Half/Fifth Values": "技能半值/五分之一",
            "Base": "基础",
            "Personal Interest": "个人兴趣",
            "Unallocated": "未分配",
            "Backstory": "背景",
            "Equipment": "装备",
            "Notes": "备注",
            "standard_rulebook_chapter_3": "规则书第 3 章标准创建",
            "Call of Cthulhu Keeper Rulebook Chapter 3": "《克苏鲁的呼唤守秘人规则书》第 3 章",
        },
        "chronicle_labels": {
            "History": "经历",
            "Development": "成长",
            "Inventory History": "物品经历",
            "Final HP": "最终 HP",
            "Final SAN": "最终 SAN",
            "Notable Events": "重要事件",
            "Unresolved Threads": "未解线索",
            "Development Entry": "成长条目",
            "Development Check Earned": "已获得成长标记",
            "Development Phase Summary": "成长阶段摘要",
            "Status": "状态",
            "Roll": "骰值",
            "Source Kind": "来源类型",
            "Source Event": "来源事件",
            "earned": "已获得",
            "Skill Checks Earned": "获得成长标记",
            "Rewards": "奖励",
            "Permanent Changes": "永久变化",
            "Carryover Notes": "继承备注",
            "Items": "物品",
            "Cash": "现金",
            "Notes": "备注",
            "pending_player_rolls": "等待玩家成长检定",
        },
        "feedback_labels": {
            "kp_clarity": "KP 清晰度",
            "rules_helpfulness": "规则帮助度",
            "immersion": "沉浸感",
            "pacing": "节奏",
            "fairness": "公平性",
            "agency": "自主性",
            "meta_quality": "超游质量",
            "spoiler_safety": "剧透安全",
            "module_fidelity": "模组忠实度",
            "combat_readability": "战斗可读性",
            "chase_readability": "追逐可读性",
        },
        "chase_tracker_labels": {
            "Chase ID": "追逐 ID",
            "State File": "状态文件",
            "Status": "状态",
            "Round": "当前轮数",
            "DEX order": "DEX 顺序",
            "Participants": "参与者",
            "Location Chain": "位置链",
            "Rounds": "轮次",
            "Outcome": "结果",
            "movement_actions": "移动行动",
            "position": "位置",
            "round_format": "第 {round} 轮",
            "start": "起点",
            "clear": "通路",
            "hazard": "危险点",
            "barrier": "障碍",
            "escape": "逃脱点",
            "quarry": "被追者",
            "pursuer": "追赶者",
            "resolved": "已解决",
        },
        "empty_report_lines": {
            "combat_summary": "- 本轮没有触发战斗场面。",
            "combat_tracker": "- 本轮没有战斗状态需要追踪。",
            "chase_summary": "- 本轮没有触发追逐场面。",
            "chase_tracker": "- 本轮没有追逐状态需要追踪。",
            "sanity_summary": "- 本轮没有触发理智检定或疯狂事件。",
        },
        "speaker_labels": {
            "keeper": "KP",
            "player": "玩家",
            "single_player": "单人玩家",
            "system": "系统",
        },
        "transcript_labels": {
            "turn_format": "第 {turn} 轮",
            "mode": "模式",
            "intent": "意图",
            "ruling": "裁定",
        },
        "transcript_mode_labels": {
            "play": "游玩",
            "roll": "掷骰",
            "meta": "超游",
        },
        "outcome_labels": {
            "critical": "大成功",
            "extreme": "极难成功",
            "extreme_success": "极难成功",
            "hard": "困难成功",
            "hard_success": "困难成功",
            "regular": "普通成功",
            "regular_success": "普通成功",
            "success": "成功",
            "failure": "失败",
            "fumble": "大失败",
            "damage_applied": "造成伤害",
            "healing_applied": "恢复生命",
            "reward_applied": "获得奖励",
            "applied": "已生效",
        },
        "difficulty_labels": {
            "regular": "普通",
            "hard": "困难",
            "extreme": "极难",
            "opposed": "对抗",
            "combined": "联合",
            "sanity": "理智",
            "damage": "伤害",
            "reward": "奖励",
        },
        "raw_payload_fallback": False,
    },
    "en-US": {
        "language": "en-US",
        "display_name": "English",
        "output_instruction": "Use English for player-visible narration, table dialogue, recaps, and reports.",
        "name_policy": "Use customary English names and established scenario terminology.",
        "term_policy": "Use localized_terms.en-US for player-visible aliases and skill display names when the source term needs an English table form.",
        "report_labels": BASE_REPORT_LABELS,
        "report_heading_labels": BASE_REPORT_HEADING_LABELS,
        "report_field_labels": BASE_REPORT_FIELD_LABELS,
        "report_value_labels": BASE_REPORT_VALUE_LABELS,
        "character_dossier_labels": BASE_CHARACTER_DOSSIER_LABELS,
        "creation_labels": BASE_CREATION_LABELS,
        "chronicle_labels": BASE_CHRONICLE_LABELS,
        "feedback_labels": BASE_FEEDBACK_LABELS,
        "chase_tracker_labels": BASE_CHASE_TRACKER_LABELS,
        "empty_report_lines": BASE_EMPTY_REPORT_LINES,
        "speaker_labels": BASE_SPEAKER_LABELS,
        "transcript_labels": BASE_TRANSCRIPT_LABELS,
        "transcript_mode_labels": BASE_TRANSCRIPT_MODE_LABELS,
        "outcome_labels": {},
        "difficulty_labels": {},
        "raw_payload_fallback": True,
    },
    "ja-JP": {
        "language": "ja-JP",
        "display_name": "Japanese",
        "output_instruction": "Use Japanese for player-visible narration, table dialogue, recaps, and reports.",
        "name_policy": "Foreign names should use customary Japanese katakana forms or established translated names.",
        "term_policy": "Use localized_terms.ja-JP for people, places, factions, handouts, campaign titles, scenario titles, player-visible module source labels, player-visible skill display names, and special terms.",
        "report_labels": {
            "roll_sentence": "- {skill}：{actor}は {roll} / {target} を振り、結果は{outcome}。",
            "die_roll_sentence": "- {skill}：{actor}は {die} = {roll}（{breakdown}）を振り、結果は{outcome}。",
            "die_face": "出目",
            "fixed_modifier": "固定修正",
            "roll_breakdown_separator": "；",
            "difficulty": "難易度",
            "goal": "目的",
            "difficulty_rationale": "難易度の理由",
            "failure_consequence": "失敗時の結果",
            "pushed_roll": "プッシュロール",
            "push_justification": "プッシュ理由",
            "foreshadowed_failure": "失敗予告",
            "skill_check_earned": "成長チェック",
            "san_loss": "SAN 喪失",
            "san_change": "SAN 変化",
            "rule_refs": "ルール参照",
            "yes": "はい",
            "no": "いいえ",
            "localized_terms_summary": "{count} 件（playtest.json に記録）",
            "feedback_line": "- {category} {score}/5：{voice}：「{text}」",
            "feedback_voice_default": "プレイヤー感想",
            "feedback_voice_profile": "{profile}の感想",
        },
        "report_heading_labels": {
            "Battle Report": "プレイ報告",
            "Run Setup": "実行設定",
            "Module": "シナリオ",
            "Handouts": "ハンドアウト",
            "Investigator Creation": "探索者作成記録",
            "Character Dossier": "キャラクター記録",
            "Final Recorded State": "最終記録状態",
            "Investigator Chronicle": "探索者履歴",
            "Scene-by-Scene Replay": "シーン別リプレイ",
            "Actual Play Replay": "実プレイリプレイ",
            "Session Transcript": "セッション記録",
            "Major Player Decisions": "主なプレイヤー判断",
            "Rules & Rolls Recap": "ルールとロールの要約",
            "Mechanical Log": "メカニクス記録",
            "Important Rolls": "重要なロール",
            "State Changes": "状態変化",
            "Combat Summary": "戦闘要約",
            "Chase Summary": "チェイス要約",
            "Chase Tracker": "チェイス追跡",
            "Sanity Summary": "正気度要約",
            "Clues Found": "発見した手がかり",
            "Session Ending": "セッション終了",
            "Story Recap": "物語の要約",
            "Player Feedback On KP": "KP へのプレイヤーフィードバック",
            "Localization Appendix": "ローカライズ付録",
        },
        "report_field_labels": {
            "Run ID": "実行 ID",
            "Campaign ID": "キャンペーン ID",
            "Campaign": "キャンペーン",
            "Audit Profile": "監査プロファイル",
            "Simulation Method": "シミュレーション方式",
            "Era": "時代",
            "Dice Mode": "ダイス方式",
            "Spoiler Policy": "ネタバレ方針",
            "Play Language": "プレイ言語",
            "Language Profile": "言語プロファイル",
            "Localized Terms": "ローカライズ用語",
            "Player Profile": "プレイヤープロファイル",
            "Scenario": "シナリオ",
            "Scenario ID": "シナリオ ID",
            "Source": "出典",
            "Opening Scene": "導入シーン",
        },
        "report_value_labels": {
            "baseline": "ベースラインテスト",
            "rulebook_smoke": "ルールブックスモークテスト",
            "transcript_driven_virtual_table": "トランスクリプト駆動の仮想卓",
            "codex": "Codex ダイス",
            "warn_before_reveal": "ネタバレ前に警告",
            "Simplified Chinese": "簡体字中国語",
            "English": "英語",
            "Japanese": "日本語",
            "careful_investigator": "慎重な探索者",
            "reckless_investigator": "無謀な探索者",
            "skeptical_rules_lawyer": "ルール確認型プレイヤー",
            "multi_profile_matrix": "単独プレイヤー複数スタイル分岐",
        },
        "character_dossier_labels": {
            "Player": "プレイヤー",
            "Occupation": "職業",
            "Era": "時代",
            "Characteristics": "能力値",
            "Characteristic Half/Fifth Values": "能力値半分/五分の一",
            "Derived": "派生値",
            "damage_bonus": "DB",
            "build": "ビルド",
            "Skills": "技能",
            "Skill Half/Fifth Values": "技能半分/五分の一",
            "Backstory": "バックストーリー",
            "Description": "描写",
            "Ideology/Beliefs": "思想/信念",
            "Traits Detail": "特徴詳細",
            "Significant People": "重要人物",
            "Meaningful Locations": "重要な場所",
            "Treasured Possessions": "大切な所持品",
            "Traits": "特徴",
            "Injuries & Scars": "負傷と傷跡",
            "Phobias & Manias": "恐怖症と躁症",
        },
        "creation_labels": {
            "Rulebook Source": "ルールブック出典",
            "Method": "作成方法",
            "Rulebook Steps": "ルールブック手順",
            "Characteristics": "能力値生成",
            "Characteristic Half/Fifth Values": "能力値半分/五分の一",
            "Age": "年齢",
            "Age Adjustments": "年齢調整",
            "Derived Attributes": "派生値",
            "Occupation": "職業",
            "Occupation Skill Points": "職業技能ポイント",
            "Personal Interest Skill Points": "個人的興味技能ポイント",
            "Credit Rating": "信用",
            "Rulebook Occupation Range": "ルールブック職業範囲",
            "Living Standard": "生活水準",
            "Cash": "現金",
            "Assets": "資産",
            "Spending Level": "日次無記帳限度",
            "Skill Allocation": "技能配分",
            "Skill Half/Fifth Values": "技能半分/五分の一",
            "Base": "基礎",
            "Personal Interest": "個人的興味",
            "Unallocated": "未配分",
            "Backstory": "背景",
            "Equipment": "装備",
            "Notes": "メモ",
            "standard_rulebook_chapter_3": "ルールブック第3章標準作成",
            "Call of Cthulhu Keeper Rulebook Chapter 3": "Call of Cthulhu Keeper Rulebook 第3章",
        },
        "chronicle_labels": {
            "History": "履歴",
            "Development": "成長",
            "Inventory History": "所持品履歴",
            "Final HP": "最終 HP",
            "Final SAN": "最終 SAN",
            "Notable Events": "主な出来事",
            "Unresolved Threads": "未解決の糸口",
            "Development Entry": "成長記録",
            "Development Check Earned": "成長チェック獲得",
            "Development Phase Summary": "成長フェイズ要約",
            "Status": "状態",
            "Roll": "ロール",
            "Source Kind": "ソース種別",
            "Source Event": "ソースイベント",
            "earned": "獲得済み",
            "Skill Checks Earned": "獲得した成長チェック",
            "Rewards": "報酬",
            "Permanent Changes": "恒久的な変化",
            "Carryover Notes": "引き継ぎメモ",
            "Items": "アイテム",
            "Cash": "現金",
            "Notes": "メモ",
            "pending_player_rolls": "プレイヤーの成長ロール待ち",
        },
        "feedback_labels": {
            "kp_clarity": "KP の明瞭さ",
            "rules_helpfulness": "ルール説明の有用性",
            "immersion": "没入感",
            "pacing": "進行速度",
            "fairness": "公平性",
            "agency": "主体性",
            "meta_quality": "メタ相談の質",
            "spoiler_safety": "ネタバレ安全性",
            "module_fidelity": "モジュール忠実度",
            "combat_readability": "戦闘の読みやすさ",
            "chase_readability": "チェイスの読みやすさ",
        },
        "chase_tracker_labels": {
            "Chase ID": "チェイス ID",
            "State File": "状態ファイル",
            "Status": "状態",
            "Round": "現在ラウンド",
            "DEX order": "DEX 順",
            "Participants": "参加者",
            "Location Chain": "ロケーション列",
            "Rounds": "ラウンド",
            "Outcome": "結果",
            "movement_actions": "移動アクション",
            "position": "位置",
            "round_format": "第 {round} ラウンド",
            "start": "開始地点",
            "clear": "通常地点",
            "hazard": "危険",
            "barrier": "障害",
            "escape": "逃走地点",
            "quarry": "逃走側",
            "pursuer": "追跡側",
            "resolved": "解決済み",
        },
        "empty_report_lines": {
            "combat_summary": "- 今回は戦闘場面は発生していない。",
            "combat_tracker": "- 今回は追跡する戦闘状態はない。",
            "chase_summary": "- 今回はチェイス場面は発生していない。",
            "chase_tracker": "- 今回は追跡するチェイス状態はない。",
            "sanity_summary": "- 今回は正気度判定や狂気イベントは発生していない。",
        },
        "speaker_labels": {
            "keeper": "KP",
            "player": "プレイヤー",
            "single_player": "単独プレイヤー",
            "system": "システム",
        },
        "transcript_labels": {
            "turn_format": "第 {turn} ターン",
            "mode": "モード",
            "intent": "意図",
            "ruling": "裁定",
        },
        "transcript_mode_labels": {
            "play": "プレイ",
            "roll": "ロール",
            "meta": "メタ",
        },
        "outcome_labels": {
            "critical": "クリティカル",
            "extreme_success": "イクストリーム成功",
            "hard_success": "ハード成功",
            "regular_success": "レギュラー成功",
            "success": "成功",
            "failure": "失敗",
            "fumble": "ファンブル",
            "damage_applied": "ダメージ適用",
            "healing_applied": "HP回復",
            "reward_applied": "報酬適用",
            "applied": "適用済み",
        },
        "difficulty_labels": {
            "regular": "レギュラー",
            "hard": "ハード",
            "extreme": "イクストリーム",
            "opposed": "対抗",
            "combined": "複合",
            "sanity": "正気度",
            "damage": "ダメージ",
            "reward": "報酬",
        },
        "raw_payload_fallback": True,
    },
}


# Player-facing table mechanics chrome (public rolls / deltas). Selected by
# campaign `play_language` — never assume Chinese at a non-zh table.
TABLE_MECHANICS_LABELS: dict[str, dict[str, str]] = {
    "zh-Hans": {
        "public_check_tag": "明骰",
        "change_tag": "变化",
        "first_impression_tag": "初印象",
        "first_reaction_tag": "初次反应",
        "check_fallback": "检定",
        "die_fallback": "骰值",
        "roll_kind_san_loss": "理智损失",
        "roll_kind_hp_damage": "伤害",
        "roll_kind_hp_heal": "治疗",
        "roll_kind_damage": "伤害",
        "roll_kind_healing": "治疗",
        "roll_kind_random_table": "随机结果",
        "this_person": "这名人物",
        "app": "外貌",
        "credit_rating": "信用评级",
        "using": "采用",
        "die_faces": "骰面",
        "total": "总值",
        "time": "时间",
        "minutes": "分钟",
        "elapsed_prefix": "累计",
        "time_phase": "时段",
        "phase_morning": "早上",
        "phase_afternoon": "下午",
        "phase_evening": "黄昏",
        "phase_night": "夜晚",
        "phase_unknown": "时段不明",
        "appearance_perpetual_daylight": "极昼",
        "appearance_perpetual_darkness": "极夜",
        "appearance_inverted": "昼夜颠倒",
        "appearance_distorted": "昼夜紊乱",
        "raw_roll": "原始",
        "luck": "幸运",
        "adjusted": "调整",
        "roll_word": "掷骰",
        "exceptional_tag": "特殊影响",
        "cause": "因果",
        "opportunity_friction": "当下机会/摩擦",
        "boundary_still": "边界仍在",
        "current_cash": "当前现金",
        "current_assets": "当前资产",
        "creation_cash": "建卡现金",
        "creation_assets": "建卡资产",
        "creation_living_standard": "建卡生活水平",
        "creation_credit_rating": "建卡信用评级",
        "creation_finance": "建卡财力",
        "living_standard": "生活水平",
        "spending_level": "每日免记账额度",
        "cash_kind": "现金",
        "assets_kind": "资产",
        "purchase_kind": "购入",
        "liquidate_kind": "变现",
        "cash_unchanged": "现金未变",
        "time_word": "时间",
        "credit_rating_source": "信用评级换算",
        "cash_empty_ledger": "暂无流水。",
        "cash_no_record": "尚无现金记录。",
        "cash_no_reason": "未提供说明",
        "item_column": "项目",
        "value_column": "数值",
        "pair_sep": "：",
        "reason_sep": "；",
        "cash_delta": "{kind}：{sign}{amount} {currency}（{before} → {after}）",
        "purchase_spending_delta": "{kind}：「{label}」（{spending_level} {amount} {currency}；{cash_unchanged} {after}）",
        "purchase_cash_delta": "{kind}：「{label}」（-{charged} {currency}，{before} → {after}）",
        "liquidate_delta": "{kind}：{assets_word} {assets_before} → {assets_after}；{cash_kind} +{amount} {currency}（{cash_before} → {cash_after}）；{time_word} {linked}",
        "living_Penniless": "赤贫",
        "living_Poor": "贫穷",
        "living_Average": "普通",
        "living_Wealthy": "富裕",
        "living_Rich": "富有",
        "living_Super_Rich": "超级富豪",
    },
    "en-US": {
        "public_check_tag": "Public roll",
        "change_tag": "Change",
        "first_impression_tag": "First impression",
        "first_reaction_tag": "First reaction",
        "check_fallback": "Check",
        "die_fallback": "Die",
        "roll_kind_san_loss": "SAN loss",
        "roll_kind_hp_damage": "HP damage",
        "roll_kind_hp_heal": "HP healing",
        "roll_kind_damage": "Damage",
        "roll_kind_healing": "Healing",
        "roll_kind_random_table": "Random result",
        "this_person": "this person",
        "app": "APP",
        "credit_rating": "Credit Rating",
        "using": "using",
        "die_faces": "faces",
        "total": "total",
        "time": "time",
        "minutes": "min",
        "elapsed_prefix": "elapsed",
        "time_phase": "time of day",
        "phase_morning": "morning",
        "phase_afternoon": "afternoon",
        "phase_evening": "evening",
        "phase_night": "night",
        "phase_unknown": "unknown time of day",
        "appearance_perpetual_daylight": "perpetual daylight",
        "appearance_perpetual_darkness": "perpetual darkness",
        "appearance_inverted": "inverted day and night",
        "appearance_distorted": "distorted day and night",
        "raw_roll": "raw",
        "luck": "Luck",
        "adjusted": "adjusted",
        "roll_word": "roll",
        "exceptional_tag": "Exceptional",
        "cause": "cause",
        "opportunity_friction": "opportunity/friction",
        "boundary_still": "boundary held",
        "current_cash": "Current cash",
        "current_assets": "Current Assets",
        "creation_cash": "Creation cash",
        "creation_assets": "Creation Assets",
        "creation_living_standard": "Creation living standard",
        "creation_credit_rating": "Creation Credit Rating",
        "creation_finance": "Creation finance",
        "living_standard": "Living standard",
        "spending_level": "Daily unbooked allowance",
        "cash_kind": "cash",
        "assets_kind": "Assets",
        "purchase_kind": "purchase",
        "liquidate_kind": "assets",
        "cash_unchanged": "cash unchanged",
        "time_word": "time",
        "credit_rating_source": "Credit Rating",
        "cash_empty_ledger": "No ledger rows.",
        "cash_no_record": "No cash recorded yet.",
        "cash_no_reason": "No reason given",
        "item_column": "Item",
        "value_column": "Value",
        "pair_sep": ": ",
        "reason_sep": "; ",
        "cash_delta": "{kind}: {sign}{amount} {currency} ({before} → {after})",
        "purchase_spending_delta": "{kind}: “{label}” ({spending_level} {amount} {currency}; {cash_unchanged} {after})",
        "purchase_cash_delta": "{kind}: “{label}” (-{charged} {currency}, {before} → {after})",
        "liquidate_delta": "{kind}: {assets_word} {assets_before} → {assets_after}; {cash_kind} +{amount} {currency} ({cash_before} → {cash_after}); {time_word} {linked}",
        "living_Penniless": "Penniless",
        "living_Poor": "Poor",
        "living_Average": "Average",
        "living_Wealthy": "Wealthy",
        "living_Rich": "Rich",
        "living_Super_Rich": "Super Rich",
    },
    "ja-JP": {
        "public_check_tag": "公開ロール",
        "change_tag": "変化",
        "first_impression_tag": "第一印象",
        "first_reaction_tag": "初回反応",
        "check_fallback": "判定",
        "die_fallback": "出目",
        "roll_kind_san_loss": "正気度喪失",
        "roll_kind_hp_damage": "ダメージ",
        "roll_kind_hp_heal": "HP回復",
        "roll_kind_damage": "ダメージ",
        "roll_kind_healing": "回復",
        "roll_kind_random_table": "ランダム結果",
        "this_person": "この人物",
        "app": "外貌",
        "credit_rating": "信用",
        "using": "採用",
        "die_faces": "出目",
        "total": "合計",
        "time": "時間",
        "minutes": "分",
        "elapsed_prefix": "累計",
        "time_phase": "時間帯",
        "phase_morning": "朝",
        "phase_afternoon": "午後",
        "phase_evening": "夕暮れ",
        "phase_night": "夜",
        "phase_unknown": "時間帯不明",
        "appearance_perpetual_daylight": "白夜",
        "appearance_perpetual_darkness": "極夜",
        "appearance_inverted": "昼夜逆転",
        "appearance_distorted": "昼夜の乱れ",
        "raw_roll": "生出目",
        "luck": "幸運",
        "adjusted": "調整後",
        "roll_word": "ロール",
        "exceptional_tag": "特殊効果",
        "cause": "因果",
        "opportunity_friction": "機会/摩擦",
        "boundary_still": "境界は維持",
        "current_cash": "現在の現金",
        "current_assets": "現在の資産",
        "creation_cash": "作成時の現金",
        "creation_assets": "作成時の資産",
        "creation_living_standard": "作成時の生活水準",
        "creation_credit_rating": "作成時の信用",
        "creation_finance": "作成時の財力",
        "living_standard": "生活水準",
        "spending_level": "日次無記帳限度",
        "cash_kind": "現金",
        "assets_kind": "資産",
        "purchase_kind": "購入",
        "liquidate_kind": "資産換金",
        "cash_unchanged": "現金は変わらず",
        "time_word": "時間",
        "credit_rating_source": "信用換算",
        "cash_empty_ledger": "明細はまだありません。",
        "cash_no_record": "現金の記録はまだありません。",
        "cash_no_reason": "理由なし",
        "item_column": "項目",
        "value_column": "数値",
        "pair_sep": "：",
        "reason_sep": "；",
        "cash_delta": "{kind}：{sign}{amount} {currency}（{before} → {after}）",
        "purchase_spending_delta": "{kind}：「{label}」（{spending_level} {amount} {currency}；{cash_unchanged} {after}）",
        "purchase_cash_delta": "{kind}：「{label}」（-{charged} {currency}，{before} → {after}）",
        "liquidate_delta": "{kind}：{assets_word} {assets_before} → {assets_after}；{cash_kind} +{amount} {currency}（{cash_before} → {cash_after}）；{time_word} {linked}",
        "living_Penniless": "無一文",
        "living_Poor": "貧困",
        "living_Average": "平均",
        "living_Wealthy": "富裕",
        "living_Rich": "富豪",
        "living_Super_Rich": "超富豪",
    },
}


DEFAULT_LOCALIZED_TERMS_PATH = SCRIPT_DIR / "default_localized_terms.json"


def _load_default_localized_terms() -> dict[str, dict[str, str]]:
    raw = json.loads(DEFAULT_LOCALIZED_TERMS_PATH.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        return {}
    loaded: dict[str, dict[str, str]] = {}
    for language, terms in raw.items():
        if not isinstance(language, str) or not isinstance(terms, dict):
            continue
        cleaned: dict[str, str] = {}
        for key, label in terms.items():
            if isinstance(key, str) and key and isinstance(label, str) and label.strip():
                cleaned[key] = label
        loaded[language] = cleaned
    return loaded


DEFAULT_LOCALIZED_TERMS: dict[str, dict[str, str]] = _load_default_localized_terms()


def default_localized_terms(play_language: str | None = None) -> dict[str, str]:
    """Built-in table vocabulary; run metadata may override any entry.

    Canonical skill/characteristic keys stay machine-facing. This map only
    supplies player-facing display strings for the active `play_language`.
    Languages without a dedicated map return {} so callers keep the
    canonical English key rather than inventing Chinese.
    """
    return deepcopy(DEFAULT_LOCALIZED_TERMS.get(play_language or DEFAULT_PLAY_LANGUAGE, {}))


def resolved_localized_terms(
    play_language: str | None = None,
    campaign: dict[str, Any] | None = None,
) -> dict[str, str]:
    """Default table vocabulary plus campaign overrides for play_language."""
    language = play_language or DEFAULT_PLAY_LANGUAGE
    terms = default_localized_terms(language)
    extra = None
    if isinstance(campaign, dict):
        localized = campaign.get("localized_terms")
        if isinstance(localized, dict):
            extra = localized.get(language)
    if isinstance(extra, dict):
        for key, label in extra.items():
            if isinstance(key, str) and key and isinstance(label, str) and label.strip():
                terms[key] = label
    return terms


def player_facing_display_name(
    value: Any,
    play_language: str | None = None,
    campaign: dict[str, Any] | None = None,
    *,
    terms: dict[str, str] | None = None,
) -> str:
    """Localize a player-facing person/place name with the merged term map."""
    vocabulary = terms if terms is not None else resolved_localized_terms(
        play_language, campaign
    )
    return localize_terms(value, vocabulary)


def table_mechanics_labels(play_language: str | None = None) -> dict[str, str]:
    """Chrome labels for public rolls / state deltas in the play language."""
    language = play_language or DEFAULT_PLAY_LANGUAGE
    if language in TABLE_MECHANICS_LABELS:
        return deepcopy(TABLE_MECHANICS_LABELS[language])
    # Unknown language: English chrome, not Chinese.
    return deepcopy(TABLE_MECHANICS_LABELS["en-US"])


def living_standard_label(value: str, play_language: str | None = None) -> str:
    """Player-facing living-standard name for the active play language."""
    text = str(value or "").strip()
    if not text:
        return ""
    chrome = table_mechanics_labels(play_language)
    mapped = chrome.get("living_" + text.replace(" ", "_"))
    if isinstance(mapped, str) and mapped.strip():
        return mapped
    return text


def player_time_label(
    player_time: dict[str, Any] | None,
    play_language: str | None = None,
) -> str:
    """Render a broad time/light label without exposing exact clock values."""
    chrome = table_mechanics_labels(play_language)
    projection = player_time if isinstance(player_time, dict) else {}
    custom = str(projection.get("display_label") or "").strip()
    if custom:
        return custom
    mode = str(projection.get("appearance_mode") or "normal")
    if mode != "normal":
        return chrome.get(f"appearance_{mode}", chrome["phase_unknown"])
    phase = str(projection.get("phase") or "unknown")
    return chrome.get(f"phase_{phase}", chrome["phase_unknown"])


def player_facing_skill_label(
    skill: str,
    play_language: str | None = None,
    *,
    terms: dict[str, str] | None = None,
) -> str:
    """Map a canonical skill key to a player-facing label for play_language."""
    vocabulary = terms if terms is not None else default_localized_terms(play_language)
    label = vocabulary.get(skill)
    if isinstance(label, str) and label.strip():
        return label
    language_name, is_own = _language_name_from_skill_key(skill)
    is_language_skill = str(skill).startswith(
        ("Language (", "Other Language (")
    )
    language = play_language or DEFAULT_PLAY_LANGUAGE
    if is_language_skill and language in {"zh-Hans", "ja-JP"}:
        normalized_name = _normalize_language_name(language_name)
        localized_name = _LANGUAGE_DISPLAY_NAMES.get(language, {}).get(
            normalized_name
        )
        if language == "zh-Hans":
            group_label = "母语" if is_own else "外语"
            return (
                f"{group_label}（{localized_name}）"
                if localized_name
                else group_label
            )
        group_label = "母国語" if is_own else "外国語"
        return (
            f"{group_label}（{localized_name}）"
            if localized_name
            else group_label
        )
    # en-US and unmapped languages: keep the canonical key as the table form.
    return skill


def _ascii_term_key(canonical_text: str) -> bool:
    return bool(canonical_text) and all(ord(char) < 128 for char in canonical_text)


def localize_terms(value: Any, terms: dict[str, str]) -> str:
    """Apply table vocabulary with ASCII word/id boundaries for Latin proper names."""
    localized = str(value)
    for canonical, replacement in sorted(
        terms.items(),
        key=lambda item: len(str(item[0])),
        reverse=True,
    ):
        canonical_text = str(canonical)
        replacement_text = str(replacement)
        if (
            canonical_text in BOUNDARY_SAFE_ASCII_TERMS
            or _ascii_term_key(canonical_text)
        ):
            # Hyphen/underscore keep roll_id and machine tokens intact.
            pattern = re.compile(
                rf"(?<![A-Za-z0-9_-]){re.escape(canonical_text)}(?![A-Za-z0-9_-])"
            )
            localized = pattern.sub(lambda _match: replacement_text, localized)
        else:
            localized = localized.replace(canonical_text, replacement_text)
    return localized


def language_profile(play_language: str | None = None) -> dict[str, Any]:
    language = play_language or DEFAULT_PLAY_LANGUAGE
    if language in LANGUAGE_PROFILES:
        return deepcopy(LANGUAGE_PROFILES[language])
    profile = deepcopy(LANGUAGE_PROFILES["en-US"])
    profile.update({
        "language": language,
        "display_name": language,
        "output_instruction": f"Use {language} for player-visible narration, table dialogue, recaps, and reports.",
        "name_policy": f"Use customary {language} forms for names and setting terms when available.",
        "term_policy": f"Use localized_terms.{language} for player-visible people, places, factions, handouts, campaign titles, scenario titles, player-visible module source labels, player-visible skill display names, and special terms.",
    })
    profile["empty_report_lines"] = deepcopy(BASE_EMPTY_REPORT_LINES)
    profile["speaker_labels"] = deepcopy(BASE_SPEAKER_LABELS)
    profile["transcript_mode_labels"] = deepcopy(BASE_TRANSCRIPT_MODE_LABELS)
    profile["report_heading_labels"] = deepcopy(BASE_REPORT_HEADING_LABELS)
    profile["report_field_labels"] = deepcopy(BASE_REPORT_FIELD_LABELS)
    profile["report_value_labels"] = deepcopy(BASE_REPORT_VALUE_LABELS)
    profile["character_dossier_labels"] = deepcopy(BASE_CHARACTER_DOSSIER_LABELS)
    profile["creation_labels"] = deepcopy(BASE_CREATION_LABELS)
    profile["chronicle_labels"] = deepcopy(BASE_CHRONICLE_LABELS)
    profile["feedback_labels"] = deepcopy(BASE_FEEDBACK_LABELS)
    profile["chase_tracker_labels"] = deepcopy(BASE_CHASE_TRACKER_LABELS)
    return profile
