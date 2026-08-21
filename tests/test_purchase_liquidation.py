"""Atomic purchase and asset liquidation on the runtime finance foundation."""
from __future__ import annotations

import importlib.util
import json
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


coc_finance = _load("coc_finance_purchase_test", SCRIPTS / "coc_finance.py")
coc_toolbox = _load("coc_toolbox_purchase_test", SCRIPTS / "coc_toolbox.py")
coc_starter = _load("coc_starter_purchase_test", SCRIPTS / "coc_starter.py")


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


@pytest.fixture
def campaign_ws(tmp_path: Path):
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "purchase-liq-test"
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
        title="Purchase Liquidation Test",
    )
    ws = {
        "workspace": workspace,
        "campaign_id": campaign_id,
        "campaign_dir": Path(quick["campaign_dir"]),
        "investigator_id": quick["investigator_id"],
    }
    _seed_finance(ws)
    return ws


def _run(ws, tool: str, args: dict | None = None) -> dict:
    payload = dict(args or {})
    if tool in {"state.cash_grant", "state.cash_spend"} and "localized_reason" not in payload:
        payload["localized_reason"] = str(payload.get("reason") or "table")
    return coc_toolbox.run_tool(tool, ws["workspace"], ws["campaign_id"], payload)


def _inv_path(ws) -> Path:
    return (
        ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{ws['investigator_id']}.json"
    )


def _seed_finance(ws, *, spending="10.00", assets="500.00"):
    finance = coc_finance.seed_finance_from_chargen(
        sheet={
            "era": "1920s",
            "living_standard": "Average",
            "spending_level": {"amount": spending, "currency": "USD"},
            "assets": {"amount": assets, "currency": "USD"},
        },
        decision_id="chargen-commit-runtime",
        recorded_at="2020-01-01T00:00:00+00:00",
        game_time={
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
        },
        period="1920s",
    )
    path = _inv_path(ws)
    state = json.loads(path.read_text(encoding="utf-8"))
    state["finance"] = finance
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _gear_args(ws, **overrides):
    payload = {
        "investigator": ws["investigator_id"],
        "kind": "gear",
        "label": "报纸",
        "item_id": "newspaper",
        "amount": 10,
        "currency": "USD",
        "source": "shop",
        "reason": "buy paper",
        "localized_reason": "买一份报纸",
        "decision_id": "buy-paper",
        "payment_mode": "spending_level",
    }
    payload.update(overrides)
    return payload


def _ensure_local_date(ws, date="1920-08-15"):
    path = ws["campaign_dir"] / "save" / "time-state.json"
    document = json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}
    clock = document.setdefault("clock", {})
    clock["local_date"] = date
    if not clock.get("local_datetime"):
        clock["local_datetime"] = f"{date}T10:00:00"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _clear_local_date(ws):
    path = ws["campaign_dir"] / "save" / "time-state.json"
    if not path.is_file():
        return
    document = json.loads(path.read_text(encoding="utf-8"))
    clock = document.setdefault("clock", {})
    clock["local_date"] = None
    clock["local_datetime"] = None
    path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def test_spending_level_threshold_inclusive(campaign_ws):
    ok = _run(campaign_ws, "state.purchase", _gear_args(campaign_ws, amount=10))
    assert ok["ok"] is True, ok
    assert ok["data"]["payment_mode"] == "spending_level"
    assert ok["data"]["charged_amount"] == "0.00"
    assert ok["data"]["settled"] is False
    cash = _run(campaign_ws, "state.cash_query", {"investigator": campaign_ws["investigator_id"]})
    assert cash["data"]["ledger"] == []
    over = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, amount="10.01", item_id="over-paper", decision_id="buy-over",
    ))
    assert over["ok"] is False
    assert over["error"]["code"] == "invalid_param"


def test_cash_purchase_and_insufficient_leaves_state_identical(campaign_ws):
    inv = campaign_ws["investigator_id"]
    granted = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv, "amount": 5, "currency": "USD",
        "source": "seed", "reason": "float", "decision_id": "cash-float",
    })
    assert granted["ok"] is True, granted
    path = _inv_path(campaign_ws)
    before = path.read_bytes()
    short = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, payment_mode="cash", amount=6, decision_id="buy-short",
    ))
    assert short["ok"] is False
    assert short["error"]["code"] == "insufficient_funds"
    assert path.read_bytes() == before
    bought = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, payment_mode="cash", amount=5, decision_id="buy-cash",
    ))
    assert bought["ok"] is True, bought
    assert bought["data"]["charged_amount"] == "5.00"
    assert bought["data"]["cash_balance_after"] == "0.00"
    listed = _run(campaign_ws, "state.cash_query", {"investigator": inv})
    assert listed["data"]["balances"]["USD"]["amount"] == "0.00"
    assert listed["data"]["ledger"][-1]["tool"] == "state.purchase"


