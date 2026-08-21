"""Runtime cash ledger: grant, spend, query, insufficient funds, idempotency."""
from __future__ import annotations

import importlib.util
import json
from copy import deepcopy
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


coc_cash = _load("coc_cash_under_test", SCRIPTS / "coc_cash.py")
coc_toolbox = _load("coc_toolbox_cash_test", SCRIPTS / "coc_toolbox.py")
coc_starter = _load("coc_starter_cash_test", SCRIPTS / "coc_starter.py")


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


@pytest.fixture
def campaign_ws(tmp_path: Path):
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "cash-ledger-test"
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
        title="Cash Ledger Test",
    )
    return {
        "workspace": workspace,
        "campaign_id": campaign_id,
        "campaign_dir": Path(quick["campaign_dir"]),
        "investigator_id": quick["investigator_id"],
    }


def _run(ws, tool: str, args: dict | None = None) -> dict:
    payload = dict(args or {})
    if tool in {"state.cash_grant", "state.cash_spend"} and "localized_reason" not in payload:
        payload["localized_reason"] = str(payload.get("reason") or "table")
    return coc_toolbox.run_tool(tool, ws["workspace"], ws["campaign_id"], payload)


def test_cash_grant_spend_query_and_replay(campaign_ws):
    inv = campaign_ws["investigator_id"]
    empty = _run(campaign_ws, "state.cash_query", {"investigator": inv})
    assert empty["ok"] is True, empty
    assert empty["data"]["schema_version"] == 2
    assert empty["data"]["balances"] == {}
    assert empty["data"]["ledger"] == []

    granted = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 20,
        "currency": "USD",
        "unit": "dollar",
        "source": "knott-advance",
        "reason": "Knott pays twenty dollars in advance",
        "decision_id": "cash-grant-20",
    })
    assert granted["ok"] is True, granted
    assert granted["data"]["op"] == "grant"
    assert granted["data"]["amount"] == "20.00"
    assert granted["data"]["balance_after"] == "20.00"
    assert granted["data"]["source"] == "knott-advance"

    replayed = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 20,
        "currency": "USD",
        "unit": "dollar",
        "source": "knott-advance",
        "reason": "Knott pays twenty dollars in advance",
        "decision_id": "cash-grant-20",
    })
    assert replayed["ok"] is True, replayed
    assert replayed["data"] == granted["data"]
    assert "duplicate decision_id" in replayed["warnings"][0]

    spent = _run(campaign_ws, "state.cash_spend", {
        "investigator": inv,
        "amount": 3.5,
        "currency": "USD",
        "unit": "dollar",
        "source": "cab-fare",
        "reason": "cab to Boston Street",
        "decision_id": "cash-spend-cab",
    })
    assert spent["ok"] is True, spent
    assert spent["data"]["balance_after"] == "16.50"

    listed = _run(campaign_ws, "state.cash_query", {
        "investigator": inv,
        "limit": 1,
    })
    assert listed["ok"] is True
    assert listed["data"]["balances"]["USD"]["amount"] == "16.50"
    assert listed["data"]["balances"]["USD"]["unit"] == "dollar"
    assert len(listed["data"]["ledger"]) == 1
    assert listed["data"]["ledger"][0]["op"] == "spend"


def test_cash_spend_insufficient_and_currency_mismatch(campaign_ws):
    inv = campaign_ws["investigator_id"]
    short = _run(campaign_ws, "state.cash_spend", {
        "investigator": inv,
        "amount": 1,
        "currency": "USD",
        "source": "newspaper",
        "reason": "buy a paper",
        "decision_id": "cash-spend-paper",
    })
    assert short["ok"] is False
    assert short["error"]["code"] == "insufficient_funds"
    assert short["error"]["details"]["balance"] == "0.00"
    assert short["error"]["details"]["held"] == {}

    _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 5,
        "currency": "USD",
        "source": "starting-float",
        "reason": "opening cash",
        "decision_id": "cash-grant-5",
    })
    gbp = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 1,
        "currency": "GBP",
        "source": "second-purse",
        "reason": "independent sterling",
        "decision_id": "cash-grant-gbp",
    })
    assert gbp["ok"] is True, gbp
    listed = _run(campaign_ws, "state.cash_query", {"investigator": inv})
    assert listed["data"]["balances"]["USD"]["amount"] == "5.00"
    assert listed["data"]["balances"]["GBP"]["amount"] == "1.00"


def test_cash_decision_conflict_and_precision(campaign_ws):
    inv = campaign_ws["investigator_id"]
    first = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 5,
        "currency": "USD",
        "source": "float",
        "reason": "opening float",
        "decision_id": "cash-same-id",
    })
    assert first["ok"] is True, first
    conflict = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 9,
        "currency": "USD",
        "source": "float",
        "reason": "opening float",
        "decision_id": "cash-same-id",
    })
    assert conflict["ok"] is False
    assert conflict["error"]["code"] == "idempotency_conflict"
    over = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": "20.123",
        "currency": "USD",
        "source": "over-precise",
        "reason": "must reject",
        "decision_id": "cash-over-precise",
    })
    assert over["ok"] is False
    assert over["error"]["code"] == "invalid_param"
    two_places = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": "1.25",
        "currency": "USD",
        "source": "exact-cents",
        "reason": "two decimal places",
        "decision_id": "cash-cents",
    })
    assert two_places["ok"] is True, two_places
    assert two_places["data"]["amount"] == "1.25"
    assert two_places["data"]["balance_after"] == "6.25"


