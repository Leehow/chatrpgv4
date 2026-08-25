#!/usr/bin/env python3
"""Operation adapter cell: finance."""
from __future__ import annotations

from coc_operation_kernel_runtime import (
    Any,
    Ctx,
    Path,
    ToolError,
    _SAFE_ID,
    _now_iso,
    _resolve_granted_item_spec,
    _resolve_investigator,
    _rules_resolver,
    coc_cash,
    coc_finance,
    coc_inventory,
    coc_runtime_ops,
    coc_state,
    coc_time,
    deepcopy,
    json,
    tool,
)

def _tool_rules_cash_assets(ctx: Ctx, args: dict[str, Any]):
    credit_rating = args.get("credit_rating")
    if isinstance(credit_rating, bool) or not isinstance(credit_rating, int):
        raise ToolError("invalid_param", "credit_rating must be an integer")
    requested_period = str(args.get("period") or "").strip()
    campaign_era = ""
    if ctx.campaign_dir is not None:
        campaign = coc_state.load_campaign_state(ctx.campaign_dir)
        campaign_era = str(campaign.get("era") or "").strip()
        if not campaign_era:
            raise ToolError(
                "invalid_param",
                "campaign has no canonical era for rules.cash_assets",
            )
        if requested_period and requested_period != campaign_era:
            raise ToolError(
                "invalid_param",
                "rules.cash_assets period must exactly match canonical "
                f"campaign era {campaign_era!r}; got {requested_period!r}",
            )
    period = requested_period or campaign_era or "1920s"
    try:
        data = _rules_resolver(ctx, "cash_assets").cash_assets(
            credit_rating, period=period
        )
    except ValueError as exc:
        if campaign_era:
            raise ToolError(
                "invalid_param",
                f"campaign era {campaign_era!r} has no authoritative "
                "cash-assets table; no 1920s fallback was applied",
                details={
                    "cash_semantic_disposition": (
                        coc_runtime_ops.kp_guided_cash_semantic_disposition(
                            campaign_era
                        )
                    ),
                },
            ) from exc
        raise ToolError("invalid_param", str(exc)) from exc
    return data, [], [
        (
            f"finance period is bound to canonical campaign era {campaign_era!r}"
            if campaign_era
            else "campaign-less lookup uses the package 1920s default"
        ),
        "living standard is descriptive, not a ledger: items matching the investigator's station are simply owned; only spending beyond the daily level touches cash (p.45-47, p.95-97)",
        "wealth-based first impressions use the pair-bound public npc.reaction D100 (p.191); this lookup never rolls",
    ]

def _tool_state_cash_semantic(ctx: Ctx, args: dict[str, Any]):
    tool_name = "state.cash_semantic"
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previous campaign-local cash disposition"
        ], []
    record_id = str(args["record_id"] or "").strip()
    if _SAFE_ID.fullmatch(record_id) is None:
        raise ToolError("invalid_param", "record_id must be a stable safe id")
    campaign = coc_state.load_campaign_state(ctx.campaign_dir)
    campaign_era = str(campaign.get("era") or "").strip()
    if (
        coc_runtime_ops.guided_character_creation_input_mode(campaign_era)
        != "kp_guided_era_adaptive"
    ):
        raise ToolError(
            "cash_semantic_unavailable",
            "state.cash_semantic is only available for a KP-guided era-adaptive campaign",
        )
    try:
        _rules_resolver(ctx, "cash_assets").cash_assets(0, period=campaign_era)
    except ValueError:
        pass
    else:
        raise ToolError(
            "cash_semantic_unavailable",
            f"campaign era {campaign_era!r} has an authoritative cash-assets table; use rules.cash_assets",
        )
    basis = str(args["basis"] or "").strip()
    if basis not in {"module_pregen", "kp_era_adaptation"}:
        raise ToolError(
            "invalid_param",
            "basis must be module_pregen or kp_era_adaptation",
        )
    reason = str(args["reason"] or "").strip()
    if not reason:
        raise ToolError("invalid_param", "reason must be non-empty")
    raw_cash = args.get("cash_description")
    cash_description = None
    if raw_cash is not None:
        if not isinstance(raw_cash, str) or not raw_cash.strip():
            raise ToolError("invalid_param", "cash_description must be a non-empty string when supplied")
        cash_description = raw_cash.strip()
    raw_assets = args.get("assets", [])
    if (
        not isinstance(raw_assets, list)
        or len(raw_assets) > 32
        or any(not isinstance(asset, str) or not asset.strip() for asset in raw_assets)
    ):
        raise ToolError("invalid_param", "assets must be a list of at most 32 non-empty strings")
    assets = [asset.strip() for asset in raw_assets]
    if cash_description is None and not assets:
        raise ToolError("invalid_param", "supply cash_description and/or assets")
    raw_investigator_id = args.get("investigator_id")
    investigator_id = None
    if raw_investigator_id is not None:
        investigator_id = str(raw_investigator_id).strip()
        if _SAFE_ID.fullmatch(investigator_id) is None:
            raise ToolError("invalid_param", "investigator_id must be a stable safe id when supplied")
    world = ctx.world()
    records = world.get("cash_semantic_records")
    if records is None:
        records = {}
    if not isinstance(records, dict):
        raise ToolError("state_corrupt", "world semantic cash record map is invalid")
    if record_id in records:
        raise ToolError(
            "idempotency_conflict",
            f"cash semantic record_id {record_id!r} already exists under another decision",
        )
    disposition = coc_runtime_ops.kp_guided_cash_semantic_disposition(campaign_era)
    record = {
        "record_id": record_id,
        "campaign_id": ctx.campaign_id,
        **({"investigator_id": investigator_id} if investigator_id else {}),
        **({"cash_description": cash_description} if cash_description else {}),
        "assets": assets,
        "provenance": {
            **disposition["provenance"],
            "basis": basis,
            "reason": reason,
            "rules_table_authority": "unavailable_for_campaign_era",
        },
        "recorded_at": _now_iso(),
    }
    records[record_id] = record
    world["cash_semantic_records"] = records
    ctx.save_world(world)
    ctx.log_event({"event_type": "cash_semantic_recorded", **record})
    ctx.ledger_record(decision_id, tool_name, record)
    return record, [], [
        "this is campaign-local KP semantic bookkeeping, not a rules cash calculation or table edit",
        "keep source-pregen facts and later spending effects distinct from this starting disposition",
    ]

