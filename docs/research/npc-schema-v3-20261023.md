# NPC schema v3（2026-10-23）

v2 草案先交给网页版 ChatGPT 审了两轮。它用的是 GPT-6 thinking，思考强度 Extra High（Pro 档当时已到上限）。评审原文在你 Mac 上：`~/leehow/code/npc-schema-survey/v2/chatgpt-review.md`，对话地址 https://chatgpt.com/c/6adb11be-511c-8330-8aa2-81b4c40f861b 。这一版逐条处理了它的意见，见第一节。调研依据没变：v2 目录里的 survey-zh-a、survey-zh-b、survey-en、schemas-verified，以及 russ-graph-vs-book。

ChatGPT 还说它在自己的沙箱里生成了 contract.ts、runtime.ts 和拉斯/内特的 fixture，并称已通过 tsc --strict。这些文件我没下载，也没验证，下面的内容不依赖它们。

---

## 一、ChatGPT 的意见，以及我的处理

| # | 意见 | 处理 |
|---|---|---|
| 总 | 方向保留，但 NPC 卡不能什么都装：世界真相归图，承诺归世界账，地点、物品、时间用现有系统 | **采纳。** v3 的 NPC 只存它自己的部分：人设、信念、披露规则、态度、阶段。真相仍然是图上的 claim、线索和呈现件 |
| F1 致命 | 有 say 标记不等于"说了"。要拆成四个独立事件：选中、表达、接收、相信。作者漏标就记"未确认"，不能当成"没说" | **采纳**，见三-C。补一条：防重复和知识转移用的证据强度不同。"未确认"计入防重复的次数（宁可少说一遍），但不让听者学到这条知识 |
| F3 致命 | KnowledgeItem 职责太多。拆成 WorldProposition（世界事实）、NpcBelief（谁怎么看它）、NpcDisclosureRule（怎么说出口：真话、谎言、回避、拒绝）；你 runbook 的七种知识类型改成这三者的组合 | **采纳**，见三-A 和附录对照表 |
| F2 致命 | "第一个满足的门槛生效"表达不了"铁证且困难成功"。改成 all/any 表达式加检定回执，求值器不掷骰，返回通过、受阻或待定；过门槛只是进入下一阶段，不等于自动交出秘密 | **采纳。** 拉斯过门槛之后进入"认真倾听"阶段，真正说出口要靠另一条披露规则 |
| F4 致命 | "玩家安全"不是一个布尔值。只给某个调查员的私密披露、梦境、信件不能进共享的正文流 | **采纳，放到 P2。** 现在基本是单调查员的桌子，但 schema 先留好 `audience` 和 `channel`，作者输入按接收者投影 |
| F5 致命 | "旧战役不用重读"做不到：门槛、日程、兰德尔这些信息旧图里根本没有。缺的标 unresolved，涉及敏感信息时先阻断披露、再定向重读；旧的 9:20 记忆要隔离 | **采纳。** v2 这句话是错的，已删 |
| S1/S2 | 提议、承诺、协议是三种东西；在场不等于听到，听到不等于相信 | **采纳**，见三-D |
| S3 | 宿主不要强制把重复改成回指，应该算出可选策略，由 KP 在 refer / restate / clarify / update 里选；`told` 分开计新说次数和回指次数 | **部分采纳。** KP 来选，但宿主要校验：只有玩家明确要求再说一遍或者没听清，才允许 restate；update 必须带新内容。否则按 refer 结算，并在下一份 capsule 里注明 |
| S5-S7 | 多相 NPC 拆成四个正交维度：阶段、对外身份、身体、控制者；群体单独做成 Cohort；日程概率只抽一次并留回执，地点仍以 npc_presence 为准 | **采纳** |
| S8 | 七档 stance 没法排序（"恐惧""被控制"跟"友好"不在一条线上）。改成 5 档态度，加可选的 trust/fear/pressure，控制状态另记；不要用 −4..4 的分数 | **采纳，但这是你的模型，需要你点头**，见第五节问题 1。你的七档能完整映射过来：恐惧 = fear 高，被控制 = control 字段 |
| 解析 | 分两层：导入时建全局索引，进场景前再细读；字段标明 explicit / interpreted / unresolved，禁止为了填满 schema 去编 | **采纳** |
| KP 预算 | 每回合只给按话题筛过的切片，不给整张卡 | **采纳**，见三-F |
| on_fail | 由 KP 选、宿主校验，不设为必填 | **采纳** |
| 调研纠错 | schemas-verified 里 Talk of the Town 那节其实没抓到源码字段 | **属实。** 那节的证据类型（观察、陈述、谎言、偷听……）出自 AIIDE 2015 论文 PDF，不是源码。已在调研文件里改正 |
| 分期 | P0 只修空决策和交付账 | **采纳**，见第四节 |