def test_cash_interrupted_replay_does_not_double_apply(campaign_ws):
    inv = campaign_ws["investigator_id"]
    granted = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 10,
        "currency": "USD",
        "source": "pay",
        "reason": "interrupted apply",
        "decision_id": "cash-interrupt",
    })
    assert granted["ok"] is True, granted
    ledger_path = campaign_ws["campaign_dir"] / "save" / "toolbox-ledger.json"
    ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    key = json.dumps(["state.cash_grant", "cash-interrupt"], ensure_ascii=False, separators=(",", ":"))
    assert key in ledger["entries"]
    del ledger["entries"][key]
    ledger_path.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    events_path = campaign_ws["campaign_dir"] / "logs" / "events.jsonl"
    if events_path.is_file():
        kept = [
            line for line in events_path.read_text(encoding="utf-8").splitlines()
            if line.strip() and "cash-interrupt" not in line
        ]
        events_path.write_text(("\n".join(kept) + ("\n" if kept else "")), encoding="utf-8")
    replayed = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 10,
        "currency": "USD",
        "source": "pay",
        "reason": "interrupted apply",
        "decision_id": "cash-interrupt",
    })
    assert replayed["ok"] is True, replayed
    assert replayed["data"]["balance_after"] == "10.00"
    assert replayed["data"]["amount"] == granted["data"]["amount"]
    listed = _run(campaign_ws, "state.cash_query", {"investigator": inv})
    assert listed["data"]["balances"]["USD"]["amount"] == "10.00"
    assert len(listed["data"]["ledger"]) == 1


def test_cash_cross_tool_decision_id_grant_then_spend(campaign_ws):
    inv = campaign_ws["investigator_id"]
    granted = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 8,
        "currency": "USD",
        "source": "seed",
        "reason": "open",
        "decision_id": "cash-shared-id",
    })
    assert granted["ok"] is True, granted
    spent = _run(campaign_ws, "state.cash_spend", {
        "investigator": inv,
        "amount": 1,
        "currency": "USD",
        "source": "reuse",
        "reason": "must conflict",
        "decision_id": "cash-shared-id",
    })
    assert spent["ok"] is False
    assert spent["error"]["code"] == "idempotency_conflict"
    listed = _run(campaign_ws, "state.cash_query", {"investigator": inv})
    assert listed["ok"] is True
    assert listed["data"]["balances"]["USD"]["amount"] == "8.00"
    assert [row["decision_id"] for row in listed["data"]["ledger"]] == ["cash-shared-id"]
    assert listed["data"]["ledger"][0]["op"] == "grant"


def test_cash_cross_tool_decision_id_spend_then_grant(campaign_ws):
    inv = campaign_ws["investigator_id"]
    seed = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 8,
        "currency": "USD",
        "source": "seed",
        "reason": "open",
        "decision_id": "cash-seed",
    })
    assert seed["ok"] is True, seed
    spent = _run(campaign_ws, "state.cash_spend", {
        "investigator": inv,
        "amount": 2,
        "currency": "USD",
        "source": "fee",
        "reason": "pay",
        "decision_id": "cash-shared-id-2",
    })
    assert spent["ok"] is True, spent
    granted = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 1,
        "currency": "USD",
        "source": "reuse",
        "reason": "must conflict",
        "decision_id": "cash-shared-id-2",
    })
    assert granted["ok"] is False
    assert granted["error"]["code"] == "idempotency_conflict"
    listed = _run(campaign_ws, "state.cash_query", {"investigator": inv})
    assert listed["ok"] is True
    assert listed["data"]["balances"]["USD"]["amount"] == "6.00"
    assert [row["decision_id"] for row in listed["data"]["ledger"]] == [
        "cash-seed", "cash-shared-id-2",
    ]
    assert listed["data"]["ledger"][1]["op"] == "spend"


def test_cash_replay_rejects_rolled_back_ledger(campaign_ws):
    inv = campaign_ws["investigator_id"]
    first = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 10,
        "currency": "USD",
        "source": "first",
        "reason": "seed",
        "decision_id": "cash-roll-1",
    })
    second = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 5,
        "currency": "USD",
        "source": "second",
        "reason": "more",
        "decision_id": "cash-roll-2",
    })
    assert first["ok"] is True and second["ok"] is True, (first, second)
    path = (
        campaign_ws["campaign_dir"] / "save" / "investigator-state" / f"{inv}.json"
    )
    state = json.loads(path.read_text(encoding="utf-8"))
    rolled = deepcopy(state["cash"])
    rolled["ledger"] = rolled["ledger"][:1]
    rolled["balances"] = {"USD": {"amount": "10.00"}}
    state["cash"] = rolled
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    replayed = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 5,
        "currency": "USD",
        "source": "second",
        "reason": "more",
        "decision_id": "cash-roll-2",
    })
    assert replayed["ok"] is False
    assert replayed["error"]["code"] == "state_corrupt"
    listed = _run(campaign_ws, "state.cash_query", {"investigator": inv})
    assert listed["ok"] is False
    assert listed["error"]["code"] == "state_corrupt"


