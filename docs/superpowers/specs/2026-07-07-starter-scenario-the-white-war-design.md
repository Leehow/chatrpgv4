# 设计：内置开箱即玩模组《白色战争》(The White War)

**日期**: 2026-07-07
**状态**: Draft（待用户审阅）
**分支**: `feat/starter-scenario-the-white-war`（将从当前 `main` 拉出）

## 背景与动机

当前 COC 插件**没有任何开箱即玩剧本**。`references/rules-json/` 只有 CoC 7e 规则数据，剧本导入是 LLM 读 PDF 的人工流程，要求玩家「合法持有剧本」。这把所有新人挡在门外——他们没有剧本 PDF，也不知道要导入，更不会主动寻找。

本设计让 COC 模式在创建新战役后**主动引导**玩家：「自带剧本 / 选择内置剧本」，并内置第一个开箱即玩模组《白色战争》，使新人零准备即可开玩。

## 法律基础（关键前提）

源材料 `pdf/dtrpg-2026-07-07_01-33am/cr3007_-_The_White_War_(Cthulhu_Eternal_Italy_World_War_1).pdf` 以 **Open Gaming License v1.0a** 授权（PDF 第 2 页声明 "This scenario is published under an Open Gaming License"，第 12 页附 OGL 全文）。作者 Paul StJohn Mackintosh，Cthulhu Reborn Publishing 2023 年 12 月发行。

OGL §15 之后的声明将该作品划分为两类：

- **OPEN GAME CONTENT（可自由分发）**: "all numeric game data, Creature descriptions included on pages 8–10"。即 Polyp Horror 属性/招式/SAN、寒冷暴露规则、武器数据、pre-gen 数值。
- **PRODUCT IDENTITY（不可分发）**: "all trademarks, trade dress, maps, and all other original and licensed artwork, dialogue, plots, storylines, locations, and characters"。即剧本的剧情、场景、地点、NPC、对话、地图。

**因此本设计采取双轨**：
1. **OGC 数值包**（`rules-json/the-white-war.json`）：忠实原数值，合法打包分发，附完整 OGL 归属。
2. **改编剧本**（7 个 story-graph JSON）：基于 OGC 抽象前提「冰封竖井释放的远古实体」，**原创**等价探险（新地点、新 NPC 名、新对话、新场景描写），保留机制骨架但不用任何 PI 文本。成品完全原创、可任意分发。

## 范围与非目标

**范围内**:
- 一个内置 starter scenario《白色战争》改编（7 个 story-graph JSON + OGC 规则包 + 5 个 pre-gen）。
- 一个 Python loader（`coc_starter.py`）：列出/安装内置剧本。
- coc-main 工作流的**主动引导节点**（Hard Rule）：新档无剧本时强制弹出。
- coc_rules.py 的泛化 module-rules 加载。
- OGL 合规标注（README + license 文件 + module-meta 字段）。
- 两个插件轨（coc-keeper / coc-keeper-zcode）的同步。
- 测试与校验。

**非目标（YAGNI）**:
- 不构建完整的 Cthulhu Eternal 规则引擎（CE→7e 转换约定即可）。
- 不一次性内置多个模组（先把第一个跑通，机制稳定后再加）。
- 不动 `.coc/module-library/`（它另有语义定位，见下）。
- 不做 GUI/web 选剧本界面（agent 文字引导足矣）。

## 设计

### 1. 新人引导节点（核心 UX）

**位置**: `plugins/coc-keeper/skills/coc-main/SKILL.md` 工作流第 4 步（创建/选择 campaign）之后、第 5 步（绑定 scenario）之前。

**触发条件**: 仅当 campaign 为「新建且 `active_scenario_id` 为空」时。继续旧战役、已绑定剧本的 campaign 不触发——不打扰老玩家。

**行为**: agent 主动呈现二选一引导（中英双语，面向新手）：

> **你有现成的剧本吗？**
>
> 🅰️ 我有剧本 PDF / 剧本资料 → 走 `coc-scenario-import` 导入你的剧本
> 🅱️ 我是新手，想直接开玩 → 内置剧本 **《白色战争》(The White War)**：一战阿尔卑斯前线，一支山地巡逻队调查冰川传来的怪响……一键安装、立即开始。
>
> （还可用：*列出所有内置剧本* / `coc-starter list`）

**Hard Rule**（写入 coc-main/SKILL.md 的 Hard Rules 段）:

