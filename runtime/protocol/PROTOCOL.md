# COC Runtime Protocol (V1)

Language-agnostic semantics for the headless COC agent runtime. V1 transport is an in-process SDK; HTTP/SSE may wrap the same contract later.

A turn is run by a single Keeper coding agent: the runtime spawns a
skills-enabled agent (`runtime/adapters/keeper/run_keeper_turn.mjs`) that reads
the canonical `plugins/coc-keeper/skills` tree and drives the turn by calling
the `coc_toolbox.py` CLI — exactly the same binding used by Codex, Claude
Code, and Cursor hosts. The engine then projects the turn's journal receipts
(`logs/toolbox-calls.jsonl`, `logs/rolls.jsonl`) plus the agent's final prose
into the Event stream below. There is no narration envelope, secret audit, or
deterministic template fallback. `.coc/runtime.json` v2 composition fields are
retained for host display (`brain`), but rules and persistence always run
inside the toolbox. Third-party web-search vendors are out of scope.

## Session API

| Operation | Semantics |
|---|---|
| `setup_workspace(workspace, operation)` | Executes one canonical pre-session onboarding operation without requiring an active session. |
| `create_session(workspace)` | Returns `session_id`. Reads project brain config when the session starts. |
| `interact(session_id, player_input, *, semantic_route=None, rng_seed=None)` | Natural-language entry. Uses structured semantic evidence to select an ordinary turn or typed operation. |
| `send(session_id, player_input, *, player_intent=None, rng_seed=None)` | Returns `events[]`. Runs one full keeper-agent turn (toolbox calls + final narration). |
| `operate(session_id, operation, *, rng_seed=None)` | Executes one exact non-turn operation through the canonical plugin gateway and returns its structured receipt. |
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

`rng_seed` is an exact non-boolean integer or string scoped to this turn. It is
forwarded to the keeper agent as advisory context; deterministic dice come from
the per-call `seed` argument of `rules.*` toolbox tools. The seed is never
added to player-visible events or narration. Omitting it keeps production
entropy.

### Typed non-turn operations

`operate` accepts exactly `schema_version`, `kind`, and `payload`. V1 kinds are
`scenario.ensure`, `scenario.repair`, `magic.cast`, `magic.learn`,
`tome.read`, `hazard.apply`, `hazard.suffocation.start/tick/end`,
`hazard.poison`, `development.settle`, and `chapter.switch`. The Pi SDK delegates these to
`plugins/coc-keeper/scripts/coc_runtime_ops.py`; plugin hosts call that same
gateway directly. No host may implement a second rules or persistence path.

`scenario.repair` requires a structured `source_resolution_request` and keeps
raw source pages inside the Keeper compiler boundary. `chapter.switch`
requires exact target identity and structured terminal evidence. Magic
operations persist costs/results and public roll evidence before returning.

`interact` routes with an exact semantic artifact:
`{schema_version, route, reason, operation}`. `ordinary_turn` requires a null
operation; `operation` requires a canonical operation object. Coding agents
may provide this semantic evidence directly. Pi obtains it from a constrained
LLM router that receives only player text and PublicState. Router failure
selects `ordinary_turn`; it never guesses a state-changing operation.

Pre-session kinds are `onboarding.inspect`, `rules.inspect`, `campaign.create`,
`campaign.quick_start`, `scenario.bind_pdf`, `campaign.render_briefing`,
`investigator.create`, `investigator.render_card`, and
`campaign.link_investigator`. They are implemented by the same plugin gateway,
not by host-specific onboarding code. `scenario.bind_pdf` also generates the
player-safe character-creation briefing. It requires a validated
`source_bundle_path` produced by an external host PDF skill that satisfies the
`trpg-pdf-ingest` / `codex-pdf-skill` source-bundle contract (prefer the host's
existing PDF tool; otherwise the open-source `openai/skills` curated `pdf`
workflow); runtime code never parses the PDF.
Character cards default to Markdown
only so host capability detection cannot change the canonical result; callers
may explicitly request `html_mode: auto|always`.

## Event envelope

Every runtime output is an Event:

```json
{
  "type": "narration | speech | roll | state_patch | choice | spoiler_gate | system | error | tool_call",
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
| `tool_call` | Keeper-visible receipt of one toolbox CLI call made during the turn (projected from `logs/toolbox-calls.jsonl`; payload: `tool`, `ok`, `args`, `warnings`). Never `player` visibility. |

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
