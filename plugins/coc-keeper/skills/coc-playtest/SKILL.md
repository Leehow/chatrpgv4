---
name: coc-playtest
description: Use when running isolated COC Keeper simulated-player tests, evaluator reviews, battle reports, evaluation reports, and regression checks in Codex.
---

# COC Playtest

## Official evaluation entry point

For official readiness claims (`smoke` / `pr` / `nightly` / `release`), use
`coc-eval` and the canonical CLI — do not replace a named suite with an ad-hoc
command list:

```bash
python3 ../../scripts/coc_eval.py run --suite <smoke|pr|nightly|release|diagnostic> --root <repo-root>
```

Also available: `report`, `verify`, `compare`, `baseline`, `matrix`,
`calibrate`, and `holdouts`. Status vocabulary is `PASS`, `FAIL`,
`INELIGIBLE`, `NOT_RUN`, and `NON_COMPARABLE`. Missing evidence never becomes
`PASS`. Deterministic fixture evidence proves contract self-tests; it is not
external-model gameplay evidence. Full command reference is in root
`AGENTS.md` and this skill's official-evaluation section — do not add a
parallel `coc-eval` skill tree (single-track law / Phase 1 gate).

Completion audit and suite aggregation now also surface versioned
`evaluation/spec/v1` case/persona/seed gaps. Historical profiles
(`haunting_module`, `chase_drill`, `multi_profile_pressure`) remain visible
but cannot alone satisfy release-required eval-contract cells.

## Official evaluation commands

```bash
python3 ../../scripts/coc_eval.py run --suite <smoke|pr|nightly|release|diagnostic> --root <repo-root>
python3 ../../scripts/coc_eval.py report <run-dir>
python3 ../../scripts/coc_eval.py verify <run-dir>
python3 ../../scripts/coc_eval.py compare --baseline <a> --candidate <b>
python3 ../../scripts/coc_eval.py baseline --source <run-manifest> --output <baseline.json>
python3 ../../scripts/coc_eval.py matrix --suite nightly --root <repo-root> --plan-only
python3 ../../scripts/coc_eval.py calibrate --reviews <reviews.json>
python3 ../../scripts/coc_eval.py holdouts --bundle <holdout-dir>
python3 ../../scripts/coc_eval.py replay --case <case.json> --output <dir> --root <repo-root>
python3 ../../scripts/coc_eval.py route-compare --run-a <run-a> --run-b <run-b> --semantic-result <result.json> --output <dir>
```

`route-compare` reads `artifacts/route-ledger.json` from two actual-play run
directories and accepts only an artifact-mediated semantic classification bound
to the exact request SHA. `replay` and route comparison therefore use the same
host-neutral entry point as named suites rather than standalone host commands.

### Model-backed nightly (capture then compare)

Required identities (no silent fallback):

- KP / narrator: `zhipu-coding` / `glm-5.2`
- AI player: `coding-relay` / `gpt-5.6-luna`
- Semantic judge: `coding-relay` / `gpt-5.6-sol`

Ordinary GitHub-hosted CI does not run credentialed nightly. Capture a baseline,
then compare a candidate against it with `--baseline`:

```bash
python3 ../../scripts/coc_eval.py run \
  --suite nightly --root <repo-root> --output <baseline-dir>
python3 ../../scripts/coc_eval.py run \
  --suite nightly --root <repo-root> \
  --baseline <baseline-dir> --output <candidate-dir>
python3 ../../scripts/coc_eval.py report <candidate-dir>
python3 ../../scripts/coc_eval.py verify <candidate-dir>
```

The first run is an intentional baseline capture. Because no comparison source
exists yet, its matrix cells and aggregate nightly status remain `NOT_RUN` with
`missing_baseline_evidence`; that result is not a failed model call and must not
be presented as a passing nightly. Only the second run, supplied with
`--baseline <baseline-dir>`, can produce a compared nightly `PASS`.

Without overrides, the versioned matrix policy gives each full-module runner
2400 seconds, each semantic judge 180 seconds, and runs at most two model-backed
cells concurrently. Every completed runner and final cell is checkpointed; an
identical rerun of the same output directory reuses hash-verified checkpoints,
while timed-out `NOT_RUN` cells are retried. `--timeout` overrides both matrix
runner and semantic-judge budgets, and `--matrix-workers` overrides only the
bounded worker count. Continuity uses
versioned total lane budgets from `evaluation/spec/v1/cases/long-memory.json`
(900 seconds for `continuity-25`, 1800 seconds for `continuity-50`). Use
`--continuity-timeout <seconds>` only when an operator deliberately needs to
override both continuity lane budgets without changing matrix/judge timeouts.

Each real matrix cell and continuity segment compiles and verifies its canonical
report before the lane receipt is sealed. On a nightly suite directory,
`report` and `verify` traverse those declared child reports; they do not treat
the suite root as if it were a single playtest directory.

### Release external inputs

Release stays `NOT_RUN` until chapter evidence, a bound holdout bundle, and
genuine human calibration reviews are supplied:

```bash
python3 ../../scripts/coc_eval.py run --suite release --root <repo-root> \
  --chapter-run <run-dir> \
  --holdout-bundle <bundle-dir> \
  --calibration-reviews <reviews.json> \
  --output <release-dir>
```

Deliver generated battle/evaluation reports bound to
`artifacts/report-completeness.json` hashes. Never rewrite factual content by
hand or reconstruct missing dice from prose.

## Isolation

Playtests write to `.coc/playtests/<run-id>/` and must not mutate real `.coc/campaigns/` or `.coc/investigators/` data.

A current playtest artifact is bound to its canonical resolved directory by a
SHA-256 location witness in `run-identity.json`. Do not copy or move a current
artifact and then continue it in place: start a new output directory and pass
the completed source as `resume_run_dir` only when it matches the exact current
schema. Version-mismatched or legacy artifacts are never resumed or migrated;
delete their runtime state and start fresh. Historical battle reports may be
retained read-only as evidence, but are not runtime resume sources.

## Roles

- `keeper_under_test`: runs the COC mode behavior being tested.
- `player_simulator`: sees player-safe information only.
- `evaluator`: inspects full logs and reports after the run.

## Interactive White-Box Driver

### Operator-reviewed long-play (standard full-module method)

This is the reusable, versioned `operator_codex_black_box_v2` default long-play
method for **any compiled module**; it is not tied to The Haunting or to a fixed
turn script. Use the module-agnostic `coc_live_match.py` operator transport. The
main Codex is both the black-box player and the post-run reviewer. The transport emits only
the same player-safe request used by the player adapter and accepts one JSONL
response; it never exposes the narration envelope, Director plan, world state,
clue graph, or Keeper secrets.

```bash
python3 ../../scripts/coc_live_match.py \
  --workspace <isolated-workspace> --campaign <campaign> \
  --investigator <investigator> --operator-long-play \
  --narrator-runner <repo-root>/runtime/adapters/narrator/run_narration.mjs \
  --run-dir <run-dir> --max-turns <turns>
```

For every `coc_operator_player_v2` `player_request` line, reply on stdin with:

```json
{"player_text":"...","intent_class":"investigate"}
```

`pending_choice_response` may be included when the public request contains a
typed pending choice. The KP still uses the production Director, rules, state,
evidence, and report path. In operator long-play only, GLM narration is captured
once, raw: there is no Sol fact-judge call and no correction rewrite. The normal
production/automated narrator path retains independent Sol verification.

