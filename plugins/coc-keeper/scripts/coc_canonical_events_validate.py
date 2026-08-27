#!/usr/bin/env python3
"""Completeness validator for the canonical COC campaign event stream.

Plan task t7 (`coc-events-1`). Read-only audit of one campaign's derived
canonical-event evidence against its **structured receipts** — never prose:

- Every required public/``consequence_public`` roll receipt
  (``save/roll-operation-receipts.json``, player-facing rule from
  ``coc_turn_finalization.is_player_facing_roll``) must have exactly one
  matching ``roll-resolved`` event whose payload numbers equal the
  receipt's authoritative numbers (result level, target value, die total).
  Optional payload numbers absent while the receipt carries them are a
  wiring-gap warning; wrong numbers are errors.
- Every ``logs/turn-finalizations.jsonl`` receipt must have exactly one
  ``turn-finalized`` event bound by ``finalization_id``; orphaned events
  with no receipt fail as well.
- Per ``(campaign, timeline)`` sequences hold no duplicates and no
  ordering regressions, judged under the durable allocator's crash-gap
  semantics: holes up to the persisted cursor value
  (``logs/canonical-events-sequence.json``) are permitted
  allocated-but-unwritten gaps; values beyond the cursor, holes without
  cursor certification, and order regressions are malformed streams.
- ``decision_id`` idempotency law holds in the stored stream: the same
  decision never forks into differing events. Matching everywhere is
  whole-string structural identity — no keyword, prose, or content
  inference ever assigns meaning (semantic matcher constitution).
- The t2 choke-point uncovered-writes ledger is reported as wiring
  coverage (count + semantic refs); it is never fatal by itself.

Exit discipline follows ``checks/exhaustive_rulebook_validator.py``:
0 pass, 1 findings with errors (error findings win over vacuity), and —
a pass over zero records is not a pass — 2 when nothing at all was
validated. Explicit zero counts are always reported, never omitted.

Turn-range scoping drops turn-stamped requirements outside the range;
evidence carrying no explicit turn stamp stays in scope.

ACTIVE_IMPLEMENTATION_TRACK=pi-coc. Codex-track files are untouched;
this module consumes only ``coc_canonical_events`` APIs and files.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Mapping

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import coc_canonical_events as cev
from coc_turn_finalization import FINALIZATION_SCHEMA_VERSION, is_player_facing_roll

VALIDATOR_NAME = "coc_canonical_events_validate"

STATUS_PASS = "PASS"
STATUS_FAIL = "FAIL"
STATUS_NOT_PROVEN = "NOT_PROVEN"

SEVERITY_ERROR = "error"
SEVERITY_WARNING = "warning"
SEVERITY_INFO = "info"

#: Fail-closed reason codes (stable machine-readable field values).
CODE_CAMPAIGN_MISSING = "campaign_missing"
CODE_MALFORMED_JSON = "malformed_stream_json"
CODE_ROW_NOT_OBJECT = "stream_row_not_object"
CODE_ENVELOPE_INVALID = "envelope_invalid"
CODE_DUPLICATE_EVENT_ID = "duplicate_event_id"
CODE_DECISION_ID_CONFLICT = "decision_id_conflict"
CODE_CAMPAIGN_IDENTITY_MISMATCH = "campaign_identity_mismatch"
CODE_DUPLICATE_SEQUENCE = "duplicate_sequence"
CODE_SEQUENCE_REGRESSION = "sequence_order_regression"
CODE_SEQUENCE_BEYOND_CURSOR = "sequence_beyond_cursor"
CODE_SEQUENCE_CURSOR_CORRUPT = "sequence_cursor_corrupt"
CODE_SEQUENCE_CURSOR_ABSENT = "sequence_cursor_absent"
CODE_UNCERTIFIED_GAP = "uncertified_sequence_gap"
CODE_ROLL_RECEIPT_DOCUMENT_SCHEMA = "roll_receipt_document_schema"
CODE_ROLL_RECEIPT_MALFORMED = "roll_receipt_malformed"
CODE_ROLL_RECEIPT_CONFLICT = "roll_receipt_conflict"
CODE_ROLL_EVENT_MISSING = "roll_event_missing"
CODE_ROLL_EVENT_DUPLICATE = "roll_event_duplicate"
CODE_ROLL_LEVEL_MISMATCH = "roll_result_level_mismatch"
CODE_ROLL_TARGET_MISMATCH = "roll_target_value_mismatch"
CODE_ROLL_TOTAL_MISMATCH = "roll_dice_total_mismatch"
CODE_ROLL_NUMBERS_ABSENT = "roll_numbers_absent"
CODE_FINALIZATION_SCHEMA = "finalization_receipt_schema"
CODE_FINALIZATION_MALFORMED = "finalization_receipt_malformed"
CODE_FINALIZATION_CONFLICT = "finalization_receipt_conflict"
CODE_FINALIZATION_EVENT_MISSING = "finalization_event_missing"
CODE_FINALIZATION_EVENT_DUPLICATE = "finalization_event_duplicate"
CODE_FINALIZATION_ORPHAN_EVENT = "finalization_event_orphan"
CODE_UNCOVERED_ROW_MALFORMED = "uncovered_ledger_row_malformed"

#: Informational codes (wiring coverage / crash-gap bookkeeping; never fatal).
INFO_CRASH_GAP = "crash_gap_permitted"
INFO_ALLOCATED_TAIL = "allocated_unwritten_tail"

_MAX_LISTED_REFS = 8

_DICE_TOTAL_RE = re.compile(r"=(-?\d+)\s*$")


class CampaignNotFoundError(LookupError):
    """Raised when the requested campaign directory does not exist."""


# ---------------------------------------------------------------------------
# Findings and the structured result
# ---------------------------------------------------------------------------


@dataclass
class Finding:
    severity: str
    code: str
    message: str
    detail: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "severity": self.severity,
            "code": self.code,
            "message": self.message,
            "detail": self.detail,
        }


@dataclass
class ValidateResult:
    root: Path
    campaign: str
    turn_from: int | None
    turn_to: int | None
    status: str
    findings: list[Finding]
    counts: dict[str, Any]
    timelines: dict[str, dict[str, Any]]
    uncovered_ledger: dict[str, Any]

    @property
    def errors(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == SEVERITY_ERROR]

    @property
    def ok(self) -> bool:
        return self.status == STATUS_PASS

    @property
    def exit_code(self) -> int:
        if self.status == STATUS_FAIL:
            return 1
        if self.status == STATUS_NOT_PROVEN:
            # Error findings prove something *was* inspected (and broken);
            # only a truly vacuous sweep refuses success with exit 2.
            return 2 if not self.errors else 1
        return 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "validator": VALIDATOR_NAME,
            "schema_generation": cev.SCHEMA_GENERATION,
            "root": str(self.root),
            "campaign": self.campaign,
            "turn_from": self.turn_from,
            "turn_to": self.turn_to,
            "status": self.status,
            "exit_code": self.exit_code,
            "counts": self.counts,
            "timelines": self.timelines,
            "uncovered_ledger": self.uncovered_ledger,
            "findings": [finding.to_dict() for finding in self.findings],
        }

    def render_lines(self) -> list[str]:
        counts = self.counts
        lines = [
            f"== canonical-events validator ({cev.SCHEMA_GENERATION}) ==",
            f"campaign: {self.campaign}" + _range_suffix(self.turn_from, self.turn_to),
            (
                f"STREAM: {counts['canonical_events_scanned']} line(s) scanned, "
                f"{counts['canonical_events']} validated"
            ),
        ]
        for timeline, stats in sorted(self.timelines.items()):
            allocated = stats["allocated_through"]
            gaps = stats["crash_gaps"]
            gap_note = "none" if not gaps else _format_refs(gaps)
            lines.append(
                f"TIMELINE {timeline}: {stats['written']} written | "
                f"max_written {stats['max_written']} | "
                f"allocated_through "
                f"{allocated if allocated is not None else 'n/a'} | "
                f"crash gaps: {gap_note}"
            )
        lines.append(
            f"ROLLS: {counts['required_rolls']} required public/"
            f"consequence_public receipt(s) -> paired {counts['rolls_paired']}, "
            f"missing {counts['rolls_missing']}, duplicated "
            f"{counts['rolls_duplicated']}, number mismatches "
            f"{counts['rolls_number_mismatches']}"
        )
        if counts["explicit_zero_rolls"]:
            lines.append(
                "ROLLS: explicit zero-roll count — no required roll receipts in scope"
            )
        lines.append(
            f"FINALIZATIONS: {counts['finalization_receipts']} receipt(s) -> "
            f"{counts['finalizations_paired']} paired turn-finalized event(s)"
        )
        if counts["explicit_zero_finalizations"]:
            lines.append(
                "FINALIZATIONS: explicit zero-count — no finalization receipts in scope"
            )
        uncovered = self.uncovered_ledger
        lines.append(
            f"UNCOVERED WRITES (wiring coverage, non-fatal): "
            f"{uncovered['count']} ledger row(s)"
        )
        for ref in uncovered["refs"][:_MAX_LISTED_REFS]:
            lines.append(
                f"    {ref.get('stream')} turn={ref.get('turn')} "
                f"key={ref.get('record_key')}"
            )
        if uncovered["count"] > _MAX_LISTED_REFS:
            lines.append(f"    ... +{uncovered['count'] - _MAX_LISTED_REFS} more")
        error_count = len(self.errors)
        warning_count = len(
            [f for f in self.findings if f.severity == SEVERITY_WARNING]
        )
        lines.append(f"FINDINGS: {error_count} error(s), {warning_count} warning(s)")
        for finding in self.findings:
            if finding.severity == SEVERITY_INFO:
                continue
            lines.append(
                f"  {finding.severity.upper()} [{finding.code}] {finding.message}"
            )
        if self.status == STATUS_NOT_PROVEN:
            lines.append(
                "STATUS: NOT_PROVEN — nothing was validated over this scope "
                "(a pass over zero records is not a pass)"
            )
        else:
            lines.append(f"STATUS: {self.status}")
        return lines


def _range_suffix(turn_from: int | None, turn_to: int | None) -> str:
    if turn_from is None and turn_to is None:
        return ""
    low = turn_from if turn_from is not None else "-"
    high = turn_to if turn_to is not None else "-"
    return f"   turns: {low}..{high}"


def _format_refs(values: Iterable[Any]) -> str:
    items = list(values)
    head = ", ".join(_ref_text(item) for item in items[:_MAX_LISTED_REFS])
    if len(items) > _MAX_LISTED_REFS:
        head += f" ...(+{len(items) - _MAX_LISTED_REFS} more)"
    return head


def _ref_text(value: Any) -> str:
    if isinstance(value, Mapping):
        parts = [
            str(value[name])
            for name in ("stream", "turn", "record_key")
            if value.get(name) is not None
        ]
        return "/".join(parts) if parts else json.dumps(value, ensure_ascii=False)
    return str(value)


# ---------------------------------------------------------------------------
# Small structural readers (machine fields only; no prose inference)
# ---------------------------------------------------------------------------


def _iter_jsonl(path: Path) -> Iterable[tuple[int, Any, str | None]]:
    """Yield ``(line_number, parsed_or_None, json_error_or_None)`` rows."""
    if not path.is_file():
        return
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                yield line_number, json.loads(stripped), None
            except json.JSONDecodeError as exc:
                yield line_number, None, str(exc)


def _pick_int(*sources: Any, names: tuple[str, ...]) -> int | None:
    for source in sources:
        if not isinstance(source, Mapping):
            continue
        for name in names:
            value = source.get(name)
            if isinstance(value, int) and not isinstance(value, bool):
                return value
    return None


def _record_turn(*sources: Any) -> int | None:
    return _pick_int(*sources, names=("turn_number", "turn"))


def _exact_turn(row: Mapping[str, Any]) -> int | None:
    value = row.get("turn")
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    return None


def _in_turn_range(turn: int | None, low: int | None, high: int | None) -> bool:
    """Turn-stamped evidence outside the range drops out; unstamped evidence
    stays in scope (loud over-inclusion beats silent skipping)."""
    if turn is None:
        return True
    if low is not None and turn < low:
        return False
    if high is not None and turn > high:
        return False
    return True


def _normal_number(value: Any) -> int | None:
    """Exact integers and integral numeric scalars only; anything else is
    not an authoritative number."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


