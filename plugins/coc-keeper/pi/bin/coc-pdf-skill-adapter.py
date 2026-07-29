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
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from typing import Any, NoReturn


MAX_INPUT_BYTES = 256 * 1024
MAX_OUTPUT_BYTES = 256 * 1024
MAX_VISUAL_REVIEW_IMAGES = 3
MAX_VISUAL_REVIEW_IMAGE_BYTES = 16 * 1024 * 1024
MAX_VISUAL_REVIEW_TOTAL_BYTES = 32 * 1024 * 1024
CODEX_TIMEOUT_SECONDS = 240
# The outer Pi locator owner allows 1.5s for TERM and another 1.5s for KILL.
# Keep this nested Codex process-group budget well inside that first window so
# the adapter can reap its own start_new_session child before Pi escalates.
TERMINATION_GRACE_SECONDS = 0.35
OPENING_REVIEW_TIMEOUT_SECONDS = 900
PLUGIN_ROOT = Path(__file__).resolve().parents[2]
OPENING_COORDINATOR_INSTRUCTION = PLUGIN_ROOT / "agents" / "coc-opening-source-coordinator.md"
OPENING_COORDINATOR_CONTRACT = PLUGIN_ROOT / "references" / "opening-source-coordinator-v1.json"

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


def _opening_review_capabilities() -> dict[str, Any]:
    _capabilities()
    if (
        not OPENING_COORDINATOR_INSTRUCTION.is_file()
        or not OPENING_COORDINATOR_CONTRACT.is_file()
        or not (PLUGIN_ROOT / "mcp" / "launch").is_file()
    ):
        _fail("canonical opening source coordinator is unavailable")
    return {
        "schema_version": 1,
        "contract_id": "coc.pi-opening-source-review-transport-capabilities.v1",
        "capability": "canonical_codex_opening_source_coordinator",
        "coordinator_contract_id": "coc.codex-opening-source-task.v1",
        "continuation_contract_id": "coc.opening-source-continue.v1",
        "private_fulfillment": True,
        "durable_same_thread_resume": True,
        "repository_pdf_parser": False,
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
    if set(source) != {"path", "source_id", "title", "file_sha256"}:
        _fail("task.source contract mismatch")
    if not Path(str(source.get("path") or "")).is_absolute():
        _fail("task source path must be absolute")
    for key in ("source_id", "title"):
        if not isinstance(source.get(key), str) or not source[key].strip():
            _fail(f"task.source.{key} required")
    if not isinstance(source.get("file_sha256"), str) or not re.fullmatch(
        r"[a-f0-9]{64}", source["file_sha256"],
    ):
        _fail("task.source.file_sha256 invalid")
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


def _validate_opening_review_transport(value: Any) -> dict[str, Any]:
    task = _object(value, "opening review transport")
    fields = {"schema_version", "contract_id", "workspace_root", "campaign_id",
              "opening_review_generation"}
    if set(task) != fields:
        _fail("opening review transport fields mismatch")
    generation = task.get("opening_review_generation")
    if (
        task.get("schema_version") != 1
        or task.get("contract_id")
        != "coc.pi-opening-source-review-transport.v1"
        or not isinstance(generation, int)
        or isinstance(generation, bool)
        or generation < 1
    ):
        _fail("opening review transport contract mismatch")
    if any(not isinstance(task.get(key), str) or not task[key].strip()
           for key in ("workspace_root", "campaign_id")):
        _fail("opening review transport identity required")
    workspace = Path(task["workspace_root"])
    if not workspace.is_absolute():
        _fail("opening review workspace_root must be absolute")
    campaign_id = task["campaign_id"]
    if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", campaign_id) is None:
        _fail("opening review campaign_id invalid")
    resolved = workspace.resolve()
    if (
        resolved != Path.cwd().resolve()
        or not (resolved / "uv.lock").is_file()
        or not (resolved / "plugins" / "coc-keeper").samefile(PLUGIN_ROOT)
    ):
        _fail("opening review transport workspace drift")
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
        "source_bundle_manifest_contract, including manifest.source.title "
        "copied exactly from task.source.title. If not located, write nothing. Return "
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


def _runtime_modules() -> tuple[Any, Any]:
    scripts = PLUGIN_ROOT / "scripts"
    if str(scripts) not in sys.path:
        sys.path.insert(0, str(scripts))
    import coc_fileio  # type: ignore[import-not-found]
    import coc_runtime_ops  # type: ignore[import-not-found]
    return coc_fileio, coc_runtime_ops


def _json(path: Path, label: str) -> dict[str, Any]:
    try:
        return _object(json.loads(path.read_text(encoding="utf-8")), label)
    except (OSError, json.JSONDecodeError) as exc:
        _fail(f"{label} unavailable: {type(exc).__name__}")


def _codex_turn(
    prompt: str | dict[str, Any],
    workspace: Path,
    *,
    resume: str | None = None,
    images: list[Path] | None = None,
    isolated: bool = False,
    timeout: int = CODEX_TIMEOUT_SECONDS,
) -> tuple[dict[str, Any], str | None]:
    workspace.joinpath(".tmp").mkdir(exist_ok=True)
    with tempfile.NamedTemporaryFile(
        prefix="coc-codex-", suffix=".json", dir=workspace / ".tmp",
        delete=False,
    ) as output:
        output_path = Path(output.name)
    common = ["--output-last-message", str(output_path)]
    if isolated:
        launch = str((PLUGIN_ROOT / "mcp" / "launch").resolve())
        env = (
            "{ COC_HOST = \"codex\", "
            f"COC_PROJECT_ROOT = {json.dumps(str(workspace))}, "
            f"COC_RUNTIME_ROOT = {json.dumps(str(workspace / 'runtime'))} }}"
        )
        common = [
            "--json", "--ignore-user-config", "--ignore-rules",
            "-c", f"mcp_servers.coc-keeper.command={json.dumps(launch)}",
            "-c", f"mcp_servers.coc-keeper.cwd={json.dumps(str(workspace))}",
            "-c", f"mcp_servers.coc-keeper.env={env}",
            "-c", "mcp_servers.coc-keeper.enabled=true", *common,
        ]
    image_args = [
        item
        for path in images or []
        for item in ("-i", str(path))
    ]
    if image_args and not resume:
        _fail("visual-review images require a resumed Codex thread")
    args = (
        [_command(), "exec", "resume", *common, *image_args, resume, "-"]
        if resume else
        [_command(), "exec", "-", *(
            [] if isolated else ["--ephemeral"]
        ), "--sandbox", "workspace-write", "--cd", str(workspace), *common]
    )
    process: subprocess.Popen[str] | None = None
    handlers: dict[int, Any] = {}

    def interrupted(signum: int, _frame: Any) -> NoReturn:
        if process is not None:
            _terminate_process_group(process)
        _fail(f"external Codex lifecycle interrupted by signal {signum}")

    try:
        for signum in (signal.SIGTERM, signal.SIGINT):
            handlers[signum] = signal.getsignal(signum)
            signal.signal(signum, interrupted)
        process = subprocess.Popen(
            args, text=True, stdin=subprocess.PIPE,
            stdout=subprocess.PIPE if isolated else subprocess.DEVNULL,
            stderr=subprocess.PIPE, start_new_session=True,
            env={key: value for key, value in os.environ.items() if key in {
                "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL",
                "USER", "LOGNAME", "SHELL", "CODEX_HOME",
            }},
        )
        try:
            stdout, stderr = process.communicate(
                input=(
                    prompt if isinstance(prompt, str) else
                    json.dumps(prompt, ensure_ascii=False, separators=(",", ":"))
                ),
                timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            _terminate_process_group(process)
            _fail("external Codex lifecycle timed out")
        if process.returncode != 0:
            _fail(
                "external Codex lifecycle failed; stderr redacted "
                f"({len((stderr or '').encode())} bytes)"
            )
        thread = resume
        for line in (stdout or "").splitlines():
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("type") == "thread.started":
                thread = str(event.get("thread_id") or "") or thread
                break
        payload = output_path.read_bytes()
        if len(payload) > MAX_OUTPUT_BYTES:
            _fail("Codex receipt exceeds output limit")
        return _object(json.loads(payload), "Codex receipt"), thread
    finally:
        if process is not None and process.poll() is None:
            _terminate_process_group(process)
        for signum, handler in handlers.items():
            signal.signal(signum, handler)
        output_path.unlink(missing_ok=True)


def _opening_state(
    workspace: Path, campaign_id: str,
) -> tuple[Path, Path, dict[str, Any], dict[str, Any]]:
    campaign_dir = workspace / ".coc" / "campaigns" / campaign_id
    scenario = _json(
        campaign_dir / "scenario" / "scenario.json", "campaign scenario",
    )
    return (
        campaign_dir / "opening-source-review-transport.json",
        campaign_dir / "opening-source-review-transport.lock",
        scenario,
        _json(campaign_dir / "campaign.json", "campaign"),
    )


def _coordinator_task(
    workspace: Path, request: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    _state, _lock, scenario, campaign = _opening_state(
        workspace, request["campaign_id"],
    )
    _fileio, runtime_ops = _runtime_modules()
    private = runtime_ops._validate_opening_review_task(
        scenario, expected_status="pending",
    )
    if private["generation"] != request["opening_review_generation"]:
        _fail("opening review generation drift")
    source = _object(scenario.get("source"), "scenario source")
    scenario_id = str(scenario.get("scenario_id") or "")
    task = {
        "schema_version": 1,
        "contract_id": "coc.codex-opening-source-task.v1",
        "bootstrap_instruction": (
            "Before any response or tool call, read instruction_ref completely, "
            "then execute this closed task under that instruction."
        ),
        "instruction_ref": str(OPENING_COORDINATOR_INSTRUCTION.resolve()),
        "contract_ref": str(OPENING_COORDINATOR_CONTRACT.resolve()),
        "adapter_mode": "codex_context_free_inline_source",
        "model_policy": "inherit_parent",
        "workspace_root": str(workspace),
        "pdf_path": str(Path(str(source.get("path") or "")).resolve()),
        "pdf_sha256": source.get("file_sha256"),
        "campaign_id": request["campaign_id"],
        "scenario_id": scenario_id,
        "title": scenario.get("title"),
        "era": campaign.get("era") or "1920s",
        "play_language": campaign.get("play_language") or "zh-Hans",
        "source_bundle_id": private["source_bundle_id"],
        "source_bundle_path": private["source_bundle_path"],
        "opening_locator_pdf_indices": private["allowed_pdf_indices"],
        "max_selected_opening_pages": 3,
        "visual_review_transport": {
            "request_contract_id": "coc.opening-visual-review-request.v1",
            "resume_contract_id": "coc.opening-visual-review-resume.v1",
            "render_root": str(
                (
                    Path(private["source_bundle_path"]).resolve().parent
                    / "opening-visual-review"
                ).resolve()
            ),
            "max_images": MAX_VISUAL_REVIEW_IMAGES,
            "result_delivery": "same_thread_image_resume",
        },
        "instruction_refs": {"pdf_skill": str(_pdf_skill())},
        "result_delivery": "task_return_to_parent",
    }
    if not scenario_id or re.fullmatch(
        r"[a-f0-9]{64}", str(task["pdf_sha256"] or ""),
    ) is None:
        _fail("opening review source identity invalid")
    return task, scenario_id


def _visual_review_request(
    result: dict[str, Any], task: dict[str, Any],
) -> dict[str, Any] | None:
    if result.get("contract_id") != "coc.opening-visual-review-request.v1":
        return None
    fields = {
        "schema_version", "contract_id", "status", "campaign_id",
        "scenario_id", "render_root", "pdf_indices", "image_paths",
        "failure_class",
    }
    transport = _object(
        task.get("visual_review_transport"), "visual review transport",
    )
    indices = result.get("pdf_indices")
    image_paths = result.get("image_paths")
    if (
        set(result) != fields
        or result.get("schema_version") != 1
        or result.get("status") != "visual_review_required"
        or result.get("campaign_id") != task["campaign_id"]
        or result.get("scenario_id") != task["scenario_id"]
        or result.get("render_root") != transport.get("render_root")
        or result.get("failure_class") is not None
        or not isinstance(indices, list)
        or any(
            not isinstance(index, int) or isinstance(index, bool) or index < 0
            for index in indices
        )
        or not 1 <= len(indices) <= MAX_VISUAL_REVIEW_IMAGES
        or indices != list(range(indices[0], indices[0] + len(indices)))
        or not isinstance(image_paths, list)
        or len(image_paths) != len(indices)
        or any(
            not isinstance(path, str) or not path
            for path in image_paths
        )
        or len(set(image_paths)) != len(image_paths)
    ):
        _fail("opening visual-review request invalid")
    render_root = Path(str(transport["render_root"]))
    if (
        not render_root.is_absolute()
        or not render_root.is_dir()
        or render_root.is_symlink()
        or render_root.resolve(strict=True) != render_root
    ):
        _fail("opening visual-review render root invalid")
    total_bytes = 0
    validated_paths: list[str] = []
    for raw_path in image_paths:
        path = Path(raw_path)
        if (
            not path.is_absolute()
            or path.is_symlink()
            or path.resolve(strict=True) != path
            or path.parent != render_root
            or not path.is_file()
            or path.suffix.lower() not in {".png", ".jpg", ".jpeg"}
        ):
            _fail("opening visual-review image path invalid")
        size = path.stat().st_size
        total_bytes += size
        if (
            size <= 0
            or size > MAX_VISUAL_REVIEW_IMAGE_BYTES
            or total_bytes > MAX_VISUAL_REVIEW_TOTAL_BYTES
        ):
            _fail("opening visual-review image size invalid")
        with path.open("rb") as image:
            prefix = image.read(8)
        if (
            path.suffix.lower() == ".png"
            and prefix != b"\x89PNG\r\n\x1a\n"
        ) or (
            path.suffix.lower() in {".jpg", ".jpeg"}
            and not prefix.startswith(b"\xff\xd8\xff")
        ):
            _fail("opening visual-review image content invalid")
        validated_paths.append(str(path))
    return {
        "schema_version": 1,
        "contract_id": "coc.opening-visual-review-request.v1",
        "status": "visual_review_required",
        "campaign_id": task["campaign_id"],
        "scenario_id": task["scenario_id"],
        "render_root": str(render_root),
        "pdf_indices": indices,
        "image_paths": validated_paths,
        "failure_class": None,
    }


def _visual_review_resume(request: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "contract_id": "coc.opening-visual-review-resume.v1",
        "campaign_id": request["campaign_id"],
        "scenario_id": request["scenario_id"],
        "pdf_indices": request["pdf_indices"],
        "image_count": len(request["image_paths"]),
        "result_delivery": "same_thread_image_resume",
    }


def _coordinator_failure(
    result: dict[str, Any], task: dict[str, Any],
    continuation: dict[str, Any] | None,
) -> str | None:
    if (
        result.get("contract_id")
        != "coc.opening-source-coordinator-result.v1"
    ):
        return None
    _fileio, ops = _runtime_modules()
    allowed = {
        "invalid_packet", "pdf_scope_failed", "bundle_validation_failed",
        "bind_failed", "skeleton_failed", "source_dispatch_failed",
        "source_result_invalid", "fulfill_failed", "projection_failed",
    }
    failure = result.get("failure_class")
    selected = (
        continuation["selected_opening_pdf_indices"]
        if continuation else []
    )
    if (
        set(result) != ops._OPENING_COORDINATOR_RESULT_FIELDS
        or result.get("schema_version") != 1
        or result.get("status") not in {"source_pending", "failed"}
        or result.get("campaign_id") != task["campaign_id"]
        or result.get("scenario_id") != task["scenario_id"]
        or result.get("selected_opening_pdf_indices") != selected
        or failure not in allowed
        or result.get("source_bundle_sha256") is not None
        or result.get("opening_job_id") is not None
        or result.get("opening_projection_ref") is not None
        or result.get("initial_move_operation") is not None
        or result.get("opening_delivery_boundary")
        != ops._OPENING_DELIVERY_BOUNDARY
    ):
        _fail("opening coordinator failure result invalid")
    return str(failure)


def _continuation(result: dict[str, Any], task: dict[str, Any]) -> dict[str, Any]:
    indices = result.get("selected_opening_pdf_indices")
    continuation = _object(result.get("continue_task"), "opening continuation")
    expected = {
        "schema_version": 1,
        "contract_id": "coc.opening-source-continue.v1",
        "campaign_id": task["campaign_id"],
        "scenario_id": task["scenario_id"],
        "selected_opening_pdf_indices": indices,
        "source_bundle_id": task["source_bundle_id"],
        "source_bundle_path": task["source_bundle_path"],
        "result_delivery": "task_return_to_parent",
    }
    if (
        result.get("contract_id") != "coc.opening-character-concepts.v1"
        or result.get("status") != "concepts_ready"
        or not isinstance(indices, list)
        or not 1 <= len(indices) <= 3
        or indices != list(range(indices[0], indices[0] + len(indices)))
        or continuation != expected
    ):
        _fail("opening coordinator continuation invalid")
    return continuation


def _opening_receipt(
    request: dict[str, Any], scenario_id: str,
    status: str, failure: str | None,
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "contract_id": "coc.pi-opening-source-review-transport-result.v1",
        "status": status,
        "campaign_id": request["campaign_id"],
        "scenario_id": scenario_id,
        "opening_review_generation": request["opening_review_generation"],
        "failure_class": failure,
    }


def _consume_failure(
    workspace: Path, request: dict[str, Any], scenario_id: str,
    failure: str, continuation: dict[str, Any] | None,
) -> None:
    _fileio, ops = _runtime_modules()
    try:
        receipt = ops._build_opening_source_review_fulfillment(
            workspace, continuation=continuation, status="failed",
            selected_opening_pdf_indices=(
                continuation["selected_opening_pdf_indices"]
                if continuation else None
            ),
            failure_class=failure, error_code="transport_terminal",
        )
    except (ops.RuntimeOperationError, TypeError):
        receipt = ops._build_opening_source_review_transport_failure(
            workspace, campaign_id=request["campaign_id"],
            scenario_id=scenario_id, failure_class=failure,
            error_code="transport_terminal",
        )
    ops._apply_opening_source_review_fulfillment(workspace, receipt)


def _run_opening_review() -> dict[str, Any]:
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        _fail("opening review transport exceeds input limit")
    request = _validate_opening_review_transport(json.loads(raw))
    workspace = Path(request["workspace_root"]).resolve()
    state_path, lock_path, scenario, _campaign = _opening_state(
        workspace, request["campaign_id"],
    )
    fileio, ops = _runtime_modules()
    with fileio.advisory_file_lock(lock_path):
        private = _object(
            scenario.get("opening_source_review_task"), "opening review task",
        )
        scenario_id = str(scenario.get("scenario_id") or "")
        if private.get("generation") != request["opening_review_generation"]:
            _fail("opening review generation drift")
        if private.get("status") in {"fulfilled", "failed"}:
            failure = None
            if private["status"] == "failed":
                failure = str(_object(
                    _object(
                        scenario.get("opening_source_review_failure"),
                        "opening failure",
                    ).get("failure"), "opening failure identity",
                ).get("failure_class") or "opening_review_failed")
            return _opening_receipt(
                request, scenario_id,
                "reviewed" if private["status"] == "fulfilled" else "failed",
                failure,
            )
        lifecycle = _json(state_path, "opening transport") if state_path.exists() else None
        if lifecycle and lifecycle.get("opening_review_generation") != request[
            "opening_review_generation"
        ]:
            _consume_failure(
                workspace, request, scenario_id,
                "opening_source_coordinator_interrupted", None,
            )
            return _opening_receipt(
                request, scenario_id, "failed",
                "opening_source_coordinator_interrupted",
            )
        if lifecycle and lifecycle.get("status") == "terminal":
            return _object(lifecycle.get("receipt"), "terminal receipt")
        task, scenario_id = _coordinator_task(workspace, request)
        base = {
            "schema_version": 1,
            "contract_id": "coc.pi-opening-source-review-lifecycle.v1",
            "campaign_id": request["campaign_id"],
            "scenario_id": scenario_id,
            "opening_review_generation": request["opening_review_generation"],
        }
        continuation = (
            _object(lifecycle.get("continuation"), "retained continuation")
            if lifecycle and lifecycle.get("status") == "phase1_ready" else None
        )
        receipt: dict[str, Any] | None = None
        try:
            if continuation is None:
                visual_request: dict[str, Any] | None = None
                if lifecycle is None:
                    fileio.write_json_atomic(
                        state_path, {**base, "status": "phase1_started"},
                    )
                    concepts, thread = _codex_turn(
                        task, workspace, isolated=True,
                        timeout=OPENING_REVIEW_TIMEOUT_SECONDS,
                    )
                    failure = _coordinator_failure(
                        concepts, task, continuation=None,
                    )
                    if failure is not None:
                        _consume_failure(
                            workspace, request, scenario_id, failure, None,
                        )
                        receipt = _opening_receipt(
                            request, scenario_id, "failed", failure,
                        )
                    else:
                        visual_request = _visual_review_request(concepts, task)
                        if visual_request is not None:
                            if not thread:
                                _fail(
                                    "opening coordinator thread identity missing"
                                )
                            lifecycle = {
                                **base,
                                "status": "visual_review_ready",
                                "thread_id": thread,
                                "visual_review_request": visual_request,
                            }
                            fileio.write_json_atomic(state_path, lifecycle)
                        else:
                            continuation = _continuation(concepts, task)
                            lifecycle = {
                                **base, "status": "phase1_ready",
                                "thread_id": thread,
                                "continuation": continuation,
                            }
                            fileio.write_json_atomic(state_path, lifecycle)
                elif lifecycle.get("status") == "visual_review_ready":
                    visual_request = _visual_review_request(
                        _object(
                            lifecycle.get("visual_review_request"),
                            "retained visual-review request",
                        ),
                        task,
                    )
                else:
                    _fail("opening source coordinator was interrupted")
                if receipt is None and continuation is None:
                    if visual_request is None:
                        _fail("opening visual-review request missing")
                    thread = str((lifecycle or {}).get("thread_id") or "")
                    if not thread:
                        _fail("opening coordinator thread identity missing")
                    fileio.write_json_atomic(
                        state_path,
                        {**(lifecycle or base), "status": "visual_review_started"},
                    )
                    concepts, resumed_thread = _codex_turn(
                        _visual_review_resume(visual_request),
                        workspace,
                        resume=thread,
                        images=[
                            Path(path)
                            for path in visual_request["image_paths"]
                        ],
                        isolated=True,
                        timeout=OPENING_REVIEW_TIMEOUT_SECONDS,
                    )
                    if resumed_thread != thread:
                        _fail("opening coordinator thread identity drift")
                    failure = _coordinator_failure(
                        concepts, task, continuation=None,
                    )
                    if failure is not None:
                        _consume_failure(
                            workspace, request, scenario_id, failure, None,
                        )
                        receipt = _opening_receipt(
                            request, scenario_id, "failed", failure,
                        )
                    else:
                        continuation = _continuation(concepts, task)
                        lifecycle = {
                            **base, "status": "phase1_ready",
                            "thread_id": thread,
                            "continuation": continuation,
                        }
                        fileio.write_json_atomic(state_path, lifecycle)
            if receipt is None:
                thread = str((lifecycle or {}).get("thread_id") or "")
                if not thread:
                    _fail("opening coordinator thread identity missing")
                fileio.write_json_atomic(
                    state_path, {**(lifecycle or base), "status": "phase2_started"},
                )
                final, resumed_thread = _codex_turn(
                    continuation, workspace, resume=thread, isolated=True,
                    timeout=OPENING_REVIEW_TIMEOUT_SECONDS,
                )
                if resumed_thread != thread:
                    _fail("opening coordinator thread identity drift")
                if final.get("status") == "opening_ready":
                    ops._validate_opening_source_coordinator_ready_result(
                        workspace, continuation=continuation, result=final,
                    )
                    fulfillment = ops._build_opening_source_review_fulfillment(
                        workspace, continuation=continuation, status="reviewed",
                        selected_opening_pdf_indices=continuation[
                            "selected_opening_pdf_indices"
                        ],
                    )
                    ops._apply_opening_source_review_fulfillment(
                        workspace, fulfillment,
                    )
                    receipt = _opening_receipt(
                        request, scenario_id, "reviewed", None,
                    )
                else:
                    failure = _coordinator_failure(
                        final, task, continuation,
                    )
                    if failure is None:
                        _fail("opening coordinator final result invalid")
                    _consume_failure(
                        workspace, request, scenario_id, failure, continuation,
                    )
                    receipt = _opening_receipt(
                        request, scenario_id, "failed", failure,
                    )
        except (RuntimeError, OSError, ValueError, subprocess.SubprocessError):
            failure = "opening_source_coordinator_transport_failed"
            _consume_failure(
                workspace, request, scenario_id, failure, continuation,
            )
            receipt = _opening_receipt(
                request, scenario_id, "failed", failure,
            )
        fileio.write_json_atomic(
            state_path, {**base, "status": "terminal", "receipt": receipt},
        )
        return _object(receipt, "opening review receipt")


def _run() -> dict[str, Any]:
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        _fail("task exceeds input limit")
    task = _validate_task(json.loads(raw.decode("utf-8")))
    workspace = Path(task["workspace_root"]).resolve()
    if not workspace.is_dir():
        _fail("workspace_root is unavailable")
    receipt, _thread = _codex_turn(
        _prompt(task, _pdf_skill()), workspace,
    )
    return receipt


def main() -> int:
    try:
        if sys.argv[1:] == ["--capabilities"]:
            value = _capabilities()
        elif sys.argv[1:] == ["--opening-review-capabilities"]:
            value = _opening_review_capabilities()
        elif sys.argv[1:] == ["--run"]:
            value = _run()
        elif sys.argv[1:] == ["--run-opening-review"]:
            value = _run_opening_review()
        else:
            _fail(
                "expected --capabilities, --run, "
                "--opening-review-capabilities, or --run-opening-review"
            )
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
