#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_fileio
import coc_pdf_bundle
import coc_pdf_source


EMPTY_SCENARIO_LISTS = (
    "locations.json",
    "npcs.json",
    "clues.json",
    "timeline.json",
    "keeper-secrets.json",
)

# Verbatim info cards (原文信息卡). One card is one player-deliverable
# artifact whose body text is a verbatim source excerpt, never a Keeper
# paraphrase. These shapes are shared verbatim by index/handout-assets.json
# asset entries and progressive handout entity packs (isomorphic contract).
HANDOUT_CARD_KINDS = ("document", "read_aloud", "map")
HANDOUT_CARD_ID_PATTERN = re.compile(r"pdf_index-(\d+)")


def handout_card_source_indices(source_refs: Any) -> list[int]:
    """Derive bundle page indices from card string source_refs.

    Card ``source_refs`` are compact provenance strings (e.g. ``pdf_index-16``),
    not the object-form refs used by clue packs. Only the canonical
    ``pdf_index-<n>`` form carries a page index; other non-empty strings stay
    valid provenance labels without an index.
    """
    indices: list[int] = []
    if not isinstance(source_refs, list):
        return indices
    for ref in source_refs:
        if not isinstance(ref, str):
            continue
        match = HANDOUT_CARD_ID_PATTERN.fullmatch(ref.strip())
        if match is not None:
            indices.append(int(match.group(1)))
    return sorted(set(indices))


def validate_handout_card(entry: Any, *, prefix: str = "handout") -> list[str]:
    """Validate one verbatim handout card entry; return error strings.

    Checks only the contract card fields and ignores unknown keys so the same
    validator serves asset-index entries and module-assets entity packs.
    Hard rules: ``kind`` is required and enum-bound; ``text`` (the verbatim
    body) is meaningless without ``source_refs`` tracing it to source pages.
    """
    if not isinstance(entry, dict):
        return [f"{prefix} must be an object"]
    errors: list[str] = []
    kind = entry.get("kind")
    if not isinstance(kind, str) or kind not in HANDOUT_CARD_KINDS:
        errors.append(
            f"{prefix}.kind must be one of {list(HANDOUT_CARD_KINDS)}"
        )
    for field in ("title", "text", "localized_text", "when_to_deliver", "image_ref"):
        value = entry.get(field)
        if value is not None and not isinstance(value, str):
            errors.append(f"{prefix}.{field} must be a string when present")
        if field == "text" and isinstance(value, str) and not value.strip():
            errors.append(f"{prefix}.text must be a non-empty verbatim excerpt")
    text = entry.get("text")
    source_refs = entry.get("source_refs")
    if source_refs is not None:
        if (
            not isinstance(source_refs, list)
            or not source_refs
            or any(
                not isinstance(ref, str) or not ref.strip()
                for ref in source_refs
            )
        ):
            errors.append(
                f"{prefix}.source_refs must be a non-empty array of strings"
            )
    if isinstance(text, str) and text.strip():
        if not isinstance(source_refs, list) or not source_refs:
            errors.append(
                f"{prefix}.text requires non-empty source_refs tracing the "
                "verbatim excerpt to bundle pages"
            )
    if entry.get("player_visible") is not None and not isinstance(
        entry.get("player_visible"), bool
    ):
        errors.append(f"{prefix}.player_visible must be a boolean when present")
    for field in ("scene_refs", "clue_refs"):
        value = entry.get(field)
        if value is not None and (
            not isinstance(value, list)
            or any(not isinstance(ref, str) for ref in value)
        ):
            errors.append(f"{prefix}.{field} must be a string array when present")
    return errors


def _write_json(path: Path, payload: dict[str, Any] | list[Any]) -> None:
    coc_fileio.write_json_atomic(
        path, payload, indent=2, ensure_ascii=True, trailing_newline=True
    )