def test_duplicate_item_id_does_not_charge(campaign_ws):
    inv = campaign_ws["investigator_id"]
    _run(campaign_ws, "state.cash_grant", {
        "investigator": inv, "amount": 20, "currency": "USD",
        "source": "seed", "reason": "float", "decision_id": "cash-float-dup",
    })
    first = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, payment_mode="cash", amount=2, decision_id="buy-once",
    ))
    assert first["ok"] is True, first
    path = _inv_path(campaign_ws)
    before = path.read_bytes()
    dup = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, payment_mode="cash", amount=2, decision_id="buy-twice",
    ))
    assert dup["ok"] is False
    assert "already present" in dup["error"]["message"]
    assert path.read_bytes() == before


def test_aggregate_same_day_totals_and_settles(campaign_ws):
    _ensure_local_date(campaign_ws)
    inv = campaign_ws["investigator_id"]
    _run(campaign_ws, "state.cash_grant", {
        "investigator": inv, "amount": 20, "currency": "USD",
        "source": "seed", "reason": "float", "decision_id": "cash-float-agg",
    })
    first = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, amount=3, item_id="ticket", label="车票", decision_id="sl-1",
    ))
    assert first["ok"] is True, first
    second = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, payment_mode="aggregate_cash", amount=4,
        item_id="lunch", label="午餐", decision_id="agg-1",
        aggregated_from=["sl-1"],
    ))
    assert second["ok"] is True, second
    assert second["data"]["charged_amount"] == "7.00"
    assert second["data"]["aggregated_from"] == ["sl-1"]
    queried = _run(campaign_ws, "state.finance_query", {"investigator": inv})
    history = {row["decision_id"]: row for row in queried["data"]["purchase_history"]}
    assert history["sl-1"]["settled"] is True
    assert history["sl-1"]["settled_by"] == "agg-1"
    assert queried["data"]["cash"]["balances"]["USD"]["amount"] == "13.00"


def test_aggregate_rejects_wrong_date_currency_and_settled(campaign_ws):
    _ensure_local_date(campaign_ws, "1920-08-15")
    inv = campaign_ws["investigator_id"]
    _run(campaign_ws, "state.cash_grant", {
        "investigator": inv, "amount": 50, "currency": "USD",
        "source": "seed", "reason": "float", "decision_id": "cash-float-bad",
    })
    _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, amount=2, item_id="a", decision_id="sl-a",
    ))
    settled = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, payment_mode="aggregate_cash", amount=1,
        item_id="b", decision_id="agg-first", aggregated_from=["sl-a"],
    ))
    assert settled["ok"] is True, settled
    again = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, payment_mode="aggregate_cash", amount=1,
        item_id="c", decision_id="agg-again", aggregated_from=["sl-a"],
    ))
    assert again["ok"] is False
    _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, amount=2, item_id="gbp-item", decision_id="sl-gbp",
    ))
    # Force the prior receipt currency mismatch by a GBP spend attempt after USD SL.
    gbp = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, payment_mode="aggregate_cash", amount=1, currency="GBP",
        item_id="d", decision_id="agg-gbp", aggregated_from=["sl-gbp"],
    ))
    assert gbp["ok"] is False
    _ensure_local_date(campaign_ws, "1920-08-16")
    dated = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, payment_mode="aggregate_cash", amount=1,
        item_id="e", decision_id="agg-date", aggregated_from=["sl-gbp"],
    ))
    assert dated["ok"] is False


def test_aggregate_without_local_date_fails(campaign_ws):
    _clear_local_date(campaign_ws)
    first = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, amount=2, item_id="undated", decision_id="sl-undated",
    ))
    assert first["ok"] is True, first
    agg = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, payment_mode="aggregate_cash", amount=1,
        item_id="now", decision_id="agg-nodate", aggregated_from=["sl-undated"],
    ))
    assert agg["ok"] is False
    assert agg["error"]["code"] == "invalid_param"


def test_purchase_replay_and_payload_conflict(campaign_ws):
    first = _run(campaign_ws, "state.purchase", _gear_args(campaign_ws, amount=4))
    assert first["ok"] is True, first
    replay = _run(campaign_ws, "state.purchase", _gear_args(campaign_ws, amount=4))
    assert replay["ok"] is True
    assert replay["data"] == first["data"]
    conflict = _run(campaign_ws, "state.purchase", _gear_args(campaign_ws, amount=5))
    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "idempotency_conflict"


