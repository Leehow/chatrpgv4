#!/usr/bin/env python3
"""Thin Pi transport for the external PDF skill.

The child is one isolated Grok coding turn. It may render/read the PDF and
write one reviewed source bundle. This trusted adapter validates that bundle,
binds it through the canonical setup operation, and consumes the exact new
private opening-review task. It contains no PDF parser or OCR fallback.
"""
from __future__ import annotations

import errno
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
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
# The caller owns the real deadline; the inner producer must finish inside it
# with room to validate and write back.  A fixed inner budget larger than the
# caller's is unreachable, and one smaller silently wastes the difference --
# the opening review used to cap its producer at 900s inside a 1200s transport
# and failed every time on a book the producer needed longer than 15 minutes
# to review.
OPENING_REVIEW_WRITEBACK_MARGIN_SECONDS = 120
# Bounded selector slices for the POSIX supervisor (no communicate/poll loop).
SUPERVISE_POLL_SECONDS = 0.25
REAP_GRACE_SECONDS = 0.35
_IO_CHUNK_BYTES = 65_536
PLUGIN_ROOT = Path(__file__).resolve().parents[2]
# Test-only seam: runs after a producer/router child reaps and before receipt
# work so host-abort fail-closed can be asserted without sleep races.
_post_child_hook: Any = None
PDF_INSPECTOR_REQUEST_CONTRACT = "coc.pi-pdf-inspector-request.v1"
PDF_INSPECTOR_RESULT_CONTRACT = "coc.pi-pdf-inspector-result.v1"
PDF_INSPECTOR_MANIFEST_PRODUCER = "codex-pdf-skill"
PDF_INSPECTOR_TIMEOUT_SECONDS = PI_TIMEOUT_SECONDS
OPENING_COORDINATOR_CONTRACT = (
    PLUGIN_ROOT / "references" / "opening-source-coordinator-v1.json"
)
MCP_OPERATION_CONTRACTS = (
    PLUGIN_ROOT / "references" / "mcp-operation-contracts.json"
)
PI_MODEL = "xai/grok-4.5"
# Opening semantic extraction consumes only router-materialized native
# Markdown pages and must never depend on the visual Grok/PDF-skill child.
# The default is a text model; COC_PI_OPENING_MODEL overrides it (Grok stays
# a valid explicit choice for the same text-only job, but it is no longer
# hardwired into the opening review). pi's built-in deepseek catalog ships
# only v4-flash/v4-pro: "deepseek/deepseek-chat" is not resolvable on this
# host and pi routes it to openrouter, which has no configured key
# (real-run evidence: "No API key found for openrouter").
OPENING_TEXT_MODEL = "deepseek/deepseek-v4-flash"
PI_THINKING = "low"
PI_TOOLS = "read,bash,write"
# Opening extraction consumes already-materialized Markdown and must return
# its receipt on stdout. Giving this child `write` caused two real runs to
# save a valid extraction_result.json instead, leaving stdout non-JSON and
# falsely producing extractor_invalid_output.
OPENING_TEXT_TOOLS = "read"
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


# One shared child-env allowlist so every model child sees exactly the same
# bounded surface. Model selection is resolved by the adapter into --model;
# the child itself never needs the override variables. Provider keys pi reads
# from the environment are allowed through so the opening text extractor child
# can use the configured DeepSeek provider (DEEPSEEK_BASE_URL supports a
# custom provider override).
_PI_CHILD_ENV_KEYS = frozenset({
    "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "USER",
    "LOGNAME", "SHELL", "PI_CODING_AGENT_DIR",
    "DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL",
})


def _pi_child_env() -> dict[str, str]:
    return {
        key: value
        for key, value in os.environ.items()
        if key in _PI_CHILD_ENV_KEYS
    }


def _pi_model() -> str:
    """Locator/full-parse PDF-skill child model; env overrides the Grok default."""
    return os.environ.get("COC_PI_PDF_MODEL", "").strip() or PI_MODEL


def _opening_text_model() -> str:
    """Text model for the opening facts + module_init_l0 extraction child.

    The extractor reads only native Markdown pages the router (or the
    locator's bound copy) already materialized, so a vision model is never
    required. Defaults to DeepSeek V4 Flash -- the deepseek provider's
    shipped text model. "deepseek/deepseek-chat" is not in pi's built-in
    deepseek catalog and resolves to unauthenticated openrouter, so it is
    not a usable default on this host. COC_PI_OPENING_MODEL overrides it.
    """
    return os.environ.get("COC_PI_OPENING_MODEL", "").strip() or OPENING_TEXT_MODEL


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


def _pdf_inspector_command() -> str | None:
    """Optional absolute external router. Invalid values are treated as unset."""
    configured = os.environ.get("COC_PI_PDF_INSPECTOR_COMMAND", "").strip()
    if not configured:
        return None
    path = Path(configured).expanduser()
    if not path.is_absolute() or not path.is_file() or not os.access(path, os.X_OK):
        return None
    return str(path)


def _pdf_inspector_request(
    mode: str,
    task: dict[str, Any],
    *,
    missing_pdf_indices: list[int] | None = None,
) -> dict[str, Any]:
    """Project only known task fields into the external inspector request."""
    source = _object(task.get("source"), "task.source")
    request: dict[str, Any] = {
        "schema_version": 1,
        "contract_id": PDF_INSPECTOR_REQUEST_CONTRACT,
        "mode": mode,
        "source": {
            "path": source["path"],
            "source_id": source["source_id"],
            "title": source.get("title") or task.get("title"),
            "file_sha256": source["file_sha256"],
        },
        "source_bundle_path": task["source_bundle_path"],
        "manifest_producer_literal": PDF_INSPECTOR_MANIFEST_PRODUCER,
    }
    for key in (
        "requested_pdf_indices",
        "cached_pdf_indices",
        "page_count",
        "max_pages",
    ):
        if key in task:
            request[key] = task[key]
    if missing_pdf_indices is not None:
        request["missing_pdf_indices"] = list(missing_pdf_indices)
    if mode == "opening_review":
        # The opening producer task carries the locator window plus the bound
        # native pages so the router can select opening/fact pages and write
        # the schema-v1 bundle from already-materialized Markdown.
        for key in (
            "opening_locator_pdf_indices",
            "max_selected_opening_pages",
            "max_fact_evidence_pages",
            "reusable_bound_source",
        ):
            if key in task:
                request[key] = task[key]
        if "opening_locator_pdf_indices" in request:
            request["opening_locator_pdf_indices"] = (
                _earliest_contiguous_page_run(
                    request["opening_locator_pdf_indices"]
                )
            )
    return request


def _earliest_contiguous_page_run(indices: Any) -> list[int]:
    """Return the earliest authored run without crossing skipped image pages.

    Locator bundles may legitimately omit image-only pages that await OCR.  The
    opening slice must itself be contiguous, but that does not make the whole
    locator bundle invalid.  Keep the earliest available run so opening review
    stays near the front of the scenario and never silently jumps across an
    unreviewed image-page gap.
    """
    if not isinstance(indices, list) or not indices:
        _fail("opening locator page scope is empty")
    if any(
        not isinstance(index, int) or isinstance(index, bool) or index < 0
        for index in indices
    ):
        _fail("opening locator page scope is invalid")
    normalized = sorted(set(indices))
    if len(normalized) != len(indices):
        _fail("opening locator page scope is invalid")
    run = [normalized[0]]
    for index in normalized[1:]:
        if index != run[-1] + 1:
            break
        run.append(index)
    return run


