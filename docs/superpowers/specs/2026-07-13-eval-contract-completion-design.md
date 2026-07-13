# Eval Contract v1 Completion Design

**Status:** approved by the project owner on 2026-07-13

**Scope:** finish the executable nightly/release evaluation pipeline without weakening the existing evidence-first contract

**Canonical track:** `plugins/coc-keeper/` plus the open runtime under `runtime/`

## 1. Objective

Complete every repository-controlled part of `eval-spec-v1` so that the
canonical CLI can execute real model-backed evaluation lanes, long-run and
chapter-transition validation, blinded semantic judging, baseline comparison,
and report verification.

The finished system must preserve the distinction between executable software
and externally supplied evidence. In particular, an AI judge must never be
presented as a human calibration reviewer. If genuine human reviews have not
been supplied, the release calibration gate remains `NOT_RUN` and produces a
ready-to-review bundle instead of fabricating `PASS`.

## 2. Model roles

The official model-backed lanes use three independent roles:

| Role | Provider | Model |
|---|---|---|
| Keeper narrator | `zhipu-coding` | `glm-5.2` |
| AI investigator player | `coding-relay` | `gpt-5.6-luna` |
| Blinded semantic judge | `coding-relay` | `gpt-5.6-sol` |

The Keeper continues to use the existing Pi agent configuration and narrator
adapter. The player and judge use the local OpenAI-compatible relay at the
configured runtime endpoint. No API key, bearer token, private endpoint
configuration, or copied Pi authentication file may enter the repository.

Every role uses an independent session. A model failure or identity mismatch
must not silently fall back to another model. Runtime evidence records the
selected provider/model identity, prompt hashes, runner hashes, response mode,
usage, and invocation status.

## 3. Architecture

The suite data flow is:

```text
versioned suite manifest
  -> matrix / continuity / chapter lane
  -> GLM Keeper + Luna player
  -> structured evidence pack
  -> deterministic oracle and completeness audit
  -> spoiler-safe blinded Sol judge
  -> baseline non-inferiority comparison
  -> canonical suite verdict and reports
```

The implementation extends the existing modules rather than creating another
evaluation tree:

- `coc_eval.py` remains the only official CLI.
- `coc_eval_matrix.py` owns persona/seed/case expansion and cell execution.
- `coc_eval_longrun.py` validates 25/50-turn and chapter-transition evidence.
- `coc_eval_semantic.py` creates, validates, and aggregates blinded judge
  artifacts.
- `coc_eval_calibration.py` owns holdout and human-calibration contracts.
- Existing runtime, live match, interactive playtest, completion audit, report,
  rules, and secret-audit modules remain canonical.

## 4. Executable benchmark fixtures

Replace unattested placeholders in the nightly/release matrix with repository
fixtures that contain no copyrighted module prose or Keeper secrets.

Each executable case binds:

- scenario and initial public-state fixture paths;
- persona ID and deterministic seed;
- expected player, Keeper, and judge identities;
- prompt and runner hashes derived from actual inputs;
- turn ceiling and lane type;
- required structured artifacts and hard gates;
- baseline comparability fields.

Fixture self-tests stay visibly classified as deterministic contract evidence.
They do not become battle reports and do not satisfy gameplay-evidence gates.

## 5. Suite behavior

### 5.1 Smoke

Retain fast host-neutral checks for the CLI, case registry, plugin routing,
report schema, and roll completeness.

### 5.2 Pull request

Retain deterministic regression protection, including the permanent cases for
recent runtime defects, fixed replay, host parity, report generation, completion
audit, and dice completeness.

### 5.3 Nightly

Nightly becomes genuinely executable and includes:

- a real Luna-player/GLM-Keeper short-match matrix;
- deterministic persona x seed x case expansion;
- at least one 25-turn and one 50-turn continuity lane;
- state, checkpoint, recall-anchor, secret-audit, token, fallback, and latency
  evidence;
- blinded agency/fun and Chinese-prose comparisons judged by Sol;
- baseline identity and non-inferiority comparison;
- verified battle and engineering evaluation reports.

The default checked-in matrix is intentionally small enough for routine use.
The same manifest schema supports the full persona/seed expansion without code
changes.

### 5.4 Release

Release includes all nightly gates plus:

- the Masks Peru-to-America chapter-transition evidence lane;
- hidden holdout binding and verification;
- genuine human calibration review import and agreement calculation;
- stricter report and evidence completeness;
- a release comparison against the pinned baseline.

