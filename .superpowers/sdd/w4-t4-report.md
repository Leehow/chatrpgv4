# W4 Task 4 Report: P1-2 — 空 handle 反压继续推进

## Status

DONE. The live turn runner no longer strands the player on an empty
"awaiting_player_input" stop. When a turn surfaces nothing the player can act on
(no real fork, no clue, no route, no npc decision) and there is remaining
auto-advance budget, the stop loop now keeps advancing (as a low-agency beat) so
the director gets another chance to surface a handle/threat/NPC question. The
`max_turns` cap still holds, so there is no infinite-loop risk.

## Commit

`fix(coc): don't stop on empty handles when not a real fork (P1-2)`
(see `git log` for hash; commit created at end of task on branch
`release/0.15-alpha`)

## What was done

### 1. `coc_live_turn_runner.py` (canonical + zcode synced)
- Added helper `_turn_has_actionable_content(turn) -> bool`. It returns True when
  the turn carries any structured handle the player could respond to:
  - `clue_revealed` is non-empty, OR
  - `choice_frame.is_real_fork` is True, OR
  - `choice_frame.routes` is a non-empty list, OR
  - an npc move is marked `requires_player_decision` (reuses the existing
    `_npc_move_requires_player_decision` gate from P0-2c).
  It mirrors the structured fields already consulted by `_turn_interrupt_reason`
  and does NOT rebuild `stop_actionability` (which is assembled post-loop).
- **Conservative by design**: when `choice_frame` is missing/non-dict, or the
  `routes` key is missing/malformed (not a list), it returns True (treat as
  content → stop) so the runner never over-advances past a turn whose frame it
  could not confidently parse. Only a *demonstrably* empty turn (real list
  `routes: []`, no fork, no clue, no npc decision) returns False.
- Stop-loop change: in the `not _should_auto_advance(...)` branch, before
  breaking with `awaiting_player_input`, check
  `index < max_turns - 1 and not _turn_has_actionable_content(turn)`. If true,
  run `choice = _semantic_low_agency_choice(choice)` then `continue` (so the
  next iteration is a low-agency advance, exactly as the brief required).
  Otherwise break as before.

### 2. `tests/test_live_turn_runner.py` (module `live_runner`)
TDD: wrote 4 failing tests first (red), then implemented (green).
- `test_turn_has_actionable_content_true_for_fork_clue_routes_npc` — each
  structured handle (fork / non-empty routes / clue / npc decision) → True.
- `test_turn_has_actionable_content_false_when_truly_empty` — empty frame with
  `routes: []`, no clue, no npc decision → False.
- `test_turn_has_actionable_content_conservative_on_missing_fields` — `{}` and
  `{"choice_frame": {}}` (missing `routes` key) → True (do not over-advance).
- `test_live_turn_keeps_advancing_when_no_actionable_content` — integration: a
  non-low-agency investigative input in an empty scene (the exact P1-2 trap —
  `_should_auto_advance` is False AND the turn has no content) with
  `max_auto_advance=3` now runs >= 2 turns, never stops on
  `awaiting_player_input`, marks continuation turns `auto_advanced=True`, and
  respects the `max_turns` cap.

## Test summary

Full runner suite: **15 passed** (was 11; +4 new).
Full repo suite: **1072 passed, 0 failed** (was 1068; +4 new).
Sync check: `plugin copies are in sync` (both runner copies identical).

### Critical regression checks (all PASS)
- `test_live_turn_state_patch_syncs_minimal_scene_and_defers_detail_log` — a
  `visible_affordance` in the state patch makes `stop_actionability` surface a
  handle, but more importantly the turn's own `choice_frame.routes` is
  non-empty → `_turn_has_actionable_content` True → stops normally at turn 1.
- `test_live_turn_low_agency_stops_at_real_fork` — two open affordances →
  `is_real_fork` True → `_turn_has_actionable_content` True → stops at turn 1
  with `meaningful_choice`.
- `test_live_turn_auto_advances_low_agency_posture_until_interrupt` — low-agency
  compressed-progress path unaffected (it never reaches the new branch because
  `_should_auto_advance` is True there); still advances until a scene transition
  interrupt.

## Self-review

- [x] empty-content turn (no fork/clue/routes/npc-decision) with remaining
      budget → continues, not stops.
- [x] turn WITH content (fork/clue/route/npc) → stops normally (regression
      preserved — verified by the 3 critical tests above).
- [x] max_turns cap respected (no infinite loop). Verified: `max_auto_advance=1`
      still stops at 1 turn (`awaiting_player_input`); `max_auto_advance=3` runs
      all 3 then stops at `max_auto_advance_reached`.
- [x] Conservative: when ambiguous (missing `choice_frame`, or `routes` not a
      list), returns True → stop (don't over-advance).
- [x] On the continue path `choice = _semantic_low_agency_choice(choice)` runs
      before `continue`, so the next iteration is a low-agency advance
      (integration test asserts continuation turns are `auto_advanced=True`).
- [x] Dual-track synced (canonical `coc-keeper` and `coc-keeper-zcode` are
      byte-identical).

## Design decisions & notes

- The brief suggested approximating stop_actionability handles with the
  structured fields on the turn. Confirmed this is the right call: the turn
  dict already carries `choice_frame` (with `is_real_fork`, `routes`,
  `route_count`, `open_route_count`), `clue_revealed`, and `npc_moves`, which
  are exactly the structured fields `_turn_interrupt_reason` already gates on.
  Reusing them keeps the two stop gates (`_turn_interrupt_reason` for the hard
  stop, `_turn_has_actionable_content` for the soft "is there anything at all"
  gate) aligned and avoids re-deriving handles post-loop.
- The guard `index < max_turns - 1` is what keeps the cap honest: on the LAST
  allowed iteration there is no budget to continue, so the loop falls through to
  `stop_reason = "awaiting_player_input"` and breaks. This preserves the
  existing semantics for a single-turn call (`max_auto_advance=1`).
- `_turn_has_actionable_content` treats a missing `routes` key as ambiguous
  (True) but an explicit empty list `routes: []` as definitive (False). This is
  deliberate: the director always emits a `routes` list in the choice frame, so
  an absent/malformed key means we could not parse the frame and should not risk
  advancing.

## Concerns

1. **Single empty turn with `max_auto_advance=1`**: if a caller explicitly
   requests only one turn and the scene is empty, the runner still stops at
   turn 1 with `awaiting_player_input`. The fix cannot manufacture budget that
   was not requested; this is correct behavior (the cap is the caller's
   contract). The P1-2 improvement only applies when there is remaining budget.

2. **No guarantee a handle appears**: continuing gives the director *another
   chance* to surface a handle, but if the scene is genuinely empty (no
   affordances, no clues, no npc, no pressure) the loop will run to the cap and
   stop at `max_auto_advance_reached` with the player still having nothing
   concrete to act on. That is a scenario-design issue (the scene needs content
   or an exit contract), not something the runner can fabricate. The fix removes
   the premature stop; it does not invent content.

3. **`stop_actionability` is still built from the final turn**: the new loop
   behavior means the final turn of a multi-turn empty run is whichever turn hit
   the cap (or the first one with content). `stop_actionability` correctly
   reflects that final turn. No change needed to the post-loop contract
   assembly; just noting the relationship.
