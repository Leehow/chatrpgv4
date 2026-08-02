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
MCP_OPERATION_CONTRACTS = (
    PLUGIN_ROOT / "references" / "mcp-operation-contracts.json"
)
PI_MODEL = "xai/grok-4.5"
PI_THINKING = "low"
PI_TOOLS = "read,bash,write"
MAX_FACT_EVIDENCE_PAGES = 8
OPENING_FACT_VALUE_LIMITS = {
    "era": 128,
    "place": 256,
    "investigator_hook": 512,
    "investigator_constraints": 512,
    "player_safe_summary": 768,
}


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
        "source_bundle_path", "asset_root_id",
    ):
        if not isinstance(task.get(key), str) or not task[key].strip():
            _fail(f"task.{key} required")
    cached = task.get("cached_pdf_indices")
    if (
        not isinstance(cached, list)
        or any(
            isinstance(index, bool) or not isinstance(index, int) or index < 0
            for index in cached
        )
        or cached != sorted(set(cached))
    ):
        _fail("task.cached_pdf_indices must be unique ascending non-negative "
              "page indices")
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


def _run_pi(
    prompt: str,
    cwd: Path,
    *,
    timeout: int,
    allow_non_json_receipt: bool = False,
) -> dict[str, Any] | None:
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
        try:
            parsed = json.loads(payload)
        except json.JSONDecodeError:
            if allow_non_json_receipt:
                return None
            raise
        if not isinstance(parsed, dict):
            if allow_non_json_receipt:
                return None
            return _object(parsed, "Pi PDF receipt")
        return parsed
    finally:
        if process is not None and process.poll() is None:
            _terminate_process_group(process)
        for signum, handler in handlers.items():
            signal.signal(signum, handler)


def _locator_prompt(task: dict[str, Any]) -> str:
    return (
        "Use the loaded PDF skill. You are only a document producer, never a "
        "Keeper. Locate the exact target in task.source.path and select the "
        "smallest 1..3 page window that covers it. task.cached_pdf_indices are "
        "pages already accepted in the module cache: never render, transcribe, "
        "or rewrite them. Render and visually inspect every page the scope "
        "needs, and write a standard codex-pdf-skill source "
        "bundle at task.source_bundle_path containing exactly the selected "
        "pages. Do not use OCR, read campaign saves/transcripts, call "
        "gameplay tools, or edit anything outside that bundle. Return only "
        "strict JSON with exact fields schema_version, contract_id, job_id, "
        "status, kind, target_id, pdf_indices, "
        "source_bundle_path, failure_class and contract_id "
        "coc.pi-source-scope-locator-producer-result.v1. pdf_indices is the "
        "full selected scope. status is located, not_located, or failed; for "
        "not_located "
        "the index array is empty, source_bundle_path is null and "
        "failure_class is null; for failed the index array is empty, "
        "source_bundle_path is null and failure_class is non-empty. Never "
        "invent content that you did not see."
        + json.dumps(task, ensure_ascii=False, separators=(",", ":"))
    )


def _runtime_modules() -> tuple[Any, Any, Any, Any]:
    scripts = PLUGIN_ROOT / "scripts"
    if str(scripts) not in sys.path:
        sys.path.insert(0, str(scripts))
    import coc_fileio  # type: ignore[import-not-found]
    import coc_module_assets  # type: ignore[import-not-found]
    import coc_pdf_bundle  # type: ignore[import-not-found]
    import coc_runtime_ops  # type: ignore[import-not-found]
    return coc_fileio, coc_pdf_bundle, coc_runtime_ops, coc_module_assets


