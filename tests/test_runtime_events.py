from pathlib import Path
import importlib.util
import json


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
    assert set(types) == {
        "narration", "speech", "roll", "state_patch",
        "choice", "spoiler_gate", "system", "error",
    }
