# COC Evaluation Contract v1

**Status:** proposed design, approved in principle by the project owner on 2026-07-12  
**Scope:** COC Keeper evaluation, regression detection, AI-vs-AI playtests, evidence packaging, and battle/evaluation report contracts  
**Canonical implementation track:** `plugins/coc-keeper/` with the open runtime under `runtime/`; no host-specific plugin forks

## 1. Problem statement

The repository already has a deterministic live-turn pipeline, structured state, roll/event logs, AI player and narrator adapters, playtest harnesses, semantic evaluation artifacts, completion audits, and report generation. The missing piece is a single versioned evaluation contract that every host and coding agent must execute in the same way.

Today, Codex, ZCode, Cursor, and ad-hoc agents can choose different test methods, different profile mixes, and different report formats. That makes results difficult to compare and allows a run to appear successful even when the evidence is incomplete. A recent report omitted dice results entirely. This is unacceptable for a rules-bearing tabletop playtest: a report cannot claim rules or gameplay coverage while silently dropping the rolls that produced those outcomes.

The system therefore needs one host-neutral entry point, one benchmark manifest, one evidence schema, one report schema, and one release-gate vocabulary.

## 2. Design decision

The project adopts an evidence-first mixed evaluation system named **`eval-spec-v1`**.

The design has three invariants:

1. **One protocol:** every host invokes the same repository CLI and benchmark manifest. Agents may not invent an alternative official test workflow.
2. **One evidence pack:** structured runtime artifacts are the source of truth. Markdown reports are deterministic views over that evidence, not substitutes for it.
3. **One report contract:** battle reports and engineering evaluation reports have versioned mandatory sections and completeness audits. If rolls exist, the required roll results must be rendered; if no public rolls exist, the report must state that explicitly.

## 3. Goals

`eval-spec-v1` must:

- detect regressions against a pinned baseline commit rather than merely confirm that a feature was exercised;
- make Codex, ZCode, Cursor, CI, and local development execute the same suites and produce structurally identical reports;
- distinguish deterministic verification fixtures from evidence-grade gameplay runs;
- enforce complete and replayable rule/roll evidence;
- evaluate system reliability, rules, state continuity, module fidelity, player agency, fun, Chinese prose quality, spoiler safety, cost, and latency without collapsing them into one misleading score;
- preserve exact provenance for code, benchmark version, model, prompt, runner, seed, initial state, and generated artifacts;
- turn every confirmed production defect into a permanent regression case;
- remain compatible with the current canonical runtime and current `.coc/playtests/<run-id>/` layout.

## 4. Non-goals

This design does not:

- make LLM judgement authoritative for rules or state correctness;
- require exact prose snapshots from a nondeterministic narrator;
- label formatter fixtures or scripted unit-test outputs as battle reports;
- expose Keeper-only rolls or secrets in a player-facing report;
- create parallel host-specific implementations;
- require subjective language/fun scores to block every ordinary pull request before the judge corpus has been calibrated against human review.

## 5. Normative terminology

The words **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.

Run status uses only the following values:

- `PASS`: all required evidence exists and all gates for the selected suite pass;
- `FAIL`: the run is valid evidence and at least one required gate fails;
- `INELIGIBLE`: the run completed but cannot be treated as gameplay evidence, for example because runner/model attestation is missing or a scripted fixture was used;
- `NOT_RUN`: a required case did not execute;
- `NON_COMPARABLE`: candidate and baseline differ in a dimension that invalidates direct comparison, such as benchmark version, model identity, or initial-state hash.

Missing evidence never becomes `PASS`.

## 6. Canonical host-neutral CLI

All official evaluation workflows MUST enter through one new orchestrator:

```text
python3 plugins/coc-keeper/scripts/coc_eval.py <command> ...
```

Required commands:

```text
coc_eval.py run      --suite <smoke|pr|nightly|release|diagnostic>
coc_eval.py verify   <run-dir>
coc_eval.py compare  --baseline <run-or-commit> --candidate <run-or-commit>
coc_eval.py report   <run-dir>
coc_eval.py baseline --from <commit-or-run>
```