Run until the module reaches structured terminal evidence (or a documented
human/operational blocker), rather than stopping after a convenient scene.
Long-play defaults to **continue and accumulate**, not stop-and-polish after
each finding. Record findings in `<run-dir>/operator-issue-ledger.jsonl` with
`coc_operator_review.py record-issue`. Stop and repair immediately only for:
crash/cannot continue; persistent-state integrity damage; rules integrity;
spoiler integrity; or evidence-completeness damage. A single prose/style flaw,
generic or awkward transition, or compound action split across turns remains a
`continue_and_accumulate` issue. The second occurrence of the same
`issue_class` escalates to `stop_and_fix`. At structured terminal evidence (or
after a representative long segment), review the accumulated ledger, grade the
issues, and batch related fixes. This policy is part of
`operator_codex_black_box_v2`; it does not change the protocol version.

Example first transition-quality finding:

```json
{
  "schema_version": 1,
  "protocol": "operator_codex_black_box_v2",
  "run_id": "<run-dir-name>",
  "issue_id": "transition-fallback-turn-002",
  "issue_class": "transition_quality",
  "occurrence": 1,
  "disposition": "continue_and_accumulate",
  "summary": "The transition used a generic template fallback.",
  "turn_refs": ["turn-002"],
  "evidence_refs": ["partial-transcript.jsonl#line-2"]
}
```

```bash
python3 ../../scripts/coc_operator_review.py record-issue \
  --run-dir <run-dir> --input <issue.json>
```

Review the raw player/KP transcript turn by turn while using deterministic
roll, event, clue, state, and report receipts as the authority for rules and
continuity. Do not configure or call a separate AI player or player-visible
judge: the same main Codex is both the black-box player and the post-run
reviewer, while the production KP remains the system under test. The only model
under test is the single-pass production KP narrator. Narrator failure may use the template fallback, but that
fallback must still show authored ordinary failure, pending-choice risk, and
localized options. Evidence must retain a sanitized failure class and stage so
provider, runner, and response-contract faults remain distinguishable.

Every new operator run starts with `operator_review_status: pending`,
`independent_model_verification: NOT_RUN`, and no fact-fidelity PASS. The
operator then reviews the transcript and structured logs across all four
required dimensions—`rules`, `facts`, `progression`, and `style`—and records
evidence with:

```bash
python3 ../../scripts/coc_operator_review.py record \
  --run-dir <run-dir> --input <review.json>
python3 ../../scripts/coc_operator_review.py verify --run-dir <run-dir>
```

The review input uses `protocol: operator_codex_black_box_v2`, binds the exact
`run_id`, identifies the reviewer as `{"kind":"codex","id":"main-codex"}`,
and provides a `pass|fail`
decision, non-empty notes, and source refs for every dimension. Any failure
produces `changes_required`; all four passes produce `approved`. This is
operator review evidence, not an automated model fact PASS. Pending and
changes-required runs remain formatter verification samples. An approved review
with intact operator/player, canonical-narrator, transcript, event-log, and
review hashes becomes `operator_reviewed_actual_play` and renders a real
`battle-report.md`. None of these states may be described as an official
`nightly` or `release` PASS; only the exact canonical suite can make that claim.

### Codex collaboration-subagent manual diagnostic

When the main Codex manually relays turns to a claimed separate Codex
collaboration-subagent player, use the distinct `codex_subagent_player_v1`
transport. Do not route those responses through `operator_codex_black_box_v2`,
which means that the same main Codex is both player and reviewer.

```bash
python3 ../../scripts/coc_live_match.py \
  --workspace <isolated-workspace> --campaign <campaign> \
  --investigator <investigator> --codex-subagent-player \
  --subagent-player-id <stable-collaboration-task-id> \
  --keeper-runner <repo-root>/runtime/adapters/keeper/run_keeper_turn.mjs \
  --max-turns <turns>
```

Spawn the player with no inherited conversation context and relay only the
emitted player-safe request. Reuse that same claimed actor id for every turn and
clean continuation. The stdin/manual relay persists every exact request envelope
and exact response in `subagent-player-exchanges.jsonl`; request and response
digests must be recomputable and agree with the invocation ledger. This proves
protocol binding only. Without a genuine Codex collaboration-service receipt it
does not attest who produced the response, so it is classified
`manual_protocol_blind_diagnostic` and is never gameplay-evidence eligible.
Four-dimension review may approve the diagnostic content, but must not upgrade
it to `codex_subagent_actual_play`.

Codex collaboration agents share the workspace. This protocol proves which
player-safe requests the orchestrator relayed; it does not prove filesystem
isolation or collaboration identity. Reports and receipts must state
`NOT_ATTESTED` rather than inventing a no-file-read or actor-attestation claim.

New-protocol continuation accepts only the exact current
`subagent_player_contract` and actor-bound invocation schema. An old or mismatched
save fails with `unsupported_save_schema` and the test restarts from a fresh
isolated workspace. There is no legacy migration or dual-format reader.

Coverage ledgers, completeness receipts, and audits remain post-run evidence.
They may disqualify a report or schedule another test lane, but must never block
Keeper narration, scene movement, earned clue delivery, or ending resolution.

When the **main Codex itself** is the Keeper host loading the canonical plugin
skills, do not describe `coc_live_match.py`'s keeper runner as that topology.
Use the manual post-turn recorder instead:

```bash
python3 ../../scripts/coc_codex_host_playtest.py init \
  --run-dir <new-empty-run-dir> --workspace <workspace> \
  --campaign <campaign> --investigator <investigator> \
  --player-actor-id <stable-actor-id> \
  --player-task-id <stable-collaboration-task-id> \
  --orchestrator-id <main-codex-id> \
  --toolbox-log <workspace>/.coc/campaigns/<campaign>/logs/toolbox-calls.jsonl

python3 ../../scripts/coc_codex_host_playtest.py append-turn \
  --run-dir <run-dir> --record-json <turn-record.json>

python3 ../../scripts/coc_codex_host_playtest.py finalize --run-dir <run-dir>
python3 ../../scripts/coc_codex_host_playtest.py verify --run-dir <run-dir>
```

The `append-turn` JSON is an exact schema-version-1 object containing
`player_request`, `subagent_response`, and `kp_narration`. Record only after the
main Codex has completed the turn. The recorder snapshots the new byte range of
`toolbox-calls.jsonl`, binds stable actor/task ids, and writes a hash-chained
`turns.jsonl`. `finalize` projects the source into `transcript.jsonl`,
`player-view.jsonl`, `keeper-view.jsonl`, `runner-invocations.jsonl`,
`player-requests.jsonl`, and `subagent-responses.jsonl` for a later report
exporter. It does not call or impersonate the existing report/evidence compiler.

These records are `orchestrator_attested` at a `manual` attestation level.
Shared-filesystem isolation remains `NOT_ATTESTED`; the hash chain is artifact
integrity, not cryptographic actor identity; and finalization never upgrades
the evidence grade automatically. Old or mismatched recorder directories are
rejected with a delete-and-restart instruction. There is no migration reader.
The recorder never evaluates narration, scenes, clues, or story eligibility and
must not be inserted as a runtime narrative gate.

For long-lived production-path white-box play (Masks Peru/America and similar), use
`../../scripts/coc_interactive_playtest.py` rather than the Haunting simulated-player
harness profiles below. The interactive driver speaks JSONL over stdin/stdout,
calls only `runtime.sdk.api.send`, checkpoints every accepted turn, and resumes from
validated checkpoints into a fresh workspace generation.