def load_handout_assets(campaign_dir: Path) -> dict[str, dict[str, Any]]:
    """Read index/handout-assets.json and return a {asset_id: asset} map.

    Entries are verbatim handout cards. An entry missing ``asset_id`` or
    failing the card contract (bad ``kind``, ``text`` without ``source_refs``,
    ...) is skipped: invalid cards never reach display paths.
    """
    index_path = campaign_dir / "index" / "handout-assets.json"
    if not index_path.exists():
        return {}
    try:
        payload = json.loads(index_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(payload, dict):
        return {}
    result: dict[str, dict[str, Any]] = {}
    for asset in payload.get("assets", []) or []:
        if not isinstance(asset, dict):
            continue
        asset_id = asset.get("asset_id")
        if not (isinstance(asset_id, str) and asset_id):
            continue
        if validate_handout_card(asset, prefix=f"handout asset {asset_id}"):
            continue
        result[asset_id] = asset
    return result


def catalog_source_bundles(bundle_dir: Path) -> list[dict[str, Any]]:
    """Catalog host-produced bundles without opening their source PDFs."""
    if not bundle_dir.exists():
        return []

    catalog: list[dict[str, Any]] = []
    for path in sorted(bundle_dir.rglob(coc_pdf_bundle.MANIFEST_NAME)):
        bundle = coc_pdf_bundle.load_host_bundle(path.parent)
        source = bundle["source"]
        catalog.append(
            {
                "source_id": source["source_id"],
                "bundle_path": str(path.parent.resolve()),
                "page_count": source["page_count"],
                "selected_pdf_indices": [page["pdf_index"] for page in bundle["pages"]],
                "title": source["title"],
                "file_sha256": source["file_sha256"],
            }
        )
    return catalog


def create_scenario_skeleton(
    campaign_dir: Path,
    scenario_id: str,
    title: str,
    source: dict[str, Any],
) -> dict[str, Any]:
    scenario_dir = campaign_dir / "scenario"
    index_dir = campaign_dir / "index"
    handout_asset_dir = campaign_dir / "assets" / "handouts"
    scenario_dir.mkdir(parents=True, exist_ok=True)
    index_dir.mkdir(parents=True, exist_ok=True)
    handout_asset_dir.mkdir(parents=True, exist_ok=True)

    scenario = {
        "schema_version": 1,
        "scenario_id": scenario_id,
        "title": title,
        "source": source,
        "summary": "",
        "player_safe_summary": "",
        "current_phase": "intro",
    }
    _write_json(scenario_dir / "scenario.json", scenario)

    for filename in EMPTY_SCENARIO_LISTS:
        _write_json(scenario_dir / filename, [])

    # Verbatim info cards projected from progressive handout entities. The
    # campaign card store is an object (clean-slate shape): handout deep packs
    # merge into ``handouts`` keyed by asset_id.
    _write_json(
        scenario_dir / "handouts.json",
        {"schema_version": 1, "handouts": []},
    )

    normalized_source = dict(source or {})
    if normalized_source.get("path") and not normalized_source.get("source_id"):
        normalized_source["source_id"] = coc_pdf_source.default_source_id(
            normalized_source["path"]
        )
    if normalized_source.get("path") and not normalized_source.get("file_sha256"):
        file_hash = coc_pdf_source.sha256_file(normalized_source["path"])
        if file_hash:
            normalized_source["file_sha256"] = file_hash

    _write_json(
        index_dir / "source-map.json",
        {
            "schema_version": 1,
            "scenario_id": scenario_id,
            "sources": [normalized_source],
            "entries": [],
        },
    )
    _write_json(
        index_dir / "handout-assets.json",
        {
            "schema_version": 1,
            "scenario_id": scenario_id,
            "asset_root": "assets/handouts",
            "assets": [],
            "display": {
                "codex": "render absolute Markdown image paths when player_visible is true",
                "text_only": "show title, summary, and source page when inline image display is unavailable",
            },
        },
    )
    coc_pdf_source.initialize_source_indexes(
        campaign_dir,
        scenario_id,
        sources=[normalized_source],
    )
    return scenario
