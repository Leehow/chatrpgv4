# ChatRPG v4：Keeper Incremental Context

## 工作集、工作草稿与按需重排的统一设计 · v2.0

**文档状态：** 重设计规格；未实现，未运行性能基准。
**日期：** 2026-09-18。
**代码基线：** `Leehow/chatrpgv4` / `0.9.3a` / `983f359f9aa4f8b3ffc2075bd8ce7696da9cb1a7`。
**建议仓库路径：** `docs/specs/keeper-incremental-context.md`。
**替代范围：** 替代先前 v1.0 工作集设计及后续 Workpad、rerank 讨论中的未收敛建议；不改写既有规则与权威状态契约。

> **目标不是每轮增加一个更聪明的检索 Agent，而是让 KP 在下一次模型请求时，已经拿到当前所需、仍然有效的资料及少量可撤销工作提示，减少重复准备与主模型往返。**

### 阅读约定

第 2 节为本次读取代码得到的事实，使用 `[C#]` 引用。其余规范为拟议目标行为；新增文件、字段、事件、接口和配置均未声称已经存在。`[W#]` 是仅用于核对重排机制的外部官方资料，不是本项目性能证据。

本次 GitHub 分支查询仍将 `0.9.3a` 指向上述提交。[C1] 实施前应重新核对当前开发主线。此前文档是设计输入，不是实现证据。`docs/kernel-rpc.md` 的读取本次未返回有效正文，raw 读取也失败；这不能证明该文件为空。契约变更前仍须在工作树中读该文件，本规格不声称已经完成与其全文的逐条一致性审核。

---

## 1. 设计结论与本次修正

采用一个宿主拥有的 **Keeper Incremental Context（KIC，增量上下文工作区）**，内部组织证据、草稿、候选选择和请求投影；不把四个模块串成四个必跑模型。

| 议题 | 本版决定 | 修正的旧表述 |
| --- | --- | --- |
| 跨回合复用 | 有界活跃工作集 + 持久证据缓存；首次请求主动注入。 | 不只是给 lookup 底层加缓存。 |
| 场景返回 | A 离开上下文但不因切图被删除；回来恢复资料、重读当前状态。 | 不恢复离开 A 时的世界快照。 |
| Workpad | 保留短小、可撤销的工作提示；语义内容由 KP 可选写入。 | 宿主不能无模型地推导出“老板可能保护某人”等语义判断。 |
| 写草稿接口 | 不新增第八个 Keeper 动词；可选 patch 搭载既有交付调用，由宿主截留。 | 不强制每轮先调用 write_plan，也不把草稿写入 apply note。 |
| Reranker | 可插拔、按需、限时；候选少或已能装入时跳过。 | 不默认每轮调用，更不承诺固定百毫秒延迟。 |
| 资料充分性 | 只声明哪些片段已加载、哪些被截断或失效。 | 删除“分数高就证明足够”“高覆盖禁止 lookup”等规则。 |
| 检索接线 | 候选获取必须发生在最终 top-k 截断之前。 | 不能只对已有 6/8 条结果再排一次就称为完整语义召回。 |
| 缓存预取 | 使用真正无写入的宿主读取路径。 | 不把现有 look/lookup 的工具路径等同于纯读取。 |

保持七动词、玩家自主性、规则结算、来源审查和正式交付路径。新增层可以全部关闭；关闭不迁移世界存档，也不删除任何正式事件、线索或物品。

## 2. 本次代码复核：实际已有的能力与缺口

### 2.1 上下文并非完全失忆，但旧工具资料没有独立保留层

`context-policy.ts` 的 `HISTORY_BYTES` 为 32 KiB，历史视图优先取最近两轮玩家/KP原文。`closedNoise()` 会过滤当前边界之前的普通 assistant、toolResult、旧 capsule 等；`projectedMessages()` 保留当前回合工具链，并对回答上次 ask 的情况前移边界。[C2]

`context-runtime.ts` 已缓存相应 generation 的 prepared 结果，并按 `sourceOf(binding)` 复用完整 brief；历史原文仍通过卡片和分页读取。不能把现有实现描述成“每轮所有东西从零再来”。实际缺口是：上轮工具返回、又没有进入下一轮 brief/capsule 的证据，没有专门的跨回合工作集投影。[C3]

### 2.2 来源版本存在，但不是动态状态版本

`kernel-ts/read/context.ts` 的 binding 包含 campaign、worldline、loop、turn 和 source_revision。source_revision 计算涉及模组图谱、generation、meta、启用扩展、craft、register 和语言；它不等同于 HP、NPC位置、物品所有权和角色知识的完整动态版本，也不能替代独立规则资料版本的核验。[C4]

因此不能仅凭“source_revision没变”复用所有看过的内容，更不能以当前 turn 作为所有静态缓存的失效条件。

### 2.3 已有记忆排序，但不是 reranker 模型

`kernel-ts/read/memory.ts` 的 `queryCandidates()` 按纠正优先、实体重叠、类别层级、时间与稳定标识排序，然后截断；`capsuleMemory()` 只取 6 条。投影明确标为 `conversation_report`，保留状态与来源，不能把它们升级成模组事实。[C5]

`ModuleGraph.search()` 则使用名称精确命中、包含匹配、摘要/正文包含匹配，默认 limit 为 8。`table.lookup kind=module` 的公开返回最多 8 个 entityView。[C6][C7] 这条已读路径没有提供向量语义召回或神经 rerank 的证据。

**接线结论：** 新增有界候选入口，复用图关系与已有过滤，但在最终截断前提供更宽候选。不能要求 reranker 找回从未进入候选池的资料，也不能把旧文本匹配规则扩展成硬编码的玩家意图分类器。

### 2.4 已有 note/ruling，但它们不是可随意遗忘的草稿

`stageNote()` 写 notes.jsonl、生成 receipt 和 note-written 事件；`noteObligations()` 又把开放 note 投影成 Keeper 义务。`stageRuling()` 写入有适用锚点的正式裁决记录，并管理 superseded 状态。[C8][C5]

因此，临时的“下一步也许问这个人”“我怀疑他的动机”不能借 apply note 保存，否则可能变成下一轮必须回应的债务。真正对玩家做出的承诺、连续性待办和已经接受的裁决仍沿用原路径。

### 2.5 look/lookup 也不能被预取器任意重放

`table.look` 和 `table.lookup` 会调用 `requireNoTransition()`，其中可能执行 `touchActing()`；部分读取还会走材料准备路径。宿主的 `lookup kind=source` 又可能触发 reading.ensure 和后续发布流程。[C7][C10]

