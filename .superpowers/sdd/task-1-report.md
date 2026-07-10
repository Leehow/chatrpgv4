# Task 1 Handoff: Release Hygiene, Version Governance, CI, and Current Documentation

## Summary

- Normalized all required plugin/marketplace release metadata to
  `0.16.0-alpha.1` and updated metadata tests to enforce it.
- Added release-consistency tests for manifest versions, README starter count,
  and tracked extraction caches using a strict RED-to-GREEN cycle.
- Removed 20 generated OCR/Py4LLM extract files from current HEAD without
  rewriting history and added the two exact ignore rules.
- Added `CONTENT_LICENSES.md` covering both starters, rule JSON, images,
  generated extracts, Node dependencies, and Python dependencies. The Haunting
  and other insufficiently evidenced asset groups remain explicitly
  `UNVERIFIED`; no legal conclusion was invented.
- Made `docs/status/CURRENT.md` the only live status source, updated README and
  CHANGELOG to agree with current packaging/version state, and added the exact
  non-executable banner to the historical N1-N8 audit.
- Replaced the single CI job with four explicit jobs: `python`,
  `plugin-metadata`, `node-adapters`, and `product-smoke`. The Python matrix is
  3.11/3.12/3.13 with `pytest pypdf`; the Node job runs `npm ci` for both actual
  lockfiles and executes all three Python adapter contract suites; product
  smoke performs quick start, four turns, close/reload, and one continued turn.

## Files Changed or Added

