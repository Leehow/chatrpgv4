# COC Keeper Current Status

**Last updated:** 2026-07-13
**Current manifest version:** `0.16.0-alpha.1`
**Release tag:** none for this manifest version

> This file is the repository's only live status source. Plans, audits, worker
> reports, and tagged release notes are historical evidence unless this file
> explicitly adopts their state.

## Current release posture

- Full-hardening implementation evidence is complete through A01-A32. A33
  (terminal validation) and A34 (diagnosis completeness) are awaiting final
  independent acceptance after review-driven Task 15 revisions. The exact
  root-cause and status mapping is in `DIAGNOSIS-LEDGER.md`.
- `plugins/coc-keeper/` is the only canonical plugin implementation. Codex,
  Claude Code, and Cursor use thin host metadata over that single tree.
- Two play-ready starters are packaged: **The White War** and **The Haunting**.
  The Haunting distribution basis remains `UNVERIFIED` pending external rights
  review; see `CONTENT_LICENSES.md`.
- Local rulebook extraction outputs under `checks/ocr-cached/` and
  `checks/py4llm-cached/` are ignored and are not tracked in current HEAD.
- CI has independently diagnosable `python`, `plugin-metadata`,
  `evaluation-contract`, `node-adapters`, and `product-smoke` jobs. The Python
  matrix covers 3.11, 3.12, and 3.13 and installs both `pytest` and `pypdf`.
- Evaluation contract on `design/eval-contract-v1` is executable through
  `coc_eval.py`: completion audit and suite aggregation consume
  `evaluation/spec/v1` case/persona/seed requirements; holdout examples are
  `example_unbound` (`NOT_RUN`); official CLI docs cover
  run/report/verify/compare/baseline/matrix/calibrate/holdouts plus capture-
  then-compare nightly and release external inputs in `coc-playtest` + root
  `AGENTS.md` + `README.md` (no separate `coc-eval` skill — Phase 1 gate
  forbids that parallel skill path).

## Evaluation contract honesty

Implemented capabilities (all ten):

- `canonical_cli`
- `case_registry`
- `report_contract`
- `roll_completeness`
- `baseline_identity_compare`
- `ai_player_matrix`
- `semantic_judge`
- `long_memory`
- `chapter_transition`
- `human_calibration`

Suite posture:

- `smoke` / `pr`: deterministic and expected `PASS` on ordinary CI
- `nightly`: model-backed (KP `glm-5.2`, player `gpt-5.6-luna`, judge
  `gpt-5.6-sol`); capture with `run --suite nightly --output <baseline>`, then
  compare with `run --suite nightly --baseline <baseline> --output <candidate>`,
  then `report` / `verify`. Ordinary GitHub-hosted runners record honest
  `NOT_RUN` without credentials — they do not fake model-backed execution
- `release`: requires `--chapter-run`, `--holdout-bundle`, and
  `--calibration-reviews`; without them status is honest `NOT_RUN` (never claim
  release readiness from a smaller suite)

Evidence classes:

- Deterministic fixture / registry pytest / schema self-tests = contract evidence
- External-model gameplay / human calibration / bound holdouts = gameplay or
  calibrated judgment evidence; without secrets or attestation they stay
  `NOT_RUN`

## Supported product surface

- Ordinary COC play enters through `run_live_turn(...)` and the canonical
  plugin skills under `plugins/coc-keeper/skills/`.
- The open headless runtime exposes Event/PublicState contracts, explicit
  planner/rules/narrator/player composition, durable sessions, scoped reusable
  adapter workers and privacy-safe per-turn telemetry. Legacy `brain` config is
  migrated with an explicit warning.
- Optional epistemic scenario sidecars now carry PDF page/hash provenance,
  artifact-bound semantic compilation, multi-effect belief updates, structured
  question lifecycle, cognitive Storylets, least-privilege Narrator projection
  and replayable epistemic metrics.
- Deterministic automated tests and scripted playtest fixtures are verification
  evidence, not live LLM-vs-KP battle reports.

## Known release risks

- The Haunting rights posture and plugin-image provenance are `UNVERIFIED`.
- An evidence-grade external-model playtest is not claimed by this release
  governance task.
- A credentialed 10–20-turn external-model journey is not present. The product
  smoke is deterministic **NON-GAMEPLAY verification evidence** and is never
  represented as a battle report.

## Known pre-existing CI failures (not introduced by eval-contract-v1)

Documented here so Batch D verification does not paper them over:

| Test / job | Symptom | Evidence it predates this branch |
|---|---|---|
| CI job `product-smoke` / “Quick start save and reload smoke” | Fails on `main` as well as this branch | Job exists unchanged in `.github/workflows/tests.yml` and is out of Batch D allowed-file scope. |

## Runtime narrator retry lifecycle fix (eval-contract-v1)

`tests/test_runtime_sdk_debug.py::test_sdk_legacy_pi_runs_deterministic_turn_then_safe_narrator_only`
previously asserted two pool requests while the incomplete fixture omitted
`secret_audit_complete` / `asserted_fact_refs` / `semantic_audit` and used
`response_mode=prose_fallback`, so coverage retry issued three identical-key
attempts per logical turn (six total). Fix: align the fixture to the approved
coverage-retry contract (`secret_audit_complete=True`, empty asserted/semantic
lists, `response_mode=tool`) so each turn records one successful pool request
on a stable worker key. Commit: `fix(runtime): align narrator retry lifecycle evidence`.

## Resolved hardening items

### Resolved: Extreme-cold REVEAL time advance

Director time selection now uses structured priority: an authored scene
`time_profile` wins, followed by an exact structured intent detail/category,
then the action default. A `REVEAL` carrying `quick_observation` therefore uses
the existing `quick_observation` category (at most five minutes), while an
authored or ordinary deliberate `single_room_search` remains 20 minutes even
in extreme cold. No player prose is scanned. The live regression
`test_live_turn_quick_observation_in_extreme_cold_persists_short_time_and_defers_exposure`
proves that `run_live_turn(...)` persists the shorter clock delta and leaves a
five-minute cold-exposure trigger pending.

## Verification entry points

```bash
export PATH="/tmp/coc-eval-venv/bin:$PATH"   # local lab: Python 3.11
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_release_consistency.py tests/test_plugin_metadata.py tests/test_starter_scenarios.py tests/test_runtime_sdk_debug.py -q -p no:cacheprovider
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_product_smoke.py -q -p no:cacheprovider
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests -q -p no:cacheprovider
python3 plugins/coc-keeper/scripts/coc_eval.py run --suite smoke --root .
python3 plugins/coc-keeper/scripts/coc_eval.py run --suite pr --root .
git ls-files 'checks/ocr-cached/**' 'checks/py4llm-cached/**'
```

The tracked-file command must print nothing. See `CHANGELOG.md` for committed
post-tag changes and `docs/superpowers/specs/2026-07-10-coc-full-hardening-design.md`
for the approved architecture and complete acceptance definitions.
