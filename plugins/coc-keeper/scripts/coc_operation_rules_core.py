#!/usr/bin/env python3
"""Operation adapter cell: rules-core."""
from __future__ import annotations

from coc_operation_kernel_runtime import (
    Any,
    Ctx,
    ToolError,
    _CHARGEN_DICE_PURPOSES,
    _LUCK_SPEND_RECEIPT_SCHEMA_VERSION,
    _SAFE_ID,
    _SOURCE_RECEIPT_INTEGRITY_KEY,
    _active_ruleset_id,
    _canonical_digest,
    _commit_new_roll_receipt,
    _current_elapsed_minutes,
    _execute_subsystem_requests,
    _existing_roll_receipt,
    _is_exact_int,
    _load_roll_receipt_document,
    _load_sibling,
    _luck_source_reference,
    _luck_spend_data,
    _new_roll_receipt,
    _operation_event_id,
    _operation_fingerprint,
    _parse_complete_roll_frames,
    _read_jsonl_records,
    _replay_roll_receipt,
    _resolve_investigator,
    _resolve_target_value,
    _rng,
    _roll_common,
    _roll_log_bytes,
    _roll_side_effect_key,
    _rules_resolver,
    _save_roll_receipt_document,
    _source_receipt_integrity,
    _source_receipt_manifest,
    _validated_roll_document_collection,
    _verify_roll_receipt_prefixes,
    coc_roll,
    coc_rulesets,
    coc_state,
    coc_turn_finalization,
    deepcopy,
    dispatch_rules_context,
    dispatch_rules_settle,
    json,
    re,
    tool,
)

coc_catalog = _load_sibling("coc_catalog", "coc_catalog.py")

_DAMAGE_RECEIPTS_KEY = "ruleset_damage_receipts"
_DAMAGE_RECEIPT_SCHEMA_VERSION = 1
_DAMAGE_RECEIPT_LIMIT = 300
_DAMAGE_RECEIPT_FIELDS = frozenset({
    "schema_version",
    "tool",
    "decision_id",
    "fingerprint",
    "operation",
    "data",
    "roll_record",
    "event",
    "integrity_digest",
})

_DICE_MULTIPLIER_PATTERN = re.compile(
    r"^(?P<base>\d+D\d+(?:[+-]\d+)?)[*Xx×](?P<factor>\d+)$"
)

def _unsupported_dice_expression_message(raw: str) -> str:
    """Steer one legal NdM(+/-k) call; never evaluate * / x / batch syntax."""
    compact = str(raw).strip().replace(" ", "").upper().replace("×", "X")
    if ";" in compact:
        return (
            f"unsupported dice expression: {raw!r}; pass one "
            "NdM(+/-k) expression per call (e.g. '3D6', '2D6+6'); there is no "
            "batch or multiplier syntax — roll each part of an array as its "
            "own rules.roll_dice call"
        )
    match = _DICE_MULTIPLIER_PATTERN.fullmatch(compact)
    if match is not None:
        base = match.group("base").upper()
        factor = match.group("factor")
        return (
            f"unsupported dice expression: {raw!r}; {base}x{factor} is a "
            "post-roll characteristic conversion, not a dice expression. "
            f"Call rules.roll_dice once with expression={base!r}; multiply "
            f"the returned total by {factor} when writing the sheet. There "
            "is no multiplier or batch syntax"
        )
    return (
        f"unsupported dice expression: {raw!r}; pass one "
        "NdM(+/-k) expression per call (e.g. '3D6', '2D6+6'); there is no "
        "batch or multiplier syntax — roll each part of an array as its "
        "own rules.roll_dice call"
    )

def _roll_dice_semantic_operation(args: dict[str, Any]) -> dict[str, Any]:
    """Bind player/keeper meaning while treating the test RNG seed as transport."""
    expression = str(args["expression"]).strip().upper()
    if coc_roll.ROLL_PATTERN.fullmatch(expression) is None:
        raise ValueError(_unsupported_dice_expression_message(args["expression"]))
    operation = {
        "expression": expression,
        "reason": str(args["reason"]) if args.get("reason") is not None else None,
    }
    if args.get("purpose") is not None:
        operation["purpose"] = str(args["purpose"])
    return operation

def _luck_spend_receipt(
    document: dict[str, Any], decision_id: str,
) -> dict[str, Any] | None:
    receipts = document.get("luck_spends")
    if not isinstance(receipts, dict):
        raise ToolError("state_corrupt", "canonical Luck receipt map is invalid")
    receipt = receipts.get(str(decision_id))
    if receipt is None:
        return None
    if not isinstance(receipt, dict):
        raise ToolError("state_corrupt", "canonical Luck receipt is invalid")
    return receipt

def _new_luck_spend_receipt(
    *,
    decision_id: str,
    operation: dict[str, Any],
    source_receipt: dict[str, Any],
    data: dict[str, Any],
) -> dict[str, Any]:
    event_id = _operation_event_id("rules.luck_spend", decision_id)
    event = {"event_id": event_id, "event_type": "luck_spent", **deepcopy(data)}
    receipt = {
        "schema_version": _LUCK_SPEND_RECEIPT_SCHEMA_VERSION,
        "tool": "rules.luck_spend",
        "decision_id": str(decision_id),
        "fingerprint": _operation_fingerprint("rules.luck_spend", operation),
        "operation": deepcopy(operation),
        "source_receipt": _luck_source_reference(source_receipt),
        "data": deepcopy(data),
        "event": event,
    }
    receipt[_SOURCE_RECEIPT_INTEGRITY_KEY] = _source_receipt_integrity(receipt)
    return receipt

_RULESET_REQUEST_RESERVED_FIELDS = frozenset({
    "rng", "current", "actor", "actor_id", "decision_id", "receipt_id",
    "roll_id", "ruleset_id", "ruleset_version",
})

def _ruleset_mutation_identity(
    ctx: Ctx, args: dict[str, Any], *, tool_name: str,
) -> tuple[str, str, str, str, dict[str, Any], int | None]:
    """Validate exact transport identity before package code is called."""
    decision_id = args.get("decision_id")
    actor_id = args.get("actor")
    if (
        not isinstance(decision_id, str)
        or not decision_id
        or decision_id != decision_id.strip()
    ):
        raise ToolError("invalid_param", "decision_id must be an exact non-empty string")
    if not isinstance(actor_id, str) or _SAFE_ID.fullmatch(actor_id) is None:
        raise ToolError("invalid_param", "actor must be a stable safe id")
    request = args.get("request")
    if not isinstance(request, dict):
        raise ToolError("invalid_param", "request must be an object")
    reserved = sorted(set(request) & _RULESET_REQUEST_RESERVED_FIELDS)
    if reserved:
        raise ToolError(
            "invalid_param",
            "request contains kernel-reserved fields: " + ", ".join(reserved),
        )
    seed = args.get("seed")
    if seed is not None and not _is_exact_int(seed):
        raise ToolError("invalid_param", "seed must be an integer")
    ruleset_id = _active_ruleset_id(ctx)
    manifest = coc_rulesets.load_manifest(ruleset_id)
    ruleset_version = manifest.get("version")
    if not isinstance(ruleset_version, str) or not ruleset_version:
        raise ToolError("invalid_ruleset", "active ruleset version must be non-empty")
    try:
        coc_state.load_ruleset_actor_state(ctx.campaign_dir, actor_id)
    except coc_state.UnsupportedSaveSchema as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    operation = {
        "ruleset_id": ruleset_id,
        "ruleset_version": ruleset_version,
        "actor_id": actor_id,
        "request": deepcopy(request),
        "seed": seed,
    }
    return decision_id, actor_id, ruleset_id, ruleset_version, operation, seed

def _generic_check_resolution(
    result: dict[str, Any], request: dict[str, Any],
) -> dict[str, Any]:
    """Normalize one small public check evidence contract."""
    nested = result.get("roll")
    if isinstance(nested, dict):
        expression = nested.get("expression")
        faces = nested.get("faces")
        total = nested.get("total")
    else:
        expression = "1D100"
        faces = [nested]
        total = nested
    success = result.get("success")
    outcome = result.get("outcome")
    if outcome is None and isinstance(success, bool):
        outcome = "success" if success else "failure"
    label = result.get("label") or request.get("label") or "check"
    target = result.get("target", result.get("difficulty"))
    resolution = {
        "label": label,
        "outcome": outcome,
        "success": success,
        "expression": expression,
        "faces": faces,
        "total": total,
        "target": target,
    }
    if (
        not isinstance(label, str) or not label.strip()
        or not isinstance(outcome, str) or not outcome.strip()
        or not isinstance(success, bool)
        or not isinstance(expression, str) or not expression.strip()
        or not isinstance(faces, list) or not faces
        or not all(_is_exact_int(value) for value in faces)
        or not _is_exact_int(total)
        or (target is not None and not _is_exact_int(target))
    ):
        raise ToolError(
            "invalid_ruleset",
            "ruleset check must return success/outcome and integer roll evidence",
        )
    return {
        "label": label.strip(),
        "outcome": outcome.strip(),
        "success": success,
        "expression": expression.strip().upper(),
        "faces": list(faces),
        "total": total,
        "target": target,
    }

