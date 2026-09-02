# Pi-Coc DebugExperiment

Status: implemented MVP on `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`.

## Purpose

`DebugExperiment` replays one **latest settled** campaign checkpoint through
multiple isolated real Pi-Coc RPC lanes. It compares rule/director behavior
without reopening the source table, polluting its timeline Git, or turning
debug control into another Keeper prompt.

The external interface is one host-only dispatcher:

```text
/system debug run <closed JSON object>
/system debug status current
/system debug cancel current
/system debug report current
```

The exact `debug` subcommand is consumed before ordinary `/system`
`beforeDispatch` and `sendMessage`. Therefore it creates no current-KP model
turn, player input, journal row, or recovery tool scope. Ordinary
`/system <instruction>` remains unchanged.

## Run contract

```json
{
  "player_input": "同一场景的默认玩家行动",
  "lanes": [
    {
      "id": "ask-last-tenants",
      "profile": "rules-director-single-draft",
      "player_input": "可选的 lane 专属自然玩家行动"
    },
    {
      "id": "ask-house-keys",
      "profile": "production"
    }
  ],
  "record": [
    "rules",
    "director",
    "working_set",
    "timing",
    "state_diff",
    "tools",
    "rpc",
    "provider_stream",
    "stderr"
  ],
  "concurrency": 2,
  "timeout_seconds": 180
}
```

Constraints:

- 1–20 semantic lane ids; duplicates and opaque ids fail closed. Explicit
  `concurrency` is 1–`min(20, lane count)`; when omitted it remains
  `min(2, lane count)`.
- Profiles are `production`, the narrow graph-only
  `rules-director-single-draft` profile, or `rules-all-single-draft`. The last
  profile keeps the full production play skills and working set while
  disabling only narration review for focused whole-rules-layer diagnostics.
- `timeout_seconds` is 1–180 and never resets on provider/tool progress.
- `final` evidence is mandatory even when omitted from `record`.
- RNG seeds, desired results, arbitrary tools, paths, environment overrides,
  provider fallbacks, and unknown fields are rejected.
- The host context must be idle play mode with a declared first-party
  provider (`xai` or `zai-coding-cn`). The gate is a closed set rather than
  one hardcoded name: which provider the account has quota on is the
  operator's call, while a relay or a silent fallback is still refused. The
  lane independently verifies that the assistant messages carry the declared
  provider and model, so a fallback fails the lane with
  `debug_provider_mismatch`.

## Situation (optional, diagnostic-only)

A checkpoint only affords what its scene already affords. To exercise a rule
family that lives deep in a module (chase, combat, magic) without hand-playing
to it, a run or a lane may carry one closed `situation`. A lane `situation`
replaces the run-level one, like `player_input`. Two shapes:

```json
{"situation": {"scene_id": "corbitt-confrontation",
               "npc_presence": ["npc-walter-corbitt"],
               "clue_ids": ["clue-corbitt-body-found"],
               "flags": {"basement-unlocked": true}}}
```

Structural seeding. After the fixed resume prompt settled at
`awaiting_player` and before the player message, the lane adapter applies the
fields **inside the sandbox lane through the canonical toolbox gateway**
(`coc_toolbox.py`, the same `run_tool` path the Pi MCP server uses, with the
host variables play sets): `state.move_scene`, then `state.npc_presence`
(`present`, per listed NPC; requires `scene_id`), then `state.record_clue`,
then `state.set_flag`. Decision ids are semantic and lane-scoped
(`debug-situation:<lane>:<op>:<id>`). Campaign state is therefore canonical:
the seed receipts belong to the player's turn window and the Keeper's next
`scene.context` presents the seeded scene, NPC, and clue exactly as after a
real move. The player message is prefixed with a short host note naming the
seeding and asking for a `scene.context` re-read. Seeding before the resume
was tried on the real host and is refused by design: the seed rows read as an
interrupted turn (`open_turn_recovery`), the host then refused to act
(`acting_authorized=false`, player input unbindable) and the lane deadlocked.
Scene, NPC, and clue ids are validated at planning against
the sealed campaign's compiled `scenario/` tables; an unknown id fails closed
with `situation_unknown_scene` / `situation_unknown_npc` /
`situation_unknown_clue` before any lane spawns. Flags are only
grammar-checked. A seeding call that does not return `ok` fails that lane
with `situation_seed_failed`.

