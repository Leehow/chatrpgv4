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
    "scene": {
        "audience": "keeper",
        "phases": ("opening", "live_turn", "pending_finalization"),
        "contract": "none",
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
        "phases": ("live_turn",),
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
    "state.exceptional_effect": {
        "phases": ("live_turn", "pending_finalization"),
    },
    "state.supersede_settlement": {
        "phases": ("recovery", "live_turn", "pending_finalization"),
    },
    "state.inventory_list": {
        "phases": ("live_turn", "pending_finalization", "opening"),
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
# domain enum and are never live-KP audience=keeper.
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
    "session.delivery_text",
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
    if audience not in AUDIENCES:
        raise ValueError(f"invalid operation audience: {audience}")
    if not phases or any(phase not in PHASES for phase in phases):
        raise ValueError(f"invalid operation phases: {phases!r}")
    if contract not in CONTRACTS:
        raise ValueError(f"invalid operation contract: {contract}")
    if kp_surface not in KP_SURFACES:
        raise ValueError(f"invalid operation kp_surface: {kp_surface}")
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
    }


def policy_for_operation(operation: str) -> dict[str, Any]:
    """Return the deterministic policy for one canonical operation name."""
    domain = domain_of(operation)
    default = _DOMAIN_DEFAULTS.get(domain)
    if default is None:
        raise KeyError(f"no domain policy default for operation {operation!r}")
    overlay = OPERATION_POLICY_EXCEPTIONS.get(operation) or {}
    merged = {**default, **overlay}
    return _normalized_policy(merged)


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
    }


def query_operations(
    policies: Mapping[str, Mapping[str, Any]],
    *,
    audience: str | None = None,
    phase: str | None = None,
    kp_surface: str | None = None,
    contract: str | None = None,
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
        matched.append(name)
    return matched
