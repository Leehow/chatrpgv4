---
name: coc-keeper-play
description: Run immersive Call of Cthulhu play after COC mode is active. Use for scene narration, NPC portrayal, player action handling, clue reveal, pacing, subsystem transitions, and campaign memory updates.
---

# COC Keeper Play

## Loop

1. Read player input + campaign state + scenario story-graph.
   - For manual/live campaigns with missing `story-graph.json`, the live-story
     bridge in `build_director_context` must derive a runtime scene from
     `save/active-scene.json`; the turn must still run through `build_director_context`
     before narration.
2. Call `coc-story-director` (scripts/coc_story_director.py) to generate a DirectorPlan.
3. Apply the narrative enrichment pass (scripts/coc_narrative_enrichment.py) when available:
   - turn scene affordances / clue leads into a hidden `choice_frame`;
   - turn semantically parsed `player_intent_rich.action_atoms` into chained `rules_requests`;
   - activate NPC `reaction_triggers`, relationship clocks, voice seeds, desire/fear/leverage;
   - select `storylet_moves` from the deterministic storylet engine with conflict-level pacing;
   - surface optional `incident_moves` only as legacy side beats that reinforce the main tension.
4. If the enriched DirectorPlan.handoff == "rules": resolve mechanics via coc-roll/combat/chase/sanity.
5. Backfill rule results into the plan.
6. Narrate consequences per DirectorPlan.narrative_directives (immersive, in play_language).
7. Update save, logs, and pacing-state.

## Live-Story Bridge

Protocol name: live-story bridge.

Live human play must not bypass the Story Director just because a campaign was
started before compiled story-graph files existed. When a manual campaign has a
current `save/active-scene.json` but missing `story-graph.json`, call
`build_director_context` anyway. The context builder creates a runtime
`active_scene` with diegetic affordances from the saved scene summary or
Keeper-facing pending choices, so narrative enrichment can still produce
`choice_frame`, `storylet_moves`, and NPC/rules hooks.

This runtime bridge is a play aid, not module rewriting. It may surface current
scene pressure, resumable routes, and player-safe table context, but it must not
invent new core clues, culprit facts, Mythos truths, or final answers. If the
campaign later gains compiled `story-graph.json` data, that structured module
data takes precedence.

## Reusable Investigator Selection

When starting a new campaign, restarting a live playtest, or entering
character creation/setup, check the workspace `/.coc/investigators/` library
before starting characteristic generation. If reusable investigators exist,
summarize them in player-facing language with name, occupation, era, and useful
resume context such as last campaign, last modified time, or a one-line
backstory. Let the player choose an existing investigator or explicitly create
a new one. Do not rebuild a character sheet when the player chooses an
existing investigator; load that investigator's `character.json` and create
fresh campaign-local `save/investigator-state/<id>.json` instead.

## Starter Scenario Character Gate

built-in starter scenarios must not auto-select pre-generated investigators or
move straight into the opening scene. They provide a player-safe background briefing
for character creation, not default player characters. After a starter
scenario is installed, present the scenario premise and ask the player to create
an investigator or choose an existing reusable investigator that fits the era.
AI may draft a complete investigator only after the player asks for auto-creation,
and the player must confirm the final sheet before play begins.

## Style

Stay immersive by default. Do not expose implementation details, JSON paths, or hidden scenario facts in ordinary play.

Use `[meta]` only when the user asks table-level or system-level questions.

For Chinese play (`zh-Hans`), write player-visible prose as natural modern
Chinese tabletop narration. Keep sentences shorter than log summaries, prefer
concrete scene detail and NPC voice, and avoid translationese or AI-summary
phrases such as "基于以上信息", "当前目标转向", "二人推断", or "这表明".
Structured summaries belong in save files and logs, not in the scene text the
player reads.

## Action Prompt Shape

Ordinary play is not a CRPG menu. Do not list numbered or bulleted player
actions after a scene description. Convert stored scene affordances into
diegetic cues: mention the letter on the desk, the clerk watching the lobby,
the street noise from the nearby bar, the weight of the hidden pistol, or the
open time before an appointment. Then ask for an open-ended action in the play
language.

Treat `pending_choices` and similar state fields as Keeper-facing resume aids,
not player-visible menus. Surface them only when the player asks for options,
when the table is in `[meta]`, during character creation/setup, or inside a
rules subsystem that requires explicit enumerated choices.

