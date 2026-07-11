"""Scoped, persistent JSON-lines worker transport for model adapters.

Workers are deliberately keyed by all ownership dimensions.  A process can
retain an agent session across turns for *one* session/campaign/match/role,
but never crosses any of those boundaries.  The pool accepts one framed JSON
request and exactly one framed JSON response per call; crashes, timeouts and
protocol violations retire the process before a later request can reuse it.
"""
import json
import os
import select
import subprocess
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence


@dataclass(frozen=True, slots=True)
class WorkerKey:
    session_id: str
    campaign_id: str
    match_id: str
    role: str

    def __post_init__(self) -> None:
        for field_name in ("session_id", "campaign_id", "match_id", "role"):
            value = getattr(self, field_name)
            if not isinstance(value, str) or not value.strip():
                raise ValueError(f"worker key {field_name} must be a non-empty string")


def scoped_worker_key(
    *, session_id: str, campaign_id: str, match_id: str, role: str,
) -> WorkerKey:
    return WorkerKey(session_id, campaign_id, match_id, role)


def _normalize_key(value: WorkerKey | Mapping[str, Any] | str) -> WorkerKey:
    if isinstance(value, WorkerKey):
        return value
    if isinstance(value, str):
        # Compatibility for low-level tests/one-purpose callers.  A caller
        # choosing this form has one isolated scope, rather than an implicit
        # global process shared with normal session keys.
        return WorkerKey(value, "__legacy_campaign__", "__legacy_match__", "__legacy_role__")
    if isinstance(value, Mapping) and set(value) == {
        "session_id", "campaign_id", "match_id", "role",
    }:
        if not all(isinstance(value[name], str) for name in value):
            raise ValueError("worker_key fields must be strings")
        return WorkerKey(
            value["session_id"], value["campaign_id"],
            value["match_id"], value["role"],
        )
    raise ValueError("worker_key must contain exact session_id/campaign_id/match_id/role")


@dataclass
class _Worker:
    process: subprocess.Popen[str]
    lock: threading.RLock = field(default_factory=threading.RLock)