**接线结论：** 自动缓存验证/预取不借用玩家态工具路径，不推进 open→acting，不创建 call_id，不启动新阅读或改编。已有正常工具调用成功后可以捕获证据，但重放工具调用不是缓存命中。

### 2.6 已有轻量宿主注解与性能基础可复用

七个 Keeper 动词及 WRITE_TOOLS 已明确列在 tools.ts。`using_skill` 是现有宿主注解；kernel 扩展验证后删除它，不把注解当作行动授权。[C9][C10] 这提供了 Workpad patch 的接线范式，但新字段仍须单独定义 schema 和生命周期，不能假定 Pi 天然支持。

E0 的 draft.json 目前只有三张过程卡，投影也已有数量/字节限制。[C13][C10] 首版不为三张卡增加一次 rerank 请求。

`thinking-schedule` 已降低回合内后续模型请求的思考档位；行动准入是前台审查；memory 与 verifier 的已读实现是交付后的异步工作。[C12][C14][C15][C16] 新设计不能把这些成本混算，也不改变这些边界来制造表面提速。

## 3. 架构：一条请求路径，而非新增多 Agent 流水线

### 3.1 组件职责

| 组件 | 内容/职责 | 权威性质 |
| --- | --- | --- |
| Authoritative State | 现有 kernel、模组来源、正式记录、当前 capsule 与真实本轮结果。 | 游戏事实和执行资格仍来自这里。 |
| Evidence Store | 可重建证据、来源版本、权限、依赖、区间与场景/实体索引。 | 保留原来源的性质，不产生新事实。 |
| Workpad Store | 有界的场景工作问题、暂时解释和条件性备忘。 | KP草稿；不授权、不执行、不成为义务。 |
| Context Selector | 合法性过滤、候选获取、可选重排、去重和预算装配。 | 只选择本次展示的资料。 |
| Context Projection | 将本次有效 evidence/workpad 组装为唯一宿主参考消息。 | 模型输入；不能充当新的 toolResult。 |

### 3.2 主路径

```text
Player input accepted
        |
Current capsule + host-owned request binding
        |
Load valid evidence / dormant scene bundle / optional workpad
        |
Bounded candidate retrieval
        |
Authority + scope + freshness filtering
        |
Candidate set fits? ---- yes ----> deterministic selection
        | no
Reranker enabled and within budget?
        | yes                    | no / timeout / error
Bounded rerank                  deterministic fallback
        |                         |
        +----- dependency closure + byte packing -----+
                                                       |
Current mandatory context + selected evidence + short workpad
                                                       |
Keeper -> existing look/lookup/recall/resolve/apply/ask/narrate
```

候选多并不说明这一轮剧情复杂，候选少也不说明可以跳过规则。路由仅调度检索成本，不决定玩家行动语义。

## 4. 三层存储与证据有效性

### 4.1 存储层次

L1 为本次请求的活跃工作集，有固定上限；L2 为持久证据及草稿缓存，跨场景和进程保留但受配额限制；L3 为既有权威记录，不由缓存 GC 管理。

同一 NPC、规则或原文在多个场景使用时存一份正文，SceneBundle只保存引用。按场景组织之外，保留实体和调查 thread 的交叉索引；信件、随行 NPC 和当前调查不会因切图丢失关联。

`residency=active/dormant/evicted` 与 `validity=valid/stale/unverifiable` 独立。几轮不用是活跃度变化，不是内容变假。TTL只治理资源，不证明事实有效。

### 4.2 首版证据白名单

首版支持有可核验来源的原文片段、规则参考，以及已发布图谱中明确静态的字段。NPC混合视图必须拆分；当前位置、态度、HP、已公开知识等不能连同静态档案一起盲目保留。

正式记录中的历史引文可作为记录引用，不能自动变成事实；记忆候选与草稿必须保留原认识状态。当前回合的真实收据继续留在正式工具链中，不复制成跨回合可消费 marker。

| 资料 | 复用策略 |
| --- | --- |
| 模组原文、静态背景、规则条文 | 来源/投影版本和作用域有效时复用。 |
| 已接受改编、现场建立人物 | 保留 campaign origin，不冒充原书内容。 |
| 角色状态、NPC位置、容器内容、公开条件 | 第一阶段由当前权威投影提供；依赖完备后才缓存派生视图。 |
| 历史台词、候选记忆 | 作为 record/conversation_report，保留更正与替代关系。 |
| KP草稿、计划、假设 | 只放 Workpad，并明确 advisory。 |
| 掷骰、伤害、移动、金钱、授权、待选答案 | 不作为新动作结果或执行资格复用。 |
| 超时、pending、失败、部分页 | 不缓存为完整事实；明确未完成或摘录范围。 |

静态并不表示全局共享。首版逻辑条目按战役与世界线隔离；内容哈希去重不授予读取权限。

### 4.3 证据契约（拟新增）

```typescript
type Authority =
  | "module_source" | "rules_source"
  | "campaign_adaptation" | "table_record"
  | "conversation_report";

interface EvidenceEntry {
  id: string;                    // host-owned, not an execution token
  schemaVersion: number;
  adapterVersion: string;
  scope: ScopeBinding;
  source: {
    locator: string;
    revision: string;
    contentHash: string;
    authority: Authority;
  };
  dependencies: DependencyStamp[];
  dependencyCoverage: "complete" | "incomplete";
  entityRefs: string[];
  sceneRefs: string[];
  threadRefs: string[];
  audience: "keeper_only" | "player_projection";
  body: string;
  coverage: {
    complete: boolean;
    omitted: string[];
    range?: { start: number; end: number };
    readRef?: Readonly<Record<string, unknown>>;
  };
}
```

`ScopeBinding` 包含宿主工作区/战役、世界线、循环及必要的权限域。版本和依赖由实际读取层填写；KP不能自报“来源有效”或“依赖完整”。被截断的 entityView 不应被标为全量 NPC 档案。

## 5. Workpad：记录工作进度，不复制第二个世界

### 5.1 两类内容、两种生产者

**Turn Frame** 由宿主从已经出现的结构化记录整理，例如本轮实际访问的证据引用、已经返回的 needs、当前待选决定引用、正在执行的工具阶段。它不自行解释老板动机，也不复制这些对象为新的执行权威。

