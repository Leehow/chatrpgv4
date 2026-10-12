# 统一最终输出：素材与表达分离

Status: ready-for-agent

Date: 2026-10-12
Baseline branch: `0.9.7a`
Kernel: `kernel-ts` only
Model assumption for writer: Grok Build / grok-4.5 low（实现时报告实际模型；本规格不授权 Astra）

设计与最高测试接口已由用户于 2026-10-12 确认。规格可进入实施；实现与验收均未运行。

**Owner amendment 2026-10-12（用户显式更正，无需再确认）：** 最终输出能力是**智能体在需要实现故事材料时主动选用的工具**，不是写死在流程末段的强制阶段，也不是覆盖一切助手文本的万能中间件。玩家中途的超游/OOC 询问（规则、玩法、系统、叙述澄清）由 Keeper **直接回复**，**不必**也不应仅为作答去调用本工具。「单一写作者 / 一件 prose 产物」约束适用于**一次已选用的 final-output 任务之内**，不是整段会话的每一句回复。不新增常驻语义分类器，也不靠 keyword/regex 强制路由；既有 interaction-scope 语义与 Keeper 判断可辅助是否选用工具。世界观内虚构仍服从既有收据与权威；仅贴 OOC 标签不能洗白未执行效果或秘密知识。

**相关权威（只引用，不在此改写）：** ADR 0001（战役 Git 历史 ≠ 语义记忆）；契约族 narrate/apply/ask 与提交链、材料/Mod、NPC 档案与归因（含既有 §166 单次成稿、§203/§208 建立与材料、§229/§231/§232 NPC）；scene-establishment 与 narration-craft；expression 选择与 zh-optimize；historical-reference（可选、不可信外部上下文）；记忆候选与归因所有者。先前 `npc-material-projection` 因因果诊断不成立已为 wontfix，不复活其「强制一句/卡片压缩」方案作为本设计证据。

---

## Problem Statement

玩家读到的 NPC 对白与场景叙述常极不自然：前置 Keeper 在同一轮里既要做参数选择、语义逻辑、规则与状态裁决，又要直接写出文学散文，负担混杂。现有交付路径上，`narrate` 接收的是已完成正文；`apply` 可内嵌 narrate；`ask` 自带 prose；宿主还有其它出口。`SINGLE_PASS_NARRATION` 为真、speech-edit 立即返回，契约强调首次成稿即交付、无通用润色重写——这不是「多个活跃润色器导致不自然」的证据。决策与写作负担是否因果成立，在对照实验完成前仍属未证伪假设。

用户明确要求：当前置 agent 选择实现**故事材料**时，由参数/语义/规则/状态与素材准备路径供料，再经**可选的**最终输出工具调用 LLM，把已准备材料合成流畅 prose，不得新增语义内容。该工具**不是**每条助手回复的强制末环。现有环境/背景 enrichment、角色/状态补充、环境与角色刻画，以及 expression 类 Mods，在选用 writer 时应纳入这一次写作阶段而非另开润色链。材料须区分可见与私密，并支持少文学、偏事实的记忆路径。中途超游问题走直接回复，不强制 writer。

空心交付：只多加一次润色调用、堆字段、或声称文笔已改善，却不划分事实、素材、表达、披露与记忆，也不保留既有权威所有者。

---

## Solution

从玩家与维护者视角，产品变为：

1. **优选的故事 prose 接口（可选调用）**：演进现有 `narrate({ delivery })` 作为实现故事材料时的**首选可用**接口设计，而不是新增第八个公共动词。它在智能体**选择**交付故事时可用，**不会**在 finish / message_end 自动调用，也**不**把一切助手文本强制改写成 delivery。前置 Keeper 选用时提交的是结构化交付计划 `delivery`（版本化）与材料引用，不是成品美文。apply 内嵌、ask 故事前言、opening、hybrid finish 与可选 legacy 适配器仅在**显式 delivery 计划/调用选中本能力**时复用共享 writer。
2. **交互分支（非强制分类器）**：在交互处区分——**OOC / 超游**（规则、玩法、系统、叙述澄清）→ Keeper **直接可见回复** → 会话记录（可保留 OOC 文本；既有玩家偏好/OOC 记忆 scope 可继续）；**选用的故事写作** → packet / writer / 既有 publication。前台 agent 回答 OOC 时可使用必要的只读规则/上下文工具；**不得**仅为回答规则问题启动 final writer 或产生其 token 成本。不强制新增常驻语义分类器或 keyword/regex 路由；既有 interaction-scope 与 Keeper 判断即可。
3. **宿主组装并冻结**（仅在选用 final-output 时）：有界 Delivery Material packet（收据、场景/NPC 读侧、真实检索结果、当前玩家输入、相关已交付对白等），写入前校验必选材料；可选缺失可诊断跳过，必选缺失退回前置准备，禁止写作者秘密即兴。宿主绑定隐藏 id、状态/修订/收据，并物化实际必需的规范收据与禁令。
4. **单一前台写作者（任务内）**：每个**已调用的** delivery 尝试一个 owner；一个有界 Pi 作者任务可使用多次 tool/model 步骤，但只提交一件 prose 产物。「Single writer / one artifact」**不**约束未走 writer 的直接 OOC 回复。执行域仅批准的 packet、风格与产出物；工具名为 `read` / `write` / `edit` / `bash`。无嵌套内核、无战役/密钥/网络/世界副作用工具。模型只做 realization。
5. **一次校验后的 durable 发布**（仅故事路径）：经现有内核终端所有者写入回合记录、台词/NPC 账本与 transcript；narrate 等待既有 Git 提交；ask 在显式选用故事 prose 时使用既有 durable choice/pending 记录，不为每次 ask 新建 Git 提交。记忆仍走既有 typed facts 与归因所有者。
6. **可见 vs 私密**：有意的 OOC 回答是普通**可见**回复；内部材料草稿、tool chatter、final-writer 草稿仍保持私有。宿主**不得**把直接 OOC 输出吞成 draft 或自动送入 `table.narrate`。选用的 final-tool 仍可拒绝无效 artifact/参数，但**不**把每条回复都塞进该工具。无条件 output hook、无强制最终节点、不靠工具调用次数推断故事/OOC。世界观内虚构继续服从既有收据/权威；OOC 标签不能洗白未执行效果或秘密知识。谎言记录为「X 说了 P」，不把 P 写成世界真值。在**已选用**的 final-output 任务内，公开故事 prose 概念仍收敛为一个终端所有者。

