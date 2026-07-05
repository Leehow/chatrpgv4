#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


REQUIRED_RULE_FILES = [
    "metadata.json",
    "rule-index.json",
    "age-adjustments.json",
    "cash-assets.json",
    "chase.json",
    "characteristic-dice.json",
    "combat.json",
    "damage.json",
    "damage-bonus-build.json",
    "derived-attributes.json",
    "difficulty-levels.json",
    "half-fifth-values.json",
    "movement-rate.json",
    "percentile-check.json",
    "pushed-roll.json",
    "reward.json",
    "roll-modifiers.json",
    "skills.json",
    "occupations.json",
    "spells.json",
    "tomes.json",
    "success-levels.json",
    "sanity.json",
    "the-haunting.json",
    "weapons.json",
    "monsters.json",
    "bout-tables.json",
    "phobias.json",
    "manias.json",
    "equipment.json",
    "poisons.json",
    "artifacts.json",
]

REQUIRED_CAMPAIGN_DIRS = [
    "save",
    "scenario",
    "index",
    "memory",
    "logs",
    "snapshots",
]

RULE_INDEX_ID_PATTERN = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")


def validate_rules(plugin_root: Path) -> list[str]:
    errors: list[str] = []
    rules_dir = plugin_root / "references" / "rules-json"
    if not rules_dir.exists():
        return [f"missing rules directory: {rules_dir}"]

    parsed_rule_files: dict[str, object] = {}
    for filename in REQUIRED_RULE_FILES:
        path = rules_dir / filename
        if not path.exists():
            errors.append(f"missing rule file: {filename}")
            continue
        try:
            parsed_rule_files[filename] = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            errors.append(f"invalid json in {filename}: {exc}")

    rule_index = parsed_rule_files.get("rule-index.json")
    if isinstance(rule_index, dict):
        rules = rule_index.get("rules")
        if isinstance(rules, list):
            indexed_source_tables: set[str] = set()
            indexed_rule_ids: set[str] = set()
            for rule in rules:
                if not isinstance(rule, dict):
                    continue
                raw_rule_id = rule.get("id")
                rule_id = raw_rule_id if isinstance(raw_rule_id, str) else "<unknown>"
                if not isinstance(raw_rule_id, str) or RULE_INDEX_ID_PATTERN.fullmatch(raw_rule_id) is None:
                    errors.append(f"invalid rule-index id: {rule_id}")
                if isinstance(raw_rule_id, str):
                    if raw_rule_id in indexed_rule_ids:
                        errors.append(f"duplicate rule-index id: {raw_rule_id}")
                    indexed_rule_ids.add(raw_rule_id)
                source_table = rule.get("source_table")
                if not isinstance(source_table, str):
                    continue
                indexed_source_tables.add(source_table)
                if not (rules_dir / source_table).exists():
                    errors.append(f"rule-index source_table missing: {rule_id} -> {source_table}")
            for filename in REQUIRED_RULE_FILES:
                if filename in {"metadata.json", "rule-index.json"}:
                    continue
                if filename not in indexed_source_tables:
                    errors.append(f"rule-index missing source_table entry: {filename}")
    return errors


def validate_campaign(campaign_dir: Path) -> list[str]:
    errors: list[str] = []
    if not (campaign_dir / "campaign.json").exists():
        errors.append("missing campaign.json")
    for directory in REQUIRED_CAMPAIGN_DIRS:
        if not (campaign_dir / directory).is_dir():
            errors.append(f"missing campaign directory: {directory}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("kind", choices=["rules", "campaign"])
    parser.add_argument("path")
    args = parser.parse_args()

    target = Path(args.path)
    errors = validate_rules(target) if args.kind == "rules" else validate_campaign(target)
    for error in errors:
        print(error)
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
