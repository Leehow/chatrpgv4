# Enhanced Locations v2：地点是世界记忆，不是逐步记账

Status: needs-triage（设计审查已完成，等用户拍板 §7 的决定后才实施）

本文按 Agents.md「修补先看全局」（2026-10-21 用户裁定）交付：同类失败已反复出现，停止局部修补，
先做整条路径的只读审查，再给出可评估的替代设计。旧设计与契约见
[location-system-and-tool.md](location-system-and-tool.md)、契约 §242/§243、
[实施台账](location-system-tickets/README.md)。本文不改写任何历史证据。

## 0. 结论

现在的 Enhanced Locations 把「人在房间哪个位置」「这一眼看见了什么」都做成了必须带收据的世界事务，
又因为 KP 写不准这些事务，在前后各加了一道 Jev 概率闸（逐行同意审核 + 输出完备性审核）。
两道闸都在 Jev 的噪声区间里做硬判决，同一份正确方案会被随机拒绝；每次被拒，KP 的思考就转去
猜闸门和协议，修补者再往 agent.md 里补一句。两天 41 次提交、同一局里至少 16 个版本，失败率没有收敛。

v2 的方向：**跨地点移动、地点身份、门锁一类会产生后果的状态**仍是内核权威、仍过准入；
**房间内的站位和「看见了什么」**不再是世界写入，而是交给作者的素材，不过任何概率闸；
地点写入只有一种形状，正常只在回合末一次提交（唯一例外是检定前先提交到达，§5.2），
schema 小而完整地常驻，不再需要先读 53 KB 契约。

## 1. 用户意图、成功标准、空心交付

- **用户想达成：** 玩家用自然语言在世界里走动、进出地点、四处看看、回到去过的地方时，地点连续、
  前后一致、能即兴出新地方，且不会因为地点系统本身让回合失败或让 KP 的思考被协议吃掉。
- **成功是：** 同样的玩家输入（见 §8 的原始失败回合）在新战役真桌上一次交付；地点系统造成的拒绝为零；
  KP 思考主要花在故事和规则上；回到旧地点能认出旧布置与旧事件。
- **空心交付是：** 降低阈值让同样的闸偶尔放行；再往 agent.md 补规则；只让 107 回合这一句话通过；
  把失败文案改好看；拿测试全绿或回合数当证据。

## 2. 证据

数据源（只读，未改动）：

- 会话：`~/Library/Application Support/Pipi/pipicoc/pi-coc/agent/ui-sessions/play/<…enhanced-locations-01a154d0>/2026-10-20T01-25-18-962Z_5de9a0e4-….jsonl`（61 MB）
- 战役：`~/Library/Application Support/Pipi/pipicoc/pi-coc/.coc/campaigns/game-aed1e3e3-…`（「鬼屋」，The Haunting），`turns/0000–0107.json`、`telemetry.jsonl`
- KP 模型：T0–37 与 T91–107 为 `MiniMax-M3.1-Flash-Preview`，T38–90 为 `grok-4.5`

### 2.1 规模

| 指标 | 数值 |
|---|---|
| 内核回合 | 108（T0–T107） |
| 未交付（`closed_by: stranded`，玩家什么都没收到） | **37（34%）** |
| 失败的工具调用 | **216** |
| 全部输入 token | 44.7 M；其中未交付回合吃掉 21.0 M（47%） |
| 回合耗时中位数 | 交付 83 s、未交付 129 s；全部 p90 244 s |
| 玩家原样重发同一句话 | 7 次（另有多次换说法重发，如 T100→T101→T102 同一句点早餐） |

### 2.2 失败归因（216 次）

| 来源 | 次数 | 说明 |
|---|---|---|
| 地点字段/规则（place 工具 schema、`inspect` 混入写字段、additions 写成字符串、特征重定义、包含关系等） | 46 | 例：`place inspect is read-only and cannot accept change` 8 次；`change: schema is false` 等 schema 拒绝 16 次 |
| 输出完备性闸（`place_decision_incomplete`，Jev） | 37 | 详见 §2.3 |
| 同意审核拒绝地点行（`typed consent decision is uncertain` / `has not chosen this action`，Jev） | 27 | 例：T107「去附近找另一家旅馆」被判 `selection not established` |
| 输出包的移动规则（一包只许一个目的地、必须带 scene 评估、beyond_travel、重复路程时间） | 14 | |
| 同意审核拒绝非地点行（点餐、付款、等待） | 41 | 通用准入问题，但地点 mod 的 agent.md 也在管点餐顺序（见 §3 R6） |
| 其他（建卡、点餐服务规则、未核实表达等） | 29 | 非地点 |
| 输出包交互构造器（`fact_ref`/`new` 内容项等） | 12 | 结构化回合协议的问题，非地点；其中约 5 次是 observe 缺 `access` |
| 参考问答范围、拒绝预算 | 10 | 非地点 |

**地点系统直接造成约 124–129 次（57–60%）。** 非地点部分在 §9 单列，不算在这次重设计里。

place 工具本身：`move` 66 次失败 22 次；`inspect need:"contract"` 40 次，返回中位数 42.7 KB
（参数 schema 16.3 KB + 命令 schema 15.2 KB + 指令段 21.8 KB）；不带 `need` 的 `inspect` 17 次**全部失败**；
旧 `op:"submit"` 写法 15 次失败 8 次。

### 2.3 两道 Jev 闸在噪声区里做硬判决

输出前的完备性闸：`extensions/kernel/index.ts:5780-5798` `preflightSpatialDecision` →
`extensions/table/location-relevance.ts:137-158` `locationDecisionCoverage`。它向 Jev 提若干 0–1 概率题
（玩家选了移动/观察吗、方案覆盖了吗、有障碍吗），某轴在 0.4–0.6 之间就记 `uncertain`，
任何一轴 `missing`/`uncertain` 就整包拒绝（`location-relevance.ts:152,156`）；Jev 2.5 s 没答上也整包拒绝
（`:162-163`、`:145`）。

是否开审由回合前的另一次 Jev 预判决定（`location-relevance.ts:28-34`，任一轴 > 0.4 即开）：
遥测 `lane: location-context` 499 次预判里 444 次（89%）判为需要审核，所以几乎每个 output 都要过这道闸。
遥测 `lane: location-decision-coverage` 共 123 次，拒 37 次。概率分布：

- `observation_satisfied` 99 个值里 16 个落在 0.4–0.7；`move_satisfied` 96 个值里 18 个落在 0.4–0.7。
- **T107 两次提交几乎相同的方案：** 第一次 move 0.61（过）、observation 0.49（不确定）；第二次 move 0.59（不确定）、
  observation 0.62（过）。判决随 0.02 的抖动翻转，两次都整包拒绝，回合未交付。
