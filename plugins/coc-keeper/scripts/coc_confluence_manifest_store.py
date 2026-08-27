#!/usr/bin/env python3
"""Canonical campaign-side persistence for worldline confluence enumerations.

A real fork-heavy campaign enumerates thousands of divergent rows whose raw
payloads reach multi-megabyte sizes. The model-facing wire budget (16KB,
``coc_mcp_wire.MAX_INLINE_BYTES``) can never carry that enumeration, so
``timeline.confluence_query`` persists the **complete** enumeration here —
one deterministic canonical JSON document per semantic ``confluence_id``
under ``memory/temporal/confluence-manifests/`` — and returns only a
bounded paging projection. ``timeline.confluence_confirm`` reloads this
manifest by reference, verifies its integrity digest against a freshly
recomputed enumeration plus unchanged parent anchors, fails closed before
any mutation when either drifted, and then runs the exact existing
plan/pipeline. Disposition completeness stays machine-enforced over the
FULL manifest; the wire only ever carries semantic ids/modes/receipts.

Laws owned here (everything else stays in the reviewed cores):

- Deterministic bytes only: canonical JSON (sorted keys, compact
  separators, ``ensure_ascii=False``) written atomically through
  ``coc_fileio.write_text_atomic``. The same inputs always produce the
  byte-same document; a repeated query rewrites it byte-identically.
- Machine-internal integrity evidence: the ``manifest_sha256`` field is a
  SHA-256 over every other field in canonical form (computed exactly by
  ``coc_temporal_memory_contract.record_digest``). It is verified on load
  and never appears on any model-facing surface.
- Derived and rebuildable: both parent tips are immutable Git commits, so
  the document is a pure function of them. It sits beside the other
  rebuildable temporal caches and never replaces authoritative state.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Mapping

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_fileio
import coc_temporal_memory as temporal_memory
import coc_temporal_memory_contract as contract

SCHEMA_GENERATION = contract.SCHEMA_GENERATION

MANIFESTS_DIRNAME = "confluence-manifests"
MANIFEST_SUFFIX = ".json"


class ConfluenceManifestError(ValueError):
    """Store-level failure (corrupt document, digest drift, unsafe id)."""


def manifests_root(campaign_dir: Path | str) -> Path:
    """Campaign-side directory holding one document per confluence id."""
    return temporal_memory.temporal_dir(campaign_dir) / MANIFESTS_DIRNAME


def manifest_path(campaign_dir: Path | str, confluence_id: str) -> Path:
    """Filesystem path for one semantic confluence id's manifest."""
    token = str(confluence_id or "").strip()
    try:
        contract._check_semantic_id(
            token,
            kind="confluence",
            field="confluence_id",
            prefix=contract.ID_PREFIX["confluence"],
        )
    except contract.TemporalMemoryContractError as exc:
        raise ConfluenceManifestError(str(exc)) from exc
    name = token + MANIFEST_SUFFIX
    path = manifests_root(campaign_dir) / name
    if path.name != name or ".." in path.parts:
        raise ConfluenceManifestError(
            f"confluence id {token!r} does not map to a safe filename"
        )
    return path


def class_counts(conflicts: list[Mapping[str, Any]]) -> dict[str, int]:
    """Deterministic histogram of enumerated conflicts by their class."""
    counts: dict[str, int] = {}
    for conflict in conflicts:
        conflict_class = str(conflict.get("class"))
        counts[conflict_class] = counts.get(conflict_class, 0) + 1
    return dict(sorted(counts.items()))


def build_manifest_document(
    *,
    campaign_id: str,
    timeline_id: str,
    parents: list[str],
    anchor_turns: list[int],
    enumeration: Mapping[str, Any],
) -> dict[str, Any]:
    """Machine-facing canonical document over one complete enumeration.

    Carries the full conflict records (both sides verbatim — the model
    surface never shows these) plus the one-sided additions and derived
    count histograms, bound to the semantic parent anchors the query saw.
    """
    conflicts = [dict(row) for row in enumeration.get("conflicts") or []]
    additions_raw = enumeration.get("additions") or {}
    additions = {
        side: [dict(row) for row in additions_raw.get(side) or []]
        for side in ("left_only", "right_only")
    }
    document = {
        "schema_version": 1,
        "schema_generation": SCHEMA_GENERATION,
        "confluence_id": str(enumeration.get("confluence_id") or ""),
        "campaign_id": campaign_id,
        "timeline_id": timeline_id,
        "parents": list(parents),
        "anchor_turns": [
            int(turn) for turn in anchor_turns
        ],
        "conflicts": conflicts,
        "additions": additions,
        "counts": {
            "conflicts_total": len(conflicts),
            "class_counts": class_counts(conflicts),
            "addition_counts": {
                "left_only": len(additions["left_only"]),
                "right_only": len(additions["right_only"]),
            },
        },
    }
    document["manifest_sha256"] = contract.record_digest(document)
    return document


def persist_manifest(
    campaign_dir: Path | str, document: Mapping[str, Any]
) -> Path:
    """Atomically write one manifest document. Byte-deterministic.

    Verifies the internal digest before touching disk so a caller bug can
    never persist a self-inconsistent enumeration. Rewriting an unchanged
    enumeration writes the byte-same file again (idempotent); a changed
    parent generation legitimately overwrites — confirm re-verifies both
    anchors and digests before anything mutates.
    """
    payload = dict(document)
    stored_digest = payload.pop("manifest_sha256", None)
    if not isinstance(stored_digest, str) or not stored_digest:
        raise ConfluenceManifestError(
            "refusing to persist a confluence manifest without its "
            "integrity digest"
        )
    recomputed = contract.record_digest(payload)
    if recomputed != stored_digest:
        raise ConfluenceManifestError(
            "refusing to persist a confluence manifest whose recorded "
            "digest does not match its content"
        )
    body = dict(payload)
    body["manifest_sha256"] = stored_digest
    camp = temporal_memory._require_campaign_dir(campaign_dir)
    root = manifests_root(camp)
    root.mkdir(parents=True, exist_ok=True)
    path = manifest_path(camp, str(body["confluence_id"]))
    coc_fileio.write_text_atomic(
        path, contract.canonical_json(body) + "\n"
    )
    return path


def load_manifest(
    campaign_dir: Path | str, confluence_id: str
) -> dict[str, Any] | None:
    """One persisted manifest by semantic id, digest-verified, or None.

    A missing file means no enumeration was ever persisted under this id;
    the caller directs the KP back to ``timeline.confluence_query``. A
    present-but-corrupt or digest-drifting document raises hard — a half
    truth is worse than none.
    """
    path = manifest_path(campaign_dir, confluence_id)
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError, ValueError) as exc:
        raise ConfluenceManifestError(
            f"persisted confluence manifest for {confluence_id!r} is "
            f"unreadable ({exc}); re-run timeline.confluence_query"
        ) from exc
    if not isinstance(payload, dict):
        raise ConfluenceManifestError(
            f"persisted confluence manifest for {confluence_id!r} is "
            "malformed; re-run timeline.confluence_query"
        )
    stored_digest = payload.pop("manifest_sha256", None)
    if not isinstance(stored_digest, str) or not stored_digest:
        raise ConfluenceManifestError(
            f"persisted confluence manifest for {confluence_id!r} carries "
            "no integrity digest; re-run timeline.confluence_query"
        )
    if contract.record_digest(payload) != stored_digest:
        raise ConfluenceManifestError(
            f"persisted confluence manifest for {confluence_id!r} failed "
            "its integrity digest; re-run timeline.confluence_query"
        )
    payload["manifest_sha256"] = stored_digest
    return payload
