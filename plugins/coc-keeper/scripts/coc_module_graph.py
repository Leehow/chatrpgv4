#!/usr/bin/env python3
"""Assemble, validate, merge, and query evidence-bound COC module graph shards.

Semantic extraction is model-owned.  This module owns only the deterministic
artifact seam after an extractor has proposed one ``GraphShard``.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import unicodedata
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_fileio
import coc_pdf_bundle


CONTRACT_PATH = (
    SCRIPT_DIR.parent
    / "references"
    / "module-graph-contract-v3.json"
)
CONTRACT = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
BUILD_CONTRACT_PATH = (
    SCRIPT_DIR.parent
    / "references"
    / "module-graph-build-contract-v1.json"
)
BUILD_CONTRACT = json.loads(BUILD_CONTRACT_PATH.read_text(encoding="utf-8"))
EVIDENCE_CONTRACT_ID = str(CONTRACT["evidence_contract_id"])
SHARD_CONTRACT_ID = str(CONTRACT["shard_contract_id"])
GRAPH_CONTRACT_ID = str(CONTRACT["graph_contract_id"])
SCHEMA_VERSION = int(CONTRACT["schema_version"])
EXTRACTION_PACKET_CONTRACT_ID = str(
    BUILD_CONTRACT["extraction_packet_contract_id"]
)
PREPARE_REQUEST_CONTRACT_ID = str(
    BUILD_CONTRACT["prepare_request_contract_id"]
)
SEMANTIC_REVIEW_CONTRACT_ID = str(
    BUILD_CONTRACT["semantic_review_contract_id"]
)
REVIEW_RECEIPT_CONTRACT_ID = str(
    BUILD_CONTRACT["review_receipt_contract_id"]
)
BUILD_PLAN_CONTRACT_ID = str(BUILD_CONTRACT["build_plan_contract_id"])
BUILD_MANIFEST_CONTRACT_ID = str(BUILD_CONTRACT["build_manifest_contract_id"])

SEMANTIC_ID_RE = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
SOURCE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
SOURCE_LANGUAGE_RE = re.compile(r"^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")

VISIBILITIES = frozenset(CONTRACT["visibility"])
TRUTH_STATUSES = frozenset(CONTRACT["truth_status"])
COVERAGE_STATUSES = frozenset(CONTRACT["coverage_status"])
COVERAGE_DOMAINS = tuple(CONTRACT["coverage_domains"])
NODE_KINDS = frozenset(CONTRACT["node_kinds"])
RELATION_KINDS = frozenset(CONTRACT["relation_kinds"])
SHARD_KEYS = frozenset(CONTRACT["shard_keys"])
NODE_KEYS = frozenset(CONTRACT["node_keys"])
CLAIM_KEYS = frozenset(CONTRACT["claim_keys"])
RELATION_KEYS = frozenset(CONTRACT["relation_keys"])
EXTRACTION_PACKET_KEYS = frozenset(BUILD_CONTRACT["extraction_packet_keys"])
PREPARE_REQUEST_KEYS = frozenset(BUILD_CONTRACT["prepare_request_keys"])
PAGE_REF_KEYS = frozenset(BUILD_CONTRACT["page_ref_keys"])
KNOWN_NODE_KEYS = frozenset(BUILD_CONTRACT["known_node_keys"])
OUTPUT_BUDGET_KEYS = frozenset(BUILD_CONTRACT["output_budget_keys"])
SEMANTIC_REVIEW_KEYS = frozenset(BUILD_CONTRACT["semantic_review_keys"])
SEMANTIC_REVIEW_CHECKS = tuple(BUILD_CONTRACT["semantic_review_checks"])
SEMANTIC_REVIEW_CHECK_STATUSES = frozenset(
    BUILD_CONTRACT["semantic_review_check_statuses"]
)
SEMANTIC_REVIEW_VERDICTS = frozenset(BUILD_CONTRACT["semantic_review_verdicts"])
SEMANTIC_FINDING_KEYS = frozenset(BUILD_CONTRACT["semantic_finding_keys"])
REVIEW_RECEIPT_KEYS = frozenset(BUILD_CONTRACT["review_receipt_keys"])
BUILD_PLAN_KEYS = frozenset(BUILD_CONTRACT["build_plan_keys"])
PLANNED_SHARD_KEYS = frozenset(BUILD_CONTRACT["planned_shard_keys"])
SOURCE_BUNDLE_BINDING_KEYS = frozenset(
    BUILD_CONTRACT["source_bundle_binding_keys"]
)
ACCEPTED_SHARD_MANIFEST_KEYS = frozenset(
    BUILD_CONTRACT["accepted_shard_manifest_keys"]
)
BUILD_MANIFEST_KEYS = frozenset(BUILD_CONTRACT["build_manifest_keys"])
BUILD_STATUSES = frozenset(BUILD_CONTRACT["build_statuses"])
SOURCE_REF_KEYS = frozenset({"source_id", "pdf_index", "grep_anchor", "text_sha256"})


class ModuleGraphError(ValueError):
    """The proposed shards cannot be promoted into one coherent graph."""

    def __init__(self, findings: list[dict[str, str]]):
        super().__init__("module graph validation failed")
        self.findings = findings


def _finding(code: str, path: str, message: str) -> dict[str, str]:
    return {"code": code, "path": path, "message": message}


def load_page_catalog(
    bundle_dirs: list[Path | str],
) -> dict[tuple[str, int], dict[str, Any]]:
    """Load accepted page Markdown without reopening any original PDF."""
    if not isinstance(bundle_dirs, list) or not bundle_dirs:
        raise ModuleGraphError(
            [_finding("source_bundle_required", "/", "at least one source bundle is required")]
        )
    catalog: dict[tuple[str, int], dict[str, Any]] = {}
    findings: list[dict[str, str]] = []
    for bundle_index, raw_bundle in enumerate(bundle_dirs):
        bundle = Path(raw_bundle).expanduser().resolve()
        manifest_path = bundle / "manifest.json"
        base_path = f"/source_bundles/{bundle_index}"
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            findings.append(_finding("invalid_source_manifest", base_path, str(exc)))
            continue
        if manifest.get("schema_version") != 1 or manifest.get("producer") != "codex-pdf-skill":
            findings.append(
                _finding("source_contract_mismatch", base_path, "expected source-bundle schema v1")
            )
            continue
        source = manifest.get("source")
        if not isinstance(source, dict) or not _valid_source_id(source.get("source_id")):
            findings.append(_finding("invalid_source_identity", f"{base_path}/source", "invalid source_id"))
            continue
        source_id = source["source_id"]
        page_count = source.get("page_count")
        if isinstance(page_count, bool) or not isinstance(page_count, int) or page_count < 1:
            findings.append(_finding("invalid_page_count", f"{base_path}/source/page_count", "must be positive"))
            continue
        pages = manifest.get("pages")
        if not isinstance(pages, list) or not pages:
            findings.append(_finding("source_pages_required", f"{base_path}/pages", "must be non-empty"))
            continue
        for page_row_index, page in enumerate(pages):
            page_path = f"{base_path}/pages/{page_row_index}"
            if not isinstance(page, dict):
                findings.append(_finding("invalid_source_page", page_path, "must be an object"))
                continue
            pdf_index = page.get("pdf_index")
            if (
                isinstance(pdf_index, bool)
                or not isinstance(pdf_index, int)
                or not 0 <= pdf_index < page_count
            ):
                findings.append(_finding("invalid_pdf_index", f"{page_path}/pdf_index", "out of bounds"))
                continue
            rel = page.get("markdown_path")
            if not isinstance(rel, str) or not rel.strip():
                findings.append(_finding("invalid_markdown_path", f"{page_path}/markdown_path", "missing"))
                continue
            markdown_path = (bundle / rel).resolve()
            try:
                markdown_path.relative_to(bundle)
            except ValueError:
                findings.append(_finding("source_path_escape", f"{page_path}/markdown_path", rel))
                continue
            try:
                payload = markdown_path.read_bytes()
                text = payload.decode("utf-8")
            except (OSError, UnicodeDecodeError) as exc:
                findings.append(_finding("source_page_unreadable", page_path, str(exc)))
                continue
            actual_digest = hashlib.sha256(payload).hexdigest()
            if page.get("text_sha256") != actual_digest:
                findings.append(_finding("source_page_hash_mismatch", page_path, actual_digest))
                continue
            if page.get("review_state") not in {"manual_accepted", "auto_accepted"}:
                findings.append(_finding("source_page_unreviewed", page_path, "page is not accepted"))
            confidence = page.get("parse_confidence")
            if (
                isinstance(confidence, bool)
                or not isinstance(confidence, (int, float))
                or not 0 <= confidence <= 1
            ):
                findings.append(_finding("invalid_parse_confidence", page_path, "expected 0 through 1"))
            anchors = page.get("grep_anchors")
            if not isinstance(anchors, list) or any(
                not isinstance(anchor, str) or (anchor and anchor not in text)
                for anchor in (anchors or [])
            ):
                findings.append(_finding("invalid_manifest_anchor", page_path, "anchor is not verbatim"))
            key = (source_id, pdf_index)
            row = {
                "source_id": source_id,
                "pdf_index": pdf_index,
                "text": text,
                "text_sha256": actual_digest,
                "parse_confidence": confidence,
                "review_state": page.get("review_state"),
                "bundle_path": str(bundle),
                "markdown_path": rel,
            }
            existing = catalog.get(key)
            if existing is not None and existing["text_sha256"] != actual_digest:
                findings.append(_finding("source_page_conflict", page_path, f"{source_id}:{pdf_index}"))
            else:
                catalog[key] = row
    if findings:
        raise ModuleGraphError(findings)
    return catalog


def _valid_semantic_id(value: Any) -> bool:
    return isinstance(value, str) and len(value) <= 160 and bool(
        SEMANTIC_ID_RE.fullmatch(value)
    )


def _valid_source_id(value: Any) -> bool:
    """Accept the existing title-derived source-bundle identity surface."""
    return isinstance(value, str) and bool(SOURCE_ID_RE.fullmatch(value))


def _valid_source_language(value: Any) -> bool:
    return isinstance(value, str) and bool(SOURCE_LANGUAGE_RE.fullmatch(value))


def _validate_source_refs(
    value: Any,
    path: str,
    page_catalog: dict[tuple[str, int], dict[str, Any]] | None = None,
) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    if not isinstance(value, list) or not value:
        return [_finding("source_refs_required", path, "requires source evidence")]
    for index, ref in enumerate(value):
        ref_path = f"{path}/{index}"
        if not isinstance(ref, dict):
            findings.append(_finding("invalid_source_ref", ref_path, "must be an object"))
            continue
        for key in sorted(set(ref) - SOURCE_REF_KEYS):
            findings.append(
                _finding("unknown_source_ref_key", f"{ref_path}/{key}", "not in contract")
            )
        if not _valid_source_id(ref.get("source_id")):
            findings.append(
                _finding("invalid_source_id", f"{ref_path}/source_id", "must be a safe source identity")
            )
        pdf_index = ref.get("pdf_index")
        if isinstance(pdf_index, bool) or not isinstance(pdf_index, int) or pdf_index < 0:
            findings.append(
                _finding("invalid_pdf_index", f"{ref_path}/pdf_index", "must be non-negative")
            )
        anchor = ref.get("grep_anchor")
        if not isinstance(anchor, str) or not anchor.strip():
            findings.append(
                _finding("grep_anchor_required", f"{ref_path}/grep_anchor", "must be non-empty")
            )
        digest = ref.get("text_sha256")
        if digest is not None and (
            not isinstance(digest, str) or not SHA256_RE.fullmatch(digest)
        ):
            findings.append(
                _finding("invalid_text_sha256", f"{ref_path}/text_sha256", "must be lowercase sha256")
            )
        if page_catalog is None or not isinstance(ref.get("source_id"), str):
            continue
        if isinstance(pdf_index, bool) or not isinstance(pdf_index, int):
            continue
        page = page_catalog.get((ref["source_id"], pdf_index))
        if not isinstance(page, dict):
            findings.append(
                _finding("source_page_not_bound", ref_path, "source page is absent from the bound catalog")
            )
            continue
        page_digest = page.get("text_sha256")
        if digest is not None and page_digest != digest:
            findings.append(
                _finding("source_page_hash_mismatch", ref_path, "source page hash drifted")
            )
        page_text = page.get("text")
        if isinstance(anchor, str) and anchor.strip() and (
            not isinstance(page_text, str) or anchor not in page_text
        ):
            findings.append(
                _finding("grep_anchor_not_found", f"{ref_path}/grep_anchor", "anchor is not verbatim")
            )
    return findings


def _split_evidence_blocks(text: str, *, max_chars: int = 1600) -> list[str]:
    blocks: list[str] = []
    for paragraph in re.split(r"\n[ \t]*\n+", text):
        exact = paragraph.strip()
        if not exact:
            continue
        if len(exact) <= max_chars:
            blocks.append(exact)
            continue
        for start in range(0, len(exact), max_chars):
            chunk = exact[start : start + max_chars]
            if chunk:
                blocks.append(chunk)
    return blocks


def build_evidence_packet(
    page_catalog: dict[tuple[str, int], dict[str, Any]],
    *,
    section_id: str,
    page_keys: list[tuple[str, int]],
) -> dict[str, Any]:
    """Create semantic span IDs while retaining machine-only source bindings."""
    if not _valid_semantic_id(section_id):
        raise ModuleGraphError(
            [_finding("invalid_section_id", "/section_id", "must be semantic")]
        )
    if not isinstance(page_keys, list) or not page_keys:
        raise ModuleGraphError(
            [_finding("page_keys_required", "/page_keys", "at least one page is required")]
        )
    spans: list[dict[str, Any]] = []
    for source_id, pdf_index in sorted(page_keys, key=lambda key: (key[0], key[1])):
        page = page_catalog.get((source_id, pdf_index))
        if page is None:
            raise ModuleGraphError(
                [_finding("source_page_not_bound", "/page_keys", f"{source_id}:{pdf_index}")]
            )
        # Span ids are page-scoped, never section-scoped: the plan guarantees
        # every page belongs to exactly one section, so (page, block) is
        # already module-unique, and a page re-packeted elsewhere (the
        # skeleton pass reads section openers too) must yield the SAME ids --
        # block ordinals reset per page. The model echoes these ids; the
        # machine owns the namespace, per the model-facing identifier law.
        block_index = 0
        for block in _split_evidence_blocks(page["text"]):
            block_index += 1
            span_id = f"span-page-{pdf_index}-block-{block_index}"
            if not _valid_semantic_id(span_id):
                raise ModuleGraphError(
                    [_finding("invalid_span_id", "/spans", span_id)]
                )
            spans.append(
                {
                    "span_id": span_id,
                    "text": block,
                    "source_ref": {
                        "source_id": source_id,
                        "pdf_index": pdf_index,
                        "grep_anchor": block[:160],
                        "text_sha256": page["text_sha256"],
                    },
                }
            )
    return {
        "contract_id": EVIDENCE_CONTRACT_ID,
        "schema_version": 1,
        "section_id": section_id,
        "spans": spans,
    }


def project_evidence_for_model(packet: dict[str, Any]) -> dict[str, Any]:
    """Drop machine bindings before a semantic extractor sees the packet."""
    if not isinstance(packet, dict) or packet.get("contract_id") != EVIDENCE_CONTRACT_ID:
        raise ModuleGraphError(
            [_finding("evidence_contract_mismatch", "/", EVIDENCE_CONTRACT_ID)]
        )
    spans = packet.get("spans")
    if not isinstance(spans, list) or not spans:
        raise ModuleGraphError(
            [_finding("evidence_spans_required", "/spans", "must be non-empty")]
        )
    return {
        "contract_id": "coc.module-graph-evidence-view.v1",
        "schema_version": 1,
        "section_id": packet.get("section_id"),
        "spans": [
            {"span_id": span.get("span_id"), "text": span.get("text")}
            for span in spans
            if isinstance(span, dict)
        ],
    }


def _page_window(
    page_catalog: dict[tuple[str, int], dict[str, Any]],
    page_keys: list[tuple[str, int]],
) -> dict[str, int]:
    """Where this packet's pages sit inside the pages the bundle carries."""
    if not page_keys:
        return {"first_page": -1, "last_page": -1, "pages_before": 0, "pages_after": 0}
    sources = {source_id for source_id, _ in page_keys}
    book = sorted(
        index for (source_id, index) in page_catalog
        if source_id in sources
    )
    first = min(index for _, index in page_keys)
    last = max(index for _, index in page_keys)
    return {
        "first_page": first,
        "last_page": last,
        "pages_before": sum(1 for index in book if index < first),
        "pages_after": sum(1 for index in book if index > last),
    }


