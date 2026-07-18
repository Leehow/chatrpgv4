"""Wire the rulebook data audits into pytest.

gap_audit.py is the offline JSON-vs-JSON auditor: it compares every
rule-table parameter in plugins/coc-keeper/references/rules-json/ against
the committed rulebook reference snapshots in checks/rulebook-*-ref.json
(skills, occupations, weapons, spells, monsters, bout tables, ...). It
needs no OCR cache and must stay clean; any drift in rule data fails here.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_gap_audit_clean():
    proc = subprocess.run(
        [sys.executable, "scripts/gap_audit.py",
         "--plugin-root", "plugins/coc-keeper"],
        cwd=ROOT, capture_output=True, text=True)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "clean" in proc.stdout
