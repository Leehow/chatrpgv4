---
name: coc-keeper-play
description: Run immersive Call of Cthulhu play after COC mode is active. Use for scene narration, NPC portrayal, player action handling, clue reveal, pacing, subsystem transitions, and campaign memory updates.
---

# COC Keeper Play

## Loop

For ordinary live play there is exactly ONE turn entrypoint:
`scripts/coc_live_turn_runner.py` (`run_live_turn(...)`). Each player input:

1. Judge the player's semantic intent yourself (you are the semantic
   evaluator) and pass it as `intent_class` and/or `player_intent_rich`.
   Never classify intent by keyword hits; judge what the text means. If you
   cannot supply intent, the runner routes through
   `coc_intent_router.parse_intent` and, with no semantic evidence, degrades
   to `ambiguous` (recorded in `intent_resolution`) — it never silently
   assumes `investigate`.
2. Call `run_live_turn(...)` with the player text, intent, and any
   `state_patch` for the next-turn visible scene contract.
3. Render the returned narration material: honor
   `narrative_directives` / `must_include`, surface `stop_actionability`
   handles, keep it immersive in `play_language`.
4. If the returned turn handed off to a rules subsystem (combat/chase/sanity
   session), continue in that subsystem's skill, then come back to the loop.

Do not manually stitch director, enrichment, rules, apply, and JSONL writes
during normal table play. The internal pipeline the runner executes (director
→ enrichment → rules → backfill → apply, for manual campaigns via the
live-story bridge in `build_director_context` when `story-graph.json` is
missing — the turn must still run through `build_director_context`) is
documented in `../../references/live-turn-internals.md` and is for isolated
bug hunts only. The runner defaults to fast/background recording and handles
compressed low-agency continuation before returning narration material.
Verify runner usage via the `logs/live-turn-runtime.jsonl` receipt.

## Personal Horror Weaving

Horror lands hardest when it is *this investigator's* horror (p.193-194).

- Session opening protocol: read the character sheet's backstory, pick 1-2
  entries (significant people, treasured possessions, meaningful locations,
  ideology…), and ask the player 3-5 short weaving questions about them
  before the first scene. Record each chosen entry as a structured hook via
  `coc_state.add_personal_horror_hook(...)` (field must be one of the nine
  backstory categories; never scan backstory prose at runtime).
- When a DirectorPlan carries `narrative_directives.personal_horror_hook`
  with `use: "weave"`, bind the scene's horror or an NPC beat to that hook's
  backstory entry, then persist it with `coc_state.mark_hook_woven(...)`.
  With `use: "echo"`, call back to the already-woven hook as payoff.
- Bout-of-madness events carry a `backstory_amend_suggestion`
  (`corrupt_existing` or `add_irrational` + a backstory field). After the
  bout, propose the amendment to the player in-fiction, negotiate wording
  together, and record acceptance with
  `coc_state.add_backstory_corruption(...)`. Prefer corrupting an existing
  entry over inventing a new one (p.157).
- Bout table results that reference a Significant Person or Ideology must
  quote the investigator's actual backstory entry, not a generic stand-in.

## Recording Modes

Live play defaults to `recording_mode: fast` and
`recording_flush: background` through `coc_live_turn_runner.run_live_turn(...)`.
Plans may still set `recording_mode: fast` in
`DirectorPlan.narrative_directives` or pass `recording_mode="fast"` to
`coc_director_apply.apply_plan(...)` in lower-level tests.
Fast mode keeps rules-facing save mutations synchronous, including world state,
pacing, clue discovery, NPC state, storylet ledger, memory writes, time advance,
and scene transitions. Verbose JSONL audit writes are batched into one durable
file under `logs/pending-turns/` so narration can return before the recorder
finishes.

Use `coc_director_apply.flush_pending_records(campaign_dir)` from a background
recorder, between turns, or before generating a formal battle report. If the
background recorder is unavailable, do not block ordinary narration; flush the
pending batches at the next convenient maintenance point.

