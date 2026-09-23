Status: needs-triage
Stage: SL-03
Spec: docs/specs/pi-native-single-loop.md

# SL-03 — One operation entry, suspended reviews, scope frames, real delivery

Turn the canonical operation dispatcher into the operation service both origins use; source and memory become frames; admission and Mod preparation may suspend an operation; delivery stays the real Keeper `narrate`/`ask`.

## Depends on

- SL-02 accepted.

## Acceptance (design §13 SL-03 gate + SL-A03/A04/A07/A10)

- No same-goal recursive driver in any tool or guard; no world effect before a refusal; delivery failure never reports success; a lost settled response is recovered by `call_status`, never re-rolled or re-paid; admission/prepare/execute/finalize once per operation; a pure semantic read publishes nothing.
