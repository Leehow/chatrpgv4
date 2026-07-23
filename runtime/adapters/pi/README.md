# Narrator Bridge (frozen compatibility component)

**Surface name:** Narrator Bridge  
**Path:** `runtime/adapters/pi/`  
**Status:** **frozen** — keep for compatibility; do not delete yet; do not expand.

This directory is **not** the Pi product surface. Do not call it "Pi Package"
or claim progressive / multi-agent / full-KP work from this path alone.

## Surface map (do not conflate)

| Official name | Path | Role |
|---|---|---|
| **Pi Package** | repo-root `package.json` + `plugins/coc-keeper/pi/` | Interactive Pi host: canonical skills, typed gateway, private source lifecycle |
| **Headless Runtime** | `runtime/sdk` + `runtime/adapters/keeper` | Python Event API; skills-enabled Keeper turn shell |
| **Narrator Bridge** | `runtime/adapters/pi/` (this directory) | Bounded narration request only |

Canonical headless play uses the skills-enabled Keeper agent in
`runtime/protocol/PROTOCOL.md` / `runtime/adapters/keeper`: it reads
`plugins/coc-keeper/skills`, calls `coc_toolbox.py`, and owns final narration.
This bridge must not be advertised or tested as the full Pi Keeper experience.

## Freeze policy

Allowed:

- Crash / security fixes that preserve the existing bounded contract
- Documentation that clarifies surface boundaries

Forbidden (requires an explicit product decision to unfreeze or delete):

- New product capabilities (progressive source, coordinator/leaf, OCR host bridge,
  campaign state, full turns, MCP gateway surface)
- Wiring a feature **only** here when it belongs on Pi Package or Headless Runtime
- Treating this path as experience-parity evidence for "Pi"

Deletion is a **later** step after Headless Runtime no longer needs
`narrator.kind: "pi"` / legacy `brain: "pi"` migration. Freeze is not delete.

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

`brain: "pi"` in a v1 `.coc/runtime.json` migrates in memory to the v2 pipeline
with `narrator.kind: "pi"`; it does not make this bridge a rules engine or the
Pi Package product. New configurations should use the explicit v2 pipeline.
