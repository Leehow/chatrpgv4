# COC 插件缺陷大蓝图（Master Defect Blueprint）

**Date:** 2026-07-08
**Status:** 设计定稿，待用户复审（brainstormed → spec pending review）
**Canonical track:** `plugins/coc-keeper/`（Codex）；ZCode 轨道 `plugins/coc-keeper-zcode/` 由 `scripts/sync_coc_plugin_copy.py` 同步。两条轨道的运行时脚本逐字节相同，本文所有 `file:line` 指向 canonical，zcode 同位置一致。
**审计方法:** 本文每一条缺陷均经代码与日志逐行核实（file:line 可溯），非照抄原始清单。原始清单中经核实不成立或被夸大的条目，单列"原清单勘误"节修正。

> 本文件是 COC 插件缺陷的**唯一真相源（single source of truth）**。修复实现以本文为基线；新增缺陷或勘误请追加修订记录，勿另起炉灶。

---

## 1. 背景与约束

本文尊重并强制 `AGENTS.md` 三条法则：

1. **COC Plugin Dual-Track Law** — 改 shared 行为先动 canonical 轨道，再跑 `python3 scripts/sync_coc_plugin_copy.py` 与 `--check`。平台差异只能落在 sync 脚本显式 allowlist：Codex `.codex-plugin` 元数据、ZCode `.zcode-plugin`+`package.json`、Codex-only `agents/openai.yaml`、`CODEX_ONLY_IMAGEGEN` 块、以及三条 allowlisted 文案替换（`Codex 掷骰`→`AI 掷骰`、`Codex ダイス`→`AI ダイス`、`Codex`→`ZCode`）。新平台差异须先改 sync 脚本与其测试。
2. **Playtest Battle Report Evidence Standard** — "战报"指真实 playtest 产物（含调查员背景、实际回合、检定、线索、场景推进、被评 enrichment/storylet 效果）。formatter smoke test 只能叫"formatter 验证样本"。本文引用 `.coc/` 下产物时，已先通读对应文件；`.coc/` 全量 gitignore，不作 durable 证据库，仅作即时核查。
3. **Semantic Matcher Constitution** — 禁止用关键词扫描自由文本（玩家 prose、NPC agenda、场景摘要、战报、译文）推断意义。运行时只能消费结构化字段、枚举、布尔、ID、tag、规则数据、或带 recorded reason 的 LLM/语义路由输出。遗留字符串启发式属技术债，不得复制进新行为。

**本文的例外授权（用户已确认）**：P0-4 的修复**允许新增语义步骤**，但输出必须是结构化字段（带 recorded reason），不得通过子串命中自由文本推断意义。

**插件结构速览**（供后续 file:line 定位）：
- `scripts/`：运行时纯 Python（director/enrichment/runner/apply/state/persona/storylets/roll/...），无包结构，靠 `importlib` 动态加载。
- `references/rules-json/`：41 张数据表（含 `storylet-library.json`、`the-haunting.json`、`the-white-war.json`、`npc-social-roles.json`）。
- `references/starter-scenarios/the-white-war/`：starter 场景包（story-graph/npc-agendas/clue-graph/...）。
- `skills/`：14 个 SKILL.md（coc-keeper-play 为主叙述技能，coc-story-director 为隐藏编排层）。

---

## 2. 核查结论总表（蓝图脊柱）

全表一行一条，分区。**核实**列：✅真 / ❌勘误。**根因层**标缺陷活在哪一层。

### 2.1 P0 区（4 真 / 0 勘误）

| 编号 | 条目 | 核实 | 根因层 | 主代码位置 |
|---|---|---|---|---|
| P0-1 | 全程多线分叉暗示没接好（开场+中段） | ✅真 | 数据层（scene 无 routes/leads_to）+ 叙事层 | `the-haunting.json`(纯规则零文本); `haunting-fullrun/.../story-graph.json:3-17`; `coc_playtest_harness.py:3864,4012` |
| P0-2 | 低主动推进失效 | ✅真 | runner 闸门 + director tag 统一 + 落盘丢 tag | `coc_live_turn_runner.py:289,291-292`; `coc_story_director.py:549-575,616-622`; `coc_director_apply.py:761-763` |
| P0-3 | storylet 旁路化 | ✅真 | 触发闸门 + live 渲染断线 | `coc_narrative_enrichment.py:757-875`; `coc_live_turn_runner.py`(不渲染 storylet_moves); storylet-scheduler.jsonl 只写不读 |
| P0-4 | stop-actionability 复用旧抓手 | ✅真 | handle 只看静态字段 + 无反压 | `coc_narrative_enrichment.py:287-359`; `coc_live_turn_runner.py:498-507`; apply_plan 不写 active-scene.json |

### 2.2 P1 区（8 真 / 0 勘误）

> P1 从原始 4 大类拆成 8 条可定位条目（节奏 3 / NPC 3 / 文字 2），每条可单独落 file:line。

