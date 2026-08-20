# 交接 — 开局生命周期（PDF 开局未收口）

**写于：** 2026-08-20  
**轨：** `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`（Codex 轨禁止）  
**分支：** `0.6.0a`  
**已提交头：** `66e20809`  
**计划：** `~/.cursor/plans/开局生命周期收敛重构_286fcc00.plan.md`

下一手的工作是 **B1**。A4 的 PDF 路径没有过；计划里把 A4 标成 completed 是错的。

---

## 用户要的是什么

PDF 新战役能走完：`session.resume` → 采纳源事实 → 建卡 → 侧栏有人 → **第一句 IC** → **杀掉该宿主再开、不重建卡**。

单元测试绿、或只把 starter 两条跑通，都不算完成。

---

## 已经落地（提交了）

`66e20809` `fix(pi-coc): keep PDF resume on the opening lifecycle and bind retained source facts`

- 用 `params.operation === "session.resume"` 识别启动 resume，不再要求 `CanonicalToolError.toolName` 等于注册名。`opening_setup_incomplete` + `opening_phase` 为 `module_preparation` / `character_creation` 时释放启动门，不再打成 `startup_resume_result_invalid`。
- 门禁信封用 `hasRequiredKeys`（允许附加 `opening_phase`）；操作卡仍 exact keys。
- typed `coc_setup_adopt_source_facts` 对模型只强制 `campaign_id`；执行时绑上审查/恢复留下的 facts，**不改写** KP 自带的 facts。档案契约仍是 `campaign_id` + `facts`。
- 测试：`tests/pi/startup-resume-typed-opening-phase.mjs`、`tests/pi/typed-tool-surface.mjs`。

活证据：`accept-pdf-a4e` 上 `setup.adopt_source_facts ok=true`，年代 `1890s` / `authored`，调查员 **艾琳·沃德**，web `has_character=true`。

更早的记忆层：`5b36819c`（无关本交接）。

---

## 已经写了、但还没提交

A1–A3 的相位机在工作区里，**不要和现金/战斗/UI 脏改动混提交**：

| 东西 | 位置 |
| --- | --- |
| `derive_opening_phase` / `setup.phase` | 未跟踪 `plugins/coc-keeper/scripts/coc_opening_phase.py`、`tests/test_opening_phase.py` |
| toolbox 消费相位 | `plugins/coc-keeper/scripts/coc_toolbox.py`（此文件还混有战斗等旁路 diff） |
| web 读投影 | `web/server-node/server.mjs`、`projections.mjs`、`pi-coc-rpc.mjs`（同样可能混了别的） |

Starter 验收（鬼屋 / 白战）当时在隔离 web `:8801` 上过了建卡、开场、重启续档。PDF 没过到 IC。

---

## 没做完的（按顺序）

### 1. B1 — 下一刀代码（必须）

`OpeningSetupState` 仍自己判条件，不是 `setup.phase` 的缓存。

`accept-pdf-a4e` 磁盘已经：

- `character_setup.confirmed=true`，`party_linked=true`
- 子相位 `opening_selection`
- `next_operation=progressive.prepare_opening`

活宿主却仍注入「建卡尚未完成… `investigator.create`」。KP 空转 `coc_setup_complete`（缺 `decision_id`），被打回建卡。

原因（观察，不是已修结论）：`coc_chargen_delegate` 把人和队写进磁盘后，扩展没收到它认的 `campaign.link_investigator` 收据，`characterSetupComplete` 仍为假。

B1 目标（计划原文）：扩展只缓存最近一次 `setup.phase`；startup resume 按相位选 accepted modes；删掉从失败信封捞 opening 观察的 hack。

**不要**先给 `setup.complete` 做「缺 decision_id 就填」——权威下一步是 `prepare_opening`，不是 complete。

### 2. A4 PDF 收口（B1 之后立刻测）

在隔离 workspace 上，同一条玩家路径：