def test_cash_unit_identity_cannot_fill_none(campaign_ws):
    inv = campaign_ws["investigator_id"]
    first = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 4,
        "currency": "USD",
        "source": "no-unit",
        "reason": "seed without unit",
        "decision_id": "cash-unit-none",
    })
    assert first["ok"] is True, first
    assert first["data"].get("unit") is None
    later = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 1,
        "currency": "USD",
        "unit": "dollar",
        "source": "fill-unit",
        "reason": "must not fill unit",
        "decision_id": "cash-unit-fill",
    })
    assert later["ok"] is False
    assert later["error"]["code"] == "invalid_param"
    listed = _run(campaign_ws, "state.cash_query", {"investigator": inv})
    assert listed["ok"] is True
    assert listed["data"]["balances"]["USD"]["amount"] == "4.00"
    assert "unit" not in listed["data"]["balances"]["USD"]
    assert len(listed["data"]["ledger"]) == 1


def test_cash_omitted_unit_inherits_recorded(campaign_ws):
    inv = campaign_ws["investigator_id"]
    first = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 4,
        "currency": "USD",
        "unit": "dollar",
        "source": "with-unit",
        "reason": "seed with unit",
        "decision_id": "cash-unit-set",
    })
    assert first["ok"] is True, first
    later = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 1,
        "currency": "USD",
        "source": "omit-unit",
        "reason": "inherit recorded unit",
        "decision_id": "cash-unit-inherit",
    })
    assert later["ok"] is True, later
    assert later["data"]["unit"] == "dollar"
    listed = _run(campaign_ws, "state.cash_query", {"investigator": inv})
    assert listed["ok"] is True
    assert listed["data"]["balances"]["USD"]["amount"] == "5.00"
    assert listed["data"]["balances"]["USD"]["unit"] == "dollar"
    assert len(listed["data"]["ledger"]) == 2


def test_cash_unit_identity_rejects_mismatch(campaign_ws):
    inv = campaign_ws["investigator_id"]
    first = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 4,
        "currency": "USD",
        "unit": "dollar",
        "source": "with-unit",
        "reason": "seed with unit",
        "decision_id": "cash-unit-set",
    })
    assert first["ok"] is True, first
    later = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 1,
        "currency": "USD",
        "unit": "pound",
        "source": "wrong-unit",
        "reason": "must not change unit",
        "decision_id": "cash-unit-mismatch",
    })
    assert later["ok"] is False
    assert later["error"]["code"] == "invalid_param"
    listed = _run(campaign_ws, "state.cash_query", {"investigator": inv})
    assert listed["ok"] is True
    assert listed["data"]["balances"]["USD"]["amount"] == "4.00"
    assert listed["data"]["balances"]["USD"]["unit"] == "dollar"
    assert len(listed["data"]["ledger"]) == 1


def test_cash_replay_rejects_tampered_state(campaign_ws):
    inv = campaign_ws["investigator_id"]
    granted = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 7,
        "currency": "USD",
        "source": "pay",
        "reason": "then tamper",
        "decision_id": "cash-tamper-replay",
    })
    assert granted["ok"] is True, granted
    path = (
        campaign_ws["campaign_dir"] / "save" / "investigator-state" / f"{inv}.json"
    )
    state = json.loads(path.read_text(encoding="utf-8"))
    assert "operation_receipts" in state
    state["cash"] = {
        "schema_version": 2,
        "balances": {"USD USD": {"amount": "7.00"}},
        "ledger": state["cash"]["ledger"],
    }
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    replayed = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 7,
        "currency": "USD",
        "source": "pay",
        "reason": "then tamper",
        "decision_id": "cash-tamper-replay",
    })
    assert replayed["ok"] is False
    assert replayed["error"]["code"] == "state_corrupt"


def test_item_grant_is_keeper_discoverable():
    policy = coc_toolbox.operation_policy("state.item_grant")
    assert policy["audience"] == "keeper"
    assert policy["contract"] == "state"
    assert policy["kp_surface"] == "state"
    assert "live_turn" in policy["phases"]
    live = set(coc_toolbox.query_operations(audience="keeper"))
    for name in (
        "state.item_grant",
        "state.item_remove",
        "state.item_use",
        "state.inventory_list",
        "state.cash_grant",
        "state.cash_spend",
        "state.cash_query",
        "state.finance_query",
        "state.purchase",
        "state.assets_liquidate",
    ):
        assert name in live
    described = coc_toolbox._describe("state.item_grant")
    assert "before narrating" in described["summary"]
    cash_desc = coc_toolbox._describe("state.cash_grant")
    assert "decision_id" in cash_desc["params"]
    assert cash_desc["params"]["amount"]["required"] is True
    assert cash_desc["params"]["reason"]["required"] is True
    assert cash_desc["params"]["localized_reason"]["required"] is True
    assert "game_time" not in cash_desc["params"]
    assert "recorded_at" not in cash_desc["params"]
    spend_desc = coc_toolbox._describe("state.cash_spend")
    assert spend_desc["params"]["reason"]["required"] is True
    assert spend_desc["params"]["localized_reason"]["required"] is True
    finance_desc = coc_toolbox._describe("state.finance_query")
    assert "chargen sheet snapshot" in finance_desc["summary"]


