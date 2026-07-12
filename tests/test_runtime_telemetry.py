"""A32 telemetry shape, privacy, and durable reload contracts."""
from __future__ import annotations

import importlib.util
import os
import stat
import threading
from pathlib import Path

import pytest


def _load():
    path = Path("runtime/engine/telemetry.py")
    spec = importlib.util.spec_from_file_location("runtime_telemetry", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def _telemetry(**override):
    values = {
        "intent_ms": 1.0, "director_ms": 2.0, "rules_ms": 3.0,
        "persistence_ms": 4.0, "player_llm_ms": 0.0,
        "narrator_llm_ms": 5.0, "total_ms": 16.0,
        "input_tokens": None, "output_tokens": None, "fallback": False,
        "runner": {"planner": "deterministic", "narrator": "pi"},
        "narrator": {
            "call_count": 1,
            "model_identity": {"provider": "zhipu-coding", "id": "glm-5.2"},
            "response_mode": "tool",
            "consistent": True,
            "deterministic_fallback": False,
        },
    }
    values.update(override)
    return values


def test_telemetry_has_exact_stable_shape_and_nullable_usage():
    mod = _load()
    telemetry = mod.make_telemetry(**_telemetry())
    assert tuple(telemetry) == mod.TELEMETRY_FIELDS
    assert telemetry["input_tokens"] is None
    assert telemetry["total_ms"] >= sum(
        telemetry[field] for field in (
            "intent_ms", "director_ms", "rules_ms", "persistence_ms",
            "player_llm_ms", "narrator_llm_ms",
        )
    )


def test_telemetry_rejects_secretish_runner_values_and_negative_timings():
    mod = _load()
    with pytest.raises(ValueError, match="secret"):
        mod.make_telemetry(**_telemetry(runner={"authorization": "Bearer nope"}))
    with pytest.raises(ValueError, match="non-negative"):
        mod.make_telemetry(**_telemetry(rules_ms=-0.1))


def test_telemetry_total_must_bound_all_phase_spans():
    mod = _load()
    with pytest.raises(ValueError, match="total_ms"):
        mod.make_telemetry(**_telemetry(total_ms=1.0))


def test_receipts_reload_without_player_text_prompt_or_secret(tmp_path):
    mod = _load()
    campaign = tmp_path / ".coc" / "campaigns" / "case"
    telemetry = mod.make_telemetry(**_telemetry())
    path = mod.write_receipt(
        campaign, session_id="sess-safe", investigator_id="ada",
        telemetry=telemetry, runtime_receipt_sha256="0" * 64,
        decision_ids=["turn-001"],
    )
    raw = path.read_text(encoding="utf-8")
    assert "我检查门锁" not in raw
    assert "prompt" not in raw.lower()
    assert "secret" not in raw.lower()
    assert mod.read_receipts(campaign)[0]["telemetry"] == telemetry


def test_narrator_attestation_rejects_extra_or_secret_identity_fields():
    mod = _load()
    narrator = _telemetry()["narrator"]
    with pytest.raises(ValueError, match="narrator"):
        mod.make_telemetry(**_telemetry(narrator={**narrator, "notes": "nope"}))
    with pytest.raises(ValueError, match="narrator"):
        mod.make_telemetry(**_telemetry(narrator={
            **narrator,
            "model_identity": {
                "provider": "zhipu-coding",
                "id": "glm-5.2",
                "api_key": "must-not-persist",
            },
        }))


def test_latest_receipt_is_the_strict_physical_tail_not_last_parseable_row(tmp_path):
    mod = _load()
    campaign = tmp_path / ".coc" / "campaigns" / "case"
    path = mod.write_receipt(
        campaign,
        session_id="sess-safe",
        investigator_id="ada",
        telemetry=mod.make_telemetry(**_telemetry()),
        runtime_receipt_sha256="0" * 64,
        decision_ids=["turn-001"],
    )
    with path.open("a", encoding="utf-8") as handle:
        handle.write("{malformed-tail\n")

    with pytest.raises(ValueError, match="latest telemetry receipt"):
        mod.read_latest_receipt_strict(campaign)


@pytest.mark.parametrize("attack", ["logs_dir", "receipt_leaf"])
def test_receipt_writer_rejects_symlink_without_touching_outside(
    tmp_path, attack
):
    mod = _load()
    campaign = tmp_path / "campaign"
    campaign.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    sentinel = outside / "sentinel.txt"
    sentinel.write_text("unchanged\n", encoding="utf-8")
    if attack == "logs_dir":
        (campaign / "logs").symlink_to(outside, target_is_directory=True)
    else:
        (campaign / "logs").mkdir()
        (campaign / "logs" / "runtime-telemetry.jsonl").symlink_to(sentinel)

    with pytest.raises(ValueError, match="telemetry|receipt|logs"):
        mod.write_receipt(
            campaign,
            session_id="sess-safe",
            investigator_id="ada",
            telemetry=mod.make_telemetry(**_telemetry()),
            runtime_receipt_sha256="0" * 64,
            decision_ids=["turn-001"],
        )

    assert sentinel.read_text(encoding="utf-8") == "unchanged\n"
    assert sorted(path.name for path in outside.iterdir()) == ["sentinel.txt"]


def test_receipt_writer_completes_short_writes_and_fsyncs(tmp_path, monkeypatch):
    mod = _load()
    campaign = tmp_path / "campaign"
    real_write = mod.os.write
    calls: list[int] = []

    def short_write(fd: int, payload) -> int:
        size = max(1, len(payload) // 2)
        calls.append(size)
        return real_write(fd, payload[:size])

    monkeypatch.setattr(mod.os, "write", short_write)
    mod.write_receipt(
        campaign,
        session_id="sess-safe",
        investigator_id="ada",
        telemetry=mod.make_telemetry(**_telemetry()),
        runtime_receipt_sha256="0" * 64,
        decision_ids=["turn-001"],
    )

    assert len(calls) > 1
    assert mod.read_latest_receipt_strict(campaign)["session_id"] == "sess-safe"


def test_receipt_writer_serializes_concurrent_short_writes(tmp_path, monkeypatch):
    mod = _load()
    campaign = tmp_path / "campaign"
    telemetry = mod.make_telemetry(**_telemetry())
    mod.write_receipt(
        campaign, session_id="seed", investigator_id="ada",
        telemetry=telemetry, runtime_receipt_sha256="0" * 64,
        decision_ids=["seed"],
    ).write_bytes(b"")
    real_write = mod.os.write
    second_writer_started = threading.Event()
    first_writer = []
    local = threading.local()

    def interleaving_short_write(fd: int, payload) -> int:
        count = getattr(local, "count", 0)
        local.count = count + 1
        if count == 0:
            size = max(1, len(payload) // 2)
            written = real_write(fd, payload[:size])
            if not first_writer:
                first_writer.append(threading.get_ident())
                second_writer_started.wait(timeout=0.2)
            elif first_writer[0] != threading.get_ident():
                second_writer_started.set()
            return written
        return real_write(fd, payload)

    monkeypatch.setattr(mod.os, "write", interleaving_short_write)
    errors = []

    def write(session_id: str) -> None:
        try:
            mod.write_receipt(
                campaign, session_id=session_id, investigator_id="ada",
                telemetry=telemetry, runtime_receipt_sha256="0" * 64,
                decision_ids=[session_id],
            )
        except Exception as exc:  # pragma: no cover - assertion reports details
            errors.append(exc)

    threads = [threading.Thread(target=write, args=(name,)) for name in ("one", "two")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert errors == []
    assert {row["session_id"] for row in mod.read_receipts(campaign)} == {"one", "two"}


def test_receipt_reader_skips_only_the_corrupt_utf8_line(tmp_path):
    mod = _load()
    campaign = tmp_path / "campaign"
    telemetry = mod.make_telemetry(**_telemetry())
    path = mod.write_receipt(
        campaign, session_id="one", investigator_id="ada", telemetry=telemetry,
        runtime_receipt_sha256="0" * 64,
        decision_ids=["one"],
    )
    first = path.read_bytes()
    path.unlink()
    mod.write_receipt(
        campaign, session_id="two", investigator_id="ada", telemetry=telemetry,
        runtime_receipt_sha256="0" * 64,
        decision_ids=["two"],
    )
    second = path.read_bytes()
    path.write_bytes(first + b"\xff\n" + second)

    assert [row["session_id"] for row in mod.read_receipts(campaign)] == ["one", "two"]


def test_latest_receipt_rejects_blank_physical_tail(tmp_path):
    mod = _load()
    campaign = tmp_path / "campaign"
    path = mod.write_receipt(
        campaign, session_id="one", investigator_id="ada",
        telemetry=mod.make_telemetry(**_telemetry()),
        runtime_receipt_sha256="0" * 64, decision_ids=["one"],
    )
    with path.open("ab") as handle:
        handle.write(b"\n")

    with pytest.raises(ValueError, match="latest|tail|blank"):
        mod.read_latest_receipt_strict(campaign)


@pytest.mark.parametrize(
    "narrator",
    [
        {
            "call_count": 1, "model_identity": None, "response_mode": None,
            "consistent": True, "deterministic_fallback": False,
        },
        {
            "call_count": 1, "model_identity": None, "response_mode": None,
            "consistent": True, "deterministic_fallback": True,
        },
        {
            "call_count": 1,
            "model_identity": {"provider": "https://user:pass@host", "id": "glm-5.2"},
            "response_mode": "tool", "consistent": True,
            "deterministic_fallback": False,
        },
    ],
)
def test_narrator_attestation_rejects_inconsistent_or_unsafe_identity(narrator):
    mod = _load()
    with pytest.raises(ValueError, match="narrator|identity|fallback"):
        mod.make_telemetry(**_telemetry(narrator=narrator))


def test_top_level_fallback_matches_narrator_fallback():
    mod = _load()
    with pytest.raises(ValueError, match="fallback"):
        mod.make_telemetry(**_telemetry(
            fallback=True,
            narrator={**_telemetry()["narrator"], "deterministic_fallback": False},
        ))
