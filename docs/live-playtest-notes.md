# Live Playtest Notes

This notebook records issues found during live human playtests, especially
workflow friction that does not belong in automated battle-report fixtures.

## 2026-07-08

- Status: fixed
- Area: investigator creation / campaign start UX
- Finding: when starting a new game or entering character creation, the Keeper
  flow should list existing reusable investigators before asking the player to
  create a new one.
- Expected behavior: show player-facing investigator names, occupation, era,
  and useful resume context such as last campaign or last modified time, then
  let the player pick an existing investigator or create a new one.
- Evidence: during a live Masks of Nyarlathotep test, the player wanted to reuse
  the previously created Erich von Koskinen character instead of rebuilding a
  sheet.
- Implementation note: shared behavior must be implemented in
  `plugins/coc-keeper/` first and synced to `plugins/coc-keeper-zcode/` via
  `python3 scripts/sync_coc_plugin_copy.py`.
- Resolution: `coc-keeper-play/SKILL.md` now requires reusable investigator
  selection from `/.coc/investigators/` before characteristic generation, and
  `tests/test_plugin_metadata.py` locks the protocol.

- Status: fixed
- Area: live playtest logging / storylet event IDs
- Finding: storylet events emitted by repeated live driver invocations can reuse
  `decision_id` values such as `turn-001` even when the player action log has
  advanced to `turn-002`.
- Expected behavior: storylet, roll, director, and player-action events for the
  same live turn should share a stable turn ID, and later turns should not
  collide with earlier IDs.
- Evidence: during the live Masks test for Erich von Koskinen, the second
  action ("return to the room and organize the briefing") wrote a player action
  as `turn-002`, while the generated storylet event still used `turn-001`.
- Implementation note: the live driver should derive the next turn ID from the
  existing campaign event log or accept an externally supplied live turn ID,
  instead of restarting local numbering for each invocation.
- Resolution: `coc_playtest_driver.py` now derives the next `turn-NNN` from
  existing event and roll logs before each run, and a regression test covers
  repeated live invocations.

- Status: fixed
- Area: roll outcome severity / storylet conflict selection
- Finding: storylet conflict level should distinguish rules-critical results
  from ordinary success tiers. Only critical success and fumble should trigger
  special high-conflict storylet handling by default.
- Expected behavior: critical success may trigger a high-conflict positive
  opportunity, and fumble may trigger a high-conflict negative complication.
  Extreme success, hard success, regular success, and ordinary failure should
  normally stay in low or medium conflict unless scene state independently
  justifies escalation.
- Evidence: during live play, an ordinary fumble plus hard success in a hotel
  briefing scene produced only a low-conflict sensory storylet; a follow-up
  rules review clarified that extreme success should not be treated like a
  critical success.
- Implementation note: the storylet selector or narrative enrichment pass
  should read normalized roll outcome tags and only apply critical/fumble
  special escalation for true rules-critical results.
- Resolution: `coc_narrative_enrichment.py` now gates storylet selection on a
  normalized `storylet_trigger`; fumbles and critical successes can escalate to
  high conflict, while extreme success does not trigger special handling by
  itself.

- Status: fixed
- Area: storylet contextual fit / live reflective actions
- Finding: a reflective low-risk action inside a private hotel-room scene can
  still select a medium "authority blocks route" storylet, which is hard to
  render without forcing an unnatural interruption.
- Expected behavior: reflective recap, self-briefing, and motivation-check
  actions should either produce no storylet or select low-conflict memory,
  clue-organization, time-pressure, or sensory-pressure storylets that fit the
  current location and action class.
- Evidence: during the live Erich von Koskinen Masks test, the action "整理一下思绪，
  我为什么会在这里" in `peru-lima-hotel-room-before-larkin` selected
  `medium-authority-block` despite no authority figure, checkpoint, or route
  entry being established in the fiction.
- Implementation note: add intent-class and scene-location fit filters before
  weighted storylet selection, especially for `reflect`, `recap`, and
  `organize_notes` style actions.
- Resolution: the storylet trigger gate prevents ordinary reflective turns
  from drawing event cards, and `coc_storylets.py` supports intent-class and
  trigger-polarity filters for contextual fit.

