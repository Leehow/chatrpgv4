# P1+P2 全量执行章程（Goal）

**Date:** 2026-07-09
**Status:** 已完成（2026-07-10；波次 3-5 全部落地并完成 commit 对账）
**Base spec:** `docs/superpowers/specs/2026-07-08-coc-defect-master-blueprint.md`（P1/P2 浓缩展开 + 勘误）

## 目标

把大蓝图里 P1（8 条）+ P2（4 真 + 2 勘误后真缺陷）全部修完，使 COC 插件在节奏、NPC、文字、UX、记录五个维度达到蓝图定的修复方向。

## 执行模式（用户授权：不要停下来问）

- **不用 AskUserQuestion 打断。** 所有方案/默认决策由我（controller）用 sensible default 拍板，**显式记录在该波次 plan 的"决策与默认"节**，事后用户可 review/推翻。
- **连续 SDD**：每波次一份 plan → 逐 Task dispatch implementer + task reviewer → 波次末 brief whole-branch review → 直接进下一波次，不汇报、不停顿。
- **停止条件（只有这些才停）**：
  1. 真 BLOCKER：plan 根本错误、或实现中暴露 plan 没预见的设计冲突无法自主解决。
  2. 需要不可逆/破坏性操作：删文件、改外部 API 契约、force push 等。
  3. 全部完成。
- **高风险项保守处理**：P2-6（主流程并行化）触及 live turn 同步主流程，风险高——我只做 flush 可靠性（ack/超时/健康检查），**不**强行并行化主流程的 director/enrichment/rules；该降级记录在 plan。
- **质量门不降（执行时）**：每 Task 仍 TDD + 独立 review + sync 门禁；final review 抓到的 Critical 必修。
- **当前维护说明（2026-07-10）**：以上 sync 门禁保留为历史执行证据；`e314156` 移除双轨后，当前对应门禁是 `test_plugin_metadata.py`，不得重建已删除的同步流程。

## 波次与 plan 文档

| 波次 | 范围 | plan 文档 |
|---|---|---|
| 波次 3 | NPC 根因集中修（P1-4/5/6 一体） | `docs/superpowers/plans/2026-07-09-coc-p1p2-npc.md` |
| 波次 4 | 节奏 + 文字（P1-1/2/3/7/8 + P2-2） | `docs/superpowers/plans/2026-07-09-coc-p1p2-pacing-prose.md` |
| 波次 5 | UX + 记录（P2-1/3'/4'/5/6/7） | `docs/superpowers/plans/2026-07-09-coc-p1p2-ux-logging.md` |

## 完成台账

原计划中的临时 `.superpowers/sdd/progress-p1p2.md` 未进入版本库，不再作为
durable 状态源。完成情况以三个波次 plan 顶部的“实现进度对账”块为准：

- 波次 3：`docs/superpowers/plans/2026-07-09-coc-p1p2-npc.md`
- 波次 4：`docs/superpowers/plans/2026-07-09-coc-p1p2-pacing-prose.md`
- 波次 5：`docs/superpowers/plans/2026-07-09-coc-p1p2-ux-logging.md`

总收口记录见
`docs/superpowers/specs/2026-07-08-coc-defect-master-blueprint.md` 的修订记录。

## 跨波次约束（沿用）

- Single-Track Law：只维护 `plugins/coc-keeper/`；立绘等宿主能力用 `CODEX_ONLY_IMAGEGEN` 门控。
- Semantic Matcher Constitution：结构化字段/枚举/带 reason 的语义输出，不扫自由文本。
- 测试门禁：每 Task 末至少跑 `test_plugin_metadata.py`。
