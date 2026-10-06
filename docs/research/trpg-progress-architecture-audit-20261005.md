# TRPG 进展架构审计

2026-10-05。源码基准：主检出 `0.9.6a`，`17f24438d386819bfe6cf09bf2c5139c93856442`。

范围是只读研究：读取系统契约、提示、图投影与当前 TS 主控路径；未读取模组正文、PDF、campaign/save 秘密，未发玩家输入、跑模型、改源码/测试/配置或提交。只新增本研究文档；其他未跟踪文件保持原状。以下“源码成立”不等于相关 Mod 在某个真实 run 已启用，也不等于主控实际收到/采用了完整投影。

## 结论

当前架构能保证“这一步是否合法、是否结算、是否保存”，但这些保障不自动保证“玩家因此更能理解局面、采取一个有意义的下一步”。Jev 是有限候选的检定/参数/ bookkeeping 决策者；主控 Keeper 仍负责开放的目标理解、普通 NPC 回应、信息解释与可玩的因果推进。把停滞概括为“Jev 不掷骰”会找错责任端。

系统并非完全没有出口：已知事实澄清、普通兼容即兴、线索交付、NPC 意图结算、物质承诺履约、准备后的同动作恢复、时间与威胁变化都有路径。更值得验证的是：这些路径是否进入主控当前上下文、是否被正确理解、是否被调用并形成玩家能使用的结果，而不是把工具存在或提示写过当成体验成立。

已确认一处**系统指导冲突**：基础 Keeper 提示要求保留已交付事实、映射后来模组差异，禁止向玩家叙述纠错；story-thread 的指导仍要求先前交付与来源冲突时公开承认并纠正。两份文字在同一架构中表达相反行为。是否共同进入某一真实请求需核对生效资源，但源码冲突本身可确认。它可能让主控围着“记录到底算不算成立”继续核验，而不是维护一个稳定、可行动的局面。

不能仅凭源码宣称原长局的每次等待、电话或档案核验都是这个冲突造成。需要把公开结果与实际调用链逐段对齐。

## 判断“进展”的标准

进展可以是明确答复、理解一条已有关系、兑现或拒绝一项承诺、完成已选行动、感知真实后果、获得一条可采取的线索，或基于充分信息自由拒绝。安静、讨论、闲谈和主动停留也可以是有效游玩。

以下是空心替代物：回合数增加、检定次数增加、报告更长、工具调用更多、场景自动跳转、offer 被强制采纳。它们不能证明玩家更知道发生了什么、已选行动得到回应或局面出现有意义的变化。`docs/specs/graph-backed-play-experience.md` 的 Problem Statement 与 Testing Decisions 已明确区分证据一致性、玩家授权和体验；开头的 2026-09-28 correction 又允许普通兼容即兴，不能恢复旧的“任何新地点先适配”规则。

## 当前责任链：写者 → 读者 → 行动者

|端口|谁写|谁读/投影|谁据此行动|可确认的边界|
|---|---|---|---|---|
|玩家当前意图|真实 player input；已明确作出的选择|hybrid run.rawInput、胶囊/最近交互、规则候选|Jev 选择是否需要检定；Keeper 理解开放目标|当前 run 有严格身份，跨回合的“仍有效目标”主要靠主控理解和记忆，不是一个自动推进任务|
|行动/信息可达性|来源图、世界状态、普通 apply、source preparation|capsule.where、thread、continuity、apply/resolve options|Keeper 查证、解释与提案；host 接受合法 bounded 操作|图是参考与当前已知条件，不应被当作每次行动前必须完成的流程清单|
|规则需要与参数|核发 catalog；Jev 选择；内核算术|check-selection、receipts、mechanics、clerk_did|canonical resolve/apply；Keeper 叙述|no_roll 不自动表示失败；player_choice no_roll 不授权替玩家决定；准备不足也不授权假结果|
|NPC 普通回应|Keeper 按身份、知识、目的写台词|正文及既有 NPC/记忆投影|Keeper 继续互动，必要时 apply|普通问答不再自动触发独立 NPC 行动作者；主控不能把回应责任全交给 NPC lane|
|NPC 未完成行动|apply/resolve 意图 receipt；NPC actor 的受控行动|NPC ledger.intents、present.history、situation|Keeper 或 actor 以原 ref 落 done/failed/abandoned|已有结构出口，不能笼统说“NPC 意图没人消费”；实际有没有结算要查 receipt|
|promise|后台记忆抽取、提交过的发言来源|present.history.promises、continuity、fulfillment 派生视图|主控采用现有履约/意图/普通效果路径|说过、听见、答应、真正兑现是不同事实；后台记忆不是世界效果|
|机会与节奏|来源关系、世界状态、Director/Mod 纯投影|thread/pacing/director/offer ledger|Keeper 自主选择|offer 账不反馈为义务；不会把主控“不取”自动变成任务|