def _event_dice_total(event_data: Mapping[str, Any]) -> int | None:
    """Machine-parse the total from the rendered dice scalar (``1d100=21``);
    deterministic string grammar, never free prose."""
    dice = event_data.get("dice")
    if isinstance(dice, str):
        match = _DICE_TOTAL_RE.search(dice)
        if match:
            return int(match.group(1))
    return _normal_number(dice)


# ---------------------------------------------------------------------------
# Canonical-stream load
# ---------------------------------------------------------------------------


@dataclass
class StreamSnapshot:
    scanned: int = 0
    valid: list[Mapping[str, Any]] = field(default_factory=list)
    rows_by_decision: dict[str, list[Mapping[str, Any]]] = field(
        default_factory=dict
    )


def _load_canonical_stream(
    campaign_logs_dir: Path, campaign_id: str, findings: list[Finding]
) -> StreamSnapshot:
    snapshot = StreamSnapshot()
    seen_ids: dict[str, int] = {}
    for line_no, row, error in _iter_jsonl(cev.canonical_stream_path(campaign_logs_dir)):
        snapshot.scanned += 1
        if error is not None:
            findings.append(Finding(
                SEVERITY_ERROR, CODE_MALFORMED_JSON,
                f"canonical-events.jsonl line {line_no} is not JSON: {error}",
                {"line": line_no},
            ))
            continue
        if not isinstance(row, Mapping):
            findings.append(Finding(
                SEVERITY_ERROR, CODE_ROW_NOT_OBJECT,
                f"canonical-events.jsonl line {line_no} is not an object",
                {"line": line_no},
            ))
            continue

        event_campaign = row.get("campaign")
        if isinstance(event_campaign, str) and event_campaign != campaign_id:
            findings.append(Finding(
                SEVERITY_ERROR, CODE_CAMPAIGN_IDENTITY_MISMATCH,
                f"line {line_no} carries campaign={event_campaign!r} inside "
                f"campaign {campaign_id}'s own stream",
                {"line": line_no, "campaign": event_campaign},
            ))

        decision_id = row.get("decision_id")
        if isinstance(decision_id, str) and decision_id:
            snapshot.rows_by_decision.setdefault(decision_id, []).append(row)

        event_id = row.get("id")
        if isinstance(event_id, str) and event_id:
            first_line = seen_ids.setdefault(event_id, line_no)
            if first_line != line_no:
                findings.append(Finding(
                    SEVERITY_ERROR, CODE_DUPLICATE_EVENT_ID,
                    f"event id {event_id!r} appears twice (lines {first_line} "
                    f"and {line_no})",
                    {"id": event_id, "lines": [first_line, line_no]},
                ))

        try:
            cev.validate_event(row)
        except cev.CanonicalEventsContractError as exc:
            findings.append(Finding(
                SEVERITY_ERROR, CODE_ENVELOPE_INVALID,
                f"canonical-events.jsonl line {line_no} fails the frozen "
                f"contract: {type(exc).__name__}: {exc}",
                {"line": line_no},
            ))
        else:
            snapshot.valid.append(row)
    return snapshot


