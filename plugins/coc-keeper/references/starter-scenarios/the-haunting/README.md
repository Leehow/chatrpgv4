# The Haunting — Built-in Starter Scenario

An original derivative introductory investigation for the COC Keeper plugin,
structured after the classic Call of Cthulhu beginner scenario set in 1920s
Boston (Corbitt House). Narrative prose, scene names, and NPC dialogue in this
pack are original work by the chatrpgv4 contributors and do **not** reproduce
Chaosium Product Identity boxed text.

Mechanical hooks (Flesh Ward, floating knife, own-dagger exception) align with
`../../rules-json/the-haunting.json`. Walter Corbitt presentation/stats are
referenced from `../../rules-json/monsters.json`.

## Playing

```bash
python3 plugins/coc-keeper/scripts/coc_starter.py install \
  --campaign <campaign-id> --scenario the-haunting
```

Then create or link an investigator for 1920s Boston before play. The starter
installs module structure and a player-safe character creation briefing.

## Structure

Branching investigation with real `scene_edges`:

1. Commission briefing (Knott)
2. Parallel research: newspaper morgue / hall of records / neighbors / previous tenants
3. Corbitt house ground floor → upper-floor poltergeist → basement rites → confrontation

Critical conclusions require multiple independent clue routes (R-5).