| 编号 | 条目 | 核实 | 根因层 | 主代码位置 |
|---|---|---|---|---|
| P1-1 | 过渡/行军场景拖长 | ✅真 | bridge 检测 dead-letter + 无进度契约 | `coc_story_director.py:57,642-647,650-660`; white-war 场景 `scene_type:"exploration"` |
| P1-2 | 无行动点也停 | ✅真 | 停止先于 actionability + 无反压 | `coc_live_turn_runner.py:470-476`; `coc_narrative_enrichment.py:343-359` |
| P1-3 | Roll density 不合并 | ✅真 | 合并只看单回合 atom + 导演检定绕过 | `coc_narrative_enrichment.py:433-501,556`; `coc_story_director.py:1604,1658,1706` |
| P1-4 | NPC authority 不稳 | ✅真 | NPC 数据缺 social_role + 模板零引用 + delegate 无条件 | `coc_npc_persona.py:398-402,469-477`; `npc-social-roles.json`(死数据); `the-white-war/npc-agendas.json`(无 role) |
| P1-5 | NPC assist scope 错位 | ✅真 | scope 是静态常量、不读当前 action | `coc_npc_persona.py:381,404` |
| P1-6 | 人设系统不影响行为 | ✅真 | 只读 4 个 tag；voice/flaw/drive 不读 | `coc_npc_persona.py:388-462`; `coc_narrative_enrichment.py:641-651` |
| P1-7 | 翻译腔/AI 腔 guard 不全 + 不通电 | ✅真 | 关键词表不全 + live 不调用 | `coc_narration_style.py:36-63,351-380`; `coc_live_turn_runner.py`(不调 guard) |
| P1-8 | 语言能力呈现没通电 | ✅真(修正说法) | 门控写好但 live 不调用 | `coc_language.py:140-202`; live runner 无引用 |

### 2.3 P2 区（4 真 / 3 勘误）

| 编号 | 条目 | 核实 | 根因层 | 主代码位置 |
|---|---|---|---|---|
| P2-1 | 奖励骰展示不透明 | ✅真 | formatter 隐藏分量 | `coc_roll.py:169-198`; `coc_playtest_report.py:115-124` |
| P2-2 | crit/fumble 无条件 high | ✅真(**方向修正**) | crit/fumble 硬编码 high；difficulty 无路径升冲突 | `coc_narrative_enrichment.py:793,808`; `coc_storylets.py:176-199` |
| P2-3 | ~~角色创建缺完整 UX~~ | ❌**勘误** | 4/5 已有，只缺角色列表 | 已有: `coc_character_creation_briefing.py:164-189`,`coc_character_card.py:204-297`; 缺: 无 list/registry |
| P2-4 | ~~helper API 没索引~~ | ❌**勘误** | `public_api_index()` 已有；残留缺口仅单模块 | `coc_roll.py:201-229`; 缺: 无跨模块聚合/`__all__`/help |
| P2-5 | PDF 图片/handout 没接 | ✅真 | 注册表只写不读 + scene/clue 无 image 字段 | `coc_scenario.py:81-93`; `coc_director_apply.py:726-728` |
| P2-6 | 后台记录非 subagent + flush 可疑 | ✅真 | 主流程同步阻塞 + flush fire-and-forget | `coc_live_turn_runner.py:348-377`; `coc_async_recorder.py:188-200` |
| P2-7 | 日志扩展不全 | ✅真(部分) | storylet why-not 有；NPC/clue match-miss 无；audit.jsonl 仅 playtest | `coc_storylets.py:642-675`(有); `coc_npc_persona.py:201-214`(无); `coc_playtest_harness.py:4075` |

---

## 3. 原清单勘误节

原始缺陷清单中，以下三条经代码核实**不成立或被夸大**。本文修正后保留真实残留缺陷，避免后续按假缺陷驱动实现。

### 勘误 1：角色创建 UX（原 P2-3）

- **原说法**：角色创建还缺完整 UX（列已有角色、点购/掷骰/分配池、角色卡中文化、立绘、Markdown 卡片）。
- **代码事实**：5 项里 **4 项已实现**。
  - 点购/掷骰/分配池：`coc_character_creation_briefing.py:164-189` 已提供 roll-in-order / rolled-pool-assignment / point-buy 460 / Quick Fire array 四法；`coc_character.py:39-77` `validate_characteristic_generation()` 有对应分支。
  - 角色卡中文化：`coc_character_card.py:204-297` `render_markdown()` 输出中文卡（战役/状态/属性/技能/武器/背景）。
  - 立绘：`coc_character_card.py:217-223,324-331` 已解析 portrait 并渲染；Codex-only imagegen 块在 `skills/coc-character/SKILL.md:62-83`。
  - Markdown 卡片：`coc_character_card.py:768-820` `render_cards()` 默认输出 `{slug}-character-card.md`，HTML 可选。
- **真实残留缺陷（P2-3'）**：**无已有角色列表/registry**——不存在 `list_investigators()`/list 函数（`coc_character.py`/`coc_state.py` grep 空），存储仅为目录约定（`skills/coc-character/SKILL.md:8-12`）。
- **修正后优先级**：P3-ish（低）。

### 勘误 2：helper API 索引（原 P2-4）

- **原说法**：helper API 没索引，掷骰函数名猜错，需要注册表/别名。
- **代码事实**：`public_api_index()` + 别名**已存在**。`coc_roll.py:201-229` 返回含 `aliases`/`signature`/`returns` 的字典，覆盖 `roll_expression`/`percentile_check`/`idea_roll`/`know_roll`/`format_percentile_result`；`coc_roll.py:146-160` `roll_percentile()` 是显式别名（"kept as a discoverable public API"）。`skills/coc-rules-engine/SKILL.md:19-22` 指导调用方"call `public_api_index()` when unsure"。
- **真实残留缺陷（P2-4'）**：索引仅限 `coc_roll` 单模块，**无跨模块聚合**（无 `__all__`、无 rules/combat/sanity 聚合、无 `/coc-help` 命令）。
- **修正后优先级**：P3-ish（低）。

### 勘误 3：crit/fumble 冲突校准方向（原 P2-2 末句）

- **原说法**："大成功/大失败才应触发特殊高冲突片段；困难/极难不应自动升高冲突。"
- **代码事实**：方向**部分说反**。
  - difficulty（regular/hard/extreme）**根本没有任何路径**抬升冲突：`coc_storylets.py:176-199` `infer_conflict_level` 只读 `storylet_policy`/`scene_action`/`pacing_mode`/`tension_level`/`horror_escalation_stage`，不读 difficulty（grep `difficulty coc_storylets.py` 为空）。所以"困难/极难自动升冲突"在代码里**不存在**，原说法这条不成立。
  - 真实缺陷是**反向**：`coc_narrative_enrichment.py:793,808` 中 fumble 与 crit **无条件硬编码** `conflict_level:"high"`，不看这次投骰是否低风险动作。
