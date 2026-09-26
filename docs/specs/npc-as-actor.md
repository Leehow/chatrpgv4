# NPC 是一等行动者：意图有状态，行动有落点

Status: ready-for-agent（工单 07 与 11 是 ready-for-human，各票开头有说明）
Date: 2026-09-26
Branch: `0.9.5a`（核查基线 `651a9cb26`；`kernel-ts/read/director.ts` 与 `claude/integ-single-loop-20260923@d292ed66e` 同哈希，本文引用的行号在两条线上都成立）
Owner ruling: 2026-09-26（见第二节）
Evidence: 用户自己玩的真桌 `game-26d5a671-85a2-4732-876b-1521aa04d869`，App 库 `~/Library/Application Support/Pipi/pipicoc/pi-coc/.coc/campaigns/`，2026-09-23 07:03–09:15Z，鬼屋，KP `grok-4.6` low（grok-build），车道 `opencode-go/deepseek-v4.1-flash`。读数在附录 B。
Related: `docs/specs/turn-floor.md`（契约 §34）、`docs/specs/npc-acts-for-the-party.md`（设计稿，工单 04 吸收它的 L1/L2 并落它的第 1、2 条拍板）、`docs/specs/pi-native-single-loop.md`（NPC 的自由选择是它指定的 LLM 步骤）、契约 §11.5.3、§17.3、§30.9、§79.2、§113 D、§122 T14。

## 一、问题

玩家在开场没接委托，直接打了诺特，抢了钱，再抢钥匙。从回合 5 到回合 12，诺特每回合的全部动作是还一拳加一句话，而这句话八回合里五次是同一件事的换说法：「再伸手，我喊人」「再打，我喊人」「来人——」「再打，我真喊人了」「你还打？」。喊了没人来，喊过的人下一回合再喊一次。玩家最后两句是在退出：自我介绍、要求重建人物。

这不是「诺特的反应写得不好」。核对代码与那桌的产物，五个读数：

1. **NPC 车道给 KP 递了五回合已经做完的事。** 诺特的应对库（`kernel-ts/npc/responses.ts`，每行一对 `intent`/`when`）在回合 3 挨第一拳时重写过一次，含「当场终止委托、收回钥匙、停发工钱」。诺特回合 3 就照做了（item 与 cash 收据），回合 4 钱又被抢走。此后回合 4、6、8、9 车道每次都选中这同一行注入给 KP（`extensions/npc/index.ts:88`）。库的重算键（`responses.ts:17`）只摘 scope、场景在场、人格、知识、信念，不含立场、账本、收据；重算只在 advice 报 `no_suitable_candidate` 时触发（`extensions/npc/index.ts:173`）。回合 5 立场翻成 hostile 也不触发。含「喊人叫来路人把他赶走」的那版应对库 09:16:04Z 才写出来，桌子 09:15:37Z 已散。
2. **「来人——」哪里都没留下。** 回合 8 的喊声无收据、账本无、记忆抽取跳过了回合 6 与 8、只在回合 9 的 `recent` 散文里活了一回合。账本条目（`kernel-ts/write/contributions.ts:127`）只有 stance / disclosed / exchanged / interactions / promises / said / skills / turns_present，没有「他打算做什么、试过没、结果如何」。§113 D 的重复台词闸门（`kernel-ts/write/speech.ts:96`）比的是 12 个字符的最长公共连续段，「再打，我喊人」与「再打，我真喊人了」公共段不到 12 字，放行。验证器六种 kind（`kernel-ts/memory/index.ts:21`）没有停滞类，全程 0 条 finding，回合 5、10 各超时 60 秒。
3. **诺特轮到自己时，规则层什么都没给。** 他的原型 `ordinary_adult` 不带 disposition，`world.npc_disposition` 整个缺席，`standingAction`（`kernel-ts/combat/standing.ts:184`）返回 null，交 KP 自定。KP 自己在回合 3 写的理由是「普通中年房东，不是能打的人」，然后让他每轮还拳。`hold`/`flee` 两个词本来就是「交给 KP 叙述」（`kernel-ts/combat/standing-words.ts:5`），引擎没有 NPC 逃跑动作。
4. **导演从回合 5 起被 session 短路。** `score()`（`kernel-ts/read/director.ts:178`）有活跃 session 就返回 SUBSYSTEM，`stalled_turns` 从 0 数到 7、`empty_turns` 数到 2，四个 RECOVER 信号一次没进打分。但 RECOVER 的下游只有 offer 排序（`kernel-ts/read/offer.ts:9`）与 adoption 遥测（`kernel-ts/write/text.ts:316`），单循环路由不读 director；单独去掉短路接近 no-op。
5. **回合 10 是另一条缺陷。** KP 的 `resolve` 送去复核车道，60 秒超时，KP 把拒绝写进小说：「这一拳没能落到账上，桌子这边暂时没法裁定」。事后审查判 revise 但 already delivered。它属于车道尾延迟那条线，本 spec 不修，只记。

