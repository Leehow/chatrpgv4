from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ALLOWED_BRAINS = frozenset({"debug", "pi"})


def load_runtime_config(workspace: Path | str) -> dict[str, Any]:
    root = Path(workspace)
    path = root / ".coc" / "runtime.json"
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
