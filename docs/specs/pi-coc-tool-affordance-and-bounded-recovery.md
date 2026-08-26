# Pi-Coc 工具可供性与有限恢复规格

Status: Proposed  
Date: 2026-08-25  
Track: `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`  
Owner: Pi-Coc host tool surface and live-turn recovery  
Evidence baseline: `e2e-0.7.0a-20260825` 艾伦·沃德《鬼屋》终局账

## 1. 授权边界

本文是实现规格，不是实现授权。

本规格只描述 Pi-Coc 轨应如何收紧模型可见工具、减少模型负责的参数、把可恢复失败变成有界恢复，并阻断无 canonical 进展的隐藏自旋。Codex-host 实现、适配器、提示词、测试和文档均不在本规格范围内。

以下共享文件属于 cross-track scope，后续即使实现本规格也必须另行取得用户明确授权才能修改：

- `plugins/coc-keeper/references/mcp-operation-contracts.json`
- `plugins/coc-keeper/scripts/coc_toolbox.py`
- canonical rules/state/finalization handlers
- 同时改变 Codex 与 Pi-Coc 行为的共享测试或共享技能

首个实现切片应优先使用 Pi-Coc 自己已有的 registry、policy、typed-tool overlay、`setActiveTools` 和 canonical envelope，不创建第二套 registry、MCP server、receipt engine 或 Keeper runtime。

## 2. 用户任务与成功定义

用户要解决的是：真实长团里，KP 应该能快速找到少量当前可用工具，用容易填对的参数完成规则/状态/结算；即使调用失败，也应在一到两步内改对或明确终止，不能让一次失败被放大成数百次模型调用和十几分钟无进展等待。

成功表现为：

1. 普通 live turn 不再向模型同时暴露近百个完整 schema。
2. 模型只填写语义上属于 KP 的字段；campaign、当前玩家原文、当前回合 identity、digest、revision、可推导路径耗时等由 host 绑定。
3. 每个 model-visible 失败都能区分“改参数”“先做前置操作”“canonical 状态已变”“host/transport 重试”“不可在本回合恢复”。
4. 相同 player epoch 内，隐藏 recovery 只能有限发生；无 canonical 进展时必须落一个可恢复的 typed fault，而不是继续唤醒模型。
5. `state.journal → turn.output_context → narration.review → turn.finalize → exact rendered_text → session.delivery_ack` 的权威边界保持不变。
6. KP 仍拥有语义判断、因果、节奏与叙述；动态工具面只投影当前 affordance，不替 KP 决定行动或固定调用顺序。

以下交付即使测试通过也属于 hollow delivery：

- 只给提示词补更多说明，但仍一次暴露 97 个 live-turn tools。
- 只在 Web adapter 增加“同 error 三次就 abort”，终端 Pi-Coc 仍可无限自旋。
- 为减少失败而放宽 finalization、直接放行 raw prose，或绕过 canonical state/rules。
- 新增一个固定 turn pipeline、工作流引擎或总收据，取代 live Keeper 的语义判断。
- 只修这场《鬼屋》的 NPC、场景或参数，没有修同类系统路径。

## 3. 当前实现事实

### 3.1 已经存在且应复用的深度

当前不是“没有范式”，而是已有几块正确机制没有在同一个 seam 上收口：

- `operation-contracts.ts` 从唯一 MCP contract archive 读取每个 canonical operation 的 `inputSchema`。
- `typed-tools.ts` 为每个 canonical operation 生成一对一 typed Pi tool，且已经能隐藏 `narration.review.state_claim_compilation` 等 host-owned 字段。
- `operation-policy.ts` / generated policy 已经记录 role、phase、audience 与 KP surface。
- `domain-tools.ts` 已经按 role/phase 调 `activeToolsForPhase`，并在 execute-time 再做 ACL。
- Pi extension 已经在 phase 变化时调用 `pi.setActiveTools(...)`。
- MCP server 已经有 progressive discovery：`coc_discover` 可按 operation 或 domain 返回 compact catalog / full contract，且 Pi runtime 已缓存静态结果。
- canonical failure envelope 已经有 `code`、`message`、`details`、`violations`、`hints`、`retryable` / `will_retry` 的承载位置。
- `turn-output-gate.ts` 已经对 pre-inference steer 与 empty terminal recovery 做了每 epoch 一次的限制，也已有 `turn_processing_fault`。
- `nonretry-circuit.ts` 已经尝试阻断完全相同的 non-retryable call。