主要定位：`runtime/jev/hybrid-engine.ts` 的 projection/decide/dispatchClerk；`runtime/jev/candidates.ts`；`kernel-ts/runtime/check-catalog.ts`；`kernel-ts/read/{capsule,thread,continuity,obligations}.ts`；`kernel-ts/npc/intents.ts`。

## 源码已确认的事实

### 1. 主控仍是开放规划的唯一负责人

契约 §135.1 称 Keeper 是 boss、Jev/host 是 clerk。候选 builder 只读真实状态/来源与 located entities，不对玩家文字做关键词分类；有限规则/候选结果不是一个完整的 TRPG 行动计划。

`prompts/keeper.md` 的四条法则把数字交给 host，把世界改变交给 apply，把叙述与下一轮交给 Keeper。`mods/keeper-pacing/agent.md` 的 Carrying the selected goal 已要求执行已选目标中不引入新选择的必要步骤，只有新目的地、方法、成本、披露或风险反应才停下归还选择。这说明“尊重玩家”本来不应等同于每一个已同意步骤都重新征询许可。

源码只能证明这份指导存在；不能证明一次复杂对话中的目标、方法、限制在长上下文里都仍清楚。工具数量和检查器正确性无法替代这项开放理解。

### 2. 信息存在与可玩的 lead 是两件事

`threadSection` 从 conclusion/supports/discovered clues 和相邻 exits/trail 派生 here/next/handed/beyond。它优先保留少数线索线（至多六条；每条局部项目也有上限），并带 gate/line/locked 等。`continuityView` 的 acquired 关系被纳入 connections，因此“已拿到 clue”与“知道为何现在重要”有独立投影。

这确实存在读者，但尚没有证明每份当前导入图都有完整的 supports/路线/投递方式、每份有效 thread 都被 Mod 加载、截断没有拿掉当前玩家目标所需的行。旧 §30.4 明确记录过 PDF 来源缺少 pacing/exit/quest 字段导致整条投影失效；它是历史反例，不是当前每个 book 的事实。

§31.3 明确要求代价和产出放在同一行。单独给“不可进入/需要许可/尚未确认”而没有“当前哪个已授权动作能改变它、能得到什么”，即便真相无误，也不够让玩家作决定。验证应看当前实际行，而不是另添一份更长的约束说明。

### 3. 已满足前提有确定性识别，不能先假设引擎总是忘记

`kernel-ts/read/obligations.ts` 使用已提交 flag、meeting presence/introduced labels、先后关系及 receipts 判 settled/waived/open/blocked。accept 的产出与相应 flag、clue、item、cash 有 canonical effect 路径。开放 obligation 本身是信息，不是自动拒绝一切的硬门。

`runtime/jev/candidates.ts` 也会排除已经落过的 time、已经发现/已展示的实体等；当前选择/准备链保留原动作并以新快照校验后恢复。因此“重复前提”至少有三种不同来源：前提从未写成 receipt；写成了但投影丢失/被截断；投影已经显示 settled，主控仍继续当 open。三者不能用同一种“别重复”提示补丁解决。

### 4. 承诺与意图有消费出口，但覆盖不同

`kernel-ts/npc/intents.ts` 明确把 attempted 与 done/failed/abandoned 分开，以 receipt 折叠 ledger。任意相应效果可携带 intent_ref/intent_outcome；`extensions/kernel/tools.ts` 的说明又明确 ordinary dialogue、question、常规效果已经完成的 routine service 不需要新建 intention。不能把每次“我去查一下”都变成永久待办。

记忆 promise 是已记录的说话/条件，`kernel-ts/read/memory.ts` 用 canonical receipts 派生 fulfillment，不让相同句子或 turn-local ID 冒充履约。现有物质履约绑定围绕 cash/item/object 等精确数量、持有人与来源；一般性的回电、答复、档案澄清不应假定被这个物质履约器自动完成，它们需要普通 NPC 结果或合适的 intent 结算。

