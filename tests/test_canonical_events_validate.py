"""Behavior tests for the canonical-events completeness validator (t7).

Covers ``coc_canonical_events_validate`` against synthetic campaigns built
through the real emission layer plus structured receipt fixtures:

- complete pass (rolls paired with identical authoritative numbers,
  finalizations paired, clean sequences);
- failures: missing/duplicated/mismatched roll events, missing and orphaned
  finalizations, ``decision_id`` conflicts, malformed ordering;
- vacuity discipline: nothing to check exits 2 (never a vacuous pass);
- wiring coverage: uncovered-write ledger rows are reported, never fatal;
- crash-gap semantics: holes covered by the durable allocator cursor are
  permitted, while duplicates, regressions, beyond-cursor values, and
  uncursored gaps fail closed.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_canonical_events as cem
import coc_canonical_events_validate as cv
import coc_state

CAMPAIGN = "amaranthine-16"
TIMELINE = "tl-main"


@pytest.fixture(autouse=True)
def _fresh_emission_runtime():
    cem.reset_emission_runtime_state()
    yield
    cem.reset_emission_runtime_state()


def _logs_dir(root: Path, campaign: str = CAMPAIGN) -> Path:
    d = root / ".coc" / "campaigns" / campaign / "logs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _emit(logs_dir: Path, **overrides):
    kwargs = {
        "campaign_logs_dir": logs_dir,
        "event_type": "turn-started",
        "campaign": CAMPAIGN,
        "timeline": TIMELINE,
        "turn": 1,
        "slug": cem.ordinal_slug(1),
        "source": "test.emitter",
        "game_time": "day1-morning",
        "privacy": "public",
        "decision_id": "dec-turn-start-0001",
        "data": {"_v": 1},
    }
    kwargs.update(overrides)
    return cem.emit(**kwargs)


def _roll_receipt(
    *,
    decision_id: str,
    roll_id: str,
    visibility: str = "public",
    outcome: str | None = "hard",
    total: int | None = 21,
    target: int | None = 60,
    turn: int | None = 12,
    tool: str = "rules.roll",
) -> dict:
    """A current-schema roll receipt whose ``roll_record`` mirrors a real
    ``logs/rolls.jsonl`` row: flat authoritative fields plus payload copy."""
    roll_record: dict = {
        "event_type": "roll",
        "type": "roll",
        "kind": "skill_check",
        "actor": "subject-investigator-elise",
        "visibility": visibility,
        "roll_id": roll_id,
        "payload": {"roll_id": roll_id},
    }
    if turn is not None:
        roll_record["turn_number"] = turn
        roll_record["payload"]["turn_number"] = turn
    if outcome is not None:
        roll_record["outcome"] = outcome
        roll_record["payload"]["outcome"] = outcome
    if total is not None:
        roll_record["roll"] = total
        roll_record["payload"]["roll"] = total
    if target is not None:
        roll_record["target"] = target
        roll_record["payload"]["target"] = target
    return {
        "schema_version": 5,
        "tool": tool,
        "decision_id": decision_id,
        "fingerprint": f"fp-{decision_id}",
        "operation": {"skill": "Spot Hidden"},
        "resolution": {},
        "roll_id": roll_id,
        "roll_record": roll_record,
        "data": {},
        "warnings": [],
        "hints": [],
    }


def _save_roll_receipts(root: Path, receipts: list[dict], campaign: str = CAMPAIGN) -> None:
    """Merge receipts into the current document (idempotent fixture write)."""
    campaign_dir = root / ".coc" / "campaigns" / campaign
    campaign_dir.joinpath("save").mkdir(parents=True, exist_ok=True)
    path = campaign_dir / "save" / "roll-operation-receipts.json"
    if path.is_file():
        document = json.loads(path.read_text(encoding="utf-8"))
    else:
        document = {
            "schema_version": 6,
            "receipts": {},
            "pending_side_effects": {},
            "luck_spends": {},
        }
    for receipt in receipts:
        tool_bucket = document["receipts"].setdefault(receipt["tool"], {})
        tool_bucket[receipt["decision_id"]] = receipt
    path.write_text(json.dumps(document), encoding="utf-8")


def _emit_roll_event(
    logs_dir: Path,
    *,
    roll_id: str,
    turn: int = 12,
    ordinal: int = 1,
    decision_id: str | None = None,
    outcome: str = "hard",
    dice: str = "1d100=21",
    target_value: int | None = 60,
):
    data = {
        "_v": 1,
        "roll_id": roll_id,
        "check": "spot-hidden",
        "actor": "subject-investigator-elise",
        "result_level": outcome,
        "dice": dice,
    }
    if target_value is not None:
        data["target_value"] = target_value
    return _emit(
        logs_dir,
        event_type="roll-resolved",
        turn=turn,
        slug=cem.ordinal_slug(ordinal),
        decision_id=decision_id or f"skillcheck-{CAMPAIGN}-{TIMELINE}-t{turn}-roll-{ordinal:02d}",
        data=data,
    )


def _append_finalization_receipt(
    logs_dir: Path, fin_id: str, decision_id: str | None = None
) -> None:
    row = {
        "schema_version": 2,
        "finalization_id": fin_id,
        "decision_id": decision_id or f"finalize-{fin_id}",
        "source_roll_ids": [],
        "journal_decision_id": f"journal-{fin_id}",
        "integrity_digest": "0" * 64,
    }
    with (logs_dir / "turn-finalizations.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row) + "\n")


def _emit_turn_finalized(
    logs_dir: Path, *, fin_id: str, turn: int = 12, ordinal: int = 99
) -> dict:
    return _emit(
        logs_dir,
        event_type="turn-finalized",
        turn=turn,
        slug=f"occ-{ordinal:02d}",
        decision_id=f"finalize-{CAMPAIGN}-{fin_id}",
        data={"_v": 1, "finalization_id": fin_id},
    )


def _build_clean_turn(root: Path, campaign: str = CAMPAIGN) -> Path:
    """Campaign with turn 12 fully settled: one public roll + its event and
    one finalization receipt + its event."""
    logs = _logs_dir(root, campaign)
    _emit(logs, decision_id="dec-turn-start-t12", turn=12)
    _save_roll_receipts(
        root,
        [
            _roll_receipt(
                decision_id=f"dec-roll-t12-a",
                roll_id="roll-spot-hidden-t12-01",
            )
        ],
        campaign=campaign,
    )
    _emit_roll_event(logs, roll_id="roll-spot-hidden-t12-01")
    _append_finalization_receipt(logs, f"fin-{campaign}-turn-12")
    _emit_turn_finalized(logs, fin_id=f"fin-{campaign}-turn-12")
    return logs


# ---------------------------------------------------------------------------
# Deliverable 1: complete pass
# ---------------------------------------------------------------------------


def test_complete_pass_returns_zero(tmp_path: Path) -> None:
    logs = _build_clean_turn(tmp_path)

    result = cv.validate_campaign(tmp_path, CAMPAIGN)
    assert result.ok and result.exit_code == 0
    assert result.status == cv.STATUS_PASS
    assert result.errors == []
    counts = result.counts
    assert counts["required_rolls"] == 1
    assert counts["explicit_zero_rolls"] is False
    assert counts["rolls_paired"] == 1
    assert counts["finalization_receipts"] == 1
    assert counts["finalizations_paired"] == 1
    stats = result.timelines[TIMELINE]
    assert stats["written"] == 3
    assert stats["crash_gaps"] == []
    assert result.uncovered_ledger["count"] == 0


def test_consequence_public_roll_is_required_and_passes_with_dice_only_receipt(
    tmp_path: Path,
) -> None:
    logs = _build_clean_turn(tmp_path)
    receipts = [
        _roll_receipt(
            decision_id="dec-roll-t12-a",
            roll_id="roll-spot-hidden-t12-01",
            visibility="public",
            outcome="hard",
            total=21,
            target=60,
            turn=12,
        ),
        _roll_receipt(
            decision_id="dec-roll-dice-expression",
            roll_id="toolbox-amaranthine-16-000002",
            visibility="consequence_public",
            outcome=None,
            total=7,
            target=None,
            turn=12,
            tool="rules.roll_dice",
        ),
    ]
    _save_roll_receipts(tmp_path, receipts)
    _emit_roll_event(
        logs,
        roll_id="toolbox-amaranthine-16-000002",
        ordinal=2,
        decision_id="rolldice-dec-0002",
        outcome="regular",
        dice="1d6+1=7",
        target_value=None,
    )

    result = cv.validate_campaign(tmp_path, CAMPAIGN)
    assert result.ok and result.exit_code == 0
    assert result.counts["required_rolls"] == 2
    assert result.counts["rolls_paired"] == 2


# ---------------------------------------------------------------------------
# Deliverable 2: roll completeness failures
# ---------------------------------------------------------------------------


def test_missing_roll_event_fails(tmp_path: Path) -> None:
    logs = _build_clean_turn(tmp_path)
    _save_roll_receipts(
        tmp_path,
        [_roll_receipt(decision_id="dec-extra", roll_id="roll-listen-t12-02")],
    )

    result = cv.validate_campaign(tmp_path, CAMPAIGN)
    assert result.exit_code == 1 and result.status == cv.STATUS_FAIL
    codes = [finding.code for finding in result.errors]
    assert cv.CODE_ROLL_EVENT_MISSING in codes
    assert result.counts["rolls_missing"] == 1
    assert result.counts["required_rolls"] == 2


def test_duplicate_roll_events_fail(tmp_path: Path) -> None:
    logs = _build_clean_turn(tmp_path)
    _emit_roll_event(logs, roll_id="roll-spot-hidden-t12-01", ordinal=7,
                     decision_id="skillcheck-dec-second-emission")

    result = cv.validate_campaign(tmp_path, CAMPAIGN)
    codes = [finding.code for finding in result.errors]
    assert cv.CODE_ROLL_EVENT_DUPLICATE in codes
    assert result.counts["rolls_duplicated"] == 1
    assert result.exit_code == 1


@pytest.mark.parametrize(
    ("mutate", "expected_code"),
    [
        (lambda data: data.update(result_level="regular"), cv.CODE_ROLL_LEVEL_MISMATCH),
        (lambda data: data.update(target_value=55), cv.CODE_ROLL_TARGET_MISMATCH),
        (lambda data: data.update(dice="1d100=34"), cv.CODE_ROLL_TOTAL_MISMATCH),
    ],
)
def test_mismatched_authoritative_numbers_fail(
    tmp_path: Path, mutate, expected_code: str
) -> None:
    logs = _build_clean_turn(tmp_path)
    # Rewrite the settled roll event so one number diverges from the receipt.
    stream_path = logs / cem.CANONICAL_STREAM_NAME
    rewritten = []
    for line in stream_path.read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        if row.get("type") == "roll-resolved":
            mutate(row["data"])
            line = json.dumps(row, ensure_ascii=False)
        rewritten.append(line)
    stream_path.write_text("\n".join(rewritten) + "\n", encoding="utf-8")

    result = cv.validate_campaign(tmp_path, CAMPAIGN)
    codes = [finding.code for finding in result.errors]
    assert expected_code in codes
    assert result.counts["rolls_number_mismatches"] >= 1
    assert result.exit_code == 1


def test_absent_optional_numbers_warn_but_not_fail(tmp_path: Path) -> None:
    logs = _build_clean_turn(tmp_path)
    _save_roll_receipts(
        tmp_path,
        [_roll_receipt(decision_id="dec-roll-t12-a", roll_id="roll-spot-hidden-t12-01")],
    )
    stream_path = logs / cem.CANONICAL_STREAM_NAME
    rows = [
        json.loads(line)
        for line in stream_path.read_text(encoding="utf-8").splitlines()
    ]
    roll_rows = [row for row in rows if row.get("type") == "roll-resolved"]
    assert len(roll_rows) == 1
    data = roll_rows[0]["data"]
    assert "dice" in data and "target_value" in data
    data.pop("dice")
    data.pop("target_value")
    stream_path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n",
        encoding="utf-8",
    )

    result = cv.validate_campaign(tmp_path, CAMPAIGN)
    warnings = [f.code for f in result.findings if f.severity == cv.SEVERITY_WARNING]
    assert warnings.count(cv.CODE_ROLL_NUMBERS_ABSENT) == 2
    assert result.errors == [] and result.exit_code == 0


# ---------------------------------------------------------------------------
# Deliverable 3: finalization completeness
# ---------------------------------------------------------------------------


def test_missing_finalization_event_fails(tmp_path: Path) -> None:
    logs = _build_clean_turn(tmp_path)
    _append_finalization_receipt(logs, f"fin-{CAMPAIGN}-turn-13")

    result = cv.validate_campaign(tmp_path, CAMPAIGN)
    codes = [finding.code for finding in result.errors]
    assert cv.CODE_FINALIZATION_EVENT_MISSING in codes
    assert result.counts["finalizations_missing"] == 1
    assert result.counts["finalization_receipts"] == 2
    assert result.exit_code == 1


def test_orphan_turn_finalized_event_fails(tmp_path: Path) -> None:
    logs = _build_clean_turn(tmp_path)
    _emit_turn_finalized(
        logs, fin_id=f"fin-{CAMPAIGN}-ghost", ordinal=98, turn=11
    )

    result = cv.validate_campaign(tmp_path, CAMPAIGN)
    codes = [finding.code for finding in result.errors]
    assert cv.CODE_FINALIZATION_ORPHAN_EVENT in codes
    assert result.exit_code == 1


def test_duplicate_turn_finalized_events_fail(tmp_path: Path) -> None:
    logs = _build_clean_turn(tmp_path)
    stream_path = logs / cem.CANONICAL_STREAM_NAME
    lines = [json.loads(l) for l in stream_path.read_text(encoding="utf-8").splitlines()]
    finalizer = next(row for row in lines if row.get("type") == "turn-finalized")
    # Hand-fork a second closing event with a different occurrence slot;
    # emit itself would dedupe by decision_id, so write the raw row.
    fork = dict(finalizer)
    fork["id"] = finalizer["id"].replace("occ-99", "occ-42")
    fork["sequence"] = finalizer["sequence"] + 5
    fork["decision_id"] = finalizer["decision_id"] + "-fork"
    with stream_path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(fork, ensure_ascii=False) + "\n")

    result = cv.validate_campaign(tmp_path, CAMPAIGN)
    codes = [finding.code for finding in result.errors]
    assert cv.CODE_FINALIZATION_EVENT_DUPLICATE in codes
    assert result.exit_code == 1


# ---------------------------------------------------------------------------
# Deliverable 4: vacuity discipline + explicit zeros
# ---------------------------------------------------------------------------


def test_nothing_to_check_exits_two(tmp_path: Path) -> None:
    _logs_dir(tmp_path)

    result = cv.validate_campaign(tmp_path, CAMPAIGN)
    assert result.status == cv.STATUS_NOT_PROVEN
    assert result.exit_code == 2
    assert result.counts["explicit_zero_rolls"] is True
    rendered = "\n".join(result.render_lines())
    assert "NOT_PROVEN" in rendered
    assert "zero" in rendered.casefold()


def test_cli_reports_exit_codes(tmp_path: Path) -> None:
    _logs_dir(tmp_path)
    assert cv.main(["--root", str(tmp_path), "--campaign", CAMPAIGN]) == 2

    _build_clean_turn(tmp_path)
    assert cv.main(["--root", str(tmp_path), "--campaign", CAMPAIGN]) == 0
    assert cv.main([
        "--root", str(tmp_path), "--campaign", CAMPAIGN, "--json"
    ]) == 0
    # Unknown campaigns are NOT_PROVEN diagnostics, reported on stderr.
    assert cv.main(["--root", str(tmp_path), "--campaign", "missing-9"]) == 2


# ---------------------------------------------------------------------------
# Deliverable 5: uncovered ledger = non-fatal wiring coverage
# ---------------------------------------------------------------------------


def test_uncovered_writes_reported_non_fatal(tmp_path: Path) -> None:
    logs = _build_clean_turn(tmp_path)
    coc_state.append_jsonl(
        logs / "events.jsonl",
        {
            "event_id": "evt-unwired-resource-1",
            "event_type": "resource_change",
            "decision_id": "dec-unwired-resource-0001",
            "turn_number": 12,
        },
    )
    assert cem.settle_uncovered_writes(logs, turn=12) == 1

    result = cv.validate_campaign(tmp_path, CAMPAIGN)
    assert result.ok and result.exit_code == 0
    assert result.uncovered_ledger["count"] == 1
    ref = result.uncovered_ledger["refs"][0]
    assert ref["stream"] == "logs/events.jsonl"
    assert ref["record_key"] == "evt-unwired-resource-1"
    assert ref["decision_id"] == "dec-unwired-resource-0001"
    assert "non-fatal" in "\n".join(result.render_lines())


# ---------------------------------------------------------------------------
# Deliverable 6: crash-gap semantics vs malformed streams
# ---------------------------------------------------------------------------


def _hand_stream(logs_dir: Path, sequences: list[int]) -> None:
    events = [
        cem.build_event(
            event_type="turn-started",
            campaign=CAMPAIGN,
            timeline=TIMELINE,
            turn=index,
            slug="occ-01",
            source="test.emitter",
            game_time="day1",
            privacy="public",
            decision_id=f"dec-hand-stream-{index:03d}-{sequence}",
            data={"_v": 1},
            sequence=sequence,
        )
        for index, sequence in enumerate(sequences, start=1)
    ]
    with (logs_dir / cem.CANONICAL_STREAM_NAME).open("w", encoding="utf-8") as handle:
        for event in events:
            handle.write(json.dumps(event, ensure_ascii=False) + "\n")


def _write_cursor(logs_dir: Path, timeline: str, value: int) -> None:
    cev_cursor = {
        "_v": 1,
        "generation": cem.SCHEMA_GENERATION,
        "counters": {timeline: value},
    }
    cem.sequence_cursor_path(logs_dir).write_text(
        json.dumps(cev_cursor), encoding="utf-8"
    )


def test_permitted_crash_gap_with_cursor_certification(tmp_path: Path) -> None:
    logs = _logs_dir(tmp_path)
    _hand_stream(logs, [1, 2, 4])
    _write_cursor(logs, TIMELINE, 4)

    result = cv.validate_campaign(tmp_path, CAMPAIGN)
    assert result.ok and result.exit_code == 0
    stats = result.timelines[TIMELINE]
    assert stats["crash_gaps"] == [3]
    assert stats["allocated_through"] == 4
    info_codes = [f.code for f in result.findings if f.severity == cv.SEVERITY_INFO]
    assert cv.INFO_CRASH_GAP in info_codes
    assert result.errors == []


def test_tail_allocated_unwritten_is_informational(tmp_path: Path) -> None:
    logs = _logs_dir(tmp_path)
    _hand_stream(logs, [1, 2])
    _write_cursor(logs, TIMELINE, 5)

    result = cv.validate_campaign(tmp_path, CAMPAIGN)
    assert result.ok and result.exit_code == 0
    stats = result.timelines[TIMELINE]
    assert stats["tail_unwritten"] == [3, 4, 5]


@pytest.mark.parametrize(
    ("sequences", "cursor", "expected_codes"),
    [
        ([1, 2, 2], 3, [cv.CODE_DUPLICATE_SEQUENCE]),
        ([5, 3], 5, [cv.CODE_SEQUENCE_REGRESSION]),
        ([1, 2, 3, 4], 3, [cv.CODE_SEQUENCE_BEYOND_CURSOR]),
        ([1, 2, 4], None, [cv.CODE_UNCERTIFIED_GAP]),
    ],
)
def test_malformed_streams_fail_closed(
    tmp_path: Path, sequences: list[int], cursor: int | None, expected_codes: list[str]
) -> None:
    logs = _logs_dir(tmp_path)
    _hand_stream(logs, sequences)
    if cursor is not None:
        _write_cursor(logs, TIMELINE, cursor)

    result = cv.validate_campaign(tmp_path, CAMPAIGN)
    assert result.status == cv.STATUS_FAIL and result.exit_code == 1
    codes = {finding.code for finding in result.errors}
    assert set(expected_codes) <= codes


def test_corrupt_and_malformed_rows_are_findings_not_crashes(tmp_path: Path) -> None:
    logs = _build_clean_turn(tmp_path)
    with (logs / cem.CANONICAL_STREAM_NAME).open("a", encoding="utf-8") as handle:
        handle.write("{not json}\n")

    result = cv.validate_campaign(tmp_path, CAMPAIGN)
    codes = {finding.code for finding in result.errors}
    assert cv.CODE_MALFORMED_JSON in codes
    assert result.exit_code == 1


# ---------------------------------------------------------------------------
# Idempotency law stored in the stream
# ---------------------------------------------------------------------------


def test_decision_id_conflict_in_stream_fails(tmp_path: Path) -> None:
    logs = _logs_dir(tmp_path)
    first = cem.build_event(
        event_type="sanity-changed", campaign=CAMPAIGN, timeline=TIMELINE,
        turn=2, slug="occ-01", source="test.emitter",
        game_time="day1", privacy="public",
        decision_id="sanity-dec-conflict-001", data={
            "_v": 1, "investigator": "subject-investigator-elise",
            "delta": -2, "cause": "ghoul-sight",
        },
        sequence=1,
    )
    second = cem.build_event(
        event_type="sanity-changed", campaign=CAMPAIGN, timeline=TIMELINE,
        turn=2, slug="occ-02", source="test.emitter",
        game_time="day1", privacy="public",
        decision_id="sanity-dec-conflict-001", data={
            "_v": 1, "investigator": "subject-investigator-elise",
            "delta": -9, "cause": "ghoul-sight",
        },
        sequence=2,
    )
    with (logs / cem.CANONICAL_STREAM_NAME).open("w", encoding="utf-8") as handle:
        for event in (first, second):
            handle.write(json.dumps(event, ensure_ascii=False) + "\n")

    result = cv.validate_campaign(tmp_path, CAMPAIGN)
    codes = {finding.code for finding in result.errors}
    assert cv.CODE_DECISION_ID_CONFLICT in codes
    assert result.exit_code == 1


# ---------------------------------------------------------------------------
# Turn-range scoping
# ---------------------------------------------------------------------------


def test_turn_range_drops_stamped_requirements(tmp_path: Path) -> None:
    _build_clean_turn(tmp_path)
    logs = tmp_path / ".coc" / "campaigns" / CAMPAIGN / "logs"
    _save_roll_receipts(
        tmp_path,
        [
            _roll_receipt(decision_id="dec-roll-t14-x", roll_id="roll-t14-late", turn=14),
            _roll_receipt(decision_id="dec-roll-t12-a", roll_id="roll-spot-hidden-t12-01", turn=12),
        ],
    )

    unscoped = cv.validate_campaign(tmp_path, CAMPAIGN)
    assert unscoped.counts["required_rolls"] == 2
    assert unscoped.counts["rolls_missing"] == 1
    assert unscoped.exit_code == 1

    scoped = cv.validate_campaign(tmp_path, CAMPAIGN, turn_from=10, turn_to=12)
    assert scoped.counts["required_rolls"] == 1
    assert scoped.counts["rolls_missing"] == 0
    assert scoped.ok and scoped.exit_code == 0


# ---------------------------------------------------------------------------
# Structured-receipt integrity boundaries
# ---------------------------------------------------------------------------


def test_wrong_schema_receipt_document_fails_closed(tmp_path: Path) -> None:
    _build_clean_turn(tmp_path)
    campaign_dir = tmp_path / ".coc" / "campaigns" / CAMPAIGN
    path = campaign_dir / "save" / "roll-operation-receipts.json"
    document = json.loads(path.read_text(encoding="utf-8"))
    document["schema_version"] = 5
    path.write_text(json.dumps(document), encoding="utf-8")

    result = cv.validate_campaign(tmp_path, CAMPAIGN)
    codes = {finding.code for finding in result.errors}
    assert cv.CODE_ROLL_RECEIPT_DOCUMENT_SCHEMA in codes
    assert result.exit_code == 1


def test_conflicting_roll_receipt_bodies_fail(tmp_path: Path) -> None:
    _build_clean_turn(tmp_path)
    first = _roll_receipt(decision_id="dec-one", roll_id="roll-shared-id", total=21)
    second = _roll_receipt(decision_id="dec-two", roll_id="roll-shared-id", total=77)
    _save_roll_receipts(tmp_path, [first, second])

    result = cv.validate_campaign(tmp_path, CAMPAIGN)
    codes = {finding.code for finding in result.errors}
    assert cv.CODE_ROLL_RECEIPT_CONFLICT in codes
    assert result.exit_code == 1
