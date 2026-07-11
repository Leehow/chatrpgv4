#!/usr/bin/env python3
"""Structured PDF source-evidence bundle for compiled COC scenarios.

This module owns page identity, parse-manifest quality, and local evidence
segments.  It never interprets module prose: all decisions use source IDs,
locators, hashes, review states, confidence numbers, and explicit anchors.
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
from pathlib import Path
from typing import Any

import coc_fileio

SCHEMA_VERSION = 1
DEFAULT_CRITICAL_THRESHOLD = 0.80
VALID_REVIEW_STATES = frozenset(
    {"auto_accepted", "manual_accepted", "needs_review", "rejected"}
)
_ACCEPTED_REVIEW_STATES = frozenset({"auto_accepted", "manual_accepted"})


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    coc_fileio.write_json_atomic(
        path, payload, indent=2, ensure_ascii=False, trailing_newline=True
    )


def _read_json(path: Path, fallback: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return copy.deepcopy(fallback)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return copy.deepcopy(fallback)
    return payload if isinstance(payload, dict) else copy.deepcopy(fallback)


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    records: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(record, dict):
            records.append(record)
    return records


def _write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records)
    path.write_text(text, encoding="utf-8")


def sha256_file(path: str | Path) -> str | None:
    source = Path(path)
    if not source.is_file():
        return None
    digest = hashlib.sha256()
    with source.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def default_source_id(path: str | Path) -> str:
    stem = Path(path).stem.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", stem).strip("-") or "pdf"
    return f"pdf:{slug}"


def _normalized_source(source: dict[str, Any]) -> dict[str, Any]:
    path = str(source.get("path") or source.get("filename") or "").strip()
    source_id = str(source.get("source_id") or default_source_id(path or "pdf")).strip()
    result: dict[str, Any] = {
        "source_id": source_id,
        "path": path,
        "pages": [p for p in (source.get("pages") or []) if isinstance(p, dict)],
    }
    file_hash = source.get("file_sha256") or (sha256_file(path) if path else None)
    if file_hash:
        result["file_sha256"] = str(file_hash)
    for key in ("title", "chapter", "page_count"):
        if source.get(key) not in (None, "", [], {}):
            result[key] = source[key]
    return result


def initialize_source_indexes(
    campaign_dir: Path,
    scenario_id: str,
    sources: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Create missing page-map/manifest/evidence files and return the bundle."""
    campaign_dir = Path(campaign_dir)
    index_dir = campaign_dir / "index"
    index_dir.mkdir(parents=True, exist_ok=True)
    page_map_path = index_dir / "page-map.json"
    manifest_path = index_dir / "parse-manifest.json"
    segments_path = index_dir / "evidence-segments.jsonl"

    if not page_map_path.exists():
        _write_json(
            page_map_path,
            {
                "schema_version": SCHEMA_VERSION,
                "scenario_id": scenario_id,
                "sources": [_normalized_source(s) for s in (sources or []) if isinstance(s, dict)],
            },
        )
    if not manifest_path.exists():
        _write_json(
            manifest_path,
            {
                "schema_version": SCHEMA_VERSION,
                "scenario_id": scenario_id,
                "default_threshold": DEFAULT_CRITICAL_THRESHOLD,
                "ranges": [],
            },
        )
    if not segments_path.exists():
        _write_jsonl(segments_path, [])
    return load_source_bundle(campaign_dir)


def load_source_bundle(campaign_dir: Path) -> dict[str, Any]:
    campaign_dir = Path(campaign_dir)
    index_dir = campaign_dir / "index"
    return {
        "page_map": _read_json(
            index_dir / "page-map.json",
            {"schema_version": SCHEMA_VERSION, "sources": []},
        ),
        "parse_manifest": _read_json(
            index_dir / "parse-manifest.json",
            {"schema_version": SCHEMA_VERSION, "ranges": []},
        ),
        "evidence_segments": _read_jsonl(index_dir / "evidence-segments.jsonl"),
    }


