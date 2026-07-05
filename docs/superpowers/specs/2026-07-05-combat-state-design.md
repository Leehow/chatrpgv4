# COC Combat State — Design Spec

**Date:** 2026-07-05
**Status:** Approved (brainstormed)
**Scope:** Generic Call of Cthulhu 7e combat engine — structured `save/combat.json` state, `CombatSession` runtime, audit checks, and harness/skill integration. The Haunting's Corbitt fight is the first consumer.

## Motivation

The current playtest harness resolves the Corbitt fight with a single `Fighting (Brawl)` roll, skipping the entire Chapter 6 combat system. A second pass added a hand-rolled combat loop in a one-shot driver script, but that exposed the real gap: **combat has no structured state object**. Dominate persistence, Flesh Ward degradation, opposed-roll pairing, and damage chains were tracked with ad-hoc dict fields and scattered variables, producing logic bugs (Dominate not decremented, both-fail branch mishandled, Luck > 100 crash).

The design blueprint (`docs/superpowers/specs/2026-07-03-coc-keeper-design.md` line 822) already specifies `-> create save/combat.json`, parallel to the existing `save/chase.json` (chase subsystem). Chase has a mature structured-state pattern (`participants[]`, `location_chain[]`, `rounds[].turns[]`) with audit checks that verify DEX order, hazard resolution, and barrier/hide links from state alone — never trusting transcript prose. Combat needs the same.

**Goal:** a structured combat state that lets audit machine-verify combat rulebook compliance from state files (DEX initiative order, opposed-roll pairing, damage chains, condition justification), independent of narrative text.

## Non-Goals

- Real-time / multi-player networking. This is a turn-based engine for playtest harnesses and KP assistants.
- Replacing the existing skill-roll infrastructure (`coc_roll.percentile_check`). Combat reuses it.
- Chase integration in this round. Chase has its own `save/chase.json`; combat-and-chase transitions are a future concern.

## Rulebook Basis (Chapter 6, 7e 40th Anniversary)

| Rule | Page | State implication |
|---|---|---|
| DEX determines initiative order; tie → higher combat skill | p.114 | `initiative_order` per round, with `dex_reason` for temporary boosts (e.g. casting Dominate raises Caster DEX to 85) |
| **Firearms shoot at DEX+50 in initiative** (readied firearm) | p.124 | `participants[].has_ready_firearm` + `firearms_skill`; `initiative_order[].dex` reflects +50 with `dex_reason="ready_firearm"` |
| Declaration of intent each round ("What is your character doing?") | p.114 | `turns[].declared_intent` |
| Multi-round, series of rolls until victor | p.112 | `rounds[]` array |
| Action types: attack / maneuver / **flee** / cast / other | p.114 | `turns[].action` enum; flee marks participant `conditions=["fled"]` and removes from subsequent initiative |
| Opposed resolution: attack vs fight-back (Fighting) or dodge (Dodge); tie rules differ per defense choice | p.115 | `turns[].opposed_roll_id`, `opposed_outcome`, `defense_kind` |
| **Firearms cannot be fight_back/dodge** — target may only Dive for Cover | p.125 | `_resolve_attack` overrides defense_kind to `dive_for_cover` when weapon skill starts with "Firearms"; `turns[].defense_kind` |
| **Dive for Cover**: Dodge roll; success → attacker 1 penalty die (re-roll); diver forfeits next attack, can only dodge until then | p.125 | `defense_kind="dive_for_cover"`; `cover_reroll_roll_id`; `participants[]._dived_for_cover`, `_forfeit_next_attack` |
| **Cover/Concealment** (≥half target obscured): attacker 1 penalty die | p.125 | `turns[].attack_modifiers.cover`; counted into `attack_modifiers.penalty` |
| **Outnumbered**: target that already defended this round → subsequent attackers get 1 bonus die | p.108 | `participants[]._defended_this_round`; `attack_modifiers.outnumbered_penalty` |
| **Point-Blank Range** (within DEX/5 feet): attacker 1 bonus die | p.125 | `turns[].attack_modifiers.point_blank` |
| **Range → difficulty** for firearms: base=regular, long(×2)=hard, very long(×4)=extreme | p.124 | `turns[].attack_modifiers.range_band`; roll record `difficulty` |
| **Fast-moving target** (MOV 8+): attacker 1 penalty die | p.125 | `turns[].attack_modifiers.fast_moving` |
| Extreme success → max damage + impale for blades | p.115 | `turns[].outcome` includes success level; damage chain notes impale |
| No pushing combat rolls | p.116 | audit: combat turns never carry `pushed:true` |
| Major wound / dying / unconscious / prone / grappled / surprised / outnumbered conditions | p.119, p.131 | `participants[].conditions[]` |
| Flesh Ward: armor 1D6 per MP, degrades 1:1 with damage absorbed | p.449 | `participants[].armor`, `armor_rule`, damage chain records `armor_absorbed` |
| Surprise attacks | p.106 | `turns[].action: "surprise_attack"` (target neither fights back nor dodges) |

