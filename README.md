# COC Keeper — Call of Cthulhu Keeper Mode Plugin

COC Keeper is a local Call of Cthulhu 7th edition Keeper mode plugin for Codex and ZCode. It gives the agent a structured tabletop workflow: COC mode activation, investigator creation, scenario import, persistent campaign state, rules lookup, sanity/chase/combat subsystems, a Chapter 6 combat engine, and automated playtest reporting.

The repository is intentionally dual-track:

- `plugins/coc-keeper/` is the canonical Codex plugin.
- `plugins/coc-keeper-zcode/` is the generated/checkable ZCode-native plugin copy.

## What's in this repo

```
plugins/
├── coc-keeper/          # Original Codex plugin (.codex-plugin manifest)
│   ├── scripts/         # Python: rules engine, combat, character, state, playtest harness/audit/report
│   ├── skills/          # COC skills (coc-main, coc-combat, coc-sanity, coc-playtest, ...)
│   └── references/      # Structured rules JSON + reference docs
│       └── rules-json/  # 32 rule tables (percentile-check, sanity, weapons, occupations, ...)
└── coc-keeper-zcode/    # ZCode-native copy (.zcode-plugin manifest, no Codex interface block)
tests/                   # 400+ pytest tests
checks/                  # Exhaustive rulebook validator + rule checklist
docs/superpowers/specs/  # Design specs (coc-keeper-design, combat-state-design)
.agents/plugins/         # Codex repo marketplace metadata
```

## Install For Codex

The easiest global install path is to add this GitHub repo as a Codex plugin marketplace, then install the plugin from Codex's plugin browser.

```bash
codex plugin marketplace add Leehow/chatrpgv4 --ref main
```

Then:

1. Start a new Codex session in the app or CLI.
2. Open the plugin directory. In the CLI, type:

   ```text
   /plugins
   ```

3. Switch to the `COC Keeper Plugins` marketplace.
4. Install `COC Keeper`.
5. Start a new thread so Codex loads the newly installed plugin.
6. Ask Codex to `activate COC mode`, `create a COC investigator`, or `run a COC playtest`.

That marketplace is backed by [`.agents/plugins/marketplace.json`](.agents/plugins/marketplace.json), which points Codex at [`plugins/coc-keeper/`](plugins/coc-keeper/).

### Install From A Local Checkout

If you are developing locally or using a fork:

```bash
git clone https://github.com/Leehow/chatrpgv4.git
cd chatrpgv4
codex plugin marketplace add "$(pwd)"
```

Then open `/plugins`, choose `COC Keeper Plugins`, install `COC Keeper`, and start a new thread.

To update an existing Codex install after pulling new changes:

```bash
git pull
codex plugin marketplace upgrade
```

Then restart the Codex thread that should see the new plugin files.

## Install For ZCode

ZCode should use the generated ZCode-native copy only:

```text
plugins/coc-keeper-zcode/
```

Copy or symlink that directory into your ZCode plugin location according to your ZCode install flow. The ZCode copy contains:

- `.zcode-plugin/plugin.json`
- `package.json`
- `skills/`
- `scripts/`
- `references/`

Do not point ZCode at `plugins/coc-keeper/`; that directory is the Codex track and includes Codex-specific metadata.

## Use The Plugin

Useful first prompts after installation:

```text
Activate COC mode.
Create a COC investigator.
Import this scenario for COC Keeper.
Run a COC playtest with the haunting-module profile.
```

The main bundled skills include:

- `coc-main`: activate, continue, pause, save, or exit COC mode.
- `coc-character`: create and manage investigators.
- `coc-scenario-import`: ingest and index scenarios.
- `coc-keeper-play`: run immersive Keeper play.
- `coc-combat`, `coc-chase`, `coc-sanity`: resolve major subsystems.
- `coc-playtest`: run automated playtest profiles and audits.

## Development

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

### Codex/ZCode Sync Rule

Edit shared plugin behavior in the Codex track first:

```text
plugins/coc-keeper/
```

Then regenerate/check the ZCode copy:

```bash
python3 scripts/sync_coc_plugin_copy.py
python3 scripts/sync_coc_plugin_copy.py --check
```

Before finishing plugin work, run:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_plugin_metadata.py tests/test_zcode_plugin_metadata.py tests/test_coc_plugin_sync_script.py -q -p no:cacheprovider
python3 scripts/sync_coc_plugin_copy.py --check
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