## 二、裁定（2026-09-26，用户）

> 同一个 NPC 连续两轮不能是同一种行为，任何被宣布的行为下一轮必须有结果。内容重复是大忌：他可以一轮喊人、下一轮抄椅子、再下一轮冲出去或喊来不明情况的邻居，具体做什么不预设，但不能每一轮都是「我要喊人了」然后没有后续。

与既有裁定的关系，写清楚免得下一个修工再把它们打架：

- `keeper-pacing`「目标完成且没选下一个就交回，不要制造事件」与 §122 T14「no progress obligation」说的是**不逼玩家**：不给玩家塞任务、不替玩家选路。本裁定说的是 **NPC 对已经发生的事必须有回应**，回应的对象是世界不是玩家。两者不冲突：诺特被打之后做点什么，不等于把玩家拉回委托线。
- 「不许硬编码语义列表」不变。本 spec 没有任何一处存「NPC 动作种类表」：他会做什么由模型按处境写（应对库那些行就是这么来的）；闭合的只有**结果**——引擎能结算的几种（检定过或不过、伤害、钟走一格、有人到场、立场或位置变化）。「不重复」比的是意图行的 id，不是文本，不是类别。
- 「turn-floor D7 不加第五种 too little 审计类」不变。停滞不靠语义审计抓，靠结构：同一意图行连交两次而中间没有结果收据。

## 三、诊断

两层，下面那层是根。

**上层：NPC 主动性没有状态。** 玩家做的每件事都成收据进账本；NPC 试图做的事（喊人、逃、开条件）只是散文，下一回合就不存在了。于是每回合 NPC 从模组初始的 `wants` 重来，advice 车道从一张不知道自己已被执行的表里再选一次，KP 只能换措辞再威胁一次。

**下层：NPC 不是一等行动者。** 附录 A 把结算面按「收据种类 × 行动者」过了一遍。NPC 能到达的落点全是「对玩家做加减法」或「改 NPC 自己的属性」；凡是 NPC 要**改变世界**或**引入新东西**的（开打、战斗外用本事、临时的钟、书上没有的人、手里的东西、锁门堵路），要么没有落点，要么落在一个静默缺省值上（战斗里 `other` 动作的技能缺省 Spot Hidden、目标值缺省 50，`kernel-ts/combat/engine.ts:605`）。这就是诺特除了还拳和说话什么都做不了的原因：不是 KP 没想到，是他每想到一件事，宿主都没有地方接。

修复顺序因此是串行的：先让 NPC 的意图与尝试成为状态（D1、D2），再补落点（D4），最后才轮到导演（D5）。反过来做全是空转。

## 四、设计

### D1 意图行有状态

