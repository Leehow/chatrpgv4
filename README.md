# COC Keeper — Call of Cthulhu Keeper Mode Plugin

A Call of Cthulhu 7th edition (40th Anniversary) Keeper mode plugin for Codex/ZCode, with structured rules, persistent campaign state, a full Chapter 6 combat engine, and automated playtest reporting.

## What's in this repo

```
plugins/
├── coc-keeper/          # Original Codex plugin (.codex-plugin manifest)
│   ├── scripts/         # Python: rules engine, combat, character, state, playtest harness/audit/report
│   ├── skills/          # 12 COC skills (coc-main, coc-combat, coc-sanity, coc-playtest, ...)
│   └── references/      # Structured rules JSON + reference docs
│       └── rules-json/  # 32 rule tables (percentile-check, sanity, weapons, occupations, ...)
└── coc-keeper-zcode/    # ZCode-native copy (.zcode-plugin manifest, no Codex interface block)
tests/                   # 400+ pytest tests
checks/                  # Exhaustive rulebook validator + rule checklist
docs/superpowers/specs/  # Design specs (coc-keeper-design, combat-state-design)
```

## Quick start

### Prerequisites
- Python 3.10+
- `pip install pypdf pytest`

### Run the test suite
```bash
pytest tests/ -q
```

### Run a playtest profile
```bash
python3 plugins/coc-keeper/scripts/coc_playtest_harness.py --profile haunting-module --root . --run-id my-run
python3 plugins/coc-keeper/scripts/coc_playtest_audit.py .coc/playtests/my-run
```

Profiles: `rulebook-smoke`, `haunting-module`, `chase-drill`, `multi-profile-pressure`.

### Validate rule compliance
```bash
python3 checks/exhaustive_rulebook_validator.py .coc/playtests <run-id>
```

## The Rulebook PDF

The Call of Cthulhu Keeper Rulebook PDF is **not included** (copyright + size). It's in `.gitignore`. If you want to run scenario import or rulebook page lookup, place the PDF at:

```
pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).pdf
```

All other functionality (rules engine, combat, playtest, tests) works without the PDF — the structured rules are in `references/rules-json/` as JSON.

## Combat system (Chapter 6)

The combat engine (`scripts/coc_combat.py`) implements the full Chapter 6 system:
- **Semantic model**: caller passes `intent` (natural language) + `resolution_hint` (dice mechanism) + optional `goal` (maneuver effect)
- **8 mechanisms**: firearms can't be dodged, Dive for Cover, Cover, Outnumbered, Point-Blank, Firearms DEX+50, Range→difficulty, flee
- **Weapon catalog** (`rules-json/weapons.json`): canonical Table XVII entries with `adds_damage_bonus` (melee yes, firearms no)
- **Module weapons**: modules declare `weapons[]` with `extends` to inherit catalog stats
- **Structured state**: `save/combat.json` (participants, rounds, turns, damage_chain) — audit verifies from state alone

See `docs/superpowers/specs/2026-07-05-combat-state-design.md` for the full design.

## Plugin installation

### For Codex
Copy or symlink `plugins/coc-keeper/` to your Codex plugins directory.

### For ZCode
Copy or symlink `plugins/coc-keeper-zcode/` to your ZCode plugins directory. The ZCode copy uses `.zcode-plugin/plugin.json` (no `interface` block) and `package.json`.
