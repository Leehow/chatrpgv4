# Single-loop step routing (the §5 policy of the Pi-native single-loop refactor)

Status: **prototype** — see `docs/agents/triage-labels.md`. Prototype and results: `experiments/single-loop-routing/` (kept on purpose; implementation of SL-01/SL-02 starts from its `loop.ts` and keeps its `loop.test.mjs` green).

Design proposal this refines: `docs/PiPiCoC_Pi原生单循环重构设计_v1.0.md` (owner's file; §1, §4.3, §5, §6.2, §11.3). Baselines to correct there before SL-00: Pi is 0.87.0 (not 0.85.1); the product baseline is integration commit fc884d7ed (not 0.9.4a@86078fd); the TaskRuntime/S0 path is gated (`PI_COC_JEV_S0=1`, source mode only) and is not what the installed App runs; `docs/pi-host-contract.md` forbids patching or forking Pi and must be overturned explicitly.

## The rule (owner ruling, 2026-09-23)

`next = determined(view) ? direct : jevRoute(candidates(view) ∪ {ask_llm, read_more, finish})`

- **direct** when the next step is fixed by structure: the LLM's proposals after an `infer`, a bound operation after a `decide(bind)`, the read that follows a scene change, the first read of a run.
- **decide(route)** otherwise: one `need_N` question per host-issued candidate (`now` / `later` / `unknown`) and one `exit` question (`continue` / `ask_llm` / `read_more` / `finish`). Selected needs run in structural precedence (person → Mod contact check → ordinary check → reveal → move), then the loop routes again on the new state.
- **infer** when the exit says `ask_llm`, when nothing is selected under `continue`, on `none_of_above`, on low confidence, on a repeated question, on an exhausted Jev budget, and for `compose`.
- **Gates:** absolute confidence, then a margin gate on the reported distribution; both recorded per answer.
- **Guards:** (1) the same question over the same candidates, materials and settled receipts is never asked twice — the second time escalates to the LLM; (2) after an `infer` only `direct` or `finish` follows, never a Jev re-review; (3) a per-run Jev call/time budget hands the close to the LLM.
- **Candidates are host-issued from real state** (design §5.1): kernel `apply.options` (moves with `unlock_when.met`, scene clues), scene assets, people present and not yet introduced (staged under the capsule's own `untold.label`), the active Mods' pending contact checks, the ordinary check with its closed route/profile binder, specialised families only while the kernel reports their session active, located entities. Nothing classifies text; internal kernel tags are not shown to Jev.

## What the prototype established (turn 3 of the haunting table, 2026-09-23)

- Reading before routing is what makes the declared bookkeeping decidable (0.52–0.58 → 0.76–0.81 for the declared move).
- A fan-out route is required; a pick-one route cannot rank steps whose order is craft.
- Jev carries out what the player declared and defers scene craft (`ask_llm` 0.74–0.89 for who appears and what they demand). With the live Keeper's own proposals replayed as the LLM step, the loop reproduces the live turn (8/8 actions, 3/3 runs) with 5 LLM steps instead of 6.
- The saving scales with how much of a scene's demands are data. **Open for SL-02:** make gatekeeper checks, forced encounters and scene obligations host-issuable (Mod/Director declarations), so the route can select them as `now`.

## Acceptance for the implementation (adds to the design's §14.1)

- `loop.test.mjs` cases pass against the product `policy.next` (determined → direct without a Jev call; fan-out shape; structural order; low confidence, `none_of_above`, repeated question and budget → LLM; after LLM → direct/finish only; closed bind then direct).
- The turn-3 replay (`--llm replay`) reproduces the live actions with ≤ 5 LLM steps; a turn whose declared action is a move or a Mod-declared check completes with the compose call only.
- Every route answer's distribution is retained in telemetry (`lane: "route"`), as the prototype's traces are.