Set `narrative_directives.recording_flush: background` when live play should
spawn a local recorder process immediately after queuing a fast-mode batch.
Leave it unset or `manual` when preserving pending batches for debugging.

The live runner writes a small synchronous receipt to
`logs/live-turn-runtime.jsonl` with the decision ids, auto-advance count,
recording mode, pending batch count, and whether background flushing was
requested. Use this receipt to verify that live play really used the runner
rather than ad hoc chat-side logging.

Use `state_patch` on `run_live_turn(...)` when the foreground Keeper has a
minimal visible scene update that the next turn must read, such as the current
`scene_id`, player-safe `summary`, `visible_affordances`, `pressure_moves`, or
present `npc_ids`. The runner writes that small next-turn contract
synchronously to `save/active-scene.json` and, when a scene id is supplied,
keeps `save/world-state.json.active_scene_id` aligned. Longer recap, debug, and
audit detail belongs in the same `state_patch` payload but is queued to
`logs/scene-state-patches.jsonl` through the fast/background recorder. Do not
block player-facing narration while waiting for that detailed patch log to
flush.

Every live turn that stops for player input must carry `stop_actionability`.
This is the stop-point handhold contract: `why_stopped`, `immediate_handles`,
`pressure_if_ignored`, `npc_position`, and `forbidden_menu_rendering`. The
contract must be built from structured fields such as `choice_frame.routes`,
`save/active-scene.json.visible_affordances`, `pressure_moves`,
`rule_results.roll_contract`, and NPC moves, never from raw prose keywords.
Before rendering the final player-visible text, surface at least one
`immediate_handles` entry as a concrete diegetic object, route, NPC posture, or
visible pressure. Do not render it as a numbered menu unless the player asks.
If `stop_actionability.requires_keeper_rewrite` is true, rewrite the stop
paragraph before sending it; do not leave the player at a vague "what now?"
prompt.

Foreground narration must not wait for background audit flushing. In live play,
once `run_live_turn(...)` returns with synchronous save-state writes complete,
render the player-facing scene text immediately. Do not poll
`logs/pending-turns/`, sleep waiting for the recorder, or call
`flush_pending_records(...)` before narration just to make audit logs tidy.
Flush pending batches only during maintenance, formal report generation,
explicit debugging, or before final archival.

Use `recording_mode: sync` only for bug hunts, replay-sensitive tests, and
final verification. Live play defaults to `fast` + `background` (see above);
sync mode is the non-default legacy behavior that writes each JSONL audit
record immediately, and lower-level `apply_plan(...)` calls that bypass the
runner still start from sync unless told otherwise.

When storylet scheduling runs, its detailed audit trail is optional. The apply
layer writes one JSONL record per turn to `logs/storylet-scheduler.jsonl` only
when debug logging is enabled (`COC_DEBUG_STORYLET_SCHEDULER=1` or campaign.json
`debug.storylet_scheduler_log: true`) and an enriched plan carries
`storylet_trigger`, `storylet_scheduler`, or `storylet_moves`. Use this log for
post-session tuning: it records the trigger reason, inferred story need,
candidate decks, filter counts, selected storylet, rejected examples, and ledger
update without exposing hidden scenario prose.

When scene progress governance runs, preserve its audit trail. The apply layer
writes one JSONL record to `logs/scene-progress.jsonl` when a plan carries
`narrative_directives.scene_progress`. Use this log to inspect why a bridge,
transition, travel, escort, waiting, or other low-agency connective scene was
continued, pressured, montaged, or cut.

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

Exception — explicit one-line quick start: when the player asks for
`coc_starter.quick_start` / `coc-starter quick-start` (scenario + pregen id),
use the shipped pregen and enter the opening scene immediately. Do not offer
quick-start unless the player opts in; ordinary `install` still follows the
gate above.

## Style

Stay immersive by default. Do not expose implementation details, JSON paths, or hidden scenario facts in ordinary play.

Use `[meta]` only when the user asks table-level or system-level questions.

