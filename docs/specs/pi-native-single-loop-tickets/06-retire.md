Status: needs-triage
Stage: SL-06
Spec: docs/specs/pi-native-single-loop.md

# SL-06 — Retire the duplicate paths

Delete the old driver only when every condition holds; keep the legacy implementation on a tag or as fixtures without world write authority.

## Depends on

- SL-05 accepted.

## Acceptance (design §13 SL-06)

- No product call chain references `TaskRuntime.#run`; no foreground `submit_plan_packet`; no recursive submit in source/memory; no auto-continue after a hybrid run; old records identified and safely checked; source and compiled tables have real continuous play evidence.
