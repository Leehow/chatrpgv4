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
from runtime.sdk.api import (
    setup_workspace, create_session, interact, send, operate,
    get_state, close_session,
)

setup_workspace("/path/to/workspace", {
    "schema_version": 1,
    "kind": "campaign.quick_start",
    "payload": {
        "scenario_id": "the-haunting",
        "pregen_id": "thomas-hayes",
        "campaign_id": "live",
    },
})

sid = create_session(
    "/path/to/workspace", campaign_id="live", investigator_id="thomas-hayes"
)
result = interact(sid, "我打开抽屉。")
receipt = operate(sid, {
    "schema_version": 1,
    "kind": "magic.cast",
    "payload": {"spell": "Cloud Memory", "pushed": False,
                "interrupted": False, "is_npc": False},
})
state = get_state(sid)
close_session(sid)
```

- `create_session` returns a `session_id` string.
- `setup_workspace` is the canonical pre-session onboarding surface for both
  Pi and coding-plugin hosts. It also exposes `rules.inspect`,
  `campaign.render_briefing`, and `investigator.render_card`, so no host needs
  a separate renderer or discovery path.
- `interact` semantically dispatches natural language to an ordinary turn or
  a canonical typed operation. It never uses local keyword matching.
- `send` returns a list of Event dicts (`type`, `id`, `ts`, `visibility`, `payload`).
- `operate` executes an exact typed non-turn operation through the same
  `plugins/coc-keeper/scripts/coc_runtime_ops.py` gateway used by Codex,
  Cursor, and Claude plugin hosts.
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
