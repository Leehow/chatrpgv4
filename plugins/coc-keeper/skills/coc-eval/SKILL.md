---
name: coc-eval
description: Use for official COC Keeper evaluation through the canonical coc_eval.py entry point — suite runs, report verify, compare, matrix, calibrate, and holdouts.
---

# COC Eval (Official Evaluation Contract)

Official evaluation for Codex, ZCode, Cursor, CI, and local agents enters only
through:

```bash
python3 plugins/coc-keeper/scripts/coc_eval.py <command> ...
```

Do not invent a host-specific evaluation tree. Shared behavior stays in
`plugins/coc-keeper/`. Versioned truth lives under `evaluation/spec/v1/`.

## Commands

```bash
# Named suites (authoritative readiness claims)
python3 plugins/coc-keeper/scripts/coc_eval.py run --suite smoke --root .
python3 plugins/coc-keeper/scripts/coc_eval.py run --suite pr --root .
python3 plugins/coc-keeper/scripts/coc_eval.py run --suite nightly --root .
python3 plugins/coc-keeper/scripts/coc_eval.py run --suite release --root .
python3 plugins/coc-keeper/scripts/coc_eval.py run --suite diagnostic --root .

# Report contract for an existing playtest run
python3 plugins/coc-keeper/scripts/coc_eval.py report <run-dir>
python3 plugins/coc-keeper/scripts/coc_eval.py verify <run-dir>

# Baseline identity + dimension comparison
python3 plugins/coc-keeper/scripts/coc_eval.py compare --baseline <a> --candidate <b>
python3 plugins/coc-keeper/scripts/coc_eval.py baseline --source <run-manifest> --output <baseline.json>

# AI-player matrix planning / execution (fail-closed without credentials)
python3 plugins/coc-keeper/scripts/coc_eval.py matrix --suite nightly --root . --plan-only
python3 plugins/coc-keeper/scripts/coc_eval.py matrix --suite release --root .

# Human calibration agreement + holdout hash binding
python3 plugins/coc-keeper/scripts/coc_eval.py calibrate --reviews <reviews.json>
python3 plugins/coc-keeper/scripts/coc_eval.py holdouts --bundle <holdout-dir>
```

Use `smoke` for fast local contract checks and `pr` for ordinary change
validation. Claim `nightly` or `release` only when that exact suite records
`PASS`. A `NOT_RUN` required capability must not be hidden by running a smaller
suite.

## Status vocabulary

Exact statuses: `PASS`, `FAIL`, `INELIGIBLE`, `NOT_RUN`, `NON_COMPARABLE`.

Missing credentials, missing attestation, unbound holdouts, or missing
artifacts are `NOT_RUN` or `INELIGIBLE` — never a synthetic `PASS`.

## Evidence delivery rules

- Structured logs, case results, completeness receipts, and artifact SHA-256
  hashes are authoritative.
- Before delivering a battle or evaluation report, read
  `artifacts/report-completeness.json`.
- Deliver generated reports bound to that receipt. Do not rewrite factual
  content by hand, and never reconstruct missing dice from memory or prose.
- Completion audit and suite aggregation consume `evaluation/spec/v1`
  benchmark/case/matrix requirements. The three historical playtest profiles
  remain visible but cannot satisfy current release-required cells alone.

## Deterministic fixtures vs external-model gameplay

| Evidence class | What it proves | What it is not |
|---|---|---|
| Deterministic fixture / registry pytest / schema self-test | Contract, routing, dice completeness, validator fail-closed behavior | Live LLM-vs-KP battle report |
| External-model / human / holdout lane | Gameplay or calibrated judgment when attested | Available without secrets; without evidence it stays `NOT_RUN` |

Formatter smoke samples and synthetic unit fixtures must be labeled as such.
Do not present them as gameplay battle reports.

## Related skills

- Simulated-player harnesses, suite reports, and battle-report formatting:
  `coc-playtest`
- Project rules: repository root `AGENTS.md`