The orchestrator owns suite selection, manifest loading, artifact naming, verification ordering, comparison, and final status. It delegates to existing canonical modules; it MUST NOT reimplement rules, live-turn behavior, report formatting, secret audits, or adapter protocols.

Host skills and agent instructions MUST tell the agent to select a named suite and invoke this CLI. An agent-authored sequence of unrelated pytest commands and hand-written report prose is not an official evaluation run.

### 6.1 Host parity

For the same evidence pack, benchmark version, report schema version, and locale, report generation MUST be deterministic and host-independent. The only allowed host difference is provenance metadata such as `host_id`; it may not change evaluation semantics.

A host-parity regression test MUST prove that report generation from the same fixture produces the same normalized SHA-256 on all supported host paths. Volatile wall-clock timestamps are read from the run manifest and not generated independently by each formatter.

## 7. Versioned benchmark layout

The repository adds:

```text
evaluation/
  spec/v1/
    benchmark-manifest.json
    thresholds.json
    report-contract.json
    rubrics/
      agency-and-fun.json
      zh-prose.json
      module-fidelity.json
    personas/
    cases/
      rules-micro/
      runtime-invariants/
      snapshots/
      fixed-replays/
      long-memory/
      chapter-transition/
    prose-corpus/
  baselines/
    baseline-manifest.json
```

`benchmark-manifest.json` is the only source of truth for required cases, profiles, seeds, suite membership, expected evidence, and gate severity. A host or agent cannot quietly omit a required case and still report `PASS`.

Each benchmark case has:

```json
{
  "schema_version": 1,
  "case_id": "pushed-roll-failure-001",
  "kind": "rules_micro",
  "suites": ["pr", "nightly", "release"],
  "initial_fixture": "...",
  "inputs": {},
  "seed": 42,
  "expected": {},
  "forbidden": [],
  "evidence_requirements": [],
  "gate": "hard"
}
```

## 8. Run identity and evidence pack

Every official run writes `run-manifest.json` before execution and finalizes it atomically after execution.

Required fields:

```json
{
  "schema_version": 1,
  "eval_spec": "eval-spec-v1",
  "benchmark_version": "2026.07.1",
  "report_schema_version": 2,
  "run_id": "...",
  "suite": "pr",
  "case_id": "...",
  "baseline_commit": "...",
  "candidate_commit": "...",
  "host_id": "codex|zcode|cursor|ci|local",
  "scenario_id": "...",
  "player_profile": "...",
  "seed": 42,
  "kp_model": {"provider": "...", "id": "..."},
  "player_model": {"provider": "...", "id": "..."},
  "judge_models": [],
  "prompt_hashes": {},
  "runner_hashes": {},
  "initial_state_sha256": "...",
  "started_at": "...",
  "completed_at": "...",
  "artifact_hashes": {},
  "evidence_eligibility": "eligible|ineligible",
  "evidence_reasons": []
}
```

The run directory uses the following canonical artifact set:

```text
run-manifest.json
playtest.json
transcript.jsonl
player-view.jsonl
keeper-view.jsonl
player-feedback.jsonl
evaluator-notes.jsonl
artifacts/
  battle-report.md
  evaluation-report.md
  rulebook-audit.md
  semantic-eval-request.json
  semantic-eval-result.json
  runner-invocations.jsonl
  state-diffs.jsonl
  narration-audits.jsonl
  judge-results.jsonl
  baseline-comparison.json
  report-completeness.json
sandbox/.coc/...
```

Structured logs are authoritative. A Markdown sentence cannot prove that a roll or state change occurred unless it resolves to a structured source record.

## 9. Roll evidence contract

### 9.1 Required structured roll fields

Every consequence-bearing roll MUST have a stable roll identity and enough information to replay or audit the result. Percentile checks require, where applicable:

```text
roll_id
decision_id
actor_id
actor_role
check_kind
skill_or_characteristic
base_target
effective_target
difficulty
bonus_penalty_dice
raw_dice
selected_roll
outcome
pushed
luck_spent
success_effect
failure_effect
rule_refs
visibility
```

