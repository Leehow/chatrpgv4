"""Acceptance tests for persistent session rulings.

Built against `plugins/coc-keeper/scripts/coc_session_rulings.py` and
`docs/specs/pi-coc-rule-override-and-session-rulings.md` §3.3, §4 and §7.

Three properties are what this suite exists to hold, and each of them is a
property a future refactor can quietly lose:

* **Expiry is arithmetic, not interpretation** (§4.2). Scope and expiry are
  computed from the scene and session records. Nothing may be inferred from
  what a ruling *says* — see `test_prose_fields_are_carried_never_matched`.
* **A ruling is precedent, never authority over results** (§3.3). Recording
  and retrieving a ruling may not touch any other campaign file.
* **An earlier ruling is the record of what the table was told.** A second
  ruling with the same id and different content is refused, and the stored
  record still holds the original words.

The bar is mutation resistance: removing a check from the module must turn at
least one test here red. Where two checks in the module happen to gate the
same case, a discriminating case is written for each one on purpose; those
tests carry a comment saying which mutation they kill.
"""
from __future__ import annotations

import ast
import importlib.util
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
MODULE_PATH = SCRIPTS / "coc_session_rulings.py"
STATE_PATH = SCRIPTS / "coc_state.py"
COC7_RULESET = ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


assert MODULE_PATH.is_file(), (
    f"{MODULE_PATH} does not exist. This suite tests the real ruling module; "
    "it must not be satisfied by a stub, a fake, or a placeholder."
)
rulings = _load("coc_session_rulings_under_test", MODULE_PATH)
coc_state = _load("coc_state_for_session_rulings_test", STATE_PATH)

MODULE_SOURCE = MODULE_PATH.read_text(encoding="utf-8")
MODULE_TREE = ast.parse(MODULE_SOURCE)


# --------------------------------------------------------------------------
# Contract constants, restated rather than imported.
#
# Reading these from the module would let a change to its own tables
# re-baseline the test that is supposed to police them.
# --------------------------------------------------------------------------

EXPECTED_CONTRACT_ID = "coc.session-rulings.v1"
EXPECTED_SCHEMA_VERSION = 1
EXPECTED_DOCUMENT_NAME = "session-rulings.json"

EXPECTED_RULING_FIELDS = frozenset({
    "ruling_id",
    "decision_ref",
    "scope_kind",
    "scope_id",
    "expires",
    "statement",
    "reason",
    "bound_scene_id",
    "bound_session_seq",
    "source_turn",
    "superseded_by",
})

EXPECTED_ALLOWED_EXPIRIES = {
    "scene": frozenset({"scene_end", "session_end"}),
    "session": frozenset({"session_end"}),
    "campaign": frozenset({"never"}),
}

EXPECTED_SCOPE_KINDS = ("scene", "session", "campaign")
EXPECTED_EXPIRIES = ("scene_end", "session_end", "never")

ILLEGAL_PAIRINGS = tuple(
    (scope_kind, expires)
    for scope_kind in EXPECTED_SCOPE_KINDS
    for expires in EXPECTED_EXPIRIES
    if expires not in EXPECTED_ALLOWED_EXPIRIES[scope_kind]
)

DECISION = "decision:coc7:push-luck:pushed-roll"
NEAR_MISS_DECISION = "decision:coc7:push-luck:pushed-rolls"
WAREHOUSE = "scene:warehouse"
ALLEY = "scene:alley"

STATEMENT = "A pushed Locksmith roll here costs a round of audible noise."
REASON = "The doors are sheet metal and the corridor carries sound."


# --------------------------------------------------------------------------
# Fixtures and builders
# --------------------------------------------------------------------------

def make_ruling(**overrides):
    """A valid campaign-scoped ruling, overridable field by field."""
    ruling = {
        "ruling_id": "ruling:warehouse-pushed-locksmith-noise",
        "decision_ref": DECISION,
        "scope_kind": "campaign",
        "scope_id": None,
        "expires": "never",
        "statement": STATEMENT,
        "reason": REASON,
        "bound_scene_id": None,
        "bound_session_seq": 1,
        "source_turn": 83,
        "superseded_by": None,
    }
    ruling.update(overrides)
    return ruling


def scene_ruling(**overrides):
    return make_ruling(**{
        "ruling_id": "ruling:warehouse-noise",
        "scope_kind": "scene",
        "scope_id": WAREHOUSE,
        "expires": "scene_end",
        "bound_scene_id": WAREHOUSE,
        **overrides,
    })


def session_ruling(**overrides):
    return make_ruling(**{
        "ruling_id": "ruling:tonight-house-lights",
        "scope_kind": "session",
        "scope_id": None,
        "expires": "session_end",
        "bound_session_seq": 1,
        **overrides,
    })


def write_scene(campaign_dir: Path, scene_id):
    payload = {
        "schema_version": 1,
        "campaign_id": campaign_dir.name,
        "scenario_id": None,
        "scene_id": scene_id,
        "source_event_type": None,
        "summary": "",
        "pending_choices": None,
    }
    path = campaign_dir / "save" / "active-scene.json"
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def write_session_seq(campaign_dir: Path, seq: int):
    path = campaign_dir / "save" / "session-state.json"
    path.write_text(
        json.dumps({"schema_version": 1, "table_session_seq": seq}, indent=2) + "\n",
        encoding="utf-8",
    )