def test_cash_grant_exposes_changed_for_finalization(campaign_ws):
    inv = campaign_ws["investigator_id"]
    granted = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 12,
        "currency": "USD",
        "source": "pay",
        "reason": "visible purse",
        "localized_reason": "预付",
        "decision_id": "cash-changed-visible",
    })
    assert granted["ok"] is True, granted
    assert granted["data"]["changed"] is True
    assert granted["data"]["investigator_id"] == inv
    replayed = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 12,
        "currency": "USD",
        "source": "pay",
        "reason": "visible purse",
        "localized_reason": "预付",
        "decision_id": "cash-changed-visible",
    })
    assert replayed["ok"] is True, replayed
    assert replayed["data"] == granted["data"]
    effects = coc_toolbox.coc_turn_finalization._project_state_deltas([
        {
            "ok": True,
            "tool": "state.cash_grant",
            "args": {"decision_id": "cash-changed-visible", "investigator": inv},
            "data": granted["data"],
        }
    ])
    assert len(effects) == 1
    assert effects[0]["effect_kind"] == "cash"
    assert effects[0]["amount"] == "12.00"
    assert effects[0]["localized_reason"] == "预付"


def test_normalize_accepts_composite_cash_producers():
    spend = _grant_entry(amount="2.00", before="5.00", after="3.00")
    spend["op"] = "spend"
    spend["tool"] = "state.purchase"
    spend["decision_id"] = "buy-1"
    purchased = coc_cash.normalize_cash(_seeded(
        amount="3.00",
        ledger=[_grant_entry(), spend],
    ))
    assert purchased["ledger"][1]["tool"] == "state.purchase"
    grant = _grant_entry(amount="4.00", before="5.00", after="9.00")
    grant["tool"] = "state.assets_liquidate"
    grant["decision_id"] = "liq-1"
    liquidated = coc_cash.normalize_cash(_seeded(
        amount="9.00",
        ledger=[_grant_entry(), grant],
    ))
    assert liquidated["ledger"][1]["tool"] == "state.assets_liquidate"


def test_normalize_rejects_arbitrary_cash_producer_tool():
    row = _grant_entry()
    row["tool"] = "state.item_grant"
    with pytest.raises(ValueError, match="ledger tool does not match op"):
        coc_cash.normalize_cash(_seeded(ledger=[row]))
    spend = _grant_entry(amount="2.00", before="5.00", after="3.00")
    spend["op"] = "spend"
    spend["tool"] = "state.assets_liquidate"
    spend["decision_id"] = "bad-liq-spend"
    with pytest.raises(ValueError, match="ledger tool does not match op"):
        coc_cash.normalize_cash(_seeded(amount="3.00", ledger=[_grant_entry(), spend]))


def test_apply_cash_accepts_future_composite_producers():
    next_state, spent = coc_cash.apply_cash(
        _seeded(),
        op="spend",
        amount="1.00",
        currency="USD",
        unit=None,
        source="shop",
        reason="buy paper",
        localized_reason="买报",
        decision_id="purchase-1",
        recorded_at="2020-01-01T00:00:00+00:00",
        game_time=_game_time(),
        tool="state.purchase",
    )
    assert spent["tool"] == "state.purchase"
    assert next_state["balances"]["USD"]["amount"] == "4.00"
    _next, granted = coc_cash.apply_cash(
        next_state,
        op="grant",
        amount="2.00",
        currency="USD",
        unit=None,
        source="sale",
        reason="liquidate lot",
        localized_reason="变现",
        decision_id="liquidate-1",
        recorded_at="2020-01-01T00:00:00+00:00",
        game_time=_game_time(),
        tool="state.assets_liquidate",
    )
    assert granted["tool"] == "state.assets_liquidate"
    with pytest.raises(ValueError, match="ledger tool does not match op"):
        coc_cash.apply_cash(
            _seeded(),
            op="grant",
            amount="1.00",
            currency="USD",
            unit=None,
            source="shop",
            reason="nope",
            localized_reason="nope",
            decision_id="bogus-1",
            recorded_at="2020-01-01T00:00:00+00:00",
            game_time=_game_time(),
            tool="state.item_grant",
        )


def test_cash_amount_cap_is_stable_tool_error(campaign_ws):
    inv = campaign_ws["investigator_id"]
    huge = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": "1" + "0" * 50,
        "currency": "USD",
        "source": "overflow",
        "reason": "must not escape",
        "decision_id": "cash-too-large",
    })
    assert huge["ok"] is False
    assert huge["error"]["code"] == "invalid_param"
    with pytest.raises(ValueError, match="at most"):
        coc_cash.parse_amount(10 ** 50)
    assert coc_cash.parse_amount(coc_cash.AMOUNT_MAX) == coc_cash.AMOUNT_MAX