def prepare_extraction_packet(
    page_catalog: dict[tuple[str, int], dict[str, Any]],
    *,
    module_id: str,
    section_id: str,
    section_role: str,
    source_language: str,
    aspects: list[str],
    default_visibility: str,
    approved_player_safe_span_ids: list[str],
    known_nodes: list[dict[str, Any]],
    output_budget: dict[str, int],
    page_keys: list[tuple[str, int]],
    selected_evidence_span_ids: list[str] | None = None,
) -> dict[str, dict[str, Any]]:
    """Prepare one closed, model-safe extraction packet from accepted pages."""
    findings: list[dict[str, str]] = []
    for field, value in (
        ("module_id", module_id),
        ("section_id", section_id),
        ("section_role", section_role),
    ):
        if not _valid_semantic_id(value):
            findings.append(
                _finding("invalid_semantic_id", f"/{field}", "must be kebab-case")
            )

    if not _valid_source_language(source_language):
        findings.append(
            _finding(
                "invalid_source_language",
                "/source_language",
                "must be a BCP 47 language tag such as en or zh-Hans",
            )
        )

    declared_aspects: set[str] = set()
    if not isinstance(aspects, list) or not aspects:
        findings.append(_finding("aspects_required", "/aspects", "must be non-empty"))
    else:
        for index, aspect in enumerate(aspects):
            path = f"/aspects/{index}"
            if aspect not in COVERAGE_DOMAINS:
                findings.append(_finding("invalid_aspect", path, str(aspect)))
            elif aspect in declared_aspects:
                findings.append(_finding("duplicate_aspect", path, aspect))
            else:
                declared_aspects.add(aspect)

    if default_visibility not in VISIBILITIES:
        findings.append(
            _finding(
                "invalid_visibility",
                "/default_visibility",
                "unknown visibility",
            )
        )

    if not isinstance(known_nodes, list):
        findings.append(_finding("invalid_known_nodes", "/known_nodes", "must be an array"))
        known_nodes = []
    seen_known_ids: set[str] = set()
    for index, node in enumerate(known_nodes):
        path = f"/known_nodes/{index}"
        if not isinstance(node, dict) or set(node) != KNOWN_NODE_KEYS:
            findings.append(
                _finding("invalid_known_node", path, "must use the frozen field set")
            )
            continue
        node_id = node.get("node_id")
        node_kind = node.get("node_kind")
        if not _valid_semantic_id(node_id):
            findings.append(_finding("invalid_node_id", f"{path}/node_id", "must be semantic"))
        elif node_id in seen_known_ids:
            findings.append(_finding("duplicate_node_id", f"{path}/node_id", node_id))
        else:
            seen_known_ids.add(node_id)
        if node_kind not in NODE_KINDS:
            findings.append(_finding("invalid_node_kind", f"{path}/node_kind", "unknown kind"))
        elif _valid_semantic_id(node_id) and not node_id.startswith(f"{node_kind}-"):
            findings.append(
                _finding(
                    "node_id_kind_mismatch",
                    f"{path}/node_id",
                    f"must start with {node_kind}-",
                )
            )
        if not isinstance(node.get("name"), str) or not node["name"].strip():
            findings.append(_finding("node_name_required", f"{path}/name", "must be non-empty"))
        if node.get("visibility") not in VISIBILITIES:
            findings.append(_finding("invalid_visibility", f"{path}/visibility", "unknown visibility"))

    if not isinstance(output_budget, dict) or set(output_budget) != OUTPUT_BUDGET_KEYS:
        findings.append(
            _finding("invalid_output_budget", "/output_budget", "must use the frozen field set")
        )
    else:
        for field, upper in (("max_nodes", 200), ("max_relations", 400)):
            value = output_budget.get(field)
            if (
                isinstance(value, bool)
                or not isinstance(value, int)
                or not 1 <= value <= upper
            ):
                findings.append(
                    _finding(
                        "invalid_output_budget",
                        f"/output_budget/{field}",
                        f"must be an integer from 1 through {upper}",
                    )
                )

    if findings:
        raise ModuleGraphError(findings)

    evidence_packet = build_evidence_packet(
        page_catalog,
        section_id=section_id,
        page_keys=page_keys,
    )
    available_span_ids = {
        span["span_id"] for span in evidence_packet["spans"]
    }
    selected = selected_evidence_span_ids
    if selected is not None and not isinstance(selected, list):
        raise ModuleGraphError(
            [_finding("invalid_selected_spans", "/selected_evidence_span_ids", "must be an array")]
        )
    if selected:
        if len(set(selected)) != len(selected):
            findings.append(
                _finding(
                    "duplicate_evidence_span",
                    "/selected_evidence_span_ids",
                    "span ids must be unique",
                )
            )
        unknown_selected = sorted(set(selected) - available_span_ids)
        if unknown_selected:
            findings.append(
                _finding(
                    "unknown_evidence_span",
                    "/selected_evidence_span_ids",
                    ",".join(unknown_selected),
                )
            )
        if findings:
            raise ModuleGraphError(findings)
        selected_set = set(selected)
        evidence_packet = {
            **evidence_packet,
            "spans": [
                span for span in evidence_packet["spans"]
                if span["span_id"] in selected_set
            ],
        }
    evidence_span_ids = {
        span["span_id"] for span in evidence_packet["spans"]
    }
    if not isinstance(approved_player_safe_span_ids, list):
        raise ModuleGraphError(
            [_finding("invalid_player_safe_spans", "/approved_player_safe_span_ids", "must be an array")]
        )
    approved_seen: set[str] = set()
    for index, span_id in enumerate(approved_player_safe_span_ids):
        path = f"/approved_player_safe_span_ids/{index}"
        if span_id not in evidence_span_ids:
            findings.append(_finding("unknown_evidence_span", path, str(span_id)))
        elif span_id in approved_seen:
            findings.append(_finding("duplicate_evidence_span", path, span_id))
        else:
            approved_seen.add(span_id)
    if findings:
        raise ModuleGraphError(findings)

    extraction_packet = {
        "contract_id": EXTRACTION_PACKET_CONTRACT_ID,
        "schema_version": 1,
        "module_id": module_id,
        "section_id": section_id,
        "section_role": section_role,
        "source_language": source_language,
        "aspects": list(aspects),
        "default_visibility": default_visibility,
        "approved_player_safe_span_ids": list(approved_player_safe_span_ids),
        "known_nodes": copy.deepcopy(known_nodes),
        "output_budget": dict(output_budget),
        "evidence_view": project_evidence_for_model(evidence_packet),
        # What this packet is a slice OF. A section cut out of a long book ends
        # mid-content, and a model that cannot see where the rest lives cites
        # it anyway: every fabricated span id on record (1281, across three
        # runs) named a page just past the packet's last one, and none appeared
        # in any run whose sections were not cut. Saying plainly that pages
        # exist outside this window is the difference between a model that
        # guesses at them and one that reports its section as partial.
        "page_window": _page_window(page_catalog, page_keys),
    }
    if set(extraction_packet) != EXTRACTION_PACKET_KEYS:
        raise AssertionError("extraction packet field set drifted from contract")
    return {
        "evidence_packet": evidence_packet,
        "extraction_packet": extraction_packet,
    }


def prepare_from_request(
    page_catalog: dict[tuple[str, int], dict[str, Any]],
    request: Any,
) -> dict[str, dict[str, Any]]:
    """Validate one parent request and prepare the closed extraction packet."""
    findings: list[dict[str, str]] = []
    if not isinstance(request, dict):
        raise ModuleGraphError(
            [_finding("invalid_prepare_request", "/request", "must be an object")]
        )
    if set(request) != PREPARE_REQUEST_KEYS:
        findings.append(
            _finding("invalid_prepare_request_fields", "/request", "must use frozen fields")
        )
    if request.get("contract_id") != PREPARE_REQUEST_CONTRACT_ID:
        findings.append(
            _finding("contract_mismatch", "/request/contract_id", PREPARE_REQUEST_CONTRACT_ID)
        )
    if request.get("schema_version") != 1:
        findings.append(_finding("version_mismatch", "/request/schema_version", "expected 1"))
    page_refs = request.get("page_refs")
    page_keys: list[tuple[str, int]] = []
    seen: set[tuple[str, int]] = set()
    if not isinstance(page_refs, list) or not page_refs:
        findings.append(_finding("page_refs_required", "/request/page_refs", "must be non-empty"))
    else:
        for index, row in enumerate(page_refs):
            path = f"/request/page_refs/{index}"
            if not isinstance(row, dict) or set(row) != PAGE_REF_KEYS:
                findings.append(_finding("invalid_page_ref", path, "must use frozen fields"))
                continue
            source_id = row.get("source_id")
            pdf_index = row.get("pdf_index")
            if not _valid_source_id(source_id):
                findings.append(_finding("invalid_source_id", f"{path}/source_id", "invalid source"))
                continue
            if isinstance(pdf_index, bool) or not isinstance(pdf_index, int) or pdf_index < 0:
                findings.append(_finding("invalid_pdf_index", f"{path}/pdf_index", "must be non-negative"))
                continue
            key = (source_id, pdf_index)
            if key in seen:
                findings.append(_finding("duplicate_page_ref", path, f"{source_id}:{pdf_index}"))
            else:
                seen.add(key)
                page_keys.append(key)
    if findings:
        raise ModuleGraphError(findings)
    return prepare_extraction_packet(
        page_catalog,
        module_id=request.get("module_id"),
        section_id=request.get("section_id"),
        section_role=request.get("section_role"),
        source_language=request.get("source_language"),
        aspects=request.get("aspects"),
        default_visibility=request.get("default_visibility"),
        approved_player_safe_span_ids=request.get(
            "approved_player_safe_span_ids"
        ),
        known_nodes=request.get("known_nodes"),
        output_budget=request.get("output_budget"),
        page_keys=page_keys,
        selected_evidence_span_ids=(
            request.get("selected_evidence_span_ids") or None
        ),
    )


def load_evidence_catalog(
    packets: list[dict[str, Any] | Path | str],
    *,
    page_catalog: dict[tuple[str, int], dict[str, Any]] | None = None,
) -> dict[str, dict[str, Any]]:
    """Validate machine-created evidence packets and index semantic spans."""
    if not isinstance(packets, list) or not packets:
        raise ModuleGraphError(
            [_finding("evidence_packet_required", "/", "at least one packet is required")]
        )
    catalog: dict[str, dict[str, Any]] = {}
    findings: list[dict[str, str]] = []
    for packet_index, raw_packet in enumerate(packets):
        packet = (
            _read_json(Path(raw_packet))
            if isinstance(raw_packet, (str, Path))
            else raw_packet
        )
        base = f"/evidence_packets/{packet_index}"
        if not isinstance(packet, dict) or packet.get("contract_id") != EVIDENCE_CONTRACT_ID:
            findings.append(_finding("evidence_contract_mismatch", base, EVIDENCE_CONTRACT_ID))
            continue
        if packet.get("schema_version") != 1 or not _valid_semantic_id(packet.get("section_id")):
            findings.append(_finding("invalid_evidence_packet", base, "bad version or section id"))
            continue
        spans = packet.get("spans")
        if not isinstance(spans, list) or not spans:
            findings.append(_finding("evidence_spans_required", f"{base}/spans", "must be non-empty"))
            continue
        for span_index, span in enumerate(spans):
            path = f"{base}/spans/{span_index}"
            if not isinstance(span, dict):
                findings.append(_finding("invalid_evidence_span", path, "must be an object"))
                continue
            span_id = span.get("span_id")
            text = span.get("text")
            if not _valid_semantic_id(span_id):
                findings.append(_finding("invalid_span_id", f"{path}/span_id", "must be semantic"))
                continue
            if not isinstance(text, str) or not text:
                findings.append(_finding("evidence_text_required", f"{path}/text", "must be non-empty"))
                continue
            ref_findings = _validate_source_refs(
                [span.get("source_ref")], f"{path}/source_ref", page_catalog
            )
            findings.extend(ref_findings)
            source_ref = span.get("source_ref")
            if isinstance(source_ref, dict):
                anchor = source_ref.get("grep_anchor")
                if isinstance(anchor, str) and anchor not in text:
                    findings.append(
                        _finding("span_anchor_not_found", f"{path}/source_ref/grep_anchor", "not in span")
                    )
            row = {
                "span_id": span_id,
                "section_id": packet["section_id"],
                "text": text,
                "source_ref": copy.deepcopy(source_ref),
            }
            existing = catalog.get(span_id)
            if existing is not None and existing != row:
                findings.append(_finding("evidence_span_conflict", path, span_id))
            else:
                catalog[span_id] = row
    if findings:
        raise ModuleGraphError(findings)
    return catalog


