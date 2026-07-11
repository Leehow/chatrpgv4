from __future__ import annotations

import json
import importlib.util
from pathlib import Path
from typing import Any

ALLOWED_BRAINS = frozenset({"debug", "pi"})


def _load_paths_module():
    path = Path(__file__).resolve().parent / "paths.py"
    spec = importlib.util.spec_from_file_location("runtime_paths_config", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def load_runtime_config(workspace: Path | str) -> dict[str, Any]:
    paths = _load_paths_module()
    root = paths.workspace_root(workspace)
    coc = paths.coc_root(root)
    path = paths.contained_path(coc, coc / "runtime.json")
    if not path.exists():
        return {"schema_version": 1, "brain": "debug"}
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("runtime.json must be a JSON object")
    brain = raw.get("brain", "debug")
    if brain not in ALLOWED_BRAINS:
        raise ValueError(f"invalid brain: {brain!r}; allowed={sorted(ALLOWED_BRAINS)}")
    schema_version = int(raw.get("schema_version", 1))
    return {"schema_version": schema_version, "brain": brain}
