"""NPC reaction openings — the hook that points at the moment banter belongs."""
from __future__ import annotations

import importlib.util
import json
import sys

import pytest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))


def _load(name: str, rel: Path):
    spec = importlib.util.spec_from_file_location(name, rel)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


nc = _load("coc_narration_contract_npc", SCRIPTS / "coc_narration_contract.py")

_FAILED = {
    "roll_id": "r1", "skill": "Listen", "kind": "skill", "outcome": "failure",
    "passed": False, "base_target": 44, "roll": 75,
    "required_level": "regular", "visibility": "public",
}


def test_a_failed_public_check_in_front_of_an_npc_is_an_opening():
    """`style_commitments` told the Keeper banter was allowed and never when.

    Every turn already carries "情境允许时保留桌边调侃" -- verified live, 276
    times across the preserved corpus. What it never did was point at the
    situation, leaving the Keeper to notice the moment unaided while also
    composing the turn.
    """
    openings = nc._failed_public_check_reactions([dict(_FAILED)], ["npc:kauffman"])
    assert len(openings) == 1
    assert openings[0]["skill"] == "Listen"
    assert openings[0]["witness_npc_ids"] == ["npc:kauffman"]


def test_it_stays_shut_when_nothing_was_watched():
    """Three ways there is no moment, and each has to be checked separately."""
    passed = {**_FAILED, "outcome": "regular_success", "passed": True, "roll": 20}
    assert nc._failed_public_check_reactions([passed], ["npc:kauffman"]) == [], (
        "a success is not a moment for ribbing"
    )
    concealed = {**_FAILED, "visibility": "keeper_only", "hidden": True}
    assert nc._failed_public_check_reactions([concealed], ["npc:kauffman"]) == [], (
        "a concealed roll is not something anyone at the table watched"
    )
    assert nc._failed_public_check_reactions([dict(_FAILED)], []) == [], (
        "an empty room has nobody to react"
    )


def test_the_hook_supplies_no_line_tone_or_phrase():
    """Advisory means naming the moment, not writing the reaction.

    A phrase list here would be the matcher T4 deleted, wearing a new name, and
    it would make every NPC in the game mock the same way.
    """
    opening = nc._failed_public_check_reactions([dict(_FAILED)], ["npc:kauffman"])[0]
    assert set(opening) == {"roll_id", "skill", "outcome", "witness_npc_ids"}, (
        f"the hook grew a field that suggests what to say: {sorted(opening)}"
    )


def test_every_present_npc_is_offered_not_one_chosen():
    """Which NPC reacts, or whether any does, is the Keeper's judgment."""
    openings = nc._failed_public_check_reactions(
        [dict(_FAILED)], ["npc:kauffman", "npc:corbitt"],
    )
    assert openings[0]["witness_npc_ids"] == ["npc:kauffman", "npc:corbitt"]


# ---------------------------------------------------------------------------
# Rapport: how well this NPC knows the table, at the moment of writing
# ---------------------------------------------------------------------------

def test_present_npc_ids_are_read_from_where_the_envelope_puts_them():
    """The envelope nests them under `state_grounding`, not at top level.

    A reader that guesses the wrong container returns an empty list and the
    whole feature silently does nothing -- the failure mode this session has
    hit twice already, once in a fixture that patched the wrong module and once
    here on the first attempt.
    """
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "coc_toolbox_rapport", SCRIPTS / "coc_toolbox.py"
    )
    toolbox = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(toolbox)
    turn_output = sys.modules[
        toolbox.TOOLS["narration.brief"]["handler"].__module__
    ]

    nested = {"state_grounding": {"present_npc_ids": ["npc:dooley", "npc:ruth"]}}
    assert turn_output._envelope_present_npc_ids(nested) == [
        "npc:dooley", "npc:ruth",
    ]
    assert turn_output._envelope_present_npc_ids({}) == []
    assert turn_output._envelope_present_npc_ids(
        {"state_grounding": {}, "present_npc_ids": ["npc:knott"]}
    ) == ["npc:knott"], "a top-level list is still honoured as a fallback"


# ---------------------------------------------------------------------------
# Beat frame: what is this beat FOR
# ---------------------------------------------------------------------------

def test_the_beat_vocabulary_is_laws_nine_with_a_citable_origin():
    """Nine types in three families, cited rather than invented.

    Almost every craft node in this graph carries `origin:
    unknown-legacy-tuning` -- a value somebody tuned once and nobody can now
    justify. This one has a source that predates the project by fifteen years
    and is checkable outside it, which is the difference between doctrine and
    taste.
    """
    import json

    graph = json.loads(
        (REPO / "plugins" / "coc-keeper" / "references" / "text-graph.json")
        .read_text(encoding="utf-8")
    )
    beats = [row for row in graph["nodes"] if row["node_kind"] == "beat-type"]
    assert len(beats) == 9, [row["node_id"] for row in beats]

    families = {row["properties"]["family"] for row in beats}
    assert families == {"substantive", "mood", "expository"}

    for row in beats:
        assert row["origin"] == "robin-laws-hamlets-hit-points-2010", row["node_id"]
        assert row["falsifiable_by"].strip(), row["node_id"]


def test_the_levity_dial_is_the_pair_that_makes_this_worth_carrying():
    """`gratification` and `bringdown` are why the beat frame exists.

    A collected library of witty lines cannot tell these apart, because the
    question is timing rather than material -- the same line lands in one and
    grates in the other.
    """
    import coc_text_runtime

    beats = coc_text_runtime.craft()["beat_types"]
    assert beats["gratification"]["family"] == "mood"
    assert beats["bringdown"]["family"] == "mood"
    assert "levity" in beats["gratification"]["rationale"]


