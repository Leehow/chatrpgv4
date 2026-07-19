# Changelog

本文件集中记录 COC Keeper 对玩家、Keeper、插件集成方和 runtime 调用方有影响的变更。
格式参考 Keep a Changelog；发布边界以 Git tag 和
`plugins/coc-keeper/.codex-plugin/plugin.json` 为准。历史 specs/plans/reviews 已按
`docs/status/DIAGNOSIS-LEDGER.md` 逐条终结归档并从版本库移除；LEDGER 保留为墓碑索引，
不再要求读者从历史文件拼接版本变化。
唯一实时状态来源是 `docs/status/CURRENT.md`。

## [Unreleased] — manifest `0.4.0-alpha.0` (release name `0.4.0a`)

### Changed for 0.4.0a

- **Player Knowledge Boundary（KP 负责拦截）：** 玩家可以猜、可以诱导剧透；
  KP 不得把未赚取的断言当成桌上已知事实，也不得因「猜对了」就跳过发现或
  倾倒模块真相。蒙对也仍是猜测。拦截优先用戏内推回，语气允许时可用
  Table Wit。见 `AGENTS.md` 与 `coc-keeper-play` Declaration Adjudication。

- Cursor、Kimi、ZCode 接入同一个 canonical plugin MCP gateway。新增
  `.zcode-plugin/plugin.json`，将 Kimi manifest 迁移到当前支持的
  `.kimi-plugin/plugin.json`，并为三宿主暴露同一 toolbox registry、host
  capability 声明和 `turn.finalize` transport；不恢复任何
  `coc-keeper-zcode` 平行插件树。

- Grok Build becomes a first-class full-plugin host:
  `plugins/coc-keeper/.grok-plugin/plugin.json` points at the same
  `./skills/` tree; `scripts/install-grok-plugin.sh` runs
  `grok plugin install … --trust`. Play requires the full skill surface
  (Codex parity), not a thin routing entry alone.
- Investigator portraits are **host-native**, not Codex-only. Codex uses
  `imagegen`/`image_gen`; Grok Build uses `image_gen`/Imagine; hosts without a
  built-in image tool skip portraits. Gate markers renamed to
  `HOST_NATIVE_IMAGEGEN` in `coc-character`. Do not call another host's image
  stack from the current host.

- 删除旧的固定 profile、脚本玩家、评测矩阵和多套报告流程。全局验收改为主
  Codex 打开 canonical 插件担任 KP，并用 `fork_turns: "none"` 的 collaboration
  subagent 当玩家；只允许转发玩家可见信息，每次从全新当前 schema workspace
  开始。
- `coc-export-battle-report` 成为最终可读 `artifacts/battle-report.md` 与完整性证据
  的唯一输出入口；确定性 pytest 不再冒充实际跑团战报。
- 确定性测试收敛到规则/骰点、事务与幂等状态、schema、路径安全、插件元数据、
  PDF source bundle 和生产子系统结构化合同。
- 明确 PDF 是外部宿主 skill 的 source-bundle 边界：仓库不解析 PDF、不做 OCR，
  也没有 parser/OCR fallback。
- Codex、Claude Code、Cursor manifests 和 Claude marketplace 统一为
  `0.4.0-alpha.0`；Python 项目版本为 PEP 440 `0.4.0a0`。

### 已提交（`v0.2a` 之后）

- 旧开发标识曾用于收敛多宿主 manifest、内容权利清单、CI 和当前状态来源；
  0.4.0a 已重新建立面向用户的预发布版本边界。
- 新增开放的 headless runtime：项目级 `debug` / `pi` brain 选择、结构化
  Event/PublicState 协议、Python session SDK、debug adapter 与受约束的 Pi
  bridge；同时补上 roll 事件结构校验和 Pi 工具失败显式上报
  （`3a9dd4d` 至 `eaa5398` 的 runtime 提交序列）。
- 仓库收敛为单一 canonical Codex 插件 `plugins/coc-keeper/`，删除 ZCode
  运行时副本和同步流程，并清理主要维护文档中的旧双轨术语
  （`e314156`、`8dd426f`）。
- 补齐 `arrival` / `first_contact` 场景进入 Storylet；The White War 的四个
  中段场景已接入对应标签，并由真实打包数据端到端测试覆盖（`e68ff6d`）。
- 加入规则书对齐的 Idea Roll 恢复阀：线索按 `unmentioned` / `mentioned` /
  `obvious` signpost 阶梯选择免费提示、Regular INT 或 Extreme INT；失败仍
  推进调查，但让调查员处于更差位置（`ff6ce36`）。
- 完成 P0-P2 波次 0-5 的 plan/commit 对账，并发布 N1-N8 下一阶段优化审计
  （`2fea227`、`f03e50a`）；其后 Wave 4 已落实 N1-N8，原审计现为历史材料。