> 创建新 campaign 后、绑定 scenario 前，**必须**主动向用户呈现「自带剧本 / 选择内置剧本」的引导，不得跳过或等用户询问。措辞须面向新手，显式列出所有可用内置剧本的名称与一句话简介。

### 2. 文件结构

```
plugins/coc-keeper/
  references/
    starter-scenarios/
      the-white-war/
        module-meta.json
        story-graph.json
        clue-graph.json
        npc-agendas.json
        threat-fronts.json
        pacing-map.json
        improvisation-boundaries.json
        pregen-investigators.json   # 5 个改编 pre-gen（7e 角色卡）
        OGL-LICENSE.txt             # OGL v1.0a 全文（§10 强制随附）
        README.md                   # OGL §15 归属 + OGC/PI 划分
    rules-json/
      the-white-war.json            # OGC 数值：Polyp Horror + 寒冷规则 + 武器
  scripts/
    coc_starter.py                  # loader: list / install
plugins/coc-keeper-zcode/           # 由 sync 脚本同步，结构镜像
```

**为何不用 `.coc/module-library/`**: 该目录在 `docs/superpowers/specs/2026-07-03-coc-keeper-design.md:1320` 的 Open Question 中被定位为「存放用户导入的外部 PDF」，语义与「插件打包的内置成品剧本」冲突。内置剧本属于插件资产，应放 `references/starter-scenarios/`，随插件分发、git 跟踪。

### 3. Loader 安装语义

`scripts/coc_starter.py`，纯函数 + CLI：

```python
STARTER_DIR = PLUGIN_ROOT / "references" / "starter-scenarios"

def list_starter_scenarios() -> list[dict]:
    """枚举所有内置剧本，返回 scenario_id/title/one_liner/structure_type/era/content_flags。
    供 coc-main 引导时枚举。数据从每个 <id>/module-meta.json 读取。
    注：one_liner 是 module-meta 的新增扩展字段（校验器不拦），见 §7。"""

def install_starter(root: Path, campaign_id: str, scenario_id: str) -> Path:
    """把指定 starter 的 7 个 story-graph JSON 拷贝到 campaigns/<id>/scenario/，
    拷贝 pregen-investigators.json 到 campaigns/<id>/scenario/pregen-investigators.json
    （与 scenario 同目录，director 不读它，coc-character 引用时按需读取），
    写 campaign.json 的 active_scenario_id/era/localized_terms，返回 campaign scenario 目录。
    幂等：目标已有 scenario 时报错而非覆盖。"""
```

CLI: `python3 coc_starter.py list` / `python3 coc_starter.py install --campaign <id> --scenario <id>`。

**拷贝而非软链接**: campaign 目录是每个剧本的独立副本，director 写 save 状态时不污染内置原件。director 只读 `campaigns/<id>/scenario/`（`coc_story_director.py:95`），不读 starter-scenarios。

### 4. OGC 规则包（忠实原数值）

`references/rules-json/the-white-war.json`，合法可分发的 OGC 数值，结构仿 `the-haunting.json`（`scenario_id` / `module_title` / `source_note` / `rules`(含 `source_rule_id`) / `weapons`）。

规则条目（命名空间 `module.white_war.*`，全小写满足 `coc_validate.py:39` 正则）:

- `module.white_war.polyp_horror` — stat block: STR 100/CON 100/DEX 15/INT 25/POW 30，HP 100，半物质（UNNATURAL MATTER）、风爆（WIND BLAST）、触手斩击 Lethality 50%+KNOCK DOWN、穿透护甲、飞行、SAN 1D6/1D12、≤20 HP 撤退。
- `module.white_war.cold_exposure` — 户外 −30°C、每 5 分钟 CON 检定避免 1D8 HP 寒伤、户外每 5 分钟耗 1 资源点、极端体力 CON×5 检定防力竭、冻伤 fumble 1 HP、取暖每分钟恢复 1 CON。
- `module.white_war.lethality_vs_semi_material` — 致命度对半物质实体处理：Lethality <15% 无效；Lethality ≥15% 且掷骰偶数才造成等于 Lethality 的 HP 伤害，奇数穿透无效。
- `module.white_war.daylight_penalty` — 实体畏光：白昼 −20% 全技能、保持雪涡形态、重新激活风需 1 回合准备。

武器（CE→7e 近似转换，见 §7 转换表）:
- Mannlicher-Carcano 6.5mm 步枪（伤害 1D12+2，射程 150yd，6 发弹夹，「严重磨损」状态）
- Beretta Brevetta 9mm 手枪（伤害 1D10，射程 15yd，8 发弹夹）
- Bessozzi 菠萝手雷（致命度→7e: 伤害 3D6 + AoE）
- 战壕刀（1D6+DB）、工兵铲（1D8+1+DB）

