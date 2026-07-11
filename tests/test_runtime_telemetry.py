"""A32 telemetry shape, privacy, and durable reload contracts."""
from __future__ import annotations

import importlib.util
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


def test_receipts_reload_without_player_text_prompt_or_secret(tmp_path):
    mod = _load()
    campaign = tmp_path / ".coc" / "campaigns" / "case"
    telemetry = mod.make_telemetry(**_telemetry())
    path = mod.write_receipt(
        campaign, session_id="sess-safe", investigator_id="ada",
        telemetry=telemetry, decision_ids=["turn-001"],
    )
    raw = path.read_text(encoding="utf-8")
    assert "我检查门锁" not in raw
    assert "prompt" not in raw.lower()
    assert "secret" not in raw.lower()
    assert mod.read_receipts(campaign)[0]["telemetry"] == telemetry
