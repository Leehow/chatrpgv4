"""The module-graph vocabulary and the id grammars (contract §14 preamble).

Everything a gate needs to know about *what words exist* comes from the two JSON
files under `content/modules/`: the v3 contract (node kinds, relation kinds,
visibilities, truth statuses, coverage domains, key sets, machine-filled keys)
and the v1 template (the ten invariants, the fifteen measures, the playable
kinds, the actor kinds). Nothing in this package hardcodes a vocabulary the
files already carry.

The regular expressions here are the only ones the package uses for judgement,
and they judge *identifiers*, never prose: the semantic-id law, the node-id
kind prefix, the claim-id prefix, and the span-id page grammar."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
CONTENT_MODULES_DIR = REPO_ROOT / "content" / "modules"
CONTRACT_PATH = CONTENT_MODULES_DIR / "module-graph-contract-v3.json"
TEMPLATE_PATH = CONTENT_MODULES_DIR / "module-graph-template-v1.json"


def _load(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


CONTRACT: dict[str, Any] = _load(CONTRACT_PATH)
TEMPLATE: dict[str, Any] = _load(TEMPLATE_PATH)

GRAPH_CONTRACT_ID = str(CONTRACT["graph_contract_id"])
SCHEMA_VERSION = int(CONTRACT["schema_version"])

VISIBILITIES: frozenset[str] = frozenset(CONTRACT["visibility"])
TRUTH_STATUSES: frozenset[str] = frozenset(CONTRACT["truth_status"])
COVERAGE_STATUSES: frozenset[str] = frozenset(CONTRACT["coverage_status"])
COVERAGE_DOMAINS: tuple[str, ...] = tuple(CONTRACT["coverage_domains"])
NODE_KINDS: frozenset[str] = frozenset(CONTRACT["node_kinds"])
RELATION_KINDS: frozenset[str] = frozenset(CONTRACT["relation_kinds"])
#: §17.2: the words the vocabulary uses for a person as a person. Grouped here, not
#: invented here -- every predicate and relation named is already in `relation_kinds`.
_DOSSIER: dict[str, Any] = CONTRACT["actor_dossier"]
DOSSIER_PROFILE_KEYS: tuple[str, ...] = tuple(_DOSSIER["profile_keys"])
DOSSIER_PROSE_KEYS: tuple[str, ...] = tuple(_DOSSIER["prose_keys"])
DOSSIER_PREDICATES: tuple[str, ...] = tuple(_DOSSIER["claim_predicates"])
TIE_RELATION_KINDS: tuple[str, ...] = tuple(_DOSSIER["tie_relation_kinds"])

INVARIANTS: dict[str, dict[str, str]] = {row["code"]: row for row in TEMPLATE["invariants"]}
MEASURES: tuple[str, ...] = tuple(row["code"] for row in TEMPLATE["measures"])
PLAYABLE_KINDS: tuple[str, ...] = tuple(TEMPLATE["playable_node_kinds"])
ACTOR_KINDS: tuple[str, ...] = tuple(TEMPLATE["actor_kinds"])
ENTRANCE_RELATION_KINDS: tuple[str, ...] = tuple(TEMPLATE["entrance_relation_kinds"])
SUBSTANTIVE_SPAN_CHARS = int(TEMPLATE.get("substantive_span_chars") or 120)

# The kernel's own exit relation (module_graph.ModuleGraph.scene_exits) joins the
# template's entrance kinds: a graph the table can walk is judged by the edges the
# table actually walks.
EXIT_RELATION_KINDS: tuple[str, ...] = ENTRANCE_RELATION_KINDS + ("route-to",)
# The template's `playable_kinds_law`: reachability is judged over exactly the kinds the
# campaign projection turns into somewhere a Keeper can put the party. In this kernel
# that projection is `ModuleGraph.scene()` / `apply move`, which resolve `scene` nodes
# only; a `beat` is a pacing note keyed to a scene, an `event` is a fact about the world,
# an `ending` is a declared close. The template's four kinds were the old projection's.
WALKABLE_KINDS: tuple[str, ...] = ("scene",)

# What a section may be (contract §14.3); the extension's agent picks one per section.

# ---- id grammars ------------------------------------------------------------------------

SEMANTIC_ID_RE = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
SOURCE_LANGUAGE_RE = re.compile(r"^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")
# Legacy graph references keep their original page-bearing span identifiers.
SPAN_PAGE_RE = re.compile(r"^span-(?:p|page-)(\d+)-")
MODULE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


def valid_semantic_id(value: Any) -> bool:
    return isinstance(value, str) and len(value) <= 160 and bool(SEMANTIC_ID_RE.fullmatch(value))


def valid_source_language(value: Any) -> bool:
    return isinstance(value, str) and bool(SOURCE_LANGUAGE_RE.fullmatch(value))


def span_page(span_id: Any) -> int | None:
    """The page a span id names, or None when it names none."""
    if not isinstance(span_id, str):
        return None
    match = SPAN_PAGE_RE.match(span_id)
    return int(match.group(1)) if match else None




def module_node_id(module_id: str) -> str:
    return f"module-{module_id}"


VISUAL_CONTRACT_ID = "coc.module-graph-shard.v4"
VISUAL_SHARD_KEYS = frozenset({"contract_id", "nodes", "claims", "node_refs", "coverage", "dependencies", "critical", "ready_nodes"})
VISUAL_NODE_KEYS = frozenset({"node_id", "node_kind", "name", "aliases", "summary", "properties", "visibility", "source_refs"})
VISUAL_CLAIM_KEYS = frozenset({"claim_id", "subject_id", "predicate", "object", "truth_status", "visibility", "source_refs", "reason", "known_by_ids", "asserted_by_ids", "validity"})


def vocabulary() -> dict[str, Any]:
    """The visual draft schema and the existing graph's closed vocabulary."""
    return {
        "shard_contract_id": VISUAL_CONTRACT_ID,
        "shard_keys": sorted(VISUAL_SHARD_KEYS),
        "node_keys": sorted(VISUAL_NODE_KEYS),
        "claim_keys": sorted(VISUAL_CLAIM_KEYS),
        "node_kinds": list(CONTRACT["node_kinds"]),
        "relation_kinds": list(CONTRACT["relation_kinds"]),
        "visibility": list(CONTRACT["visibility"]),
        "truth_status": list(CONTRACT["truth_status"]),
        "coverage_domains": list(COVERAGE_DOMAINS),
        "coverage_status": list(CONTRACT["coverage_status"]),
        "semantic_id_law": CONTRACT["semantic_id_law"],
        "node_id_law": CONTRACT["node_id_law"],
        "claim_id_law": "Claim identifiers are optional; the host reuses or derives them. Distinct assertions may use distinct semantic identifiers.",
        "source_ref_law": "Use source_refs with a physical page starting at 1 and an optional normalized box. No text spans are required.",
        "exit_relation_kinds": list(EXIT_RELATION_KINDS),
        "playable_node_kinds": list(PLAYABLE_KINDS),
        "actor_kinds": list(ACTOR_KINDS),
        "actor_dossier": CONTRACT["actor_dossier"],
    }
