#!/usr/bin/env python3
"""Independently source-review and accept core/check/social RuleGraph families.

This is deliberately separate from ``_gen_rulegraph_source_stage1.py``: the
producer remains revision-required and cannot accept its own candidates.  This
reviewer consumes the exact 40th Anniversary PDF bundle, narrows each family
to source-supported claims, calls the canonical ``accept``/``build`` path, and
writes family-scoped evidence.  It never edits production RuleGraph artifacts
or runtime ownership.
"""
from __future__ import annotations

import copy
import importlib.util
import json
import os
import tempfile
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
SOURCE_TREE = (
    ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7"
    / "rule-graph-candidates" / "source-stage1"
)
BUNDLE_ROOT_ENV = "COC_RULE_GRAPH_SOURCE_BUNDLE_ROOT"
BUNDLE_NAME = "core-social-psychology-v2"
SOURCE_ID = "pdf:coc7-keeper-rulebook-40th"
PDF_SHA256 = "a860499cf34b40cac385f51b6e667ab37ec0796c7329494def08c8b161fd71eb"
REVIEWER_ROOT = "codex-rule-families-core-social-source-review-20260831"
EXECUTABLE_REVIEWERS = {
    "core-check": "codex-execgraph-core-push-social-review-20260831:core-check-v2",
    "push-luck": "codex-execgraph-gap-review-20260831:push-luck-v3",
    "social": "codex-execgraph-gap-review-20260831:social-v3",
}


def _reviewer_identity(family: str) -> str:
    return EXECUTABLE_REVIEWERS.get(family, f"{REVIEWER_ROOT}:{family}")


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


rg = _load_module("source_family_accept_rule_graph", SCRIPTS / "coc_rule_graph.py")
source_gen = _load_module(
    "source_family_accept_producer",
    ROOT / "tests" / "fixtures" / "_gen_rulegraph_source_stage1.py",
)


