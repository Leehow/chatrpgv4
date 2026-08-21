"""Read-only cash projection on the web character sheet."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

from runtime.sdk import web_views

REPO_ROOT = Path(__file__).resolve().parents[1]
_SCRIPTS = REPO_ROOT / "plugins" / "coc-keeper" / "scripts"


def _load_script(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def cash_workspace(tmp_path: Path):
    coc_starter = _load_script("coc_starter_cash_view", _SCRIPTS / "coc_starter.py")
    workspace = tmp_path / "ws"
    coc_root = workspace / ".coc"
    coc_root.mkdir(parents=True)
    (coc_root / "runtime.json").write_text(
        json.dumps(
            {
                "schema_version": 2,
                "planner": {"kind": "deterministic"},
                "rules": {"kind": "deterministic"},
                "narrator": {"kind": "template"},
                "player": {"kind": "human"},
            }
        ),
        "utf-8",
    )
    quick = coc_starter.quick_start(
        coc_root,
        "the-haunting",
        "thomas-hayes",
        campaign_id="rpc-cash",
        title="RPC Cash",
    )
    return workspace, "rpc-cash", str(quick["investigator_id"])


def _state_path(workspace: Path, campaign_id: str, investigator_id: str) -> Path:
    return (
        workspace
        / ".coc"
        / "campaigns"
        / campaign_id
        / "save"
        / "investigator-state"
        / f"{investigator_id}.json"
    )


def _write_cash(workspace: Path, campaign_id: str, investigator_id: str, cash) -> None:
    path = _state_path(workspace, campaign_id, investigator_id)
    raw = json.loads(path.read_text("utf-8")) if path.is_file() else {}
    if not isinstance(raw, dict):
        raw = {}
    raw["cash"] = cash
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(raw), "utf-8")


def _canonical_ledger() -> dict:
    stamp = {
        "elapsed_minutes": 0,
        "display": "",
        "location_id": None,
        "day_phase": "unknown",
        "player_time": {
            "phase": "unknown",
            "appearance_mode": "normal",
            "display_label": None,
            "source_ref": None,
        },
    }
    return {
        "schema_version": 2,
        "balances": {"USD": {"amount": "15.00", "unit": "dollar"}},
        "ledger": [
            {
                "decision_id": "cash-grant-1",
                "op": "grant",
                "amount": "20.00",
                "currency": "USD",
                "unit": "dollar",
                "source": "knott-retainer",
                "reason": "audit retainer",
                "localized_reason": "预付调查费",
                "balance_before": "0.00",
                "balance_after": "20.00",
                "tool": "state.cash_grant",
                "recorded_at": "1920-01-12T10:00:00+00:00",
                "game_time": stamp,
            },
            {
                "decision_id": "cash-spend-1",
                "op": "spend",
                "amount": "5.00",
                "currency": "USD",
                "unit": "dollar",
                "source": "taxi-fare",
                "reason": "audit fare",
                "localized_reason": "去波士顿街的车费",
                "balance_before": "20.00",
                "balance_after": "15.00",
                "tool": "state.cash_spend",
                "recorded_at": "1920-01-12T10:20:00+00:00",
                "game_time": stamp,
            },
        ],
    }


def test_display_character_projects_cash_from_authoritative_ledger(cash_workspace):
    workspace, campaign_id, inv = cash_workspace
    ledger = _canonical_ledger()
    _write_cash(workspace, campaign_id, inv, ledger)
    sheet = web_views.display_character(
        workspace, inv, "zh-Hans", campaign_id=campaign_id
    )
    assert sheet is not None
    cash = sheet["cash"]
    assert cash["schema_version"] == 2
    assert cash["balances"]["USD"]["amount"] == "15.00"
    assert cash["balances"]["USD"]["unit"] == "dollar"
    assert [row["op"] for row in cash["ledger"]] == ["grant", "spend"]
    assert cash["ledger"][0]["amount"] == "20.00"
    assert cash["ledger"][0]["localized_reason"] == "预付调查费"
    assert cash["ledger"][1]["localized_reason"] == "去波士顿街的车费"
    dumped = json.dumps(cash)
    assert "prose" not in dumped
    assert "source" not in cash["ledger"][0]
    assert "recorded_at" not in cash["ledger"][0]
    assert "reason" not in cash["ledger"][0]
    assert "tool" not in cash["ledger"][0]


def test_cash_projection_redacts_audit_fields_and_uses_game_time(cash_workspace):
    workspace, campaign_id, inv = cash_workspace
    stamp = {
        "elapsed_minutes": 90,
        "display": "1920年1月12日 上午",
        "location_id": "keeper-only-room",
        "day_phase": "morning",
        "player_time": {
            "phase": "morning",
            "appearance_mode": "normal",
            "display_label": "上午",
            "source_ref": "clock-secret",
        },
    }
    _write_cash(
        workspace,
        campaign_id,
        inv,
        {
            "schema_version": 2,
            "balances": {
                "USD": {"amount": "20.00", "unit": "dollar"},
                "GBP": {"amount": "1.50", "unit": "pound"},
            },
            "ledger": [
                {
                    "decision_id": "cash-usd-1",
                    "op": "grant",
                    "amount": "20.00",
                    "currency": "USD",
                    "unit": "dollar",
                    "source": "knott-retainer",
                    "reason": "audit retainer",
                    "localized_reason": "预付调查费",
                    "balance_before": "0.00",
                    "balance_after": "20.00",
                    "tool": "state.cash_grant",
                    "recorded_at": "1920-01-12T10:00:00+00:00",
                    "game_time": stamp,
                },
                {
                    "decision_id": "cash-gbp-1",
                    "op": "grant",
                    "amount": "1.50",
                    "currency": "GBP",
                    "unit": "pound",
                    "source": "sterling-tip",
                    "reason": "audit tip",
                    "localized_reason": "伦敦线人酬金",
                    "balance_before": "0.00",
                    "balance_after": "1.50",
                    "tool": "state.cash_grant",
                    "recorded_at": "1920-01-12T10:05:00+00:00",
                    "game_time": stamp,
                },
            ],
        },
    )
    sheet = web_views.display_character(
        workspace, inv, "zh-Hans", campaign_id=campaign_id
    )
    assert sheet is not None
    cash = sheet["cash"]
    assert cash["balances"]["USD"]["amount"] == "20.00"
    assert cash["balances"]["GBP"]["amount"] == "1.50"
    assert cash["ledger"][1]["amount"] == "1.50"
    assert cash["ledger"][1]["currency"] == "GBP"
    assert cash["ledger"][1]["localized_reason"] == "伦敦线人酬金"
    assert cash["ledger"][0]["localized_reason"] == "预付调查费"
    assert cash["ledger"][0]["game_time"]["display"] == "1920年1月12日 上午"
    assert cash["ledger"][0]["game_time"]["elapsed_minutes"] == 90
    assert "location_id" not in cash["ledger"][0]["game_time"]
    assert cash["ledger"][0]["player_time"]["phase"] == "morning"
    assert "source_ref" not in cash["ledger"][0]["player_time"]
    dumped = json.dumps(cash, ensure_ascii=False)
    for leaked in ("reason", "source", "tool", "recorded_at"):
        assert leaked not in cash["ledger"][0]
        assert leaked not in cash["ledger"][1]
    assert "knott-retainer" not in dumped
    assert "audit" not in dumped
    assert "1920-01-12T10" not in dumped
    assert "clock-secret" not in dumped
    assert "keeper-only-room" not in dumped


def test_display_character_empty_cash_is_safe(cash_workspace):
    workspace, campaign_id, inv = cash_workspace
    sheet = web_views.display_character(
        workspace, inv, "zh-Hans", campaign_id=campaign_id
    )
    assert sheet is not None
    cash = sheet["cash"]
    assert cash["schema_version"] == 2
    assert cash["balances"] == {}
    assert cash["ledger"] == []


def test_display_character_without_campaign_omits_cash(cash_workspace):
    workspace, _campaign_id, inv = cash_workspace
    sheet = web_views.display_character(workspace, inv, "zh-Hans")
    assert sheet is not None
    assert sheet["cash"] is None


def test_display_character_corrupt_or_missing_cash_does_not_crash(cash_workspace):
    workspace, campaign_id, inv = cash_workspace
    _write_cash(workspace, campaign_id, inv, "not-a-ledger")
    sheet = web_views.display_character(
        workspace, inv, "zh-Hans", campaign_id=campaign_id
    )
    assert sheet is not None
    assert sheet["cash"]["balances"] == {}
    assert sheet["cash"]["ledger"] == []

    path = _state_path(workspace, campaign_id, inv)
    path.write_text("{", "utf-8")
    sheet = web_views.display_character(
        workspace, inv, "zh-Hans", campaign_id=campaign_id
    )
    assert sheet is not None
    assert sheet["cash"]["balances"] == {}

    path.unlink()
    sheet = web_views.display_character(
        workspace, inv, "zh-Hans", campaign_id=campaign_id
    )
    assert sheet is not None
    assert sheet["cash"]["balances"] == {}
    assert sheet["cash"]["ledger"] == []
