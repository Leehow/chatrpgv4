"""Campaign-local runtime cash ledger for investigator play.

Starting sheet ``cash`` / ``assets`` / ``spending_level`` remain the chargen
snapshot. ``setup.chargen_run`` may seed this ledger once from the same
1920s/modern table result. Live grants and spends then write only this
structure on ``save/investigator-state/<id>.json["cash"]``. Callers pass structured amount,
currency, source id, reason, and player-safe localized_reason; this module
never parses free prose. Schema v2 is multi-currency with no FX.

Caller currency codes are identity-canonicalized (ASCII case-fold, plus a
bounded alias table such as 美元→USD). That is the same wallet, not FX.
Omitting ``unit`` reuses the recorded unit for that wallet.
"""
from __future__ import annotations

import json
from decimal import Decimal, InvalidOperation, ROUND_HALF_EVEN
from typing import Any

CASH_SCHEMA_VERSION = 2
CASH_QUANTUM = Decimal("0.01")
# Inclusive cents cap: enough for any CoC purse, inside Decimal precision.
AMOUNT_MAX = Decimal("999999999999.99")
OPS = frozenset({"grant", "spend"})
CURRENCY_MAX = 16
# Identity aliases only. Never convert amounts or invent an exchange rate.
CURRENCY_ALIASES = {
    "$": "USD",
    "us$": "USD",
    "dollar": "USD",
    "dollars": "USD",
    "美元": "USD",
    "美金": "USD",
    "£": "GBP",
    "pound": "GBP",
    "pounds": "GBP",
    "sterling": "GBP",
    "英镑": "GBP",
    "英鎊": "GBP",
}
SOURCE_MAX = 128
REASON_MAX = 500
UNIT_MAX = 32
CASH_TOP_REQUIRED = ("schema_version", "balances", "ledger")
CASH_TOP_ALLOWED = frozenset(CASH_TOP_REQUIRED)
BALANCE_REQUIRED = ("amount",)
BALANCE_OPTIONAL = ("unit",)
BALANCE_ALLOWED = frozenset(BALANCE_REQUIRED + BALANCE_OPTIONAL)
LEDGER_ENTRY_REQUIRED = (
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
LEDGER_ENTRY_OPTIONAL = ("unit",)
LEDGER_ENTRY_ALLOWED = frozenset(LEDGER_ENTRY_REQUIRED + LEDGER_ENTRY_OPTIONAL)


def parse_amount(value: Any) -> Decimal:
    """Parse a cash amount and reject over-precision or unrepresentable values."""
    if isinstance(value, bool) or value is None:
        raise ValueError("amount must be a finite number")
    if isinstance(value, int):
        quant = Decimal(value)
    elif isinstance(value, Decimal):
        quant = value
    elif isinstance(value, float):
        if value != value or value in {float("inf"), float("-inf")}:
            raise ValueError("amount must be a finite number")
        try:
            quant = Decimal(str(value))
        except InvalidOperation as exc:
            raise ValueError("amount must be a finite number") from exc
    elif isinstance(value, str):
        text = value.strip()
        if not text:
            raise ValueError("amount must be a finite number")
        try:
            quant = Decimal(text)
        except InvalidOperation as exc:
            raise ValueError("amount must be a finite number") from exc
    else:
        raise ValueError("amount must be a finite number")
    if not quant.is_finite():
        raise ValueError("amount must be a finite number")
    if quant < 0:
        raise ValueError("amount must be non-negative")
    exponent = quant.as_tuple().exponent
    if isinstance(exponent, int) and exponent < -2:
        raise ValueError("amount must have at most 2 decimal places")
    if quant > AMOUNT_MAX:
        raise ValueError(f"amount must be at most {format(AMOUNT_MAX, 'f')}")
    try:
        quantized = quant.quantize(CASH_QUANTUM, rounding=ROUND_HALF_EVEN)
    except InvalidOperation as exc:
        raise ValueError("amount is not representable at 2 decimal places") from exc
    if quantized > AMOUNT_MAX:
        raise ValueError(f"amount must be at most {format(AMOUNT_MAX, 'f')}")
    return quantized


def format_amount(value: Any) -> str:
    return format(parse_amount(value), "f")


def parse_stored_amount(value: Any) -> Decimal:
    if not isinstance(value, str):
        raise ValueError("amount must be a canonical two-decimal string")
    parsed = parse_amount(value)
    if value != format(parsed, "f"):
        raise ValueError("amount must be a canonical two-decimal string")
    return parsed


def empty_cash() -> dict[str, Any]:
    return {
        "schema_version": CASH_SCHEMA_VERSION,
        "balances": {},
        "ledger": [],
    }


def _optional_stored_unit(value: Any) -> str | None:
    if value is None:
        return None
    return validate_unit(value)


def _canonical_balance(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("investigator cash balance is invalid")
    if set(raw) - BALANCE_ALLOWED:
        raise ValueError("investigator cash balance has unknown fields")
    missing = [key for key in BALANCE_REQUIRED if key not in raw]
    if missing:
        raise ValueError("investigator cash balance is invalid")
    amount = parse_stored_amount(raw.get("amount"))
    out: dict[str, Any] = {"amount": format(amount, "f")}
    if "unit" in raw:
        unit = _optional_stored_unit(raw.get("unit"))
        if unit is not None:
            out["unit"] = unit
    return out


def _balance_unit(balance: dict[str, Any]) -> str | None:
    return _optional_stored_unit(balance.get("unit")) if "unit" in balance else None


def validate_game_time(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or not value:
        raise ValueError("game_time must be a canonical campaign stamp")
    elapsed = value.get("elapsed_minutes")
    if not isinstance(elapsed, int) or isinstance(elapsed, bool) or elapsed < 0:
        raise ValueError("game_time is invalid")
    display = value.get("display")
    if not isinstance(display, str):
        raise ValueError("game_time is invalid")
    try:
        dumped = json.dumps(value, ensure_ascii=False, sort_keys=True)
        parsed = json.loads(dumped)
    except (TypeError, ValueError) as exc:
        raise ValueError("game_time is invalid") from exc
    if not isinstance(parsed, dict):
        raise ValueError("game_time is invalid")
    return parsed


def validate_recorded_at(value: Any) -> str:
    if not isinstance(value, str) or not value or value != value.strip():
        raise ValueError("recorded_at must be a non-empty audit timestamp")
    return value


def _validate_ledger_entry(entry: Any) -> dict[str, Any]:
    if not isinstance(entry, dict):
        raise ValueError("investigator cash ledger is invalid")
    if set(entry) - LEDGER_ENTRY_ALLOWED:
        raise ValueError("investigator cash ledger has unknown fields")
    if "ts" in entry:
        raise ValueError("investigator cash ledger must not use player-facing ts")
    missing = [key for key in LEDGER_ENTRY_REQUIRED if key not in entry]
    if missing:
        raise ValueError("investigator cash ledger is invalid")
    if entry.get("op") not in OPS:
        raise ValueError("investigator cash ledger is invalid")
    for key in LEDGER_ENTRY_REQUIRED:
        if key == "game_time":
            continue
        if not isinstance(entry.get(key), str) or not entry[key]:
            raise ValueError("investigator cash ledger is invalid")
        if entry[key] != entry[key].strip():
            raise ValueError("investigator cash ledger is invalid")
    currency = validate_stored_currency(entry["currency"])
    entry_unit = _optional_stored_unit(entry.get("unit")) if "unit" in entry else None
    delta = parse_stored_amount(entry["amount"])
    if delta <= 0:
        raise ValueError("ledger amount must be greater than zero")
    parse_stored_amount(entry["balance_before"])
    parse_stored_amount(entry["balance_after"])
    expected_tool = f"state.cash_{entry['op']}"
    if entry["tool"] != expected_tool:
        raise ValueError("ledger tool does not match op")
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


def _assert_ledger_chain(
    ledger: list[dict[str, Any]],
    *,
    balances: dict[str, dict[str, Any]],
) -> None:
    cursors: dict[str, Decimal] = {}
    units: dict[str, str | None] = {}
    for row in ledger:
        currency = row["currency"]
        cursor = cursors.get(currency, Decimal("0.00"))
        before = parse_stored_amount(row["balance_before"])
        after = parse_stored_amount(row["balance_after"])
        delta = parse_stored_amount(row["amount"])
        if before != cursor:
            raise ValueError("cash ledger balances are not contiguous")
        expected = before + delta if row["op"] == "grant" else before - delta
        if after != expected:
            raise ValueError("cash ledger arithmetic is inconsistent")
        if after < 0:
            raise ValueError("cash ledger balance is negative")
        row_unit = _optional_stored_unit(row.get("unit")) if "unit" in row else None
        if currency in units and units[currency] != row_unit:
            raise ValueError("ledger unit does not match cash unit")
        units[currency] = row_unit
        cursors[currency] = after
    expected_codes = set(balances)
    if set(cursors) != expected_codes:
        raise ValueError("cash ledger does not match recorded balances")
    for currency, amount in cursors.items():
        recorded = parse_stored_amount(balances[currency]["amount"])
        if amount != recorded:
            raise ValueError("cash ledger does not sum to the recorded amount")
        recorded_unit = _balance_unit(balances[currency])
        if units[currency] != recorded_unit:
            raise ValueError("ledger unit does not match cash unit")


def normalize_cash(raw: Any) -> dict[str, Any]:
    if raw is None:
        return empty_cash()
    if not isinstance(raw, dict):
        raise ValueError("investigator cash state is invalid")
    if "amount" in raw or "currency" in raw or "seeded" in raw or "ts" in raw:
        raise ValueError("investigator cash state is not schema version 2")
    if set(raw) != CASH_TOP_ALLOWED:
        raise ValueError("investigator cash state is invalid")
    if raw.get("schema_version") != CASH_SCHEMA_VERSION:
        raise ValueError("investigator cash state is not schema version 2")
    balances_raw = raw.get("balances")
    ledger_raw = raw.get("ledger")
    if not isinstance(balances_raw, dict) or not isinstance(ledger_raw, list):
        raise ValueError("investigator cash state is invalid")
    balances: dict[str, dict[str, Any]] = {}
    seen_identity: dict[str, str] = {}
    for code, row in balances_raw.items():
        stored = validate_stored_currency(code)
        identity = canonical_currency(stored)
        prior = seen_identity.get(identity)
        if prior is not None:
            raise ValueError(
                f"cash balances collapse to duplicate currency {identity!r}"
            )
        seen_identity[identity] = stored
        balances[stored] = _canonical_balance(row)
    if not ledger_raw:
        if balances:
            raise ValueError("cash balances require a ledger")
        return empty_cash()
    ledger = [_validate_ledger_entry(row) for row in ledger_raw]
    seen_decisions: set[str] = set()
    for row in ledger:
        decision_id = row["decision_id"]
        if decision_id in seen_decisions:
            raise ValueError("cash ledger has a duplicate decision_id")
        seen_decisions.add(decision_id)
    _assert_ledger_chain(ledger, balances=balances)
    ordered = {code: balances[code] for code in sorted(balances)}
    return {
        "schema_version": CASH_SCHEMA_VERSION,
        "balances": ordered,
        "ledger": ledger,
    }


def canonical_currency(code: str) -> str:
    """Map a structurally valid code onto its wallet identity. Never FX."""
    aliased = CURRENCY_ALIASES.get(code.casefold())
    if aliased is not None:
        return aliased
    if code.isascii() and code.isalpha():
        return code.upper()
    return code


def validate_stored_currency(value: Any) -> str:
    """Identity-preserving check for persisted balance keys and ledger rows."""
    if not isinstance(value, str):
        raise ValueError("currency must be a non-empty code")
    if not value or value != value.strip() or len(value) > CURRENCY_MAX:
        raise ValueError("currency must be a non-empty code")
    if not value[0].isalpha() or any(ch.isspace() for ch in value):
        raise ValueError("currency must be a non-empty code")
    return value


def validate_currency(value: Any) -> str:
    """Caller-facing currency: strip, then identity-canonicalize. Never FX."""
    if not isinstance(value, str):
        raise ValueError("currency must be a non-empty code")
    text = value.strip()
    if not text or len(text) > CURRENCY_MAX or any(ch.isspace() for ch in text):
        raise ValueError("currency must be a non-empty code")
    aliased = CURRENCY_ALIASES.get(text.casefold())
    if aliased is not None:
        return aliased
    if not text[0].isalpha():
        raise ValueError("currency must be a non-empty code")
    return canonical_currency(text)


def _existing_currency_key(
    balances: dict[str, dict[str, Any]],
    canonical: str,
) -> str | None:
    matches = [
        code for code in balances if canonical_currency(code) == canonical
    ]
    if len(matches) > 1:
        raise ValueError(
            f"cash balances collapse to duplicate currency {canonical!r}"
        )
    if not matches:
        return None
    return matches[0]


def validate_source(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("source must be a non-empty structured id")
    text = value.strip()
    if not text or len(text) > SOURCE_MAX:
        raise ValueError("source must be a non-empty structured id")
    return text


def validate_reason(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("reason must be a non-empty string")
    text = value.strip()
    if not text or len(text) > REASON_MAX:
        raise ValueError("reason must be a non-empty string")
    return text


def validate_unit(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("unit must be a string when supplied")
    if not value or value != value.strip():
        raise ValueError("unit must be a non-empty string when supplied")
    if len(value) > UNIT_MAX:
        raise ValueError("unit is too long")
    return value


def apply_cash(
    cash: dict[str, Any],
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
) -> tuple[dict[str, Any], dict[str, Any]]:
    if op not in OPS:
        raise ValueError("op must be grant or spend")
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
    state = normalize_cash(cash)
    if any(str(row.get("decision_id") or "") == str(decision_id) for row in state["ledger"]):
        raise DuplicateCashDecision(str(decision_id))
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
    if op == "spend" and before < delta:
        held = {
            code: str(wallet.get("amount"))
            for code, wallet in state["balances"].items()
            if isinstance(wallet, dict) and wallet.get("amount") is not None
        }
        raise InsufficientFunds(
            format_amount(before),
            format_amount(delta),
            write_key,
            held=held,
        )
    after = before + delta if op == "grant" else before - delta
    if after > AMOUNT_MAX:
        raise ValueError(f"amount must be at most {format(AMOUNT_MAX, 'f')}")
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
        "schema_version": CASH_SCHEMA_VERSION,
        "balances": {code: next_balances[code] for code in sorted(next_balances)},
        "ledger": [*state["ledger"], entry],
    }
    return next_state, entry


class DuplicateCashDecision(ValueError):
    def __init__(self, decision_id: str) -> None:
        super().__init__(
            f"decision_id '{decision_id}' already exists in the cash ledger"
        )
        self.decision_id = decision_id


class InsufficientFunds(ValueError):
    def __init__(
        self,
        balance: str,
        amount: str,
        currency: str,
        *,
        held: dict[str, str] | None = None,
    ) -> None:
        super().__init__(
            f"insufficient funds: balance {balance} {currency}, need {amount}"
        )
        self.balance = balance
        self.amount = amount
        self.currency = currency
        self.held = dict(held or {})


class CashHeadsError(ValueError):
    """Asset-head file or row cannot be reconciled with the cash ledger."""


CASH_ASSET_HEADS_NAME = "toolbox-asset-heads.json"
CASH_GRANT_TOOL = "state.cash_grant"
CASH_SPEND_TOOL = "state.cash_spend"
CHARGEN_CASH_SOURCE = "chargen-credit-rating"
CHARGEN_CASH_REASON = "investigator creation credit-rating conversion"
CHARGEN_CASH_LOCALIZED_REASON = "建卡·信用评级换算"
CHARGEN_CASH_ADJUST_SOURCE = "chargen-credit-rating-adjust"
CHARGEN_CASH_ADJUST_REASON = "investigator creation credit-rating delta"
CHARGEN_CASH_ADJUST_LOCALIZED_REASON = "建卡重跑·信用评级差额调整"


def cash_head_key(investigator_id: str) -> str:
    return f"cash:investigator:{investigator_id}"


def cash_head_record(entry: dict[str, Any], revision_after: int) -> dict[str, Any]:
    return {
        "tool": str(entry["tool"]),
        "decision_id": str(entry["decision_id"]),
        "revision_after": int(revision_after),
    }


def attach_cash_receipt(state: dict[str, Any], entry: dict[str, Any]) -> None:
    receipts = state.get("operation_receipts")
    if receipts is None:
        receipts = {}
        state["operation_receipts"] = receipts
    if not isinstance(receipts, dict):
        raise ValueError("cash operation receipts are invalid")
    tool = str(entry["tool"])
    bucket = receipts.get(tool)
    if bucket is None:
        bucket = {}
        receipts[tool] = bucket
    if not isinstance(bucket, dict):
        raise ValueError("cash operation receipts are invalid")
    decision_id = str(entry["decision_id"])
    bucket[decision_id] = {
        "tool": tool,
        "decision_id": decision_id,
        "op": entry["op"],
    }


def assert_cash_receipts(state: dict[str, Any], cash: dict[str, Any]) -> None:
    ledger = cash.get("ledger") or []
    if not ledger:
        return
    receipts = state.get("operation_receipts")
    if not isinstance(receipts, dict):
        raise ValueError("cash operation receipts are missing")
    for row in ledger:
        tool = str(row.get("tool") or "")
        decision_id = str(row.get("decision_id") or "")
        bucket = receipts.get(tool)
        if not isinstance(bucket, dict) or decision_id not in bucket:
            raise ValueError("cash operation receipts do not cover the ledger")


def cash_heads_status(
    document: dict[str, Any] | None,
    investigator_id: str,
    cash: dict[str, Any],
) -> str:
    """Return ok, missing, stale, or corrupt for this investigator cash head."""
    ledger = cash.get("ledger") or []
    if not ledger:
        return "ok"
    if document is None:
        return "missing"
    heads = document.get("heads") if isinstance(document, dict) else None
    if not isinstance(heads, dict):
        return "corrupt"
    head = heads.get(cash_head_key(investigator_id))
    if not isinstance(head, dict):
        return "missing"
    decision_id = str(head.get("decision_id") or "")
    tool = str(head.get("tool") or "")
    if not any(
        str(row.get("decision_id") or "") == decision_id
        and str(row.get("tool") or "") == tool
        for row in ledger
    ):
        return "corrupt"
    latest = ledger[-1]
    if (
        tool == str(latest.get("tool") or "")
        and decision_id == str(latest.get("decision_id") or "")
        and head.get("revision_after") == len(ledger)
    ):
        return "ok"
    return "stale"


def request_matches_cash_entry(
    entry: dict[str, Any],
    *,
    op: str,
    amount: Any,
    currency: str,
    unit: str | None,
    source: str,
    reason: str,
    localized_reason: str,
    tool: str,
) -> bool:
    if str(entry.get("op") or "") != op or str(entry.get("tool") or "") != tool:
        return False
    if (
        str(entry.get("source") or "") != source
        or str(entry.get("reason") or "") != reason
        or str(entry.get("localized_reason") or "") != localized_reason
    ):
        return False
    try:
        if parse_amount(entry.get("amount")) != parse_amount(amount):
            return False
        if canonical_currency(str(entry.get("currency") or "")) != canonical_currency(
            currency
        ):
            return False
    except ValueError:
        return False
    entry_unit = entry.get("unit")
    if unit is None:
        return "unit" not in entry or entry_unit is None
    return entry_unit == unit