**Scene Workpad** 的语义内容由 KP可选提供，包括当前工作问题、尚未厘清的解释、要继续核查的来源、条件性接续。它不是隐藏思维链，不要求完整推导，不保存长篇剧情大纲。宿主只做格式、引用、配额和来源依赖检查，不声称理解或验证了自由文本中的推论。

默认不运行单独的总结模型；Workpad没有更新时，系统照常工作。

### 5.2 草稿模型

```typescript
interface WorkpadDraft {
  schemaVersion: 1;
  focus?: string;
  openQuestions: Array<{
    id: string;
    question: string;
    evidenceRefs: string[];
  }>;
  hypotheses: Array<{
    id: string;
    claim: string;
    status: "tentative" | "needs_recheck" | "discarded";
    supportRefs: string[];
    counterRefs: string[];
  }>;
  conditionalContinuations: Array<{
    when: string;
    consider: string;
    evidenceRefs: string[];
  }>;
}
```

不设置未经校准的数值 confidence，不设置自动 confirm 为事实的操作，不设置 do_not_research。资料已经加载与“此问题不许再查”不同。

老板是否属于邪教有原书答案时，应查验原书，而不是让 KP工作假设覆盖它。对玩家意图的上一轮理解也只是草稿；新输入始终优先。玩家认知模型、NPC信念、KP工作提示必须明确分开。

### 5.3 不新增第八个动词：交付时可选搭载

拟在 `narrate` 与 `ask` 的宿主工具schema中加入可选 `workpad_patch`。它只支持有限的字段替换、按ID upsert/remove，不支持文件路径或任意 JSON Pointer。草稿应短，且不要求每轮更新。

宿主在进入 mods、准入和 kernel 参数校验之前提取并删除该字段，先暂存。只有该次交付真正成功，才把对应 patch发布到发起时绑定的场景工作区；narrate失败、关闭后被拒、split delivery被拒、超时或取消，都不能把计划标为已完成。ask可保存待选问题的工作提示，但不把尚未做出的选择当成答案。

语义承诺或已接受裁决仍通过原有 apply note/ruling 等正式路径记录，不能由 patch替代。若本次交付触发切线/循环，草稿归属按旧调用绑定记录，新线不会自动继承。绑定、revision和base commit均由宿主填写，不由模型填写。

**失败策略：** 坏patch只丢草稿并记录遥测，不阻止原本合法的交付，不追加一轮“修草稿”的模型调用。并发更新采用宿主版本比较，过期patch丢弃；不根据文本做自动合并。

### 5.4 跨场景与失效

A→B时，A草稿休眠；返回时与A证据一起检查。问题本身可保留，但它所依赖的NPC状态、证据或来源变化时，假设和接续标为待重审或不再注入。依赖不明的自由文本不获跨状态“仍然成立”的承诺。

场景工作区也可以引用随行实体/调查thread，但不能把A的整个计划带入B。拒绝旧路线、纠正事实、改变目标都是新输入，不能让旧草稿把玩家拉回预定剧情。

删除Workpad应只丢失可重建提示，不删除正式状态。不能承诺随机性叙述逐字相同；可验证的是同一正式命令和随机源的内核结算不依赖草稿是否存在。

## 6. 候选召回：不能先漏掉，再指望重排找回

### 6.1 候选来源

候选取现有、已发布且有权访问的资料：当前场景包、近期离开的场景包、相关人物/物品、既有图关系、调查thread、规则参考和可达历史记录。未完成PDF阅读不因检索而变成可用内容。

先应用权限/世界线的硬边界，再做有界召回；对召回结果进一步做来源与状态有效性核验。元数据过滤、图邻居与语义召回是取并集的入口，不是互相替代。当前图之外的全量冷资料不得为了加速而预先扫描或调用阅读Agent。

### 6.2 主查询保持玩家原话

主查询是未经语义改写的玩家原文，加少量真实场景/实体上下文。辅助查询可加入有效Workpad的工作问题，但必须标为“上一轮提示”。保留主查询独立召回通道，两路并集后去重，防止旧假设只找支持自己的证据。

“我拿照片问他”中的“他”尚未解析时，不伪造 `target=老板` 字段。已有的正式ID、前端结构化选择或模型已明确返回的引用可以使用；其余由当前语义模型理解。首版不增加一个每轮必跑的查询改写模型，也不用名字关键词或正则决定玩家意图。

### 6.3 与现有代码的接口关系

保留 `ModuleGraph.search()` 的现行工具行为作为基线，不在一次优化中偷偷改其玩家态契约。新增宿主候选函数/接口，返回比公开8条更宽、但仍有硬上限的候选。

记忆候选提取复用 `queryCandidates()` 的 superseded、correction、类别和作用域处理，但不把 `capsuleMemory()` 已截断的6条作为唯一搜索空间。若首先只做静态资料，历史记忆入口保持关闭；不能把未实现的跨历史语义检索写成上线能力。

语义embedding召回是可选适配器。小型场景包可以直接交给重排器；大型集合使用已建立索引缩小候选。通用词法检索可以是基线或补充，但不得冒充自然语言意图解析。召回索引按资料版本增量更新，不每轮重建。

### 6.4 纠正、反证与规则条件一起保留

排序前后均保留来源结构中明确连接的更正/替代信息。历史错误引文被选中时，不能剥离其纠正关系；选一条规则时，必须考虑它的必要前置条件和例外。

以“证据组”而非任意断句作为最小装配单位。依赖闭包无法在预算内装下时，宁可只显示明确缺口的来源卡，允许后续查阅，也不能把残片包装成完整裁决依据。自由文本里的未知反证无法由宿主保证发现，应作为端到端评估风险，而不是宣称已经彻底解决。

## 7. Reranker：按需精排，不判真、不授权、不替KP决策

### 7.1 职责与部署边界

重排模型接收查询和有界候选，返回候选ID及相关度排序，不生成剧情事实、执行操作或修改草稿。Retrieve-then-rerank是官方文档支持的典型模式；大量query/document组合会增加计算成本，因此不直接重排全战役资料。[W1]

首版将其定义为宿主可插拔服务，不是新的Keeper工具，也不是内核规则依赖。不直接复用 `modelRegistry.complete()` 冒充专用rerank接口；本地或远程后端都需适配器明确支持。服务未配置时，静态工作集仍可使用。

### 7.2 调用条件

先获取有效候选和硬保留集合。可选候选足够少、且完整装入分配预算时，跳过rerank。只有需要取舍、服务已启用、候选量/输入量在限额内、当前延迟预算允许时才调用。

