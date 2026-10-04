# 文笔优化方案：大重构后接续（环境优化已恢复）

## 2026-10-04 恢复记录

用户后续原始消息已通过 `read_thread` 核实：源会话 `01a104b9-96e3-7401-b529-ee16ec848014`，消息 `01a107dc-fbbf-7023-bb01-c60ba4c98538`，要求重构完成并测试后恢复文笔任务。§183 已合入 `0.9.6a / 7b83acc22`；只恢复此前环境优化范围，尚未批准的 NPC、卡库和新增实验继续作为建议保存。

新检出为 `codex/environment-after-mod-refactor-20261004`。旧临时检出和编译队列已关闭，不再使用。只读取得重构在测试机上实际测试的同提交编译产物；1231 个文件哈希一致，608 个内嵌源码与当前源码一致。当前源码的十一项指导接线/系统语言检查通过。原 App 尚未包含重构，因此本轮建立源码运行基线，不宣称 App 验收。

新接口以 `contributes.sections` 和 `sections.json` 声明章节；`brief.md` 与共享 5000 字节上限已退役。文笔包当前为 2.2.5，环境措辞仍是 2.2.4 的内容。默认预算内供应全文；超预算才按既有主题、状态与调用触发加载章节。原来的“精简 brief”方案不得直接搬入；本次不改选择器、预算、章节职责、NPC、状态或机制。先用 `flapcode/gpt-6-luna / low`、已配置 Jev 与当前运行时做真实短桌；只对实际观察支持的环境措辞作窄改，一稿交付，禁止 Astra 和自动文学审查/改写。

本轮证据：`.coc/evaluations/environment-after-mod-refactor-20261004/`。下方暂停记录和候选方案保留为历史及后续建议。

### 同一运行时代码下的环境改动与实测

2.2.6 仅在原环境段落中引入“听”的观察中心和一个连接、收束细节的句子；原段落的所有首次可见、原文完整读出、回访、隐藏边界与静场要求保留。NPC 段、其他章节、style、sections.json、口吻车道及状态/设置/能力全部不变。契约137.12先于改包写入；带工具 Luna 作者的完整草稿、根会话保留原义务后提取的两处原句以及哈希证明均已保存。

当前运行时代码固定7b83acc22，两个全新战役分别锁定2.2.5和2.2.6、natural-npc1.4.6；模型均为Flapcode gpt-6-luna，要求low，hybrid-v1和Jev配置已核对。本会话逐句作为唯一玩家，两边各四个真实回合。抵达、外观、静场中，候选出现了更多沿声响与空间位置展开的细节；抵达不再以旧版明确的“房子没有给出答案”收束，外观未读出室内锁栓。办公室仍有说明性概括，静场仍有泛化拟人收尾，外观还添加了未由该资料包确认的风化、脚印与可见性判断。源事实保真和稳定文笔仍未验收。两边开场和生成的NPC材料不同、玩家知道配置，不是盲化配对或因果/速度证明。候选的十一项接线/系统语言检查通过，不代替上述文学与玩法证据。

独立状态发现不归给措辞：旧版一次输入结算了两次30分钟移动；Keeper用未知owed名字将诺特写到here；声明半分钟等待时旧版收据为3分钟、候选为5分钟。原始记录完整保留，初版派生摘要把旧版时间误写成“无收据”的错误已单独更正。此切片不修内核、宿主或NPC，不用更多文笔提醒掩盖这些问题。

统一协调者随后合入cb6634bb0的natural-npc1.5.0，明确要求先完成冻结比较，再在自有检出兼容新主线；本任务不自行合主线或打包，App由指定owner处理。以上回合只能归属于实际7b83acc22运行时；后续兼容验证另列，不冒充新主线实测。

2026-10-04：用户要求先停下优化，记录方案，待大重构后再考虑重新实现。定时续做已暂停，编译排队已终止；不会自行恢复。暂停时主线为 `0.9.6a / 81fcfea70`，这只是历史快照。以下实施顺序是接续建议，记录方案并不等于批准重构后扩展卡库、修改 NPC 或沿用旧代码。

## 要解决的问题

