# 人与生物分开：`npc` 是人，`creature` 是身体

Status: ready-for-agent（用户 2026-10-04「按照你的推荐来做吧，做一个敌对生物优化mod」）

契约落点：`docs/kernel-rpc.md` §180（本切片新开；§178 已被进行中的 presence-impression 切片占用，§179 是 cache-traffic）。工单见 [creature-kind-tickets.md](creature-kind-tickets.md)，模组库调查见 [creature-kind-survey.md](creature-kind-survey.md)。

修订记录：

- 2026-10-04 初稿。
- 同日，按用户要求通读全部模组后改写 D1、D3–D6、D15、D17：弱点从「一条线索揭示生物」改为「一条带手段的弱点，由一个结论承载获取途径」。
- 同日，用户要求做成「敌对生物优化 Mod」，并把 KP 临场引入的动物并进来：新增 D18–D20。形状以契约 §180 为准，本文只记理由。

## 意图检查

- **用户想达成**：动物和怪物不再被各类 NPC 功能当成人处理。这些功能包括声线、外号、揭名记号、社交检定、性格、日志、记忆和初见。怪物要有书里写的习性和弱点，玩家能在游戏里查到弱点、拿到对付它的手段。
- **成功是**：
  - 新开一局 the-haunting 进地下室，老鼠以 creature 身份出现在 KP 面前，带着书里写的习性，没有外号、揭名记号、社交检定、性格工单或声线。能和它们打，它们按书里写的习性溃散。
  - KP 面前 Corbitt 那一行能看到这条链：
    - 他的弱点（他自己的匕首）；
    - 要什么手段（那把匕首现在在哪、在谁手里）；
    - 从哪个结论得知（三条支持线索找到了几条，还缺的在哪）。
  - 玩家找到线索、拿到匕首后，这条链跟着变。
- **空心交付是**：
  - 只迁数据。老鼠反而会在建战役时带着人类字段提前入场，见下文「只迁数据会更糟」。
  - 在提示词里叫 KP 别给老鼠起名。
  - 给 creature 加了字段，却没有投影到 KP 面前。
  - 弱点只是 KP 面前一行字，玩家没有任何途径查到。
  - 测试全绿，却没新开一局去读真实胶囊。

## 问题

用户 2026-10-04 发现：the-haunting 里的「老鼠群」同时挂了 `npc-rat-pack` 和 `creature-rat-pack` 两个节点。`ModuleGraph.actor()` 同名时 npc 优先（`kernel-ts/read/module-graph.ts:797`，§136.12 的原文明说「the haunting has `npc-rat-pack` and `creature-rat-pack`」），所以老鼠被当成了人。

### 这不是一处数据错，是三个系统缺口

1. **界线没有定义。** `content/modules/module-graph-contract-v3.json` 的 `node_kinds` 只列出 `npc` 和 `creature` 两个名字，没有释义。读者提示词（`content/setup/visual-reader.md`）也没说怪物该归哪一类。唯一相关的一句在 `actor_dossier.why`：「A stat block is not a person (contract §17.2)」。
2. **两个手写起始包是旧限制的遗留。**
   - §136.12 之前，内核只从 `npc` 节点读数据卡，creature 引擎看不见（`docs/specs/rules-as-data.md:20`），所以起始包把老鼠复制成了 npc。§136.12 让带数据卡的 creature 也成了 actor，但为了「已发货模组行为不变」保留了 npc 优先，数据没迁。
   - the-haunting 的两半是错开的：数据卡和人物档案在 `npc-rat-pack` 上，可它没有 `present-in`；`present-in scene-basement-rites` 在 `creature-rat-pack` 上，可它没有数据卡，不算 actor。所以起始包从来不会把老鼠放进场，只有 KP 调 `apply npc "Rat Pack"` 时才出现，一出现就按人处理。
   - the-haunting-rulebook 的 `creature-rat-pack` 把数值平铺在 properties 里，引擎读不到，这群老鼠打不了。
   - mystery-house 的 `npc-rat-swarm` 和 `npc-chapel-familiar` 只有 npc 版本。npc 记录格式逼着使魔填了 `social_role`、`chain_of_command`、`lie_options`。
