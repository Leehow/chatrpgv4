# COC State Schema

## Workspace

Runtime data lives under the current project `.coc/` directory:

```text
.coc/
├── rules/
├── investigators/
├── campaigns/
├── playtests/
├── indexes/
├── module-library/
└── exports/
```

Top-level indexes provide machine-readable entry points across the workspace:

```text
.coc/indexes/
├── investigators.json
├── campaigns.json
├── pdf-catalog.json
└── module-catalog.json
```

`investigators.json` records reusable investigator ids, display names, and paths to `creation.json`, `character.json`, `history.jsonl`, `development.jsonl`, and `inventory-history.jsonl`. `campaigns.json` records campaign ids, titles, status, play language, party file, and paths to each campaign's `save/`, `memory/`, and `logs/` folders.

## Reusable Investigators

Investigators are reusable assets:

```text
.coc/investigators/<investigator-id>/
├── creation.json
├── character.json
├── history.jsonl
├── development.jsonl
└── inventory-history.jsonl
```

`creation.json` preserves the original rulebook creation workflow and finance/skill allocation evidence. `character.json` is the reusable long-term sheet. Permanent changes are written to the investigator library only during explicit development, recovery, import, or campaign-ending workflows.

## Campaigns

Campaigns store temporary and scenario-specific state:

```text
.coc/campaigns/<campaign-id>/
├── campaign.json
├── party.json
├── save/
│   ├── world-state.json
│   ├── active-scene.json
│   ├── flags.json
│   └── investigator-state/
├── scenario/
├── index/
├── memory/
│   └── session-summaries.jsonl
├── logs/
│   ├── events.jsonl
│   ├── rolls.jsonl
│   └── audit.jsonl
└── snapshots/
```

`party.json` references reusable investigator ids. Campaign-specific HP, SAN, conditions, and scene position live under `save/`.
`create_campaign` initializes the minimal resume contract: `world-state.json` tracks active scene, subsystem, clue ids, decisions, memory refs, log refs, and investigator-state refs; `active-scene.json` stores the current player-safe scene pointer; `flags.json` stores clue, decision, and spoiler-reveal flags. `campaign.json` persists `play_language`, `language_profile`, and a `localized_terms` map keyed by language, so resumed campaigns keep the same visible narration language, output instruction, name policy, term policy, report labels, and name/term localization. Logs and memory may include `localized_text[play_language]` for player-visible prose that should be rendered directly before falling back to `localized_terms`.

## Logs And Memory

- `logs/*.jsonl` is append-only event history.
- `logs/events.jsonl` stores story events, `logs/rolls.jsonl` stores mechanical roll events, and `logs/audit.jsonl` stores Keeper-facing audit events such as confirmed spoiler reveals.
- `memory/session-summaries.jsonl` stores player-safe running recaps for resume and battle reports.
- `snapshots/` stores point-in-time recovery copies.

## Playtests

Playtest runs use `.coc/playtests/<run-id>/sandbox/` and must not mutate real campaigns or investigators. Promote sandbox artifacts only after explicit user request.
