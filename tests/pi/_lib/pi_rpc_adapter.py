"""Development scaffold: one long-lived `pi --mode rpc` session.

NOT part of the product; `plugins/` imports nothing from here. It exists
because the one-shot `pi -p` adapter could not be relied on: the same prompt
sent six times returned in 5.0s, hung, returned in 56.4s, hung, 5.2s, 5.7s,
and a later run hung six times in a row. The bad windows last minutes, so a
retry count does not help inside one.

The long-lived channel is the one this machine has actually proven: the
playtest driver held a `pi --mode rpc` session for dozens of turns, each
carrying tens of kilobytes of scene context. Same protocol here, minus the
campaign: a JSON command per line on stdin, streamed events on stdout.

The product does not need any of this. It already holds a session -- the one
running the Keeper -- and injects its own `ask`.
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from typing import Any

MODEL = os.environ.get("COC_BUILD_MODEL", "xai/grok-4.5")
THINKING = os.environ.get("COC_BUILD_THINKING", "low")
TIMEOUT = float(os.environ.get("COC_BUILD_TIMEOUT", "600"))
IDLE_SETTLE = float(os.environ.get("COC_BUILD_IDLE_SETTLE", "6"))


class _Session:
    def __init__(self) -> None:
        self.proc = subprocess.Popen(
            ["pi", "--mode", "rpc", "--no-session", "--no-tools",
             "--no-context-files", "--model", MODEL, "--thinking", THINKING],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, text=True, bufsize=1,
        )
        self.lines: list[str] = []
        self.lock = threading.Lock()
        threading.Thread(target=self._pump, daemon=True).start()

    def _pump(self) -> None:
        assert self.proc.stdout is not None
        for line in self.proc.stdout:
            with self.lock:
                self.lines.append(line)

    def ask(self, message: str) -> str:
        with self.lock:
            start = len(self.lines)
        request = {"id": f"p-{int(time.time()*1000)}", "type": "prompt",
                   "message": message}
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(request, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()

        # Wait for `turn_end`, the session's own terminal marker. Settling on
        # silence instead returned empty text: this model thinks first, and a
        # thinking stream that pauses looks exactly like a finished answer.
        # The observed subtypes are thinking_start/thinking_delta/thinking_end
        # then text_start/text_delta/text_end, so visible text can begin long
        # after the first quiet stretch.
        deadline = time.time() + TIMEOUT
        while time.time() < deadline:
            with self.lock:
                rows = self.lines[start:]
            if any('"turn_end"' in row for row in rows):
                return _assistant_text(rows)
            time.sleep(0.3)
        with self.lock:
            rows = self.lines[start:]
        text = _assistant_text(rows)
        if text:
            # A late answer is still an answer; the timeout only bounds the wait.
            return text
        raise RuntimeError(f"no visible reply within {TIMEOUT}s")


def _assistant_text(rows: list[str]) -> str:
    out: list[str] = []
    for row in rows:
        try:
            event = json.loads(row)
        except json.JSONDecodeError:
            continue
        chunk = _text_of(event)
        if chunk:
            out.append(chunk)
    return "".join(out)


def _text_of(event: Any) -> str:
    if not isinstance(event, dict):
        return ""
    inner = event.get("assistantMessageEvent")
    if isinstance(inner, dict) and inner.get("type") == "text_delta":
        return str(inner.get("delta") or "")
    if event.get("type") == "text_delta":
        return str(event.get("delta") or "")
    return ""


_SESSION: _Session | None = None


def ask(instruction: str, payload: str) -> str:
    global _SESSION
    if _SESSION is None or _SESSION.proc.poll() is not None:
        _SESSION = _Session()
    return _SESSION.ask(f"{instruction}\n\n---\n\n{payload}\n")