@pytest.fixture()
def campaign(tmp_path):
    """A minimal campaign directory carrying a scene and a session record."""
    campaign_dir = tmp_path / "warehouse-case"
    (campaign_dir / "save").mkdir(parents=True)
    write_scene(campaign_dir, WAREHOUSE)
    write_session_seq(campaign_dir, 1)
    return campaign_dir


def snapshot(directory: Path, *, exclude=()):
    return {
        str(path.relative_to(directory)): path.read_bytes()
        for path in sorted(directory.rglob("*"))
        if path.is_file() and path.name not in exclude
    }


def stored(campaign_dir: Path):
    return json.loads(
        (campaign_dir / "save" / EXPECTED_DOCUMENT_NAME).read_text(encoding="utf-8")
    )


# --------------------------------------------------------------------------
# 0. The contract itself
# --------------------------------------------------------------------------

def test_contract_constants_match_the_specification():
    assert rulings.CONTRACT_ID == EXPECTED_CONTRACT_ID
    assert rulings.SCHEMA_VERSION == EXPECTED_SCHEMA_VERSION
    assert rulings.DOCUMENT_NAME == EXPECTED_DOCUMENT_NAME
    assert set(rulings.RULING_FIELDS) == set(EXPECTED_RULING_FIELDS)
    assert tuple(rulings.SCOPE_KINDS) == EXPECTED_SCOPE_KINDS
    assert tuple(rulings.EXPIRIES) == EXPECTED_EXPIRIES


def test_allowed_expiry_table_matches_the_specification():
    """Pinned so widening the table is a visible edit, not a silent one."""
    actual = {kind: frozenset(value)
              for kind, value in rulings._ALLOWED_EXPIRIES.items()}
    assert actual == EXPECTED_ALLOWED_EXPIRIES


def test_new_document_is_an_empty_ruling_document():
    document = rulings.new_document("warehouse-case")
    assert document == {
        "contract_id": EXPECTED_CONTRACT_ID,
        "schema_version": EXPECTED_SCHEMA_VERSION,
        "campaign_id": "warehouse-case",
        "rulings": [],
    }


# --------------------------------------------------------------------------
# 1. Record and replay
# --------------------------------------------------------------------------

def test_recording_a_ruling_persists_it(campaign):
    result = rulings.record_ruling(campaign, make_ruling())

    assert result["recorded"] is True
    document = stored(campaign)
    assert document["contract_id"] == EXPECTED_CONTRACT_ID
    assert document["schema_version"] == EXPECTED_SCHEMA_VERSION
    assert [row["ruling_id"] for row in document["rulings"]] == [
        "ruling:warehouse-pushed-locksmith-noise"
    ]
    assert document["rulings"][0] == make_ruling()


def test_byte_equal_replay_does_not_duplicate(campaign):
    rulings.record_ruling(campaign, make_ruling())
    before = (campaign / "save" / EXPECTED_DOCUMENT_NAME).read_bytes()

    replay = rulings.record_ruling(campaign, make_ruling())

    assert replay["recorded"] is False
    assert replay["reason"] == "replay"
    assert (campaign / "save" / EXPECTED_DOCUMENT_NAME).read_bytes() == before
    assert len(stored(campaign)["rulings"]) == 1


def test_same_id_with_different_content_is_refused_and_the_original_stands(campaign):
    """An earlier ruling is the record of what the table was told.

    Kills the mutation that makes `record_ruling` overwrite on conflict.
    """
    rulings.record_ruling(campaign, make_ruling())

    rewritten = make_ruling(
        statement="A pushed Locksmith roll here is free.",
        reason="Rewriting history.",
        source_turn=140,
    )
    with pytest.raises(rulings.SessionRulingError) as excinfo:
        rulings.record_ruling(campaign, rewritten)
    assert "supersede" in str(excinfo.value)

    document = stored(campaign)
    assert len(document["rulings"]) == 1
    assert document["rulings"][0]["statement"] == STATEMENT
    assert document["rulings"][0]["reason"] == REASON
    assert document["rulings"][0]["source_turn"] == 83


def test_a_second_ruling_on_the_same_decision_is_recorded_beside_the_first(campaign):
    rulings.record_ruling(campaign, make_ruling())
    rulings.record_ruling(campaign, make_ruling(
        ruling_id="ruling:warehouse-second-thought", source_turn=91
    ))
    assert len(stored(campaign)["rulings"]) == 2


def test_recording_does_not_mutate_the_callers_dict(campaign):
    original = make_ruling()
    handed_over = make_ruling()
    rulings.record_ruling(campaign, handed_over)
    assert handed_over == original


# --------------------------------------------------------------------------
# 2. Validation — one test per rejection
# --------------------------------------------------------------------------

def test_reject_unknown_field():
    ruling = make_ruling(house_rule=True)
    with pytest.raises(rulings.SessionRulingError) as excinfo:
        rulings.validate_ruling(ruling)
    assert "house_rule" in str(excinfo.value)


def test_reject_missing_field():
    ruling = make_ruling()
    del ruling["reason"]
    with pytest.raises(rulings.SessionRulingError) as excinfo:
        rulings.validate_ruling(ruling)
    assert "reason" in str(excinfo.value)


