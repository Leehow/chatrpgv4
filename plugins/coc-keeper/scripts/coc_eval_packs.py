#!/usr/bin/env python3
"""Machine-validated benchmark-pack registry for eval-spec-v1."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


EVAL_SPEC = "eval-spec-v1"
PACK_REGISTRY_PATH = Path("evaluation/spec/v1/benchmark-packs.json")
CASE_REGISTRY_PATH = Path("evaluation/spec/v1/case-registry.json")
BENCHMARK_MANIFEST_PATH = Path("evaluation/spec/v1/benchmark-manifest.json")
LONG_MEMORY_PATH = Path("evaluation/spec/v1/cases/long-memory.json")
CHAPTER_TRANSITION_PATH = Path("evaluation/spec/v1/cases/chapter-transition.json")
EXPECTED_PACK_IDS = frozenset(
    {
        "rules-micro",
        "runtime-invariants",
        "module-hydration",
        "haunting-golden",
        "chase-combat-drill",
        "agency-redirection",
        "zh-prose",
        "long-memory-50",
        "masks-peru-america",
    }
)
VALID_DOMAINS = frozenset(
    {
        "reliability",
        "rules",
        "module-fidelity-and-continuity",
        "agency-and-fun",
        "zh-prose",
        "reports-and-evidence",
    }
)
VALID_MODES = frozenset({"snapshot", "locked-replay", "end-to-end-ai"})
VALID_SUITES = frozenset({"pr", "nightly", "release"})
VALID_RESOURCE_CLASSES = frozenset(
    {"deterministic", "external-model", "external-model-and-human-review"}
)
VALID_ROUTE_KINDS = frozenset(
    {"registered_case", "matrix_case", "continuity_lane", "release_external_bundle"}
)
PACK_ID_RE = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")


def _read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"benchmark pack dependency missing or malformed: {path}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"benchmark pack dependency must be an object: {path}")
    return payload


def _string_list(value: Any, *, field: str) -> list[str]:
    if not isinstance(value, list) or not value:
        raise ValueError(f"invalid {field}")
    if not all(isinstance(item, str) and item for item in value):
        raise ValueError(f"invalid {field}")
    result = list(value)
    if len(result) != len(set(result)):
        raise ValueError(f"duplicate {field}")
    return result


def _available_case_suites(case: dict[str, Any]) -> set[str]:
    suites = set(case.get("suites") or [])
    if case.get("gate") == "hard" and suites & {"smoke", "pr"}:
        suites.update({"nightly", "release"})
    return suites


def validate_benchmark_pack_registry(
    root: Path | str,
    payload: Any,
    *,
    manifest: dict[str, Any] | None = None,
) -> dict[str, Any]:
    repo = Path(root)
    if not isinstance(payload, dict):
        raise ValueError("benchmark pack registry must be an object")
    if payload.get("schema_version") != 1 or payload.get("eval_spec") != EVAL_SPEC:
        raise ValueError("invalid benchmark pack registry identity")
    if not isinstance(payload.get("registry_version"), str) or not payload["registry_version"]:
        raise ValueError("invalid benchmark pack registry version")
    raw_packs = payload.get("packs")
    if not isinstance(raw_packs, list):
        raise ValueError("benchmark pack registry missing packs")

    case_registry = _read_json(repo / CASE_REGISTRY_PATH)
    cases = {
        str(case.get("case_id")): case
        for case in case_registry.get("cases") or []
        if isinstance(case, dict) and isinstance(case.get("case_id"), str)
    }
    benchmark = manifest or _read_json(repo / BENCHMARK_MANIFEST_PATH)
    matrix_suites = ((benchmark.get("matrix") or {}).get("suites") or {})
    matrix_ids_by_suite = {
        suite: {
            str(case.get("case_id"))
            for case in (definition.get("cases") or [])
            if isinstance(case, dict) and isinstance(case.get("case_id"), str)
        }
        for suite, definition in matrix_suites.items()
        if isinstance(definition, dict)
    }
    continuity_lane_ids = {
        str(lane.get("lane_id"))
        for lane in (_read_json(repo / LONG_MEMORY_PATH).get("lanes") or [])
        if isinstance(lane, dict) and isinstance(lane.get("lane_id"), str)
    }
    chapter_lane_ids = {
        str(lane.get("lane_id"))
        for lane in (_read_json(repo / CHAPTER_TRANSITION_PATH).get("lanes") or [])
        if isinstance(lane, dict) and isinstance(lane.get("lane_id"), str)
    }

    seen: set[str] = set()
    validated: list[dict[str, Any]] = []
    for index, raw_pack in enumerate(raw_packs):
        if not isinstance(raw_pack, dict):
            raise ValueError(f"benchmark pack {index} must be an object")
        pack = dict(raw_pack)
        pack_id = pack.get("pack_id")
        if not isinstance(pack_id, str) or PACK_ID_RE.fullmatch(pack_id) is None:
            raise ValueError(f"invalid benchmark pack_id: {pack_id!r}")
        if pack_id in seen:
            raise ValueError(f"duplicate benchmark pack_id: {pack_id}")
        seen.add(pack_id)
        if not isinstance(pack.get("description"), str) or not pack["description"]:
            raise ValueError(f"invalid benchmark pack description: {pack_id}")
        domains = _string_list(pack.get("domains"), field=f"{pack_id}.domains")
        modes = _string_list(pack.get("modes"), field=f"{pack_id}.modes")
        suites = _string_list(pack.get("suites"), field=f"{pack_id}.suites")
        evidence = _string_list(
            pack.get("official_evidence"), field=f"{pack_id}.official_evidence"
        )
        if not set(domains) <= VALID_DOMAINS:
            raise ValueError(f"invalid benchmark pack domains: {pack_id}")
        if not set(modes) <= VALID_MODES:
            raise ValueError(f"invalid benchmark pack modes: {pack_id}")
        if not set(suites) <= VALID_SUITES:
            raise ValueError(f"invalid benchmark pack suites: {pack_id}")
        if pack.get("resource_class") not in VALID_RESOURCE_CLASSES:
            raise ValueError(f"invalid benchmark pack resource_class: {pack_id}")
        route = pack.get("route")
        if not isinstance(route, dict) or route.get("kind") not in VALID_ROUTE_KINDS:
            raise ValueError(f"invalid benchmark pack route: {pack_id}")
        route_kind = str(route["kind"])
        if route_kind == "registered_case":
            case_id = route.get("case_id")
            case = cases.get(str(case_id))
            if case is None or not set(suites) <= _available_case_suites(case):
                raise ValueError(f"unresolved registered case route: {pack_id}")
        elif route_kind == "matrix_case":
            case_ids = route.get("case_ids_by_suite")
            if not isinstance(case_ids, dict) or set(case_ids) != set(suites):
                raise ValueError(f"invalid matrix case route: {pack_id}")
            if any(
                not isinstance(case_ids[suite], str)
                or case_ids[suite] not in matrix_ids_by_suite.get(suite, set())
                for suite in suites
            ):
                raise ValueError(f"unresolved matrix case route: {pack_id}")
        elif route_kind == "continuity_lane":
            if route.get("lane_id") not in continuity_lane_ids:
                raise ValueError(f"unresolved continuity lane route: {pack_id}")
        elif route_kind == "release_external_bundle":
            if (
                suites != ["release"]
                or route.get("chapter_lane_id") not in chapter_lane_ids
                or route.get("required_gate_lane_ids")
                != ["chapter_transition", "holdout", "human_calibration"]
            ):
                raise ValueError(f"unresolved release external lane route: {pack_id}")
        pack["domains"] = domains
        pack["modes"] = modes
        pack["suites"] = suites
        pack["official_evidence"] = evidence
        validated.append(pack)

    if seen != EXPECTED_PACK_IDS:
        missing = sorted(EXPECTED_PACK_IDS - seen)
        extra = sorted(seen - EXPECTED_PACK_IDS)
        raise ValueError(f"benchmark pack set mismatch: missing={missing}, extra={extra}")
    return {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "registry_version": payload["registry_version"],
        "packs": validated,
    }


def load_benchmark_pack_registry(
    root: Path | str,
    *,
    path: Path | str | None = None,
    manifest: dict[str, Any] | None = None,
) -> dict[str, Any]:
    repo = Path(root)
    registry_path = Path(path) if path is not None else repo / PACK_REGISTRY_PATH
    return validate_benchmark_pack_registry(
        repo, _read_json(registry_path), manifest=manifest
    )
