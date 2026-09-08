"""RuleGraph loading, condition evaluation and the RulesRuntime. Ported from
scripts/coc_rules_runtime.py.

Kept: graph indexing, applicability, cards, card grants, `answers_declared_intent`,
`facts_from_state`, `evaluate_condition`, `_compile_plan`, `settle`, the manifest
digest check. Dropped: shadow comparators, family-ownership negotiation (every
family is graph-owned in the shipped graph), host-internal finding logs.

The runtime never rolls dice, writes campaign state or renders narration; it
compiles one decision into a plan and hands the plan to the injected executor."""

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from types import MappingProxyType
from typing import Any, Callable, Iterable, Mapping

from ..fileio import canonical_json, read_json, sha256_text

CARD_GRANT_CONTRACT_ID = "coc.rule-graph-card-grant.v1"
CARD_GRANT_SCHEMA_VERSION = 1
GRAPH_CONTRACT_ID = "coc.rule-graph.v1"
MANIFEST_CONTRACT_ID = "coc.rule-graph-build-manifest.v1"

_SEMANTIC_SLOT_OWNERSHIPS = frozenset({"keeper-semantic", "optional-semantic", "player-source"})
_REQUIRED_SEMANTIC_OWNERSHIPS = frozenset({"keeper-semantic", "player-source"})
_LOCKED_SLOT_OWNERSHIPS = frozenset({"host-locked", "resolver-owned"})
_CALL_SCOPED_FACT_KEYS = frozenset({"intent.action_kind"})
_GRANT_CONTEXT_KEYS = frozenset({"role", "phase", "stage", "player_turn_epoch", "progress_revision"})
WITHHELD_UNMET_ROW_BUDGET = 24

#: The closed fact vocabulary from references/rule-graph-contract-v1.json
#: (`registered_condition_paths`). The graph can never read arbitrary state.
REGISTERED_CONDITION_PATHS: frozenset[str] = frozenset({
    "actor.conditions", "actor.conditions.dead", "actor.conditions.dying", "actor.conditions.major_wound",
    "actor.conditions.unconscious", "actor.id", "actor.recovery.major_wound_week_due", "actor.resources.hp",
    "actor.resources.hp_max", "actor.resources.luck", "actor.resources.mp", "actor.resources.san", "actor.sheet.con",
    "campaign.ruleset_id", "campaign.ruleset_version", "chase.conflict.receipt-ready", "chase.pending.kind",
    "chase.session.active", "chase.session.inactive", "chase.start.ready", "clock.dying",
    "development.settlement.pending", "intent.action_kind", "intent.complete_rest", "intent.method",
    "intent.poor_environment", "intent.pushed", "intent.rescuer_count", "magic.learn.source-available",
    "magic.spell.known", "receipt.last_outcome", "receipt.push_eligible", "sanity.bout.pending",
    "sanity.delusion.active", "sanity.gain.pending", "sanity.insane", "sanity.recovery.due", "sanity.treatment.due",
    "scene.id", "subsystem.kind", "subsystem.snapshot.active", "time.day", "time.minutes_since_injury",
})


# ---- freeze helpers -------------------------------------------------------------

def freeze(value: Any) -> Any:
    if isinstance(value, Mapping):
        return MappingProxyType({str(key): freeze(item) for key, item in value.items()})
    if isinstance(value, (list, tuple)):
        return tuple(freeze(item) for item in value)
    if isinstance(value, set):
        return frozenset(freeze(item) for item in value)
    return deepcopy(value)


def thaw(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): thaw(item) for key, item in value.items()}
    if isinstance(value, (tuple, frozenset)):
        return [thaw(item) for item in value]
    return deepcopy(value)


def json_digest(value: Any) -> str:
    return sha256_text(canonical_json(value))


# ---- loading ------------------------------------------------------------------

class GraphLoadError(Exception):
    def __init__(self, reason: str, findings: list[str]) -> None:
        super().__init__(f"{reason}: {'; '.join(findings)}")
        self.reason = reason
        self.findings = findings


def load_ruleset_graph(ruleset_dir: Path) -> dict[str, Any]:
    """Load `rule-graph.json` and `rule-graph-manifest.json` through the package manifest's
    entry points and verify contract ids, ruleset identity and the content digest."""
    ruleset_dir = Path(ruleset_dir)
    try:
        manifest = read_json(ruleset_dir / "manifest.json")
    except (OSError, ValueError) as exc:
        raise GraphLoadError("graph_unloadable", [f"package manifest unreadable: {exc}"]) from exc
    entry_points = (manifest or {}).get("entry_points") or {}
    graph_ref = entry_points.get("rule_graph")
    manifest_ref = entry_points.get("rule_graph_manifest")
    if not isinstance(graph_ref, str) or not isinstance(manifest_ref, str):
        raise GraphLoadError("graph_absent", ["no paired rule_graph entry points in package manifest"])
    try:
        graph = read_json(ruleset_dir / graph_ref)
        graph_manifest = read_json(ruleset_dir / manifest_ref)
    except (OSError, ValueError) as exc:
        raise GraphLoadError("graph_unloadable", [f"artifact read failed: {exc}"]) from exc
    if not isinstance(graph, dict) or not isinstance(graph_manifest, dict):
        raise GraphLoadError("graph_invalid", ["graph artifacts must be JSON objects"])
    ruleset_id = str(manifest.get("ruleset_id") or ruleset_dir.name)
    problems: list[str] = []
    if graph.get("contract_id") != GRAPH_CONTRACT_ID:
        problems.append("graph.contract_id does not match the v1 contract")
    if graph_manifest.get("contract_id") != MANIFEST_CONTRACT_ID:
        problems.append("graph manifest contract_id does not match the v1 contract")
    if graph.get("schema_version") != 1 or graph_manifest.get("schema_version") != 1:
        problems.append("graph schema_version does not match the v1 contract")
    if not isinstance(graph.get("nodes"), list) or not isinstance(graph.get("relations"), list):
        problems.append("graph is missing nodes/relations")
    if graph.get("ruleset_id") != ruleset_id or graph_manifest.get("ruleset_id") != ruleset_id:
        problems.append("graph ruleset_id does not match the requested ruleset")
    declared = graph_manifest.get("graph_content_digest")
    if not isinstance(declared, str) or len(declared) != 64:
        problems.append("graph manifest is missing a declared content digest")
    elif json_digest(graph) != declared:
        problems.append("graph content digest does not match the graph manifest")
    if problems:
        raise GraphLoadError("graph_invalid", problems)
    return {"ok": True, "graph": graph, "graph_manifest": graph_manifest, "package_manifest": manifest,
            "content_digest": declared, "ruleset_id": ruleset_id}


# ---- facts ----------------------------------------------------------------------

