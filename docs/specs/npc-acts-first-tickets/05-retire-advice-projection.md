Status: landed（合入集成分支 claude/npc-as-actor-20260926 @ c4fbe7ade，2026-09-26；全量套件见 spec 第八节）
Spec: docs/specs/npc-acts-first.md（D5）

# 05 — 应对库与 advice 选择整体退役；投影

## Scope

- 每回合选择退役：`extensions/npc/index.ts` 的 `before_agent_start` 建议（:69–88）、`coc-npc-advice` 消息与其 `context` 过滤（:91）、`evaluateNpcResponses` 的每回合调用与 `no_suitable_candidate` 触发的重算（:173）；`runtime/jev/npc-responses.ts` 删除；`PI_COC_NPC_ADVICE_*` 环境变量删除并在契约记退役。
- 应对库退役：内核方法 `npc.responses.job` / `npc.responses.submit` 变回未知方法；`kernel-ts/npc/responses.ts` 里的作者 packet、`instruction`、`basis`、`stored`、`openResponseRows` / `bankRows`、§142.4 续期删除；`host-budgets.json` 删 `npc_responses`；`extensions/npc/index.ts` 的作者循环只剩 `kind: 'personality'`。`kernel-ts/npc/intents.ts` 里只服务于库的函数删除，`intentsView` / `foldIntent` / `owedIntents` 保留（§142 的账本不动）。
- 旧战役：`npc/responses/*.json` 不读、不删。
- 投影：胶囊 `present[].history.intents`（§142.2）带 `generated: true` 的行标 `by: table`；当回合收据里的 NPC 行动已可见（无新面板）。`director.offer` 的 `npc.intents` 行不改；§142.3 里「advice 车道的候选集」一句退役。
- 契约：§142.3、§142.4 各加带日期的退役注；§143 记理由（开集不枚举）。
- 遥测：`lane: npc` 的 `advice`/`finalized`/`responses` 行停发，`lane: npc-act` 接替。

## Not in scope

- 人格任务（`npc.job` / `personality`）；§142 的账本、闸门、写入面。

## Acceptance

- ext 用例：一桌开三回合，会话里不再出现 `coc-npc-advice` 消息；遥测无 `kind: advice` / `responses` 行；`npc.responses.job` 返回未知方法。
- 既有用例迁移：`npc-preparation-integration.test.mjs`、`npc-intents.test.mjs` 里依赖建议消息或库行的用例改为断言 `npc_act` 收据与账本；`test_npc_*.py` 里读库文件的用例删除。改了几个既有用例要在 handoff 报（记忆 `new-required-field-must-land-with-its-callers`）。
- 变异：把 `by: table` 的投影删掉，用例逮住。