```bash
python3 ../../scripts/coc_interactive_playtest.py start \
  --workspace <workspace> --campaign <campaign> --investigator <investigator> \
  --run-dir <run-dir> --run-kind diagnostic_spoiler_run|blind_actual_play \
  --rng-seed <seed> --max-turns <1..500>
```

Keep The Haunting `coc_playtest_harness.py` profiles (`rulebook-smoke`,
`haunting-module`, chase/multi-profile drills) as the distinct simulated suite for
rulebook regression coverage. Do not treat those harness artifacts as Masks
interactive white-box battle-report evidence.

## Reports

Use `../../scripts/coc_playtest_harness.py` when you need a reproducible baseline run:

- `--profile rulebook-smoke`: short The Haunting-derived smoke run for the ordinary investigation loop.
- `--profile haunting-module`: module-level The Haunting run that reaches Mr. Knott, Arty Wilmot, Chapel clues, the Corbitt House, Bed Attack, basement hazards, The Floating Knife, Corbitt combat, final state, rewards, and player feedback.
- `--profile chase-drill`: rulebook chase drill that writes `save/chase.json` and shows speed roll, MOV, movement actions, location chain, DEX order, hazard resolution for every participant who crosses the hazard, barrier and hide/search roll links, conflict, and why the quarry escapes.
- `--profile multi-profile-pressure`: single-player opening pressure run with careful, reckless, and rules-skeptical play-style profiles for one virtual player. This proves style/rules pressure for one player; current completion-oriented playtests are single-player only.
- `--play-language <language>`: choose the visible play language for generated reports and persisted run/campaign metadata; defaults to `zh-Hans`.

Use `../../scripts/coc_playtest_report.py` to generate:

- `artifacts/battle-report.md`
- `artifacts/evaluation-report.md`

Use `../../scripts/coc_playtest_audit.py` after report generation to generate:

- `artifacts/rulebook-audit.md`

Use `../../scripts/coc_playtest_suite.py` after multiple serious runs to generate:

- `.coc/playtests/index.json`
- `.coc/playtests/loop-decision.json`
- `.coc/playtests/suite-report.md`

Use `../../scripts/coc_completion_audit.py` when `loop-decision.json` reports `ready_for_completion_audit` to generate:

- `.coc/playtests/completion-audit.json`
- `.coc/playtests/completion-audit.md`

Completion audit output should preserve `optional_evidence_runs` from `loop-decision.json` in both JSON and Markdown, so optional non-default language evidence remains visible without being treated as active repair scope.

`suite-report.md` should include `## Run Index`, `## Non-Passing Evaluated Runs`, `## Loop Decision`, and a `## Core Coverage Matrix` with `character_dossier`, `kp_player_transcript`, `mechanical_rolls`, `combat`, `chase`, `sanity`, `meta_game`, and `player_feedback`, so the evaluator can see whether the current evaluated run set covers the requested Keeper Rulebook workflows without hiding failed or missing audits. Run Index should preserve canonical `campaign_title`, `scenario`, `audit_profile`, `player_profile`, and `party_size` in `index.json` while rendering matching display fields in visible Markdown, so localized active runs do not expose confusing enum values such as `multi_profile_matrix`, untranslated module titles, or hidden party-size assumptions. Coverage and quality matrices must use `evaluated_runs`; historical baseline runs remain visible in `ignored_historical_runs` but must not satisfy current coverage or quality gates. Non-default duplicate language runs may remain visible as `optional_evidence_runs` and in `language_coverage`, but they must not drive coverage, quality, or repair blockers when the default `zh-Hans` completion-required run set already exists. Empty `Remaining Gaps` and `Remaining Quality Gaps` lines should say they were checked across evaluated playtest runs, while empty `Remaining Language Gaps` should say it was checked across the current language coverage scope, not all indexed runs. `coc_completion_audit.py` must emit `suite_matrix_references_non_evaluated_run` if a coverage or quality matrix entry lists any run id outside `loop_decision.evaluated_runs`.

`loop-decision.json` is the next-action gate for the continuous loop. It records `evaluated_runs`, `optional_evidence_runs`, `ignored_historical_runs`, `blockers`, status, `thread_goal_status`, and `thread_goal_next_action`. `needs_repair` means fix the first blocker and rerun the loop. `ready_for_completion_audit` means current active runs have no coverage or quality gaps and the artifact audit can run; it is not a thread-goal completion signal. `thread_goal_status` remains `active_not_complete` until the external Codex goal is separately proven complete, so run `coc_completion_audit.py`, inspect `completion-audit.md/json`, and keep the watchdog active unless the thread-level completion audit is truly satisfied.

## Semantic Matcher Constitution

Do not use a natural-language matcher based on literal headings, keyword hits, or fixed prose fragments to prove playtest coverage, module fidelity, rule intent, spoiler safety, player intent, or KP answer quality. If a judgment depends on what human-language text means, route it through an LLM semantic evaluator and record the evaluator id plus `coverage_reasons`.

Exact matching is allowed only for machine-controlled schema fields, enum values, JSON keys, file paths, and system markers such as `coverage_evaluator`, `coverage_reasons`, `run_id`, `audit_profile`, or `subsystems_covered`. Offline deterministic tests may inject a fixture evaluator. The default non-LLM path may use structured source data only; it must not claim semantic coverage from Markdown section titles or keyword snippets.

Rulebook audits should use deterministic checks only for structured evidence such as coverage enums, event types, roll payload fields, rule ids, chase state fields, and required source files. Do not require hardcoded natural-language report moment strings as proof of module fidelity, chase quality, or rule intent. Semantic quality is recorded in `semantic-eval-result.json`; source-to-report completeness is checked separately against structured source records.

Semantic coverage for source-gated subsystems must be supported by machine-readable run metadata. If an evaluator claims `combat`, `chase`, or `sanity` coverage but `playtest.json.subsystems_covered` does not declare the matching enum, the suite must reject that run as coverage for the subsystem and surface a coverage gap. A module note that a subsystem is not applicable is report context, not subsystem coverage.

## LLM Semantic Evaluation Artifacts

For semantic review, run `../../scripts/coc_playtest_suite.py --write-semantic-requests --root <repo-root>` to write `artifacts/semantic-eval-request.json` for each playtest run. The harness must not fabricate `semantic-eval-result.json`; Codex or another LLM semantic evaluator should read that exact request and write the result.

`semantic-eval-result.json` must include `schema_version`, `run_id`, `evaluator_id`, `evaluation_provenance`, `coverage`, `quality`, `root_cause_classification`, and `next_loop_fix_target`. `evaluation_provenance.kind` must be `llm`, and `evaluation_provenance.request_sha256` must match the canonical JSON hash of the request that was reviewed. The `coverage` object uses the same keys as the suite matrix and each value must include `covered` plus a semantic `reason`.

The request also includes `quality_dimensions`, and the result `quality` object must score `module_fidelity`, `rulebook_procedure`, `immersion_and_pacing`, `localized_visible_dialogue`, `actual_play_replay`, `state_continuity`, `spoiler_safety`, `player_agency`, `virtual_player_pressure`, and `report_completeness`. `localized_visible_dialogue` judges visible Keeper/player text against the selected `play_language` while machine keys, ids, markers, and enums stay English/ASCII-stable. Each dimension must include `score`, `passed`, and `reason`; the suite report surfaces evaluated-run quality in `## Quality Matrix` and records unresolved `quality_gaps`.

