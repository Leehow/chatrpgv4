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

## Reusable Investigators

Investigators are reusable assets:

```text
.coc/investigators/<investigator-id>/
├── character.json
├── history.jsonl
├── development.jsonl
└── inventory-history.jsonl
```

Permanent changes are written to the investigator library only during explicit development, recovery, import, or campaign-ending workflows.

## Campaigns

Campaigns store temporary and scenario-specific state:

```text
.coc/campaigns/<campaign-id>/
├── campaign.json
├── party.json
├── save/
├── scenario/
├── index/
├── memory/
├── logs/
└── snapshots/
```

`party.json` references reusable investigator ids. Campaign-specific HP, SAN, conditions, and scene position live under `save/`.
`campaign.json` persists `play_language`, `language_profile`, and a `localized_terms` map keyed by language, so resumed campaigns keep the same visible narration language, output instruction, name policy, term policy, report labels, and name/term localization. Logs and memory may include `localized_text[play_language]` for player-visible prose that should be rendered directly before falling back to `localized_terms`.

## Logs And Memory

- `logs/*.jsonl` is append-only event history.
- `memory/` stores current summaries, discovered facts, unresolved threads, relationships, and Keeper notes.
- `snapshots/` stores point-in-time recovery copies.

## Playtests

Playtest runs use `.coc/playtests/<run-id>/sandbox/` and must not mutate real campaigns or investigators. Promote sandbox artifacts only after explicit user request.
