"""The system ontology registry at runtime (contract §13.4).

`content/ontology/system-ontology.json` names every semantic id the graphs share and the
relations between them. The kernel reads it once per process, validates every reference
against the graph it claims to live in, and drives exactly two relation kinds:

- `grounded-by` (Director node -> rule decision): the capsule's `director.grounded_by`
  and the `needs_choice` narrowing in `resolve`;
- `may-emit-effect` (decision -> effect): the effect names that ride along.

`requires-live-state-fact`, `invokes-capability` and `renders-settled-output` are
validated and never consulted. A bad reference is not repaired and not skipped: the
registry is reported broken (`campaign_not_ready`, `details.ontology`) and the table
does not open."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Iterable

from .errors import RpcError
from .fileio import read_json

CONTRACT_ID = "coc.system-ontology-registry.v1"
GROUNDED_BY = "grounded-by"
MAY_EMIT_EFFECT = "may-emit-effect"
VALIDATED_ONLY = ("requires-live-state-fact", "invokes-capability", "renders-settled-output")
#: How a reference is checked, by the kind of graph it points into.
GRAPH_KINDS = ("module", "rule", "live-state", "execution", "director", "text")


class Ontology:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self.raw: dict[str, Any] = {}
        self.refs: dict[str, dict[str, Any]] = {}
        self.relations: list[dict[str, Any]] = []
        self.graph_kinds: dict[str, str] = {}
        self.load_error: str | None = None
        try:
            raw = read_json(self.path)
        except (OSError, ValueError) as exc:
            self.load_error = f"unreadable: {exc}"
            return
        if not isinstance(raw, dict) or raw.get("contract_id") != CONTRACT_ID:
            self.load_error = f"not a {CONTRACT_ID} registry"
            return
        self.raw = raw
        for graph in raw.get("graphs") or []:
            if isinstance(graph, dict) and isinstance(graph.get("graph_id"), str):
                self.graph_kinds[graph["graph_id"]] = str(graph.get("graph_kind") or "")
        for ref in raw.get("references") or []:
            if isinstance(ref, dict) and isinstance(ref.get("ref_id"), str):
                self.refs[ref["ref_id"]] = ref
        self.relations = [r for r in raw.get("relations") or [] if isinstance(r, dict)]

    # ---- validation (§13.4) -----------------------------------------------------------

    def validate(self, *, rule_node_ids: Iterable[str], director_node_ids: Iterable[str],
                 text_node_ids: Iterable[str], registered_paths: Iterable[str],
                 capabilities: Iterable[str], module_node_ids: Callable[[str], Iterable[str] | None]) -> list[dict[str, Any]]:
        """Every reference must exist in the graph it names; every relation end must be a
        registered reference. Returns the bad rows (empty means the registry holds)."""
        if self.load_error:
            return [{"ref_id": None, "graph_id": None, "semantic_id": None, "reason": self.load_error}]
        pools: dict[str, set[str]] = {
            "rule": set(rule_node_ids), "director": set(director_node_ids), "text": set(text_node_ids),
            "live-state": set(registered_paths), "execution": set(capabilities),
        }
        bad: list[dict[str, Any]] = []
        for ref_id, ref in self.refs.items():
            graph_id = str(ref.get("graph_id") or "")
            kind = self.graph_kinds.get(graph_id)
            row = {"ref_id": ref_id, "graph_id": graph_id, "semantic_id": ref.get("semantic_id")}
            if kind is None:
                bad.append({**row, "reason": "graph_id is not declared in graphs"})
                continue
            if kind == "module":
                module_id = graph_id.rsplit(":", 1)[-1]
                pool = module_node_ids(module_id)
                if pool is None:
                    bad.append({**row, "reason": f"module {module_id!r} is not loadable"})
                    continue
                if str(ref.get("semantic_id")) not in set(pool):
                    bad.append({**row, "reason": "semantic_id is not a node of the module graph"})
                continue
            if kind in ("live-state", "execution"):
                key = ref.get("locator")
                if not isinstance(key, str) or key not in pools[kind]:
                    where = "registered_condition_paths" if kind == "live-state" else "resolver capabilities"
                    bad.append({**row, "locator": key, "reason": f"locator is not in the {where}"})
                continue
            if kind not in pools:
                bad.append({**row, "reason": f"unknown graph kind {kind!r}"})
                continue
            if str(ref.get("semantic_id")) not in pools[kind]:
                bad.append({**row, "reason": f"semantic_id is not a node of the {kind} graph"})
        for rel in self.relations:
            for end in ("from_ref", "to_ref"):
                target = rel.get(end)
                if target not in self.refs:
                    bad.append({"relation_id": rel.get("relation_id"), "end": end, "ref_id": target,
                                "reason": "relation end is not a registered reference"})
        return bad

    # ---- lookups ------------------------------------------------------------------------

    def _by_semantic(self, semantic_id: str) -> list[str]:
        return [ref_id for ref_id, ref in self.refs.items() if ref.get("semantic_id") == semantic_id]

    def _targets(self, from_semantic: str, relation_kind: str) -> list[str]:
        sources = set(self._by_semantic(from_semantic))
        out: set[str] = set()
        for rel in self.relations:
            if rel.get("relation_kind") != relation_kind or rel.get("from_ref") not in sources:
                continue
            target = self.refs.get(str(rel.get("to_ref")))
            if target is not None and isinstance(target.get("semantic_id"), str):
                out.add(target["semantic_id"])
        return sorted(out)

    def grounded_by(self, director_node_ids: Iterable[str]) -> list[str]:
        """Rule-graph node ids (decisions, rules) the given Director nodes are grounded by."""
        out: set[str] = set()
        for node_id in director_node_ids:
            out.update(self._targets(node_id, GROUNDED_BY))
        return sorted(out)

    def effects_of(self, decision_ids: Iterable[str]) -> list[str]:
        out: set[str] = set()
        for decision_id in decision_ids:
            out.update(self._targets(decision_id, MAY_EMIT_EFFECT))
        return sorted(out)

    def effect_ids(self) -> list[str]:
        """Every effect the registry lets a decision emit (closes the §12.5 effect kinds)."""
        out: set[str] = set()
        for rel in self.relations:
            if rel.get("relation_kind") != MAY_EMIT_EFFECT:
                continue
            target = self.refs.get(str(rel.get("to_ref")))
            if target is not None and isinstance(target.get("semantic_id"), str):
                out.add(target["semantic_id"])
        return sorted(out)


def ontology_not_ready(bad: list[dict[str, Any]]) -> RpcError:
    return RpcError("campaign_not_ready", f"the system ontology has {len(bad)} bad reference(s); the table cannot open",
                    fix="repair content/ontology/system-ontology.json so every reference resolves in its graph",
                    details={"ontology": bad})


def is_effect_name(name: str) -> bool:
    """`grounded_by` lists decisions by semantic name and effects/rules by registry id;
    only the former can narrow a `needs_choice`."""
    return str(name).startswith(("effect:", "rule:"))
