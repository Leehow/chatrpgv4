# Jev 长局后的缺陷分类与修复研究

日期：2026-10-05。研究与修复初始基准：`0.9.6a` 的 `9c225449056f26d7d77cd9514c13fb7d32df0506`。整合树先快进到 `cf8c69a12ad8cb40f9cf4f77d2293c4d7126403b`，两个 TS RPC 文件又在该整合树复验通过；最终再快进到 `8e0ef5cd90226be54820f0995e64b7bd5e0a109b`，新增内容只涉及 Electron extension writer，与本轮目标生产文件和已验路径不重叠。本轮不声称整份新主线的全套或 App 验收。

用户授权：仔细研究和分类，交 `gpt-6.1-sol` worker 修复边界明确的 bug，复杂问题先形成有证据的结论。使用 Codex native worker；主会话负责研究、复核、串行整合和验证。原《血色公路》盲玩目标仍未完成，本轮不增加自然回合。

## 结论与证据边界

Jev → 政策操作 → TypeScript 内核已经有成功结算证据。当前最明确的问题集中在公开机制传输、追逐参与者初始化、终端交付顺序。长期战斗状态、正文被拒和剧情循环不能直接归结为一个 Jev 分类器错误。

历史数据来自 `blood-road-jev-20261002-flapcode-gpt6-luna-v32`。driver 1–1540 对应战役记录 797–2336；2337 个战役记录包含开场和更早的多个 run，不能混为同一个分母。v32 启动元数据确认 Pi 1.0.0 / hybrid-v1 / source，但没有精确产品源码 SHA。以下历史症状不能自动当作当前包的重现。

研究只将玩家已收到的正文、公开机制及技术枚举/计数送入分析上下文。未读 campaign save 或模组秘密，未向旧 v32 输入、重启或迁移。原始证据保持不变。

| 类别 | 项目 | 本轮结论 |
| --- | --- | --- |
| 已证实 bug | B01 公开机制/选择漏传；B02 乘客初始化；B03 终端交付顺序 | 三个 worker 完成窄修复，经过交叉复核和现有测试；源码交付，未打包 |
| 已证实现象、根因分支待定位 | C01 正文被拒；C02 长期活动战斗 | 不凭现象添加自动放行/自动结束补丁；已找到必要的下一条判别证据 |
| 需要设计和数据标注 | C03 灰区/预算；C04 按角色的准备度 | 保持现有阈值与玩家选择边界，先分清失败类别和所需字段 |
| 体验与验收方法 | C05 剧情循环 | 主控、状态兑现和测试玩家策略共同评估；回合数与供给计数不代替剧情进展 |

| v32 指标 | 实测值 | 能证明什么 |
| --- | ---: | --- |
| driver 输入 | 1540 | 交互次数，不是检定次数或剧情段数 |
| check-selection 最终记录 | 497 | 27 selected、457 no_roll、10 unresolved、3 deferred；不检定不等于误判 |
| 政策车道 resolve | 24 成功、5 拒绝 | 真正调用过规则层；有些同一回合包含多次规则调用 |
| 成功 resolve 所在回合的 roll 收据 | 33 | 15 skill_check、7 psychology_observe、1 mod_check、10 其他后果随机；不是全局所有骰子的完整统计 |
| driver 空白正文 | 47（31 empty、16 undelivered_with_tools） | 约 3.1%；不能作为成功故事交付 |
| 响应时间 | 中位 46.189 s；P95 154.882 s | 旧 run 的端到端体验，不是 Jev 单次延迟 |
| 主模型调用记录 | 2281 | 前景调用量；2271 个记录了 HTTP 200，200 本身不保证交付成功 |
| 有 turn 归属的辅助车道请求记录 | memory 1507、journal 1503、admission 885 | 3895 次请求阶段记录；memory/journal 多为后台，admission 在行动路径上，不能直接相加成前景时延或费用 |

## A：已证实、可做窄修复

### B01 — 公开机制和选择没有进入 driver 玩家输出

生产者已有 `coc-mechanics` 和 `coc-choice`；driver 只从显式 narrate/ask 结果取机制，遗漏隐式交付的 entry 事件。CLI 原来只打印正文、通知和显式工具名。因此无显式 resolve 工具名，不能推出无政策检定。