Non-percentile dice, including damage, SAN loss, rewards, and tables, require:

```text
die_expression
individual_faces
flat_modifier
final_total
purpose
source_roll_id or source_decision_id
visibility
```

Older or partial events MAY be ingested, but missing required fields must be surfaced as `incomplete_roll_record`; they may not be silently discarded.

### 9.2 Public versus Keeper-only rolls

The report compiler classifies rolls by structured `visibility`, not by scanning prose.

- `public`: MUST appear in the player-facing battle report;
- `consequence_public`: the exact Keeper die may remain hidden during play, but the final mechanical result and player-visible consequence MUST appear in the battle report;
- `keeper_only`: MUST remain out of the player-facing battle report but MUST remain in the engineering evidence pack and evaluation report counts.

At minimum, all player checks, pushed rolls, Luck spends, SAN checks/loss, opposed/combat resolutions that affect a player, damage/healing dice, chase hazards, and player-facing random tables are public or consequence-public.

### 9.3 Mandatory battle-report rendering

The battle report contains a mandatory section with the stable anchor `rules-and-dice`.

Each public percentile roll renders:

```text
- [roll-id: r-001] 侦查：掷骰 73 / 目标 60（普通难度）→ 失败
```

Bonus/penalty dice render the raw candidates and selected value. Pushed rolls render both the first roll and pushed roll, the pre-declared risk, and the applied consequence. Opposed rolls render both sides and the comparison rule. Damage and SAN loss render the die expression, individual faces, modifier, and total, for example:

```text
- [roll-id: r-014] 伤害 1d6+1：4 + 1 = 5；HP 11 → 6
```

A summary such as “检定失败” without the rolled value and target is not a complete roll rendering.

### 9.4 Roll completeness gate

`report-completeness.json` records:

```json
{
  "source_roll_count": 12,
  "required_public_roll_count": 9,
  "rendered_public_roll_count": 9,
  "keeper_only_roll_count": 3,
  "missing_roll_ids": [],
  "duplicate_roll_ids": [],
  "incomplete_roll_ids": [],
  "passed": true
}
```

The following are hard failures for every suite that emits a battle report:

- a required public roll is absent from `battle-report.md`;
- a roll is rendered more than once as distinct outcomes;
- a rendered number cannot be traced to the source roll record;
- a pushed roll omits either attempt or its declared risk/consequence;
- a damage or SAN total omits its die breakdown when source faces are available;
- the report claims rules or mechanical-roll coverage while source roll logs are missing;
- the report says no rolls occurred while required public roll count is nonzero.

If `required_public_roll_count == 0`, the report MUST include:

```text
本场没有发生需要记录的公开检定（公开骰数：0）。
```

This explicit zero prevents a missing section from being confused with a genuinely roll-free session.

## 10. Battle report contract

A battle report is an actual-play artifact with evidence-grade or explicitly ineligible provenance. Formatter verification samples remain separate artifacts and cannot be named `battle-report.md`.

The player-facing `battle-report.md` uses report schema version 2 and the following mandatory anchors in order:

```text
battle-report
run-identity-and-evidence
investigator-opening-state
actual-play-replay
major-decisions-and-consequences
rules-and-dice
combat
chase
sanity
clues-found
state-and-continuity
session-ending
story-recap
player-feedback
```

Required content:

- run identity, scenario, models/runners, evidence eligibility, benchmark and report schema versions;
- investigator identity and opening/final HP, SAN, MP, conditions, equipment changes, and relevant skills;
- chronological player/KP turns with stable turn/decision IDs;
- major player choices linked to later visible consequences;
- complete public roll evidence under Section 9;
- subsystem summaries or explicit “not exercised” statements;
- discovered clues only, with no Keeper-only facts;
- scene transitions and continuity-relevant state changes;
- session ending and unresolved player-visible threads;
- player feedback with profile and provenance.

