#!/usr/bin/env python3
"""Cross-module helper API index for COC Keeper.

Aggregates the public helper discovery surfaces of the COC subsystems so live
play tooling has a single entry point: ``api_index()`` returns a flat dict
mapping helper name -> ``{aliases, signature, returns}`` covering both roll
helpers (sourced from ``coc_roll.public_api_index``) and curated ``coc_rules``
public functions.

Sibling modules are loaded via importlib using the optional-sibling pattern
(mirroring ``coc_narrative_enrichment._load_optional_sibling``): if
``coc_roll`` or ``coc_rules`` cannot be loaded, ``api_index()`` returns
whatever is available instead of raising. This keeps the discovery surface
robust when the plugin tree is partially populated (e.g. during packaging or
in stripped-down runtimes).
"""
from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any


SCRIPT_DIR = Path(__file__).resolve().parent


def _load_optional_sibling(name: str, filename: str):
    """Load a sibling script module by filename, returning None if absent.

    Mirrors the optional-sibling pattern used across the COC plugin
    (e.g. ``coc_narrative_enrichment._load_optional_sibling``): the module is
    loaded only if its file exists, and any load failure is swallowed so the
    caller can degrade gracefully.
    """
    path = SCRIPT_DIR / filename
    if not path.exists():
        return None
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except Exception:
        # A sibling that fails to import (e.g. missing data files in a
        # stripped runtime) must not break API discovery for the other track.
        return None
    return module


coc_roll = _load_optional_sibling("coc_roll", "coc_roll.py")
coc_rules = _load_optional_sibling("coc_rules", "coc_rules.py")


def coc_rules_public_index() -> dict[str, dict[str, Any]]:
    """Return a curated public helper index for coc_rules' computation fns.

    Lists the six public, side-effect-free ``coc_rules`` functions used by
    live play: half/fifth thresholds, difficulty target, damage bonus + build,
    movement rate, and success-level classification. Each entry mirrors the
    ``{aliases, signature, returns}`` shape used by
    ``coc_roll.public_api_index``.

    Defined here (rather than as a method on ``coc_rules``) so the index is
    available even when ``coc_rules`` itself cannot be loaded — callers can
    still discover the intended API surface. Signatures are authored by hand
    to match the real function signatures in ``coc_rules.py``.
    """
    return {
        "half_value": {
            "aliases": [],
            "signature": "half_value(value)",
            "returns": "half threshold of value (value // 2)",
        },
        "fifth_value": {
            "aliases": [],
            "signature": "fifth_value(value)",
            "returns": "fifth threshold of value (value // 5)",
        },
        "difficulty_target": {
            "aliases": [],
            "signature": "difficulty_target(target, difficulty)",
            "returns": "effective target for a regular/hard/extreme difficulty",
        },
        "damage_bonus_build": {
            "aliases": [],
            "signature": "damage_bonus_build(str_value, siz_value)",
            "returns": "damage bonus and build for a STR+SIZ total",
        },
        "movement_rate": {
            "aliases": [],
            "signature": "movement_rate(str_value, dex_value, siz_value, *, age_mov_penalty=0)",
            "returns": "movement rate rule + computed MOV",
        },
        "success_level": {
            "aliases": [],
            "signature": "success_level(roll, target)",
            "returns": "outcome level: critical/extreme/hard/regular/failure/fumble",
        },
    }


def api_index() -> dict[str, dict[str, Any]]:
    """Aggregate the public helper index across coc_roll and coc_rules.

    Returns a flat ``{name: {aliases, signature, returns}}`` dict. Roll
    helpers come from ``coc_roll.public_api_index()`` (when coc_roll is
    loadable); rules helpers come from :func:`coc_rules_public_index`. When a
    sibling is unavailable, its section is simply omitted — the function
    never raises for a missing sibling.
    """
    index: dict[str, dict[str, Any]] = {}

    if coc_roll is not None and hasattr(coc_roll, "public_api_index"):
        try:
            roll_index = coc_roll.public_api_index()
        except Exception:
            roll_index = {}
        if isinstance(roll_index, dict):
            for name, entry in roll_index.items():
                if isinstance(name, str) and isinstance(entry, dict):
                    index[name] = entry

    # The rules section is only surfaced when coc_rules is actually loadable:
    # coc_rules_public_index() is a static descriptive surface, but the
    # aggregated api_index() should reflect what is *callable*, so a missing
    # coc_rules means its entries are omitted (mirrors the coc_roll behaviour).
    if coc_rules is not None:
        rules_index = coc_rules_public_index()
        for name, entry in rules_index.items():
            index[name] = entry

    return index
