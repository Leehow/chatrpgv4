"""Behavior tests for the canonical-events emission layer (plan task t2).

Covers ``canonical_events.emit`` (validate -> allocate sequence -> persist
through ``coc_state.append_jsonl`` -> index/idempotency), the durable
per-timeline sequence allocator, and the choke-point "uncovered writes"
ledger hooked into ``coc_state.append_jsonl`` / ``JsonlRecorder.append_jsonl``.

Loads the scripts the way production consumers do: plain ``sys.path``
insertion against ``plugins/coc-keeper/scripts``, so the emission runtime
state is shared between ``coc_state``, ``coc_async_recorder``, and these
tests through one module instance.
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

import coc_async_recorder
import coc_canonical_events as cem
import coc_state

CAMPAIGN = "amaranthine-16"
TIMELINE = "tl-main"


@pytest.fixture(autouse=True)
def _fresh_emission_runtime():
    cem.reset_emission_runtime_state()
    yield
    cem.reset_emission_runtime_state()


@pytest.fixture()
def logs_dir(tmp_path: Path) -> Path:
    d = tmp_path / ".coc" / "campaigns" / CAMPAIGN / "logs"
    d.mkdir(parents=True)
    return d


def base_emit_kwargs(**overrides):
    kwargs = {
        "campaign_logs_dir": None,
        "event_type": "memory-written",
        "campaign": CAMPAIGN,
        "timeline": TIMELINE,
        "turn": 3,
        "slug": cem.ordinal_slug(1),
        "source": "test.emitter",
        "game_time": "1928-03-04-morning",
        "privacy": "public",
        "decision_id": "dec-emit-0001",
        "data": {"_v": 1, "memory_id": "mem-test-01", "memory_kind": "episode"},
    }
    kwargs.update(overrides)
    return kwargs


def read_lines(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


# ---------------------------------------------------------------------------
# Deliverable 1: emit
# ---------------------------------------------------------------------------


def test_emit_appends_valid_line(logs_dir: Path) -> None:
    first = cem.emit(**base_emit_kwargs(campaign_logs_dir=logs_dir))
    second = cem.emit(
        **base_emit_kwargs(
            campaign_logs_dir=logs_dir,
            slug=cem.ordinal_slug(2),
            decision_id="dec-emit-0002",
            data={"_v": 1, "memory_id": "mem-test-02", "memory_kind": "assertion"},
        )
    )

    stream = logs_dir / cem.CANONICAL_STREAM_NAME
    rows = read_lines(stream)
    assert len(rows) == 2
    assert [row["sequence"] for row in rows] == [1, 2]
    for row, returned in ((rows[0], first), (rows[1], second)):
        cem.validate_event(row)
        assert row == returned
    assert rows[0]["specversion"] == cem.SPECVERSION
    assert rows[0]["type"] == "memory-written"


def test_emit_rejects_invalid_payload_without_burning_sequence(logs_dir: Path) -> None:
    with pytest.raises(cem.UnknownFieldError):
        cem.emit(
            **base_emit_kwargs(
                campaign_logs_dir=logs_dir,
                data={
                    "_v": 1,
                    "memory_id": "mem-bad-01",
                    "memory_kind": "episode",
                    "totally_unknown_field": "x",
                },
            )
        )
    with pytest.raises(cem.MissingFieldError):
        cem.emit(
            **base_emit_kwargs(
                campaign_logs_dir=logs_dir,
                event_type="item-transferred",
                decision_id="dec-emit-bad2",
                data={"_v": 1, "item": "brass-key", "from_holder": "elise"},
            )
        )

    # Nothing was persisted and the durable cursor never advanced.
    assert not (logs_dir / cem.CANONICAL_STREAM_NAME).exists()
    assert not (logs_dir / cem.SEQUENCE_CURSOR_NAME).exists()

    good = cem.emit(**base_emit_kwargs(campaign_logs_dir=logs_dir))
    assert good["sequence"] == 1


def test_emit_duplicate_decision_id_is_noop_success(logs_dir: Path) -> None:
    kwargs = base_emit_kwargs(campaign_logs_dir=logs_dir)
    stored = cem.emit(**kwargs)

    replayed = cem.emit(**base_emit_kwargs(campaign_logs_dir=logs_dir))
    assert replayed == stored
    assert len(read_lines(logs_dir / cem.CANONICAL_STREAM_NAME)) == 1

    with pytest.raises(cem.DuplicateDecisionIdError):
        cem.emit(
            **base_emit_kwargs(
                campaign_logs_dir=logs_dir,
                data={"_v": 1, "memory_id": "mem-test-01", "memory_kind": "hook"},
            )
        )
    assert len(read_lines(logs_dir / cem.CANONICAL_STREAM_NAME)) == 1


def test_sequence_monotonic_per_timeline_across_restarts(logs_dir: Path) -> None:
    for index in range(1, 4):
        cem.emit(
            **base_emit_kwargs(
                campaign_logs_dir=logs_dir,
                slug=cem.ordinal_slug(index),
                decision_id=f"dec-seq-{index:04d}",
                data={"_v": 1, "memory_id": f"mem-seq-{index:02d}", "memory_kind": "episode"},
            )
        )

    # Losing the cursor cannot walk allocation below a written line: the
    # scan floor reconstructs exactly where the stream stands.
    (logs_dir / cem.SEQUENCE_CURSOR_NAME).unlink()
    rescan = cem.FileSequenceAllocator(logs_dir)
    assert rescan.next_sequence(CAMPAIGN, TIMELINE) == 4

    # Full emission-runtime reset (process restart analogue): emit continues
    # above every persisted line for this timeline.
    cem.reset_emission_runtime_state()
    continued = cem.emit(
        **base_emit_kwargs(
            campaign_logs_dir=logs_dir,
            slug=cem.ordinal_slug(4),
            decision_id="dec-seq-0004",
            data={"_v": 1, "memory_id": "mem-seq-04", "memory_kind": "episode"},
        )
    )
    assert continued["sequence"] > read_lines(logs_dir / cem.CANONICAL_STREAM_NAME)[-3]["sequence"]

    rows = read_lines(logs_dir / cem.CANONICAL_STREAM_NAME)
    assert [row["sequence"] for row in rows] == sorted(
        row["sequence"] for row in rows
    )
    assert len({row["sequence"] for row in rows}) == len(rows)

    # Separately counted per timeline.
    other = cem.FileSequenceAllocator(logs_dir)
    assert other.next_sequence(CAMPAIGN, "tl-fork-1") == 1


# ---------------------------------------------------------------------------
# Deliverable 2: choke-point uncovered-write ledger
# ---------------------------------------------------------------------------


def test_uncovered_append_is_ledgered_once(logs_dir: Path) -> None:
    roll_record = {
        "roll_id": "roll-spot-hidden-09",
        "event_type": "roll",
        "decision_id": "dec-uncovered-0001",
        "turn_number": 5,
        "visibility": "public",
    }
    coc_state.append_jsonl(logs_dir / "rolls.jsonl", roll_record)

    # Not yet settled: buffer only, no ledger file.
    assert not (logs_dir / cem.UNCOVERED_LEDGER_NAME).exists()

    written = cem.settle_uncovered_writes(logs_dir, turn=5)
    assert written == 1
    rows = read_lines(logs_dir / cem.UNCOVERED_LEDGER_NAME)
    assert len(rows) == 1
    row = rows[0]
    assert row["_v"] == 1
    assert row["generation"] == cem.SCHEMA_GENERATION
    assert row["campaign"] == CAMPAIGN
    assert row["stream"] == "logs/rolls.jsonl"
    assert row["turn"] == 5
    assert row["record_key"] == "roll-spot-hidden-09"
    assert row["decision_id"] == "dec-uncovered-0001"

    # Idempotent settle: the same sighting is never double-ledgered.
    assert cem.settle_uncovered_writes(logs_dir, turn=5) == 0
    assert len(read_lines(logs_dir / cem.UNCOVERED_LEDGER_NAME)) == 1


def test_emitted_decision_keeps_ledger_empty(logs_dir: Path) -> None:
    decision_id = "dec-covered-0001"
    cem.emit(
        **base_emit_kwargs(
            campaign_logs_dir=logs_dir,
            decision_id=decision_id,
            turn=7,
        )
    )

    # The same-turn legacy write carrying the emitted decision id is covered.
    coc_state.append_jsonl(
        logs_dir / "events.jsonl",
        {
            "event_id": "evt-covered-0001",
            "event_type": "resource_change",
            "decision_id": decision_id,
            "turn_number": 7,
        },
    )
    assert cem.settle_uncovered_writes(logs_dir, turn=7) == 0
    assert not (logs_dir / cem.UNCOVERED_LEDGER_NAME).exists()


def test_recorder_enqueued_write_covered_by_same_turn_emit(tmp_path: Path) -> None:
    campaign_dir = tmp_path / ".coc" / "campaigns" / CAMPAIGN
    logs = campaign_dir / "logs"
    logs.mkdir(parents=True)

    decision_id = "dec-recorder-cover-1"
    recorder = coc_async_recorder.JsonlRecorder(
        campaign_dir, mode="fast", decision_id=decision_id
    )
    recorder.append_jsonl(
        logs / "time.jsonl",
        {
            "kind": "clock_advanced",
            "decision_id": decision_id,
            "turn_number": 8,
        },
    )

    # Emit lands after the enqueue: coverage is decided at the turn
    # boundary, not at enqueue order.
    cem.emit(
        **base_emit_kwargs(
            campaign_logs_dir=logs,
            event_type="scene-moved",
            turn=8,
            decision_id=decision_id,
            data={"_v": 1, "to_scene": "parish-study", "moved_by": "kp"},
        )
    )
    assert cem.settle_uncovered_writes(logs, turn=8) == 0
    assert not (logs / cem.UNCOVERED_LEDGER_NAME).exists()


def test_turn_finalized_emit_auto_settles_that_turn(logs_dir: Path) -> None:
    coc_state.append_jsonl(
        logs_dir / "beliefs.jsonl",
        {
            "schema_version": 1,
            "event_type": "hypothesis_asserted",
            "decision_id": "dec-stray-turn11",
            "turn_number": 11,
        },
    )
    finalized = cem.emit(
        **base_emit_kwargs(
            campaign_logs_dir=logs_dir,
            event_type="turn-finalized",
            slug="occ-01",
            turn=11,
            decision_id="dec-finalize-0011",
            data={"_v": 1, "finalization_id": "fin-dec-finalize-0011"},
        )
    )
    assert finalized["sequence"] == 1

    rows = read_lines(logs_dir / cem.UNCOVERED_LEDGER_NAME)
    assert [(row["stream"], row["turn"]) for row in rows] == [("logs/beliefs.jsonl", 11)]


def test_choked_sidecar_never_breaks_primary_write(
    logs_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def explode(*args, **kwargs):
        raise RuntimeError("sidecar exploded")

    monkeypatch.setattr(
        cem, "classify_campaign_log_append", explode, raising=False
    )
    # coc_state holds its own module reference: patch through the modules
    # the choke points actually import.
    import sys as _sys

    real_module = _sys.modules["coc_canonical_events"]
    monkeypatch.setattr(real_module, "classify_campaign_log_append", explode)

    record = {"roll_id": "roll-sidecar-proof", "turn_number": 2}
    coc_state.append_jsonl(logs_dir / "rolls.jsonl", record)
    # Primary write landed intact despite the sidecar failure.
    assert (
        logs_dir / "rolls.jsonl"
    ).read_text(encoding="utf-8").strip().endswith("}")


def test_exempt_streams_are_not_self_ledgered(logs_dir: Path) -> None:
    classified = cem.classify_campaign_log_append(
        logs_dir / cem.CANONICAL_STREAM_NAME
    )
    assert classified is None
    assert (
        cem.classify_campaign_log_append(logs_dir / cem.UNCOVERED_LEDGER_NAME)
        is None
    )
    assert cem.classify_campaign_log_append("/tmp/not-a-campaign/logs/x.jsonl") is None

    cem.emit(
        **base_emit_kwargs(campaign_logs_dir=logs_dir, decision_id="dec-exempt-01")
    )
    # The canonical line itself never becomes an uncovered sighting.
    assert cem.settle_uncovered_writes(logs_dir) == 0
    assert not (logs_dir / cem.UNCOVERED_LEDGER_NAME).exists()
