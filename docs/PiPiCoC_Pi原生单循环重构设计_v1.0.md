# PiPiCoC：Pi 原生单循环重构设计

**版本：1.0 · 日期：2026-09-22 · 状态：设计提案，尚未实施或性能验收**  
**产品基线：** `Leehow/chatrpgv4@86078fdded13b6f83beeb164d0c94b3e7e6433f3`，本次讨论固定的 `0.9.4a` 提交。  
**Pi 基线：** `earendil-works/pi@v0.85.1`；本对话已核对其 tag 指向提交 `d981de1229ef899957bbe968bc8dcda02a21f477`。产品打包依赖也声明 Pi `0.85.1`。[C01][C02]

> **目标不是在 Pi 外部增加一个更快的编排器，而是直接改造 Pi 的执行循环：Jev 判断、LLM 推理、工具操作、审查、等待与交付由同一个驱动器推进。LLM 请求不再是每次迭代的必经入口。**

本文依据指定提交的源码和本对话已经读取的代码段制定。现状描述与新增设计分开标明；文中的新类型、目录和事件名均为拟议接口，不代表 Pi 或产品当前已有 API。没有修改、提交或推送仓库，没有启动实际 App，没有调用付费模型进行跑团或性能测量。既有交接记录中的测试结果属于原记录，并非本次复验。[C20]

---

## 1. 重构决策

### 1.1 必须达到的结构

每个前台玩家输入只允许一个具有推进权限的 `RunDriver`。该驱动器就是改造后的 Pi 内循环，不是 `runtime/` 下包裹 Pi 的新 agent。

```text
玩家输入 / 事件
       ↓
同一个运行上下文与工作集
       ↓
Pi RunDriver：选取下一步骤
       ├─ 已确定的本地推进
       ├─ Jev：有限候选中的语义判断
       ├─ LLM：高级理解、裁量、参数生成或文字
       ├─ 操作：读取、校验、结算、交付
       └─ 等待 / 结束
       ↓
记录实际结果、更新当前状态
       └────────────────→ 同一个 RunDriver
```

不规定每轮必须“先 Jev → 再规划 → 再执行 → 再写作”。这是可跳过、可返回的步骤集合，不是固定流水线。某轮可以直接写作；某轮需要多次高级推理；已经确定的后续步骤可以不调用任何语义模型。

### 1.2 明确排除的实现

以下实现不算完成本次重构：

- 在 `StreamFn` 中伪造 Jev 生成的 assistant/tool-call 消息。
- 在 Pi hook 中 `await TaskRuntime.submit()`，让原有第二套循环继续运行。
- 把 `submit_plan_packet` 改一个名字，但仍由模型先启动宿主循环。
- 在工具内部重新创建 AgentSession、调用 `agent.prompt/continue` 或启动同目标的子 agent。
- 遇到 Jev 不确定时，切回旧的完整 ReAct 循环跑到结束。
- 只合并文件、类或 while 语句，却保留两个独立的运行状态所有者。

普通遍历、有限网络重试、worker 事件循环不是这里禁止的“第二套 agent loop”。禁止的是：另一个组件自行反复作语义决策、执行行动并决定同一玩家目标何时结束。

### 1.3 非目标

不改写 CoC 规则内核，不改变游戏时间、世界线、收据和 Mod 锁定语义；不在本次核心切换中更换数据库；不凭速度目标删除行动授权或交付审查；不把所有场景预编译成固定剧情分类树；不要求每轮只有一次 LLM。

现有 setup/preparation 与已提交记忆整理拥有不同生命周期。它们可以作为独立根任务使用同一个驱动实现，但不能成为当前玩家回合的外层控制者；不能借独立后台身份继承前台玩家的行动许可。

---

## 2. 代码现状与真正需要拆除的循环

### 2.1 Pi 的模型优先循环

`packages/agent/src/agent-loop.ts` 的 `runLoop()` 在正常迭代中先执行 `streamAssistantResponse()`，再提取 toolCall 并执行。继续与停止围绕工具调用、steering 和 follow-up 队列组织。`prepareNextTurn` 可以更新上下文、模型与思考等级，但它不是非模型步骤调度协议。[C03]

### 2.2 产品的 TaskRuntime

`runtime/jev/task-host-session.ts` 在 `before_agent_start` 绑定输入与任务；注册的 `submit_plan_packet` 调用 `runtime.submit()`，等待完整结果，然后把观察投影交给 Keeper。[C04]

`runtime/jev/task-runtime.ts` 已拆出 `TaskDomain.next(view)` 与 `TaskRuntime.#run()`。前者负责根据现有材料提出下一步，后者负责决策、操作、检查点、等待、重规划和完成。[C05]

**迁移方向：保留 domain 的知识与策略，取消它旁边独立运行的 #run；把通用推进能力放进 Pi。**

### 2.3 容易遗漏的第三层：AgentSession 的继续循环

Pi `agent-session.ts` 的 `_runAgentPrompt()` 实际执行：

```text
await agent.prompt(messages)
while (await _handlePostAgentRun())
    await agent.continue()
```

`_handlePostAgentRun()` 处理重试、压缩以及结束事件后排入的消息。因此，只改 agent-core 的循环而完全不动 AgentSession，仍可能在会话层重新启动推进过程。[C06]

### 2.4 工具内部也存在递归运行

`source-owner-operations.ts` 中 `source.consult` 先 `runtime.begin({parentId: ...})`，再 `await runtime.submit(childId, ...)`。`memory-read-owner.ts` 中 `memory.search` 也采用相同方式。[C07][C08]

这些必须改成显式的子作用域和续接状态。不能把原有递归运行藏进 `executeOperation()`，否则单循环只是表面成立。

### 2.5 有价值且应保全的地基

`canonical-operation-dispatcher.ts` 已经保留能力检查、工具参数校验、真实扩展钩子、原始操作身份、实际结算查询和恢复；不伪造 Pi 回合。[C09]

`task-context.ts` 已经定义 lease、父子预算限制、readSet、取消、源发布推进与恢复授权。子任务不能扩张 capability，已提交记忆必须是独立根。[C10]

`task-store.ts` 提供 revision 检查、锁与原子持久化；`writer-budget.ts` 保留最终 writer 预算。[C11][C12]

本次删除的是重复调度，不是这些保障。

---

## 3. 三个边界：核心、会话、领域

### 3.1 Pi agent-core：唯一 RunDriver