For Chinese play (`zh-Hans`), write player-visible prose as natural modern
Chinese tabletop narration. Keep sentences shorter than log summaries, prefer
concrete scene detail and NPC voice, and avoid translationese or AI-summary
phrases such as "基于以上信息", "当前目标转向", "二人推断", or "这表明".
Structured summaries belong in save files and logs, not in the scene text the
player reads.

Compress repeated semantic facts. The first time a clue, quote, NPC fear,
gesture, environmental symptom, or foreign-language phrase appears, it may be
rendered with full sensory detail. On later turns, if it communicates the same
meaning and adds no new information, summarize it in one short sentence such as
"the survivor keeps muttering the same German warning" or "the smell still
hangs in the room." Expand it again only when the player asks, comprehension
changes, a new detail appears, or the situation escalates. Repetition is judged
semantically, not by exact words.

Show observable behavior before interpretation. Do not explain NPC mental state with abstract summary sentences such as "fear has overcome reason" or "terror blocks understanding." First render an observable action, voice, posture, gaze, hesitation, or physical evidence. If a relevant skill check or established investigator expertise supports interpretation, add the interpretation after the visible evidence in plain words.

Crisis scene clarity. Use blocking as an internal drafting frame, not as player-visible prose. For urgent physical scenes, draft the viewpoint, spatial anchor, active motion, connection or force, risk progression, visible affordance, and player entry before writing the final paragraph. The player-facing text should feel like natural scene narration: space first, motion second, force and worsening risk third, usable objects folded into the scene, then an open action prompt. Do not render crisis beats as "that means...", "you see two things...", "the current problem is...", or if/then option dumps.

Final prose guard. Treat director, enrichment, rules, NPC agency, and storylet output as drafting material, not final player text. Before any player-visible narration is sent, run or mentally apply `coc_narration_style.guard_player_visible_text(...)` to the drafted prose. If it flags AI-summary voice, translationese, camera-like body-part staging, vague spatial phrasing, abstract psychological explanation, exposed blocking, or option-dump structure, rewrite the paragraph and send the guarded `final_text` equivalent. This guard is only for player-visible prose quality; never use its surface phrase checks for scene routing, storylet selection, clue logic, NPC decisions, or rules adjudication.

## Foreign-Language Dialogue

When an NPC or handout speaks/writes in a language that is not the
investigator's obvious table language, preserve player knowledge separation.
Do not automatically translate everything into the play language. Use
structured fields such as `source_language`, the investigator's canonical
`Language (Own: X)` / `Language (Other: X)` skills, and the helper
`coc_language.render_foreign_dialogue_for_investigator(...)` when available.

Comprehension tiers:

- No matching language skill or 0: show the source-language words only, plus
  visible tone/body-language cues. Do not show the translation.
- 1-19: show the source-language words plus a vague gist supplied by the
  Keeper/semantic layer.
- 20-49: show the source-language words plus an incomplete or uncertain
  translation.
- 50+ or matching `Language (Own: X)`: the investigator understands it; a
  fuller translation may be shown, ideally with the short source quote kept for
  atmosphere.

The helper must not infer meaning from foreign text by keyword hits. If the
Keeper wants to reveal a gist, partial translation, or full translation, that
understanding must be supplied as structured text and then filtered through the
investigator's language skill.

## Action Prompt Shape

Ordinary play is not a CRPG menu. Do not list numbered or bulleted player
actions after a scene description. Convert stored scene affordances into
diegetic cues: mention the letter on the desk, the clerk watching the lobby,
the street noise from the nearby bar, the weight of the hidden pistol, or the
open time before an appointment. Then ask for an open-ended action in the play
language.

At life-or-death moments — a failed roll whose consequence is death, dying,
permanent maiming, or losing a plot-critical chance — remind the player they
may spend Luck (optional rule): report the exact cost in points (roll minus
effective target), their current Luck, and what would remain after spending.
Also state the alternative of pushing the roll and its announced worse
consequence, then let the player choose one or accept the failure. Do not
volunteer this reminder for routine low-stakes checks.

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

