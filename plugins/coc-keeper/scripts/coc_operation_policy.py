#!/usr/bin/env python3
"""Structured policy metadata for canonical toolbox operations.

This is a queryable fact source for Pi-Coc domain tools and later ACL
planning. It is not an invoke gate: callers may still execute any registered
operation through the existing toolbox/MCP paths.
"""
from __future__ import annotations

from typing import Any, Iterable, Mapping


AUDIENCES = frozenset({"keeper", "setup", "host", "source_worker", "audit"})
PHASES = frozenset({
    "cold_start",
    "opening",
    "live_turn",
    "pending_finalization",
    "recovery",
    "ending",
})
CONTRACTS = frozenset({
    "rules",
    "state",
    "finalize",
    "module_secret",
    "advisory",
    "source_lifecycle",
    "none",
})
KP_SURFACES = frozenset({
    "context",
    "rules",
    "state",
    "npc",
    "turn",
    "setup",
    "advice",
    "subsystem",
    "none",
})
DISCOVERY_MODES = frozenset({"surface", "exact"})

# Host-private operations (`kp_surface: "none"`) that the model may still
# reach through the hidden `coc_invoke` compatibility wrapper. Every other
# host-private operation has NO model-facing invocation at all: the Pi execute
# ACL refuses it with `host_private_operation`, so nothing may advertise one.
#
# This list is canonical here and projected into
# `pi/lib/operation-policy.generated.ts`; the Pi ACL and the wire-projection
# replay cards must not keep separate copies that can drift apart.
HOST_INVOKE_COMPAT_OPERATIONS = frozenset({
    "progressive.project_opening",
    "progressive.register_source_bundle",
    "progressive.request_locator_pass",
    "progressive.request_opening_pack",
    "progressive.retry_full_parse",
    "progressive.status",
    "session.begin",
    "session.continuation_detail",
    "session.delivery_ack",
})

# Model-facing wrapper tool for each non-`none` KP surface. A replay card for
# an operation on one of these surfaces names its domain tool, never
# `coc_invoke` (which is the host-private compatibility wrapper).
_TOOL_BY_KP_SURFACE: dict[str, str] = {
    "context": "coc_context",
    "rules": "coc_rules",
    "state": "coc_state",
    "npc": "coc_npc",
    "turn": "coc_turn",
    "setup": "coc_setup",
    "advice": "coc_advice",
    "subsystem": "coc_subsystem",
}


def model_invocation_tool(operation: str) -> str | None:
    """Tool the model may invoke ``operation`` through, or None if host-private.

    ``None`` means the operation has no model-facing invocation: it is
    ``kp_surface: "none"`` and outside the ``coc_invoke`` compatibility set.
    Callers building a model-facing replay/continuation card MUST NOT invent
    one; the Pi execute ACL will refuse it and the model spends a round trip
    discovering that.
    """
    surface = str(policy_for_operation(operation).get("kp_surface") or "none")
    if surface != "none":
        return _TOOL_BY_KP_SURFACE.get(surface)
    if operation in HOST_INVOKE_COMPAT_OPERATIONS:
        return "coc_invoke"
    return None

_RULESET_POLICY_OVERRIDES: dict[str, dict[str, Any]] | None = None