def _audit_decision_replay(snapshot: StreamSnapshot, findings: list[Finding]) -> None:
    """Stored-stream idempotency law: one decision id, one fact."""
    for decision_id, rows in sorted(snapshot.rows_by_decision.items()):
        if len(rows) < 2:
            continue
        try:
            for other in rows[1:]:
                cev.resolve_duplicate(rows[0], other)
        except cev.DuplicateDecisionIdError:
            findings.append(Finding(
                SEVERITY_ERROR, CODE_DECISION_ID_CONFLICT,
                f"decision_id {decision_id!r} appears with differing content; "
                "one settled decision is one event",
                {"decision_id": decision_id, "rows": len(rows)},
            ))


# ---------------------------------------------------------------------------
# Durable sequence state vs stream arithmetic (crash-gap semantics)
# ---------------------------------------------------------------------------


def _audit_sequences(
    campaign_logs_dir: Path,
    snapshot: StreamSnapshot,
    findings: list[Finding],
) -> dict[str, dict[str, Any]]:
    """Per-(campaign, timeline) sequence audit over every parsable row.

    A physically written line stays allocation evidence even when its
    envelope fails validation, so arithmetic uses parsed mappings directly.
    Holes <= durable cursor: permitted allocated-but-unwritten crash gaps.
    Values beyond the cursor, uncursored certification gaps, duplicates,
    and order regressions: malformed stream.
    """
    ordered: dict[str, list[int]] = {}
    for _, row, _ in _iter_jsonl(cev.canonical_stream_path(campaign_logs_dir)):
        if not isinstance(row, Mapping):
            continue
        timeline = row.get("timeline")
        sequence = row.get("sequence")
        if not isinstance(timeline, str):
            continue
        if not isinstance(sequence, int) or isinstance(sequence, bool):
            continue
        ordered.setdefault(timeline, []).append(sequence)

    counters: dict[str, int] | None = {}
    cursor_file = cev.sequence_cursor_path(campaign_logs_dir)
    if cursor_file.is_file():
        try:
            raw = json.loads(cursor_file.read_text(encoding="utf-8"))
            loaded = raw.get("counters") if isinstance(raw, Mapping) else None
            counters = {
                timeline: value
                for timeline, value in (loaded or {}).items()
                if isinstance(value, int) and not isinstance(value, bool)
            }
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            findings.append(Finding(
                SEVERITY_ERROR, CODE_SEQUENCE_CURSOR_CORRUPT,
                f"durable sequence cursor is unreadable: {exc}",
                {"path": str(cursor_file)},
            ))
            counters = None
    elif snapshot.scanned:
        findings.append(Finding(
            SEVERITY_WARNING, CODE_SEQUENCE_CURSOR_ABSENT,
            "canonical stream holds rows but the durable allocator cursor "
            "canonical-events-sequence.json is absent; holes cannot be "
            "certified as allocated-but-unwritten",
            {},
        ))

    stats: dict[str, dict[str, Any]] = {}
    for timeline, sequences in sorted(ordered.items()):
        seen: set[int] = set()
        duplicates: list[int] = []
        regressions: list[list[int]] = []
        previous: int | None = None
        for sequence in sequences:
            if sequence in seen and sequence not in duplicates:
                duplicates.append(sequence)
            if previous is not None and sequence <= previous:
                regressions.append([previous, sequence])
            seen.add(sequence)
            previous = sequence

        max_written = max(sequences) if sequences else None
        min_written = min(sequences) if sequences else None
        allocated = counters.get(timeline) if counters is not None else None

        beyond: list[int] = []
        crash_gaps: list[int] = []
        uncertified: list[int] = []
        tail_unwritten: list[int] = []
        if max_written is not None:
            if allocated is None:
                uncertified.extend(
                    value for value in range(min_written, max_written + 1)
                    if value not in seen
                )
            else:
                beyond = [
                    value for value in dict.fromkeys(sequences) if value > allocated
                ]
                holes = [
                    value for value in range(1, max_written + 1) if value not in seen
                ]
                crash_gaps = [value for value in holes if value <= allocated]
                uncertified.extend(value for value in holes if value > allocated)
                tail_unwritten = list(range(max_written + 1, allocated + 1))

        stats[timeline] = {
            "written": len(sequences),
            "min_written": min_written,
            "max_written": max_written,
            "allocated_through": allocated,
            "duplicates": duplicates,
            "regressions": regressions,
            "beyond_cursor": beyond,
            "crash_gaps": crash_gaps,
            "uncertified_gaps": uncertified,
            "tail_unwritten": tail_unwritten,
        }

        detail_finding_map = (
            (duplicates, CODE_DUPLICATE_SEQUENCE, SEVERITY_ERROR),
            ([pair[0] for pair in regressions], CODE_SEQUENCE_REGRESSION, SEVERITY_ERROR),
        )
        del detail_finding_map
        for sequence in duplicates:
            findings.append(Finding(
                SEVERITY_ERROR, CODE_DUPLICATE_SEQUENCE,
                f"timeline {timeline}: sequence {sequence} is written more than "
                "once; the allocator never reissues a used sequence",
                {"timeline": timeline, "sequence": sequence},
            ))
        for before, after in regressions:
            findings.append(Finding(
                SEVERITY_ERROR, CODE_SEQUENCE_REGRESSION,
                f"timeline {timeline}: file order regresses {before} -> {after}; "
                "appends follow allocation order",
                {"timeline": timeline, "from": before, "to": after},
            ))
        for sequence in beyond:
            findings.append(Finding(
                SEVERITY_ERROR, CODE_SEQUENCE_BEYOND_CURSOR,
                f"timeline {timeline}: written sequence {sequence} exceeds the "
                f"durable allocator cursor ({allocated})",
                {"timeline": timeline, "sequence": sequence},
            ))
        for sequence in uncertified:
            findings.append(Finding(
                SEVERITY_ERROR, CODE_UNCERTIFIED_GAP,
                f"timeline {timeline}: sequence {sequence} is missing and no "
                "durable allocation state certifies it was ever allocated",
                {"timeline": timeline, "sequence": sequence},
            ))
        if crash_gaps:
            findings.append(Finding(
                SEVERITY_INFO, INFO_CRASH_GAP,
                f"timeline {timeline}: {len(crash_gaps)} permitted "
                f"allocated-but-unwritten gap(s) within cursor {allocated}: "
                + _format_refs(crash_gaps),
                {"timeline": timeline, "gaps": crash_gaps},
            ))
        if tail_unwritten:
            findings.append(Finding(
                SEVERITY_INFO, INFO_ALLOCATED_TAIL,
                f"timeline {timeline}: {len(tail_unwritten)} "
                f"allocated-but-unwritten sequence(s) above max_written "
                f"{max_written}",
                {"timeline": timeline, "sequences": tail_unwritten},
            ))
    return stats