- **真实缺陷（P2-2）**：crit/fumble 触发的冲突级别应按"动作赌注"（结构化 risk_level）决定，而非一律 high。
- **修正后优先级**：保持 P2（P0-3 storylet 接通后再校准更安全）。

---

## 4. P0 深度展开（含修复方案）

> 全局前提（写进每条方案的隐含约束）：
> - **Dual-Track**：运行时改动先动 canonical，再 sync。触及 `INTENTIONAL_PLATFORM_DRIFT_FILES`（mode-protocol/state-schema/coc_completion_audit/coc_language/4 个 SKILL）只做 allowlisted 替换。
> - **Semantic Matcher Constitution**：不扫自由文本。P0-4 允许新增语义步骤，输出必须是结构化字段+recorded reason。
> - **测试**：每条加针对性单测；改 shared 行为必跑 `test_plugin_metadata.py`/`test_zcode_plugin_metadata.py`/`test_coc_plugin_sync_script.py` + `sync_coc_plugin_copy.py --check`。

### 4.1 P0-1 全程多线分叉暗示没接好

**现象**：鬼屋开场文本只强指向"钥匙/进屋"，不自然露出"问前租客/查公共记录/问报酬/查房史"；更广义地，**中段场景也缺乏多线暗示**，玩家被线性推向单一出口。`pending_choices` 仍被当菜单字符串数组使用。

**证据**：
- `the-haunting.json`：纯规则（科比特血肉护盾/飞刀/伤害骰），零场景文本。
- `haunting-fullrun/.../story-graph.json:3-17`：开场 `knott-briefing` 的 `exit_conditions` 写死"take the keys"；11 个 scene **无任何** `affordances`/`leads_to`/`routes` 字段；开场 clue `clue-knott-job-briefing` 无 `leads_to`。
- `coc_playtest_harness.py:3864,4012`：开场 narration 只提钥匙/预付款/"调查 vs 进屋"二选一。
- `manual-haunting.../active-scene.json`：`pending_choices` = 3 段字符串数组（菜单式），违反 `state-schema.md:72-77`。
- 形状不一致：`coc_playtest_harness.py:896` 写的是字符串（phase 名），live 写的是 list——两套数据形状。

**根因（两层）**：
1. 数据层：编译后 scene 节点无 `affordances`/`leads_to`/`routes` 把开场与兄弟研究节点连起来；线索 `leads_to` 是单值/缺失，不支撑"揭示一条线索→分叉多条调查线"。
2. 叙事层：narration 是 harness 硬编码，不读场景多路线信息；director/narrator 倾向把玩家往单一出口推。

**修复方案**：

- **A（推荐）——全程多线 + 真分叉标记**：
  1. **数据层**：每个 scene（不止开场）编译产出 `available_routes: [{route_id, cue, leads_to_scene|clue_id, route_type, status}]`，`status ∈ {open, suggested, exhausted, locked}`。线索 `leads_to` 改为**支持多目标数组**。揭示一条线索可分叉到多条调查线。
  2. **真分叉判定（结构化，非关键词）**：director 每轮计算 `open_route_count = |routes where status==open and not committed_by_player|`；`is_real_fork = open_route_count >= 2`，写入 `choice_frame.is_real_fork` + `open_route_ids` + recorded reason。
  3. **反线性引导**：`is_real_fork` 时 narration 必须把多条 open route 作为 diegetic cue 铺开（不编号、不菜单），交 P0-2 闸门决定停不停。
  4. **中段覆盖**：`scene_enter`/`clue_reveal`/NPC 给信息后都触发一次 route 重算（哪些 newly open / 哪些因线索 newly suggested）。
  5. **`pending_choices` 回归**：严格回归 Keeper-facing resume 用途，禁止存玩家可见选项数组。
  - 权衡：数据结构最干净、符合 schema 原意；要改 scenario-import 编译协议 + story-graph 数据 + director 的 route 计算/narration 生成。
- **B**：不改 story-graph 结构，让 director 在 `_live_scene_affordances` 里动态把兄弟研究节点注入开场 route。最小改数据，但 route 是隐式推导、不如 A 显式可控、难测。
- **C**：只在 harness 开场文本手写多路线。最小改，只修 fixture、live 仍裸露，不治本。

**推荐 A**。

**测试**：
- 编译后每个调查/社交 scene 带 ≥2 条 `available_routes`（开场 ≥4 条：问租客/查记录/查房史/进屋）。
- 线索 `leads_to` 支持多目标，揭示后 `open_route_count` 正确递增。
- `is_real_fork` 计算用结构化 status，不扫文本（Constitution 守护测试）。
- `pending_choices` 不再是玩家可见数组（回归测试）。

**耦合**：与 P0-2 共享 `is_real_fork` 字段（闸门判停用它）；与 P0-4 共享 `available_routes`（handle 刷新数据源）。**P0-1 须先于或同期于 P0-2、P0-4**。

---

### 4.2 P0-2 低主动推进失效

**现象**：玩家说"继续/跟着班长/照他说的做"，runner 一轮只挪一步。