负责步骤选择调用、步骤身份、事件顺序、取消、就绪工作调度、等待与完成。它不知道 CoC 的 `sanity`、`worldline`、PDF 页码或 TypeSafe 的认证方式。

核心只认识通用的决策请求、推理请求、操作请求、作用域切换和完成证据。Jev 被注入为决策后端，但它的使用发生在核心驱动的步骤之中。

### 3.2 Pi coding-agent：会话和工具环境

负责把 SDK 配置传给 agent-core，提供真实 provider、auth、工具注册表、扩展钩子、会话存档与 RPC 事件适配。现有 `createAgentSessionFromServices → createAgentSession` 逐项传参，需要贯通新选项，不能只在最外层增加配置字段。[C13]

会话层不再以“Run 已结束，再 continue 一次”的方式控制 hybrid run。重试与压缩的策略可以复用，但推进权限必须回到 RunDriver。

### 3.3 PiPiCoC：领域策略与权威服务

负责根据真实玩家输入、规则/模组材料、当前内核状态和实际观察构造候选，提出 Jev 问题，解释结果，提供行动授权与交付策略。

注册接口应是“给定状态，产生一个步骤请求”，而不是“给我目标，我自己跑完整个任务”。`TaskDomain.next` 中已经存在的知识应优先迁移，不重新发明全部规则。

---

## 4. 通用运行契约

以下为拟议接口轮廓。具体领域载荷由协议化适配器定义，Pi core 不直接依赖 `runtime/jev/contracts.ts`。

```ts
type StepRequest =
  | { kind: "decide"; batchRef: string }
  | { kind: "infer"; requestRef: string }
  | { kind: "operate"; proposalRefs: readonly string[] }
  | { kind: "scope"; transitionRef: string }
  | { kind: "wait"; conditionRef: string }
  | { kind: "finish"; outcomeRef: string };

interface RunPolicy {
  // 纯策略：不能在这里访问网络、写世界状态或再次运行 agent。
  next(view: Readonly<RunView>): StepRequest;
}

interface RunView {
  readonly runId: string;
  readonly inputRevision: string;
  readonly activeScopeId: string;
  readonly stateVersion: number;
  readonly observations: readonly ObservationView[];
  readonly pendingRequirements: readonly string[];
  readonly delivery: "none" | "draft" | "reviewed" | "accepted";
}

interface ObservationView {
  readonly id: string;
  readonly producerStepId: string;
  readonly status: "ok" | "refused" | "unavailable" | "stale";
  readonly artifactRef: string;
}
```

上述轮廓省略了载荷注册：新问题或推理需求先由领域纯函数返回不可变规格，再由 RunDriver 校验并注册为引用；`policy.next()` 不需要为创建引用而进行 I/O。`*Ref` 不是任意字符串权限。必须由运行时签发并解析为带 scope、revision、capability、来源和版本的对象。未知引用、旧版本引用和越权引用直接拒绝；引用正文在实际 provider 请求前必须物化。

### 4.1 Step 与 provider attempt 分开

`stepId` 是一次逻辑步骤；`requestAttemptId` 是该步骤中的一次 provider 请求。重试可以产生新 attempt，但不能因此产生新的游戏行动或新的骰子结算身份。

`origin = policy | model | user-command` 仅用于追踪来源，不表示获得权限。Jev 选中动作与 LLM 提出动作经过同样的授权和执行边界。

### 4.2 Plan 不再是运行入口

将计划从必填的 `PlanSubmission` 改为可选的 `PlanArtifact`。没有计划时，Run 仍然拥有原始输入、scope、许可能力、上下文与缺口。domain 可以先选择阅读或提问，也可以在需要时申请一次 LLM 规划。

对已有 `view.plan.goal/evidenceRequired` 的迁移不能简单填一份空计划。先拆为必有的 `IntentBinding`、可选的 `Requirements` 与可选 `PlanArtifact`；需要高级分解的 domain 返回 `infer`。计划中的权限要求只能被宿主缩小、不能扩大。

### 4.3 单循环驱动伪代码

```text
接受一个输入，建立 Run 和权威绑定

当 Run 尚未终止：
    消费已到达的事件、输入变更和取消
    检查当前所有权、预算和失效边界
    policy.next(currentView) 产生一个 StepRequest
    运行时校验请求并生成稳定 stepId
    保存必须先持久化的执行意图/预算

    decide  → 进行一次受限语义判断，记录真实结果
    infer   → 进行一次真实模型响应，记录产物和工具提案
    operate → 推进一步操作状态；需要审查时挂起并排入审查步骤
    scope   → 切换逻辑子作用域，不递归调用 RunDriver
    wait    → 持久化条件并让出控制，不轮询模型
    finish  → 检查完成证据，关闭或报告失败

    合并步骤结果，保存必要的收据/检查点
    回到同一个循环
```

该伪代码不是生产实现。实现仍需处理崩溃、重试、存储异常、流中断和接收顺序；下文规定这些行为。

---

## 5. Jev 如何真正接管局部选择

### 5.1 从实际状态产生候选

候选来自真实工具定义、内核签发选项、有效图谱条目、已物化来源、当前操作阶段和待决状态。候选应至少包括：语义描述、目标操作或推理需求、已绑定参数、未解决参数、readSet、能力与风险类别。

不基于中文关键词硬编码“出现攻击就进战斗”；但根据已验证的协议枚举、收据状态或明确待决类型走代码分支是合法的确定性推进。

必须有 `unknown / need_reasoning / need_evidence / none_of_above` 等适当出口。它们表示不同缺口，不应全部映射成“问玩家”。同一输入涉及多个规则时，问题结构必须允许多个需求同时成立。

TypeSafe 的 Choice 是有限集合选择；可批量提出同状态下的多个问题。本方案只依赖这一能力，不假定 Jev 可以任意生成参数、自由文本或读取未提供的工具结果。[V01][V02]

### 5.2 高级问题仍留在同一循环

当候选不覆盖玩家行动、缺失参数需要生成、语境冲突、NPC 裁量复杂或动作涉及未支持家族时，`next` 返回 `infer`。该步骤的产物进入当前 Run，随后仍由当前 RunDriver 校验与执行。

原有 `handoff.verbs` 不再表示移交给另一个执行循环。它变成当前推理请求的受限 proposal allowlist。LLM 可以提出所需特殊规则操作，但不能绕过原有规则 owner。

### 5.3 原有 domain 的具体变换

