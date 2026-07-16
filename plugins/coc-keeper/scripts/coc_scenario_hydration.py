#!/usr/bin/env python3
"""Resolve a campaign's playable scenario IR before the live director reads it.

Resolution order is explicit and evidence-bearing:

1. validated campaign IR (warm hit);
2. exact compiled module-library or built-in starter hit;
3. Keeper-only PDF extraction + semantic compiler + validation + persistence.

Raw source pages never cross the player or narrator boundary. Compiler output is
staged and rejected unless the canonical validators accept it.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import stat
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from pypdf import PdfReader

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
COMPILER_ADAPTER_PATH = REPO_ROOT / "runtime" / "adapters" / "compiler" / "adapter.py"
EPISTEMIC_ADAPTER_PATH = (
    REPO_ROOT / "runtime" / "adapters" / "compiler" / "epistemic_adapter.py"
)


def _load_sibling(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _load_path(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_fileio = _load_sibling("coc_fileio_scenario_hydration", "coc_fileio.py")
coc_pdf_source = _load_sibling("coc_pdf_source_scenario_hydration", "coc_pdf_source.py")
coc_scenario_compile = _load_sibling(
    "coc_scenario_compile_scenario_hydration", "coc_scenario_compile.py"
)
coc_module_registry = _load_sibling(
    "coc_module_registry_scenario_hydration", "coc_module_registry.py"
)
coc_starter = _load_sibling("coc_starter_scenario_hydration", "coc_starter.py")
coc_epistemic_compile = _load_sibling(
    "coc_epistemic_compile_scenario_hydration", "coc_epistemic_compile.py"
)
compiler_adapter = _load_path("runtime_scenario_compiler_adapter", COMPILER_ADAPTER_PATH)
epistemic_adapter = _load_path(
    "runtime_epistemic_compiler_adapter", EPISTEMIC_ADAPTER_PATH
)

REQUIRED_FILES = tuple(coc_scenario_compile.REQUIRED_FILES)
EPISTEMIC_FILES = tuple(coc_epistemic_compile.SIDECAR_FILES)
MAX_SOURCE_PAGES = 32
MAX_SOURCE_CHARACTERS = 300_000


def _blocking_compile_warnings(warnings: list[str]) -> list[str]:
    """Promote new-compile warnings that make a module unusable or untraceable."""
    return [
        warning
        for warning in warnings
        if (
            "unreachable from start" in warning
            or "delivery_kind=skill_check but no skill" in warning
            or warning.startswith("entry missing origin")
        )
    ]


class ScenarioHydrationError(RuntimeError):
    """The campaign has no validated playable IR and resolution failed."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read_json(path: Path, fallback: Any) -> Any:
    if not path.is_file():
        return fallback
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return fallback
    return value


def _write_json(path: Path, payload: Any) -> None:
    coc_fileio.write_json_atomic(
        path, payload, indent=2, ensure_ascii=False, trailing_newline=True
    )


def _bundle_digest(scenario_dir: Path) -> str:
    digest = hashlib.sha256()
    for name in REQUIRED_FILES:
        digest.update(name.encode("utf-8"))
        digest.update((scenario_dir / name).read_bytes())
    return digest.hexdigest()


def _has_complete_bundle(scenario_dir: Path) -> bool:
    for name in REQUIRED_FILES:
        value = _read_json(scenario_dir / name, None)
        if not isinstance(value, dict):
            return False
    return True


def _validation(scenario_dir: Path, *, deep: bool = False) -> dict[str, Any]:
    disk = coc_scenario_compile.validate_scenario(scenario_dir)
    findings: list[dict[str, Any]] = []
    if deep and not disk.get("errors"):
        findings = coc_scenario_compile.validate_compiled_scenario(
            coc_scenario_compile.load_compiled_from_dir(scenario_dir)
        )
    errors = list(disk.get("errors") or []) + [
        str(item.get("message") or item.get("code"))
        for item in findings
        if item.get("severity") == "error"
    ]
    return {
        "ok": not errors,
        "errors": errors,
        "warnings": list(disk.get("warnings") or []) + [
            str(item.get("message") or item.get("code"))
            for item in findings
            if item.get("severity") == "warning"
        ],
    }


def _campaign_coc_root(campaign_dir: Path) -> Path | None:
    resolved = campaign_dir.resolve()
    for parent in (resolved, *resolved.parents):
        if parent.name == ".coc":
            return parent
    return None


