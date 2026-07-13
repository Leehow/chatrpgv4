# Task 2 Report: Materialize and Execute Real Matrix Cells

## Status

Task 2 is complete. The checked neutral benchmark expands to three bounded
nightly cells, derives prompt hashes from the canonical player and narrator
runners, checks model readiness through Pi's configured model registry, and
dispatches READY cells through a focused live-cell adapter that calls
`coc_live_match.run_live_match(...)`.

Sol judge transport remains intentionally deferred to Task 3. The existing
fake-runner matrix tests remain supported, and `ai_player_matrix` is not yet
advertised as an implemented official-suite capability.

## Implementation

- Added `coc_eval_live_cell.py` with a strict, allowlisted fixture loader and
  canonical `.coc/` workspace materializer. Campaign, scenario, save, and
  character JSON writes are atomic; IDs are path-safe.
- The live-cell adapter pins declared Luna/GLM identities in the scoped runner
  environment and calls the canonical player and narrator entrypoints through
  `coc_live_match.run_live_match` with the cell seed, turn bound, live flag,
  output directory, and evaluation provenance.
- Structured canonical results are normalized into `transcript.jsonl`,
  `player-view.jsonl`, `keeper-view.jsonl`, `runner-invocations.jsonl`,
  `evidence.json`, the returned canonical report, and `run-manifest.json`.
  Every normalized evidence artifact is SHA-256 bound in the manifest.
- Cells fail closed as `INELIGIBLE` when canonical runner attestations,
  observed player/KP model identities, or narrator secret-audit evidence do
  not match the declaration. No report prose is used to infer evidence state.
- Matrix planning now derives player/KP prompt hashes from checked source
  paths and rejects missing live-cell sources. It performs a local Pi registry
  and auth preflight rather than requiring evaluation-specific environment
  key names. Injected preflight callbacks remain available to deterministic
  tests.
- Nightly is a bounded proof matrix: one persona across seeds 3, 7, and 11.
  Release retains all twelve personas across four seeds and uses the same
  neutral live case.
- Added original, host-neutral archive fixtures with no copyrighted module
  prose, credentials, or hidden external secrets.
- Updated the canonical trusted-runner registry to the exact current Task 1
  player/narrator hashes. This was an authorized integration dependency: the
  stale bindings made every canonical live run ineligible.

## TDD Evidence

### Initial RED

Command:

```bash
export PATH="/tmp/coc-eval-venv/bin:$PATH"
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_eval_matrix.py -q -p no:cacheprovider
```

Result before implementation:

```text
2 failed, 7 passed in 0.21s
```

The failures were the intended missing interfaces: `build_matrix_plan` did not
accept `model_preflight`, and `coc_eval_live_cell.py` did not exist.

### Initial GREEN

The same focused command passed after the first implementation:

```text
9 passed in 1.66s
```

### Trusted-runner integration RED/GREEN

The first combined matrix/live-match run exposed six existing Task 1
integration failures:

```text
6 failed, 40 passed in 12.42s
```

Standalone evidence reported `trusted_runner_registry_mismatch`; the registry
still pinned the pre-Task-1 runner hashes. After the authorized exact hash
repair, the combined suite passed.

### Canonical nested-report RED/GREEN

A regression using the canonical returned
`playtest/artifacts/battle-report.md` path first failed with:

```text
1 failed in 1.32s
ValueError: canonical live match did not produce battle-report.md
```

After accepting only the returned path when it resolves inside the canonical
playtest directory, the targeted test passed:

```text
1 passed in 1.51s
```

### Evidence-hash RED/GREEN

The manifest hash assertion first failed with `KeyError: 'artifact_hashes'`.
After binding all six normalized artifacts, the targeted test passed:

```text
1 passed in 1.41s
```

## Final Verification

Command:

```bash
export PATH="/tmp/coc-eval-venv/bin:$PATH"
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_eval_matrix.py tests/test_live_match.py \
  -q -p no:cacheprovider
```

Result:

```text
47 passed, 30 warnings in 17.78s
```

The warnings are the existing deprecated `runtime.json` brain-marker warnings.

Command:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_plugin_metadata.py \
  tests/test_release_consistency.py \
  tests/test_playtest_evidence.py::test_trusted_runner_registry_pins_canonical_entrypoints_and_hashes \
  -q -p no:cacheprovider
