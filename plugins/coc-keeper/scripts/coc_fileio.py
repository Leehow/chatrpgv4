#!/usr/bin/env python3
"""Atomic text/JSON persistence helpers for campaign save paths.

Crash-safe writes: stage into a same-directory temp file, fsync, then
``os.replace`` onto the target so readers never observe a truncated file.
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def write_text_atomic(path: Path, text: str, encoding: str = "utf-8") -> None:
    """Write ``text`` to ``path`` via temp file + fsync + ``os.replace``."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding=encoding,
            dir=path.parent,
            delete=False,
        ) as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
            tmp_path = Path(handle.name)
        os.replace(tmp_path, path)
        tmp_path = None
    except Exception:
        if tmp_path is not None:
            try:
                tmp_path.unlink(missing_ok=True)
            except OSError:
                pass
        raise


def write_json_atomic(
    path: Path,
    payload: Any,
    *,
    indent: int | None = 2,
    ensure_ascii: bool = False,
    trailing_newline: bool = False,
) -> None:
    """Serialize ``payload`` as JSON and write it atomically."""
    text = json.dumps(payload, indent=indent, ensure_ascii=ensure_ascii)
    if trailing_newline:
        text += "\n"
    write_text_atomic(path, text)