3. **内核分人和身体，靠的是调了哪个查找函数，而不是这个功能需要什么。**
   - 只认 `npc` 的人类功能（声线、外号、日志、记忆、名字、首见、`apply person`），把节点改成 creature 就能躲开。
   - 走 `npcsPresent` 的人类功能（`kernel-ts/read/capsule.ts:384`，内部是 `actor()`）照样落到带数据卡的 creature 上：
     - present[] 里的 `untold` 块和 `say_name`；
     - 社交检定与心理学观察选项（`kernel-ts/runtime/check-catalog.ts:199`）；
     - NPC 主动行动的 `coercion` 方式和性格作者；
     - 表情卡名册；
     - `npc.job`：它用 actor 列人，但 `npc.submit` 只认 npc（`kernel-ts/npc/index.ts:91`），于是 creature 会拿到一张永远交不掉的工单。
   - 反过来，几个身体功能只认 npc，会漏掉 creature：理智目击去重（`kernel-ts/sanity/index.ts:100`）、战斗标签（`kernel-ts/read/session-view.ts:32`）、急救对象（`kernel-ts/healing/patient.ts:43`）。
   - KP 模组简报只列 `people: roster(["npc"])`（`kernel-ts/read/capsule.ts:890`），没有 creature 名册。

### 弱点今天到不了玩家

调查细节见 [survey](creature-kind-survey.md)。

- 读者读出来的弱点被塞进 `keeper_note`，和其他规则混在一起（Masks 第 8 代的木乃伊、幼虫）。没有任何线索或结论指向它们，所以弱点只是 KP 的私人笔记。
- PDF 导入的模组里没有一个任务节点。

### 书里写了什么

- **老鼠**：the-haunting 原文第 445 页只写了用 Overwhelm 围攻单个调查员、死一只其余就逃。起始包 npc 记录里的 `fear: "Fire and open flame…"`、`agenda`、`secret` 书里都没有，记录却标着 `origin: "source"`。
- **Corbitt**：原文写了他的弱点和获取途径：Vittorio 的经文谜语（第 451 页），地下室的匕首（第 456–457 页），用他自己的匕首能让他化灰（第 461 页）。起始包已经把这些建成了结论和三条线索，只是没连到 Corbitt 身上。

### 只迁数据会更糟

如果只把数据卡搬到 `creature-rat-pack`：它会变成 actor，`sceneNpcIds` 在建战役时就把老鼠写进 `npc_presence`。于是老鼠一入场，present[] 里就带着 `say_name`，社交检定照开，`npc.job` 陷入死循环。所以顺序必须是先改内核，再迁数据。

### 线上状况

真实读者已经按「能不能当人打交道」来分：Masks 第 8 代里，木乃伊、蛆之父、幼虫是 creature，会说话的 kharisiri 征服者是 npc。只有 the-haunting 这一处存在双胞胎。85 个本地战役里，没有任何老鼠的外号、日志、声线或账本记录，所以没有脏数据要清。

## 用户裁定（2026-10-04）

1. 动物和怪物要和 npc 分开，以免 NPC 功能误用到怪物身上。
2. creature 加上习性；很多怪物有弱点，玩家能通过任务获取弱点。
3. 按推荐的顺序做：先写 spec，再改内核，最后迁数据。
4. `npc-chapel-familiar` 归 creature。
5. 「我有那么多模组，你去看看」：弱点的设计以模组库调查为准。
6. 「按照你的推荐来做吧，做一个敌对生物优化mod，包括之前我们讨论的」，KP 临场引入动物的缺口「这个也加入」。
7. 关于任务：按推荐，本切片不让读者产出任务节点（D17）。

## 设计决定

### D1 界线：按这次遭遇怎么写来分，不按物种分

- **`npc`** 是 KP 要当「一个人」来演的对象：书给了调查员把它当人打交道的途径（交谈、讲价、说服、把它劝住、叫出它的名字），它有名字可以打听到，它有自己的动机。哪怕它是怪物，也算 npc。
  - 例子：Fenalik、Jigsaw Prince、Fynche 的幽灵、Danforth、被俘的米·戈、Kakakatak。