- Status: fixed
- Area: storylet trigger policy / event-card cadence
- Finding: the live loop currently tends to select a storylet every turn once
  the narrative enrichment pass is connected, which makes storylets feel like a
  per-round random event table instead of triggered drama beats.
- Expected behavior: storylets should be drawn only when the fiction or rules
  state triggers an event window, such as a critical success, fumble, failed
  risky action, visible clock advance, scene transition, player stall,
  repeated route pressure, NPC trigger, or explicit Keeper need for a
  complication/opportunity. Ordinary reflective or housekeeping turns should
  usually produce no storylet.
- Evidence: during the live Erich von Koskinen Masks test, both sensory and
  authority-block storylets were selected on consecutive low-risk room turns,
  including a reflective recap action where no event trigger existed.
- Implementation note: add a `storylet_trigger` gate before weighted selection.
  The gate should record why a storylet was allowed, and the report/debug
  output should show `storylet_trigger: none` when no event card is drawn.
- Resolution: narrative enrichment now reports `storylet_trigger` metadata and
  only selects storylets when the trigger gate allows an event window.

- Status: fixed
- Area: campaign start / pregen investigator confirmation
- Finding: when a built-in scenario ships pre-generated investigators, the live
  Keeper flow can still jump ahead by selecting one as a default instead of
  waiting for explicit player confirmation.
- Expected behavior: after listing reusable investigators and presenting the
  starter scenario's player-safe background, stop at character creation until
  the player creates an investigator, chooses a fitting reusable investigator,
  or explicitly asks AI to draft a sheet for confirmation.
- Evidence: during the live The White War test, the flow selected Federico
  Marchetti and opened the mission briefing before the player had confirmed
  character creation or pregen selection.
- Implementation note: character selection needs a hard setup gate distinct
  from narrative play; `coc-keeper-play` should not enter `mission-briefing`
  while campaign setup has no player-confirmed active investigator.
- Resolution: built-in starter scenarios no longer ship or install
  `pregen-investigators.json`. Installing a starter now generates a player-safe
  character creation briefing, and `coc-keeper-play` requires player-created or
  player-confirmed investigators before entering the opening scene.
## Open - Director Time Advance In Extreme Cold Scenes

- Found during live White War test on 2026-07-08: an ordinary `REVEAL` / observe-surroundings action in an outdoor extreme-cold scene inherited the generic `single_room_search` 20-minute time advance.
- In White War style cold-exposure scenes, generic room-search time can multiply fatigue unfairly or require manual correction.
- Expected fix: time advancement should consider scene tags/environment pressure, especially `cold_exposure.interval_minutes`, and should allow short scans distinct from full searches.
## Fixed - Director Should Escalate Repeated Continue / Follow Inputs

- Found during live White War test on 2026-07-08: if the player repeatedly says variants of “继续 / 跟着大部队 / keep following” and the Keeper only advances descriptive scenery, the player becomes a passenger with no meaningful action point.
- Expected behavior: repeated low-agency continuation inputs should count as player yielding initiative to the scene. On the next beat, the Story Director should trigger a scene pressure move, NPC interruption, visible danger, forced reaction, or concrete choice point.
- This should use authored scene pressure first, not random storylet draws. For `austrian-positions`, the obvious candidate is the module pressure move: a hidden/crazed Austrian survivor or another immediate sign that makes the patrol stop and react.
- Guardrail: do not punish a single “continue” used to move through safe connective tissue; escalate after repeated continue/follow in an uncertain or tense scene, or when the scene already contains unresolved pressure moves.
- Resolution: `coc_intent_router.py` now accepts `move` as a first-class intent.
  `coc_story_director.py` records `low_agency_continue_count` and forces
  authored `active_scene.pressure_moves` when repeated low-agency continuation
  yields initiative to the scene.

## Fixed - Storylet Current-Scene Anchor Contract

- Found during live White War test on 2026-07-08: event cards could be drawn
  that had no satisfying current-scene binding, leaving the Keeper to stretch
  the fiction around a generic beat.
- Expected behavior: storylets are eligible only when they can bind to a
  current NPC, clue, threat front, authored scene pressure, matching scene tag,
  or explicit anchor contract. If no event fits, draw no event.
- Resolution: `coc_storylets.py` now rejects unanchored storylets by default,
  supports `requires.scene_pressure`, and the packaged storylet library marks
  formerly generic beats as scene-pressure anchored.
