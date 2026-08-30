#!/usr/bin/env python3
"""Generate source-bound RuleGraph stage-1 prepared candidates.

The external bundle root is supplied through
``COC_RULE_GRAPH_SOURCE_BUNDLE_ROOT`` and is never committed. This generator
uses the canonical RuleGraph ``prepare`` interface, rebinds the previously
reviewed derivative candidate shapes to real rulebook spans, and validates
them without calling ``accept`` or ``build``. Independent semantic review is
still required.
"""
from __future__ import annotations

import copy
import json
import os
import sys
from pathlib import Path
from typing import Any, Mapping


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "plugins" / "coc-keeper" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import coc_rule_graph as rg  # noqa: E402


BUNDLE_ROOT_ENV = "COC_RULE_GRAPH_SOURCE_BUNDLE_ROOT"
SOURCE_ID = "pdf:coc7-keeper-rulebook-40th"
FILE_SHA256 = "a860499cf34b40cac385f51b6e667ab37ec0796c7329494def08c8b161fd71eb"
DERIVATIVE = (
    ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7"
    / "rule-graph-candidates" / "stage1" / "candidates"
)
OUTPUT = (
    ROOT / "plugins" / "coc-keeper" / "rulesets" / "coc7"
    / "rule-graph-candidates" / "source-stage1"
)


SECTIONS = (
    {
        "name": "checks-push-luck-source",
        "source_candidate": "section-checks-push-luck.candidate.json",
        "bundle": "core-social-psychology-v1",
        "family_id": "core-check",
        "families": ["core-check", "push-luck"],
        "pages": [93, 94, 95, 97, 100, 101, 102, 103, 104, 105, 110],
    },
    {
        "name": "interpersonal-skills-source",
        "source_candidate": "section-interpersonal-skills.candidate.json",
        "bundle": "core-social-psychology-v1",
        "family_id": "social",
        "families": ["social"],
        "pages": [70, 71, 75, 77, 82, 83, 84, 93, 94, 104, 208, 215],
    },
    {
        "name": "psychology-observation-source",
        "source_candidate": "section-psychology-observation.candidate.json",
        "bundle": "core-social-psychology-v1",
        "family_id": "psychology",
        "families": ["psychology"],
        "pages": [83, 84, 215],
    },
    {
        "name": "non-session-damage-source",
        "source_candidate": "section-non-session-damage.candidate.json",
        "bundle": "damage-sanity-v1",
        "family_id": "combat",
        "families": ["combat"],
        "pages": [113, 114],
    },
    {
        "name": "sourced-thresholds-source",
        "source_candidate": "section-sourced-thresholds.candidate.json",
        "bundle": "damage-sanity-v1",
        "family_id": "sanity",
        "families": ["sanity"],
        "pages": [165, 166, 167, 168, 169, 170],
    },
    {
        "name": "reference-lookups-source",
        "source_candidate": "section-reference-lookups.candidate.json",
        "bundles": [
            {
                "name": "skill-prose-v1",
                "pages": [
                    69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80,
                    81, 82, 83, 84, 86, 87, 88, 89, 90,
                ],
            },
            {
                "name": "reference-tables-v2",
                "pages": [
                    56, 57, 58, 290, 291, 408, 409, 410, 411, 412,
                    413, 414, 415, 416, 417,
                ],
            },
        ],
        "family_id": "development",
        "families": ["development"],
    },
)


