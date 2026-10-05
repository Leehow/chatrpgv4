# Jev 长局后的缺陷分类与修复研究

日期：2026-10-05。研究与修复初始基准：`0.9.6a` 的 `9c225449056f26d7d77cd9514c13fb7d32df0506`。整合树先快进到 `cf8c69a12ad8cb40f9cf4f77d2293c4d7126403b`，两个 TS RPC 文件又在该整合树复验通过；最终再快进到 `8e0ef5cd90226be54820f0995e64b7bd5e0a109b`，新增内容只涉及 Electron extension writer，与本轮目标生产文件和已验路径不重叠。本轮不声称整份新主线的全套或 App 验收。

用户授权：仔细研究和分类，交 `gpt-6.1-sol` worker 修复边界明确的 bug；随后要求先提交，再找到和修复剩余根因。使用 Codex native worker；主会话负责研究、复核、串行整合和验证。第一轮没有新增玩家输入；第二轮在原战役的隔离副本上运行真实 driver 诊断。原《血色公路》盲玩目标仍未完成，副本诊断不能充当新的两章盲玩验收。

## 结论与证据边界

Jev → 政策操作 → TypeScript 内核已经有成功结算证据。当前最明确的问题集中在公开机制传输、追逐参与者初始化、终端交付顺序。长期战斗状态、正文被拒和剧情循环不能直接归结为一个 Jev 分类器错误。

历史数据来自 `blood-road-jev-20261002-flapcode-gpt6-luna-v32`。driver 1–1540 对应战役记录 797–2336；2337 个战役记录包含开场和更早的多个 run，不能混为同一个分母。v32 启动元数据确认 Pi 1.0.0 / hybrid-v1 / source，但没有精确产品源码 SHA。以下历史症状不能自动当作当前包的重现。

研究只将玩家已收到的正文、公开机制及技术枚举/计数送入分析上下文。未读 campaign save 或模组秘密，未向旧 v32 输入、重启或迁移。原始证据保持不变。

| 类别 | 项目 | 本轮结论 |
| --- | --- | --- |
| 已提交 bug | B01 公开机制/选择漏传；B02 乘客初始化；B03 终端交付顺序 | 三项修复提交为 `de86ad40f`，经过交叉复核和现有测试；未打包 |
| 第二轮已修源码 | C04 角色准备度；B04 收据归属；B05 启动超时；B06 后台车道抢占交付 | 准备后续接原动作，准确读收据，修首次握手额度；后台排队服从已有前景边界，详见证据 |
| 已有真实结算证据 | C03 决定预算 | 截止时间、退路和候选输入复用已修；v6 Psychology 真正结算，Jev 10 次 / 10.0 秒，未超限；整体交付仍慢 |
| 尚未锁定的根因 | C01 空正文；C02 更早战斗滞留 | 六次历史正文在宿主前已空；增加原始/归一化流观测。显式 flee 能正常结束，不能自动结束战斗 |
| 尚未完成的体验验收 | C05 剧情循环 | 最终报社移动已有成功收据，排除该处未提交假设；全局循环和两章盲玩仍开放 |

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

### C01 — 空输出为何进入 text_not_a_delivery

代表性的 driver 420、1297、1402 都有 HTTP 200、text/stop，然后宿主记录 `text_not_a_delivery`，最终 `turn_close_steer_spent:no_delivered_evidence`。其中 1297 有成功 apply；1402 也有前面的政策时间收据，不能因为后一个显式 apply 被拒就断言没有状态变化。

现有拒绝理由把三个条件合在一起：无可用 prose、turn 不可关闭、`closedThisRun` 已置位。旧日志没有三个分支的布尔值，也没有精确产品源码 SHA。第一轮只确认 HTTP 200 和 text 类型，因此把“完整正文被拒收”留作了待查假设。

第二轮沿原始 RPC 事件继续往前查，得到更强的反证：420、1297、1402 各自的首次输出和一次补救输出，共六次，均是 `text_start` 后直接 `text_end`，没有任何 `text_delta`，结束内容长度为 0。六次均为 `stopReason=stop`、`rawStopReason=completed`、输出 token 4、reasoning token 0。`text_end` 发生在宿主的 message_end 替换之前，故这几例不是完整正文被阶段守卫抹掉；`!prose` 已成立。首次 turn_close 又都选中普通 steer，支持当时仍 open/acting、未交付的状态。原始证据行号见本轮 prose-root-analysis 交接。