### 后续已提交变更

> 下列实现均已进入 `v0.2a` 之后的提交历史，但尚未形成新的发布 tag。

- 场景退出条件统一为结构化 `clue_discovered` / `clock_reaches` /
  `narrative` 对象；director 与 apply 层共用 `coc_exit_conditions.py`，旧字符串
  仅在单一兼容入口解析。
- live turn 缺少调用方意图时改走语义 intent router；没有语义证据则诚实降级
  为 `ambiguous`，并把来源写入 `intent_resolution`，不再静默猜成
  `investigate`。
- 线索交付不再扫描自由文本判断 obvious/obscured；缺少 `delivery_kind` 时保守
  视为 obscured，并输出结构化迁移警告。
- `run_live_turn(...)` 被文档化为普通 live play 的唯一 turn 入口；新增内部管线
  说明，并补全 campaign 状态、runtime receipt 和 fast/background 日志目录约定。
- README 的 Python 最低版本从 3.10+ 修正为 3.11+，与代码对标准库
  `tomllib` 的实际依赖一致。
- 修复极寒场景中快速环境观察被统一计作 20 分钟房间搜索的问题：director
  现在按「场景作者显式 `time_profile` → 结构化 intent detail/category → action
  默认值」选择时间档；`quick_observation` 最多推进 5 分钟，显式或普通
  `single_room_search` 仍保持 20 分钟，并由真实 `run_live_turn(...)` 回归覆盖。
  live status remains in `docs/status/CURRENT.md`.
- 完成 A01-A34 全量硬化：live SAN/Push/战斗/追逐与救援、结构化终局、可信
  evidence receipt、持久化威胁/NPC/策略状态、crisis frame、恐怖风格与秘密审计，
  以及 runtime 路径/存档迁移/会话恢复/显式组合/worker 复用/telemetry。
- 合入 scenario epistemic blueprint：PDF 页码与 hash 来源桥、artifact-bound 语义
  编译、compile confidence、多效果认知合同、Question Lifecycle、belief reducer、
  Cognitive Storylets、Narrator 最小权限投影，以及认知指标和条件式报告章节。
- 新增跨 starter、调查/社交、SAN、Push、战斗、追逐、保存恢复、结构化终局和
  完整 epistemic 链的确定性合同测试。该证据不是实际跑团，也不冒充战报。
- 新增 `docs/status/DIAGNOSIS-LEDGER.md`，逐项说明两份原始审查中真实缺陷、
  live wiring/test gap、过期文档和误导性元数据的根因与当前证据。
- 新增只读工具 `rules.build_scale` 与规则数据 `build-scale.json`：收录规则书
  p.279 Builds 速查与 Table XV 比较体格表（Build −2 儿童/果蝠至 65 巨噬蠕虫/
  战列舰），按 actor/target 体格差给出举/扛/掷判定，并复用 combat.json 的机动
  罚骰与 3 档不可能阈值；`coc-keeper-play` 的 Build and scale 条款已指向该工具。
- 战报导出新增玩家安全的 "Social Skill Rolls" 聚焦视图：仅收录公开社交技能骰
  （Charm / Fast Talk / Intimidate / Persuade；Psychology 属 KP 暗骰不列入），
  零记录时显式说明，证据 JSON 同步携带 `social_rolls`。
- 修复调查员参数"可发现但少被消费"的断链：`npc.query` 与
  `state.record_npc_engagement` 在中立 NPC 尚无累积 psych 信号时追加 p.191
  第一印象 advisory hint（附调查员 APP/CR，指向 `npc.reaction`）；
  `describe_parameter_signals` 补 APP 显著档提示（p.37 阶梯，平均值保持静默）；
  `coc-keeper-play` 第一印象条款改为明说自动骰只发生在 director.advise 内，
  并要求 KP 把第一印象演进初次照面的描写。
- `evidence.record_adoption` 新增可选 `emotional_tone_adoption` 字段：按 NPC
  结构化记录导演计划中 p.191 第一印象语气（`npc_moves[].emotional_tone`）的
  采纳/改写/忽略状态，让"tone 有没有被演进台面文"成为可度量证据；未提供时
  receipt 形状不变，完全向后兼容；`coc-story-director` 指引同步要求上报。
