#!/usr/bin/env python3
"""Generate reviewed source-bound development/chase/magic RuleShards.

The PDF OCR/source bundles are external immutable inputs supplied through
COC_RULE_GRAPH_FAMILY_BUNDLE_ROOT.  This script uses the canonical
prepare()/accept() path and never writes production RuleGraph artifacts.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_rule_graph as rg  # noqa: E402

BUNDLE_ROOT_ENV = "COC_RULE_GRAPH_FAMILY_BUNDLE_ROOT"
OUTPUT = (
    ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7"
    / "rule-graph-candidates" / "source-families-v1"
)
FILE_SHA256 = "a860499cf34b40cac385f51b6e667ab37ec0796c7329494def08c8b161fd71eb"

SPECS: dict[str, dict[str, Any]] = {
    "development": {
        "section": "section-development-phase-source",
        "bundles": ["development-rules-v1"],
        "coverage": "accepted",
        "reviewer": "codex-reviewer-development-source-20260831",
        "tables": ["development.json", "luck.json"],
        "capabilities": ["development.settle", "state.end_session"],
        "rules": [
            ("phase-timing", "Development occurs at a scenario/chapter end or a suitable narrative pause", ["Typically the investigator development phase occurs"]),
            ("skill-ticks", "A successful skill use earns one check; bonus-die-only successes and opposed losers do not", ["When an investigator successfully uses a skill", "No tick is earned if the roll used a bonus die"]),
            ("one-check-per-skill", "Each checked skill receives at most one improvement roll per development phase", ["one check per skill"]),
            ("tick-exclusions", "Cthulhu Mythos and Credit Rating never receive improvement checks", ["Cthulhu Mythos and Credit Rating skills"]),
            ("improvement", "Roll 1D100; above current skill or above 95 gains 1D10 and may exceed 100", ["If the player rolls higher than the current skill number"]),
            ("mastery-san-reward", "A skill attaining 90 or more during development grants 2D6 current SAN", ["Skills of 90% or More"]),
            ("luck-spend-exclusion", "A roll altered by Luck earns no skill improvement check", ["no skill improvement check is earned"]),
            ("luck-recovery", "After each session, D100 above current Luck gains 1D10, capped at 99", ["Recovering Luck points"]),
            ("other-activities", "Development may include self-help, finance review, backstory changes, and awfulness-limit decay", ["Other Activities During the", "Reduce all sanity limits by one"]),
            ("awfulness-decay", "Each development phase reduces per-creature habituation totals by one", ["player should reduce all", "time is a great healer"]),
        ],
        "exceptions": [
            ("external-development-activities", "Self-help, employment/Credit Rating, and free-form backstory changes are source rules outside the deterministic development.settle adapter", ["Other Activities During the"]),
        ],
        "unresolved": [],
        "blockers": [],
    },
    "chase": {
        "section": "section-chase-complete-source",
        "bundles": ["chase-rules-v1"],
        "coverage": "accepted",
        "reviewer": "codex-reviewer-chase-applicability-20260831-v2",
        "tables": ["chase.json"],
        "capabilities": ["chase.context", "chase.execute"],
        "rules": [
            ("establish", "CON or Drive Auto speed rolls adjust MOV for the chase and determine participation", ["Speed Roll"]),
            ("cut-to-chase", "Cut to the chase establishes the opening range and location chain", ["Part 2: Cut to the Chase"]),
            ("round-order", "Chase rounds act in DEX order; tied DEX uses an opposed DEX roll", ["The Chase Round"]),
            ("movement-actions", "Each participant has one action plus one per MOV above the slowest participant", ["Movement Actions"]),
            ("no-pushed-rolls", "Pushed rolls are not used during an active chase", ["Pushing Rolls in a Chase"]),
            ("hazards", "Hazards allow cautious bonus dice; failure still advances and costs damage plus 1D3 movement actions", ["Skills and Hazards"]),
            ("barriers", "Barriers block progress until negotiated or broken and carry explicit hit points", ["Barriers block progress"]),
            ("conflict", "Same-location conflict uses combat or opposed vehicle control within chase action economy", ["Part 4: Conflict"]),
            ("route-choice", "The lead quarry may choose alternate routes", ["Choosing a Route"]),
            ("sudden-hazards", "Players and Keeper alternate Luck calls for sudden Regular hazards", ["Sudden Hazards"]),
            ("pedal-to-metal", "Pedal to the Metal trades one action for 2-5 locations with penalty dice", ["Pedal to the Metal"]),
            ("passengers-and-fire", "Passengers act once; moving fire takes a penalty die while stopped fire costs one movement action", ["Passengers do not make a speed roll", "Ranged Attacks During a Chase"]),
            ("join-and-change-mode", "Joining participants and changed movement modes recalculate speed/action state as specified", ["Characters Joining a Chase in Progress", "fresh speed roll"]),
            ("multiple-characters", "Multiple-character chases eliminate outpaced participants and position each side by MOV", ["Chases with Multiple Characters"]),
            ("vehicle-reference", "Vehicle MOV, Build, armor, passengers, impairment, and collision severity come from Tables V and VI", ["Table V: Vehicle Reference Charts", "Table VI: Vehicular Collisions"]),
            ("escape-and-hide", "A quarry may escape by breaking contact or hiding when the pursuer cannot relocate it", ["Escaping the Pursuer"]),
        ],
        "exceptions": [],
        "unresolved": [],
        "blockers": [],
    },
    "magic": {
        "section": "section-magic-source-and-runtime-gaps",
        "bundles": ["magic-core-v2", "magic-grimoire-a-v2", "magic-grimoire-b-v2"],
        "coverage": "accepted",
        "reviewer": "codex-reviewer-magic-applicability-20260831-v2",
        "tables": ["spells.json"],
        "capabilities": ["magic.learn", "magic.cast"],
        "rules": [
            ("mp-economy", "MP equals POW/5, overspends damage HP one-for-one, and regenerates by POW tier", ["Magic Points (MP)", "one Magic point per hour"]),
            ("learn-from-book", "Book study typically takes 2D6 weeks and uses a Hard INT roll unless success is automatic", ["Learning a Spell from a Mythos Book"]),
            ("learn-from-person", "Personal teaching uses the book rules but typically takes 1D8 days", ["Learninq a Spell from Another Person"]),
            ("learn-from-entity", "Entity teaching may require an INT roll and suggests at least 1D6 SAN loss", ["Learning a Spell from a Mythos Entity"]),
            ("first-cast", "A newly learned spell requires a Hard POW roll; later casts and NPC casts need no casting roll", ["A Hard POW roll is required"]),
            ("pushed-cast", "A failed pushed casting still works and costs the spell cost multiplied by 1D6 with dire side effects", ["spell still works normally", "multiplied by 1D6"]),
            ("disruption", "A significantly disrupted casting fails but still pays SAN and MP costs", ["Disrupted Spell Casting"]),
            ("grimoire-catalog", "Chapter 12 defines spell costs, casting times, effects, variations, and deeper versions", ["Spells", "Making Alterations"]),
        ],
        "exceptions": [],
        "unresolved": [],
        "blockers": [],
    },
}

EXECUTABLE_SPECS: dict[str, list[dict[str, Any]]] = {
    "development": [
        {
            "token": "end-session",
            "operation": "state.end_session",
            "slots": [("summary", "optional-semantic"), ("kind", "optional-semantic"),
                      ("investigator", "host-locked"), ("decision_id", "host-locked")],
            "optional_slots": {"summary", "kind", "investigator"},
            "condition": None,
            "effects": [("ending-recorded", None), ("development-settled", None)],
        },
        {
            "token": "settle-ending",
            "operation": "development.settle",
            "slots": [("ending_id", "host-locked"), ("investigator", "host-locked"),
                      ("decision_id", "host-locked")],
            "condition": {
                "op": "eq", "path": "development.settlement.pending", "value": True,
            },
            "hard_gate": True,
            "effects": [("skill-improvement", None), ("luck-recovery", "luck"),
                        ("san-reward", "san")],
        },
    ],
    "chase": [
        {
            "token": token,
            "operation": "chase.execute",
            "command_kind": command_kind,
            "slots": slots,
            "condition": (
                {"op": "eq", "path": "chase.session.inactive", "value": True}
                if token == "start"
                else {
                    "op": "all",
                    "of": [
                        {"op": "eq", "path": "chase.session.active", "value": True},
                        {"op": "eq", "path": "chase.pending.kind", "value": token},
                    ] + ([{
                        "op": "eq",
                        "path": "chase.conflict.receipt-ready",
                        "value": True,
                    }] if token == "conflict" else []),
                }
            ),
            "hard_gate": True,
            "effects": effects,
        }
        for token, command_kind, slots, effects in (
            ("start", "chase_start", [("chase_candidate_ref", "keeper-semantic"),
                       ("chase_id", "host-locked"),
                       ("participants", "host-locked"), ("locations", "host-locked"),
                       ("decision_id", "host-locked")], [("chase-started", None)]),
            ("move", "chase_move", [("actor_id", "host-locked"),
                      ("action_id", "host-locked"), ("choice_id", "host-locked"),
                      ("revision", "host-locked"), ("decision_id", "host-locked")],
             [("position-changed", None)]),
            ("hazard", "chase_hazard", [("actor_id", "host-locked"),
                        ("action_id", "host-locked"), ("skill", "optional-semantic"),
                        ("target", "host-locked"), ("difficulty", "host-locked"),
                        ("roll_id", "host-locked"), ("revision", "host-locked"),
                        ("decision_id", "host-locked")],
             [("hazard-resolved", None)]),
            ("barrier", "chase_barrier", [("actor_id", "host-locked"),
                         ("action_id", "host-locked"), ("method", "keeper-semantic"),
                         ("choice_id", "host-locked"), ("skill", "optional-semantic"),
                         ("target", "host-locked"), ("difficulty", "host-locked"),
                         ("roll_id", "host-locked"), ("revision", "host-locked"),
                         ("decision_id", "host-locked")],
             [("barrier-resolved", None)]),
            ("conflict", "chase_conflict", [("actor_id", "host-locked"),
                          ("action_id", "host-locked"), ("target_actor_id", "host-locked"),
                          ("combat_command_id", "host-locked"), ("revision", "host-locked"),
                          ("decision_id", "host-locked")],
             [("conflict-resolved", None)]),
            ("end", "chase_end", [("outcome", "keeper-semantic"),
                     ("chase_id", "host-locked"), ("revision", "host-locked"),
                     ("decision_id", "host-locked")], [("chase-ended", None)]),
        )
    ],
    "magic": [
        {
            "token": "cast-spell",
            "operation": "magic.cast",
            "slots": [("spell", "keeper-semantic"), ("pushed", "keeper-semantic"),
                      ("interrupted", "keeper-semantic"), ("is_npc", "host-locked"),
                      ("known_spell_ref", "host-locked"),
                      ("investigator", "host-locked"), ("decision_id", "host-locked")],
            "condition": {"op": "eq", "path": "magic.spell.known", "value": True},
            "hard_gate": True,
            "effects": [("mp-spent", "mp"), ("san-spent", "san"),
                        ("hp-overspill", "hp"), ("spell-cast", None)],
        },
        {
            "token": "learn-spell",
            "operation": "magic.learn",
            "slots": [("spell", "keeper-semantic"), ("source", "keeper-semantic"),
                      ("source_ref", "keeper-semantic"),
                      ("investigator", "host-locked"), ("decision_id", "host-locked")],
            "condition": {"op": "eq", "path": "magic.learn.source-available", "value": True},
            "hard_gate": True,
            "effects": [("spell-learned", None), ("study-scheduled", None),
                        ("entity-san-cost", "san")],
        },
    ],
}


def _read(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"


def _bundle_manifest(bundle_root: Path, name: str) -> dict[str, Any]:
    manifest = _read(bundle_root / name / "normalized-source.json")
    source = manifest.get("source") or {}
    if source.get("file_sha256") != FILE_SHA256:
        raise ValueError(f"source hash mismatch for {name}")
    return manifest


def prepare_family(bundle_root: Path, family: str) -> dict[str, Any]:
    spec = SPECS[family]
    manifests = [_bundle_manifest(bundle_root, name) for name in spec["bundles"]]
    source_ids = {str(row["source"]["source_id"]) for row in manifests}
    if len(source_ids) != 1:
        raise ValueError(f"source identity mismatch for {family}")
    source_id = next(iter(source_ids))
    result = rg.prepare({
        "ruleset_id": "coc7",
        "ruleset_version": "1.0.0",
        "source_language": "en",
        "family_id": family,
        "section_id": spec["section"],
        "bundle_dirs": [str(bundle_root / name) for name in spec["bundles"]],
        "page_keys": [
            (source_id, int(page["pdf_index"]))
            for manifest in manifests for page in manifest["pages"]
        ],
        "known_nodes": [],
        "output_budget": {"max_nodes": 120, "max_relations": 180},
        "families": [family],
    })
    if not result.get("ok"):
        raise ValueError(result.get("findings"))
    return result["shard"]


def _spans(packet: dict[str, Any], needles: list[str]) -> list[str]:
    found = [
        str(span["span_id"])
        for span in packet["evidence_view"]["spans"]
        if any(needle.casefold() in str(span.get("text") or "").casefold() for needle in needles)
    ]
    if not found:
        raise ValueError(f"no source span for {needles!r}")
    return sorted(set(found))


def _node(family: str, kind: str, token: str, name: str, spans: list[str], **props: Any) -> dict[str, Any]:
    properties = dict(props)
    if kind in {"rule", "exception", "capability", "decision", "condition", "input-slot", "effect"}:
        properties.setdefault("family_id", family)
    return {
        "node_id": f"{kind}:coc7:{family}:{token}",
        "node_kind": kind,
        "name": name,
        "authority": "deterministic",
        "audience": "host-internal" if kind in {"exception", "capability", "data-table", "subsystem"} else "keeper",
        "visibility": "keeper-only" if kind in {"exception", "capability", "data-table", "subsystem"} else "public",
        "hard_gate": False,
        "properties": properties,
        "evidence_span_ids": spans,
    }


def _add_executable_graph(
    family: str,
    all_spans: list[str],
    nodes: list[dict[str, Any]],
    relations: list[dict[str, Any]],
) -> None:
    capability_ids = {
        str((node.get("properties") or {}).get("resolver_capability")): node["node_id"]
        for node in nodes if node.get("node_kind") == "capability"
    }
    for spec in EXECUTABLE_SPECS[family]:
        token = spec["token"]
        operation = spec["operation"]
        decision = _node(
            family, "decision", token,
            f"Invoke {operation} for the source-defined {token} settlement",
            all_spans,
            implementation={
                "adapter": "subsystem-command",
                "kind": spec.get("command_kind", operation),
                "phase": "resolve",
                "payload_constants": {},
                "payload_slots": [
                    {
                        "name": name,
                        "ownership": ownership,
                        **({"optional": True} if name in spec.get("optional_slots", set()) else {}),
                    }
                    for name, ownership in spec["slots"]
                ],
            },
        )
        nodes.append(decision)
        if spec.get("condition") is not None:
            condition = _node(
                family, "condition", f"{token}-applicable",
                f"Applicability for {operation}", all_spans,
                expression=spec["condition"],
            )
            condition["hard_gate"] = bool(spec.get("hard_gate", False))
            nodes.append(condition)
            relations.append({
                "relation_id": f"relation:coc7:{family}:{token}:available-when",
                "relation_kind": "available-when",
                "from_node_id": decision["node_id"],
                "to_node_id": condition["node_id"],
                "evidence_span_ids": all_spans,
            })
        capability_id = capability_ids[operation]
        relations.append({
            "relation_id": f"relation:coc7:{family}:{token}:invokes",
            "relation_kind": "invokes",
            "from_node_id": decision["node_id"],
            "to_node_id": capability_id,
            "evidence_span_ids": all_spans,
        })
        for name, ownership in spec["slots"]:
            slot_id = f"input-slot:coc7:{family}:{name.replace('_', '-')}"
            slot = next(
                (node for node in nodes if node.get("node_id") == slot_id),
                None,
            )
            if slot is None:
                value_type = (
                    "enum"
                    if (family == "chase" and name in {"method", "outcome"})
                    or (family == "magic" and name == "source")
                    else "semantic"
                    if ownership in {
                        "keeper-semantic", "player-source", "optional-semantic",
                    }
                    else "canonical"
                )
                slot_name = (
                    "Typed operation input method enum negotiate|break"
                    if family == "chase" and name == "method"
                    else "Typed operation input outcome enum escaped|captured|concluded"
                    if family == "chase" and name == "outcome"
                    else "Typed operation input source enum tome|person|entity"
                    if family == "magic" and name == "source"
                    else f"Typed operation input {name}"
                )
                slot = _node(
                    family, "input-slot", name.replace('_', '-'),
                    slot_name, all_spans,
                    ownership=ownership,
                    value_type=value_type,
                    path=f"typed.{name}",
                )
                nodes.append(slot)
            elif (slot.get("properties") or {}).get("ownership") != ownership:
                raise ValueError(
                    f"conflicting ownership for {slot_id}: "
                    f"{(slot.get('properties') or {}).get('ownership')} != {ownership}"
                )
            relations.append({
                "relation_id": f"relation:coc7:{family}:{token}:requires-{name.replace('_', '-')}",
                "relation_kind": "requires-input" if ownership != "host-locked" else "locks-input",
                "from_node_id": decision["node_id"],
                "to_node_id": slot["node_id"],
                "evidence_span_ids": all_spans,
            })
        for effect_name, resource in spec["effects"]:
            effect = _node(
                family, "effect", f"{token}-{effect_name}",
                f"{operation} emits {effect_name}", all_spans,
                effect_kind=effect_name,
                **({} if resource is None else {"resource_key": resource}),
            )
            nodes.append(effect)
            relations.append({
                "relation_id": f"relation:coc7:{family}:{token}:emits-{effect_name}",
                "relation_kind": "emits",
                "from_node_id": decision["node_id"],
                "to_node_id": effect["node_id"],
                "evidence_span_ids": all_spans,
            })


def build_candidate(packet: dict[str, Any], family: str) -> dict[str, Any]:
    spec = SPECS[family]
    all_spans = sorted(span["span_id"] for span in packet["evidence_view"]["spans"])
    family_node = {
        "node_id": f"rule-family:coc7:{family}",
        "node_kind": "rule-family",
        "name": f"Complete source review for {family}",
        "authority": "deterministic",
        "audience": "keeper",
        "visibility": "keeper-only",
        "hard_gate": False,
        "properties": {"family_id": family, "runtime_ownership": "legacy", "legacy_surface": "visible"},
        "evidence_span_ids": all_spans,
    }
    nodes = [family_node]
    relations: list[dict[str, Any]] = []
    for token, name, needles in spec["rules"]:
        spans = _spans(packet, needles)
        node = _node(family, "rule", token, name, spans)
        nodes.append(node)
        relations.append({
            "relation_id": f"relation:coc7:{family}:{token}:part-of-family",
            "relation_kind": "part-of",
            "from_node_id": node["node_id"],
            "to_node_id": family_node["node_id"],
            "evidence_span_ids": spans,
        })
    for token, name, needles in spec["exceptions"]:
        spans = _spans(packet, needles)
        node = _node(family, "exception", token, name, spans)
        nodes.append(node)
        relations.append({
            "relation_id": f"relation:coc7:{family}:{token}:applies-to-family",
            "relation_kind": "applies-to",
            "from_node_id": node["node_id"],
            "to_node_id": family_node["node_id"],
            "evidence_span_ids": spans,
        })
    subsystem = _node(
        family, "subsystem", "runtime", f"Existing {family} runtime subsystem",
        all_spans, subsystem_kind=family,
    )
    nodes.append(subsystem)
    relations.append({
        "relation_id": f"relation:coc7:{family}:family-implemented-by-subsystem",
        "relation_kind": "implemented-by",
        "from_node_id": family_node["node_id"],
        "to_node_id": subsystem["node_id"],
        "evidence_span_ids": all_spans,
    })
    for index, capability in enumerate(spec["capabilities"], start=1):
        token = capability.replace(".", "-").replace("_", "-")
        node = _node(
            family, "capability", token, capability, all_spans,
            resolver_capability=capability, adapter="subsystem-command",
        )
        nodes.append(node)
        relations.append({
            "relation_id": f"relation:coc7:{family}:subsystem-invokes-{index}",
            "relation_kind": "invokes",
            "from_node_id": subsystem["node_id"],
            "to_node_id": node["node_id"],
            "evidence_span_ids": all_spans,
        })
    for index, table in enumerate(spec["tables"], start=1):
        node = _node(
            family, "data-table", f"table-{index}", table, all_spans,
            table_name=table,
        )
        nodes.append(node)
        relations.append({
            "relation_id": f"relation:coc7:{family}:subsystem-reads-table-{index}",
            "relation_kind": "reads-table",
            "from_node_id": subsystem["node_id"],
            "to_node_id": node["node_id"],
            "evidence_span_ids": all_spans,
        })
    _add_executable_graph(family, all_spans, nodes, relations)
    candidate = {
        "contract_id": rg.CANDIDATE_CONTRACT_ID,
        "schema_version": 1,
        "ruleset_id": "coc7",
        "family_id": family,
        "section_id": packet["section_id"],
        "source_language": "en",
        "coverage": {family: spec["coverage"]},
        "nodes": nodes,
        "relations": relations,
    }
    findings = rg._validate_candidate(candidate, packet)
    if findings:
        raise ValueError(findings)
    return candidate


def build_family(bundle_root: Path, family: str, evidence_root: Path) -> dict[str, Any]:
    packet = prepare_family(bundle_root, family)
    candidate = build_candidate(packet, family)
    rg.clear_accepted_session()
    accepted = rg.accept(packet, candidate, evidence_root=evidence_root)
    if not accepted.get("ok"):
        raise ValueError(accepted.get("findings"))
    spec = SPECS[family]
    manifests = [_bundle_manifest(bundle_root, name) for name in spec["bundles"]]
    provenance = {
        "contract_id": "coc.rule-graph-family-source-review.v1",
        "schema_version": 1,
        "family_id": family,
        "section_id": spec["section"],
        "reviewer_identity": spec["reviewer"],
        "review_status": "accepted" if spec["coverage"] == "accepted" else "revision-required",
        "coverage": {family: spec["coverage"]},
        "unresolved_applicable_rules": list(spec["unresolved"]),
        "blockers": list(spec["blockers"]),
        "executable_review_status": "accepted",
        "executable_operations": [row["operation"] for row in EXECUTABLE_SPECS[family]],
        "unresolved_executable_rules": [],
        "visual_review": {
            "pdf_file_sha256": FILE_SHA256,
            "contact_sheet": f"/private/tmp/pi-coc-rule-families-20260831/visual-review/{'chase' if family == 'chase' else 'magic-core'}-contact.jpg" if family != "development" else None,
        },
        "source_bundles": [{
            "bundle_id": name,
            "bundle_sha256": manifest["bundle_sha256"],
            "file_sha256": manifest["source"]["file_sha256"],
            "pages": [{
                "pdf_index": page["pdf_index"],
                "text_sha256": page["text_sha256"],
                "review_state": page["review_state"],
                "parse_confidence": page["parse_confidence"],
            } for page in manifest["pages"]],
        } for name, manifest in zip(spec["bundles"], manifests, strict=True)],
        "accepted_shard_digest": accepted["shard"]["receipt"]["shard_sha256"],
    }
    return {"packet": packet, "candidate": candidate, "shard": accepted["shard"], "provenance": provenance}


def build_all(bundle_root: Path) -> dict[str, dict[str, Any]]:
    with tempfile.TemporaryDirectory(prefix="rule-family-evidence-") as raw:
        evidence_root = Path(raw)
        return {
            family: build_family(bundle_root, family, evidence_root)
            for family in ("development", "chase", "magic")
        }


def write_all(built: dict[str, dict[str, Any]], output: Path = OUTPUT) -> None:
    for family, row in built.items():
        root = output / family
        (root / "candidates").mkdir(parents=True, exist_ok=True)
        (root / "provenance").mkdir(parents=True, exist_ok=True)
        (root / "accepted").mkdir(parents=True, exist_ok=True)
        (root / "candidates" / f"{family}.candidate.json").write_bytes(_canonical_bytes(row["candidate"]))
        (root / "provenance" / f"{family}.provenance.json").write_bytes(_canonical_bytes(row["provenance"]))
        (root / "accepted" / f"{family}.accepted-shard.json").write_bytes(_canonical_bytes(row["shard"]))


def main() -> None:
    raw = os.environ.get(BUNDLE_ROOT_ENV)
    if not raw:
        raise SystemExit(f"set {BUNDLE_ROOT_ENV}")
    bundle_root = Path(raw).expanduser().resolve()
    built = build_all(bundle_root)
    write_all(built)
    for family, row in built.items():
        print(f"{family}: {row['candidate']['coverage'][family]} {row['shard']['receipt']['shard_sha256']}")


if __name__ == "__main__":
    main()