证据：v32 有 437 份 delivery 保存了 mechanics，10 份保存 pending_choice；原 CLI 均不打印。driver 7 的隐式投影中有隐藏数值的 Psychology 尝试；driver 1515 的公开 Spot Hidden 投影有已结算结果。它们来自既有公开事件，不需要读取私有状态补写。

worker 修复捕获两类公开 entry，保留累积快照语义，并单独打印公开 JSON 卡。复核补上了两个边界：NPC condition 的 subject_label 只能在 subject_is_investigator=true 时显示；公开 handout/map 的授权 path/image_path 必须保留。隐藏骰子不能暴露数值/成败，runtime IDs、choice binds 和 keeper 行不进玩家面板。正文及原 settle/exit 分类不改变。

来源：`tests/play/driver.py::{Daemon.turn,cmd_turn}`，`extensions/kernel/index.ts::noteMechanics`，`pipicoc/mechanics.js` 的可见性/condition/附件消费者，`docs/acceptance.md`。

### B02 — 乘客追逐初始化不满足自己的快照不变量

当前源码的同一路径标准 RPC 复现出两个确定原因：

1. `addParticipant` 给每个角色初始移动预算 1。若速度检定已经结束追逐，就不会进入稍后的 beginRound，把乘客预算归零的动作没有发生；保存快照拒绝该状态。
2. `cutToTheChase` 在一个名册顺序循环里同时定位司机和同步乘客。乘客排在其 quarry 司机前面时，复制到司机旧位置 0，随后司机移动到起点 2，快照再次不一致。

窄修复：乘客从创建起预算为 0；先定位全部移动角色，再同步乘客及初始位置。不放松快照校验，不修改脚色、车辆 MOV 或缺失司机链接的拒绝。当前源码标准 RPC 已验证提前结束、活动追逐、名册顺序、司机移动带动乘客以及无效链接。现有两个 Node 文件 14/14 通过。

来源：`kernel-ts/chase/session.ts::{addParticipant,cutToTheChase}`、`kernel-ts/chase/validation.ts` passenger invariant、契约 §159.11。

### B03 — 终端信号发出后，玩家结果才到达

这个子问题已经从推测变成原始 RPC 到达顺序的事实：

| driver 回合 | agent_settled 后的实际到达 | events.jsonl 一基行号 |
| --- | --- | --- |
| 420 | 未完成通知 +39 ms | settled 126754；通知 message_end 126756 |
| 1297 | 通知 +103 ms；undelivered 机制卡 +2116 ms | settled 429041；通知 429043；机制卡 429045 |
| 1402 | 未完成通知 +240 ms | settled 490427；通知 490429 |

当前 Pi 的 `_emitAgentSettled` 会等待 extension hook，再向外发终端事件。宿主却 `void tellWhatSettled(...)` 并以 timer 发送通知，绕过了现成的完成边界；driver 接到终端事件便结束当前输出。

worker 的窄修复让既有 terminal hook 等待它欠下的公开机制和被选中的终端通知，然后才释放排队输入。显式 `triggerTurn:false` 保证只是公开消息，不启动模型。对应 agent_end 的 cut-short/refused-effect/commit-down 终端分支也使用既有 emitter 完成边界。普通后台工作不被纳入等待。

本项修的是丢失通知/结算卡，不是把被拒正文强行复活。源宿主确定性演示通过，独立复核未发现可操作缺陷，整合后的九个既有 Node 文件 43/43 通过，包含真实内核的 stranded-turn 用例。

来源：`extensions/kernel/index.ts::{tellWhatSettled,agent_settled,emitTurnUnfinishedNotice,agent_end}`；`vendor/pi/packages/coding-agent/src/core/agent-session.ts::{_emitAgentSettled,sendCustomMessage,_appendCustomMessage}`。无 vendor 改动。

## B：现象确认，但不能直接写补丁

### C01 — 正文为何被 text_not_a_delivery 丢弃

代表性的 driver 420、1297、1402 都有 HTTP 200、text/stop，然后宿主记录 `text_not_a_delivery`，最终 `turn_close_steer_spent:no_delivered_evidence`。其中 1297 有成功 apply；1402 也有前面的政策时间收据，不能因为后一个显式 apply 被拒就断言没有状态变化。

现有拒绝理由把三个条件合在一起：无可用 prose、turn 不可关闭、`closedThisRun` 已置位。旧日志没有这三个分支的布尔值，且没有精确产品源码 SHA。当前只能排除“这些样例都是 provider 没响应”；不能确定是哪一个状态或正文条件先坏掉。

