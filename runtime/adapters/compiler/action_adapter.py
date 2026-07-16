"""KP-side semantic action resolver subprocess bridge.

The player brain never receives this request.  It contains the player's own
utterance plus a bounded Keeper projection of the current public affordances
and reachable destinations, allowing a semantic model to bind natural action
to stable scenario IDs without exposing those IDs back to the player.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any


def _default_runner() -> Path:
    return Path(__file__).resolve().parent / "run_action_resolve.mjs"


def _runner_cmd(path: Path) -> list[str]:
    return ["node", str(path)] if path.suffix.lower() in {".mjs", ".js"} else [str(path)]


def _string_list(value: Any, field: str) -> list[str]:
    if not isinstance(value, list) or any(
        not isinstance(item, str) or not item.strip() for item in value
    ):
        raise RuntimeError(f"{field} must be a list of non-empty strings")
    return [item.strip() for item in value]


def parse_action_resolution(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict) or raw.get("ok") is not True:
        raise RuntimeError(str((raw or {}).get("error") or "action resolver returned ok=false"))
    resolution = raw.get("action_resolution")
    if not isinstance(resolution, dict):
        raise RuntimeError("action resolver response requires action_resolution")
    expected = {
        "schema_version", "evaluator_id", "matched_affordance_ids",
        "matched_destination_scene_id", "normalized_target_entities",
        "normalized_action_atoms", "push_request", "primary_intent", "confidence",
        "reason", "no_match",
    }
    optional = {"keeper_proposal"}
    if not expected <= set(resolution) or set(resolution) - expected - optional:
        raise RuntimeError("action_resolution has unsupported or missing fields")
    if resolution.get("schema_version") != 1 or resolution.get("evaluator_id") != "coc-action-resolver-v1":
        raise RuntimeError("action_resolution identity is invalid")
    matched = _string_list(resolution.get("matched_affordance_ids"), "matched_affordance_ids")
    if len(set(matched)) != len(matched) or len(matched) > 3:
        raise RuntimeError("matched_affordance_ids must be unique and contain at most three values")
    destination = resolution.get("matched_destination_scene_id")
    if destination is not None and (not isinstance(destination, str) or not destination.strip()):
        raise RuntimeError("matched_destination_scene_id must be non-empty or null")
    entities = _string_list(
        resolution.get("normalized_target_entities"), "normalized_target_entities"
    )
    atoms = resolution.get("normalized_action_atoms")
    if not isinstance(atoms, list) or any(not isinstance(atom, dict) for atom in atoms):
        raise RuntimeError("normalized_action_atoms must be a list of objects")
    push_request = resolution.get("push_request")
    if push_request is not None:
        if (
            not isinstance(push_request, dict)
            or set(push_request) != {"candidate_id", "changed_method_summary"}
            or not isinstance(push_request.get("candidate_id"), str)
            or not push_request["candidate_id"].strip()
            or not isinstance(push_request.get("changed_method_summary"), str)
            or not push_request["changed_method_summary"].strip()
        ):
            raise RuntimeError(
                "action_resolution.push_request must be null or the exact candidate and changed-method object"
            )
    primary = resolution.get("primary_intent")
    if primary not in {
        "investigate", "social", "move", "combat", "flee", "meta", "stuck",
        "idle", "ambiguous", "montage", "cast",
    }:
        raise RuntimeError("action_resolution.primary_intent is not canonical")
    confidence = resolution.get("confidence")
    if (
        isinstance(confidence, bool)
        or not isinstance(confidence, (int, float))
        or not 0 <= float(confidence) <= 1
    ):
        raise RuntimeError("action_resolution.confidence must be between 0 and 1")
    reason = resolution.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        raise RuntimeError("action_resolution.reason must be non-empty")
    no_match = resolution.get("no_match")
    if not isinstance(no_match, bool):
        raise RuntimeError("action_resolution.no_match must be boolean")
    if no_match and (matched or destination is not None):
        raise RuntimeError("no_match action resolution cannot select an affordance or destination")
    result = {
        "schema_version": 1,
        "evaluator_id": "coc-action-resolver-v1",
        "matched_affordance_ids": matched,
        "matched_destination_scene_id": destination.strip() if isinstance(destination, str) else None,
        "normalized_target_entities": entities,
        "normalized_action_atoms": json.loads(json.dumps(atoms, ensure_ascii=False)),
        "push_request": (
            {
                "candidate_id": push_request["candidate_id"].strip(),
                "changed_method_summary": push_request["changed_method_summary"].strip(),
            }
            if isinstance(push_request, dict)
            else None
        ),
        "primary_intent": primary,
        "confidence": float(confidence),
        "reason": reason.strip(),
        "no_match": no_match,
    }
    if "keeper_proposal" in resolution:
        if not isinstance(resolution.get("keeper_proposal"), dict):
            raise RuntimeError("action_resolution.keeper_proposal must be an object")
        # Full capability/reference validation happens in coc_action_resolver,
        # which owns the private request context. The subprocess boundary only
        # preserves the opaque proposal without interpreting its judgment.
        result["keeper_proposal"] = json.loads(json.dumps(
            resolution["keeper_proposal"], ensure_ascii=False
        ))
    normalization = raw.get("push_request_normalization")
    if normalization is not None:
        expected_normalization = {
            "schema_version": 1,
            "field": "push_request",
            "action": "normalized_to_null",
            "reason": "no_push_candidate_supplied",
        }
        if normalization != expected_normalization or result["push_request"] is not None:
            raise RuntimeError("push_request_normalization receipt is invalid")
        result["push_request_normalization"] = dict(expected_normalization)
    push_action_normalization = raw.get("push_action_normalization")
    if push_action_normalization is not None:
        if (
            not isinstance(push_action_normalization, dict)
            or set(push_action_normalization) != {
                "schema_version", "field", "action", "reason",
                "suppressed_atom_count",
            }
            or push_action_normalization.get("schema_version") != 1
            or push_action_normalization.get("field") != "normalized_action_atoms"
            or push_action_normalization.get("action") != "suppressed_for_canonical_push"
            or push_action_normalization.get("reason")
            != "push_request_owns_exact_failed_action"
            or isinstance(push_action_normalization.get("suppressed_atom_count"), bool)
            or not isinstance(push_action_normalization.get("suppressed_atom_count"), int)
            or push_action_normalization["suppressed_atom_count"] < 1
        ):
            raise RuntimeError("push_action_normalization receipt is invalid")
        result["push_action_normalization"] = dict(push_action_normalization)
    push_binding_rejection = raw.get("push_binding_rejection")
    if push_binding_rejection is not None:
        if (
            not isinstance(push_binding_rejection, dict)
            or set(push_binding_rejection) != {
                "schema_version", "field", "action", "reason",
            }
            or push_binding_rejection.get("schema_version") != 1
            or push_binding_rejection.get("field") != "push_request"
            or push_binding_rejection.get("action")
            != "rejected_to_typed_limitation"
            or push_binding_rejection.get("reason") not in {
                "malformed_push_request", "candidate_id_mismatch",
                "changed_method_missing", "destination_conflict",
                "no_match_conflict", "post_arrival_conflict",
            }
        ):
            raise RuntimeError("push_binding_rejection receipt is invalid")
        result["push_binding_rejection"] = dict(push_binding_rejection)
    identity = raw.get("model_identity")
    if isinstance(identity, dict) and isinstance(identity.get("provider"), str) and isinstance(identity.get("id"), str):
        result["model_identity"] = {
            "provider": identity["provider"].strip(),
            "id": identity["id"].strip(),
        }
    usage = raw.get("usage")
    if isinstance(usage, dict):
        result["usage"] = usage
    response_mode = raw.get("response_mode")
    if response_mode in {"tool", "json", "json_fallback"}:
        result["response_mode"] = response_mode
    return result


def resolve_action(
    request: dict[str, Any],
    *,
    runner_path: Path | str | None = None,
    timeout_s: float = 180,
) -> dict[str, Any]:
    if not isinstance(request, dict):
        raise ValueError("action resolver request must be an object")
    runner = Path(runner_path).resolve() if runner_path is not None else _default_runner()
    if not runner.is_file():
        raise RuntimeError(f"action resolver runner not found: {runner}")
    completed = subprocess.run(
        _runner_cmd(runner),
        input=json.dumps(request, ensure_ascii=False),
        text=True,
        capture_output=True,
        timeout=timeout_s,
        check=False,
        cwd=runner.parent,
    )
    stdout = (completed.stdout or "").strip()
    try:
        raw = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("action resolver stdout is not JSON") from exc
    if completed.returncode != 0:
        raise RuntimeError(str((raw or {}).get("error") or completed.stderr or "action resolver failed"))
    result = parse_action_resolution(raw)
    allowed_weapon_ids = {
        str(row.get("weapon_id"))
        for row in request.get("weapon_candidates", []) or []
        if isinstance(row, dict)
        and isinstance(row.get("weapon_id"), str)
        and row["weapon_id"].strip()
    }
    post_arrival_ids = {
        str(row.get("affordance_id"))
        for row in request.get("post_arrival_affordances", []) or []
        if isinstance(row, dict)
        and isinstance(row.get("affordance_id"), str)
        and row["affordance_id"].strip()
    }
    candidate = request.get("push_candidate")
    push_request = result["push_request"]
    rejection = result.get("push_binding_rejection")
    normalization = result.get("push_action_normalization")
    if rejection is not None:
        if (
            not isinstance(candidate, dict)
            or push_request is not None
            or result["matched_affordance_ids"] != []
            or result["matched_destination_scene_id"] is not None
            or result["normalized_action_atoms"] != []
            or result["no_match"] is not True
        ):
            raise RuntimeError("push_binding_rejection did not fail closed")
    if push_request is not None:
        matched = result["matched_affordance_ids"]
        exact_binding = (
            not isinstance(candidate, dict)
            or push_request["candidate_id"] != candidate.get("candidate_id")
            or result["matched_destination_scene_id"] is not None
            or result["no_match"] is True
            or any(route_id in post_arrival_ids for route_id in matched)
        )
        if exact_binding:
            reason = (
                "candidate_id_mismatch"
                if not isinstance(candidate, dict)
                or push_request["candidate_id"] != candidate.get("candidate_id")
                else "destination_conflict"
                if result["matched_destination_scene_id"] is not None
                else "post_arrival_conflict"
                if any(route_id in post_arrival_ids for route_id in matched)
                else "no_match_conflict"
            )
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
                    "reason": reason,
                },
            })
        else:
            if matched:
                result = dict(result)
                result["matched_affordance_ids"] = []
            if result["normalized_action_atoms"]:
                if normalization is not None:
                    raise RuntimeError("push action atoms remained after normalization")
                result = dict(result)
                result["push_action_normalization"] = {
                    "schema_version": 1,
                    "field": "normalized_action_atoms",
                    "action": "suppressed_for_canonical_push",
                    "reason": "push_request_owns_exact_failed_action",
                    "suppressed_atom_count": len(result["normalized_action_atoms"]),
                }
                result["normalized_action_atoms"] = []
    elif normalization is not None:
        raise RuntimeError("push_action_normalization requires an accepted push_request")
    for atom in result.get("normalized_action_atoms", []):
        weapon_id = atom.get("weapon_id") if isinstance(atom, dict) else None
        if weapon_id is None:
            continue
        if not isinstance(weapon_id, str) or weapon_id not in allowed_weapon_ids:
            raise RuntimeError(
                "action resolver normalized_action_atoms contains an unknown weapon_id"
            )
    return result