**登记与加载**:
- 追加进 `references/rules-json/rule-index.json` 的 `rules` 数组，每条 `id: "module.white_war.*"`、`category: "module_rule"`、`module: "The White War"`、`source_table: "the-white-war.json"`、`numeric: {...}`。
- `the-white-war.json` 加入 `scripts/coc_validate.py:11-37` 的 `REQUIRED_RULE_FILES`。
- `scripts/coc_rules.py` 把 `the_haunting_rules()`（`coc_rules.py:245-250`）**泛化**为 `module_rules(scenario_id: str)`，按 scenario_id 读 `rules-json/<id>.json`；`the_haunting_rules` 保留为薄包装以维持向后兼容。

### 5. 改编剧本结构（近原作、原创 PI）

`structure_type: linear_acts`，`era: "ww1"`（需在 `coc_state.py:307` 时钟初始化登记 1916 时代）。

~10 个 scene（场景描述原创，机制骨架沿用）:

1. `mission-briefing` — 7th Alpini 连部下达侦察令：冰川前线数夜前有爆炸枪声，巡逻队天亮越过无人区侦察奥军阵地。**scene_type: social**（ordinary）。
2. `crossing-no-mans-land` — 暴风雪中穿越 200 码鞍部，5 分钟行程，消耗资源点；任何枪声都是恐怖诱发。**exploration**（wrongness）。
3. `entering-austrian-positions` — 从射击孔钻入被弃的 Schwarzlose 机枪位，侦查发现仓促撤离痕迹、被扳转向内的枪口。**investigation**（wrongness）。
4. `glacier-tunnels` — 蓝光冰隧道推进，沿途散落水壶、翻倒补给箱、急退迹象。**exploration**（pattern）。
5. `blast-chamber` — 爆破扩挖的 chambers，遍地奥军残骸（SAN 0/1 [violence] + 0/1 [unnatural]），冰封下露出黑玄武岩竖井、内壁无回声。侦查察觉低沉哨声。**investigation**（pattern）。
6. `the-whistle-approaches` — 哨声逼近，竖井下传来非自然回响。撤退令明确：侦察即归。**exploration**（revelation）。
7. `blizzard-withdrawal` — 撤出即遭 shrieking gale（实体召唤）：鞍部通行 10 分钟、每 5 分钟 Athletics −40%、每 5 分钟 1D8 资源点损耗。**combat**（revelation）。
8. `via-ferrata-climb` — 沿岩烟囱攀登 60 米至山腰避难所，三次 Athletics/Survival(Alpine) 检定，fumble 即坠落（60% 致命）。日落加剧雪崩风险（每 30 分钟 00 即崩，开枪/爆炸 → 96-00%）。**exploration**（revelation）。
9. `shelter-night-siege` — 避难所之夜：实体回声探测穿墙（0/1D6 SAN [unnatural]），1D3 次试图撬门拽人（合 STR 对抗实体 STR 100，dodge 兜底），被拽者被探查（1/1D8 SAN [unnatural]）后弃落冰川。**combat**（revelation/climax）。
10. `dawn-counterstroke` — 黎明四选一（实体畏光 −20%）：①跃入深雪（Athletics 成则 6 点最小伤，败则 6% 致命，CON×5 防震晕）；②射击/手雷触发雪崩（枪 1%/雷 5% 概率，10D6 伤害，实体不免疫）；③信号召唤意军炮火（INT×5 召唤 + INT×5 校射 + Heavy Weapons 40%+20% 体型，但炮手见实体须自 SAN）；④折返取 ecrasite 爆药（Stealth vs 实体 Alertness，组装 80% 致命 + Demolitions 起爆）。**combat**（climax）。
11. `aftermath-white-friday` — 次日（1916-12-13）White Friday 雪崩灾难夺命约万。三种结局分支：实体存活→冰川埋葬+负疚（0/1D6 SAN [helplessness]）；玩家引发雪崩→被追责（1D2 关系各 −3）；杀死实体→免责。向高层讲真话无人信、被调离；掩盖真相 +1D3 SAN。逼退实体 +1D6 SAN，完成任务 +1D3 SAN。**resolution**（revelation）。