- 应对库（`npc/responses/<digest>.json`）每行加 `id`（行的 digest）、`status: open | attempted | done | failed | abandoned`、`history: [{turn, receipt?, outcome}]`。新生成的行 `open`。
- 折叠：账本 fold（`kernel-ts/write/contributions.ts`）读回合收据里的 `intent_ref`（D2 铸的）与 KP 显式的 `apply npc intends`（D2 的兜底），写行状态。`done` 与 `failed` 是终态；`attempted` 是「试了、结果未知」，下一回合必须结成 `done`/`failed` 或被新行替代（`abandoned`，写明由哪一行替代）。
- 重算条件加两条：本 NPC 的账本 stance 变化；本 NPC 有行进入终态且库中 `open` 行少于阈值（设置，缺省 3）。现有的 `no_suitable_candidate` 触发保留。重算时旧行连状态一起带进 packet，模型看得到「他已经试过什么、结果如何」；新库不许再出与终态行同 `intent` 的行（digest 相等即拒，`checked()` 处）。
- 投影：`present[].history.intents`（最近 3 行，带状态与回合），offer 的 `consequence` 池加一种来源 `npc.intent`：`attempted` 行投「<名>上回合试图 <intent>，结果未定，这一条还悬着」，排在失败检定之前。advice 车道的候选集 = `open` 行 ∪ 本 NPC 的 `attempted` 行；终态行不进候选。

### D2 NPC 的一轮是一次操作

- 单循环里 NPC 自己的回合（standing action 为 null 时）已是指定的 LLM 步骤；改成：候选 = 应对库候选（D1）∪ 引擎的闭合动作（attack / maneuver / flee / other / cast，按 session 发行），模型选一行并绑参数，宿主执行为操作，铸收据。NPC 的自由选择本身不再是 prose。
- 每条由 NPC 回合铸出的收据带 `intent_ref: <行 id>`（roll、delta、session、npc、threat、person 都可以带；无则空）。
- `other`（`resolveSkillCheck`）对 NPC 行动者：技能必须来自 profile 或钉过的数（`apply npc skill`，契约 L1887，已实现）；没有就报 `needs`，`fix` 指向 `apply npc skill`。删除 `|| 'Spot Hidden'` 与 `|| 50` 两处缺省（`engine.ts:605,607`）——这是内核编造数值，与 npc-acts 设计稿第 1 条拍板同一条线（不推导、报 needs）。
- `hold` 与 `flee` 出收据：`hold` 铸 `npc` 收据 `{action: hold, intent_ref}`；`flee` 走引擎已有的 `resolveFlee`（`engine.ts:1026`，给任何 actor 打 `fled`），并在同一批里写 `apply npc to: away`（工单 09 处理去向与追逐）。
- 兜底：模型给 NPC 选了一件引擎没有结算路径的事（对着窗外喊、把文件扫进抽屉锁上），KP 写 `apply npc {name, intends: "<一句>", outcome: attempted | done | failed | abandoned, intent_ref?, why}`。这是一条 `npc` 收据变体，只写账本与行状态，不写任何世界数值。它保证「没有任何 NPC 行动只活在散文里」。
- `standing-words.ts` 注释与 §11.5.3 同步：`hold`/`flee` 不再是「交给 KP 叙述」，而是「交给 KP 选择，选择落收据」。

### D3 同行不连选（宿主闸门）

- 宿主在 NPC 回合的交付前比较：本回合铸出的 `intent_ref`（或 `apply npc intends` 的 `intent_ref`）等于该 NPC 上一回合的 `intent_ref`，且两回合之间该行没有进入终态（没有 `done`/`failed` 收据）——退一次，steer 文本点名那一行：「<名>上回合已经 <intent>，结果没有落账；先结它（done/failed），或选别的行」。与 floor steer 同形（`extensions/kernel/index.ts` 的 `deliveryFix`），一回合只退一次，第二次照收。遥测 `lane: "npc-repeat"`，记 `{turn, npc, intent_ref, steered}`。
- 不比文本，不比类别，不看 prose。§113 D 的字面去重保留，两者互不替代。
- 玩家侧不动：本闸门只看 NPC 的收据，玩家重复输入仍走 turn-floor 的 `repeat_input`。

### D4 NPC 一等行动者：把附录 A 的缺口逐个补上

每个缺口一张工单（04–09），共同原则：

- 行动者字段统一用 `actor`（resolve）与 `name`（apply npc），不新造第二套身份；识别走 §12.4 的整词规则与 §79 的桌上名。
- NPC 的数只来自三处：书上写的、`apply npc skill/archetype` 钉的、规则表按闭合条件给的。没有就 `needs`，永远不缺省。
- 新落点都是**运行时状态**（`world.*` 或战役目录），不改模组图；这与 §30.9「count is runtime, never the graph」同一条。
- 每张工单的验收都含一个变异用例：把新写入删掉，旧行为（散文里发生、账上没有）必须被用例逮住。

