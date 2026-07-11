#!/usr/bin/env python3
"""Apply the source-evidence integration patch to large existing files."""
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one anchor, found {count}")
    return text.replace(old, new, 1)


path = Path("plugins/coc-keeper/scripts/coc_scenario_compile.py")
text = path.read_text(encoding="utf-8")

text = replace_once(
    text,
    "from typing import Any\n\nVALID_STRUCTURE_TYPES = {",
    "from typing import Any\n\nSCRIPT_DIR = Path(__file__).resolve().parent\nif str(SCRIPT_DIR) not in sys.path:\n    sys.path.insert(0, str(SCRIPT_DIR))\n\nimport coc_pdf_source\n\nVALID_STRUCTURE_TYPES = {",
    "compiler import",
)

helper = r'''

def _iter_source_owned_nodes(compiled: dict[str, Any]):
    """Yield (path, refs, critical) for structured authored nodes."""
    for i, question in enumerate((compiled.get("epistemic_graph") or {}).get("questions") or []):
        if isinstance(question, dict) and question.get("source_refs"):
            yield (
                f"epistemic_graph.questions[{i}]",
                question.get("source_refs") or [],
                question.get("importance") == "critical",
            )
    for ci, conclusion in enumerate((compiled.get("clue_graph") or {}).get("conclusions") or []):
        if not isinstance(conclusion, dict):
            continue
        critical = conclusion.get("importance") == "critical"
        for qi, clue in enumerate(conclusion.get("clues") or []):
            if isinstance(clue, dict) and clue.get("source_refs"):
                yield (
                    f"clue_graph.conclusions[{ci}].clues[{qi}]",
                    clue.get("source_refs") or [],
                    critical or clue.get("importance") == "critical",
                )
    for i, scene in enumerate((compiled.get("story_graph") or {}).get("scenes") or []):
        if isinstance(scene, dict) and scene.get("source_refs"):
            yield (
                f"story_graph.scenes[{i}]",
                scene.get("source_refs") or [],
                scene.get("importance") == "critical" or scene.get("is_final") is True,
            )
    for i, npc in enumerate((compiled.get("npc_agendas") or {}).get("npcs") or []):
        if isinstance(npc, dict) and npc.get("source_refs"):
            yield (
                f"npc_agendas.npcs[{i}]",
                npc.get("source_refs") or [],
                npc.get("importance") == "critical",
            )
    for i, front in enumerate((compiled.get("threat_fronts") or {}).get("fronts") or []):
        if isinstance(front, dict) and front.get("source_refs"):
            yield (
                f"threat_fronts.fronts[{i}]",
                front.get("source_refs") or [],
                front.get("importance") == "critical",
            )


def _check_source_evidence(
    compiled: dict[str, Any],
    source_bundle: dict[str, Any] | None,
    *,
    strict_sources: bool,
) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    nodes = list(_iter_source_owned_nodes(compiled))
    if not nodes:
        return findings
    if not isinstance(source_bundle, dict):
        if strict_sources:
            for owner_path, _refs, critical in nodes:
                findings.append(_finding(
                    "unresolved_source_locator",
                    "error" if critical else "warning",
                    "source refs are present but no source evidence bundle was supplied",
                    path=owner_path,
                ))
        return findings
    page_map = source_bundle.get("page_map") or {}
    manifest = source_bundle.get("parse_manifest") or {}
    segments = source_bundle.get("evidence_segments") or []
    if not (page_map.get("sources") or manifest.get("ranges")) and not strict_sources:
        return findings
    for owner_path, refs, critical in nodes:
        result = coc_pdf_source.critical_source_allowed(
            [ref for ref in refs if isinstance(ref, dict)],
            manifest,
            [seg for seg in segments if isinstance(seg, dict)],
            page_map=page_map,
        )
        if result.get("allowed"):
            continue
        source_findings = result.get("findings") or [{
            "code": "unresolved_source_locator",
            "message": "source evidence did not resolve",
        }]
        for source_finding in source_findings:
            findings.append(_finding(
                str(source_finding.get("code") or "unresolved_source_locator"),
                "error" if critical else "warning",
                str(source_finding.get("message") or "source evidence did not resolve"),
                path=owner_path,
            ))
    return findings
'''

text = replace_once(
    text,
    "\ndef validate_compiled_scenario(\n",
    helper + "\n\ndef validate_compiled_scenario(\n",
    "source helper insertion",
)

text = replace_once(
    text,
    "def validate_compiled_scenario(\n    compiled: dict[str, Any],\n    source_segments: list[dict[str, Any]] | None = None,\n) -> list[dict[str, str]]:",
    "def validate_compiled_scenario(\n    compiled: dict[str, Any],\n    source_segments: list[dict[str, Any]] | None = None,\n    *,\n    source_bundle: dict[str, Any] | None = None,\n    strict_sources: bool = False,\n) -> list[dict[str, str]]:",
    "validate signature",
)

text = replace_once(
    text,
    "    findings.extend(_check_epistemic_sidecars(compiled, id_maps))\n    return findings",
    "    findings.extend(_check_epistemic_sidecars(compiled, id_maps))\n    findings.extend(_check_source_evidence(\n        compiled, source_bundle, strict_sources=strict_sources\n    ))\n    return findings",
    "validate source call",
)

text = replace_once(
    text,
    "            if not ref.get(\"path\") or not isinstance(ref.get(\"page\"), int):\n                warnings.append(f\"{owner_label} source_ref missing path or integer page\")",
    "            legacy_ok = bool(ref.get(\"path\")) and isinstance(ref.get(\"page\"), int)\n            structured_ok = bool(ref.get(\"source_id\")) and (\n                isinstance(ref.get(\"printed_page\"), int)\n                or isinstance(ref.get(\"pdf_index\"), int)\n            )\n            if not legacy_ok and not structured_ok:\n                warnings.append(\n                    f\"{owner_label} source_ref needs path+page or source_id+printed_page/pdf_index\"\n                )",
    "source ref warning",
)

text = replace_once(
    text,
    "    epi_findings = _check_epistemic_sidecars(compiled, _collect_id_maps(compiled))\n    for finding in epi_findings:",
    "    epi_findings = _check_epistemic_sidecars(compiled, _collect_id_maps(compiled))\n    index_dir = scenario_dir.parent / \"index\"\n    source_bundle = None\n    if (index_dir / \"page-map.json\").exists() or (index_dir / \"parse-manifest.json\").exists():\n        source_bundle = coc_pdf_source.load_source_bundle(scenario_dir.parent)\n    epi_findings.extend(_check_source_evidence(\n        compiled, source_bundle, strict_sources=False\n    ))\n    for finding in epi_findings:",
    "validate scenario source bundle",
)

path.write_text(text, encoding="utf-8")

# The cache metadata contract intentionally advanced to schema v2.
test_path = Path("tests/test_pdf_cache.py")
test_text = test_path.read_text(encoding="utf-8")
test_text = test_text.replace('assert meta["schema_version"] == 1', 'assert meta["schema_version"] == 2')
test_path.write_text(test_text, encoding="utf-8")