同一请求代次至多调用一次；没有新增候选、查询或依赖变化，不因后续每个工具返回而重复重排。超时、限流、格式错误、无效ID或取消时，立即使用既定确定性顺序，不串行重试，也不额外调用主模型“判断是否该重排”。

### 7.3 相关度不是真实性，更不是答案充分性

不同模型、激活方式和查询的分数不可机械比较。Qwen官方示例中可以返回raw logit差或经激活的值；Cohere说明分数依赖查询及候选，需要领域校准。[W2][W3]

本设计不使用 `score > 0.8` 表示“可以公开”“可以执行”或“资料充分”。重排也不能替代action admission、规则选择与最终来源核验。

给KP的是“已加载这些证据，其范围和遗漏如下”，不是“当前证据足够，禁止lookup”。仍允许正常补查；新增问题、缺少反证和范围外问题不能被缓存命中遮住。

### 7.4 必须绕过排序的内容

当前玩家原文、现有必要capsule、pending choice、当前session、真实本轮结算结果和正式义务语境不参与rerank竞争。Workpad也不是这些信息的替代来源。

Reranker只控制可选背景、旧场景详情、历史证据和参考规则。某条资料相关度低不等于它不存在；某条资料相关度高也不产生必须使用它的剧情任务。

### 7.5 工程接口与缓存

```typescript
interface Reranker {
  rank(input: {
    query: string;
    candidates: Array<{ id: string; text: string }>;
    modelRevision: string;
    signal: AbortSignal;
  }): Promise<Array<{ id: string; score: number }>>;
}
```

校验ID必须来自本次候选集、不得重复、分数为有限数。权威、权限和版本留在宿主侧，不能被远程模型返回值覆盖。最终注入前再检查请求绑定；过期排序不能应用到另一批同序号候选。

RankCache键包括模型/模板版本、精确查询、候选正文hash和相关作用域。Listwise后端必须绑定整组候选及顺序；只有适配器确认pairwise独立计算时，才可复用单个query-document分数。命中排序缓存不免除证据有效性检查。

### 7.6 参数与性能预期

模型选型先以中文/英文混合TRPG、别名、代词、反证及长片段的小型样本比较。Qwen3-Reranker-0.6B可作为一个公开多语言候选，不是已验证的赢家；其官方支持不能证明在用户设备上的吞吐、量化质量或打包可用性。[W2]

不写死100–500ms为实际延迟。是否值得调用应由下式及实测判断：

```text
Net benefit = avoided foreground work
              - retrieval/ranking/packing overhead
              - extra generation caused by added context
```

如果重排没有减少关键模型往返或有效阅读成本，就应保留接口而关闭实时重排。

## 8. 请求装配、预算与前缀稳定性

### 8.1 新增一个明确的宿主消息类型

拟新增 `coc-workspace`，内容包含选中的证据、简短Workpad和有界遗漏说明。每次context投影先移除此前该类型，再注入当前版本；重复调用必须幂等。它不是toolResult，不重建旧toolCallId，不把旧marker/receipt当成本轮可执行令牌。

`closedNoise()`、`foldPlan()`和未知消息归类必须同步识别新类型。否则它可能被当成未知宿主消息一路累积。持久缓存不复制进compaction summary；压缩后由L2恢复。保留原有ask边界与工具配对保护。[C2]

### 8.2 预算是双重约束

现有32KiB历史与默认384KiB请求预算不因新功能自动增加。KIC正文、草稿、索引和遗漏说明共同受一个总上限，并只能使用原请求真实剩余空间。先保留当前权威/授权语境，再装可重建资料。

现有bytes/token估计不当作精确计数。完整provider请求还应计系统说明、工具schema及输出预留；模型窗口不足时KIC减为零，不为了缓存删掉当前必要状态。[C2][C3]

以下是用于试验的起始配置，不是最佳值或性能承诺；均在读取配置时校验范围：

| 配置 | 起始建议 | 含义 |
| --- | --- | --- |
| `PI_COC_KIC_MODE` | off / shadow / on，默认off | 总功能模式。 |
| `PI_COC_KIC_BYTES` | 24 KiB | evidence、workpad、索引合计上限。 |
| `PI_COC_WORKPAD_BYTES` | 2 KiB | 已含在KIC预算内，不另加。 |
| 单次workpad_patch | 1 KiB | 超限丢patch，不修复重试。 |
| 活跃证据条数 | 最多24 | 同时服从字节预算。 |
| 候选检查上限 | 128 | 图扩展、store、索引统一计数。 |
| rerank候选上限 | 48 | 超出先做有界初召回，不发送全库。 |
| rerank总输入/单条 | 48 KiB / 2 KiB | 与后端token上限共同生效。 |
| rerank前台预算 | 500ms试验档，可配置 | 从排队开始计；超时退回，不承诺服务能达到。 |
| 单战役L2 / 总L2 | 128 MiB / 512 MiB | 正文、索引、草稿、rank缓存、临时文件均计入。 |

### 8.3 稳定排序，不为了复用牺牲新鲜度

在选定集合内尽量按稳定来源/条目顺序呈现；访问时间、命中次数和随机request ID不进入稳定正文。集合改变才替换，不每次摇动整个前缀。

当前 `briefForTurn()` 会比较本轮style并改变brief内容。[C2][C3] 因此“本地brief命中”也不等于provider前缀相同。Prompt Cache独立测量，首版不依赖它；本规格不声称服务保留了上一轮隐藏推理或KV状态。

## 9. 无副作用读取与版本绑定的代码接线

### 9.1 拟新增的内核读取贡献

在 `kernel-ts/read/workspace.ts` 定义纯快照投影，并通过现有HandlerGroup注册宿主专用 `table.workspace.read`。它不是Keeper可见工具；公开工具列表仍为七个。

读取可提供当前binding、来源清单、候选证据/引用和验证结果。复用现有CampaignSnapshot、ModuleGraph及来源加载逻辑，但明确禁止touchActing、legacy repair写入、掷骰、发布改编、推进时钟、创建记忆任务和启动source reader。

优先在现有 `table.player_input` / capsule响应中附带由同一快照产生的 `_workspace` 轻量清单，减少重复RPC。字段由宿主截留；不能直接污染玩家UI。确有缺失或状态变化时，再一次性补读，不逐条发起几十个look。

这个入口是设计新增；现有 `table.capsule({rehydrate:true})` 可参考其无写入恢复意图，但不能据此假定所有旁路都已纯读取。[C7]

### 9.2 请求绑定与来源绑定分开

