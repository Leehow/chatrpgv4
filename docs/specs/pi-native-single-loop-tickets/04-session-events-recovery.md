Status: needs-triage
Stage: SL-04
Spec: docs/specs/pi-native-single-loop.md

# SL-04 — Session events, retry, compaction and recovery in the one driver

Remove the hybrid path's post-run continue loop for good; fold retry, compaction and queue wake-ups into the driver; persist and restore the active frame and the exact operation identities; new input revokes the old run before persistence completes.

## Depends on

- SL-03 accepted.

## Acceptance (design §13 SL-04 gate)

- At most one active driver per run; compaction never re-runs tools; new input or a model switch invalidates old work; real message pairing intact; the old TaskStore serves as the RunStore backend with revision and lock semantics unchanged.
