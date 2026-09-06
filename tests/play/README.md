# 真桌驾驭器 (live-play driver)

`driver.py` drives a real `bin/pi-coc --mode rpc` session so a human can play
Call of Cthulhu turn by turn against a real守秘人 model, with every event,
tool call, and timing kept as evidence. See `docs/kernel-rpc.md` section 10
for the contract and Pi's own protocol at
`node_modules/@earendil-works/pi-coding-agent/docs/rpc.md`.

This is a real-product playtest tool, not a batch-settle script: each `turn`
call is one real round trip to the keeper model. There is no shortcut that
fabricates turns or replays canned KP output.

## Playing a session

```bash
# 1. start the table (spawns a detached daemon that owns pi's stdin/stdout)
uv run --frozen python tests/play/driver.py start --campaign my-campaign-id

# 2. play, one round at a time -- each call blocks until the keeper delivers
#    (narrate/ask) or the turn times out
uv run --frozen python tests/play/driver.py turn "I check the front door."
uv run --frozen python tests/play/driver.py turn "I ask the librarian about the missing book."

# 3. end the session (aborts any in-flight turn, terminates pi and the daemon)
uv run --frozen python tests/play/driver.py stop
```

`--run <run_id>` on any subcommand pins it to a specific run; omitted, `turn`/
`stop`/`log`/`status` default to whichever run `start` most recently began.
`start` defaults `--run` itself to `<campaign>-<UTC timestamp>`.

## Switching the keeper model

```bash
uv run --frozen python tests/play/driver.py start --campaign my-campaign-id --model xai/grok-4.5
```

`--model` is `provider/modelId` and is sent via Pi's `set_model` command right
after startup, with the response checked for success before the run is
reported ready. Default is `xai/grok-4.5` per docs/kernel-rpc.md section 10.

## Where the evidence lands

Everything for a run lives under `.coc/playtests/<run_id>/`:

| file | what |
|---|---|
| `daemon.json` | run metadata: pids, launcher, model, and status (`starting`/`ready`/`failed`/`stopped`) |
| `heartbeat.json` | rewritten every ~2s: pid liveness, turn count |
| `driver.log` | the daemon's own diagnostic log -- read via `driver.py log` |
| `pi-stderr.log` | pi's stderr, verbatim |
| `events.jsonl` | every RPC line received from pi, one JSON object per line |
| `turn-<n>.json` | per-turn summary: player text, final keeper text, every tool call (name, args, truncated result, ms), wall time, `settle_class` |
| `final.json` | written by `stop`: turn count and totals |

A `turn`'s `settle_class` is one of `settled` (visible text delivered, exit 0),
`undelivered_with_tools` (tools ran but no visible text, exit 5),
`empty` (nothing happened, exit 4), or `timeout` (exit 3).

If the daemon dies, `status` and `stop` fall back to reading these files
directly instead of failing outright -- a dead driver should stay
diagnosable. `driver.py log --run <run_id> --tail 100` is the first thing to
check when a turn errors out.

## Other subcommands

```bash
uv run --frozen python tests/play/driver.py status --run <run_id>   # is the daemon/pi alive, turn count
uv run --frozen python tests/play/driver.py log --run <run_id> --tail 100
```

## Tests

```bash
PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest tests/play -q -p no:cacheprovider
```

Most tests run the driver against `tests/play/fixtures/fake_pi_rpc.py`, a
scripted stand-in for pi that needs no LLM or API key. One smoke test spawns
the real `node_modules/.bin/pi --mode rpc --no-session` to confirm the JSONL
framing assumptions against the real binary; it is skipped when
`node_modules` is absent.