```typescript
interface RequestBinding {
  campaign: string;
  worldline: string;
  loop: number;
  turn: number;
  runtimeEpoch: string;
  requestGeneration: number;
  stateStamp: string;   // new host/kernel-owned identity
  sourceStamp: string;
  audienceStamp: string;
}
```

静态证据ID不包含“每轮必变”的turn；但注入结果、异步rank结果、Workpad patch和当前状态视图必须绑定请求与世界线。`stateStamp`是新增能力，不把现有source_revision改名冒充它。

阶段一允许用一致快照的较粗指纹；规则内容/内核构建身份、改编覆盖层和投影schema另有版本。后续需要提高命中率时，才细化实体与集合依赖。若完整状态指纹成本过高，先不缓存动态派生视图，不能跳过验证。

### 9.3 谁生产，谁消费，谁据此行动

| 产物 | 生产者 | 消费者及作用 |
| --- | --- | --- |
| evidence及版本 | 内核纯投影/成功结果适配器 | EvidenceStore与Selector验证和注入。 |
| 场景/实体bundle | 宿主索引，依正式身份关联 | 下一请求恢复相关资料，不产生移动。 |
| Workpad patch | KP可选字段；宿主验证并绑定 | 后续KP及辅助检索；不进入正式义务。 |
| 失效通知 | 实际成功变更/来源发布与读绑定 | Controller刷新当前投影。 |
| rank结果 | 已配置Reranker适配器 | Selector选可选证据，不裁决剧情。 |
| coc-workspace | 唯一context投影层 | KP使用资料或按缺口补查。 |
| 测量记录 | 宿主span及既有telemetry | 维护者决定发布，不给KP新增压力。 |

### 9.4 拟议文件与改动范围

| 文件/区域 | 改动 |
| --- | --- |
| `extensions/table/context-runtime.ts` | 保留唯一安装入口；接KICController、准备去重、binding和取消。 |
| `extensions/table/context-policy.ts` | 新类型分类、预算、幂等替换与fold；不保留全部旧工具流。 |
| 拟新增 `extensions/table/workspace/` | controller、evidence-store、workpad、selection；按职责拆分，不建另一套Agent loop。 |
| 拟新增 `kernel-ts/read/workspace.ts` | 无写入快照/证据/版本入口；复用现有读模型。 |
| `kernel-ts/read/handlers.ts` | 注册宿主读取，不改变公开look/lookup语义。 |
| `kernel-ts/read/memory.ts`、`module-graph.ts` | 抽出可复用的候选提取；保留纠正/来源边界，最终截断延后到新入口。 |
| `extensions/kernel/tools.ts`、`index.ts` | 可选patch schema、提前剥离、成功交付后保存；提供真实变更通知。 |
| `runtime/host.ts`、拟新增 `runtime/rerank.ts` | 组合可选服务、鉴权、超时、取消、可写缓存根；不引入必需Python运行时。 |
| `prompts/keeper.md` | 解释证据/草稿/缺口/权威边界；不强迫写计划或使用已排序资料。 |
| `docs/specs/`及既有契约 | 写清新增宿主读取与注解；实施前在工作树核对kernel-rpc全文。 |

`runtime/host.ts` 已区分home、resourceRoot、contentRoot等位置，生产backend为TypeScript。[C11] 缓存放宿主配置的可写缓存域，不写安装资源目录；不假设旧数据库设计仍是本版运行时，不为本功能恢复Python或fork Pi。[C17][C18]

## 10. 生命周期与 A → B → A

### 10.1 标准时序

输入被内核接受后，取得当前capsule与binding；宿主准备有效资料和可选草稿，再进入首个KP请求。工具返回后，捕获适配器支持的证据；真实状态变化使依赖项失效。下一次模型请求前更新，而不是只在下一次玩家输入时更新。

交付成功后，保存该次可选patch和访问索引。缓存写盘不成为交付门禁。关闭、取消或新输入到来时，取消旧代次的可选rank任务；晚到结果不能进入新请求。

### 10.2 场景返回案例

玩家在A查过旅馆布局、老板背景和登记簿，撬门并拿走一封信；去B找到照片，再回A问老板。

| 阶段 | 当前上下文 | 持久层与正确性 |
| --- | --- | --- |
| 在A调查 | A资料、当前状态、工作问题 | 已查来源存L2；撬门/拿信走正式记录。 |
| 进入B | B相关资料，信件/调查的必要关联 | A bundle和草稿休眠，不复制全部到B。 |
| B得到照片 | 当前照片证据及真实取得结果 | 新证据不自动证明旧假设；更新角色知识靠正式路径。 |
| 回到A | 最新A状态 + A有效资料 + 照片关联 + 可用草稿 | 老板位置/态度读取现在；不会把信放回桌上。 |
| A资料超过本轮预算 | 可选rerank选与照片/老板有关证据 | 不把A全包重读；未选中的仍在L2。 |

本例中的“老板被带走”“门重新上锁”只有在既有系统已合法记录时才作为变化；KIC不新增离场世界模拟器。真正到期待办走正式机制，不靠A缓存是否常驻。[C5][C8]

同一玩家回合里先move再继续行动时，也必须更新新场景的资料。移动请求被拒则不能切换实际场景；仅可把目标地点作为未到达的参考，不能描述已抵达。

### 10.3 回溯、循环与分支

切线或循环后重新以正式状态绑定。A是同名场景并不代表同一循环和角色知识。父线中正式继承、且当前线可达的历史记录可按原系统读取；不能一概丢掉父线，也不能按turn数字串读兄弟线。

跨线静态正文最多做物理去重，每次使用仍需当前权限与来源验证。Workpad、动态视图和rank快照不自动merge；正式合并结束后重建它们，不让缓存参与世界冲突裁决。

## 11. 失效、一致性与存储治理

### 11.1 失效规则

| 事件 | 处理 |
| --- | --- |
| 只过一轮或离开场景 | 静态资料继续有效；调整L1选取，保留L2。 |
| NPC/物品/角色知识/时钟发生真实变化 | 依赖项失效；当前状态刷新；相关草稿待重审。 |
| source/规则/扩展/语言/投影版本变更 | 相关来源视图失效；首版允许保守大范围失效。 |
| 新NPC加入原先空集合 | 集合版本失效；不能只检查旧返回行的版本。 |
| 工具失败、超时 | 不凭请求推断变化；结果不明确时重新读当前状态。 |
| 批次部分落地 | 只依真实已落地部分更新；收据保持原语义。 |
| 异步记忆/来源发布 | 按受影响读域失效；不等下一回合才发现。 |
| 排序期间scope/state变化 | 旧结果不注入；退回当前有效确定性集合，避免无限重算。 |
| patch并发、来源失效 | 丢弃或降为待重审；不自动把旧计划当现行计划。 |