```json
{"situation": {"establish_from_prompt": true}}
```

Prompt-established situation. The lane sends the natural player message, but
prepends a short host-owned diagnostic instruction on the same RPC prompt
channel the resume prompt uses: the player's message describes the situation
to be in; establish it through the canonical state operations before
adjudicating; state moves only through tools and dice only through rules.
Nothing in the Keeper prompt changes.

Both shapes keep every refusal above (no seeds, results, tools, paths, env,
provider fallbacks; `timeout_seconds` ≤ 180; profiles unchanged). Seeding
counts against the lane's absolute budget. The shape cannot be mixed, and
`establish_from_prompt` must be exactly `true`.

## Snapshot and lane isolation

The MVP accepts only the active `tl-main` latest finalized turn. Historical
turn selection will reuse the canonical rewind verifier after that branch is
integrated; this module does not copy or activate rewind logic.

Planning verifies:

1. no pending player turn;
2. active tip is a canonical turn commit with matching campaign/timeline/
   finalization trailers;
3. no tracked state drift outside the known post-finalization audit logs
   (`logs/canonical-events*`, `logs/toolbox-calls.jsonl`,
   `logs/delivery-receipts.jsonl`, and `logs/events.jsonl`, which a
   restart-time `session.resume` quarantine appends to);
4. the matching exact-delivery receipt is confirmed.

Each lane receives:

- an independent `git clone --mirror --no-local` campaign repo;
- its own campaign worktree at the sealed commit;
- copied workspace support (`runtime`, investigators, module assets) with
  symlinks rejected;
- the verified post-finalization delivery receipt;
- a private copied Pi home whose file symlinks are dereferenced, whose
  directory symlinks are rejected, and whose credentials are removed after
  exit;
- one Pi process group, RPC stream, watchdog, and evidence directory.

The source campaign ref and tracked status are checked before and after
materialization and are never modified.

## RPC lifecycle

Every lane runs the current repository's `pi-coc --mode rpc` with the selected
profile and official xAI model. The controller:

1. sends one fixed host resume prompt;
2. requires `session.resume` to be the first canonical tool;
3. waits for that prompt's `agent_settled` (not the earlier `agent_end`);
4. sends the natural player message exactly once;
5. accepts success only when `turn.finalize` succeeds and the visible assistant
   text exactly equals canonical `rendered_text`;
6. on deadline sends one abort, drains bounded evidence, then closes the exact
   process group.

## Evidence

Debug artifacts live outside every campaign repo:

```text
<workspace>/.coc/debug/runs/<semantic-experiment-id>/
  run.json
  comparison.json
  coordinator.log
  lanes/<lane-id>/
    progress.json
    live-rpc.jsonl          # only when rpc is selected
    final.json              # always
    rules.jsonl
    director.jsonl
    working-set.jsonl
    timing.jsonl
    tools.jsonl
    rpc.jsonl
    provider-stream.jsonl
    stderr.jsonl
    state-diff.json
  sandboxes/<lane-id>/...
```

Only selected categories are materialized. Credential-like fields and common
secret assignments in stderr are redacted, failures remain in comparison
output, and no experiment or sandbox is automatically deleted.

`final.json` always records `situation`: `{"shape": null}` for natural lanes;
for structural seeding the requested fields, every applied toolbox call with
its decision id, envelope `ok`, warnings, and error, and `seeded`; for the
prompt shape the exact instruction text. `comparison.json` carries the same
block per lane. Seeded toolbox calls also appear in `tools.jsonl` with
`phase: "seed"` and are excluded from `canonical_operations`, which lists only
what the Keeper itself called.

## Acceptance boundary

A debug matrix is diagnostic evidence, not a whole-product natural-play or
battle-report acceptance. It may show which lane finalized, timed out, called
which canonical operations, or changed which state paths. It does not choose a
winner, promote a RuleGraph candidate, merge a lane into production, or infer
prose quality from keywords. A lane with a seeded or prompt-established
situation is doubly so: the situation was placed by the host, not reached by
play, and `final.json` records which shape was applied so that evidence never
passes as natural play.
