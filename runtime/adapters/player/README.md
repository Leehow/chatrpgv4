# Player brain adapter

Constrained subprocess bridge that asks an external LLM to play the investigator
against the KP pipeline. Used by `plugins/coc-keeper/scripts/coc_live_match.py`
(N5 live LLM-player vs KP harness).

This is **not** a session `brain` in `.coc/runtime.json` (those are `debug` | `pi`
for the Keeper). The player adapter is a separate match-harness bridge.

**Key insight:** this repo is an AI-coding plugin, so the live “player LLM” is
the same class of brain as the KP — the AI coding tool’s own LLM via
[Pi Coding Agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
(`@earendil-works/pi-coding-agent@0.79.9`), a scoped persistent server worker
across turns (with one-shot compatibility), single
allowlisted custom tool, auth via Pi’s normal discovery.

## Install

```bash
cd runtime/adapters/player && npm install
```

Pins `@earendil-works/pi-coding-agent@0.79.9`. Do not commit `node_modules/`.

## Auth / model

Same as the Pi KP adapter (`runtime/adapters/pi/`): use Pi’s normal auth
discovery (`~/.pi/agent` or environment variables). Do not commit secrets or
API keys.

## Layout

| File | Role |
|------|------|
| `adapter.py` | Python wrapper: `player_send_turn(request) -> {player_text, player_notes?, intent_class?, model_identity?, response_mode?}` |
| `run_player_turn.mjs` | Real Pi bridge: stdin JSON → stdout `{ok, player_text\|error, model_identity?, response_mode?}` |
| `package.json` | Node dependency pin |

## Live match (AI coding tool LLM as investigator)

```bash
# 1) Install player-bridge deps (once)
cd runtime/adapters/player && npm install

# 2) Ensure Pi auth is configured (same as KP pi adapter)

# 3) Run a match — --live records only the user's live-play claim
python3 plugins/coc-keeper/scripts/coc_live_match.py \
  --workspace /path/to/workspace \
  --campaign <campaign_id> \
  --investigator inv1 \
  --runner runtime/adapters/player/run_player_turn.mjs \
  --live \
  --max-turns 20
```

Any stdin/stdout-JSON runner still works for development and other hosts (pass
`--runner` to a custom executable). Non-`.mjs` / non-`.js` paths are executed
directly so tests and alternate hosts can supply a tiny Python fake without
Node. Only the repository's canonical adapter path and exact checked-in digest
in `plugins/coc-keeper/references/trusted-playtest-runners.json` can qualify as
an evidence-grade player runner.

`--live` records `user_claimed_live` only. Gameplay-evidence eligibility comes
from `evidence.json`: repository-owned runner trust, the runtime-selected model
identity, counts derived from `runner-invocations.jsonl`, and verified hashes of
that ledger, the transcript, and event logs. Caller provenance and caller turn
counts are non-authoritative. Scripted, fake, modified, or unknown runners
remain ineligible even when `--live` is present; a canonical invocation without
a valid model identity also fails closed.

## Request / response

**Request** (player-safe only — never keeper secrets / director plans / graphs):

```json
{
  "narration": "player-visible text from the last turn",
  "character_card": { "...": "investigator's own sheet" },
  "transcript_tail": [{ "role": "keeper|player", "text": "..." }],
  "pending_choice": null,
  "play_language": "zh-Hans"
}
```

The Python harness first projects `character_card` through a strict player-owned
allowlist. The Node bridge then renders the complete bounded view: every skill
on the card, current HP/SAN/MP, characteristics and other derived values,
weapons, equipment, and player backstory/traits. Arbitrary sheet notes and
scenario provenance are omitted. `pending_choice` is surfaced as an explicit
question. The AI player never receives PublicState, scene/clue/route IDs,
expected outcomes, NPC agendas, or Keeper-only scenario files.
PublicState remains a frontend rendering API, not a player cognition channel.

**Response:**

```json
{
  "ok": true,
  "player_text": "...",
  "player_notes": "optional out-of-character reasoning",
  "intent_class": "optional canonical intent enum value",
  "model_identity": {"provider": "actual-provider", "id": "actual-model-id"},
  "response_mode": "tool"
}
```

The canonical Node bridge reads `model_identity` from the selected Pi session
model. `response_mode` is `tool` or `prose_fallback`; it is recorded in the
invocation ledger so prose degradation is counted rather than hidden.

`player_notes` are stored for the battle report and must never be fed back into KP.

Optional `intent_class` is structured semantic evidence from the player brain
(not keyword scanning). Allowed values mirror
`plugins/coc-keeper/scripts/coc_intent_router.py` `_PRIMARY_INTENT_ENUM`:
`investigate`, `social`, `move`, `combat`, `flee`, `meta`, `stuck`, `idle`,
`ambiguous`, `montage`, `cast`. Invalid values raise `RuntimeError` (bridge
contract violation). When present, `coc_live_match` passes it through to
`run_live_turn`'s caller-intent parameter.

## V1 behavior

- One process invocation per turn (no Pi session file continuity).
- Only custom tool `coc_player_action` is allowlisted (no unconstrained edit/write).
- **Prose degradation:** if the model returns free text without the tool, the
  bridge still returns `ok: true` with that prose as `player_text` and
  `player_notes` set to `player_missing_tool_use: ...` (unlike the KP bridge’s
  `pi_missing_tool_use` error event — a player prose answer is usable).
- If neither tool nor usable prose is produced, stdout is `{ok: false, error}`.

## Fake runners (tests)

Non-`.mjs` / non-`.js` paths are executed directly (same pattern as the Pi adapter),
so contract tests can use a tiny Python executable without Node.
