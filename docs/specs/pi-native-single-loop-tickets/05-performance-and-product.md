Status: needs-triage
Stage: SL-05
Spec: docs/specs/pi-native-single-loop.md

# SL-05 — Independent reads, observation projection, compiled and source parity, paired measurement

Parallel independent reads within dependency boundaries; result projections by purpose instead of a summary model; the same engine on source and compiled layouts; the paired measurement plan from SL-00 executed.

## Depends on

- SL-04 accepted.

## Acceptance (design §13 SL-05 gate, §14.3)

- End-to-end paired evidence on the same configuration (legacy vs hybrid-v1, then hybrid-v1 plus each optional optimization as an ablation); no new error states written; a clean packaged App starts, continues and restarts on hybrid-v1.
