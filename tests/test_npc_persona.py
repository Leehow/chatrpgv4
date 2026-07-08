#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
from pathlib import Path


def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, Path(rel))
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


coc_npc_persona = _load(
    "coc_npc_persona_test",
    "plugins/coc-keeper/scripts/coc_npc_persona.py",
)


def test_core_code_does_not_branch_on_concrete_roles():
    text = Path("plugins/coc-keeper/scripts/coc_npc_persona.py").read_text(encoding="utf-8").lower()

    forbidden_terms = [
        "班长",
        "警官",
        "房东",
        "探险队领队",
        "squad leader",
        "police officer",
        "landlord",
        "professor",
        "guide",
        "soldier",
        "机枪手",
        "卫生兵",
    ]
    for term in forbidden_terms:
        assert term not in text


def test_persona_generation_is_seed_stable_and_uses_abstract_fields():
    npc = {
        "npc_id": "npc-alpha",
        "social_role": {
            "authority_scope": ["scene_safety"],
            "responsibility_domains": ["group_survival"],
            "chain_of_command": {"to_pc": "superior", "to_group": "commands"},
            "duty_pressure": ["harm_under_care"],
            "initiative_style": "decisive",
            "delegation_policy": {
                "keeps": ["scene_safety"],
                "delegates": ["specialist_care"],
            },
        },
        "persona_tag_weights": {
            "temperament.impatient": 4,
            "voice.short_orders": 3,
            "stress_response.command": 3,
        },
    }

    first = coc_npc_persona.build_persona_card(
        npc,
        seed_parts=["campaign-a", "scene-a", "npc-alpha"],
    )
    second = coc_npc_persona.build_persona_card(
        npc,
        seed_parts=["campaign-a", "scene-a", "npc-alpha"],
    )

    assert first == second
    assert first["npc_id"] == "npc-alpha"
    assert first["social_role"]["authority_scope"] == ["scene_safety"]
    assert first["social_role"]["initiative_style"] == "decisive"
    assert first["persona"]["tags"]
    assert all("." in tag for tag in first["persona"]["tags"])
    assert first["generation"]["seed"]
    assert "temperament" in first["generation"]["rolls"]
    assert first["name"]["status"] == "pending_llm"


def test_instantiate_npc_adds_demographics_name_context_and_generation_log():
    npc = {
        "npc_id": "npc-auto-003",
        "lifecycle": "silhouette",
        "social_role": {
            "authority_scope": ["property_access"],
            "responsibility_domains": ["guest_safety"],
            "initiative_style": "consultative",
        },
        "persona_tag_weights": {
            "demographic.young_adult": 4,
            "body.tall": 2,
            "voice.soft_deflection": 3,
            "temperament.nervous": 4,
            "habit.avoids_eye_contact": 3,
            "stress_response.seek_help": 2,
            "values.reputation": 2,
            "relationship_seed.depends_on_pc": 1,
        },
        "name_context": {
            "culture": "module-supplied culture",
            "era": "module-supplied era",
            "language": "module-supplied language",
        },
    }
    context = {
        "campaign_id": "camp-1",
        "scene_id": "scene-1",
        "module_id": "module-1",
        "era": "1920s",
        "location_tags": ["urban", "public_interior"],
        "role_hint": "module-defined-role",
        "authority_demands": ["property_access"],
    }

    card = coc_npc_persona.instantiate_npc(
        npc,
        context=context,
        seed_parts=["camp-1", "scene-1", "npc-auto-003"],
    )

    assert card["lifecycle"] == "silhouette"
    assert card["name"]["status"] == "pending_llm"
    assert card["name"]["context"]["culture"] == "module-supplied culture"
    assert "demographic" in card["generation"]["rolls"]
    assert "voice" in card["generation"]["rolls"]
    assert card["generation_log"]["event_type"] == "npc_generation"
    assert card["generation_log"]["npc_id"] == "npc-auto-003"
    assert card["generation_log"]["inputs"]["location_tags"] == ["urban", "public_interior"]
    assert card["generation_log"]["name"]["status"] == "pending_llm"


def test_apply_llm_name_marks_generated_name_without_affecting_rules():
    card = coc_npc_persona.instantiate_npc(
        {"npc_id": "npc-auto-004", "name_context": {"culture": "context-only"}},
        context={"campaign_id": "camp-1", "scene_id": "scene-1"},
        seed_parts=["camp-1", "scene-1", "npc-auto-004"],
    )

    named = coc_npc_persona.apply_llm_name(card, "Luis Carranza")

    assert named["name"]["status"] == "generated"
    assert named["name"]["value"] == "Luis Carranza"
    assert named["name"]["source"] == "llm_name_context"
    assert named["social_role"] == card["social_role"]