因此实现策略是加深这些 module 的 interface 与 locality，而不是增加平行 facade。

### 3.2 当前工具面过宽

当前 contract archive 有 130 个 canonical operations。以当前工作树代码静态计算：

| role / phase | 模型可见工具数 |
| --- | ---: |
| `play / live_turn` | 97 |
| `play / pending_finalization` | 29 |
| `play / opening` | 32 |
| `play / recovery` | 9 |
| `setup / opening` | 19 |

`activeToolsForPhase` 只使用 role + phase。它不知道当前 scene 的 action routes、是否存在 combat、当前是否有 pending defense、NPC 是否在场、是否已有 journal、当前 finalization stage，也没有按一次 tool failure 的 recovery route 临时收紧工具面。

这意味着 typed schema 虽然比开放的 `arguments` bag 更好，但模型每一轮仍要在 97 份定义里选择，而且大量字段是当前状态下不可能合法的动态值。

### 3.3 终局实测：失败不是主要耗时，失败会放大模型循环

下列数字来自终局 evidence，而不是当前 dirty worktree 的推测：

- `.coc/playtests/e2e-0.7.0a-20260825/evidence/retrospective-20260825.json`
- `.coc/playtests/e2e-0.7.0a-20260825/sandbox/.coc/campaigns/the-haunting-qs-mt8q9tv3/logs/toolbox-calls.jsonl`
- 当轮对应的 `.pi/coc-agent/telemetry/turns.jsonl` records

艾伦·沃德《鬼屋》终局账记录：

| 指标 | 结果 |
| --- | ---: |
| table turns | 17 |
| toolbox calls | 384 |
| toolbox failures | 24 |
| host records | 46 |
| 总墙钟 | 12,353.3 s |
| 总模型时间 | 11,241.8 s |
| 总工具时间 | 1,097.4 s |
| productive records 模型占比 | 88.8% |
| spin records | 3 |
| spin records 墙钟 | 2,479.9 s |
| spin records 模型时间 | 2,473.4 s |
| spin records 工具时间 | 0.3 s |
| spin records 模型调用 | 618 |

三段 spin 分别是 689.08 s / 97 次模型调用、1,220.93 s / 419 次模型调用、569.93 s / 102 次模型调用；每段都只有一次约 0.1 s 的工具调用。这证明“工具慢”不是这些极端长耗时的解释，真正的故障类是：没有 canonical progress 的正常 `stop` 被 host 隐藏 follow-up 反复重新唤醒。

24 次 toolbox failure 的精确分布为：

| operation / code | 次数 | 主要类型 |
| --- | ---: | --- |
| `turn.finalize / default_mechanics_placement_unavailable` | 5 | finalization draft repair |
| `state.journal / idempotency_conflict` | 3 | identity ownership |
| `turn.output_context / no_unfinalized_journal` | 2 | sequencing |
| `turn.finalize / state_authority_review_blocked` | 2 | finalization draft repair |
| `turn.finalize / narration_review_required` | 2 | sequencing / host binding |
| `turn.finalize / narration_review_mismatch` | 2 | host binding / stale revision |
| `narration.review / idempotency_conflict` | 2 | identity ownership |
| `combat.resolve / unknown_combat_target` | 2 | dynamic candidate |
| `state.move_scene / invalid_param` | 1 | dynamic candidate / derived value |
| `state.journal / turn_finalization_pending` | 1 | sequencing |
| `state.advance_time / invalid_request` | 1 | state-dependent schema |
| `rules.social_adjudicate / invalid_param` | 1 | cross-field schema |