- T102 的 observation 0.61，以 0.01 之差通过。

写入前的同意审核：`extensions/kernel/index.ts:3760-3840` `admitAction`，阈值
`runtime/jev/continuous-consent.ts:3` `CONTINUOUS_CONSENT_MIN=.6`，`selection` 与 `restriction` 任一不足 0.6
即 `uncertain`→拒绝。全局 278 次审核：authorized 190、uncertain 38、not_authorized 25。
地点行的问题文本本身已经是补丁堆（例：「A player choosing an ordinary hotel need not supply its name」），
T107 照样判「selection not established」。

### 2.4 回合 107 全过程（截图那一回合）

玩家：「我沿原路回到街上，去附近找另一家旅馆，走进前厅，看看里面的布置，再向柜台打听有没有能住到中午的空房。」
（上一回合 T106 同一句话已未交付。）

1. `place inspect` 南站旁小旅馆（成功，返回 6.8 KB）。思考 7,881 字，主要在想用哪个通道、`service_at` 的
   `fulfillment` 只有 `dine_in/takeaway` 能不能拿来表示「住到中午的房间」。
2. `output`：交互内容第 2 项 `input_requirements` 被拒，错误是 ajv anyOf 原样输出
   （`must have required properties fact_ref … source_ref …`），看不出真正原因。
3. 思考 14,826 字后改成新建「科比特街小旅店」并在同一 output 里 move+walk_on+scene+observe：
   完备性闸判 move 已交代、observation **不确定**，拒。
4. 改走 `place move` 单独提交：同意审核判 `selection not established`，拒。
5. 两次 `inspect` 重新读地点（成功）。思考 8,080 字，在推测闸门为什么拒。
6. `apply` 记一笔「科比特街小旅店二楼空房」报价（**成功落账**）——而这家旅店从未建成。
7. `output` 再交：这次 move **不确定**、observation 已交代，拒。回合未交付，玩家只收到
   「行动审核无法确认所选行动，因此该行动没有被执行」。

7 次模型调用、输入共约 66.8 万 token、4 次失败、留下一条指向不存在地点的报价收据。

### 2.5 上下文成本（T107 每一步）

胶囊 98 KB、clerk 15.8 KB、宿主 output 规则 5.4 KB、Mod 段落 15.2 KB（其中 4 段来自 Enhanced Locations）
每一步都重发。每步输入约 9.3–9.6 万 token。output 里 `kind:"place"` 的字段语法被故意做成不透明
（`shared/place-structures.ts` `locationCommandEntry`：`additionalProperties:true`，「place inspect need contract
supplies the exact fields」），KP 必须先花一轮读 53 KB 契约。

### 2.6 修补史

- `mods/enhanced-locations/` 41 次提交；2026-10-19 起全仓 182 次提交里 107 次是地点修补。
- `agent.md`：1.0.0（10-19 13:33）3,508 B → 1.2.4 22,554 B。每一句都对应一次具体事故
  （例：「A food inquiry or spending ceiling is not selection of a meal」「Do not default every American eating place
  to a later chrome-and-neon roadside diner」）。
- 同一局战役里，工具结果中出现过的 mod 版本至少 16 个（1.1.18 → 1.2.6，T21 之前的结果未带版本号）。按回合段统计的未交付率：
  T1–36 39%，T37–70 38%（grok），T71–90 15%，T91–107 41%（换回 MiniMax）。修补没有收敛；
  换回 Agents.md 指定的真桌默认模型后失败率回到原点。

### 2.7 上一轮评审定下的基线已经跑出结果

10-21 用户批准的 GPT‑6 Pro 评审顺序（[REVIEW.md](../research/location-system-review-20261021/REVIEW.md)）是：
先修已确认的信息丢失，再在不改模型、不改阈值的前提下于原 App 会话建立基线，再按残余失败决定改多大。
评审停在 T63；T64–T107 是此后同一会话里继续的真桌：阈值未改，期间安装了 1.1.31 与 1.2.0–1.2.6，
T91 起 KP 换回 Agents.md 指定的真桌默认 MiniMax。结果：T91–T107 未交付 41%、每回合 2.88 次失败。
按评审自己的判据，这已经是「仍有系统性顺序/成本/恢复缺口」，应收敛职责而不是继续补。
v2 与评审的方向对应：宿主持有有序行动、最终 output 的单目的地形状不该决定行动怎么切段（§5.2 route）；
事件身份与观察证据分离（§5.1 situations / perceived）；常用操作签名小而完整、不靠查 contract 补齐（§5.5）；
普通服务归服务领域、不靠地点说明手工编排（§5.7、§9）。

### 2.8 KP 思考的去向与失败的性质（逐回合审计）

四段并行只读审计，每段逐个读完回合轨迹（思考、调用、结果）；比例是审计者的估计，关键结论我已回到原文抽查。

**T0–T16（MiniMax，开场、查档、第一顿饭）**
- 18 回合、91 次工具调用失败 41 次、6 回合未交付（T12–T15 连续 4 回合为了一顿饭）。>3000 字的思考块 46 个，协议约占 **70%**。
- 这一段的失败**多数不是地点系统**：同意审核 17 次（大多是点餐、拿钥匙、付款），服务规则 15 次，完备性闸只有 2 次。
  点餐路径里两道规则互相矛盾：同意审核说「玩家没选这个行动」，服务规则说「这项服务已经选过了，只报价不能完成」（T12–T14）；
  KP 照错误提示里的「用 output 收尾」去做，又被「A failed operation cannot release an unverified expression」拒掉（T12、T13、T15）。
- **完备性闸诱发编造：** T3 玩家查产权登记，output 被判「observation missing」后，KP 新登记「地产登记簿」特征，
  补写「受让人签名是沃尔特·科比特，Esquire，契约的签名与日期俱在」（U005，已核实）；这句后来进了调查员笔记本的文档正文。
- T1 一回合 22.8 万字思考，其中 19.1 万字写在最后一次成功写入之后，规划一个最终没交的 output；
  「走还是留」在相邻思考块里翻了至少 6 次，为同一地址编了 4 个不同门牌，没有一个落地。
- 静默落账：T1 未交付却落了旗标、4 条线索、+20 美元、手卡、钥匙；T6 未交付却记了「已付款」和 +2 分钟，
  玩家之后按这些收据行动（「餐费已经结清」），叙述却从未出现。