**证据**：
- `coc_live_turn_runner.py:289`：`route_count>=2` → return `"meaningful_choice"`（结构数量当抉择）。
- `coc_live_turn_runner.py:291-292`：任何非空 `npc_moves` → return `"npc_requests_specialist_judgment"`。
- `coc_story_director.py:549-575`：三个成员不同的低主动集合（`_LOW_AGENCY_RECENT_CLASSES` 6 个 class 字符串 / `_LOW_AGENCY_CONTINUE_TAGS` 7 个 tag / `_ROUTINE_PROGRESS_TAGS`，其中 `continue_existing_strategy` 被划进 routine 而非 low-agency）。
- `coc_story_director.py:616-622`：`_low_agency_continue_count` 只看 class 字符串集合。
- `coc_director_apply.py:761-763`：`recent_intent_classes` 只持久化 `player_intent_class` 字符串，rich tag 全丢——跨轮计数无法从 tag 累加。
- `coc_npc_persona.py:469-477`：`delegate_specialist` 无条件触发；`build_agency_moves` 对实跑场景返回 `[]`（`:398-402`）。
- 已有 `npc_assist` 非阻塞豁免（`coc_live_turn_runner.py:56-58,134-145`）只过滤 `rules_requests`、不过滤 `npc_moves`。

**根因（三条）**：
1. tag 三套集合成员不一致 + 跨轮计数因只持久化 class 字符串而失效。
2. `route_count>=2` 用结构数量当"玩家正面临抉择"，与玩家姿态无关。
3. `npc_moves` 非空一律判停，但 npc_moves 在"有 NPC 就非空"，且 npc_assist 豁免不过滤 npc_moves。

**修复方案**：

- **A（推荐）——三处一起改 + 接 P0-1 的 is_real_fork**：
  1. **统一低主动 tag**：合并为单一来源 `_LOW_AGENCY_TAGS`；`_low_agency_continue_count` 同时读 class 字符串**和**持久化的 secondary_intents tags。改 `recent_intent_classes` 落盘为带 tags 的结构（`apply.py` 与 `playtest_driver` 同步）。
  2. **route 判停改用 is_real_fork**：`coc_live_turn_runner.py:289` 判停条件从 `route_count>=2` 改为 **`choice_frame.is_real_fork == True`**。即只有 director 判定存在 ≥2 条 open 且玩家未表态路线（真分叉）时才停交选择；否则即便场景有 affordances、只要玩家低主动就继续推进。
  3. **npc_moves 判停收窄**：复用 `npc_assist` kind 白名单逻辑，npc_moves 里 `kind` 为 `npc_assist`/`react`（非决策性）不触发判停；只有 move 带 `requires_player_decision` 结构化标记时才判停。
  - 权衡：触及 apply 落盘结构 + director tag + runner 闸门三处，但三处本就该统一；每处改动都小。
- **B**：只动 runner 闸门②③，不动 tag 落盘①。快速缓解"一轮一步"，但跨轮计数仍失效，长串低主动第 2-3 轮仍断。
- **C**：director 兜底强制 emit compressed_progress。治标，route_count/npc_moves 误伤仍在。

**推荐 A**。

**测试**：
- 构造"玩家连续 3 轮低主动"用例，断言单次 `run_live_turn` 内 `len(turns)>=2`。
- 带 2 条 affordance 但 `is_real_fork==False` 时不停；`is_real_fork==True` 时停。
- npc_moves 仅含 `npc_assist`/`react` 时不停；含 `requires_player_decision` 时停。
- 跨轮 low_agency tag 累计正确（持久化结构含 tags）。

**耦合**：①的 tag 统一是 P1-4(NPC authority) 复用基础；②③的判停收窄直接喂 P1-2(无行动点反压)。②依赖 P0-1 的 `is_real_fork` 字段存在——**P0-1 数据/标记先行，P0-2 闸门接其后**。

---

### 4.3 P0-3 storylet engine 没落地到 live play

**现象**：storylet-scheduler.jsonl 里 haunting 2/2、white-war 19/20 全 `triggered:false`；live runner 不渲染 storylet_moves；日志只写不读。

**证据**：
- `storylet-library.json`：6622 行，65 条 storylet **全通用、零开场/场景条目**（grep haunting/corbitt/knott/开场 = 0）。自述"generic only"。
- `coc_narrative_enrichment.py:757-875`：触发闸门只认 fumble/critical/压力 tick/卡顿≥3/NPC reaction/scene cut；普通 CHARACTER 回合一律 `_NO_TRIGGER`。
- 存档日志统计：haunting `2/2` 全 false；white-war `20` 行里 `19` false，唯一 true 是一次 fumble（投出 97），非开场。
- `coc_live_turn_runner.py`：返回结构化 `storylet_moves`，从不转 prose；grep `prose/render` 无渲染调用。
- `_storylet_prose` 只存在于 playtest driver（`coc_playtest_driver.py:399-410,452-454`）。
- `storylet-scheduler.jsonl` 全 repo grep：**只写不读**，纯旁路日志。

**根因（三条）**：
1. 触发闸门对"普通回合一律 false"，且库无开场/场景型 storylet、无"开场/场景进入"触发谓词。
2. live runner 只暴露结构化 `storylet_moves`，从不转 prose；`must_include` 只在真选中时才有 cue。
3. scheduler.jsonl 无运行时读者。

**修复方案**：

- **A（推荐）——接通渲染 + 扩触发面**：
  1. **接通渲染**：把 playtest driver 的 `_storylet_prose` 提到 narrative_enrichment 成公共 `build_storylet_narration_contract(moves)`；live runner 在 stop 前调用，把选中 storylet 的 `cue`/`title` 注入 `narrative_directives.must_include`（playtest 已验证的路径，仅搬位置）。
  2. **扩触发面（结构化，不扫文本）**：新增触发谓词——`scene_action=="CHARACTER"` 且当前 scene 带特定 `storylet_tags`（场景编译时写入，如 `opening_briefing`）时可触发匹配该 tag 的 storylet；以及"场景首次进入"（`source_event_type=="scene_enter"`）触发场景型 beat。所有触发带 recorded reason 进 scheduler trace。
  3. **库内补少量开场/场景型 storylet**（带 `scenario_tag`/`scene_tag` 锚，非通用）。
  - 权衡：①几乎零风险（搬已验证代码）；②要扩触发谓词 + 加场景型 storylet 数据 + scenario-import 写 storylet_tags，工作量中等，是 storylet 真正落地的必要条件。
