---
name: coc-keeper
description: >-
  Thin Cursor entry for COC Keeper. Use after the user explicitly activates COC
  mode (e.g. "Activate COC mode", "进入 COC 模式"). Routes to the canonical
  skills under plugins/coc-keeper/skills/ — do not copy or fork that tree.
  Portrait generation is Codex-only; skip imagegen on Cursor.
---

# COC Keeper (Cursor thin entry)

This file is a **host adapter only**. All keeper behavior lives in the single
canonical plugin tree:

```text
plugins/coc-keeper/skills/
```

Do not create a parallel skill copy under `.cursor/skills/` or elsewhere.

## Passive activation

COC mode is passive. Load keeper skills only after explicit user activation.
See `plugins/coc-keeper/references/AGENTS-coc-mode-template.md`.

## Skill routing

After activation, read and follow these canonical skills (same tree Codex uses):

1. `plugins/coc-keeper/skills/coc-main/SKILL.md`
2. `plugins/coc-keeper/references/mode-protocol.md`
3. Then route to `coc-campaign-state`, `coc-character`, `coc-scenario-import`,
   `coc-keeper-play`, `coc-meta`, `coc-combat`, `coc-chase`, `coc-sanity`,
   and other skills under `plugins/coc-keeper/skills/` as needed.

Runtime scripts and rules JSON also stay under `plugins/coc-keeper/`
(`scripts/`, `references/`).

## Platform gating

Investigator portrait generation is **Codex-only**. It is gated inside
`CODEX_ONLY_IMAGEGEN` markers in
`plugins/coc-keeper/skills/coc-character/SKILL.md`. On Cursor (and Claude Code),
**skip portrait generation** and continue with the rest of character creation.

## Plugin install alternative

When installing COC Keeper as a Cursor plugin (not just using this repo), the
manifest at `plugins/coc-keeper/.cursor-plugin/plugin.json` points
`"skills": "./skills/"` at the same canonical tree.
