# 历史参考 Mod：主守秘人直接检索，Jev 筛选，Exa 密钥在右侧设置

Status: **Native-search replacement 1.3.0 is implemented in the owned checkout; targeted LAN validation and genuine Grok/DeepSeek driver acceptance have passed; the final full extension rerun retained one load-sensitive timeout failure whose isolated rerun passed; mainline integration is pending. The earlier Exa/library implementation and acceptance below are retained historical evidence, superseded by kernel contract §124.12 (2026-10-09). No installed-App change is claimed.**

Earlier acceptance, Mod 1.0.7: selected preparation has genuine in-fiction scene/NPC evidence for the Herald and Cold Harvest PDFs. Earlier reference-question runs remain invalid-for-acceptance for natural enrichment; their failures are retained. Fictional-canon/style selection has controlled service evidence, not a fictional-country live-module pass. That repair was committed and merged into 0.9.6a, then packaged with PipiUI Dev signing and native CUA version/switch/credential persistence acceptance.

Tracker: [GitHub #110](https://github.com/Leehow/chatrpgv4/issues/110), labelled `ready-for-agent`.

## Approved focused-search execution record — 2026-10-06

**Objective:** Give the Keeper useful original historical evidence quickly, retain honest period/place limits, and prepare difficult missing evidence in the background. A clean generated report without supported originals is not completion.

**Approved scope:** The existing Exa/Jev historical host, scene query lane, lookup/scene wiring, durable reference packets, Historical Reference instructions and focused regression checks. Implement the three improvements approved in this chat. Photography, provider switching, generated-answer authority, purchase rules and unrelated timeline work are excluded.

**Baseline:** Mainline `0.9.7a`, source `86995f478`; Historical Reference 1.0.10. Concurrent timeline edits are preserved. Implementation uses task-owned `codex/historical-search-20261006` in `/Users/haoli/.codex/worktrees/historical-search-20261006`.

**Steps:** Contract first; focused exact/analogy plans and split price baselines; bounded background Deep-lite with original-only selection/persistence and later consumption; focused tests and LAN runtime checks; serial source integration preserving concurrent edits; lifecycle audit/closeout. App packaging and live-Keeper acceptance remain separate.

**Evidence:** The preceding API research found Exa Deep-lite preserves original highlights, while generated research answers could misstate region, period or table columns. [Exa Deep protocol](https://exa.ai/docs/search/deep-search) confirms `systemPrompt`, original `results`, and optional synthesis via `outputSchema`. This slice omits generated synthesis. Existing Jev and scope/cancellation rules remain controlling.

**Validation:** All 78 scoped checks passed, including seven real Pi/TypeScript-kernel request seams, focused retrieval/persistence/cancellation tests, scene reuse and system-language guards. The final runtime build passed on the LAN box and its output was fetched. An earlier full extension run was interrupted after concurrent suites overloaded the shared box; it is not a green full-suite result. Its in-scope failures were fixed and verified by the scoped run. Two independent baseline failures remain outside this slice: the control-flow inventory omits existing OpenAI Fast test calls, and Game Clock lacks the scoped-package capability required by the package-boundary check. No baseline was edited.

**Service evidence:** A real Exa/Jev probe returned scoped regional originals in 1843 ms and separate retail/wage originals in 1492 ms. A difficult archive lookup returned empty in 1519 ms and continued bounded Deep-lite in the background; Deep-lite also found no qualified original, so no invented detail was stored. These are three service samples, not a latency distribution, Keeper play or installed-App acceptance. Evidence and check logs are retained outside the disposable worktree at `/Users/haoli/Documents/Codex/2026-10-06/historical-search-implementation/`.

**State:** Source implementation and validation are complete. The accepted mainline commit and owned-worktree closeout are recorded in the retained evidence directory's `delivery.json`. No installed App was replaced by this slice.

本规格综合 2026-09-30 的讨论与当前 `0.9.6a` 实现调查。用户已确认验收链路：右侧 Mod 设置保存 Exa key → 真实守秘人按需检索 → Jev 筛选 → 正文实际融入材料，并测量增加的等待；代表场景为报社、档案馆和物价。最初仅交付规格；用户随后明确授权实现，当前进度与尚未通过的验收见文末。

## Problem Statement

模组通常写明地点能提供的线索，却未必充分描述当地人的生活、机构如何运作、环境和器物是什么样子。玩家进入二十世纪二十年代美国的报社或档案馆时，希望通过探索了解那个时代；KP 仅靠简略模组描述，容易把不同机构写成相似的柜台与卷宗。不同地区、年代的物价资料也不总在模组中。

用户希望按需取得真实历史参考，让 KP 在原有剧情中自然融合这些资料。速度是核心约束：不能另起研究 agent，不能让多个 LLM 反复阅读、总结、改写、交接，不能让每个新场景都多等一轮研究。

消费规则不是本功能要修的缺陷。此前真实玩测中，普通午饭与交通未扣现金、报纸主动使用消费额度、大额相机全额扣款。本 Mod 提供历史价格参考，不重新设计消费结算或建立强制日常账本。

## Solution

提供**默认开启、可手动关闭**的 **Historical Reference（历史参考）Mod**。右侧 Mod 面板提供明确的启用开关，玩家不喜欢历史补充时可以关闭；同一区域输入、替换或清除 Exa API key。开关状态与凭据配置分别保存。

运行链路为：**Jev 判断补充价值 → 主守秘人在正常推理中填写查询并调用工具 → 宿主调用 Exa Search 获取原始参考片段 → Jev 一次批量筛选 → 同一次工具调用返回所选材料 → 主守秘人继续叙述。**

没有独立研究 agent，没有整理报告，没有新增摘要或翻译模型调用。搜索结果作为带来源的参考直接进入主 agent 的上下文。既有战役事实、模组剧情、玩家选择和规则结算仍由原有路径处理。

## User Stories

1. 作为玩家，我希望在右侧历史参考 Mod 设置中输入 Exa key，以便在同一处完成配置并继续游戏。
2. 作为玩家，我希望保存后看到已配置状态，以便知道密钥已经保存，而无需回显密钥。
3. 作为玩家，我希望能替换和清除密钥，以便自行管理服务访问。
4. 作为玩家，我希望密钥可供本机其他战役复用，以免每开一局都重新输入。
5. 作为玩家，我希望历史参考默认开启，同时可在右侧按战役手动关闭，以便不需要额外启用步骤，也能按自己的喜好游玩。
6. 作为玩家，我希望保存密钥不会重新打开已被我关闭的 Mod，也不会立即发起联网请求，以便我的开关选择得到保留。
7. 作为玩家，我希望进入陌生时代的报社时能感受到具体的工作环境，以便知道自己身处怎样的地方。
8. 作为玩家，我希望查档过程体现当时当地的资料组织和接待方式，以便我的行动有可理解的对象。
9. 作为玩家，我希望对日常物件和价格的描述有所依据，以便各地点的生活细节前后一致。
10. 作为玩家，我希望历史价格不会自动变成额外扣款，以便既有消费规则继续适用。
11. 作为玩家，我希望感兴趣时能继续追问，以便进一步探索，而不是每次被动阅读一篇历史介绍。
12. 作为玩家，我希望危急行动或已有充分细节的场景不被无关搜索拖慢，以便保持节奏。
13. 作为玩家，我希望检索失败也能继续游玩，以免可选资料阻断主流程。
14. 作为玩家，我希望缺少配置时能从 Mod 设置看到原因，以便完成配置，而不是在剧情里看到技术错误。
15. 作为守秘人，我希望用关键词或一句自然语言直接查询，以便快速取得当前需要的材料。
16. 作为守秘人，我希望年代、地域与当前问题一同参与筛选，以免把不适用的材料混进叙述。
17. 作为守秘人，我希望区分确切地点资料与同年代的类比资料，以便在证据有限时仍能合理描写。
18. 作为守秘人，我希望读取相关原文而非另一个模型的摘要，以便自己决定取舍和表达。
19. 作为守秘人，我希望检索结果保留来源及不确定性，以免把网页发表日期误当成它描述的历史年代。
20. 作为守秘人，我希望既有模组与战役事实保持稳定，以免新查资料推翻已经交付的剧情。
21. 作为守秘人，我希望查过的材料能够复用且不重复灌入上下文，以便减少等待和上下文负担。
22. 作为维护者，我希望通过同一个主 agent 工具路径测试检索、筛选与交付，以便测到真正的消费者。
23. 作为维护者，我希望分别看到检索、Jev、上下文增加和主模型续写的耗时，以便定位速度代价。
24. 作为维护者，我希望看到真实叙述是否合理采用材料，以免把“接口成功返回”误报成体验改善。

## Implementation Decisions

### 1. 当前实现与接入位置

当前调查确认：

- 右侧 Mod 面板通过会话绑定的 `mods.list`、`mods.configure` 等接口管理普通设置。普通设置进入战役的 Mod 配置与世界快照，当前输入控件不提供独立 secret 存储语义。
- App 扩展设置已经支持 `format: secret`：写入现有凭据库，读取只返回存在标记，启用的扩展在运行时获得对应 secret；修改凭据已有在空闲边界刷新会话的路径。Jev 集成正在复用这套机制。
- `coc-keeper` 已有 App 级设置和右侧 Mod 面板，但当前声明没有 `settings.read`、`settings.write` 能力，需要显式补齐受控设置访问。
- 现有 `lookup` 支持宿主只读分支；Jev 资料准备已经具备候选筛选、来源、覆盖范围及最终上下文交付的表达。当前没有外部历史检索实现。
- 单循环具有主 agent 工具允许列表；某些叙述步骤仅允许交付及 `propose`。仅注册历史查询而未接入此处，会出现“看得见或注册了却调用不了”的接缝。

实现复用现有 Mod 生命周期、扩展设置、DecisionAdapter、工具分派和上下文交付。新增历史检索实现集中承担 Exa 请求、材料候选和缓存；不复制一套资料 agent，也不让 TypeScript 内核联网。

### 2. Mod 与密钥的所有者

首版 Mod 标识为 `historical-reference`，**默认开启**，版本按现有 Mod 包锁定。右侧提供明确的启用开关，复用现有战役启用状态及新战役默认设置。新战役未有用户覆盖时默认开启；显式关闭在重开、升级及更换密钥后保持。既有战役依照现有 Mod 加入与版本锁定规则生效，不绕过锁定强塞 Mod，也不覆盖已有关闭选择。声明一个宿主只读资料能力 `context.historical-reference.v1`；这是拟新增契约，现状尚不存在。Mod 管理启用状态、用途说明和可用能力；联网与凭据由宿主提供。

Exa key 使用 `coc-keeper` 的 App 级 secret 设置 `ext.coc-keeper.exaApiKey`。右侧该 Mod 的设置区展示密码输入、保存、替换、清除及配置状态，通过受控 `api.settings` 读写现有扩展设置。凭据控件在无绑定战役或 Mod 关闭时也可配置；保存不改变启用开关，不立即触发搜索。默认开启但尚未配置凭据时，显示待配置状态，保持正常游玩且不发检索请求。

Mod 的宿主设置声明只引用一个经宿主登记并校验的槽位。宿主将它映射到上述 secret 设置；第三方 Mod 不能通过任意字符串读取、修改其他扩展或任意凭据。该槽位不进入普通 `settings` 默认值、`mods.configure` 参数、世界快照、Mod 导出或包摘要。

沿用现有凭据库和安全存储，不引入系统钥匙串弹窗，不重构凭据基础设施。读取只返回配置状态，不返回密钥、前后缀或掩码值。只有宿主检索实现使用其运行时值；模型参数、工具返回、日志、错误和证据中均不包含密钥。

保存、替换、清除复用现有空闲边界刷新：当前正在执行的回合不被重启，界面区分“已保存”和“将在当前回合结束后生效”。刷新后的请求使用新值或未配置状态；不允许旧环境变量在刷新后复活已清除的凭据。关闭 Mod 会阻止新检索，即使 App 仍保存着 key。

Jev 沿用现有统一鉴权，不在本 Mod 再收一个 Jev key。Exa 或 Jev 未配置时，面板标明具体依赖，历史参考返回不可用并继续正常游玩。源码 CLI 测试可以由唯一 Exa 凭据读取器兼容 `EXA_API_KEY`；托管 App 以其受控配置为准，不用全局环境绕过清除或关闭状态。

新界面文字只有英文源，走现有展示投影；不增加按语言分支的字符串表。

### 3. 主 agent 的工具接口

沿用七个动词，在 `lookup` 下新增 `kind: historical_reference`。必填 `query` 为关键词或语义句子，最长 2048 字符；可选 `objective` 简述本次需要补什么，最长 512 字符。工具不接收 API key、任意执行命令、任意抓取 URL、模型名或研究深度参数。

战役、回合、场景、已经明确的年代和地域由宿主绑定。查询中的更具体目标可以保留，但未知年代或地点不得被宿主猜成已知。外部请求只发送查询所需的主题和背景，不整包发送模组私密原文、角色卡或聊天记录。无必要的模组秘密不属于历史搜索问题。

工具返回统一结果：状态 `ready`、`empty` 或 `unavailable`，可读的原因，选中材料，必要的覆盖不足或适用性说明，以及缓存命中状态。预算耗尽、配置缺失、认证失败、限流、取消和来源不足各有稳定原因；这些是可选参考的终止结果，不触发模型反复修参数。

结果通过这次工具返回进入主 agent 的下一次实际请求。不要先返回未筛选结果、再让主 agent 调筛选工具、再调取正文。宿主内完成 Exa 与 Jev 两步；最终继续叙述的仍是同一个守秘人。

### 4. Jev 的两次职责与调用顺序

**检索之前：** 将“补充历史材料是否值得”并入当前单循环已有决策批次。状态只包含当前行动、场景、时代地域、现有相关资料和剩余预算。判断包含体验价值，不能只问“没有资料能不能结算”。首次接触陌生机构、观察器物、询价或玩家主动追问只是判断依据，不是硬编码触发清单。

Jev 选择需要补充时，在下一次原本就要发生的主模型推理中提供这项可用读取及目的，主模型自己写查询并直接调用。不得为写查询单独启动 agent 或新增一次只写查询的 LLM 请求。Jev 不生成查询、正文、金额或来源定位符。

**检索之后：** 对有限候选一次批量询问相关性、对当前用途的具体帮助、时空适用性和是否与既有事实冲突。宿主据结果筛选并限制体量。候选可被标为直接适用、类比参考或不确定；不确定性不自动等于无价值，明显冲突的材料不作为此处既定事实。Jev 选择已有片段，宿主精确拷贝，不经模型重写。

候选来自实际返回材料，允许全部不选。问题与阈值在代表查询上标定并记录，不照搬其他 Jev 题型或不可逆操作的阈值。筛选未返回时，此次新增候选不进入生成请求；守秘人继续已有上下文，不启动另一个 LLM 代做研究。已交付材料保持其原有参考身份。

工具启用判定同时检查 Mod、凭据、当前回合绑定和预算。叙述专用步骤需要允许这一个已获 Jev 选择的只读分支，并继续拒绝其他不在该步骤内的操作；不能为它放开整个 `lookup` 或关闭原工具门。正常混合与叙述专用模式均走同一执行、取消和结果交付路径。没有 Jev 选择时，主模型提出的新需求交回下一次已有决策，不先执行搜索再追认。

### 5. Exa 请求与速度约束

首版仅接 **Exa Search**，通过宿主 HTTP 调用；不新增供应商框架或 SDK 依赖。一次请求取得搜索结果与 query-relevant highlights，关闭生成摘要、结构化答案生成、Deep Search 和 Agent。优先缓存内容，不在前台默认重新爬取每个页面。

拟用 `fast` 作为起始模式，实际测试同时比较 `instant` 的内容质量；只有测量表明更快模式仍满足材料需求才改变默认值。不把供应商宣传耗时当成本产品结果。不会通过网页发表日期过滤“1920 年代”，因为现代馆藏介绍也可能描述该时代；历史时期放在查询与适用性判断中。

首轮工程预算作为**待实测的初值**：每次最多 5 个来源候选，最终最多 3 个来源、合计 12 KiB 参考文本；每玩家回合历史检索与筛选共享至多 4 秒可选准备预算，且不得超过父任务剩余预算。预算从第一次历史查询开始计算，不因重试、二次查询或缓存检查而重置。

正常使用一次搜索；首版每回合至多两次不同查询，第二次必须仍在同一预算内、确有不同未解问题，不能形成自动查询改写链。相同请求合并，不盲目重试认证失败、限流或超时。已有材料不足可以保留未知，不以“必须找到”继续耗时。

宿主限制响应体、片段数量及最终上下文体量；截取不制造半句确定事实。数字、币种、计价单位等关键信息不全的物价片段仅能作为不完整参考。仅有标题或 URL 不算可用于细节叙述的正文证据。

这不承诺整回合只增加 4 秒：主 agent 在工具返回后的续写也消耗时间。验收必须单独报告搜索、Jev、增加的输入体量、模型往返次数、首次可见叙述和整回合等待。

### 6. 材料、来源与缓存

2026-09-30 用户补充：搜索结果必须随会话保存在独立资料空间，后续能直接取用，避免换个问法或重开就反复搜索。这里的会话资料与本局战役及世界线绑定，重开同一局仍可取回，不跨战役串用。

实现增加持久参考资料库：保存实际搜索摘录、来源、检索时间、原查询和筛选记录；缓存仍是加速层，资料库不是可随意清空的临时缓存。普通查询先查资料库，Jev 从已有目录选择相关材料并复用原文；不足时才搜索。主 agent 还可用 `reference_mode` 的 `catalog` 分页看目录、`read` 按返回名称取原文、`saved` 仅查本地、`web` 明确补充新资料；默认 `auto`。目录只交付有界元数据，正文按需进入上下文，不另开研究或摘要 agent。

读取已有资料不依赖 Exa key 或本回合的联网许可；重新判断适用性仍走现有 Jev。Mod 关闭不删除资料，重新开启可继续取用。上下文压缩不能使持久正文丢失；不同战役和世界线只读取自己保存的参考材料。耗时预算只累计资料读取与筛选的实际用时，不把主 agent 两次工具调用之间的推理时间算成资料预算。

每条可交付材料包含宿主颁发的语义别名、来源标题、URL、提供方返回的原文片段、可用的页面元数据、检索时间和适用性标记。页面发表时间、资料描述的时代、查询目标时代明确分开；未提及的地点年代保持未知。

Exa highlights 记作提供方返回的网页摘录。宿主保存本次摘录快照及内部内容绑定，用于重放和去重；没有完整网页及真实定位证据时，不伪称已核对全文、不编造页码或行号，也不借用模组原 PDF 的来源身份。检索出来的指令仍是网页数据，不成为系统提示。

缓存由查询、历史范围、供应商模式与内容选项等确定性字段索引，保存真实片段及来源，不生成缓存摘要。缓存不含 key，也不因换 key 复用错误的认证状态。新回合可复用原始候选，但必须重新确认当前适用性；旧的 Jev 结论不能脱离原场景直接套用。

当本会话已经保留该片段时，通过既有内容去重保留可引用性，不重复插入同一大段。若上下文压缩后正文已不在模型可见上下文，必须从保留快照恢复所需片段，不能只返回不可解的别名。资料以新增消息加入稳定上下文，不改写旧回合。

任务取消、切换战役、世界线或旧回合结果迟到时，不向新回合注入材料。可复用原始缓存与本回合交付资格是两件事。

### 7. 与故事、物价和规则的关系

资料用途是 `historical_reference`，不是模组事实、玩家已知线索、动作授权或结算结果。普通陈设和活动细节由 KP 在兼容现有故事的前提下取舍；不要求每一件背景摆设产生世界写入，也不要求所有选中材料都写进正文。

精确机构史、同年代同地区常见做法和其他地区的类比分开表达。参考材料可以让报社或档案馆的活动更可见，但不自动增加进入门槛、证件检查、收费、检定或剧情线索。已经交付的战役事实保持既有连续性规则；冲突成为未采用或有限适用的参考，不回溯改写剧情。

历史价格保留商品规格、币种、计价单位及来源范围。网页价格不得伪造为规则书 `price_id`。需要在故事中报价时由 KP 结合当场语境决定，经现有 `quote`、消费额度、玩家接受及现金结算路径处理。外部参考不自动换汇、不直接修改现金，不因掌握了更详细物价就开始逐笔扣小钱。

叙述通常吸收少数与玩家行动有关的细节；进一步探索时再展开。来源不强制插入每段剧情，后台证据可核查；玩家明确问出处或时代事实时，守秘人可据已交付来源回答。首版不增加资料阅读器或历史百科面板。

### 7.1 虚构设定优先，历史原型按用途参照（2026-09-30 用户补充，待实现与验收）

本 Mod 服务模组想营造的时代风味。模组可以采用真实历史环境，也可以只有中世纪等大致风格，国家、文化、机构、历法和制度均为虚构；还可以混合真实背景与虚构地点。不能给整本模组贴一个真假标签后统一照搬历史。每次取材应区分 **模组及战役已经确定的设定**、**此次选用的真实历史参照**、**允许借鉴的具体方面**。模组明确设定、已交付的战役事实和玩家已确认的设定保持原有权威；外部历史材料用于兼容的补充。

例如某虚构国家具有中世纪法国风味，查询可以面向法国相近时期的城堡、服饰、文书、工坊或集市，正文仍发生在这个虚构国家，并沿用它自己的名称、神祇、官职、法律和人物。借鉴文书外观不等于同时采用法国的宗教、继承法或性别限制；模组规定的差异成为取舍依据。真实美国背景中的虚构小镇或报社也按同一原则处理：可参照当时的一般生活和机构做法，具体机构的独有事实由模组与本局故事决定。

主守秘人在原本的推理中选择参照。模组已明确历史原型时优先沿用；模组未明确时，可采用与本局设定兼容的玩家风格偏好。仅有大致风格时，可为当前缺少的细节选择一个适合的、暂定的历史类比，并保留它是推断的身份。选择原型不授权改写虚构设定，未知原型不变成模组事实，虚构历法也不自动换算为真实公历。参照可以按方面组合，不必把建筑、衣着、政治和经济全部绑定到同一个真实国家。此判断由现有模型完成，不用国家映射表、关键词分类或额外研究/摘要 agent。

接线优先复用 `query` 和 `objective`：查询描述真实参照的时期、文化及所需细节，用途说明交代虚构设定、借鉴方面及已知差异；宿主仍绑定本局设定。Jev 的同一筛选批次同时看到两者，按本次用途判断是否能用，不能因为虚构国名不同而一律拒绝，也不能因为来源真实就把它的整套制度当作本局事实。合适的风格类比可保留；冲突内容不移植，混合片段仅取其兼容方面。Jev 仍只作有界选择，宿主交付原始摘录，正常场景与 NPC 应答由主守秘人融合。

物价优先借用相对尺度，例如食物、普通日薪、衣物和耐用品的比例，再按模组的币制、稀缺性、魔法或生产条件估价。原始锚点保留自己的时期、币种和单位；未给定兑换关系时不凭空确立固定汇率。虚构物件的报价质疑可检验估价依据或核对类比锚点，不把不存在的物件当成真实历史商品反复搜索。估价不写成来源中的历史价格。

保存材料时保留原始出处以及取得它时的本局语境、参照和用途，重用时仍按当前设定复核。叙述采用的是经过适配的细节，不会把真实地名、人物或制度悄悄加入模组；适配后的叙述也不会倒写进历史原始资料包。实现此区分及自然融合的验收仍开放，当前 1.0.5 通用类比提醒不算已经实现本条。

### 8. 三端所有权与可观察性

| 材料/状态 | 谁写 | 谁读 | 谁据此行动及如何证明 |
| --- | --- | --- | --- |
| Exa 凭据 | 右侧控件经宿主凭据库写入 | 宿主检索实现；界面只读配置状态 | 真实设置保存后请求可发出，清除刷新后不可发出；模型和战役文件无 key |
| 是否补充历史资料 | Jev 在当前决策批次作闭合选择 | 主模型本次工具提示与宿主允许列表 | 有需要才允许查询；未选中或 Mod 关闭不发请求 |
| 原始候选片段 | Exa 返回，宿主保留快照 | Jev 批量筛选 | 请求、候选、所选片段可逐项追溯，不靠生成摘要作中介 |
| 所选参考材料 | 宿主按选择精确组装 | 同一主 agent 的下一次实际模型请求 | 出站请求包含正文与适用范围；旧/迟到材料不混入 |
| 本轮历史取材结束状态 | 读取器在共享预算耗尽时写入 | 主循环当前 run、后续工具闸门与原生请求钩子 | 收回历史入口，桌外最终请求关闭工具；旧材料保留、下一条玩家输入恢复，分别以服务、真实 Pi 接缝与真桌验证 |
| 最终场景与报价 | KP 融合材料产出 | 玩家；涉及状态变化时仍走内核 | 人工核查叙述采用是否合理，必要收据与现有规则一致 |

沿用现有遥测记录需求判定、是否调用、Exa 与 Jev 耗时、候选/选中/交付数量、字节、缓存、预算退出和模型请求变化。网页与查询证据不进入产品可见错误详情中的大段日志。实际语义采用由真实玩测审核，不能用关键词命中率冒充；未采用不是 KP 欠下的任务，不写成下一回合义务。

### 9. 契约与实施顺序

先将 Mod 宿主资料能力、受控凭据槽位、`lookup` 新分支、结果身份、单循环允许条件及预算补入现行契约相应章节（§26、§58、§122、§124、§135），再实现。本文是待落地规格，不声称接口已存在。

建议依次完成：受控右侧凭据入口；宿主 Exa 检索与批量筛选；主 agent 工具和两种目录模式的实际交付；真实游玩及界面速度验收。全过程只修改这些需求直接涉及的路径，保留并行工作。生产内核仍只有 TypeScript；不恢复或修改旧 Python 内核。

## Testing Decisions

新增验收要求：包含虚构国家/文化或真实背景中的虚构机构，普通角色行动触发对适当历史原型的按需参考，并在场景或 NPC 办事关系中呈现；原型与虚构国名不同不会导致无用拒绝，模组声明的宗教、制度、人物与币制差异得到保留，既有材料可以重用。对同一份材料应分别验证可借鉴方面与不得移植的冲突方面。不得用手写故事示例代替真桌证据，也不得把已有真实英格兰/苏联背景测试认作虚构国家类比验收。

用户已确认最高验收入口是**右侧 Mod 设置到真实守秘人最终叙述的完整产品链路**。组件测试用于定位和稳定复现，不替代真实调用、素材质量和可见体验。

1. **设置及凭据。** 沿用 Mod 面板与扩展 secret 设置测试先例，通过公开 UI/host 接口验证输入、保存、替换、清除、跨战役复用、未绑定战役和当前回合忙碌时的生效时机。验证新战役默认开启、右侧手动关闭、重开及升级保留关闭选择、保存或替换 key 不重启已关闭的 Mod、默认开启但无 key 时不联网且不阻断游玩。确认真实 Mod 开关独立于凭据。使用测试密钥检查明文未进入战役配置、快照、导出、遥测或工具消息。用户不需要去另一处设置页补第二步。
2. **单工具完整交付。** 在现有 Pi 工具分派到实际 provider 请求的高层测试面替换网络与 Jev 服务，验证搜索一次返回的片段经筛选原样出现在同一个主 agent 的下一次请求。正常、叙述专用模式都要通过。结果不仅存在于宿主内存或日志中；无研究子进程、摘要作者或独立查询生成调用。
3. **适用性与拒绝路径。** 覆盖现代网页描述旧时代、异地同年代类比、不明日期、冲突材料、没有正文、部分物价、重复来源、全部不适用、网页指令、空结果、401、429、超时、Jev 不可用、取消与战役切换。检查继续游玩且不捏造参考，不用无限重试掩盖失败。
4. **预算和缓存。** 模拟慢服务验证总预算不被重复调用重置；缓存命中减少网络；片段已在上下文时不重复注入；被压缩后能恢复正文。关注行为和实际请求，不写只镜像内部函数的测试。
5. **真实素材与真桌。** 使用真实 Exa、真实 Jev、默认 Grok Build 4.7 fast/low 守秘人，主会话是唯一玩家，按现有 RPC 驾驭器逐回合游玩。代表情境包括首次进报社、在档案馆办事与进一步观察、询价及大小额购买；加一例已有充分资料或紧迫行动，验证不必搜索。不得预填 KP 调用、编造搜索响应或用脚本玩家冒充此验收。
6. **真实采用审核。** 对照来源摘录、筛选结果、出站请求、玩家可见叙述及收据，分别报告“取得、选中、交付、合理采用”。细节要服务行动和探索；没有新增无根据障碍、泄漏模组秘密、覆盖既定事实或改变小额消费规则。没有证明采用时不能只凭工具成功判绿。
7. **速度对照。** 固定源码/产物、主模型与思考档、模组、Mod 配置和可比场景，比较关闭、开启冷缓存、开启暖缓存；记录所有样本及超时，不只展示快例。至少覆盖每个代表情境的冷暖路径。报告工具延迟、首次可见文本、全回合耗时及模型请求数，注明样本量；小样本不宣称稳定 p95。4 秒是初始可选准备预算，不是已测速度承诺。即使素材有用，新增等待不合理仍不能宣称优化成功。
8. **可见 App 验收。** 从唯一 canonical PipiCOC App 的右侧面板完成 key 设置和启动真实游玩，验证重开、替换与清除。源码 RPC 成功不等于安装包入口成功。构建测试、签名、启动和清理遵守届时的 App 与 LAN 测试政策；不安装第二份 App。

实现通过的条件是完整链路可见可追溯、资料确实改善代表场景、失败可正常继续，以及延迟测量支持当前预算和模式选择。接口测试绿色或多写几句描述不能单独证明通过。

## Out of Scope

- 独立研究 agent、另一个 Keeper、生成摘要/翻译/整理报告的中间 LLM、自动多轮研究。
- Perplexity 或其他供应商首版接入、通用搜索插件市场、可由模型配置任意 endpoint。
- 所有时代地区的离线历史百科、专门爬虫、历史图片展示、OCR、馆藏 PDF 深读与新资料浏览器。
- 以美国二十年代为硬编码适用范围；它只是首批验收样例，年代地域仍为开放输入。
- 金钱规则修复、每日强制账本、历史价格自动改写模组报价、自动换汇、追加规则障碍。
- 凭据库重构、其他 Mod 设置整理、现有并行单循环任务的附带修改。
- 未经授权的凭据收集、公开密钥、推送代码或生产发布；本地实现、真实服务测试及 canonical App 验收已由后续指令授权。

## Further Notes

### 外部实践核对

- [Exa Search quickstart](https://exa.ai/docs/search/quickstart)确认自然语言查询可在同一请求返回相关正文片段；[Search best practices](https://exa.ai/docs/search/best-practices)区分检索、摘要、合成及重新抓取的成本。这支持本设计的短路径。文档中的缓存搜索耗时不是 PipiCOC 整回合数据；模式与预算需要本产品测量。
- [TypeSafe 的 RAG passage classification](https://docs.typesafe.ai/cookbooks/classifying_rag_passages)展示在检索与生成之间按相关性、可用证据和冲突筛选材料，支持 Jev 只选择、主模型负责生成的分工。其任务是技术问答；PipiCOC 还需判断时空适用性、允许类比、保持剧情连续性，不能照搬“纠正用户前提”来改写已经发生的故事。
- [Self-RAG](https://arxiv.org/abs/2310.11511)支持按需检索这个方向，但它依赖专门训练的生成与反思机制；本规格不引入那套模型或回路。
- 会话资料库采用“轻目录、按需取正文”：与 [Anthropic 的上下文工程实践](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)中持有引用、需要时再加载材料的做法一致；[LangGraph 的状态设计](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)也强调保存原始数据。这里只复用这个分工，不引入框架、向量数据库或跨用户记忆。
- 虚构背景的参照方式核对：[D&D Beyond 的冬季节庆设计](https://www.dndbeyond.com/posts/1636-preparing-a-winter-festival-for-the-holidays-in-d)将真实历史传统改造成奇幻遭遇，并单独考虑各虚构世界已有的节庆和背景；[Fate Core 的 Game Creation](https://fate-srd.com/fate-core/game-creation)将世界、人物和地点作为本桌先确定的创作内容。前者支持按风味适配参考，后者支持以本桌设定作为语境。它们允许的世界创作及机制扩展比本 Mod 更宽；本功能仍只供参考，不照搬新遭遇、检定或规则，也不把素材差异用于纠正模组。上述比较不证明当前实现已能区分或自然融合这些内容。

资料核对日期：2026-09-30。以上是设计依据，不是性能或历史准确性的验收结果。

### 交付边界

规格阶段新增本文并发布对应 `ready-for-agent` Issue，随后获准实施。共享内核契约和运行代码按所有权串行修改。若实测表明无需某个筛选条件、缓存层级或额外限制，应缩减实现；不要为了规格条目而增加不改善体验的流程。

### Implementation progress (2026-09-30)

#### Committed and installed delivery (2026-10-01)

- User authorized replacement, merge and commit. Implementation commit `064e5c78e` and task-branch merge `49f44b679` preserve concurrent narration, attack and chase changes; the other owner's dirty active-plan file was never staged. Nothing was pushed.
- Full LAN extension suite at `49f44b679`: **4251/4251 passed**, exit 0, 535 s. Raw log was copied before another remote build. This supersedes the earlier two-failure candidate snapshot, whose evidence and original assertions remain retained.
- The peer vehicle-roster merge advanced main while the first package was assembling. That attempt was cancelled before installation, leaving the old App intact and no staging residue. Latest `6bfd479ff` was built on LAN, then 74 historical/request/check/chase seam checks and the kernel typecheck passed. This is additional focused validation, not a second full-suite claim. The final package reused that unchanged checked LAN build; its temporary npm dispatcher was removed.
- Canonical `/Applications/PipiCOC.app` was replaced at `2026-10-01T06:29:58.065Z`, package receipt `6bfd479ff`. `PipiUI Dev` signing and deep/strict verification passed; designated leaf stayed `108232c5a713c15a869fc4c267e18d2e35cd276c`. TeamIdentifier is unset for this persistent local development certificate. Compiled kernel, kernel/Jev extensions, hybrid runtime and all historical Mod files match the validated source/build hashes. LaunchServices and Spotlight resolve the sole canonical App; the build-home link points back to it and staging is empty.
- Native CUA on the installed App selected and applied Historical Reference 1.0.7 in the task's GUI test campaign, visibly disabled then re-enabled it, and kept the new-campaign default on. Exa remained `Saved` in a secure input. After normal quit/relaunch, version lock 1.0.7, enabled state, default and saved credential persisted. No credential value was read and no story prompt was sent during this settings check. Existing campaigns retain their version locks until the user selects a newer version; they are not silently upgraded.
- Original worktree `.coc`, `.tmp` and `.pi` evidence was moved intact under `selected-preparation-repair-20261001/original-worktree-evidence/` before ordinary lifecycle closeout. The task-owned worktree/branch are closed; final audit is `audit_ok`, pending 0. Current delivery evidence is `delivery-acceptance.json`; the earlier real Keeper report/runs and controlled fictional-style probe remain separate evidence layers. The cancelled heartbeat was not reactivated.

#### Host scene lookup — replaces the selected preparation (owner, 2026-10-02)

The owner chose the host-built query with per-scene reuse after the installed App's 18 turns showed what the forced lookup round cost. Jev granted the need on 16 turns; the Keeper call that only wrote the query took 4–21 s, against 1–2 s for the search; and two turns ran out of budget before searching. Contract §124.12 *Host scene lookup* is authoritative. In short:
- A granted need starts the search in the host. The query is the era plus the scene name; the objective is the scene summary plus the scenario background. Both come from fixed shapes over authored fields, with no model.
- The result goes to the Keeper's first writing step.
- A scene's result is reused on later turns without a search.
- The Keeper's own lookup remains for specific details.

Mod 1.0.8 carries the new instruction.

#### English query, web for a new scene, period gate (owner, 2026-10-02)

The first App table of the host scene lookup (Blood Road, turns 5–9) never reached the web. Five loosely relevant library pages, all from one Chinese search on turn 1, stood in for every scene, and the prose borrowed one idea from them in nine turns. Owner rulings:
- The fast model writes each new scene's query in English, once per scene.
- A new scene searches the web; only an exact query match reuses the library.
- An excerpt must show how things were at that time.

Contract §124.12 has the mechanics.

#### Selected preparation repair — approved, superseded 2026-10-02 (2026-09-30)

- The user approved repair after four genuine in-fiction turns made no historical reads. The medieval 0.54 decision was projected but remained an optional permission, and the Keeper bypassed it. Soviet decisions 0.50/0.49 were declined by the unchanged greater-than-0.5 gate. The existing single need question mixes material value with interruption and shares an action-only compile policy. The negative scores' individual causes are not established by the retained telemetry.
- Repair scope: select one bounded preparation attempt on a positive need, using the same main Keeper/native tool channel; separate support value from immediate interruption in the same Jev batch; carry fictional-canon/style-reference purpose through lookup, filtering and normal narration. Preserve library reuse, price-anchor cost controls, resource closure and world-operation authority. No threshold reduction, unrelated NPC pacing/check-selection change, research agent or automatic per-scene web search.
- Work is isolated at `/Users/haoli/.codex/worktrees/historical-material-prepare/chatrpgv4-wt-pi-coc-v2`, branch `codex/historical-material-prepare-20260930`, base `e3144220c` plus the task's retained uncommitted 1.0.5 scope. Shared runtime owner remains active; main source, shared build and canonical App are preserved until safe integration. Validation uses the already agreed main-Pi request boundary and genuine natural-player scene/NPC turns, not hand-authored story examples. Current acceptance remains open.

##### Selected preparation repair outcome (2026-10-01)

- Applied only this task's checked patch hunks to `0.9.6a`, preserving the concurrent owner's chase/runtime edits; shared build and App unchanged. Candidate advanced to 1.0.7 so the already-installed 1.0.6 package/evidence remains immutable. The task-owned worktree is retained for uncommitted source and original evidence; no commit/push.
- Same-Keeper native lookup preparation is selected once on positive value with low immediate interruption, consumes no new query-writing/research agent, and releases ordinary narration afterward. Unsupported control, unavailable/refused reads, Mod off, declined need and closure do not leave a native constraint or retry obligation. Pi's tool-batch operation ID differs from its inference ID; the preparation binds the current run's active model request instead of assuming those IDs match.
- Genuine fresh setup and ordinary actions: Soviet department query 0.79/0.14 led to two analogous excerpts, tool 2.212 s, turn 50.2 s, with the umbrella/subdivision distinctions delivered in Aganin's voice. Hallway observation then reused one original at 1.306 s and no new Exa (turn 35.1 s), describing clerks, office labels and folder handoff as compatible fiction. Medieval document-room entry 0.75/0.20 led to a historical read at 2.311 s (turn 37.2 s), with storage/material motifs in narration while the guard retained the module's demand to leave. No player input requested retrieval or a historical lecture. Exact room fittings remain fictional adaptation, not separately verified institutional facts.
- 63 integrated focused checks, four actual Pi/TS request seams, kernel typecheck and diff checks passed. Initial full LAN result 4225/4227 retained: two deterministic failures were repaired without changing their assertions. New setting text now preserves the original capsule-header prefix; stable Mod instructions were consolidated from 5049 to 3007 bytes after a prior-instructions control made the request-budget failure disappear. Both original failed cases pass in focused reruns; the full suite was not repeated.
- The controlled fictional-country/actual-excerpt Jev probe selected a compatible analogue at 0.90 confidence; this is not a fictional-country live-module acceptance. Raw evidence and readable output are in `.coc/playtests/historical-setting-20260930/selected-preparation-repair-20261001/`. Whole-turn timings are observational, not a causal speed comparison. Package and visible CUA acceptance are still outstanding because the shared-runtime owner is active.

#### Scenario setting propagation — approved, Mod 1.0.5 (2026-09-30)

- User requested that the exact Herald of the Yellow King and Cold Harvest PDFs drive historical retrieval, then authorized completion and end-to-end tests. Confirmed defect: both historical callers read nonexistent `capsule.campaign.era`, while the actual authored module briefing appears only at opening/resume.
- Every capsule now retains a small, bounded `historical_setting` containing copied era, starting place and background. The selected entrance and source-bound, approved public guidance take precedence; existing graphs fall back to module declarations and their keeper-only summary. It never uses the investigator's rulebook finance fallback as historical era. The same helper supplies the main lookup context, Jev need batch, saved-reference/anchor and result applicability, and exact-query cache. No new model call or semantic keyword mapping is added.
- External comparison: [TypeSafe structured state](https://docs.typesafe.ai/concepts/state) and [passage classification](https://docs.typesafe.ai/cookbooks/classifying_rag_passages) support explicit contextual relevance judgments; [Exa Search](https://exa.ai/docs/reference/search) supplies query-related original excerpts. These validate carrying authored context through the existing query/selection path, not an additional research/summarization process. They do not prove this product's applicability or latency; real Keeper evidence is still required.
- Initial deterministic evidence: five source-projection/capsule/source-binding tests and nine loop tests passed; existing historical service/library/price tests passed 32 cases; the isolated candidate's four actual Pi/TS request seams passed. Kernel typecheck passed. LAN availability changed from idle to unreachable before dispatch; the remote suite did not run (exit 3), so the candidate alone was built locally and no shared build/App was replaced. Real PDF setup/play and final applicability observations are pending below.

##### Final source and genuine-play evidence

- Final source: `0.9.6a`, isolated candidates under `.coc/playtests/historical-setting-20260930/`. The final `runtime-v3` source hashes match the current scoped implementation; compiled kernel source maps also match the setting producer. Final validation: **59** focused service/capsule/library/price/loop/language/package/inventory tests and **4** actual Pi/TS request seams passed, plus kernel typecheck and `git diff --check`. The request seam now completes the automatic turn-zero opening before checking a real player input and filters observations to historical batches; initial failures exposed that distinction, not a missing player text in the live path. No full LAN pass is claimed.
- The first real Herald run exposed an omitted campaign guidance key despite an approved public artifact. The reader now recovers only a unique accepted guide with the same source, opening identity and language; a corresponding regression covers ambiguity and source mismatch. Final requests carry the copied 1080/Norman conquest/Wessex/Sherborne background rather than the modern finance fallback. Cold Harvest requests carry the copied 1937/Great Purge/Kuybyshev/NKVD/state-farm background rather than a US 1920 market.
- A retained five-passage Jev comparison (`filter-probe.json`, `filter-partial-coverage-probe.json`) showed that restoring region alone still rejected all excerpts. Clarifying partial coverage and institution-specific analogy kept four as analogous while rejecting one. This updates the existing selection question only. The next live named reads exposed a second missing input: selection saw the reference title/address without the player's purpose. `selectionBatch` now carries the latest host `player_input`, alongside objective and setting; fresh and saved provider requests verify that seam. No extra model decision or threshold change was added.
- **Herald final play:** standard RPC driver, Grok 4.7 Fast/low, this main conversation as sole player. Two original saved references were read and qualified; the Keeper used parchment, writing tools and early document preservation, explicitly separating later archival furniture and different institutions. Saved tools took 1104/392 ms, no Exa; the player turn took 32.1 s. A new query authored by the Keeper named circa 1080, Norman England, Wessex and prices/wages; two excerpts supplied qualified monetary anchors. Tool 2067 ms, including Exa 1049 ms; player turn 25.1 s. The next pottery/shoe question estimated from those anchors without any tool or Exa request (14.3 s). The wheat source is a high historical observation and later wage comparisons are explicitly later; these are approximate scales, not verified local retail quotes.
- **Cold Harvest genuine play:** the Keeper queried 1937 Soviet/Middle Volga accounting and distinguished sovkhoz wage labour from kolkhoz labour-day accounting. It used original documents as analogies, not the fictional farm's records. Final price acquisition queried the relevant region/system and preserved a 1937 ruble wage excerpt; tool 3149 ms, including Exa 1886 ms, player turn 27.2 s. Work boots and a kerosene lamp were subsequently estimated without any tool or Exa request (14.4 s). After stopping and reopening the process, a catalogue/named read recovered the exact saved wage excerpt and URL and supported a soap estimate, with **zero new Exa searches** (24.3 s player turn).
- **Retained failures and limits:** the copied pre-existing Cold Harvest import initially fell from source-reference guidance to legacy preparation, then the Keeper guessed unsupported module identifiers. This unsuccessful setup is preserved under `historical-cold-setup-20260930`; it is not counted as a historical-search failure or a passed setup. A new clean project imported the exact same PDF through the normal setup flow and reached ready in three genuine turns (86.6 s total), without changing that adjacent setup path. Some Keeper wording still conflates rejected saved excerpts with absent saved text; the packets demonstrably retain the originals. No broader delivery/encoding repair was made, and the whole-turn samples are not a controlled speed improvement or historian review of every generated claim.
- Raw acceptance is `.coc/playtests/historical-setting-20260930/acceptance.json`; readable evidence is `report.md` alongside it. Earlier candidate sources, runs, packets, failed tests and service comparisons are retained. Temporary auth/model copies are removed after all owned processes stop; protected original vaults remain untouched. `mod` automation stays paused. No commit/push or shared build replacement occurred.
- **Remaining package gate:** task “核查 Jev 接管检定选择” (`01a0efbf-f3c9-7620-9fe1-427f032814b5`) remains active in the shared runtime/acceptance work. The installed canonical App receipt remains 2026-09-30T13:26:01.061Z with Mod 1.0.3. Do not overwrite that App while its owner is active. Mod 1.0.5's stable signed canonical package and visible CUA acceptance are still pending; source/play success is not an App-update claim.

#### Price-anchor optimization — implemented and functionally verified (2026-09-30)

The user now requires reusable price anchors instead of paid per-item price lookup: acquire representative evidence for a period/region, save it, and let the main Keeper invent plausible item quotations from that scale. Only a player's challenge to a concrete quotation permits a specific-item web check. A routine question about cost, a new item, an NPC's complaint or the Keeper's own uncertainty does not qualify. Estimated quotations must not be presented as independently sourced exact historical prices; ordinary narrative need not carry repetitive disclaimers. Existing quotations and completed transactions remain subject to the ordinary canon and Spending Level rules.

Implementation scope: the existing historical-reference reader/library, its host-supplied player input, Mod instructions/version and focused tests. Do not change the separate meta-routing/speech-steer work, check-selection assertions, or play-opening encoding issue. The check-selection owner is active on read-only diagnosis/live subsystem tests; preserve its work and do not replace the canonical App while it is using the runtime.

- Add one bounded Jev preflight before an auto/web lookup can spend Exa credit. Batch the query category (setting detail / reusable price baseline / item quotation), the player's actual quotation challenge, and saved-reference relevance in the same request. This replaces the existing paraphrase-selection call when one was needed; there is no researcher or summarizer. The host supplies the latest player text, never a tool argument claiming permission. Unavailable/uncertain policy does not spend Exa credit.
- Price queries first consider same-setting anchor evidence even when it mentions other objects. A normal item-price query with no usable anchors returns a request for a broad baseline; it does not search that item. A broad baseline may be acquired when no suitable anchor exists. Existing suitable anchors win over `reference_mode=web` unless the player actually disputes an item quotation. Different markets may need separate anchors; semantic applicability remains Jev's, not a keyword list.
- Preserve originals in the existing library. The applicability batch also checks whether each price source contains a usable monetary amount with a currency, unit and historical period. Persist an additive price-anchor marker only for selected, qualified originals; retain old packets unchanged and evaluate legacy price references when read. No LLM-generated item quotation is stored as source evidence.
- Deliver an explicit estimate-from-anchors instruction with price references. The main Keeper performs interpolation and invention during its normal generation; the kernel still owns arithmetic and purchases. Saved reads remain possible after restart/compaction and without an Exa key.
- Acceptance: one anchor acquisition → several different ordinary item queries and explicit `web` attempts make zero new Exa requests; restart still reuses anchors; an actual player challenge permits a targeted check; query text cannot impersonate a player challenge; another setting cannot silently use incompatible anchors; no usable anchor/failed policy continues without false source claims. Cover the real Pi request seam, a small live Jev/Exa service probe and canonical App acceptance once shared ownership is idle.

Precedent check: [TypeSafe speculative fan-out](https://docs.typesafe.ai/patterns/fan-out) supports batching independent decisions and routing in host code. [Exa Search](https://exa.ai/docs/reference/search) supplies original highlights and content-cache controls; provider content caching is not a replacement for the application's decision to avoid another paid search. Keep the existing direct Search transport and four-second preparation budget.

Price optimization progress:

#### Retrieval termination repair — approved (2026-09-30)

The user authorized a design repair after the retained 120.261-second run exposed a missing resource lifecycle seam: the reader returned `budget_exhausted`, but the loop kept offering history and the catalogue remained readable, causing three additional model continuations and failed named reads. The repair makes exhausted historical preparation terminal for the current host input. The reader writes that state; the loop reads it, removes the available offer and gates further historical calls. The loop also closes this optional resource when its existing whole-run budget has elapsed, so fast saved reads do not permit unlimited slow model continuations. No new time threshold or arbitrary one-read rule is added. An out-of-fiction final compose uses native no-tool mode so the result becomes an answer instead of another lookup. Already delivered excerpts stay in context and the durable library. A later player input resets the resource, so ordinary source recovery and genuine price challenges still work. No extra researcher, summarizer, Jev decision or semantic retry classifier is added. World actions retain their ordinary tool authority.

Precedent comparison: [Anthropic's tool-choice control](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools#forcing-tool-use) confirms native `none` can disable calls while keeping tool definitions; its cache guidance cautions that message cache entries can still change. [LangGraph's maintained agent executor](https://github.com/langchain-ai/langgraph/blob/main/libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py) treats remaining steps as host state and refuses another tool loop at exhaustion. The shared principle is host-owned termination. PipiCOC retains the real Keeper's answer and existing reference delivery instead of using LangGraph's canned exhaustion sentence, and preserves the stable tool-definition prefix. This repair is scoped to historical resource closure; it does not rewrite the general interaction classifier, check assertions or unrelated narration.

Pending validation: focused service/loop/native-request and actual Pi seams, needed LAN checks, original natural-language reference scenario with a real Keeper, and canonical App verification after shared runtime ownership is idle. Keep old slow/incomplete evidence alongside the new run. Implementation progress will be appended here; no completion is claimed from the design alone.

Source progress: implemented as Mod 1.0.4. The initial deterministic regression failed on the old reader's missing closure marker, then passed after the repair. Final service/loop/native-request checks passed 23 cases; price/library regressions passed 17; real Pi/TS-kernel request checks passed four cases, including next-player recovery and normal delivery after a closed optional read in the same batch. The first Pi fixture attempt omitted required Choice distributions and was corrected without changing production thresholds or check-task assertions. Kernel typecheck passed. Source edits were partly captured by another task's WIP commits while this work continued; no commit or push was made by this task.

LAN evidence: the first integration snapshot passed 4175/4177, with two scene-preload failures while several other full suites shared the box (`.tmp/history-termination-lan-ext-details.log`). A later snapshot passed 4182/4183, with one bounded-recall fixture failure (`.tmp/history-termination-final-lan-ext-details.log`). That existing bounded-recall case passed in isolation in 2279 ms (`.tmp/history-bounded-recall-isolated.log`); neither its fixture nor its assertions were changed. Do not relabel either full run as wholly green. The final candidate's frozen compiled sources and historical caller were audited independently of the concurrent packing repair; its kernel/runtime build artifacts are retained with source maps.

Real Keeper evidence: `.coc/playtests/historical-termination-20260930/acceptance.json` and its original driver/campaign records. Grok 4.7 Fast / low continued a byte-identical copy of the previously played campaign through the standard driver, with the primary conversation as the sole player. With budget left, nine saved lookup calls produced a useful sourced answer in 31.398 s and made no Exa request. A fresh two-market question then exhausted the service allowance: the loop consumed the closure, the next native OpenAI Responses request recorded `tools_disabled: true`, and no later historical call followed. The Keeper completed its answer in 30.862 s with retained London material and explicit Paris gaps. A later player request retrieved London originals and estimated boots/scarf in 34.964 s with no Exa. Only one new Exa search occurred in this run. These are distinct sequential samples, not a controlled speedup claim. The Paris lookup's initial reuse of London sources remains an applicability caveat; the Keeper did not claim that those were verified Paris prices. Temporary profile credential copies were removed after the driver stopped; all play evidence remains.

Canonical-App gate: the scope/packing repair has been integrated and the current main build's source maps match 883 project source files with zero mismatches. That same thread has now started a new, extended real playtest through at least the first two chapters. Under the previously requested shared-runtime/App preservation gate, this task has not replaced the canonical App during that run. Its receipt remains 2026-09-30T13:26:01.061Z and its Historical Reference package remains 1.0.3. The repaired 1.0.4 source and genuine source-play evidence above are complete, but integrated canonical-App closure/next-player CUA verification remains pending. Automation `mod` stays paused; no new scheduled sends were created.

#### Price-anchor implementation and verification

- Implemented as Mod 1.0.3 without new lookup parameters or a new agent. The host passes `state.playerText`; query/objective cannot supply the dispute authorization. Search policy and saved-reference scoring share one Jev batch. Qualified originals carry additive `price_anchor` metadata; old packets remain readable. Marked anchors are prioritized over newer unrelated sources; if the bounded window omits other known anchors, a new baseline is withheld rather than paid for without checking those records.
- Focused transport/library/price/Pi-seam/loop/inventory checks passed 38 cases, followed by the additional long-library regression (the price file now has seven cases). The Pi seam verifies actual host player input across real session turns; a fixture initially raced the automatic opening, and was corrected to await that opening before issuing player turns. No runtime guard was weakened to accommodate the fixture.
- Live Jev calibration is retained at `.coc/playtests/historical-price-policy-calibration-20260930/`: ordinary price and bargaining challenge probabilities were 0.02, a genuine challenge 0.96, and a query claiming a dispute while the player simply ordered coffee scored 0.02. An additional different-market check rejected all nine retained US-1920s candidates as anchors for London-1880 (0.06–0.17).
- Live service probe `.coc/playtests/historical-price-anchor-service-20260930/results.json` is provider evidence, not play. One Exa request acquired three qualified sources in 3309 ms. Wool coat, room rental and notebook queries (including explicit web mode) used zero new Exa requests; a new reader without an Exa credential reused anchors for taxi fare. These local reads took 792/1680/1395/848 ms. A genuine player challenge to a wool-suit quotation permitted one targeted request (1779 ms). Total Exa requests: two. No generated item estimates were saved as source evidence.
- The LAN extension snapshot passed **4146/4146**, exit 0, 337 s (`.tmp/history-price-lan-ext-details.log`). After the final candidate-window change, all **39 focused cases passed on LAN** (`.tmp/history-price-final-focused-lan.log`), including the seventh price test. The rerun used the reviewed remote snapshot plus the two owned changed files; it did not replace the shared local build or absorb the other owner's in-progress runtime repair.
- On the user's explicit request to test, genuine source-mode play ran through the normal setup and play drivers with Grok 4.7 Fast / low and the primary conversation as the sole player. An immutable, hash-checked snapshot isolated this run from the active shared-runtime owner; it is not an alternate App. Evidence: `.coc/playtests/historical-price-live-20260930/acceptance.json`, the snapshot manifest, and original campaign/driver records under its `runtime/.coc/`. Fresh setup finished after its initial 180-second wait timed out; that timeout remains evidence, not a fast setup pass.
- The real Keeper acquired and saved a national-wage anchor with one Exa search (3163 ms for policy/search/selection), then quoted ordinary pen, notebook and umbrella prices from the saved scale without another Exa request. An actual challenge to the pen quotation authorized two targeted Exa searches; the second exhausted the remaining selection budget after its originals were retained. The returned luxury-pen evidence did not verify the ordinary-pen estimate, and the Keeper explicitly said so. After a full process restart, shoes and shirt were estimated without Exa, followed by actual saved-excerpt retrieval (650 ms, search_ms=0). Total network searches in this live run: three, all during initial acquisition or the explicit challenge. This confirms latest-player dispute authorization in the tested reference scope; it is not proof for every interaction-scope classification.
- Live limitations remain visible: two natural requests were classified `uncertain` by the frozen interaction-scope runtime, preventing online acquisition until the player explicitly clarified the out-of-fiction request. The initial successful acquisition turn took 120.261 seconds despite its 3163 ms retrieval: the Keeper made five lookup calls, including further reads after the four-second preparation budget was consumed. The ordinary-estimate, challenge, reopened-estimate and reopened-source turns took 26.214/19.781/11.688/13.709 seconds respectively. These are sequential samples, not a controlled latency comparison. Do not claim latency acceptance or complete ordinary-pen price verification from them.
- **Integrated build and App verification completed:** the shared-runtime owner settled before packaging. Its final LAN extension suite passed 4162/4162 and focused kernel RPC tests passed 29/29; logs remain `.tmp/jev-root-ext6.log` and `.tmp/jev-root-kernel2.log`. The canonical App was built at 2026-09-30T13:26:01.061Z after an isolated LAN runtime build, with PipiUI Dev and unchanged designated leaf 108232C5A713C15A869FC4C267E18D2E35CD276C. Installed kernel/runtime hashes match the final validated source build. `/Applications/PipiCOC.app` is the sole real bundle and LaunchServices/Spotlight result; the build-home back-link is correct and staging is empty. Source changes remain uncommitted.
- Canonical-App evidence is `.coc/playtests/historical-price-app-20260930/acceptance.json`, `package-audit.json` and the copied original session. Through CUA, the owned test campaign was upgraded to 1.0.3. Both campaign and new-campaign defaults were on. Disabling persisted through a full App exit/relaunch; the original encrypted credential remained saved with an empty password field. The campaign switch was restored to on. Grok 4.7 Fast / low acquired three selected sources with one Exa search (2543 ms). The next real request reused those originals (1404 ms) and quoted shoes, shirt and umbrella prices; no new search occurred. Actual doubt about the umbrella quote then enabled one targeted search (3069 ms); no excerpt established its exact price and the Keeper said so. After restart, another saved read (1070 ms) recovered the actual coffee-per-pound passage and supported notebook/scarf estimates without Exa. Total new App searches: two. This also verifies the latest host player request reached the price-dispute policy in the new reference path; no historical caller adaptation was necessary.
- **Open delivery/performance observations:** the first App acquisition answer was only an out-of-fiction acknowledgement; actual figures and estimates appeared after the next user request. App whole-turn samples were 14.660 s for that incomplete acknowledgement, 36.353 s for sourced estimates, 15.889 s for the challenged-price fallback and 14.994 s for restart/read/estimates. Retain the separate 120.261 s source-play outlier above. The cost-control/persistence behavior passed; these samples do not establish uniformly fast or first-attempt-complete delivery, so overall experience acceptance is not an unconditional pass. No adjacent narrative/interaction-scope repair was made during this testing request.
- The user cancelled periodic automatic sends on 2026-09-30. Automation `mod` remains `PAUSED`; do not reactivate it without a new user request. All source, test, package and play evidence is retained. The open observations above do not require the user to re-enter credentials or perform setup.

- User authorized implementation after approving default-on behavior and providing an Exa credential privately. No credential belongs in this document or the issue.
- Mainline: `0.9.6a`. Concurrent check-selection work owns the existing dirty runtime changes; preserve them and integrate only non-overlapping historical-reference changes. No commit, push or alternate App is authorized.
- Contract: added §124.12 in the existing material-supply section, away from the concurrent §159 check-selection edits.
- Next: Mod declaration and right-panel credential control; bounded search/filter module; main-loop tool integration; focused tests and LAN build; live Exa/Jev/Keeper and canonical App acceptance.
- Initial LAN probe selected idle `leehow-pc`; live calls and GUI stay on the Mac. Current results are recorded below.

#### Source implementation and retained acceptance

- Source implementation now includes the default-on Mod (1.0.1), registered host secret slot, right-panel password/save/clear controls, explicit Jev dependency status, Exa search with verbatim excerpts, a batched applicability decision, per-turn budget and cache, and the existing compile/route need question. Main Keeper lookup is allowed in both ordinary and narrator-only modes; other narrowed tools remain restricted. Late results recheck campaign, worldline, loop and turn.
- Runtime build passed on the isolated LAN checkout `pipicoc-history-reference-20260930`. An earlier attempt using the ordinary checkout name encountered another task's live scratch; it was abandoned, not repeatedly cleaned. Electron source build and preload verification passed on the Mac.
- Focused checks passed: historical transport/cache/cancellation/credentials, ordinary and narrator-only selection, the real Pi request-supply seam, right-panel secret UI, existing Mod panel behavior, source-language/seed guards, package boundaries, brief budgets, and control-flow inventory. The request test initially supplied the wrong opening turn; corrected to the actual turn-zero binding and retained as a real TS-kernel/Pi seam test, not live-play evidence.
- Full LAN extension suite at the earlier intermediate snapshot: 4111 tests, 4098 passed, 13 failed, exit 1. Four failures belonged to this task (two shared brief-ceiling checks, exact package-file boundary, and call-site inventory). Fixed with a separate 58-byte brief and registered read leaves; all four and their surrounding tests pass in the focused rerun. The remaining nine failures are in the concurrently edited check-selection suite. Do not claim a clean whole-tree run or alter those assertions to finish this feature.
- Real Exa + Jev provider samples are retained under `.coc/playtests/historical-reference-provider-20260930/`: three cold results took 1679/1027/1074 ms; warm results took 629/339/316 ms. This is tool timing, not whole-turn latency or a p95 claim.
- Genuine setup and sequential Keeper play are retained in campaign `historical-reference-20260930` and runs `historical-reference-setup-20260930`, `historical-reference-play-20260930`, and suffixes `play-b`, `play-c`, `play-d` with the same date. Keeper: Grok 4.7 fast / low; the main Codex conversation was the only player. No scripted Keeper/player was used for these runs.
- Initial live need decisions declined retrieval; the instrumented observation at turn 3 was 0.59. A retained four-case need calibration returned 0.76 for both exploration examples and 0.06/0.23 for urgency/redundancy. The optional-read threshold is now greater than 0.5, not the initial 0.65. This grants an optional read only; applicability filtering and existing write authority remain separate.
- Live turn 4 (newspaper): Keeper authored the query, selected 3/5 actual sources, and used subject/person filing and reference books/city guides in its prose. Tool 1568 ms; whole player turn 66.2 s. Turn 5 (records office): selected 3/5 analogous sources, tool 1651 ms; whole turn 39.5 s. This delivery overstated an analogous indexing procedure as the institution's restriction; an explicit usage limitation was added to the tool result. This semantic limitation needs another representative live check before final acceptance.
- Live turn 6 (ordinary lunch): selected 3/5 analogous menu sources, tool 1665 ms; whole turn 43.8 s. The 0.35 USD purchase used spending_level and cash remained 29 USD. Turn 7 (same coffee again) had need=0.47, made no search, and finished in 25.3 s. These different actions are not a controlled latency A/B.
- Follow-up turn 8 (`historical-reference-play-e-20260930`) ran with the explicit usage limitation: a normal reader asked how to use the central library. The Keeper retrieved 3/5 sources in 2050 ms and described a card catalogue, call numbers and delivery to a reading-room seat; the requested orientation proceeded without asking the player for a credential or payment. Whole turn 66.2 s. This checks one normal-use example, not all historical accuracy or access-rule cases. Existing check-selection notices still appeared independently and remain with the other task. All source play daemons were stopped after their completed turns; evidence was retained.
- Exa was saved through the existing encrypted vault implementation in the isolated source test profile only. The actual secret is never written here, in the repository, or in the issue. The App credential control still requires visible canonical-App acceptance. Its value is available to the test driver without putting it in process arguments.

#### Session library addition (owner, 2026-09-30)

- Mod version 1.0.2 adds immutable reference packets in a separately scoped local library. Each campaign/worldline/loop has its own namespace; packets preserve fetched excerpts, URLs, timestamps, queries and selection outcomes. Exa's exact-query cache remains a disposable acceleration layer. Obtained originals are retained even if subsequent Jev selection fails; unknown/rejected applicability is not silently promoted to an accepted fact.
- Ordinary queries first reuse saved references, including paraphrases selected through a bounded Jev catalogue decision. The same lookup exposes catalog/read/saved/web modes. Catalogue pages carry metadata only and are bounded by both entry count and bytes. Named reads restore the original body after context loss. No new research agent or summary stage was added.
- Local catalogue access needs no key; saved-material selection needs the existing Jev key but no Exa key or new web-search grant. Both ordinary and narrator-only tool paths support those local reads. Closing the Mod preserves its library. The preparation budget accumulates active retrieval/filter time, not the main model's time between calls; its deadline is rounded to integer milliseconds for the provider timeout API.
- Persistence, paraphrase reuse, namespace isolation, concurrent writes, unselected originals, corruption coverage, pagination and same-title references pass focused tests. The actual Pi tool chain now exercises search → catalogue → named read → the main model's next request with one Exa request. It caught a fractional timeout error on the second selection; that error was fixed without changing the decision adapter or weakening its checks.
- A real Exa/Jev persistence probe is retained at `.coc/playtests/historical-reference-library-20260930/results.json`: one Exa request fetched and saved five sources (3611 ms). A new reader without an Exa key reused them for a differently worded query (2128 ms), and named retrieval took 776 ms. Exa request count remained one throughout. These are provider/library measurements, not App restart or whole-player-turn timing claims.
- This addition is part of #110's existing App acceptance follow-up; do not package an earlier build that lacks the library or mark the original pending gates complete because persistence tests passed.

#### Previous 1.0.2 gates — completed locally (2026-09-30)

1. Mainline remains `0.9.6a`; the separate check-selection task is idle and committed its scope as `6d870987b`. Its assertions were not changed for this feature. Historical-reference and the separately approved setup repair remain uncommitted; no push or Issue state change was requested.
2. The final canonical App was packaged at 2026-09-30T09:41:12.486Z at `/Applications/PipiCOC.app`, signed with PipiUI Dev and the unchanged designated leaf 108232C5A713C15A869FC4C267E18D2E35CD276C. Installed runtime and local build hashes match. Staging is empty; LaunchServices and Spotlight list only that main bundle; `pipicoc-build/PipiCOC.app` is the correct back-link.
3. Final combined-tree LAN extension run: **4139/4139 passed**, exit 0, 336 s. Log: `.tmp/historical-reference-final-green-ext-details.log`. The setup repair passed 31 focused LAN cases and 10 host text-replacement checks. Earlier focused Mod/kernel checks passed 57 cases and host/cold-view/secret checks passed 32; these are separate evidence layers, not a summed coverage claim. The earlier 4137/4138 snapshot and its corrected test error remain recorded below.
4. Canonical-App CUA verified default-on behavior, per-campaign disable/enable, persistence across complete App restarts, and right-panel credential save, clear and restore. The credential is encrypted and the password field is empty after restart. A targeted scan of 30 changed/evidence files found no provided Exa key. The tested campaign and the new-campaign default are restored to on.
5. The user authorized the setup repair after diagnosis. A fresh App session completed the original first player input in 35,860 ms with a successful native `setup_card`, a visible card and ordinary compose, then entered play through the UI confirmation button. See the retained failure and recovery evidence below; none was erased or rewritten as success.
6. Historical retrieval passed through the actual App Keeper: authored query → Exa → Jev selection → main Keeper prose, followed by complete App restart → catalogue → named saved reads with no Exa requests. The response explicitly distinguished contemporary evidence, later analogies, missing OCR text and unsupported institution-specific access rules. The original source-RPC newspaper, archive and price turns remain complementary live evidence. Later App archive and lunch turns did not perform new external lookups and are not counted as new online-source validations.
7. Same-question App samples (Grok 4.7 Fast / low): cold web turn 70,536 ms, saved reads after restart 42,672 ms, off 44,885 ms. The cold retrieval itself took 1,837 ms (search 993 ms, filtering 584 ms); two saved reads took 726 and 489 ms with search_ms=0. These are one sequential sample per condition with growing conversation context, **not** a causal 28-second cache gain, a p95 result, or a general latency guarantee. The separate provider samples and bounded deterministic budget checks remain the timing evidence for the tool itself.

Evidence index: `.coc/playtests/historical-reference-app-20260930/acceptance.json` and its copied `session-snapshot.jsonl`, referencing the original App session. The Mod acceptance is complete within its approved scope. A separate play-opening double-encoding issue was discovered and has a pending scope question; it is not claimed fixed or included in the completed setup repair. The periodic Mod follow-up was closed after the final evidence update (automation `mod`, status `PAUSED`).

#### Authorized setup repair verification (2026-09-30, completed)

- LAN full extension snapshot: 4138 tests, 4137 passed, one failure in the newly added request-conversion test because it assumed a no-op context hook always returned an object. Corrected the test to retain its input on an undefined result; no check-selection assertions changed. The full log is retained in `.tmp/historical-reference-final-ext-details.log`. The following corrected focused run passed all 30 setup cases on LAN; the host's existing final-text replacement checks passed 10/10.
- The 09:34 canonical package emitted `bind_request.required_tool: setup_card` and actual native calls. Retrying the old failed session first reused stale input aliases and was refused; after the Keeper explicitly requested the name again, a normal player reply produced a real successful `setup.draft`, a visible Thomas Hayes card, and the confirm button. Confirming through that button handed off to play and delivered the actual office opening. Preserve these refusals and the extra player wait; this is recovery evidence, not a claim that the first retry succeeded.
- That run also returned argument JSON alongside a valid call. The final scoped change retains that private working text as hidden evidence and removes it from final prose while executing the call normally; a regression verifies exactly one draft and the subsequent compose reply. All 31 setup cases pass on LAN (`.tmp/setup-protocol-lan-final.log`).
- The final setup repair was packaged at 2026-09-30T09:41:12.486Z, still at `/Applications/PipiCOC.app` with the same PipiUI Dev designated requirement. Runtime builds ran on LAN through a temporary npm command wrapper; the App build/signing ran on the Mac. Source and installed runtime hashes matched for the prior acceptance package; repeat the final hash/registration/staging audit after the final App acceptance. A fresh visible App session is now being prepared to verify first-attempt setup without the failed session's old messages, then continue #110's remaining gates.
- Fresh canonical-App session `2026-09-30T09-42-14-150Z_5fd16003-1f6d-446e-a563-5106fd499c48.jsonl` passed first-attempt setup with the original player wording, Grok 4.7 Fast / low: one native `setup_card`, successful draft, interest fit and normal compose in 35,860 ms. The finalized bind message contained no text; CUA showed the actual Thomas Hayes card and its confirmation button. That button was used to open the table. Final installed runtime matches the local build, the private-text guard is present, staging is empty, and LaunchServices/Spotlight identify only `/Applications/PipiCOC.app` with the correct back-link. This closes the setup blocker; historical-reference App play and timing gates continue below.
- The fresh play opening revealed a separate issue: `apply.narrate` contained a complete JSON string literal with escaped Unicode, and that literal reached the player unchanged (`narrate_in_apply`, `placed_by_host`). This is retained adverse play evidence, not the repaired missing setup-call path. An asynchronous scope question asks whether to extend repair into play narration and its tests; absent an answer, do not make that extra repair. Continue independent historical-reference acceptance. The fresh campaign identity is `game-ef4f5f3b-6445-423b-bae1-f95f4601a698`.

The thread heartbeat `完成历史参考 Mod 验收` (automation id `mod`) is now `PAUSED`: the approved Mod and setup-repair acceptance gates above have completed. The separately identified play-opening encoding defect remains a pending scope decision; no repair for it was silently included.

## Native-search replacement execution record — 2026-10-09

Objective: use the same Pi Keeper's provider-hosted search for Historical Reference, retire Exa and the independent reference library, and verify search followed by game tools.

Scope: generic search request/stream/continuation adapter; Historical Reference host/Mod wiring; DeepSeek foreground search transport only; obsolete Exa controls and storage paths; regression and real-driver acceptance. Preserve existing evidence, credentials and other DeepSeek features. No package/install, push or unrelated refactor.

Base: 0.9.7a at 4ccc69e45929e10950ec341a9e79825aa38c8693. Owned source: codex/native-history-search-20261009. Other worktrees remain unowned.

Decisions: contract §124.12 above supersedes Exa. Actual DeepSeek Messages probes returned native search blocks; Pi's current normalization loses them. The fix preserves original blocks at the existing provider-stream/request seams. Gemini tools must use SDK config.tools.

Steps: contract, generic adapter, DeepSeek routing and Historical Reference/Exa retirement are implemented in the owned checkout. Local protocol tests (including search -> game tool -> result, revoked-grant continuation, pause_turn and source restoration), projection gates, existing DeepSeek checks and language/UI-word guards pass. A LAN runtime build passed; the intermediate full selection is running on amax because deployment/package changes select all suites. The final current-source LAN build passed. A fresh LAN run covering the new adapter and every previously failing file passed 148/148; focused UI checks passed 38/38 on Node 24. Real Grok native search returned sources, continued through look/lookup/apply/narrate, and restored original server blocks without replacing host-projected prose. Real DeepSeek Messages search returned ten sources for an explicit reference request; the next natural player action transferred the key and settled cash 50 -> 70 USD through the game gateway. The final full extension rerun passed 5,365 cases and exited 1 with one page-transcription timeout case (zero provider starts within two 3-second windows); that exact case passed on the same LAN box in its isolated rerun. Whole-tree green is not claimed. Serial integration and lifecycle audit remain pending. No packaging or installed-App acceptance is claimed.

Acceptance requires both protocol continuation and actual game-gateway success after native search. Passing fixtures or an API response alone is incomplete.

### Retained native-search validation — 2026-10-10

Evidence: /Users/haoli/Documents/Codex/2026-10-09/native-history-search/. The date in the directory is the task start date. live-acceptance.json indexes the original driver and campaign files. Grok final run: native-history-grok-final-20261010, actual provider grok-build/grok-4.7-build-fast / low. DeepSeek: native-history-deepseek-20261009, actual provider deepseek-extended/deepseek-flash / low, search through the Anthropic-compatible endpoint. The main Codex conversation was the sole player; no scripted Keeper/player was used. DeepSeek's ordinary creative turns did not search; an explicit out-of-fiction verification request did. That distinction is retained, not claimed as automatic ordinary-scene enrichment.

The first broad LAN run passed 2,128 Python cases (2 skipped) and all 12 loop cases, but extension exit was 1: stale mount expectations, an extra unneeded clerk note, timing-sensitive tests under load and a priority-wait test that remained pending after its child deadline. The mount expectations were updated for the new extension, the native scope note is now emitted only for active supported Historical Reference, and all failing files passed in the fresh low-concurrency 148-case rerun. The priority case also passed alone in 0.68 s. The failed and interrupted run records remain evidence; they are not a green whole-tree claim. UI source checks passed 38/38. The existing Node 24 runtime was selected for source tests to match fs-ext; no shared dependency was rebuilt.

No original campaign, telemetry, module or reference file was deleted. The obsolete library/cache implementation and tests were retired, and prior files remain untouched. No installed App, global default model, credentials or unrelated DeepSeek feature was replaced. Other vendor protocols have fixture coverage; only Grok and DeepSeek have new actual provider/driver evidence in this slice.

Final extension evidence: lan-final-ext/remote-ext.log (exit 1; 5,365 passed, one failed, one cancelled) and native-layout-isolated.log (the exact remaining case passed; exit 0). No assertion, timeout or baseline was relaxed. The actual Grok final run recorded restored native blocks after search and before lookup/apply/narrate. The actual DeepSeek reference search was followed by a normal in-fiction key/cash transaction. Source and targeted acceptance are validated; installed-App and full scenario acceptance are outside this request.
