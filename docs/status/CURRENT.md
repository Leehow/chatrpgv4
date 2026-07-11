# COC Keeper Current Status

**Last updated:** 2026-07-12
**Current manifest version:** `0.16.0-alpha.1`
**Release tag:** none for this manifest version

> This file is the repository's only live status source. Plans, audits, worker
> reports, and tagged release notes are historical evidence unless this file
> explicitly adopts their state.

## Current release posture

- The full-hardening implementation is complete through A01-A34 and is in its
  terminal independent-review/validation gate. The exact root-cause mapping is
  in `DIAGNOSIS-LEDGER.md`; no original diagnosis is silently deferred.
- `plugins/coc-keeper/` is the only canonical plugin implementation. Codex,
  Claude Code, and Cursor use thin host metadata over that single tree.
- Two play-ready starters are packaged: **The White War** and **The Haunting**.
  The Haunting distribution basis remains `UNVERIFIED` pending external rights
  review; see `CONTENT_LICENSES.md`.
- Local rulebook extraction outputs under `checks/ocr-cached/` and
  `checks/py4llm-cached/` are ignored and are not tracked in current HEAD.
- CI has independently diagnosable `python`, `plugin-metadata`,
  `node-adapters`, and `product-smoke` jobs. The Python matrix covers 3.11,
  3.12, and 3.13 and installs both `pytest` and `pypdf`.

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
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_release_consistency.py tests/test_plugin_metadata.py tests/test_starter_scenarios.py tests/test_runtime_sdk_debug.py -q -p no:cacheprovider
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_product_smoke.py -q -p no:cacheprovider
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests -q -p no:cacheprovider
git ls-files 'checks/ocr-cached/**' 'checks/py4llm-cached/**'
```

The tracked-file command must print nothing. See `CHANGELOG.md` for committed
post-tag changes and `docs/superpowers/specs/2026-07-10-coc-full-hardening-design.md`
for the approved architecture and complete acceptance definitions.
