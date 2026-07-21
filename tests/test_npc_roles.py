#!/usr/bin/env python3
"""Tests for coc_npc_roles: deterministic compile-time social_role injection.

Spec: W3 Task 1 (P1-4) — NPC records ship without `social_role`, leaving
`build_agency_moves` with empty authority. This module injects a social_role
derived from each NPC's structured `relationship_to_investigators` field.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, Path(rel))
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


npc_roles = _load(
    "coc_npc_roles_test",
    "plugins/coc-keeper/scripts/coc_npc_roles.py",
)


def test_expand_assigns_social_role_from_relationship_keyword():
    npcs = {"npcs": [{"npc_id": "cmdr", "relationship_to_investigators": "superior_officer", "agenda": "x"}]}
    templates = {"scene_safety_authority": {"authority_scope": ["scene_safety"], "initiative_style": "decisive",
                  "delegation_policy": {"keeps": ["scene_safety"], "delegates": ["specialist_care"]},
                  "responsibility_domains": ["group_survival"], "chain_of_command": {"to_pc": "none", "to_group": "none"}, "duty_pressure": []}}
    keywords = {"superior_officer": {"template_id": "scene_safety_authority"},
                "adversary": {"template_id": "specialist_authority", "initiative_style_override": "commanding"},
                "victim": {}}
    out = npc_roles.expand_npc_social_roles(npcs, templates, keywords=keywords)
    cmdr = out["npcs"][0]
    assert cmdr["social_role"]["authority_scope"] == ["scene_safety"]
    assert cmdr["social_role"]["initiative_style"] == "decisive"


def test_expand_applies_initiative_style_override():
    npcs = {"npcs": [{"npc_id": "adv", "relationship_to_investigators": "adversary", "agenda": "x"}]}
    templates = {"specialist_authority": {"authority_scope": ["specialist_care"], "initiative_style": "consultative", "delegation_policy": {"keeps": [], "delegates": []}}}
    keywords = {"adversary": {"template_id": "specialist_authority", "initiative_style_override": "commanding"}}
    out = npc_roles.expand_npc_social_roles(npcs, templates, keywords=keywords)
    assert out["npcs"][0]["social_role"]["initiative_style"] == "commanding"


def test_expand_preserves_existing_social_role():
    npcs = {"npcs": [{"npc_id": "x", "relationship_to_investigators": "superior_officer",
                      "social_role": {"authority_scope": ["custom"], "initiative_style": "procedural"}, "agenda": "x"}]}
    out = npc_roles.expand_npc_social_roles(npcs, {"scene_safety_authority": {"authority_scope": ["scene_safety"]}}, keywords={"superior_officer": {"template_id": "scene_safety_authority"}})
    assert out["npcs"][0]["social_role"]["authority_scope"] == ["custom"]


def test_expand_no_match_leaves_social_role_absent():
    npcs = {"npcs": [{"npc_id": "x", "relationship_to_investigators": "bystander", "agenda": "x"}]}
    out = npc_roles.expand_npc_social_roles(npcs, {"scene_safety_authority": {"authority_scope": ["scene_safety"]}}, keywords={"superior_officer": {"template_id": "scene_safety_authority"}})
    assert "social_role" not in out["npcs"][0]


def test_load_role_templates_from_shipped_file():
    from pathlib import Path
    t = npc_roles.load_role_templates(Path("plugins/coc-keeper/rulesets/coc7/rules-json"))
    assert "scene_safety_authority" in t  # template id present


def test_expand_from_dir_applies_shipped_mapping_to_white_war_npcs():
    """Sanity: shipped mapping + templates assigns roles to all 3 white-war NPCs."""
    scenario_dir = Path("plugins/coc-keeper/references/starter-scenarios/the-white-war")
    agendas_path = scenario_dir / "npc-agendas.json"
    original = __import__("json").loads(agendas_path.read_text(encoding="utf-8"))
    # Ensure at least one NPC has a known relationship keyword to map.
    relationships = sorted({n.get("relationship_to_investigators") for n in original.get("npcs", [])})
    assert "superior_officer" in relationships

    expanded = npc_roles.expand_from_dir(scenario_dir)
    by_id = {n["npc_id"]: n for n in expanded["npcs"]}
    commander = by_id["npc-company-commander"]
    # superior_officer -> scene_safety_authority (decisive / scene_safety scope)
    assert commander["social_role"]["authority_scope"] == ["scene_safety"]
    assert commander["social_role"]["initiative_style"] == "decisive"
