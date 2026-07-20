# Ordinary-Turn Tooling Detail and Typed Operations

> Normative when routed from `skills/coc-keeper-play/SKILL.md` (Progressive Context Routing). Load this file before adjudicating the matching case. This is not optional flavor.

### A Typical Turn

The tool calls below are not a mandatory pipeline; the always-active response
contract above still applies. This is the natural rhythm:

1. Read the player's message and judge intent semantically (you are the
   semantic evaluator — never keyword-match). Explicit constraints are part
   of the intent: if the player says they retreat, refuse to attack, or hand
   control to an ally, do not select an `action_kind: attack` affordance just
   to manufacture pressure. An affordance with
   `resolution_mode: keeper_adjudication` is fully playable; lack of a typed
   tool never makes it second-class.
   Apply the always-active Core Keeper Response Contract above; optional tool
   selection does not switch that contract on or off.
2. If you need grounding, call `scene.context` (scene, NPCs present, clues
   here, exits, time, tension). Use `clues.query`, `npc.query`, `actions.list`,
   `scene.map` for deeper reference. Resolve each witnessed
   `pending_san_triggers` entry with an exact `sanity_check` command through
   `sanity.execute` (pass its authored id as `san_trigger_id`);
   fields under `keeper_only` / `keeper_mechanics` are execution reference and
   must never be quoted as player-facing knowledge. The context's
   `continuity.live_world_flags` is current campaign truth and supersedes an
   authored scene's initial description when they differ. Read structured
   `active_time_markers` for remaining/overdue arithmetic instead of
   recalculating remembered deadlines in prose.
   A progressive location dig returns a structured `canonical_scene_id`.
   When the player actually travels there, use that exact id for the scene
   move; do not substitute a broad parent/hub id merely because both names
   appear nearby in the map. A hub exposes destination stubs but does not mean
   every linked destination body should be parsed before the player chooses.
   When host PDF deepening creates a location containing an authored,
   immediately witnessed SAN event, the location pack must carry
   `san_triggers: [{trigger_id, source, san_loss_success,
   san_loss_fail_expr}]`. The progressive merge projects these into the same
   `on_enter.san_triggers` contract; do not pass an invented trigger id and
   accept an `improvised` warning for source-authored horror.
3. If the action is risky and failure is interesting, call `rules.roll`
   (or `rules.opposed(contest_kind="noncombat")`, `sanity.execute`,
   `rules.damage`). `rules.opposed` is only for a noncombat contest whose tie
   is broken by the higher underlying value. An attack, Dodge, Fight Back, or
   other melee reaction always goes through `combat.resolve`; pass the exact
   structured `defense_kind` because a same-level Dodge favors the defender
   while a same-level Fight Back favors the attacker. Never use a generic
   opposed roll as a shortcut around CombatSession. Offer
   `rules.push` after failures when the player changes method — announce the
   consequence first and pass that exact text as `failure_consequence`. When a
   percentile fumble has a foreseeable complication, pass it as
   `fumble_consequence` so public roll evidence is complete.
   When the result is critical/fumble, or a pushed roll fails, settle its
   source-bound `state.exceptional_effect` before journaling. Link
   `resource_delta` to the actual HP/SAN/MP/Luck/ammunition/item/condition
   write; link `relationship_or_clock` to a real NPC/threat/time-marker change
   (plain elapsed time or `set_flag` is not enough). A bounded
   condition/restriction/scene event becomes canonical active scene context.
   **Check adjudication flow (KP owns the choice):**
   Apply the always-on **professional inference boundary** from the main
   skill before selecting any skill: method + requested conclusion, not
   sheet-value shopping or event-keyword routing.

   1. From the player's fiction (and any matching `actions.list` affordance),
      decide whether a check is needed and which candidate skill(s) fit the
      **method, goal, and information layer** being sought:
      - **No-roll obvious facts.** Directly obvious phenomena need no
        perception roll (a body in plain view, an open door, a shout the
        whole room hears). Narrate them.
      - **Professional skill for diagnosis / interpretation / expert
        action.** When the requested result is cause, meaning, technical
        identification, specialized procedure, or other expert inference,
        use the skill that owns that expertise — even when its sheet value
        is lower than a general perception skill.
      - **Broad perception → raw observables only.** Spot Hidden, Listen,
        and similar general observation may expose faint marks, concealed
        objects, distant motion, or other raw sensory facts. They must not
        emit the same diagnosis, causal explanation, identification, or
        professional conclusion the expert skill would authorize.
      - **Do not choose the higher sheet value merely to improve odds.** A
        lower professional score is the correct harder path. Never re-label
        the same professional conclusion under a general skill because the
        number looks better.
      - **Allied specialty only with rulebook-supported increased
        difficulty or penalty.** An adjacent specialty may stand in only
        when the fiction supports that method **and** you apply the
        rulebook difficulty step-up or penalty dice the situation warrants —
        never as a free substitute that restores the full professional
        conclusion at regular difficulty.
      - **Compound layers stay distinct.** Declarations that mix
        search/observation with expert interpretation settle each layer
        separately (no-roll obvious facts, perception for hidden
        observables, professional skill for inference/action). Do not
        collapse them into one catch-all roll that leaks expert conclusions.

      Illustrative only — never a fixed event→skill map: examining a corpse —
      seeing an obvious body needs no Spot Hidden; Spot Hidden may notice
      faint or hidden marks/objects on or near the body; Medicine diagnoses
      cause, time, or injury meaning. Parallel cases use the same
      phenomenon-vs-expertise judgment, not corpse-keyword routing.

   2. When candidates are unclear, call `rules.skill_describe` for those
      candidates (and read the affordance's approaches / failure packets when
      present) before rolling. Prefer describe when useful; it is not a
      mandatory every-turn pipeline step.
   3. Choose the matching skill for the requested layer, then `rules.roll` /
      `rules.push`.
   4. After `【明骰】`, narrate what success/failure *changes at the table*
      before any clue dump — never “parameter passed → hand out results.”
      On fumbles and hard-fought failures, prefer a beat of **Table Wit**
      (Style) when tone allows — then the consequence, not a shrug.
      General-perception success still yields only the observable layer;
      professional conclusions still require the professional check (or an
      honest no-roll when expertise is not required).
   Interpersonal four follow rulebook Ch.4 disambiguation (also returned by
   `rules.skill_describe`): threaten → Intimidate; befriend/seduce → Charm;
   prolonged reasoned debate → Persuade; quick deceive/con → Fast Talk.
   Players do not nominate the skill. `skill-descriptions.json` covers the
   full `skills.json` catalog; if a requested name is still `missing`,
   adjudicate from the affordance / rulebook rather than inventing a
   parallel description store. This flow remains KP semantic judgment —
   not a keyword router, fixed skill map, or hard runtime narrative gate.