**T17–T34（MiniMax，「走到柜台等到几点再回窗前看」循环）**
- 18 回合、107 次工具调用失败 62 次（58%），7 回合未交付。思考共约 56.8 万字，其中 39% 花在最终未交付的回合上。
- >3000 字的思考块 53 个，协议/通道/猜闸门约占 **66%**；101 个思考块里 53 个在重新推导「含移动必须带 scene 评估」，
  28 个在重新推导交互内容有哪些构造器。原文例：「Hmm, for a stationary wait, beyond_travel true seems wrong but the
  schema demands it.」（U019 @5901）「Actually maybe a single place move to 点菜台 with time 15, then a second place move
  would be a second destination — refused.」（U020 @6458）
- 失败性质：KP 自己写错 32、正确方案被拒 18、难判 12。被拒的 18 次里 12 次来自同意审核、5 次来自完备性闸、1 次来自「一包一目的地」。
- **同意审核看措辞：** 玩家「我先走到点菜台旁，站在那里等…」，`relation:"beside"` 判不确定，改成 `"站在点菜台旁"` 即通过
  （U031，已核实）；U023 「beside」被拒、「at」通过。等待效果在移动收据存在之前被判「玩家没选」，移动落账后同一载荷通过（U022、U033）。
- **输出包表达不了往返：** 「先到柜台等、再回窗前」触发「一包一目的地」，拆开又撞 `beyond_travel` 顺序规则，两条错误方向相反。
- **为过闸而降级玩家意图：** U021 干脆删掉玩家要求的走动；U031 改 relation 措辞只为过审；U035 玩家买面包，最终包里没有物品和付款，
  草稿里却写店主递过面包；U036 收据是生活水平覆盖、钱包不变，KP 只好编「记在账上」，而玩家说的是「我付钱后带走」。
- **静默落账：** 6 个未交付回合留下移动、时间、NPC 活动收据，合计 65 分钟游戏时间无叙述流逝。

**T35–T68（T35–T38 MiniMax，其余 grok-4.5）**
- 34 回合、52 次失败、14 回合未交付；>2000 字的思考块协议约占 **65%**（集中在 MiniMax 的 T35–T38）。
  原文例：「Hmm — can the observe be in the output.commands after the move committed? … The rule says one output packet
  permits only one final destination.」（U037 @12545）
- 失败性质：KP 写错 31、正确方案被拒 8、难判 12。完备性闸 12 次拒绝里 11 次卡在 move 轴，紧跟在已提交的移动之后，KP 无路可修，
  在两道闸之间来回（见 R3 的 T39、T67–T68）。
- 34 回合里约 35 次是同一房间内的站位记账（窗↔柜台）；契约读了 28 次，都是重读没变过的 schema。
- 另见 R8：未交付回合静默流逝约 166 分钟、T67 落了线索；grok 在中文桌上把 observe 事实写成英文（U041 等 6 回合）。

**T69–T90（grok-4.5）**
- 22 回合、13 次失败、3 回合未交付；失败里 9 次是同意审核，其中 5 次判为误拒，且都有翻转：
  T73 与 T74、T75 与 T76 是同一句话、同一个 `time speak_briefly`，前一回合被拒、后一回合原样通过；
  T79 「贴近玻璃看一眼」两次被拒（「restriction clearance not established」），T80/T81 同形状通过。
- 真拦截也有：T82、T83 KP 自己加了玩家没要求的 observe，审核拒掉是对的。
- 点餐 T77：四次被拒（三次「uncertain」夹一次「already chosen」），最终订单直接消失，玩家下一句「收好还没付出去的钱」。
- 10 个回合里有 11 次专门读契约。

**T91–T107（MiniMax）**
- 17 回合、49 次失败、7 回合未交付；判定：正确方案被拒 16、KP 写错 17、难判 16。思考约 60% 花在协议上，失败风暴回合 70–90%。
- **玩家点的付款 6 次被拒，同一段里 KP 自己发起的 NPC、威胁钟、报价都通过**（T100–T102；T107 甚至为没建成的旅店记了报价）。
- T93 被判场外参考后整回合锁死，连只读 `inspect` 也被拒，12 次。
- T94–T96 同一个「推开起居室的门进去看」发了三遍；未交付回合里威胁钟被推进 1 格，T96 KP 以「玩家拖了三回合」为由又推满。

**T69–T107 汇总（已直接核实）**
- 10 回合未交付：T73、T75、T79、T92、T93、T98、T100、T101、T106、T107。
- 点餐结算一次都没通过：T77 三次「typed consent uncertain」夹着一次「This covered service was already chosen」；
  T100–T102 同一句点早餐的结算/消耗批次 7 次被拒、0 次通过，玩家发了 3 遍。
- T93 玩家「我推开起居室的门，迈进门里站定……看看四周的陈设」，被输入范围分类判成场外参考问题，
  「This message does not authorize fictional progression」连拒 12 次。这是另一道 Jev 硬闸（非地点 mod，列入 §9）。
- T106–T107 同一句「去附近找另一家旅馆……」：完备性闸 4 次拒绝（T106 的四个概率都在 0.43–0.57；
  T107 的 move 在 0.61 与 0.59 之间翻转）、同意审核 1 次拒绝，见 §2.3、§2.4。

**跨段结论：** 四段审计合计，失败里 KP 自己写错的约占四成，几乎都落在多入口、多模式字段和不透明 schema 上；
正确或可接受的方案被拒约占三成，集中在同意审核（移动措辞、等待、点餐）和完备性闸；其余难判。
思考里协议推演的比例各段都在 56–70%。

## 3. 第一个偏离点与已确认原因

原始设计（10-19，`location-system-and-tool.md` §1–§7）的方向是对的：一个小 `place` 入口，
地点/锚点/位置/场景分开，KP 负责理解与即兴，Jev 只做有限匹配，内核事务负责提交，
并明确要求「Do not retain three divergent movement implementations」。

**第一个偏离点：把房间内的站位和每一次「看」做成了必须有收据的权威事务**
（agent.md 第一段：「Each visit needs a move receipt; focused perception needs observe」）。
之后的所有闸门、通道规则和 agent.md 膨胀都从这里长出来：

- **R1 粒度错了。** 「走到窗边」「站在柜台前」「看一眼前厅」都要一条带 `at`/`spot`/`relation`/`facts` 的
  事务。它们没有机制后果，却把每回合的写入行数翻了几倍，每一行又都要过同意审核。
- **R2 感知被硬塞进世界事务。** 回合架构是 decision-only KP + 独立作者，作者只读已提交结果
  （`runtime/isolated-expression.ts:83-88`：observation facts stay in canonical outcomes）。「玩家看见什么」
  想送到作者手里，只能做成 `observe` 写入；为了防 KP 漏写，又加了完备性闸（`location-relevance.ts`）。
  感知是素材，不是状态。