def _cash_asset_heads_path(ctx: Ctx) -> Path:
    return ctx.campaign_dir / "save" / coc_cash.CASH_ASSET_HEADS_NAME

def _read_cash_asset_heads(ctx: Ctx) -> dict[str, Any] | None:
    path = _cash_asset_heads_path(ctx)
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ToolError("state_corrupt", "cash asset heads are unreadable") from exc
    if not isinstance(raw, dict) or not isinstance(raw.get("heads"), dict):
        raise ToolError("state_corrupt", "cash asset heads are invalid")
    return raw

def _write_cash_asset_head(
    ctx: Ctx,
    investigator_id: str,
    entry: dict[str, Any],
    revision_after: int,
) -> None:
    path = _cash_asset_heads_path(ctx)
    try:
        document = _read_cash_asset_heads(ctx)
    except ToolError:
        document = None
    if document is None:
        document = {"schema_version": 1, "heads": {}}
    heads = document.setdefault("heads", {})
    if not isinstance(heads, dict):
        heads = {}
        document["heads"] = heads
    document["schema_version"] = 1
    heads[coc_cash.cash_head_key(investigator_id)] = coc_cash.cash_head_record(
        entry, revision_after
    )
    coc_state.write_json_atomic(path, document)

def _load_normalized_cash(state: dict[str, Any]) -> dict[str, Any]:
    try:
        cash = coc_cash.normalize_cash(state.get("cash"))
        coc_cash.assert_cash_receipts(state, cash)
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    return cash

def _cash_heads_gate(
    ctx: Ctx,
    investigator_id: str,
    cash: dict[str, Any],
    *,
    repair_latest: dict[str, Any] | None = None,
) -> None:
    try:
        document = _read_cash_asset_heads(ctx)
    except ToolError:
        if repair_latest is None:
            raise
        document = None
    status = coc_cash.cash_heads_status(document, investigator_id, cash)
    if status == "ok":
        return
    latest = (cash.get("ledger") or [None])[-1] if cash.get("ledger") else None
    can_repair = (
        repair_latest is not None
        and isinstance(latest, dict)
        and str(latest.get("decision_id") or "") == str(repair_latest.get("decision_id") or "")
        and str(latest.get("tool") or "") == str(repair_latest.get("tool") or "")
        and status in {"missing", "stale"}
    )
    if can_repair and isinstance(latest, dict):
        _write_cash_asset_head(ctx, investigator_id, latest, len(cash["ledger"]))
        return
    raise ToolError("state_corrupt", "cash asset heads do not match the ledger")

def _cash_mutate(ctx: Ctx, args: dict[str, Any], *, op: str, tool_name: str):
    decision_id = str(args["decision_id"])
    investigator_id = _resolve_investigator(ctx, args)
    amount = args.get("amount")
    currency = args.get("currency")
    source = args.get("source")
    reason = args.get("reason")
    localized_reason = args.get("localized_reason")
    unit = args.get("unit") if "unit" in args else None
    if unit is not None and not isinstance(unit, str):
        raise ToolError("invalid_param", "unit must be a string when supplied")
    state = ctx.inv_state(investigator_id)
    cash = _load_normalized_cash(state)
    existing = next(
        (
            row
            for row in cash["ledger"]
            if str(row.get("decision_id") or "") == decision_id
        ),
        None,
    )
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if existing is not None:
        if not coc_cash.request_matches_cash_entry(
            existing,
            op=op,
            amount=amount,
            currency=str(currency or ""),
            unit=unit,
            source=str(source or ""),
            reason=str(reason or ""),
            localized_reason=str(localized_reason or ""),
            tool=tool_name,
        ):
            raise ToolError(
                "idempotency_conflict",
                f"decision_id '{decision_id}' already exists in the cash ledger",
            )
        public = coc_cash.cash_mutation_result(existing, investigator_id)
        _cash_heads_gate(ctx, investigator_id, cash, repair_latest=existing)
        if prior is None:
            ctx.ledger_record(decision_id, tool_name, public)
        return public, [
            "duplicate decision_id: returning the previously settled result"
        ], []
    if prior is not None:
        raise ToolError(
            "state_corrupt",
            f"cash ledger is missing settled decision_id '{decision_id}'",
        )
    _cash_heads_gate(ctx, investigator_id, cash)
    try:
        next_cash, entry = coc_cash.apply_cash(
            cash,
            op=op,
            amount=amount,
            currency=str(currency or ""),
            unit=unit,
            source=str(source or ""),
            reason=str(reason or ""),
            localized_reason=str(localized_reason or ""),
            decision_id=decision_id,
            recorded_at=_now_iso(),
            game_time=coc_time.current_stamp(ctx.campaign_dir),
            tool=tool_name,
        )
    except coc_cash.InsufficientFunds as exc:
        raise ToolError(
            "insufficient_funds",
            str(exc),
            details={
                "balance": exc.balance,
                "amount": exc.amount,
                "currency": exc.currency,
                "held": exc.held,
            },
        ) from exc
    except coc_cash.DuplicateCashDecision as exc:
        raise ToolError("idempotency_conflict", str(exc)) from exc
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    state["cash"] = next_cash
    try:
        coc_cash.attach_cash_receipt(state, entry)
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    ctx.save_inv_state(investigator_id, state)
    _write_cash_asset_head(ctx, investigator_id, entry, len(next_cash["ledger"]))
    public = coc_cash.cash_mutation_result(entry, investigator_id)
    ctx.log_event({
        "event_type": f"cash_{op}",
        "investigator_id": investigator_id,
        "decision_id": decision_id,
        "amount": entry["amount"],
        "currency": entry["currency"],
        "op": op,
    })
    ctx.ledger_record(decision_id, tool_name, public)
    return public, [], []

