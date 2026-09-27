"""Session-scoped reuse of kernel processes for the RPC tests (contract §146).

A kernel started with `--retargetable` serves one workspace at a time and rebinds to another on
`kernel.retarget`, so the suite keeps a small pool of such processes instead of paying node startup
and the first parse of the content graphs for every test. Every test still gets its own workspace
and content paths. What a process carries from one test to the next is only what the kernel would
rebuild from the same bytes (§146); `test_kernel_pool.py` proves a reused process answers exactly
as a fresh one does.

`COC_TEST_KERNEL_POOL=0` turns the pool off: every client then spawns its own process, which is
also what `RpcClient(..., fresh=True)` asks for when a test asserts on process start or exit itself.
"""
from __future__ import annotations

import atexit
import hashlib
import json
import os
import select
import shutil
import subprocess
import tempfile
import time
from collections import Counter
from pathlib import Path
from typing import Any

from rpc_support import typescript_command

REPLY_TIMEOUT_SECONDS = 30
PoolKey = tuple[tuple[str, ...], str]


class KernelLink:
    """One kernel process's stdio: one request line in, exactly one reply line out."""

    def __init__(self, proc: subprocess.Popen[str], *, stderr_path: Path | None = None) -> None:
        self.proc = proc
        self.stderr_path = stderr_path
        self.stderr_mark = 0
        self.buffered = b""
        self.broken = False

    def exchange(self, line: str, timeout: float = REPLY_TIMEOUT_SECONDS) -> dict[str, Any]:
        try:
            return self._exchange(line, timeout)
        except BaseException:
            self.broken = True
            raise

    def _exchange(self, line: str, timeout: float) -> dict[str, Any]:
        assert self.proc.stdin and self.proc.stdout
        self.proc.stdin.write(line + "\n")
        self.proc.stdin.flush()
        deadline = time.monotonic() + timeout
        while b"\n" not in self.buffered:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([self.proc.stdout], [], [], remaining)[0]:
                raise AssertionError(f"kernel did not return a JSON line within {timeout:g} seconds")
            chunk = os.read(self.proc.stdout.fileno(), 65536)
            if not chunk:
                break
            self.buffered += chunk
        reply, separator, self.buffered = self.buffered.partition(b"\n")
        if not separator:
            raise AssertionError(f"kernel stdout closed before a complete JSON line (rc={self.proc.poll()}):\n{self.diagnostics()}")
        return json.loads(reply)

    def diagnostics(self) -> str:
        """The kernel's stderr for this binding: the pipe once the process exited, or the log slice."""
        if self.stderr_path is not None:
            with self.stderr_path.open("rb") as handle:
                handle.seek(self.stderr_mark)
                return handle.read().decode("utf-8", "replace")
        if self.proc.poll() is not None and self.proc.stderr:
            return self.proc.stderr.read()
        return ""

    def terminate(self) -> None:
        if self.proc.stdin and not self.proc.stdin.closed:
            try:
                self.proc.stdin.close()
            except BrokenPipeError:
                pass
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait(timeout=5)
        for stream in (self.proc.stdout, self.proc.stderr):
            if stream:
                stream.close()


def spawn_fresh(entry: list[str], env: dict[str, str], workspace: Path, content: Path, *, cwd: Path) -> KernelLink:
    """The per-test process: exactly the command line the host uses, stderr kept on a pipe."""
    proc = subprocess.Popen(
        [*entry, "--workspace", str(workspace), "--content", str(content)],
        cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8", bufsize=1, env=env,
    )
    return KernelLink(proc)


class PooledKernel(KernelLink):
    """A `--retargetable` process, parked on a scratch workspace between two tests."""

    def __init__(self, proc: subprocess.Popen[str], key: PoolKey, parking: Path, content: Path,
                 stderr_path: Path, stderr_file: Any) -> None:
        super().__init__(proc, stderr_path=stderr_path)
        self.key = key
        self.parking = parking
        self.content = Path(content)
        self.generation = 0
        self.parked_at = 0.0
        self._stderr_file = stderr_file
        self._retargets = 0

    def retarget(self, workspace: Path, content: Path) -> None:
        self._retargets += 1
        request = {"id": f"retarget-{self._retargets}", "method": "kernel.retarget",
                   "params": {"workspace": str(workspace), "content": str(content)}}
        response = self.exchange(json.dumps(request))
        if not response.get("ok"):
            raise RuntimeError(f"kernel.retarget failed: {response.get('error')}")
        self.generation = int(response["result"]["generation"])
        self.content = Path(content)
        self._stderr_file.flush()
        self.stderr_mark = self.stderr_path.stat().st_size if self.stderr_path else 0

    def terminate(self) -> None:
        super().terminate()
        self._stderr_file.close()