def _resource_receipt_integrity(data: dict[str, Any]) -> str:
    return _canonical_digest({
        key: value for key, value in data.items() if key != "integrity_digest"
    })

def _tool_rules_check(ctx: Ctx, args: dict[str, Any]):
    unsupported = sorted(set(args) - {"actor", "request", "seed", "decision_id"})
    if unsupported:
        raise ToolError(
            "invalid_param", "rules.check has unsupported fields: " + ", ".join(unsupported)
        )
    (
        decision_id, actor_id, ruleset_id, ruleset_version, operation, _seed,
    ) = _ruleset_mutation_identity(ctx, args, tool_name="rules.check")
    document, receipt = _existing_roll_receipt(
        ctx,
        tool_name="rules.check",
        decision_id=decision_id,
        operation=operation,
    )
    if receipt is not None:
        return _replay_roll_receipt(ctx, document, receipt)
    resolver = _rules_resolver(ctx, "check")
    try:
        result = resolver.check(**deepcopy(operation["request"]), rng=_rng(args))
    except (TypeError, ValueError) as exc:
        raise ToolError(
            "invalid_param",
            "rules.check package primitive rejected request: "
            f"{exc}; investigator skill/characteristic checks use rules.roll, "
            "concealed Psychology observation uses rules.psychology_observe, "
            "and rules.skill_check does not exist",
        ) from exc
    if not isinstance(result, dict):
        raise ToolError("invalid_ruleset", "ruleset check must return an object")
    resolution = _generic_check_resolution(result, operation["request"])
    data = {
        "schema_version": 1,
        "receipt_id": _operation_event_id(
            f"{ruleset_id}@{ruleset_version}.rules.check", decision_id
        ),
        "ruleset_id": ruleset_id,
        "ruleset_version": ruleset_version,
        "operation": "check",
        "decision_id": decision_id,
        "actor_id": actor_id,
        "investigator_id": actor_id,
        "kind": "ruleset_check",
        "skill": resolution["label"],
        "display_skill": resolution["label"],
        "outcome": resolution["outcome"],
        "success": resolution["success"],
        "roll": resolution["total"],
        "target": resolution["target"],
        "dice": {
            "expression": resolution["expression"],
            "raw": deepcopy(resolution["faces"]),
            "total": resolution["total"],
        },
        "request": {
            "request": deepcopy(operation["request"]),
            "seed": operation["seed"],
        },
        "result": deepcopy(result),
    }
    roll_record = ctx.prepare_roll({
        "event_type": "roll",
        "type": "ruleset_check",
        "kind": "ruleset_check",
        "actor": actor_id,
        "visibility": "public",
        "payload": deepcopy(data),
        **data,
    })
    data["roll_id"] = roll_record["roll_id"]
    roll_record.update(deepcopy(data))
    roll_record["payload"].update(deepcopy(data))
    receipt = _new_roll_receipt(
        tool_name="rules.check",
        decision_id=decision_id,
        operation=operation,
        resolution=resolution,
        roll_record=roll_record,
        data=data,
        warnings=[],
        hints=[],
    )
    _commit_new_roll_receipt(ctx, document, receipt)
    return data, [], []

def _tool_rules_resource_delta(ctx: Ctx, args: dict[str, Any]):
    unsupported = sorted(set(args) - {"actor", "request", "seed", "decision_id"})
    if unsupported:
        raise ToolError(
            "invalid_param",
            "rules.resource_delta has unsupported fields: " + ", ".join(unsupported),
        )
    (
        decision_id, actor_id, ruleset_id, ruleset_version, operation, _seed,
    ) = _ruleset_mutation_identity(ctx, args, tool_name="rules.resource_delta")
    request = operation["request"]
    resource_key = request.get("resource")
    declared_resources = {
        str(resource.get("key"))
        for resource in coc_rulesets.ruleset_resources(ruleset_id)
        if isinstance(resource.get("key"), str)
    }
    if not isinstance(resource_key, str) or resource_key not in declared_resources:
        raise ToolError("invalid_param", "request.resource is not declared by the ruleset")
    actor_state = coc_state.load_ruleset_actor_state(ctx.campaign_dir, actor_id)
    decisions = (
        actor_state.get("ruleset_resource_receipts")
        if ruleset_id == "coc7"
        else actor_state.get("decisions")
    )
    if decisions is None:
        decisions = {}
    if not isinstance(decisions, dict):
        raise ToolError("state_corrupt", "actor resource receipt index is invalid")
    frozen = decisions.get(decision_id)
    prior = ctx.ledger_lookup("rules.resource_delta", decision_id)
    if frozen is not None:
        if not isinstance(frozen, dict):
            raise ToolError("state_corrupt", "actor resource receipt is invalid")
        expected_integrity = _resource_receipt_integrity(frozen)
        result = frozen.get("result")
        try:
            current = coc_state.ruleset_actor_resource_value(
                ruleset_id, actor_state, resource_key
            )
        except ValueError as exc:
            raise ToolError("state_corrupt", str(exc)) from exc
        if (
            frozen.get("integrity_digest") != expected_integrity
            or frozen.get("ruleset_id") != ruleset_id
            or frozen.get("ruleset_version") != ruleset_version
            or frozen.get("actor_id") != actor_id
            or frozen.get("decision_id") != decision_id
            or frozen.get("request") != {
                "request": request, "seed": operation["seed"]
            }
            or not isinstance(result, dict)
            or result.get("resource") != resource_key
            or result.get("after") != current
        ):
            raise ToolError(
                "idempotency_conflict",
                f"decision_id {decision_id!r} owns different actor resource evidence",
            )
        if prior is not None and prior.get("data") != frozen:
            raise ToolError("state_corrupt", "toolbox ledger conflicts with actor state")
        if prior is None:
            ctx.ledger_record(decision_id, "rules.resource_delta", frozen)
        return deepcopy(frozen), [
            "duplicate decision_id: recovered the state-bound original receipt"
        ], []
    if prior is not None:
        raise ToolError(
            "state_corrupt",
            "toolbox ledger resource entry has no canonical actor-state receipt",
        )
    try:
        current = coc_state.ruleset_actor_resource_value(
            ruleset_id, actor_state, resource_key
        )
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    resolver = _rules_resolver(ctx, "resource_delta")
    try:
        result = resolver.resource_delta(
            **deepcopy(request), current=current, rng=_rng(args)
        )
    except (TypeError, ValueError) as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    if not isinstance(result, dict):
        raise ToolError("invalid_ruleset", "ruleset resource_delta must return an object")
    before, after, delta = result.get("before"), result.get("after"), result.get("delta")
    if (
        result.get("resource") != resource_key
        or not all(_is_exact_int(value) for value in (before, after, delta))
        or before != current
        or after - before != delta
    ):
        raise ToolError(
            "invalid_ruleset",
            "ruleset resource_delta returned contradictory state arithmetic",
        )
    data = {
        "schema_version": 1,
        "receipt_id": _operation_event_id(
            f"{ruleset_id}@{ruleset_version}.rules.resource_delta", decision_id
        ),
        "ruleset_id": ruleset_id,
        "ruleset_version": ruleset_version,
        "operation": "resource_delta",
        "decision_id": decision_id,
        "actor_id": actor_id,
        "investigator_id": actor_id,
        "request": {"request": deepcopy(request), "seed": operation["seed"]},
        "result": deepcopy(result),
        "state_bound": True,
    }
    data["integrity_digest"] = _resource_receipt_integrity(data)
    coc_state.write_ruleset_actor_resource_receipt(
        ctx.campaign_dir,
        actor_id,
        resource_key=resource_key,
        after=after,
        decision_id=decision_id,
        receipt=deepcopy(data),
    )
    ctx.ledger_record(decision_id, "rules.resource_delta", data)
    return data, [], []

