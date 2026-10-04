# 人与生物分开：`npc` 是人，`creature` 是身体

Status: draft（等用户评审；评审过改 `ready-for-agent`）

契约落点：`docs/kernel-rpc.md` §180（本切片新开；§178 已被进行中的 presence-impression 切片占用，§179 是 cache-traffic）。工单见 [creature-kind-tickets.md](creature-kind-tickets.md)。

## 意图检查

- **用户想达成**：动物和怪物不再被各类 NPC 功能当成人处理。这些功能包括声线、外号、揭名记号、社交检定、性格、日志、记忆和初见。怪物要有书里写的习性和弱点，玩家能通过线索或任务查到弱点。
- **成功是**：
  - 新开一局 the-haunting 进地下室，老鼠以 creature 身份出现在 KP 面前，带着书里写的习性，没有外号、揭名记号、社交检定、性格工单或声线。
  - 能和它们打，它们按书里写的习性溃散。
  - 一个写了弱点线索的模组里，KP 面前那一行能看到这条链：弱点、从哪条线索得知、调查员知道了没有。玩家拿到那条线索后标为已知，任务照现有方式计进度。
- **空心交付是**：
  - 只迁数据。老鼠反而会在建战役时带着人类字段提前入场，见下文「只迁数据会更糟」。
  - 在提示词里叫 KP 别给老鼠起名。
  - 给 creature 加了字段，却没有投影到 KP 面前。
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

### 书里写了什么

the-haunting 原文第 445 页写了老鼠两点：一是用 Overwhelm 围攻单个调查员；二是「Once one rat has been killed, those remaining will flee」，以及「a successful attack … usually chases away the rest of that pack」。

起始包 npc 记录里的 `fear: "Fire and open flame…"`、`agenda`、`secret` 书里都没有，记录却标着 `origin: "source"`。迁移时这些编造的内容不能带过去。

### 只迁数据会更糟

如果只把数据卡搬到 `creature-rat-pack`：它会变成 actor，`sceneNpcIds` 在建战役时就把老鼠写进 `npc_presence`。于是老鼠一入场，present[] 里就带着 `say_name`，社交检定照开，`npc.job` 陷入死循环。所以顺序必须是先改内核，再迁数据。

### 线上状况

真实读者已经按「能不能当人打交道」来分：Masks 第 8 代里，木乃伊、蛆之父、幼虫是 creature，会说话的 kharisiri 征服者是 npc。只有 the-haunting 这一处存在双胞胎。85 个本地战役里，没有任何老鼠的外号、日志、声线或账本记录，所以没有脏数据要清。

## 用户裁定（2026-10-04）

1. 动物和怪物要和 npc 分开，以免 NPC 功能误用到怪物身上。
2. creature 加上习性；很多怪物有弱点，玩家能通过任务获取弱点。
3. 按推荐的顺序做：先写 spec，再改内核，最后迁数据。
4. `npc-chapel-familiar` 归 creature。

## 设计决定

### D1 界线

- **`npc`** 是 KP 要当「一个人」来演的对象：调查员能和它打交道，它有名字可以打听到，它有自己的动机。
- **`creature`** 是只有身体和习性的对象：动物、群体、无心智的怪物，那些会行动、却不能当人来打交道的东西。

判断归读者（模型）。读者按书怎样对待它来定 `node_kind`；内核只读 `node_kind`，不写物种表，不做关键词判断（Agents.md「语义问题不许硬编码」）。

两个边界情况：

- 有心智的怪物（Corbitt、来交涉的深潜者）是 npc，带数据卡。人类功能用在它们身上是对的。
- 不说话的人仍是 npc，靠已有的 `does_not_speak` 处理（§40）。

### D2 两个判断，每个消费端按功能选

- `graph.isPerson(node)`：`node_kind === "npc"`，书里的人和桌上铸造的人都算。
- `graph.isActor(node)`：不变，指 npc 或带 `mechanics.profile` 的 creature。