# ---------------------------------------------------------------------------
# Structured receipts
# ---------------------------------------------------------------------------


@dataclass
class RollReceiptRecord:
    roll_id: str
    tool: str
    decision_id: str
    visibility: Any
    player_facing: bool
    outcome: str | None
    target: int | None
    total: int | None
    turn: int | None
    body: Mapping[str, Any]


def _load_roll_receipts(
    campaign_dir: Path, findings: list[Finding]
) -> list[RollReceiptRecord]:
    """Parse ``save/roll-operation-receipts.json`` (document schema v6) into
    identity + authoritative-number records. Fail closed on schema drift."""
    path = campaign_dir / "save" / "roll-operation-receipts.json"
    if not path.is_file():
        return []
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        findings.append(Finding(
            SEVERITY_ERROR, CODE_ROLL_RECEIPT_DOCUMENT_SCHEMA,
            f"save/roll-operation-receipts.json is unreadable: {exc}",
            {"path": str(path)},
        ))
        return []
    if (
        not isinstance(document, Mapping)
        or document.get("schema_version") != 6
        or not isinstance(document.get("receipts"), Mapping)
    ):
        findings.append(Finding(
            SEVERITY_ERROR, CODE_ROLL_RECEIPT_DOCUMENT_SCHEMA,
            "save/roll-operation-receipts.json does not carry the current "
            "document schema (schema_version=6 with a receipts decision map)",
            {"path": str(path)},
        ))
        return []

    flat: list[RollReceiptRecord] = []
    for tool, decisions in sorted(document["receipts"].items()):
        if not isinstance(decisions, Mapping):
            findings.append(Finding(
                SEVERITY_ERROR, CODE_ROLL_RECEIPT_MALFORMED,
                f"receipts[{tool!r}] is not a decision-id map",
                {"tool": str(tool)},
            ))
            continue
        for decision_id, receipt in sorted(decisions.items()):
            record = _roll_receipt_record(tool, decision_id, receipt, findings)
            if record is not None:
                flat.append(record)

    # One roll_id is one actual dice event: byte-equal replays collapse;
    # conflicting bodies are integrity failures.
    flat.sort(key=lambda record: record.roll_id)
    unique: list[RollReceiptRecord] = []
    previous: RollReceiptRecord | None = None
    for record in flat:
        if previous is not None and previous.roll_id == record.roll_id:
            if cev.canonical_json(previous.body) == cev.canonical_json(record.body):
                continue
            findings.append(Finding(
                SEVERITY_ERROR, CODE_ROLL_RECEIPT_CONFLICT,
                f"two roll receipts claim roll_id {record.roll_id} with "
                f"different content ({previous.tool}/{previous.decision_id} vs "
                f"{record.tool}/{record.decision_id})",
                {"roll_id": record.roll_id},
            ))
            continue
        unique.append(record)
        previous = record
    return unique


