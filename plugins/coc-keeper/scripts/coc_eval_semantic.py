#!/usr/bin/env python3
"""Structured personas and blinded semantic judge artifacts for eval-spec-v1."""
from __future__ import annotations

import hashlib
import json
import random
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
EVAL_SPEC = "eval-spec-v1"
PERSONAS_PATH = Path("evaluation/spec/v1/personas/personas.json")
RUBRICS_DIR = Path("evaluation/spec/v1/rubrics")

REQUIRED_PERSONA_IDS = (
    "careful_investigator",
    "reckless_investigator",
    "skeptical_rules_lawyer",
    "genre_savvy_player",
    "social_first_player",
    "combat_first_player",
    "speedrunner",
    "stuck_player",
    "adversarial_boundary_tester",
    "memory_challenger",
    "colloquial_ambiguous_player",
    "meta_question_player",
)

BOUNDED_INT_FIELDS = (
    "risk_tolerance",
    "rules_knowledge",
    "metagame_tendency",
    "social_preference",
    "combat_preference",
    "persistence_after_failure",
)

GOAL_ORIENTATIONS = frozenset({"fast", "thorough", "social", "combat", "chaotic"})
VERBOSITIES = frozenset({"short", "medium", "long"})
WINNERS = frozenset({"A", "B", "tie", "uncertain"})

FORBIDDEN_PUBLIC_KEYS = frozenset(
    {
        "keeper_secret",
        "keeper_secrets",
        "expected_route",
        "expected_routes",
        "forbidden_outcome",
        "forbidden_outcomes",
        "baseline",
        "candidate",
        "side",
    }
)

PUBLIC_TURN_KEYS = frozenset({"turn_id", "text", "narration", "role", "speaker"})


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"unreadable JSON: {path}: {exc}") from exc


def canonical_json_bytes(payload: Any) -> bytes:
    return json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def canonical_sha256(payload: Any) -> str:
    return hashlib.sha256(canonical_json_bytes(payload)).hexdigest()


def persona_canonical_sha256(persona: dict[str, Any]) -> str:
    if not isinstance(persona, dict):
        raise ValueError("persona must be an object")
    return canonical_sha256(persona)


def _validate_persona(persona: Any, *, index: int) -> dict[str, Any]:
    if not isinstance(persona, dict):
        raise ValueError(f"persona[{index}] must be an object")
    persona_id = persona.get("persona_id")
    if not isinstance(persona_id, str) or not persona_id:
        raise ValueError(f"persona[{index}] missing persona_id")
    for field in BOUNDED_INT_FIELDS:
        value = persona.get(field)
        if type(value) is not int or not 0 <= value <= 4:
            raise ValueError(f"{persona_id}.{field} must be int in 0..4")
    verbosity = persona.get("verbosity")
    if verbosity not in VERBOSITIES:
        raise ValueError(f"{persona_id}.verbosity must be one of {sorted(VERBOSITIES)}")
    goal = persona.get("goal_orientation")
    if goal not in GOAL_ORIENTATIONS:
        raise ValueError(
            f"{persona_id}.goal_orientation must be one of {sorted(GOAL_ORIENTATIONS)}"
        )
    directives = persona.get("prompt_directives")
    if not isinstance(directives, list) or not all(
        isinstance(item, str) and item for item in directives
    ):
        raise ValueError(f"{persona_id}.prompt_directives must be non-empty strings")
    description = persona.get("description")
    if not isinstance(description, str) or not description:
        raise ValueError(f"{persona_id}.description must be a non-empty string")
    return persona


def load_personas(root: Path | str = REPO_ROOT) -> dict[str, Any]:
    path = Path(root) / PERSONAS_PATH
    payload = _read_json(path)
    if not isinstance(payload, dict):
        raise ValueError("personas payload must be an object")
    if payload.get("schema_version") != 1 or payload.get("eval_spec") != EVAL_SPEC:
        raise ValueError("invalid personas schema/eval_spec")
    personas = payload.get("personas")
    if not isinstance(personas, list):
        raise ValueError("personas must be a list")
    validated = [_validate_persona(item, index=index) for index, item in enumerate(personas)]
    ids = [item["persona_id"] for item in validated]
    if ids != list(REQUIRED_PERSONA_IDS):
        raise ValueError(
            "personas must declare exactly the twelve required IDs in canonical order"
        )
    if len(set(ids)) != len(ids):
        raise ValueError("duplicate persona_id")
    return payload


