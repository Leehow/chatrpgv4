#!/usr/bin/env python3
"""Small process-boundary fixture for the DebugExperiment RPC lane."""
from __future__ import annotations

import json
import os
import sys


def emit(value: dict) -> None:
    print(json.dumps(value, ensure_ascii=False), flush=True)


def tool(name: str, *, rendered_text: str | None = None) -> None:
    emit({"type": "tool_execution_start", "toolName": name})
    details = {"ok": True, "tool": name}
    if rendered_text is not None:
        details["data"] = {"rendered_text": rendered_text}
    emit({
        "type": "tool_execution_end",
        "toolName": name,
        "isError": False,
        "result": {"details": details},
    })


def main() -> int:
    mode = os.environ.get("FAKE_DEBUG_MODE", "success")
    if mode == "process-exit":
        print(
            "pi-coc: missing agent settings; api_key=fixture-secret",
            file=sys.stderr,
            flush=True,
        )
        return 64
    resumed = False
    prompt_log = os.environ.get("FAKE_DEBUG_PROMPT_LOG")
    for raw in sys.stdin:
        command = json.loads(raw)
        kind = command.get("type")
        if kind == "prompt" and prompt_log:
            # Tests read back exactly what the host sent on the prompt channel.
            with open(prompt_log, "a", encoding="utf-8") as handle:
                handle.write(json.dumps({
                    "id": command.get("id"),
                    "message": command.get("message"),
                }, ensure_ascii=False) + "\n")
        if kind == "prompt" and not resumed:
            emit({"type": "agent_start"})
            emit({
                "type": "message_start",
                "message": {
                    "role": "assistant",
                    "provider": "coding-relay" if mode == "wrong-provider" else "xai",
                    "model": "grok-4.6",
                    "content": [],
                },
            })
            if mode == "timeout-resume":
                emit({
                    "type": "message_update",
                    "assistantMessageEvent": {"type": "thinking_delta", "delta": "."},
                })
                continue
            if mode == "preflight-read":
                tool("read")
            tool("coc_scene_context" if mode == "wrong-resume" else "coc_session_resume")
            emit({"type": "agent_end", "willRetry": False})
            emit({"type": "agent_settled"})
            resumed = True
        elif kind == "prompt":
            emit({"type": "agent_start"})
            emit({
                "type": "message_start",
                "message": {
                    "role": "assistant",
                    "provider": "xai",
                    "model": "grok-4.6",
                    "content": [],
                },
            })
            if mode == "timeout":
                emit({
                    "type": "message_update",
                    "assistantMessageEvent": {"type": "thinking_delta", "delta": "."},
                })
                continue
            tool("coc_rules_settle")
            tool("coc_turn_finalize", rendered_text="伤口已重新包扎。")
            emit({
                "type": "message_end",
                "message": {
                    "role": "assistant",
                    "stopReason": "stop",
                    "content": [{"type": "text", "text": "伤口已重新包扎。"}],
                },
            })
            emit({"type": "agent_end", "willRetry": False})
            emit({"type": "agent_settled"})
        elif kind == "abort":
            emit({
                "type": "response",
                "id": command.get("id"),
                "command": "abort",
                "success": True,
            })
            emit({"type": "agent_settled"})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