- **R3 两道语义闸都在噪声区硬判。** 同意审核问「玩家选了这一行吗」，完备性闸问「这个包覆盖了玩家选的吗」，
  方向相反、都靠 Jev 概率、都 0.6 硬阈值、都失败即拒、重交方案就重新抽签（缓存键含方案本身）。见 §2.3。
  两道闸还会互相卡死：T39（U041）调查员已在上一个未交付回合被记到「橱窗前」，玩家重说「走到橱窗旁」，
  完备性闸判 move 缺失；KP 补一条原地 move，同意审核判不确定；再交原包，完备性闸照旧拒。T67–T68 同形：
  完备性闸要一个「人行道」上的站位，没有对应特征，KP 换成「通门小路」，同意审核判「玩家没选」。
- **R4 三个写入口。** 同一个移动可以走 `place` 工具、`apply {kind:"place"}`、`output.commands {kind:"place"}`，
  另有「有中间等待/服务就先 place move，最后一步才放 output」「一个包只许一个目的地」
  （`runtime/turn-packet-prototype.ts:232`，内核本身支持同事务顺序 staging，见 `kernel-ts/apply/index.ts`）、
  「含移动必须带 scene 评估」等规则。KP 每回合先要做通道规划。
- **R5 语法藏起来。** place/output 的地点字段对模型不透明，靠 `inspect need:"contract"` 拿 53 KB 契约；
  模型照旧写出 `op/change` 旧形状、`inspect` 混写字段、additions 写成字符串。
- **R6 指令堆积并越界。** agent.md 每回合按触发器注入，且包含点餐、付款、吃饭的顺序规则
  （「A served and eaten meal requires item quantity gain … then consumption loss」），这些属于现金/物品所有者。
- **R7 特征身份太脆。** 再次提到已有特征时换个说法就是 `feature_redefinition` 错误；
  KP 必须记住并「从 additions 里省略所有已登记特征」。
- **R8 中间提交不回滚。** 中间 place/apply 已落账、最终 output 失败时，半截状态留下：T107 为没建成的旅店记了报价；
  T67 正文 0 字，却落了移动（+30 分钟）、观察、线索 `clue:nailed-windows-t67` 和场景评估四条收据。
  T35–T68 段未交付回合里静默流逝的游戏时间合计约 166 分钟。下一回合 KP 把这些当作「已发生未告知」去圆。
- **R9 错误不可读或被逐字执行。** ajv anyOf 原文、几百字的 fix 祈使句；KP 拿 fix 当新指令再猜一轮。
  T44（U046）additions 被写成字符串，place 的联合 schema 报出「to: schema is false / via: schema is false /
  travel_band: schema is false / … / action: must be equal to constant / additions: must be array」，
  真正的原因埋在第 7 行；KP 误判成「框架把嵌套对象串行化了」，连错 4 次。
  同一原因在 place 自己的参数检查里有一句准确的话（`place-operation.ts` `place_array_required`），T54 一次就改对了。
- **R10 协议表面诱发 KP 失误。** T35–T68 段 52 次失败里，审计判为 KP 自己写错的有 31 次，但几乎都落在多入口、
  多模式字段上：T37（U039）连续 5 次把 move 写成 `action:"inspect"`；`apply {kind:"place"}` 走错通道；
  自造 `travel_band`；重提已登记特征触发 `feature_redefinition`。v2 里入口混淆、模式字段混写和特征重定义
  不再有落脚点；把嵌套数组写成字符串这类序列化失误仍可能发生，由 §5.8 的一句话确定性错误处理。

已排除：不是单一模型的问题（grok 段同样 38% 未交付）；不是 Jev 超时为主（123 次里没有超时拒绝，
拒绝全部来自已答出的概率）；不是某一个地点或某一本模组的内容缺口。

## 4. 未知项

- 完备性闸当初防的是哪一类真实事故（KP 漏写玩家要看的内容），在去掉闸之后作者凭地点描述补写能挡住多少，
  需要 §8 的复测回答。
- 准入对「跨地点移动」只问玩家原话目标时的实际概率分布，需要影子遥测量出来再定是否足够。
- 非地点的同意审核误拒（点餐 41 次）的根因不在本文范围，单独审查。

## 5. v2 设计

### 5.1 状态模型：什么是权威，什么是素材

| 东西 | v2 | 理由 |
|---|---|---|
| 地点身份、包含关系、描述、来源（模组/桌上新建） | 内核权威，Mod 状态，旧记录照读 | 回访连续性与重名区分的核心 |
| 队伍所在地点（scene） | 内核权威，跨地点移动过准入 | NPC 在场、时钟、出口、路程时间都依赖它 |
| 门/窗等特征的状态与可通行 | 内核权威，改变要过准入 | 有后果（锁、障碍） |
| 地点之间的视线/听觉关系（窗看街） | 世界记忆，可在 output 里顺手登记，不过闸 | 供远处事件连续性使用 |
| 进行中的事件（街对面的车与戴礼帽的人） | 世界记忆：名称、参与者、状态、上次评估时刻；有变化或首次确立才写 | 用户批准的观察连续性扩展保留 |
| 房间内站位（窗边、柜台前） | **素材**：随回合存一条 `pose` 便签，作者读它，不过任何闸 | 无机制后果；战斗/追逐的距离由各自模块管 |
| 这一眼看见了什么 | **素材**：`perceived` 短事实列表交给作者，随回合存档进历史 | 感知不是状态；已有的「公开场景历史」本来就会回给下一回合 |

评审提醒过「窗内外、边界哪一侧」这类感知相关的位置差别要保留。v2 的处理：一旦这种差别影响谁在场、
谁能听见、能不能进出（便餐室里 vs 门外人行道），它就是两个地点、走 route 并过准入；不影响时只是 `pose`。
粒度由 KP 按后果决定，不按房间大小或「进/出」字眼决定（与原设计 §3 一致）。

`perceived` 是短事实，不是成段正文，符合「KP 不起草完整对白或事件材料」的既有用户裁定
（`decision-only-kp-v4.md` 开头）。线索仍只能走 `clue` 效果，`perceived` 落不了线索。

### 5.2 一种写入形状

删除 `apply {kind:"place"}` 入口与 `place` 工具的 move/observe/establish/relate/feature 五种写动作。
地点写入只有一种形状 `where`，正常情况只出现在最终 output 里：

