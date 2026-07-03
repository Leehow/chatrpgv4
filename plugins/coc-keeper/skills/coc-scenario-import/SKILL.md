---
name: coc-scenario-import
description: Import and index authored Call of Cthulhu scenarios for COC mode. Use for rulebook scenarios, external module PDFs, scenario skeletons, source maps, Keeper-only separation, and on-demand PDF lookup.
---

# COC Scenario Import

## Import Model

Use a hybrid import strategy:

1. Preparse scenario structure into JSON skeletons.
2. Record source PDF paths and page ranges in indexes.
3. During play, look up detailed PDF material only when needed.

## Scripts

Use `../../scripts/coc_scenario.py` for:

- PDF cataloging
- page counts and metadata
- scenario skeleton files
- `index/source-map.json`

## Spoiler Split

Keep player-safe summaries separate from Keeper-only material. Never reveal `keeper-secrets.json` content without `[spoiler_warning]` and confirmation.