def write_source_bundle(
    campaign_dir: Path,
    page_map: dict[str, Any],
    parse_manifest: dict[str, Any],
    evidence_segments: list[dict[str, Any]],
) -> None:
    campaign_dir = Path(campaign_dir)
    index_dir = campaign_dir / "index"
    index_dir.mkdir(parents=True, exist_ok=True)
    _write_json(index_dir / "page-map.json", page_map)
    _write_json(index_dir / "parse-manifest.json", parse_manifest)
    _write_jsonl(index_dir / "evidence-segments.jsonl", evidence_segments)


def _source_for_ref(ref: dict[str, Any], page_map: dict[str, Any]) -> dict[str, Any] | None:
    sources = [s for s in (page_map.get("sources") or []) if isinstance(s, dict)]
    source_id = str(ref.get("source_id") or "").strip()
    path = str(ref.get("path") or "").strip()
    if source_id:
        return next((s for s in sources if s.get("source_id") == source_id), None)
    if path:
        matches = [s for s in sources if str(s.get("path") or "") == path]
        if len(matches) == 1:
            return matches[0]
    if len(sources) == 1:
        return sources[0]
    return None


def normalize_source_ref(ref: dict[str, Any]) -> dict[str, Any]:
    result = dict(ref or {})
    if "printed_page" not in result and "pdf_index" not in result and isinstance(result.get("page"), int):
        if result.get("page_kind") == "pdf_index":
            result["pdf_index"] = result["page"]
        else:
            result["printed_page"] = result["page"]
    return result


def resolve_locator(ref: dict[str, Any], page_map: dict[str, Any]) -> dict[str, Any] | None:
    """Resolve printed/PDF identity through a page map; never guess offsets."""
    ref = normalize_source_ref(ref)
    source = _source_for_ref(ref, page_map)
    if source is None:
        return None
    source_id = str(source.get("source_id") or "")
    printed = ref.get("printed_page")
    pdf_index = ref.get("pdf_index")
    if not isinstance(printed, int) and not isinstance(pdf_index, int):
        return None
    for page in source.get("pages") or []:
        if not isinstance(page, dict):
            continue
        if isinstance(printed, int) and page.get("printed_page") != printed:
            continue
        if isinstance(pdf_index, int) and page.get("pdf_index") != pdf_index:
            continue
        result = {
            "source_id": source_id,
            "pdf_index": page.get("pdf_index"),
            "printed_page": page.get("printed_page"),
        }
        if page.get("printed_label") not in (None, ""):
            result["printed_label"] = page.get("printed_label")
        return result
    return None


def _range_for_locator(
    locator: dict[str, Any], parse_manifest: dict[str, Any]
) -> dict[str, Any] | None:
    source_id = locator.get("source_id")
    pdf_index = locator.get("pdf_index")
    for record in parse_manifest.get("ranges") or []:
        if not isinstance(record, dict) or record.get("source_id") != source_id:
            continue
        if pdf_index in (record.get("pdf_indices") or []):
            return record
    return None


