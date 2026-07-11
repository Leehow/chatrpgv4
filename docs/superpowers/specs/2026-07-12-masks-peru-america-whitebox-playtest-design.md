# Masks Peru + America White-Box Playtest Design

**Date:** 2026-07-12  
**Status:** Approved for planning  
**Branch:** `codex/masks-whitebox-playtest`

## Objective

Run two genuine, evidence-bearing Call of Cthulhu playtests through the
complete Peru prologue and America/New York chapter of *Masks of Nyarlathotep*,
then probe chapter handoffs to England and Egypt. The first run uses a
spoiler-aware diagnostic player to exercise the white-box system deliberately.
The second uses a fresh, no-context, spoiler-blind player to measure what an
ordinary player can discover and where that player gets stuck. Together the
runs evaluate the Keeper system from three perspectives:

1. rule correctness;
2. Director orchestration and story interest; and
3. natural, grounded Chinese narration.

This is a white-box test of the production runtime. It is not a scripted
regression fixture and must not use a formatter sample as an actual-play battle
report.

## Source and Copyright Boundary

The local source is:

`/Users/haoli/Documents/TRPG/coc英文/Call of Cthulhu - Masks of Nyarlathotep (Larry DiTillio, Lynn Willis, Mike Mason etc.).pdf`

Verified source facts:

- 669 pages, PDF 1.7, unencrypted, extractable text;
- SHA-256 `806966db20202a020af6213695dccc0b547fc998a73dd2f1344567e2579a1942`;
- Peru occupies PDF pages 50-93;
- Campaign Beginning occupies PDF pages 94-101;
- America occupies PDF pages 102-179;
- England begins at PDF page 180; Egypt begins at PDF page 298.

Printed-page to PDF-index conversion must use `index/page-map.json`; no fixed
offset may be guessed. Extraction must go through
`trpg-pdf-ingest/scripts/pdf_cache.py::extract_markdown()`. Raw PDF prose,
handout text, and Keeper-secret prose remain local and must not be committed to
Git or sent to the Narrator. The repository may contain only structured IDs,
enums, hashes, locators, confidence/review data, and newly written safe
summaries.

## Test Roles

### Run A player: spoiler-aware diagnostic Codex

The primary Codex agent acts as a white-box investigator and may inspect the
full scenario graph, Keeper data, future scenes, source gates, and evaluator
findings. It deliberately exercises critical branches, alternate affordances,
rule subsystems, failure consequences, and chapter transitions. Player actions
are chosen interactively, not by the existing simulated-player runner.

This run measures system coverage, correctness, branch viability, and prose
behavior under known conditions. Because the player knows the mystery, it must
be labelled `diagnostic_spoiler_run`; it cannot be used as unbiased evidence
that clues are naturally discoverable, that suspense works, or that the
mystery is fair to a normal player.

### Run B player: fresh spoiler-blind Codex subagent

After Run A and its blocking repairs complete, Run B starts from a clean
campaign with a new investigator state and a fresh subagent created without
the parent conversation or Run A context. It receives only player-safe Events,
PublicState, and its own prior player transcript. It may not read scenario
files, Keeper views, source evidence, undiscovered clues, evaluator reports, or
Run A actions.

The blind player is not told which routes Run A covered or where the expected
solution lies. Its inability to find a clue, infer a next action, recover from
failure, or reach a viable route is primary test evidence rather than a reason
for the orchestrator to steer it. Full-log evaluators may observe the run but
must not feed spoiler-bearing advice back to the player lane.

### Keeper System Under Test

The Keeper is the production pipeline:

`SessionRegistry.send -> Rules -> Director -> NarrationEnvelope -> Narrator`

- Rules and dice are deterministic Python behavior with a recorded RNG seed.
- Director scene, clue, NPC, threat, belief, and question decisions are
  structured and auditable.
- `zhipu-coding/glm-5.2` is the sole KP prose model. It receives only the
  approved player-safe NarrationEnvelope and does not make rule decisions.

No stronger model silently replaces GLM-5.2 when it fails. Tool-use failures,
fallbacks, awkward prose, and latency are test results.

### Evaluators

Independent Codex subagents audit checkpoint artifacts. The rules evaluator
may see Keeper-side structured evidence. The story and prose evaluators use
only the minimum information required for their lens. Their reviews must cite
turn IDs, event IDs, roll IDs, scene IDs, receipts, or transcript excerpts.
During Run B, evaluator output is quarantined from the blind player until that
run ends or a P0/P1 defect requires a formally invalidated replay.

## Scope

### Run A: diagnostic actual-play journey

- Install or create a scenario-bound investigator in an isolated sandbox.
- Play the complete Peru prologue through its structured resolution.
- Transition to Campaign Beginning and America/New York.
- Play America/New York through its structured chapter resolution.
- Use spoiler knowledge to exercise critical and alternate routes without
  inventing actions unavailable to the production player interface.
- Target range: 120-220 meaningful player turns.
- Hard ceiling: 500 turns.

The hard ceiling is a safety stop, not a completion target. The run ends early
on a valid chapter terminal, investigator death/unplayability, an unresolved
security blocker, invalid evidence provenance, or an unrecoverable provider
failure.

