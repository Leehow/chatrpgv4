#!/usr/bin/env python3
"""Player-intent parser for free-text — Semantic Matcher Constitution compliant.

Extracts a rich intent structure from what a player types so the Story
Director (and other consumers) receive more than a single intent class.
Supports 中英文.

**Compliance note — Semantic Matcher Constitution**
(docs/superpowers/specs/2026-07-03-coc-keeper-design.md:541): the COC Keeper
plugin must not judge *what human-language text means* (including player
intent) by keyword hits or fixed prose fragments. Any such judgment must be
routed through an LLM semantic evaluator and must record the evaluator id
plus reasons. This module therefore does NOT do keyword matching for intent
classification; it delegates the semantic judgment to an ``IntentEvaluator``
(Protocol). The default implementation, ``LLMIntentEvaluator``, is a
file-mediated LLM evaluator that mirrors the existing semantic-eval artifact
contract in ``coc_playtest_suite.py`` (write request → external LLM → read
result, with provenance + request_sha256). Offline tests inject a fixture
evaluator, as the Constitution explicitly permits
("Offline deterministic tests may inject a fixture evaluator").

Only machine-controlled signals use exact matching here, per the
Constitution carve-out (line 543): empty/None text → ``idle`` (enum), and a
leading ``[`` → ``meta`` (machine out-of-fiction marker). Everything that
depends on the *meaning* of the text is routed through the evaluator.

The Story Director still accepts the legacy ``player_intent_class`` string
directly (backward compatible); this router is an OPTIONAL enrichment layer
for callers that want to surface secondary intents, target entities, risk
posture, explicit roll requests and player hypotheses before directing.

Public API:
    parse_intent(player_text, active_scene=None) -> dict
    set_intent_evaluator(evaluator)              # tests install a fixture
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Protocol


# ---------------------------------------------------------------------------
# Artifact contract (mirrors coc_playtest_suite.py semantic-eval conventions)
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
    "investigate", "social", "combat", "flee", "meta", "stuck", "idle",
    "ambiguous", "montage", "cast",
)


def _json_sha256(payload: Any) -> str:
    """SHA-256 of the canonical JSON encoding (sort_keys, tight separators).

    Mirrors ``coc_playtest_suite.py``'s provenance hash so a result's
    ``request_sha256`` can be verified against the request that produced it.
    """
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


# ---------------------------------------------------------------------------
# IntentEvaluator Protocol (mirrors coc_playtest_suite.CoverageEvaluator)
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
    ``request_sha256``), the six intent fields, and per-field ``reasons``.
    This mirrors the request/result contract in ``coc_playtest_suite.py``.
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
                    "NOT flee. Provide a non-empty reason for primary_intent."
                ),
                "reference": "docs/superpowers/specs/2026-07-03-coc-keeper-design.md:541",
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
        return errors

    def _parse_result(self, result: dict[str, Any]) -> dict[str, Any]:
        # The result already passed schema validation; surface the rich
        # contract fields consumed by the director and enrichment layers.
        return {
            "primary_intent": result["primary_intent"],
            "secondary_intents": list(result.get("secondary_intents") or []),
            "target_entities": list(result.get("target_entities") or []),
            "risk_posture": result.get("risk_posture", "neutral"),
            "explicit_roll_request": bool(result.get("explicit_roll_request", False)),
            "player_hypothesis": result.get("player_hypothesis"),
            "action_atoms": [a for a in (result.get("action_atoms") or []) if isinstance(a, dict)],
        }


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


def parse_intent(player_text: str | None, active_scene: dict | None = None) -> dict:
    """Parse player text into a structured intent.

    Args:
        player_text: Raw player free-text (中英文 mixed ok).
        active_scene: Optional scene dict; passed through to the evaluator,
            which may use ``available_clues`` / ``npc_ids`` to anchor targets.

    Returns:
        {
            "primary_intent": "investigate|social|combat|flee|meta|stuck|idle",
            "secondary_intents": list[str],   # e.g. ["avoid_risk", "social_followup"]
            "target_entities": list[str],     # e.g. ["backyard", "window", "neighbor"]
            "risk_posture": "cautious|neutral|reckless",
            "explicit_roll_request": bool,
            "player_hypothesis": str | None,
            "action_atoms": list[dict],
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

    evaluator = _DEFAULT_EVALUATOR or LLMIntentEvaluator()
    return evaluator.classify(text, active_scene)


def _idle_result() -> dict[str, Any]:
    return {
        "primary_intent": "idle",
        "secondary_intents": [],
        "target_entities": [],
        "risk_posture": "neutral",
        "explicit_roll_request": False,
        "player_hypothesis": None,
        "action_atoms": [],
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
    }
