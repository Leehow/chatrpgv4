# 不息的渴望 — 完整 playtest 记录与发现

进行中的真实游玩测试：pi-coc（grok-4.5）当 KP，ZCode agent 当玩家。
RPC 模式驱动，headless 降级已生效（claim/fulfill 不循环）。
**不清理日志**（吸取之前教训）——异常证据保留到问题解决。

## 已发现的问题（记录，暂不改）

### P2-new: KP 文本泄漏内部状态
- **现象**：KP 在叙事中夹带调试性语句，如"session.resume 超预算；直接继续本回合裁定"。
- **影响**：出戏，玩家看到 KP 的内部工具调试过程。
- **位置**：KP 文本生成（grok-4.5 把工具调用的思考过程写进了叙事）。

### P2: 检定标注歧义
- **现象**：KP 对"普通成功但困难失败"的检定，文本写"达到：成功；未通过"——
  "成功"与"未通过"并列，语义矛盾。
- **实例**：侦查掷骰 37，基础 55，困难门槛 27 → 普通成功（≤55）但困难失败（>27）。
  KP 标注"达到：成功；未通过"。
- **影响**：玩家可能困惑这个检定到底过没过。不影响底层规则判定（数值/门槛正确）。
- **位置**：KP 文本生成（grok-4.5），非 toolbox 规则层。

### 待测: SAN 理智检定 ✅ 已测到
- 第 3 局穿越回合**触发理智检定并正确处理**：
  - 【明骰】理智｜掷骰 78；基础 50；失败
  - 1D4 骰面 4 → SAN 损失 4
  - 【变化】SAN：50 → 46（-4）
- COC 7e SAN 公式正确（失败 = 基础损失 + 1D4）。
- 穿越场景：1890 → 1287 中世纪邓尼奇（屋脊/尖塔/火光/旗帜）。

## 游玩进度

### 第 1 局（调查员：塞缪尔·派克，走私者）— 3 回合
- 回合1：开局，邓尼奇装船点
- 回合2：观察同伴 → 聆听 39 成功 + 心理学 16 困难成功 → 线索：雅茅斯/荷兰/霍布
- 回合3：追霍布 → 侦查 13 困难 + 心理学 4 极难 → 超自然线索：海面黑静/潮水异象

### 第 2 局（调查员：露丝·哈罗，走私者）— 4 回合
- 回合1：开局
- 回合2：催促离岸 → 说服 2 极难 + Pilot 15 困难 → 成功离岸，教堂钟声+黑静跟随
- 回合3：直视黑静 → Pilot 86 失败 + 侦查 37（困难失败）→ 航向乱
- 回合4：Push 驾船 → Push 28 仍失败 → **代价：小货船倾覆，全部落水**

### 第 3 局（进行中）— 目标：跑完整个模组
调查员：威尔·克劳（走私者，SAN 46）。138 次调用，26 次检定，2 次 SAN。
- 回合1：开局+穿越。SAN 78 失败 -4。1890→1287 中世纪敦威治。
- 回合2-3：辨认年代失败，碎片"教堂不该在那儿"
- 回合4-5：盯教堂硬冲失败→弃船，年轻人"不该…尖塔…我梦见…"
- 回合6：缆绳拽上岸（游泳21困难成功）→ **上岸**
- 回合7：走向教堂（教育13困难成功）→ 推断教堂属1287年前
- 回合8-9：进教堂被察觉，说服96**大失败**→入侵者警报
- 回合10：投降被驱逐出教堂
- **当前**：教堂外雨中，需触发时光圈重置（**P0 bug 卡死，战役 07 无法推进**）

### 第 4 局（进行中）— 高 POW 角色快进时光圈
调查员：埃利亚斯·索恩（走私者，POW 80, SAN 80）。80 次调用，13 次检定。
- 回合1：快进开局→穿越 1287（意志 2 极难成功保持清醒，绕过 P0 bug）
- 回合2：观察小镇 → 侦查 42 成功 → **发现莎拉线索**：年轻女人被押向教堂、钟楼有人要敲钟
- 回合3：冲钟楼阻止敲钟 → 攀爬92/斗殴84/说服37 全失败 → **钟响了**，自己成靶子
- 回合4：观察重置 → 侦查70失败（重置"蓄力未落地"）/意志25困难成功（确认非幻觉）/闪避27成功脱身
- **当前**：退入窄巷，重置蓄力中，需等莎拉被烧死后完整重置