- **`creature`** 是只以身体出现的对象：动物、群体、无心智的怪物，以及有心智却从不打交道的东西。
  - 例子：从不谈判的 Lloigor，成群狩猎的 Tehihan。
- **同一个种族在同一本书里可以两种都有。** de Mendoza 是 npc，野化的 kharisiri 是 creature。所以分的是书里的这一次遭遇，不是物种。
- **三种特殊情况**：
  - 不同生命阶段若各有数据，就是各自的节点；
  - 宿主是人，寄生体有自己的身体和数据时是另一个 creature 节点；
  - 人形与怪形交替的是一个 npc。

判断归读者（模型）。内核只读 `node_kind`，不写物种表，不做关键词判断（Agents.md「语义问题不许硬编码」）。不说话的人仍是 npc，靠已有的 `does_not_speak` 处理（§40）。

### D2 两个判断，每个消费端按功能选

- `graph.isPerson(node)`：`node_kind === "npc"`，书里的人和桌上铸造的人都算。
- `graph.isActor(node)`：不变，指 npc 或带 `mechanics.profile` 的 creature。

`npcsPresent` 继续列出在场的 actor，因为 KP 必须知道老鼠在场。人类功能在它之后按 `isPerson` 过滤。逐个消费端的归属见工单 CK-02 的表。

### D3 creature 的习性：`habits`

契约 JSON 新增 `creature_dossier` 块，与 `actor_dossier` 并列，没有核心键。`habits` 由 Mod 作为 creature 词汇贡献（D18，§180.8）。

`habits` 写书里描述的它怎么活动：住在哪、怎么捕猎或攻击、什么时候逃、被什么吸引。一行或几行。

书里没写就缺席，绝不编造（记账律）。没有核心键，所以不设 `creatures_without_material` 量度（§28.5 量度只数核心键）。

### D4 弱点：带手段的条目，两种 actor 都能有

有心智的怪物也有弱点（Corbitt、Fenalik），所以 `weaknesses` 同时进 `actor_dossier` 和 `creature_dossier`。它不是一行字，而是一组条目：

```json
"weaknesses": [{
  "book": "Struck with his own ritual dagger, his wards fail and he turns to ash and dust.",
  "needs": ["artifact-corbitt-ritual-dagger"],
  "learned_by": "conclusion-own-dagger-ends-corbitt"
}]
```

- **`book`**（必有）：书里怎么说的，一行英文。写清什么能伤它、驱退它、束缚它、放逐它或终结它，连同条件和程度。
  - 程度的例子：「日光每小时一颗惩罚骰，三小时后溶解；刚转化的不受影响」。
  - 抗性也写在这里：「只有火、魔法、电能伤它；枪械与普通近战无效」。
- **`needs`**（可缺）：书里点名的手段，以节点 id 列出。种类可以是：
  - 物件、宝物、法术、典籍；
  - 地点或场景；
  - 必须到场的人，比如 Cael 必须亲自主持仪式；
  - 控制者，比如 Unwen 一死，它就死。
  - 同一样手段可以出现在许多生物的条目里（逆转法术对付九具复活尸）。
- **`learned_by`**（可缺）：调查员能推出这条弱点的那个**结论**节点，见 D5。书里没安排获取途径就不写。这种弱点只有 KP 知道，调查员只能在遭遇中试出来。调查显示这是最常见的一种，属于玩法，不是缺陷。

这是属性里引用节点 id 的类型形状，与义务形状（`properties.obligation` 里的 `scene`、`who`、`guards`）同一先例：校验器检查每个 id 存在、种类在允许集合内。书里没写就缺席，绝不编造。

### D5 可获取的弱点由一个结论承载：复用整套调查机制

`learned_by` 指向的结论就是普通的 `conclusion` 节点，由线索 `supports` 支持，现有机制全部照用：

- **KP 的线索脉络**（`kernel-ts/read/thread.ts:33`）会列出还缺哪条支持线索、在这里还是在邻近场景。
- **故事评估**（`kernel-ts/read/story.ts:20`）可以把它当作未结的线索链。
- **任务**照现有方式 `may-lead-to` 线索或结论。
- **假线索**用已有的 `clue --contradicts--> conclusion`，故事评估已经读它。如果一条假弱点没有对应的真结论（民俗说银能对付食尸鬼，其实没用），用已有的 `clue --misleads--> actor`，KP 那一行列为 `false_leads`。