文笔是否「更自然」只能由受控对照与真人反馈判断；本规格保证的是边界与权威，不保证文笔分数。

交付流程（故事选用 vs OOC 旁路）：

```
交互 / 玩家输入
        ├─ OOC/超游（规则·玩法·系统·叙述澄清）
        │         ↓
        │  Keeper 直接回复（必要只读规则/上下文工具；无 final writer）
        │         ↓
        │  可见会话记录；不推进未授权虚构；pending 选择与已结算结果保持
        │
        └─ 智能体选用故事材料实现（显式 delivery / narrate 等）
                  ↓
          前置语义裁决与工具收据
                  ↓
          宿主收集 receipts / 读侧 / 已选 advice / 玩家输入 / 近期已交付对白
                  ↓
          组装 Delivery Material packet（provenance × 语义 × 受众 × delivery_role）
                  ↓
          依赖完成 → freeze（拒绝陈旧发布）
                  ↓
          唯一 final writer（隔离 Pi；read/write/edit/bash）→ 单一 artifact
                  ↓
          确定性形状、引用与覆盖声明检查（不等于语义保真证明）
                  ↓
          既有 terminal 发布 → turn/choice 记录 + 玩家 UI
                  ↓
          既有 memory jobs / 下回合 readers（事实路径 ≠ 传播路径）
```

---

## User Stories

