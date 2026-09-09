"""Runtime selection and retained differential evidence for the existing RPC corpus."""
from __future__ import annotations

import ast
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
FIXED_CLOCK = "2000-01-02T03:04:05Z"


def python_command() -> list[str]:
    return [sys.executable, str(HERE / "rpc_reference.py")]


def typescript_command() -> list[str]:
    entry = HERE.parents[1] / "build" / "kernel" / "rpc.mjs"
    if not entry.is_file():
        raise RuntimeError("Build the TypeScript kernel with npm run build:runtime before running RPC tests")
    return [os.environ.get("COC_TEST_NODE", "node"), str(entry)]


def read_command(value: str | None) -> list[str] | None:
    if value is None:
        return None
    result = json.loads(value)
    if not isinstance(result, list) or not result or any(not isinstance(p, str) or not p for p in result):
        raise ValueError("Test kernel command must be a non-empty JSON argv array")
    return result


def fixed_environment(env: dict[str, str]) -> dict[str, str]:
    isolated = {key: value for key, value in env.items() if not key.startswith("GIT_")}
    return {**isolated, "COC_TEST_CLOCK": FIXED_CLOCK, "TZ": "UTC",
            "GIT_AUTHOR_DATE": FIXED_CLOCK, "GIT_COMMITTER_DATE": FIXED_CLOCK,
            "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_COUNT": "0",
            "NODE_OPTIONS": (env.get("NODE_OPTIONS", "") + " --require " + json.dumps(str(HERE / "rpc_clock.cjs"))).strip()}


def snapshot(workspace: Path) -> dict[str, Any]:
    """Keep every state value and digest. Compare Git history, not index timestamps."""
    root = workspace / ".coc"
    files: dict[str, Any] = {}
    if not root.exists():
        return {"files": files, "history": {}}
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.relative_to(root).parts[0] == "repos":
            continue
        data = path.read_bytes()
        name = path.relative_to(root).as_posix()
        try:
            if path.suffix == ".json":
                files[name] = json.loads(data)
            elif path.suffix == ".jsonl":
                files[name] = [json.loads(line) for line in data.splitlines() if line.strip()]
            else:
                files[name] = {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
        except (ValueError, UnicodeDecodeError):
            files[name] = {"invalid_json_bytes": data.hex(), "sha256": hashlib.sha256(data).hexdigest()}
    histories = {}
    for repo in sorted((root / "repos").glob("*.git")):
        result = subprocess.run(["git", f"--git-dir={repo}", "log", "--all", "--format=%H %T %P %s"],
                                capture_output=True, text=True, check=True)
        histories[repo.name] = sorted(result.stdout.splitlines())
    return {"files": files, "history": histories}


def differences(expected: Any, actual: Any, path: str = "$", limit: int = 30) -> list[str]:
    """Report structural differences without erasing timestamps, receipts or hashes."""
    if type(expected) is not type(actual):
        return [f"{path}: {type(expected).__name__} != {type(actual).__name__}"]
    if isinstance(expected, dict):
        result = []
        for key in sorted(expected.keys() | actual.keys()):
            if key not in expected or key not in actual:
                result.append(f"{path}.{key}: field missing from {'reference' if key not in expected else 'candidate'}")
            else:
                result.extend(differences(expected[key], actual[key], f"{path}.{key}", limit - len(result)))
            if len(result) >= limit:
                break
        return result
    if isinstance(expected, list):
        if len(expected) != len(actual):
            return [f"{path}: list length {len(expected)} != {len(actual)}"]
        result = []
        for i, (left, right) in enumerate(zip(expected, actual)):
            result.extend(differences(left, right, f"{path}[{i}]", limit - len(result)))
            if len(result) >= limit:
                break
        return result
    return [] if expected == actual else [f"{path}: {expected!r} != {actual!r}"]


def retain_comparison(case: str, reference: dict, candidate: dict, fallback: Path) -> tuple[Path, list[str]]:
    root = Path(os.environ.get("COC_RPC_EVIDENCE_DIR", str(fallback)))
    root.mkdir(parents=True, exist_ok=True)
    target = Path(tempfile.mkdtemp(prefix=case + "-", dir=root))
    findings = differences(reference, candidate)
    equal = not findings and not reference.get("failure") and not candidate.get("failure")
    for name, value in (("reference", reference), ("candidate", candidate), ("comparison", {"equal": bool(equal), "differences": findings})):
        (target / f"{name}.json").write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return target, findings


def python_internal_tests(root: Path) -> list[str]:
    result = []
    for path in sorted(root.rglob("test_*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        if any(isinstance(node, ast.ImportFrom) and (node.module == "coc" or (node.module or "").startswith("coc."))
               or isinstance(node, ast.Import) and any(alias.name == "coc" or alias.name.startswith("coc.") for alias in node.names)
               for node in ast.walk(tree)):
            result.append(str(path.relative_to(root)))
    return result