def _roll_receipt_record(
    tool: Any, decision_id: Any, receipt: Any, findings: list[Finding]
) -> RollReceiptRecord | None:
    label = f"receipts[{tool}.{decision_id}]"
    if not isinstance(receipt, Mapping):
        findings.append(Finding(
            SEVERITY_ERROR, CODE_ROLL_RECEIPT_MALFORMED,
            f"{label} is not an object", {"tool": str(tool)},
        ))
        return None
    roll_record = receipt.get("roll_record")
    roll_id = receipt.get("roll_id")
    if not isinstance(roll_record, Mapping) or not isinstance(roll_id, str) or not roll_id:
        findings.append(Finding(
            SEVERITY_ERROR, CODE_ROLL_RECEIPT_MALFORMED,
            f"{label} lacks a structured roll_record with a roll_id",
            {"tool": str(tool), "decision_id": str(decision_id)},
        ))
        return None
    payload = roll_record.get("payload")
    outcome_raw = next(
        (
            value
            for value in (
                roll_record.get("outcome"),
                payload.get("outcome") if isinstance(payload, Mapping) else None,
            )
            if isinstance(value, str) and value.casefold() in cev.ROLL_RESULT_LEVELS
        ),
        None,
    )
    return RollReceiptRecord(
        roll_id=roll_id,
        tool=str(tool),
        decision_id=str(decision_id),
        visibility=roll_record.get("visibility"),
        player_facing=is_player_facing_roll(dict(roll_record)),
        outcome=outcome_raw.casefold() if outcome_raw else None,
        target=_pick_int(roll_record, payload, names=("target",)),
        total=_pick_int(roll_record, payload, names=("roll", "final_total")),
        turn=_record_turn(roll_record, payload),
        body=receipt,
    )


