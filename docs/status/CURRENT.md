# COC Keeper Current Status

**Last updated:** 2026-07-10
**Current manifest version:** `0.16.0-alpha.1`
**Release tag:** none for this manifest version

> This file is the repository's only live status source. Plans, audits, worker
> reports, and tagged release notes are historical evidence unless this file
> explicitly adopts their state.

## Current release posture

- The full-hardening initiative is active. Release-governance acceptance
  A01-A06 is represented in current HEAD; A07-A34 must not be inferred complete
  from historical plans or isolated test results.
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
- The open headless runtime exposes Event/PublicState contracts and supports
  the current debug/Pi adapter configuration while the broader composition and
  lifecycle hardening work remains in progress.
- Deterministic automated tests and scripted playtest fixtures are verification
  evidence, not live LLM-vs-KP battle reports.

## Known release risks

- The Haunting rights posture and plugin-image provenance are `UNVERIFIED`.
- An evidence-grade external-model playtest is not claimed by this release
  governance task.
- The full-hardening acceptance ledger remains open beyond A01-A06; later task
  commits must update this file when their status changes.

### Open: Extreme-cold REVEAL time advance

An ordinary `REVEAL` or observe-surroundings action in an outdoor extreme cold
scene still inherits the generic `single_room_search` time cost of 20 minutes.
That can over-advance cold exposure or require manual correction when the
fiction calls for a short scan rather than a full room search. This issue
remains unresolved; no Task 4 fix is claimed. The dated observation in
`docs/live-playtest-notes.md` is historical evidence only, while this section
owns its live status.

## Verification entry points

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_release_consistency.py tests/test_plugin_metadata.py tests/test_starter_scenarios.py tests/test_runtime_sdk_debug.py -q -p no:cacheprovider
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests -q -p no:cacheprovider
git ls-files 'checks/ocr-cached/**' 'checks/py4llm-cached/**'
```

The tracked-file command must print nothing. See `CHANGELOG.md` for committed
post-tag changes and `docs/superpowers/specs/2026-07-10-coc-full-hardening-design.md`
for the approved architecture and complete acceptance definitions.