### Run B: spoiler-blind actual-play journey

- Start from a fresh sandbox, fresh session lineage, and fresh player context.
- Play Peru and America again without access to Run A or Keeper information.
- Allow natural hesitation, wrong hypotheses, missed optional clues, and
  failure consequences.
- Do not route the player toward paths it has not discovered.
- Target range: 120-260 meaningful player turns.
- Hard ceiling: 500 turns.

Run B completes on structured America resolution, investigator
death/unplayability, or the hard ceiling. If it stalls, the report must identify
the exact last viable clue/affordance, the player's known state, and the
Director's available but undiscovered routes. It must not retroactively coach
the player merely to obtain a passing result.

The 500-turn ceiling applies separately to each primary run. The combined
maximum is therefore 1,000 primary-run turns, excluding the short chapter
handoff probes.

### Chapter handoff probes

After the primary runs, create separate checkpoint forks from the accepted
America terminal state for:

- America -> England/London; and
- America -> Egypt.

Each probe runs 5-10 genuine player turns. It verifies that investigator HP,
SAN, injuries, inventory, cash, clues, NPC knowledge, threat state, belief and
question state, memories, language profile, and source provenance survive the
chapter switch. These probes do not claim that England or Egypt was played in
full.

### Pre-run data work

The existing Peru package currently fails scenario validation with seven A21
`source_npc_ids` findings. These must be diagnosed against structured source
evidence and fixed before play. America is not yet a runnable compiled package
and must be compiled from the chapter page range with source evidence,
confidence gates, canonical seven-file Scenario IR, and validated epistemic
sidecars. England and Egypt need only validated entry/handoff packages for the
probe scope.

## Interactive White-Box Driver

Both play drivers must use the public production session contract. They must not
call rule, Director, terminal, combat, chase, SAN, or epistemic helpers directly
to manufacture coverage.

For every turn it records:

- exact player input;
- player-safe pre-state and post-state hashes;
- returned Events;
- intent artifact and Director plan references;
- roll, subsystem, outcome, and evidence receipt IDs;
- Narrator model identity, response mode, fallback, usage, and latency;
- current scene/chapter and terminal evidence; and
- an incremental durable checkpoint.

The driver writes artifacts after every turn so an interrupted 500-turn process
does not leave only mutated state. It must support resuming from a validated
checkpoint without silently joining incompatible model or code versions.

Checkpoint paths are rooted at the public runtime workspace, not at a synthetic
campaign tree.  The resumable boundary is the canonical `.coc/` layout:

- `.coc/campaigns/<campaign>/campaign.json` and optional `party.json`;
- the complete contained `save/`, `scenario/`, `index/`, `memory/`, and `logs/`
  trees (matching the native campaign snapshot boundary);
- immutable local `source/` inputs when present, with hashes in every manifest;
- the scenario-bound investigator's `creation.json`, `character.json`,
  `history.jsonl`, `development.jsonl`, and `inventory-history.jsonl`;
- the sanitized `.coc/runtime/sessions.json` snapshot; and
- the hash-linked playtest action journal.

Restore creates a fresh workspace generation rather than destructively
reconciling an active one.  The target may contain only a caller-supplied safe
`.coc/runtime.json` and prepared selected workspace indexes; any existing
managed campaign, investigator, session, or journal path fails closed before
the first restore write.  State created after the checkpoint therefore cannot
survive, while the failed/newer generation remains intact for diagnosis.  The
checkpoint must not copy `.coc/runtime.json`, credentials, Node worker state,
absolute-path configuration, or unrelated campaigns/investigators.  A restored
session snapshot contains only the already sanitized resolved pipeline, and the
driver switches its active-generation pointer only after restore plus SDK
validation succeeds.

Generation activation is an atomic run-metadata update.  Before that update, a
fresh session registry must restore the one expected session ID and PublicState
must match the checkpoint.  Failure leaves the previous active generation and
metadata untouched; successful activation retains the previous generation for
diagnosis/retry instead of deleting it.

Before checkpoint publication, the turn receipt must attest synchronous
recording with no background flush.  Its digest is recomputed from the final
structured `logs/live-turn-runtime.jsonl` row and its decision IDs are bound to
the matching `logs/runtime-telemetry.jsonl` receipt for the exact session; a
caller-supplied hex string is not evidence.  The sanitized session snapshot is
filtered to the one exact session, campaign, investigator, and character path
named by the checkpoint; unrelated workspace sessions and tombstones never
enter the artifact.  The manifest records managed roots plus absent optional
files.  Directory membership is derived from snapshotted files rather than
trusting arbitrary empty-directory claims.

The public runtime contract must also expose two player-safe structured facts
needed by the driver: the narrator adapter's observed `{provider, id}` plus
fallback/response mode in telemetry, and validated session/chapter terminal
evidence.  The driver may not infer either fact from narration prose or reach
into Keeper-only raw turns.

## Checkpoints and Repair Loop

A review checkpoint occurs every ten turns and at every scene or chapter
transition. Run A checkpoint findings are available to the diagnostic player.
Run B checkpoint findings remain quarantined from the blind player except for
non-spoiler operational errors such as a failed model call.

