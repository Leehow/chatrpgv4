"""Settling a combat beat with no combat underway must say so.

`load_combat_state` read the snapshot with no existence check, so "no combat
has started" surfaced as a bare errno. Through the subsystem executor, whose
failure path passes `str(exc)` through verbatim, the Keeper received:

    subsystem_transaction_failed: [Errno 2] No such file or directory:
    .../save/combat.json

That names no condition and no operation. Seen live on 2026-09-02: the Keeper
settled `decision:coc7:combat:maneuver` while nothing had begun, got the
errno, and moved on without ever learning that the answer was to start the
exchange.

`combat.end` already had the right shape for this (`combat_not_started`, "no
canonical combat snapshot exists"); the rule-graph settle path did not.
"""
from __future__ import annotations

import importlib.util
import json
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


_load("coc_toolbox_combat_start_tests", SCRIPTS / "coc_toolbox.py")
combat = _load("coc_combat_start_tests", SCRIPTS / "coc_combat.py")


def test_absence_names_the_condition_and_the_way_forward(tmp_path: Path) -> None:
    with pytest.raises(combat.CombatNotStartedError) as excinfo:
        combat.load_combat_state(tmp_path / "save" / "combat.json")
    message = str(excinfo.value)
    assert "combat.context" in message and "combat.resolve" in message, (
        "the refusal must name what to read and what to call; the errno it "
        "replaced named neither"
    )
    assert "No such file" not in message


def test_it_is_still_a_filenotfounderror(tmp_path: Path) -> None:
    """Callers that already catch the OS error keep working."""
    assert issubclass(combat.CombatNotStartedError, FileNotFoundError)
    with pytest.raises(FileNotFoundError):
        combat.load_combat_state(tmp_path / "combat.json")


def test_a_real_snapshot_still_loads(tmp_path: Path) -> None:
    path = tmp_path / "combat.json"
    path.write_text(json.dumps({"schema_version": 2}), encoding="utf-8")
    assert combat.load_combat_state(path) == {"schema_version": 2}


def test_a_corrupt_snapshot_is_not_reported_as_not_started(tmp_path: Path) -> None:
    """Absence and corruption are different conditions with different fixes."""
    path = tmp_path / "combat.json"
    path.write_text("{not json", encoding="utf-8")
    with pytest.raises(json.JSONDecodeError):
        combat.load_combat_state(path)