`npcsPresent` 继续列出在场的 actor，因为 KP 必须知道老鼠在场。人类功能在它之后按 `isPerson` 过滤。逐个消费端的归属见工单 CK-02 的表。

### D3 creature 的档案：`habits` 与 `weaknesses`

契约 JSON 新增 `creature_dossier` 块，与 `actor_dossier` 并列，同样只用已有词汇：

- **`habits`**：书里写的它怎么活动。住在哪、怎么捕猎或攻击、什么时候逃。一行或几行。
- **`weaknesses`**：书里写的什么能伤它、驱退它、束缚它或消灭它。若干行。

书里没写就缺席，绝不编造（记账律，同 `actor_dossier.law`）。缺这两项的 creature 用 `creatures_without_material` 量度报出来，不判失败。

### D4 `weaknesses` 两种 actor 都能有

有心智的怪物也有弱点。如果只给 creature 开这个字段，读者为了记下弱点，会把有心智的怪物错归成 creature，激励方向就反了。所以 `weaknesses` 同时加进 `actor_dossier.profile_keys`；`habits` 只属于 creature，人有 `agenda`。

### D5 弱点通过现有线索链获取，不造平行机制

- **怎么表示一条可获取的弱点**：一个 `clue` 节点，它的命题陈述这条弱点；再加一条关系 `clue --reveals--> actor`。`reveals` 已在 `relation_kinds` 里，内核目前零消费者，不新增词汇。
- **怎么被发现**：完全走现有线索路径，即 `discoverable-at`、`knows`、`delivery_kind`，结果写入 `world.discovered_clues`。
- **任务怎么接**：照现有方式，`quest --supports/may-lead-to--> clue`，由 `questObligations` 计进度（`kernel-ts/read/pressures.ts:165`）。

KP 面前的那一行（creature 行，以及带弱点的 npc 行）多一个 `learned_from`：

```json
"learned_from": [{"clue": "<handle>", "discovered": false, "at": "<scene display name>", "from": "<who knows it>"}]
```

这是「给 KP 链条，不是更多面板」：弱点、从哪条线索得知、在哪拿、谁知道、调查员拿到没有，全在同一行。

**为什么不让弱点条目直接引用线索 id**：属性里引用列表中的某一条，就成了读者要编写、校验器要验证的身份（义务句柄那次的教训）。线索自己的命题已经说清是哪条弱点，KP 读得懂。

### D6 KP 怎么据它行动（契约 §31 的第三端）

利用弱点由 KP 裁定，走已有路径：

- 规则内的奖励骰或惩罚骰；
- `apply npc` 的 `disposition`、`action`（比如溃逃），或 `conditions`；
- 伤害。

本切片不新增免疫或易伤的引擎机制。只有真桌证明确实需要时，才另开带类型的形状。offer 账把 creature 行和 present 行一样计数，只计数，不催促。

### D7 `apply npc` 用在 creature 上

- **身体类变体照收**：`to`、`stance`、`dead`、`conditions`、`defense`、`action`、`disposition`、`intends`/`outcome`、`spend_turn`。
- **人类变体拒绝**，`fix` 指向身体类的替代写法：
  - `mood`：一行感受，消费端是下一句台词；
  - `reunion`；
  - `walk_on` 铸造：铸出来的是桌上的人；
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

- `visual-reader.md` 写入 D1 的界线、D3/D4 的档案键、D5 的 `reveals` 写法，以及记账律。
- `task.vocabulary` 带上 `creature_dossier`。
- 校验器只接受从 `clue` 指向 `npc` 或 `creature` 的 `reveals`。
- 复核的 coverage 把书里写明的习性和弱点算作应覆盖的材料。
- `reading.ts:671` 按需补读对 creature 照读，读书本身不分人和身体，保持不变。

### D14 与并发切片的协调

