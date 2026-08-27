#!/usr/bin/env python3
"""COC Keeper toolbox: the LLM-facing tool registry.

The keeper LLM drives every turn. It decides which tools to call based on
context and player behavior, then writes the story using the results as
reference. Tools live in four namespaces:

- ``rules.*``   hard parameter rules (dice, HP/SAN arithmetic). Results are
  authoritative: the keeper must quote them faithfully and never invent dice.
- flow (``scene.*``/``clues.*``/``npc.*``/``actions.*``)  read-only queries
  over compiled scenario data and world state. Flow-control checks (scene
  connectivity, clue prerequisites) surface as ``warnings``/``hints`` — they
  never block.
- ``director.*`` deterministic advisory scoring (pacing, storylets, secrets).
  Suggestions only; the keeper may ignore them.
- ``state.*``   transactional writes to the campaign save, plus a few
  read-only queries (``state.inventory_list``) marked ``access=query``.
  Writes keep atomicity, ``decision_id`` idempotency, and journal receipts.
  Narrative legality checks degrade to warnings.

Envelope: every tool returns ``{ok, tool, data, warnings, hints}``.

CLI:
    uv run --frozen python coc_toolbox.py list [--json]
    uv run --frozen python coc_toolbox.py describe <tool>
    uv run --frozen python coc_toolbox.py <tool> --root . --campaign <id> [--json '<args>' | --json-stdin]
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack
from copy import deepcopy
import hashlib
import importlib.util
import json
import os
import random
import re
import stat
import sys
import time
from datetime import datetime, timedelta, timezone
from difflib import get_close_matches as _close_matches
from pathlib import Path
from typing import Any, Callable

_HERE = Path(__file__).resolve().parent


def _load_sibling(name: str, filename: str):
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(name, _HERE / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _load_fresh_sibling(name: str, filename: str):
    """Load one toolbox-owned runtime module without process-global reuse."""
    spec = importlib.util.spec_from_file_location(name, _HERE / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


# NOTE: coc_sanity is no longer imported here directly — rules.* handlers
# obtain SAN mechanics through _rules_resolver (contract §4 seam 2).
coc_chase = _load_sibling("coc_chase_toolbox", "coc_chase.py")
coc_operation_policy = _load_sibling(
    "coc_operation_policy_toolbox", "coc_operation_policy.py"
)
coc_operation_kernel = _load_fresh_sibling(
    f"coc_operation_kernel_runtime_{id(_load_sibling):x}",
    "coc_operation_kernel.py",
)
sys.modules["coc_operation_kernel_runtime"] = coc_operation_kernel

# Bind the per-toolbox common runtime before defining facade helpers.
for _runtime_export in coc_operation_kernel.OPERATION_RUNTIME_EXPORTS:
    globals()[_runtime_export] = getattr(coc_operation_kernel, _runtime_export)
coc_scenario = _load_sibling("coc_scenario_toolbox", "coc_scenario.py")

# Temporal-memory finalize-hook modules. Shared module instances: operation
# adapters importing the same filenames get the identical cached object.
coc_temporal_memory = _load_sibling("coc_temporal_memory", "coc_temporal_memory.py")
coc_memory_extraction = _load_sibling(
    "coc_memory_extraction", "coc_memory_extraction.py"
)

SCENARIO_FILES = (
    "story-graph.json",
    "clue-graph.json",
    "npc-agendas.json",
    "pacing-map.json",
    "threat-fronts.json",
    "module-meta.json",
)

_TOOL_TRANSACTION_WAIT_SECONDS = 10.0
_TRANSIENT_TOOL_ERRORS = {
    "campaign_busy", "subsystem_transaction_failed",
    "development_settlement_failed",
}






# --------------------------------------------------------------------------- #
# Campaign context
# --------------------------------------------------------------------------- #









_RULE_TOOL_CAPABILITIES = {
    "rules.check": "check",
    "rules.resource_delta": "resource_delta",
    "rules.skill_describe": "skill_describe",
    "rules.cash_assets": "cash_assets",
    "rules.build_scale": "build_scale",
    "rules.roll": "check",
    "rules.push": "push_policy",
    "rules.roll_dice": "roll_dice",
    "rules.opposed": "opposed",
    "rules.sanity_check": "sanity_check",
    "rules.damage": "damage",
    "rules.luck_spend": "luck_spend",
    "rules.first_aid": "first_aid",
    "rules.medicine": "medicine",
    "rules.weekly_recovery": "weekly_recovery",
    "rules.dying_check": "dying_check",
    "rules.catalog_search": "catalog_search",
    "rules.social_adjudicate": "social_difficulty",
    "rules.psychology_observe": "psychology_policy",
}

_RULE_TOOL_RESOURCE_REQUIREMENTS = {
    "rules.sanity_check": frozenset({"san"}),
    "rules.damage": frozenset({"hp"}),
    "rules.luck_spend": frozenset({"luck"}),
    "rules.first_aid": frozenset({"hp"}),
    "rules.medicine": frozenset({"hp"}),
    "rules.weekly_recovery": frozenset({"hp"}),
    "rules.dying_check": frozenset({"hp"}),
}


# --------------------------------------------------------------------------- #
# Registry
# --------------------------------------------------------------------------- #

OPERATION_REGISTRY = coc_operation_kernel.OperationRegistry(
    policy_resolver=coc_operation_policy.policy_for_operation,
)
TOOLS: dict[str, dict[str, Any]] = OPERATION_REGISTRY.legacy_tools
coc_operation_kernel.bind_runtime_registry(OPERATION_REGISTRY)














def _query_cache_contract(spec: dict[str, Any]) -> dict[str, Any]:
    try:
        stat = (_HERE / "coc_toolbox.py").stat()
        source_identity = {"mtime_ns": stat.st_mtime_ns, "size": stat.st_size}
    except OSError:
        source_identity = {"mtime_ns": None, "size": None}
    return {
        "tool": spec["name"],
        "params": spec["params"],
        "read_domains": list(spec.get("read_domains") or ()),
        "response_mode": spec.get("response_mode", "full"),
        "source_identity": source_identity,
    }


tool = OPERATION_REGISTRY.tool


def _log_tool_call(
    ctx: Ctx,
    name: str,
    args: dict[str, Any],
    envelope: dict[str, Any],
    *,
    attempt: int = 1,
    max_attempts: int = 1,
    recovered_after_retry: bool = False,
    will_retry: bool = False,
) -> int | None:
    """Append a tool-call receipt for runtime event projection (best effort)."""
    if ctx is None or ctx.campaign_dir is None:
        return None
    spec = TOOLS.get(name) or {}
    record = {
        "schema_version": 2,
        "ts": _now_iso(),
        "tool": name,
        "ok": bool(envelope.get("ok")),
        "access": spec.get("access", "mutation"),
        "args": {k: v for k, v in args.items() if k != "seed"},
        # This is Keeper-internal audit evidence.  It deliberately preserves
        # structured tool results so a later JSON battle report can prove what
        # the KP observed before deciding what to use.  It is never a
        # player-facing narration source.
        "data": deepcopy(envelope.get("data")),
        "visibility": "keeper_internal",
        "warnings": envelope.get("warnings") or [],
        "hints": envelope.get("hints") or [],
        "attempt": attempt,
        "max_attempts": max_attempts,
        "retryable": bool(envelope.get("retryable")),
        "will_retry": bool(will_retry),
    }
    if isinstance(envelope.get("cache"), dict):
        record["cache"] = deepcopy(envelope["cache"])
    if envelope.get("idempotent_replay") is True:
        # A pending-turn exact replay is operational evidence, not a new
        # settlement.  Preserve that distinction so the bounded manifest can
        # ignore this row without weakening its post-journal mutation gate.
        record["idempotent_replay"] = True
    if (
        envelope.get("ok") is True
        and spec.get("audit_mode") == "reference"
        and isinstance(envelope.get("data"), dict)
    ):
        working_set = envelope["data"].get("working_set")
        cache = envelope.get("cache") if isinstance(envelope.get("cache"), dict) else {}
        record["data"] = {
            "projection_ref": cache.get("ref"),
            "result_digest": _canonical_digest(envelope["data"]),
            "working_set": deepcopy(working_set),
        }
    if envelope.get("retry_exhausted"):
        record["retry_exhausted"] = True
    if recovered_after_retry:
        record["recovered_after_retry"] = True
    if not envelope.get("ok"):
        error = envelope.get("error") or {}
        record["error"] = error.get("code")
        record["error_message"] = error.get("message")
    try:
        pacing = ctx.pacing()
        record["turn_number"] = pacing.get("turn_number")
    except (OSError, ValueError, TypeError):
        record["turn_number"] = None
    try:
        log_path = ctx.campaign_dir / "logs" / "toolbox-calls.jsonl"
        # `parallel_read` has no gameplay write authority, but its durable
        # Keeper-internal audit receipt must not be dropped or interleaved.
        # This dedicated append lock is intentionally independent of the
        # campaign state lock so concurrent reads remain concurrent.
        with coc_fileio.audit_append_lock(
            log_path, wait_seconds=_TOOL_TRANSACTION_WAIT_SECONDS,
        ):
            coc_state.append_jsonl(log_path, record)
            return log_path.stat().st_size
    except (OSError, coc_fileio.CampaignLockError):
        return None


def _error_recovery_hints(code: str) -> list[str]:
    hints = {
        "unknown_npc": [
            "call npc.query without npc_id to inspect authored and campaign-local ids; unknown means no authored agenda, first-impression receipt, persona card, or live psych state currently owns that exact id"
        ],
        "unknown_skill": [
            "inspect the investigator sheet or pass an explicit target; canonical rulebook base chances are used automatically when available",
            "skill names must match the sheet exactly (English, e.g. 'Library Use', 'Psychology', 'Persuade', 'Spot Hidden'); do not translate or abbreviate them"
        ],
        "psychology_observe_required": [
            "call rules.psychology_observe action=settle with the exact observer, NPC, conversation window, revision, and concrete observation question; then bind only a player-safe visible_observation with action=realize",
            "repeat observation in the unchanged window/revision through rules.psychology_observe so it returns reuse instead of rolling again",
        ],
        "psychology_grounding_invalid": [
            "first call npc.query for the exact target, then copy a returned facts[].fact_id as npc_fact:<npc_id>/<fact_id>; bare fact/clue ids are invalid",
            "use clue:<clue_id> or event:<event_id> only for an already player-known observation; then settle before realize, and never put keeper truth into visible_observation",
        ],
        "narration_review_required": [
            "for Pi play, call narration.review on the exact draft with the turn_id, source_digest, and required revision returned by turn.output_context; then pass its review_id to turn.finalize",
            "include structured agency_claims for every authorized PC action, belief, emotion, speech, physiology, or forced behavior in the draft",
        ],
        "agency_review_blocked": [
            "do not rerun rules, state writes, or state.journal; rewrite only the narration, then call narration.review with the next revision shown in the error and finalize that same frozen settlement",
        ],
        "invalid_param": [
            "call describe for the tool schema, then retry with corrected structured arguments"
        ],
        "invalid_source_worker_pack": [
            "reject this child result unchanged; the parent must not repair or rewrite the pack, call describe/discover, retry fulfillment, or poll the same task again; leave the request unfulfilled for existing lease recovery"
        ],
        "pack_semantic_fields_missing": [
            "the pack lacks contract-required semantic fields and can never satisfy projection readiness; reject this child result unchanged, do not repair or retry fulfillment, and leave the request unfulfilled for existing lease recovery"
        ],
        "treatment_already_used": [
            "the attempted treatment remains spent; consider another rules-valid treatment or natural recovery"
        ],
        "campaign_busy": [
            "automatic retries were bounded; retry later with the same decision_id so an already-settled write replays safely"
        ],
        "subsystem_transaction_failed": [
            "the subsystem rolled back the failed transaction; retry later with the same decision_id if automatic recovery is exhausted"
        ],
        "development_settlement_failed": [
            "the ending remains recorded and the development transaction was rolled back; retry with the same decision_id"
        ],
        "recovery_conflict": [
            "campaign mutation is paused because an interrupted settlement has foreign state divergence; preserve the listed paths and resolve the integrity conflict before retrying"
        ],
        "settlement_unavailable": [
            "record state.end_session first, then retry development.settle for that persisted ending"
        ],
        "settlement_target_conflict": [
            "retry the persisted ending for one of its frozen investigator_ids; party changes do not retarget an existing ending"
        ],
        "context_rehydration_required": [
            "call session.resume for this campaign before any other campaign operation; use its bounded recovery bundle instead of rereading saves or rediscovering the full tool catalog"
        ],
        "context_epoch_conflict": [
            "the host compacted again while recovery was being built; call session.resume once more and use only the newest bundle"
        ],
        "delivery_conflict": [
            "acknowledge only the latest exact rendered_sha256 returned by session.resume; never regenerate or silently replace finalized text"
        ],
        "roll_after_consequence": [
            "the roll block auto-inserts BEFORE the paragraph containing exact_excerpt; restructure your draft so the action/attempt is in an earlier paragraph and the consequence/result is in a LATER paragraph, then set exact_excerpt to a verbatim substring of that later consequence paragraph"
        ],
        "default_mechanics_placement_unavailable": [
            "the consequence paragraph (containing exact_excerpt) is paragraph 0, leaving no insertion point before it; add an action/attempt paragraph BEFORE the consequence paragraph so the roll block can insert between them",
            "retry turn.finalize with the corrected draft and same pending turn; do not call session.resume unless the host context was actually lost",
        ],
        "excerpt_mismatch": [
            "exact_excerpt must be a character-for-character substring of the draft string; copy-paste it directly from your draft text — do not retype, paraphrase, or alter punctuation"
        ],
        "mechanics_text_in_draft": [
            "remove ALL 【明骰】,【变化】,【特殊影响】 labels and rendered dice/state text from the draft; the draft is pure fiction only — the finalizer auto-inserts authoritative mechanics blocks at paragraph boundaries"
        ],
        "invalid_mechanics_placement": [
            "omit the mechanics_placements parameter entirely to use safe auto-placement; only supply explicit placements when you need deliberate interleaving and can guarantee every source exactly once with valid after_paragraph indices"
        ],
        "settlement_after_journal": [
            "state.journal already committed for this turn — call turn.finalize NOW with your current draft; do NOT call any more mutating state.* or rules.* tools after journal; read-only queries such as state.inventory_list remain legal; all mechanical writes must happen BEFORE state.journal"
        ],
        "turn_pending_finalization": [
            "state.journal already committed for this turn — call turn.finalize NOW; no further state mutations are allowed until this turn is finalized; read-only queries such as state.inventory_list remain legal"
        ],
        "mechanics_source_unavailable": [
            "this source NPC has no generated, authored, or compiled-module mechanics and the campaign has no progressive module project; do not invent or reuse generic stats — surface the gap instead of settling combat unmechanically"
        ],
        "opening_setup_incomplete": [            "follow error.details.next_operation exactly when present; this is "
            "a hard setup gate, so do not rediscover, resume, rebind, inspect "
            "live-play state, or narrate an opening first",
        ],
    }
    return list(hints.get(code, ["the keeper may continue with a different in-fiction approach or corrected tool arguments"]))


# Common model misnamings of required params, normalized at the tool boundary
# before required-param validation. Observed: models reliably send
# "delta_minutes" for state.advance_time's "minutes".
_PARAM_ALIASES: dict[str, dict[str, str]] = {
    "state.advance_time": {"delta_minutes": "minutes"},
}


# These operations mutate only exact owned source-work leases. They do not
# fulfill source data, settle rules, change player state, or enter the pending
# turn's source window, so blocking them after state.journal can strand a
# coordinator without protecting finalization integrity.
_SOURCE_LIFECYCLE_DURING_PENDING_FINALIZATION = frozenset({
    "progressive.renew_host_work_leases",
    "progressive.release_host_work_leases",
})
_ADVISORY_WRITES_DURING_PENDING_FINALIZATION = frozenset({"narration.review"})


# The lifecycle phase query is a pure read of the same derivation the gate
# itself used, so it is legal in every blocked sub-phase: a host that cannot
# ask "where am I" is forced to guess or rescan the workspace.



# One table keyed by the derived module_preparation sub-phase (plus the
# character-setup discriminator). This replaces the per-branch rejection
# constructions the gate family used to grow one at a time.
#
#   operations       — always-legal canonical operation names
#   setup_kinds      — legal ``setup.invoke`` kinds
#   chargen_dice     — "quick_fire_only": only purpose-bound CoC7 creation
#                      recipes (characteristics, age EDU, and Quick Fire Luck);
#                      "policy_scoped": also the era-adaptive dice contract
#                      when the gate carries that character-setup policy
#                      (B2 moves this into the investigator contract data)
#   era_adaptive_cash— allow ``state.cash_semantic`` under era-adaptive chargen
#   exact_next_operation_only — only the gate's own sealed card may run






def _pi_opening_character_setup_gate(
    campaign_dir: Path,
    campaign_id: str,
) -> dict[str, Any] | None:
    """Discriminate one current-source, pre-play, empty-party resume.

    This is deliberately narrower than the general opening gate. It is emitted
    only for ``session.resume`` after the caller has already proved the
    source-bound opening projection current. The condition itself now comes
    from the single phase derivation.
    """
    campaign_dir = Path(campaign_dir)
    root = campaign_dir.parents[2]
    return _pi_opening_character_setup_envelope(
        coc_opening_phase.derive_opening_phase(root, campaign_id)
    )


def _pi_opening_character_setup_complete(
    campaign_dir: Path,
    campaign_id: str,
) -> bool:
    """Return true only for one structurally current non-empty party link."""
    return coc_opening_phase._party_is_linked(Path(campaign_dir), campaign_id)


_PLACEHOLDER_CREATION_METHODS = coc_state.PLACEHOLDER_CREATION_METHODS














def _opening_projection_pacing_available(
    root: Path, campaign_id: str | None,
) -> bool:
    """Allow one typed lifecycle result before required-param gates."""
    if not campaign_id:
        return False
    try:
        root_info = coc_module_project.resolve_opening_preparation_root(
            root, str(campaign_id),
        )
        assets_mod = coc_module_project.coc_module_assets
        return any(
            row.get("kind") == "partial_opening"
            and row.get("request_purpose")
            == assets_mod.FOREGROUND_OPENING_PURPOSE
            and row.get("operational_class") in {
                "runnable", "leased", "awaiting_cache", "awaiting_scope",
            }
            for row in assets_mod.list_host_work_requests(
                root,
                root_info["asset_root_id"],
                include_closed=False,
                limit=None,
            )
        )
    except (
        coc_module_project.OpeningPreparationError,
        coc_module_project.coc_module_assets.ModuleAssetsError,
    ):
        return False


def run_tool(name: str, root: Path, campaign_id: str | None, args: dict[str, Any]) -> dict[str, Any]:
    """Programmatic entry point. Returns the envelope dict."""
    spec = TOOLS.get(name)
    if spec is None:
        message = f"unknown tool: {name}"
        if name in ("coc_capabilities", "coc_discover", "coc_invoke"):
            message += (
                "; this is a top-level gateway tool, not a coc_invoke "
                "operation — call it directly as its own tool"
            )
        elif name in _CUSTOM_SETUP_OPERATION_KINDS:
            payload: dict[str, Any] = {}
            if campaign_id:
                payload["campaign_id"] = campaign_id
            corrected: dict[str, Any] = {
                "operation": "setup.invoke",
                "invoke_via": "coc_invoke",
                "arguments": {
                    "kind": name,
                    "payload": payload,
                },
            }
            if campaign_id:
                corrected["campaign"] = campaign_id
            message += (
                "; this is a setup.invoke kind, not a top-level operation — "
                "retry only this corrected call: "
                + json.dumps(corrected, ensure_ascii=False)
            )
        else:
            close = _close_matches(name, list(TOOLS), n=3, cutoff=0.6)
            if close:
                message += "; did you mean: " + ", ".join(close)
        return {"ok": False, "tool": name, "error": {"code": "unknown_tool", "message": message}}
    execution_class = spec.get("execution_class", "serial_campaign")

    def failure(
        code: str, message: str, *, details: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        envelope = {
            "ok": False,
            "tool": name,
            "error": {"code": code, "message": message},
            "hints": _error_recovery_hints(code),
        }
        if isinstance(details, dict):
            envelope["error"]["details"] = deepcopy(details)
        return envelope

    # setup.phase intentionally accepts its campaign selector inside arguments
    # for setup callers. Resolve it before Ctx/lock dispatch so this wrapper
    # cannot make a campaign read run unlocked (or lock an unrelated outer
    # campaign). The inner selector has always been the handler's authority.
    if name == "setup.phase" and args.get("campaign_id") not in (None, ""):
        nested_campaign_id = args.get("campaign_id")
        if (
            not isinstance(nested_campaign_id, str)
            or _SAFE_ID.fullmatch(nested_campaign_id.strip()) is None
        ):
            return failure(
                "invalid_param", "setup.phase campaign_id must be a stable safe id",
            )
        campaign_id = nested_campaign_id.strip()

    def execute_transaction(ctx: Ctx) -> dict[str, Any]:
        try:
            # The registry, not a host-side tool-name list, selects whether
            # opening lifecycle observation may materialize durable state.
            # Unknown classes remain mutating/serial by the decorator's
            # fail-closed normalization.
            opening_setup_gate = _pi_opening_setup_gate(
                ctx.root,
                ctx.campaign_id,
                include_character_setup=(name == "session.resume"),
                host_work_mode=_opening_host_work_mode(
                    ctx.execution_class
                ),
            )
            if (
                opening_setup_gate is not None
                and not _pi_opening_setup_operation_allowed(
                    name, args, opening_setup_gate,
                )
            ):
                raise ToolError(
                    "opening_setup_incomplete",
                    (
                        f"{name} is unavailable until the source-bound opening "
                        "projection is current"
                    ),
                    details=opening_setup_gate,
                )
            rules_capability = _RULE_TOOL_CAPABILITIES.get(name)
            if rules_capability is not None:
                _rules_resolver(ctx, rules_capability)
                required_resources = _RULE_TOOL_RESOURCE_REQUIREMENTS.get(name)
                if required_resources:
                    ruleset_id = _active_ruleset_id(ctx)
                    declared_resources = {
                        str(resource.get("key"))
                        for resource in coc_rulesets.ruleset_resources(ruleset_id)
                        if isinstance(resource.get("key"), str)
                    }
                    missing_resources = sorted(
                        required_resources - declared_resources
                    )
                    if missing_resources:
                        raise ToolError(
                            "unsupported_ruleset_operation",
                            f"ruleset {ruleset_id!r} lacks resources required by {name}: "
                            + ", ".join(missing_resources),
                        )
            pending_turn_manifest = None
            pending_exact_replay = None
            prior_idempotency_entry = None
            prior_state_call_logged = False
            context_rehydration_advisory = None
            if spec["needs_campaign"] and ctx.campaign_dir is not None:
                host_marker = coc_host_context.current_marker(ctx.root)
                if name != "session.resume" and host_marker is not None and (
                    host_marker.get("requires_resume") is True
                    or host_marker.get("acknowledged_campaign_id")
                    not in {None, ctx.campaign_id}
                ):
                    context_rehydration_advisory = {
                        "code": "context_rehydration_recommended",
                        "campaign_id": ctx.campaign_id,
                        "host_session_id": host_marker.get("session_id"),
                        "context_epoch": host_marker.get("context_epoch"),
                        "next_operation": "session.resume",
                        "authority": "advisory",
                        "hard_gate": False,
                    }
                pending_turn_manifest = coc_turn_manifest.pending_manifest(
                    ctx.campaign_dir
                )
                if (
                    spec.get("access", "mutation") != "query"
                    and isinstance(args.get("decision_id"), str)
                    and str(args["decision_id"]).strip()
                ):
                    # Check the durable decision disposition before any
                    # handler-specific receipt replay can resurrect a branch
                    # whose state was removed by session.resume.
                    prior_idempotency_entry = ctx.ledger_lookup(
                        name, str(args["decision_id"])
                    )
                    if (
                        name.startswith("state.")
                        and prior_idempotency_entry is not None
                    ):
                        prior_state_call_logged = any(
                            row.get("ok") is True
                            and row.get("tool") == name
                            and (row.get("args") or {}).get("decision_id")
                            == args["decision_id"]
                            for row in _jsonl_rows(
                                ctx.campaign_dir / "logs" / "toolbox-calls.jsonl"
                            )
                        )
            if (
                pending_turn_manifest is not None
                and spec.get("access", "mutation") != "query"
            ):
                if (
                    name not in {
                        "turn.finalize", "state.exceptional_effect", "state.journal",
                    }
                    and name not in _SOURCE_LIFECYCLE_DURING_PENDING_FINALIZATION
                    and name not in _ADVISORY_WRITES_DURING_PENDING_FINALIZATION
                ):
                    # The journal boundary forbids settlement mutations. The
                    # explicit advisory-write set is campaign-serial and
                    # excluded from the source digest; the other exception is
                    # a read-only proof that an exact NPC operation was fully
                    # recovered before state.journal. Missing source, ledger,
                    # event, or exact payload evidence remains blocked.
                    if name == "state.record_npc_engagement":
                        pending_exact_replay = (
                            _pending_npc_engagement_exact_replay(ctx, args)
                        )
                    if pending_exact_replay is None:
                        raise ToolError(
                            "turn_pending_finalization",
                            "state.journal already committed for this turn; finalize it "
                            "before any further state mutation",
                        )
            if (
                spec["needs_campaign"]
                and ctx.campaign_dir is not None
                and pending_turn_manifest is None
                and name != "session.resume"
                and name != "rules.luck_spend"
                and (
                    spec.get("access", "mutation") != "query"
                    or bool(spec.get("recovery_domains"))
                )
            ):
                reconcile_campaign_continuity(
                    ctx.campaign_dir,
                    ctx=ctx,
                    domains=spec.get("recovery_domains"),
                )
            cache_metadata = None
            cacheable = (
                spec.get("access") == "query"
                and spec.get("response_mode") == "full_or_not_modified"
                and ctx.campaign_dir is not None
            )
            if pending_exact_replay is not None:
                data, warnings, hints = pending_exact_replay
            elif cacheable:
                domain_paths = _working_set_domain_paths(
                    ctx, tuple(spec.get("read_domains") or ())
                )
                revision_vector, _domain_revision_token = (
                    coc_working_set_cache.revision_vector(
                        ctx.campaign_dir, domain_paths
                    )
                )
                cache_key, args_digest = coc_working_set_cache.cache_identity(
                    campaign_id=str(ctx.campaign_id),
                    tool=name,
                    args=args,
                    revision_vector=revision_vector,
                    contract_identity=_query_cache_contract(spec),
                )
                # The public token binds both state and exact argument scope;
                # a revision from a different filter must never produce a
                # false not_modified response.
                revision_token = f"ws-v1-{cache_key[:24]}"
                if args.get("since_revision") == revision_token:
                    data = {
                        "working_set": {
                            "mode": "not_modified",
                            "revision": revision_token,
                            "read_domains": revision_vector,
                        }
                    }
                    warnings, hints = [], [
                        "reuse the prior full projection for this exact tool and argument scope"
                    ]
                    cache_metadata = {
                        "status": "not_modified",
                        "revision": revision_token,
                        "key": cache_key,
                    }
                else:
                    cached = coc_working_set_cache.load(
                        ctx.campaign_dir,
                        tool=name,
                        cache_key=cache_key,
                        revision_token=revision_token,
                        revision_vector=revision_vector,
                        args_digest=args_digest,
                    )
                    if cached is None:
                        data, warnings, hints = spec["handler"](ctx, args)
                        cache_ref = coc_working_set_cache.store(
                            ctx.campaign_dir,
                            tool=name,
                            cache_key=cache_key,
                            revision_token=revision_token,
                            revision_vector=revision_vector,
                            args_digest=args_digest,
                            data=data,
                            warnings=warnings,
                            hints=hints,
                        )
                        cache_status = "miss"
                    else:
                        data, warnings, hints = cached
                        cache_ref = coc_working_set_cache.cache_ref(
                            ctx.campaign_dir,
                            tool=name,
                            cache_key=cache_key,
                        )
                        cache_status = "hit"
                    if isinstance(data, dict):
                        data = deepcopy(data)
                        data["working_set"] = {
                            "mode": "full",
                            "revision": revision_token,
                            "read_domains": revision_vector,
                        }
                    cache_metadata = {
                        "status": cache_status,
                        "revision": revision_token,
                        "key": cache_key,
                        "ref": cache_ref,
                    }
            else:
                data, warnings, hints = spec["handler"](ctx, args)
            # For write operations (access=mutation), attach a scene revision
            # hint so the KP can avoid the redundant scene.context full-fetch
            # it normally does after every write to "confirm" the new state.
            # The revision token lets the next scene.context use since_revision
            # to return not_modified if nothing else changed.
            if (
                spec.get("access") != "query"
                and ctx.campaign_dir is not None
                and not name.startswith("progressive.")
            ):
                try:
                    ws_domains = _working_set_domain_paths(
                        ctx, ("scene", "world", "clues", "npc_presence", "party", "time")
                    )
                    _rv, _token = coc_working_set_cache.revision_vector(
                        ctx.campaign_dir, ws_domains
                    )
                    revision_token = f"ws-v1-{_token[:24]}"
                    if not isinstance(hints, list):
                        hints = list(hints) if hints else []
                    hints.append(
                        f"scene state was updated; to check it, call scene.context "
                        f"with since_revision={revision_token} (returns not_modified "
                        f"if unchanged, avoiding a full re-fetch) — or simply reuse "
                        f"the last scene.context result since writes preserve prior "
                        f"context unless a scene transition occurred"
                    )
                except Exception:
                    pass  # best-effort; never block a successful write
            envelope = {
                "ok": True,
                "tool": name,
                "data": data,
                "warnings": warnings,
                "hints": hints,
            }
            if cache_metadata is not None:
                envelope["cache"] = cache_metadata
            # Successful state handlers return their frozen prior data on an
            # exact decision replay. Compare that structured result with the
            # durable ledger entry so the call row carries an explicit marker;
            # warning text is never used as replay authority.
            exact_prior_state_replay = (
                name.startswith("state.")
                and prior_idempotency_entry is not None
                and prior_state_call_logged
                and isinstance(data, dict)
                and data == prior_idempotency_entry.get("data")
            )
            if pending_exact_replay is not None or exact_prior_state_replay:
                envelope["idempotent_replay"] = True
            if context_rehydration_advisory is not None:
                envelope.setdefault("warnings", []).append(
                    "The current host context has not acknowledged its latest "
                    "recovery epoch; continuing is allowed, but session.resume "
                    "is recommended before relying on remembered scene state."
                )
                envelope.setdefault("hints", []).append(
                    "call session.resume once for this context epoch, then reuse "
                    "the returned bounded working set instead of resuming every turn"
                )
                envelope["context_rehydration"] = context_rehydration_advisory
        except ToolError as exc:
            error = {"code": exc.code, "message": exc.message}
            if exc.violations:
                error["violations"] = exc.violations
            if exc.details is not None:
                error["details"] = deepcopy(exc.details)
            envelope = {
                "ok": False,
                "tool": name,
                "error": error,
                "hints": _error_recovery_hints(exc.code),
            }
        except coc_working_set_cache.WorkingSetCacheError as exc:
            envelope = {
                "ok": False,
                "tool": name,
                "error": {"code": exc.code, "message": str(exc)},
            }
        except (
            coc_continuation.ContinuationError,
            coc_host_context.HostContextError,
            coc_turn_manifest.TurnManifestError,
        ) as exc:
            envelope = {
                "ok": False,
                "tool": name,
                "error": {"code": exc.code, "message": str(exc)},
                "hints": _error_recovery_hints(exc.code),
            }
        except coc_runtime_ops.DevelopmentRecoveryConflict as exc:
            envelope = {
                "ok": False,
                "tool": name,
                "error": {"code": "recovery_conflict", "message": str(exc)},
                "recovery": {
                    "status": "RECOVERY_CONFLICT",
                    "transaction_id": exc.transaction_id,
                    "conflicting_paths": exc.conflicting_paths,
                },
            }
        except (ValueError, FileNotFoundError) as exc:
            envelope = {
                "ok": False,
                "tool": name,
                "error": {"code": "invalid_request", "message": str(exc)},
            }
        return envelope

    try:
        if spec["needs_campaign"] and not campaign_id:
            raise ToolError(
                "missing_campaign",
                "pass the campaign id as the top-level \"campaign\" field of "
                "this coc_invoke call, e.g. "
                "{\"operation\": \"<operation>\", \"campaign\": \"<campaign_id>\", "
                "\"arguments\": {...}}",
            )
        for wrong, right in _PARAM_ALIASES.get(name, {}).items():
            if args.get(right) in (None, "") and args.get(wrong) not in (None, ""):
                args[right] = args.pop(wrong)
        required_params = [
            pname
            for pname, pspec in spec["params"].items()
            if pspec.get("required")
        ]
        missing_params = [
            pname
            for pname in required_params
            if args.get(pname) in (None, "")
        ]
        if (
            name == "narration.review"
            and not _pi_play_agency_review_required()
            and not any(
                args.get(key) is not None
                for key in ("turn_id", "source_digest", "revision")
            )
        ):
            missing_params = [
                key
                for key in missing_params
                if key not in {
                    "turn_id", "source_digest", "revision",
                    "state_authority_review", "state_claim_compilation",
                }
            ]
        elif name == "narration.review" and not _pi_play_agency_review_required():
            missing_params = [
                key for key in missing_params
                if key not in {
                    "state_authority_review", "state_claim_compilation",
                }
            ]
        if (
            missing_params
            and name == "progressive.project_opening"
            and _opening_projection_pacing_available(root, campaign_id)
        ):
            missing_params = []
        if missing_params:
            label = "parameter" if len(missing_params) == 1 else "parameters"
            raise ToolError(
                "missing_param",
                f"required {label}: {', '.join(missing_params)}",
                details={
                    "missing_parameters": missing_params,
                    "required_parameters": required_params,
                    "provided_parameters": sorted(args),
                },
            )
    except ToolError as exc:
        details = exc.details
        if details is None and name == "progressive.publish_skeleton":
            details = {
                "status": "validation_failed",
                "complete": False,
                "stored": False,
                "projected": False,
            }
        envelope = failure(exc.code, exc.message, details=details)
        envelope.update({
            "attempts": 1,
            "max_attempts": 1,
            "retryable": False,
            "recovered_after_retry": False,
        })
        try:
            ctx = Ctx(root, campaign_id, execution_class=execution_class)
        except (ToolError, ValueError, FileNotFoundError):
            ctx = None
        if ctx is not None:
            _log_tool_call(ctx, name, args, envelope)
        return envelope

    try:
        max_attempts = max(1, int(_TOOL_TRANSIENT_RETRY_ATTEMPTS))
    except (TypeError, ValueError):
        max_attempts = 3
    for attempt in range(1, max_attempts + 1):
        # A failed subsystem transaction may have rolled state back or completed
        # recovery writes.  Rebuild the context so a retry cannot reuse stale
        # scenario, state, or roll-id caches from the failed attempt.
        try:
            ctx = Ctx(root, campaign_id, execution_class=execution_class)
        except ToolError as exc:
            envelope = failure(exc.code, exc.message)
            ctx = None
        except (ValueError, FileNotFoundError) as exc:
            envelope = failure("invalid_request", str(exc))
            ctx = None

        if ctx is not None and ctx.campaign_dir is None:
            envelope = execute_transaction(ctx)
        elif ctx is not None:
            # Only the registry's canonical reviewed classification may take a
            # shared campaign lock. Missing, invalid, or future classes stay
            # exclusive so a hand-edited/unknown tool cannot become concurrent.
            lock_kwargs: dict[str, Any] = {
                "wait_seconds": _TOOL_TRANSACTION_WAIT_SECONDS,
            }
            if execution_class == "parallel_read":
                lock_kwargs["mode"] = "shared"
            try:
                with coc_fileio.campaign_lock(ctx.campaign_dir, **lock_kwargs):
                    try:
                        if name == "session.resume":
                            # Resume can repair/disposition abandoned state.  Its
                            # opening boundary and creation evidence therefore
                            # have to be readable before any generic recovery
                            # mutation is allowed to run.
                            coc_turn_manifest.effective_source_boundary(
                                ctx.campaign_dir
                            )
                            coc_turn_finalization.campaign_creation_receipt_bound_roll_ids(
                                ctx.campaign_dir
                            )
                        if not spec.get("strict_read_only"):
                            coc_turn_manifest.recover_table_opening_boundary(
                                ctx.campaign_dir
                            )
                            coc_runtime_ops.recover_development_transactions(
                                ctx.campaign_dir
                            )
                    except coc_turn_manifest.TurnManifestError as exc:
                        envelope = failure(exc.code, str(exc))
                    except coc_turn_finalization.TurnContractError as exc:
                        envelope = failure(exc.code, str(exc))
                    except coc_runtime_ops.DevelopmentRecoveryConflict as exc:
                        envelope = failure("recovery_conflict", str(exc))
                        envelope["recovery"] = {
                            "status": "RECOVERY_CONFLICT",
                            "transaction_id": exc.transaction_id,
                            "conflicting_paths": exc.conflicting_paths,
                        }
                    else:
                        envelope = execute_transaction(ctx)
            except coc_fileio.CampaignLockError as exc:
                envelope = failure("campaign_busy", str(exc))

        error_code = str((envelope.get("error") or {}).get("code") or "")
        retryable = not envelope.get("ok") and error_code in _TRANSIENT_TOOL_ERRORS
        recovered = bool(envelope.get("ok") and attempt > 1)
        if not envelope.get("ok"):
            envelope.setdefault("hints", _error_recovery_hints(error_code))
        envelope["attempts"] = attempt
        envelope["max_attempts"] = max_attempts
        envelope["retryable"] = retryable
        if retryable and attempt >= max_attempts:
            envelope["retry_exhausted"] = True
        envelope["recovered_after_retry"] = recovered
        will_retry = bool(retryable and attempt < max_attempts)
        # Recovery conflict is a strict, non-mutating reusable-state barrier;
        # even the best-effort toolbox audit log must remain byte-identical.
        log_end_offset = None
        if ctx is not None and error_code.lower() != "recovery_conflict":
            log_end_offset = _log_tool_call(
                ctx,
                name,
                args,
                envelope,
                attempt=attempt,
                max_attempts=max_attempts,
                recovered_after_retry=recovered,
                will_retry=will_retry,
            )
        if (
            ctx is not None
            and ctx.campaign_dir is not None
            and envelope.get("ok") is True
            and name == "evidence.table_opening"
            and log_end_offset is not None
        ):
            try:
                with coc_fileio.campaign_lock(
                    ctx.campaign_dir,
                    wait_seconds=_TOOL_TRANSACTION_WAIT_SECONDS,
                ):
                    coc_turn_manifest.complete_table_opening_boundary(
                        ctx.campaign_dir,
                        decision_id=str(args.get("decision_id") or ""),
                        run_id=str(args.get("run_id") or ""),
                        completed_end_offset=log_end_offset,
                    )
            except (
                coc_fileio.CampaignLockError,
                coc_turn_manifest.TurnManifestError,
            ) as exc:
                envelope.setdefault("warnings", []).append(
                    "opening evidence is durable, but its pre-turn source boundary will recover on the next mutating campaign call: "
                    + str(exc)
                )
        if (
            ctx is not None
            and ctx.campaign_dir is not None
            and envelope.get("ok") is True
            and name == "turn.finalize"
        ):
            data = envelope.get("data") if isinstance(envelope.get("data"), dict) else {}
            has_receipt = (
                isinstance(data.get("finalization_id"), str)
                and bool(data["finalization_id"].strip())
            )

            def _fail_history_commit(exc: Exception) -> None:
                if isinstance(exc, ToolError):
                    error = {"code": exc.code, "message": exc.message}
                    if exc.violations:
                        error["violations"] = exc.violations
                    if exc.details is not None:
                        error["details"] = deepcopy(exc.details)
                    hints = _error_recovery_hints(exc.code)
                else:
                    error = {
                        "code": "history_commit_failed",
                        "message": str(exc),
                    }
                    hints = _error_recovery_hints("history_commit_failed")
                envelope["ok"] = False
                envelope["error"] = error
                envelope["hints"] = hints
                envelope.pop("data", None)
                envelope.pop("continuation", None)

            try:
                with coc_fileio.campaign_lock(
                    ctx.campaign_dir,
                    wait_seconds=_TOOL_TRANSACTION_WAIT_SECONDS,
                ):
                    if log_end_offset is not None:
                        try:
                            repair_finalization_id = str(
                                args.get("repair_finalization_id") or ""
                            ).strip()
                            if repair_finalization_id:
                                coc_turn_manifest.complete_undelivered_output_repair(
                                    ctx.campaign_dir,
                                    journal_decision_id=str(
                                        data.get("journal_decision_id") or ""
                                    ),
                                    previous_finalization_id=repair_finalization_id,
                                    finalization_id=str(
                                        data.get("finalization_id") or ""
                                    ),
                                    accepted_revision=int(
                                        data.get("accepted_revision") or 0
                                    ),
                                    settlement_snapshot_id=str(
                                        data.get("settlement_snapshot_id") or ""
                                    ),
                                    rendered_text_sha256=str(
                                        data.get("rendered_text_sha256") or ""
                                    ),
                                    contract_projection_sha256=str(
                                        data.get("contract_projection_sha256") or ""
                                    ),
                                    completed_end_offset=log_end_offset,
                                )
                            else:
                                coc_turn_manifest.complete_pending_turn(
                                    ctx.campaign_dir,
                                    journal_decision_id=str(
                                        data.get("journal_decision_id") or ""
                                    ),
                                    finalization_id=str(
                                        data.get("finalization_id") or ""
                                    ),
                                    accepted_revision=int(
                                        data.get("accepted_revision") or 0
                                    ),
                                    settlement_snapshot_id=str(
                                        data.get("settlement_snapshot_id") or ""
                                    ),
                                    rendered_text_sha256=str(
                                        data.get("rendered_text_sha256") or ""
                                    ),
                                    contract_projection_sha256=str(
                                        data.get("contract_projection_sha256") or ""
                                    ),
                                    completed_end_offset=log_end_offset,
                                )
                        except coc_turn_manifest.TurnManifestError as exc:
                            envelope.setdefault("warnings", []).append(
                                "turn finalization is durable, but the bounded source cursor will recover on the next campaign call: "
                                + str(exc)
                            )
                        try:
                            revision_vector, revision_token = _continuation_revision(ctx)
                            checkpoint = coc_continuation.publish_finalized_checkpoint(
                                ctx.campaign_dir,
                                data,
                                revision_vector=revision_vector,
                                revision_token=revision_token,
                            )
                        except (
                            coc_continuation.ContinuationError,
                            coc_working_set_cache.WorkingSetCacheError,
                        ) as exc:
                            envelope.setdefault("warnings", []).append(
                                "turn finalization is durable, but its rebuildable continuation checkpoint was not published; session.resume will retry from canonical receipts: "
                                + str(exc)
                            )
                        else:
                            envelope["continuation"] = {
                                "checkpoint_id": checkpoint["checkpoint_id"],
                                "turn_number": checkpoint["turn_number"],
                                "content_sha256": checkpoint["content_sha256"],
                            }
                    if has_receipt:
                        try:
                            _commit_finalized_turn_history(ctx, data)
                        except ToolError as exc:
                            _fail_history_commit(exc)
                        else:
                            extraction_evidence = (
                                _enqueue_finalized_turn_memory_extraction(
                                    ctx, data
                                )
                            )
                            if isinstance(extraction_evidence, dict):
                                data["memory_extraction"] = deepcopy(
                                    extraction_evidence
                                )
                            elif isinstance(extraction_evidence, str):
                                envelope.setdefault("warnings", []).append(
                                    extraction_evidence
                                )
            except coc_fileio.CampaignLockError as exc:
                if has_receipt:
                    _fail_history_commit(
                        ToolError(
                            "history_commit_failed",
                            "turn history commit requires the exclusive campaign lock: "
                            + str(exc),
                        )
                    )
                else:
                    envelope.setdefault("warnings", []).append(
                        "turn finalization is durable, but post-finalization cursor/checkpoint publication will recover on the next campaign call: "
                        + str(exc)
                    )
        if not retryable or attempt >= max_attempts:
            return envelope
        time.sleep(_TOOL_TRANSIENT_RETRY_DELAY_SECONDS * attempt)

    raise AssertionError("tool retry loop exhausted without returning")


# --------------------------------------------------------------------------- #
# Shared helpers
# --------------------------------------------------------------------------- #

















# --------------------------------------------------------------------------- #
# Adjudication advisory evidence (warnings/hints only — never blocking)
# --------------------------------------------------------------------------- #

# Structured delivery markers that make a clue roll-gated by module design.
# Free text (clue prose, roll reasons, narration) is never inspected.




























def _handout_cards_indexed(ctx: Ctx) -> dict[str, dict[str, Any]]:
    """Resolve every verbatim info card reachable for this campaign.

    One merged, asset_id-keyed view over the two canonical card stores plus
    deep progressive entities (still mid-queue before a re-projection):
    campaign ``scenario/handouts.json`` cards, ``index/handout-assets.json``
    assets, and deep ``handout`` entity packs from the campaign's module
    root. Entity-projected cards win id collisions (freshest deep truth).
    """
    cards: dict[str, dict[str, Any]] = {}
    if ctx.campaign_dir is None:
        return cards
    cards.update(coc_scenario.load_handout_assets(ctx.campaign_dir))
    doc = ctx.scenario("handouts.json")
    if isinstance(doc, dict):
        for card in doc.get("handouts") or []:
            if not isinstance(card, dict):
                continue
            asset_id = str(card.get("asset_id") or "").strip()
            if asset_id:
                cards[asset_id] = card
    asset_root_ids = (
        coc_module_project.campaign_handout_asset_root_ids(ctx.campaign_dir)
        if ctx.campaign_dir is not None else []
    )
    for asset_root_id in asset_root_ids:
        entities_dir = (
            coc_module_project.coc_module_assets.assets_root(ctx.root)
            / asset_root_id / "entities"
        )
        if entities_dir.is_dir():
            for path in sorted(entities_dir.glob("handout-*.json")):
                entity_id = path.stem[len("handout-"):]
                if not entity_id:
                    continue
                try:
                    pack = coc_module_project.coc_module_assets.get_entity(
                        ctx.root, asset_root_id, "handout", entity_id,
                    )
                except Exception:  # unreadable store entry is not a card
                    continue
                if not isinstance(pack, dict):
                    continue
                if str(pack.get("parse_state") or "") not in {"deep", "body_parsed"}:
                    continue
                if pack.get("evidence_gap"):
                    continue
                try:
                    card = coc_module_project.handout_card_from_pack(pack)
                except coc_module_project.ModuleProjectError:
                    continue
                cards[card["asset_id"]] = card
    return cards


def _delivered_handout_ids(world: dict[str, Any]) -> set[str]:
    return {
        str(value)
        for value in (world.get("delivered_handout_ids") or [])
        if str(value).strip()
    }


def _handout_public_view(
    card: dict[str, Any], delivered: set[str],
) -> dict[str, Any]:
    """Player-safe projection of one verbatim card.

    Hard secrecy boundary, fail-closed on two axes: an undelivered card and
    a card explicitly marked ``player_visible: false`` never expose a body —
    not the verbatim text, not the localized text, not the summary, not the
    image. Only delivered, player-visible cards carry the player-safe card
    fields.
    """
    asset_id = str(card.get("asset_id"))
    if asset_id not in delivered or not bool(card.get("player_visible", True)):
        return {
            "asset_id": asset_id,
            "delivered": False,
            "secret": True,
            "content_available_after": "state.deliver_handout",
        }
    view: dict[str, Any] = {
        "asset_id": asset_id,
        "kind": card.get("kind"),
        "title": card.get("title"),
        "text": card.get("localized_text") or card.get("text"),
        "localized_text": card.get("localized_text"),
        "image_ref": card.get("image_ref"),
        "source_refs": list(card.get("source_refs") or []),
        "player_visible": True,
        "delivered": True,
        "secret": False,
    }
    if isinstance(card.get("summary"), str):
        view["summary"] = card["summary"]
    return view


def _apply_handout_delivery(
    world: dict[str, Any],
    handout_ids: list[str],
) -> tuple[list[str], list[str]]:
    """Idempotently append deliveries to the authoritative world set.

    Pure world mutation — no I/O. The caller still owns ``ctx.save_world``
    and the evidence event log so a delivery can share one transaction with
    the state write that caused it (e.g. record_clue linkage). Returns
    (newly_delivered, already_delivered).
    """
    delivered = _delivered_handout_ids(world)
    newly: list[str] = []
    already: list[str] = []
    for raw in handout_ids:
        handout_id = str(raw).strip()
        if not handout_id:
            continue
        if handout_id in delivered:
            already.append(handout_id)
            continue
        delivered.add(handout_id)
        newly.append(handout_id)
    if newly:
        world["delivered_handout_ids"] = sorted(delivered)
    return newly, already





















































































































































def _pending_event_rows(ctx: Ctx, event_id: str) -> list[dict[str, Any]]:
    return _pending_jsonl_rows(ctx, "logs/events.jsonl", event_id)




































def _flag_event_is_source_anchored(
    ctx: Ctx, flags: dict[str, Any], event: dict[str, Any]
) -> bool:
    receipts = ((flags.get(_SOURCE_RECEIPTS_KEY) or {}).get("state.set_flag") or {})
    if isinstance(receipts, dict):
        for receipt in receipts.values():
            if (
                _stored_toolbox_receipt_valid(receipt)
                and receipt.get("tool") == "state.set_flag"
                and receipt.get("event") == event
            ):
                _operation_event_present(ctx, receipt)
                return True
    director_receipts = flags.get(coc_flag_state.DIRECTOR_FLAG_RECEIPTS_KEY) or {}
    if not coc_flag_state.valid_director_flag_receipt_map(director_receipts):
        return False
    for receipt in director_receipts.values():
        if receipt.get("event") == event:
            _director_receipt_event_present(ctx, receipt)
            return True
    return False




















def _reconcile_all_canonical_source_receipts(ctx: Ctx) -> None:
    """Finish every durable source receipt before any later mutation.

    A host is allowed to continue after a tool failure.  Consequently recovery
    cannot depend on it retrying the same decision id: the next mutating tool
    repairs all receipt-owned event and ledger stages while the campaign lock
    is held.  This is transactional integrity, not a narration gate.
    """
    _reconcile_all_roll_source_receipts(ctx)

    flags = ctx.flags()
    _reconcile_all_flag_source_receipts(ctx, flags)

    if _time_markers_path(ctx).is_file():
        markers = _load_time_markers(ctx)
        _reconcile_all_marker_source_receipts(ctx, markers)

    if _npc_receipt_path(ctx).is_file():
        _reconcile_all_npc_source_receipts(ctx)

    if (ctx.campaign_dir / "save" / "npc-state.json").is_file():
        _reconcile_all_npc_presence_source_receipts(ctx)








































































# --------------------------------------------------------------------------- #
# setup.* — canonical pre-session onboarding gateway
# --------------------------------------------------------------------------- #



























# --------------------------------------------------------------------------- #
# rules.* — hard parameter rules
# --------------------------------------------------------------------------- #






































































# --------------------------------------------------------------------------- #
# typed bridge to the canonical subsystem executor
# --------------------------------------------------------------------------- #















# --------------------------------------------------------------------------- #
# combat.* — authored bridge to CombatSession through the same executor
# --------------------------------------------------------------------------- #




















# --------------------------------------------------------------------------- #
# flow.* — read-only queries (former gates surface as info)
# --------------------------------------------------------------------------- #

# An adapter that spawns one child per claimed group must not claim a batch it
# would fan out over all at once.
# The Pi lifecycle runs leaves through a fixed-width pool, so a large claim
# costs one coordinator round trip instead of many and never more concurrent
# processes than the pool allows.



















































# MCP decorates each returned mutation card with a short contract reference.
# Keep the handler payload below its public budget so the real gateway result
# remains bounded after that transport-only metadata is added.























































# These fields are owned by the job binding and repository canonicalization
# (the exact source-scope check above, put_entity's id write, and cache-derived
# source_refs), so the semantic gate never double-gates them.
# Static floor from source-pack-worker-v1 location_pack.required_semantic_fields.






















_SOURCE_RESULT_FIELDS = {
    "schema_version", "contract_id", "packet_id", "work_group_id",
    "status", "results",
}
_SOURCE_RESULT_ITEM_REQUIRED_FIELDS = {"job_id", "pack", "related_packs"}
_SOURCE_RESULT_ITEM_FIELDS = _SOURCE_RESULT_ITEM_REQUIRED_FIELDS | {"opening_setup"}
_SOURCE_RESULT_CONTRACT = "coc.source-pack-worker.v1"
_SOURCE_SUBMIT_RECEIPT_CONTRACT = "coc.source-submit-receipt.v1"


def _source_result_id(value: Any, *, field: str) -> str:
    text = str(value or "").strip()
    if not text or len(text) > 256:
        raise ToolError(
            "invalid_source_submission",
            f"{field} must be a non-empty string of at most 256 characters",
        )
    return text


def _validate_source_result_submission(
    payload: dict[str, Any],
) -> tuple[str, str, str, list[dict[str, Any]]]:
    if set(payload) != _SOURCE_RESULT_FIELDS:
        raise ToolError(
            "invalid_source_submission",
            "source submission must contain exactly schema_version, contract_id, "
            "packet_id, work_group_id, status, and results",
        )
    if type(payload.get("schema_version")) is not int or payload["schema_version"] != 1:
        raise ToolError(
            "invalid_source_submission", "source submission requires schema_version=1",
        )
    if payload.get("contract_id") != _SOURCE_RESULT_CONTRACT:
        raise ToolError(
            "invalid_source_submission",
            f"source submission requires contract_id={_SOURCE_RESULT_CONTRACT}",
        )
    packet_id = _source_result_id(payload.get("packet_id"), field="packet_id")
    work_group_id = _source_result_id(
        payload.get("work_group_id"), field="work_group_id",
    )
    status = str(payload.get("status") or "").strip()
    if status not in {"usable", "abstain", "failed"}:
        raise ToolError(
            "invalid_source_submission",
            "source submission status must be usable, abstain, or failed",
        )
    raw_results = payload.get("results")
    if not isinstance(raw_results, list) or len(raw_results) > 128:
        raise ToolError(
            "invalid_source_submission", "source submission results must be an array",
        )
    if status != "usable" and raw_results:
        raise ToolError(
            "invalid_source_submission",
            "abstain/failed source submissions require results=[]",
        )
    if status == "usable" and not raw_results:
        raise ToolError(
            "invalid_source_submission", "usable source submission requires results",
        )
    results: list[dict[str, Any]] = []
    job_ids: set[str] = set()
    for index, raw in enumerate(raw_results):
        if (
            not isinstance(raw, dict)
            or set(raw) - _SOURCE_RESULT_ITEM_FIELDS
            or not _SOURCE_RESULT_ITEM_REQUIRED_FIELDS <= set(raw)
        ):
            raise ToolError(
                "invalid_source_worker_pack",
                f"results[{index}] must contain job_id, pack, related_packs "
                "and may contain only opening_setup in addition",
            )
        job_id = _source_result_id(raw.get("job_id"), field=f"results[{index}].job_id")
        if job_id in job_ids:
            raise ToolError(
                "invalid_source_submission", "source submission job ids must be unique",
            )
        job_ids.add(job_id)
        results.append(deepcopy(raw))
    return packet_id, work_group_id, status, results


def _leased_source_packet_binding(
    root: Path,
    *,
    packet_id: str,
    work_group_id: str,
) -> tuple[str, list[dict[str, Any]]]:
    assets_mod = coc_module_project.coc_module_assets
    store = assets_mod.assets_root(root)
    matches: list[tuple[str, dict[str, Any]]] = []
    if store.is_dir():
        for module_dir in sorted(path for path in store.iterdir() if path.is_dir()):
            work_dir = module_dir / "host-work"
            if not work_dir.is_dir():
                continue
            for path in sorted(work_dir.glob("*.json")):
                try:
                    request = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
                if not isinstance(request, dict) or request.get("lease_id") != packet_id:
                    continue
                matches.append((module_dir.name, request))
    if not matches:
        raise ToolError(
            "invalid_source_lease", "packet_id does not bind an existing host-work lease",
        )
    asset_root_ids = {asset_root_id for asset_root_id, _request in matches}
    if len(asset_root_ids) != 1:
        raise ToolError(
            "invalid_source_lease", "packet_id ambiguously binds multiple asset roots",
        )
    asset_root_id = next(iter(asset_root_ids))
    now = datetime.now(timezone.utc)
    for bound_root_id, request in matches:
        if (
            bound_root_id != asset_root_id
            or str(request.get("asset_root_id") or "") != asset_root_id
            or str(request.get("work_group_id") or "") != work_group_id
            or str(request.get("dispatch_state") or "") != "leased"
            or assets_mod._lease_is_expired(request, now)
            or str(request.get("status") or "open")
            in {"fulfilled", "cancelled", "superseded"}
        ):
            raise ToolError(
                "invalid_source_lease",
                "source submission does not match one active leased packet",
            )
    requests = [deepcopy(request) for _asset_root_id, request in matches]
    requests.sort(key=lambda row: str(row.get("job_id") or ""))
    return asset_root_id, requests


def submit_source_worker_result(root: Path, payload: dict[str, Any]) -> dict[str, Any]:
    """Bind one child result to its lease and reuse strict fulfillment serially."""
    if not isinstance(payload, dict):
        raise ToolError("invalid_source_submission", "source submission must be an object")
    packet_id, work_group_id, status, results = (
        _validate_source_result_submission(payload)
    )
    ctx = Ctx(Path(root).resolve(), None)
    try:
        with coc_fileio.advisory_file_lock(_source_submit_lock_path(ctx)):
            asset_root_id, requests = _leased_source_packet_binding(
                ctx.root,
                packet_id=packet_id,
                work_group_id=work_group_id,
            )
            leased_job_ids = {
                str(request.get("job_id") or "") for request in requests
            }
            result_job_ids = {str(result.get("job_id") or "") for result in results}
            if status == "usable" and result_job_ids != leased_job_ids:
                raise ToolError(
                    "invalid_source_lease",
                    "usable source submission job set must equal the leased packet job set",
                )

            receipt: dict[str, Any] = {
                "schema_version": 1,
                "contract_id": _SOURCE_SUBMIT_RECEIPT_CONTRACT,
                "packet_id": packet_id,
                "lease_id": packet_id,
                "work_group_id": work_group_id,
                "asset_root_id": asset_root_id,
                "ok": status == "usable",
                "submission_status": status,
                "submission_digest": _canonical_digest(payload),
                "job_receipts": [],
            }
            if status != "usable":
                receipt["error"] = {
                    "code": "source_result_not_usable",
                    "message": f"source worker returned status={status}",
                }
                for request in requests:
                    receipt["job_receipts"].append({
                        "job_id": request.get("job_id"),
                        "ok": False,
                        "request_status": str(request.get("status") or "open"),
                        "error": deepcopy(receipt["error"]),
                    })
                return receipt

            request_by_job = {
                str(request.get("job_id") or ""): request for request in requests
            }
            for result in results:
                job_id = str(result["job_id"])
                try:
                    data, _warnings, _hints = _fulfill_host_work_for_asset_unlocked(
                        ctx,
                        {"worker_result": result},
                        root_id=asset_root_id,
                    )
                except ToolError as exc:
                    failure = {
                        "job_id": job_id,
                        "ok": False,
                        "request_status": str(
                            request_by_job[job_id].get("status") or "open"
                        ),
                        "error": {"code": exc.code, "message": exc.message},
                    }
                    receipt["ok"] = False
                    receipt["error"] = deepcopy(failure["error"])
                    receipt["job_receipts"].append(failure)
                    return receipt
                receipt["job_receipts"].append({
                    "job_id": job_id,
                    "ok": True,
                    "request_status": data.get("request_status"),
                    "fulfillment_digest": _canonical_digest(data),
                })
            return receipt
    except coc_fileio.CampaignLockError as exc:
        raise ToolError("source_submit_busy", str(exc)) from exc








































# --------------------------------------------------------------------------- #
# KP orchestration helpers — structured evidence, never prose classification
# --------------------------------------------------------------------------- #



















# --------------------------------------------------------------------------- #
# director.* — rich existing Director implementation, advisory only
# --------------------------------------------------------------------------- #















































































# --------------------------------------------------------------------------- #
# state.* — transactional writes
# --------------------------------------------------------------------------- #

















































































def _pending_npc_engagement_exact_replay(
    ctx: Ctx, args: dict[str, Any]
) -> tuple[dict[str, Any], list[str], list[str]] | None:
    """Prove a post-journal call is an already-recovered exact replay.

    This path is deliberately read-only.  It does not run source recovery or
    the normal handler because either could materialize a missing write after
    the journal boundary.
    """
    (
        decision_id,
        _requested_npc_id,
        _requested_interaction_kind,
        run_id,
        operation,
    ) = _npc_engagement_operation(ctx, args)
    try:
        document = coc_npc_event_chain.load_receipt_document(ctx.campaign_dir)
    except ValueError as exc:
        raise ToolError("state_corrupt", str(exc)) from exc
    prior_receipts = _npc_receipts_for_decision(
        document,
        producer="state.record_npc_engagement",
        decision_id=decision_id,
    )
    if not prior_receipts:
        return None
    if len(prior_receipts) != 1:
        raise ToolError(
            "state_corrupt",
            "state.record_npc_engagement decision_id "
            f"'{decision_id}' has multiple source receipts",
        )
    receipt = prior_receipts[0]
    if receipt.get("run_id") != run_id:
        raise ToolError(
            "idempotency_conflict",
            f"decision_id '{decision_id}' was already applied in a different play run",
        )
    if receipt.get("operation_digest") != coc_npc_event_chain.canonical_digest(
        operation
    ):
        raise ToolError(
            "idempotency_conflict",
            f"decision_id '{decision_id}' was already applied to a different NPC engagement payload",
        )
    event = receipt.get("event")
    if not isinstance(event, dict) or not _operation_event_present(ctx, receipt):
        raise ToolError(
            "state_corrupt",
            f"NPC engagement decision_id '{decision_id}' was not fully materialized before state.journal",
        )
    pending_rows = _pending_jsonl_rows(
        ctx, "logs/events.jsonl", str(receipt["event_id"])
    )
    if any(row != event for row in pending_rows) or len(pending_rows) > 1:
        raise ToolError(
            "state_corrupt",
            f"pending NPC engagement decision_id '{decision_id}' conflicts with its source receipt",
        )
    prior = ctx.ledger_lookup("state.record_npc_engagement", decision_id)
    if prior is None or prior.get("data") != event:
        raise ToolError(
            "state_corrupt",
            f"NPC engagement decision_id '{decision_id}' was not fully recovered before state.journal",
        )
    return deepcopy(event), [
        *_npc_receipt_warnings(receipt),
        "duplicate decision_id: returning the fully recovered NPC engagement without a new write",
    ], []




































# --------------------------------------------------------------------------- #
# Steward (管家): delivery + notebook state surface (0.5.1a S2)
# --------------------------------------------------------------------------- #
# The steward is a host-agnostic role (plugins/coc-keeper/skills/coc-steward)
# running in its own session.  It feeds module text to the KP by writing
# delivery records and maintaining a notebook of pre-cut segments per expected
# scene.  All writes are transactional and idempotent via decision_id; the KP
# consumes through the read-only steward.deliveries / steward.notebook ops.
# These records never hold rules/state authority and never modify module text.















































































def _finalization_turn_number(ctx: Ctx, receipt: dict[str, Any]) -> int:
    raw = receipt.get("turn_number")
    if isinstance(raw, int) and not isinstance(raw, bool) and raw >= 0:
        return raw
    projection = receipt.get("contract_projection")
    if isinstance(projection, dict):
        raw = projection.get("turn_number")
        if isinstance(raw, int) and not isinstance(raw, bool) and raw >= 0:
            return raw
    pending = coc_turn_manifest.pending_manifest(ctx.campaign_dir)
    if isinstance(pending, dict):
        raw = pending.get("turn_number")
        if isinstance(raw, int) and not isinstance(raw, bool) and raw >= 0:
            return raw
    turn_id = receipt.get("turn_id")
    if isinstance(turn_id, str) and turn_id:
        path = coc_turn_manifest.manifest_path(ctx.campaign_dir, turn_id)
        if path.is_file():
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                payload = None
            if isinstance(payload, dict):
                raw = payload.get("turn_number")
                if isinstance(raw, int) and not isinstance(raw, bool) and raw >= 0:
                    return raw
    pacing = ctx.pacing()
    raw = pacing.get("turn_number")
    if isinstance(raw, int) and not isinstance(raw, bool) and raw >= 0:
        return raw
    raise ToolError("state_corrupt", "finalization receipt has no turn_number")


def _enqueue_finalized_turn_memory_extraction(
    ctx: Ctx, receipt: dict[str, Any]
) -> dict[str, Any] | str | None:
    """Enqueue the deterministic memory-extraction entry for a settled turn.

    Runs only after ``_commit_finalized_turn_history`` succeeded: the turn
    result and Git commit are already authoritative, so an enqueue failure
    NEVER fails ``turn.finalize`` (extraction core contract). Episode
    recording goes through ``coc_temporal_memory.record_turn_episode``
    (semantic campaign/timeline/turn/receipt in, machine-attached commit
    out); with no candidates this enqueues the explicit pending ``extract``
    backlog row through the canonical temporal facade store, and the job
    identity comes from ``coc_memory_extraction.build_extraction_job``.
    Job/backlog/episode ids are derived from (campaign, timeline, turn)
    only — never wall-clock — so they are byte-stable across finalize
    replay and the entry stays rebuildable from Git history.

    Returns a small model-facing evidence mapping (semantic ids only), or a
    bounded warning string on recoverable failure, or ``None`` when this
    finalized turn carries no extractable binding (missing campaign /
    receipt, or turn 0).
    """
    campaign_id = ctx.campaign_id
    finalization_id = str(receipt.get("finalization_id") or "").strip()
    if not isinstance(campaign_id, str) or not campaign_id or not finalization_id:
        return None
    try:
        turn_number = int(_finalization_turn_number(ctx, receipt))
        if turn_number < 1:
            # Episodes/backlog rows bind finalized turns >= 1 only.
            return None
        timeline_id = coc_git_history.active_timeline_id(ctx.root, campaign_id)
        episode = coc_temporal_memory.record_turn_episode(
            ctx.root,
            campaign_id,
            timeline_id,
            turn_number,
            [finalization_id],
            None,
            None,
            subjects_present=[],
            entities=[],
            finalization_receipt=finalization_id,
        )
        episode_core = {
            key: value for key, value in episode.items() if key != "evidence"
        }
        # Binding record from the git-resolved truth (resolve_turn_commit
        # validated commit_type/timeline/turn): exactly the closed fields
        # build_extraction_job consumes; parents/tree/files stay Git-side.
        commit_record = {
            "sha": str(episode.get("commit") or ""),
            "campaign_id": campaign_id,
            "timeline_id": timeline_id,
            "turn_number": turn_number,
            "finalization_id": finalization_id,
            "commit_type": "turn",
        }
        job = coc_memory_extraction.build_extraction_job(
            ctx.campaign_dir,
            commit_record,
            finalization_id,
            episode_core,
        )
        return {
            "job_id": job["job_id"],
            "episode_id": str(episode["episode_id"]),
            "timeline_id": timeline_id,
            "backlog_id": coc_temporal_memory.contract.backlog_id_for(
                campaign_id, turn_number, coc_memory_extraction.BACKLOG_SLOT
            ),
        }
    except Exception as exc:  # hard fail-open by contract
        return (
            "turn finalization is durable, but its deterministic memory-"
            "extraction enqueue failed and stays rebuildable from Git "
            f"history: {exc}"
        )


def _commit_finalized_turn_history(ctx: Ctx, receipt: dict[str, Any]) -> str:
    """Commit one settled turn after every authoritative post-finalization write."""
    campaign_id = ctx.campaign_id
    if not isinstance(campaign_id, str) or not campaign_id:
        raise ToolError("missing_campaign", "turn history commit requires a campaign")
    turn_number = _finalization_turn_number(ctx, receipt)
    try:
        # commit_finalized_turn ensures the repo itself; a second ensure_repo
        # here only paid another full fsck per finalize.
        return coc_git_history.commit_finalized_turn(
            ctx.root,
            campaign_id,
            turn_number=turn_number,
            finalization_id=str(receipt.get("finalization_id") or ""),
            journal_decision_id=str(receipt.get("journal_decision_id") or ""),
            settlement_snapshot_id=str(receipt.get("settlement_snapshot_id") or ""),
            rendered_text_sha256=str(receipt.get("rendered_text_sha256") or ""),
            schema_generation=coc_git_history.format_schema_generation(
                coc_state.CURRENT_SCHEMA_VERSIONS
            ),
        )
    except coc_git_history.GitHistoryError as exc:
        raise ToolError("history_commit_failed", str(exc)) from exc
    except ValueError as exc:
        if isinstance(exc, ToolError):
            raise
        raise ToolError("history_commit_failed", str(exc)) from exc




















# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

# --------------------------------------------------------------------------- #
# Operation module composition
# --------------------------------------------------------------------------- #

OPERATION_MODULES: dict[str, Any] = {}


def _load_operation_module(module_id: str, filename: str):
    module_name = (
        f"{__name__.replace('.', '_')}_operation_"
        f"{module_id.replace('-', '_')}_{id(OPERATION_REGISTRY):x}"
    )
    spec = importlib.util.spec_from_file_location(module_name, _HERE / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    module.__dict__["TOOLS"] = TOOLS
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    module.register_operations(OPERATION_REGISTRY)
    for export_name in module.OPERATION_EXPORTS:
        globals()[export_name] = getattr(module, export_name)
    OPERATION_MODULES[module_id] = module
    return module


_load_operation_module('setup-session', 'coc_operation_setup_session.py')
_load_operation_module('progressive-source', 'coc_operation_progressive_source.py')
_load_operation_module('rules-core', 'coc_operation_rules_core.py')
_load_operation_module('social-psychology', 'coc_operation_social_psychology.py')
_load_operation_module('combat', 'coc_operation_combat.py')
_load_operation_module('chase', 'coc_operation_chase.py')
_load_operation_module('sanity-recovery', 'coc_operation_sanity_recovery.py')
_load_operation_module('finance', 'coc_operation_finance.py')
_load_operation_module('inventory-mechanics', 'coc_operation_inventory_mechanics.py')
_load_operation_module('handouts-clues', 'coc_operation_handouts_clues.py')
_load_operation_module('scene-advisory', 'coc_operation_scene_advisory.py')
_load_operation_module('npc-world', 'coc_operation_npc_world.py')
_load_operation_module('continuity-memory', 'coc_operation_continuity_memory.py')
_load_operation_module('temporal-history', 'coc_operation_temporal_history.py')
_load_operation_module('timeline', 'coc_operation_timeline.py')
_load_operation_module('memory-extraction', 'coc_operation_memory_extraction.py')
_load_operation_module('world-time-effects', 'coc_operation_world_time_effects.py')
_load_operation_module('turn-output', 'coc_operation_turn_output.py')
_load_operation_module('steward', 'coc_operation_steward.py')
_load_operation_module('development', 'coc_operation_development.py')


_MUTATING_TOOLS = frozenset({
    "session.delivery_ack",
    "npc.reaction",
    "rules.roll",
    "rules.check",
    "rules.resource_delta",
    "rules.push",
    "rules.roll_dice",
    "rules.opposed",
    "rules.sanity_check",
    "rules.damage",
    "rules.luck_spend",
    "rules.first_aid",
    "rules.medicine",
    "rules.weekly_recovery",
    "rules.dying_check",
    "combat.resolve",
    "combat.end",
    "chase.execute",
    "sanity.execute",
    "development.settle",
    "evidence.record_adoption",
    "evidence.table_opening",
    "narration.review",
    "state.personal_horror_add",
    "state.personal_horror_mark_woven",
    "state.backstory_corruption_add",
    "state.threat_tick",
    "state.belief_apply",
    "state.cash_semantic",
    "state.record_clue",
    "state.deliver_handout",
    "state.replay_handout",
    "state.move_scene",
    "state.set_flag",
    "state.clear_transient_condition",
    "state.item_grant",
    "state.cash_grant",
    "state.cash_spend",
    "state.purchase",
    "state.assets_liquidate",
    "state.item_remove",
    "state.record_npc_engagement",
    "state.record_route_completion",
    "state.npc_presence",
    "state.npc_update",
    "state.time_marker",
    "state.advance_time",
    "state.clock_discontinuity",
    "state.mark_safe_rest",
    "state.exceptional_effect",
    "state.supersede_settlement",
    "state.journal",
    "state.end_session",
    "memory.adjudicate",
    "memory.extraction_settle",
    "timeline.fork_request",
    "timeline.fork_confirm",
    "timeline.confluence_confirm",
    "timeline.transfer",
    "steward.domain_put",
    "steward.deliver",
    "steward.notebook_put",
    "steward.notebook_pay",
    "steward.mark_consumed",
    "turn.finalize",
})
OPERATION_REGISTRY.require_decision_ids(_MUTATING_TOOLS)
OPERATION_REGISTRY.validate_policies(
    coc_operation_policy.policies_for_operations(TOOLS)
)


def operation_policy(name: str) -> dict[str, Any]:
    spec = TOOLS.get(name)
    if spec is None:
        raise KeyError(name)
    canonical = OPERATION_REGISTRY.specs.get(name)
    if canonical is not None:
        return canonical.policy.public()
    policy = spec.get("policy")
    if not isinstance(policy, dict):
        policy = coc_operation_policy.policy_for_operation(name)
    return coc_operation_policy.public_policy(policy)


def query_operations(
    *,
    audience: str | None = None,
    phase: str | None = None,
    kp_surface: str | None = None,
    contract: str | None = None,
) -> list[str]:
    if set(TOOLS) == set(OPERATION_REGISTRY.specs):
        return OPERATION_REGISTRY.query(
            audience=audience,
            phase=phase,
            kp_surface=kp_surface,
            contract=contract,
        )
    policies = {
        name: spec.get("policy") or coc_operation_policy.policy_for_operation(name)
        for name, spec in TOOLS.items()
    }
    return coc_operation_policy.query_operations(
        policies,
        audience=audience,
        phase=phase,
        kp_surface=kp_surface,
        contract=contract,
    )


def _describe(name: str) -> dict[str, Any]:
    if name in OPERATION_REGISTRY.specs:
        return OPERATION_REGISTRY.describe(name)
    spec = TOOLS[name]
    return {
        "name": spec["name"],
        "summary": spec["summary"],
        "needs_campaign": spec["needs_campaign"],
        "access": spec.get("access", "mutation"),
        "read_domains": list(spec.get("read_domains") or ()),
        "write_domains": list(spec.get("write_domains") or ()),
        "recovery_domains": (
            None
            if spec.get("recovery_domains") is None
            else list(spec.get("recovery_domains") or ())
        ),
        "response_mode": spec.get("response_mode", "full"),
        "audit_mode": spec.get("audit_mode", "full"),
        "execution_class": spec.get("execution_class", "serial_campaign"),
        "policy": operation_policy(name),
        "params": spec["params"],
    }


def list_tools() -> list[dict[str, Any]]:
    return [
        {
            "name": n,
            "summary": TOOLS[n]["summary"],
            "access": TOOLS[n].get("access", "mutation"),
            "execution_class": TOOLS[n].get("execution_class", "serial_campaign"),
            "policy": operation_policy(n),
        }
        for n in sorted(TOOLS)
    ]


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        print("tools:")
        for entry in list_tools():
            print(f"  {entry['name']:24s} {entry['summary']}")
        return 0

    command = argv[0]
    if command == "list":
        print(json.dumps({"tools": list_tools()}, ensure_ascii=False, indent=2))
        return 0
    if command == "describe":
        if len(argv) < 2 or argv[1] not in TOOLS:
            print(json.dumps({"ok": False, "error": {"code": "unknown_tool", "message": "describe <tool>"}}))
            return 1
        print(json.dumps(_describe(argv[1]), ensure_ascii=False, indent=2))
        return 0

    parser = argparse.ArgumentParser(prog=f"coc_toolbox.py {command}")
    parser.add_argument("--root", default=".", help="project root containing .coc/")
    parser.add_argument("--campaign", default=None, help="campaign id")
    input_group = parser.add_mutually_exclusive_group()
    input_group.add_argument(
        "--json", default=None, help="tool arguments as a JSON object",
    )
    input_group.add_argument(
        "--json-stdin",
        action="store_true",
        help="read one tool-arguments JSON object from standard input",
    )
    opts = parser.parse_args(argv[1:])
    try:
        raw_args = sys.stdin.read() if opts.json_stdin else opts.json
        args = json.loads(raw_args) if raw_args else {}
    except json.JSONDecodeError as exc:
        print(json.dumps({"ok": False, "error": {"code": "bad_json", "message": str(exc)}}))
        return 1
    if not isinstance(args, dict):
        source = "--json-stdin" if opts.json_stdin else "--json"
        print(json.dumps({
            "ok": False,
            "error": {
                "code": "bad_json",
                "message": f"{source} must be an object",
            },
        }))
        return 1

    envelope = run_tool(command, Path(opts.root).resolve(), opts.campaign, args)
    print(json.dumps(envelope, ensure_ascii=False, indent=2))
    return 0 if envelope.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
