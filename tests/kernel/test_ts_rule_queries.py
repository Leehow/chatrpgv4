"""Actual rule/catalog RPC comparisons over retained authoritative saved fixtures."""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import pytest

from conftest import CAMPAIGN, MODULE, RpcClient, WORKTREE, campaign_dir
from rpc_support import python_command
from test_ts_read_projections import prepare, compare


def retained(case: str) -> Path:
    base = Path(os.environ.get("COC_RPC_EVIDENCE_DIR", str(
        WORKTREE / ".coc" / "playtests" / "runtime-consolidation" / "rule-queries")))
    base.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix=case + "-", dir=base))


def queries(cases: list[dict]) -> list[tuple[str, dict]]:
    return [("table.lookup", case) for case in cases]


def test_rule_lookup_keeps_actual_rule_graph_rows_and_fixed_rpc_limit():
    root = retained("rule-rpc")
    prepare(root / "reference-workspace")
    _, actual = compare(root, queries([
        {"kind": "rule", "query": "healing"},
        {"kind": "rule", "query": "core check", "limit": 1},
        {"kind": "rule", "query": "combat", "kinds": ["ignored"], "limit": "ignored"},
        {"kind": "rule", "query": "unknown-no-rule"},
        {"kind": "rule", "query": "-"},
    ]))
    assert all(row["response"]["ok"] for row in actual["exchanges"])
    assert actual["exchanges"][0]["response"]["result"]["rules"]


def test_catalog_rpc_keeps_candidates_prices_parameterized_families_and_labels():
    root = retained("catalog-rpc")
    prepare(root / "reference-workspace")
    skills = json.loads((WORKTREE / "content/rulesets/coc7/rules-json/skills.json").read_text())["skills"]
    label = next(row["localized_labels"]["zh-Hans"] for row in skills.values() if row.get("localized_labels", {}).get("zh-Hans"))
    cases = [
        {"kind": "catalog", "query": ".38", "kinds": ["weapon"]},
        {"kind": "catalog", "query": "revolver_38", "kinds": ["weapon"]},
        {"kind": "catalog", "query": "Khaki Jean Material", "kinds": ["item"]},
        {"kind": "catalog", "query": "Summon/Bind Dimensional Shambler", "kinds": ["spell"]},
        {"kind": "catalog", "query": "Summon/Bind Gug", "kinds": ["spell"]},
        {"kind": "catalog", "query": "Contact Deity Nyarlathotep", "kinds": ["spell"]},
        {"kind": "catalog", "query": label, "kinds": ["skill"]},
        {"kind": "catalog", "query": "car", "kinds": ["vehicle", "rule"], "limit": 2},
        {"kind": "catalog", "query": "beretta", "kinds": ["weapon"], "era": "1920s"},
        {"kind": "catalog", "query": "no-known-catalog-row"},
    ]
    _, actual = compare(root, queries(cases))
    assert all(row["response"]["ok"] for row in actual["exchanges"])
    assert actual["exchanges"][3]["response"]["result"]["candidates"][0]["parameterisation"]
    assert actual["exchanges"][4]["response"]["result"]["unresolved_family_parameters"]


def test_public_catalog_refusals_keep_closed_error_shapes_without_writes():
    root = retained("query-errors")
    prepare(root / "reference-workspace")
    _, actual = compare(root, queries([
        {"kind": "catalog"}, {"kind": "catalog", "query": " "}, {"kind": "rule", "query": 4},
        {"kind": "catalog", "query": "weapon", "kinds": "weapon"},
        {"kind": "catalog", "query": "weapon", "kinds": ["weapon", 4]},
        {"kind": "catalog", "query": "weapon", "kinds": [""]},
        {"kind": "catalog", "query": "plate", "kinds": ["armor"]},
        {"kind": "catalog", "query": "weapon", "limit": True},
        {"kind": "catalog", "query": "weapon", "limit": 20.0},
        {"kind": "catalog", "query": "weapon", "limit": 0},
        {"kind": "catalog", "query": "weapon", "limit": 51},
    ]))
    assert all(not row["response"]["ok"] and row["response"]["error"]["code"] == "invalid_params" for row in actual["exchanges"])


def test_module_spell_authority_aliases_and_generated_definitions_reach_catalog_rpc():
    from coc.modules.store import ModuleStore
    from test_mods import prepared
    root = retained("module-spell-rpc")
    workspace = root / "reference-workspace"
    prepare(workspace)
    store = ModuleStore(workspace)
    graph = store.read_graph(MODULE)
    graph["nodes"].extend([
        {"node_id": "spell-fixture-ward", "node_kind": "spell", "name": "Flesh Ward", "aliases": ["Fixture Ward"],
         "summary": "A fixture module annotation.", "visibility": "keeper-only", "properties": {"cost_mp": 77, "cost_sanity": 8}},
        {"node_id": "spell-fixture-gate", "node_kind": "spell", "name": "Fixture Gate", "aliases": ["Short Gate"],
         "summary": "A fixture without authored prices.", "visibility": "keeper-only", "properties": {"source_refs": [{"page": 1}]}},
    ])
    store.write_module(store.write_graph(store.module(MODULE), graph))
    client = RpcClient(workspace, command=python_command(), frozen_clock=True)
    try:
        draft = {"name": "Workshop Ward", "category": "spell", "description": "A generated fixture spell.",
                 "basis": "Deterministic definition fixture", "parameters": {"cost_mp": "1", "cost_sanity": "0", "casting_time": "one round", "effects": []},
                 "player_view": {"description": "A fixture spell", "fields": ["cost_mp"]}}
        client.table("apply", call_id="t0-c1", effects=[prepared(client, draft)])
    finally:
        client.close()
    _, actual = compare(root, queries([
        {"kind": "catalog", "query": "Flesh Ward", "kinds": ["spell"]},
        {"kind": "catalog", "query": "Fixture Ward", "kinds": ["spell"]},
        {"kind": "catalog", "query": "Short Gate", "kinds": ["spell"]},
        {"kind": "catalog", "query": "Workshop Ward", "kinds": ["spell"]},
    ]))
    assert all(row["response"]["ok"] for row in actual["exchanges"])
    rows = actual["exchanges"][0]["response"]["result"]["candidates"]
    assert any(row.get("module_authored", {}).get("authority") == "module_annotation" for row in rows)
    assert actual["exchanges"][2]["response"]["result"]["candidates"][0]["module_authored"]["costs"]["authored"] is False
    assert actual["exchanges"][3]["response"]["result"]["candidates"]
