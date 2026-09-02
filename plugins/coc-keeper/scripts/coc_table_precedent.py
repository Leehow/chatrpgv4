#!/usr/bin/env python3
"""What this table already decided, assembled for one set of decisions.

Two stores answer the same question from different lifetimes: a session ruling
is a call the Keeper made at the table, a confirmed house rule is a standing
patch the table agreed to.  Both are precedent and both are advisory, so they
are read together and handed back together.

This lives in its own module because it has two callers that cannot share one:
the `rules.precedent` operation, and `dispatch_rules_context` in the kernel.
Operation-module exports land in the toolbox's globals, not the kernel's, so a
kernel caller reaching for an operation module's function through `globals()`
silently gets nothing -- a live branch that never runs.  One library, imported
by both, has no such failure mode.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_house_rules
import coc_session_rulings

#: How many precedents one answer may carry.  The wire has a measured 16 KB
#: ceiling and per-turn context growth is a tracked cost, so a campaign that
#: accumulates rulings must not quietly inflate every rules read.  Ordering is
#: deterministic, so a cap drops the least recent, never a random subset.
MAX_PRECEDENTS = 6

def precedent_for_decisions(
    campaign_dir: Path | str, decision_refs: list[str],
) -> dict[str, Any]:
    """Live rulings and confirmed house rules bound to these decisions.

    Both are advisory. The Keeper may adopt, modify, or ignore either, and an
    empty answer never blocks anything.
    """
    rulings: list[dict[str, Any]] = []
    patches: list[dict[str, Any]] = []
    seen_rulings: set[str] = set()
    seen_patches: set[str] = set()
    for decision_ref in decision_refs:
        try:
            for row in coc_session_rulings.rulings_for_decision(
                campaign_dir, decision_ref,
            ):
                key = str(row.get("ruling_id"))
                if key in seen_rulings:
                    continue
                seen_rulings.add(key)
                rulings.append({
                    "ruling_id": row.get("ruling_id"),
                    "decision_ref": row.get("decision_ref"),
                    "statement": row.get("statement"),
                    "reason": row.get("reason"),
                    "scope_kind": row.get("scope_kind"),
                    "expires": row.get("expires"),
                    "source_turn": row.get("source_turn"),
                })
        except coc_session_rulings.SessionRulingError:
            # A corrupt ruling store must not take a rules read down with it.
            # The Keeper loses precedent, not the ability to adjudicate.
            continue
        try:
            for record in coc_house_rules.confirmed_patches(
                campaign_dir, target=decision_ref,
            ):
                patch = record.get("patch") or {}
                key = f"{patch.get('patch_id')}@{patch.get('version')}"
                if key in seen_patches:
                    continue
                seen_patches.add(key)
                patches.append({
                    "patch_id": patch.get("patch_id"),
                    "relation": patch.get("relation"),
                    "target": patch.get("target"),
                    "layer": patch.get("layer"),
                    "scope": patch.get("scope"),
                    "version": patch.get("version"),
                    "statement": patch.get("statement"),
                    "reason": patch.get("reason"),
                })
        except coc_house_rules.HouseRuleError:
            continue
    return {
        "rulings": rulings[:MAX_PRECEDENTS],
        "house_rules": patches[:MAX_PRECEDENTS],
        "truncated": (
            len(rulings) > MAX_PRECEDENTS
            or len(patches) > MAX_PRECEDENTS
        ),
        "authority": "advisory",
    }