PHRASES = {
    "core-check": (
        "Skill Rolls",
        "three levels of difficulty",
        "Rolling the Dice: Success or Failure",
        "Fumbles and Criticals",
        "A skill roll can yield one of six results",
        "Bonus Dice and Penalty Dice",
        "One bonus die and one penalty die cancel",
    ),
    "push-luck": (
        "Pushing a skill roll provides",
        "Pushed Roll: Success",
        "Pushed Roll: Failure",
        "Fumbles should take effect immediately",
        "Luck rolls may be called",
        "Group Luck roll",
        "Spending Luck",
        "Luck points may not be spent",
        "push the roll OR spend luck",
    ),
    "social": (
        "Charm (15%)",
        "Interpersonal Skills: Disambiguation",
        "Fast Talk (05%)",
        "Intimidate (15%)",
        "Persuade (10%)",
        "Charm, Fast Talk, Intimidate, and Persuade Skills: Difficulty Levels",
        "Verbal Conflicts",
        "player's intention defines the goal",
    ),
    "psychology": (
        "Psychology (10%)",
        "announce only the information",
        "Psychology can be used to oppose all forms of social interaction",
        "If a player passes a Psychology roll",
        "truth should be revealed",
        "information is reliable",
    ),
    "combat": (
        "how much damage is inflicted",
        "Determining Damage",
        "inflicts damage",
    ),
    "sanity": (
        "Sanity Points and SAN Rolls",
        "involuntary action",
        "Maximum Sanity",
        "Temporary Insanity",
        "Indefinite Insanity",
        "A Bout of Madness—Real Time",
        "A Bout of Madness—Summary",
        "Bouts of Madness—Summary",
    ),
    "development": (
        "Archaeology (01%)",
        "Interpersonal Skills: Disambiguation",
        "Credit Rating (0%)",
        "First Aid (30%)",
        "Psychology (10%)",
        "Spot Hidden (25%)",
        "Optional Rules",
        "Cash and Assets",
        "Living Standards",
        "Table XV: Comparative Builds",
        "Quick-reference Build comparison",
        "Transport",
        "Communications",
        "Modern Day",
        "Ammunition & Weapons",
        "Table XVII: Weapons",
        "Handguns (i)*",
        "Rifles (i)",
        "Assault Rifles (i)",
        "Explosives, Heavy Weapons, Misc.",
        "Bullets in Gun (Magazine)",
    ),
}


NAME_OVERRIDES = {
    "exception:coc7:push-luck:fumble-push-uncompiled": (
        "Source states that a fumble takes effect immediately and may not be "
        "negated by pushing; the candidate executor must enforce this"
    ),
    "exception:coc7:social:higher-of-composition-uncompiled": (
        "Source uses the higher of the matching interpersonal skill or "
        "Psychology for opposition; this composition remains executor-uncompiled"
    ),
    "rule:coc7:psychology:concealed-observation": (
        "A concealed Psychology roll reveals truth on success; after failure "
        "the Keeper may give information whose reliability is unknown"
    ),
    "exception:coc7:psychology:truth-mapping-uncompiled": (
        "The source-backed truth-on-success and unreliable-on-failure disposition "
        "is not yet compiled by the player-safe realization adapter"
    ),
    "exception:coc7:sanity:check-then-loss-uncompiled": (
        "The source-backed SAN percentile check, success/failure loss selection, "
        "and floor-zero composition remain executor-uncompiled"
    ),
    "exception:coc7:sanity:session-engine-uncompiled": (
        "The source-backed INT test, permanent-insanity boundary, and insanity "
        "phase state machine remain executor-uncompiled"
    ),
    "rule-family:coc7:development": (
        "Rulebook-backed skill, equipment, build, and cash reference windows; "
        "runtime lookup bindings remain candidate-only"
    ),
    "rule:coc7:development:skill-catalog": (
        "The rulebook defines skill prose and base values; their compiled JSON "
        "mapping remains revision-required"
    ),
    "rule:coc7:development:catalog-candidate-recall": (
        "Rulebook pages support the reference content; advisory catalog recall "
        "and secret-row handling remain runtime policy under separate review"
    ),
}