`rulebook_procedure` semantic review should explicitly judge pushed-roll risk ownership: the Keeper must frame and foreshadow the failure consequence, the player should confirm the risk, and the player should not author the consequence on the Keeper's behalf. This is a semantic LLM judgment, not a hardcoded visible-text keyword scan.

After result files exist, run `../../scripts/coc_playtest_suite.py --root <repo-root>`; the CLI default evaluator is `semantic-artifact`. The suite must use the result file's `evaluator_id` and reasons instead of fallback structured-source coverage. The suite index and `## Run Index` must expose each run's `play_language` and language profile so localized quality gates are auditable from the report. When completion-required active profiles (`haunting_module`, `chase_drill`, and `multi_profile_pressure`) are all present, the suite must also report `language_coverage` and block on `language_gaps` unless at least one active run proves default `zh-Hans` output. Non-default selected-language runs are optional evidence, not a completion blocker; when a default `zh-Hans` completion set exists, place duplicate non-default runs in `optional_evidence_runs` instead of `evaluated_runs`. If the result file is missing, the `semantic-artifact` evaluator should mark coverage missing rather than inventing a natural-language match. Use `--evaluator structured-source` only for explicit offline fixture or mechanical source smoke checks, not for completion-oriented quality gates.

Before generating reports, record the run context:

- `playtest.json`: run id, campaign id, scenario id, era, dice mode, spoiler policy, player profile, `play_language`, `localized_terms`, scores, pass/fail cases, recommendations.
- `sandbox/.coc/campaigns/<campaign-id>/campaign.json`: campaign title and runtime settings.
- `sandbox/.coc/campaigns/<campaign-id>/party.json`: investigator ids used in the playtest. Current completion-oriented playtests must use exactly one active investigator; if `party.json` lists more than one merged active/reusable investigator id, completion audit should emit `active_run_party_not_single_player`. The current completion scope is single-player only.
- `sandbox/.coc/campaigns/<campaign-id>/scenario/scenario.json`: module title, scenario id, source PDF, opening scene.
- `sandbox/.coc/campaigns/<campaign-id>/scenario/handouts.json`: structured player-visible handout labels, titles, required summaries, provided player-facing content, and optional routes. Reports render these through `localized_text[play_language]` and `localized_terms[play_language]`; stable handout ids stay in JSON. A handout row without a player-visible summary is incomplete and should emit `source_handout_summary_missing`; a battle report that omits provided handout content should emit `battle_report_handouts_missing`.
- `sandbox/.coc/investigators/<investigator-id>/creation.json`: rulebook Chapter 3 investigator creation record, including generated characteristics, occupation, occupation skill points, personal interest skill points, `skill_allocation`, credit rating, rulebook Table II finances, backstory, and starting equipment. Finances should be structured numeric JSON derived from Credit Rating and period, including living standard, cash, assets, and spending level.
- `sandbox/.coc/investigators/<investigator-id>/character.json`: characteristics, derived values, skills, occupation, and reusable investigator id.
- `sandbox/.coc/investigators/<investigator-id>/history.jsonl`: sandbox-only scenario experience, final state, notable events, and unresolved threads that could carry into a later story.
- `sandbox/.coc/investigators/<investigator-id>/development.jsonl`: sandbox-only investigator development phase summary, skill checks earned, rewards, permanent-change candidates, and carryover notes.
- `sandbox/.coc/investigators/<investigator-id>/inventory-history.jsonl`: sandbox-only item, cash, handout, weapon, evidence, and optional carryover records that explain what the reusable investigator might bring or settle before a later story.
- `sandbox/.coc/indexes/investigators.json`: workspace reusable-investigator entry points only. It must not store campaign state such as current HP, current SAN, active scene, conditions, or current skill checks; those values belong under campaign `save/` plus investigator history/development records.
- `transcript.jsonl`: every virtual player, KP, system, and meta turn with role, text, mode, and player intent when available. In serious active runs, visible KP and virtual-player dialogue should follow `play_language`, defaulting to `zh-Hans`; for `zh-Hans`, names, setting terms, and player-visible skill display names should use `localized_terms` such as Chinese transliterations or conventional translated names, while machine-facing markers, JSON keys, filenames, canonical skill keys, rule enum values, and hidden Mechanical Log audit anchors remain stable. Source transcript rows may preserve canonical `speaker`, `text`, `intent`, `ruling`, and `player_profile` fields for tooling, but should add player-language display companions such as `speaker_display`, `text_display`, `intent_display`, `ruling_display`, and `player_profile_display` when the row can be used as evaluator or replay evidence. Source `localized_text[play_language]` values should also be rendered through `localized_terms[play_language]` before storage so semantic evaluators do not read half-localized source transcript text.
- `player-view.jsonl`: the player-safe view stream, including public character state and visible transcript turns only. For active localized runs, player-view `text`, `localized_text[play_language]`, and transcript `speaker` values are player-visible and must render through `play_language`, including system roll summaries, success-level labels, difficulty labels, actor display names, profile speaker labels, and skill display names. Player-visible fields must not expose protocol wrappers such as `[meta]` or `[spoiler_warning]`; source transcript rows may preserve those wrappers for tooling, but player-view consumers should see only the display body. If a transcript row keeps canonical `intent` or `ruling` enum values, also write `intent_display` or `ruling_display` from `localized_text[play_language]` plus `localized_terms[play_language]` so player-view consumers do not display the canonical enum. If a transcript row keeps a canonical `player_profile` enum, also write `player_profile_display` from `player_profile_labels[play_language]`. The `public_character_state` entry is also player-visible: render scenario display fields, investigator names, occupations, backstory values, and player-readable campaign-save `current_state` text through `localized_terms[play_language]` or language-profile labels. Keep `skills` and `derived` JSON keys canonical/ASCII; expose localized player labels through `skill_display[]` and `derived_display[]` entries with stable `key`, localized `label`, and `value`. Reusable `character.json` remains the base sheet; `public_character_state.current_state` is the player-safe campaign overlay and must match `save/investigator-state/<investigator-id>.json` for current HP, SAN, MP, conditions, and last status summary while preserving machine enum values such as `condition`. Preserve canonical rule enum values in structured payload fields, stored logs, reusable investigator/campaign source files, and hidden Mechanical Log audit anchors; visible Mechanical Log roll summaries in localized runs should render through `play_language`.
- `keeper-view.jsonl`: the Keeper-only view stream, including Keeper context and `keeper_secret_ids` from `keeper-secrets.json`.
- Pushed-roll transcript turns should include `pushed_roll_protocol` stages in this order: `player_reframes_action`, `keeper_foreshadows_failure`, `player_confirms_risk`, `roll_resolved`. This proves that the player changed the fictional approach, the Keeper owned and foreshadowed the failure consequence, the player confirmed the risk, and only then did the system resolve the pushed roll.
- Completion-oriented suites should include at least one warning-gated Keeper-only reveal. The transcript should record `spoiler_protocol` stages in this order: `warning_issued`, `player_confirmed`, `limited_reveal`, with stable `spoiler_id`, `scope`, and Keeper-only `keeper_secret_id`; player-view must not expose internal secret ids. The campaign must also write a matching `sandbox/.coc/campaigns/<campaign-id>/logs/audit.jsonl` row with `type: spoiler_reveal`, `confirmed: true`, `spoiler_id`, `keeper_secret_id`, and `scope`.
- `sandbox/.coc/campaigns/<campaign-id>/logs/rolls.jsonl`: rolls and mechanical outcomes.
- `skill_check_earned: true` may only be set for successful investigator skill rolls that can receive rulebook development checks. Do not set it on characteristic rolls such as DEX/INT/POW/CON, Sanity, Luck, damage rolls, or never-check skills such as Credit Rating and Cthulhu Mythos.
- Pushed roll payloads in `rolls.jsonl` should include the matching `pushed_roll_protocol.roll_id`, `failure_consequence_source: keeper`, `keeper_foreshadowed_failure: true`, and `player_confirmation_recorded: true`.
- The Haunting HP damage that changes investigator HP should be recorded as structured `damage` rolls with `damage_kind: hit_points`, stable `roll_id`, `source`, `die`, `die_rolls`, `flat_modifier`, `roll`, `hp_before`, `hp_delta`, and `hp_after`. Bed Attack uses `source: bed_attack` and `die: 1D6+2`; the pushed basement search failure uses `source: basement_pushed_search_failure` and `die: 1D4+2`.
- Player-visible damage and reward rolls should render as `die = total` with die-face/modifier breakdown, not as percentile-style `roll / target`; otherwise emit `non_percentile_roll_rendering_invalid`.
- Chase hazard roll payloads in `rolls.jsonl` should include stable `roll_id` and `chase_hazard_id`, and every `save/chase.json.rounds[].turns[]` entry that crosses a `location_chain[]` entry with `label: hazard` should include the matching `hazard_id` and `hazard_roll_id`.
- Chase barrier and hide/search roll payloads in `rolls.jsonl` should include stable `roll_id` plus `chase_barrier_id` or `chase_hide_attempt_id`, and every `save/chase.json.rounds[].turns[]` entry that crosses a `location_chain[]` entry with `label: barrier` or resolves escape by hiding should include matching `barrier_id`, `barrier_roll_id`, `hide_attempt_id`, `hide_roll_id`, `hide_search_actor_id`, and `hide_search_roll_id` fields.
- `sandbox/.coc/campaigns/<campaign-id>/logs/events.jsonl`: scenes, clues, state changes, combat, chase, sanity, `resource_change`, and other durable events. Chase drills whose outcome depends on a carried objective must record an `item_transfer` event with stable `item_id`, `from_actor`, `to_actor`, `source_turn`, and `chase_id`, plus a player-visible localized summary, so the report can prove how the chase prize changed hands before escape or capture. The Haunting module runs must record Corbitt Magic points with `resource_change` events for `reason: flesh_ward`, `reason: floating_knife_attack`, and `reason: animate_body`, stable before/cost/delta/after/source_turn fields, Flesh Ward armor roll fields, and player-visible localized summaries; otherwise emit `haunting_corbitt_magic_points_missing`. The Haunting HP damage events must link to the matching structured damage roll by `damage_roll_id` and repeat `hp_before`, `hp_delta`, and `hp_after`; otherwise emit `haunting_damage_roll_missing`. SAN loss rolls must record `san_before`, `san_delta`, and `san_after`, and visible roll detail should render the SAN change; otherwise emit `sanity_resource_delta_missing`. Every failed SAN roll must also carry an `involuntary_action` block with `kind` (one of `jump_in_fright`, `cry_out`, `involuntary_movement`, `involuntary_combat_action`, `freeze`), a `summary`, and `rule_ref: core.sanity.failure_involuntary_action`; the matching `type: sanity` event should carry the same block. Per Keeper Rulebook p.166, failing a SAN roll always causes the investigator to lose self-control for a moment, distinct from any later bout of madness; otherwise emit `sanity_failure_involuntary_action_missing`. Every combat scene must persist structured Chapter 6 state to `save/combat.json` via `coc_combat.CombatSession` (participants with DEX/combat_skill/dodge_skill/firearms_skill/has_ready_firearm/build/HP/armor/weapons/conditions/active_effects; rounds[].initiative_order with per-turn dex_reason for ready_firearm +50 and casting overrides; rounds[].turns[] with declared_intent/action/target_actor_id/roll_id/opposed_roll_id/opposed_outcome/defense_kind/outcome/attack_modifiers/damage_roll_id; damage_chain[] balancing hp_before+hp_delta==hp_after and armor_absorbed+(-hp_delta)==raw_damage). Audit verifies DEX order, opposed pairing, damage chain, no pushed combat rolls, and outcome consistency from state alone; otherwise emit `combat_dex_order_not_proven`, `combat_opposed_pairing_missing`, `combat_damage_chain_broken`, `combat_pushed_roll_present`, or `combat_outcome_unresolved`. The eight Chapter 6 mechanisms must be respected: firearms cannot be fought back or dodged (only Dive for Cover), Dive for Cover grants the attacker a penalty die and the diver forfeits their next attack, Cover/Concealment grants a penalty die, Outnumbered targets grant subsequent attackers a bonus die, Point-Blank range grants a bonus die, readied firearms shoot at DEX+50 in initiative, range sets firearms difficulty (base/long/very-long → regular/hard/extreme), and fleeing marks the participant fled and removes them from subsequent initiative. The final Corbitt resolution must also record a combat event with `rulebook_exception: own_dagger_ignores_spells`, `flesh_ward_bypassed: true`, pre-hit armor state, and a localized summary explaining that Corbitt's own dagger destroys him regardless of Flesh Ward or other spells; otherwise emit `haunting_corbitt_own_dagger_exception_missing`. The Haunting conclusion reward must also be proven by a structured `reward` roll in `rolls.jsonl` with `reward_kind: sanity`, `source: conclusion_rewards`, `die: 1D6`, `die_rolls`, stable `roll_id`, `san_before`, `san_delta`, and `san_after` matching the final SAN status; otherwise emit `haunting_conclusion_reward_roll_missing`.
- If a roll payload sets `temporary_insanity_triggered: true`, `events.jsonl` must include a `bout_of_madness` event with the `疯狂发作` behavior, `mode`, Keeper control boundary, `control_returned: true`, and recovery note. Use `mode: real_time` for round-by-round bouts and record 1D10-round duration, actual `duration_roll`/`duration_rounds`, and one keeper-controlled `rounds[]` entry for each bout round. Use `mode: summary` for summarized bouts and record `summary_table: table_viii_summary`, `summary_roll`, `summary_result`, `duration_die: 1D10`, `duration_roll`, and `duration_hours` instead of `duration_rounds`/`rounds`; in The Haunting's Corbitt temporary-insanity scene, a lone investigator must use this summary mode rather than the real-time round sequence.
- If temporary insanity was triggered, the final status event must either set `temporary_insanity_resolved: true` with recovery evidence or include an `unresolved_conditions[]` entry with `condition: temporary_insanity_underlying`, `duration_hours`, `remaining_hours`, `summary`, and `player_visible_summary`; the `player_visible_summary` must appear in the player-visible KP transcript before session end.
- `sandbox/.coc/campaigns/<campaign-id>/memory/session-summaries.jsonl`: player-safe story recap and campaign memory.
- `player-feedback.jsonl`: virtual player ratings and comments about the KP experience. Rows with a canonical `player_profile` enum should also include `player_profile_display` from `player_profile_labels[play_language]` for player-visible feedback sections.
- `evaluator-notes.jsonl`: full evaluator findings, including spoiler, state, pacing, and rules issues.
- Serious completion-oriented suites should include at least one single-player style-pressure run, or equivalent semantic evidence, so the evaluator can see how the Keeper handles careful planning, reckless risk-taking, and meta/rules challenges for one player rather than only one scripted style. The current completion scope is single-player only; do not introduce extra-player requirements or blockers. Source `transcript.jsonl` evidence for that run should include each required `player_profile` enum with visible text plus at least one structured `intent` and localized `intent_display` row per required profile, so completion audit can prove the pressure shape without hardcoded natural-language matching.
- `coc_playtest_suite.py` must render `## Evaluator Note Blockers` in `suite-report.md`; active medium-or-higher or failing-severity evaluator notes become `evaluator_note_blocker` loop blockers even when the semantic coverage and quality matrices pass. `coc_completion_audit.py` must also reread active `evaluator-notes.jsonl` files and emit `active_evaluator_note_blocker` if stale suite artifacts hide a blocking note.
- `coc_completion_audit.py` must treat watchdog monitor liveness as structured automation status, not monitor prompt text. An automation file with `status = "ACTIVE"` is active even if its prompt is reworded or localized; do not exact-match a natural-language prompt phrase as a completion gate.

