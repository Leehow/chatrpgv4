#!/usr/bin/env python3
"""Story-graph structure validator (compilation Layer 2).

Validates that LLM-compiled scenario story-graph files meet the structural
requirements the director depends on. Run after coc-scenario-import compiles
a module. Reports errors (must fix) and warnings (soft).

Also provides ``validate_compiled_scenario`` (structured findings), provenance
annotation, and a dependency ``doctor`` for CI / local env checks (R-5).

Historical spec retired; see tombstone index docs/status/DIAGNOSIS-LEDGER.md
"""
from __future__ import annotations

import json
import sys
from collections import deque
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from coc_python_contract import REQUIRED_PYTHON, require_python_contract

require_python_contract()


def _load_sibling(name: str, filename: str):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_npc_state = _load_sibling("coc_npc_state_scenario_compile", "coc_npc_state.py")
coc_director_strategies = _load_sibling(
    "coc_director_strategies_scenario_compile", "coc_director_strategies.py"
)

import coc_pdf_source
import coc_epistemic_lifecycle

VALID_STRUCTURE_TYPES = {
    "linear_acts", "time_loop", "branching_investigation", "hub_sandbox",
    "multi_faction", "campaign_sequel", "hybrid_mega",
}
REQUIRED_FILES = [
    "module-meta.json", "story-graph.json", "clue-graph.json",
    "npc-agendas.json", "threat-fronts.json", "pacing-map.json",
    "improvisation-boundaries.json",
]
NON_FRAGILE_DELIVERY_KINDS = {
    "obvious",
    "handout",
    "environmental",
    "npc_dialogue",
    "social",
    "direct",
}
VALID_ORIGINS = frozenset({"source", "inferred", "improvised"})
VALID_PAGE_KINDS = frozenset({"printed", "pdf_index"})
VALID_EPISTEMIC_LAYERS = frozenset({
    "fact", "identity", "method", "motive", "causal", "structure",
    "world", "personal",
})
VALID_EPISTEMIC_EFFECTS = frozenset({
    "confirm", "expand", "complicate", "reframe", "payoff",
})
VALID_REVEAL_MODES = VALID_EPISTEMIC_EFFECTS
DOCTOR_RULES_JSON_FILES = (
    "structure-weights.json",
    "rule-index.json",
)
SCENE_FUNCTION_KEYS = (
    "scene_function", "goals", "required_reveals", "failure_modes",
    "exit_options", "mode_affinity",
)


def _plugin_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _rules_json_dir() -> Path:
    return _plugin_root() / "references" / "rules-json"


