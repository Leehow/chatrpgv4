# Ordinary-Turn Tooling Detail and Typed Operations

> Normative when routed from `skills/coc-keeper-play/SKILL.md` (Progressive Context Routing). Load this file before adjudicating the matching case. This is not optional flavor.

### Closed `decision_id` grammar

KP-authored `decision_id` is the transaction's idempotency key. The validator
accepts only this closed form — never a bare prose slug, never an obligation
handle. Replay the same id only for the exact same arguments; a new transition
needs a new id. The host does not rewrite or derive KP-owned decision identities.

Closed `decision_id` prefixes (validator `DECISION_ID_PREFIXES`):
`journal-` `roll-` `move-` `advance-time-` `on-enter-` `opening-` `table-opening-` `push-` `luck-` `development-` `combat-` `npc-` `recall-` `recovery-` `review-` `deliver-` `exceptional-` `finalize-` `fin-` `associate-` `accept-` `ask-` `confirm-` `grant-` `record-` `item-` `cash-`

Any listed prefix is valid on any decision_id.
`tN-` turn scope applies only to prefixed `{prefix}{slug}` ids, never to `quick-start:` / `setup-complete:` colon forms.
`:finalize` is accepted on prefixed `{prefix}{slug}` ids and on `quick-start:` / `setup-complete:` colon forms.
Colon forms: `quick-start:<1–6 slugs>`, `setup-complete:<1–6 slugs>`.
Coverage handles such as `roll:first-impression` are obligation ids for `coverage[].obligation_id`, not tool `decision_id` values.
RIGHT: `roll-persuade-arty-access-v1`.
✗ never write: `first-impression-arty-wilmot`, `persuade-arty-morgue-access`.

### Closed model-facing identity grammar

Every model-authored identity field uses a closed grammar. The host does not
rewrite values. Copy only the accepted form and the RIGHT column. The
`✗ never` column is a rejection sample, never a value to copy. Do not guess a
neighboring namespace (`route:` is not `affordance:`; `claim:` is not `claim-`).