@pytest.mark.parametrize("bad_id", [
    "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "ruling:9F86D081884C7D659A2FEAA0C55AD015",
    "ruling:Warehouse-Noise",
    "warehouse-noise",
    "ruling:",
    "ruling:warehouse noise",
    "ruling:warehouse_noise",
])
def test_reject_ruling_id_that_is_not_a_semantic_id(bad_id):
    """The Model-Facing Identifier Law: a ruling id is read and echoed by a
    model, so a digest shape is mis-transcribed and must not be accepted."""
    with pytest.raises(rulings.SessionRulingError) as excinfo:
        rulings.validate_ruling(make_ruling(ruling_id=bad_id))
    assert "ruling_id" in str(excinfo.value)


def test_reject_prefixed_hex_digest_ruling_id():
    """A digest wearing the `ruling:` prefix is still a digest.

    This was a real hole: the first grammar was
    `ruling:[a-z0-9]+(-[a-z0-9]+)*`, and a lowercase hex digest is entirely
    `[a-z0-9]`, so the exact shape the Model-Facing Identifier Law exists to
    exclude walked straight through the check meant to exclude it. Requiring
    at least two hyphen-separated capped segments closes it.

    What this test does NOT prove: a digest chopped into hyphenated runs still
    parses, and no grammar will stop that. The real guarantee is architectural
    -- code generates and verifies digests and never asks a model to relay one.
    """
    with pytest.raises(rulings.SessionRulingError):
        rulings.validate_ruling(make_ruling(
            ruling_id=(
                "ruling:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15"
            )
        ))


@pytest.mark.parametrize("bad_ref", [
    "push-luck",
    "decision",
    "decision:",
    "rule:coc7:push-luck:pushed-roll",
    "decision:coc7",
    "decision:coc7:Pushed-Roll",
])
def test_reject_decision_ref_that_is_not_a_decision_id(bad_ref):
    with pytest.raises(rulings.SessionRulingError) as excinfo:
        rulings.validate_ruling(make_ruling(decision_ref=bad_ref))
    assert "decision_ref" in str(excinfo.value)


def test_reject_decision_ref_that_names_no_decision_in_the_graph():
    """Well-formed but unknown: a ruling that cannot name an existing decision
    is unretrievable by construction, because retrieval is keyed on the
    decision and never on prose similarity."""
    known = frozenset({DECISION})
    rulings.validate_ruling(make_ruling(), known_decision_ids=known)

    with pytest.raises(rulings.SessionRulingError) as excinfo:
        rulings.validate_ruling(
            make_ruling(decision_ref="decision:coc7:invented:not-a-decision"),
            known_decision_ids=known,
        )
    message = str(excinfo.value)
    assert "names no decision" in message


def test_real_ruleset_decision_ids_are_accepted_by_the_grammar():
    """The grammar is checked against the production graph, not a fixture, so
    a ruling can actually bind to a decision the Keeper will reach."""
    known = rulings.decision_ids_for_ruleset(COC7_RULESET)
    assert known, "the coc7 rule graph declared no decision nodes"
    for decision_ref in sorted(known):
        rulings.validate_ruling(
            make_ruling(decision_ref=decision_ref), known_decision_ids=known
        )


@pytest.mark.parametrize("scope_kind,expires", ILLEGAL_PAIRINGS)
def test_reject_illegal_scope_and_expiry_pairing(scope_kind, expires):
    """Kills the mutation that drops the `_ALLOWED_EXPIRIES` check."""
    if scope_kind == "scene":
        ruling = scene_ruling(expires=expires)
    else:
        ruling = make_ruling(scope_kind=scope_kind, scope_id=None, expires=expires)
    with pytest.raises(rulings.SessionRulingError) as excinfo:
        rulings.validate_ruling(ruling)
    message = str(excinfo.value)
    assert scope_kind in message and expires in message


@pytest.mark.parametrize("scope_kind,expires", [
    ("scene", "scene_end"),
    ("scene", "session_end"),
    ("session", "session_end"),
    ("campaign", "never"),
])
def test_every_legal_scope_and_expiry_pairing_is_accepted(scope_kind, expires):
    if scope_kind == "scene":
        ruling = scene_ruling(expires=expires)
    else:
        ruling = make_ruling(scope_kind=scope_kind, scope_id=None, expires=expires)
    assert rulings.validate_ruling(ruling) == ruling


def test_reject_campaign_scope_carrying_a_scope_id():
    with pytest.raises(rulings.SessionRulingError) as excinfo:
        rulings.validate_ruling(make_ruling(scope_id=WAREHOUSE))
    assert "scope_id" in str(excinfo.value)


def test_reject_session_scope_carrying_a_scope_id():
    """`scope_id` names the scene and nothing else. A session-scoped ruling is
    pinned by `bound_session_seq`; a second encoding of the session would let
    one record disagree with itself."""
    with pytest.raises(rulings.SessionRulingError) as excinfo:
        rulings.validate_ruling(session_ruling(scope_id="1"))
    assert "scope_id" in str(excinfo.value)


def test_reject_scene_scope_without_a_scope_id():
    with pytest.raises(rulings.SessionRulingError) as excinfo:
        rulings.validate_ruling(scene_ruling(scope_id=None))
    assert "scope_id" in str(excinfo.value)


@pytest.mark.parametrize("bound", [None, ""])
def test_reject_scene_scope_without_a_bound_scene_id(bound):
    with pytest.raises(rulings.SessionRulingError) as excinfo:
        rulings.validate_ruling(scene_ruling(bound_scene_id=bound))
    assert "scene" in str(excinfo.value)