选结论而不是新造关系，因为调查显示书里安排的获取途径几乎都是「几条证词、手卡、检定合起来推出一件事」。这正是结论加支持线索的形状，三线索原则的工具已经在那里。the-haunting 起始包就是这样建 Corbitt 的匕首的。

**已有缺陷，不在本切片修**：`mainLineComplete`（`kernel-ts/read/director.ts:77`）把「任何一个结论的支持线索全部找到」当成主线完成。the-haunting 本来就有 6 个结论，弱点结论会让它更容易误报。需要按结论重要性或主线标记收窄。已另开工单。

### D6 KP 面前的链，以及他怎么据它行动（契约 §31 的三端）

- **谁写它**：读者从书里写。起始包手写。
- **谁读它**：actor 那一行的 `weaknesses` 投影成一条链：

  ```json
  "weaknesses": [{"book": "…",
    "needs": [{"name": "the ritual dagger", "kind": "artifact", "held_by": "the investigators"}],
    "learned_by": {"conclusion": "…", "found": 1, "of": 3}}]
  ```

  - 手段的当前状态用现有读数：物件归属用 `objectOwner`、`rootObjectOwner`；法术看谁已学会、哪本典籍能学；地点和人只给名字。
  - 结论的进度用已发现的线索数，与线索脉络同一读法。
  - present[] 有预算，条目要短；完整内容在 `npc.read` 一类的单人读数里。
- **谁据它行动**：KP 裁定利用弱点，走已有路径：
  - 规则内的奖励骰或惩罚骰；
  - `apply npc` 的 `disposition`、`action`、`conditions`；
  - 伤害；
  - 交付线索与物件。
- 本切片不新增免疫或易伤的引擎机制，见 D17。offer 账把 creature 行和 present 行一样计数，只计数，不催促。

### D7 `apply npc` 用在 creature 上

- **身体类变体照收**：`to`、`stance`、`dead`、`conditions`、`defense`、`action`、`disposition`、`intends`/`outcome`、`spend_turn`。
- **人类变体拒绝**，`fix` 指向身体类的替代写法：
  - `mood`：一行感受，消费端是下一句台词；
  - `reunion`；
  - `walk_on` 不带 `creature`：那样铸出来的是桌上的人（临场生物见 D19）；
  - `apply person`：给的是称呼或外号。
- 宿主专用的 `_draws`、`_produces` 也不对 creature 开放，见 D8。

### D8 NPC 主动行动

creature 照样能行动。可用方式：`attack`、`flee`、`first_blow`、`pursue`、`check`、`clock`、`stance`、`leave`、`intention_only`。

- **不提供**：`coercion`、`walk_on`；赌注骰的 `_draws`、`_produces` 也不对 creature 开放。
- **行动作者**（§143.2）对 creature 读 `habits`，不读性格。
- **`npc.job`**（性格作者）只列人。

### D9 检定选项

- `social:adjudicate-difficulty` 和 `psychology:observe-concealed` 只对人提供。
- `core-check:opposed-check` 继续对 actor 提供（比如拼力量）。

### D10 只对人的功能

下面这些都只对人：

- 外号、未告知块、`say_name`、`untoldRoster`；
- 日志、记忆、声线；
- 首见、初见；
- 表情卡名册；
- 台词说话人：台词片段点到 creature 时，按现有「点不到人就当标签」处理；
- 承诺付款方、现金交易对方；
- 义务的 `who` 与 `people` 守卫。

其中大部分本来就只认 npc，这次只需过滤走 `npcsPresent` 的那几处。

### D11 原来只认 npc、实际是身体的功能改为认 actor

理智目击去重、战斗标签、急救对象、收据的 `npc` 标记、资源效果。每处在实现时逐一确认语义，写进 §180 的表里。

### D12 一个东西只有一个节点