def _tool_state_cash_query(ctx: Ctx, args: dict[str, Any]):
    investigator_id = _resolve_investigator(ctx, args)
    state = ctx.inv_state(investigator_id)
    cash = _load_normalized_cash(state)
    _cash_heads_gate(ctx, investigator_id, cash)
    ledger = list(cash.get("ledger") or [])
    limit = args.get("limit")
    if limit is not None:
        if (
            isinstance(limit, bool)
            or not isinstance(limit, int)
            or limit < 1
        ):
            raise ToolError("invalid_param", "limit must be an integer >= 1")
        ledger = ledger[-limit:]
    return {
        "schema_version": cash.get("schema_version") or coc_cash.CASH_SCHEMA_VERSION,
        "balances": cash.get("balances") or {},
        "ledger": ledger,
    }, [], []

def _load_normalized_finance(state: dict[str, Any]) -> dict[str, Any]:
    try:
        return coc_finance.normalize_finance(state.get("finance"))
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc

def _trailing_rows(rows: list[Any], limit: Any) -> list[Any]:
    if limit is None:
        return list(rows)
    if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
        raise ToolError("invalid_param", "limit must be an integer >= 1")
    return list(rows)[-limit:]

def _tool_state_finance_query(ctx: Ctx, args: dict[str, Any]):
    investigator_id = _resolve_investigator(ctx, args)
    state = ctx.inv_state(investigator_id)
    finance = _load_normalized_finance(state)
    cash = _load_normalized_cash(state)
    _cash_heads_gate(ctx, investigator_id, cash)
    limit = args.get("limit")
    cash_ledger = _trailing_rows(list(cash.get("ledger") or []), limit)
    assets_ledger = _trailing_rows(list(finance["assets"].get("ledger") or []), limit)
    receipts = {}
    purchase_history = []
    liquidation_history = []
    for tool_name, bucket in finance["receipts"].items():
        rows = [bucket[key] for key in sorted(bucket)]
        receipts[tool_name] = _trailing_rows(rows, limit)
        for receipt in rows:
            result = receipt.get("result") if isinstance(receipt, dict) else {}
            if not isinstance(result, dict):
                continue
            if tool_name == "state.purchase":
                purchase_history.append({
                    "decision_id": result.get("decision_id"),
                    "payment_mode": result.get("payment_mode"),
                    "item_id": result.get("item_id"),
                    "amount": result.get("amount"),
                    "charged_amount": result.get("charged_amount"),
                    "currency": result.get("currency"),
                    "local_date": result.get("local_date"),
                    "settled": result.get("settled"),
                    "settled_by": result.get("settled_by"),
                })
            elif tool_name == "state.assets_liquidate":
                liquidation_history.append({
                    "decision_id": result.get("decision_id"),
                    "amount": result.get("amount"),
                    "currency": result.get("currency"),
                    "linked_time_decision_id": result.get("linked_time_decision_id"),
                    "assets_balance_after": result.get("assets_balance_after"),
                    "cash_balance_after": result.get("cash_balance_after"),
                })
    return {
        "schema_version": finance["schema_version"],
        "period": finance["period"],
        "currency": finance["currency"],
        "living_standard": finance["living_standard"],
        "spending_level": finance["spending_level"],
        "assets": {
            "schema_version": finance["assets"]["schema_version"],
            "balances": finance["assets"]["balances"],
            "ledger": assets_ledger,
        },
        "cash": {
            "schema_version": cash.get("schema_version") or coc_cash.CASH_SCHEMA_VERSION,
            "balances": cash.get("balances") or {},
            "ledger": cash_ledger,
        },
        "receipts": receipts,
        "purchase_history": _trailing_rows(purchase_history, limit),
        "liquidation_history": _trailing_rows(liquidation_history, limit),
        "seed": finance["seed"],
    }, [], []

_CASH_WRITE_PARAMS = {
    "investigator": {"type": "string", "desc": "investigator id"},
    "amount": {"type": "number", "required": True, "desc": "positive amount at most 2 decimal places"},
    "currency": {"type": "string", "required": True, "desc": "wallet identity (USD/GBP or aliases; never FX)"},
    "unit": {"type": "string", "desc": "optional recorded unit; omit to reuse the wallet unit"},
    "source": {"type": "string", "required": True, "desc": "structured source id"},
    "reason": {"type": "string", "required": True, "desc": "audit reason (not player-visible)"},
    "localized_reason": {"type": "string", "required": True, "desc": "player-safe reason in play_language"},
    "decision_id": {"type": "string", "desc": "idempotency key"},
}

def _tool_state_cash_grant(ctx: Ctx, args: dict[str, Any]):
    return _cash_mutate(ctx, args, op="grant", tool_name="state.cash_grant")