def _compare_roll_numbers(
    record: RollReceiptRecord,
    event: Mapping[str, Any],
    findings: list[Finding],
) -> int:
    """Report every numeric divergence between receipt and event payload."""
    data = event["data"]
    assert isinstance(data, Mapping)
    mismatches = 0
    roll_id = record.roll_id

    if record.outcome is not None:
        level = data.get("result_level")
        if level != record.outcome:
            mismatches += 1
            findings.append(Finding(
                SEVERITY_ERROR, CODE_ROLL_LEVEL_MISMATCH,
                f"roll {roll_id}: event result_level={level!r} but the receipt's "
                f"authoritative outcome is {record.outcome!r}",
                {"roll_id": roll_id, "event": level, "receipt": record.outcome},
            ))

    if record.target is not None:
        value = data.get("target_value")
        normalized = _normal_number(value)
        if value is None:
            findings.append(Finding(
                SEVERITY_WARNING, CODE_ROLL_NUMBERS_ABSENT,
                f"roll {roll_id}: event omits optional target_value although the "
                "receipt carries that authoritative number (additive wiring gap)",
                {"roll_id": roll_id, "field": "target_value"},
            ))
        elif normalized != record.target:
            mismatches += 1
            findings.append(Finding(
                SEVERITY_ERROR, CODE_ROLL_TARGET_MISMATCH,
                f"roll {roll_id}: event target_value={value!r} but the receipt's "
                f"authoritative target is {record.target}",
                {"roll_id": roll_id, "event": value, "receipt": record.target},
            ))

    if record.total is not None:
        event_total = _event_dice_total(data)
        if event_total is None:
            findings.append(Finding(
                SEVERITY_WARNING, CODE_ROLL_NUMBERS_ABSENT,
                f"roll {roll_id}: event omits optional dice although the receipt "
                "carries that authoritative number (additive wiring gap)",
                {"roll_id": roll_id, "field": "dice"},
            ))
        elif event_total != record.total:
            mismatches += 1
            findings.append(Finding(
                SEVERITY_ERROR, CODE_ROLL_TOTAL_MISMATCH,
                f"roll {roll_id}: event dice total={event_total} but the "
                f"receipt's authoritative die result is {record.total}",
                {"roll_id": roll_id, "event": event_total, "receipt": record.total},
            ))
    return mismatches


