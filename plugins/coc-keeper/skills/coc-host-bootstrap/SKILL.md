---
name: coc-host-bootstrap
description: >-
  Passive host bootstrap for the canonical COC Keeper plugin. Use only to route
  explicit COC activation into the canonical coc-main skill tree.
---

# COC Keeper host bootstrap

This is a passive router, not a second Keeper implementation. Do not start a
campaign, roll dice, mutate state, or narrate a turn from this skill alone.

When the user explicitly activates COC mode, load the canonical skill tree in
this order:

1. `skills/coc-main/SKILL.md`
2. `references/mode-protocol.md`
3. `skills/coc-keeper-play/SKILL.md`
4. `skills/coc-story-director/SKILL.md`

Use the host's native COC Keeper MCP tools when available. Otherwise use the
same canonical toolbox operations from `scripts/coc_toolbox.py`. Never create
a host-specific rules, state, narration, or evidence path.
