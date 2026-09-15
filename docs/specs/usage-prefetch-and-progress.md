# 用法预生成与准备进度

- 日期：2026-09-15
- 状态：规格草案；产品方向已获用户确认（选 1+3），实施遵循契约先行的审批边界
- 关联：`docs/kernel-rpc.md` §26（objects.usages.v1）、`docs/specs/action-derived-object-usages.md`、ADR 0005
- 实测证据：`.coc/campaigns/object-usages-live-sep15/`（turn 12 = 94 s，其中 creator 子进程 14.9 s；turn 13 复用 = 0 s）

## Problem Statement

真桌实测：玩家即兴用一件尚无用法记录的物件时，带工具的 creator 子进程约 15 秒，且发生在回合内——玩家在无声等待，之后骰子与叙事才一起回来。同一用法的第二次使用（turn 13）已经是 0 秒。

成功是：**物件在玩家动手之前就带着可用法档案**。预生成命中时，该回合不再启动 creator、玩家无可感等待，守秘人只是像复用任何已接受用法那样选中它；未命中时，那 15 秒等待在 TUI 与 Electron 两套界面都真实可见，而不是黑屏。

空心交付包括：后台任务没有真正接进「活动场景 + 持有物」的枚举；预生成写出的记录不进入既有复用路径（玩家照旧等 15 秒）；进度事件没有 TUI 消费者；用名称列表或正则判断「像不像武器」；把预生成做成第二套用法系统。

## Solution

复用现有 usage 任务、creator 契约与接受校验，只在两端各加一条路径：

1. **回合后预生成**：每个已提交回合之后，宿主按「活动场景 + 调查员/NPC 持有物」枚举物理实例，跳过已有用法记录的对象，为剩余对象串行发起「提出最可能攻击用法」的预生成任务（每回合有预算上限）。
2. **回合内可见进度**：当守秘人当回合确实要准备一个用法（预生成未命中的情况），现有的 `mods-progress` 通道带上用法语义，TUI 与 Electron 各自显示一行「正在准备用法」，结束即清除。

## Implementation Decisions

### D1 预生成写的是真 usage 记录

与动作触发的记录**同形状、同校验、同复用路径**；新增来源标记 `prefetched`（对比动作触发的 `job` 来源），使审计能区分，但不新开存储。守秘人选择用法、执行结算、物理依据校验的规则一个字不改。

### D2 预生成不是玩家动作

- 不产出玩家可见收据，不进 offer 账，不推进时钟，不消耗动作，不要求行动准入。
- 唯一证据是 telemetry 与 `.coc/mods/jobs/<key>/` 任务目录。
- 玩家从未说过的行动，不能在叙事或收据里出现。

### D3 任务身份需要预生成变体

现状：`kernel-ts/mods/jobs.ts` 把任务身份绑死在 `turn.turn` + `worldline`，非当回合 accept 会被拒绝。预生成任务改用不与回合绑定的键（阵营/世界线/对象物理依据/propose 标记），并走独立的接受入口。磁盘任务目录同时充当「已覆盖」标记：负结果（creator 判定没有合理攻击用法）同样落盘，不重复跑；对象物理依据变化后键变化，允许重跑。

### D4 creator 契约只加一个 propose 变体

同一 `role: "usage"`、同一 `result.json` 形状、同一校验。propose 时由 creator 依据对象物理事实提出**至多一个**最可能的攻击用法；没有合理用法就返回空。描述由 creator 写（那是能力描述，不是玩家原句）。不新增语义车道，不给模型名称列表。

### D5 扫描与预算

- 触发点：已提交回合之后（沿用宿主现有回合后钩子，见 `extensions/mods/index.ts` 的文档预热先例）。
- 范围：当前活动场景与调查员/NPC 持有的物理实例；已有任意用法记录的对象跳过。
- 预算：每回合串行最多 N 个（默认 2，0 关闭）；同键在途复用既有摘要去重，不重复生成。
- 预生成在玩家阅读/输入的间隙运行，从不阻塞玩家回合。

### D6 投影与不催促

预生成记录与动作记录走同一投影，守秘人能在选择用法时看到并复用它们。它们不得变成催促或推荐：offer 账行为不变，不给「你还没用过这件东西」之类的反馈。

### D7 新鲜度与失效沿用今天

使用时的 `physical_basis` 校验、条件变化后的失效、所有权与共享资源规则全部与今天一致；预生成不豁免任何检查。

### D8 进度：扩展现有通道，不新增总线

- `mods-progress` payload 增加用法语义（`role`、对象、done/total）；define 批次保持现有行为。
- Electron 等待行按 payload 显示；文案取自现有 ui-words 源（`content/ui/en/`），不在代码里新增硬编码语言表。
- TUI 在回合内准备期间用 `ctx.ui.setStatus('coc-mods', …)` 显示一行，结束清除。
- 回合后的预生成**静默**（telemetry 留证），不打扰玩家。

### D9 契约先行

先把以上形状写进 `docs/kernel-rpc.md` §26（新 provenance、预生成生命周期、谁写/谁读/谁据它行动、预算与静默失败），再改代码；worker 只按契约写，形状对不上以契约为准。

## Testing Decisions