def _read(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"


def _node_family(node: Mapping[str, Any]) -> str | None:
    properties = node.get("properties")
    if isinstance(properties, Mapping) and isinstance(properties.get("family_id"), str):
        return str(properties["family_id"])
    parts = str(node.get("node_id") or "").split(":")
    return parts[2] if len(parts) >= 3 and parts[1] == "coc7" else None


def _span_ids(packet: Mapping[str, Any], family: str) -> list[str]:
    phrases = PHRASES[family]
    rows = []
    for span in (packet.get("evidence_view") or {}).get("spans") or []:
        text = str(span.get("text") or "")
        if any(phrase.casefold() in text.casefold() for phrase in phrases):
            rows.append(str(span["span_id"]))
    if not rows:
        raise ValueError(f"no source spans selected for family {family}")
    return sorted(set(rows))


def _bundle_specs(spec: Mapping[str, Any]) -> tuple[dict[str, Any], ...]:
    bundles = spec.get("bundles")
    if bundles is None:
        return ({"name": str(spec["bundle"]), "pages": list(spec["pages"])},)
    return tuple({"name": str(row["name"]), "pages": list(row["pages"])} for row in bundles)


def prepare_packet(bundle_root: Path, spec: Mapping[str, Any]) -> dict[str, Any]:
    bundles = _bundle_specs(spec)
    result = rg.prepare({
        "ruleset_id": "coc7",
        "ruleset_version": "1.0.0",
        "source_language": "en",
        "family_id": spec["family_id"],
        "section_id": f"section-{spec['name']}",
        "bundle_dirs": [str(bundle_root / row["name"]) for row in bundles],
        "page_keys": [
            (SOURCE_ID, index)
            for row in bundles
            for index in row["pages"]
        ],
        "known_nodes": [],
        "output_budget": {"max_nodes": 500, "max_relations": 700},
        "families": list(spec["families"]),
    })
    if not result.get("ok"):
        raise ValueError(result.get("findings"))
    return result["shard"]


def rebind_candidate(packet: dict[str, Any], spec: Mapping[str, Any]) -> dict[str, Any]:
    candidate = copy.deepcopy(_read(DERIVATIVE / str(spec["source_candidate"])))
    candidate["section_id"] = f"section-{spec['name']}"
    evidence_families = {
        family
        for node in candidate["nodes"]
        if (family := _node_family(node)) in PHRASES
    }
    family_spans = {
        family: _span_ids(packet, family) for family in sorted(evidence_families)
    }
    all_spans = sorted({span for rows in family_spans.values() for span in rows})
    node_family: dict[str, str | None] = {}
    for node in candidate["nodes"]:
        family = _node_family(node)
        node_family[str(node["node_id"])] = family
        node["evidence_span_ids"] = list(family_spans.get(family, all_spans))
        override = NAME_OVERRIDES.get(str(node["node_id"]))
        if override:
            node["name"] = override
    for relation in candidate["relations"]:
        families = {
            node_family.get(str(relation.get("from_node_id") or "")),
            node_family.get(str(relation.get("to_node_id") or "")),
        } - {None}
        relation["evidence_span_ids"] = sorted({
            span
            for family in families
            for span in family_spans.get(str(family), all_spans)
        }) or list(all_spans)
    findings = rg._validate_candidate(candidate, packet)
    if findings:
        raise ValueError(findings)
    return candidate


def build_tree(bundle_root: Path) -> dict[str, Any]:
    candidates: list[dict[str, Any]] = []
    provenance: list[dict[str, Any]] = []
    packets: list[dict[str, Any]] = []
    for spec in SECTIONS:
        packet = prepare_packet(bundle_root, spec)
        candidate = rebind_candidate(packet, spec)
        packets.append(packet)
        candidates.append(candidate)
        source_bundles = []
        for bundle_spec in _bundle_specs(spec):
            manifest = _read(
                bundle_root / bundle_spec["name"] / "normalized-source.json"
            )
            page_rows = {
                int(row["pdf_index"]): row for row in manifest["pages"]
            }
            source_bundles.append({
                "bundle_id": bundle_spec["name"],
                "bundle_sha256": manifest["bundle_sha256"],
                "pages": [
                    {
                        "pdf_index": index,
                        "text_sha256": page_rows[index]["text_sha256"],
                        "review_state": page_rows[index]["review_state"],
                        "parse_confidence": page_rows[index]["parse_confidence"],
                    }
                    for index in bundle_spec["pages"]
                ],
            })
        provenance.append({
            "section_id": candidate["section_id"],
            "families": list(spec["families"]),
            "coverage": copy.deepcopy(candidate["coverage"]),
            "source": {
                "source_id": SOURCE_ID,
                "file_sha256": FILE_SHA256,
                "bundles": source_bundles,
            },
            "span_count": len(packet["evidence_binding"]["spans"]),
            "node_count": len(candidate["nodes"]),
            "relation_count": len(candidate["relations"]),
        })

    coverage = {family: "unresolved" for family in sorted(rg.RULE_FAMILIES)}
    for candidate in candidates:
        coverage.update(candidate["coverage"])
    dependencies = sorted({
        str((node.get("properties") or {}).get("table_name"))
        for candidate in candidates for node in candidate["nodes"]
        if node.get("node_kind") == "data-table"
        and (node.get("properties") or {}).get("table_name")
    })
    capabilities = sorted({
        str((node.get("properties") or {}).get("resolver_capability"))
        for candidate in candidates for node in candidate["nodes"]
        if node.get("node_kind") == "capability"
        and (node.get("properties") or {}).get("resolver_capability")
    })
    source_bundles = []
    bundle_names = {
        bundle_spec["name"]
        for spec in SECTIONS
        for bundle_spec in _bundle_specs(spec)
    }
    for bundle_name in sorted(bundle_names):
        manifest = _read(bundle_root / bundle_name / "normalized-source.json")
        source_bundles.append({
            "source_id": SOURCE_ID,
            "bundle_sha256": manifest["bundle_sha256"],
            "file_sha256": FILE_SHA256,
        })
    promotion = {
        family: {"promotion_eligible": False, "runtime_ownership": "legacy"}
        for family in sorted(rg.RULE_FAMILIES)
    }
    promotion["healing"] = {
        "promotion_eligible": False,
        "runtime_ownership": "shadow",
    }
    manifest = {
        "contract_id": rg.BUILD_MANIFEST_CONTRACT_ID,
        "schema_version": 1,
        "ruleset_id": "coc7",
        "ruleset_version": "1.0.0",
        "source_bundles": source_bundles,
        "graph_content_digest": None,
        "shards": [
            {
                "shard_id": (
                    f"shard:coc7:{candidate['family_id']}:"
                    f"{candidate['section_id']}"
                ),
                "shard_digest": None,
            }
            for candidate in candidates
        ],
        "family_coverage": coverage,
        "family_promotion_eligibility": promotion,
        "data_table_dependencies": dependencies,
        "resolver_capability_dependencies": capabilities,
        "compiler_identity": rg.CONTRACT["compiler_identity"],
        "reviewer_identity": None,
        "review_status": "revision-required",
        "findings": [
            {
                "code": "independent_source_review_required",
                "path": f"/{candidate['section_id']}",
                "message": (
                    "Candidate is bound to visually reviewed rulebook pages but "
                    "has not received independent semantic acceptance"
                ),
            }
            for candidate in candidates
        ] + [
            {
                "code": "source_extraction_gap",
                "path": "/source/pdf-index-85",
                "message": (
                    "Full-page skill-chapter art was visually reviewed but has "
                    "no text to bind and is excluded from the source packet"
                ),
            },
            {
                "code": "runtime_policy_review_required",
                "path": "/section-reference-lookups-source",
                "message": (
                    "Rulebook pages support underlying reference content; "
                    "lookup, advisory, and secrecy adapter semantics remain "
                    "candidate policy requiring independent review"
                ),
            },
        ],
    }
    return {
        "packets": packets,
        "candidates": candidates,
        "provenance": provenance,
        "manifest": manifest,
    }


def write_tree(tree: Mapping[str, Any], output: Path = OUTPUT) -> None:
    (output / "candidates").mkdir(parents=True, exist_ok=True)
    (output / "provenance").mkdir(parents=True, exist_ok=True)
    for candidate, provenance in zip(
        tree["candidates"], tree["provenance"], strict=True,
    ):
        name = str(candidate["section_id"])
        (output / "candidates" / f"{name}.candidate.json").write_bytes(
            _canonical_bytes(candidate)
        )
        (output / "provenance" / f"{name}.provenance.json").write_bytes(
            _canonical_bytes(provenance)
        )
    (output / "manifest-draft.json").write_bytes(
        _canonical_bytes(tree["manifest"])
    )


def main() -> None:
    raw_root = os.environ.get(BUNDLE_ROOT_ENV)
    if not raw_root:
        raise SystemExit(f"{BUNDLE_ROOT_ENV} is required")
    bundle_root = Path(raw_root).expanduser().resolve()
    tree = build_tree(bundle_root)
    write_tree(tree)
    print(json.dumps({
        "output": str(OUTPUT.relative_to(ROOT)),
        "sections": len(tree["candidates"]),
        "nodes": sum(len(row["nodes"]) for row in tree["candidates"]),
        "relations": sum(len(row["relations"]) for row in tree["candidates"]),
        "review_status": tree["manifest"]["review_status"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
