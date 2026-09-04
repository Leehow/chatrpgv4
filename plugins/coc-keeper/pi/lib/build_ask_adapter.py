"""The pi-coc host's `ask` injection for the module-build driver.

`coc_module_build` never calls a model; the host injects one. This module is
the pi-coc track's injection: one long-lived `pi --mode rpc` session using the
same resolved Pi CLI and the same isolated agent home the `pi-coc` launcher
prepared. The PipiUI/Electron host injects its own app session instead --
which is the same model already running the Keeper -- and never touches this
file. Nothing here is imported by `plugins/coc-keeper/scripts/`; the import
direction is strictly host -> driver.

Why a long-lived session and not `pi -p`: measured on this machine, one-shot
calls to the provider hang intermittently in minutes-long bad windows (six
identical prompts: 5.0s, hang, 56.4s, hang, 5.2s, 5.7s), while the playtest
rpc channel held dozens of turns of tens of kilobytes each. The driver loop
needs a channel that survives a whole build, so the build gets the channel
shape the table already proved.

Promoted from `tests/pi/_lib/pi_rpc_adapter.py` (the development scaffold the
unattended proof ran on). That scaffold stays in tests as the evidence-run
record; this file is the product entry for the pi-coc track.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
import threading
import time
from typing import Any

MODEL = os.environ.get("COC_BUILD_MODEL", "xai/grok-4.5")
THINKING = os.environ.get("COC_BUILD_THINKING", "low")
# The wait is activity-bounded, not clock-bounded: a section can legitimately
# stream for ten minutes, and a provider hang looks identical until it never
# recovers. Silence for IDLE_TIMEOUT is what convicts the hang.
IDLE_TIMEOUT = float(os.environ.get("COC_BUILD_IDLE_TIMEOUT", "240"))


# One pilot driver died mid-build when a single ask saw no reply for 600s.
# The ask is idempotent -- instruction and payload carry everything -- so a
# transport failure is retried here, on a fresh session, and only here: the
# driver retries replies that FAILED the gates, which is a different thing
# and stays separate.
TRANSPORT_ATTEMPTS = int(os.environ.get("COC_BUILD_TRANSPORT_ATTEMPTS", "3"))


def _pi_command() -> list[str]:
    """The Pi CLI the launcher resolved, in its spawnable form.

    `pi-coc` exports the validated path as COC_PI_CLI; a `.js`/`.mjs` entry is
    spawned through `node` exactly as the launcher's own exec does. Outside
    `pi-coc` (development), fall back to whatever `pi` is on PATH.
    """
    cli = os.environ.get("COC_PI_CLI", "pi")
    if cli.endswith((".js", ".mjs")):
        return ["node", cli]
    return [cli]


class _Session:
    def __init__(self) -> None:
        self.proc = subprocess.Popen(
            [*_pi_command(), "--mode", "rpc", "--no-session", "--no-tools",
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
        # after the first quiet stretch. Any incoming line counts as activity
        # and resets the idle clock; only unbroken silence convicts a hang.
        last_total = start
        last_activity = time.time()
        while True:
            time.sleep(0.3)
            with self.lock:
                total = len(self.lines)
                rows = self.lines[start:]
            if total != last_total:
                last_total = total
                last_activity = time.time()
            if any('"turn_end"' in row for row in rows):
                return _assistant_text(rows)
            if time.time() - last_activity > IDLE_TIMEOUT:
                text = _assistant_text(rows)
                if text:
                    # A late answer is still an answer; the idle bound only
                    # ends the wait.
                    return text
                raise TransportHang(
                    f"no stream activity for {IDLE_TIMEOUT}s"
                )


class TransportHang(RuntimeError):
    """The channel went silent; retrying the same ask is safe and correct."""


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


# One session per calling thread. A session carries one prompt at a time --
# `ask` reads the stream slice its own prompt produced -- so concurrency is a
# matter of having more sessions, not of multiplexing one. Keeping the pool
# here rather than in the driver leaves `Ask` a plain (instruction, payload)
# callable: a host that injects its own model does not inherit a pool it does
# not need, it only has to be safe to call from several threads.
#
# Measured before adopting: three concurrent sessions answered the same prompt
# in 5.5/5.2/5.8s with a 5.8s wall clock, against 16.4s run one after another.
_SESSIONS = threading.local()
# Every session opened, so a build can end them all at once; thread-local
# storage alone cannot be walked from outside the thread that filled it.
_OPEN: list["_Session"] = []


def ask(instruction: str, payload: str) -> str:
    message = f"{instruction}\n\n---\n\n{payload}\n"
    last_error: Exception | None = None
    for _ in range(TRANSPORT_ATTEMPTS):
        session = getattr(_SESSIONS, "session", None)
        if session is None or session.proc.poll() is not None:
            session = _Session()
            _SESSIONS.session = session
            _OPEN.append(session)
        try:
            return session.ask(message)
        except TransportHang as error:
            # A hanged session is poison: the next attempt gets a fresh one.
            last_error = error
            _drop_session()
    raise RuntimeError(
        f"no reply after {TRANSPORT_ATTEMPTS} transport attempts"
    ) from last_error


def _drop_session() -> None:
    session = getattr(_SESSIONS, "session", None)
    _SESSIONS.session = None
    if session is not None and session.proc.poll() is None:
        session.proc.kill()


def close_sessions() -> None:
    """End every session this process opened. Called once, when a build ends.

    Not per chunk: pool threads are reused, so closing after each one would
    respawn a session for the next -- which is the cost the long-lived channel
    exists to avoid.
    """
    while _OPEN:
        session = _OPEN.pop()
        if session.proc.poll() is None:
            session.proc.kill()

# --- the reading agent -------------------------------------------------------
#
# `ask` above stays for the planning step, whose reply is a few hundred bytes
# and fits one message comfortably. Reading a section does not: the shard runs
# past a hundred thousand characters, and a single completion tops out near
# forty-seven thousand. So a section is read by an agent with tools, which
# opens the packet itself, writes the shard to a file over as many turns as it
# needs, and runs the gates on itself before handing back.
#
# `--approve` grants the tools; it grants no trust. The driver re-runs the same
# gates over the file the agent left, because an agent reporting a success it
# did not have is precisely what this pipeline exists to catch.

READ_TOOLS = os.environ.get("COC_BUILD_READ_TOOLS", "read,write,edit,bash")
READ_TIMEOUT = float(os.environ.get("COC_BUILD_READ_TIMEOUT", "3600"))


def read_with_agent(work_dir: "Path", brief: str) -> None:
    """Run one reading agent over one prepared work dir. Output is on disk."""
    command = [
        *_pi_command(), "--mode", "text", "-p", "--no-session",
        "--no-context-files", "--approve", "--tools", READ_TOOLS,
        "--model", MODEL, "--thinking", THINKING, brief,
    ]
    log = Path(work_dir) / "agent.log"
    with log.open("w", encoding="utf-8") as handle:
        completed = subprocess.run(
            command, stdout=handle, stderr=subprocess.STDOUT,
            text=True, timeout=READ_TIMEOUT,
        )
    if completed.returncode != 0:
        # Not raised as a failure of the section: the agent may have written a
        # usable shard before dying, and the gates are what decide. The exit
        # code is left in the log next to whatever it produced.
        log.open("a", encoding="utf-8").write(
            f"\n[adapter] agent exited {completed.returncode}\n"
        )
