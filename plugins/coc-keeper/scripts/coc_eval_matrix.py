#!/usr/bin/env python3
"""AI-player persona matrix planner and fail-closed orchestrator."""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from functools import lru_cache
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
)


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


def _safe_identifier(value: Any, *, label: str) -> str:
    if not isinstance(value, str) or not _SAFE_IDENTIFIER.fullmatch(value):
        raise ValueError(f"{label} must be a safe identifier")
    return value


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
    return _sha256_file(path)


def _scenario_sha256(root: Path, case: dict[str, Any]) -> str | None:
    path = _resolve_path(root, case.get("scenario_fixture"))
    if path is None or not path.is_file():
        return None
    return _sha256_file(path)


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
                cell = {
                    "cell_id": _cell_id(str(persona_id), int(seed), str(case_id)),
                    "persona_id": persona_id,
                    "seed": int(seed),
                    "case_id": case_id,
                    "runner": case.get("runner"),
                    "runner_path": case.get("runner_path"),
                    "scenario_fixture": case.get("scenario_fixture"),
                    "initial_state_fixture": case.get("initial_state_fixture"),
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
                    "judge": case.get("judge") if isinstance(case.get("judge"), dict) else {},
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


def _invoke_fake_or_script_runner(
    *,
    runner_path: Path,
    cell_input: Path,
    cell_dir: Path,
) -> dict[str, Any]:
    proc = subprocess.run(
        [sys.executable, str(runner_path), str(cell_input), str(cell_dir)],
        capture_output=True,
        text=True,
        check=False,
    )
    stdout = (proc.stdout or "").strip()
    payload: dict[str, Any]
    if stdout:
        try:
            payload = json.loads(stdout.splitlines()[-1])
        except json.JSONDecodeError:
            payload = {"status": "FAIL", "parse_error": True}
    else:
        payload = {"status": "FAIL", "empty_stdout": True}
    if proc.returncode != 0 and payload.get("status") == "PASS":
        payload["status"] = "FAIL"
    payload["returncode"] = proc.returncode
    payload["stdout"] = proc.stdout or ""
    payload["stderr"] = proc.stderr or ""
    return payload


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


def _validated_matrix_paths(
    output: Path | str, baseline_dir: Path | str | None
) -> tuple[Path, Path | None]:
    raw_output = Path(output).absolute()
    if raw_output.is_symlink():
        raise ValueError("matrix output must not be a symlink")
    resolved_output = raw_output.resolve()
    if baseline_dir is None:
        return resolved_output, None
    raw_baseline = Path(baseline_dir).absolute()
    if raw_baseline.is_symlink():
        raise ValueError("baseline root must not be a symlink")
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
    root: Path | None, candidate_plan: dict[str, Any]
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
    expected_ids = {
        item.get("cell_id")
        for item in candidate_plan.get("cells") or []
        if isinstance(item, dict)
        and isinstance(item.get("cell_id"), str)
        and _SAFE_IDENTIFIER.fullmatch(item["cell_id"])
    }
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
        try:
            manifest = _validated_run_manifest(cell_dir, cell_id)
        except (OSError, UnicodeError, ValueError):
            return {}, ["cell_manifest_binding"]
        if expected_manifest_hash != _sha256_file(manifest_path):
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
    manifest = _validated_run_manifest(cell_dir, expected_cell_id)
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


def _validated_run_manifest(cell_dir: Path, cell_id: str) -> dict[str, Any]:
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
        values = payload.get(field) or []
        if not isinstance(values, list) or not all(
            isinstance(value, str) and value for value in values
        ):
            raise ValueError(f"run manifest {field} malformed")
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
) -> dict[str, Any]:
    """Execute READY cells only; write plan/results/evidence atomically."""
    if not isinstance(plan, dict) or plan.get("schema_version") != 1:
        raise ValueError("invalid matrix plan")
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
        baseline_root, plan
    )
    out.mkdir(parents=True, exist_ok=True)

    plan_path = out / "matrix-plan.json"
    _write_json_atomic(plan_path, plan)

    cell_results: list[dict[str, Any]] = []
    for cell in plan.get("cells") or []:
        if not isinstance(cell, dict):
            raise ValueError("plan cell must be an object")
        cell_id = _safe_identifier(cell.get("cell_id"), label="cell_id")
        _safe_identifier(cell.get("persona_id"), label="persona_id")
        _safe_identifier(cell.get("case_id"), label="case_id")
        cell_dir = _contained_cell_dir(out, cell_id)
        cell_dir.mkdir(parents=True, exist_ok=True)
        result = {
            "cell_id": cell_id,
            "persona_id": cell.get("persona_id"),
            "seed": cell.get("seed"),
            "case_id": cell.get("case_id"),
            "status": cell.get("status"),
            "not_run_reasons": list(cell.get("not_run_reasons") or []),
            "artifact_hashes": {},
        }
        if cell.get("status") != "READY":
            manifest_path = cell_dir / "run-manifest.json"
            _write_json_atomic(
                manifest_path,
                {
                    "schema_version": 1,
                    "eval_spec": EVAL_SPEC,
                    "cell_id": cell_id,
                    "status": "NOT_RUN",
                    "evidence_eligible": False,
                    "not_run_reasons": result["not_run_reasons"],
                },
            )
            result["artifact_hashes"]["run-manifest.json"] = _sha256_file(manifest_path)
            cell_results.append(result)
            continue

        persona = personas[str(cell["persona_id"])]
        scenario_path = _resolve_path(root_path, cell.get("scenario_fixture"))
        state_path = _resolve_path(root_path, cell.get("initial_state_fixture"))
        runner_path = _resolve_path(root_path, cell.get("runner_path"))
        assert scenario_path is not None and state_path is not None and runner_path is not None
        scenario = _read_json(scenario_path)
        initial_state = _read_json(state_path)
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
        }
        input_path = cell_dir / "cell-input.json"
        _write_json_atomic(input_path, cell_input)

        runner_result = _invoke_fake_or_script_runner(
            runner_path=runner_path,
            cell_input=input_path,
            cell_dir=cell_dir,
        )
        # Ensure view-separation evidence exists even if the adapter forgot to echo.
        player_request_path = cell_dir / "player-request.json"
        kp_request_path = cell_dir / "kp-request.json"
        if not player_request_path.is_file():
            _write_json_atomic(player_request_path, player_request)
        if not kp_request_path.is_file():
            _write_json_atomic(kp_request_path, kp_request)

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
                manifest = _validated_run_manifest(cell_dir, cell_id)
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
            rubric_id = str(judge_cfg.get("rubric_id") or "agency-and-fun")
            rubric = rubrics[rubric_id]
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
                                result_cell=baseline_result_cell,
                            )
                            candidate_turns = _attested_public_cell_turns(
                                cell_dir,
                                expected_cell_id=cell_id,
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
                            request, mapping = semantic.build_blind_pair_request(
                                pair_id=f"judge:{cell_id}",
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
                            judge_request_path = cell_dir / "judge-request.json"
                            _write_json_atomic(judge_request_path, request)
                            # Operator-only mapping; never included in the request.
                            mapping_path = cell_dir / "judge-label-mapping.json"
                            _write_json_atomic(mapping_path, mapping)
                            result["artifact_hashes"][
                                "judge-request.json"
                            ] = _sha256_file(judge_request_path)
                            result["artifact_hashes"][
                                "judge-label-mapping.json"
                            ] = _sha256_file(mapping_path)
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
                            except (RuntimeError, ValueError):
                                result["status"] = "NOT_RUN"
                                _append_reason(result, "judge_unavailable_or_invalid")
                            else:
                                judge_result_path = cell_dir / "judge-result.json"
                                _write_json_atomic(judge_result_path, judge_result)
                                result["artifact_hashes"][
                                    "judge-result.json"
                                ] = _sha256_file(judge_result_path)
                                result["judge_result"] = judge_result

        manifest_path = cell_dir / "run-manifest.json"
        if not manifest_path.is_file():
            _write_json_atomic(
                manifest_path,
                {
                    "schema_version": 1,
                    "eval_spec": EVAL_SPEC,
                    "cell_id": cell_id,
                    "status": result["status"],
                    "evidence_eligible": False,
                    "player_model": cell.get("player_model"),
                    "kp_model": cell.get("kp_model"),
                    "persona_profile_sha256": cell.get("persona_profile_sha256"),
                    "prompt_hashes": cell.get("prompt_hashes"),
                    "runner_hashes": cell.get("runner_hashes"),
                    "initial_state_sha256": cell.get("initial_state_sha256"),
                },
            )
        result["artifact_hashes"]["run-manifest.json"] = _sha256_file(manifest_path)
        result["artifact_hashes"]["player-request.json"] = _sha256_file(
            player_request_path
        )
        result["artifact_hashes"]["kp-request.json"] = _sha256_file(kp_request_path)
        cell_results.append(result)

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
    }
    results_path = out / "matrix-results.json"
    aggregate_path = out / "aggregate-summary.json"
    _write_json_atomic(aggregate_path, aggregate)
    results["artifact_hashes"] = {
        "matrix-plan.json": _sha256_file(plan_path),
        "aggregate-summary.json": _sha256_file(aggregate_path),
    }
    _write_json_atomic(results_path, results)
    # Re-hash after writing results so the payload embeds its own sibling hashes.
    results["artifact_hashes"]["matrix-results.json"] = _sha256_file(results_path)
    _write_json_atomic(results_path, results)
    return results


def run_matrix_cli(
    *,
    root: Path | str,
    suite: str,
    output: Path | str | None,
    plan_only: bool,
) -> dict[str, Any]:
    root_path = Path(root).resolve()
    out = Path(output).resolve() if output else (
        root_path / ".coc" / "evaluations" / f"matrix-{suite}-{os.getpid()}"
    )
    plan = build_matrix_plan(root=root_path, suite=suite)
    if plan_only:
        out.mkdir(parents=True, exist_ok=True)
        plan_path = out / "matrix-plan.json"
        _write_json_atomic(plan_path, plan)
        payload = dict(plan)
        payload["output"] = str(out)
        payload["artifact_hashes"] = {"matrix-plan.json": _sha256_file(plan_path)}
        # Plan-only is an evidence artifact write, not a suite PASS claim.
        if payload.get("ready_count", 0) == 0 and payload.get("not_run_count", 0) > 0:
            payload["status"] = "NOT_RUN"
        elif payload.get("ready_count", 0) > 0:
            payload["status"] = "PASS"
        else:
            payload["status"] = "NOT_RUN"
        return payload
    return execute_matrix_plan(plan, root=root_path, output=out)
