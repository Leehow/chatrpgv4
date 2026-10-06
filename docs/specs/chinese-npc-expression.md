# 中文 NPC 表达改进技术规格

> 状态：提案，未实现、未测试、未发布。本文只规定后续研究与实现边界；今天不授权实现、打包、提交或实玩。

## 1. 目标、非目标与完成定义

目标是让中文 NPC 在完整遭遇中根据玩家上一句、听众、关系、知识、风险和当前行动作出自然、连贯、可读的回应；不是把人物设定、状态、事实和情绪拼成清单。成功单位是可读的多回合体验：NPC 接住了什么、避开了什么、改变了什么，以及玩家是否仍能选择下一步。客气、沉默、绕话、玩笑和答非所问都可能正确；一句话也可以同时回答、缓和关系并保留条件。

不以语气词数量、平均句长、逗号数、口头禅或 schema 校验作为成功标准。不要求一目标一空缺，不强迫每句提问或制造玩家钩子；正式语体和短片段在合适场合同样有效。不按阶级、性别、职业或情绪映射固定句式，不恢复成稿审阅、重写或第二人格/记忆/规划系统，也不改其他语言风格。

“空完成”包括：把所有 NPC 改成带“吧、呢、啊”的短句；给每人固定口头禅；用列表复述 mask、mood、relationship；只用关键词计数；把小说名、秘密或奇幻设定塞入 campaign canon；安装包后宣称旧世界已更新；包里有示例但请求未读取；只测静态结构、不做真人回合。

## 2. 当前事实与表达边界

研究冻结点是 `current-source.txt` 的 snapshot HEAD `5ac1bbb8c79733aa16156bf54a80c13189b7972d`。内核是 `kernel-ts`，退休 Python 不是入口。当前 `SINGLE_PASS_NARRATION=true`，section 166 已取代 section 165 的 prose editor；speech-edit extension 立即返回，不得增加前景 reviewer/rewrite。本文新增的 Jev 分工只针对离线/后台材料筛选、索引和 card/guidance validation；不在完成的 Keeper draft 与 player 之间插入 judge，不重新开启 runtime RAG、per-turn retrieval、extra expression call 或 finished-prose automatic review。

有效路径是中文 agent.md/full 与 brief.md 经 `modContext` 进入请求；语言 addendum 追加到 voice owner；模型用既有 tool-enabled 作者/审阅者产出 mask 与三组 exchanges；voices capsule 交给主 Keeper 起草。继续使用 current mood、relationships、toward_party、recent_speech，不另建人格、记忆或计划层。mask 仍不超过 200 字符，恰为三组不同 exchanges、每组不超过 200 字符；三组仍为普通初见、日常实用问答、敏感问题。

表达 Mod 只能改变表达，不能凭空创造身份、知识、让步、承诺或事实，不能覆盖已经决定的事实或立场；主 Keeper 仍通过正常权威，依据来源与当前事实作出回答并改变态度。称呼或省略可以变化，但听众身份/人数和命名规范必须正确。重复提问可以表达关心或澄清；没有“第二次/第三次必然更短、更怒”的规则。有效 instruction 之间的冲突须逐项审查，不能用一句话把所有语言的 instruction 一并改掉。

本规格的原创示例只是说明材料，不是来源摘录，也不是强制台词。三列含义为“事实与限制、改变的听众/行为条件、示例”。共同事实：档案室今天关闭，明早九点开放；同一职员今天不能放行。改变的是听众/行为，不是事实：

|事实与限制|改变的条件（听众/行为）|示例|
|---|---|---|
|档案室今天关闭；明早九点开放；同一职员今天不能放行|陌生请求者，正常询问|今天不接待，您明早九点再来吧。|
|同上|熟悉规矩的请求者继续请求|你就别为难我了，今天真进不了，明早九点再来吧。|
|同上|有人正要直接闯过，要求其停下|先停下，今天不能进！明早九点再来。|

表中没有守卫、预约、承诺或身体结果；“请/先停下”是说话，不等于决定玩家已经停下。示例不规定人物永恒口头禅。

