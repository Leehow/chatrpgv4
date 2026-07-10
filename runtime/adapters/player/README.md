# Player brain adapter

Constrained subprocess bridge that asks an external LLM to play the investigator
against the KP pipeline. Used by `plugins/coc-keeper/scripts/coc_live_match.py`
(N5 live LLM-player vs KP harness).

This is **not** a session `brain` in `.coc/runtime.json` (those are `debug` | `pi`
for the Keeper). The player adapter is a separate match-harness bridge.

## Layout

| File | Role |
|------|------|
| `adapter.py` | Python wrapper: `player_send_turn(request) -> {player_text, player_notes?}` |
| `run_player_turn.mjs` | Placeholder Node stub (real bridge wiring is environment-specific) |

## Request / response

**Request** (player-safe only — never keeper secrets / director plans / graphs):

```json
{
  "public_state": { "...": "from runtime.engine.public_state.build_public_state" },
  "narration": "player-visible text from the last turn",
  "character_card": { "...": "investigator's own sheet" },
  "transcript_tail": [{ "role": "keeper|player", "text": "..." }],
  "pending_choice": null
}
```

**Response:**

```json
{ "ok": true, "player_text": "...", "player_notes": "optional in-character reasoning" }
```

`player_notes` are stored for the battle report and must never be fed back into KP.

## Fake runners (tests)

Non-`.mjs` / non-`.js` paths are executed directly (same pattern as the Pi adapter),
so contract tests can use a tiny Python executable without Node.
