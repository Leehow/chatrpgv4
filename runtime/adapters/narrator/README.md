# Narrator adapter

Constrained subprocess bridge that turns a player-safe `narration_envelope`
into tabletop KP prose. Used by `plugins/coc-keeper/scripts/coc_live_match.py`
when `--narrator-runner` is set.

This is **not** a session `brain` in `.coc/runtime.json`. The narrator is a
render step after the structured KP planner (`run_live_turn`); it never
adjudicates rules or invents outcomes.

**Key insight:** the live “KP narrator LLM” is the same class of brain as the
player bridge — Pi Coding Agent (`@earendil-works/pi-coding-agent@0.79.9`),
one process per turn, single allowlisted custom tool, auth via Pi’s normal
discovery.

## Install

```bash
cd runtime/adapters/narrator && npm install
```

Pins `@earendil-works/pi-coding-agent@0.79.9`. Do not commit `node_modules/`.
You may symlink `../player/node_modules` if both adapters share the same pin.

## Auth / model

Same as the Pi KP / player adapters (`~/.pi/agent` or environment variables).
Do not commit secrets or API keys.

## Layout

| File | Role |
|------|------|
| `adapter.py` | Python wrapper: `narrator_send_turn(request) -> {final_text, notes?}` |
| `run_narration.mjs` | Real Pi bridge: stdin JSON → stdout `{ok, final_text\|error}` |
| `package.json` | Node dependency pin |

## Live match

```bash
cd runtime/adapters/narrator && npm install

python3 plugins/coc-keeper/scripts/coc_live_match.py \
  --workspace /path/to/workspace \
  --campaign <campaign_id> \
  --investigator inv1 \
  --runner runtime/adapters/player/run_player_turn.mjs \
  --narrator-runner runtime/adapters/narrator/run_narration.mjs \
  --live \
  --max-turns 8
```

`--live` records a user claim only. `evidence.json` must independently attest
the narrator runner/model and verify the run artifacts before the match can be
eligible as gameplay evidence. Scripted, fake, unknown, or unattested narrator
runners remain ineligible even when `--live` is present.

## Request / response

**Request** (envelope is already spoiler-safe; adapter strips `rationale`):

```json
{
  "narration_envelope": { "...": "from build_narration_envelope" },
  "last_player_text": "player action this turn",
  "play_language": "zh-Hans",
  "recent_narrations": ["previous KP final_text", "..."]
}
```

**Response:**

```json
{
  "ok": true,
  "final_text": "...",
  "notes": "optional; narrator_missing_tool_use when prose-degraded"
}
```

## Fallback ladder

1. Call narrator runner with the sanitized envelope.
2. On success: run `guard_player_visible_text` on `final_text`; if rewrite
   findings change the text, use the guarded `final_text`; append audit lines
   with `field=final_text` to `logs/narration-audit.jsonl`.
3. On runner error / timeout: log `narrator_fallback` on the turn record and
   fall back to the deterministic template text from
   `coc_playtest_driver._keeper_turn_text` (current headless behavior).
4. Match metadata: `narration_method` is `llm_narrator` when a narrator runner
   was configured, else `template`. `fallback_turns` counts template fallbacks.

## V1 behavior

- One process invocation per turn (no Pi session file continuity).
- Only custom tool `coc_keeper_narration` is allowlisted.
- **Prose degradation:** if the model returns free text without the tool, the
  bridge still returns `ok: true` with that prose as `final_text` and
  `notes` set to `narrator_missing_tool_use: ...`.
- Relative runner paths are resolved against the **caller cwd** before spawn
  (subprocess cwd is the adapter directory).

## Fake runners (tests)

Non-`.mjs` / non-`.js` paths are executed directly so contract tests can use a
tiny Python executable without Node.