`present.history` 将 promises 和未完成 intents 优先，但也只给有限数量。这里已有 writer/reader，第三端仍需实测：主控是否给出了明确完成/失败/放弃结果，还是反复再作同一个承诺。后台抽取慢、未加载或只保留最近几项也可能影响消费，但本审计没读真实 job/ledger，不能判为当前故障。

### 5. 普通 NPC 对话回到主控，不能期待自主 NPC lane 解救每次程序循环

当前 `runNpcScan` 的 §150.1 注释与实现把 ordinary replies 留给主 Keeper；独立行动主要由实际 consequence/forced combat 等触发。登记 NPC、生成 personality/voice、绑定一条 autonomous act，并不会保证律师、警员、接线员的正常答复在下一段正文中出现。

因此程序性对话如果总在“说明限制、准备回电、等待核对”，要先检查主控本身是否给出对当前问题有用的回答和下一项可行动信息；不能先归咎 personality lane 或靠新增 NPC worker 代替主控。

### 6. 确认的指导冲突：来源纠错与保留已交付 canon

`prompts/keeper.md` 第三条法则要求已交付事实是过去，后来来源差异采用映射，不公开撤回、纠错；同文件后段要求 later module evidence 与 delivery 不同时保留 campaign fact。相反 `mods/story-thread/agent.md:30` 要求 earlier delivery contradicts source evidence 时 acknowledge and correct openly。

这两套规则可以让模型既不敢落实旧说法，又不敢承认需要改正，转而追加“请再核验实际记录”。这是一个有源码依据的机制假设。共同生效、模型实际如何服从以及是否引发特定循环，仍要与请求资源/公开结果对应。最小候选方向是统一同一事实权威和公开处理规则，不是先扩大代理数量或强行推进剧情。

### 7. 严格边界并不构成全面禁止行动

当前 spec correction 和 `kernel-ts/apply/move.ts` 支持在已授权目标下建立兼容普通地点；缺少完整 dossier 不等于不能到达。主提示允许新台词作为 play，不要求每句话都原文引用；但调查性物理细节/因果不能无源补造，secret 仍默认不公开。

这些边界的正确组合是：已知的就明确答复，未知的就标明未知；玩家选择内的常规步骤可以完成，新的有意义选择才归还；来源不完整时不能编真相，但也不能把不完整变成无尽资料准备。若主控把所有兼容即兴、普通服务或已知解释都当成“需要独立证据/许可”，那是权限理解过紧；目前源码没有证明一个确定性全局门把它们全部禁止。

## 需要与真实公开日志对齐的机制假设

|假设|必须看到的最小证据|什么会反驳|
|---|---|---|
|主控把“仍有效目标”丢了，重复问已选步骤|玩家原声明/限制；当时输入投影；下一轮再次要求同一决定，且没有新成本/方法|确有新风险或选择；玩家本就只做询问未授权执行|
|前提 receipt 已成立但仍按 open 使用|同一身份的满足 receipt；当前 obligation/known 行；正文重复要求|receipt 属于别的人/场景/世界线；满足只是一则 NPC report|
|有 clue 没有 lead|玩家已收到的具体信息；可见关系/相关性；是否给出当前可采取方法与其依据|玩家已充分理解并主动选择继续核验、拒绝或闲谈|
|承诺一直 attempted 没有完成出口被消费|promise/intent 的来源、当前状态、相应 ordinary effects/ref、公开结果|已 done/failed/abandoned，正文只是正常回顾；不是需要记 intention 的 routine service|
|内容/准备度误作所有行动的硬门|具体 needs/readiness/source status；被拒提案与 refusal code；没有自动替代动作|确实缺数值/目标/玩家选择；局部准备未阻止其他独立可玩行为|
|公共叙述过度程序化|当前问题与完整公开回应；是否回答了问题、改变关系或可行动局面|内容本就是程序，玩家仍在主动追问而非求助；需要精确事实而不能凭气氛编造|
|多层规约让主控冻结|有效提示/Mod 片段和具体矛盾；实际候选/receipt/正文时间线|只是一份未启用的旧指导；实际输出成功使用了正向授权|

不以关键词/重复次数自动判 stuck；也不让 offer 采纳率驱动导演。先按公开回合做语义审阅，并将请求、事实、推断和提议分开。

## 最小候选方向与风险（未获实现授权）