---

## 二、设计原则（v3）

1. **各归各的。**
   - 世界事实：图上的 claim、clue、exhibit。
   - 地点：npc_presence。
   - 时间：时钟。
   - 物品和钱：kernel。
   - NPC 只存四样：人设、它相信什么、它会怎么说、它对每个人的态度和当前阶段。
2. **定义只读，状态由事件折叠。** 书里来的只读、带出处。运行时状态全部由宿主根据回执和交付事件折叠，可以从回合记录重建。
3. **说话分四步：选中、表达、接收、相信。** 每一步的证据单独记，强度也不同。
4. **门槛是表达式，结果来自检定回执。** 求值器只看回执，不自己掷骰。社交难度按规则书公式现算。
5. **不编。** 解析器拿不准的字段标 unresolved；涉及披露时，unresolved 等于"先不说"。
6. **按话题给切片。** KP 每回合只看到和当前话题、当前在场者相关的规则和信念。

---

## 三、Schema

记法：`src = {source_refs[], basis: 'explicit'|'interpreted'|'unresolved'}`。书里来的字段都带 src；unresolved 字段在披露路径上视为阻断。

### A. 三层知识

```ts
// 1. 世界事实：不新建，就是图上已有的 claim / clue / exhibit，统一用 PropRef 引用
type PropRef = {claim: string} | {clue: string} | {exhibit: string} | {constructor: string /*规范化哈希*/}

// 2. 信念：谁怎么看某件事（不带 truth；真假由 PropRef 自己的 truth_status 决定）
interface NpcBelief {
  holder: NpcId; prop: PropRef
  attitude: 'knows'|'believes'|'suspects'|'rejects'|'explicitly_unknown'   // explicitly_unknown = 书上写明"他不知道"
  evidence: {kind: 'book'|'observed'|'told'|'overheard'|'inferred'|'controlled', from?: Id, event?: EventId}[]
  src?: Src
}

// 3. 披露规则：这个人在什么条件下、以什么方式谈这件事
interface NpcDisclosureRule {
  id: string; holder: NpcId
  about: PropRef | {topic: string}
  entry: 'volunteers'|'if_asked'|'gated'|'never'
  gate?: GateExpr                                  // 只在 entry = 'gated' 时有
  mode: 'truthful'|'lie'|'evade'|'refuse'          // 撒谎、回避（约翰·雷霆）、拒绝
  says?: ExhibitRef                                // 说出口的原话（§257 证词呈现件），撒谎时就是谎言本身
  tell?: {skills: ['Psychology'], difficulty: 'derive'|Level}   // 识破手段
  on_exposed?: Effect[]
  audience?: Condition                             // 按听者给不同说法（人间乐土的三套假记忆）
  stage?: {opens: string}                          // 过门槛只打开一个阶段，例如 "listens_seriously"
  src: Src
}
```

**你 runbook 的七种知识类型 → v3 组合**

| runbook | v3 |
|---|---|
| 亲历事实 | belief knows + evidence observed + truthful |
| 专业推断 | belief believes + evidence inferred |
| 传闻 | belief suspects + evidence told(谁) |
| 谎言 | belief knows(真相) + 规则 mode lie + says(谎言呈现件) |
| 保护性隐瞒 | belief knows + 规则 entry gated 或 never + mode refuse/evade |
| 创伤扭曲 | belief believes 一条 partial 的 prop + truthful |
| 被控陈述 | belief evidence controlled + 规则受 control 状态约束 |

### B. 门槛表达式

```ts
type GateExpr =
  | {all: GateExpr[]} | {any: GateExpr[]} | {not: GateExpr}
  | {roll: {skills: string[], at_least: 'regular'|'hard'|'extreme'|'derive', attempt: 'this_exchange'}}  // 看检定回执
  | {evidence: {clues: string[], shown: 'this_exchange'|'ever'}}       // 调查员在这次交涉里出示过
  | {disposition_at_least: Disposition} | {trust_at_least: 0|1|2|3|4|5}
  | {stage: string} | {event: string} | {trade: string} | {credential: string}
  | {modifier: {when: Condition, shift: -2|-1|1|2}}                    // 格蕾丝"男性 -50%"、交还文物每件 +10%
// 求值器（宿主，确定性）：passed | blocked(原因) | pending(需要检定: 技能、推导出的难度)
```

拉斯的门槛："铁证"且"困难成功"，打开"认真倾听"这个阶段：