| 原 TaskStep | 新结构 |
|---|---|
| `decision` / `decisions` | 一个或一组独立 `decide` 工作项，仍由核心驱动 |
| `operation` | 统一操作提案；叶子操作直接执行，组合操作拆成续接阶段 |
| `replan` | 当前 Run 的一次 `infer(purpose=plan/adjudicate)` |
| `handoff` | 同一 Run 的受限 LLM 提案生成，不启动旧 ReAct |
| `finish complete/partial` | 子领域完成，不自动等同整个玩家回合结束 |
| `needs_player` | 准备真实 ask 交付，接受后进入等待 |
| `wait` | 明确的来源/服务/玩家等待条件与唤醒事件 |

普通检定已经读取 profiles 后才进行 route 和 profile 两阶段判断。[C14] 可以尝试选择 `actor + profile` 组合候选，合并独立问题；候选空间过大时保持原分段。不能在尚未掷骰时并行决定依赖结果的后果。

---

## 6. LLM 是原生步骤，不是子 agent

### 6.1 一次 infer 只完成一次模型响应

拟议的推理目的包括 `plan`、`adjudicate`、`bind`、`compose`、`review`、`compact`。这些是运行标记，不要求新建六个人格或六个长上下文。

调用既有真实 provider 流式接口，复用模型注册、认证、请求改写、usage、响应错误与取消语义。不能用一个快捷 `complete()` 路径绕开 Keeper 原有的 provider hook 或账户配置；零工具 lane 原有运行基础可按其现有用途复用。[C15]

一份高级推理结果可以包含开放问题、候选行动、约束和后续材料需求。它不是事实写入许可。

### 6.2 真正的模型 tool call 如何处理

真实 LLM 响应产生的 tool call 仍保留原 provider、message 与 call ID。模型响应完成后，由同一驱动器将它交给公共执行管线；执行结果仍与该真实调用配对。`infer` 分支只记录模型响应及 pending calls，不再在其内部自动跑完 `executeToolCalls()`；后续工具步骤由 RunDriver 逐一或按安全批次调度。在真实模型调用尚未取得实际结果或明确的拒绝/取消结果之前，不发起会打断调用—结果配对的新 provider 请求。

已经完整且合法的提案不需要再让 Jev机械地批准一次。Jev 的价值是省去不必要的生成式判断，而不是在每个动作前再增加一次服务请求。

模型停止原因只描述本次响应。`stop` 或“没有 tool call”不直接证明玩家目标完成。`length` 截断的调用仍不得执行；错误或 aborted 响应不得产生新的世界动作。[C03]

### 6.3 不通过模型消息冒充 Jev 决策

Jev 决策保存为内部 decision artifact，不填造 assistant message，不伪装 token usage。宿主操作的结果是 host observation，不生成孤立的 provider toolResult。

需要向下一次 LLM 提供宿主观察时，通过 provider 合法的上下文投影表达“宿主已验证观察”。若某 provider 需要 user-role 承载上下文，应在 system 契约中标明其非玩家指令身份；行动授权始终读取真实 `IntentBinding.rawInput`，绝不从投影消息重建玩家同意。

provider 的真实 assistant/tool-call/tool-result 配对作为不可拆单元保留，压缩与投影不得打断。消息末角色约束不满足时，以真实宿主事件物化合法上下文，而不是捏造用户发言或模型调用。

---

## 7. 操作执行、审查与交付

### 7.1 单一操作入口

把 `canonical-operation-dispatcher` 的能力搬到正式的操作执行服务，供 model-origin 和 policy-origin 两种提案共同使用。不是旁路调用 kernel，也不是同时执行一次 Pi 工具包装器和一次 dispatcher。

每个操作必须只经过一次：

```text
能力与作用域检查
→ 参数绑定/验证
→ 原有 action admission
→ 已启用的 Mod/规则准备
→ 持久化精确请求身份
→ 内核执行
→ 收据/来源发布推进
→ 结果钩子与观察记录
```

上面是逻辑职责顺序；落地必须保持当前 owner 对具体钩子顺序的要求。提案改变后，旧的授权证据、来源绑定及准备结果不得被无条件复用。

### 7.2 去掉对“最近 assistant”作为动作身份的隐含依赖

当前 task adapter 的 `keeper()` 检查最近 assistant 与配置模型。[C04] policy-origin 操作可能发生在本轮第一条 assistant 消息之前，因此新路径必须接受显式的 `InvocationContext`：run/step、origin、inputRevision、scope、proposal 与模型产物引用（仅 model-origin 必需）。

这不是降低校验。模型来源仍验证真实 message；非模型来源验证真实 policy/decision 与当前 lease；两者最终都验证玩家授权。

### 7.3 授权审查可以更换后端，但不能被选择动作替代

目前 `reviewAdmission()` 使用 `runLane()`；ordinary-resolve 自己的 Jev consent 问题并不取代独立 admission。[C14][C16]

第一阶段保留原审查语义，只将其调用纳入同一 Run 的 review 步骤。待独立对照测试完成，再考虑让 Jev 作为 admission 判断后端。必须保持公开上下文、原始玩家输入、实际提案与现有 verdict 语义，不能把 `consent=authorized` 直接当免检凭证。

### 7.4 审查需要调用模型时，操作返回挂起状态

操作执行服务应支持 `completed`、`suspended`、`refused`、`settlement_unknown` 等结果。需要外部审查时，它返回带 proposalDigest 和执行阶段的 continuation，把 review 请求排入当前 Run；不在工具内部运行另一个 agent。

review 完成后，重新验证绑定，再续接原操作。continuation 是私有执行状态，不是可由模型生成的权限凭据。

### 7.5 保留真实 narrate / ask

第一阶段继续由真实 Keeper LLM 生成原有 `narrate/ask` 调用，沿既有审查与正式提交链交付。不让 Jev 写正文，也不让宿主直接绕过“delivery requires writer message”。[C09]

`finish` 必须有相应交付证据：narrate 的正式 commit，或 ask 的真实 pending-choice 标识。证据齐备但尚未叙述只是“可写作”，不是“已完成”。ask 获得正式接收后，当前输入的 Run 以 `awaiting_player` 结案，保留 pending-choice 引用；下一次玩家答复建立新的输入绑定与 Run，再消费内核中的待决选择，不复活旧输入的行动许可。尚未交付的来源/服务等待则可以持久化为同一 Run 的 suspended 状态。

正文不能偷偷新增未结算的移动、资源变化或重要因果结果。需要此类变化时返回当前 Run 的操作/裁量步骤；已经结算的结果即使后续服务失败仍然是真的。