1. 作为玩家，希望对白自然、场景在该建立时足够可感、首次抵达满足 establishment、重返不无谓复读，以便沉浸并做决策。
2. 作为玩家，希望 NPC 谎言只表现为角色所说、未披露秘密不从旁白漏出、失败行动不发明额外灾难，以便推理与公正。
3. 作为玩家，希望 mechanics 选项、handout 原文、报价、姓名与 choice/ask 待选语义不被写作者改写，以便规则与控件稳定。
4. 作为玩家，希望原始草稿与写作者 tool chatter 永不进入 UI 或 transcript，以便界面干净。
5. 作为前置 Keeper，希望只提交意图、反应、允许的可观察描述与披露选择，工具结果自动带 provenance，以便专注语义作者身份。
6. 作为前置 Keeper，希望必选缺失时收到聚焦准备需求、可选可省略并诊断、拒绝动作只作证据，以便世界状态干净且不靠写作者编造。
7. 作为前置 Keeper，希望 freeze 前可写 table_authored 普通描述（非 source_authored）；无接受方则 pending/unconfirmed；仅实际披露交付后才可作桌面已建立描述。
8. 作为前置 Keeper，希望群体对话、时间变化、打断重开等仍能准备完整必选事件，且中性 choice/OOC 可无世界效果，以便不静默截断、不伪造结算。
9. 作为内核维护者，希望算术、授权、事务与 resolve/apply 权威不变，以便旁白不能改世界。
10. 作为宿主，希望 stamp id、引用已有宿主上下文、物化必需规范收据与禁令、freeze 后拒绝陈旧发布，以便权威不旁落、旧文不误发。
11. 作为最终写作者，希望只见 least-privilege 投影，可调语序与指代但不能增减材料承诺，以便文笔与保真分离。
12. 作为最终写作者，希望获得已选 expression advice、voice 与 narration-craft 表达类指导，决策类指导留在准备阶段，以便语气一致且职责清晰。
13. 作为 Mod 作者，希望 enabled/disabled、锁与 play_language 行为保持，以便配置不被新管线偷改。
14. 作为 expression 包维护者，希望 v7 选择器在 binding 匹配最终快照时复用，否则有界回退，以便预算仍准。
15. 作为 historical-reference 路径维护者，希望只携带前台真实检索到的带源引用，以便写作者不新开搜索或发明史实。
16. 作为记忆系统维护者，希望 typed facts 来自收据与已接受建立材料，关系/信念/承诺经既有归因晋升，并区分事实、候选、已披露与未决，以便不依赖文学改写、不轻信自报 mapping。
17. 作为回合记录维护者，希望保留 material 引用、钉住选择快照与 coverage 作交付证据，且不与世界状态日志竞争，以便审计。
18. 作为运维，希望同一 attempt 可重试同一 packet、仅无有效 artifact 时重生、commit 失败复用精确 artifact、崩溃遵循既有 journal，以便幂等且不丢已结算副作用。
19. 作为运维，希望 durable 发布前不对玩家公流临时 prose，发布后可渐进展示终稿且不伪装真 token 流，以便避免「已读未提交」。
20. 作为测试者，希望**实际选用 final-output 的**入口经同一 publication seam 验收，并对密钥排除、陈旧、取消、必选/可选、谎言、报价与工具越界有行为级断言，以便规格可证伪且在选用路径上无双写作者。
21. 作为产品所有者，希望质量对照仅作离线诊断、并测量总延迟/写作等待/token/成本/重试，以便真人反馈仍必要且无假设加速；OOC 旁路不计入 writer 成本。
22. 作为兼容路径维护者，希望旧回合 legacy 读取且不重渲历史；**当 live 调用选用 final 工具时**走新终端所有者；旧式成品 text 只作私有不可信草稿，不能自我晋升或绕过新所有者发布。不把「live 一律新终端」理解成每条消息强制 writer。
23. 作为契约维护者，希望实现前以「选用最终写作所有者时发布一篇 prose」替换「前置故事首稿原文直出」的硬接线，且不重开旧 audit/speech-edit；此为同一 feature 前置文档义务，不是额外独立工程。退役「通用首篇 prose 覆盖」时**不得**换成另一种强制 writer hook。
24. 作为 Jev/narrator-catalog 维护者，希望本规格不自动打开 clerk 语义或把前台决策换成 Jev，以便与 optional narrator-only 边界清晰。
25. 作为规格维护者，希望最终写作者工具禁闭沿用既有护栏模式并窄适配，否定测试覆盖 symlink/父路径/checker 篡改/注入/读泄漏，以便实现决策明确而非未决猜测。
26. 作为玩家，希望已规范获得但文中省略的线索被标为 delivery 省略，而不是静默撤销收据，以便已接受事实权威独立于文笔。
27. 作为前置 Keeper，希望有意的 OOC 回答作为普通可见回复直出；内部材料草稿/tool chatter/final-writer 草稿保持私有；宿主不把直接 OOC 吞成 draft，也不根据自由文本推断我必须调用最终输出工具。
28. 作为宿主，希望 packet 预算不能静默去掉必要事件或降为可选，且无自动抬高预算，以便必选内容不被悄悄牺牲。
29. 作为记忆系统维护者，希望新台词/披露与最终 durable 交付一并落地，而失败时已结算副作用仍保留，以便因果与恢复正确；OOC 解释不写成 NPC 台词、不授予调查员秘密知识、不单为喂 final-output 而制造战役回合提交。
30. 作为测试者，希望独立验收「文本是否真正说出必选内容」，并把自写 mapping 仅当证据而非知识授予，以便声明覆盖不等于语义覆盖。
31. 作为运维，希望 invalid artifact 保持私有、仅在原限额内修形状/证据，timeout 返回未完成交付且重试不重复 effects，无草稿兜底或机械模板，以便失败有界。
32. 作为契约维护者，希望既有 single-pass 测试期望被有意修正后的契约取代，同时保留一次发布与无事后编辑断言（适用于选用 writer 的路径），以便不是测试变绿捷径。
33. 作为产品所有者，希望同一 feature 按「契约+终端切片 → 路由选用 final 工具的路径并保留直接会话车道 → disclosure/memory/recovery → 聚焦/全量与 live」有序交付，且任一切片不以仅 packet 宣称完成。
34. 作为玩家，希望中途问规则/系统/叙述澄清时立刻得到直接 OOC 说明，不触发 final writer，且不因此选中选项、推进时钟、完成或重开已挂起的虚构行动。
35. 作为玩家，希望像「奖励骰怎么算？然后我推门。」这类混合输入被拆开：规则说明直接可见，授权的推门仍走既有行动语义，故事部分可再选用 final-output；系统解说不进 NPC 之口；不因混合而强制多一轮确认。
36. 作为前置 Keeper，希望回答 OOC 时可用只读规则/上下文工具，且零 final-writer 启动与 packet/artifact/job；pending 玩家选择与已结算结果保持不变。
37. 作为测试者，希望在同一真实宿主接口上既测实际 final-tool 调用，也测纯 OOC 不调用及混合输入仅为选中的故事部分调用，并有连续真桌中途插入自然 OOC 再回到游玩的证据（非脚本玩家）。

---

## Implementation Decisions

