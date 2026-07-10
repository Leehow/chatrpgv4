# Task 2 Handoff: Live Outcomes and Graph-Aware Termination

## Status

Complete. Task 2 implements acceptance A07/A08 on `codex/coc-full-hardening`.

## Summary

- Added public `investigator_playability(campaign_dir, investigator_id)` with distinct structured states for active, unconscious, dying, stabilized, dead, temporarily unplayable, and permanently unplayable investigators.
- Only the explicit `dead` condition is investigator-terminal. Zero HP, unconsciousness, dying, stabilization, and insanity-related unplayability remain nonterminal campaign evidence.
- Dying pauses the live match with `pending_resolution.kind = "dying_rescue"` and lower-level First Aid / dying-CON-clock event routes. Stabilization remains distinct with `pending_resolution.kind = "stabilized_death_clock"`.
- Added public `terminal_evidence(story_graph, world_state, events)`. Both live match and scripted driver now derive terminal reporting from `is_terminal_scene(...)` plus structured `session_ending` records.
- Removed direct last-scene comparisons from live callers and the terminal helper. Array order remains only in legacy edge derivation.

## Files

- `plugins/coc-keeper/scripts/coc_live_match.py`
- `plugins/coc-keeper/scripts/coc_playtest_driver.py`
- `plugins/coc-keeper/scripts/coc_scene_graph.py`
- `tests/test_live_match.py`
- `tests/test_playtest_driver.py`

No adjacent production files were required.

## TDD Evidence

### RED

Command:

```bash
PYTHONDONTWRITEBYTECODE=1 /opt/miniconda3/bin/python3 -m pytest tests/test_live_match.py tests/test_playtest_driver.py tests/test_scene_graph.py -q -p no:cacheprovider
```

Result: **10 failed, 51 passed in 11.06s** (exit 1).

Expected failures showed that HP <= 0 and `dying` were still reported as `investigator_dead`, playability/terminal contracts were absent, terminal-not-last was false, last-with-outgoing was true, and structured `session_ending` was ignored by driver aggregation.

### GREEN

- New outcome subset: **6 passed, 9 deselected in 0.65s**.
- New branching/ending subset: **4 passed in 0.19s**.
- First focused integration attempt: **1 failed, 60 passed in 8.33s**. The failure exposed an over-eager live-match early stop on graph terminality; reporting was retained while live early stop was narrowed to structured `session_ending`.
- Final focused command above: **61 passed in 9.72s**.

## Broader Verification

- Healing/death-clock + rule-state tests: **77 passed in 0.13s**.
- Plugin metadata minimum test: **48 passed in 1.38s**.
- Full suite (`/opt/miniconda3/bin/python3 -m pytest tests -q -p no:cacheprovider`): **1663 passed in 41.36s**.
- `git diff --check`: clean.

## Implementation Commit

- `1ac0f30c44ab575ddccde1e689c1c02e4a103032` — `fix(playtest): use structured outcomes and terminal evidence`

## Risks and Scope Confirmation

- Nonterminal unplayable states now pause the current live match with structured stop reasons/pending resolution; consumers that enumerate stop reasons should accept these new non-death values.
- Structured `session_ending` intentionally counts as terminal evidence even when the active graph node still has outgoing edges.
- Scope is limited to the five Task 2 implementation/test files plus this required handoff. No parallel plugin track, free-text semantic matcher, lower-level healing rewrite, push, deploy, rebase, or destructive Git operation was introduced.

## Review Revision: Bout Ownership and PAYOFF Completion

Independent review found two Important issues, both corrected with test-first revisions:

1. Underlying `temporary_insane` / `indefinite_insane` state had been treated as loss of player control. The canonical classifier now marks only structured `bout_active` or an explicit `temporarily_unplayable` condition as temporarily unplayable; underlying insanity without an active bout remains active/playable.
2. The scripted driver stopped as soon as graph-terminal evidence appeared, preventing the real Director/Apply pipeline from executing terminal-scene `PAYOFF` and emitting `session_ending`. Graph terminality remains report evidence, while driver loop termination now requires structured `session_ending`, matching live-match policy.

### Review RED

- Focused Task 2 command: **3 failed, 62 passed in 6.59s**. Failures were both underlying-insanity parameter cases and the real production driver stopping after `CUT`.
- Strengthened narrowed command with `bout_active=True` alone: **4 failed in 0.69s**, proving the missing bout classification independently of underlying insanity.

### Review GREEN and Verification

- Narrowed bout + real CUT→PAYOFF integration: **5 passed in 0.69s**.
- Focused Task 2: **65 passed in 4.45s**.
- Sanity/bout + healing/state: **223 passed in 0.66s**.
- Plugin metadata minimum: **48 passed in 0.53s**.
- Full suite: **1667 passed in 29.85s**.
- `git diff --check`: clean.

### Review Revision Commit

- `af15780b9294749c04a79f2bf50a805c3c3ec05c` — `fix(playtest): align bout and payoff terminal semantics`

Revision scope is limited to the two Task 2 production callers and their two Task 2 test files. The integration test uses genuine `run_live_turn` behavior from a nonterminal start scene, records `scene_transition`, executes `PAYOFF` on the terminal resolution, and observes persisted `session_ending`; it does not use `_StaticLiveRunner` or pre-position the world on the terminal scene.