- **B**：只做①接通渲染、不动触发面。storylet 仍只在 fumble/critical 时触发，开场仍无 storylet——只解决"渲染断线"。
- **C**：只扩触发面、不接 live 渲染。scheduler 多记几条 true，但 live 正文仍无内容——自欺。

**推荐 A**。

**测试**：
- 构造开场场景（带 `storylet_tags`）的 live turn，断言 `storylet-scheduler.jsonl` 该行 `triggered:true` 且 reason 为场景型。
- 断言 `narrative_directives.must_include` 含该 storylet cue。
- haunting 开场 live run 断言 storylet 至少触发一次。
- 触发判定读结构化 `storylet_tags`/`scene_action`，不扫文本（Constitution 守护测试）。

**耦合**：①接通渲染依赖 P0-2 闸门不误杀（enriched plan 里 storylet 还来不及进 must_include 就被判停）。**P0-2 先于 P0-3**（全局顺序 P0-1→P0-2→P0-3→P0-4，见 §4.5）。

---

### 4.4 P0-4 stop-actionability 复用旧抓手

**现象**：鬼屋第二轮玩家问租客细节，返回的 immediate handles 仍是开场三条老选项。

**证据**：
- `coc_narrative_enrichment.py:287-359`：handle 只来自 `visible_affordances`/`choice_frame.routes`/失败 roll，全是静态。
- `coc_live_turn_runner.py:498-507`：停止后才建 handle、无反压。
- grep `coc_narrative_enrichment.py` 的 `player_text/player_intent/utterance`：玩家本轮输入只喂给 `build_proposal_transform`/`build_action_chain_requests`/`build_npc_reaction_moves`，**不进** `build_choice_frame` 或 stop-actionability。
- `apply_plan` 写 world/pacing/state 但**从不写** `active-scene.json`；只有 caller 传 `state_patch` 才改（`coc_live_turn_runner.py:155-185`）。
- SKILL.md:74-79 与 builder docstring 明确"never from raw prose keywords"——这是对的，但代价是没有机制把"本轮问题"转成新抓手。

**根因**：handle 完全不感知玩家本轮说了什么（这是合规的），但又没有任何机制把"本轮焦点"转成结构化抓手源；`active-scene.json` 实质是只读缓存、无人按轮刷新。

**修复方案**：

- **A（推荐，新增语义步骤）**：
  1. **结构化焦点提取**：narrative_enrichment 新增 `build_turn_focus_contract(ctx)`——调用已有 intent_router（LLM/语义路由器，Constitution 允许）对玩家本轮输入产出**结构化**焦点：`{focus_axis: enum, focus_target_id: str|null, focus_reason: <recorded>}`。`focus_axis` 由路由器按本轮 input + 当前 scene 的 `available_routes` 对照后输出枚举（如 `tenant_history`/`reward_scope`/`npc_question`/`environment`），**不是关键词命中**。
  2. **handle 增源④**：`build_stop_actionability_contract` 当 `focus_axis` 命中某 `available_routes` 条目的 `route_type`/`cue_topic` 时，把该 route 升为当前 handle 并标记 `freshness:"turn_focus"`；若 focus 无匹配 route，则 emit 一个"NPC 问话/环境抓手"占位（走 P1-2 反压，不停在空抓手）。
  3. **存档按轮刷新**：director 在 `apply_plan` 后按 turn_focus 写 `active-scene.json.visible_affordances`，使存档与当前轮一致。
  - 权衡：要新增语义步骤（用户已授权），输出全程结构化、带 reason、不扫文本；与 P0-1 的 `available_routes` 天然耦合；工作量中。
- **B（纯引擎、无语义步骤）**：不引入焦点提取，改为每轮 handle 强制从当前 scene 的 `available_routes` 轮转/去重（按 `last_presented_handle_ids` 轮换，避免重复吐老三条），并在玩家"问问题"类 input 后由 director emit `npc_followup_affordance`。不扫文本，但 handle 不真正贴合当前问题，只不重复。
- **C**：只在 SKILL 加指令让 LLM narrator 自己重算 handle。最弱，等于没修。

**推荐 A**。

**测试**：
- 第二轮玩家问租客 → 断言 `immediate_handles[0].freshness=="turn_focus"` 且 route_type 对应租客线；不再出现开场老三条。
- 断言 `active-scene.json` 被本轮刷新。
- **Constitution 守护测试**：焦点提取输出必须是结构化枚举+reason，禁止从原始 prose 取子串（即不允许把玩家原话片段作为 focus_axis）。
- 无匹配 route 时走 P1-2 反压（不停在空抓手）。

**耦合**：A 依赖 P0-1 的 `available_routes`（handle 新源）和 P0-2 的闸门收窄（空抓手时靠 P1-2 反压不停）。**P0-1、P0-2 先行，P0-4 收尾**。

**范围边界（诚实声明）**：P0-4 的**机制已实现并通过测试**（`build_turn_focus_contract` + handle 增源 + 多步路径用原始意图算 focus），但其**生产 payoff 依赖 deferred 的 scenario 数据**——当前生产 affordances 的 `route_type` 是 `scene_affordance`/`investigative_lead` 等通用值，而 focus 匹配要 `tenant_history`/`reward_scope` 等语义类别。所以在 scenario-import 编译器给场景 affordances 填充语义 `route_type` 之前，P0-4 在生产里基本处于休眠（graceful 返回 None、回退静态 handle，不报错）。这与 P0-1（场景 `affordances` 数据填充）和 P0-3（库内开场 storylet 数据）同属"机制进、数据延后"的一类，统一由紧接其后的 scenario-import 编译器独立 plan 收口。无匹配 route 时走 P1-2 反压（不停在空抓手）。