At a checkpoint:

1. persist campaign/session/model provenance and evidence receipts;
2. run structural invariants and the three evaluation lenses;
3. classify findings as rule, Director/data, narration, runtime/evidence, or
   test-infrastructure defects;
4. continue immediately when there is no blocking finding.

For a P0/P1 system defect:

1. stop before consuming another player action;
2. preserve the failing segment and pre-defect snapshot;
3. reproduce the cause with a focused test;
4. repair on the playtest branch and run the relevant regression suite;
5. replay the same player action with the same RNG state from the pre-defect
   snapshot;
6. mark the original segment invalidated rather than mixing it into accepted
   evidence.

Non-blocking prose and pacing findings are accumulated and normally repaired at
the next chapter boundary to avoid constantly rewriting the live experience.
After Run A repairs are complete, freeze a tested code revision before starting
Run B. If Run B exposes a new P0/P1 defect, record the version boundary and
replay only the invalidated segment; never compare mixed-version turns as if
they were one homogeneous run.

## Evaluation Rubric

### 1. Rule correctness

Evaluate intent routing, difficulty selection, roll provenance, bonus/penalty
dice, pushed-roll origin and consequences, SAN loss and involuntary actions,
combat and wounds, chase procedure when applicable, time costs, state
persistence, terminal evidence, and replay consistency. Every claim must bind
to structured receipts and, when source-dependent, to accepted source
locators.

Output: pass/fail findings plus a 0-100 score. Any unresolved rule error,
invented roll, broken provenance chain, or helper-only coverage blocks
acceptance.

### 2. Director orchestration and story interest

Evaluate meaningful choice, clue redundancy, consequence feedback, pacing,
scene variety, NPC differentiation, threat escalation, mystery clarity,
belief/question payoff, resistance to railroading, and chapter handoff quality.
Semantic judgments are made by an evaluator with recorded reasons; no prose
keyword matcher may stand in for evaluation.

Output: 0-100 score with strong moments, weak moments, dead ends, and cited
turn/scene evidence. Run A supplies branch-structure evidence. Run B is the
primary evidence for clue discoverability, suspense, agency, mystery fairness,
and whether an ordinary player gets stuck. The final report compares the two
route graphs and classifies missed routes as optional, insufficiently
signposted, mechanically blocked, or reasonably undiscovered.

### 3. Natural grounded Chinese prose

Evaluate dialogue naturalness, local idiom, sentence rhythm, specificity,
repetition, excessive literary abstraction, mechanical phrasing, translation
artifacts, NPC voice separation, and consistency with structured state. Also
check that no internal ID, local path, protocol wrapper, source prose, or Keeper
secret leaks into player-visible text.

Output: 0-100 score with representative short excerpts and repair
recommendations. Model output is judged as produced; it is not silently edited
before scoring.

## Evidence and Reports

The run lives under an isolated `.coc/playtests/<run-id>/` tree and never
mutates the user's real campaign or investigator library. Required artifacts:

- separate Run A and Run B incremental transcripts and player/keeper streams;
- session and checkpoint manifests;
- rolls, state patches, subsystem receipts, telemetry, and model invocations;
- scenario/source/evidence provenance;
- checkpoint reviews and defect/replay ledger;
- spoiler-vs-blind route comparison and chapter transition report;
- three-axis evaluation report; and
- final report generated only after evidence receipt validation.

Only a run whose recomputed evidence receipt is eligible may produce
`battle-report.md`. Otherwise the artifact is `verification-sample.md` with an
explicit NON-GAMEPLAY heading. Run A must visibly disclose its spoiler-aware
diagnostic status even if its mechanical provenance is otherwise eligible. Run
B is the primary candidate for an ordinary actual-play battle report. The final
handoff must read both complete reports before quoting or summarizing them.

## Acceptance Criteria

The work is complete when:

1. Peru and America packages validate with zero errors and accepted critical
   source gates;
2. the GLM-5.2 credential/model canary succeeds without fallback substitution;
3. Run A completes Peru and America or records a legitimate terminal/blocker
   before its 500-turn ceiling, with spoiler status correctly disclosed;
4. Run B uses a fresh quarantined player context and completes Peru and America
   or records exactly where a spoiler-blind player stalled before its separate
   500-turn ceiling;
5. the final analysis compares spoiler-aware and blind route coverage without
   leaking Run A guidance into Run B;
6. chapter handoff probes to England and Egypt complete without state or secret
   leakage;
7. all blocking white-box findings are fixed, regression-tested, and replayed;
8. the three evaluation reports contain evidence-backed scores and findings;
9. full project tests pass after all repairs;
10. evidence classification and artifact naming pass independent review; and
11. no copyrighted source prose or PDF asset is committed.

## Non-Goals

- Playing the full 669-page global campaign.
- Claiming England or Egypt completion from transition probes.
- Replacing GLM-5.2 with a stronger KP model to improve scores.
- Treating scripted fixtures or deterministic smoke reports as actual play.
- Committing the source PDF, raw extracted chapters, or Keeper-secret prose.
