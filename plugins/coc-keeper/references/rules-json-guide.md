# Rules JSON Guide

## Authority

Frequent COC calculations use structured JSON and Python scripts as runtime authority. PDFs remain source and reference material, not the first stop for common checks.

## V1 Rule Files

`references/rules-json/` contains:

- `metadata.json`
- `rule-index.json`
- `age-adjustments.json`
- `cash-assets.json`
- `chase.json`
- `damage.json`
- `damage-bonus-build.json`
- `derived-attributes.json`
- `difficulty-levels.json`
- `half-fifth-values.json`
- `movement-rate.json`
- `percentile-check.json`
- `pushed-roll.json`
- `reward.json`
- `roll-modifiers.json`
- `sanity.json`
- `success-levels.json`

`rule-index.json` is the stable traceability index for playtest logs. Campaign `logs/rolls.jsonl` and `logs/events.jsonl` should use payload `rule_refs` containing ids such as `core.percentile_check` or `module.haunting.corbitt_flesh_ward`; those ids must resolve to records in `rule-index.json`.

## Script Entry Points

Use:

- `scripts/coc_rules.py` for percentile bounds, pushed-roll procedure, chase movement actions and pushed-roll boundaries, damage/reward log requirements, bonus/penalty dice, thresholds, success levels, damage bonus, build, half/fifth values, movement rate, and age adjustments.
- `scripts/coc_rules.py` also exposes `rule_ids()` and `resolve_rule_refs()` for `rule_refs` validation.
- `scripts/coc_roll.py` for dice expressions and percentile checks.
- `scripts/coc_validate.py` to verify rule files exist and parse as JSON.

## Expansion Rules

Add new rule files only when a subsystem needs deterministic data. Keep keys ASCII English. Include source notes when a table is extracted from a PDF.

## Meta Answers

When explaining a rule in `[meta]`, show target value, effective difficulty, dice modifiers, result, and the JSON table used when relevant.
