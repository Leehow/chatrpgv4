---
name: coc-campaign-state
description: Manage project-local COC JSON state. Use for creating, reading, validating, snapshotting, or explaining .coc workspaces, campaigns, reusable investigators, logs, memory, indexes, and playtest sandboxes.
---

# COC Campaign State

## State Layout

Load `../../references/state-schema.md` before changing or explaining state layout.

Runtime state lives in the current project under `.coc/`:

- `.coc/investigators/` stores reusable investigator records.
- `.coc/campaigns/` stores campaign-specific save state, memory, logs, scenario data, indexes, and snapshots.
- `.coc/playtests/` stores disposable test runs.

## Operations

Use `../../scripts/coc_state.py` for deterministic state operations:

- `ensure_workspace`
- `create_investigator`
- `create_campaign`
- `link_party`
- `append_jsonl`
- `create_snapshot`

## Safety

- Do not promote playtest sandbox investigators into the real investigator library without explicit user request.
- Append logs instead of rewriting history.
- Create snapshots before risky repair or rollback work.
- Keep Keeper-only scenario files separate from player-safe memory.
