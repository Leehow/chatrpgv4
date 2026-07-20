#!/usr/bin/env python3
"""Cross-host lifecycle bridge for durable COC continuation recovery."""
from __future__ import annotations

from copy import deepcopy
import json
import os
from pathlib import Path
import re
import sys
from typing import Any


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = PLUGIN_ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_host_context  # noqa: E402


def _read_payload() -> dict[str, Any]:
    try:
        value = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def _normalized_event(payload: dict[str, Any]) -> str:
    raw = str(
        payload.get("hookEventName")
        or payload.get("hook_event_name")
        or os.environ.get("COC_HOOK_EVENT")
        or ""
    )
    compact = re.sub(r"[^a-z]", "", raw.lower())
    return {
        "sessionstart": "session_start",
        "userpromptsubmit": "user_prompt_submit",
        "precompact": "pre_compact",
        "postcompact": "post_compact",
        "sessionend": "session_end",
        "pretooluse": "pre_tool_use",
    }.get(compact, raw.lower())


def _workspace(payload: dict[str, Any]) -> Path:
    value = (
        payload.get("workspaceRoot")
        or payload.get("cwd")
        or os.environ.get("GROK_WORKSPACE_ROOT")
        or os.environ.get("CLAUDE_PROJECT_DIR")
        or os.getcwd()
    )
    return Path(str(value)).resolve()


def _session_id(payload: dict[str, Any]) -> str:
    return str(
        payload.get("sessionId")
        or payload.get("session_id")
        or os.environ.get("GROK_SESSION_ID")
        or os.environ.get("CODEX_SESSION_ID")
        or os.environ.get("CLAUDE_SESSION_ID")
        or "unknown-host-session"
    )


def _host() -> str:
    if os.environ.get("KIMI_PLUGIN_ROOT") or os.environ.get("KIMI_CODE_HOME"):
        return "kimi"
    if os.environ.get("GROK_SESSION_ID") or os.environ.get("GROK_PLUGIN_ROOT"):
        return "grok"
    if os.environ.get("CODEX_SESSION_ID") or os.environ.get("PLUGIN_ROOT"):
        return "codex"
    if os.environ.get("CLAUDE_SESSION_ID"):
        return "claude"
    return "unknown"


def _emit_allow(
    *,
    updated_input: dict[str, Any] | None = None,
    additional_context: str | None = None,
) -> None:
    if _host() == "kimi":
        # Kimi appends a passing hook's stdout to the model context; a bare
        # allow receipt would be noise. Deny receipts still go over stdout.
        return
    payload: dict[str, Any] = {"decision": "allow"}
    if updated_input is not None or additional_context is not None:
        hook_output: dict[str, Any] = {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
        }
        if updated_input is not None:
            hook_output["updatedInput"] = updated_input
        if additional_context is not None:
            hook_output["additionalContext"] = additional_context
        payload["hookSpecificOutput"] = hook_output
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))


def _emit_deny(reason: str) -> None:
    print(json.dumps(
        {
            "decision": "deny",
            "reason": reason,
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            },
        },
        ensure_ascii=False,
        separators=(",", ":"),
    ))


def _prompt_text(payload: dict[str, Any]) -> str | None:
    for key in ("prompt", "userPrompt", "user_prompt", "message", "text"):
        value = payload.get(key)
        if isinstance(value, str):
            return value
    return None


def _path_values(value: Any, *, parent_key: str = "") -> list[str]:
    found: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).lower()
            if isinstance(child, str) and (
                "path" in normalized or normalized in {"file", "filename"}
            ):
                found.append(child)
            else:
                found.extend(_path_values(child, parent_key=normalized))
    elif isinstance(value, list):
        for child in value:
            found.extend(_path_values(child, parent_key=parent_key))
    return found


def _command_text(tool_input: Any) -> str:
    if not isinstance(tool_input, dict):
        return ""
    for key in ("command", "cmd", "script"):
        value = tool_input.get(key)
        if isinstance(value, str):
            return value
    return ""


def _is_resume_call(tool_name: str, tool_input: Any) -> bool:
    normalized_name = tool_name.lower().replace("-", "_")
    if "session_resume" in normalized_name or "session.resume" in normalized_name:
        return True
    serialized = json.dumps(
        tool_input, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).lower()
    return "session.resume" in serialized or "session_resume" in serialized


def _is_coc_gateway_call(tool_name: str, tool_input: Any) -> bool:
    normalized = tool_name.lower().replace("-", "_")
    if "coc_keeper" in normalized:
        return True
    command = _command_text(tool_input).lower()
    return "coc_toolbox.py" in command


