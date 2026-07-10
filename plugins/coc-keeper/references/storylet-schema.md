# Storylet & clue bonus schema notes

Runtime fields consumed by `coc_storylets.py` / `coc_story_director.py`.
Compiler validation of new optional fields lives in `coc_scenario_compile.py`
(owned separately); missing validation there is intentional until that owner
lands shape checks.

## Storylet `setting_tags`

Optional string array on each storylet in `rules-json/storylet-library.json`.

- Examples: `military`, `domestic`, `urban-civilian`, `wilderness`, `1920s`.
- **Present:** storylet is eligible only when the scene's setting-tag set
  intersects this list.
- **Absent / empty:** setting-neutral — eligible in any setting (subject to
  other gates such as `scene_tags`).

Scene-side setting tags are the union of:

1. `active_scene.setting_tags` (optional override)
2. `active_scene.location_tags` and `active_scene.tags`
3. `module_meta.setting_tags`

These tags are also folded into `_scene_tags`, so existing `scene_tags` hard
filters and the `scene_tag_beat` 5× weight boost can use them when authors put
the same labels on `scene_tags`.

## Module-meta `setting_tags`

Optional string array on `module-meta.json`. Starter examples:

- The Haunting: `["urban-civilian", "domestic", "1920s"]`
- The White War: `["military", "wilderness"]`

## Clue-graph `bonus` (dice texture, non-gating)

Optional object on a clue:

```json
{
  "bonus": {
    "skill": "Library Use",
    "difficulty": "regular",
    "extra_summary": "Player-safe extra detail on success.",
    "on_fail_cost": "time"
  }
}
```

- `skill` (string, required when `bonus` present)
- `difficulty` (string): `regular` | `hard` | `extreme` (default `regular`)
- `extra_summary` (string): player-safe extra reveal on success
- `on_fail_cost` (string): `time` | `pressure` — failure never withholds the
  core clue; it costs time (existing time-cost machinery) or +1 tension pressure

Director emits a non-blocking `skill_check` with
`roll_density_group: "clue-bonus:<clue_id>"` on REVEAL/RECOVER when the player
intent is `investigate` (or a clue affordance skill match fires) and the
selected clue carries `bonus`. Core `delivery_kind: "skill_check"` gating is
unchanged.
