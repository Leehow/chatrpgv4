Status: ready-for-human（三处拍板后转 ready-for-agent）
Spec: docs/specs/npc-acts-first.md（D5）

# 05 — advice 选择退役；应对库退为常备计划；投影

## Scope

- 退役：`extensions/npc/index.ts` 的 `before_agent_start` 建议（:69–88）、`coc-npc-advice` 消息与其 `context` 过滤（:91）、`evaluateNpcResponses` 的每回合调用与 `no_suitable_candidate` 触发的重算（:173）；`runtime/jev/npc-responses.ts` 保留为库函数或删除（按引用定）；`PI_COC_NPC_ADVICE_*` 环境变量删除并在契约记退役。
- 应对库作者（`kernel-ts/npc/responses.ts` 的 `npc.responses.job`）packet 加 01 的「刚发生在他身上的事」与状态段（不改 `basis`，重算条件不变），`instruction` 加一句：计划要包含他此刻处境下的打算，不只剧情条件。
- 投影：胶囊 `present[].history.intents`（§138.2）带 `generated: true` 的行标 `by: table`；当回合收据里的 NPC 行动已可见（无新面板）。`director.offer` 不改。
- 遥测：`lane: npc` 的 `advice`/`finalized` 行停发，`lane: npc-act` 接替。

## Not in scope

- 应对库的 §138.4 续期规则、`min_open_rows`。

## Acceptance

- ext 用例：一桌开三回合，会话里不再出现 `coc-npc-advice` 消息；遥测无 `kind: advice` 行。
- 既有用例迁移：`npc-preparation-integration.test.mjs` 里依赖建议消息的用例改为断言 `npc_act` 收据；数改了几个既有用例要在 handoff 报（记忆 `new-required-field-must-land-with-its-callers`）。
- 变异：把「刚发生的事」从作者 packet 去掉，对应用例（packet 含被打中的句子）逮住。