- 读者的校验器拒绝同一份草稿里 npc 与 creature 同名或同 handle（按图谱自己的名字归一规则）。
- 起始包测试断言发货的起始包里没有双胞胎。
- **运行时加载图谱不拒绝。** 战役是编译快照，旧 the-haunting 战役还带着双胞胎；`actor()` 的 npc 优先保留下来，契约里写明它只用于旧快照的裁决。

### D13 读者

- `visual-reader.md` 写入 D1 的界线（按遭遇分）、`habits`、`weaknesses` 的形状与记账律、`learned_by` 结论的写法，以及 `contradicts`/`misleads` 怎么写假线索。
  - 明确要求：数据卡上的抗性写进 `weaknesses` 的 `book`，不再塞进 `keeper_note`。
- `task.vocabulary` 带上 `creature_dossier`。
- 校验器：
  - `needs` 和 `learned_by` 的 id 必须存在，且种类在允许集合内；
  - `misleads` 的两端必须是 `clue` → `npc`/`creature`。
- 复核的 coverage 把书里写明的习性、弱点及其获取途径算作应覆盖的材料。
- `reading.ts:671` 按需补读对 creature 照读，读书本身不分人和身体，保持不变。

### D14 与并发切片的协调

- **§178 presence-impression**（`chatrpgv4-wt-presence-impression`，未提交）在人物照面时自动掷初见。照面的对象必须只算人。两边谁后合并，谁负责带上 `isPerson` 过滤。
- **§177 module-cast**（`claude/module-cast-20261004`）是名表，只应收人。合并时核对它的选择器。

### D15 数据迁移（内核合入之后）

- **the-haunting**：
  - 删除 `npc-rat-pack` 及其 claims、relations 和 npc-agendas 投影记录；
  - 数据卡和武器挪到 `creature-rat-pack` 的 `mechanics.profile`；
  - 加 `combat.disposition: fights_then_flees`；
  - `habits` 只写书里的原意（藏在墙板后的爬行空间，用 Overwhelm 围攻一人，死一只其余就逃）；
  - 编造的 fear、secret、agenda、voice 全部丢弃；
  - `present-in scene-basement-rites` 保留；
  - **Corbitt 加 `weaknesses`**，这是真书里的垂直样例，内容全部来自原书：
    1. `book` 写「用他自己的仪式匕首刺中，护盾失效，化为灰烬」，`needs: [artifact-corbitt-ritual-dagger]`，`learned_by: conclusion-own-dagger-ends-corbitt`；
    2. 日光会伤他、也许致命，原书说由 KP 决定，只写 `book`。
  - 重新盖 guidance 包的 `graph_sha256`。
- **the-haunting-rulebook**：`creature-rat-pack` 的平铺数值改成带类型的 `mechanics.profile`，加 `combat` 和 `habits`。
- **mystery-house**：
  - `npc-rat-swarm` 改为 `creature-rat-swarm`，`npc-chapel-familiar` 改为 `creature-chapel-familiar`。id 前缀必须跟种类一致（`node_id_law`）；handle 不变。
  - 不再给使魔加薄样例，D5 的整条链由 the-haunting 的真书样例覆盖。
- 改测试中钉住 `npc-rat-pack` 的几处：`tests/kernel/test_starters.py`、`tests/extension/mechanics-readers.test.mjs:190`、`mechanics-shape.test.mjs`、`haunting-shapes.test.mjs`。

### D16 已有战役

战役是编译快照，不受影响，也无需清理。

### D17 本切片不做，另开工单（needs-triage）

- **读者产出任务。** 调查里书写成「追求目标」的弱点手段约 30 处，但 PDF 导入的模组里一个任务节点都没有。按推荐（用户 2026-10-04 认可）：本切片让弱点、手段、结论到达 KP，由 KP 在故事里提出任务；读者产出任务属于「导入模组没有导演信号」那个更大的缺口，另开切片。
- **带类型的抗性与弱点机制。** 免疫、减半、贯穿最小伤害、只算头部伤害、只被某物伤害，调查里约 40 个生物，现在只能由 KP 手动裁定伤害。规则当数据（§136）的下一块。
- **`mainLineComplete` 的误报**，见 D5，已另开任务卡。