Bridge and transition scenes must have a progress contract. For connective
scenes such as travel, return, escort, waiting, or relocation, consume structured
fields such as `scene_kind`, `progress_contract`, `source_event_type`,
`authority_demands`, `responsibility_threats`, and `scene_tags`; do not infer
from raw prose keywords. If repeated low-agency play exhausts the scene's
`max_low_agency_turns` and there is no authored pressure, clue, NPC agency beat,
or current-scene storylet with a valid anchor, obey
`narrative_directives.scene_progress`: resolve the bridge briefly with montage
or cut to the next meaningful decision point. Do not stack another same-axis
environment check merely to keep the scene alive.

When `narrative_directives.dramatic_progress.mode == "compressed_progress"`,
increase the density of the next narration. Treat the player's action as a
continuing posture or routine process rather than one tiny beat. Summarize
repeated low-risk or connective actions and advance until one of the directive's
`advance_until` interrupts appears: threat approach, new obvious information,
NPC request for specialist judgment, meaningful choice, risk that requires a
roll, or arrival/transition to a new scene. The narration must change the game
state; do not answer with another equivalent "you keep following / they keep
walking" beat. Stop compression immediately before irreversible player choices,
new danger that needs a roll, or any action the player has not already implied.
In live play this compression is enforced by `run_live_turn(...)`: if no
interrupt appears after the first director pass, the runner consumes additional
internal director turns for the same low-agency posture until a threat, clue,
NPC handoff, risk check, meaningful choice, or scene transition appears, capped
by `max_auto_advance`.

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
- **NPC Social Role & Persona Layer.** NPC agency comes from abstract duty and
  persona fields, not from concrete titles. Do not branch on concrete occupation, title, name, or keyword text. Consume `authority_scope, responsibility_domains, chain_of_command, duty_pressure, initiative_style, and delegation_policy` to decide whether an NPC should visibly take
  responsibility before asking the investigator. Use persona tags only to color
  how they act, speak, hesitate, assist, object, or fail under pressure. Persist
  generated persona cards in `save/npc-state.json` and preserve decision traces
  in `logs/npc-agency.jsonl`.
  NPC agency moves should use abstract move ids such as `take_command`,
  `delegate_specialist`, `assist`, `object`, `protect`, `rush`, `panic`,
  `withhold`, and `withdraw`. These ids are not job titles. They are behavior
  contracts derived from duty, responsibility, initiative, persona, and scene
  pressure.
- **NPC Genesis Pipeline.** When a present NPC has no saved card, instantiate a
  lightweight silhouette from generic persona tables, abstract social-duty
  fields, scene context, and module-supplied `name_context`. Persist the card in
  `save/npc-state.json` and write the creation audit to
  `logs/npc-generation.jsonl`. LLM-generated names are presentation data:
  generate or preserve them from `name_context`, then store the result, but never
  use the name as a rules condition. Do not generate full mechanical stats for every passerby. Only promote an NPC to a rules-facing stat profile when the
  fiction enters opposed rolls, combat, chase, injury, or another mechanical
  interaction, then write the upgrade audit to `logs/npc-stat-upgrade.jsonl`.
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
- **Choose story function before rolling.** The storylet engine must first infer
  the current `story_need` such as clue delivery, front pressure, scene pressure,
  character beat, choice pressure, recovery redirection, complication, or
  opportunity. Roll only from storylets whose `story_functions` or `deck_tags`
  match that need. A high-weight card from the wrong deck must not beat a
  lower-weight card from the right deck.
- **Respect conflict level.** Low beats are texture and soft leads; medium beats
  introduce social/procedural friction; high beats put evidence, allies, or
  escape routes at risk; climax beats cash in clocks and force thematic
  choices. Never escalate above `storylet_policy.conflict_level` unless the
  policy explicitly allows a higher window.
- **Do not repeat the same trick.** Treat `storylet_id`, `family_id`, `trope_id`,
  and bound target as separate anti-repeat signatures. If a family was used
  recently, choose a different family even if the literal event text differs.