`battle-report.md` is an actual-play replay, not just a mechanics checklist. It should include:

- `## Run Setup`
- `## Module`
- `## Handouts`
- `## Investigator Creation`
- `## Character Dossier`
- `## Investigator Chronicle`
- `## Scene-by-Scene Replay`
- `## Actual Play Replay`
- `## Session Transcript`
- `## Tool Reliability` (diagnostic only)
- `## Rules & Rolls Recap` (aggregate only)
- `## Mechanical Log`
- `### Important Rolls` (high-signal subset only)
- one canonical `## Rules & Dice` ledger in the compiled report
- `## Chase Tracker`
- `## Story Recap`
- `## Player Feedback On KP`

`## Scene-by-Scene Replay` should render each significant structured play event from `events.jsonl` before the transcript appendix: scene, clue, damage, sanity, `疯狂发作` (`bout_of_madness`), combat, chase, `item_transfer`, `resource_change`, status, and session-ending events. Status events include final HP, final SAN, rewards, chase outcome, and other durable end-state summaries. This section is a table-readable episode map for the actual play report, not just a list of opening locations.

`## Actual Play Replay` must render non-system source `transcript.jsonl` turns with visible speaker attribution and preserve source turn order. `## Session Transcript` is a compact source receipt (record count, role counts, and transcript hash) that points back to that single full rendering instead of duplicating the whole conversation. Source-dialogue findings inspect the complete Actual Play Replay; the receipt itself is not a second dialogue copy and is not required to repeat speaker lines.

Tool reliability and narrative-enrichment coverage are diagnostic-only report
signals. Record toolbox call counts, bounded retries, recovered transient
failures, and nonretryable failure classes when available. Likewise record
whether `director.advise` or `storylets.suggest` was observed, but zero calls
is not a failed run and must not become a narrative gate: a scene may already
have enough momentum, or no suggested beat may fit. After a nonretryable tool
failure, prefer a corrected structured payload or another fictionally valid
route and preserve the failure as diagnostic evidence rather than requiring
the same call to succeed.

The actual-play recording boundary remains synchronous for authoritative
dice, resource/state mutations, clue and NPC receipts, journals, structured
session endings, and development settlement. Do not start the next play turn
on the assumption that one of those writes will eventually appear. Only
append-only audit copies or mirror flushing may be deferred. A transient
failure may be retried with the same `decision_id` under the bounded retry
policy; exhausting that retry budget calls for an explicit alternative or a
recorded limitation, not a new blocking narrative state machine.

`## Investigator Creation` should render sandbox `creation.json` before `## Character Dossier`, proving that the playtest followed the rulebook Chapter 3 creation workflow before play began and did not only invent a finished character sheet. The section must include structured age evidence: chosen age, age modifier bracket, EDU improvement check count and rolls, characteristic reductions, APP reduction, and MOV penalty; otherwise emit `investigator_age_step_missing`. Character source `derived.MOV` and creation `derived.MOV.value` must match the rulebook Movement Rate table from STR, DEX, SIZ, and age MOV penalty; otherwise emit `derived_movement_rate_mismatch`. It must also include full, half, and fifth characteristic values from `creation.json` and reusable `character.json`; otherwise emit `characteristic_half_fifth_missing`. The section must also include `skill_allocation` evidence: occupation points spent, personal-interest points spent, unallocated totals, base values, final skill values, and skill half/fifth values. It must render rulebook Table II finance evidence derived from Credit Rating and period: living standard, cash, assets, and spending level. Requirement: skill_allocation final values must match character.json skills so the creation workflow, character dossier, and roll targets describe one investigator. Reusable `character.json` must persist `skill_thresholds` for skill full/half/fifth values, and visible Investigator Creation plus Character Dossier must render them; otherwise emit `skill_half_fifth_missing`.

`## Investigator Chronicle` should render sandbox `history.jsonl` and `development.jsonl`, proving that the playtest can describe what would carry into a later story without writing sandbox changes into the real investigator library.

`## Handouts` should render every player-visible handout label, title, summary, and route from `scenario/handouts.json` before investigator creation, using the active play language. This section is the table handout register; `## Clues Found` can describe which clues were discovered in play, but it does not replace the source handout register. Source handouts must include player-visible summaries so this section is more than a title index. Otherwise emit `source_handout_summary_missing` or `battle_report_handouts_missing`.

Active localized runs must render visible report headings and fields through `language_profile.report_heading_labels` and `language_profile.report_field_labels`, while preserving canonical tooling anchors in ASCII HTML comments such as `<!-- report-anchor: Run Setup -->` and `<!-- field-anchor: Campaign -->`; do not render bilingual visible headings like `# Battle Report / 跑团战报`. Run Setup display values such as audit profile, simulation method, dice mode, spoiler policy, play language, language profile, localized-term summary, and player profile must render through `language_profile.report_value_labels` or language report templates while preserving canonical values in JSON. The localized-term summary should be a short localized count; built-in table vocabulary may be merged with and overridden by `playtest.json.localized_terms`. The battle report must not render the full glossary as a visible Localization Appendix because that is source metadata, not actual-play transcript. Campaign, Scenario, and Source display values must render through `localized_terms[play_language]` while preserving canonical values and file paths in JSON. Actual Play Replay turn/detail display labels must render through `language_profile.transcript_labels`, speaker labels through `language_profile.speaker_labels`, and mode display values through `language_profile.transcript_mode_labels`; Session Transcript renders a localized receipt instead of repeating those turns. Transcript intent/ruling display values must render through `localized_text[play_language]` while preserving canonical values in JSON. Source rows in `player-view.jsonl` and `player-feedback.jsonl` that include canonical `player_profile` must also include `player_profile_display`; otherwise emit `player_profile_display_not_localized`. Investigator Chronicle labels and player-visible status values must render through `language_profile.chronicle_labels`. Player Feedback On KP metric labels must render through `language_profile.feedback_labels`. Player Feedback On KP entries must render direct virtual-player feedback voice through `language_profile.report_labels.feedback_voice_default`, `feedback_voice_profile`, and `feedback_line` rather than only a scorecard row; otherwise emit `player_feedback_voice_missing`. Active localized Character Dossier sections must render occupation, era, characteristics, derived values, skills, backstory, and backstory subfields through `language_profile.character_dossier_labels`. Derived value labels such as `damage_bonus` and `build` must render through `language_profile.character_dossier_labels` rather than leaking JSON keys. Player-readable Character Dossier values, such as occupation names, must also apply `localized_terms[play_language]`. Player-visible skill display names in Character Dossier, Investigator Chronicle, Actual Play Replay, Rules & Rolls Recap, Mechanical Log, and Chase Tracker must apply `localized_terms[play_language]` while preserving canonical skill keys in JSON and hidden audit anchors; otherwise emit `report_skill_names_not_localized`. Player-readable report sections, including Scene-by-Scene Replay and Combat/Chase/Sanity summaries, must render localized actor display names and avoid internal actor ids. Player-readable Scene-by-Scene Replay and Clues Found entries must render scene/clue summaries without `scene_id` or `clue_id` prefixes. Scene-by-Scene Replay entries must not use raw event type enum prefixes such as `damage:` or `session ending:`. Scene-by-Scene Replay entries must not use actor-dash log prefixes such as `艾达·金 - ...`; otherwise emit `report_actor_dash_prefix`. Combat/Chase/Sanity summary entries must not use actor-colon log prefixes such as `KP:` or `艾达·金:`; otherwise emit `report_actor_colon_prefix`. If a summary sentence already begins with the localized actor name, avoid repeating it as a separate prefix. Active localized runs must render empty combat/chase/sanity/chase-tracker states through `language_profile.empty_report_lines`. Single-player style-pressure reports must persist `player_profile_labels` for the selected language and render those labels instead of profile ids in actual-play, transcript, and feedback sections. Chase Tracker labels, roles, status/difficulty values, locations, round summaries, and outcome text must render through `language_profile.chase_tracker_labels`, `localized_terms`, or `localized_text`; canonical ids and state-file paths must remain in stored JSON or hidden ASCII HTML audit anchors, not visible parenthetical text. Visible Character Dossier, Investigator Creation, Investigator Chronicle, and Chase Tracker lines should show localized names and locations only. Hidden comments may carry canonical ids and file paths for audit.

