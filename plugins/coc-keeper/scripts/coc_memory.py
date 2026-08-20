#!/usr/bin/env python3
"""Grep-native memory layer for the COC Story Director.

Memory cards are Markdown files with YAML frontmatter. The frontmatter holds
machine-readable fields (memory_id, kind, status, privacy, salience, entities,
tags, reactivation_cues); the body holds a short Chinese summary an LLM can
read directly. This design favors Codex grep/read over a database.

Memory is never authoritative truth: HP, clues, timeline, and dice stay with
``state.*`` / ``rules.*``. Retrieval results are data for the live KP to judge
semantically; overlap scoring here is data retrieval, not a semantic decision.

Clean-slate schema law: every card requires ``kind``; cards without a valid
``kind`` fail validation and are excluded from retrieval/index (reported as
``invalid_cards``). No migrations, no dual readers.

Historical spec retired; see tombstone index docs/status/DIAGNOSIS-LEDGER.md
"""
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

PRIVACY_DIRS = {
    "player_safe": "player-safe",
    "keeper_only": "keeper-only",
    "system_only": "keeper-only",  # system-only not shown to anyone; reuse keeper-only dir
}

# Closed card-kind namespace. Clean-slate: a card without a valid kind is
# invalid, never grandfathered.
CARD_KINDS = (
    "fact",
    "event",
    "npc_relationship",
    "unresolved_hook",
    "foreshadowing",
    "player_preference",
    "keeper_correction",
)
# Kinds that own a lifecycle status ledger.
HOOK_KINDS = ("unresolved_hook", "foreshadowing")
HOOK_STATUSES = ("open", "resolved", "paid_off", "abandoned")
# resolve_hook_card may only transition into these terminal states.
HOOK_RESOLUTIONS = ("resolved", "paid_off", "abandoned")


def _cards_dir(campaign_dir: Path, privacy: str) -> Path:
    subdir = PRIVACY_DIRS.get(privacy, "keeper-only")
    d = campaign_dir / "memory" / "cards" / subdir
    d.mkdir(parents=True, exist_ok=True)
    return d


def _frontmatter(cards_dir: Path) -> list[dict[str, Any]]:
    """Parse frontmatter from all .md cards in a dir. Returns list of dicts with path."""
    out = []
    for md in sorted(cards_dir.glob("*.md")):
        text = md.read_text(encoding="utf-8")
        if not text.startswith("---\n"):
            continue
        parts = text.split("---", 2)
        if len(parts) < 3:
            continue
        fm_text = parts[1]
        # crude YAML parse (key: value or multiline list)
        meta: dict[str, Any] = {"path": str(md), "body": parts[2].strip()}
        current_list_key = None
        current_list: list[str] = []
        for line in fm_text.splitlines():
            list_item = re.match(r"^\s*-\s+(.+)$", line)
            if list_item and current_list_key:
                current_list.append(list_item.group(1).strip())
                continue
            m = re.match(r"^([a-z_]+):\s*(.*)$", line)
            if m:
                if current_list_key and current_list:
                    meta[current_list_key] = current_list
                key, val = m.group(1), m.group(2).strip()
                current_list_key = key if val == "" else None
                current_list = []
                if val:
                    try:
                        meta[key] = float(val) if "." in val else int(val)
                    except ValueError:
                        meta[key] = val
        if current_list_key and current_list:
            meta[current_list_key] = current_list
        out.append(meta)
    return out


def validate_card_fields(
    kind: Any,
    status: Any = None,
    resolved_at: Any = None,
) -> list[str]:
    """Structured schema check shared by writers, retrieval, and the index.

    Returns a list of human-readable errors; empty list means valid.
    """
    errors: list[str] = []
    if kind not in CARD_KINDS:
        errors.append(
            f"invalid or missing kind {kind!r}; expected one of {', '.join(CARD_KINDS)}"
        )
        return errors
    if kind in HOOK_KINDS:
        if status is not None and status not in HOOK_STATUSES:
            errors.append(
                f"invalid status {status!r} for kind {kind!r}; "
                f"expected one of {', '.join(HOOK_STATUSES)}"
            )
    else:
        if status is not None:
            errors.append(
                f"status is only valid for hook kinds {', '.join(HOOK_KINDS)}, "
                f"not kind {kind!r}"
            )
        if resolved_at is not None and str(resolved_at) != "":
            errors.append(
                f"resolved_at is only valid for hook kinds, not kind {kind!r}"
            )
    return errors