- `.gitignore`
- `.github/workflows/tests.yml`
- `CONTENT_LICENSES.md` (new)
- `docs/status/CURRENT.md` (new)
- `README.md`
- `CHANGELOG.md`
- `docs/superpowers/specs/2026-07-10-next-phase-optimization-audit.md`
- `plugins/coc-keeper/.codex-plugin/plugin.json`
- `plugins/coc-keeper/.claude-plugin/plugin.json`
- `plugins/coc-keeper/.cursor-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `tests/test_plugin_metadata.py`
- `tests/test_release_consistency.py` (new)

## Files Deleted from Current HEAD

All 20 tracked generated extracts were deleted:

- `checks/ocr-cached/`: `bout-tables.md`, `monsters-ch14.md`,
  `occupations.md`, `phobias-manias.md`, `poisons.md`, `skills-ch4.md`,
  `spells-grimoire.md`, `tomes-ch11.md`, `tomes-table.md`,
  `weapons-table-xvii.md`.
- `checks/py4llm-cached/`: `bout-tables.md`, `monsters-ch14.md`,
  `occupations.md`, `phobias-manias.md`, `poisons.md`, `skills-ch4.md`,
  `spells-grimoire.md`, `tomes-ch11.md`, `tomes-table.md`,
  `weapons-table-xvii.md`.

No history rewrite was performed.

## RED Evidence

Command:

```bash
PYTHONDONTWRITEBYTECODE=1 /opt/miniconda3/bin/python3 -m pytest tests/test_release_consistency.py tests/test_plugin_metadata.py -q -p no:cacheprovider
```

Expected RED result (exit 1):

```text
FAILED tests/test_release_consistency.py::test_release_version_is_consistent
FAILED tests/test_release_consistency.py::test_readme_matches_packaged_starters
FAILED tests/test_release_consistency.py::test_rulebook_extracts_are_not_tracked
3 failed, 48 passed in 0.22s
```

The failures showed the intended drift: all release values were still
`0.2.0-alpha`, README documented 1 starter while 2 were packaged, and Git
tracked 20 extract-cache files.

## GREEN and Verification Evidence

Final release GREEN command:

```bash
PYTHONDONTWRITEBYTECODE=1 /opt/miniconda3/bin/python3 -m pytest tests/test_release_consistency.py tests/test_plugin_metadata.py -q -p no:cacheprovider
```

Result: `51 passed in 0.48s` (exit 0).

Required focused command from the brief:

```bash
PYTHONDONTWRITEBYTECODE=1 /opt/miniconda3/bin/python3 -m pytest tests/test_release_consistency.py tests/test_plugin_metadata.py tests/test_starter_scenarios.py tests/test_runtime_sdk_debug.py -q -p no:cacheprovider
```

Result: `69 passed in 1.01s` (exit 0).

Full repository Python suite:

```bash
PYTHONDONTWRITEBYTECODE=1 /opt/miniconda3/bin/python3 -m pytest tests -q -p no:cacheprovider
```

Result: `1647 passed in 35.93s` (exit 0).

Node adapter installation and contracts:

```bash
npm ci --prefix runtime/adapters/pi
npm ci --prefix runtime/adapters/player
PYTHONDONTWRITEBYTECODE=1 /opt/miniconda3/bin/python3 -m pytest tests/test_runtime_pi_adapter_contract.py tests/test_runtime_player_adapter_contract.py tests/test_narrator_adapter.py -q -p no:cacheprovider -k 'not optional_pi_node_integration_smoke'
```

Results: each `npm ci` added 132 packages, audited 133 packages, and found 0
vulnerabilities; adapter contracts reported `33 passed, 1 deselected in 3.71s`.
The deselected test is the credential-sensitive optional Pi model smoke; the
full suite later ran without exclusions and reported 1647 passing tests.

Product lifecycle smoke was executed locally using the inline program now in
the `product-smoke` workflow job. It performed quick start, exactly four SDK
turns, close/recreate with persisted PublicState equality, then one continued
turn. Result: `product smoke passed: campaign=ci-product-smoke turn=5`; observed
turn progression was `4 -> 5`.

Workflow and repository checks:

- YAML parse: `workflow yaml ok: python, plugin-metadata, node-adapters, product-smoke`.
- `git check-ignore -v` resolved both generated paths to the exact new entries
  in `.gitignore`.
- `git ls-files 'checks/ocr-cached/**' 'checks/py4llm-cached/**'` printed nothing.
- Final `git diff --cached --check` exited 0 after removing two Markdown
  trailing-space hard breaks found by the first staged-diff check.
- Final staged scope was exactly 33 paths: 13 changed/added governance files
  and 20 extract deletions.

## Commit

- Commit: `8228485acbd6b25a6d4a857d54cd695a857eaae6`
- Message: `chore(release): harden content version and CI governance`
- Branch: `codex/coc-full-hardening`

## Remaining Risks and Uncertainties

- The Haunting distribution basis remains `UNVERIFIED` pending external rights
  review. Rulebook-derived structured data and plugin-image provenance are also
  marked `UNVERIFIED` where repository evidence is insufficient.
- Generated extracts are gone from current HEAD, but historical blobs remain;
  history rewriting was explicitly outside scope.
- The narrator adapter has no lockfile at this base revision. CI therefore runs
  `npm ci` for the complete actual lockfile set (`pi` and `player`) and still
  executes the narrator Python contract tests. A future narrator lockfile would
  make its dependency installation independently reproducible.
- The deterministic `[meta]` product smoke validates lifecycle and persistence;
  it is not gameplay evidence and is not presented as a battle report.
- No `0.16.0-alpha.1` tag was created. The broader full-hardening acceptance
  items A07-A34 remain outside Task 1.

## Scope Confirmation

Nothing outside the assigned Task 1 scope was intentionally changed. The two
adapter `node_modules` directories created for verification are ignored and do
not appear in Git status. No revert, reset, clean, rebase, push, deploy, tag,
history rewrite, secret change, or unrelated edit was performed. This report
fully replaces the stale unrelated report and is intentionally written after
the task commit so it can record the final hash.

## Independent Review Revision (2026-07-10)

An independent Task 1 review returned `CHANGES_REQUIRED` with three Important
findings. All three were addressed in one strict RED-to-GREEN revision:

1. `CONTENT_LICENSES.md` now distinguishes the test-only `pytest` dependency
   from runtime `pypdf`, documents the shipped `pymupdf4llm`/PyMuPDF (`fitz`)
   parser path, and documents optional `pdfplumber` overlay/quality tooling.
   Repository paths and use are explicit; upstream licensing remains
   conservatively `UNVERIFIED` where the tree has no independent evidence.
2. Release tests now compare the exact documented starter ID set with IDs from
   packaged `module-meta.json` files. The same-count/wrong-ID mutation probe
   proves a substituted ID is rejected. A05 tests also enforce the exact
   release version, current-status links, sole-status declaration, and
   historical-audit banner across README, CHANGELOG, CURRENT, and the audit.
3. `docs/status/CURRENT.md` now owns the unresolved extreme-cold `REVEAL` /
   `single_room_search` 20-minute issue. CHANGELOG and
   `docs/live-playtest-notes.md` identify the notes as historical evidence and
   point live status to CURRENT. No Task 4 fix is claimed.

### Revision RED Evidence

Command:

```bash
PYTHONDONTWRITEBYTECODE=1 /opt/miniconda3/bin/python3 -m pytest tests/test_release_consistency.py tests/test_plugin_metadata.py -q -p no:cacheprovider
```

Result before documentation fixes (exit 1):

```text
FAILED tests/test_release_consistency.py::test_content_inventory_covers_all_declared_python_dependencies
FAILED tests/test_release_consistency.py::test_current_status_owns_extreme_cold_reveal_issue
FAILED tests/test_release_consistency.py::test_changelog_does_not_delegate_live_status_to_playtest_notes
FAILED tests/test_release_consistency.py::test_live_playtest_notes_are_historical_evidence_only
4 failed, 53 passed in 0.35s
```

The first GREEN attempt exposed a line-wrapped CHANGELOG authority phrase and
reported `1 failed, 56 passed in 0.32s`; the documentation sentence was made
contiguous without weakening the test.

### Revision GREEN and Full Verification

- Revised release consistency + plugin metadata: `57 passed in 0.30s`.
- Required Task 1 focused suite (release consistency, plugin metadata, starter
  scenarios, runtime SDK debug): `75 passed in 1.01s`.
- Exact in-memory identity mutation probe:
  `identity mutation rejected: ['the-haunting', 'the-white-war'] != ['not-the-haunting', 'the-white-war']`.
- Full repository suite:
  `PYTHONDONTWRITEBYTECODE=1 /opt/miniconda3/bin/python3 -m pytest tests -q -p no:cacheprovider`
  returned `1653 passed in 39.44s`.
- `git diff --check` exited 0.
- `git ls-files 'checks/ocr-cached/**' 'checks/py4llm-cached/**'` remained empty,
  and both generated paths still resolved to the exact `.gitignore` entries.

### Revision Commit

- Commit: `59a6793803157afa40fa5388afb0bb2fff9ec4e2`
- Message: `fix(release): close governance review gaps`
- Files: `CONTENT_LICENSES.md`, `tests/test_release_consistency.py`,
  `docs/status/CURRENT.md`, `CHANGELOG.md`, and
  `docs/live-playtest-notes.md`.

No unrelated file was changed by the implementation revision. The report
update is committed separately so the implementation commit remains scoped and
reviewable.
