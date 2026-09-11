#!/usr/bin/env python3
"""Fake persona-player pi, for tests/play/test_persona_bench.py only.

Speaks the same slice of node_modules/@earendil-works/pi-coding-agent/docs/rpc.md that
tests/play/fixtures/fake_pi_rpc.py does, but plays the other side of the table: every
`prompt` is answered with the one JSON object a persona agent owes
(docs/specs/player-persona-benchmark.md section 3), so the benchmark's turn loop can be
exercised end to end without a model.

It also proves its own isolation to the test: it records its argv, cwd and the presence of
PI_CODING_AGENT_DIR into FAKE_PERSONA_RECORD, if that path is set.

Env vars:
  FAKE_PERSONA_RECORD   path to write a JSON record of argv/cwd/home to.
  FAKE_PERSONA_GARBAGE  reply with unparseable text this many times before behaving.
"""
from __future__ import annotations

import json
import os
import sys

_turn = 0
_garbage_left = int(os.environ.get("FAKE_PERSONA_GARBAGE", "0"))


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def record() -> None:
    path = os.environ.get("FAKE_PERSONA_RECORD")
    if not path:
        return
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"argv": sys.argv[1:], "cwd": os.getcwd(),
                   "pi_home": os.environ.get("PI_CODING_AGENT_DIR"),
                   "home_files": sorted(os.listdir(os.environ.get("PI_CODING_AGENT_DIR", ".")))}, f)


def reply(message: str) -> str:
    global _turn, _garbage_left
    _turn += 1
    if _garbage_left > 0:
        _garbage_left -= 1
        return "I am afraid I cannot answer in JSON today."
    return json.dumps({
        "player_message": f"persona turn {_turn}",
        "private_eval": {"current_goal": "find the house", "current_hypothesis": "the landlord lies",
                         "hypothesis_confidence": 0.5, "perceived_agency": 7,
                         "confusion": 2, "engagement": 8, "frustration": 1},
    }, ensure_ascii=False)


def main() -> int:
    record()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            command = json.loads(line)
        except json.JSONDecodeError:
            continue
        kind, req_id = command.get("type"), command.get("id")
        if kind in ("get_state", "set_model", "abort"):
            data = {"isStreaming": False} if kind == "get_state" else {}
            emit({"id": req_id, "type": "response", "success": True, "data": data})
            continue
        if kind != "prompt":
            emit({"id": req_id, "type": "response", "success": False, "error": f"unknown {kind}"})
            continue
        emit({"id": req_id, "type": "response", "success": True, "data": {}})
        text = reply(command.get("message") or "")
        emit({"type": "turn_start"})
        emit({"type": "message_update", "assistantMessageEvent": {"type": "text_delta", "delta": text}})
        emit({"type": "message_end", "message": {"role": "assistant",
                                                 "content": [{"type": "text", "text": text}]}})
        emit({"type": "agent_end"})
        emit({"type": "agent_settled"})
    return 0


if __name__ == "__main__":
    sys.exit(main())