---

### 4.5 P0 依赖与排序

```
P0-1 全程多线数据 + is_real_fork 标记 ──┐
                                       ├─→ P0-2 闸门收窄(is_real_fork / requires_player_decision)
P0-2 tag 统一 + 落盘带 tags ───────────┘        │
                                                 ├─→ P0-3 storylet 接通渲染 + 扩触发
                                                 └─→ P0-4 焦点提取 + handle 刷新
P0-1 available_routes ─────────────────────────→ P0-4 (handle 新源)
```

**建议实现顺序**：① P0-1（数据+标记）→ ② P0-2（闸门+tag统一）→ ③ P0-3（接通+扩触发）→ ④ P0-4（焦点闭环）。

---

## 5. P1 浓缩展开

格式：**编号 · 条目｜现象｜证据｜根因｜修复方向｜耦合**。修复方向为一句话，详细方案留待后续 plan。

### 5.1 节奏层

**P1-1 · 过渡/行军场景拖长**
- 现象：雪地返程反复"继续走/风更大/再检定"，无上限。
- 证据：`coc_story_director.py:57,642-647`（bridge 检测只认 `scene_type∈{bridge,transition,travel,transit}`）；white-war 场景是 `scene_type:"exploration"`；`montage` 意图只是时钟 +120min（`:1130`）；`compression_budget`（`:701-712`）写进 directive 但无代码读它当硬上限。
- 根因：进度契约机制存在但对真实场景类型 dead-letter；无强制 beat 上限。
- 方向：①扩 `_BRIDGE_SCENE_KINDS` 或改为按 `pacing_role`/`tension_target` 识别过渡场景；②让 runner/director 读 `compression_budget.max_beats`，超限强制 emit `must_change_state` 的 scene_exit_pressure。
- 耦合：吃 P0-2 闸门松绑——否则即使 emit exit pressure 也被误停拦住。

**P1-2 · 无行动点也停**
- 现象：停在"我不知道做什么"，handle 全空仍停。
- 证据：`coc_live_turn_runner.py:470-476`（停止先于 actionability）；`coc_narrative_enrichment.py:343-359`（handle 空时只置 `requires_keeper_rewrite:True`，无反压）。
- 根因：停止决策不依赖 handle 非空；无反压回路。
- 方向：runner 在 `immediate_handles` 为空且 `is_real_fork==False` 时**不停**——继续推进或强制 director emit 一个威胁/NPC 问话/环境抓手（结构化），直到 handle 非空或触真分叉。
- 耦合：与 P0-4 的 handle 刷新是同一回路两端；依赖 P0-2 的 `is_real_fork`。

**P1-3 · Roll density 不合并**
- 现象：同质动作走一步投一次/问一次。
- 证据：合并只在单回合 `action_atoms` 内（`coc_narrative_enrichment.py:433-501,556`）；导演发的 SAN/danger/clue 检定各有独立 group、绕过合并（`coc_story_director.py:1604,1658,1706`）；跨回合无历史（`coc_playtest_driver.py:216-219`）。
- 根因：无跨回合同动作合并；导演检定豁免。
- 方向：引入跨回合 roll-density 记忆（按 `(skill,kind,axis)` 记最近 N 回合），同质重复达阈值时合并为 montage 单检定；导演检定纳入同一密度守卫。
- 耦合：与 P1-1 共用"montage/压缩"概念，可共享 novelty/roll budget。

### 5.2 NPC 层（根因高度集中：NPC 数据缺 social_role + 模板零引用）

**P1-4 · NPC authority 不稳**
- 现象：班长把战术决策丢给军医。
- 证据：`coc_npc_persona.py:469-477`（`delegate_specialist` 意图∩delegates 无条件触发）；`npc-social-roles.json:12`（指挥官模板 `delegates:specialist_care`）；`the-white-war/npc-agendas.json`（NPC 无 `social_role`/`initiative_style`）；`build_agency_moves` 对实跑场景返回 `[]`（`:398-402`）；`npc-social-roles.json` 被 scripts 零引用。
- 根因：NPC 权威数据从未从场景注入；模板是死数据。
- 方向：①scenario-import 编译时按 NPC agenda 的角色关键词（结构化映射表，非扫 prose）给 NPC 赋 `social_role`；②权威 NPC（initiative_style∈commanding/decisive）的 `delegate_specialist` 只在"专业边界问题"触发、战术决策自己拍。
- 耦合：P1-4/5/6 同根因，一起修；与 P0-2 的 npc_moves 判停收窄共享 `requires_player_decision` 标记。

**P1-5 · NPC assist scope 错位**
- 现象：Bruno 的 assist scope 记 prisoner_handling，实际是 breach。
- 证据：`coc_npc_persona.py:381,404`（`scope = authority_scope ∩ scene.authority_demands`，静态 NPC/场景常量，不读当前 action）。
- 根因：scope 不感知当前 action。
- 方向：scope 计算加入当前 `action_atoms`/`primary_intent` 的结构化匹配（intent→scope 映射表），取与当前动作最相关的 authority 项。
- 耦合：与 P1-4 同数据层；修了 social_role 注入后 scope 才有真实 authority_scope 可算。

**P1-6 · 人设系统不影响行为**
- 现象：角色卡生成了，现场仍工具人化。
- 证据：`build_agency_moves` 只读 4 个 tag（`coc_npc_persona.py:388,430,453,462`）；voice/flaw/drive 不读（flaw/drive 字段不存在）；`build_npc_reaction_moves` 从原始 agenda 读 voice、不读人设卡（`coc_narrative_enrichment.py:641-651`）。
- 根因：人设卡是乘客数据，不进决策。
- 方向：把 persona 的 `voice`/`drive`/`stress_response` 接入 move 生成（voice 影响措辞、drive 影响主动议程、stress_response 影响危机行为）；reaction_moves 改读人设卡而非原始 agenda。
- 耦合：依赖 P1-4 的人设注入链路（人设要先真生成并落卡）。