### 1. 公共接口：演进 narrate 为可选故事交付；保留直接会话车道

- 模块概念：Terminal Delivery Owner（现有 table 终端 narrate 族）、Delivery Planner（前置 Keeper 语义侧）、Delivery Material Host（组装/冻结/校验）、Final Writer Task（隔离 realization）、Publication Gate（形状与覆盖校验后交回既有 write 生命周期）。
- 不新增第八公共动词。在**一次已选用的** final-output 任务内，故事 prose 仍由同一终端所有者发布。`narrate({ delivery })` 是**首选接口设计**，可用但**不**在 finish/message_end 自动调用，**不**强制把一切文本自动转换。
- **交互分支**：OOC → Keeper 直接响应 → 会话记录；选用的故事写作 → packet/writer/既有 publication。不新增 always-on 语义分类器或 keyword/regex 强制路由。
- `apply` 内嵌叙述适配器：等待真实 effect 结果后，**仅当**显式 delivery 计划/调用选中本能力时，再调用共享终端所有者一次；apply/resolve 结果可累积材料，但**不得**自动触发 writer。纯文本或 end-of-run **单独**不构成选用。
- `ask`：mechanics-only / OOC 说明走既有直接/控制路径，**不要求** full writer；若**显式**选择故事前言可用 writer，并保留 pending-choice 语义（不是伪装的 narrate 整轮提交）。可选适配器被选中时避免重复调用。
- opening、hybrid finish 与支持的 legacy 适配器：**仅当**显式 delivery 计划/调用选中本能力时复用共享 writer；取消「所有入口/全部终端都收敛」「live 一律新终端」的绝对强制解读——改为对**选用 final 工具的调用**复用终端所有者。
- 模型侧 `narrate` 在故事交付选用时接受版本化的 `delivery`（交付计划），而不是成品 `text`。
- 操作错误、进度、结构化 UI、setup 工作流不强行塞进故事 prose；角色创建重设计 out of scope。
- OOC、仅 mechanics 与错误/进度消息：有意 OOC 回答为普通**可见**响应；内部草稿与 writer chatter 私有。宿主不得吞掉直接 OOC 或自动 `table.narrate`。非世界范围不写入世界事件记忆。选用 final-tool 仍可因无效 artifact/参数拒绝；不胁迫每条回复进入该工具；无 unconditional output hook、无 mandatory final node、不按 tool 次数推断故事/OOC。
- **OOC 中途**（本规格中的常义：规则、玩法、系统、叙述澄清；非穷尽一切 metagaming 词表）：保留既有 pending 玩家选择与已结算结果；答规则**不**选中选项、不推进时钟、不移动/行动、不完成或重开挂起的虚构行动、不生成 NPC 台词、不制造情节效果。会话记录可保留 OOC 文本；既有玩家偏好/OOC memory scope 可保留。不把 OOC 说明变成 NPC 台词、调查员对秘密的知识或世界事件记忆。不单为喂 final-output 而创建战役回合提交。**不声称**当前 runtime 已有验证。
- **混合输入例**：「奖励骰怎么算？然后我推门。」→ 显式 OOC 说明直接处理；再按既有行动语义处理已授权虚构，并**可选**为故事部分选用 final-output；系统解说不进 NPC 之口。不因混合而强制确认轮。若涉及源秘密，披露规则对 OOC **同样**适用，不是自动剧透旁路。
- Final artifact 不得调用 resolve/apply；不能改 mechanics JSON、台词颜色约定下的规范内容、handout 正文、精确文档、报价、姓名与选项集合。不发明通用 effect 旁路 apply。

### 2. `delivery` 接口

模型侧 `delivery` 可包含（不需要的字段省略，不要求空占位）：

| 字段概念 | 含义 |
|----------|------|
| 源材料选择 | 按语义别名引用本输入中已签发的来源；引用必须可解析 |
| NPC 台词意图 | speaker、实际听众、命题、立场/不确定度 |
| 预备描述性断言 | 普通新写描述明确为 table_authored 出处，不是 source_authored；冻结前须经当前适用的 content/establishment 所有者；若无接受方则保持 pending/unconfirmed |
| 必选内容 | 本轮必须出现在最终 prose 中的材料/事件 |
| 可选呈现意图 | 语气/节奏等呈现偏好；不得改变事实或权威 |

宿主职责：

- 绑定隐藏 id、状态、修订与收据。
- 已在宿主结果中的上下文只引用，不要求调用方重打。
- 物化实际必需的规范收据与禁令，不信任调用方自称。
- 调用方不能把秘密重标为公开/收据，也不能自行创造已结算结果。
- 引用必须解析到同一输入中已签发的来源。

有意的 OOC 回答：普通可见响应，不经 final writer，宿主不将其标为 draft 或自动发布为故事。
只有明确调用最终输出工具，才进入它的参数校验、内部写作和发布生命周期；宿主不得仅凭自由文本或推定的写作意图替 agent 调用。工具内部材料与草稿保持私有，故意面向玩家的超游回复正常显示。遗留成品 `text` 若作为工具材料传入，只是不可信草稿，其声称不能自我晋升为事实。