def _minutes_since_injury(state: Mapping[str, Any], elapsed_minutes: int | None) -> int | None:
    if not isinstance(elapsed_minutes, int) or isinstance(elapsed_minutes, bool) or elapsed_minutes < 0:
        return None
    ledger = state.get("wound_ledger")
    if not isinstance(ledger, list):
        return None
    # A stamp may be negative (#78): a time loop that keeps its investigators and rewinds the
    # clock moves every filed minute back with it, and a wound taken before the anchor lands
    # before the origin. It is still a wound and still older than now -- the arithmetic below
    # says so on its own. Only the clock itself may not be negative (guarded above).
    occurred = [row["occurred_elapsed_minutes"] for row in ledger
                if isinstance(row, Mapping) and row.get("status") == "active"
                and isinstance(row.get("occurred_elapsed_minutes"), int)
                and not isinstance(row.get("occurred_elapsed_minutes"), bool)]
    if not occurred:
        return None
    return max(0, elapsed_minutes - max(occurred))


def _major_wound_recovery_due(state: Mapping[str, Any], elapsed_minutes: int | None) -> bool | None:
    if ("major_wound" not in (state.get("conditions") or []) or isinstance(elapsed_minutes, bool)
            or not isinstance(elapsed_minutes, int) or elapsed_minutes < 0):
        return None
    ledger = state.get("wound_ledger")
    if not isinstance(ledger, list) or not ledger:
        return None
    active: list[tuple[int, str]] = []
    for row in ledger:
        if not isinstance(row, Mapping) or row.get("status") != "active":
            continue
        stamp, wound_id = row.get("occurred_elapsed_minutes"), row.get("wound_id")
        # Negative is a rewound clock, not corruption (#78); the type guards still stand.
        if isinstance(stamp, bool) or not isinstance(stamp, int) or not isinstance(wound_id, str) or not wound_id:
            return None
        active.append((stamp, wound_id))
    if not active:
        return None
    baseline, active_wound_id = max(active)
    for row in state.get("major_wound_recovery_ledger") or []:
        if not isinstance(row, Mapping):
            return None
        stamp, wound_id = row.get("attempt_elapsed_minutes"), row.get("wound_id")
        if isinstance(stamp, bool) or not isinstance(stamp, int) or not isinstance(wound_id, str) or not wound_id:
            return None
        if wound_id == active_wound_id:
            baseline = max(baseline, stamp)
    return elapsed_minutes - baseline >= 7 * 24 * 60


def facts_from_state(state: dict[str, Any] | None, sheet: dict[str, Any] | None, *,
                     ruleset_id: str | None = None, extra: dict[str, Any] | None = None,
                     elapsed_minutes: int | None = None) -> dict[str, Any]:
    """Project live investigator state into registered fact paths. Boolean condition
    flags are emitted only when true so `exists` / `not exists` gates work."""
    state = state or {}
    sheet = sheet or {}
    characteristics = sheet.get("characteristics") if isinstance(sheet.get("characteristics"), dict) else {}
    derived = sheet.get("derived") if isinstance(sheet.get("derived"), dict) else {}
    conditions = list(state.get("conditions") or [])
    facts: dict[str, Any] = {
        "actor.id": state.get("investigator_id"),
        "actor.resources.hp": state.get("current_hp"),
        "actor.resources.hp_max": derived.get("HP"),
        "actor.resources.san": state.get("current_san"),
        "actor.resources.mp": state.get("current_mp"),
        "actor.resources.luck": state.get("current_luck"),
        "actor.sheet.con": characteristics.get("CON"),
        "actor.conditions": conditions,
    }
    for flag in ("dying", "unconscious", "major_wound", "dead"):
        if flag in conditions:
            facts[f"actor.conditions.{flag}"] = True
    minutes_since = _minutes_since_injury(state, elapsed_minutes)
    if minutes_since is not None:
        facts["time.minutes_since_injury"] = minutes_since
    recovery_due = _major_wound_recovery_due(state, elapsed_minutes)
    if recovery_due is not None:
        facts["actor.recovery.major_wound_week_due"] = recovery_due
    if ruleset_id is not None:
        facts["campaign.ruleset_id"] = ruleset_id
    if isinstance(extra, dict):
        facts.update({str(key): deepcopy(value) for key, value in extra.items()})
    facts.setdefault("intent.rescuer_count", 1)
    return facts


# ---- conditions -----------------------------------------------------------------

_LEAF_OPS = frozenset({"eq", "neq", "lt", "lte", "gt", "gte", "contains", "not-contains", "exists"})
_BOOL_OPS = frozenset({"all", "any", "not"})


def _evaluate_leaf(expression: dict[str, Any], facts: Mapping[str, Any]) -> bool | None:
    path = expression.get("path")
    if not isinstance(path, str) or path not in REGISTERED_CONDITION_PATHS:
        return None
    value = facts.get(path) if isinstance(facts, Mapping) else None
    op = expression.get("op")
    if op == "exists":
        return value is not None
    if value is None:
        return None
    operand = expression.get("value")
    try:
        if op == "eq":
            return value == operand
        if op == "neq":
            return value != operand
        if op == "lt":
            return value < operand
        if op == "lte":
            return value <= operand
        if op == "gt":
            return value > operand
        if op == "gte":
            return value >= operand
    except TypeError:
        return None
    if op == "contains":
        if isinstance(value, (list, tuple, set, frozenset)):
            return operand in value
        if isinstance(value, str) and isinstance(operand, str):
            return operand in value
        return None
    if op == "not-contains":
        found = _evaluate_leaf({"op": "contains", "path": path, "value": operand}, facts)
        return None if found is None else not found
    return None


def _condition_children(expression: Mapping[str, Any]) -> list[Any] | None:
    raw = expression.get("of")
    if isinstance(raw, dict):
        return [raw]
    if isinstance(raw, list):
        return raw
    return None


def evaluate_condition(expression: Any, facts: Mapping[str, Any]) -> bool | None:
    """Closed structural condition language; None = unresolved. Hard gates treat None as
    failed (fail closed)."""
    if not isinstance(expression, dict):
        return False
    op = expression.get("op")
    if op in {"all", "any"}:
        children = _condition_children(expression)
        if children is None:
            return False
        results = [evaluate_condition(child, facts) for child in children]
        if op == "all":
            if any(r is False for r in results):
                return False
            return None if any(r is None for r in results) else True
        if any(r is True for r in results):
            return True
        return None if any(r is None for r in results) else False
    if op == "not":
        children = _condition_children(expression)
        if children is None or len(children) != 1:
            return False
        child = evaluate_condition(children[0], facts)
        return None if child is None else not child
    if op in _LEAF_OPS:
        return _evaluate_leaf(expression, facts)
    return False


def requirement_phrase(expression: Mapping[str, Any], negated: bool) -> str:
    op = expression.get("op")
    value = expression.get("value")
    if op == "exists":
        return "to be absent" if negated else "to be present"
    phrases = {"eq": "to equal", "neq": "to differ from", "lt": "to be less than", "lte": "to be at most",
               "gt": "to be greater than", "gte": "to be at least", "contains": "to contain",
               "not-contains": "not to contain"}
    phrase = phrases.get(str(op), f"to satisfy {op!r} against")
    return f"not ({phrase} {value!r})" if negated else f"{phrase} {value!r}"


