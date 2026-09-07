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
from .modules import contract
from .fileio import canonical_json, read_json, sha256_file
from .text import kebab, normalize, normalize_text, strip_prefix

SCENE_KIND = "scene"
CLUE_KIND = "clue"
NPC_KIND = "npc"
INVESTIGATOR_TEMPLATE_KIND = "investigator-template"
#: §17.2: the dossier vocabulary belongs to the module contract (`content/modules/
#: module-graph-contract-v3.json`, `actor_dossier`), not to this module — the reader prompt,
#: the starter projector, the playability brief and the table all read that one list.
#: A starter projected before #29 keeps the profile keys under `runtime_projection.record`;
#: `npc_profile` reads the first-class key first and falls back, so a campaign compiled
#: before this slice is read, never rebuilt.
PROFILE_KEYS = contract.DOSSIER_PROFILE_KEYS
DOSSIER_PREDICATES = contract.DOSSIER_PREDICATES
TIE_RELATION_KINDS = contract.TIE_RELATION_KINDS
KNOWS, BELIEVES, ASSERTS, HIDES = DOSSIER_PREDICATES
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
    return record if isinstance(record, dict) else {k: v for k, v in (node.get("properties") or {}).items() if k != "runtime_projection"}


#: The document a module node's projection keeps its own declarations in. Every other kind
#: of node carries a `record`; the module node carries the book's documents instead, so a
#: reader that only knows `record_of` silently reads nothing from it (§21.3 found this with
#: `era`, §15.2 needs it for `structure_type`).
MODULE_META_DOCUMENT = "module-meta.json"


def module_declaration(node: dict[str, Any] | None) -> dict[str, Any]:
    """What the module node declares about the book itself: `module-meta.json`'s root in
    its runtime projection, with the node's own `record` behind it for a graph that was
    projected the other way. One reader for every caller."""
    if not node:
        return {}
    projection = (node.get("properties") or {}).get("runtime_projection") or {}
    declared: dict[str, Any] = {}
    for document in projection.get("documents") or []:
        if not isinstance(document, dict) or document.get("filename") != MODULE_META_DOCUMENT:
            continue
        root = document.get("root")
        if isinstance(root, dict):
            declared = root
        break
    properties = {k: v for k, v in (node.get("properties") or {}).items() if k != "runtime_projection"}
    return {**properties, **record_of(node), **declared}


# ---- authored conditions ---------------------------------------------------------------

#: The spellings an authored flag gate comes in: the starters' `flag_set` / `flag_id`, the
#: contract's (§18.1) `flag` / `flag`. A closed vocabulary, not a guess at meaning.
FLAG_CONDITION_KINDS = ("flag_set", "flag")
FLAG_CONDITION_KEYS = ("flag_id", "flag", "name")


def condition_flag(when: Any) -> str | None:
    """The flag slug an authored flag condition names, or None when the condition is not
    about a flag (a bare string condition is read as a flag name: the-white-war's
    `exit_conditions`)."""
    if isinstance(when, str):
        return kebab(when) or None
    if not isinstance(when, dict) or when.get("kind") not in FLAG_CONDITION_KINDS:
        return None
    for key in FLAG_CONDITION_KEYS:
        value = when.get(key)
        if isinstance(value, str) and kebab(value):
            return kebab(value)
    return None


def flag_is_set(flags: dict[str, Any], slug: str, expected: Any = None) -> bool:
    """`expected` given: the flag holds exactly that value; else: the flag is set to
    anything but false."""
    if expected is not None:
        return slug in flags and flags[slug] == expected
    return slug in flags and flags[slug] is not False