完整指导和口吻附录应要求：回应整个遭遇和听众；保留来源事实、知识边界和玩家选择权；按当下情境调整信息顺序、省略、修补和语域；不强制助词、碎句、问句、口头禅或单目标模板。运行时指令仍用英文，中文示范属于内容数据；保留有用的口语经验、时代与来源语域、正式表达和必要短句。当前硬预算是每回合语言提醒不超过 400 个 UTF-8 字节，不是 400 个汉字；`mask` 不超过 200 字符，恰有 3 组不同的 `exchanges`，每组不超过 200 字符。完整指导携带 6–10 个根据研究另行创作的对照示范；每回合提醒只保留 3–4 个可执行注意点。第一阶段拟议的新增原创示范材料预算为实际完整指导和附录中的内容合计不超过 8000 个 UTF-8 字节，重复投递的内容按实际位置分别计算，并记录完整指导、附录和整个请求相对于基线的字节变化。这是本规格提出的研究预算，不是现有内核常量；不得为凑数量增加 400 字节的硬上限或牺牲来源清晰度，不增加前景模型调用或实时检索。

## 3. 研究材料与输入

语料有 102,192 fragments、61,183 marked spoken、47 cards；卡是 mask/role 容器，不等于 47 个人物。831 个 scene studies 是研究单位。计划预算选 24–36 个经语义确认的完整 exchanges，每个含实际 2–4 回合及周围叙述，覆盖日常、冲突、地位变化、不同听众、修补/澄清、沉默或绕答。预算不是完整性或性能证明。

只选 spoken material，核验 source speaker、speech mode、场景、听众、共享知识、明确情绪与研究者推断情绪。原文由 host 按冻结 source refs/offsets 物化；Jev 优先作封闭候选的语义筛选、分类、索引、匹配和质量判断，带工具的 Pi 写原创示例与开放式说明，不用关键词、默认分类器或 name inference。位置须注明 `[start,end)` 的单位（Unicode 码点、UTF-8 bytes 或源文件单位）。小说和大语料不是 runtime dependency 或 packaged lore。

### 3.0 责任分工与离线 Jev 边界

这是本次明确的新任务分配：**筛选、索引和判断默认交给 Jev**，取代本文早先“所有语义选择由 Pi”之类的表述，但不取代 tool-enabled Pi 的文字创作；这是本规格新提出的分配，不宣称已经运行。Jev 负责闭集候选准入、引文/说话人候选分类、语义索引标签、对齐/匹配、相关性重排、语义重复判断、有限的来源/支持/事实/身份质量判断，以及离线 A/B 偏好/质量判断。多标签用彼此独立的 Noul；有具体锚点的有序单轴质量用 Score；互斥选择用 Choice。不得先让 LLM 包办这些判断，再让 Jev 作仪式性盖章。

|问题|裁决方式|
|---|---|
|引文采用哪个 supplied quotation mode|Choice，含 uncertain|
|来源/上下文是否完整|Noul|
|说话人属于哪个 supplied source-bound candidate|Choice，含 none/insufficient|
|每个适用 interaction tag|各自独立 Noul，不强迫情绪/人格 one-hot|
|候选是否匹配本 interaction condition|每候选一个 Noul，由 host 重排；Choice argmax 不能证明存在适用候选|
|自然度、连贯性|各自一题，按明确定义的序数锚点 Score|
|事实是否改变、身份是否错误|分别 Noul|
|离线盲 A/B 偏好|Choice：A/B/tie/insufficient_evidence|

Host 负责精确抽取、offset/hash/ID、文件/数据库/倒排索引存储、结构候选枚举/召回、算术/日期/计数/排序、字节重复检测、确定性校验、阈值与控制流、持久化、权限和取消。因此“Jev indexing”只指语义分类与匹配决定；Jev 不建库、不写文件、不发明标识符、不执行效果。句法解析、精确姓名规范化、结构性 source spans 仍由 host 完成；开放语义不可用 regex/name list 代替。Tool-enabled Pi 写原创 demonstrations、prose、masks/exchanges 和开放解释/综合；缺少开放 taxonomy、新身份或叙事解释时，Pi 可提出有来源依据的候选/标签/分析，由 host 绑定/枚举，再由 Jev 作有界裁决。不能强迫 Jev 发明新标签/身份，也不能假装它输出自由推理。Human owner 保留抽样校准和最终主观接受。

