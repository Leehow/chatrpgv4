---
name: coc-combat
description: Resolve Call of Cthulhu combat during COC mode using the full Chapter 6 system. Use for DEX initiative (with readied-firearm +50 and casting overrides), declaration of intent, multi-round opposed resolution (fight back vs dodge, distinct tie rules), the eight combat mechanisms (firearms cannot be dodged, Dive for Cover, Cover, Outnumbered, Point-Blank, Range→difficulty, Firearms DEX+50, flee), damage with armor/Flesh Ward, conditions (major wound/dying/prone/grappled/surprised), and structured combat state persistence via CombatSession and save/combat.json.
---

# COC Combat

Combat in Call of Cthulhu is **not** a single roll that decides a fight. Per Keeper Rulebook Chapter 6 (p.112): "Rather than having a single roll decide the outcome of the fight, **a series of rolls are made** until there is a clear victor." Every combat scene drives a `CombatSession` that owns the structured state and persists `save/combat.json`, parallel to the chase subsystem's `save/chase.json`.

## Workflow

1. For an authored scene operation, call toolbox `combat.resolve` with its
   stable `affordance_id`; the tool constructs and persists `CombatSession`
   through the canonical subsystem executor. The selected affordance must
   match the player's explicit action. Never substitute an `action_kind:
   attack` route for retreat, refusal to attack, or another
   `keeper_adjudication` choice merely because the attack route has a typed
   operation.
2. Read `combat.context` after each beat. If `pending_defense` targets the
   investigator, ask the player and call `combat.resolve` again with the
   selected `defense_kind`.
3. Continue in initiative order until the session mechanically concludes, the
   player flees, or a side concedes. A mechanically concluded `combat.resolve`
   emits `combat_ended` in the same transaction. Call `combat.end` only to end
   an otherwise-active fight (flee/concede/stalemate), or to backfill a legacy
   concluded snapshot that predates the atomic receipt.
4. `save/combat.json` and combat roll rows are synchronous outputs of these
   tools. Audit reads them to machine-verify compliance — **never replace the
   session with transcript prose or generic dice/damage tools**.

Module weapons may override the inherited weapon `skill` with another
structured check source. For example, Corbitt's floating knife inherits the
medium-knife damage profile but rolls `POW` against Dodge; report the emitted
skill label and target exactly rather than relabeling it as Fighting.

`coc_combat.py` remains the internal engine API for subsystem tests and new
typed integrations; a Keeper host should not hand-assemble participants or
write the snapshot directly.

## Initiative (p.114, p.124)

- Rank combatants by **DEX descending**; ties broken by higher combat skill.
- A participant with a **readied firearm** (`has_ready_firearm=True`) shoots at **DEX+50** (p.124). Recorded as `initiative_order[].dex_reason = "ready_firearm"`.
- A spellcaster may act at a temporary DEX for the casting round (e.g. Corbitt casting Dominate at DEX 85). Pass `dex_override` and `dex_reason` on the turn.
- Fled, dying, and unconscious participants are excluded from the order.

## Actions in a Combat Round (p.114)

Each participant takes **one action per round** on their turn in DEX order:

| Action | Resolves as |
|---|---|
| `attack` | opposed roll (melee/thrown) or unopposed roll (firearm); damage if hit |
| `surprise_attack` | unopposed (target neither fights back nor dodges, p.106) |
| `maneuver` | opposed Fighting vs Fighting/Dodge/maneuver-counter; applies goal effect, no damage |
| `aim` | spend the round aiming (`resolution_hint="aim"`); next shot gains +1 bonus die (p.113) |
| `reload` | spend reload round(s) restoring magazine (`resolution_hint="reload"`, p.113) |
| `cast` | spell resolution (e.g. Dominate = opposed POW) |
| `flee` | participant leaves the fight (marked `fled`, removed from subsequent initiative) |
| `other` | any timed action (lock-picking, etc.) |

## The Eight Combat Mechanisms

### 1. Firearms cannot be fought back or dodged (p.125)

> "A target may **not** fight back against or dodge a Firearm attack as they can a Fighting attack."

If the weapon's skill starts with `Firearms`, the engine overrides any `fight_back`/`dodge` request to `dive_for_cover` (the only legal response to gunfire). A target caught in melee without cover is hit on any attacker success — they cannot parry a bullet.

### 2. Dive for Cover (p.125)

The only defensive response to a firearm attack. The target makes a **Dodge roll**:

- **Success**: the attacker takes **one penalty die** (re-rolls the attack). The diver **forfeits their next attack** and may only dodge further attacks until then.
- **Failure**: the firearm attack resolves as unopposed against the diver.

`turns[].defense_kind = "dive_for_cover"`; on success, `cover_reroll_roll_id` links the re-roll. The diver's `_forfeit_next_attack` flag persists until their next attack turn.

### 3. Cover and Concealment (p.125)

A target at least half-obscured grants the attacker **one penalty die**. Pass `cover=True` on the attack turn. Recorded in `attack_modifiers.cover`.

### 4. Outnumbered (p.108)

A target that has **already defended this round** (fought back or dodged) grants subsequent attackers **one bonus die**. The engine tracks `_defended_this_round` per participant and applies `attack_modifiers.outnumbered_penalty` automatically on the second and later attacks against the same target in a round.

### 5. Point-Blank Range (p.125)

Within **DEX/5 feet**, the attacker gains **one bonus die**. Pass `point_blank=True`. A firearm attacker at point-blank may themselves be targeted by melee attacks and disarmed on the opponent's turn.

### 6. Firearms DEX+50 in initiative (p.124)

> "Readied firearms may shoot at DEX + 50 in the DEX order."

A participant with `has_ready_firearm=True` and a non-zero `firearms_skill` is ranked at base DEX + 50. Set this flag when the weapon is drawn and ready; clear it if the weapon is holstered, jammed, or empty.

### 7. Range → difficulty for firearms (p.124)

Firearms difficulty is set by range, not by opposed roll:

| Range | Difficulty |
|---|---|
| Within base range | Regular |
| Long (up to ×2 base) | Hard |
| Very long (up to ×4 base) | Extreme |

Pass `range_band="long"` / `"very_long"`. At very long range, an impale only occurs on a critical (roll of 01).

### 8. Fleeing (p.114)

Declaring `action="flee"` marks the participant `conditions=["fled"]` and removes them from subsequent initiative. Opponents may still attack a fleeing target (often with a bonus die for the exposed back, at Keeper discretion — apply via the outnumbered/cover modifiers). Escaping a pursuit may require a DEX or Drive Auto roll, resolved as a follow-up turn or a chase scene.

## Opposed Resolution (p.115)

For melee attacks, the target chooses **fight back** (Fighting) or **dodge** (Dodge). Both roll against their own skill; success levels are compared:

- Higher success level wins.
- **Tie when fighting back**: the **attacker** wins (lands the blow).
- **Tie when dodging**: the **defender** wins (evades).
- Both fail: no damage.

`turns[].opposed_outcome` records `attacker_higher` / `defender_higher` / `tie_attacker_wins` / `tie_defender_wins` / `both_fail` / `unopposed`.

## Damage, Armor, and Flesh Ward (p.115, p.449)

- Damage is rolled per the weapon's `damage` expression (supports `NdS`, `NdS+M`, `NdS+NdS`).
- **Extreme success**: non-impaling weapons deal maximum damage + max damage bonus; impaling weapons (blades, bullets) deal max damage + max DB + one extra damage roll.
- **Armor** absorbs damage point-for-point. `armor_rule="degrades_1_per_damage"` (e.g. Flesh Ward) reduces armor by the amount absorbed; `armor_rule="fixed"` absorbs up to its value without degrading.
- A `rulebook_exception` (e.g. `own_dagger_ignores_spells`) sets `bypass_armor=True` — armor is ignored entirely. Use this for module-specific overrides.

Every HP change is recorded in `damage_chain[]` with `hp_before`/`hp_delta`/`hp_after`, `armor_absorbed`, and `raw_damage`. Audit verifies `hp_before + hp_delta == hp_after` and `armor_absorbed + (-hp_delta) == raw_damage`.

## Weapon Damage Bonus (Table XVII, pp.401-405)

Melee weapon damage expressions in the rulebook **exclude** DB (e.g. medium knife = `1D4+2+DB`). The engine appends the attacker's damage bonus automatically:

- Each weapon carries `adds_damage_bonus: true|false`. Melee weapons and natural weapons (claws) set this true; firearms set it false (bullets don't get stronger from the shooter's muscles).
- The attacker's `damage_bonus` field (e.g. `"+1D4"`, `"-2"`, `"none"`, derived from STR+SIZ via `damage-bonus-build.json`) is appended to the die expression when `adds_damage_bonus` is true.
- The canonical weapon catalog lives in `references/rules-json/weapons.json` (unarmed, knife_medium, knife_small, club_small, club_large, revolver_38, revolver_45, shotgun, rifle_22, claws, etc.). Each entry has `skill`, `damage` (excluding DB), `adds_damage_bonus`, `impales`, `base_range_yards`, `category`.

Never write a melee weapon's damage as `1D4+2` without DB — that under-counts damage. Always let the engine append DB via `adds_damage_bonus`.

## Firearms Depth (W3-2 / pp.113-114, p.126)

`weapons.json` `uses_per_round` is wired into the engine via `parse_uses_per_round`. Magazines track ammo on the participant (`get_ammo` / `set_ammo`); reload metadata (`reload_rounds`, `reload_kind`, `ammo_per_reload_round`) is derived from skill/magazine when omitted.

| Feature | API | Rule |
|---|---|---|
| Aiming | `resolution_hint="aim"` | Spend the round aiming → next shot +1 bonus die; lost if damaged/moved (p.113) |
| Handgun multi-shot | `shots=2\|3` | Each shot gets **one** penalty die (not cumulative difficulty) (p.113); capped by `uses_per_round` |
| Reload | `resolution_hint="reload"` | Clip/shells = 1 round; MG belt = 2 rounds; restores magazine (p.113) |
| Load-and-fire | `load_and_fire=True` | Chamber one round and fire same round with +1 penalty die (p.113) |
| Full auto | `fire_mode="full_auto"`, `rounds_fired=N` | Volley size = skill/10 (min 3); each subsequent volley +1 penalty; at 3 penalties stick at 2 and raise difficulty (p.114-116) |
| Suppression | `fire_mode="suppressive"`, `suppress_targets=[...]`, `dive_for_cover_actors=[...]` | Group may dive for cover; then random targets from the group are engaged (p.126) |

## Module-Specific Weapons (extends mechanism)

Modules add scenario-specific weapons (Corbitt's ritual dagger, a chapel artifact, a mythos tome) by declaring a `weapons[]` section in the module json (e.g. `the-haunting.json`). Each entry uses **`extends`** to inherit base stats from the catalog, then overrides module-specific fields:

```json
"weapons": [
  {
    "weapon_id": "corbitt-ritual-dagger",
    "extends": "knife_medium",
    "name": "Corbitt's Ritual Dagger",
    "special": "bypasses_corbitt_spells",
    "rule_refs": ["core.combat.weapons", "module.haunting.corbitt_own_dagger"]
  }
]
```

`coc_combat.resolve_module_weapons(module_weapons, catalog)` merges module entries on top of the catalog: the `extends` parent supplies `damage`/`skill`/`adds_damage_bonus`/`impales`; the module entry overrides `weapon_id`/`special`/`name`/`rule_refs`. Module weapons without `extends` are taken verbatim. CombatSession accepts `module_weapons` at construction and builds a unified lookup table.

Participants then reference weapons by `weapon_id` only — either a bare string (resolved from the catalog) or a dict that overrides fields like `special` for that participant. **Callers never hardcode damage expressions.** This keeps the Table XVII numbers in one place (the catalog) and lets every module add weapons with the same calling logic.

## Maneuvers: Goals, Build Penalty, Counters (p.117-119)

A maneuver is a Fighting attack whose goal is something other than raw damage. Pass `action="maneuver"` (or `resolution_hint="maneuver"`) with a **`goal`** from the rulebook p.119 set (legacy `maneuver_kind` is an alias for `goal`):

| goal (canonical) | Effect on success | Legacy aliases |
|---|---|---|
| `disarm` | Target's `target_weapon_id` transfers to the attacker (full weapon spec moves with it). | — |
| `ongoing_disadvantage` | Target gains a `restrained` effect (physical hold / knockdown disadvantage). Held until attacker releases, is incapacitated, or takes a major wound. | `grapple`, `restrain` |
| `escape` | Break free of a `restrained` hold on yourself. | `break_free` |
| `push` | Target is pushed/thrown/knocked down (`prone`). Falling damage is a separate `damage_only` turn. | `other`, `knockdown` |

**Build penalty (p.117)**: compare attacker Build vs target Build.

- Attacker Build ≥3 points lower than target → maneuver is **impossible** (outcome `maneuver_impossible_build`).
- Attacker Build 1-2 points lower → that many **penalty dice** on the maneuver roll (max 2).
- Attacker Build equal or higher → no modifier.

Recorded on the turn as `maneuver_build_difference` and `maneuver_penalty_dice`. The thresholds come from `combat.json` (`melee_combat.maneuver.build_difference_impossible_at=3`, `penalty_die_per_build_difference=1`).

**Defender maneuver counter (p.117)**: the target may respond with `defense_kind="maneuver"` and `defender_goal=<goal>`. Resolve as fighting back (Fighting vs Fighting); if the defender achieves a higher success level, apply the defender's goal instead of dealing fight-back damage.

A successful `ongoing_disadvantage` (grapple/restrain) is a powerful tactical option: a restrained spellcaster cannot gesture to cast, a restrained gunman can be disarmed next round, and the hold persists across rounds until broken with `goal="escape"`.

**Disarm persistence**: when a combat concludes (either auto-conclusion or `combat.end`), every recorded disarm transfer is committed to campaign state — the winner keeps the weapon in their runtime inventory (`save/investigator-state/<id>.json["inventory"]` for investigators; `save/npc-state.json["items"][npc_id].current_weapons` for NPCs), and the loser sheds it (a lost character-sheet weapon is recorded under `lost_weapon_ids`). A weapon taken this way is a legal `weapon_id` for later `combat.resolve` calls, and a disarmed enemy stays disarmed in later encounters. Looting a downed or surrendered opponent outside combat is the Keeper's explicit call: `state.item_grant` to the looter plus `state.item_remove` from the NPC (see `state.inventory_list` for current holdings). Investigator gains are written back to the reusable library sheet at development settlement.

## Thrown Weapons (p.108)

Weapons whose skill is `Throw` (e.g. `rock_thrown`, `spear_thrown`) are resolved as opposed attacks:

- Target may **Dodge** (same tie rule as Fighting dodge).
- Target may **fight back** only at point-blank (within DEX/5 feet).
- Damage uses **half** the attacker's damage bonus (`half:DB` via `_weapon_db_expr`).

## Prone Modifiers (p.127-128)

- Melee (Fighting) attacks **against** a prone target: +1 bonus die.
- Firearms attacks **against** a prone target: +1 penalty die (ignored at point-blank).
- A prone shooter gains +1 bonus die on Firearms rolls.

## Conditions (p.119, p.131)

Derived from the damage chain and effects, stored in `participants[].conditions[]`:

- `major_wound`: a single hit dealing ≥ half `hp_max`.
- `dying`: hp_current = 0 with a major wound.
- `unconscious`, `prone`, `grappled`, `surprised`, `outnumbered`: applied by maneuvers, surprise, or positioning.

### Dying rescue chain (p.121)

- Call `rules.first_aid` for the immediate rescue attempt. A success gives 1
  temporary HP and `stabilized` but deliberately keeps the dying chain active.
- The first attempt is regular. Second and subsequent attempts on the same
  wound are pushed rolls and must record a changed method plus the announced
  failure consequence. Surviving an unstabilized dying CON roll, or losing
  temporary stabilization, opens one new pushed-attempt window; it never
  resets the wound to a regular first attempt.
- Until Medicine succeeds, call `rules.dying_check(clock_kind="hour")` after
  each elapsed hour. Before stabilization the end-of-round clock is
  `rules.dying_check(clock_kind="round")`.
- Call `rules.medicine` to clear `dying`/`stabilized` and apply the canonical
  1D3 healing. Successful completion also clears the stale combat
  `unconscious` marker so host playability consumers can resume.
- An investigator who is unconscious from a major wound but still above
  0 HP is not in the dying chain and is not dead. Successful ordinary First
  Aid clears that stale `unconscious` marker so the same campaign can resume.
- Pass a stable `rescuer_id`; roll evidence uses that actor rather than always
  attributing NPC care to the investigator. These calls are transactional and
  require distinct `decision_id` values.
- Once immediate First Aid/Medicine is settled, Major Wound natural recovery
  is weekly, not a new Medicine healing roll every day. Advance game time to
  the end of the recovery week and call `rules.weekly_recovery` with explicit
  rest/environment facts and, when applicable, the caregiver's stable ID and
  Medicine value. The tool enforces the due interval and records the care,
  CON, and healing dice. On failure, wait another full week before retrying.
- `prone`, `grappled`, `surprised`, `outnumbered`, and `fled` are
  combat-position markers, not long-term injuries. A concluded combat removes
  them from the investigator projection. For a legacy/out-of-combat marker,
  narrate the action that ends it and call `state.clear_transient_condition`;
  never use that tool to erase an injury, unconsciousness, dying, or death.

Never substitute generic HP healing or a hand-edited condition list for this
chain. If a host pauses on `pending_resolution`, settle the rescue tools first
and then resume the same run/evidence chain.

### Luck authorization in combat

Combat rolls cannot be pushed. When an opposed melee beat has life-or-death or
plot-critical stakes, ask before rolling how many Luck points the player is
willing to authorize, unless their current action already states a ceiling.
Pass it as `combat.resolve(luck_spend_max=N)`. The combat transaction spends
the minimum amount that changes the opposed outcome, spends nothing when the
result is already favorable or the ceiling cannot change it, retains the raw
D100 in dice evidence, and updates current Luck atomically. Do not call
standalone `rules.luck_spend` after a combat turn has already applied damage.

## Environmental / Other Forms of Damage (Table III, p.124)

Weapon combat stays in the canonical combat subsystem. Falls, fire, drowning,
poison, and similar non-weapon harm use the shared `hazard.apply`,
`hazard.suffocation.start/tick/end`, and `hazard.poison` operations in
`../../scripts/coc_runtime_ops.py`; Pi uses the same operations through
`runtime.sdk.api.operate(...)`. Rules data remains in `hazards.json` and
`poisons.json`:

- `apply_other_damage(...)` — Table III severity ladder (`minor`…`splat`); always
  `bypass_armor: true`.
- Suffocation/drowning state machine — CON each round until fail, then damage each
  round; at 0 HP the victim is `dead` (ignores major-wound/`dying`).
- `apply_poison(poison_id)` — Extreme CON halves damage; results carry structured
  `symptom_tags` (no prose scanning).

Do not invent a parallel keyword matcher for hazard narration — call the hazards
engine and consume its structured events/conditions.

## No Pushing Combat Rolls (p.116)

> "There is no option to push combat rolls (either Fighting or Firearms)."

Combat rolls never carry `pushed: true`. The next attack is the substitute for a push. Audit emits `combat_pushed_roll_present` if any combat-linked roll is marked pushed.

## CombatSession Interface

```python
from coc_combat import CombatSession
combat = CombatSession("haunting-corbitt", "scenarios/the-haunting/basement",
                       started_at_turn=67, rng=rng)