def test_reject_self_superseding_ruling():
    ruling = make_ruling()
    with pytest.raises(rulings.SessionRulingError) as excinfo:
        rulings.validate_ruling(make_ruling(superseded_by=ruling["ruling_id"]))
    assert "supersede itself" in str(excinfo.value)


def test_reject_superseded_by_that_is_not_a_ruling_id():
    with pytest.raises(rulings.SessionRulingError) as excinfo:
        rulings.validate_ruling(make_ruling(superseded_by="the-next-one"))
    assert "superseded_by" in str(excinfo.value)


def test_reject_negative_source_turn():
    with pytest.raises(rulings.SessionRulingError) as excinfo:
        rulings.validate_ruling(make_ruling(source_turn=-1))
    assert "source_turn" in str(excinfo.value)


@pytest.mark.parametrize("field", ["source_turn", "bound_session_seq"])
def test_reject_boolean_where_an_integer_is_required(field):
    """`True` is an int in Python; accepting it would store a flag as a turn."""
    with pytest.raises(rulings.SessionRulingError) as excinfo:
        rulings.validate_ruling(make_ruling(**{field: True}))
    assert field in str(excinfo.value)


@pytest.mark.parametrize("field", ["statement", "reason"])
@pytest.mark.parametrize("value", ["", "   ", None, 7])
def test_reject_empty_prose(field, value):
    """Prose is never matched, but it must be there — a ruling with no
    statement is a precedent nobody can read."""
    with pytest.raises(rulings.SessionRulingError) as excinfo:
        rulings.validate_ruling(make_ruling(**{field: value}))
    assert field in str(excinfo.value)


def test_reject_non_object_ruling():
    with pytest.raises(rulings.SessionRulingError):
        rulings.validate_ruling(["ruling:warehouse-noise"])


def test_record_refuses_an_invalid_ruling_without_creating_a_document(campaign):
    with pytest.raises(rulings.SessionRulingError):
        rulings.record_ruling(campaign, make_ruling(source_turn=-1))
    assert not (campaign / "save" / EXPECTED_DOCUMENT_NAME).exists()


# --------------------------------------------------------------------------
# 3. Expiry is arithmetic
# --------------------------------------------------------------------------

def test_scene_end_ruling_is_live_in_its_scene_gone_after_it_and_back_on_return(
    campaign,
):
    rulings.record_ruling(campaign, scene_ruling())
    ids = lambda: [row["ruling_id"] for row in
                   rulings.rulings_for_decision(campaign, DECISION)]

    assert ids() == ["ruling:warehouse-noise"]

    write_scene(campaign, ALLEY)
    assert ids() == []

    # Bound to the scene, not consumed by leaving it.
    write_scene(campaign, WAREHOUSE)
    assert ids() == ["ruling:warehouse-noise"]


def test_scene_end_ruling_dies_when_the_session_rolls_over_only_via_its_scene(
    campaign,
):
    rulings.record_ruling(campaign, scene_ruling())
    write_session_seq(campaign, 2)
    # Its expiry is the scene, not the session: still live in its own scene.
    assert len(rulings.rulings_for_decision(campaign, DECISION)) == 1


def test_a_scene_scoped_ruling_that_expires_at_session_end_dies_with_the_session(
    campaign,
):
    """The discriminating case for the `session_end` arithmetic.

    A session-scoped ruling is gated twice — by `expires` and again by its
    scope — so removing either check leaves it answering the same. Only a
    ruling whose scope is the scene and whose expiry is the session can tell
    the two apart: here the scene never changes, so if the `session_end`
    arithmetic goes, this ruling wrongly outlives the table's session.
    """
    ruling = scene_ruling(expires="session_end", bound_session_seq=1)
    rulings.record_ruling(campaign, ruling)
    assert len(rulings.rulings_for_decision(campaign, DECISION)) == 1

    write_session_seq(campaign, 2)
    assert rulings.rulings_for_decision(campaign, DECISION) == []
    # Same scene throughout: the scene is not what ended it.
    assert rulings.is_live(ruling, scene_id=WAREHOUSE, session_seq=1) is True
    assert rulings.is_live(ruling, scene_id=WAREHOUSE, session_seq=2) is False
    assert rulings.is_live(ruling, scene_id=WAREHOUSE, session_seq=None) is False


def test_session_end_ruling_survives_a_scene_change_and_dies_next_session(campaign):
    rulings.record_ruling(campaign, session_ruling())

    write_scene(campaign, ALLEY)
    assert [row["ruling_id"] for row in
            rulings.rulings_for_decision(campaign, DECISION)] == [
        "ruling:tonight-house-lights"
    ]

    write_session_seq(campaign, 2)
    assert rulings.rulings_for_decision(campaign, DECISION) == []


def test_campaign_never_ruling_survives_both_a_scene_and_a_session_change(campaign):
    rulings.record_ruling(campaign, make_ruling())

    write_scene(campaign, ALLEY)
    write_session_seq(campaign, 7)
    assert [row["ruling_id"] for row in
            rulings.rulings_for_decision(campaign, DECISION)] == [
        "ruling:warehouse-pushed-locksmith-noise"
    ]


