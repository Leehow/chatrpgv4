# Scenario Epistemic Director v1 — Review Record

**Date:** 2026-07-11  
**Base:** `release/0.2-alpha` (`a6dad3b6c4348077d7c405970c121ad3731f9141`)  
**Branch:** `feature/scenario-epistemic-director-v1`

## Scope reviewed

- optional scenario sidecar validation;
- deterministic clue-to-question policy;
- persistent belief snapshot and append-only events;
- Story Director context and DirectorPlan integration;
- post-rule epistemic resolution;
- apply-layer clue-commit gating;
- backward compatibility for scenarios without sidecars.

## Important findings fixed

1. **Failed obscured clues could leave a planned belief update visible to the narrator.**
   Post-rule backfill now preserves the plan under `planned_epistemic_contract`, resolves the player-facing contract against committed clues, and emits `HOLD` when supporting evidence did not land.
2. **Repeated confirmation treatments were deduplicated.**
   Treatment history now preserves repetitions in order, allowing later saturation audits without mechanically triggering reversals.
3. **A hypothesis asserted on the same turn could miss the evidence treatment selected from the pre-turn snapshot.**
   The reducer now includes the newly asserted hypothesis when its structured question matches the resolved contract.
4. **A reframe could affect every hypothesis attached to a question.**
   `revise_hypothesis_refs` now takes precedence, so only compiled revision targets are reframed.
5. **A clue linked to several question layers was resolved by source-array order.**
   The policy now ranks links by active question, live hypothesis presence, evidence strength, and question importance.
6. **Malformed optional sidecars could be silently treated as absent.**
   Present-but-non-object sidecars now fail validation; reframe contracts also require a stable id, explicit trigger clue, two setup clues, and preserved prior truth.

## Remaining deliberate limits

- The PDF page-map/parse-manifest source service remains a separate follow-up.
- Existing packaged scenarios do not automatically gain epistemic sidecars.
- Question closure beyond explicit `PAYOFF` remains authored data for a later schema revision.
- The v1 policy selects one primary cognitive effect per delivered clue, even when a clue has several valid links; the selection is now player-model-aware and deterministic.

## Verification target

```bash
PYTHONDONTWRITEBYTECODE=1 python -m pytest tests/ -q -p no:cacheprovider
```

The branch is ready for PR review only after this command passes on the final non-bot commit.