def _read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _finding(
    code: str,
    severity: str,
    message: str,
    path: str = "",
    *,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    finding: dict[str, Any] = {
        "code": code,
        "severity": severity,
        "path": path,
        "message": message,
    }
    if details:
        finding["details"] = details
    return finding


VALID_BONUS_DIFFICULTIES = {"regular", "hard", "extreme"}
VALID_BONUS_FAIL_COSTS = {"time", "pressure"}


def _is_string_list(value: Any) -> bool:
    """True when ``value`` is a list of non-empty strings."""
    return isinstance(value, list) and all(
        isinstance(item, str) and item.strip() for item in value
    )


def _is_localized_summary_map(value: Any) -> bool:
    return value is None or (
        isinstance(value, dict)
        and all(
            isinstance(language, str) and language.strip()
            and isinstance(summary, str) and summary.strip()
            for language, summary in value.items()
        )
    )


def _is_typed_consequence_effect(value: Any) -> bool:
    """Validate the shared closed consequence-effect vocabulary."""
    if not isinstance(value, dict):
        return False
    kind = value.get("kind")
    if kind == "fictional_position":
        return set(value) in ({"kind"}, {"kind", "severity"}) and (
            "severity" not in value
            or value.get("severity") in {"minor", "serious", "critical"}
        )
    if kind == "pressure_tick":
        ticks = value.get("ticks")
        return (
            set(value) == {"kind", "clock_id", "ticks"}
            and isinstance(value.get("clock_id"), str)
            and bool(value["clock_id"].strip())
            and isinstance(ticks, int)
            and not isinstance(ticks, bool)
            and 1 <= ticks <= 4
        )
    if kind == "condition":
        return (
            set(value) == {"kind", "condition_id"}
            and isinstance(value.get("condition_id"), str)
            and bool(value["condition_id"].strip())
        )
    if kind == "route_closed":
        return (
            set(value) == {"kind", "route_id"}
            and isinstance(value.get("route_id"), str)
            and bool(value["route_id"].strip())
        )
    return False


def _is_retry_policy(value: Any) -> bool:
    if value is None:
        return True
    return bool(
        isinstance(value, dict)
        and set(value) == {"mode", "minimum_elapsed_minutes"}
        and value.get("mode") == "elapsed_time_reset"
        and isinstance(value.get("minimum_elapsed_minutes"), int)
        and not isinstance(value.get("minimum_elapsed_minutes"), bool)
        and value["minimum_elapsed_minutes"] > 0
    )


def _is_canonical_string_list(value: Any) -> bool:
    """True for an exact list of non-empty, already-trimmed strings."""
    return _is_string_list(value) and all(item == item.strip() for item in value)


def normalize_scene_function(scene: dict[str, Any]) -> dict[str, Any]:
    """Return the conservative exact six-field scene-function contract.

    Missing legacy fields receive deterministic structured defaults. Explicit
    malformed values fail closed instead of being silently coerced.
    """
    if not isinstance(scene, dict):
        raise ValueError("scene function source must be an object")
    authored = [key for key in SCENE_FUNCTION_KEYS if key in scene]
    if authored and set(authored) != set(SCENE_FUNCTION_KEYS):
        raise ValueError("authored scene function contract must contain all six fields")
    raw_function = scene.get("scene_function", scene.get("scene_type", "investigation"))
    if not isinstance(raw_function, str) or not raw_function.strip():
        raise ValueError("scene_function must be a non-empty string")
    if authored and raw_function != raw_function.strip():
        raise ValueError("scene_function must be canonical without surrounding whitespace")
    fallback_goals = [scene["dramatic_question"].strip()] if (
        isinstance(scene.get("dramatic_question"), str)
        and scene["dramatic_question"].strip()
    ) else []
    result: dict[str, Any] = {"scene_function": raw_function.strip()}
    for key in SCENE_FUNCTION_KEYS[1:]:
        if key in scene:
            value = scene[key]
        elif key == "goals":
            value = fallback_goals
        else:
            value = []
        if not _is_canonical_string_list(value):
            raise ValueError(f"{key} must be a list of non-empty strings")
        result[key] = list(value)
    return result


def _check_scene_function_contract(compiled: dict[str, Any]) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    for index, scene in enumerate((compiled.get("story_graph") or {}).get("scenes") or []):
        if not isinstance(scene, dict):
            continue
        # Legacy scenes with none of the six fields normalize at runtime. Once
        # any field is authored, require the complete explicit contract.
        authored = [key for key in SCENE_FUNCTION_KEYS if key in scene]
        if not authored:
            continue
        try:
            normalized = normalize_scene_function(scene)
            if set(authored) != set(SCENE_FUNCTION_KEYS):
                raise ValueError("authored scene function contract must contain all six fields")
            if any(scene[key] != normalized[key] for key in SCENE_FUNCTION_KEYS):
                raise ValueError("scene function contract is not canonical")
        except ValueError as exc:
            findings.append(_finding(
                "scene_function_contract_invalid", "error", str(exc),
                path=f"story_graph.scenes[{index}]",
            ))
    return findings


_SCENE_AFFINITY_LIST_FIELDS = ("scene_tags", "faction_ids", "threat_front_ids")
_SCENE_AFFINITY_ALIASES = ("front_ids",)
_THREAT_AFFINITY_LIST_FIELDS = ("scene_ids", "scene_tags_any", "faction_ids")


def _check_scene_affinity_contract(compiled: dict[str, Any]) -> list[dict[str, str]]:
    """Validate the one canonical scene-side threat-affinity vocabulary."""
    findings: list[dict[str, str]] = []
    for scene_index, scene in enumerate(
        (compiled.get("story_graph") or {}).get("scenes") or []
    ):
        if not isinstance(scene, dict):
            continue
        path = f"story_graph.scenes[{scene_index}]"
        for alias in _SCENE_AFFINITY_ALIASES:
            if alias in scene:
                findings.append(_finding(
                    "scene_affinity_contract_invalid", "error",
                    f"scene affinity alias {alias} is unsupported; use threat_front_ids",
                    path=f"{path}.{alias}",
                ))
        for field in _SCENE_AFFINITY_LIST_FIELDS:
            if field in scene and not _is_canonical_string_list(scene[field]):
                findings.append(_finding(
                    "scene_affinity_contract_invalid", "error",
                    f"scene affinity {field} must be a list of non-empty strings",
                    path=f"{path}.{field}",
                ))
    return findings


def _check_threat_clock_identity_contract(
    compiled: dict[str, Any],
) -> list[dict[str, str]]:
    """Require globally unique canonical clock IDs across every front."""
    findings: list[dict[str, str]] = []
    paths_by_id: dict[str, list[str]] = {}
    for front_index, front in enumerate(
        (compiled.get("threat_fronts") or {}).get("fronts") or []
    ):
        if not isinstance(front, dict):
            continue
        clocks = front.get("clocks") or []
        if not isinstance(clocks, list):
            continue
        for clock_index, clock in enumerate(clocks):
            if not isinstance(clock, dict):
                continue
            path = f"threat_fronts.fronts[{front_index}].clocks[{clock_index}].clock_id"
            clock_id = clock.get("clock_id")
            if (
                not isinstance(clock_id, str)
                or not clock_id.strip()
                or clock_id != clock_id.strip()
            ):
                findings.append(_finding(
                    "threat_clock_identity_invalid", "error",
                    "threat clock_id must be a non-empty canonical string", path=path,
                ))
                continue
            paths_by_id.setdefault(clock_id, []).append(path)
    for clock_id, paths in paths_by_id.items():
        if len(paths) > 1:
            findings.append(_finding(
                "threat_clock_identity_invalid", "error",
                f"duplicate threat clock_id '{clock_id}' at {', '.join(paths)}",
                path=paths[0],
            ))
    return findings


def _check_threat_affinity_contract(compiled: dict[str, Any]) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    for front_index, front in enumerate(
        (compiled.get("threat_fronts") or {}).get("fronts") or []
    ):
        if not isinstance(front, dict):
            continue
        owners = [(f"threat_fronts.fronts[{front_index}]", front)]
        owners.extend(
            (f"threat_fronts.fronts[{front_index}].clocks[{clock_index}]", clock)
            for clock_index, clock in enumerate(front.get("clocks") or [])
            if isinstance(clock, dict)
        )
        for path, owner in owners:
            if "severity" in owner:
                severity = owner["severity"]
                if isinstance(severity, bool) or not isinstance(severity, int):
                    findings.append(_finding(
                        "threat_affinity_contract_invalid", "error",
                        "threat affinity severity must be an integer", path=path,
                    ))
            for field in _THREAT_AFFINITY_LIST_FIELDS:
                if field in owner and not _is_string_list(owner[field]):
                    findings.append(_finding(
                        "threat_affinity_contract_invalid", "error",
                        f"threat affinity {field} must be a list of non-empty strings",
                        path=f"{path}.{field}",
                    ))
    return findings


def _check_npc_disclosure_contract(compiled: dict[str, Any]) -> list[dict[str, str]]:
    """Delegate all A21 checks to the single canonical structured validator."""
    findings = validate_npc_a21_contract(
        compiled.get("npc_agendas") or {}, compiled.get("clue_graph") or {}
    )
    # Preserve stable diagnostic codes for existing compiler consumers while
    # all validation decisions still originate in the canonical validator.
    projected: list[dict[str, str]] = []
    for finding in findings:
        row = dict(finding)
        path = row.get("path", "")
        if ".facts[" in path and path.endswith(".clue_id"):
            row["code"] = "npc_fact_reference_invalid"
        elif path.endswith(".source_npc_ids"):
            row["code"] = (
                "social_clue_source_unknown"
                if "unknown source NPC" in row.get("message", "")
                else "social_clue_sources_missing"
            )
        projected.append(row)
    return projected


def validate_npc_a21_contract(
    npc_agendas: Any, clue_graph: Any,
) -> list[dict[str, str]]:
    return coc_npc_state.validate_a21_contract(npc_agendas, clue_graph)


def _check_clue_bonus(clue: dict[str, Any]) -> list[str]:
    """Validate a provenance-bound, fumble-safe optional clue bonus."""
    cid = clue.get("clue_id")
    bonus = clue.get("bonus")
    if not isinstance(bonus, dict):
        return [f"clue '{cid}' bonus must be an object"]
    errors: list[str] = []
    allowed = {
        "schema_version", "origin", "source_refs", "skill", "difficulty",
        "extra_summary", "on_fail_cost", "fumble_consequence",
    }
    unknown = sorted(set(bonus) - allowed)
    if unknown:
        errors.append(f"clue '{cid}' bonus has unsupported fields: {unknown}")
    if bonus.get("schema_version") != 1:
        errors.append(f"clue '{cid}' bonus.schema_version must be 1")
    origin = bonus.get("origin")
    if origin not in VALID_ORIGINS:
        errors.append(
            f"clue '{cid}' bonus.origin must be one of {sorted(VALID_ORIGINS)}"
        )
    if origin == "source":
        refs = bonus.get("source_refs")
        if not isinstance(refs, list) or not refs:
            errors.append(
                f"clue '{cid}' source bonus requires its own non-empty source_refs"
            )
        elif any(
            not isinstance(ref, dict)
            or not (
                bool(ref.get("path")) and isinstance(ref.get("page"), int)
                or bool(ref.get("source_id")) and (
                    isinstance(ref.get("printed_page"), int)
                    or isinstance(ref.get("pdf_index"), int)
                )
            )
            for ref in refs
        ):
            errors.append(
                f"clue '{cid}' bonus.source_refs contains a malformed source reference"
            )
    skill = bonus.get("skill")
    if not isinstance(skill, str) or not skill.strip():
        errors.append(f"clue '{cid}' bonus.skill must be a non-empty string")
    difficulty = bonus.get("difficulty", "regular")
    if difficulty not in VALID_BONUS_DIFFICULTIES:
        errors.append(
            f"clue '{cid}' bonus.difficulty '{difficulty}' not in {sorted(VALID_BONUS_DIFFICULTIES)}"
        )
    extra = bonus.get("extra_summary")
    if not isinstance(extra, str) or not extra.strip():
        errors.append(f"clue '{cid}' bonus.extra_summary must be a non-empty string")
    on_fail = bonus.get("on_fail_cost", "time")
    if on_fail not in VALID_BONUS_FAIL_COSTS:
        errors.append(
            f"clue '{cid}' bonus.on_fail_cost '{on_fail}' not in {sorted(VALID_BONUS_FAIL_COSTS)}"
        )
    fumble = bonus.get("fumble_consequence")
    if (
        not isinstance(fumble, dict)
        or set(fumble) != {"summary", "effect"}
        or not isinstance(fumble.get("summary"), str)
        or not fumble["summary"].strip()
        or not _is_typed_consequence_effect(fumble.get("effect"))
    ):
        errors.append(
            f"clue '{cid}' bonus.fumble_consequence must contain an exact "
            "non-empty summary and typed effect"
        )
    return errors


def _is_non_fragile_clue_route(clue: dict[str, Any]) -> bool:
    kind = clue.get("delivery_kind")
    if kind in NON_FRAGILE_DELIVERY_KINDS:
        return True
    if kind == "skill_check":
        return False
    if clue.get("fallback_route") or clue.get("recoverable") is True:
        return True
    return False


def _has_recoverable_fallback(conclusion: dict[str, Any]) -> bool:
    if conclusion.get("fallback_policy"):
        return True
    for key in ("fallback_routes", "recover_routes"):
        if conclusion.get(key):
            return True
    return any(
        clue.get("fallback_route") or clue.get("recoverable") is True
        for clue in conclusion.get("clues", [])
        if isinstance(clue, dict)
    )


def _is_finale_scene(scene: dict[str, Any]) -> bool:
    if scene.get("is_final") is True:
        return True
    return str(scene.get("scene_type") or "") == "resolution"


def _iter_clues(compiled: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    out: list[tuple[str, dict[str, Any]]] = []
    for ci, concl in enumerate((compiled.get("clue_graph") or {}).get("conclusions") or []):
        if not isinstance(concl, dict):
            continue
        cid = concl.get("conclusion_id") or str(ci)
        for qi, clue in enumerate(concl.get("clues") or []):
            if isinstance(clue, dict):
                out.append((f"clue_graph.conclusions[{cid}].clues[{clue.get('clue_id') or qi}]", clue))
    return out


def _collect_id_maps(compiled: dict[str, Any]) -> dict[str, dict[str, list[str]]]:
    """Map entity kind -> {id: [json-paths]} for uniqueness checks."""
    maps: dict[str, dict[str, list[str]]] = {
        "scene": {},
        "clue": {},
        "npc": {},
        "front": {},
        "conclusion": {},
    }
    for i, scene in enumerate((compiled.get("story_graph") or {}).get("scenes") or []):
        if not isinstance(scene, dict):
            continue
        sid = scene.get("scene_id")
        if sid:
            maps["scene"].setdefault(str(sid), []).append(f"story_graph.scenes[{i}]")
    for path, clue in _iter_clues(compiled):
        cid = clue.get("clue_id")
        if cid:
            maps["clue"].setdefault(str(cid), []).append(path)
    for i, npc in enumerate((compiled.get("npc_agendas") or {}).get("npcs") or []):
        if not isinstance(npc, dict):
            continue
        nid = npc.get("npc_id")
        if nid:
            maps["npc"].setdefault(str(nid), []).append(f"npc_agendas.npcs[{i}]")
    for i, front in enumerate((compiled.get("threat_fronts") or {}).get("fronts") or []):
        if not isinstance(front, dict):
            continue
        fid = front.get("front_id")
        if fid:
            maps["front"].setdefault(str(fid), []).append(f"threat_fronts.fronts[{i}]")
    for i, concl in enumerate((compiled.get("clue_graph") or {}).get("conclusions") or []):
        if not isinstance(concl, dict):
            continue
        cid = concl.get("conclusion_id")
        if cid:
            maps["conclusion"].setdefault(str(cid), []).append(f"clue_graph.conclusions[{i}]")
    return maps


def _check_id_uniqueness(id_maps: dict[str, dict[str, list[str]]]) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    for kind, mapping in id_maps.items():
        for eid, paths in mapping.items():
            if len(paths) > 1:
                findings.append(
                    _finding(
                        "duplicate_id",
                        "error",
                        f"duplicate {kind} id '{eid}' at {', '.join(paths)}",
                        path=paths[0],
                        details={
                            "entity_kind": kind,
                            "entity_id": eid,
                            "definition_paths": list(paths),
                        },
                    )
                )
    return findings


def _resolvable_ids(id_maps: dict[str, dict[str, list[str]]]) -> set[str]:
    """IDs that leads_to / exit targets may point at (scenes + npcs)."""
    return set(id_maps["scene"]) | set(id_maps["npc"])


def _check_reference_integrity(
    compiled: dict[str, Any],
    id_maps: dict[str, dict[str, list[str]]],
) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    scene_ids = set(id_maps["scene"])
    clue_ids = set(id_maps["clue"])
    npc_ids = set(id_maps["npc"])
    lead_targets = _resolvable_ids(id_maps)

    for i, scene in enumerate((compiled.get("story_graph") or {}).get("scenes") or []):
        if not isinstance(scene, dict):
            continue
        base = f"story_graph.scenes[{i}]"
        for target in scene.get("exit_targets") or []:
            if target not in scene_ids:
                findings.append(
                    _finding(
                        "broken_reference",
                        "error",
                        f"exit_target '{target}' does not resolve to a scene_id",
                        path=f"{base}.exit_targets",
                    )
                )
        for clue_id in scene.get("available_clues") or []:
            if clue_id not in clue_ids:
                findings.append(
                    _finding(
                        "broken_reference",
                        "error",
                        f"available_clues entry '{clue_id}' does not resolve to a clue_id",
                        path=f"{base}.available_clues",
                        details={
                            "reference_kind": "available_clue",
                            "ref_id": clue_id,
                            "owner_kind": "scene",
                            "owner_id": scene.get("scene_id"),
                            "definition_kind": "clue",
                        },
                    )
                )
        for j, affordance in enumerate(scene.get("affordances") or []):
            if not isinstance(affordance, dict):
                continue
            bound_clue_ids = [
                affordance.get("clue_id"),
                *(affordance.get("grants_clue_ids") or []),
            ]
            for clue_id in bound_clue_ids:
                if clue_id and clue_id not in clue_ids:
                    findings.append(
                        _finding(
                            "broken_reference",
                            "error",
                            f"affordance clue binding '{clue_id}' does not resolve to a clue_id",
                            path=f"{base}.affordances[{j}]",
                        )
                    )
            completion_policy = affordance.get("completion_policy")
            if completion_policy is not None and completion_policy not in {
                "matched_no_roll", "repeatable",
            }:
                findings.append(_finding(
                    "invalid_affordance_completion", "error",
                    "completion_policy must be matched_no_roll or repeatable",
                    path=f"{base}.affordances[{j}].completion_policy",
                ))
            if completion_policy == "matched_no_roll" and not _is_string_list(
                affordance.get("sets_flags")
            ):
                findings.append(_finding(
                    "invalid_affordance_completion", "error",
                    "matched_no_roll completion requires non-empty sets_flags",
                    path=f"{base}.affordances[{j}].sets_flags",
                ))
            runtime_status = affordance.get("runtime_status")
            if runtime_status is not None and runtime_status != "NOT_IMPLEMENTED":
                findings.append(_finding(
                    "invalid_affordance_runtime_status", "error",
                    "runtime_status may only be NOT_IMPLEMENTED",
                    path=f"{base}.affordances[{j}].runtime_status",
                ))
            if runtime_status == "NOT_IMPLEMENTED" and not _is_string_list(
                affordance.get("required_typed_operations")
            ):
                findings.append(_finding(
                    "invalid_affordance_runtime_status", "error",
                    "NOT_IMPLEMENTED routes require non-empty required_typed_operations",
                    path=f"{base}.affordances[{j}].required_typed_operations",
                ))
            authored_operation = affordance.get("authored_operation")
            if authored_operation is not None and (
                not isinstance(authored_operation, dict)
                or set(authored_operation) != {"kind", "payload"}
                or authored_operation.get("kind") not in {
                    "environmental_hazard", "mythos_tome_study",
                }
                or not isinstance(authored_operation.get("payload"), dict)
            ):
                findings.append(_finding(
                    "invalid_authored_operation", "error",
                    "authored_operation requires supported kind and payload",
                    path=f"{base}.affordances[{j}].authored_operation",
                ))
            skill_minimums = affordance.get("skill_minimums")
            if skill_minimums is not None and (
                not isinstance(skill_minimums, dict)
                or not skill_minimums
                or any(
                    not isinstance(skill, str)
                    or not skill.strip()
                    or isinstance(minimum, bool)
                    or not isinstance(minimum, int)
                    or not 0 <= minimum <= 100
                    or skill not in (affordance.get("skills") or [])
                    for skill, minimum in (
                        skill_minimums.items()
                        if isinstance(skill_minimums, dict)
                        else []
                    )
                )
            ):
                findings.append(_finding(
                    "invalid_affordance_skill_minimum", "error",
                    "skill_minimums must map declared skills to integer 0..100",
                    path=f"{base}.affordances[{j}].skill_minimums",
                ))
            roll_gate = affordance.get("roll_gate")
            if roll_gate is not None:
                approaches = (
                    roll_gate.get("approaches")
                    if isinstance(roll_gate, dict)
                    else None
                )
                declared_verbs = affordance.get("verbs")
                declared_skills = affordance.get("skills")
                ordinary_failure = (
                    roll_gate.get("ordinary_failure")
                    if isinstance(roll_gate, dict)
                    else None
                )
                push_consequence = (
                    roll_gate.get("push_failure_consequence")
                    if isinstance(roll_gate, dict)
                    else None
                )
                push_effect = (
                    push_consequence.get("effect")
                    if isinstance(push_consequence, dict)
                    else None
                )
                fumble_consequence = (
                    roll_gate.get("fumble_consequence")
                    if isinstance(roll_gate, dict)
                    else None
                )
                fumble_effect = (
                    fumble_consequence.get("effect")
                    if isinstance(fumble_consequence, dict)
                    else None
                )
                valid_approaches = bool(
                    isinstance(approaches, list)
                    and approaches
                    and all(
                        isinstance(approach, dict)
                        and set(approach) == {"verb", "skill"}
                        and isinstance(approach.get("verb"), str)
                        and approach["verb"].strip()
                        and isinstance(approach.get("skill"), str)
                        and approach["skill"].strip()
                        and approach["verb"] in (declared_verbs or [])
                        and approach["skill"] in (declared_skills or [])
                        for approach in approaches
                    )
                    and len({
                        (approach["verb"], approach["skill"])
                        for approach in approaches
                    }) == len(approaches)
                )
                if (
                    not isinstance(roll_gate, dict)
                    or set(roll_gate) not in ({
                        "kind", "difficulty", "stakes", "ordinary_failure",
                        "fumble_consequence", "push_failure_consequence",
                        "approaches",
                    }, {
                        "kind", "difficulty", "stakes", "ordinary_failure",
                        "fumble_consequence", "push_failure_consequence",
                        "approaches", "retry_policy",
                    })
                    or roll_gate.get("kind") != "skill_check"
                    or roll_gate.get("difficulty") not in {
                        "regular", "hard", "extreme",
                    }
                    or not isinstance(roll_gate.get("stakes"), str)
                    or not roll_gate["stakes"].strip()
                    or not _is_string_list(declared_verbs)
                    or not _is_string_list(declared_skills)
                    or len(set(declared_verbs)) != len(declared_verbs)
                    or len(set(declared_skills)) != len(declared_skills)
                    or not valid_approaches
                    or not isinstance(ordinary_failure, dict)
                    or not {"mode", "summary"} <= set(ordinary_failure)
                    or set(ordinary_failure) - {"mode", "summary", "localized_summaries"}
                    or ordinary_failure.get("mode") != "no_progress"
                    or not isinstance(ordinary_failure.get("summary"), str)
                    or not ordinary_failure["summary"].strip()
                    or not _is_localized_summary_map(ordinary_failure.get("localized_summaries"))
                    or not isinstance(fumble_consequence, dict)
                    or not {"summary", "effect"} <= set(fumble_consequence)
                    or set(fumble_consequence) - {"summary", "effect", "localized_summaries"}
                    or not isinstance(fumble_consequence.get("summary"), str)
                    or not fumble_consequence["summary"].strip()
                    or not _is_localized_summary_map(fumble_consequence.get("localized_summaries"))
                    or not _is_typed_consequence_effect(fumble_effect)
                    or not isinstance(push_consequence, dict)
                    or not {"summary", "effect"} <= set(push_consequence)
                    or set(push_consequence) - {"summary", "effect", "localized_summaries"}
                    or not isinstance(push_consequence.get("summary"), str)
                    or not push_consequence["summary"].strip()
                    or not _is_localized_summary_map(push_consequence.get("localized_summaries"))
                    or not isinstance(push_effect, dict)
                    or set(push_effect) != {"kind", "route_id"}
                    or push_effect.get("kind") != "route_closed"
                    or push_effect.get("route_id") != affordance.get("id")
                    or not _is_retry_policy(roll_gate.get("retry_policy"))
                ):
                    findings.append(_finding(
                        "invalid_affordance_roll_gate", "error",
                        "roll_gate requires declared unique verbs/skills and "
                        "one or more exact {verb, skill} approaches",
                        path=f"{base}.affordances[{j}].roll_gate",
                    ))
        for npc_id in scene.get("npc_ids") or []:
            if npc_id not in npc_ids:
                findings.append(
                    _finding(
                        "broken_reference",
                        "error",
                        f"npc_ids entry '{npc_id}' does not resolve to an npc_id",
                        path=f"{base}.npc_ids",
                    )
                )
        scene_npc_ids = {
            str(value) for value in (scene.get("npc_ids") or [])
            if str(value or "").strip()
        }
        scene_route_ids = {
            str(value.get("id") or value.get("route_id"))
            for value in (scene.get("affordances") or [])
            if isinstance(value, dict)
            and str(value.get("id") or value.get("route_id") or "").strip()
        }
        presence_rows = scene.get("npc_presence_requirements") or []
        seen_presence_npc_ids: set[str] = set()
        if not isinstance(presence_rows, list):
            findings.append(_finding(
                "invalid_npc_presence_requirements", "error",
                "npc_presence_requirements must be a list",
                path=f"{base}.npc_presence_requirements",
            ))
            presence_rows = []
        for j, row in enumerate(presence_rows):
            row_path = f"{base}.npc_presence_requirements[{j}]"
            if not isinstance(row, dict) or set(row) != {
                "npc_id", "requires_completed_route_ids",
            }:
                findings.append(_finding(
                    "invalid_npc_presence_requirement", "error",
                    "each NPC presence requirement must contain exactly npc_id and requires_completed_route_ids",
                    path=row_path,
                ))
                continue
            presence_npc_id = str(row.get("npc_id") or "").strip()
            required_routes = row.get("requires_completed_route_ids")
            if (
                not presence_npc_id
                or presence_npc_id not in scene_npc_ids
                or presence_npc_id in seen_presence_npc_ids
                or not _is_string_list(required_routes)
                or not required_routes
                or len(set(required_routes)) != len(required_routes)
                or not set(required_routes).issubset(scene_route_ids)
            ):
                findings.append(_finding(
                    "invalid_npc_presence_requirement", "error",
                    "npc_id must be unique and present in scene.npc_ids; required route IDs must be a non-empty unique subset of scene affordances",
                    path=row_path,
                ))
                continue
            seen_presence_npc_ids.add(presence_npc_id)
        for exit_cond in scene.get("exit_conditions") or []:
            if isinstance(exit_cond, dict) and exit_cond.get("kind") == "clue_discovered":
                cid = exit_cond.get("clue_id")
                if cid and cid not in clue_ids:
                    findings.append(
                        _finding(
                            "broken_reference",
                            "error",
                            f"exit_conditions clue_id '{cid}' does not resolve",
                            path=f"{base}.exit_conditions",
                        )
                    )

    for path, clue in _iter_clues(compiled):
        for target in clue.get("leads_to") or []:
            if target not in lead_targets:
                findings.append(
                    _finding(
                        "broken_reference",
                        "error",
                        f"leads_to '{target}' does not resolve to a scene_id or npc_id",
                        path=f"{path}.leads_to",
                    )
                )
    return findings


def _scene_edges(
    compiled: dict[str, Any],
    clue_by_id: dict[str, dict[str, Any]],
) -> dict[str, set[str]]:
    """Build scene→scene adjacency for reachability checks.

    Preference order (R-3):
    1. Explicit ``scene_edges[].to`` when any scene declares ``scene_edges``
    2. Structured ``exit_targets`` + clue ``leads_to`` (compile-time hints)
    """
    edges: dict[str, set[str]] = {}
    scenes = [
        s for s in ((compiled.get("story_graph") or {}).get("scenes") or [])
        if isinstance(s, dict) and s.get("scene_id")
    ]
    scene_ids = {str(s["scene_id"]) for s in scenes}
    declares_edges = any("scene_edges" in s for s in scenes)
    for scene in scenes:
        sid = str(scene["scene_id"])
        edges.setdefault(sid, set())
        if declares_edges:
            for raw in scene.get("scene_edges") or []:
                if not isinstance(raw, dict):
                    continue
                target = raw.get("to")
                if target in scene_ids:
                    edges[sid].add(str(target))
            continue
        for target in scene.get("exit_targets") or []:
            if target in scene_ids:
                edges[sid].add(str(target))
        for clue_id in scene.get("available_clues") or []:
            clue = clue_by_id.get(str(clue_id))
            if not clue:
                continue
            for target in clue.get("leads_to") or []:
                if target in scene_ids:
                    edges[sid].add(str(target))
    return edges


def _check_scene_edge_targets(
    compiled: dict[str, Any],
    id_maps: dict[str, dict[str, list[str]]],
) -> list[dict[str, str]]:
    """Validate ``scene_edges[].to`` resolve to known scene_ids."""
    findings: list[dict[str, str]] = []
    scene_ids = set(id_maps["scene"])
    for i, scene in enumerate((compiled.get("story_graph") or {}).get("scenes") or []):
        if not isinstance(scene, dict):
            continue
        for j, raw in enumerate(scene.get("scene_edges") or []):
            if not isinstance(raw, dict):
                findings.append(
                    _finding(
                        "invalid_scene_edge",
                        "error",
                        "scene_edges entry must be an object with to/when/kind",
                        path=f"story_graph.scenes[{i}].scene_edges[{j}]",
                    )
                )
                continue
            target = raw.get("to")
            if not target or target not in scene_ids:
                findings.append(
                    _finding(
                        "broken_reference",
                        "error",
                        f"scene_edges.to '{target}' does not resolve to a scene_id",
                        path=f"story_graph.scenes[{i}].scene_edges[{j}].to",
                    )
                )
    return findings


def _check_reachability(compiled: dict[str, Any]) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    scenes = [
        s for s in ((compiled.get("story_graph") or {}).get("scenes") or [])
        if isinstance(s, dict) and s.get("scene_id")
    ]
    if not scenes:
        return findings
    starts = [s for s in scenes if s.get("is_start") is True]
    if len(starts) != 1:
        return findings  # start presence handled separately
    start_id = str(starts[0]["scene_id"])
    clue_by_id = {
        str(c["clue_id"]): c
        for _, c in _iter_clues(compiled)
        if c.get("clue_id")
    }
    edges = _scene_edges(compiled, clue_by_id)
    reachable: set[str] = set()
    queue: deque[str] = deque([start_id])
    while queue:
        cur = queue.popleft()
        if cur in reachable:
            continue
        reachable.add(cur)
        for nxt in edges.get(cur, ()):
            if nxt not in reachable:
                queue.append(nxt)
    for scene in scenes:
        sid = str(scene["scene_id"])
        if sid not in reachable:
            findings.append(
                _finding(
                    "unreachable_scene",
                    "warning",
                    f"scene '{sid}' is unreachable from start '{start_id}' (orphan/dead node)",
                    path=f"story_graph.scenes/{sid}",
                )
            )
    return findings


def _check_multi_route_independence(compiled: dict[str, Any]) -> list[dict[str, str]]:
    """Require distinct clue_ids >= minimum_routes for conclusions that declare it.

    Gap: the schema has no separate alternate-route identity beyond the clues[]
    list; independence is approximated as unique clue_id count.
    """
    findings: list[dict[str, str]] = []
    for i, concl in enumerate((compiled.get("clue_graph") or {}).get("conclusions") or []):
        if not isinstance(concl, dict):
            continue
        importance = concl.get("importance")
        min_routes = concl.get("minimum_routes")
        if min_routes is None:
            if importance == "critical":
                min_routes = 3
            else:
                continue
        clues = [c for c in (concl.get("clues") or []) if isinstance(c, dict)]
        distinct = {str(c["clue_id"]) for c in clues if c.get("clue_id")}
        if len(distinct) < int(min_routes):
            cid = concl.get("conclusion_id") or i
            findings.append(
                _finding(
                    "insufficient_routes",
                    "error",
                    (
                        f"conclusion '{cid}' declares minimum_routes={min_routes} but only "
                        f"{len(distinct)} distinct clue_id routes "
                        f"(schema has no separate alternate_route identity)"
                    ),
                    path=f"clue_graph.conclusions[{i}]",
                )
            )
    return findings


def _check_start_finale(compiled: dict[str, Any]) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    scenes = [
        s for s in ((compiled.get("story_graph") or {}).get("scenes") or [])
        if isinstance(s, dict)
    ]
    starts = [s for s in scenes if s.get("is_start") is True]
    if not starts:
        findings.append(
            _finding(
                "missing_start",
                "error",
                "exactly one scene with is_start=true is required",
                path="story_graph.scenes",
            )
        )
    elif len(starts) > 1:
        ids = [s.get("scene_id") for s in starts]
        findings.append(
            _finding(
                "multiple_starts",
                "error",
                f"exactly one start scene required; found {len(starts)}: {ids}",
                path="story_graph.scenes",
            )
        )
    finales = [s for s in scenes if _is_finale_scene(s)]
    if not finales:
        findings.append(
            _finding(
                "missing_finale",
                "error",
                "at least one finale/resolution scene required (is_final=true or scene_type=resolution)",
                path="story_graph.scenes",
            )
        )
    return findings


def _segment_text_for_page(
    source_segments: list[dict[str, Any]] | None,
    page: int,
) -> str:
    if not source_segments:
        return ""
    parts: list[str] = []
    for seg in source_segments:
        if not isinstance(seg, dict):
            continue
        if seg.get("page") == page:
            parts.append(str(seg.get("text") or ""))
    return "\n".join(parts)


def _check_source_refs(
    compiled: dict[str, Any],
    source_segments: list[dict[str, Any]] | None,
) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    if source_segments is None:
        return findings

    def _check_refs(refs: Any, owner_path: str) -> None:
        for ri, ref in enumerate(refs or []):
            if not isinstance(ref, dict):
                continue
            anchor = ref.get("grep_anchor")
            page = ref.get("page")
            if not anchor or not isinstance(page, int):
                continue
            text = _segment_text_for_page(source_segments, page)
            if anchor not in text:
                findings.append(
                    _finding(
                        "missing_source_anchor",
                        "error",
                        f"source_ref grep_anchor not found in compile input segments for page {page}",
                        path=f"{owner_path}.source_refs[{ri}]",
                    )
                )

    for i, scene in enumerate((compiled.get("story_graph") or {}).get("scenes") or []):
        if isinstance(scene, dict):
            _check_refs(scene.get("source_refs"), f"story_graph.scenes[{i}]")
    for path, clue in _iter_clues(compiled):
        _check_refs(clue.get("source_refs"), path)
    for i, npc in enumerate((compiled.get("npc_agendas") or {}).get("npcs") or []):
        if isinstance(npc, dict):
            _check_refs(npc.get("source_refs"), f"npc_agendas.npcs[{i}]")
    for i, front in enumerate((compiled.get("threat_fronts") or {}).get("fronts") or []):
        if isinstance(front, dict):
            _check_refs(front.get("source_refs"), f"threat_fronts.fronts[{i}]")
    return findings


_AFFORDANCE_KEYS = frozenset({"target_entities", "verbs", "skills"})


def _check_clue_affordances(compiled: dict[str, Any]) -> list[dict[str, str]]:
    """G1: shape-check optional clue ``affordance`` blocks (warnings only).

    A well-formed block is a dict whose keys are a subset of
    {target_entities, verbs, skills}, each holding a list of strings.
    Absent blocks are fine (backward compatible).
    """
    findings: list[dict[str, str]] = []
    for i, concl in enumerate((compiled.get("clue_graph") or {}).get("conclusions") or []):
        if not isinstance(concl, dict):
            continue
        for j, clue in enumerate(concl.get("clues") or []):
            if not isinstance(clue, dict):
                continue
            path = f"clue_graph.conclusions[{i}].clues[{clue.get('clue_id') or j}]"
            if clue.get("delivery_kind") == "skill_check" and not clue.get("skill"):
                findings.append(_finding(
                    "missing_delivery_skill", "warning",
                    "skill_check delivery requires a skill",
                    path=path,
                    details={"clue_id": clue.get("clue_id")},
                ))
            if "affordance" not in clue:
                continue
            block = clue.get("affordance")
            if not isinstance(block, dict):
                findings.append(_finding(
                    "invalid_affordance", "warning",
                    "affordance must be an object with target_entities/verbs/skills lists",
                    path=path,
                ))
                continue
            unknown = sorted(set(block) - _AFFORDANCE_KEYS)
            if unknown:
                findings.append(_finding(
                    "invalid_affordance", "warning",
                    f"affordance has unknown keys {unknown}; allowed: {sorted(_AFFORDANCE_KEYS)}",
                    path=path,
                ))
            for key in _AFFORDANCE_KEYS:
                if key not in block:
                    continue
                value = block[key]
                if not isinstance(value, list) or any(not isinstance(v, str) for v in value):
                    findings.append(_finding(
                        "invalid_affordance", "warning",
                        f"affordance.{key} must be a list of strings",
                        path=path,
                    ))
    return findings


def _check_location_tags(compiled: dict[str, Any]) -> list[dict[str, str]]:
    """R-5: shape-check optional scene ``location_tags`` (warnings only).

    A well-formed value is a list of non-empty strings. Absent is fine.
    """
    findings: list[dict[str, str]] = []
    for i, scene in enumerate((compiled.get("story_graph") or {}).get("scenes") or []):
        if not isinstance(scene, dict) or "location_tags" not in scene:
            continue
        path = f"story_graph.scenes[{scene.get('scene_id') or i}]"
        tags = scene.get("location_tags")
        if not isinstance(tags, list) or any(
            not isinstance(t, str) or not str(t).strip() for t in tags
        ):
            findings.append(_finding(
                "invalid_location_tags",
                "warning",
                "location_tags must be a list of non-empty strings",
                path=path,
            ))
    return findings


def _check_destination_access(compiled: dict[str, Any]) -> list[dict[str, str]]:
    """Validate optional structured discoverability/direct-entry authority."""
    findings: list[dict[str, str]] = []
    expected_keys = {"schema_version", "discoverability", "direct_entry"}
    for i, scene in enumerate((compiled.get("story_graph") or {}).get("scenes") or []):
        if not isinstance(scene, dict) or "destination_access" not in scene:
            continue
        path = f"story_graph.scenes[{scene.get('scene_id') or i}].destination_access"
        access = scene.get("destination_access")
        valid = bool(
            isinstance(access, dict)
            and set(access) == expected_keys
            and access.get("schema_version") == 1
            and access.get("discoverability") in {
                "public", "evidence_gated", "hidden",
            }
            and access.get("direct_entry") in {
                "independent", "requires_unlock",
            }
            and not (
                access.get("direct_entry") == "independent"
                and access.get("discoverability") != "public"
            )
        )
        if not valid:
            findings.append(_finding(
                "invalid_destination_access",
                "error",
                "destination_access must be exact schema v1; only public destinations may use independent direct entry",
                path=path,
            ))
    return findings


def _check_provenance(compiled: dict[str, Any]) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []

    def _flag(entry: dict[str, Any], path: str) -> None:
        origin = entry.get("origin")
        if origin is None:
            findings.append(
                _finding(
                    "missing_origin",
                    "warning",
                    "entry missing origin (expected source|inferred|improvised)",
                    path=path,
                    details={"entry_path": path},
                )
            )
        elif origin not in VALID_ORIGINS:
            findings.append(
                _finding(
                    "invalid_origin",
                    "warning",
                    f"origin '{origin}' not in {sorted(VALID_ORIGINS)}",
                    path=path,
                )
            )

    for i, scene in enumerate((compiled.get("story_graph") or {}).get("scenes") or []):
        if isinstance(scene, dict):
            _flag(scene, f"story_graph.scenes[{i}]")
    for i, concl in enumerate((compiled.get("clue_graph") or {}).get("conclusions") or []):
        if not isinstance(concl, dict):
            continue
        _flag(concl, f"clue_graph.conclusions[{i}]")
        for j, clue in enumerate(concl.get("clues") or []):
            if isinstance(clue, dict):
                _flag(clue, f"clue_graph.conclusions[{i}].clues[{j}]")
    for i, npc in enumerate((compiled.get("npc_agendas") or {}).get("npcs") or []):
        if isinstance(npc, dict):
            _flag(npc, f"npc_agendas.npcs[{i}]")
    for i, front in enumerate((compiled.get("threat_fronts") or {}).get("fronts") or []):
        if isinstance(front, dict):
            _flag(front, f"threat_fronts.fronts[{i}]")
    return findings


def _check_time_loop_signal_contract(
    compiled: dict[str, Any],
) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    scenes = (compiled.get("story_graph") or {}).get("scenes") or []
    for index, scene in enumerate(scenes):
        if not isinstance(scene, dict) or not (
            {"loop_boundary", "player_retained_memory_ids"} & set(scene)
        ):
            continue
        _canonical, signal_findings = (
            coc_director_strategies.validate_time_loop_signals({
                "loop_boundary": scene.get("loop_boundary", False),
                "player_retained_memory_ids": scene.get(
                    "player_retained_memory_ids", []
                ),
            })
        )
        if signal_findings:
            findings.append(_finding(
                "strategy_signals_invalid", "error",
                "time-loop strategy signals require boolean loop_boundary and "
                "unique non-empty string[] player_retained_memory_ids",
                path=f"story_graph.scenes[{index}]",
            ))
    return findings


def _default_origin(entry: dict[str, Any]) -> str:
    if entry.get("improvised") is True:
        return "improvised"
    if entry.get("derived") is True or entry.get("inferred") is True:
        return "inferred"
    existing = entry.get("origin")
    if existing in VALID_ORIGINS:
        return str(existing)
    return "source"


def annotate_provenance(compiled: dict[str, Any]) -> dict[str, Any]:
    """Fill ``origin`` (and optional ``confidence``) on compiled entries in-place.

    Defaults to ``source`` for directly extracted nodes; ``inferred`` when
    ``derived``/``inferred`` flags are set; ``improvised`` when marked as such.
    Existing valid ``origin`` values are preserved.
    """
    def _annotate(entry: dict[str, Any]) -> None:
        if entry.get("origin") not in VALID_ORIGINS:
            entry["origin"] = _default_origin(entry)
        if entry.get("origin") == "inferred":
            entry.setdefault("confidence", 0.6)
        elif entry.get("origin") == "source":
            entry.setdefault("confidence", 1.0)
        elif entry.get("origin") == "improvised":
            entry.setdefault("confidence", 0.4)

    for scene in (compiled.get("story_graph") or {}).get("scenes") or []:
        if isinstance(scene, dict):
            _annotate(scene)
    for concl in (compiled.get("clue_graph") or {}).get("conclusions") or []:
        if not isinstance(concl, dict):
            continue
        _annotate(concl)
        for clue in concl.get("clues") or []:
            if isinstance(clue, dict):
                _annotate(clue)
    for npc in (compiled.get("npc_agendas") or {}).get("npcs") or []:
        if isinstance(npc, dict):
            _annotate(npc)
    for front in (compiled.get("threat_fronts") or {}).get("fronts") or []:
        if isinstance(front, dict):
            _annotate(front)
    return compiled



def _check_epistemic_sidecars(
    compiled: dict[str, Any],
    id_maps: dict[str, dict[str, list[str]]],
) -> list[dict[str, str]]:
    """Validate optional question/evidence/reveal sidecars.

    The check is ID- and enum-driven only. Missing sidecars are valid legacy
    mode; malformed opt-in sidecars fail closed for core references.
    """
    raw_graph = compiled.get("epistemic_graph")
    raw_contracts = compiled.get("reveal_contracts")
    if raw_graph in (None, {}) and raw_contracts in (None, {}):
        return []

    findings: list[dict[str, str]] = []
    if raw_graph is not None and not isinstance(raw_graph, dict):
        findings.append(_finding(
            "invalid_epistemic_sidecar", "error",
            "epistemic_graph must be an object when present",
            path="epistemic_graph",
        ))
    if raw_contracts is not None and not isinstance(raw_contracts, dict):
        findings.append(_finding(
            "invalid_epistemic_sidecar", "error",
            "reveal_contracts must be an object when present",
            path="reveal_contracts",
        ))
    graph = raw_graph if isinstance(raw_graph, dict) else {}
    contracts_doc = raw_contracts if isinstance(raw_contracts, dict) else {}
    clue_ids = set(id_maps.get("clue", {}))

    questions: dict[str, dict[str, Any]] = {}
    duplicate_questions: set[str] = set()
    for index, question in enumerate(graph.get("questions") or []):
        path = f"epistemic_graph.questions[{index}]"
        if not isinstance(question, dict):
            findings.append(_finding(
                "invalid_epistemic_question", "error",
                "epistemic question must be an object", path=path,
            ))
            continue
        question_id = str(question.get("question_id") or "").strip()
        if not question_id:
            findings.append(_finding(
                "invalid_epistemic_question", "error",
                "epistemic question requires question_id", path=path,
            ))
            continue
        if question_id in questions:
            duplicate_questions.add(question_id)
        questions[question_id] = question
        if not str(question.get("player_facing_question") or "").strip():
            findings.append(_finding(
                "invalid_epistemic_question", "error",
                f"question '{question_id}' requires player_facing_question",
                path=f"{path}.player_facing_question",
            ))
        if not str(question.get("truth_ref") or "").strip():
            findings.append(_finding(
                "invalid_epistemic_question", "error",
                f"question '{question_id}' requires truth_ref",
                path=f"{path}.truth_ref",
            ))
        layer = question.get("layer")
        if layer not in VALID_EPISTEMIC_LAYERS:
            findings.append(_finding(
                "invalid_epistemic_layer", "error",
                f"question '{question_id}' layer '{layer}' not in {sorted(VALID_EPISTEMIC_LAYERS)}",
                path=f"{path}.layer",
            ))
        for opened in question.get("opens_questions") or []:
            if not isinstance(opened, str):
                findings.append(_finding(
                    "broken_epistemic_reference", "error",
                    f"question '{question_id}' opens_questions entries must be ids",
                    path=f"{path}.opens_questions",
                ))
        if question.get("importance") == "critical" and not question.get("source_refs"):
            findings.append(_finding(
                "critical_question_missing_source", "warning",
                f"critical question '{question_id}' has no source_refs",
                path=path,
            ))
    for question_id in sorted(duplicate_questions):
        findings.append(_finding(
            "duplicate_epistemic_question", "error",
            f"duplicate epistemic question id '{question_id}'",
            path="epistemic_graph.questions",
        ))

    links_by_question: dict[str, int] = {}
    reframe_pairs: set[tuple[str, str]] = set()
    for index, link in enumerate(graph.get("evidence_links") or []):
        path = f"epistemic_graph.evidence_links[{index}]"
        if not isinstance(link, dict):
            findings.append(_finding(
                "invalid_epistemic_link", "error",
                "evidence link must be an object", path=path,
            ))
            continue
        clue_id = link.get("clue_id")
        question_id = link.get("question_id")
        effect = link.get("effect")
        if clue_id not in clue_ids:
            findings.append(_finding(
                "broken_epistemic_reference", "error",
                f"evidence link clue_id '{clue_id}' does not resolve",
                path=f"{path}.clue_id",
            ))
        if question_id not in questions:
            findings.append(_finding(
                "broken_epistemic_reference", "error",
                f"evidence link question_id '{question_id}' does not resolve",
                path=f"{path}.question_id",
            ))
        else:
            links_by_question[str(question_id)] = links_by_question.get(str(question_id), 0) + 1
        if effect not in VALID_EPISTEMIC_EFFECTS:
            findings.append(_finding(
                "invalid_epistemic_effect", "error",
                f"evidence effect '{effect}' not in {sorted(VALID_EPISTEMIC_EFFECTS)}",
                path=f"{path}.effect",
            ))
        elif effect == "reframe" and isinstance(question_id, str) and isinstance(clue_id, str):
            reframe_pairs.add((question_id, clue_id))
        strength = link.get("strength")
        if strength is not None:
            try:
                numeric = float(strength)
            except (TypeError, ValueError):
                numeric = -1.0
            if numeric < 0.0 or numeric > 1.0:
                findings.append(_finding(
                    "invalid_epistemic_strength", "warning",
                    f"evidence strength for clue '{clue_id}' should be within 0..1",
                    path=f"{path}.strength",
                ))

    for question_id, question in questions.items():
        if question.get("importance") == "critical" and links_by_question.get(question_id, 0) == 0:
            findings.append(_finding(
                "critical_question_without_evidence", "warning",
                f"critical question '{question_id}' has no evidence links",
                path=f"epistemic_graph.questions/{question_id}",
            ))
        for opened in question.get("opens_questions") or []:
            if isinstance(opened, str) and opened not in questions:
                findings.append(_finding(
                    "broken_epistemic_reference", "error",
                    f"question '{question_id}' opens missing question '{opened}'",
                    path=f"epistemic_graph.questions/{question_id}.opens_questions",
                ))

    covered_reframes: set[tuple[str, str]] = set()
    reveal_contract_ids: set[str] = set()
    for index, contract in enumerate(contracts_doc.get("contracts") or []):
        path = f"reveal_contracts.contracts[{index}]"
        if not isinstance(contract, dict):
            findings.append(_finding(
                "invalid_reveal_contract", "error",
                "reveal contract must be an object", path=path,
            ))
            continue
        reveal_contract_id = str(contract.get("reveal_contract_id") or "").strip()
        if not reveal_contract_id:
            findings.append(_finding(
                "invalid_reveal_contract", "error",
                "reveal contract requires reveal_contract_id",
                path=f"{path}.reveal_contract_id",
            ))
        elif reveal_contract_id in reveal_contract_ids:
            findings.append(_finding(
                "duplicate_reveal_contract", "error",
                f"duplicate reveal contract id '{reveal_contract_id}'",
                path=f"{path}.reveal_contract_id",
            ))
        else:
            reveal_contract_ids.add(reveal_contract_id)
        mode = str(contract.get("mode") or "").lower()
        if mode not in VALID_REVEAL_MODES:
            findings.append(_finding(
                "invalid_reveal_contract", "error",
                f"reveal mode '{mode}' not in {sorted(VALID_REVEAL_MODES)}",
                path=f"{path}.mode",
            ))
        question_id = contract.get("target_question_id")
        if question_id not in questions:
            findings.append(_finding(
                "broken_epistemic_reference", "error",
                f"reveal contract target_question_id '{question_id}' does not resolve",
                path=f"{path}.target_question_id",
            ))
        trigger_ids = [
            value for value in contract.get("trigger_clue_ids") or []
            if isinstance(value, str) and value.strip()
        ]
        if mode == "reframe" and not trigger_ids:
            findings.append(_finding(
                "invalid_reframe_contract", "error",
                "reframe contract requires at least one trigger_clue_id",
                path=f"{path}.trigger_clue_ids",
            ))
        for clue_id in trigger_ids:
            if clue_id not in clue_ids:
                findings.append(_finding(
                    "broken_epistemic_reference", "error",
                    f"reveal contract trigger clue '{clue_id}' does not resolve",
                    path=f"{path}.trigger_clue_ids",
                ))
            if mode == "reframe" and isinstance(question_id, str):
                covered_reframes.add((question_id, clue_id))
        for clue_id in contract.get("setup_refs") or []:
            if clue_id not in clue_ids:
                findings.append(_finding(
                    "broken_epistemic_reference", "error",
                    f"reveal contract setup ref '{clue_id}' does not resolve",
                    path=f"{path}.setup_refs",
                ))
        for opened in contract.get("opens_questions") or []:
            if opened not in questions:
                findings.append(_finding(
                    "broken_epistemic_reference", "error",
                    f"reveal contract opens missing question '{opened}'",
                    path=f"{path}.opens_questions",
                ))
        if mode == "reframe":
            setup_refs = [value for value in contract.get("setup_refs") or [] if isinstance(value, str)]
            if len(set(setup_refs)) < 2:
                findings.append(_finding(
                    "invalid_reframe_contract", "error",
                    "reframe contract requires at least two setup_refs",
                    path=f"{path}.setup_refs",
                ))
            preserve = [value for value in contract.get("preserve_as_true") or [] if isinstance(value, str) and value.strip()]
            if not preserve:
                findings.append(_finding(
                    "invalid_reframe_contract", "error",
                    "reframe contract requires non-empty preserve_as_true",
                    path=f"{path}.preserve_as_true",
                ))

    for question_id, clue_id in sorted(reframe_pairs - covered_reframes):
        findings.append(_finding(
            "reframe_missing_contract", "warning",
            f"reframe evidence ({question_id}, {clue_id}) has no matching reveal contract",
            path="epistemic_graph.evidence_links",
        ))

    confidence_doc = compiled.get("compile_confidence")
    if confidence_doc is not None and not isinstance(confidence_doc, dict):
        findings.append(_finding(
            "invalid_compile_confidence_node", "error",
            "compile_confidence must be an object when present",
            path="compile_confidence",
        ))
        confidence_doc = {}
    confidence_doc = confidence_doc if isinstance(confidence_doc, dict) else {}
    valid_targets = {
        "question": set(questions),
        "reveal_contract": set(reveal_contract_ids),
    }
    accepted_review_states = {
        "auto_accepted", "manual_accepted", "needs_review", "rejected",
    }
    seen_confidence_nodes: set[tuple[str, str]] = set()
    for index, record in enumerate(confidence_doc.get("nodes") or []):
        path = f"compile_confidence.nodes[{index}]"
        if not isinstance(record, dict):
            findings.append(_finding(
                "invalid_compile_confidence_node", "error",
                "compile confidence node must be an object", path=path,
            ))
            continue
        node_type = str(record.get("node_type") or "").strip()
        node_id = str(record.get("node_id") or "").strip()
        if node_type not in valid_targets:
            findings.append(_finding(
                "invalid_compile_confidence_node", "error",
                f"compile confidence node_type '{node_type}' is not supported",
                path=f"{path}.node_type",
            ))
            continue
        if not node_id:
            findings.append(_finding(
                "invalid_compile_confidence_node", "error",
                "compile confidence node requires node_id",
                path=f"{path}.node_id",
            ))
            continue
        key = (node_type, node_id)
        if key in seen_confidence_nodes:
            findings.append(_finding(
                "duplicate_compile_confidence_node", "error",
                f"duplicate compile confidence node ({node_type}, {node_id})",
                path=path,
            ))
        else:
            seen_confidence_nodes.add(key)
        if node_id not in valid_targets[node_type]:
            findings.append(_finding(
                "broken_epistemic_reference", "error",
                f"compile confidence {node_type} node_id '{node_id}' does not resolve",
                path=f"{path}.node_id",
            ))
        review_state = str(record.get("review_state") or "needs_review")
        if review_state not in accepted_review_states:
            findings.append(_finding(
                "invalid_compile_confidence_node", "error",
                f"compile confidence review_state '{review_state}' is not supported",
                path=f"{path}.review_state",
            ))
        for field in (
            "semantic_confidence", "source_confidence", "effective_confidence",
        ):
            if field not in record:
                continue
            try:
                value = float(record[field])
            except (TypeError, ValueError):
                value = -1.0
            if value < 0.0 or value > 1.0:
                findings.append(_finding(
                    "invalid_compile_confidence_node", "error",
                    f"{field} for ({node_type}, {node_id}) must be within 0..1",
                    path=f"{path}.{field}",
                ))
    return findings



def _iter_source_owned_nodes(compiled: dict[str, Any]):
    """Yield (path, refs, critical) for structured authored nodes."""
    for i, question in enumerate((compiled.get("epistemic_graph") or {}).get("questions") or []):
        if isinstance(question, dict) and question.get("source_refs"):
            yield (
                f"epistemic_graph.questions[{i}]",
                question.get("source_refs") or [],
                question.get("importance") == "critical",
            )
    for ci, conclusion in enumerate((compiled.get("clue_graph") or {}).get("conclusions") or []):
        if not isinstance(conclusion, dict):
            continue
        critical = conclusion.get("importance") == "critical"
        for qi, clue in enumerate(conclusion.get("clues") or []):
            if isinstance(clue, dict) and clue.get("source_refs"):
                yield (
                    f"clue_graph.conclusions[{ci}].clues[{qi}]",
                    clue.get("source_refs") or [],
                    critical or clue.get("importance") == "critical",
                )
    for i, scene in enumerate((compiled.get("story_graph") or {}).get("scenes") or []):
        if isinstance(scene, dict) and scene.get("source_refs"):
            yield (
                f"story_graph.scenes[{i}]",
                scene.get("source_refs") or [],
                scene.get("importance") == "critical" or scene.get("is_final") is True,
            )
    for i, npc in enumerate((compiled.get("npc_agendas") or {}).get("npcs") or []):
        if isinstance(npc, dict) and npc.get("source_refs"):
            yield (
                f"npc_agendas.npcs[{i}]",
                npc.get("source_refs") or [],
                npc.get("importance") == "critical",
            )
    for i, front in enumerate((compiled.get("threat_fronts") or {}).get("fronts") or []):
        if isinstance(front, dict) and front.get("source_refs"):
            yield (
                f"threat_fronts.fronts[{i}]",
                front.get("source_refs") or [],
                front.get("importance") == "critical",
            )


def _check_source_evidence(
    compiled: dict[str, Any],
    source_bundle: dict[str, Any] | None,
    *,
    strict_sources: bool,
) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    nodes = list(_iter_source_owned_nodes(compiled))
    if not nodes:
        return findings
    if not isinstance(source_bundle, dict):
        if strict_sources:
            for owner_path, _refs, critical in nodes:
                findings.append(_finding(
                    "unresolved_source_locator",
                    "error" if critical else "warning",
                    "source refs are present but no source evidence bundle was supplied",
                    path=owner_path,
                ))
        return findings
    page_map = source_bundle.get("page_map") or {}
    manifest = source_bundle.get("parse_manifest") or {}
    segments = source_bundle.get("evidence_segments") or []
    if not (page_map.get("sources") or manifest.get("ranges")) and not strict_sources:
        return findings
    for owner_path, refs, critical in nodes:
        result = coc_pdf_source.critical_source_allowed(
            [ref for ref in refs if isinstance(ref, dict)],
            manifest,
            [seg for seg in segments if isinstance(seg, dict)],
            page_map=page_map,
            source_root=source_bundle.get("source_root") or source_bundle.get("base_dir"),
        )
        if result.get("allowed"):
            continue
        source_findings = result.get("findings") or [{
            "code": "unresolved_source_locator",
            "message": "source evidence did not resolve",
        }]
        for source_finding in source_findings:
            findings.append(_finding(
                str(source_finding.get("code") or "unresolved_source_locator"),
                "error" if critical else "warning",
                str(source_finding.get("message") or "source evidence did not resolve"),
                path=owner_path,
            ))
    return findings


def validate_compiled_scenario(
    compiled: dict[str, Any],
    source_segments: list[dict[str, Any]] | None = None,
    *,
    source_bundle: dict[str, Any] | None = None,
    strict_sources: bool = False,
) -> list[dict[str, str]]:
    """Structured validation pass over an in-memory compiled scenario.

    Returns findings with ``{code, severity, path, message}``. Operates only on
    structured fields and IDs (Semantic Matcher Constitution).
    """
    id_maps = _collect_id_maps(compiled)
    findings: list[dict[str, str]] = []
    findings.extend(_check_id_uniqueness(id_maps))
    findings.extend(_check_reference_integrity(compiled, id_maps))
    findings.extend(_check_scene_edge_targets(compiled, id_maps))
    findings.extend(_check_start_finale(compiled))
    findings.extend(_check_reachability(compiled))
    findings.extend(_check_multi_route_independence(compiled))
    findings.extend(_check_source_refs(compiled, source_segments))
    findings.extend(_check_provenance(compiled))
    findings.extend(_check_clue_affordances(compiled))
    findings.extend(_check_location_tags(compiled))
    findings.extend(_check_destination_access(compiled))
    findings.extend(_check_scene_function_contract(compiled))
    findings.extend(_check_scene_affinity_contract(compiled))
    findings.extend(_check_threat_affinity_contract(compiled))
    findings.extend(_check_threat_clock_identity_contract(compiled))
    findings.extend(_check_npc_disclosure_contract(compiled))
    findings.extend(_check_time_loop_signal_contract(compiled))
    findings.extend(_check_epistemic_sidecars(compiled, id_maps))
    findings.extend(_check_source_evidence(
        compiled, source_bundle, strict_sources=strict_sources
    ))
    findings.extend(coc_epistemic_lifecycle.validate_question_lifecycle(
        compiled.get("epistemic_graph"),
        clue_ids=set(id_maps.get("clue", {})),
        scene_ids=set(id_maps.get("scene", {})),
    ))
    return findings


def doctor(*, rules_dir: Path | None = None) -> list[dict[str, Any]]:
    """Check the runtime environment needed by the scenario compiler.

    Returns structured results with ``check``, ``ok``, ``severity``, ``message``.
    """
    results: list[dict[str, Any]] = []
    py_ok = tuple(sys.version_info[:3]) == REQUIRED_PYTHON
    results.append(
        {
            "check": "python_version",
            "code": "python_version",
            "ok": py_ok,
            "severity": "error" if not py_ok else "info",
            "message": (
                f"Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}; "
                f"require CPython {'.'.join(str(part) for part in REQUIRED_PYTHON)}"
            ),
        }
    )
    # This module is stdlib-only; surface that assumption for CI/docs.
    results.append(
        {
            "check": "stdlib_only",
            "code": "stdlib_only",
            "ok": True,
            "severity": "info",
            "message": "coc_scenario_compile assumes stdlib-only (json/pathlib/collections/sys)",
        }
    )
    root = rules_dir or _rules_json_dir()
    for name in DOCTOR_RULES_JSON_FILES:
        path = root / name
        present = path.is_file()
        results.append(
            {
                "check": f"rules_json:{name}",
                "code": "rules_json",
                "ok": present,
                "severity": "error" if not present else "info",
                "message": (
                    f"rules-json table present: {path}"
                    if present
                    else f"missing rules-json table: {path}"
                ),
            }
        )
    return results


def load_compiled_from_dir(scenario_dir: Path) -> dict[str, Any]:
    """Load on-disk scenario JSON files into the in-memory compiled shape."""
    return {
        "module_meta": _read(scenario_dir / "module-meta.json") if (scenario_dir / "module-meta.json").exists() else {},
        "story_graph": _read(scenario_dir / "story-graph.json") if (scenario_dir / "story-graph.json").exists() else {"scenes": []},
        "clue_graph": _read(scenario_dir / "clue-graph.json") if (scenario_dir / "clue-graph.json").exists() else {"conclusions": []},
        "npc_agendas": _read(scenario_dir / "npc-agendas.json") if (scenario_dir / "npc-agendas.json").exists() else {"npcs": []},
        "threat_fronts": _read(scenario_dir / "threat-fronts.json") if (scenario_dir / "threat-fronts.json").exists() else {"fronts": []},
        "epistemic_graph": _read(scenario_dir / "epistemic-graph.json") if (scenario_dir / "epistemic-graph.json").exists() else {},
        "reveal_contracts": _read(scenario_dir / "reveal-contracts.json") if (scenario_dir / "reveal-contracts.json").exists() else {},
        "compile_confidence": _read(scenario_dir / "compile-confidence.json") if (scenario_dir / "compile-confidence.json").exists() else {},
    }


def validate_scenario(scenario_dir: Path) -> dict[str, list[str]]:
    """Validate a compiled story-graph. Returns {'errors': [...], 'warnings': [...]}."""
    errors: list[str] = []
    warnings: list[str] = []

    for fname in REQUIRED_FILES:
        if not (scenario_dir / fname).exists():
            errors.append(f"missing required file: {fname}")
    if errors:
        return {"errors": errors, "warnings": warnings}

    meta = _read(scenario_dir / "module-meta.json")
    if meta.get("structure_type") not in VALID_STRUCTURE_TYPES:
        errors.append(f"module-meta.structure_type '{meta.get('structure_type')}' not in {sorted(VALID_STRUCTURE_TYPES)}")

    # Optional module_identity block (registry / cache key). Missing -> warning;
    # present but malformed -> warning (shape only; never fuzzy-match titles).
    identity = meta.get("module_identity")
    if identity is None:
        warnings.append(
            "module-meta.module_identity missing; "
            "new compiles should emit structured identity for module-library reuse"
        )
    elif not isinstance(identity, dict):
        warnings.append("module-meta.module_identity must be an object when present")
    else:
        cid = identity.get("canonical_module_id")
        if cid is not None and (
            not isinstance(cid, str)
            or not cid.strip()
            or not all(c.isalnum() or c == "-" for c in cid)
        ):
            warnings.append(
                "module-meta.module_identity.canonical_module_id must be a non-empty kebab-case slug"
            )
        for field in ("canonical_title", "edition", "module_edition", "rules_edition"):
            val = identity.get(field)
            if val is not None and (not isinstance(val, str) or not val.strip()):
                warnings.append(
                    f"module-meta.module_identity.{field} must be a non-empty string when present"
                )
        for field in ("publisher", "locale", "chapter"):
            val = identity.get(field)
            if val is not None and not isinstance(val, str):
                warnings.append(
                    f"module-meta.module_identity.{field} must be a string when present"
                )
        parent = identity.get("parent_module_id")
        if parent is not None:
            if (
                not isinstance(parent, str)
                or not parent.strip()
                or not all(c.isalnum() or c == "-" for c in parent)
            ):
                warnings.append(
                    "module-meta.module_identity.parent_module_id must be a non-empty kebab-case slug"
                )
        aliases = identity.get("aliases")
        if aliases is not None:
            if not isinstance(aliases, list):
                warnings.append("module-meta.module_identity.aliases must be a list when present")
            else:
                for i, alias in enumerate(aliases):
                    if not isinstance(alias, dict):
                        warnings.append(
                            f"module-meta.module_identity.aliases[{i}] must be an object"
                        )
                        continue
                    if not str(alias.get("title") or "").strip():
                        warnings.append(
                            f"module-meta.module_identity.aliases[{i}].title is required"
                        )

    # Optional setting_tags on module-meta: structured setting axis for
    # storylet eligibility (storylet-schema.md). Present -> must be a list of
    # non-empty strings; bad shape is an error (runtime consumes it blindly).
    if "setting_tags" in meta and not _is_string_list(meta.get("setting_tags")):
        errors.append("module-meta.setting_tags must be a list of non-empty strings")

    handoff = meta.get("chapter_handoff")
    if handoff is not None:
        if not isinstance(handoff, dict) or set(handoff) != {"mode", "target_module_id"}:
            errors.append(
                "module-meta.chapter_handoff must contain exactly mode and target_module_id"
            )
        else:
            if handoff.get("mode") != "auto_on_terminal":
                errors.append("module-meta.chapter_handoff.mode must be auto_on_terminal")
            target = handoff.get("target_module_id")
            if not isinstance(target, str) or not target.strip():
                errors.append("module-meta.chapter_handoff.target_module_id is required")

    story = _read(scenario_dir / "story-graph.json")
    for scene in story.get("scenes", []):
        if not scene.get("dramatic_question"):
            errors.append(f"scene '{scene.get('scene_id')}' missing dramatic_question")
        if not scene.get("scene_id"):
            errors.append("scene missing scene_id")
        if "destination_access" in scene:
            access = scene.get("destination_access")
            if not (
                isinstance(access, dict)
                and set(access) == {
                    "schema_version", "discoverability", "direct_entry",
                }
                and access.get("schema_version") == 1
                and access.get("discoverability") in {
                    "public", "evidence_gated", "hidden",
                }
                and access.get("direct_entry") in {
                    "independent", "requires_unlock",
                }
                and not (
                    access.get("direct_entry") == "independent"
                    and access.get("discoverability") != "public"
                )
            ):
                errors.append(
                    f"scene '{scene.get('scene_id')}' destination_access invalid: "
                    "only exact schema v1 public+independent or gated/hidden+requires_unlock is allowed"
                )
        authored_function_fields = [key for key in SCENE_FUNCTION_KEYS if key in scene]
        if authored_function_fields:
            try:
                normalized_function = normalize_scene_function(scene)
                if set(authored_function_fields) != set(SCENE_FUNCTION_KEYS):
                    raise ValueError("authored contract must contain all six fields")
                if any(scene[key] != normalized_function[key] for key in SCENE_FUNCTION_KEYS):
                    raise ValueError("contract is not canonical")
            except ValueError as exc:
                errors.append(
                    f"scene '{scene.get('scene_id')}' scene function contract invalid: {exc}"
                )
        if "setting_tags" in scene and not _is_string_list(scene.get("setting_tags")):
            errors.append(
                f"scene '{scene.get('scene_id')}' setting_tags must be a list of non-empty strings"
            )
        if {"loop_boundary", "player_retained_memory_ids"} & set(scene):
            _signals, signal_findings = (
                coc_director_strategies.validate_time_loop_signals({
                    "loop_boundary": scene.get("loop_boundary", False),
                    "player_retained_memory_ids": scene.get(
                        "player_retained_memory_ids", []
                    ),
                })
            )
            if signal_findings:
                errors.append(
                    f"scene '{scene.get('scene_id')}' time-loop strategy signals invalid: "
                    "loop_boundary must be bool and player_retained_memory_ids "
                    "must be unique non-empty string[]"
                )
        # 软警告：social/investigation 场景宜有多路线 affordances（P0-1 数据引导）
        scene_type = str(scene.get("scene_type") or "")
        if scene_type in ("social", "investigation"):
            affordances = scene.get("affordances") or []
            if not isinstance(affordances, list) or len(affordances) < 2:
                warnings.append(
                    f"scene '{scene.get('scene_id')}' ({scene_type}) has fewer than 2 "
                    f"affordances; multi-route fork hints recommended so players have choices"
                )
        # on_enter warnings: validate structure when present (soft, backward-compat).
        on_enter = scene.get("on_enter")
        if isinstance(on_enter, dict):
            for trig in (on_enter.get("san_triggers") or []):
                if isinstance(trig, dict) and not trig.get("san_loss_fail_expr"):
                    warnings.append(f"scene '{scene.get('scene_id')}' san_trigger missing san_loss_fail_expr")
            for ct in (on_enter.get("clock_ticks") or []):
                if isinstance(ct, dict) and not ct.get("clock_id"):
                    warnings.append(f"scene '{scene.get('scene_id')}' clock_tick missing clock_id")

    clue_graph = _read(scenario_dir / "clue-graph.json")
    for concl in clue_graph.get("conclusions", []):
        if concl.get("importance") == "critical":
            min_routes = concl.get("minimum_routes", 3)
            actual = len(concl.get("clues", []))
            if actual < min_routes:
                errors.append(f"conclusion '{concl.get('conclusion_id')}' critical but only {actual} routes (need >={min_routes})")
            non_fragile = [clue for clue in concl.get("clues", []) if _is_non_fragile_clue_route(clue)]
            if not non_fragile and not _has_recoverable_fallback(concl):
                errors.append(
                    f"conclusion '{concl.get('conclusion_id')}' critical but has no non-fragile route or RECOVER fallback"
                )
            for clue in concl.get("clues", []):
                if not clue.get("delivery_kind"):
                    warnings.append(
                        f"clue '{clue.get('clue_id')}' in critical conclusion '{concl.get('conclusion_id')}' uses legacy delivery without delivery_kind"
                    )

    npcs = _read(scenario_dir / "npc-agendas.json")
    for npc in npcs.get("npcs", []):
        if not npc.get("agenda"):
            errors.append(f"npc '{npc.get('npc_id')}' missing agenda")
    errors.extend(
        finding["message"]
        for finding in validate_npc_a21_contract(npcs, clue_graph)
    )

    fronts_data = _read(scenario_dir / "threat-fronts.json")
    scene_affinity_findings = _check_scene_affinity_contract({
        "story_graph": story,
    })
    errors.extend(finding["message"] for finding in scene_affinity_findings)
    threat_affinity_findings = _check_threat_affinity_contract({
        "threat_fronts": fronts_data,
    })
    errors.extend(finding["message"] for finding in threat_affinity_findings)
    clock_identity_findings = _check_threat_clock_identity_contract({
        "threat_fronts": fronts_data,
    })
    errors.extend(finding["message"] for finding in clock_identity_findings)
    improv = _read(scenario_dir / "improvisation-boundaries.json")
    # Compare against secret ids only (prose / id:description stay planner-side).
    secrets = set()
    for index, secret in enumerate(improv.get("keeper_secrets", []) or []):
        if isinstance(secret, dict):
            sid = str(secret.get("id") or "").strip()
            if sid:
                secrets.add(sid)
            continue
        text = str(secret or "").strip()
        if ": " in text:
            prefix = text.split(": ", 1)[0].strip()
            if prefix and " " not in prefix and len(prefix) <= 80:
                secrets.add(prefix)
                continue
        if text and " " not in text and len(text) <= 80:
            secrets.add(text)
        elif text:
            secrets.add(f"secret_{index + 1:03d}")
    # check secrets don't leak into player-safe clue visibility
    for concl in clue_graph.get("conclusions", []):
        for clue in concl.get("clues", []):
            if clue.get("visibility") == "player-safe" and clue.get("clue_id") in secrets:
                errors.append(f"clue '{clue.get('clue_id')}' marked player-safe but is a keeper_secret")

    # --- Structured delivery field warnings (clue-graph) ---
    # These are warnings (not errors) so old clue-graphs without the new
    # delivery_kind / source_refs fields still validate cleanly. Only flag
    # scenarios that opt into the structured fields but fill them in malformed.
    # page convention: integer page is a PRINTED page number by default;
    # optional page_kind may be "printed" (default) or "pdf_index" — never guess.
    def _warn_source_refs(refs: Any, owner_label: str) -> None:
        for ref in refs or []:
            if not isinstance(ref, dict):
                continue
            legacy_ok = bool(ref.get("path")) and isinstance(ref.get("page"), int)
            structured_ok = bool(ref.get("source_id")) and (
                isinstance(ref.get("printed_page"), int)
                or isinstance(ref.get("pdf_index"), int)
            )
            if not legacy_ok and not structured_ok:
                warnings.append(
                    f"{owner_label} source_ref needs path+page or source_id+printed_page/pdf_index"
                )
            page_kind = ref.get("page_kind")
            if page_kind is not None and page_kind not in VALID_PAGE_KINDS:
                warnings.append(
                    f"{owner_label} source_ref page_kind must be "
                    f"'printed' or 'pdf_index' (got {page_kind!r})"
                )

    for concl in clue_graph.get("conclusions", []):
        for clue in concl.get("clues", []):
            dk = clue.get("delivery_kind")
            if dk == "skill_check" and not clue.get("skill"):
                warnings.append(f"clue '{clue.get('clue_id')}' has delivery_kind=skill_check but no skill")
            _warn_source_refs(clue.get("source_refs"), f"clue '{clue.get('clue_id')}'")
            if "bonus" in clue:
                errors.extend(_check_clue_bonus(clue))

    # source_refs warnings on scenes/npcs/fronts
    for scene in story.get("scenes", []):
        _warn_source_refs(scene.get("source_refs"), f"scene '{scene.get('scene_id')}'")
    for npc in npcs.get("npcs", []):
        _warn_source_refs(npc.get("source_refs"), f"npc '{npc.get('npc_id')}'")
    for front in fronts_data.get("fronts", []):
        _warn_source_refs(front.get("source_refs"), f"front '{front.get('front_id')}'")

    # horror_stage monotonicity check on pacing-map.pacing_curve.
    # Stages should broadly advance ordinary->wrongness->pattern->revelation.
    # A scene may stay at the same stage or advance; a minor dip of 1 is
    # acceptable, but a regression of more than 1 from the max rank reached
    # so far (e.g. revelation back to ordinary) is an error.
    stage_rank = {"ordinary": 0, "wrongness": 1, "pattern": 2, "revelation": 3}
    pacing_path = scenario_dir / "pacing-map.json"
    if pacing_path.exists():
        pacing = _read(pacing_path)
        curve = pacing.get("pacing_curve")
        if isinstance(curve, list):
            max_rank = -1
            max_stage = None
            for entry in curve:
                stage = entry.get("horror_stage")
                rank = stage_rank.get(stage)
                if rank is None:
                    continue  # unknown stage; not this check's concern
                if max_rank >= 0 and rank < max_rank - 1:
                    errors.append(
                        f"pacing-map horror_stage regressed: scene '{entry.get('scene_id')}' "
                        f"is '{stage}' after reaching '{max_stage}'"
                    )
                if rank > max_rank:
                    max_rank = rank
                    max_stage = stage

    compiled = load_compiled_from_dir(scenario_dir)
    epi_findings = _check_epistemic_sidecars(compiled, _collect_id_maps(compiled))
    index_dir = scenario_dir.parent / "index"
    source_bundle = None
    if (index_dir / "page-map.json").exists() or (index_dir / "parse-manifest.json").exists():
        source_bundle = coc_pdf_source.load_source_bundle(scenario_dir.parent)
    epi_findings.extend(_check_source_evidence(
        compiled, source_bundle, strict_sources=False
    ))
    for finding in epi_findings:
        rendered = f"{finding.get('code')}: {finding.get('message')}"
        if finding.get("severity") == "error":
            errors.append(rendered)
        else:
            warnings.append(rendered)

    return {"errors": errors, "warnings": warnings}


def _main() -> int:
    import argparse

    parser = argparse.ArgumentParser(
        prog="coc_scenario_compile.py",
        description="Validate a compiled scenario story-graph (compilation Layer 2).",
    )
    parser.add_argument(
        "scenario_dir",
        nargs="?",
        default=None,
        help="path to the compiled scenario directory",
    )
    parser.add_argument(
        "--validate",
        action="store_true",
        help="always validates (accepted for documentation consistency with SKILL.md)",
    )
    parser.add_argument(
        "--doctor",
        action="store_true",
        help="check compiler runtime dependencies and print structured results",
    )
    parser.add_argument(
        "--structured",
        action="store_true",
        help="also run validate_compiled_scenario and print JSON findings",
    )
    args = parser.parse_args()

    if args.doctor:
        results = doctor()
        print(json.dumps(results, indent=2, ensure_ascii=False))
        if any(not r.get("ok", True) and r.get("severity") == "error" for r in results):
            return 1
        return 0

    if not args.scenario_dir:
        parser.error("scenario_dir is required unless --doctor is set")

    scenario_dir = Path(args.scenario_dir)
    result = validate_scenario(scenario_dir)
    errors = result.get("errors", [])
    warnings = result.get("warnings", [])

    for w in warnings:
        print(f"WARNING: {w}")
    for e in errors:
        print(f"ERROR: {e}")

    if args.structured:
        findings = validate_compiled_scenario(load_compiled_from_dir(scenario_dir))
        print(json.dumps(findings, indent=2, ensure_ascii=False))
        if any(f.get("severity") == "error" for f in findings):
            return 1

    if errors:
        return 1
    print("OK: scenario story-graph valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
