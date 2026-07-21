---
name: coc-keeper
description: >-
  Thin Kimi entry for COC Keeper（《克苏鲁的呼唤》7 版 AI 守秘人）. Use after the
  user explicitly activates COC mode (e.g. "Activate COC mode", "进入 COC 模式"),
  or asks to run a Call of Cthulhu campaign, create an investigator, or import a
  scenario. Routes to canonical skills under plugins/coc-keeper/skills/ — never a
  second skill copy. Portraits use host-native image tools; Kimi has none, so
  skip portraits.
---

# COC Keeper (Kimi thin entry)

This file is a **host adapter only**. All keeper behavior lives in the single
canonical plugin tree of the COC Keeper repository (the workspace that contains
`plugins/coc-keeper/`; paths below are relative to that repository root):

```text
plugins/coc-keeper/skills/
```

Do not create a parallel skill copy under the Kimi skills directory or
elsewhere.

## Passive activation

COC mode is passive. Load keeper skills only after explicit user activation
("进入 COC 模式" / "Activate COC mode"). See
`plugins/coc-keeper/references/AGENTS-coc-mode-template.md`.

## Skill routing

After activation, **read these files before the first in-game play turn** (the
same tree Codex uses; do not improvise a thinner Kimi path):

1. `plugins/coc-keeper/skills/coc-main/SKILL.md`
2. `plugins/coc-keeper/references/mode-protocol.md`
3. `plugins/coc-keeper/skills/coc-keeper-play/SKILL.md` (full file)
4. `plugins/coc-keeper/skills/coc-story-director/SKILL.md` (full file)

Then route as needed to `coc-campaign-state`, `coc-character`,
`coc-scenario-import`, `coc-meta`, `coc-combat`, `coc-chase`, `coc-sanity`,
`coc-magic`, `coc-development`, `coc-playtest`, `coc-export-battle-report`,
and other skills under `plugins/coc-keeper/skills/`.

Runtime scripts and rules JSON also stay under `plugins/coc-keeper/`
(`scripts/`, `references/`). Use the same toolbox every host uses:

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_toolbox.py list
uv run --frozen python plugins/coc-keeper/scripts/coc_toolbox.py <tool> --root <workspace> --campaign <id> --json '<args>'
```

## Kimi / Codex KP craft parity

Kimi is not a rules-engine facade. Follow `coc-keeper-play` and the Core Keeper
Response Contract in canonical `coc-keeper-play/SKILL.md` on every ordinary
in-game reply: enact committed player actions from the investigator's in-world
viewpoint, consult the director/narration advisory layers at their natural
moments, and record advisory dispositions with `evidence.record_adoption`.
Advisory tools never block play and never replace Keeper judgment.

The three hard rules are unchanged: dice and HP/SAN/skill arithmetic are
authoritative (`rules.*`); state writes are transactional via tools (`state.*`
with `decision_id`); module truth is read-only and secrets are revealed only
through play.

## Platform gating

Investigator portraits use **host-native** image tools
(`HOST_NATIVE_IMAGEGEN` in
`plugins/coc-keeper/rulesets/coc7/skills/coc-character/SKILL.md`). Kimi has no built-in image
tool, so **skip portrait generation** and continue character creation. Do not
call Codex `imagegen` from Kimi. Grok Build uses its own `image_gen`.

No other craft layer may be silently dropped on Kimi.

## Install / refresh

This entry is installed into the Kimi user skills directory by:

```bash
bash plugins/coc-keeper/scripts/install-kimi-plugin.sh
```

Re-run the script after repo plugin changes, then start a new Kimi session so
the refreshed skill is picked up. The plugin manifest for Kimi packaging lives
at `plugins/coc-keeper/.kimi-plugin/kimi.plugin.json` and points at the same
canonical skills tree.
