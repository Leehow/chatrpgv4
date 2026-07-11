#!/usr/bin/env python3
"""Apply final minimum-privilege and provenance boundary hardening."""
from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins/coc-keeper/scripts"


def replace_span(path: Path, start_marker: str, end_marker: str, replacement: str) -> None:
    text = path.read_text(encoding="utf-8")
    if replacement in text:
        return
    start = text.index(start_marker)
    end = text.index(end_marker, start)
    path.write_text(text[:start] + replacement + text[end:], encoding="utf-8")


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if new in text:
        return
    if old not in text:
        raise RuntimeError(f"marker not found in {path}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def patch_compile_request() -> None:
    path = SCRIPTS / "coc_epistemic_compile.py"
    replacement = '''def _safe_npcs(document: dict[str, Any]) -> list[dict[str, Any]]:
    """Project NPCs to IDs, surface presentation, and explicit safe summaries.

    Raw agenda/fear/secret prose is planner-only.  An author may opt in a
    player-safe ``agenda_summary`` for semantic compilation; absence never
    falls back to the raw agenda.
    """
    allowed = {
        "npc_id", "name", "display_name", "relationship_to_investigators",
        "social_role", "voice", "source_refs", "origin", "importance",
        "secret_id", "has_secret",
    }
    result: list[dict[str, Any]] = []
    for npc in document.get("npcs") or []:
        if not isinstance(npc, dict):
            continue
        safe = {key: copy.deepcopy(npc[key]) for key in allowed if key in npc}
        summary = npc.get("agenda_summary") or npc.get("player_safe_agenda")
        if isinstance(summary, str) and summary.strip():
            safe["agenda_summary"] = summary.strip()
        persona = npc.get("persona")
        if isinstance(persona, dict):
            safe_persona: dict[str, Any] = {}
            for key in ("tags", "surface_cues"):
                values = persona.get(key)
                if isinstance(values, list):
                    safe_persona[key] = [
                        str(value) for value in values if str(value or "").strip()
                    ]
            if safe_persona:
                safe["persona"] = safe_persona
        if "source_refs" in safe:
            safe["source_refs"] = _safe_source_refs(safe["source_refs"])
        result.append(safe)
    return result


def _safe_danger(danger: dict[str, Any]) -> dict[str, Any]:
    allowed = {
        "id", "danger_id", "kind", "tags", "lethal", "lethality",
        "player_safe_summary", "source_refs", "origin", "importance",
    }
    safe = {key: copy.deepcopy(danger[key]) for key in allowed if key in danger}
    if "source_refs" in safe:
        safe["source_refs"] = _safe_source_refs(safe["source_refs"])
    return safe


def _safe_clock(clock: dict[str, Any]) -> dict[str, Any]:
    # on_tick_visible is explicitly player-facing; on_full remains Keeper-only.
    allowed = {
        "clock_id", "segments", "on_tick_visible", "tags", "source_refs",
        "origin", "importance",
    }
    safe = {key: copy.deepcopy(clock[key]) for key in allowed if key in clock}
    if "source_refs" in safe:
        safe["source_refs"] = _safe_source_refs(safe["source_refs"])
    return safe


def _safe_fronts(document: dict[str, Any]) -> list[dict[str, Any]]:
    allowed = {
        "front_id", "scope", "tags", "setting_tags", "source_refs",
        "origin", "importance",
    }
    result: list[dict[str, Any]] = []
    for front in document.get("fronts") or []:
        if not isinstance(front, dict):
            continue
        safe = {key: copy.deepcopy(front[key]) for key in allowed if key in front}
        safe["dangers"] = [
            _safe_danger(danger)
            for danger in (front.get("dangers") or [])
            if isinstance(danger, dict)
        ]
        safe["clocks"] = [
            _safe_clock(clock)
            for clock in (front.get("clocks") or [])
            if isinstance(clock, dict)
        ]
        if "source_refs" in safe:
            safe["source_refs"] = _safe_source_refs(safe["source_refs"])
        result.append(safe)
    return result


'''
    replace_span(path, "def _safe_npcs(", "def _secret_refs(", replacement)


def patch_pdf_source() -> None:
    path = SCRIPTS / "coc_pdf_source.py"
    old = '''        segments = _segments_for_locator(locator, evidence_segments)
        anchor = str(ref.get("grep_anchor") or "").strip()
        if anchor and not _anchor_present(anchor, segments):
            ref_findings.append(_finding("missing_source_anchor", f"grep anchor {anchor!r} not found", ref))
        confidence = effective_source_confidence(
            ref, parse_manifest, evidence_segments, page_map=page_map
        )
        if confidence is None or confidence < threshold_value:
'''
    new = '''        segments = _segments_for_locator(locator, evidence_segments)
        anchor = str(ref.get("grep_anchor") or "").strip()
        relevant_segments = [
            segment
            for segment in segments
            if not anchor or _anchor_present(anchor, [segment])
        ]
        if anchor and not relevant_segments:
            ref_findings.append(_finding("missing_source_anchor", f"grep anchor {anchor!r} not found", ref))

        usable_segments: list[dict[str, Any]] = []
        segment_findings: list[dict[str, Any]] = []
        for segment in relevant_segments:
            issues: list[dict[str, Any]] = []
            segment_id = str(segment.get("segment_id") or "unknown")
            segment_review = str(segment.get("review_state") or "needs_review")
            if segment_review not in _ACCEPTED_REVIEW_STATES:
                issues.append(_finding(
                    "source_needs_review",
                    f"evidence segment {segment_id!r} review_state={segment_review}",
                    ref,
                ))
            local_text = segment.get("text")
            declared_text_hash = str(segment.get("text_sha256") or "").strip()
            if isinstance(local_text, str) and declared_text_hash:
                actual_text_hash = hashlib.sha256(local_text.encode("utf-8")).hexdigest()
                if actual_text_hash != declared_text_hash:
                    issues.append(_finding(
                        "stale_source_hash",
                        f"evidence segment {segment_id!r} text hash does not match local text",
                        ref,
                    ))
            if issues:
                segment_findings.extend(issues)
            else:
                usable_segments.append(segment)
        if relevant_segments and not usable_segments:
            ref_findings.extend(segment_findings)

        confidence_values: list[float] = []
        range_confidence = _confidence((range_record.get("quality") or {}).get("overall"))
        if range_confidence is not None:
            confidence_values.append(range_confidence)
        for segment in usable_segments:
            segment_confidence = _confidence(segment.get("parse_confidence"))
            if segment_confidence is not None:
                confidence_values.append(segment_confidence)
        confidence = min(confidence_values) if confidence_values else None
        if confidence is None or confidence < threshold_value:
'''
    replace_once(path, old, new)


def patch_confidence_validation() -> None:
    path = SCRIPTS / "coc_scenario_compile.py"
    old = '''    for question_id, clue_id in sorted(reframe_pairs - covered_reframes):
        findings.append(_finding(
            "reframe_missing_contract", "warning",
            f"reframe evidence ({question_id}, {clue_id}) has no matching reveal contract",
            path="epistemic_graph.evidence_links",
        ))
    return findings
'''
    new = '''    for question_id, clue_id in sorted(reframe_pairs - covered_reframes):
        findings.append(_finding(
            "reframe_missing_contract", "warning",
            f"reframe evidence ({question_id}, {clue_id}) has no matching reveal contract",
            path="epistemic_graph.evidence_links",
        ))

    confidence_doc = compiled.get("compile_confidence")
    if confidence_doc is not None and not isinstance(confidence_doc, dict):
        findings.append(_finding(
            "invalid_compile_confidence_node", "error",
            "compile_confidence must be an object when present",
            path="compile_confidence",
        ))
        confidence_doc = {}
    confidence_doc = confidence_doc if isinstance(confidence_doc, dict) else {}
    valid_targets = {
        "question": set(questions),
        "reveal_contract": set(reveal_contract_ids),
    }
    accepted_review_states = {
        "auto_accepted", "manual_accepted", "needs_review", "rejected",
    }
    seen_confidence_nodes: set[tuple[str, str]] = set()
    for index, record in enumerate(confidence_doc.get("nodes") or []):
        path = f"compile_confidence.nodes[{index}]"
        if not isinstance(record, dict):
            findings.append(_finding(
                "invalid_compile_confidence_node", "error",
                "compile confidence node must be an object", path=path,
            ))
            continue
        node_type = str(record.get("node_type") or "").strip()
        node_id = str(record.get("node_id") or "").strip()
        if node_type not in valid_targets:
            findings.append(_finding(
                "invalid_compile_confidence_node", "error",
                f"compile confidence node_type '{node_type}' is not supported",
                path=f"{path}.node_type",
            ))
            continue
        if not node_id:
            findings.append(_finding(
                "invalid_compile_confidence_node", "error",
                "compile confidence node requires node_id",
                path=f"{path}.node_id",
            ))
            continue
        key = (node_type, node_id)
        if key in seen_confidence_nodes:
            findings.append(_finding(
                "duplicate_compile_confidence_node", "error",
                f"duplicate compile confidence node ({node_type}, {node_id})",
                path=path,
            ))
        else:
            seen_confidence_nodes.add(key)
        if node_id not in valid_targets[node_type]:
            findings.append(_finding(
                "broken_epistemic_reference", "error",
                f"compile confidence {node_type} node_id '{node_id}' does not resolve",
                path=f"{path}.node_id",
            ))
        review_state = str(record.get("review_state") or "needs_review")
        if review_state not in accepted_review_states:
            findings.append(_finding(
                "invalid_compile_confidence_node", "error",
                f"compile confidence review_state '{review_state}' is not supported",
                path=f"{path}.review_state",
            ))
        for field in (
            "semantic_confidence", "source_confidence", "effective_confidence",
        ):
            if field not in record:
                continue
            try:
                value = float(record[field])
            except (TypeError, ValueError):
                value = -1.0
            if value < 0.0 or value > 1.0:
                findings.append(_finding(
                    "invalid_compile_confidence_node", "error",
                    f"{field} for ({node_type}, {node_id}) must be within 0..1",
                    path=f"{path}.{field}",
                ))
    return findings
'''
    replace_once(path, old, new)


def main() -> None:
    patch_compile_request()
    patch_pdf_source()
    patch_confidence_validation()


if __name__ == "__main__":
    main()
