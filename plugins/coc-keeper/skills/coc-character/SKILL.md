---
name: coc-character
description: Create and maintain reusable Call of Cthulhu investigators. Use for full guided investigator creation, quick generation, derived values, age modifiers, validation, development, and cross-campaign character history.
---

# COC Character

## Character Storage

Reusable investigators live under `.coc/investigators/<investigator-id>/`. Campaigns link to investigators instead of owning them.

Temporary campaign-specific investigator state lives under `.coc/campaigns/<campaign-id>/save/investigator-state/`.

## Workflows

- Full guided creation: characteristics, age, occupation, skills, backstory, equipment, derived values.
- Quick creation: ask for a concept, generate a valid investigator, then ask for confirmation.
- Import: validate JSON before linking it to a campaign.
- Development: write permanent changes back to investigator history only at explicit development or campaign-ending moments.

## Scripts

Use `../../scripts/coc_character.py` for derived values and validation. Use `../../scripts/coc_state.py` to create or link investigator files.