def _match_required_rolls(
    records: list[RollReceiptRecord],
    snapshot: StreamSnapshot,
    turn_from: int | None,
    turn_to: int | None,
    findings: list[Finding],
) -> dict[str, int]:
    roll_events = [
        row for row in snapshot.valid if row.get("type") == "roll-resolved"
    ]
    counters = {
        "in_scope": 0,
        "paired": 0,
        "missing": 0,
        "duplicated": 0,
        "number_mismatches": 0,
    }
    for record in records:
        if not record.player_facing:
            continue
        if not _in_turn_range(record.turn, turn_from, turn_to):
            continue
        counters["in_scope"] += 1
        roll_id = record.roll_id
        candidates = [
            row for row in roll_events
            if isinstance(row.get("data"), Mapping)
            and row["data"].get("roll_id") == roll_id
        ]
        if not candidates:
            counters["missing"] += 1
            findings.append(Finding(
                SEVERITY_ERROR, CODE_ROLL_EVENT_MISSING,
                f"required {record.visibility} roll receipt {roll_id} "
                f"({record.tool}) has no roll-resolved canonical event",
                {"roll_id": roll_id, "tool": record.tool,
                 "decision_id": record.decision_id},
            ))
            continue
        if len(candidates) > 1:
            counters["duplicated"] += 1
            findings.append(Finding(
                SEVERITY_ERROR, CODE_ROLL_EVENT_DUPLICATE,
                f"roll {roll_id} is resolved by {len(candidates)} roll-resolved "
                "events; one fact is one event",
                {"roll_id": roll_id,
                 "ids": [str(row.get("id")) for row in candidates]},
            ))
            continue
        mismatches = _compare_roll_numbers(record, candidates[0], findings)
        counters["number_mismatches"] += mismatches
        if mismatches == 0:
            counters["paired"] += 1
    return counters


def _load_finalization_receipts(
    campaign_logs_dir: Path, findings: list[Finding]
) -> dict[str, Mapping[str, Any]]:
    receipts: dict[str, Mapping[str, Any]] = {}
    path = campaign_logs_dir / "turn-finalizations.jsonl"
    for line_no, row, error in _iter_jsonl(path):
        if error is not None or not isinstance(row, Mapping):
            findings.append(Finding(
                SEVERITY_ERROR, CODE_FINALIZATION_MALFORMED,
                f"turn-finalizations.jsonl line {line_no} is not a receipt object",
                {"line": line_no},
            ))
            continue
        if row.get("schema_version") != FINALIZATION_SCHEMA_VERSION:
            findings.append(Finding(
                SEVERITY_ERROR, CODE_FINALIZATION_SCHEMA,
                f"turn-finalizations.jsonl line {line_no} carries "
                f"schema_version={row.get('schema_version')!r}, not the current "
                f"{FINALIZATION_SCHEMA_VERSION}",
                {"line": line_no},
            ))
            continue
        fin_id = row.get("finalization_id")
        if not isinstance(fin_id, str) or not fin_id:
            findings.append(Finding(
                SEVERITY_ERROR, CODE_FINALIZATION_MALFORMED,
                f"turn-finalizations.jsonl line {line_no} has no finalization_id",
                {"line": line_no},
            ))
            continue
        prior = receipts.setdefault(fin_id, row)
        if prior is not row:
            if cev.canonical_json(prior) != cev.canonical_json(row):
                findings.append(Finding(
                    SEVERITY_ERROR, CODE_FINALIZATION_CONFLICT,
                    f"finalization_id {fin_id} has conflicting receipt bodies",
                    {"finalization_id": fin_id},
                ))
    return receipts


def _match_finalizations(
    campaign_logs_dir: Path,
    snapshot: StreamSnapshot,
    findings: list[Finding],
) -> dict[str, int]:
    finalized = [
        row for row in snapshot.valid if row.get("type") == "turn-finalized"
    ]
    events_by_fin: dict[str, list[Mapping[str, Any]]] = {}
    for row in finalized:
        data = row.get("data")
        fin_id = data.get("finalization_id") if isinstance(data, Mapping) else None
        if isinstance(fin_id, str) and fin_id:
            events_by_fin.setdefault(fin_id, []).append(row)

    receipts = _load_finalization_receipts(campaign_logs_dir, findings)
    counters = {"receipts": len(receipts), "paired": 0, "missing": 0, "duplicated": 0}
    for fin_id, receipt in sorted(receipts.items()):
        matches = events_by_fin.get(fin_id, [])
        if not matches:
            counters["missing"] += 1
            findings.append(Finding(
                SEVERITY_ERROR, CODE_FINALIZATION_EVENT_MISSING,
                f"finalization receipt {fin_id} has no turn-finalized event",
                {"finalization_id": fin_id},
            ))
        elif len(matches) > 1:
            counters["duplicated"] += 1
            findings.append(Finding(
                SEVERITY_ERROR, CODE_FINALIZATION_EVENT_DUPLICATE,
                f"finalization {fin_id} is closed by {len(matches)} "
                "turn-finalized events; exactly one is allowed",
                {"finalization_id": fin_id,
                 "ids": [str(row.get("id")) for row in matches]},
            ))
        else:
            counters["paired"] += 1
    orphans = sorted(set(events_by_fin) - set(receipts))
    if orphans:
        findings.append(Finding(
            SEVERITY_ERROR, CODE_FINALIZATION_ORPHAN_EVENT,
            "turn-finalized event(s) reference finalization ids with no "
            f"receipt: {_format_refs(orphans)}",
            {"finalization_ids": orphans},
        ))
    return counters