def _validate_span_ids(
    value: Any,
    path: str,
    evidence_catalog: dict[str, dict[str, Any]] | None,
) -> list[dict[str, str]]:
    if not isinstance(value, list) or not value:
        return [_finding("evidence_span_ids_required", path, "must be non-empty")]
    findings: list[dict[str, str]] = []
    seen: set[str] = set()
    for index, span_id in enumerate(value):
        item_path = f"{path}/{index}"
        if not _valid_semantic_id(span_id):
            findings.append(_finding("invalid_span_id", item_path, "must be semantic"))
        elif span_id in seen:
            findings.append(_finding("duplicate_evidence_span", item_path, span_id))
        else:
            seen.add(span_id)
            if evidence_catalog is not None and span_id not in evidence_catalog:
                findings.append(_finding("unknown_evidence_span", item_path, span_id))
    return findings


def assemble_model_shard(
    shard: Any, *, default_visibility: str = "keeper-only"
) -> Any:
    """Fill what the machine owns: evidence scope, coverage, claim defaults, relations."""
    if not isinstance(shard, dict):
        return copy.deepcopy(shard)

    assembled = copy.deepcopy(shard)
    proposed_scope = assembled.get("evidence_span_ids")
    span_ids = {
        span_id
        for span_id in (proposed_scope if isinstance(proposed_scope, list) else [])
        if isinstance(span_id, str)
    }
    for collection_name in ("nodes", "claims"):
        collection = assembled.get(collection_name)
        if not isinstance(collection, list):
            continue
        for item in collection:
            if not isinstance(item, dict):
                continue
            values = item.get("evidence_span_ids")
            if not isinstance(values, list):
                continue
            span_ids.update(value for value in values if isinstance(value, str))
    assembled["evidence_span_ids"] = sorted(span_ids)

    # Coverage accounting is the machine's, not the model's: the contract law
    # says every undeclared aspect is exactly unresolved, so the model states
    # statuses only for domains it actually reviewed and the assembly fills
    # the rest. A model asked to emit ten bookkeeping keys gets them wrong
    # forever (three rounds of one identical coverage finding, observed).
    coverage = assembled.get("coverage")
    filled = dict(coverage) if isinstance(coverage, dict) else {}
    for domain in COVERAGE_DOMAINS:
        filled.setdefault(domain, "unresolved")
    assembled["coverage"] = filled

    # The same law, applied to the claim fields that never vary. Measured over
    # every accepted shard on record (968 claims): `visibility` was the
    # packet's own `default_visibility` 968 times, `asserted_by_ids` and
    # `known_by_ids` were empty 968 times, and `validity` said "no time bound"
    # 764 times. Those four cost a quarter of the claims the model writes and
    # carry nothing. A model that omits them means the default; a model that
    # states something else still wins, so nothing it knows is lost.
    for claim in assembled.get("claims") or []:
        if not isinstance(claim, dict):
            continue
        claim.setdefault("visibility", default_visibility)
        claim.setdefault("asserted_by_ids", [])
        claim.setdefault("known_by_ids", [])
        claim.setdefault("validity", None)

    # Claim ids are the machine's too, derived from what the claim says. A
    # reader naming them by hand collides two ways: positionally (`c1` restarts
    # in every section, 32 false conflicts on record) and semantically -- the
    # skeleton wrote `claim-elias-present-peru` for "Elias is in the Peru
    # section" and a deep read wrote the same id for "Elias is in the Peru
    # prologue scene". Both are true, neither is the other, and one id cannot
    # hold them. Derived from subject, predicate and object, the same fact read
    # twice merges and two facts never collide.
    _rename_claims(assembled)

    # Relations are a projection of claims, not a second reading. The contract
    # already requires every relation to restate its claim exactly -- across
    # 966 relations on record, 966 did, and none carried properties of their
    # own. Deriving them here rather than asking for them cuts a fifth of the
    # generation and retires `relation_claim_mismatch`: a derived relation
    # cannot disagree with the claim it came from.
    if assembled.get("relations") is None:
        assembled["relations"] = [
            derived for derived in (
                _relation_from_claim(claim) for claim in assembled.get("claims") or []
            ) if derived is not None
        ]
    return assembled


def canonical_claim_id(claim: Any) -> str | None:
    """The id a claim's own content gives it, or None if it states too little."""
    if not isinstance(claim, dict):
        return None
    subject = claim.get("subject_id")
    predicate = claim.get("predicate")
    obj = claim.get("object")
    target = obj.get("node_id") if isinstance(obj, dict) else None
    if not all(isinstance(v, str) and v for v in (subject, predicate, target)):
        return None
    stem = f"claim-{subject}-{predicate}-{target}"
    if len(stem) <= 160:
        return stem
    # Long ids still have to be stable and unique; a digest of the same three
    # fields keeps both properties when the readable form will not fit.
    digest = hashlib.sha256(stem.encode("utf-8")).hexdigest()[:16]
    return f"claim-{subject[:60]}-{digest}"


def _rename_claims(assembled: dict[str, Any]) -> None:
    """Give every claim the id its content implies, and follow the references."""
    claims = assembled.get("claims")
    if not isinstance(claims, list):
        return
    renamed: dict[str, str] = {}
    for claim in claims:
        if not isinstance(claim, dict):
            continue
        canonical = canonical_claim_id(claim)
        if canonical is None:
            continue
        authored = claim.get("claim_id")
        if isinstance(authored, str) and authored != canonical:
            renamed[authored] = canonical
        claim["claim_id"] = canonical
    for relation in assembled.get("relations") or []:
        if isinstance(relation, dict) and relation.get("claim_id") in renamed:
            relation["claim_id"] = renamed[relation["claim_id"]]


def _relation_from_claim(claim: Any) -> dict[str, Any] | None:
    """The relation a claim already states, or None when it states none."""
    if not isinstance(claim, dict):
        return None
    claim_id = claim.get("claim_id")
    predicate = claim.get("predicate")
    subject_id = claim.get("subject_id")
    obj = claim.get("object")
    if not isinstance(claim_id, str) or predicate not in RELATION_KINDS:
        return None
    if not isinstance(subject_id, str) or not isinstance(obj, dict):
        return None
    target = obj.get("node_id")
    if not isinstance(target, str):
        return None
    stem = claim_id[len("claim-"):] if claim_id.startswith("claim-") else claim_id
    return {
        "relation_id": f"rel-{stem}",
        "relation_kind": predicate,
        "from_node_id": subject_id,
        "to_node_id": target,
        "claim_id": claim_id,
        "properties": {},
    }


