"""Runtime finance authority: seed, query, fail-closed receipts, recovery primitives."""
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


coc_finance = _load("coc_finance_under_test", SCRIPTS / "coc_finance.py")
coc_toolbox = _load("coc_toolbox_finance_test", SCRIPTS / "coc_toolbox.py")
coc_starter = _load("coc_starter_finance_test", SCRIPTS / "coc_starter.py")


def _write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


@pytest.fixture
def campaign_ws(tmp_path: Path):
    workspace = tmp_path / "workspace"
    coc_root = workspace / ".coc"
    campaign_id = "finance-runtime-test"
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
        title="Finance Runtime Test",
    )
    return {
        "workspace": workspace,
        "campaign_id": campaign_id,
        "campaign_dir": Path(quick["campaign_dir"]),
        "investigator_id": quick["investigator_id"],
    }


def _run(ws, tool: str, args: dict | None = None) -> dict:
    return coc_toolbox.run_tool(tool, ws["workspace"], ws["campaign_id"], args or {})


def _inv_path(ws) -> Path:
    return (
        ws["campaign_dir"]
        / "save"
        / "investigator-state"
        / f"{ws['investigator_id']}.json"
    )


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


def _purchase_item(**overrides):
    item = {"kind": "gear", "item_id": "paper", "label": "newspaper"}
    item.update(overrides)
    return item


def _purchase_request_body(**overrides):
    request = {
        "investigator": "ada",
        "payment_mode": "cash",
        "amount": "1.00",
        "currency": "USD",
        "item": _purchase_item(),
        "source": "shop",
        "reason": "buy paper",
        "localized_reason": "买报",
    }
    request.update(overrides)
    return request


def _purchase_event(decision_id: str = "buy-1", **overrides):
    event = {
        "event_type": "purchase",
        "investigator_id": "ada",
        "decision_id": decision_id,
        "payment_mode": "cash",
        "amount": "1.00",
        "currency": "USD",
        "item_id": "paper",
        "ts": "2020-01-01T00:00:00+00:00",
    }
    event.update(overrides)
    return event


def _purchase_result(decision_id: str = "buy-1", **overrides):
    result = {
        "changed": True,
        "investigator_id": "ada",
        "decision_id": decision_id,
        "payment_mode": "cash",
        "item_id": "paper",
        "label": "newspaper",
        "kind": "gear",
        "amount": "1.00",
        "currency": "USD",
        "charged_amount": "1.00",
        "cash_balance_before": "10.00",
        "cash_balance_after": "9.00",
        "localized_reason": "买报",
        "game_time": _game_time(),
        "local_date": "1920-08-15",
        "settled": True,
        "settled_by": None,
        "aggregated_from": [],
    }
    result.update(overrides)
    return result


def _liquidate_request_body(**overrides):
    request = {
        "investigator": "ada",
        "amount": "10.00",
        "currency": "USD",
        "linked_time_decision_id": "time-1",
        "source": "sale",
        "reason": "sell lot",
        "localized_reason": "变现",
    }
    request.update(overrides)
    return request


def _liquidate_event(decision_id: str = "liq-1", **overrides):
    event = {
        "event_type": "assets_liquidate",
        "investigator_id": "ada",
        "decision_id": decision_id,
        "amount": "10.00",
        "currency": "USD",
        "linked_time_decision_id": "time-1",
        "ts": "2020-01-01T00:00:00+00:00",
    }
    event.update(overrides)
    return event


def _liquidate_result(decision_id: str = "liq-1", **overrides):
    result = {
        "changed": True,
        "investigator_id": "ada",
        "decision_id": decision_id,
        "amount": "10.00",
        "currency": "USD",
        "assets_balance_before": "50.00",
        "assets_balance_after": "40.00",
        "cash_balance_before": "5.00",
        "cash_balance_after": "15.00",
        "linked_time_decision_id": "time-1",
        "localized_reason": "变现",
        "game_time": _game_time(),
    }
    result.update(overrides)
    return result


def test_finance_query_fails_closed_when_unseeded(campaign_ws):
    queried = _run(campaign_ws, "state.finance_query", {
        "investigator": campaign_ws["investigator_id"],
    })
    assert queried["ok"] is False
    assert queried["error"]["code"] == "state_corrupt"
    assert "missing" in queried["error"]["message"]


def test_finance_query_fails_closed_on_malformed_state(campaign_ws):
    path = _inv_path(campaign_ws)
    state = json.loads(path.read_text(encoding="utf-8"))
    state["finance"] = {"schema_version": 0, "assets": 12}
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    queried = _run(campaign_ws, "state.finance_query", {
        "investigator": campaign_ws["investigator_id"],
    })
    assert queried["ok"] is False
    assert queried["error"]["code"] == "state_corrupt"