### 7.6 流式界面

内部规划、Jev 问题、秘密材料和未审查草稿不能因新增事件而出现在玩家 UI。保留原有草稿/正式交付边界；不能为了漂亮的首字延迟提前发布未获准剧情。

指标区分运行状态首事件、模型首 token、可供玩家阅读的有效正文首字与正式提交完成。只有后两项用于证明实际跑团体验提速。

---

## 8. 子任务改成显式作用域帧

### 8.1 逻辑分解不是第二个循环

一次来源查询或记忆检索可以拥有单独的逻辑 `ScopeFrame`，记录更窄的 capability、输入依据、domain 状态、观察与完成条件。但 frame 不持有自己的 while、AgentSession 或 RunDriver。

```text
frame: player-turn
    next → 需要 source consultation

RunDriver 压入 frame: source-query
    decide / source.text / source.excerpts ...
    frame 完成 → 返回来源证据

RunDriver 回到 frame: player-turn
    继续原目标
```

scope 切换应通过事件与可序列化 continuation 完成，不依赖 JavaScript 调用栈。暂停、重启后仍能恢复当前 frame。

### 8.2 当前必须替换的递归点

`source.consult` 与 `memory.search` 不再调用 `runtime.begin/submit`。它们转换成 scope 请求；原有 `source.binding/text/cache/excerpts`、`memory.snapshot/page/original/finish` 等原子 owner 操作继续使用。[C07][C08]

内存中的 filters、catalog、source snapshots 等恢复所需状态必须纳入 frame 的可重建依据。不能只把 parentId 改名，而继续依赖重启后消失的 Map。

### 8.3 reader、Mod 子进程的边界

`runtime/tasks.ts` 的 `runTask()` 仍会进入 `runReader()`，来源工具也会启动 source worker。[C17] 实施时必须盘点哪些子进程只是解析/校验，哪些实际包含多轮模型—工具决策。

纯解析 worker 可以保留。当前回合内承担决策的 reader/Mod 流程需要拆为同一 Run 的作用域和原子 provider/tool 步骤；不能以“它是一个外部工具”为由宣布嵌套循环已经消失。

本文已确认 `runTask → runReader` 调用边界，但未逐段审阅全部 reader 与 Mod 内部路径。因此这里是切换前的明确盘点任务，不是现有所有子进程都已经可以直接替换的承诺。

### 8.4 独立后台根

已提交回合的记忆整理继续以 committed source 创建独立根，复用同一个驱动实现。取消当前玩家回合不会倒销已提交记忆；关闭会话或独立根自身取消按其 owner 协议持久化 backlog。后台不拥有 `resolve/apply/narrate/ask` 的前台行动许可。[C10]

“单循环”指每个目标一个控制权，不要求整个应用只能有一个异步任务或只能使用一个进程。

---

## 9. AgentSession、事件与恢复集成

### 9.1 不只修改 agent-loop.ts

| Pi 源码位置 | 拟议修改 |
|---|---|
| `packages/agent/src/types.ts` | 增加通用 Step、Run 状态、运行事件、policy/execution ports |
| `packages/agent/src/agent-loop.ts` | 把固定模型入口改为单一步骤驱动，停止由显式终态决定 |
| `packages/agent/src/agent.ts` | 贯通新配置、统一 busy/cancel/队列、保存 Run 身份 |
| `packages/coding-agent/src/core/sdk.ts` | 注入策略与执行服务，继续复用 provider/auth/工具环境 |
| `packages/coding-agent/src/core/agent-session-services.ts` | 将新配置透传到实际 AgentSession 创建过程 |
| `packages/coding-agent/src/core/agent-session.ts` | 修改 provider refresh、事件、状态与 hybrid retry/compaction 入口 |
| RPC / session persistence / UI 事件消费者 | 兼容新增 run/step 事件，不伪造旧 message 类型；具体消费者实现切换前逐项审计 |

以上前六个位置已通过本次及前序源码阅读确认。[C03][C06][C13][C18] RPC 与 UI 消费者不宣称已全树审计。

### 9.2 消息事件与步骤事件分开

新增 `run_start/run_end`、`step_start/step_end`、`scope_enter/scope_exit`、`operation_prepared/settled`、`delivery_accepted` 等拟议事件；全部带 runId、stepId、sequence、scopeId、origin、visibility、schemaVersion。

原 `message_*` 仅表示真实模型/会话消息，不能拿来代表 Jev。原 `turn_start/end` 保留模型轮次含义，不能突然变成每个内部步骤；依赖其完成预算结算、上下文刷新或恢复思考等级的消费者逐个迁移。

Pi 目前在 `message_end` 持久化消息，在 `turn_end` 刷入延后的 custom message，并基于 assistant 消息维护 retry 状态。[C19] 新事件必须由 AgentSession 明确处理，不能仅从核心发出后假设上层会自动正确。

### 9.3 busy 不等于正在生成 token

Jev 判断、工具执行、source scope 和审查时，前台 Run 仍 busy。输入排队、abort 和模型切换不能只看有没有 streamingMessage。新状态明确分开 `runActive`、`providerStreaming`、`waiting` 与 `settled`。

### 9.4 重试与压缩归入同一驱动

hybrid 路径中 `_runAgentPrompt()` 只能等待一次 RunDriver 运行，不再调用 post-run 的 `agent.continue()` 循环。[C06]

网络重试沿用原重试分类，但变成同一步骤的 request attempt；上下文溢出转为同一 Run 的 compaction 步骤，然后重试原推理步骤，不重跑已完成工具。主动取消不是可自动重试错误。

默认非 hybrid 行为在兼容阶段由同一驱动中的 legacy policy 表达，或隔离为不参与 pipicoc 前台的对照入口；不能在一个运行中的 hybrid Run 临时启动 legacy engine。

### 9.5 输入变化与世界变化

新输入到达时先撤销旧 Run 的执行权限并发出取消信号，再等待必要持久化；不要先等存储完成才取消。旧结果可以保存为审计与结算证据，但不得驱动新输入的行动或交付。

模型更换、世界线切换、loop 改变、源文件更新分别使相应判断/提案失效。输入相同的文本不等于同一个授权；inputRevision 必须与新的 turn、scope 和 Run 身份共同绑定。

---

## 10. 状态、检查点与副作用恢复

### 10.1 只有一个运行状态所有者