def card_validation_errors(meta: dict[str, Any]) -> list[str]:
    """Validate one parsed card's frontmatter (clean-slate: no legacy pass)."""
    return validate_card_fields(
        meta.get("kind"),
        meta.get("status"),
        meta.get("resolved_at"),
    )


def _render_card_text(meta: dict[str, Any], summary: str) -> str:
    """Render canonical card Markdown from structured fields (single writer)."""
    lines = ["---",
        f"memory_id: {meta['memory_id']}",
        f"kind: {meta['kind']}",
        f"scope: {meta.get('scope', 'campaign')}",
        f"privacy: {meta['privacy']}",
        f"salience: {meta.get('salience', 0.5)}"]
    if meta.get("status"):
        lines.append(f"status: {meta['status']}")
    if meta.get("introduced_at"):
        lines.append(f"introduced_at: {meta['introduced_at']}")
    if meta.get("resolved_at"):
        lines.append(f"resolved_at: {meta['resolved_at']}")
    if meta.get("resolution_reason"):
        lines.append(f"resolution_reason: {meta['resolution_reason']}")
    lines.append("entities:")
    lines += [f"  - {e}" for e in meta.get("entities") or []]
    lines.append("tags:")
    lines += [f"  - {t}" for t in meta.get("tags") or []]
    lines.append("reactivation_cues:")
    lines += [f"  - {c}" for c in meta.get("reactivation_cues") or []]
    if meta.get("scenes"):
        lines.append("scenes:")
        lines += [f"  - {s}" for s in meta["scenes"]]
    if meta.get("source_events"):
        lines.append("source_events:")
        lines += [f"  - {e}" for e in meta["source_events"]]
    if meta.get("possible_payoff"):
        lines.append(f"possible_payoff: {meta['possible_payoff']}")
    lines.append("---")
    lines.append("")
    lines.append(summary)
    return "\n".join(lines) + "\n"


def create_memory_card(
    campaign_dir: Path,
    memory_id: str,
    privacy: str,
    summary: str,
    entities: list[str],
    tags: list[str],
    reactivation_cues: list[str],
    *,
    kind: str,
    status: str | None = None,
    introduced_at: str | None = None,
    source_events: list[str] | None = None,
    salience: float = 0.5,
    scope: str = "campaign",
    scenes: list[str] | None = None,
    possible_payoff: str = "",
) -> Path:
    """Write a Markdown memory card with YAML frontmatter. Returns its path.

    ``kind`` is required (closed CARD_KINDS enum). ``status`` is valid only for
    hook kinds (unresolved_hook / foreshadowing) and defaults to ``open`` for
    them. ``introduced_at`` is an optional turn/scene reference string.
    """
    errors = validate_card_fields(kind, status)
    if errors:
        raise ValueError("invalid memory card: " + "; ".join(errors))
    if kind in HOOK_KINDS and status is None:
        status = "open"
    meta = {
        "memory_id": memory_id,
        "kind": kind,
        "scope": scope,
        "privacy": privacy,
        "salience": salience,
        "status": status,
        "introduced_at": introduced_at,
        "entities": entities,
        "tags": tags,
        "reactivation_cues": reactivation_cues,
        "scenes": scenes or [],
        "source_events": source_events or [],
        "possible_payoff": possible_payoff,
    }
    cards_dir = _cards_dir(campaign_dir, privacy)
    path = cards_dir / f"{memory_id}.md"
    path.write_text(_render_card_text(meta, summary), encoding="utf-8")
    update_memory_index(campaign_dir)
    return path