def test_finance_query_does_not_read_sheet_snapshot(campaign_ws):
    inv = campaign_ws["investigator_id"]
    finance = coc_finance.seed_finance_from_chargen(
        sheet={
            "era": "1920s",
            "living_standard": "Average",
            "spending_level": {"amount": 10, "currency": "USD"},
            "assets": {"amount": 500, "currency": "USD"},
        },
        decision_id="chargen-commit-runtime",
        recorded_at="2020-01-01T00:00:00+00:00",
        game_time=_game_time(),
    )
    path = _inv_path(campaign_ws)
    state = json.loads(path.read_text(encoding="utf-8"))
    state["finance"] = finance
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    first = _run(campaign_ws, "state.finance_query", {"investigator": inv})
    assert first["ok"] is True, first
    sheet_path = (
        campaign_ws["workspace"] / ".coc" / "investigators" / inv / "character.json"
    )
    sheet = json.loads(sheet_path.read_text(encoding="utf-8"))
    sheet["living_standard"] = "Super Rich"
    sheet["spending_level"] = {"amount": 5000, "currency": "USD"}
    sheet["assets"] = {"amount": 999999, "currency": "USD"}
    sheet_path.write_text(json.dumps(sheet, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    queried = _run(campaign_ws, "state.finance_query", {"investigator": inv})
    assert queried["ok"] is True, queried
    assert queried["data"]["living_standard"] == "Average"
    assert queried["data"]["spending_level"]["amount"] == "10.00"
    assert queried["data"]["assets"]["balances"]["USD"]["amount"] == "500.00"
    assert queried["data"]["living_standard"] != sheet["living_standard"]


def test_seed_finance_from_chargen_builds_current_schema():
    finance = coc_finance.seed_finance_from_chargen(
        sheet={
            "era": "1920s",
            "living_standard": "Average",
            "spending_level": {"amount": 10, "currency": "USD"},
            "assets": {"amount": 500, "currency": "USD", "formula": "CR x 50"},
            "cash": {"amount": 20, "currency": "USD"},
        },
        decision_id="chargen-commit-demo",
        recorded_at="2020-01-01T00:00:00+00:00",
        game_time=_game_time(),
    )
    assert finance["period"] == "1920s"
    assert finance["living_standard"] == "Average"
    assert finance["spending_level"] == {"amount": "10.00", "currency": "USD"}
    assert finance["assets"]["balances"]["USD"]["amount"] == "500.00"
    assert finance["assets"]["ledger"][0]["op"] == "seed"
    assert "formula" not in finance["spending_level"]
    assert finance["receipts"] == {"state.purchase": {}, "state.assets_liquidate": {}}


def test_normalize_finance_rejects_duplicate_and_mismatched_receipts():
    finance = coc_finance.seed_finance_from_chargen(
        sheet={
            "era": "1920s",
            "living_standard": "Poor",
            "spending_level": {"amount": 2, "currency": "USD"},
            "assets": {"amount": 10, "currency": "USD"},
        },
        decision_id="seed-1",
        recorded_at="2020-01-01T00:00:00+00:00",
        game_time=_game_time(),
    )
    receipt = coc_finance.make_finance_operation_receipt(
        tool="state.purchase",
        decision_id="buy-1",
        request=_purchase_request_body(),
        result=_purchase_result(),
        event=_purchase_event(),
    )
    finance["receipts"]["state.purchase"]["buy-1"] = receipt
    assert coc_finance.normalize_finance(finance)["receipts"]["state.purchase"]["buy-1"][
        "decision_id"
    ] == "buy-1"
    broken = json.loads(json.dumps(finance))
    broken["receipts"]["state.purchase"]["buy-1"]["fingerprint"] = "sha256:dead"
    with pytest.raises(ValueError, match="fingerprint"):
        coc_finance.normalize_finance(broken)
    mismatched = json.loads(json.dumps(finance))
    mismatched["receipts"]["state.purchase"]["other"] = receipt
    with pytest.raises(ValueError, match="identity is mismatched"):
        coc_finance.normalize_finance(mismatched)
    crossed = json.loads(json.dumps(finance))
    other = coc_finance.make_finance_operation_receipt(
        tool="state.assets_liquidate",
        decision_id="buy-1",
        request=_liquidate_request_body(),
        result=_liquidate_result("buy-1"),
        event=_liquidate_event("buy-1"),
    )
    crossed["receipts"]["state.assets_liquidate"]["buy-1"] = other
    with pytest.raises(ValueError, match="duplicate decision_id"):
        coc_finance.normalize_finance(crossed)
    with pytest.raises(ValueError, match="duplicate decision_id"):
        coc_finance.attach_finance_operation_receipt(
            {"finance": finance}, other
        )


def test_source_receipt_replay_validates_before_return():
    state = {
        "finance": coc_finance.seed_finance_from_chargen(
            sheet={
                "era": "1920s",
                "living_standard": "Average",
                "spending_level": {"amount": 10, "currency": "USD"},
                "assets": {"amount": 50, "currency": "USD"},
            },
            decision_id="seed-1",
            recorded_at="2020-01-01T00:00:00+00:00",
            game_time=_game_time(),
        )
    }
    request = _purchase_request_body(
        amount="2.00",
        item=_purchase_item(item_id="lantern", label="lantern"),
    )
    assert coc_finance.replay_finance_source_receipt(
        state=state,
        tool="state.purchase",
        decision_id="buy-1",
        request=request,
    ) is None
    closed_result = _purchase_result(item_id="lantern", label="lantern", amount="2.00", charged_amount="2.00", cash_balance_before="10.00", cash_balance_after="8.00")
    receipt = coc_finance.make_finance_operation_receipt(
        tool="state.purchase",
        decision_id="buy-1",
        request=request,
        result=closed_result,
        event=_purchase_event(item_id="lantern", amount="2.00"),
    )
    coc_finance.attach_finance_operation_receipt(state, receipt)
    replayed = coc_finance.replay_finance_source_receipt(
        state=state,
        tool="state.purchase",
        decision_id="buy-1",
        request=request,
    )
    assert replayed == closed_result
    with pytest.raises(coc_finance.FinanceReceiptConflict):
        coc_finance.replay_finance_source_receipt(
            state=state,
            tool="state.purchase",
            decision_id="buy-1",
            request=_purchase_request_body(
                amount="2.00",
                item=_purchase_item(item_id="other", label="other"),
            ),
        )
    corrupt = json.loads(json.dumps(state))
    corrupt["finance"]["receipts"]["state.purchase"]["buy-1"]["fingerprint"] = "sha256:dead"
    with pytest.raises(coc_finance.FinanceStateCorrupt):
        coc_finance.replay_finance_source_receipt(
            state=corrupt,
            tool="state.purchase",
            decision_id="buy-1",
            request=request,
        )
    identity = json.loads(json.dumps(state))
    identity["finance"]["receipts"]["state.purchase"]["buy-1"]["tool"] = "state.assets_liquidate"
    with pytest.raises(coc_finance.FinanceStateCorrupt):
        coc_finance.replay_finance_source_receipt(
            state=identity,
            tool="state.purchase",
            decision_id="buy-1",
            request=request,
        )
    missing = {"finance": None}
    with pytest.raises(coc_finance.FinanceStateCorrupt, match="missing"):
        coc_finance.replay_finance_source_receipt(
            state=missing,
            tool="state.purchase",
            decision_id="buy-1",
            request=request,
        )


def test_replay_fails_closed_when_only_stored_result_is_mutated():
    request = _purchase_request_body(
        amount="2.00",
        item=_purchase_item(item_id="lantern", label="lantern"),
    )
    result = _purchase_result(item_id="lantern", label="lantern", amount="2.00", charged_amount="2.00", cash_balance_before="10.00", cash_balance_after="8.00")
    state = {
        "finance": coc_finance.seed_finance_from_chargen(
            sheet={
                "era": "1920s",
                "living_standard": "Average",
                "spending_level": {"amount": 10, "currency": "USD"},
                "assets": {"amount": 50, "currency": "USD"},
            },
            decision_id="seed-1",
            recorded_at="2020-01-01T00:00:00+00:00",
            game_time=_game_time(),
        )
    }
    receipt = coc_finance.make_finance_operation_receipt(
        tool="state.purchase",
        decision_id="buy-1",
        request=request,
        result=result,
        event=_purchase_event(item_id="lantern", amount="2.00"),
    )
    coc_finance.attach_finance_operation_receipt(state, receipt)
    fingerprint = state["finance"]["receipts"]["state.purchase"]["buy-1"]["fingerprint"]
    digest = state["finance"]["receipts"]["state.purchase"]["buy-1"][
        coc_finance.FINANCE_RECEIPT_INTEGRITY_KEY
    ]
    tampered = json.loads(json.dumps(state))
    tampered["finance"]["receipts"]["state.purchase"]["buy-1"]["result"][
        "payment_mode"
    ] = "spending_level"
    stored = tampered["finance"]["receipts"]["state.purchase"]["buy-1"]
    assert stored["fingerprint"] == fingerprint
    assert stored["request"] == request
    assert stored[coc_finance.FINANCE_RECEIPT_INTEGRITY_KEY] == digest
    with pytest.raises(coc_finance.FinanceStateCorrupt, match="integrity"):
        coc_finance.replay_finance_source_receipt(
            state=tampered,
            tool="state.purchase",
            decision_id="buy-1",
            request=request,
        )
    with pytest.raises(ValueError, match="integrity"):
        coc_finance.normalize_finance(tampered["finance"])


def test_assets_seed_and_adjust_chain():
    seeded, entry = coc_finance.apply_assets(
        coc_finance.empty_assets(),
        op="seed",
        amount="50.00",
        currency="USD",
        unit=None,
        source="chargen-credit-rating",
        reason="investigator creation credit-rating conversion",
        localized_reason="建卡·信用评级换算",
        decision_id="seed-1",
        recorded_at="2020-01-01T00:00:00+00:00",
        game_time=_game_time(),
        tool="setup.chargen_run",
    )
    assert entry["op"] == "seed"
    adjusted, credit = coc_finance.apply_assets(
        seeded,
        op="adjust",
        amount="10.00",
        currency="USD",
        unit=None,
        source="chargen-credit-rating-adjust",
        reason="investigator creation credit-rating delta",
        localized_reason="建卡重跑·信用评级差额调整",
        decision_id="adj-1",
        recorded_at="2020-01-01T00:00:00+00:00",
        game_time=_game_time(),
        tool="setup.chargen_run",
        adjust_credit=True,
    )
    assert credit["balance_after"] == "60.00"
    liquidated, sold = coc_finance.apply_assets(
        adjusted,
        op="liquidate",
        amount="15.00",
        currency="USD",
        unit=None,
        source="sale",
        reason="sell lot",
        localized_reason="变现",
        decision_id="liq-1",
        recorded_at="2020-01-01T00:00:00+00:00",
        game_time=_game_time(),
        tool="state.assets_liquidate",
    )
    assert sold["balance_after"] == "45.00"
    assert coc_finance.normalize_assets(liquidated)["balances"]["USD"]["amount"] == "45.00"
    with pytest.raises(ValueError, match="assets ledger tool does not match op"):
        coc_finance.apply_assets(
            seeded,
            op="liquidate",
            amount="1.00",
            currency="USD",
            unit=None,
            source="sale",
            reason="bad tool",
            localized_reason="bad",
            decision_id="liq-bad",
            recorded_at="2020-01-01T00:00:00+00:00",
            game_time=_game_time(),
            tool="state.cash_spend",
        )


def test_normalize_rejects_foreign_finance_seed_provenance():
    finance = coc_finance.seed_finance_from_chargen(
        sheet={
            "era": "1920s",
            "living_standard": "Average",
            "spending_level": {"amount": 10, "currency": "USD"},
            "assets": {"amount": 500, "currency": "USD"},
        },
        decision_id="chargen-commit-demo",
        recorded_at="2020-01-01T00:00:00+00:00",
        game_time=_game_time(),
    )
    foreign_source = json.loads(json.dumps(finance))
    foreign_source["seed"]["source"] = "hand-edit"
    with pytest.raises(ValueError, match="source is not chargen"):
        coc_finance.normalize_finance(foreign_source)
    disconnected = json.loads(json.dumps(finance))
    disconnected["assets"]["ledger"][0]["decision_id"] = "other-seed"
    with pytest.raises(ValueError, match="does not match finance seed"):
        coc_finance.normalize_finance(disconnected)
    with pytest.raises(ValueError, match="does not match chargen"):
        coc_finance.assert_chargen_finance_provenance(finance, "other-commit")


def test_chargen_replay_fails_closed_on_matching_numbers_foreign_seed(campaign_ws):
    inv = campaign_ws["investigator_id"]
    sheet = {
        "era": "1920s",
        "living_standard": "Average",
        "spending_level": {"amount": 10, "currency": "USD"},
        "assets": {"amount": 500, "currency": "USD"},
    }
    finance = coc_finance.seed_finance_from_chargen(
        sheet=sheet,
        decision_id="foreign-commit",
        recorded_at="2020-01-01T00:00:00+00:00",
        game_time=_game_time(),
    )
    path = _inv_path(campaign_ws)
    state = json.loads(path.read_text(encoding="utf-8"))
    state["finance"] = finance
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with pytest.raises(
        coc_toolbox.coc_runtime_ops.RuntimeOperationError,
        match="does not match chargen",
    ):
        coc_toolbox.coc_runtime_ops._seed_chargen_runtime_finance(
            campaign_ws["workspace"],
            campaign_id=campaign_ws["campaign_id"],
            investigator_id=inv,
            sheet=sheet,
            decision_id="chargen-commit-real",
            fingerprint="sha256:abc",
        )