@pytest.mark.parametrize("scene_id", [WAREHOUSE, ALLEY, None])
@pytest.mark.parametrize("session_seq", [1, 2, None])
def test_a_superseded_ruling_is_never_live(scene_id, session_seq):
    """Kills the mutation that makes `is_live` ignore `superseded_by`."""
    for builder in (make_ruling, scene_ruling, session_ruling):
        ruling = builder(superseded_by="ruling:the-later-one")
        assert rulings.is_live(
            ruling, scene_id=scene_id, session_seq=session_seq
        ) is False


def test_superseding_a_recorded_ruling_removes_it_from_retrieval(campaign):
    rulings.record_ruling(campaign, make_ruling())
    rulings.record_ruling(campaign, make_ruling(
        ruling_id="ruling:warehouse-quiet-doors", source_turn=120
    ))

    rulings.supersede_ruling(
        campaign,
        ruling_id="ruling:warehouse-pushed-locksmith-noise",
        superseded_by="ruling:warehouse-quiet-doors",
    )

    assert [row["ruling_id"] for row in
            rulings.rulings_for_decision(campaign, DECISION)] == [
        "ruling:warehouse-quiet-doors"
    ]
    # Never deleted: the record of what the table was told stays on disk.
    assert len(stored(campaign)["rulings"]) == 2


def test_supersede_is_idempotent_and_refuses_a_second_successor(campaign):
    rulings.record_ruling(campaign, make_ruling())
    first = rulings.supersede_ruling(
        campaign,
        ruling_id="ruling:warehouse-pushed-locksmith-noise",
        superseded_by="ruling:warehouse-quiet-doors",
    )
    assert first["changed"] is True
    again = rulings.supersede_ruling(
        campaign,
        ruling_id="ruling:warehouse-pushed-locksmith-noise",
        superseded_by="ruling:warehouse-quiet-doors",
    )
    assert again["changed"] is False
    with pytest.raises(rulings.SessionRulingError):
        rulings.supersede_ruling(
            campaign,
            ruling_id="ruling:warehouse-pushed-locksmith-noise",
            superseded_by="ruling:warehouse-third-thought",
        )


def test_scene_scope_is_checked_independently_of_scene_end_expiry():
    """Two separate gates, two discriminating cases.

    A scene-scoped ruling that expires at *session* end still only applies in
    its own scene — that case dies if the `scope_kind == "scene"` check goes.
    A ruling bound to a scene it no longer names dies at scene end — that case
    dies if the `expires == "scene_end"` arithmetic goes.
    """
    scope_only = scene_ruling(expires="session_end", bound_session_seq=1)
    rulings.validate_ruling(scope_only)
    assert rulings.is_live(scope_only, scene_id=WAREHOUSE, session_seq=1) is True
    assert rulings.is_live(scope_only, scene_id=ALLEY, session_seq=1) is False

    expiry_only = scene_ruling(
        ruling_id="ruling:library-noise", bound_scene_id=ALLEY
    )
    rulings.validate_ruling(expiry_only)
    # Scope says warehouse and it is the warehouse, but the scene it was bound
    # to has ended, so it is gone.
    assert rulings.is_live(expiry_only, scene_id=WAREHOUSE, session_seq=1) is False


def test_session_scope_is_checked_independently_of_session_end_expiry():
    """Kills the mutation that drops the `scope_kind == "session"` branch, and
    the one that makes it fall back to `scope_id`.

    `expires` is deliberately "never" here so only the scope branch can
    answer. That combination is not recordable — `_ALLOWED_EXPIRIES` refuses
    it — but `is_live` is a pure function and its arithmetic is the thing
    under test.
    """
    ruling = session_ruling(expires="never", bound_session_seq=4)
    assert rulings.is_live(ruling, scene_id=WAREHOUSE, session_seq=4) is True
    assert rulings.is_live(ruling, scene_id=WAREHOUSE, session_seq=5) is False
    assert rulings.is_live(ruling, scene_id=WAREHOUSE, session_seq=None) is False

    # A recordable session ruling dies with its session, whatever the scene.
    recordable = session_ruling(bound_session_seq=4)
    rulings.validate_ruling(recordable)
    assert rulings.is_live(recordable, scene_id=ALLEY, session_seq=4) is True
    assert rulings.is_live(recordable, scene_id=ALLEY, session_seq=5) is False


def test_a_scene_end_ruling_is_not_live_when_there_is_no_scene():
    assert rulings.is_live(
        scene_ruling(), scene_id=None, session_seq=1
    ) is False


# --------------------------------------------------------------------------
# 4. Retrieval is keyed on the decision
# --------------------------------------------------------------------------

def test_rulings_for_decision_never_bleeds_across_decisions(campaign):
    rulings.record_ruling(campaign, make_ruling(
        ruling_id="ruling:on-the-decision", source_turn=10
    ))
    rulings.record_ruling(campaign, make_ruling(
        ruling_id="ruling:on-a-near-miss",
        decision_ref=NEAR_MISS_DECISION,
        source_turn=99,
    ))

    assert [row["ruling_id"] for row in
            rulings.rulings_for_decision(campaign, DECISION)] == [
        "ruling:on-the-decision"
    ]
    assert [row["ruling_id"] for row in
            rulings.rulings_for_decision(campaign, NEAR_MISS_DECISION)] == [
        "ruling:on-a-near-miss"
    ]
    assert rulings.rulings_for_decision(
        campaign, "decision:coc7:push-luck:pushed"
    ) == []
    # Both are still live; the filter is the decision, not liveness.
    assert len(rulings.live_rulings(campaign)) == 2


