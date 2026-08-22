# Pi-Coc 模组供给重构：管家群 + 分级解析 + 场景预取

- 日期：2026-08-10
- 轨道：ACTIVE_IMPLEMENTATION_TRACK=pi-coc（Codex 轨 off-limits）
- 状态：部分实现（2026-08-22 更新）。`steward.scene_supply`、scene bundle
  状态、专职 steward agent、Pi 迁移门控和确定性测试已存在；尚缺一次从原始来源
  开始、跑到结构化结局的 fresh Pi-Coc RPC 验收，因此不能宣称本设计整体完成。
- 前置事实来源：`/Users/haoli/Documents/TRPG/克苏鲁的呼唤/` 14 份 PDF 普查（10 本模组正文抽样）；Firecrawl pdf-inspector 实测（Cold Harvest 48 页：42 native / 6 OCR，分类 24ms / 提取 212ms）；OCR 切片实测（拆 6 页 → baiduocr 2s，页码映射验证通过）；三路只读研究（pi-subagents 异步机制、pi-coc 隐藏通道、PipiUI 异步处理模式）。

## 1. 目标与问题

### 1.1 用户要解决的问题

现有模组供给链（bind → full_parse → classify_sections → extract_section → 16KiB wire → coordinator）反复卡壳（空 catalog、claim_projection_invalid、16KiB 超预算），且"管家"（steward）角色只存在于设计，从未实际供给。用户拍板：**废弃该自动队列方案**，改为：

> 玩家选择模组 → Firecrawl pdf-inspector 转 Markdown → 阻塞提取建卡最小包 → KP 建卡（期间管家群后台异步并行解析）→ 场景管家预取当前+周边场景 → KP 经隐藏通道按需取素材 → 玩家只见 finalize 文案。

### 1.2 成功标准

1. 新模组从拿到 PDF 到玩家可以建卡：**阻塞阶段 ≤ 可感知的短时间**，且建卡信息（年代/地点/难度/推荐身份/预设卡）完整；
2. 建卡期间后台解析**不阻塞 KP**，玩家侧无感知；
3. 进入新场景时**当前+周边场景已就绪**（场景预取），无"正在加载"；未就绪时 **KP 等待而非即兴**；
4. 玩家永远看不到管家通道、campaign 秘密、解析中间产物——只看到 finalize 的 `rendered_text`；
5. 全程证据可导出（battle-report COMPLETE，dice 完备）。

## 2. 事实基础（已实测/普查）

### 2.1 模组结构共性（10/10 本）

```
守密人背景/真相 → 开场读白/任务 → 地点/调查块 → 结局分支 → 附录（预设卡/小卡片/地图/数据）
```

- 建卡关键信号几乎总在**开篇前几页 + 文末附录**（但**不保证**——封面/目录页可能占位，见 §4.1 软定位）；
- NPC 数值与扮演简介常**双轨分离**（开篇简介 + 文末 Dramatis）；
- Handout/小卡片是一等公民（任务件/日记/名单/私人预设卡）；
- 场景衔接四类：显式章节邻接、if 条件转移、hub 发散、时间线敌方节拍（+时光圈）；
- 预警/风格信息不均匀：部分模组有独立 Warning 页，多数仅开篇风格句；
- 预设调查员出现率 ~10/10。

### 2.2 工具实测

| 工具 | 实测结果 |
|---|---|
| Firecrawl pdf-inspector 1.12.0 | Cold Harvest 48 页：42 native / 6 OCR（物理页 1,2,44,45,46,47）；分类 24ms、提取 212ms；**不抽图**（地图只剩标题，且不进 needs_ocr 列表） |
| baiduocr（切片路径） | 拆 6 页子 PDF → adapter `fast` 2s 完成；页码映射验证通过；**纯图像 handout 页不给语义文字** |
| pdf-inspector native 质量 | 单流页中文可读；**双栏交错、假表普遍 FAIL**；地图/插图 0 张导出 |

