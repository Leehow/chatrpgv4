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

## Tome Reading

When an investigator studies a Mythos tome (Keeper Rulebook Ch11 p.217-226),
call the canonical `tome.read` operation in `coc_runtime_ops.py` for each
`skim` → `initial` → `full` → `research` phase. The gateway owns TomeSession,
SAN-loss settlement, CM/max-SAN and reusable-sheet updates, persistence, and
public dice evidence. Do not call TomeSession or patch SAN/CM from host prose.

**Sensory description (p.224-226).** Present the physical book before its
contents: binding, smell, weight, ink that seems wrong, pages that resist or
invite the eye. Early contact is atmosphere and table-of-contents level
(`skim`); deeper phases unlock structured Mythos insight, not a lore dump.

**Book as personality.** Treat a major tome as a presence with temperament —
jealous, seductive, pedantic, hostile — that colors how knowledge arrives.
The book's "voice" is Keeper framing; mechanical outcomes still come from the
engine (CM, SAN expression, weeks, research roll contract).

**Plot-critical tomes must not dead-end (p.211-212).** Language and other
failure gates may block ordinary study, but when the scenario requires the
tome (`plot_critical=True`), skip the hard stop and continue with
`keeper_note: skip_failure_gate`. Never strand the investigation on a failed
Own Language / Other Language check for a book the plot needs open.