def _tool_rules_skill_describe(ctx: Ctx, args: dict[str, Any]):
    try:
        catalog = _rules_resolver(ctx, "skill_describe").skill_describe()
    except (OSError, json.JSONDecodeError) as exc:
        raise ToolError("state_corrupt", f"skill-descriptions.json unreadable: {exc}") from exc
    if not isinstance(catalog, dict):
        raise ToolError("state_corrupt", "skill-descriptions.json must be an object")
    entries = catalog.get("skills")
    if not isinstance(entries, dict):
        raise ToolError("state_corrupt", "skill-descriptions.json missing skills object")

    requested: list[str] = []
    single = args.get("skill")
    if single is not None:
        if not isinstance(single, str) or not single.strip():
            raise ToolError("invalid_param", "skill must be a non-empty string")
        requested.append(single.strip())
    many = args.get("skills")
    if many is not None:
        if not isinstance(many, list) or not many:
            raise ToolError("invalid_param", "skills must be a non-empty array of strings")
        for item in many:
            if not isinstance(item, str) or not item.strip():
                raise ToolError("invalid_param", "skills entries must be non-empty strings")
            label = item.strip()
            if label not in requested:
                requested.append(label)

    include_policy = args.get("include_selection_policy")
    interpersonal = {"Charm", "Fast Talk", "Intimidate", "Persuade"}
    if include_policy is None:
        include_policy = (not requested) or any(name in interpersonal for name in requested)
    elif not isinstance(include_policy, bool):
        raise ToolError("invalid_param", "include_selection_policy must be a boolean")

    if not requested:
        requested = sorted(entries)

    found: dict[str, Any] = {}
    missing: list[str] = []
    by_case = {str(key).casefold(): key for key in entries}
    for name in requested:
        canonical = by_case.get(name.casefold())
        if canonical is None:
            missing.append(name)
            continue
        payload = entries[canonical]
        if not isinstance(payload, dict):
            raise ToolError("state_corrupt", f"skill description for {canonical!r} is invalid")
        found[canonical] = payload

    data: dict[str, Any] = {
        "schema_version": catalog.get("schema_version"),
        "source_note": catalog.get("source_note"),
        "requested": requested,
        "skills": found,
        "missing": missing,
        "catalog_skill_ids": sorted(entries),
    }
    if include_policy:
        policy = catalog.get("selection_policy")
        if isinstance(policy, dict):
            data["selection_policy"] = policy
    hints: list[str] = []
    if missing:
        hints.append(
            "missing entries are not yet compiled into skill-descriptions.json; "
            "adjudicate from the rulebook / authored affordance, or expand the catalog"
        )
    if found:
        hints.append(
            "KP flow: decide candidate skill(s) from player fiction → call this tool → "
            "choose the matching skill → then rules.roll; narrate what success/failure changes before clue dumps"
        )
    return data, [], hints

def _tool_rules_catalog_search(ctx: Ctx, args: dict[str, Any]):
    campaign = None
    if ctx.campaign_dir is not None:
        campaign = coc_state.load_campaign_state(ctx.campaign_dir)
    result = coc_catalog.search_catalog(
        query=args.get("query"),
        kinds=args.get("kinds"),
        era=args.get("era"),
        limit=args.get("limit"),
        campaign=campaign,
    )
    if not result.get("ok"):
        err = result.get("error") if isinstance(result.get("error"), dict) else {}
        code = str(err.get("code") or "catalog_search_failed")
        message = str(err.get("detail") or err.get("message") or code)
        raise ToolError(code, message, details=err or None)
    data = dict(result)
    data["authority"] = "advisory"
    data["candidate_only"] = True
    data["selected"] = None
    if any(isinstance(row, dict) and row.get("secret") for row in data.get("candidates") or []):
        data["secret"] = True
    hints = [
        "authority=advisory; candidates only. KP chooses the exact entity_id semantically; never auto-pick the first string match.",
        "Do not print this catalog payload or any secret:true row to the player.",
    ]
    return data, [], hints

def _tool_rules_build_scale(ctx: Ctx, args: dict[str, Any]):
    def _optional_int(name: str) -> int | None:
        value = args.get(name)
        if value is None:
            return None
        if isinstance(value, bool) or not isinstance(value, int):
            raise ToolError("invalid_param", f"{name} must be an integer")
        return value

    build = _optional_int("build")
    actor_build = _optional_int("actor_build")
    target_build = _optional_int("target_build")
    if (actor_build is None) != (target_build is None):
        raise ToolError("invalid_param", "actor_build and target_build must be given together")
    if build is None and actor_build is None:
        raise ToolError("invalid_param", "provide build, or actor_build and target_build")
    data = _rules_resolver(ctx, "build_scale").build_scale(
        build, actor_build=actor_build, target_build=target_build
    )
    return data, [], [
        "build derives from STR+SIZ via the damage-bonus-build table (p.33); this lookup never rolls",
        "a fighting maneuver against a target 3+ builds larger is physically impossible — narrate the impossibility instead of rolling (p.105)",
    ]

def _tool_rules_roll(ctx: Ctx, args: dict[str, Any]):
    """Keeper-visible ordinary check. Single execution path: resolver.check.

    RuleGraph ordinary-check settle compiles to this same `_roll_common` /
    `resolver.check` adapter. No second roll primitive. Graph-absent plug
    leaves this legacy path unchanged.
    """
    return _roll_common(ctx, args, pushed=False, tool_name="rules.roll")

def _tool_rules_push(ctx: Ctx, args: dict[str, Any]):
    data, warnings, hints = _roll_common(ctx, args, pushed=True, tool_name="rules.push")
    hints.insert(0, "the recorded failure_consequence is authoritative; apply it if the pushed roll fails")
    return data, warnings, hints

def _tool_rules_roll_dice(ctx: Ctx, args: dict[str, Any]):
    tool_name = "rules.roll_dice"
    decision_id = str(args["decision_id"])
    operation = _roll_dice_semantic_operation(args)
    document, receipt = _existing_roll_receipt(
        ctx,
        tool_name=tool_name,
        decision_id=decision_id,
        operation=operation,
    )
    if receipt is not None:
        return _replay_roll_receipt(ctx, document, receipt)
    result = _rules_resolver(ctx, "roll_dice").roll_dice(
        str(args["expression"]), rng=_rng(args)
    )
    if args.get("reason") is not None:
        result["reason"] = str(args["reason"])
    if args.get("purpose"):
        result["purpose"] = str(args["purpose"])
    payload = {
        **result,
        "die_expression": result["expression"],
        "individual_faces": list(result["rolls"]),
        "final_total": result["total"],
        "roll": result["total"],
    }
    roll_record = ctx.prepare_roll({
        "event_type": "roll",
        "type": "random_table",
        "kind": "dice_expression",
        "actor": "keeper",
        "visibility": "public",
        "payload": payload,
        **result,
    })
    result["roll_id"] = roll_record["roll_id"]
    receipt = _new_roll_receipt(
        tool_name=tool_name,
        decision_id=decision_id,
        operation=operation,
        resolution={
            "expression": result["expression"],
            "count": result["count"],
            "sides": result["sides"],
            "modifier": result["modifier"],
        },
        roll_record=roll_record,
        data=result,
        warnings=[],
        hints=[],
    )
    _commit_new_roll_receipt(ctx, document, receipt)
    return result, [], []

def _tool_rules_opposed(ctx: Ctx, args: dict[str, Any]):
    if args.get("contest_kind") != "noncombat":
        raise ToolError(
            "invalid_param",
            "rules.opposed accepts only contest_kind=noncombat; resolve every "
            "attack, Dodge, or Fight Back through combat.resolve so the "
            "structured defense_kind owns its distinct tie rule",
        )
    prior = ctx.ledger_lookup("rules.opposed", args.get("decision_id"))
    if prior is not None:
        return prior.get("data"), ["duplicate decision_id: returning the previously settled result"], []
    investigator_id = _resolve_investigator(ctx, args)
    target, label, target_source = _resolve_target_value(ctx, investigator_id, args)
    rng = _rng(args)
    settled = _rules_resolver(ctx, "opposed").opposed(
        target, int(args["opponent_value"]), rng=rng
    )
    mine = settled["investigator_roll"]
    theirs = settled["opponent_roll"]
    winner = settled["winner"]
    data = {
        "investigator_id": investigator_id,
        "skill": label,
        "target_source": target_source,
        "investigator_roll": mine,
        "opponent_label": args.get("opponent_label"),
        "opponent_roll": theirs,
        "winner": winner,
    }
    mine_payload = {
        **mine,
        "skill": label,
        "reason": args.get("reason"),
        "opposed_side": "investigator",
        "subject": {"kind": "investigator", "id": investigator_id},
        "contest_winner": winner,
    }
    mine_payload["player_projection"] = coc_roll.build_player_projection(
        mine_payload, include_target=True
    )
    mine_record = ctx.log_roll({
        "event_type": "roll", "kind": "opposed_check", "actor": investigator_id,
        "visibility": "public", "payload": mine_payload, **mine_payload,
    })
    opponent_label = str(args.get("opponent_label") or "opponent")
    their_payload = {
        **theirs,
        "skill": opponent_label,
        "reason": args.get("reason"),
        "opposed_side": "opponent",
        "subject": {"kind": "opponent"},
        "contest_winner": winner,
    }
    their_payload["player_projection"] = coc_roll.build_player_projection(
        their_payload, include_target=False
    )
    their_record = ctx.log_roll({
        "event_type": "roll", "kind": "opposed_check", "actor": opponent_label,
        "visibility": "public", "payload": their_payload, **their_payload,
    })
    data["investigator_roll_id"] = mine_record["roll_id"]
    data["opponent_roll_id"] = their_record["roll_id"]
    ctx.ledger_record(args.get("decision_id"), "rules.opposed", data)
    hints = ["both sides failed: the situation stalls or worsens — narrate movement, not a freeze"] if winner == "none" else []
    for side_label, side_roll_id, side_outcome in (
        ("investigator", mine_record["roll_id"], str(mine.get("outcome") or "")),
        ("opponent", their_record["roll_id"], str(theirs.get("outcome") or "")),
    ):
        if side_outcome in {"critical", "fumble"}:
            hints.append(
                f"{side_label} side settled {side_outcome}: before state.journal apply a "
                f"source-bound {'benefit' if side_outcome == 'critical' else 'cost'} with "
                f"state.exceptional_effect bound to roll_id {side_roll_id}; prose alone "
                "cannot close it (scene_event change_kind must be one of "
                "arrival|escalation|hazard|loss|opening|reversal with a continuing boundary)"
            )
    if target_source == "rulebook_base":
        hints.append(
            f"{label} is not listed on the investigator sheet; used the canonical rulebook base chance {target}%"
        )
    return data, [], hints

