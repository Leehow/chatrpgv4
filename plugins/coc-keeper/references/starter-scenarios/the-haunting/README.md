# The Haunting — Built-in Starter Scenario

An original derivative introductory investigation for the COC Keeper plugin,
structured after the classic Call of Cthulhu beginner scenario set in 1920s
Boston (Corbitt House). Narrative prose, scene names, and NPC dialogue in this
pack are original work by the chatrpgv4 contributors and do **not** reproduce
Chaosium Product Identity boxed text.

Mechanical hooks (Flesh Ward, floating knife, own-dagger exception) align with
`../../../rulesets/coc7/rules-json/the-haunting.json`. Walter Corbitt presentation/stats are
referenced from `../../../rulesets/coc7/rules-json/monsters.json`.

## Playing

### One-line quick start (N7)

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_starter.py quick-start \
  --scenario the-haunting --pregen thomas-hayes
# or: --pregen eleanor-reed
```

This creates a campaign, installs the starter, copies the pregen investigator
into `.coc/investigators/<id>/` and the campaign `investigators/` folder, seeds
`save/investigator-state/`, and leaves you on the opening briefing ready for
`run_live_turn`.

Pregens:

| id | name | occupation |
| --- | --- | --- |
| `thomas-hayes` | 托马斯·海斯 | 私家侦探 |
| `eleanor-reed` | 埃莉诺·里德 | 记者 |

### Install only (create your own investigator)

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_starter.py install \
  --campaign <campaign-id> --scenario the-haunting
```

Then create or link an investigator for 1920s Boston before play. The normal
install path still expects a player-made (or explicitly chosen) investigator;
quick-start is the opt-in pregen path.

## Structure

Branching investigation with real `scene_edges`:

1. Commission briefing (Knott)
2. Parallel research: newspaper morgue / hall of records / neighbors / previous tenants
3. Corbitt house ground floor → upper-floor poltergeist → basement rites → confrontation

Critical conclusions require multiple independent clue routes (R-5).
