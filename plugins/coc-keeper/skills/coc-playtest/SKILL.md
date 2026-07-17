---
name: coc-playtest
description: Run a real COC Keeper acceptance session with Codex as Keeper and a context-free Codex collaboration subagent as the player.
---

# COC Playtest

Use this skill for whole-product acceptance. It deliberately exercises the
actual plugin instead of a scripted virtual player, fixed profile, evaluation
matrix, or alternate Keeper harness.

## Canonical roles

- The main Codex loads the canonical `coc-keeper` plugin and acts as Keeper.
- One collaboration subagent is spawned with `fork_turns: none` and acts only
  as the investigator/player.
- The Keeper relays only player-safe narration, public choices, public rule
  results, and the player's own character information.
- The player never receives module truth, Keeper notes, hidden clues, secret
  state, tool output, repository paths, or the parent conversation.

Collaboration agents share the host workspace. `fork_turns: none` prevents
conversation inheritance; it is not filesystem or cryptographic isolation.
Record that limitation honestly in the report.

## Fresh-run rule

Create a new isolated workspace and campaign for every acceptance session.
Never resume an old test save, copy a completed run into a new run, or use a
historical battle report as runtime state. If current schemas do not match,
discard that test workspace and start fresh. Never point a playtest at the
user's real `.coc/campaigns/` or `.coc/investigators/`.

## Procedure

1. Load `coc-main` and the normal gameplay skills, especially
   `coc-keeper-play`. Do not replace the Keeper with a test driver.
2. Create a fresh isolated workspace and start a campaign through the normal
   plugin setup path.
3. Spawn one player subagent with `fork_turns: none`. Give it only its public
   investigator identity, public character sheet, table expectations, and the
   opening player-facing narration.
4. For each turn, relay the Keeper's exact player-facing text and public
   choices to that same subagent. Relay only its player action back to the
   Keeper.
5. Run every rule, state change, and save through the normal toolbox/runtime
   path. Dice and state logs remain authoritative; never invent or reconstruct
   results in prose.
6. Append a minimal `transcript.jsonl` record for each completed exchange. Each
   record should identify the turn and contain the player-safe Keeper message,
   the player's reply, and public rule results or choices when present.
7. Continue until structured ending evidence exists or an actual operational
   blocker is documented. A convenient turn count is not a successful ending.
8. Invoke `coc-export-battle-report` after play. That skill is the only owner
   of the final readable `artifacts/battle-report.md` and its completeness
   evidence. Read both files end to end before reporting the result.

## Transcript boundary

Keep the transcript simple and auditable. It is a relay record, not a second
runtime, semantic judge, coverage scheduler, or narration gate. Do not derive
scene legality, clue relevance, player intent, or success from transcript
keywords. Structured runtime evidence remains authoritative.

## Deterministic tests

Repository tests remain appropriate for deterministic contracts such as dice,
transactional/idempotent state writes, schemas, path safety, plugin metadata,
the external-PDF source-bundle validator, and production adapter protocols.
They are not whole-product gameplay evidence and must not be presented as a
battle report.

## PDF boundary

The repository does not parse PDFs. When a scenario source is a PDF, the host's
external PDF skill performs rendering, OCR/layout recognition, text and asset
extraction, and produces the versioned source bundle. The plugin may only
validate and hydrate that bundle through `coc_pdf_bundle.py`; never add or use
a repository parser fallback during a playtest.

## Failure reporting

State the exact boundary when a run cannot finish: plugin/runtime failure,
subagent unavailable, invalid current state, missing external PDF bundle, or
missing report evidence. Do not convert missing evidence into a pass and do not
substitute a formatter sample or deterministic fixture for actual play.