这些失败里，只有一部分能靠更严格的静态 JSON Schema 直接消除。combat target、scene edge、precise clock、pending journal 和 review revision 都依赖 canonical current state，必须由 host projection、candidate binding 或 stage visibility 解决。

### 3.4 当前恢复 seam 的缺口

`acceptVisibleAssistantFinal(...)` 在没有同 epoch finalization receipt 时会生成 `settled_output_gate`；transcript gate 随后调用 `deliverMechanicalOutputGateInstruction(...)`，以 `triggerTurn: true` 发送隐藏 follow-up。

这一条 settled-output follow-up 没有 attempt、budget 或 progress identity。相比之下，empty-terminal recovery 和 pre-inference steer 已经分别限制为每 epoch 一次。结果是：模型若再次正常 stop、仍没有 receipt，host 可再次走相同 follow-up。

`NonRetryableFailureCircuit` 也不足以覆盖这个问题：

- 它只观察 tool failures，观察不到 tool-free `stop`。
- fingerprint 包含完整参数，模型只要换 `decision_id` 或改一点 draft 就能绕过。
- fingerprint 不含 canonical progress revision。
- map 是 session 级，只有 session 初始化时 reset；状态真正进展后可能误伤一个本来已可重试的调用。

当前 Web adapter 工作树里已有一个按相同 `tool + code` 连续三次 abort 的方向，但它位于过晚的 adapter seam：终端 Pi-Coc 不受保护；changed-argument 合法修复可能被误判；tool-free loop 仍不可见；adapter 也不知道 canonical progress。

## 4. 外部实践与本项目约束

外部实践一致指向四点：按需加载、较小 namespace、严格 schema、actionable structured errors。

