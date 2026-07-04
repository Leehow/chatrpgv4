#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from pathlib import Path


REQUIRED_RULE_FILES = [
    "metadata.json",
    "age-adjustments.json",
    "damage-bonus-build.json",
    "half-fifth-values.json",
    "movement-rate.json",
    "percentile-check.json",
    "success-levels.json",
    "difficulty-levels.json",
    "sanity.json",
]

REQUIRED_CAMPAIGN_DIRS = [
    "save",
    "scenario",
    "index",
    "memory",
    "logs",
    "snapshots",
]


def validate_rules(plugin_root: Path) -> list[str]:
    errors: list[str] = []
    rules_dir = plugin_root / "references" / "rules-json"
    if not rules_dir.exists():
        return [f"missing rules directory: {rules_dir}"]

    for filename in REQUIRED_RULE_FILES:
        path = rules_dir / filename
        if not path.exists():
            errors.append(f"missing rule file: {filename}")
            continue
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            errors.append(f"invalid json in {filename}: {exc}")
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