**正文供给决策（讨论确认）**：双栏乱序/假表**不做结构化重排**——原始页 Markdown 直接作为供给（LLM 对交错文本鲁棒，可语义归位）；**唯一例外是地图/图像页**（文字全丢，必须原图/渲染图，见 Skill 5）。这避免为修复版式而造第二套解析管线。

### 2.3 平台机制（已核实）

| 能力 | 事实 |
|---|---|
| pi-subagents 0.45.2（已隔离安装到 coc-agent） | 异步 detached 子进程，父调用立即返回 asyncId；完成后仅父会话被 `sendMessage({triggerTurn:true})` 唤醒；`subagent_wait` 主动取；**retained children + resume**（新进程+旧 session 文件，上下文延续）；**支持嵌套**（nestedRoute/depth，管家可再派 sub-subagents） |
| PipiUI 异步模式（参考） | 子进程 fire-and-forget + `sendUserMessage({deliverAs:"followUp"})` 注回完成信号；stall/heartbeat 检测 |
| pi-coc 隐藏通道 | `pi.sendMessage({display:false, customType})` = TUI 隐藏、KP 模型仍见；`pi.appendEntry` = 都不见（审计）；`message_end` transcript gate 剥离/改写玩家可见文本；**无 multi-viewer ACL**（display:false 非密码学隔离，session 文件仍存） |
| 管家既有设计 | `coc-steward/SKILL.md`：独立会话 + `save/steward-state.json` 单向投递 + `secrecy: keeper_only\|player_safe` |

## 3. 架构总览

```
玩家（可见：turn.finalize rendered_text）
  ↑
KP（主会话；管家通道 display:false 隐藏；steward.deliveries 工具拉取）
  ↑ 派发短命令（resume 同 agentId，异步不阻塞）
管家群（独立 subagent 会话，玩家完全不可见；可嵌套再派 sub-subagents）
  ↑ 读页面缓存（Firecrawl pages/ + OCR 页，自己 grep/读文件，不经 KP 中转）
  ↓ 写
campaign 状态（save/steward-state.json，secret: keeper_only）
  ↓ 分级读取（索引+简介常驻/按需，全文按需）
KP 消化 → turn.finalize → 玩家
```

**核心原则**：
1. 管家**自己读缓存文件**，文本不经 KP/MCP 中转（根治 16KiB 教训）；
2. **索引 + 简介**先进 KP 上下文，全文按需拉取（上下文轻、传输小）；
3. schema 是**建议下限**，管家可自由扩展（薄 schema + 自主能动）；
4. 场景未就绪 **KP 等待，不即兴**（硬门控，复用 opening bootstrap evidence 门控模式）；
5. 玩家边界 = finalize rendered_text（既有机制，不新增）。

## 4. 战役生命周期 workflow（固定流程）

跑团是固定流程：会话开始先二选一（新建/加载），各走固定 123 步骤，然后进入游玩循环。KP 只按流程推进，不自由发挥入口。

### 4.1 新建战役（123 流程）

```
① 创建与绑定
   玩家：提供模组 PDF（或选已解析模组）
   KP：campaign.create（era/locale 默认从模组）
   → Skill 1 模组初始化：Firecrawl 快解析 → 首包 bind → opening review → L0 就绪
② 建卡（阻塞最小包已就绪）
   玩家：选 L0 预设卡 或 自定义建卡
   KP：用 coc-character skill → investigator_contract → create → link（不再重复确认）
   → 同时 Skill 2 管家群异步解析（npc/scene/clue/rule）
③ 开局
   建卡完成 → opening bootstrap（幂等）→ Skill 3 场景预取（开场+周边）→ 开场
   → 进入游玩循环
```

### 4.2 加载战役（123 流程）

```
① 选择与校验
   玩家：选 campaign（或 KP 列出可加载列表）
   KP：session.resume 恢复战役 → 校验 campaign/状态/管家域一致（freshness）
   → 重建 Skill 4 briefing（从 steward-state 重新注入）
② 状态恢复
   确认：调查员、当前场景、steward-state domains（ready/partial）、SceneBundle 缓存
   → 未就绪域：派对应管家补齐（异步）
③ 继续
   场景就绪 → 恢复游玩循环（Skill 3 预取当前+周边）
   → 玩家继续上一句的自然行动
```