def test_rulings_for_decision_orders_most_recent_turn_first(campaign):
    # Ids are chosen so alphabetical order is not turn order: sorting by id
    # alone, or storage order alone, gives a different answer.
    rulings.record_ruling(campaign, make_ruling(
        ruling_id="ruling:aaa-early", source_turn=10
    ))
    rulings.record_ruling(campaign, make_ruling(
        ruling_id="ruling:zzz-late", source_turn=200
    ))
    rulings.record_ruling(campaign, make_ruling(
        ruling_id="ruling:mmm-middle", source_turn=50
    ))

    assert [row["ruling_id"] for row in
            rulings.rulings_for_decision(campaign, DECISION)] == [
        "ruling:zzz-late",
        "ruling:mmm-middle",
        "ruling:aaa-early",
    ]


def test_rulings_on_the_same_turn_break_the_tie_deterministically(campaign):
    for ruling_id in ("ruling:zulu-call", "ruling:alpha-call", "ruling:mike-call"):
        rulings.record_ruling(campaign, make_ruling(
            ruling_id=ruling_id, source_turn=42
        ))

    order = [row["ruling_id"] for row in
             rulings.rulings_for_decision(campaign, DECISION)]
    assert order == ["ruling:alpha-call", "ruling:mike-call", "ruling:zulu-call"]
    assert order == [row["ruling_id"] for row in
                     rulings.rulings_for_decision(campaign, DECISION)]


def test_retrieval_on_an_absent_document_is_empty_not_an_error(campaign):
    assert rulings.rulings_for_decision(campaign, DECISION) == []
    assert rulings.live_rulings(campaign) == []
    assert not (campaign / "save" / EXPECTED_DOCUMENT_NAME).exists()


# --------------------------------------------------------------------------
# 5. Reading from campaign state
# --------------------------------------------------------------------------

def test_defaults_are_read_from_campaign_records(campaign):
    write_scene(campaign, WAREHOUSE)
    write_session_seq(campaign, 3)
    rulings.record_ruling(campaign, scene_ruling())
    rulings.record_ruling(campaign, session_ruling(bound_session_seq=3))
    rulings.record_ruling(campaign, make_ruling())

    implicit = rulings.rulings_for_decision(campaign, DECISION)
    explicit = rulings.rulings_for_decision(
        campaign, DECISION, scene_id=WAREHOUSE, session_seq=3
    )
    assert implicit == explicit
    assert len(implicit) == 3

    # And a caller who passes the wrong view gets a different answer, so the
    # equality above is not vacuous.
    wrong = rulings.rulings_for_decision(
        campaign, DECISION, scene_id=ALLEY, session_seq=4
    )
    assert [row["ruling_id"] for row in wrong] == [
        "ruling:warehouse-pushed-locksmith-noise"
    ]


def test_live_rulings_also_defaults_to_campaign_records(campaign):
    write_session_seq(campaign, 3)
    rulings.record_ruling(campaign, session_ruling(bound_session_seq=3))
    assert len(rulings.live_rulings(campaign)) == 1
    write_session_seq(campaign, 4)
    assert rulings.live_rulings(campaign) == []


def test_a_missing_active_scene_degrades_to_no_scene(campaign):
    rulings.record_ruling(campaign, scene_ruling())
    rulings.record_ruling(campaign, make_ruling())
    (campaign / "save" / "active-scene.json").unlink()

    live = rulings.rulings_for_decision(campaign, DECISION)
    assert [row["ruling_id"] for row in live] == [
        "ruling:warehouse-pushed-locksmith-noise"
    ]


@pytest.mark.parametrize("corrupt", [
    "{ not json at all",
    "[]",
    '{"schema_version": 1}',
    '{"scene_id": null}',
    '{"scene_id": 17}',
    "",
])
def test_a_corrupt_active_scene_degrades_to_no_scene_rather_than_raising(
    campaign, corrupt
):
    rulings.record_ruling(campaign, scene_ruling())
    (campaign / "save" / "active-scene.json").write_text(corrupt, encoding="utf-8")

    assert rulings.rulings_for_decision(campaign, DECISION) == []
    assert rulings.live_rulings(campaign) == []


@pytest.mark.parametrize("corrupt", [
    "{ not json at all",
    '{"table_session_seq": "two"}',
    '{"table_session_seq": true}',
    "[]",
])
def test_a_corrupt_session_state_degrades_to_no_session(campaign, corrupt):
    rulings.record_ruling(campaign, session_ruling())
    (campaign / "save" / "session-state.json").write_text(corrupt, encoding="utf-8")

    assert rulings.rulings_for_decision(campaign, DECISION) == []


# --------------------------------------------------------------------------
# 6. Prose isolation
# --------------------------------------------------------------------------

PROSE_FIELDS = ("statement", "reason")

#: Reading prose through any of these is matching, not carrying.
BANNED_CALLS = frozenset({
    "startswith", "endswith", "lower", "upper", "casefold", "title",
    "find", "rfind", "index", "count", "split", "rsplit", "partition",
    "replace", "translate", "encode",
    "match", "fullmatch", "search", "findall", "finditer", "sub", "subn",
    "compile", "escape",
})

