# coc kernel

Python side of pi-coc v2. Contract: `docs/kernel-rpc.md` (authoritative).

Run from the worktree root:

```bash
PYTHONPATH=kernel uv run --frozen python -m coc.rpc --workspace . --content content
```

stdin takes one JSON request per line, stdout answers one JSON line per request,
stderr carries logs. Campaign state lives under `<workspace>/.coc/`; the content
directory is read-only. `COC_KERNEL_SEED=<seed>` seeds the dice (tests only).

Layout: `rpc.py` transport and dispatch; `table.py` the table.* methods and turn
state machine; `store.py` campaign files and idempotency; `module_graph.py` the
module graph index; `capsule.py` the turn capsule and look views; `rules/` coc7
tables, percentile check, skill resolution; `render.py` mechanics blocks;
`history.py` the sidecar git repo; `events.py` the event stream.

Tests: `PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest tests/kernel -q -p no:cacheprovider`.