def condition_status(when: Any, world: dict[str, Any]) -> bool | None:
    """§18.1 three-state: True/False when the kernel can decide, None when it cannot.
    Decidable: `always`, `clue_discovered`, a flag condition (`flag_set`/`flag`, by slug),
    and a condition whose text names a flag the world already holds, as a whole
    normalized token sequence (`records-serious-crime-destination-known` in a
    `narrative` description). Anything else is None -- the kernel never guesses."""
    flags = world.get("flags") or {}
    if isinstance(when, str):
        slug = kebab(when)
        return flag_is_set(flags, slug) if slug and slug in flags else None
    if not isinstance(when, dict):
        return None
    kind = when.get("kind")
    if kind == "always":
        return True
    if kind == "clue_discovered":
        clue = strip_prefix(str(when.get("clue_id", "")), CLUE_KIND)
        return clue in (world.get("discovered_clues") or [])
    slug = condition_flag(when)
    if slug is not None:
        return flag_is_set(flags, slug, when.get("value"))
    named = _flags_named_in(when, flags)
    if named:
        return all(flag_is_set(flags, slug) for slug in named)
    return None


def _flags_named_in(when: dict[str, Any], flags: dict[str, Any]) -> list[str]:
    """The known flags whose slug appears, as whole tokens, in any string of the
    condition. Identifier containment over normalized text; no semantics."""
    texts = [f" {normalize_text(v)} " for v in when.values() if isinstance(v, str) and v.strip()]
    named: list[str] = []
    for slug in flags:
        token = f" {normalize_text(slug)} "
        if token.strip() and any(token in text for text in texts):
            named.append(slug)
    return named


def condition_met(when: Any, world: dict[str, Any]) -> bool:
    """Machine-checkable authored conditions only: `always`, `clue_discovered`, a flag
    the world holds (§18.1). A `narrative` condition is never met by the kernel (the
    keeper cuts explicitly)."""
    return condition_status(when, world) is True