## Architecture

### Component boundaries

```
coc_combat.py            # NEW — CombatSession class + combat.json schema/loader
   ├─ depends on: coc_roll (percentile_check, roll_expression), coc_rules (success_level)
   └─ consumed by: coc_playtest_harness.py (seeds combat), coc_playtest_audit.py (verifies combat.json),
                   coc_playtest_report.py (renders ## Combat Tracker), coc-combat/SKILL.md (documents)

coc_state.py             # EXTEND — add combat.json read/append alongside chase.json helpers

coc_playtest_harness.py  # EXTEND — combat profiles seed save/combat.json via CombatSession
coc_playtest_audit.py    # EXTEND — combat_state_* audit findings dispatch from combat.json
coc_playtest_report.py   # EXTEND — ## Combat Tracker renders combat.json (parallel to Chase Tracker)
coc-combat/SKILL.md      # EXTEND — document the combat.json workflow and audit findings
2026-07-03-coc-keeper-design.md  # EXTEND — combat section points to combat.json schema (already L822)
```

### `CombatSession` responsibilities

A single class owns combat state for one fight. Responsibilities:
1. **Add participants** with full attributes (DEX, combat skill, Build, HP, MP, armor, weapons, conditions).
2. **Resolve a round**: take each participant's declared intent in DEX order, dispatch the correct skill roll(s), apply opposed-resolution rules, apply damage/conditions/effects.
3. **Persist**: snapshot to `save/combat.json` after every round (so audit/report can read intermediate state).
4. **Conclude**: set `status=concluded`, `outcome`, when one side is eliminated or flees.

The class is deterministic given the RNG it is handed; it produces both the `combat.json` state and the corresponding rolls/events for `rolls.jsonl`/`events.jsonl`.

## `save/combat.json` Schema

Full schema with field semantics. All ids are stable ASCII; player-visible text lives in `localized_text[play_language]` companions.

