"""The host's own Mod-definition checker: it reuses the kernel's validation without starting a
kernel, without touching the draft it was handed, and without creating any campaign state."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / ".coc/playtests/ts-mod-management"


def retained(name):
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix=name + "-", dir=EVIDENCE))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def test_emitted_mod_checker_reuses_validation_without_kernel_or_state_writes():
    from test_mods import weapon
    root = retained("host-check")
    home = root / "home"
    home.mkdir()
    drafts = [
        ("weapon", weapon(), True),
        ("document", {"name": "Notebook", "category": "item", "description": "Paper.", "basis": "A fixture.",
                      "parameters": {"effects": []},
                      "document": {"text": "\U0001f3b2" * 64000, "presentation": "notebook"},
                      "player_view": {"description": "Notes.", "fields": []}}, True),
        ("bad", {"name": "incomplete"}, False),
    ]
    for name, value, accepted in drafts:
        draft = root / f"{name}.json"
        write_json(draft, value)
        before = draft.read_bytes()
        env = {**os.environ, "PATH": "", "PI_COC_HOME": str(home),
               "PI_COC_RUNTIME_OPTIONS": json.dumps({"backend": "typescript", "resourceRoot": str(ROOT),
                                                     "contentRoot": str(ROOT / "content"),
                                                     "nodeExecutable": shutil.which("node")})}
        result = subprocess.run([shutil.which("node"), str(ROOT / "build/runtime/check.mjs"),
                                 "--kind", "mod-definition", "--draft", str(draft)],
                                cwd=ROOT, env=env, capture_output=True, text=True, timeout=15)
        response = json.loads(result.stdout)
        write_json(root / f"{name}-result.json", {"code": result.returncode, "response": response})
        assert (result.returncode == 0) is accepted, (name, result.returncode, response)
        # The checker reads a draft; it never rewrites the file it was handed.
        assert draft.read_bytes() == before, name
    # No kernel was started, so no campaign state exists to have been written.
    assert not (home / ".coc").exists()
