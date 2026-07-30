#!/usr/bin/env python3
"""Thin Pi transport for the external PDF skill.

The child is one isolated Grok coding turn. It may render/read the PDF and
write one reviewed source bundle. This trusted adapter validates that bundle,
binds it through the canonical setup operation, and consumes the exact new
private opening-review task. It contains no PDF parser or OCR fallback.
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
PI_TIMEOUT_SECONDS = 900
TERMINATION_GRACE_SECONDS = 0.35
PLUGIN_ROOT = Path(__file__).resolve().parents[2]
OPENING_COORDINATOR_CONTRACT = (
    PLUGIN_ROOT / "references" / "opening-source-coordinator-v1.json"
)
PI_MODEL = "xai/grok-4.5"
PI_THINKING = "low"
PI_TOOLS = "read,bash,write"


def _fail(message: str) -> NoReturn:
    raise RuntimeError(message)


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        _fail(f"{label} must be an object")
    return value


def _pi_command() -> str:
    configured = os.environ.get("COC_PI_COMMAND", "").strip()
    command = configured or shutil.which("pi") or ""
    if not command or not Path(command).is_absolute():
        _fail("Pi CLI is unavailable")
    return command


def _pdf_skill() -> Path:
    configured = os.environ.get("COC_PI_PDF_SKILL", "").strip()
    default = (
        Path(os.environ.get("CODEX_HOME", "")).expanduser()
        if os.environ.get("CODEX_HOME", "").strip()
        else Path.home() / ".codex"
    ) / "skills" / "pdf"
    path = Path(configured or default).expanduser().resolve()
    skill_file = path if path.name == "SKILL.md" else path / "SKILL.md"
    if not skill_file.is_file():
        _fail("external PDF skill is unavailable")
    return skill_file.parent


def _capabilities() -> dict[str, Any]:
    subprocess.run(
        [_pi_command(), "--version"],
        check=True,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=10,
    )
    _pdf_skill()
    return {
        "schema_version": 1,
        "contract_id": "coc.pi-source-scope-locator-producer-capabilities.v1",
        "capability": "bounded_pdf_visual_locator",
        "producer": "pi-grok-pdf-skill",
        "max_selected_pages": 3,
        "writes_canonical_bundle": True,
        "visual_review": True,
        "repository_pdf_parser": False,
        "ocr": False,
    }


def _opening_review_capabilities() -> dict[str, Any]:
    _capabilities()
    return {
        "schema_version": 1,
        "contract_id": "coc.pi-opening-source-review-transport-capabilities.v1",
        "capability": "pi_grok_pdf_skill_one_shot",
        "producer_contract_id": "coc.pi-opening-pdf-producer-result.v1",
        "private_fulfillment": True,
        "repository_pdf_parser": False,
    }


def _validate_task(value: Any) -> dict[str, Any]:
    task = _object(value, "task")
    if (
        task.get("schema_version") != 1
        or task.get("contract_id") != "coc.pi-source-scope-locator-task.v1"
        or task.get("adapter_mode") != "pi_external_pdf_skill_lifecycle"
        or task.get("model_policy")
        != "pinned_xai_grok_4_5_thinking_low"
        or task.get("max_selected_pages") != 3
    ):
        _fail("task contract mismatch")
    for key in (
        "workspace_root", "job_id", "kind", "target_id", "target_label",
        "source_bundle_path",
    ):
        if not isinstance(task.get(key), str) or not task[key].strip():
            _fail(f"task.{key} required")
    source = _object(task.get("source"), "task.source")
    if set(source) != {"path", "source_id", "title", "file_sha256"}:
        _fail("task.source contract mismatch")
    if not Path(str(source.get("path") or "")).is_absolute():
        _fail("task source path must be absolute")
    if any(
        not isinstance(source.get(key), str) or not source[key].strip()
        for key in ("source_id", "title")
    ):
        _fail("task source identity required")
    if re.fullmatch(r"[a-f0-9]{64}", str(source.get("file_sha256") or "")) is None:
        _fail("task.source.file_sha256 invalid")
    if not Path(task["workspace_root"]).is_absolute():
        _fail("task workspace_root must be absolute")
    if not Path(task["source_bundle_path"]).is_absolute():
        _fail("task source_bundle_path must be absolute")
    workspace = Path(task["workspace_root"]).resolve()
    bundle_root = (workspace / ".tmp" / "coc-source-scope").resolve()
    if not Path(task["source_bundle_path"]).resolve().is_relative_to(bundle_root):
        _fail("task source_bundle_path escapes the bounded locator root")
    return task


def _validate_opening_review_transport(value: Any) -> dict[str, Any]:
    task = _object(value, "opening review transport")
    if set(task) != {
        "schema_version", "contract_id", "workspace_root", "campaign_id",
        "scenario_id", "opening_review_generation",
    }:
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
    if any(
        not isinstance(task.get(key), str) or not task[key].strip()
        for key in ("workspace_root", "campaign_id", "scenario_id")
    ):
        _fail("opening review transport identity required")
    workspace = Path(task["workspace_root"])
    campaign_id = task["campaign_id"]
    if (
        not workspace.is_absolute()
        or re.fullmatch(
            r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", campaign_id,
        ) is None
    ):
        _fail("opening review transport identity invalid")
    resolved = workspace.resolve()
    if (
        resolved != Path.cwd().resolve()
        or not (resolved / "uv.lock").is_file()
        or not (resolved / "plugins" / "coc-keeper").samefile(PLUGIN_ROOT)
    ):
        _fail("opening review transport workspace drift")
    return task


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
        _fail("Pi process group did not terminate")


def _run_pi(prompt: str, cwd: Path, *, timeout: int) -> dict[str, Any]:
    args = [
        _pi_command(),
        "--mode", "text", "-p", "--no-session",
        "--no-extensions", "--no-skills", "--no-prompt-templates",
        "--no-context-files", "--approve",
        "--tools", PI_TOOLS,
        "--model", PI_MODEL,
        "--thinking", PI_THINKING,
        "--skill", str(_pdf_skill()),
        prompt,
    ]
    process: subprocess.Popen[str] | None = None
    handlers: dict[int, Any] = {}

    def interrupted(signum: int, _frame: Any) -> NoReturn:
        if process is not None:
            _terminate_process_group(process)
        _fail(f"Pi lifecycle interrupted by signal {signum}")

    try:
        for signum in (signal.SIGTERM, signal.SIGINT):
            handlers[signum] = signal.getsignal(signum)
            signal.signal(signum, interrupted)
        process = subprocess.Popen(
            args,
            cwd=cwd,
            text=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
            env={
                key: value
                for key, value in os.environ.items()
                if key in {
                    "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL",
                    "USER", "LOGNAME", "SHELL", "PI_CODING_AGENT_DIR",
                }
            },
        )
        try:
            stdout, stderr = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            _terminate_process_group(process)
            _fail("Pi PDF lifecycle timed out")
        if process.returncode != 0:
            _fail(
                "Pi PDF lifecycle failed; stderr redacted "
                f"({len((stderr or '').encode())} bytes)"
            )
        payload = (stdout or "").encode()
        if len(payload) > MAX_OUTPUT_BYTES:
            _fail("Pi PDF producer receipt exceeds output limit")
        return _object(json.loads(payload), "Pi PDF receipt")
    finally:
        if process is not None and process.poll() is None:
            _terminate_process_group(process)
        for signum, handler in handlers.items():
            signal.signal(signum, handler)


def _locator_prompt(task: dict[str, Any]) -> str:
    return (
        "Use the loaded PDF skill. You are only a document producer, never a "
        "Keeper. Locate the exact target in task.source.path, render and "
        "visually inspect the smallest 1..3 page window, and write a standard "
        "codex-pdf-skill source bundle at task.source_bundle_path. Do not use "
        "OCR, read campaign saves/transcripts, call gameplay tools, or edit "
        "anything outside that bundle. Return only strict JSON with exact "
        "fields schema_version, contract_id, job_id, status, kind, target_id, "
        "pdf_indices, source_bundle_path, failure_class and contract_id "
        "coc.pi-source-scope-locator-producer-result.v1.\n"
        + json.dumps(task, ensure_ascii=False, separators=(",", ":"))
    )


def _runtime_modules() -> tuple[Any, Any, Any]:
    scripts = PLUGIN_ROOT / "scripts"
    if str(scripts) not in sys.path:
        sys.path.insert(0, str(scripts))
    import coc_fileio  # type: ignore[import-not-found]
    import coc_pdf_bundle  # type: ignore[import-not-found]
    import coc_runtime_ops  # type: ignore[import-not-found]
    return coc_fileio, coc_pdf_bundle, coc_runtime_ops


def _json(path: Path, label: str) -> dict[str, Any]:
    try:
        return _object(json.loads(path.read_text(encoding="utf-8")), label)
    except (OSError, json.JSONDecodeError) as exc:
        _fail(f"{label} unavailable: {type(exc).__name__}")


def _opening_paths(workspace: Path, campaign_id: str) -> tuple[Path, Path]:
    campaign_dir = workspace / ".coc" / "campaigns" / campaign_id
    return (
        campaign_dir / "opening-source-review-transport.lock",
        campaign_dir,
    )


def _opening_manifest_contract() -> dict[str, Any]:
    reference = _json(
        OPENING_COORDINATOR_CONTRACT,
        "opening source coordinator contract",
    )
    return _object(
        reference.get("source_bundle_manifest_contract"),
        "opening source bundle manifest contract",
    )


def _opening_producer_task(
    workspace: Path,
    request: dict[str, Any],
    scenario: dict[str, Any],
    campaign: dict[str, Any],
    private: dict[str, Any],
) -> dict[str, Any]:
    source = _object(scenario.get("source"), "scenario source")
    output_root = (
        workspace / ".tmp" / "coc-opening-source-review"
        / request["campaign_id"]
    )
    output_root.mkdir(parents=True, exist_ok=True)
    output_root = output_root.resolve()
    if not output_root.is_relative_to(workspace):
        _fail("opening source bundle root escapes workspace")
    output = Path(tempfile.mkdtemp(
        prefix="reviewed-", dir=output_root,
    )).resolve()
    task = {
        "schema_version": 1,
        "contract_id": "coc.pi-opening-pdf-producer-task.v1",
        "workspace_root": str(workspace),
        "campaign_id": request["campaign_id"],
        "scenario_id": private["scenario_id"],
        "title": scenario.get("title"),
        "era": campaign.get("era") or "1920s",
        "play_language": campaign.get("play_language") or "zh-Hans",
        "source": {
            "path": str(Path(str(source.get("path") or "")).resolve()),
            "source_id": private["source_id"],
            "file_sha256": private["source_file_sha256"],
        },
        "opening_locator_pdf_indices": private["allowed_pdf_indices"],
        "max_selected_opening_pages": 3,
        "source_bundle_path": str(output),
        "source_bundle_manifest_contract": _opening_manifest_contract(),
    }
    if (
        not isinstance(task["title"], str)
        or not task["title"].strip()
        or re.fullmatch(
            r"[a-f0-9]{64}", str(task["source"]["file_sha256"]),
        ) is None
    ):
        _fail("opening review source identity invalid")
    return task


def _opening_prompt(task: dict[str, Any]) -> str:
    return (
        "Use the loaded PDF skill directly. You are one isolated document "
        "producer, not a Keeper and not a gameplay agent. Locate the named "
        "scenario's complete current player-facing opening beat, using the "
        "locator pages only as hints. Select the smallest contiguous 1..3 page "
        "window that includes authored time/place, every materially present "
        "NPC, the full briefing or pressure, and actionable routes when they "
        "exist. Render and visually inspect every selected page yourself with "
        "the read tool. Write exactly the canonical schema-v1 bundle defined by "
        "task.source_bundle_manifest_contract.template at source_bundle_path. "
        "That template's manifest.json keys and page keys are required. Legacy "
        "task-oriented coc.codex-pdf-skill-bundle.v1 shortcut manifests and "
        "alternate page keys markdown_file, file_sha256, or confidence are "
        "unsupported and will be rejected. manifest.source.source_id, "
        "path, and file_sha256 must exactly match task.source; "
        "manifest.source.title must exactly match task.title. "
        "Do not use OCR. Do not read .coc, saves, "
        "transcripts, AGENTS.md, or repository source. Do not call gameplay "
        "tools or write outside source_bundle_path. Return only one strict JSON "
        "object with exact fields schema_version, contract_id, status, "
        "campaign_id, scenario_id, selected_opening_pdf_indices, "
        "source_bundle_path, failure_class. contract_id is "
        "coc.pi-opening-pdf-producer-result.v1; status is reviewed or failed. "
        "For reviewed, indices are unique ascending contiguous and failure_class "
        "is null. For failed, indices=[], source_bundle_path=null, and "
        "failure_class is non-empty.\n"
        + json.dumps(task, ensure_ascii=False, separators=(",", ":"))
    )


def _validate_opening_result(
    value: Any, task: dict[str, Any],
) -> dict[str, Any]:
    result = _object(value, "opening PDF producer result")
    indices = result.get("selected_opening_pdf_indices")
    if (
        set(result) != {
            "schema_version", "contract_id", "status", "campaign_id",
            "scenario_id", "selected_opening_pdf_indices",
            "source_bundle_path", "failure_class",
        }
        or result.get("schema_version") != 1
        or result.get("contract_id")
        != "coc.pi-opening-pdf-producer-result.v1"
        or result.get("campaign_id") != task["campaign_id"]
        or result.get("scenario_id") != task["scenario_id"]
        or result.get("status") not in {"reviewed", "failed"}
        or not isinstance(indices, list)
        or any(
            not isinstance(index, int) or isinstance(index, bool) or index < 0
            for index in indices
        )
        or indices != sorted(set(indices))
    ):
        _fail("opening PDF producer result invalid")
    if result["status"] == "reviewed":
        if (
            not 1 <= len(indices) <= 3
            or indices != list(range(indices[0], indices[0] + len(indices)))
            or result.get("source_bundle_path") != task["source_bundle_path"]
            or result.get("failure_class") is not None
        ):
            _fail("reviewed opening PDF producer result invalid")
    elif (
        indices
        or result.get("source_bundle_path") is not None
        or not isinstance(result.get("failure_class"), str)
        or not result["failure_class"].strip()
    ):
        _fail("failed opening PDF producer result invalid")
    return result


def _opening_receipt(
    request: dict[str, Any],
    scenario_id: str,
    generation: int,
    status: str,
    failure: str | None,
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "contract_id": "coc.pi-opening-source-review-transport-result.v1",
        "status": status,
        "campaign_id": request["campaign_id"],
        "scenario_id": scenario_id,
        "opening_review_generation": generation,
        "failure_class": failure,
    }


def _run_opening_review() -> dict[str, Any]:
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        _fail("opening review transport exceeds input limit")
    request = _validate_opening_review_transport(json.loads(raw))
    workspace = Path(request["workspace_root"]).resolve()
    lock_path, campaign_dir = _opening_paths(
        workspace, request["campaign_id"],
    )
    fileio, pdf_bundle, ops = _runtime_modules()
    with fileio.advisory_file_lock(lock_path):
        scenario = _json(
            campaign_dir / "scenario" / "scenario.json", "campaign scenario",
        )
        campaign = _json(campaign_dir / "campaign.json", "campaign")
        private = ops._validate_opening_review_task(
            scenario, expected_status="pending",
        )
        if (
            private["generation"] != request["opening_review_generation"]
            or private["scenario_id"] != request["scenario_id"]
        ):
            _fail("opening review generation drift")
        task = _opening_producer_task(
            workspace, request, scenario, campaign, private,
        )
        result = _validate_opening_result(
            _run_pi(
                _opening_prompt(task),
                Path(task["source_bundle_path"]).parent,
                timeout=PI_TIMEOUT_SECONDS,
            ),
            task,
        )
        if result["status"] != "reviewed":
            return _opening_receipt(
                request, private["scenario_id"], private["generation"],
                "failed", result["failure_class"],
            )
        bundle = pdf_bundle.load_host_bundle(task["source_bundle_path"])
        selected = result["selected_opening_pdf_indices"]
        if (
            [row["pdf_index"] for row in bundle["pages"]] != selected
            or bundle["source"]["source_id"] != private["source_id"]
            or bundle["source"]["path"] != task["source"]["path"]
            or bundle["source"]["file_sha256"]
            != private["source_file_sha256"]
            or bundle["source"]["title"] != task["title"]
        ):
            _fail("opening source bundle identity drift")
        bind = ops.execute_setup_operation(
            workspace,
            operation={
                "schema_version": 1,
                "kind": "scenario.bind_pdf",
                "payload": {
                    "campaign_id": request["campaign_id"],
                    "scenario_id": task["scenario_id"],
                    "title": task["title"],
                    "source_bundle_path": task["source_bundle_path"],
                },
            },
        )
        if bind.get("status") != "PASS":
            _fail("canonical opening source bind failed")
        current = _json(
            workspace / ".coc" / "campaigns" / request["campaign_id"]
            / "scenario" / "scenario.json",
            "rebound campaign scenario",
        )
        exact = ops._validate_opening_review_task(
            current, expected_status="pending",
        )
        rebound_source = _object(current.get("source"), "rebound source")
        if (
            exact["generation"] != request["opening_review_generation"] + 1
            or exact["campaign_id"] != request["campaign_id"]
            or exact["scenario_id"] != task["scenario_id"]
            or exact["source_bundle_path"] != task["source_bundle_path"]
            or exact["source_id"] != task["source"]["source_id"]
            or exact["source_file_sha256"] != task["source"]["file_sha256"]
            or exact["allowed_pdf_indices"] != selected
            or rebound_source.get("path") != task["source"]["path"]
            or rebound_source.get("bundle_sha256")
            != exact["source_bundle_sha256"]
        ):
            _fail("rebound opening review authority drift")
        continuation = {
            "schema_version": 1,
            "contract_id": "coc.opening-source-continue.v1",
            "campaign_id": exact["campaign_id"],
            "scenario_id": exact["scenario_id"],
            "selected_opening_pdf_indices": selected,
            "source_bundle_id": exact["source_bundle_id"],
            "source_bundle_path": exact["source_bundle_path"],
            "result_delivery": "task_return_to_parent",
        }
        fulfillment = ops._build_opening_source_review_fulfillment(
            workspace,
            continuation=continuation,
            status="reviewed",
            selected_opening_pdf_indices=selected,
        )
        ops._apply_opening_source_review_fulfillment(workspace, fulfillment)
        return _opening_receipt(
            request, exact["scenario_id"], exact["generation"],
            "reviewed", None,
        )


def _run() -> dict[str, Any]:
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        _fail("task exceeds input limit")
    task = _validate_task(json.loads(raw.decode()))
    workspace = Path(task["workspace_root"]).resolve()
    if not workspace.is_dir():
        _fail("workspace_root is unavailable")
    return _run_pi(
        _locator_prompt(task), workspace, timeout=240,
    )


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
        RuntimeError, OSError, ValueError, subprocess.SubprocessError,
    ) as exc:
        print(f"coc-pdf-skill-adapter: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
