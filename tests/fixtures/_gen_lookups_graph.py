#!/usr/bin/env python3
"""Generate the R6 lookups/damage/SAN validation-copy RuleGraph fixture."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
GRAPH_PATH = ROOT / "coc7-rule-graph-lookups.json"
MANIFEST_PATH = ROOT / "coc7-rule-graph-manifest-lookups.json"

FAMILIES = (
    "chase", "combat", "core-check", "development", "healing",
    "magic", "psychology", "push-luck", "sanity", "social",
)
PARTIAL = {"development", "combat", "sanity"}


def node(node_id, kind, name, *, authority="deterministic", audience="host-internal",
         visibility="keeper-only", hard_gate=False, properties=None, evidence=None):
    return {
        "node_id": node_id,
        "node_kind": kind,
        "name": name,
        "authority": authority,
        "audience": audience,
        "visibility": visibility,
        "hard_gate": hard_gate,
        "properties": properties or {},
        "evidence_span_ids": list(evidence or []),
    }


def rel(rid, kind, frm, to, evidence):
    return {
        "relation_id": rid,
        "relation_kind": kind,
        "from_node_id": frm,
        "to_node_id": to,
        "evidence_span_ids": list(evidence or []),
    }


def slot(name, ownership):
    return {"name": name, "ownership": ownership}


def table(slug, filename, evidence):
    return node(
        f"data-table:coc7:{slug}", "data-table", filename,
        properties={"path": f"rules-json/{filename}"},
        evidence=evidence,
    )


def capability(slug, resolver, family, evidence):
    return node(
        f"capability:coc7:{slug}", "capability", resolver,
        properties={
            "resolver_capability": resolver,
            "adapter": "resolver",
            "family_id": family,
        },
        evidence=evidence,
    )


def main() -> None:
    e_skill = ["span-skill-descriptions-json"]
    e_skills = ["span-skills-json"]
    e_equip = ["span-equipment-json"]
    e_build = ["span-build-scale-json"]
    e_cash = ["span-cash-assets-json"]
    e_dmg = ["span-damage-json"]
    e_hp = ["span-derived-attributes-json", "span-damage-json"]
    e_san = ["span-sanity-json"]
    e_san_res = ["span-derived-attributes-json", "span-sanity-json"]
    e_cat = ["span-equipment-json", "span-skills-json", "span-skill-descriptions-json"]

    nodes = [
        node(
            "rule-family:coc7:development", "rule-family",
            "Chargen and play reference table lookups (skill/catalog/build/cash)",
            audience="keeper",
            properties={
                "runtime_ownership": "legacy",
                "legacy_surface": "visible",
                "family_id": "development",
            },
            evidence=e_skill + e_build + e_cash + e_equip,
        ),
        node(
            "rule-family:coc7:combat", "rule-family",
            "Non-session roll-backed HP damage (negative delta); combat session engine retained",
            audience="keeper",
            properties={
                "runtime_ownership": "legacy",
                "legacy_surface": "visible",
                "family_id": "combat",
            },
            evidence=e_dmg,
        ),
        node(
            "rule-family:coc7:sanity", "rule-family",
            "Sourced SAN thresholds, max SAN, and failed-roll involuntary actions; check/loss algorithm uncompiled",
            audience="keeper",
            properties={
                "runtime_ownership": "legacy",
                "legacy_surface": "visible",
                "family_id": "sanity",
            },
            evidence=e_san,
        ),
        capability("skill-describe", "skill_describe", "development", e_skill),
        capability("catalog-search", "catalog_search", "development", e_cat),
        capability("build-scale", "build_scale", "development", e_build),
        capability("cash-assets", "cash_assets", "development", e_cash),
        capability("damage", "damage", "combat", e_dmg),
        table("skill-descriptions", "skill-descriptions.json", e_skill),
        table("skills", "skills.json", e_skills),
        table("equipment", "equipment.json", e_equip),
        table("build-scale", "build-scale.json", e_build),
        table("cash-assets", "cash-assets.json", e_cash),
        table("damage", "damage.json", e_dmg),
        table("derived-attributes", "derived-attributes.json", ["span-derived-attributes-json"]),
        table("sanity", "sanity.json", e_san),
        node(
            "rule:coc7:development:skill-catalog", "rule",
            "Keeper-facing skill prose is the compiled skill-descriptions catalog; mechanical bases stay in skills.json",
            properties={
                "source_table": "skill-descriptions.json",
                "source_rule_id": "core.skills.describe",
                "family_id": "development",
            },
            evidence=e_skill + e_skills,
        ),
        node(
            "rule:coc7:development:catalog-candidate-recall", "rule",
            "Catalog search returns advisory candidates only; KP selects entity_id semantically; secret rows stay secret",
            properties={
                "source_table": "equipment.json",
                "source_rule_id": "core.catalog.search",
                "family_id": "development",
            },
            evidence=e_cat,
        ),
        node(
            "rule:coc7:development:build-scale", "rule",
            "Build scale and lift/throw bands are table lookups; they never roll",
            properties={
                "source_table": "build-scale.json",
                "source_rule_id": "core.build.scale",
                "family_id": "development",
            },
            evidence=e_build,
        ),
        node(
            "rule:coc7:development:cash-from-credit", "rule",
            "Credit Rating maps to cash, assets, spending level, and living standard by era table",
            properties={
                "source_table": "cash-assets.json",
                "source_rule_id": "core.cash.assets",
                "family_id": "development",
            },
            evidence=e_cash,
        ),
        node(
            "rule:coc7:combat:hp-damage", "rule",
            "Damage rolls are non-percentile dice that reduce hit points; play logs keep roll id, expression, total, and HP before/delta/after",
            properties={
                "source_table": "damage.json",
                "source_rule_id": "core.damage.roll",
                "family_id": "combat",
                "delta_sign": "negative",
                "dice_kind": "damage",
                "requires_die": True,
                "requires_roll_id": True,
                "requires_roll_total": True,
                "requires_resource_before_delta_after": True,
                "non_percentile": True,
            },
            evidence=e_dmg,
        ),
        node(
            "rule:coc7:sanity:temp-insanity-threshold", "rule",
            "Temporary insanity triggers at 5 or more SAN lost from one source",
            properties={
                "source_table": "sanity.json",
                "source_field": "temporary_insanity_loss_threshold",
                "family_id": "sanity",
                "temporary_insanity_loss_threshold": 5,
            },
            evidence=e_san,
        ),
        node(
            "rule:coc7:sanity:indefinite-daily-fraction", "rule",
            "Indefinite insanity uses a daily fraction of current SAN",
            properties={
                "source_table": "sanity.json",
                "source_field": "indefinite_insanity_daily_fraction",
                "family_id": "sanity",
                "indefinite_insanity_daily_fraction": 0.2,
            },
            evidence=e_san,
        ),
        node(
            "rule:coc7:sanity:max-san", "rule",
            "Maximum Sanity is 99 minus current Cthulhu Mythos skill",
            properties={
                "source_table": "sanity.json",
                "source_field": "max_san",
                "family_id": "sanity",
                "formula": "99 - cthulhu_mythos",
                "base_max": 99,
                "subtract": "cthulhu_mythos_current_skill",
            },
            evidence=e_san,
        ),
        node(
            "rule:coc7:sanity:failed-roll-involuntary-action", "rule",
            "A failed SAN roll causes a Keeper-chosen involuntary action from the extracted kind list",
            properties={
                "source_table": "sanity.json",
                "source_field": "failed_san_roll_involuntary_action",
                "family_id": "sanity",
                "applies_when": "sanity_roll_outcome == failure",
                "kinds": [
                    "jump_in_fright",
                    "cry_out",
                    "involuntary_movement",
                    "involuntary_combat_action",
                    "freeze",
                ],
            },
            evidence=e_san,
        ),
        node(
            "rule:coc7:sanity:bout-duration", "rule",
            "A bout of madness lasts 1D10 real-time rounds or 1D10 summary hours",
            properties={
                "source_table": "sanity.json",
                "source_field": "bout_duration",
                "family_id": "sanity",
                "real_time_rounds": "1D10",
                "summary_hours": "1D10",
            },
            evidence=e_san,
        ),
        node(
            "resource:coc7:hp", "resource", "Hit points",
            properties={"pool": "hp", "family_id": "combat"},
            evidence=e_hp,
        ),
        node(
            "resource:coc7:san", "resource", "Sanity points",
            properties={"pool": "san", "family_id": "sanity"},
            evidence=e_san_res,
        ),
        node(
            "effect:coc7:combat:hp-change", "effect",
            "HP after a damage roll with before/delta/after evidence (negative delta)",
            audience="keeper", visibility="public",
            properties={
                "visibility": "public",
                "family_id": "combat",
                "delta_sign": "negative",
                "requires_resource_before_delta_after": True,
            },
            evidence=e_dmg,
        ),
        node(
            "visibility-policy:coc7:development:catalog-secret", "visibility-policy",
            "Secret catalog rows stay secret:true and are never player-projected",
            audience="keeper", visibility="concealed-result",
            properties={"family_id": "development", "audience": "keeper"},
            evidence=e_cat,
        ),
        node(
            "decision:coc7:development:skill-describe", "decision",
            "Look up Keeper-facing skill prose after the KP has narrowed candidate skills",
            authority="deterministic", audience="keeper", visibility="keeper-only",
            properties={
                "family_id": "development",
                "context_only": True,
                "implementation": {
                    "adapter": "resolver",
                    "kind": "skill_describe",
                    "phase": "lookup",
                    "payload_constants": {},
                    "payload_slots": [
                        slot("skill", "optional-semantic"),
                        slot("skills", "optional-semantic"),
                        slot("include_selection_policy", "optional-semantic"),
                    ],
                },
            },
            evidence=e_skill,
        ),
        node(
            "decision:coc7:development:catalog-search", "decision",
            "Recall advisory catalog candidates; KP chooses entity_id; never auto-select",
            authority="deterministic", audience="keeper", visibility="keeper-only",
            properties={
                "family_id": "development",
                "context_only": True,
                "implementation": {
                    "adapter": "resolver",
                    "kind": "catalog_search",
                    "phase": "lookup",
                    "payload_constants": {},
                    "payload_slots": [
                        slot("query", "keeper-semantic"),
                        slot("kinds", "optional-semantic"),
                        slot("era", "optional-semantic"),
                        slot("limit", "optional-semantic"),
                    ],
                },
            },
            evidence=e_cat,
        ),
        node(
            "decision:coc7:development:build-scale", "decision",
            "Look up comparative build scale or a lift/throw verdict",
            authority="deterministic", audience="keeper", visibility="keeper-only",
            properties={
                "family_id": "development",
                "context_only": True,
                "implementation": {
                    "adapter": "resolver",
                    "kind": "build_scale",
                    "phase": "lookup",
                    "payload_constants": {},
                    "payload_slots": [
                        slot("build", "optional-semantic"),
                        slot("actor_build", "optional-semantic"),
                        slot("target_build", "optional-semantic"),
                    ],
                },
            },
            evidence=e_build,
        ),
        node(
            "decision:coc7:development:cash-assets", "decision",
            "Map Credit Rating to cash, assets, spending level, and living standard",
            authority="deterministic", audience="keeper", visibility="keeper-only",
            properties={
                "family_id": "development",
                "context_only": True,
                "implementation": {
                    "adapter": "resolver",
                    "kind": "cash_assets",
                    "phase": "lookup",
                    "payload_constants": {},
                    "payload_slots": [
                        slot("credit_rating", "keeper-semantic"),
                        slot("period", "optional-semantic"),
                    ],
                },
            },
            evidence=e_cash,
        ),
        node(
            "decision:coc7:combat:apply-damage", "decision",
            "Apply one non-session HP damage roll (die expression; negative delta)",
            authority="mixed", audience="keeper", visibility="public",
            properties={
                "family_id": "combat",
                "implementation": {
                    "adapter": "resolver",
                    "kind": "damage",
                    "phase": "resolve",
                    "payload_constants": {"kind": "damage"},
                    "payload_slots": [
                        slot("amount", "keeper-semantic"),
                        slot("source", "optional-semantic"),
                        slot("investigator_id", "host-locked"),
                        slot("current_hp", "host-locked"),
                        slot("max_hp", "host-locked"),
                    ],
                },
            },
            evidence=e_dmg,
        ),
        node(
            "exception:coc7:sanity:check-then-loss-uncompiled", "exception",
            "Percentile SAN check, success/failure loss expressions, and SAN floor-0 clamp are not in sanity.json",
            audience="host-internal",
            properties={
                "family_id": "sanity",
                "uncompiled": True,
                "absent_from_source": [
                    "percentile_check_against_current_san",
                    "loss_success_loss_failure_selection",
                    "san_floor_zero_clamp",
                ],
            },
            evidence=e_san,
        ),
        node(
            "exception:coc7:sanity:session-engine-uncompiled", "exception",
            "INT reality check, SAN 0 permanent insanity, and SanitySession state machine are not extracted as a check/loss algorithm",
            audience="host-internal",
            properties={
                "family_id": "sanity",
                "uncompiled": True,
            },
            evidence=e_san,
        ),
        node(
            "input-slot:coc7:development:query", "input-slot", "query",
            properties={"ownership": "keeper-semantic", "value_type": "scalar", "family_id": "development"},
            evidence=e_cat,
        ),
        node(
            "input-slot:coc7:development:credit-rating", "input-slot", "credit_rating",
            properties={"ownership": "keeper-semantic", "value_type": "int", "family_id": "development"},
            evidence=e_cash,
        ),
        node(
            "input-slot:coc7:combat:amount", "input-slot", "amount",
            properties={
                "ownership": "keeper-semantic",
                "value_type": "die",
                "family_id": "combat",
                "requires_die": True,
            },
            evidence=e_dmg,
        ),
    ]

    relations = [
        rel("relation:coc7:development:skill-invokes", "invokes",
            "decision:coc7:development:skill-describe", "capability:coc7:skill-describe", e_skill),
        rel("relation:coc7:development:skill-reads", "reads-table",
            "decision:coc7:development:skill-describe", "data-table:coc7:skill-descriptions", e_skill),
        rel("relation:coc7:development:skill-rule-invokes", "invokes",
            "rule:coc7:development:skill-catalog", "capability:coc7:skill-describe", e_skill),
        rel("relation:coc7:development:catalog-invokes", "invokes",
            "decision:coc7:development:catalog-search", "capability:coc7:catalog-search", e_cat),
        rel("relation:coc7:development:catalog-reads-equipment", "reads-table",
            "decision:coc7:development:catalog-search", "data-table:coc7:equipment", e_equip),
        rel("relation:coc7:development:catalog-rule-invokes", "invokes",
            "rule:coc7:development:catalog-candidate-recall", "capability:coc7:catalog-search", e_cat),
        rel("relation:coc7:development:catalog-requires-query", "requires-input",
            "decision:coc7:development:catalog-search", "input-slot:coc7:development:query", e_cat),
        rel("relation:coc7:development:build-invokes", "invokes",
            "decision:coc7:development:build-scale", "capability:coc7:build-scale", e_build),
        rel("relation:coc7:development:build-reads", "reads-table",
            "decision:coc7:development:build-scale", "data-table:coc7:build-scale", e_build),
        rel("relation:coc7:development:build-rule-invokes", "invokes",
            "rule:coc7:development:build-scale", "capability:coc7:build-scale", e_build),
        rel("relation:coc7:development:cash-invokes", "invokes",
            "decision:coc7:development:cash-assets", "capability:coc7:cash-assets", e_cash),
        rel("relation:coc7:development:cash-reads", "reads-table",
            "decision:coc7:development:cash-assets", "data-table:coc7:cash-assets", e_cash),
        rel("relation:coc7:development:cash-rule-invokes", "invokes",
            "rule:coc7:development:cash-from-credit", "capability:coc7:cash-assets", e_cash),
        rel("relation:coc7:development:cash-requires-cr", "requires-input",
            "decision:coc7:development:cash-assets", "input-slot:coc7:development:credit-rating", e_cash),
        rel("relation:coc7:combat:damage-invokes", "invokes",
            "decision:coc7:combat:apply-damage", "capability:coc7:damage", e_dmg),
        rel("relation:coc7:combat:damage-rule-invokes", "invokes",
            "rule:coc7:combat:hp-damage", "capability:coc7:damage", e_dmg),
        rel("relation:coc7:combat:damage-requires-amount", "requires-input",
            "decision:coc7:combat:apply-damage", "input-slot:coc7:combat:amount", e_dmg),
        rel("relation:coc7:combat:damage-emits", "emits",
            "decision:coc7:combat:apply-damage", "effect:coc7:combat:hp-change", e_dmg),
        rel("relation:coc7:combat:damage-mutates", "mutates-resource",
            "effect:coc7:combat:hp-change", "resource:coc7:hp", e_hp),
        rel("relation:coc7:sanity:temp-reads", "reads-table",
            "rule:coc7:sanity:temp-insanity-threshold", "data-table:coc7:sanity", e_san),
        rel("relation:coc7:sanity:indefinite-reads", "reads-table",
            "rule:coc7:sanity:indefinite-daily-fraction", "data-table:coc7:sanity", e_san),
        rel("relation:coc7:sanity:max-reads", "reads-table",
            "rule:coc7:sanity:max-san", "data-table:coc7:sanity", e_san),
        rel("relation:coc7:sanity:involuntary-reads", "reads-table",
            "rule:coc7:sanity:failed-roll-involuntary-action", "data-table:coc7:sanity", e_san),
        rel("relation:coc7:sanity:bout-reads", "reads-table",
            "rule:coc7:sanity:bout-duration", "data-table:coc7:sanity", e_san),
    ]

    coverage = {family: ("partial" if family in PARTIAL else "unresolved") for family in FAMILIES}
    ownership = {family: "legacy" for family in FAMILIES}
    surface = {family: "visible" for family in FAMILIES}

    graph = {
        "contract_id": "coc.rule-graph.v1",
        "schema_version": 1,
        "ruleset_id": "coc7",
        "ruleset_version": "1.0.0",
        "source_language": "en",
        "nodes": nodes,
        "relations": relations,
        "coverage": coverage,
        "family_runtime_ownership": ownership,
        "legacy_surface_lifecycle": surface,
    }
    canonical = json.dumps(graph, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    findings = [
        {
            "code": "source_ambiguity",
            "path": "/rule-family:coc7:development",
            "message": (
                "development family here is lookup/read coverage only "
                "(skill-describe, catalog-search, build-scale, cash-assets). "
                "Investigator Development Phase skill-tick improvement stays uncompiled."
            ),
        },
        {
            "code": "source_ambiguity",
            "path": "/rule-family:coc7:combat",
            "message": (
                "combat family here is non-session roll-backed HP damage only. "
                "The combat session engine (DEX order, dodge/fight-back, maneuvers) is retained."
            ),
        },
        {
            "code": "source_ambiguity",
            "path": "/decision:coc7:combat:apply-damage/heal",
            "message": (
                "damage.json delta_sign is negative and dice_kind is damage. "
                "Healing amounts belong to the healing family, not this combat decision."
            ),
        },
        {
            "code": "source_ambiguity",
            "path": "/decision:coc7:combat:apply-damage/integer-amount",
            "message": (
                "damage.json requires_die, requires_roll_id, and requires_roll_total. "
                "Unrolled integer HP application is not a compiled claim of this node."
            ),
        },
        {
            "code": "source_ambiguity",
            "path": "/decision:coc7:combat:apply-damage/major-wound",
            "message": (
                "damage.json specifies non-percentile HP reduction evidence, not the "
                "half-max major-wound or 0 HP dying/unconscious transitions. Those "
                "condition writes remain in the legacy damage handler; no extracted "
                "major-wound table is cited."
            ),
        },
        {
            "code": "source_ambiguity",
            "path": "/rule-family:coc7:sanity",
            "message": (
                "sanity.json supports thresholds, bout duration, failed-roll involuntary "
                "kinds, and max SAN. The percentile check, success/failure loss selection, "
                "and floor-0 clamp are absent (exception:coc7:sanity:check-then-loss-uncompiled). "
                "INT reality check, SAN 0 permanent, and the SanitySession state machine "
                "stay uncompiled (exception:coc7:sanity:session-engine-uncompiled)."
            ),
        },
        {
            "code": "source_ambiguity",
            "path": "/exception:coc7:sanity:check-then-loss-uncompiled",
            "message": (
                "sanity.json does not contain a percentile check against current SAN, "
                "loss_success/loss_failure selection, or a SAN floor-0 clamp. Those "
                "claims are uncompiled; this finding marks their absence, not source backing."
            ),
        },
        {
            "code": "source_ambiguity",
            "path": "/coverage/magic",
            "message": "magic family has no R6 source+execution evidence; coverage stays unresolved.",
        },
    ]

    manifest = {
        "contract_id": "coc.rule-graph-build-manifest.v1",
        "schema_version": 1,
        "ruleset_id": "coc7",
        "ruleset_version": "1.0.0",
        "source_bundles": [
            {
                "source_id": "rules-json:coc7",
                "bundle_sha256": "0" * 64,
                "file_sha256": "0" * 64,
            }
        ],
        "graph_content_digest": digest,
        "shards": [
            {
                "shard_id": "shard:coc7:development:section-lookups",
                "shard_digest": hashlib.sha256(b"shard:coc7:development:section-lookups").hexdigest(),
            },
            {
                "shard_id": "shard:coc7:combat:section-non-session-damage",
                "shard_digest": hashlib.sha256(b"shard:coc7:combat:section-non-session-damage").hexdigest(),
            },
            {
                "shard_id": "shard:coc7:sanity:section-sourced-thresholds",
                "shard_digest": hashlib.sha256(b"shard:coc7:sanity:section-sourced-thresholds").hexdigest(),
            },
        ],
        "family_coverage": coverage,
        "family_promotion_eligibility": {
            family: {
                "promotion_eligible": False,
                "runtime_ownership": "legacy",
            }
            for family in FAMILIES
        },
        "data_table_dependencies": [
            "skill-descriptions.json",
            "skills.json",
            "equipment.json",
            "build-scale.json",
            "cash-assets.json",
            "damage.json",
            "derived-attributes.json",
            "sanity.json",
        ],
        "resolver_capability_dependencies": [
            "skill_describe",
            "catalog_search",
            "build_scale",
            "cash_assets",
            "damage",
        ],
        "compiler_identity": "coc.rule-graph-compiler.v1",
        "reviewer_identity": "r6-lookups",
        "review_status": "accepted",
        "findings": findings,
    }

    GRAPH_PATH.write_text(json.dumps(graph, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {GRAPH_PATH.name} digest={digest}")
    print(f"wrote {MANIFEST_PATH.name}")


if __name__ == "__main__":
    main()
