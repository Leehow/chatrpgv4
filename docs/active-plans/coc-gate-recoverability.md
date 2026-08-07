# 开场闸门的可恢复性(Gate Recoverability)

**Work ID:** `coc-gate-recoverability`
**状态:** `In Progress` — 6 个卡点已修 5 个,设计已成型,全局排查未开始
**最后更新:** 2026-08-06
**轨道:** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`(共享内核改动已获用户逐项授权)

---

## 一句话

KP 是 ReAct agent,但 hard gate 把它的**观察、动作、可逆性**三样同时削掉了,
于是它一撞墙就空转;每次修好一堵,换条路径又长出新的一堵。

---

## 二、这次实测拿到的事实

两条独立路径,结论不同,**不要混为一谈**(第一版报告混了,已更正)。

### 路径 A — `vfy2` / 归于尘埃(存量脏局,跑过很多轮)

修掉 5 个卡点后**跑通了**:开场叙述 + 真实判定落盘。

```
【开场时间】1925-01-15 20:00
林致远站在马丁滩的碎石岸边。冷风从大西洋面上刮来,带着盐腥与腐藻气味……

【明骰】侦查｜掷骰:62;基础值:50;门槛:普通(≤50);达到:失败;未通过
```

证据:`opening_projection_watch.status: complete`;`partial_opening` job
`fulfilled`;场景 `martins-beach` 由 `toc_only` 升到 `partial`;
`logs/rolls.jsonl` 有 Spot Hidden 失败与建卡 3D6。

### 路径 B — 褴褛之王(从零干净局,42 页)

**前半段全通,建卡死。** 路径 A 修的 5 个,这里**一个都没触发**。

| 环节 | 结果 | 实测 |
|---|---|---|
| PDF 导入 / asset root | ✅ | sha256 `dbecb79…`,标题「褴褛之王」 |
| pdf skill 快速解析 | ✅ | outline 78 个标题候选,`confidence: exact` |
| OCR 全书 | ✅ | **42/42 页,28.8 秒**,引擎 `baiduocr` |
| OCR 文本质量 | ✅ 良好 | 各页 149–5280 字(中位 4004);瑕疵:偶发替换字符 `《哈姆莱特�` |
| bind / register_source_bundle | ✅ | `full_parse: fulfilled` |
| 全书分章节入队 | ✅ | `classify_sections`,42 indices |
| **建卡** | ❌ **阻塞** | `setup_failed` × 15,调查员始终未落盘 |
| 开场 / 跑团 | ⛔ 未到达 | — |

### 顺带验证:传输预算缺陷是系统性的,不是偶发

| | 归于尘埃(23 页) | 褴褛之王(42 页) |
|---|---|---|
| `classify_sections` 体积 | 19569 | **24779** |
| 传输预算 | 16384 | 16384 |
| candidates | 42 个 | **78 个(18731 字节,占 76%)** |

**书越大超得越多。** 没有 spill 修复,任何中等以上模组的全书分章节都会整批作废。
但**注意**:路径 B 里它停在 `awaiting_cache` 从未被 claim,所以 spill 代码这次
**没有执行**,这条线仍未走到验证点。

---

## 三、遇到的 6 个问题

前 5 个来自路径 A,第 6 个来自路径 B。

### 1. 报错说谎:能力开着却报"不可用"

`index.ts:5682` 在管理器已持有 dispatch key 时返回裸 `null`(每次重试后的正常
状态),调用方一律映射成 `coordinator_capability_unavailable`——而
`piCoordinatorEnabled()` 实测返回 **true**。

**已修**:`coordinatorDispatchNullReason` 读管理器,报真实终态与诊断码。

### 2. claim 超传输预算,整批作废

`classify_sections` 体积 > 16 KiB,`coc_mcp_wire` 用
`_claim_projection_failure` 替换整个结果,**两个租约一起作废**。

**已修**:`_spill_structure_requests` 把大块换成"工作区相对路径 + 摘要",
`runtime.inflateSpilledStructureRequests` 在 `validateLeafTask` 前读回并校验摘要,
worker 无感知。摘要漂移 / 路径逃逸 / payload 与 ref 并存,三种情况 fail-closed。

**教训**:第一版只遍历 `dispatch_tasks`,fixture 测试全绿,**对真实路径零作用**
(真实返回的是 `packets`)。是真实探测抓出来的,不是测试。

### 3. 会话一死,开场永久卡住

`opening_projection_watch` 持久化在 campaign 里,但清除它的 coordinator
**随会话生死**。会话中断 → watch 永远 `pending` → `next_operation: null` →
KP 被告知"等待一个永远不会来的事件"。

实测:KP 连续三个玩家回合回空消息——**它没错,它被明确要求等待**。

**已修**:`_opening_watch_resolver_lost`(超 900 秒且无租约)→ 发
`source_lifecycle_status: resolver_lost` + 一张 `progressive.opening_bootstrap`
重来卡。

### 4. 重试额度被无关故障烧光

`dispatch_attempts` 在 **claim 时** +1(不是失败时),上限 2。一个投影 bug 或一次
会话中断就烧掉一格,烧完报一句含糊的 `takeover_unavailable`,**无解**。

**已修**:宿主侧原因的优雅释放**退还**额度
(`claim_projection_invalid` / `coordinator_shutdown` / `coordinator_aborted` /
`turn_pending_finalization`);内容失败仍照扣;崩溃走 TTL 也照扣。
触顶报错改为点名上限与具体 `job_ids`。

### 5. 恢复卡片被中间层吞掉(同一 bug 的三种形态)

canonical 层发出恢复卡 → pi 侧 `projectStartupSourceMaterialization` 再投影 →
白名单没同步 → **卡片被丢,KP 拿到空 details**。

`complete` 那个分支是**早就存在的代码**,之前没人撞到,只因为开场从来没成功过。

**已修**:改成通用转发——任何非 `pending` 且携带合法恢复操作的状态一律转发,
并原样透传 canonical 的 `instruction`,不再逐个白名单状态值。

### 6. 年代在读模组之前被定死(路径 B,未修)

```
17:03:45  campaign 创建,KP 声明 era=1920s   ← 此时还没读模组
17:13:03  才 OCR 完,发现是伊丽莎白时代伦敦
→ setup_failed: era is already established as '1920s';
  refusing to overwrite it with 'early_modern'