仍需区分的是：上游实际只返回了空消息，还是最终 `response.completed.output` 有文字、当前 Responses 解析器没有补收。当前依赖会消费文本 delta 和 output_item.done，但不从 terminal response.output 补回正文。旧日志没有原始 SSE 末尾形状，所以不能把这个可能的解析缺口当成已发生的根因。最新请求的观测只累计原始/归一化文字长度、内容类型与布尔状态，不记录正文、私密上下文或 provider ID；无 terminal 观测也不能记成上游空消息。

下一步是用真实 driver 的原始/归一化长度对照确认修复归属。B03 会让失败及已结算内容被看见，但不等于上游空输出已修好。不修改阶段守卫、不把空消息伪造为叙事，也不重开自动 prose 重写。

### C02 — 长期战斗状态：先检查选择是否被看见和消费

v32 driver 686 的 resolve 仍带 `session_kind:combat`。但 driver 745 的公开 ask 包含 push/spend_luck/accept/flee，driver 746 明确选择 flee 后，内核产生 combat/end/fled 收据；747 的后续 resolve 已没有活动 session_kind。

这个反例证明“内核根本不会结束战斗”不成立。早期滞留可能包含未显示、未回答或未被绑定的机制选择，B01 是已确认的上游缺口。也可能有更早的会话使用问题，但要追最早选择的签发→公开显示→玩家回答→绑定→结束收据。不能把普通叙事移动自动改成结束战斗，那会跳过玩家选择和规则结算。

来源：保留的 `turn-745.json`、`turn-746.json`、`turn-747.json`；战役 telemetry 行 127711、127750、127853；`runtime/jev/candidates.ts` session candidates；`kernel-ts/combat/execution.ts` 显式结束路径。

### C03 — 灰区、准备不足、预算耗尽是三类不同原因

旧 v32 的 523 个回合出现过单独 `below_confidence_gate` 强制裁定记录；另有 155 个回合出现 `jev_budget`。它们不能合成一个“Jev 误判率”。大量普通问答本来就无需检定，而强制裁定是既有 §163 的产品选择。

对 155 个 budget 回合逐条累加现有 decision step 耗时：全部至少 12000 ms（最小 12003，中位 14461，最大 21303）；没有一个到 40 steps。当前源码默认 maxJevMs=12000、maxJevCalls=24、maxSteps=40，三个条件被合成一个 `exhausted`。这个分布与时间耗尽吻合，不能排除部分回合同时达到调用门，也不能据此猜旧环境的完整有效配置。

driver 33 在预算退路之前已经成功做了两次检定，又继续检查其他候选；其 compile/route 加上多轮 selection 累计约 12.21 s。driver 264 的 compile 自身超时约 15 s；driver 843 的 interaction-scope 自身约 15 s。只有 3 个 budget 回合含单步至少 15 s，不能把全部 155 次说成服务宕机。

研究方向：先给预算原因区分时间/调用/步数，并在同一批已标注的真实声明上比较重复候选、串行细化和准备回读的成本。只在后一问有新增信息时再问 Jev；独立问题批量问，依赖与算术由代码处理。不要通过降阈值、放大上下文或把检定选择交回 LLM 提高表面 roll 数。

第二轮已实现的窄修复：决定调用的 lease 取剩余决定时间与原单次上限的较小值；所有通用决定也进入现有超时等待边界，迟到答案不能继续改状态。真正耗尽本轮额度时，宿主保留明确的 budget provenance，直接进入一次 compose，不先做一次无用 adjudicate；参考问答同样不会在零余额下反复 route。调用次数在实际进入 DecisionPort 时计数，未发出的调用计零；摘要分别标明 time/calls/steps。普通技能的独立 64 项分组并行查询、按原目录顺序归并，保留原题目、unknown、前八项和后续复核，不缓存跨收据的旧结论。

既有用例在 2000 ms 决定额度下故意等 2100 ms 才返回 route，揭示旧测试允许迟到答案。仅调整该文件两处已经过时的额度/顺序预期，原场景、四条模型响应和全部收尾断言保留；没有新增测试场景。当前组合验证包含这一文件的九项检查。不能把这个成功外推成 155 个旧样例都已消失。