# Domain defaults apply to every registered operation in that prefix.
# Exact operation names in OPERATION_POLICY_EXCEPTIONS overlay these fields.
_DOMAIN_DEFAULTS: dict[str, dict[str, Any]] = {
    "setup": {
        "audience": "setup",
        "phases": ("cold_start", "opening", "live_turn"),
        "contract": "none",
        "advisory": False,
        "kp_surface": "setup",
    },
    "rules": {
        "audience": "keeper",
        "phases": ("live_turn",),
        "contract": "rules",
        "advisory": False,
        "kp_surface": "rules",
    },
    "state": {
        "audience": "keeper",
        "phases": ("live_turn",),
        "contract": "state",
        "advisory": False,
        "kp_surface": "state",
    },
    "progressive": {
        "audience": "keeper",
        "phases": ("opening", "live_turn"),
        "contract": "none",
        "advisory": False,
        "kp_surface": "setup",
    },
    "combat": {
        "audience": "keeper",
        "phases": ("live_turn",),
        "contract": "rules",
        "advisory": False,
        "kp_surface": "subsystem",
    },
    "chase": {
        "audience": "keeper",
        "phases": ("live_turn",),
        "contract": "rules",
        "advisory": False,
        "kp_surface": "subsystem",
    },
    "sanity": {
        "audience": "keeper",
        "phases": ("live_turn",),
        "contract": "rules",
        "advisory": False,
        "kp_surface": "subsystem",
    },
    "mechanics": {
        "audience": "keeper",
        "phases": ("live_turn",),
        "contract": "rules",
        "advisory": False,
        "kp_surface": "subsystem",
    },
    "magic": {
        "audience": "keeper",
        "phases": ("live_turn",),
        "contract": "rules",
        "advisory": False,
        "kp_surface": "subsystem",
        "discovery": "exact",
    },
    "scene": {
        "audience": "keeper",
        "phases": ("opening", "live_turn", "pending_finalization"),
        "contract": "none",
        "advisory": False,
        "kp_surface": "context",
    },
    "module": {
        "audience": "keeper",
        "phases": ("opening", "live_turn", "pending_finalization"),
        "contract": "module_secret",
        "advisory": False,
        "kp_surface": "context",
    },
    "session": {
        "audience": "host",
        "phases": ("cold_start", "recovery", "live_turn"),
        "contract": "none",
        "advisory": False,
        "kp_surface": "none",
    },
    "clues": {
        "audience": "keeper",
        "phases": ("opening", "live_turn", "pending_finalization"),
        "contract": "none",
        "advisory": False,
        "kp_surface": "context",
    },
    "npc": {
        "audience": "keeper",
        "phases": ("opening", "live_turn", "pending_finalization"),
        "contract": "none",
        "advisory": False,
        "kp_surface": "npc",
    },
    "actions": {
        "audience": "keeper",
        "phases": ("live_turn",),
        "contract": "advisory",
        "advisory": True,
        "kp_surface": "advice",
    },
    "director": {
        "audience": "keeper",
        "phases": ("live_turn",),
        "contract": "advisory",
        "advisory": True,
        "kp_surface": "advice",
    },
    "storylets": {
        "audience": "keeper",
        "phases": ("live_turn",),
        "contract": "advisory",
        "advisory": True,
        "kp_surface": "advice",
    },
    "personal_horror": {
        "audience": "keeper",
        "phases": ("opening", "live_turn", "pending_finalization"),
        "contract": "none",
        "advisory": False,
        "kp_surface": "context",
    },
    # history.* reads the committed git-backed authority history through
    # the rebuildable projection. Pure context reads: live turns, turn
    # settlement checks, and recovery diagnosis all need them, and the
    # projection never gates or mutates play.
    "history": {
        "audience": "keeper",
        "phases": ("live_turn", "pending_finalization", "recovery"),
        "contract": "none",
        "advisory": False,
        "kp_surface": "context",
    },
    # events.* is the strict read-only narrowing surface over the rebuildable
    # canonical-events projection (generation coc-events-1). Same class of
    # context read as history.*: derived evidence, never authority, never a
    # play gate; secret events stay Keeper-side behind the privacy view.
    "events": {
        "audience": "keeper",
        "phases": ("live_turn", "pending_finalization", "recovery"),
        "contract": "none",
        "advisory": False,
        "kp_surface": "context",
    },
    # transcript.* is the exact historical table-transcript surface:
    # transcript.locate is bounded deterministic structured narrowing over
    # committed campaign git history, and transcript.read returns exact
    # hash-verified wording bound to turn-finalization receipts under the
    # canonical production contract. A strict context read like history.*:
    # never a play gate, never a mutation, never free-prose matching.
    # Deliberately NOT legal during pending_finalization: the settled-turn
    # output boundary owns that phase, and historical wording retrieval is
    # a live-turn or recovery activity.
    "transcript": {
        "audience": "keeper",
        "phases": ("live_turn", "recovery"),
        "contract": "none",
        "advisory": False,
        "kp_surface": "context",
    },
    # memory.* is the KP-facing temporal story-memory surface under schema
    # generation temporal-memory-1: memory.adjudicate and extraction settle
    # are state-contract mutations on the temporal store, while the strict
    # read-only recall/extraction_status queries widen to a context surface
    # through the exceptions below.
    "memory": {
        "audience": "keeper",
        "phases": ("live_turn",),
        "contract": "state",
        "advisory": False,
        "kp_surface": "state",
    },
    # timeline.* is the KP worldline surface over the campaign git timeline
    # coordinator: fork_request records a receipt, fork_confirm creates and
    # activates a new timeline, confluence_confirm merges two worldlines into
    # a third two-parent line, and confluence_query is the strict read-only
    # conflict enumeration feeding it. State-contract mutations executed
    # under the campaign lock; parent history stays immutable.
    "timeline": {
        "audience": "keeper",
        "phases": ("live_turn",),
        "contract": "state",
        "advisory": False,
        "kp_surface": "state",
    },
    # quest.* is the action-quest lifecycle surface: offer/activate/settle are
    # state-contract transitions and quest.map/improvise share the domain.
    # Opening included because commissions are typically offered in the
    # opening; pending_finalization because a settle can land while closing a
    # turn. Quest pressure itself is advisory and never gates play.
    "quest": {
        "audience": "keeper",
        "phases": ("opening", "live_turn", "pending_finalization"),
        "contract": "state",
        "advisory": False,
        "kp_surface": "state",
    },
    "threat": {
        "audience": "keeper",
        "phases": ("opening", "live_turn", "pending_finalization"),
        "contract": "none",
        "advisory": False,
        "kp_surface": "context",
    },
    "epistemic": {
        "audience": "keeper",
        "phases": ("opening", "live_turn", "pending_finalization"),
        "contract": "none",
        "advisory": False,
        "kp_surface": "context",
    },
    "narration": {
        "audience": "keeper",
        "phases": ("live_turn", "pending_finalization"),
        "contract": "advisory",
        "advisory": True,
        "kp_surface": "advice",
    },
    "evidence": {
        "audience": "keeper",
        "phases": ("live_turn",),
        "contract": "none",
        "advisory": False,
        "kp_surface": "context",
    },
    "secrets": {
        "audience": "keeper",
        "phases": ("opening", "live_turn", "pending_finalization"),
        "contract": "module_secret",
        "advisory": False,
        "kp_surface": "context",
    },
    "steward": {
        "audience": "host",
        "phases": ("live_turn",),
        "contract": "none",
        "advisory": False,
        "kp_surface": "none",
    },
    "turn": {
        "audience": "keeper",
        # recovery: close an already-open turn from existing receipts only.
        # Startup pending still hard-rejects these via the host resume gate.
        "phases": ("live_turn", "pending_finalization", "recovery"),
        "contract": "finalize",
        "advisory": False,
        "kp_surface": "turn",
    },
    "development": {
        "audience": "audit",
        "phases": ("ending",),
        "contract": "none",
        "advisory": False,
        "kp_surface": "none",
    },
}