The battle report MUST NOT contain Director rationale, hidden clue graphs, undiscovered facts, Keeper-only rolls, hidden NPC agendas, judge scores, or evaluator notes.

## 11. Engineering evaluation report contract

`evaluation-report.md` is separate from the player-facing battle report. It may contain spoilers and internal evidence references.

Mandatory sections:

```text
Overall Verdict
Run and Comparison Identity
Hard Gates
System Reliability
Rules Accuracy
Module Fidelity
Agency and Fun
Chinese Prose Quality
Spoiler Safety
Performance and Cost
Report Completeness
Baseline Differential
Reproducible Failures
Root Cause Classification
Regression Cases To Add
Recommended Next Fix
```

Every finding includes:

```text
finding_id
severity
case_id
run_id
turn_or_decision_ids
baseline_value
candidate_value
evidence_paths
root_cause_class
minimal_reproduction
release_blocking
```

Allowed root-cause classes are:

```text
system_gap
rules_gap
scenario_compile_gap
narration_gap
player_simulation_gap
report_gap
test_gap
design_gap
model_variance
```

## 12. Evaluation layers

No single layer is sufficient. Official suites combine the following layers.

### 12.1 Deterministic rules and runtime oracles

Used for:

- percentile checks and success levels;
- bonus/penalty dice;
- pushed rolls and Luck restrictions;
- opposed and combined checks;
- SAN, bouts of madness, damage, major wounds, dying, recovery;
- combat and chase state machines;
- pending-choice revision and ownership;
- idempotent command application;
- save/resume and invalidated segments;
- chapter switching and sidecar preservation;
- secret projection boundaries;
- report completeness and roll rendering.

Rules and state correctness require exact expected outcomes. LLM judges cannot override these failures.

### 12.2 Single-turn snapshots

Baseline and candidate receive the same initial state, player input, structured intent, seed, and public context. The comparison records:

- Director action and rationale refs;
- rules requests and results;
- before/after state hashes;
- approved reveals;
- choice affordances;
- final narration;
- secret and style audits.

Exact prose equality is not required. Structural outcomes, forbidden disclosures, rules, state changes, and semantic rubric labels are compared.

### 12.3 Fixed action-trace replay

Baseline and candidate execute the same authored or historical player action sequence. This isolates Keeper/runtime changes from downstream changes in AI-player behavior.

A replay records where the candidate first diverges structurally from the baseline and whether that divergence is allowed, beneficial, or a regression.

### 12.4 End-to-end AI KP plus AI player

The same player model version, persona configuration, prompt hash, and seed set are used for baseline and candidate. Runs may naturally diverge after the first turn; aggregate distributions rather than exact paths are compared.

Scripted runners remain useful deterministic fixtures but are `INELIGIBLE` as gameplay evidence.

### 12.5 Long-run and chapter-transition tests

Nightly and release suites include:

- at least one 50-turn continuity run;
- restart/resume within the run;
- inventory, injury, SAN, relationship, clue, and unresolved-thread recall checks;
- a Masks Peru-to-America chapter-transition route with source and epistemic sidecar preservation.

## 13. Canonical suite matrix

### `smoke`

Purpose: fast local contract check.

Includes:

- schema validation;
- report generation fixtures;
- roll-completeness positive and negative cases;
- plugin metadata and host routing;
- one deterministic live-turn path.

### `pr`

Purpose: merge protection.

Includes:

- all deterministic rules/runtime invariant cases;
- all report-contract cases;
- core single-turn snapshots;
- selected fixed replays;
- secret-safety tests;
- host parity;
- a small, cost-bounded AI sample when credentials are available, otherwise `NOT_RUN` and non-blocking for subjective dimensions only.

Hard failures block merge.

### `nightly`

Purpose: distributional quality and long-run regression.

Includes:

- full deterministic corpus;
- all snapshots and fixed replays;
- persona matrix across at least three seeds;
- language corpus blind evaluation;
- 25-turn and 50-turn runs;
- latency, token, retry, and fallback statistics.

### `release`

Purpose: release candidate acceptance.