def _damage_operation(
    args: dict[str, Any], investigator_id: str, kind: str
) -> dict[str, Any]:
    return {
        "investigator_id": investigator_id,
        "amount": deepcopy(args["amount"]),
        "kind": kind,
        "source": args.get("source"),
        "seed": args.get("seed"),
    }


def _damage_receipt_integrity(receipt: dict[str, Any]) -> str:
    return _canonical_digest({
        key: value for key, value in receipt.items() if key != "integrity_digest"
    })


def _damage_receipts(state: dict[str, Any]) -> dict[str, Any]:
    receipts = state.get(_DAMAGE_RECEIPTS_KEY)
    if receipts is None:
        return {}
    if not isinstance(receipts, dict):
        raise ToolError("state_corrupt", "damage receipt index is invalid")
    return receipts


def _validate_damage_receipt(
    receipt: dict[str, Any],
    *,
    decision_id: str,
    operation: dict[str, Any],
) -> None:
    data = receipt.get("data")
    event = receipt.get("event")
    roll_record = receipt.get("roll_record")
    valid_roll = roll_record is None or (
        isinstance(roll_record, dict)
        and isinstance(data, dict)
        and isinstance(data.get("roll_id"), str)
        and roll_record.get("roll_id") == data.get("roll_id")
    )
    if (
        set(receipt) != set(_DAMAGE_RECEIPT_FIELDS)
        or receipt.get("schema_version") != _DAMAGE_RECEIPT_SCHEMA_VERSION
        or receipt.get("tool") != "rules.damage"
        or receipt.get("decision_id") != decision_id
        or receipt.get("fingerprint")
        != _operation_fingerprint("rules.damage", operation)
        or receipt.get("operation") != operation
        or not isinstance(data, dict)
        or data.get("investigator_id") != operation["investigator_id"]
        or not valid_roll
        or not isinstance(event, dict)
        or event
        != {
            "event_id": _operation_event_id("rules.damage", decision_id),
            "event_type": "hp_change",
            "decision_id": decision_id,
            **deepcopy(data),
        }
        or receipt.get("integrity_digest") != _damage_receipt_integrity(receipt)
    ):
        raise ToolError(
            "state_corrupt",
            f"rules.damage receipt for decision_id {decision_id!r} is invalid",
        )


def _ensure_damage_roll(ctx: Ctx, receipt: dict[str, Any]) -> None:
    expected = receipt.get("roll_record")
    if expected is None:
        return
    roll_id = str(expected["roll_id"])
    matches = [
        row
        for row in _read_jsonl_records(ctx.campaign_dir / "logs" / "rolls.jsonl")
        if row.get("roll_id") == roll_id
    ]
    if not matches:
        ctx.log_roll(deepcopy(expected))
        return
    if len(matches) != 1 or matches[0] != expected:
        raise ToolError(
            "state_corrupt", f"rules.damage roll_id {roll_id!r} is ambiguous"
        )


def _ensure_damage_event(ctx: Ctx, receipt: dict[str, Any]) -> None:
    expected = receipt["event"]
    event_id = str(expected["event_id"])
    matches = [
        row
        for row in _read_jsonl_records(ctx.campaign_dir / "logs" / "events.jsonl")
        if row.get("event_id") == event_id
    ]
    if not matches:
        ctx.log_event(deepcopy(expected))
        return
    normalized = {
        key: value for key, value in matches[0].items() if key != "ts"
    }
    if len(matches) != 1 or normalized != expected:
        raise ToolError(
            "state_corrupt", f"rules.damage event_id {event_id!r} is ambiguous"
        )


def _recover_damage_receipt(ctx: Ctx, receipt: dict[str, Any]) -> None:
    try:
        _ensure_damage_roll(ctx, receipt)
        _ensure_damage_event(ctx, receipt)
        prior = ctx.ledger_lookup("rules.damage", str(receipt["decision_id"]))
        if prior is None:
            ctx.ledger_record(
                str(receipt["decision_id"]),
                "rules.damage",
                deepcopy(receipt["data"]),
            )
        elif prior.get("data") != receipt["data"]:
            raise ToolError(
                "state_corrupt", "toolbox ledger conflicts with damage receipt"
            )
    except ToolError:
        raise
    except Exception as exc:
        raise ToolError(
            "damage_transaction_incomplete",
            "damage is frozen in actor state; retry the same decision_id to repair its evidence",
        ) from exc


def _tool_rules_damage(ctx: Ctx, args: dict[str, Any]):
    investigator_id = _resolve_investigator(ctx, args)
    kind = str(args.get("kind") or "damage")
    if kind not in ("damage", "heal"):
        raise ToolError("invalid_param", "kind must be damage or heal")
    decision_id = str(args.get("decision_id") or "")
    state = ctx.inv_state(investigator_id)
    operation = _damage_operation(args, investigator_id, kind)
    frozen = _damage_receipts(state).get(decision_id)
    prior = ctx.ledger_lookup("rules.damage", decision_id)
    if frozen is not None:
        if not isinstance(frozen, dict):
            raise ToolError("state_corrupt", "damage receipt is not an object")
        _validate_damage_receipt(
            frozen, decision_id=decision_id, operation=operation
        )
        _recover_damage_receipt(ctx, frozen)
        return deepcopy(frozen["data"]), [
            "duplicate decision_id: recovered the state-bound damage receipt"
        ], []
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    sheet = ctx.sheet(investigator_id)
    max_hp = int((sheet.get("derived") or {}).get("HP") or 10)
    before = int(state.get("current_hp", max_hp))
    resolver = _rules_resolver(ctx, "damage")
    settled = resolver.damage(
        args["amount"], before, max_hp, kind=kind, rng=_rng(args)
    )
    amount = settled["amount"]
    detail = settled["roll_detail"]
    after = settled["hp_after"]
    state["current_hp"] = after
    conditions_before = list(state.get("conditions") or [])
    conditions = list(conditions_before)
    hints: list[str] = []
    if kind == "damage":
        if amount >= (max_hp + 1) // 2 and amount > 0:
            if "major_wound" not in conditions:
                conditions.append("major_wound")
            hints.append("major wound: single hit >= half max HP — CON check or fall unconscious; healing is slowed")
        if after == 0:
            if "major_wound" in conditions:
                if "dying" not in conditions:
                    conditions.append("dying")
                hints.append("0 HP with a major wound: dying — needs First Aid to stabilize, then Medicine")
            else:
                if "unconscious" not in conditions:
                    conditions.append("unconscious")
                hints.append("0 HP without a major wound: unconscious, not dying")
    else:
        if after > 0:
            for gone in ("dying", "unconscious"):
                if gone in conditions:
                    conditions.remove(gone)
    state["conditions"] = conditions
    data = {
        "investigator_id": investigator_id,
        "kind": kind,
        "amount": amount,
        "roll_detail": detail,
        "hp_before": before,
        "hp_after": after,
        "max_hp": max_hp,
        "conditions_before": conditions_before,
        "conditions_after": list(conditions),
        "conditions": conditions,
        "source": args.get("source"),
    }
    damage_record = None
    if detail is not None:
        damage_payload = {
            **detail,
            "die_expression": detail["expression"],
            "individual_faces": list(detail["rolls"]),
            "final_total": amount,
            "roll": amount,
            "hp_before": before,
            "hp_after": after,
            "source": args.get("source"),
        }
        damage_record = ctx.prepare_roll({
            "event_type": "roll",
            "type": "damage" if kind == "damage" else "healing",
            "kind": f"hp_{kind}",
            "actor": investigator_id,
            "visibility": "consequence_public",
            "payload": damage_payload,
            **damage_payload,
        })
        data["roll_id"] = damage_record["roll_id"]
    if kind == "damage" and before - after > 0:
        elapsed = _current_elapsed_minutes(ctx)
        if elapsed is None:
            raise ToolError(
                "state_corrupt",
                "campaign clock cannot provide authoritative injury time",
            )
        try:
            state = coc_rulesets.apply_damage_state_effect(
                resolver,
                state,
                {
                    "schema_version": 1,
                    "actor_id": investigator_id,
                    "decision_id": decision_id,
                    "amount": int(amount),
                    "before": before,
                    "after": after,
                    "maximum": max_hp,
                    "occurred_elapsed_minutes": elapsed,
                    "source_event_id": (
                        str(damage_record["roll_id"])
                        if isinstance(damage_record, dict)
                        else None
                    ),
                },
            )
        except ValueError as exc:
            raise ToolError("state_corrupt", str(exc)) from exc
    receipt = {
        "schema_version": _DAMAGE_RECEIPT_SCHEMA_VERSION,
        "tool": "rules.damage",
        "decision_id": decision_id,
        "fingerprint": _operation_fingerprint("rules.damage", operation),
        "operation": deepcopy(operation),
        "data": deepcopy(data),
        "roll_record": deepcopy(damage_record),
        "event": {
            "event_id": _operation_event_id("rules.damage", decision_id),
            "event_type": "hp_change",
            "decision_id": decision_id,
            **deepcopy(data),
        },
    }
    receipt["integrity_digest"] = _damage_receipt_integrity(receipt)
    receipts = _damage_receipts(state)
    receipts[decision_id] = receipt
    while len(receipts) > _DAMAGE_RECEIPT_LIMIT:
        oldest = next(iter(receipts))
        if oldest == decision_id:
            break
        receipts.pop(oldest)
    state[_DAMAGE_RECEIPTS_KEY] = receipts
    try:
        ctx.save_inv_state(investigator_id, state)
    except Exception as exc:
        raise ToolError(
            "damage_transaction_incomplete",
            "damage actor-state receipt could not be committed; retry the same decision_id",
        ) from exc
    _recover_damage_receipt(ctx, receipt)
    return data, [], hints