combat.add_participant(actor_id="ada-king", side="investigator",
    dex=70, combat_skill=65, build=0, hp_max=12, magic_points=13,
    dodge_skill=67, firearms_skill=70, has_ready_firearm=True,
    weapons=[{"weapon_id":"revolver","skill":"Firearms (Handgun)",
              "damage":"1D10","impales":True,"special":None},
             {"weapon_id":"ritual-dagger","skill":"Fighting (Brawl)",
              "damage":"1D4+2","impales":True,"special":"bypasses_corbitt_spells"}])
combat.add_participant(actor_id="walter-corbitt", side="monster",
    dex=35, combat_skill=50, build=1, hp_max=16, magic_points=18,
    armor=flesh_ward, armor_rule="degrades_1_per_damage",
    weapons=[{"weapon_id":"claws","skill":"Fighting",
              "damage":"1D3+1D4","impales":False,"special":None}])

combat.begin_round()
# Round 1: Corbitt casts Dominate at temporary DEX 85
combat.declare_and_resolve_turn("walter-corbitt","cast Dominate","cast",
    target_actor_id="ada-king", spell="dominate",
    dex_override=85, dex_reason="casting_dominate")
# Round 2: Ada shoots at point-blank range
combat.declare_and_resolve_turn("ada-king","point-blank shot","attack",
    target_actor_id="walter-corbitt", defense_kind="none",
    weapon_id="revolver", point_blank=True)