```

Result:

```text
59 passed in 0.92s
```

Additional checks passed:

```text
python3 -m json.tool  # manifest and both fixtures
PYTHONDONTWRITEBYTECODE=1 python3 -m py_compile  # both Task 2 Python scripts
git diff --check
```

A real local Pi credential preflight, with no evaluation-specific environment
keys supplied, reported `cells=3`, `ready=3`, `not_run=0`.

## Files

- `plugins/coc-keeper/scripts/coc_eval_live_cell.py`
- `plugins/coc-keeper/scripts/coc_eval_matrix.py`
- `plugins/coc-keeper/references/trusted-playtest-runners.json`
- `evaluation/spec/v1/fixtures/matrix/nightly-scenario.json`
- `evaluation/spec/v1/fixtures/matrix/nightly-initial-state.json`
- `evaluation/spec/v1/benchmark-manifest.json`
- `tests/test_eval_matrix.py`

## Self-review

- No semantic behavior is classified by fixed prose fragments or keyword
  lists; eligibility consumes only structured evidence and enums.
- The live-cell adapter does not reconstruct dice, model identities, runner
  attestations, or secret-audit outcomes from narrative text.
- Environment values and Pi auth material are never serialized into benchmark
  artifacts. The preflight returns only readiness.
- Prompt hashes are derived from canonical sources; live cells cannot fall back
  to placeholder hashes. Legacy explicit hashes remain only for existing fake
  adapters.
- The checked fixture prose and IDs are original and neutral.
- User-owned `.tools/` and
  `docs/superpowers/plans/2026-07-13-eval-contract-grok-execution.md` were not
  touched or staged. Controller-owned Task 1 report changes were not staged.

## Concerns

- Automated validation exercised the canonical orchestration with controlled
  runners and performed the real Pi credential/model readiness preflight; it
  did not spend external model calls on a full three-cell benchmark run.
- Sol judging and official `ai_player_matrix` capability promotion remain Task
  3 work by design.

## Review Remediation

The first Task 2 review identified one Critical and three Important gaps. All
four are fixed in the follow-up commit described below.

### Canonical eligibility and attestation

The live-cell adapter no longer accepts the compatibility-only
`{"eligible": true}` shape. A PASS now requires all of the following structured
canonical evidence:

- `eligible_as_gameplay_evidence: true`;
- both player and narrator external-bridge descriptors with non-empty trusted
  identities, exact current canonical runner hashes, and exactly the declared
  observed model identity;
- a present invocation ledger whose canonical evidence artifact hash matches
  the source ledger;
- per-role invocation rows with exact canonical paths, hashes, identities,
  outcomes, and model identities;
- a recomputable, passing narrator secret-audit receipt on every narrator row.

Missing and contradictory fields produce `INELIGIBLE`. This includes a missing
ledger, missing runners, mismatched observed model, mismatched runner hash, or
malformed narrator audit.

RED command:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_eval_matrix.py::test_live_cell_runner_writes_evidence_from_canonical_match \
  tests/test_eval_matrix.py::test_live_cell_runner_uses_canonical_nested_report_path \
  tests/test_eval_matrix.py::test_live_cell_rejects_compatibility_eligible_flag \
  tests/test_eval_matrix.py::test_live_cell_rejects_missing_runner_descriptors \
  -q -p no:cacheprovider
```

RED result:

```text
2 failed, 2 passed in 6.97s
```

GREEN result after strict canonical receipt validation:

```text
4 passed in 10.39s
```

The additional contradiction matrix first exposed the missing-ledger exception:

```text
1 failed, 3 passed in 5.19s
```

After classifying a missing ledger as evidence ineligibility:

```text
4 passed in 5.30s
```

### Identifier and output containment

Persona, case, and cell IDs must now match a path-component-safe identifier
contract before any cell directory is constructed. Execution additionally
resolves every cell below the real `out/cells` root and rejects cells-root or
cell-directory symlinks.

RED command:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_eval_matrix.py::test_matrix_plan_rejects_unsafe_case_id \
  tests/test_eval_matrix.py::test_matrix_plan_rejects_unsafe_persona_id \
  tests/test_eval_matrix.py::test_execute_matrix_rejects_cell_directory_escape \
  -q -p no:cacheprovider
```

RED/GREEN results:

```text
RED:   7 failed in 0.16s
GREEN: 7 passed in 0.11s
```

The attacks cover traversal, absolute paths, and embedded separators and prove
that no outside `run-manifest.json` is written.

### Execution-time prompt integrity

`prompt_sources` now travels in `cell-input.json`. The live-cell runner requires
exact player/KP source maps, resolves both inside the repository, rejects
missing or outside files, recomputes SHA-256 immediately before execution,
compares it with the planned hashes, uses the verified paths as the actual
runners, and records the recomputed values in `run-manifest.json`.

RED command:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_eval_matrix.py::test_live_cell_rejects_prompt_source_change_between_plan_and_execution \
  tests/test_eval_matrix.py::test_live_cell_rejects_missing_or_outside_prompt_source \
  -q -p no:cacheprovider
```

RED/GREEN results:

```text
RED:   3 failed, 2 warnings in 4.55s
GREEN: 4 passed in 6.68s
```

### Persona behavior routing