PROSE_LAW = (
    "PROSE ISOLATION (spec §4.2, module docstring).\n"
    "`statement` and `reason` are carried for the Keeper to read. They are "
    "never matched, scanned, or compared.\n"
    "Expiry and scope are arithmetic over the scene and session records; the "
    "moment a ruling's own words can change whether it is live, expiry has "
    "become interpretation and two Keepers reading the same record can "
    "disagree about whether it still applies.\n"
    "If you need a new distinction, add a declared field and validate it. Do "
    "not read the sentence."
)


def _parent_map(tree):
    parents = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            parents[child] = node
    return parents


def _ancestors(node, parents):
    while node in parents:
        node = parents[node]
        yield node


def _offence(node):
    if isinstance(node, ast.Compare):
        ops = "".join(type(op).__name__ for op in node.ops)
        return f"compared ({ops})"
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
        if node.func.attr in BANNED_CALLS:
            return f"passed to .{node.func.attr}()"
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
        if node.func.id in BANNED_CALLS:
            return f"passed to {node.func.id}()"
    return None


def _mentions_prose(node):
    return any(
        isinstance(child, ast.Constant) and child.value in PROSE_FIELDS
        for child in ast.walk(node)
    )


def test_prose_fields_are_carried_never_matched():
    parents = _parent_map(MODULE_TREE)
    findings = []

    def check(node, what):
        for ancestor in _ancestors(node, parents):
            if isinstance(ancestor, ast.stmt) and not isinstance(
                ancestor, (ast.Return, ast.Assert, ast.If, ast.While, ast.Raise)
            ):
                break
            offence = _offence(ancestor)
            if offence:
                findings.append(
                    f"line {getattr(node, 'lineno', '?')}: {what} is {offence}"
                    f" -- {ast.get_source_segment(MODULE_SOURCE, ancestor)!r}"
                )
                break

    # Direct reads: ruling["statement"], ruling.get("reason"), "statement" in x
    for node in ast.walk(MODULE_TREE):
        if isinstance(node, ast.Constant) and node.value in PROSE_FIELDS:
            check(node, f"the {node.value!r} field")

    # One hop of taint: `text = ruling["statement"]` then `text.lower()`.
    tainted = set()
    for node in ast.walk(MODULE_TREE):
        if isinstance(node, ast.Assign) and _mentions_prose(node.value):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    tainted.add(target.id)
        if isinstance(node, ast.AnnAssign) and node.value is not None:
            if _mentions_prose(node.value) and isinstance(node.target, ast.Name):
                tainted.add(node.target.id)
    for node in ast.walk(MODULE_TREE):
        if isinstance(node, ast.Name) and node.id in tainted:
            if isinstance(node.ctx, ast.Load):
                check(node, f"prose held in {node.id!r}")

    assert not findings, (
        "A ruling's prose is being read to make a decision:\n  "
        + "\n  ".join(sorted(set(findings)))
        + "\n\n"
        + PROSE_LAW
    )


def test_the_expiry_path_never_even_names_the_prose_fields():
    """The arithmetic functions must not mention prose at all.

    A weaker rule than the AST scan above and a stricter one where it counts:
    `is_live` and retrieval decide whether a ruling applies, so a reference to
    `statement` or `reason` anywhere in them is wrong even if it looks inert
    today.
    """
    arithmetic = {
        "is_live",
        "rulings_for_decision",
        "live_rulings",
        "_current_scene_id",
        "_current_session_seq",
    }
    seen = set()
    offences = []
    for node in ast.walk(MODULE_TREE):
        if isinstance(node, ast.FunctionDef) and node.name in arithmetic:
            seen.add(node.name)
            for child in ast.walk(node):
                if isinstance(child, ast.Constant) and child.value in PROSE_FIELDS:
                    offences.append(f"{node.name} (line {child.lineno}) "
                                    f"names {child.value!r}")
    missing = arithmetic - seen
    assert not missing, (
        f"expected these functions to exist and be scanned: {sorted(missing)}"
    )
    assert not offences, (
        "The expiry path names a prose field:\n  " + "\n  ".join(offences)
        + "\n\n" + PROSE_LAW
    )


def test_no_module_level_regex_is_built_over_prose():
    """Every compiled pattern in the module is an identifier grammar."""
    for node in ast.walk(MODULE_TREE):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call):
            func = node.value.func
            is_compile = (
                isinstance(func, ast.Attribute) and func.attr == "compile"
            )
            if not is_compile:
                continue
            names = [t.id for t in node.targets if isinstance(t, ast.Name)]
            assert all(name.endswith("_ID_RE") or name.endswith("_REF_RE")
                       for name in names), (
                f"unexpected compiled pattern {names}; every regex in this "
                "module must be an identifier grammar.\n\n" + PROSE_LAW
            )


# --------------------------------------------------------------------------
# 7. It never mutates anything else
# --------------------------------------------------------------------------