### D18 拆成基础层与「敌对生物」Mod（§180.1）

用户要的是一个 Mod。照 §179.1 同一个分法（用户同日裁定「翻看物品属于基础系统，NPC 对玩家意图的分析属于自然 NPC 行为 Mod 的增强项」）：

- **基础层（内核，不随开关）**：
  - 界线（D1）与人类功能只对人（D2、D7–D11）；
  - creature 的在场行与简报名册；
  - 临场生物（D19）；
  - 一物一节点（D12）；
  - 起始包的种类修正。
  - 理由：「老鼠不该有外号」是正确性规则，关掉 Mod 不能退回去。
- **`hostile-creatures` Mod 1.0.0（默认开启）**：
  - `habits` 词汇（§28 的 creature 版）；
  - 弱点形状与弱点链（内核能力 `actor.weaknesses.v1`，Mod 依赖它）；
  - 两者的桌上补记（§28.7 的门）；
  - KP 指令；
  - the-haunting 里 Corbitt 的弱点数据。
  - 词汇在构建时绑定（§28.2）。已读出的词在 Mod 关闭后仍到达桌面（§28.5）；桌上补记的随 Mod 关闭消失（§28.7）。

### D19 KP 临场引入的动物是 creature（§180.6）

- **怎么声明**：`apply npc {name, walk_on: true, creature: "<规则目录里的生物>"}`。`creature: true` 表示还没有数据卡。哪个条目合适由 KP 判断，内核不做词到条目的映射。
- **怎么记录**：记在 `world.table_creatures`，永远不进 `world.table_people`，所以任何人类功能都碰不到它。
- **数据卡**：从目录条目来。书给了掷骰式（`2D6×5`）就用回合的种子骰掷，否则用平均值；钉在 `world.npc_profiles`，于是它能战斗。之后也可以给没有数据卡的生物补钉。
- **野兽目录**：现有规则目录只有 37 种神话生物，没有狗、马、狼。规则书第 14 章「野兽」一节（PDF 第 347 页起）有带掷骰式的数据卡，照录成 `beasts.json`，逐项标页码，书里没印的写 `_unstated`。

### D20 Mod 的提醒只在有生物时出现（§180.10）

- **为什么**：每回合所有 Mod 的提醒共用 5000 字节上限，现在已用到 4999，新加一句就超。
- **怎么做**：照 §153.4 限定语言 Mod 的先例，新能力 `context.creature.v1` 让 Mod 的指令只在场上有生物的回合出现。第一次出现带全文，之后带提醒；提醒按自己的 400 字节单独计，不计入共享上限。没有生物的回合一个字节都不占。

## 验收

1. **盒子上跑全量**：`test:ext` 与 pytest，按 leehow-pc-tests skill 优先用 amax。新增用例要能被变异测试杀死，夹具用自造的图（带数据卡的 creature 在场，一个带 `weaknesses` 的人），不靠发货的起始包。
2. **真产品路径**：新开一局 the-haunting 战役，读三次真实胶囊，核对 present[] 的老鼠行、简报的 creature 名册、Corbitt 行的弱点链；再临场声明一条看门狗（`creature: "Dog"`），读它的行和钉住的数据卡：
   - 开局；
   - 发现一条匕首线索之后；
   - 调查员拿到匕首之后。
3. **真桌**：按 Agents.md 的方法，用 `tests/play/driver.py` 起当期默认的 KP 模型，我当唯一玩家，从开局跑到地下室：找线索、拿匕首、和老鼠打一场、对上 Corbitt。开桌前把结局预先写死：
   - present[] 的老鼠行是 `kind: creature`，没有 `untold`、`say_name`、`called`、`now`、`personality`；
   - 外号、声线、性格作者的工单从不列出 rat-pack；
   - 检定选项里没有针对老鼠的社交或心理学检定；
   - 战斗用的是老鼠的数据卡（Overwhelm 2D6），死一只后它们按 disposition 逃散；
   - 日志里没有老鼠条目；
   - Corbitt 行的弱点链随线索和匕首的获取而变化；KP 用匕首结算时走已有路径并留下收据；
   - §178 已合入的话，照面时不对老鼠掷初见。

## Comments
