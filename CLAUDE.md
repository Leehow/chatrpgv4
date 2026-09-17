# Claude Code 项目入口

先完整阅读并遵守根目录 [Agents.md](Agents.md)；它是本项目唯一的完整规则源，本文件只强调最容易走错的重构边界。

**Python 内核已退役，当前生产内核只维护 `kernel-ts/`。** 旧 Python 文件找不到是预期状态：按当前 RPC 契约定位 TS 实现，不能去历史 Git、旧分支或旧 worktree 把 Python 找回来继续修改，也不能恢复 Python 后端。

`tests/python-oracle.json` 指定的历史对照及其只读缓存只供测试，不是待同步的开发实现；不要修改历史对照来适配 TS 新功能。Python 测试和构建工具的存在，不改变这条生产边界。历史查阅的唯一例外和 worker 委派要求，见 Agents.md 开头“当前重构边界”。

## Agent skills

### Issue tracker

Spec 与工单是仓库内 Markdown（`docs/specs/`），不写 GitHub Issues。见 `docs/agents/issue-tracker.md`。

### Triage labels

五个默认分诊词，写在工单的 `Status:` 行。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文：`Agents.md` + `CONTEXT.md` + `docs/adr/` + `docs/kernel-rpc.md`。见 `docs/agents/domain.md`。