def _game_time():
    return {
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


def _grant_entry(*, amount="5.00", before="0.00", after="5.00", currency="USD", unit=None):
    row = {
        "decision_id": "cash-grant-5",
        "op": "grant",
        "amount": amount,
        "currency": currency,
        "source": "float",
        "reason": "opening float",
        "localized_reason": "opening float",
        "balance_before": before,
        "balance_after": after,
        "tool": "state.cash_grant",
        "recorded_at": "2020-01-01T00:00:00+00:00",
        "game_time": _game_time(),
    }
    if unit is not None:
        row["unit"] = unit
    return row


def _seeded(amount="5.00", ledger=None, currency="USD", unit=None, **overrides):
    rows = ledger if ledger is not None else [_grant_entry(amount=amount, after=amount, currency=currency, unit=unit)]
    wallet = {"amount": amount}
    if unit is not None:
        wallet["unit"] = unit
    payload = {
        "schema_version": 2,
        "balances": {currency: wallet},
        "ledger": rows,
    }
    payload.update(overrides)
    return payload


def _query_corrupt(campaign_ws, cash):
    inv = campaign_ws["investigator_id"]
    path = (
        campaign_ws["campaign_dir"] / "save" / "investigator-state" / f"{inv}.json"
    )
    state = json.loads(path.read_text(encoding="utf-8"))
    state["cash"] = cash
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    queried = _run(campaign_ws, "state.cash_query", {"investigator": inv})
    assert queried["ok"] is False, queried
    assert queried["error"]["code"] == "state_corrupt"
    mutated = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 1,
        "currency": "USD",
        "source": "after-corrupt",
        "reason": "must fail closed",
        "decision_id": "cash-after-corrupt",
    })
    assert mutated["ok"] is False, mutated
    assert mutated["error"]["code"] == "state_corrupt"
    return queried


def test_normalize_rejects_negative_balance():
    with pytest.raises(ValueError):
        coc_cash.normalize_cash(_seeded(
            amount="-1.00",
            ledger=[_grant_entry(amount="1.00", after="-1.00")],
        ))


def test_normalize_rejects_currency_format():
    with pytest.raises(ValueError):
        coc_cash.normalize_cash(_seeded(currency="USD USD"))


def test_normalize_rejects_legacy_single_wallet():
    with pytest.raises(ValueError):
        coc_cash.normalize_cash({
            "amount": "5.00",
            "currency": "USD",
            "unit": None,
            "seeded": True,
            "ledger": [_grant_entry()],
        })


def test_normalize_rejects_legacy_ts_row():
    row = _grant_entry()
    row["ts"] = "2020-01-01T00:00:00+00:00"
    with pytest.raises(ValueError):
        coc_cash.normalize_cash(_seeded(ledger=[row]))


def test_normalize_rejects_unit_length():
    with pytest.raises(ValueError):
        coc_cash.normalize_cash(_seeded(
            unit="x" * 33,
            ledger=[_grant_entry(unit="x" * 33)],
        ))


def test_normalize_rejects_ledger_type():
    with pytest.raises(ValueError):
        coc_cash.normalize_cash(_seeded(ledger="not-a-list"))


def test_normalize_rejects_ledger_extra_fields():
    extra = _grant_entry()
    extra["note"] = "bonus"
    with pytest.raises(ValueError):
        coc_cash.normalize_cash(_seeded(ledger=[extra]))


def test_normalize_rejects_duplicate_decision_id():
    first = _grant_entry(amount="5.00", after="5.00")
    second = _grant_entry(amount="3.00", before="5.00", after="8.00")
    second["decision_id"] = first["decision_id"]
    with pytest.raises(ValueError):
        coc_cash.normalize_cash(_seeded(amount="8.00", ledger=[first, second]))


def test_normalize_rejects_tool_op_mismatch():
    row = _grant_entry()
    row["tool"] = "state.cash_spend"
    with pytest.raises(ValueError):
        coc_cash.normalize_cash(_seeded(ledger=[row]))
    spend = _grant_entry(amount="5.00", before="5.00", after="0.00")
    spend["op"] = "spend"
    spend["tool"] = "state.cash_grant"
    spend["decision_id"] = "cash-spend-1"
    with pytest.raises(ValueError):
        coc_cash.normalize_cash(_seeded(
            amount="0.00",
            ledger=[_grant_entry(), spend],
        ))


def test_normalize_rejects_ledger_currency_mismatch():
    with pytest.raises(ValueError):
        coc_cash.normalize_cash(_seeded(
            ledger=[_grant_entry(currency="GBP")],
        ))


def test_normalize_rejects_ledger_arithmetic_break():
    with pytest.raises(ValueError):
        coc_cash.normalize_cash(_seeded(
            amount="5.00",
            ledger=[_grant_entry(amount="5.00", before="0.00", after="9.00")],
        ))


def test_normalize_rejects_final_balance_mismatch():
    with pytest.raises(ValueError):
        coc_cash.normalize_cash(_seeded(
            amount="8.00",
            ledger=[_grant_entry(amount="5.00", after="5.00")],
        ))


def test_normalize_rejects_schema_version():
    with pytest.raises(ValueError):
        coc_cash.normalize_cash(_seeded(schema_version=1))


def test_unseeded_empty_ledger_is_valid():
    empty = coc_cash.normalize_cash(None)
    assert empty["schema_version"] == 2
    assert empty["balances"] == {}
    assert empty["ledger"] == []
    assert coc_cash.normalize_cash({
        "schema_version": 2,
        "balances": {},
        "ledger": [],
    })["balances"] == {}
    with pytest.raises(ValueError):
        coc_cash.normalize_cash(_seeded(ledger=[]))


def test_query_and_grant_fail_closed_on_corrupt_cash(campaign_ws):
    _query_corrupt(campaign_ws, _seeded(currency="USD USD"))


def _cash_head_path(ws):
    return ws["campaign_dir"] / "save" / "toolbox-asset-heads.json"