### 3. Delivery Material packet

- Host 从当前 receipts、场景/NPC 读所有者、真实检索材料、当前玩家输入、精确相关的既有已交付对白，准备并 pin 有界 packet。
- 快照含：启用 Mod 修订与 provenance、pending choices、held/refused outcomes。模型侧用语义名/本地 source 别名；campaign/worldline/turn/revision/call id 由 host 盖戳。
- 必选当前事件与已选答案不得静默截断；packet 预算不能静默去掉必要事件或把它降为可选；无自动抬高预算。
- 可选引用可省略并记诊断；陈旧/缺失必选 → 向前置 owner 返回 focused preparation need，禁止 writer 即兴。
- 依赖完成后 freeze；拒绝陈旧发布。迟到的可选结果不得补丁已交付文本。
- 行维度彼此独立：provenance/authority；semantic statement（speaker/subject/target/time 与必要 uncertainty）；audience/perceivability/knowers；delivery_role（required / optional / excluded）。
- 语义区分：Allowed ≠ delivered；delivered ≠ true；mentioned entity ≠ hearer。「材料已准备」本身不创造事实；已接受状态收据的权威独立于 delivery。已规范获得但文中省略的线索必须标为 delivery 省略，不得静默撤销或事后重定义收据。
- 源秘密与隐藏动机留在前置阶段；前置产出允许的可观察反应/言语意图。Final writer 只见 least-privilege 投影。

### 4. 内容范围（情境选择，非每回合配额）

Packet 可包含：已确立结果、周围空间/感官/时代/环境上下文、时间适用性、可观察角色状态/外观、回应意图/立场/voice、必要精确引语、有界近期对白。
无通用每回合描写配额、强制手势/情绪/敌意/悬念。已建立房间不必重述；启用 Mod 的 first-arrival 要求仍在。
案例：材料写「老人手指僵硬」不授权发明寒冷或疾病。谎言记录「X said P」，不把 P 当世界真。

### 5. Final writer 执行模型与工具禁闭

- 每个**已选用的** delivery attempt 一个 foreground writer owner；共享运行时模型 Grok 4.5 low；无「无工具即可充当 final writer」的例外；无 per-NPC 写作者。未选用 final-output 时不启动本执行模型。
- 使用 tool-enabled Pi，遵循既有 child-task 模式。一个有界作者任务可含多次 tool/model 步骤，但只提交一件 prose 产物——这不是「恰好一次 provider 推理」的承诺。
- 启动：`--no-extensions`，加显式 provider，加显式非内核禁闭/产物工具。仅写「provider-only」会漏掉必需护栏。
- 实际工具名：`read`、`write`、`edit`、`bash`。
- 禁闭是实现决策，沿用现有 reader 护栏模式（realpath 约束读路径；跨 symlink 或 host-owned 输入拒绝 write/edit；bash 仅接受一条宿主创建且未改动的检查命令），**窄适配**到最终写作，而不是声称现有 reader 护栏原样即最终写作者功能：
  - 不可变：已批准 packet 与 style；
  - 可写：产出 artifact；
  - read/write/edit 路径禁闭在该执行域内；
  - bash 仅允许一条精确、不可变、宿主创建的 artifact-validator 命令；
  - 无任意 shell、无广义 OS 沙箱工程、无域外文件系统、无网络、无第二内核；
  - Provider 鉴权留在材料文件之外，且不能经这些工具读取。
- 否定测试须覆盖：symlink、父路径逃逸、checker 被改、命令注入、读泄漏。
- Writer 内无 PDF/源码阅读器、原生 web search、独立 actor 模拟。
- 复用当前 owner 预算、取消与 provider 传输；timeout 不自动扩张限额。
- 无连环 style optimizer，无新的通用文学 reviewer/rewrite 环。既有狭窄 authorized outcome guards 保留。当前 speech-edit 类通用重写保持不复活。

### 6. Artifact、覆盖声明与失败边界

- 单一 final artifact：text/speech 结构 + 从所供 semantic material aliases 到精确 output spans 的 coverage/disclosure mapping。
- 区分：**必选覆盖声明** vs **实际语义覆盖**。span 有效性只是结构检查；保留既有狭窄 outcome guards，不新增通用文风审查或强制语义重写门。
- 产品验收须独立检查文本是否真正说出必选内容；这不是每轮新增一个模型审查步骤。自写 mapping 是证据，不是知识授予。
- 确定性检查：形状、已知别名、span 存在、必选覆盖声明、metadata/receipt 绑定。不能证明语义蕴涵；无语义正则。
- 有界失败：无效 artifact 保持私有；仅在原任务限额内修复形状/证据；timeout/耗尽返回当前未完成交付状态，支持重试且不重复 effects。无草稿兜底、无机械故事模板。若有效 artifact 已存在且仅 commit 失败，复用精确同一 artifact。
- Coverage 为保留证据；语义知识/承诺晋升仍用当前归因所有者。

### 7. 发布与回合生命周期

