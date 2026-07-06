# Memory Protocol

Grep-native memory layer for the COC Story Director. See `docs/superpowers/specs/2026-07-06-story-director-v2-blueprint.md`.

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
