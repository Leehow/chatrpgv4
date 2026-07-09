# Pi brain adapter

Constrained Node bridge that embeds [Pi Coding Agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) as the COC Keeper brain (`brain: "pi"` in `.coc/runtime.json`).

## Install

```bash
cd runtime/adapters/pi && npm install
```

This pins `@earendil-works/pi-coding-agent@0.79.9`. Do not commit `node_modules/`.

## Auth / model

Use Pi’s normal auth discovery (`~/.pi/agent` or environment variables). Do not commit secrets or API keys.

## Layout

| File | Role |
|------|------|
| `adapter.py` | Python wrapper: `pi_send_turn(request) -> events[]` |
| `run_turn.mjs` | Stateless subprocess: stdin JSON → stdout `{ok, events\|error}` |
| `call_debug.py` | Tool helper: runs the same `debug_send_turn` path as `brain=debug` |
| `package.json` | Node dependency pin |

## V1 behavior

- One process invocation per turn (no Pi session file continuity).
- Only custom tool `coc_live_turn` is allowlisted (no unconstrained edit/write).
- If the model returns prose without the tool, stdout still has `ok: true` with a single `error` event (`kind=pi_missing_tool_use`).
