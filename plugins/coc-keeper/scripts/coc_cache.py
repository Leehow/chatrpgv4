#!/usr/bin/env python3
"""Mtime-invalidated JSON cache for read-only reference tables (N4).

Caches parsed JSON keyed by resolved path. Each hit re-stats the file and
re-reads only when ``mtime_ns`` or size changed — never serves stale data
after an on-disk edit.

**Never caches** paths under ``.coc/`` (campaign save/world/pacing state
mutates every turn; tests rely on fresh reads).

Callers receive a ``deepcopy`` of the cached object so mutations cannot
poison the module-level store. Prefer this helper only for static reference
tables under ``plugins/coc-keeper/references/``, not campaign scenario/save
JSON.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

# path_str -> (mtime_ns, size, parsed_object)
_JSON_CACHE: dict[str, tuple[int, int, Any]] = {}


def is_cacheable_path(path: Path | str) -> bool:
    """Return False for campaign state under ``.coc/`` (never cache)."""
    resolved = Path(path)
    try:
        parts = resolved.resolve(strict=False).parts
    except OSError:
        parts = resolved.parts
    return ".coc" not in parts


def clear_json_cache() -> None:
    """Drop all cached entries (tests / explicit invalidation)."""
    _JSON_CACHE.clear()


def load_json_cached(path: Path | str) -> Any:
    """Load JSON from ``path``, caching by resolved path + mtime_ns + size.

    Returns a deep copy of the parsed value. Paths under ``.coc/`` always
    bypass the cache and read fresh from disk. On a cache hit only ``stat``
    runs — the file body is not re-read until mtime or size changes.
    """
    resolved = Path(path).resolve()

    if not is_cacheable_path(resolved):
        return json.loads(resolved.read_text(encoding="utf-8"))

    st = resolved.stat()
    key = str(resolved)
    entry = _JSON_CACHE.get(key)
    if entry is not None and entry[0] == st.st_mtime_ns and entry[1] == st.st_size:
        return copy.deepcopy(entry[2])

    data = json.loads(resolved.read_text(encoding="utf-8"))
    # Re-stat after read so the fingerprint matches the bytes we parsed
    # (covers writers that bump mtime during our read window).
    st_after = resolved.stat()
    _JSON_CACHE[key] = (st_after.st_mtime_ns, st_after.st_size, data)
    return copy.deepcopy(data)