def _tool_state_cash_spend(ctx: Ctx, args: dict[str, Any]):
    return _cash_mutate(ctx, args, op="spend", tool_name="state.cash_spend")

def _cash_wallet_amount(cash: dict[str, Any], currency: str):
    identity = coc_cash.canonical_currency(coc_cash.validate_currency(currency))
    for code, wallet in (cash.get("balances") or {}).items():
        if not isinstance(wallet, dict):
            continue
        if coc_cash.canonical_currency(str(code)) != identity:
            continue
        return coc_cash.parse_amount(wallet.get("amount"))
    return coc_cash.parse_amount(0)

def _stamp_local_date(stamp: dict[str, Any]) -> str | None:
    raw = stamp.get("local_date")
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    dt = stamp.get("local_datetime")
    if isinstance(dt, str) and "T" in dt:
        return dt.split("T", 1)[0]
    return None

def _owned_acquisition_ids(sheet: dict[str, Any], inventory: dict[str, Any]) -> set[str]:
    owned: set[str] = set()
    for row in coc_inventory.effective_items(sheet.get("equipment"), inventory):
        item_id = str(row.get("item_id") or "").strip()
        if item_id:
            owned.add(item_id)
    for row in coc_inventory.effective_weapons(sheet.get("weapons"), inventory):
        weapon_id = coc_inventory.weapon_ref_id(row)
        if weapon_id:
            owned.add(weapon_id)
        item_id = str(row.get("item_id") or "").strip()
        if item_id:
            owned.add(item_id)
    return owned

def _purchase_item_payload(spec: dict[str, Any]) -> dict[str, Any]:
    item: dict[str, Any] = {
        "kind": spec["kind"],
        "item_id": spec["item_id"],
        "label": spec["label"],
    }
    if spec.get("weapon_spec") is not None:
        item["weapon"] = deepcopy(spec["weapon_spec"])
    if spec.get("consumable") is not None:
        item["consumable"] = spec["consumable"]
    if spec.get("quantity") is not None:
        item["quantity"] = spec["quantity"]
    if spec.get("note"):
        item["note"] = spec["note"]
    return item

def _finance_event_identity(event: Mapping[str, Any]) -> tuple[str, str, str]:
    return (
        str(event.get("event_type") or ""),
        str(event.get("investigator_id") or ""),
        str(event.get("decision_id") or ""),
    )

def _canonical_event_bytes(event: Mapping[str, Any]) -> str:
    return json.dumps(
        event,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )

def _matching_finance_events(ctx: Ctx, event: Mapping[str, Any]) -> list[dict[str, Any]]:
    path = ctx.campaign_dir / "logs" / "events.jsonl"
    if not path.is_file():
        return []
    identity = _finance_event_identity(event)
    matches: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(row, dict) and _finance_event_identity(row) == identity:
            matches.append(row)
    return matches

def _repair_finance_sidecars(
    ctx: Ctx,
    investigator_id: str,
    state: dict[str, Any],
    *,
    tool_name: str,
    decision_id: str,
    result: dict[str, Any],
    event: dict[str, Any],
) -> None:
    cash = _load_normalized_cash(state)
    cash_row = next(
        (
            row
            for row in cash.get("ledger") or []
            if str(row.get("decision_id") or "") == decision_id
        ),
        None,
    )
    if cash_row is not None:
        _cash_heads_gate(ctx, investigator_id, cash, repair_latest=cash_row)
    canonical = deepcopy(event)
    matches = _matching_finance_events(ctx, canonical)
    expected = _canonical_event_bytes(canonical)
    if not matches:
        ctx.log_event(deepcopy(canonical))
    else:
        for row in matches:
            if _canonical_event_bytes(row) != expected:
                raise ToolError(
                    "state_corrupt",
                    "finance event does not match the source receipt",
                )
    prior = ctx.ledger_lookup(tool_name, decision_id)
    if prior is None:
        ctx.ledger_record(decision_id, tool_name, result)
    elif prior.get("data") != result:
        raise ToolError(
            "state_corrupt",
            "toolbox ledger does not match the finance source receipt",
        )

def _purchase_request(
    *,
    investigator_id: str,
    payment_mode: str,
    amount: str,
    currency: str,
    unit: str | None,
    item: dict[str, Any],
    source: str,
    reason: str,
    localized_reason: str,
    price_ref: str | None,
    aggregated_from: list[str],
) -> dict[str, Any]:
    request: dict[str, Any] = {
        "investigator": investigator_id,
        "payment_mode": payment_mode,
        "amount": amount,
        "currency": currency,
        "item": deepcopy(item),
        "source": source,
        "reason": reason,
        "localized_reason": localized_reason,
    }
    if unit is not None:
        request["unit"] = unit
    if price_ref:
        request["price_ref"] = price_ref
    if aggregated_from:
        request["aggregated_from"] = list(aggregated_from)
    return request