- 规则数据全量对账（Table XVII 武器表）：按原书渲染页（pp.401-405）逐行核对
  全部 104 行武器参数，修复 MinerU 手枪块行名滞后导致的 8 个条目数值错配
  （Beretta M9 / Glock 17 / Model P08 Luger 等串行），补入 6 件缺失武器
  （.22 Short Automatic、.32/7.65mm Automatic、12-gauge Pump / semi-auto /
  sawed-off、Taser contact），修正 Sword light 的 (i) impale 标记与多处 era 值；
  删除伪造典籍条目 `necronomicon_en_philips`，补入 Al Azif、Necronomicon
  三个正典版本（Greek / Latin / Dee）、Necrolatry 和 Massa di Requiem per
  Shuggay；Find Gate 等 3 个法术的 `sanity_cost` 字段归一为 `cost_sanity`。
- 验证层修复：`checks/rulebook-weapons-ref.json` 扩为按原书页转写的 104 行
  全量基准，`gap_audit.py` 据此覆盖全部武器参数并经
  `tests/test_rulebook_data_audit.py` 接入 pytest（离线 JSON 审计，无需 OCR
  缓存）；`checks/exhaustive_rulebook_validator.py` 修复"战役 id == run id"
  假设导致的空转通过——现按 sandbox 实际战役目录发现日志，并在零记录时
  拒绝通过（exit 2），新增 fixture 合同测试；10 个 `verify_*_ocr.py` 全部
  恢复可运行（`cache_all_ocr.sh` 补 monsters-ch14 正确页段 idx 320-355，
  分三段避免 MinerU 长任务断连）。
### Known Issues

- The Haunting 的分发依据和插件图片来源仍为 `UNVERIFIED`；稳定发布前需要外部
  权利审查。

## [0.2.0-alpha] - 2026-07-09

> 历史打包说明：此 tag 发布时仓库仍同步维护 Codex/ZCode 两个插件副本；
> 单轨迁移发生在发布后的 `e314156`，不属于 0.2.0-alpha 发布内容。
> 另外，Git 拓扑和发布日期都表明 `v0.2a` 晚于 `v0.15a`，但版本号从
> `0.15.0-alpha` 写成了 `0.2.0-alpha`，存在 SemVer 数值倒退；本日志按实际
> tag 时间/拓扑排序，不在文档更新中擅自改版本号。

### Added

- 新增 `run_live_turn(...)` live 执行器、fast/background 非阻塞记录、卡住检测和
  带外维护 flush（`143eb2c`、`7e7de47`、`924612e`、`4632217`）。主
  director/enrichment/rules 流程仍为同步执行。
- 新增结构化玩家可行动性协议：`is_real_fork`、
  `requires_player_decision`、跨轮低主动标签、`turn_focus`、动态 handles 与
  Storylet cues，减少假分叉和无行动点停顿（代表提交 `919558b` 至
  `1102cf6`）。
- 打通开场 Storylet 数据链：导入器 affordance/tag 合约、The White War 开场数据
  与 opening-briefing Storylet（`f0c4f05`、`6f6c174`、`7822913`、
  `21da731`）。`arrival` / `first_contact` 扩展不属于此 tag。
- 扩展 NPC 决策和呈现：抽象 agency move、编译期 `social_role`、按当前动作决定
  assist scope、persona voice/stress，以及结构化外语理解层级（`c9b1280`、
  `de9a495`、`5582bc3`、`b121255`、`8717252`）。
- 新增调查员 registry、跨模块 helper API 索引、handout 元数据透传和 live
  spoiler audit 写入（`8bcd077`、`8ae67bd`、`3326cde`、`20a888d`）。

### Changed

- 统一 roll/clue contract：普通失败走结构化 failure routing，遮蔽线索受 roll
  contract 约束，关键线索可达性可审计，并加入基础 Idea Roll / scene-exit 指令
  （`5421b9a`、`932dfd1`、`33878a5`、`0eb6eff`、`e2c5dbc`）。完整
  signpost 阶梯在发布后的 `ff6ce36` 才落地。
- 加强节奏和叙述契约：dramatic progress、proposal transform、最终 prose
  guard、跨轮 roll-density 与 `compression_budget.max_beats` 上限
  （`b5fe675`、`e007c32`、`cf086ef`、`e7fb2c4`、`2360b74`）。
- 普通百分骰默认展示十位/个位组成；调用方仍可用 `compact=True` 保持精简格式
  （`0aa4652`）。

### Fixed

- 修复空 handle 时过早停住、turn 0 场景进入 Storylet 不触发、开场
  `REVEAL`/`CHOICE` Storylet 被过滤、live fork/pacing 合约漂移，以及叙事型
  `exit_conditions` 被线索揭示误触发切场的问题（`9d5ec0b`、`2a542e9`、
  `cdf340f`、`91f5cd8`、`39374e3`）。

[Unreleased]: https://github.com/Leehow/chatrpgv4/compare/v0.2a...HEAD
[0.2.0-alpha]: https://github.com/Leehow/chatrpgv4/compare/v0.15a...v0.2a
