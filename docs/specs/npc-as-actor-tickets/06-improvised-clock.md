Status: ready-for-agent
Spec: docs/specs/npc-as-actor.md（D4）；契约 §30.9

# 06 — 临时的钟：`apply threat` 可铸运行时钟

「骚动引来邻居」「他跑去报警」这类由行动引出的后果，今天没有钟可走：`apply threat` 只认书上的 threat。

## Depends on

- 无。

## Scope

- `apply threat` 加 `mint: true` 变体：`{kind: "threat", name: "<新 threat 名>", clock: "<钟名>", segments: <总格数 2–8>, advance?: <本次走格，缺省 1>, on_full: "<满了意味着什么，一句>", why, intent_ref?}`。写 `world.threat_clocks[name][clock]` 与 `world.threat_defs[name]`（运行时定义：`{clocks: {<clock>: {segments, on_full, minted_turn, why}}}`），模组图不动（§30.9「count is runtime, never the graph」）。同名 threat 已在书上 → `invalid_params` 指向现有钟。
- 投影：`pressures.threat` 与 `pacing.threat_clocks` 把运行时钟与书上的钟并列，行带 `minted: true`；满格时 `on_full` 走现有的 `full` 回执。`on_tick_visible` 运行时钟没有，回执的 `shows` 为空，KP 自己写症状。
- 时间尊重：钟不自动走；`apply time` 不推它。与 §30.9 同。
- 契约：§30.9 加一小节。

## Not in scope

- 钟到满自动铸事件或人（满格只回 `on_full` 文本；有人到场走工单 07）。

## Acceptance

- `tests/kernel/test_minted_clock.py`：铸钟、走格、投影带 `minted`、满格回 `on_full`、同名书上 threat 拒绝；旧战役无 `threat_defs` 不受影响。
- 变异用例：删掉 `threat_defs` 写入，「下一回合投影里还有这口钟」必须红。