def _tool_state_purchase(ctx: Ctx, args: dict[str, Any]):
    tool_name = "state.purchase"
    decision_id = str(args["decision_id"])
    investigator_id = _resolve_investigator(ctx, args)
    if str(args.get("npc_id") or "").strip():
        raise ToolError("invalid_param", "state.purchase is investigator-only")
    payment_mode = str(args.get("payment_mode") or "").strip()
    if payment_mode not in coc_finance.PURCHASE_PAYMENT_MODES:
        raise ToolError("invalid_param", "payment_mode must be spending_level, cash, or aggregate_cash")
    source = str(args.get("source") or "")
    reason = str(args.get("reason") or "")
    localized_reason = str(args.get("localized_reason") or "")
    unit = args.get("unit") if "unit" in args else None
    if unit is not None and not isinstance(unit, str):
        raise ToolError("invalid_param", "unit must be a string when supplied")
    price_ref = str(args.get("price_ref") or "").strip() or None
    raw_agg = args.get("aggregated_from")
    if payment_mode == "aggregate_cash":
        if not isinstance(raw_agg, list) or not raw_agg or any(
            not isinstance(item, str) or not item.strip() for item in raw_agg
        ):
            raise ToolError(
                "invalid_param",
                "aggregate_cash requires a non-empty aggregated_from list",
            )
        aggregated_from = [str(item).strip() for item in raw_agg]
    else:
        if raw_agg not in (None, []):
            raise ToolError("invalid_param", "aggregated_from is only valid for aggregate_cash")
        aggregated_from = []
    spec = _resolve_granted_item_spec(
        ctx, args, tool_name=tool_name, decision_id=decision_id
    )
    try:
        amount = coc_cash.format_amount(args.get("amount"))
        currency = coc_cash.validate_currency(str(args.get("currency") or ""))
        source = coc_cash.validate_source(source)
        reason = coc_cash.validate_reason(reason)
        localized_reason = coc_cash.validate_reason(localized_reason)
        unit = coc_cash.validate_unit(unit)
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    item_payload = _purchase_item_payload(spec)
    request = _purchase_request(
        investigator_id=investigator_id,
        payment_mode=payment_mode,
        amount=amount,
        currency=currency,
        unit=unit,
        item=item_payload,
        source=source,
        reason=reason,
        localized_reason=localized_reason,
        price_ref=price_ref,
        aggregated_from=aggregated_from,
    )
    state = ctx.inv_state(investigator_id)
    try:
        replayed = coc_finance.replay_finance_source_receipt(
            state=state,
            tool=tool_name,
            decision_id=decision_id,
            request=request,
        )
    except coc_finance.FinanceReceiptConflict as exc:
        raise ToolError("idempotency_conflict", str(exc)) from exc
    except coc_finance.FinanceStateCorrupt as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    if replayed is not None:
        stored = coc_finance.lookup_finance_operation_receipt(
            state, tool_name, decision_id
        )
        if stored is None or not isinstance(stored.get("event"), dict):
            raise ToolError("state_corrupt", "finance source receipt event is missing")
        _repair_finance_sidecars(
            ctx, investigator_id, state,
            tool_name=tool_name, decision_id=decision_id,
            result=replayed, event=stored["event"],
        )
        return replayed, [
            "duplicate decision_id: returning the previously settled result"
        ], []
    if ctx.ledger_lookup(tool_name, decision_id) is not None:
        raise ToolError(
            "state_corrupt",
            f"toolbox ledger has {tool_name} {decision_id} without a finance source receipt",
        )
    finance = _load_normalized_finance(state)
    cash = _load_normalized_cash(state)
    inventory = coc_inventory.normalize_inventory(state)
    sheet = ctx.sheet(investigator_id)
    owned = _owned_acquisition_ids(sheet, inventory)
    weapon_id = coc_inventory.weapon_ref_id(spec.get("weapon_spec"))
    if spec["item_id"] in owned or (weapon_id is not None and weapon_id in owned):
        raise ToolError(
            "invalid_param",
            f"item '{spec['item_id']}' already present",
        )
    stamp = coc_time.current_stamp(ctx.campaign_dir)
    local_date = _stamp_local_date(stamp)
    recorded_at = _now_iso()
    cash_before = _cash_wallet_amount(cash, currency)
    charged = coc_cash.parse_amount(amount)
    if payment_mode == "spending_level":
        try:
            coc_finance.spending_level_covers(finance, amount=amount, currency=currency)
        except ValueError as exc:
            raise ToolError("invalid_param", str(exc)) from exc
        charged = coc_cash.parse_amount(0)
        next_cash = cash
        cash_entry = None
    else:
        if payment_mode == "aggregate_cash":
            if not local_date:
                raise ToolError("invalid_param", "aggregate_cash requires current game local_date")
            seen: set[str] = set()
            for prior_id in aggregated_from:
                if prior_id in seen or prior_id == decision_id:
                    raise ToolError("invalid_param", "aggregated_from has a duplicate decision_id")
                seen.add(prior_id)
                raw = (finance["receipts"].get(tool_name) or {}).get(prior_id)
                if not isinstance(raw, dict):
                    raise ToolError("invalid_param", f"unknown spending_level purchase '{prior_id}'")
                try:
                    prior_receipt = coc_finance._validate_finance_receipt(
                        tool_name, prior_id, raw
                    )
                except ValueError as exc:
                    raise ToolError("state_corrupt", str(exc)) from exc
                prior_result = prior_receipt["result"]
                if prior_result.get("investigator_id") != investigator_id:
                    raise ToolError("invalid_param", "aggregated purchase belongs to another investigator")
                if prior_result.get("payment_mode") != "spending_level":
                    raise ToolError("invalid_param", "aggregated_from must be spending_level purchases")
                if prior_result.get("settled") is True:
                    raise ToolError("invalid_param", f"purchase '{prior_id}' is already settled")
                if prior_result.get("local_date") != local_date:
                    raise ToolError("invalid_param", "aggregated purchases must share the current local_date")
                if coc_cash.canonical_currency(prior_result["currency"]) != coc_cash.canonical_currency(currency):
                    raise ToolError("invalid_param", "aggregated purchases must use the same currency")
                charged += coc_cash.parse_stored_amount(prior_result["amount"])
        _cash_heads_gate(ctx, investigator_id, cash)
        try:
            next_cash, cash_entry = coc_cash.apply_cash(
                cash,
                op="spend",
                amount=charged,
                currency=currency,
                unit=unit,
                source=source,
                reason=reason,
                localized_reason=localized_reason,
                decision_id=decision_id,
                recorded_at=recorded_at,
                game_time=stamp,
                tool=tool_name,
            )
        except coc_cash.InsufficientFunds as exc:
            raise ToolError(
                "insufficient_funds",
                str(exc),
                details={
                    "balance": exc.balance,
                    "amount": exc.amount,
                    "currency": exc.currency,
                    "held": exc.held,
                },
            ) from exc
        except coc_cash.DuplicateCashDecision as exc:
            raise ToolError("idempotency_conflict", str(exc)) from exc
        except ValueError as exc:
            raise ToolError("invalid_param", str(exc)) from exc
    try:
        next_inventory, changed = coc_inventory.grant_entry(inventory, spec["entry"])
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    if not changed:
        raise ToolError("invalid_param", f"item '{spec['item_id']}' already present")
    cash_after = _cash_wallet_amount(next_cash, currency)
    result = {
        "changed": True,
        "investigator_id": investigator_id,
        "decision_id": decision_id,
        "payment_mode": payment_mode,
        "item_id": spec["item_id"],
        "label": spec["label"],
        "kind": spec["kind"],
        "amount": amount,
        "currency": currency,
        "charged_amount": coc_cash.format_amount(charged),
        "cash_balance_before": coc_cash.format_amount(cash_before),
        "cash_balance_after": coc_cash.format_amount(cash_after),
        "localized_reason": localized_reason,
        "game_time": stamp,
        "local_date": local_date,
        "settled": payment_mode != "spending_level",
        "settled_by": None,
        "aggregated_from": list(aggregated_from),
    }
    if unit is not None:
        result["unit"] = unit
    event = {
        "event_type": "purchase",
        "investigator_id": investigator_id,
        "decision_id": decision_id,
        "payment_mode": payment_mode,
        "amount": result["charged_amount"],
        "currency": currency,
        "item_id": spec["item_id"],
        "ts": recorded_at,
    }
    try:
        receipt = coc_finance.make_finance_operation_receipt(
            tool=tool_name,
            decision_id=decision_id,
            request=request,
            result=result,
            event=event,
        )
        if payment_mode == "aggregate_cash":
            bucket = finance["receipts"].setdefault(tool_name, {})
            for prior_id in aggregated_from:
                bucket[prior_id] = coc_finance.settle_purchase_receipt(
                    bucket[prior_id], settled_by=decision_id
                )
        if cash_entry is not None:
            state["cash"] = next_cash
            coc_cash.attach_cash_receipt(state, cash_entry)
        state["inventory"] = next_inventory
        state["finance"] = finance
        coc_finance.attach_finance_operation_receipt(state, receipt)
        state["finance"] = coc_finance.normalize_finance(state["finance"])
    except (coc_finance.FinanceReceiptConflict, coc_finance.FinanceStateCorrupt, ValueError) as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    ctx.save_inv_state(investigator_id, state)
    if cash_entry is not None:
        _write_cash_asset_head(ctx, investigator_id, cash_entry, len(next_cash["ledger"]))
    ctx.log_event(deepcopy(event))
    ctx.ledger_record(decision_id, tool_name, result)
    return result, [], []