def _segments_for_locator(
    locator: dict[str, Any], evidence_segments: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    for segment in evidence_segments or []:
        if not isinstance(segment, dict) or segment.get("source_id") != locator.get("source_id"):
            continue
        seg_locator = segment.get("locator") or {}
        if seg_locator.get("pdf_index") == locator.get("pdf_index"):
            matches.append(segment)
    return matches


def _confidence(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(1.0, number))


def effective_source_confidence(
    ref: dict[str, Any],
    parse_manifest: dict[str, Any],
    evidence_segments: list[dict[str, Any]],
    *,
    page_map: dict[str, Any],
) -> float | None:
    locator = resolve_locator(ref, page_map)
    if locator is None:
        return None
    range_record = _range_for_locator(locator, parse_manifest)
    if range_record is None:
        return None
    values: list[float] = []
    quality = range_record.get("quality") or {}
    range_conf = _confidence(quality.get("overall"))
    if range_conf is not None:
        values.append(range_conf)
    for segment in _segments_for_locator(locator, evidence_segments):
        segment_conf = _confidence(segment.get("parse_confidence"))
        if segment_conf is not None:
            values.append(segment_conf)
    return min(values) if values else None


def _finding(code: str, message: str, ref: dict[str, Any]) -> dict[str, Any]:
    return {"code": code, "severity": "error", "message": message, "source_ref": copy.deepcopy(ref)}


def _anchor_present(anchor: str, segments: list[dict[str, Any]]) -> bool:
    for segment in segments:
        if anchor in [str(v) for v in (segment.get("grep_anchors") or [])]:
            return True
        text = segment.get("text")
        if isinstance(text, str) and anchor in text:
            return True
    return False


def critical_source_allowed(
    refs: list[dict[str, Any]],
    parse_manifest: dict[str, Any],
    evidence_segments: list[dict[str, Any]],
    *,
    page_map: dict[str, Any],
    threshold: float | None = None,
) -> dict[str, Any]:
    """Return whether at least one declared source ref is fit for a critical reveal."""
    threshold_value = _confidence(
        threshold if threshold is not None else parse_manifest.get("default_threshold", DEFAULT_CRITICAL_THRESHOLD)
    )
    if threshold_value is None:
        threshold_value = DEFAULT_CRITICAL_THRESHOLD
    all_findings: list[dict[str, Any]] = []
    accepted_confidences: list[float] = []

    if not refs:
        return {
            "allowed": False,
            "confidence": None,
            "findings": [_finding("missing_source_ref", "critical node has no source refs", {})],
        }

    for raw_ref in refs:
        ref = raw_ref if isinstance(raw_ref, dict) else {}
        ref_findings: list[dict[str, Any]] = []
        locator = resolve_locator(ref, page_map)
        if locator is None:
            ref_findings.append(_finding("unresolved_source_locator", "source locator does not resolve through page map", ref))
            all_findings.extend(ref_findings)
            continue
        range_record = _range_for_locator(locator, parse_manifest)
        if range_record is None:
            ref_findings.append(_finding("missing_parse_range", "no parse-manifest range covers source locator", ref))
            all_findings.extend(ref_findings)
            continue
        review_state = str(range_record.get("review_state") or "needs_review")
        if review_state not in _ACCEPTED_REVIEW_STATES:
            ref_findings.append(_finding("source_needs_review", f"parse range review_state={review_state}", ref))
        source = _source_for_ref(ref, page_map) or {}
        page_hash = source.get("file_sha256")
        range_hash = range_record.get("file_sha256")
        if page_hash and range_hash and page_hash != range_hash:
            ref_findings.append(_finding("stale_source_hash", "page map and parse manifest file hashes differ", ref))
        segments = _segments_for_locator(locator, evidence_segments)
        anchor = str(ref.get("grep_anchor") or "").strip()
        if anchor and not _anchor_present(anchor, segments):
            ref_findings.append(_finding("missing_source_anchor", f"grep anchor {anchor!r} not found", ref))
        confidence = effective_source_confidence(
            ref, parse_manifest, evidence_segments, page_map=page_map
        )
        if confidence is None or confidence < threshold_value:
            ref_findings.append(
                _finding(
                    "low_source_confidence",
                    f"effective confidence {confidence!r} below threshold {threshold_value}",
                    ref,
                )
            )
        if not ref_findings and confidence is not None:
            accepted_confidences.append(confidence)
        else:
            all_findings.extend(ref_findings)

    return {
        "allowed": bool(accepted_confidences),
        "confidence": max(accepted_confidences) if accepted_confidences else None,
        "findings": [] if accepted_confidences else all_findings,
    }


def strip_local_evidence_text(bundle: dict[str, Any]) -> dict[str, Any]:
    """Return a module-library-safe bundle with local source prose removed."""
    result = copy.deepcopy(bundle or {})
    for segment in result.get("evidence_segments") or []:
        if isinstance(segment, dict):
            segment.pop("text", None)
    return result