### 5.3 文字层

**P1-7 · 翻译腔/AI 腔 guard 不全 + 不通电**
- 现象：中文仍有"基于/当前目标/二人推断"等系统腔；guard 只抓部分。
- 证据：`coc_narration_style.py:36-63`（6 AI summary 短语 + 13 替换，漏大量同类）；`:351-380`（guard 是 advisory，SKILL 让 LLM "mentally apply"）；live runner 不调用它。
- 根因：词表不全 + 不强制执行。
- 方向：①扩充词表并按类别组织（被动腔/总结腔/解释腔）；②guard 改为 runtime 强制钩子（narration contract 层校验 `passed`，未过则要求重写而非仅标记）。**注意**：这是 prose 表层 lint，Constitution 允许关键词；但须写明边界"仅限 prose 表层 lint，禁止用于语义判定"。
- 耦合：独立，可与 P0 并行。

**P1-8 · 语言能力呈现没通电**
- 现象：低语言技能角色仍默认完整理解外语。
- 证据：`coc_language.py:140-202`（分层 fluent/partial/gist/none 写好了）；但 live runner 无任何引用，仅 SKILL advisory。
- 根因：接好了线没通电。
- 方向：narrative_enrichment 在生成含外语对话的 narration contract 时，调用 `render_foreign_dialogue_for_investigator`，按调查员语言技能产出对应可见文本；低于 fluent 时展示源语/片段。
- 耦合：与 P1-7 共享 narration contract 钩子；独立于 P0。

---

## 6. P2 浓缩展开

### 6.1 规则/UX

**P2-1 · 奖励骰展示不透明**
- 现象：玩家只看到最终值，看不到十位/个位/奖惩骰分量。
- 证据：`coc_roll.py:169-198`（无 bonus/penalty 时只输出 `{roll}/{target}，{outcome}`）；`coc_playtest_report.py:115-124`（无 die_rolls 则只显 total）。
- 根因：formatter 默认折叠分量。
- 方向：formatter 默认展示十位/个位/奖惩骰构成（即便无 modifier 也显 `{tens+units}`），仅极简模式可折叠。
- 耦合：独立。

**P2-2 · crit/fumble 无条件 high（方向修正后）**
- 现象：任何 crit/fumble 一律触发高冲突 storylet，不管是不是低风险动作。
- 证据：`coc_narrative_enrichment.py:793,808`（fumble/crit 硬编码 `conflict_level:"high"`）；`coc_storylets.py:176-199`（`infer_conflict_level` 不读 difficulty）。
- 根因：crit/fumble 触发不看动作风险/赌注。
- 方向：crit/fumble 的 conflict_level 改由"动作赌注"（结构化 risk_level，已有字段）决定——低风险动作的 crit/fumble 触发 low/medium beat，高风险才 high；difficulty 单独不升冲突（保持现状）。
- 耦合：与 P0-3 共享 storylet 触发/冲突层；P0-3 接通后再校准更安全。

**P2-3' · 角色创建：缺已有角色列表（勘误后真缺陷）**
- 现象：无法列出已创建调查员。
- 证据：无 `list_investigators`/registry 函数（`coc_character.py`/`coc_state.py` grep 空）；存储是目录约定（`skills/coc-character/SKILL.md:8-12`）。
- 根因：无枚举/registry。
- 方向：加 `list_investigators()` 扫 `.coc/investigators/*/character.json` 汇总，并在 coc-character SKILL 暴露 `/coc characters` 类入口。
- 耦合：独立。优先级 P3-ish。

**P2-4' · helper API：索引仅单模块（勘误后真缺陷）**
- 现象：`public_api_index()` 存在但只在 coc_roll，跨模块无聚合。
- 证据：`coc_roll.py:201-229`（已有）；无 `__all__`、无跨模块聚合、无 help 命令。
- 根因：索引未跨模块。
- 方向：加跨模块 `coc_api_index()` 聚合 roll/rules/combat/sanity，加 `__all__`，可选 `/coc-help`。
- 耦合：独立。优先级 P3-ish。

**P2-5 · PDF 图片/handout 没接**
- 现象：模组图片/地图/剪报不在对应场景露出。
- 证据：`coc_scenario.py:81-93`（写 `handout-assets.json` 但从无代码读）；scene/clue 数据无 image 字段；`clue_reveal` 事件无 asset 引用（`coc_director_apply.py:726-728`）。
- 根因：注册表只写不读 + 数据无字段。
- 方向：scenario-import 编译时把 handout asset 挂到 clue/scene 的结构化字段（如 `clue.handout_asset_id`）；clue_reveal 事件带上 asset ref；narration contract 在 `player_visible` 时渲染绝对路径 Markdown 图片（Codex）或标题+摘要（ZCode，符合 sync drift 规则）。
- 耦合：独立于 P0；与 P1-7/8 共享 narration contract 钩子。

### 6.2 记录/性能

**P2-6 · 后台记录非 subagent + flush 可疑**
- 现象：live turn 仍 2-3 分钟；pending batch 不及时清、需手动 flush。
- 证据：主流程 director→enrichment→rules→apply 全程同步阻塞（`coc_live_turn_runner.py:348-377`）；flush 是 `subprocess.Popen` fire-and-forget 无 ack/timer（`coc_async_recorder.py:188-200`）；`completion_required_before_narration=False` 硬编码、apply_plan 被强设 `manual`（`:376`）；commit `924612e` 把"不等待"写进测试。
- 根因：主流程阻塞未并行化；flush 无可靠性保证。
- 方向：①把可并行的 director 子任务（NPC/storylet/enrichment 的只读计算）考虑线程化或预计算；②flush 改为带 ack+超时的可靠通道，pending 达阈值/超时强制 flush，保留"narration 不阻塞"但保证最终一致；③新增 pending-stuck 健康检查。
- 耦合：①触及主流程、风险高，建议 P0 之后做；与 P0-3 的 storylet 计算位置相关。