- **§178 presence-impression**（`chatrpgv4-wt-presence-impression`，未提交）在人物照面时自动掷初见。照面的对象必须只算人。两边谁后合并，谁负责带上 `isPerson` 过滤。
- **§177 module-cast**（`claude/module-cast-20261004`）是名表，只应收人。合并时核对它的选择器。

### D15 数据迁移（内核合入之后）

- **the-haunting**：
  - 删除 `npc-rat-pack` 及其 claims、relations 和 npc-agendas 投影记录；
  - 数据卡和武器挪到 `creature-rat-pack` 的 `mechanics.profile`；
  - 加 `combat.disposition: fights_then_flees`（书上写了，死一只就逃）；
  - `habits` 只写书里的原句；
  - `weaknesses` 不写，书里没有；
  - 编造的 fear、secret、agenda、voice 全部丢弃；
  - `present-in scene-basement-rites` 保留；习性里写明它们藏在墙板后的爬行空间；
  - 重新盖 guidance 包的 `graph_sha256`。
- **the-haunting-rulebook**：`creature-rat-pack` 的平铺数值改成带类型的 `mechanics.profile`，加 `combat` 和 `habits`。
- **mystery-house**：
  - `npc-rat-swarm` 改为 `creature-rat-swarm`，`npc-chapel-familiar` 改为 `creature-chapel-familiar`。id 前缀必须跟种类一致（`node_id_law`）；handle 不变。
  - 使魔是作者手写的规则练习模组（`origin: authored-gym`），可以带一条标明的薄样例：作者写的 `fear` 转成 `weaknesses`，再配一条 `reveals` 它的线索和一个指向该线索的任务。这条样例用来跑通 D5 的整条链。按 Agents.md「修补先看全局」第 4 条，只在系统路径通了之后才加。
- 改测试中钉住 `npc-rat-pack` 的几处：`tests/kernel/test_starters.py`、`tests/extension/mechanics-readers.test.mjs:190`、`mechanics-shape.test.mjs`、`haunting-shapes.test.mjs`。

### D16 已有战役

战役是编译快照，不受影响，也无需清理。

### D17 本切片不做，另开工单（needs-triage）

- **KP 临场引入的动物会被铸成「桌上的人」。** `apply npc walk_on` 走的是 `establishPerson`，比如一条看门狗会吃到所有人类功能。修法可能是 walk-on 带上 creature 种类，并从规则目录的生物条目继承数据卡（`runtime_rule_ref: "coc7 rat pack"` 已经指向那里）。开不开要用户拍板。
- **带类型的弱点机制**：免疫、易伤、只能被某物伤害。
- **规则目录生物条目的继承**（`extends`）。

## 验收

1. **盒子上跑全量**：`test:ext` 与 pytest，按 leehow-pc-tests skill 优先用 amax。新增用例要能被变异测试杀死，夹具用自造的图（带数据卡的 creature 在场），不靠发货的起始包。
2. **真产品路径**：新开一局 the-haunting 战役，读地下室的真实胶囊，检查 present[] 里的老鼠行和简报的 creature 名册。新开一局 mystery-house，让线索被发现，前后各读一次 `learned_from` 与任务进度。
3. **真桌**：按 Agents.md 的方法，用 `tests/play/driver.py` 起当期默认的 KP 模型，我当唯一玩家，进地下室和老鼠打一场，15 到 20 回合。开桌前把结局预先写死：
   - present[] 的老鼠行是 `kind: creature`，没有 `untold`、`say_name`、`called`、`now`、`personality`；
   - 外号、声线、性格作者的工单从不列出 rat-pack；
   - 检定选项里没有针对老鼠的社交或心理学检定；
   - 战斗用的是老鼠的数据卡（Overwhelm 2D6），死一只后它们按 disposition 逃散；
   - 日志里没有老鼠条目；
   - §178 已合入的话，照面时不对老鼠掷初见。

## Comments
