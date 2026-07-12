#!/usr/bin/env python3
"""Canonical host-neutral entry point for COC Keeper evaluation."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_eval_cases as cases
import coc_eval_compare as compare
import coc_eval_contract as contract
import coc_eval_matrix as matrix


EXIT_BY_STATUS = {
    "PASS": 0,
    "FAIL": 1,
    "INELIGIBLE": 2,
    "NOT_RUN": 2,
    "NON_COMPARABLE": 2,
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _json_print(payload: Any, *, stream=None) -> None:
    target = stream or sys.stdout
    target.write(json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _git_head(root: Path) -> str | None:
    try:
        proc = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    value = (proc.stdout or "").strip()
    return value if proc.returncode == 0 and value else None


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def _default_output(root: Path, suite: str) -> Path:
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    return root / ".coc" / "evaluations" / f"{suite}-{stamp}-{os.getpid()}"


def _missing_capabilities(
    manifest: dict[str, Any], suite_definition: dict[str, Any]
) -> list[str]:
    implemented = {
        str(item) for item in manifest.get("implemented_capabilities", [])
    }
    required = {
        str(item) for item in suite_definition.get("required_capabilities", [])
    }
    return sorted(required - implemented)


def _base_run_manifest(
    *,
    manifest: dict[str, Any],
    suite: str,
    host_id: str,
    run_id: str,
    root: Path,
    started_at: str,
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "eval_spec": manifest["eval_spec"],
        "benchmark_version": manifest["benchmark_version"],
        "report_schema_version": manifest["report_schema_version"],
        "run_id": run_id,
        "suite": suite,
        "case_id": f"suite:{suite}",
        "host_id": host_id,
        "seed": None,
        "initial_state_sha256": None,
        "candidate_commit": _git_head(root),
        "started_at": started_at,
        "completed_at": None,
        "status": "NOT_RUN",
        "case_ids": [],
        "case_results_path": None,
        "commands": [],
        "artifact_hashes": {},
    }


def _run_registered_cases(
    *,
    root: Path,
    out: Path,
    manifest: dict[str, Any],
    suite: str,
) -> tuple[str, list[dict[str, Any]], Path]:
    registry = cases.load_case_registry(root)
    selected = cases.resolve_suite_cases(manifest, registry, suite)
    if not selected:
        raise ValueError(f"suite has no registered cases: {suite}")
    implemented = {
        str(value) for value in manifest.get("implemented_capabilities", [])
    }
    env = {"PYTHONDONTWRITEBYTECODE": "1"}
    results = [
        cases.run_case(
            case,
            root=root,
            output=out,
            implemented_capabilities=implemented,
            env=env,
        )
        for case in selected
    ]
    status = cases.aggregate_suite_status(results)
    payload = {
        "schema_version": 1,
        "eval_spec": manifest["eval_spec"],
        "benchmark_version": manifest["benchmark_version"],
        "registry_version": registry["registry_version"],
        "suite": suite,
        "status": status,
        "cases": results,
    }
    path = out / "case-results.json"
    _write_json(path, payload)
    return status, results, path


def _run_legacy_commands(
    *,
    root: Path,
    out: Path,
    commands: list[list[str]],
) -> tuple[str, list[dict[str, Any]]]:
    command_results: list[dict[str, Any]] = []
    all_passed = True
    env = dict(os.environ)
    env.setdefault("PYTHONDONTWRITEBYTECODE", "1")
    for index, command in enumerate(commands, start=1):
        started = time.monotonic()
        try:
            proc = subprocess.run(
                command,
                cwd=root,
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            returncode = int(proc.returncode)
            stdout = proc.stdout or ""
            stderr = proc.stderr or ""
        except OSError as exc:
            returncode = 127
            stdout = ""
            stderr = f"{type(exc).__name__}: {exc}"
        duration = time.monotonic() - started
        stdout_path = out / f"command-{index:02d}.stdout.log"
        stderr_path = out / f"command-{index:02d}.stderr.log"
        stdout_path.write_text(stdout, encoding="utf-8")
        stderr_path.write_text(stderr, encoding="utf-8")
        command_result = {
            "index": index,
            "argv": list(command),
            "returncode": returncode,
            "duration_seconds": round(duration, 6),
            "stdout_path": stdout_path.name,
            "stderr_path": stderr_path.name,
            "stdout_sha256": _sha256(stdout_path),
            "stderr_sha256": _sha256(stderr_path),
        }
        command_results.append(command_result)
        if returncode != 0:
            all_passed = False
            break
    status = "PASS" if all_passed and len(command_results) == len(commands) else "FAIL"
    return status, command_results


def run_suite(
    *,
    root: Path,
    suite: str,
    output: Path | None,
    host_id: str,
) -> dict[str, Any]:
    root = root.resolve()
    manifest = contract.load_benchmark_manifest(root)
    suite_definition = contract.resolve_suite(manifest, suite)
    out = (output or _default_output(root, suite)).resolve()
    out.mkdir(parents=True, exist_ok=True)
    started_at = _utc_now()
    run_id = out.name
    run_manifest = _base_run_manifest(
        manifest=manifest,
        suite=suite,
        host_id=host_id,
        run_id=run_id,
        root=root,
        started_at=started_at,
    )
    manifest_path = out / "run-manifest.json"
    _write_json(manifest_path, run_manifest)

    missing = _missing_capabilities(manifest, suite_definition)
    if missing:
        run_manifest.update(
            {
                "completed_at": _utc_now(),
                "status": "NOT_RUN",
                "missing_capabilities": missing,
                "reason": "suite requires capabilities not implemented by this benchmark version",
            }
        )
        _write_json(manifest_path, run_manifest)
        return run_manifest

    registry_path = root / cases.CASE_REGISTRY_PATH
    if registry_path.is_file():
        status, case_results, case_results_path = _run_registered_cases(
            root=root,
            out=out,
            manifest=manifest,
            suite=suite,
        )
        artifact_hashes: dict[str, str] = {
            case_results_path.name: _sha256(case_results_path)
        }
        for result in case_results:
            artifact_hashes.update(
                {
                    str(path): str(digest)
                    for path, digest in (result.get("artifact_hashes") or {}).items()
                }
            )
        run_manifest.update(
            {
                "completed_at": _utc_now(),
                "status": status,
                "missing_capabilities": [],
                "case_ids": [str(result["case_id"]) for result in case_results],
                "case_results_path": case_results_path.name,
                "case_results": case_results,
                "commands": [],
                "artifact_hashes": artifact_hashes,
            }
        )
        _write_json(manifest_path, run_manifest)
        return run_manifest

    commands = suite_definition.get("commands") or []
    if not commands:
        run_manifest.update(
            {
                "completed_at": _utc_now(),
                "status": "NOT_RUN",
                "missing_capabilities": [],
                "reason": "suite has no registered or legacy executable cases",
            }
        )
        _write_json(manifest_path, run_manifest)
        return run_manifest

    status, command_results = _run_legacy_commands(
        root=root,
        out=out,
        commands=commands,
    )
    artifact_hashes = {
        result["stdout_path"]: result["stdout_sha256"]
        for result in command_results
    }
    artifact_hashes.update(
        {
            result["stderr_path"]: result["stderr_sha256"]
            for result in command_results
        }
    )
    run_manifest.update(
        {
            "completed_at": _utc_now(),
            "status": status,
            "missing_capabilities": [],
            "commands": command_results,
            "artifact_hashes": artifact_hashes,
        }
    )
    _write_json(manifest_path, run_manifest)
    return run_manifest


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="coc_eval.py",
        description="Run and verify the versioned COC Keeper evaluation contract.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    run = subparsers.add_parser("run", help="run a named canonical evaluation suite")
    run.add_argument("--suite", required=True)
    run.add_argument("--root", type=Path, default=Path.cwd())
    run.add_argument("--output", type=Path)
    run.add_argument(
        "--host-id",
        default=os.environ.get("COC_EVAL_HOST_ID", "local"),
        choices=("codex", "zcode", "cursor", "ci", "local"),
    )

    report = subparsers.add_parser(
        "report", help="generate the base report and apply report schema v2"
    )
    report.add_argument("run_dir", type=Path)

    verify = subparsers.add_parser(
        "verify", help="recompute report completeness from current source evidence"
    )
    verify.add_argument("run_dir", type=Path)

    compare_parser = subparsers.add_parser(
        "compare",
        help="compare baseline and candidate identities, hard gates, and dimensions",
    )
    compare_parser.add_argument("--baseline", type=Path, required=True)
    compare_parser.add_argument("--candidate", type=Path, required=True)
    compare_parser.add_argument(
        "--root",
        type=Path,
        default=Path.cwd(),
        help="repository root used to load evaluation thresholds",
    )

    baseline = subparsers.add_parser(
        "baseline", help="write a normalized baseline manifest from a verified run"
    )
    baseline.add_argument("--from", dest="source", type=Path, required=True)
    baseline.add_argument("--output", type=Path, required=True)

    matrix_parser = subparsers.add_parser(
        "matrix",
        help="plan or execute the AI-player persona matrix for nightly|release",
    )
    matrix_parser.add_argument(
        "--suite",
        required=True,
        choices=("nightly", "release"),
    )
    matrix_parser.add_argument("--root", type=Path, default=Path.cwd())
    matrix_parser.add_argument("--output", type=Path)
    matrix_parser.add_argument(
        "--plan-only",
        action="store_true",
        help="write matrix-plan.json without executing READY cells",
    )
    return parser


def _exit_code(payload: dict[str, Any]) -> int:
    return EXIT_BY_STATUS.get(str(payload.get("status") or "FAIL"), 1)


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "run":
            payload = run_suite(
                root=args.root,
                suite=args.suite,
                output=args.output,
                host_id=args.host_id,
            )
        elif args.command == "report":
            payload = contract.compile_report_contract(
                args.run_dir, generate_base_report=True
            )
        elif args.command == "verify":
            payload = contract.verify_report_contract(args.run_dir)
        elif args.command == "compare":
            payload = compare.compare_cli_runs(
                args.baseline,
                args.candidate,
                root=args.root,
                identity_compare=contract.compare_run_manifests,
            )
        elif args.command == "baseline":
            payload = contract.write_baseline_manifest(
                args.source, args.output
            )
        elif args.command == "matrix":
            payload = matrix.run_matrix_cli(
                root=args.root,
                suite=args.suite,
                output=args.output,
                plan_only=bool(args.plan_only),
            )
        else:
            raise ValueError(f"unsupported command: {args.command}")
    except (ValueError, FileNotFoundError, RuntimeError) as exc:
        sys.stderr.write(f"{exc}\n")
        return 1
    _json_print(payload)
    return _exit_code(payload)


if __name__ == "__main__":
    raise SystemExit(main())
