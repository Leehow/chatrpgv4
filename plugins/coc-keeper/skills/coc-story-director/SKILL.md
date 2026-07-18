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
uv run --frozen python plugins/coc-keeper/scripts/coc_toolbox.py describe director.advise
uv run --frozen python plugins/coc-keeper/scripts/coc_toolbox.py describe storylets.suggest
```

`director.advise` requires the exact player message plus the Keeper's
structured semantic `intent_evidence`; it reads pacing, history, personal
horror, epistemic, NPC, and threat signals and returns a rich
`candidate_plan` with reasons. `storylets.suggest` runs the existing rich
scheduler against that candidate plan and the same semantic evidence.
Both are suggestions with rationale — never obligations.

The emitted plan's field vocabulary — `rule_signals`, the APP/CR
`npc_reaction_roll` behind `npc_moves[].emotional_tone` (p.191), clue policy,
epistemic contract — is documented in `../../references/director-protocol.md`.

When you consult advice, call `evidence.record_adoption` after deciding whether
you adopted, modified, or ignored it. This is Keeper-internal evidence, not a
gate. When the referenced plan carries `npc_moves[].emotional_tone` (the p.191
first-impression signal), report the per-NPC follow-through via
`emotional_tone_adoption` — adopted, modified, or honestly ignored — so tone
landing becomes measurable evidence instead of table impression. If a selected
plan has an epistemic contract, apply it only after its clues are truly
committed, via `state.belief_apply`. Threat clocks advance only
through `state.threat_tick`; an `on_full` value is still a candidate consequence
for the Keeper, not auto-narration.

For the final drafting pass, `narration.brief` projects only player-safe fields
from the adopted/modified plan, including an `action_uptake` projection of the
current player declaration, and attaches the existing natural Chinese style
contract. When the declaration is an in-fiction commitment, enact it naturally
before or alongside its settled outcome; do not turn it into a recap or invent
extra investigator behavior. The Keeper writes and owns the final prose. Internal JSON fragments
must never be pasted into player output or the human Markdown battle report.
This projection reinforces the always-active response contract in
`coc-keeper-play`; it is never the switch that enables player-action uptake.

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
