---
name: coc-magic
description: Resolve Call of Cthulhu spell learning and casting through the canonical typed runtime operation gateway. Use when an investigator or NPC learns or casts a spell during an active campaign.
---

# COC Magic

Spell names are **searchable** via `rules.catalog_search` (`kinds: ["spell"]`).
During Pi-Coc play, load the exact long-tail operation with
`coc_discover({"operation":"magic.cast"})` or
`coc_discover({"operation":"magic.learn"})`, then invoke the returned typed
tool. The tools reuse `coc_magic.cast_spell` / `learn_spell` through the same
canonical runtime semantics as `runtime` `magic.cast` / `magic.learn`.
Unknown spells fail closed (no 0 MP / 0 SAN default). Search is advisory and
Keeper-only (`secret:true`); the KP chooses the exact name semantically.

Never settle from memory or host-side prose.

For non-Pi hosts, `../../../../scripts/coc_runtime_ops.py` /
`execute_operation(...)` and `runtime.sdk.api.operate(...)` remain compatible
consumers of the same implementation.

Cast request:

```json
{"spell":"Cloud Memory","pushed":false,"interrupted":false,"is_npc":false,"decision_id":"magic-cast:cloud-memory:attempt-1"}
```

Learn request:

```json
{"spell":"Cloud Memory","source":"tome","decision_id":"magic-learn:cloud-memory:attempt-1"}
```

Use only canonical spell names accepted by `coc_rules.spell_by_name`; obtain
them from `rules.catalog_search` rather than inventing aliases. The host owns
and reattaches the semantic `decision_id`. The gateway applies MP/SAN costs and
first-cast checks, persists investigator state, writes the magic event, and records every public roll in
`logs/rolls.jsonl`. Render the returned structured result in `play_language`;
do not roll again or reconstruct a missing roll from narration.