| field | accepted form | RIGHT | ✗ never |
| --- | --- | --- | --- |
| `decision_id` | `{prefix}{slug}` with prefix one of the listed DECISION_ID_PREFIXES; or `quick-start:` / `setup-complete:` colon forms; `tN-` on prefixed forms only; `:finalize` on prefixed and colon forms | `roll-persuade-arty-access-v1` | ✗ never `first-impression-arty-wilmot` |
| `actor_id` | multi-token semantic slug or namespace `actor:`, `npc:` | `actor:example-slug` | ✗ never `route:example-slug` |
| `advice_id` | exact handle `storylet:current-advice` or namespace `advice:`, `storylet:` | `storylet:current-advice` | ✗ never `current-advice` |
| `affordance_id` | multi-token semantic slug or namespace `affordance:` | `affordance:example-slug` | ✗ never `route:example-slug` |
| `assistant_rescuer_ref` | multi-token semantic slug or namespace `npc:`, `person:`, `actor:` | `npc:example-slug` | ✗ never `route:example-slug` |
| `base_weapon_id` | multi-token semantic slug or namespace `weapon:`, `item:` | `weapon:example-slug` | ✗ never `route:example-slug` |
| `campaign_id` | multi-token semantic slug (no colon namespace) | `example-slug` | ✗ never `route:example-slug` |
| `candidate_id` | multi-token semantic slug or namespace `scene-route:`, `attack:`, `combat-route:`, `combat:`, `storylet-candidate:`, `advice:` | `scene-route:example-slug` | ✗ never `route:example-slug` |
| `candidate_ref` | exact handle `storylet:current-candidate` or namespace `storylet-candidate:` | `storylet:current-candidate` | ✗ never `current-candidate` |
| `caregiver_id` | multi-token semantic slug or namespace `npc:`, `person:` | `npc:example-slug` | ✗ never `route:example-slug` |
| `claim_id` | `{prefix}{slug}` with prefix `claim-`, `agency-` | `claim-sit-notebook-smoke` | ✗ never `sit-notebook-smoke` |
| `clock_id` | multi-token semantic slug or namespace `clock:` | `clock:example-slug` | ✗ never `route:example-slug` |
| `clue_id` | multi-token semantic slug or namespace `clue:` | `clue:example-slug` | ✗ never `route:example-slug` |
| `clue_ids` | multi-token semantic slug or namespace `clue:` | `clue:example-slug` | ✗ never `route:example-slug` |
| `commitment_id` | multi-token semantic slug or namespace `commitment:` | `commitment:example-slug` | ✗ never `route:example-slug` |
| `committed_clue_ids` | multi-token semantic slug or namespace `clue:` | `clue:example-slug` | ✗ never `route:example-slug` |
| `consuming_roll_id` | multi-token semantic slug or namespace `roll:` | `roll:example-slug` | ✗ never `route:example-slug` |
| `contract_id` | multi-token semantic slug (no colon namespace) | `example-slug` | ✗ never `route:example-slug` |
| `decision_ref` | multi-token semantic slug or namespace `decision:` | `decision:example-slug` | ✗ never `route:example-slug` |
| `delivery_id` | multi-token semantic slug or namespace `delivery:` | `delivery:example-slug` | ✗ never `route:example-slug` |
| `dependency_ref` | multi-token semantic slug (no colon namespace) | `example-slug` | ✗ never `route:example-slug` |
| `effect_id` | multi-token semantic slug or namespace `effect:` | `effect:example-slug` | ✗ never `route:example-slug` |
| `ending_id` | multi-token semantic slug or namespace `ending:` | `ending:example-slug` | ✗ never `route:example-slug` |
| `entity_refs` | multi-token semantic slug (no colon namespace) | `example-slug` | ✗ never `route:example-slug` |
| `evidence_ref` | multi-token semantic slug or namespace `evidence:` | `evidence:example-slug` | ✗ never `route:example-slug` |
| `evidence_refs` | multi-token semantic slug or namespace `evidence:` | `evidence:example-slug` | ✗ never `route:example-slug` |
| `fallback_archetype_id` | multi-token semantic slug or namespace `archetype:` | `archetype:example-slug` | ✗ never `route:example-slug` |
| `feasibility_refs` | multi-token semantic slug or namespace `evidence:` | `evidence:example-slug` | ✗ never `route:example-slug` |
| `flag_id` | multi-token semantic slug or namespace `flag:` | `flag:example-slug` | ✗ never `route:example-slug` |
| `handout_id` | multi-token semantic slug or namespace `handout:` | `handout:example-slug` | ✗ never `route:example-slug` |
| `hook_id` | multi-token semantic slug or namespace `hook:` | `hook:example-slug` | ✗ never `route:example-slug` |
| `ids` | multi-token semantic slug (no colon namespace) | `example-slug` | ✗ never `route:example-slug` |
| `insight_id` | multi-token semantic slug or namespace `insight:` | `insight:example-slug` | ✗ never `route:example-slug` |
| `inspected_source_refs` | `pdf_index-<n>` or namespace `pdf:`, `module:`, `source:`, `handout:` | `pdf:haunting-full` | ✗ never `foo` |
| `investigator` | exact handle `current-investigator` | `current-investigator` | ✗ never `investigator-1` |
| `investigator_id` | multi-token semantic slug (no colon namespace) | `example-slug` | ✗ never `route:example-slug` |
| `investigator_ids` | multi-token semantic slug (no colon namespace) | `example-slug` | ✗ never `route:example-slug` |
| `item_id` | multi-token semantic slug or namespace `item:` | `item:example-slug` | ✗ never `route:example-slug` |
| `item_ids` | multi-token semantic slug or namespace `item:` | `item:example-slug` | ✗ never `route:example-slug` |
| `location_id` | multi-token semantic slug or namespace `location:` | `location:example-slug` | ✗ never `route:example-slug` |
| `lookup_ref` | multi-token semantic slug or namespace `decision:` | `decision:example-slug` | ✗ never `route:example-slug` |
| `lost_equipment_ids` | multi-token semantic slug or namespace `item:` | `item:example-slug` | ✗ never `route:example-slug` |
| `lost_weapon_ids` | multi-token semantic slug or namespace `weapon:` | `weapon:example-slug` | ✗ never `route:example-slug` |
| `marker_id` | multi-token semantic slug or namespace `marker:` | `marker:example-slug` | ✗ never `route:example-slug` |
| `matched_affordance_ids` | the exact affordance_id handle copied verbatim from scene.context action_routes[*].affordance_id (namespace `affordance:`); never synthesized from route_id or any bare route id | `affordance:example-slug` | ✗ never `route:example-slug` |
| `mechanics_ref` | multi-token semantic slug (no colon namespace) | `example-slug` | ✗ never `route:example-slug` |
| `notebook_entry_ids` | multi-token semantic slug or namespace `notebook:` | `notebook:example-slug` | ✗ never `route:example-slug` |
| `npc_id` | multi-token semantic slug or namespace `npc:` | `npc:example-slug` | ✗ never `route:example-slug` |
| `npc_ids` | multi-token semantic slug or namespace `npc:` | `npc:example-slug` | ✗ never `route:example-slug` |
| `obligation_id` | the exact obligation handle copied verbatim from turn.output_context required_obligation_ids (namespace `roll:`, `first-impression:`, or `sanity_bout:`); when turn.output_context presents no obligations, submit `coverage` as an empty array instead of any placeholder row | `roll:example-slug` | ✗ never `route:example-slug` |
| `obligation_ids` | the exact obligation handle copied verbatim from turn.output_context required_obligation_ids (namespace `roll:`, `first-impression:`, or `sanity_bout:`); when turn.output_context presents no obligations, submit `coverage` as an empty array instead of any placeholder row | `roll:example-slug` | ✗ never `route:example-slug` |
| `observable_fact_refs` | multi-token semantic slug (no colon namespace) | `example-slug` | ✗ never `route:example-slug` |
| `opening_required_npc_ids` | multi-token semantic slug or namespace `npc:` | `npc:example-slug` | ✗ never `route:example-slug` |
| `opening_required_secret_ids` | multi-token semantic slug or namespace `secret:` | `secret:example-slug` | ✗ never `route:example-slug` |
| `original_check_decision_id` | `{prefix}{slug}` with prefix one of the listed DECISION_ID_PREFIXES; or `quick-start:` / `setup-complete:` colon forms; `tN-` on prefixed forms only; `:finalize` on prefixed and colon forms | `roll-persuade-arty-access-v1` | ✗ never `first-impression-arty-wilmot` |
| `override_id` | multi-token semantic slug or namespace `override:` | `override:example-slug` | ✗ never `route:example-slug` |
| `pregen_id` | canonical vocabulary token; machine namespaces and opaque tokens rejected | `starter` | ✗ never `job-not-a-pregen` |
| `presented_roll_ids` | multi-token semantic slug or namespace `roll:` | `roll:example-slug` | ✗ never `route:example-slug` |
| `price_ref` | multi-token semantic slug (no colon namespace) | `example-slug` | ✗ never `route:example-slug` |
| `promise_id` | multi-token semantic slug or namespace `promise:` | `promise:example-slug` | ✗ never `route:example-slug` |
| `quest_id` | multi-token semantic slug or namespace `quest:` | `quest:example-slug` | ✗ never `route:example-slug` |
| `record_id` | multi-token semantic slug or namespace `record:` | `record:example-slug` | ✗ never `route:example-slug` |
| `refs` | multi-token semantic slug (no colon namespace) | `example-slug` | ✗ never `route:example-slug` |
| `rescuer_id` | multi-token semantic slug or namespace `npc:`, `person:` | `npc:example-slug` | ✗ never `route:example-slug` |
| `rescuer_ref` | multi-token semantic slug or namespace `npc:`, `person:`, `actor:` | `npc:example-slug` | ✗ never `route:example-slug` |
| `resolution_event_ids` | multi-token semantic slug (no colon namespace) | `example-slug` | ✗ never `route:example-slug` |
| `resolution_roll_id` | multi-token semantic slug or namespace `roll:` | `roll:example-slug` | ✗ never `route:example-slug` |
| `revision_event_ref` | multi-token semantic slug (no colon namespace) | `example-slug` | ✗ never `route:example-slug` |
| `roll_ids` | multi-token semantic slug or namespace `roll:` | `roll:example-slug` | ✗ never `route:example-slug` |
| `route_id` | multi-token semantic slug or namespace `route:` | `route:example-slug` | ✗ never `affordance:example-slug` |
| `route_ids` | multi-token semantic slug or namespace `route:` | `route:example-slug` | ✗ never `affordance:example-slug` |
| `route_ref` | multi-token semantic slug or namespace `route:` | `route:example-slug` | ✗ never `affordance:example-slug` |
| `route_refs` | multi-token semantic slug or namespace `route:` | `route:example-slug` | ✗ never `affordance:example-slug` |
| `ruleset_id` | multi-token semantic slug or namespace `ruleset:` | `ruleset:example-slug` | ✗ never `route:example-slug` |
| `run_id` | `{prefix}{slug}` with prefix `run-` | `run-example-slug` | ✗ never `example-slug` |
| `scenario_id` | multi-token semantic slug (no colon namespace) | `example-slug` | ✗ never `route:example-slug` |
| `scene_id` | multi-token semantic slug or namespace `scene:` | `scene:example-slug` | ✗ never `route:example-slug` |
| `seed_ids` | multi-token semantic slug (no colon namespace) | `example-slug` | ✗ never `route:example-slug` |
| `selected_affordance_ids` | the exact affordance_id handle copied verbatim from scene.context action_routes[*].affordance_id (namespace `affordance:`); never synthesized from route_id or any bare route id | `affordance:example-slug` | ✗ never `route:example-slug` |
| `social_adjudication_ref` | multi-token semantic slug (no colon namespace) | `example-slug` | ✗ never `route:example-slug` |
| `source_effect_id` | multi-token semantic slug or namespace `roll:`, `state:`, `rule:`, `check:`, `narration_contract:`, `effect:` | `roll:example-slug` | ✗ never `route:example-slug` |
| `source_event_ids` | multi-token semantic slug (no colon namespace) | `example-slug` | ✗ never `route:example-slug` |
| `source_id` | `pdf_index-<n>` or namespace `pdf:`, `module:`, `source:`, `handout:` | `pdf:haunting-full` | ✗ never `foo` |
| `source_ids` | multi-token semantic slug or namespace `roll:` | `roll:example-slug` | ✗ never `route:example-slug` |
| `source_ref` | exact handle `player_input:current` or namespace `narration_contract:` | `player_input:current` | ✗ never `player_input:other` |
| `source_refs` | `pdf_index-<n>` or namespace `pdf:`, `module:`, `source:`, `handout:` | `pdf:haunting-full` | ✗ never `foo` |
| `source_roll_id` | multi-token semantic slug or namespace `roll:` | `roll:example-slug` | ✗ never `route:example-slug` |
| `source_roll_ids` | multi-token semantic slug or namespace `roll:` | `roll:example-slug` | ✗ never `route:example-slug` |
| `start_location` | multi-token semantic slug (no colon namespace) | `example-slug` | ✗ never `route:example-slug` |
| `start_location_id` | multi-token semantic slug or namespace `location:` | `location:example-slug` | ✗ never `route:example-slug` |
| `subject_id` | multi-token semantic slug (no colon namespace) | `example-slug` | ✗ never `route:example-slug` |
| `subject_ref` | exact handle `pc:current-investigator` | `pc:current-investigator` | ✗ never `pc:inv-other` |
| `substantive_effect_ids` | multi-token semantic slug or namespace `effect:` | `effect:example-slug` | ✗ never `route:example-slug` |
| `target_id` | multi-token semantic slug (no colon namespace) | `example-slug` | ✗ never `route:example-slug` |
| `target_npc_id` | multi-token semantic slug or namespace `npc:` | `npc:example-slug` | ✗ never `route:example-slug` |
| `thread_id` | multi-token semantic slug or namespace `thread:` | `thread:example-slug` | ✗ never `route:example-slug` |
| `trigger` | multi-token semantic slug (no colon namespace) | `example-slug` | ✗ never `route:example-slug` |
| `trigger_id` | multi-token semantic slug or namespace `trigger:` | `trigger:example-slug` | ✗ never `route:example-slug` |
| `weapon_effect_ids` | multi-token semantic slug or namespace `effect:` | `effect:example-slug` | ✗ never `route:example-slug` |
| `weapon_id` | multi-token semantic slug or namespace `weapon:`, `item:` | `weapon:example-slug` | ✗ never `route:example-slug` |

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

   **Social difficulty is adjudicated, not defaulted to regular.** Before a
   meaningful social roll, call `rules.social_adjudicate`: feasibility first
   (is this goal even rollable now?), base difficulty from the NPC's defense
   (higher of Psychology or the approach skill: <50 regular / 50-89 hard /
   90+ extreme), then motive (support −1 / oppose +1..2, with evidence refs),
   then strategic leverage (max two independent items), and bonus/penalty dice
   only after the difficulty is fixed. The same goal with unchanged motive and
   leverage replays the original adjudication — switching from Persuade to
   Fast Talk does not reopen it. When it returns `conditional`, work the
   recorded requirements instead of rerolling.
   When feasibility is `roll`, pass the returned `goal_key` as
   `social_adjudication_ref` to `rules.roll` together with the exact returned
   skill, difficulty, bonus/penalty dice, and `npc_id`. That reference is
   consumed by the one canonical roll; a fresh `decision_id` cannot reroll the
   same commitment. Any listed prefix is valid on any `decision_id`; `rules.roll`
   commonly uses `roll-` (RIGHT: `roll-persuade-arty-access-v1`; ✗ never
   `persuade-arty-morgue-access` — a readable slug with no accepted prefix is
   rejected). A legal Push still uses `rules.push`. The bound roll also
   carries the structured `outcome_ceiling`; narration may realize only the
   recorded goal scope, target-NPC fact refs, scene truth tier, and forbidden
   fact boundary.
   **Psychology runs keeper-concealed by default.** Use
   `rules.psychology_observe` in two steps. First `action=settle` binds
   `observer_scope + npc_id + conversation_window_id + observation_revision`
   to exact typed `observable_fact_refs` and settles one hidden roll. For a
   first meeting or same-turn observation, call `npc.query` for the exact
   target and form `npc_fact:<npc_id>/<fact_id>` from a returned `facts[]`
   row. This target-bound Keeper truth is digest-only audit grounding, not
   strategic leverage and not player knowledge. Previously delivered
   observations use `clue:<clue_id>` or `event:<event_id>` only after they are
   player-known. Bare IDs and arbitrary free text are invalid. Use the
   selected party investigator id or literal `team:party` as the entry; both
   normalize to the same canonical current-party window, while the selected
   `investigator` remains the skill owner. Never invent team aliases. Then
   call `action=realize` with that `insight_id`, the same full identity, and
   player-safe `visible_observation`; only this second payload may enter
   narration. A revision above zero requires a distinct canonical
   `revision_event_ref` whose event type is an allowed boundary (decisive new
   evidence, identity exposure, threat/hostility change, confession/betrayal,
   re-encounter, or scene change). One event opens exactly one next revision;
   ordinary NPC-state changes do not reopen it. Narrate only behavior-level observations:
   the player never sees the roll, the outcome, or whether it failed. Success
   yields an evidence-grade read ("his answer was not improvised"), not the
   NPC's inner monologue; ordinary failure gives shallow or inconclusive
   reads rather than a reliable opposite; on a fumble give one confident but
   wrong read. Do not run Psychology after every NPC line — only against a
   concrete observation question.
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
   the envelope and style contract — not a keyword gate). In Pi play the same
   tool is required once per pending draft revision for the narrow agency
   ownership boundary: `agency_violation` alone blocks acceptance; every
   prose-quality finding remains advisory.
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
   and a unique closed-grammar `decision_id` with an accepted prefix such as
   `npc-` (RIGHT: `npc-first-impression-arty-wilmot`; ✗ never
   `first-impression-arty-wilmot` — a readable slug without an accepted prefix
   is rejected). Pass each exact `first_impression_ref` plus its
   KP-authored `first_impression_realization` into that pair's own
   `state.record_npc_engagement`. The public D100 uses max(APP, Credit Rating),
   is frozen once per investigator/NPC pair, and reports the chosen basis,
   value, and achieved level. The realization must explain the NPC's concrete
   immediate response while preserving authored agenda, existing relationship,
   scene/safety/authority constraints, and the investigator's actual conduct.
   If several first contacts occur in the same opening or beat, keep the
   pair-specific operations separate but issue all independent `npc.reaction`
   tool calls in one host batch, followed by all independent engagement writes
   in one host batch. Never serialize one model round trip per NPC.
   A critical or fumble first impression needs its own independent
   source-bound `state.exceptional_effect`; multiple exceptional first
   impressions in one journal never share or overwrite an effect.
   For `open_turn_recovery`, the host's semantic player-input card and active
   recovery tools are authoritative for the already accepted turn. Use
   `scene.context` / `actions.list` only as needed, reuse each successful
   current-turn receipt, and settle only missing mechanics before journaling.
   This is the ordinary acting surface restored for one exact worldline/turn,
   not a fixed rule-family workflow. Accept no new player input or setup work.
   Once mechanics settle, continue with the ordinary closure below.

   Then close every played turn with `state.journal` (summary, intent class,
   tension, and exact `player_text`; pass the current `run_id` when one is
   active). Never condense or rewrite `player_text`. On a terminal turn, call
   `state.end_session` before that journal.
   Next call `turn.output_context`; it automatically binds the latest
   unfinalized journal and discovers all settled sources. Write the exact
   fictional draft as paragraphs. Treat `npc_performance_constraints` as
   Keeper-only portrayal context: realize each `observable_manner` naturally,
   but never print its causal explanation, opportunity/friction, or preserved
   boundary as a player-facing analysis block. Normally omit
   `mechanics_placements`: the canonical finalizer derives the safe causal
   placement from coverage and inserts later state/asset/effect blocks exactly
   once. On a direct, non-reviewed surface, use explicit placement rows only
   for deliberate interleaving. Every public-roll consequence must remain in a
   later paragraph than its roll. Supply one closed coverage row per
   obligation, then call `turn.finalize`. Send only its exact
   `rendered_text`. In Pi play, first follow its exact
   `agency_review_operation`: review the same draft/turn/source/revision and
   bind every declared player-state change to the exact current frozen effect
   in `state_authority_review`. On a clean review, use its
   `finalize_agency_binding`: submit one semantic coverage row per offered
   `obligation` by copying it into `obligation_ref`, choosing an allowed
   `reviewed_span`, and supplying the
   closed semantic disposition fields; submit agency as
   `reviewed_span`/`claim_type`/`authority`. The host binds the review ID,
   accepted draft, canonical obligation ids, verbatim excerpts, safe mechanics
   placement, PC, and sources. The post-review model surface has no `draft`,
   coverage excerpt, paragraph index, or mechanics source-id argument. An unauthorized PC
   voluntary/internal claim or ungrounded player-state claim requires the same
   narration-only revision 2; rules, state, journal, coverage, and mechanics
   remain frozen. Pi host independently compiles the exact draft for PC state
   claims and injects its private receipt after the Keeper arguments are fixed;
   never author or pass that hidden field. `turn.finalize.advisory_uptake` is only for a candidate
   actually adopted or modified in this draft; when advice is ignored, omit
   `advisory_uptake` entirely (an optional `evidence.record_adoption` call may
   record the ignored disposition). Never put all of a turn's rolls at the end
   after their consequences have already been narrated. Invoke
   authoritative mutating tool calls in the decided order, never in parallel.
   Dice, resources, critical state, journal, ending, and development
   settlement and finalization are never background work; only append-only audit or mirror
   flushing may be deferred.
   Item changes are state too: when the fiction grants, removes, or moves a
   possession (found gear, a purchase, a seized weapon, a spent ledger),
   call `state.item_grant` / `state.item_remove`, and use
   `state.inventory_list` to check current holdings (an investigator's or an
   NPC's). Before granting or resolving a weapon, spell, creature, or other
   table-entity id, call `rules.catalog_search` for candidates, then choose
   the exact `entity_id` semantically (keep multiple candidates on
   ambiguity; never regex-auto-pick the first string match). The consumer
   (`state.item_grant`, `combat.resolve`, `spell_by_name` / `monster_by_name`)
   validates that id and fail-closes on unknown rows. Catalog output is
   Keeper-only advisory; never dump `secret:true` rows or the raw candidate
   list to the player. A granted *validated* weapon is a legal combat `weapon_id` at once; a weapon
   taken by a successful disarm maneuver commits automatically when the
   combat ends. Looting a downed or surrendered opponent is explicit:
   `state.item_grant` to the looter plus `state.item_remove` from the NPC.
   Use-it-up gear (bandages, laudanum doses, torches, a handful of shells
   carried loose) is granted with `consumable: true` and `quantity: N`; when
   the fiction spends it, call `state.item_use` — the charge count drops and
   at zero the item leaves the inventory. `state.item_use` rejects
   non-consumables: losing or spending those is `state.item_remove`.
   Cash is the same rule: when the fiction pays, is paid, loots coin, or
   spends a fee, call `state.cash_grant` or `state.cash_spend` **before** the
   prose treats the purse as changed. Required: structured `amount`,
   `currency`, `source` id, internal audit `reason`, and player-safe
   `localized_reason` written fully in the current `play_language` (`zh-Hans`:
   complete Chinese, not the audit string). The tool stamps campaign
   `game_time`; never pass wall-clock / `recorded_at`. Each currency has its
   own balance — never convert or mix FX. ASCII currency codes are
   case-insensitive (`usd`→`USD`); `美元`/`英镑` alias to `USD`/`GBP`.
   Omit `unit` to reuse the recorded unit for that wallet. Query with
   `state.cash_query`. Current cash, Assets, living standard, and inclusive
   Spending Level are on `scene.context` `party_investigators[].finance` and
   `state.finance_query`, never the chargen sheet or
   `toolbox-asset-heads.json`. Player-visible cash lines come from
   `turn.finalize` only: localized reason plus game/player time, never raw
   `reason` or `recorded_at`.
   Do not invent a second finance path, parse sheet cash prose, or spend from
   `rules.cash_assets` / `state.cash_semantic`. Insufficient funds fail
   closed; replay the same `decision_id` to retrieve the settled receipt.

Finance is KP semantic judgment, not a tool order or narrative gate. Choose
from current runtime numbers, then call at most the operation the fiction
needs:

- Routine living-standard accommodation, food, and incidental travel: usually
  narrate with no bookkeeping.
- Durable item acquisition within the inclusive Spending Level:
  `state.purchase` with `payment_mode=spending_level`.
- Ordinary cash purchase: `state.purchase` with `payment_mode=cash`.
- Optional same-day KP aggregation: `payment_mode=aggregate_cash` with the
  full combined amount, never only the excess. There is no mandatory daily
  budget meter.
- Services or fees with no inventory: use the existing cash path only when
  bookkeeping is warranted (`state.cash_spend` / `state.cash_grant`).
- Cash shortfall may lead to a KP-chosen time advance (`state.advance_time`)
  then `state.assets_liquidate`. Do not auto-change Credit Rating.
- Loans, hiring, credentials, access, conspicuous status, and social leverage
  may call for Credit Rating judgment or a check rather than an inventory
  purchase. Difficulty stays KP semantic. Credit Rating never earns ordinary
  skill improvement ticks and purchases or liquidation never auto-change it.
  During the Investigator Development Phase it may change when financial
  circumstances warrant, by KP judgment and the rules' financial-development
  procedure.

Never sequential `state.cash_spend` then `state.item_grant` for a buy. Never
classify items by name or category in code or a keyword list.

If a tool reports a transient transaction or lock failure, retry the same
call with the same closed-grammar `decision_id` within the toolbox's bounded retry policy.
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

When combat leaves an investigator in the structured `dying` chain, read the
healing cards on `scene.context` (`rule_decision_cards` / `recovery.healing`)
and settle the matching card through `rules.settle`. Cards are suggestions of
what can be settled now; they never gate play. Pass the acting caregiver as
`semantic_inputs.rescuer_ref`. Settle the round-clock card before stabilization
and the hour-clock card while temporary stabilization lasts. The first First Aid
attempt is regular; second and subsequent attempts on the same wound need a
changed method plus an announced consequence in `semantic_inputs`. A successful
unstabilized CON clock or a failed hourly stabilization clock opens one new
subsequent-attempt window; it does not turn the wound back into a fresh regular
attempt. If no card appears — including First Aid more than an hour after the
wound — judge that as ordinary uncompiled long-tail; do not hunt for another
healing operation. When two distinct caregivers treat the same wound together,
select the same First Aid card and pass the second caregiver as
`semantic_inputs.assistant_rescuer_ref`; the host binds both First Aid values,
records two public rolls, and applies at most one HP/stabilization effect when
either succeeds. Do not wake or
stabilize a dying investigator with generic `rules.damage(kind=heal)` or by
editing the save; play may pause on `pending_resolution` until the applicable
healing cards settle it.

After the immediate rescue chain, do not repeat daily Medicine settlements as a
substitute for Major Wound recovery. Advance the in-fiction clock through the
remaining recovery interval, then settle the weekly-major-wound-recovery card
once the wound clock reaches a full week, with explicit `complete_rest` /
`poor_environment` facts. That settlement may include one caregiver Medicine
roll, then the CON recovery and 1D3/2D3 healing with canonical roll evidence. A
failed recovery consumes that weekly attempt; advance another full week before
trying again. Never claim that daily care erased `major_wound`.
Combat-position markers are not injuries. Once no combat is active and the
fiction actually ends one (for example, the investigator stands after being
`prone`), call `state.clear_transient_condition` with that narrated reason.
Never use it for `major_wound`, `dying`, `unconscious`, or `dead`; their healing
cards own those transitions.

### Quest surface (action-shaped quests)

Quests are the action-shaped goal layer: 委托 / 押送交付 / 救援保护 / 取回收集 /
阻止破坏 / 生存逃脱 / 社交谈判 / 恢复修复 / 到访探查 — the frozen nine
`quest_kinds`, mixed kinds allowed. Cognitive goals (查明真相, piecing the
truth together) are clue-graph conclusions and never become quests; the two
layers compose — a quest's `mainline_links` may feed conclusions — but do not
merge.

- **Know the surface.** `quest.map` is the advisory projection of quest
  status / importance / mainline links / completion progress for the current
  campaign and scene. Not-yet-offered quests stay keeper-only in it.
- **Offer and activate in fiction.** An authored quest becomes player-known
  only through a real fictional moment — the giver asks, the notice is read —
  via `quest.offer`; treat acceptance as your semantic judgment and record
  the start with `quest.activate`. Before `offered`, a quest never appears in
  player-safe projections.
- **Settle in two layers.** Machine-judged conditions (`clue_discovered` /
  `flag_set` / `clock_reaches`) settle automatically on their canonical event
  paths — never re-roll or re-check them by hand. A `narrative` condition is
  never machine-decided: judge whether the fiction earned completion, then
  close it explicitly with `quest.settle` so the receipt lands. Failure and
  abandonment settle through the same explicit path.
- **Pressure, not gates.** Quest progress, deadlines, and quest failure are
  narrative pressure only; they never block actions, scene moves, or endings.
- **Player guesses are not offers.** "我们接了 X 的委托" in player prose does
  not make a quest offered or active — intercept per the player knowledge
  boundary and let the quest surface be earned in fiction. The reverse
  direction is real: a commission you create at the table becomes canon
  through `quest.improvise` (`provenance: campaign-improvised`) under the
  controlled-improvisation discipline — never a lever for number or secret
  authority.
- **Language.** Player-visible quest wording (title, summary, deadline
  display) uses `play_language` (default zh-Hans), preferring `localized_title`
  / `localized_text`; `brief` and condition descriptions are keeper-only.

### Temporal memory and worldlines

The campaign's long-term memory is temporal: every finalized turn is an
immutable history point, and worldlines can fork or merge while all previous
history stays untouched. `state.*` / `rules.*` remain the only authority for
facts and numbers; the operations below are read-only projections or
receipted writes over that history, and every one of them is a semantic KP
surface — no keyword rules anywhere in this lane.

- **Exact-operation loading for this lane.** These typed tools are long-tail
  and are not in the live baseline. When current judgment needs one concrete
  operation, load exactly it with one precise `coc_discover` call —
  `{"operation":"memory.recall"}` — then invoke the returned typed tool
  (`coc_memory_recall`). Never call `coc_discover` with no arguments and
  never discover a whole domain/namespace during play: no catalog or domain
  browsing for awareness, reassurance, or confirmation (oversized namespaces
  fail closed). The grant is stage/phase/role-scoped and expires when the
  turn settles; re-load only for a later concrete need. This is a bounded
  loader, not catalog exploration — no fixed pipeline, no quota; load only
  when semantically relevant.
- **Temporal memory recall.** When you need what a subject knows, believes,
  or misremembers right now — an NPC reunion, a callback the pacing could
  use, the player referencing old events — call `memory.recall` with
  structured filters (subject knower, timeline, valid-time turn, entities,
  scene, privacy). It deterministically narrows candidates (memory state,
  validity interval, provenance attached); **you** choose relevance
  semantically and weave only what earns its place. Recall is advisory
  context, never truth, and carries no per-turn quota.
- **Adjudicating memory candidates and player assertions.** A player's claim
  about relationships or past events (「馆长早就认识我」) is input to
  adjudicate, not narration to echo: recall shows whether it exists only as
  an unadjudicated player assertion; settle it through `memory.adjudicate`
  (adopt / modify / set memory state / reject) without leaking module truth.
  Distorted, implanted, or contradictory memory keeps its history — old
  cognition is superseded, never deleted. Keeper-only rows never reach the
  player without earned play.
- **Extraction backlog (never a blocker).** A finalized turn can enqueue one
  semantic memory-extraction entry awaiting KP settlement. When an entry
  becomes relevant — a later turn would naturally use the memory it would
  produce, or adjudication references it — call `memory.extraction_status`
  for the deterministically ordered backlog (backlog id, timeline, turn,
  enqueue reason, status; an explicit empty list when nothing is pending),
  then settle one entry at a time through `memory.extraction_settle`:
  `recovered` routes your candidate result for that turn's job through the
  extraction core and materializes every verified candidate as a
  contract-valid assertion; `abandoned` records your concise reason while
  keeping all candidate data intact. Idempotent per `decision_id`. Play
  never waits on the backlog, and there is no settle quota.
- **History queries use semantic anchors.** `history.query` answers what was
  authoritatively true at one history point (timeline + settled turn,
  default active); `history.diff` compares two settled turns, field-level
  and grouped by subject, possibly across timelines. Anchor both
  semantically — 「第 12 回合时托马斯的状态」, 「从第 8 回合到第 15 回合」.
  Never ask the model or the player to copy, read, or echo a commit SHA,
  digest, or ref: machine identity is attached and verified by code. Both
  are strict read-only.
- **Rewind / counterfactual / fork play.** A player may naturally ask to
  rewind, explore a counterfactual, or branch the story (「要是刚才没进地下
  室就好了」「回到进宅子之前」). Interpret the intent semantically — a wistful
  remark or in-fiction speculation is not a fork request; when ambiguous,
  ask. Before any worldline change, confirm explicitly with the player in
  `play_language` (「你是想从第 8 回合分出一条新时间线吗？」). After
  confirmation, `timeline.fork_request` records the request receipt only
  (source timeline, fork point, semantic new-timeline id, motive) — a
  request alone never switches the active timeline — then
  `timeline.fork_confirm` creates the branch and moves play onto it; the
  old line and its history stay immutable. Never fork automatically from
  phrasing, and never treat an unconfirmed request as already active.
- **Worldline confluence.** When the player asks to merge lines (「把这两条
  线合起来看看」), confirm explicitly, then `timeline.confluence_query`
  returns the **complete** conflict list — hard-state conflicts with
  deterministic resolver diffs plus KP-semantic conflicts (identity, cause,
  memory) — each with both sides and provenance. Disposition **every**
  conflict yourself (`choose_left` / `choose_right` / `combine` /
  `duplicate` / `transform` / `paradox` / `sacrifice` / `defer`); `defer` is
  explicit narrative debt, never a skipped row. Non-duplicable mechanics —
  roll receipts, one-time effects, consumed resources, death — never settle
  twice: `combine` / `duplicate` are rejected for them and they stay single.
  Hard-state numbers come from the resolver receipt; never hand-merge
  arithmetic. Only with every disposition complete does
  `timeline.confluence_confirm` record the merged third timeline (two
  immutable parents) and its receipts, and the next turn lands on it. There
  is never a silent JSON merge of two worldlines.
- **Cross-timeline memory boundary.** The player knowing both lines is
  player meta-knowledge, not character memory. Only an explicit recorded
  transfer creates character memory on another line (a cross-timeline echo
  with source, credibility, distortion, privacy, and cause) — recorded
  through `timeline.transfer` (semantic source/target timelines, chosen
  assertions with credibility/distortion/privacy — privacy may only tighten
  — and your KP cause; source anchors are machine-resolved, and any returned
  cost requests go through their owning `rules.*` / `state.*` writes); never
  invent cross-line recall, and never narrate the other line's events as
  something this line's characters remember. Meta-feelings can be part of
  the horror — they are not character information.
- **Exact transcript verification (two steps, never reconstruction).** When
  the player asks to verify earlier wording (「你刚才那句原话是什么？」) or a
  beat needs an exact past line, wording never comes from `memory.recall`
  assertions, the `temporal_capsule`, folded payloads, or your own recall of
  the scene — those are summaries and provenance, not wording. Step 1:
  `transcript.locate` with structured scope only (timeline, turn or bounded
  turn range, role, and a finalization/journal identity when known — never
  free prose) returns bounded candidate cards (turn, role, speaker, text
  size, integrity status) without the text. Step 2: `transcript.read` on
  the chosen candidate's semantic ref returns the exact hash-verified text
  for that row (finalized Keeper rows are checked against the finalization
  receipt). Quote only from that return. Historical timelines resolve
  through code — never read logs directly, never accept a commit hash or
  digest from the player, and keep keeper-only rows out of player prose.
- **Exact delivery replay (latest finalized output).** When the player
  semantically reports that the latest finalized Keeper reply never reached
  their screen, or asks for that exact delivery to be sent again
  (「刚才那段没有显示」「把刚才那段原样再发一遍」), invoke typed
  `session.delivery_text` with `mode: "replay"` — that one call is the whole
  replay. The host owns the canonical delivery identity and the replay
  mechanics: it reattaches the machine-only identity itself and re-emits the
  exact finalized text as player-visible events, so you pass no ids, hashes,
  or offsets and write no replacement text. Judge the request semantically —
  a blank screen, transport loss, or an explicit resend request is replay;
  an in-fiction「你再说一遍？」is ordinary play, never a replay call — and
  never trigger it by keyword or pattern. While the replay settles you must
  not paraphrase, journal, reroll, mutate state, call `narration.review` /
  `turn.finalize`, or emit any additional player-visible prose alongside it.
  This lane covers the **latest** finalized delivery only: verifying or
  quoting older wording still uses `transcript.locate` / `transcript.read`
  above, and ordinary transcript lookup and context reads remain unchanged.
- **Tools stay invisible.** The player never calls or names timeline,
  history, memory, or transcript operations and never needs to know they
  exist. Surface a fork or confluence as table experience — a new thread of
  the story opening, two threads braiding into one — in `play_language`,
  honoring the operational-invisibility invariant. None of this is a turn
  pipeline, quota, or blocking narrative gate: ordinary turns never require
  a recall, history, timeline, or transcript call.

### Source-first NPC and item mechanics

When a source NPC with armed or combat potential is materially present and
conflict is semantically approaching, call `mechanics.ensure` early if its
profile is not ready. This is a semantic judgment, not a quota for every NPC or
every turn. Observation, positioning, parley, and other play that does not
depend on the missing numbers may continue. A source/special item still calls
`mechanics.ensure` when it first needs rules parameters.

Authored appendix or chapter-end data always wins. Bundled (non-progressive)
scenarios resolve the same authored truth from their compiled combat-engagement
affordances plus the reviewed ruleset monster row: `mechanics.ensure` then
returns `ready` with `authority: "compiled_module"` and combat proceeds on it;
a fail-closed `mechanics_source_unavailable` means no such data and no
progressive project exist — surface the gap, never invent stats. If
`mechanics.ensure`
returns `source_work_required`, or `combat.resolve` returns
`mechanics_not_ready`, consume its exact returned `background_takeover`. On Pi
the package auto-dispatches the private coordinator; the main KP must not
discover or invoke `progressive.claim_host_work`,
`progressive.fulfill_host_work`, `progressive.renew_host_work_leases`, or
`progressive.release_host_work_leases`, and must not author a pack. On another
host, execute only the exact capability-selected claim/spawn or coordinator
action. A task-return fallback exact-forwards each unchanged `results[i]` once
on natural completion; never poll or retrieve output. Never bypass the request
with `rules.roll`,
`rules.opposed`, `rules.damage`, copied stub values, or a generic profile. The
current mechanics-dependent settlement may remain pending under the existing
`blocking_micro` semantics; this adds no new narrative or output gate, and
non-dependent live play may continue. Fulfill the exact cached pages and every
listed same-page `batch_subject` once; never generate over a possible authored
profile or reopen the same PDF scope for each later question.

On Grok direct submit, retain the source-child rule below: never call
`get_task_output` or `get_command_or_subagent_output`, wait, poll, retrieve a
receipt, or call `progressive.fulfill_host_work` in the parent. After direct
submission, only the same current action or a later naturally needed action
may retry canonical `mechanics.ensure` or `combat.resolve` to consume the
durable profile. Do not spin, issue a reassurance query, or recreate child
values in the parent.

Fallback generation is legal only for a genuinely improvised/campaign-local
subject or a source subject with an accepted `not_authored` absence receipt.
The KP chooses the semantically fitting archetype or comparable base weapon;
the tool freezes that profile in campaign state and reuses it. If authored
data later conflicts, preserve both as continuity contradiction evidence—no
silent replacement. Pre-7e 3–18 source characteristics must be host-normalized
to runtime percentile values while preserving their original scale and values.

`combat.resolve(target_npc_id=...)` attacks a present non-affordance NPC using
the same CombatSession as authored encounters. A special weapon's typed effect
may be passed as `weapon_effect_ids` only after the KP semantically establishes
its structured applicability to the current target. The combat damage receipt
then binds the effect IDs and deterministic multiplier. Applicability is never
inferred by keyword matching names, tags in prose, or the player's wording;
unsupported special rules stay `keeper_advisory` until the KP settles them
through an appropriate canonical rules/state operation.

## Optional background scene adviser

**Normative when routed.** `coc.advisory-sidecar.v1` is an optional cognitive
sidecar, not a second Keeper, turn pipeline, quality gate, or reason to weaken
the main KP. Its machine contract is
`plugins/coc-keeper/references/advisory-sidecar-v1.json`.

Use at most one when a genuinely complex beat benefits from a second look—for
example several acting NPCs, a compound declaration, exceptional result, major
transition, continuity contradiction, or difficult character-specific Table
Wit. Never spawn by quota or merely because the host supports subagents. The
main KP must complete the turn if the child is unavailable, late, malformed,
stale, ignored, or rejected.

Build the packet only from facts already in the bounded working set; do not
call tools to fill it. Stay within the contract's 6144-byte budget and never
include the whole transcript/module, raw tool envelopes, filesystem paths, or
hidden chain-of-thought. Required fields include contract/packet and campaign/
turn/scene/language identities, exact `player_action`, and bounded
`scene_facts`, `npc_facts`, `continuity_facts`, and `requested_lenses`.

On Grok v1, only when capability discovery returned
`coc_advisory_sidecar_v1=true`, spawn `coc-keeper:coc-scene-adviser` with
`background=true` and `capability_mode=read-only`. The task prompt is **one bare
`coc.advisory-sidecar.v1` JSON object**—no prose wrapper, roll question,
transcript, raw receipt, or alternate output contract. Continue the main KP's
work immediately; **never wait for the child**. Before final prose, inspect at
most once with `get_command_or_subagent_output` and no timeout; discard
unfinished, failed, malformed, mismatched, or stale output and cancel unfinished
work when practical. Other hosts keep this craft inline until a same-contract
adapter exists; never emulate it with a new headless process.

The child never decides player intent, epistemic boundaries, rolls, stakes,
clue authority, source truth, mutations, finalization, or final prose. If a
completed suggestion was actually considered, record its `suggestion_id` with
`evidence.record_adoption` and the concise semantic disposition. Agreement with
a decision already made **must not be back-claimed** as adoption. Bind a
finalization ID and exact excerpt only when adopted content reached delivered
text. If inspection happens after `state.journal`, finalize first and record
adoption before display; **never insert an adoption mutation** between journal
and finalization.

Do not save raw packets, child transcripts, or unused suggestions. If adopted
advice changes durable meaning, project only that meaning through
`state.journal.continuation`; immediate scene texture needs no checkpoint row.
This preserves bounded checkpoint and continuation budgets.

## Background progressive source packs

An `awaiting_scope` row is advisory unparsed-source debt, not claimable
source-pack work: the pages it needs are not cached yet and the S1 full-parse
lane supplies them in the background. The live KP never reads pages, waits,
polls, or claims while `ready_for_background_count=0`; page selection and
delivery belong to the steward (`steward.deliveries`). Once the pages are
cached, the existing claim/leaf/fulfill path handles the row unchanged.

`coc.source-pack-worker.v1` is a separate source-compilation contract, not the
scene adviser and never a second Keeper. Use it only when host capabilities say
`coc_source_pack_worker_v1=true`. The canonical machine contract is
`plugins/coc-keeper/references/source-pack-worker-v1.json`.

`coc.source-coordinator.v1` is the optional host-side manager contract at
`plugins/coc-keeper/references/source-coordinator-v1.json`. Use it only when
capabilities explicitly advertise `coc_source_coordinator_v1=true`, status
`experimental`, a supported exact-forward adapter, and a positive leaf maximum.
On Codex the main KP launches one context-free collaboration subagent with
`fork_turns=none` in the background and passes the exact
`progressive.background_takeover.coordinator_dispatch.codex_task` as its entire
message without a model override; `model_policy=inherit_parent` preserves the
current parent-window model through coordinator and leaf. A supported custom-agent
host instead launches
`coc-source-coordinator` with the exact `packet`. Both are produced by the
canonical scene projection; the KP never builds or edits them. The manager
calls claim once, invokes one exact
source-pack leaf per returned packet, reads each leaf result once, and forwards
every exact usable `results[]` row through `progressive.fulfill_host_work`.
It cannot read source pages, repair output, retry in the same task, or make KP
decisions. The KP continues immediately and never retrieves the manager's
summary. Failure summaries use stable classes: one occurrence may be transient,
but three observed occurrences of the same class on the same adapter require a
design review. This escalation is observability, not a runtime or prose gate,
and never gates player input. Task support alone is insufficient; never infer
nested MCP access from the host
brand, model name, or a successful generic child Task.

During fresh source-bundle setup, begin a pre-confirmation opening warm start
after `scenario.bind_pdf`. Use `progressive.prepare_opening` only to
semantically select one structured `{location_id,title}` and the shortest
sufficient accepted contiguous 1–3-page current-opening window from bounded
previews. Then invoke `progressive.opening_bootstrap` once. The main KP never
exact-reads candidate pages, publishes a skeleton, requests a pack, projects
the opening, or authors/fulfills the pack on this path.

The bootstrap derives an unresolved-clock skeleton, sparsely projects only a
pristine campaign, queues the exact `partial_opening` request, and records a
campaign-owned watch. The isolated worker's result must include required
`coc.opening-setup-observation.v1` `opening_setup`: exact source-supported
clock precision and request-window refs, or `unresolved` with no clock fields.
Fulfillment applies it before the exact watch auto-projects. This eliminates
KP projection ceremony; it does not create a narrative or player-action gate.

After that setup request, or after an enter/dig/mechanics call exposes open host
work, Pi stops at the projection and lets the package auto-dispatch the private
lifecycle. The main KP performs none of the four claim/fulfill/renew/release
operations. It retains the accepted prepare/bootstrap receipt, dispatch key,
and campaign watch; while the lifecycle is open it does not call
`progressive.status`, repeat preparation/bootstrap, or re-dispatch. If the
dependent opening boundary arrives first, it passively awaits the one host
terminal notice. Terminal `fulfilled` is adopted through the next naturally
needed canonical query that exposes the watch's auto-projected `opening_setup`;
terminal failure is a recovery boundary, not a polling loop. On other hosts,
follow the projection's `dispatch_mode`. One ready group uses
`direct_single_leaf`: execute its one host-selected `next_host_action` before
any other host operation. On Codex this spawns the exact small task; the child
claims and compiles its one packet in the same task, so the parent never leases
a full packet before spawn. Its Tier 1 result
returns naturally to the spawning parent, which forwards each exact
`results[i]` once through the action's returned natural-completion operation
without polling, output retrieval, or rediscovery. A named-submit host receives
only its own claim-and-spawn action. Multiple independent groups use one of two
host-selected multi-leaf modes:
- `coordinator_fanout` when `coc_source_coordinator_v1=true` (Codex nested
  manager -> leaf exact-forward).
- `parent_flat_fanout` when `coc_source_parent_fanout_v1=true` (Grok depth-1
  top-level manager): execute the exact `claim_then_spawn_named_workers`
  `next_host_action` once—claim with the prefilled limit and
  `result_delivery=named_submit`, then spawn one background unqualified
  `coc-source-pack-worker` per returned `dispatch_tasks[]` value. Never nest a
  coordinator, retrieve child output, or call `progressive.fulfill_host_work`.
If neither multi-leaf capability is advertised, fall back to one direct-leaf
claim under `coc_source_pack_worker_v1` with a stable host/session executor id
and a limit no greater than `max_background_source_workers`. During the
pre-confirmation warm start, claim once only. The operation coalesces exact page
scopes, leases them for crash recovery, and for `named_submit` returns one exact
`coc.codex-source-pack-task.v1` dispatch task per independent page group. The
Codex direct-single child claims with `task_return_to_parent`; its inner packet
uses `return_to_parent` because a generic native child does not inherit the
source-submit-only MCP. It only leases
fully cached scopes in v1. If a request needs uncached pages, the main host PDF
skill creates the smallest exact source-bundle window, registers it through
`progressive.register_source_bundle`, and claims again; never let repository
code or the child parse the original PDF.

The serialized returned dispatch task JSON is the entire child task prompt: add no
prefix, suffix, transcript, optional-row request, or schema hint. On Grok,
actually spawn the focused unqualified `coc-source-pack-worker` with
`background=true` and its installed-plugin projection's narrow read plus
named-submit profile; do not use the plugin-qualified agent (Grok 0.2.106
suppresses plugin-subagent MCPs) or override it with
`capability_mode=read-only`. Use one exact dispatch task per child. On Codex,
use the native background-subagent adapter with the exact small claim task and
workspace-read-only authority. The child may first invoke the one supplied
authoritative interpreter/toolbox `--json-stdin` claim command. Because Codex
has no direct text-read tool, it may otherwise use only
`/bin/cat -- <exact cached_page_refs.path>` as the read transport—no search,
pipe, redirect, second command, PDF open, or write. Retain each real task ID only
in volatile host-session context, never module truth, campaign truth, or the
packet. Once a packet is claimed, the main KP must not read those exact packet
pages itself, manually construct their pack, or fulfill the claim from its own
source interpretation.

Continue the live KP turn immediately for `next_turn_hot` and `hot_ring` work.
For the pre-confirmation `partial_opening`, deliver the character confirmation
text immediately after spawning and never wait for the child. An unfinished
opening packet may become a current `blocking_micro` dependency only after
final character confirmation; otherwise a `blocking_micro` packet may delay
only when the current action cannot be resolved honestly without that exact
authored parameter, handout, or secret. Do not expand its page group while
waiting. Module text for a material dig comes from **steward deliveries**
(`steward.deliveries` / `steward.notebook`); the steward marks what is still
unparsed and the KP never digs or re-reads PDF sources itself.
Keep facts pending across scope/cache replacement. Release only after the same
campaign/dependency/job's fulfilled terminal is delivered; retry failures, and
never poll or gate unrelated later output.

On Grok, the source child submits the complete outer result itself through its
named submit-only MCP, whose server validates and merges without the main KP.
Treat the host completion reminder as notification/liveness only. The main KP
must not call `get_task_output` or `get_command_or_subagent_output`, wait, poll,
inspect the task, retrieve the pack or compact receipt, or call
`progressive.fulfill_host_work` for that child. The child retains its compact
`coc.source-submit-receipt.v1` final output for audit only. Never claim source
success to the player. A failed submission stays open or leased for existing
recovery; do not repair or retry it. Consume durable availability only through
a later naturally needed canonical entity or mechanics query; the campaign
watch owns opening projection. Never issue a reassurance query or poll.

For a host adapter without the named direct-submit transport, retain the exact
R28 fallback. On a later real player turn inspect a completed child at most
once without blocking, then pass each child-owned `results[i]` unchanged as
`worker_result=result` plus exact host runtime timing to
`progressive.fulfill_host_work`. Never extract or retype `job_id`, `pack`, or
`related_packs`, combine legacy explicit fields, rebuild the object, add
defaults, repair, or retry. Trust fallback success only when `ok=true` and
durable `request_status=fulfilled`.

The child never writes
`.coc`, invokes rules/state, or produces player-facing text. The child never
supplies timestamps. When a host has no exact task-runtime metadata, the
repository labels lease-to-fulfillment time as an upper bound instead of
pretending it is pure parse time. Lease expiry makes abandoned work claimable
again. Subsequent questions must consume the durable pack instead of dispatching
another page read.

During character setup, unfinished work simply continues while the character
flow proceeds. If the opening pack is durable at final confirmation, consume
the already auto-projected opening and its initial-move card. If the host does not
advertise `coc_source_pack_worker_v1=true`, do not claim for an imaginary child,
fake a Task, or invent a task ID; keep the exact request durable for honest
foreground handling. This source lifecycle remains owned by scenario import
and the main KP, not `coc-character`.

Real Grok acceptance uses the focused Keeper launcher and records the host task
ID, background start/completion metadata, and child-side source-submit receipt
without parent task-output retrieval (or the exact fallback fulfillment
receipt on a non-direct adapter). A
pack's `producer` label or lease-to-fulfillment timing is not proof that a real
subagent ran.
