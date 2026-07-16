#!/usr/bin/env python3
"""Artifact-mediated semantic compilation of epistemic scenario sidecars.

Deterministic code prepares structured, player-safe inputs and validates a
provenance-bound external semantic result. It does not infer module meaning.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_fileio
import coc_pdf_source
import coc_scenario_compile

CONTRACT_PATH = SCRIPT_DIR / "epistemic-contract.json"
CONTRACT = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
EVALUATOR_ID = str(CONTRACT["evaluator_id"])
REQUEST_FILENAME = str(CONTRACT["provenance"]["reviewed_artifact"])
RESULT_FILENAME = "epistemic-compile-result.json"
RESULT_ROOT_KEYS = tuple(CONTRACT["ordered_root_keys"])
RESULT_DOCUMENT_KEYS = tuple(CONTRACT["document_keys"])
SIDECAR_FILES = (
    "epistemic-graph.json",
    "reveal-contracts.json",
    "compile-confidence.json",
)
BASE_SCENARIO_FILES = (
    "module-meta.json",
    "story-graph.json",
    "clue-graph.json",
    "npc-agendas.json",
    "threat-fronts.json",
    "pacing-map.json",
    "improvisation-boundaries.json",
)


def _read(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return copy.deepcopy(fallback)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return copy.deepcopy(fallback)


def _write(path: Path, payload: Any) -> None:
    coc_fileio.write_json_atomic(
        path, payload, indent=2, ensure_ascii=False, trailing_newline=True
    )


def request_sha256(request: dict[str, Any]) -> str:
    encoded = json.dumps(
        request, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _safe_source_refs(value: Any) -> list[dict[str, Any]]:
    allowed = {
        "source_id",
        "path",
        "page",
        "page_kind",
        "pdf_index",
        "printed_page",
        "printed_label",
        "grep_anchor",
        "text_sha256",
    }
    return [
        {key: ref[key] for key in allowed if key in ref}
        for ref in (value or [])
        if isinstance(ref, dict)
    ]


def _safe_scenes(document: dict[str, Any]) -> list[dict[str, Any]]:
    allowed = {
        "scene_id", "scene_type", "is_start", "is_final", "dramatic_question",
        "available_clues", "npc_ids", "scene_edges", "location_tags",
        "setting_tags", "storylet_tags", "source_refs", "origin", "importance",
    }
    result: list[dict[str, Any]] = []
    for scene in document.get("scenes") or []:
        if not isinstance(scene, dict):
            continue
        safe = {key: copy.deepcopy(scene[key]) for key in allowed if key in scene}
        if "source_refs" in safe:
            safe["source_refs"] = _safe_source_refs(safe["source_refs"])
        result.append(safe)
    return result


def _safe_conclusions(document: dict[str, Any]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for conclusion in document.get("conclusions") or []:
        if not isinstance(conclusion, dict):
            continue
        safe_conclusion = {
            key: copy.deepcopy(conclusion[key])
            for key in (
                "conclusion_id", "importance", "minimum_routes", "fallback_policy",
                "origin", "source_refs",
            )
            if key in conclusion
        }
        if "source_refs" in safe_conclusion:
            safe_conclusion["source_refs"] = _safe_source_refs(safe_conclusion["source_refs"])
        clues: list[dict[str, Any]] = []
        for clue in conclusion.get("clues") or []:
            if not isinstance(clue, dict):
                continue
            safe_clue = {
                key: copy.deepcopy(clue[key])
                for key in (
                    "clue_id", "delivery_kind", "skill", "difficulty", "visibility",
                    "player_safe_summary", "player_visible_anchor", "leads_to",
                    "route_priority", "affordance", "origin", "importance", "source_refs",
                )
                if key in clue
            }
            if "source_refs" in safe_clue:
                safe_clue["source_refs"] = _safe_source_refs(safe_clue["source_refs"])
            clues.append(safe_clue)
        safe_conclusion["clues"] = clues
        result.append(safe_conclusion)
    return result


def _safe_npcs(document: dict[str, Any]) -> list[dict[str, Any]]:
    """Project NPCs to IDs, surface presentation, and explicit safe summaries.

    Raw agenda/fear/secret prose is planner-only.  An author may opt in a
    player-safe ``agenda_summary`` for semantic compilation; absence never
    falls back to the raw agenda.
    """
    allowed = {
        "npc_id", "name", "display_name", "relationship_to_investigators",
        "social_role", "voice", "source_refs", "origin", "importance",
        "secret_id", "has_secret",
    }
    result: list[dict[str, Any]] = []
    for npc in document.get("npcs") or []:
        if not isinstance(npc, dict):
            continue
        safe = {key: copy.deepcopy(npc[key]) for key in allowed if key in npc}
        summary = npc.get("agenda_summary") or npc.get("player_safe_agenda")
        if isinstance(summary, str) and summary.strip():
            safe["agenda_summary"] = summary.strip()
        persona = npc.get("persona")
        if isinstance(persona, dict):
            safe_persona: dict[str, Any] = {}
            for key in ("tags", "surface_cues"):
                values = persona.get(key)
                if isinstance(values, list):
                    safe_persona[key] = [
                        str(value) for value in values if str(value or "").strip()
                    ]
            if safe_persona:
                safe["persona"] = safe_persona
        if "source_refs" in safe:
            safe["source_refs"] = _safe_source_refs(safe["source_refs"])
        result.append(safe)
    return result


def _safe_danger(danger: dict[str, Any]) -> dict[str, Any]:
    allowed = {
        "id", "danger_id", "kind", "tags", "lethal", "lethality",
        "player_safe_summary", "source_refs", "origin", "importance",
    }
    safe = {key: copy.deepcopy(danger[key]) for key in allowed if key in danger}
    if "source_refs" in safe:
        safe["source_refs"] = _safe_source_refs(safe["source_refs"])
    return safe


def _safe_clock(clock: dict[str, Any]) -> dict[str, Any]:
    # on_tick_visible is explicitly player-facing; on_full remains Keeper-only.
    allowed = {
        "clock_id", "segments", "on_tick_visible", "tags", "source_refs",
        "origin", "importance",
    }
    safe = {key: copy.deepcopy(clock[key]) for key in allowed if key in clock}
    if "source_refs" in safe:
        safe["source_refs"] = _safe_source_refs(safe["source_refs"])
    return safe


def _safe_fronts(document: dict[str, Any]) -> list[dict[str, Any]]:
    allowed = {
        "front_id", "scope", "tags", "setting_tags", "source_refs",
        "origin", "importance",
    }
    result: list[dict[str, Any]] = []
    for front in document.get("fronts") or []:
        if not isinstance(front, dict):
            continue
        safe = {key: copy.deepcopy(front[key]) for key in allowed if key in front}
        safe["dangers"] = [
            _safe_danger(danger)
            for danger in (front.get("dangers") or [])
            if isinstance(danger, dict)
        ]
        safe["clocks"] = [
            _safe_clock(clock)
            for clock in (front.get("clocks") or [])
            if isinstance(clock, dict)
        ]
        if "source_refs" in safe:
            safe["source_refs"] = _safe_source_refs(safe["source_refs"])
        result.append(safe)
    return result


def _secret_refs(document: dict[str, Any]) -> list[dict[str, str]]:
    refs: list[dict[str, str]] = []
    for index, secret in enumerate(document.get("keeper_secrets") or []):
        if isinstance(secret, dict):
            secret_id = str(secret.get("id") or f"secret-{index + 1}")
            category = str(secret.get("category") or "secret")
        else:
            secret_id = f"secret-{index + 1}"
            category = "secret"
        refs.append({"id": secret_id, "category": category})
    return refs


def _safe_source_bundle(source_bundle: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(source_bundle, dict):
        return {}
    stripped = coc_pdf_source.strip_local_evidence_text(source_bundle)
    stripped.pop("source_root", None)
    stripped.pop("base_dir", None)
    # The semantic compiler needs locators and confidence, never source text.
    for segment in stripped.get("evidence_segments") or []:
        if isinstance(segment, dict):
            segment.pop("heading_text", None)
    return stripped


def build_compile_request(
    scenario_dir: Path,
    source_bundle: dict[str, Any] | None = None,
) -> dict[str, Any]:
    scenario_dir = Path(scenario_dir)
    meta = _read(scenario_dir / "module-meta.json", {})
    story = _read(scenario_dir / "story-graph.json", {"scenes": []})
    clues = _read(scenario_dir / "clue-graph.json", {"conclusions": []})
    npcs = _read(scenario_dir / "npc-agendas.json", {"npcs": []})
    fronts = _read(scenario_dir / "threat-fronts.json", {"fronts": []})
    pacing = _read(scenario_dir / "pacing-map.json", {"pacing_curve": []})
    boundaries = _read(scenario_dir / "improvisation-boundaries.json", {})
    return {
        "schema_version": 1,
        "kind": "coc_epistemic_compile_request",
        "scenario_dir_name": scenario_dir.name,
        "module": {
            "scenario_id": meta.get("scenario_id"),
            "structure_type": meta.get("structure_type"),
            "era": meta.get("era"),
            "module_identity": copy.deepcopy(meta.get("module_identity") or {}),
            "setting_tags": copy.deepcopy(meta.get("setting_tags") or []),
        },
        "scenario_ir": {
            "scenes": _safe_scenes(story),
            "conclusions": _safe_conclusions(clues),
            "npcs": _safe_npcs(npcs),
            "fronts": _safe_fronts(fronts),
            "pacing_curve": copy.deepcopy(pacing.get("pacing_curve") or []),
            "keeper_secret_refs": _secret_refs(boundaries),
        },
        "source_evidence": _safe_source_bundle(source_bundle),
        "constitution": {
            "forbidden_methods": [
                "keyword_hits",
                "fixed_prose_fragments",
                "inventing_module_truth",
            ],
            "requirement": (
                "Infer question/evidence/reveal semantics from the supplied structured "
                "scenario as a whole. Preserve source IDs and explain every critical "
                "question and reframe contract. Never return raw module prose."
            ),
        },
        "expected_output": {
            "ordered_root_keys": list(RESULT_ROOT_KEYS),
            "required": list(RESULT_ROOT_KEYS),
            "additional_properties": False,
            "identity": {
                "schema_version": CONTRACT["schema_version"],
                "evaluator_id": EVALUATOR_ID,
            },
            "evaluation_provenance": {
                "ordered_keys": list(CONTRACT["provenance"]["ordered_keys"]),
                "additional_properties": False,
                "kind": CONTRACT["provenance"]["kind"],
                "request_sha256": "sha256 of this complete compile request",
                "reviewed_artifact": REQUEST_FILENAME,
            },
            "object_fields": list(RESULT_DOCUMENT_KEYS),
        },
    }


def write_compile_request(
    scenario_dir: Path,
    artifacts_dir: Path | None = None,
    *,
    source_bundle: dict[str, Any] | None = None,
) -> Path:
    scenario_dir = Path(scenario_dir)
    destination = Path(artifacts_dir) if artifacts_dir else scenario_dir / ".epistemic-compile"
    destination.mkdir(parents=True, exist_ok=True)
    path = destination / REQUEST_FILENAME
    _write(path, build_compile_request(scenario_dir, source_bundle=source_bundle))
    return path


def validate_compile_result(
    request: dict[str, Any],
    result: dict[str, Any],
) -> list[str]:
    errors: list[str] = []
    if not isinstance(result, dict):
        return ["compile result must be an object"]
    required_root = set(RESULT_ROOT_KEYS)
    missing = sorted(required_root - set(result))
    unexpected = sorted(set(result) - required_root)
    for key in missing:
        errors.append(f"missing required root field: {key}")
    if unexpected:
        errors.append(f"unexpected root fields: {', '.join(unexpected)}")
    schema_version = result.get("schema_version")
    if (
        not isinstance(schema_version, int)
        or isinstance(schema_version, bool)
        or schema_version != CONTRACT["schema_version"]
    ):
        errors.append("schema_version must be the integer 1")
    if result.get("evaluator_id") != EVALUATOR_ID:
        errors.append(f"evaluator_id must be {EVALUATOR_ID!r}")
    provenance = result.get("evaluation_provenance")
    if not isinstance(provenance, dict):
        errors.append("evaluation_provenance must be an object")
        provenance = {}
    if provenance.get("kind") != CONTRACT["provenance"]["kind"]:
        errors.append(
            "evaluation_provenance.kind must be "
            + repr(CONTRACT["provenance"]["kind"])
        )
    if provenance.get("request_sha256") != request_sha256(request):
        errors.append("evaluation_provenance.request_sha256 mismatch")
    if provenance.get("reviewed_artifact") != REQUEST_FILENAME:
        errors.append(f"evaluation_provenance.reviewed_artifact must be {REQUEST_FILENAME!r}")
    if isinstance(provenance, dict):
        provenance_keys = set(CONTRACT["provenance"]["ordered_keys"])
        missing_provenance = sorted(provenance_keys - set(provenance))
        unexpected_provenance = sorted(set(provenance) - provenance_keys)
        for key in missing_provenance:
            errors.append(f"missing evaluation_provenance field: {key}")
        if unexpected_provenance:
            errors.append(
                "unexpected evaluation_provenance fields: "
                + ", ".join(unexpected_provenance)
            )
    for key in RESULT_DOCUMENT_KEYS:
        if not isinstance(result.get(key), dict):
            errors.append(f"{key} must be an object")
    reasons = result.get("reasons") if isinstance(result.get("reasons"), dict) else {}
    graph = result.get("epistemic_graph") if isinstance(result.get("epistemic_graph"), dict) else {}
    for question in graph.get("questions") or []:
        if not isinstance(question, dict) or question.get("importance") != "critical":
            continue
        question_id = str(question.get("question_id") or "")
        if not str(reasons.get(question_id) or "").strip():
            errors.append(f"reasons.{question_id} required for critical question")
    contracts = result.get("reveal_contracts") if isinstance(result.get("reveal_contracts"), dict) else {}
    for contract in contracts.get("contracts") or []:
        if not isinstance(contract, dict) or str(contract.get("mode") or "").lower() != "reframe":
            continue
        contract_id = str(contract.get("reveal_contract_id") or "")
        if not str(reasons.get(contract_id) or "").strip():
            errors.append(f"reasons.{contract_id} required for reframe contract")
    return errors


def install_compile_result(
    scenario_dir: Path,
    request: dict[str, Any],
    result: dict[str, Any],
) -> dict[str, Any]:
    scenario_dir = Path(scenario_dir)
    errors = validate_compile_result(request, result)
    if errors:
        return {"installed": False, "errors": errors, "findings": []}
    compiled = coc_scenario_compile.load_compiled_from_dir(scenario_dir)
    compiled["epistemic_graph"] = copy.deepcopy(result["epistemic_graph"])
    compiled["reveal_contracts"] = copy.deepcopy(result["reveal_contracts"])
    compiled["compile_confidence"] = copy.deepcopy(result["compile_confidence"])
    findings = coc_scenario_compile.validate_compiled_scenario(compiled)
    blocking = [finding for finding in findings if finding.get("severity") == "error"]
    if blocking:
        return {
            "installed": False,
            "errors": [f"{finding.get('code')}: {finding.get('message')}" for finding in blocking],
            "findings": findings,
        }
    _write(scenario_dir / "epistemic-graph.json", result["epistemic_graph"])
    _write(scenario_dir / "reveal-contracts.json", result["reveal_contracts"])
    _write(scenario_dir / "compile-confidence.json", result["compile_confidence"])
    return {
        "installed": True,
        "errors": [],
        "findings": findings,
        "paths": [str(scenario_dir / name) for name in SIDECAR_FILES],
    }


def _candidate_scenario_dirs(root: Path) -> list[Path]:
    root = Path(root)
    candidates: set[Path] = set()
    if root.name == "scenario" and all((root / name).exists() for name in BASE_SCENARIO_FILES):
        candidates.add(root)
    for path in root.rglob("scenario"):
        if not path.is_dir():
            continue
        if any(part in {"logs", "pdf-cache", ".git"} for part in path.parts):
            continue
        if all((path / name).exists() for name in BASE_SCENARIO_FILES):
            candidates.add(path)
    return sorted(candidates)


def scan_scenarios(root: Path) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for scenario_dir in _candidate_scenario_dirs(Path(root)):
        present = [name for name in SIDECAR_FILES if (scenario_dir / name).exists()]
        if len(present) == len(SIDECAR_FILES):
            continue
        meta = _read(scenario_dir / "module-meta.json", {})
        results.append({
            "scenario_dir": str(scenario_dir),
            "scenario_id": meta.get("scenario_id") or scenario_dir.parent.name,
            "status": "missing" if not present else "partial",
            "present": present,
            "missing": [name for name in SIDECAR_FILES if name not in present],
        })
    return results


def write_requests_for_missing(root: Path, artifacts_root: Path) -> list[Path]:
    destinations: list[Path] = []
    artifacts_root = Path(artifacts_root)
    for entry in scan_scenarios(root):
        scenario_dir = Path(entry["scenario_dir"])
        stable_id = str(entry.get("scenario_id") or scenario_dir.parent.name)
        destination = artifacts_root / stable_id
        destinations.append(write_compile_request(scenario_dir, destination))
    return destinations


def _main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="coc_epistemic_compile.py")
    sub = parser.add_subparsers(dest="command", required=True)
    request_parser = sub.add_parser("request")
    request_parser.add_argument("scenario_dir")
    request_parser.add_argument("--artifacts-dir")
    install_parser = sub.add_parser("install")
    install_parser.add_argument("scenario_dir")
    install_parser.add_argument("request_path")
    install_parser.add_argument("result_path")
    scan_parser = sub.add_parser("scan")
    scan_parser.add_argument("root")
    all_parser = sub.add_parser("request-all")
    all_parser.add_argument("root")
    all_parser.add_argument("artifacts_root")
    args = parser.parse_args(argv)
    if args.command == "request":
        path = write_compile_request(
            Path(args.scenario_dir),
            Path(args.artifacts_dir) if args.artifacts_dir else None,
        )
        print(path)
        return 0
    if args.command == "install":
        request = _read(Path(args.request_path), {})
        result = _read(Path(args.result_path), {})
        outcome = install_compile_result(Path(args.scenario_dir), request, result)
        print(json.dumps(outcome, indent=2, ensure_ascii=False))
        return 0 if outcome.get("installed") else 1
    if args.command == "scan":
        print(json.dumps(scan_scenarios(Path(args.root)), indent=2, ensure_ascii=False))
        return 0
    paths = write_requests_for_missing(Path(args.root), Path(args.artifacts_root))
    print(json.dumps([str(path) for path in paths], indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