**P2-7 · 日志扩展不全**
- 现象：NPC/clue 的 match-miss 不记、audit.jsonl 仅 playtest。
- 证据：storylet why-not 有记（`coc_storylets.py:642-675`）；NPC 生成只记选中（`coc_npc_persona.py:201-214`）；clue 无 match trace；`audit.jsonl` 只 `coc_playtest_harness.py:4075` 写。
- 根因：NPC/clue 缺调度 trace；live 不写 audit。
- 方向：给 NPC 生成和 clue 选择各加 candidate_counts + rejected_examples trace（仿 storylet）；live runner 补写 `audit.jsonl` 的 spoiler_reveal 事件。
- 耦合：与 P1-4（NPC 注入）、P0-3（storylet trace 已有）相关；纯日志、低风险。

---

## 7. 依赖与排序（执行波次）

按层和依赖排成执行波次（非 rigid 顺序，是"能并行做的归一波次"）：

```
波次0（基础设施，先行）
  P0-1 全程多线数据 + is_real_fork 标记 ─┐
  P0-2 tag 统一 + 落盘带 tags ──────────┤  （P0-1/2 互依：标记与闸门联动）

波次1（闸门收窄，接波次0）
  P0-2 闸门收窄(route_count→is_real_fork, npc_moves→requires_player_decision)
  P1-2 无行动点反压（依赖 is_real_fork）

波次2（接通与刷新）
  P0-3 storylet 接通渲染 + 扩触发（依赖 P0-2 松闸）
  P0-4 焦点提取 + handle 刷新（依赖 P0-1 available_routes + P0-2 is_real_fork）

波次3（NPC 根因集中修，P1-4/5/6 一体）
  P1-4 social_role 注入 + authority 自决
  P1-5 scope 读当前 action
  P1-6 persona 接入决策

波次4（节奏与文字，可并行）
  P1-1 进度契约/beat 上限
  P1-3 跨回合 roll density
  P1-7 guard 扩表+通电
  P1-8 语言分层通电
  P2-2 crit/fumble 校准（P0-3 后）

波次5（UX/记录，低优先）
  P2-1 奖励骰展示
  P2-3' 角色列表 registry
  P2-4' 跨模块 API 索引
  P2-5 handout 接通
  P2-6 记录并行化 + 可靠 flush
  P2-7 NPC/clue trace + live audit
```

---

## 8. 附录

### 8.1 Dual-Track 与测试门禁

- 改 shared 运时行为：先动 `plugins/coc-keeper/`，再 `python3 scripts/sync_coc_plugin_copy.py` + `--check`。
- 平台差异只允许落在 sync 脚本 allowlist：`.codex-plugin`/`.zcode-plugin`+`package.json`/`agents/openai.yaml`/`CODEX_ONLY_IMAGEGEN`/三条文案替换。
- 改 shared 行为后至少跑：
  ```
  PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_plugin_metadata.py tests/test_zcode_plugin_metadata.py tests/test_coc_plugin_sync_script.py -q -p no:cacheprovider
  python3 scripts/sync_coc_plugin_copy.py --check
  ```

### 8.2 Semantic Matcher Constitution 适用边界（针对本蓝图）

- P0-1 的 `is_real_fork`：用结构化 `route.status` 计算，不扫文本。✅
- P0-2 的低主动判定：用 intent_router 输出 + 持久化 tag 结构，不扫文本。✅
- P0-3 的扩触发：用 `storylet_tags`/`scene_action`/`source_event_type` 结构化字段，不扫文本。✅
- P0-4 的焦点提取：**允许**调用 intent_router 语义步骤，但输出必须是结构化枚举+reason，**禁止**从原始 prose 取子串作为判定依据。✅（用户已授权）
- P1-7 的 prose guard：**允许**关键词列表做表层 lint（明确禁止用于语义判定），并在代码注释/docstring 写明边界。✅
- 其余条目：均消费结构化字段或已有 intent_router 输出。✅

### 8.3 战报证据使用约定

- 本蓝图核查阶段引用的 `.coc/` 产物（haunting-fullrun story-graph、manual-haunting active-scene、white-war scheduler.jsonl）均为**即时核查用**，`.coc/` 全量 gitignore，不作 durable 证据库。
- 后续任何"战报"类证据须满足 `AGENTS.md` 的 Playtest Battle Report Evidence Standard（真实 playtest 产物 + 通读 + 含调查员/回合/检定/线索/推进/enrichment 效果）。
- formatter smoke test 只能叫"formatter 验证样本"，不得冒充战报。

### 8.4 相关文档

- `docs/superpowers/specs/2026-07-06-all-dimensions-problems.md` — 前 D1–D6 缺陷目录（本蓝图的前身，可对照）。
- `docs/superpowers/specs/2026-07-08-director-orchestration-hardening-design.md` — 最近一份 director 加固设计（与 P0-2/P0-3 相关，实现时对照避免冲突）。
- `plugins/coc-keeper/references/state-schema.md` — `pending_choices` 等状态 schema（P0-1 回归测试基准）。
- `plugins/coc-keeper/skills/coc-scenario-import/references/story-graph-schema.md` — story-graph 编译 schema（P0-1/P0-3 加字段基准）。

---

## 修订记录

- 2026-07-08 初版：P0(4) + P1(8) + P2(4真/3勘误) 全部经代码逐行核实；P0 含修复方案 A/B/C 与依赖排序；P0-1 按用户要求扩展为"全程多线分叉"并引入 `is_real_fork` 与 P0-2 联动。
