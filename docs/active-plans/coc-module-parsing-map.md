# 模组解析与衔接：单一管理文档（pi-coc）

> 维护入口。一句话：**模组解析 = 内容寻址的 progressive 资产库 + 队列/host-work 编排树**。仓库永不打开 PDF；权威逻辑全在 canonical Python，Pi 侧只编排/适配。
> 快照：2026-08-07。由 `module-parse-map-a/b` + `parse-audit` 三路只读调研合成，file:line 均已核实。

---

## 0. 先看：为什么鬼屋能跑、新模组会卡

- **内置 starter（The Haunting 等）= 冷编译 IR**，不经过 PDF 解析 → KP 强、不卡。
- **自带 PDF 模组（褴褛之王）= raw-PDF 路径**：PDF→bundle→OCR→分章→实体→衔接。**短板全在这条链的后半段**（分章 fulfill、附录、全场衔接），不是 KP 弱。

---

## 1. 怎么解析的（链路）

### A. 开场车道（1–3 页，阻塞）— 🟢 已实现并实测打通
PDF 窗口 → 宿主 pdf skill 出 bundle → `bind_pdf` → `register_source_bundle` → pages 落盘 → `opening-source-review` → `adopt_source_facts` → `prepare_opening`/`opening_bootstrap` → `publish_skeleton` + `partial_opening` host-work → coordinator 认领 → leaf 抽 → 开场出来。（shreds-e2e-r2 实测：spawn→claim→fulfill，开场叙述落地。）

### B. 全书车道（S1 full_parse → 分章 → 抽实体）— 🟡 半通
bind → enqueue `full_parse`（queue_worker 跑 baiduocr）→ `ocr-corpus` → pages → `full-parse.json: complete` → enqueue `classify_sections` → `outline.json`（无类型）+ classification_request → fulfill → `section-index.json` →（按需）`extract_section` → sections/。
**full_parse 跑通；classify 代码在但 live 从未 fulfill → 没有 section-index → extract 无从下手。这是全场结构化命门。**

### 编排树
```
主 KP（index.ts）— 不直接 claim/fulfill
  └ autoDispatchCoordinator（background_takeover 触发，fire-and-forget）
     → CoordinatorDispatchManager（内存：1 active + pending≤4）
        → coordinator 子 pi（单工具，claim→leaf 池→fulfill）
           → leaf 子 pi（0 工具，读注入页）→ source-pack-worker JSON
              → fulfill → put_entity/section → 投影进 campaign IR → scene.context
```
常量：`MAX_LEAVES=32`、`LEAF_POOL_SIZE=8`、`MAX_PENDING=4`、`MAX_ATTEMPTS=2`（`runtime.ts:18-31`）。

### 租约/重试（防死锁）
claim `attempts+=1`；renew 120s/600s；release 命中 host-side reason（claim_projection_invalid/coordinator_shutdown/coordinator_aborted/turn_pending_finalization）**退 attempts**；进程死**不**重派（终态）；TTL 不退。物化死锁已修（9ee0b9c：pending 不再 null；从未被领 150s 判 dispatch_lost）。

### 实体（ENTITY_KINDS）
`location, npc, item, clue, handout, threat`（mechanics 仅 npc/item/threat）。**没有 appendix/spell/pregen/keeper_background**。未知 kind 拒绝；非 6 种 mention drop。

### KP 衔接
leaf→fulfill→put_entity→campaign IR（skeleton→sparse scenes/npcs）→ **scene.context**（玩家安全摘要 + source_material.keeper_only）→ KP 语义采用。KP **能看** scene.context/进度卡；**不能看** claim/fulfill（private）、未 earn 的模组真相、leaf 原文。

---

## 2. 管理面：你那五个问题，逐个答

### 2.1 哪些实现了 / 没实现（三色）

🟢 已实现｜🟡 代码在但未接满/未跑通｜🔴 残留或从未实现

