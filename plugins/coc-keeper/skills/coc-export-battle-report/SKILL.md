---
name: coc-export-battle-report
description: Export a COC Keeper playtest into deterministic lossless source-bundle JSON plus player-safe Markdown without replacing the canonical evaluated battle report.
---

# Export COC Battle Report Source Bundle

Use this skill when a completed playtest needs a deterministic archive of the
player-visible sources behind its report. This export is supplementary evidence;
it never creates or replaces the canonical evaluated `battle-report.md`.

First recompute the canonical report receipt:

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_eval.py verify <run-dir>
```

Then export from the repository root:

```bash
uv run --frozen python plugins/coc-keeper/skills/coc-export-battle-report/scripts/export_battle_report.py <run-dir>
```

Add `--allow-partial` only when `transcript.jsonl` is absent and the run has
`partial-transcript.jsonl`. A partial export remains visibly `INCOMPLETE`.

The exporter writes exactly these supplementary files:

- `artifacts/battle-report-source-bundle.json`: evaluator/archive source data
  for the explicitly bounded inputs, source hashes/counts, public roll
  evidence, and a hash binding to the current completeness receipt and
  canonical report. Treat this JSON as evidence, not as a player handout.
- `artifacts/battle-report-source-bundle.md`: player-safe character context,
  ordered player/KP dialogue, public rolls, source manifest, and completeness
  status.

The Markdown must never contain Keeper-view logs, Keeper-only rolls, raw
scenario/module truth, flags/world state, runner prompts, hidden character
fields, or other hidden material. Keeper-view logs, scenario/module truth, and
runner prompts are excluded from both outputs; bounded state snapshots are
kept only in the evaluator JSON and never rendered into Markdown. Inspect both
outputs before delivery, confirm their `report_id` values match, and state a
failed, missing, mismatched, or not-recomputed completeness receipt honestly.

This export makes no official evaluation claim. Only the canonical
`coc_eval.py` named suites may report `PASS`, `FAIL`, `INELIGIBLE`, `NOT_RUN`,
or `NON_COMPARABLE`.
