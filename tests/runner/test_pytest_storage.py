"""Real child pytest sessions verify storage routing and evidence lifecycle."""
from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / "scripts" / "run-pytest.py"


def sandbox(tmp_path, ordinary, disk=""):
    project = tmp_path / "project"
    (project / "tests").mkdir(parents=True)
    shutil.copyfile(ROOT / "tests" / "coc_pytest_storage.py", project / "tests" / "coc_pytest_storage.py")
    policy = project / "tests" / "pytest-storage-policy.json"
    policy.write_text(json.dumps({"version": 1, "disk_files": ["test_disk.py"], "disk_tests": []}))
    (project / "test_ordinary.py").write_text(ordinary)
    if disk:
        (project / "test_disk.py").write_text(disk)
    env = {**os.environ, "COC_TEST_STORAGE_POLICY": str(policy), "PYTEST_ADDOPTS": ""}
    return project, env


def start(project, env, run_dir, *, mode="hybrid"):
    command = [sys.executable, str(RUNNER), "--run-dir", str(run_dir), "--mode", mode,
               "--", "-q", "-n", "0", "-p", "no:cacheprovider"]
    return subprocess.Popen(command, cwd=project, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)


def finish(proc):
    output, _ = proc.communicate(timeout=20)
    return proc.returncode, output


def test_real_fixtures_route_to_independent_roots_without_changing_cases(tmp_path):
    body = "def test_fixture(tmp_path):\n    (tmp_path / 'value').write_text('retained')\n"
    project, env = sandbox(tmp_path, body, body)
    run_dir = tmp_path / "run"
    code, output = finish(start(project, env, run_dir))
    assert code == 0, output
    report = json.loads((run_dir / "storage-main.json").read_text())
    rows = {row["nodeid"]: row for row in report["paths"]}
    assert rows["test_disk.py::test_fixture"]["storage"] == "disk"
    assert Path(rows["test_disk.py::test_fixture"]["path"]).is_relative_to(run_dir / "disk")
    meta = json.loads((run_dir / "run.json").read_text())
    assert rows["test_ordinary.py::test_fixture"]["storage"] == "ordinary"
    assert Path(rows["test_ordinary.py::test_fixture"]["path"]).is_relative_to(Path(meta["ordinary"]))
    assert set(rows) == {row["nodeid"] for row in report["collected"]}
    assert not Path(meta["ordinary"]).exists()
    assert not (run_dir / "disk").exists()


@pytest.mark.skipif(not Path("/dev/shm").is_dir(), reason="Linux shared memory is required")
def test_failed_ram_and_disk_fixtures_survive_a_later_success(tmp_path):
    ram = "def test_fixture(tmp_path):\n    data = tmp_path / 'value'\n    data.write_text('ram failure')\n    (tmp_path / 'alias').symlink_to(data)\n    assert False, 'controlled failure'\n"
    disk = "def test_fixture(tmp_path):\n    (tmp_path / 'value').write_text('disk failure')\n    assert False, 'controlled failure'\n"
    project, env = sandbox(tmp_path, ram, disk)
    failed = tmp_path / "failed"
    code, output = finish(start(project, env, failed))
    assert code == 1, output
    meta = json.loads((failed / "run.json").read_text())
    assert meta["mode"] == "hybrid"
    assert not Path(meta["ordinary"]).exists()
    alias = next((failed / "ram-evidence").rglob("alias"))
    assert alias.read_text() == "ram failure"
    assert next((failed / "disk").rglob("value")).read_text() == "disk failure"
    (project / "test_ordinary.py").write_text("def test_fixture(tmp_path):\n    assert tmp_path.is_dir()\n")
    (project / "test_disk.py").unlink()
    code, output = finish(start(project, env, tmp_path / "passed"))
    assert code == 0, output
    assert alias.read_text() == "ram failure"
    assert next((failed / "disk").rglob("value")).read_text() == "disk failure"


def test_disk_mode_keeps_all_fixtures_on_disk_and_rejects_run_reuse(tmp_path):
    project, env = sandbox(tmp_path, "def test_fixture(tmp_path):\n    assert tmp_path.is_dir()\n")
    run_dir = tmp_path / "run"
    code, output = finish(start(project, env, run_dir, mode="disk"))
    assert code == 0, output
    meta = json.loads((run_dir / "run.json").read_text())
    assert meta["mode"] == "disk" and Path(meta["ordinary"]).is_relative_to(run_dir)
    original = (run_dir / "run.json").read_bytes()
    code, output = finish(start(project, env, run_dir, mode="disk"))
    assert code != 0 and "cannot reuse" in output
    assert (run_dir / "run.json").read_bytes() == original


@pytest.mark.skipif(not Path("/dev/shm").is_dir(), reason="Linux shared memory is required")
def test_interruption_preserves_ram_after_stopping_the_owned_child(tmp_path):
    ready = tmp_path / "ready"
    body = f"import time\nfrom pathlib import Path\ndef test_fixture(tmp_path):\n    (tmp_path / 'value').write_text('interrupted')\n    Path({str(ready)!r}).touch()\n    while True: time.sleep(0.05)\n"
    project, env = sandbox(tmp_path, body)
    run_dir = tmp_path / "run"
    proc = start(project, env, run_dir)
    try:
        deadline = time.monotonic() + 10
        while not ready.exists() and time.monotonic() < deadline and proc.poll() is None:
            time.sleep(0.05)
        assert ready.exists()
        proc.send_signal(signal.SIGTERM)
        code, output = finish(proc)
        assert code == 143, output
        assert next((run_dir / "ram-evidence").rglob("value")).read_text() == "interrupted"
        assert json.loads((run_dir / "run.json").read_text())["exit_code"] == 143
    finally:
        if proc.poll() is None:
            proc.send_signal(signal.SIGTERM)
            proc.wait(timeout=10)