### D5 导演：session 不再屏蔽 RECOVER

- `score()` 的 session 覆盖改成「SUBSYSTEM 得满分，其余节拍照常打分」：RECOVER 的四个信号在战斗里也进 `scores`，offer 在 SUBSYSTEM 顺序里保留 `consequence` 首位（本来就是），而 `consequence` 池现在有 D1 的意图行可投。
- `blocked_attempts` 对对抗骰不计（`obstacleKey` 要整数阈值），保持；不为战斗另造一个计数。
- 排在 D1、D2 之后做：没有意图行时这一改只换个节拍名。

### D6 不做什么

- 不做 NPC 动作枚举表、不做文本相似度、不做前后局面的语义比较审计、不加验证器 finding kind。
- 不给玩家加进度义务；`keeper-pacing` 对玩家的措辞不动。
- 不恢复 Python，不改 `tests/python-oracle.json`。
- 场景状态被 NPC 改变（锁门、堵出口）与场内位置（躲到桌后）留给扁平地点模型那条线（记忆 `flat-locus-model-punishes-detail`），本 spec 只在附录 A 记为缺口。
- 回合 10 的车道超时泄漏进小说，属于复核尾延迟那条线。

## 五、验收

- **真桌，产品路径。** 主会话 live KP，一句自然输入一回合，禁止 `kp_settle_turn`、批处理、关键词路由、模板银行（Agents.md「Absolute Ban」）。开一桌鬼屋新战役（战役是编译快照，改完必须新开），玩家条件复刻那桌：不接委托、打诺特、抢钱、抢钥匙、连打六回合、中途一句题外话。再开一桌不同模组、不同 NPC、玩家不打人只纠缠，防止只修诺特。
- **结构指标（记录并与 09-23 那桌并列，不单独当通过）：**
  - 同一 NPC 连续两回合 `intent_ref` 相同且中间无终态收据的次数：目标 0（那桌是 4：回合 5→7→8→9→10 的喊人链）。
  - NPC 回合数 : NPC 行动收据数：目标接近 1（那桌 NPC 有 5 个自己的回合，`intent_ref` 收据 0）。
  - `apply npc intends` 兜底占 NPC 行动收据的比例：报告，不设阈值；过高说明落点还缺。
  - `npc-repeat` 闸门触发次数与第二腿是否改选。
  - 战斗回合的 `director.scores` 里 RECOVER 是否出现（D5）。
- **编辑读法。** 逐回合记 NPC 做了什么、上一回合的事有没有结果、玩家能不能看出世界变了；记 yes / no / 故意不做，不加总。
- **契约用例走真实入口**（记忆 `tests-must-travel-the-real-path`）：每票列出。

## 六、工单

| 票 | 题 | 状态 | 依赖 |
|---|---|---|---|
| 01 | 意图行有状态：应对库、折叠、重算、投影 | ready-for-agent | 无 |
| 02 | NPC 的一轮是一次操作：单循环 NPC 步骤、`other` 不缺省、hold/flee 出收据、`apply npc intends` 兜底 | ready-for-agent | 01 |
| 03 | 同行不连选：宿主闸门与遥测 | ready-for-agent | 01、02 |
| 04 | NPC 在战斗外用自己的本事（吸收 npc-acts L1/L2） | ready-for-agent | 02 |
| 05 | NPC 主动开打：偷袭与伏击进规则层 | ready-for-agent | 02 |
| 06 | 临时的钟：`apply threat` 可铸运行时钟 | ready-for-agent | 无 |
| 07 | 书上没有的人到场：轻路径 | ready-for-human（身份边界要拍板） | 无 |
| 08 | NPC 手里的东西：持有与武器 | ready-for-agent | 02 |
| 09 | 逃跑的后续：在场、去向、追逐 | ready-for-agent | 02 |
| 10 | 导演：session 不再屏蔽 RECOVER | ready-for-agent | 01、02 |
| 11 | 真桌验收 | ready-for-human（需要真人或单句玩家） | 01–06、08–10 |