class JsonlWorkerPool:
    """Own server-mode adapter processes and provide serialized RPCs.

    ``command_factory`` receives a :class:`WorkerKey` and must return the
    command for a JSONL server.  Adapter commands normally end in ``--server``.
    The factory makes this transport testable and keeps command selection out
    of untrusted request data.
    """

    def __init__(
        self,
        command_factory: Callable[[WorkerKey], Sequence[str]] | None = None,
        *,
        runner_factory: Callable[[WorkerKey], Sequence[str]] | None = None,
        default_timeout_s: float = 300.0,
        cwd: Path | str | None = None,
    ) -> None:
        factory = command_factory or runner_factory
        if factory is None or not callable(factory):
            raise TypeError("JsonlWorkerPool requires command_factory")
        if (
            isinstance(default_timeout_s, bool)
            or not isinstance(default_timeout_s, (int, float))
            or default_timeout_s <= 0
        ):
            raise ValueError("default_timeout_s must be positive")
        self._command_factory = factory
        self._default_timeout_s = float(default_timeout_s)
        self._cwd = str(Path(cwd).resolve()) if cwd is not None else None
        self._lock = threading.RLock()
        self._workers: dict[WorkerKey, _Worker] = {}
        self._closed = False

    @property
    def worker_count(self) -> int:
        with self._lock:
            return len(self._workers)

    def _start(self, key: WorkerKey) -> _Worker:
        command = list(self._command_factory(key))
        if not command or not all(isinstance(piece, str) and piece for piece in command):
            raise RuntimeError("worker command factory returned an invalid command")
        try:
            process = subprocess.Popen(
                command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                bufsize=1,
                cwd=self._cwd,
                close_fds=True,
            )
        except OSError as exc:
            raise RuntimeError(f"failed to start adapter worker: {command[0]}") from exc
        if process.stdin is None or process.stdout is None:  # pragma: no cover - Popen contract
            process.kill()
            raise RuntimeError("adapter worker lacks stdio pipes")
        worker = _Worker(process)
        self._workers[key] = worker
        return worker

    def _retire(self, key: WorkerKey, worker: _Worker) -> None:
        with self._lock:
            if self._workers.get(key) is worker:
                self._workers.pop(key, None)
        process = worker.process
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=0.25)
            except subprocess.TimeoutExpired:
                process.kill()
                try:
                    process.wait(timeout=0.25)
                except subprocess.TimeoutExpired:  # pragma: no cover - hostile process
                    pass
        for stream in (process.stdin, process.stdout):
            try:
                if stream is not None:
                    stream.close()
            except OSError:
                pass

    @staticmethod
    def _read_line(process: subprocess.Popen[str], timeout_s: float) -> str:
        assert process.stdout is not None
        ready, _write, _err = select.select([process.stdout], [], [], timeout_s)
        if not ready:
            raise TimeoutError("adapter worker timed out")
        line = process.stdout.readline()
        if not line:
            code = process.poll()
            raise RuntimeError(
                "adapter worker closed stdout" if code is None
                else f"adapter worker exited with code {code}"
            )
        return line

    def request(
        self,
        worker_key: WorkerKey | Mapping[str, Any] | str,
        payload: Mapping[str, Any],
        timeout_s: float | None = None,
    ) -> dict[str, Any]:
        """Make one framed request, retiring the worker on every unsafe result."""
        if not isinstance(payload, Mapping):
            raise ValueError("worker payload must be a JSON object")
        key = _normalize_key(worker_key)
        timeout = self._default_timeout_s if timeout_s is None else timeout_s
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or timeout <= 0:
            raise ValueError("timeout_s must be positive")
        with self._lock:
            if self._closed:
                raise RuntimeError("worker pool is closed")
            worker = self._workers.get(key)
            if worker is None or worker.process.poll() is not None:
                if worker is not None:
                    self._retire(key, worker)
                worker = self._start(key)
        request_id = uuid.uuid4().hex
        try:
            encoded = json.dumps(
                {"request_id": request_id, "payload": dict(payload)},
                ensure_ascii=False, separators=(",", ":"), allow_nan=False,
            )
        except (TypeError, ValueError) as exc:
            self._retire(key, worker)
            raise ValueError("worker payload must be JSON serializable") from exc
        try:
            with worker.lock:
                if worker.process.poll() is not None:
                    raise RuntimeError("adapter worker exited before request")
                assert worker.process.stdin is not None
                worker.process.stdin.write(encoded + "\n")
                worker.process.stdin.flush()
                line = self._read_line(worker.process, float(timeout))
            parsed = json.loads(line)
            if not isinstance(parsed, dict):
                raise RuntimeError("adapter worker response must be a JSON object")
            if parsed.get("request_id") != request_id:
                raise RuntimeError("adapter worker response request_id mismatch")
            parsed.pop("request_id", None)
            return parsed
        except (BrokenPipeError, OSError, TimeoutError, json.JSONDecodeError, RuntimeError) as exc:
            self._retire(key, worker)
            if isinstance(exc, RuntimeError):
                raise
            raise RuntimeError(str(exc)) from exc

    def close_scope(self, worker_key: WorkerKey | Mapping[str, Any] | str) -> None:
        key = _normalize_key(worker_key)
        with self._lock:
            worker = self._workers.get(key)
        if worker is not None:
            self._retire(key, worker)

    def close(self) -> None:
        with self._lock:
            self._closed = True
            entries = list(self._workers.items())
        for key, worker in entries:
            self._retire(key, worker)

    def __enter__(self) -> "JsonlWorkerPool":
        return self

    def __exit__(self, *_args: Any) -> None:
        self.close()

    def __del__(self) -> None:  # pragma: no cover - emergency cleanup only
        try:
            self.close()
        except Exception:
            pass


__all__ = ["JsonlWorkerPool", "WorkerKey", "scoped_worker_key"]