def test_recording_and_retrieving_leave_every_other_save_file_byte_identical(
    tmp_path,
):
    """Spec §3.3: a ruling is precedent, never authority over results.

    It cannot move dice, HP/SAN/MP/Luck, a settled result, or any other state.
    The only file it may touch is its own.
    """
    coc_state.create_campaign(tmp_path, "precedent-case", "Precedent Case")
    campaign_dir = tmp_path / ".coc" / "campaigns" / "precedent-case"
    write_scene(campaign_dir, WAREHOUSE)
    write_session_seq(campaign_dir, 1)

    before = snapshot(campaign_dir, exclude={EXPECTED_DOCUMENT_NAME})
    ruling_doc_before = (campaign_dir / "save" / EXPECTED_DOCUMENT_NAME).read_bytes()
    assert before, "the campaign directory snapshot was empty"

    rulings.record_ruling(campaign_dir, scene_ruling())
    rulings.rulings_for_decision(campaign_dir, DECISION)
    rulings.live_rulings(campaign_dir)
    rulings.supersede_ruling(
        campaign_dir,
        ruling_id="ruling:warehouse-noise",
        superseded_by="ruling:warehouse-quiet-doors",
    )

    after = snapshot(campaign_dir, exclude={EXPECTED_DOCUMENT_NAME})
    changed = sorted(
        name for name in set(before) | set(after)
        if before.get(name) != after.get(name)
    )
    assert not changed, (
        "recording a ruling changed campaign state outside its own document: "
        f"{changed}. Spec §3.3: a ruling is precedent, never authority over "
        "results."
    )
    # And its own document did change, so the comparison above is not vacuous.
    assert (campaign_dir / "save" / EXPECTED_DOCUMENT_NAME).read_bytes() != (
        ruling_doc_before
    )


def test_retrieval_writes_nothing_at_all(campaign):
    rulings.record_ruling(campaign, scene_ruling())
    rulings.record_ruling(campaign, make_ruling())
    before = snapshot(campaign)

    rulings.rulings_for_decision(campaign, DECISION)
    rulings.live_rulings(campaign)
    rulings.load_document(campaign)

    assert snapshot(campaign) == before


# --------------------------------------------------------------------------
# 8. A corrupt document is never silently replaced
# --------------------------------------------------------------------------

@pytest.mark.parametrize("corrupt", [
    "{ this is not json",
    "[]",
    '{"contract_id": "coc.session-rulings.v1", "schema_version": 1}',
    '{"contract_id": "coc.session-rulings.v0", "schema_version": 1,'
    ' "campaign_id": "x", "rulings": []}',
    '{"contract_id": "coc.session-rulings.v1", "schema_version": 2,'
    ' "campaign_id": "x", "rulings": []}',
    '{"contract_id": "coc.session-rulings.v1", "schema_version": 1,'
    ' "campaign_id": "x", "rulings": {}}',
    '{"contract_id": "coc.session-rulings.v1", "schema_version": 1,'
    ' "campaign_id": "x", "rulings": [], "notes": "extra"}',
])
def test_a_corrupt_ruling_document_raises_and_is_left_untouched(campaign, corrupt):
    path = campaign / "save" / EXPECTED_DOCUMENT_NAME
    path.write_text(corrupt, encoding="utf-8")
    original = path.read_bytes()

    with pytest.raises(rulings.SessionRulingError):
        rulings.load_document(campaign)
    with pytest.raises(rulings.SessionRulingError):
        rulings.record_ruling(campaign, make_ruling())
    with pytest.raises(rulings.SessionRulingError):
        rulings.rulings_for_decision(campaign, DECISION)

    assert path.is_file(), "the corrupt document was deleted"
    assert path.read_bytes() == original, (
        "the corrupt document was rewritten; a Keeper's record must never be "
        "silently replaced by an empty one"
    )


def test_an_unreadable_ruleset_graph_raises_the_typed_error(tmp_path):
    with pytest.raises(rulings.SessionRulingError):
        rulings.decision_ids_for_ruleset(tmp_path)


# --------------------------------------------------------------------------
# 9. Fresh campaign initialization
# --------------------------------------------------------------------------

def test_a_fresh_campaign_carries_an_empty_ruling_document(tmp_path):
    coc_state.create_campaign(tmp_path, "fresh-case", "Fresh Case")
    campaign_dir = tmp_path / ".coc" / "campaigns" / "fresh-case"
    path = campaign_dir / "save" / EXPECTED_DOCUMENT_NAME

    assert path.is_file(), (
        "a fresh campaign has no ruling document; the first ruling of the "
        "table would have to create it mid-turn"
    )
    document = json.loads(path.read_text(encoding="utf-8"))
    assert document == rulings.new_document("fresh-case")
    assert document == {
        "contract_id": EXPECTED_CONTRACT_ID,
        "schema_version": EXPECTED_SCHEMA_VERSION,
        "campaign_id": "fresh-case",
        "rulings": [],
    }
    # It validates on the real read path, not just as a dict comparison.
    assert rulings.load_document(campaign_dir) == document
    assert rulings.live_rulings(campaign_dir) == []


def test_a_fresh_campaign_accepts_a_ruling_immediately(tmp_path):
    coc_state.create_campaign(tmp_path, "first-ruling", "First Ruling")
    campaign_dir = tmp_path / ".coc" / "campaigns" / "first-ruling"
    write_scene(campaign_dir, WAREHOUSE)

    rulings.record_ruling(campaign_dir, scene_ruling())
    assert [row["ruling_id"] for row in
            rulings.rulings_for_decision(campaign_dir, DECISION)] == [
        "ruling:warehouse-noise"
    ]
    assert stored(campaign_dir)["campaign_id"] == "first-ruling"