def _read(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"


def _node(
    node_id: str,
    node_kind: str,
    name: str,
    *,
    authority: str = "deterministic",
    audience: str = "keeper",
    visibility: str = "public",
    hard_gate: bool = False,
    properties: dict[str, Any] | None = None,
    evidence: Iterable[str],
) -> dict[str, Any]:
    return {
        "node_id": node_id,
        "node_kind": node_kind,
        "name": name,
        "authority": authority,
        "audience": audience,
        "visibility": visibility,
        "hard_gate": hard_gate,
        "properties": copy.deepcopy(properties or {}),
        "evidence_span_ids": sorted(set(evidence)),
    }


def _relation(
    relation_id: str,
    relation_kind: str,
    source: str,
    target: str,
    evidence: Iterable[str],
) -> dict[str, Any]:
    return {
        "relation_id": relation_id,
        "relation_kind": relation_kind,
        "from_node_id": source,
        "to_node_id": target,
        "evidence_span_ids": sorted(set(evidence)),
    }


def _packet(bundle_root: Path, family: str, pages: list[int]) -> dict[str, Any]:
    section = f"section-{family}-source-accepted"
    result = rg.prepare({
        "ruleset_id": "coc7",
        "ruleset_version": "1.0.0",
        "source_language": "en",
        "family_id": family,
        "section_id": section,
        "bundle_dirs": [str(bundle_root / BUNDLE_NAME)],
        "page_keys": [(SOURCE_ID, page) for page in pages],
        "known_nodes": [],
        "output_budget": {"max_nodes": 160, "max_relations": 240},
        "families": [family],
    })
    if not result.get("ok"):
        raise RuntimeError(result.get("findings"))
    return result["shard"]


def _matching_spans(packet: dict[str, Any], phrases: Iterable[str]) -> list[str]:
    folded = [phrase.casefold() for phrase in phrases]
    found = [
        str(row["span_id"])
        for row in packet["evidence_view"]["spans"]
        if any(phrase in str(row.get("text") or "").casefold() for phrase in folded)
    ]
    if not found:
        raise RuntimeError(f"no source spans for {list(phrases)!r}")
    return sorted(set(found))


def _base_candidate(name: str) -> dict[str, Any]:
    return _read(SOURCE_TREE / "candidates" / name)


def _family_filter(
    base: dict[str, Any],
    family: str,
    shared_node_ids: set[str],
    *,
    excluded_node_ids: set[str] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    excluded = excluded_node_ids or set()
    nodes = []
    for row in base["nodes"]:
        node_family = (row.get("properties") or {}).get("family_id")
        if row["node_id"] in excluded:
            continue
        if node_family == family or row["node_id"] in shared_node_ids:
            nodes.append(copy.deepcopy(row))
    ids = {row["node_id"] for row in nodes}
    relations = [
        copy.deepcopy(row)
        for row in base["relations"]
        if row["from_node_id"] in ids and row["to_node_id"] in ids
    ]
    return nodes, relations


def push_luck_candidate(packet: dict[str, Any]) -> dict[str, Any]:
    base = _base_candidate("section-checks-push-luck-source.candidate.json")
    shared = {
        "capability:coc7:check",
        "resource:coc7:push-luck:luck",
        "data-table:coc7:percentile-check",
        "data-table:coc7:pushed-roll",
        "data-table:coc7:luck",
        "data-table:coc7:success-levels",
        "data-table:coc7:difficulty-levels",
        "data-table:coc7:roll-modifiers",
    }
    nodes, relations = _family_filter(
        base,
        "push-luck",
        shared,
        excluded_node_ids={
            "exception:coc7:push-luck:fumble-push-uncompiled",
            "visibility-policy:coc7:core-check:public-roll",
        },
    )
    evidence = _matching_spans(packet, (
        "Pushing a skill roll provides",
        "Only skill and characteristic rolls can be pushed",
        "Pushed Roll: Success",
        "Pushed Roll: Failure",
        "Fumbles should take effect immediately",
        "Luck rolls may be called",
        "Group Luck roll",
        "Spending Luck",
        "Luck points may not be spent",
        "Recovering Luck points",
    ))
    for row in nodes:
        row["evidence_span_ids"] = list(evidence)
        if row["node_id"] in {
            "condition:coc7:push-luck:original-failed",
            "condition:coc7:push-luck:not-already-pushed",
        }:
            row["hard_gate"] = True
        if row["node_id"] in {
            "decision:coc7:push-luck:pushed-roll",
            "decision:coc7:push-luck:luck-spend",
        }:
            slots = row["properties"]["implementation"]["payload_slots"]
            slots.extend([
                {"name": "canonical_roll_receipt", "ownership": "host-locked"},
                {"name": "continuation_grant", "ownership": "host-locked"},
            ])

    additions = [
        _node(
            "rule:coc7:push-luck:eligible-scope",
            "rule",
            "Only a failed skill or characteristic roll may be pushed; Luck, Sanity, combat, damage, and Sanity-loss amount rolls may not be pushed",
            properties={"family_id": "push-luck"},
            evidence=evidence,
        ),
        _node(
            "rule:coc7:push-luck:goal-time-difficulty",
            "rule",
            "A push changes the method and consumes time; the goal must remain achievable, and the skill and difficulty normally remain unchanged unless the situation changes",
            authority="mixed",
            properties={"family_id": "push-luck"},
            evidence=evidence,
        ),
        _node(
            "exception:coc7:push-luck:fumble-final",
            "exception",
            "A fumble takes effect immediately and cannot be negated by pushing",
            properties={"family_id": "push-luck"},
            evidence=evidence,
        ),
        _node(
            "rule:coc7:push-luck:luck-spend-limits",
            "rule",
            "Luck spend is limited to the investigator's own skill or characteristic roll and current Luck; it cannot alter Luck, damage, SAN, SAN-loss, or pushed rolls, nor remove criticals, fumbles, firearm malfunctions, or earn an improvement check",
            properties={"family_id": "push-luck"},
            evidence=evidence,
        ),
        _node(
            "rule:coc7:push-luck:luck-recovery",
            "rule",
            "After a session, roll D100: above current Luck gains 1D10 Luck, otherwise none; Luck caps at 99 and never resets to its starting value",
            properties={"family_id": "push-luck"},
            evidence=evidence,
        ),
        _node(
            "rule:coc7:push-luck:canonical-continuation-hydration",
            "rule",
            "Push and Luck decisions hydrate the original canonical persisted roll receipt and a machine-issued continuation grant; caller-supplied or ephemeral receipt identity cannot authorize execution",
            properties={"family_id": "push-luck"},
            evidence=evidence,
        ),
        _node(
            "condition:coc7:push-luck:receipt-luck-adjustable",
            "condition",
            "The canonical source receipt has an adjustable non-critical, non-fumble skill or characteristic outcome",
            audience="host-internal",
            visibility="keeper-only",
            hard_gate=True,
            properties={
                "family_id": "push-luck",
                "expression": {
                    "op": "any",
                    "of": [
                        {"op": "eq", "path": "receipt.last_outcome", "value": value}
                        for value in ("failure", "regular", "hard", "extreme")
                    ],
                },
            },
            evidence=evidence,
        ),
        _node(
            "subsystem:coc7:canonical-roll-ledger",
            "subsystem",
            "Canonical persisted roll receipt and continuation-grant ledger",
            audience="host-internal",
            visibility="keeper-only",
            properties={"subsystem_kind": "canonical-roll-receipt-ledger"},
            evidence=evidence,
        ),
        _node(
            "input-slot:coc7:push-luck:canonical-roll-receipt",
            "input-slot",
            "Canonical persisted source roll receipt hydrated by the host",
            audience="host-internal",
            visibility="keeper-only",
            properties={
                "family_id": "push-luck",
                "ownership": "host-locked",
                "value_type": "object",
                "path": "canonical_roll_receipt",
            },
            evidence=evidence,
        ),
        _node(
            "input-slot:coc7:push-luck:continuation-grant",
            "input-slot",
            "Machine-issued persistent continuation grant bound to the source receipt and actor",
            audience="host-internal",
            visibility="keeper-only",
            properties={
                "family_id": "push-luck",
                "ownership": "host-locked",
                "value_type": "object",
                "path": "continuation_grant",
            },
            evidence=evidence,
        ),
        _node(
            "visibility-policy:coc7:push-luck:public-roll",
            "visibility-policy",
            "Push and Luck continuations preserve the visibility of their authoritative roll evidence",
            audience="host-internal",
            visibility="keeper-only",
            properties={"policy": "preserve-authoritative-roll-visibility"},
            evidence=evidence,
        ),
    ]
    nodes.extend(additions)
    family_id = "rule-family:coc7:push-luck"
    relations.extend([
        _relation("relation:coc7:push-luck:eligible-scope-part-of", "part-of", "rule:coc7:push-luck:eligible-scope", family_id, evidence),
        _relation("relation:coc7:push-luck:goal-time-part-of", "part-of", "rule:coc7:push-luck:goal-time-difficulty", family_id, evidence),
        _relation("relation:coc7:push-luck:luck-limits-part-of", "part-of", "rule:coc7:push-luck:luck-spend-limits", family_id, evidence),
        _relation("relation:coc7:push-luck:luck-recovery-part-of", "part-of", "rule:coc7:push-luck:luck-recovery", family_id, evidence),
        _relation("relation:coc7:push-luck:hydration-part-of", "part-of", "rule:coc7:push-luck:canonical-continuation-hydration", family_id, evidence),
        _relation("relation:coc7:push-luck:hydration-invokes-push", "invokes", "rule:coc7:push-luck:canonical-continuation-hydration", "capability:coc7:push-policy", evidence),
        _relation("relation:coc7:push-luck:luck-roll-rule-invokes", "invokes", "rule:coc7:push-luck:luck-roll", "capability:coc7:check", evidence),
        _relation("relation:coc7:push-luck:luck-roll-invokes", "invokes", "decision:coc7:push-luck:luck-roll", "capability:coc7:check", evidence),
        _relation("relation:coc7:push-luck:fumble-forbids-push", "forbids", "exception:coc7:push-luck:fumble-final", "decision:coc7:push-luck:pushed-roll", evidence),
        _relation("relation:coc7:push-luck:scope-applies-push", "applies-to", "rule:coc7:push-luck:eligible-scope", "decision:coc7:push-luck:pushed-roll", evidence),
        _relation("relation:coc7:push-luck:goal-time-applies-push", "applies-to", "rule:coc7:push-luck:goal-time-difficulty", "decision:coc7:push-luck:pushed-roll", evidence),
        _relation("relation:coc7:push-luck:limits-apply-spend", "applies-to", "rule:coc7:push-luck:luck-spend-limits", "decision:coc7:push-luck:luck-spend", evidence),
        _relation("relation:coc7:push-luck:push-invokes-policy", "invokes", "decision:coc7:push-luck:pushed-roll", "capability:coc7:push-policy", evidence),
        _relation("relation:coc7:push-luck:spend-invokes", "invokes", "decision:coc7:push-luck:luck-spend", "capability:coc7:luck-spend", evidence),
        _relation("relation:coc7:push-luck:original-failed-available", "available-when", "decision:coc7:push-luck:pushed-roll", "condition:coc7:push-luck:original-failed", evidence),
        _relation("relation:coc7:push-luck:not-pushed-available", "available-when", "decision:coc7:push-luck:pushed-roll", "condition:coc7:push-luck:not-already-pushed", evidence),
        _relation("relation:coc7:push-luck:spend-receipt-available", "available-when", "decision:coc7:push-luck:luck-spend", "condition:coc7:push-luck:receipt-luck-adjustable", evidence),
        _relation("relation:coc7:push-luck:spend-not-pushed-available", "available-when", "decision:coc7:push-luck:luck-spend", "condition:coc7:push-luck:not-already-pushed", evidence),
        _relation("relation:coc7:push-luck:push-locks-receipt", "locks-input", "decision:coc7:push-luck:pushed-roll", "input-slot:coc7:push-luck:canonical-roll-receipt", evidence),
        _relation("relation:coc7:push-luck:push-locks-grant", "locks-input", "decision:coc7:push-luck:pushed-roll", "input-slot:coc7:push-luck:continuation-grant", evidence),
        _relation("relation:coc7:push-luck:spend-locks-receipt", "locks-input", "decision:coc7:push-luck:luck-spend", "input-slot:coc7:push-luck:canonical-roll-receipt", evidence),
        _relation("relation:coc7:push-luck:spend-locks-grant", "locks-input", "decision:coc7:push-luck:luck-spend", "input-slot:coc7:push-luck:continuation-grant", evidence),
        _relation("relation:coc7:push-luck:grant-requires-ledger", "requires-fact", "input-slot:coc7:push-luck:continuation-grant", "subsystem:coc7:canonical-roll-ledger", evidence),
    ])
    candidate = {
        "contract_id": rg.CANDIDATE_CONTRACT_ID,
        "schema_version": 1,
        "ruleset_id": "coc7",
        "family_id": "push-luck",
        "section_id": packet["section_id"],
        "source_language": "en",
        "coverage": {"push-luck": "accepted"},
        "nodes": sorted(nodes, key=lambda row: row["node_id"]),
        "relations": sorted(relations, key=lambda row: row["relation_id"]),
    }
    findings = rg._validate_candidate(candidate, packet)
    if findings:
        raise RuntimeError(findings)
    return candidate


def core_check_candidate(packet: dict[str, Any]) -> dict[str, Any]:
    base = _base_candidate("section-checks-push-luck-source.candidate.json")
    shared = {
        "capability:coc7:check",
        "data-table:coc7:percentile-check",
        "data-table:coc7:success-levels",
        "data-table:coc7:difficulty-levels",
        "data-table:coc7:roll-modifiers",
        "visibility-policy:coc7:core-check:public-roll",
    }
    nodes, relations = _family_filter(base, "core-check", shared)
    evidence = _matching_spans(packet, (
        "When to Roll Dice",
        "Skill Roll: Determining the Difficulty Level",
        "Rolling the Dice: Success or Failure",
        "More Than One Player Rolling Dice for a Skill Roll?",
        "Physical Human Limits",
        "Fumbles and Criticals",
        "Opposed Skill Rolls",
        "A skill roll can yield one of six results",
        "Comparing Results",
        "Bonus Dice and Penalty Dice",
        "Combined Skill Rolls",
    ))
    for row in nodes:
        row["evidence_span_ids"] = list(evidence)
    additions = [
        _node(
            "capability:coc7:opposed",
            "capability",
            "opposed",
            audience="host-internal",
            visibility="keeper-only",
            properties={
                "family_id": "core-check",
                "resolver_capability": "opposed",
                "adapter": "resolver",
            },
            evidence=evidence,
        ),
        _node(
            "data-table:coc7:combat",
            "data-table",
            "combat.json",
            audience="host-internal",
            visibility="keeper-only",
            properties={"table_name": "combat.json"},
            evidence=evidence,
        ),
        _node(
            "rule:coc7:core-check:goal-and-necessity",
            "rule",
            "Roll only for an uncertain consequential outcome; the player's intention defines one clear goal and the Keeper selects the fitting skill or characteristic",
            authority="mixed",
            properties={"family_id": "core-check"},
            evidence=evidence,
        ),
        _node(
            "rule:coc7:core-check:opposed",
            "rule",
            "Non-combat opposed rolls use one roll per side, compare success levels, break a tied successful level by higher skill or characteristic, and cannot be pushed",
            properties={"family_id": "core-check"},
            evidence=evidence,
        ),
        _node(
            "rule:coc7:core-check:combined",
            "rule",
            "A combined skill roll uses one investigator's single D100 result against every named skill; the Keeper declares whether any or all named skills must succeed",
            authority="mixed",
            properties={"family_id": "core-check"},
            evidence=evidence,
        ),
        _node(
            "rule:coc7:core-check:multiple-investigators",
            "rule",
            "Multiple investigators use separate rolls or a situation-specific cooperation procedure; a repeated attempt at the same goal generally becomes a pushed roll",
            authority="mixed",
            properties={"family_id": "core-check"},
            evidence=evidence,
        ),
        _node(
            "rule:coc7:core-check:physical-human-limits",
            "rule",
            "An Extreme check cannot overcome opposition more than 100 plus the investigator's skill or characteristic; multiple investigators may reduce the opposing characteristic through the stated sequential procedure",
            properties={"family_id": "core-check"},
            evidence=evidence,
        ),
        _node(
            "rule:coc7:core-check:canonical-target-binding",
            "rule",
            "Semantic skill, characteristic, and opponent references select the check; numeric targets are host-locked from the canonical investigator sheet or authored opponent state before resolver execution",
            properties={"family_id": "core-check"},
            evidence=evidence,
        ),
        _node(
            "condition:coc7:core-check:actor-bound",
            "condition",
            "The canonical acting investigator is bound before target hydration",
            audience="host-internal",
            visibility="keeper-only",
            hard_gate=True,
            properties={
                "family_id": "core-check",
                "expression": {"op": "exists", "path": "actor.id"},
            },
            evidence=evidence,
        ),
        _node(
            "decision:coc7:core-check:opposed-check",
            "decision",
            "Settle one non-combat opposed check with one roll for each side",
            authority="mixed",
            properties={
                "family_id": "core-check",
                "implementation": {
                    "adapter": "resolver",
                    "kind": "opposed",
                    "phase": "resolve",
                    "payload_constants": {},
                    "payload_slots": [
                        {"name": "actor_check_ref", "ownership": "keeper-semantic"},
                        {"name": "opponent_check_ref", "ownership": "keeper-semantic"},
                        {"name": "investigator_target", "ownership": "host-locked"},
                        {"name": "opponent_value", "ownership": "host-locked"},
                    ],
                },
            },
            evidence=evidence,
        ),
        _node(
            "decision:coc7:core-check:combined-check",
            "decision",
            "Settle one investigator's one D100 roll against multiple skills using the Keeper-declared any/all mode",
            authority="mixed",
            properties={
                "family_id": "core-check",
                "implementation": {
                    "adapter": "resolver",
                    "kind": "check",
                    "phase": "resolve",
                    "payload_constants": {},
                    "payload_slots": [
                        {"name": "combined_target_refs", "ownership": "keeper-semantic"},
                        {"name": "combined_targets", "ownership": "host-locked"},
                        {"name": "combined_mode", "ownership": "keeper-semantic"},
                        {"name": "difficulty", "ownership": "keeper-semantic"},
                        {"name": "goal", "ownership": "keeper-semantic"},
                        {"name": "stakes", "ownership": "keeper-semantic"},
                        {"name": "investigator_id", "ownership": "host-locked"},
                    ],
                },
            },
            evidence=evidence,
        ),
        _node(
            "input-slot:coc7:core-check:combined-target-refs",
            "input-slot",
            "Semantic skill or characteristic references selected for the combined check",
            visibility="keeper-only",
            properties={
                "family_id": "core-check",
                "ownership": "keeper-semantic",
                "value_type": "array",
                "path": "combined_target_refs",
            },
            evidence=evidence,
        ),
        _node(
            "input-slot:coc7:core-check:combined-targets",
            "input-slot",
            "Authoritative named skill targets for the one investigator",
            audience="host-internal",
            visibility="keeper-only",
            properties={
                "family_id": "core-check",
                "ownership": "host-locked",
                "value_type": "object",
                "path": "combined_targets",
            },
            evidence=evidence,
        ),
        _node(
            "input-slot:coc7:core-check:combined-mode",
            "input-slot",
            "Keeper-declared any or all comparison mode",
            visibility="keeper-only",
            properties={
                "family_id": "core-check",
                "ownership": "keeper-semantic",
                "value_type": "enum",
                "path": "combined_mode",
            },
            evidence=evidence,
        ),
        _node(
            "input-slot:coc7:core-check:actor-check-ref",
            "input-slot",
            "Semantic acting skill or characteristic reference",
            visibility="keeper-only",
            properties={
                "family_id": "core-check",
                "ownership": "keeper-semantic",
                "value_type": "scalar",
                "path": "actor_check_ref",
            },
            evidence=evidence,
        ),
        _node(
            "input-slot:coc7:core-check:opponent-check-ref",
            "input-slot",
            "Semantic authored opponent skill or characteristic reference",
            visibility="keeper-only",
            properties={
                "family_id": "core-check",
                "ownership": "keeper-semantic",
                "value_type": "scalar",
                "path": "opponent_check_ref",
            },
            evidence=evidence,
        ),
        _node(
            "input-slot:coc7:core-check:investigator-target",
            "input-slot",
            "Canonical numeric value hydrated for the acting check reference",
            audience="host-internal",
            visibility="keeper-only",
            properties={
                "family_id": "core-check",
                "ownership": "host-locked",
                "value_type": "scalar",
                "path": "investigator_target",
            },
            evidence=evidence,
        ),
        _node(
            "input-slot:coc7:core-check:opponent-value",
            "input-slot",
            "Authoritative opposing skill or characteristic value",
            audience="host-internal",
            visibility="keeper-only",
            properties={
                "family_id": "core-check",
                "ownership": "host-locked",
                "value_type": "scalar",
                "path": "opponent_value",
            },
            evidence=evidence,
        ),
    ]
    nodes.extend(additions)
    family_id = "rule-family:coc7:core-check"
    relations.extend([
        _relation("relation:coc7:core-check:goal-part-of", "part-of", "rule:coc7:core-check:goal-and-necessity", family_id, evidence),
        _relation("relation:coc7:core-check:opposed-part-of", "part-of", "rule:coc7:core-check:opposed", family_id, evidence),
        _relation("relation:coc7:core-check:combined-part-of", "part-of", "rule:coc7:core-check:combined", family_id, evidence),
        _relation("relation:coc7:core-check:multiple-part-of", "part-of", "rule:coc7:core-check:multiple-investigators", family_id, evidence),
        _relation("relation:coc7:core-check:human-limits-part-of", "part-of", "rule:coc7:core-check:physical-human-limits", family_id, evidence),
        _relation("relation:coc7:core-check:binding-part-of", "part-of", "rule:coc7:core-check:canonical-target-binding", family_id, evidence),
        _relation("relation:coc7:core-check:binding-invokes-check", "invokes", "rule:coc7:core-check:canonical-target-binding", "capability:coc7:check", evidence),
        _relation("relation:coc7:core-check:opposed-rule-invokes", "invokes", "rule:coc7:core-check:opposed", "capability:coc7:opposed", evidence),
        _relation("relation:coc7:core-check:combined-rule-invokes", "invokes", "rule:coc7:core-check:combined", "capability:coc7:check", evidence),
        _relation("relation:coc7:core-check:ordinary-invokes", "invokes", "decision:coc7:core-check:ordinary-check", "capability:coc7:check", evidence),
        _relation("relation:coc7:core-check:opposed-invokes", "invokes", "decision:coc7:core-check:opposed-check", "capability:coc7:opposed", evidence),
        _relation("relation:coc7:core-check:combined-invokes", "invokes", "decision:coc7:core-check:combined-check", "capability:coc7:check", evidence),
        _relation("relation:coc7:core-check:combined-requires-target-refs", "requires-input", "decision:coc7:core-check:combined-check", "input-slot:coc7:core-check:combined-target-refs", evidence),
        _relation("relation:coc7:core-check:combined-locks-targets", "locks-input", "decision:coc7:core-check:combined-check", "input-slot:coc7:core-check:combined-targets", evidence),
        _relation("relation:coc7:core-check:combined-requires-mode", "requires-input", "decision:coc7:core-check:combined-check", "input-slot:coc7:core-check:combined-mode", evidence),
        _relation("relation:coc7:core-check:opposed-requires-actor-ref", "requires-input", "decision:coc7:core-check:opposed-check", "input-slot:coc7:core-check:actor-check-ref", evidence),
        _relation("relation:coc7:core-check:opposed-requires-opponent-ref", "requires-input", "decision:coc7:core-check:opposed-check", "input-slot:coc7:core-check:opponent-check-ref", evidence),
        _relation("relation:coc7:core-check:opposed-locks-actor-target", "locks-input", "decision:coc7:core-check:opposed-check", "input-slot:coc7:core-check:investigator-target", evidence),
        _relation("relation:coc7:core-check:opposed-locks-opponent-value", "locks-input", "decision:coc7:core-check:opposed-check", "input-slot:coc7:core-check:opponent-value", evidence),
        _relation("relation:coc7:core-check:ordinary-actor-bound", "available-when", "decision:coc7:core-check:ordinary-check", "condition:coc7:core-check:actor-bound", evidence),
        _relation("relation:coc7:core-check:combined-actor-bound", "available-when", "decision:coc7:core-check:combined-check", "condition:coc7:core-check:actor-bound", evidence),
        _relation("relation:coc7:core-check:opposed-actor-bound", "available-when", "decision:coc7:core-check:opposed-check", "condition:coc7:core-check:actor-bound", evidence),
        _relation("relation:coc7:core-check:combined-reads-combat", "reads-table", "decision:coc7:core-check:combined-check", "data-table:coc7:combat", evidence),
        _relation("relation:coc7:core-check:opposed-reads-combat", "reads-table", "decision:coc7:core-check:opposed-check", "data-table:coc7:combat", evidence),
    ])
    candidate = {
        "contract_id": rg.CANDIDATE_CONTRACT_ID,
        "schema_version": 1,
        "ruleset_id": "coc7",
        "family_id": "core-check",
        "section_id": packet["section_id"],
        "source_language": "en",
        "coverage": {"core-check": "accepted"},
        "nodes": sorted(nodes, key=lambda row: row["node_id"]),
        "relations": sorted(relations, key=lambda row: row["relation_id"]),
    }
    findings = rg._validate_candidate(candidate, packet)
    if findings:
        raise RuntimeError(findings)
    return candidate


def social_candidate(packet: dict[str, Any]) -> dict[str, Any]:
    base = _base_candidate("section-interpersonal-skills-source.candidate.json")
    nodes, relations = _family_filter(
        base,
        "social",
        set(),
        excluded_node_ids={
            "exception:coc7:social:pc-coercion-penalty-uncompiled",
            "exception:coc7:social:higher-of-composition-uncompiled",
            "rule:coc7:psychology:opposes-social",
        },
    )
    evidence = _matching_spans(packet, (
        "Charm (15%)",
        "Interpersonal Skills: Disambiguation",
        "When Used on Player Characters",
        "Fast Talk (05%)",
        "Intimidate (15%)",
        "Persuade (10%)",
        "Psychology can be used to oppose all forms of social interaction rolls",
        "Charm, Fast Talk, Intimidate, and Persuade Skills: Difficulty Levels",
        "Verbal Conflicts",
    ))
    for row in nodes:
        row["evidence_span_ids"] = list(evidence)
        if row["node_id"] == "rule:coc7:social:opposing-difficulty":
            row["name"] = (
                "Base difficulty uses the higher of the matching interpersonal "
                "skill or Psychology: below 50 Regular, 50-89 Hard, 90+ Extreme"
            )
        if row["node_id"] == "decision:coc7:social:adjudicate-difficulty":
            row["name"] = (
                "Adjudicate one possible social goal from described conduct, "
                "approach, higher-of defense, motive, and one-level support"
            )
            row["properties"]["implementation"]["payload_slots"] = [
                {"name": "described_action", "ownership": "player-source"},
                {"name": "target_ref", "ownership": "keeper-semantic"},
                {"name": "commitment_ref", "ownership": "keeper-semantic"},
                {"name": "approach", "ownership": "keeper-semantic"},
                {"name": "goal", "ownership": "player-source"},
                {"name": "npc_defense", "ownership": "host-locked"},
                {"name": "motive_direction", "ownership": "keeper-semantic"},
                {"name": "motive_intensity", "ownership": "keeper-semantic"},
                {"name": "motive_evidence", "ownership": "host-locked"},
                {"name": "supporting_action", "ownership": "keeper-semantic"},
                {"name": "feasibility", "ownership": "keeper-semantic"},
            ]
    for relation in relations:
        if relation["relation_id"] == "relation:coc7:social:adjudicate-reads-names":
            relation["relation_kind"] = "requires-fact"
    additions = [
        _node(
            "data-table:coc7:skill-descriptions",
            "data-table",
            "skill-descriptions.json",
            audience="host-internal",
            visibility="keeper-only",
            properties={"table_name": "skill-descriptions.json"},
            evidence=evidence,
        ),
        _node(
            "rule:coc7:social:feasibility",
            "rule",
            "Roleplay first and roll only for a genuine possible conflict; story position, approach, and the NPC's weakness determine whether the goal is automatic, rollable, or presently impossible",
            authority="mixed",
            properties={"family_id": "social"},
            evidence=evidence,
        ),
        _node(
            "rule:coc7:social:motive-and-support",
            "rule",
            "Positive inclination grants agreement without a roll; neutrality leaves difficulty unchanged; strong opposition raises one or two levels; a substantive supporting case lowers one level",
            authority="mixed",
            properties={"family_id": "social"},
            evidence=evidence,
        ),
        _node(
            "rule:coc7:social:canonical-motive-evidence-binding",
            "rule",
            "A non-neutral motive adjustment is grounded by host-resolved authored NPC agenda, fact, or state evidence bound to the exact target and goal; free prose cannot supply motive evidence",
            authority="mixed",
            properties={"family_id": "social"},
            evidence=evidence,
        ),
        _node(
            "subsystem:coc7:social-source-evidence-registry",
            "subsystem",
            "Canonical authored NPC and player-known social evidence registry",
            audience="host-internal",
            visibility="keeper-only",
            properties={"subsystem_kind": "canonical-social-source-evidence"},
            evidence=evidence,
        ),
        _node(
            "rule:coc7:social:extreme-ceiling",
            "rule",
            "Extreme is the lowest rollable chance; rare circumstances may make the present goal impossible and allow no roll",
            authority="mixed",
            properties={"family_id": "social"},
            evidence=evidence,
        ),
        _node(
            "rule:coc7:social:pc-agency-and-penalty",
            "rule",
            "A successful social skill never compels another player's investigator; refusal lets the coercer hold one penalty die for one later roll of the coercer's choice, not indefinitely and never stacking per pair",
            authority="mixed",
            properties={"family_id": "social"},
            evidence=evidence,
        ),
        _node(
            "effect:coc7:social:pc-refusal-penalty",
            "effect",
            "One non-stacking penalty die held by the coercer against the refusing investigator for one later chosen roll",
            audience="host-internal",
            properties={
                "family_id": "social",
                "effect_kind": "one-use-penalty-die",
            },
            evidence=evidence,
        ),
        _node(
            "pending-choice:coc7:social:pc-refusal",
            "pending-choice",
            "The player remains free to refuse the successful social request",
            properties={"family_id": "social"},
            evidence=evidence,
        ),
        _node(
            "rule:coc7:social:charm-scope",
            "rule",
            "Charm uses warmth, attraction, flattery, or seduction and cannot compel behavior completely contrary to the target's normal behavior",
            authority="mixed",
            properties={"family_id": "social"},
            evidence=evidence,
        ),
        _node(
            "rule:coc7:social:fast-talk-temporary",
            "rule",
            "Fast Talk is quick deception or misdirection; its effect is temporary, though a higher success may last longer",
            authority="mixed",
            properties={"family_id": "social"},
            evidence=evidence,
        ),
        _node(
            "rule:coc7:social:intimidate-scope",
            "rule",
            "Intimidate uses force, threats, or psychological pressure; a credible powerful threat may support the case and a pushed failure may carry out the threat",
            authority="mixed",
            properties={"family_id": "social"},
            evidence=evidence,
        ),
        _node(
            "rule:coc7:social:persuade-duration",
            "rule",
            "Persuade uses reasoned argument and normally takes at least half an hour; depending on the goal and time invested its effect may persist",
            authority="mixed",
            properties={"family_id": "social"},
            evidence=evidence,
        ),
        _node(
            "input-slot:coc7:social:target-ref",
            "input-slot",
            "Semantic retained SocialInteractionCandidate target reference in the social-target:<npc_id> namespace",
            visibility="keeper-only",
            properties={
                "family_id": "social",
                "ownership": "keeper-semantic",
                "value_type": "scalar",
                "path": "target_ref",
            },
            evidence=evidence,
        ),
        _node(
            "input-slot:coc7:social:commitment-ref",
            "input-slot",
            "Semantic durable requested commitment reference; the host binds it to commitment_id without parsing goal prose",
            visibility="keeper-only",
            properties={
                "family_id": "social",
                "ownership": "keeper-semantic",
                "value_type": "scalar",
                "path": "commitment_ref",
            },
            evidence=evidence,
        ),
        _node(
            "input-slot:coc7:social:motive-direction",
            "input-slot",
            "NPC inclination toward the exact player goal",
            visibility="keeper-only",
            properties={
                "family_id": "social",
                "ownership": "keeper-semantic",
                "value_type": "enum",
                "path": "motive.direction",
            },
            evidence=evidence,
        ),
        _node(
            "input-slot:coc7:social:motive-intensity",
            "input-slot",
            "Source-grounded opposition adjustment of zero, one, or two levels",
            visibility="keeper-only",
            properties={
                "family_id": "social",
                "ownership": "keeper-semantic",
                "value_type": "scalar",
                "path": "motive.intensity",
            },
            evidence=evidence,
        ),
        _node(
            "input-slot:coc7:social:motive-evidence",
            "input-slot",
            "Host-resolved typed evidence rows grounding the NPC motive adjustment",
            audience="host-internal",
            visibility="keeper-only",
            properties={
                "family_id": "social",
                "ownership": "host-locked",
                "value_type": "array",
                "path": "motive_evidence",
            },
            evidence=evidence,
        ),
        _node(
            "input-slot:coc7:social:supporting-action",
            "input-slot",
            "One substantive argument, bribe, threat, or other source-grounded support for the case",
            visibility="keeper-only",
            properties={
                "family_id": "social",
                "ownership": "keeper-semantic",
                "value_type": "object",
                "path": "supporting_action",
            },
            evidence=evidence,
        ),
        _node(
            "input-slot:coc7:social:feasibility",
            "input-slot",
            "Story-grounded automatic, rollable, conditional, or impossible disposition",
            visibility="keeper-only",
            properties={
                "family_id": "social",
                "ownership": "keeper-semantic",
                "value_type": "enum",
                "path": "feasibility",
            },
            evidence=evidence,
        ),
    ]
    nodes.extend(additions)
    family_id = "rule-family:coc7:social"
    decision = "decision:coc7:social:adjudicate-difficulty"
    relations.extend([
        _relation("relation:coc7:social:feasibility-part-of", "part-of", "rule:coc7:social:feasibility", family_id, evidence),
        _relation("relation:coc7:social:motive-support-part-of", "part-of", "rule:coc7:social:motive-and-support", family_id, evidence),
        _relation("relation:coc7:social:motive-binding-part-of", "part-of", "rule:coc7:social:canonical-motive-evidence-binding", family_id, evidence),
        _relation("relation:coc7:social:motive-rule-invokes", "invokes", "rule:coc7:social:canonical-motive-evidence-binding", "capability:coc7:social-difficulty", evidence),
        _relation("relation:coc7:social:ceiling-part-of", "part-of", "rule:coc7:social:extreme-ceiling", family_id, evidence),
        _relation("relation:coc7:social:pc-agency-part-of", "part-of", "rule:coc7:social:pc-agency-and-penalty", family_id, evidence),
        _relation("relation:coc7:social:charm-part-of", "part-of", "rule:coc7:social:charm-scope", family_id, evidence),
        _relation("relation:coc7:social:fast-talk-part-of", "part-of", "rule:coc7:social:fast-talk-temporary", family_id, evidence),
        _relation("relation:coc7:social:intimidate-part-of", "part-of", "rule:coc7:social:intimidate-scope", family_id, evidence),
        _relation("relation:coc7:social:persuade-part-of", "part-of", "rule:coc7:social:persuade-duration", family_id, evidence),
        _relation("relation:coc7:social:feasibility-applies", "applies-to", "rule:coc7:social:feasibility", decision, evidence),
        _relation("relation:coc7:social:motive-support-applies", "applies-to", "rule:coc7:social:motive-and-support", decision, evidence),
        _relation("relation:coc7:social:ceiling-applies", "applies-to", "rule:coc7:social:extreme-ceiling", decision, evidence),
        _relation("relation:coc7:social:requires-motive-direction", "requires-input", decision, "input-slot:coc7:social:motive-direction", evidence),
        _relation("relation:coc7:social:requires-target-ref", "requires-input", decision, "input-slot:coc7:social:target-ref", evidence),
        _relation("relation:coc7:social:requires-commitment-ref", "requires-input", decision, "input-slot:coc7:social:commitment-ref", evidence),
        _relation("relation:coc7:social:requires-motive-intensity", "requires-input", decision, "input-slot:coc7:social:motive-intensity", evidence),
        _relation("relation:coc7:social:locks-motive-evidence", "locks-input", decision, "input-slot:coc7:social:motive-evidence", evidence),
        _relation("relation:coc7:social:motive-evidence-requires-source", "requires-fact", "input-slot:coc7:social:motive-evidence", "subsystem:coc7:social-source-evidence-registry", evidence),
        _relation("relation:coc7:social:requires-support", "requires-input", decision, "input-slot:coc7:social:supporting-action", evidence),
        _relation("relation:coc7:social:requires-feasibility", "requires-input", decision, "input-slot:coc7:social:feasibility", evidence),
        _relation("relation:coc7:social:reads-skill-descriptions", "reads-table", decision, "data-table:coc7:skill-descriptions", evidence),
        _relation("relation:coc7:social:pc-refusal-offered", "offers-choice", "rule:coc7:social:pc-agency-and-penalty", "pending-choice:coc7:social:pc-refusal", evidence),
        _relation("relation:coc7:social:pc-refusal-emits", "emits", "pending-choice:coc7:social:pc-refusal", "effect:coc7:social:pc-refusal-penalty", evidence),
    ])
    candidate = {
        "contract_id": rg.CANDIDATE_CONTRACT_ID,
        "schema_version": 1,
        "ruleset_id": "coc7",
        "family_id": "social",
        "section_id": packet["section_id"],
        "source_language": "en",
        "coverage": {"social": "accepted"},
        "nodes": sorted(nodes, key=lambda row: row["node_id"]),
        "relations": sorted(relations, key=lambda row: row["relation_id"]),
    }
    findings = rg._validate_candidate(candidate, packet)
    if findings:
        raise RuntimeError(findings)
    return candidate


def _provenance(packet: dict[str, Any], family: str, bundle: dict[str, Any]) -> dict[str, Any]:
    page_ids = sorted({
        int(span["source_ref"]["pdf_index"])
        for span in packet["evidence_binding"]["spans"]
    })
    pages = {int(row["pdf_index"]): row for row in bundle["pages"]}
    return {
        "reviewer_identity": _reviewer_identity(family),
        "source_id": SOURCE_ID,
        "file_sha256": PDF_SHA256,
        "bundle_id": BUNDLE_NAME,
        "bundle_sha256": bundle["bundle_sha256"],
        "pages": [
            {
                "pdf_index": page,
                "text_sha256": pages[page]["text_sha256"],
                "review_state": pages[page]["review_state"],
            }
            for page in page_ids
        ],
    }


def accept_family(
    bundle_root: Path,
    family: str,
    pages: list[int],
    candidate_factory,
) -> dict[str, Any]:
    packet = _packet(bundle_root, family, pages)
    candidate = candidate_factory(packet)
    bundle = _read(bundle_root / BUNDLE_NAME / "normalized-source.json")
    with tempfile.TemporaryDirectory(prefix=f"rulegraph-{family}-accept-") as raw:
        accepted = rg.accept(packet, candidate, evidence_root=Path(raw))
        if not accepted.get("ok"):
            raise RuntimeError(accepted.get("findings"))
        built = rg.build([accepted["shard"]], evidence_root=Path(raw))
        if not built.get("ok"):
            raise RuntimeError(built.get("findings"))
    graph = built["graph"]
    manifest = built["manifest"]
    manifest["source_bundles"] = [{
        "source_id": SOURCE_ID,
        "bundle_sha256": bundle["bundle_sha256"],
        "file_sha256": PDF_SHA256,
    }]
    manifest["reviewer_identity"] = _reviewer_identity(family)
    manifest["review_status"] = "accepted"
    manifest["findings"] = [{
        "code": "independent_source_review",
        "path": f"/reviews/{family}",
        "message": (
            f"Independent page-level semantic review accepted {family}; "
            f"see source-stage1/reviews/{family}-source-review.md"
        ),
    }]
    manifest["graph_content_digest"] = rg._json_digest(graph)
    return {
        "candidate": candidate,
        "accepted_shard": accepted["shard"],
        "graph": graph,
        "manifest": manifest,
        "provenance": _provenance(packet, family, bundle),
    }


FAMILIES = {
    "core-check": {
        "pages": [93, 94, 97, 99, 100, 101, 102, 103, 104],
        "factory": core_check_candidate,
    },
    "push-luck": {
        "pages": [95, 96, 97, 100, 101, 110],
        "factory": push_luck_candidate,
    },
    "social": {
        "pages": [70, 71, 75, 77, 82, 84, 104, 208],
        "factory": social_candidate,
    },
}


def write_family(family: str, result: dict[str, Any]) -> None:
    output = SOURCE_TREE / "accepted" / family
    output.mkdir(parents=True, exist_ok=True)
    for key, name in (
        ("candidate", "candidate.json"),
        ("accepted_shard", "accepted-shard.json"),
        ("graph", "rule-graph.json"),
        ("manifest", "rule-graph-manifest.json"),
        ("provenance", "provenance.json"),
    ):
        (output / name).write_bytes(_bytes(result[key]))


def main() -> None:
    raw = os.environ.get(BUNDLE_ROOT_ENV)
    if not raw:
        raise SystemExit(f"{BUNDLE_ROOT_ENV} is required")
    bundle_root = Path(raw).expanduser().resolve()
    for family, spec in FAMILIES.items():
        result = accept_family(
            bundle_root, family, list(spec["pages"]), spec["factory"]
        )
        write_family(family, result)
        print(json.dumps({
            "family": family,
            "nodes": len(result["graph"]["nodes"]),
            "relations": len(result["graph"]["relations"]),
            "reviewer_identity": result["manifest"]["reviewer_identity"],
            "graph_content_digest": result["manifest"]["graph_content_digest"],
        }, ensure_ascii=False))


if __name__ == "__main__":
    main()
