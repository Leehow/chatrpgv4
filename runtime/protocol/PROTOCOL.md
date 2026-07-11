# COC Runtime Protocol (V1)

Language-agnostic semantics for the headless COC agent runtime. V1 transport is an in-process SDK; HTTP/SSE may wrap the same contract later.

Runtime composition is explicit in `.coc/runtime.json` v2: `planner`, `rules`,
`narrator`, and `player` each contain a constrained `kind`. Missing config
defaults to deterministic planner/rules, template narrator, and human player.
Legacy `brain: "debug" | "pi"` is migrated in memory with a deprecation
warning; Pi is narrator-only and never proxies rule execution. Both
compositions emit the same Event schema and share `.coc/` campaign state.
Player/narrator/Pi Node bridges support scoped JSONL server workers keyed by
session, campaign, match, and role; one-shot mode remains for compatibility.
Third-party web-search vendors are out of scope.

## Session API

| Operation | Semantics |
|---|---|
| `create_session(workspace)` | Returns `session_id`. Reads project brain config when the session starts. |
| `send(session_id, player_input)` | Returns `events[]` (or async iterator of events). One player turn. |
| `get_state(session_id)` | Returns `PublicState` — player-safe snapshot without replaying the full log. |
| `close_session(session_id)` | Ends the session. |

## Event envelope

Every runtime output is an Event:

```json
{
  "type": "narration | speech | roll | state_patch | choice | spoiler_gate | system | error",
  "id": "evt_...",
  "ts": "2026-07-09T12:00:00Z",
  "visibility": "player | keeper | system",
  "payload": {}
}
```

Required fields: `type`, `id`, `ts`, `visibility`, `payload`. JSON Schema: `events.schema.json`.

### Event types

| type | Role |
|---|---|
| `narration` | Keeper narration |
| `speech` | NPC / investigator dialogue |
| `roll` | Check request or result (skill, difficulty, dice, success level) |
| `state_patch` | Public state deltas (HP, SAN, clues, scene, etc.) |
| `choice` | Player choices (including scenario onboarding) |
| `spoiler_gate` | Keeper-only info requiring confirmation |
| `system` | Mode / save / brain / session notices |
| `error` | Recoverable or fatal errors |

### Rules

1. Frontends must not infer game state by scanning free prose; use `state_patch` and `get_state()`.
2. Machine fields use stable enums; player-visible strings follow `play_language` / localized terms.
3. `debug` and `pi` brains must emit the same schema.
4. Runtime routing must not infer meaning from keyword scans on free text (Semantic Matcher Constitution).

## PublicState

Player-safe snapshot for UI rendering: campaign id, scene, investigators’ public fields, known clues, pending choice if any, play language. Exact fields are defined alongside SDK implementation against existing `.coc/` artifacts.

All consumed campaign/save paths are containment-checked at session creation
and again on every `get_state`/`send`, including subsystem, combat, sanity, and
chase snapshots. State schemas accept only non-boolean integer versions;
invalid schemas project safe defaults plus sanitized `state_health` codes.
When a session names an investigator, PublicState loads only that exact ID and
never substitutes another investigator.

## Not in the public V1 API

- Raw model transcripts
- Arbitrary shell / repo mutation for external clients
- Search-provider integration