def test_the_frame_reaches_the_keeper_and_supplies_no_line():
    """Delivered where the craft vocabulary already arrives, carrying no quip."""
    import coc_narration_style

    frame = coc_narration_style.player_facing_style_contract("zh-Hans")["beat_frame"]
    assert set(frame) == {"types", "instruction", "play_register", "registers"}, (
        "the frame grew a key; if it is a suggested line or a quota, it does "
        "not belong here"
    )
    assert len(frame["types"]) == 9
    assert "not a quota" in frame["instruction"], (
        "the instruction has to say most beats want no joke, or it reads as a "
        "demand for one every turn"
    )


# ---------------------------------------------------------------------------
# Play register: the baseline a beat is read against
# ---------------------------------------------------------------------------

def test_the_registers_are_chaosium_s_two_named_styles():
    """Purist and Pulp, cited. Pulp Cthulhu is a Chaosium supplement."""
    import coc_text_runtime

    registers = coc_text_runtime.craft()["play_registers"]
    assert set(registers) == {"purist", "pulp"}
    assert "dread" in registers["purist"]
    assert "action" in registers["pulp"]


def test_an_undeclared_register_stays_undeclared():
    """The core rulebook supports the range between the poles.

    Defaulting to one would tell the Keeper this table chose a register it
    never chose -- worse than telling it nothing, because it reads as authored
    intent. A campaign that has not picked does not get a pole invented for it,
    and the field is absent from campaign.json rather than present-and-guessed.
    """
    import coc_narration_style
    import coc_state
    import tempfile
    from pathlib import Path as _Path

    frame = coc_narration_style.player_facing_style_contract("zh-Hans")["beat_frame"]
    assert frame["play_register"] == "undeclared"

    root = _Path(tempfile.mkdtemp())
    coc_state.ensure_workspace(root)
    coc_state.create_campaign(root, "plain", "Plain")
    coc_state.create_campaign(root, "pulpy", "Pulpy", play_register="pulp")
    plain = json.loads(
        (root / ".coc" / "campaigns" / "plain" / "campaign.json").read_text("utf-8")
    )
    pulpy = json.loads(
        (root / ".coc" / "campaigns" / "pulpy" / "campaign.json").read_text("utf-8")
    )
    assert "play_register" not in plain
    assert pulpy["play_register"] == "pulp"


def test_a_declared_register_reaches_the_beat_frame():
    """The register and the beat frame travel together or neither is usable.

    A beat type without a register is a question with no baseline: the same
    wisecrack is the wrong game in Purist and the point in Pulp.
    """
    import coc_narration_style

    for register in ("purist", "pulp"):
        frame = coc_narration_style.player_facing_style_contract(
            "zh-Hans", play_register=register,
        )["beat_frame"]
        assert frame["play_register"] == register
        assert set(frame["registers"]) == {"purist", "pulp"}
        assert len(frame["types"]) == 9


# ---------------------------------------------------------------------------
# The projection whitelist: an operation can return a field the model never sees
# ---------------------------------------------------------------------------

def test_banter_signals_survive_the_wire_projection():
    """`turn.output_context`'s model projection is built field by field.

    Anything the operation adds and nobody registers in `coc_mcp_wire` is
    dropped between the operation and the model, silently and with the
    operation still returning `ok: true`. Three signals were written, unit
    tested, and delivered into a payload that discarded them; a live run showed
    `coc_turn_output_context` returning 10544 bytes with `obligations` present
    and `banter_signals` absent.

    This asserts the projection carries it, which no unit test of the operation
    itself can catch.
    """
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "coc_mcp_wire_banter", SCRIPTS / "coc_mcp_wire.py"
    )
    wire = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(wire)

    source = (SCRIPTS / "coc_mcp_wire.py").read_text(encoding="utf-8")
    assert '"banter_signals" in value' in source, (
        "the field is not registered in the output_context projection; the "
        "operation will return it and the model will never see it"
    )


def test_play_register_has_a_model_facing_entrance(tmp_path):
    """A field only settable from Python is a field no table can choose.

    `play_language` had exactly this gap and it blocked TextGraph T5's live
    gate; `localized_terms` had it and stayed empty across 249 campaigns. The
    register would have been the third: threaded through create_campaign,
    delivered to the Keeper, and unreachable by anything the Keeper could call.
    """
    import coc_runtime_ops
    import coc_state

    coc_state.ensure_workspace(tmp_path)
    coc_runtime_ops.execute_setup_operation(
        tmp_path,
        operation={
            "schema_version": 1, "kind": "campaign.create",
            "payload": {
                "campaign_id": "pulp-table", "title": "T",
                "play_register": "pulp",
            },
        },
    )
    stored = json.loads(
        (tmp_path / ".coc" / "campaigns" / "pulp-table" / "campaign.json")
        .read_text(encoding="utf-8")
    )
    assert stored["play_register"] == "pulp"


def test_an_unknown_register_is_refused_with_the_choices_named(tmp_path):
    """`gritty` is a reasonable-sounding register this game does not have.

    Silently accepting it would persist a value nothing reads, and the Keeper
    would be handed a register that means nothing. The error names the two real
    ones and says omitting is allowed.
    """
    import coc_runtime_ops
    import coc_state

    coc_state.ensure_workspace(tmp_path)
    with pytest.raises(Exception, match="play_register must be one of"):
        coc_runtime_ops.execute_setup_operation(
            tmp_path,
            operation={
                "schema_version": 1, "kind": "campaign.create",
                "payload": {
                    "campaign_id": "bad", "title": "T", "play_register": "gritty",
                },
            },
        )