```json
{
  "combat_id": "haunting-corbitt",
  "scene_ref": "scenarios/the-haunting/basement",
  "started_at_turn": 67,
  "ended_at_turn": 102,
  "status": "active | concluded",
  "outcome": "investigators_win | monsters_win | fled | stalemate | null",
  "participants": [
    {
      "actor_id": "ada-king",
      "side": "investigator | monster | npc",
      "dex": 70,
      "combat_skill": 65,
      "build": 0,
      "hp_max": 9,
      "hp_current": 6,
      "magic_points": 10,
      "armor": 0,
      "armor_rule": "fixed | degrades_1_per_damage | null",
      "weapons": [
        {
          "weapon_id": "ritual-dagger",
          "skill": "Fighting (Brawl)",
          "damage": "1D4+2",
          "impales": true,
          "special": "bypasses_corbitt_spells | null"
        }
      ],
      "conditions": ["major_wound | dying | unconscious | prone | grappled | surprised | outnumbered"],
      "active_effects": [
        {
          "effect": "dominated | flesh_ward | other",
          "source_actor_id": "walter-corbitt",
          "applied_round": 1,
          "remaining_rounds": 5,
          "metadata": {}
        }
      ]
    }
  ],
  "rounds": [
    {
      "round": 1,
      "initiative_order": [
        {"actor_id": "walter-corbitt", "dex": 85, "dex_reason": "casting_dominate"},
        {"actor_id": "ada-king", "dex": 70, "dex_reason": null}
      ],
      "turns": [
        {
          "turn_id": "t1-1",
          "actor_id": "walter-corbitt",
          "dex": 85,
          "dex_reason": "casting_dominate",
          "declared_intent": "cast Dominate on Ada King",
          "action": "attack | maneuver | flee | cast | other | surprise_attack",
          "target_actor_id": "ada-king",
          "roll_id": "r71",
          "opposed_roll_id": "r73 | null",
          "opposed_outcome": "attacker_higher | defender_higher | tie_attacker_wins | tie_defender_wins | both_fail | unopposed",
          "defense_kind": "fight_back | dodge | none | null",
          "outcome": "dominate_success | hit | miss | maneuver_success | failed | ...",
          "effect_applied": {
            "effect": "dominated",
            "target_actor_id": "ada-king",
            "remaining_rounds": 5
          },
          "damage_roll_id": "null | r81"
        }
      ]
    }
  ],
  "damage_chain": [
    {
      "damage_roll_id": "r81",
      "source_turn_id": "t3-2",
      "source_actor_id": "walter-corbitt",
      "target_actor_id": "ada-king",
      "weapon_id": "claws",
      "die": "1D3+1D4",
      "hp_before": 9,
      "hp_delta": -3,
      "hp_after": 6,
      "armor_absorbed": 0,
      "armor_after": 0,
      "rulebook_exception": "own_dagger_ignores_spells | null"
    }
  ]
}
```

### Field semantics