RunDriver 负责运行状态；规则内核负责世界状态。两者不能合并成“模型决策就是世界事件”。

拟议 Run 状态包含：真实输入绑定、活动 frame、步骤队列、观察引用、可选计划、预算账本、执行中的原始操作身份、实际收据、等待条件与交付状态。原 `attempt/runtime.phase/lastCompletedTurn` 中重复表达推进位置的部分归并，不维护两份可冲突的真相。

### 10.2 继续复用现有恢复语义

操作发出前保存 proposal、call ID、精确 request 和读集；响应丢失时先查询原操作的权威状态。查询为 settled 就吸收原收据；为 absent 且仍有当前许可才重试；无法确认则标记 `settlement_unknown` 并等待核对，不能生成新 ID 再做一遍。

这提供的是在现有内核协议范围内的幂等结算，不宣称任意外部服务都能获得全局 exactly-once。

该原则与总册中“传输失败不等于未发生”及跨文件事务边界一致；总册是保全要求参考，不是 0.9.4a 当前实现的替代证据。[P01]

### 10.3 持久化迁移顺序

先把旧 TaskStore 作为新的 RunStore 适配后端使用，保证检查点、revision 和锁语义不变。单循环功能稳定后，再独立实施小事件日志、证据引用与定期快照优化。

不能同一批改调度、存档格式和世界事务。尤其不能把 `#save(..., unknownDecisionUsage=true)` 之前的在途预算保护当作普通 telemetry 丢掉。[C05][C11]

旧 task record 留存只读。活跃旧任务要么在旧版本结束，要么取消并核对真实收据，再从已提交边界启动新 Run；不得把旧 checkpoint 当作新的行动许可。迁移记录保存旧 taskId → 新 runId 的出处关系。

### 10.4 世界状态不随 engine rollback 回滚

回退执行器只在安全边界进行。已经写入的资源、骰子结果、剧情事件、原始玩家消息和模组版本锁不回滚。已提交但未显示的交付应补发/核对原内容，不重新生成一份不同剧情冒充同一次提交。

---

## 11. 预算与性能设计

### 11.1 一个账本，不在迁移接缝双重扣费

把现有 TaskLease 和 ProviderBudget 的有效逻辑迁为当前 Run 的服务。每次真实 provider attempt 只记一次输入、输出、费用与请求身份；Jev 不算零费用工具；LLM 的真实 usage 与保守预留分开记录。[C10][C12]

父子 frame 使用同一根账本，子能力与上限只能收缩。保留最后一次正常 writer 以及必需交付审查的资源，不让读取耗尽之后只能产生空回合。取消只释放未消费预留；已发出但 usage 未知的请求保持保守记账。

原实现有以 UTF-8 payload 字节作为保守 input estimate 的逻辑。[C04] 它不是测得的 token 数。新版本必须把 estimate 与 actual 分列，不能改变命名后当成更准确计量。

### 11.2 真正优先优化的延迟

单循环节省的不是 JavaScript 循环本身，而是强制的首轮计划生成、逐步 LLM 编排、递归工作流的重复准备、以及过量历史重新投影。

必须统计：Keeper planning、Jev、admission/review、工具/来源工作、writer、store、队列、取消/恢复。不能把总时延全归到“Pi”或“Jev”。

### 11.3 并发在依赖边界内发生

现有 runtime 已支持多 decision 并行，DecisionAdapter 默认并发为 4；table evidence 仍以选取一个 next candidate 为主要推进方式，普通 dispatcher 路径还有串行 tail。[C05][C09][C21]

新驱动器支持同一快照下多个独立读取。操作声明必须区分纯读取、来源发布、世界变更和交付；纯读取不能暗中准备/发布来源。写操作维持原有顺序，不能提前抽取随机数或跨越玩家待决。

一次读取拒绝或取消时保留其它已完成观察，不因整个 batch 重试而重复有效结果。结果合并以稳定步骤顺序记录，完成时间顺序可单独用于遥测。

### 11.4 工作集、缓存和 writer 投影

分离完整审计记录、下一步决策所需的观察视图、最终 writer 结果视图。关键收据、证据范围、否定信息与未知覆盖优先于中间导航详情；原文引用需要正文物化，不能只塞 ID。

当前 writer 包有 32 KiB 边界，超限会减少观察并可能降成 partial。[C12] 改为依目标和类型构造结果投影，而不是增加另一个摘要 LLM。

决定性缓存必须绑定模型/问题族版本、问题内容、候选集合、实际输入、相关 readSet 与受众；失效或不完整结果不作可执行命中。证据缓存和行动许可缓存分开；复用来源不等于复用上轮玩家同意。

A→B→A 场景返回可以重装已存在的场景资料并检查 revision。运行终态回收不能误删长期场景材料。

### 11.5 思考等级不作为架构收益的替身

现有 thinking-schedule 文件使用“首个非交付工具后降级”的规则；规范部署挂载列表没有列入它。[C22] 在单循环下应按推理目的与任务缺口选定临时配置，而不再基于 tool batch 次数。

首轮性能对照先锁定相同模型和思考配置；阶段化 thinking、typed admission 和缓存改造分别做消融。否则不能判断收益来自调度还是质量配置变化。

---

## 12. 产品文件迁移矩阵

表中“拟新增”仅是目标目录建议；旧有文件在所有消费者迁移完成后才能删除。

