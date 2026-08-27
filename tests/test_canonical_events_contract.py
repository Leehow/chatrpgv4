"""External-behavior tests for the canonical-events contract layer.

Loads ``coc_canonical_events.py`` the same way production consumers do
(importlib from the scripts directory, no package import). Asserts the
frozen ``coc-events-1`` behavior only: closed field sets, per-type payload
schemas, semantic-ID construction, sequence allocation, idempotency, and
privacy visibility.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


mod = load_module("coc_canonical_events", SCRIPTS / "coc_canonical_events.py")

CAMPAIGN = "amaranthine-16"
TIMELINE = "tl-main"
ACTOR = "subject-investigator-elise"
NPC = f"subject-npc-{CAMPAIGN}-corbitt"

MINIMAL_PAYLOADS: dict[str, dict] = {
    "turn-started": {},
    "player-declared": {"declared_kind": "investigate"},
    "roll-resolved": {
        "roll_id": "roll-spot-hidden-01",
        "check": "spot-hidden",
        "actor": ACTOR,
        "result_level": "regular",
    },
    "clue-discovered": {
        "clue_id": "clue-diary-page-13",
        "discovered_by": ACTOR,
    },
    "scene-moved": {"to_scene": "parish-study"},
    "npc-relationship-changed": {
        "npc": NPC,
        "investigator": ACTOR,
        "channel": "hostility",
        "after": "wary",
    },
    "belief-asserted": {
        "hypothesis_id": "hyp-cult-meets-in-tunnel",
        "holder": ACTOR,
    },
    "belief-reframed": {
        "hypothesis_id": "hyp-cult-meets-in-tunnel",
        "change": "tunnel entrance believed flooded after storm",
    },
    "memory-written": {
        "memory_id": f"episode-{CAMPAIGN}-{TIMELINE}-turn-3",
        "memory_kind": "episode",
    },
    "sanity-changed": {
        "investigator": ACTOR,
        "delta": -2,
        "cause": "ghoul-sight",
    },
    "item-transferred": {
        "item": "brass-lantern",
        "from_holder": "scenario",
        "to_holder": ACTOR,
    },
    "turn-finalized": {
        "finalization_id": f"fin-{CAMPAIGN}-{TIMELINE}-turn-3",
    },
}


def payload_for(event_type: str, **overrides):
    body = {"_v": mod.PAYLOAD_SCHEMA_VERSION}
    body.update(MINIMAL_PAYLOADS[event_type])
    body.update(overrides)
    return body


NO_ALLOCATOR = object()


def build(
    event_type: str = "turn-started",
    *,
    slug: str = "occ-01",
    decision: str = "d-01",
    allocator=NO_ALLOCATOR,
    envelope_overrides: dict | None = None,
    payload_overrides: dict | None = None,
):
    kwargs = dict(
        event_type=event_type,
        campaign=CAMPAIGN,
        timeline=TIMELINE,
        turn=3,
        slug=slug,
        source="coc_test.writer",
        game_time="day2-night",
        privacy="public",
        decision_id=decision,
        data=payload_for(event_type, **(payload_overrides or {})),
    )
    if allocator is NO_ALLOCATOR:
        kwargs["allocator"] = mod.MemorySequenceAllocator()
    elif allocator is not None:
        kwargs["allocator"] = allocator
    kwargs.update(envelope_overrides or {})
    return mod.build_event(**kwargs)


# ---------------------------------------------------------------------------
# Valid envelopes across the whole type registry
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("event_type", list(mod.EVENT_TYPES))
def test_valid_envelope_per_type_passes(event_type):
    record = build(event_type)
    mod.validate_event(record)  # must not raise
    expected_id = (
        f"{event_type}-{CAMPAIGN}-{TIMELINE}-t3-occ-01"
    )
    assert record["id"] == expected_id
    assert record["specversion"] == "coc-events/1"
    assert record["data"]["_v"] == 1


def test_schema_generation_constant():
    assert mod.SCHEMA_GENERATION == "coc-events-1"
    assert len(mod.EVENT_TYPES) == 12
    assert mod.CONTRACT_NAME == "canonical-events"


def test_semantic_id_builder_is_deterministic_and_turn_scoped():
    a = mod.event_id_for("clue-discovered", CAMPAIGN, TIMELINE, 7, "occ-02")
    b = mod.event_id_for("clue-discovered", CAMPAIGN, TIMELINE, 7, "occ-02")
    assert a == b
    other_turn = mod.event_id_for("clue-discovered", CAMPAIGN, TIMELINE, 8, "occ-02")
    assert a != other_turn


def test_ordinal_slug_is_ordered_and_transcribable():
    assert mod.ordinal_slug(7) == "occ-07"
    with pytest.raises(mod.CanonicalEventsContractError):
        mod.ordinal_slug(0)


# ---------------------------------------------------------------------------
# Closed field sets
# ---------------------------------------------------------------------------


def test_unknown_envelope_field_fails():
    # Envelope extras can never ride through build_event (closed signature);
    # consumers reading raw lines feed arbitrary dicts to the validator.
    record = build()
    record["caused_by"] = "whatever"
    with pytest.raises(mod.UnknownFieldError):
        mod.validate_event(record)


def test_unknown_payload_field_fails():
    with pytest.raises(mod.UnknownFieldError):
        build(payload_overrides={"secret_note": "hidden"})


def test_cross_type_payload_field_still_unknown():
    # ``mode`` is legal belief-asserted vocabulary, foreign on roll-resolved.
    with pytest.raises(mod.UnknownFieldError):
        build("roll-resolved", payload_overrides={"mode": "asserted"})


@pytest.mark.parametrize(
    "field",
    [
        "specversion",
        "type",
        "id",
        "source",
        "campaign",
        "timeline",
        "turn",
        "sequence",
        "game_time",
        "privacy",
        "decision_id",
        "data",
    ],
)
def test_missing_required_envelope_field_fails(field):
    record = build()
    del record[field]
    with pytest.raises(mod.MissingFieldError):
        mod.validate_event(record)


def test_missing_required_payload_field_fails():
    record = build("roll-resolved")
    del record["data"]["result_level"]
    with pytest.raises(mod.MissingFieldError):
        mod.validate_event(record)


def test_present_but_null_optional_field_fails_closed():
    with pytest.raises(mod.MissingFieldError):
        build("clue-discovered", payload_overrides={"method": None})


# ---------------------------------------------------------------------------
# Identifier discipline
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "bad_id",
    [
        "6f9619ff-8b86-d011-b42d-00c04fc964ff",  # opaque uuid-shaped
        "rollresolved-amaranthine-16",  # wrong type prefix
        "Roll-Resolved-amaranthine-16-tl-main-t3-occ-01",  # uppercase
        "",  # empty
    ],
)
def test_bad_event_id_format_fails(bad_id):
    record = build()
    record["id"] = bad_id
    with pytest.raises((mod.SemanticIdError, mod.CanonicalEventsContractError)):
        mod.validate_event(record)


def test_event_id_must_match_its_declared_type():
    record = build("roll-resolved")
    good = record["id"]
    record["type"] = "clue-discovered"
    with pytest.raises(mod.SemanticIdError):
        mod.validate_event(record)
    record["type"] = "roll-resolved"
    record["id"] = good
    mod.validate_event(record)


def test_bad_decision_id_grammar_fails():
    with pytest.raises(mod.SemanticIdError):
        build(envelope_overrides={"decision_id": "UPPER NOT A TOKEN"})


# ---------------------------------------------------------------------------
# Payload schema version
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("bad_version", [None, "1", 2])
def test_bad_payload_version_fails(bad_version):
    body = payload_for("turn-finalized", _v=bad_version)
    with pytest.raises(
        (mod.PayloadVersionError, mod.MissingFieldError, mod.ClosedEnumError)
    ):
        build("turn-finalized", payload_overrides=body)


# ---------------------------------------------------------------------------
# Privacy / visibility
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("bad_privacy", ["keeper_only", "player_safe", "PUBLIC", ""])
def test_privacy_enum_enforced(bad_privacy):
    with pytest.raises(mod.PrivacyError):
        build(envelope_overrides={"privacy": bad_privacy})


def test_secret_and_public_accepted():
    for level in ("public", "secret"):
        mod.validate_event(build(envelope_overrides={"privacy": level}))


def test_project_player_view_drops_secret_events():
    events = [
        build(decision="pub-01"),
        build(slug="occ-02", decision="sec-01", envelope_overrides={"privacy": "secret"}),
        build(slug="occ-03", decision="pub-02"),
    ]
    visible = mod.project_player_view(events)
    assert [e["decision_id"] for e in visible] == ["pub-01", "pub-02"]


# ---------------------------------------------------------------------------
# Sequence allocation seam
# ---------------------------------------------------------------------------


def test_memory_allocator_monotonic_per_pair_and_independent_across_timelines():
    alloc = mod.MemorySequenceAllocator()
    first = alloc.next_sequence(CAMPAIGN, TIMELINE)
    second = alloc.next_sequence(CAMPAIGN, TIMELINE)
    forked = alloc.next_sequence(CAMPAIGN, "tl-fork-b")
    assert (first, second, forked) == (1, 2, 1)


def test_explicit_allocator_is_used_for_sequence_stamp():
    alloc = mod.MemorySequenceAllocator()
    a = build(decision="seq-a", allocator=alloc)
    b = build(slug="occ-02", decision="seq-b", allocator=alloc)
    assert (a["sequence"], b["sequence"]) == (1, 2)


def test_build_requires_sequence_source():
    with pytest.raises(mod.SequenceError):
        build(envelope_overrides={"sequence": None}, allocator=None)


def test_non_positive_explicit_sequence_fails():
    record = build()
    record["sequence"] = 0
    with pytest.raises(mod.SequenceError):
        mod.validate_event(record)


def test_bool_and_float_do_not_count_as_integers():
    with pytest.raises(mod.CanonicalEventsContractError):
        build(envelope_overrides={"sequence": True})
    body = payload_for("item-transferred", qty=1.5)
    with pytest.raises(mod.CanonicalEventsContractError):
        build("item-transferred", payload_overrides=body)


def test_enum_fields_closed():
    with pytest.raises(mod.ClosedEnumError):
        build("roll-resolved", payload_overrides={"result_level": "success"})
    with pytest.raises(mod.ClosedEnumError):
        build("scene-moved", payload_overrides={"moved_by": "director"})


# ---------------------------------------------------------------------------
# Idempotency (decision_id)
# ---------------------------------------------------------------------------


def test_identical_emit_returns_existing_record():
    existing = build(allocator=mod.MemorySequenceAllocator())
    replay = json.loads(json.dumps(existing))
    replay["sequence"] = 999  # allocator re-stamp on replay is ignored
    assert mod.resolve_duplicate(existing, replay) is existing


def test_conflicting_content_under_same_decision_id_fails():
    existing = build()
    conflicting = dict(existing)
    conflicting["data"] = payload_for("turn-started", note="changed story")
    with pytest.raises(mod.DuplicateDecisionIdError):
        mod.resolve_duplicate(existing, conflicting)


def test_different_id_under_same_decision_id_fails():
    existing = build("roll-resolved")
    other_slug = dict(existing)
    other_slug["id"] = mod.event_id_for(
        "roll-resolved", CAMPAIGN, TIMELINE, 3, "occ-02"
    )
    with pytest.raises(mod.DuplicateDecisionIdError):
        mod.resolve_duplicate(existing, other_slug)


# ---------------------------------------------------------------------------
# Read-side conveniences
# ---------------------------------------------------------------------------


def test_iter_events_roundtrips_jsonl(tmp_path):
    events = [
        build(decision="line-01"),
        build(slug="occ-02", decision="line-02"),
    ]
    path = tmp_path / "canonical-events.jsonl"
    path.write_text(
        "\n".join(mod.canonical_json(e) for e in events) + "\n\n",
        encoding="utf-8",
    )
    parsed = list(mod.iter_events(path.read_text(encoding="utf-8").splitlines(True)))
    assert parsed == events