# Exact operation overlays. Extra or missing keys versus TOOLS fail closed.
OPERATION_POLICY_EXCEPTIONS: dict[str, dict[str, Any]] = {
    # memory.recall is the temporal-memory narrowing query: a strict
    # read-only context read beside the other recall projections, while
    # memory.adjudicate keeps the domain's state contract below.
    "memory.recall": {
        "contract": "none",
        "kp_surface": "context",
        "phases": ("opening", "live_turn", "pending_finalization"),
    },
    # memory.extraction_status is the strict read-only extraction-backlog
    # listing: a context read over the temporal store's backlog, available
    # wherever the KP might settle recovery debt (live turns, settlement
    # checks, resume/recovery diagnosis).
    "memory.extraction_status": {
        "contract": "none",
        "kp_surface": "context",
        "phases": ("live_turn", "pending_finalization", "recovery"),
    },
    # memory.extraction_settle keeps the memory domain's state contract and
    # only widens phases: clearing extraction backlog is not turn-scoped —
    # it can land mid-turn or during post-resume recovery.
    "memory.extraction_settle": {
        "phases": ("live_turn", "pending_finalization", "recovery"),
    },
    # timeline.confluence_query is the read-only conflict enumeration for
    # a KP worldline merge: a context read over the history projection,
    # needed wherever the KP might weigh or replay a confluence (live
    # turns, settlement checks, recovery diagnosis), while
    # timeline.confluence_confirm keeps the domain's state contract below.
    # ``ending`` is required alongside recovery: the measured
    # 2026-08-26 worldline-accept-20260827 run reached its player-visible
    # confluence only AFTER state.end_session settled the segment (phase
    # rejection observed live: "not allowed in phase ending"); a closed
    # segment's worldline bookkeeping is exactly the post-ending case.
    "timeline.confluence_query": {
        "contract": "none",
        "kp_surface": "context",
        "phases": ("live_turn", "pending_finalization", "recovery", "ending"),
    },
    # timeline.confluence_confirm keeps the domain's state contract but
    # widens phases like its read-only sibling below: a real worldline
    # merge legitimately continues around settlement and recovery — the
    # measured 2026-08-26 worldline acceptance run hit a phase-gate
    # rejection when the KP confirmed a merge while the turn was already
    # settling / during post-resume recovery (worldline-accept findings).
    # Widening is not turn-scoped scope creep: confirm remains a serial,
    # fail-closed, receipted mutation identical in every phase.
    "timeline.confluence_confirm": {
        "phases": ("live_turn", "pending_finalization", "recovery", "ending"),
    },
    "actions.list": {
        "contract": "none",
        "advisory": False,
        "kp_surface": "context",
        "phases": ("opening", "live_turn", "pending_finalization"),
    },
    "npc.reaction": {
        "contract": "rules",
        "advisory": False,
        "kp_surface": "npc",
        "phases": ("opening", "live_turn"),
    },
    "npc.advise": {
        "contract": "advisory",
        "advisory": True,
        "kp_surface": "advice",
        "phases": ("live_turn",),
    },
    "state.end_session": {
        "phases": ("live_turn",),
    },
    "state.journal": {
        "phases": ("live_turn", "pending_finalization", "recovery", "ending"),
        "kp_surface": "turn",
    },
    # session.delivery_text exact replay is a typed Keeper context read: the
    # live KP may request a semantic replay of the latest canonical delivery
    # while the host binds machine identity and streams exact chunks. Recovery
    # is required: replay after restart reads the durable checkpoint, not
    # memory. pending_finalization stays excluded like transcript.* — the
    # settled-turn output boundary owns that phase.
    "session.delivery_text": {
        "audience": "keeper",
        "kp_surface": "context",
        "phases": ("live_turn", "recovery"),
    },
    "state.exceptional_effect": {
        "phases": ("live_turn", "pending_finalization"),
    },
    "state.supersede_settlement": {
        "phases": ("recovery", "live_turn", "pending_finalization"),
    },
    "state.recover_pending_narration_draft": {
        "audience": "host",
        "phases": ("pending_finalization", "recovery"),
        "contract": "state",
        "advisory": False,
        "kp_surface": "none",
    },
    "state.inventory_list": {
        "phases": ("live_turn", "pending_finalization", "opening"),
    },
    "state.record_npc_engagement": {
        "phases": ("opening", "live_turn", "pending_finalization"),
    },
    "setup.complete": {
        # live_turn: in-process chargen/link or session.resume can advance
        # the host phase before handoff; setup.complete must still be legal.
        "phases": ("cold_start", "opening", "live_turn"),
        "contract": "state",
    },
    "evidence.table_opening": {
        "phases": ("opening",),
    },
    "turn.output_context": {
        "contract": "none",
    },
    "progressive.prepare_opening": {
        "audience": "keeper",
        "phases": ("opening",),
        "kp_surface": "setup",
    },
    "progressive.opening_bootstrap": {
        "audience": "keeper",
        "phases": ("opening",),
        "kp_surface": "setup",
    },
    "progressive.publish_skeleton": {
        "audience": "source_worker",
        "phases": ("opening", "live_turn"),
        "contract": "source_lifecycle",
        "kp_surface": "none",
    },
    "progressive.request_opening_pack": {
        "audience": "host",
        "phases": ("opening",),
        "contract": "source_lifecycle",
        "kp_surface": "none",
    },
    "progressive.request_locator_pass": {
        "audience": "host",
        "phases": ("opening", "live_turn"),
        "contract": "source_lifecycle",
        "kp_surface": "none",
    },
    "progressive.project_opening": {
        "audience": "host",
        "phases": ("opening",),
        "kp_surface": "none",
    },
    "progressive.request_mechanics": {
        "audience": "keeper",
        "phases": ("live_turn",),
        "kp_surface": "setup",
    },
    "progressive.follow_mentions": {
        "audience": "keeper",
        "phases": ("live_turn",),
        "kp_surface": "setup",
    },
    "progressive.register_source_bundle": {
        "audience": "host",
        "phases": ("cold_start", "opening"),
        "contract": "source_lifecycle",
        "kp_surface": "none",
    },
    "progressive.claim_host_work": {
        "audience": "source_worker",
        "phases": ("opening", "live_turn"),
        "contract": "source_lifecycle",
        "kp_surface": "none",
    },
    "progressive.renew_host_work_leases": {
        "audience": "source_worker",
        "phases": ("opening", "live_turn"),
        "contract": "source_lifecycle",
        "kp_surface": "none",
    },
    "progressive.release_host_work_leases": {
        "audience": "source_worker",
        "phases": ("opening", "live_turn"),
        "contract": "source_lifecycle",
        "kp_surface": "none",
    },
    "progressive.fulfill_host_work": {
        "audience": "source_worker",
        "phases": ("opening", "live_turn"),
        "contract": "source_lifecycle",
        "kp_surface": "none",
    },
    "progressive.on_enter_scene": {
        "audience": "keeper",
        "phases": ("live_turn",),
        "kp_surface": "setup",
    },
    "progressive.status": {
        "audience": "host",
        "phases": ("opening", "live_turn", "recovery"),
        "kp_surface": "none",
    },
    "progressive.retry_full_parse": {
        "audience": "host",
        "phases": ("opening", "recovery"),
        "contract": "source_lifecycle",
        "kp_surface": "none",
    },
    "steward.scene_supply": {
        "audience": "keeper",
        "phases": ("opening", "live_turn", "pending_finalization"),
        "kp_surface": "context",
    },
    "steward.deliveries": {
        "audience": "keeper",
        "phases": ("opening", "live_turn", "pending_finalization"),
        "kp_surface": "context",
    },
    "steward.notebook": {
        "audience": "keeper",
        "phases": ("opening", "live_turn", "pending_finalization"),
        "kp_surface": "context",
    },
    # rules.patch records a house rule or session ruling that enables or
    # disables one ruleset-declared optional rule. It is a Keeper state
    # write on the rules surface: the ruling must reach the runtime and the
    # next settlement, not only the transcript. Opening is included because
    # a table agrees its house rules before the first scene.
    "rules.patch": {
        "contract": "state",
        "kp_surface": "rules",
        "phases": ("opening", "live_turn"),
    },
    "rules.context": {
        # RuleGraph applicability is a normal Keeper read. Keep it beside
        # rules.settle so the model can inspect a current card before settling
        # instead of falling back to hidden legacy operations.
        "contract": "none",
        "advisory": True,
        "kp_surface": "rules",
        "phases": ("live_turn",),
        "discovery": "surface",
    },
    # R5: low-level package primitives leave the Keeper working set.
    # Live Keepers use rules.roll for ordinary checks; graph effects invoke
    # resource_delta. Both stay registered as host-internal adapters.
    # Precedent is a Keeper surface, not a gate. Recording is a deliberate act
    # after a call has been made, so it sits beside rules.settle where the
    # Keeper already is; reading is folded into rules.context, so rules.precedent
    # stays off the ordinary hotset and is reached only on purpose.
    "rules.record_ruling": {
        "audience": "keeper",
        "contract": "advisory",
        "advisory": True,
        "kp_surface": "rules",
        "phases": ("live_turn",),
        "discovery": "surface",
    },
    "rules.precedent": {
        "audience": "keeper",
        "contract": "none",
        "advisory": True,
        "kp_surface": "rules",
        "phases": ("live_turn",),
        "discovery": "exact",
    },
    "rules.check": {
        "audience": "host",
        "kp_surface": "none",
        "phases": ("live_turn",),
    },
    "rules.resource_delta": {
        "audience": "host",
        "kp_surface": "none",
        "phases": ("live_turn",),
    },
    # A stat is the Keeper's to change when the source says so: a spell's POW
    # cost, a drain, time-loop ageing, or whatever this table's house rules
    # cost. Nothing could reach one before -- `rules.resource_delta` declares
    # only the four coc7 pools and no rule-graph decision touches a
    # characteristic -- so an authored consequence had no canonical path and
    # the Keeper improvised with HP damage at a live table. This is a KP
    # surface, not a host adapter.
    #
    # The name is the word the Keeper actually reaches for. Renaming it to
    # `state.stat_delta` -- more accurate, since it takes derived values and
    # house-rule stats too -- made it undiscoverable in one live turn: the
    # Keeper guessed `state.characteristic_adjust`,
    # `state.adjust_characteristic`, `rules.characteristic_damage` and
    # `state.resource_adjust`, never found it, and narrated a STR loss that
    # never reached the sheet. Listing the namespace is not a fallback either
    # (`state` is over the discovery budget). Under the old name it guessed
    # right on the first try, twice.
    "state.characteristic_delta": {
        "audience": "keeper",
        "kp_surface": "state",
        "contract": "state",
        "phases": ("live_turn",),
    },
    "rules.roll_dice": {
        "phases": ("cold_start", "opening", "live_turn"),
    },
    "rules.cash_assets": {
        "phases": ("cold_start", "opening", "live_turn"),
    },
    "rules.catalog_search": {
        "phases": ("cold_start", "opening", "live_turn"),
        "contract": "advisory",
        "advisory": True,
    },
    "state.cash_semantic": {
        "phases": ("cold_start", "opening", "live_turn"),
    },
    "session.resume": {
        "audience": "keeper",
        "phases": ("cold_start", "opening", "recovery", "live_turn", "pending_finalization"),
        "kp_surface": "setup",
    },
    "turn.finalize": {
        "phases": ("live_turn", "pending_finalization", "recovery", "ending"),
    },
    "turn.output_context": {
        "phases": ("live_turn", "pending_finalization", "recovery", "ending"),
    },
    "combat.context": {
        "phases": ("live_turn", "pending_finalization"),
    },
    "chase.context": {
        "phases": ("live_turn", "pending_finalization"),
    },
    "sanity.context": {
        "phases": ("live_turn", "pending_finalization"),
    },
}

