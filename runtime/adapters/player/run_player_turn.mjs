#!/usr/bin/env node
/**
 * Placeholder player-brain bridge.
 *
 * Real wiring is environment-specific (model auth, host agent, etc.).
 * Tests use non-.mjs fake executables via adapter._runner_cmd.
 *
 * Contract:
 *   stdin  JSON: {public_state, narration, character_card, transcript_tail, pending_choice}
 *   stdout JSON: {ok: true, player_text: string, player_notes?: string}
 *            or: {ok: false, error: string}
 */
process.stdout.write(
  JSON.stringify({
    ok: false,
    error:
      "run_player_turn.mjs is a placeholder; wire a real player LLM bridge or pass --runner to a live executable",
  }) + "\n",
);
process.exit(0);