```
prepare → frozen writing attempt → ready artifact → existing durable publication → delivered
```

- narrate：等待既有 Git commit。
- ask：使用既有 durable choice/pending 记录，不为每次 ask 新建 Git commit。
- 避免「每一次共享 writer 调用都 Git commit」的笼统说法。
- Freeze 前已结算副作用在生成失败时不重复执行；侧效应已结算则失败时仍保留。
- 新的实际台词/披露记录与最终 durable 交付一并落地。
- 同一 packet/artifact 经稳定 host attempt key 重试；仅当无有效 artifact 时 regenerate。
- 发布前用户取消 / worldline / 新输入 / 状态修订 → 旧结果作废。
- 无 durable 发布前的对玩家临时 prose 公流；既有 progress 可继续；发布后终稿可渐进展示，不暗示真 token streaming。
- 明确记录延迟权衡：多一跳 writing 可能增加等待。
- 无交付后替换 overlay。Commit 成功 = 发布资格，不是证明人类已读。
- 既有已选事实记录不得仅因文本可选而推迟。

### 8. 记录、Git、记忆与 contract31 流向

- 在既有 turn-record 族中保留 material source references、pinned selected snapshots 与 final coverage，作 delivery evidence，不是竞争的世界状态日志。无单独新 source-of-truth 日志。
- Git 在既有边界捕获 durable 历史（ADR 0001）；记忆保持既有 semantic memory。
- 事实路径消费 canonical receipts 与已接受 established material（非全部 researched/prepared 数据）。
- 传播路径消费实际 delivered text/spans 与 attributed reports。
- 记忆不依赖文学转述来维护已有 typed facts，但仍需语义归因处理 relationship/belief/promise。
- 存储 exact transcript 供回调。Facts、candidate reports、disclosed info、pending content 可区分。未披露 candidate 不成调查员知识。
- 渲染失败：保留实际已结算效果与准备诊断；无 delivered speech 或 player-knowledge 声称。
- 无历史记录改写或破坏性迁移。

**contract31 要求的 writer–reader–actor 表（紧凑）：**

| 产物 | 写入方 | 消费方 | 用途 |
|------|--------|--------|------|
| packet | 既有工具所有者 / 宿主 → writer | final writer | 有界 realization 输入 |
| final artifact / disclosure | writer + 宿主绑定 → 发布/记忆 | 回合 transcript 与归因 | 玩家可见交付与披露记账 |
| accepted factual record | kernel / 当前源与 table 所有者 → 记忆/检索 | 后续决策 | 已接受事实权威 |

### 9. Mod 与材料集成

- 纳入：narration-craft 核心说明/sections/style/establish；zh-optimize 与已选 expression cards；既有 voice/personality/relationship material；historical-reference 可选内容；daily-life temporal guidance（建议 ≠ 事实）。
- 路由：decision/action 类说明 → preparation；expression 类 → writer；混合贡献资源经显式声明的 role/ownership，不做自动语义分类器。
- 保留 enabled/disabled、immutable locks/settings、voices 源所有权、开放 play_language。
- 无新翻译词典、无靠测试切语言、无固定套话强制。Default-off Mods 保持 off。
- NPC：sourced personality、module-derived profile、table supplement 区分；source relationships 与 played relations 分离；遵守档案、promise 参与者归因与 relation evidence budgeting 既有契约精神。
- 场景：temporal context、activity、stale applicability、observed/established/inferred provenance 由读侧所有者提供；不把 daily-life advice 当事实。
- Environment craft 不保证源真。
- 不启用/篡改 clerk 语义，不自动打开 narrator-only catalog 收窄设置，不把全部前台决策替换为 Jev。optional narrator-only compose 不是本隔离 writer。

### 10. 契约、迁移与有序交付计划

- 预期修订契约 §166 方向：以「**当选用**最终写作所有者时发布一篇 prose artifact」替换「前置 Keeper 故事首篇 prose 原文直出」的硬接线；**保留直接会话车道**（OOC/控制消息）；「一篇 prose / 单一写作者」规则只约束**被选用的 writer 任务**。退役通用首篇 prose 覆盖时，**不得**代之以另一种强制 writer hook 或 unconditional output 中间件。不重开旧 audit/speech-edit。
- 契约更新是同一 feature 未来实现的前置条件，不是用户要求的额外独立工程；当前脏契约文件有意暂不动。
- 并按需修订 narrate/apply/ask 与提交链、材料/Mod、NPC 相关节——须在 runtime 实现之前完成；条文须写明 agent 选用 vs 直接 OOC 旁路。
- 当前 §163 的超游提示仍要求通过 `narrate` 交付 reference 回答；本修订明确取消这一强制要求，并同步调整宿主隐式收尾与正文可见性处理。复用既有 interaction-scope 语义依据，不把其 `world/reference` 结果硬接成 writer 的自动启动开关，也不在本规格中改动其未决判断回退策略。
- 迁移：仅在实现并验证后改变未来**故事**交付协议；无 packet/mapping 的旧 turn 用 legacy schema 读。不重渲旧回合、不写 overlay、不 relock Mods、不重置战役。
- 当 live **调用选用** final 工具时走新 terminal owner；兼容输入在选用路径上译为 private draft material 或有界重试，不绕过新 owner 用旧 raw text 自我晋升发布。直接 OOC 不经该 owner。
- Acceptance 必须验证：选用路径上零矛盾双写作者；非选用路径上零强制 writer。既有 single-pass 测试将需要被取代的期望，同时在选用路径保留「一次发布」与「无事后编辑」断言；这是有意的契约修正，不是为了测试变绿走捷径。
- Pi transport/loop 除必要的 host terminal 路由外不变；无 proven need 则不授权换 vendor。
- 当前 SINGLE_PASS 与 speech-edit 早退不能当作多润色器病因。本设计按用户架构偏好推进素材/表达分离；质量是否改善留待 acceptance。

