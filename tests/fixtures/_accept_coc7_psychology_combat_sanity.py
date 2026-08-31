#!/usr/bin/env python3
"""Build independently source-reviewed RuleShards for three complete families.

This generator never writes the shared production graph or manifests. It
prepares exact PDF-bound packets, builds family-local reviewed candidates,
passes them through canonical ``coc_rule_graph.accept()``, and writes only the
three disjoint source-stage1 family evidence directories.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any, Mapping


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_rule_graph as rg  # noqa: E402


BUNDLE_ROOT_ENV = "COC_RULE_GRAPH_FULL_FAMILY_BUNDLE_ROOT"
SOURCE_ID = "pdf:coc7-keeper-rulebook-40th"
FILE_SHA256 = "a860499cf34b40cac385f51b6e667ab37ec0796c7329494def08c8b161fd71eb"
OUTPUT = (
    ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7"
    / "rule-graph-candidates" / "source-stage1" / "families"
)

FAMILY_CONFIG: dict[str, dict[str, Any]] = {
    "psychology": {
        "bundle": "psychology-full-v1",
        "bundle_sha256": "df4cceb1c29cdc530a43ef8b51122d85c20be2fb43a7fcfd0bbb6191ae1f1ae0",
        "pages": [83, 84, 215],
        "section_id": "section-psychology-complete-source",
        "reviewer_identity": "codex-worker-psychology-target-review-20260831-v2",
    },
    "combat": {
        "bundle": "combat-full-v2",
        "bundle_sha256": "5e1a929b0b37f9782fcfb67a24c94846d6e12612f84b3523f9d01cd97413c8eb",
        "pages": [*range(113, 131), *range(412, 418)],
        "section_id": "section-combat-complete-source",
        "reviewer_identity": "codex-worker-combat-end-slot-review-20260831-v2",
    },
    "sanity": {
        "bundle": "sanity-full-v1",
        "bundle_sha256": "ce3c510abac55d751b3d8f35e418d5a17e378baaa3317b2fe75604f3ab2c6754",
        "pages": [*range(165, 181)],
        "section_id": "section-sanity-complete-source",
        "reviewer_identity": "codex-worker-sanity-source-review-20260831",
    },
}

PHRASES: dict[str, dict[str, tuple[str, ...]]] = {
    "psychology": {
        "skill": ("Psychology (10%)", "form an idea of another person's motives and character"),
        "concealed": ("concealed Psychology skill rolls", "announcing only the information"),
        "opposition": ("Psychology can be used to oppose all forms of social interaction",),
        "difficulty": ("below 50%", "between 50% and 89%"),
        "disguise": ("see through someone's disguise",),
        "truth": ("truth should be revealed",),
        "uncertain": ("won't know if the information is reliable",),
    },
    "combat": {
        "round": ("The Combat Round", "Dexterity and the Order of Attack", "Actions in a Combat Round"),
        "melee": ("Resolving a Fighting Attack Made", "Fist Fights"),
        "damage": ("Determining Damage", "Extreme Damage and Impales"),
        "no-push": ("No Pushing",),
        "maneuver": ("Fighting Maneuvers", "by three or more, any fighting maneuvers are ineffective"),
        "surprise": ("Striking the First Blow", "anticipates the attack"),
        "outnumbered": ("Outnumbered", "subsequent melee attacks"),
        "ranged": ("Ranged and Thrown Weapons", "Escaping Close Combat", "Armor"),
        "firearms": ("Firearms and the DEX Order", "Range and Firearms", "Firearm Attack Modifiers"),
        "modifiers": ("Diving for Cover", "Point-Blank Range", "Aiming (Bonus die)"),
        "automatic": ("Automatic Fire", "Rolling to hit with automatic fire"),
        "malfunction": ("Malfunctions", "malfunction number"),
        "weapons": ("Uses per Round", "Damage:", "Malfunction (Mal)"),
        "special": ("Stun: Target may not act", "Burn: Target must roll Luck"),
    },
    "sanity": {
        "san-roll": ("Sanity Points and SAN Rolls", "A fumbled Sanity roll"),
        "max-san": ("Maximum Sanity", "99 minus current Cthulhu Mythos"),
        "temporary": ("Temporary Insanity", "5 or more Sanity points from a single source"),
        "indefinite": ("Indefinite Insanity", "a fifth or more of current Sanity points"),
        "permanent": ("Permanent Insanity", "Sanity points are reduced to zero"),
        "bout-real": ("A Bout of Madness—Real Time", "1D10 combat rounds"),
        "bout-summary": ("A Bout of Madness—Summary", "1D10 hours"),
        "underlying": ("Insanity Phase 2: Underlying Insanity", "any further loss of Sanity points"),
        "phobia-mania": ("Phobic and Manic Responses While Insane", "Table IX: Sample Phobias", "Table X: Sample Manias"),
        "reality": ("Reality Check Rolls", "Failure: lose 1 Sanity point"),
        "mythos": ("Mythos-induced trauma", "Cthulhu Mythos skill"),
        "treatment": ("Treatment and Recovery from Insanity", "After each month of treatment"),
        "temporary-recovery": ("Temporary insanity lasts 1D10 hours", "good night's sleep"),
        "san-gain": ("Increasing Current Sanity Points", "Psychotherapy", "Self-help"),
        "awfulness": ("Getting Used to the Awfulness",),
        "optional": ("Mythos Hardened", "Multiple Sanity rolls", "Insane Insight"),
    },
}

RULES: dict[str, tuple[tuple[str, str, str], ...]] = {
    "psychology": (
        ("base-chance-ten", "Psychology has a base chance of ten percent", "skill"),
        ("study-motives-character", "Psychology studies a person to infer motives and character", "skill"),
        ("concealed-keeper-roll", "The Keeper may roll Psychology concealed and announce only gained information", "concealed"),
        ("social-opposition", "Psychology opposes Charm, Fast Talk, Intimidate, and Persuade", "opposition"),
        ("social-difficulty-bands", "Opposing social skill below 50 is Regular and 50 through 89 is Hard", "difficulty"),
        ("disguise-opposition", "Psychology can oppose Disguise", "disguise"),
        ("success-reveals-truth", "A successful Psychology roll reveals the truth", "truth"),
        ("failure-reliability-unknown", "After failure information may be true or false and its reliability stays unknown", "uncertain"),
    ),
    "combat": (
        ("round-and-action-economy", "Combat proceeds in elastic rounds with one action opportunity per capable character", "round"),
        ("dex-order", "Combatants act from highest DEX to lowest with combat skill breaking ties", "round"),
        ("ready-firearm-initiative", "A readied firearm acts at DEX plus fifty", "firearms"),
        ("combat-rolls-not-pushable", "Combat rolls cannot be pushed", "no-push"),
        ("fight-back-opposition", "Melee fight back is opposed and ties favor the initiating attacker", "melee"),
        ("dodge-opposition", "Melee dodge is opposed and ties favor the dodging defender", "melee"),
        ("weapon-damage", "Successful attacks apply weapon damage and unarmed attacks use 1D3", "damage"),
        ("extreme-and-impale", "Extreme attacks maximize damage and penetrating weapons add an impale damage roll", "damage"),
        ("maneuver-build", "Fighting maneuvers use Build penalties and become impossible at a three-point deficit", "maneuver"),
        ("maneuver-goal", "A successful fighting maneuver applies its declared non-damage goal", "maneuver"),
        ("surprise", "An unanticipated surprise attack may hit automatically or gain a bonus die", "surprise"),
        ("outnumbered", "After a target defends in a round subsequent melee attackers gain a bonus die", "outnumbered"),
        ("ranged-and-thrown", "Ranged and thrown attacks use firearm range difficulty and limited close defense", "ranged"),
        ("escape-close-combat", "A combatant may flee close combat on their action if an escape route is open and they are unrestrained", "ranged"),
        ("armor-reduction", "Ordinary physical armor subtracts its rating from incoming damage", "ranged"),
        ("firearms-unopposed", "Firearm attacks are normally unopposed and failure deals no damage", "firearms"),
        ("firearm-range", "Base, long, and very-long range set Regular, Hard, and Extreme difficulty", "firearms"),
        ("firearm-modifiers", "Cover, diving, point blank, aiming, speed, size, reloading, and multiple shots modify firearm attacks", "modifiers"),
        ("automatic-fire", "Automatic fire resolves declared ammunition in volleys with recoil penalties and per-volley hits", "automatic"),
        ("malfunction", "An attack roll at or above a weapon malfunction rating jams or misfires the weapon", "malfunction"),
        ("weapon-profile-columns", "Weapon profiles define skill, damage, range, uses, capacity, malfunction, and era", "weapons"),
        ("stun-and-burn", "Weapon special effects include bounded Stun and escalating Burn", "special"),
    ),
    "sanity": (
        ("san-roll", "A SAN roll compares 1D100 with current Sanity and selects success or failure loss", "san-roll"),
        ("failed-roll-involuntary-action", "A failed SAN roll causes a Keeper-chosen momentary involuntary action", "san-roll"),
        ("fumble-maximum-loss", "A fumbled SAN roll loses the encounter maximum", "san-roll"),
        ("max-san", "Maximum Sanity is 99 minus current Cthulhu Mythos skill", "max-san"),
        ("temporary-threshold-and-int", "Five or more SAN from one source prompts INT; success triggers temporary insanity", "temporary"),
        ("indefinite-daily-fraction", "Losing one fifth of current SAN in one Keeper-defined day triggers indefinite insanity", "indefinite"),
        ("permanent-at-zero", "SAN zero causes permanent insanity and ends player control", "permanent"),
        ("bout-real-time", "A real-time bout lasts 1D10 combat rounds under Keeper control", "bout-real"),
        ("bout-summary", "An isolated or group-wide bout may be summarized over 1D10 hours and can be interrupted", "bout-summary"),
        ("underlying-repeat-bout", "Any further SAN loss during underlying insanity starts another bout", "underlying"),
        ("phobia-and-mania", "Phobia and mania exposure impose their stated penalties while insane", "phobia-mania"),
        ("reality-check", "A reality check can dispel delusion; failure loses one SAN and starts a bout", "reality"),
        ("mythos-insanity-gain", "Mythos-induced insanity grants Cthulhu Mythos skill and lowers maximum SAN", "mythos"),
        ("temporary-recovery", "Temporary insanity ends after 1D10 hours or safe sleep", "temporary-recovery"),
        ("indefinite-treatment", "Indefinite treatment is checked monthly or resolves at the Keeper's chapter boundary", "treatment"),
        ("sanity-increase", "Keeper awards, skill mastery, monthly psychotherapy, and self-help can raise current SAN within maximum", "san-gain"),
        ("getting-used-to-awfulness", "Repeated exposure can cap SAN loss from one Mythos creature type", "awfulness"),
        ("optional-insane-insight", "Optional insane insight may reveal a useful clue or action", "optional"),
        ("optional-mythos-hardened", "Optional Mythos hardening changes future Mythos SAN loss and personality", "optional"),
        ("optional-multiple-san-rolls", "Optional simultaneous-monster handling may use one roll and the highest loss", "optional"),
    ),
}


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def spans_for(packet: Mapping[str, Any], phrases: tuple[str, ...]) -> list[str]:
    rows = [
        str(span["span_id"])
        for span in (packet.get("evidence_view") or {}).get("spans") or []
        if any(phrase.casefold() in str(span.get("text") or "").casefold() for phrase in phrases)
    ]
    if not rows:
        raise ValueError(f"no source span selected for phrases: {phrases}")
    return sorted(set(rows))


def node(
    family: str,
    node_id: str,
    kind: str,
    name: str,
    spans: list[str],
    *,
    authority: str = "deterministic",
    audience: str = "host-internal",
    visibility: str = "keeper-only",
    properties: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "node_id": node_id,
        "node_kind": kind,
        "name": name,
        "authority": authority,
        "audience": audience,
        "visibility": visibility,
        "hard_gate": False,
        "properties": dict(properties or ({"family_id": family} if kind in {
            "rule", "decision", "capability", "effect", "continuation", "exception"
        } else {})),
        "evidence_span_ids": spans,
    }


def relation(
    family: str,
    suffix: str,
    kind: str,
    source: str,
    target: str,
    spans: list[str],
) -> dict[str, Any]:
    return {
        "relation_id": f"relation:coc7:{family}:{suffix}",
        "relation_kind": kind,
        "from_node_id": source,
        "to_node_id": target,
        "evidence_span_ids": spans,
    }


def prepare(bundle_root: Path, family: str) -> tuple[dict[str, Any], dict[str, Any]]:
    config = FAMILY_CONFIG[family]
    bundle = bundle_root / config["bundle"]
    normalized = read_json(bundle / "normalized-source.json")
    if normalized.get("bundle_sha256") != config["bundle_sha256"]:
        raise ValueError(f"{family} source bundle digest drift")
    if (normalized.get("source") or {}).get("file_sha256") != FILE_SHA256:
        raise ValueError(f"{family} source PDF digest drift")
    if [row.get("pdf_index") for row in normalized.get("pages") or []] != config["pages"]:
        raise ValueError(f"{family} source page scope drift")
    result = rg.prepare({
        "ruleset_id": "coc7",
        "ruleset_version": "1.0.0",
        "source_language": "en",
        "family_id": family,
        "section_id": config["section_id"],
        "bundle_dirs": [str(bundle)],
        "page_keys": [(SOURCE_ID, index) for index in config["pages"]],
        "known_nodes": [],
        "output_budget": {"max_nodes": 250, "max_relations": 400},
        "families": [family],
    })
    if not result.get("ok"):
        raise ValueError(result.get("findings"))
    return result["shard"], normalized


def _psychology_executable(
    groups: Mapping[str, list[str]], all_spans: list[str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    family = "psychology"
    observe = "decision:coc7:psychology:observe-concealed"
    realize = "decision:coc7:psychology:realize-player-safe"
    check_cap = "capability:coc7:psychology-check-contract"
    policy_cap = "capability:coc7:psychology-policy"
    projection_cap = "capability:coc7:psychology-realization-public-projection"
    nodes: list[dict[str, Any]] = [
        node(
            family, check_cap, "capability",
            "Existing resolver Psychology observation contract", all_spans,
            properties={
                "family_id": family,
                "resolver_capability": "psychology_check_contract",
                "adapter": "resolver",
            },
        ),
        node(
            family, policy_cap, "capability",
            "Existing resolver Psychology outcome policy", all_spans,
            properties={
                "family_id": family,
                "resolver_capability": "psychology_policy",
                "adapter": "resolver",
            },
        ),
        node(
            family, projection_cap, "capability",
            "Existing player-safe Psychology realization projection", all_spans,
            properties={
                "family_id": family,
                "resolver_capability": "psychology_realization_public_projection",
                "adapter": "resolver",
            },
        ),
        node(
            family, observe, "decision",
            "Settle one Keeper-concealed Psychology observation window",
            all_spans, authority="mixed", audience="keeper",
            visibility="concealed-result",
            properties={
                "family_id": family,
                "implementation": {
                    "adapter": "resolver",
                    "kind": "psychology_check_contract",
                    "phase": "settle",
                    "payload_constants": {},
                    "payload_slots": [
                        {"name": "question", "ownership": "player-source"},
                        {"name": "target_ref", "ownership": "keeper-semantic"},
                        {"name": "investigator_id", "ownership": "host-locked"},
                        {"name": "npc_id", "ownership": "host-locked"},
                        {"name": "observer_skill", "ownership": "host-locked"},
                        {"name": "target_opposing_social", "ownership": "host-locked"},
                        {"name": "conversation_window_id", "ownership": "host-locked"},
                        {"name": "observation_revision", "ownership": "host-locked"},
                        {"name": "observer_scope", "ownership": "host-locked"},
                        {"name": "observable_fact_refs", "ownership": "host-locked"},
                    ],
                },
            },
        ),
        node(
            family, realize, "decision",
            "Realize one frozen Psychology observation as player-safe behavior",
            all_spans, authority="mixed", audience="keeper", visibility="public",
            properties={
                "family_id": family,
                "implementation": {
                    "adapter": "resolver",
                    "kind": "psychology_policy",
                    "phase": "realize",
                    "payload_constants": {},
                    "payload_slots": [
                        {"name": "external_behavior", "ownership": "keeper-semantic"},
                        {"name": "inference_ceiling", "ownership": "host-locked"},
                        {"name": "observation_receipt_ref", "ownership": "host-locked"},
                    ],
                },
            },
        ),
        node(
            family, "visibility-policy:coc7:psychology:concealed-observe",
            "visibility-policy", "Observation die and outcome remain Keeper-concealed",
            groups["concealed"], properties={"policy": "concealed-result"},
        ),
        node(
            family, "visibility-policy:coc7:psychology:player-safe-realize",
            "visibility-policy", "Only external behavior is player-visible",
            sorted(set(groups["truth"] + groups["uncertain"])),
            properties={"policy": "public"},
        ),
    ]
    slot_specs = (
        ("question", "player-source", "string", "intent.method", observe),
        ("target-ref", "keeper-semantic", "string", "intent.method", observe),
        ("investigator-id", "host-locked", "string", "actor.id", observe),
        ("npc-id", "host-locked", "string", "actor.id", observe),
        ("observer-skill", "host-locked", "int", "actor.sheet.psychology", observe),
        ("target-opposing-social", "host-locked", "int", "actor.sheet.opposing_social", observe),
        ("conversation-window-id", "host-locked", "string", "receipt.last_outcome", observe),
        ("observation-revision", "host-locked", "int", "receipt.last_outcome", observe),
        ("observer-scope", "host-locked", "string", "receipt.last_outcome", observe),
        ("observable-fact-refs", "host-locked", "object", "receipt.last_outcome", observe),
        ("external-behavior", "keeper-semantic", "string", "intent.method", realize),
        ("inference-ceiling", "host-locked", "string", "receipt.last_outcome", realize),
        ("observation-receipt-ref", "host-locked", "string", "receipt.last_outcome", realize),
    )
    relations: list[dict[str, Any]] = [
        relation(family, "observe-invokes-contract", "invokes", observe, check_cap, all_spans),
        relation(family, "realize-invokes-policy", "invokes", realize, policy_cap, all_spans),
        relation(family, "policy-implemented-by-public-projection", "implemented-by", policy_cap, projection_cap, all_spans),
        relation(family, "observe-continues-as-realize", "continues-as", observe, realize, all_spans),
        relation(
            family, "concealed-policy-applies-observe", "applies-to",
            "visibility-policy:coc7:psychology:concealed-observe", observe,
            groups["concealed"],
        ),
        relation(
            family, "public-policy-applies-realize", "applies-to",
            "visibility-policy:coc7:psychology:player-safe-realize", realize,
            sorted(set(groups["truth"] + groups["uncertain"])),
        ),
    ]
    for slug, ownership, value_type, path, decision_ref in slot_specs:
        slot_id = f"input-slot:coc7:psychology:{slug}"
        slot_name = (
            "Semantic retained psychology-target:<npc_id> reference"
            if slug == "target-ref"
            else slug.replace("-", " ")
        )
        nodes.append(node(
            family, slot_id, "input-slot", slot_name, all_spans,
            properties={
                "family_id": family,
                "ownership": ownership,
                "value_type": value_type,
                "path": path,
            },
        ))
        relations.append(relation(
            family, f"{decision_ref.rsplit(':', 1)[-1]}-{slug}",
            "locks-input" if ownership == "host-locked" else "requires-input",
            decision_ref, slot_id, all_spans,
        ))
    observe_groups = {"skill", "concealed", "opposition", "difficulty", "disguise"}
    for slug, _name, group in RULES[family]:
        rule_id = f"rule:coc7:{family}:{slug}"
        capability = check_cap if group in observe_groups else policy_cap
        decision_ref = observe if group in observe_groups else realize
        relations.extend([
            relation(family, f"{slug}-invokes-capability", "invokes", rule_id, capability, groups[group]),
            relation(family, f"{slug}-applies-to-decision", "applies-to", rule_id, decision_ref, groups[group]),
        ])
    return nodes, relations


def _combat_executable(
    groups: Mapping[str, list[str]], all_spans: list[str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    family = "combat"
    context_cap = "capability:coc7:combat-context"
    resolve_cap = "capability:coc7:combat-resolve"
    end_cap = "capability:coc7:combat-end"
    subsystem = "subsystem:coc7:combat-session"
    decisions = {
        "context": (context_cap, "context", "context", []),
        "attack": (resolve_cap, "combat.resolve", "resolve", [
            ("candidate_ref", "keeper-semantic"),
            ("weapon_ref", "optional-semantic"),
            ("weapon_effect_refs", "optional-semantic"),
            ("luck_spend_max", "optional-semantic"),
            ("investigator_id", "host-locked"),
            ("target_npc_id", "host-locked"),
            ("affordance_id", "host-locked"),
            ("weapon_id", "host-locked"),
            ("weapon_effect_ids", "host-locked"),
            ("combat_revision", "host-locked"),
        ]),
        "defend": (resolve_cap, "combat.resolve", "resolve-defense", [
            ("defense_kind", "player-source"),
            ("luck_spend_max", "optional-semantic"),
            ("investigator_id", "host-locked"),
            ("pending_attack_ref", "host-locked"),
            ("attack_command_id", "host-locked"),
            ("target_actor_id", "host-locked"),
            ("combat_revision", "host-locked"),
        ]),
        "maneuver": (resolve_cap, "combat.resolve", "resolve-maneuver", [
            ("candidate_ref", "keeper-semantic"),
            ("goal", "keeper-semantic"),
            ("investigator_id", "host-locked"),
            ("target_npc_id", "host-locked"),
            ("affordance_id", "host-locked"),
            ("combat_revision", "host-locked"),
        ]),
        "aim": (resolve_cap, "combat.resolve", "resolve-aim", [
            ("weapon_ref", "optional-semantic"),
            ("investigator_id", "host-locked"),
            ("weapon_id", "host-locked"),
            ("combat_revision", "host-locked"),
        ]),
        "reload": (resolve_cap, "combat.resolve", "resolve-reload", [
            ("weapon_ref", "optional-semantic"),
            ("investigator_id", "host-locked"),
            ("weapon_id", "host-locked"),
            ("combat_revision", "host-locked"),
        ]),
        "flee": (resolve_cap, "combat.resolve", "resolve-flee", [
            ("candidate_ref", "optional-semantic"),
            ("investigator_id", "host-locked"),
            ("affordance_id", "host-locked"),
            ("combat_revision", "host-locked"),
        ]),
        "end": (end_cap, "combat.end", "end", [
            ("investigator_id", "host-locked"),
            ("outcome", "keeper-semantic"),
            ("combat_revision", "host-locked"),
        ]),
    }
    nodes: list[dict[str, Any]] = [
        node(
            family, subsystem, "subsystem", "Existing CombatSession subsystem",
            all_spans, properties={"subsystem_kind": "combat"},
        ),
    ]
    for cap_id, operation in (
        (context_cap, "combat.context"),
        (resolve_cap, "combat.resolve"),
        (end_cap, "combat.end"),
    ):
        nodes.append(node(
            family, cap_id, "capability", f"Existing typed operation {operation}",
            all_spans, properties={
                "family_id": family,
                "resolver_capability": operation,
                "adapter": "subsystem",
            },
        ))
    relations: list[dict[str, Any]] = []
    slot_nodes: dict[str, dict[str, Any]] = {}
    for slug, (capability, kind, phase, slots) in decisions.items():
        decision_ref = f"decision:coc7:combat:{slug}"
        nodes.append(node(
            family, decision_ref, "decision",
            f"Combat {slug} through the existing typed subsystem operation",
            all_spans, authority="mixed", audience="keeper", visibility="public",
            properties={
                "family_id": family,
                "implementation": {
                    "adapter": "subsystem",
                    "kind": kind,
                    "phase": phase,
                    "payload_constants": {},
                    "payload_slots": [
                        {"name": name, "ownership": ownership}
                        for name, ownership in slots
                    ],
                },
            },
        ))
        relations.append(relation(
            family, f"{slug}-invokes", "invokes", decision_ref, capability,
            all_spans,
        ))
        for name, ownership in slots:
            suffix = name.replace("_", "-")
            slot_id = f"input-slot:coc7:combat:{suffix}"
            if slot_id not in slot_nodes:
                value_type = (
                    "int" if name in {"luck_spend_max", "combat_revision"}
                    else "array" if name.endswith("_refs") or name.endswith("_ids")
                    else "string"
                )
                slot_nodes[slot_id] = node(
                    family, slot_id, "input-slot", suffix.replace("-", " "),
                    all_spans, properties={
                        "family_id": family,
                        "ownership": ownership,
                        "value_type": value_type,
                        "path": "receipt.last_outcome" if ownership == "host-locked" else "intent.method",
                    },
                )
            relations.append(relation(
                family, f"{slug}-{suffix}",
                "locks-input" if ownership == "host-locked" else "requires-input",
                decision_ref, slot_id, all_spans,
            ))
    nodes.extend(slot_nodes.values())
    for cap_id, suffix in (
        (context_cap, "context"), (resolve_cap, "resolve"), (end_cap, "end"),
    ):
        relations.append(relation(
            family, f"{suffix}-implemented-by-session", "implemented-by",
            cap_id, subsystem, all_spans,
        ))
    pending = "pending-choice:coc7:combat:defense"
    nodes.append(node(
        family, pending, "pending-choice", "Player chooses a legal defense",
        sorted(set(groups["melee"] + groups["modifiers"])),
        properties={"family_id": family},
    ))
    relations.extend([
        relation(family, "attack-offers-defense", "offers-choice",
                 "decision:coc7:combat:attack", pending, groups["melee"]),
        relation(family, "maneuver-offers-defense", "offers-choice",
                 "decision:coc7:combat:maneuver", pending, groups["maneuver"]),
        relation(family, "attack-continues-defense", "continues-as",
                 "decision:coc7:combat:attack", "decision:coc7:combat:defend", groups["melee"]),
        relation(family, "defend-continues-attack", "continues-as",
                 "decision:coc7:combat:defend", "decision:coc7:combat:attack", groups["round"]),
        relation(family, "defend-continues-end", "continues-as",
                 "decision:coc7:combat:defend", "decision:coc7:combat:end", groups["round"]),
    ])
    group_decisions = {
        "round": ("context", "attack", "defend", "maneuver", "aim", "reload", "flee", "end"),
        "melee": ("attack", "defend"),
        "damage": ("attack",),
        "no-push": ("attack", "defend", "maneuver"),
        "maneuver": ("maneuver",),
        "surprise": ("attack",),
        "outnumbered": ("attack", "defend"),
        "ranged": ("attack", "flee"),
        "firearms": ("attack", "aim", "reload"),
        "modifiers": ("attack", "defend", "aim", "reload"),
        "automatic": ("attack",),
        "malfunction": ("attack",),
        "weapons": ("attack", "aim", "reload"),
        "special": ("attack",),
    }
    for slug, _name, group in RULES[family]:
        rule_id = f"rule:coc7:combat:{slug}"
        relations.append(relation(
            family, f"{slug}-invokes-resolve", "invokes", rule_id,
            resolve_cap, groups[group],
        ))
        for decision_slug in group_decisions[group]:
            relations.append(relation(
                family, f"{slug}-applies-{decision_slug}", "applies-to",
                rule_id, f"decision:coc7:combat:{decision_slug}", groups[group],
            ))
    return nodes, relations


def _sanity_executable(
    groups: Mapping[str, list[str]], all_spans: list[str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    family = "sanity"
    subsystem = "subsystem:coc7:sanity-session"
    capability_specs = {
        "context": ("sanity.context", "subsystem"),
        "check": ("rules.sanity_check", "subsystem"),
        "execute": ("sanity.execute", "subsystem"),
        "reality-check": ("sanity.session.reality_check", "subsystem"),
        "temporary-recovery": ("time.recover_temporary_insanity", "subsystem"),
        "treatment": ("time.apply_psychoanalysis_treatment", "subsystem"),
        "gain-current": ("sanity.session.gain_san", "subsystem"),
    }
    cap_ref = {
        slug: f"capability:coc7:sanity-{slug}" for slug in capability_specs
    }
    nodes: list[dict[str, Any]] = [
        node(
            family, subsystem, "subsystem", "Existing SanitySession subsystem",
            all_spans, properties={"subsystem_kind": "sanity"},
        ),
    ]
    for slug, (capability, adapter) in capability_specs.items():
        nodes.append(node(
            family, cap_ref[slug], "capability",
            f"Existing subsystem capability {capability}", all_spans,
            properties={
                "family_id": family,
                "resolver_capability": capability,
                "adapter": adapter,
            },
        ))
    decisions = {
        "context": ("context", "sanity.context", "context", [], "keeper-only"),
        "check": ("check", "rules.sanity_check", "settle", [
            ("source", "keeper-semantic"),
            ("loss_success", "optional-semantic"),
            ("loss_failure", "keeper-semantic"),
            ("trigger_ref", "optional-semantic"),
            ("involuntary_kind", "keeper-semantic"),
            ("involuntary_summary", "keeper-semantic"),
            ("investigator_id", "host-locked"),
            ("trigger_id", "host-locked"),
            ("san_before", "host-locked"),
            ("san_max", "host-locked"),
        ], "public"),
        "bout-tick": ("execute", "sanity.execute", "bout-tick", [
            ("investigator_id", "host-locked"),
            ("pending_choice_ref", "host-locked"),
            ("origin_command_id", "host-locked"),
            ("bout_revision", "host-locked"),
        ], "public"),
        "bout-end": ("execute", "sanity.execute", "bout-end", [
            ("investigator_id", "host-locked"),
            ("pending_choice_ref", "host-locked"),
            ("origin_command_id", "host-locked"),
            ("bout_revision", "host-locked"),
        ], "public"),
        "reality-check": ("reality-check", "sanity.session.reality_check", "resolve", [
            ("request_reality_check", "player-source"),
            ("investigator_id", "host-locked"),
            ("active_delusion_ref", "host-locked"),
            ("san_before", "host-locked"),
        ], "public"),
        "recover-temporary": ("temporary-recovery", "time.recover_temporary_insanity", "due-trigger", [
            ("investigator_id", "host-locked"),
            ("recovery_trigger_ref", "host-locked"),
            ("due_elapsed_minutes", "host-locked"),
            ("safe_place", "host-locked"),
        ], "public"),
        "apply-treatment": ("treatment", "time.apply_psychoanalysis_treatment", "due-trigger", [
            ("investigator_id", "host-locked"),
            ("treatment_trigger_ref", "host-locked"),
            ("due_elapsed_minutes", "host-locked"),
            ("safe_place", "host-locked"),
            ("psychoanalysis_skill", "host-locked"),
        ], "public"),
        "gain-current-san": ("gain-current", "sanity.session.gain_san", "resolve", [
            ("gain_source", "keeper-semantic"),
            ("investigator_id", "host-locked"),
            ("san_gain", "host-locked"),
            ("san_before", "host-locked"),
            ("san_max", "host-locked"),
        ], "public"),
        "insane-insight": ("context", "sanity.context", "advise", [
            ("insight", "keeper-semantic"),
            ("investigator_id", "host-locked"),
            ("insanity_state", "host-locked"),
        ], "keeper-only"),
    }
    relations: list[dict[str, Any]] = []
    slot_nodes: dict[str, dict[str, Any]] = {}
    for slug, (capability_slug, kind, phase, slots, visibility) in decisions.items():
        decision_ref = f"decision:coc7:sanity:{slug}"
        nodes.append(node(
            family, decision_ref, "decision",
            f"Sanity {slug} through an existing resolver/subsystem phase",
            all_spans, authority="mixed", audience="keeper", visibility=visibility,
            properties={
                "family_id": family,
                "implementation": {
                    "adapter": "subsystem",
                    "kind": kind,
                    "phase": phase,
                    "payload_constants": {},
                    "payload_slots": [
                        {"name": name, "ownership": ownership}
                        for name, ownership in slots
                    ],
                },
            },
        ))
        relations.append(relation(
            family, f"{slug}-invokes", "invokes", decision_ref,
            cap_ref[capability_slug], all_spans,
        ))
        for name, ownership in slots:
            suffix = name.replace("_", "-")
            slot_id = f"input-slot:coc7:sanity:{suffix}"
            if slot_id not in slot_nodes:
                value_type = (
                    "int" if name in {
                        "san_before", "san_max", "san_gain", "bout_revision",
                        "due_elapsed_minutes", "psychoanalysis_skill",
                    }
                    else "boolean" if name in {"request_reality_check", "safe_place"}
                    else "string"
                )
                slot_nodes[slot_id] = node(
                    family, slot_id, "input-slot", suffix.replace("-", " "),
                    all_spans, properties={
                        "family_id": family,
                        "ownership": ownership,
                        "value_type": value_type,
                        "path": "receipt.last_outcome" if ownership == "host-locked" else "intent.method",
                    },
                )
            relations.append(relation(
                family, f"{slug}-{suffix}",
                "locks-input" if ownership == "host-locked" else "requires-input",
                decision_ref, slot_id, all_spans,
            ))
    nodes.extend(slot_nodes.values())
    for slug in capability_specs:
        relations.append(relation(
            family, f"{slug}-implemented-by-session", "implemented-by",
            cap_ref[slug], subsystem, all_spans,
        ))
    pending = "pending-choice:coc7:sanity:bout-keeper-action"
    nodes.append(node(
        family, pending, "pending-choice", "Keeper advances or ends the active bout",
        sorted(set(groups["bout-real"] + groups["bout-summary"])),
        properties={"family_id": family},
    ))
    relations.extend([
        relation(family, "check-offers-bout-choice", "offers-choice",
                 "decision:coc7:sanity:check", pending, groups["temporary"]),
        relation(family, "check-continues-bout-tick", "continues-as",
                 "decision:coc7:sanity:check", "decision:coc7:sanity:bout-tick", groups["bout-real"]),
        relation(family, "bout-tick-offers-choice", "offers-choice",
                 "decision:coc7:sanity:bout-tick", pending, groups["bout-real"]),
        relation(family, "bout-tick-continues-self", "continues-as",
                 "decision:coc7:sanity:bout-tick", "decision:coc7:sanity:bout-tick", groups["bout-real"]),
        relation(family, "bout-tick-continues-end", "continues-as",
                 "decision:coc7:sanity:bout-tick", "decision:coc7:sanity:bout-end", groups["bout-real"]),
        relation(family, "reality-failure-continues-bout", "continues-as",
                 "decision:coc7:sanity:reality-check", "decision:coc7:sanity:bout-tick", groups["reality"]),
    ])
    rule_capability = {
        "san-roll": "check",
        "failed-roll-involuntary-action": "check",
        "fumble-maximum-loss": "check",
        "max-san": "check",
        "temporary-threshold-and-int": "check",
        "indefinite-daily-fraction": "check",
        "permanent-at-zero": "check",
        "bout-real-time": "execute",
        "bout-summary": "execute",
        "underlying-repeat-bout": "execute",
        "phobia-and-mania": "execute",
        "reality-check": "reality-check",
        "mythos-insanity-gain": "check",
        "temporary-recovery": "temporary-recovery",
        "indefinite-treatment": "treatment",
        "sanity-increase": "gain-current",
        "getting-used-to-awfulness": "check",
        "optional-insane-insight": "context",
        "optional-mythos-hardened": "check",
        "optional-multiple-san-rolls": "check",
    }
    rule_decisions = {
        "san-roll": ("check",),
        "failed-roll-involuntary-action": ("check",),
        "fumble-maximum-loss": ("check",),
        "max-san": ("check", "gain-current-san"),
        "temporary-threshold-and-int": ("check",),
        "indefinite-daily-fraction": ("check",),
        "permanent-at-zero": ("check",),
        "bout-real-time": ("bout-tick", "bout-end"),
        "bout-summary": ("bout-tick", "bout-end"),
        "underlying-repeat-bout": ("check", "bout-tick"),
        "phobia-and-mania": ("bout-tick", "bout-end"),
        "reality-check": ("reality-check",),
        "mythos-insanity-gain": ("check",),
        "temporary-recovery": ("recover-temporary",),
        "indefinite-treatment": ("apply-treatment",),
        "sanity-increase": ("gain-current-san",),
        "getting-used-to-awfulness": ("check",),
        "optional-insane-insight": ("insane-insight",),
        "optional-mythos-hardened": ("check",),
        "optional-multiple-san-rolls": ("check",),
    }
    rule_groups = {slug: group for slug, _name, group in RULES[family]}
    for slug, capability_slug in rule_capability.items():
        rule_id = f"rule:coc7:sanity:{slug}"
        group = rule_groups[slug]
        relations.append(relation(
            family, f"{slug}-invokes-capability", "invokes", rule_id,
            cap_ref[capability_slug], groups[group],
        ))
        for decision_slug in rule_decisions[slug]:
            relations.append(relation(
                family, f"{slug}-applies-{decision_slug}", "applies-to",
                rule_id, f"decision:coc7:sanity:{decision_slug}", groups[group],
            ))
    relations.extend([
        relation(family, "bout-reads-phobias", "reads-table", cap_ref["execute"],
                 "data-table:coc7:phobias", groups["phobia-mania"]),
        relation(family, "bout-reads-manias", "reads-table", cap_ref["execute"],
                 "data-table:coc7:manias", groups["phobia-mania"]),
    ])
    return nodes, relations


def build_candidate(packet: Mapping[str, Any], family: str) -> dict[str, Any]:
    groups = {
        key: spans_for(packet, phrases)
        for key, phrases in PHRASES[family].items()
    }
    all_spans = sorted({span for rows in groups.values() for span in rows})
    family_id = f"rule-family:coc7:{family}"
    nodes = [node(
        family,
        family_id,
        "rule-family",
        f"Complete source-reviewed {family} family",
        all_spans,
        audience="keeper",
        properties={
            "family_id": family,
            "runtime_ownership": "legacy",
            "legacy_surface": "visible",
        },
    )]
    relations = []
    for slug, name, group in RULES[family]:
        rule_id = f"rule:coc7:{family}:{slug}"
        nodes.append(node(family, rule_id, "rule", name, groups[group]))
        relations.append(relation(
            family,
            f"{slug}-part-of",
            "part-of",
            rule_id,
            family_id,
            groups[group],
        ))

    if family == "psychology":
        executable_nodes, executable_relations = _psychology_executable(
            groups, all_spans,
        )
        nodes.extend(executable_nodes)
        relations.extend(executable_relations)
        capability_id = "capability:coc7:psychology-check-contract"
    elif family == "combat":
        executable_nodes, executable_relations = _combat_executable(
            groups, all_spans,
        )
        nodes.extend(executable_nodes)
        relations.extend(executable_relations)
        capability_id = "capability:coc7:combat-resolve"
    elif family == "sanity":
        executable_nodes, executable_relations = _sanity_executable(
            groups, all_spans,
        )
        nodes.extend(executable_nodes)
        relations.extend(executable_relations)
        capability_id = "capability:coc7:sanity-check"
    else:
        subsystem_id = f"subsystem:coc7:{family}"
        capability_id = f"capability:coc7:{family}-runtime"
        decision_id = f"decision:coc7:{family}:resolve"
        nodes.extend([
            node(
                family, subsystem_id, "subsystem",
                f"Canonical {family} subsystem", all_spans,
                properties={"subsystem_kind": family},
            ),
            node(
                family, capability_id, "capability",
                f"Legacy {family} runtime capability", all_spans,
                properties={
                    "family_id": family,
                    "resolver_capability": f"{family}_runtime",
                    "adapter": "subsystem",
                },
            ),
            node(
                family, decision_id, "decision",
                f"Resolve one source-governed {family} action", all_spans,
                authority="mixed", audience="keeper", visibility="public",
            ),
        ])
        relations.extend([
            relation(family, "decision-invokes-runtime", "invokes", decision_id, capability_id, all_spans),
            relation(family, "runtime-implemented-by-subsystem", "implemented-by", capability_id, subsystem_id, all_spans),
        ])
        for slug, _name, group in RULES[family]:
            relations.append(relation(
                family, f"{slug}-applies-to-resolve", "applies-to",
                f"rule:coc7:{family}:{slug}", decision_id, groups[group],
            ))

    table_specs = {
        "psychology": (),
        "combat": (("combat", "combat.json"), ("weapons", "weapons.json")),
        "sanity": (("sanity", "sanity.json"), ("phobias", "phobias.json"), ("manias", "manias.json")),
    }[family]
    for slug, filename in table_specs:
        table_id = f"data-table:coc7:{slug}"
        nodes.append(node(
            family,
            table_id,
            "data-table",
            filename,
            all_spans,
            properties={"table_name": filename},
        ))
        relations.append(relation(
            family,
            f"runtime-reads-{slug}",
            "reads-table",
            capability_id,
            table_id,
            all_spans,
        ))

    candidate = {
        "contract_id": rg.CANDIDATE_CONTRACT_ID,
        "schema_version": 1,
        "ruleset_id": "coc7",
        "family_id": family,
        "section_id": FAMILY_CONFIG[family]["section_id"],
        "source_language": "en",
        "coverage": {family: "accepted"},
        "nodes": sorted(nodes, key=lambda row: str(row["node_id"])),
        "relations": sorted(relations, key=lambda row: str(row["relation_id"])),
    }
    findings = rg._validate_candidate(candidate, dict(packet))
    if findings:
        raise ValueError(findings)
    return candidate


def runtime_blockers(family: str) -> list[dict[str, Any]]:
    del family
    return []


def build_family(bundle_root: Path, family: str) -> dict[str, Any]:
    packet, normalized = prepare(bundle_root, family)
    candidate = build_candidate(packet, family)
    rg.clear_accepted_session()
    with tempfile.TemporaryDirectory(prefix=f"coc7-{family}-accepted-") as raw:
        evidence_root = Path(raw)
        accepted = rg.accept(packet, candidate, evidence_root=evidence_root)
        if not accepted.get("ok"):
            raise ValueError(accepted.get("findings"))
        shard = accepted["shard"]
        evidence_path = rg.accepted_evidence_path(shard["shard_id"], evidence_root)
        if evidence_path is None:
            raise ValueError("accepted shard evidence path unavailable")
        envelope = read_json(evidence_path)
    config = FAMILY_CONFIG[family]
    ledger = [
        {
            "rule_id": f"rule:coc7:{family}:{slug}",
            "status": "accepted",
            "source_group": group,
        }
        for slug, _name, group in RULES[family]
    ]
    review = {
        "contract_id": "coc.rule-family-source-review.v1",
        "schema_version": 1,
        "ruleset_id": "coc7",
        "family_id": family,
        "reviewer_identity": config["reviewer_identity"],
        "review_status": "accepted",
        "source": {
            "source_id": SOURCE_ID,
            "file_sha256": FILE_SHA256,
            "bundle_sha256": normalized["bundle_sha256"],
            "pdf_indices": config["pages"],
        },
        "accepted_shard_id": shard["shard_id"],
        "accepted_shard_digest": shard["receipt"]["shard_sha256"],
        "coverage": "accepted",
        "unresolved_applicable_rules": [],
        "applicability_ledger": ledger,
        "runtime_integration_blockers": runtime_blockers(family),
    }
    if family in {"psychology", "combat", "sanity"}:
        review["executable_decisions"] = sorted(
            node["node_id"] for node in candidate["nodes"]
            if node["node_kind"] == "decision"
        )
        review["unresolved_executable_rules"] = []
    return {"candidate": candidate, "envelope": envelope, "review": review}


def build_all(bundle_root: Path) -> dict[str, dict[str, Any]]:
    return {
        family: build_family(bundle_root, family)
        for family in ("psychology", "combat", "sanity")
    }


def write_all(built: Mapping[str, Mapping[str, Any]], output: Path = OUTPUT) -> None:
    for family, payload in built.items():
        target = output / family
        target.mkdir(parents=True, exist_ok=True)
        (target / "candidate.json").write_bytes(canonical_bytes(payload["candidate"]))
        (target / "accepted-shard.json").write_bytes(canonical_bytes(payload["envelope"]))
        (target / "source-review.json").write_bytes(canonical_bytes(payload["review"]))


def main() -> None:
    raw_root = os.environ.get(BUNDLE_ROOT_ENV)
    if not raw_root:
        raise SystemExit(f"{BUNDLE_ROOT_ENV} is required")
    built = build_all(Path(raw_root).expanduser().resolve())
    write_all(built)
    print(json.dumps({
        family: {
            "rules": len(payload["review"]["applicability_ledger"]),
            "shard_id": payload["review"]["accepted_shard_id"],
            "shard_digest": payload["review"]["accepted_shard_digest"],
            "runtime_blockers": len(payload["review"]["runtime_integration_blockers"]),
        }
        for family, payload in built.items()
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
