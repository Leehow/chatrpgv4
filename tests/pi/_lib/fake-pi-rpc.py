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
            print(json.dumps({
                "type": "message_start",
                "message": {"role": "user", "content": [{"type": "text", "text": command.get("message", "")}]},
            }), flush=True)
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