def test_agency_move_asserts_responsibility_when_authority_matches_scene():
    card = {
        "npc_id": "npc-alpha",
        "social_role": {
            "authority_scope": ["scene_safety"],
            "responsibility_domains": ["group_survival"],
            "initiative_style": "decisive",
            "delegation_policy": {
                "keeps": ["scene_safety"],
                "delegates": ["specialist_care"],
            },
        },
        "persona": {
            "tags": ["temperament.impatient", "voice.short_orders", "stress_response.command"],
        },
    }
    scene_context = {
        "scene_tags": ["crisis"],
        "authority_demands": ["scene_safety"],
        "responsibility_threats": ["group_survival"],
    }

    moves = coc_npc_persona.build_agency_moves(card, scene_context, player_intent_rich={})

    assert moves
    assert moves[0]["move_id"] == "take_command"
    assert moves[0]["npc_id"] == "npc-alpha"
    assert moves[0]["reason"] == "authority_scope_matches_scene"
    assert moves[0]["rules_effect"]["kind"] == "npc_assist"
    assert moves[0]["rules_effect"]["actor_role"] == "npc"


def test_agency_move_uses_matched_responsibility_threat_as_active_pressure():
    card = {
        "npc_id": "npc-alpha",
        "social_role": {
            "authority_scope": ["scene_safety", "group_movement"],
            "responsibility_domains": ["group_survival"],
            "initiative_style": "commanding",
            "delegation_policy": {
                "keeps": ["scene_safety", "group_movement"],
                "delegates": ["specialist_care"],
            },
        },
        "persona": {
            "tags": ["temperament.impatient", "voice.short_orders", "stress_response.command"],
        },
    }
    scene_context = {
        "scene_tags": ["environmental_pressure"],
        "authority_demands": ["group_movement"],
        "responsibility_threats": ["group_survival"],
    }

    moves = coc_npc_persona.build_agency_moves(card, scene_context, player_intent_rich={})

    assert moves
    assert moves[0]["move_id"] == "take_command"
    assert moves[0]["matched_authority_scope"] == ["group_movement"]
    assert moves[0]["matched_responsibility"] == ["group_survival"]
    assert "NPC visibly takes responsibility" in moves[0]["agency_directive"]


def test_agency_does_not_fire_without_matching_authority():
    card = {
        "npc_id": "npc-beta",
        "social_role": {
            "authority_scope": ["evidence_control"],
            "responsibility_domains": ["case_integrity"],
            "initiative_style": "decisive",
        },
        "persona": {"tags": ["temperament.cautious"]},
    }
    scene_context = {
        "scene_tags": ["crisis"],
        "authority_demands": ["scene_safety"],
        "responsibility_threats": ["group_survival"],
    }

    assert coc_npc_persona.build_agency_moves(card, scene_context, player_intent_rich={}) == []


def test_agency_moves_can_emit_npc_rule_requests():
    agency_moves = [{
        "npc_id": "npc-alpha",
        "move_id": "take_command",
        "rules_effect": {
            "kind": "npc_assist",
            "actor_role": "npc",
            "bonus_dice": 1,
            "scope": "scene_safety",
            "reason": "keeps bystanders back",
        },
    }]

    requests = coc_npc_persona.rules_requests_from_agency_moves(agency_moves)

    assert requests == [{
        "kind": "npc_assist",
        "actor_role": "npc",
        "npc_id": "npc-alpha",
        "bonus_dice": 1,
        "scope": "scene_safety",
        "reason": "keeps bystanders back",
        "source": "npc_agency_move",
    }]


def test_agency_move_delegates_specialist_when_policy_delegates_matching_need():
    card = {
        "npc_id": "npc-alpha",
        "social_role": {
            "authority_scope": ["scene_safety"],
            "responsibility_domains": ["group_survival"],
            "initiative_style": "commanding",
            "delegation_policy": {"keeps": ["scene_safety"], "delegates": ["specialist_care"]},
        },
        "persona": {"tags": ["temperament.impatient", "voice.short_orders"]},
    }
    scene_context = {
        "scene_tags": ["crisis"],
        "authority_demands": ["scene_safety"],
        "responsibility_threats": ["group_survival"],
    }

    moves = coc_npc_persona.build_agency_moves(
        card,
        scene_context,
        player_intent_rich={"intent_tags": ["yield_initiative"], "secondary_intents": ["specialist_care"]},
    )

    move_ids = [move["move_id"] for move in moves]
    assert "take_command" in move_ids
    assert "delegate_specialist" in move_ids
    assert all("reason" in move for move in moves)


