---
name: coc-chase
description: Resolve Call of Cthulhu chase scenes during COC mode using the full Chapter 7 Parts 1-5 system. Use for establishing pursuits (CON/Drive Auto speed rolls), Cut to the Chase positioning, location chains with hazards and barriers, movement-action economy, Pedal to the Metal, passenger assists, firing while moving, Choosing a Route, Sudden Hazards, same-location melee delegated to CombatSession, vehicle Drive Auto conflict, and structured chase state persistence via ChaseSession and save/chase.json.
---

# COC Chase

A chase is not a single speed contest. Per Keeper Rulebook Chapter 7 (p.130-145), play runs through five parts: establish whether a chase is needed, cut to the exciting range, resolve movement through hazards and barriers, handle same-location conflict, then optionally embellish with Part 5 rules. Every chase scene drives a `ChaseSession` (`../../scripts/coc_chase.py`) that owns positions and the location chain, and persists `save/chase.json`.

**Canonical entrypoint:** inspect `chase.context`, then submit one exact
`chase_start`, `chase_move`, `chase_hazard`, `chase_barrier`,
`chase_conflict`, or `chase_end` command through `chase.execute`. Use
`coc_toolbox.py describe chase.execute` for the envelope. The toolbox delegates
to the existing subsystem executor and `ChaseSession`; do not instantiate or
save a parallel session from the host.

**Boundary:** chase owns positions / movement economy / location chain. Same-location melee delegates to `CombatSession` (`../../scripts/coc_combat.py`) — combat owns the exchange. Do not invent a second combat resolver inside chase.

## Part 1 — Establishing the Chase (p.132)

1. Construct `ChaseSession(chase_id, rng=...)`.
2. `add_participant` for each pursuer and quarry (foot: `con=`; vehicle: `is_vehicle=True`, `drive_auto=`, `build=`). Use `get_vehicle_stats("car_economy")` etc. for Table V defaults.
3. Call `establish()`:
   - Success → MOV unchanged; Extreme → +1 MOV; Failure → −1 MOV (whole chase).
   - If every quarry's adjusted MOV is **higher** than every pursuer's → `conclude("escaped")` and narrate; do not play Parts 2-4.
4. Passengers: `add_passenger(actor_id, vehicle_id, dex=...)` — no speed roll, no movement actions (p.142).

## Part 2 — Cut to the Chase (p.132-133)

```text
cut_to_the_chase(gap=2, location_count=8)
# or cut_to_the_chase(gap=2, locations=[...structured entries...])
```

- Default gap is **2 locations** (pursuers at 0, quarry at 2). Gap 1 only for exceptional tension; do not exceed 2.
- Each location entry is structured: `{label, hazard, barrier}` — hazard/barrier slots may be `null` until filled.
- `generate_location_chain(count)` builds an empty structured chain when the Keeper has not authored one.

## Part 3 — Movement, Hazards, Barriers (p.134-137)

### Movement actions

`begin_round()` recomputes actions: **1 + (MOV − slowest)**, then subtracts any `movement_debt` from a prior failed hazard. Participants act in DEX order (`rounds[].dex_order`).

### Clear advance

```text
move_participant(actor_id, [{"type": "advance"}])
```

Cost: 1 movement action per location when the edge is clear.

### Hazards (p.134-135)

Hazards sit on the location being entered. An `advance` into a hazarded location rolls the Keeper-chosen skill:

- **Cautious approach:** `cautious_bonus_actions` 1 or 2 → that many bonus dice (max 2), each costing an extra movement action.
- **Success:** advance; no further delay or damage.
- **Failure:** damage (Table III / Table VI) **and** `1D3` movement-action debt, **but still advance** (p.135).

Debt reduces next round's movement actions via `begin_round`.

### Barriers (p.136-137)

Barriers block until negotiated or destroyed. Simple `advance` returns `blocked_by_barrier`.

| Action | API | Rule |
|---|---|---|
| Skill past | `{"type":"barrier","skill":"Climb","target":40}` | Fail → stay put |
| Smash | `{"type":"break_barrier"}` | Build×1D10 (no attack roll). Vehicle that fails to destroy → **wrecked**; wreck becomes a hazard. Destroyed barrier → debris hazard; vehicle takes half barrier HP prior to impact |

Sample barrier HP (p.137): thin fence 5, back door 10, strong door 15, 9″ brick 25, tree 50, concrete support 100.

## Part 4 — Conflict (p.137-138)

