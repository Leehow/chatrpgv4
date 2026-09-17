# Issue tracker: 仓库内 Markdown（docs/specs）

本仓库不把 spec 和工单写到 GitHub Issues；它们是仓库里的文件，随代码一起提交、一起评审。
远端 `Leehow/chatrpgv4` 的 Issues 只在用户明确要求时才写（历史上 #85–#91 是镜像，见
`docs/specs/session-maps-tickets.md`）。

## 约定

- 一个特性一份 spec：`docs/specs/<feature-slug>.md`，头部有 `Status:` 一行。
- 工单：`docs/specs/<feature-slug>-tickets.md`（小特性一个文件），或
  `docs/specs/<feature-slug>-tickets/NN-<slug>.md`（大特性一张一文件，从 `01` 编号）。
- 分诊状态写在每张工单开头的 `Status:` 行，词汇见 `triage-labels.md`。
- 评论与讨论历史追加在文件末尾 `## Comments` 之下。
- 落地后，契约变更写进 `docs/kernel-rpc.md` 新的 §节（编号只增不改，见 Agents.md），
  spec 里回链该节号。

## 当技能说「publish to the issue tracker」

在 `docs/specs/` 下新建（或更新）对应文件，并在当前分支提交。不要写远端。

## 当技能说「fetch the relevant ticket」

读用户给的路径；没给路径时按 slug 在 `docs/specs/` 下找。