# ---------------------------------------------------------------------------
# Uncovered-write ledger (t2 choke point) — wiring coverage report
# ---------------------------------------------------------------------------


def _load_uncovered_ledger(
    campaign_logs_dir: Path, findings: list[Finding]
) -> dict[str, Any]:
    ledger_path = cev.uncovered_ledger_path(campaign_logs_dir)
    refs: list[dict[str, Any]] = []
    for line_no, row, error in _iter_jsonl(ledger_path):
        if error is not None or not isinstance(row, Mapping) or row.get("_v") != 1:
            findings.append(Finding(
                SEVERITY_WARNING, CODE_UNCOVERED_ROW_MALFORMED,
                f"uncovered-ledger line {line_no} does not carry the v1 row shape",
                {"line": line_no},
            ))
            continue
        refs.append({
            "stream": row.get("stream"),
            "turn": row.get("turn"),
            "record_key": row.get("record_key"),
            "decision_id": row.get("decision_id"),
            "ts": row.get("ts"),
        })
    return {"count": len(refs), "refs": refs}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def validate_campaign(
    root: Path | str,
    campaign_id: str,
    *,
    turn_from: int | None = None,
    turn_to: int | None = None,
) -> ValidateResult:
    """Read-only completeness sweep of one campaign's canonical evidence."""
    root_path = Path(root)
    campaign_dir = root_path / ".coc" / "campaigns" / campaign_id
    if not campaign_dir.is_dir():
        raise CampaignNotFoundError(f"campaign directory not found: {campaign_dir}")
    logs_dir = campaign_dir / "logs"

    findings: list[Finding] = []
    snapshot = _load_canonical_stream(logs_dir, campaign_id, findings)
    timeline_stats = _audit_sequences(logs_dir, snapshot, findings)
    _audit_decision_replay(snapshot, findings)

    roll_records = _load_roll_receipts(campaign_dir, findings)
    rolls = _match_required_rolls(
        roll_records, snapshot, turn_from, turn_to, findings
    )
    finals = _match_finalizations(logs_dir, snapshot, findings)
    uncovered = _load_uncovered_ledger(logs_dir, findings)

    scoped_events = [
        row for row in snapshot.valid
        if _in_turn_range(_exact_turn(row), turn_from, turn_to)
    ]
    checked_anything = bool(scoped_events) or rolls["in_scope"] > 0 or finals["receipts"] > 0
    if not checked_anything:
        status = STATUS_NOT_PROVEN
    elif findings and any(f.severity == SEVERITY_ERROR for f in findings):
        status = STATUS_FAIL
    else:
        status = STATUS_PASS

    counts = {
        "canonical_events_scanned": snapshot.scanned,
        "canonical_events": len(scoped_events),
        "required_rolls": rolls["in_scope"],
        "explicit_zero_rolls": rolls["in_scope"] == 0,
        "rolls_paired": rolls["paired"],
        "rolls_missing": rolls["missing"],
        "rolls_duplicated": rolls["duplicated"],
        "rolls_number_mismatches": rolls["number_mismatches"],
        "finalization_receipts": finals["receipts"],
        "explicit_zero_finalizations": finals["receipts"] == 0,
        "finalizations_paired": finals["paired"],
        "finalizations_missing": finals["missing"],
        "finalizations_duplicated": finals["duplicated"],
    }
    return ValidateResult(
        root=root_path,
        campaign=campaign_id,
        turn_from=turn_from,
        turn_to=turn_to,
        status=status,
        findings=findings,
        counts=counts,
        timelines=timeline_stats,
        uncovered_ledger=uncovered,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Read-only completeness validator for the canonical COC event "
            "stream (coc-events-1): structured receipts vs canonical events, "
            "sequence crash-gap semantics, uncovered-write coverage."
        )
    )
    parser.add_argument("--root", default=".", help="project root containing .coc/")
    parser.add_argument("--campaign", required=True, help="campaign id")
    parser.add_argument("--turn-from", type=int, default=None,
                        help="drop turn-stamped requirements before this turn")
    parser.add_argument("--turn-to", type=int, default=None,
                        help="drop turn-stamped requirements after this turn")
    parser.add_argument("--json", action="store_true",
                        help="emit the machine-readable validation result")
    args = parser.parse_args(argv)
    try:
        result = validate_campaign(
            args.root,
            args.campaign,
            turn_from=args.turn_from,
            turn_to=args.turn_to,
        )
    except CampaignNotFoundError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    if args.json:
        sys.stdout.write(
            json.dumps(result.to_dict(), ensure_ascii=False, indent=2) + "\n"
        )
    else:
        sys.stdout.write("\n".join(result.render_lines()) + "\n")
    return result.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
