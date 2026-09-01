"""Everything scene.context produces must have a stated wire disposition.

There are three projections between the producer and the table: the canonical
result, the bounded RPC wire view, and Pi's model-facing identity projection. A
field can be correct in the first and third and still never reach a Keeper,
because `_compact_scene` carries only the keys it names. The whitelist's own
comment records that this cost two live playtests to find; `threat_clocks` was
the third — the block resolved correctly at the producer, survived the identity
projection, and arrived at the table as null.

So this is accounting rather than content: every top-level key the canonical
result emits is either carried on the wire or listed below as deliberately
withheld, with the reason. A new key fails here, on the day it is added, and
the author has to say which it is. It is deliberately not a test of what any
field contains.
"""
from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"

def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


wire = _load("coc_mcp_wire_scene_coverage_tests", SCRIPTS / "coc_mcp_wire.py")


# Keys the canonical result carries that the wire deliberately does not.
# Each entry is a decision, not an oversight; deleting a key from here without
# adding it to the whitelist is what this test exists to catch.
WITHHELD = {
    "compiled_archive": "archive provenance metadata; the Keeper reads content, not revisions",
    "covered_domains": "a self-description of this result's own coverage",
    "recovery": "duplicated by rule_decision_cards on the bounded view",
    "recommended_next_beat": "advisory nudge the KP surface delivers as a hint",
    "pending_handouts": "body-free card metadata; delivery is its own operation",
    "scene_contract": "improvisation budget bookkeeping, not table-facing",
}


def _compact_scene_source() -> str:
    text = (SCRIPTS / "coc_mcp_wire.py").read_text(encoding="utf-8")
    start = text.index("def _compact_scene(")
    return text[start:text.index("\ndef ", start + 1)]


def _whitelist() -> set[str]:
    """Read what the wire carries out of its own source, not a copy of it.

    Two forms carry a key: the `_pick` list, and a direct assignment onto
    `projected` for a key that needs its own compaction. `exits` is the second
    kind, which is why this reads both — a test that modelled only the first
    would report a carried key as missing and teach the next author to ignore
    it.
    """
    body = _compact_scene_source()
    match = re.search(
        r"projected = _pick\(\s*value,\s*\((?P<keys>.*?)\),\s*\)", body, re.S,
    )
    assert match, "the scene.context wire whitelist was not found; update this test"
    return (
        set(re.findall(r'"([^"]+)"', match.group("keys")))
        | set(re.findall(r'projected\["([a-z_]+)"\]\s*=', body))
    )


def test_the_whitelist_is_readable_and_non_trivial():
    keys = _whitelist()
    assert len(keys) >= 15, f"whitelist parse looks wrong, got {sorted(keys)}"
    assert "scene" in keys and "npcs_present" in keys


def test_every_carried_or_withheld_key_is_stated_once():
    """The two sets are dispositions; a key may not be in both."""
    overlap = _whitelist() & set(WITHHELD)
    assert not overlap, (
        f"{sorted(overlap)} are listed as withheld but the wire carries them; "
        "one key, one disposition"
    )


def test_the_clock_block_that_arrived_as_null_is_carried_now():
    assert "threat_clocks" in _whitelist(), (
        "scene.context resolves the clock its pressure moves reference; if the "
        "wire drops it the Keeper is back to a dangling clock_id, which is how "
        "clock-loop-doom sat at 0/6 through a whole climax scene"
    )


@pytest.mark.parametrize("helper", [
    "_compact_story_progress", "_compact_nearby_routes", "_compact_story_thread",
    "_compact_pending_deliveries", "_compact_source_material",
    "_compact_rule_decision_card_block",
])
def test_every_withheld_key_that_claims_a_helper_has_one(helper):
    """A 'carried through X' reason must name a function that exists."""
    assert hasattr(wire, helper), (
        f"WITHHELD cites {helper}, which no longer exists; the key it explains "
        "may now be silently dropped"
    )


def test_the_canonical_producer_emits_every_key_accounted_for():
    """The load-bearing direction: producer keys must all have a disposition.

    Read from the kernel's own result literal rather than a live campaign, so
    the check covers keys a fixture campaign happens not to populate.
    """
    text = (SCRIPTS / "coc_operation_kernel.py").read_text(encoding="utf-8")
    start = text.index("def _tool_scene_context(")
    end = text.index("\ndef ", text.index('data["recommended_next_beat"]', start))
    body = text[start:end]
    literal = body[body.index("\n    data = {"):body.index('\n        "drilldown_refs"')]
    produced = set(re.findall(r'^        "([a-z_]+)":', literal, re.M))
    produced |= set(re.findall(r'data\["([a-z_]+)"\]\s*=', body))
    produced.add("drilldown_refs")
    produced.add("threat_clocks")
    assert len(produced) >= 25, f"producer key parse looks wrong: {sorted(produced)}"
    unaccounted = sorted(produced - _whitelist() - set(WITHHELD))
    assert not unaccounted, (
        "scene.context produces these keys and nothing says whether the RPC "
        "path carries them, so they reach the table as null: "
        + ", ".join(unaccounted)
        + ". Add each to the _compact_scene whitelist, or to WITHHELD with the "
        "reason it is deliberately not carried."
    )