class KernelPool:
    """Idle retargetable processes by (command, environment); a test never sees another test's workspace."""

    IDLE_PER_KEY = 2
    IDLE_TOTAL = 6

    def __init__(self) -> None:
        self._idle: dict[PoolKey, list[PooledKernel]] = {}
        self._root: Path | None = None
        self._spawned = 0
        self.stats: Counter[str] = Counter()

    @property
    def enabled(self) -> bool:
        return os.environ.get("COC_TEST_KERNEL_POOL", "1") != "0"

    def accepts(self, entry: list[str]) -> bool:
        """Only the emitted TypeScript kernel knows `--retargetable`; any other command spawns per test."""
        return self.enabled and entry == typescript_command()

    # pytest rewrites this variable for every test; the kernel never reads it, and a key that
    # carried it would make every test its own pool.
    VOLATILE_ENV = frozenset({"PYTEST_CURRENT_TEST"})

    @classmethod
    def key_of(cls, entry: list[str], env: dict[str, str]) -> PoolKey:
        stable = sorted(item for item in env.items() if item[0] not in cls.VOLATILE_ENV)
        digest = hashlib.sha256(json.dumps(stable, ensure_ascii=False).encode("utf-8")).hexdigest()
        return tuple(entry), digest

    def acquire(self, entry: list[str], env: dict[str, str], workspace: Path, content: Path, *, cwd: Path) -> PooledKernel:
        key = self.key_of(entry, env)
        idle = self._idle.get(key, [])
        while idle:
            kernel = idle.pop()
            if kernel.proc.poll() is not None:
                self._discard(kernel, "died_while_parked")
                continue
            try:
                kernel.retarget(workspace, content)
            except Exception:
                self._discard(kernel, "retarget_failed")
                continue
            self.stats["reused"] += 1
            return kernel
        return self._spawn(entry, env, key, workspace, content, cwd=cwd)

    def release(self, kernel: PooledKernel) -> None:
        if kernel.broken or kernel.buffered or kernel.proc.poll() is not None:
            self._discard(kernel, "discarded_unhealthy")
            return
        try:
            # Parking closes the runtime that served the test's workspace, exactly as stdin EOF would
            # have: nothing of that binding stays live while the process waits for the next test.
            kernel.retarget(kernel.parking, kernel.content)
        except Exception:
            self._discard(kernel, "park_failed")
            return
        kernel.parked_at = time.monotonic()
        self._idle.setdefault(kernel.key, []).append(kernel)
        self.stats["parked"] += 1
        self._evict()

    def close(self) -> None:
        for kernels in self._idle.values():
            for kernel in kernels:
                kernel.terminate()
        self._idle.clear()
        if self._root is not None:
            shutil.rmtree(self._root, ignore_errors=True)
            self._root = None

    # ---- internals -----------------------------------------------------------------------------

    def _spawn(self, entry: list[str], env: dict[str, str], key: PoolKey, workspace: Path, content: Path, *, cwd: Path) -> PooledKernel:
        root = self._root_dir()
        self._spawned += 1
        parking = root / f"p{self._spawned}"
        parking.mkdir()
        stderr_path = root / f"p{self._spawned}.stderr.log"
        stderr_file = stderr_path.open("ab")
        proc = subprocess.Popen(
            [*entry, "--retargetable", "--workspace", str(workspace), "--content", str(content)],
            cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=stderr_file,
            text=True, encoding="utf-8", bufsize=1, env=env,
        )
        self.stats["spawned"] += 1
        return PooledKernel(proc, key, parking, content, stderr_path, stderr_file)

    def _discard(self, kernel: PooledKernel, reason: str) -> None:
        self.stats[reason] += 1
        kernel.terminate()

    def _evict(self) -> None:
        while True:
            crowded = [k for k, kernels in self._idle.items() if len(kernels) > self.IDLE_PER_KEY]
            total = sum(len(kernels) for kernels in self._idle.values())
            if not crowded and total <= self.IDLE_TOTAL:
                return
            candidates = self._idle[crowded[0]] if crowded else min(self._idle.values(), key=lambda ks: min(k.parked_at for k in ks))
            self._discard(candidates.pop(0), "evicted")
            for key in [k for k, kernels in self._idle.items() if not kernels]:
                del self._idle[key]

    def _root_dir(self) -> Path:
        if self._root is None:
            self._root = Path(tempfile.mkdtemp(prefix="coc-kernel-pool-"))
        return self._root


POOL = KernelPool()
atexit.register(POOL.close)