### 11.2 动态依赖留作第二阶段

第一阶段继续提供完整必要当前capsule与本轮结果，仅复用静态资料。后续动态派生缓存记录实体、集合、权限与查询谓词的完整依赖；模型不能声明自己已列全依赖。

增量更新要求from/to版本连续且覆盖完整；丢事件、冷启动、超时后状态不明或回溯时全量刷新对应当前视图。不把“上轮世界 + 可能不完整delta”作为唯一世界输入。

### 11.3 持久化与淘汰

EvidenceStore使用内容寻址正文和可重建索引，Workpad按绑定场景维护短版本，不逐轮保存整份上下文。首版单宿主可采用本地文件适配器与原子替换；另留接口接既有部署存储，不新增事实数据库。

当前请求短暂pin；空间允许时保护最近离开的少量场景，减少A/B抖动。配额是硬上限，pin不能越过它。缓存配额同时包括rank结果、索引、草稿和临时写入预约空间；GC只动L2。损坏/写盘失败降为miss，不破坏L3。

多会话写入采用宿主锁或单写者，并按revision比较；草稿冲突不通过新模型解决。正式交付成功后，缓存写盘失败只影响下次命中。缓存关闭/删除不触发游戏Git提交或存档迁移。

## 12. 隔离与失败降级

### 12.1 接收者隔离

Keeper工作区可能含秘密，不能作为一个通用上下文包自动传给AI玩家、玩家UI、公开日志或action admission。准入审查仍只获取它原本允许的玩家可见语境；KP草稿不能作为“玩家选过”的证据。[C14]

远程rerank属于新增的数据接收者。没有已配置的服务和数据发送许可时不自动发出秘密资料。按最小必要字段构造输入，凭证留宿主侧；日志默认记录hash、ID、长度和耗时，不记录秘密正文。云端/本地是配置选择，不自动下载大模型或临时拉起Python服务。

### 12.2 数据不是指令

原文、历史台词和草稿都以引用数据传入；不执行其中“忽略规则、提前公开”等指令。reranker返回只允许ID/分数，不能带来新正文、权限或工具参数。即使相关度很高，也不得把未知事实提升为已公开信息。

### 12.3 降级表

| 故障 | 行为 |
| --- | --- |
| KIC读取、索引或缓存失败 | 省略可选工作区，走既有查询。 |
| 来源版本/权限不可验证 | 不把旧副本作为当前合法证据。 |
| Workpad缺失、损坏、超限 | 省略草稿；不新增修复回合。 |
| Reranker失败、冷启动过慢、限流 | 截止后确定性选择；不重试阻塞。 |
| 关键当前状态不可获得 | 沿既有错误/恢复路径；不拿草稿或旧缓存充数。 |
| 必需上下文本身超预算 | KIC置零；明确容量问题，不静默删授权语境。 |

可选层fail-open的含义是“没有它仍使用原有安全路径”，不是“审查失败就放行行动”。

## 13. 性能目标、遥测与实验

### 13.1 端到端指标

主指标为输入被接受到正式剧情交付的p50/p95及成功率。工具状态、思考流和占位提示不计为剧情交付；失败、超时、取消不能从总体报告消失。

复用既有context、tool、provider telemetry，再加入：

| 维度 | 字段/定义 |
| --- | --- |
| 关键路径 | kp_provider_rounds、foreground admission/review/source spans、input_to_delivery。 |
| 证据复用 | found / valid / injected分别统计；重复查询按来源和范围，不按自然语言字符串相同。 |
| 草稿 | patch bytes、accepted/dropped、stale、额外输出tokens；不把写草稿次数当收益。 |
| 重排 | skipped_by_reason、queue/inference/total_ms、候选/输入量、timeout、回退、RankCache命中。 |
| 上下文 | 工作区字节、总消息与完整请求token估计/实测、截断/依赖组省略。 |
| 质量 | 必要证据召回、纠正/反证遗漏、旧状态使用、提前揭示、未经授权行动、重复结算。 |
| 存储 | 正文/索引/草稿/rank缓存及临时空间，eviction、rebuild、场景恢复耗时。 |

注入不等于采用，采用不等于避免一次工具调用。只有对照实验才能归因。并行span不能简单相加成玩家等待时间。

### 13.2 消融矩阵

| 组 | 配置 | 检验问题 |
| --- | --- | --- |
| A | 冻结现有代码 | 原始基线。 |
| B | A + 静态持久工作集/场景恢复 | 资料保留本身是否有效。 |
| C | B + 可选Workpad | 草稿收益是否超过额外生成与上下文成本。 |
| D | B + 按需rerank，无草稿扩展 | 重排自身的效果。 |
| E | B + Workpad + 按需rerank | 两者是否互补，是否被旧草稿带偏。 |
| F（后续） | 单独打开动态依赖或embedding召回或历史增量 | 避免将多个改动归为rerank收益。 |

先做固定快照与行动轨迹，随后使用仓库规定的真实Pi运行路径验证。固定模型、思考设置、准入和连续性审查策略、E0开关、prompt版本、来源版本及暖缓存历史；再按冷启动、同场景、A/B返回、来源变更、战斗和长流程分层报告。

重复回放需要记录rank原始结果和模型版本，不能假定远程rerank永远确定。动态玩家会因文本改变行动，端到端自然互动与固定轨迹结果要分开。

### 13.3 发布门槛

正确性硬门禁：在验收范围内新增跨线污染、权限越界、旧凭据复用、重复结算、消息配对破坏和缓存导致的关键状态丢失为零。排序不能以漏掉反证换速度。

性能阈值在基线实验前冻结。可沿用v1候选目标：重复资料场景重复查询下降30%、交付p50下降15%、混合场景p95退化不超过5%；这些仅是待验证目标。Workpad与rerank需分别证明增量收益，不因总包有效就默认两个组件都应启用。

若B有效而C/D无改善，则先发布B。若主要延迟在前台准入或交付审查，另立优化项目，不在本设计里降低审核强度后宣称缓存提速。

## 14. 实施切片与回滚

### P0：基线与契约核对

在实际工作树确认当前主线、读kernel-rpc相关全文、核对工具schema/执行钩子顺序与完整请求预算。冻结基线与样本，画出真实前台span。明确读元数据不足的类型，而不是靠模型猜依赖。

