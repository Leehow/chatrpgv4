"""Process-reuse and protocol tests for the bounded JSONL adapter pool."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest


def _load():
    path = Path("runtime/adapters/worker_pool.py")
    spec = importlib.util.spec_from_file_location("runtime_worker_pool", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _write_worker(path: Path, *, behavior: str = "echo") -> None:
    path.write_text(
        """import json, os, sys, time
for line in sys.stdin:
    request = json.loads(line)
    if %r == 'sleep':
        time.sleep(1)
    if %r == 'crash':
        sys.exit(7)
    response = {'request_id': request['request_id'], 'pid': os.getpid(), 'payload': request['payload']}
    if %r == 'wrong_id':
        response['request_id'] = 'wrong'
    print(json.dumps(response), flush=True)
""" % (behavior, behavior, behavior),
        encoding="utf-8",
    )


def _pool(worker: Path):
    mod = _load()
    return mod.JsonlWorkerPool(
        command_factory=lambda _key: [sys.executable, str(worker)],
        default_timeout_s=0.4,
    )


def test_reuses_same_scoped_worker_process_for_two_requests(tmp_path):
    worker = tmp_path / "echo.py"
    _write_worker(worker)
    pool = _pool(worker)
    key = {"session_id": "s1", "campaign_id": "c1", "match_id": "m1", "role": "narrator"}
    try:
        first = pool.request(key, {"turn": 1})
        second = pool.request(key, {"turn": 2})
        assert first["pid"] == second["pid"]
        assert second["payload"] == {"turn": 2}
    finally:
        pool.close()


def test_different_session_scope_never_reuses_worker(tmp_path):
    worker = tmp_path / "echo.py"
    _write_worker(worker)
    pool = _pool(worker)
    try:
        one = pool.request({"session_id": "s1", "campaign_id": "c1", "match_id": "m1", "role": "player"}, {})
        two = pool.request({"session_id": "s2", "campaign_id": "c1", "match_id": "m1", "role": "player"}, {})
        assert one["pid"] != two["pid"]
    finally:
        pool.close()


@pytest.mark.parametrize("behavior", ["sleep", "crash", "wrong_id"])
def test_timeout_crash_or_bad_protocol_retires_worker(tmp_path, behavior):
    worker = tmp_path / "worker.py"
    _write_worker(worker, behavior=behavior)
    pool = _pool(worker)
    key = {"session_id": "s1", "campaign_id": "c1", "match_id": "m1", "role": "narrator"}
    try:
        with pytest.raises(RuntimeError):
            pool.request(key, {"turn": 1}, timeout_s=0.05)
        assert pool.worker_count == 0
    finally:
        pool.close()