def _patch_cash_head(ws, investigator_id, **changes):
    path = _cash_head_path(ws)
    document = json.loads(path.read_text(encoding="utf-8"))
    key = f"cash:investigator:{investigator_id}"
    document["heads"][key].update(changes)
    path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def test_cash_head_tool_tamper_fails_closed(campaign_ws):
    inv = campaign_ws["investigator_id"]
    granted = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 5,
        "currency": "USD",
        "source": "seed",
        "reason": "open",
        "decision_id": "cash-head-tool",
    })
    assert granted["ok"] is True, granted
    ok = _run(campaign_ws, "state.cash_query", {"investigator": inv})
    assert ok["ok"] is True
    _patch_cash_head(campaign_ws, inv, tool="state.cash_spend")
    queried = _run(campaign_ws, "state.cash_query", {"investigator": inv})
    assert queried["ok"] is False
    assert queried["error"]["code"] == "state_corrupt"


def test_cash_head_decision_id_tamper_fails_closed(campaign_ws):
    inv = campaign_ws["investigator_id"]
    granted = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 5,
        "currency": "USD",
        "source": "seed",
        "reason": "open",
        "decision_id": "cash-head-id",
    })
    assert granted["ok"] is True, granted
    _patch_cash_head(campaign_ws, inv, decision_id="cash-other-id")
    queried = _run(campaign_ws, "state.cash_query", {"investigator": inv})
    assert queried["ok"] is False
    assert queried["error"]["code"] == "state_corrupt"


def test_cash_head_old_receipt_provenance_fails_closed(campaign_ws):
    inv = campaign_ws["investigator_id"]
    first = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 8,
        "currency": "USD",
        "source": "seed",
        "reason": "open",
        "decision_id": "cash-head-old",
    })
    second = _run(campaign_ws, "state.cash_spend", {
        "investigator": inv,
        "amount": 2,
        "currency": "USD",
        "source": "fee",
        "reason": "later",
        "decision_id": "cash-head-new",
    })
    assert first["ok"] and second["ok"]
    _patch_cash_head(
        campaign_ws,
        inv,
        tool="state.cash_grant",
        decision_id="cash-head-old",
    )
    queried = _run(campaign_ws, "state.cash_query", {"investigator": inv})
    assert queried["ok"] is False
    assert queried["error"]["code"] == "state_corrupt"


def _read_heads(ws):
    return json.loads(_cash_head_path(ws).read_text(encoding="utf-8"))


def _write_heads(ws, document):
    _cash_head_path(ws).write_text(
        json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def test_cash_replay_repairs_missing_or_stale_head(campaign_ws):
    inv = campaign_ws["investigator_id"]
    first = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 10,
        "currency": "USD",
        "source": "seed",
        "reason": "open",
        "decision_id": "cash-head-repair-1",
    })
    second = _run(campaign_ws, "state.cash_spend", {
        "investigator": inv,
        "amount": 3,
        "currency": "USD",
        "source": "fee",
        "reason": "later",
        "decision_id": "cash-head-repair-2",
    })
    assert first["ok"] and second["ok"]
    key = f"cash:investigator:{inv}"
    heads = _read_heads(campaign_ws)
    latest = deepcopy(heads["heads"][key])
    stale = deepcopy(latest)
    stale["revision_after"] = 1
    stale["tool"] = "state.cash_grant"
    stale["decision_id"] = "cash-head-repair-1"
    del heads["heads"][key]
    _write_heads(campaign_ws, heads)
    assert _run(campaign_ws, "state.cash_query", {"investigator": inv})["ok"] is False
    replay_missing = _run(campaign_ws, "state.cash_spend", {
        "investigator": inv,
        "amount": 3,
        "currency": "USD",
        "source": "fee",
        "reason": "later",
        "decision_id": "cash-head-repair-2",
    })
    assert replay_missing["ok"] is True, replay_missing
    queried = _run(campaign_ws, "state.cash_query", {"investigator": inv})
    assert queried["ok"] is True
    assert queried["data"]["balances"]["USD"]["amount"] == "7.00"
    assert _read_heads(campaign_ws)["heads"][key]["decision_id"] == "cash-head-repair-2"
    heads = _read_heads(campaign_ws)
    heads["heads"][key] = stale
    _write_heads(campaign_ws, heads)
    replay_stale = _run(campaign_ws, "state.cash_spend", {
        "investigator": inv,
        "amount": 3,
        "currency": "USD",
        "source": "fee",
        "reason": "later",
        "decision_id": "cash-head-repair-2",
    })
    assert replay_stale["ok"] is True, replay_stale
    queried = _run(campaign_ws, "state.cash_query", {"investigator": inv})
    assert queried["ok"] is True
    assert queried["data"]["balances"]["USD"]["amount"] == "7.00"
    repaired = _read_heads(campaign_ws)["heads"][key]
    assert repaired["decision_id"] == "cash-head-repair-2"
    assert repaired["tool"] == "state.cash_spend"
    assert repaired["revision_after"] == 2
    _patch_cash_head(campaign_ws, inv, tool="state.cash_grant")
    tampered = _run(campaign_ws, "state.cash_query", {"investigator": inv})
    assert tampered["ok"] is False
    assert tampered["error"]["code"] == "state_corrupt"