def _tool_state_assets_liquidate(ctx: Ctx, args: dict[str, Any]):
    tool_name = "state.assets_liquidate"
    decision_id = str(args["decision_id"])
    investigator_id = _resolve_investigator(ctx, args)
    linked_id = str(args.get("linked_time_decision_id") or "").strip()
    unit = args.get("unit") if "unit" in args else None
    if unit is not None and not isinstance(unit, str):
        raise ToolError("invalid_param", "unit must be a string when supplied")
    try:
        amount = coc_cash.format_amount(args.get("amount"))
        currency = coc_cash.validate_currency(str(args.get("currency") or ""))
        source = coc_cash.validate_source(str(args.get("source") or ""))
        reason = coc_cash.validate_reason(str(args.get("reason") or ""))
        localized_reason = coc_cash.validate_reason(str(args.get("localized_reason") or ""))
        unit = coc_cash.validate_unit(unit)
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    if not linked_id:
        raise ToolError("invalid_param", "linked_time_decision_id is required")
    request: dict[str, Any] = {
        "investigator": investigator_id,
        "amount": amount,
        "currency": currency,
        "linked_time_decision_id": linked_id,
        "source": source,
        "reason": reason,
        "localized_reason": localized_reason,
    }
    if unit is not None:
        request["unit"] = unit
    state = ctx.inv_state(investigator_id)
    try:
        replayed = coc_finance.replay_finance_source_receipt(
            state=state,
            tool=tool_name,
            decision_id=decision_id,
            request=request,
        )
    except coc_finance.FinanceReceiptConflict as exc:
        raise ToolError("idempotency_conflict", str(exc)) from exc
    except coc_finance.FinanceStateCorrupt as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    if replayed is not None:
        stored = coc_finance.lookup_finance_operation_receipt(
            state, tool_name, decision_id
        )
        if stored is None or not isinstance(stored.get("event"), dict):
            raise ToolError("state_corrupt", "finance source receipt event is missing")
        _repair_finance_sidecars(
            ctx, investigator_id, state,
            tool_name=tool_name, decision_id=decision_id,
            result=replayed, event=stored["event"],
        )
        return replayed, [
            "duplicate decision_id: returning the previously settled result"
        ], []
    if ctx.ledger_lookup(tool_name, decision_id) is not None:
        raise ToolError(
            "state_corrupt",
            f"toolbox ledger has {tool_name} {decision_id} without a finance source receipt",
        )
    finance = _load_normalized_finance(state)
    cash = _load_normalized_cash(state)
    time_row = ctx.ledger_lookup("state.advance_time", linked_id)
    if time_row is None:
        raise ToolError(
            "invalid_param",
            "linked_time_decision_id is not a settled state.advance_time",
        )
    time_data = time_row.get("data") if isinstance(time_row.get("data"), dict) else {}
    delta = time_data.get("delta_minutes")
    if not isinstance(delta, int) or isinstance(delta, bool) or delta <= 0:
        raise ToolError(
            "invalid_param",
            "linked time advance must have a positive elapsed delta",
        )
    for other in (finance["receipts"].get(tool_name) or {}).values():
        other_result = other.get("result") if isinstance(other, dict) else {}
        if (
            isinstance(other_result, dict)
            and other_result.get("linked_time_decision_id") == linked_id
            and other_result.get("decision_id") != decision_id
        ):
            raise ToolError("invalid_param", "linked_time_decision_id is already consumed")
    stamp = coc_time.current_stamp(ctx.campaign_dir)
    recorded_at = _now_iso()
    assets_before = coc_finance.assets_wallet_amount(finance["assets"], currency)
    cash_before = _cash_wallet_amount(cash, currency)
    _cash_heads_gate(ctx, investigator_id, cash)
    try:
        next_assets, _assets_entry = coc_finance.apply_assets(
            finance["assets"],
            op="liquidate",
            amount=amount,
            currency=currency,
            unit=unit,
            source=source,
            reason=reason,
            localized_reason=localized_reason,
            decision_id=decision_id,
            recorded_at=recorded_at,
            game_time=stamp,
            tool=tool_name,
        )
        next_cash, cash_entry = coc_cash.apply_cash(
            cash,
            op="grant",
            amount=amount,
            currency=currency,
            unit=unit,
            source=source,
            reason=reason,
            localized_reason=localized_reason,
            decision_id=decision_id,
            recorded_at=recorded_at,
            game_time=stamp,
            tool=tool_name,
        )
    except coc_finance.InsufficientAssets as exc:
        raise ToolError(
            "insufficient_funds",
            str(exc),
            details={
                "balance": exc.balance,
                "amount": exc.amount,
                "currency": exc.currency,
            },
        ) from exc
    except (
        coc_finance.DuplicateAssetsDecision,
        coc_cash.DuplicateCashDecision,
    ) as exc:
        raise ToolError("idempotency_conflict", str(exc)) from exc
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    result = {
        "changed": True,
        "investigator_id": investigator_id,
        "decision_id": decision_id,
        "amount": amount,
        "currency": currency,
        "assets_balance_before": coc_cash.format_amount(assets_before),
        "assets_balance_after": coc_cash.format_amount(
            coc_finance.assets_wallet_amount(next_assets, currency)
        ),
        "cash_balance_before": coc_cash.format_amount(cash_before),
        "cash_balance_after": coc_cash.format_amount(
            _cash_wallet_amount(next_cash, currency)
        ),
        "linked_time_decision_id": linked_id,
        "localized_reason": localized_reason,
        "game_time": stamp,
    }
    if unit is not None:
        result["unit"] = unit
    event = {
        "event_type": "assets_liquidate",
        "investigator_id": investigator_id,
        "decision_id": decision_id,
        "amount": amount,
        "currency": currency,
        "linked_time_decision_id": linked_id,
        "ts": recorded_at,
    }
    try:
        receipt = coc_finance.make_finance_operation_receipt(
            tool=tool_name,
            decision_id=decision_id,
            request=request,
            result=result,
            event=event,
        )
        finance["assets"] = next_assets
        state["cash"] = next_cash
        coc_cash.attach_cash_receipt(state, cash_entry)
        state["finance"] = finance
        coc_finance.attach_finance_operation_receipt(state, receipt)
        state["finance"] = coc_finance.normalize_finance(state["finance"])
    except (coc_finance.FinanceReceiptConflict, coc_finance.FinanceStateCorrupt, ValueError) as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    ctx.save_inv_state(investigator_id, state)
    _write_cash_asset_head(ctx, investigator_id, cash_entry, len(next_cash["ledger"]))
    ctx.log_event(deepcopy(event))
    ctx.ledger_record(decision_id, tool_name, result)
    return result, [], []

