# 真桌验收方法

## Current live-test profile (owner 2026-10-16)

The current default is `minimax-cn/MiniMax-M3.1-Flash-Preview` with `medium` reasoning for the Keeper, final author and supporting lanes. Select it explicitly and verify actual runtime attribution; older driver defaults do not select the current policy. Only after MiniMax reports exhausted quota, use `grok-build/grok-4.5` with `high` reasoning for all these roles, retaining the quota failure and actual switch evidence. Product model defaults remain unchanged. The older profiles and run-specific exceptions below are historical evidence, not current defaults; the current repository `Agents.md` governs subsequent tests.

## Blood Road run exception (owner 2026-10-16)

This historical comparison explicitly selected `minimax-cn/MiniMax-M3.1-Flash-Preview` with `medium` thinking for the Keeper and final author. Independent supporting lanes retained the actual App fast profile; they were not replaced by MiniMax. This run-specific exception did not change product model settings. Preserve its actual model attribution and evidence; it does not override the subsequent current live-test profile above.

For this run the owner explicitly requested a fresh browser UI campaign and no further CLI gameplay. The main session remains the sole player, using one natural input per actual product reply. Preserve the earlier CLI runs separately; they do not establish browser UI acceptance. Setup timing uses a new empty home without a completed guidance cache, and play continues through the real web UI and Pi backend. Read-only diagnostics and implementation regression tests remain separate evidence.

每个切片的验收都是一张真桌：本主会话当唯一玩家，`pi` 统一跑 Codex Relay `codex-relay/gpt-6-luna`、`high` 当守秘人；测试中的最终作者也使用同一配置。一回合一回，走产品路径（2026-10-13 用户裁定，覆盖此前 Grok 4.5/low 测试默认值）。启动后核对实际模型；历史测试保留原证据的实际模型。禁止假守秘人脚本、批量结算、关键词路由或场景模板刷回合（仓库 `Agents.md` 的绝对禁令）。自动化接缝（内核 RPC、扩展、驾驭器）证明的是契约，真桌证明的是产品；到目前为止每次真桌都找出 3–5 个接缝看不见的系统缺陷。

## 工具

Before creating comparison/retry workspaces, follow [the bounded test storage contract](specs/test-data-storage.md). Use `start --seed-home PATH` to reuse a quiescent retained seed with private CoW state, per-file provenance and admission limits. Keep the run's results and raw evidence; inspect actual free space independently of logical directory sizes.

若 Codex Relay 报并发已满，本次测试回退到 `grok-build/grok-4.5` / `low`，包括最终作者和辅助车道；保留 Luna 失败记录，后续测试默认仍为 Luna/high（2026-10-13 用户补充裁定）。

- 驾驭器 `tests/play/driver.ts`：`node tests/play/driver.ts start --campaign <id> --run <run_id> [--launcher bin/pi-coc-setup]` 起一个守护进程与 `pi --mode rpc`；`turn "<玩家原文>" --run <run_id> --timeout <秒>` 发一条玩家输入并打印交付；`stop`；`status`；`log`。证据落在 `.coc/playtests/<run_id>/`（每回合 `turn-N.json`、`events.jsonl`、`pi-stderr.log`）。
- 指标 `node tests/play/kpi.ts --campaign <id> --turns a-b`：从战役遥测算每回合「第一次写状态前的只读调用数」、工具总数、内核报错、是否进规则层；`--baseline` 给 `haunting-s0` 13–25 回合的基线。
- 原 PDF 从 setup 入口准备；页图由 `bin/coc-source` 提供，TS 内核只接收带页来源的图谱草稿。资料包/OCR 入口已退役。
- 建卡进程走 `bin/pi-coc setup`（驾驭器用 `--launcher bin/pi-coc-setup`），游玩进程走 `bin/pi-coc --campaign <id>`。

## 证据

- 战役目录 `.coc/campaigns/<id>/`：`turns/NNNN.json`（玩家原文、收据、交付、世界快照、事实清单、警告、胶囊、采纳）、`transcript.jsonl`、`events.jsonl`、`telemetry.jsonl`（工具、车道、Director 采纳）、`memory/`、`save/continuation/`。
- 模组目录 `.coc/modules/<id>/`：`reading-telemetry.jsonl`（宿主资料库下的阶段耗时）、阅读索引、`work/<job>/attempt-*/`（草稿、复核、页图使用记录与 findings）、`module.json` 里的可玩性报告。
- 证据只增不删：战役、逐字记录、遥测、玩测目录永不删除。

## 每个切片怎么判

