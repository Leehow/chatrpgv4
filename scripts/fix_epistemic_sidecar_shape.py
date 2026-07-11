#!/usr/bin/env python3
"""One-shot asserted fix for malformed epistemic sidecar shapes."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "plugins/coc-keeper/scripts/coc_scenario_compile.py"
text = TARGET.read_text(encoding="utf-8")
old = '''    graph = compiled.get("epistemic_graph")
    contracts_doc = compiled.get("reveal_contracts")
    if not isinstance(graph, dict) and not isinstance(contracts_doc, dict):
        return []
    graph = graph if isinstance(graph, dict) else {}
    contracts_doc = contracts_doc if isinstance(contracts_doc, dict) else {}
    findings: list[dict[str, str]] = []
    clue_ids = set(id_maps.get("clue", {}))
'''
new = '''    raw_graph = compiled.get("epistemic_graph")
    raw_contracts = compiled.get("reveal_contracts")
    if raw_graph in (None, {}) and raw_contracts in (None, {}):
        return []

    findings: list[dict[str, str]] = []
    if raw_graph is not None and not isinstance(raw_graph, dict):
        findings.append(_finding(
            "invalid_epistemic_sidecar", "error",
            "epistemic_graph must be an object when present",
            path="epistemic_graph",
        ))
    if raw_contracts is not None and not isinstance(raw_contracts, dict):
        findings.append(_finding(
            "invalid_epistemic_sidecar", "error",
            "reveal_contracts must be an object when present",
            path="reveal_contracts",
        ))
    graph = raw_graph if isinstance(raw_graph, dict) else {}
    contracts_doc = raw_contracts if isinstance(raw_contracts, dict) else {}
    clue_ids = set(id_maps.get("clue", {}))
'''
count = text.count(old)
if count != 1:
    raise RuntimeError(f"expected one sidecar shape anchor, found {count}")
TARGET.write_text(text.replace(old, new, 1), encoding="utf-8")

for rel in (
    "scripts/fix_epistemic_sidecar_shape.py",
    ".github/workflows/fix-epistemic-sidecar-shape.yml",
    ".github/fix-epistemic-sidecar-shape-trigger",
):
    path = ROOT / rel
    if path.exists():
        path.unlink()