| 能力 | 状态 |
|---|---|
| host bundle 校验/bind/page cache | 🟢 |
| sha lookup + 跨 producer 页复用（fb514c0） | 🟢 |
| full_parse baiduocr + requests 探针（fb514c0） | 🟢 |
| opening review + adopt_source_facts | 🟢 |
| prepare/bootstrap/publish_skeleton/partial_opening | 🟢 |
| 三层编排树 + spawn/PG terminate | 🟢 |
| claim/fulfill/renew/release + host-side attempt 退还 | 🟢 |
| 开场物化（9ee0b9c 修复后实测打通） | 🟢 |
| 6 ENTITY_KINDS + put_entity | 🟢 |
| scene.context ← 解析产物（开场衔接） | 🟢 |
| outline.json（确定性，无类型） | 🟢 |
| classify_sections 代码路径 | 🟡 代码在，**live 从未 fulfill**（无 section-index.json） |
| extract_section 端到端 | 🔴 **无人 enqueue**（见 2.2） |
| 富 skeleton 桶（finale/handouts…） | 🟡 校验可选；live 是否 worker 填未证 |
| pdf-skill full_parse batch | 🔴 残留代码，主路径退役（见 2.4） |
| 附录 locator 自动生产 / appendix·spell·keeper_background W3 fan-out | 🔴 从未实现 |
| opening-source-coordinator 原生 Pi adapter | 🔴 从未按该 JSON 接上（用旁路替代） |
| parent_flat_fanout (Pi) | 🔴 有意关闭（pi=false） |
| 仓库内 PDF parser | 🔴 项目法禁止，从未实现 |

### 2.2 孤儿：造了但没人消费

| 项 | 证据 | 判定 |
|---|---|---|
| `extract_section` | JOB_KINDS 在（`assets.py:49`），fulfill 分支在，但**全仓无 enqueue 点** | 🔴 有契约无需求方——classify 即使 fulfill 也没人触发 extract |
| `reconcile_sections` | `reconcile.py:37` 有 kind，**不在 JOB_KINDS**，仅测试 | 🔴 从未进队列 |
| `mentions-index.json` | `assets.py:2295` 创建 + `_record_mention` 写；**无 read API / 投影引用** | 🔴 写后无消费 |
| `handouts/` 目录 | `assets.py:2226` mkdir；handout 实体实际写 `entities/handout-*.json` | 🔴 空壳目录 |
| `ensure_stub`（job kind） | 在 JOB_KINDS（`assets.py:48`）但无 `kind=ensure_stub` 入队；函数本身被调 | 🟡 kind 名存实亡 |
| `classification_request_chunks` | `queue_worker.py:1869` 只写；无读者 | 🔴 孤儿字段 |
| `full_parse_dispatch` 转发槽 | `toolbox.py:12509`；测试断言已不在 projection（`test_module_queue_worker.py:3691`）；index.ts 仍监听（`6192,7570`） | 🔴 生产者已撤、消费者残（死链路） |
| `autoDispatchPiFullParse` | `index.ts:6302,7570` | 🔴 死链路 |
| host-outline.json | outline_store 优先读（`65-67`）但无生产入口（仅测） | 🟡 可选输入，默认走 cached_pages/OCR |

> ledger 旧线索 `read_psychology_concealed`/`end_day`/`combined_roll_rule` 经核实**不在模组解析范围**，不列入。

### 2.3 重复 / 功能重叠

| 对 | 说明 | 主路径 | 标签 |
|---|---|---|---|
| full_parse 渲染 | queue_worker baiduocr（`queue_worker.py:8-14,2047`）vs pdf-skill batch（`adapter.py:1280,1427` + `autoDispatchPiFullParse`） | **baiduocr** | 重复+退役残留 |
| **deepen vs full_parse（双轨未收敛）** | S3 设计要拆 deepen（`steward-redesign:46,68-72`），但 `on_enter_scene`/dig 仍 enqueue `deepen_*`（`project.py:4142,4898`） | **双轨并行**：全书 OCR + 按实体 deepen | ⚠️ **别误写"deepen 已退役"——它仍是进场景/dig 主深化路径** |
| register 双入口 | `bind_pdf`→register（`runtime_ops.py:4983`）vs tool `progressive.register_source_bundle`（`toolbox.py:15905`）——**同一函数** `assets.py:3835` | 同核双调用面 | 重叠入口·非 bug |
| 双 registry | module-assets/registry.json（progressive 缓存根）vs module-library/registry.json（冷编译 IR 库，`coc_module_registry.py`） | 有意分层（raw vs 冷编译） | 并行概念·易混名 |
| locator 两职责 | pdf-adapter `--run`（raw-PDF 首包 bootstrap）vs `locate_mechanics_index` job（力学索引） | 开场 bundle ≠ 力学 locator | 同词两义 |
| opening coordinator | 契约 `opening-source-coordinator-v1.json`（Codex 主）vs Pi opening-review 旁路 | Pi 不用该 agent | 主机分叉 |

### 2.4 契约 vs 运行时冲突（文档/文案债）

