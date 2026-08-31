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

- 1–4 semantic lane ids; duplicates and opaque ids fail closed.
- Profiles are `production` or the existing exact
  `rules-director-single-draft` compatibility profile.
- `timeout_seconds` is 1–180 and never resets on provider/tool progress.
- `final` evidence is mandatory even when omitted from `record`.
- RNG seeds, desired results, arbitrary tools, paths, environment overrides,
  provider fallbacks, and unknown fields are rejected.
- The host context must be idle play mode with the official `xai` provider.

## Snapshot and lane isolation

The MVP accepts only the active `tl-main` latest finalized turn. Historical
turn selection will reuse the canonical rewind verifier after that branch is
integrated; this module does not copy or activate rewind logic.

Planning verifies:

1. no pending player turn;
2. active tip is a canonical turn commit with matching campaign/timeline/
   finalization trailers;
3. no tracked state drift outside the known post-finalization audit logs;
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

## Acceptance boundary

A debug matrix is diagnostic evidence, not a whole-product natural-play or
battle-report acceptance. It may show which lane finalized, timed out, called
which canonical operations, or changed which state paths. It does not choose a
winner, promote a RuleGraph candidate, merge a lane into production, or infer
prose quality from keywords.