| 当前位置 | 动作 | 目标职责 |
|---|---|---|
| `runtime/jev/task-runtime.ts` | 拆分并退役驱动部分 | `#run` 迁入 Pi；可复用 domain types 留在产品策略层；存储/lease 抽出 |
| `runtime/jev/task-host-session.ts` | 大幅收缩 | 保留会话与内核绑定，移除 submit-plan 工作流、重复 phase/attempt 推进 |
| `runtime/jev/s0-rpc.ts` | 替换实验组合入口 | 拟新增 `runtime/pi-session.ts`，统一创建具备 hybrid ports 的真实会话 |
| `runtime/jev/host-session-adapter.ts`、`s0-*` | 安全切换后退役 | 保留历史对照与存档识别，不留并行生产控制权 |
| `runtime/jev/decision-port.ts`、`decision-adapter.ts`、`question-packing.ts` | 迁移复用 | Jev 请求与协议实现，账本由 Run 注入，不持有执行循环 |
| `runtime/jev/*-domain.ts` | 逐项改为 step policy | 读集、语义候选、证据充分性、规则处理策略 |
| `source-owner-operations.ts`、`memory-read-owner.ts` | 去除递归 submit | frame 转换 + 原子 owner 操作 |
| `task-context.ts`、`read-set.ts`、`source-ref.ts` | 迁移复用 | 拟新增 `runtime/authority/`，管理许可、来源和版本检查 |
| `provider-budget.ts`、`writer-budget.ts` | 迁移复用 | 拟新增 `runtime/budget/`，统一请求记账与交付预留 |
| `task-store.ts`、`task-record.ts` | 兼容适配 | 拟新增 `runtime/persistence/`，保留旧记录读取并升级 Run 协议 |
| `extensions/kernel/canonical-operation-dispatcher.ts` | 改造为共用执行服务 | 显式 InvocationContext、操作阶段与可挂起审查，保证钩子恰好一次 |
| `extensions/kernel/index.ts` | 审计并迁移耦合 hook | 输入/作用域/交付/收据接入新事件，不再依赖伪 assistant |
| `extensions/lanes/subsession.ts` | 保留 provider 能力 | 审查调用由新步骤请求驱动；旧外部消费者独立迁移 |
| `runtime/tasks.ts`、`runtime/source-worker.ts` | 分辨叶子与 agent 工作 | 解析 worker 可复用；有语义循环的前台子任务需展平 |
| `runtime/launch.ts`、`runtime/deployment.mjs` | 接入统一启动 | source 与 compiled 都选择同一 hybrid 运行版本 |
| `pipicoc/rpc.mjs`、`pipicoc/runtime-dependencies.json`、`pipicoc/package.mjs` | 打包与入口贯通 | 启动、包版本、构建指纹和资源布局一致 |
| `scripts/build-runtime.mjs`、根依赖与锁文件 | 构建依赖统一 | 不让 bundler 或独立入口重新解析到 stock Pi |
| `Electron/` 中相关 RPC/UI 消费者 | 按实际路径审计 | run busy、步骤进度、取消、秘密过滤和交付确认 |

### 12.1 Pi 源码集成方式

建议把指定上游提交以可审阅源码快照放在拟议 `vendor/pi/`（含上游版本、许可证与变更记录），通过可重复构建生成产品使用的 Pi 包。也可使用受控 fork 的固定提交，但二者只能选一种作为权威构建来源。

不要临时编辑 `node_modules`；不要同时加载 stock 与 fork 的两份 agent-core。根依赖、打包 manifest、Electron backend、reader 路径必须核查实际解析结果。并不要求立刻改写所有 pi-ai provider，但必须验证其类型与事件协议兼容。

### 12.2 启动与协议握手

拟议增加 `PI_COC_LOOP_ENGINE=hybrid-v1|legacy`，与现有功能家族开关分开。legacy 仅用于过渡期对照和安全边界回退，不在一个 hybrid Run 内动态接管。

启动记录至少包括：产品 commit、Pi base 与 patch digest、构建 digest、loop protocol version、配置、挂载、实际模型/思考等级，以及 source/compiled 布局。UI/driver 必须确认协议能力后再开始输入。

当前 `startS0Rpc` 限制 source-mode play RPC。[C01] compiled 接入不是“删掉一个 if”即可完成；资源根、可写 profile、私密凭据、入口文件、provider 扩展和依赖解析都要经过实际打包验证。

---

## 13. 分阶段实施与退役条件

这些阶段是同一目标架构的纵向切片，不是先建设一套更强外循环。

### SL-00：冻结对照与界定控制权

固定 0.9.4a、Pi tag、实际编译产物、Mod 锁、模型、配置与环境。列出所有能调用 `agent.prompt/continue`、`runtime.submit`、`runReader`、外部 provider 的路径以及 owner。

交付：control-flow inventory、当前证据索引、迁移矩阵。不能把维护者本地 `.coc/.tmp` 路径当作已取得的证据。当前交接文件明确保留产品/语义验收工作。[C20]

### SL-01：先实现 Pi 原生非模型步骤

在 agent-core 实现 StepRequest、RunDriver 和注入端口；SDK/services 贯通；一个假 DecisionPort 可以直接产生真实只读操作，再调用一次真实模型输出。这里的“假”仅限测试替身，不伪造会话消息。

门禁：第一条 LLM 响应之前可以执行 policy-origin 读取；从未调用 TaskRuntime.#run；协议事件完整；abort 可以在 Jev/工具等待时立即撤销权限。

### SL-02：迁入领域策略，撤销计划必经入口

改造必填 plan，迁入 table evidence、ordinary resolve/apply 等已支持 domain；`submit_plan_packet` 从 hybrid 活跃工具集移除。复杂输入在同一 Run 内生成 PlanArtifact，不用工具启动第二个执行器。

门禁：简单回合没有强制 LLM plan；复杂回合仍可推理与续接；现有特殊规则不因 Jev 不支持而失去 LLM 提案路径。

### SL-03：展平组合操作与保全正式交付

迁入 source/memory frames，处理 admission、Mod 审查与 reader 的挂起/续接；保留真 writer、真实 narrate/ask 与收据。统一操作入口并审计旧 hook 的执行次数。

门禁：工具与 guard 中没有同目标递归 driver；guard 拒绝前无世界效果；交付失败不能报告成功；已结算响应丢失不重掷、不重复支付。

### SL-04：统一会话事件、重试、压缩和恢复

hybrid 路径移除 `_runAgentPrompt` 的 post-run continue 循环；把重试、上下文压缩、队列唤醒编入同一 driver。持久化恢复原 frame 与实际操作身份。

门禁：每个 Run 最多一个活跃 driver；压缩不重跑工具；新输入/模型切换使旧工作失效；真实消息配对无破坏。

### SL-05：性能优化与真实产品接入

实施独立读取批次、轻量 revision 接口、观察投影、精简快照读取；对 PDF worker 与日志存储做独立优化。source 与 compiled 启动同一实现，接入现有 RPC/play driver。

门禁：同配置对照有端到端证据；没有新增错误状态写入；干净打包环境启动、继续与重启均可用。

### SL-06：退役重复路径

完成以下全部条件才删旧驱动：产品调用链不再引用 `TaskRuntime.#run`；不再注册前台 `submit_plan_packet`；source/memory 不递归 submit；会话不在 hybrid 结束后自动 continue；旧存档可识别并安全核对；source/compiled 与真实连续跑团证据齐全。

旧实现可以保留在基线 tag 或测试 fixture 中，不能与新实现同时拥有当前世界写权限。

---

## 14. 验收合同

