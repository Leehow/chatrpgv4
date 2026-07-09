# W5 Task 2 Report: P2-3' — list_investigators registry

## Status
COMPLETE

## Commit
Commit directly on `release/0.15-alpha` (no feature branch).
- Message: `feat(coc): add list_investigators registry (P2-3')`
- Files: 4 changed, +203 lines — `.superpowers/sdd/w5-t2-report.md`, `plugins/coc-keeper/scripts/coc_state.py`, `plugins/coc-keeper/scripts/coc_state.py`, `tests/test_state.py`.
- Hash: run `git log -1 --format=%H` for the above message; embedding the hash here is unstable because amending to record the hash changes the hash. The commit is the HEAD of `release/0.15-alpha` as of this report.

## What was done
Added `list_investigators(root)` to `plugins/coc-keeper/scripts/coc_state.py` (canonical) and synced to `plugins/coc-keeper/scripts/coc_state.py`.

### Implementation
- Scans `coc_root(root)/investigators/*/character.json` for existing investigators.
- Returns `list[dict]` of summary entries with keys: `investigator_id`, `name`, `occupation`, `era`, `path` (relative to root).
- Sorted by `investigator_id` (ascending).
- `investigator_id` resolved from `sheet["investigator_id"]`, falling back to `sheet["id"]`, then to the directory name. Rationale: on-disk `character.json` consistently carries `id`; `investigator_id` is present on newer records only (verified against `.coc/investigators/*/character.json`). Both are honoured so the registry stays correct for legacy and new sheets.
- Robustness:
  - Returns `[]` when `investigators/` does not exist.
  - Skips non-directory entries and directories without `character.json`.
  - Skips directories whose `character.json` is malformed JSON or a non-object (does not raise).
  - Missing `name`/`occupation`/`era` default to `None` rather than raising.
- Does not consult `investigators.json` index: the filesystem is the authoritative source and the index can drift (stale after manual edits). This matches the brief's primary instruction to scan `character.json`.

### Tests (TDD)
3 new tests in `tests/test_state.py` (module var `coc_state`):
1. `test_list_investigators_enumerates_existing_investigators` — creates 2 investigators via `create_investigator`, asserts 2 entries with correct `investigator_id`/`name`/`occupation`/`era`, sorted by id.
2. `test_list_investigators_skips_dirs_without_character_json_and_tolerates_missing_fields` — creates one full and one minimal investigator, adds an empty dir and a malformed-JSON dir; asserts only the two real investigators are returned and that missing `occupation`/`era` are `None`.
3. `test_list_investigators_returns_empty_list_when_none_exist` — asserts `[]` after `ensure_workspace` with no investigators.

## Test summary
- New `list_investigators` tests: 3 passed.
- `tests/test_state.py`: 12 passed (9 pre-existing + 3 new), 0 failed.
- `tests/test_coc_plugin_sync_script.py`: 4 passed (sync check confirms plugin copies are in sync).
- Full suite: 1090 passed, 0 failed.

## Single-track sync
- `plugins/coc-keeper/scripts/coc_state.py` (canonical, Codex) edited.
- `scripts/sync_coc_plugin_copy.py` run; `--check` reports "plugin copies are in sync".
- `diff` of the two `coc_state.py` copies: IDENTICAL.
- `coc_state.py` is not in `INTENTIONAL_PLATFORM_DRIFT_FILES`, so the two copies must stay byte-identical — confirmed.

## Files
- Modified: `plugins/coc-keeper/scripts/coc_state.py` (added `list_investigators`).
- Synced: `plugins/coc-keeper/scripts/coc_state.py`.
- Tests: `tests/test_state.py` (3 new tests).

## Concerns
- None blocking. Minor design note: the returned entry includes a `path` field (relative path to `character.json`) beyond the `investigator_id`/`name`/`occupation`/`era`/`...` set named in the brief; the brief explicitly allows `...` (extra fields) and `path` is useful for callers that want to load the full sheet. The field set is a superset of what the brief required, so it should not break expected consumers.
- The `investigators.json` index is intentionally not consulted (filesystem is authoritative); if a future task needs index cross-checking (e.g. to detect drift), that would be a separate function.