实现只复用现有 [`decision-adapter.ts`](../../runtime/jev/decision-adapter.ts)、[`contracts.ts`](../../runtime/jev/contracts.ts)、[`question-packing.ts`](../../runtime/jev/question-packing.ts) 与集中 credential resolver，不新增 provider client 或 secret copy；当前 pin 为 `JEV_MODEL='jev-1.13.0'`，实现须重查当前批准 pin，不能用 `jev-latest`。这里不宣称已有新的 question family；若需新增，须在现有 `ScopeBinding`/`ReadSet` 下版本化 instructions/criteria/taxonomy/source/input；绑定旧 model revision 的缓存决定必须失效，禁止发布 stale decision。TypeSafe 官方说明可参见 [`primitives`](https://docs.typesafe.ai/primitives)、[`rerank`](https://docs.typesafe.ai/cookbooks/rerank_typesafe) 和 [`confidence`](https://docs.typesafe.ai/confidence)。

宿主只提供带真实原文上下文的有界候选，不把全部 102,192 个片段或两部小说塞进一个状态；遵守现有请求打包上限和预算，不承诺未经测量的速度或成本。本次分工调整针对材料、索引、口吻卡和离线判断，不新增运行时 NPC 行动路由、逐句挑选语气词或成稿后的语义关卡。候选缺失、服务不可用时保留未决状态或补取上下文，Pi 只提出缺失的开放材料，不静默接回已有封闭候选的判断。相同状态下的独立问题在有界请求中批量发送，只有后问确实依赖前答才串行。来源文本作为非可信数据处理。每候选重排须允许无适用项或资料不足；低置信、矛盾、超时、格式错误和缺失答案均不视为通过。宿主可补取原文或修复候选集；后台失败时继续使用已成立的来源和当前 NPC 信息，不阻塞游戏。

Jev 只能返回 host-issued evidence pointers（如需要），不能发明 citation text 或 free-form reason；Pi 可依据结构化决定和真实证据写带不确定性的解释，raw decisions 必须保留。持久化 source/quote refs、candidate/taxonomy、question-family/model 版本、实际 distribution/confidence 或 noul、threshold policy、selection/fallback 和 writer input binding；算法分组/排序在代码中完成，不由模型数值结算或授权 campaign。Name/class confidence 不是独立 source proof。

离线记录至少保留 source、exchange、context、relation、expression、conditions、adaptation、review、digest、引用和未决反例。其紧凑 schema 如下：

|表|字段与含义|
|---|---|
|source|book、edition、digest、source_refs、offset units|
|exchange|完整的 2–4 回合原文 spans、speaker、addressee、mode、evidence|
|context|listener、bystanders、shared knowledge、current trigger|
|interpretation|response relationship、power/relationship、information order/omission/repair/ending、narrated vs inferred emotion、conditions/counterexample/uncertainty|
|adaptation|同一事实的对比中文原创示例、stated facts、audience changes|
|review|source materialization proof、Jev bounded semantic review/version、owner calibration/acceptance；保留 raw decisions|

语义选择由上述 Jev 闭集裁决与 host 的确定性操作共同完成；带工具的 Pi 负责原创文字与开放候选提议，不使用关键词或默认推断。Noul 是 yes-probability，且没有 confidence 字段，也不是 ordinal quality；Choice 的 confidence 与 Score 的 level 是不同信号。每个 model/question family 必须先用独立的中文 calibration cases 校准阈值，再冻结并用于 held-out；不得跨 question/type 复制旧 `0.45`/`0.5`，也不得从 confidence 推断实际质量。相同 state 的独立问题应批量发送，由 host 计数/排序；instruction 必须点名确切 state field，不依赖 question key 名称。model confidence alone 不是独立 proof。6–10 组 paired demonstrations 表达同一事实下的普通情境与 pressured/familiar/changed circumstance，显式列出事实和限制；不能复制小说人物。保留 owner 已有的 16 组 rewrite pairs 作为参照，不宣称全部进入 prompt。

### 3.1 输入修订、加载顺序与旧世界

建议的 host-only 记录为：

```text
owner(id, version, digest, state_version)
ordered addenda(id, version, digest)
play_language
format_revision
```

其中 `ordered addenda` 必须从与 `withLanguageAddenda` 相同的实际 addendum 选择和加载顺序推导，不能另猜一个语言过滤器。现有 RPC 名称严格为 `voice.job`、`voice.submit`、`voice.fail`。现有 voice RPC/card shape 保持不变；名称是 PROPOSED 的 metadata/capability，不是当前字段；不把不透明 revision 回显给模型。

只在明确相关的 active-version 变化时更新 revision：owner、选定 addenda、`play_language` 或 `format_revision` 改变。新运行时/包的安装本身不改变已锁定的 worlds/cards。启用、禁用或更换语言包的 revision-aware adoption 必须持久化：之后再次禁用仍会改变输入并拒绝旧 job，不能退回不安全的 legacy checks。忙碌时 configure 仅进入 pending，直到正常 activation boundary 才生效；不得提前做部分归档或部分 revision。无关 Mod 或相同输入不重新生成。

只有 kernel 已有的 voice-owner handling 可以归档/发布生成的 voice keys；不能给普通 language Mod 泛化跨命名空间权限。保留其他 dossier 字段和 source-authored cards。后台只为当前在场或已遇到过的 NPC 生成；无新卡时仍用来源/当前事实回退，不能推迟首次发言。

在明确相关的 active-version change 后，普通 capsule/provider 路径须在返回 brief 前发送一次新的 FULL instruction；保留 history/cache prefix。应记录实际绑定到 provider 的 inclusion，而不是只记录准备好的字符串；取消或缺失 projection 不能永久标记为已发送。这可能需要窄范围读/mods 加 host projection，但绝不引入 finished-prose review。

当前迁移只支持顶层 `default`/`rename`；选择性归档口吻字段需要有限的 TypeScript 扩展，不能清空整个人物资料。模组原著卡片、关系、心情、历史和其他字段始终保留，只归档受影响的自动生成 `mask`/`exchanges`。旧任务在幂等重放和结果落盘前重新检查当前有效输入修订；修订不匹配才拒绝为过期。即使口吻所有者未变，只要实际附录或其他纳入修订的输入变了，旧结果也不得回写。

## 4. 三端链路与契约修订

以下链路区分现有实现与本规格新提出的 PROPOSED Jev 分配：现有 runtime/one-pass 行为不因本节文字而被宣称已运行或已改变；Jev 仅按后续实现与校准计划接入离线材料流程。

### 4.1 输入修订与状态转换

|情形|要求|
|---|---|
|仅安装、无明确 adoption|旧 locks/cards 不变。|
|忙碌时发生相关变化|进入 pending，不提前 invalidation。|
|实际相关变化在安全边界 activation|记录 host revision；只 archive 生成的 mask/exchanges，并将 stale 排除出 projection；queue present/met。|
|无关 Mod 或 effective inputs 未变|不重新生成。|
|source-authored|永不覆盖。|
|late job/replay|发布前比较当前 effective inputs；保证幂等 replay，并拒绝 stale。|
|author failure|使用 original source/current NPC facts 回退，不等待 delivery。|

没有 revision 的 legacy records 在明确 adoption 前仍可接受；adoption 即使禁用 language pack 也持续有效。check-and-publication 必须共享现有 kernel 的 transaction/serialization guarantees，不能成为有竞态的独立 external write。拟议 capability `npc.voice.effective-input-revision.v1` 由新行为声明，旧 runtime 报告 incompatible；该 capability 尚不存在。新 metadata 归 host，不归 model，也不新增 RPC。

```mermaid
flowchart LR
 A[冻结研究 refs] --> B[Host 材料/候选/索引准备]
 B --> C[Jev 语义筛选/索引决定]
 C --> D[tool-Pi 原创 authoring]
 D --> E[Jev 有界材料/card 判断]
 E --> F[Host accepted guidance/cards]
 F --> G[main Keeper 首稿]
 G --> H[玩家读到并作下一步]
```

必须逐端追踪谁产生 guidance/cards、实际 reader/文件/RPC/capsule 如何承载、Keeper 如何应用第一份 delivery、玩家如何读到它。材料阶段为 host preparation → Jev semantic selection/index → tool-Pi original authoring → Jev bounded validation → host acceptance；不是 Keeper 成稿后的审判链。`modContext` 的 active set、当前 NPC context（含 current mood、relationships、toward_party、recent_speech）不能被静态卡替代。

Contract sections **153、40.8、166 必须先修订再写代码**。section 153 的语言包选择、addendum 实际顺序与锁定边界要支持上述 host-only revision；section 40.8 要规定 owner/addenda/play-language/format revision 和 full→brief 传播；section 166 继续规定一遍成稿直接交付，不能加入语义审阅或 delivery gate。契约修订不是本次实现授权。

保留既有 card shape：mask <=200 characters、恰好 3 个 distinct exchanges、每个 <=200；不输出 job id/generation identifier，不加入 model-echoed hash/ID。背景生成只处理 present 或已 met 的人物，首句不因等待生成而延迟。

## 5. 文件范围与分阶段计划

|阶段|允许核查/修改的文件与内容|验收重点|
|---|---|---|
|内容|[`mods/zh-optimize/agent.md`](../../mods/zh-optimize/agent.md)、[`mods/zh-optimize/brief.md`](../../mods/zh-optimize/brief.md)、[`mods/zh-optimize/voice-lane.zh.md`](../../mods/zh-optimize/voice-lane.zh.md)、[`mods/zh-optimize/mod.json`](../../mods/zh-optimize/mod.json)、`CHANGELOG.md`、`GUIDE.md`|只改相关 guidance、版本、描述和示例；读最新 manifest 后再定版本|
|契约/读取|[`kernel-ts/read/mods.ts`](../../kernel-ts/read/mods.ts)、`mod-language.ts`、[`capsule.ts`](../../kernel-ts/read/capsule.ts)、[`kernel-ts/mods/runtime.ts`](../../kernel-ts/mods/runtime.ts)|实际选择/顺序、pending boundary、revision、full/brief projection|
|生成 wiring|[`kernel-ts/voice/jobs.ts`](../../kernel-ts/voice/jobs.ts)、`index.ts`|只扩展现有 voice-owner、旧 job stale rejection、source fallback|
|宿主（如必要）|现有 host voice/capsule consumer|只做投影/绑定所需最小改动|
|Jev/离线（仅复用现有 primitives）|`runtime/jev/decision-adapter.ts`、`contracts.ts`、`question-packing.ts`；如实现需要，新增 dedicated question-family module/test，标为 **proposed**|不新增 provider；检查候选外拒绝/unknown、非强制 winner 的逐候选 rerank、source/readset/model/taxonomy mismatch、缺失/低置信不发布、独立 batch、writer 收到 host-materialized refs、语义索引进入 stored index/reader、中文校准、无 regex semantic fallback、无 foreground/rewrite calls|

不得 blanket 编辑 narration-craft 的共享 instruction/schema；先识别真实冲突，再限定跨语言对齐。runtime RAG、fine-tuning、新 personality state、global upgrade、UI redesign 均在范围外。阶段顺序是：先 curate/content/new-context probe；只有 improvement 通过 screen，才实现 scoped legacy propagation/revision behavior；发布必须有 old-world release gate。完整 feature 在没有旧世界 gate 时不算完成。

## 6. 测试、验收与停止条件

|类别|文件/情形|必须覆盖的结果|
|---|---|---|
|现有测试|`tests/extension/language-scoped-mods.test.mjs`、`npc-voice-lane.test.mjs`、`npc-voice-package.test.mjs`、`unified-voice.test.mjs`、`single-pass-narration.test.mjs`|fresh/existing generated 与 source-authored cards；disabled/absent/legacy package；同 owner 改 addendum；late result/replay；unavailable author；pending boundary；unrelated update；full/brief propagation；无 prose rewrite|
|提议的新测试|任何新增测试必须标为 **proposed**|同上，并断言安装不改变旧锁世界、禁用后拒绝旧 job、保留非目标 dossier 字段、实际 provider-bound inclusion、取消/缺 projection 不误记 sent|
|发布 gate|现有 driver→`bin/pi-coc`，main session 只有 player，一次一个自然回合，Keeper 明确为 FlapcodeLunaKeeper|真实 owner-readable 结果和 live play；不得用 fixture 冒充 acceptance|

本规格未运行测试。未来 broad chatrpgv4 suites 需按 AGENTS 的 LAN-test probe/skill 执行；focused tests 应与风险相称。source wiring、offline language probe、true driver play 和 package acceptance 分开。测试必须检查实际 outgoing prompt 与 active cards，而不只是文件/schema；需要保持 baseline cards/state 不变的 arm 必须明确保持，first encounter without card 也是显式 case。不同独立 repetition 不是 independent scene evidence，>=60% screen 不是 statistical proof。发布/打包工作不由今天的 spec request 授权。acceptance 仍须覆盖四种 narration delivery、withheld choice、no-tool/speech-only/unwrapped prose、重复台词、markup、无 foreground/background prose review/edit，并证明 unauthorized state operation 与 duplicate transaction guard 不退化。无 available author 时必须 source/current-facts fallback；失败 provider 不是 completed draft。

## 7. 离线比较与初筛

建立 12 个 held-out 的真实来源上下文；每个含 2–4 个前置对话回合以及已结算 receipts、NPC facts、listener facts。只生成下一个 candidate response。A=当前 guidance+旧 cards，B=新 guidance/demos+同一旧 cards，C=新 guidance+正确重新生成的 cards；每个上下文每个条件独立生成两次，共 72 个输出。不得 chained scripted player、synthetic campaign、manufactured turns/events/receipts，也不能声称 live acceptance。

所有文字创作由带工具的 Pi 完成；Jev 是默认的 bulk offline A/B judge/screener，并与 owner/human 的盲偏好分开报告。owner 只做 calibration spot-check、复核分歧/边界案例和最终 genuine-play acceptance，不必重做全部自动判断。除明确写出的 arm 差异外，生成模型使用同一 Flapcode/gpt-6-luna 低档配置，decision model 使用当前 pinned Jev。按完整 scene/character cluster 留出，排除示范、用户改写及其相邻或同源改写片段。盲化随机顺序，允许 tie；评审时把 candidate 放回前置 exchange。按 scene 报告，重复样本不是独立 scene。

提议的预注册 screen：零个新的严重事实、知识、听众或 agency 错误；在 24 组 B/A 配对比较中，至少 12 个非 tie，且非 tie 中 B 偏好至少 60%；没有核心维度持续变差。此 60% 是自动 Jev preference rate，不是 Jev confidence、human preference rate 或统计证明；C/B 使用相同门槛。threshold calibration 与 screen 分开。inconclusive 就停止并保留更简单的 arm；运行前冻结规则，不在 held-out 上调阈值。自动 screen 通过只准进入进一步 validation，绝不等于 release 或 live-quality proof；human 与 Jev preference 必须分别报告。结果须 owner-readable，且仍需实际 live play。保留 human source spot-check/calibration 与真实 driver gameplay acceptance；代码、候选、索引计数不是语义质量或 live proof。延迟与 input-token cost 分开报告；零额外 foreground expression-model call、无 semantic delivery gate 是硬要求；更紧的 latency 目标须预注册。driver→`bin/pi-coc`、main session、player 一次一个自然回合、FlapcodeLunaKeeper，不授权打包。所有 count 是预算，不是完成证明。

## 8. 研究证据、链接与记录

Jev 结果须按 question family 分别保存，不把 Noul 的 yes-probability、Choice 的候选分布、Score 的质量等级或各自阈值互相挪用；Noul 没有 confidence 字段，也不是 ordinal quality。Choice/Score 的 confidence 与 Score 的 level 是不同信号。每个 model/question family 须先用独立中文 calibration cases 校准，再冻结阈值用于 held-out；不能跨 question/type 照搬旧 `0.45`/`0.5`，也不能由 confidence 推断实际质量。相同 state 的独立问题应 batch，由 host 计数/排序；instructions 指明确切 state field，不依赖 question key 名称。低置信和 unresolved 不得发布；模型 revision、source/readset、taxonomy 或 input mismatch 必须阻止 stale-result publication。独立问题仍批量 fan-out，算法分组/排序和 persistence 由 host 完成。

未来 targeted checks 还须覆盖：候选外拒绝与 unknown exit、逐候选 rerank 不强制 winner、source/readset/model/taxonomy mismatch、missing/low-confidence 不发布、independent batch 行为、writer 获得 host-materialized 实际 refs、semantic-index decision 到达 stored index/reader、中文 calibration、无 regex semantic fallback，以及不增加 foreground/rewrite calls。A/B 的 Jev screen 与 owner/human blinded preference 分开；不得把 index/candidate/code counts 当作 quality 或 live proof。


从本文件所在 `docs/specs` 出发，代码/契约链接使用 [`docs/kernel-rpc.md`](../kernel-rpc.md)、[`../../kernel-ts/read/mods.ts`](../../kernel-ts/read/mods.ts)、[`../../mods/zh-optimize/agent.md`](../../mods/zh-optimize/agent.md) 等实际 repository-relative Markdown links；source refs 只指向实际文件。`current-source.txt` 和 `research-summary.txt` 位于 `/Users/haoli/Documents/TRPG/小说/对白研究-20261001/spec-authoring-20261002`，是本地保留证据，既不是 repository 文件，也不是 runtime dependency；当前来源文件为该目录下的 [`current-source.txt`](/Users/haoli/Documents/TRPG/小说/对白研究-20261001/spec-authoring-20261002/current-source.txt)。

方法背景：[`Retrieve and Refine`](https://aclanthology.org/W18-5713/) 是较早的训练式 English chit-chat retrieval+generation；[`TanStack Query query keys`](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys) 说明 dependent variables 应属于 query keys；[`Bazel remote caching`](https://docs.bazel.build/versions/5.0.0/remote-caching.html) 记录 action-hash caching，并提醒 build 中 inputs 变化的 caveat。这两者只是 complete-input-identity/stale-result concern 的工程类比；自动 cache refresh 不授权 campaign upgrade，也不证明 NPC quality。[`ACUTE-EVAL`](https://arxiv.org/abs/1909.03087) 是整段对话的人类比较；[`TD-EVAL`](https://arxiv.org/abs/2504.19982) 是 task-oriented 的 turn+dialogue evaluation。设置不同，任何一篇都不能证明中文 NPC 改善。外部 claims 仅作有限、明确归因的背景依据，不作为本规格的质量证明。

每次材料和运行保存 source snapshot、package/version/digests、active load order、effective revision、model override、prompt bytes、cards 原始/投影形态、case cluster、盲评顺序与 tie。版本号由实施者读取最新 manifest 后决定，不覆盖 frozen 1.1.0/2.1.9。保留 `preregistration-bank.md` 的 v3 失败与 owner 复判。`source guard`：研究来源只作证据，不作运行时 lore；闭集判断由 Jev 负责，精确 source handling/control 由 host 负责，开放 prose/synthesis/candidate proposals 由 tool-Pi 负责。

## 9. 空完成、三端与预算结语

空完成仍包括静态链接、包安装宣称迁移、关键词指标、额外 reviewer、把卡当人物、或用表格替代真人回合。三端是 writer（Keeper 根据 declaration 与 receipts 写一份）、reader（现有 delivery transaction 与 host transcript/card projection）、actor（玩家读第一份并选择下一步）；没有 prose reviewer 位于 writer 与 player 之间。

三个结束条件是：**未改善即停止**；**inconclusive 即保留较简单方案并停止**；**只有 screen 与 owner-readable live play 都通过，且旧世界 release gate、stale rejection、fallback、full/brief 传播成立，才可发布**。历史仍须保留，现行 one-pass policy 不变。以上只是提案，不授权今天实现任何文件外行为。
