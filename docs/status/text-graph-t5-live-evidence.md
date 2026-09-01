# TextGraph T5 — live play evidence

> **Status:** in progress. Updated as runs happen, not at the end.
> **Track:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`

Every run is preserved under `.coc/playtests/`, including runs that fail or
produce no usable turn. A run that goes nowhere is still evidence.

## Method

Real `pi-coc --mode rpc`, live KP (grok-4.5) inside the plugin, this session as
the sole player, one natural reply at a time. The driver
(`play_rpc_driver.py`, copied from the DirectorGraph smoke run and
re-pointed at this worktree) is transport only: it launches the real launcher,
sends one player prompt per invocation, and records events. It never settles a
turn, never renders, and never decides anything. No batch settle, no synthetic
turns, no scripted player.

## Runs

| run | path | language | purpose | outcome |
| --- | --- | --- | --- | --- |
| `textgraph-t5-en-20260901` | `.coc/playtests/textgraph-t5-en-20260901/` | `en` | T5 gate 1 (live non-zh session), gate 2 (real play), gate 4 (`findings` measurement) | in progress |

### Setup notes for `textgraph-t5-en-20260901`

The worktree needed two gitignored trees symlinked from the main checkout
before the launcher would run — `node_modules` and
`runtime/adapters/keeper/node_modules` (the bundled Pi the launcher requires
and refuses to substitute with a global install). The plugin source itself is
this worktree's, so the session exercises the T4 code.

One false start is recorded here because it cost real time: the launcher's
"bundled Pi is missing" message in `pi-stderr.log` was **stale**, appended by
an earlier attempt, and the session that appeared to fail had in fact come up
("COC 已激活 · MCP 已预热"). A subsequent `stop` then killed the working
session. Read `rpc-driver.log` timestamps, not the tail of an append-only
stderr file.