```

`era_source: declared` —— **KP 主动声明的**,不是系统默认。契约本身写得对
(`an omitted era stays unestablished rather than defaulting`),KP 本可省略,
但它按 COC 惯性先填了 1920s。一旦确立,clean-slate 拒绝覆盖,**无修正入口**。

**注意**:这个报错**说得很清楚**,不属于"沉默拒绝"。它坏在**顺序**和**无退路**。

实测自愈:KP 试了两轮,第一轮**完全空转**(不调任何工具),第二轮撞回 opening
gate。**自愈率 0。**

---

## 四、根因:ReAct 被架空

pi 是 ReAct agent。ReAct 能自愈,依赖三个前提,这套设计把三样都削了:

| ReAct 要素 | 被什么削掉 | 后果 |
|---|---|---|
| **Observation**(看得见) | 拒绝不说字段;`payload_projected` 说谎;卡片被再投影吞掉 | 推理基于假信息,越努力越偏 |
| **Act**(动得了) | `openingSetupToolError` 在**执行前**拦截,只放行 `allowed_actions` 白名单 | Reason 完发现无动作可选 → 空转 |
| **可逆性** | era 等字段一旦写入即不可改(clean-slate) | 连"重试"这个概念都不存在 |

**活证据**:路径 B 第一轮,KP 调了 `coc_discover` **96 次**、试了 100+ 个操作名,
其中大量是它自编的(`progressive.setup_character`、`progressive.materialize_character`
…全部 `unknown_tool`)。**那就是 ReAct 在黑暗里疯狂探索**;撞不动之后才变成空转。

hard gate 的初衷是对的(防 KP 瞎编剧情、跳过源证据)。但实现方式是
**把动作空间收缩到唯一一条正确路径**,代价是把自愈能力一起关掉了——而对齐要求
又极高(`exactKeysMatch` 精确键集、闭合白名单、精确 payload 形状)。

**贯穿 6 个问题的唯一共同点:没有退路。** 不管报错清不清楚,撞上就是死。

---

## 五、修复设计

### 原则 1 — 拒绝 = 诊断 + 出路,缺一即 bug

所有 gate 拒绝走同一构造器,强制三字段:

```
failed_fields   哪些字段不满足 + 期望的字面量(字段名与 schema 常量,绝不含源文本)
next_operation  一张可执行的卡片(永不为 null)
reason          为什么
```

**防漂移机制**:判定与诊断**共用一个函数**——predicate 返回 failures 列表,
空列表即通过。样板已存在:`investigatorCreatePayloadFailures`,布尔判定是
`failures.length === 0`,所以文案不可能与校验逻辑脱节。

### 原则 2 — `next_operation: null` 一律视为 bug

| 情况 | 应给的卡 |
|---|---|
| 后台真在跑 | 查进度的操作(而非 null) |
| 资源/额度耗尽 | 显式恢复操作 |
| owner 已死 | 重新触发的卡(见问题 3) |

### 原则 3 — 不可逆字段必须等事实到位

- `campaign.create` **不接受** era
- era 只能由 `setup.adopt_source_facts` 从源证据确立
- 未确立时,依赖 era 的操作返回 blocked + 卡片
- 同类字段需一并排查:`ruleset_id`、`play_language`、`start_clock`

### 原则 4 — 同一契约只判一次

pi 侧再投影只做**结构完整性检查**(有没有合法卡片),**不白名单状态值**。
样板:`projectStartupSourceMaterialization` 已改为通用转发。

---

## 六、落地顺序

**第 0 步(建议先做)— 先量化,别急着改。** 全局扫描产出清单:

- 有多少处可能产生 `blocked + next_operation: null`
- 有多少处拒绝不带字段名
- 有多少处 pi 侧重复实现了 canonical 的校验

**没有这张清单,不知道还剩几堵墙,也就无法判断这事还要多久。**
这正是"搞了一个月还没搞定"的结构性原因之一。

**第 1 步** — 把不变量写成测试,让现存的墙全部变红,而不是等真跑撞上。
**第 2 步** — 统一拒绝构造器,按清单逐个迁移。
**第 3 步** — era 类顺序防呆。
**第 4 步** — 消重复校验层。

---

## 七、验证标准

**不能再信 fixture 测试。** 实证:661 个测试全绿时,第一版 spill 修复是死代码,
对真实死锁零作用。

两条硬指标:

1. **从零到底跑通一次** — 新模组 + 新 campaign + 真实 OCR → 开场 → 跑团。
   路径 B 已很接近(PDF→OCR→bind 全通)。
2. **KP 自愈率** — 遇拒绝后 KP 在 3 轮内自行纠正成功的比例。
   **这是直接度量设计目标的指标**;自愈率上不去,说明 gate 仍在"禁止"而非
   "纠正",改了也白改。**当前基线:era 场景自愈率 0(两轮全空转)。**

---

## 八、当前代码状态

分支 `0.5.1a`(主 checkout),**11 个文件已改、全部未提交,git 历史未触碰**
(HEAD 仍为 `c92f085`)。

```
docs/status/section-index-handoff.md
plugins/coc-keeper/pi/extensions/index.ts
plugins/coc-keeper/pi/lib/runtime.ts
plugins/coc-keeper/scripts/coc_mcp_wire.py
plugins/coc-keeper/scripts/coc_module_assets.py
plugins/coc-keeper/scripts/coc_toolbox.py
tests/pi/auto-dispatch-smoke.mjs
tests/pi/guided-character-contract-smoke.mjs
tests/pi/structural-repair.mjs
tests/test_module_queue_worker.py
tests/test_toolbox.py
```

测试:662 通过。已知 flake `test_pi_auto_dispatch_uses_named_paths_and_bounded_pending_queues`
(全量跑挂过一次,单跑通过,连跑三次全绿;与 `pytest-randomly` 顺序问题吻合,
**但仅一次复现,无法证明与本次改动无关**)。

运行产物(不在 git 内,按法则均未删除):
`.coc/module-assets/king-of-shreds-and-patches/`(42 页 OCR)、
`.coc/campaigns/king-of-shreds-and-patches/`(era 卡住那局)、
`.coc/campaigns/vfy2/`(已推进到掷骰)。

---

## 九、未解决与存疑

1. **全书分章节仍未产出。** 两条路径都没走到 `section-index.json`。
   路径 A 的 `classify_sections` 被 claim 后回 `coordinator_partial`;
   路径 B 停在 `awaiting_cache` 未被 claim。
2. **`fulfill_rejected` 的具体原因带不出来。** `runtime.ts` 的 catch 曾整个丢弃
   canonical 错误;已补记诊断,但 `validation_path` 是**闭合白名单**,动态
   error code 塞不进去,所以只能记"被 fulfill 拒了",**不知哪条规则**。
   要带出来需扩展诊断契约结构。
3. **Grok 作为 coordinator 的能力本身存疑。** `host-capabilities.json` 自己记着
   `coc_source_coordinator_v1_grok_evidence: failed_nonpromoting_host_experience_probe`。
   这早于本次工作。
4. **`campaign.status` 停在 `setup`、`active_scene_id` 为 `None`**,尽管叙述与
   判定正常流转。未诊断,未阻塞游玩。