**同一 feature 内的有序交付切片（现在不建独立工单）：**

1. 修订前瞻契约，并实现一条**可选**终端垂直切片；
2. 路由 environment / NPC / Mod 与**选用 final 工具**的既有路径，并**显式保留**直接会话车道；
3. 对齐 disclosure / memory / recovery（OOC 不制造不当世界/知识副作用）；
4. 聚焦与全量验收（含无调用分支），以及规范 live 校验。

任一切片都不以「仅产出 packet」宣称完成。

---

## Testing Decisions

### 好测试的标准

- 只断言外部行为与可观察记录，不断言 AST 拷贝或「字段存在即成功」。
- 通过改变真实 owner 输入（packet 内容、必选/排除、Mod 开关、陈旧标记、取消）观察交付、UI/transcript/history 一致性与下回合 readers。
- Test double 仅用于确定性测试中有界的 writer/provider 输出；不得当作 live-play 证据。
- 质量对照：同材料、同模型设置、同案例集的离线诊断；匿名评判自然度/grounding/角色连续性/场景清晰度；不以更短、字数、回合数为成功；无预先捏造的数值改善阈值。

### 唯一最高功能 seam（用户已确认；本修订为用户主导修正，不再请确认 seam）

**已确认的单一 seam（实际 final-tool 调用）：** 真实 Pi host 的 final-output 调用 → 真实 TS kernel → durable turn/choice 记录与真实玩家交付 → 既有 memory / next-turn readers。

- **调用分支**：显式 narrate、`apply` 内嵌（仅当选中 delivery）、`ask` 故事前言（仅当显式选用）、opening/hybrid/legacy **仅当**显式选中 final 能力时，经此 seam 测试。
- **无调用分支（同一真实 host seam，必须加测）**：
  - 纯 OOC：零 final-writer 启动；零 final-output packet/artifact/jobs；无新机制强制的隐式 `table.narrate`；直接回答在 session 可见；无新的世界收据/时间推进/NPC 台词/虚构知识授予；pending 选择与既有效果不变。
  - 混合输入：正确分区（OOC 直接说明 + 授权虚构走既有行动语义，故事部分可选 final-output）；OOC 之后恢复时使用原 pending 选择、不重放已结算。
  - 真实连续游玩：中景插入自然 OOC 问题再回到游玩（**禁止**脚本玩家作为 live 证据）。
- 否定对照：写作者工具拒绝访问（symlink、父路径、checker 修改、命令注入、读泄漏），复用既有 execution boundary 测试概念并窄适配最终写作护栏，不造巨型新抽象。
- 既有确定性 doubles 仅可用于功能测试，不得充当 live 证据。
- 用户于 2026-10-12 确认此接口与文笔验收方法；同日 owner 更正：工具为选用而非强制末段。

### 行为覆盖清单（概念名，非路径）

- 秘密排除与 least-privilege 投影
- 状态 / 事件 / 意图 真值区分；谎言为「所说」非「所是」
- 时间陈旧与适用性
- 当前知识 vs draft 知识
- 省略可选材料 vs 必选结果不可丢；预算不得静默降级必选
- 精确 speaker/target、promises
- mechanics / handout / price / 姓名 / choice 卡保持
- 陈旧 / 取消 / 重试 / 崩溃 / 有效 artifact 仅 commit 失败时精确复用
- 无效 artifact 私有；timeout 未完成状态可重试且不重复 effects
- packet 预算与截断策略可观察
- Mod off 与旧 lock
- legacy history 兼容；legacy 成品 text 不可信草稿不得自我晋升
- 终稿在 UI、transcript、history 一致
- 独立验收：文本实际包含必选内容
- 工具禁闭否定：symlink、父路径、checker 篡改、注入、读泄漏
- 序列化 writer 输入中存在 source selection / 钉住 advice（binding 匹配时）
- 纯 OOC：零 writer/packet/artifact/job；直接可见；无世界收据/时间/NPC 台词/秘密知识副作用；pending 不变
- 混合输入分区与 OOC 后恢复 pending（不重放）
- 连续真桌中途自然 OOC 再回玩（非脚本玩家）

### 质量与 live 证据（规格任务不跑）