```json
{
  "where": {
    "route": [
      {"to": "已知名字，或新地点名", "via": "怎么走", "travel_band": "local_travel",
       "new": {"description": "新地点的外观", "within": null, "features": [{"name": "接待柜台", "description": "…"}]}},
      {"wait": {"until": "06:00"}},
      {"to": "…"}
    ],
    "features": [{"place": "…", "name": "后门", "state": "撬开", "passable": true}],
    "views": [{"from": "…/临街窗", "to": "街面", "sense": "sight", "description": "…"}],
    "situations": [{"place": "街面", "name": "亮灯的汽车", "status": "ongoing", "summary": "…", "participants": ["npc_22"]}],
    "pose": "站在柜台前",
    "perceived": ["前厅不宽，深色地毯磨薄……", "柜台后坐着值夜的伙计……"]
  }
}
```

- `route` 有序，可多站、可夹等待，内核在同一事务里逐站 staging、算路程与等待时间；
  去掉「一个包只许一个目的地」和「有中间等待就先单独 place move」两条规则。
- 同一地点内走动不写 `route`，只改 `pose`；因此也不再触发「含移动（包括同一场景内的局部站位）必须带 scene 评估」
  这条规则——T17–T34 段 101 个思考块里有 53 个在重新推导它。scene 评估只在真正换了地点时需要。
- 新地点直接写在到达的那一站上，不再区分 `establish` 与 `move additions`。
- 唯一的例外：检定要对目的地的人掷（`kernel-ts/resolve/pipeline.ts:254-271` 要求 NPC 目标在当前 scene 在场），
  这时先用 `place {go: <同一个 route 站的形状>}` 提交到达，再 `resolve`，剩下的仍放最终 output。
  规则只有这一句；形状与 output 里的 route 站完全相同，同一个校验器。
- `place` 另保留只读 `inspect`（查远处地点、查旧事件与旧观察）。

**承载协议：落在结构化回合协议上，不再改旧 v4 包。** 本 worktree 正在进行的
[structured-turn-protocol.md](structured-turn-protocol.md)（契约 §245）的核心是「Mod 注册精确的 capability，
`do` 执行，`show` 把结果交给作者，后注册者覆盖同功能的前者」。上面的 `where` 在 STP 里拆成 Enhanced Locations 注册的三个 capability：

| capability | 输入 | 准入 | 作者看到 |
|---|---|---|---|
| `place.go@2` | 一个 route 站：`to`、`asked_for`、`via?`、`travel_band?`、`new?` | 是（跨地点移动） | 到达结果 |
| `place.change@2` | `place`、`name`、`state?`、`passable?`、`asked_for` | 是（特征状态改变） | 改变结果 |
| `place.note@2` | `pose?`、`views?`、`situations?`、`perceived?` | 否（不是玩家行动，只做确定性校验） | 经 `show result:<id>` 拿到 `pose` 与 `perceived` |

等待仍用现有的时间 capability；多站行程就是同一个 steps 里按顺序的多个 `place.go` 与时间步，
内核同事务逐步 staging。上面的 JSON 只是把三者合在一起示意。旧 v4 包在 STP 通过质量门之前仍是默认，
v2 不为它单独实现一遍（§7 D6）。

### 5.3 准入只审有后果的部分，一回合一问

准入是宿主基础行为、关不掉（Agents.md「路由」表），v2 不动这一点，只改**问什么**：

- 只对 `route` 里的跨地点移动和 `features` 的状态改变提问；`pose`、`perceived`、`views`、`situations` 不是玩家行动，不提问。
- 每一站带上 `asked_for`：玩家原话里对应的那一段（如「去附近找另一家旅馆」）。准入问的是
  「玩家这句话是否选择了去这样的地方」，不是「玩家是否选择了 KP 起名的科比特街小旅店」。
  具体实例由 KP 即兴决定，这是 KP 的权责（`location-system-and-tool.md` §4 Owner 表）。
- 整条 route 一次提问，不按行拆；同一回合重交时，route 的 `asked_for` 不变就复用判决，
  不因 KP 改了措辞重新抽签。
- 阈值与「不可用即不授权」保持现状（见 §7 D3：这一条需要你确认不算「放宽准入」）。

### 5.4 删除输出完备性闸

`preflightSpatialDecision` / `locationDecisionCoverage` 不是准入（它不防未授权行动，它防 KP 漏写），
在 v2 里它要守的两样东西（站位收据、观察收据）已经不存在。删除这道闸，保留同样的 Jev 题目做
**影子遥测**（只记录、不拒绝、不进下一回合胶囊），用来量 KP 漏写率。KP 漏了 `perceived` 时，
作者按玩家原话与地点描述补写日常可见外观——这本来就是 agent.md 已给作者的权责
（「Ordinary visible texture … belongs to the author」），符合「TRPG 验收看演绎逻辑」（2026-10-07 用户裁定）。

**代价要说清楚。** 这道闸来自一次真实事故（契约 §242.3a「Selected focused perception is independently completed」：
live turn118 到了餐馆，却漏掉玩家明确要求的读菜单）。删闸后这类漏读会重新出现：外观作者能补，
但菜单价格、告示文字这类**信息**作者不能编，只能留给下一回合玩家再问。换来的是不再有「方案正确却被随机拒、
整回合未交付」——本局 37 次完备性拒绝，其中至少 T39、T67–T68、T106–T107 是正确或可接受的方案被拒
（T106 与 T107 是同一句玩家输入，两回合共被这道闸拒 4 次）。影子遥测会量出漏读率；漏读率真的高，
再单独讨论不阻断回合的办法，而不是恢复硬闸。

### 5.5 schema 常驻、小、完整

按 §5.2 字段写出的完整 JSON Schema 草案实测 2,533 字节（压缩后），对比现在一次契约读取 53 KB；
每次请求都完整声明，删除 `inspect need:"contract"`、
`locationCommandEntry` 的不透明分支和 `op/change` 兼容形状。字段描述只写字段含义，不写规则段落。

### 5.6 特征身份宽容

已登记特征按名字归一化匹配复用；再次提到时带了不同描述就**忽略描述**、保留原外观，不报错；
只有 `state`/`passable` 的改变才是写入。删除「additions 里必须省略已登记特征」这条规则。

### 5.7 指令瘦身

- agent.md 重写为 ≤ 3 KB 常驻：复用身份、即兴新地点、`where` 怎么填、不要为了看一眼写 route。
- 「给作者的地点描写」一节是写作指导，移到作者侧（narration-craft 或作者参考段），不再进 KP 请求。
- 点餐/付款/吃饭顺序规则移出地点 mod，交还现金/物品的所有者（§9 另审）。
- 不再按 `before_apply:place` 触发情境段落。

### 5.8 失败与错误

- 除 §5.2 的检定前到达外，地点写入只在 output 里，output 失败就整体不落账，没有半截地点状态
  （T107 那种「为没建成的旅店记报价」的现金部分属于 §9）。检定前已提交的到达是真实发生的移动，保留并照常叙述。
