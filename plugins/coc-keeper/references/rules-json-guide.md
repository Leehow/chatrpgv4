# Rules JSON Guide

## Authority

Frequent COC calculations use structured JSON and Python scripts as runtime authority. PDFs remain source and reference material, not the first stop for common checks.

## V1 Rule Files

`references/rules-json/` contains:

- `metadata.json`
- `damage-bonus-build.json`
- `difficulty-levels.json`
- `success-levels.json`
- `sanity.json`

## Script Entry Points

Use:

- `scripts/coc_rules.py` for thresholds, success levels, damage bonus, and build.
- `scripts/coc_roll.py` for dice expressions and percentile checks.
- `scripts/coc_validate.py` to verify rule files exist and parse as JSON.

## Expansion Rules

Add new rule files only when a subsystem needs deterministic data. Keep keys ASCII English. Include source notes when a table is extracted from a PDF.

## Meta Answers

When explaining a rule in `[meta]`, show target value, effective difficulty, dice modifiers, result, and the JSON table used when relevant.