- 真实 canonical driver；实际 Grok 4.5 low 作 Keeper，并在选用故事交付时作 final writer；本主会话是唯一玩家，一次一句自然输入、一回合一回合，包括中途的 OOC 与混合输入；无脚本玩家、替代玩家或假 KP。
- 场景类型：安静对白、拒绝、首次抵达、重返、群体谈、时间变化、行动失败、打断/重开；连贯推到真正 decision boundary。
- 报告可得质量证据，不声称问题已解决；用户反馈后才能说台词达预期。
- 重测/全量按政策在 LAN；live play 在 Mac。
- 度量：player-input-to-delivery 总时、writing wait、tokens/cost、front/writer 调用与重试；OOC 旁路须显示零 writer 成本；无假设延迟节省。
- `run acceptance` 在本规格中明确为 not-run。

### Prior art（同类既有测试概念）

- single-pass narration（期望将被有意修正后的契约取代，仍保留一次发布与无事后编辑）
- commit outage / 失败提交恢复
- combined apply-narrate
- nonblocking batch
- scene-establish host/kernel
- temporal projection
- expression preparation
- memory attribution / committed-turn source

---

## Out of Scope

- 本撰写任务不实现、不跑测试、不打包、不部署、不 push、不创建 GitHub issues。本地 tracker 规格发布属于测试接口确认之后的请求交付的一部分。
- 恢复或调查已退役 Python 源。
- gpt-6-astra / 未授权模型调用。
- 新增通用文学 reviewer、多段 style optimizer、后置替换 overlay、公流未提交 prose。
- 新 ES/CQRS 框架、用 Git 替换语义记忆、或用记忆替换 Git。
- 写作者内 web search、PDF 阅读、独立 NPC 仿真、嵌套 kernel、广义 OS 沙箱工程。
- 自动打开 Jev clerk 语义或 narrator-only 全量替换前台决策。
- 角色创建 redesign；setup 强行并入故事 prose。
- 复活 npc-material-projection 的强制压缩方案。
- 破坏性历史迁移、重渲旧回合、重置战役、relock Mods。
- 宣称文笔已改善或决策/写作负担假设已在无对照下证实。
- 翻译词典、测试切换语言、固定套话库作为默认。
- 现在创建独立工单；契约正文在本任务中编辑（契约更新是同一 feature 实现前置，当前脏契约有意不动）。

---

## Further Notes

### 状态与 gate

Status: ready-for-agent。用户已确认最高测试接口及单独的文笔验收方法；2026-10-12 owner 更正：final-output 为 agent 选用工具，OOC 直接车道保留。实现与验收未运行。契约修订是同一 feature 的实现前置文档义务；本文件不修改当前脏契约。

### 外部对照（原则借用，非框架移植；无实测收益声称）

- [Reiter 与 Dale：Microplanning，Building Natural Language Generation Systems](https://www.cambridge.org/core/books/abs/building-natural-language-generation-systems/microplanning/FEB90C3A816AD6A873A1BE85B69A9D0B)：将内容计划细化为可供表层表达使用的文本规格，支持组织已决定要表达的内容，不证明通用 LLM 语义无损。
- [Anthropic *Building effective agents*](https://www.anthropic.com/engineering/building-effective-agents)：可分的 prompt 链支持任务专一，但增加延迟与成本；支持前后分工，不证明文笔改善或多 agent 树。
- [Azure Event Sourcing 模式](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)：支持记录与投影分离的原则，但不是新的持久化工程；不引入 ES/CQRS 框架，不替换现有 Git/记忆权威。

### 延迟与成本

分出 final writer 符合规划/实现分离与任务专一的外部经验，但**仅在实际调用**时增加至少一跳模型调用与隔离开销。**OOC 旁路无 writer 延迟/token/成本**；不得为了「跳过 writer」而强加新的分类器推理成本。验收必须报告实测（分调用 vs 旁路），不得在规格或 PR 中假设净加速。

### 保真上限

确定性 coverage 检查是必要护栏，不是语义定理证明。Acceptance 需独立抽检「材料未授权的细节」以及「必选内容是否真正出现在文本中」。离线同材料对照可辅助，不可替代真人与 decision-boundary 级 play。

### 权威一览（防空心交付）

| 关切 | 权威所有者 |
|------|------------|
| 世界算术与事务 | kernel resolve/apply 与既有 write |
| NPC 意图与披露选择 | 前置 Keeper |
| 材料组装/冻结/陈旧/收据物化 | Delivery Material Host |
| 措辞 realization | Final Writer（无语义添加） |
| narrate 发布与 Git | 既有 terminal write + ADR 0001 |
| ask 待选 | 既有 durable choice/pending |
| 事实与承诺晋升 | 既有 memory 归因所有者 |
| 表达 advice 选择 | 既有 selector（binding 复用） |
| 源真 vs 桌面补充 | NPC/场景材料所有者 |

### 经验未知

文笔质量与端到端性能、成本仍须实测；规格不预设改善。测试接口确认不代表产品已经完成或验收通过。
