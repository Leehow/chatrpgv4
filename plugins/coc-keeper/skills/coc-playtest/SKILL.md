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

## Model-scoped acceptance

Use the advisory contract at
`references/playtest-model-lanes-v1.json`. The host's available-model selector
is authoritative; the repository does not gate model IDs.

- Select the Keeper model and reasoning effort before activating `coc-main`,
  then keep them fixed for the whole run. Never switch models mid-run and
  present the result as one-model acceptance.
- For fast iteration, prefer the `fast_iteration` lane with
  `gpt-5.6-luna` when the host offers it. This run may support the three-minute
  opening, lifecycle, deterministic rules/state, and recurrence evidence for
  Luna; it does not establish Sol/Terra or cross-model parity.
- After the fast lane is stable, run at least one fresh
  `quality_confirmation` window on an available `gpt-5.6-sol` or
  `gpt-5.6-terra` for complex Keeper semantics, portrayal, pacing, and
  improvisation quality.
- Spawn the player with no model override. The Codex source coordinator and
  leaves likewise use `model_policy=inherit_parent`, so the entire acceptance
  window stays on the selected model.
- Write this allowlisted object into `run.json` before plugin activation:

  ```json
  {
    "host_model": {
      "provider": "openai",
      "model_id": "gpt-5.6-luna",
      "reasoning_effort": "low",
      "lane": "fast_iteration",
      "selected_before_activation": true,
      "switched_during_run": false,
      "background_model_policy": "inherit_parent"
    }
  }
  ```

  If an accidental model switch occurs, set `switched_during_run=true`, label
  that run mixed-model/exploratory, and start a fresh window for any
  model-scoped acceptance claim. Do not hide the switch or rewrite metadata.
  One prompt/model slip may be transient; three observations of the same
  failure class are a design issue under the shared prompt-first policy.

## Experience constitution (acceptance play)

Whole-product acceptance must feel like a real player loading the plugin, not
like a coverage harness. Follow the repository `Playtest Experience
Constitution` in `AGENTS.md`. In this skill that means:

- Load the same path as ordinary play: `coc-main` → mode protocol →
  `coc-keeper-play` → `coc-story-director`, then other skills as needed. Use
  the unified toolbox. Do not invent a thinner test-only Keeper.
- Do not thin KP craft to finish more modules, hit a scene checklist, meet a
  turn budget, or ship overnight. Coverage queues never authorize skipping
  director, narration, storylets, uptake, or table prose.
- A rules/state shell (`rules.*` / `state.*` / `scene.move` plus short
  log-style prose) is not acceptance play. Advisory layers must be used along
  an acceptance run; a single turn that happens not to need them is fine and
  must not block play. Systematic whole-run zero-call evidence cannot prove
  player-experience parity.
- Record advisory disposition with `evidence.record_adoption` when consulted.
- Player-facing text stays in the session play language with action uptake and
  readable public-roll wording. Never paste toolbox English enums
  (`failure`, `regular`, `hard`, `extreme`), tool envelopes, or
  chain-settlement audit voice (`【串联】`, “本回合不结算”, “执行备选”,
  atom/deferred labels) into table narration.
- `battle-report` `COMPLETE` / `INCOMPLETE` is report-source evidence only. Do
  not claim “测完” or experience parity unless this constitution is satisfied.
  Label smoke / coverage-harness / rules-state-only runs explicitly.

## Procedure

1. Create the fresh run directory, select and record the model lane above,
   then load `coc-main` and the normal gameplay skills, especially
   `coc-keeper-play` and `coc-story-director`. Do not replace the Keeper with a
   test driver or a rules/state-only facade.
2. Create a fresh isolated workspace and start a campaign through the normal
   plugin setup path.
3. Spawn one player subagent with `fork_turns: none` and no model override.
   Give it only its public
   investigator identity, public character sheet, table expectations, and the
   opening player-facing narration.
4. For each turn, run Keeper craft as in ordinary play (director / narration /
   storylets when the fiction warrants; always uptake). If the player packs
   several steps into one reply, decompose and settle them in order per
   `coc-keeper-play` Compound player declarations — do not montage past NPC
   gates or checks, and do not execute later steps after an earlier block.
   Keep that decomposition off the table: player-facing text must remain
   immersive narration (`narration.brief` → draft → `narration.review`), not
   chain-audit labels or CRPG option dumps. After a mid-chain stop, the Keeper
   prose should diegetically acknowledge unplayed later steps and may soft-cue
   alternate paths — without auto-running them. Relay the Keeper's exact
   player-facing text and public choices to that same subagent. Relay only
   its player action back to the Keeper.
5. Run every rule, state change, and save through the normal toolbox/runtime
   path. Dice and state logs remain authoritative; never invent or reconstruct
   results in prose. Quote public rolls in table language, not raw English
   outcome tokens.
6. Append a minimal `transcript.jsonl` record for each completed exchange. Each
   record should identify the turn and contain the player-safe Keeper message,
   the player's reply, and public rule results or choices when present.
7. Continue until structured ending evidence exists or an actual operational
   blocker is documented. A convenient turn count is not a successful ending.
   Do not end early to clear a multi-module queue.
8. Invoke `coc-export-battle-report` after play. That skill is the only owner
   of the final readable `artifacts/battle-report.md` and its completeness
   evidence. Read both files end to end before reporting the result. Report
   experience-parity separately from report completeness.

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

The repository does not parse PDFs. When a scenario source is a PDF, an
external PDF skill on the host performs rendering, visual review, text and
asset extraction, and produces the versioned source bundle (prefer the host's
existing PDF capability; if none, the open-source openai/skills curated
`pdf` workflow). The plugin may only validate and hydrate that bundle through
`coc_pdf_bundle.py`; never add or use a repository parser fallback during a
playtest.

## Failure reporting

State the exact boundary when a run cannot finish: plugin/runtime failure,
subagent unavailable, invalid current state, missing external PDF bundle, or
missing report evidence. Do not convert missing evidence into a pass and do not
substitute a formatter sample or deterministic fixture for actual play.
