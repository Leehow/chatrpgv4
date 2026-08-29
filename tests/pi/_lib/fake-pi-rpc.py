#!/usr/bin/env python3
"""Fake `pi` RPC binary for driver tests (not the real pi)."""
from __future__ import annotations

import json
import sys
import time


def main() -> int:
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            command = json.loads(line)
        except json.JSONDecodeError:
            continue
        kind = command.get("type")
        if kind == "set_model":
            print(json.dumps({
                "id": command.get("id"),
                "type": "response",
                "command": "set_model",
                "success": True,
            }), flush=True)
        elif kind == "prompt":
            message_text = str(command.get("message", ""))
            print(json.dumps({
                "type": "message_start",
                "message": {"role": "user", "content": [{"type": "text", "text": message_text}]},
            }), flush=True)
            if message_text.startswith("__EMPTY_SETTLE__"):
                # Provider-successful thinking-only terminal with no recovery
                # in flight: the driver must classify this as empty_settle.
                print(json.dumps({
                    "type": "message_end",
                    "message": {
                        "role": "assistant",
                        "stopReason": "stop",
                        "content": [{"type": "thinking", "thinking": "only reasoning"}],
                    },
                }), flush=True)
                print(json.dumps({"type": "agent_settled"}), flush=True)
            elif message_text.startswith("__EMPTY_TOOLS__"):
                # Tools ran but zero visible assistant output: tool activity
                # is not delivery; the driver must classify this as an
                # undelivered settle and exit nonzero.
                print(json.dumps({
                    "type": "tool_execution_start",
                    "tool": "coc_invoke",
                }), flush=True)
                print(json.dumps({
                    "type": "message_end",
                    "message": {
                        "role": "assistant",
                        "stopReason": "stop",
                        "content": [{
                            "type": "toolCall",
                            "id": "call-empty-tools-probe",
                            "name": "coc_invoke",
                            "arguments": {},
                        }],
                    },
                }), flush=True)
                print(json.dumps({
                    "type": "tool_execution_end",
                    "tool": "coc_invoke",
                }), flush=True)
                print(json.dumps({"type": "agent_settled"}), flush=True)
            elif message_text.startswith("__ABORT_RECOVER_DELIVER__"):
                # Evidence-shaped: whitespace abort arms recovery without a
                # pre-recovery agent_settled; the recovered turn delivers
                # visible text and settles once. Sleep after settle so a
                # stale count heuristic would burn the turn timeout.
                print(json.dumps({
                    "type": "entry_appended",
                    "entry": {
                        "type": "custom",
                        "customType": "coc-leading-whitespace-stream-abort",
                        "data": {"status": "aborted"},
                    },
                }), flush=True)
                print(json.dumps({
                    "type": "entry_appended",
                    "entry": {
                        "type": "custom",
                        "customType": "coc-empty-terminal-recovery",
                        "data": {"kind": "empty_terminal_recovery"},
                    },
                }), flush=True)
                print(json.dumps({
                    "type": "message_end",
                    "message": {
                        "role": "assistant",
                        "stopReason": "abort",
                        "content": [{"type": "thinking", "thinking": "only reasoning"}],
                    },
                }), flush=True)
                print(json.dumps({"type": "agent_end", "willRetry": False}), flush=True)
                print(json.dumps({
                    "type": "tool_execution_start",
                    "tool": "coc_invoke",
                }), flush=True)
                print(json.dumps({
                    "type": "tool_execution_end",
                    "tool": "coc_invoke",
                }), flush=True)
                print(json.dumps({
                    "type": "message_end",
                    "message": {
                        "role": "assistant",
                        "stopReason": "stop",
                        "content": [{"type": "text", "text": "abort-recovered KP text"}],
                    },
                }), flush=True)
                print(json.dumps({"type": "agent_settled"}), flush=True)
                time.sleep(30)
            elif message_text.startswith("__SETTLED_RECOVER__"):
                # Tools ran with no visible text, then a claimed
                # settled-output recovery follow-up delivers visible output.
                # Exhausted markers must not keep the wait open by themselves.
                print(json.dumps({
                    "type": "tool_execution_start",
                    "tool": "coc_invoke",
                }), flush=True)
                print(json.dumps({
                    "type": "message_end",
                    "message": {
                        "role": "assistant",
                        "stopReason": "stop",
                        "content": [{
                            "type": "toolCall",
                            "id": "call-settled-recover-probe",
                            "name": "coc_invoke",
                            "arguments": {},
                        }],
                    },
                }), flush=True)
                print(json.dumps({
                    "type": "tool_execution_end",
                    "tool": "coc_invoke",
                }), flush=True)
                print(json.dumps({
                    "type": "entry_appended",
                    "entry": {
                        "type": "custom",
                        "customType": "coc-settled-output-recovery",
                        "data": {"schema_version": 1, "status": "claimed"},
                    },
                }), flush=True)
                print(json.dumps({"type": "agent_settled"}), flush=True)
                print(json.dumps({
                    "type": "message_end",
                    "message": {
                        "role": "assistant",
                        "stopReason": "stop",
                        "content": [{"type": "text", "text": "settled-output recovered KP text"}],
                    },
                }), flush=True)
                print(json.dumps({"type": "agent_settled"}), flush=True)
            elif message_text.startswith("__EMPTY_RECOVER__"):
                # Empty settle followed by the hidden recovery marker, then
                # the recovered follow-up turn delivers visible output and
                # settles again; the driver must wait through both settles.
                print(json.dumps({
                    "type": "message_end",
                    "message": {
                        "role": "assistant",
                        "stopReason": "stop",
                        "content": [{"type": "thinking", "thinking": "only reasoning"}],
                    },
                }), flush=True)
                print(json.dumps({
                    "type": "entry_appended",
                    "entry": {
                        "type": "custom",
                        "customType": "coc-empty-terminal-recovery",
                        "data": {"kind": "empty_terminal_recovery"},
                    },
                }), flush=True)
                print(json.dumps({"type": "agent_settled"}), flush=True)
                print(json.dumps({
                    "type": "message_end",
                    "message": {
                        "role": "assistant",
                        "stopReason": "stop",
                        "content": [{"type": "text", "text": "recovered KP text"}],
                    },
                }), flush=True)
                print(json.dumps({"type": "agent_settled"}), flush=True)
            else:
                print(json.dumps({
                    "type": "message_end",
                    "message": {"role": "assistant", "content": [{"type": "text", "text": "fake KP text"}]},
                }), flush=True)
                # Long enough for the test to kill this process mid-turn.
                time.sleep(30)
                print(json.dumps({"type": "agent_settled"}), flush=True)
        elif kind == "abort":
            print(json.dumps({
                "id": command.get("id"),
                "type": "response",
                "command": "abort",
                "success": True,
            }), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
