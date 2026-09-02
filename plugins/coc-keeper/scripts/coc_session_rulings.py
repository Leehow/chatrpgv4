#!/usr/bin/env python3
"""Persistent Keeper rulings, bound to the decision they adjudicated.

A ruling is what the Keeper decided at the table when the rules left room:
"in this warehouse a pushed Locksmith roll costs a round of audible noise".
Before this module a ruling existed only inside one turn -- ``coc_story_director``
builds a ``keeper_ruling_receipt`` and ``coc_live_turn_runner`` copies it into
the turn payload, and those are its only two references in the tree, with no
writer to disk.  So the same situation two hours later was adjudicated from
scratch, and long sessions drifted.  This module gives a ruling a lifetime.

Three boundaries, from
docs/specs/pi-coc-rule-override-and-session-rulings.md §3.3 and §4:

* **A ruling is precedent, never authority over results.**  It cannot move
  dice, HP/SAN/MP/Luck, a settled result, or any other state.  ``rules.*`` and
  ``state.*`` keep that.  A ruling that would change a number is a house rule
  and belongs to slice R4 instead.
* **It never gates.**  Retrieval hands the Keeper a precedent with its reason.
  The Keeper may adopt, modify, or ignore it, and its absence never blocks.
* **Expiry is arithmetic, not interpretation.**  Scope and expiry are read from
  the scene and session records, never inferred from the ruling's prose.

Nothing here reads a free-text field to make a decision.  ``statement`` and
``reason`` are carried for the Keeper to read and are never matched, scanned,
or compared.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from coc_fileio import write_json_atomic as _write_json_atomic

CONTRACT_ID = "coc.session-rulings.v1"
SCHEMA_VERSION = 1

DOCUMENT_NAME = "session-rulings.json"

#: Semantic id grammar, per the Model-Facing Identifier Law.  A ruling id is
#: read, echoed and chosen by a model, so it is meaning-bearing and stable
#: across retries; a hex digest here would be mis-transcribed.
#:
#: At least two hyphen-separated segments are required, matching the temporal
#: memory contract's grammar, and each segment is capped.  The first version of
#: this pattern was `ruling:[a-z0-9]+(-[a-z0-9]+)*`, which accepted
#: `ruling:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15` -- a
#: lowercase digest is entirely `[a-z0-9]`, so the one shape the law exists to
#: exclude walked straight through.
#:
#: Be honest about the limit: no grammar rejects a digest someone chops into
#: hyphenated runs.  The real guarantee is architectural and lives elsewhere --
#: code generates and verifies digests, and never asks a model to relay one.
#: This pattern closes the accident, not a determined caller.
_RULING_SEGMENT = r"[a-z0-9]{1,24}"
RULING_ID_RE = re.compile(
    rf"^ruling:{_RULING_SEGMENT}(?:-{_RULING_SEGMENT}){{1,11}}$"
)

#: A decision id in the production RuleGraph, e.g.
#: ``decision:coc7:push-luck:pushed-roll``.
DECISION_REF_RE = re.compile(
    r"^decision:[a-z0-9]+(?::[a-z0-9]+(?:-[a-z0-9]+)*)+$"
)

SCOPE_KINDS: tuple[str, ...] = ("scene", "session", "campaign")
EXPIRIES: tuple[str, ...] = ("scene_end", "session_end", "never")

RULING_FIELDS: frozenset[str] = frozenset({
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

DOCUMENT_FIELDS: frozenset[str] = frozenset({
    "contract_id",
    "schema_version",
    "campaign_id",
    "rulings",
})

#: Which expiries each scope may declare.  A scene-scoped ruling that never
#: expires would outlive the scene it was about; a campaign-scoped ruling that
#: dies at scene end is a scene ruling wearing the wrong label.  Rejecting the
#: mismatch keeps the two fields from drifting into meaning the same thing.
_ALLOWED_EXPIRIES: dict[str, frozenset[str]] = {
    "scene": frozenset({"scene_end", "session_end"}),
    "session": frozenset({"session_end"}),
    "campaign": frozenset({"never"}),
}


class SessionRulingError(ValueError):
    """A ruling or ruling document could not be accepted."""


def new_document(campaign_id: str) -> dict[str, Any]:
    """One empty ruling document for a fresh campaign."""
    return {
        "contract_id": CONTRACT_ID,
        "schema_version": SCHEMA_VERSION,
        "campaign_id": str(campaign_id),
        "rulings": [],
    }


def document_path(campaign_dir: Path | str) -> Path:
    return Path(campaign_dir) / "save" / DOCUMENT_NAME


# --------------------------------------------------------------------------
# Validation.  Every rejection is typed and names the field, because a Keeper
# reaching this path is mid-turn and a generic error costs a round trip.
# --------------------------------------------------------------------------

def _require_str(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SessionRulingError(f"{field} must be a non-empty string")
    return value


def validate_ruling(
    ruling: Any,
    *,
    known_decision_ids: frozenset[str] | set[str] | None = None,
) -> dict[str, Any]:
    """Return one accepted ruling, or raise with the exact reason.

    ``known_decision_ids`` is injected rather than loaded here so this module
    stays ruleset-agnostic and testable; when it is supplied, a
    ``decision_ref`` outside it is refused.  A ruling that cannot name an
    existing decision is unretrievable by construction -- retrieval is keyed on
    the decision, never on prose similarity -- so accepting one would be
    accepting a record nobody can ever read back.
    """
    if not isinstance(ruling, dict):
        raise SessionRulingError("a ruling must be an object")
    unknown = sorted(set(ruling) - RULING_FIELDS)
    missing = sorted(RULING_FIELDS - set(ruling))
    if unknown or missing:
        details = []
        if missing:
            details.append("missing: " + ", ".join(missing))
        if unknown:
            details.append("unsupported: " + ", ".join(unknown))
        raise SessionRulingError("ruling fields invalid (" + "; ".join(details) + ")")

    ruling_id = _require_str(ruling.get("ruling_id"), "ruling_id")
    if not RULING_ID_RE.fullmatch(ruling_id):
        raise SessionRulingError(
            f"ruling_id {ruling_id!r} must be a semantic id like "
            "'ruling:warehouse-pushed-locksmith-noise'"
        )

    decision_ref = _require_str(ruling.get("decision_ref"), "decision_ref")
    if not DECISION_REF_RE.fullmatch(decision_ref):
        raise SessionRulingError(
            f"decision_ref {decision_ref!r} is not a decision id"
        )
    if known_decision_ids is not None and decision_ref not in known_decision_ids:
        raise SessionRulingError(
            f"decision_ref {decision_ref!r} names no decision in the active "
            "rule graph; a ruling must bind to a decision to be retrievable"
        )

    scope_kind = ruling.get("scope_kind")
    if scope_kind not in SCOPE_KINDS:
        raise SessionRulingError(
            f"scope_kind must be one of {', '.join(SCOPE_KINDS)}"
        )
    # `scope_id` names the scene and nothing else.  A session-scoped ruling is
    # already pinned by `bound_session_seq`, so carrying the session in a
    # second field would let one record disagree with itself -- scope_id "1"
    # beside bound_session_seq 2 would pass validation and then answer scope
    # and expiry differently.  One field per concern.
    scope_id = ruling.get("scope_id")
    if scope_kind == "scene":
        _require_str(scope_id, "scope_id")
    elif scope_id is not None:
        raise SessionRulingError(
            f"{scope_kind} scope takes no scope_id; it is pinned by "
            "bound_session_seq"
        )

    expires = ruling.get("expires")
    if expires not in EXPIRIES:
        raise SessionRulingError(f"expires must be one of {', '.join(EXPIRIES)}")
    if expires not in _ALLOWED_EXPIRIES[scope_kind]:
        raise SessionRulingError(
            f"scope_kind {scope_kind!r} may not expire {expires!r}; allowed: "
            + ", ".join(sorted(_ALLOWED_EXPIRIES[scope_kind]))
        )

    _require_str(ruling.get("statement"), "statement")
    _require_str(ruling.get("reason"), "reason")

    bound_scene_id = ruling.get("bound_scene_id")
    if bound_scene_id is not None and not isinstance(bound_scene_id, str):
        raise SessionRulingError("bound_scene_id must be a string or null")
    bound_session_seq = ruling.get("bound_session_seq")
    if not isinstance(bound_session_seq, int) or isinstance(bound_session_seq, bool):
        raise SessionRulingError("bound_session_seq must be an integer")
    source_turn = ruling.get("source_turn")
    if not isinstance(source_turn, int) or isinstance(source_turn, bool) or source_turn < 0:
        raise SessionRulingError("source_turn must be a non-negative integer")
    superseded_by = ruling.get("superseded_by")
    if superseded_by is not None:
        if not isinstance(superseded_by, str) or not RULING_ID_RE.fullmatch(superseded_by):
            raise SessionRulingError("superseded_by must be null or a ruling id")
        if superseded_by == ruling_id:
            raise SessionRulingError("a ruling cannot supersede itself")

    if scope_kind == "scene" and not bound_scene_id:
        raise SessionRulingError("a scene-scoped ruling must record its scene")

    return json.loads(json.dumps(ruling))


def load_document(campaign_dir: Path | str) -> dict[str, Any]:
    """Read the ruling document, or return an empty one when absent."""
    path = document_path(campaign_dir)
    if not path.is_file():
        return new_document(Path(campaign_dir).name)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise SessionRulingError(
            f"{DOCUMENT_NAME} is unreadable; refusing to replace it"
        ) from exc
    if (
        not isinstance(payload, dict)
        or set(payload) != DOCUMENT_FIELDS
        or payload.get("contract_id") != CONTRACT_ID
        or payload.get("schema_version") != SCHEMA_VERSION
        or not isinstance(payload.get("rulings"), list)
    ):
        raise SessionRulingError(
            f"{DOCUMENT_NAME} does not match the current schema"
        )
    return payload


def record_ruling(
    campaign_dir: Path | str,
    ruling: dict[str, Any],
    *,
    known_decision_ids: frozenset[str] | set[str] | None = None,
) -> dict[str, Any]:
    """Persist one ruling.  Idempotent on a byte-equal replay.

    A second ruling with the same id and different content is refused rather
    than overwritten: an earlier ruling is the record of what the table was
    told, and rewriting it in place would make the transcript and the record
    disagree.  Supersede it instead.
    """
    accepted = validate_ruling(ruling, known_decision_ids=known_decision_ids)
    document = load_document(campaign_dir)
    for existing in document["rulings"]:
        if existing.get("ruling_id") == accepted["ruling_id"]:
            if existing == accepted:
                return {"ruling": accepted, "recorded": False, "reason": "replay"}
            raise SessionRulingError(
                f"ruling {accepted['ruling_id']!r} already exists with different "
                "content; supersede it instead of rewriting it"
            )
    document["rulings"].append(accepted)
    document["rulings"].sort(key=lambda row: str(row.get("ruling_id")))
    _write_json_atomic(document_path(campaign_dir), document, indent=2,
                       ensure_ascii=False, trailing_newline=True)
    return {"ruling": accepted, "recorded": True, "reason": "recorded"}


def supersede_ruling(
    campaign_dir: Path | str,
    *,
    ruling_id: str,
    superseded_by: str,
) -> dict[str, Any]:
    """Close an earlier ruling by naming its successor.  Never deletes."""
    document = load_document(campaign_dir)
    for row in document["rulings"]:
        if row.get("ruling_id") == ruling_id:
            if row.get("superseded_by") == superseded_by:
                return {"ruling_id": ruling_id, "changed": False}
            if row.get("superseded_by"):
                raise SessionRulingError(
                    f"ruling {ruling_id!r} is already superseded by "
                    f"{row['superseded_by']!r}"
                )
            if not RULING_ID_RE.fullmatch(str(superseded_by)):
                raise SessionRulingError("superseded_by must be a ruling id")
            if superseded_by == ruling_id:
                raise SessionRulingError("a ruling cannot supersede itself")
            row["superseded_by"] = superseded_by
            _write_json_atomic(document_path(campaign_dir), document, indent=2,
                               ensure_ascii=False, trailing_newline=True)
            return {"ruling_id": ruling_id, "changed": True}
    raise SessionRulingError(f"no ruling {ruling_id!r} to supersede")


# --------------------------------------------------------------------------
# Retrieval.  Expiry and scope are computed from the scene and session
# records; nothing below reads a ruling's prose.
# --------------------------------------------------------------------------

def _current_scene_id(campaign_dir: Path | str) -> str | None:
    path = Path(campaign_dir) / "save" / "active-scene.json"
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    scene_id = payload.get("scene_id") if isinstance(payload, dict) else None
    return scene_id if isinstance(scene_id, str) and scene_id else None


def _current_session_seq(campaign_dir: Path | str) -> int | None:
    path = Path(campaign_dir) / "save" / "session-state.json"
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    seq = payload.get("table_session_seq") if isinstance(payload, dict) else None
    return seq if isinstance(seq, int) and not isinstance(seq, bool) else None


def is_live(
    ruling: dict[str, Any],
    *,
    scene_id: str | None,
    session_seq: int | None,
) -> bool:
    """Whether one ruling still applies, by arithmetic over scope and expiry."""
    if ruling.get("superseded_by"):
        return False

    expires = ruling.get("expires")
    if expires == "scene_end":
        if scene_id is None or ruling.get("bound_scene_id") != scene_id:
            return False
    elif expires == "session_end":
        if session_seq is None or ruling.get("bound_session_seq") != session_seq:
            return False

    scope_kind = ruling.get("scope_kind")
    if scope_kind == "scene":
        return scene_id is not None and ruling.get("scope_id") == scene_id
    if scope_kind == "session":
        return (
            session_seq is not None
            and ruling.get("bound_session_seq") == session_seq
        )
    return True


def rulings_for_decision(
    campaign_dir: Path | str,
    decision_ref: str,
    *,
    scene_id: str | None = None,
    session_seq: int | None = None,
) -> list[dict[str, Any]]:
    """Every live ruling bound to one decision, most recent turn first.

    Scene and session are read from campaign state when not supplied, so a
    caller cannot accidentally evaluate expiry against a stale view.
    """
    document = load_document(campaign_dir)
    if scene_id is None:
        scene_id = _current_scene_id(campaign_dir)
    if session_seq is None:
        session_seq = _current_session_seq(campaign_dir)
    live = [
        row for row in document["rulings"]
        if row.get("decision_ref") == decision_ref
        and is_live(row, scene_id=scene_id, session_seq=session_seq)
    ]
    live.sort(key=lambda row: (-int(row.get("source_turn") or 0),
                               str(row.get("ruling_id"))))
    return live


def live_rulings(
    campaign_dir: Path | str,
    *,
    scene_id: str | None = None,
    session_seq: int | None = None,
) -> list[dict[str, Any]]:
    """Every live ruling, whatever decision it binds."""
    document = load_document(campaign_dir)
    if scene_id is None:
        scene_id = _current_scene_id(campaign_dir)
    if session_seq is None:
        session_seq = _current_session_seq(campaign_dir)
    live = [
        row for row in document["rulings"]
        if is_live(row, scene_id=scene_id, session_seq=session_seq)
    ]
    live.sort(key=lambda row: (str(row.get("decision_ref")),
                               -int(row.get("source_turn") or 0),
                               str(row.get("ruling_id"))))
    return live


def decision_ids_for_ruleset(ruleset_dir: Path | str) -> frozenset[str]:
    """Every decision id in one ruleset's rule graph, for validation."""
    path = Path(ruleset_dir) / "rule-graph.json"
    try:
        graph = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise SessionRulingError(f"cannot read {path}") from exc
    return frozenset(
        str(node.get("node_id"))
        for node in (graph.get("nodes") or [])
        if isinstance(node, dict) and node.get("node_kind") == "decision"
    )