def _locator_receipt(
    task: dict[str, Any], producer_result: dict[str, Any] | None,
) -> dict[str, Any]:
    """Derive the transport receipt from the validated bundle and the
    producer's declared scope, not from LLM prose.

    The adapter verifies the bundle contains exactly the selected pages and
    that none of them was already accepted in the module cache (an accepted
    page must never be re-rendered).
    """
    workspace = Path(task["workspace_root"]).resolve()
    if not isinstance(producer_result, dict):
        _fail("locator producer result is unavailable")
    result = producer_result
    if set(result) != {
        "schema_version", "contract_id", "job_id", "status", "kind",
        "target_id", "pdf_indices",
        "source_bundle_path", "failure_class",
    }:
        _fail("locator producer result fields mismatch")
    if (
        result.get("schema_version") != 1
        or result.get("contract_id")
        != "coc.pi-source-scope-locator-producer-result.v1"
        or result.get("job_id") != task["job_id"]
        or result.get("kind") != task["kind"]
        or result.get("target_id") != task["target_id"]
    ):
        _fail("locator producer result binding drift")
    status = result.get("status")
    if status not in {"located", "not_located", "failed"}:
        _fail("locator producer result status invalid")
    indices = result.get("pdf_indices")
    if (
        not isinstance(indices, list)
        or not 1 <= len(indices) <= task["max_selected_pages"]
        or any(
            not isinstance(index, int) or isinstance(index, bool) or index < 0
            for index in indices
        )
        or indices != sorted(set(indices))
    ):
        _fail("locator producer result pdf_indices invalid")
    if status != "located":
        if (
            indices
            or result.get("source_bundle_path") is not None
        ):
            _fail("non-located locator producer result is invalid")
        failure_class = result.get("failure_class")
        if status == "not_located":
            if failure_class is not None:
                _fail("not_located result must carry a null failure_class")
        elif not isinstance(failure_class, str) or not failure_class.strip():
            _fail("failed result must carry a non-empty failure_class")
        return {
            "schema_version": 1,
            "contract_id": "coc.pi-source-scope-locator-producer-result.v1",
            "job_id": task["job_id"],
            "status": status,
            "kind": task["kind"],
            "target_id": task["target_id"],
            "pdf_indices": [],
            "source_bundle_path": None,
            "failure_class": failure_class,
        }
    if result.get("source_bundle_path") != task["source_bundle_path"]:
        _fail("located result source_bundle_path drift")
    if result.get("failure_class") is not None:
        _fail("located result must carry a null failure_class")
    _, pdf_bundle, _, assets = _runtime_modules()
    cache_root = task["asset_root_id"]
    accepted = set(
        assets.accepted_cached_pdf_indices(workspace, cache_root)
    )
    if any(index in accepted for index in indices):
        _fail("rendered pdf_index is already accepted in the module cache; "
              "reference it instead of re-rendering")
    bundle_indices: list[int] = []
    bundle_path = Path(task["source_bundle_path"]).resolve()
    if (bundle_path / "manifest.json").is_file():
        bundle = pdf_bundle.load_host_bundle(task["source_bundle_path"])
        source = _object(bundle.get("source"), "located bundle source")
        if (
            source.get("source_id") != task["source"]["source_id"]
            or source.get("path") != task["source"]["path"]
            or source.get("file_sha256") != task["source"]["file_sha256"]
        ):
            _fail("located source bundle identity drift")
        bundle_indices = [
            int(page["pdf_index"]) for page in bundle.get("pages", [])
        ]
    if bundle_indices != indices:
        _fail("located source bundle page scope is invalid; every selected "
              "page must be included exactly once in the bundle")
    return {
        "schema_version": 1,
        "contract_id": "coc.pi-source-scope-locator-producer-result.v1",
        "job_id": task["job_id"],
        "status": "located",
        "kind": task["kind"],
        "target_id": task["target_id"],
        "pdf_indices": list(indices),
        "source_bundle_path": task["source_bundle_path"],
        "failure_class": None,
    }


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


def _copy_validated_bundle_file(
    source_root: Path,
    output_root: Path,
    relative: str,
) -> None:
    source = (source_root / relative).resolve()
    target = (output_root / relative).resolve()
    if (
        not source.is_relative_to(source_root)
        or not target.is_relative_to(output_root)
        or not source.is_file()
    ):
        _fail("reusable bound source file is invalid")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)


