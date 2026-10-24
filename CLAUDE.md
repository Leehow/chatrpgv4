# Claude Code 项目入口

先完整阅读并遵守根目录 [Agents.md](Agents.md)；它是本项目唯一的完整规则源，本文件只强调最容易走错的重构边界。

**改模组解析（PDF 读取、索引、查书、释放、cast、地图等任何读书通道）之前，先读 [docs/design/module-parser.md](docs/design/module-parser.md)，改完更新它。**

**Python 内核已退役，当前生产内核只维护 `kernel-ts/`。** 旧 Python 文件找不到是预期状态：按当前 RPC 契约定位 TS 实现，不能去历史 Git、旧分支或旧 worktree 把 Python 找回来继续修改，也不能恢复 Python 后端。


## Agent skills

### Issue tracker

Spec 与工单是仓库内 Markdown（`docs/specs/`），不写 GitHub Issues。见 `docs/agents/issue-tracker.md`。

### Triage labels

五个默认分诊词，写在工单的 `Status:` 行。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文：`Agents.md` + `CONTEXT.md` + `docs/adr/` + `docs/kernel-rpc.md`。见 `docs/agents/domain.md`。

Development, tests and packaging are Python-free. Follow Agents.md; use npm ci with lifecycle scripts disabled and npm run build:native for the existing file-lock addon. Historical sources/captures are audit evidence only.

## 实测时每一轮都要看工具错误和 thinking（用户 2026-10-24）

真桌或 app 实测时，**每一轮**都要检查：

- 这一轮有没有工具错误或被拒绝的调用（界面上的"N 失败"、技术细节、turn 记录里的 failures/refusals）。有就记下是哪个工具、拒绝理由、最后有没有恢复。
- thinking 长度。任何一段 thinking 超过约 1k token（中文约 1500 字，英文约 4000 字符）时，必须打开看它在想什么，并记录：是哪个角色（KP、作者、读书或其他 lane），在纠结什么（协议怎么填、价格、物品登记、规则判断……），为什么会纠结（指引含糊、schema 不够用、被拒后重试……）。
- 不能只报"跑完了"。这两项要写进实测报告，大段 thinking 的成因要作为问题修或上报。