def _resume_input_with_host_context(
    tool_input: Any,
    *,
    marker: dict[str, Any],
) -> dict[str, Any] | None:
    """Bind a Grok resume call to the exact lifecycle hook session.

    Grok's MCP subprocess does not inherit ``GROK_SESSION_ID``.  PreToolUse is
    therefore the only reliable point where the host session and epoch are
    simultaneously known.  Support both the directly listed resume tool and
    the progressive ``coc_invoke`` form.
    """
    if not isinstance(tool_input, dict):
        return None
    updated = deepcopy(tool_input)
    operation = str(updated.get("operation") or "").replace("_", ".").lower()
    if operation == "session.resume":
        nested = updated.get("arguments")
        if not isinstance(nested, dict):
            nested = {}
        else:
            nested = deepcopy(nested)
        nested["host_session_id"] = marker["session_id"]
        nested["context_epoch"] = marker["context_epoch"]
        updated["arguments"] = nested
    else:
        updated["host_session_id"] = marker["session_id"]
        updated["context_epoch"] = marker["context_epoch"]
    return updated


def _direct_coc_mutation(tool_name: str, tool_input: Any) -> bool:
    normalized = tool_name.lower()
    edit_tool = any(
        token in normalized
        for token in ("edit", "write", "search_replace", "multiedit")
    )
    if edit_tool:
        return any(
            "/.coc/" in path.replace("\\", "/")
            or path.replace("\\", "/").endswith("/.coc")
            for path in _path_values(tool_input)
        )
    if not any(token in normalized for token in ("bash", "terminal", "shell")):
        return False
    command = _command_text(tool_input)
    if "coc_toolbox.py" in command:
        return False
    protected = (
        "/.coc/", "toolbox-calls.jsonl", "turn-finalizations.jsonl",
        "table-transcript.jsonl", "pending-turn.json", "world-state.json",
        "pacing-state.json", "delivery-receipts.jsonl",
    )
    mutation = re.search(
        r"(?:^|[;&|]\s*)(?:rm|mv|cp|truncate|tee|sed\s+-i|perl\s+-i)\b"
        r"|(?:>>?|2>)"
        r"|\b(?:write_text|write_bytes|unlink|rmtree|os\.remove)\b",
        command,
    )
    return bool(mutation and any(token in command for token in protected))


def _handle_pre_tool(root: Path, payload: dict[str, Any]) -> None:
    tool_name = str(payload.get("toolName") or payload.get("tool_name") or "")
    tool_input = payload.get("toolInput")
    if tool_input is None:
        tool_input = payload.get("tool_input") or {}
    if _direct_coc_mutation(tool_name, tool_input):
        _emit_deny(
            "Direct .coc/evidence mutation is forbidden. Use the canonical typed, transactional COC operation."
        )
        return
    marker = coc_host_context.pending_marker(
        root, session_id=_session_id(payload)
    )
    if (
        marker is not None
        and _host() == "grok"
        and _is_coc_gateway_call(tool_name, tool_input)
        and _is_resume_call(tool_name, tool_input)
    ):
        updated_input = _resume_input_with_host_context(
            tool_input, marker=marker
        )
        _emit_allow(
            updated_input=updated_input,
            additional_context=(
                "This resume call is bound to the current Grok host session "
                f"and context epoch {marker['context_epoch']}."
            ),
        )
        return
    if (
        marker is not None
        and _is_coc_gateway_call(tool_name, tool_input)
        and not _is_resume_call(tool_name, tool_input)
    ):
        _emit_allow(
            additional_context=(
                "COC context was started or compacted. Prefer one "
                "session.resume for this context epoch before continuing; "
                "this is recovery advice, not a narrative or action gate."
            )
        )
        return
    _emit_allow()


def main() -> int:
    payload = _read_payload()
    event = _normalized_event(payload)
    root = _workspace(payload)
    if not (root / ".coc").is_dir():
        if event == "pre_tool_use":
            _emit_allow()
        return 0
    session_id = _session_id(payload)
    try:
        if event in {"session_start", "pre_compact", "post_compact", "session_end"}:
            marker = coc_host_context.mark_lifecycle(
                root,
                session_id=session_id,
                host=_host(),
                event=event,
                source=(
                    str(payload.get("source"))
                    if payload.get("source") is not None
                    else None
                ),
            )
            if event == "session_start":
                context = (
                    "COC continuation guard is active. If continuing a campaign, "
                    "call session.resume as the first campaign operation; do not "
                    "reread saves or rediscover the full tool catalog. "
                    f"Context epoch: {marker['context_epoch']}."
                )
                print(json.dumps({
                    "systemMessage": context,
                    "hookSpecificOutput": {
                        "hookEventName": "SessionStart",
                        "additionalContext": context,
                    },
                }, ensure_ascii=False, separators=(",", ":")))
            return 0
        if event == "user_prompt_submit":
            prompt = _prompt_text(payload)
            if prompt is not None:
                coc_host_context.record_prompt(
                    root, session_id=session_id, text=prompt
                )
            return 0
        if event == "pre_tool_use":
            _handle_pre_tool(root, payload)
            return 0
    except Exception as exc:
        # Hooks are an extra lifecycle signal; the canonical toolbox performs
        # the same resume gate. Never corrupt a host session because a passive
        # marker could not be updated.
        print(
            f"COC continuation hook failed: {type(exc).__name__}: {exc}",
            file=sys.stderr,
        )
        if event == "pre_tool_use":
            _emit_allow()
        return 0
    if event == "pre_tool_use":
        _emit_allow()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
