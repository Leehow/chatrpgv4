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
Ordinary play writes those inventories only through `state.item_grant` /
`state.item_remove` / `state.item_use` (query with `state.inventory_list`).
When the KP needs a legal weapon/spell/creature/`weapon_id` from the rules
tables, call `rules.catalog_search` first and pick the exact `entity_id`
semantically (keep multiple candidates if `.38`-style queries are
ambiguous; never regex-auto-select). `state.item_grant(kind=weapon)` then
validates that id against the active catalog, a legal `mechanics_ref`, or a
complete custom weapon schema and fail-closes without writing inventory on
unknown ids. That search tool is Keeper-only advisory; never copy its payload or
`secret:true` rows into player-visible state or prose. Spells and creatures
are searchable the same way; Pi play has no `combat.spawn` and no live
`rules.cast` toolbox tool — do not advertise a complete spawn/cast wiring.

Runtime cash is the same investigator-state file under `cash` (schema v2:
per-currency `balances` + ledger). Ordinary play credits, debits, and reads
it only through `state.cash_grant` / `state.cash_spend` / `state.cash_query`.
Each write needs audit `reason` and player-safe `localized_reason` in the
active `play_language`. The tool stamps `game_time`; do not store or pass
wall-clock time as player text. Currencies never convert. ASCII currency codes are case-insensitive
(`usd`→`USD`); `美元`/`英镑` (and `dollar`/`pound`) are identity aliases for
`USD`/`GBP`, not FX. Omit `unit` to reuse the recorded unit for that
wallet. Player-visible
projections show `localized_reason` and game/player time only — never raw
`reason` or `recorded_at`. Do not treat sheet `cash` strings,
`rules.cash_assets`, or `state.cash_semantic` as a live spend ledger.
Current Assets, living standard, and inclusive Spending Level live on the
same file under `finance`, seeded once from chargen. Query them with
`state.finance_query` (it also returns current cash). Never treat the sheet
snapshot or `toolbox-asset-heads.json` as live Assets. Buys use
`state.purchase` (one write: item plus optional cash). Asset conversion uses
`state.assets_liquidate` linked to a settled `state.advance_time`. Do not
simulate a purchase with sequential `state.cash_spend` then `state.item_grant`.

Long-term story memory lives under `.coc/campaigns/<id>/memory/` (see
`../../references/memory-protocol.md`). The single canonical Pi-Coc path is
the Git-backed temporal memory of schema generation `temporal-memory-1`:
the sidecar Git history is the immutable record of everything that happened,
SQLite at `memory/history-projection.db` is a deletable, rebuildable
projection (no migration, no dual reader, no fallback), and
`memory/temporal/*.jsonl` episodes and bitemporal assertions are the
canonical advisory temporal records. Ordinary play uses only the canonical
typed operations: `history.query` / `history.diff` (read-only history reads
with semantic timeline/turn selectors), `memory.recall` (deterministic
candidate narrowing) and `memory.adjudicate` (KP adjudication, idempotent
via `decision_id`), plus the worldline operations `timeline.fork_request` /
`timeline.fork_confirm` / `timeline.confluence_query` /
`timeline.confluence_confirm`. Memory is never authoritative truth: HP,
clues, items, time, and dice stay with `state.*` / `rules.*`; recall returns
advisory candidates and the KP judges relevance semantically. Legacy Markdown cards, context packs, and indexes are immutable historical
evidence, never an alternate or fallback memory path: non-canonical legacy
technical debt. Their retired `memory.search` / `memory.write` /
`memory.resolve_hook` tools are no longer registered anywhere; no live KP,
Director, or runtime reads or writes them.
They remain on disk and are never silently migrated or deleted. Only the
explicit non-destructive historical converter (`coc_legacy_memory_convert.py`)
or report/export evidence path may read them; the converter creates a fresh
temporal target without mutating source bytes or evidence. Ordinary play uses
temporal memory only and never hand-edits live memory files.

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