def test_agency_move_panic_from_stress_response_without_concrete_role():
    card = {
        "npc_id": "npc-beta",
        "social_role": {
            "authority_scope": ["self_preservation"],
            "responsibility_domains": ["own_safety"],
            "initiative_style": "avoidant",
        },
        "persona": {"tags": ["stress_response.panic", "temperament.nervous"]},
    }
    scene_context = {
        "scene_tags": ["crisis"],
        "authority_demands": ["self_preservation"],
        "responsibility_threats": ["own_safety"],
    }

    moves = coc_npc_persona.build_agency_moves(card, scene_context, player_intent_rich={})

    assert [move["move_id"] for move in moves] == ["panic"]
    assert moves[0]["rules_effect"]["kind"] == "none"
    assert coc_npc_persona.rules_requests_from_agency_moves(moves) == []


def test_agency_move_taxonomy_uses_abstract_duty_and_persona_tags():
    card = {
        "npc_id": "npc-gamma",
        "social_role": {
            "authority_scope": ["scene_safety"],
            "responsibility_domains": ["group_survival", "evidence_security"],
            "initiative_style": "protective",
            "delegation_policy": {"keeps": ["scene_safety"], "delegates": ["specialist_care"]},
        },
        "persona": {
            "tags": [
                "temperament.cautious",
                "temperament.secretive",
                "stress_response.rush",
            ]
        },
    }
    scene_context = {
        "scene_tags": ["crisis", "evidence_at_risk"],
        "authority_demands": ["scene_safety"],
        "responsibility_threats": ["group_survival", "evidence_security"],
    }
    rich = {
        "intent_tags": ["yield_initiative"],
        "secondary_intents": ["specialist_care", "reckless_plan", "requests_help"],
    }

    moves = coc_npc_persona.build_agency_moves(card, scene_context, player_intent_rich=rich)

    move_ids = [move["move_id"] for move in moves]
    for expected in ["protect", "take_command", "delegate_specialist", "object", "assist", "withhold", "rush"]:
        assert expected in move_ids
    assert all("reason" in move for move in moves)
    assert all("scene_safety" not in move.get("move_id", "") for move in moves)


def test_upgrade_npc_stats_promotes_lifecycle_and_logs_generated_parameters():
    card = coc_npc_persona.instantiate_npc(
        {"npc_id": "npc-auto-005", "lifecycle": "silhouette"},
        context={"campaign_id": "camp-1", "scene_id": "scene-2"},
        seed_parts=["camp-1", "scene-2", "npc-auto-005"],
    )
    archetypes = {
        "archetypes": [{
            "archetype_id": "ordinary_adult",
            "to_lifecycle": "mechanical_actor",
            "characteristics": {
                "STR": [35, 65],
                "CON": [35, 65],
                "SIZ": [35, 65],
                "DEX": [35, 65],
                "POW": [35, 65],
            },
            "skills": {
                "Persuade": [20, 50],
                "Psychology": [10, 40],
            },
        }]
    }

    upgraded, log = coc_npc_persona.upgrade_npc_stats(
        card,
        archetypes,
        archetype_id="ordinary_adult",
        reason="entered_opposed_roll",
        seed_parts=["camp-1", "scene-2", "npc-auto-005", "stats"],
    )

    assert upgraded["lifecycle"] == "mechanical_actor"
    assert upgraded["stat_profile"]["archetype_id"] == "ordinary_adult"
    assert 35 <= upgraded["stat_profile"]["characteristics"]["STR"] <= 65
    assert upgraded["stat_profile"]["derived"]["HP"] >= 7
    assert log["event_type"] == "npc_stat_upgrade"
    assert log["from_lifecycle"] == "silhouette"
    assert log["to_lifecycle"] == "mechanical_actor"
    assert log["generated_stats"]["key_skills"]["Persuade"] >= 20
    assert log["rule_refs"] == ["core.npc.stat_archetypes"]