1. 新建 PDF（**不要**在 create body 里声明 `era`；声明 `1920s` 会挡住源本年代，见 `accept-pdf-a4c`）
2. 审查 → adopt（现已能过）→ 建卡 → 侧栏
3. 第一句 IC
4. 只杀 **该** pi-coc 宿主，再 `POST /api/sessions`，必须 `play`、不重建卡

可复用 `accept-pdf-a4e`（人已在），或新 ID `accept-pdf-a4f`。旧战役一律保留。

未修 B1 时，可试：杀 a4e 宿主（勿删战役）再开 session，看 resume 是否按磁盘相位给出 `prepare_opening`。这只是探路，不能替代 B1。

### 3. B2 / B3（B1 和 PDF IC 之后）

- B2：`guided_quick_fire` / `kp_guided_era_adaptive` 分叉收到合同数据里，ACL 从合同读。
- B3：三路径再验一遍 + 扩展 `tests/pi/*.mjs` 相关套件。

### 4. 已知怪癖（记着，不必当第一刀）

- `quick_start` 在建卡前把 `status=active`，相位跳过 `ready_for_table` / `setup.complete`。Starter 续档仍能玩。
- web `turnInFlight` **全局**一把锁。隔离 `:8801` 上别的验收战役一占回合，PDF 会话会 409。
- typed 工具强制大 JSON（facts、`decision_id`）时 grok 经常漏字段；优先「磁盘已有权威卡就绑上」，不要逼模型抄。

---

## 验收现场（勿毁）

隔离 web：`http://127.0.0.1:8801`  
workspace：`artifacts/opening-acceptance-20260820/workspace`  
驱动：`node artifacts/opening-acceptance-20260820/turn.mjs <base> <sid> <jsonl> attach|input '…'`  
模型：grok-relay / grok-4.5。子代理不要用 fable5。

| 战役 | 用途 |
| --- | --- |
| `accept-haunting-a4` / `a4b` | starter 鬼屋证据 |
| `accept-whitewar-a4` / `a4b` | starter 白战证据 |
| `accept-pdf-a4` / `a4b` | 旧启动门终态；不能当修复证明 |
| `accept-pdf-a4c` | resume 门已过；adopt 漏 facts + 声明了 1920s |
| `accept-pdf-a4d` | 旧代码宿主；有过抢全局回合的 retry 环 |
| `accept-pdf-a4e` | **当前 PDF 证明点**（adopt + 艾琳·沃德） |

**禁止** `rm -rf` 战役 / `.coc/campaigns/` / 源包 / module-assets。  
**禁止**杀主仓玩测宿主：`asset-card-demo-20260819`、`pdf-coc-an-amaranthine-desire-20260820T013720`、`the-white-war-qs-mt0c8rdz`。

源包复用：`.coc/source-bundles/coc-an-amaranthine-desire`。

证据：`artifacts/opening-acceptance-20260820/`（`A4-OVERALL.md`、`path3e-pdf/VERDICT.md`）。未进 git。

---

## 脏工作区（不要卷进 B1）

未提交里还有现金账本、战斗/物品、roll-layout、`san_loss*`、桌面 agentconfig、前端美化等。B1 只动扩展开局路由及其测试。A1–A3 若要单独提交，先从 `coc_toolbox.py` / web 里把旁路 diff 剥开。

共享插件改动：本任务已获用户授权改 `plugins/coc-keeper/`。不要顺手改 Codex 轨。

Python：仓库根 `uv run --frozen python`；CPython 3.14.6。

最小回归：

```bash
node --experimental-strip-types tests/pi/startup-resume-typed-opening-phase.mjs .
node --experimental-strip-types --test tests/pi/typed-tool-surface.mjs
PYTHONDONTWRITEBYTECODE=1 uv run --frozen python -m pytest tests/test_plugin_metadata.py tests/test_opening_phase.py -q -p no:cacheprovider
```
