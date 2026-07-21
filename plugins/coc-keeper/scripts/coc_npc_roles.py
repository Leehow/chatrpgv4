#!/usr/bin/env python3
"""Deterministic compile-time transform: inject NPC ``social_role``.

P1-4 root cause: shipped NPC records carry a structured
``relationship_to_investigators`` keyword (e.g. ``superior_officer``) but no
``social_role``. The agency layer (``build_agency_moves``) reads only
``social_role`` and therefore returns empty authority for every shipped NPC,
turning them into tool-characters.

This module is the compile bridge: it maps the structured relationship enum to a
``npc-social-roles.json`` template via the ``npc-role-templates.json`` table and
materialises a full ``social_role`` dict on each NPC record. The enum→template
mapping lives entirely here + in the JSON table; the core persona module
(``coc_npc_persona.py``) stays free of concrete role strings so its guard test
keeps passing.

Used at scenario-import / compile time (see
``skills/coc-scenario-import/references/compile-protocol.md``).
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

_SCRIPT_DIR = Path(__file__).resolve().parent


def _load_sibling(name: str, filename: str):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, _SCRIPT_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


coc_rulesets = _load_sibling("coc_rulesets_npc_roles", "coc_rulesets.py")

# Must mirror coc_npc_persona.DEFAULT_SOCIAL_ROLE keys (kept here so this module
# does not import the persona module and stays self-contained at compile time).
_DEFAULT_SOCIAL_ROLE: dict[str, Any] = {
    "authority_scope": [],
    "responsibility_domains": [],
    "chain_of_command": {"to_pc": "none", "to_group": "none"},
    "duty_pressure": [],
    "initiative_style": "consultative",
    "delegation_policy": {"keeps": [], "delegates": []},
}

ROLE_TEMPLATES_FILENAME = "npc-social-roles.json"
ROLE_MAPPING_FILENAME = "npc-role-templates.json"
# Back-compat alias for older call sites / docs that still say "keywords".
ROLE_KEYWORDS_FILENAME = ROLE_MAPPING_FILENAME


def _as_str_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value]
    return [str(value)]


def _normalise_template(raw: dict[str, Any] | None) -> dict[str, Any]:
    """Build a full 6-key social_role dict from a template, defaulting gaps."""
    raw = raw or {}
    role = copy.deepcopy(_DEFAULT_SOCIAL_ROLE)

    role["authority_scope"] = _as_str_list(raw.get("authority_scope"))
    role["responsibility_domains"] = _as_str_list(raw.get("responsibility_domains"))
    role["duty_pressure"] = _as_str_list(raw.get("duty_pressure"))

    chain_in = raw.get("chain_of_command")
    chain = role["chain_of_command"]
    if isinstance(chain_in, dict):
        chain["to_pc"] = str(chain_in.get("to_pc") or chain["to_pc"])
        chain["to_group"] = str(chain_in.get("to_group") or chain["to_group"])
    role["chain_of_command"] = chain

    policy_in = raw.get("delegation_policy")
    policy = role["delegation_policy"]
    if isinstance(policy_in, dict):
        policy["keeps"] = _as_str_list(policy_in.get("keeps"))
        policy["delegates"] = _as_str_list(policy_in.get("delegates"))
    role["delegation_policy"] = policy

    if raw.get("initiative_style"):
        role["initiative_style"] = str(raw["initiative_style"])
    return role


def load_role_templates(rules_dir: Path) -> dict[str, dict[str, Any]]:
    """Load ``npc-social-roles.json`` from ``rules_dir`` into a template_id→body map.

    The shipped file stores templates as a list under a top-level ``templates``
    key; this helper tolerates either a list-of-templates or a flat
    template_id→body object so future schema tweaks do not break the loader.
    Raises FileNotFoundError if the file is absent.
    """
    path = Path(rules_dir) / ROLE_TEMPLATES_FILENAME
    data = json.loads(path.read_text(encoding="utf-8"))
    templates: dict[str, dict[str, Any]] = {}

    raw_templates = data.get("templates")
    if isinstance(raw_templates, list):
        for entry in raw_templates:
            if not isinstance(entry, dict):
                continue
            tid = entry.get("template_id")
            if tid:
                templates[str(tid)] = entry
    elif isinstance(raw_templates, dict):
        for tid, body in raw_templates.items():
            if isinstance(body, dict):
                templates[str(tid)] = body
    else:
        # Fall back to any template_id-keyed top-level entries.
        for key, value in data.items():
            if isinstance(value, dict) and "template_id" in value:
                templates[str(value["template_id"])] = value
    return templates


def load_role_mappings(rules_dir: Path) -> dict[str, dict[str, Any]]:
    """Load ``npc-role-templates.json`` from ``rules_dir``.

    Returns the ``mappings`` dict (relationship enum →
    ``{template_id?, initiative_style_override?}``). Missing file returns an
    empty mapping (compile does not hard-fail on a missing table; callers
    without a table simply get no role injected).
    """
    path = Path(rules_dir) / ROLE_MAPPING_FILENAME
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    mappings = data.get("mappings")
    if not isinstance(mappings, dict):
        return {}
    return {str(k): (v if isinstance(v, dict) else {}) for k, v in mappings.items()}


def load_role_keywords(rules_dir: Path) -> dict[str, dict[str, Any]]:
    """Deprecated alias for ``load_role_mappings`` (N8 rename)."""
    return load_role_mappings(rules_dir)


def expand_npc_social_roles(
    npc_agendas: dict[str, Any],
    templates: dict[str, dict[str, Any]],
    *,
    keywords: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Inject ``social_role`` on each NPC based on its relationship keyword.

    Deterministic rules:
      * If an NPC already has a non-empty ``social_role`` it is preserved as-is
        (authors win over compile inference).
      * Else look up ``relationship_to_investigators`` in ``keywords``. If the
        keyword maps to a ``template_id`` present in ``templates``, build a
        social_role from that template and apply ``initiative_style_override``.
      * A keyword present in the table but with no template_id (or an unknown
        template_id) leaves ``social_role`` absent — the NPC falls back to the
        default-empty role at persona-build time.
    """
    keywords = keywords or {}
    out = copy.deepcopy(npc_agendas)
    for npc in out.get("npcs", []) or []:
        if not isinstance(npc, dict):
            continue
        if npc.get("social_role"):
            continue  # author-provided role wins
        relationship = npc.get("relationship_to_investigators")
        if not relationship:
            continue
        mapping = keywords.get(str(relationship))
        if not mapping:
            continue
        template_id = mapping.get("template_id")
        if not template_id:
            continue
        template = templates.get(str(template_id))
        if not template:
            continue
        role = _normalise_template(template)
        override = mapping.get("initiative_style_override")
        if override:
            role["initiative_style"] = str(override)
        npc["social_role"] = role
    return out


def expand_from_dir(
    scenario_dir: Path,
    *,
    rules_dir: Path | None = None,
) -> dict[str, Any]:
    """Load npc-agendas.json from ``scenario_dir`` and return role-expanded copy.

    Resolves templates + relationship→template mappings from ``rules_dir``
    (defaults to the shipped default ruleset's ``rules-json`` via the
    ruleset registry). Reads ``scenario_dir/npc-agendas.json``; does not
    write back. Callers persist the result themselves.
    """
    scenario_dir = Path(scenario_dir)
    if rules_dir is None:
        rules_dir = coc_rulesets.ruleset_data_dir(coc_rulesets.DEFAULT_RULESET_ID)
    rules_dir = Path(rules_dir)
    templates = load_role_templates(rules_dir)
    keywords = load_role_mappings(rules_dir)
    agendas = json.loads((scenario_dir / "npc-agendas.json").read_text(encoding="utf-8"))
    return expand_npc_social_roles(agendas, templates, keywords=keywords)