下一步建议：在该既有拒绝行记录最小结构化分支证据（有无正文、phase、closedThisRun、turn/run 归属），不记录原始私有正文；再用最新运行时定位真实触发。B03 会让失败及已结算内容被看见，但不等于 C01 的根因已经修好。不建议重开自动 prose 重写或放行未通过规则/玩家选择保护的正文。

### C02 — 长期战斗状态：先检查选择是否被看见和消费

v32 driver 686 的 resolve 仍带 `session_kind:combat`。但 driver 745 的公开 ask 包含 push/spend_luck/accept/flee，driver 746 明确选择 flee 后，内核产生 combat/end/fled 收据；747 的后续 resolve 已没有活动 session_kind。

这个反例证明“内核根本不会结束战斗”不成立。早期滞留可能包含未显示、未回答或未被绑定的机制选择，B01 是已确认的上游缺口。也可能有更早的会话使用问题，但要追最早选择的签发→公开显示→玩家回答→绑定→结束收据。不能把普通叙事移动自动改成结束战斗，那会跳过玩家选择和规则结算。

来源：保留的 `turn-745.json`、`turn-746.json`、`turn-747.json`；战役 telemetry 行 127711、127750、127853；`runtime/jev/candidates.ts` session candidates；`kernel-ts/combat/execution.ts` 显式结束路径。

### C03 — 灰区、准备不足、预算耗尽是三类不同原因

旧 v32 的 523 个回合出现过单独 `below_confidence_gate` 强制裁定记录；另有 155 个回合出现 `jev_budget`。它们不能合成一个“Jev 误判率”。大量普通问答本来就无需检定，而强制裁定是既有 §163 的产品选择。

对 155 个 budget 回合逐条累加现有 decision step 耗时：全部至少 12000 ms（最小 12003，中位 14461，最大 21303）；没有一个到 40 steps。当前源码默认 maxJevMs=12000、maxJevCalls=24、maxSteps=40，三个条件被合成一个 `exhausted`。这个分布与时间耗尽吻合，不能排除部分回合同时达到调用门，也不能据此猜旧环境的完整有效配置。

driver 33 在预算退路之前已经成功做了两次检定，又继续检查其他候选；其 compile/route 加上多轮 selection 累计约 12.21 s。driver 264 的 compile 自身超时约 15 s；driver 843 的 interaction-scope 自身约 15 s。只有 3 个 budget 回合含单步至少 15 s，不能把全部 155 次说成服务宕机。

研究方向：先给预算原因区分时间/调用/步数，并在同一批已标注的真实声明上比较重复候选、串行细化和准备回读的成本。只在后一问有新增信息时再问 Jev；独立问题批量问，依赖与算术由代码处理。不要通过降阈值、放大上下文或把检定选择交回 LLM 提高表面 roll 数。