Characters/vehicles must share a location (except firearms). Initiating an attack costs **1 movement action**.

### Same-location melee → CombatSession

```text
combat = CombatSession(...)
chase.initiate_melee_conflict(
    attacker_id, defender_id,
    combat_session=combat,
    declared_intent="grab the farmer",
    defense_kind="dodge",
)
```

Chase spends the movement action and keeps positions; `declare_and_resolve_turn` resolves the exchange. HP syncs back onto chase participants.

### Vehicle vs vehicle

```text
chase.vehicle_conflict(attacker_id, defender_id, defense_kind="dodge")
```

Opposed **Drive Auto** (Fighting/Dodge substitute). Damage = winner's **Build×1D10**; striker takes half (capped by target's Build). Build drops 1 per full 10 HP (p.145). Build difference applies penalty dice (1 / 2 / impossible at +3).

### Collisions

`apply_vehicle_collision(actor_id, severity="moderate")` wires Table VI into the session (build damage, passenger HP, movement debt) and records pending rolls/events.

## Part 5 — Optional rules (priority order)

### 1. Pedal to the Metal (p.139-140)

```text
{"type": "pedal_to_the_metal", "locations": 3, "skill": "Drive Auto", "target": 60}
```

One action moves 2–5 locations. Hazards take **1** penalty die (2–3 locs) or **2** (4–5). Commitment cannot be retracted; stop on a failed hazard.

### 2. Passenger actions (p.142)

```text
passenger_action("nav", {"type": "assist_driver", "skill": "Spot Hidden", "target": 70})
```

Success → vehicle gains `assist_penalty_reduction` (−1 penalty die on next Pedal move). Passengers may also `{"type":"fire", ...}`.

### 3. Firing while moving (p.142)

```text
fire_while_moving(attacker_id, target_id, firearms_target=50, moving=True)
```

- Moving: **+1 penalty die**, **0** movement-action cost.
- Stopped: **1** movement action, no movement made, no extra penalty.
- Occupants gain vehicle armor from Table V.

### 4. Choosing a Route (p.139)

```text
choose_route(quarry_id, alternate_locations=[...])
```

Preserves locations at/behind the quarry; replaces the upcoming chain (e.g. river path with a Swim hazard).

### 5. Sudden Hazards (p.139)

```text
sudden_hazard(caller="players", luck_target=50)
sudden_hazard(caller="keeper", luck_target=50)  # must alternate
```

Luck success → caller places a Regular hazard; failure → the other side places. Callers **must alternate**.

`roll_random_hazard(environment="normal"|"hazardous"|"safe")` implements the 01–59 clear / 60+ Regular / 85+ Hard / 96+ Extreme table.

## Persistence

- `save(campaign_dir)` → atomic `save/chase.json` via `write_json_atomic`.
- `ChaseSession.load(path, rng=...)` restores participants, chain, rounds, and sudden-hazard alternation state.
- Drain `drain_pending()` / `drain_events()` into campaign roll/event logs after each turn.
- Audit reads `save/chase.json` — **never trust transcript prose for chase mechanics**.

## Table V vehicles (p.145)

| Key | MOV | Build | Armor | Passengers |
|---|---|---|---|---|
| `car_economy` | 13 | 4 | 1 | 3–4 |
| `car_standard` | 14 | 5 | 2 | 4 |
| `car_deluxe` | 15 | 6 | 2 | 4 |
| `sports_car` | 16 | 5 | 2 | 1 |
| `pickup_truck` | 14 | 6 | 2 | 2+ |
| `truck_6_ton` | 13 | 7 | 2 | 2+ |
| `motorcycle_light` | 13 | 1 | 0 | 1 |
| `motorcycle_heavy` | 16 | 3 | 0 | 1 |

Aliases: `motorcycle` → light; `truck` → 6-ton. Data lives in `references/rules-json/chase.json`.

## Keeper checklist (not a fixed turn pipeline)

1. Read `chase.context`; start only when the fiction is truly a pursuit.
2. Submit the exact structured `chase_start` command through `chase.execute`.
3. Continue only the action chosen in fiction, with the current persisted revision.
4. Resolve pending choices and same-location combat through their owning subsystem.
5. Submit `chase_end` when the quarry escapes, is captured, or the pursuit concludes.
6. Return to immersive play; keep mechanical truth in the JSON snapshot.

Use `[meta]` for detailed rule explanation when the player asks. Keep this skill host-neutral — no Codex-only or Cursor-only gates.
