---
name: coc-rules-engine
description: Resolve structured Call of Cthulhu rules in ZCode. Use for skill checks, success levels, half/fifth values, bonus or penalty dice, damage bonus, build, sanity thresholds, and rules parameter inspection.
---

# COC Rules Engine

## Rule Authority

Load `../../references/rules-json-guide.md` when explaining rule data. Use `../../references/rules-json/` as the runtime authority for common calculations.

Do not use ad hoc PDF lookup for frequent V1 calculations when a JSON table exists.

## Scripts

Use these scripts for deterministic rule work:

- `../../scripts/coc_rules.py`
- `../../scripts/coc_roll.py` — call `public_api_index()` when unsure which
  helper name to use. `roll_percentile(...)` is a supported alias for
  `percentile_check(...)`; use `format_percentile_result(...)` for
  player-facing bonus/penalty dice summaries.
- `../../scripts/coc_validate.py`

## Output

For in-game narration, keep mechanical details short. For `[meta]` answers, show:

- target value
- effective difficulty
- bonus and penalty dice
- bonus/penalty dice components: units die, all tens dice, selected tens die
- roll
- outcome
- source table or reference when available
