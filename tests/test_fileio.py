"""Tests for atomic JSON/text persistence helpers (coc_fileio)."""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

SCRIPT = (
    Path(__file__).resolve().parents[1]
    / "plugins"
    / "coc-keeper"
    / "scripts"
    / "coc_fileio.py"
)


def _load_fileio():
    spec = importlib.util.spec_from_file_location("coc_fileio", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def fileio():
    return _load_fileio()


def test_write_json_atomic_matches_plain_dumps(tmp_path, fileio):
    payload = {"name": "调查员", "n": 1, "nested": {"ok": True}}
    expected = json.dumps(payload, ensure_ascii=False, indent=2)

    target = tmp_path / "save" / "state.json"
    fileio.write_json_atomic(target, payload, indent=2, ensure_ascii=False, trailing_newline=False)

    assert target.read_text(encoding="utf-8") == expected


def test_write_json_atomic_trailing_newline_flag(tmp_path, fileio):
    payload = {"a": 1}
    target = tmp_path / "with-nl.json"
    fileio.write_json_atomic(target, payload, trailing_newline=True)
    text = target.read_text(encoding="utf-8")
    assert text.endswith("\n")
    assert text == json.dumps(payload, ensure_ascii=False, indent=2) + "\n"

    target2 = tmp_path / "no-nl.json"
    fileio.write_json_atomic(target2, payload, trailing_newline=False)
    text2 = target2.read_text(encoding="utf-8")
    assert not text2.endswith("\n")
    assert text2 == json.dumps(payload, ensure_ascii=False, indent=2)


def test_replace_failure_leaves_original_intact(tmp_path, fileio, monkeypatch):
    target = tmp_path / "campaign.json"
    original = {"version": 1, "safe": True}
    target.write_text(json.dumps(original, ensure_ascii=False, indent=2), encoding="utf-8")
    before = target.read_text(encoding="utf-8")

    def boom(src, dst):
        raise OSError("simulated crash during replace")

    monkeypatch.setattr(os, "replace", boom)

    with pytest.raises(OSError, match="simulated crash"):
        fileio.write_json_atomic(
            target,
            {"version": 2, "safe": False, "truncated": "x" * 100},
            trailing_newline=False,
        )

    assert target.read_text(encoding="utf-8") == before
    assert json.loads(before) == original


def test_advisory_file_lock_releases_when_holder_dies(tmp_path, fileio):
    """The stable empty flock file is not an orphaned lock after a crash."""
    lock_path = tmp_path / "opening-source-review-transport.lock"
    ready_path = tmp_path / "holder-ready"
    holder = subprocess.Popen(
        [
            sys.executable,
            "-c",
            (
                "import fcntl, os, sys, time; "
                "fd=os.open(sys.argv[1], os.O_CREAT|os.O_RDWR, 0o600); "
                "fcntl.flock(fd, fcntl.LOCK_EX); "
                "open(sys.argv[2], 'w').write('ready'); time.sleep(30)"
            ),
            str(lock_path),
            str(ready_path),
        ],
    )
    try:
        deadline = time.monotonic() + 5
        while not ready_path.exists():
            assert holder.poll() is None
            assert time.monotonic() < deadline
            time.sleep(0.01)
        holder.kill()
        holder.wait(timeout=5)
        # The path remains as a reusable flock inode, but the dead descriptor
        # cannot block a fresh opening-review transport.
        with fileio.advisory_file_lock(lock_path, wait_seconds=0.2):
            assert lock_path.is_file()
    finally:
        if holder.poll() is None:
            holder.kill()
            holder.wait(timeout=5)


def test_campaign_lock_exclusive(tmp_path, fileio):
    campaign_dir = tmp_path / "campaigns" / "c1"
    campaign_dir.mkdir(parents=True)

    with fileio.campaign_lock(campaign_dir, stale_minutes=30):
        lock_path = campaign_dir / ".campaign.lock"
        assert lock_path.exists()
        with pytest.raises(fileio.CampaignLockError, match="held"):
            with fileio.campaign_lock(campaign_dir, stale_minutes=30):
                pass

    assert not (campaign_dir / ".campaign.lock").exists()


def test_campaign_lock_clears_stale_dead_pid(tmp_path, fileio, monkeypatch):
    campaign_dir = tmp_path / "campaigns" / "c1"
    campaign_dir.mkdir(parents=True)
    lock_path = campaign_dir / ".campaign.lock"
    # PID 2^31-1 is almost certainly not alive on this host.
    dead_pid = 2_147_483_647
    lock_path.write_text(
        json.dumps({"pid": dead_pid, "acquired_at": time.time() - 10}),
        encoding="utf-8",
    )

    with fileio.campaign_lock(campaign_dir, stale_minutes=30):
        payload = json.loads(lock_path.read_text(encoding="utf-8"))
        assert payload["pid"] == os.getpid()


def test_campaign_lock_clears_stale_by_age(tmp_path, fileio, monkeypatch):
    campaign_dir = tmp_path / "campaigns" / "c1"
    campaign_dir.mkdir(parents=True)
    lock_path = campaign_dir / ".campaign.lock"
    lock_path.write_text(
        json.dumps({"pid": os.getpid(), "acquired_at": time.time() - 3600}),
        encoding="utf-8",
    )

    with fileio.campaign_lock(campaign_dir, stale_minutes=1):
        payload = json.loads(lock_path.read_text(encoding="utf-8"))
        assert payload["pid"] == os.getpid()
        assert payload["acquired_at"] > time.time() - 60


@pytest.mark.parametrize("contents", ["", "{not-json", "{}"])
def test_campaign_lock_does_not_remove_fresh_unreadable_lock(
    tmp_path,
    fileio,
    contents,
):
    campaign_dir = tmp_path / "campaigns" / "c1"
    campaign_dir.mkdir(parents=True)
    lock_path = campaign_dir / ".campaign.lock"
    lock_path.write_text(contents, encoding="utf-8")

    with pytest.raises(fileio.CampaignLockError, match="held by pid=unknown"):
        with fileio.campaign_lock(campaign_dir, stale_minutes=30):
            pass

    assert lock_path.read_text(encoding="utf-8") == contents


def test_campaign_lock_waits_for_fresh_empty_lock_to_be_completed_and_released(
    tmp_path,
    fileio,
):
    campaign_dir = tmp_path / "campaigns" / "c1"
    campaign_dir.mkdir(parents=True)
    lock_path = campaign_dir / ".campaign.lock"
    ready_path = tmp_path / "holder-ready"
    holder_code = """
import json
import os
import sys
import time
from pathlib import Path

lock_path = Path(sys.argv[1])
ready_path = Path(sys.argv[2])
fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
ready_path.write_text("ready", encoding="utf-8")
time.sleep(0.1)
os.write(fd, json.dumps({"pid": os.getpid(), "acquired_at": time.time()}).encode("utf-8"))
os.close(fd)
time.sleep(0.1)
lock_path.unlink()
"""
    holder = subprocess.Popen(
        [sys.executable, "-c", holder_code, str(lock_path), str(ready_path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        deadline = time.monotonic() + 5.0
        while not ready_path.is_file():
            if holder.poll() is not None:
                stdout, stderr = holder.communicate()
                raise AssertionError(stderr or stdout or "lock holder exited early")
            if time.monotonic() >= deadline:
                raise AssertionError("lock holder did not create the empty lock")
            time.sleep(0.001)

        with fileio.campaign_lock(
            campaign_dir,
            stale_minutes=30,
            wait_seconds=2,
            poll_seconds=0.005,
        ):
            assert json.loads(lock_path.read_text(encoding="utf-8"))["pid"] == os.getpid()
        stdout, stderr = holder.communicate(timeout=5)
        assert holder.returncode == 0, stderr or stdout
    finally:
        if holder.poll() is None:
            holder.kill()
            holder.wait(timeout=5)


def test_campaign_lock_cross_process_shared_readers_and_exclusive_writer(tmp_path, fileio):
    """Kernel flock witnesses cross-process read overlap and write exclusion."""
    campaign_dir = tmp_path / "campaigns" / "c1"
    campaign_dir.mkdir(parents=True)
    worker = r'''
import importlib.util
import sys
import time
from pathlib import Path

script, campaign, ready, enter, acquired, release, blocked, role = sys.argv[1:]
spec = importlib.util.spec_from_file_location("cross_process_fileio", script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
ready = Path(ready)
enter = Path(enter)
acquired = Path(acquired)
release = Path(release)
blocked = Path(blocked)
ready.write_text("ready", encoding="utf-8")
deadline = time.monotonic() + 5
while not enter.exists():
    if time.monotonic() >= deadline:
        raise SystemExit("entry latch timed out")
    time.sleep(0.001)
try:
    with module.campaign_lock(
        Path(campaign),
        mode="exclusive" if role in {"writer", "contended-writer"} else "shared",
        wait_seconds=0.5 if role in {"late-reader", "contended-writer"} else 5,
        poll_seconds=0.001,
    ):
        acquired.write_text("acquired", encoding="utf-8")
        deadline = time.monotonic() + 5
        while not release.exists():
            if time.monotonic() >= deadline:
                raise SystemExit("release latch timed out")
            time.sleep(0.001)
except module.CampaignLockError:
    if role not in {"late-reader", "contended-writer"}:
        raise
    blocked.write_text("blocked", encoding="utf-8")
'''
    processes: list[subprocess.Popen[str]] = []

    def spawn(role: str, stem: str) -> tuple[Path, Path, Path, Path]:
        ready = tmp_path / f"{stem}-ready"
        enter = tmp_path / f"{stem}-enter"
        acquired = tmp_path / f"{stem}-acquired"
        release = tmp_path / f"{stem}-release"
        blocked = tmp_path / f"{stem}-blocked"
        processes.append(subprocess.Popen(
            [
                sys.executable, "-c", worker, str(SCRIPT), str(campaign_dir),
                str(ready), str(enter), str(acquired), str(release), str(blocked), role,
            ],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        ))
        return ready, enter, acquired, (
            blocked if role in {"late-reader", "contended-writer"} else release
        )

    def wait_for(path: Path, label: str) -> None:
        deadline = time.monotonic() + 5
        while not path.exists():
            # Completed earlier latch participants are expected; only an
            # abnormal child exit can invalidate the next synchronization.
            exited = [
                process for process in processes
                if process.poll() is not None and process.returncode != 0
            ]
            if exited:
                details = []
                for process in exited:
                    stdout, stderr = process.communicate()
                    details.append(stderr or stdout)
                raise AssertionError(f"{label}: worker exited early: {' '.join(details)}")
            if time.monotonic() >= deadline:
                raise AssertionError(f"{label}: latch timed out")
            time.sleep(0.001)

    try:
        first = spawn("reader", "first")
        second = spawn("reader", "second")
        wait_for(first[0], "first reader ready")
        wait_for(second[0], "second reader ready")
        first[1].touch()
        second[1].touch()
        # Both children remain in their shared critical sections until their
        # release latches fire; two acquired events prove actual overlap.
        wait_for(first[2], "first shared reader acquired")
        wait_for(second[2], "second shared reader acquired")
        blocked_writer = spawn("contended-writer", "contended-writer")
        wait_for(blocked_writer[0], "contended writer ready")
        blocked_writer[1].touch()
        # An exclusive writer cannot cross either held shared reader.
        wait_for(blocked_writer[3], "writer blocked by shared readers")
        assert not blocked_writer[2].exists()
        first[3].touch()
        second[3].touch()
        for process in processes[:3]:
            _, stderr = process.communicate(timeout=5)
            assert process.returncode == 0, stderr

        writer = spawn("writer", "writer")
        wait_for(writer[0], "writer ready")
        writer[1].touch()
        wait_for(writer[2], "writer acquired")
        late = spawn("late-reader", "late")
        wait_for(late[0], "late reader ready")
        late[1].touch()
        # The late reader gets its own lock timeout receipt while the writer
        # still holds its release latch; it cannot cross the exclusive lock.
        wait_for(late[3], "late reader blocked by writer")
        assert not late[2].exists()
        writer[3].touch()
        for process in processes[3:]:
            _, stderr = process.communicate(timeout=5)
            assert process.returncode == 0, stderr
    finally:
        for process in processes:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)


def test_audit_append_lock_preserves_cross_process_jsonl(tmp_path, fileio):
    """Fragmented concurrent writes stay complete and independently parseable."""
    log_path = tmp_path / "campaign" / "logs" / "toolbox-calls.jsonl"
    worker = r'''
import importlib.util
import json
import sys
import time
from pathlib import Path

script, target, worker_id, count = sys.argv[1:]
spec = importlib.util.spec_from_file_location("audit_lock_worker", script)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)
target = Path(target)
target.parent.mkdir(parents=True, exist_ok=True)
for index in range(int(count)):
    payload = json.dumps({"worker": int(worker_id), "index": index})
    # Deliberately split each JSON row: without the per-stream cross-process
    # lock, concurrent records would interleave into invalid JSONL.
    with module.audit_append_lock(target, wait_seconds=5, poll_seconds=0.001):
        with target.open("a", encoding="utf-8") as handle:
            midpoint = len(payload) // 2
            handle.write(payload[:midpoint])
            handle.flush()
            time.sleep(0.002)
            handle.write(payload[midpoint:] + chr(10))
'''
    workers = 4
    rows_per_worker = 8
    processes = [
        subprocess.Popen(
            [
                sys.executable, "-c", worker, str(SCRIPT), str(log_path),
                str(worker_id), str(rows_per_worker),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        for worker_id in range(workers)
    ]
    try:
        for process in processes:
            stdout, stderr = process.communicate(timeout=15)
            assert process.returncode == 0, stderr or stdout
    finally:
        for process in processes:
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)

    rows = [
        json.loads(line)
        for line in log_path.read_text(encoding="utf-8").splitlines()
        if line
    ]
    assert len(rows) == workers * rows_per_worker
    assert {(row["worker"], row["index"]) for row in rows} == {
        (worker_id, index)
        for worker_id in range(workers)
        for index in range(rows_per_worker)
    }