The matrix persona's structured `persona_id` and `persona_prompt_directives`
now flow through the live-cell adapter into every canonical live-match player
request. The Python adapter and JS runner whitelist only the five established
player-safe fields plus this optional persona pair. Unknown Keeper/evaluation
fields fail before subprocess execution. The JS prompt has a dedicated
persona-directives section that labels directives as play-style constraints,
not scene facts; it performs no prose classification.

RED command:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_eval_matrix.py::test_live_cell_runner_writes_evidence_from_canonical_match \
  tests/test_live_match.py::test_player_request_routes_distinct_personas_without_keeper_fields \
  tests/test_runtime_player_adapter_contract.py::test_player_adapter_rejects_keeper_fields_in_request \
  tests/test_runtime_player_adapter_contract.py::test_personas_produce_distinct_dedicated_prompt_sections \
  -q -p no:cacheprovider
```

RED/GREEN results:

```text
RED:   4 failed in 5.31s
GREEN: 4 passed, 2 warnings in 4.33s
```

The two persona requests and rendered prompt inputs are demonstrably distinct,
while Keeper-only fixture prose is absent from both requests.

Changing the canonical player runner required rebinding its trusted registry
hash. Before the final binding, the combined live/player suite correctly failed
closed:

```text
6 failed, 63 passed, 32 warnings in 21.16s
```

After binding player SHA-256
`43421517360e3229b886558ba81bb6c04563762a183b0c92bfc341e40d383a96`:

```text
69 passed, 32 warnings in 16.23s
```

### Review-remediation final verification

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_eval_matrix.py \
  tests/test_live_match.py \
  tests/test_runtime_player_adapter_contract.py \
  -q -p no:cacheprovider
```

```text
95 passed, 32 warnings in 49.51s
```

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_plugin_metadata.py \
  tests/test_release_consistency.py \
  tests/test_playtest_evidence.py::test_trusted_runner_registry_pins_canonical_entrypoints_and_hashes \
  -q -p no:cacheprovider
```

```text
59 passed in 0.82s
```

`node --check`, Python bytecode compilation for all changed runtime scripts,
and `git diff --check` also passed. The 32 warnings are the existing deprecated
`runtime.json` brain-marker warnings.

Review-remediation files add the authorized persona route in:

- `plugins/coc-keeper/scripts/coc_live_match.py`
- `runtime/adapters/player/adapter.py`
- `runtime/adapters/player/run_player_turn.mjs`
- `tests/test_live_match.py`
- `tests/test_runtime_player_adapter_contract.py`

No external model benchmark calls, Sol judge transport, capability promotion,
or unrelated user paths were included in this remediation.

## Reused-cell containment remediation

A follow-up review found that a regular reused cell directory could contain a
symlinked `workspace` or `playtest` child. The prior code resolved only the cell
directory itself, so workspace materialization or the canonical live runner
could write through those child links.

The live-cell adapter now performs one preflight before any materialization or
runner invocation. It:

- requires existing `workspace` and `playtest` roots to be real directories,
  never symlinks;
- recursively rejects any existing symlink below reused regular workspace or
  playtest roots;
- requires every existing fixed output (`run-manifest.json`, transcript and
  view JSONL files, invocation ledger, report, and evidence receipt) to be a
  regular non-symlink file;
- continues to allow normal reuse of regular directories and regular fixed
  files, which are replaced through the existing atomic writers.

The regressions use pytest-owned temporary outside paths. Both workspace and
playtest attacks snapshot the outside directory before execution and prove it
is unchanged after the fail-closed rejection. The playtest attack additionally
proves workspace materialization never starts. Fixed evidence symlink and
wrong-node-type attacks are also covered.

RED command:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_eval_matrix.py::test_live_cell_rejects_symlinked_runner_owned_directory \
  tests/test_eval_matrix.py::test_live_cell_rejects_unsafe_fixed_artifact_target \
  -q -p no:cacheprovider
```

RED result:

```text
4 failed in 5.79s
```

The workspace/playtest links were accepted, the evidence symlink was silently
replaced, and a directory at `transcript.jsonl` failed only after the canonical
runner with `IsADirectoryError`.

GREEN result after the runner-owned output preflight:

```text
4 passed in 5.46s
```

The explicit regular-directory reuse regression also passed:

```text
1 passed in 1.51s
```

Final requested regression command:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest \
  tests/test_eval_matrix.py \
  tests/test_live_match.py \
  tests/test_runtime_player_adapter_contract.py \
  -q -p no:cacheprovider
```

Result:

```text
100 passed, 32 warnings in 40.39s
```

Metadata, release consistency, and trusted-runner binding verification also
remained green:

```text
59 passed in 0.66s
```

Python compilation for the matrix/live-cell scripts and `git diff --check`
passed. No production file outside `coc_eval_live_cell.py` was needed for this
final containment repair.
