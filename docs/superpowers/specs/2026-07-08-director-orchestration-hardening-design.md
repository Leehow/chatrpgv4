# COC Director Orchestration Hardening Design

**Date:** 2026-07-08
**Status:** Approved blueprint, written spec pending user review
**Scope:** Harden the existing Call of Cthulhu Story Director rather than replacing it. This spec turns the rulebook pacing and investigation guidance into explicit DirectorPlan contracts, with Codex as the canonical implementation track and ZCode synchronized by the existing sync script.

## Goal

The live Keeper loop should feel like a human Keeper running a module, not a rules bot that advances one tiny beat per input. Most required systems already exist in rough form: rules requests, pushed-roll records, obvious and obscured clues, RECOVER, choice frames, storylets, dramatic progress, NPC persona, and audit logs. This work tightens those systems so they are connected, testable, and hard for narration to bypass.

The central design rule is: **the director must decide the dramatic contract, and the narrator must render it.** Anything that affects pacing, clue reachability, roll stakes, failure routing, NPC initiative, or storylet eligibility should be visible in structured DirectorPlan fields before prose is written.

## Non-Goals

- Do not rewrite `coc_story_director.py` from scratch.
- Do not build a full action-scene controller in this pass. Combat, chase, and complex multi-actor action scenes remain a later project.
- Do not introduce keyword-based gameplay branching. Legacy string heuristics may remain only as compatibility fallback and must emit or be covered by compile-time guidance toward structured fields.
- Do not manually edit the ZCode plugin copy. Shared behavior changes start in `plugins/coc-keeper/` and flow through `scripts/sync_coc_plugin_copy.py`.
- Do not add dependencies, vector search, or an LLM classifier to the deterministic director.

## Rulebook Principles Captured

The design encodes these Keeper Rulebook principles into machine-checkable contracts:

1. Players state goals; the Keeper decides whether a roll is needed, which skill applies, and what success or failure means.
2. Routine or non-dramatic work should not trigger repeated rolls.
3. Failure should not deadlock an investigation. The story keeps moving, usually with cost, time pressure, danger, or a worse position.
4. Key investigative information should not have a single fragile gate.
5. Idea Roll style recovery should return play to motion; success changes the cost, not whether play continues.
6. The Keeper controls tempo and may compress, montage, or cut once a scene stops producing new dramatic choices.
7. NPCs with responsibility and pressure should act from their role and persona, not wait passively for the investigator to command them.

## Architecture

This pass preserves the current chain:

```text
coc_story_director.generate_director_plan
  -> coc_narrative_enrichment.enrich_director_plan
  -> rules execution
  -> coc_director_apply.backfill_rule_results
  -> coc_narrative_enrichment.enrich_storylets_after_rules
  -> coc_director_apply.apply_plan
  -> Keeper narration
```

The hardening adds five structured contracts that travel through this chain:

1. `roll_contract` on every roll-facing `rules_request`.
2. `failure_routing` on rules requests and narrator-facing directives.
3. `clue_reachability` compile checks for critical conclusions.
4. `scene_exit_pressure` and extended `dramatic_progress` in narrative directives.
5. `npc_agency` move types beyond the current single responsibility move.

These contracts remain JSON-compatible and audit-friendly. They do not expose Keeper secrets to the player.

## Component Design

### Roll Contract Layer

Every roll-facing request emitted by the director or enrichment layer should include enough structure for the rules layer, apply layer, and narration layer to agree on stakes.

Canonical shape:

```json
{
  "kind": "skill_check",
  "skill": "Library Use",
  "reason": "obscured clue in scene",
  "difficulty": "regular",
  "bonus_penalty_dice": 0,
  "roll_contract": {
    "schema_version": 1,
    "goal": "find a public route toward the current conclusion",
    "success_effect": "commit the exact planned clue or complete the action cleanly",
    "failure_effect": "keep play moving through a cost or alternate route",
    "failure_outcome_mode": "clue_with_cost",
    "push_policy": {
      "eligible": true,
      "requires_changed_method": true,
      "keeper_must_foreshadow_failure": true
    },
    "roll_density_group": "archive_research",
    "must_not": [
      "do not narrate no progress on ordinary failure",
      "do not reveal exact withheld clue on failure"
    ]
  }
}
```

`roll_contract` may be derived from structured clue delivery, action atoms, NPC agency moves, danger profiles, or rule signals. It must not be inferred from raw prose keywords.

### Fail-Forward v2

The existing fail-forward logic is strongest for failed obscured clues. This pass generalizes that policy. Roll contracts should use one of these modes:

```text
goal_with_cost       The attempted goal happens, but with time, harm, exposure, resource loss, or position cost.
clue_with_cost       The exact clue may be withheld, but an alternate route or partial lead remains active.
pressure_cost        A threat clock, deadline, NPC suspicion, or environmental danger advances.
complication         A new bounded obstacle appears without creating new module truth.
uncertain_read       Social/perception read is partial or uncertain, never a guaranteed opposite truth.
blocked_by_boundary  The action cannot work because of a rule, safety, or module boundary; offer an in-world reason.
```