### 4.3 游玩循环（两种入口汇合后）

```
玩家一句自然行动 → KP 消化（briefing 索引 + 按需拉取管家素材）
  → 需要新场景素材：Skill 3（当前+周边预取；未就绪则等待不即兴）
  → 检定：rules 骰 → 结果 → 需要 handout：检定后投递（player-safe 全文/原图）
  → KP 叙事 → turn.finalize（玩家可见 rendered_text）
  → 直到 structured ending → state.end_session + development.settle → 战报导出
```

### 4.4 关键约定

- **入口固定**：KP 不得跳过 123 顺序（如未建卡直接开局、未校验直接加载）；
- **建卡不重复确认**：玩家确认预设卡后，KP 立即 contract→create（SAFE 重写应推动行动而非再问）；
- **加载校验**：加载旧战役先验状态一致（campaign fresh、管家域不漂移），不一致则补/重建后继续；
- **管家 resume**：同 campaign 的管家 agentId 固定，跨会话 resume 保留领域上下文。

## 5. Skill 设计

### Skill 1：模组初始化（coc-module-init，阻塞建卡最小包）

**时序**：玩家提供 PDF → Firecrawl router 快解析（全本 native 页入缓存，OCR 页标记）→ **阻塞提取建卡最小包** → 门控放行建卡。

**建卡最小包（L0）**：
```json
{
  "module_meta": {"title_zh","title_en","authors","translator","era","locale",
                  "party_size","duration_hint","tone_tags[]","mythos_entities[]",
                  "campaign_hooks[]","warnings[]","safety_notes","structure_type"},
  "pregens": [{"name","age","occupation","hooks_to_plot[]","backstory_blocks","stats_ref"}],
  "opening_hooks": [{"id","audience":"player|keeper","text","variant_of"}],
  "chargen_deltas": [{"era_skill_remap","new_skills","stat_formula","item_grants"}],
  "opening_handouts": [{"id","title","when_to_give"}]
}
```

**门控**：`investigator_contract` 之前必须就绪（复用 `adopt_source_facts` 门控位语义）。

**注意**：
- **不硬编码"前 5 页"**：软提示 + 工具定位（见 §4.1）；
- 不解析 NPC 数值/线索网/地图——留给并行阶段；
- 地图/图像页**不自动跳过**：单独标记（§4.5），建卡期间可并行渲染原图；
- **OCR 页文本提取**：Firecrawl 标记的 needs_ocr 页若含建卡信息（软定位命中），**同步切页→baiduocr**（见 §4.6）；否则 OCR 切片进 Skill 2 后台并行，不阻塞建卡。

#### 4.6 OCR 切片路径（拆页→baiduocr）

- **拆页工具必须仓外**（AGENTS PDF 契约：仓库无 PDF 解析器）：沿用实验已验证的 pypdf 独立 venv（`ocr-slice-venv`），由 adapter/扩展以外部命令方式调用；不进仓库依赖、不进 uv.lock。
- 流程：Firecrawl 标记 needs_ocr 页（如 Cold Harvest 物理页 1,2,44-47）→ 拆子 PDF（6 页，~18ms）→ baiduocr adapter `fast`（2s 实测）→ 输出与页码映射写回页面缓存（映射已实验验证）。
- 归属：建卡信息命中 → Skill 1 同步；否则 Skill 2 后台并行。纯图像 handout/地图页（baiduocr 不给文字）→ 走 Skill 5 原图供给。

#### 4.1 软定位（不硬限制页范围）

提示词软指引（示例，供实现时写入 skill）：

> 建卡信息通常位于模组开篇元信息或文末附录，但可能被封面/目录占位。请用 grep/find 在页面缓存中搜索"预设/建卡/角色/年代/人数/难度/适合/职业/技能/警告"等锚点，自行判断信息位置；若锚点不足，读开篇 1–4 页与文末 2–4 页确认。不要假设页码。