def register_operations(registry) -> None:
    global TOOLS
    TOOLS = registry.legacy_tools
    registry.tool(
    "rules.cash_assets",
    "Credit Rating to cash/assets/spending level and living standard (Table II, p.45-47). Read-only lookup; use when lifestyle, affordable purchases, or wealth-based social access matter.",
    {
        "credit_rating": {"type": "integer", "required": True, "desc": "the investigator's Credit Rating skill value"},
        "period": {"type": "string", "desc": "finance period from cash-assets.json; with a campaign it must equal the canonical campaign era, otherwise defaults to '1920s'"},
    },
    needs_campaign=False,
)(_tool_rules_cash_assets)
    registry.tool(
    "state.cash_semantic",
    "Record one KP-guided, campaign-local starting-cash/assets disposition when the campaign era has no authoritative cash-assets table. This never calculates, replaces, or changes rules-table values.",
    {
        "record_id": {"type": "string", "required": True, "desc": "stable campaign-local cash record id"},
        "investigator_id": {"type": "string", "desc": "optional planned or linked investigator id"},
        "cash_description": {"type": "string", "desc": "player-safe semantic cash description; not a rules-derived amount"},
        "assets": {"type": "array", "desc": "player-safe starting assets from a pregen or era adaptation"},
        "basis": {"type": "string", "required": True, "desc": "module_pregen | kp_era_adaptation"},
        "reason": {"type": "string", "required": True, "desc": "why this source/pacing-appropriate semantic disposition applies"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
    write_domains=("world",),
)(_tool_state_cash_semantic)
    registry.tool(
    "state.cash_query",
    "Read the investigator's runtime cash ledger (schema v2 balances + recent rows). Not the chargen sheet snapshot.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "limit": {"type": "integer", "desc": "max trailing ledger rows (default all)"},
    },
    access="query",
    read_domains=("party",),
    write_domains=(),
    recovery_domains=(),
    response_mode="full",
    audit_mode="reference",
    strict_read_only=True,
    execution_class="serial_campaign",
)(_tool_state_cash_query)
    registry.tool(
    "state.finance_query",
    "Read current runtime cash, Assets, living standard, and inclusive Spending Level. Not the chargen sheet snapshot.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "limit": {"type": "integer", "desc": "max trailing cash/assets/receipt rows (default all)"},
    },
    access="query",
    read_domains=("party",),
    write_domains=(),
    recovery_domains=(),
    response_mode="full",
    audit_mode="reference",
    strict_read_only=True,
    execution_class="serial_campaign",
)(_tool_state_finance_query)
    registry.tool(
    "state.cash_grant",
    "Credit the investigator runtime cash ledger before narrating. Idempotent on decision_id. Do not treat sheet cash as this purse.",
    _CASH_WRITE_PARAMS,
)(_tool_state_cash_grant)
    registry.tool(
    "state.cash_spend",
    "Debit the investigator runtime cash ledger before narrating. Fails closed on insufficient funds. Idempotent on decision_id.",
    _CASH_WRITE_PARAMS,
)(_tool_state_cash_spend)
    registry.tool(
    "state.purchase",
    "Atomically grant a purchased item. spending_level is inclusive and writes no cash row; cash debits this price; aggregate_cash debits prior same-day spending_level prices plus this price. Fails closed before any write on duplicate items or insufficient funds.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "payment_mode": {
            "type": "string",
            "required": True,
            "enum": ["spending_level", "cash", "aggregate_cash"],
            "desc": "spending_level | cash | aggregate_cash",
        },
        "amount": {"type": "number", "required": True, "desc": "effective price of this item; KP-supplied, never parsed from display"},
        "currency": {"type": "string", "required": True, "desc": "wallet identity; never FX"},
        "unit": {"type": "string", "desc": "optional recorded unit"},
        "kind": {"type": "string", "required": True, "desc": "gear | weapon"},
        "label": {"type": "string", "required": True, "desc": "short display label"},
        "item_id": {"type": "string", "desc": "stable item id"},
        "weapon_id": {"type": "string", "desc": "catalog/module weapon id (kind=weapon)"},
        "weapon": {"type": "object", "desc": "full custom weapon spec (kind=weapon)"},
        "mechanics_ref": {"type": "string", "desc": "campaign-item:<id> or module-item:<id>"},
        "consumable": {"type": "boolean", "desc": "kind=gear only"},
        "quantity": {"type": "integer", "desc": "kind=gear only"},
        "note": {"type": "string", "desc": "where/how obtained"},
        "price_ref": {"type": "string", "desc": "optional catalog price record id; provenance only"},
        "aggregated_from": {
            "type": "array",
            "items": {"type": "string"},
            "desc": "prior unsettled spending_level decision_ids; required for aggregate_cash",
        },
        "source": {"type": "string", "required": True, "desc": "structured source id"},
        "reason": {"type": "string", "required": True, "desc": "audit reason (not player-visible)"},
        "localized_reason": {"type": "string", "required": True, "desc": "player-safe reason in play_language"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_state_purchase)
    registry.tool(
    "state.assets_liquidate",
    "Convert runtime Assets into cash after a linked state.advance_time decision. One investigator-state write; no FX and no Credit Rating change.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "amount": {"type": "number", "required": True, "desc": "Assets to convert and cash to credit; same currency, never FX"},
        "currency": {"type": "string", "required": True, "desc": "wallet identity; never FX"},
        "unit": {"type": "string", "desc": "optional recorded unit"},
        "linked_time_decision_id": {
            "type": "string",
            "required": True,
            "desc": "settled state.advance_time decision with positive elapsed delta",
        },
        "source": {"type": "string", "required": True, "desc": "structured method/source id"},
        "reason": {"type": "string", "required": True, "desc": "audit reason (not player-visible)"},
        "localized_reason": {"type": "string", "required": True, "desc": "player-safe reason in play_language"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_state_assets_liquidate)


OPERATION_EXPORTS = (
    '_CASH_WRITE_PARAMS',
    '_canonical_event_bytes',
    '_cash_asset_heads_path',
    '_cash_heads_gate',
    '_cash_mutate',
    '_cash_wallet_amount',
    '_finance_event_identity',
    '_load_normalized_cash',
    '_load_normalized_finance',
    '_matching_finance_events',
    '_owned_acquisition_ids',
    '_purchase_item_payload',
    '_purchase_request',
    '_read_cash_asset_heads',
    '_repair_finance_sidecars',
    '_stamp_local_date',
    '_tool_rules_cash_assets',
    '_tool_state_assets_liquidate',
    '_tool_state_cash_grant',
    '_tool_state_cash_query',
    '_tool_state_cash_semantic',
    '_tool_state_cash_spend',
    '_tool_state_finance_query',
    '_tool_state_purchase',
    '_trailing_rows',
    '_write_cash_asset_head',
)