- `initiative_order[]`: per-round DEX ranking. `dex_reason` is non-null when a temporary rule changes DEX (e.g. Dominate casting = 85; some spells; bonus die sources). Ties broken by `combat_skill` — the audit re-derives the order and compares.
- `turns[].action`: enum of the five Chapter 6 action types plus `surprise_attack` (p.106) and `other` (lock-picking while others fight).
- `turns[].opposed_roll_id`: links to the matching roll in `logs/rolls.jsonl` via `roll_id`. `null` for surprise attacks or non-combat actions.
- `turns[].opposed_outcome`: the resolved comparison per p.115 rules — `tie_attacker_wins` when defender fights back, `tie_defender_wins` when defender dodges, `both_fail` for no damage.
- `turns[].effect_applied`: structured effect (Dominate, prone, disarm) — non-null only when the turn applies one. Conditions like `major_wound` are derived from damage chain, not applied here.
- `damage_chain[]`: every HP change links a damage roll to before/delta/after + armor absorption. `rulebook_exception` flags module-specific overrides (The Haunting: ritual dagger bypasses Corbitt's spells).
- `conditions[]`: derived state from accumulated damage and effects. Audit cross-checks: `major_wound` requires a single-hit damage ≥ half hp_max in the damage chain; `dying` requires hp_current = 0 + major_wound; etc.

## Audit Findings (new, dispatched from `combat.json`)

Findings live in `coc_playtest_audit.py` alongside chase findings. All are `system_gap`, severity high, unless noted.

| Finding id | Trigger | Recommendation |
|---|---|---|
| `combat_state_missing` | run covered combat subsystem but `save/combat.json` not written | Persist combat.json for every combat scene (DEX order, participants, rounds, damage chain). |
| `combat_dex_order_not_proven` | `rounds[].turns[]` order disagrees with `initiative_order[]` (after re-deriving tie-breaks by combat_skill) | Order turns by DEX desc; ties broken by combat_skill (p.114). |
| `combat_opposed_pairing_missing` | attack/maneuver turn has no `opposed_roll_id` (and is not a surprise attack) | Every attack vs defender must pair an opposed roll; link via roll_id. |
| `combat_opposed_outcome_invalid` | `opposed_outcome` does not match the success-level comparison of the two rolls (per fight-back vs dodge tie rules) | Re-derive opposed outcome from roll success levels + defense kind. |
| `combat_damage_chain_broken` | damage roll in `rolls.jsonl` has no matching `damage_chain` entry, or `hp_before + hp_delta != hp_after`, or `armor_absorbed + hp_delta != -raw_damage` | Link every damage roll to the damage chain with full before/delta/after + armor absorption. |
| `combat_condition_unjustified` | `conditions` contains `major_wound`/`dying`/`unconscious` without matching damage evidence; or Flesh Ward armor value disagrees with `degrades_1_per_damage` history | Derive conditions from damage chain; track Flesh Ward armor per the rule. |
| `combat_outcome_unresolved` | `status: concluded` but `outcome` is null; or participants with hp_current ≤ 0 are not reflected in outcome | Set outcome when concluding; check hp_current for victor determination. |
| `combat_pushed_roll_present` | any combat turn's linked roll has `pushed: true` (p.116 forbids pushing combat rolls) | Combat rolls cannot be pushed; the next attack is the substitute (p.116). |

Findings re-use the existing `_finding(cause, severity, evidence, recommendation)` helper. They are added to the `audit_run` dispatch near the chase findings block.

## `CombatSession` Interface (coc_combat.py)

```python
class CombatSession:
    def __init__(self, combat_id: str, scene_ref: str, started_at_turn: int,
                 rng: random.Random, glossary: dict, play_language: str = "zh-Hans"): ...

    def add_participant(self, actor_id, side, dex, combat_skill, build,
                        hp_max, magic_points=0, armor=0, armor_rule=None,
                        weapons=None, conditions=None) -> None: ...

    def begin_round(self) -> int: ...  # returns round number; computes initiative_order

    def declare_and_resolve_turn(self, actor_id, declared_intent, action,
                                  target_actor_id=None, defense_kind=None,
                                  weapon_id=None, spell=None) -> dict: ...
        # dispatches percentile_check / roll_expression via self._rng
        # applies opposed resolution, damage, conditions, effects
        # appends to rounds[].turns[], damage_chain[], rolls.jsonl payload
        # returns the turn record

    def apply_effect(self, target_actor_id, effect, source_actor_id,
                     remaining_rounds, metadata=None) -> None: ...

    def tick_effects(self) -> None: ...  # called at end of round; decrements remaining_rounds

    def conclude(self, outcome) -> None: ...  # sets status/outcome

    def snapshot(self) -> dict: ...  # returns the combat.json dict
    def save(self, campaign_dir: Path) -> Path: ...  # writes save/combat.json
```

The class is the single source of truth during a fight. The harness constructs one `CombatSession`, drives rounds via `declare_and_resolve_turn`, and lets the class emit state + roll/event records. No combat state lives outside the instance and its `save/combat.json`.

## Harness Integration

The Haunting's Corbitt fight replaces the current single-roll block in `create_haunting_module_run`:

```python
combat = coc_combat.CombatSession("haunting-corbitt", "scenarios/the-haunting/basement",
                                  started_at_turn=T, rng=rng, glossary=localized_terms)
combat.add_participant("ada-king-haunting", "investigator", dex=70, combat_skill=65,
                       build=0, hp_max=12, magic_points=13, armor=0,
                       weapons=[{"weapon_id":"ritual-dagger","skill":"Fighting (Brawl)",
                                 "damage":"1D4+2","impales":True,"special":"bypasses_corbitt_spells"}])
combat.add_participant("walter-corbitt", "monster", dex=35, combat_skill=50,
                       build=1, hp_max=16, magic_points=18, armor=roll_2d6(),
                       armor_rule="degrades_1_per_damage")
# Round 1: Corbitt casts Dominate at DEX 85
combat.begin_round()
combat.declare_and_resolve_turn("walter-corbitt", "cast Dominate on Ada", "cast",
                                target_actor_id="ada-king-haunting", spell="dominate")
# ... (Ada's break-free turn, subsequent rounds) ...
combat.conclude("investigators_win")
combat.save(campaign_dir)
```

The Floating Knife and Bed Attack scenes also become combat sessions (each is a combat scene per Chapter 6 — Bed Attack has the bed as a one-shot "monster" participant, Floating Knife has the dagger driven by Corbitt's POW).

## Skill Documentation

`coc-combat/SKILL.md` gets a new section "Combat State and the Audit Loop" that:
- States that every combat scene must drive a `CombatSession` and persist `save/combat.json`.
- Lists the audit findings with their triggers and recommendations.
- References the rulebook pages for each rule the state encodes.

`coc-playtest/SKILL.md` combat coverage requirement is updated: a combat-audited run must have `save/combat.json` with rounds, turns, damage chain, and outcome.

## Testing

New tests in `tests/test_playtest_audit.py` (mirror the chase test pattern):

- `test_haunting_module_audit_requires_combat_state_for_corbitt_fight` — delete `save/combat.json` → `combat_state_missing`.
- `test_combat_state_dex_order_must_match_initiative` — shuffle `turns[]` out of DEX order → `combat_dex_order_not_proven`.
- `test_combat_opposed_pairing_required_for_attack` — null out `opposed_roll_id` on an attack turn → `combat_opposed_pairing_missing`.
- `test_combat_opposed_outcome_must_match_rolls` — flip a tie outcome → `combat_opposed_outcome_invalid`.
- `test_combat_damage_chain_must_balance` — break `hp_before + hp_delta == hp_after` → `combat_damage_chain_broken`.
- `test_combat_condition_requires_evidence` — add `major_wound` without qualifying damage → `combat_condition_unjustified`.
- `test_combat_no_pushed_rolls` — mark a combat roll `pushed:true` → `combat_pushed_roll_present`.
- `test_combat_outcome_must_be_set_when_concluded` — null outcome on concluded state → `combat_outcome_unresolved`.
- Regression: a well-formed `CombatSession`-driven haunting run produces no combat findings.

Existing tests that pin the old single-roll combat text will need updating to the multi-round combat narrative.

## Implementation Order

1. Write `coc_combat.py` (`CombatSession` + schema, unit-testable in isolation).
2. Add combat.json helpers to `coc_state.py`.
3. Add audit findings to `coc_playtest_audit.py` + tests (TDD: each finding has a fail-first test).
4. Rewrite Corbitt/Floating-Knife/Bed-Attack scenes in `coc_playtest_harness.py` to drive `CombatSession`.
5. Add `## Combat Tracker` rendering to `coc_playtest_report.py`.
6. Update `coc-combat/SKILL.md` and `coc-playtest/SKILL.md`.
7. Refresh the design blueprint (`2026-07-03-coc-keeper-design.md` Combat section) to point at the new schema.
8. Run the full audit + pytest loop until green.
9. Use `CombatSession` to re-fight Corbitt in the live playthrough and regenerate the battle report.

## Open Questions Resolved in Brainstorming

- **Granularity:** full — `rounds[].turns[]` structured (audit can machine-verify, parallel to chase.json).
- **Scope:** generic combat engine for any module; The Haunting is the first consumer.
- **Persistence:** structured `save/combat.json`, parallel to `save/chase.json`.

## Risks

- **Schema churn:** if the first consumer (Haunting) doesn't exercise outnumbered/grappled/surprise, those fields are spec'd but untested. Mitigation: spec the fields, but only audit-check rules that have a test exercising them; expand audit as more modules add combat.
- **Narrative coupling:** `CombatSession` produces structured state, but the KP narration still lives in transcript. Audit must read state, not prose — the same discipline chase already enforces.
