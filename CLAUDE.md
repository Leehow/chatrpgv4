# Claude Code 项目入口

先完整阅读并遵守根目录 [Agents.md](Agents.md)；它是本项目唯一的完整规则源，本文件只强调最容易走错的重构边界。

**Python 内核已退役，当前生产内核只维护 `kernel-ts/`。** 旧 Python 文件找不到是预期状态：按当前 RPC 契约定位 TS 实现，不能去历史 Git、旧分支或旧 worktree 把 Python 找回来继续修改，也不能恢复 Python 后端。


## Agent skills

### Issue tracker

Spec 与工单是仓库内 Markdown（`docs/specs/`），不写 GitHub Issues。见 `docs/agents/issue-tracker.md`。

### Triage labels

五个默认分诊词，写在工单的 `Status:` 行。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文：`Agents.md` + `CONTEXT.md` + `docs/adr/` + `docs/kernel-rpc.md`。见 `docs/agents/domain.md`。

Development, tests and packaging are Python-free. Follow Agents.md; use npm ci with lifecycle scripts disabled and npm run build:native for the existing file-lock addon. Historical sources/captures are audit evidence only.
