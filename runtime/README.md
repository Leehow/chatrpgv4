# COC Open Runtime

Headless agent interface for Call of Cthulhu play. Hosts send player input and
receive structured Events; campaign state lives under `.coc/`.

Brain selection is project-level only: `.coc/runtime.json` with
`"brain": "debug" | "pi"`. Missing config defaults to `debug`. The brain is
bound when you call `create_session`; changing `runtime.json` later does not
affect an open session (takes effect on the next `create_session`).

## Usage (no install required)

From the repository root (so `runtime/` is importable):

```python
from runtime.sdk.api import create_session, send, get_state, close_session

sid = create_session("/path/to/workspace", campaign_id="live", investigator_id="inv1")
events = send(sid, "我打开抽屉。")
state = get_state(sid)
close_session(sid)
```

- `create_session` returns a `session_id` string.
- `send` returns a list of Event dicts (`type`, `id`, `ts`, `visibility`, `payload`).
- `get_state` returns a player-safe PublicState snapshot.
- `close_session` ends the session; further `send` / `get_state` fail.

Default character path when omitted:
`workspace/.coc/investigators/<investigator_id>/character.json`.

Campaign directory:
`workspace/.coc/campaigns/<campaign_id>/`.

See `runtime/protocol/PROTOCOL.md` for the language-agnostic contract.

## Boundaries

- Content track stays in `plugins/coc-keeper/` — do not fork skills/rules into `runtime/`.
- No third-party web-search vendor bindings in runtime package metadata or adapters.
