#!/usr/bin/env python3
"""Thin transport from Pi to an external Codex PDF-skill worker.

This adapter deliberately contains no PDF parser, renderer, OCR, text search,
or source-bundle compiler.  It validates the closed transport envelope, invokes
an installed Codex CLI that owns the external PDF skill, and forwards one
strict producer receipt.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from typing import Any, NoReturn


MAX_INPUT_BYTES = 256 * 1024
MAX_OUTPUT_BYTES = 256 * 1024
CODEX_TIMEOUT_SECONDS = 240
# The outer Pi locator owner allows 1.5s for TERM and another 1.5s for KILL.
# Keep this nested Codex process-group budget well inside that first window so
# the adapter can reap its own start_new_session child before Pi escalates.
TERMINATION_GRACE_SECONDS = 0.35


def _fail(message: str) -> NoReturn:
    raise RuntimeError(message)


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        _fail(f"{label} must be an object")
    return value


def _command() -> str:
    configured = os.environ.get("COC_CODEX_COMMAND", "").strip()
    command = configured or shutil.which("codex") or ""
    if not command or not Path(command).is_absolute():
        _fail("external Codex CLI is unavailable")
    return command


def _pdf_skill() -> Path:
    configured = os.environ.get("COC_CODEX_PDF_SKILL", "").strip()
    path = Path(
        configured
        or Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
        / "skills"
        / "pdf"
        / "SKILL.md"
    ).expanduser().resolve()
    if not path.is_file():
        _fail("external Codex PDF skill is unavailable")
    return path


def _capabilities() -> dict[str, Any]:
    command = _command()
    _pdf_skill()
    subprocess.run(
        [command, "--version"],
        check=True,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=10,
    )
    return {
        "schema_version": 1,
        "contract_id": "coc.pi-source-scope-locator-producer-capabilities.v1",
        "capability": "bounded_pdf_visual_locator",
        "producer": "external-codex-pdf-skill",
        "max_selected_pages": 3,
        "writes_canonical_bundle": True,
        "visual_review": True,
        "repository_pdf_parser": False,
        "ocr": False,
    }


def _validate_task(value: Any) -> dict[str, Any]:
    task = _object(value, "task")
    if (
        task.get("schema_version") != 1
        or task.get("contract_id") != "coc.pi-source-scope-locator-task.v1"
        or task.get("adapter_mode") != "pi_external_pdf_skill_lifecycle"
        or task.get("model_policy")
        != "external_codex_cli_configured_default"
        or task.get("max_selected_pages") != 3
    ):
        _fail("task contract mismatch")
    for key in (
        "workspace_root",
        "job_id",
        "kind",
        "target_id",
        "target_label",
        "source_bundle_path",
    ):
        if not isinstance(task.get(key), str) or not task[key].strip():
            _fail(f"task.{key} required")
    source = _object(task.get("source"), "task.source")
    if not Path(str(source.get("path") or "")).is_absolute():
        _fail("task source path must be absolute")
    if not Path(task["workspace_root"]).is_absolute():
        _fail("task workspace_root must be absolute")
    if not Path(task["source_bundle_path"]).is_absolute():
        _fail("task source_bundle_path must be absolute")
    workspace = Path(task["workspace_root"]).resolve()
    bundle_root = (workspace / ".tmp" / "coc-source-scope").resolve()
    bundle_path = Path(task["source_bundle_path"]).resolve()
    if not bundle_path.is_relative_to(bundle_root):
        _fail("task source_bundle_path escapes the bounded locator root")
    return task


def _prompt(task: dict[str, Any], pdf_skill: Path) -> str:
    return (
        "You are an external PDF-skill producer, not a Keeper or source-pack "
        "compiler. Read the PDF skill at this exact path completely before any "
        f"action: {pdf_skill}\n"
        "Use that real PDF skill to locate the structured target in the exact "
        "source. Render and visually review only the smallest 1..3 page window. "
        "Do not use OCR. Do not read campaign saves or player transcripts. Do "
        "not call COC tools. Do not edit repository files outside the exact "
        "source_bundle_path. Write the canonical reviewed bundle required by "
        "source_bundle_manifest_contract. If not located, write nothing. Return "
        "only one strict JSON object with contract_id "
        "coc.pi-source-scope-locator-producer-result.v1 and exact fields "
        "schema_version, contract_id, job_id, status, kind, target_id, "
        "pdf_indices, source_bundle_path, failure_class. status is located, "
        "not_located, or failed. For located, source_bundle_path must equal the "
        "task and pdf_indices must be 1..3 unique ascending zero-based pages; "
        "otherwise pdf_indices=[], source_bundle_path=null.\n\n"
        "Closed task JSON follows:\n"
        + json.dumps(task, ensure_ascii=False, separators=(",", ":"))
    )


def _terminate_process_group(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.monotonic() + TERMINATION_GRACE_SECONDS
    while process.poll() is None and time.monotonic() < deadline:
        time.sleep(0.02)
    if process.poll() is None:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=TERMINATION_GRACE_SECONDS)
    except subprocess.TimeoutExpired:
        _fail("external Codex process group did not terminate")


def _run() -> dict[str, Any]:
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        _fail("task exceeds input limit")
    task = _validate_task(json.loads(raw.decode("utf-8")))
    command = _command()
    pdf_skill = _pdf_skill()
    workspace = Path(task["workspace_root"]).resolve()
    if not workspace.is_dir():
        _fail("workspace_root is unavailable")
    (workspace / ".tmp").mkdir(exist_ok=True)
    with tempfile.NamedTemporaryFile(
        prefix="coc-pdf-locator-",
        suffix=".json",
        dir=workspace / ".tmp",
        delete=False,
    ) as output_file:
        output_path = Path(output_file.name)
    process: subprocess.Popen[str] | None = None
    prior_handlers: dict[int, Any] = {}

    def interrupted(signum: int, _frame: Any) -> NoReturn:
        if process is not None:
            _terminate_process_group(process)
        _fail(f"external Codex lifecycle interrupted by signal {signum}")

    try:
        for signum in (signal.SIGTERM, signal.SIGINT):
            prior_handlers[signum] = signal.getsignal(signum)
            signal.signal(signum, interrupted)
        process = subprocess.Popen(
            [
                command,
                "exec",
                "-",
                "--ephemeral",
                "--sandbox",
                "workspace-write",
                "--cd",
                str(workspace),
                "--output-last-message",
                str(output_path),
            ],
            text=True,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            start_new_session=True,
            env={
                key: value
                for key, value in os.environ.items()
                if key
                in {
                    "PATH",
                    "HOME",
                    "TMPDIR",
                    "TMP",
                    "TEMP",
                    "LANG",
                    "LC_ALL",
                    "USER",
                    "LOGNAME",
                    "SHELL",
                    "CODEX_HOME",
                }
            },
        )
        try:
            _stdout, stderr = process.communicate(
                input=_prompt(task, pdf_skill),
                timeout=CODEX_TIMEOUT_SECONDS,
            )
        except subprocess.TimeoutExpired:
            _terminate_process_group(process)
            _fail("external Codex lifecycle timed out")
        if process.returncode != 0:
            _fail(
                "external Codex lifecycle failed; stderr redacted "
                f"({len((stderr or '').encode('utf-8'))} bytes)"
            )
        payload = output_path.read_bytes()
        if len(payload) > MAX_OUTPUT_BYTES:
            _fail("Codex producer receipt exceeds output limit")
        return _object(json.loads(payload.decode("utf-8")), "Codex receipt")
    finally:
        if process is not None and process.poll() is None:
            _terminate_process_group(process)
        for signum, handler in prior_handlers.items():
            signal.signal(signum, handler)
        output_path.unlink(missing_ok=True)


def main() -> int:
    try:
        if sys.argv[1:] == ["--capabilities"]:
            value = _capabilities()
        elif sys.argv[1:] == ["--run"]:
            value = _run()
        else:
            _fail("expected --capabilities or --run")
        print(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
        return 0
    except (
        RuntimeError,
        OSError,
        ValueError,
        subprocess.SubprocessError,
    ) as exc:
        print(f"coc-pdf-skill-adapter: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