### P2-new2: NPC first-meeting 未用 APP/Credit Rating D100
- **现象**：威尔与教堂里的人首次实质性接触，KP 用"说服"检定处理反应，
  未按 AGENTS.md 要求做"first material meeting D100 check against APP/Credit Rating"。
- **影响**：NPC 反应机制偏离了 AGENTS.md 的 NPC Contact 规则。
- **位置**：KP 决策（选了说服而非 first-contact D100）。

## P0 BUG: SAN 大失败 → exceptional_effect 绑定死锁（turn.finalize 无法完成）

### 现象
理智检定大失败（掷骰 100）时，系统进入死锁：
1. `rules.sanity_check` 大失败 → 要求绑定 `state.exceptional_effect`（AGENTS.md: Exceptional Results Must Change Play）
2. KP 调 `state.exceptional_effect`，传 sanity_check 收据作为 `source_roll_id`
3. **`state.exceptional_effect` 拒绝**：`source_roll_id must name exactly one canonical percentile or schema-v2 first-impression receipt`
4. → `turn.finalize` 无法完成（SAN 大失败缺 exceptional 绑定）
5. KP 被迫跳过 finalize，文本里坦白报告了死锁

### 根因（初步）
`state.exceptional_effect` 的 `source_roll_id` 校验**只接受百分骰（percentile）或 first-impression 收据**，
**不接受 sanity_check 收据**。但 AGENTS.md 要求 SAN 大失败必须绑定 exceptional_effect——
这两条规则冲突：sanity_check 的大失败是 exceptional，但它的收据类型不在 exceptional_effect 的白名单里。

### 复现
- 第3局回合11：理智掷骰 100 大失败
- toolbox-calls.jsonl 里 3 次 `state.exceptional_effect` 全部失败（同一错误）
- KP 文本明确报告了死锁

### 影响
- SAN 大失败时 turn.finalize 卡死，KP 被迫跳过（违反 Rule 4 完整性边界）
- 玩家看到 KP 坦白报告内部死锁（出戏）
- SAN 代价（1 点损失）实际记入了，但缺 exceptional_effect 的正式绑定

### 修复方向（待设计）
`state.exceptional_effect` 的 `source_roll_id` 白名单应加入 `sanity_check` 收据类型，
或在 sanity_check 大失败时提供一个 exceptional-effect 的专用绑定路径。

### 第 5 局（进行中）— 高 POW 快进 + 深入时光圈核心
调查员：马库斯·里德（走私者，POW 80, SAN 80, Luck 65）。campaign: amaranthine-09
- 回合1：快进开局→穿越 1287（三项极难成功），直切教堂前，看到莎拉被押
- 回合2：冲押送队→斗殴35+力量48 成功→**夺回莎拉**
- 回合3：带莎拉突围→Navigate 98**大失败**→死胡同被堵
- 回合4：听莎拉低语→聆听45+心理学3极难→**真相：钟不能完整敲完**，莎拉可信
- 回合5：藏莎拉+冲钟楼→斗殴96**大失败**+攀爬60失败→被按倒，**钟敲完**
- 回合6：观察重置→侦查28/意志24/说服10极难→**重置验证：钟敲完→潮墙/光丝/叠龄→改口卷回**，莎拉已跑
- **当前**：第二轮循环即将开始

关键剧情发现：
- 打破循环的方法：**阻止钟完整敲完**（莎拉揭示）
- 莎拉记得多次循环（"见过太多次"的疲惫）
- 重置是渐进的"改口"，非瞬间闪电

## P1: KP 冗余重复工具调用导致回合耗时

### 现象
完整开局回合 259s，拆解：
- LLM 生成 36 次 × 6.9s/次 = ~248s（占 96%）
- 工具执行 70 次，几乎全瞬时（仅 1 次 coc_invoke 30s）
- 瓶颈是 LLM 生成次数，不是工具执行

### 根因：KP 反复调同类工具
52 次工具调用里大量重复：
- scene.context **12 次**（应 1-2 次/回合）
- progressive.publish_skeleton **8 次**（应 1 次）
- state.inventory_list **6 次**（应 1 次）
- session.resume **3 次**（应 1 次）
- progressive.prepare_opening **3 次**（应 1 次）

