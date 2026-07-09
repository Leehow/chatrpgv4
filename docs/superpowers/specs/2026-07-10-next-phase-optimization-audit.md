# 下一阶段优化盘点（Post-P0/P1/P2 Audit）

**Date:** 2026-07-10
**Status:** 已核实（每条含 file:line 证据），待排期
**前提:** 缺陷蓝图（2026-07-08）波次 0-5 全部落地；Idea Roll signpost 阶梯已提交（`ff6ce36`）。本文只列"下一阶段"，不重复已修项。
**北极星:** 做一个 AI coding 插件，让 LLM 在 coding agent 里当 KP 陪玩家跑 CoC。

---

## 优先级总表（按玩家体验影响排序）

| # | 条目 | 一句话 | 影响面 |
|---|---|---|---|
| N1 | 多宿主可安装 | 只有 `.codex-plugin/`，Claude Code / Cursor 用户装不上 | 获客面 |
| N2 | 开箱内容供给 | starter 仅 White War 一个；the-haunting 仍是纯规则零场景 | 首局体验 |
| N3 | 叙述质量 runtime 闭环 | guard/contract 全是 advisory，LLM 写完没人查 | 每一回合 |
| N4 | live turn 缓存与只读并行 | 全仓库零 lru_cache，7198 行 storylet 库每选必读 | 每一回合延迟 |
| N5 | 真 LLM 玩家 vs KP 对战 harness | driver 自认 `not_live_llm`，战报证据标准无法满足 | 质量验证 |
| N6 | 存档工程化 | apply 热路径非原子写、无锁、schema_version 无迁移 | 长战役安全 |
| N7 | onboarding 再缩短 | 无预生成调查员、无"一句话开玩" | 转化率 |
| N8 | 旁路清理 | scheduler.jsonl 只写不读、fork_timeline stub | 维护性 |

---

## N1 多宿主可安装（最高优先）

- **事实**：插件元数据只有 `plugins/coc-keeper/.codex-plugin/plugin.json`；无 `.claude-plugin/` manifest、无 Cursor Agent Skills 入口。非 Codex 宿主只能手工把 skills 目录挂进去或复制 `references/AGENTS-coc-mode-template.md`。
- **约束**：AGENTS.md 单轨法——不许复制第二套插件树。
- **方向**：加**薄适配层**（各宿主的 manifest/入口文件指向同一套 `plugins/coc-keeper/skills/`），行为仍单轨；Codex-only 能力（立绘）维持 `CODEX_ONLY_IMAGEGEN` 门控，其他宿主跳过。
- **验收**：Claude Code / Cursor 各有一条被文档化、被测试锁住的安装路径。

## N2 开箱内容供给

- **事实**：`starter-scenarios/` 仅 `the-white-war`；`rules-json/the-haunting.json` keys 仅 `scenario_id/module_title/source_note/rules/weapons`，无场景文本（蓝图 P0-1 时代即如此，至今未变）。
- **方向**：给 The Haunting 补叙事包（story-graph/clue-graph/npc-agendas，含 affordances/storylet_tags，走 OGL/原创改写路径与 White War 同法），或新写第二个短 starter；starter 附 1-2 张预生成调查员（与 N7 联动）。
- **验收**：`list_starter_scenarios()` ≥2；新剧本通过 `validate_scenario` 零 error、affordances 警告为零。

## N3 叙述质量 runtime 闭环

- **事实**：`guard_player_visible_text`（coc_narration_style.py:405-413）在 live runner **零调用**；`assert_narration_ready` 只校验 plan 不校验最终散文；SKILL 写"run **or mentally apply**"（coc-keeper-play/SKILL.md:178）。
- **方向**：给宿主 LLM 增加"写完必查"回路——skill 硬指令改为必须调用 guard + 结构化核对 `must_include`/`must_not_reveal`，未过则 rewrite；产出 `narration-audit.jsonl` 记录每回合核对结果（带 reason，符合 Constitution）。
- **注意**：guard 是 prose 表层 lint（P1-7 已声明边界），不得用于语义判定。

## N4 live turn 缓存与只读并行

- **事实**：全仓库 Python 零 `lru_cache`；`load_storylet_library`（coc_storylets.py:66-71）每次整库 `json.loads`（7198 行）；`load_rule_table`（coc_rules.py:18-21）、`_load_structure_weights`（coc_story_director.py:580-581）同样无缓存；`build_director_context` 每回合串行重读 scenario JSON；auto-advance 最多 ×3 放大整条链。
- **方向**：静态资源（storylet 库/结构权重/规则表）模块级缓存 + mtime 失效；context 的 scenario 侧文件读并行化或跨 auto-advance 复用；先做缓存（零风险）再谈并行。
- **验收**：单回合内同一静态 JSON 只读一次；auto-advance 3 步的耗时可测下降。

## N5 真 LLM 玩家 vs KP 对战 harness

- **事实**：`coc_playtest_driver.py` 明确 `player_profile: driver_virtual_player`、`simulation_method: driver_executed_virtual_table_not_live_llm`（:697-703），`future_enhancements` 自己写着"Replace with live LLM-vs-KP"；`runtime/adapters/pi` 是 KP brain 不是玩家 brain。
- **方向**：复用 pi 桥模式加 player-brain adapter（玩家 LLM 只看 player-safe PublicState），产出满足 AGENTS.md 战报证据标准的真实 playtest 产物。
- **价值**：这是唯一能按项目自己的证据标准出"战报"的路径。

## N6 存档工程化

- **事实**：`coc_state.write_json_atomic` 存在（coc_state.py:85-96），但 apply 热路径用非原子 `path.write_text`（coc_director_apply.py:177）；无文件锁；`schema_version: 1` 遍地写、全库无 migrate 函数；坏 JSON 只有 fallback 无备份恢复。
- **方向**：热路径统一原子写；加 schema 升级钩子（读档时 version < current 则迁移）；可选轻量锁防并发会话写坏（本仓库已出现过双会话同时工作的实况）。

## N7 onboarding 再缩短

- **事实**：装好插件到开玩约 6-8 步；starter 不带预生成调查员（the-white-war/README.md:57-60），建卡是首局最长一步。
- **方向**：starter 附预生成 PC + "quick start" 一句话入口（选剧本+选预生成卡+直接进第一幕）；与 N2 同批做。

## N8 旁路清理

- `storylet-scheduler.jsonl` 只写不读（写入点 coc_director_apply.py:1171，运行时无读者）——要么进 debug 工具要么降级为可选。
- `coc_time.fork_timeline` 自述 "Stub for v1"（:647-658）——实现或从对外 API 隐藏。

---

## 建议执行顺序

```
批次 A（获客）：N1 多宿主 + N2 内容 + N7 quick-start   ← 决定"有没有人能玩起来"
批次 B（体验）：N3 叙述闭环 + N4 缓存                   ← 决定"玩起来爽不爽"
批次 C（工程）：N5 LLM 对战 + N6 存档 + N8 清理          ← 决定"能不能长期迭代"
```
