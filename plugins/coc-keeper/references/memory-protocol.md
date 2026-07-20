# Memory Protocol

Grep-native memory layer for the COC Story Director. The historical design spec is retired; see the tombstone index `docs/status/DIAGNOSIS-LEDGER.md`.

This Director card store is distinct from host-context recovery. Per-turn
startup/compaction recovery uses the typed `session.resume` operation and the
hash-bound `save/continuation/` checkpoint described in `state-schema.md`.
Never make a new model context grep all cards or session history merely to
resume play; retrieve cards later only when the current semantic beat needs
them. The checkpoint directory is a bounded 16-file rebuildable cache; durable
history remains in canonical append-only receipts and memory streams. Resume
also returns current operation opportunities and the stable narrative
opportunity when present, so a compacted host continues the attempt instead of
re-confirming tool parameters or rolling again. Resume runs once per host
context epoch, not once per played turn. Its entire data projection has a fixed
40 KiB budget; oversized values become canonical refs plus typed exact-read
cards, while the per-turn checkpoint stores transcript hashes/lengths/refs
rather than duplicating delivered prose.

## Layout
```
.coc/campaigns/<id>/memory/
  cards/player-safe/mem-*.md     # player-visible memory
  cards/keeper-only/mem-*.md     # director-only
  context-packs/turn-NNNNN.md    # per-turn director context
  index.json                      # retrieval accelerator
```

## Card format
Markdown + YAML frontmatter. Frontmatter keys (English, stable): `memory_id`, `scope`, `privacy`, `salience`, `entities`, `tags`, `reactivation_cues`, `scenes`, `source_events`, `possible_payoff`. Body: short Chinese summary.

## Grep examples
```
grep -R "reactivation_cues:.*door" memory/cards
grep -R "entities:.*ada-king" memory/cards
grep -R "tags:.*player_interest" memory/cards
```

## Write triggers (don't write too often)
1. player expresses preference/fear/hypothesis
2. player spends big Luck or pushes a roll
3. NPC attitude changes
4. critical clue understood/misunderstood
5. irreversible choice
6. trauma/insanity/major wound
7. foreshadow set or paid off
