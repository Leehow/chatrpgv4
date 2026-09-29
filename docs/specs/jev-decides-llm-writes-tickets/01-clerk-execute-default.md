Status: ready-for-agent
Spec: docs/specs/jev-decides-llm-writes.md D-A · Contract §150.1

# 01 — The clerk executes by default

The consequence-step mode resolver reads the env switch, else the host-budget data's `jev_steps.shadow`; ship `shadow: false`. Record the effective mode and its source on the run's route/residual rows.

Tests (single files on the Mac; suites on leehow-pc): mode resolution (env on/shadow/off, empty env with data true/false, unreadable data = fallback shadow); a default-env run executes a cleared `clue_follow_up` and keeps `npc_reaction` shadow; the recorded mode names its source. A mutation that ignores the data default fails a case.

## Comments
