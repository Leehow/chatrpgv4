# prototype — the instruction index over real capsules

The selector of `docs/specs/mod-section-index.md` §8, run against the capsules real turns actually produced.

- `index.json` — every section of the seven packages that contribute Keeper instructions (`docs/mods-catalogue.md`): resident or situational; a situational section's topics, gates and triggers. Text is cut from the shipped `mods/*/agent.md`.
- `select.mjs` — `select({capsule, player, settings})`: the topic lane (one Jev fan-out over the closed topic list in `../topics.json` plus `index.json`'s extras) and the closed gate/state list read from the capsule; returns the resident ids, the loaded sections with why, the host triggers the offline run cannot fire, and the bytes.
- `sandbox.sh` — a copy-on-write replay home for one App campaign (the App home is only read; refuses an existing home).
- `replay.mjs` — for each sampled turn: reset the sandbox's campaign repository to the commit of the turn before, `table.open`, `table.player_input` with the player's words, select over the capsule the kernel handed back; one kernel process per turn.
- `score.py` — the selection against the judges' rule labels, per section and overall; bytes per turn against today's briefs; which gates and topics did the loading.

```
node experiments/mod-section-index/prototype/replay.mjs --sample <sample.json> --homes <dir> --out <rows.jsonl>
python3 experiments/mod-section-index/prototype/score.py <judge dir> <rows.jsonl> experiments/mod-section-index/prototype/index.json
```