让 NPC 根据当前听者、关系与地位、知道的事情、眼前风险、此刻情绪和交流目的说话，形成连贯的口语，而不是拼接信息、堆语气词或反复解释后果。环境描写要跟随实际视点、路线和感官接触，把可见细节组织成完整段落；紧张与释放来自已经成立的情境，安静的等待也可以没有异动。优化同时要减少无关上下文，保留玩家选择、知识边界与事实依据。

## 已完成什么，证据能说明什么

- 小说对白与环境研究、原文定位资料、角色与场景分析、Pro 简报和卡片实验均已保存，可作为重构后的资料来源。样本研究不是全书穷尽分析，也不能保证覆盖所有模组风格。
- 小规模卡片实验中，精简指导加静态八卡获得最多模型偏好票；动态 Jev 没有证明优于静态卡，也没有证明加速。实验缺少“精简但不带卡”的对照，不能分离精简、示例和选择器各自的作用。实验包 `99.0.0` 与约 4500 字节的离线精简基底均未获生产等价验收。
- 六模组、十二个场景快照的比较中，Pro 整段组织简报在环境样本获得 8.5 对 3.5 的偏好票，NPC 样本为 5.5 对 6.5；因此只采纳环境部分。十二次辅助卡选择全部为 `NONE`。这些是同一模型家族的意见，存在评审范围限制，不能当成人类评价、统计优势或所有故事的覆盖证明。
- `Narration Craft 2.2.4` 已改环境段落与 `place-the-eye` 提醒，保留 NPC 部分、口吻车道、状态与接口。十一项历史接线检查通过，说明指导能送达，不证明文笔稳定改善。
- 后续六回合游玩用了 10 月 2 日的旧编译产物，且 Jev 准入未配置。它是真实的历史游玩，但对当前版本验收属于 `invalid-for-acceptance`；“未结算却叙述抵达”等现象不能直接认定为新版缺陷。已对齐源码的新版编译和实测均尚未开始。

## 重构后的候选方案

**第一层：保留生产职责。** 常驻必要的事实权威、身份与知识边界、结算和玩家选择规则，并供应本回合所需事实。模组全文和角色长历史仍按需读取。不能把这些职责迁入可选文笔卡，卡片也不能创造事实、结算或授权。

**第二层：紧凑的常驻文笔简报。** 以本回合的行动或问题为中心，沿空间、时间、因果、感知或对话的一条线组织段落，给关键时刻足够篇幅，在结果或真实可见边界处收束。避免固定句数、强制长短句轮换、每段必须悬念、每句必须口头标记等规则。优先重测已有 2.2.4 的环境指导，不整包替换 NPC 指导。

**第三层：按需辅助材料。** 模组风格简报、当前场景材料、NPC 身份与知识、对当前听者的目的与反应，以及少量可组合的方法或示例卡。Pro 可离线帮助写简报和卡片；带工具 Pi 从资料读写产物，引用回到真实原文位置，由宿主精确取出材料。每个模组只形成有依据的小简报；玩家提供的新模组先用通用指导，再据实际材料补充。开放情境由模型判断，不能用题材、情绪、性格关键词表硬分。

只有较大卡库实际显示必要时，才尝试“宿主召回有界候选 → Jev 选择有帮助的卡或 `NONE` → 宿主按预算供应”。固定时间、字节和数量预算，缺失或失败时回到常驻简报。Jev 选择辅助方法，不写台词、不代写 NPC 情绪、不修改世界状态。保留守秘人一次成稿，不添加强制在线文笔复核、改写或额外作者调用。

## 大重构后如何接续

1. 先读新架构和届时最新主线，核对实际源码、编译产物、启动记录、App、模型与凭据。重新追踪“谁写指导、谁把它送入请求、守秘人如何据它写作”；旧路径、旧字段和旧编译产物只作历史参照。
2. 用新接口建立新鲜基线。先区分事实/状态/知识投影失败与措辞失败：前者按新架构的权威路径修复，不能靠增加文笔提醒或手写一处内容掩盖。
3. 在相同来源、结果与知识条件下，对比当前完整指导、生产等价的精简无卡版、精简加静态少量卡、精简加 Jev 四种配置。需要精简时先证明生产职责完整；不能直接搬离线基底。覆盖中短模组、长篇战役和真正新提供的模组，分开看 NPC 与环境表现。
4. 离线盲读与真实短桌分别记录。真实游玩仍由本会话逐句当唯一玩家，经届时的标准驾驭器走产品路径；测试使用 `flapcode/gpt-6-luna / low`，禁止 Astra。检查空间连贯、自然口语、静场与危机场景，同时核对收据、可见性、身份、知识和玩家选择。
5. 测量实际请求 token、缓存、额外调用和首次可见正文时间，不能把材料字节或单次 Jev 耗时当成玩家回合提速。只采纳有证据的窄改，再验证真实运行时与 App；保留旧战役锁、所有原始证据，以及明确的开启/关闭边界。后续扩展范围由用户决定。