def _preseed_reusable_bound_source(
    output: Path,
    private: dict[str, Any],
    pdf_bundle: Any,
) -> dict[str, Any]:
    bound = pdf_bundle.load_host_bundle(private["source_bundle_path"])
    if (
        bound["bundle_sha256"] != private["source_bundle_sha256"]
        or bound["source"]["source_id"] != private["source_id"]
        or bound["source"]["file_sha256"] != private["source_file_sha256"]
        or [row["pdf_index"] for row in bound["pages"]]
        != private["allowed_pdf_indices"]
    ):
        _fail("reusable bound source authority drift")
    source_root = Path(bound["source"]["source_bundle_path"]).resolve()
    manifest = _json(source_root / "manifest.json", "bound source manifest")
    raw_pages = manifest.get("pages")
    raw_assets = manifest.get("assets", [])
    if not isinstance(raw_pages, list) or not isinstance(raw_assets, list):
        _fail("reusable bound source manifest is invalid")
    for page in bound["pages"]:
        _copy_validated_bundle_file(
            source_root, output, str(page["markdown_path"]),
        )
        structured = page.get("structured_data")
        if isinstance(structured, dict):
            _copy_validated_bundle_file(
                source_root, output, str(structured["path"]),
            )
    for asset in bound["assets"]:
        _copy_validated_bundle_file(
            source_root, output, str(asset["path"]),
        )
    _copy_validated_bundle_file(
        source_root, output, "manifest.json",
    )
    return {
        "source_bundle_path": str(source_root),
        "bundle_sha256": bound["bundle_sha256"],
        "manifest": manifest,
        "normalized_pages": [
            _reusable_page_row(page) for page in bound["pages"]
        ],
    }


