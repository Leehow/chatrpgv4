# COC Keeper

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

COC Keeper 是一个《克苏鲁的呼唤》第 7 版守秘人插件，可安装到 **Codex**、**Claude Code** 和 **Cursor**。三宿主共用同一套 `plugins/coc-keeper/skills/`（单轨法）；它让 AI 在跑团时不只是“即兴讲故事”，而是能按照一套结构化流程处理调查、线索、理智、追逐、战斗、角色卡、剧本导入、持久化存档和自动化 playtest。

English: COC Keeper is a local Call of Cthulhu 7th edition Keeper-mode plugin for Codex, Claude Code, and Cursor. One skills tree under `plugins/coc-keeper/`; thin host manifests only. It provides structured rules, persistent campaign state, investigator tools, scenario import, subsystem handling, and automated playtest reporting.

当前 manifest 版本为 **`0.16.0-alpha.1`**；它尚未对应新的 Git tag。发布候选进度、已知限制与验证入口统一记录在 [当前状态](docs/status/CURRENT.md)。

## 快速安装 / Quick Install (三宿主)

所有宿主都指向同一 canonical 插件目录 `plugins/coc-keeper/`。**不要**复制第二套 skills 树。调查员立绘生成仅 Codex 可用；Claude Code / Cursor 跳过该能力。

### Codex

```bash
codex plugin marketplace add Leehow/chatrpgv4 --ref main
```

然后在 Codex 里：

1. 新开一个 Codex 会话。
2. 打开插件目录。CLI 里输入：

   ```text
   /plugins
   ```

3. 切换到 `COC Keeper Plugins` marketplace。
4. 安装 `COC Keeper`。
5. 再新开一个线程，让 Codex 加载新插件。
6. 对 Codex 说：

   ```text
   Activate COC mode.
   ```

安装后也可以直接用中文说“进入 COC 模式”“创建调查员”“导入这个模组”“跑一次 playtest”。

### Claude Code

仓库根目录提供 Claude Code marketplace 入口：`.claude-plugin/marketplace.json` → `./plugins/coc-keeper`（插件 manifest：`plugins/coc-keeper/.claude-plugin/plugin.json`）。Skills 由 Claude Code 自动发现 `plugins/coc-keeper/skills/`。

本地 checkout：

```bash
git clone https://github.com/Leehow/chatrpgv4.git
cd chatrpgv4
claude plugin marketplace add "$(pwd)"
```

然后在 Claude Code 中安装 `coc-keeper`，新开会话后说 `Activate COC mode.` / `进入 COC 模式。`  
无 imagegen 时跳过立绘，继续角色创建其余步骤。

### Cursor

两种薄入口（均不复制 skills）：

1. **项目内 Agent Skill（本仓库）**：`.cursor/skills/coc-keeper/SKILL.md` 路由到 `plugins/coc-keeper/skills/`。打开本仓库即可；显式激活 COC 模式后再加载 keeper skills。
2. **Cursor 插件 manifest**：`plugins/coc-keeper/.cursor-plugin/plugin.json` 声明 `"skills": "./skills/"`，与 Codex/Claude 共用同一树。

无 imagegen 时跳过立绘。被动激活规则见 `plugins/coc-keeper/references/AGENTS-coc-mode-template.md`。
## 这是什么 / What It Does

COC Keeper 的目标是把 Codex 变成一个更可靠的 COC 守秘人工具。它适合这些场景：

- 在 Codex 里进行中文或英文 COC 跑团。
- 创建、展示和维护调查员角色卡。
- 导入剧本材料，整理可运行的场景、线索和 Keeper-only 信息。
- 在游玩时维护 `.coc/` 存档、日志、战斗状态和剧本进度。
- 处理理智检定、追逐、战斗、规则查询和场景推进。
- 跑自动化 playtest，用测试和审计报告检查规则覆盖、线索可达性和叙事流程。

它不是官方规则书替代品，也不包含《Call of Cthulhu Keeper Rulebook》PDF。你仍然需要合法拥有规则书和你要运行的剧本。

## 主要功能 / Features

- **COC 模式**：通过 `coc-main` 激活、继续、暂停、保存或退出跑团状态。
- **调查员工具**：创建角色、生成玩家可读角色卡、管理技能和背景信息。
- **剧本导入**：索引场景、NPC、线索、手稿和 Keeper-only 信息。
- **持久化状态**：把战役、角色、日志、战斗和 playtest 结果保存在 `.coc/` 下。
- **规则子系统**：覆盖常见 percentile check、理智、战斗、追逐和规则问答流程。
- **第 6 章战斗引擎**：处理近战、火器、Dive for Cover、Cover、Outnumbered、Point-Blank、射程难度、逃离等机制。
- **自动化 playtest**：内置 `rulebook-smoke`、`haunting-module`、`chase-drill`、`multi-profile-pressure` 等 profile。
- **Codex 立绘**：调查员立绘生成仅在 Codex 宿主可用；其他环境跳过该能力。

## 第一次使用 / First Run

安装插件并新开线程后，可以从这些提示开始：

```text
Activate COC mode.
Create a COC investigator.
Import this scenario for COC Keeper.
Run a COC playtest with the haunting-module profile.
```

中文也可以：

```text
进入 COC 模式。
帮我创建一个调查员。
把这个剧本导入成 COC Keeper 可运行的模组。
用 haunting-module profile 跑一次自动 playtest。
```

