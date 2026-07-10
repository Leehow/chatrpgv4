# Changelog

本文件集中记录 COC Keeper 对玩家、Keeper、插件集成方和 runtime 调用方有影响的变更。
格式参考 Keep a Changelog；发布边界以 Git tag 和
`plugins/coc-keeper/.codex-plugin/plugin.json` 为准。历史执行细节仍保留在
`docs/superpowers/` 与 `.superpowers/sdd/`，但不再要求读者从这些文件拼接版本变化。
唯一实时状态来源是 `docs/status/CURRENT.md`。

## [Unreleased] — manifest `0.16.0-alpha.1`

### 已提交（`v0.2a` 之后）

- 恢复单调 SemVer：Codex、Claude Code、Cursor manifests 与 Claude marketplace
  统一为 `0.16.0-alpha.1`；加入内容权利清单、四类 CI job、当前状态单一来源，
  并停止跟踪本地规则书提取缓存。
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
  `docs/live-playtest-notes.md` remains historical evidence only; live status remains in `docs/status/CURRENT.md`.
### Known Issues

- 当前自动 playtest driver 不是 live LLM-vs-KP；已有 suite/completion 产物不能
  替代项目要求的真实战报证据。外部模型证据状态见 `docs/status/CURRENT.md`。

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
