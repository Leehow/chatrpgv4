#!/usr/bin/env python3
"""Fake Pi RPC process, for tests/play/test_driver.py only.

Speaks just enough of the protocol in
node_modules/@earendil-works/pi-coding-agent/docs/rpc.md to exercise
tests/play/driver.py without a real LLM: `get_state`, `set_model`, and
`abort` all succeed trivially. A `prompt` always replies with an accepted
`response`, then synchronously plays out one scripted turn: `agent_start`,
a streamed text_delta run, one `tool_execution_start`/`tool_execution_end`
pair (so `ms` timing has something real to measure), `message_end`,
`agent_end`.

Ignores its own argv (`--campaign ... --mode rpc --no-session`) -- driver.py
invokes this file itself as the launcher via `--launcher`, exactly as it
would invoke the real `bin/pi-coc`.

Env vars:
  FAKE_PI_NO_TEXT=1   the scripted turn still calls a tool, but never emits
                      visible assistant text -- exercises settle_class
                      "undelivered_with_tools".
"""
from __future__ import annotations

import json
import os
import sys
import time


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def handle_prompt(cmd: dict) -> None:
    emit({"id": cmd.get("id"), "type": "response", "command": "prompt", "success": True})

    no_text = os.environ.get("FAKE_PI_NO_TEXT") == "1"
    text = "" if no_text else "The cellar door creaks open onto a flight of stone steps."

    emit({"type": "agent_start"})
    emit({"type": "message_start", "message": {"role": "assistant", "content": []}})

    if text:
        emit({"type": "message_update", "usage": {},
              "assistantMessageEvent": {"type": "text_start", "contentIndex": 0}})
        mid = len(text) // 2
        for chunk in (text[:mid], text[mid:]):
            emit({"type": "message_update", "usage": {},
                  "assistantMessageEvent": {"type": "text_delta", "contentIndex": 0, "delta": chunk}})
        emit({"type": "message_update", "usage": {},
              "assistantMessageEvent": {"type": "text_end", "contentIndex": 0, "content": text}})

    tool_call_id = "call_fake_1"
    emit({"type": "tool_execution_start", "toolCallId": tool_call_id, "toolName": "look",
          "args": {"target": "cellar"}})
    time.sleep(0.05)  # give ms timing something nonzero to measure
    emit({"type": "tool_execution_end", "toolCallId": tool_call_id, "toolName": "look",
          "result": {"content": [{"type": "text", "text": "A dusty cellar, one locked chest."}]},
          "isError": False})

    content = [{"type": "toolCall", "id": tool_call_id, "name": "look", "arguments": {"target": "cellar"}}]
    if text:
        content.append({"type": "text", "text": text})
    message = {"role": "assistant", "content": content}
    emit({"type": "message_end", "message": message})
    emit({"type": "agent_end", "messages": [message], "willRetry": False})
    emit({"type": "agent_settled"})


def main() -> int:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError:
            continue
        ctype = cmd.get("type")
        if ctype == "prompt":
            handle_prompt(cmd)
        elif ctype == "get_state":
            emit({"id": cmd.get("id"), "type": "response", "command": "get_state", "success": True,
                  "data": {"model": None, "isStreaming": False}})
        elif ctype == "set_model":
            emit({"id": cmd.get("id"), "type": "response", "command": "set_model", "success": True,
                  "data": {"id": cmd.get("modelId"), "provider": cmd.get("provider")}})
        elif ctype == "abort":
            emit({"id": cmd.get("id"), "type": "response", "command": "abort", "success": True})
        else:
            emit({"id": cmd.get("id"), "type": "response", "command": ctype, "success": False,
                  "error": f"fake_pi_rpc: unhandled command {ctype!r}"})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
