"""A refusal that names a remedy must name all of it.

`state.journal` and `turn.finalize` refuse a turn whose critical, fumble or
pushed-failure outcome has no source-bound applied effect, and they tell the
Keeper to apply one with `state.exceptional_effect`. The remedy listed four of
the nine arguments that operation requires -- `action`, `source_roll_id`,
`decision_id`, `effect_kind` -- and stopped.

So a Keeper following it exactly still failed. `direction`,
`player_visible_impact`, `causal_link` and above all `boundary`, whose closed
shape it could not guess, were missing. Measured 2026-09-02 r55: the Keeper
tried three times, never sent a boundary, and the turn could be neither
journaled nor finalized -- the lane spent 645 seconds without closing.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import coc_exceptional_effects  # noqa: E402
import coc_starter  # noqa: E402
import coc_toolbox  # noqa: E402

TURN_OUTPUT = SCRIPTS / "coc_operation_turn_output.py"
FINALIZATION = SCRIPTS / "coc_turn_finalization.py"


@pytest.fixture
def campaign_ws(tmp_path: Path):
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    coc_root.mkdir(parents=True)
    (coc_root / "runtime.json").write_text(
        json.dumps({
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        }),
        encoding="utf-8",
    )
    campaign_id = "exceptional-remedy-test"
    coc_starter.quick_start(
        coc_root, "the-haunting", "thomas-hayes",
        campaign_id=campaign_id, title="Exceptional Remedy",
    )
    return {"workspace": workspace, "campaign_id": campaign_id}


def test_the_remedy_names_every_argument_the_operation_requires(campaign_ws):
    """Built from the remedy's own vocabulary, the call must get past argument
    validation. Whether the roll exists is a different question and a
    different code -- what must not happen is `invalid_param`.
    """
    settled = coc_toolbox.run_tool(
        "state.exceptional_effect",
        campaign_ws["workspace"], campaign_ws["campaign_id"],
        {
            "action": "apply",
            "decision_id": "remedy-completeness-0001",
            "source_roll_id": "roll-that-does-not-exist",
            "effect_kind": sorted(coc_exceptional_effects.EFFECT_KINDS)[0],
            "direction": sorted(coc_exceptional_effects.DIRECTIONS)[0],
            "visibility": "player_visible",
            "player_visible_impact": "下一次射击更容易命中。",
            "causal_link": "那一击擦空后，你把枪口稳稳对准他。",
            "boundary": {"kind": "until_consumed", "uses": 1},
            "investigator": "thomas-hayes",
        },
    )
    error = settled.get("error") or {}
    assert error.get("code") != "invalid_param", (
        "an argument the remedy does not name is still required: "
        f"{error.get('message')}"
    )


def test_the_structured_remedy_lists_every_required_argument(campaign_ws):
    """Not the prose -- the `details.remedy.also_required` list a caller can
    read programmatically. Checking the file text instead let a truncated list
    pass, because the words still appeared in the sentence beside it."""
    import importlib.util  # noqa: PLC0415

    spec = importlib.util.spec_from_file_location(
        "turn_output_probe", TURN_OUTPUT,
    )
    assert spec is not None and spec.loader is not None
    text = TURN_OUTPUT.read_text(encoding="utf-8")
    start = text.index('details["remedy"] = {')
    block = text[start:text.index("}", text.index("also_required", start))]
    for argument in (
        "decision_id", "effect_kind", "direction",
        "player_visible_impact", "causal_link", "boundary",
    ):
        assert f'"{argument}"' in block, (argument, block[:400])


def test_both_refusals_name_the_same_complete_set():
    """The sentence exists twice -- state.journal's and turn.finalize's -- and
    they drifted apart once already."""
    named = ("decision_id", "effect_kind", "direction",
             "player_visible_impact", "causal_link", "boundary")
    for path in (TURN_OUTPUT, FINALIZATION):
        text = " ".join(path.read_text(encoding="utf-8").split())
        for argument in named:
            assert argument in text, (path.name, argument)


def test_the_remedy_reads_its_vocabularies_from_the_enforcing_module():
    """Hand-copied enums drift from the validator that rejects them. The
    accepted values must come from `coc_exceptional_effects` itself."""
    text = TURN_OUTPUT.read_text(encoding="utf-8")
    assert "coc_exceptional_effects.EFFECT_KINDS" in text
    assert "coc_exceptional_effects.DIRECTIONS" in text
    assert "coc_exceptional_effects.VISIBILITIES" in text
    # ...and the boundary shapes, which are structural rather than a flat enum,
    # must at least cover every kind the validator accepts.
    for kind in coc_exceptional_effects.BOUNDARY_KINDS:
        assert kind in text, kind