禁止：正则/关键词硬匹配作为唯一判据（Semantic Matcher 宪法）；允许：grep 作为定位工具 + 语义判断。

### Skill 2：后台并行解析（coc-steward-parse，建卡期间异步）

KP 建卡期间派**管家群**并行（每个管家独立 resume 上下文）：

| 管家 agentId | 职责 | 输出（L1 索引+简介 / L2 全文） |
|---|---|---|
| `steward-init` | 建卡最小包（Skill 1 的执行者，阻塞） | L0 |
| `steward-npc` | NPC 双轨：简介（扮演要点/动机/秘密）+ 数值（属性/技能/法术/武器/SAN） | L1 + L2 |
| `steward-scene` | 地点/场景块 + 衔接边（四类）+ 地图引用 | L1 + L2 |
| `steward-clue` | 线索网 + handout 全文 + 小卡片 + 收件人绑定 | L1 + L2 |
| `steward-rule` | 附加规则/新技能/法术/时代修正 + 预警/风格（专扫文首 3 页 + 警告锚点） | L1 + L2 |

**初始 4 个管家**（init/npc/scene/rule+clue），实测后按需合并或拆分。上限建议 4-5 个。

**产出规则**：
- 写入 `save/steward-state.json`（secret: keeper_only；`secrecy` 标记）；
- **schema 是下限**：管家发现模组特有内容（如"信誉=党忠诚重定义"、"时光圈重置规则"）可自由追加字段；
- 完成通知：`display:false` custom message + `triggerTurn`（KP 被唤醒），或 KP `subagent_wait` 主动取；
- 建卡完成时未解析完的：**只阻塞开场所需维度**（scene 首场景），其余继续后台跑。

### Skill 3：场景供给（coc-scene-supply，当前+周边预取）

```
进入场景 N：
  scene 管家解析 N（若未就绪）→ 硬等待（KP 不即兴）
  同时预取周边：目录邻接 + 同父地点子节点 + if-链路 + 时间线下一步
  落盘 SceneBundle{current, neighbors[]}
  KP 经 steward.deliveries 拉取
```

**周边召回（机器可召回部分）**：
- 显式章节邻接（目录顺序默认推进）；
- 同父地点子节点（hub 发散）；
- 本场景块内 if-链路；
- 时间线下一步/敌方节拍；
- 纯叙事暗线 → 语义补全（scene 管家判断）。

**门控**：进入新场景时若 `SceneBundle.current` 未就绪 → **KP 等待**（玩家侧"场景载入中"或等待信号），禁止即兴编造。复用 opening bootstrap evidence 门控模式扩展到每个场景进入点。

#### 3.1 Handout 供给（检定后给玩家材料）

- **解析**：Skill 2 `steward-rule`（clue 域）解析 handout/小卡片全文 + 收件人绑定；可直交玩家的原文标 `player_safe`。
- **资产**：复用既有机制 `coc-scenario-import/SKILL.md` 的 `.coc/campaigns/<id>/assets/handouts/` + `index/handout-assets.json`（稳定 id/源页/visibility）；图像 handout 另走 Skill 5 原图资产。steward 产出需与 handout-assets 接线（实现期确认）。
- **就绪**：handout 作为场景素材的一部分随 SceneBundle 就绪（同门控：未就绪 KP 不投递）。
- **投递**：检定通过后（侦查/灵感/搜索等 rules 骰成功），KP 经 finalize 的 player-safe 通道投递 handout **全文/原图**（非一句话摘要；`turn-tooling-and-typed-ops.md:174` 已允许"handouts as delivered to the player"）；投递动作需绑定该检定 receipt（证据可追溯）。
- **边界**：未检定不投递；标 `keeper_only` 的永不给玩家；玩家侧仅见 handout 本体与 finalize 文案。

### Skill 4：常驻 KP 索引（coc-keeper-briefing，轻量）