## 附录 A　结算面矩阵：收据种类 × 行动者（2026-09-26 核查）

行 = 一次行动能落下的收据/事件（`EVENT_TYPES`，`kernel-ts/write/store.ts:58`，加 mechanics 投影认的收据种类）。列 = 行动者是调查员 / 行动者是 NPC。「通」= 有路径且数值来源正确；「半」= 有路径但缺后续或缺状态；「缺」= 没有路径或落在静默缺省上；「—」= 这种收据没有行动者语义。

`L<n>` 是 `docs/kernel-rpc.md` 在 `651a9cb26` 的行号，`§` 是节号（节号是稳定标识符，行号不是）。

| 收据 / 事件 | 写者 | 调查员 | NPC | 依据 |
|---|---|---|---|---|
| `roll`（combat 族，attack / defend / maneuver / aim / reload） | resolve | 通 | 通，仅 session 内 | 契约 §11.5、L809；`execution.ts:227` NPC 走 `npcProfile` |
| `roll`（combat 族 `other` → skill_check） | resolve | 通 | **缺**：技能缺省 Spot Hidden、目标值缺省 50 | `engine.ts:605` |
| `roll`（combat 族 `flee`） | resolve | 通，成功接 `chase:start` | 半：`resolveFlee` 给任何 actor 打 `fled`，但不接追逐、不改在场 | `engine.ts:1026`；`standing-words.ts:5`；契约 L521 |
| `roll`（combat 族 `surprise_attack` / NPC 开局） | resolve | 通 | **缺**：「An NPC cannot open the round itself」 | `execution.ts:277`；§32.9 |
| `roll`（combat 族 `cast`） | resolve | 通 | 未验：参与者有 MP 扣减路径（`execution.ts:154`），NPC 施法者未在真桌验过 | |
| `roll`（chase 族） | resolve | 通 | 通：参与者分 pursuer / quarry | `chase/index.ts:99,186` |
| `roll`（sanity 族） | resolve | 通 | 通：NPC 的 SAN 损失读钉过的 profile | `sanity/index.ts:180`；L7202 |
| `roll`（social / psychology 族，行动者对目标） | resolve | 通 | **缺**：行动者写死为调查员，NPC 不能对调查员威吓或说服 | `resolve/basic.ts:65,117` |
| `roll`（healing 族） | resolve | 通 | **缺**：施救者写死为当前调查员，医生缝手掷的是伤员的医药 | npc-acts 设计稿第一层 |
| `roll`（core-check / ordinary，session 外） | resolve | 通 | **缺**：「NPC 作 actor 只在它参与的战斗或追逐里被接受」 | 契约 L809；设计稿 L2 未实现 |
| `roll`（development 族） | resolve | 通 | — | |
| `delta` / `condition`（damage、hp、mp、san） | resolve、apply damage | 通 | 通：对 NPC 的伤害写 `npc_resources` | 契约 L10944 |
| `session`（start / round / end） | resolve | 通 | 半：NPC 只能被拉进会话，不能开一个 | 同 surprise 行 |
| `move`（scene-moved） | apply move | 通 | —：NPC 换场景走 `apply npc to` | L1887 |
| `npc`（to / stance / conditions / defense / action / disposition / skill / archetype / dead） | apply npc | — | 通：这是 NPC 自己的属性 | L1887；那桌回合 3 的 `npc-changed` 带 `archetype` |
| `npc`（intends / outcome） | apply npc | — | **缺**：本 spec D2 新增 | |
| `clue`（clue-discovered） | apply clue | 通 | 半：NPC 只能作 `from` 交出书上的线索；NPC 自己新知道的事只有记忆行的 `knowers` | L1597；`npc_knows` 只能走 adaptation |
| `handout` | apply handout | 通 | 半：只能交付书上登记的手卡；NPC 现写的条子没有手卡 | L2539 |
| `item`（item-transferred） | apply item | 通，两个方向 | 半：NPC 只能是 `from`；NPC 没有持有状态，夺走的东西去了哪不记 | L358、L1451；`inventory.ts:83` owner = sheet.id |
| `cash`（resource-changed） | apply cash | 通 | 半：同上，`with` 只是账本上的名字 | L1451、L1829 |
| `definition` / `object` / `usage`（definition-created） | apply define / object / usage | 通 | **缺**：受管实例的 owner 是调查员表 id；NPC 拿不起一件东西 | `inventory.ts:1,83` |
| `threat`（钟走格） | apply threat | 通 | **缺**：只认书上的 threat，临时的钟铸不出来；对两种行动者都缺 | §30.9 |
| `flag`（flag-set） | apply flag | 通 | 半：flag 只被出口条件与图上条件读，书没点名的 flag 没有消费者 | `capsule.ts:615`、`module-graph.ts:109`、L2026 |
| `person`（person-named） | apply person | 通 | **缺**：只给已有的人起名；书上没有的人走 adaptation 子进程 | §79.2；L7383 |
| `time`（time-advanced） | apply time | 通 | — | |
| `clock` | apply clock | — | — | L1237 |
| `note` / `ruling` | apply note / ruling | — | — | KP 记账 |
| `choice`（choice-asked） | ask | 通 | — | |
| `ability`（ability-acquired） | apply ability | 通 | — | |
| `purchase-settled` | apply cash 的购买路径 | 通 | — | `inventory.ts:165` |
| `map`、`worldline`（fork / switch / merge）、`ending` | apply | — | — | |
| `memory-written` / `journal-written` / `dossier-established` | 车道 | — | 半：记忆抽取会跳回合（那桌跳了 6 与 8） | 附录 B |
| **prose（narrate）** | narrate | — | **今天 NPC 行动的唯一落点** | 附录 B |