def _try_external_pdf_router(
    mode: str,
    task: dict[str, Any],
    *,
    missing_pdf_indices: list[int] | None = None,
    timeout: int = PDF_INSPECTOR_TIMEOUT_SECONDS,
    shutdown: _ShutdownFlag | None = None,
) -> dict[str, Any] | None:
    """Invoke an optional external native PDF router; never parse PDF here.

    Returns a validated adoption payload only when the external command exits 0,
    emits the result contract with status=ok, writes exactly the requested
    source_bundle_path, and that path passes load_host_bundle. Any other
    outcome (unset command, non-zero, timeout, bad JSON, fallback/needs_ocr/
    unsupported/failed, path drift, illegal bundle) returns None so the caller
    can keep the existing Pi PDF-skill path.

    Host abort (shutdown flag / interrupt during the child) raises via _fail and
    must not be turned into Pi fallback. Unset/invalid command takes no
    subprocess.
    """
    command = _pdf_inspector_command()
    if command is None:
        return None
    request = _pdf_inspector_request(
        mode, task, missing_pdf_indices=missing_pdf_indices,
    )
    payload = json.dumps(request, ensure_ascii=False, separators=(",", ":"))
    try:
        completed = _run_session_command(
            [command],
            timeout=timeout,
            input_text=payload,
            shutdown=shutdown,
        )
    except (_SessionLaunchError, subprocess.TimeoutExpired):
        # Typed ordinary launch/timeout only. SupervisorInvariantError and
        # host-abort RuntimeError must never become Pi fallback.
        _fail_if_shutdown(shutdown)
        return None
    if completed.returncode != 0:
        return None
    raw_out = (completed.stdout or "").encode("utf-8", errors="replace")
    if len(raw_out) > MAX_OUTPUT_BYTES:
        return None
    try:
        result = json.loads(raw_out.decode("utf-8"))
    except (UnicodeError, json.JSONDecodeError):
        return None
    if not isinstance(result, dict):
        return None
    if (
        result.get("schema_version") != 1
        or result.get("contract_id") != PDF_INSPECTOR_RESULT_CONTRACT
        or result.get("status") != "ok"
        or result.get("source_bundle_path") != task["source_bundle_path"]
    ):
        return None
    rendered = result.get("rendered_pdf_indices")
    if rendered is not None:
        if (
            not isinstance(rendered, list)
            or any(
                isinstance(index, bool) or not isinstance(index, int) or index < 0
                for index in rendered
            )
            or rendered != sorted(set(rendered))
        ):
            return None
    try:
        _, pdf_bundle, _, _ = _runtime_modules()
        bundle = pdf_bundle.load_host_bundle(task["source_bundle_path"])
    except Exception:
        # Router output is untrusted; illegal or incomplete bundles fall back.
        return None
    bundle_indices = [int(page["pdf_index"]) for page in bundle.get("pages", [])]
    if rendered is None:
        rendered = list(bundle_indices)
    elif rendered != bundle_indices:
        return None
    adopted = {
        "source_bundle_path": task["source_bundle_path"],
        "rendered_pdf_indices": list(rendered),
        "bundle": bundle,
        "reason": result.get("reason"),
    }
    if mode == "opening_review":
        selected = result.get("selected_opening_pdf_indices")
        fact_evidence = result.get("fact_evidence_pdf_indices")
        if (
            not isinstance(selected, list)
            or not isinstance(fact_evidence, list)
            or any(
                isinstance(index, bool) or not isinstance(index, int) or index < 0
                for index in list(selected) + list(fact_evidence)
            )
        ):
            return None
        if (
            not 1 <= len(selected) <= 3
            or selected != sorted(set(selected))
            or selected
            != list(range(selected[0], selected[0] + len(selected)))
            or not 1 <= len(fact_evidence) <= MAX_FACT_EVIDENCE_PAGES
            or fact_evidence != sorted(set(fact_evidence))
            or sorted(set(selected) | set(fact_evidence)) != bundle_indices
        ):
            return None
        adopted["selected_opening_pdf_indices"] = list(selected)
        adopted["fact_evidence_pdf_indices"] = list(fact_evidence)
    return adopted


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
        "capability": "router_materialized_pages_text_extraction",
        "producer_contract_id": "coc.pi-opening-pdf-producer-result.v1",
        "materialization": "external_pdf_router_native_markdown_or_preseed",
        "extraction_model": _opening_text_model(),
        "visual_review": False,
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
    required = {
        "schema_version", "contract_id", "workspace_root", "campaign_id",
        "scenario_id", "opening_review_generation",
    }
    # Optional so an older caller still validates: when the deadline is not
    # supplied the producer keeps its historical fixed budget.
    if not required <= set(task) <= required | {"transport_timeout_seconds"}:
        _fail("opening review transport fields mismatch")
    generation = task.get("opening_review_generation")
    if (
        task.get("schema_version") != 1
        or task.get("contract_id")
        != "coc.pi-opening-source-review-transport.v1"
        or not isinstance(generation, int)
        or isinstance(generation, bool)
        or generation < 1
        or (
            "transport_timeout_seconds" in task
            and (
                not isinstance(task["transport_timeout_seconds"], int)
                or isinstance(task["transport_timeout_seconds"], bool)
                or task["transport_timeout_seconds"] < 1
            )
        )
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
    # Split-layout proof: hosts may keep campaign state outside the code
    # surface (the web bridge / desktop shell use a bare workspace while the
    # plugin lives in the repo/payload root), so the TUI-era assumption
    # "workspace == cwd == code root" no longer holds. State identity is
    # proven by the campaign anchor inside the workspace; code identity is
    # self-derived from this adapter's own installation (PLUGIN_ROOT)
    # instead of trusting the inherited cwd.
    code_root = PLUGIN_ROOT.parents[1]
    if (
        not resolved.is_dir()
        or not (
            resolved
            / ".coc"
            / "campaigns"
            / campaign_id
            / "scenario"
            / "scenario.json"
        ).is_file()
    ):
        _fail("opening review transport workspace drift")
    if (
        not (code_root / "uv.lock").is_file()
        or not (code_root / "plugins" / "coc-keeper").samefile(PLUGIN_ROOT)
    ):
        _fail("opening review transport code-root drift")
    return task


# A failing child's stderr is redacted because a producer that got far enough
# to read the book can echo source text into it.  A *short* stderr cannot: it
# is a launch, usage, or credential error, and it is the only evidence of the
# one failure mode that is otherwise completely undiagnosable from outside.
# Surface those bounded bytes and keep redacting anything long enough to carry
# content.
CHILD_STDERR_SAFE_BYTES = 200


def _child_failure_detail(returncode: int, stderr: str | None) -> str:
    raw = (stderr or "").encode()
    if 0 < len(raw) <= CHILD_STDERR_SAFE_BYTES:
        detail = " ".join(raw.decode("utf-8", errors="replace").split())
        return f"Pi PDF lifecycle failed (exit {returncode}): {detail}"
    return (
        f"Pi PDF lifecycle failed (exit {returncode}); stderr redacted "
        f"({len(raw)} bytes)"
    )


class _ShutdownFlag:
    """Cooperative lane abort. Signal handlers only set requested=True."""

    __slots__ = ("requested",)

    def __init__(self) -> None:
        self.requested = False


class _SessionLaunchError(Exception):
    """Ordinary child launch/exec failure (e.g. missing router binary).

    Typed so `_try_external_pdf_router` may fall back to the Pi skill path.
    Never used for mask/waitid/kill/reap supervisor invariants.
    """


class _SupervisorInvariantError(RuntimeError):
    """POSIX supervisor invariant failure; fail closed, never router-fallback."""


def _invariant_fail(message: str) -> NoReturn:
    raise _SupervisorInvariantError(message)


def _fail_if_shutdown(flag: _ShutdownFlag | None) -> None:
    if flag is not None and flag.requested:
        _fail("Pi lifecycle interrupted by signal")


def _run_post_child_hook() -> None:
    hook = _post_child_hook
    if hook is not None:
        hook()


def _require_posix_supervisor() -> None:
    """Fail closed when the host cannot run the race-free POSIX supervisor."""
    if not hasattr(signal, "pthread_sigmask"):
        _invariant_fail("POSIX supervisor requires signal.pthread_sigmask")
    if not (
        hasattr(os, "waitid")
        and hasattr(os, "WNOWAIT")
        and hasattr(os, "WEXITED")
        and hasattr(os, "WNOHANG")
        and hasattr(os, "P_PID")
    ):
        _invariant_fail("POSIX supervisor requires os.waitid with WNOWAIT")
    if not hasattr(os, "set_blocking"):
        _invariant_fail("POSIX supervisor requires os.set_blocking")


def _format_exc_chain(errors: list[Exception]) -> str:
    return "; ".join(f"{type(e).__name__}: {e}" for e in errors)


def _install_interrupt_handlers(flag: _ShutdownFlag) -> dict[int, Any]:
    """Install flag-only handlers under a blocked TERM/INT mask (transactional).

    Partial success rolls back any handler already replaced. Rollback failures are
    not swallowed: they chain with the original error into an invariant failure.
    Handlers never touch Popen, wait, kill, or raise into the signal frame.
    """
    handlers: dict[int, Any] = {}

    def interrupted(_signum: int, _frame: Any) -> None:
        flag.requested = True

    installed: list[int] = []
    try:
        for signum in (signal.SIGTERM, signal.SIGINT):
            previous = signal.getsignal(signum)
            signal.signal(signum, interrupted)
            handlers[signum] = previous
            installed.append(signum)
    except (OSError, ValueError) as primary:
        rollback_errors: list[Exception] = []
        for signum in reversed(installed):
            try:
                signal.signal(signum, handlers[signum])
            except (OSError, ValueError) as rb_exc:
                rollback_errors.append(rb_exc)
        if rollback_errors:
            raise _SupervisorInvariantError(
                "handler install failed: "
                f"{type(primary).__name__}: {primary}; "
                f"rollback failed: {_format_exc_chain(rollback_errors)}"
            ) from primary
        raise
    return handlers


def _restore_interrupt_handlers(handlers: dict[int, Any]) -> None:
    """Restore prior handlers transactionally; partial failure rolls back.

    Rollback self-failures are not swallowed: they chain with the original
    restore error into an invariant failure.
    """
    applied: list[tuple[int, Any]] = []
    try:
        for signum in (signal.SIGTERM, signal.SIGINT):
            if signum not in handlers:
                continue
            current = signal.getsignal(signum)
            signal.signal(signum, handlers[signum])
            applied.append((signum, current))
    except (OSError, ValueError) as primary:
        rollback_errors: list[Exception] = []
        for signum, previous in reversed(applied):
            try:
                signal.signal(signum, previous)
            except (OSError, ValueError) as rb_exc:
                rollback_errors.append(rb_exc)
        if rollback_errors:
            raise _SupervisorInvariantError(
                "handler restore failed: "
                f"{type(primary).__name__}: {primary}; "
                f"rollback failed: {_format_exc_chain(rollback_errors)}"
            ) from primary
        raise


def _enter_producer_lane(
    flag: _ShutdownFlag,
) -> tuple[dict[int, Any], set[signal.Signals]]:
    """Enter producer lane with atomic handler/mask transition. Fail closed.

    Order: save caller mask → block TERM/INT → install flag handlers under the
    blocked mask (transactional) → unblock to the lane-controllable mask so any
    pending TERM/INT is delivered to the new handlers. Never unblock before the
    handlers are installed.
    """
    _require_posix_supervisor()
    try:
        caller_mask = signal.pthread_sigmask(signal.SIG_BLOCK, set())
    except (OSError, ValueError) as exc:
        _invariant_fail(f"producer lane signal mask save failed: {exc}")
    blocked = False
    handlers: dict[int, Any] | None = None
    try:
        try:
            signal.pthread_sigmask(
                signal.SIG_BLOCK, {signal.SIGTERM, signal.SIGINT},
            )
            blocked = True
        except (OSError, ValueError) as exc:
            _invariant_fail(f"producer lane signal block failed: {exc}")
        try:
            handlers = _install_interrupt_handlers(flag)
        except _SupervisorInvariantError:
            raise
        except (OSError, ValueError) as exc:
            _invariant_fail(f"producer lane handler install failed: {exc}")
        try:
            signal.pthread_sigmask(
                signal.SIG_UNBLOCK, {signal.SIGTERM, signal.SIGINT},
            )
        except (OSError, ValueError) as exc:
            _invariant_fail(f"producer lane signal unblock failed: {exc}")
        return handlers, caller_mask
    except BaseException as primary:
        # Best-effort rollback toward the caller's mask/handlers; never leave
        # the process half-installed if we can still reverse it. Rollback
        # failures chain with the original error — never pretend success.
        rollback_errors: list[Exception] = []
        if handlers is not None:
            try:
                _restore_interrupt_handlers(handlers)
            except (_SupervisorInvariantError, OSError, ValueError) as exc:
                rollback_errors.append(exc)
        if blocked or handlers is not None:
            try:
                signal.pthread_sigmask(signal.SIG_SETMASK, caller_mask)
            except (OSError, ValueError) as exc:
                rollback_errors.append(exc)
        if rollback_errors:
            raise _SupervisorInvariantError(
                f"producer lane enter failed: {type(primary).__name__}: {primary}; "
                f"rollback failed: {_format_exc_chain(rollback_errors)}"
            ) from primary
        raise


def _leave_producer_lane(
    handlers: dict[int, Any],
    caller_mask: set[signal.Signals],
    flag: _ShutdownFlag,
) -> None:
    """Leave producer lane: block → restore handlers → restore caller mask.

    Reverse of enter. Partial failure best-effort rolls back and fail-closes;
    never silently pollutes the caller with a mixed handler pair. If handler
    restore fails transactionally (rolled back to the lane pair), do not retry
    it — retrying can undo the consistent rollback. Mask/handler cleanup errors
    are collected and chained, never swallowed as success.
    """
    errors: list[Exception] = []
    handler_restore_attempted = False

    try:
        signal.pthread_sigmask(
            signal.SIG_BLOCK, {signal.SIGTERM, signal.SIGINT},
        )
    except (OSError, ValueError) as exc:
        errors.append(exc)

    if not errors:
        handler_restore_attempted = True
        try:
            _restore_interrupt_handlers(handlers)
        except _SupervisorInvariantError as exc:
            errors.append(exc)
        except (OSError, ValueError) as exc:
            # Transactional restore already rolled back to the lane pair.
            errors.append(exc)

    if not errors:
        try:
            signal.pthread_sigmask(signal.SIG_SETMASK, caller_mask)
        except (OSError, ValueError) as exc:
            errors.append(exc)
            try:
                signal.pthread_sigmask(signal.SIG_SETMASK, caller_mask)
            except (OSError, ValueError) as retry_exc:
                errors.append(retry_exc)
    elif not handler_restore_attempted:
        # Failed before handler restore (block step). Attempt a full reverse
        # once so a block-only failure does not leak lane handlers forever.
        try:
            _restore_interrupt_handlers(handlers)
        except (_SupervisorInvariantError, OSError, ValueError) as exc:
            errors.append(exc)
        try:
            signal.pthread_sigmask(signal.SIG_SETMASK, caller_mask)
        except (OSError, ValueError) as exc:
            errors.append(exc)
    else:
        # Handler restore was attempted and rolled back to a consistent lane
        # pair. Do not retry restore. Best-effort caller mask; record failures.
        try:
            signal.pthread_sigmask(signal.SIG_SETMASK, caller_mask)
        except (OSError, ValueError) as exc:
            errors.append(exc)

    if errors:
        raise _SupervisorInvariantError(
            f"producer lane signal restore failed: {_format_exc_chain(errors)}"
        ) from errors[0]
    _fail_if_shutdown(flag)


def _live_process_group_pids(pgid: int) -> list[int]:
    """Return live (non-zombie) PIDs in pgid via ps; fail closed on probe error.

    Used only to decide whether SIGKILL is needed. Never treats killpg EPERM as
    success — zombie-only groups simply have no live members to kill.
    """
    try:
        completed = subprocess.run(
            ["ps", "-o", "pid=,stat=", "-g", str(pgid)],
            capture_output=True,
            text=True,
            check=False,
            timeout=REAP_GRACE_SECONDS,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        _invariant_fail(f"process group membership probe failed: {exc}")
    if completed.returncode not in (0, 1):
        detail = (completed.stderr or completed.stdout or "").strip()
        _invariant_fail(
            f"process group membership probe failed (exit {completed.returncode}): "
            f"{detail or 'no output'}"
        )
    live: list[int] = []
    for line in completed.stdout.splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        try:
            pid = int(parts[0])
        except ValueError:
            continue
        # First character of STAT: Z = zombie (not signalable / no kill needed).
        if not parts[1].startswith("Z"):
            live.append(pid)
    return live


def _kill_process_group(pgid: int) -> None:
    """SIGKILL an entire process group when live members exist.

    ESRCH/ProcessLookupError means the group is gone. EPERM and every other
    OSError fail closed — no platform EPERM success special case, including
    after the leader has exited. Zombie-only groups are skipped only when ps
    reports no live members (not when killpg returns EPERM).
    """
    live = _live_process_group_pids(pgid)
    if not live:
        return
    try:
        os.killpg(pgid, signal.SIGKILL)
        return
    except ProcessLookupError:
        return
    except OSError as exc:
        if exc.errno == errno.ESRCH:
            return
        _invariant_fail(
            f"process group SIGKILL failed for pgid={pgid}: {exc}"
        )


def _leader_exited_nowait(pid: int) -> bool:
    """Observe leader exit via waitid WNOWAIT without reaping.

    Keeping the direct child as a zombie preserves its PID/PGID identity so a
    subsequent killpg cannot race a kernel PGID reuse after wait/reap.
    """
    try:
        result = os.waitid(
            os.P_PID,
            pid,
            os.WEXITED | os.WNOHANG | os.WNOWAIT,
        )
    except ChildProcessError as exc:
        _invariant_fail(f"waitid lost child pid={pid}: {exc}")
    except OSError as exc:
        if exc.errno == errno.ECHILD:
            _invariant_fail(f"waitid lost child pid={pid}: {exc}")
        _invariant_fail(f"waitid failed for pid={pid}: {exc}")
    return result is not None


def _close_popen_stdio(process: subprocess.Popen[bytes]) -> list[Exception]:
    """Close pipe ends; return OSError list (never swallow — caller composes)."""
    errors: list[Exception] = []
    for stream in (process.stdin, process.stdout, process.stderr):
        if stream is None or stream.closed:
            continue
        try:
            stream.close()
        except OSError as exc:
            errors.append(exc)
    return errors


def _reap_direct_child(process: subprocess.Popen[bytes]) -> None:
    """Reap the direct child after group cleanup. Failure is fail-closed."""
    if process.returncode is not None:
        return
    try:
        process.wait(timeout=REAP_GRACE_SECONDS)
    except subprocess.TimeoutExpired as exc:
        _invariant_fail(f"direct child reap timed out: {exc}")
    except OSError as exc:
        _invariant_fail(f"direct child reap failed: {exc}")
    if process.returncode is None:
        _invariant_fail("direct child reap left returncode unset")


def _decode_pipe_bytes(data: bytes) -> str:
    return data.decode("utf-8", errors="replace")


def _append_capped(buf: bytearray, data: bytes, limit: int) -> None:
    """Keep at most limit+1 bytes so callers can detect overflow exactly once."""
    if not data or len(buf) > limit:
        return
    room = limit + 1 - len(buf)
    if room <= 0:
        return
    buf.extend(data if len(data) <= room else data[:room])


def _cleanup_spawned_session(
    process: subprocess.Popen[bytes],
    pgid: int | None,
    *,
    restore_mask: set[signal.Signals] | None = None,
) -> None:
    """Unique post-Popen failure path: kill group, close pipes, wait leader, mask.

    Always attempts every cleanup step. wait/close/mask failures compose into one
    chained invariant error — never swallowed as success.
    """
    errors: list[Exception] = []
    if pgid is not None:
        try:
            _kill_process_group(pgid)
        except _SupervisorInvariantError as exc:
            errors.append(exc)
    errors.extend(_close_popen_stdio(process))
    if process.returncode is None:
        try:
            process.wait(timeout=REAP_GRACE_SECONDS)
        except (subprocess.TimeoutExpired, OSError) as exc:
            errors.append(exc)
    if restore_mask is not None:
        try:
            signal.pthread_sigmask(signal.SIG_SETMASK, restore_mask)
        except (OSError, ValueError) as exc:
            errors.append(exc)
    if errors:
        raise _SupervisorInvariantError(
            f"spawn cleanup failed: {_format_exc_chain(errors)}"
        ) from errors[0]


def _spawn_session_process(
    args: list[str],
    *,
    cwd: Path | None,
    env: dict[str, str] | None,
    input_text: str | None,
) -> tuple[subprocess.Popen[bytes], int]:
    """Popen(start_new_session=True) under a blocked TERM/INT critical section.

    Sequence: block → Popen + capture pid/pgid → restore lane mask → return.
    Return only after mask restore succeeds. Any post-Popen failure takes the
    unique cleanup path (kill saved PGID, close pipes, wait leader, mask
    rollback) and chains cleanup errors — never returns a live leaked session.
    """
    _require_posix_supervisor()
    try:
        old_mask = signal.pthread_sigmask(
            signal.SIG_BLOCK, {signal.SIGTERM, signal.SIGINT},
        )
    except (OSError, ValueError) as exc:
        _invariant_fail(f"spawn signal mask block failed: {exc}")

    process: subprocess.Popen[bytes] | None = None
    pgid: int | None = None
    mask_restored = False
    try:
        try:
            process = subprocess.Popen(
                args,
                cwd=cwd,
                text=False,
                stdin=(
                    subprocess.PIPE
                    if input_text is not None
                    else subprocess.DEVNULL
                ),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                start_new_session=True,
                env=env,
            )
        except OSError as exc:
            # Ordinary launch/exec failure (ENOENT, EACCES, ...). Restore mask
            # then surface a typed launch error for router fallback.
            try:
                signal.pthread_sigmask(signal.SIG_SETMASK, old_mask)
                mask_restored = True
            except (OSError, ValueError) as mask_exc:
                _invariant_fail(
                    f"spawn signal mask restore failed after launch error: "
                    f"{mask_exc}; launch error: {exc}"
                )
            raise _SessionLaunchError(str(exc)) from exc
        except ValueError as exc:
            try:
                signal.pthread_sigmask(signal.SIG_SETMASK, old_mask)
                mask_restored = True
            except (OSError, ValueError) as mask_exc:
                _invariant_fail(
                    f"spawn signal mask restore failed after launch error: "
                    f"{mask_exc}; launch error: {exc}"
                )
            raise _SessionLaunchError(str(exc)) from exc

        if process.pid is None:
            _cleanup_spawned_session(process, None, restore_mask=old_mask)
            mask_restored = True
            raise _SessionLaunchError("session spawn returned without pid")

        # New session leader: process group id equals the child pid.
        pgid = int(process.pid)

        try:
            signal.pthread_sigmask(signal.SIG_SETMASK, old_mask)
            mask_restored = True
        except (OSError, ValueError) as exc:
            # HIGH: must not return the live child if mask restore fails.
            _cleanup_spawned_session(process, pgid, restore_mask=old_mask)
            mask_restored = True
            _invariant_fail(f"spawn signal mask restore failed: {exc}")

        return process, pgid
    except (_SessionLaunchError, _SupervisorInvariantError):
        raise
    except BaseException as exc:
        if process is not None:
            cleanup_mask = None if mask_restored else old_mask
            try:
                _cleanup_spawned_session(process, pgid, restore_mask=cleanup_mask)
                mask_restored = True
            except _SupervisorInvariantError as cleanup_exc:
                raise _SupervisorInvariantError(
                    f"spawn failed ({type(exc).__name__}: {exc}); "
                    f"cleanup also failed: {cleanup_exc}"
                ) from cleanup_exc
        elif not mask_restored:
            try:
                signal.pthread_sigmask(signal.SIG_SETMASK, old_mask)
            except (OSError, ValueError) as mask_exc:
                raise _SupervisorInvariantError(
                    f"spawn failed ({type(exc).__name__}: {exc}); "
                    f"mask restore failed: {mask_exc}"
                ) from mask_exc
        raise


def _run_session_command(
    args: list[str],
    *,
    timeout: int,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    input_text: str | None = None,
    shutdown: _ShutdownFlag | None = None,
) -> subprocess.CompletedProcess[str]:
    """Supervise one new-session child with selectors + waitid(WNOWAIT).

    Does not use Popen.communicate/poll as the supervision basis. Leader exit is
    observed without reaping so leftover descendants can be killpg'd while the
    zombie still owns the saved PGID; only then is the direct child waited.
    """
    process, pgid = _spawn_session_process(
        args, cwd=cwd, env=env, input_text=input_text,
    )
    saved_pgid: int | None = pgid
    stdout_buf = bytearray()
    stderr_buf = bytearray()
    timed_out = False
    interrupted = False
    leader_exited = False
    group_cleared = False
    selector = selectors.DefaultSelector()
    stdin_view: memoryview | None = None
    stdin_offset = 0

    def _clear_group_if_needed() -> None:
        nonlocal saved_pgid, group_cleared
        if saved_pgid is None or group_cleared:
            return
        _kill_process_group(saved_pgid)
        group_cleared = True

    def _finish_child_io_and_reap() -> None:
        """Close pipes then reap; compose close/wait failures fail-closed."""
        close_errors = _close_popen_stdio(process)
        reap_error: Exception | None = None
        try:
            _reap_direct_child(process)
        except _SupervisorInvariantError as exc:
            reap_error = exc
        if close_errors or reap_error is not None:
            errors: list[Exception] = list(close_errors)
            if reap_error is not None:
                errors.append(reap_error)
            raise _SupervisorInvariantError(
                f"session child finalize failed: {_format_exc_chain(errors)}"
            ) from errors[0]

    try:
        _fail_if_shutdown(shutdown)
        deadline = time.monotonic() + max(0, int(timeout))

        if process.stdin is not None:
            os.set_blocking(process.stdin.fileno(), False)
            payload = (
                b""
                if input_text is None
                else input_text.encode("utf-8")
            )
            stdin_view = memoryview(payload)
            selector.register(process.stdin, selectors.EVENT_WRITE, "stdin")
        if process.stdout is not None:
            os.set_blocking(process.stdout.fileno(), False)
            selector.register(process.stdout, selectors.EVENT_READ, "stdout")
        if process.stderr is not None:
            os.set_blocking(process.stderr.fileno(), False)
            selector.register(process.stderr, selectors.EVENT_READ, "stderr")

        while True:
            if shutdown is not None and shutdown.requested:
                interrupted = True
                break
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                timed_out = True
                break

            if not leader_exited and _leader_exited_nowait(int(process.pid)):
                leader_exited = True
                # Zombie still holds PID/PGID identity: clear descendants now.
                _clear_group_if_needed()

            keys = list(selector.get_map().values()) if selector.get_map() else []
            if not keys:
                if leader_exited:
                    break
                time.sleep(min(SUPERVISE_POLL_SECONDS, remaining))
                continue

            slice_timeout = min(SUPERVISE_POLL_SECONDS, remaining)
            try:
                events = selector.select(slice_timeout)
            except InterruptedError:
                continue

            for key, mask in events:
                label = key.data
                fileobj = key.fileobj
                if label == "stdin" and mask & selectors.EVENT_WRITE:
                    assert stdin_view is not None
                    assert process.stdin is not None
                    if stdin_offset >= len(stdin_view):
                        selector.unregister(fileobj)
                        process.stdin.close()
                        continue
                    try:
                        wrote = os.write(
                            process.stdin.fileno(),
                            stdin_view[stdin_offset:stdin_offset + _IO_CHUNK_BYTES],
                        )
                    except BlockingIOError:
                        continue
                    except OSError as exc:
                        if exc.errno in {errno.EPIPE, errno.ECONNRESET, errno.EAGAIN}:
                            selector.unregister(fileobj)
                            try:
                                process.stdin.close()
                            except OSError:
                                pass
                            stdin_view = None
                            continue
                        _fail(f"stdin write failed: {exc}")
                    if wrote == 0:
                        selector.unregister(fileobj)
                        process.stdin.close()
                        stdin_view = None
                        continue
                    stdin_offset += wrote
                    if stdin_offset >= len(stdin_view):
                        selector.unregister(fileobj)
                        process.stdin.close()
                        stdin_view = None
                elif label in {"stdout", "stderr"} and mask & selectors.EVENT_READ:
                    try:
                        chunk = os.read(fileobj.fileno(), _IO_CHUNK_BYTES)
                    except BlockingIOError:
                        continue
                    except OSError as exc:
                        if exc.errno == errno.EIO:
                            chunk = b""
                        else:
                            _fail(f"{label} read failed: {exc}")
                    if not chunk:
                        selector.unregister(fileobj)
                        try:
                            fileobj.close()
                        except OSError:
                            pass
                        continue
                    target = stdout_buf if label == "stdout" else stderr_buf
                    _append_capped(target, chunk, MAX_OUTPUT_BYTES)

        stdout_text = _decode_pipe_bytes(bytes(stdout_buf))
        stderr_text = _decode_pipe_bytes(bytes(stderr_buf))

        if interrupted or timed_out:
            _clear_group_if_needed()
            saved_pgid = None
            _finish_child_io_and_reap()
            if interrupted:
                _fail("Pi lifecycle interrupted by signal")
            raise subprocess.TimeoutExpired(
                args,
                timeout,
                output=stdout_text,
                stderr=stderr_text,
            )

        if not leader_exited:
            _clear_group_if_needed()
            saved_pgid = None
            _finish_child_io_and_reap()
            _fail("session supervise ended without leader exit")

        # Normal completion: group already cleared on leader exit observation.
        _clear_group_if_needed()
        saved_pgid = None
        _finish_child_io_and_reap()
        code = 0 if process.returncode is None else int(process.returncode)
        return subprocess.CompletedProcess(
            args, code, stdout_text, stderr_text,
        )
    finally:
        try:
            selector.close()
        except Exception:
            pass
        final_errors: list[Exception] = []
        if saved_pgid is not None:
            try:
                _kill_process_group(saved_pgid)
            except _SupervisorInvariantError as exc:
                final_errors.append(exc)
            saved_pgid = None
        final_errors.extend(_close_popen_stdio(process))
        if process.returncode is None:
            try:
                _reap_direct_child(process)
            except _SupervisorInvariantError as exc:
                final_errors.append(exc)
        if final_errors:
            raise _SupervisorInvariantError(
                f"session supervise cleanup failed: "
                f"{_format_exc_chain(final_errors)}"
            ) from final_errors[0]


def _run_pi(
    prompt: str,
    cwd: Path,
    *,
    timeout: int,
    allow_non_json_receipt: bool = False,
    shutdown: _ShutdownFlag | None = None,
) -> dict[str, Any] | None:
    args = [
        _pi_command(),
        "--mode", "text", "-p", "--no-session",
        "--no-extensions", "--no-skills", "--no-prompt-templates",
        "--no-context-files", "--approve",
        "--tools", PI_TOOLS,
        "--model", _pi_model(),
        "--thinking", PI_THINKING,
        "--skill", str(_pdf_skill()),
        prompt,
    ]
    # When no shared lane flag is provided (e.g. opening review), own the full
    # producer-lane mask+handler boundary around the Pi child. Locator/full-parse
    # pass a shared flag so router + Pi + receipt share one host-abort boundary.
    owns_lane = shutdown is None
    flag = shutdown or _ShutdownFlag()
    handlers: dict[int, Any] | None = None
    old_mask: set[signal.Signals] | None = None
    if owns_lane:
        handlers, old_mask = _enter_producer_lane(flag)
    try:
        _fail_if_shutdown(flag)
        try:
            completed = _run_session_command(
                args,
                timeout=timeout,
                cwd=cwd,
                shutdown=flag,
                env=_pi_child_env(),
            )
        except _SessionLaunchError as exc:
            # Pi path does not fall back; surface launch failure as hard error.
            _fail(f"Pi PDF session launch failed: {exc}")
        except subprocess.TimeoutExpired:
            _fail("Pi PDF lifecycle timed out")
        _run_post_child_hook()
        _fail_if_shutdown(flag)
        if completed.returncode != 0:
            _fail(_child_failure_detail(completed.returncode, completed.stderr))
        payload = (completed.stdout or "").encode()
        if len(payload) > MAX_OUTPUT_BYTES:
            _fail("Pi PDF producer receipt exceeds output limit")
        try:
            parsed = json.loads(payload)
        except json.JSONDecodeError:
            if allow_non_json_receipt:
                _fail_if_shutdown(flag)
                return None
            raise
        if not isinstance(parsed, dict):
            if allow_non_json_receipt:
                _fail_if_shutdown(flag)
                return None
            return _object(parsed, "Pi PDF receipt")
        _fail_if_shutdown(flag)
        return parsed
    finally:
        if owns_lane and handlers is not None and old_mask is not None:
            _leave_producer_lane(handlers, old_mask, flag)


def _locator_prompt(task: dict[str, Any]) -> str:
    return (
        "Use the loaded PDF skill. You are only a document producer, never a "
        "Keeper. Locate the exact target in task.source.path and select the "
        "smallest 1..3 page window that covers it. task.cached_pdf_indices are "
        "pages already accepted in the module cache: never render, transcribe, "
        "or rewrite them. Render and visually inspect every page the scope "
        "needs, and write a source bundle at task.source_bundle_path "
        "containing exactly the selected pages. Its manifest.json must follow "
        "task.source_bundle_manifest_contract.template exactly: every key in "
        "that template is required and `producer` is a literal string that "
        "must be copied verbatim, not replaced with your own identity. "
        "manifest.source must copy task.source unchanged and page_count is "
        "the real page count of the whole PDF. Each pages[] row needs "
        "pdf_index (0-based, inside page_count), markdown_path relative to the "
        "bundle, text_sha256 of that file's exact bytes, review_state, "
        "parse_confidence between 0 and 1, and grep_anchors: a non-empty list "
        "of short substrings copied verbatim from that page's own Markdown. "
        "The repository re-checks each anchor against the file, so never "
        "paraphrase or invent one. Do not use OCR, read campaign "
        "saves/transcripts, call "
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
    """Derive the transport receipt from the validated bundle, not from LLM
    prose.

    The validated bundle is the authoritative selected scope; the producer's
    self-declared pdf_indices are advisory only (the child can drift between
    zero-based and one-based page claims without affecting the pages it
    actually wrote, so a valid bundle must never be rejected over that drift).
    The receipt emits printed page numbers (1-based, matching the task's
    pdf_index_caliber), converted from the bundle's zero-based pdf_index.
    Accepted cache pages must never be re-rendered; that guard checks the
    bundle's real pages.
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
    bundle_path = Path(task["source_bundle_path"]).resolve()
    if not (bundle_path / "manifest.json").is_file():
        _fail("located result bundle is unavailable")
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
    if (
        not 1 <= len(bundle_indices) <= task["max_selected_pages"]
        or any(
            not isinstance(index, int) or isinstance(index, bool)
            or index < 0
            for index in bundle_indices
        )
        or bundle_indices != sorted(set(bundle_indices))
    ):
        _fail("located source bundle page scope is invalid; every selected "
              "page must be included exactly once in the bundle")
    cache_root = task["asset_root_id"]
    accepted = set(
        assets.accepted_cached_pdf_indices(workspace, cache_root)
    )
    if any(index in accepted for index in bundle_indices):
        _fail("rendered pdf_index is already accepted in the module cache; "
              "reference it instead of re-rendering")
    return {
        "schema_version": 1,
        "contract_id": "coc.pi-source-scope-locator-producer-result.v1",
        "job_id": task["job_id"],
        "status": "located",
        "kind": task["kind"],
        "target_id": task["target_id"],
        # The bundle pdf_index is zero-based page order; the producer receipt
        # contract is printed page numbers, 1-based (pdf_index_caliber
        # printed_page_number_1_based).
        "pdf_indices": [index + 1 for index in bundle_indices],
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
        "module_init_l0_schema": _module_init_l0_schema(),
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


def _module_init_l0_schema() -> dict[str, Any]:
    """Prompt-facing structural floor for the private keeper-only L0 package.

    Persistent validation remains in coc_runtime_ops; this compact copy only
    tells the isolated document producer which source-derived shape it must
    return. Extra properties are expressly allowed at every entity level.
    """
    return {
        "schema_version": 1,
        "secrecy": "keeper_only",
        "required_fields": [
            "schema_version", "secrecy", "module_meta", "pregens",
            "opening_hooks", "chargen_deltas", "opening_handouts",
        ],
        "module_meta_required_fields": [
            "title_zh", "title_en", "authors", "translator", "era",
            "locale", "party_size", "duration_hint", "tone_tags",
            "mythos_entities", "campaign_hooks", "warnings",
            "safety_notes", "structure_type",
        ],
        "module_meta_field_rules": {
            "title_zh": "null or non-empty string",
            "title_en": "null or non-empty string",
            "era": "null or non-empty string",
            "locale": "null or non-empty string",
            "duration_hint": "null or non-empty string",
            "structure_type": "null or non-empty string",
            "party_size": "null, string, or integer (never boolean)",
            "authors": "null, string, or array of non-empty strings; [] when the source names none",
            "translator": "null, string, or array of non-empty strings; [] when the source names none",
            "safety_notes": "null, string, or array of non-empty strings; [] when the source names none",
            "tone_tags": "array of non-empty strings; [] when the source names none; never null",
            "mythos_entities": "array of non-empty strings; [] when the source names none; never null",
            "campaign_hooks": "array of non-empty strings; [] when the source names none; never null",
            "warnings": "array of non-empty strings; [] when the source names none; never null",
        },
        "pregen_required_fields": [
            "name", "age", "occupation", "hooks_to_plot",
            "backstory_blocks", "stats_ref",
        ],
        "pregen_field_rules": {
            "name": "null or non-empty string",
            "occupation": "null or non-empty string",
            "age": "null, string, or integer",
            "hooks_to_plot": "array of non-empty strings; [] is valid when the source lists no hooks; never null and never empty-string entries",
            "backstory_blocks": "null, string, array, or object",
            "stats_ref": "null, string, or object",
        },
        "opening_hook_required_fields": [
            "id", "audience", "text", "variant_of",
        ],
        "opening_hook_field_rules": {
            "id": "non-empty string",
            "audience": "exactly player or keeper",
            "text": "non-empty string up to 20000 characters",
            "variant_of": "null or non-empty string; key is always required",
        },
        "opening_handout_required_fields": [
            "id", "title", "when_to_give",
        ],
        "opening_handout_field_rules": {
            "id": "non-empty string",
            "title": "null or non-empty string",
            "when_to_give": "null or non-empty string",
        },
        "chargen_deltas_rule": (
            "array of objects up to 128 items; [] is valid when the source makes "
            "no creation adjustments; never a single dict and never any other "
            "non-array; each item records one source-derived creation adjustment "
            "and has no required fields"
        ),
        "unknown_source_value": "use null or [] rather than inventing it",
        "additional_properties_allowed": True,
    }


def _opening_text_prompt(
    task: dict[str, Any], materialized: dict[str, Any],
) -> str:
    opening = set(materialized["selected_opening_pdf_indices"])
    pages = [
        {
            "pdf_index": int(page["pdf_index"]),
            "markdown_path": page["markdown_path"],
            "role": (
                "opening" if int(page["pdf_index"]) in opening
                else "fact_evidence"
            ),
        }
        for page in materialized["bundle"].get("pages", [])
    ]
    extraction = {
        "schema_version": 1,
        "contract_id": "coc.pi-opening-text-extractor-task.v1",
        "workspace_root": task["workspace_root"],
        "campaign_id": task["campaign_id"],
        "scenario_id": task["scenario_id"],
        "source_id": task["source"]["source_id"],
        "title": task["title"],
        "play_language": task["play_language"],
        "source_bundle_path": task["source_bundle_path"],
        "selected_opening_pdf_indices": materialized[
            "selected_opening_pdf_indices"
        ],
        "fact_evidence_pdf_indices": materialized[
            "fact_evidence_pdf_indices"
        ],
        "pages": pages,
        "opening_fast_facts_schema": task["opening_fast_facts_schema"],
        "module_init_l0_schema": task["module_init_l0_schema"],
    }
    return (
        "You are one isolated document producer, not a Keeper and not a "
        "gameplay agent. The scenario's opening source pages are ALREADY "
        "materialized as native UTF-8 Markdown files under "
        "task.source_bundle_path; there is no PDF to render, inspect, or "
        "read, and no image tool is available. Use the read tool on every "
        "task.pages markdown_path (each relative to "
        "task.source_bundle_path) and extract, from that source text only, "
        "the six opening fast facts and the private keeper-only "
        "module_init_l0. task.pages role marks the contiguous playable "
        "opening window (opening) versus the separate fact-evidence set "
        "(fact_evidence). Use grep/find anchors such as 预设、建卡、角色、年代、"
        "人数、难度、适合、职业、技能、警告 to locate candidates, then read "
        "their surrounding Markdown and make the final inclusion decision "
        "semantically. Anchor hits are location aids only, never keyword "
        "proof. Do not assume the first N pages or any fixed appendix pages; "
        "information positions are not fixed. When anchors are insufficient, "
        "sample a small opening and ending window and judge the source "
        "context. L0 must satisfy "
        "task.module_init_l0_schema, remain keeper_only, and use null or [] "
        "for a source value that is absent rather than inventing it. Every "
        "opening_hooks item MUST contain all four keys id, audience, text, "
        "variant_of: id and text are non-empty strings (text up to 20000 "
        "characters), audience is exactly player or keeper, and variant_of "
        "is present as null when there is no variant (otherwise a non-empty "
        "string). Every pregen and opening_handouts item MUST include every "
        "field named by its required fields list. Pregen field rules: name "
        "and occupation are non-empty strings or null, age is a string, "
        "integer, or null, hooks_to_plot is an array of non-empty strings "
        "(use [] when the source lists no hooks -- never null and never "
        "empty-string entries), backstory_blocks is null, a string, an "
        "array, or an object, and stats_ref is null, a string, or an object. "
        "Handout rules: id is a non-empty string, and title and when_to_give "
        "are non-empty strings or null. module_meta MUST include every field "
        "named by its required fields list. module_meta field rules: "
        "title_zh, title_en, era, locale, duration_hint, and structure_type "
        "are non-empty strings or null, party_size is a string, integer, or "
        "null (never boolean), authors, translator, and safety_notes are "
        "null, a string, or an array of non-empty strings ([] when the "
        "source names none), and tone_tags, mythos_entities, campaign_hooks, "
        "and warnings are arrays of non-empty strings (use [] when the "
        "source names none -- never null). chargen_deltas MUST be an array "
        "of objects and may be [] when the source makes no creation "
        "adjustments; a single dict or any other non-array is invalid. Each "
        "delta item records one source-derived creation adjustment (for "
        "example a skill, equipment, or resource change) and has no required "
        "fields; do not invent adjustments the source does not state. Do not "
        "expose full source text in L0. Do not read .coc, saves, "
        "transcripts, AGENTS.md, or repository source. Do not call gameplay "
        "tools or write outside source_bundle_path. Return only one strict "
        "JSON object with exact fields schema_version, contract_id, status, "
        "campaign_id, scenario_id, source_bundle_path, failure_class, facts, "
        "module_init_l0. Output must be strictly valid JSON: never place a "
        "bare ASCII double quote (\") inside a string value -- render quoted "
        "terms with full-width quotes 「」 or “ ” instead, and escape any "
        "unavoidable backslash or control character. contract_id is "
        "coc.pi-opening-text-extractor-result.v1; status is reviewed or "
        "failed. For reviewed, failure_class is null, facts is a valid "
        "coc.opening-fast-facts.v1 object and module_init_l0 satisfies "
        "task.module_init_l0_schema. facts must exactly satisfy "
        "task.opening_fast_facts_schema: answer all six questions only from "
        "task.fact_evidence_pdf_indices; source answers use minimal "
        "{source_id,pdf_index} source_refs with source_id exactly "
        "task.source_id and unresolved answers use minimal "
        "inspected_source_refs for pages actually checked. Every "
        "source_refs or inspected_source_refs array MUST "
        "contain 1 to 3 unique refs and never more than three; "
        "content_flags is not an exception. Never cite a page outside "
        "task.fact_evidence_pdf_indices. Never use a "
        "campaign era, default era, title hint, or task placeholder as "
        "evidence. The opening fact era is the investigators' native/start era "
        "used for character creation at the first player-facing scene, not "
        "merely the calendar era of the main destination or hidden scenario "
        "events. If authored investigators begin in one era and are transported "
        "to another (for example 1890s travelers entering a medieval town), "
        "era.value must be the origin/start era and the destination year belongs "
        "in module_meta.era and the summary. For a resolved era, era.value MUST "
        "be exactly one canonical era key semantically supported by the cited "
        "source: prehistoric, "
        "roman, medieval, early_modern, 1890s, ww1, 1920s, 1930s, 1970s, or "
        "modern. For example, a scenario set in the Roman Empire uses roman; "
        "preserve an exact authored year or fuller label in module_meta.era "
        "and player_safe_summary rather than putting free prose in era.value. "
        "Return concise values only: no source text, excerpts, "
        "manifest body, or reasoning. For failed, source_bundle_path=null, "
        "failure_class is non-empty, and facts=null and module_init_l0=null.\n"
        + json.dumps(extraction, ensure_ascii=False, separators=(",", ":"))
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
            "failure_class", "facts", "module_init_l0",
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
            or not isinstance(result.get("module_init_l0"), dict)
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
        or result.get("module_init_l0") is not None
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


def _pages_by_index(rows: Any, label: str) -> dict[int, dict[str, Any]]:
    if not isinstance(rows, list):
        _fail(f"{label} are invalid")
    indexed = {
        int(row["pdf_index"]): row
        for row in rows
        if isinstance(row, dict)
        and isinstance(row.get("pdf_index"), int)
        and not isinstance(row.get("pdf_index"), bool)
    }
    if len(indexed) != len(rows):
        _fail(f"{label} are invalid")
    return indexed


def _retained_files_unchanged(root: Path, row: dict[str, Any]) -> bool:
    """The producer may not edit a preseeded page's bytes.

    The bundle validator would also catch this, but only as an anonymous
    hash mismatch; naming the retained page keeps the failure diagnosable.
    """
    declared = [(row.get("markdown_path"), row.get("text_sha256"))]
    structured = row.get("structured_data")
    if isinstance(structured, dict):
        declared.append((structured.get("path"), structured.get("sha256")))
    for relative, expected in declared:
        if not isinstance(relative, str) or not isinstance(expected, str):
            return False
        path = (root / relative).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            return False
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            return False
    return True


def _splice_retained_bound_pages(
    task: dict[str, Any],
    selected: list[int],
    fact_evidence: list[int],
) -> dict[str, Any]:
    """Author the retained rows of the final manifest from the bound copy.

    A producer must never be asked to reproduce bytes it is forbidden to
    change. Echoing a manifest row verbatim is not a capability a model has:
    one re-serialized page-0 row (identical evidence, different spelling)
    used to fail the whole opening review. The repository already holds those
    rows, so it splices them in and the producer supplies only the pages it
    genuinely adds. The retained Markdown/structured files stay under their
    retained hashes, so the bundle validator still rejects any real edit.
    """
    reusable = _object(
        task.get("reusable_bound_source"),
        "reusable bound source",
    )
    retained_manifest = _object(
        reusable.get("manifest"),
        "reusable bound source manifest",
    )
    retained_raw = _pages_by_index(
        retained_manifest.get("pages"), "reusable bound source pages",
    )
    manifest_path = Path(task["source_bundle_path"]) / "manifest.json"
    manifest = _json(manifest_path, "opening source manifest")
    produced = _pages_by_index(
        manifest.get("pages"), "opening source manifest pages",
    )
    bundle_root = Path(task["source_bundle_path"]).resolve()
    pages: list[dict[str, Any]] = []
    for pdf_index in sorted(set(selected) | set(fact_evidence)):
        row = retained_raw.get(pdf_index)
        if row is not None:
            if not _retained_files_unchanged(bundle_root, row):
                _fail(f"reusable bound page {pdf_index} was modified")
            pages.append(row)
            continue
        row = produced.get(pdf_index)
        if row is None:
            _fail(f"opening source manifest is missing page {pdf_index}")
        pages.append(row)
    manifest["pages"] = pages
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest


def _validate_reused_bound_pages(
    bundle: dict[str, Any],
    task: dict[str, Any],
) -> None:
    """Repository-side post-splice invariant.

    Every retained page in the reviewed bundle must still normalize to the
    row the bound bundle produced. The splice makes that true by
    construction; this catches a splice regression, and a producer that
    rewrote a retained Markdown or structured file already fails earlier in
    the bundle validator's hash check.
    """
    reusable = _object(
        task.get("reusable_bound_source"),
        "reusable bound source",
    )
    retained_normalized = _pages_by_index(
        reusable.get("normalized_pages"), "reusable bound source pages",
    )
    for page in bundle["pages"]:
        pdf_index = int(page["pdf_index"])
        if pdf_index not in retained_normalized:
            continue
        if _reusable_page_row(page) != retained_normalized[pdf_index]:
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


def _opening_producer_timeout(request: dict[str, Any]) -> int:
    """Fit the producer inside the caller's deadline when one was supplied."""
    supplied = request.get("transport_timeout_seconds")
    if not isinstance(supplied, int) or isinstance(supplied, bool):
        return PI_TIMEOUT_SECONDS
    return max(60, supplied - OPENING_REVIEW_WRITEBACK_MARGIN_SECONDS)


def _write_opening_transport_failure_evidence(
    campaign_dir: Path,
    request: dict[str, Any],
    task: dict[str, Any],
    lock_path: Path,
    reason: str,
) -> Path | None:
    """Persist bounded progress when the producer cannot emit a receipt.

    A SIGKILL cannot run this handler; the parent extension records that case.
    Ordinary child exit, timeout, validation, bind, and fulfillment failures do
    pass here before the adapter exits non-zero.
    """
    try:
        evidence_dir = campaign_dir / "logs" / "opening-source-review-evidence"
        evidence_dir.mkdir(parents=True, exist_ok=True)
        generation = request["opening_review_generation"]
        destination = evidence_dir / f"transport-failure-g{generation}.json"
        bundle_root = Path(task["source_bundle_path"])
        rendered_pages = sum(
            1 for path in bundle_root.rglob("*.md") if path.is_file()
        ) if bundle_root.is_dir() else 0
        evidence = {
            "schema_version": 1,
            "secrecy": "keeper_only",
            "campaign_id": request["campaign_id"],
            "scenario_id": request["scenario_id"],
            "opening_review_generation": generation,
            "status": "producer_failure_before_receipt",
            "failure_class": "opening_source_review_transport_failed",
            "reason": str(reason)[:512],
            "rendered_markdown_pages": rendered_pages,
            "transport_lock_path": str(lock_path),
        }
        temporary = destination.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(evidence, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary, destination)
        return destination
    except OSError:
        return None


def _write_opening_l0_failure_evidence(
    campaign_dir: Path,
    request: dict[str, Any],
    payload: Any,
    reason: str,
) -> Path:
    """Keep the malformed private L0 for diagnosis without mutating campaign state."""
    evidence_dir = campaign_dir / "logs" / "opening-source-review-evidence"
    evidence_dir.mkdir(parents=True, exist_ok=True)
    generation = request["opening_review_generation"]
    destination = evidence_dir / f"l0-producer-failure-g{generation}.json"
    evidence = {
        "schema_version": 1,
        "secrecy": "keeper_only",
        "campaign_id": request["campaign_id"],
        "scenario_id": request["scenario_id"],
        "opening_review_generation": generation,
        "reason": reason,
        # This is intentionally only the producer's L0 field, not its raw
        # prompt/result or source pages. The campaign log is keeper-only
        # diagnostic evidence and is never projected to the player.
        "module_init_l0": payload,
    }
    temporary = destination.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, destination)
    return destination


def _materialize_opening_bundle(
    task: dict[str, Any],
    private: dict[str, Any],
    pdf_bundle: Any,
    request: dict[str, Any],
    shutdown: _ShutdownFlag,
) -> dict[str, Any]:
    """Materialize the reviewed opening bundle without any model rendering.

    The native Markdown pages already exist: the locator wrote the bound
    bundle (preseeded into the output root by _opening_producer_task) and the
    Firecrawl router can select pages + write the schema-v1 bundle from its
    own native page cache. Only when the router is unset or unable does the
    adapter fall back to the locator's already-materialized bound pages as
    both the opening window and the fact-evidence set. No PDF skill, image
    tool, or visual model is ever invoked here.
    """
    routed = _try_external_pdf_router(
        "opening_review",
        task,
        timeout=_opening_producer_timeout(request),
        shutdown=shutdown,
    )
    _run_post_child_hook()
    _fail_if_shutdown(shutdown)
    if routed is not None:
        return {
            "selected_opening_pdf_indices": list(
                routed["selected_opening_pdf_indices"]
            ),
            "fact_evidence_pdf_indices": list(
                routed["fact_evidence_pdf_indices"]
            ),
            "bundle": routed["bundle"],
            "source": "router",
        }
    bound_indices = list(int(index) for index in private["allowed_pdf_indices"])
    bundle = pdf_bundle.load_host_bundle(task["source_bundle_path"])
    if [int(row["pdf_index"]) for row in bundle.get("pages", [])] != bound_indices:
        _fail("opening fallback bound source page scope drift")
    window = _earliest_contiguous_page_run(bound_indices)
    selected = window[: min(3, len(window))]
    fact_evidence = window[: min(MAX_FACT_EVIDENCE_PAGES, len(window))]
    return {
        "selected_opening_pdf_indices": selected,
        "fact_evidence_pdf_indices": fact_evidence,
        "bundle": bundle,
        "source": "preseed",
    }


def _run_opening_text_extractor(
    task: dict[str, Any],
    materialized: dict[str, Any],
    *,
    timeout: int,
    shutdown: _ShutdownFlag,
) -> dict[str, Any]:
    """Text-model extraction of the six opening facts + module_init_l0.

    Reads only the router-materialized native Markdown pages; never renders
    the PDF and never loads the visual PDF skill. The model defaults to a
    text model (DeepSeek V4 Flash; COC_PI_OPENING_MODEL overrides it).

    The child often wraps its strict JSON in a markdown fence or answers
    with prose instead of bare JSON. Parse order: bare JSON object, then a
    ```json (or ```) fenced JSON object; if neither parses, run the child
    once more (at most two child calls) inside the remaining budget, then
    emit a structured extractor_invalid_output failure receipt carrying a
    bounded stdout sample instead of a bare JSONDecodeError. Empty stdout
    takes the same retry/failure path. A receipt is never fabricated: an
    invalid-output result stays status=failed with facts and module_init_l0
    null.
    """
    args = [
        _pi_command(),
        "--mode", "text", "-p", "--no-session",
        "--no-extensions", "--no-skills", "--no-prompt-templates",
        "--no-context-files", "--approve",
        "--tools", OPENING_TEXT_TOOLS,
        "--model", _opening_text_model(),
        "--thinking", PI_THINKING,
        _opening_text_prompt(task, materialized),
    ]
    cwd = Path(task["workspace_root"])
    _fail_if_shutdown(shutdown)
    started = time.monotonic()
    completed = _run_opening_extractor_child(
        args, timeout=timeout, cwd=cwd, shutdown=shutdown,
    )
    parsed = _parse_opening_extractor_stdout(completed.stdout or "")
    if parsed is None:
        # One retry inside the same remaining budget. Invalid output usually
        # returns fast, so the second call keeps nearly the full timeout;
        # the floor keeps a meaningful budget when the first call did not.
        remaining = max(60, int(timeout - (time.monotonic() - started)))
        completed = _run_opening_extractor_child(
            args, timeout=remaining, cwd=cwd, shutdown=shutdown,
        )
        parsed = _parse_opening_extractor_stdout(completed.stdout or "")
        if parsed is None:
            _fail_if_shutdown(shutdown)
            return _opening_extractor_invalid_output_receipt(
                task, completed.stdout or "",
            )
    _fail_if_shutdown(shutdown)
    return parsed


# Bounded diagnostic sample of unparseable extractor stdout. It never feeds
# facts or module_init_l0; it exists so an invalid-output failure is
# diagnosable instead of a bare JSONDecodeError.
OPENING_EXTRACTOR_OUTPUT_SAMPLE_CHARS = 500


def _strip_markdown_json_fence(text: str) -> str | None:
    """Extract the body of one ``` or ```lang fenced block, else None.

    Accepts exactly one opening fence line (``` optionally followed by a
    language tag) and one closing ``` line. The body may be JSON, prose, or
    empty; the caller still has to parse it. Anything else (extra fence
    lines, prose outside the fence, a bare ``` inside the body) returns None
    so the caller can retry or fail instead of guessing.
    """
    lines = text.splitlines()
    if len(lines) < 2:
        return None
    first = lines[0].strip()
    last = lines[-1].strip()
    if re.fullmatch(r"```[A-Za-z0-9_+-]*", first) is None or last != "```":
        return None
    return "\n".join(lines[1:-1])


def _extract_single_fenced_block(text: str) -> str | None:
    """Body of the output's single fenced block, tolerating surrounding prose.

    Real extractor children often prepend a one-line status preamble before
    the fenced JSON despite the strict-output instruction; the fence markers
    still delimit the payload unambiguously. Returns None when there is not
    exactly one complete fenced block (or a fence is left unterminated) —
    ambiguous output stays a retry/fail case, never a guess.
    """
    blocks: list[str] = []
    lines = text.splitlines()
    index = 0
    while index < len(lines):
        if re.fullmatch(r"```[A-Za-z0-9_+-]*", lines[index].strip()) is None:
            index += 1
            continue
        body: list[str] = []
        cursor = index + 1
        while cursor < len(lines) and lines[cursor].strip() != "```":
            body.append(lines[cursor])
            cursor += 1
        if cursor >= len(lines):
            return None
        blocks.append("\n".join(body))
        index = cursor + 1
    if len(blocks) != 1:
        return None
    return blocks[0]


def _parse_opening_extractor_stdout(
    stdout_text: str,
) -> dict[str, Any] | None:
    """Tolerantly parse the extractor child's stdout into one JSON object.

    Order: bare JSON object, then a ```json (or ```) fenced JSON object, then
    exactly one fenced block embedded in surrounding prose. Returns None
    (caller retries once, then emits a structured invalid-output receipt) for
    empty stdout, prose, multiple/ambiguous fences, a fenced non-JSON body,
    or any JSON that is not exactly an object. Never infers a value from
    prose and never fabricates a result.
    """
    text = (stdout_text or "").strip()
    if not text:
        return None
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        parsed = None
    if isinstance(parsed, dict):
        return parsed
    fenced = _strip_markdown_json_fence(text)
    if fenced is None:
        fenced = _extract_single_fenced_block(text)
    if fenced is None:
        return None
    try:
        parsed = json.loads(fenced.strip())
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _run_opening_extractor_child(
    args: list[str],
    *,
    timeout: int,
    cwd: Path,
    shutdown: _ShutdownFlag,
) -> subprocess.CompletedProcess[str]:
    """Run one bounded text-extractor child and fail closed on its own errors.

    Launch, timeout, host-abort, non-zero exit, and oversized output are hard
    transport errors (never retried and never converted into a failure
    receipt); only invalid JSON output is retried by the caller.
    """
    _fail_if_shutdown(shutdown)
    try:
        completed = _run_session_command(
            args,
            timeout=timeout,
            cwd=cwd,
            shutdown=shutdown,
            env=_pi_child_env(),
        )
    except _SessionLaunchError as exc:
        _fail(f"opening text extractor launch failed: {exc}")
    except subprocess.TimeoutExpired:
        _fail("opening text extractor timed out")
    _run_post_child_hook()
    _fail_if_shutdown(shutdown)
    if completed.returncode != 0:
        _fail(_child_failure_detail(completed.returncode, completed.stderr))
    payload = (completed.stdout or "").encode()
    if len(payload) > MAX_OUTPUT_BYTES:
        _fail("opening text extractor receipt exceeds output limit")
    return completed


def _opening_extractor_invalid_output_receipt(
    task: dict[str, Any],
    stdout_text: str,
) -> dict[str, Any]:
    """Structured failure receipt for two unparseable extractor attempts.

    The child ran twice and never emitted exactly one JSON object. This is a
    real failed result: facts and module_init_l0 stay None -- never a
    fabricated reviewed receipt. The bounded stdout sample is diagnostic
    evidence only and is tolerated (never required) by the failed-result
    validator.
    """
    sample = " ".join((stdout_text or "").split())[
        :OPENING_EXTRACTOR_OUTPUT_SAMPLE_CHARS
    ]
    return {
        "schema_version": 1,
        "contract_id": "coc.pi-opening-text-extractor-result.v1",
        "status": "failed",
        "campaign_id": task["campaign_id"],
        "scenario_id": task["scenario_id"],
        "source_bundle_path": None,
        "failure_class": "extractor_invalid_output",
        "facts": None,
        "module_init_l0": None,
        "stdout_sample": sample,
    }


def _validate_opening_extractor_result(
    value: Any,
    task: dict[str, Any],
    selected: list[int],
    fact_evidence: list[int],
) -> dict[str, Any]:
    """Validate the text extractor and assemble the producer-result envelope.

    The materialization step owns the page split; the extractor supplies only
    facts + module_init_l0. The assembled envelope then passes the canonical
    _validate_opening_result gate so the downstream bind/fulfill seam is
    byte-for-byte unchanged.
    """
    result = _object(value, "opening text extractor result")
    required_fields = {
        "schema_version", "contract_id", "status", "campaign_id",
        "scenario_id", "source_bundle_path", "failure_class",
        "facts", "module_init_l0",
    }
    if result.get("status") == "failed":
        # stdout_sample is an optional diagnostic on failed results only: both
        # the plain failed receipt and the extractor_invalid_output receipt
        # (with its bounded stdout sample) are legal. Every required field
        # must still be present.
        allowed_fields = required_fields | {"stdout_sample"}
        shape_ok = required_fields <= set(result) <= allowed_fields
    else:
        # Reviewed results keep the exact required shape.
        shape_ok = set(result) == required_fields
    if (
        not shape_ok
        or result.get("schema_version") != 1
        or result.get("contract_id") != "coc.pi-opening-text-extractor-result.v1"
        or result.get("campaign_id") != task["campaign_id"]
        or result.get("scenario_id") != task["scenario_id"]
        or result.get("status") not in {"reviewed", "failed"}
    ):
        _fail("opening text extractor result invalid")
    if result["status"] == "failed":
        if (
            result.get("source_bundle_path") is not None
            or not isinstance(result.get("failure_class"), str)
            or not result["failure_class"].strip()
            or result.get("facts") is not None
            or result.get("module_init_l0") is not None
            or (
                "stdout_sample" in result
                and not isinstance(result["stdout_sample"], str)
            )
        ):
            _fail("failed opening text extractor result invalid")
        return {
            "schema_version": 1,
            "contract_id": "coc.pi-opening-pdf-producer-result.v1",
            "status": "failed",
            "campaign_id": task["campaign_id"],
            "scenario_id": task["scenario_id"],
            "selected_opening_pdf_indices": [],
            "fact_evidence_pdf_indices": [],
            "source_bundle_path": None,
            "failure_class": result["failure_class"],
            "facts": None,
            "module_init_l0": None,
        }
    if (
        result.get("source_bundle_path") != task["source_bundle_path"]
        or result.get("failure_class") is not None
        or not isinstance(result.get("module_init_l0"), dict)
    ):
        _fail("reviewed opening text extractor result invalid")
    return _validate_opening_result({
        "schema_version": 1,
        "contract_id": "coc.pi-opening-pdf-producer-result.v1",
        "status": "reviewed",
        "campaign_id": task["campaign_id"],
        "scenario_id": task["scenario_id"],
        "selected_opening_pdf_indices": list(selected),
        "fact_evidence_pdf_indices": list(fact_evidence),
        "source_bundle_path": task["source_bundle_path"],
        "failure_class": None,
        "facts": result["facts"],
        "module_init_l0": result["module_init_l0"],
    }, task)


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
        # Page materialization is router-native: the Firecrawl router selects
        # the opening/fact pages and writes the schema-v1 bundle from its
        # already-materialized Markdown pages; without a router the adapter
        # reuses the locator's bound native pages. Neither path renders a PDF
        # or needs the visual Grok/PDF-skill child. Only the semantic
        # facts + L0 extraction runs a separate text-model child, and the
        # bind/fulfill receipt still shares one producer-lane abort boundary.
        shutdown = _ShutdownFlag()
        handlers, old_mask = _enter_producer_lane(shutdown)
        try:
            materialized = _materialize_opening_bundle(
                task, private, pdf_bundle, request, shutdown,
            )
            selected = materialized["selected_opening_pdf_indices"]
            fact_evidence = materialized["fact_evidence_pdf_indices"]
            extractor_payload = _run_opening_text_extractor(
                task,
                materialized,
                timeout=_opening_producer_timeout(request),
                shutdown=shutdown,
            )
            try:
                result = _validate_opening_extractor_result(
                    extractor_payload, task, selected, fact_evidence,
                )
            except RuntimeError as exc:
                if isinstance(extractor_payload, dict) and "module_init_l0" in extractor_payload:
                    _write_opening_l0_failure_evidence(
                        campaign_dir,
                        request,
                        extractor_payload["module_init_l0"],
                        str(exc),
                    )
                raise
            _run_post_child_hook()
            _fail_if_shutdown(shutdown)
            if result["status"] != "reviewed":
                receipt = _opening_receipt(
                    request, private["scenario_id"], private["generation"],
                    "failed", result["failure_class"], None,
                )
                _fail_if_shutdown(shutdown)
                return receipt
            try:
                module_init_l0 = ops._validate_module_init_l0(
                    result["module_init_l0"]
                )
            except ops.RuntimeOperationError as exc:
                evidence_path = _write_opening_l0_failure_evidence(
                    campaign_dir, request, result["module_init_l0"], str(exc),
                )
                _fail(
                    f"module-init L0 is invalid: {exc}; private diagnostic evidence: "
                    f"{evidence_path.relative_to(workspace)}"
                )
            bundle_indices = sorted(set(selected) | set(fact_evidence))
            _splice_retained_bound_pages(task, selected, fact_evidence)
            bundle = pdf_bundle.load_host_bundle(task["source_bundle_path"])
            # Identity is carried by the strong fields only: source_id,
            # file_sha256, path, the exact page set (and bundle_sha256 at the
            # rebind check below). The source/display title is deliberately
            # excluded: campaign titles are user-facing and renamable (the web
            # flow offers a custom title at creation), so title equality would
            # fail closed on legitimate campaigns without adding any real
            # tamper evidence beyond what bundle_sha256 already covers.
            if (
                [row["pdf_index"] for row in bundle["pages"]] != bundle_indices
                or bundle["source"]["source_id"] != private["source_id"]
                or bundle["source"]["path"] != task["source"]["path"]
                or bundle["source"]["file_sha256"]
                != private["source_file_sha256"]
            ):
                _fail("opening source bundle identity drift")
            _validate_reused_bound_pages(bundle, task)
            _fail_if_shutdown(shutdown)
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
                        # Review rebind lane: pdf_indices the whole-book OCR lane
                        # already cached (cross-producer) are bound by content
                        # address without comparing text; same-pipeline page
                        # evidence must still match exactly.
                        "reference_cached_pages": True,
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
                module_init_l0=module_init_l0,
            )
            _fail_if_shutdown(shutdown)
            return _opening_receipt(
                request, exact["scenario_id"], exact["generation"],
                "reviewed", None, result["facts"],
            )
        except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as exc:
            # The extension turns this non-zero transport exit into a retryable
            # terminal follow-up. Leave local, keeper-only progress evidence so
            # that a post-render death is diagnosable rather than silent.
            _write_opening_transport_failure_evidence(
                campaign_dir, request, task, lock_path, str(exc),
            )
            raise
        finally:
            _leave_producer_lane(handlers, old_mask, shutdown)


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


def _full_parse_worker_result(
    task: dict[str, Any],
    *,
    pack: dict[str, Any],
) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "contract_id": "coc.source-pack-worker.v1",
        "packet_id": f"full-parse:{task['job_id']}",
        "work_group_id": f"source-work-full-{task['asset_root_id']}",
        "status": "usable",
        "results": [{
            "job_id": task["job_id"],
            "pack": pack,
            "related_packs": [],
        }],
    }


