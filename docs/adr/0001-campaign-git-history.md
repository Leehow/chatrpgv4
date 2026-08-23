# 0001. 以 per-finalize git commit 替代 commit-snapshots 目录复制

- Status: Accepted
- Date: 2026-08-23
- Track: `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`
- Spec: [docs/specs/campaign-git-history.md](../specs/campaign-git-history.md)

## Context

每次 `turn.finalize` 用 `copytree` 把 `save/` 复制到
`save/commit-snapshots/<finalization-id>/`。该机制无内容去重、无界增长、
无提交图；历史与 finalization receipt 只有目录名约定绑定。崩溃恢复因此没有
单一、可校验的读取路径。

## Decision

每个战役一个 sidecar bare repo（`.coc/repos/campaigns/<id>.git`，战役目录为
worktree，树内不放 `.git`）。`coc_git_history.py`（Commit Coordinator）是唯一
写者。`turn.finalize` 在全部 canonical 写入之后、交付之前同步提交；commit
失败 = finalize 失败（fail-closed）。崩溃恢复只走
`restore_save_subset`：checkout HEAD 上旧 copytree 捕获的 `save/` 子集，
不回滚幂等簿记，不整树 checkout。git 历史替代目录复制，成为唯一读取路径。

## Alternatives rejected

- **保留 copytree 双读。** 违反单事实源：两套历史会在崩溃窗口内分叉，恢复
  不知该信哪一份。
- **把 git 做成通用 Agent memory DB。** 越界。本切片只替换 turn 级战役历史
  与恢复；memory cards、belief、语义索引不进提交图。
- **异步 commit。** 引入「已结算未提交」窗口，与现行 copytree 的 fail-closed
  语义不对等，取证无法证明该回合已落盘。

## Consequences

- 无 rotation 压力：对象去重替代按回合整树复制。
- 崩溃恢复读取路径唯一；遗留 `save/commit-snapshots/` 不导入、不读取、不删除。
- 新增 git 二进制硬依赖：缺失则战役创建与 finalize 明确硬失败，无降级。
- 战报 state 完整性只消费结构化证明
  `coc_git_history_verify.state_integrity_proof(...).to_dict()`（`PASS` /
  `FAIL` / `NOT_PROVEN`）。导出器不再读取 `commit-snapshots`，也不把目录
  存在当作证明。后续 `COC-History-Reset` 使证明保持 `NOT_PROVEN`，不得
  升格为 `PASS`。