def _luck_source_receipt_by_roll_id(
    ctx: Ctx,
    document: dict[str, Any],
    source_roll_id: str,
) -> dict[str, Any]:
    found: list[dict[str, Any]] = []
    for by_tool in (document.get("receipts") or {}).values():
        if not isinstance(by_tool, dict):
            raise ToolError("state_corrupt", "canonical roll receipt map is invalid")
        found.extend(
            receipt
            for receipt in by_tool.values()
            if isinstance(receipt, dict)
            and receipt.get("roll_id") == source_roll_id
        )
    if len(found) != 1:
        raise ToolError(
            "invalid_param",
            "source_roll_id does not identify one current canonical roll receipt",
        )
    source = found[0]
    if source.get("tool") != "rules.roll":
        raise ToolError(
            "invalid_param",
            "source roll is ineligible for Luck adjustment",
        )
    if source.get("operation", {}).get("combined_targets") is not None:
        raise ToolError(
            "invalid_param",
            "combined skill rolls are ineligible for Luck adjustment",
        )
    if _roll_side_effect_key(source) in document.get("pending_side_effects", {}):
        raise ToolError(
            "invalid_param",
            "source roll is not yet a fully settled current receipt",
        )
    raw = _roll_log_bytes(ctx)
    ordered, _by_effect_key = _validated_roll_document_collection(document)
    _verify_roll_receipt_prefixes(raw, ordered)
    complete, tail, index = _parse_complete_roll_frames(raw)
    if tail or complete != raw or index.get(source_roll_id) != source.get("roll_record"):
        raise ToolError(
            "state_corrupt",
            "source_roll_id is stale or diverges from its canonical public row",
        )
    if source.get("roll_record", {}).get("visibility") != "public":
        raise ToolError("invalid_param", "hidden rolls are ineligible for Luck")
    return source

def _ensure_luck_spend_receipt_effects(
    ctx: Ctx,
    receipt: dict[str, Any],
) -> None:
    expected_event = receipt["event"]
    events_path = ctx.campaign_dir / "logs" / "events.jsonl"
    matches = [
        row
        for row in _read_jsonl_records(events_path)
        if row.get("event_id") == expected_event["event_id"]
    ]
    if len(matches) > 1:
        raise ToolError("state_corrupt", "Luck spend event is duplicated")
    if matches:
        material = {key: value for key, value in matches[0].items() if key != "ts"}
        if material != expected_event:
            raise ToolError("state_corrupt", "Luck spend event contradicts its receipt")
    else:
        investigator_id = str(receipt["operation"]["investigator_id"])
        state = ctx.inv_state(investigator_id)
        current = state.get("current_luck")
        before = receipt["data"]["luck_before"]
        after = receipt["data"]["luck_after"]
        if not _is_exact_int(current) or current not in {before, after}:
            raise ToolError(
                "state_corrupt",
                "Luck state diverges from the pending adjustment receipt",
            )
        if current == before:
            state["current_luck"] = after
            ctx.save_inv_state(investigator_id, state)
        ctx.log_event(deepcopy(expected_event))
    manifest = _source_receipt_manifest(receipt)
    prior = ctx.ledger_lookup("rules.luck_spend", str(receipt["decision_id"]))
    if (
        prior is None
        or prior.get("data") != receipt["data"]
        or prior.get("source_receipt_manifest") != manifest
    ):
        ctx.ledger_record(
            str(receipt["decision_id"]),
            "rules.luck_spend",
            deepcopy(receipt["data"]),
            source_receipt_manifest=manifest,
        )

def _tool_rules_luck_spend(ctx: Ctx, args: dict[str, Any]):
    allowed = {"investigator", "points", "source_roll_id", "decision_id"}
    if set(args) - allowed or any(key not in args for key in ("points", "source_roll_id", "decision_id")):
        raise ToolError(
            "invalid_param",
            "rules.luck_spend requires only source_roll_id, points, decision_id, and optional investigator",
        )
    points = args.get("points")
    source_roll_id = args.get("source_roll_id")
    decision_id = args.get("decision_id")
    if not _is_exact_int(points) or points <= 0:
        raise ToolError("invalid_param", "points must be a positive integer")
    if not isinstance(source_roll_id, str) or not source_roll_id.strip():
        raise ToolError("invalid_param", "source_roll_id must be a non-empty string")
    if not isinstance(decision_id, str) or not decision_id.strip():
        raise ToolError("invalid_param", "decision_id must be a non-empty string")
    investigator_id = _resolve_investigator(ctx, args)
    operation = {
        "investigator_id": investigator_id,
        "source_roll_id": source_roll_id,
        "points": points,
    }
    document = _load_roll_receipt_document(ctx)
    existing = _luck_spend_receipt(document, decision_id)
    if existing is not None:
        if existing.get("fingerprint") != _operation_fingerprint(
            "rules.luck_spend", operation
        ):
            raise ToolError(
                "idempotency_conflict",
                f"decision_id '{decision_id}' was already applied to a different Luck adjustment",
            )
        source = _luck_source_receipt_by_roll_id(
            ctx,
            document,
            source_roll_id,
        )
        if existing.get("source_receipt") != _luck_source_reference(source):
            raise ToolError(
                "state_corrupt",
                "Luck adjustment receipt diverges from its current canonical source receipt",
            )
        _ensure_luck_spend_receipt_effects(ctx, existing)
        return deepcopy(existing["data"]), [
            "duplicate decision_id: recovered the original Luck source receipt"
        ], []
    if ctx.ledger_lookup("rules.luck_spend", decision_id) is not None:
        raise ToolError(
            "state_corrupt",
            "Luck ledger entry has no canonical adjustment receipt",
        )
    if any(
        receipt.get("source_receipt", {}).get("roll_id") == source_roll_id
        for receipt in document["luck_spends"].values()
        if isinstance(receipt, dict)
    ):
        raise ToolError("invalid_param", "source roll was already adjusted with Luck")
    source = _luck_source_receipt_by_roll_id(ctx, document, source_roll_id)
    if source.get("resolution", {}).get("investigator_id") != investigator_id:
        raise ToolError("invalid_param", "source roll belongs to another investigator")
    try:
        finalized_by = next(
            (
                receipt
                for receipt in coc_turn_finalization.load_finalizations(
                    ctx.campaign_dir
                )
                if source_roll_id in (receipt.get("source_roll_ids") or [])
            ),
            None,
        )
    except coc_turn_finalization.TurnContractError as exc:
        raise ToolError(exc.code, str(exc)) from exc
    if finalized_by is not None:
        raise ToolError(
            "invalid_state",
            "source roll is already frozen in a turn finalization; offer Luck "
            "before turn.finalize, or use state.supersede_settlement for an "
            "explicit correction",
        )
    state = ctx.inv_state(investigator_id)
    current_luck = state.get("current_luck")
    if not _is_exact_int(current_luck) or current_luck < 0:
        raise ToolError("state_corrupt", "current_luck must be a non-negative integer")
    try:
        adjusted = _luck_spend_data(
            source,
            points=points,
            luck_before=current_luck,
            resolver=_rules_resolver(ctx, "luck_spend"),
        )
    except ValueError as exc:
        raise ToolError("invalid_param", str(exc)) from exc
    receipt = _new_luck_spend_receipt(
        decision_id=decision_id,
        operation=operation,
        source_receipt=source,
        data=adjusted,
    )
    document["luck_spends"][decision_id] = deepcopy(receipt)
    _validated_roll_document_collection(document)
    _save_roll_receipt_document(ctx, document)
    _ensure_luck_spend_receipt_effects(ctx, receipt)
    return deepcopy(adjusted), [], []