def _register_full_parse_bundle(
    task: dict[str, Any],
    workspace: Path,
    output: Path,
    rendered: list[int],
) -> dict[str, Any]:
    """Shared post-producer half-chain: validate, register, fulfill receipt."""
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
    return _full_parse_worker_result(
        task,
        pack={
            "status": "complete" if state.get("complete") else "partial",
            "rendered_pdf_indices": list(rendered),
            "failed_pdf_indices": [],
            "failure_class": None,
        },
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
        return _full_parse_worker_result(
            task,
            pack={
                "status": "complete",
                "rendered_pdf_indices": sorted(requested),
                "failed_pdf_indices": [],
                "failure_class": None,
            },
        )
    batch = missing[: int(task["batch_limit"])]
    output = Path(task["source_bundle_path"]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    # One flag covers router → Pi fallback → validate/register/receipt so a
    # host abort after the child exits still fail-closes before writeback.
    shutdown = _ShutdownFlag()
    handlers, old_mask = _enter_producer_lane(shutdown)
    try:
        routed = _try_external_pdf_router(
            "full_parse_batch",
            task,
            missing_pdf_indices=batch,
            shutdown=shutdown,
        )
        _fail_if_shutdown(shutdown)
        if routed is not None:
            rendered = list(routed["rendered_pdf_indices"])
            if (
                rendered
                and rendered == sorted(set(rendered))
                and set(rendered).issubset(set(batch))
            ):
                _run_post_child_hook()
                _fail_if_shutdown(shutdown)
                result = _register_full_parse_bundle(
                    task, workspace, output, rendered,
                )
                _fail_if_shutdown(shutdown)
                return result
            # Valid contract shape but scope mismatch: keep the old skill path.
        producer_prompt = _FULL_PARSE_PROMPT + json.dumps({
            **task,
            "missing_pdf_indices": batch,
        }, ensure_ascii=False, separators=(",", ":"))
        producer = _run_pi(
            producer_prompt,
            workspace,
            timeout=PI_TIMEOUT_SECONDS,
            shutdown=shutdown,
        )
        _run_post_child_hook()
        _fail_if_shutdown(shutdown)
        if not isinstance(producer, dict):
            _fail("full-parse render producer result is unavailable")
        if (
            set(producer) != {
                "schema_version", "contract_id", "status",
                "rendered_pdf_indices", "failure_class", "source_bundle_path",
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
            result = _full_parse_worker_result(
                task,
                pack={
                    "status": "failed",
                    "failure_class": str(failure_class)[:256],
                },
            )
            _fail_if_shutdown(shutdown)
            return result
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
        result = _register_full_parse_bundle(
            task, workspace, output, list(rendered),
        )
        _fail_if_shutdown(shutdown)
        return result
    finally:
        _leave_producer_lane(handlers, old_mask, shutdown)


def _located_producer_result_from_router(
    task: dict[str, Any], routed: dict[str, Any],
) -> dict[str, Any]:
    """Minimal producer result so _locator_receipt owns bundle authority."""
    bundle_indices = [
        int(page["pdf_index"]) for page in routed["bundle"].get("pages", [])
    ]
    return {
        "schema_version": 1,
        "contract_id": "coc.pi-source-scope-locator-producer-result.v1",
        "job_id": task["job_id"],
        "status": "located",
        "kind": task["kind"],
        "target_id": task["target_id"],
        # Advisory printed-page numbers; receipt re-derives from the bundle.
        "pdf_indices": [index + 1 for index in bundle_indices],
        "source_bundle_path": task["source_bundle_path"],
        "failure_class": None,
    }


def _run() -> dict[str, Any]:
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        _fail("task exceeds input limit")
    task = _validate_task(json.loads(raw.decode()))
    workspace = Path(task["workspace_root"]).resolve()
    if not workspace.is_dir():
        _fail("workspace_root is unavailable")
    # One flag covers optional router + Pi skill + receipt so a host abort
    # after the child exits still fail-closes (no success return).
    shutdown = _ShutdownFlag()
    handlers, old_mask = _enter_producer_lane(shutdown)
    try:
        routed = _try_external_pdf_router(
            "locator_first_bundle", task, shutdown=shutdown,
        )
        # Host abort during router must exit, never fall through to Pi.
        _fail_if_shutdown(shutdown)
        if routed is not None:
            _run_post_child_hook()
            _fail_if_shutdown(shutdown)
            receipt = _locator_receipt(
                task, _located_producer_result_from_router(task, routed),
            )
            _fail_if_shutdown(shutdown)
            return receipt
        producer_result = _run_pi(
            _locator_prompt(task),
            workspace,
            timeout=PI_TIMEOUT_SECONDS,
            allow_non_json_receipt=True,
            shutdown=shutdown,
        )
        # Lane seam after producer returns (also covers mocked _run_pi in tests).
        _run_post_child_hook()
        _fail_if_shutdown(shutdown)
        receipt = _locator_receipt(task, producer_result)
        _fail_if_shutdown(shutdown)
        return receipt
    finally:
        _leave_producer_lane(handlers, old_mask, shutdown)


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
        _SessionLaunchError,
    ) as exc:
        print(f"coc-pdf-skill-adapter: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
