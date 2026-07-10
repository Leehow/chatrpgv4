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
| `adapter.py` | Python wrapper: `narrator_send_turn(request) -> {final_text, notes?, model_identity?, response_mode?}` |
| `run_narration.mjs` | Real Pi bridge: stdin JSON → stdout `{ok, final_text\|error, model_identity?, response_mode?}` |
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

`--live` records a user claim only. The narrator is optional for gameplay
evidence: deterministic template narration, including template fallback after
a configured narrator failure, is allowed and counted. If narrator output is
actually used, its runner must match the canonical path and exact digest in
`plugins/coc-keeper/references/trusted-playtest-runners.json`, and its selected
model identity must be present. Used output from a scripted, fake, modified, or
unknown narrator makes the run ineligible.

`evidence.json` derives model and fallback counts from the hashed
`runner-invocations.jsonl` ledger and reconciles its player/narrator rows to the
transcript. Caller provenance and caller turn counts are non-authoritative.

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
  "notes": "optional; narrator_missing_tool_use when prose-degraded",
  "model_identity": {"provider": "actual-provider", "id": "actual-model-id"},
  "response_mode": "tool"
}
```

The canonical Node bridge reads `model_identity` from the selected Pi session
model. `response_mode` is `tool` or `prose_fallback`; prose degradation remains
eligible but is recorded as a fallback.

## Fallback ladder

1. Call narrator runner with the sanitized envelope.
2. On success: run `guard_player_visible_text` on `final_text`; if rewrite
   findings change the text, use the guarded `final_text`; append audit lines
   with `field=final_text` to `logs/narration-audit.jsonl`.
3. On runner error / timeout: log `narrator_fallback` on the turn record and
   fall back to the deterministic template text from
   `coc_playtest_driver._keeper_turn_text` (current headless behavior).
4. Match metadata: `narration_method` is `llm_narrator` when at least one
   narrator result was used, else `template`. `fallback_turns` is derived from
   ledger markers and counts deterministic templates, template fallbacks, and
   prose degradation.

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