def _validate_rubric(payload: Any, *, expected_id: str | None = None) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("rubric must be an object")
    if payload.get("schema_version") != 1 or payload.get("eval_spec") != EVAL_SPEC:
        raise ValueError("invalid rubric schema/eval_spec")
    rubric_id = payload.get("rubric_id")
    rubric_version = payload.get("rubric_version")
    if not isinstance(rubric_id, str) or not rubric_id:
        raise ValueError("rubric_id required")
    if expected_id is not None and rubric_id != expected_id:
        raise ValueError(f"rubric_id mismatch: expected {expected_id}, got {rubric_id}")
    if not isinstance(rubric_version, str) or not rubric_version:
        raise ValueError(f"{rubric_id}.rubric_version required")
    dimensions = payload.get("dimensions")
    if not isinstance(dimensions, list) or not dimensions:
        raise ValueError(f"{rubric_id}.dimensions required")
    dimension_ids: set[str] = set()
    for index, dimension in enumerate(dimensions):
        if not isinstance(dimension, dict):
            raise ValueError(f"{rubric_id}.dimensions[{index}] must be an object")
        dimension_id = dimension.get("dimension_id")
        if not isinstance(dimension_id, str) or not dimension_id:
            raise ValueError(f"{rubric_id}.dimensions[{index}] missing dimension_id")
        if dimension_id in dimension_ids:
            raise ValueError(f"duplicate dimension_id: {dimension_id}")
        dimension_ids.add(dimension_id)
        if dimension.get("min_score") != 1 or dimension.get("max_score") != 5:
            raise ValueError(f"{dimension_id} scores must be 1..5")
    finding_codes = payload.get("finding_codes")
    if not isinstance(finding_codes, list) or not finding_codes:
        raise ValueError(f"{rubric_id}.finding_codes required")
    if not all(isinstance(code, str) and code for code in finding_codes):
        raise ValueError(f"{rubric_id}.finding_codes must be non-empty strings")
    if len(set(finding_codes)) != len(finding_codes):
        raise ValueError(f"{rubric_id}.finding_codes must be unique")
    return payload


def load_rubrics(root: Path | str = REPO_ROOT) -> dict[str, dict[str, Any]]:
    directory = Path(root) / RUBRICS_DIR
    if not directory.is_dir():
        raise ValueError(f"rubrics directory missing: {directory}")
    rubrics: dict[str, dict[str, Any]] = {}
    for path in sorted(directory.glob("*.json")):
        payload = _validate_rubric(_read_json(path), expected_id=path.stem)
        rubrics[payload["rubric_id"]] = payload
    required = {"agency-and-fun", "zh-prose", "module-fidelity"}
    missing = sorted(required - set(rubrics))
    if missing:
        raise ValueError(f"missing required rubrics: {missing}")
    return rubrics


def _strip_forbidden(value: Any) -> Any:
    if isinstance(value, dict):
        cleaned: dict[str, Any] = {}
        for key, item in value.items():
            if key in FORBIDDEN_PUBLIC_KEYS:
                continue
            if str(key).lower() in {"baseline", "candidate"}:
                continue
            cleaned[key] = _strip_forbidden(item)
        return cleaned
    if isinstance(value, list):
        return [_strip_forbidden(item) for item in value]
    return value


