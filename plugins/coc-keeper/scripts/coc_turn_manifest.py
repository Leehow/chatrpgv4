#!/usr/bin/env python3
"""Bounded pending-turn manifests for causal finalization.

The manifest is a cursor over the current turn's toolbox log slice.  It keeps
normal drafting/finalization work proportional to the pending turn instead of
re-reading campaign history, and it prevents a failed finalization from
absorbing later journals.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import stat
from typing import Any, Collection

import coc_fileio


SCHEMA_VERSION = 1
CURSOR_FILENAME = "turn-source-cursor.json"
PENDING_FILENAME = "pending-turn.json"
MANIFEST_DIRNAME = "turn-manifests"
TOOLBOX_LOG = Path("logs") / "toolbox-calls.jsonl"
FINALIZATION_LOG = Path("logs") / "turn-finalizations.jsonl"
_SETUP_HANDOFF_FIELDS = frozenset({
    "schema_version", "decision_id", "campaign_id", "investigator_ids",
    "completed_at", "opening_projection_ref", "lane_interrupted_at_handoff",
})

CURSOR_FIELDS = frozenset({
    "schema_version",
    "campaign_id",
    "next_source_offset",
    "next_source_index",
    "last_finalized_turn_id",
    "last_finalization_id",
})
POINTER_FIELDS = frozenset({
    "schema_version", "campaign_id", "turn_id", "journal_decision_id",
})
MANIFEST_FIELDS = frozenset({
    "schema_version",
    "campaign_id",
    "turn_id",
    "journal_decision_id",
    "turn_number",
    "status",
    "revision",
    "source_start_offset",
    "source_start_index",
    "observed_end_offset",
    "journal_end_offset",
    "journal_call_index",
    "repair_call_count",
    "source_digest",
    "finalization_id",
    "accepted_revision",
    "settlement_snapshot_id",
    "rendered_text_sha256",
    "contract_projection_sha256",
    "completed_end_offset",
    "completed_next_index",
    "created_at",
    "updated_at",
})

POST_JOURNAL_READ_TOOLS = frozenset({
    "session.resume",
    "scene.context",
    "turn.output_context",
    "narration.brief",
})
POST_JOURNAL_ADVISORY_WRITE_TOOLS = frozenset({"narration.review"})
# Private lease ownership can outlive the player turn. Renew/release touches
# only that source-work lease and is excluded from turn settlement evidence;
# fulfillment remains blocked until finalization.
POST_JOURNAL_SOURCE_LEASE_TOOLS = frozenset({
    "progressive.renew_host_work_leases",
    "progressive.release_host_work_leases",
})
POST_JOURNAL_REPAIR_TOOLS = frozenset({"state.exceptional_effect"})


def _toolbox_query_tools() -> frozenset[str]:
    """Every access=query tool is a post-journal read, not a settlement.

    Imported lazily so toolbox registration can finish before the first
    pending-turn scan. The explicit POST_JOURNAL_READ_TOOLS set remains a
    floor for advisory helpers that are still default-mutation.
    """
    try:
        import coc_toolbox
    except ImportError:
        return frozenset()
    tools = getattr(coc_toolbox, "TOOLS", None)
    if not isinstance(tools, dict):
        return frozenset()
    return frozenset(
        name
        for name, spec in tools.items()
        if isinstance(spec, dict) and spec.get("access") == "query"
    )


def is_post_journal_read_tool(tool: str) -> bool:
    return (
        tool in POST_JOURNAL_READ_TOOLS
        or tool in POST_JOURNAL_ADVISORY_WRITE_TOOLS
        or tool in POST_JOURNAL_SOURCE_LEASE_TOOLS
        or tool in _toolbox_query_tools()
    )

_RESUME_MAX_ROWS = 96
_RESUME_MAX_DATA_BYTES = 8 * 1024
_RESUME_MAX_TOTAL_BYTES = 96 * 1024
_RESUME_OMIT_ARGS = frozenset({
    "seed", "draft", "coverage", "mechanics_placements", "player_text",
})
_RESUME_FULL_DATA_PREFIXES = (
    "rules.", "state.", "combat.", "chase.", "sanity.",
    "development.", "evidence.",
)
_RESUME_FULL_DATA_TOOLS = frozenset({"npc.reaction", "actions.advise"})


class TurnManifestError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _digest(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _turn_id(campaign_id: str, journal_decision_id: str) -> str:
    digest = hashlib.sha256(
        f"turn-manifest-v1:{campaign_id}:{journal_decision_id}".encode("utf-8")
    ).hexdigest()
    return f"turn-v1-{digest[:32]}"


def _cursor_path(campaign_dir: Path) -> Path:
    return Path(campaign_dir) / "save" / CURSOR_FILENAME


def _pending_path(campaign_dir: Path) -> Path:
    return Path(campaign_dir) / "save" / PENDING_FILENAME


def _manifest_path(campaign_dir: Path, turn_id: str) -> Path:
    return Path(campaign_dir) / "save" / MANIFEST_DIRNAME / f"{turn_id}.json"


def _toolbox_path(campaign_dir: Path) -> Path:
    return Path(campaign_dir) / TOOLBOX_LOG


def _finalization_path(campaign_dir: Path) -> Path:
    return Path(campaign_dir) / FINALIZATION_LOG


def _read_object(path: Path, *, code: str) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise TurnManifestError(code, f"{path.name} is unreadable") from exc
    if not isinstance(payload, dict):
        raise TurnManifestError(code, f"{path.name} must be an object")
    return payload


def _valid_nonnegative_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _validate_cursor(payload: Any, campaign_id: str) -> dict[str, Any]:
    if (
        not isinstance(payload, dict)
        or set(payload) != CURSOR_FIELDS
        or payload.get("schema_version") != SCHEMA_VERSION
        or payload.get("campaign_id") != campaign_id
        or not _valid_nonnegative_int(payload.get("next_source_offset"))
        or not _valid_nonnegative_int(payload.get("next_source_index"))
    ):
        raise TurnManifestError(
            "state_corrupt", "turn source cursor does not match schema-v1"
        )
    for key in ("last_finalized_turn_id", "last_finalization_id"):
        if payload.get(key) is not None and not isinstance(payload.get(key), str):
            raise TurnManifestError("state_corrupt", f"turn cursor {key} is invalid")
    return payload


def _validate_pointer(payload: Any, campaign_id: str) -> dict[str, Any]:
    if (
        not isinstance(payload, dict)
        or set(payload) != POINTER_FIELDS
        or payload.get("schema_version") != SCHEMA_VERSION
        or payload.get("campaign_id") != campaign_id
        or not isinstance(payload.get("turn_id"), str)
        or not payload["turn_id"]
        or not isinstance(payload.get("journal_decision_id"), str)
        or not payload["journal_decision_id"]
    ):
        raise TurnManifestError(
            "state_corrupt", "pending turn pointer does not match schema-v1"
        )
    return payload


def _validate_manifest(payload: Any, campaign_id: str) -> dict[str, Any]:
    if (
        not isinstance(payload, dict)
        or set(payload) != MANIFEST_FIELDS
        or payload.get("schema_version") != SCHEMA_VERSION
        or payload.get("campaign_id") != campaign_id
        or payload.get("status") not in {"pending", "finalized"}
        or not isinstance(payload.get("turn_id"), str)
        or not payload["turn_id"]
        or not isinstance(payload.get("journal_decision_id"), str)
        or not payload["journal_decision_id"]
    ):
        raise TurnManifestError(
            "state_corrupt", "turn manifest does not match schema-v1"
        )
    for key in (
        "turn_number",
        "revision",
        "source_start_offset",
        "source_start_index",
        "observed_end_offset",
        "repair_call_count",
    ):
        if not _valid_nonnegative_int(payload.get(key)):
            raise TurnManifestError("state_corrupt", f"turn manifest {key} is invalid")
    for key in (
        "journal_end_offset",
        "journal_call_index",
        "completed_end_offset",
        "completed_next_index",
    ):
        value = payload.get(key)
        if value is not None and not _valid_nonnegative_int(value):
            raise TurnManifestError("state_corrupt", f"turn manifest {key} is invalid")
    for key in (
        "source_digest", "finalization_id", "settlement_snapshot_id",
        "rendered_text_sha256", "contract_projection_sha256",
    ):
        value = payload.get(key)
        if value is not None and (not isinstance(value, str) or not value):
            raise TurnManifestError("state_corrupt", f"turn manifest {key} is invalid")
    accepted_revision = payload.get("accepted_revision")
    if accepted_revision is not None and (
        isinstance(accepted_revision, bool)
        or not isinstance(accepted_revision, int)
        or accepted_revision not in {1, 2}
    ):
        raise TurnManifestError("state_corrupt", "turn manifest accepted_revision is invalid")
    if not isinstance(payload.get("created_at"), str) or not isinstance(
        payload.get("updated_at"), str
    ):
        raise TurnManifestError("state_corrupt", "turn manifest timestamps are invalid")
    return payload


def _contains_historical_turns(campaign_dir: Path) -> bool:
    if _finalization_path(campaign_dir).is_file() and _finalization_path(
        campaign_dir
    ).stat().st_size:
        return True
    toolbox = _toolbox_path(campaign_dir)
    if not toolbox.is_file():
        return False
    try:
        with toolbox.open("r", encoding="utf-8") as handle:
            for raw in handle:
                if '"state.journal"' not in raw:
                    continue
                try:
                    row = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if row.get("tool") == "state.journal" and row.get("ok") is True:
                    return True
    except (OSError, UnicodeError) as exc:
        raise TurnManifestError("state_corrupt", "toolbox log is unreadable") from exc
    return False


def _cursor_is_regular_file(path: Path) -> bool:
    """Classify the durable cursor lexically without following symlinks."""
    try:
        mode = path.lstat().st_mode
    except FileNotFoundError:
        return False
    except OSError as exc:
        raise TurnManifestError(
            "state_corrupt", "turn source cursor path is unreadable",
        ) from exc
    if not stat.S_ISREG(mode):
        raise TurnManifestError(
            "state_corrupt",
            "turn source cursor path must be a regular file",
        )
    return True


def load_or_create_cursor(
    campaign_dir: Path, *, validate_finalization_binding: bool = True
) -> dict[str, Any]:
    campaign_dir = Path(campaign_dir)
    campaign_id = campaign_dir.name
    path = _cursor_path(campaign_dir)
    if _cursor_is_regular_file(path):
        cursor = _validate_cursor(
            _read_object(path, code="state_corrupt"), campaign_id
        )
        last_finalization_id = cursor.get("last_finalization_id")
        if (
            validate_finalization_binding
            and isinstance(last_finalization_id, str)
            and last_finalization_id
        ):
            matching = next(
                (
                    row
                    for row in _read_jsonl_rows(_finalization_path(campaign_dir))
                    if row.get("finalization_id") == last_finalization_id
                ),
                None,
            )
            if (
                not isinstance(matching, dict)
                or matching.get("schema_version") != 2
                or not isinstance(matching.get("accepted_revision"), int)
                or not isinstance(matching.get("rendered_text_sha256"), str)
                or not matching["rendered_text_sha256"]
                or not isinstance(matching.get("contract_projection_sha256"), str)
                or not matching["contract_projection_sha256"]
            ):
                raise TurnManifestError(
                    "state_corrupt",
                    "turn source cursor points to a non-current finalization receipt",
                )
        return cursor
    if _contains_historical_turns(campaign_dir):
        raise TurnManifestError(
            "fresh_campaign_required",
            "campaign has historical journals without bounded turn manifests; start a fresh current-schema campaign",
        )
    cursor = {
        "schema_version": SCHEMA_VERSION,
        "campaign_id": campaign_id,
        "next_source_offset": 0,
        "next_source_index": 0,
        "last_finalized_turn_id": None,
        "last_finalization_id": None,
    }
    coc_fileio.write_json_atomic(path, cursor)
    return cursor


def _read_jsonl_rows(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise TurnManifestError("state_corrupt", f"{path.name} is unreadable") from exc
    rows: list[dict[str, Any]] = []
    for line_number, raw in enumerate(text.splitlines(), start=1):
        if not raw.strip():
            continue
        try:
            row = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise TurnManifestError(
                "state_corrupt", f"{path.name} line {line_number} is malformed"
            ) from exc
        if not isinstance(row, dict):
            raise TurnManifestError(
                "state_corrupt", f"{path.name} line {line_number} is not an object"
            )
        rows.append(row)
    return rows


def _matching_finalization(
    campaign_dir: Path, journal_decision_id: str
) -> dict[str, Any] | None:
    for row in _read_jsonl_rows(_finalization_path(campaign_dir)):
        if row.get("journal_decision_id") == journal_decision_id:
            return row
    return None


def _slice_rows(
    path: Path, start_offset: int, *, end_offset: int | None = None
) -> tuple[list[tuple[dict[str, Any], int]], int]:
    if not path.is_file():
        return [], 0
    size = path.stat().st_size
    if start_offset > size:
        raise TurnManifestError(
            "state_corrupt", "turn source cursor is beyond the toolbox log"
        )
    stop = size if end_offset is None else end_offset
    if stop < start_offset or stop > size:
        raise TurnManifestError("state_corrupt", "turn source slice is invalid")
    rows: list[tuple[dict[str, Any], int]] = []
    try:
        with path.open("rb") as handle:
            handle.seek(start_offset)
            raw_slice = handle.read(stop - start_offset)
    except OSError as exc:
        raise TurnManifestError("state_corrupt", "toolbox log is unreadable") from exc
    consumed = start_offset
    for relative_line, raw in enumerate(raw_slice.splitlines(keepends=True), start=1):
        consumed += len(raw)
        if not raw.strip():
            continue
        if not raw.endswith((b"\n", b"\r")) and consumed != stop:
            raise TurnManifestError("state_corrupt", "toolbox log slice is torn")
        try:
            row = json.loads(raw.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise TurnManifestError(
                "state_corrupt",
                f"toolbox turn slice line {relative_line} is malformed",
            ) from exc
        if not isinstance(row, dict):
            raise TurnManifestError(
                "state_corrupt",
                f"toolbox turn slice line {relative_line} is not an object",
            )
        rows.append((row, consumed))
    return rows, stop


def _count_rows(path: Path, start_offset: int, end_offset: int) -> int:
    rows, _ = _slice_rows(path, start_offset, end_offset=end_offset)
    return len(rows)


def _persisted_setup_handoff(campaign_dir: Path) -> dict[str, Any] | None:
    """Distinguish an absent handoff from present-but-corrupt campaign state."""
    campaign_path = Path(campaign_dir) / "campaign.json"
    if campaign_path.is_symlink() or not campaign_path.is_file():
        raise TurnManifestError(
            "state_corrupt", "campaign.json is missing or is not a regular file",
        )
    try:
        campaign = json.loads(campaign_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise TurnManifestError("state_corrupt", "campaign.json is unreadable") from exc
    if not isinstance(campaign, dict):
        raise TurnManifestError("state_corrupt", "campaign.json must be an object")
    if "setup_handoff" not in campaign:
        return None
    handoff = campaign["setup_handoff"]
    decision_id = handoff.get("decision_id") if isinstance(handoff, dict) else None
    investigator_ids = (
        handoff.get("investigator_ids") if isinstance(handoff, dict) else None
    )
    if (
        not isinstance(handoff, dict)
        or set(handoff) != _SETUP_HANDOFF_FIELDS
        or handoff.get("schema_version") != 1
        or handoff.get("campaign_id") != Path(campaign_dir).name
        or not isinstance(decision_id, str)
        or not decision_id.strip()
        or not isinstance(investigator_ids, list)
        or not investigator_ids
        or any(
            not isinstance(value, str)
            or not value
            or value != value.strip()
            or value in {".", ".."}
            or "/" in value
            or "\\" in value
            for value in investigator_ids
        )
        or len(set(investigator_ids)) != len(investigator_ids)
        or not isinstance(handoff.get("completed_at"), str)
        or not handoff["completed_at"].strip()
        or handoff.get("opening_projection_ref") is not None
        and not isinstance(handoff.get("opening_projection_ref"), dict)
        or not isinstance(handoff.get("lane_interrupted_at_handoff"), bool)
    ):
        raise TurnManifestError(
            "state_corrupt", "persisted setup_handoff is not an exact schema-v1 receipt",
        )
    return deepcopy(handoff)


def _matches_persisted_setup_handoff(
    campaign_dir: Path, row: dict[str, Any], handoff: dict[str, Any],
) -> bool:
    args = row.get("args") if isinstance(row.get("args"), dict) else {}
    data = row.get("data") if isinstance(row.get("data"), dict) else {}
    result = data.get("result") if isinstance(data.get("result"), dict) else {}
    campaign_id = Path(campaign_dir).name
    return bool(
        row.get("schema_version") == 2
        and row.get("ok") is True
        and row.get("tool") == "setup.complete"
        and args.get("campaign_id") == campaign_id
        and args.get("decision_id") == handoff.get("decision_id")
        and data.get("schema_version") == 1
        and data.get("status") == "PASS"
        and data.get("kind") == "campaign.complete"
        and result.get("campaign_id") == campaign_id
        and result.get("ready_for_table") is True
        and result.get("next") == "table_opening"
        and result.get("handoff") == handoff
    )


def _setup_source_boundary(campaign_dir: Path) -> dict[str, Any] | None:
    """Return the earliest exact setup.complete boundary matching durable state."""
    handoff = _persisted_setup_handoff(campaign_dir)
    if handoff is None:
        return None
    rows, _ = _slice_rows(_toolbox_path(campaign_dir), 0)
    for position, (row, row_end) in enumerate(rows):
        if _matches_persisted_setup_handoff(campaign_dir, row, handoff):
            return {
                "schema_version": SCHEMA_VERSION,
                "kind": "setup_handoff_virtual",
                "durable_start_offset": 0,
                "durable_start_index": 0,
                "effective_start_offset": row_end,
                "effective_start_index": position + 1,
                "setup_handoff": {
                    **handoff,
                    "sealed_end_offset": row_end,
                    "sealed_next_index": position + 1,
                },
                "cursor_close_owner": "evidence.table_opening",
            }
    # A crash may persist campaign.json before the generic toolbox receipt is
    # appended. Keep the physical boundary and opening owner in that state:
    # setup rows remain visible, journal stays blocked, and an idempotent
    # setup.complete replay can later establish the exact virtual seal.
    result = {
        "schema_version": SCHEMA_VERSION,
        "kind": "setup_handoff_unverified",
        "durable_start_offset": 0,
        "durable_start_index": 0,
        "effective_start_offset": 0,
        "effective_start_index": 0,
        "setup_handoff": {**handoff},
        "cursor_close_owner": "evidence.table_opening",
    }
    return result


def setup_creation_roll_fence(campaign_dir: Path) -> dict[str, Any] | None:
    """Return exact successful roll identities before the earliest setup seal.

    This is derived from the same persisted-handoff match as resume projection;
    it never advances the durable opening cursor.  Direct campaigns and a
    crash before the generic setup.complete receipt have no provable fence.
    """
    boundary = _setup_source_boundary(Path(campaign_dir))
    if boundary is None or boundary.get("kind") != "setup_handoff_virtual":
        return None
    setup_index = int(boundary["effective_start_index"]) - 1
    rows, _ = _slice_rows(
        _toolbox_path(Path(campaign_dir)),
        0,
        end_offset=int(boundary["effective_start_offset"]),
    )
    if setup_index < 0 or setup_index >= len(rows):
        raise TurnManifestError(
            "state_corrupt", "setup handoff source fence is inconsistent",
        )
    roll_decisions: dict[str, str] = {}
    for row, _row_end in rows[:setup_index]:
        args = row.get("args") if isinstance(row.get("args"), dict) else {}
        data = row.get("data") if isinstance(row.get("data"), dict) else {}
        decision_id = args.get("decision_id")
        roll_id = data.get("roll_id")
        if (
            row.get("schema_version") != 2
            or row.get("ok") is not True
            or row.get("tool") != "rules.roll_dice"
            or not isinstance(decision_id, str)
            or not decision_id.strip()
            or not isinstance(roll_id, str)
            or not roll_id.strip()
        ):
            continue
        previous = roll_decisions.get(roll_id)
        if previous is not None and previous != decision_id:
            raise TurnManifestError(
                "state_corrupt", "setup source prefix reuses a roll id",
            )
        roll_decisions[roll_id] = decision_id
    return {
        "schema_version": SCHEMA_VERSION,
        "setup_complete_index": setup_index,
        "setup_complete_start_offset": (
            0 if setup_index == 0 else rows[setup_index - 1][1]
        ),
        "roll_decisions": roll_decisions,
    }


def _validated_virtual_source_boundary(
    campaign_dir: Path, cursor: dict[str, Any],
) -> dict[str, Any]:
    """Derive the one non-durable setup boundary from durable evidence."""
    offset_started = cursor["next_source_offset"] != 0
    index_started = cursor["next_source_index"] != 0
    if offset_started != index_started:
        raise TurnManifestError(
            "state_corrupt", "turn source cursor has inconsistent opening position",
        )
    if offset_started:
        return {
            "schema_version": SCHEMA_VERSION,
            "kind": "durable_cursor",
            "durable_start_offset": cursor["next_source_offset"],
            "durable_start_index": cursor["next_source_index"],
            "effective_start_offset": cursor["next_source_offset"],
            "effective_start_index": cursor["next_source_index"],
            "setup_handoff": None,
            "cursor_close_owner": "turn.finalize",
        }
    if cursor["last_finalized_turn_id"] is not None or cursor[
        "last_finalization_id"
    ] is not None:
        raise TurnManifestError(
            "state_corrupt", "an unopened source cursor cannot name a finalized turn",
        )
    boundary = _setup_source_boundary(campaign_dir)
    if boundary is None:
        return {
            "schema_version": SCHEMA_VERSION,
            "kind": "durable_cursor",
            "durable_start_offset": 0,
            "durable_start_index": 0,
            "effective_start_offset": 0,
            "effective_start_index": 0,
            "setup_handoff": None,
            "cursor_close_owner": "turn.finalize",
        }
    return boundary


def effective_source_boundary(campaign_dir: Path) -> dict[str, Any]:
    """Read the structured boundary shared by resume and quarantine projection.

    A missing cursor is a valid virgin campaign state.  Boundary inspection is
    a preflight, so it must not materialize that state on disk; only the
    cursor-owning opening/finalization mutations may do so.
    """
    campaign_dir = Path(campaign_dir)
    cursor_path = _cursor_path(campaign_dir)
    if _cursor_is_regular_file(cursor_path):
        cursor = load_or_create_cursor(campaign_dir)
    else:
        if _contains_historical_turns(campaign_dir):
            raise TurnManifestError(
                "fresh_campaign_required",
                "campaign has historical journals without bounded turn manifests; start a fresh current-schema campaign",
            )
        cursor = {
            "schema_version": SCHEMA_VERSION,
            "campaign_id": campaign_dir.name,
            "next_source_offset": 0,
            "next_source_index": 0,
            "last_finalized_turn_id": None,
            "last_finalization_id": None,
        }
    return _validated_virtual_source_boundary(campaign_dir, cursor)


def _earliest_table_opening_boundary(
    campaign_dir: Path,
    *,
    decision_id: str | None = None,
    run_id: str | None = None,
    observed_end_offset: int | None = None,
) -> tuple[int, int] | None:
    """Locate the first successful current-contract opening toolbox row."""
    rows, _ = _slice_rows(
        _toolbox_path(campaign_dir),
        0,
        end_offset=observed_end_offset,
    )
    for position, (row, row_end) in enumerate(rows):
        if row.get("ok") is not True or row.get("tool") != "evidence.table_opening":
            continue
        args = row.get("args") if isinstance(row.get("args"), dict) else {}
        data = row.get("data") if isinstance(row.get("data"), dict) else {}
        row_decision_id = str(args.get("decision_id") or "")
        row_run_id = str(args.get("run_id") or "")
        presented_roll_ids = data.get("presented_roll_ids")
        if (
            not row_decision_id
            or not row_run_id
            or not isinstance(presented_roll_ids, list)
            or any(
                not isinstance(value, str) or not value or value != value.strip()
                for value in presented_roll_ids
            )
            or len(set(presented_roll_ids)) != len(presented_roll_ids)
            or args.get("presented_roll_ids") != presented_roll_ids
            or data.get("source_id") != row_decision_id
            or data.get("run_id") != row_run_id
            or data.get("role") != "keeper"
            or not isinstance(data.get("text_sha256"), str)
            or not data["text_sha256"]
        ):
            continue
        if decision_id is not None and row_decision_id != decision_id:
            continue
        if run_id is not None and row_run_id != run_id:
            continue
        return row_end, position + 1
    return None


def _advance_table_opening_boundary(
    campaign_dir: Path,
    *,
    decision_id: str | None = None,
    run_id: str | None = None,
    observed_end_offset: int | None = None,
) -> bool:
    """Close only the fresh campaign's setup/opening source prefix.

    The first successful structured opening row is the immutable boundary.
    Replays after later player work therefore never advance the cursor again.
    """
    campaign_dir = Path(campaign_dir)
    if _pending_path(campaign_dir).is_file():
        return False
    cursor_path = _cursor_path(campaign_dir)
    cursor = (
        _validate_cursor(
            _read_object(cursor_path, code="state_corrupt"), campaign_dir.name
        )
        if _cursor_is_regular_file(cursor_path)
        else None
    )
    if cursor is not None:
        if cursor["last_finalized_turn_id"] is not None or cursor[
            "last_finalization_id"
        ] is not None:
            return False
        offset_started = cursor["next_source_offset"] != 0
        index_started = cursor["next_source_index"] != 0
        if offset_started != index_started:
            raise TurnManifestError(
                "state_corrupt", "turn source cursor has inconsistent opening position"
            )
        if offset_started:
            return False

    boundary = _earliest_table_opening_boundary(
        campaign_dir,
        decision_id=decision_id,
        run_id=run_id,
        observed_end_offset=observed_end_offset,
    )
    if boundary is None:
        if decision_id is not None or run_id is not None:
            raise TurnManifestError(
                "opening_boundary_pending",
                "the durable opening evidence has no matching successful toolbox row yet",
            )
        return False
    completed_end_offset, completed_next_index = boundary
    cursor = cursor or load_or_create_cursor(campaign_dir)
    next_cursor = deepcopy(cursor)
    next_cursor.update({
        "next_source_offset": completed_end_offset,
        "next_source_index": completed_next_index,
    })
    _validate_cursor(next_cursor, campaign_dir.name)
    coc_fileio.write_json_atomic(cursor_path, next_cursor)
    return True


def complete_table_opening_boundary(
    campaign_dir: Path,
    *,
    decision_id: str,
    run_id: str,
    completed_end_offset: int,
) -> bool:
    """Advance to the earliest matching opening row after its actual log append."""
    return _advance_table_opening_boundary(
        campaign_dir,
        decision_id=decision_id,
        run_id=run_id,
        observed_end_offset=completed_end_offset,
    )


def recover_table_opening_boundary(campaign_dir: Path) -> bool:
    """Recover a logged opening whose post-log cursor write was interrupted."""
    return _advance_table_opening_boundary(campaign_dir)


def _load_pending_raw(campaign_dir: Path) -> dict[str, Any] | None:
    campaign_dir = Path(campaign_dir)
    pointer_path = _pending_path(campaign_dir)
    if not pointer_path.is_file():
        return None
    pointer = _validate_pointer(
        _read_object(pointer_path, code="state_corrupt"), campaign_dir.name
    )
    manifest_path = _manifest_path(campaign_dir, pointer["turn_id"])
    if not manifest_path.is_file():
        raise TurnManifestError(
            "state_corrupt", "pending turn points to a missing manifest"
        )
    manifest = _validate_manifest(
        _read_object(manifest_path, code="state_corrupt"), campaign_dir.name
    )
    if (
        manifest["turn_id"] != pointer["turn_id"]
        or manifest["journal_decision_id"] != pointer["journal_decision_id"]
        or manifest["status"] != "pending"
    ):
        raise TurnManifestError(
            "state_corrupt", "pending turn pointer and manifest disagree"
        )
    return manifest


def _finalize_manifest_and_cursor(
    campaign_dir: Path,
    manifest: dict[str, Any],
    *,
    finalization_id: str,
    accepted_revision: int,
    settlement_snapshot_id: str,
    rendered_text_sha256: str,
    contract_projection_sha256: str,
    completed_end_offset: int,
) -> dict[str, Any]:
    campaign_dir = Path(campaign_dir)
    cursor = load_or_create_cursor(campaign_dir)
    if (
        cursor["next_source_offset"] != manifest["source_start_offset"]
        or cursor["next_source_index"] != manifest["source_start_index"]
    ):
        raise TurnManifestError(
            "state_corrupt", "pending turn no longer matches the source cursor"
        )
    row_count = _count_rows(
        _toolbox_path(campaign_dir),
        manifest["source_start_offset"],
        completed_end_offset,
    )
    completed_next_index = manifest["source_start_index"] + row_count
    updated = deepcopy(manifest)
    updated.update({
        "status": "finalized",
        "revision": int(manifest["revision"]) + 1,
        "finalization_id": finalization_id,
        "accepted_revision": accepted_revision,
        "settlement_snapshot_id": settlement_snapshot_id,
        "rendered_text_sha256": rendered_text_sha256,
        "contract_projection_sha256": contract_projection_sha256,
        "completed_end_offset": completed_end_offset,
        "completed_next_index": completed_next_index,
        "updated_at": _now_iso(),
    })
    _validate_manifest(updated, campaign_dir.name)
    coc_fileio.write_json_atomic(
        _manifest_path(campaign_dir, updated["turn_id"]), updated
    )
    next_cursor = {
        "schema_version": SCHEMA_VERSION,
        "campaign_id": campaign_dir.name,
        "next_source_offset": completed_end_offset,
        "next_source_index": completed_next_index,
        "last_finalized_turn_id": updated["turn_id"],
        "last_finalization_id": finalization_id,
    }
    coc_fileio.write_json_atomic(_cursor_path(campaign_dir), next_cursor)
    _pending_path(campaign_dir).unlink(missing_ok=True)
    return updated


def recover_finalized_pending(campaign_dir: Path) -> bool:
    campaign_dir = Path(campaign_dir)
    manifest = _load_pending_raw(campaign_dir)
    if manifest is None:
        return False
    receipt = _matching_finalization(
        campaign_dir, manifest["journal_decision_id"]
    )
    if receipt is None:
        return False
    finalization_id = receipt.get("finalization_id")
    if not isinstance(finalization_id, str) or not finalization_id:
        raise TurnManifestError(
            "state_corrupt", "matching finalization has no stable identity"
        )
    end_offset = None
    rows, _observed_end = _slice_rows(
        _toolbox_path(campaign_dir), manifest["source_start_offset"]
    )
    for row, row_end in rows:
        data = row.get("data") if isinstance(row.get("data"), dict) else {}
        if (
            row.get("ok") is True
            and row.get("tool") == "turn.finalize"
            and data.get("finalization_id") == finalization_id
            and data.get("journal_decision_id") == manifest["journal_decision_id"]
        ):
            end_offset = row_end
            break
    if end_offset is None:
        # A crash may occur after the immutable finalization receipt is written
        # but before its generic toolbox-call receipt is appended.  Keep the
        # turn pending so an idempotent turn.finalize replay can close it.
        return False
    _finalize_manifest_and_cursor(
        campaign_dir,
        manifest,
        finalization_id=finalization_id,
        accepted_revision=int(receipt.get("accepted_revision") or 0),
        settlement_snapshot_id=str(receipt.get("settlement_snapshot_id") or ""),
        rendered_text_sha256=str(receipt.get("rendered_text_sha256") or ""),
        contract_projection_sha256=str(receipt.get("contract_projection_sha256") or ""),
        completed_end_offset=end_offset,
    )
    return True


def pending_manifest(campaign_dir: Path) -> dict[str, Any] | None:
    campaign_dir = Path(campaign_dir)
    if recover_finalized_pending(campaign_dir):
        return None
    return _load_pending_raw(campaign_dir)


def _resume_row_projection(row: dict[str, Any], call_index: int) -> dict[str, Any]:
    args = row.get("args") if isinstance(row.get("args"), dict) else {}
    projected: dict[str, Any] = {
        "call_index": int(call_index),
        "tool": str(row.get("tool") or ""),
        "ok": row.get("ok") is True,
        "args": {
            key: deepcopy(value)
            for key, value in args.items()
            if key not in _RESUME_OMIT_ARGS
        },
    }
    if row.get("idempotent_replay") is True:
        projected["idempotent_replay"] = True
    if row.get("ok") is not True:
        projected["error"] = {
            "code": row.get("error"),
            "message": row.get("error_message"),
        }
        return projected
    data = row.get("data")
    if projected["tool"] == "actions.advise" and isinstance(data, dict):
        # Keep the small semantic/advisory handoff that matters after host
        # compaction, not the complete route catalogue already recoverable from
        # scene.context.  This preserves a stable Storylet/Push opportunity
        # without turning the resume window into a second module archive.
        data = {
            key: deepcopy(data.get(key))
            for key in (
                "schema_version", "authority", "hard_gate", "scene_id",
                "investigator_id", "intent_evidence", "resolution_advice",
                "operation_opportunities", "narrative_opportunity",
            )
            if key in data
        }
    data_digest = _digest(data)
    tool_name = projected["tool"]
    full_data = tool_name in _RESUME_FULL_DATA_TOOLS or tool_name.startswith(
        _RESUME_FULL_DATA_PREFIXES
    )
    data_size = len(
        json.dumps(
            data,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        ).encode("utf-8")
    )
    if full_data and data_size <= _RESUME_MAX_DATA_BYTES:
        projected["data"] = deepcopy(data)
    else:
        projected["data_ref"] = (
            f"logs/toolbox-calls.jsonl#call-{int(call_index)}"
        )
        projected["data_digest"] = data_digest
        projected["data_bytes"] = data_size
    return projected


def resume_window(
    campaign_dir: Path,
    *,
    meaningful_tools: Collection[str],
) -> dict[str, Any]:
    """Return a bounded projection of the current unfinalized source window.

    This is recovery evidence, not a second rules/state ledger.  Authoritative
    values remain in the cited toolbox receipts and canonical state files.
    """
    campaign_dir = Path(campaign_dir)
    boundary = effective_source_boundary(campaign_dir)
    rows, observed_end = _slice_rows(
        _toolbox_path(campaign_dir), boundary["effective_start_offset"]
    )
    meaningful_tool_ids = frozenset(str(value) for value in meaningful_tools)
    meaningful = [
        (row, row_end)
        for row, row_end in rows
        if row.get("ok") is True
        and str(row.get("tool") or "") in meaningful_tool_ids
    ]
    selected_pairs = meaningful
    omitted_for_count = 0
    if len(meaningful) > _RESUME_MAX_ROWS:
        half = _RESUME_MAX_ROWS // 2
        selected_pairs = meaningful[:half] + meaningful[-half:]
        omitted_for_count = len(meaningful) - len(selected_pairs)
    selected_ids = {id(row) for row, _end in selected_pairs}
    projections: list[dict[str, Any]] = []
    used_bytes = 0
    omitted_for_bytes = 0
    for position, (row, _row_end) in enumerate(rows):
        if (
            row.get("tool") in {"session.resume", "session.delivery_ack"}
            or id(row) not in selected_ids
        ):
            continue
        call_index = int(boundary["effective_start_index"]) + position
        projection = _resume_row_projection(row, call_index)
        size = len(
            json.dumps(
                projection,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
                default=str,
            ).encode("utf-8")
        )
        if used_bytes + size > _RESUME_MAX_TOTAL_BYTES:
            omitted_for_bytes += 1
            projections.append({
                "call_index": call_index,
                "tool": str(row.get("tool") or ""),
                "ok": row.get("ok") is True,
                "row_ref": f"logs/toolbox-calls.jsonl#call-{call_index}",
                "row_digest": _digest(row),
            })
            continue
        projections.append(projection)
        used_bytes += size
    result = {
        "schema_version": SCHEMA_VERSION,
        "source_start_offset": boundary["effective_start_offset"],
        "source_start_index": boundary["effective_start_index"],
        "observed_end_offset": observed_end,
        "source_row_count": len(rows),
        "meaningful_row_count": len(meaningful),
        "operational_row_count": len(rows) - len(meaningful),
        "projected_row_count": len(projections),
        "omitted_row_count": omitted_for_count,
        "reference_only_row_count": omitted_for_bytes,
        "overflow": bool(omitted_for_count or omitted_for_bytes),
        "source_digest": _digest([row for row, _end in rows]),
        "rows": projections,
    }
    if boundary["kind"] == "setup_handoff_virtual":
        result["setup_source_prefix_seal"] = {
            "schema_version": 1,
            "decision_id": boundary["setup_handoff"]["decision_id"],
            "sealed_source_row_count": boundary["setup_handoff"][
                "sealed_next_index"
            ],
            "effective_source_start_index": boundary["effective_start_index"],
            "cursor_closed": False,
            "cursor_close_owner": "evidence.table_opening",
        }
    return result


def uncommitted_source_rows(campaign_dir: Path) -> list[dict[str, Any]]:
    """Return the exact post-commit toolbox rows without bounded projection.

    This recovery-only source boundary must not omit rows: when session.resume
    abandons a turn tail, every rolled-back mutation decision needs the same
    invalidation disposition.
    """
    campaign_dir = Path(campaign_dir)
    boundary = effective_source_boundary(campaign_dir)
    rows, _observed_end = _slice_rows(
        _toolbox_path(campaign_dir), boundary["effective_start_offset"]
    )
    return [deepcopy(row) for row, _row_end in rows]


def start_pending_turn(
    campaign_dir: Path,
    *,
    journal_decision_id: str,
    turn_number: int,
) -> dict[str, Any]:
    campaign_dir = Path(campaign_dir)
    if not isinstance(journal_decision_id, str) or not journal_decision_id:
        raise TurnManifestError(
            "invalid_param", "state.journal requires a stable decision_id"
        )
    existing = pending_manifest(campaign_dir)
    if existing is not None:
        if existing["journal_decision_id"] == journal_decision_id:
            return existing
        raise TurnManifestError(
            "turn_finalization_pending",
            "the previous journaled turn must be finalized or repaired before another turn can close",
        )
    boundary = effective_source_boundary(campaign_dir)
    if boundary["cursor_close_owner"] == "evidence.table_opening":
        raise TurnManifestError(
            "table_opening_required",
            "evidence.table_opening must close the setup prefix before state.journal",
        )
    cursor = load_or_create_cursor(campaign_dir)
    turn_id = _turn_id(campaign_dir.name, journal_decision_id)
    now = _now_iso()
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "campaign_id": campaign_dir.name,
        "turn_id": turn_id,
        "journal_decision_id": journal_decision_id,
        "turn_number": int(turn_number),
        "status": "pending",
        "revision": 1,
        "source_start_offset": cursor["next_source_offset"],
        "source_start_index": cursor["next_source_index"],
        "observed_end_offset": cursor["next_source_offset"],
        "journal_end_offset": None,
        "journal_call_index": None,
        "repair_call_count": 0,
        "source_digest": None,
        "finalization_id": None,
        "accepted_revision": None,
        "settlement_snapshot_id": None,
        "rendered_text_sha256": None,
        "contract_projection_sha256": None,
        "completed_end_offset": None,
        "completed_next_index": None,
        "created_at": now,
        "updated_at": now,
    }
    _validate_manifest(manifest, campaign_dir.name)
    coc_fileio.write_json_atomic(_manifest_path(campaign_dir, turn_id), manifest)
    pointer = {
        "schema_version": SCHEMA_VERSION,
        "campaign_id": campaign_dir.name,
        "turn_id": turn_id,
        "journal_decision_id": journal_decision_id,
    }
    coc_fileio.write_json_atomic(_pending_path(campaign_dir), pointer)
    return manifest


def refresh_pending_window(
    campaign_dir: Path,
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    campaign_dir = Path(campaign_dir)
    manifest = pending_manifest(campaign_dir)
    if manifest is None:
        raise TurnManifestError(
            "no_unfinalized_journal",
            "record one successful state.journal before requesting final output",
        )
    rows, observed_end = _slice_rows(
        _toolbox_path(campaign_dir), manifest["source_start_offset"]
    )
    journal_position: int | None = None
    journal_row: dict[str, Any] | None = None
    journal_end_offset: int | None = None
    for position, (row, row_end) in enumerate(rows):
        args = row.get("args") if isinstance(row.get("args"), dict) else {}
        if (
            row.get("ok") is True
            and row.get("tool") == "state.journal"
            and args.get("decision_id") == manifest["journal_decision_id"]
            and row.get("idempotent_replay") is not True
        ):
            journal_position = position
            journal_row = row
            journal_end_offset = row_end
    if journal_position is None or journal_row is None or journal_end_offset is None:
        raise TurnManifestError(
            "journal_receipt_pending",
            "the journal state committed but its toolbox receipt is not yet durable; retry turn.output_context",
        )

    selected = [
        deepcopy(row)
        for row, _end in rows[: journal_position + 1]
        if row.get("idempotent_replay") is not True
    ]
    repairs: list[dict[str, Any]] = []
    retry_boundary_seen = False
    for row, _row_end in rows[journal_position + 1 :]:
        if row.get("ok") is not True:
            continue
        tool = str(row.get("tool") or "")
        args = row.get("args") if isinstance(row.get("args"), dict) else {}
        if row.get("access") == "query" or is_post_journal_read_tool(tool):
            continue
        if tool == "turn.finalize" and args.get("validate_only") is True:
            # A validate_only preflight is read-only by contract: it runs the
            # same validation and never writes a receipt, so it cannot be a
            # post-journal settlement.
            continue
        if tool == "state.journal":
            if args.get("decision_id") == manifest["journal_decision_id"]:
                # Exact journal retries remain append-only transport/audit
                # evidence. The original unmarked receipt continues to own the
                # frozen source boundary and digest.
                continue
            # A different journal after ours means a retry attempt started.
            # All subsequent rows belong to that retry, not to our turn.
            retry_boundary_seen = True
            continue
        if row.get("idempotent_replay") is True:
            # The dispatcher emits this marker only after durable proof that
            # the exact state result already existed. These two state tools are
            # the only non-journal state operations permitted to reach this
            # post-journal scan; their exact replay is audit, not settlement.
            if tool not in {
                "state.record_npc_engagement",
                "state.exceptional_effect",
            }:
                raise TurnManifestError(
                    "state_corrupt",
                    "unsupported post-journal idempotent replay marker",
                )
            continue
        if retry_boundary_seen:
            continue
        if tool in POST_JOURNAL_REPAIR_TOOLS:
            repairs.append(deepcopy(row))
            continue
        raise TurnManifestError(
            "settlement_after_journal",
            f"successful settlement occurred after state.journal: {tool}",
        )
    selected.extend(repairs)
    source_digest = _digest(selected)
    journal_call_index = manifest["source_start_index"] + journal_position
    changed = any((
        manifest["observed_end_offset"] != observed_end,
        manifest["journal_end_offset"] != journal_end_offset,
        manifest["journal_call_index"] != journal_call_index,
        manifest["repair_call_count"] != len(repairs),
        manifest["source_digest"] != source_digest,
    ))
    if changed:
        manifest = deepcopy(manifest)
        manifest.update({
            "revision": int(manifest["revision"]) + 1,
            "observed_end_offset": observed_end,
            "journal_end_offset": journal_end_offset,
            "journal_call_index": journal_call_index,
            "repair_call_count": len(repairs),
            "source_digest": source_digest,
            "updated_at": _now_iso(),
        })
        _validate_manifest(manifest, campaign_dir.name)
        coc_fileio.write_json_atomic(
            _manifest_path(campaign_dir, manifest["turn_id"]), manifest
        )
    return manifest, selected, deepcopy(journal_row)


def complete_pending_turn(
    campaign_dir: Path,
    *,
    journal_decision_id: str,
    finalization_id: str,
    accepted_revision: int,
    settlement_snapshot_id: str,
    rendered_text_sha256: str,
    contract_projection_sha256: str,
    completed_end_offset: int,
) -> dict[str, Any]:
    campaign_dir = Path(campaign_dir)
    manifest = _load_pending_raw(campaign_dir)
    if manifest is None:
        return {}
    if manifest["journal_decision_id"] != journal_decision_id:
        raise TurnManifestError(
            "state_corrupt", "finalization does not match the pending journal"
        )
    return _finalize_manifest_and_cursor(
        campaign_dir,
        manifest,
        finalization_id=finalization_id,
        accepted_revision=accepted_revision,
        settlement_snapshot_id=settlement_snapshot_id,
        rendered_text_sha256=rendered_text_sha256,
        contract_projection_sha256=contract_projection_sha256,
        completed_end_offset=completed_end_offset,
    )


def complete_undelivered_output_repair(
    campaign_dir: Path,
    *,
    journal_decision_id: str,
    previous_finalization_id: str,
    finalization_id: str,
    accepted_revision: int,
    settlement_snapshot_id: str,
    rendered_text_sha256: str,
    contract_projection_sha256: str,
    completed_end_offset: int,
) -> dict[str, Any]:
    """Advance the bounded cursor after replacing an undelivered output tail."""
    campaign_dir = Path(campaign_dir)
    # The immutable receipt swap happens before this cursor update. During
    # that narrow transaction the old cursor id is intentionally absent from
    # the already-replaced log; validate the new binding below instead.
    cursor = load_or_create_cursor(
        campaign_dir, validate_finalization_binding=False
    )
    turn_id = cursor.get("last_finalized_turn_id")
    if not isinstance(turn_id, str) or not turn_id:
        raise TurnManifestError(
            "repair_conflict", "no finalized turn is available for output repair"
        )
    cursor_finalization_id = cursor.get("last_finalization_id")
    if cursor_finalization_id not in {
        previous_finalization_id,
        finalization_id,
    }:
        raise TurnManifestError(
            "repair_conflict", "output repair does not match the current cursor tail"
        )
    expected_manifest_finalization_id = (
        finalization_id
        if cursor_finalization_id == finalization_id
        else previous_finalization_id
    )
    manifest_path = _manifest_path(campaign_dir, turn_id)
    if not manifest_path.is_file():
        raise TurnManifestError(
            "state_corrupt", "finalized output repair points to a missing turn manifest"
        )
    manifest = _validate_manifest(
        _read_object(manifest_path, code="state_corrupt"), campaign_dir.name
    )
    if (
        manifest.get("status") != "finalized"
        or manifest.get("journal_decision_id") != journal_decision_id
        or manifest.get("finalization_id")
        != expected_manifest_finalization_id
    ):
        raise TurnManifestError(
            "repair_conflict", "output repair does not match the finalized turn manifest"
        )
    start_offset = int(cursor["next_source_offset"])
    start_index = int(cursor["next_source_index"])
    if completed_end_offset < start_offset:
        raise TurnManifestError(
            "state_corrupt", "output repair completion precedes the turn cursor"
        )
    row_count = _count_rows(
        _toolbox_path(campaign_dir), start_offset, completed_end_offset
    )
    completed_next_index = start_index + row_count
    updated = deepcopy(manifest)
    updated.update({
        "revision": int(manifest["revision"]) + 1,
        "finalization_id": finalization_id,
        "accepted_revision": accepted_revision,
        "settlement_snapshot_id": settlement_snapshot_id,
        "rendered_text_sha256": rendered_text_sha256,
        "contract_projection_sha256": contract_projection_sha256,
        "completed_end_offset": completed_end_offset,
        "completed_next_index": completed_next_index,
        "updated_at": _now_iso(),
    })
    _validate_manifest(updated, campaign_dir.name)
    coc_fileio.write_json_atomic(manifest_path, updated)
    next_cursor = {
        **cursor,
        "next_source_offset": completed_end_offset,
        "next_source_index": completed_next_index,
        "last_finalization_id": finalization_id,
    }
    _validate_cursor(next_cursor, campaign_dir.name)
    coc_fileio.write_json_atomic(_cursor_path(campaign_dir), next_cursor)
    return updated


def manifest_path(campaign_dir: Path, turn_id: str) -> Path:
    """Public path helper for deterministic tests and report/audit consumers."""
    return _manifest_path(Path(campaign_dir), turn_id)


# --------------------------------------------------------------------------- #
# Commit snapshots (finalization = turn commit point) and turn-tail restore
# --------------------------------------------------------------------------- #

COMMIT_SNAPSHOT_DIRNAME = "commit-snapshots"

# Durable domains that are NOT turn-scoped: session-level settlement,
# table-session cursor, and idempotency/receipt bookkeeping must survive a
# turn-tail restore.
_COMMIT_SNAPSHOT_EXCLUDES = frozenset({
    COMMIT_SNAPSHOT_DIRNAME,
    "development-settlements",
    "session-state.json",
    "toolbox-ledger.json",
    "roll-operation-receipts.json",
})


def _commit_snapshot_safe_id(finalization_id: str) -> str:
    safe = "".join(
        char if (char.isalnum() or char in "._-") else "-"
        for char in str(finalization_id)
    )
    return safe or "unknown-finalization"


def write_commit_snapshot(campaign_dir: Path, finalization_id: str) -> Path:
    """Freeze turn-scoped save/ content as of one successful finalization.

    Idempotent per finalization id.  The snapshot is the only legitimate
    restore source when a later unfinalized turn tail must be rolled back.
    """
    save_dir = Path(campaign_dir) / "save"
    destination = (
        save_dir / COMMIT_SNAPSHOT_DIRNAME / _commit_snapshot_safe_id(finalization_id)
    )
    if destination.is_dir():
        return destination
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(
        save_dir,
        destination,
        ignore=shutil.ignore_patterns(*_COMMIT_SNAPSHOT_EXCLUDES),
    )
    return destination


def latest_commit_snapshot(campaign_dir: Path) -> tuple[str, Path] | None:
    """Return (finalization_id, snapshot_dir) of the newest commit snapshot."""
    finalizations_path = Path(campaign_dir) / FINALIZATION_LOG
    last_id: str | None = None
    if finalizations_path.is_file():
        for raw in finalizations_path.read_text(encoding="utf-8").splitlines():
            if not raw.strip():
                continue
            try:
                row = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict) and isinstance(row.get("finalization_id"), str):
                last_id = row["finalization_id"]
    if not last_id:
        return None
    path = (
        Path(campaign_dir)
        / "save"
        / COMMIT_SNAPSHOT_DIRNAME
        / _commit_snapshot_safe_id(last_id)
    )
    return (last_id, path) if path.is_dir() else None


def restore_save_from_snapshot(campaign_dir: Path, snapshot_dir: Path) -> None:
    """Restore turn-scoped save/ content from one commit snapshot.

    Durable non-turn domains are excluded on both sides; abandoned-turn
    evidence stays in logs/ (marked, never deleted).
    """
    save_dir = Path(campaign_dir) / "save"
    snapshot_dir = Path(snapshot_dir)
    save_dir.mkdir(parents=True, exist_ok=True)
    for child in save_dir.iterdir():
        if child.name in _COMMIT_SNAPSHOT_EXCLUDES:
            continue
        if child.is_dir() and not child.is_symlink():
            shutil.rmtree(child)
        else:
            child.unlink()
    for child in snapshot_dir.iterdir():
        if child.name in _COMMIT_SNAPSHOT_EXCLUDES:
            continue
        target = save_dir / child.name
        if child.is_dir():
            shutil.copytree(child, target)
        else:
            shutil.copy2(child, target)
