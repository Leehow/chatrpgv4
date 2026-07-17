#!/usr/bin/env python3
"""Single authoritative CPython interpreter contract for repository entrypoints."""
from __future__ import annotations

import sys
from collections.abc import Sequence


REQUIRED_PYTHON = (3, 14, 6)
REQUIRED_PYTHON_TEXT = ".".join(str(part) for part in REQUIRED_PYTHON)


def interpreter_matches(version_info: Sequence[int] = sys.version_info) -> bool:
    """Return whether *version_info* is the exact supported CPython release."""
    return sys.implementation.name == "cpython" and tuple(version_info[:3]) == REQUIRED_PYTHON


def require_python_contract(version_info: Sequence[int] = sys.version_info) -> None:
    """Fail before runtime work when an entrypoint bypasses the uv contract."""
    if interpreter_matches(version_info):
        return
    actual = ".".join(str(part) for part in version_info[:3])
    raise RuntimeError(
        "unsupported Python interpreter: "
        f"{sys.implementation.name} {actual}; require CPython {REQUIRED_PYTHON_TEXT}. "
        "Run repository commands as `uv run --frozen python ...`."
    )
