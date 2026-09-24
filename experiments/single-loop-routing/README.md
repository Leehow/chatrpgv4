# Single-loop step routing — prototype

**Status: prototype, 2026-09-23. Kept on purpose. The owner has lost prototypes before ("之前好几次原型做得好好的，后面实现的时候直接把原型给丢了"); when SL-01/SL-02 of the Pi single-loop refactor (`docs/PiPiCoC_Pi原生单循环重构设计_v1.0.md`) implement `policy.next`, they start from `loop.ts` here and keep `loop.test.mjs` green.**

## The ruling this prototype tests (owner, 2026-09-23, verbatim intent)

> 每一轮先给 Jev；Jev 在宿主列出的候选里选一个，候选后面固定带三个出口：问 LLM、再读材料、完成。这个选择本身就是下一步的路由。下一步已经被结构定死时（LLM 刚交出的工具调用要执行、检定参数已绑定要掷骰）不过 Jev，代码直接路由（direct）。缺省——下一步没被定死时——给 Jev。三道闸：同一问题同一候选同一材料不问第二次，第二次升级 LLM；LLM 回来后下一步永远是 direct 或完成，不回 Jev 复审；每个 Run 有 Jev 次数和时长预算，超了走 LLM 收尾。none_of_above 是合法答案，去向是 LLM。

One line: `next = determined(view) ? direct : jevRoute(candidates(view) ∪ {ask_llm, read_more, finish})`, with a confidence gate and the three guards.

## What the prototype learned (the rule as it stands after 20 replays)

1. **Read first, then route.** Routing on an empty material list left the declared move at 0.52–0.58; with the prescreen's material in front of Jev it is 0.76–0.81 every run. The first step of a run is the read (the product already does this before the Keeper's first request); a scene change queues another read before the next route.
2. **The route is a fan-out, not a pick-one.** A single "choose the next step" over 17 candidates spread 0.20 / 0.15 / 0.13 across three steps the live Keeper all took, because the *order* among them is craft, not a fact. One `need_N` question per candidate (`now` / `later` / `unknown`) plus one `exit` question (`continue` / `ask_llm` / `read_more` / `finish`) lets each need stand on its own; the host orders the selected ones structurally (person → contact check → ordinary check → reveal → move).
3. **Two gates, both recorded.** Absolute confidence (0.6) alone rejected right answers; a margin gate (top ≥ 0.35 and ≥ 1.8 × runner-up) is tried second. Every run records the full distribution so the gates can be re-read.
4. **Candidate hygiene is where the design lives or dies.** Every miss in the log was a candidate problem, never a Jev problem: 43 dormant rule decisions (combat, chase, sanity…) diluted a 52-way question to 0.53; an internal kernel tag (`authority: available_route_not_player_choice`) in a candidate's detail made every move "later" at 0.62–0.65 until it was removed; a move whose kernel gate is `met: false` must not be offered; a person already introduced must not be offered; the model's own applies must consume the host candidates they carried out.
5. **Jev routes the bookkeeping the player declared; it defers the Keeper's craft.** On the replayed turn Jev carried out the move (and would carry out the handout), and answered `ask_llm` at 0.74–0.89 for who appears at the morgue and what they demand. Whether the gatekeeper meets you, whether he wants a Persuade — the module never states it as a host-issuable fact, so the loop still needs the LLM for it. The saving on this turn is one LLM call (6 → 5). Turns whose declared action *is* the bookkeeping (a move, a reveal, a check the Mod already declared) save more; turns that are scene craft save nothing until the scene's demands are data.

## Files