def describe_condition(when: Any) -> str:
    if isinstance(when, dict) and when.get("kind") == "clue_discovered":
        return f"clue_discovered: {strip_prefix(str(when.get('clue_id', '')), CLUE_KIND)}"
    slug = condition_flag(when)
    if slug is not None:
        expected = when.get("value") if isinstance(when, dict) else None
        return f"flag_set: {slug}" + (f" = {expected!r}" if expected is not None else "")
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
        #: §17.2: claims indexed by subject, so an NPC's dossier is one lookup. Claims the
        #: graph carries but no node backs are kept: the subject index only holds ids.
        self.claims_by_subject: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for claim in self.raw.get("claims", []):
            if isinstance(claim, dict) and isinstance(claim.get("subject_id"), str):
                self.claims_by_subject[claim["subject_id"]].append(claim)
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
        if len(starts) == 1:
            return starts[0]
        # A refusal that names the trouble must also name the way out (contract §1, §14.14):
        # a book with two openings is settled by a person, not guessed at by the kernel.
        candidates = [{"scene": self.handle(scene), "name": self.display_name(scene)}
                      for scene in (starts or self.scenes())]
        fix = (f"module.opening.choose {{module_id: {self.module_id!r}, scene: <one of details.candidates>}}"
               if starts else "the book declares no opening scene; read the section that holds it")
        raise RpcError("campaign_not_ready",
                       f"module {self.module_id} declares {len(starts)} start scenes",
                       fix=fix, details={"field": "start_scene", "candidates": candidates[:20]})

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
        if not when and isinstance(props.get("flag"), str) and props["flag"].strip():
            # A built book's `route-to` derived from an exit-entry flag (the-white-war):
            # the gate is that flag, spelled as the starters spell it.
            when = {"kind": "flag_set", "flag_id": props["flag"]}
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

    #: §13.1: how many rooms of a place the capsule carries, and how long each line may be.
    SCENE_PLACES = 8
    SCENE_PLACE_CHARS = 90

    def scene_places(self, scene: dict[str, Any]) -> list[dict[str, Any]]:
        """The rooms of the place this scene happens at: `scene --occurs-at--> location
        <--located-in-- rooms`. A built book models a house as a location with rooms hanging
        off it, and nothing walked that second hop, so a Keeper standing on the ground floor
        was never told it has a kitchen — six rooms of the Corbitt House, every one cited to
        its page, invisible at the table."""
        places: list[dict[str, Any]] = []
        seen: set[str] = set()
        for rel in self.out_rel.get(scene["node_id"], []):
            if rel["relation_kind"] != "occurs-at":
                continue
            for inner in self.in_rel.get(rel["to_node_id"], []):
                if inner["relation_kind"] != "located-in":
                    continue
                node = self.nodes.get(inner["from_node_id"])
                if not node or node["node_id"] in seen or len(places) >= self.SCENE_PLACES:
                    continue
                seen.add(node["node_id"])
                line = " ".join(str(node.get("summary") or "").split())[:self.SCENE_PLACE_CHARS]
                entry = {"name": self.display_name(node)}
                if line and line != entry["name"]:
                    entry["line"] = line
                places.append(entry)
        return places

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

    # ---- the authored dossier (§17.2) -------------------------------------

    def npc_profile(self, node: dict[str, Any]) -> dict[str, Any]:
        """What the book says this person wants, fears, hides, sounds like and is to the
        investigators. First-class `properties` win; a starter compiled before #29 keeps the
        same keys under `runtime_projection.record`, and an already-compiled campaign is read,
        never rebuilt. A key the book did not give is absent, never invented."""
        props = node.get("properties") or {}
        record = record_of(node)
        profile: dict[str, Any] = {}
        for key in PROFILE_KEYS:
            value = props.get(key)
            if not (isinstance(value, str) and value.strip()):
                value = record.get(key)
            if isinstance(value, str) and value.strip():
                profile[key] = value.strip()
        return profile

    def npc_claims(self, node: dict[str, Any], predicate: str) -> list[dict[str, Any]]:
        """The claims with this NPC as subject and this predicate, in graph order."""
        return [c for c in self.claims_by_subject.get(node["node_id"], [])
                if c.get("predicate") == predicate]

    def npc_knows(self, node: dict[str, Any]) -> list[dict[str, Any]]:
        """What the book says this person knows: `knows` claims whose object is a node,
        plus the starter's `facts[].clue_id` projection. Each entry is `{node, handle}`;
        whether the table has found it is the caller's business (the world, not the graph)."""
        seen: set[str] = set()
        out: list[dict[str, Any]] = []
        for claim in self.npc_claims(node, KNOWS):
            target_id = (claim.get("object") or {}).get("node_id") if isinstance(claim.get("object"), dict) else None
            target = self.nodes.get(target_id) if isinstance(target_id, str) else None
            if target and target["node_id"] not in seen:
                seen.add(target["node_id"])
                out.append({"node": target, "handle": self.handle(target)})
        for fact in record_of(node).get("facts") or []:
            target = self.nodes.get(fact.get("clue_id")) if isinstance(fact.get("clue_id"), str) else None
            if target and target["node_id"] not in seen:
                seen.add(target["node_id"])
                out.append({"node": target, "handle": self.handle(target)})
        return out

    def npc_claim_lines(self, node: dict[str, Any], predicate: str) -> list[str]:
        """One short line per claim, copied from the graph and never rewritten: the object
        node's summary or name, else the claim's own `statement`."""
        return self._claim_lines(self.npc_claims(node, predicate))

    def _claim_lines(self, claims: list[dict[str, Any]]) -> list[str]:
        lines: list[str] = []
        for claim in claims:
            obj = claim.get("object") if isinstance(claim.get("object"), dict) else {}
            target = self.nodes.get(obj.get("node_id")) if isinstance(obj.get("node_id"), str) else None
            line = None
            if target:
                line = target.get("summary") or target.get("name")
            for key in ("statement", "text", "value"):
                if not (isinstance(line, str) and line.strip()) and isinstance(obj.get(key), str):
                    line = obj[key]
            if not (isinstance(line, str) and line.strip()) and isinstance(claim.get("statement"), str):
                line = claim["statement"]
            if isinstance(line, str) and line.strip():
                lines.append(line.strip())
        return lines

    #: §17.2: an `asserts` claim's truth_status says which kind of saying it is. One the
    #: person holds true is a belief of theirs, not a lie they would tell — the built
    #: the-haunting has both, and telling the keeper Gabriela "would lie about" the presence
    #: she truly saw would be a worse error than saying nothing.
    LIE_STATUSES = ("authored-lie", "authored-rumor")
    BELIEF_STATUS = "authored-belief"

    def _asserts_by_status(self, node: dict[str, Any], statuses: tuple[str, ...]) -> list[str]:
        wanted = [c for c in self.npc_claims(node, ASSERTS) if c.get("truth_status") in statuses]
        return self._claim_lines(wanted)

    def npc_beliefs(self, node: dict[str, Any]) -> list[str]:
        """§17.4 `believes`: what they hold that may be wrong — the `believes` claims, plus
        the things they assert and hold true."""
        lines = self.npc_claim_lines(node, BELIEVES)
        for line in self._asserts_by_status(node, (self.BELIEF_STATUS,)):
            if line not in lines:
                lines.append(line)
        return lines

    def npc_would_say(self, node: dict[str, Any]) -> list[str]:
        """§17.4 `would_lie_about`: what this person says instead of the plain truth — a lie
        or a rumor they would tell, plus the deflection lines the book wrote for them. What
        they assert and believe is not here; it is in `npc_beliefs`. Copied, never composed."""
        lines = self._asserts_by_status(node, self.LIE_STATUSES)
        for deflect in (node.get("properties") or {}).get("deflect_lines") or []:
            line = deflect.get("line") if isinstance(deflect, dict) else None
            if isinstance(line, str) and line.strip() and line.strip() not in lines:
                lines.append(line.strip())
        return lines

    def npc_ties(self, node: dict[str, Any]) -> list[dict[str, Any]]:
        """Who this person stands with and against: the tie relations either way round,
        deduplicated by (kind, other node), in graph order."""
        ties: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        for rel, other_key in ((r, "to_node_id") for r in self.out_rel.get(node["node_id"], [])):
            self._add_tie(ties, seen, rel, rel.get(other_key))
        for rel in self.in_rel.get(node["node_id"], []):
            self._add_tie(ties, seen, rel, rel.get("from_node_id"))
        return ties

    def _add_tie(self, ties: list[dict[str, Any]], seen: set[tuple[str, str]],
                 rel: dict[str, Any], other_id: Any) -> None:
        kind = rel.get("relation_kind")
        if kind not in TIE_RELATION_KINDS or not isinstance(other_id, str):
            return
        other = self.nodes.get(other_id)
        if not other or (kind, other_id) in seen:
            return
        seen.add((kind, other_id))
        ties.append({"kind": kind, "to": self.display_name(other), "node": other})

    def npcs_knowing(self, node: dict[str, Any]) -> list[str]:
        """§17.2 `known_by_ids`, computed rather than stored: the NPC ids whose `knows`
        claims point at this node. The graph's own `known_by_ids` is left as authored."""
        knowers: list[str] = []
        for npc in self.by_kind.get(NPC_KIND, []):
            if any(entry["node"]["node_id"] == node["node_id"] for entry in self.npc_knows(npc)):
                knowers.append(npc["node_id"])
        return knowers

    def npc_has_material(self, node: dict[str, Any]) -> bool:
        """§17.2 / §14.3: whether the book gave this person anything to play — a dossier key
        or one dossier claim. Reported by the brief, never enforced."""
        return bool(self.npc_profile(node)) or any(self.npc_claims(node, p) for p in DOSSIER_PREDICATES) \
            or bool(record_of(node).get("facts"))

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
