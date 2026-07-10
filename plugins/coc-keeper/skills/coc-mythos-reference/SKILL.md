---
name: coc-mythos-reference
description: Provide spoiler-aware Mythos references for COC mode. Use for monsters, deities, spells, tomes, artifacts, combat stats, source pages, and Keeper-only lookup during scenario preparation or play.
---

# COC Mythos Reference

## Use

Use this skill for Keeper-side lookup of Mythos entities, tomes, spells, artifacts, and monster stats.

## Spoiler Safety

Do not reveal true monster identities, secret spell effects, hidden tome contents, or scenario answers to the player without `[spoiler_warning]` and confirmation.

## Sources

Prefer structured scenario JSON and source maps first. Use PDFs for detailed lookup only when needed, then summarize rather than quoting long passages.

## Monster Presentation Contract

Every entry in `references/rules-json/monsters.json` carries a structured
`presentation` block (Keeper Rulebook Ch14 p.280-282). Honor it whenever that
monster is in play:

- **`never_name_until`** — do not speak the creature's true name until pacing
  `horror_stage` reaches this stage (default `revelation`). Climb the Ch10
  presentation ladder first.
- **`sensory_signature`** — sample early-stage scenes from these sensory
  strings (smell, sound, residue, wrong geometry). Prefer the director's
  `mythos_presentation.sensory_signature_sample` when present.
- **`death_residue`** — when a body or remains are found, describe this
  residue rather than inventing a clean corpse. Deities and Great Old Ones
  at 0 HP are dispersed or banished, not killed — their residue reflects
  absence, collapse, or unmaking, never a mundane corpse.
- **`combat_goal`** — run the fight toward `kill`, `capture`, `flee`, or
  `ritual`. Intelligent species do not fight to the death (p.281).
- **`retreat_below_hp_fraction`** — when current HP falls below this fraction
  of maximum, the creature attempts retreat or disengagement. Mindless
  threats may leave this `null`.

Lookup is by structured monster id only (`monster_ids` / `monster_id` on the
active scene or threat fronts). Never infer a creature's identity by scanning
player-facing prose.