```json
{"id":"russ-listens","holder":"npc-russ-williams","about":{"topic":"abattol-danger"},
 "entry":"gated","mode":"truthful",
 "gate":{"all":[{"evidence":{"clues":["<hard-proof clue ids, unresolved>"],"shown":"this_exchange"}},
                {"roll":{"skills":["Persuade","Charm","Intimidate"],"at_least":"hard","attempt":"this_exchange"}}]},
 "stage":{"opens":"listens_seriously"},
 "src":{"source_refs":[{"pdf_index":16}],"basis":"explicit"}}
```

真正讲出镇上的情况要靠另一条规则：`{"about":{"topic":"abattol-danger"},"entry":"gated","gate":{"stage":"listens_seriously"},...}`，再加上"PC 答应帮他和兰德尔离开"这个 trade。"铁证"具体是哪几条线索，书里没写清，所以标 unresolved；没确定之前，这条门槛按阻断处理。

### C. 交付：四个事件

```ts
SelectEvent  {id, turn, speaker, to[], act, items: PropRef[], rule?: ruleId, strategy?: 'new'|'refer'|'restate'|'clarify'|'update'}
ExpressEvent {select: id, item_marks: {[unitId]: 'attested'|'unconfirmed'}, spans: string[], semantic_verified: false}
ReceiveEvent {express: id, listener, channel: 'speech'|'phone'|'letter'|'dream'|..., basis: 'addressed'|'present'|'overheard'}
BelieveEvent {receive: id, listener, belief_change: {prop, attitude}|null, by: 'host_rule'|'kp_command'}
```

**表达。**
- 作者给每个选中条目加单元标记，`{{say:npc_2}}…[[s:U1]]…[[/s:U1]]…{{/say}}`，标到的条目记为 attested。
- 漏标、标错或输出中断，记为 unconfirmed，不记为"没说"。
- `semantic_verified` 永远是 false，因为宿主不判断语义。

**接收。** 被说话人直接对着说的、在场的听者都算 received。只是在场、没被对着说的，basis 记为 present。

**相信。** 默认规则：
- 被对着说的听者，得到一条"X 说过 P"的信念，attitude 是 believes，evidence 是 told。
- 只是在场的人，得到一条 suspects，evidence 是 overheard。
- 如果 P 和听者已有的 knows 冲突，就不更新，留给 KP 用命令改。

**计数。**
- told 记两个数：`new_count` 是作为新内容说的次数（attested 加 unconfirmed），`refer_count` 是回指的次数。
- 防重复按 new_count ≥ 1 来判断。
- 知识转移只认 attested。

### D. 提议、承诺、协议

```ts
Proposal   {id, by, to[], what: TypedConstructor, made_in: SelectEvent}          // "九点二十来取"在接受前只是提议
Commitment {id, obligor, beneficiary[], what, due?, status: 'open'|'kept'|'broken'|'withdrawn', source: SelectEvent|Receipt}
Agreement  {proposal, accepted_by, at: EventId, commitments: Commitment[]}
```

- 承诺放在世界账里，不放进 NPC 卡。NPC 卡里只留"我欠谁什么"的引用。
- 旁观者只得到一条信念："拉斯提议过 X"。
- 记忆车道抽出的、无据可查的 promise 都隔离掉，标 `quarantined: no_source_event`。

### E. 人设、态度、阶段、群体、日程

```ts
NpcDefinition {
  id, importance: 'key'|'supporting'|'background'                 // 重要度
  cohort?: CohortId                                               // 群体身份单独记，和重要度分开
  names: {canonical, aliases[], address_forms?, reveal}
  identity: {age?, occupation?, role_keeper, archetype?: {code, legend}}   // 血色公路 Af/O 这类字母标签
  affiliation?: [{faction, loyalty?, complicity: 'none'|'aware'|'helps'|'member'|'leader'}]
  presentation: {appearance_exhibit?, voice_exhibit?, mannerisms?: string[≤3], languages?}
  inner: {traits[], goal, wants_in_return?, fears?, leverage?, hooks?: [{trigger, offer}]}  // keeper-only
  social: {resist?: {charm?, fast_talk?, intimidate?, persuade?, psychology?}, initial_disposition,
           reaction_basis?: 'APP'|'CR', on_fail_hints?[], push_consequence?, repeat_question?: {after, reaction}}
  relations?: [{to, kind, note?}]                                 // 有方向
  holds?: [{item|document, gives_when?: GateExpr}]; provides?: [{service, price?, gate?}]
  schedule?: [{when: {clock?|day?|after_event?|probability?}, where, doing, reachable}]   // 第一条满足的生效
  triggers?: [{id, when, then, once}]
  phases?: [{id, when, overrides}]                                // 芬彻生前/鬼魂、无辜/凶手
  stats?: CocStatBlock                                            // 字段按 Foundry CoC7 npc-system 的形状
  play_notes?, content_flags?
  beliefs: NpcBelief[]; disclosure: NpcDisclosureRule[]
  src: per field
}
Cohort { id, template: NpcDefinitionPartial, count: number|{min,max}, members?: [{id, overrides}], shared?: {hp?} }

NpcState {
  id, phase, public_identity?, body?, controller?: {by, kind: 'faction'|'drug'|'magic'|'fear'}   // 四个正交维度
  alive, activity?, condition?, hp?, san?, mp?, luck_pool?          // 位置不在这里，以 npc_presence 为准
  mood?: {text, since_turn, expires_turn?}
  attitude: {[toward]: {disposition: Disposition, trust?: 0..5, fear?: 0..5, pressure?: 0..5,
                        public?: Disposition, because: Receipt[], since_turn}}
  stages_open: string[]; triggers_fired: string[]
  schedule_rolls: {[ruleIndex]: {value, receipt}}                  // 概率只抽一次
  owed: Ref[]; betrayals: Ref[]
}
Disposition = 'hostile'|'unfriendly'|'neutral'|'friendly'|'ally'
```

