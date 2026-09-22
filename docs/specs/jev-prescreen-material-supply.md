# Jev 预筛资料供应：完整材料、真实上下文与玩家等待验收

Status: **Ready for implementation; implementation and product acceptance are pending.**

Tracker: [GitHub #108](https://github.com/Leehow/chatrpgv4/issues/108), labelled `ready-for-agent`.

本规格由已完成的目的核查及用户确认的验收边界综合形成。用户确认：主验收在真实 KP 出站请求，以及鬼屋和 PDF 模组真桌；组件测试只用于补充故障定位。本次交付为规格，不代表下面的能力已实现，也不启动实现、打包或玩测。

这是 [Jev 统一架构 #101](https://github.com/Leehow/chatrpgv4/issues/101) 下前置只读资料供应的实施规格，沿用现有 TaskRuntime、SourceRef、来源阅读、上下文和内核权威。它不另立统一架构，不扩大到规划、结算、世界写入或记忆生成迁移。现行内核契约仍是接口、事务、来源与可见性规则的规范；实施第一步先补齐本规格所需的契约增量。

## Problem Statement

玩家希望守秘人在处理当前行动前已经拿到有用材料，少花几个往返寻找模组事实、规则、旧记录和人物状态。现在某些回合仍超过两分钟；启用 Jev 后，虽然部分工具调用减少，玩家等待没有稳定改善。

问题不能归结为 Jev 模型不够快。当前前置预筛主要对少量已准备图谱投影和只读工具目录做选择。原 PDF、已核验的来源问答、规则正文、针对当前问题的有效记忆及部分历史记录没有形成完整的供应链。候选名字存在、读取成功、消息准备完成、消息实际送达、资料足以支持当前问题以及 KP 实际使用，是六个不同事实，现有实现和验收没有将它们贯通。

已确认的代表性断点包括：规则家族读取返回索引而非条文；历史记录因内容字段形状不匹配被候选入口丢弃；已经准备但最终因预算被丢弃的 workspace 仍被算作“已经提供”；后台记忆和 NPC 日志更新不完整地进入预筛的失效与版本校验。原文问答和需要发布图谱的准备继续走昂贵阅读路径，预筛成本则叠加在前面。

成功是 KP 的真实请求提前包含当前任务需要的实际材料，保留明确的缺口、出处和权威，真实游玩中的重复阅读及玩家等待下降，回答质量和游戏权限不退步。只增加几个候选参数、注入一个消息、减少工具总数或刷绿组件测试，均不能满足这个目的。

## Solution

玩家照常用自然语言行动。宿主根据原始玩家输入、已有活动目标和 KP 当前实际可见的上下文，从模组原文、已准备图谱、规则、有效记忆、历史记录、人物卡、物品和会话状态中发现候选。Jev 判断哪些材料值得补充；宿主通过现有来源与只读接口取得精确内容，在预算和版本检查后交给 KP。

这是一轮或有限多轮的粗筛与补料，允许并发，允许有用的冗余，也允许 KP 继续补读和纠正。它不需要另一个 LLM 先制定检索计划，不要求一次选完、百分之百命中、全书预处理完成或唯一最小材料集合。

资料已足够时，现有成果直接复用，跳过不必要的 Jev 判断和生成式阅读。还缺材料时，系统区分“可以继续拿的正文”“未知或冲突”“需要视觉核查”“需要真实准备和发布”。必要的准备继续由已有所有者执行；不把普通资料咨询升级为构图，不把拿到原文误认成已经完成准备。

对玩家而言，预筛的效果是更及时、连贯且有依据的回应；来源选择、内部预算和统计不会成为新问题、新义务或强迫玩家推进剧情的理由。

## User Stories

1. As a player, I want the Keeper to receive useful evidence before answering, so that I spend less time waiting for exploratory tool roundtrips.
2. As a player, I want ordinary turns to become faster in both the built-in haunting scenario and PDF modules, so that an optimization helps the games I actually play.
3. As a player, I want an already supported question to reuse existing evidence, so that I do not wait for the same expensive reading again.
4. As a player, I want the same object to retrieve different evidence for observation and use, so that the answer follows my current purpose.
5. As a player, I want a question with several parts to retain every necessary condition, so that a fast answer is not incomplete or misleading.
6. As a player, I want public knowledge and my selected action to remain unchanged by private retrieval, so that finding evidence does not make choices for me.
7. As a player, I want the current scene, clock, character resources and pending choice preserved, so that optional retrieval cannot remove the state needed to play.
8. As a player, I want cancellation and a resumed session to preserve settled events, so that slow retrieval never repeats my action.
9. As a player, I want a slow or unavailable selector to leave the ordinary game usable, so that an optional optimization does not create a new blocker.
10. As a Keeper, I want source material outside the prepared graph to be discoverable, so that an unfamiliar late-book fact is not excluded before selection.
11. As a Keeper, I want selected native PDF passages supplied with their exact source bindings, so that I can use actual material rather than a directory description.
12. As a Keeper, I want image-dependent pages and unreliable native text to use the existing visual reading route, so that a map or table is not replaced by guessed text.
13. As a Keeper, I want accepted source answers to be retrievable for a relevant new wording, so that their reviewed contents can be reused without claiming they answer unrelated questions.
14. As a Keeper, I want source consultation distinguished from graph preparation, so that explaining a fact does not unnecessarily rebuild a scene.
15. As a Keeper, I want genuinely required preparation to reuse compatible accepted results, so that necessary publication is not repeatedly restarted.
16. As a Keeper, I want authored conditions, relationships and cross-references alongside descriptive prose, so that the material retains the facts that affect play.
17. As a Keeper, I want rule clauses and their necessary dependencies, so that a family name or rule index is not mistaken for the rule itself.
18. As a Keeper, I want current rule and catalog versions attached to material, so that an old entry cannot silently govern a new request.
19. As a Keeper, I want memory retrieved for the actual subject and purpose of the question, so that relevant non-present people and older events remain available.
20. As a Keeper, I want corrections, withdrawals and superseded claims preserved, so that a late old extraction does not revive a withdrawn claim.
21. As a Keeper, I want committed history and exact attributed statements available when needed, so that summaries do not erase who said what.
22. As a Keeper, I want current PC sheets and NPC dossiers supplied through their real read interfaces, so that prefetched names come with useful facts and state.
23. As a Keeper, I want NPC relationship and journal changes to invalidate affected evidence, so that I do not act on an obsolete dossier.
24. As a Keeper, I want object ownership, quantity, state, documents and accepted usage profiles, so that registration is not confused with possession or permission.
25. As a Keeper, I want a relevant printed catalog item to be discoverable before an instance exists, so that retrieval is not limited to already registered inventory.
26. As a Keeper, I want current session details when the capsule does not already contain them, so that combat or chase context can be supplied without redundant reads.
27. As a Keeper, I want selection to consider the material actually retained in my request, so that cached or discarded material is not falsely counted as present.
28. As a Keeper, I want exact duplicate ranges merged while complementary passages remain, so that repeated A does not replace missing B.
29. As a Keeper, I want a useful incomplete selection delivered with honest gaps, so that imperfect selection does not become either a false completeness claim or a reason to discard all useful evidence.
30. As a Keeper, I want relevant contradictions distinguished from unsupported additions and unrelated conflicts, so that I neither invent a fact nor block a question for an irrelevant disagreement.
31. As a Keeper, I want to read further or reject a suggestion, so that the selector remains assistance rather than a new authority.
32. As a maintainer, I want every material family traced from producer through final request to observed use, so that an implemented reader with no consumer cannot pass acceptance.
33. As a maintainer, I want candidate truncation and final budget omissions reported separately, so that missing coverage cannot disappear behind a successful status.
34. As a maintainer, I want same-state work shared and independent reads bounded, so that repeated context hooks do not multiply identical provider calls.
35. As a maintainer, I want dependency versions checked at delivery, so that world, source, rule, memory and journal changes cannot silently produce stale packets.
36. As an operator, I want feature activation and credential availability reported separately, so that entering a key is not mistaken for enabling an absent feature.
37. As an operator, I want source mode and the canonical installed App to expose the same completed feature, so that source tests do not masquerade as shipped behavior.
38. As a tester, I want frozen runtime and source identities in A/B evidence, so that concurrent builds or different preparation states do not masquerade as speed gains.
39. As a tester, I want correct source-supported outcomes measured alongside actual reads and full turn latency, so that fewer calls cannot hide worse answers.
40. As a maintainer, I want the change to reuse existing host and kernel seams, so that closing this gap does not create another agent framework or game-state authority.

## Implementation Decisions

### 1. 一个前置供应流程，沿用现有权威

扩展现有 KP 上下文准备及最终出站投影流程，使用共享 DecisionAdapter、TaskRuntime 的生命周期与预算、SourceRef 和原有资料读取所有者。主入口在 KP 本次模型请求之前，不依赖首次额外的 Keeper 工具调用或私有计划包。

Jev 只处理宿主提供的闭合语义选择、覆盖和关系判断；宿主定位、读取、精确复制与绑定；KP 解释、行动和叙事；TypeScript 内核负责规则算术及世界事务。预筛只能执行经过现有边界验证的只读操作。正常工具、准入、准备、结算和提交路径保持其完整守卫。

当前的补充消息不是第二个事实库。实施应优先扩展已有 evidence/context 表达和所有者，避免并存两套 locator、版本缓存、规则加载器或来源阅读管线。接口形状先更新现行内核契约，再修改消费者；不能以本规格代替接口契约。

### 2. 对全部材料类别写出生产、读取、交付和替代关系

下表为必需覆盖范围。每类必须提供能复查的真实接线证据；“目录里有这个类型”不算完成。

| 材料 | 生产与权威 | 读取与送达要求 | 应减少的工作及完成证据 |
| --- | --- | --- | --- |
| 原始 PDF 的可用原生正文 | 原 PDF 与既有宿主页面/原生文本所有者；原文绑定不自动构成视觉证明 | 未有图实体也能发现候选；使用原有精确 SourceRef 和原生咨询资格判断，按需取完整相关段落、条件与跨页依赖 | 对原生材料已足够的咨询，首个实际请求含原文，KP 无需再启动同目的生成式阅读；未知仍明确 |
| 视觉页、地图、表格、手卡 | 原 PDF 页面及已有带工具读者、独立复核和资产所有者 | 原生文字不可靠或问题依赖布局时保留页图/裁剪的现有读取入口；复用有效的已核验结果；传不了图时明确后续读取需求 | 能从真实页证据追到已读或未读状态，不能靠文字候选冒充已看图，也不能泄露未公开资产 |
| 已核验来源问答 | 当前来源所有者保存并核验的答案、复核和出处 | 从有效答案内容构建候选，相关性由模型判；提问不同不强制重新生成，相关答案也不自动满足新增问题 | 复用的是实际答案和支持范围；真实请求可见，未覆盖的新增条件继续补读 |
| 已准备模组图谱 | 当前有效 ModuleGraph、作者事实及关系 | 供应当前用途所需正文、结构化条件、关系、引用及遗漏说明；不以少数字符串字段代表整个实体 | 场景/NPC/线索的关键条件真实进入请求，普通图谱补读减少且事实不丢失 |
| 规则与规则依赖 | 当前规则所有者、RuleGraph 及可用原始证据 | 家族/规则索引只用于导航；选中后获取条文、条件和必要依赖，依赖缺失明确保留 | 请求包含可供 KP 判断适用性的材料；数值仍由原有 resolve 计算 |
| 有效记忆 | 当前战役记忆所有者，保留更正、撤回、状态、归因与来源 | 根据当前问题和已有上下文取候选，不固定为在场人物的八条；沿用有效性和分页，必要时读原始记录 | 有关非在场实体及旧事的记忆进入真实请求；过期说法不复活 |
| 历史与逐字记录 | 已提交回合、事件和语句的现有读取所有者 | 不因 text/body 字段形状丢失；通过来源引用取得精确语句和所需相邻语境，保留说话者、时间和世界线 | 能用原记录支持回忆或消解歧义，而非只供应一条“可查历史”的目录 |
| PC / NPC | 当前人物读取接口、已接受人物档案、关系和日志所有者 | 直接消费真实只读投影；将实际依赖的动态资源、关系和日志纳入版本绑定 | 真实卡面/档案内容进入请求；记忆或日志变化后不能复用旧材料 |
| 物品实例、用法与目录 | 当前对象状态、已接受 usage profile、目录所有者 | 分清定义、实例、持有、可用状态和用法；候选检索不以已有实例名为全集 | 已登记物品与尚未登记的相关目录资料都可供应，拿到目录不等于持有或获准使用 |
| 核心当前态与会话 | 当前 capsule、角色资源与结构化会话 | 核心当前态直接保留；只有缺失的会话细节需要补读，预筛不删除核心胶囊 | 出站请求保有当前输入、核心态和待决；不为凑类型覆盖重复读取 |

对来源咨询，复用既有原生摘取资格及来源完成检查。普通搜索摘要仍是导航资料，不能把它改名为已核验原文；SourceRef 只证明定位与复制保真，不证明内容正确、当前有效、可公开或视觉已核实。

### 3. 候选范围不能在 Jev 前被静默缩成目录前几项

候选发现复用既有来源导航、原生文本、图谱关联、名称匹配、规则、目录和记忆接口。允许机械分页、精确名称匹配和通用词法检索辅助召回，禁止用人物、语言、用途或场景关键词名单决定开放语义相关性。

原 PDF 的候选范围不受已准备图谱实体限制；目录不受当前库存限制；记忆不受在场 NPC 限制。跨页和跨段依赖必须可发现。短资料库可采用宽并发扫描；长资料库可分批导航和扩展。两者都必须记录实际搜索范围、未检查范围及继续读取方式，不把全书深读或完整索引作为每个回合的前置条件。

Jev 判断应看到足以判断用途的材料内容及上下文，而非仅名称和通用描述。候选摘要可以帮助导航，但不能抹掉条件后又代表正文。候选、读次数和消息字节上限是预算控制，不是语义充分性的判据；当前固定的 24/48/64/8 等界限不能作为完成标准固化。任何阶段截断都必须可见并可继续。

### 4. “已有材料”以将要发送的实际请求为准

预筛输入由原始玩家话语、已存在的活动目标、当前 capsule、相关保留历史、已保留工具结果及有效工作材料共同形成。活动目标只能来自现有上下文，不另生成玩家目标。既不要求把无限历史全塞给 Jev，也不能只给胶囊摘录却声称了解完整上下文。未能表示的上下文保留未知，不默认为资料缺失或已充分。

宿主在准备阶段可以建立候选的已有证据清单，但最终供应清单必须与实际出站 messages 一致。缓存可取、准备完成、投影选中和实际请求保留分别记账。若预算导致基线材料被移除，依赖该材料的“已经提供”判断必须撤销：重新装配可放入的必要片段或明确保留未供应的补读入口，不要求无限重新筛选。

工具结果是否已在上下文、是否过期以及内容覆盖情况必须进入后续请求的选择依据。不能每次上下文失效只拿最初那句玩家话重新对同一目录做相同判断。

### 5. 粗筛、实际取料、有限补选

流程为：准备当前上下文和候选；可直接复用的精确有效材料走廉价路径；Jev 选择缺少的有用材料；宿主实际取料；针对已得到的内容检查覆盖、相关冲突和剩余缺口；确有收益且预算允许时再补选；最后校验版本并装配请求。

每次独立决策只基于其冻结的输入，不能假装读到了同批其他回答。依赖新读取结果的判断进入下一轮。允许一次完成，也允许多轮；没有每回合固定的第二轮、必需审阅模型或固定最小集合求解。

八类语义目标逐项编号，实施及验收不得只报告一个总通过率：

1. **G1 同对象不同用途**：对象和候选相同，当前观察、查询或使用目的改变时，材料需求可以改变。
2. **G2 多段材料合取**：问题需要 A+B 时，已有零段、一段和两段分别处理；一段有用不等于问题齐全。
3. **G3 提过不等于已经具备**：区分主题提及、丢条件摘要、忠实改写、原文、仅缓存存在和最终已送达。
4. **G4 联合去冗余**：区分 A、重复 A、改写 A、B 及 A+B 组合；允许多个有效组合，A+A 不替代 A+B。
5. **G5 记忆更正与当前状态**：保留撤回、更正及时间关系，迟到的旧抽取不能复活已撤回声明。
6. **G6 观点归因与证据方向**：区分说话者、来源声称及世界事实，保留支持/反驳的真实关系方向。
7. **G7 当前目的及公开/空间范围**：意图、位置与资料获得状态分别处理；旅行不等于已获受限资料，宅外不等于已进入。
8. **G8 源文未知与相关冲突**：区分无依据新增、明确互斥、相关矛盾与题外矛盾，不靠常识补齐来源空白。

单一 fetch/skip/uncertain 标签可以作为局部选择接口，但不能独自代表全部判定结果。

不确定、低置信度或部分覆盖不能被当成明确无关；保留其内容或可用补读引用，具体取舍按当前预算和收益处理。相关冲突并列保留，不择一伪造确定性。材料缺口不构成一个强制向玩家提问的决策断点；KP 可继续现有读取，或按原有真实准备/待决边界处理。

### 6. 宿主精确取料、合并与权威分离

使用共享 SourceRef 解析和版本绑定，由宿主复制实际字段或精确原文范围。模型选择语义别名，不抄哈希、UUID、偏移或原文。相同版本、相同来源的重叠范围由宿主合并，避免反复传 A；互补的 B 不能因主题相同被删除。语义改写可支持普通回答，但不能冒充原文引用或原页核验。

每项材料保持来源种类、当前性、归因、覆盖和遗漏信息以及有效的普通补读入口。内部身份与完整 read set 由宿主管理；模型获得理解来源及继续读取所需的语义信息。图谱投影的完整仅表示该投影完整，不能上升为实体、规则或问题完整。

原始来源、核验后的派生答案、作者图谱、当前结构化状态和会话报告分别保留权威。选中 NPC 秘密不等于角色知道秘密，找到物品目录不等于持有物品，拿到场景图不等于进入场景。预筛结果不改变 admission 输入的公开事实边界，不产生任何 apply/resolve 收据。

### 7. 新鲜度、复用与取消

缓存和在途工作绑定实际依赖，包括战役、世界线/循环、回合和当前输入、来源/图谱、规则/目录、世界/人物/会话，以及读取过的记忆、NPC 关系和日志版本。后台发布与更正必须使相关缓存失效；不能仅凭回合号或世界状态摘要判断它们未变。优先使用各所有者的现有版本/发布事件，避免每次全量重读所有文件来计算版本。

取料完成和出站交付均检查适用的版本。已历史化的记录仍可读取，但不能作为当前状态。会话新建、恢复、分叉、切换和来源发布必须重新绑定，不能把旧会话缓存带到新范围。

相同输入、上下文和依赖版本的准备共享在途结果；正确范围内的已取正文和决策可以复用。任何相关变化发生后仅复用仍有效的部分，不反复重启已经完成的昂贵工作。

复用既有期限、预算和取消所有权。等待方超时不得篡改其他所有者的任务；本任务取消后迟到结果不能注入后续请求，不能遗留无界工作。关闭回合或等待玩家时不启动新前台预筛。

### 8. PDF 咨询与真实准备分别减少重复工作

需要说明资料内容、且现有原文或核验答案已满足问题时，供应结果直接供 KP 使用，不为咨询强制创建或刷新图实体。来源资格不足、依赖视觉或缺少关键条件时走现有带工具读者及独立复核。

需要注册实体、准备结算参数或发布场景图时，继续使用当前准备与发布事务。先检查兼容的已接受成果、有效增量及已在执行的同目的任务；不得把所有目的统一成再次完整 prepare。单纯读到一段文字不能越过准备门，准备任务已发布也不能因为等待回包超时再次执行同一工作。

每类昂贵阅读明确记录未发生、复用、必要补读、必要发布或失败。120 秒超时记录是待解释的结果，不能通过延长超时、隐藏等待、返回空答案或删除准备守卫“解决”。

### 9. 预算服务于玩家等待

沿用有上限的可选前台工作，并将候选发现、Jev、实际读取、后续补选和重复触发累计到真实回合成本；不能用每次重置的局部期限掩盖总等待。预算包括失败和取消后的已消耗工作。

独立同状态 Jev 判断及真正可并发的只读操作允许有界并发；必须测到执行层，不能用 Promise 数量或排队中的 RPC 数量宣称吞吐提高。必须保留串行内核事务和现有运输顺序；本规格不授权为了并发重做内核。

请求准备时尽早计算实际 system/tools、当前输入、核心 capsule 和保留工具配对的空间。可选资料不能挤掉受保护内容。预算不足时优先保留有用的实际材料，明确记录被省略的范围和可用补读入口；输出整体放不下时，降级不得把已经花费的工作称作成功交付。

不引入一套新模型或依赖来承诺速度。具体批次大小、并发度、轮数和前台上限由现有实现的有界默认值起步，在受控对照中调整；最终参数及依据记录为实施决定。仅调整参数不满足材料供应要求。

### 10. 产品启用与安装包一致性

预筛作为独立可选能力使用现有 Jev 凭据和扩展设置。用户可从正常产品设置明确启用或关闭，不依赖隐藏的终端环境变量；密钥有效、功能启用、运行包包含实现和本回合实际执行分别可诊断。开发开关可以保留，但不能成为唯一产品入口。

本规格不要求自动改变已有用户的开关，也不把填入密钥视作自动启用。源码模式与标准产品入口需要分别验证。正式发布阶段必须检查唯一规范 App 的实际资源和进程，而非仅检查工作区 build。打包、安装和启动留到相应发布授权阶段；spec 或源码验收不等于已发布。

### 11. 可追踪的供应与使用证据

扩展现有遥测，串起同一回合/模型请求的候选范围、选择、真实读结果、材料版本/覆盖、最终送达、遗漏、后续普通读取和最终交付。宿主生成关联标识，模型不抄写。

交付清单必须从最终出站请求产生；prepared 事件不能冒充 delivered。记录各阶段耗时、来源准备等待、KP 请求及工具次数、Jev 用量、失败和复用。重复读取要区分“已送达材料再次读取”和“确实取得新材料”。必要时沿用最高层请求观察点补充观测，不添加第二个供应控制器。

模型对材料的语义使用不能仅靠日志计数证明。对接受的案例用真实请求、实际工具结果、最终回答/收据及原始来源做核查；无直接证据时标记未观察或无法归因。减少工具调用本身不证明回答正确，也不能证明某一份材料造成了提速。

遥测只用于事后评估，不回灌为下一回合的义务、节奏压力或强制 offer。密钥、私人路径和内部凭据不进入报告或发布规格。

### 12. 有序实施，逐步封闭三端

先冻结本规格涉及的契约增量和最高层请求观测；随后依次闭合实际上下文/预算与版本、完整材料供应、有限补选与复用、产品启用和真实验收。具体代码切片由实施时已有所有者划分，不创建并行架构。

每个材料切片交付时必须同时列出生产者、读取者、出站消费者、原本昂贵路径的保留或替代条件，以及回退行为。已存在的接口优先复用，缺失的系统接口按类别补全，不能只为一个房间、一页 PDF 或一个 NPC 写内容补丁。

## Testing Decisions

### 已确认的最高层验收边界

1. **真实 KP 出站请求。** 从实际 Pi context/tool hooks、宿主读取和当前 TypeScript 内核走到 provider 请求，检查实际 messages 中的材料、版本、完整条件、来源和遗漏。尽量使用这一条主缝验证各材料类型；不把池构建函数或 mock 返回的名字当作供应证据。
2. **真实玩家回合。** 使用项目规范的 RPC 驾驭器及真实 Grok Keeper，由主会话作为唯一玩家逐句推进。核查资料使用、必要补读、正确回应、真实收据和完整等待。鬼屋与 PDF 均为必需范围。

组件测试只补充取消、字节/范围、预算、版本和故障注入等可确定性定位的问题。不会为每个内部函数建立一套验收标准；不要求某种函数拆分、固定调用次数或内部字段排列。

现有先例包括真实 context hook 测试、workspace 预算和生命周期测试、只读投影与 SourceRef 测试、记忆更正及 NPC 日志测试、带工具原文读者对照、八类上下文题库，以及规范真桌遥测。旧 Python 对照不证明新增 TypeScript 行为；历史路径不作为实现入口。

### 材料与语义验收矩阵

每项记录结果、证据和未完成原因。材料已存在的确定性正例必须实际送达所需内容；语义漏选可以由有限补选或 KP 普通读取补救，但不能据此称“预筛替代成功”。全部正例、失败、取消和预算不足情况一起报告，不只保留成功题。

| 验收项 | 必须观察到的行为 |
| --- | --- |
| 原文尚无图实体 | 问到书中确有的未准备材料时，能从原始来源发现并供应；未扫描范围不被宣称不存在 |
| 已核验答案复用 | 同目的不同表述能复用相关有效内容；新增子问题仍明确缺口；原文版本改变后旧答案不当作当前答案 |
| 视觉材料 | 扫描、地图或条件依赖表格布局时走真实视觉证据或明确未取得；不以空文本证明无内容 |
| 模组结构与规则正文 | 正文里的条件、图关系和规则依赖进入请求；只有名称、家族和 span id 时不能通过 |
| G1 当前目的 | 同物体固定候选池，仅改变观察/使用目的，核查实际追加材料与动作权限分别正确 |
| G2 / G4 跨段合取与联合去重 | 问题需要 A+B；已有零段、一段、两段分别验证；重复/改写 A 与 A+B 组合包同时入池；A+A 不能被报告为问题齐全 |
| G3 上下文保真度 | 完整原文、忠实改写、丢条件摘要、仅缓存有材料分别处理；忠实改写不冒充原文核验 |
| G3 预算后漏供 | workspace 已准备但最终放不下、较小预筛仍放得下时，最终消息不能继续假设 workspace 内容在场 |
| 历史记录 | 真实 committed 记录可进入候选和最终请求，保留精确语句与归因，不因字段形状消失 |
| G5 有效记忆 | 当前问题涉及非在场对象、撤回后的主张及迟到旧抽取；取对相关记录，旧声明不复活 |
| 动态人物与物品 | 使用真实 PC/NPC/物品投影；关系、日志、资源、持有状态变化后只保留有效内容 |
| 目录发现 | 当前无该实例时仍可找到相关目录条目；条目存在不升级成已经持有 |
| G6 证据方向 | 同句不同说话者、支持/反驳方向及派生摘要分别核查，不把转述当背书 |
| G7 空间与公开范围 | 宅外/宅内、兴趣/明确旅行的材料和权限边界保留；不因同一 scene id 推导玩家已进入 |
| G8 冲突与未知 | 相关矛盾、题外矛盾、无依据新增分别保留或排除其影响，不靠常识补出原文没有的事实 |
| 核心状态 | 禁用、失败、超时和预算不足情况下，原始输入、核心 capsule、待决与必要工具配对仍正确 |
| 复用与取消 | 同状态重复准备共享工作；读取途中变化、后台发布、重连和取消后迟到结果不进入错误请求 |
| 必要准备 | 准备成功但回包丢失、已有兼容准备、真正需要新发布分别正确处理，不重复发布也不跳过守卫 |
| 实际启用 | 无密钥、有密钥但关闭、明确启用、源码及安装包分别可辨认；不得用设置 UI 存在证明运行中生效 |

八类既有上下文题作为回归设计来源，但固定小池通过不等于全书召回通过；历史题与设计扰动明确区分。新增语义验收包含未用于调参的真实材料，标签、参考答案和其他测试臂不进入模型上下文。不要重新建设一个庞大基准平台替代接线和真桌验收。

### 鬼屋与 PDF 的真实 A/B

A/B 主对照为预筛关闭与完整供应实现，用于判断总体净收益。在可取得有效冻结产物且确有诊断需要时，可以补充当前轻量预筛对照，解释哪些收益来自本次闭合缺口；不要求为此维护第三条生产路径或另建大基准。采用同一冻结运行产物的显式模式，或经校验的独立不可变产物；不能拿跨时段随意运行拼成受控对照。

覆盖内置鬼屋、一个短 PDF 和一个长 PDF。保留冷准备与已有成果复用两种条件，不能把热缓存收益计作冷启动收益。各臂从相同的有效源文件身份、初始准备代际、角色与场景状态开始；后续真实发布自然分化并被记录，不伪造相同世界状态。长 PDF 若在 setup 被真实阻断，应报告阻断而非冒充该类已通过；不能只跑通短 PDF 就宣布 PDF 类别完成。

从有效来源代际、准备完成状态或来源答案缓存发生分化的回合起，后续结果标记为来源/缓存状态不可直接配对；没有针对当前问题的逐项内容与状态等价证明时，不得把这些耗时差值单独归因于筛选算法。它们仍是实际端到端产品结果，应连同分化原因、阅读、发布和玩家等待单独报告，不能删除或与同状态直接对照混算。

固定实际 Keeper/Jev 模型、thinking、系统提示、工具和 Mod 设置、上下文预算、来源身份、起始状态及运行产物指纹；凭据只在消费进程中注入。不得在 A/B 期间重建运行资源。按对照顺序轮换，保留服务失败、排队和异常；不能只留下快的一臂。随机故事走向有分歧时说明哪些回合不再可比，不能删除不利证据。

玩家根据各局实际状态逐句选择可比目的，不预制脚本、不批量结算、不用 fixture 或第二套 Keeper 刷回合。固定源码/请求的机械对照可以帮助定位，但必须标明其不是真桌。若使用 worker，worker 不使用 Astra；主会话仍按项目规范担任唯一玩家。

每个真实回合至少报告：从提交玩家输入到实际交付的总墙钟时间、首次可见回应、预筛累计时间、Jev 请求/用量、KP 请求数、资料读取次数、PDF 咨询与 prepare 的次数/耗时、已供材料重复读、新材料补读、来源等待、最终请求字节、取消/失败和回答质量。首次可见回应不能代替交付完成时间，子调用时长相加不能冒充并发流程墙钟时间。

对每个场景组报告样本量、逐回合结果、配对差值、中位数、范围和超过 120 秒的回合；样本不足不宣称稳定 p95 或普遍性能。性能通过要求在质量与权限不退步的可比回合中，各必需场景组有可复查的净等待改善及重复阅读下降。某一组变慢、长等待问题仍集中出现或波动无法支持结论时，该组性能保持未验收，不能用其他组平均值掩盖。具体倍数或秒数不冒充用户已约定的 SLA。

### 完成判据

- 全部材料类别都有真实生产、读取和出站供应证据；缺材料时有真实缺口及后续路径，不以目录代替正文。
- 八类语义目标与预算、版本、取消不变量已逐项核查；已知失效案例未被从报告中删除。
- 至少对实际使用到的每个材料类别，有请求与源证据支持的 KP 使用核查；未观察到的类别继续标为未验收，不能靠全局注入次数补齐。
- 对“已替代”的阅读能指出实际省掉的生成式咨询或探索性往返；必要 prepare 与视觉核查仍受原有门保护。
- 鬼屋、短 PDF、长 PDF 的功能与性能状态分别报告；任何一组阻断或无法比较均保持明确未完成。
- 正常产品设置和实际运行代码一致；源码、真桌和安装包验收分别标记。没有规范 App 实机证据时不得标为已发布。

## Out of Scope

- 新建一套规划 agent、通用工作流 DSL、第二套 TaskRuntime、资料数据库或世界状态权威。
- 扩大到整个 Jev 规划/写作、resolve/apply、记忆抽取或 NPC 性格生成迁移；本规格只消费这些所有者已有的有效成果。
- 更换 Keeper 模型、规则算术、准入、待决、提交事务或玩家决策边界来获得速度。
- 把预筛资料直接公开给玩家，自动揭露手卡，或制造下一步行动、奖励、节奏义务。
- 强制全书深读、恢复 OCR/Markdown 资料包或旧 Python 内核；PDF 读取仍属于宿主。
- 保证所有任务一次模型请求、零工具调用、百分之百召回或唯一最小材料集。
- 为一个模组、房间、NPC、语言或物品用途硬编码语义规则，或手写内容来绕过系统缺口。
- 以生成式摘要替代应精确复制的原文；以原文引用替代必要视觉证明和准备发布。
- 本次规格编写不执行代码实现、提交、推送、打包、安装、重启或新的付费模型测试。

## Further Notes

### 当前证据与其限度

- 当前轻量预筛确实能调用部分真实只读接口，并在模型请求前注入可选材料；不能称为完全无用。缺口在候选范围、实际内容、上下文依据、生命周期和昂贵工作替代关系。
- 已有五回合样本中，鬼屋总耗时约为 501 秒关闭、518 秒开启；短 PDF 约为 900 秒关闭、853 秒开启。后者有运行期间构建变化等控制限制。这些结果是定位材料，不是本规格的性能验收。
- 已有长 PDF 对照在建桌阶段真实阻断，没有完成游玩对照。不得把已经选中开场或开始准备记为长 PDF 玩测通过。
- 已复现“workspace 被标成已供应但最后未进入请求”的预算漏洞。后台记忆/NPC 日志失效缺口有代码证据，尚无现有真桌记录证明发生过错误交付；两种证据强度分别保留。
- 原型证明了值得接入的机制，并保留了低置信度漏选、补料过量和复核预算等失败。不能把原型当生产验收，也不能因轻量实现未承接原型就断言原型无效。

本地依据：[完整核查所用的 A/B 报告](../research/jev-prescreen-repair-ab-20260921.md)、[宽范围原文预筛及增量实验](../../experiments/jev-wide-preflight/README.md)、[八类上下文覆盖矩阵](../../experiments/jev-context-case-bank/COVERAGE.md)、[统一架构主规格](jev-unified-runtime-refactor.md)、[PDF 阅读规格](visual-pdf-reader.md)、[内核契约](../kernel-rpc.md)。这些文档中含有历史记录，当前生产实现仅以 TypeScript 路径为准。

### 外部实现对照

已做针对性的两源对照，作为设计约束检查，不作为新增基础设施的理由：

- [Anthropic Contextual Retrieval](https://www.anthropic.com/engineering/contextual-retrieval) 展示了先召回、再按查询对实际段落重排、最后把选中内容交给生成模型的流程，也指出重排会增加运行时延迟。它支持保留段落语境、检查最终生成和测净收益；不能支持只筛工具名字或必然提速的结论。其向量库、生成式上下文预处理和固定候选数量不是本项目的前提。
- [Azure AI Search retrieve](https://learn.microsoft.com/en-us/azure/search/agentic-retrieval-how-to-retrieve) 分别暴露活动、来源引用、部分失败、耗时及运行/输出预算。它支持区分已检索、已交付和未完成，以及按阶段观察延迟；不能替代本项目的最终请求核验。其托管查询规划、默认超时和服务依赖不直接移植。

两者共同确认检索命中、最终供应和回答质量需要分别观察。它们不解决本项目的内核事务、视觉来源资格、玩家公开范围和记忆更正；这些继续由既有产品契约约束。