**NPC（原创姓名，数值用 OGC）**:
- 5 pre-gen 调查员：保留职业/属性/技能数值（OGC 可分发），姓名与背景原创（如 Angelo Martinelli 的姓名属 PI，改用原创名，但「23 岁意大利步兵、STR 15 CON 12…」的数值保留）。
- Tomasso Cecchini 类幸存者 NPC：原创姓名与对话，但「意大利平民战俘、知道哨声是当地民俗恶魔」的剧情功能保留，对话不引用原文。
- Polyp Horror：用 OGC 怪物描述（p8-10 明确是 OGC）。

**线索/结论**（clue-graph，≥2 critical 各 ≥3 routes）:
- `critical: shaft-is-ancient-seal` — 竖井是自上次冰期封印的远古通道（玄武岩、无回声、冰封）。
- `critical: austrians-triggered-release` — 奥军爆破扩挖误开竖井封印。
- `major: entity-from-flying-polyps` — 实体来自古老「飞螺族」的亚地表敌（Lovecraft《The Shadow Out of Time》reference）。
- `major: entity-fears-daylight` — 实体畏光（白昼 −20%、守阴影），是黎明反击的关键。
- `minor: entity-retreats-at-20hp` — ≤20 HP 撤退回竖井。
- `minor: avalanche-is-lethal-to-entity` — 雪崩 10D6 对实体有效，实体不免疫物理冲击。
- `minor: white-friday-causality` — 逃脱后次日雪崩灾难的因果归属（玩家行动 → 被追责 / 杀实体 → 免责）。

**keeper_secrets**（`improvisation-boundaries.json`，物理隔离，用 `id: 描述` 格式避免与 player-safe clue_id 撞名，满足 `coc_scenario_compile.py:66-73`）:
- `polyp-horror-full-stat-block: ...`（指向 OGC 规则）
- `entity-actually-curious-not-hostile: ...`（探查而非猎杀的动机）
- `white-friday-is-inevitable: ...`（无论玩家如何，次日灾难都发生）
- 等约 8-10 条。

### 6. CE → CoC 7e 转换约定（写进 spec 附表，loader 不做自动转换）

| CE 概念 | 7e 映射 | 说明 |
|---|---|---|
| Lethality rating | 7e 无致命度；用「伤害骰 + DB」近似，或保留为 house rule「Lethality L%: 命中则掷 L，1-2 位数直接秒杀否则造 L 点 HP 伤」 | 关键怪物机制写进 `module.white_war.lethality_vs_semi_material` |
| Willpower Points (WP) | 7e 无 WP；映射为「体力/疲劳点」，户外每 5 分钟耗 1，耗尽按 7e 力竭规则 | house rule 写进 `cold_exposure` |
| Bonds | 7e 无 Bonds；保留为调查员背景「关系」，结局机械影响（−3 关系）改用 7e SAN 或运气检定 | 纯风味 |
| Sanity (SAN) | 直接沿用（CE/7e 都是 0-99） | 无需转换 |
| 技能名 | Firearms→射击 / Firearms(Handgun/Rifle/Shotgun) 按武器分；Melee Weapons→格斗(斧/剑/拳)；Alertness→侦查；Athletics→攀爬/跳跃/投掷；Scavenge→搜集；Heavy Weapons→重型武器；Use Gadgets→机械维修；Harangue→话术；Natural World→自然学；Demolitions→爆破 | 数值保留 |
| Resources (Permanent Resources) | 7e 用「资产/财力 (Credit Rating + 现金)」近似 | 军人 CR 低 |

### 7. OGL 合规标注

- `the-white-war/OGL-LICENSE.txt`: OGL v1.0a 全文（§10: "You MUST include a copy of this License with every copy of the Open Game Content You Distribute."）。
- `the-white-war/README.md`:
  - 完整 OGL §15 COPYRIGHT NOTICE（原文逐字，含 "The White War © 2023, Paul StJohn Mackintosh" 及所有上游贡献者）。
  - 本包的 OGC/PI 划分声明：OGC = Polyp Horror 数值、寒冷规则、武器数据（来自原作 p8-10 OGC 声明）；PI = 原作的剧情/地点/人物/对话/地图（我们未使用，本包的剧情部分为原创衍生作品，版权归本仓库）。
  - RBCE logo 使用声明（若使用 logo 则按 RBCE License 标注；不使用则注明）。