| 冲突 | 契约/文案 | 代码实际 |
|---|---|---|
| leaf 上限 | `source-coordinator-v1.json:94` limit_maximum:**4**；claim 描述 "up to four"（`toolbox.py:15934`） | `MAX_LEAVES=32`（`runtime.ts:18`、`assets.py:56`、`toolbox.py:11615`） |
| same_task_retry | worker pi `false`（`source-pack-worker-v1.json:914`） | coordinator pi_private `true`（`source-coordinator-v1.json:333`，runtime 执行） |
| pack-worker pi | `status:unavailable`/`end_to_end_lifecycle_proven:false` | 实际 leaf 经 private lifecycle 在跑；coordinator experimental+probe |
| heartbeat | README "pending"（`pi/README.md:307`） | 已实现 renew（`runtime.ts:30,2483`） |
| handoff leaves | `section-index-handoff.md:533` "cap at 4" | 现为 32 |
| full_parse fulfill pack | `_fulfill_full_parse_host_work` 仍在（`toolbox.py:16594`） | 投影不再发 full_parse_dispatch（死 API） |

### 2.5 退役残留 / 设计未做

**退役残留（主路径已换，旧码仍在）**：
| 残留 | 能否删 |
|---|---|
| pdf-skill full_parse batch + `autoDispatchPiFullParse` + `full_parse_dispatch` 槽 | ✅ **可安全删**（保留 opening-review 与 raw-bind `--run`） |
| deepen 全套 | ❌ **不可贸然删**——S1 未替代实体包，仍是现网深化主路径（双轨未收敛） |
| scope locator 动态 preflight | ❌ `--run` bootstrap 仍在用；可删的是"中途 scope 再定位"op |
| claim "four"/limit:4 文案 | ✅ 改文案/契约即可 |

**设计未做（plan 里有，代码没有）**：appendix locator 自动生产、L3 appendix consumers、spell/keeper_background W3 fan-out、opening-coordinator 原生 Pi adapter、parent_flat_fanout(Pi)、extract_section 自动扇出、coc-section-secretary live。

---

## 3. 合并决策（给你下一步的抓手）

1. **真断点**：classify_sections live 从未 fulfill → 没有 section-index → extract 无从下手 → 全场实体（NPC/线索/handout/附录）基本没 materialize。**开场之后 KP 拿到的模组内容很稀。** 这是全场结构化命门，比附录 fan-out 更该先攻。
2. **可安全清理**（降散乱）：`autoDispatchPiFullParse` + adapter `--run-full-parse-batch` + `full_parse_dispatch` 槽 + `mentions-index.json` + `handouts/` 空目录 + `ensure_stub` job kind + `classification_request_chunks`。
3. **文档/契约同步**（改完代码顺手）：limit_maximum/claim "four"→32、worker pi `unavailable`/`same_task_retry:false`、README heartbeat pending、handoff leaves=4。
4. **别误删**：deepen（双轨未收敛，现网依赖）；opening `--run` bootstrap。
5. **真没做的设计**：附录 W3 fan-out 等挂在 classify 通了之后才有挂载点。

---

## 4. 相关文档（各管什么）

| 文档 | 讲什么 | 现状 |
|---|---|---|
| 本文 | 单一管理入口 | 在用 |
| `coc-on-demand-module-skeleton.md` | progressive 资产/skeleton/deepen 切片主设计 | 垂直 Done；locator/附录开 |
| `coc-tiered-background-orchestration.md` | L1/L2/L3 编排、fan-out、appendix E | 编排在；L3/附录 Deferred；偏旧 |
| `steward-redesign-0.5.1a.md` | S1 full_parse + S2 管家 + S3 拆 deepen/locator | S1/S2 有；**S3 deepen 未拆净**；batch 残留 |
| `coc-gate-recoverability.md` | 开场闸可恢复、物化死锁 | 多卡点已修；分章仍断 |
| `section-index-handoff.md` | classify 体积/claim 史 | 代码在；leaves=4 过期；index 难落地 |
| `skills/trpg-pdf-ingest/SKILL.md` | PDF→bundle 宿主工作流 Tier0–2 | 在用 |
| `skills/coc-scenario-import/SKILL.md` | bind→prepare_opening→bootstrap | 在用 |

## 5. 改这块从哪看起
1. 绑定+缓存核：`coc_module_assets.py:register_source_bundle`（~3835）
2. bind 编排：`coc_runtime_ops.py:scenario.bind_pdf`（~4910）
3. 整本 OCR：`coc_module_queue_worker._run_full_parse_ocr_attempt`（~2047）
4. 编排入口：`pi/extensions/index.ts:autoDispatchCoordinator`（~5733）
5. 生命周期：`pi/lib/runtime.ts:CoordinatorDispatchManager`
6. KP 衔接：`coc_toolbox.py:scene.context`（~13143）+ `skills/coc-main/SKILL.md`
