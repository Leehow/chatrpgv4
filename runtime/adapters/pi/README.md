# Pi narrator adapter (low-level compatibility component)

This directory is not the canonical Pi product path. Canonical Pi/headless play
uses the same skills-enabled Keeper agent described in
`runtime/protocol/PROTOCOL.md`: it reads `plugins/coc-keeper/skills`, discovers
`coc_toolbox.py`, decides which tools to call, and owns final narration just as
an AI-coding host does.

`runtime/adapters/pi/` remains only as a low-level compatibility component for
an explicitly bounded narration request. It must not be advertised or tested
as the full Pi Keeper experience, and no new product capability may be wired
only here.

The canonical Pi agent loads `coc-keeper-play` and follows its always-active
Core Keeper Response Contract. Committed player actions enter the fictional
world before or alongside their outcomes whether or not an optional
`narration.brief` or `narration.review` call is useful on that turn. This narrow
adapter does not define a separate prose policy.

`brain: "pi"` in a v1 `.coc/runtime.json` migrates in memory to the v2 pipeline
with `narrator.kind: "pi"`; it does not make Pi a rules engine or a proxy to the
debug runtime. New configurations should use the explicit v2 pipeline.

## Transport

`adapter.py` exposes `pi_narrate(request)`. It delegates to the narrator
request sanitizer and accepts only:

```json
{
  "narration_envelope": {},
  "last_player_text": "",
  "play_language": "zh-Hans",
  "recent_narrations": []
}
```

`run_turn.mjs` is an import wrapper around the narrator Pi bridge. It supports
one-shot stdin JSON and `--server` JSONL framing for a scoped persistent worker.
The worker key is owned by Python and includes session, campaign, match, and
role; model workers are never shared across those boundaries.

No tool in this compatibility component can execute a turn, access a workspace
path, or call the debug adapter. Deterministic rendering is a fallback only for
this bounded request; it is not a fallback Keeper implementation.