def test_purchase_crash_repairs_sidecars(campaign_ws):
    inv = campaign_ws["investigator_id"]
    _run(campaign_ws, "state.cash_grant", {
        "investigator": inv, "amount": 8, "currency": "USD",
        "source": "seed", "reason": "float", "decision_id": "cash-float-crash",
    })
    bought = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, payment_mode="cash", amount=3, decision_id="buy-crash",
    ))
    assert bought["ok"] is True, bought
    ledger_path = campaign_ws["campaign_dir"] / "save" / "toolbox-ledger.json"
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    key = json.dumps(["state.purchase", "buy-crash"], ensure_ascii=False, separators=(",", ":"))
    del ledger["entries"][key]
    ledger_path.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    heads = campaign_ws["campaign_dir"] / "save" / "toolbox-asset-heads.json"
    if heads.is_file():
        heads.unlink()
    events_path = campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
    original_event = None
    if events_path.is_file():
        kept = []
        for line in events_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            if (
                isinstance(row, dict)
                and row.get("event_type") == "purchase"
                and row.get("decision_id") == "buy-crash"
            ):
                original_event = row
                continue
            kept.append(line)
        events_path.write_text(("\n".join(kept) + ("\n" if kept else "")), encoding="utf-8")
    assert original_event is not None
    replayed = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, payment_mode="cash", amount=3, decision_id="buy-crash",
    ))
    assert replayed["ok"] is True, replayed
    assert replayed["data"]["charged_amount"] == "3.00"
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    assert key in ledger["entries"]
    repaired = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
        and json.loads(line).get("event_type") == "purchase"
        and json.loads(line).get("decision_id") == "buy-crash"
    ]
    assert repaired == [original_event]
    state = json.loads(_inv_path(campaign_ws).read_text(encoding="utf-8"))
    assert repaired[0] == state["finance"]["receipts"]["state.purchase"]["buy-crash"]["event"]
    queried = _run(campaign_ws, "state.cash_query", {"investigator": inv})
    assert queried["ok"] is True


def test_purchase_toolbox_without_state_receipt_is_corrupt(campaign_ws):
    first = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, amount=2, item_id="corrupt-item", decision_id="buy-orphan",
    ))
    assert first["ok"] is True, first
    path = _inv_path(campaign_ws)
    state = json.loads(path.read_text(encoding="utf-8"))
    state["finance"]["receipts"]["state.purchase"] = {}
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    replay = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, amount=2, item_id="corrupt-item", decision_id="buy-orphan",
    ))
    assert replay["ok"] is False
    assert replay["error"]["code"] == "state_corrupt"


def test_liquidation_arithmetic_and_time_link(campaign_ws):
    inv = campaign_ws["investigator_id"]
    time_ok = _run(campaign_ws, "state.advance_time", {
        "minutes": 60, "reason": "sell property", "decision_id": "time-sell",
    })
    assert time_ok["ok"] is True, time_ok
    sold = _run(campaign_ws, "state.assets_liquidate", {
        "investigator": inv,
        "amount": 100,
        "currency": "USD",
        "linked_time_decision_id": "time-sell",
        "source": "sale",
        "reason": "sell lot",
        "localized_reason": "变卖产业",
        "decision_id": "liq-1",
    })
    assert sold["ok"] is True, sold
    assert sold["data"]["assets_balance_after"] == "400.00"
    assert sold["data"]["cash_balance_after"] == "100.00"
    assert sold["data"]["linked_time_decision_id"] == "time-sell"
    reused = _run(campaign_ws, "state.assets_liquidate", {
        "investigator": inv,
        "amount": 10,
        "currency": "USD",
        "linked_time_decision_id": "time-sell",
        "source": "sale",
        "reason": "again",
        "localized_reason": "再卖",
        "decision_id": "liq-2",
    })
    assert reused["ok"] is False
    zero = _run(campaign_ws, "state.advance_time", {
        "minutes": 0, "reason": "wait", "decision_id": "time-zero",
    })
    assert zero["ok"] is True
    bad_zero = _run(campaign_ws, "state.assets_liquidate", {
        "investigator": inv,
        "amount": 10,
        "currency": "USD",
        "linked_time_decision_id": "time-zero",
        "source": "sale",
        "reason": "zero",
        "localized_reason": "零时",
        "decision_id": "liq-zero",
    })
    assert bad_zero["ok"] is False
    missing = _run(campaign_ws, "state.assets_liquidate", {
        "investigator": inv,
        "amount": 10,
        "currency": "USD",
        "linked_time_decision_id": "time-missing",
        "source": "sale",
        "reason": "none",
        "localized_reason": "无",
        "decision_id": "liq-missing",
    })
    assert missing["ok"] is False
    fx = _run(campaign_ws, "state.assets_liquidate", {
        "investigator": inv,
        "amount": 10,
        "currency": "GBP",
        "linked_time_decision_id": "time-sell",
        "source": "sale",
        "reason": "fx",
        "localized_reason": "换汇",
        "decision_id": "liq-fx",
    })
    assert fx["ok"] is False
    path = _inv_path(campaign_ws)
    before = path.read_bytes()
    short = _run(campaign_ws, "state.assets_liquidate", {
        "investigator": inv,
        "amount": 9999,
        "currency": "USD",
        "linked_time_decision_id": "time-sell",
        "source": "sale",
        "reason": "too much",
        "localized_reason": "过多",
        "decision_id": "liq-short",
    })
    assert short["ok"] is False
    assert path.read_bytes() == before


