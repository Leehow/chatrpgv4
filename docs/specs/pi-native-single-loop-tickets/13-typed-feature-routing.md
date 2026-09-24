Status: ready-for-agent
Stage: SL-13 (after SL-12; before SL-03)
Spec: docs/specs/pi-native-single-loop.md (Rulings: "Routing asks what the player does, never whether a candidate is due", "Parameters-only steps never go to the LLM", "Parameter binding never goes to the LLM")

# SL-13 — Typed-feature routing: one Jev compile per turn, predicates select the clerk's candidates

## Evidence (live gate #3, 0.9.5a `19965521e`, campaign `gate3-haunting-2329` under `chatrpgv4-wt-integ-sl/.coc/campaigns/`)

- Turn 1, "我接。先去《环球报》剪报室，翻科比特宅这些年的旧报道。": route s2 offered `apply:move:newspaper-morgue`; `need_2` = now 0.61 / later 0.37, confidence 0.42 < 0.6 → `low_confidence`, the whole turn went to the Keeper (5 model calls, 58.2 s). Gate #2's table scored the same sentence 0.93.
- Turn 2, "我说明来意，请他帮忙调出科比特宅这些年的旧剪报。": `resolve:obligation:globe-clippings-access` offered; the seeks question answered `not` 0.54 / seeks 0.31 / unknown 0.15 → `ask_llm`.
- Turn 3, "我回诺特办公室，揪住他的领子一拳打过去…": the move selected at 0.90 (the one success); the disposition bind `avoids_fighting` 0.67 of the mass, confidence 0.59 → `clerk_unbound`.
- The route rows with `offered`, `answers` and `probabilities` for every step are in that campaign's `telemetry.jsonl` (`lane: "route"`); the pre-turn states are its `turns/000{0,1,2}.json` and `world.json`.

## Scope

1. **A compile step.** After the read, before routing, one Jev `decide(compile)` reads the player's declaration into closed features. Each feature's options come from the read: destinations (scenes the capsule offers as moves), addressees (people present, by the table's label), asks (the open obligations' demands and the clue/handout names the scene offers), acts (the session's issued actions when a session is active; else a small closed set the kernel already knows: the resolve intents), targets (people present / fighters), items (carried). Every feature has `none` and `unclear`. The question text is built from rows, never from a hand-written list; a feature with no rows to offer is not asked.
2. **Predicates.** Code in the policy selects candidates from features and their rows: a move whose `to` equals the destination feature; an obligation candidate whose meeting person or demand equals the addressee/ask; an attack whose target equals the target feature; a disposition bind stays a bind (SL-12). A predicate fires only on a feature answer that clears the gate; otherwise the candidate falls through to the existing `need` question. The exit question stays.
3. **Budget.** One compile call per turn plus SL-12's binds; the compile replaces the first fan-out when it selects, so the Jev calls per turn do not go up. Record a `lane: "route"`, `purpose: "compile"` row with the features, their distributions and which predicates fired.
4. **Contract.** §135.30 in docs/kernel-rpc.md: the compile step, the feature families and where each family's options come from, the predicates, the telemetry row. Contract first, then code.
5. **Replay fixtures** built from the gate #3 campaign's three pre-turn states (the harness in `experiments/single-loop-routing` takes an RD-04 digest; the campaign directory is read-only evidence, copy what you need). Pre-register the expected selections before running.

## Not in scope

Changing the gates (0.6 + margin), the Keeper's prompt, or the candidate builders' rows. No embedding index, no lexical matching, no word lists.

## Acceptance

- Replays, 5 runs each, live Jev, recorded Keeper: turn 1 selects `apply:move:newspaper-morgue` ≥ 4/5; turn 2 selects `resolve:obligation:globe-clippings-access` ≥ 4/5 (its approach then binds by SL-12); turn 3 selects the move ≥ 4/5. The `turn3-obligations` and `fight-round` regressions unchanged or better (live rows, LLM steps).
- Policy tests with a stub decision port: a predicate never fires below the gate; a feature with no rows is not asked; a compile that selects skips the first fan-out; mutation-killable (predicate disabled, gate ignored, options invented).
- `npm run test:ext`, the loop suites, and pytest green on the branch and after merging 0.9.5a.

## Comments
