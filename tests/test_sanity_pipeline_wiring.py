"""Regression tests for the sanity-resolution single-pipeline wiring.

Covers three production-wiring guarantees:

1. ``rules.sanity_check`` can no longer apply a SAN loss while skipping the
   madness pipeline: it delegates authoritative resolution to the shared
   SanitySession executor (the same engine ``sanity.execute`` drives), so a
   5+ loss runs the chained INT roll, temporary insanity, and a persisted
   bout of madness, and a real-time bout locks out further checks.
2. The authored scene SAN trigger flow still works end-to-end through that
   pipeline (trigger_id consumed from ``scene.context``).
3. The game-day cumulative (one-fifth) indefinite-insanity mechanism is live:
   session SAN losses increment the time layer's sanity period, the day
   boundary (``state.mark_safe_rest``) closes the day through
   ``SanitySession.end_day()``, and the boundary backstop triggers
   indefinite insanity through production wiring.
"""
from __future__ import annotations

import importlib.util
import json
import random
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "plugins" / "coc-keeper" / "scripts"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_toolbox = _load("coc_toolbox_sanity_wiring", SCRIPTS / "coc_toolbox.py")
coc_starter = _load("coc_starter_sanity_wiring", SCRIPTS / "coc_starter.py")
coc_sanity = _load("coc_sanity_sanity_wiring", SCRIPTS / "coc_sanity.py")
coc_time = _load("coc_time_sanity_wiring", SCRIPTS / "coc_time.py")


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


@pytest.fixture
def campaign_ws(tmp_path: Path):
    """Fresh the-haunting / thomas-hayes quick-start campaign workspace."""
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "sanity-wiring-test"
    _write_json(
        coc_root / "runtime.json",
        {
            "schema_version": 2,
            "planner": {"kind": "deterministic"},
            "rules": {"kind": "deterministic"},
            "narrator": {"kind": "template"},
            "player": {"kind": "human"},
        },
    )
    quick = coc_starter.quick_start(
        coc_root,
        "the-haunting",
        "thomas-hayes",
        campaign_id=campaign_id,
        title="Sanity Wiring Test",
    )
    return {
        "workspace": workspace,
        "coc_root": coc_root,
        "campaign_id": campaign_id,
        "campaign_dir": Path(quick["campaign_dir"]),
        "investigator_id": quick["investigator_id"],
    }


def _run(ws, tool: str, args: dict | None = None) -> dict:
    return coc_toolbox.run_tool(
        tool, ws["workspace"], ws["campaign_id"], dict(args or {})
    )


def _inv_state(ws) -> dict:
    path = (
        ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{ws['investigator_id']}.json"
    )
    return json.loads(path.read_text(encoding="utf-8"))


def _sanity_snapshot(ws) -> dict:
    path = (
        ws["campaign_dir"]
        / "save"
        / "sanity-state"
        / f"{ws['investigator_id']}.json"
    )
    return json.loads(path.read_text(encoding="utf-8"))


def _time_state(ws) -> dict:
    return json.loads(
        (ws["campaign_dir"] / "save" / "time-state.json").read_text(
            encoding="utf-8"
        )
    )


def _sanity_check(ws, *, decision_id: str, seed: int, loss_success: str,
                  loss_failure: str, source: str = "structured horror",
                  trigger_id: str | None = None,
                  involuntary_action: dict | None = None) -> dict:
    args = {
        "investigator": ws["investigator_id"],
        "source": source,
        "loss_success": loss_success,
        "loss_failure": loss_failure,
        "involuntary_action": involuntary_action or {
            "kind": "freeze",
            "summary": "测试调查员因眼前恐怖僵住片刻。",
        },
        "decision_id": decision_id,
        "seed": seed,
    }
    if trigger_id:
        args["trigger_id"] = trigger_id
    return _run(ws, "rules.sanity_check", args)


