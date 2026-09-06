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

SHARD_CONTRACT_ID = str(CONTRACT["shard_contract_id"])
GRAPH_CONTRACT_ID = str(CONTRACT["graph_contract_id"])
SCHEMA_VERSION = int(CONTRACT["schema_version"])

VISIBILITIES: frozenset[str] = frozenset(CONTRACT["visibility"])
TRUTH_STATUSES: frozenset[str] = frozenset(CONTRACT["truth_status"])
COVERAGE_STATUSES: frozenset[str] = frozenset(CONTRACT["coverage_status"])
COVERAGE_DOMAINS: tuple[str, ...] = tuple(CONTRACT["coverage_domains"])
NODE_KINDS: frozenset[str] = frozenset(CONTRACT["node_kinds"])
RELATION_KINDS: frozenset[str] = frozenset(CONTRACT["relation_kinds"])
SHARD_KEYS: frozenset[str] = frozenset(CONTRACT["shard_keys"])
NODE_KEYS: frozenset[str] = frozenset(CONTRACT["node_keys"])
CLAIM_KEYS: frozenset[str] = frozenset(CONTRACT["claim_keys"])
RELATION_KEYS: frozenset[str] = frozenset(CONTRACT["relation_keys"])
MACHINE_FILLED_KEYS: dict[str, list[str]] = {
    "shard": list(CONTRACT["machine_filled_keys"]["shard"]) + ["evidence_span_ids", "coverage"],
    "claim": list(CONTRACT["machine_filled_keys"]["claim"]) + ["claim_id"],
}

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
SECTION_KINDS: tuple[str, ...] = (
    "front", "keeper-truth", "scene", "npc-roster", "handouts", "appendix", "rules",
    "pregens", "other",
)
SECTION_STATUSES: tuple[str, ...] = ("planned", "reading", "accepted", "failed", "skipped")
MODULE_STATUSES: tuple[str, ...] = (
    "registered", "planned", "building", "assembled", "assembled_not_playable", "installed",
)

# ---- id grammars ------------------------------------------------------------------------

SEMANTIC_ID_RE = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
SOURCE_LANGUAGE_RE = re.compile(r"^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
# `span-p<page>-<n>` is what module.packet mints (§14.3); `span-page-<page>-...` is the
# spelling the curated starter graphs carry. Both name a page.
SPAN_PAGE_RE = re.compile(r"^span-(?:p|page-)(\d+)-")
SECTION_ID_RE = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")
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


def span_id_for(page: int, ordinal: int) -> str:
    return f"span-p{page}-{ordinal}"


def module_node_id(module_id: str) -> str:
    return f"module-{module_id}"


def vocabulary() -> dict[str, Any]:
    """The closed word lists a reader is handed inside a packet (§14.3)."""
    return {
        "shard_contract_id": SHARD_CONTRACT_ID,
        "schema_version": SCHEMA_VERSION,
        "shard_keys": sorted(SHARD_KEYS),
        "node_keys": sorted(NODE_KEYS),
        "claim_keys": sorted(CLAIM_KEYS),
        "relation_keys": sorted(RELATION_KEYS),
        "node_kinds": list(CONTRACT["node_kinds"]),
        "relation_kinds": list(CONTRACT["relation_kinds"]),
        "visibility": list(CONTRACT["visibility"]),
        "truth_status": list(CONTRACT["truth_status"]),
        "coverage_domains": list(COVERAGE_DOMAINS),
        "coverage_status": list(CONTRACT["coverage_status"]),
        "semantic_id_law": CONTRACT["semantic_id_law"],
        "node_id_law": CONTRACT["node_id_law"],
        "claim_id_law": "Every claim_id begins with claim- and names the fact it states; "
                        "omit it and the machine derives claim-<subject>-<predicate>-<object>.",
        "span_id_law": "Cite only span ids the packet carries; span-p<page>-<n> never "
                       "continues past the packet's last page.",
        "coverage_law": CONTRACT["coverage_law"],
        "source_language_law": CONTRACT["source_language_law"],
        "ordering_law": CONTRACT["ordering_law"],
        "exit_relation_kinds": list(EXIT_RELATION_KINDS),
        "playable_node_kinds": list(PLAYABLE_KINDS),
        "actor_kinds": list(ACTOR_KINDS),
        "invariants": [{"code": row["code"], "asks": row["asks"]} for row in TEMPLATE["invariants"]],
    }