- `module-meta.json` 扩展字段（校验器不拦，加字段不破坏 `coc_scenario_compile.py`）:
  - `one_liner: "..."`（一句话简介，供 coc-main 引导枚举与 loader list 读取；见 §3）—— 新增字段
  - `license: "OGL-1.0a"`
  - `copyright_notice: [...]`（§15 全部条目）
  - `attribution: "Adapted from 'The White War' by Paul StJohn Mackintosh (Cthulhu Reborn Publishing, 2023), published under the Open Gaming License v1.0a."`
  - `author: "Original: Paul StJohn Mackintosh; Adaptation: chatrpgv4 contributors"`
  - `open_content_note: "Open Game Content: numeric game data and creature stats (per source OGC declaration). Product Identity from source (plots, locations, characters) is NOT reproduced; this scenario's narrative is an original derivative work."`
  - `source_pdf: null`（本包不依赖 PDF，原创改编）—— 注：`source_pdf` 在 schema 标注必填但校验器不强校验，设 null 并加注释说明原创。
- 仓库 `README.md` 版权章节（§Copyright Notice 之后）追加一段：声明内置 starter scenario 的 OGL 来源、Section 15 归属、OGC/PI 边界，并更新「不分发 adventure PDF」的措辞以反映「内置 starter scenario 是合法 OGL 改编，非 PDF 分发」。

### 8. 测试与验证

新增 `tests/test_starter_scenarios.py`:
- `list_starter_scenarios()` 返回 the-white-war 且字段完整。
- `install_starter()` 拷贝 7 文件到 scenario/、写 campaign.json 字段、pregen 到位。
- 幂等：二次 install 同 scenario 报错；install 到已有其他 scenario 报错。
- the-white-war 的 scenario 目录通过 `coc_scenario_compile.py --validate` 无 error。
- `rule-index.json` 含所有 `module.white_war.*` id 且正则合法。
- `coc_validate.py` 通过（REQUIRED_RULE_FILES 含 the-white-war.json）。
- 两个插件轨的 starter-scenarios 内容一致（sync --check 通过）。

**手动验收**: 在一个干净 `.coc/` 里激活 COC 模式 → 建新 campaign → 看到引导 → 选内置剧本 → 剧本装入 → 开始游玩，全流程无 PDF。

### 9. 同步与现有流程衔接

- `scripts/sync_coc_plugin_copy.py`: `references/starter-scenarios/` 作为常规资产目录纳入同步规则（默认跟随，无需特殊替换规则）。`scripts/coc_starter.py` 作为常规脚本同步。新增 sync 测试断言两轨 starter-scenarios 一致。
- coc-main SKILL.md 的引导文案属于两轨共享内容（同步脚本 allowlist 不涉及该段）。
- 现有 `the_haunting_rules()` 调用方保持兼容（薄包装）。

## 风险与权衡

- **OGL 边界误判风险**: 若改编时无意复用了 PI 文本（如逐字照搬 Tomasso 的台词），可能越界。缓解：所有 NPC 对话/场景描写强制原创，review 时对照原文检查；keeper_secrets 用抽象机制描述而非原文叙述。
- **CE→7e 转换不忠实**: Lethality 等机制无完美 7e 对应。缓解：关键怪物机制作为显式 house rule 写进 module 规则包，玩家可选「保留 Lethality」或「纯 7e 伤害」。
- **引导打扰老玩家**: 已用 Hard Rule 限定「仅新档无剧本时」触发缓解。
- **era "ww1" 未登记**: `coc_state.py` 时钟初始化需新增 1916 时代分支，否则 era 不识别。已纳入实施步骤。

## 实施步骤（高层，详细 plan 由 writing-plans 展开）

1. 拉分支 `feat/starter-scenario-the-white-war` from main。
2. 写 OGC 规则包 `rules-json/the-white-war.json` + rule-index 登记 + coc_validate REQUIRED。
3. 写改编剧本 7 个 story-graph JSON + pregen + OGL 文件 + README（§5 内容）。
4. 写 loader `scripts/coc_starter.py`（list/install + CLI）。
5. 改 coc_rules.py：泛化 `module_rules(scenario_id)`，`the_haunting_rules` 薄包装。
6. 改 coc_state.py：登记 era "ww1"（1916 时钟）。
7. 改 coc-main/SKILL.md：插入引导节点 + Hard Rule（仅新档无剧本）。
8. 改 README.md 版权章节 + sync 脚本纳入 starter-scenarios。
9. 写 tests/test_starter_scenarios.py + 跑全套校验（pytest + sync --check + scenario compile --validate）。
10. 同步两轨：`python3 scripts/sync_coc_plugin_copy.py && --check`。
11. 手动验收全流程。
12. 提交 + PR。

## Open Questions

无（所有关键决策已与用户对齐）。
