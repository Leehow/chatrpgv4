#!/usr/bin/env python3
"""Versioned deterministic case registry for the COC evaluation contract."""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import selectors
import signal
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


EVAL_SPEC = "eval-spec-v1"
CASE_REGISTRY_PATH = Path("evaluation/spec/v1/case-registry.json")
CASE_SCHEMA_VERSION = 1
VALID_KINDS = frozenset({"pytest_node", "python_command", "artifact_verification"})
VALID_GATES = frozenset({"hard", "soft", "diagnostic"})
VALID_SUITES = frozenset({"smoke", "pr", "nightly", "release", "diagnostic"})
CASE_ID_RE = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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


def _inside_root(root: Path, path: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
    except (OSError, ValueError):
        return False
    return True


def _require_string_list(value: Any, *, field: str, nonempty: bool = False) -> list[str]:
    if not isinstance(value, list) or (nonempty and not value):
        raise ValueError(f"invalid {field}")
    if not all(isinstance(item, str) and item.strip() for item in value):
        raise ValueError(f"invalid {field}")
    return [item.strip() for item in value]


def _command_repository_paths(command: list[str]) -> Iterable[str]:
    """Yield repository file operands from the supported command shapes."""
    for token in command:
        if token.startswith("-"):
            continue
        candidate = token.split("::", 1)[0]
        if candidate.startswith(("tests/", "plugins/", "runtime/", "evaluation/")):
            yield candidate
        elif candidate.endswith((".py", ".json", ".jsonl", ".md")) and (
            "/" in candidate or "\\" in candidate
        ):
            yield candidate


def _validate_command(root: Path, case: dict[str, Any]) -> None:
    command = _require_string_list(case.get("command"), field="command", nonempty=True)
    for token in command:
        path_token = token.split("::", 1)[0]
        parsed = Path(path_token)
        if parsed.is_absolute() or ".." in parsed.parts:
            raise ValueError(
                f"case command path outside repository: {case.get('case_id')}"
            )
    for relative in _command_repository_paths(command):
        candidate = root / relative
        if not _inside_root(root, candidate):
            raise ValueError(
                f"case command path outside repository: {case.get('case_id')}"
            )
        if not candidate.is_file():
            raise ValueError(
                f"case command path missing: {case.get('case_id')} -> {relative}"
            )


def validate_case_registry(root: Path | str, payload: Any) -> dict[str, Any]:
    repo = Path(root)
    if not isinstance(payload, dict):
        raise ValueError("case registry must be an object")
    if payload.get("schema_version") != CASE_SCHEMA_VERSION:
        raise ValueError("invalid case registry schema_version")
    if payload.get("eval_spec") != EVAL_SPEC:
        raise ValueError("invalid case registry eval_spec")
    if not isinstance(payload.get("registry_version"), str) or not payload[
        "registry_version"
    ].strip():
        raise ValueError("invalid case registry version")
    raw_cases = payload.get("cases")
    if not isinstance(raw_cases, list) or not raw_cases:
        raise ValueError("case registry has no cases")

    seen: set[str] = set()
    validated: list[dict[str, Any]] = []
    for index, raw_case in enumerate(raw_cases):
        if not isinstance(raw_case, dict):
            raise ValueError(f"case {index} must be an object")
        case = dict(raw_case)
        case_id = case.get("case_id")
        if not isinstance(case_id, str) or CASE_ID_RE.fullmatch(case_id) is None:
            raise ValueError(f"invalid case_id: {case_id!r}")
        if case_id in seen:
            raise ValueError(f"duplicate case_id: {case_id}")
        seen.add(case_id)
        if not isinstance(case.get("description"), str) or not case[
            "description"
        ].strip():
            raise ValueError(f"invalid case description: {case_id}")
        kind = case.get("kind")
        if kind not in VALID_KINDS:
            raise ValueError(f"unsupported case kind: {kind}")
        gate = case.get("gate")
        if gate not in VALID_GATES:
            raise ValueError(f"unsupported case gate: {gate}")
        suites = _require_string_list(
            case.get("suites"), field=f"{case_id}.suites", nonempty=True
        )
        if len(suites) != len(set(suites)) or any(
            suite not in VALID_SUITES for suite in suites
        ):
            raise ValueError(f"invalid case suites: {case_id}")
        required = _require_string_list(
            case.get("required_capabilities"),
            field=f"{case_id}.required_capabilities",
        )
        if len(required) != len(set(required)):
            raise ValueError(f"duplicate required capability: {case_id}")
        evidence = _require_string_list(
            case.get("evidence_requirements"),
            field=f"{case_id}.evidence_requirements",
            nonempty=True,
        )
        if len(evidence) != len(set(evidence)):
            raise ValueError(f"duplicate evidence requirement: {case_id}")
        _validate_command(repo, case)
        case["suites"] = suites
        case["required_capabilities"] = required
        case["evidence_requirements"] = evidence
        case["command"] = [str(value) for value in case["command"]]
        validated.append(case)

    return {
        "schema_version": CASE_SCHEMA_VERSION,
        "eval_spec": EVAL_SPEC,
        "registry_version": payload["registry_version"].strip(),
        "cases": validated,
    }


def load_case_registry(
    root: Path | str,
    *,
    path: Path | str | None = None,
) -> dict[str, Any]:
    repo = Path(root)
    registry_path = Path(path) if path is not None else repo / CASE_REGISTRY_PATH
    try:
        payload = json.loads(registry_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"case registry missing or malformed: {registry_path}") from exc
    return validate_case_registry(repo, payload)


def resolve_suite_cases(
    manifest: dict[str, Any],
    registry: dict[str, Any],
    suite: str,
) -> list[dict[str, Any]]:
    suites = manifest.get("suites") if isinstance(manifest, dict) else None
    if not isinstance(suites, dict) or suite not in suites:
        raise ValueError(f"unknown evaluation suite: {suite}")
    cases = registry.get("cases") if isinstance(registry, dict) else None
    if not isinstance(cases, list):
        raise ValueError("invalid case registry")
    selected = [dict(case) for case in cases if suite in case.get("suites", [])]
    if suite in {"nightly", "release"} and not selected:
        selected = [
            dict(case)
            for case in cases
            if case.get("gate") == "hard"
            and set(case.get("suites") or []) & {"smoke", "pr"}
        ]
    if suite in {"smoke", "pr"} and not selected:
        raise ValueError(f"suite has no registered cases: {suite}")
    return selected


def _relative_output(output: Path, path: Path) -> str:
    return path.resolve().relative_to(output.resolve()).as_posix()


def _supports_process_tree_supervisor() -> bool:
    """Whether timeout execution can own and stop a complete process tree."""
    return os.name == "posix" and hasattr(os, "kill")


def _descendant_pids(root_pid: int) -> list[int]:
    try:
        completed = subprocess.run(
            ["ps", "-axo", "pid=,ppid="], capture_output=True, text=True,
            check=False, timeout=1.0,
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
    """Boundedly terminate case descendants and then reap the leader."""
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
    except OSError:
        confirmed = False
    if proc.poll() is None:
        try:
            proc.wait(timeout=0.5)
        except subprocess.TimeoutExpired:
            try:
                proc.kill()
                proc.wait(timeout=0.5)
            except (OSError, subprocess.TimeoutExpired):
                confirmed = False
    return confirmed


def _drain_case_pipes(
    proc: subprocess.Popen[bytes],
    timeout: float | None,
    stdout_sink: Any,
    stderr_sink: Any,
) -> tuple[bool, bool, bool]:
    """Stream complete case output to files with constant process memory."""
    selector = selectors.DefaultSelector()
    for pipe, sink in ((proc.stdout, stdout_sink), (proc.stderr, stderr_sink)):
        if pipe is None:
            continue
        os.set_blocking(pipe.fileno(), False)
        selector.register(pipe, selectors.EVENT_READ, sink)

    def drain_until(deadline: float | None, *, require_process_exit: bool) -> bool:
        while True:
            if not selector.get_map():
                if not require_process_exit or proc.poll() is not None:
                    return True
            if deadline is not None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
            else:
                remaining = 0.05
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
                    key.data.write(chunk)
                    continue
                selector.unregister(pipe)
                pipe.close()

    deadline = None if timeout is None else time.monotonic() + timeout
    timed_out = not drain_until(deadline, require_process_exit=True)
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
    return timed_out, tree_terminated, output_drained


def run_case(
    case: dict[str, Any],
    *,
    root: Path | str,
    output: Path | str,
    implemented_capabilities: set[str] | frozenset[str],
    env: dict[str, str] | None = None,
    timeout: float | None = None,
) -> dict[str, Any]:
    repo = Path(root).resolve()
    out = Path(output).resolve()
    case_id = str(case.get("case_id") or "unknown-case")
    required = {
        str(value)
        for value in case.get("required_capabilities", [])
        if str(value)
    }
    missing = sorted(required - set(implemented_capabilities))
    started_at = _utc_now()
    common: dict[str, Any] = {
        "schema_version": 1,
        "eval_spec": EVAL_SPEC,
        "case_id": case_id,
        "kind": case.get("kind"),
        "gate": case.get("gate"),
        "started_at": started_at,
        "command": list(case.get("command") or []),
        "evidence_requirements": list(case.get("evidence_requirements") or []),
    }
    if missing:
        return {
            **common,
            "completed_at": _utc_now(),
            "duration_seconds": 0.0,
            "status": "NOT_RUN",
            "returncode": None,
            "stdout_path": None,
            "stderr_path": None,
            "artifact_hashes": {},
            "not_run_reasons": [f"missing_capability:{value}" for value in missing],
        }

    if timeout is not None and (
        isinstance(timeout, bool)
        or not isinstance(timeout, (int, float))
        or not math.isfinite(float(timeout))
        or float(timeout) <= 0
    ):
        raise ValueError("timeout must be positive")
    if timeout is not None and not _supports_process_tree_supervisor():
        return {
            **common,
            "completed_at": _utc_now(),
            "duration_seconds": 0.0,
            "status": "NOT_RUN",
            "returncode": None,
            "stdout_path": None,
            "stderr_path": None,
            "artifact_hashes": {},
            "not_run_reasons": ["process_tree_supervisor_unsupported"],
        }

    case_dir = out / "cases" / case_id
    stdout_path = case_dir / "stdout.log"
    stderr_path = case_dir / "stderr.log"
    case_dir.mkdir(parents=True, exist_ok=True)
    process_env = os.environ.copy()
    if env:
        process_env.update({str(key): str(value) for key, value in env.items()})
    started = time.perf_counter()
    process_kwargs: dict[str, Any] = {}
    if os.name == "posix":
        process_kwargs["start_new_session"] = True
    elif hasattr(subprocess, "CREATE_NEW_PROCESS_GROUP"):
        process_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    stdout_temporary: Path | None = None
    stderr_temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w+b", dir=case_dir, prefix=".stdout.", suffix=".tmp", delete=False
        ) as stdout_sink, tempfile.NamedTemporaryFile(
            "w+b", dir=case_dir, prefix=".stderr.", suffix=".tmp", delete=False
        ) as stderr_sink:
            stdout_temporary = Path(stdout_sink.name)
            stderr_temporary = Path(stderr_sink.name)
            try:
                process = subprocess.Popen(
                    list(case.get("command") or []),
                    cwd=repo,
                    env=process_env,
                    text=False,
                    bufsize=0,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    **process_kwargs,
                )
            except OSError as exc:
                returncode = None
                stderr_sink.write(
                    f"execution_error:{type(exc).__name__}:{exc}\n".encode(
                        "utf-8", errors="replace"
                    )
                )
                status = "NOT_RUN"
                reasons = [f"execution_error:{type(exc).__name__}"]
            else:
                timed_out, tree_terminated, output_drained = _drain_case_pipes(
                    process, timeout, stdout_sink, stderr_sink
                )
                if timed_out:
                    returncode = None
                    status = "NOT_RUN"
                    reasons = ["execution_timeout"]
                    if not tree_terminated:
                        reasons.append("process_tree_termination_unconfirmed")
                    if not output_drained:
                        reasons.append("process_output_drain_timeout")
                else:
                    returncode = process.returncode
                    status = "PASS" if returncode == 0 else "FAIL"
                    reasons = []
            for sink in (stdout_sink, stderr_sink):
                sink.flush()
                os.fsync(sink.fileno())
        os.replace(stdout_temporary, stdout_path)
        stdout_temporary = None
        os.replace(stderr_temporary, stderr_path)
        stderr_temporary = None
    finally:
        if stdout_temporary is not None:
            stdout_temporary.unlink(missing_ok=True)
        if stderr_temporary is not None:
            stderr_temporary.unlink(missing_ok=True)
    duration = round(time.perf_counter() - started, 6)
    stdout_relative = _relative_output(out, stdout_path)
    stderr_relative = _relative_output(out, stderr_path)
    result = {
        **common,
        "completed_at": _utc_now(),
        "duration_seconds": duration,
        "status": status,
        "returncode": returncode,
        "stdout_path": stdout_relative,
        "stderr_path": stderr_relative,
        "artifact_hashes": {
            stdout_relative: _sha256(stdout_path),
            stderr_relative: _sha256(stderr_path),
        },
        "not_run_reasons": reasons,
    }
    _write_text_atomic(
        case_dir / "result.json",
        json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
    )
    return result


def aggregate_suite_status(results: list[dict[str, Any]]) -> str:
    hard = [result for result in results if result.get("gate") == "hard"]
    if any(result.get("status") in {"FAIL", "NOT_RUN"} for result in hard):
        return "FAIL"
    if any(result.get("status") == "INELIGIBLE" for result in hard):
        return "INELIGIBLE"
    if any(result.get("status") == "FAIL" for result in results):
        return "FAIL"
    return "PASS"