通 6 行、半 9 行、缺 10 行、无语义 9 行。通的 6 行全是「对玩家做加减法」或「改 NPC 自己的属性」。

## 附录 B　那桌的十三回合

| 回合 | 玩家 | 收据 | 诺特 | 导演 | 备注 |
|---|---|---|---|---|---|
| 0 | （开场） | Appearance、definition×2、person | 「干不干」 | — | |
| 1 | 干吧 | clue×4、handout、cash、item | 「钥匙在这儿」 | CHARACTER | |
| 2 | 我想把他打一顿 | definition | 「打完这单生意就没了」 | PAYOFF | |
| 3 | 打完你我出口气就接 | npc(archetype)、session start、Fighting×3、damage、delta、session end、item、cash | 「钥匙、工钱，我收回」 | PRESSURE | 战斗在一回合内开完又结束 |
| 4 | 我要把钱抢过来 | session start、Fighting×3、damage、delta、cash | 「钱你抢去了。钥匙没有。」 | RECOVER | 第二场战斗 |
| 5 | 继续抢钥匙 | Fighting×2 全空 | 「再伸手，我喊人。」 | SUBSYSTEM / session | advice 选「终止委托收回钥匙」 |
| 6 | 继续揍他 | Fighting×2 全空 | 「别再碰我。」 | 同上 | closed by ask |
| 7 | （fight_back） | Fighting×2 全空 | 「再打，我喊人。」 | 同上 | advice 同一行 |
| 8 | 捂住他的嘴，然后继续打 | Fighting×2 全空 | 「来人——」 | 同上 | 无收据、无记忆、无账本 |
| 9 | （fight_back） | 诺特打中，damage、delta | 「再打，我真喊人了。」 | 同上 | advice 同一行 |
| 10 | 继续打 | 无 | 「你还打？」 | 同上 | admission 60 s 超时，拒绝写进小说 |
| 11 | 我是个大学生…… | 无 | 「你跟我讲游山玩水？」 | 同上 | floor steer；advice 无候选 → 请求重算 |
| 12 | 重新建立人物角色 | 无 | 「打，还是把话说完？」 | 同上 | 验证器 1 条 player_agency；重算后的库 09:16 才到 |

其他读数：验证器回合 5、10 超时 60 s，其余 0 finding；continuity review 回合 8、9 pass，回合 10 revise（已交付不改）；每回合墙钟 18–161 s；诺特 HP 10→4，玩家 12→9；战斗 save 停在 `active`。