def classify_exception_condition(expression: Any, facts: Mapping[str, Any]) -> tuple[str, str | None]:
    if not isinstance(expression, dict):
        return "unevaluated", "malformed_expression"
    op = expression.get("op")
    if op in _BOOL_OPS:
        children = _condition_children(expression)
        if children is None or (op == "not" and len(children) != 1):
            return "unevaluated", "malformed_expression"
        statuses = [classify_exception_condition(child, facts) for child in children]
        if op == "all":
            if any(s == "inactive" for s, _ in statuses):
                return "inactive", None
            unevaluated = next(((s, r) for s, r in statuses if s == "unevaluated"), None)
            return unevaluated or ("matched", None)
        if op == "any":
            if any(s == "matched" for s, _ in statuses):
                return "matched", None
            unevaluated = next(((s, r) for s, r in statuses if s == "unevaluated"), None)
            return unevaluated or ("inactive", None)
        child_status, child_reason = statuses[0]
        if child_status == "unevaluated":
            return "unevaluated", child_reason
        return ("inactive", None) if child_status == "matched" else ("matched", None)
    if op in _LEAF_OPS:
        path = expression.get("path")
        if not isinstance(path, str) or path not in REGISTERED_CONDITION_PATHS:
            return "unevaluated", "unregistered_path"
        return ("matched", None) if _evaluate_leaf(expression, facts) is True else ("inactive", None)
    return "unevaluated", "unknown_operator"


