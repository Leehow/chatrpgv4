# 0001. 每回合一次同步 git 提交，sidecar 裸仓库是战役历史的唯一读取路径

- Status: Accepted（2026-08-23），v2 沿用（2026-09-05）
- Track: pi-coc v2

## Context

旧树曾用 `copytree` 把每次结算的 `save/` 复制成快照目录：无去重、无界增长、无提交图，历史与回合收据只靠目录名约定绑定，崩溃恢复没有单一可校验的读取路径。

## Decision

每个战役一个 sidecar 裸仓库（v2：`.coc/repos/<campaign_id>.git`），战役目录是它的工作树，树内不放 `.git`。内核是唯一写者：`table.narrate` 在全部 canonical 写入之后、交付之前**同步**提交（契约 §5 `narrate` 第 6 步）；提交失败即 `commit_failed`，回合保持打开、不递增（fail-closed）。崩溃恢复只读 `turn.json` 与续行检查点（契约 §12.2、§12.6），检查点是可重建的缓存，git 提交与回合记录才是真相。

## Alternatives rejected

- 保留目录复制双读：两套历史会在崩溃窗口内分叉，恢复不知该信哪一份。
- 把 git 做成通用记忆库：越界。记忆候选与断言另有存储（§12.3），只在提交后追加，不进提交图的语义。
- 异步提交：引入「已结算未提交」窗口，取证无法证明该回合已落盘。

## Consequences

- 对象去重替代按回合整树复制，没有 rotation 压力。
- git 是硬依赖：缺失则建战役与 `narrate` 明确硬失败，无降级。
- `recall history` 与续行检查点只从回合记录与 HEAD 出发，不读 git 对象（§12.4、§12.9）。
