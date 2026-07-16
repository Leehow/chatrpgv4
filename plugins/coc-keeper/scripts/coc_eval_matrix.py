#!/usr/bin/env python3
"""AI-player persona matrix planner and fail-closed orchestrator."""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import secrets
import selectors
import signal
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from functools import lru_cache
from collections import deque
from pathlib import Path
from typing import Any, Callable


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_eval_contract as contract
import coc_eval_judge as judge
import coc_eval_semantic as semantic


REPO_ROOT = SCRIPT_DIR.parents[2]
EVAL_SPEC = "eval-spec-v1"
MATRIX_SUITES = frozenset({"nightly", "release"})
ModelPreflight = Callable[[str, str], bool]
_SAFE_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$")
_TIMEOUT_STREAM_LIMIT_BYTES = 64 * 1024
_JUDGE_IDENTITY_KEYS = (
    "persona_id",
    "seed",
    "case_id",
    "runner",
    "max_turns",
    "player_model",
    "kp_model",
    "judge_model",
    "persona_profile_sha256",
    "prompt_hashes",
    "runner_hashes",
    "scenario_sha256",
    "initial_state_sha256",
    "evaluation_profile_sha256",
    "evaluation_contract",
)
_RUN_MANIFEST_IDENTITY_KEYS = (
    "cell_id",
    "persona_id",
    "seed",
    "case_id",
    "runner",
    "max_turns",
    "player_model",
    "kp_model",
    "persona_profile_sha256",
    "prompt_hashes",
    "runner_hashes",
    "scenario_sha256",
    "initial_state_sha256",
)
_PROFILE_RUN_IDENTITY_KEYS = (
    "evaluation_profile_sha256",
    "evaluation_contract",
)
_MATRIX_PLAN_KEYS = frozenset(
    {
        "schema_version",
        "eval_spec",
        "suite",
        "generated_at",
        "configuration",
        "cell_count",
        "cells",
        "ready_count",
        "not_run_count",
    }
)
_MATRIX_CELL_KEYS = frozenset(
    {
        "cell_id",
        "persona_id",
        "seed",
        "case_id",
        "runner",
        "runner_path",
        "scenario_fixture",
        "initial_state_fixture",
        "evaluation_profile",
        "evaluation_profile_sha256",
        "evaluation_contract",
        "max_turns",
        "player_model",
        "kp_model",
        "judge_model",
        "persona_profile_sha256",
        "prompt_hashes",
        "prompt_sources",
        "runner_hashes",
        "scenario_sha256",
        "initial_state_sha256",
        "judge",
        "status",
        "not_run_reasons",
    }
)
_SCENARIO_BUNDLE_FILES = (
    "module-meta.json",
    "story-graph.json",
    "clue-graph.json",
    "npc-agendas.json",
    "threat-fronts.json",
    "pacing-map.json",
    "improvisation-boundaries.json",
)
_SCENARIO_BUNDLE_KEYS = {
    "module-meta.json": "module_meta",
    "story-graph.json": "story_graph",
    "clue-graph.json": "clue_graph",
    "npc-agendas.json": "npc_agendas",
    "threat-fronts.json": "threat_fronts",
    "pacing-map.json": "pacing_map",
    "improvisation-boundaries.json": "improvisation_boundaries",
}
_REUSABLE_CELL_STATUSES = frozenset({"PASS", "FAIL", "INELIGIBLE", "NON_COMPARABLE"})
_CELL_CHECKPOINT = "cell-result.json"
_RUNNER_CHECKPOINT = "runner-result.json"
_ACTIVE_RUNNERS: dict[int, subprocess.Popen[Any]] = {}
_ACTIVE_RUNNERS_LOCK = threading.Lock()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"unreadable JSON: {path}: {exc}") from exc


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if path.is_symlink() or not path.is_file():
        return []
    rows: list[dict[str, Any]] = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"malformed structured artifact {path.name}:{number}") from exc
        if not isinstance(row, dict):
            raise ValueError(f"malformed structured artifact {path.name}:{number}")
        rows.append(row)
    return rows


