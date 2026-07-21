---
name: coc-magic
description: Resolve Call of Cthulhu spell learning and casting through the canonical typed runtime operation gateway. Use when an investigator or NPC learns or casts a spell during an active campaign.
---

# COC Magic

Spell learning and casting are typed state-changing operations. Never settle
them from memory or host-side prose.

For Codex, Cursor, and Claude Code, call
`../../../../scripts/coc_runtime_ops.py` / `execute_operation(...)`. The standalone
Pi interface calls the exact same implementation through
`runtime.sdk.api.operate(...)`.

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