Includes:

- everything in nightly;
- evidence-grade external model attestations;
- Masks chapter-transition route;
- hidden holdout cases;
- sufficient paired samples for non-inferiority confidence intervals;
- human spot review of battle reports, roll evidence, and Chinese prose.

### `diagnostic`

Purpose: targeted defect investigation. It may select cases, but it cannot be used alone to claim release readiness.

## 14. Baseline comparison

A candidate is compared only to a baseline with the same:

- `eval_spec` and benchmark version;
- case definition and initial-state hash;
- rules/module fixture version;
- relevant model identity and prompt hash for stochastic lanes;
- seed set;
- report schema version.

Otherwise, the dimension is `NON_COMPARABLE`.

Hard-gate dimensions use exact non-regression. Rate and quality dimensions use configured thresholds and paired bootstrap confidence intervals.

Default release thresholds:

- crashes, secret leaks, illegal state transitions, stale-choice acceptance, duplicate command application, deterministic rule-oracle failures, and missing required rolls: zero tolerance;
- critical clue reachability: no decrease;
- completion rate: no decrease greater than 5 percentage points;
- stuck-turn and fallback rates: no increase greater than 5 percentage points;
- p95 latency: no degradation greater than 20% or one second, whichever is larger;
- tokens per turn: no increase greater than 15% without an explicit accepted trade-off;
- subjective paired dimensions: 95% confidence-interval lower bound above `-0.25` on the 1–5 scale.

No weighted total may hide a failed dimension. A dashboard MAY show a composite score, but release decisions are dimension-by-dimension.

## 15. Player personas

AI-player profiles are structured configuration, not a single adjective in a prompt.

Initial required personas:

```text
careful_investigator
reckless_investigator
skeptical_rules_lawyer
genre_savvy_player
social_first_player
combat_first_player
speedrunner
stuck_player
adversarial_boundary_tester
memory_challenger
colloquial_ambiguous_player
meta_question_player
```

Each profile defines bounded values such as risk tolerance, rules knowledge, metagame tendency, social/combat preference, persistence after failure, verbosity, and goal orientation. The exact profile JSON and hash are stored in the run manifest.

The player receives only public state, player-visible narration, its own character card, transcript tail, and a player-owned pending choice. Player notes remain evaluation-only and MUST NOT be sent to the KP.

## 16. Agency and fun rubric

Fun is evaluated as the player building a useful but incomplete model of the situation: expectations are sometimes confirmed, sometimes complicated, and sometimes reframed with fair evidence.

Per-turn positive labels:

```text
ACTION_ACK
CAUSAL_RESULT
INFORMATION_GAIN
MEANINGFUL_CHOICE
COMPETENCE_REWARD
DEEPENING
COMPLICATION
REFRAMING
PAYOFF
TENSION_CHANGE
```

Negative labels:

```text
DEAD_TURN
EMPTY_CONFIRMATION
AUTO_COMPLIANCE
HARD_DENIAL
FAKE_CHOICE
UNFORESHADOWED_RETCON
REPEATED_AFFORDANCE
KP_TAKES_OVER
STUCK_LOOP
```

Aggregate metrics include dead-turn ratio, repeated-request rate, choice-to-consequence linkage, clue-to-payoff distance, thread opening/progression/payoff, tension variation, route diversity, and natural redirection after player deviation.

Subjective evaluation uses randomized blind A/B pairs. Judges do not know which output is baseline or candidate and must provide evidence spans and labels. They may return `tie` or `uncertain`.

## 17. Chinese prose rubric

Chinese player-visible prose is evaluated separately for:

- natural Chinese syntax;
- register appropriate to KP narration, NPC speech, rules explanation, and report prose;
- observable concrete detail before abstract interpretation;
- restraint and non-repetition;
- NPC voice distinction;
- period, identity, and scene fit;
- absence of machine labels and untranslated internal terminology.

Canonical finding codes:

```text
AI_SUMMARY
TRANSLATIONESE_PASSIVE
ABSTRACT_EMOTION
OVEREXPLAIN
GENERIC_HORROR
MENU_DUMP
MECHANICAL_LEAK
REPETITION
REGISTER_MISMATCH
NPC_VOICE_COLLISION
TOO_LITERARY
TOO_FLAT
UNNATURAL_CJK
```

Deterministic lint catches only surface contract failures. Meaning-bearing classifications use semantic evaluator output with evidence. A fixed phrase list MUST NOT become a story or intent classifier.

Metrics include findings per thousand Han characters, unresolved finding rate, automatic rewrite rate, semantic repetition, NPC voice confusion, new-information density, and blind paired preference.

## 18. Judge independence and anti-gaming controls

- The KP does not receive benchmark forbidden outcomes or judge rubrics.
- The AI player does not receive Keeper secrets or expected routes.
- The judge does not receive baseline/candidate identity.
- The judge runs in a separate context from KP and player.
- Judge model, prompt, temperature, and request/result hashes are recorded.
- A judge must cite turn IDs and evidence spans.
- A judge cannot override deterministic failures.
- Hidden holdout cases are required for release.
- Human reviewers periodically measure judge agreement and adjust only versioned rubrics.

## 19. Failure handling

The orchestrator fails closed.

- Missing source logs: `INELIGIBLE` plus report/evidence failure.
- Missing required case: `NOT_RUN` and suite failure where required.
- Malformed JSONL: preserve the file, record line number and parse error, and fail the relevant evidence gate.
- Missing semantic result: deterministic gates still run; semantic dimensions are `NOT_RUN`, never guessed.
- Model fallback: record exact fallback kind. Template or prose-degradation output is evaluated but does not masquerade as the requested model lane.
- Secret-audit failure: narrator output is rejected or replaced according to current safety policy; the run records the fallback and fails the safety expectation when required.
- Missing or incomplete roll record: render an explicit diagnostic placeholder only in the engineering report, never fabricate dice; fail report completeness.
- Partial report generation: write to a temporary artifact and atomically replace only after verification.

## 20. Integration with current code

The implementation extends existing components rather than replacing them.

### `coc_playtest_suite.py`

Change aggregation from “at least one run covers a dimension” to benchmark/case/persona/seed matrices with baseline differentials and explicit `NOT_RUN`/`NON_COMPARABLE` states.

### `coc_live_match.py` and interactive playtest paths

Emit or bind:

- before/after state hashes;
- decision and roll IDs;
- model/runner/prompt/profile hashes;
- latency, token usage, retry, fallback, and secret-audit references;
- explicit evidence eligibility.

### `coc_playtest_report.py`

Implement report schema version 2, deterministic anchors, exact roll rendering, explicit zero-roll statement, choice-to-consequence links, and report-completeness receipts.

### `coc_playtest_audit.py`

Add public-roll completeness, roll-source traceability, duplicate rendering, pushed-roll sequence, damage/SAN breakdown, and report-schema checks.

### `coc_completion_audit.py`

Read the versioned benchmark manifest instead of treating three historical profiles as the complete release contract. Require baseline comparison and all suite-required case/seed/evidence rows.

### `coc_narration_contract.py`

Keep secret/machine-label violations as hard gates. Keep stylistic naturalness as versioned findings and paired quality evaluation until calibrated for release gating.

### `plugins/coc-keeper/skills/coc-playtest/SKILL.md`

Route all official requests through `coc_eval.py`; forbid host-authored substitute workflows from claiming official PASS or battle-report status.

### `AGENTS.md`

Strengthen the battle-report evidence standard with the roll completeness rule and canonical CLI requirement after implementation.

## 21. Test design

Implementation uses test-driven development. Required test groups include:

### CLI and host parity

- each named suite resolves to the same manifest on every host;
- unsupported ad-hoc suite names fail;
- normalized report hashes match across host provenance values;
- host-specific wrapper attempts cannot omit required cases.

### Roll completeness