1. **先统一指导权威。** 比对当前有效基础提示与 story-thread，确定来源与已交付 canon 的唯一规则。风险是把这个范围误扩成允许虚构调查性证据、隐藏纠错或改写旧记录；需要保留玩家质疑和 canonical receipt 边界。
2. **降低“有信息但无法使用”的拼装成本。** 在现有 thread/known/obligation/NPC 结果里审查是否同一行带已满足条件、仍缺什么、可改变它的已授权方法与结果。缺字段必须回到真实 writer/reader，不新增剧情账本。风险是把主控专属线索/秘密作为玩家菜单公开。
3. **保留行动意图，明确终结服务性等待。** 先用现有 goal/receipt/intention/prior exchange 证明是哪一类等待没有消费，必要时完善该类路径而不是写一个电话样例。完成、明确失败、信息确实未知，都比再承诺一次更可玩。风险是跳过实际不确定性或替玩家支付新成本。
4. **把主控的正向授权讲清楚。** 已同意目标中的常规步骤、NPC 普通回应、已知关系解释，与新玩家选择/必须算术/调查证据分别处理。不能通过放松 Jev 阈值、准入或对秘密的边界来提高“有动作”的表象。
5. **保持性能与体验分层。** 已发现的空文本、准备 bug、FIFO/终端尾延迟会破坏连续性，但减少延迟不证明信息/目标推进正确。每次修复后仍需检查公开回合是否给出实际可玩的变化。

不建议新增导演时钟、自动跳场景、固定重试/升级梯子、以连续几轮空白强制事件，或把“必须 N 回合完成”当验收目标。

## 外部实践的有限交叉验证