def _healing_tool_data(
    ctx: Ctx,
    investigator_id: str,
    results: list[dict[str, Any]],
    events: list[dict[str, Any]],
    *,
    state_before: dict[str, Any] | None = None,
) -> dict[str, Any]:
    state = ctx.inv_state(investigator_id)
    primary = next(
        (
            deepcopy(event)
            for event in events
            if event.get("event_type")
            in {
                "first_aid",
                "first_aid_stabilize",
                "medicine",
                "healing_skipped",
                "dying_con_roll",
                "stabilized_con_roll",
                "major_wound_recovery",
            }
        ),
        None,
    )
    data = {
        "investigator_id": investigator_id,
        "event": primary,
        "results": results,
        "events": events,
        "current_hp": state.get("current_hp"),
        "conditions": list(state.get("conditions") or []),
    }
    if isinstance(state_before, dict):
        data["player_state_receipt"] = {
            "schema_version": 1,
            "investigator_id": investigator_id,
            "hp": {
                "before": state_before.get("current_hp"),
                "after": state.get("current_hp"),
            },
            "conditions_before": list(state_before.get("conditions") or []),
            "conditions_after": list(state.get("conditions") or []),
        }
    return data

def _tool_rules_settle(ctx: Ctx, args: dict[str, Any]):
    def social_adjudicate(active_ctx: Ctx, active_args: dict[str, Any]):
        # Loaded after this operation cell; resolve lazily from the shared
        # kernel namespace so graph settlement reuses the canonical tool.
        from coc_operation_kernel_runtime import _tool_rules_social_adjudicate
        return _tool_rules_social_adjudicate(active_ctx, active_args)

    def psychology_observe(active_ctx: Ctx, active_args: dict[str, Any]):
        from coc_operation_kernel_runtime import _tool_rules_psychology_observe
        return _tool_rules_psychology_observe(active_ctx, active_args)

    def combat_resolve(active_ctx: Ctx, active_args: dict[str, Any]):
        from coc_operation_kernel_runtime import _tool_combat_resolve
        return _tool_combat_resolve(active_ctx, active_args)

    def combat_end(active_ctx: Ctx, active_args: dict[str, Any]):
        from coc_operation_kernel_runtime import _tool_combat_end
        return _tool_combat_end(active_ctx, active_args)

    def sanity_check(active_ctx: Ctx, active_args: dict[str, Any]):
        from coc_operation_kernel_runtime import _tool_rules_sanity_check
        return _tool_rules_sanity_check(active_ctx, active_args)

    def sanity_execute(active_ctx: Ctx, active_args: dict[str, Any]):
        from coc_operation_kernel_runtime import _tool_sanity_execute
        return _tool_sanity_execute(active_ctx, active_args)

    return dispatch_rules_settle(
        ctx,
        args,
        adapters={
            "first_aid": _tool_rules_first_aid,
            "medicine": _tool_rules_medicine,
            "dying_check": _tool_rules_dying_check,
            "weekly_recovery": _tool_rules_weekly_recovery,
            "check": _tool_rules_roll,
            "opposed": _tool_rules_opposed,
            "push_policy": _tool_rules_push,
            "luck_spend": _tool_rules_luck_spend,
            "social_difficulty": social_adjudicate,
            "psychology_check_contract": psychology_observe,
            "psychology_policy": psychology_observe,
            "combat.resolve": combat_resolve,
            "combat.end": combat_end,
            "rules.sanity_check": sanity_check,
            "sanity.execute": sanity_execute,
            "sanity.session.gain_san": sanity_execute,
            "sanity.session.reality_check": sanity_execute,
            "sanity.context": sanity_execute,
            "time.recover_temporary_insanity": sanity_execute,
            "time.apply_psychoanalysis_treatment": sanity_execute,
        },
    )


def _tool_rules_context(ctx: Ctx, args: dict[str, Any]):
    return dispatch_rules_context(ctx, args)