### 14.1 架构硬门禁

通过调用追踪与运行断言证明，而不只 grep 文件名：

| ID | 必须成立 |
|---|---|
| SL-A01 | 一个前台 runId 只存在一个活跃驱动所有者 |
| SL-A02 | 本轮第一条模型消息之前可发生原生 Jev/读取步骤 |
| SL-A03 | hybrid 正常路径不调用 `TaskRuntime.submit/#run` 或新的同目标 agent |
| SL-A04 | `source.consult/memory.search` 为可恢复 frame，不隐藏递归执行 |
| SL-A05 | 高级 LLM 步骤结束后返回同一 runId；不是切换到另一个 engine |
| SL-A06 | 没有 tool call 的模型响应不会误结束未交付任务 |
| SL-A07 | 每个操作的 admission、Mod prepare、execute、finalize 按合同只运行一次 |
| SL-A08 | Jev/host 步骤不伪造 assistant 消息、usage 或 provider tool result |
| SL-A09 | hybrid retry/compaction 不重新进入 `agent.continue()` 的第二层控制循环 |
| SL-A10 | 纯 semantic read 不隐含 source publication 或世界效果 |

### 14.2 规则与生命周期场景

| 场景 | 关键断言 |
|---|---|
| 无需资料的普通回应 | 不强制规划；仍有有意义、合规的回应 |
| 角色卡与历史同时需要 | 独立读取可成批，未知/遗漏范围不被抹去 |
| 单个普通检定 | 实际内核选项绑定；同一行动只结算一次 |
| resolve 后 apply | 后果依据实际结果；不是提前猜测结果 |
| 特殊战斗/SAN/追逐 | 返回同一 Run 的 LLM 裁量与既有 owner，不伪装普通检定 |
| 玩家 pending choice | 只处理真实选项，旧 revision 拒绝，不能自动替玩家选 |
| 自由组合行动 | 缺候选触发推理，不按有限目录硬拒绝 |
| 来源分页与图像兜底 | 根据实际来源读取；不把 native text 无结果当作扫描页不存在 |
| 跨回合承诺与奖励 | 保留原话/条件/归属；支付仅由正式效果生效 |
| 新输入抢占 Jev | 旧答案不发起动作、不交付旧文本 |
| resolve/apply 发出后断线 | 先查原 call status，不能新建 ID 重做 |
| 已提交后取消/崩溃 | 保留实际事实，恢复时只核对/补交付 |
| 压缩发生于工具调用之后 | provider 消息配对不破坏，工具不重执行 |
| writer 或 review 不可用 | 不假交付；不丢已发生的结果；服务状态与剧情分开 |
| 后台记忆与前台并行 | 不继承前台写许可，不因新玩家输入丢弃已提交 backlog |
| 世界线或来源切换 | 旧 readSet/缓存/continuation 不被继续执行 |
| compiled 与 source | 使用相同 Pi patch、领域策略与协议，不静默退回 stock |

### 14.3 性能与质量分开评估

对照至少分三种：固定原始配置的 0.9.4a；同配置的新单循环；单循环加各项可选优化。这样能够把架构收益与 thinking、缓存、admission 后端差异区分开。

记录 p50/p95 和适合样本量的长尾分布、有效正文首字、正式交付耗时、各类 provider 请求数量与耗时、token/费用、重试、取消、缺口与恢复情况。冷源、温源、长会话、简单与复杂行动分组，不混成一个平均数。

测试时固定源/构建、规则与 Mod、玩家可见输入、初态及可控 RNG 条件。成对快照评估用于定位；连续自然跑团用于体验。固定轨迹若因合理结果分歧而不再适用，记录分歧而非强行注入下一句。叙事质量与自主性不能用更少 token 代替。

本设计不预设已实现的毫秒目标或提速倍数。团队可在获取基线后，预先登记统计阈值和质量非劣界限；不能看完数据再选择对自己有利的门槛。

### 14.4 既有保全材料

《ChatRPG 跨版本优化与重构验收总册》用于提醒跨版本保全事项：单一权威、来源与秘密、幂等恢复、实际接线、真实产品入口与配对性能证据。它主要参照 0.9.3a，不用于认定 0.9.4a 的实现现状；也不宣称本方案已经逐条复核全部 164 项。[P01]

---

## 15. 交给编码 Agent 的实施约束

实施目标是改变 Pi 执行循环的能力，而不是包装现有循环。先完成一个贯通真实输入、原生决策/工具、真实 writer、正式交付和恢复的纵向切片，再扩领域。

新增类型和策略不得获得世界写权限；所有操作仍经正式 owner。禁止中文关键词剧情匹配、模组专名特判、伪造测试收据、直接编辑存档制造通过，禁止为迁移恢复已经退役的 Python 产品路径。

同一个 hybrid Run 不允许运行旧执行器；legacy 对照和回退只在安全边界选择。原始证据、用户资产、campaign/module 状态与 Mod 锁不得为清理架构而删除。实现、构建、确定性测试、真实链路、语义质量和性能分别报状态。

每项提交至少给出：修改前后调用链、迁移/退役组件、新增及保全的契约、真实测试命令与结果、仍未验证的边界。不能用“类已创建”“单测数很多”“Jev 请求成功”宣布单循环或产品提速完成。

---

## 附录 A：代码证据索引

产品链接固定到 `86078fdded13b6f83beeb164d0c94b3e7e6433f3`；上游链接固定到本次核对的 `v0.85.1`。条目依据实际读取的文件/段落，而非整个仓库的完整审计。