[Pelgrane 的 Clues vs. Leads](https://pelgranepress.com/2020/02/21/clues-vs-leads/) 区分解释谜团的证据与把调查带到下一场的线索；这支持本审计“不把 clue acquired 等同玩家获得下一步”的区分。[Giving Out Clues](https://pelgranepress.com/2016/03/15/giving-out-clues-in-gumshoe/) 强调可信调查方法应得到相应信息，确认可达信息而非繁复许可本身才服务调查。

[Fate Condensed 的行动结果](https://fate-srd.com/fate-condensed/taking-action-rolling-dice) 提供失败/付代价成功的叙事出口，支持“不把未完成请求无限挂起”的思考。但这些系统不是 CoC 7e：不能据它们自动给核心线索、把失败改成功、忽略危险/来源，或引进新算术。借用的是“结果可理解、信息可使用”的审查维度，不是跨系统规则迁移。

## 后续证据与完成边界

下一步应选少量真实公开回合，逐个回答：玩家要什么；已授权哪一步；什么信息已得知；实际候选和拒绝是什么；落了哪些 receipt；NPC 是否明确回应；下一轮为何还要同一种核验。只用该玩家当时可见内容和技术元数据，不能偷看未公开模组来评价路线。

源码审计已完成，原场景的机制归因与真实体验验收未完成。本轮不把代码路径、提示全文、字段数或测试绿当成“长局循环已解释/已解决”。

## 补充：公开信息的实际值与 Idea roll 端到端边界

本补充只读当前源码，使用主审提供的公开审计对应点：1128/1132/1458 说时间、姓名、日期已说清/核对，却没给实际值；1459 将问法缩为 same/different 后才得到日期。本 worker 未重读这些 campaign/save 或模组秘密。它们证明的是公开输出的信息密度问题，不直接证明字段被代码删掉。

### A. “只走机制卡”的边界存在过宽解释风险

基础提示 `prompts/keeper.md` 有两个不同尺度的说法：第一条概括为“Dice and numbers come only from the host resolve”；第四条的具体清单是骰值/目标/成败等级/资源账/经过时间的数字/规则枚举等 system facts，只进 mechanics。清单并没有明确把日历日期、钟表读数、房间号、案号、信件上的编号和姓名归入系统数值；但也没有显式说明这些**故事中可感知的具体值**可以且应当在正文回答。第一条的广义 numbers 与第四条的 elapsed-time 约束容易被模型泛化为“正文里避免所有数字”。

当前 source 中没有发现 canonical narration renderer 按数字删除正文的机制：`kernel-ts/write/delivery.ts:11-18` 的 rendered_text 通过 speech/marker 处理，`write/text.ts` 处理标记与收据定位；不是将所有数字替换成“已核对”。而且姓名不是机制数值，连姓名也不报实际内容说明问题不止是数字策略；它还可能是“叙述操作动作而不交付所得事实”的写法。

基础提示后段（keeper.md76）本来要求读自己的笔记、信、地图、照片或已有记忆时展示 particulars themselves，而非内容类别；这与“我看清日期/核对了姓名”却没有日期/姓名是相反的要求。`mods/narration-craft/agent.md` 的主语/动作/宾语明确、实际感知指导也是正向输出要求。两者存在说明允许交付实际信息，但不能证明某个 run 实际采用了它们。

**当前可确认：**文案边界缺少明确的 diegetic identity/value 区分，确有误解风险；程序性“做了读取”不能代替“玩家得到读数”。**不能确认：**1132 或1458具体是因为广义禁数字、source unavailable、记忆截断、说话风格还是主控保守；需对照当时已提供的实际值、可见源片段和输出。

最小候选方向（仍不是实现）：统一提示的数值规则为“规则机制值只在卡；角色实际读到的日期/钟面/编号等在故事里直接回答，不算计算/结算”，并明确不凭空补值。未知就说未知，不能用“已经明确”冒充已知。风险是把隐藏检定、SAN/HP 或未授权秘密误写进正文；必须按值的来源/用途区分，不能加数字正则、语言检测或按数字形式做语义分类。

### B. 原文/quote 路径没有证明吞掉这些值

`extensions/module/source.ts:131-143` 的 nativePageText 从原 PDF text items 拼接字符串，保留文本与换行；它不识别日期、编号或姓名并删除。准确来源路径带 file/page/span 绑定，失败、截断、取消有独立状态，不能把某个失败的精确读操作当作已经得到实际值。这里未读取任何 PDF 内容。

不要混淆 `narrate.quotes` 与文献引用：当前 `kernel-ts/runtime/quotes.ts` / `write/index.ts:1332-1335` 的 quotes 是报价注册、账单卡和后续匹配；它不是通用的档案日期/姓名投影。报价细节可能从正文移往相应卡，不能推导“任意日历值也会自动进卡”。普通读取所得日期/编号没有一个保证替代正文的通用 mechanism row。如果模型省略实际值，driver 观察者可能在正文与已采集的 mechanics 两端都得不到它；GUI 的其他公开面板必须另行核对，不能由此断言 GUI 玩家完全没有得到值。

对这四个公开回合，最低限度的对应证据是：真实 source/read/result 当时是否已含具体值；其可见性与截断标记；Keeper 是否真的做了读操作；最终 prose/mechanics/handout 是否交付相应值。不需要偷看未来模组或反复问不同措辞才能归因。

### C. Idea roll：现有底座、可能的通路与未证实的保证

主审提供的规则书印刷页199–200说明 Idea roll 胜负均恢复线索、失败决定代价；精确引用由主审负责。本 worker 不以枚举项替代那条规则，不额外读 PDF。

|三端|当前源码证据|能证明/不能证明|
|---|---|---|
|规则声明/能力|`rules-json/rule-index.json:11-15` 声明 core.resolution.idea_roll，对应 percentile-check.json/INT；capabilities.ts65 含 idea_roll|规则可查、能力被命名；不能证明恢复线索算法或自动使用|
|数值候选 producer|`runtime/resolve-operation.ts` 用 SkillResolver.canonicalNames/targetValue 发 profiles，包括 held characteristics；rules/skills.ts8 与262+读 INT|INT 可作为真实调查员 characteristic profile 核发，不靠模型猜数|
|chooser|`check-catalog.ts:138+` 普通 profile options；`resolve-selection.ts` 做 relevance/need/parameter choice|玩家当前声明若需要 INT 检定，Jev 能走普通 check 选择；没有看到专门“玩家卡住/需要恢复哪条来源 lead”的 Idea recovery 候选或独立约束|
|结算/receipt|`resolve/basic.ts:70-81,104-114,145-164` canonical characteristic check，带 goal/stakes/decision；context.ts493 排除 idea/characteristic 类成长 tick|数值 INT 检定、成败与基本收据底座存在；goal 保留目的，但 ordinary characteristic receipt 不是自动“失败也给 lead”的结算指令|
|线索/后果 producer|已有 apply clue/time/NPC/threat 等 canonical 效果；thread/known/source 给可恢复信息|主控可用这些效果交付既有允许的线索/失败代价；没有发现一个 Idea outcome consumer 把两种成败都映射到同一已绑定 lead，且失败只改变代价|
|delivery actor|`mods/keeper-pacing/agent.md:23` 明确描述胜负均恢复线索；主提示要求数字由host/结算后Keeper叙述|开放叙事责任确实分配给Keeper；但同一Keeper被明确禁止自己选择/调用check，只有文字“使用Idea roll”不足以证明它能向host签发一次专门恢复检定|

因此结论不是“Idea roll完全没有实现”，而是：**普通 INT 检定和线索效果基础已存在，来源/指导也存在；专门的恢复目标选择与双分支线索交付保证未从当前生产路径得到证实。** 通用路可以偶然做出类似体验，不能把它当成规则书恢复程序的端到端覆盖。

在 `runtime/jev/candidates.ts`、当前检查 catalog/selection 和 consequence 路径的定向源码检索中，没有发现 Idea 专用恢复 packet/candidate/receipt 名称；`idea_roll` 在 context.ts 的命中只是成长排除项。这个负面检索不是对模型任意语义调用的穷尽证明；源码明确的正向通路仍是 ordinary INT。

重要差别：免费澄清已知事实、提示读过的资料，可以不掷骰；真正按规则书恢复关键线索，需要明确哪条允许的 lead、如何选检定、如何保持“失败仍有 lead”，以及失败代价依据。不能把所有用户困惑都收费，也不能把一次 generic INT failure 解读为“永久没有线索”。

若要继续调查，最小证据是一段真正公开的“需要头绪”场景：核发了什么候选、Jev是否选择 INT/何种purpose、canonical receipt 实际成败、随后哪个 apply/handout/NPC结果交付哪条已授权信息、失败代价来自哪条规则/来源。没有这些之前，不建议修改阈值、自动给未读秘密、增加导演时钟，或单纯在提示再添一句“Idea失败也给线索”。

候选方向须另行设计/批准：在既有 check-owner 与 apply 权威里表达一个 source-bound recovery lead/purpose，使 chooser 和 delivery actor 共享同一目标；成功/失败仅按规则改变代价/后果，不把允许的 lead 再拿来作为成功门。代价仍需来源/规则支持，玩家已有选择与真实承诺不得被替换。这不是本轮实现决定。

### D. 重要观测修订：driver 视野并不等于 GUI 全部公开视野

主审提出后定向核对当前源码，确认存在**观测能力差异**：

- `prompts/keeper.md` 第四条明确说 clock lives in its panel。数字不出正文有一部分是有意分工，不能仅凭正文没报时间就判错。
- `pipicoc/timeline.js:483-496` 的 atTime(when) 实际渲染日历或 day/hh/mm；不是只显示抽象“时间已核对”。sheet.ts 的公开回答含 player-safe `table.view`，board.ts184 同样读取 table.view，而不是 Keeper-only look。它们是正文/mechanics 外的玩家可见 surface。
- 当前 `tests/play/driver.py:764-771` 采集 coc-mechanics/coc-choice；PUBLIC_MECHANIC_FIELDS 不含 clock/calendar/when。定向检查未发现它映射 table.view、timeline/sheet/board 的完整玩家面板响应。print_delivery_panels 只消费 delivery.mechanics/pending_choice，不能据此重建 GUI 面板。

因此，1128 等公开审计目前支持的最强结论是：**对应值没有进入该 driver 玩家实际使用的正文/已采集卡片视野。** 它不足以证明当时 GUI 玩家完全没得到时间/日期，也不足以单独证明 Keeper 的机制数字规则错误。测试玩家可能看不到产品本来通过旁栏交付的公开信息，这会促使其再次问时间，形成另一种循环放大。

这个修订也不意味着“当时面板一定显示了所问值”：本轮没开 GUI，没读取当时 table.view 或历史面板数据，当前源码不能倒推 v32 的实际渲染/缓存状态。全局游戏时间/时间线时刻也不自动等同于某只墙钟、手表或某份记录的创建日期；必须核对玩家问的是哪个信息源与哪一种值。

姓名、岗位、具体承诺时限或回执编号不一定有相应旁栏；这项差异不能解释所有缺值。主控只说“姓名已确认”而不说姓名，仍需独立验证是否存在其他公开交付路径。

**调整研究建议的顺序：**先核对当时全部玩家可见 surface（正文、mechanics、choice、handout、player-safe table.view、timeline/sheet/board）、测试玩家实际能访问哪几项以及其来源/刷新状态，再决定是否改 numbers 指导或 driver 公开观察映射。不要把“补全公开测试视野”变成复制 Keeper 胶囊、公开隐骰/隐藏成败或读取未授权模块信息；也不要为了解决缺值而把所有机制数值搬回正文。

本项是当前源码可确认的 surface/观察映射差异，历史循环的具体因果仍待逐回合对应。它修正前面“省略实际值可能两端都不得到”的范围：两端指 driver 已观察的正文与 mechanics，不包括已经验证的所有 GUI 面板。