def _write_text_atomic(path: Path, text: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temp_path = Path(handle.name)
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
        temp_path = None
    finally:
        if temp_path is not None:
            try:
                temp_path.unlink(missing_ok=True)
            except OSError:
                pass
    return path


def _write_json_atomic(path: Path, payload: Any) -> Path:
    return _write_text_atomic(
        path,
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
    )


def _cell_identity_sha256(cell: dict[str, Any]) -> str:
    payload = _run_manifest_identity_payload(cell)
    encoded = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _write_cell_checkpoint(
    cell_dir: Path,
    cell: dict[str, Any],
    result: dict[str, Any],
) -> Path:
    return _write_json_atomic(cell_dir / _CELL_CHECKPOINT, {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "cell_id": cell["cell_id"],
        "cell_identity_sha256": _cell_identity_sha256(cell),
        "completed_at": _utc_now(),
        "result": result,
    })


def _load_reusable_cell_checkpoint(
    cell_dir: Path,
    cell: dict[str, Any],
) -> dict[str, Any] | None:
    path = cell_dir / _CELL_CHECKPOINT
    if path.is_symlink() or not path.is_file():
        return None
    try:
        payload = _read_json(path)
    except ValueError:
        return None
    if (
        not isinstance(payload, dict)
        or payload.get("schema_version") != 1
        or payload.get("eval_spec") != EVAL_SPEC
        or payload.get("cell_id") != cell.get("cell_id")
        or payload.get("cell_identity_sha256") != _cell_identity_sha256(cell)
    ):
        return None
    result = payload.get("result")
    if not isinstance(result, dict) or result.get("status") not in _REUSABLE_CELL_STATUSES:
        return None
    if any(
        result.get(key) != cell.get(key)
        for key in _run_manifest_identity_keys(cell)
    ):
        return None
    hashes = result.get("artifact_hashes")
    if not isinstance(hashes, dict):
        return None
    for relative, digest in hashes.items():
        if (
            not isinstance(relative, str)
            or not relative
            or Path(relative).is_absolute()
            or ".." in Path(relative).parts
            or not _is_sha256(digest)
        ):
            return None
        artifact = cell_dir / relative
        if artifact.is_symlink() or not artifact.is_file() or _sha256_file(artifact) != digest:
            return None
    reused = json.loads(json.dumps(result, ensure_ascii=False))
    reused["resumed_from_checkpoint"] = True
    reused["checkpoint_path"] = _CELL_CHECKPOINT
    return reused


def _write_runner_checkpoint(
    cell_dir: Path,
    cell: dict[str, Any],
    runner_result: dict[str, Any],
) -> None:
    bounded = {
        key: value
        for key, value in runner_result.items()
        if key not in {"stdout", "stderr"}
    }
    _write_json_atomic(cell_dir / _RUNNER_CHECKPOINT, {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "cell_id": cell["cell_id"],
        "cell_identity_sha256": _cell_identity_sha256(cell),
        "completed_at": _utc_now(),
        "runner_result": bounded,
    })


def _load_reusable_runner_checkpoint(
    cell_dir: Path,
    cell: dict[str, Any],
) -> dict[str, Any] | None:
    path = cell_dir / _RUNNER_CHECKPOINT
    if path.is_symlink() or not path.is_file():
        return None
    try:
        payload = _read_json(path)
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None
    result = payload.get("runner_result")
    if (
        payload.get("schema_version") != 1
        or payload.get("eval_spec") != EVAL_SPEC
        or payload.get("cell_id") != cell.get("cell_id")
        or payload.get("cell_identity_sha256") != _cell_identity_sha256(cell)
        or not isinstance(result, dict)
        or result.get("status") not in {"PASS", "FAIL", "INELIGIBLE"}
        or result.get("timed_out") is True
    ):
        return None
    manifest = cell_dir / "run-manifest.json"
    if manifest.is_symlink() or not manifest.is_file():
        return None
    reused = json.loads(json.dumps(result, ensure_ascii=False))
    reused["resumed_from_runner_checkpoint"] = True
    return reused


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _resolve_path(root: Path, value: str | Path | None) -> Path | None:
    if value is None:
        return None
    path = Path(value)
    if not path.is_absolute():
        path = root / path
    return path


def _contained_repo_path(root: Path, value: Any, label: str) -> Path:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{label} must be a non-empty repository-relative path")
    path = (root / value).resolve()
    try:
        path.relative_to(root.resolve())
    except ValueError as exc:
        raise ValueError(f"{label} escaped repository root") from exc
    return path


def _scenario_fixture_components(root: Path, fixture: Path) -> list[tuple[str, Path]]:
    payload = _read_json(fixture)
    if not isinstance(payload, dict):
        raise ValueError("scenario fixture must be an object")
    bundle_value = payload.get("scenario_bundle")
    if bundle_value is None:
        return [("scenario-fixture", fixture)]
    bundle = _contained_repo_path(root, bundle_value, "scenario_bundle")
    if bundle.is_symlink() or not bundle.is_dir():
        raise ValueError("scenario_bundle must be a real directory")
    components = [("scenario-fixture", fixture)]
    for filename in _SCENARIO_BUNDLE_FILES:
        path = bundle / filename
        if path.is_symlink() or not path.is_file():
            raise ValueError(f"scenario_bundle missing required file: {filename}")
        components.append((f"scenario-bundle/{filename}", path))
    return components


def _load_scenario_fixture(root: Path, fixture: Path) -> dict[str, Any]:
    payload = _read_json(fixture)
    if not isinstance(payload, dict):
        raise ValueError("scenario fixture must be an object")
    bundle_value = payload.get("scenario_bundle")
    if bundle_value is None:
        return payload
    allowed = {
        "schema_version",
        "scenario_bundle",
        "scene_id",
        "play_language",
    }
    if set(payload) - allowed:
        raise ValueError("scenario bundle fixture has unsupported override fields")
    components = _scenario_fixture_components(root, fixture)
    artifacts = {
        _SCENARIO_BUNDLE_KEYS[path.name]: _read_json(path)
        for _label, path in components[1:]
    }
    meta = artifacts["module_meta"]
    story = artifacts["story_graph"]
    if not isinstance(meta, dict) or not isinstance(story, dict):
        raise ValueError("scenario bundle metadata and story graph must be objects")
    scenes = story.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        raise ValueError("scenario bundle story graph has no scenes")
    requested_scene = payload.get("scene_id")
    if requested_scene is None:
        start = next(
            (scene for scene in scenes if isinstance(scene, dict) and scene.get("is_start")),
            scenes[0],
        )
        requested_scene = start.get("scene_id") if isinstance(start, dict) else None
    start_scene = next(
        (
            scene
            for scene in scenes
            if isinstance(scene, dict) and scene.get("scene_id") == requested_scene
        ),
        None,
    )
    if start_scene is None:
        raise ValueError("scenario bundle start scene does not exist")
    return {
        "schema_version": payload.get("schema_version", 1),
        "scenario_id": meta.get("scenario_id"),
        "scene_id": requested_scene,
        "title": meta.get("title"),
        "dramatic_question": start_scene.get("dramatic_question"),
        "era": meta.get("era"),
        "play_language": payload.get("play_language", "zh-Hans"),
        **artifacts,
    }


_EVALUATION_PROFILE_KEYS = frozenset(
    {
        "schema_version",
        "profile_id",
        "require_structured_action_resolution",
        "min_public_rolls",
        "min_scene_count",
        "min_clues_discovered",
        "require_terminal",
        "required_completion_receipts",
        "required_rubric_ids",
    }
)
_MODULE_EXPECTATION_KEYS = frozenset({"min_scene_count", "min_clues_discovered"})


def _load_evaluation_contract(
    root: Path, case: dict[str, Any]
) -> tuple[dict[str, Any] | None, str | None]:
    """Resolve a reusable evaluation method plus case-specific module coverage."""
    path = _resolve_path(root, case.get("evaluation_profile"))
    if path is None:
        if case.get("runner") == "live_match":
            raise ValueError("live_match cases require evaluation_profile")
        if case.get("module_expectations") not in (None, {}):
            raise ValueError("module_expectations require evaluation_profile")
        return None, None
    if path.is_symlink() or not path.is_file():
        raise ValueError("evaluation_profile must be a real file")
    profile = _read_json(path)
    if not isinstance(profile, dict) or set(profile) != _EVALUATION_PROFILE_KEYS:
        raise ValueError("evaluation profile schema mismatch")
    if profile.get("schema_version") != 1:
        raise ValueError("evaluation profile schema_version mismatch")
    _safe_identifier(profile.get("profile_id"), label="evaluation profile_id")
    expectations = case.get("module_expectations") or {}
    if not isinstance(expectations, dict) or set(expectations) - _MODULE_EXPECTATION_KEYS:
        raise ValueError("module_expectations schema mismatch")
    resolved = dict(profile)
    for key, value in expectations.items():
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise ValueError(f"module_expectations.{key} must be a non-negative integer")
        resolved[key] = value
    return resolved, _sha256_file(path)


def _run_manifest_identity_keys(expected: dict[str, Any]) -> tuple[str, ...]:
    keys = _RUN_MANIFEST_IDENTITY_KEYS
    if expected.get("evaluation_profile_sha256") is not None:
        keys = (*keys, *_PROFILE_RUN_IDENTITY_KEYS)
    return keys


def _run_manifest_identity_payload(cell: dict[str, Any]) -> dict[str, Any]:
    return {key: cell.get(key) for key in _run_manifest_identity_keys(cell)}


def _initial_fixture_components(root: Path, fixture: Path) -> list[tuple[str, Path]]:
    payload = _read_json(fixture)
    if not isinstance(payload, dict):
        raise ValueError("initial state fixture must be an object")
    character_value = payload.get("character_fixture")
    if character_value is None:
        return [("initial-state-fixture", fixture)]
    character = _contained_repo_path(root, character_value, "character_fixture")
    if character.is_symlink() or not character.is_file():
        raise ValueError("character_fixture must be a real file")
    return [("initial-state-fixture", fixture), ("character-fixture", character)]


def _load_initial_state_fixture(root: Path, fixture: Path) -> dict[str, Any]:
    payload = _read_json(fixture)
    if not isinstance(payload, dict):
        raise ValueError("initial state fixture must be an object")
    components = _initial_fixture_components(root, fixture)
    if len(components) == 1:
        return payload
    expanded = dict(payload)
    expanded.pop("character_fixture", None)
    character = _read_json(components[1][1])
    if not isinstance(character, dict):
        raise ValueError("character_fixture must contain an object")
    expanded["character"] = character
    return expanded


def _composite_sha256(components: list[tuple[str, Path]]) -> str:
    digest = hashlib.sha256()
    for label, path in components:
        digest.update(label.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _safe_identifier(value: Any, *, label: str) -> str:
    if not isinstance(value, str) or not _SAFE_IDENTIFIER.fullmatch(value):
        raise ValueError(f"{label} must be a safe identifier")
    return value


def _is_sha256(value: Any) -> bool:
    return isinstance(value, str) and bool(re.fullmatch(r"[0-9a-f]{64}", value))


def _validate_model_contract(value: Any, *, label: str, required: bool) -> None:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    if not value and not required:
        return
    if set(value) != {"provider", "id"} or not all(
        isinstance(value.get(key), str) and value[key] for key in ("provider", "id")
    ):
        raise ValueError(f"{label} identity contract mismatch")


def _validate_hash_map(
    value: Any,
    *,
    label: str,
    required_keys: frozenset[str] = frozenset(),
) -> None:
    if not isinstance(value, dict) or not all(
        isinstance(key, str) and key and _is_sha256(item)
        for key, item in value.items()
    ) or not required_keys <= set(value):
        raise ValueError(f"matrix plan {label} hash contract mismatch")


def _validate_matrix_plan(plan: Any) -> dict[str, Any]:
    if not isinstance(plan, dict) or set(plan) != _MATRIX_PLAN_KEYS:
        raise ValueError("matrix plan schema mismatch")
    if plan.get("schema_version") != 1 or plan.get("eval_spec") != EVAL_SPEC:
        raise ValueError("matrix plan header mismatch")
    if plan.get("suite") not in MATRIX_SUITES:
        raise ValueError("matrix plan suite mismatch")
    if not isinstance(plan.get("generated_at"), str) or not plan["generated_at"]:
        raise ValueError("matrix plan generated_at required")
    configuration = plan.get("configuration")
    if not isinstance(configuration, dict) or set(configuration) != {
        "persona_ids",
        "seeds",
        "cases",
        "description",
    }:
        raise ValueError("matrix plan configuration mismatch")
    cells = plan.get("cells")
    if not isinstance(cells, list):
        raise ValueError("matrix plan cells must be a list")

    seen: set[str] = set()
    ready_count = 0
    not_run_count = 0
    for index, cell in enumerate(cells):
        if not isinstance(cell, dict) or set(cell) != _MATRIX_CELL_KEYS:
            raise ValueError(f"matrix plan cell[{index}] contract mismatch")
        cell_id = _safe_identifier(cell.get("cell_id"), label="cell_id")
        persona_id = _safe_identifier(cell.get("persona_id"), label="persona_id")
        case_id = _safe_identifier(cell.get("case_id"), label="case_id")
        seed = cell.get("seed")
        if type(seed) is not int:
            raise ValueError(f"matrix plan cell[{index}].seed must be int")
        if cell_id != _cell_id(persona_id, seed, case_id) or cell_id in seen:
            raise ValueError(f"matrix plan cell[{index}].cell_id mismatch")
        seen.add(cell_id)
        status = cell.get("status")
        if status not in {"READY", "NOT_RUN"}:
            raise ValueError(f"matrix plan cell[{index}].status must be READY|NOT_RUN")
        reasons = cell.get("not_run_reasons")
        if not isinstance(reasons, list) or not all(
            isinstance(reason, str) and reason for reason in reasons
        ):
            raise ValueError(f"matrix plan cell[{index}].not_run_reasons malformed")
        if (status == "READY" and reasons) or (status == "NOT_RUN" and not reasons):
            raise ValueError(f"matrix plan cell[{index}] status/reasons mismatch")
        required = status == "READY"
        for key in ("runner", "runner_path", "scenario_fixture", "initial_state_fixture"):
            value = cell.get(key)
            if required and (not isinstance(value, str) or not value):
                raise ValueError(f"matrix plan cell[{index}].{key} required")
            if value is not None and not isinstance(value, str):
                raise ValueError(f"matrix plan cell[{index}].{key} malformed")
        max_turns = cell.get("max_turns")
        if type(max_turns) is not int or max_turns <= 0:
            raise ValueError(f"matrix plan cell[{index}].max_turns must be positive int")
        _validate_model_contract(
            cell.get("player_model"), label="player_model", required=required
        )
        _validate_model_contract(
            cell.get("kp_model"), label="kp_model", required=required
        )
        _validate_model_contract(
            cell.get("judge_model"), label="judge_model", required=False
        )
        if not _is_sha256(cell.get("persona_profile_sha256")):
            raise ValueError(f"matrix plan cell[{index}] persona hash mismatch")
        _validate_hash_map(
            cell.get("prompt_hashes"),
            label="prompt_hashes",
            required_keys=frozenset({"player", "kp"}) if required else frozenset(),
        )
        _validate_hash_map(
            cell.get("runner_hashes"),
            label="runner_hashes",
            required_keys=frozenset({"runner"}) if required else frozenset(),
        )
        if not isinstance(cell.get("prompt_sources"), dict) or not isinstance(
            cell.get("judge"), dict
        ):
            raise ValueError(f"matrix plan cell[{index}] structured field mismatch")
        profile_path = cell.get("evaluation_profile")
        profile_hash = cell.get("evaluation_profile_sha256")
        evaluation_contract = cell.get("evaluation_contract")
        if cell.get("runner") == "live_match":
            if not isinstance(profile_path, str) or not profile_path:
                raise ValueError(f"matrix plan cell[{index}] evaluation profile missing")
            if not _is_sha256(profile_hash) or not isinstance(evaluation_contract, dict):
                raise ValueError(f"matrix plan cell[{index}] evaluation contract missing")
        elif not (
            (profile_path is None and profile_hash is None and evaluation_contract is None)
            or (
                isinstance(profile_path, str)
                and bool(profile_path)
                and _is_sha256(profile_hash)
                and isinstance(evaluation_contract, dict)
            )
        ):
            raise ValueError(f"matrix plan cell[{index}] evaluation profile binding mismatch")
        for key in (
            "scenario_sha256",
            "initial_state_sha256",
        ):
            value = cell.get(key)
            if required and not _is_sha256(value):
                raise ValueError(f"matrix plan cell[{index}].{key} required")
            if value is not None and not _is_sha256(value):
                raise ValueError(f"matrix plan cell[{index}].{key} malformed")
        ready_count += int(status == "READY")
        not_run_count += int(status == "NOT_RUN")

    for key, expected in (
        ("cell_count", len(cells)),
        ("ready_count", ready_count),
        ("not_run_count", not_run_count),
    ):
        if type(plan.get(key)) is not int or plan[key] != expected:
            raise ValueError(f"matrix plan {key} mismatch")
    return plan


def _model_identity(value: Any, *, label: str) -> dict[str, str] | None:
    if not isinstance(value, dict):
        return None
    provider = value.get("provider")
    model_id = value.get("id")
    if not isinstance(provider, str) or not provider:
        return None
    if not isinstance(model_id, str) or not model_id:
        return None
    if model_id.startswith("UNATTESTED"):
        return None
    return {"provider": provider, "id": model_id}


@lru_cache(maxsize=32)
def _pi_model_preflight(root: Path, provider: str, model_id: str) -> bool:
    """Check Pi's configured model registry without reading credentials into Python."""
    package = (
        root
        / "runtime"
        / "adapters"
        / "player"
        / "node_modules"
        / "@earendil-works"
        / "pi-coding-agent"
        / "package.json"
    )
    if not package.is_file():
        return False
    source = r"""
const provider = process.argv[1];
const modelId = process.argv[2];
const { AuthStorage, ModelRegistry, getAgentDir } = await import("@earendil-works/pi-coding-agent");
const agentDir = getAgentDir();
const auth = AuthStorage.create(`${agentDir}/auth.json`);
const registry = ModelRegistry.create(auth, `${agentDir}/models.json`);
let model = registry.find(provider, modelId);
if (!model && provider === "coding-relay") {
  model = registry.getAll().find(
    (candidate) => candidate.provider === provider && registry.hasConfiguredAuth(candidate),
  );
}
if (!model || !registry.hasConfiguredAuth(model)) process.exit(1);
"""
    try:
        completed = subprocess.run(
            ["node", "--input-type=module", "-e", source, provider, model_id],
            cwd=package.parents[3],
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return False
    return completed.returncode == 0


def load_matrix_suite_config(
    root: Path | str,
    suite: str,
    *,
    configuration: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if suite not in MATRIX_SUITES:
        raise ValueError(f"matrix suite must be nightly|release, got {suite}")
    if configuration is not None:
        if not isinstance(configuration, dict):
            raise ValueError("configuration must be an object")
        if configuration.get("schema_version") != 1:
            raise ValueError("matrix configuration schema_version must be 1")
        if configuration.get("eval_spec") != EVAL_SPEC:
            raise ValueError("matrix configuration eval_spec mismatch")
        return {
            "persona_ids": list(configuration["persona_ids"]),
            "seeds": list(configuration["seeds"]),
            "cases": list(configuration["cases"]),
            "description": configuration.get("description"),
        }

    manifest = contract.load_benchmark_manifest(root)
    matrix = manifest.get("matrix")
    if not isinstance(matrix, dict):
        raise ValueError("benchmark-manifest.json missing matrix configuration")
    if matrix.get("schema_version") != 1 or matrix.get("eval_spec") != EVAL_SPEC:
        raise ValueError("invalid matrix configuration header")
    suites = matrix.get("suites")
    if not isinstance(suites, dict) or suite not in suites:
        raise ValueError(f"matrix suite missing: {suite}")
    suite_config = suites[suite]
    if not isinstance(suite_config, dict):
        raise ValueError(f"matrix suite must be an object: {suite}")
    persona_ids = suite_config.get("persona_ids")
    seeds = suite_config.get("seeds")
    cases = suite_config.get("cases")
    if not isinstance(persona_ids, list) or not persona_ids:
        raise ValueError(f"{suite} matrix persona_ids required")
    if not isinstance(seeds, list) or len(seeds) < 1:
        raise ValueError(f"{suite} matrix seeds required")
    if not isinstance(cases, list) or not cases:
        raise ValueError(f"{suite} matrix cases required")
    return {
        "persona_ids": list(persona_ids),
        "seeds": list(seeds),
        "cases": list(cases),
        "description": suite_config.get("description"),
    }


def load_matrix_execution_policy(
    root: Path | str,
    suite: str,
    *,
    configuration: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Load the versioned bounded scheduler policy for a matrix suite."""
    source: Any = configuration
    if source is None:
        manifest = contract.load_benchmark_manifest(root)
        source = (((manifest.get("matrix") or {}).get("suites") or {}).get(suite))
    policy = source.get("execution_policy") if isinstance(source, dict) else None
    if policy is None:
        return {
            "runner_timeout_seconds": 120.0,
            "judge_timeout_seconds": 120.0,
            "max_workers": 1,
        }
    if not isinstance(policy, dict) or set(policy) != {
        "runner_timeout_seconds", "judge_timeout_seconds", "max_workers"
    }:
        raise ValueError("matrix execution_policy schema mismatch")
    runner_timeout = _positive_timeout(
        policy.get("runner_timeout_seconds"), label="runner_timeout_seconds"
    )
    judge_timeout = _positive_timeout(
        policy.get("judge_timeout_seconds"), label="judge_timeout_seconds"
    )
    workers = policy.get("max_workers")
    if isinstance(workers, bool) or not isinstance(workers, int) or not 1 <= workers <= 8:
        raise ValueError("matrix execution_policy.max_workers must be in 1..8")
    return {
        "runner_timeout_seconds": runner_timeout,
        "judge_timeout_seconds": judge_timeout,
        "max_workers": workers,
    }


def _cell_id(persona_id: str, seed: int, case_id: str) -> str:
    persona = _safe_identifier(persona_id, label="persona_id")
    case = _safe_identifier(case_id, label="case_id")
    return _safe_identifier(
        f"{persona}__seed-{seed}__{case}", label="cell_id"
    )


def _collect_not_run_reasons(
    *,
    root: Path,
    case: dict[str, Any],
    player_model: dict[str, str] | None,
    kp_model: dict[str, str] | None,
    credential_env: dict[str, str],
    model_preflight: ModelPreflight | None,
) -> list[str]:
    reasons: list[str] = []
    runner_path = _resolve_path(root, case.get("runner_path"))
    if runner_path is None or not runner_path.is_file():
        reasons.append("missing_runner_path")
    scenario = _resolve_path(root, case.get("scenario_fixture"))
    if scenario is None or not scenario.is_file():
        reasons.append("missing_scenario_fixture")
    initial_state = _resolve_path(root, case.get("initial_state_fixture"))
    if initial_state is None or not initial_state.is_file():
        reasons.append("missing_initial_state_fixture")
    evaluation_profile = _resolve_path(root, case.get("evaluation_profile"))
    if case.get("runner") == "live_match" and (
        evaluation_profile is None or not evaluation_profile.is_file()
    ):
        reasons.append("missing_evaluation_profile")
    if player_model is None:
        reasons.append("missing_player_model_identity")
    if kp_model is None:
        reasons.append("missing_kp_model_identity")
    if model_preflight is not None:
        for role, identity in (("player", player_model), ("kp", kp_model)):
            if identity is None:
                continue
            try:
                ready = bool(model_preflight(identity["provider"], identity["id"]))
            except Exception:
                ready = False
            if not ready:
                reasons.append(f"model_preflight_failed:{role}")
    required = case.get("require_credentials") or []
    if not isinstance(required, list):
        raise ValueError("require_credentials must be a list")
    for name in required:
        key = str(name)
        if not credential_env.get(key):
            reasons.append(f"missing_credentials:{key}")
    return reasons


def _runner_hashes(root: Path, case: dict[str, Any]) -> dict[str, str]:
    hashes: dict[str, str] = {}
    runner_path = _resolve_path(root, case.get("runner_path"))
    if runner_path is not None and runner_path.is_file():
        hashes["runner"] = _sha256_file(runner_path)
    runner_kind = str(case.get("runner") or "")
    if runner_kind == "live_match":
        live = root / "plugins" / "coc-keeper" / "scripts" / "coc_live_match.py"
        if live.is_file():
            hashes["live_match"] = _sha256_file(live)
    if runner_kind == "interactive_playtest":
        interactive = (
            root / "plugins" / "coc-keeper" / "scripts" / "coc_interactive_playtest.py"
        )
        if interactive.is_file():
            hashes["interactive_playtest"] = _sha256_file(interactive)
    return hashes


def _initial_state_sha256(root: Path, case: dict[str, Any]) -> str | None:
    path = _resolve_path(root, case.get("initial_state_fixture"))
    if path is None or not path.is_file():
        return None
    return _composite_sha256(_initial_fixture_components(root, path))


def _scenario_sha256(root: Path, case: dict[str, Any]) -> str | None:
    path = _resolve_path(root, case.get("scenario_fixture"))
    if path is None or not path.is_file():
        return None
    return _composite_sha256(_scenario_fixture_components(root, path))


def _prompt_hashes(
    root: Path, case: dict[str, Any], reasons: list[str]
) -> dict[str, str]:
    sources = case.get("prompt_sources")
    if isinstance(sources, dict):
        hashes: dict[str, str] = {}
        for role in ("player", "kp"):
            source = _resolve_path(root, sources.get(role))
            if source is None or not source.is_file():
                reasons.append(f"missing_prompt_source:{role}")
                continue
            hashes[role] = _sha256_file(source)
        return hashes

    # Preserve focused fake-adapter tests. Real live cells must use source paths.
    legacy = case.get("prompt_hashes")
    if case.get("runner") != "live_match" and isinstance(legacy, dict) and legacy:
        return dict(legacy)
    reasons.append("missing_prompt_sources")
    return {}


def build_matrix_plan(
    *,
    root: Path | str,
    suite: str,
    configuration: dict[str, Any] | None = None,
    credential_env: dict[str, str] | None = None,
    model_preflight: ModelPreflight | None = None,
) -> dict[str, Any]:
    """Deterministically expand persona × seed × case cells with fail-closed gates."""
    root_path = Path(root).resolve()
    suite_config = load_matrix_suite_config(
        root_path, suite, configuration=configuration
    )
    personas_payload = semantic.load_personas(root_path)
    personas = {
        item["persona_id"]: item for item in personas_payload["personas"]
    }
    env = dict(credential_env if credential_env is not None else os.environ)
    effective_preflight = model_preflight
    if effective_preflight is None:
        effective_preflight = lambda provider, model: _pi_model_preflight(
            root_path, provider, model
        )
    cells: list[dict[str, Any]] = []

    for persona_id in suite_config["persona_ids"]:
        persona_id = _safe_identifier(persona_id, label="persona_id")
        if persona_id not in personas:
            raise ValueError(f"unknown persona_id in matrix config: {persona_id}")
        persona = personas[persona_id]
        profile_hash = semantic.persona_canonical_sha256(persona)
        for seed in suite_config["seeds"]:
            if type(seed) is not int:
                raise ValueError(f"matrix seed must be int: {seed!r}")
            for case in suite_config["cases"]:
                if not isinstance(case, dict):
                    raise ValueError("matrix case must be an object")
                case_id = case.get("case_id")
                if not isinstance(case_id, str) or not case_id:
                    raise ValueError("matrix case_id required")
                case_id = _safe_identifier(case_id, label="case_id")
                evaluation_contract, evaluation_profile_sha256 = (
                    _load_evaluation_contract(root_path, case)
                )
                player_model = _model_identity(
                    case.get("player_model"), label="player_model"
                )
                kp_model = _model_identity(case.get("kp_model"), label="kp_model")
                # Preserve declared identities for evidence even when unattested.
                declared_player = case.get("player_model") if isinstance(
                    case.get("player_model"), dict
                ) else {}
                declared_kp = case.get("kp_model") if isinstance(
                    case.get("kp_model"), dict
                ) else {}
                reasons = _collect_not_run_reasons(
                    root=root_path,
                    case=case,
                    player_model=player_model,
                    kp_model=kp_model,
                    credential_env=env,
                    model_preflight=(
                        effective_preflight
                        if case.get("runner") == "live_match"
                        else model_preflight
                    ),
                )
                prompt_hashes = _prompt_hashes(root_path, case, reasons)
                judge_config = (
                    dict(case.get("judge"))
                    if isinstance(case.get("judge"), dict)
                    else {}
                )
                if evaluation_contract is not None and not (
                    "rubric_id" in judge_config or "rubric_ids" in judge_config
                ):
                    judge_config["rubric_ids"] = list(
                        evaluation_contract["required_rubric_ids"]
                    )
                cell = {
                    "cell_id": _cell_id(str(persona_id), int(seed), str(case_id)),
                    "persona_id": persona_id,
                    "seed": int(seed),
                    "case_id": case_id,
                    "runner": case.get("runner"),
                    "runner_path": case.get("runner_path"),
                    "scenario_fixture": case.get("scenario_fixture"),
                    "initial_state_fixture": case.get("initial_state_fixture"),
                    "evaluation_profile": case.get("evaluation_profile"),
                    "evaluation_profile_sha256": evaluation_profile_sha256,
                    "evaluation_contract": evaluation_contract,
                    "max_turns": case.get("max_turns", 3),
                    "player_model": declared_player,
                    "kp_model": declared_kp,
                    "judge_model": (
                        case.get("judge_model")
                        if isinstance(case.get("judge_model"), dict)
                        else {}
                    ),
                    "persona_profile_sha256": profile_hash,
                    "prompt_hashes": dict(prompt_hashes),
                    "prompt_sources": (
                        dict(case.get("prompt_sources"))
                        if isinstance(case.get("prompt_sources"), dict)
                        else {}
                    ),
                    "runner_hashes": _runner_hashes(root_path, case),
                    "scenario_sha256": _scenario_sha256(root_path, case),
                    "initial_state_sha256": _initial_state_sha256(root_path, case),
                    "judge": judge_config,
                    "status": "NOT_RUN" if reasons else "READY",
                    "not_run_reasons": reasons,
                }
                cells.append(cell)

    plan = {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "suite": suite,
        "generated_at": _utc_now(),
        "configuration": {
            "persona_ids": list(suite_config["persona_ids"]),
            "seeds": list(suite_config["seeds"]),
            "cases": [
                {"case_id": case.get("case_id"), "runner": case.get("runner")}
                for case in suite_config["cases"]
                if isinstance(case, dict)
            ],
            "description": suite_config.get("description"),
        },
        "cell_count": len(cells),
        "cells": cells,
        "ready_count": sum(1 for cell in cells if cell["status"] == "READY"),
        "not_run_count": sum(1 for cell in cells if cell["status"] == "NOT_RUN"),
    }
    return plan


def build_player_request_payload(
    *,
    initial_state: dict[str, Any],
    scenario: dict[str, Any],
    persona: dict[str, Any],
    seed: int,
) -> dict[str, Any]:
    """Assemble player-facing inputs with Keeper-only fields excluded."""
    public_state = initial_state.get("public_state")
    if not isinstance(public_state, dict):
        public_state = {
            key: value
            for key, value in initial_state.items()
            if key
            not in {
                "keeper_only",
                "keeper_secret",
                "player_evaluation_notes",
                "character_card",
                "transcript_tail",
                "pending_choice",
                "narration",
            }
        }
    narration = initial_state.get("narration")
    if narration is None:
        narration = scenario.get("dramatic_question") or scenario.get("scene_id") or ""
    character_card = initial_state.get("character_card")
    if not isinstance(character_card, dict):
        character_card = {}
    transcript_tail = initial_state.get("transcript_tail")
    if not isinstance(transcript_tail, list):
        transcript_tail = []
    pending_choice = initial_state.get("pending_choice")
    return {
        "public_state": public_state,
        "narration": str(narration or ""),
        "character_card": character_card,
        "transcript_tail": transcript_tail,
        "pending_choice": pending_choice,
        "persona_id": persona.get("persona_id"),
        "persona_prompt_directives": list(persona.get("prompt_directives") or []),
        "seed": seed,
    }


def build_kp_request_payload(
    *,
    initial_state: dict[str, Any],
    scenario: dict[str, Any],
    seed: int,
) -> dict[str, Any]:
    """Assemble KP inputs without player evaluation notes."""
    scenario_public = {
        key: value
        for key, value in scenario.items()
        if key not in {"keeper_secret", "keeper_secrets", "forbidden_outcomes"}
    }
    state_for_kp = {
        key: value
        for key, value in initial_state.items()
        if key != "player_evaluation_notes"
    }
    return {
        "scenario": scenario_public,
        "initial_state": state_for_kp,
        "seed": seed,
    }


class _TailStreamCapture:
    """Bounded byte tail plus enough boundary state for strict final-line parse."""

    def __init__(self, limit: int):
        self.limit = limit
        self.capacity = limit + 1
        self.total = 0
        self.buffer = bytearray()
        self.newlines: deque[int] = deque()

    def feed(self, chunk: bytes) -> None:
        if not chunk:
            return
        offset = self.total
        start = 0
        while True:
            index = chunk.find(b"\n", start)
            if index < 0:
                break
            self.newlines.append(offset + index)
            start = index + 1
        self.total += len(chunk)
        self.buffer.extend(chunk)
        if len(self.buffer) > self.capacity:
            del self.buffer[: len(self.buffer) - self.capacity]
        buffer_start = self.total - len(self.buffer)
        while self.newlines and self.newlines[0] < buffer_start - 1:
            self.newlines.popleft()

    @property
    def truncated(self) -> bool:
        return self.total > self.limit

    def evidence_text(self) -> str:
        return bytes(self.buffer[-self.limit :]).decode("utf-8", errors="ignore")

    def complete_final_line(self) -> bytes | None:
        if not self.buffer:
            return None
        raw = bytes(self.buffer)
        buffer_start = self.total - len(raw)
        end = self.total
        while end > buffer_start and raw[end - buffer_start - 1] in b"\r\n":
            end -= 1
        if end <= buffer_start:
            return None
        boundary = -1
        for position in reversed(self.newlines):
            if position < end:
                boundary = position
                break
        if boundary >= 0:
            start = boundary + 1
        elif buffer_start == 0:
            start = 0
        else:
            return None
        if start < buffer_start or end - start > self.limit:
            return None
        return raw[start - buffer_start : end - buffer_start]


def _drain_runner_pipes(
    proc: subprocess.Popen[bytes], timeout_s: float
) -> tuple[_TailStreamCapture, _TailStreamCapture, bool, bool, bool]:
    """Drain both pipes incrementally under one absolute deadline."""
    captures = (
        _TailStreamCapture(_TIMEOUT_STREAM_LIMIT_BYTES),
        _TailStreamCapture(_TIMEOUT_STREAM_LIMIT_BYTES),
    )
    selector = selectors.DefaultSelector()
    for pipe, capture in zip((proc.stdout, proc.stderr), captures):
        if pipe is None:
            continue
        os.set_blocking(pipe.fileno(), False)
        selector.register(pipe, selectors.EVENT_READ, capture)

    def drain_until(deadline: float, *, require_process_exit: bool) -> bool:
        while True:
            if not selector.get_map():
                if not require_process_exit or proc.poll() is not None:
                    return True
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return False
            if not selector.get_map():
                time.sleep(min(0.01, remaining))
                continue
            try:
                events = selector.select(min(0.05, remaining))
            except InterruptedError:
                continue
            for key, _ in events:
                pipe = key.fileobj
                try:
                    chunk = os.read(pipe.fileno(), 64 * 1024)
                except (BlockingIOError, InterruptedError):
                    continue
                if chunk:
                    key.data.feed(chunk)
                    continue
                selector.unregister(pipe)
                pipe.close()

    timed_out = not drain_until(
        time.monotonic() + timeout_s, require_process_exit=True
    )
    tree_terminated = True
    output_drained = True
    if timed_out:
        tree_terminated = _terminate_process_tree(proc)
        output_drained = drain_until(
            time.monotonic() + 0.5, require_process_exit=False
        )
    for key in list(selector.get_map().values()):
        try:
            selector.unregister(key.fileobj)
        except (KeyError, ValueError):
            pass
        try:
            key.fileobj.close()
        except OSError:
            pass
    selector.close()
    try:
        proc.wait(timeout=0.1)
    except (OSError, subprocess.TimeoutExpired):
        pass
    return captures[0], captures[1], timed_out, tree_terminated, output_drained


def _invoke_fake_or_script_runner(
    *,
    runner_path: Path,
    cell_input: Path,
    cell_dir: Path,
    timeout_s: float,
) -> dict[str, Any]:
    if not _supports_process_tree_supervisor():
        return {
            "status": "NOT_RUN",
            "not_run_reasons": ["process_tree_supervisor_unsupported"],
            "returncode": None,
            "stdout": "",
            "stderr": "",
        }
    process_kwargs: dict[str, Any] = {}
    if os.name == "posix":
        process_kwargs["start_new_session"] = True
    elif hasattr(subprocess, "CREATE_NEW_PROCESS_GROUP"):
        process_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    proc = subprocess.Popen(
        [sys.executable, str(runner_path), str(cell_input), str(cell_dir)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=False,
        bufsize=0,
        **process_kwargs,
    )
    with _ACTIVE_RUNNERS_LOCK:
        _ACTIVE_RUNNERS[proc.pid] = proc
    try:
        (
            stdout_capture,
            stderr_capture,
            timed_out,
            tree_terminated,
            output_drained,
        ) = _drain_runner_pipes(proc, timeout_s)
    except BaseException:
        # Operator cancellation and interpreter shutdown must not orphan the
        # live-cell runner or its persistent player/narrator server children.
        _terminate_process_tree(proc)
        for pipe in (proc.stdout, proc.stderr):
            if pipe is not None:
                try:
                    pipe.close()
                except OSError:
                    pass
        try:
            proc.wait(timeout=0.1)
        except (OSError, subprocess.TimeoutExpired):
            pass
        with _ACTIVE_RUNNERS_LOCK:
            _ACTIVE_RUNNERS.pop(proc.pid, None)
        raise
    raw_stdout = stdout_capture.evidence_text()
    raw_stderr = stderr_capture.evidence_text()
    payload: dict[str, Any]
    if timed_out:
        reasons = ["execution_timeout"]
        if not tree_terminated:
            reasons.append("process_tree_termination_unconfirmed")
        if not output_drained:
            reasons.append("process_output_drain_timeout")
        payload = {
            "status": "NOT_RUN",
            "timed_out": True,
            "not_run_reasons": reasons,
        }
    else:
        final_line = stdout_capture.complete_final_line()
        if final_line is None:
            payload = {
                "status": "FAIL",
                "empty_stdout": stdout_capture.total == 0,
                "final_stdout_line_incomplete": stdout_capture.total > 0,
            }
        else:
            try:
                parsed = json.loads(final_line.decode("utf-8", errors="strict"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                payload = {"status": "FAIL", "parse_error": True}
            else:
                payload = (
                    parsed
                    if isinstance(parsed, dict)
                    else {"status": "FAIL", "parse_error": True}
                )
    if not timed_out and proc.returncode != 0 and payload.get("status") == "PASS":
        payload["status"] = "FAIL"
    payload["returncode"] = proc.returncode
    payload["stdout"] = raw_stdout
    payload["stderr"] = raw_stderr
    payload["stdout_truncated"] = stdout_capture.truncated
    payload["stderr_truncated"] = stderr_capture.truncated
    with _ACTIVE_RUNNERS_LOCK:
        _ACTIVE_RUNNERS.pop(proc.pid, None)
    return payload


def _terminate_active_matrix_runners() -> None:
    with _ACTIVE_RUNNERS_LOCK:
        active = list(_ACTIVE_RUNNERS.values())
    for proc in active:
        _terminate_process_tree(proc)


def _supports_process_tree_supervisor() -> bool:
    """Whether timeout execution can own and stop a complete process tree."""
    return os.name == "posix" and hasattr(os, "kill")


def _descendant_pids(root_pid: int) -> list[int]:
    """Snapshot descendants without signalling a possibly shared process group."""
    try:
        completed = subprocess.run(
            ["ps", "-axo", "pid=,ppid="],
            capture_output=True,
            text=True,
            check=False,
            timeout=1.0,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    children: dict[int, list[int]] = {}
    for line in (completed.stdout or "").splitlines():
        parts = line.split()
        if len(parts) != 2:
            continue
        try:
            pid, parent = int(parts[0]), int(parts[1])
        except ValueError:
            continue
        children.setdefault(parent, []).append(pid)
    result: list[int] = []
    pending = list(children.get(root_pid, []))
    while pending:
        pid = pending.pop()
        if pid in result or pid == os.getpid():
            continue
        result.append(pid)
        pending.extend(children.get(pid, []))
    return result


def _terminate_process_tree(proc: subprocess.Popen[str]) -> bool:
    """Boundedly terminate descendants and then the runner leader.

    Descendant enumeration is intentionally used instead of ``killpg``. Even
    with ``start_new_session=True``, signalling a guessed process-group ID is
    too dangerous at an evaluator boundary: a platform anomaly or PID reuse
    must never terminate the evaluator itself.
    """
    if not _supports_process_tree_supervisor():
        return False
    confirmed = True
    descendants = _descendant_pids(proc.pid)
    for pid in descendants:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        except OSError:
            confirmed = False
    # Keep the leader alive while descendants receive TERM, so ancestry can be
    # revalidated before SIGKILL and a recycled PID is never targeted.
    grace_deadline = time.monotonic() + 0.2
    while time.monotonic() < grace_deadline:
        time.sleep(0.02)
    remaining = _descendant_pids(proc.pid)
    for pid in remaining:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except OSError:
            confirmed = False
    try:
        proc.terminate()
    except ProcessLookupError:
        pass
    except OSError:
        confirmed = False
    if proc.poll() is None:
        try:
            proc.kill()
        except OSError:
            confirmed = False
    try:
        proc.wait(timeout=0.5)
    except subprocess.TimeoutExpired:
        confirmed = False
    return confirmed


def _stream_text(value: str | bytes | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value


def _bounded_stream_evidence(value: Any) -> tuple[str, bool]:
    text = _stream_text(value if isinstance(value, (str, bytes)) else None)
    encoded = text.encode("utf-8")
    if len(encoded) <= _TIMEOUT_STREAM_LIMIT_BYTES:
        return text, False
    return (
        encoded[-_TIMEOUT_STREAM_LIMIT_BYTES:].decode("utf-8", errors="ignore"),
        True,
    )


def _persist_timeout_streams(
    cell_dir: Path, runner_result: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, str]]:
    """Persist bounded runner streams as cell-local, hash-bound evidence."""
    stdout, stdout_bounded = _bounded_stream_evidence(runner_result.get("stdout"))
    stderr, stderr_bounded = _bounded_stream_evidence(runner_result.get("stderr"))
    stdout_truncated = bool(runner_result.get("stdout_truncated")) or stdout_bounded
    stderr_truncated = bool(runner_result.get("stderr_truncated")) or stderr_bounded
    stdout_path = _write_text_atomic(cell_dir / "runner-timeout-stdout.log", stdout)
    stderr_path = _write_text_atomic(cell_dir / "runner-timeout-stderr.log", stderr)
    artifact_hashes = {
        stdout_path.name: _sha256_file(stdout_path),
        stderr_path.name: _sha256_file(stderr_path),
    }
    return (
        {
            "stdout_path": stdout_path.name,
            "stderr_path": stderr_path.name,
            "stdout_truncated": stdout_truncated,
            "stderr_truncated": stderr_truncated,
        },
        artifact_hashes,
    )


def _positive_timeout(value: Any, *, label: str) -> float:
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(float(value))
        or float(value) <= 0
    ):
        raise ValueError(f"{label} must be positive")
    return float(value)


def _is_timeout_exception(exc: BaseException) -> bool:
    pending: list[BaseException] = [exc]
    seen: set[int] = set()
    while pending:
        current = pending.pop()
        if id(current) in seen:
            continue
        seen.add(id(current))
        if isinstance(current, (TimeoutError, subprocess.TimeoutExpired)):
            return True
        reason = getattr(current, "reason", None)
        if isinstance(reason, BaseException):
            pending.append(reason)
        for linked in (current.__cause__, current.__context__):
            if isinstance(linked, BaseException):
                pending.append(linked)
    return False


def _safe_failure(exc: BaseException, *, default_code: str) -> dict[str, str]:
    """Preserve bounded public diagnostics without serializing exception state."""
    return {
        "error_type": type(exc).__name__,
        "error_code": str(getattr(exc, "code", default_code)),
        "message": " ".join(str(exc).split())[:500],
    }


def _contained_cell_dir(output: Path, cell_id: str) -> Path:
    safe_cell_id = _safe_identifier(cell_id, label="cell_id")
    cells_path = output / "cells"
    if cells_path.is_symlink():
        raise ValueError("matrix cells directory must not be a symlink")
    cells_path.mkdir(parents=True, exist_ok=True)
    cells_root = cells_path.resolve()
    try:
        cells_root.relative_to(output.resolve())
    except ValueError as exc:
        raise ValueError("matrix cells directory escaped output") from exc
    candidate = cells_root / safe_cell_id
    resolved = candidate.resolve()
    try:
        resolved.relative_to(cells_root)
    except ValueError as exc:
        raise ValueError("cell directory escaped matrix cells output") from exc
    if candidate.is_symlink():
        raise ValueError("matrix cell directory must not be a symlink")
    return resolved


def _paths_overlap(first: Path, second: Path) -> bool:
    return first == second or first in second.parents or second in first.parents


def _reject_symlink_components(path: Path | str, *, label: str) -> Path:
    """Return an absolute lexical path after checking every component."""
    raw = Path(path).absolute()
    for component in reversed((raw, *raw.parents)):
        if component.is_symlink():
            raise ValueError(f"{label} path component must not be a symlink: {component}")
    return raw


def _validated_matrix_paths(
    output: Path | str, baseline_dir: Path | str | None
) -> tuple[Path, Path | None]:
    raw_output = Path(output).absolute()
    if raw_output.is_symlink():
        raise ValueError("matrix output must not be a symlink")
    resolved_output = raw_output.resolve()
    if baseline_dir is None:
        return resolved_output, None
    raw_baseline = _reject_symlink_components(baseline_dir, label="baseline")
    raw_cells = raw_baseline / "cells"
    if raw_cells.is_symlink():
        raise ValueError("baseline cells must not be a symlink")
    resolved_baseline = raw_baseline.resolve()
    if _paths_overlap(resolved_output, resolved_baseline):
        raise ValueError("baseline and output paths overlap")
    return resolved_output, resolved_baseline


def _preflight_baseline_cell_paths(baseline: Path | None) -> None:
    if baseline is None:
        return
    cells = baseline / "cells"
    if cells.is_symlink():
        raise ValueError("baseline cells must not be a symlink")
    if not cells.exists():
        return
    if not cells.is_dir():
        raise ValueError("baseline cells must be a directory")
    for entry in cells.iterdir():
        if entry.is_symlink():
            raise ValueError("baseline cell must not be a symlink")


def _baseline_cells(
    baseline_dir: Path | None,
    candidate_plan: dict[str, Any],
) -> tuple[Path | None, dict[str, dict[str, Any]], list[str]]:
    if baseline_dir is None:
        return None, {}, []
    root = baseline_dir.resolve()
    plan_path = root / "matrix-plan.json"
    if plan_path.is_symlink() or not plan_path.is_file():
        return root, {}, []
    try:
        plan = _read_json(plan_path)
    except ValueError:
        return root, {}, ["baseline_plan_malformed"]
    if not isinstance(plan, dict):
        return root, {}, ["baseline_plan_malformed"]
    contract_mismatches = [
        key
        for key in ("schema_version", "eval_spec", "suite")
        if plan.get(key) != candidate_plan.get(key)
    ]
    if contract_mismatches:
        return root, {}, contract_mismatches
    cells: dict[str, dict[str, Any]] = {}
    cells_path = root / "cells"
    if cells_path.is_symlink():
        raise ValueError("baseline cells must not be a symlink")
    for item in plan.get("cells") or []:
        if not isinstance(item, dict):
            continue
        cell_id = item.get("cell_id")
        if isinstance(cell_id, str) and _SAFE_IDENTIFIER.fullmatch(cell_id):
            if (cells_path / cell_id).is_symlink():
                raise ValueError("baseline cell must not be a symlink")
            cells[cell_id] = item
    return root, cells, []


def _baseline_result_cells(
    root: Path | None,
    candidate_plan: dict[str, Any],
    baseline_cells: dict[str, dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], list[str]]:
    if root is None:
        return {}, []
    path = root / "matrix-results.json"
    if path.is_symlink() or not path.is_file():
        return {}, []
    try:
        payload = _read_json(path)
    except ValueError:
        return {}, ["baseline_results_malformed"]
    if not isinstance(payload, dict):
        return {}, ["baseline_results_malformed"]
    mismatches = [
        key
        for key, expected in (
            ("schema_version", 1),
            ("eval_spec", EVAL_SPEC),
            ("suite", candidate_plan.get("suite")),
        )
        if payload.get(key) != expected
    ]
    artifact_hashes = payload.get("artifact_hashes")
    plan_path = root / "matrix-plan.json"
    if (
        not isinstance(artifact_hashes, dict)
        or not plan_path.is_file()
        or artifact_hashes.get("matrix-plan.json") != _sha256_file(plan_path)
    ):
        mismatches.append("matrix-plan.json")
    if mismatches:
        return {}, mismatches
    result_rows = payload.get("cells")
    if not isinstance(result_rows, list):
        return {}, ["cells"]
    expected_ids = set(baseline_cells)
    cells: dict[str, dict[str, Any]] = {}
    for item in result_rows:
        if not isinstance(item, dict):
            return {}, ["cell_manifest_binding"]
        cell_id = item.get("cell_id")
        if (
            not isinstance(cell_id, str)
            or not _SAFE_IDENTIFIER.fullmatch(cell_id)
            or cell_id in cells
            or cell_id not in expected_ids
            or item.get("status")
            not in {"PASS", "FAIL", "NOT_RUN", "INELIGIBLE", "NON_COMPARABLE"}
        ):
            return {}, ["cell_manifest_binding"]
        result_hashes = item.get("artifact_hashes")
        expected_manifest_hash = (
            result_hashes.get("run-manifest.json")
            if isinstance(result_hashes, dict)
            else None
        )
        cell_dir = _baseline_cell_dir(root, cell_id)
        if cell_dir is None or not isinstance(expected_manifest_hash, str):
            return {}, ["cell_manifest_binding"]
        manifest_path = cell_dir / "run-manifest.json"
        baseline_cell = baseline_cells[cell_id]
        try:
            manifest = _validated_run_manifest(
                cell_dir,
                cell_id,
                expected_identity=baseline_cell,
            )
        except (OSError, UnicodeError, ValueError):
            return {}, ["cell_manifest_binding"]
        if expected_manifest_hash != _sha256_file(manifest_path):
            return {}, ["cell_manifest_binding"]
        if any(
            key not in item
            or item.get(key) != baseline_cell.get(key)
            or item.get(key) != manifest.get(key)
            for key in _run_manifest_identity_keys(baseline_cell)
        ):
            return {}, ["cell_manifest_binding"]
        for field in ("not_run_reasons", "hard_findings"):
            values = item.get(field, [])
            if not isinstance(values, list) or not all(
                isinstance(value, str) and value for value in values
            ):
                return {}, ["cell_manifest_binding"]
        capture_status = (
            item.get("status") == "NOT_RUN"
            and item.get("not_run_reasons") == ["missing_baseline_evidence"]
            and not item.get("hard_findings")
            and isinstance(item.get("runner_result"), dict)
            and item["runner_result"].get("status") == "PASS"
            and manifest.get("status") == "PASS"
            and manifest.get("evidence_eligible") is True
        )
        pass_status = (
            item.get("status") == "PASS"
            and not item.get("not_run_reasons")
            and not item.get("hard_findings")
            and isinstance(item.get("runner_result"), dict)
            and item["runner_result"].get("status") == "PASS"
        )
        if item.get("status") != manifest.get("status") and not capture_status:
            return {}, ["cell_manifest_binding"]
        if item.get("status") == "PASS" and not pass_status:
            return {}, ["cell_manifest_binding"]
        cells[cell_id] = item
    if set(cells) != expected_ids:
        return {}, ["cell_manifest_binding"]
    return cells, []


def _baseline_cell_dir(root: Path, cell_id: str) -> Path | None:
    raw_cells = root / "cells"
    if raw_cells.is_symlink():
        raise ValueError("baseline cells must not be a symlink")
    cells_root = raw_cells.resolve()
    candidate = raw_cells / _safe_identifier(cell_id, label="cell_id")
    if candidate.is_symlink():
        raise ValueError("baseline cell must not be a symlink")
    resolved = candidate.resolve()
    try:
        resolved.relative_to(cells_root)
    except ValueError:
        return None
    if candidate.is_symlink() or not resolved.is_dir():
        return None
    return resolved


def _public_cell_turns(cell_dir: Path) -> list[dict[str, Any]]:
    rows = _read_jsonl(cell_dir / "player-view.jsonl")
    return semantic.extract_public_turns(rows) if rows else []


def _attested_public_cell_turns(
    cell_dir: Path,
    *,
    expected_cell_id: str,
    expected_identity: dict[str, Any] | None = None,
    result_cell: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    manifest_path = cell_dir / "run-manifest.json"
    player_view_path = cell_dir / "player-view.jsonl"
    if (
        manifest_path.is_symlink()
        or player_view_path.is_symlink()
        or not manifest_path.is_file()
        or not player_view_path.is_file()
    ):
        raise ValueError("attested public evidence missing")
    manifest = _validated_run_manifest(
        cell_dir,
        expected_cell_id,
        expected_identity=expected_identity,
        require_clean=True,
    )
    if (
        manifest.get("status") != "PASS"
        or manifest.get("evidence_eligible") is not True
        or manifest.get("cell_id") != expected_cell_id
    ):
        raise ValueError("attested public evidence is not eligible")
    artifact_hashes = manifest.get("artifact_hashes")
    if not isinstance(artifact_hashes, dict) or artifact_hashes.get(
        "player-view.jsonl"
    ) != _sha256_file(player_view_path):
        raise ValueError("attested public evidence hash mismatch")
    if result_cell is not None:
        result_hashes = result_cell.get("artifact_hashes")
        capture_status = (
            result_cell.get("status") == "NOT_RUN"
            and result_cell.get("not_run_reasons") == ["missing_baseline_evidence"]
            and not result_cell.get("hard_findings")
            and isinstance(result_cell.get("runner_result"), dict)
            and result_cell["runner_result"].get("status") == "PASS"
        )
        if (
            result_cell.get("status") != "PASS" and not capture_status
        ) or (
            not isinstance(result_hashes, dict)
            or result_hashes.get("run-manifest.json")
            != _sha256_file(manifest_path)
        ):
            raise ValueError("baseline result manifest hash mismatch")
    turns = _public_cell_turns(cell_dir)
    if not turns:
        raise ValueError("attested public evidence is empty")
    return turns


def _judge_identity_mismatches(
    baseline_cell: dict[str, Any], candidate_cell: dict[str, Any]
) -> list[str]:
    return [
        key
        for key in _JUDGE_IDENTITY_KEYS
        if baseline_cell.get(key) != candidate_cell.get(key)
    ]


def _append_reason(result: dict[str, Any], reason: str) -> None:
    reasons = result.setdefault("not_run_reasons", [])
    if reason not in reasons:
        reasons.append(reason)


def _judge_rubric_ids(
    config: dict[str, Any], rubrics: dict[str, dict[str, Any]]
) -> list[str]:
    has_single = "rubric_id" in config
    has_many = "rubric_ids" in config
    if has_single and has_many:
        raise ValueError("judge config cannot declare both rubric_id and rubric_ids")
    raw = config.get("rubric_ids") if has_many else [config.get("rubric_id") or "agency-and-fun"]
    if not isinstance(raw, list) or not raw or any(
        not isinstance(value, str) or not value for value in raw
    ):
        raise ValueError("judge rubric_ids must be a non-empty string list")
    if len(set(raw)) != len(raw):
        raise ValueError("judge rubric_ids must be unique")
    missing = [value for value in raw if value not in rubrics]
    if missing:
        raise ValueError(f"unknown judge rubric_ids: {missing}")
    return list(raw)


def _judge_artifact_name(kind: str, rubric_id: str, count: int) -> str:
    return f"judge-{kind}.json" if count == 1 else f"judge-{kind}.{rubric_id}.json"


def _judge_gate(
    rubric: dict[str, Any],
    result: dict[str, Any],
    mapping: dict[str, str],
) -> dict[str, Any]:
    candidate_side = next(
        (side for side, identity in mapping.items() if identity == "candidate"), None
    )
    baseline_side = next(
        (side for side, identity in mapping.items() if identity == "baseline"), None
    )
    if candidate_side not in {"A", "B"} or baseline_side not in {"A", "B"}:
        raise ValueError("judge label mapping is malformed")
    rubric_id = str(rubric["rubric_id"])
    hard_codes = set(rubric.get("hard_finding_codes") or [])
    candidate_hard_findings = sorted(
        {
            str(finding.get("label"))
            for finding in (result.get("findings") or [])
            if isinstance(finding, dict)
            and finding.get("side") == candidate_side
            and finding.get("label") in hard_codes
        }
    )
    hard_findings = [
        f"semantic_hard_finding:{rubric_id}:{code}"
        for code in candidate_hard_findings
    ]
    winner = result.get("winner")
    if hard_findings:
        status = "FAIL"
        reason = "candidate_hard_finding"
    elif winner == baseline_side:
        status = "FAIL"
        reason = "baseline_preferred"
        hard_findings = [f"semantic_regression:{rubric_id}"]
    elif winner == "uncertain":
        status = "NOT_RUN"
        reason = "judge_uncertain"
    else:
        status = "PASS"
        reason = "candidate_not_worse"
    return {
        "rubric_id": rubric_id,
        "status": status,
        "reason": reason,
        "winner": winner,
        "candidate_side": candidate_side,
        "baseline_side": baseline_side,
        "hard_findings": hard_findings,
    }


def _validated_run_manifest(
    cell_dir: Path,
    cell_id: str,
    *,
    expected_identity: dict[str, Any] | None = None,
    require_clean: bool = False,
) -> dict[str, Any]:
    path = cell_dir / "run-manifest.json"
    if path.is_symlink() or not path.is_file():
        raise ValueError("run manifest missing or unsafe")
    payload = _read_json(path)
    if (
        not isinstance(payload, dict)
        or payload.get("schema_version") != 1
        or payload.get("eval_spec") != EVAL_SPEC
        or payload.get("cell_id") != cell_id
        or payload.get("status") not in {"PASS", "FAIL", "NOT_RUN", "INELIGIBLE"}
    ):
        raise ValueError("run manifest contract mismatch")
    for field in ("hard_findings", "evidence_findings"):
        values = payload[field] if field in payload else []
        if not isinstance(values, list) or not all(
            isinstance(value, str) and value for value in values
        ):
            raise ValueError(f"run manifest {field} malformed")
        payload[field] = list(values)
    if expected_identity is not None and any(
        key not in payload or payload.get(key) != expected_identity.get(key)
        for key in _run_manifest_identity_keys(expected_identity)
    ):
        raise ValueError("run manifest identity mismatch")
    if require_clean and (payload["hard_findings"] or payload["evidence_findings"]):
        raise ValueError("run manifest contains hard or evidence findings")
    return payload


def execute_matrix_plan(
    plan: dict[str, Any],
    *,
    root: Path | str,
    output: Path | str,
    baseline_dir: Path | str | None = None,
    judge_base_url: str = judge.DEFAULT_BASE_URL,
    judge_api_key: str | None = None,
    judge_timeout_s: float = 120.0,
    runner_timeout_s: float = 120.0,
    max_workers: int = 1,
) -> dict[str, Any]:
    """Execute READY cells only; write plan/results/evidence atomically."""
    judge_timeout_s = _positive_timeout(
        judge_timeout_s, label="judge_timeout_s"
    )
    runner_timeout_s = _positive_timeout(
        runner_timeout_s, label="runner_timeout_s"
    )
    if isinstance(max_workers, bool) or not isinstance(max_workers, int) or not 1 <= max_workers <= 8:
        raise ValueError("max_workers must be an integer in 1..8")
    plan = _validate_matrix_plan(plan)
    root_path = Path(root).resolve()
    out, baseline_path = _validated_matrix_paths(output, baseline_dir)
    _preflight_baseline_cell_paths(baseline_path)
    personas_payload = semantic.load_personas(root_path)
    personas = {item["persona_id"]: item for item in personas_payload["personas"]}
    rubrics = semantic.load_rubrics(root_path)
    baseline_root, baseline_by_id, baseline_plan_mismatches = _baseline_cells(
        baseline_path,
        plan,
    )
    baseline_results_by_id, baseline_result_mismatches = _baseline_result_cells(
        baseline_root, plan, baseline_by_id
    )
    out.mkdir(parents=True, exist_ok=True)

    plan_path = out / "matrix-plan.json"
    _write_json_atomic(plan_path, plan)

    cell_results: list[dict[str, Any]] = []

    def record_cell(
        cell: dict[str, Any],
        cell_dir: Path,
        result: dict[str, Any],
        *,
        checkpoint: bool = True,
    ) -> None:
        if checkpoint:
            _write_cell_checkpoint(cell_dir, cell, result)
        cell_results.append(result)
        _write_json_atomic(out / "matrix-progress.json", {
            "schema_version": 1,
            "eval_spec": EVAL_SPEC,
            "suite": plan.get("suite"),
            "updated_at": _utc_now(),
            "completed_cell_count": len(cell_results),
            "total_cell_count": len(plan.get("cells") or []),
            "completed_cell_ids": [row.get("cell_id") for row in cell_results],
            "status_counts": {
                status: sum(1 for row in cell_results if row.get("status") == status)
                for status in (
                    "PASS", "FAIL", "NOT_RUN", "INELIGIBLE", "NON_COMPARABLE"
                )
            },
        })

    reusable_by_id: dict[str, dict[str, Any]] = {}
    prepared_by_id: dict[str, dict[str, Any]] = {}
    runner_results_by_id: dict[str, dict[str, Any]] = {}
    cell_by_id: dict[str, dict[str, Any]] = {}
    for cell in plan.get("cells") or []:
        if not isinstance(cell, dict):
            raise ValueError("plan cell must be an object")
        cell_id = _safe_identifier(cell.get("cell_id"), label="cell_id")
        cell_by_id[cell_id] = cell
        _safe_identifier(cell.get("persona_id"), label="persona_id")
        _safe_identifier(cell.get("case_id"), label="case_id")
        cell_dir = _contained_cell_dir(out, cell_id)
        cell_dir.mkdir(parents=True, exist_ok=True)
        reusable = _load_reusable_cell_checkpoint(cell_dir, cell)
        if reusable is not None:
            reusable_by_id[cell_id] = reusable
            continue
        if cell.get("status") != "READY":
            continue
        persona = personas[str(cell["persona_id"])]
        scenario_path = _resolve_path(root_path, cell.get("scenario_fixture"))
        state_path = _resolve_path(root_path, cell.get("initial_state_fixture"))
        runner_path = _resolve_path(root_path, cell.get("runner_path"))
        assert scenario_path is not None and state_path is not None and runner_path is not None
        scenario = _load_scenario_fixture(root_path, scenario_path)
        initial_state = _load_initial_state_fixture(root_path, state_path)
        if not isinstance(scenario, dict) or not isinstance(initial_state, dict):
            raise ValueError(f"cell fixtures must be objects: {cell_id}")
        player_request = build_player_request_payload(
            initial_state=initial_state,
            scenario=scenario,
            persona=persona,
            seed=int(cell["seed"]),
        )
        kp_request = build_kp_request_payload(
            initial_state=initial_state,
            scenario=scenario,
            seed=int(cell["seed"]),
        )
        cell_input = {
            "cell_id": cell_id,
            "persona_id": cell.get("persona_id"),
            "seed": cell.get("seed"),
            "case_id": cell.get("case_id"),
            "runner": cell.get("runner"),
            "player_model": cell.get("player_model"),
            "kp_model": cell.get("kp_model"),
            "judge_model": cell.get("judge_model"),
            "max_turns": cell.get("max_turns", 3),
            "scenario": scenario,
            "initial_state": initial_state,
            "player_request": player_request,
            "kp_request": kp_request,
            "prompt_hashes": cell.get("prompt_hashes"),
            "prompt_sources": cell.get("prompt_sources"),
            "persona_profile_sha256": cell.get("persona_profile_sha256"),
            "runner_hashes": cell.get("runner_hashes"),
            "scenario_sha256": cell.get("scenario_sha256"),
            "initial_state_sha256": cell.get("initial_state_sha256"),
            "evaluation_profile_sha256": cell.get("evaluation_profile_sha256"),
            "evaluation_contract": cell.get("evaluation_contract"),
        }
        input_path = cell_dir / "cell-input.json"
        _write_json_atomic(input_path, cell_input)
        prepared_by_id[cell_id] = {
            "cell_dir": cell_dir,
            "runner_path": runner_path,
            "input_path": input_path,
            "player_request": player_request,
            "kp_request": kp_request,
        }
        runner_checkpoint = _load_reusable_runner_checkpoint(cell_dir, cell)
        if runner_checkpoint is not None:
            runner_results_by_id[cell_id] = runner_checkpoint

    runner_jobs = {
        cell_id: prepared
        for cell_id, prepared in prepared_by_id.items()
        if cell_id not in runner_results_by_id
    }
    if runner_jobs and max_workers == 1:
        for completed_id, prepared in runner_jobs.items():
            completed = _invoke_fake_or_script_runner(
                runner_path=prepared["runner_path"],
                cell_input=prepared["input_path"],
                cell_dir=prepared["cell_dir"],
                timeout_s=runner_timeout_s,
            )
            runner_results_by_id[completed_id] = completed
            _write_runner_checkpoint(
                prepared["cell_dir"], cell_by_id[completed_id], completed
            )
    elif runner_jobs:
        executor = ThreadPoolExecutor(
            max_workers=min(max_workers, len(runner_jobs)),
            thread_name_prefix="coc-matrix-runner",
        )
        futures = {
            executor.submit(
                _invoke_fake_or_script_runner,
                runner_path=prepared["runner_path"],
                cell_input=prepared["input_path"],
                cell_dir=prepared["cell_dir"],
                timeout_s=runner_timeout_s,
            ): cell_id
            for cell_id, prepared in runner_jobs.items()
        }
        try:
            for future in as_completed(futures):
                completed_id = futures[future]
                completed = future.result()
                runner_results_by_id[completed_id] = completed
                _write_runner_checkpoint(
                    prepared_by_id[completed_id]["cell_dir"],
                    cell_by_id[completed_id],
                    completed,
                )
        except BaseException:
            _terminate_active_matrix_runners()
            for future in futures:
                future.cancel()
            executor.shutdown(wait=True, cancel_futures=True)
            raise
        else:
            executor.shutdown(wait=True)

    for cell in plan.get("cells") or []:
        if not isinstance(cell, dict):
            raise ValueError("plan cell must be an object")
        cell_id = _safe_identifier(cell.get("cell_id"), label="cell_id")
        _safe_identifier(cell.get("persona_id"), label="persona_id")
        _safe_identifier(cell.get("case_id"), label="case_id")
        cell_dir = _contained_cell_dir(out, cell_id)
        cell_dir.mkdir(parents=True, exist_ok=True)
        reusable = reusable_by_id.get(cell_id)
        if reusable is not None:
            record_cell(cell, cell_dir, reusable, checkpoint=False)
            continue
        result = {
            **_run_manifest_identity_payload(cell),
            "status": cell.get("status"),
            "not_run_reasons": list(cell.get("not_run_reasons") or []),
            "artifact_hashes": {},
        }
        if cell.get("status") != "READY":
            manifest_path = cell_dir / "run-manifest.json"
            _write_json_atomic(
                manifest_path,
                {
                    **_run_manifest_identity_payload(cell),
                    "schema_version": 1,
                    "eval_spec": EVAL_SPEC,
                    "status": "NOT_RUN",
                    "evidence_eligible": False,
                    "not_run_reasons": result["not_run_reasons"],
                },
            )
            result["artifact_hashes"]["run-manifest.json"] = _sha256_file(manifest_path)
            record_cell(cell, cell_dir, result)
            continue

        prepared = prepared_by_id[cell_id]
        player_request = prepared["player_request"]
        kp_request = prepared["kp_request"]
        runner_result = runner_results_by_id[cell_id]
        # Ensure view-separation evidence exists even if the adapter forgot to echo.
        player_request_path = cell_dir / "player-request.json"
        kp_request_path = cell_dir / "kp-request.json"
        if not player_request_path.is_file():
            _write_json_atomic(player_request_path, player_request)
        if not kp_request_path.is_file():
            _write_json_atomic(kp_request_path, kp_request)

        if runner_result.get("timed_out") is True:
            timeout_reasons = [
                reason
                for reason in runner_result.get("not_run_reasons") or []
                if isinstance(reason, str) and reason
            ]
            if not timeout_reasons:
                timeout_reasons = ["execution_timeout"]
            timeout_streams, timeout_stream_hashes = _persist_timeout_streams(
                cell_dir, runner_result
            )
            result.update(
                {
                    "status": "NOT_RUN",
                    "not_run_reasons": timeout_reasons,
                    "runner_result": {
                        "status": "NOT_RUN",
                        "returncode": runner_result.get("returncode"),
                        "timed_out": True,
                        "not_run_reasons": timeout_reasons,
                        **timeout_streams,
                        "artifact_hashes": dict(timeout_stream_hashes),
                    },
                    "timeout_phase": "matrix_runner",
                    "timeout_seconds": runner_timeout_s,
                }
            )
            manifest_path = cell_dir / "run-manifest.json"
            _write_json_atomic(
                manifest_path,
                {
                    **_run_manifest_identity_payload(cell),
                    "schema_version": 1,
                    "eval_spec": EVAL_SPEC,
                    "status": "NOT_RUN",
                    "evidence_eligible": False,
                    "not_run_reasons": timeout_reasons,
                    "timeout_phase": "matrix_runner",
                    "timeout_seconds": runner_timeout_s,
                    "timeout_streams": timeout_streams,
                    "artifact_hashes": timeout_stream_hashes,
                },
            )
            result["artifact_hashes"].update(
                {
                    **timeout_stream_hashes,
                    "run-manifest.json": _sha256_file(manifest_path),
                    "player-request.json": _sha256_file(player_request_path),
                    "kp-request.json": _sha256_file(kp_request_path),
                }
            )
            record_cell(cell, cell_dir, result)
            continue

        if str(runner_result.get("status") or "FAIL") == "NOT_RUN":
            runner_reasons = [
                reason
                for reason in runner_result.get("not_run_reasons") or []
                if isinstance(reason, str) and reason
            ]
            if not runner_reasons:
                runner_reasons = ["runner_not_run"]
            result.update(
                {
                    "status": "NOT_RUN",
                    "not_run_reasons": runner_reasons,
                    "runner_result": {
                        "status": "NOT_RUN",
                        "returncode": runner_result.get("returncode"),
                    },
                }
            )
            manifest_path = cell_dir / "run-manifest.json"
            _write_json_atomic(
                manifest_path,
                {
                    **_run_manifest_identity_payload(cell),
                    "schema_version": 1,
                    "eval_spec": EVAL_SPEC,
                    "status": "NOT_RUN",
                    "evidence_eligible": False,
                    "not_run_reasons": runner_reasons,
                },
            )
            result["artifact_hashes"].update(
                {
                    "run-manifest.json": _sha256_file(manifest_path),
                    "player-request.json": _sha256_file(player_request_path),
                    "kp-request.json": _sha256_file(kp_request_path),
                }
            )
            record_cell(cell, cell_dir, result)
            continue

        status = str(runner_result.get("status") or "FAIL")
        if status not in {"PASS", "FAIL", "NOT_RUN", "INELIGIBLE"}:
            status = "FAIL"
        result["status"] = status
        result["runner_result"] = {
            "status": status,
            "returncode": runner_result.get("returncode"),
        }
        judge_cfg = cell.get("judge") or {}
        judge_enabled = isinstance(judge_cfg, dict) and bool(judge_cfg.get("enabled"))
        deterministic_findings = [
            value
            for value in runner_result.get("hard_findings") or []
            if isinstance(value, str) and value
        ]
        evidence_findings = [
            value
            for value in runner_result.get("evidence_findings") or []
            if isinstance(value, str) and value
        ]
        if judge_enabled:
            try:
                manifest = _validated_run_manifest(
                    cell_dir,
                    cell_id,
                    expected_identity=cell,
                )
            except (OSError, UnicodeError, ValueError):
                evidence_findings.append("invalid_run_manifest")
            else:
                deterministic_findings.extend(manifest.get("hard_findings") or [])
                evidence_findings.extend(manifest.get("evidence_findings") or [])
                if manifest.get("evidence_eligible") is not True:
                    evidence_findings.append("evidence_ineligible")
                manifest_status = str(manifest["status"])
                if manifest_status == "FAIL" and not deterministic_findings:
                    deterministic_findings.append("runner_status:fail")
                elif manifest_status in {"NOT_RUN", "INELIGIBLE"}:
                    evidence_findings.append(
                        f"runner_status:{manifest_status.lower()}"
                    )

        if status == "FAIL" and not deterministic_findings:
            deterministic_findings.append("runner_status:fail")
        elif status in {"NOT_RUN", "INELIGIBLE"}:
            evidence_findings.append(f"runner_status:{status.lower()}")

        combined_findings = sorted(set(deterministic_findings + evidence_findings))
        if combined_findings:
            result["hard_findings"] = combined_findings
        if deterministic_findings:
            result["status"] = "FAIL"
        elif evidence_findings:
            result["status"] = "INELIGIBLE"

        if (
            judge_enabled
            and result["status"] == "PASS"
        ):
            rubric_ids = _judge_rubric_ids(judge_cfg, rubrics)
            declared_judge = cell.get("judge_model")
            if declared_judge and declared_judge != judge.SOL_EVALUATOR:
                result["status"] = "NOT_RUN"
                _append_reason(result, "unsupported_judge_identity")
            elif baseline_root is None:
                result["status"] = "NOT_RUN"
                _append_reason(result, "missing_baseline_evidence")
            elif baseline_plan_mismatches or baseline_result_mismatches:
                result["status"] = "NON_COMPARABLE"
                result["identity_mismatches"] = [
                    f"baseline_plan:{key}" for key in baseline_plan_mismatches
                ] + [
                    f"baseline_results:{key}" for key in baseline_result_mismatches
                ]
            else:
                baseline_cell = baseline_by_id.get(cell_id)
                baseline_result_cell = baseline_results_by_id.get(cell_id)
                baseline_cell_dir = _baseline_cell_dir(baseline_root, cell_id)
                if (
                    baseline_cell is None
                    or baseline_result_cell is None
                    or baseline_cell_dir is None
                ):
                    result["status"] = "NOT_RUN"
                    _append_reason(result, "missing_baseline_evidence")
                else:
                    mismatches = _judge_identity_mismatches(baseline_cell, cell)
                    if mismatches:
                        result["status"] = "NON_COMPARABLE"
                        result["identity_mismatches"] = mismatches
                    else:
                        try:
                            baseline_turns = _attested_public_cell_turns(
                                baseline_cell_dir,
                                expected_cell_id=cell_id,
                                expected_identity=baseline_cell,
                                result_cell=baseline_result_cell,
                            )
                            candidate_turns = _attested_public_cell_turns(
                                cell_dir,
                                expected_cell_id=cell_id,
                                expected_identity=cell,
                            )
                        except (OSError, UnicodeError, ValueError):
                            baseline_turns = []
                            candidate_turns = []
                        if not baseline_turns:
                            result["status"] = "NOT_RUN"
                            _append_reason(result, "missing_baseline_evidence")
                        elif not candidate_turns:
                            result["status"] = "NOT_RUN"
                            _append_reason(result, "missing_candidate_public_evidence")
                        else:
                            turn_ids = list(
                                dict.fromkeys(
                                    str(turn["turn_id"])
                                    for turn in (*baseline_turns, *candidate_turns)
                                )
                            )
                            judge_results: dict[str, dict[str, Any]] = {}
                            judge_gates: list[dict[str, Any]] = []
                            judge_failures: dict[str, dict[str, Any]] = {}
                            for rubric_id in rubric_ids:
                                rubric = rubrics[rubric_id]
                                request, mapping = semantic.build_blind_pair_request(
                                    pair_id=f"judge:{cell_id}:{rubric_id}",
                                    rubric_id=rubric["rubric_id"],
                                    rubric_version=rubric["rubric_version"],
                                    public_context={
                                        "case_id": cell.get("case_id"),
                                        "persona_id": cell.get("persona_id"),
                                        "seed": cell.get("seed"),
                                    },
                                    turn_ids=turn_ids,
                                    baseline_turns=baseline_turns,
                                    candidate_turns=candidate_turns,
                                    seed=secrets.randbits(256),
                                )
                                request_name = _judge_artifact_name(
                                    "request", rubric_id, len(rubric_ids)
                                )
                                mapping_name = _judge_artifact_name(
                                    "label-mapping", rubric_id, len(rubric_ids)
                                )
                                request_path = cell_dir / request_name
                                mapping_path = cell_dir / mapping_name
                                _write_json_atomic(request_path, request)
                                # Operator-only mapping; never included in the request.
                                _write_json_atomic(mapping_path, mapping)
                                result["artifact_hashes"][request_name] = _sha256_file(
                                    request_path
                                )
                                result["artifact_hashes"][mapping_name] = _sha256_file(
                                    mapping_path
                                )
                                try:
                                    judge_result = judge.invoke_sol_judge(
                                        request,
                                        rubric,
                                        base_url=judge_base_url,
                                        api_key=(
                                            judge_api_key
                                            if judge_api_key is not None
                                            else judge.resolve_api_key()
                                        ),
                                        timeout_s=judge_timeout_s,
                                    )
                                    semantic.validate_judge_result(
                                        request, judge_result, rubric=rubric
                                    )
                                except (RuntimeError, ValueError) as exc:
                                    failure = _safe_failure(
                                        exc,
                                        default_code="judge_unavailable_or_invalid",
                                    )
                                    judge_failures[rubric_id] = failure
                                    if _is_timeout_exception(exc):
                                        _append_reason(result, "execution_timeout")
                                        result["timeout_phase"] = "semantic_judge"
                                        result["timeout_seconds"] = judge_timeout_s
                                    else:
                                        _append_reason(
                                            result, "judge_unavailable_or_invalid"
                                        )
                                    break
                                result_name = _judge_artifact_name(
                                    "result", rubric_id, len(rubric_ids)
                                )
                                judge_result_path = cell_dir / result_name
                                _write_json_atomic(judge_result_path, judge_result)
                                result["artifact_hashes"][result_name] = _sha256_file(
                                    judge_result_path
                                )
                                judge_results[rubric_id] = judge_result
                                judge_gates.append(
                                    _judge_gate(rubric, judge_result, mapping)
                                )

                            if judge_results:
                                result["judge_results"] = judge_results
                                result["judge_gates"] = judge_gates
                                if len(rubric_ids) == 1:
                                    result["judge_result"] = judge_results[
                                        rubric_ids[0]
                                    ]
                            if judge_failures:
                                result["judge_failures"] = judge_failures
                                if len(rubric_ids) == 1:
                                    result["judge_failure"] = judge_failures[
                                        rubric_ids[0]
                                    ]
                            gate_hard_findings = sorted(
                                {
                                    finding
                                    for gate in judge_gates
                                    for finding in gate.get("hard_findings") or []
                                }
                            )
                            if gate_hard_findings:
                                existing = result.get("hard_findings") or []
                                result["hard_findings"] = sorted(
                                    set(existing + gate_hard_findings)
                                )
                                result["status"] = "FAIL"
                            elif judge_failures:
                                result["status"] = "NOT_RUN"
                            elif any(
                                gate.get("status") == "NOT_RUN"
                                for gate in judge_gates
                            ):
                                result["status"] = "NOT_RUN"
                                for gate in judge_gates:
                                    if gate.get("status") == "NOT_RUN":
                                        _append_reason(
                                            result,
                                            f"judge_uncertain:{gate['rubric_id']}",
                                        )

        manifest_path = cell_dir / "run-manifest.json"
        if not manifest_path.is_file():
            _write_json_atomic(
                manifest_path,
                {
                    **_run_manifest_identity_payload(cell),
                    "schema_version": 1,
                    "eval_spec": EVAL_SPEC,
                    "status": result["status"],
                    "evidence_eligible": False,
                },
            )
        result["artifact_hashes"]["run-manifest.json"] = _sha256_file(manifest_path)
        result["artifact_hashes"]["player-request.json"] = _sha256_file(
            player_request_path
        )
        result["artifact_hashes"]["kp-request.json"] = _sha256_file(kp_request_path)
        record_cell(cell, cell_dir, result)

    hard_findings = [
        reason
        for cell in cell_results
        for reason in cell.get("hard_findings") or []
    ]
    aggregate = {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "suite": plan.get("suite"),
        "cell_count": len(cell_results),
        "status_counts": {
            status: sum(1 for cell in cell_results if cell.get("status") == status)
            for status in (
                "PASS",
                "FAIL",
                "NOT_RUN",
                "INELIGIBLE",
                "NON_COMPARABLE",
            )
        },
        "hard_findings": sorted(set(hard_findings)),
        "hard_findings_override_judge": bool(hard_findings),
    }
    results = {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "suite": plan.get("suite"),
        "completed_at": _utc_now(),
        "cells": cell_results,
        "aggregate": aggregate,
        "artifact_hashes": {},
        "execution_policy": {
            "runner_timeout_seconds": runner_timeout_s,
            "judge_timeout_seconds": judge_timeout_s,
            "max_workers": max_workers,
            "checkpointing": "runner_and_cell",
        },
    }
    results_path = out / "matrix-results.json"
    aggregate_path = out / "aggregate-summary.json"
    _write_json_atomic(aggregate_path, aggregate)
    results["artifact_hashes"] = {
        "matrix-plan.json": _sha256_file(plan_path),
        "aggregate-summary.json": _sha256_file(aggregate_path),
    }
    _write_json_atomic(results_path, results)
    return results


def run_matrix_cli(
    *,
    root: Path | str,
    suite: str,
    output: Path | str | None,
    plan_only: bool,
    configuration: Path | str | None = None,
    baseline: Path | str | None = None,
    runner_timeout_s: float | None = None,
    judge_timeout_s: float | None = None,
    max_workers: int | None = None,
) -> dict[str, Any]:
    root_path = Path(root).resolve()
    out = Path(output).resolve() if output else (
        root_path / ".coc" / "evaluations" / f"matrix-{suite}-{os.getpid()}"
    )
    configuration_payload = None
    configuration_path = Path(configuration).resolve() if configuration else None
    if configuration_path is not None:
        if configuration_path.is_symlink() or not configuration_path.is_file():
            raise ValueError("matrix configuration must be a real JSON file")
        configuration_payload = _read_json(configuration_path)
    plan = build_matrix_plan(
        root=root_path, suite=suite, configuration=configuration_payload
    )
    diagnostic = (
        {
            "custom_configuration": str(configuration_path),
            "custom_configuration_sha256": _sha256_file(configuration_path),
            "official_suite_claim": False,
        }
        if configuration_path is not None else None
    )
    if plan_only:
        out.mkdir(parents=True, exist_ok=True)
        plan_path = out / "matrix-plan.json"
        _write_json_atomic(plan_path, plan)
        payload = dict(plan)
        payload["output"] = str(out)
        payload["artifact_hashes"] = {"matrix-plan.json": _sha256_file(plan_path)}
        if diagnostic is not None:
            payload["diagnostic"] = diagnostic
        # Plan-only is an evidence artifact write, not a suite PASS claim.
        if payload.get("ready_count", 0) == 0 and payload.get("not_run_count", 0) > 0:
            payload["status"] = "NOT_RUN"
        elif payload.get("ready_count", 0) > 0:
            payload["status"] = "PASS"
        else:
            payload["status"] = "NOT_RUN"
        return payload
    policy = load_matrix_execution_policy(
        root_path, suite, configuration=configuration_payload
    )
    result = execute_matrix_plan(
        plan,
        root=root_path,
        output=out,
        baseline_dir=baseline,
        runner_timeout_s=(
            runner_timeout_s if runner_timeout_s is not None
            else policy["runner_timeout_seconds"]
        ),
        judge_timeout_s=(
            judge_timeout_s if judge_timeout_s is not None
            else policy["judge_timeout_seconds"]
        ),
        max_workers=(max_workers if max_workers is not None else policy["max_workers"]),
    )
    counts = (result.get("aggregate") or {}).get("status_counts") or {}
    result["status"] = next(
        (
            status
            for status in ("FAIL", "INELIGIBLE", "NON_COMPARABLE", "NOT_RUN", "PASS")
            if int(counts.get(status, 0) or 0) > 0
        ),
        "NOT_RUN",
    )
    if diagnostic is not None:
        result["diagnostic"] = diagnostic
    return result