4. On scene entry, after repeated approaches, or when momentum stalls,
   consider `director.advise` with your structured semantic `intent_evidence`.
   Its `candidate_plan` may then be offered to `storylets.suggest`; consult
   `npc.advise`, `personal_horror.query`, `threat.query`, or
   `epistemic.query` when that specific dimension is naturally relevant.
   All are optional advisory tools:
   skip them when the current fiction already has momentum or no suggestion
   fits, and never treat their absence as a failed turn. A playtest may count
   whether they were observed as a diagnostic coverage signal, but zero calls
   never requires injecting a beat or blocking scene progress.
5. Call `narration.brief` when
   a complex beat benefits from its player-safe NarrationEnvelope and natural
   Chinese style contract. It is optional preparation rather than the final
   boundary. Its `action_uptake` reinforces
   the current player declaration for the text layer, but it does not activate
   or replace the always-on response contract. For a long, multi-stage,
   multi-NPC, climactic, or otherwise doubtful draft, you may then call
   `narration.review` on that exact draft (advisory semantic findings against
   the envelope and style contract — not a keyword gate and not a hard block).
   Routine turns should be self-reviewed in the same drafting pass; an empty
   per-turn tool receipt is wasted work. Rewrite when findings warrant it, but
   do not emit yet. Log-style
   summary, AI-summary voice, translationese, or restating tool/clue/roll
   payloads as if they were finished table prose is not acceptable player-
   facing output. Record the disposition of consulted advice with
   `evidence.record_adoption` so internal audit can distinguish “available”
   from “actually influenced play.” Never expose the envelope, tool labels,
   review JSON, or adoption reason to the player.
6. **Player-visible language constitution.** Render every player-visible
   string in the active campaign's `play_language` (default `zh-Hans`),
   honoring the Style and Horror Craft sections below. This includes KP
   narration, NPC dialogue, **handouts as delivered to the player**, public
   rolls, visible mechanics summaries, prompts, and recaps. Source PDF /
   source-bundle English (or any other source language) is KP evidence, not
   table output: when `play_language` differs, deliver the same substance in
   `play_language` (full handout body, not a one-line digest). Prefer
   `localized_text[play_language]` and `localized_terms[play_language]` when
   present. When a term mapping is missing, follow
   `language_profile.name_policy` and localize or transliterate naturally
   (Chinese transliterations / established translations for `zh-Hans`, etc.).
   Keep the chosen rendering consistent. Do not add source English in
   player-visible parentheses unless the player explicitly asks. Canonical
   names may remain in machine-facing fields, stable IDs, and hidden audit
   data. The only exception is **diegetic** foreign speech/text the
   investigator may not understand — see Foreign-Language Dialogue below;
   that exception never authorizes dumping an English module handout wholesale
   because the PDF was English.
