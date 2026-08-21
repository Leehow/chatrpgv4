"""Campaign-local runtime finance authority for investigator play.

Character-sheet ``cash`` / ``assets`` / ``spending_level`` / ``living_standard``
remain the chargen snapshot. ``setup.chargen_run`` seeds this envelope once onto
``save/investigator-state/<id>.json["finance"]``. Live Assets, Spending Level,
and living standard are read from here, never from the reusable sheet and never
from ``toolbox-asset-heads.json`` (cash integrity metadata only).

Missing or non-current finance fails closed. There is no empty default and no
migration. Composite purchase and liquidation store investigator-state
receipts here first; derived cash-head, event, and toolbox-ledger sidecars
are repaired on exact replay by those tools.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from copy import deepcopy
from decimal import Decimal
from pathlib import Path
from typing import Any, Mapping


def _load_cash():
    existing = sys.modules.get("coc_cash")
    if existing is not None:
        return existing
    path = Path(__file__).resolve().parent / "coc_cash.py"
    spec = importlib.util.spec_from_file_location("coc_cash", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules["coc_cash"] = module
    spec.loader.exec_module(module)
    return module


coc_cash = _load_cash()
CASH_LIQUIDATE_TOOL = coc_cash.CASH_LIQUIDATE_TOOL
CASH_PURCHASE_TOOL = coc_cash.CASH_PURCHASE_TOOL
canonical_currency = coc_cash.canonical_currency
format_amount = coc_cash.format_amount
parse_amount = coc_cash.parse_amount
parse_stored_amount = coc_cash.parse_stored_amount
validate_currency = coc_cash.validate_currency
validate_game_time = coc_cash.validate_game_time
validate_reason = coc_cash.validate_reason
validate_recorded_at = coc_cash.validate_recorded_at
validate_source = coc_cash.validate_source
validate_stored_currency = coc_cash.validate_stored_currency
validate_unit = coc_cash.validate_unit

FINANCE_SCHEMA_VERSION = 1
ASSETS_SCHEMA_VERSION = 1
FINANCE_RECEIPT_SCHEMA_VERSION = 1
PERIOD_MAX = 32
LIVING_STANDARD_MAX = 64
FINANCE_SEED_TOOL = "setup.chargen_run"
FINANCE_SEED_SOURCE = "chargen-credit-rating"
FINANCE_SEED_REASON = "investigator creation credit-rating conversion"
FINANCE_SEED_LOCALIZED_REASON = "建卡·信用评级换算"
FINANCE_ADJUST_SOURCE = "chargen-credit-rating-adjust"
FINANCE_ADJUST_REASON = "investigator creation credit-rating delta"
FINANCE_ADJUST_LOCALIZED_REASON = "建卡重跑·信用评级差额调整"


ASSETS_OPS = frozenset({"seed", "liquidate", "adjust"})
ASSETS_CREDIT_OPS = frozenset({"seed"})
ASSETS_DEBIT_OPS = frozenset({"liquidate"})
ASSETS_PRODUCER_TOOLS = {
    "seed": frozenset({FINANCE_SEED_TOOL}),
    "adjust": frozenset({FINANCE_SEED_TOOL}),
    "liquidate": frozenset({CASH_LIQUIDATE_TOOL}),
}
FINANCE_RECEIPT_TOOLS = frozenset({CASH_PURCHASE_TOOL, CASH_LIQUIDATE_TOOL})
FINANCE_TOP_REQUIRED = (
    "schema_version",
    "period",
    "currency",
    "living_standard",
    "spending_level",
    "assets",
    "receipts",
    "seed",
)
FINANCE_TOP_ALLOWED = frozenset(FINANCE_TOP_REQUIRED)
ASSETS_TOP_REQUIRED = ("schema_version", "balances", "ledger")
ASSETS_TOP_ALLOWED = frozenset(ASSETS_TOP_REQUIRED)
BALANCE_REQUIRED = ("amount",)
BALANCE_OPTIONAL = ("unit",)
BALANCE_ALLOWED = frozenset(BALANCE_REQUIRED + BALANCE_OPTIONAL)
ASSETS_LEDGER_REQUIRED = (
    "decision_id",
    "op",
    "amount",
    "currency",
    "source",
    "reason",
    "localized_reason",
    "balance_before",
    "balance_after",
    "tool",
    "recorded_at",
    "game_time",
)
ASSETS_LEDGER_OPTIONAL = ("unit",)
ASSETS_LEDGER_ALLOWED = frozenset(ASSETS_LEDGER_REQUIRED + ASSETS_LEDGER_OPTIONAL)
SPENDING_LEVEL_REQUIRED = ("amount", "currency")
SPENDING_LEVEL_OPTIONAL = ("unit",)
SPENDING_LEVEL_ALLOWED = frozenset(SPENDING_LEVEL_REQUIRED + SPENDING_LEVEL_OPTIONAL)
SEED_REQUIRED = ("decision_id", "source")
SEED_ALLOWED = frozenset(SEED_REQUIRED)
FINANCE_RECEIPT_INTEGRITY_KEY = "integrity_digest"
FINANCE_RECEIPT_REQUIRED = (
    "schema_version",
    "tool",
    "decision_id",
    "fingerprint",
    "request",
    "result",
    "event",
    FINANCE_RECEIPT_INTEGRITY_KEY,
)
FINANCE_RECEIPT_ALLOWED = frozenset(FINANCE_RECEIPT_REQUIRED)
PURCHASE_REQUEST_REQUIRED = (
    "investigator",
    "payment_mode",
    "amount",
    "currency",
    "source",
    "reason",
    "localized_reason",
    "item",
)
PURCHASE_REQUEST_OPTIONAL = ("unit", "price_ref", "aggregated_from")
PURCHASE_REQUEST_ALLOWED = frozenset(PURCHASE_REQUEST_REQUIRED + PURCHASE_REQUEST_OPTIONAL)
PURCHASE_ITEM_REQUIRED = ("kind", "item_id", "label")
PURCHASE_ITEM_OPTIONAL = ("weapon", "consumable", "quantity", "note")
PURCHASE_ITEM_ALLOWED = frozenset(PURCHASE_ITEM_REQUIRED + PURCHASE_ITEM_OPTIONAL)
LIQUIDATE_REQUEST_REQUIRED = (
    "investigator",
    "amount",
    "currency",
    "linked_time_decision_id",
    "source",
    "reason",
    "localized_reason",
)
LIQUIDATE_REQUEST_OPTIONAL = ("unit",)
LIQUIDATE_REQUEST_ALLOWED = frozenset(LIQUIDATE_REQUEST_REQUIRED + LIQUIDATE_REQUEST_OPTIONAL)
FINANCE_EVENT_REQUIRED = ("event_type", "investigator_id", "decision_id", "ts")
FINANCE_RESULT_COMMON_REQUIRED = ("changed", "investigator_id", "decision_id")
PURCHASE_PAYMENT_MODES = frozenset({"spending_level", "cash", "aggregate_cash"})
PURCHASE_RESULT_REQUIRED = FINANCE_RESULT_COMMON_REQUIRED + (
    "payment_mode",
    "item_id",
    "label",
    "kind",
    "amount",
    "currency",
    "charged_amount",
    "cash_balance_before",
    "cash_balance_after",
    "localized_reason",
    "game_time",
    "local_date",
    "settled",
    "settled_by",
    "aggregated_from",
)
PURCHASE_RESULT_OPTIONAL = ("unit",)
PURCHASE_RESULT_ALLOWED = frozenset(PURCHASE_RESULT_REQUIRED + PURCHASE_RESULT_OPTIONAL)
LIQUIDATE_RESULT_REQUIRED = FINANCE_RESULT_COMMON_REQUIRED + (
    "amount",
    "currency",
    "assets_balance_before",
    "assets_balance_after",
    "cash_balance_before",
    "cash_balance_after",
    "linked_time_decision_id",
    "localized_reason",
    "game_time",
)
LIQUIDATE_RESULT_OPTIONAL = ("unit",)
LIQUIDATE_RESULT_ALLOWED = frozenset(LIQUIDATE_RESULT_REQUIRED + LIQUIDATE_RESULT_OPTIONAL)


class FinanceReceiptConflict(ValueError):
    def __init__(self, decision_id: str) -> None:
        super().__init__(
            f"decision_id '{decision_id}' already exists with a different finance request"
        )
        self.decision_id = decision_id


class FinanceStateCorrupt(ValueError):
    """Finance source receipt and a derived sidecar cannot be reconciled."""


class DuplicateAssetsDecision(ValueError):
    def __init__(self, decision_id: str) -> None:
        super().__init__(
            f"decision_id '{decision_id}' already exists in the assets ledger"
        )
        self.decision_id = decision_id


class InsufficientAssets(ValueError):
    def __init__(self, balance: str, amount: str, currency: str) -> None:
        super().__init__(
            f"insufficient assets: balance {balance} {currency}, need {amount}"
        )
        self.balance = balance
        self.amount = amount
        self.currency = currency


def empty_assets() -> dict[str, Any]:
    return {
        "schema_version": ASSETS_SCHEMA_VERSION,
        "balances": {},
        "ledger": [],
    }


def empty_finance_receipts() -> dict[str, dict[str, Any]]:
    return {tool: {} for tool in sorted(FINANCE_RECEIPT_TOOLS)}


def _optional_stored_unit(value: Any) -> str | None:
    if value is None:
        return None
    return validate_unit(value)


def _canonical_balance(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("investigator assets balance is invalid")
    if set(raw) - BALANCE_ALLOWED:
        raise ValueError("investigator assets balance has unknown fields")
    missing = [key for key in BALANCE_REQUIRED if key not in raw]
    if missing:
        raise ValueError("investigator assets balance is invalid")
    amount = parse_stored_amount(raw.get("amount"))
    out: dict[str, Any] = {"amount": format(amount, "f")}
    if "unit" in raw:
        unit = _optional_stored_unit(raw.get("unit"))
        if unit is not None:
            out["unit"] = unit
    return out


def _balance_unit(balance: dict[str, Any]) -> str | None:
    return _optional_stored_unit(balance.get("unit")) if "unit" in balance else None


def validate_period(value: Any) -> str:
    if not isinstance(value, str) or not value or value != value.strip():
        raise ValueError("finance period is invalid")
    if len(value) > PERIOD_MAX:
        raise ValueError("finance period is invalid")
    return value


def validate_living_standard(value: Any) -> str:
    if not isinstance(value, str) or not value or value != value.strip():
        raise ValueError("living standard is invalid")
    if len(value) > LIVING_STANDARD_MAX:
        raise ValueError("living standard is invalid")
    return value


def validate_assets_producer_tool(op: str, tool: Any) -> str:
    if not isinstance(tool, str) or not tool or tool != tool.strip():
        raise ValueError("assets ledger tool does not match op")
    allowed = ASSETS_PRODUCER_TOOLS.get(op)
    if not allowed or tool not in allowed:
        raise ValueError("assets ledger tool does not match op")
    return tool


def _expected_assets_after(op: str, before: Decimal, delta: Decimal, after: Decimal) -> Decimal:
    if op in ASSETS_CREDIT_OPS:
        return before + delta
    if op in ASSETS_DEBIT_OPS:
        return before - delta
    if op == "adjust":
        if after == before + delta or after == before - delta:
            return after
        raise ValueError("assets ledger arithmetic is inconsistent")
    raise ValueError("investigator assets ledger is invalid")


def _validate_assets_ledger_entry(entry: Any) -> dict[str, Any]:
    if not isinstance(entry, dict):
        raise ValueError("investigator assets ledger is invalid")
    if set(entry) - ASSETS_LEDGER_ALLOWED:
        raise ValueError("investigator assets ledger has unknown fields")
    missing = [key for key in ASSETS_LEDGER_REQUIRED if key not in entry]
    if missing:
        raise ValueError("investigator assets ledger is invalid")
    if entry.get("op") not in ASSETS_OPS:
        raise ValueError("investigator assets ledger is invalid")
    for key in ASSETS_LEDGER_REQUIRED:
        if key == "game_time":
            continue
        if not isinstance(entry.get(key), str) or not entry[key]:
            raise ValueError("investigator assets ledger is invalid")
        if entry[key] != entry[key].strip():
            raise ValueError("investigator assets ledger is invalid")
    validate_assets_producer_tool(entry["op"], entry["tool"])
    currency = validate_stored_currency(entry["currency"])
    entry_unit = _optional_stored_unit(entry.get("unit")) if "unit" in entry else None
    delta = parse_stored_amount(entry["amount"])
    if delta <= 0:
        raise ValueError("ledger amount must be greater than zero")
    before = parse_stored_amount(entry["balance_before"])
    after = parse_stored_amount(entry["balance_after"])
    expected = _expected_assets_after(entry["op"], before, delta, after)
    if after != expected:
        raise ValueError("assets ledger arithmetic is inconsistent")
    if after < 0:
        raise ValueError("assets ledger balance is negative")
    validate_source(entry["source"])
    validate_reason(entry["reason"])
    validate_reason(entry["localized_reason"])
    validate_recorded_at(entry["recorded_at"])
    game_time = validate_game_time(entry["game_time"])
    out = dict(entry)
    out["currency"] = currency
    out["game_time"] = game_time
    if entry_unit is None:
        out.pop("unit", None)
    else:
        out["unit"] = entry_unit
    return out


def _assert_assets_chain(
    ledger: list[dict[str, Any]],
    *,
    balances: dict[str, dict[str, Any]],
) -> None:
    cursors: dict[str, Decimal] = {}
    units: dict[str, str | None] = {}
    seeded: set[str] = set()
    for row in ledger:
        currency = row["currency"]
        cursor = cursors.get(currency, Decimal("0.00"))
        before = parse_stored_amount(row["balance_before"])
        after = parse_stored_amount(row["balance_after"])
        delta = parse_stored_amount(row["amount"])
        if before != cursor:
            raise ValueError("assets ledger balances are not contiguous")
        expected = _expected_assets_after(row["op"], before, delta, after)
        if after != expected:
            raise ValueError("assets ledger arithmetic is inconsistent")
        if row["op"] == "seed":
            if currency in seeded or before != Decimal("0.00"):
                raise ValueError("assets seed requires a zero balance")
            seeded.add(currency)
        row_unit = _optional_stored_unit(row.get("unit")) if "unit" in row else None
        if currency in units and units[currency] != row_unit:
            raise ValueError("ledger unit does not match assets unit")
        units[currency] = row_unit
        cursors[currency] = after
    expected_codes = set(balances)
    if set(cursors) != expected_codes:
        raise ValueError("assets ledger does not match recorded balances")
    for currency, amount in cursors.items():
        recorded = parse_stored_amount(balances[currency]["amount"])
        if amount != recorded:
            raise ValueError("assets ledger does not sum to the recorded amount")
        recorded_unit = _balance_unit(balances[currency])
        if units[currency] != recorded_unit:
            raise ValueError("ledger unit does not match assets unit")


def normalize_assets(raw: Any) -> dict[str, Any]:
    if raw is None:
        return empty_assets()
    if not isinstance(raw, dict):
        raise ValueError("investigator assets state is invalid")
    if set(raw) != ASSETS_TOP_ALLOWED:
        raise ValueError("investigator assets state is invalid")
    if raw.get("schema_version") != ASSETS_SCHEMA_VERSION:
        raise ValueError("investigator assets state is not the current schema")
    balances_raw = raw.get("balances")
    ledger_raw = raw.get("ledger")
    if not isinstance(balances_raw, dict) or not isinstance(ledger_raw, list):
        raise ValueError("investigator assets state is invalid")
    balances: dict[str, dict[str, Any]] = {}
    seen_identity: dict[str, str] = {}
    for code, row in balances_raw.items():
        stored = validate_stored_currency(code)
        identity = canonical_currency(stored)
        prior = seen_identity.get(identity)
        if prior is not None:
            raise ValueError(
                f"assets balances collapse to duplicate currency {identity!r}"
            )
        seen_identity[identity] = stored
        balances[stored] = _canonical_balance(row)
    if not ledger_raw:
        if balances:
            raise ValueError("assets balances require a ledger")
        return empty_assets()
    ledger = [_validate_assets_ledger_entry(row) for row in ledger_raw]
    seen_decisions: set[str] = set()
    for row in ledger:
        decision_id = row["decision_id"]
        if decision_id in seen_decisions:
            raise ValueError("assets ledger has a duplicate decision_id")
        seen_decisions.add(decision_id)
    _assert_assets_chain(ledger, balances=balances)
    ordered = {code: balances[code] for code in sorted(balances)}
    return {
        "schema_version": ASSETS_SCHEMA_VERSION,
        "balances": ordered,
        "ledger": ledger,
    }


def _existing_currency_key(
    balances: dict[str, dict[str, Any]],
    canonical: str,
) -> str | None:
    matches = [
        code for code in balances if canonical_currency(code) == canonical
    ]
    if len(matches) > 1:
        raise ValueError(
            f"assets balances collapse to duplicate currency {canonical!r}"
        )
    if not matches:
        return None
    return matches[0]


def apply_assets(
    assets: dict[str, Any],
    *,
    op: str,
    amount: Any,
    currency: str,
    unit: str | None,
    source: str,
    reason: str,
    localized_reason: str,
    decision_id: str,
    recorded_at: str,
    game_time: dict[str, Any],
    tool: str,
    adjust_credit: bool | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if op not in ASSETS_OPS:
        raise ValueError("op must be seed, liquidate, or adjust")
    if op == "adjust" and adjust_credit is None:
        raise ValueError("assets adjust requires a credit or debit direction")
    tool = validate_assets_producer_tool(op, tool)
    delta = parse_amount(amount)
    if delta <= 0:
        raise ValueError("amount must be greater than zero")
    currency = validate_currency(currency)
    source = validate_source(source)
    reason = validate_reason(reason)
    localized_reason = validate_reason(localized_reason)
    unit = validate_unit(unit)
    recorded_at = validate_recorded_at(recorded_at)
    game_time = validate_game_time(game_time)
    state = normalize_assets(assets)
    if any(str(row.get("decision_id") or "") == str(decision_id) for row in state["ledger"]):
        raise DuplicateAssetsDecision(str(decision_id))
    write_key = _existing_currency_key(state["balances"], currency) or currency
    existing = state["balances"].get(write_key)
    if existing is not None:
        existing_unit = _balance_unit(existing)
        if unit is None:
            resolved_unit = existing_unit
        elif existing_unit != unit:
            raise ValueError(
                f"unit {unit!r} does not match recorded {existing_unit!r}"
            )
        else:
            resolved_unit = existing_unit
        before = parse_amount(existing["amount"])
    else:
        resolved_unit = unit
        before = Decimal("0.00")
    if op == "seed" and before != Decimal("0.00"):
        raise ValueError("assets seed requires a zero balance")
    credit = op in ASSETS_CREDIT_OPS or (op == "adjust" and adjust_credit is True)
    if not credit and before < delta:
        raise InsufficientAssets(
            format_amount(before),
            format_amount(delta),
            write_key,
        )
    after = before + delta if credit else before - delta
    entry: dict[str, Any] = {
        "decision_id": decision_id,
        "op": op,
        "amount": format_amount(delta),
        "currency": write_key,
        "source": source,
        "reason": reason,
        "localized_reason": localized_reason,
        "balance_before": format_amount(before),
        "balance_after": format_amount(after),
        "tool": tool,
        "recorded_at": recorded_at,
        "game_time": game_time,
    }
    if resolved_unit is not None:
        entry["unit"] = resolved_unit
    next_balances = dict(state["balances"])
    wallet: dict[str, Any] = {"amount": format_amount(after)}
    if resolved_unit is not None:
        wallet["unit"] = resolved_unit
    next_balances[write_key] = wallet
    next_state = {
        "schema_version": ASSETS_SCHEMA_VERSION,
        "balances": {code: next_balances[code] for code in sorted(next_balances)},
        "ledger": [*state["ledger"], entry],
    }
    return next_state, entry


def _validate_spending_level(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("spending level is invalid")
    if set(raw) - SPENDING_LEVEL_ALLOWED:
        raise ValueError("spending level has unknown fields")
    missing = [key for key in SPENDING_LEVEL_REQUIRED if key not in raw]
    if missing:
        raise ValueError("spending level is invalid")
    amount = parse_stored_amount(raw.get("amount"))
    currency = validate_stored_currency(raw.get("currency"))
    out: dict[str, Any] = {
        "amount": format(amount, "f"),
        "currency": currency,
    }
    if "unit" in raw:
        unit = _optional_stored_unit(raw.get("unit"))
        if unit is not None:
            out["unit"] = unit
    return out


def _validate_seed(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("finance seed provenance is invalid")
    if set(raw) != SEED_ALLOWED:
        raise ValueError("finance seed provenance is invalid")
    decision_id = raw.get("decision_id")
    source = raw.get("source")
    if not isinstance(decision_id, str) or not decision_id or decision_id != decision_id.strip():
        raise ValueError("finance seed provenance is invalid")
    source = validate_source(source)
    if source != FINANCE_SEED_SOURCE:
        raise ValueError("finance seed source is not chargen")
    return {
        "decision_id": decision_id,
        "source": source,
    }


def finance_request_fingerprint(tool: str, request: Mapping[str, Any]) -> str:
    encoded = json.dumps(
        {"tool": str(tool), "request": request},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def _canonical_digest(value: Any) -> str:
    encoded = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def finance_receipt_integrity(receipt: Mapping[str, Any]) -> str:
    body = {
        key: deepcopy(value)
        for key, value in receipt.items()
        if key != FINANCE_RECEIPT_INTEGRITY_KEY
    }
    return _canonical_digest(body)


def _nonempty_id(value: Any, *, label: str) -> str:
    if not isinstance(value, str) or not value or value != value.strip():
        raise ValueError(f"finance receipt result {label} is invalid")
    return value


def _optional_local_date(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or not value or value != value.strip():
        raise ValueError("finance receipt result local_date is invalid")
    if len(value) != 10 or value[4] != "-" or value[7] != "-":
        raise ValueError("finance receipt result local_date is invalid")
    return value


def _validate_finance_result(tool: str, decision_id: str, raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("finance receipt result is invalid")
    if tool == CASH_PURCHASE_TOOL:
        required = PURCHASE_RESULT_REQUIRED
        allowed = PURCHASE_RESULT_ALLOWED
    elif tool == CASH_LIQUIDATE_TOOL:
        required = LIQUIDATE_RESULT_REQUIRED
        allowed = LIQUIDATE_RESULT_ALLOWED
    else:
        raise ValueError("finance receipt tool is not a composite producer")
    extra = set(raw) - allowed
    if extra:
        raise ValueError("finance receipt result is invalid")
    missing = [key for key in required if key not in raw]
    if missing:
        raise ValueError("finance receipt result is invalid")
    if raw.get("changed") is not True:
        raise ValueError("finance receipt result is invalid")
    investigator_id = _nonempty_id(raw.get("investigator_id"), label="investigator_id")
    if raw.get("decision_id") != decision_id:
        raise ValueError("finance receipt result identity is mismatched")
    localized_reason = validate_reason(raw.get("localized_reason"))
    game_time = validate_game_time(raw.get("game_time"))
    amount = parse_stored_amount(raw.get("amount"))
    currency = validate_stored_currency(raw.get("currency"))
    unit = None
    if "unit" in raw:
        unit = validate_unit(raw.get("unit"))
    out: dict[str, Any] = {
        "changed": True,
        "investigator_id": investigator_id,
        "decision_id": decision_id,
        "amount": format(amount, "f"),
        "currency": currency,
        "localized_reason": localized_reason,
        "game_time": game_time,
    }
    if unit is not None:
        out["unit"] = unit
    if tool == CASH_PURCHASE_TOOL:
        payment_mode = raw.get("payment_mode")
        if payment_mode not in PURCHASE_PAYMENT_MODES:
            raise ValueError("finance receipt result is invalid")
        kind = raw.get("kind")
        if kind not in {"gear", "weapon"}:
            raise ValueError("finance receipt result is invalid")
        charged = parse_stored_amount(raw.get("charged_amount"))
        cash_before = parse_stored_amount(raw.get("cash_balance_before"))
        cash_after = parse_stored_amount(raw.get("cash_balance_after"))
        if payment_mode == "spending_level":
            if charged != Decimal("0.00") or cash_before != cash_after:
                raise ValueError("finance receipt result is invalid")
        elif cash_after != cash_before - charged:
            raise ValueError("finance receipt result is invalid")
        settled = raw.get("settled")
        if settled is not True and settled is not False:
            raise ValueError("finance receipt result is invalid")
        settled_by = raw.get("settled_by")
        if settled_by is not None:
            settled_by = _nonempty_id(settled_by, label="settled_by")
        if settled is False and settled_by is not None:
            raise ValueError("finance receipt result is invalid")
        if settled is True and payment_mode == "spending_level" and settled_by is None:
            raise ValueError("finance receipt result is invalid")
        aggregated = raw.get("aggregated_from")
        if not isinstance(aggregated, list) or any(
            not isinstance(item, str) or not item or item != item.strip()
            for item in aggregated
        ):
            raise ValueError("finance receipt result is invalid")
        if payment_mode in {"cash", "aggregate_cash"} and settled is not True:
            raise ValueError("finance receipt result is invalid")
        if payment_mode == "aggregate_cash" and not aggregated:
            raise ValueError("finance receipt result is invalid")
        if payment_mode != "aggregate_cash" and aggregated:
            raise ValueError("finance receipt result is invalid")
        out.update({
            "payment_mode": payment_mode,
            "item_id": _nonempty_id(raw.get("item_id"), label="item_id"),
            "label": _nonempty_id(raw.get("label"), label="label"),
            "kind": kind,
            "charged_amount": format(charged, "f"),
            "cash_balance_before": format(cash_before, "f"),
            "cash_balance_after": format(cash_after, "f"),
            "local_date": _optional_local_date(raw.get("local_date")),
            "settled": settled,
            "settled_by": settled_by,
            "aggregated_from": list(aggregated),
        })
        return out
    assets_before = parse_stored_amount(raw.get("assets_balance_before"))
    assets_after = parse_stored_amount(raw.get("assets_balance_after"))
    cash_before = parse_stored_amount(raw.get("cash_balance_before"))
    cash_after = parse_stored_amount(raw.get("cash_balance_after"))
    if assets_after != assets_before - amount or cash_after != cash_before + amount:
        raise ValueError("finance receipt result is invalid")
    out.update({
        "assets_balance_before": format(assets_before, "f"),
        "assets_balance_after": format(assets_after, "f"),
        "cash_balance_before": format(cash_before, "f"),
        "cash_balance_after": format(cash_after, "f"),
        "linked_time_decision_id": _nonempty_id(
            raw.get("linked_time_decision_id"), label="linked_time_decision_id"
        ),
    })
    return out


def _validate_purchase_item(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("finance receipt item payload is invalid")
    extra = set(raw) - PURCHASE_ITEM_ALLOWED
    if extra or any(key not in raw for key in PURCHASE_ITEM_REQUIRED):
        raise ValueError("finance receipt item payload is invalid")
    kind = raw.get("kind")
    if kind not in {"gear", "weapon"}:
        raise ValueError("finance receipt item payload is invalid")
    item: dict[str, Any] = {
        "kind": kind,
        "item_id": _nonempty_id(raw.get("item_id"), label="item_id"),
        "label": _nonempty_id(raw.get("label"), label="label"),
    }
    if kind == "weapon":
        weapon = raw.get("weapon")
        if not isinstance(weapon, dict) or not weapon:
            raise ValueError("finance receipt item payload is invalid")
        item["weapon"] = deepcopy(weapon)
    elif raw.get("weapon") is not None:
        raise ValueError("finance receipt item payload is invalid")
    if "consumable" in raw:
        if kind == "weapon" or not isinstance(raw.get("consumable"), bool):
            raise ValueError("finance receipt item payload is invalid")
        item["consumable"] = raw["consumable"]
    if "quantity" in raw:
        quantity = raw.get("quantity")
        if (
            kind == "weapon"
            or not isinstance(quantity, int)
            or isinstance(quantity, bool)
            or quantity < 1
        ):
            raise ValueError("finance receipt item payload is invalid")
        item["quantity"] = quantity
    if "note" in raw:
        item["note"] = _nonempty_id(raw.get("note"), label="note")
    return item


def _validate_finance_request(tool: str, decision_id: str, raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("finance receipt request is invalid")
    if tool == CASH_PURCHASE_TOOL:
        allowed = PURCHASE_REQUEST_ALLOWED
        required = PURCHASE_REQUEST_REQUIRED
    elif tool == CASH_LIQUIDATE_TOOL:
        allowed = LIQUIDATE_REQUEST_ALLOWED
        required = LIQUIDATE_REQUEST_REQUIRED
    else:
        raise ValueError("finance receipt tool is not a composite producer")
    if set(raw) - allowed or any(key not in raw for key in required):
        raise ValueError("finance receipt request is invalid")
    investigator = _nonempty_id(raw.get("investigator"), label="investigator")
    amount = format(parse_stored_amount(raw.get("amount")), "f")
    currency = validate_stored_currency(raw.get("currency"))
    source = validate_source(raw.get("source"))
    reason = validate_reason(raw.get("reason"))
    localized_reason = validate_reason(raw.get("localized_reason"))
    out: dict[str, Any] = {
        "investigator": investigator,
        "amount": amount,
        "currency": currency,
        "source": source,
        "reason": reason,
        "localized_reason": localized_reason,
    }
    if "unit" in raw:
        unit = validate_unit(raw.get("unit"))
        if unit is not None:
            out["unit"] = unit
    if tool == CASH_PURCHASE_TOOL:
        payment_mode = raw.get("payment_mode")
        if payment_mode not in PURCHASE_PAYMENT_MODES:
            raise ValueError("finance receipt request is invalid")
        item = _validate_purchase_item(raw.get("item"))
        aggregated = raw.get("aggregated_from") if "aggregated_from" in raw else []
        if payment_mode == "aggregate_cash":
            if not isinstance(aggregated, list) or not aggregated:
                raise ValueError("finance receipt request is invalid")
        elif aggregated not in (None, []):
            raise ValueError("finance receipt request is invalid")
        if aggregated is None:
            aggregated = []
        if not isinstance(aggregated, list) or any(
            not isinstance(item_id, str) or not item_id.strip() for item_id in aggregated
        ):
            raise ValueError("finance receipt request is invalid")
        out["payment_mode"] = payment_mode
        out["item"] = item
        if aggregated:
            out["aggregated_from"] = [str(item_id).strip() for item_id in aggregated]
        price_ref = raw.get("price_ref") if "price_ref" in raw else None
        if price_ref:
            out["price_ref"] = _nonempty_id(price_ref, label="price_ref")
        return out
    out["linked_time_decision_id"] = _nonempty_id(
        raw.get("linked_time_decision_id"), label="linked_time_decision_id"
    )
    return out


def _validate_finance_event(tool: str, decision_id: str, investigator_id: str, raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("finance receipt event is invalid")
    missing = [key for key in FINANCE_EVENT_REQUIRED if key not in raw]
    if missing:
        raise ValueError("finance receipt event is invalid")
    expected_type = "purchase" if tool == CASH_PURCHASE_TOOL else "assets_liquidate"
    if raw.get("event_type") != expected_type:
        raise ValueError("finance receipt event is invalid")
    if raw.get("decision_id") != decision_id:
        raise ValueError("finance receipt event identity is mismatched")
    if raw.get("investigator_id") != investigator_id:
        raise ValueError("finance receipt event identity is mismatched")
    ts = raw.get("ts")
    if not isinstance(ts, str) or not ts or ts != ts.strip():
        raise ValueError("finance receipt event is invalid")
    return deepcopy(raw)


def make_finance_operation_receipt(
    *,
    tool: str,
    decision_id: str,
    request: Mapping[str, Any],
    result: Mapping[str, Any],
    event: Mapping[str, Any],
) -> dict[str, Any]:
    if tool not in FINANCE_RECEIPT_TOOLS:
        raise ValueError("finance receipt tool is not a composite producer")
    if not isinstance(decision_id, str) or not decision_id or decision_id != decision_id.strip():
        raise ValueError("finance receipt decision_id is invalid")
    closed_request = _validate_finance_request(tool, decision_id, request)
    closed_result = _validate_finance_result(tool, decision_id, result)
    if closed_request["investigator"] != closed_result["investigator_id"]:
        raise ValueError("finance receipt request does not match result")
    if format(parse_stored_amount(closed_request["amount"]), "f") != closed_result["amount"]:
        raise ValueError("finance receipt request does not match result")
    if canonical_currency(closed_request["currency"]) != canonical_currency(
        closed_result["currency"]
    ):
        raise ValueError("finance receipt request does not match result")
    if tool == CASH_PURCHASE_TOOL:
        item = closed_request["item"]
        if (
            item["item_id"] != closed_result["item_id"]
            or item["kind"] != closed_result["kind"]
            or item["label"] != closed_result["label"]
            or closed_request["payment_mode"] != closed_result["payment_mode"]
        ):
            raise ValueError("finance receipt request does not match result")
        req_agg = list(closed_request.get("aggregated_from") or [])
        if req_agg != list(closed_result.get("aggregated_from") or []):
            raise ValueError("finance receipt request does not match result")
    elif closed_request["linked_time_decision_id"] != closed_result["linked_time_decision_id"]:
        raise ValueError("finance receipt request does not match result")
    closed_event = _validate_finance_event(
        tool, decision_id, closed_result["investigator_id"], event
    )
    receipt = {
        "schema_version": FINANCE_RECEIPT_SCHEMA_VERSION,
        "tool": tool,
        "decision_id": decision_id,
        "fingerprint": finance_request_fingerprint(tool, closed_request),
        "request": closed_request,
        "result": closed_result,
        "event": closed_event,
    }
    receipt[FINANCE_RECEIPT_INTEGRITY_KEY] = finance_receipt_integrity(receipt)
    return receipt


def settle_purchase_receipt(receipt: Mapping[str, Any], *, settled_by: str) -> dict[str, Any]:
    """Mark one spending_level receipt settled by an aggregate_cash decision."""
    tool = str(receipt.get("tool") or "")
    decision_id = str(receipt.get("decision_id") or "")
    validated = _validate_finance_receipt(tool, decision_id, receipt)
    result = dict(validated["result"])
    if result.get("payment_mode") != "spending_level":
        raise ValueError("only spending_level purchases can be aggregated")
    if result.get("settled") is True:
        raise ValueError("purchase receipt is already settled")
    result["settled"] = True
    result["settled_by"] = _nonempty_id(settled_by, label="settled_by")
    return make_finance_operation_receipt(
        tool=tool,
        decision_id=decision_id,
        request=validated["request"],
        result=result,
        event=validated["event"],
    )


def spending_level_covers(
    finance: Mapping[str, Any],
    *,
    amount: Any,
    currency: str,
) -> None:
    spending = finance.get("spending_level") if isinstance(finance, dict) else None
    if not isinstance(spending, dict):
        raise ValueError("spending level is invalid")
    price = parse_amount(amount)
    held = parse_stored_amount(spending.get("amount"))
    price_ccy = canonical_currency(validate_currency(currency))
    held_ccy = canonical_currency(validate_stored_currency(spending.get("currency")))
    if price_ccy != held_ccy:
        raise ValueError("purchase currency does not match spending level")
    if price > held:
        raise ValueError("price exceeds inclusive spending level")


def _validate_finance_receipt(tool: str, decision_id: str, raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("finance operation receipt is invalid")
    if set(raw) != FINANCE_RECEIPT_ALLOWED:
        raise ValueError("finance operation receipt is invalid")
    if raw.get("schema_version") != FINANCE_RECEIPT_SCHEMA_VERSION:
        raise ValueError("finance operation receipt is not the current schema")
    if raw.get("tool") != tool or raw.get("decision_id") != decision_id:
        raise ValueError("finance operation receipt identity is mismatched")
    request = _validate_finance_request(tool, decision_id, raw.get("request"))
    expected_fp = finance_request_fingerprint(tool, request)
    if raw.get("fingerprint") != expected_fp:
        raise ValueError("finance operation receipt fingerprint is mismatched")
    stored_result = raw.get("result")
    if not isinstance(stored_result, dict):
        raise ValueError("finance operation receipt is invalid")
    digest = raw.get(FINANCE_RECEIPT_INTEGRITY_KEY)
    if not isinstance(digest, str) or not digest:
        raise ValueError("finance operation receipt integrity is mismatched")
    expected_digest = finance_receipt_integrity(
        {
            "schema_version": FINANCE_RECEIPT_SCHEMA_VERSION,
            "tool": tool,
            "decision_id": decision_id,
            "fingerprint": expected_fp,
            "request": raw.get("request"),
            "result": stored_result,
            "event": raw.get("event"),
            FINANCE_RECEIPT_INTEGRITY_KEY: digest,
        }
    )
    if digest != expected_digest:
        raise ValueError("finance operation receipt integrity is mismatched")
    result = _validate_finance_result(tool, decision_id, stored_result)
    event = _validate_finance_event(tool, decision_id, result["investigator_id"], raw.get("event"))
    return {
        "schema_version": FINANCE_RECEIPT_SCHEMA_VERSION,
        "tool": tool,
        "decision_id": decision_id,
        "fingerprint": expected_fp,
        "request": request,
        "result": result,
        "event": event,
        FINANCE_RECEIPT_INTEGRITY_KEY: digest,
    }


def _validate_receipts(raw: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(raw, dict):
        raise ValueError("finance receipts are invalid")
    if set(raw) != FINANCE_RECEIPT_TOOLS:
        raise ValueError("finance receipts are invalid")
    out: dict[str, dict[str, Any]] = {}
    seen_decisions: set[str] = set()
    for tool in sorted(FINANCE_RECEIPT_TOOLS):
        bucket = raw.get(tool)
        if not isinstance(bucket, dict):
            raise ValueError("finance receipts are invalid")
        validated: dict[str, Any] = {}
        for decision_id, receipt in bucket.items():
            if not isinstance(decision_id, str) or not decision_id:
                raise ValueError("finance receipts are invalid")
            if decision_id in seen_decisions:
                raise ValueError("finance receipts have a duplicate decision_id")
            seen_decisions.add(decision_id)
            validated[decision_id] = _validate_finance_receipt(
                tool, decision_id, receipt
            )
        out[tool] = validated
    return out


def normalize_finance(raw: Any) -> dict[str, Any]:
    if raw is None:
        raise ValueError("runtime finance state is missing")
    if not isinstance(raw, dict):
        raise ValueError("runtime finance state is invalid")
    if set(raw) != FINANCE_TOP_ALLOWED:
        raise ValueError("runtime finance state is invalid")
    if raw.get("schema_version") != FINANCE_SCHEMA_VERSION:
        raise ValueError("runtime finance state is not the current schema")
    period = validate_period(raw.get("period"))
    currency = validate_stored_currency(raw.get("currency"))
    living_standard = validate_living_standard(raw.get("living_standard"))
    spending_level = _validate_spending_level(raw.get("spending_level"))
    if canonical_currency(spending_level["currency"]) != canonical_currency(currency):
        raise ValueError("spending level currency does not match finance currency")
    assets = normalize_assets(raw.get("assets"))
    for code in assets["balances"]:
        if canonical_currency(code) != canonical_currency(currency):
            raise ValueError("assets currency does not match finance currency")
    receipts = _validate_receipts(raw.get("receipts"))
    seed = _validate_seed(raw.get("seed"))
    _assert_assets_bound_to_seed(seed, assets)
    return {
        "schema_version": FINANCE_SCHEMA_VERSION,
        "period": period,
        "currency": currency,
        "living_standard": living_standard,
        "spending_level": spending_level,
        "assets": assets,
        "receipts": receipts,
        "seed": seed,
    }


def _assert_assets_bound_to_seed(
    seed: Mapping[str, Any],
    assets: Mapping[str, Any],
) -> None:
    ledger = assets.get("ledger") if isinstance(assets.get("ledger"), list) else []
    seed_rows = [row for row in ledger if isinstance(row, dict) and row.get("op") == "seed"]
    balances = assets.get("balances") if isinstance(assets.get("balances"), dict) else {}
    if balances and not seed_rows:
        raise ValueError("assets balances require a chargen seed row")
    for row in seed_rows:
        if row.get("decision_id") != seed.get("decision_id"):
            raise ValueError("assets seed decision_id does not match finance seed")
        if row.get("source") != FINANCE_SEED_SOURCE:
            raise ValueError("assets seed source is not chargen")
        if row.get("tool") != FINANCE_SEED_TOOL:
            raise ValueError("assets seed tool does not match chargen")


def assert_chargen_finance_provenance(
    finance: Mapping[str, Any],
    decision_id: str,
) -> None:
    seed = finance.get("seed") if isinstance(finance, dict) else None
    if not isinstance(seed, dict):
        raise ValueError("finance seed provenance is invalid")
    if seed.get("source") != FINANCE_SEED_SOURCE:
        raise ValueError("finance seed source is not chargen")
    if seed.get("decision_id") != decision_id:
        raise ValueError("finance seed decision_id does not match chargen")


def lookup_finance_operation_receipt(
    state: Mapping[str, Any],
    tool: str,
    decision_id: str,
) -> dict[str, Any] | None:
    finance_raw = state.get("finance")
    if finance_raw is None:
        return None
    try:
        finance = normalize_finance(finance_raw)
    except ValueError as exc:
        raise FinanceStateCorrupt(str(exc)) from exc
    bucket = finance["receipts"].get(tool)
    if not isinstance(bucket, dict):
        raise FinanceStateCorrupt("finance receipts are invalid")
    receipt = bucket.get(decision_id)
    if receipt is None:
        return None
    return deepcopy(receipt)


def attach_finance_operation_receipt(state: dict[str, Any], receipt: dict[str, Any]) -> None:
    finance_raw = state.get("finance")
    if finance_raw is None:
        raise FinanceStateCorrupt("runtime finance state is missing")
    try:
        finance = normalize_finance(finance_raw)
    except ValueError as exc:
        raise FinanceStateCorrupt(str(exc)) from exc
    tool = str(receipt.get("tool") or "")
    decision_id = str(receipt.get("decision_id") or "")
    if tool not in FINANCE_RECEIPT_TOOLS:
        raise ValueError("finance receipt tool is not a composite producer")
    validated = _validate_finance_receipt(tool, decision_id, receipt)
    for other_tool, bucket in finance["receipts"].items():
        if decision_id in bucket and other_tool != tool:
            raise ValueError("finance receipts have a duplicate decision_id")
    bucket = finance["receipts"].setdefault(tool, {})
    existing = bucket.get(decision_id)
    if existing is not None:
        if existing != validated:
            raise FinanceReceiptConflict(decision_id)
        return
    bucket[decision_id] = validated
    state["finance"] = finance


def _requests_equal(left: Any, right: Any) -> bool:
    if not isinstance(left, dict) or not isinstance(right, dict):
        return False
    try:
        return json.dumps(
            left, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str
        ) == json.dumps(
            right, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str
        )
    except (TypeError, ValueError):
        return False


def finance_receipt_matches_request(
    receipt: Mapping[str, Any],
    tool: str,
    request: Mapping[str, Any],
) -> bool:
    if str(receipt.get("tool") or "") != tool:
        return False
    if not _requests_equal(receipt.get("request"), request):
        return False
    try:
        stored_fp = finance_request_fingerprint(tool, receipt["request"])
        caller_fp = finance_request_fingerprint(tool, request)
    except (TypeError, ValueError, KeyError):
        return False
    return receipt.get("fingerprint") == stored_fp == caller_fp


def replay_finance_source_receipt(
    *,
    state: Mapping[str, Any],
    tool: str,
    decision_id: str,
    request: Mapping[str, Any],
) -> dict[str, Any] | None:
    """Return the stored investigator-state result when this request already settled.

    The investigator-state finance receipt is the only recovery surface in this
    foundation. Missing receipt means the decision has not settled. Corrupt or
    mismatched receipts fail closed.
    """
    if tool not in FINANCE_RECEIPT_TOOLS:
        raise ValueError("finance receipt tool is not a composite producer")
    if not isinstance(decision_id, str) or not decision_id or decision_id != decision_id.strip():
        raise ValueError("finance receipt decision_id is invalid")
    if not isinstance(request, dict):
        raise ValueError("finance receipt request and result must be objects")
    try:
        closed_request = _validate_finance_request(tool, decision_id, request)
    except ValueError as exc:
        raise FinanceReceiptConflict(decision_id) from exc
    try:
        finance = normalize_finance(state.get("finance"))
    except ValueError as exc:
        raise FinanceStateCorrupt(str(exc)) from exc
    bucket = finance["receipts"].get(tool)
    if not isinstance(bucket, dict):
        raise FinanceStateCorrupt("finance receipts are invalid")
    raw = bucket.get(decision_id)
    if raw is None:
        return None
    try:
        receipt = _validate_finance_receipt(tool, decision_id, raw)
    except ValueError as exc:
        raise FinanceStateCorrupt(str(exc)) from exc
    stored_fp = finance_request_fingerprint(tool, receipt["request"])
    caller_fp = finance_request_fingerprint(tool, closed_request)
    if receipt["fingerprint"] != stored_fp:
        raise FinanceStateCorrupt("finance operation receipt fingerprint is mismatched")
    if caller_fp != stored_fp or not _requests_equal(receipt["request"], closed_request):
        raise FinanceReceiptConflict(decision_id)
    result = receipt.get("result")
    if not isinstance(result, dict):
        raise FinanceStateCorrupt("finance operation receipt is invalid")
    return deepcopy(result)


def assets_wallet_amount(assets: Mapping[str, Any], currency: str) -> Decimal:
    try:
        identity = validate_currency(currency)
    except ValueError:
        identity = str(currency)
    for code, wallet in (assets.get("balances") or {}).items():
        if not isinstance(wallet, dict):
            continue
        try:
            if canonical_currency(str(code)) != identity:
                continue
            return parse_amount(wallet.get("amount"))
        except ValueError:
            continue
    return parse_amount(0)


def spending_level_from_sheet(raw: Any, *, currency: str) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("spending level is invalid")
    amount = format_amount(raw.get("amount"))
    stored_currency = validate_currency(raw.get("currency") or currency)
    out: dict[str, Any] = {"amount": amount, "currency": stored_currency}
    if raw.get("unit") is not None:
        unit = validate_unit(raw.get("unit"))
        if unit is not None:
            out["unit"] = unit
    return out


def seed_finance_from_chargen(
    *,
    sheet: Mapping[str, Any],
    decision_id: str,
    recorded_at: str,
    game_time: dict[str, Any],
    period: str | None = None,
) -> dict[str, Any]:
    """Build current-schema runtime finance from a chargen table result."""
    period = validate_period(period if period is not None else sheet.get("era"))
    living_standard = validate_living_standard(sheet.get("living_standard"))
    spend_raw = sheet.get("spending_level")
    if not isinstance(spend_raw, dict):
        raise ValueError("chargen spending level is missing")
    currency = validate_currency(
        spend_raw.get("currency")
        or (sheet.get("cash") or {}).get("currency")
        or "USD"
    )
    spending_level = spending_level_from_sheet(spend_raw, currency=currency)
    if canonical_currency(spending_level["currency"]) != canonical_currency(currency):
        raise ValueError("spending level currency does not match finance currency")
    assets = empty_assets()
    assets_raw = sheet.get("assets")
    if isinstance(assets_raw, dict) and assets_raw.get("amount") is not None:
        assets_amount = parse_amount(assets_raw.get("amount"))
        if assets_amount > 0:
            assets_currency = validate_currency(assets_raw.get("currency") or currency)
            if canonical_currency(assets_currency) != canonical_currency(currency):
                raise ValueError("assets currency does not match finance currency")
            assets, _entry = apply_assets(
                assets,
                op="seed",
                amount=assets_amount,
                currency=assets_currency,
                unit=assets_raw.get("unit") if "unit" in assets_raw else None,
                source=FINANCE_SEED_SOURCE,
                reason=FINANCE_SEED_REASON,
                localized_reason=FINANCE_SEED_LOCALIZED_REASON,
                decision_id=decision_id,
                recorded_at=recorded_at,
                game_time=game_time,
                tool=FINANCE_SEED_TOOL,
            )
    return normalize_finance(
        {
            "schema_version": FINANCE_SCHEMA_VERSION,
            "period": period,
            "currency": currency,
            "living_standard": living_standard,
            "spending_level": spending_level,
            "assets": assets,
            "receipts": empty_finance_receipts(),
            "seed": {
                "decision_id": decision_id,
                "source": FINANCE_SEED_SOURCE,
            },
        }
    )


def display_money(amount: Any, currency: str) -> str:
    text = format_amount(amount)
    if "." in text:
        whole, frac = text.split(".", 1)
        if set(frac) <= {"0"}:
            text = whole
    identity = canonical_currency(currency)
    if identity == "USD":
        return f"${text}"
    if identity == "GBP":
        return f"£{text}"
    return f"{text} {identity}"


def keeper_runtime_finance_brief(
    *,
    cash: Mapping[str, Any] | None,
    finance: Mapping[str, Any],
    play_language: str = "zh-Hans",
) -> dict[str, Any]:
    """Compact Keeper-facing live finance. Never receipts or sheet snapshots."""
    cash_balances: dict[str, Any] = {}
    if isinstance(cash, Mapping):
        raw_balances = cash.get("balances")
        if isinstance(raw_balances, Mapping):
            cash_balances = {
                str(code): dict(wallet)
                for code, wallet in raw_balances.items()
                if isinstance(wallet, Mapping)
            }
    assets = finance.get("assets") if isinstance(finance.get("assets"), Mapping) else {}
    assets_balances: dict[str, Any] = {}
    raw_assets = assets.get("balances") if isinstance(assets, Mapping) else None
    if isinstance(raw_assets, Mapping):
        assets_balances = {
            str(code): dict(wallet)
            for code, wallet in raw_assets.items()
            if isinstance(wallet, Mapping)
        }
    spending = dict(finance["spending_level"])
    currency = str(finance["currency"])
    spend_currency = str(spending.get("currency") or currency)
    spend_display = display_money(spending.get("amount"), spend_currency)
    zh = play_language in {"zh-Hans", "zh"}
    if zh:
        advisory = (
            f"{spend_display}/日是包容的每日免记账额度，不是必须花完的预算表。"
            "生活水平内的食宿与零星交通通常只叙事、不记账。"
            "额度内耐久购置用 state.purchase(payment_mode=spending_level)；"
            "普通现金购买用 payment_mode=cash；"
            "若选择同日合并则 payment_mode=aggregate_cash 并记合并全额。"
            "现金不足时可先 state.advance_time 再 state.assets_liquidate。"
            "借贷、雇佣、证件、通行与排场可能走信用评级判定，而不是库存采购。"
        )
    else:
        advisory = (
            f"{spend_display}/day is the inclusive Spending Level, not a remaining-budget meter. "
            "Routine living-standard lodging, food, and incidental travel are usually narrated with no bookkeeping. "
            "Durable acquisitions within that envelope use state.purchase(payment_mode=spending_level); "
            "ordinary cash purchases use payment_mode=cash; "
            "optional same-day aggregation uses payment_mode=aggregate_cash and charges the full combined amount. "
            "A cash shortfall may lead to state.advance_time then state.assets_liquidate. "
            "Loans, hiring, credentials, access, and conspicuous status may call for a Credit Rating check rather than an inventory purchase."
        )
    return {
        "cash_balances": cash_balances,
        "assets_balances": assets_balances,
        "living_standard": str(finance["living_standard"]),
        "spending_level": spending,
        "currency": currency,
        "period": str(finance["period"]),
        "spending_period": "day",
        "advisory": advisory,
    }
