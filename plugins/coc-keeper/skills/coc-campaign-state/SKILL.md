---
name: coc-campaign-state
description: Explicitly inspect, validate, snapshot, restore, or explain project-local COC JSON state. Normal coc-main setup and play use typed gateways and must not select this skill merely to create a campaign, investigator, log, or playtest sandbox.
---

# COC Campaign State

## State Layout

Load `../../references/state-schema.md` before changing or explaining state layout.

Runtime state lives in the current project under `.coc/`:

- `.coc/investigators/` stores reusable investigator records.
- `.coc/campaigns/` stores campaign-specific save state, memory, logs, scenario data, indexes, and snapshots.
- `.coc/playtests/` stores disposable test runs.

Runtime item truth is campaign-local: investigator items live in
`save/investigator-state/<id>.json["inventory"]` (gained `entries`,
`lost_weapon_ids`), NPC item overrides live in `save/npc-state.json["items"]`.
They reach the reusable library sheet only through development settlement
(see `coc-development`), which also appends to `inventory-history.jsonl`.

## Operations

Use `../../scripts/coc_state.py` for deterministic state operations:

- `ensure_workspace`
- `create_investigator`
- `create_campaign`
- `link_party`
- `append_jsonl`
- `create_snapshot`
- `restore_snapshot`

## Safety

- Do not promote playtest sandbox investigators into the real investigator library without explicit user request.
- Append logs instead of rewriting history.
- Create snapshots before risky repair or rollback work.
- Keep Keeper-only scenario files separate from player-safe memory.