来源：`runtime/jev/step-policy.ts::{exhausted,settleCheckSelection}`、`runtime/jev/hybrid-engine.ts` check-selection lease、`extensions/jev/agent/config.js`、`runtime/jev/resolve-selection.ts`。官方对[状态过滤](https://docs.typesafe.ai/concepts/state)、[不确定性](https://docs.typesafe.ai/confidence)和[常见失效](https://docs.typesafe.ai/model-jaggedness/jev-1.13)的说明支持这种拆分；这些通用说明不是本产品误判率的证据。

### C04 — profile_available 一个布尔量承载了不同角色的就绪要求

当前 `kernel-ts/runtime/check-catalog.ts` 仍以 `profile !== null` 表示候选已有 profile。后面的执行层要求更具体：战斗读四项身体特征，步行追逐还读 MOV，司机读车辆 MOV 和驾驶技能，乘客跟随司机。把布尔值一律改成“必须有身体 MOV”会误拒驾驶者，不能当作小补丁。

建议设计为按意图和已绑定角色计算准备缺口，保留所选动作，补齐后刷新并恢复；Jev 只判断真实角色/意图，是否缺字段由代码判断。现有玩家首击 retention→prepare→refresh→replay 的 21 项 App 机制证据可作为复用基础。NPC 自己的 partial first blow、walk-on/名册选择阶段的准备仍是另外的消费者，不被 B02 的乘客初始化修复覆盖。

此方向与 [XState guards](https://stately.ai/docs/guards) 的确定性条件分离做法相符；不建议引入 XState 或重写当前运行时。

第二轮已经贯通生产者和消费者：foot 使用既有 `statBlockGaps`，driver/passenger 使用 `participantGaps`，驾驶技能和乘客司机链接继续分别验证。步行入口不再借用战斗目标的就绪名单；准备时保留已选追逐动作，刷新要求原场景、原行动者、原名单角色、车辆和司机链接仍有效。NPC 自主首击/追逐的空或不完整 profile 会给出准备要求，生成且绑定过的动作在任何 attempted-effect 写入之前保留于本 run；资料齐备后经当前 dispatcher/admission 原样续接，交付、取消、换 run 后失效。未就绪的重检不消费永久 resume key，同一步不会紧循环重试。

此续接采用父任务持有、条件满足后继续、父任务结束即清理的有限模式。[XState callback actors](https://stately.ai/docs/callback-actors) 与 [Redux listener middleware](https://redux.js.org/toolkit/api/createListenerMiddleware) 提供类似的生命周期和取消方式；它们不提供 CoC 数值与授权，本项目仍使用自己的内核谓词和规范写入口，未引入依赖。现有通用 RPC/NPC/准备用例和独立源码复核通过；新加的部分 NPC 续接、过期/竞态分支缺少专门既有断言，不能用旧测试数量假装已覆盖。

### C05 — 剧情停滞是主控、状态兑现和测试方法的联合问题

旧局反复核验记录、身份、权限和回电，既有无结果的等待，也有测试玩家持续追问低收益程序的放大效应。这个现象不能仅凭 round 数定位到 Jev，也不能通过自动跳场景或补写模组内容解决。

offer 账的 1182 条记录、1370 次 offered、0 taken 初看异常；进一步按结构类型统计后，1370 次全部是 `stated` 规则供给，不是剧情线索或路线邀请。它不能被解释为“1370 个剧情钩子全被忽略”。该账只观测，不能反馈成守秘人欠下的推进义务。

下一步需要在公开结果层区分：玩家目标是否变化、NPC 是否作出可执行回应、等待是否实际推进时间、既有承诺是否得到兑现或明确失败、是否出现新的可选路径。用这些观察定位 producer→projection→actor 的缺端，而不是用关键词或固定重复次数强迫剧情推进。严格盲玩时仍不能通过偷看模组真相来判正确路线。

第二轮核查 1530–1540 的公开收据，最终报社移动有成功 move，返回的 `active_scene` 与 `where.scene` 一致；1538 也有政策 move，显式工具名不是判断它是否发生的依据。该处“叙述移动但没提交”的假设已排除，不能据此追加自动移动或结束战斗补丁。

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

## 第二轮整合与真实 driver 状态

前三项修复先提交为 `de86ad40f`。剩余根因修复位于隔离整合分支 `codex/jev-root-causes-20261005`；整合树已快进到主线 `1cad0d719`，新增的桌面 Fast 安装器三文件与本轮运行时代码不重叠。用户明确批准一次 Mac 隔离运行时构建，构建退出 0，组合既有测试 181/181、内核类型检查退出 0。未打包安装 App。

真实 driver 使用原战役的独立诊断副本和 Flapcode `gpt-6-luna / low`，原 v32 与原证据保留。v1 缺战役 Git 历史仓库，v2 缺当前战役私有图谱，两次都在正常游戏前失败；补齐完整依赖后标准 TS 开桌通过。没有改存档场景绕过失败。v3 发生下面的真实启动超时；这些失败均保留，不能计作 Jev 或暂停剧情验收。

### B05 — 首次握手错误套用普通消息超时

当前 Pi 在完成 session_start 后才开始处理 RPC stdin。这个真实长局的首次 get_state 用时 13.804 秒，而 driver 使用普通 ACK 的 10 秒，早于其本来提供的 30 秒启动就绪窗口。首次 get_state 改用既有 `STARTUP_READY_TIMEOUT`；后续 ACK 仍是 10 秒，没有增加重试或新配置。原 `test_driver.py` 75/75 通过，测试文件未改。

### B04 — 交付后为收据重读全局历史，且取到了下一回合

修复启动后 v4 两次实际输入分别验证暂停和恢复角色行动。暂停输入被判为 reference，没有 apply、resolve、时间或检定卡；恢复后的公开索引查询正常交付，Jev 八次调用合计 7039 ms、预算未耗尽。后者总耗时 205.1 秒，其中 narrate 工具返回到 operation_settled 为 40.111 秒。

已交付路径本来就跳过 freshOf，但为了收据又请求完整 table.status。长局的完整状态读取遍历 2339 份、约 208 MB 历史记录；narrate 已推进游标，它还可能取到下一回合的空收据。增加闭合 `projection: "receipts"`：ask 读仍在当前的回合；narrate 使用真实工具返回的 turn/commit，解析既有短提交号，读取它所属的一份记录，必要时从那次不可变 Git 提交提取。错误归属、非提交对象、缺少锚点和非法参数明确拒绝。

真实 v4 记录只读比较返回原三张收据，短/完整提交锚点分别为 33.363/41.888 ms，内容相等。完整 status 对照为 6.124 秒且返回下一回合空行；真实 40.111 秒含未单独计时的排队，不能全部归因于 CPU 读盘。修改后只增量编译两个入口，30 项既有交付/后果检查通过，没有第二次全量构建。普通 status 和非终端刷新不变。

v5 端到端复核仍有 37.981 秒尾段，只少 2.131 秒。因此本项确认修复收据归属和读取范围，**尚未解决真实尾延迟**。当前源路径在等待终端收据 RPC；日志中后台活动与 usage-prefetch 结束时间相关，但没有请求入队、出队、发送、回复的分段计时，不能归因某个后台任务。有限调查停在这条等待路径，不以微基准宣称整体提速。

### C03 追加 — 完整否定答案也被重复读取超时覆盖

v5 在上述修复后用真实 driver 观察柜台工作人员是否回避。169.5 秒后正常出文，只有一分钟时间卡，**没有 Psychology 检定**。interaction-scope 正确判为 world；social-method Noul 0.07 明确否定社交说服，但选择器随后无条件重读全量 options，耗尽剩余 lease，把已有 no_roll 改成 task_deadline。接着 Psychology 候选在零额度下被跳过。四次调用累计 12001 ms，不是模型已完整判断心理学后决定免检。

根因是候选生成已读到 options/capsule，选择器却再次前读，再对否定结果后读，把长局存储成本计入决定窗口。现已为候选保留本次签发的不可变数据，选择器直接使用；执行前仍核对 catalog/world/context 和输入绑定，有变化仍走一次刷新。不缓存 Jev 语义结论、加预算、降阈值或把检定交回守秘人。独立复核关闭了场景显示名误当标识的中间缺陷；八个既有文件 101/101 通过。

v6 真实 driver 的观察回合证实：社交免检正常返回（282 ms），Psychology 随后被选中（366 ms）并由政策 resolve 成功结算，机制包含 roll/time。最终 Jev 10 次 / 10035 ms，低于 24 次 / 12000 ms，未耗尽。因读状态而抹掉已完成判断、挤掉下一个检定的故障在此案例得到验证修复；不能外推所有旧 budget 样例。

同一回合的 driver 300 秒超时仍须保留为失败。超时时 narrate 尚未返回，7.234 秒后工具成功，44.520 秒后 runtime 才 delivered；终端工具尾段本身仍 37.284 秒。真实检定成功、迟到交付和限时 driver 失败是三个不同事实。下一条仅场外补看公开结果的诊断使用 600 秒传输观察窗口，未修改任何产品或 Jev 预算。长局读取/排队继续调查，尚无整体提速验收。

### B06 — 后台车道绕过前景门，阻塞已经写好的交付

v6 的场外补看在 63.3 秒正常完成，没有新机制。随后 v7 正常离开报社，297.4 秒交付真实 move。新分段计时终于区分了服务和排队：终端收据查询自身 29 ms，却排队 37873 ms；此前 memory.job 占 21684 ms，随后是 look/journal/voice/epithets，整段工具尾延迟 37904 ms。物品预取只占 192 ms；早先把它当成主要嫌疑的相关性被实际计时排除。

共同入口 `createLaneQueue.nextJob` 在检查 `agentRunning/foregroundPending` 前就移出了已提交任务，因此前景门只拦补抽。两行源码修复把现有检查前移，已排队任务保留到既有 agent_settled 唤醒；FIFO、独立车道、取消、补抽和 commit 事件都保留，不增调度器、不抢断已启动任务。13 项队列测试通过；后续真实 SDK 测试发现另一处明确要求“前景预留不拦已提交任务”的旧断言，对齐同一场景的释放时点后，四个既有文件 47/47 通过。

这只修已证实的交付抢占，不宣称启动时已经进入内核队列的 22 秒等待消失，也不删除有实际消费者的历史读取。未公开名字检查、旧台词与最早披露仍需完整来源；当前只读研究指出重复排序/规范化和过宽 preload 的优化候选，尚未改成新历史索引或语义缓存。

**v8 真实验证通过这一条。** 正常走到酒吧门口并查看门的行动成功交付，含真实场景收据。叙述工具尾延迟 **200 ms**；最终收据排队 **167 ms**、自身 **32 ms**，此前只余模块 claim 87 ms 和物品预取 81 ms，原先阻塞的后台车道不再挤入。与 v7 的 37904 ms 对照，尾延迟已消除到亚秒量级。两次输入不是同一句，不能据此宣称整体端到端加速比。

v8 总时间仍为 **279.69 秒**；Jev **5 次 / 10730 ms**、13 步，没有耗尽 24 次 / 12000 ms / 40 步额度。运行整体仍高于 45 秒软目标，启动、历史读取及模型等待继续存在。模型遥测仅为 Flapcode gpt-6-luna，保持请求 low（既有 compose 动态档位不改）。真实 v6 心理学选定/结算、暂停补看无新机制、v7/v8 正常移动与交付分别成立；未把这些诊断副本回合算作新两章盲玩。

### 本轮最终边界

- 已修：决定额度和截止时间、候选重复读取、按角色准备/原动作续接、终端收据归属、首次启动握手、后台车道的交付阻塞；提交中包含低侵入的原始输出与 RPC 分段观测。
- 未证实修复：旧空输出来自上游还是归一化缺收，仍待出现可对照的原始观测；更早的战斗滞留/全局剧情循环没有证据支持自动结束或强推剧情。
- 仍需后续优化/验收：长历史与启动读取成本；新增 NPC 续接竞态分支的专门覆盖；战斗、追逐、SAN、治疗整套新鲜自然全链；原两段实质剧情及结局。现有通过数量不替代这些目标。
- 验证层：一次获准的 Mac 全量隔离运行时构建；后续仅增量入口。181 项既有初始组合、75 项 driver、30 项交付组合、101 项选择组合、18 项传输组合、47 项队列/SDK 组合及内核类型检查通过，各组合有重叠，不能相加成独立总数。未重复完整大套件，未打包、安装或推送；原 v32 和所有失败尝试保留。