- 内核：预生成记录的接受、复用、物理依据失效、世界线保存/分叉、provenance 区分、无收据/无 offer/不推进时钟；动作触发路径行为不回归。
- 宿主：扫描范围与预算、串行、去重（同键不重复跑）、负结果覆盖、失败静默、进度事件在 define 与 usage 两种批次下的 payload。
- 界面：TUI 状态行出现与清除；Electron 等待行按 payload 显示且文案来自 ui-words。
- 真桌（唯一方法，`tests/play/driver.py` RPC 模式 + Grok 守秘人 + 本主会话唯一玩家）：
  - 预生成命中：抄起已预生成对象攻击，该回合**没有** creator 运行、无可感等待；
  - 未命中：对未准备对象即兴攻击，等待期间两套界面可见「正在准备用法」；
  - 记录两回合耗时与 `run-*.json` 有无，证据留在 `.coc/`。

## Out of Scope

- 不做跨物品、跨战役的语义缓存或全局档案库。
- 不用名称列表/正则判断物件是否「像武器」；可用性判断留给 creator 与守秘人。
- 不改模型选择与思考档，不做第二套 Keeper 或战斗执行器。
- 不重跑或迁移历史战役；不打包、不安装 App。

## Slices

| 切片 | 前置 | 交付与验收 |
| --- | --- | --- |
| `prefetch-contract` | 无 | 契约 §26 更新 + 内核预生成任务身份/接受路径/来源标记/无收据 + 内核与扩展回归 |
| `prefetch-host` | `prefetch-contract` | 回合后扫描、预算、串行、去重、负结果覆盖、失败静默、telemetry + 扩展测试 |
| `prep-progress` | 无 | `mods-progress` payload、Electron 文案走 ui-words、TUI 状态行 + 界面测试 |
| `prefetch-live` | `prefetch-host`、`prep-progress` | 真桌验收（命中无感、未命中可见）与耗时对比，证据保留 |

## 真桌验收记录（2026-09-15）

方法：`tests/play/driver.py` RPC 模式，Grok 当守秘人（`xai/grok-4.5`），本主会话当唯一玩家，一次一句自然输入。战役 `usage-prefetch-live-sep15`（《鬼屋》），玩测目录 `.coc/playtests/prefetch-setup-sep15`、`prefetch-play-sep15`（修复前）、`prefetch-play2-sep15`、`prefetch-play3-sep15`。

### 真桌抓到的缺陷（修复前 → 修复后）

| 现象 | 根因 | 处置 |
| --- | --- | --- |
| 回合提交后**零** propose 任务、零 `usage-prefetch` 遥测（19 个单测全绿） | 就绪守卫要求 `targets.turn === 提交回合号`，而内核在 narrate 提交的同一刻已把保留回合推进到 N+1（`turn.json` `{turn: 2, state: awaiting_player}`、载荷 `turn: 1`） | 守卫改为「空闲 + 同一世界线 + `view.turn >= 触发回合`」；测试桩改成内核真实时序，新增回归（旧代码下必红）；补齐扫描汇总遥测，使「无事发生」也可观测 |

### 修复后：预生成确实运行

同一战役 10 个已提交回合产生 8 次扫描（`lane: usage-prefetch, event: scan`），积压从 10 个候选排到 0：

| 提交回合 | 候选 | 发起 | 跳过（已有用法 / 已覆盖） | 保留回合 |
| --- | --- | --- | --- | --- |
| 2 | 10 | 2 | 0 / 0 | 3 |
| 3 | 8 | 2 | 1 / 1 | 4 |
| 4 | 6 | 2 | 2 / 2 | 5 |
| 5 | 5 | 2 | 3 / 3 | 6 |
| 7 | 3 | 3 | 4 / 4 | 8 |
| 8–10 | 0 | 0 | 5 / 6 → 6 / 6 | 9–11 |

共 11 次生成：6 次判定「无合理攻击用法」（负结果，落盘不重跑）、5 次登记用法档案（全部 `provenance.prefetched: true`）。全程无收据、无 offer、时钟只随玩家行动推进。

### 命中：预生成对象被即兴使用，零 creator

`主卧弯火钳`（object-item-11）在回合 7 的扫描中取得档案 `弯火钳砸击`。回合 8 玩家抡它砸床：该回合窗口（13:19:20–13:21:11Z）内 **没有任何 `run-*.json` 写入**，receipts 只含 `move/time/roll/clue`，攻击直接复用已接受档案；回合耗时 106.9 s（对照：上一战役同性质的即兴攻击含 14.9 s creator 的回合为 94 s）。

### 未命中：现场生成的等待与可见进度

回合 10 玩家在同一回合内让 `缺腿木椅` 物化并抡砸：内联 creator `run-1.json ms=48371`（**48.4 s**），provenance 无 `prefetched`（动作触发）。同期 UI 事件流记录：

```
13:25:24.936  extension_ui_request  setStatus  coc-mods  "Preparing usage: 缺腿木椅 0/1"
13:26:14.274  extension_ui_request  setStatus  coc-mods  (清除)
```

### 边界与限制

- 该局为排空积压，有一次会话用产品自带开关 `PI_COC_MOD_PREFETCH_LIMIT=6` 运行；默认值仍为 2。
- Electron 等待行与 TUI 状态行共用同一 payload，其渲染由 `Electron/packages/ui/src/App.waiting.test.tsx`（12 项）与 `tests/extension/mods-progress.test.mjs` 覆盖；本局是 RPC 模式，故现场证据来自 `extension_ui_request` 流。
- 预生成的用法档案不会出现在任何回合收据里（已核对：预生成 usage id 不出现在 `turns/*.json`）。