```
ModuleMeta 简介 + 内容预警 + 风格一行 → 常驻 KP 上下文（轻量、L1 摘要）
场景索引 / NPC 索引（id + 1 句摘要 + 引用位置）→ 常驻
全文/数值 → 按需拉取（不进常驻）
```

- 常驻只放**轻量简介+索引**，全文一律按需；
- 避免长上下文污染（grok-kp-100-turn-degradation 教训）。

### Skill 5（辅助）：地图/图像供给（coc-map-supply）

- pdf-inspector native **不抽图**、地图只剩标题且不进 needs_ocr——需要**强制检查清单**：检测"图 N/地图 N/插图"标题页 + 低文本密度页，标记为需图像供给；
- 供给方式：渲染原页为图片（baiduocr layout_det 已证明渲染能力存在）或提取嵌入图像 → **直接喂给 KP 视觉**（Grok 多模态），不做文字转写；
- 地图页**不**依赖文本解析；handout 纯图像页同理。

## 5. 分级存储与实体 schema

### 5.1 分级

| 级 | 内容 | 消费方 |
|---|---|---|
| L0 | 建卡最小包（§4 Skill 1） | 建卡门控 |
| L1 | 索引 + 1-2 句简介 + 引用位置 | KP 常驻/按需浏览 |
| L2 | 全文/数值/正文 | KP 按需拉取 |

### 5.2 实体字段草图（薄 schema，可扩展）

```
ModuleMeta: title/era/locale/duration/party_size/tone_tags/mythos_entities/campaign_hooks/warnings/structure_type
TimelineEvent: id/label/when/trigger/actors/locations/pc_optional
Location/Scene: id/name/parent_region/readaloud/keeper_notes/exits_or_links/npcs_present/clues/handouts/items/maps_ref/san_checks/skill_gates
NPC: name/age/role_public/role_secret/appearance/personality/portrayal_tips/motives/knowledge/secrets/stats?/relationships/appears_in_scenes/handout_on_meet?
Clue: id/summary/source/required_checks/reveals/leads_to/secret
Handout: id/title/body_or_asset_ref/when_to_give/player_safe
RuleMod: name/kind(mechanics_text/overrides_core?)
Map: id/caption/page_ref/linked_locations/image_ref
PregenInvestigator: name/age/occupation/hooks_to_plot/backstory_blocks/stats?/private_handout?
OpeningHook: id/audience/text/variant_of
Resolution: id/condition/outcome_text/rewards_or_san/campaign_continue?
SceneEdge: from/to/kind(next|if|timeline|clue|fail_loop)/condition_text
```

### 5.3 steward-state.json 组织

单文件、分域节、版本化（供 Skill 2 实现对齐）：

```json
{
  "schema_version": 1,
  "campaign_id": "...",
  "updated_at": "...",
  "domains": {
    "init": {"status": "ready|pending|failed", "l0": {...}},
    "npc": {"status": "...", "items": [...], "index": [...]},
    "scene": {"status": "...", "current": {...}, "neighbors": [...]},
    "clue": {"status": "...", "items": [...]},
    "rule": {"status": "...", "items": [...]}
  },
  "failed_chunks": []
}
```

**统一来源引用**：每个实体带 `source_refs[]`（物理页码/章节/图注位置），供 KP 回溯原文与报告证据；`secrecy` 默认 keeper_only，player_safe 仅玩家安全内容。

## 6. 管家实现要点（pi-subagents）

### 6.1 配置

- coc-agent（`~/.pi/coc-agent`）已隔离安装 `npm:pi-subagents`（全局已清除，无冲突）；
- 自定义 agent 配置：`.pi/agents/`（coc-agent 目录下）定义 `steward-*` agents（tools: read/grep/find + steward 写状态工具；禁改 campaign 核心状态）；
- KP 通过 `subagent` 工具派发，agentId 固定 → resume 延续上下文；
- **KP 命令要短**：任务描述短，素材路径/引用通过参数传，文本由管家自己读。

### 6.2 异步与通知