| file | role |
| --- | --- |
| `loop.ts` | the policy (`next`, `interpretRoute`, `interpretBind`, gates, guards, precedence) and the driver (`runTurn`) over injected ports; pure except through ports |
| `loop.test.mjs` | stub-port tests of the policy: determined → direct without Jev; fan-out shape; structural order; low confidence → LLM; margin gate; `ask_llm`; repeated question → escalate; after LLM → direct/finish only; closed bind; budget exhausted |
| `candidates.ts` | re-exports the product's candidate builder (`runtime/jev/candidates.ts`, moved there at SL-02): host-issued candidates from real reads (`table.capsule`, `table.apply.options`, `table.resolve.options`, the session view, located entities); what each still needs (closed / open / the ordinary-check binder) |
| `product-entry.ts` | SL-02: one replay run against the **product driver** (a real Pi session on the vendored build with `PI_COC_LOOP_ENGINE=hybrid-v1`, the product's hybrid engine, the kernel extension over the emitted kernel); the Keeper's provider and the §32 lane replay the live table's recorded answers; Jev is live |
| `ports.ts` | real ports: Jev via the product's `DecisionPort`, the product's prescreen as the read step, the product's ordinary-check preflight as the closed binder, kernel RPC on a disposable copy |
| `run-entry.ts` | one replay run; `--llm replay` replays the live Keeper's recorded tool calls as the LLM step (a replay of the real model, not a stand-in Keeper), minus what the host already did |
| `run.mjs` | `--llm replay` runs `product-entry.ts` (SL-02); `--llm none` or `--driver prototype` esbuild-bundles `run-entry.ts` (the prototype's own driver) and runs it |
| `kernel.mjs` | JSON-RPC transport to `build/kernel/rpc.mjs` |
| `fixture.mjs`, `baseline.mjs` | build `fixtures/<name>/workspace.tar.gz` from the App's data (read-only), position it before the turn with the campaign's own sidecar git; extract the live Keeper's baseline from the session file. Fixtures: `turn3` (the haunting, turn 3) and `fight-round` (the "打斗测试" table, turn 6, "继续揍他", made at SL-02) |
| `gate-fixture.mjs` | SL-13: fixtures from a live gate's campaign (a `.coc` home the play driver wrote; read only), one per turn with a shared tarball (`turn.json`'s `tarball`), the recorded Keeper read from the play driver's RPC event log. Fixtures: `gate3-t1`, `gate3-t2`, `gate3-t3` (live gate #3, `gate3-haunting-2329`), `longgate-t19` (the long gate's stranded turn 19, `longgate-haunting-0624`; SL-23: each message's streamed prose and the calls the live wait refused are in its baseline, and the replay answers a stranded turn's composes with that prose) |
| `vault.mjs` | reads `EXT_JEV_APIKEY` from the App's encrypted secret vault into the child env; never prints it |
| `RESULTS-20260923.md` | the runs, step traces and misses |

## Run

```
npm run build:runtime                                   # once per worktree
node experiments/single-loop-routing/run.mjs --fixture turn3 --runs 3
node experiments/single-loop-routing/run.mjs --fixture turn3 --runs 3 --llm replay            # product driver (SL-02)
node experiments/single-loop-routing/run.mjs --fixture fight-round --runs 3 --llm replay --admission jev
node experiments/single-loop-routing/run.mjs --fixture turn3 --runs 3 --llm replay --driver prototype
node experiments/single-loop-routing/run.mjs --fixture gate3-t2 --runs 5 --llm replay --seed 1                  # SL-13: the compile (default)
node experiments/single-loop-routing/run.mjs --fixture gate3-t2 --runs 5 --llm replay --seed 1 --compile off    # SL-13 control: the SL-12 policy
node --test experiments/single-loop-routing/loop.test.mjs
# SL-11: the same product driver with the real Keeper model (the App's grok-build login, copied without its refresh
# token; the default model grok-build/grok-4.7-build-fast), a thinking level, and follow-on turns in one session:
node experiments/single-loop-routing/run.mjs --fixture turn3 --runs 3 --llm replay --keeper live --thinking low
node experiments/single-loop-routing/run.mjs --fixture <dir> --runs 3 --llm replay --keeper live --then "<next player input>"
```

Every product run's summary has `model_calls`: per Keeper call, the provider's own `input`, `cache_read`, `output` and
`reasoning` tokens, its seconds and time to response headers, the tools it called and the reasoning effort sent. A
`--fixture` given as a directory path reads a scratch fixture (its `baseline.json` is optional). With `--keeper live`
the admission lane answers an unrecorded review `authorized` (admission is SL-10's measurement, not this one's).

Needs the App signed in to Jev (the key is read from the profile's secret vault). Every run extracts the fixture into a temporary workspace, resets it to the pre-turn commit, opens the turn with the recorded player input, and removes the workspace afterwards. Nothing under Application Support is written.

## Boundaries

No LLM is called in the replay modes (they replay recorded calls); `--keeper live` calls the real Keeper model and is a measurement, never a table or a playtest. No hard-coded semantic lists: the exits are structural, candidates are host-issued, precedence ranks families the host already knows. Product code under `extensions/`, `runtime/`, `kernel-ts/` is imported, not modified.
