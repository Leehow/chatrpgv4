"""What a collapsed scene keeps is a decision, not an accident.

`scene.context` has a fourth projection nobody accounts for. When the decorated
envelope crosses the transport cap it is replaced wholesale by a bounded
recovery index, and which fields ride along is a hand-maintained `_pick` list.
Everything else is gone with no error, no warning the author will ever see, and
no test.

It is not a rare path. On 2026-09-02 campaign `amaranthine-run3` collapsed on
every scene read simply because it had accumulated NPCs, clues and impressions,
and the Keeper had been quietly running on the index for an unknown number of
turns. It lost `threat_clocks` — verified reaching the table hours earlier, in a
smaller scene — and `worldline_loop`, in the one scene whose only remaining path
ran through both. The doom clock and the declared time loop were invisible
precisely where they mattered.

So this is accounting, in the shape the wire whitelist already uses: every key
the tight scene carries is carried through the collapse, replaced by a named
index, or dropped on purpose with the reason written down. A new enriched field
fails here on the day it is added rather than at somebody's table.
"""
from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
WIRE = SCRIPTS / "coc_mcp_wire.py"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


wire = _load("coc_mcp_wire_collapse_tests", WIRE)

# Tight-scene keys the collapsed form answers with a bounded index instead.
SUBSTITUTED = {
    "npcs_present": "npc_index",
    "clues_here": "clue_index",
    "action_routes": "route_index",
    "scene": "scene_identity",
    "discovered_clue_count": "counts",
    "discovered_clues_public": "counts",
}

# Dropped on purpose. Each entry is a judgement someone can now argue with,
# which is the point — before this test they were invisible.
DROPPED = {
    "continuity": "keeper-only flag/effect ledger; re-read through the full projection",
    "keeper_mechanics": "mechanics detail the Keeper re-reads per subject when it needs one",
    "recommended_next_beat": "advisory nudge, not a fact the turn depends on",
    "story_progress": "main-line progress summary; advisory",
    "story_thread": "narrative thread summary; advisory",
    "pending_deliveries": "steward deliveries have their own operation",
    "nearby_routes": "neighbouring routes are a lookup, not this scene's state",
    "drilldown_refs": "refs exist to fetch more; the index already says how",
    "party_investigators": "party identity is carried; the sheets are a lookup",
    "operation_opportunities": "open attempts are enumerable on demand, not scene state",
}


def _tight_keys() -> set[str]:
    """Keys `_compact_scene(tight=True)` can produce, read from its source."""
    text = WIRE.read_text(encoding="utf-8")
    start = text.index("def _compact_scene(")
    body = text[start:text.index("\ndef ", start + 1)]
    picked = re.search(
        r"projected = _pick\(\s*value,\s*\((?P<keys>.*?)\),\s*\)", body, re.S,
    )
    assert picked, "the tight-scene pick list was not found"
    # Identifier-shaped only: the pick list is interleaved with comments whose
    # prose would otherwise be read as field names.
    return (
        set(re.findall(r'"([a-z_]+)"', picked.group("keys")))
        | set(re.findall(r'projected\["([a-z_]+)"\]\s*=', body))
    )


def _index_keys() -> set[str]:
    text = WIRE.read_text(encoding="utf-8")
    start = text.index("def _project_scene_recovery_index(")
    body = text[start:text.index("\ndef ", start + 1)]
    return (
        set(re.findall(r'"([a-z_]+)"', body))
        | set(re.findall(r'scene_index\["([a-z_]+)"\]\s*=', body))
    )


def test_both_projections_parse():
    tight, index = _tight_keys(), _index_keys()
    assert len(tight) >= 20, sorted(tight)
    assert "npc_index" in index and "scene_identity" in index, sorted(index)


def test_every_tight_key_has_a_stated_fate_in_the_collapsed_form():
    tight = _tight_keys()
    index = _index_keys()
    unaccounted = sorted(
        key for key in tight
        if key not in index and key not in SUBSTITUTED and key not in DROPPED
    )
    assert not unaccounted, (
        "these survive a normal scene read and vanish when the envelope "
        "collapses, with no error and nothing substituted for them: "
        + ", ".join(unaccounted)
        + ". Carry them in _project_scene_recovery_index, add a bounded index "
        "for them to SUBSTITUTED, or record in DROPPED why the Keeper can "
        "finish a turn without them."
    )


def test_the_two_that_a_live_table_lost_are_carried_now():
    """Both are small, and the scene that lost them had no other way forward."""
    index = _index_keys()
    for key in ("threat_clocks", "worldline_loop"):
        assert key in index, (
            f"{key} does not survive collapse; a Keeper that collapsed still "
            "has to run the scene it collapsed in"
        )


def test_substitutions_name_a_key_the_index_actually_produces():
    index = _index_keys()
    missing = sorted(
        f"{source}->{target}" for source, target in SUBSTITUTED.items()
        if target not in index
    )
    assert not missing, (
        "these claim a bounded index that the collapsed form does not build: "
        + ", ".join(missing)
    )


def test_no_key_is_both_dropped_and_carried():
    overlap = sorted(set(DROPPED) & (_index_keys() | set(SUBSTITUTED)))
    assert not overlap, (
        f"{overlap} are recorded as deliberately dropped but the collapsed form "
        "carries them; one key, one fate"
    )
    assert all(reason.strip() for reason in DROPPED.values())
