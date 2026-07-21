---
name: coc-export-battle-report
description: Produce the single final player-readable battle-report.md and its structured evidence JSON directly from a real COC Keeper playtest run.
---

# Export the Final COC Battle Report

Use this skill after a real Codex-plugin playtest has finished. The player may
be a Codex subagent. This skill is the only final battle-report writer: it reads
the run evidence directly without invoking a legacy evaluator, formatter, or
audit pipeline.

From the repository root, run:

```bash
uv run --frozen python plugins/coc-keeper/skills/coc-export-battle-report/scripts/export_battle_report.py <run-dir>
```

The run directory may use `run.json` or `playtest.json` for identity. It should
contain:

- allowlisted `host_model` metadata recording the exact model, reasoning
  effort, acceptance lane, pre-activation selection, mid-run switch status,
  and `background_model_policy=inherit_parent`; this remains structured
  development evidence and is not rendered into the player report;

- `transcript.jsonl` with ordered Keeper and player dialogue;
- `sandbox/.coc/campaigns/<campaign-id>/logs/rolls.jsonl` as the authoritative
  structured dice log;
- the campaign's investigator state under `save/investigator-state/`, with
  optional static character sources under `sandbox/.coc/investigators/`.
- `save/world-state.json` and `save/flags.json` for the visited scene path and
  explicitly discovered clue receipts;
- `logs/events.jsonl` plus ending development-settlement receipts for the
  structured conclusion, visible consequences, and final growth;
- optional `save/npc-engagement-receipts.json`; only receipt identity
  (`npc_id`, scene, interaction kind, decision, timestamp) is exported. Its
  Keeper-only `identity_contract`, agenda, voice, schedule, and source material
  are never report sources.

Use `--allow-partial` only for an interrupted run containing
`partial-transcript.jsonl`. The report remains visibly `INCOMPLETE`.

The exporter atomically writes the final pair under `artifacts/`:

- `battle-report.md`: the final readable, player-safe actual-play report;
- `battle-report-evidence.json`: deterministic structured source hashes,
  explicitly allowlisted player-safe evidence plus a clearly marked
  `keeper_internal` section containing exact structured toolbox results,
  advisory adoption receipts, and per-turn capsules for development audit.

The Markdown renders the full initial investigator card, final `current_*`
state, development deltas, personal-horror weave/payoff receipts, visited path,
discovered clues only, player-safe NPC interactions, a focused public
social-skill roll view (Charm / Fast Talk / Intimidate / Persuade only;
Psychology is Keeper-concealed and never listed), recorded major decisions
and consequences, the structured ending/recap, exact ordered transcript, and
the complete public-roll appendix. Static card values are not presented as
final values, and numeric zero is never treated as missing.

Every `public` or `consequence_public` roll must have a unique `roll_id` and
source-traceable numerical evidence. Each is rendered exactly once. A missing
roll log, duplicate ID, or malformed required public roll makes the report
`INCOMPLETE`; a valid empty log reports a public roll count of zero.

The Markdown excludes Keeper-only rolls, Keeper-view logs, module/scenario
truth, hidden event logs, runner prompts, structured JSON fragments, and
secret/private fields. The JSON evidence is Keeper-internal and may preserve
structured tool results (including secret-marked reference data) so developers
can audit what the KP actually saw and used; never publish it as a player
artifact.
Never reconstruct missing dice or hidden facts from prose. Before delivery,
read `battle-report.md` end to end and inspect the evidence JSON's
`completeness` and `public_rolls` sections. State an `INCOMPLETE` result
honestly.

Completeness is split into source identity, exact transcript, dice,
character/final state, progression, ending/development, and player-safe
projection dimensions. The compatibility `COMPLETE`/`INCOMPLETE` classification
means report-source evidence completeness only. It does **not** certify prose
quality, Director/Storylet use, or whole-product KP quality.

Both outputs also carry an observational **Play Conduct Signals** section
(`play_conduct_signals` in the evidence JSON). It restates structured facts
only: dialogue turn count, public roll count, per-turn toolbox-call counts
(when the keeper-internal log is present), how many recorded clues had
module-authored `delivery_kind=skill_check` without any roll of the authored
skill in `rolls.jsonl`, and how many NPC engagement receipts were improvised
(no authored `identity_contract`). The exporter reads
`scenario/clue-graph.json` for these counts only — clue content is never
projected. The section makes no pass/fail judgment and never changes the seven
completeness dimensions or the `COMPLETE`/`INCOMPLETE` classification; it is
listed in `completeness.not_claimed` as no quality judgment. Use it in human
review to spot unconstrained-play red flags — for example the combination of
many dialogue turns, zero public rolls, and skill-check clues without roll
evidence greater than zero suggests checks were narrated away instead of
rolled.
