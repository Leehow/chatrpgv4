# COC Keeper

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

COC Keeper 是一个《克苏鲁的呼唤》第 7 版守秘人插件。Codex、Claude Code
和 Cursor 共用唯一实现 `plugins/coc-keeper/`；各宿主只保留薄 manifest 或入口。
它提供规则工具、持久化战役状态、调查员管理、剧本导入、战斗、追逐、理智与
实际跑团支持。

English: COC Keeper is a local Call of Cthulhu 7th edition Keeper plugin. Codex,
Claude Code, and Cursor share the single canonical implementation under
`plugins/coc-keeper/`; host integrations are thin adapters only.

当前版本是 **`0.4.0-alpha.0`**（发布名 **0.4.0a**，Python 包版本
`0.4.0a0`）。当前发布状态和已知限制见 [当前状态](docs/status/CURRENT.md)。

## 安装 / Installation

### Codex

```bash
codex plugin marketplace add Leehow/chatrpgv4 --ref main
```

在 Codex 中打开 `/plugins`，从 `COC Keeper Plugins` 安装 `COC Keeper`，然后
新开任务并说：

```text
进入 COC 模式。
```

本地 checkout 也可以直接加入 marketplace：

```bash
git clone https://github.com/Leehow/chatrpgv4.git
cd chatrpgv4
codex plugin marketplace add "$(pwd)"
```

### Claude Code

`.claude-plugin/marketplace.json` 指向同一个 `plugins/coc-keeper/`。本地 checkout：

```bash
claude plugin marketplace add "$(pwd)"
```

安装 `coc-keeper` 后重开会话并说 `Activate COC mode.`。Claude Code 没有
Codex imagegen 时跳过调查员立绘，其余流程不变。

### Cursor

项目内入口 `.cursor/skills/coc-keeper/SKILL.md` 和插件 manifest
`plugins/coc-keeper/.cursor-plugin/plugin.json` 都路由到 canonical skills 树。
Cursor 没有 Codex imagegen 时同样跳过立绘。

## 主要能力 / Features

- 激活、暂停、恢复或退出 COC 模式。
- 创建、展示和维护调查员角色卡。
- 导入用户合法持有的剧本资料，或直接使用内置开箱剧本。
- 通过确定性工具处理骰点、HP/SAN、技能成长、战斗与追逐。
- 以事务化、幂等方式保存当前 schema 的战役状态。
- 让 Keeper LLM 驱动每个游玩回合；工具只强制规则算术、状态写入与秘密边界。
- 用真实 Codex 插件与无上下文 subagent 玩家做全局验收，并由最终战报 skill
  统一生成可读报告。

第一次使用可以说：

```text
进入 COC 模式。
帮我创建一个调查员。
把这个剧本导入成 COC Keeper 可运行的模组。
用一个无上下文 subagent 当玩家，对当前插件做一次完整测试。
```

## 内置剧本 / Built-in Scenarios

- **The White War** —
  `plugins/coc-keeper/references/starter-scenarios/the-white-war/`
- **The Haunting** —
  `plugins/coc-keeper/references/starter-scenarios/the-haunting/`

The White War 包含 OGL 与 Section 15 声明。The Haunting 的分发依据仍待外部
权利审查，稳定发布前保持 `UNVERIFIED`。详情见
[CONTENT_LICENSES.md](CONTENT_LICENSES.md)。

## PDF 边界 / PDF Boundary

仓库没有 PDF parser、OCR 或布局识别回退，也不安装 PDF 解析依赖。PDF 必须先由
宿主提供的外部 PDF skill（Codex 通常自带 `pdf` skill）完成逐页渲染、OCR、布局、
文本与资源提取，再产出 `schema_version: 1`、`producer: codex-pdf-skill` 的版本化
source bundle。

仓库只通过 `plugins/coc-keeper/scripts/coc_pdf_bundle.py` 校验原始 PDF/hash、
逐页 Markdown/hash、人工接受状态、置信度与 grep anchors，并做确定性重排：

```bash
uv run --frozen python plugins/coc-keeper/scripts/coc_pdf_bundle.py \
  /absolute/path/to/source-bundle \
  --output /absolute/path/to/normalized-source.json
```

绑定会保存 canonical `bundle_sha256`，之后任何源文件、页面内容、证据或资源漂移
都会被拒绝。完整契约见
`plugins/coc-keeper/skills/trpg-pdf-ingest/SKILL.md`。

## 开发 / Development

开发前先安装精确版本 uv 0.11.16。唯一解释器是 CPython 3.14.6，唯一依赖
来源是提交的 `uv.lock`；然后从仓库根目录按冻结锁文件同步开发环境：

```bash
uv sync --frozen --dev
PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest tests -q -p no:cacheprovider
```

从其他目录调用时使用 `uv run --project <repo-root> --frozen python ...`。
不要用 PATH 中的 `python` / `python3` 替代项目解释器。

### 确定性测试边界

pytest 只验证适合机器确定判定的合同：规则与骰点算术、事务/幂等状态、当前
schema、路径安全、插件元数据、PDF source bundle，以及生产子系统的结构化接口。
它不模拟玩家，不生成“战报”，也不以固定台词、固定 profile 或评测矩阵冒充整局
游戏质量。

插件改动至少运行：

```bash
PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest \
  tests/test_plugin_metadata.py tests/test_release_consistency.py \
  -q -p no:cacheprovider
```

### 全局测试 / Whole-product Acceptance

全局验收直接运行真正的 Codex 插件：

1. 主 Codex 打开 canonical `coc-keeper` 插件并担任 KP。
2. 每次测试创建全新的隔离 workspace 和当前 schema 战役，不续用旧测试状态。
3. 启动 `fork_turns: "none"` 的 collaboration subagent 作为玩家；它不继承 KP
   上下文、模块真相或内部状态。
4. 主 Codex 只向玩家转发玩家可见的叙述、角色卡、公开骰点和明确选择；玩家回复
   也只作为玩家行动送回 KP。
5. 按普通 `coc-main` / `coc-keeper-play` 流程运行到结构化结局，或诚实记录明确的
   运行阻塞。
6. 结束后只由 `coc-export-battle-report` skill 生成最终可读
   `artifacts/battle-report.md` 和完整性证据。没有通过完整性检查就不能宣称战报完整。

subagent 与主 Codex 共享工作区，因此这是一种受协议约束的无上下文玩家隔离，
不是密码学沙箱。验收报告必须如实说明这一点。详细流程见
`plugins/coc-keeper/skills/coc-playtest/SKILL.md`。

## 仓库结构 / Layout

```text
plugins/coc-keeper/              # 唯一 canonical 插件
  .codex-plugin/                 # Codex manifest
  .claude-plugin/                # Claude Code manifest
  .cursor-plugin/                # Cursor manifest
  references/                    # 结构化规则和内置剧本
  scripts/                       # 生产工具与确定性辅助程序
  skills/                        # 全宿主共用 skills
runtime/                         # 开放 headless Event SDK / adapters
tests/                           # 确定性合同测试
```

调查员立绘是 Codex-only 能力，必须保留在
`plugins/coc-keeper/skills/coc-character/SKILL.md` 的
`CODEX_ONLY_IMAGEGEN` 标记内。其他宿主跳过该能力，不得维护第二套插件树。

## 版权 / Copyright

本项目是非官方 fan/developer 工具，与 Chaosium Inc. 无关联、背书或赞助关系。
仓库不包含规则书或商业剧本 PDF。第三方名称和商标归各自权利人所有。

代码采用 [Apache License 2.0](LICENSE)。