| 标记 | 文件与本方案所用内容 |
|---|---|
| C01 | [runtime/jev/s0-rpc.ts](https://github.com/Leehow/chatrpgv4/blob/86078fdded13b6f83beeb164d0c94b3e7e6433f3/runtime/jev/s0-rpc.ts)：source/play/RPC 限制、SDK session 组合、功能开关 |
| C02 | [pipicoc/runtime-dependencies.json](https://github.com/Leehow/chatrpgv4/blob/86078fdded13b6f83beeb164d0c94b3e7e6433f3/pipicoc/runtime-dependencies.json)：Pi 0.85.1 与 compiled 入口 |
| C03 | [Pi agent-loop.ts](https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/src/agent-loop.ts)：模型优先循环、工具消息、截断及下一轮准备 |
| C04 | [task-host-session.ts](https://github.com/Leehow/chatrpgv4/blob/86078fdded13b6f83beeb164d0c94b3e7e6433f3/runtime/jev/task-host-session.ts)：输入/任务绑定、keeper 检查、submit_plan_packet、预算、交付 guard |
| C05 | [task-runtime.ts](https://github.com/Leehow/chatrpgv4/blob/86078fdded13b6f83beeb164d0c94b3e7e6433f3/runtime/jev/task-runtime.ts)：TaskStep、TaskDomain、#run、保存与恢复 |
| C06 | [Pi agent-session.ts L990–1160](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/agent-session.ts#L990-L1160)：_runAgentPrompt 与 _handlePostAgentRun，读取窗口为 990–1160 |
| C07 | [source-owner-operations.ts](https://github.com/Leehow/chatrpgv4/blob/86078fdded13b6f83beeb164d0c94b3e7e6433f3/runtime/jev/source-owner-operations.ts)：source.consult 子任务、来源引用与原子操作 |
| C08 | [memory-read-owner.ts](https://github.com/Leehow/chatrpgv4/blob/86078fdded13b6f83beeb164d0c94b3e7e6433f3/runtime/jev/memory-read-owner.ts)：memory.search 子任务、filters、原文证据投影 |
| C09 | [canonical-operation-dispatcher.ts](https://github.com/Leehow/chatrpgv4/blob/86078fdded13b6f83beeb164d0c94b3e7e6433f3/extensions/kernel/canonical-operation-dispatcher.ts)：执行与恢复、真实钩子、串行 tail、writer 交付限制 |
| C10 | [task-context.ts](https://github.com/Leehow/chatrpgv4/blob/86078fdded13b6f83beeb164d0c94b3e7e6433f3/runtime/jev/task-context.ts)：读取 1–180 行的 lease/父子预算/作用域与恢复契约 |
| C11 | [task-store.ts](https://github.com/Leehow/chatrpgv4/blob/86078fdded13b6f83beeb164d0c94b3e7e6433f3/runtime/jev/task-store.ts)：revision 检查、文件锁、sync 与替换 |
| C12 | [writer-budget.ts](https://github.com/Leehow/chatrpgv4/blob/86078fdded13b6f83beeb164d0c94b3e7e6433f3/runtime/jev/writer-budget.ts)：32 KiB presentation 与 writer 预留 |
| C13 | [Pi agent-session-services.ts](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/agent-session-services.ts) 与 [sdk.ts](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/sdk.ts)：会话创建配置透传和基础 SDK |
| C14 | [ordinary-resolve-domain.ts](https://github.com/Leehow/chatrpgv4/blob/86078fdded13b6f83beeb164d0c94b3e7e6433f3/runtime/jev/ordinary-resolve-domain.ts)：route/profile、consent、真实 options 与特殊家族 handoff |
| C15 | [extensions/lanes/subsession.ts](https://github.com/Leehow/chatrpgv4/blob/86078fdded13b6f83beeb164d0c94b3e7e6433f3/extensions/lanes/subsession.ts)：当前零工具 lane 模型运行与配置选择 |
| C16 | [extensions/kernel/admission.ts](https://github.com/Leehow/chatrpgv4/blob/86078fdded13b6f83beeb164d0c94b3e7e6433f3/extensions/kernel/admission.ts)：独立行动授权、reviewAdmission/runLane |
| C17 | [runtime/tasks.ts](https://github.com/Leehow/chatrpgv4/blob/86078fdded13b6f83beeb164d0c94b3e7e6433f3/runtime/tasks.ts)：runTask/runReader 与逐次 source worker 入口 |
| C18 | [Pi agent.ts](https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/src/agent.ts)：AgentOptions、队列和状态；[Pi types.ts](https://github.com/earendil-works/pi/blob/v0.85.1/packages/agent/src/types.ts)：StreamFn/loop 配置 |
| C19 | [Pi agent-session.ts L500–810](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/src/core/agent-session.ts#L500-L810)：工具 hooks、next-turn refresh、事件转发、消息持久化 |
| C20 | [handoff-jev-acceptance-20260920.md](https://github.com/Leehow/chatrpgv4/blob/86078fdded13b6f83beeb164d0c94b3e7e6433f3/docs/handoff-jev-acceptance-20260920.md)：原记录声明的已完成边界与待做产品/性能验收 |
| C21 | [decision-adapter.ts](https://github.com/Leehow/chatrpgv4/blob/86078fdded13b6f83beeb164d0c94b3e7e6433f3/runtime/jev/decision-adapter.ts) 与 [table-evidence-domain.ts](https://github.com/Leehow/chatrpgv4/blob/86078fdded13b6f83beeb164d0c94b3e7e6433f3/runtime/jev/table-evidence-domain.ts)：typed Jev 后端、并发与证据候选策略 |
| C22 | [thinking-schedule/index.ts](https://github.com/Leehow/chatrpgv4/blob/86078fdded13b6f83beeb164d0c94b3e7e6433f3/extensions/thinking-schedule/index.ts)、[deployment.mjs](https://github.com/Leehow/chatrpgv4/blob/86078fdded13b6f83beeb164d0c94b3e7e6433f3/runtime/deployment.mjs)、[pipicoc/rpc.mjs](https://github.com/Leehow/chatrpgv4/blob/86078fdded13b6f83beeb164d0c94b3e7e6433f3/pipicoc/rpc.mjs)：现有思考策略与规范挂载路径 |
| V01 | [TypeSafe Choice 官方文档](https://docs.typesafe.ai/primitives/choice)：本次核对的有限选项接口；不是产品准确率证明 |
| V02 | [TypeSafe Speculative fan-out 官方文档](https://docs.typesafe.ai/patterns/fan-out)：同状态的独立问题批量判断；不是依赖工具结果的预知能力 |
| P01 | 对话附件《ChatRPG_重构优化总册_2026-09-21(2).md》，版本 1.0：本次使用总原则、TXN 恢复与 MIG 门禁片段，非当前源码认证 |

---

## 附录 B：交付检查表

交付物应包括：Pi 核心补丁、SDK 配置与事件协议、产品领域策略迁移、统一操作执行与续接服务、来源/记忆 frame、旧记录读取与恢复策略、实际打包依赖锁、架构断言测试、故障注入结果、配对跑团与性能报告，以及被退役路径清单。

**最终判定：玩家目标从输入到正式交付始终由同一个 Pi RunDriver 推进；需要 LLM 时只增加一次推理步骤，不重新启动一套代理；已有规则、玩家自主性、来源与恢复能力在真实产品路径上得到保全。**