def _opening_producer_task(
    workspace: Path,
    request: dict[str, Any],
    scenario: dict[str, Any],
    campaign: dict[str, Any],
    private: dict[str, Any],
    pdf_bundle: Any,
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
    reusable_bound_source = _preseed_reusable_bound_source(
        output, private, pdf_bundle,
    )
    task = {
        "schema_version": 1,
        "contract_id": "coc.pi-opening-pdf-producer-task.v1",
        "workspace_root": str(workspace),
        "campaign_id": request["campaign_id"],
        "scenario_id": private["scenario_id"],
        "title": scenario.get("title"),
        "play_language": campaign.get("play_language") or "zh-Hans",
        "source": {
            "path": str(Path(str(source.get("path") or "")).resolve()),
            "source_id": private["source_id"],
            "file_sha256": private["source_file_sha256"],
        },
        "opening_locator_pdf_indices": private["allowed_pdf_indices"],
        "max_selected_opening_pages": 3,
        "max_fact_evidence_pages": MAX_FACT_EVIDENCE_PAGES,
        "source_bundle_path": str(output),
        "source_bundle_manifest_contract": _opening_manifest_contract(),
        "opening_fast_facts_schema": _opening_fast_facts_schema(),
        "reusable_bound_source": reusable_bound_source,
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


def _opening_fast_facts_schema() -> dict[str, Any]:
    archive = _json(MCP_OPERATION_CONTRACTS, "MCP operation contracts")
    operations = _object(archive.get("operations"), "MCP operations")
    operation = _object(
        operations.get("setup.adopt_source_facts"),
        "setup.adopt_source_facts contract",
    )
    input_schema = _object(operation.get("inputSchema"), "facts input schema")
    properties = _object(input_schema.get("properties"), "facts input properties")
    return json.loads(json.dumps(
        _object(properties.get("facts"), "opening facts schema")
    ))


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
        "unsupported and will be rejected. The output is preseeded from "
        "task.reusable_bound_source; that retained source path is read-only. "
        "If the selected window overlaps one of those manifest pages, keep "
        "that exact markdown_path, Markdown bytes, and complete page evidence "
        "row; do not retranscribe, rewrite, or alter the retained source. "
        "Separately select the smallest fact-evidence set from cover, front "
        "matter, or Keeper background needed for the six opening facts. It may "
        "be non-contiguous, is bounded by task.max_fact_evidence_pages, and "
        "must not widen or alter the contiguous playable opening window. New "
        "selected pages may be added normally. Final manifest.pages must equal "
        "the union of selected_opening_pdf_indices and "
        "fact_evidence_pdf_indices exactly; unselected preseed files may remain "
        "unreferenced. manifest.source.source_id, "
        "path, and file_sha256 must exactly match task.source; "
        "manifest.source.title must exactly match task.title. "
        "Do not use OCR. Do not read .coc, saves, "
        "transcripts, AGENTS.md, or repository source. Do not call gameplay "
        "tools or write outside source_bundle_path. Return only one strict JSON "
        "object with exact fields schema_version, contract_id, status, "
        "campaign_id, scenario_id, selected_opening_pdf_indices, "
        "fact_evidence_pdf_indices, source_bundle_path, failure_class, facts. "
        "contract_id is "
        "coc.pi-opening-pdf-producer-result.v1; status is reviewed or failed. "
        "For reviewed, indices are unique ascending contiguous and failure_class "
        "is null. facts must exactly satisfy task.opening_fast_facts_schema: "
        "answer all six questions only from fact_evidence_pdf_indices; "
        "source answers use minimal {source_id,pdf_index} source_refs and "
        "unresolved answers use minimal inspected_source_refs for pages actually "
        "checked. Never use a campaign era, default era, title hint, or task "
        "placeholder as evidence. Return concise values only: no source text, "
        "excerpts, manifest body, or reasoning. For failed, both index arrays "
        "are empty, source_bundle_path=null, failure_class is non-empty, and "
        "facts=null.\n"
        + json.dumps(task, ensure_ascii=False, separators=(",", ":"))
    )


_OPENING_FACT_QUESTIONS = {
    "era": "string",
    "place": "string",
    "investigator_hook": "string",
    "investigator_constraints": "string",
    "player_safe_summary": "string",
    "content_flags": "list",
}


def _validate_opening_facts(
    value: Any,
    *,
    source_id: str,
    selected_pdf_indices: list[int],
) -> dict[str, Any]:
    facts = _object(value, "opening fast facts")
    expected = {"schema_version", "contract_id", *_OPENING_FACT_QUESTIONS}
    if (
        set(facts) != expected
        or facts.get("schema_version") != 1
        or facts.get("contract_id") != "coc.opening-fast-facts.v1"
    ):
        _fail("opening fast facts contract invalid")
    selected = set(selected_pdf_indices)
    validated = {
        "schema_version": 1,
        "contract_id": "coc.opening-fast-facts.v1",
    }
    for name, value_kind in _OPENING_FACT_QUESTIONS.items():
        answer = _object(facts.get(name), f"opening fact {name}")
        status = answer.get("status")
        if status == "source":
            if set(answer) != {"status", "value", "source_refs"}:
                _fail(f"opening fact {name} source shape invalid")
            raw_value = answer.get("value")
            if value_kind == "list":
                if (
                    not isinstance(raw_value, list)
                    or not raw_value
                    or len(raw_value) > 16
                    or any(
                        not isinstance(item, str)
                        or not item.strip()
                        or len(item) > 128
                        for item in raw_value
                    )
                    or len(raw_value) != len(set(raw_value))
                ):
                    _fail(f"opening fact {name} value invalid")
                normalized_value: Any = [item.strip() for item in raw_value]
            else:
                if (
                    not isinstance(raw_value, str)
                    or not raw_value.strip()
                    or len(raw_value) > OPENING_FACT_VALUE_LIMITS[name]
                ):
                    _fail(f"opening fact {name} value invalid")
                normalized_value = raw_value.strip()
            refs_key = "source_refs"
        elif status == "unresolved":
            if set(answer) != {"status", "inspected_source_refs"}:
                _fail(f"opening fact {name} unresolved shape invalid")
            normalized_value = None
            refs_key = "inspected_source_refs"
        else:
            _fail(f"opening fact {name} status invalid")
        refs = answer.get(refs_key)
        if not isinstance(refs, list) or not refs or len(refs) > 3:
            _fail(f"opening fact {name} refs invalid")
        canonical_refs = []
        seen: set[tuple[str, int]] = set()
        for ref in refs:
            if (
                not isinstance(ref, dict)
                or set(ref) != {"source_id", "pdf_index"}
                or ref.get("source_id") != source_id
                or len(str(ref.get("source_id") or "")) > 256
                or not isinstance(ref.get("pdf_index"), int)
                or isinstance(ref.get("pdf_index"), bool)
                or ref["pdf_index"] not in selected
            ):
                _fail(f"opening fact {name} ref outside final reviewed bundle")
            key = (ref["source_id"], ref["pdf_index"])
            if key in seen:
                _fail(f"opening fact {name} duplicate ref")
            seen.add(key)
            canonical_refs.append(dict(ref))
        validated_answer = {"status": status, refs_key: canonical_refs}
        if status == "source":
            validated_answer["value"] = normalized_value
            validated_answer = {
                "status": status,
                "value": normalized_value,
                refs_key: canonical_refs,
            }
        validated[name] = validated_answer
    return validated


def _validate_opening_result(
    value: Any, task: dict[str, Any],
) -> dict[str, Any]:
    result = _object(value, "opening PDF producer result")
    indices = result.get("selected_opening_pdf_indices")
    fact_indices = result.get("fact_evidence_pdf_indices")
    if (
        set(result) != {
            "schema_version", "contract_id", "status", "campaign_id",
            "scenario_id", "selected_opening_pdf_indices",
            "fact_evidence_pdf_indices", "source_bundle_path",
            "failure_class", "facts",
        }
        or result.get("schema_version") != 1
        or result.get("contract_id")
        != "coc.pi-opening-pdf-producer-result.v1"
        or result.get("campaign_id") != task["campaign_id"]
        or result.get("scenario_id") != task["scenario_id"]
        or result.get("status") not in {"reviewed", "failed"}
        or not isinstance(indices, list)
        or not isinstance(fact_indices, list)
        or any(
            not isinstance(index, int) or isinstance(index, bool) or index < 0
            for index in indices
        )
        or indices != sorted(set(indices))
        or any(
            not isinstance(index, int) or isinstance(index, bool) or index < 0
            for index in fact_indices
        )
        or fact_indices != sorted(set(fact_indices))
    ):
        _fail("opening PDF producer result invalid")
    if result["status"] == "reviewed":
        if (
            not 1 <= len(indices) <= 3
            or indices != list(range(indices[0], indices[0] + len(indices)))
            or not 1 <= len(fact_indices) <= MAX_FACT_EVIDENCE_PAGES
            or result.get("source_bundle_path") != task["source_bundle_path"]
            or result.get("failure_class") is not None
        ):
            _fail("reviewed opening PDF producer result invalid")
        result = dict(result)
        result["facts"] = _validate_opening_facts(
            result.get("facts"),
            source_id=str(task["source"]["source_id"]),
            selected_pdf_indices=fact_indices,
        )
    elif (
        indices
        or fact_indices
        or result.get("source_bundle_path") is not None
        or not isinstance(result.get("failure_class"), str)
        or not result["failure_class"].strip()
        or result.get("facts") is not None
    ):
        _fail("failed opening PDF producer result invalid")
    return result


def _reusable_page_row(page: dict[str, Any]) -> dict[str, Any]:
    row = {
        "pdf_index": page["pdf_index"],
        "markdown_path": page["markdown_path"],
        "text_sha256": page.get(
            "producer_text_sha256", page.get("text_sha256"),
        ),
        "review_state": page["review_state"],
        "parse_confidence": page["parse_confidence"],
        # grep_anchors are set-semantic review evidence: the bundle identity
        # digest (_canonical_digest) and the module cache canonicalization
        # both normalize them to sorted(set(...)), so the reusable-page
        # rows must use that same canonical form. Anchor ordering (and
        # duplicates of an already-present anchor) carry no meaning; a
        # different anchor membership still fails the drift check.
        "grep_anchors": sorted(set(page["grep_anchors"])),
    }
    for key in ("printed_page", "printed_label", "ocr_revision"):
        if key in page:
            row[key] = page[key]
    structured = page.get("structured_data")
    if isinstance(structured, dict):
        row["structured_data"] = {
            key: structured[key]
            for key in ("path", "sha256", "format", "producer", "model")
        }
    return row


def _validate_reused_bound_pages(
    bundle: dict[str, Any],
    final_manifest: dict[str, Any],
    task: dict[str, Any],
) -> None:
    reusable = _object(
        task.get("reusable_bound_source"),
        "reusable bound source",
    )
    manifest = _object(
        reusable.get("manifest"),
        "reusable bound source manifest",
    )
    retained_raw_pages = manifest.get("pages")
    final_raw_pages = final_manifest.get("pages")
    normalized_pages = reusable.get("normalized_pages")
    if (
        not isinstance(retained_raw_pages, list)
        or not isinstance(final_raw_pages, list)
        or not isinstance(normalized_pages, list)
    ):
        _fail("reusable bound source pages are invalid")
    retained_raw = {
        int(row["pdf_index"]): row
        for row in retained_raw_pages
        if isinstance(row, dict)
        and isinstance(row.get("pdf_index"), int)
        and not isinstance(row.get("pdf_index"), bool)
    }
    final_raw = {
        int(row["pdf_index"]): row
        for row in final_raw_pages
        if isinstance(row, dict)
        and isinstance(row.get("pdf_index"), int)
        and not isinstance(row.get("pdf_index"), bool)
    }
    retained_normalized = {
        int(row["pdf_index"]): row
        for row in normalized_pages
        if isinstance(row, dict)
        and isinstance(row.get("pdf_index"), int)
        and not isinstance(row.get("pdf_index"), bool)
    }
    if (
        len(retained_raw) != len(retained_raw_pages)
        or len(final_raw) != len(final_raw_pages)
        or len(retained_normalized) != len(normalized_pages)
    ):
        _fail("reusable bound source pages are invalid")

    def _raw_page_for_reuse_equality(row: dict[str, Any]) -> dict[str, Any]:
        canonical = dict(row)
        # The bundle validator canonically accepts both spellings for a page
        # with no assets. Normalize only that empty optional field here; a
        # non-empty assets declaration and every other raw field remain exact.
        if canonical.get("assets") == []:
            canonical.pop("assets")
        # grep_anchors are set-semantic review evidence (the bundle identity
        # digest and module cache canonicalization both normalize them to
        # sorted(set(...))). Normalize before the raw comparison so a
        # producer that copied page evidence from the module cache (sorted)
        # matches the retained bundle (original order); a genuinely different
        # anchor set still fails.
        anchors = canonical.get("grep_anchors")
        if isinstance(anchors, list):
            canonical["grep_anchors"] = sorted(set(anchors))
        return canonical

    for page in bundle["pages"]:
        pdf_index = int(page["pdf_index"])
        if pdf_index not in retained_raw:
            continue
        if (
            not isinstance(final_raw.get(pdf_index), dict)
            or _raw_page_for_reuse_equality(final_raw[pdf_index])
            != _raw_page_for_reuse_equality(retained_raw[pdf_index])
            or _reusable_page_row(page) != retained_normalized.get(pdf_index)
        ):
            _fail(f"reusable bound page {pdf_index} drift")


def _opening_receipt(
    request: dict[str, Any],
    scenario_id: str,
    generation: int,
    status: str,
    failure: str | None,
    facts: dict[str, Any] | None,
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "contract_id": "coc.pi-opening-source-review-transport-result.v1",
        "status": status,
        "campaign_id": request["campaign_id"],
        "scenario_id": scenario_id,
        "opening_review_generation": generation,
        "failure_class": failure,
        "facts": facts,
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
    fileio, pdf_bundle, ops, _assets = _runtime_modules()
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
            workspace, request, scenario, campaign, private, pdf_bundle,
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
                "failed", result["failure_class"], None,
            )
        bundle = pdf_bundle.load_host_bundle(task["source_bundle_path"])
        final_manifest = _json(
            Path(task["source_bundle_path"]) / "manifest.json",
            "opening source manifest",
        )
        selected = result["selected_opening_pdf_indices"]
        fact_evidence = result["fact_evidence_pdf_indices"]
        bundle_indices = sorted(set(selected) | set(fact_evidence))
        if (
            [row["pdf_index"] for row in bundle["pages"]] != bundle_indices
            or bundle["source"]["source_id"] != private["source_id"]
            or bundle["source"]["path"] != task["source"]["path"]
            or bundle["source"]["file_sha256"]
            != private["source_file_sha256"]
            or bundle["source"]["title"] != task["title"]
        ):
            _fail("opening source bundle identity drift")
        _validate_reused_bound_pages(bundle, final_manifest, task)
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
            or exact["allowed_pdf_indices"] != bundle_indices
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
        ops._apply_opening_source_review_fulfillment(
            workspace,
            fulfillment,
            source_facts=result["facts"],
        )
        return _opening_receipt(
            request, exact["scenario_id"], exact["generation"],
            "reviewed", None, result["facts"],
        )


def _validate_full_parse_task(value: Any) -> dict[str, Any]:
    task = _object(value, "full-parse render task")
    if (
        task.get("schema_version") != 1
        or task.get("contract_id") != "coc.pi-full-parse-render-task.v1"
    ):
        _fail("full-parse render task contract mismatch")
    for key in (
        "workspace_root", "campaign_id", "asset_root_id", "job_id",
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
    page_count = task.get("page_count")
    if isinstance(page_count, bool) or not isinstance(page_count, int) or page_count < 1:
        _fail("task.page_count must be a positive integer")
    batch_limit = task.get("batch_limit")
    if isinstance(batch_limit, bool) or not isinstance(batch_limit, int) or not 1 <= batch_limit <= 32:
        _fail("task.batch_limit must be an integer from 1 through 32")

    def _unique_ascending_indices(value: Any, field: str) -> list[int]:
        if (
            not isinstance(value, list)
            or any(
                isinstance(index, bool) or not isinstance(index, int)
                or not 0 <= index < page_count
                for index in value
            )
        ):
            _fail(f"task.{field} must be unique ascending page indices")
        return sorted(set(value))

    requested = _unique_ascending_indices(
        task.get("requested_pdf_indices"), "requested_pdf_indices",
    )
    if requested != list(range(page_count)):
        _fail("task.requested_pdf_indices must be the complete page range")
    cached = _unique_ascending_indices(
        task.get("cached_pdf_indices"), "cached_pdf_indices",
    )
    if not set(cached).issubset(set(requested)):
        _fail("task.cached_pdf_indices must stay inside the request scope")
    workspace = Path(task["workspace_root"]).resolve()
    bundle_root = (workspace / ".tmp" / "coc-full-parse").resolve()
    bundle_path = Path(task["source_bundle_path"]).resolve()
    if (
        not workspace.is_dir()
        or not bundle_path.is_relative_to(bundle_root)
    ):
        _fail("task source_bundle_path escapes the full-parse root")
    manifest_contract = _object(
        task.get("source_bundle_manifest_contract"),
        "full-parse manifest contract",
    )
    if manifest_contract.get("schema_version") != 1:
        _fail("full-parse manifest contract mismatch")
    for op in ("register_operation", "fulfill_operation"):
        operation = _object(task.get(op), f"task.{op}")
        if not isinstance(operation.get("operation"), str) or not operation[
            "operation"
        ].strip():
            _fail(f"task.{op}.operation required")
    return task


_FULL_PARSE_PROMPT = (
    "Use the loaded PDF skill. You are one isolated document producer, never "
    "a Keeper. Render every page in task.missing_pdf_indices from "
    "task.source.path as UTF-8 Markdown, one page per manifest row, and write "
    "exactly the canonical schema-v1 bundle defined by "
    "task.source_bundle_manifest_contract at task.source_bundle_path. "
    "manifest.source.source_id, path, file_sha256, and page_count must exactly "
    "match task.source and task.page_count; manifest.source.title must exactly "
    "match task.source.title. Do not render, transcribe, or rewrite any page "
    "in task.cached_pdf_indices. Do not use OCR, read .coc, campaign saves, "
    "transcripts, AGENTS.md, or repository source; do not call gameplay tools "
    "or write outside task.source_bundle_path. Return only one strict JSON "
    "object with exact fields schema_version, contract_id, status, "
    "rendered_pdf_indices, failure_class, source_bundle_path. contract_id is "
    "coc.pi-full-parse-render-producer-result.v1; status is reviewed or failed. "
    "For reviewed, rendered_pdf_indices lists every page you actually rendered "
    "(ascending, unique, all inside task.missing_pdf_indices), failure_class "
    "is null, and manifest.pages exactly covers those indices. For failed, "
    "rendered_pdf_indices is empty, source_bundle_path=null, and "
    "failure_class is non-empty. Never invent content that you did not see.\n"
)


def _run_full_parse_batch() -> dict[str, Any]:
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        _fail("full-parse render task exceeds input limit")
    task = _validate_full_parse_task(json.loads(raw.decode()))
    workspace = Path(task["workspace_root"]).resolve()
    if not workspace.is_dir():
        _fail("workspace_root is unavailable")
    requested = set(int(index) for index in task["requested_pdf_indices"])
    cached = set(int(index) for index in task["cached_pdf_indices"])
    missing = sorted(requested - cached)
    if not missing:
        return {
            "schema_version": 1,
            "contract_id": "coc.source-pack-worker.v1",
            "packet_id": f"full-parse:{task['job_id']}",
            "work_group_id": f"source-work-full-{task['asset_root_id']}",
            "status": "usable",
            "results": [{
                "job_id": task["job_id"],
                "pack": {
                    "status": "complete",
                    "rendered_pdf_indices": sorted(requested),
                    "failed_pdf_indices": [],
                    "failure_class": None,
                },
                "related_packs": [],
            }],
        }
    batch = missing[: int(task["batch_limit"])]
    output = Path(task["source_bundle_path"]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    producer_prompt = _FULL_PARSE_PROMPT + json.dumps({
        **task,
        "missing_pdf_indices": batch,
    }, ensure_ascii=False, separators=(",", ":"))
    producer = _run_pi(producer_prompt, workspace, timeout=PI_TIMEOUT_SECONDS)
    if not isinstance(producer, dict):
        _fail("full-parse render producer result is unavailable")
    if (
        set(producer) != {
            "schema_version", "contract_id", "status", "rendered_pdf_indices",
            "failure_class", "source_bundle_path",
        }
        or producer.get("schema_version") != 1
        or producer.get("contract_id")
        != "coc.pi-full-parse-render-producer-result.v1"
        or producer.get("status") not in {"reviewed", "failed"}
    ):
        _fail("full-parse render producer result invalid")
    if producer["status"] == "failed":
        failure_class = producer.get("failure_class")
        if not isinstance(failure_class, str) or not failure_class.strip():
            _fail("failed render producer result must carry failure_class")
        return {
            "schema_version": 1,
            "contract_id": "coc.source-pack-worker.v1",
            "packet_id": f"full-parse:{task['job_id']}",
            "work_group_id": f"source-work-full-{task['asset_root_id']}",
            "status": "usable",
            "results": [{
                "job_id": task["job_id"],
                "pack": {
                    "status": "failed",
                    "failure_class": str(failure_class)[:256],
                },
                "related_packs": [],
            }],
        }
    rendered = producer.get("rendered_pdf_indices")
    if (
        not isinstance(rendered, list)
        or not rendered
        or any(
            isinstance(index, bool) or not isinstance(index, int)
            for index in rendered
        )
        or rendered != sorted(set(rendered))
        or not set(rendered).issubset(set(batch))
        or producer.get("source_bundle_path") != task["source_bundle_path"]
        or producer.get("failure_class") is not None
    ):
        _fail("reviewed full-parse render producer result invalid")
    _, pdf_bundle, _, assets = _runtime_modules()
    bundle = pdf_bundle.load_host_bundle(output)
    if (
        bundle["source"]["source_id"] != task["source"]["source_id"]
        or bundle["source"]["path"] != task["source"]["path"]
        or bundle["source"]["file_sha256"] != task["source"]["file_sha256"]
        or bundle["source"]["page_count"] != int(task["page_count"])
        or [row["pdf_index"] for row in bundle["pages"]] != rendered
    ):
        _fail("full-parse bundle identity or page scope drift")
    assets.register_source_bundle(
        workspace,
        output,
        asset_root_id=str(task["asset_root_id"]),
        record_drift=True,
    )
    state = assets.read_full_parse_state(
        workspace, str(task["asset_root_id"]),
    )
    return {
        "schema_version": 1,
        "contract_id": "coc.source-pack-worker.v1",
        "packet_id": f"full-parse:{task['job_id']}",
        "work_group_id": f"source-work-full-{task['asset_root_id']}",
        "status": "usable",
        "results": [{
            "job_id": task["job_id"],
            "pack": {
                "status": "complete" if state.get("complete") else "partial",
                "rendered_pdf_indices": list(rendered),
                "failed_pdf_indices": [],
                "failure_class": None,
            },
            "related_packs": [],
        }],
    }


def _run() -> dict[str, Any]:
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        _fail("task exceeds input limit")
    task = _validate_task(json.loads(raw.decode()))
    workspace = Path(task["workspace_root"]).resolve()
    if not workspace.is_dir():
        _fail("workspace_root is unavailable")
    producer_result = _run_pi(
        _locator_prompt(task), workspace, timeout=240,
        allow_non_json_receipt=True,
    )
    return _locator_receipt(task, producer_result)


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
        elif sys.argv[1:] == ["--run-full-parse-batch"]:
            value = _run_full_parse_batch()
        else:
            _fail(
                "expected --capabilities, --run, "
                "--opening-review-capabilities, --run-opening-review, "
                "or --run-full-parse-batch"
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
