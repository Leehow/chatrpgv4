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
  FAKE_PI_PREFLIGHT_DELAY  seconds before prompt acceptance; transport timeout testing only.
  FAKE_PI_NO_TEXT=1        the scripted turn still calls a tool, but never emits
                           visible assistant text -- exercises settle_class
                           "undelivered_with_tools".
  FAKE_PI_KERNEL_STATE=<path>
                           opt-in only, for tests/play/test_driver.py's resume test.
                           A real kernel's campaign state lives on disk under
                           .coc/campaigns/<id>/ and survives a pi-coc process being
                           killed and restarted (docs/kernel-rpc.md §12.2/§12.6): a
                           second run against the same campaign continues the turn
                           count and, on its first player_input, carries a `resume`
                           note. This fixture has no real kernel behind it, so it
                           fakes just that one observable shape: <path> is a small
                           JSON file (kernel_turn: int) this process reads on startup
                           and rewrites after every prompt. If a *previous* process
                           already advanced it past 0, the *first* prompt this
                           process handles is treated as a post-restart resume: the
                           scripted assistant text and the `look` tool's args/result
                           both say so, in whatever the driver already records
                           verbatim (turn-<n>.json, events.jsonl). Unset by default,
                           so every other test's fixed strings are untouched.
"""
from __future__ import annotations

import json
import os
import sys
import time

_first_prompt_this_process = True


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _load_kernel_state(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"kernel_turn": 0}


def _save_kernel_state(path: str, state: dict) -> None:
    tmp = f"{path}.tmp{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f)
    os.replace(tmp, path)


def _kernel_turn_and_resume() -> tuple[int | None, int | None]:
    """Advance the shared kernel_turn counter one step; report a resume marker only on
    this process's first prompt, and only if some earlier process already committed a
    turn -- mirrors "first player_input after reopen carries resume, the second does
    not" (docs/kernel-rpc.md §12.2). Returns (new_kernel_turn, resumed_from_turn|None),
    or (None, None) when the feature is off."""
    global _first_prompt_this_process
    state_path = os.environ.get("FAKE_PI_KERNEL_STATE")
    if not state_path:
        return None, None
    state = _load_kernel_state(state_path)
    prior_turn = int(state.get("kernel_turn", 0))
    new_turn = prior_turn + 1
    _save_kernel_state(state_path, {"kernel_turn": new_turn})
    resumed_from = prior_turn if (prior_turn > 0 and _first_prompt_this_process) else None
    _first_prompt_this_process = False
    return new_turn, resumed_from


def handle_prompt(cmd: dict) -> None:
    time.sleep(float(os.environ.get("FAKE_PI_PREFLIGHT_DELAY", "0")))
    emit({"id": cmd.get("id"), "type": "response", "command": "prompt", "success": True})

    no_text = os.environ.get("FAKE_PI_NO_TEXT") == "1"
    kernel_turn, resumed_from = _kernel_turn_and_resume()
    text = "" if no_text else "The cellar door creaks open onto a flight of stone steps."
    if text and resumed_from is not None:
        text = f"[resumed: continuing from committed turn {resumed_from}] {text}"

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
    args = {"target": "cellar"}
    result_text = "A dusty cellar, one locked chest."
    if kernel_turn is not None:
        args["kernel_turn"] = kernel_turn
        if resumed_from is not None:
            args["resume"] = {"turn": resumed_from}
            result_text += f" (resume: from turn {resumed_from} to turn {kernel_turn})"
    emit({"type": "tool_execution_start", "toolCallId": tool_call_id, "toolName": "look", "args": args})
    time.sleep(0.05)  # give ms timing something nonzero to measure
    emit({"type": "tool_execution_end", "toolCallId": tool_call_id, "toolName": "look",
          "result": {"content": [{"type": "text", "text": result_text}]},
          "isError": False})

    content = [{"type": "toolCall", "id": tool_call_id, "name": "look", "arguments": args}]
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