def _scenario_seed(campaign_dir: Path) -> dict[str, Any]:
    scenario_dir = campaign_dir / "scenario"
    seed = _read_json(scenario_dir / "scenario.json", {})
    if not isinstance(seed, dict):
        seed = {}
    source_map = _read_json(campaign_dir / "index" / "source-map.json", {})
    sources = source_map.get("sources") if isinstance(source_map, dict) else None
    source = seed.get("source") if isinstance(seed.get("source"), dict) else None
    if source is None and isinstance(sources, list):
        source = next((item for item in sources if isinstance(item, dict)), None)
    meta = _read_json(scenario_dir / "module-meta.json", {})
    identity = meta.get("module_identity") if isinstance(meta, dict) else None
    if not isinstance(identity, dict):
        identity = seed.get("module_identity") if isinstance(seed.get("module_identity"), dict) else {}
    scenario_id = str(
        seed.get("scenario_id")
        or (meta.get("scenario_id") if isinstance(meta, dict) else "")
        or ""
    ).strip()
    title = str(
        seed.get("title")
        or (meta.get("title") if isinstance(meta, dict) else "")
        or scenario_id
    ).strip()
    if scenario_id and not identity.get("canonical_module_id"):
        identity = dict(identity)
        identity["canonical_module_id"] = scenario_id
    if title and not identity.get("canonical_title"):
        identity = dict(identity)
        identity["canonical_title"] = title
    return {
        "scenario_id": scenario_id,
        "title": title,
        "source": source if isinstance(source, dict) else {},
        "module_identity": identity,
        "resolution_policy": str(seed.get("resolution_policy") or "cache_first"),
    }


def _copy_validated_bundle(source_dir: Path, destination_dir: Path) -> None:
    check = _validation(source_dir)
    if not check["ok"]:
        raise ScenarioHydrationError(
            "cached scenario is invalid: " + "; ".join(check["errors"])
        )
    destination_dir.mkdir(parents=True, exist_ok=True)
    for name in REQUIRED_FILES:
        payload = json.loads((source_dir / name).read_text(encoding="utf-8"))
        _write_json(destination_dir / name, payload)
    for name in coc_module_registry.discover_optional_scenario_sidecars(source_dir):
        payload = json.loads((source_dir / name).read_text(encoding="utf-8"))
        _write_json(destination_dir / name, payload)


def _try_compiled_cache(campaign_dir: Path, seed: dict[str, Any]) -> dict[str, Any] | None:
    scenario_id = seed["scenario_id"]
    builtin = coc_starter.STARTER_DIR / scenario_id if scenario_id else None
    source_dir: Path | None = None
    cache_kind = ""
    coc_root = _campaign_coc_root(campaign_dir)
    if coc_root is not None and seed["module_identity"]:
        entry = coc_module_registry.lookup_module(coc_root, seed["module_identity"])
        if entry is not None:
            source_dir = Path(entry["scenario_dir"])
            cache_kind = "module_library"
    if source_dir is None and builtin is not None and builtin.is_dir():
        source_dir = builtin
        cache_kind = "builtin_starter"
    if source_dir is None:
        return None
    _copy_validated_bundle(source_dir, campaign_dir / "scenario")
    _ensure_active_scene(campaign_dir)
    return {
        "status": "PASS",
        "mode": "cold_cache_install",
        "cache": cache_kind,
        "scenario_id": scenario_id,
        "bundle_sha256": _bundle_digest(campaign_dir / "scenario"),
    }


def _source_page_bounds(source: dict[str, Any], page_count: int) -> tuple[int, int]:
    if isinstance(source.get("pdf_indices"), list) and source["pdf_indices"]:
        indices = source["pdf_indices"]
        if not all(isinstance(value, int) for value in indices):
            raise ScenarioHydrationError("source.pdf_indices must contain integers")
        start, end = min(indices), max(indices)
        if sorted(set(indices)) != list(range(start, end + 1)):
            raise ScenarioHydrationError("source.pdf_indices must be one contiguous range")
    elif isinstance(source.get("pdf_index_start"), int):
        start = source["pdf_index_start"]
        end = source.get("pdf_index_end", start)
    elif source.get("page_kind") == "pdf_index" and isinstance(source.get("page_start"), int):
        start = source["page_start"]
        end = source.get("page_end", start)
    else:
        raise ScenarioHydrationError(
            "source requires explicit zero-based pdf_index_start/pdf_index_end; "
            "printed-page offsets are never guessed"
        )
    if not isinstance(end, int) or start < 0 or end < start or end >= page_count:
        raise ScenarioHydrationError(
            f"source PDF range {start}..{end} is outside 0..{page_count - 1}"
        )
    if end - start + 1 > MAX_SOURCE_PAGES:
        raise ScenarioHydrationError(
            f"source range exceeds {MAX_SOURCE_PAGES}-page compiler boundary"
        )
    return start, end