- 切片 1（规则族）：造景到对峙，六条 lane 至少五条进规则层并结算。
- 切片 2（提交链）：一局跨两次 `pi-coc` 会话八回合以上，第二次会话中守秘人主动召回第一次会话的事实。
- 切片 3（胶囊与 Director）：同一战役对照，第一次写状态前的只读调用数下降（基线中位数 3 → 0），进规则层的 lane 不降。
- 切片 4（建卡与模组车道）：一本真 PDF 从 `bin/pi-coc setup` 走七步到 `ready_for_table`，开桌三回合，开场材料全部来自构建出的图。
- 切片 5（退役旧树）：全量原生 TS 测试通过，一局十回合回归。

## 读证据的三条戒律

- 缓存、守护进程内存、证据排序各骗过我一次：验证前重开进程，按 `at` 排序，看回合记录不看叙述。
- 守秘人说「已就位」不算数：看 `campaign.json` 的 `module_id` 与 `turns/NNNN.json` 的收据。
- 叙述里发生了却没有收据的事等于没发生：世界位置看 `world.json`，不看守秘人的话。

## Driver delivery visibility (2026-10-05)

The RPC driver captures the public `coc-mechanics` and `coc-choice` session entries,
including implicit deliveries that have no `narrate`/`ask` tool result. At turn
finalization these projections travel alongside the exact delivered prose in
`delivery.mechanics` and `delivery.pending_choice`. A projection alone does not
make a turn settled; existing prose, rejection and exit classification remain
unchanged. Repeated snapshots replace the same turn's projection rather than
printing duplicate cards; explicit results remain the fallback when no entry exists.

`node tests/play/driver.ts turn` prints separate structured mechanics and choice panels after the
prose and notices. The player panel excludes keeper rows, concealed roll figures
and grades, receipt/call/marker identifiers, pending-choice bindings and runtime
actor handles. Condition rows show a subject label only when
`subject_is_investigator` is exactly true, matching the existing public card.
Public handout/map rows retain their authorized scalar `path` and `image_path`
as the terminal artifact fallback (§14.8/§16.2); other row types expose no paths.
It reads only documented presentation fields and existing public labels; it never reads capsules, source truth or campaign saves to reconstruct a
result. Policy rolls appear through their mechanics projection even when no
explicit `resolve` tool call exists. The tool-name footer remains an execution
summary, not a count of all kernel settlements.

Retained-record replay is transport evidence only. Real play remains the acceptance
method above, and historical records are never rewritten by replay.

The first `get_state` handshake uses the existing startup-ready timeout rather
than the ordinary command acknowledgement timeout. A populated campaign may need
more than ten seconds to open its scoped module and initialize extensions before
RPC input is serviced; the retained Blood Road diagnostic measured 13.804 seconds
to a successful handshake. Startup remains bounded by the existing thirty-second
ready budget, and normal command/model/prompt acknowledgement limits are unchanged.
Opening diagnostics require the campaign state, its matching history repository,
locked Mods and its campaign-private module scope; a shared initial module alone
does not reconstruct a long campaign's published graph. Missing-copy startup
failures are environment evidence, never successful gameplay or Jev verdicts.

## Uniform live acceptance profile

Owner override for MiniMax cache/search/image acceptance (2026-10-16): explicitly
select minimax-cn/MiniMax-M3.1-Flash-Preview with medium reasoning for both Keeper
and final author. The driver passes the existing test-only model binding to both
author paths; verify actual model events and request effort. Other test defaults,
ordinary product author choice and independent lanes remain unchanged.

The live driver profile is explicit: Luna/high normally, Grok 4.5/low only after actual upstream concurrency saturation. PI_COC_TEST_MODEL is a test-only process binding. When it selects either approved profile, actual single-completion lane effort and tool-enabled build-worker effort must use that same profile even where a normal caller has an off/low default. The final author already uses this binding. Outside these two exact test profiles, existing caller and lane/environment precedence remains unchanged. Telemetry must report the same effective options carried by the request, not merely inherited environment values. Retain mismatched earlier runs as diagnostic evidence.

Targeted external comparison: OpenAI reasoning guidance places effort on the actual request (https://developers.openai.com/api/docs/guides/reasoning), and Gemini thinking documentation likewise describes explicit request configuration (https://ai.google.dev/gemini-api/docs/generate-content/thinking). Both support checking sent options rather than assuming environment export establishes behavior; provider defaults and supported values differ, so the local model adapter remains responsible for translation. This comparison does not change normal product effort defaults.

Stopping an in-flight live driver must wake its transport wait after the Pi child has closed, finalize the retained partial turn, and only then write final totals. A process-exit wake is transport evidence, never a delivered Keeper event or a settled turn. A saturated retry stop must not leave the daemon alive until the player turn timeout.

Driver model confirmation (2026-10-16): the startup get_state model and thinkingLevel are authoritative. When both already match the explicit requested profile, retain that handshake as confirmation instead of issuing a redundant set_model. A mismatch still requires the existing set_model call and a successful response; no failed selection is accepted. This avoids rejecting an already selected product-corrected model when the provider overlay does not resolve it again through set_model.