Player Feedback On KP must render each source feedback row as a bound visible line containing that row's localized category, numeric score, player/profile voice, and comment. Completion audit emits `battle_report_feedback_binding_missing` when the report has the comment and score somewhere but scrambles the category or profile binding.

`## Chase Tracker` should render `save/chase.json` whenever chase state exists: participants with MOV/DEX/action economy, DEX order, location chain with hazards and barriers, per-round summaries, and final outcome. This is the report proof that the chase subsystem recorded the rulebook procedure instead of only narrating that someone escaped. Final chase narration, transcript, and report text must not place a participant at a different location than `save/chase.json.participants[].position`; the completion audit emits `chase_transcript_position_conflict` when localized outcome text contradicts the saved participant position.

Rules & Rolls Recap boolean display values such as pushed-roll and skill-check-earned flags must render through `language_profile.report_labels`; otherwise emit `report_boolean_values_not_localized`.

Completion audit treats HTML comments as non-visible. Every source roll from `logs/rolls.jsonl` must have visible evidence once in the canonical `Rules & Dice` section (legacy reports may satisfy this through `Mechanical Log`). `Rules & Rolls Recap` is aggregate, while `Important Rolls` may select only high-signal results; neither should duplicate the full per-roll ledger.

Story Recap entries must render memory summaries without `session_id` or memory id prefixes; otherwise emit `report_memory_ids_not_localized`.

Flag spoiler leaks, state errors, unlogged rolls, poor pacing, incorrect rules, `source_handout_summary_missing`, `battle_report_handouts_missing`, `battle_report_source_dialogue_missing`, `battle_report_source_dialogue_speaker_missing`, `battle_report_source_dialogue_order_mismatch`, `investigator_creation_missing`, `investigator_skill_allocation_missing`, `investigator_skill_allocation_mismatch`, `derived_movement_rate_mismatch`, `view_separation_missing`, `player_view_secret_leak`, `player_view_protocol_wrapper_leak`, `player_view_localized_text_not_localized`, `player_view_transcript_details_not_localized`, `player_profile_display_not_localized`, `investigator_chronicle_missing`, `investigator_inventory_history_missing`, `investigator_chronicle_not_rendered`, `investigator_chronicle_labels_not_localized`, `temporary_insanity_bout_missing`, `temporary_insanity_bout_mode_mismatch`, `temporary_insanity_bout_duration_missing`, `temporary_insanity_bout_rounds_missing`, `temporary_insanity_bout_not_rendered`, `status_event_not_rendered`, `transcript_turn_sequence_gap`, `haunting_npc_dialogue_missing`, `sanity_resource_delta_missing`, `sanity_failure_involuntary_action_missing`, `haunting_corbitt_magic_points_missing`, `haunting_corbitt_own_dagger_exception_missing`, `haunting_conclusion_reward_roll_missing`, `non_percentile_roll_rendering_invalid`, `chase_player_profile_pressure_missing`, `chase_decisions_too_thin`, `chase_object_transfer_missing`, `chase_tracker_not_rendered`, `chase_tracker_labels_not_localized`, `combat_dex_order_not_proven`, `combat_opposed_pairing_missing`, `combat_damage_chain_broken`, `combat_pushed_roll_present`, `combat_outcome_unresolved`, `combat_tracker_not_rendered`, `report_shell_not_localized`, `run_setup_values_not_localized`, `module_metadata_values_not_localized`, `transcript_labels_not_localized`, `transcript_detail_values_not_localized`, `report_boolean_values_not_localized`, `player_feedback_labels_not_localized`, `player_feedback_voice_missing`, `character_dossier_labels_not_localized`, `character_dossier_derived_labels_not_localized`, `character_dossier_terms_not_localized`, `report_skill_names_not_localized`, `report_actor_ids_not_localized`, `report_state_ids_not_localized`, `report_memory_ids_not_localized`, `report_event_type_labels_not_localized`, `report_actor_label_repeated`, `report_actor_dash_prefix`, `report_actor_colon_prefix`, `localized_empty_placeholders_not_rendered`, and `player_profile_labels_not_localized`.

Also flag `battle_report_feedback_binding_missing` when Player Feedback On KP does not bind category, score, profile voice, and comment from the same `player-feedback.jsonl` row.

## Rulebook Audit Loop

Every serious playtest follows this loop:

1. Generate `battle-report.md` and `evaluation-report.md`.
2. Run `coc_playtest_audit.py <run-dir>` and read `rulebook-audit.md`.
   - Passing audits should include `## Positive Rulebook Evidence` with structured counts for transcript turns, roll protocol, pushed rolls, view streams, sanity/`疯狂发作`, subsystems, and profile-specific module or chase evidence.
3. If the audit fails, classify the first blocker before changing files:
   - `test_gap`: the simulated test did not actually exercise enough COC play.
   - `system_gap`: the Keeper system did not record or execute a rulebook-required behavior.
   - `report_gap`: the data exists, but the battle report did not show it.
   - `design_gap`: the blueprint does not require the behavior yet.
4. Read `## Blueprint Cross-Check` to decide whether the problem is missing design or designed-but-not-implemented behavior.
5. Apply the smallest targeted fix named in `## Next Loop Fix Target`.
6. Rerun the playtest reports and rulebook audit.