## 安装细节 / Installation Details

| 宿主 | Marketplace / 入口 | 插件 manifest | Skills |
|---|---|---|---|
| Codex | `.agents/plugins/marketplace.json` | `plugins/coc-keeper/.codex-plugin/plugin.json` | `./skills/` |
| Claude Code | `.claude-plugin/marketplace.json` | `plugins/coc-keeper/.claude-plugin/plugin.json` | 自动发现 `./skills/` |
| Cursor | `.cursor/skills/coc-keeper/SKILL.md`（项目薄入口） | `plugins/coc-keeper/.cursor-plugin/plugin.json` | `./skills/` |

本地 Codex checkout：

```bash
git clone https://github.com/Leehow/chatrpgv4.git
cd chatrpgv4
codex plugin marketplace add "$(pwd)"
```

更新已安装 Codex 插件：

```bash
git pull
codex plugin marketplace upgrade
```

更新后重新打开需要使用插件的 Codex 线程。Claude Code / Cursor 同样 `git pull` 后重开会话即可。

## 仓库结构 / Repository Layout

```text
.
├── .agents/plugins/              # Codex repo marketplace metadata
├── .claude-plugin/               # Claude Code repo marketplace metadata
├── .cursor/skills/coc-keeper/    # Cursor thin skill entry (routes to plugins/)
├── checks/                       # rulebook validators; generated extracts stay local/ignored
├── docs/superpowers/specs/       # design notes and implementation specs
├── plugins/
│   └── coc-keeper/               # single-track plugin (all hosts)
│       ├── .claude-plugin/       # Claude Code plugin manifest
│       ├── .codex-plugin/        # Codex plugin manifest
│       ├── .cursor-plugin/       # Cursor plugin manifest
│       ├── references/           # structured reference docs and rules JSON
│       ├── scripts/              # Python runtime, reports, harnesses, helpers
│       └── skills/               # canonical skill entrypoints (one tree)
├── scripts/                      # maintenance helpers
└── tests/                        # pytest suite
```

## 开发 / Development

版本发布、tag 之后的已提交更新和明确标注的在途变更，统一记录在
[CHANGELOG.md](CHANGELOG.md)。
唯一实时状态来源是 [docs/status/CURRENT.md](docs/status/CURRENT.md)；历史 plan
和 audit 只保留设计与审计上下文，不代表当前执行状态。

需要 Python 3.11+（`coc_completion_audit.py` 使用标准库 `tomllib`）。

安装测试依赖：

```bash
pip install pytest pypdf
```

运行完整测试：

```bash
pytest tests/ -q
```

运行 playtest profile：

```bash
python3 plugins/coc-keeper/scripts/coc_playtest_harness.py --profile haunting-module --root . --run-id my-run
python3 plugins/coc-keeper/scripts/coc_playtest_audit.py .coc/playtests/my-run
```

运行规则合规检查：

```bash
python3 checks/exhaustive_rulebook_validator.py .coc/playtests <run-id>
```

## 插件维护规则 / Plugin Maintenance

`plugins/coc-keeper/` 是唯一插件实现（COC Plugin Single-Track Law）。Claude Code /
Cursor 只允许薄 manifest 或入口文件指向该树。提交插件相关改动前，至少运行：

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m pytest tests/test_plugin_metadata.py -q -p no:cacheprovider
```

调查员立绘生成是 Codex-only 能力，保留在
`plugins/coc-keeper/skills/coc-character/SKILL.md` 的 `CODEX_ONLY_IMAGEGEN`
标记块内。非 Codex 宿主应跳过该能力，而不是再维护第二套插件树。
## 规则书 PDF / Rulebook PDF

规则书 PDF 不包含在仓库中，也不会被 Git 跟踪。如果你要使用规则书页码查找、PDF ingest 或剧本导入相关能力，请把你合法拥有的 PDF 放到：

```text
pdf/Call Of Cthulhu Keeper Rulebook 40th Anniversary (Sandy Petersen).pdf
```

不放 PDF 也可以使用多数功能，包括规则 JSON、角色、战斗、playtest 和测试套件。

## 版权与声明 / Copyright Notice

This project is an unofficial fan/developer tool. It is not affiliated with, endorsed by, or sponsored by Chaosium Inc. Call of Cthulhu and related names belong to their respective owners.

The repository contains code, plugin instructions, tests, structured helper data, and development tooling. It does not include copyrighted rulebook PDFs or adventure PDFs.

### Built-in Starter Scenarios

This repository ships two built-in, play-ready starter scenarios:

- **The White War** — `plugins/coc-keeper/references/starter-scenarios/the-white-war/` is adapted under the Open Gaming License v1.0a from the OGC game data of "The White War" by Paul StJohn Mackintosh (Cthulhu Reborn Publishing, 2023). The bundled directory includes the OGL and complete Section 15 notice; no source PDF is included.
- **The Haunting** — `plugins/coc-keeper/references/starter-scenarios/the-haunting/` is an original derivative pack inspired by the classic introductory structure. Its redistribution basis has not received an external rights review and remains **UNVERIFIED** before stable release.

Neither starter includes a rulebook or adventure PDF. See [CONTENT_LICENSES.md](CONTENT_LICENSES.md) for the repository-wide content inventory and evidence status; that inventory records repository evidence and is not a legal opinion.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
