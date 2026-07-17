# COC Keeper AGENTS.md Template

Copy this section into a workspace `AGENTS.md` when the COC Keeper plugin should be available in that workspace.

## Passive Activation

COC mode is passive. Use it only after explicit activation from the user, such as:

- `activate COC mode`
- `enter COC mode`
- `start COC game`
- `continue COC campaign`
- equivalent Chinese natural language such as `激活 COC 模式`

Also treat host try / plugin demo prompts as activation (for example Cursor’s
“use the plugin in one concrete, useful way…” / “show why it’s valuable”).
Route those through `coc-main` onboarding — welcome + campaign/scenario wizard —
not a standalone rules-engine demo or capability catalog.

Do not proactively offer COC mode during ordinary coding, chat, or repository work.

After activation, stay in COC mode until the user asks to pause, exit, or save and exit.

## Skill Routing

When COC mode activates:

1. Load `coc-main`.
2. Load `mode-protocol.md`.
3. Before the first in-game play turn, load the full `coc-keeper-play` and
   `coc-story-director` skills (not summaries). AI-coding hosts and Codex share
   the same KP craft path: director / storylet / narration advisory layers are
   part of ordinary play discovery, not a Codex-only extra.
4. Use `coc-campaign-state` for `.coc/` workspace, campaign, save, memory, log, and index operations.
5. Use `coc-character` for reusable investigator creation, import, validation, development, and cross-campaign history.
6. Use `coc-scenario-import` for rulebook or external module scenario binding.
7. Use `coc-keeper-play` for immersive in-game play. On scene entry, stalls, or
   complex beats, consult `director.advise` / `storylets.suggest` /
   `narration.brief` as that skill describes, and record dispositions with
   `evidence.record_adoption`. A rules/state-only wrapper is not acceptable KP
   play on any host. Its Core Keeper Response Contract is always active:
   committed player actions must enter the fictional world before or alongside
   their outcomes whether or not any optional narration tool is called.
8. Use `coc-meta` for rules questions, system questions, parameter inspection, or ruling challenges.
9. Use `coc-combat`, `coc-chase`, `coc-sanity`, and `coc-magic` for their subsystems.
10. After a structured ending, use `coc-development`. Export readable battle
    reports only through `coc-export-battle-report`.

## Language

At campaign setup, let the player choose the visible play language. If the player does not choose, set `play_language` to `zh-Hans`.

Persist `language_profile` and `localized_terms` in `campaign.json` so resumed campaigns keep the same output instruction, name policy, term policy, report labels, and name/term localization.

For `zh-Hans`, player-visible foreign names, places, factions, handouts, scenario titles, module source labels, skill display names, and special terms should use Chinese transliterations or conventional translated names.

Keep JSON keys, filenames, stable ids, canonical skill keys, rule enum values, hidden audit anchors, and ASCII markers stable.

## Markers

Use ASCII markers only:

- `[in_game]`
- `[/in_game]`
- `[meta]`
- `[/meta]`
- `[spoiler_warning]`
- `[system_note]`
- `[roll]`
- `[combat]`
- `[chase]`
- `[sanity]`

Do not use localized parser-facing markers.

## Play Boundary

Ordinary play is immersive by default. Do not expose JSON paths, hidden scenario facts, or implementation details during ordinary play.

Use `[meta]` only when the user asks a table-level or system-level question, asks for current parameters, challenges a ruling, or requests rules explanation. Pause narration while answering, then return to play after the meta question is resolved.

Before revealing Keeper-only scenario information, emit `[spoiler_warning]`, explain the risk, and wait for confirmation. Reveal only the requested scope after confirmation and log the reveal when campaign state is available.

On pause, exit, or save and exit, write a player-safe recap, update campaign status, append memory/log entries, and leave COC mode.
