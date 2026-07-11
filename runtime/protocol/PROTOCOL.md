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
| `send(session_id, player_input, *, player_intent=None, rng_seed=None, subsystem_request=None, pending_choice_response=None)` | Returns `events[]` (or async iterator of events). One player turn or typed subsystem continuation. |
| `get_state(session_id)` | Returns `PublicState` — player-safe snapshot without replaying the full log. |
| `close_session(session_id)` | Ends the session. |

### One-turn player input

A caller may attach structured semantic evidence and a deterministic seed to
one player turn. The JSON-equivalent shape is:

```json
{
  "player_input": "我仔细搜查房间。",
  "player_intent": {
    "primary_intent": "investigate",
    "secondary_intents": [],
    "target_entities": ["scene"],
    "risk_posture": "cautious",
    "explicit_roll_request": false,
    "player_hypothesis": null,
    "action_atoms": [{"topic": "room", "verb": "search"}],
    "npc_interactions": []
  },
  "rng_seed": "run-a:0001"
}
```

`player_intent` is the caller's own structured statement of the intended
action. The runtime validates its exact public fields and canonical enums; it
does not derive or repair the structure by interpreting `player_input`.
`action_atoms` and `npc_interactions` must be lists of JSON-only objects.

`rng_seed` is an exact non-boolean integer or string scoped to this turn. The
same seed and pre-turn snapshot reproduce the same rule rolls. The seed is
recorded as `rng_seed` in `logs/live-turn-runtime.jsonl`, but is never added to
player-visible events or narration. Omitting it keeps production entropy.

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