- 错误只报确定性字段问题：一句话说哪个字段、期望什么；不输出 ajv anyOf 原文，不写祈使句 fix。

### 5.9 迁移

- Mod 升 2.0.0，`state_version` 2。v1 的 places/features/relations/situations 原样读入；
  v1 的站位收据折算成 `pose` 便签；v1 的 observation 索引保留为只读历史。
- 战役是编译快照：已建战役锁在旧版本；v2 只对新战役生效，或由你决定是否给「鬼屋」这一局做显式迁移（§7 D5）。

## 6. 影响范围（预计）

| 区域 | 文件 | 动作 |
|---|---|---|
| Mod 包 | `mods/enhanced-locations/{agent.md,mod.json,sections.json}` | 重写，升 2.0.0 |
| 共享 schema | `shared/place-structures.ts` | 换成 `where` schema；删 PlaceParameters 的写分支与 op/change |
| 宿主工具 | `extensions/kernel/place-operation.ts`、`tools.ts` 的 place 声明、`extensions/table/location-context.ts` | place 只读；删除契约按需加载 |
| 输出协议 | 推荐（D6）：结构化回合协议的 capability 注册处（`runtime/turn-capabilities.ts`、`runtime/turn-protocol.ts`，均为另一路未提交工作）；过渡方案才动 `runtime/turn-packet-prototype.ts` | 登记 `place.go@2`/`place.change@2`/`place.note@2`；删除一包一目的地、place 命令分支 |
| 闸门 | `extensions/kernel/index.ts` `preflightSpatialDecision`、`extensions/table/location-relevance.ts`、`location-coverage-error.ts` | 完备性闸改影子遥测 |
| 准入 | `runtime/jev/continuous-consent.ts`、`extensions/kernel/admission.ts` 的地点分支 | 只审 route/feature，按 `asked_for` 提问，route 级复用 |
| 内核 | `kernel-ts/mods/locations.ts`、`location-observations.ts`、`apply/move.ts`、`read/locations.ts` | 多站 route、宽容特征、pose/perceived 存档、迁移 |
| 作者 | `runtime/isolated-expression.ts` `LOCATION_AUTHOR_NOTE` 与 decision_context | 读 `pose`/`perceived`，不再读 observe outcomes |
| 契约 | `docs/kernel-rpc.md` 新节（编号只增） | 先改契约再改代码 |

**协调：** 本 worktree 有另一路会话的 173 个未提交改动，含 `runtime/turn-protocol.ts`、
`docs/specs/structured-turn-protocol.md`、`extensions/kernel/{index,final-output,place-operation,tools}.ts`。
v2 与它们重叠，实施前必须先确定谁先落地、在哪个分支上做。

## 7. 需要你拍板

- **D1** 房间内站位和「看见了什么」不再是世界写入/收据，降为交给作者的素材（§5.1）。
- **D2** 删除输出完备性闸，只留影子遥测（§5.4）。
- **D3** 准入对移动改问「玩家原话里的目标」并按 route 一次提问、重交复用；阈值和「不可用即不授权」不变。
  台账里记过「relaxed consent threshold 不是可接受的修复」——这一条不改阈值，但改了问题，需要你确认不算放宽。
- **D4** 点餐/付款/吃饭规则移出地点 mod，非地点的同意误拒另开审查。
- **D5** 「鬼屋」这一局：保持旧版本只读，还是显式迁移到 v2 继续玩。
- **D6** v2 只做成结构化回合协议（§245）上的三个 capability，等 STP 落地后再接；还是先在旧 v4 包上做一版过渡。
  我建议前者：旧包正在被替换，两边各做一遍等于再造一个分叉入口。另外 STP spec 写着要「保留地点审核里日常氛围描写与
  有后果观察的区分」，与 D2 有交集，需要你和那一路的负责会话一起定。

## 8. 验证方法（原始失败路径）

先红后绿，都走真实入口：

1. **确定性用例（盒子上跑）：** 用下列原始玩家原话与当时世界快照构造提交，证明：多站 route+等待一次落账；
   新旅店在同一事务里建成并到达；重提已有特征不同描述不报错；output 失败不留任何地点收据；准入对同一 `asked_for` 复用判决。
   - T106/T107「去附近找另一家旅馆，走进前厅，看看里面的布置，再向柜台打听……」（新地点 + 进门 + 看）
   - T20「离开窗边，走到点菜台旁站着等到六点，再回到这扇窗前，看看……」（同地点往返 + 等待）
   - T37「离开事务所，沿街找一家还开门的药店，走进去看看……」（即兴新店）
   - T92「沿着左墙走到通往起居室的门洞，推开门，站在门边看看……」（特征状态改变 + 看）
   - T39「仍在药店里，走到橱窗旁看看……」（已在目标站位，两道闸互卡的原样）
   - T67/T68「站在宅前的人行道上看看房子的正面」（没有对应特征的站位）
2. **真桌：** 新战役（战役是编译快照），`tests/play/driver.ts` + `minimax-cn/MiniMax-M3.1-Flash-Preview` / medium，
   主会话当唯一玩家，一回合一句，覆盖：找一家没去过的店并进门看布置、店内走到窗边等到某时再回柜台、
   隔窗看街对面事件并过一会儿再看、回到旧地点认出旧布置与旧事件、撬/开一扇门。
   指标：地点系统造成的拒绝次数（目标 0）、未交付回合、每回合调用数与耗时、思考里协议推演的比例。
3. **App：** 打包到唯一落点后在真 App 里复走第 2 步的关键段。

代码修复、回归通过、真桌、App 四项分别报告，不互相冒充。

## 8a. 已实施：Jev 误判热点改由 KP 判断（契约 §249，2026-10-21 用户裁定）

用户裁定：「如果现在 jev 老是有问题就先把一些 jev 经常误判的地方不用 jev，直接改让 kp 来判断吧，不然不但不能提速，反而减速。」
这直接回答了 D2，并覆盖了 D3 的大部分。已在分支 `claude/jev-keeper-judged-20261021`（worktree
`~/leehow/code/chatrpgv4-wt-jev-keeper-20261021`，基于 `0.9.8a@34afc4d63`）提交 `4a56b0f36`：

| 原来问 Jev 的地方 | 本局证据 | 现在 |
|---|---|---|
| 输出完备性闸（地点 move/feature/observation 三轴） | 123 次、拒 37 次，判决在 0.59/0.61 之间翻转 | 删除，KP 自己判断是否交代完整 |
| 回合前的地点预判（是否需要地点上下文、是否开审） | 499 次，89% 判需要，单步约 0.7–1.3 s | 删除；有地点 Mod 就加载地点上下文 |
| 单 KP 同意审核：移动、站位/观察、等待、物品、付款、物品转交 | 拒绝率：结算 64%、物品 64%、转交 67%、等待 30%、移动 15% | 不再送审，KP 的提案即其判断；遥测记 `path:"keeper_judged"` |
| 报价复判（「这是不是已经点了的服务」） | 与同意审核互相矛盾（T12–T14、T77） | 单 KP 路径下不再运行 |