### P1：纯读取、证据存储与shadow

增加宿主无副作用证据入口和binding，完成静态适配、L2、场景/实体bundle、配额和恢复。shadow仅选择并计量，不修改主KP请求；可选rank shadow不阻塞基线请求，也不抢占前台资源。

### P2：有界注入与场景恢复

接入唯一context投影、fold分类、同回合失效、重启与A→B→A。只有静态证据，不增加模型调用。P0—P2构成首个可发布闭环；场景返回不是长期留后项。

### P3：可选Workpad

新增交付工具的host-only patch、版本比较、成功交付关联、场景休眠和待重审。以C对B消融验证。首版不运行自动语义总结，不改变apply note/ruling。

### P4：按需rerank

加入有界候选入口、服务适配器、硬截止/回退、rank缓存及纠正/条件依赖装配。比较D/E；服务不配置时等价于无rerank，不以它为整个工作区的可用性前提。

### P5：按瓶颈推进

动态依赖粒度、历史原文增量、语义embedding冷召回、provider前缀缓存和大规模skill选择分别立实验。现有三张E0卡保持原样；不为了架构完整把所有可选项一次上线。

回滚按KIC、Workpad、rerank独立开关。off模式不注入、不触发新增服务或模型；已存在L2可保留待后续GC，但世界记录不动。schema不兼容只重建缓存，不迁移或重写正式历史。

## 15. 验收用例与交付定义

### 15.1 核心用例

| ID | 场景 | 必须断言 |
| --- | --- | --- |
| KIC-01 | 连续追问同一NPC | 下一首次请求有有效证据；不新增必跑总结。 |
| KIC-02 | A→B一轮→A | A休眠而非被切图删除；返回恢复资料。 |
| KIC-03 | 返回前NPC离开/门被锁 | 当前正式状态优先，静态背景仍复用。 |
| KIC-04 | 信件或NPC跨图 | 按实体/thread关联加载，不只按地图。 |
| KIC-05 | 同回合成功move后继续 | 下一模型请求切换资料与状态；拒绝move不切图。 |
| KIC-06 | 重复攻击 | 规则证据可复用，新骰点和行动资源仍结算。 |
| KIC-07 | 玩家的行动被纠正 | 不继承授权，旧Workpad不覆写新输入。 |
| KIC-08 | 临时草稿被保存 | notes.jsonl、rulings、义务与正式事件不因草稿改变。 |
| KIC-09 | 不写/写坏/写超限patch | 合法交付照常；不新增修草稿模型回合。 |
| KIC-10 | narrate失败/取消/关闭后被拒 | 不发布对应草稿为成功进度。 |
| KIC-11 | ask携带草稿 | 不提前写成玩家已选答案；原pending语境保留。 |
| KIC-12 | 旧假设与玩家新证据相反 | 保留原话检索通道，纠正/反证未被草稿挤走。 |
| KIC-13 | 已有note/正式承诺跨场景 | 继续原义务路径；不依赖Workpad常驻。 |
| KIC-14 | 缓存预取 | 无touchActing、无骰点、无call_id、无发布/阅读任务。 |
| KIC-15 | 正确证据原排序第9名之后 | 有机会进入新候选入口；不是只重排已截断8条。 |
| KIC-16 | 旧记忆被纠正 | conversation_report权威不变，替代关系不被精排剥离。 |
| KIC-17 | 高分错误/过期资料 | 有效性或权限过滤拦截，高分不放行。 |
| KIC-18 | 重排低分/遗漏相关证据 | 未选中不等于不存在；允许正常lookup。 |
| KIC-19 | 候选全部可装入 | 跳过rerank，不增加服务等待。 |
| KIC-20 | rerank超时/限流/冷启动 | 期限内退回，无串行重试，无额外解释模型。 |
| KIC-21 | rank返回重复/未知ID/NaN | 拒绝该结果，仍可确定性选择。 |
| KIC-22 | listwise候选改变 | 不能误用旧单条分数缓存。 |
| KIC-23 | 规则前置条件放不下 | 不把残片当完整依据；明确缺口或后续读取。 |
| KIC-24 | 新人进入旧空集合 | 动态阶段集合依赖失效；首版不启用此类旧视图。 |
| KIC-25 | 同回合状态变化/部分落地 | 按真实结果失效；当前收据不被旧缓存替代。 |
| KIC-26 | source/规则/语言/适配器更新 | 对应投影失效，包含独立规则版本。 |
| KIC-27 | 世界线同turn同场景 | 动态状态、草稿、角色知识不串线。 |
| KIC-28 | loop/merge/父线继承 | 按正式可达性重组；不以缓存merge裁决世界。 |
| KIC-29 | 异步rank/记忆/来源晚到 | 绑定核验；不注入错误请求或分支。 |
| KIC-30 | 重启、损坏、淘汰、写盘失败 | miss可重建；正式存档不丢，已交付不反转。 |
| KIC-31 | 多次context/fold | workspace幂等，不变未知消息累积；工具配对有效。 |
| KIC-32 | 超长资料/稠密图/200回合夹具 | L1、候选遍历、索引、L2含临时空间均受限。 |
| KIC-33 | admission与玩家UI读取 | 不收到Keeper草稿/秘密包。 |
| KIC-34 | 缺少远程数据许可 | 不发送资料；原工作集仍可用。 |
| KIC-35 | 来源含诱导指令 | 作为数据；不能授予权限或写入工具参数。 |
| KIC-36 | 独立关闭各组件 | 原查询和结算可用；相同正式命令的内核结果不受缓存影响。 |

### 15.2 三层验证

确定性单测验证适配、版本、预算、配对和权限；集成测试验证真实Pi钩子及内核读取没有副作用；真桌/端到端验证KP是否实际少查、是否改变玩家自主性和体验。夹具回合数与测试数量不等于体验通过。

本次设计未执行这些测试，未得出加速倍数。实现完成应交付：代码与契约、冻结基线、候选与实际输入证据、模型/工具/审查span、质量反例和独立消融结果；不是只交一个漂亮的缓存命中率报表。

> **最终原则：权威状态管现在；证据缓存管查过什么；Workpad管暂时在处理什么；reranker只管有限上下文里先展示什么。四者不能相互冒充。**

## 16. 来源与证据范围

代码引用固定到上述SHA，不表示已执行代码或完整审计整个仓库。源文件中的旧注释与当前生产入口可能不一致时，本规格明确以已读执行路径及runtime类型为依据；不恢复已退役的Python实现。

