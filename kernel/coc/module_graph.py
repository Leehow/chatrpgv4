"""Read-only view over content/starters/<module>/module-graph.json.

Everything the table needs from the module lives here: node lookup by id or
name, scene adjacency, clues and NPCs per scene, and name resolution with
candidates on ambiguity (contract §2)."""

from __future__ import annotations

import difflib
from collections import defaultdict
from pathlib import Path
from typing import Any

from .errors import RpcError
from .fileio import canonical_json, read_json, sha256_file
from .text import normalize, strip_prefix

SCENE_KIND = "scene"
CLUE_KIND = "clue"
NPC_KIND = "npc"
INVESTIGATOR_TEMPLATE_KIND = "investigator-template"
#: relation kinds that carry the party from one scene to the next: `route-to` (a road) and
#: the play-order kinds the playability template calls entrances. A built book links its
#: scenes by play order far more often than by roads; both are exits at the table.
EXIT_RELATION_KINDS = ("route-to", "play-precedes", "may-lead-to", "alternative-to", "hands-off-to")
#: what a lookup says next to a book's pregen: the table's investigator is in the capsule
TEMPLATE_NOTE = "the book's pregenerated investigator, not at this table; the table's investigators are in the capsule's known.investigator"


def record_of(node: dict[str, Any] | None) -> dict[str, Any]:
    if not node:
        return {}
    projection = (node.get("properties") or {}).get("runtime_projection") or {}
    record = projection.get("record")
    return record if isinstance(record, dict) else {}


# ---- authored conditions ---------------------------------------------------------------

def condition_met(when: Any, world: dict[str, Any]) -> bool:
    """Machine-checkable authored conditions only: `always`, `clue_discovered`. A
    `narrative` condition is never met by the kernel (the keeper cuts explicitly)."""
    if not isinstance(when, dict):
        return False
    kind = when.get("kind")
    if kind == "always":
        return True
    if kind == "clue_discovered":
        clue = strip_prefix(str(when.get("clue_id", "")), CLUE_KIND)
        return clue in (world.get("discovered_clues") or [])
    return False


def describe_condition(when: Any) -> str:
    if isinstance(when, dict) and when.get("kind") == "clue_discovered":
        return f"clue_discovered: {strip_prefix(str(when.get('clue_id', '')), CLUE_KIND)}"
    return canonical_json(when)