每次重复调用前都需一次 LLM 生成(~7s)决定调什么 → 36 次生成里
20+ 次是冗余重复导致的。不重复的话生成次数可从 36 降到 ~15，
耗时从 259s 降到 ~110s。

### 性质
KP 行为问题(grok-4.5 反复查状态), 非系统 bug。可能改善方向:
- 工具返回里提示"无需重复查询"(hints)
- 或 host-system prompt 引导 KP 缓存场景状态
- 但不能强制(KP 有权按需查)

## 并行 MCP 优化尝试（已回退）

### 尝试
- 去掉 McpJsonlClient 的 request chain（runtime.ts），让 coc_* 工具并行调用
- grok-4.5 确实能一个 response 批量调多个 COC 工具（验证：turn 3: 2 tools, turn 4: 3 tools）
- 开局从 259s 降到 131s（-49%）

### 问题
- 单进程 MCP child 的 stdin 不支持并发写 → JSONL 帧交错 → child 崩溃（~28s）
- child 自动重连(ensure())，但崩溃瞬间的请求丢失（7 个错误/局）
- 尝试只串行化 write() 调用(writeChain)不够——Node stream.write 异步，chain 在 flush 前释放

### 回退（commit d8c2dbe）
- 恢复完整 request chain（串行 start-to-finish）
- 慢（一工具一 turn）但稳定
- 安全的并行需要：多进程 MCP pool 或等 stdin 'drain' 的写入门控

### 当前稳定版包含的修复
- welcome auto-open 在 headless 跳过（a0ba75c）— 省 ~200s/回合
- headless progressive claim 降级（91d4feb）— 避免 spawn-child 循环
- SAN fumble → exceptional_effect 绑定（028ef8b）— P0 bug
- MCP 串行（d8c2dbe 回退）— 稳定但慢

## 待解决：循环重置后 KP 冗余重新初始化

### 现象
时光圈重置（回到起点）后，KP 每轮都从头做完整的场景初始化——
大量重复调用 scene.context(12次)、publish_skeleton(8次)、inventory_list(6次)等。
这些在重置前的上一轮已经查过，但重置后 KP 不记得/不缓存，重新查一遍。

### 性质
这不是 bug——是 KP 行为（重置后丢失了"已查过"的上下文）。
但系统可以帮忙：如果 progressive 能在重置时保留一个"场景状态快照"，
KP 第二轮就不用重复初始化，能更快进入核心行动。

### 影响
每轮循环的"启动开销"~150s（冗余工具调用），多次循环累积可观。
不影响正确性，只影响体验速度。

### 可能方向（待设计，非 bug 修复）
- 重置时给 KP 一个"上一轮场景摘要" hints，避免重新查询
- 或 scene.context 返回里提示"这是重置后的第N轮，参考已有状态"
- 不能强制——KP 有权按需查

## 待解决：MCP 并行调用（-49% 回合耗时，但需安全实现）

### 收益（已验证）
去掉 McpJsonlClient 的 request chain 后，grok-4.5 能在一个 response
批量调多个 coc_* 工具（验证：turn 3: 2 tools, turn 4: 3 tools）。
开局从 259s → 131s（-49%），后续回合同比例改善。

### 阻断问题（已验证）
单进程 MCP child 的 stdin pipe 不支持并发写。并行请求导致 JSONL
帧字节交错 → python reader 解析失败 → child 崩溃（~28s/局）。
尝试 writeChain（只串行化 write 调用）不够：Node stream.write 异步，
chain 在 flush 前释放，高负载仍交错。

### 需要的改动（三选一，都是较大工作）
1. **stdin drain 门控**：write() 返回 false 时等 'drain' 事件再写下一行。
   最小改动，但仍单进程（工具执行串行，只省 LLM 生成次数）。
2. **多进程 MCP pool**：起 N 个 MCP child，并行请求分散。
   真并行（工具执行也并行），但资源开销 + 状态同步复杂。
3. **改用 stdio JSON-RPC batch**：MCP 协议支持 batch（一次发多个请求），
   单次 write 写一个 batch 数组，避免交错。需要 MCP child 支持 batch。

### 当前状态
回退到串行（d8c2dbe），稳定但慢。并行优化留待上述方案之一实现。