## 资料与恢复入口

- [NPC 对白解构总报告](/Users/haoli/Documents/TRPG/小说/对白研究-20261001/NPC对白解构总报告.md)、[人物分类与语言习惯索引](/Users/haoli/Documents/TRPG/小说/对白研究-20261001/人物分类与语言习惯索引.md)。
- [文笔与环境张力总报告](/Users/haoli/Documents/TRPG/小说/文笔研究-20261003/文笔与环境张力总报告.md)。
- [卡片实验结果](../../.coc/evaluations/context-card-pilot-20261004/RESULTS.md)、[跨模组比较](../../.coc/evaluations/cross-module-craft-20261004)、[2.2.4 采用与旧游玩证据](../../.coc/evaluations/environment-brief-adoption-20261004)、[新版基线与暂停记录](../../.coc/evaluations/prose-current-baseline-20261004)。
- [Pro 讨论：设计中文 TRPG 实验方案](chatgpt-conversation://6ac1f3db-1370-8331-b2cc-f693ab4e7035)。

研究资料和原始证据继续保留。临时工作检出在本次文档保存后关闭；重构后从新主线重新建立工作检出，以本文件作为方案入口，不能从旧检出直接续跑。

---

## 历史实施记录：环境简报 2.2.4


Approved intent: apply the cross-module study's narrow recommendation. Improve environment passage organization while retaining the current NPC guidance and every existing source/state/interface duty. A brief version bump alone is not success; the changed advice must reach actual Keeper requests and be observed in a small genuine player run.

Base: 0.9.6a at60d5afc55f0b4c591d07d1fcb1d0a846391aeb5b; current Narration Craft2.2.3. Owned branch/check-out: codex/environment-brief-v224-20261004 at /Users/haoli/.codex/worktrees/environment-brief-v224-20261004/chatrpgv4-wt-pi-coc-v2. Shared Blood Road plan, Chinese NPC spec and image probe are outside scope.

Scope: versioned Narration Craft environment instructions, relevant existing compact reminder/scene-style projection, dated contract addendum/changelog and necessary version fixture. Preserve the NPC section byte-for-byte, voice lane, package capabilities/state/settings, first-visible detail/readout duties, identity/transaction/agency rules, and one-pass delivery. No new card library, Jev invocation, prose review/rewrite, runtime schema or semantic keyword filter. Experimental source/marker concerns do not justify an unapproved kernel/API rewrite.

Evidence chain: a native tool-enabled Flapcode gpt-6-luna low author drafts the contract and small candidate; root materializes the accepted contract before package edits. Kernel buildCapsule/styleSection and context policy carry full package guidance on entry and reminders/axes thereafter. The live Keeper writes the passage. Existing package/lock/on-off/request-capture and budget tests verify that chain, not literary quality.

Results to preserve: six modules/twelve snapshots yielded environment preferences P8.5/A3.5 but NPC P5.5/A6.5; same-family opinions with review-scope limitations. All12 method selections returned NONE. The 4500-byte offline lean base is not production-equivalent and is not installed. Source epistemic and speech-format failures remain open; guidance cannot certify semantic safety or all story types.

Ready: author and scope review; contract before package; budget/request capture checks; short real driver run with root as sole natural-language player and Flapcode gpt-6-luna low; scoped source integration; ordinary Mod installation into the canonical App's writable library if compatible; retain old saved locks/evidence; lifecycle closeout and final audit. No App bundle rebuild is planned for a data-only Mod update.

## Implementation checkpoint

The first native author draft was rejected for changing NPC reminder clauses and malformed multiline JSON. One bounded refinement produced a compact environment section and directive. Root materialized the authored observer-recognition clause, retained the original pressure/cost sentence, omitted editor-only scope instructions and used the existing directive's short prefix within budget. Contract137.11 was installed before package edits. The package is2.2.4; only Scene and detail and place-the-eye changed. NPC section, compact reminder, voice lane, other style directives/axes/beats/floor and manifest/state/settings/capabilities are unchanged.

Eleven existing focused checks passed on Node24: real legacy/hybrid-v1 provider-request capture, package version/shape, exact full/brief assembly, shared5000-byte brief ceiling, language-specific ceiling, disabling the package and system-language guards. No runtime build or full suite was run; this package-only slice reuses the existing compiled runtime read-only. A new isolated live home installed2.2.4 through mods.install and reported compatibility. The canonical driver confirmed flapcode/gpt-6-luna before play; root is the only player. Live and App delivery remain to finish.

## Delivery and observed limits

The package commit is0d7334861, integrated into current0.9.6a at555260904. All eleven focused checks passed again on the integrated source. Canonical /Applications/PipiCOC.app's own kernel installed2.2.4 through ordinary mods.install into its writable Mod library. An isolated App-kernel new-campaign probe selected2.2.4 by default and reported compatibility; no App bundle rebuild, GUI acceptance or existing saved-lock upgrade occurred.

The genuine canonical driver run environment-brief-v224-live-20261004 completed six root-player turns with only Flapcode gpt-6-luna observed, requested low. It confirms version delivery and a spatially linked exterior observation, but quality is mixed. Turn2's action-admission review yielded without settling the batch; the Keeper nevertheless wrote arrival/item effects and turn3 described the wrong state location. Those are invalid for movement/source-location acceptance. Turn4's unchanged resend succeeded and produced actual move/map receipts. Turn5 still described side-door bolts from an unverified exterior viewpoint. Turn6 introduced a source-pressure thump during quiet waiting without a time receipt; it does not establish uneventful waiting or settled elapsed time. Prior uncommitted item/cash effects were not silently claimed as settled.

All run/campaign/telemetry/model/package evidence stays in the primary checkout under .coc/evaluations/environment-brief-adoption-20261004 and .coc/playtests/environment-brief-v224-live-20261004, with original texts intact. The driver is stopped. No hidden-source/template/fake-player shortcut, new online selector or prose rewrite was added. NPC-section bytes, reminder and voice lane stayed unchanged.

The scoped environment guidance adoption, source integration and ordinary App Mod installation are delivered. Source-faithful prose, actual action/time reconciliation, broad style coverage and literary improvement remain unaccepted. These failures require their own confirmed runtime/source-projection repair path; this small craft slice does not claim to fix them. Final lifecycle audit/closeout follows after this report commit; concurrent main changes are preserved.

## Current-version correction and continuation

The owner requires optimization against the current version. A subsequent read-only provenance audit found that the six-turn run above loaded the primary checkout's October 2 emitted runtime rather than its October 4 source. The kernel extension's embedded source matches cd7bf8d1e; its admission source matches b0114b08d. The run's typed admission reported unconfigured. These facts make that run invalid-for-acceptance as evidence about the current integrated runtime. Its original records remain intact and still document the older runtime's behavior; they do not establish a current regression or justify a new runtime repair.

The new baseline is the latest numbered product branch, 0.9.6a at fcb8655e1ac197f3599911002f14b8530c29d2a7. Task-owned checkout: codex/prose-current-baseline-20261004. Build its exact source separately, verify embedded source identity and startup engine/model, supply the existing Jev credential through the existing vault reader without persisting it, then play a small genuine natural-language sequence with Flapcode gpt-6-luna low. Evaluate the installed 2.2.4 guidance before authoring further environment changes. New wording is warranted only by observations on that aligned baseline; preserve the existing NPC, state, agency, source and one-pass boundaries. The canonical App is under concurrent ownership and is not replaced by this validation task.

While the LAN build was still queued, main advanced to 81fcfea702902b4d80abe93ba37730cbc49d2248. The owned checkout fast-forwarded to that same revision before compilation. Section179 adds carried-record content to the capsule and directs willing NPCs to give the answer sought, retaining knowledge and disclosure limits; Narration Craft2.2.4 is unchanged. This is compatible with its existing full-readout and conditional response duties. The current baseline is recorded in .coc/evaluations/prose-current-baseline-20261004/current-baseline.json; prior frozen inputs and preflight remain attributed to their original source. Runtime verification reads the current baseline instead of a hard-coded initial commit.