来源：`runtime/jev/step-policy.ts::{exhausted,settleCheckSelection}`、`runtime/jev/hybrid-engine.ts` check-selection lease、`extensions/jev/agent/config.js`、`runtime/jev/resolve-selection.ts`。官方对[状态过滤](https://docs.typesafe.ai/concepts/state)、[不确定性](https://docs.typesafe.ai/confidence)和[常见失效](https://docs.typesafe.ai/model-jaggedness/jev-1.13)的说明支持这种拆分；这些通用说明不是本产品误判率的证据。

### C04 — profile_available 一个布尔量承载了不同角色的就绪要求

当前 `kernel-ts/runtime/check-catalog.ts` 仍以 `profile !== null` 表示候选已有 profile。后面的执行层要求更具体：战斗读四项身体特征，步行追逐还读 MOV，司机读车辆 MOV 和驾驶技能，乘客跟随司机。把布尔值一律改成“必须有身体 MOV”会误拒驾驶者，不能当作小补丁。

建议设计为按意图和已绑定角色计算准备缺口，保留所选动作，补齐后刷新并恢复；Jev 只判断真实角色/意图，是否缺字段由代码判断。现有玩家首击 retention→prepare→refresh→replay 的 21 项 App 机制证据可作为复用基础。NPC 自己的 partial first blow、walk-on/名册选择阶段的准备仍是另外的消费者，不被 B02 的乘客初始化修复覆盖。

此方向与 [XState guards](https://stately.ai/docs/guards) 的确定性条件分离做法相符；不建议引入 XState 或重写当前运行时。

### C05 — 剧情停滞是主控、状态兑现和测试方法的联合问题

旧局反复核验记录、身份、权限和回电，既有无结果的等待，也有测试玩家持续追问低收益程序的放大效应。这个现象不能仅凭 round 数定位到 Jev，也不能通过自动跳场景或补写模组内容解决。

offer 账的 1182 条记录、1370 次 offered、0 taken 初看异常；进一步按结构类型统计后，1370 次全部是 `stated` 规则供给，不是剧情线索或路线邀请。它不能被解释为“1370 个剧情钩子全被忽略”。该账只观测，不能反馈成守秘人欠下的推进义务。

下一步需要在公开结果层区分：玩家目标是否变化、NPC 是否作出可执行回应、等待是否实际推进时间、既有承诺是否得到兑现或明确失败、是否出现新的可选路径。用这些观察定位 producer→projection→actor 的缺端，而不是用关键词或固定重复次数强迫剧情推进。严格盲玩时仍不能通过偷看模组真相来判正确路线。

## 已修复项与仍未覆盖的验收

历史路由 packing、社交尝试/同意混淆、玩家 partial first-blow 和 foot MOV 已有各自的修复证据。不能把它们继续全部列成当前开放 bug，也不能用这些机制通过宣称战斗、追逐、SAN、治疗的自然 Jev 全链已验收。

本轮初始两个修复和后续 B03 都不变更检定阈值、算术、SINGLE_PASS_NARRATION 或模组剧情。重套件没有重复执行；原 LAN 占用进程没有被终止。用户明确允许四个既有 pytest 文件在 Mac 串行验证，范围见活跃计划和最终验证记录。

| 当前验证 | 状态 |
| --- | --- |
| driver 既有 test_driver.py | 74 passed / 1 skipped；本轮隔离整合树 |
| chase engine 既有 test_chase.py | 54 passed；此文件导入冻结 Python oracle，只是兼容参考，不代替 TS 修复验证 |
| 当前 TS sessions / NPC quarry RPC 文件 | 14 + 13 passed；快进到 cf8c69a 后串行复验仍为 14 + 13 passed |
| passenger 当前源码 Node 两文件 | 14/14；标准 RPC before/after 与名册顺序证明保留 |
| B03 既有 Node 与顺序演示 | 整合树九文件 43/43；补齐了 worker 曾因缺编译入口未运行的 real-kernel fixture；独立复核无可操作发现 |
| 完整全套、签名 App、新自然桌 | 本轮未执行、未宣称通过 |

四个获准的 pytest 文件合计 155 passed / 1 skipped，其中 54 项是历史 oracle；另有不重叠的 Node 文件 14 + 43 passed。验证只编译隔离树的当前 TS 内核单入口（与生产相同的 esbuild 选项），使用现有固定 Pi 依赖；没有替换主 build、运行全量 build:runtime 或重打包。

## 可复核材料

- 活跃计划：`docs/active-plans/blood-road-jev-two-chapter-playtest.md`，保留旧进度、修复边界和本轮授权。
- 原始 v32 driver：主检出 `.coc/playtests/blood-road-jev-20261002-flapcode-gpt6-luna-v32/`；原战役 telemetry 仅通过字段过滤读取。
- 已安装 App 首击/MOV 机制：主检出 `.coc/playtests/jev-first-blow-app-0eabe8f4-20261004/attempt2/`，21/21；无自然玩家/模型调用。
- 本轮 worker 完整 handoff 与 replay/RPC 输出：三个修复 worktree 各自 `.tmp/team-lead/`；独立 review 和 source retrieval map 在整合树 `.tmp/team-lead/`。最终交接保留它们，不能删除失败尝试。
- [JSON-RPC specification](https://www.jsonrpc.org/specification) 区分 notification 与 response，支持“终端消费者必须接住公开事件”这个架构判断；具体载荷与结束边界以本仓库契约和 vendored Pi 实现为准。
- [Node Events](https://nodejs.org/api/events.html) 的同步 emit 不会替应用等待任意异步尾部。这里真正保证等待的是 vendored Pi 对 extension hook 的显式 await；修复使用该已有边界，而非假设消息总线会等待 timer。

原两段实质剧情加终局的目标仍然开放。下一轮真实验收首先需要完整公开选择/机制链、明确运行时和 Mod 锁，并继续遵守 Flapcode `gpt-6-luna` / low 与玩家不读模组秘密的约束。