def _public_turn(turn: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(turn, dict):
        raise ValueError("turn must be an object")
    turn_id = turn.get("turn_id")
    if not isinstance(turn_id, str) or not turn_id:
        raise ValueError("turn_id required")
    public = {"turn_id": turn_id}
    for key in ("text", "narration", "role", "speaker"):
        if key in turn and turn[key] is not None:
            public[key] = turn[key]
    # Preserve only allowlisted keys; never copy forbidden fields.
    return public


def build_blind_pair_request(
    *,
    pair_id: str,
    rubric_id: str,
    rubric_version: str,
    public_context: dict[str, Any],
    turn_ids: list[str],
    baseline_turns: list[dict[str, Any]],
    candidate_turns: list[dict[str, Any]],
    seed: int,
) -> tuple[dict[str, Any], dict[str, str]]:
    """Build a blinded A/B judge request and a private label mapping.

    The request never contains baseline/candidate labels, Keeper secrets,
    expected routes, or forbidden outcomes. The private mapping is returned
    separately and must not be written into the judge request artifact.
    """
    if not isinstance(pair_id, str) or not pair_id:
        raise ValueError("pair_id required")
    if not isinstance(rubric_id, str) or not rubric_id:
        raise ValueError("rubric_id required")
    if not isinstance(rubric_version, str) or not rubric_version:
        raise ValueError("rubric_version required")
    if not isinstance(public_context, dict):
        raise ValueError("public_context must be an object")
    if not isinstance(turn_ids, list) or not all(
        isinstance(item, str) and item for item in turn_ids
    ):
        raise ValueError("turn_ids must be non-empty strings")
    if type(seed) is not int:
        raise ValueError("seed must be an int")

    public_baseline = [_public_turn(turn) for turn in baseline_turns]
    public_candidate = [_public_turn(turn) for turn in candidate_turns]
    cleaned_context = _strip_forbidden(public_context)

    rng = random.Random(seed)
    assign_baseline_to_a = rng.random() < 0.5
    if assign_baseline_to_a:
        mapping = {"A": "baseline", "B": "candidate"}
        sides = {"A": public_baseline, "B": public_candidate}
    else:
        mapping = {"A": "candidate", "B": "baseline"}
        sides = {"A": public_candidate, "B": public_baseline}

    request_body = {
        "pair_id": pair_id,
        "labels": ["A", "B"],
        "public_context": cleaned_context,
        "turn_ids": list(turn_ids),
        "rubric_id": rubric_id,
        "rubric_version": rubric_version,
        "sides": sides,
        "seed": seed,
    }
    request = dict(request_body)
    request["request_sha256"] = canonical_sha256(request_body)
    return request, mapping


def validate_judge_result(
    request: dict[str, Any],
    result: dict[str, Any],
    *,
    rubric: dict[str, Any],
) -> bool:
    """Validate a judge result against a blinded request and versioned rubric."""
    if not isinstance(request, dict) or not isinstance(result, dict):
        raise ValueError("request and result must be objects")
    rubric = _validate_rubric(rubric)

    evaluator = result.get("evaluator")
    if not isinstance(evaluator, dict):
        raise ValueError("evaluator identity required")
    if not isinstance(evaluator.get("provider"), str) or not evaluator.get("provider"):
        raise ValueError("evaluator.provider required")
    if not isinstance(evaluator.get("id"), str) or not evaluator.get("id"):
        raise ValueError("evaluator.id required")

    expected_hash = request.get("request_sha256")
    actual_hash = result.get("request_sha256")
    if not isinstance(expected_hash, str) or not expected_hash:
        raise ValueError("request.request_sha256 required")
    if actual_hash != expected_hash:
        raise ValueError("request_sha256 mismatch")

    winner = result.get("winner")
    if winner not in WINNERS:
        raise ValueError("winner must be one of A|B|tie|uncertain")

    dimensions = {
        item["dimension_id"]: item for item in rubric["dimensions"] if isinstance(item, dict)
    }
    scores = result.get("dimension_scores")
    if not isinstance(scores, dict):
        raise ValueError("dimension_scores required")
    for dimension_id, score in scores.items():
        if dimension_id not in dimensions:
            raise ValueError(f"unknown dimension score: {dimension_id}")
        bounds = dimensions[dimension_id]
        if type(score) not in (int, float) or isinstance(score, bool):
            raise ValueError(f"score for {dimension_id} must be numeric")
        if not bounds["min_score"] <= float(score) <= bounds["max_score"]:
            raise ValueError(f"score out of range for {dimension_id}")

    allowed_turns = {str(item) for item in request.get("turn_ids") or []}
    allowed_labels = set(rubric["finding_codes"])
    findings = result.get("findings")
    if findings is None:
        findings = []
    if not isinstance(findings, list):
        raise ValueError("findings must be a list")
    for index, finding in enumerate(findings):
        if not isinstance(finding, dict):
            raise ValueError(f"findings[{index}] must be an object")
        label = finding.get("label")
        if label not in allowed_labels:
            raise ValueError(f"unknown finding label: {label}")
        turn_id = finding.get("turn_id")
        if turn_id is not None and turn_id not in allowed_turns:
            raise ValueError(f"unknown evidence turn_id: {turn_id}")
        side = finding.get("side")
        if side is not None and side not in {"A", "B"}:
            raise ValueError(f"findings[{index}].side must be A or B")
        reason = finding.get("reason")
        if reason is not None and (not isinstance(reason, str) or not reason.strip()):
            raise ValueError(f"findings[{index}].reason must be non-empty when present")

    reasons = result.get("reasons")
    if not isinstance(reasons, list) or not reasons:
        raise ValueError("non-empty reasons required")
    if not all(isinstance(item, str) and item.strip() for item in reasons):
        raise ValueError("reasons must be non-empty strings")
    return True


def aggregate_judge_results(
    results: list[dict[str, Any]],
    *,
    rubrics: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Aggregate structured judge outputs without masking hard findings."""
    if not isinstance(results, list):
        raise ValueError("results must be a list")
    pair_count = len(results)
    preference_counts = {"A": 0, "B": 0, "tie": 0, "uncertain": 0}
    label_frequencies: dict[str, int] = {}
    dimension_values: dict[str, list[float]] = {}
    hard_findings: list[str] = []
    zh_finding_count = 0
    zh_han_characters = 0

    for index, result in enumerate(results):
        if not isinstance(result, dict):
            raise ValueError(f"results[{index}] must be an object")
        winner = result.get("winner")
        if winner not in WINNERS:
            raise ValueError(f"results[{index}].winner invalid")
        preference_counts[str(winner)] += 1

        for finding in result.get("findings") or []:
            if not isinstance(finding, dict):
                continue
            label = finding.get("label")
            if isinstance(label, str) and label:
                label_frequencies[label] = label_frequencies.get(label, 0) + 1
                if result.get("rubric_id") == "zh-prose":
                    zh_finding_count += 1

        scores = result.get("dimension_scores") or {}
        if isinstance(scores, dict):
            for dimension_id, score in scores.items():
                if type(score) in (int, float) and not isinstance(score, bool):
                    dimension_values.setdefault(str(dimension_id), []).append(float(score))

        for finding_id in result.get("hard_findings") or []:
            if isinstance(finding_id, str) and finding_id:
                hard_findings.append(finding_id)

        if result.get("rubric_id") == "zh-prose":
            count = result.get("han_character_count")
            if type(count) is int and count > 0:
                zh_han_characters += count

    preference_rates = {
        key: (preference_counts[key] / pair_count if pair_count else 0.0)
        for key in ("A", "B", "tie", "uncertain")
    }
    dimension_score_aggregates = {
        dimension_id: {
            "count": len(values),
            "mean": sum(values) / len(values),
            "min": min(values),
            "max": max(values),
        }
        for dimension_id, values in sorted(dimension_values.items())
        if values
    }
    zh_density = (
        (zh_finding_count * 1000.0 / zh_han_characters) if zh_han_characters else 0.0
    )
    unique_hard = sorted(set(hard_findings))
    return {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "pair_count": pair_count,
        "preference_counts": preference_counts,
        "preference_rates": preference_rates,
        "uncertain_rate": preference_rates["uncertain"],
        "label_frequencies": dict(sorted(label_frequencies.items())),
        "dimension_score_aggregates": dimension_score_aggregates,
        "zh_prose_findings_per_thousand_han": zh_density,
        "hard_findings": unique_hard,
        "hard_findings_override_judge": bool(unique_hard),
        "rubric_ids": sorted(
            {
                str(result.get("rubric_id"))
                for result in results
                if isinstance(result, dict) and result.get("rubric_id")
            }
        ),
        "rubrics_loaded": sorted((rubrics or {}).keys()),
    }