- OpenAI Agents SDK 推荐 deferred tool search 和 namespace；一个 namespace 理想上少于 10 个 functions，并支持按 runtime state 动态 enable/disable。[OpenAI Agents SDK: Tools](https://openai.github.io/openai-agents-python/tools/)
- Anthropic 将 20+ tools 视为适合 tool search 的规模，并明确指出 tool definitions 与历史 tool results 是两种不同的 context 压力。[Claude Platform: Manage tool context](https://platform.claude.com/docs/en/agents-and-tools/tool-use/manage-tool-context)
- Anthropic 的工具设计总结建议少量、目的清楚、面向 workflow 的工具；应返回高信号上下文、避免 cryptic identifiers，并以真实 transcript 与 tool-error 指标迭代。[Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- Semantic Kernel 建议避免让模型生成 token-heavy GUID，使用枚举与准确类型，并让错误明确说明如何修正。[Semantic Kernel function calling](https://learn.microsoft.com/en-us/semantic-kernel/concepts/ai-services/chat-completion/function-calling/)
- MCP 工具规范区分 protocol error 与 model-visible tool execution error，支持 `inputSchema`、`outputSchema`、`structuredContent` 与 `isError: true`。[MCP tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)

这些范式不能原样复制成 provider-specific hosted tool search。Pi-Coc 要服务 Grok 和其他 provider，且仓库已有 `coc_discover` 与 `setActiveTools`；因此本规格选择 provider-neutral 的 host-managed working set，不依赖某个 provider 的专有 tool-search protocol。

## 5. 目标架构

目标只有两个主要 module；argument projection 与 failure projection 是这两个 module 的 interface，不另建总控层。

```text
canonical registry + policy + current receipts
                    |
                    v
          Tool Working Set module
        project() / loadNamespace()
                    |
                    v
        Pi setActiveTools + typed schemas
                    |
              model tool call
                    |
                    v
      Typed Argument / Failure projection
                    |
                    v
          one canonical MCP gateway
                    |
                    v
        Turn Progress & Recovery module
        observe progress / bound recovery
                    |
        exact output OR typed terminal fault
```

### 5.1 Module A: Tool Working Set

实现应加深现有 `domain-tools.ts` / `typed-tools.ts` seam，形成一个 cohesive module。外部 interface 只暴露：

```ts
type ToolWorkingSetSnapshot = {
  role: "setup" | "play";
  phase: PlayPhase;
  playerTurnEpoch: number;
  stage: TurnStage;
  canonicalProgressRevision: string;
  affordances: CanonicalAffordanceProjection;
  loadedNamespaces: readonly LoadedNamespace[];
  recoveryRoute?: RecoveryRoute;
};

type ToolWorkingSet = {
  revision: string;
  activeToolNames: readonly string[];
  activeOperationNames: readonly string[];
  schemaBytes: number;
  reasons: readonly WorkingSetReason[];
};

projectToolWorkingSet(snapshot: ToolWorkingSetSnapshot): ToolWorkingSet;
loadToolNamespace(request: NamespaceLoadRequest): ToolWorkingSet;
```

#### 5.1.1 输入事实归属

`Tool Working Set` 只能消费已有 canonical structured facts：

- role / phase / startup state
- `scene.context` 的 exact action routes、present NPCs、exits、pending SAN triggers
- `combat.context` / chase / sanity 的 active subsystem 与 pending choice
- latest journal / output context / review / finalize receipt stage
- execute ACL 与 operation policy
- 当前 failure 的 structured recovery route

它不得读取玩家自由文本做 keyword routing，不得推断 NPC hostility、clue relevance 或故事节奏，也不得新增允许/拒绝玩家行为的语义规则。

#### 5.1.2 默认工作集

正常 `play / live_turn` 的默认工作集必须满足：

- hard cap：20 个 model-visible tools。
- 每个 loaded namespace 理想上不超过 10 个 operations。
- always-on 只保留 host 基础工具、一个精简 discovery/load 工具、当前 scene/context 读取与 turn closure 必需入口。
- subsystem 工具只在 canonical subsystem active 或 KP 明确加载该 namespace 后出现。
- NPC、cash、handout、combat、chase、sanity、development 等长尾 operation 不因都属于 `live_turn` 就一起暴露。
- `pending_finalization` hard cap 为 10，且以 finalization/read-only closure tools 为主；不得继续暴露普通 rules/state mutations。

20 / 10 是 acceptance budget，不是产品语义。若当前 canonical obligations 确实需要更多工具，module 应以明确的 budget overflow evidence 失败，而不是静默裁剪必要能力。

#### 5.1.3 Provider-neutral discovery

复用现有 `coc_discover` archive 和 typed-tool catalog，但改变 Pi 模型可见行为：

1. 默认只暴露 compact `coc_discover` / loader，不暴露全量 typed schemas。
2. 无参数时只返回当前 role + phase 下可加载的 compact namespaces，不返回 130 项全 catalog。
3. `domain` 必须是 structured enum；model-visible operation id 必须是现有 semantic dotted id。
4. exact `operation` 请求返回该 operation card，并将它加入当前 epoch working set。
5. domain 请求最多激活当前 role + phase 合法的 10 个 operation；超过上限必须分页或要求 exact operation，不得一次展开整个 36-operation state namespace。
6. 每次 load 后 host 立即重新 `setActiveTools`；execute-time ACL 仍是最终权威。
7. loaded tool 在当前 player epoch 或 canonical stage 改变后自动失效，避免长团里 working set 单调膨胀。

这不是第二套 registry：发现、schema、policy 和执行都仍来自现有 archive / generated policy / canonical gateway。

### 5.2 Typed Argument Projection

当前 `presentedTypedToolParameters(...)` 已证明 Pi overlay 可以隐藏 host-owned 字段。应把它推广成显式的 argument ownership interface：

```ts
type PresentedToolContract = {
  operation: string;
  modelInputSchema: JsonSchema;
  bindModelInput(input: unknown, host: HostBindingContext): CanonicalArguments;
  projectedCandidates?: readonly SemanticCandidate[];
};
```

字段按归属分为：

| Model-owned | Host-owned |
| --- | --- |
| goal、approach、fictional realization、player-safe summary | root、campaign、当前 player exact text、run/session identity |
| 多个合法候选之间的 semantic choice | turn id、review id、revision、source/content digest |
| 是否采用可选规则/状态动作 | idempotency key / decision namespace |
| KP 的叙述 draft 与 coverage reasoning | 单一当前 investigator、单一 pending target、精确 state revision |
| 无法从 canonical route 推导的语义参数 | source-authored edge 的 travel minutes、precise clock 派生 phase |

约束：

- 模型不得复制 UUID、hash、随机 receipt id 或 host-created revision token。
- model-visible candidate 必须是有含义的 semantic id；machine identity 由 host 从 retained projection 回附并验证 digest。
- 只有多个当前合法候选时才让模型选择 candidate；只有一个时自动绑定。
- 跨字段约束应尽可能编码为 `enum`、`oneOf`、nested required 或 candidate card，而不是只写在 description。
- strict static schema 不能表达动态合法性时，不伪造枚举；先读 canonical context，再投影当前 candidate set。

#### 5.2.1 这场失败的参数归属修正

| 失败 | 目标修正 |
| --- | --- |
| `state.move_scene` travel mismatch | KP 选择 `scene_id` / route；host 从当前 `scene.context.action_routes` 绑定 exact `travel_minutes`。 |
| precise clock + `day_phase_after` | precise clock 下 model schema 不出现 `day_phase_after`；host 派生。 |
| social motive intensity without evidence | 用 `oneOf` 表达 `intensity=0` 或 `intensity>0 + evidence_refs minItems=1`。 |
| unknown combat target | `combat.context` 返回当前 semantic candidates；`combat.resolve` 只接受 retained candidate ref。 |
| journal/review idempotency conflict | host 生成 player-epoch + semantic operation + revision ordinal 的 semantic idempotency key；model 不填写。 |
| narration review mismatch | review id、turn id、source digest 与 revision 从当前 frozen output context 绑定。 |

### 5.3 Failure Projection

Failure Projection 加深现有 canonical envelope，不创建新 error engine。每个 model-visible failure 至少投影：

```json
{
  "ok": false,
  "isError": true,
  "tool": "state.move_scene",
  "error": {
    "code": "invalid_param",
    "class": "dynamic_candidate",
    "message": "...",
    "violations": [],
    "details": {},
    "recoverable_by": "model_next_action",
    "allowed_next_actions": [
      {
        "operation": "scene.context",
        "reason": "refresh current source-authored routes",
        "host_bound": true
      }
    ],
    "canonical_progress_revision": "turn-stage-3",
    "attempt": 1,
    "max_attempts": 1
  },
  "retryable": false,
  "will_retry": false
}
```

规范化 error class：

| class | 含义 | 谁恢复 |
| --- | --- | --- |
| `schema_validation` | 静态输入不满足 strict schema | model 按 violations 修一次 |
| `dynamic_candidate` | 候选不在当前 canonical projection | host 刷新 projection，再让 model 选一次 |
| `business_precondition` | 合法 operation 的前置 stage 未完成 | working set 切到 exact next operations |
| `idempotency_conflict` | 同 identity payload 漂移 | host replay retained intent 或生成下一 semantic revision；禁止模型猜 id |
| `transient_transport` | busy、transaction failure、transport timeout | toolbox/host 内部有界重试，默认不交给 model |
| `invariant_terminal` | secret/state/finalization integrity 无安全恢复 | 直接 typed fault，保留 pending turn |

硬约束：

- 每个 `recoverable_by != none` 的失败必须有非空 `allowed_next_actions` 或一个 host 自动动作。
- generic “call describe and retry” 只允许用于真正的 `schema_validation`，不得用于 dynamic candidate 或 business precondition。
- `retryable` / `will_retry` 表示 runtime 是否会重放，不与“模型可改参数”混为一谈。
- transport/protocol failure 与 canonical business failure 保持 MCP 语义区分；business failure 继续作为 `isError: true` 的 structured result。
- `turn.finalize` 的 placement / authority / review failure 必须返回 exact paragraph/revision repair packet，不得要求重跑 rules、state 或 journal。

### 5.4 Module B: Turn Progress & Recovery

应加深现有 `turn-output-gate.ts`，把散落在 mechanical gate、empty-terminal recovery、pre-inference steer、nonretry circuit 与 Web streak detector 的“本回合是否有进展、还能恢复几次”收进同一个 module。

外部 interface：

```ts
type CanonicalProgress = {
  playerTurnEpoch: number;
  stage: TurnStage;
  campaignRevision: string | null;
  journalRevision: string | null;
  reviewRevision: number | null;
  finalizedRenderedSha256: string | null;
  closedObligationCount: number;
};

observeModelTerminal(event: ModelTerminal): RecoveryDecision;
observeCanonicalResult(operation: string, envelope: unknown): RecoveryDecision;
observeVisibleDelivery(receipt: DeliveryReceipt): RecoveryDecision;
```

`CanonicalProgress` 只能从 host/canonical receipts 构建；stdout activity、stream chunks、thinking tokens、换 decision id、改 draft whitespace 都不算 progress。

#### 5.4.1 Turn stage

```text
awaiting_player
    -> acting
    -> journaled
    -> output_context_ready
    -> review_ready
    -> finalized
    -> delivered

任一处理中 stage -> faulted（保留 pending turn 与 receipts）
```

stage 不是固定语义 pipeline。`acting` 内 KP 可自由选择零到多个 context/rules/state/NPC/subsystem tools；只有一旦 journaled，canonical contract 本来就禁止继续改变已结算 mechanics。working set 只是让可见工具与这个已有不变量一致。

#### 5.4.2 Recovery budgets

同一 player epoch 的硬预算：

| recovery | budget | progress 后是否重置 |
| --- | ---: | --- |
| pre-inference finalization steer | 1 | 否 |
| empty tool-free terminal recovery | 1 | 否 |
| settled-output hidden follow-up | 最多 2 | canonical stage 前进后可进入下一 stage，但同一种 follow-up 不重置 |
| 同 fingerprint non-retryable failure | 原失败 + 1 次修正 | canonical progress 后重算 fingerprint |
| narration draft revision | 最多 2 个 accepted revisions | 否；遵守现有 finalization contract |
| transient toolbox retry | 由现有 toolbox 内部 budget 管理 | model 不参与 |

failure fingerprint 必须包含：

- player turn epoch
- operation + normalized error class/code
- canonical progress revision
- normalized model-owned arguments

必须排除 host-owned `decision_id`、digest、receipt id、run/session id 和仅 whitespace 不同的 draft，否则模型可用无意义改动绕过 budget。

#### 5.4.3 Exhaustion behavior

预算耗尽时：

1. 不再 `triggerTurn: true`。
2. arm 现有 `turn_processing_fault`，stage 标明 `tool_selection`、`tool_arguments`、`finalization_repair` 或 `player_output_delivery`。
3. fault 必须记录 last canonical progress、attempts、last error class、pending turn preserved。
4. terminal/desktop/Web adapter 统一消费同一个 custom event；adapter 只结束等待并展示恢复说明，不自行判断 semantic retry streak。
5. 不重发玩家输入，不重跑 rules/state/journal，不删除现场；后续 `session.resume` 从 preserved receipts 判定缺少哪一步。

Web 可以保留 transport-level timeout、child retirement 与 auto-open race 修复，但 `TOOL_RETRY_LIMIT` 一类语义 retry policy 必须从 Web adapter 移到 Pi host 的 progress-aware module。

## 6. 工作集状态规则

以下是 capability projection，不是 Keeper 调用配额：

| stage | 默认可见能力 |
| --- | --- |
| `acting` | 当前 scene/context、closure入口、当前 canonical subsystem、按需 discovery |
| `journaled` | `turn.output_context`、必要 read-only context、resume/fault support |
| `output_context_ready` | `narration.review`、`turn.finalize`、必要的 exact context refresh |
| `review_ready` | `turn.finalize` 与 revision-2 narration repair |
| `finalized` | 不再让模型调用 campaign mutation；只允许 exact rendered text delivery |
| `faulted` | `session.resume` 与 fault 明确授权的 narrow recovery operation |

规则：

- tool visibility 与 execute ACL 使用同一 policy source；visibility 先减少错误，ACL 仍 fail closed。
- stage 投影不得把 `scene.context` 误当作 mutation；当前 archive 把 `combat.context` 标为 mutation 的异常也必须先审计，再决定是否纳入 read-only baseline。
- 任何 automatic candidate binding 都必须有 source revision/digest 校验，防止 scene 或 combat 状态变化后使用 stale candidate。
- discovery/load 不得绕过 role、phase、audience、private lifecycle 与 source-worker boundary。

## 7. Telemetry 与复盘

扩展已有 Pi turn telemetry 与 toolbox log，不建第二套日志。每次 model inference 至少记录：

- working-set revision
- active tool count 与 active schema bytes
- loaded namespaces 与 activation reason codes
- player turn epoch、turn stage、canonical progress revision
- recovery kind、attempt、budget、decision
- failure class、recoverable_by、selected next action
- hidden follow-up count
- 从 player input 到 journal / output context / review / finalize / visible delivery 的分段墙钟

不得把 Keeper secret、完整 source card 或 player-private内容复制进新的 telemetry 字段。digest 只用于机器关联，不再要求模型回传。

retrospective 应直接派生：

- active tool count / schema bytes p50、p95、max
- tool selection failures / 100 calls
- schema vs dynamic candidate vs sequencing vs invariant failures
- first-repair success rate
- hidden model calls per player turn
- no-progress wall time
- finalization revision count与失败原因

## 8. 验收合同

### 8.1 Deterministic interface tests

测试必须穿过与生产相同的 module interface，不能再复制一套 selection/retry 逻辑。

1. 任意 role/phase/stage 的 working set 都不含 policy 禁止的 operation。
2. ordinary `play/live_turn` ≤ 20；`pending_finalization` ≤ 10；每个 loaded namespace ≤ 10。
3. 一个默认未加载的合法 long-tail operation 能在最多一次 discover/load 后成为 typed callable tool。
4. stage 或 player epoch 变化后，上一 stage 临时加载的 operation 自动失效。
5. model schema 中不存在声明为 host-owned 的字段，bind 后 canonical arguments 完整且 digest/revision 匹配。
6. stale scene/combat candidate 被 host 拒绝并投影新 candidates，不让模型猜内部 id。
7. failure envelope 对所有 model-recoverable code 都有 structured next action；terminal class 不产生 hidden retry。
8. settled-output hidden follow-up 第三次请求前必定 fault；empty terminal 和 preflight 仍各最多一次。
9. canonical progress 后可以进行合法的下一 stage 调用，但仅换 `decision_id` / whitespace 不算 progress。
10. `turn.finalize` 成功后 exact rendered text 仍只交付一次，hash 与 delivery ack 不变。

### 8.2 终局 failure corpus replay

把 24 次真实失败整理成只读 replay corpus，逐项标注目标 disposition：

- prevented by working set
- prevented by model schema
- host-bound argument
- one-step model repair
- one-step stage transition
- terminal fault

验收要求：

- 24/24 都有明确 disposition，不能归入 generic retry。
- 3 次 one-off argument-contract failure（move/time/social）必须在 MCP 调用前被 schema/binding 阻断，或被路由到 retained dynamic candidate。
- 2 次 combat target failure 必须返回 current candidate projection。
- model-owned opaque identity 导致的 7 个 journal/review mismatch/conflict 路径不再要求模型复制 identity。
- finalization repair 不重跑规则、状态或 journal。

这里的 “7 个” 是本规格的归因口径：3 次 `state.journal/idempotency_conflict`、2 次 `narration.review/idempotency_conflict`、2 次 `turn.finalize/narration_review_mismatch`。`narration_review_required` 另归 sequencing。

### 8.3 性能与 liveness

在 synthetic fault injection 与真实 playtest 中都要求：

- 同一 player turn 没有任何 >2 次 hidden recovery model calls 的路径。
- 零个 10 分钟以上的 no-canonical-progress turn。
- retry budget 耗尽后 1 个 host event 内产出 typed fault，Web/terminal 不继续等待 stdout activity。
- tool/schema reduction 不以增加 model-visible discovery loop 为代价：long-tail 合法调用最多增加一次 discovery roundtrip。
- 不把外部 provider latency 宣称为已修；分别报告 model latency、tool latency 与 host no-progress amplification。

### 8.4 Whole-product acceptance

最终验收必须按 Pi-Coc 唯一方法运行：

1. fresh isolated workspace 与 fresh campaign id。
2. `pi-coc` RPC 模式。
3. Grok 当 KP，主会话/指定代理当唯一玩家，一次一句自然游玩。
4. 自然覆盖普通调查、动态 scene move、NPC/social、至少一个 subsystem、journal/review/finalize 与一次受控失败恢复。
5. 一直跑到自然 ending 或真实 blocker，不用 scripted turn matrix 或 canned scenes。
6. 保留所有 campaign、toolbox、transcript、roll、finalization 与 Pi telemetry evidence。
7. 用 canonical battle-report export；战报不代替耗时账。

验收不能只说“错误少了”，还要报告：active tool counts、schema bytes、各 failure class、hidden recovery calls、first-repair success、模型/工具/host 墙钟分解。

## 9. 实现顺序

### Slice 0: Evidence harness

- 固化 24-failure replay corpus 和 current 97/29 baseline。
- 给现有 telemetry 增加 working-set / progress / recovery 字段。
- 不改变 live behavior。

### Slice 1: P0 有限恢复

- 在 Pi host 加 settled-output follow-up budget。
- 把 nonretry fingerprint 改成 player-epoch + canonical-progress aware。
- budget exhaustion 统一落现有 typed `turn_processing_fault`。
- Web adapter 改为消费 fault，不再拥有语义 retry policy。

这是第一优先级，因为它直接消除 2,479.9 s / 618 模型调用的无进展放大器，且不依赖全量工具面重做。

### Slice 2: Dynamic Tool Working Set

- 加深 `activeToolsForPhase` 为 role + phase + stage + canonical affordance projection。
- 接通 compact discovery/load 与 epoch-scoped activation。
- 先达成 20 / 10 budget，再优化 namespace 划分。

### Slice 3: Argument ownership

- 扩展 Pi typed-tool overlay 与 retained bindings。
- 先处理 campaign/current player/decision/review/digest/route duration/target candidates。
- 只有确需修改 shared archive 时才停下请求 cross-track 授权。

### Slice 4: Error projection and real acceptance

- 规范化 existing envelope 的 class / recoverable_by / next actions。
- replay 24 failures。
- 跑 fresh RPC real playtest，生成终局 evidence 与对比 retrospective。

## 10. 非目标与拒绝方案

- 不创建一把万能 `play_turn` 工具替 KP 做语义判断。
- 不把 130 operations 合并成一个开放 JSON bag；这会丢失 typed schema。
- 不使用 keyword / regex 从玩家文本选择工具。
- 不依赖 OpenAI 或 Anthropic 专有 hosted tool search。
- 不把固定工具调用顺序编码成 runtime pipeline。
- 不取消或弱化 narration review、state authority、mechanic placement 或 exact-output gate。
- 不让 Web adapter 成为 canonical retry authority。
- 不因当前工作树已有未提交实现就把它当作 8 月 25 日实跑二进制证据。
- 不删除或重建这场 playtest evidence。

## 11. 开放决策

实现前只剩三个需要在代码 slice 中用证据确定、但不改变本规格方向的局部决策：

1. Pi 的 `setActiveTools` 是否能在一次 agent loop 的 tool result 后可靠更新下一次 inference；现有调用方式表明可行，仍需用最小 integration test 锁定。
2. `coc_discover` 采用 domain pagination 还是 exact-operation-first；两者都必须满足一轮加载与 namespace ≤10。
3. canonical progress revision 直接组合现有 receipt revisions，还是由 Pi host 生成 semantic monotonic token；无论哪种都不得要求模型复制 digest。

这些是 implementation detail，不应再引出第三个 orchestration module。
