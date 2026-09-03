"""Closed sets an operation enforces must be declared, not only described.

`rules.damage` rejects any `kind` outside {damage, heal}, `state.item_grant`
any outside {gear, weapon}, `state.end_session` any outside its four flavours.
All three wrote those sets into free-text `desc` only, so no caller could read
them mechanically -- not the seeding harness, not the Keeper's tool schema.
Four seeding rounds shipped a rejected value and lost a lane each time.
"""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys

import pytest

TOOLBOX = Path("plugins/coc-keeper/scripts/coc_toolbox.py")

ENFORCED = [
    ("rules.damage", "kind", {"damage", "heal"}),
    ("state.item_grant", "kind", {"gear", "weapon"}),
    ("state.end_session", "kind",
     {"conclusion", "tpk", "retreat", "cliffhanger"}),
    ("magic.learn", "source", {"tome", "person", "entity"}),
]


@pytest.mark.parametrize("operation,param,expected", ENFORCED)
def test_an_enforced_closed_set_is_machine_readable(operation, param, expected):
    described = subprocess.run(
        [sys.executable, str(TOOLBOX), "describe", operation],
        capture_output=True, text=True, check=True,
    )
    declared = (json.loads(described.stdout).get("params") or {}).get(param) or {}
    assert set(declared.get("enum") or []) == expected, (
        f"{operation}.{param} enforces {sorted(expected)} at runtime but "
        f"declares {declared.get('enum')!r}"
    )