7. Synchronously record what changed: `state.record_clue`, `state.move_scene`,
   `state.set_flag`, `state.npc_update`, `state.advance_time` as applicable.
   `state.advance_time` is only for ordinary forward duration. When source
   or played fiction explicitly establishes that an imprecise clock has
   reached another broad phase (waiting from night until the first morning
   bell, for example), pass paired `day_phase_after` + localized
   `display_after`; this advances the existing civil segment without
   inventing an exact hour. Do not leave an imprecise night hint frozen after
   play has visibly reached dawn. When source
   truth or accepted campaign canon explicitly moves play to another date,
   era, dream-time, or loop start, call `state.clock_discontinuity` once with
   the semantic transition kind. It replaces the civil-calendar anchor while
   preserving monotonic `elapsed_minutes` and every relative deadline. Give it
   only the precision actually established: use `local_date` + `day_phase`
   when the source says “New Year's night,” for example, and do not invent an
   exact clock time. A Keeper-only date remains secret until play reveals it;
   recording it in canonical state is not permission to narrate it.
   When the fiction establishes that an investigator completed a full sleep in
   a safe place, first advance its actual elapsed minutes, then call
   `state.mark_safe_rest` with `rest_kind="full_sleep"`. Time passage or a
   prose reason containing “sleep” never resets Director rest continuity by
   itself; the structured rest call is the semantic KP assertion.
   Use `state.time_marker` to set/reset/clear meaningful in-fiction agreements
   such as a police check-in deadline; it is bookkeeping only and never
   auto-triggers rescue or blocks narration.
   Whenever an authored NPC materially participates, also call
   `state.record_npc_engagement` once for that NPC with a structured `interaction_kind`,
   even if no trust/fear/fact value changed. Pass the exact `identity_ref`
   returned by `npc.query` or `scene.context` when that authored identity was
   actually portrayed. A missing or mismatched reference still records the
   interaction with a warning, but does not count as authored-NPC coverage;
   use a new stable improvised NPC ID when the fiction introduces a different
   person or social role. A journal may contain zero, one, or many materially
   participating NPCs, including interleaved NPC speech and NPC-to-NPC
   dialogue. Do not collapse those people into one engagement or assume one
   speaker per turn. For every stable NPC this investigator meets
   substantively for the first time, call `npc.reaction` separately with a
   localized player-safe `npc_display_name`, a structured semantic `context`,
   and a unique `decision_id`. Pass each exact `first_impression_ref` plus its
   KP-authored `first_impression_realization` into that pair's own
   `state.record_npc_engagement`. The public D100 uses max(APP, Credit Rating),
   is frozen once per investigator/NPC pair, and reports the chosen basis,
   value, and achieved level. The realization must explain the NPC's concrete
   immediate response while preserving authored agenda, existing relationship,
   scene/safety/authority constraints, and the investigator's actual conduct.
   A critical or fumble first impression needs its own independent
   source-bound `state.exceptional_effect`; multiple exceptional first
   impressions in one journal never share or overwrite an effect.
   Then close every played turn with `state.journal` (summary, intent class,
   tension, and exact `player_text`; pass the current `run_id` when one is
   active). Never condense or rewrite `player_text`. On a terminal turn, call
   `state.end_session` before that journal.
   Next call `turn.output_context`; it automatically binds the latest
   unfinalized journal and discovers all settled sources. Write the exact
   fictional draft as paragraphs. Treat `npc_performance_constraints` as
   Keeper-only portrayal context: realize each `observable_manner` naturally,
   but never print its causal explanation, opportunity/friction, or preserved
   boundary as a player-facing analysis block. Supply one `mechanics_placements` row for
   every public mechanic in its bundle, placing each authoritative block after
   the paragraph that establishes the action or cause and before the paragraph
   that narrates its result. One placement may group adjacent opposed rolls of
   the same type. Every public-roll coverage `exact_excerpt` must occur in a
   later paragraph than that roll's placement. Also supply one closed coverage
   row per obligation, then call `turn.finalize`. Send only its exact
   `rendered_text`. Never put all of a turn's rolls at the end after their
   consequences have already been narrated. Invoke
   authoritative mutating tool calls in the decided order, never in parallel.
   Dice, resources, critical state, journal, ending, and development
   settlement and finalization are never background work; only append-only audit or mirror
   flushing may be deferred.
   Item changes are state too: when the fiction grants, removes, or moves a
   possession (found gear, a purchase, a seized weapon, a spent ledger),
   call `state.item_grant` / `state.item_remove`, and use
   `state.inventory_list` to check current holdings (an investigator's or an
   NPC's). A granted weapon is a legal combat `weapon_id` at once; a weapon
   taken by a successful disarm maneuver commits automatically when the
   combat ends. Looting a downed or surrendered opponent is explicit:
   `state.item_grant` to the looter plus `state.item_remove` from the NPC.

If a tool reports a transient transaction or lock failure, retry the same
call with the same `decision_id` within the toolbox's bounded retry policy.
`state.set_flag` and `state.time_marker` keep an atomic source receipt: a
same-payload replay repairs a missing event/ledger stage without recomputing
the original flag provenance, deadline, or revision from later campaign
state. Never reuse that `decision_id` for changed arguments; an
`idempotency_conflict` is structured state evidence, not a narrative gate, so
use a new decision identity for a genuinely new state transition.
For invalid arguments or an unavailable semantic target, do not repeat the
same failing payload: inspect the tool hint, correct the structured argument,
use an explicit rules target when justified, or continue through another
fictionally valid approach. A recoverable tool miss is not a narrative gate.

Check `secrets.briefing` at session start and after big reveals so you know
what is still hidden.

### Typed Operations

Structured non-turn operations (scenario ensure/repair, magic cast/learn, tome
reading, hazards/poison/suffocation, development settlement, chapter switch)
keep their shared entrypoint: `scripts/coc_runtime_ops.py`
(`execute_operation(...)`). Authored combat enters the canonical
`CombatSession` through `combat.context`, `combat.resolve`, and `combat.end`;
never replace it with generic `rules.roll`/`rules.opposed`/`rules.damage`,
because that loses reaction-specific tie rules,
initiative, defense, damage-chain, save, and roll evidence. Detailed combat,
chase, and sanity-bout procedures remain in their own skills (`coc-combat`,
`coc-chase`, `coc-sanity`). Chase and full sanity procedure go through
`chase.context` / `chase.execute` and `sanity.context` / `sanity.execute`;
these delegate to the existing canonical subsystem executor, not a second
rules implementation. Mechanical victory/defeat from `combat.resolve`
already emits `combat_ended` atomically; reserve `combat.end` for ending a
still-active fight or repairing a legacy concluded snapshot without a receipt.
`combat_ended` is only a combat result. It is not authority to end the session
or declare the scenario resolved. Continue with established rescue or aftermath
when applicable; an unconscious but living investigator is not a TPK.
`combat.resolve` is only for an attack affordance the player actually chose or
for continuing an already-active combat; it is not a generic threat/pressure
tool. If the player chooses an authored retreat/noncombat affordance, adjudicate
that choice and record the ending/state instead of substituting a combat route.

When combat leaves an investigator in the structured `dying` chain, resolve
care synchronously through `rules.first_aid`, `rules.dying_check`, and
`rules.medicine`. Pass the acting caregiver's stable `rescuer_id` and actual
skill value so the canonical roll actor is preserved. Use `clock_kind=round`
before stabilization and `clock_kind=hour` while the temporary stabilization
lasts. The first First Aid attempt is regular; second and subsequent attempts
on the same wound are `pushed=true` and require a changed method plus an
announced consequence. A successful unstabilized CON clock or a failed hourly
stabilization clock opens one new subsequent-attempt window; it does not turn
the wound back into a fresh regular attempt. Do not wake or stabilize a dying investigator with generic
`rules.damage(kind=heal)` or by editing the save; the play loop may pause on a
`pending_resolution` until these authoritative rescue tools settle it.

After the immediate rescue chain, do not repeat daily `rules.medicine` calls
as a substitute for Major Wound recovery. Advance the in-fiction clock through
the remaining recovery interval, then call `rules.weekly_recovery` once the
authoritative wound clock reaches a full week. The tool derives the wound and
due time from save state, optionally resolves one caregiver Medicine roll,
then resolves the CON recovery and 1D3/2D3 healing with canonical roll
evidence. A failed recovery consumes that weekly attempt; advance another full
week before trying again. Never claim that daily care erased `major_wound`.
Combat-position markers are not injuries. Once no combat is active and the
fiction actually ends one (for example, the investigator stands after being
`prone`), call `state.clear_transient_condition` with that narrated reason.
Never use it for `major_wound`, `dying`, `unconscious`, or `dead`; their rules
tools own those transitions.