def find_card(campaign_dir: Path, memory_id: str) -> dict[str, Any] | None:
    """Locate one card's parsed frontmatter by memory_id across privacy dirs."""
    for sub in ("player-safe", "keeper-only"):
        d = campaign_dir / "memory" / "cards" / sub
        path = d / f"{memory_id}.md"
        if not path.exists():
            continue
        for meta in _frontmatter(d):
            if meta.get("memory_id") == memory_id:
                return meta
    return None


def resolve_hook_card(
    campaign_dir: Path,
    memory_id: str,
    resolution: str,
    *,
    resolved_at: str = "",
    reason: str = "",
) -> dict[str, Any]:
    """Transition an unresolved_hook / foreshadowing card's lifecycle status.

    Writes ``status`` plus ``resolved_at`` evidence into the card frontmatter.
    Idempotent: re-resolving into the same status is a no-op reported as
    ``already_resolved``. Never touches other authoritative state.
    """
    if resolution not in HOOK_RESOLUTIONS:
        raise ValueError(
            f"invalid hook resolution {resolution!r}; "
            f"expected one of {', '.join(HOOK_RESOLUTIONS)}"
        )
    meta = find_card(campaign_dir, memory_id)
    if meta is None:
        raise ValueError(f"memory card not found: {memory_id}")
    errors = card_validation_errors(meta)
    if errors:
        raise ValueError(
            f"memory card {memory_id} fails schema validation: " + "; ".join(errors)
        )
    if meta.get("kind") not in HOOK_KINDS:
        raise ValueError(
            f"memory card {memory_id} has kind {meta.get('kind')!r}; "
            f"only {', '.join(HOOK_KINDS)} cards own a lifecycle status"
        )
    if meta.get("status") == resolution:
        return {
            "memory_id": memory_id,
            "kind": meta.get("kind"),
            "status": resolution,
            "resolved_at": meta.get("resolved_at") or "",
            "already_resolved": True,
        }
    updated = dict(meta)
    updated["status"] = resolution
    if resolved_at:
        updated["resolved_at"] = resolved_at
    if reason:
        updated["resolution_reason"] = reason
    body = str(meta.get("body") or "")
    path = Path(str(meta["path"]))
    path.write_text(_render_card_text(updated, body), encoding="utf-8")
    update_memory_index(campaign_dir)
    return {
        "memory_id": memory_id,
        "kind": updated.get("kind"),
        "status": resolution,
        "resolved_at": updated.get("resolved_at") or "",
        "already_resolved": False,
    }