def _tool_rules_first_aid(ctx: Ctx, args: dict[str, Any]):
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup("rules.first_aid", decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    investigator_id = _resolve_investigator(ctx, args)
    state_before = deepcopy(ctx.inv_state(investigator_id))
    rescuer_id = str(args.get("rescuer_id") or investigator_id)
    pushed = args.get("pushed", False)
    if not isinstance(pushed, bool):
        raise ToolError("invalid_param", "pushed must be boolean")
    if pushed:
        for field in ("changed_method", "failure_consequence"):
            if not isinstance(args.get(field), str) or not args[field].strip():
                raise ToolError(
                    "missing_param",
                    f"pushed First Aid requires non-empty {field}",
                )
    request = _rules_resolver(ctx, "first_aid").first_aid(
        decision_id,
        int(args["skill_value"]),
        rescuer_id,
        pushed=pushed,
        changed_method=(
            str(args["changed_method"]).strip() if pushed else None
        ),
        failure_consequence=(
            str(args["failure_consequence"]).strip() if pushed else None
        ),
        assistant_skill_value=(
            int(args["assistant_skill_value"])
            if args.get("assistant_skill_value") is not None
            else None
        ),
        assistant_rescuer_id=(
            str(args["assistant_rescuer_id"])
            if args.get("assistant_rescuer_id") is not None
            else None
        ),
    )
    results, events = _execute_subsystem_requests(
        ctx,
        investigator_id=investigator_id,
        decision_id=decision_id,
        requests=[request],
        seed=args.get("seed"),
        tool_name="rules.first_aid",
    )
    data = _healing_tool_data(
        ctx,
        investigator_id,
        results,
        events,
        state_before=state_before,
    )
    data["rescuer_id"] = rescuer_id
    conditions = set(data["conditions"])
    hints: list[str] = []
    if "stabilized" in conditions and "dying" in conditions:
        hints.append(
            "stabilized at temporary HP: use rules.dying_check(clock_kind=hour) "
            "for each elapsed hour until successful rules.medicine clears the dying chain"
        )
    elif "dying" in conditions:
        hints.append(
            "First Aid did not stabilize the investigator; resolve the end-of-round "
            "rules.dying_check(clock_kind=round) before further fiction advances"
        )
    ctx.ledger_record(decision_id, "rules.first_aid", data)
    return data, [], hints

def _tool_rules_medicine(ctx: Ctx, args: dict[str, Any]):
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup("rules.medicine", decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    investigator_id = _resolve_investigator(ctx, args)
    state_before = deepcopy(ctx.inv_state(investigator_id))
    rescuer_id = str(args.get("rescuer_id") or investigator_id)
    results, events = _execute_subsystem_requests(
        ctx,
        investigator_id=investigator_id,
        decision_id=decision_id,
        requests=[_rules_resolver(ctx, "medicine").medicine(
            decision_id,
            int(args["skill_value"]),
            rescuer_id,
        )],
        seed=args.get("seed"),
        tool_name="rules.medicine",
    )
    data = _healing_tool_data(
        ctx,
        investigator_id,
        results,
        events,
        state_before=state_before,
    )
    data["rescuer_id"] = rescuer_id
    conditions = set(data["conditions"])
    hints: list[str] = []
    if "stabilized" in conditions and "dying" in conditions:
        hints.append(
            "Medicine did not clear the dying chain; keep resolving "
            "rules.dying_check(clock_kind=hour) while the temporary stabilization lasts"
        )
    elif "dying" not in conditions:
        hints.append("the dying chain is cleared; ordinary recovery can now proceed")
    ctx.ledger_record(decision_id, "rules.medicine", data)
    return data, [], hints

def _tool_rules_weekly_recovery(ctx: Ctx, args: dict[str, Any]):
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup("rules.weekly_recovery", decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    investigator_id = _resolve_investigator(ctx, args)
    state_before = deepcopy(ctx.inv_state(investigator_id))
    complete_rest = args["complete_rest"]
    poor_environment = args["poor_environment"]
    if not isinstance(complete_rest, bool) or not isinstance(
        poor_environment, bool
    ):
        raise ToolError(
            "invalid_param", "complete_rest and poor_environment must be boolean"
        )
    if complete_rest and poor_environment:
        raise ToolError(
            "invalid_param",
            "complete_rest and poor_environment are mutually exclusive",
        )
    has_medicine = args.get("medicine_skill_value") is not None
    if not has_medicine and args.get("caregiver_id") is not None:
        raise ToolError(
            "invalid_param", "caregiver_id requires medicine_skill_value"
        )
    request = _rules_resolver(ctx, "weekly_recovery").weekly_recovery(
        decision_id,
        complete_rest,
        poor_environment,
        medicine_skill_value=(
            int(args["medicine_skill_value"]) if has_medicine else None
        ),
        caregiver_id=(
            str(args.get("caregiver_id") or investigator_id)
            if has_medicine
            else None
        ),
    )
    results, events = _execute_subsystem_requests(
        ctx,
        investigator_id=investigator_id,
        decision_id=decision_id,
        requests=[request],
        seed=args.get("seed"),
        tool_name="rules.weekly_recovery",
    )
    data = _healing_tool_data(
        ctx,
        investigator_id,
        results,
        events,
        state_before=state_before,
    )
    state = ctx.inv_state(investigator_id)
    data["major_wound_recovery_ledger"] = deepcopy(
        state.get("major_wound_recovery_ledger") or []
    )
    outcome = (data.get("event") or {}).get("outcome")
    conditions = set(data["conditions"])
    hints: list[str] = []
    if "major_wound" not in conditions:
        hints.append(
            "the major wound is cleared; do not submit another weekly recovery for this wound"
        )
    else:
        hints.append(
            "the major wound remains; another recovery roll is unavailable until one more full game week elapses"
        )
    if outcome == "fumble":
        hints.append(
            "record the structured lasting-injury consequence in Wounds & Scars"
        )
    ctx.ledger_record(decision_id, "rules.weekly_recovery", data)
    return data, [], hints

def _tool_rules_dying_check(ctx: Ctx, args: dict[str, Any]):
    decision_id = str(args["decision_id"])
    prior = ctx.ledger_lookup("rules.dying_check", decision_id)
    if prior is not None:
        return prior.get("data"), [
            "duplicate decision_id: returning the previously settled result"
        ], []
    investigator_id = _resolve_investigator(ctx, args)
    state_before = deepcopy(ctx.inv_state(investigator_id))
    clock_kind = str(args["clock_kind"])
    results, events = _execute_subsystem_requests(
        ctx,
        investigator_id=investigator_id,
        decision_id=decision_id,
        requests=[
            _rules_resolver(ctx, "dying_check").dying_check(
                decision_id, clock_kind
            )
        ],
        seed=args.get("seed"),
        tool_name="rules.dying_check",
    )
    data = _healing_tool_data(
        ctx,
        investigator_id,
        results,
        events,
        state_before=state_before,
    )
    conditions = set(data["conditions"])
    hints: list[str] = []
    if "dead" in conditions:
        hints.append("the death clock failed: the investigator is dead")
    elif "stabilized" not in conditions and "dying" in conditions and clock_kind == "hour":
        hints.append(
            "the temporary stabilization deteriorated: First Aid is required again; "
            "because this is the same wound, submit it as a pushed attempt"
        )
    elif "dying" in conditions:
        hints.append(
            "the investigator holds on and a new round begins; the dying chain "
            "remains active, and any later First Aid attempt on the same wound is pushed"
        )
    ctx.ledger_record(decision_id, "rules.dying_check", data)
    return data, [], hints

def register_operations(registry) -> None:
    rule_graph_adapter = coc_rulesets.get_rule_graph_adapter(
        coc_rulesets.DEFAULT_RULESET_ID
    )
    rule_settle_schema = (
        rule_graph_adapter.settle_schema() if rule_graph_adapter is not None else {}
    )
    rule_context_schema = (
        rule_graph_adapter.context_schema() if rule_graph_adapter is not None else {}
    )
    global TOOLS
    TOOLS = registry.legacy_tools
    registry.tool(
    "rules.check",
    "Low-level ruleset-package integration primitive, not an investigator skill or characteristic check. Live Keepers use rules.roll for ordinary investigator checks and rules.psychology_observe for concealed Psychology observation; rules.skill_check does not exist. This primitive persists canonical public roll evidence from an exact package-native request signature.",
    {
        "actor": {
            "type": "string",
            "required": True,
            "desc": "campaign actor id created through the active ruleset setup path",
        },
        "request": {
            "type": "object",
            "required": True,
            "desc": "exact package-native low-level check kwargs (rng is injected); do not pass investigator skill or skill_id here",
        },
        "decision_id": {
            "type": "string",
            "required": True,
            "desc": "idempotency key",
        },
    },
)(_tool_rules_check)
    registry.tool(
    "rules.resource_delta",
    "Apply the active ruleset's generic resource arithmetic to canonical actor state. Current state is kernel-owned; callers provide only the requested change.",
    {
        "actor": {
            "type": "string",
            "required": True,
            "desc": "campaign actor id whose canonical resource state changes",
        },
        "request": {
            "type": "object",
            "required": True,
            "desc": "package-defined resource_delta arguments; current/rng and identity fields are kernel-reserved",
        },
        "decision_id": {
            "type": "string",
            "required": True,
            "desc": "idempotency key",
        },
    },
)(_tool_rules_resource_delta)
    registry.tool(
    "rules.skill_describe",
    "Fetch Keeper-facing skill prose from rules-json/skill-descriptions.json after the KP has narrowed candidate skills. Read-only; does not roll.",
    {
        "skill": {
            "type": "string",
            "desc": "optional canonical skill name (e.g. 'Persuade'); omit with include_selection_policy to list known entries",
        },
        "skills": {
            "type": "array",
            "desc": "optional list of candidate skill names to fetch together (e.g. interpersonal shortlist)",
        },
        "include_selection_policy": {
            "type": "boolean",
            "desc": "when true, include the interpersonal disambiguation policy (default true when fetching Charm/Fast Talk/Intimidate/Persuade)",
        },
    },
    needs_campaign=False,
    access="query",
    write_domains=(),
    recovery_domains=(),
    response_mode="full",
    audit_mode="reference",
    strict_read_only=True,
    execution_class="parallel_read",
)(_tool_rules_skill_describe)
    registry.tool(
    "rules.catalog_search",
    "Keeper-only advisory catalog candidate recall for weapons, spells, creatures, and other table entities. Returns candidates with match reasons; never auto-selects entity_id. Secret rows stay secret:true and must not be dumped to players.",
    {
        "query": {
            "type": "string",
            "required": True,
            "desc": "ID/name-like search text (structured tokens; digits kept)",
        },
        "kinds": {
            "type": "array",
            "desc": "optional kind filters (weapon, spell, creature, …)",
        },
        "era": {
            "type": "string",
            "desc": "optional era filter such as 1920s or modern",
        },
        "limit": {
            "type": "integer",
            "desc": "max candidates (1-50, default 20)",
        },
    },
    needs_campaign=False,
    access="query",
    recovery_domains=(),
)(_tool_rules_catalog_search)
    registry.tool(
    "rules.build_scale",
    "Comparative build scale and lift/throw capability (Table XV, p.279). Read-only lookup; use when size shapes the fiction — who can lift, carry, or throw whom, and how big something reads.",
    {
        "build": {"type": "integer", "desc": "single build value to look up scale examples for"},
        "actor_build": {"type": "integer", "desc": "acting being's build; with target_build, returns the lift/throw and maneuver verdict"},
        "target_build": {"type": "integer", "desc": "target being/object's build"},
    },
    needs_campaign=False,
)(_tool_rules_build_scale)
    registry.tool(
    "rules.roll",
    "Contextual percentile skill/characteristic check for NON-COMBAT, non-Psychology tasks. Optional combined_targets performs one public D100 roll for one investigator against two or more semantic target labels; the caller must choose any or all with combined_mode, and overall success follows that declared mode. Combined rolls cannot be Pushed, adjusted with Luck, or earn development ticks. Psychology observation must use rules.psychology_observe so its die/outcome stay Keeper-concealed and its conversation window reuses the first settlement. Attacks, shots, Dodge-in-combat, and Fight Back must use combat.resolve — never this tool and never unrolled hit/damage prose.",
    {
        "investigator": {"type": "string", "desc": "investigator id (optional when party has one member)"},
        "skill": {"type": "string", "desc": "skill name on the sheet (e.g. 'Library Use')"},
        "characteristic": {"type": "string", "desc": "characteristic (STR/CON/.../SAN/LUCK) instead of a skill"},
        "target": {"type": "integer", "desc": "explicit target value override"},
        "combined_targets": {
            "type": "array",
            "minItems": 2,
            "maxItems": 8,
            "desc": "optional combined-skill mode: two or more unique semantic {label, value} targets; mutually exclusive with skill, characteristic, target, Psychology, and combat actions",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string", "minLength": 1, "maxLength": 120, "desc": "meaning-bearing skill or characteristic label"},
                    "value": {"type": "integer", "minimum": 1, "maximum": 100, "desc": "authoritative percentile target from the sheet or current context"},
                },
                "required_fields": ["label", "value"],
                "additionalProperties": False,
            },
        },
        "combined_mode": {"type": "string", "enum": ["any", "all"], "desc": "required with combined_targets: whether any named target or every named target must succeed"},
        "difficulty": {"type": "string", "required": True, "enum": ["regular", "hard", "extreme"], "desc": "required success level: regular | hard | extreme; never inferred or defaulted"},
        "goal": {"type": "string", "required": True, "desc": "the concrete fictional objective this one check may settle"},
        "stakes": {"type": "object", "required": True, "desc": "exactly {on_success, on_failure}, both non-empty player-action consequences", "properties": {"on_success": {"type": "string"}, "on_failure": {"type": "string"}}, "required_fields": ["on_success", "on_failure"]},
        "difficulty_basis": {"type": "string", "required": True, "enum": ["authored_gate", "opponent_skill", "environment", "keeper_judgment"], "desc": "a plain string (NOT an object): why this difficulty applies. authored_gate=module预设 | opponent_skill=对抗检定 | environment=环境因素 | keeper_judgment=KP判断"},
        "bonus": {"type": "integer", "desc": "bonus dice 0-2"},
        "penalty": {"type": "integer", "desc": "penalty dice 0-2"},
        "reason": {"type": "string", "desc": "optional audit note distinct from the authoritative goal/stakes contract"},
        "npc_id": {"type": "string", "desc": "structured NPC target for a social check; required to match/consume an NPC-scoped relationship reward"},
        "social_adjudication_ref": {"type": "string", "desc": "goal_key returned by rules.social_adjudicate; required for that social commitment and consumed by its one canonical roll"},
        "visibility": {"type": "string", "enum": ["public", "keeper_only"], "desc": "roll visibility: public (default, rendered to the player) | keeper_only (concealed; recorded for audit, never rendered)"},
        "fumble_consequence": {
            "type": "string",
            "desc": "predeclared meaningful complication if this roll fumbles (dice evidence)",
        },
        "resolution_context": {
            "type": "object",
            "desc": (
                "optional KP-supplied structured continuity identity: attempt_id, "
                "scene_id, route_id, roll_density_group, and optional reset_evidence. "
                "Used only for soft Push/retry/route advice; never blocks the roll"
            ),
        },
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key"},
    },
)(_tool_rules_roll)
    registry.tool(
    "rules.push",
    "Pushed re-roll bound to one ordinary-failure rules.roll receipt (never a fumble). Inherits that check's actor, target, required level, goal, stakes, basis, and dice modifiers; callers cannot substitute them.",
    {
        "original_check_decision_id": {"type": "string", "required": True, "desc": "decision_id of the failed canonical rules.roll to push"},
        "method_changed": {"type": "string", "required": True, "desc": "how the approach differs from the first attempt"},
        "failure_consequence": {
            "type": "string",
            "required": True,
            "desc": "specific failure consequence announced to the player before the pushed roll",
        },
        "fumble_consequence": {
            "type": "string",
            "desc": "specific escalation if the pushed roll fumbles",
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_rules_push)
    registry.tool(
    "rules.roll_dice",
    "Roll an arbitrary dice expression (e.g. '1D6+1') for damage, SAN loss amounts, or randomization.",
    {
        "expression": {"type": "string", "required": True, "desc": "NdM(+/-k) expression"},
        "reason": {"type": "string", "desc": "what the roll is for (logged)"},
        "purpose": {
            "type": "string",
            "enum": sorted(_CHARGEN_DICE_PURPOSES),
            "desc": (
                "closed semantic purpose for typed rolls; use "
                "investigator_creation_luck for the Quick-Fire Luck source "
                "and investigator_creation_characteristic for each 3D6 "
                "characteristic roll. Receipts are keyed by decision_id, "
                "never by purpose alone"
            ),
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_rules_roll_dice)
    registry.tool(
    "rules.opposed",
    "NON-COMBAT opposed check only: higher success level wins; ties favor the higher value. Attacks, Dodge, and Fight Back must use combat.resolve.",
    {
        "contest_kind": {
            "type": "string",
            "required": True,
            "desc": "must be noncombat; combat reactions use combat.resolve defense_kind",
        },
        "investigator": {"type": "string", "desc": "investigator id"},
        "skill": {"type": "string", "desc": "investigator skill"},
        "characteristic": {"type": "string", "desc": "characteristic instead of a skill"},
        "target": {"type": "integer", "desc": "explicit investigator target override"},
        "opponent_value": {"type": "integer", "required": True, "desc": "opponent's skill/characteristic value"},
        "opponent_label": {"type": "string", "desc": "opponent description (logged)"},
        "reason": {"type": "string", "desc": "what the contest is about"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_rules_opposed)
    registry.tool(
    "rules.damage",
    "Apply damage or healing to an investigator's HP. Amount may be an integer or a dice expression.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "amount": {"type": "string", "required": True, "desc": "integer or dice expression (e.g. '1D6+1')"},
        "kind": {"type": "string", "desc": "damage | heal (default damage)"},
        "source": {"type": "string", "desc": "what caused it (logged)"},
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_rules_damage)
    registry.tool(
    "rules.luck_spend",
    "Bind Luck spending to one existing canonical public rules.roll receipt; adjusts its settlement without creating another dice row.",
    {
        "investigator": {"type": "string", "desc": "investigator id"},
        "points": {"type": "integer", "required": True, "desc": "positive Luck points to spend"},
        "source_roll_id": {"type": "string", "required": True, "desc": "roll_id of the current canonical failed rules.roll receipt"},
        "decision_id": {"type": "string", "required": True, "desc": "idempotency key"},
    },
)(_tool_rules_luck_spend)
    registry.tool(
    "rules.first_aid",
    "Resolve canonical First Aid, including stabilization at 0 HP, through the transactional healing engine.",
    {
        "investigator": {"type": "string", "desc": "injured investigator id"},
        "skill_value": {
            "type": "integer",
            "required": True,
            "desc": "First Aid value of the acting rescuer (1..100)",
        },
        "rescuer_id": {
            "type": "string",
            "desc": "stable actor id for roll evidence (defaults to the investigator)",
        },
        "pushed": {
            "type": "boolean",
            "desc": "true for second/subsequent attempts after an earlier First Aid roll",
        },
        "changed_method": {
            "type": "string",
            "desc": "what materially changes on the pushed First Aid attempt",
        },
        "failure_consequence": {
            "type": "string",
            "desc": "consequence announced before the pushed attempt",
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_rules_first_aid)
    registry.tool(
    "rules.medicine",
    "Resolve canonical Medicine treatment, including clearing a stabilized dying state and its 1D3 healing.",
    {
        "investigator": {"type": "string", "desc": "injured investigator id"},
        "skill_value": {
            "type": "integer",
            "required": True,
            "desc": "Medicine value of the acting caregiver (1..100)",
        },
        "rescuer_id": {
            "type": "string",
            "desc": "stable actor id for roll evidence (defaults to the investigator)",
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_rules_medicine)
    registry.tool(
    "rules.weekly_recovery",
    "Resolve one due major-wound recovery week from authoritative game time, with optional weekly medical care and complete dice evidence.",
    {
        "investigator": {"type": "string", "desc": "recovering investigator id"},
        "complete_rest": {
            "type": "boolean",
            "required": True,
            "desc": "true only when the investigator had complete comfortable rest for the interval",
        },
        "poor_environment": {
            "type": "boolean",
            "required": True,
            "desc": "true when the recovery environment or rest was inadequate",
        },
        "medicine_skill_value": {
            "type": "integer",
            "desc": "optional caregiver Medicine value (1..100) for this week's care roll",
        },
        "caregiver_id": {
            "type": "string",
            "desc": "stable caregiver id; defaults to the investigator when Medicine is supplied",
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_rules_weekly_recovery)
    registry.tool(
    "rules.dying_check",
    "Resolve the canonical CON death clock for a dying or temporarily stabilized investigator.",
    {
        "investigator": {"type": "string", "desc": "dying investigator id"},
        "clock_kind": {
            "type": "string",
            "required": True,
            "desc": "round while unstabilized; hour while stabilized",
        },
        "decision_id": {"type": "string", "desc": "idempotency key"},
    },
)(_tool_rules_dying_check)
    registry.tool(
    "rules.settle",
    "Settle one graph-owned rule decision card through the canonical resolver/subsystem path. Host-locked fields are absent; the runtime rechecks grant, state, and family ownership at execute time.",
    rule_settle_schema,
)(_tool_rules_settle)
    registry.tool(
    "rules.context",
    "Exact-discovery RuleGraph context for one compiled family. Absent from ordinary play working sets; load only by exact operation name. Cards are affordances, never action gates.",
    rule_context_schema,
    access="query",
    read_domains=("party", "mechanics"),
    recovery_domains=(),
    response_mode="full",
    audit_mode="reference",
    strict_read_only=True,
    execution_class="parallel_read",
)(_tool_rules_context)


OPERATION_EXPORTS = (
    '_DICE_MULTIPLIER_PATTERN',
    '_RULESET_REQUEST_RESERVED_FIELDS',
    '_ensure_luck_spend_receipt_effects',
    '_generic_check_resolution',
    '_healing_tool_data',
    '_luck_source_receipt_by_roll_id',
    '_luck_spend_receipt',
    '_new_luck_spend_receipt',
    '_resource_receipt_integrity',
    '_roll_dice_semantic_operation',
    '_ruleset_mutation_identity',
    '_tool_rules_build_scale',
    '_tool_rules_catalog_search',
    '_tool_rules_check',
    '_tool_rules_context',
    '_tool_rules_damage',
    '_tool_rules_dying_check',
    '_tool_rules_first_aid',
    '_tool_rules_luck_spend',
    '_tool_rules_medicine',
    '_tool_rules_settle',
    '_tool_rules_opposed',
    '_tool_rules_push',
    '_tool_rules_resource_delta',
    '_tool_rules_roll',
    '_tool_rules_roll_dice',
    '_tool_rules_skill_describe',
    '_tool_rules_weekly_recovery',
    '_unsupported_dice_expression_message',
    'coc_catalog',
)