def test_cash_earlier_grant_replays_after_later_spend(campaign_ws):
    inv = campaign_ws["investigator_id"]
    granted = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 10,
        "currency": "USD",
        "source": "pay",
        "reason": "advance",
        "decision_id": "cash-early",
    })
    assert granted["ok"] is True, granted
    spent = _run(campaign_ws, "state.cash_spend", {
        "investigator": inv,
        "amount": 3,
        "currency": "USD",
        "source": "fee",
        "reason": "later",
        "decision_id": "cash-later",
    })
    assert spent["ok"] is True, spent
    replayed = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 10,
        "currency": "USD",
        "source": "pay",
        "reason": "advance",
        "decision_id": "cash-early",
    })
    assert replayed["ok"] is True, replayed
    assert replayed["data"]["balance_after"] == "10.00"
    listed = _run(campaign_ws, "state.cash_query", {"investigator": inv})
    assert listed["ok"] is True
    assert listed["data"]["balances"]["USD"]["amount"] == "7.00"
    assert [row["decision_id"] for row in listed["data"]["ledger"]] == [
        "cash-early", "cash-later",
    ]


def test_cash_source_receipt_truncation_fails_closed(campaign_ws):
    inv = campaign_ws["investigator_id"]
    first = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 10,
        "currency": "USD",
        "source": "pay",
        "reason": "advance",
        "decision_id": "cash-keep-src",
    })
    second = _run(campaign_ws, "state.cash_spend", {
        "investigator": inv,
        "amount": 3,
        "currency": "USD",
        "source": "fee",
        "reason": "later",
        "decision_id": "cash-newer-src",
    })
    assert first["ok"] and second["ok"]
    path = (
        campaign_ws["campaign_dir"] / "save" / "investigator-state" / f"{inv}.json"
    )
    state = json.loads(path.read_text(encoding="utf-8"))
    receipts = state.get("operation_receipts") or {}
    spend_receipts = dict(receipts.get("state.cash_spend") or {})
    spend_receipts.pop("cash-newer-src", None)
    receipts["state.cash_spend"] = spend_receipts
    state["operation_receipts"] = receipts
    cash = deepcopy(state["cash"])
    cash["ledger"] = cash["ledger"][:1]
    cash["balances"] = {"USD": {"amount": "10.00"}}
    state["cash"] = cash
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    queried = _run(campaign_ws, "state.cash_query", {"investigator": inv})
    assert queried["ok"] is False
    assert queried["error"]["code"] == "state_corrupt"
    replayed = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 10,
        "currency": "USD",
        "source": "pay",
        "reason": "advance",
        "decision_id": "cash-keep-src",
    })
    assert replayed["ok"] is False
    assert replayed["error"]["code"] == "state_corrupt"


def test_cash_multi_currency_independent_spend_and_no_fx(campaign_ws):
    inv = campaign_ws["investigator_id"]
    usd = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 20,
        "currency": "USD",
        "source": "usd-float",
        "reason": "dollars",
        "localized_reason": "Knott 预付二十美元",
        "decision_id": "cash-usd-20",
    })
    gbp = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 8,
        "currency": "GBP",
        "source": "gbp-float",
        "reason": "pounds",
        "localized_reason": "一笔八英镑",
        "decision_id": "cash-gbp-8",
    })
    assert usd["ok"] and gbp["ok"]
    spent = _run(campaign_ws, "state.cash_spend", {
        "investigator": inv,
        "amount": 3,
        "currency": "USD",
        "source": "usd-fee",
        "reason": "cab",
        "localized_reason": "车费三美元",
        "decision_id": "cash-usd-spend-3",
    })
    assert spent["ok"] is True, spent
    assert spent["data"]["currency"] == "USD"
    assert spent["data"]["balance_after"] == "17.00"
    short = _run(campaign_ws, "state.cash_spend", {
        "investigator": inv,
        "amount": 9,
        "currency": "GBP",
        "source": "gbp-over",
        "reason": "cannot use dollars",
        "localized_reason": "英镑不够",
        "decision_id": "cash-gbp-over",
    })
    assert short["ok"] is False
    assert short["error"]["code"] == "insufficient_funds"
    assert short["error"]["details"]["currency"] == "GBP"
    assert short["error"]["details"]["balance"] == "8.00"
    listed = _run(campaign_ws, "state.cash_query", {"investigator": inv})
    assert listed["data"]["balances"]["USD"]["amount"] == "17.00"
    assert listed["data"]["balances"]["GBP"]["amount"] == "8.00"
    assert {row["currency"] for row in listed["data"]["ledger"]} == {"USD", "GBP"}
    row = listed["data"]["ledger"][0]
    assert row["localized_reason"] == "Knott 预付二十美元"
    assert isinstance(row["game_time"], dict)
    assert "elapsed_minutes" in row["game_time"]
    assert "recorded_at" in row
    assert "ts" not in row


