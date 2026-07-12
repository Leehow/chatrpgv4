---
name: coc-eval
description: Use for official COC Keeper change validation, regression testing, report generation, report verification, baseline comparison, and delivery of battle/evaluation reports across Codex, ZCode, Cursor, CI, and local development.
---

# COC Evaluation Contract

Official evaluation uses one host-neutral repository entry point:

```bash
python3 ../../scripts/coc_eval.py <command> ...
```

Do not replace this workflow with an agent-specific collection of commands and do not claim an official result from hand-written report prose.

## Named suites

Fast local contract validation:

```bash
python3 ../../scripts/coc_eval.py run --suite smoke --root <repo-root>
```

Change validation before merge:

```bash
python3 ../../scripts/coc_eval.py run --suite pr --root <repo-root>
```

Nightly and release suites may be requested only by name. When their required capabilities are not implemented or evidence is unavailable, preserve the recorded `NOT_RUN` result. Never substitute a smaller suite and call it release-ready.

## Existing playtest runs

Generate the canonical base play report, inject the source-traceable rules-and-dice section, and write the completeness receipt:

```bash
python3 ../../scripts/coc_eval.py report <run-dir>
```

Recompute completeness from the current structured logs and Markdown without regenerating factual content:

```bash
python3 ../../scripts/coc_eval.py verify <run-dir>
```

The required receipt is:

```text
<run-dir>/artifacts/report-completeness.json
```

A required public roll omitted from the report, a duplicate roll marker, an untraced roll marker, a malformed roll log, or a missing roll source log is a hard failure. If the public roll count is zero, the report must say so explicitly.

## Baseline comparison

```bash
python3 ../../scripts/coc_eval.py compare \
  --baseline <baseline-run-or-manifest> \
  --candidate <candidate-run-or-manifest>
```

Identity mismatches such as benchmark version, report schema, seed, model, prompt hash, case id, or initial-state hash produce `NON_COMPARABLE`; they are not silently ignored.

## Status vocabulary

Use only the status recorded by the CLI:

- `PASS`: required evidence exists and the selected implemented suite passes.
- `FAIL`: valid evaluated evidence violates a required gate.
- `INELIGIBLE`: the artifact is complete enough to inspect but lacks gameplay-grade provenance.
- `NOT_RUN`: a required case or capability did not execute.
- `NON_COMPARABLE`: baseline and candidate identities do not permit a valid comparison.

Missing evidence never becomes `PASS`.

## Delivering reports

When the user asks for a battle report or evaluation report:

1. Run `coc_eval.py report` or `coc_eval.py verify` as appropriate.
2. Read `report-completeness.json` and the generated Markdown end to end.
3. Deliver the generated `battle-report.md` or explicitly labeled ineligible verification/diagnostic artifact.
4. Deliver `evaluation-report.md` separately when it exists.
5. State the exact recorded status.
6. **You must not rewrite** the generated report's factual contents by hand, add missing dice from memory, or remove inconvenient failures.
7. If the artifact is a formatter fixture or scripted regression sample, label it as such; do not call it an evidence-grade battle report.