The baseline audit should reject reports that omit a pushed roll, status event, session ending, mechanical detail such as goals and difficulty rationale, leave gaps in transcript turn bases, or leak raw payload dictionaries into player-readable prose. Turn suffixes such as `48a` are allowed for inserted subturns, but numeric bases should remain contiguous; otherwise emit `transcript_turn_sequence_gap`. Active serious runs should also reject missing `player-view.jsonl` / `keeper-view.jsonl` with `view_separation_missing`, reject any `keeper-secrets.json` id in `player-view.jsonl` with `player_view_secret_leak`, and reject player-visible protocol wrappers in `player-view.jsonl` with `player_view_protocol_wrapper_leak`.

For active localized runs, the audit must also reject visible KP/player dialogue or player-readable report sections that leak canonical glossary terms or player-visible skill display names from `localized_terms[play_language]`; use `report_skill_names_not_localized` when Character Dossier, Investigator Chronicle, Actual Play Replay, Session Transcript, Rules & Rolls Recap, or Chase Tracker leak canonical skill names. This exact check is allowed because it uses machine-controlled glossary entries and structured skill keys, not natural-language semantic matching.

When `playtest.json` sets `audit_profile: haunting_module`, the audit must also reject runs that:

- do not cover the required The Haunting beats in `module_coverage`
- omit social, pushed-roll, sanity, damage, or combat subsystem coverage
- omit structured Keeper-controlled NPC roleplay turns for core social/investigation scenes, including Mr. Knott, Arty Wilmot, Gabriela Macario, and 马卡里奥一家, rendered with localized `KP[NPC]` labels; otherwise emit `haunting_npc_dialogue_missing`
- omit sandbox investigator creation records with rulebook Chapter 3 steps, generated characteristics, skill-point formulas, `skill_allocation`, credit rating, rulebook Table II finances, backstory, and starting equipment; otherwise emit `investigator_creation_missing` or `investigator_skill_allocation_missing`
- let `skill_allocation` final values drift from `character.json` skills; otherwise emit `investigator_skill_allocation_mismatch`
- omit sandbox inventory-history records for carryover keys, handouts, weapons, cash, evidence, and optional items; otherwise emit `investigator_inventory_history_missing`
- trigger temporary insanity without a `bout_of_madness` event, actual `duration_roll`, and visible `疯狂发作` report entry
- have too few player decisions or too thin a KP/player transcript
- fail to record Corbitt combat resolution
- omit structured HP damage rolls and matching damage-event links for Bed Attack and pushed basement-search failure; otherwise emit `haunting_damage_roll_missing`
- render damage or reward dice as percentile-style `roll / target` instead of `die = total` with die-face/modifier breakdown; otherwise emit `non_percentile_roll_rendering_invalid`
- omit `san_before`, `san_delta`, and `san_after` from SAN loss rolls or fail to render visible SAN change details; otherwise emit `sanity_resource_delta_missing`
- omit the `involuntary_action` block (`kind` + `summary` + `rule_ref: core.sanity.failure_involuntary_action`) from a failed SAN roll; per Keeper Rulebook p.166 a failed SAN roll always causes momentary loss of self-control; otherwise emit `sanity_failure_involuntary_action_missing`
- omit structured Chapter 3 age choice, age modifier bracket, EDU improvement checks, characteristic reductions, APP reduction, or MOV penalty from investigator creation; otherwise emit `investigator_age_step_missing`
- record derived MOV values that do not match STR/DEX/SIZ plus the age MOV penalty; otherwise emit `derived_movement_rate_mismatch`
- omit full, half, and fifth characteristic values from investigator creation, reusable investigator source, or visible report sections; otherwise emit `characteristic_half_fifth_missing`
- omit full, half, and fifth skill values from investigator creation, reusable investigator source, or visible report sections; otherwise emit `skill_half_fifth_missing`
- omit Corbitt Magic points spending for Flesh Ward, The Floating Knife, and Corbitt's body movement through structured `resource_change` events; otherwise emit `haunting_corbitt_magic_points_missing`
- omit the `own_dagger_ignores_spells` combat exception explaining why Corbitt's own dagger bypasses Flesh Ward and other spells; otherwise emit `haunting_corbitt_own_dagger_exception_missing`
- omit a structured `reward` roll proving The Haunting conclusion `1D6` SAN reward with `reward_kind: sanity`, `source: conclusion_rewards`, `die: 1D6`, `die_rolls`, `roll_id`, `san_before`, `san_delta`, and `san_after` matching final SAN; otherwise emit `haunting_conclusion_reward_roll_missing`
- omit final HP, final SAN, rewards, or unresolved state
- omit Chinese visible KP/player dialogue, leak unlocalized glossary terms or skill display names, or omit the `## Actual Play Replay` section
- render a thin `## Scene-by-Scene Replay` that omits significant structured play events
- leave Chase Summary empty instead of explaining that The Haunting has no required chase sequence

When `playtest.json` sets `audit_profile: chase_drill`, the audit must also reject runs that:

- do not declare `chase` in `subsystems_covered`
- omit `save/chase.json` or leave out participants, location chain, rounds, or outcome
- fail to prove chase-round action order from participant `dex`, `dex_order`, and `rounds[].turns[].actor_id`; otherwise emit `chase_dex_order_not_proven`
- fail to prove every hazard crossing with `rounds[].turns[].hazard_id`, `hazard_roll_id`, and matching `logs/rolls.jsonl` payload `roll_id`/`chase_hazard_id`; otherwise emit `chase_hazard_resolution_missing`
- fail to prove barrier crossing and hide/search escape links with `rounds[].turns[].barrier_id`, `barrier_roll_id`, `hide_attempt_id`, `hide_roll_id`, `hide_search_actor_id`, `hide_search_roll_id`, and matching `logs/rolls.jsonl` payload `roll_id`/`chase_barrier_id`/`chase_hide_attempt_id`; otherwise emit `chase_barrier_hide_resolution_missing`
- omit single-player multi-style chase pressure from reckless, skeptical-rules, and genre-savvy profiles, including meta questions about movement actions, pushed-roll boundaries, and spoiler-safe answers; otherwise emit `chase_player_profile_pressure_missing`
- omit typed major-player decision events with stable `decision_kind` values for pushed confirmation, objective possession, hazard choice, and barrier/hide choice; otherwise emit `chase_decisions_too_thin`
- fail to show speed roll, MOV, movement actions, hazard, barrier, conflict, and quarry escapes in Chase Summary
- fail to render a populated `## Chase Tracker` from `save/chase.json`
- claim a chase happened without recording the state and rolls that explain how it resolved
- let the quarry escape with a carried objective without an `item_transfer` event proving `item_id`, `from_actor`, `to_actor`, `source_turn`, and matching `chase_id`; otherwise emit `chase_object_transfer_missing`
- omit Chinese visible KP/player dialogue, leak unlocalized glossary terms or skill display names, or omit the `## Actual Play Replay` section
- render a thin `## Scene-by-Scene Replay` that omits significant structured play events

## Epistemic Experience Metrics

`coc_playtest_report.py` reads structured belief events/state plus compile and
parse provenance, persists `playtest.json.epistemic_metrics`, and renders the
`Epistemic Experience` section defined in
`references/battle-report-template.md`.

The report includes `belief_gain`, `curiosity_load`,
`explanation_compression`, `reframe_fairness`, `confirmation_saturation`,
`unexplained_surprise`, `parse_risk_exposure`, and the aggregate
`epistemic_health`. These are deterministic diagnostics, not prose judgments.
`parse_risk_exposure` is scoped to cognitive nodes and parse ranges actually
delivered to the player. Legacy runs without belief events remain valid and
produce zero-event metrics.
