# Narrator adapter

This production adapter turns a player-safe `narration_envelope` into tabletop
KP prose. It is a render step after structured planning: it does not adjudicate
rules, mutate campaign state, choose player actions, or invent outcomes.

It is not a scripted playtest driver and is not the whole-product test entry
point. Global acceptance opens the real Codex plugin and uses a no-context
collaboration subagent as the player; see
`plugins/coc-keeper/skills/coc-playtest/SKILL.md`.

## Install

```bash
cd runtime/adapters/narrator
npm ci
```

The lockfile pins `@earendil-works/pi-coding-agent`. Do not commit
`node_modules/`.

## Authority boundary

The adapter receives an already sanitized envelope. It may phrase only the
approved facts and outcomes carried by that envelope. In particular:

- Keeper rationale, raw module truth, state files, and hidden logs are not
  narrator inputs.
- Player transcript rows describe attempts unless the structured current-turn
  result settles them.
- Previously visible Keeper rows may establish continuity only; they cannot
  authorize a new fact.
- A player-requested object, answer, permission, promise, or relationship does
  not become real merely because the narrator can phrase it.

`guard_player_visible_text` remains the final local safety boundary for accepted
prose. Provider failures and rejected prose must remain explicit; callers may
choose a safe production fallback without presenting the failed model output.

## Request / response

The process reads one JSON object from stdin:

```json
{
  "narration_envelope": {"...": "player-safe structured result"},
  "last_player_text": "player action this turn",
  "play_language": "zh-Hans",
  "recent_narrations": ["previous player-visible KP prose"],
  "public_transcript_tail": [
    {"role": "keeper", "text": "previously visible continuity"},
    {"role": "player", "text": "declared attempt"}
  ]
}
```

`public_transcript_tail` is optional and bounded to eight player-visible rows.
The process writes exactly one response:

```json
{
  "ok": true,
  "final_text": "...",
  "notes": "optional sanitized note",
  "model_identity": {"provider": "actual-provider", "id": "actual-model-id"},
  "response_mode": "tool"
}
```

On failure it writes `{"ok": false, "error": "..."}`. `response_mode` may be
`tool` or `prose_fallback`; degradation is observable rather than silently
reported as a fully structured response.

## Files

| File | Role |
|---|---|
| `adapter.py` | Python wrapper exposing `narrator_send_turn(request)` |
| `run_narration.mjs` | Constrained Pi bridge: stdin JSON to stdout JSON |
| `package.json` / lockfile | Node dependency contract |

Relative runner paths are resolved against the caller working directory before
the subprocess changes directory. Contract tests may invoke a small executable
fixture, but such fixtures are deterministic adapter evidence—not gameplay and
not battle reports.

## Model and secrets

Authentication uses Pi's normal discovery (`~/.pi/agent` or provider
environment variables). Never commit credentials, prompts, or raw provider
responses. Persist only privacy-safe model identity, attempt counts, timing,
and sanitized failure classes needed for operations.
