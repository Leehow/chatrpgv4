# Eval Contract Phases 2–4 Execution Plan (Orchestrated)

**Role split:** The orchestrating agent owns design, batch sequencing, and
acceptance review. Implementation workers execute batches exactly as scoped
here and in `2026-07-12-coc-evaluation-contract-phases2-4.md` (the task
contract). Workers do not renegotiate scope, do not weaken gates, and do not
mark anything complete without the listed verification evidence.

**Branch:** `design/eval-contract-v1` (Draft PR #8). Base: `main`.

## Current state (verified 2026-07-13, HEAD 554137a)

Already DONE — do not redo:

- Task 1 (report schema v2): complete, tests green.
- Task 2 (deterministic case registry): complete; 12 cases registered;
  `run --suite smoke|pr` returns `PASS` under Python 3.11.
- Task 3 partially: `coc_eval_compare.py` + `tests/test_eval_compare.py`
  exist and pass (identity binding, dimension thresholds, paired bootstrap
  CI). Thresholds live in `evaluation/spec/v1/thresholds.json`.

Remaining gap in Task 3: `coc_eval.py compare` still routes only to
`contract.compare_run_manifests` (identity + hard gates). Dimension-level
`compare_evaluation_runs` is not reachable from the CLI, and
`artifacts/baseline-comparison.json` + Markdown differential (Task 3 Step 4)
are not produced.

Tasks 4–10: not started.

## Environment (mandatory for every worker)

- Local default `python3` is 3.9 and MUST NOT be used. Every shell that runs
  tests or the CLI must first run:

  ```bash
  export PATH="/tmp/coc-eval-venv/bin:$PATH"   # Python 3.11.14 + pytest + jsonschema + pypdf
  python3 --version                             # must print 3.11.x
  ```

- Registry case commands invoke bare `python3`; the PATH export above is what
  makes suite runs match CI (3.11).

## Batches

| Batch | Scope (task contract §) | Key deliverables |
|---|---|---|
| A | Task 3 completion + Task 4 | CLI `compare` wired to dimension comparison; `artifacts/baseline-comparison.json` + Markdown differential; host-parity normalized hashing; fixed replay engine + `state-diffs.jsonl`; snapshot/replay case specs |
| B | Task 5 + Task 6 | 12 structured personas + 3 rubrics; blind A/B judge request/validation/aggregation; matrix planner/orchestrator + CLI `matrix`; fail-closed `NOT_RUN` cells |
| C | Task 7 + Task 8 | 25/50-turn continuity lanes; Masks Peru→America chapter-transition contract; calibration schema + agreement metrics (exact + Cohen's kappa); holdout hash binding; CLI `calibrate`/`holdouts` |
| D | Task 9 + Task 10 | Completion-audit/suite aggregation integration; skills/docs/CI updates; full-repo verification; honest suite statuses; PR body update (stay Draft until green) |

Batches run strictly in order. A batch starts only after the orchestrator
accepts the previous one.

## Non-negotiable red lines (all batches)

1. TDD: every production behavior starts with a failing test committed in the
   same task's history (RED before GREEN, per existing branch style).
2. Single-track law: all runtime behavior in `plugins/coc-keeper/`; no
   parallel plugin trees; `.cursor/skills/coc-keeper/SKILL.md` stays a thin
   router.
3. Semantic matcher constitution: no keyword/regex scanning of free prose to
   infer meaning. Structured fields, enums, IDs, recorded evaluator outputs
   only. Legacy string heuristics must not be copied into new code.
4. Fail-closed statuses: missing credentials/evidence/attestation is
   `NOT_RUN` or `INELIGIBLE`, never a synthetic `PASS`. Deterministic
   failures cannot be offset by subjective scores. No weighted total may
   override a failed dimension.
5. Evidence writes are atomic; artifacts carry SHA-256 hashes.
6. Keeper-only facts and rolls never enter player-facing artifacts, judge
   requests, or player inputs.
7. Do not modify `main`-tracked behavior outside the scoped files without a
   failing-test justification. Do not touch `.zcode/`.
8. Commits: conventional style used on this branch
   (`test(eval): …` / `feat(eval): …` / `ci(eval): …` / `docs(eval): …`),
   one logical step per commit. Never push; the orchestrator handles remote.

## Per-batch acceptance gate (run by the orchestrator)

```bash
export PATH="/tmp/coc-eval-venv/bin:$PATH"
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_eval_*.py -q -p no:cacheprovider
PYTHONDONTWRITEBYTECODE=1 python3 plugins/coc-keeper/scripts/coc_eval.py run --suite smoke --root . --output /tmp/gate-smoke
PYTHONDONTWRITEBYTECODE=1 python3 plugins/coc-keeper/scripts/coc_eval.py run --suite pr    --root . --output /tmp/gate-pr
```

Both suites must report `PASS`. Additionally per batch:

- A: `coc_eval.py compare` on two fixture runs emits dimension regressions
  and writes `baseline-comparison.json`; identity mismatch still returns
  `NON_COMPARABLE`; replay divergence test detects first structural split.
- B: matrix plan for nightly expands persona×seed×case deterministically;
  cells without runner/credentials are `NOT_RUN` with reasons; judge request
  contains no baseline/candidate labels or Keeper secrets.
- C: continuity/chapter validation returns `NOT_RUN` without run evidence,
  `FAIL` on contradictory evidence; holdout manifest mismatch is `FAIL`,
  missing bundle `NOT_RUN`; kappa handles edge cases (empty, single-reviewer
  → `NOT_RUN`).
- D: `python3 -m pytest tests/ -q` zero failures on 3.11; nightly/release
  honest statuses; capability list in `benchmark-manifest.json` matches what
  is actually executable; PR body updated, still Draft.

Review checklist (orchestrator, every batch): read the diff file-by-file;
grep new code for prose-scanning heuristics; confirm no gate was weakened
(especially dice completeness and `NOT_RUN` paths); confirm new registry
cases carry `gate: hard` only when deterministic; confirm no secrets or
copyrighted module text entered `evaluation/spec/`.

## Failure policy

If a worker cannot satisfy a step, it stops, commits nothing half-broken
beyond the failing test, and reports the exact blocker with file/line and
traceback. The orchestrator decides: rescope, fix forward, or revert the
batch (`git revert`, never history rewrite).