仍由 Jev 审：检定 `resolve`、地图、用物、对物品的文档写入，以及非单 KP 的 lane 审核路径；
这些类别「不可用即不授权」不变。输入范围分类（T93 那道）只在一回合出错，这一批没动。

代价（已写进契约并有专门用例守着）：KP 漏写玩家选的移动时不再被拦，回合照常发布、人不移动；
审计里这几类真拦截今后会照样落账：玩家只问了有什么吃的 KP 就结账（T11）、KP 自己加了玩家没要求的 observe（T82、T83）、
玩家没要的委托书物品转交（T1）。T1 里 KP 替玩家选图书馆去检定属于 `resolve`，仍然在审。

本节只是 v2 的第一步；§5 其余部分（站位/观察降为素材、单一写入形状、schema 常驻、指令瘦身）仍待 D1、D4–D6。

## 9. 不在本次范围（另行审查）

- 非地点的同意审核误拒：T100 点早餐被连拒 3 次「玩家没有选择这个行动」，玩家发了 3 遍。
  已有候选：`claude/quick-settlement-mod-20261021@279c9d869`（§247，未并入 0.9.8a），用户 10-21 要求先看它再做逐动作修补。
- 输出包交互构造器：`service_at` 只有 `dine_in/takeaway`，KP 用它表示「住到中午的房间」；内容项校验错误不可读。
- 输入范围分类误判：T93 普通的游戏内行动被判成场外参考问题，同一回合连拒 12 次。
- 中间 `apply` 落账后最终 output 失败的通用回滚问题（地点部分由 §5.8 解决，现金/物品部分另审）。

## Comments

## 进度记录（Ralph Loop 续做用）

- 2026-10-21 `4a56b0f36` §249：Jev 误判热点改由 KP 判断。
- 2026-10-21 `a117272ec` §250：一包整条路线、宽容的地点命令、契约读取改短、mod 2.0.0。
- 2026-10-21 `ef7970257` 测试对齐 §250。
- 2026-10-21 下一提交：`adjusted` 进入 place/move 的 outcomes 投影，KP 能看到内核纠正了什么。
- 2026-10-21 `39c1e90f0`/`12d5535a8`：交互内容项按自身键定位分支报错（T107 的 input_requirements topic 不再报成 fact_ref）。
- 2026-10-21 `c2834cd54`：并入 origin/0.9.8a（§247 Quick Settlement、§248 mod 索引；现装 App 已含这两项，不并会倒退）。
  共享检出 `chatrpgv4-wt-pi-coc-v2` 有另一路未提交工作，本地 0.9.8a 引用未移动；打包从本分支出。
- 2026-10-21 打包 App 不带 `browser-ui`（`Electron/packages/ui/dist/browser` 不是打包产物），本地 Debug 打不开；
  配对链接带密钥，不交给子代理；computer-use 被用户拒绝。改用 Agents.md 规定的唯一验收方法：`tests/play/driver.ts`
  RPC 起 `bin/pi-coc`，MiniMax-M3.1-Flash-Preview medium，sonnet 子代理当唯一玩家（一回合一句）。
- 2026-10-21 第一桌 `el-v2-20261021a`（旧构建 1bf73764e）25 回合：地点系统拒绝只有 1 次（我引入的指路退化，已修
  `4b70ecf92`）；全部错误 12 次、未交付 2 次（T12 MiniMax 搜索回放 400、T16 读取死循环）、中位 97 s。
- 修复（全部已提交）：`4b70ecf92` 指路构造器；`79da4e873` 服务先后规则移到 quick-settlement 1.1.0；
  `926cd1961` 观察历史只在本回合读过或再看同一视角时给作者；`246b36fd7` 会面检定由 KP 判、actor_id、handover 去掉、
  未开报价当新开销、lookup 空 kinds（§250.4）；`369f31483` 搜索结果与调用配对；`769310024` KP 自判动作被拒仍挂起、
  第 8 次连续读取附进度提示（§251）、kind 别名、claim 人物绑定；`db88e61d5`/`bdeb991eb`/`3c67ad4fe` 测试对齐。
- 第二桌 `el-v2-20261021b`（bdeb991eb）23 回合：未交付 0、中位 43.8 s、错误 13（地点相关：场景评估被推迟到下一回合 3 次、
  路人人流冲突 1 次、地点命令漏 kind 1 次）。修复：`1fcae3dca` §250.5 档位内分钟、§250.6 只有矛盾才要评估；
  `ddb5afaa6` 路人不算矛盾、resolve 由 KP 判（§249.4）、kind/name 推断；`1db0c524e` 只看环境的 routine。
- 盒子 `1fcae3dca` all：ext 6420/6432（3 个是本批有意改的断言，已改 `1cb194dba`）、integration 0 失败、lr 12/12。
- 第三桌 `el-v2-20261021c`（1cb194dba）14 回合后提前停：问路去图书馆时 NPC 无法给指路（claim 的 to 只认已发放地点），
  1 次未交付 + 5 次拒绝 → `0865e749e` §250.7 capsule 列出可提及地点。
- 第四桌 `el-v2-20261021d` 在 0865e749e 构建上进行中；盒子 all 等 Codex 作业让出后自动跑 0865e749e。
- 未做、需用户拍板：回访地点时作者没有上次描写（`decision-author-bindings` 有意禁止作者看旧正文，以防复读旧动作）；
  路程分钟只有档位默认值（local_travel 固定 30，区间 10–120 未用）。
- App 落点被其他会话的打包覆盖（现装 2c41438e0，claude/mod-sections-room）；最终合并打包需要先理清各分支合并顺序。
- 第四桌 `el-v2-20261021d` 的发现 → `a4aca62f2` 会面检定/NPC 掷骰失败不挂起、resolve 接 NPC 引用（§249.4）；
  `db823d901` routine 的时间记录不拒绝（§250.8）；`71ccbcf32` known_places、按 kind 诊断命令、NPC 去到达地即 here。
- 第五桌 `el-v2-20261021e`（71ccbcf32 构建）34 回合、移动相关 30 个：中位 63.9 s，未交付 1（T26，非移动回合），
  错误 10。地点相关：T8 空可选字段 2 次（`048e9aabf` 已修）、T25 `inspect` 用 `to` 被当写操作拒绝、T33 `look focus:place`
  与两站各一次人流评估被拒。T25 单回合 771 s，主要是查书未返回时的长思考（非地点问题）。
