# Masks Peru + America White-Box Playtest Design

**Date:** 2026-07-12  
**Status:** Approved for planning  
**Branch:** `codex/masks-whitebox-playtest`

## Objective

Run a genuine, evidence-bearing Call of Cthulhu playtest through the complete
Peru prologue and America/New York chapter of *Masks of Nyarlathotep*, then
probe chapter handoffs to England and Egypt. The run evaluates the Keeper
system from three perspectives:

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

### Player

The primary Codex agent acts as the investigator and sees only player-safe
state and Events. It does not read Keeper secrets, undiscovered clue content,
future scenes, or full evaluator findings during active play. Player actions
are chosen interactively, not by the existing simulated-player runner.

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

## Scope

### Primary actual-play journey

- Install or create a scenario-bound investigator in an isolated sandbox.
- Play the complete Peru prologue through its structured resolution.
- Transition to Campaign Beginning and America/New York.
- Play America/New York through its structured chapter resolution.
- Target range: 120-220 meaningful player turns.
- Hard ceiling: 500 turns.

The hard ceiling is a safety stop, not a completion target. The run ends early
on a valid chapter terminal, investigator death/unplayability, an unresolved
security blocker, invalid evidence provenance, or an unrecoverable provider
failure.

### Chapter handoff probes

After America completes, create separate checkpoint forks for:

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

The play driver must use the public production session contract. It must not
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

## Checkpoints and Repair Loop

A review checkpoint occurs every ten turns and at every scene or chapter
transition.

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
turn/scene evidence.

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

- incremental actual-play transcript and player/keeper view streams;
- session and checkpoint manifests;
- rolls, state patches, subsystem receipts, telemetry, and model invocations;
- scenario/source/evidence provenance;
- checkpoint reviews and defect/replay ledger;
- chapter transition report;
- three-axis evaluation report; and
- final report generated only after evidence receipt validation.

Only a run whose recomputed evidence receipt is eligible may produce
`battle-report.md`. Otherwise the artifact is
`verification-sample.md` with an explicit NON-GAMEPLAY heading. The final
handoff must read the complete report before quoting or summarizing it.

## Acceptance Criteria

The work is complete when:

1. Peru and America packages validate with zero errors and accepted critical
   source gates;
2. the GLM-5.2 credential/model canary succeeds without fallback substitution;
3. the canonical interactive driver completes Peru and America or records a
   legitimate terminal/blocker before the 500-turn ceiling;
4. chapter handoff probes to England and Egypt complete without state or secret
   leakage;
5. all blocking white-box findings are fixed, regression-tested, and replayed;
6. the three evaluation reports contain evidence-backed scores and findings;
7. full project tests pass after all repairs;
8. evidence classification and artifact naming pass independent review; and
9. no copyrighted source prose or PDF asset is committed.

## Non-Goals

- Playing the full 669-page global campaign.
- Claiming England or Egypt completion from transition probes.
- Replacing GLM-5.2 with a stronger KP model to improve scores.
- Treating scripted fixtures or deterministic smoke reports as actual play.
- Committing the source PDF, raw extracted chapters, or Keeper-secret prose.

