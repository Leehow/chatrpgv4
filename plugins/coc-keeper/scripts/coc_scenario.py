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

# Player info cards. Source-verbatim excerpts and contributor-authored
# derivative props are separate provenance classes. These shapes are shared
# by index/handout-assets.json entries and progressive entity packs.
HANDOUT_CARD_KINDS = ("document", "read_aloud", "map")
HANDOUT_CONTENT_ORIGINS = ("source_verbatim", "authored_derivative")
HANDOUT_CARD_ID_PATTERN = re.compile(r"pdf_index-(\d+)")


class HandoutLinkError(ValueError):
    """Stable exact-identity error shared by compile and runtime."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def resolve_handout_clue_link(
    cards: dict[str, dict[str, Any]],
    clue_id: str,
    explicit_handout_id: str | None = None,
) -> str:
    """Resolve one clue/card relationship from exact structured ids only."""
    normalized_clue_id = str(clue_id).strip()
    explicit_id = str(explicit_handout_id or "").strip()
    reverse_ids = sorted(
        asset_id
        for asset_id, card in cards.items()
        if normalized_clue_id
        in {
            str(value).strip()
            for value in (card.get("clue_refs") or [])
            if str(value).strip()
        }
    )
    if explicit_id and explicit_id not in cards:
        raise HandoutLinkError(
            "unknown_handout",
            f"clue '{normalized_clue_id}' references unknown handout "
            f"'{explicit_id}', which is not a registered valid card",
        )
    if len(reverse_ids) > 1:
        raise HandoutLinkError(
            "handout_link_ambiguous",
            f"clue '{normalized_clue_id}' is referenced by multiple handout cards: "
            f"{', '.join(reverse_ids)}",
        )
    if explicit_id and reverse_ids and reverse_ids[0] != explicit_id:
        raise HandoutLinkError(
            "handout_link_conflict",
            f"clue '{normalized_clue_id}' explicitly references '{explicit_id}' "
            f"but card '{reverse_ids[0]}' claims the clue through clue_refs",
        )
    asset_id = explicit_id or (reverse_ids[0] if reverse_ids else "")
    if not asset_id:
        raise HandoutLinkError(
            "handout_link_missing",
            f"clue '{normalized_clue_id}' has delivery_kind=handout but no "
            "unique handout_asset_id or card clue_refs linkage",
        )
    if cards[asset_id].get("player_visible", True) is not True:
        raise HandoutLinkError(
            "handout_not_player_visible",
            f"handout '{asset_id}' linked to clue '{normalized_clue_id}' is "
            "marked player_visible:false; player delivery requires "
            "player_visible:true",
        )
    return asset_id


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
    """Validate one player-deliverable handout card; return error strings.

    Checks only the contract card fields and ignores unknown keys so the same
    validator serves asset-index entries and module-assets entity packs.
    Source-verbatim and contributor-authored derivative bodies have distinct
    fields so player projections can label their provenance truthfully.
    """
    if not isinstance(entry, dict):
        return [f"{prefix} must be an object"]
    errors: list[str] = []
    for field in ("asset_id", "handout_id"):
        value = entry.get(field)
        if value is not None and (
            not isinstance(value, str) or not value.strip()
        ):
            errors.append(f"{prefix}.{field} must be a non-empty string when present")
        elif isinstance(value, str) and value != value.strip():
            errors.append(
                f"{prefix}.{field} must not contain surrounding whitespace"
            )
    kind = entry.get("kind")
    if not isinstance(kind, str) or kind not in HANDOUT_CARD_KINDS:
        errors.append(
            f"{prefix}.kind must be one of {list(HANDOUT_CARD_KINDS)}"
        )
    content_origin = entry.get("content_origin", "source_verbatim")
    if content_origin not in HANDOUT_CONTENT_ORIGINS:
        errors.append(
            f"{prefix}.content_origin must be one of "
            f"{list(HANDOUT_CONTENT_ORIGINS)}"
        )
    for field in (
        "title", "summary", "text", "authored_text", "localized_language",
        "when_to_deliver", "image_ref",
    ):
        value = entry.get(field)
        if value is not None and not isinstance(value, str):
            errors.append(f"{prefix}.{field} must be a string when present")
        if field in {"text", "authored_text"} and isinstance(value, str) and not value.strip():
            errors.append(f"{prefix}.{field} must be non-empty when present")
    for field in ("localized_title", "localized_summary", "localized_text"):
        value = entry.get(field)
        if value is None:
            continue
        valid_map = (
            isinstance(value, dict)
            and bool(value)
            and all(
                isinstance(language, str)
                and language.strip()
                and isinstance(localized, str)
                and localized.strip()
                for language, localized in value.items()
            )
        )
        if isinstance(value, str) and not value.strip():
            errors.append(f"{prefix}.{field} must not be blank")
        elif not (isinstance(value, str) or valid_map):
            errors.append(
                f"{prefix}.{field} must be a string or a non-empty "
                "play_language-to-string map when present"
            )
        if isinstance(value, dict) and entry.get("localized_language") is not None:
            errors.append(
                f"{prefix}.localized_language must be absent when {field} "
                "uses a language map"
            )
    localized_language = entry.get("localized_language")
    if localized_language is not None and (
        not isinstance(localized_language, str) or not localized_language.strip()
    ):
        errors.append(f"{prefix}.localized_language must be a non-empty string")
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
    if content_origin == "authored_derivative":
        if isinstance(text, str) and text.strip():
            errors.append(
                f"{prefix}.text is reserved for source-verbatim excerpts; "
                "authored_derivative cards use authored_text"
            )
        if source_refs is not None:
            errors.append(
                f"{prefix}.source_refs are reserved for source-verbatim "
                "cards and must be absent for authored_derivative"
            )
    elif entry.get("authored_text") is not None:
        errors.append(
            f"{prefix}.authored_text requires content_origin=authored_derivative"
        )
    if entry.get("player_visible") is not None and not isinstance(
        entry.get("player_visible"), bool
    ):
        errors.append(f"{prefix}.player_visible must be a boolean when present")
    if entry.get("opening_card") is not None and not isinstance(
        entry.get("opening_card"), bool
    ):
        errors.append(f"{prefix}.opening_card must be a boolean when present")
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
