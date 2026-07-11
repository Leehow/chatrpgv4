# Pi narrator adapter

`runtime/adapters/pi/` is the legacy-compatible Pi entrypoint for a single,
bounded job: rendering player-safe Keeper narration after deterministic planner
and rules execution have completed.

`brain: "pi"` in a v1 `.coc/runtime.json` migrates in memory to the v2 pipeline
with `narrator.kind: "pi"`; it does not make Pi a rules engine or a proxy to the
debug runtime. New configurations should use the explicit v2 pipeline.

## Transport

`adapter.py` exposes `pi_narrate(request)`. It delegates to the narrator
request sanitizer and accepts only:

```json
{
  "narration_envelope": {},
  "last_player_text": "",
  "play_language": "zh-Hans",
  "recent_narrations": []
}
```

`run_turn.mjs` is an import wrapper around the narrator Pi bridge. It supports
one-shot stdin JSON and `--server` JSONL framing for a scoped persistent worker.
The worker key is owned by Python and includes session, campaign, match, and
role; model workers are never shared across those boundaries.

No Pi tool can execute a turn, access a workspace path, or call the debug
adapter. Deterministic rendering remains the fallback if narration fails.