### F. 谁写、谁读

| 内容 | 写入方 | KP 看到 | 作者看到 |
|---|---|---|---|
| Definition / 信念 / 披露规则 | 解析器两层读取 + 复核 | 当前话题下这个人的规则：入口、门槛求值结果、mode、已达阶段 | 只有 presentation 呈现件 |
| 交付四事件 | 宿主（选中来自决策包，表达来自正文标记，接收来自在场和通道，相信来自规则） | told 计数：新说、回指 | 本回合选中的条目，以及回指 |
| 态度、阶段 | KP 命令（扩展后的 relationship）、检定回执、孤注一掷规则 | 对每个对象一行 | 只看对你的 public 态度 |
| Proposal / Commitment | 宿主根据交付和接受折叠；kernel 回执负责结清 | 未了结的，带到期状态 | 这个人提过、许过、还没了结的 |
| 日程 / 触发器 | 定义只读；宿主按时钟和事件求值，结果交 KP 决定 | 当前生效的那条 | 不给 |

---

## 四、分期

| 期 | 内容 | 直接解决 |
|---|---|---|
| **P0** | ① 允许"无可说"（`nothing_more`），不再强制给 offer 和 answer 填内容；② 交付四事件账加 told 计数，可以从回合记录重建；③ 承诺只认有来源事件的，隔离旧 promise，修掉旁观者把承诺当成自己的那个漏洞；④ 作者指令删掉"历史不能取消重复"，KP 选 refer/restate 由宿主校验 | 九点二十和其他重复台词 |
| P1 | 三层知识加 GateExpr，从现有图折算（拿不准的标 unresolved）；社交难度推导；态度改成 5 档加三个可选数值 | 门槛、谎言、按对象的态度 |
| P2 | 解析器新增 NPC 定义两层读取；日程、触发器、阶段、Cohort；按受众隔离的作者输入 | 内特的作息、群体、多相 NPC、私密披露 |
| P3 | 旧战役定向重读工具；七档到五档的迁移 | 旧战役 |

每期都在你 Mac 上用 MiniMax、拿血色公路实测（不用 Opus）。P0 的验收标准：同一说话人没有 12 字以上的逐字重复；旁观者不复述别人的承诺；没有来源事件的约定为 0；重载后计数不变。

---

## 五、要你定的

1. **态度模型**：ChatGPT 建议把你的七档 stance 改成 5 档态度，加 trust、fear、pressure 和单独的 control。我同意它的理由，但这是你的模型，你定。
2. **P0 先做吗？** P0 只动交付账、承诺来源、KP 的"无可说"和作者指令四处，不碰解析器，能最快消掉重复台词。
3. 更细的 spec 和工单（按 to-spec 的格式）等你看完 v3 再写，免得又在没对齐的设计上展开。

---

## 附：v2 → v3 主要变化

- KnowledgeItem 拆成 NpcBelief 和 NpcDisclosureRule，真相回到图上。
- gates 列表改成 GateExpr，过门槛只打开阶段。
- TalkRow 改成选中、表达、接收、相信四个事件，加上单元标记和"未确认"。
- 承诺移到世界账，分成提议、承诺、协议。
- tier 拆成 importance 和 cohort；variants 改成阶段、对外身份、身体、控制者四个维度。
- stance 七档改成 5 档态度，加三个可选数值，加 control（待你定）。
- 删掉"旧战役不用重读"；字段带上 explicit / interpreted / unresolved。