# Hidden coc_invoke may reach these host-owned queries. They stay off every
# domain enum and are never live-KP audience=keeper. session.delivery_text
# left this set when exact replay became a typed Keeper context read.
HOST_INVOKE_COMPAT_OPERATIONS = frozenset({
    "progressive.status",
    "progressive.project_opening",
    "progressive.register_source_bundle",
    "progressive.request_opening_pack",
    "progressive.request_locator_pass",
    "progressive.retry_full_parse",
    "session.begin",
    "session.continuation_detail",
    "session.delivery_ack",
})

SOURCE_WORKER_LIFECYCLE_OPERATIONS = frozenset({
    "progressive.claim_host_work",
    "progressive.renew_host_work_leases",
    "progressive.release_host_work_leases",
    "progressive.fulfill_host_work",
    "progressive.publish_skeleton",
})


def domain_of(operation: str) -> str:
    if "." not in operation:
        return operation
    return operation.split(".", 1)[0]


def _normalized_policy(raw: Mapping[str, Any]) -> dict[str, Any]:
    audience = str(raw["audience"])
    phases = tuple(raw["phases"])
    contract = str(raw["contract"])
    kp_surface = str(raw["kp_surface"])
    advisory = bool(raw["advisory"])
    discovery = str(raw.get("discovery") or "surface")
    if audience not in AUDIENCES:
        raise ValueError(f"invalid operation audience: {audience}")
    if not phases or any(phase not in PHASES for phase in phases):
        raise ValueError(f"invalid operation phases: {phases!r}")
    if contract not in CONTRACTS:
        raise ValueError(f"invalid operation contract: {contract}")
    if kp_surface not in KP_SURFACES:
        raise ValueError(f"invalid operation kp_surface: {kp_surface}")
    if discovery not in DISCOVERY_MODES:
        raise ValueError(f"invalid operation discovery mode: {discovery}")
    if advisory and contract not in {"advisory", "none"}:
        # Advisory is a contract/classification flag, never a read-only access
        # rewrite. Allow only advisory/none so dice/state/finalize stay hard.
        raise ValueError(
            f"advisory policy cannot use hard contract {contract!r}"
        )
    return {
        "audience": audience,
        "phases": phases,
        "contract": contract,
        "advisory": advisory,
        "kp_surface": kp_surface,
        "discovery": discovery,
    }