def _extract_source(seed: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    source = dict(seed.get("source") or {})
    path_text = str(source.get("path") or "").strip()
    if not path_text:
        raise ScenarioHydrationError("no compiled cache and no source.path configured")
    path = Path(path_text).expanduser().resolve()
    if not path.is_file() or path.suffix.lower() != ".pdf":
        raise ScenarioHydrationError(f"module source is not a readable PDF: {path}")
    actual_hash = coc_pdf_source.sha256_file(path)
    declared_hash = str(source.get("file_sha256") or "").strip()
    if declared_hash and declared_hash != actual_hash:
        raise ScenarioHydrationError("module PDF hash differs from configured source hash")
    reader = PdfReader(str(path))
    start, end = _source_page_bounds(source, len(reader.pages))
    pages: list[dict[str, Any]] = []
    total = 0
    for index in range(start, end + 1):
        text = (reader.pages[index].extract_text() or "").strip()
        if not text:
            raise ScenarioHydrationError(f"PDF page index {index} has no extractable text")
        total += len(text)
        if total > MAX_SOURCE_CHARACTERS:
            raise ScenarioHydrationError(
                f"source extraction exceeds {MAX_SOURCE_CHARACTERS} characters"
            )
        pages.append({
            "pdf_index": index,
            "text": text,
            "text_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        })
    normalized = {
        "source_id": str(source.get("source_id") or coc_pdf_source.default_source_id(path)),
        "path": str(path),
        "title": str(source.get("title") or path.stem),
        "file_sha256": actual_hash,
        "page_count": len(reader.pages),
        "pdf_index_start": start,
        "pdf_index_end": end,
    }
    return normalized, pages


def _compile_request(
    seed: dict[str, Any],
    source: dict[str, Any],
    pages: list[dict[str, Any]],
    *,
    resolution_request: dict[str, Any] | None = None,
) -> dict[str, Any]:
    request = {
        "schema_version": 1,
        "module_identity": seed["module_identity"],
        "source": source,
        "pages": pages,
        "required_files": list(REQUIRED_FILES),
        "compile_contract": {
            "consumer": "coc_story_director",
            "player_boundary": "raw source and private IR never reach AI player",
            "narrator_boundary": "raw source never reaches narrator",
            "semantic_policy": "compile meanings into structured fields; no runtime prose keyword matching",
            "source_policy": "source-derived nodes use source_refs with source_id and pdf_index",
            "output_policy": "concise structured index, not copied module prose",
            "minimum_file_contracts": {
                "module-meta.json": {
                    "required": [
                        "schema_version", "scenario_id", "title", "structure_type",
                        "era", "content_flags", "win_condition", "module_identity",
                    ],
                    "structure_type_enum": sorted(coc_scenario_compile.VALID_STRUCTURE_TYPES),
                    "chapter_handoff": (
                        "optional exact object {mode: auto_on_terminal, target_module_id}; "
                        "never infer sibling order from prose or titles"
                    ),
                },
                "story-graph.json": {
                    "required": ["scenes"],
                    "scene_required": [
                        "scene_id", "scene_type", "dramatic_question",
                        "entry_conditions", "exit_conditions", "available_clues",
                        "npc_ids", "pressure_moves", "scene_edges",
                    ],
                    "scene_edge_contract": (
                        "scene_edges is a list of objects using exactly to for the target "
                        "scene_id, kind for the route type, and structured when conditions; "
                        "use when={kind: always} for an unconditional route"
                    ),
                    "affordance_cue_contract": (
                        "every affordance cue is visible before its linked clue is discovered; "
                        "express only the action/question available now, never the clue answer, "
                        "unrevealed destination list, amount, identity, object transfer, or outcome"
                    ),
                    "global": (
                        "exactly one scene has is_start=true; at least one reachable scene has "
                        "is_final=true; every authored scene is reachable from the start through "
                        "structured edges/routes"
                    ),
                },
                "clue-graph.json": {
                    "required": ["conclusions"],
                    "conclusion_required": [
                        "conclusion_id", "importance", "minimum_routes", "clues",
                    ],
                    "clue_required": [
                        "clue_id", "delivery", "delivery_kind", "visibility",
                        "player_safe_summary", "source_refs",
                    ],
                    "delivery_kind_enum": sorted(
                        set(coc_scenario_compile.NON_FRAGILE_DELIVERY_KINDS)
                        | {"skill_check"}
                    ),
                    "social_clue_contract": (
                        "delivery_kind social or npc_dialogue requires source_npc_ids as a "
                        "unique non-empty list resolving to npc-agendas.json npc_id values"
                    ),
                    "skill_check_contract": "delivery_kind skill_check requires a non-empty skill",
                    "provenance_contract": (
                        "every source-derived scene, clue, NPC, threat, and other semantic entry "
                        "uses origin=source and source_refs; inferred entries use origin=inferred"
                    ),
                    "global": (
                        "clues are nested under exactly one conclusion; every clue_id is globally unique; "
                        "every story scene available_clues id resolves; critical conclusions meet "
                        "minimum_routes with independently identified clue_id routes"
                    ),
                },
                "npc-agendas.json": {"required": ["npcs"]},
                "threat-fronts.json": {"required": ["fronts"]},
                "pacing-map.json": {"required": ["pacing_curve"]},
                "improvisation-boundaries.json": {
                    "required": ["invent_allowed", "never_invent", "keeper_secrets"],
                },
            },
        },
    }
    if resolution_request is not None:
        request["source_resolution_request"] = json.loads(
            json.dumps(resolution_request, ensure_ascii=False)
        )
        request["compile_contract"]["repair_policy"] = (
            "repair the named structured node from exact source_refs while preserving "
            "all validated unrelated module content"
        )
    return request


def _normalize_compiler_bundle(bundle: dict[str, Any]) -> dict[str, Any]:
    """Normalize explicit structured aliases; never infer meaning from prose."""
    normalized = json.loads(json.dumps(bundle, ensure_ascii=False))
    story_graph = normalized.get("story-graph.json")
    scenes = story_graph.get("scenes") if isinstance(story_graph, dict) else None
    if isinstance(scenes, list):
        for scene in scenes:
            if not isinstance(scene, dict) or "scene_edges" in scene:
                continue
            # Some semantic compilers emit the structurally equivalent
            # edges[].to_scene_id form. Canonicalize that explicit alias here;
            # this does not inspect or classify prose.
            aliases = scene.get("edges")
            if not isinstance(aliases, list):
                continue
            canonical_edges: list[dict[str, Any]] = []
            for alias in aliases:
                if not isinstance(alias, dict):
                    canonical_edges.append(alias)
                    continue
                edge = dict(alias)
                if "to" not in edge and "to_scene_id" in edge:
                    edge["to"] = edge.pop("to_scene_id")
                edge.setdefault("kind", "route")
                edge.setdefault("when", {"kind": "always"})
                canonical_edges.append(edge)
            scene["scene_edges"] = canonical_edges
            scene.pop("edges", None)
    clue_graph = normalized.get("clue-graph.json")
    if not isinstance(clue_graph, dict):
        return normalized
    global_clues = clue_graph.get("clues")
    conclusions = clue_graph.get("conclusions")
    if not isinstance(global_clues, list) or not isinstance(conclusions, list):
        return normalized
    clue_by_id = {
        clue.get("clue_id"): clue
        for clue in global_clues
        if isinstance(clue, dict) and isinstance(clue.get("clue_id"), str)
    }
    for conclusion in conclusions:
        if not isinstance(conclusion, dict) or isinstance(conclusion.get("clues"), list):
            continue
        clue_ids = conclusion.get("clue_ids")
        if not isinstance(clue_ids, list):
            continue
        nested: list[dict[str, Any]] = []
        for clue_id in clue_ids:
            source = clue_by_id.get(clue_id)
            if not isinstance(source, dict):
                continue
            clue = dict(source)
            route = str(clue.get("route_id") or "direct").strip() or "direct"
            clue.setdefault("delivery", route)
            # A route_id is identity, not a delivery-kind enum. When the
            # compiler omits delivery_kind, choose the conservative CoC
            # fail-forward default: a core clue is directly obtainable rather
            # than silently becoming a fragile skill-gated bottleneck.
            clue.setdefault("delivery_kind", "direct")
            clue.setdefault("visibility", "player-safe")
            if "player_safe_summary" not in clue and isinstance(clue.get("summary"), str):
                clue["player_safe_summary"] = clue["summary"]
            nested.append(clue)
        conclusion["clues"] = nested
        if "importance" not in conclusion and isinstance(conclusion.get("critical"), bool):
            conclusion["importance"] = "critical" if conclusion["critical"] else "supporting"
        conclusion.pop("clue_ids", None)
    clue_graph.pop("clues", None)
    return normalized


def _stage_bundle(
    bundle: dict[str, Any],
    parent: Path,
    *,
    seed: dict[str, Any],
    source: dict[str, Any],
    pages: list[dict[str, Any]],
) -> Path:
    if set(bundle) != set(REQUIRED_FILES):
        raise ScenarioHydrationError(
            "compiler bundle keys must exactly equal the canonical seven files"
        )
    staging_root = Path(tempfile.mkdtemp(prefix=".scenario-compile-", dir=parent))
    staging = staging_root / "scenario"
    staging.mkdir()
    try:
        for name in REQUIRED_FILES:
            payload = bundle[name]
            if not isinstance(payload, dict):
                raise ScenarioHydrationError(f"compiler output {name} must be an object")
            _write_json(staging / name, payload)
        # Validate structure and source evidence against one isolated staged
        # campaign. Never inherit an older campaign/index while judging a new
        # compiler result.
        _persist_source_bundle(staging_root, seed, source, pages)
        check = _validation(staging, deep=True)
        promoted = _blocking_compile_warnings(check["warnings"])
        if not check["ok"] or promoted:
            raise ScenarioHydrationError(
                "compiler output failed canonical validation: "
                + "; ".join([*check["errors"], *promoted])
            )
        return staging
    except Exception:
        shutil.rmtree(staging_root, ignore_errors=True)
        raise


def _compile_epistemic_sidecars(
    staging: Path,
    *,
    compiler: Callable[[dict[str, Any]], dict[str, Any]],
) -> dict[str, Any]:
    """Compile and install all three sidecars inside the unpublished stage."""
    source_bundle = coc_pdf_source.load_source_bundle(staging.parent)
    request = coc_epistemic_compile.build_compile_request(
        staging, source_bundle=source_bundle
    )
    response = compiler(request)
    if not isinstance(response, dict) or response.get("ok") is not True:
        raise ScenarioHydrationError(
            str((response or {}).get("error") or "epistemic compiler returned no result")
        )
    result = response.get("compile_result")
    if not isinstance(result, dict):
        raise ScenarioHydrationError("epistemic compiler response requires compile_result")
    installed = coc_epistemic_compile.install_compile_result(staging, request, result)
    if installed.get("installed") is not True:
        errors = installed.get("errors") or ["unknown sidecar validation failure"]
        raise ScenarioHydrationError(
            "epistemic compiler output failed canonical validation: "
            + "; ".join(str(item) for item in errors)
        )
    return {
        "status": "PASS",
        "request_sha256": coc_epistemic_compile.request_sha256(request),
        "model_identity": response.get("model_identity"),
        "usage": response.get("usage"),
        "attempts": response.get("epistemic_attempts", 1),
        "rejected_attempts": response.get("rejected_attempts") or [],
    }


def _record_epistemic_rejections(
    campaign_dir: Path,
    base_request_sha256: str,
    diagnostics: list[dict[str, Any]],
) -> None:
    """Persist safe adapter diagnostics outside the disposable compile stage."""
    for fallback_attempt, diagnostic in enumerate(diagnostics, start=1):
        if not isinstance(diagnostic, dict):
            continue
        attempt = diagnostic.get("attempt", fallback_attempt)
        if not isinstance(attempt, int) or isinstance(attempt, bool) or attempt < 1:
            attempt = fallback_attempt
        epistemic_sha = diagnostic.get("epistemic_request_sha256")
        if not isinstance(epistemic_sha, str) or len(epistemic_sha) != 64:
            raise ScenarioHydrationError("epistemic rejection evidence has invalid request hash")
        payload = {
            **diagnostic,
            "schema_version": 1,
            "status": "REJECTED",
            "phase": "epistemic_compile",
            "base_request_sha256": base_request_sha256,
            "attempt": attempt,
        }
        directory = campaign_dir / "logs" / "scenario-resolution"
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / (
            f"{base_request_sha256}.epistemic-{epistemic_sha}.rejected-{attempt}.json"
        )
        _write_epistemic_receipt_exclusive(path, payload)


def _read_regular_json_nofollow(path: Path) -> dict[str, Any]:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(path, flags)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > 8192:
            raise ScenarioHydrationError("epistemic rejection evidence target is invalid")
        raw = os.read(fd, 8193)
    finally:
        os.close(fd)
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ScenarioHydrationError("epistemic rejection evidence target is invalid") from exc
    if not isinstance(value, dict):
        raise ScenarioHydrationError("epistemic rejection evidence target is invalid")
    return value


def _write_epistemic_receipt_exclusive(path: Path, payload: dict[str, Any]) -> None:
    """Atomically create or content-confirm one bounded immutable receipt."""
    comparable = dict(payload)
    stored = {**comparable, "recorded_at": _now()}
    encoded = (
        json.dumps(stored, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    ).encode("utf-8")
    if len(encoded) > 8192:
        raise ScenarioHydrationError("epistemic rejection evidence exceeds size limit")
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", prefix=".epistemic-rejected-", dir=path.parent, delete=False
        ) as handle:
            temp_path = Path(handle.name)
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temp_path, path, follow_symlinks=False)
        except FileExistsError:
            existing = _read_regular_json_nofollow(path)
            existing.pop("recorded_at", None)
            if existing != comparable:
                raise ScenarioHydrationError("epistemic rejection evidence conflict")
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


def _persist_source_bundle(
    campaign_dir: Path,
    seed: dict[str, Any],
    source: dict[str, Any],
    pages: list[dict[str, Any]],
) -> None:
    source_id = source["source_id"]
    page_map = {
        "schema_version": 1,
        "scenario_id": seed["scenario_id"],
        "sources": [{
            **{key: value for key, value in source.items() if key != "path"},
            # Local PDFs may live outside the campaign root. Persist the bound
            # hash and locators, but not an unsafe path that later validators
            # could resolve relative to a different workspace.
            "path": "",
            "pages": [
                {"pdf_index": page["pdf_index"]}
                for page in pages
            ],
        }],
    }
    parse_manifest = {
        "schema_version": 1,
        "scenario_id": seed["scenario_id"],
        "default_threshold": coc_pdf_source.DEFAULT_CRITICAL_THRESHOLD,
        "ranges": [{
            "source_id": source_id,
            "pdf_indices": [page["pdf_index"] for page in pages],
            "extractor": "pypdf",
            "review_state": "auto_accepted",
            "quality": {"overall": 1.0, "review_state": "auto_accepted"},
            "file_sha256": source["file_sha256"],
        }],
    }
    segments = [{
        "segment_id": f"{source_id}:pdf-index:{page['pdf_index']}",
        "source_id": source_id,
        "locator": {"pdf_index": page["pdf_index"]},
        "text": page["text"],
        "text_sha256": hashlib.sha256(page["text"].encode("utf-8")).hexdigest(),
        "parse_confidence": 1.0,
        "review_state": "auto_accepted",
        "grep_anchors": [],
    } for page in pages]
    coc_pdf_source.write_source_bundle(campaign_dir, page_map, parse_manifest, segments)


def _ensure_active_scene(campaign_dir: Path) -> None:
    story = _read_json(campaign_dir / "scenario" / "story-graph.json", {})
    scenes = story.get("scenes") if isinstance(story, dict) else []
    ids = [item.get("scene_id") for item in scenes or [] if isinstance(item, dict)]
    if not ids:
        raise ScenarioHydrationError("validated scenario unexpectedly has no scene")
    world_path = campaign_dir / "save" / "world-state.json"
    world = _read_json(world_path, {})
    if not isinstance(world, dict):
        world = {}
    if world.get("active_scene_id") not in ids:
        world["active_scene_id"] = ids[0]
    meta = _read_json(campaign_dir / "scenario" / "module-meta.json", {})
    world["scenario_id"] = meta.get("scenario_id") or world.get("scenario_id")
    world["status"] = "active"
    world["active_subsystem"] = "play"
    world["updated_at"] = _now()
    _write_json(world_path, world)


def _record_receipt(campaign_dir: Path, receipt: dict[str, Any]) -> dict[str, Any]:
    receipt = {"schema_version": 1, "recorded_at": _now(), **receipt}
    _write_json(campaign_dir / "scenario" / "resolution-receipt.json", receipt)
    return receipt


def _warm_receipt(campaign_dir: Path, receipt: dict[str, Any]) -> dict[str, Any]:
    """Return a warm-check receipt without rewriting identical persisted evidence."""
    path = campaign_dir / "scenario" / "resolution-receipt.json"
    existing = _read_json(path, {})
    if (
        isinstance(existing, dict)
        and existing.get("bundle_sha256") == receipt.get("bundle_sha256")
        and existing.get("status") == receipt.get("status")
    ):
        return {
            "schema_version": 1,
            "recorded_at": existing.get("recorded_at"),
            **receipt,
            "persisted_receipt_mode": existing.get("mode"),
        }
    return _record_receipt(campaign_dir, receipt)


def ensure_scenario_ready(
    campaign_dir: Path | str,
    *,
    compiler: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    epistemic_compiler: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    runner_path: Path | str | None = None,
    epistemic_runner_path: Path | str | None = None,
    compiler_timeout_s: float = 900,
    max_compile_attempts: int = 3,
    compile_epistemic_sidecars: bool | None = None,
    force_recompile: bool = False,
    resolution_request: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return a receipt for validated IR, resolving and persisting it if absent."""
    campaign = Path(campaign_dir)
    scenario_dir = campaign / "scenario"
    scenario_dir.mkdir(parents=True, exist_ok=True)
    seed = _scenario_seed(campaign)
    current = _validation(scenario_dir)
    if current["ok"] and not force_recompile:
        deep = _validation(scenario_dir, deep=True)
        promoted = _blocking_compile_warnings(deep["warnings"])
        if seed["resolution_policy"] not in {"source_first", "repair_invalid"} or not promoted:
            return _warm_receipt(campaign, {
                "status": "PASS",
                "mode": "warm_validated",
                "cache": "campaign",
                "bundle_sha256": _bundle_digest(scenario_dir),
                "warnings": deep["warnings"],
            })
        current = {
            "ok": False,
            "errors": [f"promoted compile warning: {warning}" for warning in promoted],
            "warnings": deep["warnings"],
        }
    # Presence and correctness are separate concerns. Do not silently replace
    # a complete authored/test bundle merely because a validator rejects one
    # field: the runtime/evaluation must surface that defect. Source hydration
    # repairs missing structure by default; invalid complete IR is recompiled
    # only under an explicit source-first/repair-invalid policy.
    if (
        not force_recompile
        and
        _has_complete_bundle(scenario_dir)
        and seed["resolution_policy"] not in {"source_first", "repair_invalid"}
    ):
        return _warm_receipt(campaign, {
            "status": "FAIL",
            "mode": "warm_invalid_existing",
            "cache": "campaign",
            "bundle_sha256": _bundle_digest(scenario_dir),
            "errors": current["errors"],
            "warnings": current["warnings"],
        })
    if not force_recompile and seed["resolution_policy"] != "source_first":
        cached = _try_compiled_cache(campaign, seed)
        if cached is not None:
            return _record_receipt(campaign, cached)

    source, pages = _extract_source(seed)
    request = _compile_request(
        seed, source, pages, resolution_request=resolution_request
    )
    if resolution_request is not None and _has_complete_bundle(scenario_dir):
        request["previous_scenario_bundle"] = {
            name: _read_json(scenario_dir / name, {}) for name in REQUIRED_FILES
        }
    request_digest = hashlib.sha256(
        json.dumps(request, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    request_artifact = {
        **request,
        "pages": [
            {key: value for key, value in page.items() if key != "text"}
            for page in pages
        ],
        "raw_text_storage": "index/evidence-segments.jsonl (keeper-only)",
        "request_sha256": request_digest,
    }
    _write_json(campaign / "logs" / "scenario-resolution" / f"{request_digest}.json", request_artifact)
    invoke = compiler
    if invoke is None:
        invoke = lambda payload: compiler_adapter.compile_scenario(
            payload, runner_path=runner_path, timeout_s=compiler_timeout_s
        )
    attempts = max(1, int(max_compile_attempts or 1))
    response: dict[str, Any] = {}
    staging: Path | None = None
    compile_payload = request
    validation_errors: list[str] = []
    for attempt in range(1, attempts + 1):
        response = invoke(compile_payload)
        if not isinstance(response, dict) or response.get("ok") is not True:
            raise ScenarioHydrationError(
                str((response or {}).get("error") or "scenario compiler returned no result")
            )
        try:
            normalized_bundle = _normalize_compiler_bundle(
                response.get("scenario_bundle") or {}
            )
            response["scenario_bundle"] = normalized_bundle
            staging = _stage_bundle(
                normalized_bundle,
                scenario_dir.parent,
                seed=seed,
                source=source,
                pages=pages,
            )
            break
        except ScenarioHydrationError as exc:
            validation_errors.append(str(exc))
            _write_json(
                campaign / "logs" / "scenario-resolution"
                / f"{request_digest}.rejected-{attempt}.json",
                {
                    "schema_version": 1,
                    "attempt": attempt,
                    "validation_error": str(exc),
                    "scenario_bundle": response.get("scenario_bundle"),
                    "model_identity": response.get("model_identity"),
                },
            )
            if attempt >= attempts:
                raise
            compile_payload = {
                **request,
                "revision_attempt": attempt + 1,
                "validation_feedback": str(exc),
                "previous_scenario_bundle": response.get("scenario_bundle"),
            }
    if staging is None:
        raise ScenarioHydrationError("scenario compiler exhausted without staged output")
    # Dependency-injected base compilers are predominantly deterministic test
    # fixtures. Production cold compilation (no injected compiler) always runs
    # the second, minimum-privilege semantic phase. Tests and custom callers can
    # opt in explicitly and inject their own epistemic compiler.
    if compile_epistemic_sidecars is None:
        compile_epistemic_sidecars = compiler is None
    epistemic_receipt: dict[str, Any] = {
        "status": "NOT_RUN",
        "reason": "disabled_for_injected_base_compiler",
    }
    try:
        if compile_epistemic_sidecars:
            invoke_epistemic = epistemic_compiler
            if invoke_epistemic is None:
                invoke_epistemic = lambda payload: epistemic_adapter.compile_epistemic(
                    payload,
                    runner_path=epistemic_runner_path,
                    timeout_s=compiler_timeout_s,
                )
            try:
                epistemic_receipt = _compile_epistemic_sidecars(
                    staging, compiler=invoke_epistemic
                )
            except epistemic_adapter.EpistemicCompileRejected as exc:
                _record_epistemic_rejections(
                    campaign, request_digest, exc.diagnostics
                )
                raise ScenarioHydrationError(str(exc)) from exc
            _record_epistemic_rejections(
                campaign,
                request_digest,
                epistemic_receipt.get("rejected_attempts") or [],
            )
            epistemic_receipt.pop("rejected_attempts", None)
        backup_dir = scenario_dir / ".runtime-backups" / request_digest
        publish_files = [*REQUIRED_FILES]
        if epistemic_receipt.get("status") == "PASS":
            publish_files.extend(EPISTEMIC_FILES)
        existing = [
            scenario_dir / name for name in publish_files
            if (scenario_dir / name).is_file()
        ]
        if existing:
            backup_dir.mkdir(parents=True, exist_ok=True)
            for path in existing:
                shutil.copy2(path, backup_dir / path.name)
        for name in publish_files:
            payload = json.loads((staging / name).read_text(encoding="utf-8"))
            _write_json(scenario_dir / name, payload)
        _persist_source_bundle(campaign, seed, source, pages)
        _ensure_active_scene(campaign)
        final = _validation(scenario_dir, deep=True)
        if not final["ok"]:
            raise ScenarioHydrationError(
                "persisted scenario failed validation: " + "; ".join(final["errors"])
            )
    finally:
        shutil.rmtree(staging.parent, ignore_errors=True)
    return _record_receipt(campaign, {
        "status": "PASS",
        "mode": "cold_source_compile",
        "cache": "miss",
        "scenario_id": seed["scenario_id"],
        "source_id": source["source_id"],
        "source_file_sha256": source["file_sha256"],
        "source_pdf_indices": [page["pdf_index"] for page in pages],
        "request_sha256": request_digest,
        "bundle_sha256": _bundle_digest(scenario_dir),
        "model_identity": response.get("model_identity"),
        "usage": response.get("usage"),
        "epistemic_sidecars": epistemic_receipt,
        "compile_attempts": 1 + len(validation_errors),
        "rejected_validation_errors": validation_errors,
        "warnings": final["warnings"],
    })