def test_purchase_result_tamper_fails_closed(campaign_ws):
    bought = _run(campaign_ws, "state.purchase", _gear_args(campaign_ws, amount=2, item_id="tamper"))
    assert bought["ok"] is True, bought
    path = _inv_path(campaign_ws)
    state = json.loads(path.read_text(encoding="utf-8"))
    receipt = state["finance"]["receipts"]["state.purchase"]["buy-paper"]
    fingerprint = receipt["fingerprint"]
    digest = receipt["integrity_digest"]
    receipt["result"]["label"] = "篡改"
    assert receipt["fingerprint"] == fingerprint
    assert receipt["integrity_digest"] == digest
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    replay = _run(campaign_ws, "state.purchase", _gear_args(campaign_ws, amount=2, item_id="tamper"))
    assert replay["ok"] is False
    assert replay["error"]["code"] == "state_corrupt"


def test_finalizer_emits_one_composite_effect():
    game_time = {
        "elapsed_minutes": 30,
        "display": "1920-08-15 10:30",
        "player_time": {"phase": "morning", "appearance_mode": "normal", "display_label": None},
    }
    purchase = {
        "ok": True,
        "tool": "state.purchase",
        "args": {"decision_id": "buy-1", "investigator": "hero"},
        "data": {
            "changed": True,
            "investigator_id": "hero",
            "decision_id": "buy-1",
            "payment_mode": "cash",
            "item_id": "paper",
            "label": "报纸",
            "kind": "gear",
            "amount": "3.00",
            "charged_amount": "3.00",
            "currency": "USD",
            "cash_balance_before": "10.00",
            "cash_balance_after": "7.00",
            "localized_reason": "买报",
            "game_time": game_time,
        },
    }
    effects = coc_toolbox.coc_turn_finalization._project_state_deltas([purchase])
    assert len(effects) == 1
    assert effects[0]["effect_kind"] == "purchase"
    assert "item" not in {row["effect_kind"] for row in effects}
    assert "cash" not in {row["effect_kind"] for row in effects}
    rendered = coc_toolbox.coc_turn_finalization._render_state_delta(
        effects[0], play_language="zh-Hans",
    )
    assert "报纸" in rendered
    assert "买报" in rendered
    assert "reason" not in rendered
    liquidate = {
        "ok": True,
        "tool": "state.assets_liquidate",
        "args": {"decision_id": "liq-1", "investigator": "hero"},
        "data": {
            "changed": True,
            "investigator_id": "hero",
            "decision_id": "liq-1",
            "amount": "50.00",
            "currency": "USD",
            "assets_balance_before": "500.00",
            "assets_balance_after": "450.00",
            "cash_balance_before": "7.00",
            "cash_balance_after": "57.00",
            "linked_time_decision_id": "time-1",
            "localized_reason": "变卖产业",
            "game_time": game_time,
        },
    }
    liq_effects = coc_toolbox.coc_turn_finalization._project_state_deltas([liquidate])
    assert len(liq_effects) == 1
    assert liq_effects[0]["effect_kind"] == "assets_liquidate"
    sl = dict(purchase)
    sl["data"] = dict(purchase["data"])
    sl["data"]["payment_mode"] = "spending_level"
    sl["data"]["charged_amount"] = "0.00"
    sl["data"]["cash_balance_after"] = "10.00"
    sl["data"]["cash_balance_before"] = "10.00"
    sl_effects = coc_toolbox.coc_turn_finalization._project_state_deltas([sl])
    text = coc_toolbox.coc_turn_finalization._render_state_delta(
        sl_effects[0], play_language="zh-Hans",
    )
    assert "现金未变" in text


