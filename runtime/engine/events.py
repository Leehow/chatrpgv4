from __future__ import annotations

import time
import uuid
from typing import Any

EVENT_TYPES = (
    "narration", "speech", "roll", "state_patch",
    "choice", "spoiler_gate", "system", "error",
)
VISIBILITIES = ("player", "keeper", "system")


def make_event(
    type: str,
    payload: dict[str, Any],
    *,
    visibility: str = "player",
    event_id: str | None = None,
) -> dict[str, Any]:
    if type not in EVENT_TYPES:
        raise ValueError(f"invalid event type: {type!r}")
    if visibility not in VISIBILITIES:
        raise ValueError(f"invalid visibility: {visibility!r}")
    if not isinstance(payload, dict):
        raise ValueError("payload must be an object")
    event = {
        "type": type,
        "id": event_id or f"evt_{uuid.uuid4().hex[:12]}",
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "visibility": visibility,
        "payload": payload,
    }
    validate_event(event)
    return event


def validate_event(event: dict[str, Any]) -> None:
    if not isinstance(event, dict):
        raise ValueError("event must be an object")
    for key in ("type", "id", "ts", "visibility", "payload"):
        if key not in event:
            raise ValueError(f"event missing {key}")
    if event["type"] not in EVENT_TYPES:
        raise ValueError(f"invalid event type: {event['type']!r}")
    if event["visibility"] not in VISIBILITIES:
        raise ValueError(f"invalid visibility: {event['visibility']!r}")
    if not isinstance(event["payload"], dict):
        raise ValueError("payload must be an object")