**[C1] `GitHub 分支列表`** — 确认 0.9.3a 的 HEAD。

[查看来源](https://api.github.com/repos/Leehow/chatrpgv4/branches?per_page=100)

**[C2] `extensions/table/context-policy.ts`** — historyView、closedNoise、projectedMessages、foldPlan、briefForTurn。

[查看来源](https://github.com/Leehow/chatrpgv4/blob/983f359f9aa4f8b3ffc2075bd8ce7696da9cb1a7/extensions/table/context-policy.ts)

**[C3] `extensions/table/context-runtime.ts`** — prepare、sourceOf 缓存、context hook、sourceCalls 失效与原文读取。

[查看来源](https://github.com/Leehow/chatrpgv4/blob/983f359f9aa4f8b3ffc2075bd8ce7696da9cb1a7/extensions/table/context-runtime.ts)

**[C4] `kernel-ts/read/context.ts`** — sourceRevision、contextBinding；来源版本不等同全部动态状态版本。

[查看来源](https://github.com/Leehow/chatrpgv4/blob/983f359f9aa4f8b3ffc2075bd8ce7696da9cb1a7/kernel-ts/read/context.ts)

**[C5] `kernel-ts/read/memory.ts`** — queryCandidates、capsuleMemory、hitView、noteObligations、rulingsForCapsule。

[查看来源](https://github.com/Leehow/chatrpgv4/blob/983f359f9aa4f8b3ffc2075bd8ce7696da9cb1a7/kernel-ts/read/memory.ts)

**[C6] `kernel-ts/read/module-graph.ts`** — search、entityView、adaptationOrigin。

[查看来源](https://github.com/Leehow/chatrpgv4/blob/983f359f9aa4f8b3ffc2075bd8ce7696da9cb1a7/kernel-ts/read/module-graph.ts)

**[C7] `kernel-ts/read/handlers.ts`** — requireNoTransition、table.look、table.lookup、table.capsule。

[查看来源](https://github.com/Leehow/chatrpgv4/blob/983f359f9aa4f8b3ffc2075bd8ce7696da9cb1a7/kernel-ts/read/handlers.ts)

**[C8] `kernel-ts/apply/bookkeeping.ts`** — stageNote、stageRuling、正式收据与事件。

[查看来源](https://github.com/Leehow/chatrpgv4/blob/983f359f9aa4f8b3ffc2075bd8ce7696da9cb1a7/kernel-ts/apply/bookkeeping.ts)

**[C9] `extensions/kernel/tools.ts`** — 七动词、WRITE_TOOLS、UsingSkill、工具参数schema。

[查看来源](https://github.com/Leehow/chatrpgv4/blob/983f359f9aa4f8b3ffc2075bd8ce7696da9cb1a7/extensions/kernel/tools.ts)

**[C10] `extensions/kernel/index.ts`** — takeSkillAnnotation、projectSkillCards、before_agent_start、runTool、交付及telemetry。

[查看来源](https://github.com/Leehow/chatrpgv4/blob/983f359f9aa4f8b3ffc2075bd8ce7696da9cb1a7/extensions/kernel/index.ts)

**[C11] `runtime/host.ts`** — RuntimeContext、HostRuntime、RuntimeCapabilities、composeRuntimeContext。

[查看来源](https://github.com/Leehow/chatrpgv4/blob/983f359f9aa4f8b3ffc2075bd8ce7696da9cb1a7/runtime/host.ts)

**[C12] `extensions/thinking-schedule/index.ts`** — 回合内部思考档位调度。

[查看来源](https://github.com/Leehow/chatrpgv4/blob/983f359f9aa4f8b3ffc2075bd8ce7696da9cb1a7/extensions/thinking-schedule/index.ts)

**[C13] `content/skills/draft.json`** — 三张E0过程卡；不是大量技能库。

[查看来源](https://github.com/Leehow/chatrpgv4/blob/983f359f9aa4f8b3ffc2075bd8ce7696da9cb1a7/content/skills/draft.json)

**[C14] `extensions/kernel/admission.ts`** — 玩家自主行动的独立准入与公开语境。

[查看来源](https://github.com/Leehow/chatrpgv4/blob/983f359f9aa4f8b3ffc2075bd8ce7696da9cb1a7/extensions/kernel/admission.ts)

**[C15] `extensions/memory/index.ts`** — 交付后记忆提取、候选而非自动提升为事实。

[查看来源](https://github.com/Leehow/chatrpgv4/blob/983f359f9aa4f8b3ffc2075bd8ce7696da9cb1a7/extensions/memory/index.ts)

**[C16] `extensions/kernel/verifier.ts`** — 交付后咨询式校验，不阻塞既有交付。

[查看来源](https://github.com/Leehow/chatrpgv4/blob/983f359f9aa4f8b3ffc2075bd8ce7696da9cb1a7/extensions/kernel/verifier.ts)

**[C17] `Agents.md`** — TypeScript生产边界、三端接线原则、当前主线与验收要求。

[查看来源](https://github.com/Leehow/chatrpgv4/blob/983f359f9aa4f8b3ffc2075bd8ce7696da9cb1a7/Agents.md)

**[C18] `docs/pi-host-contract.md`** — Pi扩展面、宿主组合、七动词与不fork边界；部分历史段落不能替代当前代码。

[查看来源](https://github.com/Leehow/chatrpgv4/blob/983f359f9aa4f8b3ffc2075bd8ce7696da9cb1a7/docs/pi-host-contract.md)

**[W1] Sentence Transformers：Retrieve & Re-Rank** — 核对召回后精排的分工，以及大量query/document组合的计算开销。

[查看官方资料](https://sbert.net/examples/sentence_transformer/applications/retrieve_rerank/README.html)

**[W2] Qwen 官方模型卡：Qwen3-Reranker-0.6B** — 核对多语言、指令适配和分数形式；未采用其基准成绩作为本项目效果。

[查看官方资料](https://huggingface.co/Qwen/Qwen3-Reranker-0.6B)

**[W3] Cohere：Rerank Best Practices** — 核对query-dependent分数及领域阈值校准；不据此证明资料真假或答案完整。

[查看官方资料](https://docs.cohere.com/docs/reranking-best-practices)

**设计输入：** 本次关于 Working Set、A→B→A、Workpad 与 reranker 的讨论，以及 `chatrpgv4-keeper-working-set-v1.0.md`。本版第1节列出对先前未收敛表述的修正；外部文档只支持通用机制，不替代代码、测试和真桌证据。