- 修复（全部已提交）：`80f46da04` known_places 移到胶囊顶层（where 超预算 6 个集成失败）；`02ad1a5fa` 房间继承空楼的人流
  评估、包指引与 §250.6 对齐、线索 establish 与书中线索同名时保留书中线索（§250.9/§250.10）；`9b94aaee2` inspect 用 to
  指地点、feature 说明自动登记设施；`55c68cb75` 接受孤注一掷/幸运提议不再掷骰（§249.5）；`a28fe85e7` 包模式下 ask
  暂存、与正文一起发布（§252）；`c883e5e53` place move 可带 label 给书中地点起玩家语言名（卡片不再显示 Scene，§250.11）；
  `06bce4124` 路线每站一个人流评估、look 看地点转 place inspect（§250.12）。
- 盒子 `80f46da04` all（leehow-pc）：ext 6436/0、integration 2255/0、lr 12/12。
- 第五桌玩家报告里非地点的问题（未修，汇报给用户）：作者正文与机制不一致（T23 SAN 损失没写、T24 STR 失败门却开了、
  T25 伤害和两次检定没写）、同一 NPC 两个名字、查书未返回时 KP 长时间斟酌。
- 盒子 all：`be728d292`、`aad4dc343`、`da6fc3dbd` 全绿（leehow-pc，ext/integration/lr 0 失败）；`06bce4124`/`65a2d3879` 的两个失败
  （单个 scene 命令仍是终点声明、内房线索断言随 §250.10）已在 `be728d292` 修。
- 打包：`be728d292`、`aa022b0a5` 先后打到唯一落点（收据核对、.staging 空）；替换了另一会话未合并分支 2c41438e0 的构建。
- 第六桌 `el-v2-20261021f`（be728d292 构建）32 回合：未交付 2（T19、T25）、错误 28、中位约 69 s，不达标。修复：
  `34dca9b39` 没有挂着的提议时 accepted+handover 即直接交接、apply 认包内人物引用（§250.14）；`40c4a1e17` 调查员可当文件读者
  （§250.15）；`aad4dc343` 两类效果共有字段按内容判读（§250.16）；`da6fc3dbd` place 整数字符串（§250.4）；`4726aae0b` resolve
  改技能后同一行为解除挂起（§249.4.1）；`aa022b0a5` not_here 线索拒绝不再吞掉整回合（§252.1）。
- 未改、待用户拍板：文件写入（抄笔记）的 Jev 同意复核六桌里 8 次判对 2、判错 6（玩家明说"抄进笔记本"仍被拒），按"Jev 常误判就交给
  KP"应改为 KP 自判，但这推翻用户 10-06 的明确决定且要改一批用其当"被复核"样例的测试，故未动。
- 非地点问题（汇报）：失败的 Library Use 每次记 240 分钟（T18 一次跳 8 小时）；检定在授予之前未强制（T12 先给线索后掷骰失败，
  KP 长考 180 s）；开局 KP 在已发布后仍重发开场包（6 次 awaiting_player 拒绝）。
- 第七桌 `el-v2-20261021g`（aa022b0a5 构建 = 打包收据 aa022b0a5；盒子 all 全绿）：**完成标准达成**。连续 15 个移动相关回合
  T7–T21：地点系统造成的工具拒绝 0、未交付 0、全部工具错误 2（library-research 规则无检定、技能名 Mechanical Lockpick，均非地点）、
  中位 47.8 s；T8–T22、T9–T23、T10–T24、T11–T25 同样通过。覆盖：即兴进没去过的咖啡馆看布置（T3）、窗边等到十点一刻再回吧台
  （T4–T7）、隔窗看街对面两次（T5/T6/T8）、回委托人事务所（T14）、开门/撞门（T17/T22）、跨城区（T11/T14/T23/T25）。
  开桌前 T5、T6 两次未交付是作者端 MiniMax HTTP 529 → `fc969d920` 加了重试（§252.2），T11 的规则错误 → `da0b397fd`（§249.7）；
  这两项在分支上、盒子测试中，尚未打包。
- 第七桌后半 T27–T29 又有 3 次作者端 HTTP 529 未交付（同一原因，aa022b0a5 尚无重试）。盒子 all `da0b397fd` 全绿后，最终打包
  `726ce53f2`（= da0b397fd + 本文档，含 §252.2 作者重试与 §249.7），收据核对、.staging 空；作者重试尚未在真桌上复测。
- 2026-10-21 用户拍板：文件写入（抄笔记）改为 KP 自判（§249.6，`ad35e2ec9`）。8 个文件 21 个以"抄笔记"当被复核样例的测试改用地图揭示
  （仍受复核的种类）并按地图标题断言（`bfd524525`）；新增端到端用例：抄笔记不经同意复核、直接落地。畸形写入拒绝、§200 已选记录检查、
  单 KP 以外的复核车道不变。
- 2026-10-21 地点 mod 收尾：`fd8aa0bf9` 已知道路保持长度，档位不再覆盖（§250.17）；`47b37fc3d` 写到包外层的命令归位（§250.4）；
  `e2b3ab17b` 回到旧地点时宿主替作者读该地点之前已交付的观察（`need:"history"`，只给宿主），作者据此保持固定陈设一致（§250.18）。
  未修：KP 偶尔漏写路线中的一站（第六局 T3：思考里规划了等到十点半、回吧台，提交的包里没有）——是模型漏写，宿主没丢；
  纯规则补不了，只能加 Jev 完整性复核或让 KP 每回合附自查清单，二者都与"少误判、少思考"相冲，待用户定。
- 第八桌 `el-v2-20261022h`（e633607ef 打包）T6：KP 写 `travel_band:"adjacent", travel_minutes:7` 走回烟纸铺，被 `travel_conflict` 拒绝，
  重发只带分钟才落地；同一段路先后记成 0、0、7 分钟。修法（§250.17 补充）：无范围档位旁的明确分钟直接采用并报
  `adjusted: band_without_range`，`travel_conflict` 退役；明确分钟从此成为这条路的长度（§218.3），只给档位永不改已知道路。
- 第八桌 T4：玩家从烟纸铺走回诺特事务所问话，KP 先给诺特的线索、后落移动，线索被判 `not_here`，报错没说线索在哪，晚一回合才拿到。
  修法（§250.19）：场景外的 `not_here` 拒绝带 `details.found_at`（该线索可得的场景），fix 引用它以便宿主渲染，并说明玩家选了要去时
  移动先落、线索后给；不推未选择的移动、内层场景纠正仍只点直接子场景（两条既有用例保住）。
