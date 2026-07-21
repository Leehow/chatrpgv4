#!/usr/bin/env python3
"""Player-intent parser for free-text — Semantic Matcher Constitution compliant.

Extracts a rich intent structure from what a player types so the Story
Director (and other consumers) receive more than a single intent class.
Supports 中英文.

**Compliance note — Semantic Matcher Constitution**
(see the "Semantic Matcher Constitution" section of `AGENTS.md`; the retired
spec text is archived in `docs/status/DIAGNOSIS-LEDGER.md`): the COC Keeper
plugin must not judge *what human-language text means* (including player
intent) by keyword hits or fixed prose fragments. Any such judgment must be
routed through an LLM semantic evaluator and must record the evaluator id
plus reasons. This module therefore does NOT do keyword matching for intent
classification; it delegates the semantic judgment to an ``IntentEvaluator``
(Protocol). The default implementation, ``LLMIntentEvaluator``, is a
file-mediated LLM evaluator with a request/result artifact contract (write
request → external LLM → read result, with provenance + request_sha256).
Offline tests inject a fixture
evaluator, as the Constitution explicitly permits
("Offline deterministic tests may inject a fixture evaluator").

Only machine-controlled signals use exact matching here, per the
Constitution carve-out for structured enums and explicit machine markers:
empty/None text → ``idle`` (enum), and a
leading ``[`` → ``meta`` (machine out-of-fiction marker). Everything that
depends on the *meaning* of the text is routed through the evaluator.

The Story Director still accepts the legacy ``player_intent_class`` string
directly (backward compatible); this router is an OPTIONAL enrichment layer
for callers that want to surface secondary intents, target entities, risk
posture, exact time-category detail, explicit roll requests and player
hypotheses before directing.

Public API:
    parse_intent(player_text, active_scene=None) -> dict
    set_intent_evaluator(evaluator)              # tests install a fixture
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Protocol

_SCRIPT_DIR = Path(__file__).resolve().parent


def _load_sibling(name: str, filename: str):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, _SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_rulesets = _load_sibling("coc_rulesets_intent_router", "coc_rulesets.py")


# ---------------------------------------------------------------------------
# Artifact contract for semantic intent evaluation
# ---------------------------------------------------------------------------

LLM_INTENT_EVALUATOR_ID = "codex-llm-semantic-v1"
INTENT_EVAL_REQUEST = "intent-eval-request.json"
INTENT_EVAL_RESULT = "intent-eval-result.json"

# Directory where the file-mediated LLM exchanges request/result artifacts.
# Defaults to a sibling ``.intent-eval/`` next to this script; overridable via
# ``LLMIntentEvaluator(artifacts_dir=...)`` in tests or integrations.
_DEFAULT_ARTIFACTS_DIR = Path(__file__).resolve().parent / ".intent-eval"

# The canonical primary_intent enum (machine-controlled vocabulary).
# Includes the director-specific classes (ambiguous/montage/cast) so the
# router can feed the director's _base_score without making any action
# branch unreachable.
_PRIMARY_INTENT_ENUM = (
    "investigate", "social", "move", "combat", "flee", "meta", "stuck", "idle",
    "ambiguous", "montage", "cast",
)


def _load_time_category_enum() -> tuple[str, ...]:
    """Load exact structured time categories from the canonical rule catalog."""
    path = (
        coc_rulesets.ruleset_data_dir(coc_rulesets.DEFAULT_RULESET_ID)
        / "time-costs.json"
    )
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ()
    categories = payload.get("categories") if isinstance(payload, dict) else None
    if not isinstance(categories, dict):
        return ()
    return tuple(str(category) for category in categories)


_TIME_CATEGORY_ENUM = _load_time_category_enum()


def _json_sha256(payload: Any) -> str:
    """SHA-256 of the canonical JSON encoding (sort_keys, tight separators).

    A result's ``request_sha256`` is verified against its exact request.
    """
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


# ---------------------------------------------------------------------------
# IntentEvaluator Protocol
# ---------------------------------------------------------------------------

class IntentEvaluator(Protocol):
    """A semantic evaluator that classifies a single player utterance.

    Implementations decide intent by what the text *means*, not by keyword
    presence. The default implementation (``LLMIntentEvaluator``) is a
    file-mediated LLM; tests install a fixture via ``set_intent_evaluator``.
    """

    evaluator_id: str

    def classify(self, player_text: str, active_scene: dict | None) -> dict[str, Any]:
        ...


# ---------------------------------------------------------------------------
# Default LLM implementation (file-mediated, never in-process keyword match)
# ---------------------------------------------------------------------------

class IntentEvalError(RuntimeError):
    """Raised when an LLM intent result is missing or fails provenance/schema.

    Per the Semantic Matcher Constitution, a missing result is treated as
    missing semantic evidence — never as permission to fall back to keyword
    matching.
    """


class LLMIntentEvaluator:
    """File-mediated LLM intent evaluator.

    Writes an ``intent-eval-request.json`` describing the judgment the LLM
    must make (with the Constitution embedded), then expects an external LLM
    (e.g. Codex) to read it and write ``intent-eval-result.json`` carrying
    ``evaluator_id``, ``evaluation_provenance`` (with a matching
    ``request_sha256``), the structured intent fields, and per-field ``reasons``.
    The request/result pair is bound by canonical SHA-256 provenance.
    """

    evaluator_id = LLM_INTENT_EVALUATOR_ID

    def __init__(self, artifacts_dir: Path | None = None) -> None:
        self.artifacts_dir = Path(artifacts_dir) if artifacts_dir else _DEFAULT_ARTIFACTS_DIR

    def classify(self, player_text: str, active_scene: dict | None) -> dict[str, Any]:
        request = self._build_request(player_text, active_scene)
        request_path = self._write_request(request)
        result = self._read_result(request, request_path)
        return self._parse_result(result)

    # -- request side ------------------------------------------------------

    def _build_request(self, player_text: str, active_scene: dict | None) -> dict[str, Any]:
        return {
            "schema_version": 1,
            "kind": "coc_player_intent_request",
            "constitution": {
                "title": "Semantic Matcher Constitution",
                "forbidden_methods": [
                    "keyword_hits",
                    "literal_headings",
                    "fixed_prose_fragments",
                ],
                "requirement": (
                    "Classify the player's intent by what the text MEANS, not by "
                    "whether particular keywords appear. For example, '打电话' "
                    "(make a phone call) is social/utility, NOT combat despite "
                    "the character '打'; '离开房间' (leave a room) is movement, "
                    "NOT flee. Provide a non-empty reason for primary_intent. "
                    "When intent_detail is present, choose one exact time-category "
                    "enum and provide reasons.intent_detail; never emit free prose "
                    "as a time category."
                ),
                "reference": "AGENTS.md — Semantic Matcher Constitution",
            },
            "player_text": player_text,
            "active_scene": active_scene,
            "expected_output_schema": {
                "required": [
                    "evaluator_id",
                    "evaluation_provenance",
                    "primary_intent",
                    "secondary_intents",
                    "target_entities",
                    "risk_posture",
                    "explicit_roll_request",
                    "player_hypothesis",
                    "action_atoms",
                    "reasons",
                ],
                "primary_intent_enum": list(_PRIMARY_INTENT_ENUM),
                "risk_posture_enum": ["cautious", "neutral", "reckless"],
                "optional": ["intent_detail", "npc_interactions"],
                "npc_interaction_schema": {
                    "required": ["npc_id", "tactic", "request_id"],
                    "tactic_enum": [
                        "build_rapport", "intimidate", "deceive", "reassure",
                        "request_fact", "offer_leverage",
                    ],
                    "optional": ["fact_id", "leverage_id", "skill", "difficulty"],
                },
                "intent_detail_enum": list(_TIME_CATEGORY_ENUM),
                "evaluation_provenance": {
                    "kind": "llm",
                    "request_sha256": "<sha256 of canonical JSON of this request>",
                    "reviewed_artifact": INTENT_EVAL_REQUEST,
                },
            },
        }

    def _write_request(self, request: dict[str, Any]) -> Path:
        self.artifacts_dir.mkdir(parents=True, exist_ok=True)
        request_path = self.artifacts_dir / INTENT_EVAL_REQUEST
        with request_path.open("w", encoding="utf-8") as handle:
            json.dump(request, handle, ensure_ascii=False, indent=2)
        return request_path

    # -- result side -------------------------------------------------------

    def _read_result(self, request: dict[str, Any], request_path: Path) -> dict[str, Any]:
        result_path = self.artifacts_dir / INTENT_EVAL_RESULT
        if not result_path.exists():
            raise IntentEvalError(
                f"missing_intent_eval_result: {result_path} not found. The LLM "
                "evaluator must read the request and write the result; do not "
                "fall back to keyword matching (Semantic Matcher Constitution)."
            )
        try:
            result = json.loads(result_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise IntentEvalError(f"intent_eval_result_invalid_json: {exc}") from exc

        errors = self._validate_result(result, request)
        if errors:
            raise IntentEvalError(
                "intent_eval_result_schema_invalid: " + "; ".join(errors)
            )
        return result

    def _validate_result(self, result: dict[str, Any], request: dict[str, Any]) -> list[str]:
        errors: list[str] = []
        expected_sha = _json_sha256(request)

        if result.get("evaluator_id") != self.evaluator_id:
            errors.append(
                f"evaluator_id mismatch: expected {self.evaluator_id!r}, "
                f"got {result.get('evaluator_id')!r}"
            )

        provenance = result.get("evaluation_provenance") or {}
        if provenance.get("kind") != "llm":
            errors.append(
                f"evaluation_provenance.kind must be 'llm', got {provenance.get('kind')!r}"
            )
        if provenance.get("request_sha256") != expected_sha:
            errors.append(
                "evaluation_provenance.request_sha256 mismatch: result was not "
                "produced from this exact request (stale or mismatched artifact)."
            )

        primary = result.get("primary_intent")
        if primary not in _PRIMARY_INTENT_ENUM:
            errors.append(
                f"primary_intent {primary!r} not in allowed enum {_PRIMARY_INTENT_ENUM}"
            )

        reasons = result.get("reasons")
        if not isinstance(reasons, dict) or not reasons.get("primary_intent"):
            errors.append("reasons.primary_intent must be a non-empty string")
        intent_detail = result.get("intent_detail")
        if intent_detail is not None:
            if intent_detail not in _TIME_CATEGORY_ENUM:
                errors.append(
                    f"intent_detail {intent_detail!r} not in time category enum "
                    f"{_TIME_CATEGORY_ENUM}"
                )
            if not isinstance(reasons, dict) or not reasons.get("intent_detail"):
                errors.append(
                    "reasons.intent_detail must be a non-empty string when "
                    "intent_detail is present"
                )
        return errors

    def _parse_result(self, result: dict[str, Any]) -> dict[str, Any]:
        # The result already passed schema validation; surface the rich
        # contract fields consumed by the director and enrichment layers.
        parsed = {
            "primary_intent": result["primary_intent"],
            "secondary_intents": list(result.get("secondary_intents") or []),
            "target_entities": list(result.get("target_entities") or []),
            "risk_posture": result.get("risk_posture", "neutral"),
            "explicit_roll_request": bool(result.get("explicit_roll_request", False)),
            "player_hypothesis": result.get("player_hypothesis"),
            "action_atoms": [a for a in (result.get("action_atoms") or []) if isinstance(a, dict)],
            "npc_interactions": _normalize_npc_interactions(result.get("npc_interactions")),
        }
        if result.get("intent_detail") in _TIME_CATEGORY_ENUM:
            parsed["intent_detail"] = result["intent_detail"]
        return parsed


# ---------------------------------------------------------------------------
# parse_intent entry point (Protocol injection + machine-marker carve-out)
# ---------------------------------------------------------------------------

_DEFAULT_EVALUATOR: IntentEvaluator | None = None


def set_intent_evaluator(evaluator: IntentEvaluator | None) -> None:
    """Install (or clear) the process-wide intent evaluator.

    Offline tests inject a fixture evaluator here (the Constitution permits
    fixture evaluators for deterministic tests). Passing ``None`` restores the
    default ``LLMIntentEvaluator``.
    """
    global _DEFAULT_EVALUATOR
    _DEFAULT_EVALUATOR = evaluator


def parse_intent(
    player_text: str | None,
    active_scene: dict | None = None,
    *,
    evaluator: IntentEvaluator | None = None,
) -> dict:
    """Parse player text into a structured intent.

    Args:
        player_text: Raw player free-text (中英文 mixed ok).
        active_scene: Optional scene dict; passed through to the evaluator,
            which may use ``available_clues`` / ``npc_ids`` to anchor targets.
        evaluator: Optional per-call evaluator. When omitted, the process-wide
            evaluator installed via ``set_intent_evaluator`` is used, falling
            back to the default file-mediated ``LLMIntentEvaluator``.

    Returns:
        {
            "primary_intent": "investigate|social|move|combat|flee|meta|stuck|idle",
            "secondary_intents": list[str],   # e.g. ["avoid_risk", "social_followup"]
            "target_entities": list[str],     # e.g. ["backyard", "window", "neighbor"]
            "risk_posture": "cautious|neutral|reckless",
            "explicit_roll_request": bool,
            "player_hypothesis": str | None,
            "action_atoms": list[dict],
            "intent_detail": str | None,  # exact time-cost category; optional
        }

    Machine-controlled signals (no semantic judgment, Constitution carve-out):
        - None/empty text → ``idle``
        - leading ``[`` → ``meta`` (out-of-fiction command marker)
    Everything else is delegated to the ``IntentEvaluator``.
    """
    text = player_text or ""

    # Enum-level machine signal: no text means the player is idle. This does
    # not depend on what any text means, so it is an allowed exact match.
    if not text.strip():
        return _idle_result()

    # Machine marker: a leading '[' is the conventional out-of-fiction command
    # bracket (e.g. "[meta] ..."). This is a structural/system marker, not a
    # natural-language judgment, so it is an allowed exact match.
    if text.lstrip().startswith("["):
        return _meta_result()

    chosen = evaluator or _DEFAULT_EVALUATOR or LLMIntentEvaluator()
    return _normalize_evaluator_result(chosen.classify(text, active_scene))


def _normalize_evaluator_result(result: dict[str, Any]) -> dict[str, Any]:
    """Fail closed on optional structured fields from injected evaluators."""
    normalized = dict(result)
    normalized["npc_interactions"] = _normalize_npc_interactions(
        normalized.get("npc_interactions")
    )
    intent_detail = normalized.get("intent_detail")
    if intent_detail is not None and intent_detail not in _TIME_CATEGORY_ENUM:
        normalized.pop("intent_detail", None)
        warnings = list(normalized.get("normalization_warnings") or [])
        warnings.append({
            "field": "intent_detail",
            "reason_code": "not_in_time_cost_category_enum",
        })
        normalized["normalization_warnings"] = warnings
    return normalized


_NPC_TACTICS = frozenset({
    "build_rapport", "intimidate", "deceive", "reassure",
    "request_fact", "offer_leverage",
})


def _normalize_npc_interactions(value: Any) -> list[dict[str, Any]]:
    """Closed-schema semantic output; never infer omitted fields from prose."""
    normalized: list[dict[str, Any]] = []
    for item in value or []:
        if not isinstance(item, dict):
            continue
        npc_id = item.get("npc_id")
        tactic = item.get("tactic")
        request_id = item.get("request_id")
        if tactic not in _NPC_TACTICS or not isinstance(request_id, str) or not request_id.strip():
            continue
        row = {
            "npc_id": str(npc_id).strip() if isinstance(npc_id, str) else "",
            "tactic": tactic,
            "request_id": request_id.strip(),
        }
        for key in ("fact_id", "leverage_id", "skill"):
            if isinstance(item.get(key), str) and item[key].strip():
                row[key] = item[key].strip()
        if item.get("difficulty") in {"regular", "hard", "extreme"}:
            row["difficulty"] = item["difficulty"]
        normalized.append(row)
    return normalized


def _idle_result() -> dict[str, Any]:
    return {
        "primary_intent": "idle",
        "secondary_intents": [],
        "target_entities": [],
        "risk_posture": "neutral",
        "explicit_roll_request": False,
        "player_hypothesis": None,
        "action_atoms": [],
        "npc_interactions": [],
    }


def _meta_result() -> dict[str, Any]:
    return {
        "primary_intent": "meta",
        "secondary_intents": [],
        "target_entities": [],
        "risk_posture": "neutral",
        "explicit_roll_request": False,
        "player_hypothesis": None,
        "action_atoms": [],
        "npc_interactions": [],
    }