- 派发即返回 asyncId，KP 不阻塞；
- 完成：result-watcher → `sendMessage({display:false, customType:"coc-steward-delivery", triggerTurn:true, deliverAs:"followUp"})` 唤醒 KP；
- 或 KP `subagent_wait <asyncId>` 主动取；
- 玩家消息排队语义：管家运行时 KP 可继续回玩家；仅"KP 需先消化管家结果"的回合会短暂等待。

### 6.3 隐藏与玩家边界

- 管家会话独立，玩家完全不可见（不是同会话隐藏）；
- 管家产出写 `save/steward-state.json`（secret: keeper_only），**不**经 sendMessage 注入主会话全文；
- KP 经 `steward.deliveries` / `steward.notebook` 拉取（工具调用，不进玩家 transcript）；
- 玩家可见唯一出口：`turn.finalize` 的 `rendered_text`（既有 transcript gate + exact-replace）；
- 诚实边界：`display:false` 非密码学隔离；若未来有外部玩家客户端，需宿主侧过滤（只转发 finalize 文案）——本期玩家 = PipiUI 同一操作者，够用。

### 6.4 管家 agent 配置（详细设计）

存放位置：`~/.pi/coc-agent/agents/`（pi-subagents 的 custom-agents 支持 `.pi/agents/`、`.agents/agents/` 与全局 agents 目录，实现期确认 coc-agent 具体路径）。

每个管家一个 agent 文件（frontmatter + 系统提示）。**通用模板**（所有管家共享）：

```markdown
---
name: steward-<domain>
# tools 白名单（实现期按 pi-subagents custom-agents schema 对齐）
tools: [read, grep, find, bash(限定缓存目录), steward.deliver, steward.notebook_put]
# 扩展：仅仓库插件（coc-keeper），不继承通用子代理扩展
model: grok-4.5
---

你是 COC 模组解析管家，负责 <domain> 域。

规则：
1. 只读模组页面缓存（Firecrawl pages/ + OCR 页）；文本自己读，不要等 KP 传全文。
2. 信息位置不固定：用 grep/find 搜索锚点（年代/预设/建卡/警告/地点/人名等）定位，
   不要假设页码；封面/目录占位页跳过。
3. 输出薄 schema（见下），模组特有内容可自由追加字段；JSON 必须合法。
4. 秘密默认 keeper_only；玩家安全内容标 player_safe。
5. 不修改 campaign 核心状态；只写 steward-state。
6. 长任务：按页范围/章节切分，必要时派 sub-subagents 并行（见 6.5）。
```

**各管家差异**（domain 与输出）：

| agent | domain | 输出（写入 steward-state） | 何时被派 |
|---|---|---|---|
| `steward-init` | 建卡最小包 | L0（module_meta/pregens/opening_hooks/chargen_deltas/opening_handouts） | 建卡前（阻塞） |
| `steward-npc` | NPC 双轨 | NPC 列表（L1 索引 + L2 数值） | 建卡期间（异步） |
| `steward-scene` | 场景/地点/衔接 | SceneBundle{current, neighbors[]} + SceneEdge 列表 | 建卡期间 + 每次进新场景 |
| `steward-clue` | 线索/handout/小卡片 | Clue/Handout 列表（含收件人绑定） | 建卡期间（异步） |
| `steward-rule` | 规则/预警/风格 | RuleMod 列表 + warnings 汇总 | 建卡期间（异步） |

**KP 侧调用约定**（coc-keeper-play skill 集成）：
- 短命令：`派 steward-npc 解析 NPC（缓存路径：<pages_dir>）`；
- KP 不传正文，只传路径/范围/意图；
- 结果经 `steward.deliveries` 拉取，不外泄到玩家文本。

### 6.5 嵌套 sub-subagents（并行解析协议）

**触发条件**：单个管家任务量过大（如整本 111 页血色公路、或 5 个维度同时请求）时，管家**自行**派 sub-subagents 并行。

**切分方式**（管家语义决定，给两个建议模式）：
- 按维度：scene 管家派 4 个子代理分别解析「地点块」「时间线」「if-衔接」「地图引用」；
- 按范围：长模组按章节/页范围切 2-4 片，各自解析后聚合。