# --------------------------------------------------------------------------- #
# Bypass closure: rules.sanity_check settles through SanitySession
# --------------------------------------------------------------------------- #
def test_rules_sanity_check_runs_the_full_madness_pipeline(campaign_ws):
    """A 5+ SAN loss through rules.sanity_check authoritatively runs the
    chained INT roll, temporary insanity, and a persisted bout of madness —
    the old 'loss applied, madness skipped' bypass is closed."""
    san_before = int(_inv_state(campaign_ws)["current_san"])
    # Seed 6 (verified against the production pipeline): SAN check fails,
    # 1D6+4 loses 5, the chained INT roll succeeds -> temporary insanity and
    # a real-time bout of madness with a pending keeper choice.
    settled = _sanity_check(
        campaign_ws,
        decision_id="pipeline-san-1",
        seed=6,
        loss_success="0",
        loss_failure="1D6+4",
    )
    assert settled["ok"] is True, settled
    data = settled["data"]
    assert data["sanity_check_skipped"] is False
    assert data["san_loss"] >= 5
    assert data["san_before"] == san_before
    assert data["san_after"] == san_before - data["san_loss"]
    # The madness pipeline actually ran and persisted — not advisory text.
    assert data["temporary_insane"] is True
    assert data["bout_triggered"] is True
    assert data["bout_active"] is True
    assert data["active_bout_id"]
    snapshot = _sanity_snapshot(campaign_ws)
    assert snapshot["temporary_insane"] is True
    assert snapshot["bout_active"] is True
    assert len(snapshot["bouts_of_madness"]) == 1
    assert snapshot["san_current"] == data["san_after"]
    # The session mirror is the only SAN write; investigator-state agrees.
    assert int(_inv_state(campaign_ws)["current_san"]) == data["san_after"]
    # The shared pipeline sees the same session (single write path).
    context = _run(campaign_ws, "sanity.context",
                   {"investigator": campaign_ws["investigator_id"]})
    assert context["ok"] is True
    assert context["data"]["active"] is True
    assert context["data"]["snapshot"]["san_current"] == data["san_after"]
    # The SAN loss reached the battle-report consequence stream exactly once.
    events = [
        json.loads(line)
        for line in (campaign_ws["campaign_dir"] / "logs" / "events.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    ]
    sanity_loss_rows = [
        row for row in events if row.get("event_type") == "sanity_loss"
    ]
    assert len(sanity_loss_rows) == 1
    assert sanity_loss_rows[0]["loss"] == data["san_loss"]


def test_rules_sanity_check_bout_lockout_blocks_further_checks(campaign_ws):
    """While a real-time bout runs, the p.157 SAN lockout is enforced by the
    pipeline instead of being silently skipped by narration."""
    settled = _sanity_check(
        campaign_ws,
        decision_id="pipeline-lockout-1",
        seed=6,
        loss_success="0",
        loss_failure="1D6+4",
    )
    assert settled["ok"] is True, settled
    assert settled["data"]["bout_active"] is True

    blocked = _sanity_check(
        campaign_ws,
        decision_id="pipeline-lockout-2",
        seed=6,
        loss_success="0",
        loss_failure="1",
    )
    assert blocked["ok"] is True
    assert blocked["data"]["sanity_check_skipped"] is True
    assert "bout of madness" in blocked["data"]["skip_reason"]
    # No additional SAN was applied by the skipped call.
    assert int(_inv_state(campaign_ws)["current_san"]) == settled["data"][
        "san_after"
    ]


def test_rules_sanity_check_decision_id_replays_without_reapplying(campaign_ws):
    """The decision_id idempotent-replay behavior is preserved: a replayed
    call returns the settled result and never re-applies the loss."""
    first = _sanity_check(
        campaign_ws,
        decision_id="pipeline-replay-1",
        seed=6,
        loss_success="0",
        loss_failure="1D6+4",
    )
    assert first["ok"] is True, first
    san_after_first = int(_inv_state(campaign_ws)["current_san"])

    replay = _sanity_check(
        campaign_ws,
        decision_id="pipeline-replay-1",
        seed=999,  # a different seed must not re-roll anything
        loss_success="0",
        loss_failure="1D6+4",
    )
    assert replay["ok"] is True, replay
    assert replay["data"] == first["data"]
    assert any("duplicate decision_id" in row for row in replay["warnings"])
    assert int(_inv_state(campaign_ws)["current_san"]) == san_after_first
    events = [
        json.loads(line)
        for line in (campaign_ws["campaign_dir"] / "logs" / "events.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
        if line.strip()
    ]
    assert (
        len([row for row in events if row.get("event_type") == "sanity_loss"])
        == 1
    )


def test_rules_sanity_check_consumes_authored_trigger_through_pipeline(
    campaign_ws,
):
    """The scene.context trigger_id flow still works end-to-end, now through
    the full SanitySession pipeline."""
    moved = _run(
        campaign_ws,
        "state.move_scene",
        {"scene_id": "upper-floor-bedroom", "decision_id": "wiring-move"},
    )
    assert moved["ok"] is True, moved
    context = _run(campaign_ws, "scene.context")
    assert context["ok"] is True
    triggers = context["data"]["pending_san_triggers"]
    assert [trigger["trigger_id"] for trigger in triggers] == ["bed-moves"]
    trigger = triggers[0]

    settled = _sanity_check(
        campaign_ws,
        decision_id="wiring-trigger-1",
        seed=3,
        loss_success=str(trigger["san_loss_success"]),
        loss_failure=trigger["san_loss_fail_expr"],
        source=trigger["source"],
        trigger_id=trigger["trigger_id"],
    )
    assert settled["ok"] is True, settled
    assert settled["data"]["trigger_id"] == "bed-moves"
    # The full pipeline ran (a SanitySession snapshot now exists).
    assert _sanity_snapshot(campaign_ws)["investigator_id"] == (
        campaign_ws["investigator_id"]
    )
    after = _run(campaign_ws, "scene.context")
    assert after["data"]["pending_san_triggers"] == []


# --------------------------------------------------------------------------- #
# Game-day cumulative (one-fifth) mechanism through production wiring
# --------------------------------------------------------------------------- #
def test_session_losses_increment_time_layer_period_through_toolbox(
    campaign_ws,
):
    """SAN losses applied through the SanitySession (via rules.sanity_check)
    increment the active sanity period's san_lost in the time layer."""
    advanced = _run(
        campaign_ws,
        "state.advance_time",
        {"minutes": 60, "reason": "an hour of investigation",
         "decision_id": "wiring-time-1"},
    )
    assert advanced["ok"] is True, advanced

    for index in range(2):
        settled = _sanity_check(
            campaign_ws,
            decision_id=f"wiring-period-{index}",
            seed=11 + index,
            loss_success="2",
            loss_failure="2",
        )
        assert settled["ok"] is True, settled
    period = _time_state(campaign_ws)["sanity_periods"][
        campaign_ws["investigator_id"]
    ]
    assert period["san_lost"] == 4
    assert _sanity_snapshot(campaign_ws)["daily_san_lost"] == 4


def test_one_fifth_of_day_start_san_triggers_indefinite_through_toolbox(
    campaign_ws,
):
    """p.168 through production wiring: losing a fifth of day-start SAN in
    one game day triggers indefinite insanity — no hand-assembled session."""
    # Day-start SAN is 55 -> threshold is 11.  Three 4-point losses (each
    # below the 5+ temporary-insanity trigger) accumulate to 12.
    for index in range(3):
        settled = _sanity_check(
            campaign_ws,
            decision_id=f"wiring-fifth-{index}",
            seed=21 + index,
            loss_success="4",
            loss_failure="4",
        )
        assert settled["ok"] is True, settled
    data = settled["data"]
    assert data["daily_san_lost"] == 12
    assert data["indefinite_insane"] is True
    snapshot = _sanity_snapshot(campaign_ws)
    assert snapshot["indefinite_insane"] is True
    assert int(_inv_state(campaign_ws)["current_san"]) == 55 - 12
    assert _inv_state(campaign_ws)["indefinite_insane"] is True
    assert _time_state(campaign_ws)["sanity_periods"][
        campaign_ws["investigator_id"]
    ]["san_lost"] == 12


def test_safe_rest_day_boundary_closes_sanity_day_through_toolbox(campaign_ws):
    """The rest concept the time layer already owns (state.mark_safe_rest)
    closes the sanity day: counters reset, threshold re-anchored, and the
    period is cleared — through production wiring."""
    settled = _sanity_check(
        campaign_ws,
        decision_id="wiring-rest-loss",
        seed=31,
        loss_success="4",
        loss_failure="4",
    )
    assert settled["ok"] is True, settled
    san_after = settled["data"]["san_after"]
    assert _sanity_snapshot(campaign_ws)["daily_san_lost"] == 4

    rested = _run(
        campaign_ws,
        "state.mark_safe_rest",
        {
            "investigator": campaign_ws["investigator_id"],
            "rest_kind": "full_sleep",
            "decision_id": "wiring-rest-1",
        },
    )
    assert rested["ok"] is True, rested
    assert rested["data"]["sanity_day_reset"] is True
    assert rested["data"]["sanity_day"]["closed"] is True
    assert rested["data"]["sanity_day"]["daily_san_lost_before_reset"] == 4
    assert (
        rested["data"]["sanity_day"]["indefinite_insanity_triggered"] is False
    )
    snapshot = _sanity_snapshot(campaign_ws)
    assert snapshot["daily_san_lost"] == 0
    # p.156: the one-fifth threshold re-anchors to current SAN at day start.
    assert snapshot["day_start_san"] == san_after
    period = _time_state(campaign_ws)["sanity_periods"][
        campaign_ws["investigator_id"]
    ]
    assert period["san_lost"] == 0


def test_day_boundary_backstop_triggers_indefinite_through_toolbox(campaign_ws):
    """If a day ends with accumulated loss at/over the one-fifth threshold
    but insanity never fired (e.g. drifted legacy state), the day boundary
    itself triggers indefinite insanity through the SanitySession API."""
    advanced = _run(
        campaign_ws,
        "state.advance_time",
        {"minutes": 30, "reason": "half an hour of investigation",
         "decision_id": "wiring-backstop-time"},
    )
    assert advanced["ok"] is True, advanced

    # Drifted prior state (setup only): the day accumulated 12 lost SAN
    # against a day-start SAN of 55 (threshold 11) without firing insanity.
    session = coc_sanity.SanitySession(
        campaign_ws["investigator_id"],
        san_max=55,
        int_value=70,
        rng=random.Random(1),
        campaign_dir=campaign_ws["campaign_dir"],
    )
    session.san_current = 43
    session.day_start_san = 55
    session.daily_san_lost = 12
    session.save(campaign_ws["campaign_dir"])

    rested = _run(
        campaign_ws,
        "state.mark_safe_rest",
        {
            "investigator": campaign_ws["investigator_id"],
            "rest_kind": "full_sleep",
            "decision_id": "wiring-backstop-rest",
        },
    )
    assert rested["ok"] is True, rested
    assert (
        rested["data"]["sanity_day"]["indefinite_insanity_triggered"] is True
    )
    snapshot = _sanity_snapshot(campaign_ws)
    assert snapshot["indefinite_insane"] is True
    assert snapshot["daily_san_lost"] == 0
    assert snapshot["day_start_san"] == snapshot["san_current"]
    assert _inv_state(campaign_ws)["indefinite_insane"] is True
    # The day boundary leaves a clean period for the next day.
    assert _time_state(campaign_ws)["sanity_periods"][
        campaign_ws["investigator_id"]
    ]["san_lost"] == 0