class ModuleGraph:
    def __init__(self, module_id: str, path: Path) -> None:
        self.module_id = module_id
        self.path = Path(path)
        self.raw = read_json(self.path)
        self.digest = sha256_file(self.path)
        self.nodes: dict[str, dict[str, Any]] = {n["node_id"]: n for n in self.raw["nodes"]}
        self.by_kind: dict[str, list[dict[str, Any]]] = defaultdict(list)
        self.out_rel: dict[str, list[dict[str, Any]]] = defaultdict(list)
        self.in_rel: dict[str, list[dict[str, Any]]] = defaultdict(list)
        self._names: dict[str, set[str]] = defaultdict(set)
        for node in self.raw["nodes"]:
            self.by_kind[node["node_kind"]].append(node)
        for rel in self.raw.get("relations", []):
            self.out_rel[rel["from_node_id"]].append(rel)
            self.in_rel[rel["to_node_id"]].append(rel)
        for node in self.raw["nodes"]:
            for key in self._name_keys(node):
                self._names[normalize(key)].add(node["node_id"])
        module_nodes = self.by_kind.get("module") or []
        self.module_node = module_nodes[0] if module_nodes else None

    # ---- identity ---------------------------------------------------------

    def _name_keys(self, node: dict[str, Any]) -> list[str]:
        record = record_of(node)
        keys = [node["node_id"], self.handle(node), node.get("name") or ""]
        keys.extend(node.get("aliases") or [])
        for field in ("display_name", "name", "scene_id", "title"):
            value = record.get(field)
            if isinstance(value, str):
                keys.append(value)
        return [k for k in keys if k]

    def handle(self, node: dict[str, Any]) -> str:
        """The kebab name the model uses: scene_id for scenes, id minus kind prefix otherwise."""
        record = record_of(node)
        if node["node_kind"] == SCENE_KIND and isinstance(record.get("scene_id"), str):
            return record["scene_id"]
        return strip_prefix(node["node_id"], node["node_kind"])

    def display_name(self, node: dict[str, Any]) -> str:
        record = record_of(node)
        for field in ("display_name", "name", "title"):
            value = record.get(field)
            if isinstance(value, str) and value:
                return value
        name = node.get("name")
        # Graph nodes without an authored title carry a placeholder name spelled from the id
        # ("scene newspaper morgue"); the kebab handle reads better than that.
        if isinstance(name, str) and name and name.replace(" ", "-") != node["node_id"]:
            return name
        return self.handle(node)

    def title(self) -> str:
        if self.module_node and self.module_node.get("name"):
            return str(self.module_node["name"])
        return self.module_id

    def resolve(self, name: str, kinds: tuple[str, ...] | None = None,
                *, what: str = "entity") -> dict[str, Any]:
        key = normalize(name)
        ids = set(self._names.get(key, ()))
        if kinds:
            ids = {i for i in ids if self.nodes[i]["node_kind"] in kinds}
        if len(ids) == 1:
            return self.nodes[next(iter(ids))]
        if len(ids) > 1:
            candidates = [self.describe(self.nodes[i]) for i in sorted(ids)]
            raise RpcError("unknown_entity", f"{what} {name!r} is ambiguous",
                           fix="use one of details.candidates by its exact name",
                           details={"query": name, "candidates": candidates})
        raise RpcError("unknown_entity", f"no {what} named {name!r} in the module graph",
                       fix="pick a name from details.candidates or look first",
                       details={"query": name, "candidates": self.candidates(name, kinds)})

    def find(self, name: str, kinds: tuple[str, ...] | None = None) -> dict[str, Any] | None:
        try:
            return self.resolve(name, kinds)
        except RpcError:
            return None

    def candidates(self, name: str, kinds: tuple[str, ...] | None = None,
                   limit: int = 6) -> list[dict[str, Any]]:
        key = normalize(name)
        pool: dict[str, str] = {}
        for norm_key, ids in self._names.items():
            for node_id in ids:
                if kinds and self.nodes[node_id]["node_kind"] not in kinds:
                    continue
                pool.setdefault(norm_key, node_id)
        ranked: list[str] = []
        for norm_key, node_id in pool.items():
            if key and (key in norm_key or norm_key in key) and node_id not in ranked:
                ranked.append(node_id)
        for norm_key in difflib.get_close_matches(key, list(pool), n=limit * 2, cutoff=0.5):
            if pool[norm_key] not in ranked:
                ranked.append(pool[norm_key])
        return [self.describe(self.nodes[i]) for i in ranked[:limit]]

    def describe(self, node: dict[str, Any]) -> dict[str, Any]:
        view = {"name": self.handle(node), "kind": node["node_kind"],
                "display_name": self.display_name(node)}
        if node["node_kind"] == INVESTIGATOR_TEMPLATE_KIND:
            view["note"] = TEMPLATE_NOTE
        return view

    # ---- scenes -----------------------------------------------------------

    def scenes(self) -> list[dict[str, Any]]:
        return list(self.by_kind.get(SCENE_KIND, []))

    def start_scene(self) -> dict[str, Any]:
        starts = [s for s in self.scenes() if record_of(s).get("is_start") is True]
        if len(starts) != 1:
            raise RpcError("campaign_not_ready",
                           f"module {self.module_id} declares {len(starts)} start scenes")
        return starts[0]

    def scene(self, name: str) -> dict[str, Any]:
        return self.resolve(name, (SCENE_KIND,), what="scene")

    def scene_by_handle(self, handle: str) -> dict[str, Any] | None:
        return self.find(handle, (SCENE_KIND,))

    def scene_exits(self, scene: dict[str, Any]) -> list[dict[str, Any]]:
        """route-to relations plus the record's scene_edges, deduplicated by destination."""
        exits: dict[str, dict[str, Any]] = {}
        for rel in self.out_rel.get(scene["node_id"], []):
            if rel["relation_kind"] not in EXIT_RELATION_KINDS:
                continue
            target = self.nodes.get(rel["to_node_id"])
            if not target or target["node_kind"] != SCENE_KIND:
                continue
            props = rel.get("properties") or {}
            entry = self._exit_entry(self.handle(target), props)
            if rel["relation_kind"] != "route-to":
                entry.setdefault("via", rel["relation_kind"])
            exits.setdefault(self.handle(target), entry)
        for edge in record_of(scene).get("scene_edges") or []:
            to = edge.get("to")
            target = self.scene_by_handle(to) if isinstance(to, str) else None
            if not target:
                continue
            entry = self._exit_entry(self.handle(target), edge)
            existing = exits.get(entry["to"], {})
            merged = {**existing, **{k: v for k, v in entry.items() if v is not None}}
            exits[entry["to"]] = merged
        return list(exits.values())

    def scene_dangling_exits(self, scene: dict[str, Any]) -> list[str]:
        """route-to relations whose target has no node yet: a neighbour that lives in a
        section nobody has read (§14.6). Returns the missing target ids."""
        missing: list[str] = []
        for rel in self.out_rel.get(scene["node_id"], []):
            if rel["relation_kind"] not in EXIT_RELATION_KINDS:
                continue
            target_id = str(rel.get("to_node_id"))
            if target_id not in self.nodes and target_id not in missing:
                missing.append(target_id)
        return missing

    @staticmethod
    def _exit_entry(to: str, props: dict[str, Any]) -> dict[str, Any]:
        entry: dict[str, Any] = {"to": to}
        minutes = props.get("travel_minutes")
        if isinstance(minutes, int):
            entry["travel_minutes"] = minutes
        when = props.get("when") or props.get("unlock_when") or props.get("conditions")
        if when:
            entry["when"] = when
        return entry

    def scene_clue_ids(self, scene: dict[str, Any]) -> list[str]:
        """Clue nodes discoverable here: the record's available_clues plus discoverable-at."""
        ordered: list[str] = []
        for clue_id in record_of(scene).get("available_clues") or []:
            node = self.nodes.get(clue_id)
            if node and node["node_kind"] == CLUE_KIND and clue_id not in ordered:
                ordered.append(clue_id)
        for rel in self.in_rel.get(scene["node_id"], []):
            if rel["relation_kind"] != "discoverable-at":
                continue
            node = self.nodes.get(rel["from_node_id"])
            if node and node["node_kind"] == CLUE_KIND and node["node_id"] not in ordered:
                ordered.append(node["node_id"])
        return ordered

    def scene_npc_ids(self, scene: dict[str, Any]) -> list[str]:
        ordered: list[str] = []
        for rel in self.in_rel.get(scene["node_id"], []):
            if rel["relation_kind"] == "present-in":
                node = self.nodes.get(rel["from_node_id"])
                if node and node["node_kind"] == NPC_KIND and node["node_id"] not in ordered:
                    ordered.append(node["node_id"])
        for npc_id in record_of(scene).get("npc_ids") or []:
            node = self.nodes.get(npc_id)
            if node and node["node_kind"] == NPC_KIND and npc_id not in ordered:
                ordered.append(npc_id)
        return ordered

    def scene_assets(self, scene: dict[str, Any]) -> list[dict[str, Any]]:
        assets: list[dict[str, Any]] = []
        seen: set[str] = set()
        for rel in self.in_rel.get(scene["node_id"], []):
            if rel["relation_kind"] not in ("depicts", "discoverable-at", "located-in"):
                continue
            node = self.nodes.get(rel["from_node_id"])
            if not node or node["node_kind"] == CLUE_KIND or node["node_id"] in seen:
                continue
            seen.add(node["node_id"])
            assets.append({"name": self.display_name(node), "kind": node["node_kind"]})
        return assets

    def scene_beat(self, scene: dict[str, Any]) -> dict[str, Any] | None:
        handle = self.handle(scene)
        for beat in self.by_kind.get("beat", []):
            if record_of(beat).get("scene_id") == handle:
                return record_of(beat)
        return None

    # ---- clues / npcs -----------------------------------------------------

    def clue(self, name: str) -> dict[str, Any]:
        return self.resolve(name, (CLUE_KIND,), what="clue")

    def clue_view(self, node: dict[str, Any]) -> dict[str, Any]:
        props = node.get("properties") or {}
        return {"name": self.handle(node), "summary": node.get("summary") or node.get("name"),
                "delivery_kind": props.get("delivery_kind")}

    def npc(self, name: str) -> dict[str, Any]:
        return self.resolve(name, (NPC_KIND,), what="npc")

    # ---- search -----------------------------------------------------------

    def search(self, query: str, limit: int = 8) -> list[dict[str, Any]]:
        """Normalized substring match over names, aliases and summaries. Exact name
        hits first, then name hits by shortest matched name, then summary hits."""
        key = normalize(query)
        if not key:
            return []
        exact: list[dict[str, Any]] = []
        by_name: list[tuple[int, int, dict[str, Any]]] = []
        by_summary: list[dict[str, Any]] = []
        for order, node in enumerate(self.raw["nodes"]):
            names = [normalize(k) for k in self._name_keys(node)]
            if key in names:
                exact.append(node)
                continue
            hits = [n for n in names if key in n]
            if hits:
                by_name.append((min(len(n) for n in hits), order, node))
            elif key in normalize(node.get("summary") or "") or key in normalize(self.prose(node)):
                by_summary.append(node)
        by_name.sort(key=lambda item: (item[0], item[1]))
        ranked = exact + [node for _, _, node in by_name] + by_summary
        # A book's pregenerated investigators are reference, never people at this table:
        # they rank after everything else so a name search finds the NPC first.
        ranked.sort(key=lambda node: node["node_kind"] == INVESTIGATOR_TEMPLATE_KIND)
        return ranked[:limit]

    def prose(self, node: dict[str, Any]) -> str:
        record = record_of(node)
        for field in ("prose", "description", "note", "summary"):
            value = record.get(field)
            if isinstance(value, str):
                return value
        return ""

    def summary(self, node: dict[str, Any]) -> str:
        return self.prose(node) or node.get("summary") or node.get("name") or ""

    def relations_of(self, node: dict[str, Any], limit: int = 12) -> list[dict[str, str]]:
        out = []
        for rel in self.out_rel.get(node["node_id"], []):
            target = self.nodes.get(rel["to_node_id"])
            if target:
                out.append({"kind": rel["relation_kind"], "to": self.handle(target)})
        for rel in self.in_rel.get(node["node_id"], []):
            source = self.nodes.get(rel["from_node_id"])
            if source and rel["relation_kind"] in ("present-in", "discoverable-at", "located-in", "supports"):
                out.append({"kind": rel["relation_kind"], "from": self.handle(source)})
        return out[:limit]

    def entity_view(self, node: dict[str, Any]) -> dict[str, Any]:
        view = {
            "name": self.handle(node),
            "display_name": self.display_name(node),
            "kind": node["node_kind"],
            "summary": self.summary(node),
            "visibility": node.get("visibility"),
            "relations": self.relations_of(node),
        }
        if node["node_kind"] == INVESTIGATOR_TEMPLATE_KIND:
            view["note"] = TEMPLATE_NOTE
        return view
