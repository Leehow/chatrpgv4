#!/usr/bin/env python3
"""The module's own spell namespace, shaped for catalog-core recall.

A ruleset catalogue is not the only place a spell can be authored. A module
writes its own: The Haunting's ``spell-dominate-corbitt-variant`` is a
``node_kind: "spell"`` node with a name, a summary, page refs, and a
``target_scope`` no rulebook row carries. Spell-name resolution used to consult
only ``rulesets/<id>/rules-json/spells.json``, so an authored, source-referenced
module spell could not be learned, cast, taught, or validated: its name was not
a catalogue row and not a family parameterisation either.

This cell owns exactly two things:

* turning a compiled ModuleGraph's spell nodes into records catalog-core can
  recall against (``spell_records``), and
* finding the graph a campaign is bound to (``campaign_spell_records``).

It decides no precedence and prices nothing. ``coc_catalog`` merges the records
it returns alongside the ruleset's own; ``coc_rules`` decides which namespace
wins; ``coc_magic`` decides what an unpriced spell may do.

Costs
-----
A module node's ``properties`` is the authoring slot for its mechanics, and a
module that prices its spell writes the same cost vocabulary the rulebook rows
use (``cost_mp``, ``cost_sanity``, ``cost_pow``). A node that writes none is
*unpriced*, which is not the same as free: ``costs.authored`` says which, and
``costs.missing`` names the fields nobody wrote, so a consumer refuses rather
than reading a missing ``cost_mp`` as zero.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

#: The kind of graph node that is a spell.
SPELL_NODE_KIND = "spell"

#: Cost fields ``coc_magic`` must read before it can resolve a cast. A module
#: spell missing either of these is unpriced; ``cost_pow`` is optional in the
#: rulebook table too, so its absence alone does not make a spell unpriced.
REQUIRED_COST_FIELDS = ("cost_mp", "cost_sanity")
OPTIONAL_COST_FIELDS = ("cost_pow", "pow_cost")

_SIBLINGS: dict[str, Any] = {}


def _sibling(name: str, filename: str):
    """Load a sibling script lazily; the graph loaders are heavy and rarely hit."""
    if name not in _SIBLINGS:
        spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        _SIBLINGS[name] = module
    return _SIBLINGS[name]


def _authored_costs(properties: Any) -> dict[str, Any]:
    """Whatever cost fields the node itself wrote, in rulebook vocabulary."""
    if not isinstance(properties, dict):
        return {}
    out: dict[str, Any] = {}
    for key in REQUIRED_COST_FIELDS + OPTIONAL_COST_FIELDS:
        if key in properties and properties[key] is not None:
            out[key] = properties[key]
    return out


def _costs_block(costs: dict[str, Any], node_id: str) -> dict[str, Any]:
    missing = [key for key in REQUIRED_COST_FIELDS if key not in costs]
    if not missing:
        return {
            "authored": True,
            "missing": [],
            "fields": dict(costs),
            "note": (
                f"{node_id} carries its own casting costs; they are module "
                "content and are not checked against any rulebook row."
            ),
        }
    return {
        "authored": False,
        "missing": missing,
        "fields": dict(costs),
        "note": (
            f"{node_id} is authored without {' and '.join(missing)}. Unpriced "
            "is not free: the module said nothing about what casting costs, so "
            "no cost may be assumed. It can still be learned and taught — "
            "learning is priced by the ruleset's learning rules, not by the "
            "spell row — but casting is refused until the module authors the "
            "missing field(s) on the node."
        ),
    }


def spell_records(graph: Any, *, module_id: str | None = None) -> list[dict[str, Any]]:
    """Catalog-shaped records for every ``node_kind: "spell"`` node in ``graph``.

    The record carries the catalog record fields recall reads (``entity_id``,
    ``name``, ``aliases``, ``kind``) plus a ``module_authored`` block that
    travels into the candidate DTO. The block's presence is the signal that a
    result is this module's spell and not a rulebook row — the same shape rule
    the ``parameterisation`` block already uses.
    """
    if not isinstance(graph, dict):
        return []
    graph_module_id = str(module_id or graph.get("module_id") or "")
    records: list[dict[str, Any]] = []
    for node in graph.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        if str(node.get("node_kind") or "") != SPELL_NODE_KIND:
            continue
        node_id = str(node.get("node_id") or "")
        name = str(node.get("name") or "")
        if not node_id or not name:
            continue
        aliases = [
            str(item)
            for item in node.get("aliases") or []
            if isinstance(item, str) and item.strip()
        ]
        properties = node.get("properties") if isinstance(node.get("properties"), dict) else {}
        visibility = str(node.get("visibility") or "keeper-only")
        costs = _authored_costs(properties)
        records.append({
            "kind": SPELL_NODE_KIND,
            "entity_id": node_id,
            "name": name,
            "localized_name": None,
            "aliases": aliases,
            "labels": [],
            "tags": [],
            "category": None,
            "era": [],
            # A module node states its own audience. Anything the module did not
            # mark player-safe reaches the Keeper surface under the same
            # secret handling every rulebook spell row already gets.
            "secret": visibility != "player-safe",
            "source": {"table": None},
            "summary": dict(costs),
            "params": dict(costs),
            "module_authored": {
                "authority": "module_authored_spell",
                "module_id": graph_module_id,
                "node_id": node_id,
                "name": name,
                "aliases": list(aliases),
                "visibility": visibility,
                "summary": str(node.get("summary") or ""),
                "properties": dict(properties),
                "source_refs": [
                    dict(ref)
                    for ref in node.get("source_refs") or []
                    if isinstance(ref, dict)
                ],
                "costs": _costs_block(costs, node_id),
                "note": (
                    f"{name!r} is authored by the module {graph_module_id!r} as "
                    f"{node_id}; it is not a rulebook catalogue row. Its "
                    "properties and page refs are the module's own, and a "
                    "rulebook row of the same name would take precedence."
                ),
            },
        })
    return records


def _asset_root_id(campaign_dir: Path) -> str | None:
    """The module root this campaign's compiled graph is installed under.

    Same resolution ``module.context`` uses, so a Keeper who can search the
    graph through that operation and a spell name resolved here are reading one
    installation, never two.
    """
    coc_module_project = _sibling(
        "coc_module_project_module_spells", "coc_module_project.py"
    )
    source_root = coc_module_project.campaign_source_asset_root_id(campaign_dir)
    if source_root:
        return str(source_root)
    handout_roots = coc_module_project.campaign_handout_asset_root_ids(campaign_dir)
    return str(handout_roots[-1]) if handout_roots else None


def campaign_spell_records(
    workspace: Path | str | None,
    campaign_dir: Path | str | None,
) -> list[dict[str, Any]]:
    """Spell records from the ModuleGraph this campaign is bound to.

    Returns ``[]`` when the campaign has no bound graph, when the graph is not
    compiled, or when it fails its own integrity validation — the same
    fail-soft posture ``module.context`` takes: an unavailable graph means the
    module's spells stay unknown, never that resolution breaks. A rulebook
    spell name resolves exactly as before in every one of those cases.
    """
    if workspace is None or campaign_dir is None:
        return []
    campaign_path = Path(campaign_dir)
    workspace_path = Path(workspace)
    if not campaign_path.is_dir():
        return []
    try:
        root_id = _asset_root_id(campaign_path)
    except OSError:
        return []
    if not root_id:
        return []
    coc_module_graph = _sibling(
        "coc_module_graph_module_spells", "coc_module_graph.py"
    )
    try:
        graph = coc_module_graph.load_installed_module_graph(
            workspace_path, asset_root_id=root_id
        )
    except (coc_module_graph.ModuleGraphError, OSError):
        # The graph's own findings -- not installed, digest drifted, scope
        # mismatch -- and nothing else. A bug in this cell must surface rather
        # than read as "this module authors no spells", which would put a real
        # spell quietly out of reach again.
        return []
    return spell_records(graph)
