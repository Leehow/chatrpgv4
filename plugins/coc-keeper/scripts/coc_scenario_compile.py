#!/usr/bin/env python3
"""Story-graph structure validator (compilation Layer 2).

Validates that LLM-compiled scenario story-graph files meet the structural
requirements the director depends on. Run after coc-scenario-import compiles
a module. Reports errors (must fix) and warnings (soft).

Also provides ``validate_compiled_scenario`` (structured findings), provenance
annotation, and a dependency ``doctor`` for CI / local env checks (R-5).

Spec: docs/superpowers/specs/2026-07-05-story-director-design.md
"""
from __future__ import annotations

import json
import sys
from collections import deque
from pathlib import Path
from typing import Any

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
MIN_PYTHON = (3, 11)


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
) -> dict[str, str]:
    return {"code": code, "severity": severity, "path": path, "message": message}


VALID_BONUS_DIFFICULTIES = {"regular", "hard", "extreme"}
VALID_BONUS_FAIL_COSTS = {"time", "pressure"}


def _is_string_list(value: Any) -> bool:
    """True when ``value`` is a list of non-empty strings."""
    return isinstance(value, list) and all(
        isinstance(item, str) and item.strip() for item in value
    )


def _check_clue_bonus(clue: dict[str, Any]) -> list[str]:
    """Shape-check an optional clue ``bonus`` block (storylet-schema.md).

    Non-gating dice texture: skill + extra_summary are required strings;
    difficulty defaults to regular, on_fail_cost defaults to time.
    """
    cid = clue.get("clue_id")
    bonus = clue.get("bonus")
    if not isinstance(bonus, dict):
        return [f"clue '{cid}' bonus must be an object"]
    errors: list[str] = []
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
                    )
                )
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
            if not isinstance(clue, dict) or "affordance" not in clue:
                continue
            path = f"clue_graph.conclusions[{i}].clues[{clue.get('clue_id') or j}]"
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
    graph = compiled.get("epistemic_graph")
    contracts_doc = compiled.get("reveal_contracts")
    if not isinstance(graph, dict) and not isinstance(contracts_doc, dict):
        return []
    graph = graph if isinstance(graph, dict) else {}
    contracts_doc = contracts_doc if isinstance(contracts_doc, dict) else {}
    findings: list[dict[str, str]] = []
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
    return findings


def validate_compiled_scenario(
    compiled: dict[str, Any],
    source_segments: list[dict[str, Any]] | None = None,
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
    findings.extend(_check_epistemic_sidecars(compiled, id_maps))
    return findings


def doctor(*, rules_dir: Path | None = None) -> list[dict[str, Any]]:
    """Check the runtime environment needed by the scenario compiler.

    Returns structured results with ``check``, ``ok``, ``severity``, ``message``.
    """
    results: list[dict[str, Any]] = []
    py_ok = sys.version_info[:2] >= MIN_PYTHON
    results.append(
        {
            "check": "python_version",
            "code": "python_version",
            "ok": py_ok,
            "severity": "error" if not py_ok else "info",
            "message": (
                f"Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}; "
                f"require >={MIN_PYTHON[0]}.{MIN_PYTHON[1]}"
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

    story = _read(scenario_dir / "story-graph.json")
    for scene in story.get("scenes", []):
        if not scene.get("dramatic_question"):
            errors.append(f"scene '{scene.get('scene_id')}' missing dramatic_question")
        if not scene.get("scene_id"):
            errors.append("scene missing scene_id")
        if "setting_tags" in scene and not _is_string_list(scene.get("setting_tags")):
            errors.append(
                f"scene '{scene.get('scene_id')}' setting_tags must be a list of non-empty strings"
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

    fronts_data = _read(scenario_dir / "threat-fronts.json")
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
            if not ref.get("path") or not isinstance(ref.get("page"), int):
                warnings.append(f"{owner_label} source_ref missing path or integer page")
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
