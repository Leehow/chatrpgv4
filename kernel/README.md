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
state machine; `resolve.py` the §11 resolve pipeline (facts, candidates, slots,
execution, result); `sessions.py` the thin session layer over the combat / chase /
sanity snapshots (the §11.9 `session` and `pending_choice` shapes, the family facts,
participant specs from sheets and NPC profiles); `store.py` campaign files and
idempotency; `module_graph.py` the module graph index; `capsule.py` the nine-section turn
capsule and look views; `director.py` the Director (graph loader, signals, three-layer
scoring, adoption — every number from `content/director/director-graph.json`);
`ontology.py` the system ontology registry (validated at `table.open`, `grounded-by` and
`may-emit-effect` at runtime); `craft.py` the text graph's craft face and the beat →
directive table (`content/craft/`); `pressures.py` the structural sources of
`pressures` / `obligations`; `rules/` coc7 tables, the RuleGraph runtime and the ported engines
(see its `__init__`); `render.py` mechanics blocks; `history.py` the sidecar git
repo; `events.py` the event stream. Engine snapshots live under `<campaign>/save/`
(`combat.json`, `chase.json`, `combat-operation.json`, `sanity-state/<inv>.json`,
`healing-state/`, `mp-state/`, `magic-state/`, `development-state/`,
`development-settlements/`, `psychology-observations.json`).

Tests: `PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest tests/kernel -q -p no:cacheprovider`.