def retrieve_memory_cards(
    campaign_dir: Path,
    query_entities: list[str],
    query_cues: list[str],
    query_tags: list[str],
    privacy_filter: str = "player_safe",
    limit: int = 5,
    *,
    kinds: list[str] | None = None,
    statuses: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Score and rank memory cards by overlap with query terms. No embeddings.

    score = 4*entity_overlap + 3*cue_overlap + 2*tag_overlap + 2*salience - 5*privacy_mismatch

    ``kinds`` / ``statuses`` are structured pre-filters over the closed enums.
    Cards failing clean-slate schema validation (e.g. missing ``kind``) are
    never returned.
    """
    candidates: list[dict[str, Any]] = []
    # which dirs to scan based on privacy_filter
    scan_dirs = []
    if privacy_filter == "player_safe":
        scan_dirs.append(campaign_dir / "memory" / "cards" / "player-safe")
    else:
        # keeper can see both
        scan_dirs.append(campaign_dir / "memory" / "cards" / "player-safe")
        scan_dirs.append(campaign_dir / "memory" / "cards" / "keeper-only")

    q_entities = set(query_entities)
    q_cues = set(query_cues)
    q_tags = set(query_tags)
    kind_filter = set(kinds) if kinds else None
    status_filter = set(statuses) if statuses else None

    for d in scan_dirs:
        if not d.exists():
            continue
        for meta in _frontmatter(d):
            if card_validation_errors(meta):
                continue  # clean-slate: invalid cards never reach consumers
            if kind_filter is not None and meta.get("kind") not in kind_filter:
                continue
            if status_filter is not None and meta.get("status") not in status_filter:
                continue
            card_entities = set(meta.get("entities", []) or [])
            card_cues = set(meta.get("reactivation_cues", []) or [])
            card_tags = set(meta.get("tags", []) or [])
            card_privacy = meta.get("privacy", "player_safe")
            # privacy mismatch penalty
            privacy_penalty = 0
            if privacy_filter == "player_safe" and card_privacy != "player_safe":
                privacy_penalty = 5
            score = (
                4 * len(q_entities & card_entities)
                + 3 * len(q_cues & card_cues)
                + 2 * len(q_tags & card_tags)
                + 2 * float(meta.get("salience", 0.5))
                - privacy_penalty
            )
            if score > 0:
                meta["score"] = round(score, 3)
                candidates.append(meta)
    candidates.sort(key=lambda c: c["score"], reverse=True)
    return candidates[:limit]


def build_context_pack(
    campaign_dir: Path,
    turn: int,
    active_scene_id: str,
    dramatic_question: str,
    player_intent: str,
    cards: list[dict[str, Any]],
    keeper_constraints: list[str] | None = None,
) -> Path:
    """Write a Markdown context pack the director reads next turn."""
    keeper_constraints = keeper_constraints or []
    packs_dir = campaign_dir / "memory" / "context-packs"
    packs_dir.mkdir(parents=True, exist_ok=True)
    path = packs_dir / f"turn-{turn:05d}.md"
    lines = [
        f"# Director Context Pack turn-{turn}",
        "",
        "## Active Scene",
        f"scene_id: {active_scene_id}",
        f"dramatic_question: {dramatic_question}",
        "",
        "## Current Player Intent",
        player_intent,
        "",
        "## Relevant Memory Cards",
    ]
    if cards:
        for c in cards:
            mid = c.get("memory_id", "?")
            body = c.get("body", "")
            lines.append(f"- {mid}: {body}")
    else:
        lines.append("(none)")
    lines.append("")
    lines.append("## Keeper-only Constraints")
    if keeper_constraints:
        lines += [f"- {k}" for k in keeper_constraints]
    else:
        lines.append("(none)")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    # also update latest
    latest = packs_dir / "latest-director-context.md"
    latest.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def update_memory_index(campaign_dir: Path) -> None:
    """Rebuild memory/index.json from all cards (cheap, run on write).

    Valid cards land in ``cards``; schema-invalid cards (clean-slate: e.g.
    missing ``kind``) are reported in ``invalid_cards`` with errors and are
    never served to consumers.
    """
    cards_meta = []
    invalid_meta = []
    for sub in ("player-safe", "keeper-only"):
        d = campaign_dir / "memory" / "cards" / sub
        if not d.exists():
            continue
        for meta in _frontmatter(d):
            errors = card_validation_errors(meta)
            if errors:
                invalid_meta.append({
                    "memory_id": meta.get("memory_id"),
                    "path": meta.get("path"),
                    "errors": errors,
                })
                continue
            row = {
                "memory_id": meta.get("memory_id"),
                "path": meta.get("path"),
                "kind": meta.get("kind"),
                "privacy": meta.get("privacy"),
                "salience": meta.get("salience", 0.5),
                "entities": meta.get("entities", []),
                "tags": meta.get("tags", []),
                "reactivation_cues": meta.get("reactivation_cues", []),
            }
            if meta.get("status") is not None:
                row["status"] = meta.get("status")
            if meta.get("introduced_at") is not None:
                row["introduced_at"] = meta.get("introduced_at")
            if meta.get("resolved_at") is not None:
                row["resolved_at"] = meta.get("resolved_at")
            cards_meta.append(row)
    index_path = campaign_dir / "memory" / "index.json"
    document: dict[str, Any] = {"schema_version": 2, "cards": cards_meta}
    if invalid_meta:
        document["invalid_cards"] = invalid_meta
    coc_fileio.write_json_atomic(
        index_path,
        document,
        indent=2,
        ensure_ascii=False,
        trailing_newline=True,
    )