def policy_for_operation(operation: str) -> dict[str, Any]:
    """Return the deterministic policy for one canonical operation name."""
    domain = domain_of(operation)
    default = _DOMAIN_DEFAULTS.get(domain)
    if default is None:
        raise KeyError(f"no domain policy default for operation {operation!r}")
    overlay = OPERATION_POLICY_EXCEPTIONS.get(operation) or {}
    ruleset_overlay = _ruleset_policy_overrides().get(operation) or {}
    merged = {**default, **overlay, **ruleset_overlay}
    return _normalized_policy(merged)


def _ruleset_policy_overrides() -> dict[str, dict[str, Any]]:
    global _RULESET_POLICY_OVERRIDES
    if _RULESET_POLICY_OVERRIDES is not None:
        return _RULESET_POLICY_OVERRIDES
    try:
        import coc_rulesets

        ruleset_id = coc_rulesets.DEFAULT_RULESET_ID
        adapter = coc_rulesets.get_rule_graph_adapter(ruleset_id)
        manifest = coc_rulesets.load_manifest(ruleset_id)
        provider = getattr(adapter, "operation_policy_overrides", None)
        raw = provider(manifest) if callable(provider) else {}
        _RULESET_POLICY_OVERRIDES = {
            str(name): dict(value)
            for name, value in (raw.items() if isinstance(raw, Mapping) else [])
            if isinstance(value, Mapping)
        }
    except (ImportError, ValueError):
        _RULESET_POLICY_OVERRIDES = {}
    return _RULESET_POLICY_OVERRIDES


