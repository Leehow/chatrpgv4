---
name: coc-story-director
description: Advisory pacing lens for the COC Keeper. Use after COC mode is active when you are unsure what the next beat should accomplish — it explains how to read director.advise and storylets.suggest output. This skill does not output final narration to the player.
---

# COC Story Director

## Role

The director layer is advisory now. You — the Keeper LLM — choose every beat.
When your read of the table is clear, act on it directly. When you are unsure
what the story needs, consult the deterministic advisors:

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_toolbox.py director.advise --root . --campaign <id>
uv run --frozen python plugins/coc-keeper/scripts/coc_toolbox.py storylets.suggest --root . --campaign <id> --json '{"max":5}'
```

`director.advise` reads pacing signals (tension, stalling, undiscovered clues,
open exits, threat clocks) and returns suggested beats with reasons.
`storylets.suggest` scores side-beat candidates against the current scene.
Both are suggestions with rationale — never obligations.

## Beat Vocabulary

Useful shared language for what a turn can accomplish:

- **REVEAL** — deliver a clue or new information the scene has earned.
- **DEEPEN** — texture, mood, character, or an existing thread.
- **PRESSURE** — cost, pursuit, deadline, or an NPC pushing back.
- **CHARACTER** — an NPC beat or a personal-horror hook.
- **CHOICE** — sharpen a real fork; make the tradeoffs visible.
- **CUT / MONTAGE** — move; compress low-agency stretches.
- **SUBSYSTEM** — the fiction demands combat/chase/sanity procedure.
- **RECOVER** — the table is stalled; reopen motion (an Idea-style nudge,
  an NPC arrival, a fallback route to a critical clue).
- **PAYOFF** — cash in a planted thread or woven hook.

## Craft Rules

- Prep situations, not predetermined plot.
- Never block player plans with a flat No when Yes-but or Yes-and can
  preserve agency.
- Critical clues should stay reachable by multiple routes — `clues.query`
  shows each conclusion's `minimum_routes` and `fallback_policy`; if the
  table burned a route, open another rather than dead-ending the mystery.
- Do not repeat identical rolls until anticlimactic.
- Horror escalates: ordinary → wrongness → pattern → revelation.
- Memory is not recap spam; only recall what changes the current beat.
- Never reveal keeper secrets as exposition (`secrets.briefing` tracks them).