def test_cash_currency_identity_aliases_share_one_wallet(campaign_ws):
    inv = campaign_ws["investigator_id"]
    granted = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 20,
        "currency": "usd",
        "source": "usd-float",
        "reason": "lowercase code",
        "decision_id": "cash-alias-usd",
    })
    assert granted["ok"] is True, granted
    assert granted["data"]["currency"] == "USD"
    yuan = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 5,
        "currency": "美元",
        "source": "cny-label",
        "reason": "chinese alias is still USD identity",
        "decision_id": "cash-alias-han",
    })
    assert yuan["ok"] is True, yuan
    spent = _run(campaign_ws, "state.cash_spend", {
        "investigator": inv,
        "amount": 3,
        "currency": "USD",
        "source": "usd-fee",
        "reason": "canonical spend",
        "decision_id": "cash-alias-spend",
    })
    assert spent["ok"] is True, spent
    listed = _run(campaign_ws, "state.cash_query", {"investigator": inv})
    assert listed["ok"] is True, listed
    assert listed["data"]["balances"] == {"USD": {"amount": "22.00"}}
    assert "usd" not in listed["data"]["balances"]
    assert "美元" not in listed["data"]["balances"]
    gbp = _run(campaign_ws, "state.cash_grant", {
        "investigator": inv,
        "amount": 1,
        "currency": "英镑",
        "source": "sterling",
        "reason": "alias to GBP, not USD",
        "decision_id": "cash-alias-gbp",
    })
    assert gbp["ok"] is True, gbp
    listed = _run(campaign_ws, "state.cash_query", {"investigator": inv})
    assert listed["data"]["balances"]["USD"]["amount"] == "22.00"
    assert listed["data"]["balances"]["GBP"]["amount"] == "1.00"
    short = _run(campaign_ws, "state.cash_spend", {
        "investigator": inv,
        "amount": 2,
        "currency": "GBP",
        "source": "overdraw",
        "reason": "not enough sterling",
        "decision_id": "cash-alias-short",
    })
    assert short["ok"] is False
    assert short["error"]["code"] == "insufficient_funds"
    assert short["error"]["details"]["held"] == {
        "USD": "22.00",
        "GBP": "1.00",
    }


def test_cash_requires_localized_reason(campaign_ws):
    inv = campaign_ws["investigator_id"]
    missing = coc_toolbox.run_tool(
        "state.cash_grant",
        campaign_ws["workspace"],
        campaign_ws["campaign_id"],
        {
            "investigator": inv,
            "amount": 1,
            "currency": "USD",
            "source": "need-loc",
            "reason": "audit only",
            "decision_id": "cash-no-loc",
        },
    )
    assert missing["ok"] is False
    assert missing["error"]["code"] in {"invalid_param", "missing_param"}


def test_apply_requires_game_time_and_recorded_at():
    with pytest.raises(ValueError):
        coc_cash.apply_cash(
            coc_cash.empty_cash(),
            op="grant",
            amount="1.00",
            currency="USD",
            unit=None,
            source="x",
            reason="audit",
            localized_reason="桌上可见",
            decision_id="cash-no-stamp",
            recorded_at="2020-01-01T00:00:00+00:00",
            game_time=None,
            tool="state.cash_grant",
        )


def _apply(
    cash,
    *,
    op="grant",
    amount="1.00",
    currency="USD",
    unit=None,
    decision_id="cash-apply-1",
):
    return coc_cash.apply_cash(
        cash,
        op=op,
        amount=amount,
        currency=currency,
        unit=unit,
        source="src",
        reason="audit",
        localized_reason="桌上",
        decision_id=decision_id,
        recorded_at="2020-01-01T00:00:00+00:00",
        game_time=_game_time(),
        tool=f"state.cash_{op}",
    )


def test_validate_currency_canonicalizes_identity_aliases():
    assert coc_cash.validate_currency("usd") == "USD"
    assert coc_cash.validate_currency("USD") == "USD"
    assert coc_cash.validate_currency("  usd ") == "USD"
    assert coc_cash.validate_currency("美元") == "USD"
    assert coc_cash.validate_currency("美金") == "USD"
    assert coc_cash.validate_currency("dollar") == "USD"
    assert coc_cash.validate_currency("gbp") == "GBP"
    assert coc_cash.validate_currency("英镑") == "GBP"
    with pytest.raises(ValueError):
        coc_cash.validate_currency("USD USD")
    with pytest.raises(ValueError):
        coc_cash.validate_currency("")


def test_apply_cash_aliases_and_omitted_unit_share_wallet():
    cash, first = _apply(
        coc_cash.empty_cash(),
        amount="5.00",
        currency="usd",
        unit="dollar",
        decision_id="cash-apply-grant",
    )
    assert first["currency"] == "USD"
    cash, inherited = _apply(
        cash,
        amount="1.00",
        currency="美元",
        unit=None,
        decision_id="cash-apply-inherit",
    )
    assert inherited["currency"] == "USD"
    assert inherited["unit"] == "dollar"
    assert cash["balances"] == {"USD": {"amount": "6.00", "unit": "dollar"}}
    cash, spent = _apply(
        cash,
        op="spend",
        amount="2.00",
        currency="USD",
        decision_id="cash-apply-spend",
    )
    assert spent["currency"] == "USD"
    assert cash["balances"]["USD"]["amount"] == "4.00"


def test_apply_cash_hits_legacy_lowercase_wallet_without_renaming():
    cash = coc_cash.normalize_cash(_seeded(amount="5.00", currency="usd"))
    assert "usd" in cash["balances"]
    next_state, entry = _apply(
        cash,
        op="spend",
        amount="1.00",
        currency="USD",
        decision_id="cash-legacy-spend",
    )
    assert entry["currency"] == "usd"
    assert next_state["balances"]["usd"]["amount"] == "4.00"
    assert "USD" not in next_state["balances"]


def test_normalize_rejects_alias_currency_collision():
    with pytest.raises(ValueError, match="duplicate currency"):
        coc_cash.normalize_cash({
            "schema_version": 2,
            "balances": {
                "USD": {"amount": "5.00"},
                "usd": {"amount": "1.00"},
            },
            "ledger": [_grant_entry()],
        })