combat.conclude("investigators_win")
combat.save(campaign_dir)
```

## save/combat.json Schema

```json
{
  "combat_id": "haunting-corbitt",
  "status": "active | concluded",
  "outcome": "investigators_win | monsters_win | fled | stalemate",
  "participants": [
    { "actor_id": "...", "side": "...", "dex": 70,
      "combat_skill": 65, "dodge_skill": 67, "firearms_skill": 70,
      "has_ready_firearm": true, "build": 0,
      "hp_max": 12, "hp_current": 9, "armor": 0, "armor_rule": null,
      "weapons": [...], "conditions": [...], "active_effects": [...] }
  ],
  "rounds": [
    { "round": 1,
      "initiative_order": [{"actor_id":"...","dex":95,"dex_reason":"ready_firearm"}],
      "turns": [
        { "turn_id":"t1-1", "actor_id":"...", "dex":85, "dex_reason":"casting_dominate",
          "declared_intent":"...", "action":"cast", "target_actor_id":"...",
          "roll_id":"cr1", "opposed_roll_id":"cr2", "opposed_outcome":"...",
          "defense_kind":"none", "outcome":"...", "effect_applied": {...},
          "damage_roll_id": null, "attack_modifiers": {...} }
      ] }
  ],
  "damage_chain": [
    { "damage_roll_id":"...", "source_actor_id":"...", "target_actor_id":"...",
      "weapon_id":"...", "die":"1D4+2", "raw_damage":6,
      "hp_before":16, "hp_delta":-6, "hp_after":10,
      "armor_absorbed":0, "armor_before":7, "armor_after":7,
      "bypass_armor": true, "rulebook_exception":"own_dagger_ignores_spells" }
  ]
}
```

## Audit Findings (read from save/combat.json)

The playtest audit reads `save/combat.json` and verifies Chapter 6 compliance from state alone:

| Finding | Trigger |
|---|---|
| `combat_dex_order_not_proven` | turns out of DEX order (re-derived with per-turn overrides) |
| `combat_opposed_pairing_missing` | attack/maneuver turn lacks `opposed_roll_id` (and is not surprise) |
| `combat_damage_chain_broken` | `hp_before + hp_delta != hp_after`, or armor accounting fails |
| `combat_pushed_roll_present` | a combat-linked roll carries `pushed: true` (forbidden p.116) |
| `combat_outcome_unresolved` | `status=concluded` but `outcome` null, or victor inconsistent with hp |

## Rulebook References

- Chapter 6 Combat: PDF p.112–141 (declaration of intent p.114, combat round p.114, DEX order p.114, fist fights p.115, opposed resolution p.115, weapons p.116, maneuvers p.117, armor p.120, firearms p.124, modifiers p.125, wounds/healing p.131).
- Chase (separate subsystem): Chapter 7, `save/chase.json`.
- Module-specific combat stats (e.g. Corbitt): The Haunting, PDF p.448–449.
