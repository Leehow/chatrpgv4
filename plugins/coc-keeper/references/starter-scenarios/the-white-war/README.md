# The White War — Built-in Starter Scenario

An original derivative scenario for the COC Keeper plugin, adapted (under the
Open Gaming License v1.0a) from **"The White War"** by Paul StJohn Mackintosh,
published by Cthulhu Reborn Publishing in December 2023.

## License: Open Gaming License v1.0a

A full copy of the OGL is in `OGL-LICENSE.txt`.

## COPYRIGHT NOTICE (OGL §15)

```
Open Game License v. 1.0, © 2000, Wizards of the Coast, Inc.
Legend, © 2011, Mongoose Publishing.
Unearthed Arcana, © 2004, Wizards of the Coast, Inc.
Delta Green: Agent's Handbook, © 2016, Dennis Detwiller, Christopher Gunning, Shane Ivey, and Greg Stolze.
Delta Green: Need to Know, © 2016, Shane Ivey and Bret Kramer.
APOCTHULHU Quickstart, © 2020, Dean Engelhardt, Chad Bowser, Jo Kreil, and Michelle Bernay-Rogers.
APOCTHULHU Core Rules © 2020, Dean Engelhardt, Jo Kreil, Kevin Ross, Jeff Moeller, Chad Bowser, Dave Sokolowski, Christopher Smith Adair, Fred Behrendt, Emily O'Neil, Paul Franzese, and Michelle Bernay-Rogers.
APOCTHULHU System Reference Document v0.666 © 2020, Dean Engelhardt, Jo Kreil, Kevin Ross, Jeff Moeller, Chad Bowser, Dave Sokolowski, Christopher Smith Adair, Fred Behrendt, Emily O'Neil, Paul Franzese, and Michelle Bernay-Rogers.
Cthulhu Eternal System Reference Document v1.0 © 2021, Dean Engelhardt, Jo Kreil, Kevin Ross, Jeff Moeller, Chad Bowser, Dave Sokolowski, Christopher Smith Adair, Fred Behrendt, Emily O'Neil, Paul Franzese, and Michelle Bernay-Rogers.
Cthulhu Eternal – World War I Localization: System Reference Document v1.0 © 2023, Roger Bell_West.
The White War © 2023, Paul StJohn Mackintosh.
```

## Open Game Content vs Product Identity

Per the source PDF's OGL declaration:

- **OPEN GAME CONTENT** (free to redistribute under OGL): all numeric game
  data and the creature descriptions on source PDF pages 8–10. This package
  reproduces that OGC faithfully in `../../rules-json/the-white-war.json`
  (Polyp Horror stat block, cold-exposure rules, weapon data).
- **PRODUCT IDENTITY** (NOT redistributed from the source): the source's
  trademarks, trade dress, maps, artwork, dialogue, plots, storylines,
  locations, and characters.

The scenario narrative in this directory (scene names, locations, NPC names,
dialogue) is an **original derivative work** by the chatrpgv4 contributors,
built on the OGC game-mechanics premise of a primordial entity released from
an ice-sealed shaft. It does not reproduce any Product Identity from the
source. The narrative is licensed under the project's license (Apache-2.0).

## Playing

This scenario is installed via the COC onboarding prompt when a new campaign
is created, or by:

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_starter.py install \
  --campaign <campaign-id> --scenario the-white-war
```

Then continue play in COC mode. No PDF required.

The starter installs module structure and a player-safe character creation
briefing. It does not ship default player characters; create an investigator
for the 1916 Italian Alpine front, or ask the AI to draft one for your approval
before play begins.