- **Keep scheduler decisions inspectable.** When a storylet is selected, its
  move should carry `scheduler_trace`; with debug logging enabled
  (`COC_DEBUG_STORYLET_SCHEDULER=1`), `logs/storylet-scheduler.jsonl` shows why
  the trigger opened, what story need/deck was chosen, how many candidates
  survived each filter, and which examples were rejected.
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

## Failed SAN Table Protocol

When a SAN roll fails, perform the table beat in this order (Keeper Rulebook
p.209-213; engine fields from `coc_sanity`):

1. **Narrate the involuntary action first.** The engine supplies
   `involuntary_action.kind` (and related structured fields). Render that
   involuntary beat before anything else — never skip it, never invent a
   different involuntary from free-text scanning.
2. **If a bout of madness triggers**, choose the mode the engine already set:
   - **Real-time mode:** the Keeper takes control of the investigator. Each
     round, announce the forced action the engine supplies and advance with
     `tick_bout_round` until the bout ends.
   - **Summary mode:** fast-forward. Do not play out round-by-round action;
     cut straight to describing the scene where the investigator "comes to."
     Table VIII summary results already imply that waking moment — narrate it,
     then continue.
3. **When the bout ends**, hand control back to the player and remind them of
   the fragile underlying temporary-insanity state still in force.
4. **During the underlying phase**, everyday behavior can be entirely normal
   (p.158). Forbid playing the investigator as constantly mad, twitching, or
   narrating every beat through the phobia/mania. Let the condition surface
   when the structured trigger or scene pressure calls for it — not as a
   permanent performance mask.

Bout playout detail (round tables, duration dice, summary Table VIII) lives in
`coc-sanity`; this section is the live-table performance order only.

## Horror Craft

Scare craft hard rules for live play (Keeper Rulebook Ch10 p.207-211). Honor
these before inventing atmosphere:

1. **Fear comes from broken everyday expectation first.** The wife who just
   left walking back down the stairs is scarier than naming a Mythos beast.
   Naming the monster always comes last — never lead with the label.
2. **Presentation ladder.** Climb in order: smell / touch / traces → sensory
   detail → physical evidence → (optionally) naming. While pacing
   `horror_stage` is below `revelation`, never say the monster's name
   outright. Prefer the structured `mythos_presentation` directive
   (`never_name_until`, `sensory_signature_sample`) when the director supplies
   one.
3. **A failed Spot Hidden is never "nothing is there."** Withhold certainty;
   leave a gap the player can still investigate. Never draw conclusions for
   the player — "no signs of life" is not "he is dead."
4. **Questions stack on questions.** Resolving one layer must lift the lid on
   a deeper one. Closing a mystery with a tidy answer that ends curiosity is
   a craft failure.

## Ending a Story

Close a scenario the way a human Keeper would (p.212-213):

1. **Recognize the finale.** A final scene resolved, or a deliberate
   cliffhanger, are both legitimate endings. Prefer structured evidence
   (`scene_type: resolution`, `is_final`, no outgoing `scene_edges`, legacy last
   story-graph scene when edges undeclared, or an apply
   layer `session_ending` event) over guessing from prose.
2. **Give each investigator a short epilogue.** Invite the player to co-write
   it — one beat of aftermath, consequence, or unresolved dread per person.
3. **Settle SAN rewards.** Apply scenario endings data when present, then add
   any Keeper discretionary award the table earned.
4. **Point to investigator development.** Until the Wave-2 development engine
   lands, run the skill-check / improvement phase as a manual table workflow
   (mark earned checks, roll improvements, record permanent sheet changes).
5. **Recover Luck at end of session.** For each investigator call
   `coc_roll.recover_luck(current_luck)` and persist with
   `coc_state.apply_luck_recovery(campaign_dir, investigator_id, luck_after=...)`.
6. **Investigator deaths must be meaningful.** Before the lights go out, always
   offer a final line or final action (p.213 + p.123 Keeper discretion). Do not
   cut straight to a corpse without that last agency beat.
