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

- `transcript.jsonl` with ordered Keeper and player dialogue;
- `sandbox/.coc/campaigns/<campaign-id>/logs/rolls.jsonl` as the authoritative
  structured dice log;
- the campaign's investigator state under `save/investigator-state/`, with
  optional static character sources under `sandbox/.coc/investigators/`.

Use `--allow-partial` only for an interrupted run containing
`partial-transcript.jsonl`. The report remains visibly `INCOMPLETE`.

The exporter atomically writes the final pair under `artifacts/`:

- `battle-report.md`: the final readable, player-safe actual-play report;
- `battle-report-evidence.json`: deterministic structured source hashes,
  sanitized investigator and dialogue evidence, completeness findings, and
  public-roll provenance.

Every `public` or `consequence_public` roll must have a unique `roll_id` and
source-traceable numerical evidence. Each is rendered exactly once. A missing
roll log, duplicate ID, or malformed required public roll makes the report
`INCOMPLETE`; a valid empty log reports a public roll count of zero.

Both outputs exclude Keeper-only rolls, Keeper-view logs, module/scenario
truth, hidden event logs, runner prompts, and structured secret/private fields.
Never reconstruct missing dice or hidden facts from prose. Before delivery,
read `battle-report.md` end to end and inspect the evidence JSON's
`completeness` and `public_rolls` sections. State an `INCOMPLETE` result
honestly.