**协议**：
1. 管家（parent）用 `subagent` 工具派发，agentId 带域前缀（如 `scene-chunk-1`）；
2. 每个子代理输出写**临时文件**（`<cache>/steward-work/<domain>/<chunk>.json`），不直接写 steward-state；
3. 管家等待全部完成后**读取聚合**，合并去重（实体 id 冲突以先到者/高置信者胜，记录 provenance），再写 steward-state；
4. 完成信号：管家向 KP 回传（父 subagent 的 result-watcher 链自动逐级唤醒）。

**深度限制**：最多 **2 层**（KP → 管家 → sub-subagent），防止失控嵌套。实现期确认 pi-subagents nestedRoute 是否天然限制深度，若没有则在管家提示词中强制。

**成本/超时控制**：
- 并行上限：单次最多 4 个子代理（可配置）；
- 每子代理 max_turns 限制（实现期对齐 pi-subagents 参数）；
- 子代理失败：管家重试 1 次，仍失败则记录 `failed_chunks` 并降级返回已有部分（不阻塞 KP 主流程）。

**待实现验证点**：
- 管家子进程是否加载 `subagent` 工具（子代理扩展在子进程中是否可用）——pi-subagents 的 nestedRoute 已存在，但需实测；若不可用，备选：管家只聚合，子代理由 KP 统一派发（多 asyncId 并行）。

## 7. 与现有代码的关系

| 现有件 | 处置 |
|---|---|
| classify_sections / extract_section host-work 自动队列 | **废弃**（用户拍板）；相关 16KiB wire spill 修复保留与否待实现期评估（作为安全网可保留代码但不再主动入队） |
| coc-steward skill + steward.* 工具 + steward-state.json | **保留并激活**：管家群写入端 |
| adopt_source_facts / opening bootstrap 门控 | **保留**：建卡门控 + 场景就绪门控复用 |
| Firecrawl router（COC_PI_PDF_INSPECTOR_COMMAND） | **保留**：Skill 1 快解析执行端 |
| baiduocr adapter（COC_PROGRESSIVE_OCR_COMMAND） | **保留**：OCR 页切片路径（拆页→子 PDF→adapter fast） |
| full_parse 48 页 | **保留语义**（页面缓存），但不再驱动 classify 队列 |
| turn.finalize / transcript gate / secret 投影 | **保留**：玩家边界 |
| runtime/ web/ | 不动 |

## 8. 实施顺序

1. **Skill 1 初始化**（阻塞最小包 + 软定位 + 门控）——先跑通，前置依赖；
2. **Skill 2 并行解析**（管家群 + schema + 异步通知）——建卡期间后台；
3. **Skill 3 场景供给**（预取周边 + 就绪门控）——游玩主体验；
4. **Skill 4 常驻索引**——轻量收尾；
5. **Skill 5 地图/图像供给**——与 2/3 并行评估（关键依赖：渲染/提取能力复用）。

每步完成 = 真实 RPC 验收（fresh workspace/campaign、Grok KP、自然玩家、canonical report）后再进下一步。

## 9. 风险与开放问题

1. **场景就绪等待的玩家体验**：预取覆盖率 vs 等待频率；需实测调整预取半径；
2. **管家上下文长度**：长模组（血色公路 111 页）单管家上下文压力——必要时按子域拆分或按场景分片 resume；
3. **多管家调度成本**：KP 派发 4 个异步管家的 prompt 开销；实测后可能合并；
4. **地图图像供给链路**：渲染/提取能力复用方案待验证（baiduocr layout_det 或 pdf 页渲染）；
5. **嵌套 sub-subagents 成本**：管家再派并行子代理的模型成本与超时控制；
6. **schema 稳定性**：薄 schema 下管家自由扩展字段，需校验器只做最小集校验；
7. **废弃队列的清理**：classify/extract 相关代码/契约/测试的退役范围待实现期与用户确认（遵守"不破坏证据"与"thin code"原则）。
