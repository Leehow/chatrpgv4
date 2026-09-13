# PDF 直接阅读与按需构图

状态：选择性读页、独立复核、早期骨架及 PipiCOC 接入已实现；同一本 Masks 的秘鲁章节与结算已通过实际内置浏览器流程完成。第二次全新导入约 114 秒、读取 16 页后发布有效骨架；开场经失败保留与重试后才通过复核。真实游玩在第 64 回合结束章节，第 66 回合经原文补读完成遗漏的奖励与成长，当前第 67 回合等待玩家、未开始下一章。以下失败、修复与旧集成记录全部保留；不宣称无中断的速度基准。

父规格票：[GitHub #34](https://github.com/Leehow/chatrpgv4/issues/34)。本文件保留本地实施指引；后续拆票以本规格的用户故事、候选切片和验收为依据。

## Problem Statement

用户要一个简洁的 Pi-Coc 基础框架：输入真实 PDF，由多模态 Pi 读者读成能主持游戏的细粒度图谱；长本按需细读；验证后拆掉旧解析流水线。后续授权的 PipiCOC 界面接入与浏览器验收由 [onboarding 规格](pipicoc-pdf-onboarding.md) 衔接。

成功是从产品入口导入、建卡、开桌，遇到未细读内容能补读后继续，重启和另开一局能复用成果；旧入口与依赖已退役。只有页图、JSON、绿色单测或“解析完成”的报告，尚不能证明成功。

本文记录设计理由、实施顺序和验收。接口、状态、来源和提交语义的唯一规范在 [kernel-rpc.md §22](../kernel-rpc.md#22-visual-pdf-reading-and-demand-driven-graph-building)。实现前读该节；涉及 Pi 进程与图片输入时再读 [Pi 宿主契约](../pi-host-contract.md)。

## Solution

用户选择原 PDF 后，Pi-Coc 自行定位作者结构与当前所需原页、细读开场并构建可玩的图谱。长本的其他部分在游玩需要时补读，必要材料就绪后才结算；已有模组与战役可续行复用。对用户而言只有选书、必要的开场选择、建卡与游戏，不需要操作 OCR 或资料包。

## User Stories

1. As a player, I want to choose a local PDF and prepare a game, so that I do not need to produce an OCR or Markdown bundle.
2. As a player, I want Chinese filenames to work without inventing an internal identifier, so that setup uses the book I selected.
3. As a player, I want scanned and text-based books to follow the same flow, so that document format does not change how I start playing.
4. As a player, I want to choose the language of play independently of the source language, so that an English book can support a Chinese game.
5. As a player, I want setup to ask only consequential choices, so that ambiguous openings are resolved without exposing processing internals.
6. As a Keeper, I want the reader to see page layouts, maps and sidebars, so that visually meaningful material survives into the graph.
7. As a Keeper, I want small print and numerical tables to be inspected at a useful scale, so that difficult details are not guessed.
8. As a Keeper, I want fine-grained authored facts and relationships, so that an NPC or scene has usable material rather than only a summary.
9. As a Keeper, I want facts, beliefs, rumors and lies to remain distinct, so that the graph does not turn character testimony into truth.
10. As a Keeper, I want source-grounded navigation from the book structure and selected pages, so that I can find global dependencies without first reading every page.
11. As a Keeper, I want the opening to include its global and cross-page dependencies, so that local preparation does not contradict the campaign.
12. As a player, I want a long book to become playable before every branch is finely extracted, so that unused detail can wait.
13. As a Keeper, I want the same reader to handle initial and later reading, so that there is one route from source evidence to the graph.
14. As a player, I want an unprepared destination to be read before its dependent action settles, so that the game does not invent the missing room.
15. As a Keeper, I want to request further detail about a previously read NPC, so that an accepted chapter does not prevent useful new questions.
16. As a Keeper, I want cross-chapter references to reuse existing identities, so that reading the appendix does not create a second copy of a person.
17. As a player, I want the material needed now to take priority over background reading, so that prefetching does not hold up my action.
18. As a player, I want a bounded and resumable wait for missing material, so that a slow reader does not lose my input or trap setup indefinitely.
19. As a player, I want cancellation to stop owned reading work without undoing prior game events, so that I can safely interrupt a wait.
20. As a player, I want missing material to leave dice and the pending effect batch unchanged, so that retrying cannot duplicate or alter an outcome.
21. As a Keeper, I want important facts checked against the original page in a fresh reading session, so that extraction mistakes have a chance to be caught.
22. As a maintainer, I want structural validation to remain separate from semantic review, so that a valid reference is never advertised as proof of truth.
23. As a Keeper, I want contradictory sources or uncertain readings to remain visible, so that later extraction cannot silently replace accepted facts.
24. As a maintainer, I want source references to distinguish physical PDF pages from printed page labels, so that citations and crops stay reproducible.
25. As a player, I want only revealed handouts and safe map regions delivered, so that source images do not expose Keeper-only annotations.
26. As a player, I want reopening a campaign and starting another campaign to reuse published module material, so that the book is not read again unnecessarily.
27. As a maintainer, I want byte-identical copies reused and different editions distinguished, so that matching titles or page counts do not merge different sources.
28. As a player, I want existing games and assets to remain readable after migration, so that retiring the old parser does not destroy previous work.
29. As a maintainer, I want reading and publication to recover from crashes and competing sessions, so that a partial draft cannot become the current graph.
30. As a maintainer, I want acceptance to exercise the real Pi setup and play path, so that fixtures or scripted players cannot substitute for product evidence.
31. As a maintainer, I want the old OCR and text-bundle path removed after replacement is validated, so that the product ends with one supported reading route.
32. As a maintainer, I want measured preparation time, waiting time and model usage on actual books, so that later optimization is guided by evidence.

## Implementation Decisions

1. 保留一个 ModuleStore、一个 ModuleGraph 和静态七动词面；规则计算、世界事务、逐回合收据与历史的权威不变。读者产出的作者事实与战役中实际发生的事件分开。
2. 来源保留为不可原位替换的原 PDF；宿主用一个 PDF.js 实现提供页元数据、按需渲染和裁剪。Python 内核只校验来源描述与字节身份，不解析 PDF。当前路径不以文字提取、OCR 或 Markdown 资料包为前置条件。
3. 沿用带工具的 Pi 读者；定位、开场、细读共用一种执行形状与一条队列。关键事实复核使用该读者的新会话，不另建 OCR、协调者或审核平台。
4. Pi 先用原生书签、目录、作者概览和少量必要原页建立骨架，自主选择后续阅读。导航中区分「原书声明的范围」与「实际已读的页」，不能因目录列出章节就声称读过正文。首次可玩不以全页覆盖或固定页批完成为前提。开场依赖的全局真相和后置材料必须核实，其他分支保留未读与明确的补读入口。
5. 抽取颗粒度由游戏事实决定；固定大小的文字切片不再限制阅读范围。人物可横跨正文与附录取材，实体标识和别名复用。
6. 来源引用使用机器关联的原文件身份、物理页和可选裁剪；读者分片版本与现有运行时图版本分开。既有图谱不需要为退役 OCR 而整体重建。
7. 阅读请求按来源、范围和确切问题去重；读取过一个章节不等于满足该实体后续的所有问题。当前需求优先于开场和邻接预读。
8. 材料前置检查发生在 RNG、收据和效果批写入之前。扩展在当前回合中驱动前台阅读，等待期间释放内核执行队列；成功后重新校验原动作，失败不推进该批世界状态。
9. 结构校验与语义复核职责分离；重要数值、条件、因果和身份真假关系对照原页复核。没有出处、读不清或存在冲突的必要内容不能强行发布为 ready。
10. 当前采用一个带工具 Pi 自主选页并产出本次草稿，再由最多 40 个独立 Pi 复核有界节点／关系组；所有源读者与复核者共享宿主的 40 进程容量。前台问题和后台补读各可占一个任务位，同一标准化目标等待前一份材料发布。禁止为填满并发自动切全书；实验性的多作者分派框架没有进入产品。统一路径核对来源、身份、依赖与冲突并原子发布，恢复和幂等沿用持久任务、锁与代际。
11. 建卡调用统一的模组准备接口；现有模组和 starter 保持原职责，多开场选择沿用已有选择机制。来源处理进度不成为玩家叙事。
12. 旧路径删除有明确终点：替换可验收后移除 OCR、Markdown 资料包及旧编排入口，保留原文件、旧图谱、存档、资产和全部玩测证据。接口细节以目标内核契约为准。

## 2026-09-07 correction and selected design

The earlier all-page navigation requirement is superseded. Its 432/669-page Masks run is retained as historical evidence, marked `invalid-for-intent` and `invalid-for-fast-opening-acceptance`. Its semantic index must not seed a new cold experiment. The experiment history below records the decision process. Production now queues selective opening/detail work directly; current integration and browser evidence are recorded at the end.

### Implemented source-reading design

One tool-enabled Pi reader owns source discovery and the reading plan. The host provides original-page access, bounded parallel execution, deterministic checks and atomic publication. Native bookmarks and page labels are navigation hints, not authored facts. With missing or broken navigation the same reader inspects the beginning and follows source evidence; the host does not guess headings or schedule a full scan.

When those navigation hints and known source refs cannot locate a visually distinctive page, the same private PDF tool may return one fixed contact sheet for at most 20 contiguous physical pages. Its labelled tile manifest is navigation only: it is recorded separately, never enters source observations, and cannot support facts, maps, handouts or review. The reader must nominate candidates and reopen their exact original pages before writing source-backed material.

The high-level preparation service first publishes an independently reviewed, sourced skeleton containing structure and authored entrances in the existing ModuleGraph vocabulary. A named future scene remains unprepared. The production checker requires skeleton `ready_nodes` to be exactly empty; opening readiness also requires the start scene to occur in accepted/current prepared material. An unrelated detail publication cannot make a thin opening playable.

For the selected opening, Pi follows current actors, motives, knowledge/lie distinctions, clue conditions, source-edition numbers, handouts and global/cross-page dependencies until the immediate interaction is supported. A fresh pool independently checks bounded node/claim groups with the complete candidate context, up to 40 concurrent sessions. All use read/write/edit/bash and private original-page access. Only the host dispatches children; leaves cannot recursively delegate. No fixed page cuts, whole-chapter quotas, second graph or OCR path.

Unresolved questions affecting the prepared scope block readiness. Unused chapters remain explicitly unread. Later source requests use the same reader and facts already published; a new question about an old NPC is not skipped. Character creation may overlap preparation once source/entrance selection is stable. UI progress names actual milestones, not an all-book percentage.

### Historical sandbox decision protocol

The following records the experiment protocol used before selecting the implementation. Its two-minute skeleton and five-minute reviewed-opening budgets were provisional hypotheses. Production integration has since proceeded under the user's instruction to continue; neither the protocol nor a fast skeleton proves stable five-minute opening performance or completed browser gameplay.

Run under isolated local directories and repository-local Pi homes, with production state and previous semantic results unavailable. Use xai/grok-4.6, low thinking, and retain actual provider-request metadata, source-image events, prompts, drafts, reviews and wall-clock milestones. Source bytes are identical; each cold trial starts without a prior semantic index. Page cache reuse and provider cache tokens are reported separately.

1. Start with a single autonomous reader on the exact 669-page Masks source, preparing the Peru opening. Compare selective parallel work only when the reader has identified independent questions. Do not dispatch 40 empty or artificial tasks.
2. A separate source-only Pi reviewer establishes a checklist before seeing candidate output. Check current opening facts, global dependencies, mechanical conditions, identity/lie distinctions and dangerous handout crops. The main assistant checks disputed/high-impact items against original pages. Model agreement is not a proof of exhaustive completeness.
3. Repeat cold preparation after correcting failures. Require no unsupported or missing current-play-critical item in the reviewed checklist; unresolved required source material must stop readiness. Count critical omissions, contradictions and correction rounds, not just node totals.
4. Exercise cold next-scene reading, an already-known NPC with a new question, and a later-source dependency. Reuse identities, preserve accepted facts and find the new material without rescanning the book. Add Cold Harvest alternate openings as a targeted ambiguity regression after the Masks experiment.
5. Record first skeleton, first accepted opening material and each on-demand wait separately. Working performance budgets are 2 minutes for a useful skeleton and 5 minutes for reviewed opening material; they are hypotheses to test, not product promises or permission to omit facts. A miss triggers measured optimization and remains a failed performance gate. Repeat at least two fresh semantic trials for the selected approach before production migration.
6. Only after quality and performance evidence supports the approach, implement the smallest production change, run existing kernel/extension/UI gates, and resume the original in-app-browser upload/character/full-chapter acceptance. Sandbox extraction is not a substitute for gameplay.

External cross-check: PDF.js exposes native outline/page-label navigation, and Anthropic's context-engineering guidance describes agent-led just-in-time retrieval. These support selective source access, but neither proves this game's dependency coverage or speed. The old 0.8.2a planner/skeleton/opening-only implementation supports author-led structure and demand reading; its earlier text extraction and unfinished host dispatch are not being restored.

## Testing Decisions

主要验收 seam 是现有 Pi setup/play 入口：原 PDF 进入，游戏行为与 canonical 收据出来。确定性检查优先走现有扩展与内核接口，页面处理仅补必要的机械测试；不另造一套 Keeper 或测试框架。

### 确定性与接缝

1. 渲染：真实 PDF 页数与物理页序一致；中文/扫描/旋转页/地图/小字裁剪可视核对。引用越界、错误文件、非法裁剪与缺失页图被拒绝。
2. 内容发布：无效分片、未通过的关键事实、过时代际冲突不进入可玩图；成功只发布一次。未读部分不被误判为完整模组；已有数据和资产保持可读。
3. 调度：前台请求能在玩家回合中执行，不被旧 `turnInFlight` 禁止后台读取的规则饿死；取消、超时、进程崩溃、重启及两个会话争用同一模组有明确结果。
4. 事务：材料不足时该批状态、收据和 RNG 不变；读取完成后用同一原始动作重新校验；旧结果重放不再读书或掷骰。
5. 补读：同一 NPC 新问题能读已处理章节；跨章正文/附录引用可解析；冲突有来源比较，不静默覆盖旧事实。
6. 退役：新入口在 OCR 凭据和旧提取命令均不存在时仍工作；执行链没有旧编排方法；内核继续不导入 PDF 库。

实现阶段运行 `uv run --frozen python -m pytest tests/kernel tests/play -q` 与 `npm run test:ext`；不并发运行两套 pytest，记录真实退出码和残留进程检查。

### 真实产品路径

按 [acceptance.md](../acceptance.md) 使用 `tests/play/driver.py` 启动 `bin/pi-coc-setup` / `bin/pi-coc`；当前 PipiCOC 任务由用户明确授权以内置浏览器替代驾驭器作为传输。两者都要求 Grok 当守秘人、主会话为唯一玩家，一次一句自然输入，持续到自然结局或真实阻断。没有脚本玩家、手填图谱、假 Keeper 或直接内核造景替代。

| 样本 | 必须观察到的事实 |
| --- | --- |
| 含扫描页、图或小字表格的真实短本 | 从原 PDF 产品入口完成建卡、开场和游玩；场景、线索条件和实际用到的数值能定位到原页；至少一处确实通过看图取得的内容进入游戏 |
| 多章节且有跨章引用/后置附录的真实长本 | 仅用作者结构与必要原页建立骨架，开局仍有未读页；玩家的正常选择触发冷内容细读；必要附录先读取后结算；已有 NPC 的新问题触发针对性补读 |
| 同来源复用与恢复 | 正常退出再续行，已发布内容复用且未发布工作可恢复；另开新战役复用同一本书，世界状态相互独立 |

至少人工逐页对照开场与真正使用的关键事实；报告漏读、误读和复核漏检。记录首次可玩时间、定位/抽取/复核分别用时、前台等待、图片阅读次数和实际可取得的 token 用量。没有预设速度承诺；这些数据用于判断质量和等待是否值得接受。

结果标记必须分清：接缝通过、真实 PDF 阅读通过、真桌通过、旧路径已删除。真实阻断意味着对应验收尚未通过；不能用绿色测试补记通过。Electron 接入与真浏览器验收已由用户另行授权，见配套 onboarding 规格；不能用页面上线替代源材料质量验收。

## Out of Scope

本规格不扩展为通用文档平台、规则引擎重构、向量数据库、额外知识图谱、供应商原生 PDF API 适配、OCR 备用链路或模组导入导出产品。用户后续授权的 Electron/UI 改动归配套 onboarding 规格管理。

当前交付仍以单个完整 PDF 为一个来源；同一模组的多卷合并和外部附件关联列为后续范围。扫描衍生件、规则书、重复副本和附件不会因为与正文同目录就被自动并成一本书。

## Further Notes

### 已抽读的真实资料与验收选材

2026-09-07 清点用户提供的两个本地资料目录：89 个 PDF，77 个不同文件摘要，含重复副本共 7,204 个物理页。该数量包含规则书、手卡、地图和旧解析衍生件，不是独立模组数。本次对 10 份代表文件做导航性抽读，实际查看 16 张页图；没有通读全部正文，也没有生成游戏图谱或完成真桌。

下列页码均为 PDF 物理页，从 1 起。它们用于选测试材料，不预设玩家行动或 Keeper 剧情。

| 顺序 | 固定样本 | 已观察的材料 | 对应验收价值 |
| --- | --- | --- | --- |
| 首条完整链路 | 《他们也没想太多》，20 页 | 第 5 页的双栏正文、侧栏与数值材料；抽读正文和后段人物材料 | 最小真实短本，先证明原 PDF 到可玩的闭环 |
| 开场与视觉回归 | 《冰冷的收获》，48 页 | 第 5 页有不同开场，第 17 页为几乎无可抽文字的整页地图；抽读第 15–20 页 | 选择出口、地图来源、NPC 区分、跨页条件；保留旧 #33 的产品问题作为回归意图 |
| 首个长本 | A Time to Harvest v1.2，338 页 | 第 5–6 页的视觉材料/目录、第 12 页的背景与分支说明；抽读第 11–14 页 | 先用结构清楚的单文件长本验证全局准备与章节按需阅读；正文后段和附录仍需在实施验收时实际读取 |
| 更大长本 | Masks of Nyarlathotep v1.8，669 页 | 第 5 页目录、第 100 页剪报手卡；物理第 100 页印刷页码为 97 | 跨地区非线性阅读、大索引、手卡、页码映射与重复来源；不能把主样本通过等同于整部战役已跑完 |
| 针对性补充 | 《不息的渴望》，41 页 | 第 5 页背景/侧栏，抽读前段及第 14–16 页 | 循环背景与当下场景的区分；不借此扩大世界线实现范围 |
| 针对性补充 | 《血色公路》，111 页 | 第 2 页视觉拼贴、第 20 页地点材料；抽读第 20–22 页 | 与 Word/常规书籍不同的版式、地点索引与细事实 |

《Masks》另一个同名文件也是 669 页，但字节摘要不同；部分目录和第 100 页视觉相似不足以证明整本同版同内容。验收固定 v1.8 这一份及其摘要是为了可重复性，不以文件较大推断质量更高，也不自动合并两个来源。

《东方快车》的 Book I 为 78 页、Book II 为 268 页、Book VI 手卡册为 196 页。已抽读 Book I 的前段和第 9 页、Book II 目录、Book VI 的前段及第 5/9 页：概览、冒险正文、手卡是不同职责，概览册不能独自冒充完整可玩模组。多文件来源属于后续范围，当前长本验收采用单文件合订本。

来源调查对原方案的补充：

- 印刷引用必须经原页或可靠页标签定位到物理页；不能把样本的偏移量套在整本或另一版本上。
- 地图和剪报可以沿用现有 asset/handout 与来源裁剪，不为每一种视觉版式新造节点种类。图上可见性仍需区分 Keeper 材料和可揭示部分。
- 同一书的不同开场、可选章节和 classic/pulp 材料不能混成一组无条件事实。验收使用当前支持的 CoC7 规则路径，不增加 Pulp 规则引擎。
- 已否决把 669 页全部浏览作为开场前置条件。必须分别测量首次骨架、首次经复核开场材料和真正可玩时间；允许必要预读，不允许把全书扫描藏进定位阶段。
- 文本辅助只用于此次调查导航。新产品的视觉路径必须用实际图片工具事件、原页对照和游戏结果另行验收。

### 后续分票草案

这是一张父规格的候选切片，不在本轮创建一批实现票。拆票时每票携带用户故事、依赖、可观察结果与验收样本，不按某几个文件完成就算交付。

| 候选票 | 依赖 | 可独立审阅的交付行为 | 主要样本 |
| --- | --- | --- | --- |
| A. 读者可以正确看见原页 | 无 | 实际 Pi 读者打开页图、放大小字/地图、报告可回查来源；模型不支持或取消时有明确结果 | 《他们也没想太多》及《冰冷的收获》的指定图页 |
| B. 一份 PDF 可以准备并开桌 | A | 定位、细读、复核、发布与建卡形成完整新路径；多开场能解决，缺必要材料不能假 ready | 20 页短本，再以《冰冷的收获》回归 |
| C. 长本在需要时补读 | B | 长本仍有未细读区域时开桌，冷内容及已有 NPC 的新问题通过同一阅读路径补齐后结算 | 338 页 A Time to Harvest，然后 669 页 Masks |
| D. 阅读可以恢复和复用 | C | 前台等待、取消、崩溃、代际冲突与另开一局均不重复发布/掷骰；旧图谱与存档保持可读 | 复用 B/C 的真实模组与独立战役 |
| E. 旧解析路径正式退役 | B–D 的新路径验收通过 | 旧入口/依赖/配置不可达，保留证据，删除后的全量接缝与真桌回归通过 | 上述已固定来源重新从产品入口验证 |

恢复、幂等和取消的基础约束从 A/B 即生效；D 集中完成跨会话的验收和缺口修复，不是允许前票忽略正确性。

### 实施顺序与退出条件

| 步骤 | 修改范围 | 退出条件 |
| --- | --- | --- |
| 1. 原页闭环 | `extensions/module/pdf.ts`、宿主翻页命令、`reader.ts`、来源契约与测试 | 实际多模态 Pi 读者能看见页图和放大的数值区域；来源可回查；退出和取消无残留读者 |
| 2. 统一构图 | `kernel/coc/modules/`、读者提示、图谱输入契约 | 定位/细读/复核共用队列；分片通过后发布现有运行时图；引用不依赖 Markdown span；恢复不重复发布 |
| 3. 产品接线 | onboarding、setup 步表、module 扩展、kernel 工具执行钩子与材料前置检查 | 新 PDF 能开场；冷内容在结算前补读；读取旧实体的新问题有效；重启与第二局复用 |
| 4. 真桌核对 | 现有 driver/KPI；仅新增验收必需的测量 | 真实来源通过下列验收；失败修系统路径，不能为测试场景手填图谱或改写模组 |
| 5. 删除与最终回归 | 下列退役清单及实际调用者 | 旧生产路径不可达、旧专属依赖删除；全量测试真实退出码为零；删除后重新走产品入口做真桌回归 |

过渡代码只能用于以上有终点的替换过程，不交付长期双入口、模式开关或 OCR fallback。发现新增工作超出本范围时另行说明；不顺便修改规则族、世界线或前端。

### 退役清单

| 当前部分 | 最终处理 |
| --- | --- |
| `extensions/module/ingest.ts` 分类/抽文字/OCR/打包状态机 | 替换成来源登记和阅读任务；旧阶段、错误码分支与配置删除 |
| `extensions/module/pdf.ts` 的 extractor/OCR/packer 适配器 | 用单一页面访问实现替换；移除旧命令覆盖和 OCR 配置 |
| `bin/coc-ocr`、`bin/coc-bundle`、`tests/play/bundle_from_pages.py` | 删除活动实现与仅服务旧路径的测试/假后端；先逐项核对调用者 |
| `@firecrawl/pdf-inspector`、旧 OCR 专属依赖和环境变量读取 | 删除本仓库依赖与活动引用；不修改用户全局工具、凭据或其他项目 |
| `bundle.py` 的 Markdown 资料包入口 | 删除生产导入入口；来源绑定改为原 PDF；已有资产文件继续可读 |
| `plan.py` 的 Markdown 标题/字数切分，`packet.py` 的文字 span 生成 | 替换为阅读索引和任务简报；删除旧切分规则与假引用补造 |
| `gates.py` 的 span 名字/数字包含检查 | 新生产输入改为页来源的结构检查与视觉复核结果；不留伪造 OCR 文本的兼容分支 |
| `build.ts` 全书遍历，`deepen.py` 的 accepted 即永不重读 | 替换为统一需求队列；不同时维护 build/deepen 两套调度 |
| `module.bind/plan/plan.accept/packet/review/accept/assemble/install/deepen.*` 旧公开编排协议 | 用 §22 的来源与阅读协议替换；可复用合并/校验内部函数，删除旧 RPC 注册与调用者 |
| setup 的 `build-bundle`、`bind-source`、`build-opening` | 合并为 `prepare-module`；来源选择、调查员与交桌职责保留 |

源码审计包含命令、测试辅助脚本、starter 构建脚本、文档与依赖锁文件。历史说明、冻结测试资料里出现旧名字不等于仍有旧入口；必须检查可执行调用链。

**删除的是方法，不是证据。** `.coc/campaigns/`、`playtests/`、`modules/`、旧 bundle、分片和构建日志全部保留。已有图谱和资产可以继续游玩；需要新增细读而缺原 PDF 时返回 `needs_source`。只能绑定摘要匹配的原文件；无法证明匹配时建新模组，不替换旧战役来源。

### Historical sandbox observations, 2026-09-07

This and the following sandbox subsections are retained chronological snapshots. Statements about pending production migration describe their original phase, not today's execution status. See the current production/browser checkpoint below; no rejected run has been relabeled as accepted.

Evidence is retained under `.pi/reader-lab-20260907/runs/`; no production reader change has been applied in this phase. Filesystem canaries verify writable experiment directories and denied production/other-run semantic data. An initial parent-metadata denial broke Node source access; those attempts were stopped and excluded from timing comparisons. Preflight now executes the actual source-info command.

- `masks-single-02`: autonomous selective baseline. Its first skeleton was empty prose/vocabulary with citations before image viewing, so its file timestamp is not a valid skeleton milestone. The reader repeatedly revisited pages and finished in 763.2 seconds; no reviewed readiness is established.
- `masks-reference-02`: source-only review finished in 284.6 seconds but failed independent original-page spot checks (opening cast, arrival order, displayed artifacts, Psychology condition). It is rejected as a reference, not used to pass or fail candidates.
- Image instrumentation found new PNG reads omitted before they ever reached the model because the 8 MiB/4-image history cap could not fit the current batch. This is a confirmed delivery gap; it does not by itself prove the cause of every semantic error. Source generation, tool read, and actual provider-context inclusion remain separate events.
- `masks-page-probe-01`: the same Pi/model/low route accurately returned the requested facts from physical page 64 in 24.6 seconds; source fidelity is possible in a small context. This is an image-fidelity diagnostic, not graph or game acceptance.
- `masks-parallel-01`: stopped and excluded from concurrency comparison because the explicit CLI allowlist omitted the dispatch tool. `masks-parallel-02` includes the tool and has four actual independent readers chosen by Pi.
- `masks-parallel-03` and `masks-reference-03`: fresh trials retain every newly read image in context, use 2000-pixel JPEG quality 92 in the sandbox, and require incremental source notes. Image legibility, actual included pages and candidate quality must still be checked before adopting this change.

### Historical additional sandbox findings (not production acceptance)

The initial compact-image trial still lost earlier page context in long reviews. `masks-reference-03` retained wrong farmer/artifact/logistics facts and is not a reference standard. `masks-reference-04` retained up to 24 images / 32 MiB in a bounded scope, finished in 174.8 seconds, and corrected those original-page discrepancies. Its 17-item source-only checklist is a test aid, subject to original-page correction; it is not runtime truth or an exhaustive book oracle.

| Trial | Raw reader time | Independent findings |
| --- | ---: | --- |
| selective parallel + original PNG (`masks-parallel-02`) | 493.9 s | No acceptance established |
| selective parallel + compact images (`masks-parallel-03`) | 313.3 s | Parent redundantly reread worker pages; incomplete interaction material |
| selective parallel, shared reading evidence (`masks-parallel-04`) | 328.1 s | Review 169.7 s; wrong dinner-to-Puno exit, misattached prior invitation; required conversation details missing |
| corrected single reader, render then read (`masks-single-compact-01`) | 537.1 s | Review 327.0 s; opening facts improved but some perceivable Larkin tells omitted |
| direct PDF image tool (`masks-single-direct-01`) | 365.7 s | First draft 187.6 s, then avoidable array-pointer repairs; review 185.9 s rejected an identity relation and incomplete tells |
| direct PDF, no manual pointer counting (`masks-single-direct-02`) | 214.8 s | First skeleton file 31.6 s; 32 concurrent bounded source reviews pending; no readiness accepted |

These are different experimental revisions, not repeated samples of one settled design; do not infer a causal speedup from all simultaneous changes. Source scope, semantics and image inclusion are audited separately. Working speed gates have not yet passed with independent quality acceptance.

The current candidate keeps source access as one private reader tool: native navigation or directly returned page images. It removes the render-then-read round trip, but keeps read/write/edit/bash available. New page images must reach the next model context before history eviction; source rendering, tool delivery and provider-context inclusion are separate receipts. Source checkpoints are written while images are visible. The host generates mechanical review pointers; readers should not spend turns counting JSON array positions.

A retained sandbox copy under `.pi/reader-lab-20260907/target/` explores two gate changes: empty-ready sourced skeletons, and opening validation without a whole-book ending declaration. Whole-graph ending checks remain. Production files are unchanged. An unread ending must never be represented as an authored empty ending list to satisfy the old gate.

The parallel review trial groups existing nodes and claims (including all numeric child fields) into bounded original-source questions, with a capacity of 40 and actual 32 independent jobs. It is not another page sweep. Overall omission findings must block readiness even when per-field review reports are structurally complete. No candidate has yet passed the complete cold-repeat/on-demand/browser gates.

### Historical sandbox conclusion before production migration

The robust small surface is a tool-enabled Pi that selects source pages, with private direct-PDF access and the existing graph format. Structural scene/entity links remain a real graph; NPC biography, knowledge, beliefs, lies and author guidance do not need to be forced into ambiguous relation endpoints. A sandbox-only authoring vocabulary restriction tests this distinction. Production must preserve existing graph compatibility and actual NPC/clue consumers, not merely save new fields.

Two concrete runtime gaps are reproduced in the sandbox copy: whole-page index gating prevents opening/detail dispatch, and npc_view drops extra authored properties because record_of returns those properties but the view only projects a legacy subset. The prototype now exposes the complete authored NPC fields, retains legacy claims, and projects property-based knowledge/beliefs/lies distinctly. A real Pi-produced candidate instantiates as 12 runtime nodes and 9 relations; the NPC-view probe confirms the added facts reach the Keeper view. No campaign is created by these probes.

Measured additional experiments:

- Cold Harvest discovery: 53.6 seconds. It found the two authored introductions on physical pages 9–10; the main assistant visually confirmed arrest versus production investigation. The rank translation needs correction before player-facing use; the source says captain. GRU involvement is an optional role overlay rather than a third opening.
- Existing Elias, new source question: about 86 seconds, with existing identity retained. The first broad-claim version exposes an important semantic failure: a believes edge to the actual vampire entity projects the vampire truth as Elias's belief. The simpler property-based version separates biography/knowledge/beliefs and is under runtime/semantic validation.
- Simple authoring: raw cold runs 270.1 and 285.9 seconds. Independent parallel checks took 73.7 and 99.2 seconds. The first needed a small correction relocating author keep-alive guidance out of NPC desire/secret; the two corrected field groups were independently source-checked. The second still needs adjudication of review omissions and the same author-versus-NPC boundary.
- Incremental draft-tool trials took 352.8 and 372.3 seconds; the tool prevents malformed JSON and its serialized update probe preserves simultaneous writes, but it has not demonstrated a latency advantage. Do not add this tool to production merely because the prototype exists.
- Owned-draft parallel writing took 508.0 then 309.4 seconds, but source semantics and handoff representation produced more review findings. This is not an accepted replacement. The first attempt's claim/dependency dropping is invalid-for-acceptance.
- Parallel original-source review was measured with 19–62 jobs and capacity 40; observed review wall times are roughly 74–134 seconds. A supported verdict with nonempty error/missing lists is not readiness. Reviewers sometimes misreport material found on other pages or in other graph nodes; original-page adjudication must preserve valid facts.

The original 2-minute skeleton / 5-minute fully reviewed opening budgets were experiment hypotheses. Skeleton latency is promising; the 5-minute full opening target is not consistently met and remains explicitly unpassed. The user has been asked which first-use latency/overlap tradeoff matters most. Independent source-quality, cold-scene reading, source-reference audits, and exact NPC-view delivery continue meanwhile. Do not mark the production migration or the original browser chapter acceptance complete.

### Historical sandbox phase closeout

The sandbox result is **not a production or gameplay acceptance**. The production reading path remains unchanged during this phase. The original browser upload/character/full-Peru-chapter task is still outstanding.

Confirmed evidence:

- `.pi/reader-lab-20260907/queue-probe.json`: the copied kernel queues an opening without a page sweep; an exact repeated question reuses work; a new question about a ready NPC creates new reading. No campaign was created.
- `runs/masks-simple-corrected-01/runtime-graph.json` and `npc-view.json`: a real Pi-produced 12-node/9-relation opening graph is instantiated by the copied runtime. NPC biography is visible and knowledge, beliefs and lies are distinct. The author-guidance correction was independently checked in `masks-simple-patch-review-1/2`.
- `detail-probe-corrected.json`: new material for the existing Elias identity merges without duplicating him or changing prior mechanics. The prior probe based on a rejected calibration graph is explicitly not accepted; its bad belief edge was preserved rather than silently overwritten.
- `museum-probe.json`: the cold museum scene merges into the prior graph, preserves existing NPC profiles and identity, and its 8 independent source review groups report supported with no current omissions. Raw reading was 93.6 seconds and independent review 118.8 seconds, measured separately.
- Cold Harvest's two opening alternatives were found in 53.6 seconds and checked against original physical pages 9–10. Correct the rank translation (source: captain) before using that public copy.
- Actual request logs for these source experiments identify `xai/grok-4.6` and `reasoning_effort: low`.

Timing must remain honest: reader and reviewer runs were orchestrated separately during research. Adding their durations is an estimate for an automated pipeline, not measured upload-to-play wall time. First-skeleton file checkpoints also need source/shape validation before being called a usable skeleton. The provisional five-minute fully reviewed opening target has not been consistently demonstrated, and no end-to-end browser chapter is complete.

Remaining work before production migration: settle the first-use latency/character-creation overlap decision; turn the selected small authoring surface into an exact compatible contract (including NPC/clue consumers); complete stable cold-run quality and provenance gates; verify missing-source/ambiguous-source behavior. Then replace the whole-page prerequisite, reuse the single source/read/setup route, run the required regression suites, and resume the original in-app-browser full-chapter acceptance. Do not import the experimental runners, incomplete authoring restrictions, or every prototype helper into the product merely because they exist.

All experiment artifacts are retained. The selected code ideas are private direct PDF image access, inclusion of every newly read image before history eviction, source-aware incremental records, bounded independent review, actionable source findings, and complete authored NPC views. Whole-page sweeps, raw-reader timing advertised as game readiness, unreviewed drafts, erroneous review checklists and silent claim/dependency deletion remain invalid acceptance evidence.

### 外部依据与限制

- [Gemini PDF 理解](https://ai.google.dev/gemini-api/docs/document-processing)：支持视觉内容和结构化输出；原生 PDF 仍有页面/上下文限制。确认视觉阅读可行，不证明我们的模型、图谱或长本正确率。
- [Claude PDF 支持](https://platform.claude.com/docs/en/build-with-claude/pdf-support)：页面图像与文字并用。支持把原生文字降为辅助，而非继续维护全文转写前置条件。
- [Claude citations](https://platform.claude.com/docs/en/build-with-claude/citations)：图片引用不受其自动文字引用机制覆盖，因此本规格保留自己的页来源与内容复核，不把供应商引用当成正确性证明。
- [PDF.js Node 渲染示例](https://github.com/mozilla/pdf.js/blob/master/examples/node/pdf2png/pdf2png.mjs)：提供本地按页渲染的成熟实现参照；包版本、字体资源和本机 Node 运行仍须按步骤 1 验证。
- [A Time to Harvest 官方介绍](https://www.chaosium.com/a-time-to-harvest-pdf/)与 [Masks 官方介绍](https://www.chaosium.com/masks-of-nyarlathotep-pdf-1/)支持其多章节长战役定位；验收使用的具体页数和版本仍以本地原文件为准。

### 历史实施记录：选择性调度改造之前

本小节保留最初视觉读取整合与旧管线退役的事实、失败和验证数字。其全页定位、图片历史上限、工作区与「尚未接前端」等状态只适用于当时版本，不覆盖文末的当前实现与浏览器验收记录。

用户已授权实现，并于后续明确要求继续至完成。开发位于隔离 worktree `chatrpgv4-wt-visual-pdf-reader`、分支 `codex/visual-pdf-reader`。旧管线退役及手卡接缝修复已提交为 `cbdab504`；已吸收 `0.9.0a` 的已提交 `40dae53d` 并完成冲突解决和全量验证。后续用户明确授权提交并行任务的工作；该批改动独立提交为 `ffb6361a`，随后整合 PDF 分支。实施 worktree 保留代码、原文件与全部验收证据；生命周期状态另由本任务最终审计记录。

| 切片 | 已有证据 | 尚未完成 |
| --- | --- | --- |
| A 原页访问 | 原 PDF 页图、旋转、裁剪、缓存校验与区域手卡；真实 Pi 图片读取 | 已验证 |
| B 原 PDF 到开桌 | 20 页来源已建卡并完成一次真实使节任务；48 页 Cold Harvest 已复核并选对调查开场，退役后实际交付两张手卡并记下调查计划后暂停 | 已验证上述范围 |
| C 长本按需补读 | 338 页 A Time to Harvest 全书定位；开场仅准备部分材料；正常抵达行动触发未就绪场景细读与第 320 页地图读取；generation 2 发布后实际抵达 | 退役后恢复到同一农舍与 510 分钟，正常暂停；未宣称完成整部长战役 |
| D 复用与恢复 | 马库斯跨 Pi 会话恢复；朱莉娅在同一模组上另开局，世界时间 30 分钟，与马库斯的 12021 分钟独立；原件恢复、争用与原子发布接缝通过 | 本任务全部 driver 已正常停止，证据保留 |
| E 旧方法退役 | OCR/资料包命令、旧抽取器依赖、文字 span 管线、旧 build/deepen 编排与专属测试已删除；旧图谱/资产只读兼容保留 | 退役后内核 1027 passed / 1 skipped、扩展 104 passed；长本末轮已正常暂停；本次整合回归见下文 |

真实来源与运行记录（均保留在 `.coc/`，未上传原书）：

- `.coc/research/source-reader-smoke/`：4.5 与 4.6 的实际页图读入探针；只证明视觉输入。
- `.coc/research/visual-live-home-1/.coc/modules/book-1/`：20 页《他们也没想太多》原文件与图。generation 1 的发布者为原 setup 的 Grok 4.5（read-4，08:16:18Z），后续 reader override 才改为 4.6。
- `visual-source-setup`、`visual-source-setup-grok46`：原 PDF 建卡。实际战役 `they-did-not-think-it-too-many`，马库斯/军团老兵。
- `visual-source-play`、`visual-source-play-resume`、`visual-source-play-graph`：马库斯完成旅行、宴会、私人会谈、条约签署与返程复命，最后自然收束。含真实失败检定、玩家放弃推骰与跨会话恢复。源码迭代中出现的失败及被拒调用都保留，不能计作成功回合。
- `visual-source-reuse-setup`、`visual-source-reuse-play`：朱莉娅新局 `julia-north-mission`，约 20.8 秒建卡，复用 book-1；已实际开场并通过正常玩家输入暂停。该记录验证复用与独立世界，不宣称第二局剧情完结。
- `.coc/research/long-index/home/.coc/modules/book-1/`：338 页 A Time to Harvest，索引为 338/338。开场 read-32 于 10:45:15Z 完成独立复核后发布 generation 1；此前的 413、阶段超时与语义复核失败均保留。
- `harvest-visual-setup`、`harvest-visual-play`、`harvest-visual-play-recovery`、`harvest-visual-retired-resume`：真实战役 `a-time-to-harvest`，艾达。启动时一次 driver prompt 被 Pi 的自动开场拒绝，属传输记录，不计玩家回合。抵达动作先因材料未就绪被拒；read-34 发布 generation 2 后，canonical turn 4 只有一次 480 分钟车程和一次 30 分钟卸货，最终世界位置 day-one-arrival、时间 510。第 320 页地图的 23英尺6英寸尺寸误读曾被复核拦下。退役后新进程恢复了 NPC 与同一场景，turn 8 正常暂停，canonical 下一回合为 9/awaiting_player、时间仍 510。下一处 Jim’s Grill 的 read-37 复核尚未发布，退出保留草稿；它不计作新的成功补读。
- `.coc/research/cold-visual-home/.coc/modules/book-1/`：48 页《冰冷的收获》索引、原页、草稿、复核与图。read-5 的日期、指控内容等误读，以及最后的 50码/50米混淆被复核拦截；read-6 修正后发布。
- `cold-harvest-ivan` 与 `cold-harvest-ivan-flax` 两个错误试局标记 **invalid-for-intent / invalid-for-acceptance**：图谱已正确区分任务，但建卡候选缺摘要，加上缓存直接复用了旧选择，导致实际开场与玩家意图不符。这两局不计通过，不删除记录。
- `cold-visual-setup-confirmed` 创建的 `cold-harvest-ivan-correct` 已核对为开场2：查明亚麻产量骤降与电报失联并联系加庞。source kind=module 与 pdf 统一经过 prepare-module，多个候选必须在本次准备选定。
- 退役后 `cold-visual-graph-play` 与 `cold-visual-handout-play` 暴露了重复原文请求。工具仍把 handout 标为 reserved，现改为必填 name 的已实现效果，Keeper 提示也说明交付现成原图无需转写。`cold-visual-card-delivery` 的 canonical turn 4 已交付两张 image/png 手卡并发出 coc-mechanics；Grok 一次正文异常由下一句正常对话恢复，未重复 apply。turn 5 用 note 记录调查顺序，正常暂停于出发前。两个原图均实际打开检查；信保持原书横置方向。

重要边界与已修系统问题：

1. 原页/图谱为公元80年，旧开场曾误说210年；开场 look 现包含既有模组简报。旧叙述通过玩家正常对话更正并有 note 收据，未改写历史。
2. 20 页短本采用旧版属性量表，原数字抄录正确不能等同于 CoC7 机制兼容。该样本不用于宣称 NPC 数值兼容；读者/复核现明确 classic CoC7 边界，不猜转换。CoC7 与多开场回归用 Cold Harvest。
3. 图片历史按每次模型请求至多4张/约8MiB收缩，实际入上下文的图片才算读取；草稿与复核边读边写。
4. 不带 question 的 source 查询加入原准备任务，显式新问题才另读；超时给原请求字段，必须交还控制，不能把现实等待写成故事时间。
5. 薄节点首次经复核成为 ready 时可补全 summary；既有正式事实保持冲突检查。已知节点、关系字段向读者提供，身份和理由不因重新措辞而丢失。
6. 图、manifest 与资产登记统一由 ModuleStore 写入一代；开场选择也不会丢资产。资产按身份匹配，保留原路径和旧别名，新的本地路径只由宿主根据复核过的 image_sources 生成。
7. 原文件缺失或损坏可用相同摘要的原件恢复；损坏字节另存保留，恢复持有 metadata 锁。索引、任务认领与完成有持久恢复/幂等检查。
8. 错误跨 Pi 扩展实例按结构传递；主机准备目录异常也会释放已认领任务。既有材料已就绪时不因可选预读缺原文件而阻止开桌。

验证记录：删除前全量内核 1093 passed / 1 skipped，扩展 108 passed / 11 failed（均旧 OCR 导入用例）。删除后扩展 104 passed；内核一轮为 1025 passed / 1 failed / 1 skipped，唯一失败为系统语言测试仍寻找已删除的 reader.md，已改为 visual-reader.md。补齐场景和实体投影后的相关内核 55 passed。最终全量实际退出码均为 0：内核 1027 passed / 1 skipped（208.77 秒），扩展 104 passed。日志为 `.coc/research/final-kernel.log`、`final-extension.log`。补正 handout 工具描述后扩展再次 104 passed，系统语言 5 passed；手卡的真实交付另见上文。

旧图谱兼容由 `tests/kernel/fixtures/legacy-module/` 的冻结合成图验证：无 PDF、无文字资料包仍可加载、开桌与读取资产。它不是 PDF 视觉或真桌证据。历史原文件、图、草稿、图像、战役、逐字记录和遥测全部保留。

观测到的首次开场图发布时间：20 页短本从登记到发布 43.6 分钟；48 页 Cold Harvest 为 114.7 分钟；338 页长本为 186.1 分钟。这些是包含开发修复、失败、人工间隔的真实墙钟时间，不是稳定性能基准，也不代表生成图后所有开场已选定。已有书的复用建卡约 20.8 秒。

集成边界已解除：用户于本次明确要求先提交并行工作再合并。`ffb6361a` 保存人物面板、机制卡与结构化选择；本次合并保留其“系统信息只走 JSON”的约定，以及视觉来源、按需构图和旧流程退役。原实现 worktree 继续保留原文件、图谱、战役和未发布阅读草稿，不作为可删除的临时目录。

上一轮整合 `40dae53d` 的验证：内核 **1035 passed / 1 skipped**（235.62 秒、exit 0），扩展 **106 passed**（exit 0）。日志为 `.coc/research/integrated-kernel.log` 与 `integrated-extension.log`。前端目录与该已提交基线逐字节相同，未在本任务重做前端构建或 GUI 验收。全部本任务玩测 daemon/Pi 已停止。

按 index/read/verify 分组的模型回执用量与图片 read 返回次数在 `.coc/research/visual-pdf-metrics.json`；统计包含失败、恢复和开发期重复尝试，缓存 token 每次请求重复计入，不能当成一次稳定导入的成本。实际图片纳入模型上下文仍以各 attempt 的图片记录和校验结果为准，不能以返回次数替代。


本次整合 `ffb6361a` 的验证：内核 **1038 passed**（240.45 秒、exit 0），Pi 扩展 **106 passed**（exit 0），前端相关 5 个测试文件 **107 passed**（exit 0），Web/宿主源码构建通过。证据在当前主工作区 `.coc/research/visual-pdf-merge/`。这次是源码与集成回归，不新增真实模型游玩或打包 App 的声明。

整合修正：阅读等待状态通过 ask.prompt/options 作为交互 JSON 交付；裸等待散文走已有单次修正机制，不再合成空选项 ask，也不进入正文。新增接真内核回归验证这一交付边界。扩展 API 仅在有选定会话时传第四个参数，无会话调用保持原三参数形状。

## Production integration and browser acceptance completed

This is the current checkpoint, superseding historical phase-status statements above. The selected implementation uses direct selected-page access, one tool-enabled source reader per task, the existing graph, authored NPC properties and a 40-capacity independent review pool. The experimental draft/owner-dispatch framework was not shipped. Opening/detail queue without an index; explicit navigation is selective. Every new source image is included before history eviction. Page cache/view paths publish atomically and the private PDF tool checks image hashes before delivery. Public handout rendering stays reviewed PNG.

High-level preparation publishes a reviewed skeleton with exactly empty `ready_nodes`, offers authored opening choices, then prepares the chosen opening. Character drafting is available during preparation; Start depends on reviewed opening material. Opening readiness additionally requires a prepared start scene. New questions revisit accepted entities, while additive NPC knowledge/beliefs/lies preserve prior statements. Full scene look exposes complete authored sublocation/rule descriptions; compact capsule previews explicitly mark truncation. Maps depicting the scene's authored location are discoverable from that scene. These projections do not infer routes from prose or create a second spatial graph.

### Measured cold and warm browser evidence

| Evidence | Observed result | Limit |
| --- | --- | --- |
| `.coc/playtests/masks-final-cold/run.json` | First early-skeleton browser trial published a noninteractive Hotel Room 410 teaser as a selectable opening | Retained; invalid for opening-choice acceptance |
| `.coc/playtests/masks-final-cold-2/run.json` | Fresh module store and page cache; upload began 23:43:33.670Z and reviewed skeleton completed 23:45:28Z on 2026-09-07: about 114 seconds, 16 original pages, two genuine starts, no teaser option, empty ready material | Valid early-structure milestone; OS/provider caches uncontrolled; not opening or chapter completion |
| Cold2 opening jobs `read-2` / `read-3` | First attempt failed at 23:55:54Z after a reviewer incorrectly replaced printed NPC MOV with a character-creation calculation; corrected instructions and retained retry ran 00:02:03Z–00:05:52Z on 2026-09-08 and published opening material | Failed attempt and human delay remain part of the record; not an uninterrupted clean opening-speed result |
| In-app browser `localhost:5181`, later new session in cold2 home | Empty session shows all three entries; selecting the parsed Masks book reuses its opening. Investigator draft name and concept survived reload, then Start: Lima reached the Create character step | Warm reuse and reload recovery only; this check created no new campaign |

Cold2 module metadata confirms the skeleton material has no ready nodes. Actual `work/**/*.requests.jsonl` metadata identifies provider `xai`, model `grok-4.6`, and `reasoning_effort: low`. The two-minute skeleton hypothesis has one valid browser observation; repeatable reviewed-opening performance is not established. Do not sum separately orchestrated sandbox phases or exclude retries to claim a five-minute cold opening.

### Current real chapter and source-quality follow-up

The main assistant was the only player in `game-3642e5f2-8acb-4d17-9394-9f173764caf2`, browser session `4352d376-9e7b-4103-a802-b399e3317d35`, using `.coc/research/masks-agentic-browser-home`. Actual UI upload, character creation, opening and travel through Lima/Puno to the ruins occurred with Grok 4.6 low. The earlier Charnel Pit pause at UI turn 43 (HP 2, SAN 36, Luck 43) remains a historical checkpoint. Play continued: turn 63 formally set `golden-ward-restored=true`, and turn 64 recorded the restored-ward conclusion and return to Lima. The evidence manifest is `.coc/playtests/masks-agentic-browser/run.json`; the closeout is `REPORT.md` beside it.

Original physical pages 81–84 were visually compared with generation 16. The published text omitted the explicit no-roll condition for entering the tunnels through the Charnel Pit; a 90-character place preview also lost existing connectivity, and the location-linked map was absent from the scene's asset list. General projection fixes and source-reader guidance address these classes of loss. Canonical Pi source repair published generation 17 after all 43 review units completed; `.coc/playtests/masks-agentic-browser/source-repair/events.jsonl` records readiness at 2026-09-08T00:57:32.349Z. The subsequent real play reached the ward and repaired it; these facts do not retroactively erase earlier failures or prove that every earlier climbing ruling was wrong.

Turn 64 initially closed the campaign without chapter rewards or investigator development. That exposed a separate terminal-state gap, now repaired through the existing development settlement path. The Keeper then requested `Ward restored` with the precise source reward/development question through normal source lookup. Real job `read-14` read physical page 86, independent reviewers viewed pages 86/89, and the accepted delta published generation 18 at 2026-09-08T02:50:54Z with no review omissions. Source/model request logs confirm xai/grok-4.6 low. No audit values were written directly into the campaign.

Canonical turn 66 resolved `development:end-session` with the source-derived `scenario_san_reward_expr: 1D8`, then narrated the chapter settlement and stopped before the next chapter. Commit `7cf49f0` retains SAN 31→32 (source reward roll 1), Luck 0→5 through the existing optional normal Luck recovery rule, and Spot Hidden 45→51; Library Use remained unchanged. The frozen capsule and PASS receipt are under `save/development-settlements/endings/ending-campaign-turn-64/`. Campaign metadata stays completed with its original ending turn 64 and the ward flag remains true. Final UI/canonical state: turn 67 awaiting_player, HP 8, SAN 32, Luck 5. This completes the requested Peru chapter plus accounting after observed repairs; it is not an uninterrupted first-attempt run.

### Verification boundary and remaining work

Historical checkpoints passed 1061 kernel/play and 113 extension tests, followed by 35 focused readiness/dossier tests and 37 spatial projection tests. The final postgame implementation passed the complete kernel/play suite: **1097 passed, exit 0, 258.96 seconds**, plus **119 extension tests, exit 0**. Final Electron baseline comparison retained **197 known failures with none new**; targeted UI mechanics passed 16 tests, external-auth lifecycle passed 15 tests, and the final web build exited 0. Evidence is under `.coc/playtests/masks-agentic-browser/final-checks/`, including `postgame-full.log/.exit`, `postgame-extension.log/.exit`, `postgame-testlist.txt`, `electron-complete.log`, `ui-mechanics-final.log`, and `external-auth-lifecycle-final.log`.

The requested original-PDF → investigator → Peru chapter → source-based settlement browser acceptance is complete. Cold repeatability and consistently fast fully reviewed openings remain unproven; the 114-second skeleton is one valid cold local observation. The run includes retries, service recovery, warm reuse, development fixes and manual playing time. All original PDFs, graphs, failed attempts, reviews, browser evidence and campaign records are retained. No packaged-app acceptance is claimed, and the pre-existing development receipt-before-sheet process-crash window documented in the kernel contract remains outside this repair.

Cache implementation cross-check: [Node.js copyFile](https://nodejs.org/api/fs.html#fspromisescopyfilesrc-dest-mode) explicitly does not promise an atomic copy. [Apple rename(2)](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/rename.2.html) documents atomic replacement within a filesystem. This confirms using a unique temporary sibling followed by rename for both cache artifacts and readable page paths. Source-image hash validation and the 40-way local delivery regression test the actual implementation; these guarantees concern visible publication, not a claim of power-loss durability.