def validate_shard(
    shard: Any,
    *,
    evidence_catalog: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, str]]:
    """Return deterministic contract findings for one proposed GraphShard."""
    if not isinstance(shard, dict):
        return [_finding("invalid_shard", "/", "GraphShard must be an object")]

    findings: list[dict[str, str]] = []
    for key in sorted(set(shard) - SHARD_KEYS):
        findings.append(_finding("unknown_shard_key", f"/{key}", "not in contract"))
    if shard.get("contract_id") != SHARD_CONTRACT_ID:
        findings.append(_finding("contract_mismatch", "/contract_id", SHARD_CONTRACT_ID))
    if shard.get("schema_version") != SCHEMA_VERSION:
        findings.append(
            _finding("version_mismatch", "/schema_version", f"expected {SCHEMA_VERSION}")
        )
    for field in ("module_id", "section_id"):
        if not _valid_semantic_id(shard.get(field)):
            findings.append(_finding("invalid_semantic_id", f"/{field}", "must be semantic"))
    if not _valid_source_language(shard.get("source_language")):
        findings.append(
            _finding(
                "invalid_source_language",
                "/source_language",
                "must be a BCP 47 language tag such as en or zh-Hans",
            )
        )
    findings.extend(
        _validate_span_ids(
            shard.get("evidence_span_ids"), "/evidence_span_ids", evidence_catalog
        )
    )
    shard_span_ids = set(shard.get("evidence_span_ids") or [])

    coverage = shard.get("coverage")
    if not isinstance(coverage, dict) or set(coverage) != set(COVERAGE_DOMAINS):
        findings.append(
            _finding(
                "invalid_coverage_domains",
                "/coverage",
                "must account for every frozen graph domain exactly once",
            )
        )
    elif any(
        not isinstance(value, str) or value not in COVERAGE_STATUSES
        for value in coverage.values()
    ):
        findings.append(
            _finding("invalid_coverage_status", "/coverage", "contains an unknown status")
        )

    aspects = shard.get("aspects")
    declared_aspects: set[str] = set()
    if not isinstance(aspects, list) or not aspects:
        findings.append(_finding("aspects_required", "/aspects", "must be non-empty"))
    else:
        for index, aspect in enumerate(aspects):
            path = f"/aspects/{index}"
            if aspect not in COVERAGE_DOMAINS:
                findings.append(_finding("invalid_aspect", path, str(aspect)))
            elif aspect in declared_aspects:
                findings.append(_finding("duplicate_aspect", path, aspect))
            else:
                declared_aspects.add(aspect)
    if isinstance(coverage, dict) and set(coverage) == set(COVERAGE_DOMAINS):
        outside = sorted(
            domain
            for domain, status in coverage.items()
            if domain not in declared_aspects and status != "unresolved"
        )
        if outside:
            findings.append(
                _finding(
                    "coverage_outside_aspects",
                    "/coverage",
                    ",".join(outside),
                )
            )

    nodes = shard.get("nodes")
    node_ids: set[str] = set()
    if not isinstance(nodes, list):
        findings.append(_finding("invalid_nodes", "/nodes", "must be an array"))
        nodes = []
    for index, node in enumerate(nodes):
        path = f"/nodes/{index}"
        if not isinstance(node, dict):
            findings.append(_finding("invalid_node", path, "must be an object"))
            continue
        for key in sorted(set(node) - NODE_KEYS):
            findings.append(_finding("unknown_node_key", f"{path}/{key}", "not in contract"))
        node_id = node.get("node_id")
        if not _valid_semantic_id(node_id):
            findings.append(_finding("invalid_node_id", f"{path}/node_id", "must be semantic"))
        elif node_id in node_ids:
            findings.append(_finding("duplicate_node_id", f"{path}/node_id", node_id))
        else:
            node_ids.add(node_id)
        node_kind = node.get("node_kind")
        if node_kind not in NODE_KINDS:
            findings.append(_finding("invalid_node_kind", f"{path}/node_kind", "unknown kind"))
        elif _valid_semantic_id(node_id) and not node_id.startswith(f"{node_kind}-"):
            findings.append(
                _finding(
                    "node_id_kind_mismatch",
                    f"{path}/node_id",
                    f"must start with {node_kind}-",
                )
            )
        if node.get("visibility") not in VISIBILITIES:
            findings.append(_finding("invalid_visibility", f"{path}/visibility", "unknown visibility"))
        if not isinstance(node.get("name"), str) or not node["name"].strip():
            findings.append(_finding("node_name_required", f"{path}/name", "must be non-empty"))
        if not isinstance(node.get("aliases", []), list):
            findings.append(_finding("invalid_aliases", f"{path}/aliases", "must be an array"))
        if not isinstance(node.get("properties", {}), dict):
            findings.append(_finding("invalid_properties", f"{path}/properties", "must be an object"))
        findings.extend(
            _validate_span_ids(
                node.get("evidence_span_ids"),
                f"{path}/evidence_span_ids",
                evidence_catalog,
            )
        )
        if not set(node.get("evidence_span_ids") or []).issubset(shard_span_ids):
            findings.append(
                _finding(
                    "evidence_span_out_of_scope",
                    f"{path}/evidence_span_ids",
                    "node evidence must be declared by the shard",
                )
            )

    node_refs = shard.get("node_refs", [])
    external_node_ids: set[str] = set()
    if not isinstance(node_refs, list):
        findings.append(_finding("invalid_node_refs", "/node_refs", "must be an array"))
    else:
        for index, node_ref in enumerate(node_refs):
            path = f"/node_refs/{index}"
            if not _valid_semantic_id(node_ref):
                findings.append(_finding("invalid_node_ref", path, "must be semantic"))
            elif node_ref in external_node_ids:
                findings.append(_finding("duplicate_node_ref", path, node_ref))
            elif node_ref in node_ids:
                findings.append(_finding("redundant_node_ref", path, node_ref))
            else:
                external_node_ids.add(node_ref)
    available_node_ids = node_ids | external_node_ids

    claims = shard.get("claims")
    claim_ids: set[str] = set()
    claims_by_id: dict[str, dict[str, Any]] = {}
    if not isinstance(claims, list):
        findings.append(_finding("invalid_claims", "/claims", "must be an array"))
        claims = []
    for index, claim in enumerate(claims):
        path = f"/claims/{index}"
        if not isinstance(claim, dict):
            findings.append(_finding("invalid_claim", path, "must be an object"))
            continue
        for key in sorted(set(claim) - CLAIM_KEYS):
            findings.append(_finding("unknown_claim_key", f"{path}/{key}", "not in contract"))
        claim_id = claim.get("claim_id")
        if not _valid_semantic_id(claim_id):
            findings.append(_finding("invalid_claim_id", f"{path}/claim_id", "must be semantic"))
        elif not claim_id.startswith("claim-"):
            # "Semantic" was enforced in name only: the id pattern accepts `c1`,
            # so sections numbered their claims positionally and section A's
            # `c1` collided with section B's `c1` at merge -- 32 false conflicts
            # on record, which is what kept a book's sections from assembling
            # into one graph. Node ids never had this problem because they must
            # carry their kind; claim ids now carry theirs the same way.
            findings.append(
                _finding("claim_id_prefix_missing", f"{path}/claim_id", "must start with claim-")
            )
        elif claim_id in claim_ids:
            findings.append(_finding("duplicate_claim_id", f"{path}/claim_id", claim_id))
        else:
            claim_ids.add(claim_id)
            claims_by_id[claim_id] = claim
        if claim.get("subject_id") not in available_node_ids:
            findings.append(_finding("unknown_claim_subject", f"{path}/subject_id", "not declared"))
        predicate = claim.get("predicate")
        if predicate not in RELATION_KINDS:
            findings.append(_finding("invalid_predicate", f"{path}/predicate", "unknown predicate"))
        obj = claim.get("object")
        if not isinstance(obj, dict) or set(obj) != {"node_id"}:
            findings.append(
                _finding(
                    "claim_object_node_required",
                    f"{path}/object",
                    "graph claims target one semantic node; scalar facts stay in node properties",
                )
            )
        elif "node_id" in obj and obj["node_id"] not in available_node_ids:
            findings.append(_finding("unknown_claim_object", f"{path}/object/node_id", "not declared"))
        if claim.get("truth_status") not in TRUTH_STATUSES:
            findings.append(_finding("invalid_truth_status", f"{path}/truth_status", "unknown status"))
        if claim.get("visibility") not in VISIBILITIES:
            findings.append(_finding("invalid_visibility", f"{path}/visibility", "unknown visibility"))
        for field in ("asserted_by_ids", "known_by_ids"):
            values = claim.get(field, [])
            if not isinstance(values, list) or any(value not in available_node_ids for value in values):
                findings.append(_finding("invalid_actor_refs", f"{path}/{field}", "must reference declared nodes"))
        confidence = claim.get("confidence")
        if confidence is not None and (
            isinstance(confidence, bool)
            or not isinstance(confidence, (int, float))
            or not 0 <= confidence <= 1
        ):
            findings.append(
                _finding("invalid_claim_confidence", f"{path}/confidence", "expected 0 through 1")
            )
        if claim.get("validity") is not None and not isinstance(claim.get("validity"), dict):
            findings.append(_finding("invalid_claim_validity", f"{path}/validity", "must be an object"))
        if claim.get("reason") is not None and (
            not isinstance(claim.get("reason"), str) or not claim["reason"].strip()
        ):
            findings.append(_finding("invalid_claim_reason", f"{path}/reason", "must be non-empty"))
        findings.extend(
            _validate_span_ids(
                claim.get("evidence_span_ids"),
                f"{path}/evidence_span_ids",
                evidence_catalog,
            )
        )
        if not set(claim.get("evidence_span_ids") or []).issubset(shard_span_ids):
            findings.append(
                _finding(
                    "evidence_span_out_of_scope",
                    f"{path}/evidence_span_ids",
                    "claim evidence must be declared by the shard",
                )
            )

    relations = shard.get("relations")
    relation_ids: set[str] = set()
    if not isinstance(relations, list):
        findings.append(_finding("invalid_relations", "/relations", "must be an array"))
        relations = []
    for index, relation in enumerate(relations):
        path = f"/relations/{index}"
        if not isinstance(relation, dict):
            findings.append(_finding("invalid_relation", path, "must be an object"))
            continue
        for key in sorted(set(relation) - RELATION_KEYS):
            findings.append(
                _finding("unknown_relation_key", f"{path}/{key}", "not in contract")
            )
        relation_id = relation.get("relation_id")
        if not _valid_semantic_id(relation_id):
            findings.append(_finding("invalid_relation_id", f"{path}/relation_id", "must be semantic"))
        elif relation_id in relation_ids:
            findings.append(_finding("duplicate_relation_id", f"{path}/relation_id", relation_id))
        else:
            relation_ids.add(relation_id)
        if relation.get("relation_kind") not in RELATION_KINDS:
            findings.append(_finding("invalid_relation_kind", f"{path}/relation_kind", "unknown kind"))
        for field in ("from_node_id", "to_node_id"):
            if relation.get(field) not in available_node_ids:
                findings.append(_finding("unknown_relation_endpoint", f"{path}/{field}", "not declared"))
        relation_claim_id = relation.get("claim_id")
        if relation_claim_id not in claim_ids:
            findings.append(_finding("unknown_relation_claim", f"{path}/claim_id", "not in shard"))
        else:
            bound_claim = claims_by_id[relation_claim_id]
            bound_object = bound_claim.get("object")
            if (
                relation.get("relation_kind") != bound_claim.get("predicate")
                or relation.get("from_node_id") != bound_claim.get("subject_id")
                or not isinstance(bound_object, dict)
                or relation.get("to_node_id") != bound_object.get("node_id")
            ):
                findings.append(
                    _finding(
                        "relation_claim_mismatch",
                        path,
                        "relation kind and endpoints must exactly project the bound claim",
                    )
                )
        if relation.get("properties") is not None and not isinstance(
            relation.get("properties"), dict
        ):
            findings.append(
                _finding("invalid_relation_properties", f"{path}/properties", "must be an object")
            )

    used_node_ids: set[str] = set()
    for claim in claims:
        if not isinstance(claim, dict):
            continue
        claim_object = claim.get("object")
        object_node_id = (
            claim_object.get("node_id") if isinstance(claim_object, dict) else None
        )
        for value in (claim.get("subject_id"), object_node_id):
            if isinstance(value, str):
                used_node_ids.add(value)
        for field in ("asserted_by_ids", "known_by_ids"):
            for value in claim.get(field) or []:
                if isinstance(value, str):
                    used_node_ids.add(value)
    for relation in relations:
        if not isinstance(relation, dict):
            continue
        for field in ("from_node_id", "to_node_id"):
            value = relation.get(field)
            if isinstance(value, str):
                used_node_ids.add(value)
    for index, node_ref in enumerate(node_refs if isinstance(node_refs, list) else []):
        if isinstance(node_ref, str) and node_ref in external_node_ids and node_ref not in used_node_ids:
            findings.append(
                _finding(
                    "unused_node_ref",
                    f"/node_refs/{index}",
                    "external refs must participate in a claim or relation",
                )
            )

    return findings


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _json_digest(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()


def _validate_extraction_packet(
    packet: Any,
    evidence_packet: dict[str, Any],
) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    if not isinstance(packet, dict):
        return [_finding("invalid_extraction_packet", "/", "must be an object")]
    if set(packet) != EXTRACTION_PACKET_KEYS:
        findings.append(
            _finding(
                "invalid_extraction_packet_fields",
                "/",
                "must use the frozen field set",
            )
        )
    if packet.get("contract_id") != EXTRACTION_PACKET_CONTRACT_ID:
        findings.append(
            _finding(
                "contract_mismatch",
                "/contract_id",
                EXTRACTION_PACKET_CONTRACT_ID,
            )
        )
    if packet.get("schema_version") != 1:
        findings.append(_finding("version_mismatch", "/schema_version", "expected 1"))
    for field in ("module_id", "section_id", "section_role"):
        if not _valid_semantic_id(packet.get(field)):
            findings.append(_finding("invalid_semantic_id", f"/{field}", "must be semantic"))
    if not _valid_source_language(packet.get("source_language")):
        findings.append(
            _finding(
                "invalid_source_language",
                "/source_language",
                "must be a BCP 47 language tag such as en or zh-Hans",
            )
        )

    aspects = packet.get("aspects")
    if (
        not isinstance(aspects, list)
        or not aspects
        or any(aspect not in COVERAGE_DOMAINS for aspect in aspects)
        or len(set(aspects)) != len(aspects)
    ):
        findings.append(_finding("invalid_aspects", "/aspects", "must be unique frozen domains"))
    if packet.get("default_visibility") not in VISIBILITIES:
        findings.append(_finding("invalid_visibility", "/default_visibility", "unknown visibility"))

    known_nodes = packet.get("known_nodes")
    seen_known: set[str] = set()
    if not isinstance(known_nodes, list):
        findings.append(_finding("invalid_known_nodes", "/known_nodes", "must be an array"))
        known_nodes = []
    for index, node in enumerate(known_nodes):
        path = f"/known_nodes/{index}"
        if not isinstance(node, dict) or set(node) != KNOWN_NODE_KEYS:
            findings.append(_finding("invalid_known_node", path, "must use frozen fields"))
            continue
        node_id = node.get("node_id")
        node_kind = node.get("node_kind")
        if not _valid_semantic_id(node_id):
            findings.append(_finding("invalid_node_id", f"{path}/node_id", "must be semantic"))
        elif node_id in seen_known:
            findings.append(_finding("duplicate_node_id", f"{path}/node_id", node_id))
        else:
            seen_known.add(node_id)
        if node_kind not in NODE_KINDS:
            findings.append(_finding("invalid_node_kind", f"{path}/node_kind", "unknown kind"))
        elif _valid_semantic_id(node_id) and not node_id.startswith(f"{node_kind}-"):
            findings.append(_finding("node_id_kind_mismatch", f"{path}/node_id", str(node_kind)))
        if not isinstance(node.get("name"), str) or not node["name"].strip():
            findings.append(_finding("node_name_required", f"{path}/name", "must be non-empty"))
        if node.get("visibility") not in VISIBILITIES:
            findings.append(_finding("invalid_visibility", f"{path}/visibility", "unknown visibility"))

    budget = packet.get("output_budget")
    if not isinstance(budget, dict) or set(budget) != OUTPUT_BUDGET_KEYS:
        findings.append(_finding("invalid_output_budget", "/output_budget", "must use frozen fields"))
    else:
        for field, upper in (("max_nodes", 200), ("max_relations", 400)):
            value = budget.get(field)
            if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= upper:
                findings.append(_finding("invalid_output_budget", f"/output_budget/{field}", str(value)))

    try:
        expected_view = project_evidence_for_model(evidence_packet)
    except ModuleGraphError as exc:
        findings.extend(exc.findings)
        expected_view = None
    if packet.get("evidence_view") != expected_view:
        findings.append(
            _finding(
                "evidence_view_mismatch",
                "/evidence_view",
                "must exactly project the bound evidence packet",
            )
        )
    span_ids = {
        row.get("span_id")
        for row in (expected_view or {}).get("spans", [])
        if isinstance(row, dict)
    }
    approved = packet.get("approved_player_safe_span_ids")
    if (
        not isinstance(approved, list)
        or len(set(approved)) != len(approved)
        or any(span_id not in span_ids for span_id in approved)
    ):
        findings.append(
            _finding(
                "invalid_player_safe_spans",
                "/approved_player_safe_span_ids",
                "must be unique supplied span ids",
            )
        )
    return findings


def _validate_semantic_review(
    review: Any,
    *,
    extraction_packet: dict[str, Any],
    evidence_catalog: dict[str, dict[str, Any]],
) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    if not isinstance(review, dict):
        return [_finding("invalid_semantic_review", "/review", "must be an object")]
    if set(review) != SEMANTIC_REVIEW_KEYS:
        findings.append(
            _finding("invalid_semantic_review_fields", "/review", "must use frozen fields")
        )
    if review.get("contract_id") != SEMANTIC_REVIEW_CONTRACT_ID:
        findings.append(
            _finding("contract_mismatch", "/review/contract_id", SEMANTIC_REVIEW_CONTRACT_ID)
        )
    if review.get("schema_version") != 1:
        findings.append(_finding("version_mismatch", "/review/schema_version", "expected 1"))
    for field in ("module_id", "section_id", "aspects"):
        if review.get(field) != extraction_packet.get(field):
            findings.append(
                _finding("semantic_review_scope_mismatch", f"/review/{field}", "must match packet")
            )
    verdict = review.get("verdict")
    if verdict not in SEMANTIC_REVIEW_VERDICTS:
        findings.append(_finding("invalid_review_verdict", "/review/verdict", str(verdict)))
    checks = review.get("checks")
    if not isinstance(checks, dict) or set(checks) != set(SEMANTIC_REVIEW_CHECKS):
        findings.append(
            _finding("invalid_review_checks", "/review/checks", "must account for every check")
        )
        checks = {}
    elif any(value not in SEMANTIC_REVIEW_CHECK_STATUSES for value in checks.values()):
        findings.append(
            _finding("invalid_review_check_status", "/review/checks", "unknown status")
        )

    rows = review.get("findings")
    if not isinstance(rows, list):
        findings.append(_finding("invalid_review_findings", "/review/findings", "must be an array"))
        rows = []
    for index, row in enumerate(rows):
        path = f"/review/findings/{index}"
        if not isinstance(row, dict) or set(row) != SEMANTIC_FINDING_KEYS:
            findings.append(_finding("invalid_review_finding", path, "must use frozen fields"))
            continue
        if not _valid_semantic_id(row.get("code")):
            findings.append(_finding("invalid_finding_code", f"{path}/code", "must be semantic"))
        if not isinstance(row.get("path"), str) or not row["path"].startswith("/"):
            findings.append(_finding("invalid_finding_path", f"{path}/path", "must be a JSON path"))
        if not isinstance(row.get("message"), str) or not row["message"].strip():
            findings.append(_finding("invalid_finding_message", f"{path}/message", "must be non-empty"))
        findings.extend(
            _validate_span_ids(
                row.get("evidence_span_ids"),
                f"{path}/evidence_span_ids",
                evidence_catalog,
            )
        )

    has_check_finding = any(value == "finding" for value in checks.values())
    if verdict == "accepted" and (rows or has_check_finding):
        findings.append(
            _finding("invalid_review_acceptance", "/review", "accepted review must have no findings")
        )
    if verdict == "revision-required" and (not rows or not has_check_finding):
        findings.append(
            _finding(
                "invalid_review_revision",
                "/review",
                "revision-required needs findings and a finding check",
            )
        )
    return findings


def _check_graph_shard(
    extraction_packet: dict[str, Any],
    evidence_packet: dict[str, Any],
    candidate: Any,
    *,
    page_catalog: dict[tuple[str, int], dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    findings = _validate_extraction_packet(extraction_packet, evidence_packet)
    evidence_catalog: dict[str, dict[str, Any]] = {}
    try:
        evidence_catalog = load_evidence_catalog(
            [evidence_packet], page_catalog=page_catalog
        )
    except ModuleGraphError as exc:
        findings.extend(exc.findings)

    assembled = assemble_model_shard(candidate)
    findings.extend(validate_shard(assembled, evidence_catalog=evidence_catalog or None))
    if isinstance(assembled, dict):
        for field in ("module_id", "section_id", "source_language", "aspects"):
            if assembled.get(field) != extraction_packet.get(field):
                findings.append(
                    _finding("candidate_scope_mismatch", f"/{field}", "must match packet")
                )
        budget = extraction_packet.get("output_budget") or {}
        if isinstance(assembled.get("nodes"), list) and len(assembled["nodes"]) > budget.get("max_nodes", 0):
            findings.append(_finding("node_budget_exceeded", "/nodes", "split the packet"))
        if isinstance(assembled.get("relations"), list) and len(assembled["relations"]) > budget.get("max_relations", 0):
            findings.append(_finding("relation_budget_exceeded", "/relations", "split the packet"))
        known_ids = {
            row["node_id"]
            for row in extraction_packet.get("known_nodes") or []
            if isinstance(row, dict) and isinstance(row.get("node_id"), str)
        }
        undeclared_refs = sorted(set(assembled.get("node_refs") or []) - known_ids)
        if undeclared_refs:
            findings.append(
                _finding(
                    "node_ref_out_of_scope",
                    "/node_refs",
                    ",".join(undeclared_refs),
                )
            )
        if extraction_packet.get("default_visibility") != "player-safe":
            approved = set(
                extraction_packet.get("approved_player_safe_span_ids") or []
            )
            for collection_name in ("nodes", "claims"):
                for index, row in enumerate(assembled.get(collection_name) or []):
                    if (
                        isinstance(row, dict)
                        and row.get("visibility") == "player-safe"
                        and not set(row.get("evidence_span_ids") or []).issubset(approved)
                    ):
                        findings.append(
                            _finding(
                                "player_safe_evidence_not_approved",
                                f"/{collection_name}/{index}/visibility",
                                "player-safe evidence must be explicitly approved",
                            )
                        )
    if findings:
        raise ModuleGraphError(findings)
    return assembled, evidence_catalog


def check_graph_shard(
    extraction_packet: dict[str, Any],
    evidence_packet: dict[str, Any],
    candidate: Any,
    *,
    page_catalog: dict[tuple[str, int], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Return one assembled candidate after deterministic source-bound checks."""
    assembled, _evidence_catalog = _check_graph_shard(
        extraction_packet,
        evidence_packet,
        candidate,
        page_catalog=page_catalog,
    )
    return assembled


def accept_graph_shard(
    extraction_packet: dict[str, Any],
    evidence_packet: dict[str, Any],
    candidate: Any,
    semantic_review: dict[str, Any],
    *,
    page_catalog: dict[tuple[str, int], dict[str, Any]] | None = None,
) -> dict[str, dict[str, Any]]:
    """Accept one reviewed candidate without mutating any semantic payload."""
    assembled, evidence_catalog = _check_graph_shard(
        extraction_packet,
        evidence_packet,
        candidate,
        page_catalog=page_catalog,
    )
    review_findings = _validate_semantic_review(
        semantic_review,
        extraction_packet=extraction_packet,
        evidence_catalog=evidence_catalog,
    )
    if review_findings:
        raise ModuleGraphError(review_findings)
    if semantic_review["verdict"] != "accepted":
        raise ModuleGraphError(
            [
                _finding(
                    "semantic_review_rejected",
                    "/review/verdict",
                    "candidate requires a new bounded extraction",
                )
            ]
        )

    review_receipt = {
        "contract_id": REVIEW_RECEIPT_CONTRACT_ID,
        "schema_version": 1,
        "module_id": extraction_packet["module_id"],
        "section_id": extraction_packet["section_id"],
        "aspects": list(extraction_packet["aspects"]),
        "verdict": "accepted",
        "checks": copy.deepcopy(semantic_review["checks"]),
        "candidate_sha256": _json_digest(assembled),
        "evidence_packet_sha256": _json_digest(evidence_packet),
        "review_payload_sha256": _json_digest(semantic_review),
    }
    return {
        "accepted_shard": assembled,
        "review_receipt": review_receipt,
    }


def _merge_source_refs(left: list[dict[str, Any]], right: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = {_canonical(ref): copy.deepcopy(ref) for ref in [*left, *right]}
    return [rows[key] for key in sorted(rows)]


def _merge_node(
    existing: dict[str, Any], proposed: dict[str, Any], *, prefer: str | None = None
) -> dict[str, Any]:
    preferred = {"existing": existing, "proposed": proposed}.get(prefer or "")
    for field in ("node_kind", "name", "summary", "properties"):
        left = existing.get(field, "" if field == "summary" else {})
        right = proposed.get(field, "" if field == "summary" else {})
        if left != right and preferred is None:
            raise ModuleGraphError(
                [_finding("node_conflict", f"/nodes/{existing['node_id']}/{field}", "requires semantic reconciliation")]
            )
    merged = copy.deepcopy(preferred if preferred is not None else existing)
    losing = proposed if prefer == "existing" else existing
    aliases = {
        alias
        for alias in [*(existing.get("aliases") or []), *(proposed.get("aliases") or [])]
        if isinstance(alias, str) and alias.strip() and alias != merged["name"]
    }
    losing_name = losing.get("name")
    if (
        preferred is not None
        and isinstance(losing_name, str)
        and losing_name.strip()
        and losing_name != merged["name"]
    ):
        aliases.add(losing_name)
    merged["aliases"] = sorted(aliases)
    merged["source_refs"] = _merge_source_refs(
        existing.get("source_refs") or [], proposed.get("source_refs") or []
    )
    merged["evidence_span_ids"] = sorted(
        set(existing.get("evidence_span_ids") or [])
        | set(proposed.get("evidence_span_ids") or [])
    )
    visibility_rank = {"keeper-only": 0, "revealable": 1, "player-safe": 2}
    merged["visibility"] = min(
        (existing["visibility"], proposed["visibility"]),
        key=visibility_rank.__getitem__,
    )
    return merged


# What a claim's `truth_status` says about where it came from. `inferred-candidate`
# is a reader saying "the book does not state this, I worked it out"; every
# `authored-*` value is a reader saying "the book states this, here is the page".
# The others are not stronger or weaker versions of each other -- a fact, a
# belief, a rumour and a lie are different assertions about the fiction, and two
# readers disagreeing there disagree about the book.
INFERRED_TRUTH_STATUS = "inferred-candidate"


def _merge_evidenced_record(
    existing: dict[str, Any],
    proposed: dict[str, Any],
    *,
    record_kind: str,
    record_id: str,
    notes: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    # Compared on meaning, not on wording. Two sections stating the same fact
    # will annotate it differently -- `reason` is the reader's own prose, and
    # `summary` and `aliases` are description rather than assertion -- and
    # refusing on that reads "same id has different meaning" when nothing about
    # the meaning differs. One such pair (a module containing a section, with
    # identical subject, predicate, object, truth status and evidence spans,
    # annotated once as "书结构列出该核心/附属分节。" and once as "书结构列出
    # Introduction 章。") refused a whole book.
    annotation_keys = {"reason", "summary", "aliases", "confidence", "properties"}
    ignored = {"source_refs", "evidence_span_ids"} | annotation_keys
    # Evidence beats inference. One reader found the page that says Sing Sing is
    # in New York and wrote `authored-fact`; another, on the next page, saw only
    # a mention of a visit and honestly wrote `inferred-candidate`. Neither is
    # wrong, and refusing the book over it would be. The reading that found the
    # page stands, the hedge yields, and the resolution is recorded rather than
    # quietly applied.
    left_status = existing.get("truth_status")
    right_status = proposed.get("truth_status")
    if left_status != right_status and INFERRED_TRUTH_STATUS in (left_status, right_status):
        grounded = right_status if left_status == INFERRED_TRUTH_STATUS else left_status
        existing = {**existing, "truth_status": grounded}
        proposed = {**proposed, "truth_status": grounded}
        if notes is not None:
            notes.append({
                "kind": f"{record_kind}_truth_status_resolved",
                "record_id": record_id,
                "kept": grounded,
                "yielded": INFERRED_TRUTH_STATUS,
                "why": "a reading that cites the page outranks one that infers",
            })
    left = {key: value for key, value in existing.items() if key not in ignored}
    right = {key: value for key, value in proposed.items() if key not in ignored}
    if left != right:
        differing = sorted(
            key for key in set(left) | set(right)
            if left.get(key) != right.get(key)
        )
        raise ModuleGraphError([_finding(
            f"{record_kind}_conflict", f"/{record_kind}s/{record_id}",
            "same id, different meaning: " + ", ".join(differing),
        )])
    merged = copy.deepcopy(existing)
    # Annotations are kept, not merged: the first reading's wording stands, and
    # anything the second saw that the first did not is picked up below through
    # evidence. A confidence actually stated beats one left out.
    for key in annotation_keys:
        if merged.get(key) in (None, "", [], {}) and proposed.get(key) not in (None, "", [], {}):
            merged[key] = copy.deepcopy(proposed[key])
    if "source_refs" in existing or "source_refs" in proposed:
        merged["source_refs"] = _merge_source_refs(
            existing.get("source_refs") or [], proposed.get("source_refs") or []
        )
    if "evidence_span_ids" in existing or "evidence_span_ids" in proposed:
        merged["evidence_span_ids"] = sorted(
            set(existing.get("evidence_span_ids") or [])
            | set(proposed.get("evidence_span_ids") or [])
        )
    return merged


def _aggregate_coverage(shards: list[dict[str, Any]]) -> dict[str, str]:
    result: dict[str, str] = {}
    for domain in COVERAGE_DOMAINS:
        statuses = {shard["coverage"][domain] for shard in shards}
        result[domain] = next(iter(statuses)) if len(statuses) == 1 else "partial"
    return result


def _source_refs_for_span_ids(
    span_ids: list[str], evidence_catalog: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    for span_id in span_ids:
        refs = _merge_source_refs(
            refs, [evidence_catalog[span_id]["source_ref"]]
        )
    return refs


def _promote_shard(
    shard: dict[str, Any], evidence_catalog: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    promoted = copy.deepcopy(shard)
    promoted["source_refs"] = _source_refs_for_span_ids(
        promoted["evidence_span_ids"], evidence_catalog
    )
    for node in promoted["nodes"]:
        node["source_refs"] = _source_refs_for_span_ids(
            node["evidence_span_ids"], evidence_catalog
        )
    for claim in promoted["claims"]:
        claim["source_refs"] = _source_refs_for_span_ids(
            claim["evidence_span_ids"], evidence_catalog
        )
    return promoted


def merge_shards(
    shards: list[dict[str, Any]],
    *,
    evidence_catalog: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    """Validate and promote section shards into one deterministic ModuleGraph."""
    if not isinstance(shards, list) or not shards:
        raise ModuleGraphError([_finding("shards_required", "/", "at least one shard is required")])
    if not isinstance(evidence_catalog, dict) or not evidence_catalog:
        raise ModuleGraphError(
            [_finding("evidence_catalog_required", "/", "promotion requires machine-bound spans")]
        )

    findings: list[dict[str, str]] = []
    global_node_ids = {
        node.get("node_id")
        for shard in shards
        if isinstance(shard, dict)
        for node in (shard.get("nodes") or [])
        if isinstance(node, dict) and isinstance(node.get("node_id"), str)
    }
    for index, shard in enumerate(shards):
        for finding in validate_shard(shard, evidence_catalog=evidence_catalog):
            findings.append({**finding, "path": f"/shards/{index}{finding['path']}"})
        if isinstance(shard, dict):
            for ref_index, node_ref in enumerate(shard.get("node_refs") or []):
                if node_ref not in global_node_ids:
                    findings.append(
                        _finding(
                            "unresolved_node_ref",
                            f"/shards/{index}/node_refs/{ref_index}",
                            "no shard defines this semantic node",
                        )
                    )
    if findings:
        raise ModuleGraphError(findings)

    module_ids = {shard["module_id"] for shard in shards}
    if len(module_ids) != 1:
        raise ModuleGraphError(
            [_finding("module_mismatch", "/shards", "one graph may contain only one module id")]
        )

    promoted_shards = [
        _promote_shard(shard, evidence_catalog)
        for shard in shards
    ]

    nodes: dict[str, dict[str, Any]] = {}
    skeleton_node_ids: set[str] = set()
    # Per-node winning shard and its evidence count on that node, so a field
    # conflict between two deep reads is settled by evidence density rather
    # than by arrival order.
    node_field_origin: dict[str, tuple[str, int]] = {}
    merge_notes: list[dict[str, Any]] = []
    claims: dict[str, dict[str, Any]] = {}
    relations: dict[str, dict[str, Any]] = {}
    source_refs: list[dict[str, Any]] = []
    for shard in sorted(promoted_shards, key=lambda row: row["section_id"]):
        source_refs = _merge_source_refs(source_refs, shard["source_refs"])
        shard_is_skeleton = shard["section_id"] == "skeleton"
        for node in shard["nodes"]:
            node_id = node["node_id"]
            node_spans = len(node.get("evidence_span_ids") or [])
            if node_id not in nodes:
                nodes[node_id] = copy.deepcopy(node)
                node_field_origin[node_id] = (shard["section_id"], node_spans)
                if shard_is_skeleton:
                    skeleton_node_ids.add(node_id)
                continue
            existing_is_skeleton = node_id in skeleton_node_ids
            if existing_is_skeleton is not shard_is_skeleton:
                # Skeleton-first builds read a node twice: once coarsely from
                # structure pages, once fully in its section. The deep read
                # wins field conflicts -- it carries the denser evidence --
                # and the skeleton's spans stay on the merged node, so nothing
                # is hidden and nothing is lost.
                prefer = "proposed" if existing_is_skeleton else "existing"
                nodes[node_id] = _merge_node(nodes[node_id], node, prefer=prefer)
                skeleton_node_ids.discard(node_id)
                if prefer == "proposed":
                    node_field_origin[node_id] = (shard["section_id"], node_spans)
                continue
            if existing_is_skeleton and shard_is_skeleton:
                nodes[node_id] = _merge_node(nodes[node_id], node)
                continue
            # Two deep reads of one node (a narrowing split, or a recurring
            # character). Descriptive fields are facets: the denser evidence
            # wins them, a tie keeps the first by section order, and either
            # way the decision lands in merge_notes with both sections named.
            # Kind flips never reach here -- the shard validator enforces
            # node_id-kind consistency before the merge.
            origin_section, origin_spans = node_field_origin[node_id]
            prefer = "proposed" if node_spans > origin_spans else "existing"
            winner_section = (
                shard["section_id"] if prefer == "proposed" else origin_section
            )
            loser_section = (
                origin_section if prefer == "proposed" else shard["section_id"]
            )
            conflicting = [
                field
                for field in ("name", "summary", "properties")
                if nodes[node_id].get(field) != node.get(field)
            ]
            if conflicting:
                tied = node_spans == origin_spans
                merge_notes.append({
                    "node_id": node_id,
                    "fields": conflicting,
                    "kept": winner_section,
                    "dropped": loser_section,
                    "basis": (
                        "section_order" if tied else "evidence_span_count"
                    ),
                    "kept_spans": max(node_spans, origin_spans),
                    "dropped_spans": min(node_spans, origin_spans),
                })
            nodes[node_id] = _merge_node(nodes[node_id], node, prefer=prefer)
            if prefer == "proposed":
                node_field_origin[node_id] = (shard["section_id"], node_spans)
        for claim in shard["claims"]:
            claim_id = claim["claim_id"]
            claims[claim_id] = (
                _merge_evidenced_record(
                    claims[claim_id], claim, record_kind="claim",
                    record_id=claim_id, notes=merge_notes,
                )
                if claim_id in claims
                else copy.deepcopy(claim)
            )
        for relation in shard["relations"]:
            relation_id = relation["relation_id"]
            relations[relation_id] = (
                _merge_evidenced_record(
                    relations[relation_id], relation, record_kind="relation",
                    record_id=relation_id, notes=merge_notes,
                )
                if relation_id in relations
                else copy.deepcopy(relation)
            )

    return {
        "contract_id": GRAPH_CONTRACT_ID,
        "schema_version": SCHEMA_VERSION,
        "module_id": next(iter(module_ids)),
        "source_languages": sorted({shard["source_language"] for shard in shards}),
        "section_ids": sorted(shard["section_id"] for shard in shards),
        "source_refs": source_refs,
        "coverage": _aggregate_coverage(promoted_shards),
        "coverage_by_section": {
            shard["section_id"]: copy.deepcopy(shard["coverage"])
            for shard in sorted(promoted_shards, key=lambda row: row["section_id"])
        },
        "node_refs_by_section": {
            shard["section_id"]: sorted(shard.get("node_refs") or [])
            for shard in sorted(promoted_shards, key=lambda row: row["section_id"])
        },
        "nodes": [nodes[key] for key in sorted(nodes)],
        "claims": [claims[key] for key in sorted(claims)],
        "relations": [relations[key] for key in sorted(relations)],
        # Every evidence-density decision the merge made, so a field silently
        # changing hands is impossible: who kept it, who lost it, on what
        # basis. Empty when no conflicts occurred.
        "merge_notes": merge_notes,
    }


def _validate_sha256(value: Any, path: str) -> list[dict[str, str]]:
    if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
        return [_finding("invalid_sha256", path, "must be lowercase SHA-256")]
    return []


def _planned_shard_identity(row: dict[str, Any]) -> tuple[str, tuple[str, ...]]:
    return row["section_id"], tuple(row["aspects"])


def _shard_stem(section_id: str, aspects: list[str]) -> str:
    return f"{section_id}--{'-'.join(aspects)}"


def _validate_build_plan(plan: Any) -> tuple[list[dict[str, str]], list[dict[str, Any]]]:
    findings: list[dict[str, str]] = []
    rows: list[dict[str, Any]] = []
    if not isinstance(plan, dict):
        return [_finding("invalid_build_plan", "/build_plan", "must be an object")], rows
    if set(plan) != BUILD_PLAN_KEYS:
        findings.append(
            _finding("invalid_build_plan_fields", "/build_plan", "must use frozen fields")
        )
    if plan.get("contract_id") != BUILD_PLAN_CONTRACT_ID:
        findings.append(
            _finding("contract_mismatch", "/build_plan/contract_id", BUILD_PLAN_CONTRACT_ID)
        )
    if plan.get("schema_version") != 1:
        findings.append(_finding("version_mismatch", "/build_plan/schema_version", "expected 1"))
    if not _valid_semantic_id(plan.get("module_id")):
        findings.append(
            _finding("invalid_semantic_id", "/build_plan/module_id", "must be semantic")
        )
    planned = plan.get("planned_shards")
    if not isinstance(planned, list) or not planned:
        findings.append(
            _finding("planned_shards_required", "/build_plan/planned_shards", "must be non-empty")
        )
        return findings, rows
    seen: set[tuple[str, tuple[str, ...]]] = set()
    for index, raw in enumerate(planned):
        path = f"/build_plan/planned_shards/{index}"
        if not isinstance(raw, dict) or set(raw) != PLANNED_SHARD_KEYS:
            findings.append(_finding("invalid_planned_shard", path, "must use frozen fields"))
            continue
        section_id = raw.get("section_id")
        aspects = raw.get("aspects")
        if not _valid_semantic_id(section_id):
            findings.append(_finding("invalid_semantic_id", f"{path}/section_id", "must be semantic"))
        if (
            not isinstance(aspects, list)
            or not aspects
            or any(aspect not in COVERAGE_DOMAINS for aspect in aspects)
            or len(set(aspects)) != len(aspects)
        ):
            findings.append(_finding("invalid_aspects", f"{path}/aspects", "must be unique domains"))
            continue
        row = {"section_id": section_id, "aspects": list(aspects)}
        if _valid_semantic_id(section_id):
            identity = _planned_shard_identity(row)
            if identity in seen:
                findings.append(_finding("duplicate_planned_shard", path, section_id))
            else:
                seen.add(identity)
                rows.append(row)
    rows.sort(key=lambda row: (row["section_id"], tuple(row["aspects"])))
    return findings, rows


def _validate_source_bundle_bindings(
    source_bundles: Any,
) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    findings: list[dict[str, str]] = []
    rows: list[dict[str, str]] = []
    if not isinstance(source_bundles, list) or not source_bundles:
        return (
            [_finding("source_bundles_required", "/source_bundles", "must be non-empty")],
            rows,
        )
    seen: set[tuple[str, str]] = set()
    file_sha_by_source: dict[str, str] = {}
    for index, raw in enumerate(source_bundles):
        path = f"/source_bundles/{index}"
        if not isinstance(raw, dict) or set(raw) != SOURCE_BUNDLE_BINDING_KEYS:
            findings.append(_finding("invalid_source_bundle", path, "must use frozen fields"))
            continue
        source_id = raw.get("source_id")
        bundle_sha256 = raw.get("bundle_sha256")
        file_sha256 = raw.get("file_sha256")
        if not _valid_source_id(source_id):
            findings.append(_finding("invalid_source_id", f"{path}/source_id", "invalid source"))
        else:
            identity = (source_id, str(bundle_sha256))
            if identity in seen:
                findings.append(_finding("duplicate_source_bundle", path, source_id))
            else:
                seen.add(identity)
            prior_file_sha = file_sha_by_source.get(source_id)
            if prior_file_sha is not None and prior_file_sha != file_sha256:
                findings.append(
                    _finding(
                        "source_file_conflict",
                        f"{path}/file_sha256",
                        source_id,
                    )
                )
            elif isinstance(file_sha256, str):
                file_sha_by_source[source_id] = file_sha256
        findings.extend(_validate_sha256(bundle_sha256, f"{path}/bundle_sha256"))
        findings.extend(_validate_sha256(file_sha256, f"{path}/file_sha256"))
        if _valid_source_id(source_id):
            rows.append({
                "source_id": source_id,
                "bundle_sha256": bundle_sha256,
                "file_sha256": file_sha256,
            })
    rows.sort(key=lambda row: (row["source_id"], row["bundle_sha256"]))
    return findings, rows


def _validate_review_receipt(
    receipt: Any,
    *,
    shard: dict[str, Any],
    evidence_packet: dict[str, Any],
    path: str,
) -> list[dict[str, str]]:
    findings: list[dict[str, str]] = []
    if not isinstance(receipt, dict):
        return [_finding("invalid_review_receipt", path, "must be an object")]
    if set(receipt) != REVIEW_RECEIPT_KEYS:
        findings.append(_finding("invalid_review_receipt_fields", path, "must use frozen fields"))
    if receipt.get("contract_id") != REVIEW_RECEIPT_CONTRACT_ID:
        findings.append(
            _finding("contract_mismatch", f"{path}/contract_id", REVIEW_RECEIPT_CONTRACT_ID)
        )
    if receipt.get("schema_version") != 1:
        findings.append(_finding("version_mismatch", f"{path}/schema_version", "expected 1"))
    for field in ("module_id", "section_id", "aspects"):
        if receipt.get(field) != shard.get(field):
            findings.append(_finding("review_receipt_scope_mismatch", f"{path}/{field}", "must match shard"))
    if receipt.get("verdict") != "accepted":
        findings.append(_finding("review_receipt_not_accepted", f"{path}/verdict", "expected accepted"))
    checks = receipt.get("checks")
    if (
        not isinstance(checks, dict)
        or set(checks) != set(SEMANTIC_REVIEW_CHECKS)
        or any(value not in {"pass", "not-applicable"} for value in checks.values())
    ):
        findings.append(_finding("invalid_review_checks", f"{path}/checks", "accepted checks only"))
    expected_digests = {
        "candidate_sha256": _json_digest(shard),
        "evidence_packet_sha256": _json_digest(evidence_packet),
    }
    for field, expected in expected_digests.items():
        findings.extend(_validate_sha256(receipt.get(field), f"{path}/{field}"))
        if receipt.get(field) != expected:
            findings.append(_finding("review_receipt_digest_mismatch", f"{path}/{field}", "binding drifted"))
    findings.extend(
        _validate_sha256(receipt.get("review_payload_sha256"), f"{path}/review_payload_sha256")
    )
    return findings


def _aggregate_build_coverage(
    planned_rows: list[dict[str, Any]],
    shards_by_identity: dict[tuple[str, tuple[str, ...]], dict[str, Any]],
) -> dict[str, str]:
    result: dict[str, str] = {}
    for domain in COVERAGE_DOMAINS:
        statuses = [
            shards_by_identity[_planned_shard_identity(row)]["coverage"][domain]
            for row in planned_rows
            if domain in row["aspects"]
            and _planned_shard_identity(row) in shards_by_identity
        ]
        planned_count = sum(domain in row["aspects"] for row in planned_rows)
        if not statuses or len(statuses) < planned_count or "unresolved" in statuses:
            result[domain] = "unresolved"
        elif "partial" in statuses:
            result[domain] = "partial"
        elif "accepted" in statuses:
            result[domain] = "accepted"
        else:
            result[domain] = "absent"
    return result


def _asset_graph_root(workspace: Path | str, asset_root_id: str) -> Path:
    if (
        not isinstance(asset_root_id, str)
        or not _valid_source_id(asset_root_id)
        or asset_root_id in {".", ".."}
        or "/" in asset_root_id
    ):
        raise ModuleGraphError(
            [_finding("invalid_asset_root_id", "/asset_root_id", "must be a safe id")]
        )
    assets_root = (Path(workspace).expanduser().resolve() / ".coc" / "module-assets").resolve()
    module_root = (assets_root / asset_root_id).resolve()
    try:
        module_root.relative_to(assets_root)
    except ValueError as exc:
        raise ModuleGraphError(
            [_finding("asset_root_escape", "/asset_root_id", asset_root_id)]
        ) from exc
    return module_root / "graph"


def _read_json_exact(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_generation_payloads(
    generation_dir: Path,
    payloads: dict[str, Any],
) -> None:
    for relative, payload in sorted(payloads.items()):
        coc_fileio.write_json_atomic(
            generation_dir / relative,
            payload,
            indent=2,
            ensure_ascii=False,
            trailing_newline=True,
        )


def _verify_generation_payloads(
    generation_dir: Path,
    payloads: dict[str, Any],
) -> None:
    findings: list[dict[str, str]] = []
    for relative, expected in sorted(payloads.items()):
        path = generation_dir / relative
        try:
            actual = _read_json_exact(path)
        except (OSError, json.JSONDecodeError) as exc:
            findings.append(_finding("installed_generation_unreadable", relative, str(exc)))
            continue
        if actual != expected:
            findings.append(_finding("installed_generation_drift", relative, "content mismatch"))
    if findings:
        raise ModuleGraphError(findings)


def build_module_graph_asset(
    workspace: Path | str,
    *,
    asset_root_id: str,
    build_plan: dict[str, Any],
    accepted_records: list[dict[str, Any]],
    source_bundles: list[dict[str, str]],
    page_catalog: dict[tuple[str, int], dict[str, Any]],
) -> dict[str, Any]:
    """Build and atomically install one reviewed module graph generation."""
    findings, planned_rows = _validate_build_plan(build_plan)
    source_findings, source_rows = _validate_source_bundle_bindings(source_bundles)
    findings.extend(source_findings)
    if not isinstance(page_catalog, dict) or not page_catalog:
        findings.append(_finding("page_catalog_required", "/page_catalog", "source bytes required"))
    if not isinstance(accepted_records, list) or not accepted_records:
        findings.append(
            _finding("accepted_shards_required", "/accepted_records", "must be non-empty")
        )
        accepted_records = []
    if findings:
        raise ModuleGraphError(findings)

    planned_identities = {_planned_shard_identity(row) for row in planned_rows}
    shards_by_identity: dict[tuple[str, tuple[str, ...]], dict[str, Any]] = {}
    record_by_identity: dict[tuple[str, tuple[str, ...]], dict[str, Any]] = {}
    evidence_packets: list[dict[str, Any]] = []
    for index, record in enumerate(accepted_records):
        path = f"/accepted_records/{index}"
        if not isinstance(record, dict) or set(record) != {
            "accepted_shard", "evidence_packet", "review_receipt"
        }:
            findings.append(_finding("invalid_accepted_record", path, "must use frozen fields"))
            continue
        shard = record.get("accepted_shard")
        evidence_packet = record.get("evidence_packet")
        receipt = record.get("review_receipt")
        if not isinstance(shard, dict) or not isinstance(evidence_packet, dict):
            findings.append(_finding("invalid_accepted_record", path, "shard and evidence required"))
            continue
        identity = (shard.get("section_id"), tuple(shard.get("aspects") or []))
        if identity not in planned_identities:
            findings.append(_finding("unplanned_accepted_shard", path, str(identity)))
        elif identity in shards_by_identity:
            findings.append(_finding("duplicate_accepted_shard", path, str(identity)))
        else:
            shards_by_identity[identity] = shard
            record_by_identity[identity] = record
        if shard.get("module_id") != build_plan.get("module_id"):
            findings.append(_finding("module_mismatch", f"{path}/accepted_shard/module_id", "build plan"))
        try:
            load_evidence_catalog([evidence_packet], page_catalog=page_catalog)
        except ModuleGraphError as exc:
            findings.extend(
                {**finding, "path": f"{path}{finding['path']}"}
                for finding in exc.findings
            )
        findings.extend(
            _validate_review_receipt(
                receipt,
                shard=shard,
                evidence_packet=evidence_packet,
                path=f"{path}/review_receipt",
            )
        )
        evidence_packets.append(evidence_packet)
    if findings:
        raise ModuleGraphError(findings)

    evidence_catalog = load_evidence_catalog(
        evidence_packets,
        page_catalog=page_catalog,
    )
    module_graph = merge_shards(
        list(shards_by_identity.values()),
        evidence_catalog=evidence_catalog,
    )
    source_ids = {row["source_id"] for row in source_rows}
    graph_source_ids = {row["source_id"] for row in module_graph["source_refs"]}
    if not graph_source_ids.issubset(source_ids):
        raise ModuleGraphError(
            [
                _finding(
                    "source_binding_missing",
                    "/source_bundles",
                    ",".join(sorted(graph_source_ids - source_ids)),
                )
            ]
        )

    missing_rows = [
        row for row in planned_rows
        if _planned_shard_identity(row) not in shards_by_identity
    ]
    coverage = _aggregate_build_coverage(planned_rows, shards_by_identity)
    build_status = (
        "complete"
        if not missing_rows
        and all(value in {"accepted", "absent"} for value in coverage.values())
        else "partial"
    )
    if build_status not in BUILD_STATUSES:
        raise AssertionError("build status drifted from contract")

    accepted_manifest_rows: list[dict[str, Any]] = []
    generation_payloads: dict[str, Any] = {"module-graph.json": module_graph}
    evidence_by_section: dict[str, dict[str, Any]] = {}
    for identity in sorted(shards_by_identity):
        shard = shards_by_identity[identity]
        record = record_by_identity[identity]
        section_id = shard["section_id"]
        aspects = list(shard["aspects"])
        stem = _shard_stem(section_id, aspects)
        evidence_packet = record["evidence_packet"]
        prior_evidence = evidence_by_section.get(section_id)
        if prior_evidence is not None and prior_evidence != evidence_packet:
            raise ModuleGraphError(
                [_finding("section_evidence_conflict", f"/evidence/{section_id}", "packets differ")]
            )
        evidence_by_section[section_id] = evidence_packet
        evidence_path = f"evidence/{section_id}.json"
        shard_path = f"shards/{stem}.json"
        review_path = f"reviews/{stem}.json"
        generation_payloads[evidence_path] = evidence_packet
        generation_payloads[shard_path] = shard
        generation_payloads[review_path] = record["review_receipt"]
        row = {
            "section_id": section_id,
            "aspects": aspects,
            "shard_path": shard_path,
            "shard_sha256": _json_digest(shard),
            "evidence_path": evidence_path,
            "evidence_packet_sha256": _json_digest(evidence_packet),
            "review_path": review_path,
            "review_receipt_sha256": _json_digest(record["review_receipt"]),
        }
        if set(row) != ACCEPTED_SHARD_MANIFEST_KEYS:
            raise AssertionError("accepted shard manifest field set drifted")
        accepted_manifest_rows.append(row)

    generation_digest = _json_digest({
        "module_graph": module_graph,
        "source_languages": module_graph["source_languages"],
        "source_bundles": source_rows,
        "planned_shards": planned_rows,
        "accepted_shards": accepted_manifest_rows,
        "missing_shards": missing_rows,
        "coverage": coverage,
    })
    generation_name = f"generation-{generation_digest}"
    graph_root = _asset_graph_root(workspace, asset_root_id)
    generations_root = graph_root / "generations"
    graph_root.mkdir(parents=True, exist_ok=True)
    generations_root.mkdir(parents=True, exist_ok=True)
    lock_path = graph_root / "graph-build.lock"
    module_graph_path = f"generations/{generation_name}/module-graph.json"
    manifest = {
        "contract_id": BUILD_MANIFEST_CONTRACT_ID,
        "schema_version": 1,
        "asset_root_id": asset_root_id,
        "module_id": build_plan["module_id"],
        "graph_contract_id": GRAPH_CONTRACT_ID,
        "graph_schema_version": SCHEMA_VERSION,
        "build_status": build_status,
        "current_generation": generation_name,
        "module_graph_path": module_graph_path,
        "module_graph_sha256": _json_digest(module_graph),
        "source_languages": list(module_graph["source_languages"]),
        "source_bundles": source_rows,
        "planned_shards": planned_rows,
        "accepted_shards": accepted_manifest_rows,
        "missing_shards": missing_rows,
        "coverage": coverage,
    }
    if set(manifest) != BUILD_MANIFEST_KEYS:
        raise AssertionError("build manifest field set drifted from contract")

    with coc_fileio.advisory_file_lock(lock_path):
        final_generation = generations_root / generation_name
        if final_generation.exists():
            _verify_generation_payloads(final_generation, generation_payloads)
        else:
            stage = Path(tempfile.mkdtemp(prefix=".stage-", dir=generations_root))
            try:
                _write_generation_payloads(stage, generation_payloads)
                os.replace(stage, final_generation)
            finally:
                if stage.exists():
                    shutil.rmtree(stage)
        coc_fileio.write_json_atomic(
            graph_root / "manifest.json",
            manifest,
            indent=2,
            ensure_ascii=False,
            trailing_newline=True,
        )
    return {
        "manifest": manifest,
        "graph_root": str(graph_root),
        "module_graph": module_graph,
    }


def load_installed_module_graph_installation(
    workspace: Path | str,
    *,
    asset_root_id: str,
) -> dict[str, Any]:
    """Read and verify one manifest-selected graph installation."""
    graph_root = _asset_graph_root(workspace, asset_root_id)
    manifest_path = graph_root / "manifest.json"
    if not manifest_path.is_file():
        raise ModuleGraphError(
            [
                _finding(
                    "module_graph_not_installed",
                    str(manifest_path),
                    "asset root has no installed ModuleGraph manifest",
                )
            ]
        )
    try:
        manifest = _read_json_exact(manifest_path)
    except (OSError, json.JSONDecodeError) as exc:
        raise ModuleGraphError(
            [_finding("invalid_build_manifest", str(manifest_path), str(exc))]
        ) from exc
    findings: list[dict[str, str]] = []
    if not isinstance(manifest, dict) or set(manifest) != BUILD_MANIFEST_KEYS:
        findings.append(_finding("invalid_build_manifest_fields", "/manifest", "frozen fields"))
    elif manifest.get("contract_id") != BUILD_MANIFEST_CONTRACT_ID:
        findings.append(
            _finding("contract_mismatch", "/manifest/contract_id", BUILD_MANIFEST_CONTRACT_ID)
        )
    if isinstance(manifest, dict) and manifest.get("asset_root_id") != asset_root_id:
        findings.append(_finding("asset_root_mismatch", "/manifest/asset_root_id", asset_root_id))
    relative = manifest.get("module_graph_path") if isinstance(manifest, dict) else None
    if not isinstance(relative, str) or Path(relative).is_absolute():
        findings.append(_finding("invalid_module_graph_path", "/manifest/module_graph_path", str(relative)))
        graph_path = graph_root / "invalid"
    else:
        graph_path = (graph_root / relative).resolve()
        try:
            graph_path.relative_to(graph_root.resolve())
        except ValueError:
            findings.append(_finding("module_graph_path_escape", "/manifest/module_graph_path", relative))
    if findings:
        raise ModuleGraphError(findings)
    try:
        graph = _read_json_exact(graph_path)
    except (OSError, json.JSONDecodeError) as exc:
        raise ModuleGraphError(
            [_finding("installed_graph_unreadable", str(graph_path), str(exc))]
        ) from exc
    if _json_digest(graph) != manifest.get("module_graph_sha256"):
        raise ModuleGraphError(
            [_finding("installed_graph_digest_mismatch", str(graph_path), "content drifted")]
        )
    if (
        graph.get("contract_id") != GRAPH_CONTRACT_ID
        or graph.get("module_id") != manifest.get("module_id")
        or graph.get("source_languages") != manifest.get("source_languages")
    ):
        raise ModuleGraphError(
            [_finding("installed_graph_scope_mismatch", str(graph_path), "manifest mismatch")]
        )
    return {
        "manifest": manifest,
        "module_graph": graph,
    }


def load_installed_module_graph(
    workspace: Path | str,
    *,
    asset_root_id: str,
) -> dict[str, Any]:
    """Read the verified graph selected by one asset-root manifest."""
    return load_installed_module_graph_installation(
        workspace,
        asset_root_id=asset_root_id,
    )["module_graph"]


def _normalize_search_text(value: Any) -> str:
    return " ".join(
        unicodedata.normalize("NFKC", str(value or "")).casefold().split()
    )


def _visible_node(
    node: dict[str, Any], audience: str, revealed_node_ids: set[str]
) -> bool:
    if audience == "keeper":
        return True
    return node.get("visibility") == "player-safe" or node.get("node_id") in revealed_node_ids


def search_graph(
    graph: dict[str, Any],
    query: str,
    *,
    audience: str = "keeper",
    revealed_node_ids: set[str] | None = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """Return lexical candidates; callers retain all semantic judgment."""
    if audience not in {"keeper", "player"}:
        raise ValueError("audience must be keeper or player")
    if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1 or limit > 100:
        raise ValueError("limit must be an integer from 1 through 100")
    needle = _normalize_search_text(query)
    if not needle:
        return []
    revealed = set(revealed_node_ids or set())
    rows: list[dict[str, Any]] = []
    for node in graph.get("nodes") or []:
        if not isinstance(node, dict) or not _visible_node(node, audience, revealed):
            continue
        fields = {
            "node_id": _normalize_search_text(node.get("node_id")),
            "name": _normalize_search_text(node.get("name")),
            "aliases": [_normalize_search_text(value) for value in node.get("aliases") or []],
            "summary": _normalize_search_text(node.get("summary")),
            "properties": _normalize_search_text(
                json.dumps(node.get("properties") or {}, ensure_ascii=False, sort_keys=True)
            ),
        }
        exact_alias = needle in fields["aliases"]
        if fields["node_id"] == needle:
            score = 100
            matched = "node_id"
        elif fields["name"] == needle or exact_alias:
            score = 90
            matched = "name_or_alias"
        else:
            searchable = [fields["node_id"], fields["name"], *fields["aliases"], fields["summary"], fields["properties"]]
            matching = [value for value in searchable if needle in value]
            if not matching:
                continue
            score = 50 + min(20, max(len(needle), 1))
            matched = "substring"
        rows.append(
            {
                "node_id": node["node_id"],
                "node_kind": node["node_kind"],
                "name": node["name"],
                "visibility": node["visibility"],
                "score": score,
                "matched": matched,
            }
        )
    rows.sort(key=lambda row: (-row["score"], row["node_id"]))
    return rows[:limit]


def _visible_claim(
    claim: dict[str, Any], audience: str, revealed_claim_ids: set[str]
) -> bool:
    if audience == "keeper":
        return True
    return claim.get("visibility") == "player-safe" or claim.get("claim_id") in revealed_claim_ids


def _project_node(node: dict[str, Any], audience: str) -> dict[str, Any]:
    if audience == "keeper":
        return copy.deepcopy(node)
    return {
        key: copy.deepcopy(node[key])
        for key in ("node_id", "node_kind", "name", "aliases", "summary", "visibility")
        if key in node
    }


def _project_claim(claim: dict[str, Any], audience: str) -> dict[str, Any]:
    if audience == "keeper":
        return copy.deepcopy(claim)
    return {
        key: copy.deepcopy(claim[key])
        for key in ("claim_id", "subject_id", "predicate", "object", "truth_status", "visibility")
        if key in claim
    }


def graph_context(
    graph: dict[str, Any],
    seed_ids: list[str],
    *,
    depth: int = 2,
    audience: str = "keeper",
    revealed_node_ids: set[str] | None = None,
    revealed_claim_ids: set[str] | None = None,
    max_nodes: int = 50,
) -> dict[str, Any]:
    """Return a visibility-safe, depth- and size-bounded graph neighborhood."""
    if audience not in {"keeper", "player"}:
        raise ValueError("audience must be keeper or player")
    if isinstance(depth, bool) or not isinstance(depth, int) or depth < 0 or depth > 4:
        raise ValueError("depth must be an integer from 0 through 4")
    if isinstance(max_nodes, bool) or not isinstance(max_nodes, int) or not 1 <= max_nodes <= 200:
        raise ValueError("max_nodes must be an integer from 1 through 200")
    if not isinstance(seed_ids, list) or not seed_ids:
        raise ValueError("at least one seed id is required")

    revealed_nodes = set(revealed_node_ids or set())
    revealed_claims = set(revealed_claim_ids or set())
    nodes = {
        node["node_id"]: node
        for node in graph.get("nodes") or []
        if isinstance(node, dict) and isinstance(node.get("node_id"), str)
    }
    claims = {
        claim["claim_id"]: claim
        for claim in graph.get("claims") or []
        if isinstance(claim, dict) and isinstance(claim.get("claim_id"), str)
    }
    visible_node_ids = {
        node_id
        for node_id, node in nodes.items()
        if _visible_node(node, audience, revealed_nodes)
    }
    missing = sorted({seed for seed in seed_ids if seed not in visible_node_ids})
    if missing:
        return {
            "error": "seed_not_found_or_hidden",
            "missing_seed_ids": missing,
            "nodes": [],
            "claims": [],
            "relations": [],
            "truncated": False,
        }

    eligible_relations: list[dict[str, Any]] = []
    adjacency: dict[str, list[tuple[str, dict[str, Any]]]] = {}
    for relation in graph.get("relations") or []:
        if not isinstance(relation, dict):
            continue
        source = relation.get("from_node_id")
        target = relation.get("to_node_id")
        claim = claims.get(relation.get("claim_id"))
        if source not in visible_node_ids or target not in visible_node_ids:
            continue
        if claim is None or not _visible_claim(claim, audience, revealed_claims):
            continue
        eligible_relations.append(relation)
        properties = relation.get("properties")
        if isinstance(properties, dict) and properties.get("context_traversal") is False:
            continue
        adjacency.setdefault(source, []).append((target, relation))
        adjacency.setdefault(target, []).append((source, relation))

    seen: set[str] = set(seed_ids)
    frontier = sorted(seen)
    truncated = False
    for _ in range(depth):
        next_frontier: list[str] = []
        for node_id in frontier:
            for other, _relation in sorted(
                adjacency.get(node_id, []), key=lambda pair: (pair[0], pair[1]["relation_id"])
            ):
                if other in seen:
                    continue
                if len(seen) >= max_nodes:
                    truncated = True
                    continue
                seen.add(other)
                next_frontier.append(other)
        frontier = sorted(set(next_frontier))
        if not frontier:
            break

    selected_relations = [
        copy.deepcopy(relation)
        for relation in eligible_relations
        if relation["from_node_id"] in seen and relation["to_node_id"] in seen
    ]
    selected_relations.sort(key=lambda relation: relation["relation_id"])
    selected_claim_ids = {relation["claim_id"] for relation in selected_relations}
    return {
        "module_id": graph.get("module_id"),
        "seed_ids": sorted(set(seed_ids)),
        "depth": depth,
        "audience": audience,
        "nodes": [_project_node(nodes[node_id], audience) for node_id in sorted(seen)],
        "claims": [
            _project_claim(claims[claim_id], audience)
            for claim_id in sorted(selected_claim_ids)
        ],
        "relations": selected_relations,
        "truncated": truncated,
    }


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ModuleGraphError(
            [_finding("invalid_json_artifact", str(path), str(exc))]
        ) from exc


def _print_json(payload: Any) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


def _page_catalog_from_args(values: list[str] | None) -> dict[tuple[str, int], dict[str, Any]] | None:
    return load_page_catalog([Path(value) for value in values]) if values else None


def _evidence_catalog_from_args(
    packet_values: list[str] | None,
    bundle_values: list[str] | None,
) -> dict[str, dict[str, Any]]:
    page_catalog = _page_catalog_from_args(bundle_values)
    return load_evidence_catalog(
        [Path(value) for value in (packet_values or [])],
        page_catalog=page_catalog,
    )


def _source_bindings_from_args(values: list[str]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for value in values:
        loaded = coc_pdf_bundle.load_host_bundle(Path(value))
        source = loaded["source"]
        rows.append({
            "source_id": source["source_id"],
            "bundle_sha256": loaded["bundle_sha256"],
            "file_sha256": source["file_sha256"],
        })
    return rows


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    schema = sub.add_parser("schema", help="Print the frozen model-facing contract")
    schema.add_argument("--json", action="store_true")

    prepare = sub.add_parser(
        "prepare",
        help="Prepare one closed extraction packet from a parent request",
    )
    prepare.add_argument("--request", required=True)
    prepare.add_argument("--source-bundle", action="append", required=True)
    prepare.add_argument("--output-dir", required=True)
    prepare.add_argument("--json", action="store_true")

    check = sub.add_parser(
        "check",
        help="Deterministically check one candidate before semantic review",
    )
    check.add_argument("--packet", required=True)
    check.add_argument("--evidence-packet", required=True)
    check.add_argument("--candidate", required=True)
    check.add_argument("--source-bundle", action="append", required=True)
    check.add_argument("--output", required=True)
    check.add_argument("--json", action="store_true")

    accept = sub.add_parser(
        "accept",
        help="Accept one source-bound candidate after semantic review",
    )
    accept.add_argument("--packet", required=True)
    accept.add_argument("--evidence-packet", required=True)
    accept.add_argument("--candidate", required=True)
    accept.add_argument("--review", required=True)
    accept.add_argument("--source-bundle", action="append", required=True)
    accept.add_argument("--output-dir", required=True)
    accept.add_argument("--json", action="store_true")

    build = sub.add_parser(
        "build",
        help="Install one reviewed graph generation under a module asset root",
    )
    build.add_argument("--workspace", required=True)
    build.add_argument("--asset-root-id", required=True)
    build.add_argument("--plan", required=True)
    build.add_argument("--accepted", action="append", required=True)
    build.add_argument("--source-bundle", action="append", required=True)
    build.add_argument("--json", action="store_true")

    installed_search = sub.add_parser(
        "installed-search",
        help="Lexically search the manifest-selected installed graph",
    )
    installed_search.add_argument("query")
    installed_search.add_argument("--workspace", required=True)
    installed_search.add_argument("--asset-root-id", required=True)
    installed_search.add_argument(
        "--audience", choices=("keeper", "player"), default="keeper"
    )
    installed_search.add_argument("--limit", type=int, default=20)
    installed_search.add_argument("--json", action="store_true")

    installed_context = sub.add_parser(
        "installed-context",
        help="Return a bounded neighborhood from the installed graph",
    )
    installed_context.add_argument("--workspace", required=True)
    installed_context.add_argument("--asset-root-id", required=True)
    installed_context.add_argument("--seed", action="append", required=True)
    installed_context.add_argument("--depth", type=int, default=2)
    installed_context.add_argument(
        "--audience", choices=("keeper", "player"), default="keeper"
    )
    installed_context.add_argument("--max-nodes", type=int, default=50)
    installed_context.add_argument("--json", action="store_true")

    evidence = sub.add_parser(
        "evidence-packet", help="Build machine-bound spans from accepted source pages"
    )
    evidence.add_argument("--source-bundle", action="append", required=True)
    evidence.add_argument("--section-id", required=True)
    evidence.add_argument(
        "--page-ref",
        action="append",
        required=True,
        help="exact source_id:pdf_index; split at the final colon",
    )
    evidence.add_argument("--output", required=True)
    evidence.add_argument("--model-output")
    evidence.add_argument("--json", action="store_true")

    validate = sub.add_parser("validate-shard", help="Validate one proposed GraphShard")
    validate.add_argument("shard")
    validate.add_argument("--evidence-packet", action="append", required=True)
    validate.add_argument("--source-bundle", action="append", default=[])
    validate.add_argument("--json", action="store_true")

    assemble = sub.add_parser(
        "assemble-shard",
        help="Machine-attach evidence scope, validate, and write one GraphShard",
    )
    assemble.add_argument("shard")
    assemble.add_argument("--output", required=True)
    assemble.add_argument("--evidence-packet", action="append", required=True)
    assemble.add_argument("--source-bundle", action="append", default=[])
    assemble.add_argument("--json", action="store_true")

    merge = sub.add_parser("merge", help="Promote GraphShards into one ModuleGraph")
    merge.add_argument("shards", nargs="+")
    merge.add_argument("--output", required=True)
    merge.add_argument("--evidence-packet", action="append", required=True)
    merge.add_argument("--source-bundle", action="append", default=[])
    merge.add_argument("--json", action="store_true")

    search = sub.add_parser("search", help="Lexically retrieve graph candidates")
    search.add_argument("graph")
    search.add_argument("query")
    search.add_argument("--audience", choices=("keeper", "player"), default="keeper")
    search.add_argument("--limit", type=int, default=20)
    search.add_argument("--json", action="store_true")

    context = sub.add_parser("context", help="Return a bounded graph neighborhood")
    context.add_argument("graph")
    context.add_argument("--seed", action="append", required=True)
    context.add_argument("--depth", type=int, default=2)
    context.add_argument("--audience", choices=("keeper", "player"), default="keeper")
    context.add_argument("--max-nodes", type=int, default=50)
    context.add_argument("--json", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "schema":
            _print_json(CONTRACT)
            return 0
        if args.command == "prepare":
            request = _read_json(Path(args.request))
            page_catalog = load_page_catalog(
                [Path(value) for value in args.source_bundle]
            )
            prepared = prepare_from_request(page_catalog, request)
            output_dir = Path(args.output_dir).expanduser().resolve()
            coc_fileio.write_json_atomic(
                output_dir / "evidence-packet.json",
                prepared["evidence_packet"],
                indent=2,
                ensure_ascii=False,
                trailing_newline=True,
            )
            coc_fileio.write_json_atomic(
                output_dir / "extraction-packet.json",
                prepared["extraction_packet"],
                indent=2,
                ensure_ascii=False,
                trailing_newline=True,
            )
            _print_json({
                "status": "PASS",
                "output_dir": str(output_dir),
                "section_id": prepared["extraction_packet"]["section_id"],
                "span_count": len(prepared["evidence_packet"]["spans"]),
            })
            return 0
        if args.command == "check":
            extraction_packet = _read_json(Path(args.packet))
            evidence_packet = _read_json(Path(args.evidence_packet))
            candidate = _read_json(Path(args.candidate))
            page_catalog = load_page_catalog(
                [Path(value) for value in args.source_bundle]
            )
            assembled = check_graph_shard(
                extraction_packet,
                evidence_packet,
                candidate,
                page_catalog=page_catalog,
            )
            output = Path(args.output).expanduser().resolve()
            coc_fileio.write_json_atomic(
                output,
                assembled,
                indent=2,
                ensure_ascii=False,
                trailing_newline=True,
            )
            _print_json({
                "status": "PASS",
                "output": str(output),
                "section_id": assembled["section_id"],
                "nodes": len(assembled["nodes"]),
                "claims": len(assembled["claims"]),
                "relations": len(assembled["relations"]),
            })
            return 0
        if args.command == "accept":
            extraction_packet = _read_json(Path(args.packet))
            evidence_packet = _read_json(Path(args.evidence_packet))
            candidate = _read_json(Path(args.candidate))
            review = _read_json(Path(args.review))
            page_catalog = load_page_catalog(
                [Path(value) for value in args.source_bundle]
            )
            accepted = accept_graph_shard(
                extraction_packet,
                evidence_packet,
                candidate,
                review,
                page_catalog=page_catalog,
            )
            output_dir = Path(args.output_dir).expanduser().resolve()
            for filename, payload in (
                ("accepted-shard.json", accepted["accepted_shard"]),
                ("evidence-packet.json", evidence_packet),
                ("review-receipt.json", accepted["review_receipt"]),
            ):
                coc_fileio.write_json_atomic(
                    output_dir / filename,
                    payload,
                    indent=2,
                    ensure_ascii=False,
                    trailing_newline=True,
                )
            _print_json({
                "status": "PASS",
                "output_dir": str(output_dir),
                "section_id": accepted["accepted_shard"]["section_id"],
                "candidate_sha256": accepted["review_receipt"]["candidate_sha256"],
            })
            return 0
        if args.command == "build":
            build_plan = _read_json(Path(args.plan))
            accepted_records = []
            for value in args.accepted:
                directory = Path(value).expanduser().resolve()
                accepted_records.append({
                    "accepted_shard": _read_json(directory / "accepted-shard.json"),
                    "evidence_packet": _read_json(directory / "evidence-packet.json"),
                    "review_receipt": _read_json(directory / "review-receipt.json"),
                })
            page_catalog = load_page_catalog(
                [Path(value) for value in args.source_bundle]
            )
            built = build_module_graph_asset(
                Path(args.workspace),
                asset_root_id=args.asset_root_id,
                build_plan=build_plan,
                accepted_records=accepted_records,
                source_bundles=_source_bindings_from_args(args.source_bundle),
                page_catalog=page_catalog,
            )
            _print_json({
                "status": "PASS",
                "graph_root": built["graph_root"],
                "build_status": built["manifest"]["build_status"],
                "current_generation": built["manifest"]["current_generation"],
                "nodes": len(built["module_graph"]["nodes"]),
                "claims": len(built["module_graph"]["claims"]),
                "relations": len(built["module_graph"]["relations"]),
            })
            return 0
        if args.command == "installed-search":
            graph = load_installed_module_graph(
                Path(args.workspace), asset_root_id=args.asset_root_id
            )
            results = search_graph(
                graph,
                args.query,
                audience=args.audience,
                limit=args.limit,
            )
            _print_json({"status": "PASS", "results": results})
            return 0
        if args.command == "installed-context":
            graph = load_installed_module_graph(
                Path(args.workspace), asset_root_id=args.asset_root_id
            )
            result = graph_context(
                graph,
                args.seed,
                depth=args.depth,
                audience=args.audience,
                max_nodes=args.max_nodes,
            )
            _print_json({"status": "PASS", "context": result})
            return 0
        if args.command == "evidence-packet":
            page_catalog = load_page_catalog(
                [Path(value) for value in args.source_bundle]
            )
            page_keys: list[tuple[str, int]] = []
            for value in args.page_ref:
                try:
                    source_id, raw_index = value.rsplit(":", 1)
                    page_keys.append((source_id, int(raw_index)))
                except (ValueError, AttributeError) as exc:
                    raise ModuleGraphError(
                        [_finding("invalid_page_ref", "/page_ref", str(value))]
                    ) from exc
            packet = build_evidence_packet(
                page_catalog, section_id=args.section_id, page_keys=page_keys
            )
            output = Path(args.output)
            coc_fileio.write_json_atomic(
                output, packet, indent=2, ensure_ascii=False, trailing_newline=True
            )
            if args.model_output:
                coc_fileio.write_json_atomic(
                    Path(args.model_output),
                    project_evidence_for_model(packet),
                    indent=2,
                    ensure_ascii=False,
                    trailing_newline=True,
                )
            _print_json(
                {
                    "status": "PASS",
                    "output": str(output),
                    "model_output": args.model_output,
                    "span_count": len(packet["spans"]),
                }
            )
            return 0
        if args.command == "validate-shard":
            shard = _read_json(Path(args.shard))
            findings = validate_shard(
                shard,
                evidence_catalog=_evidence_catalog_from_args(
                    args.evidence_packet, args.source_bundle
                ),
            )
            _print_json(
                {
                    "status": "PASS" if not findings else "FAIL",
                    "finding_count": len(findings),
                    "findings": findings,
                }
            )
            return 0 if not findings else 1
        if args.command == "assemble-shard":
            proposed = _read_json(Path(args.shard))
            assembled = assemble_model_shard(proposed)
            findings = validate_shard(
                assembled,
                evidence_catalog=_evidence_catalog_from_args(
                    args.evidence_packet, args.source_bundle
                ),
            )
            if findings:
                _print_json(
                    {
                        "status": "FAIL",
                        "finding_count": len(findings),
                        "findings": findings,
                    }
                )
                return 1
            output = Path(args.output)
            coc_fileio.write_json_atomic(
                output, assembled, indent=2, ensure_ascii=False, trailing_newline=True
            )
            proposed_scope = {
                value
                for value in (
                    proposed.get("evidence_span_ids", [])
                    if isinstance(proposed, dict)
                    else []
                )
                if isinstance(value, str)
            }
            _print_json(
                {
                    "status": "PASS",
                    "output": str(output),
                    "evidence_span_count": len(assembled["evidence_span_ids"]),
                    "machine_attached_span_count": len(
                        set(assembled["evidence_span_ids"]) - proposed_scope
                    ),
                }
            )
            return 0
        if args.command == "merge":
            shards = [_read_json(Path(path)) for path in args.shards]
            graph = merge_shards(
                shards,
                evidence_catalog=_evidence_catalog_from_args(
                    args.evidence_packet, args.source_bundle
                ),
            )
            output = Path(args.output)
            coc_fileio.write_json_atomic(
                output, graph, indent=2, ensure_ascii=False, trailing_newline=True
            )
            _print_json(
                {
                    "status": "PASS",
                    "output": str(output),
                    "module_id": graph["module_id"],
                    "sections": len(graph["section_ids"]),
                    "nodes": len(graph["nodes"]),
                    "claims": len(graph["claims"]),
                    "relations": len(graph["relations"]),
                }
            )
            return 0
        if args.command == "search":
            graph = _read_json(Path(args.graph))
            results = search_graph(
                graph, args.query, audience=args.audience, limit=args.limit
            )
            _print_json({"status": "PASS", "results": results})
            return 0
        if args.command == "context":
            graph = _read_json(Path(args.graph))
            result = graph_context(
                graph,
                args.seed,
                depth=args.depth,
                audience=args.audience,
                max_nodes=args.max_nodes,
            )
            _print_json({"status": "PASS", "context": result})
            return 0
    except ModuleGraphError as exc:
        _print_json(
            {
                "status": "FAIL",
                "finding_count": len(exc.findings),
                "findings": exc.findings,
            }
        )
        return 1
    except (OSError, ValueError) as exc:
        _print_json({"status": "ERROR", "error": str(exc)})
        return 2
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
