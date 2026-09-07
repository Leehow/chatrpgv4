# PDF 直接阅读与按需构图

状态：实施与真实验收进行中。2026-09-07，初始基线 `7e990cc6`；当前状态见实施记录。

父规格票：[GitHub #34](https://github.com/Leehow/chatrpgv4/issues/34)，已标 `ready-for-agent`。本文件保留本地实施指引；后续拆票以本规格的用户故事、候选切片和验收为依据。

## Problem Statement

用户要一个简洁的 Pi-Coc 基础框架：输入真实 PDF，由多模态 Pi 读者读成能主持游戏的细粒度图谱；长本按需细读；验证后拆掉旧解析流水线。Electron 接入在本规格完成之后另做。

成功是从产品入口导入、建卡、开桌，遇到未细读内容能补读后继续，重启和另开一局能复用成果；旧入口与依赖已退役。只有页图、JSON、绿色单测或“解析完成”的报告，尚不能证明成功。

本文记录设计理由、实施顺序和验收。接口、状态、来源和提交语义的唯一规范在 [kernel-rpc.md §22](../kernel-rpc.md#22-visual-pdf-reading-and-demand-driven-graph-building)。实现前读该节；涉及 Pi 进程与图片输入时再读 [Pi 宿主契约](../pi-host-contract.md)。

## Solution

用户选择原 PDF 后，Pi-Coc 自行定位全书、细读开场并构建可玩的图谱。长本的其他部分在游玩需要时补读，必要材料就绪后才结算；已有模组与战役可续行复用。对用户而言只有选书、必要的开场选择、建卡与游戏，不需要操作 OCR 或资料包。

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
10. As a Keeper, I want book-wide navigation before opening preparation, so that relevant later chapters and appendices can be found.
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
2. 来源保留为不可原位替换的原 PDF；宿主用一个 PDF.js 实现提供页元数据、按需渲染和裁剪。Python 内核只校验来源描述与字节身份，不解析 PDF。原生文字仅是可选辅助。
3. 沿用带工具的 Pi 读者；定位、开场、细读共用一种执行形状与一条队列。关键事实复核使用该读者的新会话，不另建 OCR、协调者或审核平台。
4. 阅读索引覆盖书的全部物理页，用于定位章节、人物和引用；索引本身不授权结算。开场依赖的全局真相和后置材料需要细读，其他分支保持未细读。
5. 抽取颗粒度由游戏事实决定；固定大小的文字切片不再限制阅读范围。人物可横跨正文与附录取材，实体标识和别名复用。
6. 来源引用使用机器关联的原文件身份、物理页和可选裁剪；读者分片版本与现有运行时图版本分开。既有图谱不需要为退役 OCR 而整体重建。
7. 阅读请求按来源、范围和确切问题去重；读取过一个章节不等于满足该实体后续的所有问题。当前需求优先于开场和邻接预读。
8. 材料前置检查发生在 RNG、收据和效果批写入之前。扩展在当前回合中驱动前台阅读，等待期间释放内核执行队列；成功后重新校验原动作，失败不推进该批世界状态。
9. 结构校验与语义复核职责分离；重要数值、条件、因果和身份真假关系对照原页复核。没有出处、读不清或存在冲突的必要内容不能强行发布为 ready。
10. 一个模组跨会话串行认领并原子发布；代际冲突重新检查，恢复和幂等以持久任务与已发布结果为依据，不依赖进程内 busy 标记。
11. 建卡调用统一的模组准备接口；现有模组和 starter 保持原职责，多开场选择沿用已有选择机制。来源处理进度不成为玩家叙事。
12. 旧路径删除有明确终点：替换可验收后移除 OCR、Markdown 资料包及旧编排入口，保留原文件、旧图谱、存档、资产和全部玩测证据。接口细节以目标内核契约为准。

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

按 [acceptance.md](../acceptance.md) 使用 `tests/play/driver.py` 启动 `bin/pi-coc-setup` / `bin/pi-coc`，Grok 当守秘人，主会话为唯一玩家，一次一句自然输入，持续到自然结局或真实阻断。没有脚本玩家、手填图谱、假 Keeper 或直接内核造景替代。

| 样本 | 必须观察到的事实 |
| --- | --- |
| 含扫描页、图或小字表格的真实短本 | 从原 PDF 产品入口完成建卡、开场和游玩；场景、线索条件和实际用到的数值能定位到原页；至少一处确实通过看图取得的内容进入游戏 |
| 多章节且有跨章引用/后置附录的真实长本 | 全书定位完成，开局仍有未细读部分；玩家的正常选择触发冷内容细读；必要附录先读取后结算；已有 NPC 的新问题触发针对性补读 |
| 同来源复用与恢复 | 正常退出再续行，已发布内容复用且未发布工作可恢复；另开新战役复用同一本书，世界状态相互独立 |

至少人工逐页对照开场与真正使用的关键事实；报告漏读、误读和复核漏检。记录首次可玩时间、定位/抽取/复核分别用时、前台等待、图片阅读次数和实际可取得的 token 用量。没有预设速度承诺；这些数据用于判断质量和等待是否值得接受。

结果标记必须分清：接缝通过、真实 PDF 阅读通过、真桌通过、旧路径已删除。真实阻断意味着对应验收尚未通过；不能用绿色测试补记通过。此次所有门完成后才讨论 Electron 接入。

## Out of Scope

不包含：Electron/UI 改动、通用文档平台、规则引擎重构、向量数据库、额外知识图谱、供应商原生 PDF API 适配、OCR 备用链路、模组导入导出产品。

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
- 669 页全书定位自身有成本，必须测量定位、开场细读和复核分别用时；“按需”省掉的是未使用范围的精细构图，不意味着开局零预读。
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

### 外部依据与限制

- [Gemini PDF 理解](https://ai.google.dev/gemini-api/docs/document-processing)：支持视觉内容和结构化输出；原生 PDF 仍有页面/上下文限制。确认视觉阅读可行，不证明我们的模型、图谱或长本正确率。
- [Claude PDF 支持](https://platform.claude.com/docs/en/build-with-claude/pdf-support)：页面图像与文字并用。支持把原生文字降为辅助，而非继续维护全文转写前置条件。
- [Claude citations](https://platform.claude.com/docs/en/build-with-claude/citations)：图片引用不受其自动文字引用机制覆盖，因此本规格保留自己的页来源与内容复核，不把供应商引用当成正确性证明。
- [PDF.js Node 渲染示例](https://github.com/mozilla/pdf.js/blob/master/examples/node/pdf2png/pdf2png.mjs)：提供本地按页渲染的成熟实现参照；包版本、字体资源和本机 Node 运行仍须按步骤 1 验证。
- [A Time to Harvest 官方介绍](https://www.chaosium.com/a-time-to-harvest-pdf/)与 [Masks 官方介绍](https://www.chaosium.com/masks-of-nyarlathotep-pdf-1/)支持其多章节长战役定位；验收使用的具体页数和版本仍以本地原文件为准。

### 实施记录

用户于 2026-09-07 授权实现。工作分支 `codex/visual-pdf-reader`，隔离 worktree `chatrpgv4-wt-visual-pdf-reader`。原工作区的并发改动未回滚或覆盖。已提交 WIP `bf58dc0b`，合并上游 `ebbf8dde` 后为 `5805d8f4`；此后仍有本任务的未提交修复。worktree 由当前任务管理，最终须 audit 并明确处置。

| 切片 | 当前状态 | 尚缺的退出条件 |
| --- | --- | --- |
| A 原页闭环 | 已实现；5 个渲染用例和真实 Pi 读图通过 | 最终退役后的复查 |
| B 原 PDF 到开桌 | 来源、队列、复核、建卡和图谱开场已接通；20 页来源已实际建卡游玩 | 自然结局、CoC7 数值与多开场回归 |
| C 按需补读 | 已有 NPC 的新问题已触发真实读图并发布；材料在结算前检查 | 338 页长本的真实冷内容游玩 |
| D 恢复复用 | 真桌跨 Pi 会话恢复；进程认领、原子发布、取消、冲突的确定性接缝通过 | 第二局复用的真实入口证据及最终恢复回归 |
| E 退役 | 已完成调用者清点，旧生产路径仍在 | B–D 的替代链路验收、删除、全量绿和删除后真桌 |

现有证据及其边界：

- `.coc/research/source-reader-smoke/`：真实 Grok 读原 PDF 页图，正确取得斗酒侧栏条件；4.5 与 4.6 独立读图探针均退出 0。这里只证明图片输入。
- `.coc/research/visual-live-home-1/.coc/modules/book-1/`：20 页来源定位完成。read-4 的 generation 1 由原 setup 的 `xai/grok-4.5` 于 08:16:18Z 发布；不能归因于随后切换的 4.6。read-5 对康尼尔斗酒问题的原页复查完成并发布 generation 2，后续发布和历史排队均保留。
- `visual-source-setup`、`visual-source-setup-grok46`：通过真实 setup 入口准备原 PDF，实际 campaign 为 `they-did-not-think-it-too-many`，人物马库斯。setup.complete 收据为 ready_for_table；短剑、盾、口粮有真实装备记录。
- `visual-source-play`、`visual-source-play-resume`、`visual-source-play-graph`：同一真实战役跨进程继续，已发生旅行、宴会、私人会谈和晨间谈判；包含真实失败检定与由玩家放弃推骰的选择。Keeper 为 Grok 4.5，后续 source reader 为 4.6。尚未自然结束，不计完整真桌通过。
- 手工核对原物理页 5 与 7：斗酒 POT 表、超过 HP 后才检定、两次失败条件，以及布拉丹圆屋的三个铜像/头骨细节，在源图、图谱和实际交付之间可对应。原书采用旧版属性量表，原数值抄录正确不代表可直接供 CoC7 计算；该样本不能证明 NPC 规则兼容。读者/复核提示现已明确 classic CoC7 的兼容边界，禁止猜转换。
- `cold-visual-setup`：按既定样本新增《冰冷的收获》原 PDF 真入口回归，隔离 home 为 `.coc/research/cold-visual-home`，角色伊万/苏联警察；用于 CoC7、地图和开场回归，当前正在读取。
- `.coc/research/long-index/home/.coc/modules/book-1/`：338 页 A Time to Harvest 已完成 338/338 全书定位。开场抽取因图片历史约 39 MiB 曾报 413；有界图片上下文修复后，第一轮触及旧 15 分钟任务上限，第二轮于 10:12:59Z 成功抽取（749632 ms、30 次不同图片读取），现进行独立复核。长本尚无游戏战役，不计长本真桌。

真入口发现并已修复的系统接缝：

1. 开场 look 缺少已有时代/全局简报，导致源和图谱为 80 年而 Keeper 误说 210 年；现复用已有 module briefing。旧叙述没有被改写，玩家在原局通过正常对话要求更正，Keeper 留了 note 收据。
2. 普通图谱查询误触发原文读取；现以 lookup kind=module 和 kind=source 区分。一次 reading_timeout 后本回合仅可 ask，新的玩家输入才可继续；前台只等所需材料，不等整个后台队列。
3. Pi 扩展加载产生不同 KernelError 构造器实例，曾丢失修正细节；现按结构保留 code/fix/details。
4. 页图历史累积超过请求大小；现仅保留最近至多 4 张/约 8 MiB 的图片，并记录实际进入上下文的工具图片。未包含的图片不能冒充阅读证据。
5. 索引与图谱均通过 metadata 指针发布；未发布索引文件不会在恢复时重复追加。薄场景补读同步 runtime record；已发布内容在原 PDF 缺失时仍可复用。
6. 视觉资产按节点身份保留各自裁剪路径，既有资产路径不再被重复加 bundle/ 前缀，也不按同页猜配另一张图片。

最近确定性验证：73 个内核接缝与 33 个扩展用例通过；新增恢复/投影后 32 个相关内核用例通过，新增资产跨代回归后视觉与 handout 合计 22 passed。等待、错误桥接、图片上下文与 bad_pdf 的相关扩展检查退出 0。全量迁移检查此前为 Python 1078 passed / 2 failed / 1 skipped、扩展 95 passed / 16 failed；部分旧断言已修正，旧 ingest 专属测试尚待替换，尚未称全量绿。

历史失败保留在 `.coc/research/reading-service-smoke/`、`.coc/modules/book-1/work/` 和各真实 run 中，包括服务端 `500 Auth context expired`、试跑整体 30 分钟截止、413 与阶段超时。这些原因分别记录，不能混称为同一种失败。所有原 PDF、图、草稿、回合、事件和遥测仅增不删。

下一步：完成短本与长本的真实产品门、第二局复用，随后按退役清单移除旧入口；全量测试和删除后真桌完成才关闭本规格。Electron 不在本轮。