- one public percentile roll appears with roll, target, difficulty, and outcome;
- bonus/penalty dice include candidates and selected result;
- pushed roll includes both attempts, declared risk, and consequence;
- opposed roll includes both sides;
- damage and SAN dice include faces, modifier, total, and state delta;
- Keeper-only roll stays out of player report but remains in engineering evidence;
- deleting one rendered public roll makes the audit fail;
- duplicating one roll makes the audit fail;
- fabricating an unlogged roll makes traceability fail;
- zero public rolls produce the explicit zero-roll statement;
- missing source roll logs make the report ineligible.

### Evidence and report identity

- scripted fixtures cannot be named or accepted as evidence-grade battle reports;
- missing model/runner provenance produces `INELIGIBLE`;
- each finding resolves to an existing artifact and turn/decision ID;
- atomic report writes do not leave a passing partial artifact.

### Baseline comparison

- mismatched benchmark/model/seed/initial state produces `NON_COMPARABLE`;
- a deterministic regression blocks regardless of subjective score;
- an omitted required case produces `NOT_RUN` and suite failure;
- no composite score can override a failed hard gate.

### Recent-defect regressions

The initial corpus includes permanent cases for:

- uncommitted `flag_set` scene gates;
- separator-normalized location tags;
- investigator-state seeding when linking a party;
- epistemic sidecar preservation across chapter switch;
- stale roll-signal expiry;
- invalidated checkpoint resume across revisions;
- narrator secret-audit evidence persistence;
- battle-report roll omission.

## 22. Rollout

### Phase 1: canonical contract and dice/report gate

Deliver:

- `coc_eval.py` CLI skeleton and manifest loader;
- report schema v2;
- roll completeness receipt and hard audit;
- canonical explicit zero-roll behavior;
- host skill routing;
- current report tests migrated to the contract.

This phase directly prevents another battle report from silently omitting dice.

### Phase 2: deterministic regression and baseline comparison

Deliver:

- rules/runtime case registry;
- snapshot and fixed-replay runners;
- state hashes;
- baseline manifests and comparison reports;
- recent-defect regression corpus.

### Phase 3: AI-player matrix and semantic evaluation

Deliver:

- structured personas;
- paired A/B judge requests/results;
- agency/fun and Chinese prose metrics;
- model/prompt comparability rules.

### Phase 4: nightly/release long runs

Deliver:

- 25/50-turn continuity lanes;
- Masks Peru-to-America chapter-transition lane;
- statistical non-inferiority gates;
- human calibration workflow and hidden holdouts.

## 23. Acceptance criteria

The design is implemented only when all of the following are true:

1. Codex, ZCode, Cursor, CI, and local instructions route official evaluation through the same CLI and benchmark manifest.
2. A run cannot claim `PASS` when a required case, artifact, semantic result, or roll record is missing.
3. If public rolls exist, every required roll is rendered with source-traceable numerical detail; if none exist, the report explicitly records a public roll count of zero.
4. Removing a dice line from a fixture with a source roll causes a hard failing test.
5. Scripted/formatter fixtures are visibly and mechanically separated from battle reports.
6. The same evidence pack produces the same normalized report hash across hosts.
7. Baseline and candidate comparisons reject mismatched benchmark/model/seed/initial-state identities.
8. Deterministic rules, safety, and state failures cannot be offset by subjective quality scores.
9. Every evaluation finding cites stable evidence IDs and paths.
10. The existing canonical runtime, rules, secret-audit, and reporting modules remain single-track; no host-specific implementation fork is introduced.

## 24. Consequence for future agent work

After implementation, the instruction “跑测试并给我战报” has one unambiguous meaning:

1. select the named canonical suite, defaulting to `pr` for change validation or `release` only when explicitly requested;
2. execute `coc_eval.py`;
3. verify evidence eligibility and report completeness;
4. provide the generated `battle-report.md` and `evaluation-report.md` without rewriting their factual contents by hand;
5. state `PASS`, `FAIL`, `INELIGIBLE`, `NOT_RUN`, or `NON_COMPARABLE` exactly as recorded;
6. never replace missing dice or other evidence with a narrative summary.
