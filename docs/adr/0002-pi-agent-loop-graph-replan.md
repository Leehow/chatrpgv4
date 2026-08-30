# 0002. 在 Pi 顺序工具批次加入 working-set replan

- Status: Accepted
- Date: 2026-08-30
- Track: `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`
- Upstream: [`earendil-works/pi`](https://github.com/earendil-works/pi)
- Packages: `@earendil-works/pi-agent-core@0.84.2`、
  `@earendil-works/pi-coding-agent@0.84.2`

## Context

Pi-Coc 的模型可见工具由当前 role、phase、stage、图谱 affordance、已加载
namespace/operation 及绑定后的 schema 共同投影。一个 canonical 工具完成后，
这个 working set 可能已经变化，但 Pi 0.84.2 仍会继续执行同一 assistant
message 中余下的旧工具调用。模型因此可能拿着旧的 scene/rules/finalize 参数继续
调用、猜测缺失 handle，或重复已经失效的推理。

`prepareNextTurn` 已经能在下一次 provider 请求前刷新 system prompt 与 tools；
缺少的是一个通用、协议完整的「当前顺序批次到此失效」信号。这个问题属于 agent
loop 的批次控制，而不是 RuleGraph、DirectorGraph 或 TextGraph 的业务规则。

## Decision

对锁定发布包维护两个版本化 patch：

- `@earendil-works+pi-agent-core+0.84.2.patch`：在
  `AgentToolResult` / `AfterToolCallResult` 增加可选 `replan?: boolean`。顺序批次
  中，完成工具返回该信号后，余下调用不执行；loop 为每个余下 assistant
  tool call 生成一个 `status=not_executed, reason=replan_requested` 的正常
  `toolResult` message pair，然后继续下一模型轮。它不是 agent terminate，原有
  `prepareNextTurn` 仍负责刷新 context/model/tools。
- `@earendil-works+pi-coding-agent+0.84.2.patch`：把 extension
  `tool_result` handler 返回的 `replan` 经过 ExtensionRunner 与 AgentSession
  `afterToolCall` 原样传给 core；现有 provider message transform patch 保持不变。

并行批次不承诺撤回已经启动的工具。任何可能改变模型 working set 的 Pi-Coc
工具必须声明 `executionMode: "sequential"`：动态 discovery、兼容/领域 gateway，
以及 canonical policy 中非 `parallel_read` 的 typed operation。稳定的
`parallel_read` typed operation 保持并行；纯 capabilities read 不因本决策变成
顺序工具。

Pi-Coc 不按工具名或业务关键字猜测 replan。主 extension 在
`tool_execution_start` 捕获当时模型可见的 active-tool interface（name、
description、parameters、promptGuidelines）的 host-only revision，并在
`tool_result` 与完成后的同一 interface 比较。只有 revision 真实变化才返回
`{ replan: true }`；稳定只读结果不触发。算术、状态持久化和图谱语义仍由原有
canonical 模块拥有。

## Protocol invariants

- 一个 assistant tool call 恰有一个 provider-visible tool result；被 replan
  延后的调用也不成为 orphan。
- 未执行调用只发 tool-result `message_start` / `message_end`，不伪造
  `tool_execution_start`。
- replan 不设置 `terminate`，不跳过 `turn_end`、`prepareNextTurn` 或下一次
  provider request。
- `replan` 是通用 host-control hint；core 不认识 COC、图谱类型、stage 或工具名。
- parallel 模式中已经启动的调用照常完成；可能 replan 的工具只能放在
  sequential 批次。

## Upgrade and replay

依赖升级必须从干净安装重放，而不是直接编辑或提交 `node_modules`：

```bash
cd runtime/adapters/keeper
npm ci
# 在新版本实际发布包上重放/调整补丁并运行测试；确认后：
npx patch-package @earendil-works/pi-agent-core
npx patch-package @earendil-works/pi-coding-agent
```

`tests/test_pi_package.py::test_pi_agent_loop_graph_replan_patch_contract`
把 package/lock 中的 exact version、版本化 core patch 和运行行为绑定在一起。
因此只改依赖版本、漏带 patch、patch 无法应用或行为被上游改写都会红灯，不能
静默丢失。升级步骤是：

1. 在独立 worktree 修改 exact package/lock version 并执行 `npm ci`；patch
   冲突必须显式解决。
2. 查看新上游 `agent-loop`、tool-result types、ExtensionRunner、AgentSession；
   确认其事件顺序与 sequential/parallel 语义。
3. 若上游已有等价能力，删除本地对应 hunks，但保留 contract/behavior test，
   直到测试证明上游实现满足本 ADR 的全部 invariants。
4. 若上游没有等价能力，在新版本重新生成两个带新版本号的 patch；删除旧 patch
   只发生在新 patch 和完整验证已经提交之后。
5. 运行 `npm ci`、core replan probe、Pi-Coc working-set tests、既有 provider /
   tool-result transform probes和 plugin metadata。

判断「上游已吸收」不能只看字段同名：必须同时满足顺序批次截断、所有余下调用
协议配对、下一模型轮继续且能看到刷新后的 context/tools、parallel 限制可见、
extension hint 端到端传递。

## Non-goals

- 不在 Pi core 中加入 RuleGraph、DirectorGraph、TextGraph、COC stage 或固定 KP
  流水线。
- 不改变规则算术、state transaction、finalization 权威或导演语义。
- 不取消、回滚或假装撤回 parallel 模式中已经开始的副作用。
- 不把任意工具结果都标成 replan；只有模型可见 working set 真实变化才触发。
- 不在本切片构建新的 durability/persistence 层。

## Follow-up: durable tool-result adoption

下一阶段可设计「durable tool-result adoption」接口：当 canonical 工具已产生持久
收据、但 host/provider 在结果进入 transcript 前中断时，由恢复流程采用该收据，
而不是让模型重跑工具。启动该设计必须有真实触发证据（例如已确认的写入后断流、
重复副作用或无法恢复的 orphan result），并明确 receipt identity、adoption
authority、idempotency 与 transcript pairing。它不是本次 replan 批次控制的一部分。

## Consequences

- 图谱/阶段变化后，模型在下一轮重新读取小而新的工具接口，旧批次不会继续扩大
  错误路径或重复推理。
- 稳定读取保持原有并行能力；replan 成本只出现在实际 working-set 变化上。
- 本地 patch 是显式维护负担，但 exact-version contract 和 ADR 使 Pi 升级时能够
  fail closed，并提供可重复的重放/上游吸收流程。