If genuine human review or the separately supplied holdout bundle is absent,
release must return `NOT_RUN` with exact reasons. The system still generates a
complete blinded review bundle so the missing external input can be supplied
without changing code.

### 5.5 Diagnostic

Diagnostic execution can select an individual case, persona, seed, or lane for
reproduction. A diagnostic result never implies release readiness.

## 6. Blind judge and privacy boundary

Sol receives only a spoiler-safe A/B package. Baseline and candidate labels are
randomized and replaced with opaque side identifiers. The request contains no
Keeper-only facts, hidden clue graph, director rationale, benchmark forbidden
outcomes, private model credentials, or source-module prose.

Judge output must cite stable public turn/evidence IDs, use the versioned rubric
labels, permit ties and uncertainty, and remain subordinate to deterministic
gates. A favorable semantic score cannot offset a rules, state, secret, dice,
identity, or completeness failure.

## 7. Verdict semantics and failure handling

Only the canonical vocabulary is used:

- `PASS`: every required capability, case, artifact, attestation, and gate is
  present and successful;
- `FAIL`: valid evidence proves that a required gate failed;
- `INELIGIBLE`: execution completed but evidence-grade model or runner
  attestation is invalid;
- `NOT_RUN`: execution could not start or required external evidence is absent;
- `NON_COMPARABLE`: baseline and candidate identities cannot be compared.

Relay unavailability, missing credentials, missing fixtures, and unavailable
models produce `NOT_RUN`. Model identity substitution or incomplete gameplay
attestation produces `INELIGIBLE`. Deterministic correctness and secret-safety
violations produce `FAIL`.

All evidence writes remain atomic and content-hashed. Missing data never becomes
an inferred success.

## 8. Existing full-suite failure

The existing `runtime_sdk_debug` worker-pool key-count failure must be diagnosed
and fixed at its root under the same TDD and evidence discipline. The completion
work may modify runtime code only when a failing regression test proves the
required behavior. The fix must preserve worker isolation, narrator identity,
and lifecycle cleanup.

## 9. Testing strategy

Every new production behavior begins with a failing test. Required coverage
includes:

- relay model identity and no-fallback behavior;
- matrix execution rather than plan-only behavior;
- real runner command construction and artifact collection;
- fail-closed missing-model, missing-fixture, and missing-attestation paths;
- blind A/B randomization and Keeper-secret exclusion;
- 25/50-turn continuity and chapter-transition evidence ingestion;
- baseline comparison and per-dimension non-inferiority;
- human calibration remaining external and non-fabricated;
- holdout hash verification;
- benchmark capability declarations matching actual executable routes;
- regression coverage for the runtime worker-pool failure.

Verification requires:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/ -q -p no:cacheprovider
python3 plugins/coc-keeper/scripts/coc_eval.py run --suite smoke --root .
python3 plugins/coc-keeper/scripts/coc_eval.py run --suite pr --root .
python3 plugins/coc-keeper/scripts/coc_eval.py run --suite nightly --root .
```

At least one real GLM/Luna nightly run must finish and its evidence pack must
pass the canonical `report` and `verify` commands. Sol judge requests and
results must be inspected for blindness and spoiler safety.

Release is verified as executable and fail-closed. It may report `PASS` only
when genuine human calibration and the separately supplied holdout evidence are
present.

## 10. Acceptance criteria

The completion is accepted only when:

1. the full repository test suite has zero failures under the supported Python
   environment;
2. official smoke and PR suites return `PASS`;
3. official nightly executes real GLM/Luna gameplay and returns its evidence-
   justified terminal status;
4. the Sol judge uses an independent session and a truly blinded, spoiler-safe
   request;
5. 25/50-turn and Masks chapter-transition lanes are reachable through the
   canonical CLI;
6. report completeness, roll completeness, secret safety, and model identity
   remain hard gates;
7. release produces an actionable review bundle and never calls AI output human
   calibration;
8. `implemented_capabilities` contains only capabilities reachable through the
   checked-in manifest and CLI;
9. CI and all host instructions continue to route through the same official
   command;
10. no plugin fork, secret material, placeholder model identity, or synthetic
    gameplay battle report is introduced.

## 11. Workspace and git boundaries

The existing untracked `.tools/` directory and
`docs/superpowers/plans/2026-07-13-eval-contract-grok-execution.md` are treated
as user-owned files. They must not be deleted, overwritten, staged, or included
in implementation commits unless the user separately authorizes that scope.
