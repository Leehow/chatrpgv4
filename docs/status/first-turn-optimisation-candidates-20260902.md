# 首回合还能优化什么 — 2026-09-02（测量，非提案实施）

前提：普通回合 36–83 秒，对 180 秒预算余量很大（见
`turn-budget-where-the-time-goes-20260902.md`）。**唯一超预算的是每个会话的第一个
回合：147–268 秒。** 本文只讨论那一个。

## 首回合与普通回合逐项相减（r51 + r52，各 6 个回合）

模型时间，按「这次调用之后到下次调用之前」归属：

| 操作 | 首回合次数/秒 | 普通回合次数/秒 | 差 |
| --- | --- | --- | --- |
| `rules.settle` | 6.2 / 37.9s | 1.0 / 7.1s | +30.8s |
| **`discover`** | **2.7 / 31.8s** | 0.2 / 3.7s | **+28.1s** |
| **`turn.output_context`** | **1.0 / 30.2s** | **1.0 / 13.4s** | **+16.8s** |
| `rules.context` | 4.3 / 24.7s | 1.7 / 7.3s | +17.4s |
| `npc.query` | 1.0 / 10.9s | 0.2 / 1.7s | +9.2s |
| `session.resume` | 1.0 / 7.3s | — | +7.3s |
| `read` | 4.2 / 5.7s | 0.0 / 0.0s | +5.7s |
| **合计模型时间** | **179s** | **48s** | **+131s** |

`rules.settle` 和 `rules.context` 的差额是**真实的规则活**（首回合处在预置的对峙里，
结算 6.2 次对 1.0 次），不算浪费。

## 候选一：`discover` 是纯开销，28 秒/首回合

`PLAY_ACTING_BASELINE` 只有六个操作：

```
scene.context, actions.list, rules.context, rules.settle, npc.query, state.journal
```

其余操作要用就得先 `coc_discover` 一次（每次约 11.8 秒，并且**这正是 replan 的
触发点之一**）。6 个首回合里查了 16 次：

| 次数 | 操作 |
| --- | --- |
| **5** | `state.record_clue` |
| **4** | `state.move_scene` |
| 1 各 | `combat.resolve` / `combat.context` / `sanity.execute` / `sanity.context` / `state.npc_presence` / `state.exceptional_effect` / **`rules.settle`** |

两点值得注意：

1. **`state.record_clue` 出现在 6 个首回合里的 5 个**，而提示词把它列为**强制**
   （「线索不写 `state.record_clue` 就不算发现」）。一个每回合几乎必用、且被规则
   强制的写操作，却不在基线里，每次要花一次 discover 往返。`state.move_scene`
   同理，4/6。这两个合计 9/16 次 discover ≈ **每首回合 17.7 秒**，外加各自的 replan。
2. **`rules.settle` 被查了一次**——它本来就在基线里。这一次是模型多余的动作，属于
   提示词可澄清的部分。

**预算有余量**：acting 阶段实测活动工具 **9 个，上限 20**（`WORKING_SET_TOOL_BUDGET`），
schema 17,559 字节，没有独立的字节上限。加两个操作到 11 个，仍有余量。

**但这是产品策略，不是纯优化。** 现行设计明确写着「No fixed pipeline, no quota:
load only when semantically relevant」，把写操作挡在显式加载之后是有意的。把
`state.record_clue` / `state.move_scene` 放进基线，等于让 KP 随时可以写线索和移动
场景而无需显式加载——**该由产品负责人拍板，不该由我单方面放宽。**

## 候选二：同一次调用，首回合贵一倍

`turn.output_context` 首回合 30.2 秒、普通回合 13.4 秒——**同样一次调用，同一条
义务链**。差额 16.8 秒最可能的解释是上下文体量：首回合把 35–75K 字符的技能文档
读进了上下文，其后每一次生成都要处理更多输入。

这条与候选三同源。

## 候选三：会话启动的技能加载

提示词第 20 行要求「at session start, load each active skill's full `SKILL.md`」。
实测每会话 35–75K 字符（`coc-keeper-play` 单个 38,684 字符），**普通回合读取次数
为 0**，确认是一次性的。

读取本身便宜（回合内 0–16 秒），贵的是它留在上下文里的体量——见候选二。

可考虑的方向（都需要产品判断）：把回合中真正需要的部分前置进系统提示词（现已
56,059 字节），或让技能按需分段加载而不是整篇。

## 不建议动的

**replan 机制**。普通回合固定 3–4 次，全部在义务链上（`state.journal` /
`turn.output_context` / `turn.finalize`），但普通回合总共才 36–83 秒。为一个已经
达标的指标去改 pi 扩展的工具注册策略，是当前风险最高、收益最不确定的一项。

**规则层执行速度**。占一条 lane 的 3%。