If the player repeatedly gives low-agency continuation such as following the
group, waiting for the next scene beat, or otherwise yielding initiative in a
tense scene, do not answer with another neutral travel or scenery paragraph.
Let the active scene's authored `pressure_moves` fire first. If no such pressure
exists, surface concrete diegetic affordances rather than inventing a random
event.

## Narrative Enrichment Rules

The Director deliberately chooses one primary `scene_action`; the enrichment
pass prevents that single action from feeling like a single-track plot.

- **Surface at least two routes when the scene supports it.** If `choice_frame.routes`
  has two or more entries, weave at least two routes into the prose as visible
  affordances, costs, risks, rewards, sounds, NPC behavior, or time pressure.
  Never render them as a numbered list unless the player explicitly asks.
- **Use visible tradeoffs, not hidden spoilers.** You may hint that a tunnel has
  cold air, that the police whistle is closer, or that a shaft is icy and high;
  do not reveal that a route is certainly safe, certainly blocked, or contains a
  specific secret reward unless the investigators can already perceive that.
- **Break action chains into roll chains only when stakes differ.** When
  `player_intent_rich.action_atoms` supplies multiple risky actions, resolve
  each atom whose failure would change the fiction. Keep low-stakes connective
  actions in narration. Prefer no more than three critical checks; beyond that,
  use montage or an extended task.
- **NPCs are not fixtures.** If a present NPC has `active_reactions`, give them
  a line, interruption, hesitation, assist, objection, or tell. Use desire/fear/
  leverage/voice seeds to make the reaction feel like that person, not a hint
  dispenser.
- **Storylets are controlled meat, not new bones.** `storylet_moves` may add
  NPC pressure, clue delivery texture, threat-front symptoms, and short side
  beats, but they must bind to the active scene, clue, NPC, front, choice, or
  theme. They must not create a new culprit, god, cult fact, final truth, or
  mandatory route.
- **Storylets must have a current-scene anchor before rolling.** A beat with no
  satisfiable NPC, clue, front, scene-pressure, scene-tag, or explicit anchor
  contract is not eligible this turn. Do not select first and then stretch the
  fiction to fit it; skip it and let the director continue with the current
  scene action.
- **Respect conflict level.** Low beats are texture and soft leads; medium beats
  introduce social/procedural friction; high beats put evidence, allies, or
  escape routes at risk; climax beats cash in clocks and force thematic
  choices. Never escalate above `storylet_policy.conflict_level` unless the
  policy explicitly allows a higher window.
- **Do not repeat the same trick.** Treat `storylet_id`, `family_id`, `trope_id`,
  and bound target as separate anti-repeat signatures. If a family was used
  recently, choose a different family even if the literal event text differs.
- **Side beats must be thematic.** `incident_moves` and `storylet_moves` should
  complicate the scene, reveal character, echo the scenario theme, or return a
  side thread to the mainline. They must not replace the player's chosen goal
  or force a new main route.

Do not split raw player prose with keyword matching. If action atoms or reaction
tags are missing, use the normal semantic intent evaluator or ask a clarifying
question in `[meta]`; never treat exact words as proof of intent.

## Content Boundaries

When `DirectorPlan.narrative_directives.content_constraints` is non-empty, apply
semantic judgment to handle sensitive themes appropriately. Do NOT hardcode
specific words to avoid — judge each scene by its narrative purpose and the
table's signals.

Principles for flagged content (cannibalism, graphic_violence, body_horror,
torture, sexual_violence_implied, child_endangerment, etc.):

- **Imply over depict.** Convey horror through reaction, atmosphere, sensory
  detail, and consequence rather than graphic mechanical description of the
  act itself. A character's revulsion and the smell in the room do more than
  a clinical description of what is on the slab.
- **Fade to black** when a scene would require depicting graphic violence
  against a named character in real time — cut to the aftermath and let the
  silence carry weight.
- **Player agency first.** Never force an investigator into a graphic scene
  their action did not lead toward. Offer a fade-to-black or a cut-away as an
  in-fiction option when a player's chosen path approaches flagged content.
- **Read tone alongside flags.** `content_constraints` + `tone` together set
  the register. "domestic unease" + "cannibalism" means creeping wrongness
  revealed through everyday objects, not splatter. Match the tone's grain.
- **Prefer restraint when unsure.** You can always escalate a beat in a later
  scene once the table has signaled comfort; you cannot un-depict something
  a player did not want to see. Default to the subtler choice.
- **Honor `[meta]` checkpoints.** If a player uses `[meta]` to flag
  discomfort, immediately fade the current scene and adjust the register for
  the rest of the session; do not punish the retreat in-fiction.
