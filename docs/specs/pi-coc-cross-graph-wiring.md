# Pi-Coc 跨图谱接线规范（RuleGraph × DirectorGraph × TextGraph × ModuleGraph）

> **Status:** Approved 2026-09-02 — W1/W2/W3 实施切片全部落地；W1 门 5 的桥机制已获真实游玩证明，非空公开效果绑定待自然发生（见 [w1-bridge-live-evidence](../status/w1-bridge-live-evidence.md)）。
> **ID:** `pi-coc-cross-graph-wiring`
> **Track:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`；Codex-host 实现、适配器、提示词、启动器、测试、文档不在本规范范围内。
> **Scope owner:** `plugins/coc-keeper/` 内的系统本体组合层（ADR 0003 registry）与各图谱的接地面。
> **Last updated:** 2026-09-02（起草；证据基线 `0.8.1a@932060fa` + 当日未提交的 T5 工艺调参）
> **Depends on:** [ADR 0003 system ontology composition registry](../adr/0003-system-ontology-composition-registry.md)、[pi-coc-rule-graph-runtime](pi-coc-rule-graph-runtime.md)、[pi-coc-director-graph-runtime](pi-coc-director-graph-runtime.md)、[pi-coc-text-graph-runtime](pi-coc-text-graph-runtime.md)、[module-graph-to-kp-integration](module-graph-to-kp-integration.md)、[`docs/ruleset-contract.md`](../ruleset-contract.md)。

本文中的 MUST / MUST NOT / SHOULD 是验收要求。

---

## 1. User job、成功条件与空洞交付

用户已经把 KP 的规则层、导演层、文字层（以及模组层）分别知识图谱化，四层都有生产工件、
合同与编译器。缺的是它们之间的**接线**：跨图的语义引用、接地边和可审计的渲染路径。
用户要求把已量到的缺陷补上。

成功意味着：

- 规则层结算出的公开效果，文字层能**以规则语义身份**（`effect:coc7:*`）消费并渲染，
  「哪个规则效果被哪段玩家可见输出兑现」变成机器可检查的 `renders-settled-output` 边，
  而不是只存在于 state receipt 摘要里、两层互不相识；
- 导演层的教义值尽可能接地到十族 RuleGraph 的真实 decision / condition path，
  接不上的部分以**生成的、测试守护的账本**诚实记账，而不是停在 2026-08-31 的旧理由上；
- The Haunting 的 authored 机制声明与 coc7 RuleGraph 的 Rule/Decision semantic id
  精确对齐（或明确记为「真模组专属、无规则对应」），`module → rule` coverage 从
  `no-proven-instance` 前进；
- 所有接线都走 ADR 0003 registry：typed relation、fail-closed 校验、权威面不变；
- 每一层的 Keeper 可见面、行为与既有测试断言不因接线而改变（除非切片明说要改，
  且改的是「多了可审计性」，不是「换了行为」）。

空洞交付包括：

- 在消费端不存在时画边——22 条 `renders-settled-output` 边宣称一条无人能兑现的渲染路径，
  与 T1 伪造 `source_kind` 同罪（TextGraph spec 更正 14 已定此判例）；
- 为了凑边数新建第二套效果命名空间、第二个渲染引擎或通用图解释器；
- 把「画了边」当成「接了线」：边只是接线的**可检查投影**，真接线是运行时路径；
- 给导演层或文字层新增任何权威：接线不改变 advisory / presentation 权威面；
- 新增模型可见操作来暴露接线（接线是宿主内部可审计性，不是 KP 新工具）；
- 为了对齐而改写 RuleGraph 的规则语义，或为了对齐而改写模组 authored truth 的含义；
- 用 `module.haunting.*` 与 `decision:coc7:*` 的模糊相似画 `uses-rule`——ADR 0003
  决策 4 要求 `module_rule_ref` 与目标 semantic id **精确相等**；
- 声称接线完成而没有任何一次真实正常游玩回合把 W1 桥走过一遍。

---

## 2. 范围

| In scope | Out of scope |
| --- | --- |
| `effect:coc7:*` → state receipt → finalization → TextGraph 的运行时桥（W1） | 新效果命名空间、第二渲染路径、通用图解释器 |
| `renders-settled-output` 真边 + registry text coverage 升级 | 改变义务推导逻辑本身（T2 已交付，位等价不动） |
| Director doctrine 对十族 RuleGraph 的接地扩展 + 未接地账本（W2） | 调任何教义值（D5b 另属 director spec） |
| The Haunting authored 机制与 coc7 decision id 对齐（W3） | 导入 PDF 模组的对齐（归 source-pipeline-unification） |
| ADR 0003 registry 的 references / relations / coverage 更新 | 新权威面、新操作面、权威面升降级 |

---

## 3. 已量到的缺陷清单（证据基线 2026-09-02）

接线基础设施**不缺**：`system-ontology-registry-v1.json` 登记 6 张图、127 个语义引用、
109 条 typed relation，`coc_system_ontology.py` fail-closed 校验。缺的是跨层实例。

| # | 接缝 | 现状 | 证据 |
| --- | --- | --- | --- |
| 1 | 文字层 ↔ 规则层 | **0 条 `renders-settled-output`**。23 个 `effect:coc7:*` 节点（22 public / 1 keeper-only）整棵树无一处读取；506 条历史 finalization 0 次出现。文字层渲染的是 `turn-effect-v1:<digest>` / `exceptional-effect-v1:<digest>`（`coc_turn_finalization.py:799`、`coc_exceptional_effects.py:78` 摘要派生），与规则层 `mp-spent` / `chase-ended` / `one-use-penalty-die` 词汇不相交，无映射。唯一词汇巧合 `luck_spend` 属于唯一 keeper-only 效果。 | `docs/status/text-grounding-gap.md`（`scripts/gen_text_grounding_ledger.py` 生成，`tests/test_text_graph.py` 防漂移）；TextGraph spec 更正 14/15/16 |
| 2 | 导演层 ↔ 规则层 | 仅 3 条 `grounded-by`（dying-clock ×2、dying-subsystem ×1 → dying 族）。registry coverage reason 称 push-luck / pacing「在 RuleGraph 中仍未解析」——该理由写于十族 cutover 之前，**已过时**：push-luck 族已晋升且有真实结算记录。 | `system-ontology-registry-v1.json` relations；DirectorGraph spec 实现日志 D3 |
| 3 | 导演层 ↔ 模组层 | **0 条**。D3 原计划把 storylet 接地到 ModuleGraph scene/clue，未交付；依赖 Graph → Scenario IR 投影（该投影属 `module-graph-to-kp-integration`，pending）。 | DirectorGraph spec §8 D3 |
| 4 | 模组层 ↔ 规则层 | `no-proven-instance`。The Haunting ModuleGraph 有 8 处 authored 机制身份（7 个唯一）：`corbitt_own_dagger`、`chapel_weakened_floor`、`damaged_liber_ivonis_initial_read`、`corbitt_flesh_ward`、`corbitt_animate_body`、`corbitt_floating_knife_mp`、`conclusion_sanity_reward`，没有一个与十族 RuleGraph 的 Rule/Decision semantic id 精确相等。 | `starter-scenarios/the-haunting/module-graph.json`；ADR 0003 修订版第 7 条 |
| 5 | 规则层 → 模型可见投影 | 不属于跨图接线但同源：结算落账后若投影失败，Keeper 只拿 `semantic_identity_unavailable` 重结。十族中 Healing、Combat、Sanity（r35 前）、Chase、Magic 缺少正常游玩结算证据；SAN 族已于 2026-09-02 r35 打通（3/3 lane 收尾）。 | RuleGraph spec §0/§16.1；`docs/status/sanity-family-playable-20260902.md` |

相邻发现（**不入本规范**，单列）：

- `grant_binding_drifted`：card grant 绑定退化为整个事实集摘要，任何事实一动作废所有授权。
  属规则层↔状态层授权绑定粒度问题，`docs/status/sanity-family-playable-20260902.md` 明记
  「留给用户拍板」；收窄有正确性风险，需独立探针证据后再立切片。
- `docs/新 pi-coc 的重新设计.md`（Chronicle Kernel）为未跟踪提案稿，未采纳；本规范以
  ADR 0003 现有架构为基准。若新架构立项，接线由其迁移 spec 重新定义。

---

## 4. 绑定设计决策

1. **Registry 是唯一接线面。** 一切跨图关系进 `system-ontology-registry-v1.json`，
   走 `coc_system_ontology.py` 校验。不建第二张连线表、不建图数据库、不建通用解释器
   （ADR 0003 决策 + 被拒方案不变）。
2. **运行时桥先于边。** 一条 `renders-settled-output` / `grounded-by` / `uses-rule` 边
   只有在消费端真实存在时才允许画入。消费端不存在而画边 = 空洞交付（§1）。
3. **语义身份平行挂载，不进摘要。** 规则效果的语义身份以结构化字段
   （`rule_effect_ref`）挂在既有 state-effect 载荷上，**不改** `turn-effect-v1:<digest>`
   的摘要构成——旧收据的摘要与重放必须位等价。
4. **不新增模型可见操作。** 接线是宿主内部可审计性。`turn.finalize`、`rules.settle`、
   `director.advise` 等现有操作面 schema 不变，操作数不变。
5. **权威面零变化。** RuleGraph rules-semantics、Director advisory、Text presentation、
   Module authored-source：接线不改任何一面。导演层仍只 `grounded-by`，文字层仍只
   `renders-settled-output`，模组层仍不能直接调执行器或写 state。
6. **keeper-only 效果永不可渲染。** `effect:coc7:push-luck:luck-spend-mutate` 不得成为
   任何 `renders-settled-output` 目标；守护从 RuleGraph 派生（既有测试已守），新出现的
   keeper-only 效果自动覆盖。
7. **缺口用生成的账本记账。** 接不上的地方产出可再生、被测试比对的文件
   （`text-grounding-gap.md` 模式），理由写测量结果，不写会腐烂的句子。
8. **行为位等价是默认验收。** 每个切片的迁移部分对既有行为位等价；唯一允许的新增是
   「多了一条可审计的边/字段」。任何行为变化必须单列为实验切片（本规范不含）。
9. **真边必须有真游玩证据。** W1 桥的验收包含一次正常 `pi-coc --mode rpc` 生产 profile
   游玩回合：结算一个公开规则效果 → 回合收尾 → 该效果的渲染可在最终记录中指认
   （Plugin-Native Acceptance Contract：不用脚本玩家、不批处理、不用验收 profile）。

---

## 5. 切片

每个切片需要单独授权。顺序只表达依赖：W1 独立可行；W2 独立可行；W3 独立可行。
三者无硬先后，但 W1 是产品价值最大的一条桥（缺陷 #1 是唯一「消费端不存在」级缺口）。

### W1 — 规则效果 → 文字渲染第一桥（RuleGraph → TextGraph）

**交付物：**

1. **运行时桥**：`rules.settle` 在 graph-owned 族结算并发出公开效果时，其产生的
   state-effect 载荷（`turn-effect-v1` 路径）携带结构化 `rule_effect_ref`
   （`effect:coc7:<family>:<decision>-<effect>`）。`exceptional-effect-v1` 路径同样处理。
   摘要派生身份构成不变（设计决策 3）。
2. **消费端**：`coc_turn_finalization.py` 的 coverage / mechanics 渲染路径读取
   `rule_effect_ref`：公开可见机械变化按既有 Rule 4 要求渲染一次；该字段使「哪条
   效果被哪个段落/机制块兑现」进入 finalization 记录，可被导出与战报证据引用。
   无 `rule_effect_ref` 的旧记录路径完全不变。
3. **声明边**：仅为真实存在的消费对画 `renders-settled-output`（TextGraph 编译器校验器
   已上线：目标必须存在、必须是 `effect` 节点、必须 public，四类探针测试在守）。
4. **账本更新**：`scripts/gen_text_grounding_ledger.py` 从 0 边变为真边清单 +
   仍未桥接效果的**原因分类**（无渲染语义对应 / 尚无消费端 / keeper-only）；
   registry text coverage reason 同步更新，`no-proven-instance` → `instance-linked`
   （若仅部分效果桥接，coverage reason 必须写明桥接集与未桥接集，不得笼统升级）。

**试点族选择**：从「已有正常游玩结算记录」的族中选——截至证据基线为
development、social、sanity（`sanity-family-playable-20260902.md` 之后含 sanity 的
bout-tick 效果）。不为桥而首次游玩一个从未结算过的族；那属于缺陷 #5 的家族晋升工作。

**门：**

1. 旧收据位等价：506 条保留 finalization 记录重放逐字节复现（T2 重放门原样通过）；
   不带 `rule_effect_ref` 的载荷摘要与行为完全不变。
2. `tests/test_text_graph.py` 全绿，含既有四类校验器探针（悬空 / 错类 / keeper-only /
   无 RuleGraph fail-closed）与 `test_zero_edges_is_the_measured_outcome_not_unfinished_work`
   的语义翻转——该测试改为断言**测量结果与账本一致**，不再断言零。
3. `coc_system_ontology.py` 校验干净；新边全部解析到真实 `rule.effect` public 节点。
4. keeper-only 守护测试全绿（`luck-spend-mutate` 不可达渲染；守护仍从图派生）。
5. 真实游玩证据：一次正常 `pi-coc --mode rpc`（生产 profile、真 KP、本会话当唯一玩家）
   回合，结算试点族一个公开效果并收尾；最终记录中该效果的 `rule_effect_ref` 与其
   渲染段落可指认；`coc-export-battle-report` 证据包含该绑定。
6. 不新增任何模型可见操作；操作数不变。

### W2 — 导演层 → 规则层接地扩展（DirectorGraph → RuleGraph）

**交付物：**

1. **重新测量**：写生成器（`text-grounding-gap` 同款模式），把 117 个教义节点逐一
   比对十族 RuleGraph 的 decision / effect / registered condition path，分类：
   可接地 / 目标尚不存在 / 读的是 pacing state 而非注册 condition path / authored 无源。
2. **接地**：对所有「可接地」节点画 `grounded-by`（registry references + relations），
   证据类随之从 `authored-doctrine` 改判的，按 DirectorGraph spec §5 的字段要求补齐。
3. **未接地账本**：生成文件列明每个未接地节点的原因分类；registry director coverage
   reason 改为指向账本，删掉「十族 cutover 前写的过时理由」。
4. **pacing live-state**：若导演层读取的 pacing 事实要进 `requires/grounded` 关系，
   其 condition path 必须先在 RuleGraph 合同注册（ADR 0003 决策 2：live-state 只允许
   已登记 condition path）；注册不了的保持无接地并在账本说明。

**门：**

1. 行为位等价：D4 的 150 行决策矩阵重放不变（`checks/` 基线）；不编辑任何导演测试断言。
2. 新 `grounded-by` 目标全部解析；`coc_system_ontology.py` 干净；无环、无权威越界
   （导演层仅 `grounded-by`，ADR 0003 决策 5）。
3. 账本可再生且被测试比对；过时理由字符串在树中消失。
4. 不调任何一个教义数值（D5b 归 director spec，本切片只接地不改值）。

### W3 — 模组层 ↔ 规则层对齐（ModuleGraph → RuleGraph `uses-rule`）

**交付物：**

1. 对 The Haunting 的 8 处 authored 机制身份（§3 缺陷 #4 清单）逐一做**语义判定**
   （语义推理，不是关键词匹配）：该机制采用哪条 coc7 规则语义。
   - 有精确对应：把 authored 声明的 `module_rule_ref` 指向该 Rule/Decision semantic id
     （精确相等，ADR 0003 决策 4），经模组图编译器的既有校验画 `uses-rule`；
   - 真模组专属、无规则对应：不画边，理由记账（例：纯叙事性机关、无检定语义）。
2. registry module coverage reason 更新；若产生真边，`no-proven-instance` →
   `instance-linked`（部分对齐则写明对齐集）。

**约束：**

- 模组 authored truth 的**含义不改**：对齐只声明「采用哪条规则语义」，不修改机关的
   authored 数值与叙事；数值与规则书冲突时按 module-graph 合同的 authored-source 权威，
  冲突记 `continuity` 观察，不静默改模组。
- 弱关联不构成 `uses-rule`（ADR 0003 决策 4 原文：仅因某规则可能在后续条件中触发，
  不构成直接采用关系）。
- 导入 PDF 模组不在本切片：其对齐归 `pi-coc-module-source-pipeline-unification` 的
  单一脊柱完成之后。

**门：**

1. `uses-rule` 全部满足 `module_rule_ref` 精确相等校验；`coc_system_ontology.py` 干净。
2. The Haunting 的正常游玩行为不变（模组只读、查询面不变）；至少一次现存
   module.context 探针复跑结果一致。
3. 判定证据留存：每条对齐/不对齐的语义理由写入 shard 审记录或账本，可复查。

---

## 6. 明确不做（归别处）

| 项 | 归属 |
| --- | --- |
| Graph → Scenario IR 投影（七份 IR 变成 ModuleGraph 的确定性投影） | [module-graph-to-kp-integration](module-graph-to-kp-integration.md) 下一阶段；W2 的模组接地若需要它，W2 账本记「等待投影」，不在此实现 |
| 导演层 storylet → ModuleGraph scene/clue 接地 | 同上，依赖投影存在 |
| D5b 导演值重调实验 | DirectorGraph spec §8（先等「这层在游玩中是否被到达」的产品问题解决） |
| `grant_binding_drifted` 绑定收窄 | 用户拍板项；独立切片，需独立探针证据 |
| 尚未产生过结算的族（Healing/Combat/Chase/Magic）的可玩性 | RuleGraph spec §14 Gate 9 家族晋升流程 |
| Chronicle Kernel 新架构 | 未采纳提案；若立项另起迁移 spec |

---

## 7. 验收矩阵

| 面 | 检查 |
| --- | --- |
| 桥真实性 | `effect:coc7:*` 出现于至少一条真实游玩的 finalization 记录且与其渲染可指认（W1 门 5） |
| 边诚实性 | 每条新跨图边的消费端存在；校验器四类探针全绿 |
| 位等价 | 旧记录重放逐字节一致（W1）；导演决策矩阵重放一致（W2）；The Haunting 探针复跑一致（W3） |
| 权威面 | 无新权威、无新操作、无权威面变更；关系种类仅限 `renders-settled-output` / `grounded-by` / `uses-rule` |
| 账本 | 每个未接地/未桥接项有生成账本条目与原因分类；过时理由清零 |
| Registry | `coc_system_ontology.py` 在三个切片各自完成后干净；coverage reason 与账本一致 |
| 证据保存 | 真实游玩运行保留于 `.coc/playtests/`，战报经 `coc-export-battle-report` 导出 |

---

## 8. 已知风险

1. **W1 摘要边界**：`rule_effect_ref` 平行于摘要挂载，若实现时误入摘要构成，
   506 条重放门会红——这是设计内的保护，不是风险豁免。
2. **W1 消费端范围蔓延**：为让更多效果「可渲染」而扩展义务推导或段落类型，属于
   行为变化，超出本切片；遇到时记录为发现，不加码。
3. **W2 pacing condition path**：注册新 condition path 会触碰规则合同表面；若所需
   path 在十族 RuleGraph 中不存在，正确结果是账本记「目标尚不存在」，不是造一条。
4. **W3 语义判定分歧**：authored 机制与规则语义的对应是语义判断；判定与理由必须
   留档，用户可以推翻单条判定而不推翻整个切片。
5. **未提交工作并行**：证据基线时工作区有 T5 工艺调参、ruleset-contract 简化、
   grant 诊断三组未提交改动。W1 与它们触碰面不重叠（桥在 settlement→receipt→
   finalization 身份字段，不在预算/工艺/授权绑定），但实现切片开工前须重新核对基线。

---

## Implementation log

| 切片 | 结果 |
| --- | --- |
| W1 | 运行时桥已交付并合并（`public_effect_refs_for_decision` / finalization `rule_effect_refs` 审计字段 + 12 测试；位等价未破）。`renders-settled-output` 真边 3 条（`ref:text:segment-type-state-delta` → healing 三效果），账本分类 3 桥接 / 19 尚无消费端 / 1 keeper-only，text coverage → `instance-linked`。真实游玩证据：桥机制在场（[证据状态](../status/w1-bridge-live-evidence.md)）；**非空公开效果绑定待下一次自然伤害结算或战役结局补记**——本局未自然发生，拒绝脚本制造。 |
| W2 | 已交付并合并。`grounded-by` 3 → 7 条（新：pushed-fail-nudge → `decision:coc7:push-luck:pushed-roll`，combat/flee/cast → 三条 decision；旧「未解析」理由被证伪）。150 教义节点全分类入生成账本：grounded 4 / span-bound 1 / resolvable 0 / pacing-state-read 36 / authored-no-source 109。D4 基线重放零漂移，568 测试绿。 |
| W3 | 已交付并合并。The Haunting 7 条 authored 机制身份全部判「模组专属」，0 条 `uses-rule`——测量结果而非未完成工作（ADR 0003 决策 4 精确相等门槛 + 逐条语义理由，生成账本防漂移）。 |

更正本规范需要的：

1. **W1 锚点修正**：`family_runtime_ownership` 在 `rule-graph.json`，不在
   `rule-graph-manifest.json`（brief 锚点 4 写错，实现按正确位置落地）。
2. **W1 门 5 的诚实改写**：试点族选的是「有结算记录的族」，但其中 sanity /
   core-check 没有公开 emits 效果，真实游玩只能证明桥机制在场；非空公开效果
   绑定需要自然发生的伤害/结局链条。缺口如实记账，不以脚本制造。
3. **registry 并行编辑**：W2/W3 同时触碰 `system-ontology-registry-v1.json`
   不同行段，合并零冲突（协议见共享上下文）。
