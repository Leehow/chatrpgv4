from pathlib import Path
import importlib.util
import json

import pytest
from jsonschema import Draft202012Validator, ValidationError


def _load():
    path = Path("runtime/engine/events.py")
    spec = importlib.util.spec_from_file_location("runtime_events", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_make_event_has_required_envelope():
    ev = _load().make_event("narration", {"text": "雨还在下。"})
    assert ev["type"] == "narration"
    assert ev["visibility"] == "player"
    assert ev["id"].startswith("evt_")
    assert "ts" in ev
    assert ev["payload"]["text"] == "雨还在下。"
    _load().validate_event(ev)


def test_validate_event_rejects_unknown_type():
    bad = {
        "type": "fanfic",
        "id": "evt_x",
        "ts": "2026-07-09T00:00:00Z",
        "visibility": "player",
        "payload": {},
    }
    try:
        _load().validate_event(bad)
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_events_schema_file_lists_all_types():
    schema = json.loads(Path("runtime/protocol/events.schema.json").read_text())
    types = schema["properties"]["type"]["enum"]
    assert tuple(types) == _load().EVENT_TYPES


@pytest.mark.parametrize(
    ("event_type", "payload"),
    [
        ("narration", {"text": "Safe.", "keeper_text": "private"}),
        ("speech", {
            "text": "Safe.", "speaker_id": "npc-1", "speaker_name": "private",
        }),
        ("roll", {"roll": 42, "resolution_context": {"private": True}}),
        ("choice", {
            "choice_id": "choice-1", "kind": "chase_action",
            "command_id": "command-1", "responder": "player", "revision": 1,
            "prompt": "Choose.",
            "options": [{"action": "dodge", "label": "Dodge", "secret": "x"}],
        }),
        ("state_patch", {
            "final_state": {},
            "state_patch": {"active_scene_path": "/private/scene.json"},
        }),
        ("session_ending", {
            "kind": "session_ending", "decision_id": "turn-1",
            "scene_id": "ending", "keeper_summary": "private",
        }),
    ],
)
def test_validate_event_rejects_non_public_payload_fields(event_type, payload):
    with pytest.raises(ValueError):
        _load().make_event(event_type, payload)


@pytest.mark.parametrize(
    "event",
    [
        {
            "type": "narration", "id": "evt-1", "ts": "2026-07-12T00:00:00Z",
            "visibility": "player",
            "payload": {"text": "Safe.", "scenario_path": "/private/story.json"},
        },
        {
            "type": "speech", "id": "evt-speech", "ts": "2026-07-12T00:00:00Z",
            "visibility": "player",
            "payload": {
                "text": "Safe.", "speaker_id": "npc-1", "speaker_name": "private",
            },
        },
        {
            "type": "roll", "id": "evt-2", "ts": "2026-07-12T00:00:00Z",
            "visibility": "player",
            "payload": {"roll": 42, "_session_events": [{"secret": "x"}]},
        },
        {
            "type": "choice", "id": "evt-3", "ts": "2026-07-12T00:00:00Z",
            "visibility": "player",
            "payload": {
                "choice_id": "choice-1", "kind": "chase_action",
                "command_id": "command-1", "responder": "player", "revision": 1,
                "prompt": "Choose.",
                "options": [{"action": "dodge", "label": "Dodge", "secret": "x"}],
            },
        },
        {
            "type": "state_patch", "id": "evt-4", "ts": "2026-07-12T00:00:00Z",
            "visibility": "player",
            "payload": {
                "final_state": {},
                "state_patch": {"active_scene_path": "/private/scene.json"},
            },
        },
        {
            "type": "session_ending", "id": "evt-5",
            "ts": "2026-07-12T00:00:00Z", "visibility": "player",
            "payload": {
                "kind": "session_ending", "decision_id": "turn-1",
                "scene_id": "ending", "forbidden_reveal": "private",
            },
        },
    ],
)
def test_events_schema_rejects_non_public_payload_fields(event):
    schema = json.loads(Path("runtime/protocol/events.schema.json").read_text())
    with pytest.raises(ValidationError):
        Draft202012Validator(schema).validate(event)


def test_events_schema_accepts_closed_player_and_internal_events():
    events = _load()
    samples = [
        events.make_event("narration", {"text": "Safe.", "decision_id": "turn-1"}),
        events.make_event("speech", {
            "text": "Safe.", "speaker_id": "npc-1", "decision_id": "turn-1",
        }),
        events.make_event("roll", {
            "roll_id": "roll-1", "decision_id": "turn-1", "kind": "skill_check",
            "skill": "Spot Hidden", "target": 60, "roll": 42,
            "outcome": "regular_success", "success": True,
        }),
        events.make_event("choice", {
            "choice_id": "choice-1", "kind": "chase_action",
            "command_id": "command-1", "responder": "player", "revision": 1,
            "prompt": "Choose.",
            "options": [{"action": "dodge", "label": "Dodge"}],
        }),
        events.make_event("state_patch", {
            "final_state": {
                "active_scene": "scene-1", "tension": "high", "turn_number": 1,
            },
            "state_patch": {"applied": True, "world_active_scene_updated": True},
        }),
        events.make_event("session_ending", {
            "kind": "session_ending", "decision_id": "turn-1", "scene_id": "ending",
        }),
        events.make_event(
            "system", {"kind": "internal", "raw": {"allowed": "internally"}},
            visibility="system",
        ),
    ]
    validator = Draft202012Validator(
        json.loads(Path("runtime/protocol/events.schema.json").read_text())
    )
    for event in samples:
        validator.validate(event)
