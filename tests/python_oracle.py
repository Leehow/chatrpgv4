"""Expose the pinned Git reference to Python test modules only."""
from pathlib import Path
import os
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True
TESTS = Path(__file__).resolve().parent
node = os.environ.get("COC_TEST_NODE") or shutil.which("node")
if not node:
    raise RuntimeError("Developer tests require Node to materialize the frozen Python oracle")
ORACLE_ROOT = Path(subprocess.check_output(
    [node, str(TESTS / "python-oracle.mjs")], cwd=TESTS.parent, text=True,
).strip())
ORACLE_KERNEL = ORACLE_ROOT / "kernel"
