"""An unrecognized occupation skill must name the nearest catalog entries.

The skill catalog is closed and small (79 entries) and the miss is usually one
word off. Reporting only "unrecognized" left the Keeper to guess a vocabulary
it cannot see -- and chargen is the one place where a wrong guess stops the
table from opening at all.

Live on 2026-09-02, on the first turn of a fresh campaign: a fisherman's sheet
failed on `'Pilot (Boat)'` when the catalog entry is `'Pilot'`. Every earlier
playtest ran in an existing campaign, so this only surfaced the moment a new
one was created.
"""
from __future__ import annotations

import difflib
import importlib.util
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


_load("coc_toolbox_chargen_names_tests", SCRIPTS / "coc_toolbox.py")
character = _load("coc_character_chargen_names_tests", SCRIPTS / "coc_character.py")


def test_the_live_miss_has_a_nearest_name() -> None:
    """`Pilot (Boat)` -> `Pilot`, which is what the Keeper needed to be told."""
    catalog = character._skill_catalog()
    assert "Pilot" in catalog
    assert "Pilot (Boat)" not in catalog
    close = difflib.get_close_matches("Pilot (Boat)", list(catalog), n=3, cutoff=0.5)
    assert close and close[0] == "Pilot"


def test_the_refusal_carries_the_suggestions() -> None:
    source = (SCRIPTS / "coc_character.py").read_text(encoding="utf-8")
    marker = "unrecognized occupation_skill_names: "
    assert marker in source
    block = source[source.index(marker) - 1400:source.index(marker) + 400]
    assert "get_close_matches" in block, (
        "the refusal must offer the nearest catalog names; the catalog is "
        "closed and the Keeper cannot see it"
    )
    assert "suggestions" in block, (
        "structured suggestions belong in details too, not only in prose"
    )


def test_a_name_with_no_near_match_still_fails_closed() -> None:
    """Suggestions are an aid, never a bypass."""
    catalog = character._skill_catalog()
    assert difflib.get_close_matches(
        "zzzz-not-a-skill", list(catalog), n=3, cutoff=0.5,
    ) == []
    assert character.resolve_catalog_skill_name("zzzz-not-a-skill", catalog) is None