def policies_for_operations(operations: Iterable[str]) -> dict[str, dict[str, Any]]:
    names = list(operations)
    extra = sorted(set(OPERATION_POLICY_EXCEPTIONS) - set(names))
    if extra:
        raise ValueError(
            "operation policy exceptions not present in registry: "
            + ", ".join(extra)
        )
    return {name: policy_for_operation(name) for name in names}


def public_policy(policy: Mapping[str, Any]) -> dict[str, Any]:
    """JSON-friendly projection used by describe/list/discovery."""
    return {
        "audience": policy["audience"],
        "phases": list(policy["phases"]),
        "contract": policy["contract"],
        "advisory": bool(policy["advisory"]),
        "kp_surface": policy["kp_surface"],
        "discovery": policy.get("discovery", "surface"),
    }


def query_operations(
    policies: Mapping[str, Mapping[str, Any]],
    *,
    audience: str | None = None,
    phase: str | None = None,
    kp_surface: str | None = None,
    contract: str | None = None,
    discovery: str | None = None,
) -> list[str]:
    """Filter registered operations by structured policy fields.

    This helper never grants or denies execution.
    """
    if audience is not None and audience not in AUDIENCES:
        raise ValueError(f"invalid audience filter: {audience}")
    if phase is not None and phase not in PHASES:
        raise ValueError(f"invalid phase filter: {phase}")
    if kp_surface is not None and kp_surface not in KP_SURFACES:
        raise ValueError(f"invalid kp_surface filter: {kp_surface}")
    if contract is not None and contract not in CONTRACTS:
        raise ValueError(f"invalid contract filter: {contract}")
    if discovery is not None and discovery not in DISCOVERY_MODES:
        raise ValueError(f"invalid discovery filter: {discovery}")
    matched: list[str] = []
    for name in sorted(policies):
        policy = policies[name]
        if audience is not None and policy.get("audience") != audience:
            continue
        if phase is not None and phase not in tuple(policy.get("phases") or ()):
            continue
        if kp_surface is not None and policy.get("kp_surface") != kp_surface:
            continue
        if contract is not None and policy.get("contract") != contract:
            continue
        if discovery is not None and policy.get("discovery", "surface") != discovery:
            continue
        matched.append(name)
    return matched
