# SL-15 measurement, pre-registered 2026-09-24 before any run

Arms: before = parent ef8efdf97 (detached worktree, own build); after = claude/sl15-20260924. Live Keeper grok-build/grok-4.7-build-fast, thinking low,
product driver (experiments/single-loop-routing/run.mjs --llm replay --keeper live), 3 runs per fixture per arm, sequential.
Fixtures: fight-round (committed), gate3-turn3 (new: gate3-haunting-2329 before turn 3, "我回诺特办公室，揪住他的领子一拳打过去……").

Counted per run: model-origin look/lookup tool calls (summary.calls, origin model), model calls (summary.model_calls), LLM steps (summary.llm_steps).

Expected:
- gate3-turn3, before: 2-3 looks per run (scene after the clerk move, npc Knott, session after combat start), as on the live gate.
- gate3-turn3, after: the scene look and the session look should mostly go (scene carried after the move; session carried from the
  fight's first fresh read). The Knott look before the attack should stay: no candidate names him at that step (§135.31 says so).
  Prediction: 1 (0-2) look per run; model calls down by 0-1 (the gate's scene+npc looks were one response, so removing one of
  them saves no call unless both go).
- The 1 KiB cut drops `present` and the tail of the scene view and `mechanics`/combat fields of a card. If the Keeper looks for
  what was cut, the scene/npc looks stay: that would show as after >= before and is a finding about the ceiling, not noise.
- fight-round, before: 0 looks per run (SL-11's after-low arm on this fixture: 0/0/0; SL-10's: 0/0/0). After: 0. This fixture is a
  check that the carried session view and card (about 1.4 KB more before the first step) add no call: model calls within +-1 of before.
- Noise: 3 runs per arm; a difference of 1 look per run or 1 model call per run is within run-to-run variation of a live Keeper
  (SL-11: calls per turn 2/2/4 vs 6/2/4 on the same arm). Only a consistent shift across all three runs is read as an effect.
