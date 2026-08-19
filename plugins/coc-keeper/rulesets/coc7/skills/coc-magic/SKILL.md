---
name: coc-magic
description: Resolve Call of Cthulhu spell learning and casting through the canonical typed runtime operation gateway. Use when an investigator or NPC learns or casts a spell during an active campaign.
---

# COC Magic

Spell names are **searchable** via `rules.catalog_search` (`kinds: ["spell"]`).
There is **no live Pi toolbox cast/learn tool** on the normal play path; do
not advertise complete live-cast wiring. The existing engine is
`coc_magic.cast_spell` / `learn_spell` plus `runtime` `magic.cast` / `magic.learn`.
Unknown spells fail closed (no 0 MP / 0 SAN default). Search is advisory and
Keeper-only (`secret:true`); the KP chooses the exact name semantically.

When a host *does* expose the typed gateway, never settle from memory or
host-side prose.

For Codex, Cursor, and Claude Code, call
`../../../../scripts/coc_runtime_ops.py` / `execute_operation(...)`. The standalone
headless interface can call the same implementation through
`runtime.sdk.api.operate(...)`. That is **not** a Pi-coc live consumer.

Cast request:

```json
{"schema_version":1,"kind":"magic.cast","payload":{"spell":"Cloud Memory","pushed":false,"interrupted":false,"is_npc":false}}
```

Learn request:

```json
{"schema_version":1,"kind":"magic.learn","payload":{"spell":"Cloud Memory","source":"tome"}}
```

Use only canonical spell names accepted by `coc_rules.spell_by_name`. The
gateway applies MP/SAN costs and first-cast checks, persists investigator
state, writes the magic event, and records every public roll in
`logs/rolls.jsonl`. Render the returned structured result in `play_language`;
do not roll again or reconstruct a missing roll from narration.