def _sheet_path(ws) -> Path:
    return (
        ws["workspace"] / ".coc" / "investigators" / ws["investigator_id"] / "character.json"
    )


def test_sheet_equipment_and_weapon_ids_block_purchase(campaign_ws):
    inv = campaign_ws["investigator_id"]
    path = _sheet_path(campaign_ws)
    sheet = json.loads(path.read_text(encoding="utf-8"))
    equipment = list(sheet.get("equipment") or [])
    equipment.append({"item_id": "family-watch", "label": "怀表"})
    sheet["equipment"] = equipment
    weapons = list(sheet.get("weapons") or [])
    weapons.append({"weapon_id": "heirloom-blade"})
    sheet["weapons"] = weapons
    path.write_text(json.dumps(sheet, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    _run(campaign_ws, "state.cash_grant", {
        "investigator": inv, "amount": 20, "currency": "USD",
        "source": "seed", "reason": "float", "decision_id": "cash-float-sheet",
    })
    before = _inv_path(campaign_ws).read_bytes()
    gear = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, payment_mode="cash", amount=2,
        item_id="family-watch", label="怀表", decision_id="buy-watch",
    ))
    assert gear["ok"] is False
    assert "already present" in gear["error"]["message"]
    assert _inv_path(campaign_ws).read_bytes() == before
    blade = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, payment_mode="cash", amount=2,
        item_id="heirloom-blade", label="刀", decision_id="buy-blade",
    ))
    assert blade["ok"] is False
    assert _inv_path(campaign_ws).read_bytes() == before


def test_same_decision_changed_item_fields_conflict(campaign_ws):
    first = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, amount=2, item_id="bandages", label="绷带",
        consumable=True, quantity=3, note="from stall", decision_id="buy-bandages",
    ))
    assert first["ok"] is True, first
    note_conflict = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, amount=2, item_id="bandages", label="绷带",
        consumable=True, quantity=3, note="from shop", decision_id="buy-bandages",
    ))
    assert note_conflict["ok"] is False
    assert note_conflict["error"]["code"] == "idempotency_conflict"
    qty_conflict = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, amount=2, item_id="bandages", label="绷带",
        consumable=True, quantity=4, note="from stall", decision_id="buy-bandages",
    ))
    assert qty_conflict["ok"] is False
    assert qty_conflict["error"]["code"] == "idempotency_conflict"
    replay = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, amount=2, item_id="bandages", label="绷带",
        consumable=True, quantity=3, note="from stall", decision_id="buy-bandages",
    ))
    assert replay["ok"] is True
    assert replay["data"] == first["data"]


def test_substring_event_does_not_count_as_repair(campaign_ws):
    bought = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, amount=2, item_id="lantern", decision_id="buy-lantern",
    ))
    assert bought["ok"] is True, bought
    events_path = campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
    original = None
    kept = []
    for line in events_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        if (
            isinstance(row, dict)
            and row.get("event_type") == "purchase"
            and row.get("decision_id") == "buy-lantern"
        ):
            original = row
            continue
        kept.append(line)
    assert original is not None
    kept.append(json.dumps({"event_type": "noise", "note": "buy-lantern mentioned"}))
    events_path.write_text("\n".join(kept) + "\n", encoding="utf-8")
    replayed = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, amount=2, item_id="lantern", decision_id="buy-lantern",
    ))
    assert replayed["ok"] is True, replayed
    restored = [
        json.loads(line)
        for line in events_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
        and json.loads(line).get("event_type") == "purchase"
        and json.loads(line).get("decision_id") == "buy-lantern"
    ]
    assert restored == [original]


def test_conflicting_toolbox_ledger_fails_closed(campaign_ws):
    bought = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, amount=2, item_id="matchbox", decision_id="buy-match",
    ))
    assert bought["ok"] is True, bought
    ledger_path = campaign_ws["campaign_dir"] / "save" / "toolbox-ledger.json"
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    key = json.dumps(["state.purchase", "buy-match"], ensure_ascii=False, separators=(",", ":"))
    ledger["entries"][key]["data"]["charged_amount"] = "9.99"
    ledger_path.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    replay = _run(campaign_ws, "state.purchase", _gear_args(
        campaign_ws, amount=2, item_id="matchbox", decision_id="buy-match",
    ))
    assert replay["ok"] is False
    assert replay["error"]["code"] == "state_corrupt"
