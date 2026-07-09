#!/usr/bin/env python3
"""Grep-native memory layer for the COC Story Director.

Memory cards are Markdown files with YAML frontmatter. The frontmatter holds
machine-readable fields (memory_id, privacy, salience, entities, tags,
reactivation_cues); the body holds a short Chinese summary an LLM can read
directly. This design favors Codex grep/read over a database.

Spec: docs/superpowers/specs/2026-07-06-story-director-v2-blueprint.md
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

PRIVACY_DIRS = {
    "player_safe": "player-safe",
    "keeper_only": "keeper-only",
    "system_only": "keeper-only",  # system-only not shown to anyone; reuse keeper-only dir
}


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


def create_memory_card(
    campaign_dir: Path,
    memory_id: str,
    privacy: str,
    summary: str,
    entities: list[str],
    tags: list[str],
    reactivation_cues: list[str],
    source_events: list[str] | None = None,
    salience: float = 0.5,
    scope: str = "campaign",
    scenes: list[str] | None = None,
    possible_payoff: str = "",
) -> Path:
    """Write a Markdown memory card with YAML frontmatter. Returns its path."""
    source_events = source_events or []
    scenes = scenes or []
    cards_dir = _cards_dir(campaign_dir, privacy)
    path = cards_dir / f"{memory_id}.md"
    lines = ["---",
        f"memory_id: {memory_id}",
        f"scope: {scope}",
        f"privacy: {privacy}",
        f"salience: {salience}",
        "entities:"]
    lines += [f"  - {e}" for e in entities]
    lines.append("tags:")
    lines += [f"  - {t}" for t in tags]
    lines.append("reactivation_cues:")
    lines += [f"  - {c}" for c in reactivation_cues]
    if scenes:
        lines.append("scenes:")
        lines += [f"  - {s}" for s in scenes]
    if source_events:
        lines.append("source_events:")
        lines += [f"  - {e}" for e in source_events]
    if possible_payoff:
        lines.append(f"possible_payoff: {possible_payoff}")
    lines.append("---")
    lines.append("")
    lines.append(summary)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    update_memory_index(campaign_dir)
    return path


def retrieve_memory_cards(
    campaign_dir: Path,
    query_entities: list[str],
    query_cues: list[str],
    query_tags: list[str],
    privacy_filter: str = "player_safe",
    limit: int = 5,
) -> list[dict[str, Any]]:
    """Score and rank memory cards by overlap with query terms. No embeddings.

    score = 4*entity_overlap + 3*cue_overlap + 2*tag_overlap + 2*salience - 5*privacy_mismatch
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

    for d in scan_dirs:
        if not d.exists():
            continue
        for meta in _frontmatter(d):
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
    """Rebuild memory/index.json from all cards (cheap, run on write)."""
    cards_meta = []
    for sub in ("player-safe", "keeper-only"):
        d = campaign_dir / "memory" / "cards" / sub
        if not d.exists():
            continue
        for meta in _frontmatter(d):
            cards_meta.append({
                "memory_id": meta.get("memory_id"),
                "path": meta.get("path"),
                "privacy": meta.get("privacy"),
                "salience": meta.get("salience", 0.5),
                "entities": meta.get("entities", []),
                "tags": meta.get("tags", []),
                "reactivation_cues": meta.get("reactivation_cues", []),
            })
    index_path = campaign_dir / "memory" / "index.json"
    index_path.parent.mkdir(parents=True, exist_ok=True)
    index_path.write_text(json.dumps({"schema_version": 1, "cards": cards_meta}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
