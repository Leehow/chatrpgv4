"""A refusal that names a closed enum must name its members.

`involuntary_kind must be an explicit supported enum` tells a Keeper that
cannot read the module nothing it can act on. Measured 2026-09-02 r43: one
tried `none`, was refused, tried `scream`, and got the same six words back --
while `cry_out`, the value it was reaching for, is one of six the host has in
hand at the point of refusal.
"""

from __future__ import annotations

import random
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import coc_sanity  # noqa: E402
import coc_subsystem_executor as executor  # noqa: E402


def test_the_refusal_names_every_accepted_kind():
    with pytest.raises(executor.SubsystemExecutorError) as excinfo:
        executor.execute_commands(
            Path("/nonexistent-campaign-for-contract-check"),
            Path("/nonexistent-character.json"),
            "thomas-hayes",
            [{
                "command_id": "c1",
                "kind": "sanity_check",
                "phase": "resolve",
                "payload": {
                    "decision_id": "d1",
                    "source": "the corpse sits up",
                    "san_loss_fail_expr": "1D6",
                    "involuntary_kind": "scream",
                    "involuntary_summary": "the beam stops moving",
                },
            }],
            rng=random.Random(1),
        )
    message = excinfo.value.message
    assert excinfo.value.code == "invalid_command_payload", excinfo.value.code
    for kind in coc_sanity.INVOLUNTARY_KINDS:
        assert kind in message, (kind, message)
    # ...and how to say "no involuntary action at all", which is what the
    # Keeper was reaching for with `none`.
    assert "omit it" in message, message


def test_an_accepted_kind_passes_this_gate():
    """The gate must not have become a blanket refusal: a real member gets
    past it and fails later for the missing campaign, not for its value."""
    with pytest.raises(executor.SubsystemExecutorError) as excinfo:
        executor.execute_commands(
            Path("/nonexistent-campaign-for-contract-check"),
            Path("/nonexistent-character.json"),
            "thomas-hayes",
            [{
                "command_id": "c1",
                "kind": "sanity_check",
                "phase": "resolve",
                "payload": {
                    "decision_id": "d1",
                    "source": "the corpse sits up",
                    "san_loss_fail_expr": "1D6",
                    "involuntary_kind": "cry_out",
                    "involuntary_summary": "the beam stops moving",
                },
            }],
            rng=random.Random(1),
        )
    assert "involuntary_kind" not in excinfo.value.message, excinfo.value.message