The apply layer should continue to backfill rule results, but narrator-facing directives should cover non-clue failures too. A failed request with no failure routing is a contract violation in tests.

### Clue Reachability Audit

`coc_scenario_compile.py` already checks route count for critical conclusions. This pass upgrades that into reachability checking.

For each critical conclusion:

- It must meet `minimum_routes`.
- At least one route must be non-fragile. A non-fragile route is obvious, handout, environmental, NPC dialogue without a hostile single gate, RECOVER fallback, or another structured route that does not depend on one successful skill roll.
- If all direct routes are obscured, the conclusion must define `fallback_policy` or equivalent fallback routes that can be surfaced by RECOVER or fail-forward.
- A warning should be emitted when legacy `delivery` text is used without `delivery_kind`, `skill`, and `difficulty`.

The validator should distinguish errors from warnings. New structured scenarios should fail on unreachable critical conclusions. Older scenarios may receive warnings unless they opt into strict validation.

### Idea Roll v2

The current `RECOVER` valve activates after stalled turns and can commit a fallback route with cost. This pass makes the contract explicit:

```json
{
  "idea_roll_plan": {
    "schema_version": 1,
    "missed_conclusion_id": "corbitt-linked-to-chapel",
    "target_characteristic": "INT",
    "success_delivery": "surface a clean in-world inference or overlooked lead",
    "failure_delivery": "surface the lead in a worse position",
    "failure_costs": ["time_pressure", "threat_position", "npc_suspicion"],
    "must_not": [
      "do not present this as table-level advice",
      "do not ask the player to guess the same missing route again"
    ]
  }
}
```

The essential rule is that Idea Roll recovery decides cost and position, not whether play continues.

### Scene Exit and Pacing Contract

The existing bridge governor and `dramatic_progress` directive handle low-agency travel and routine actions. This pass generalizes them with `scene_exit_pressure`.

Canonical shape:

```json
{
  "scene_exit_pressure": {
    "schema_version": 1,
    "state": "continue|compress|cut|montage",
    "reasons": ["low_agency_repetition", "no_new_axis"],
    "scene_goal_status": "open|answered|blocked|exhausted",
    "advance_until": [
      "threat_approaches",
      "new_clue_or_obvious_information",
      "npc_requests_specialist_judgment",
      "meaningful_choice",
      "risk_requires_roll",
      "scene_arrival_or_transition"
    ],
    "must_change_state": true,
    "must_not": [
      "do not ask for another equivalent low-agency action",
      "do not repeat the same scene state with cosmetic wording"
    ]
  }
}
```

This field should be emitted when the director detects repeated low-agency input, routine repetition, exhausted bridge scenes, answered dramatic questions, no available new clue axis, or a scene contract that has reached its low-agency limit.

### Proposal Transform

When structured intent says the player proposes a plan, the director should preserve agency by transforming the proposal rather than blocking by default.

Canonical shape:

```json
{
  "proposal_transform": {
    "schema_version": 1,
    "mode": "yes|yes_but|yes_and|no_boundary",
    "accepted_goal": "what part of the player plan can work",
    "visible_cost_or_risk": "what the investigator can perceive before committing",
    "boundary_reason": null,
    "next_contract": "narrate|request_roll|offer_choice|cut"
  }
}
```

`no_boundary` is reserved for rules, safety, or module-truth boundaries. It should still tell the player what their investigator can try instead, unless the player explicitly asks for a meta explanation.

### Psychology and Perception Reliability

Psychology and perception failures should not automatically invert truth. The rule-signal and narration contracts should support:

```text
accurate_read       The investigator reads the person or scene correctly.
partial_read        The investigator gets observable facts without full interpretation.
uncertain_read      The investigator cannot tell; describe hesitation or ambiguity.
misleading_surface  The investigator notices a plausible surface impression, flagged internally as unreliable.
```

The player-facing text should prefer observable behavior before interpretation. A failed Psychology roll should not state "he is trustworthy" when the truth is "he is lying" unless a specific scenario effect explicitly creates deception.

### Roll Density Guard

The director should avoid repeated same-axis checks. Every roll contract may carry `roll_density_group`. Recent requests in the same group should be compressed unless there is a new consequence axis.

Rules:

- Combine same-skill, same-goal repeated checks into one roll or montage.
- Allow multiple checks only when failure consequences differ.
- Prefer no more than three critical checks in one action chain.
- Repeated travel, searching, guarding, waiting, and following should hit `dramatic_progress` or `scene_exit_pressure`, not another equivalent check.

### NPC Agency v2

The NPC persona layer already instantiates social role and one agency move. This pass expands the move taxonomy while keeping the no-hardcoding rule.

Move types:

```text
take_command          The NPC acts within authority before asking the investigator for specialist input.
delegate_specialist   The NPC keeps command but assigns a domain-specific task to the investigator.
assist                The NPC helps and may grant a bonus die or fictional advantage.
object                The NPC resists a risky, immoral, illegal, or duty-conflicting player plan.
protect               The NPC shields a person, route, evidence, or group duty.
rush                  The NPC acts too fast under pressure, creating an opportunity or complication.
panic                 The NPC loses composure in a way consistent with persona and stress response.
withhold              The NPC conceals information because of fear, agenda, loyalty, or leverage.
withdraw              The NPC retreats, delays, or seeks backup.
```

Inputs remain abstract:

- `authority_scope`
- `responsibility_domains`
- `chain_of_command`
- `duty_pressure`
- `initiative_style`
- `delegation_policy`
- persona tags
- scene tags
- responsibility threats
- structured intent tags

Concrete jobs, titles, names, nationality, and prose keywords are presentation context, not rules conditions.

## Data Flow

1. The intent layer supplies `player_intent_rich` with semantic tags, target entities, action atoms, and proposal fields.
2. The director selects `scene_action`, clue policy, pressure moves, NPC moves, and base rules requests.
3. Roll requests are normalized with `roll_contract`.
4. Narrative enrichment adds choice frames, action-chain requests, storylet trigger state, and proposal transforms.
5. Rules execution records outcomes and keeps roll payloads aligned with the request contracts.
6. Apply backfill resolves committed clues, withheld clues, extra pressure, recovery, and failure routing.
7. Storylets are drawn only after a true trigger window, such as critical success, fumble, pressure clock, scene transition, RECOVER, or active NPC reaction.
8. Narration consumes the final resolved plan and must honor `must_include`, `must_not_reveal`, failure routing, scene exit pressure, and NPC agency directives.

## Error Handling and Compatibility

- Missing `roll_contract` on a roll request should be tolerated during transition but flagged by tests and audit helpers.
- Legacy clue `delivery` strings remain supported as fallback, but structured `delivery_kind` is preferred and should be warned for critical conclusions.
- If an Idea Roll target cannot be found, default to INT from investigator state and emit an audit warning.
- If NPC persona state is missing, instantiate a silhouette as the current system already does.
- If an NPC move cannot be bound to scene responsibility or persona tags, skip the move rather than inventing authority.
- If `scene_exit_pressure` says cut or montage but a blocking rule request is present, rules resolution wins.

## Testing Strategy

Use TDD for implementation. Required focused tests:

1. `tests/test_story_director.py`
   - roll requests include `roll_contract` for obscured clues, action atoms, and danger checks.
   - low-agency and routine repetition emit `scene_exit_pressure`.
   - same-axis repetition prefers compression over another equivalent roll.
   - proposal transforms are emitted from structured intent fields.

2. `tests/test_director_apply.py`
   - non-clue failed rolls produce narrator-facing failure routing.
   - Idea Roll recovery distinguishes success and failure costs.
   - failed Psychology or perception style results do not force opposite truth.

3. `tests/test_scenario_compile.py`
   - critical conclusions with all skill-gated routes fail strict reachability.
   - critical conclusions with at least one obvious or RECOVER fallback route pass.
   - legacy delivery text on critical clues emits a structured-delivery warning.

4. `tests/test_npc_persona.py`
   - abstract social-role and persona inputs select more than `assert_responsibility`.
   - concrete title/name/job text does not branch behavior.
   - selected NPC moves carry audit-ready reasons.

5. `tests/test_narrative_enrichment.py`
   - storylets still trigger only from event windows, not every turn.
   - critical success and fumble can open high-conflict storylet windows with correct polarity.
   - proposal transforms and choice frames coexist without rendering a menu.

6. Dual-track checks:
   - Run `python3 scripts/sync_coc_plugin_copy.py`.
   - Run `python3 scripts/sync_coc_plugin_copy.py --check`.
   - Run plugin metadata and sync tests.

## Acceptance Criteria

- Every new roll-facing request created in the touched paths has a `roll_contract`.
- A failed non-clue roll can be routed without leaving narration with "nothing happens".
- Critical clue reachability is checked beyond route count.
- RECOVER can produce an explicit `idea_roll_plan`.
- `scene_exit_pressure` covers low-agency repetition outside bridge-only scenes.
- NPC agency has multiple abstract move types and audited reasons.
- Psychology failure policy no longer defaults to false information.
- Storylets remain event-triggered and anchor-bound.
- Codex and ZCode plugin tracks are synchronized by script.
- Focused tests and required dual-track tests pass.

## Self-Review Notes

- No known placeholders remain.
- Scope is one implementation pass: director contract hardening and connected tests.
- Full action-scene controller is intentionally excluded.
- The no-hardcoded-keyword rule is explicit for new behavior; legacy clue fallback is compatibility-only.