def _bounded_withheld(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    bounded: list[dict[str, Any]] = []
    spent = 0
    for row in sorted(rows, key=lambda r: str(r["decision_ref"])):
        unmet = list(row.get("unmet") or [])
        kept = unmet[:max(WITHHELD_UNMET_ROW_BUDGET - spent, 0)]
        spent += len(kept)
        entry: dict[str, Any] = {"decision_ref": row["decision_ref"]}
        if row.get("label"):
            entry["label"] = row["label"]
        entry["unmet"] = kept
        if len(kept) < len(unmet):
            entry["unmet_omitted"] = len(unmet) - len(kept)
        bounded.append(entry)
    return bounded


def canonical_slot_name(node_id: str) -> str:
    """`input-slot:coc7:social:described-action` -> `described_action`."""
    parts = str(node_id).split(":")
    if len(parts) >= 3 and parts[0] == "input-slot":
        return parts[-1].replace("-", "_")
    return str(node_id)


def _scalar_type_from_guess(name: str) -> str:
    if name in {"pushed", "complete_rest", "poor_environment", "include_selection_policy"}:
        return "bool"
    if name in {"skill_value", "medicine_skill_value", "credit_rating", "limit", "build", "actor_build",
                "target_build", "current_hp", "max_hp", "current_san"}:
        return "int"
    return "scalar"


def semantic_name(decision_ref: str) -> str:
    """`decision:coc7:core-check:ordinary-check` -> `core-check:ordinary-check`."""
    parts = str(decision_ref).split(":")
    if len(parts) >= 4 and parts[0] == "decision":
        return ":".join(parts[2:])
    return str(decision_ref)


# ---- the runtime ------------------------------------------------------------------

class RulesRuntime:
    """One graph's runtime view: `context` and `settle` only.

    Dependencies are injected: a facts provider for live-state overlay, a host-locked
    provider for locked inputs, an optional-rule gate provider, and the ruleset adapter
    whose `augment_facts` / `settle` hooks own the composed CoC 7e flows."""

    SCHEMA_VERSION = 1
    INTENT_FACT_PATH = "intent.action_kind"

    def __init__(self, graph: dict[str, Any], *, ruleset_id: str | None = None, ruleset_version: str | None = None,
                 graph_manifest: dict[str, Any] | None = None, campaign_id: str | None = None,
                 facts_provider: Callable[[], Mapping[str, Any]] | None = None,
                 grant_context_provider: Callable[[], Mapping[str, Any]] | None = None,
                 host_locked_provider: Callable[[str], Mapping[str, Any]] | None = None,
                 resolver_index: Mapping[str, Any] | None = None, projection_audience: str = "keeper",
                 ruleset_adapter: Any | None = None,
                 optional_rules_provider: Callable[[], Mapping[str, Mapping[str, Any]]] | None = None) -> None:
        if not isinstance(graph, dict) or not isinstance(graph.get("nodes"), list):
            raise ValueError("RulesRuntime requires a compiled RuleGraph object")
        self._optional_rules_provider = optional_rules_provider
        self._graph = graph
        self._ruleset_id = ruleset_id or str(graph.get("ruleset_id") or "")
        self._ruleset_version = ruleset_version or (
            (graph_manifest or {}).get("ruleset_version") if isinstance(graph_manifest, Mapping) else None) or "unversioned"
        manifest_digest = (graph_manifest or {}).get("graph_content_digest")
        self._graph_generation = str(manifest_digest) if manifest_digest else f"sha256:{json_digest(graph)}"
        self._campaign_id = campaign_id
        self._graph_manifest = graph_manifest
        self._facts_provider = facts_provider
        self._grant_context_provider = grant_context_provider
        self._host_locked_provider = host_locked_provider
        self._resolver_index = resolver_index
        self._ruleset_adapter = ruleset_adapter
        if projection_audience not in {"keeper", "host-internal", "audit"}:
            raise ValueError("RulesRuntime projection_audience must be keeper, host-internal, or audit")
        self._projection_audience = projection_audience
        self._grants: dict[str, dict[str, Any]] = {}
        self._grant_sequence = 0
        self._nodes: dict[str, dict[str, Any]] = {
            node["node_id"]: node for node in graph.get("nodes") or []
            if isinstance(node, dict) and isinstance(node.get("node_id"), str)}
        self._relations = [rel for rel in (graph.get("relations") or []) if isinstance(rel, dict)]
        self._out: dict[str, list[dict[str, Any]]] = {}
        self._in: dict[str, list[dict[str, Any]]] = {}
        for rel in self._relations:
            self._out.setdefault(str(rel.get("from_node_id")), []).append(rel)
            self._in.setdefault(str(rel.get("to_node_id")), []).append(rel)

    # -- indexes --------------------------------------------------------------

    @property
    def nodes(self) -> dict[str, dict[str, Any]]:
        return self._nodes

    def families(self) -> list[str]:
        return sorted(self._graph.get("coverage") or {})

    def node_ids_by_kind(self, kind: str) -> list[str]:
        return sorted(node_id for node_id, node in self._nodes.items() if node.get("node_kind") == kind)

    def decision_nodes(self, family: str | None = None) -> list[dict[str, Any]]:
        rows = [node for node in self._nodes.values() if node.get("node_kind") == "decision"]
        if family is not None:
            rows = [node for node in rows if (node.get("properties") or {}).get("family_id") == family]
        return sorted(rows, key=lambda node: str(node.get("node_id")))

    def family_of(self, decision_ref: str) -> str:
        node = self._nodes.get(decision_ref) or {}
        return str((node.get("properties") or {}).get("family_id") or "")

    def _outgoing(self, node_id: str, kind: str | None = None) -> list[dict[str, Any]]:
        rows = self._out.get(node_id, [])
        if kind is not None:
            rows = [row for row in rows if row.get("relation_kind") == kind]
        return sorted(rows, key=lambda row: str(row.get("relation_id")))

    def _invokes(self, node_id: str) -> dict[str, Any] | None:
        for rel in self._outgoing(node_id, "invokes"):
            target = self._nodes.get(str(rel.get("to_node_id")))
            if target is not None:
                return target
        return None

    def capability_of(self, decision_ref: str) -> str | None:
        capability = self._invokes(decision_ref)
        if capability is None:
            return None
        value = (capability.get("properties") or {}).get("resolver_capability")
        return str(value) if isinstance(value, str) else None

    def conditions_for(self, node_id: str) -> list[dict[str, Any]]:
        return [target for rel in self._outgoing(node_id, "available-when")
                if (target := self._nodes.get(str(rel.get("to_node_id")))) is not None
                and target.get("node_kind") == "condition"]

    def rules_for(self, node_id: str) -> list[str]:
        cap = self._invokes(node_id)
        if cap is None:
            return []
        cap_id = str(cap.get("node_id"))
        return sorted(str(node["node_id"]) for node in self._nodes.values()
                      if node.get("node_kind") == "rule"
                      and any(rel.get("relation_kind") == "invokes" and str(rel.get("to_node_id")) == cap_id
                              for rel in self._outgoing(str(node["node_id"]))))

    def source_refs_for(self, rule_refs: list[str]) -> list[str]:
        refs: set[str] = set()
        for rule_id in rule_refs:
            for span in (self._nodes.get(rule_id) or {}).get("evidence_span_ids") or []:
                if isinstance(span, str):
                    refs.add(span)
        return sorted(refs)

    def effects_for(self, node_id: str) -> list[str]:
        return sorted({str(t.get("node_id")) for rel in self._outgoing(node_id, "emits")
                       if (t := self._nodes.get(str(rel.get("to_node_id")))) is not None and t.get("node_kind") == "effect"})

    def effect_kinds_for(self, node_id: str) -> list[str]:
        kinds = []
        for effect_id in self.effects_for(node_id):
            kind = ((self._nodes.get(effect_id) or {}).get("properties") or {}).get("effect_kind")
            if isinstance(kind, str):
                kinds.append(kind)
        return sorted(set(kinds))

    def pending_choices_for(self, node_id: str) -> list[str]:
        return sorted({str(t.get("node_id")) for rel in self._outgoing(node_id, "offers-choice")
                       if (t := self._nodes.get(str(rel.get("to_node_id")))) is not None
                       and t.get("node_kind") == "pending-choice"})

    def continuations_for(self, node_id: str) -> list[str]:
        """Direct `continues-as` targets, with `continuation` nodes followed one hop to
        the decision they lead to."""
        out: set[str] = set()
        for rel in self._outgoing(node_id, "continues-as"):
            target = self._nodes.get(str(rel.get("to_node_id")))
            if target is None:
                continue
            if target.get("node_kind") == "continuation":
                for hop in self._outgoing(str(target["node_id"]), "continues-as"):
                    if self._nodes.get(str(hop.get("to_node_id"))) is not None:
                        out.add(str(hop.get("to_node_id")))
            else:
                out.add(str(target["node_id"]))
        return sorted(out)

    # -- slots ------------------------------------------------------------------

    def slots_for(self, node_id: str) -> list[dict[str, Any]]:
        """Union of implementation payload slots and input-slot nodes (merged by name)."""
        slots: dict[str, dict[str, Any]] = {}
        node = self._nodes.get(node_id) or {}
        implementation = (node.get("properties") or {}).get("implementation")
        if isinstance(implementation, dict):
            for slot in implementation.get("payload_slots") or []:
                if isinstance(slot, dict) and isinstance(slot.get("name"), str):
                    slots[slot["name"]] = {"name": slot["name"], "ownership": slot.get("ownership") or "host-locked",
                                           "type": _scalar_type_from_guess(slot["name"])}
        for rel in list(self._outgoing(node_id, "requires-input")) + list(self._outgoing(node_id, "locks-input")):
            target = self._nodes.get(str(rel.get("to_node_id")))
            if target is None or target.get("node_kind") != "input-slot":
                continue
            props = target.get("properties") or {}
            canonical = canonical_slot_name(str(target.get("node_id")))
            node_type = props.get("value_type") or "scalar"
            description = target.get("name") if isinstance(target.get("name"), str) and target.get("name").strip() else None
            existing = slots.get(canonical)
            if existing is not None:
                if existing["type"] in (None, "scalar") and node_type != "scalar":
                    existing["type"] = node_type
                existing.setdefault("path", props.get("path"))
                if description and not existing.get("description"):
                    existing["description"] = description
                continue
            slots[canonical] = {"name": canonical, "ownership": props.get("ownership") or "keeper-semantic",
                                "type": node_type, "path": props.get("path"),
                                **({"description": description} if description else {})}
        return sorted(slots.values(), key=lambda slot: slot["name"])

    def declared_payload_slots(self, decision_ref: str) -> frozenset[str]:
        implementation = ((self._nodes.get(decision_ref) or {}).get("properties") or {}).get("implementation") or {}
        return frozenset(str(slot["name"]) for slot in implementation.get("payload_slots") or []
                         if isinstance(slot, Mapping) and slot.get("name"))

    def required_semantic_slots(self, decision_ref: str) -> list[str]:
        return sorted(s["name"] for s in self.slots_for(decision_ref) if s["ownership"] in _REQUIRED_SEMANTIC_OWNERSHIPS)

    # -- applicability -------------------------------------------------------------

    def optional_rule_gate(self, node_id: str) -> dict[str, Any] | None:
        if self._optional_rules_provider is None:
            return None
        gates = self._optional_rules_provider()
        row = gates.get(node_id) if isinstance(gates, Mapping) else None
        return dict(row) if isinstance(row, Mapping) else None

    def applicability(self, node_id: str, facts: Mapping[str, Any]) -> tuple[bool, bool]:
        """(applicable, hard_gated) for one decision."""
        hard = [c for c in self.conditions_for(node_id) if c.get("hard_gate") is True]
        passed = all(evaluate_condition((c.get("properties") or {}).get("expression"), facts) for c in hard)
        return bool(passed), bool(hard)

    def _intent_conditions_for(self, node_id: str) -> list[dict[str, Any]]:
        return [c for c in self.conditions_for(node_id) if c.get("hard_gate") is not True
                and self.INTENT_FACT_PATH in json.dumps((c.get("properties") or {}).get("expression"), sort_keys=True)]

    def answers_declared_intent(self, node_id: str, facts: Mapping[str, Any]) -> bool | None:
        """True/False when the decision declares an intent trigger; None when it declares
        none or no intent was declared."""
        conditions = self._intent_conditions_for(node_id)
        if not conditions or not facts.get(self.INTENT_FACT_PATH):
            return None
        return any(evaluate_condition((c.get("properties") or {}).get("expression"), facts) for c in conditions)

    def unmet_availability(self, decision_ref: str, facts: Mapping[str, Any] | None = None) -> list[dict[str, Any]]:
        """The leaf hard-gate conditions this decision fails right now."""
        if facts is None:
            facts = dict(self._facts_provider() or {}) if self._facts_provider is not None else {}
        unmet: list[dict[str, Any]] = []
        seen: set[str] = set()

        def walk(expression: Any, negated: bool = False) -> None:
            if not isinstance(expression, Mapping):
                return
            children = _condition_children(expression)
            if children is not None:
                flipped = negated != (expression.get("op") == "not")
                for child in children:
                    walk(child, flipped)
                return
            path = expression.get("path")
            if not isinstance(path, str) or path in seen:
                return
            satisfied = evaluate_condition(expression, facts)
            if satisfied is (False if negated else True):
                return
            seen.add(path)
            unmet.append({"path": path, "op": expression.get("op"), "negated": negated, "actual": facts.get(path),
                          "expected": expression.get("value"), "requirement": requirement_phrase(expression, negated)})

        for condition in self.conditions_for(decision_ref):
            if condition.get("hard_gate") is True:
                walk((condition.get("properties") or {}).get("expression"))
        return unmet

    def positive_gate_hits(self, decision_ref: str, facts: Mapping[str, Any]) -> list[dict[str, Any]]:
        """Hard-gate leaves that hold because a state fact is present and matches — the
        `because` of a situation. Negated leaves and identity/ruleset leaves do not count."""
        hits: list[dict[str, Any]] = []

        def walk(expression: Any, negated: bool = False) -> None:
            if not isinstance(expression, Mapping):
                return
            children = _condition_children(expression)
            if children is not None:
                flipped = negated != (expression.get("op") == "not")
                for child in children:
                    walk(child, flipped)
                return
            path = expression.get("path")
            # `chase.start.ready` only says a pursuer is present; a chase starts on the
            # investigator's flight (an intent), never as a standing situation.
            if negated or not isinstance(path, str) or path in ("actor.id", "campaign.ruleset_id",
                                                                 "campaign.ruleset_version", "chase.session.inactive",
                                                                 "chase.start.ready"):
                return
            if expression.get("op") == "neq":
                return
            if evaluate_condition(expression, facts) is True:
                hits.append({"path": path, "actual": facts.get(path), "requirement": requirement_phrase(expression, False)})

        for condition in self.conditions_for(decision_ref):
            if condition.get("hard_gate") is True:
                walk((condition.get("properties") or {}).get("expression"))
        return hits

    # -- cards ------------------------------------------------------------------

    def card(self, node_id: str, facts: Mapping[str, Any]) -> dict[str, Any]:
        node = self._nodes[node_id]
        props = node.get("properties") or {}
        slots = self.slots_for(node_id)
        applicable, hard_gated = self.applicability(node_id, facts)
        capability = self._invokes(node_id)
        rule_refs = self.rules_for(node_id)
        active, unevaluated = self._surface_exceptions(node_id, facts)
        card = {
            "schema_version": self.SCHEMA_VERSION,
            "decision_ref": node_id,
            "name": semantic_name(node_id),
            "family": props.get("family_id") or "",
            "label": node.get("name") or node_id,
            "applicability": "applicable" if applicable else "not_applicable",
            "required_inputs": [
                {"name": s["name"], "owner": s["ownership"], "type": s["type"],
                 **({"description": s["description"]} if s.get("description") else {})}
                for s in slots if s["ownership"] in _SEMANTIC_SLOT_OWNERSHIPS],
            "locked_inputs": [s["name"] for s in slots if s["ownership"] in _LOCKED_SLOT_OWNERSHIPS],
            "rule_refs": rule_refs,
            "source_refs": self.source_refs_for(rule_refs),
            "capability_ref": str(capability.get("node_id")) if capability is not None else None,
            "effect_refs": self.effects_for(node_id),
            "possible_continuations": self.continuations_for(node_id),
            "authority": {"selection": "keeper-semantic", "execution": "current-ruleset-adapter", "hard_gate": hard_gated},
        }
        answers = self.answers_declared_intent(node_id, facts)
        if answers is not None:
            card["answers_declared_intent"] = answers
        gate = self.optional_rule_gate(node_id)
        if gate is not None:
            card["applicability"] = "not_applicable"
            card["disabled_by_optional_rule"] = gate
        if active:
            card["active_exceptions"] = active
        if unevaluated:
            card["unevaluated_exceptions"] = unevaluated
        return card

    # -- grants -----------------------------------------------------------------

    def _gating_fact_paths(self, decision_refs: Iterable[str]) -> tuple[str, ...]:
        paths: set[str] = set()

        def walk(expression: Any) -> None:
            if not isinstance(expression, Mapping):
                return
            children = _condition_children(expression)
            if children is not None:
                for child in children:
                    walk(child)
                return
            path = expression.get("path")
            if isinstance(path, str) and path:
                paths.add(path)

        for ref in decision_refs:
            for condition in self.conditions_for(str(ref)):
                if condition.get("hard_gate") is True:
                    walk((condition.get("properties") or {}).get("expression"))
        return tuple(sorted(paths - _CALL_SCOPED_FACT_KEYS))

    def _grant_binding(self, state_scope: Iterable[str] | None = None) -> dict[str, Any]:
        facts = self._facts_provider() if self._facts_provider is not None else {}
        if state_scope is not None:
            revision = f"sha256:{json_digest({key: facts.get(key) for key in sorted(state_scope)})}"
        else:
            revision = f"sha256:{json_digest({k: v for k, v in facts.items() if k not in _CALL_SCOPED_FACT_KEYS})}"
        binding = {"campaign_id": self._campaign_id, "ruleset_id": self._ruleset_id,
                   "ruleset_version": self._ruleset_version, "graph_generation": self._graph_generation,
                   "state_revision": revision}
        if self._grant_context_provider is not None:
            provided = self._grant_context_provider()
            if isinstance(provided, Mapping):
                for key in sorted(_GRANT_CONTEXT_KEYS):
                    if key in provided:
                        binding[key] = deepcopy(provided[key])
        return binding

    def issue_card_grant(self, cards: list[dict[str, Any]], *, source_decision_id: str | None = None) -> dict[str, Any]:
        self._grant_sequence += 1
        family = str(cards[0].get("family") or "") if cards else ""
        decision_refs = sorted({str(card["decision_ref"]) for card in cards})
        scope = self._gating_fact_paths(decision_refs)
        grant = {
            "contract_id": CARD_GRANT_CONTRACT_ID, "schema_version": CARD_GRANT_SCHEMA_VERSION,
            "grant_id": f"card-grant:{self._ruleset_id}:{family or 'unscoped'}:{self._grant_sequence}",
            "binding": self._grant_binding(scope), "decision_refs": decision_refs, "state_scope": list(scope),
        }
        if isinstance(source_decision_id, str) and source_decision_id:
            grant["source_decision_id"] = source_decision_id
        self._grants[grant["grant_id"]] = deepcopy(grant)
        return deepcopy(grant)

    def _check_card_grant(self, grant: Mapping[str, Any] | None, decision_ref: str) -> dict[str, Any] | None:
        if not isinstance(grant, Mapping) or not isinstance(grant.get("grant_id"), str) or not grant.get("grant_id"):
            return self._stale_envelope(decision_ref, "missing_card_grant",
                                        "a machine-issued card grant is required (context() -> settle())")
        stored = self._grants.get(str(grant["grant_id"]))
        if stored is None:
            return self._stale_envelope(decision_ref, "unrecognized_card_grant",
                                        "the grant was not issued by this runtime instance")
        current = self._grant_binding(stored.get("state_scope"))
        drifted = [key for key in sorted(stored["binding"]) if stored["binding"].get(key) != current.get(key)]
        if drifted:
            return self._stale_envelope(decision_ref, "grant_binding_mismatch",
                                        f"card grant binding no longer matches current state: {', '.join(drifted)}",
                                        drifted=drifted)
        if decision_ref not in (stored.get("decision_refs") or []):
            return self._stale_envelope(decision_ref, "decision_not_in_grant",
                                        f"decision {decision_ref!r} was not covered by the live card grant")
        return None

    def _stale_envelope(self, decision_ref: str, reason: str, message: str, **extra: Any) -> dict[str, Any]:
        failure = {"code": "rule_decision_stale", "reason": reason, "message": message, **extra}
        return {"schema_version": self.SCHEMA_VERSION, "decision_ref": decision_ref,
                "family": self.family_of(decision_ref), "status": "rule_decision_stale", "failure": failure}

    def latest_grant_covering(self, decision_ref: str) -> dict[str, Any] | None:
        for grant_id in reversed(list(self._grants)):
            grant = self._grants[grant_id]
            if decision_ref not in (grant.get("decision_refs") or []):
                continue
            if grant.get("binding") != self._grant_binding(grant.get("state_scope")):
                continue
            return deepcopy(grant)
        return None

    # -- exceptions -------------------------------------------------------------

    def _recorded_exclusions(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        promo = (self._graph_manifest or {}).get("family_promotion_eligibility") or {}
        if not isinstance(promo, Mapping):
            return rows
        for family_row in promo.values():
            if isinstance(family_row, Mapping):
                rows.extend(dict(x) for x in family_row.get("shadow_exclusions") or [] if isinstance(x, Mapping))
        return rows

    def _exception_expression(self, exclusion: Mapping[str, Any], node: Mapping[str, Any] | None) -> Any:
        if node is not None:
            node_id = str(node.get("node_id") or "")
            expressions = [(c.get("properties") or {}).get("expression") for c in (self.conditions_for(node_id) if node_id else [])]
            expressions = [e for e in expressions if isinstance(e, dict)]
            if len(expressions) == 1:
                return expressions[0]
            if len(expressions) > 1:
                return {"op": "all", "of": expressions}
            expr = (node.get("properties") or {}).get("expression")
            if isinstance(expr, dict):
                return expr
        when = exclusion.get("when")
        return when if isinstance(when, dict) else None

    def _surface_exceptions(self, decision_ref: str, facts: Mapping[str, Any]) -> tuple[list[str], list[dict[str, Any]]]:
        active: list[str] = []
        unevaluated: list[dict[str, Any]] = []
        for exclusion in self._recorded_exclusions():
            if exclusion.get("decision_ref") != decision_ref:
                continue
            ref = exclusion.get("exception_ref")
            if not isinstance(ref, str) or not ref:
                unevaluated.append({"exception_ref": "", "reason": "malformed_expression", "evaluation": "unevaluated"})
                continue
            status, reason = classify_exception_condition(self._exception_expression(exclusion, self._nodes.get(ref)), facts)
            if status == "matched":
                active.append(ref)
            elif status == "unevaluated":
                unevaluated.append({"exception_ref": ref, "reason": str(reason or "malformed_expression"),
                                    "evaluation": "unevaluated"})
                active.append(ref)
        return sorted(set(active)), unevaluated

    def facts_for_decision(self, selected: Mapping[str, Any] | None = None) -> dict[str, Any]:
        facts = dict(self._facts_provider() or {}) if self._facts_provider is not None else {}
        if self._ruleset_adapter is not None:
            augment = getattr(self._ruleset_adapter, "augment_facts", None)
            if callable(augment):
                provided = augment(self, selected, facts)
                if isinstance(provided, Mapping):
                    facts = dict(provided)
        return facts

    def _is_uncompiled_scope(self, decision_ref: str) -> bool:
        node = self._nodes.get(decision_ref)
        if node is None:
            return False
        return node.get("node_kind") != "decision"

    # -- context ----------------------------------------------------------------

    def context(self, question: Mapping[str, Any] | None = None) -> dict[str, Any]:
        question = dict(question or {})
        facts = self.facts_for_decision(question)
        family = question.get("family")
        if not isinstance(family, str) or not family:
            return {"schema_version": self.SCHEMA_VERSION, "status": "no_candidate_in_compiled_scope", "family": None,
                    "cards": [], "reason": "question must name a compiled rule family", "facts": facts}
        wanted = question.get("selected_affordance_ids")
        requested = [str(ref) for ref in wanted if isinstance(ref, str)] if isinstance(wanted, list) else None
        cards: list[dict[str, Any]] = []
        optional_rule_gates: list[dict[str, Any]] = []
        withheld: list[dict[str, Any]] = []
        for node in self.decision_nodes(family):
            node_id = str(node["node_id"])
            if node.get("audience") != self._projection_audience:
                continue
            if requested is not None and node_id not in requested:
                continue
            card = self.card(node_id, facts)
            if card["applicability"] != "applicable":
                if card.get("disabled_by_optional_rule"):
                    optional_rule_gates.append({"decision_ref": node_id, **card["disabled_by_optional_rule"]})
                    continue
                withheld.append({"decision_ref": node_id, "label": card["label"],
                                 "unmet": self.unmet_availability(node_id, facts)})
                continue
            cards.append(card)
        cards = sorted(cards, key=lambda c: str(c["decision_ref"]))
        result: dict[str, Any] = {"schema_version": self.SCHEMA_VERSION,
                                  "status": "ok" if cards else "no_candidate_in_compiled_scope",
                                  "family": family, "cards": cards, "facts": facts}
        if optional_rule_gates:
            result["disabled_by_optional_rules"] = sorted(optional_rule_gates, key=lambda r: str(r["decision_ref"]))
        if withheld:
            result["withheld"] = _bounded_withheld(withheld)
        if cards:
            result["card_grant"] = self.issue_card_grant(
                cards, source_decision_id=str(question.get("_host_source_decision_id") or "") or None)
        return result

    # -- settle -----------------------------------------------------------------

    def _undeclared_slot_failure(self, decision_ref: str, family: str, slots: list[dict[str, Any]],
                                 offending: list[str], *, origin: str) -> dict[str, Any]:
        required = sorted(s["name"] for s in slots if s["ownership"] in _REQUIRED_SEMANTIC_OWNERSHIPS)
        optional = sorted(s["name"] for s in slots if s["ownership"] in _SEMANTIC_SLOT_OWNERSHIPS
                          and s["ownership"] not in _REQUIRED_SEMANTIC_OWNERSHIPS)
        if required and optional:
            takes = ", ".join(required) + " (optional: " + ", ".join(optional) + ")"
        elif required:
            takes = ", ".join(required)
        elif optional:
            takes = "only optional input: " + ", ".join(optional)
        else:
            takes = "no semantic input at all (every slot is filled by the host)"
        keys = ", ".join(repr(key) for key in offending)
        message = (("host-owned inputs are not declared slots of this decision: " + keys
                    + "; the host fills these, not the Keeper") if origin == "host"
                   else "not declared slots of this decision: " + keys) + "; this decision takes " + takes
        return {"failure": {"code": "unknown_semantic_input", "message": message,
                            "declared_slots": sorted(s["name"] for s in slots),
                            "model_owned_slots": sorted(s["name"] for s in slots if s["ownership"] in _SEMANTIC_SLOT_OWNERSHIPS),
                            "required_semantic_slots": required, "optional_semantic_slots": optional,
                            "host_owned_slots": sorted(s["name"] for s in slots if s["ownership"] in _LOCKED_SLOT_OWNERSHIPS),
                            "unknown": list(offending), "input_origin": origin, "decision_ref": decision_ref,
                            "family": family}}

    def compile_plan(self, decision_ref: str, semantic_inputs: Mapping[str, Any],
                     facts: Mapping[str, Any] | None = None,
                     host_locked: Mapping[str, Any] | None = None) -> dict[str, Any]:
        """Compile one decision into an immutable plan (never executes)."""
        facts = facts if facts is not None else (self._facts_provider() if self._facts_provider is not None else {})
        node = self._nodes.get(decision_ref)
        if node is None or node.get("node_kind") != "decision":
            return {"failure": {"code": "no_candidate_in_compiled_scope",
                                "message": f"decision {decision_ref!r} is not in the compiled graph"}}
        family = (node.get("properties") or {}).get("family_id") or ""
        applicable, _ = self.applicability(decision_ref, facts)
        if not applicable:
            return {"failure": {"code": "rule_decision_not_applicable",
                                "message": "the decision's hard-gate conditions do not hold for current state",
                                "decision_ref": decision_ref, "family": family,
                                "unmet": self.unmet_availability(decision_ref, facts)}}
        capability = self._invokes(decision_ref)
        if capability is None:
            return {"failure": {"code": "unsupported_ruleset_operation",
                                "message": "the decision does not invoke a compiled capability",
                                "decision_ref": decision_ref, "family": family}}
        capability_props = capability.get("properties") or {}
        resolver_capability = capability_props.get("resolver_capability")
        if self._resolver_index is not None and (not isinstance(resolver_capability, str)
                                                 or resolver_capability not in self._resolver_index):
            return {"failure": {"code": "unsupported_ruleset_operation",
                                "message": f"capability {resolver_capability!r} is not in the active resolver index",
                                "decision_ref": decision_ref, "family": family}}
        implementation = (node.get("properties") or {}).get("implementation")
        slots = self.slots_for(decision_ref)
        slot_names = {s["name"] for s in slots}
        if decision_ref.endswith(":combined-check") and isinstance(semantic_inputs, Mapping):
            semantic_inputs = {k: v for k, v in semantic_inputs.items() if k not in {"difficulty_basis", "skill", "characteristic"}}
        unknown = sorted(key for key in semantic_inputs if key not in slot_names)
        if unknown:
            return self._undeclared_slot_failure(decision_ref, family, slots, unknown, origin="model")
        missing = sorted(s["name"] for s in slots if s["ownership"] in _REQUIRED_SEMANTIC_OWNERSHIPS
                         and s["name"] not in semantic_inputs)
        if missing:
            return {"failure": {"code": "missing_semantic_input", "message": "required semantic inputs are missing",
                                "missing": missing, "decision_ref": decision_ref, "family": family}}
        host_context: dict[str, Any] = {}
        if isinstance(host_locked, Mapping):
            host_context.update({str(k): deepcopy(v) for k, v in host_locked.items()})
        if self._host_locked_provider is not None:
            provided = self._host_locked_provider(decision_ref)
            if isinstance(provided, Mapping):
                for key, value in provided.items():
                    host_context.setdefault(str(key), deepcopy(value))
        host_unknown = sorted(key for key in host_context if key not in slot_names)
        if host_unknown:
            return self._undeclared_slot_failure(decision_ref, family, slots, host_unknown, origin="host")
        payload: dict[str, Any] = {}
        if isinstance(implementation, dict):
            for name, value in (implementation.get("payload_constants") or {}).items():
                payload[str(name)] = deepcopy(value)
        for slot in slots:
            name = slot["name"]
            if slot["ownership"] in _SEMANTIC_SLOT_OWNERSHIPS and name in semantic_inputs:
                payload[name] = deepcopy(semantic_inputs[name])
            elif slot["ownership"] in _LOCKED_SLOT_OWNERSHIPS and name in host_context:
                payload[name] = deepcopy(host_context[name])
        command: dict[str, Any] = {"kind": "resolver-invocation", "phase": "resolve", "payload": payload}
        if isinstance(implementation, dict):
            command["kind"] = str(implementation.get("kind") or command["kind"])
            command["phase"] = str(implementation.get("phase") or command["phase"])
        rule_refs = self.rules_for(decision_ref)
        effects = self.effects_for(decision_ref)
        effect_visibility = "public"
        for effect_id in effects:
            vis = ((self._nodes.get(effect_id) or {}).get("properties") or {}).get("visibility") or (self._nodes.get(effect_id) or {}).get("visibility")
            if vis in {"keeper-only", "concealed-result"}:
                effect_visibility = str(vis)
                break
        plan = freeze({
            "schema_version": self.SCHEMA_VERSION, "decision_ref": decision_ref, "family": family,
            "capability": {"ref": str(capability.get("node_id")), "adapter": capability_props.get("adapter") or "resolver",
                           "resolver_capability": resolver_capability},
            "command": command, "rule_refs": rule_refs, "source_refs": self.source_refs_for(rule_refs),
            "resource_effects": effects, "visibility": effect_visibility,
            "pending_choices": self.pending_choices_for(decision_ref),
            "next_decisions": self.continuations_for(decision_ref),
        })
        return {"plan": plan, "failure": None}

    def _failure_envelope(self, decision_ref: str, decision_id: str, code: str, message: str, **extra: Any) -> dict[str, Any]:
        return {"schema_version": self.SCHEMA_VERSION, "decision_ref": decision_ref, "decision_id": decision_id,
                "family": self.family_of(decision_ref), "status": code,
                "failure": {"code": code, "message": message, **extra}}

    def settle(self, selected: Mapping[str, Any], decision_id: str, card_grant: Mapping[str, Any] | None = None, *,
               executor: Callable[..., Any] | None = None) -> dict[str, Any]:
        """Compile one selected decision and execute it through the injected executor.
        A missing, forged, stale or non-covering grant fails closed before compile."""
        if not isinstance(selected, Mapping):
            return {"schema_version": self.SCHEMA_VERSION, "status": "invalid_decision_selection",
                    "failure": {"code": "invalid_decision_selection", "message": "selected decision must be an object"}}
        decision_ref = selected.get("decision_ref")
        semantic_inputs = selected.get("semantic_inputs")
        if not isinstance(decision_ref, str) or not decision_ref:
            return {"schema_version": self.SCHEMA_VERSION, "status": "no_candidate_in_compiled_scope",
                    "failure": {"code": "no_candidate_in_compiled_scope", "message": "a semantic decision_ref is required"}}
        if self._ruleset_adapter is not None and callable(getattr(self._ruleset_adapter, "is_context_only", None)) \
                and self._ruleset_adapter.is_context_only(decision_ref):
            return self._failure_envelope(decision_ref, decision_id, "no_candidate_in_compiled_scope",
                                          f"decision {decision_ref!r} is a context-only lookup")
        if self._is_uncompiled_scope(decision_ref):
            return self._failure_envelope(decision_ref, decision_id, "no_candidate_in_compiled_scope",
                                          f"decision {decision_ref!r} is an uncompiled exception scope")
        gate = self.optional_rule_gate(decision_ref)
        if gate is not None:
            code = "rule_conflict" if gate.get("conflict") else "optional_rule_disabled"
            return {**self._failure_envelope(decision_ref, decision_id, code,
                                             f"decision {decision_ref!r} belongs to optional rule {gate.get('option_id')!r}"),
                    "optional_rule": gate}
        facts = self.facts_for_decision(selected)
        active_exceptions, unevaluated = self._surface_exceptions(decision_ref, facts)
        if active_exceptions:
            return {**self._failure_envelope(decision_ref, decision_id, "no_candidate_in_compiled_scope",
                                             "a recorded uncompiled exception matches the live situation",
                                             active_exceptions=active_exceptions),
                    "active_exceptions": active_exceptions, "unevaluated_exceptions": unevaluated}
        stale = self._check_card_grant(card_grant, decision_ref)
        if stale is not None:
            stale["decision_id"] = decision_id
            return stale
        if not isinstance(semantic_inputs, Mapping):
            semantic_inputs = {}
        locked_names = {s["name"] for s in self.slots_for(decision_ref) if s["ownership"] in _LOCKED_SLOT_OWNERSHIPS}
        overlap = sorted(set(semantic_inputs) & locked_names)
        if overlap:
            return self._failure_envelope(decision_ref, decision_id, "locked_input_override",
                                          "model-supplied host-locked inputs are rejected", fields=overlap)
        host_locked_extra: dict[str, Any] | None = None
        if self._ruleset_adapter is not None:
            prepare = getattr(self._ruleset_adapter, "prepare_settlement", None)
            if callable(prepare):
                prepared = prepare(self, decision_ref, decision_id, selected)
                if isinstance(prepared, Mapping):
                    if isinstance(prepared.get("failure_envelope"), Mapping):
                        return dict(prepared["failure_envelope"])
                    if isinstance(prepared.get("host_locked"), Mapping):
                        host_locked_extra = dict(prepared["host_locked"])
        result = self.compile_plan(decision_ref, semantic_inputs, facts=facts, host_locked=host_locked_extra)
        if result["failure"] is not None:
            failure = result["failure"]
            return {"schema_version": self.SCHEMA_VERSION, "decision_ref": decision_ref, "decision_id": decision_id,
                    "family": failure.get("family") or self.family_of(decision_ref), "status": failure["code"],
                    "failure": failure}
        plan = result["plan"]
        family = plan["family"]
        envelope: dict[str, Any] = {
            "schema_version": self.SCHEMA_VERSION, "decision_ref": decision_ref, "decision_id": decision_id,
            "family": family, "status": "compiled", "rule_refs": list(plan["rule_refs"]),
            "settlement": {"existing_result_envelope": False, "execution": "deferred", "plan": plan},
            "next_decisions": [], "authority": "canonical-resolver-state-receipts",
        }
        if executor is None:
            return self._failure_envelope(decision_ref, decision_id, "rules_graph_unavailable",
                                          "graph-owned settlement requires an executor")
        if self._ruleset_adapter is not None:
            settle_adapter = getattr(self._ruleset_adapter, "settle", None)
            adapted = settle_adapter(self, executor, plan, decision_id, selected, facts, envelope) if callable(settle_adapter) else None
            if adapted is not None:
                return adapted
        executed = executor(thaw(plan), decision_id, selected)
        data, warnings, hints = split_executor_result(executed)
        envelope["status"] = "settled"
        envelope["settlement"] = {"existing_result_envelope": True, "execution": "canonical-resolver-subsystem",
                                  "plan": plan, "result": data}
        if warnings:
            envelope["warnings"] = warnings
        if hints:
            envelope["hints"] = hints
        envelope["next_decisions"] = self.continuation_cards(plan, decision_id)
        return envelope

    def continuation_cards(self, plan: Mapping[str, Any], decision_id: str) -> list[dict[str, Any]]:
        """Continuations recomputed against the facts the settlement produced, granted."""
        settled_facts = self.facts_for_decision(None)
        continued = []
        for next_ref in list(plan["next_decisions"])[:8]:
            node = self._nodes.get(str(next_ref))
            if node is None or node.get("node_kind") != "decision":
                continue
            applicable, _ = self.applicability(str(next_ref), settled_facts)
            if applicable:
                continued.append(self.card(str(next_ref), settled_facts))
        continued = sorted(continued, key=lambda c: str(c["decision_ref"]))
        if continued:
            self.issue_card_grant(continued, source_decision_id=decision_id)
        return continued


def split_executor_result(executed: Any) -> tuple[Any, list[str], list[str]]:
    data = executed
    warnings: list[str] = []
    hints: list[str] = []
    if isinstance(executed, tuple):
        data = executed[0] if executed else None
        if len(executed) > 1 and isinstance(executed[1], list):
            warnings = list(executed[1])
        if len(executed) > 2 and isinstance(executed[2], list):
            hints = list(executed[2])
    return data, warnings, hints
