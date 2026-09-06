# 词表

票 #12（`gh issue view 12`）的补充说明点了六个缺口词：回合胶囊、行动声明、效果批、待决、车道、模组存储——词表一直没写下来，每个新 worker 都得从契约里重新猜一遍，猜法还不一样。这份文件把 pi-coc 0.9.0a 用到的领域词汇钉一遍。

**读法**：每条词的粗体标题是**代码与契约里实际使用的英文标识符**（系统语言是英文，见 `Agents.md` 与契约 §16.1），括号里是它对应的中文说法，仅供本文行文使用，不是另一套要维护的词表。定义之后是产生方/消费方/契约小节/代码位置；最后一行 `不是：`钉住最容易混的近义概念。

只收契约或代码里真实存在的词；不新造词，也不把旧树（`0.8.2a`）的概念当作 0.9.0a 的词汇——旧树的东西只在文末「退役词」一节点名。每条的章节号与文件路径都用 `grep` 核对过。

## 六个核心词（票 #12 点名的缺口）

**`capsule`（回合胶囊）** — 守秘人每回合动手前拿到的一整包场面：时钟、在场者、未发现线索、Director 建议、压力与待办账目等九节，见不问自取。产生：`table.player_input`、`table.capsule` 返回；`table.narrate`/`table.ask` 关回合时把当回合胶囊存进 `turn.json.capsule`，供事后核算 Director 采纳（§13.7）用。消费：守秘人（`prompts/keeper.md`）；扩展把它包成 `customType: "coc-capsule"`、`display: false` 的宿主消息注入（契约 §8、§13.9）。契约 §6、§12.7、§13.1（形状与预算）。代码：`kernel/coc/capsule.py` 的 `build_capsule`。
不是：`look`/`lookup` 的结果——那是守秘人主动查询时才有的补充信息（字段和胶囊的 `where`/`present`/`known` 有重叠，但目的相反：胶囊是「不用查就有」，`look`/`lookup` 是「胶囊里没有才查」，§13.8 的工具描述明写了这条边界）。

**`action`（行动声明）** — 守秘人调 `resolve` 时描述「这一步想干什么」的输入对象：`intent`/`goal`/`method`/`target`/`stakes`/`skill`……契约里管这叫「行动」，代码里字段名就是 `action`，没有专门的类。产生：守秘人；消费：`table.resolve` 的候选选择与槽位填充（§11.3、§11.4）。契约 §5（切片 0 字段）、§11.1（切片 1 补充字段）。代码：`kernel/coc/resolve.py` 的 `SLOT_TO_ACTION`（`action` 字段名到 RuleGraph 槽位名的映射表）；工具 schema 在 `extensions/kernel/tools.ts` 的 `resolve` 工具。
不是：`receipt`/`outcome`——`action` 是守秘人的输入（意图声明），`receipt`/`outcome` 是内核算出来的结果；也不是字面意义上的「declaration」——代码和契约都只叫它 `action`，「行动声明」只是中文行文，不要去找一个叫 `ActionDeclaration` 的类型。

**`effects`（效果批）** — 守秘人调 `apply` 时给的一批要写进世界的效果：`move`/`clue`/`time`/`damage`/`item`/`cash`/`handout`（外加未实现的 `fork`/`switch`/`merge`，见世界线一节）。一批里可以有多条，整批先校验后写，任一条失败整批不落。产生：守秘人；消费：`table.apply` 逐条 stage 后一次性提交（§5）。契约 §5（`table.apply` 参数与流水线）、§14.8（`handout`）、§15.3（世界线三效果，未实现）。代码：`kernel/coc/table.py` 的 `def apply`（约 906 行起，`_stage_move`/`_stage_clue`/`_stage_time`/`_stage_handout` 等）。
不是：`mechanics`（§16.2 的机制投影）——方向相反：`effects` 是守秘人喂给内核的写入指令，`mechanics` 是内核算完之后吐给前端的只读、语言中立投影；一批 `effects` 落地后才会在 `narrate`/`ask` 的结果里出现对应的 `mechanics` 条目。

**`pending_choice`（待决）** — 内核记在 `turn.json` 里的「回合关闭前必须有人回答」的问题：`{name, for: player|keeper, prompt, options}`。`for: player` 的由守秘人下一次 `ask` 交回玩家；`for: keeper` 的由守秘人下一次 `resolve` 的 `decision` 或 `defense` 回答。产生：`table.resolve` 判出待决防御/发作/追逐冲突时，或 `table.ask` 记录时；消费：`table.ask`、下一次 `table.resolve` 的 `action.choice`/`action.decision`/`action.defense`。契约 §11.9（形状定义）、§5 `table.ask`。代码：`kernel/coc/table.py` 的 `_bind_choice`（约 764 行）与 `def ask`（约 1423 行）。
不是：`obligations` 里 `kind: "choice"` 的那一条（契约 §13.2）——那只是胶囊对当前 `pending_choice` 的只读投影/提醒账目，改不了 `pending_choice` 本身，也不是它的另一份存储；也不是「推骰待决」（见下文 `continuations`）——那种待决没有 `pending_choice` 的形状，是结果里单独的 `continuations` 列表。

**`lane`（车道）** — 回合关闭之后跑的异步/后台流程，advisory，不改状态、不拦交付：校验车道（verifier）、记忆抽取车道（memory）、Director 采纳记账（director）、内核自身步骤（kernel）、手卡交付（handout）、模组构建/深读（module）。识别方式是 `telemetry.jsonl` 每行的 `lane` 字段，闭合取值。产生/消费：kernel 扩展（校验、handout）、memory 扩展（抽取）、内核自身（`director`、`kernel` 两个 lane 值）。契约 §12.5、§12.8；`docs/pi-host-contract.md` §3.1（两条车道怎么起）、§3.2（读者子进程，模组构建的车道）。代码：`kernel/coc/warn.py`（校验车道落地）、`kernel/coc/table.py`（`lane: "director"` 约 1545 行、`lane: "kernel"` 约 1571 行）、`extensions/kernel/verifier.ts`、`extensions/memory/index.ts`、`extensions/kernel/index.ts`（`lane: "handout"`）。
不是：Pi 扩展本身（`kernel`/`memory`/`module`/`onboarding`/`table` 五个扩展是 Pi 包的加载单元，见 `docs/pi-host-contract.md` §2）——一个扩展内部可以跑不止一条车道（kernel 扩展自己就跑 verifier 车道，也写 handout 车道的遥测行）；车道是扩展内部的一段异步流程或队列，不是加载单元。

**`ModuleStore`（模组存储）** — 工作区里可写、按代际（generation）增长的模组图仓库，`.coc/modules/<module_id>/`；多个战役共享同一个模组条目。产生：`campaign.create`（starter 车道）与 `module.bind`（PDF 车道）首次登记；`module.assemble`/深读接受新分片后代际递增。消费：`Table.graph()` 按当前代际读图；`apply move`、`table.open` 触发的深读入队。契约 §14.1（布局）、§14.11（内核决定）。代码：`kernel/coc/modules/store.py` 的 `class ModuleStore`。
不是：`content/starters/<id>/`——那是仓库内只读的模组源目录；`ModuleStore` 是它在工作区里的可写副本（starter 首次被 `campaign.create` 或 `module.register` 引用时才复制进去，见 §14.1）。也不是 `campaign.json.module_id` 本身——后者只是一个指向 `ModuleStore` 里某条目的名字，不持有图。

## 回合与事务

**`turn`（回合号）** — 从 1 起的整数；开桌那一回合是 `turn 0`，只有开场 `narrate`，没有玩家输入。契约 §2。代码：`kernel/coc/store.py` 的 `fresh_turn(number, ...)`。
不是：`call_id` 里的 `<turn>`——那是同一个数字的复用，但 `call_id` 还带着回合内的调用序号 `<n>`（见下文）。

**turn state（回合状态）** — `turn.json.state` 的闭合取值：`awaiting_player`、`open`、`acting`、`asked`。契约 §4 的状态机图里还画了一个 `committed`，但这是**转场时的瞬时态，从未被持久化**：`narrate` 成功后内核在同一次写入里直接把 `turn.json` 换成下一回合的 `fresh_turn(turn+1)`（默认 `state="awaiting_player"`），代码里搜不到任何地方把 `turn["state"]` 显式赋成字符串 `"committed"`。它描述的是「这一回合已经关闭、有了 `turns/NNNN.json` 记录」这件事，不是一个你能在 `turn.json` 里读到的字符串。契约 §4。代码：`kernel/coc/table.py` 的 `WRITABLE_STATES`（约 57 行）、`PLAYER_INPUT_STATES`（约 58 行）；`kernel/coc/store.py` 的 `fresh_turn`。
不是：`turns/NNNN.json` 里的 `closed_by` 字段（`"narrate"` 或 `"ask"`）——那是回合记录上「谁关的」的标记，和 `turn.json.state` 是两个不同的存储位置；「这一回合 committed 了」应该去查有没有 `turns/NNNN.json`，不要去 `turn.json.state` 里找 `"committed"` 字符串。

**`call_id`（调用号）** — 扩展铸造的调用标识，格式 `t<turn>-c<n>`，`n` 是该回合内会改状态的调用（`resolve`/`apply`/`ask`/`narrate`）的序号，从 1 起；模型永远不写它。契约 §2、§8（铸造规则，进程重开后从 `last_call_ordinal` 之后接着铸）。代码：`kernel/coc/store.py` 的 `parse_call_id`、`CALL_ID` 正则。
不是：`receipt` id——`call_id` 是调用的标识（一次工具调用一个），`receipt` 是这次调用产生的每一条结果的标识（一次调用可能产生多条收据，比如一批 `apply` 效果）。

**`receipt`（收据）** — 内核铸造的、语义化的结果标识，模型不认它的语法只认它的名字（比如 `roll:spot-hidden-t3-c1`）。前缀闭合：`roll:`、`move:`、`clue:`、`time:`、`delta:`、`choice:`、`session:`、`item:`（#19）、`cash:`（#19）、`handout:`（§14.8）；`fork:`/`switch:`/`merge:` 是世界线一节声明但未实现的前缀。契约 §2（铸造语法）、§11.6/§11.11（`roll`/`delta`/`session` 收据）。代码：`kernel/coc/table.py` 各 `_stage_*` 方法；`kernel/coc/resolve.py` 的收据生成。
不是：`event`——每条收据对应 `events.jsonl` 里的一行事件（`data.receipt` 指回它），但收据是「这次调用产生了什么」，事件是「这件事在时间线上被记了一笔」；两者一一对应但不是同一份存储（收据活在 `turn.json.receipts`/`turns/NNNN.json`，事件活在 `events.jsonl`）。

**幂等键（idempotency key）** — 不是一个单独的字段，而是 `call_id` + 参数的规范化 JSON sha256（`params_digest`）这一对：同 `call_id` 同参数摘要返回原结果并带 `"replayed": true`；同 `call_id` 不同参数报 `idempotency_conflict`。契约 §2。代码：`kernel/coc/store.py` 的 `params_digest`、`Campaign.replay_or_conflict`、`Campaign.remember_call`。
不是：收据 id 的语义化命名——收据 id 是给模型看的名字，幂等键是内核内部拿来判「这次调用是不是重复」的哈希，两者互不影响：同一收据 id 不会因为幂等键不同而改变，幂等键也不参与收据命名。

**commit chain（提交链）** — `narrate` 把回合关闭之后接的一串确定性步骤：git 同步提交（ADR-0001）→ 写 `turns/NNNN.json` 记录 → 写续行检查点（§12.2）→ 追加记忆 episode（§12.3）→ 出记忆抽取任务包。三条法则：候选不自动晋升、矛盾不删除只关闭、抽取与校验永不阻塞 `narrate`（契约 §12 前言）。这是契约行文里的说法（§12 标题），不是某个函数名。契约 §12 全节。代码：`kernel/coc/table.py` 的 `def narrate`（约 1470 行，git 提交那步）、`kernel/coc/history.py` 的 `commit`、`kernel/coc/continuation.py`、`kernel/coc/memory.py` 的 `write_episode`/`build_job`。
不是：`table.narrate` 这一次 RPC 调用本身——`narrate` 只负责其中「同步提交」那一步（提交失败整回合不递增，见 `commit_failed`）；检查点写失败、episode 写失败、抽取任务包出不来，都**不撤销**已经成功的提交（§12 前言、§12.6），失败只进遥测与 backlog。

**continuation checkpoint（续行检查点）** — `narrate` 提交成功后写的可重建缓存 `save/continuation/latest.json`：最近一次提交的回合摘要（场景、时钟、队伍、会话、待决、`one_line`）。契约 §12.2。代码：`kernel/coc/continuation.py`（`read_checkpoint`、`write_checkpoint`、`sync_checkpoint`、`rebuild_turn`、`resume_view`）。
不是：`turns/NNNN.json`——检查点是缓存，`turns/` 与 git 提交才是真相；检查点丢了、坏了、落后于 HEAD 都能从回合记录或 HEAD 重建（§12.2、§12.9），`table.open` 每次都会先让检查点跟上 HEAD。

## 七个动词

守秘人只见这七个工具（`docs/pi-host-contract.md` §1「`--no-builtin-tools`」；`extensions/kernel/tools.ts` 逐一 `registerTool`）：

**`look`** — 缺省看当前场景，或按 `focus: scene|npc|investigator|clues|time` 看一个实体的守秘人专属视图。只读，任何回合状态可调。契约 §5。代码：`kernel/coc/table.py` 的 `def look`（约 512 行）。
不是：`lookup`——`look` 看「这里/这个实体现在的状态」，`lookup` 是按名字或问题去模组图/秘密简报里**查**（见下）；也不是胶囊——胶囊已经推送过的内容，工具描述教守秘人不要再 `look`（§13.8）。

**`lookup`** — 按 `kind: module|secret|rule|catalog` 与一句名字/问题去模组图或秘密简报里查；切片 0 只实现 `module`（图上名字/别名/摘要子串匹配）与 `secret`（当前场景或整模组的守秘人专属简报），`rule`/`catalog` 报 `not_implemented`。只读。契约 §5。代码：`kernel/coc/table.py` 的 `def lookup`（约 534 行）。
不是：`recall`——`lookup` 查的是模组的**权威内容**（图上写的是什么），`recall` 查的是**这一局玩出来的历史**（谁说过什么、发生过什么）；两者都不做散文式关键词检索，`lookup` 是子串/别名匹配，`recall memory` 是结构化字段精确匹配（§12.4）。

**`recall`** — 三路只读查询：`transcript`（逐字记录）、`memory`（候选断言）、`history`（事件时间线与前后对照）。切片 0 只有 `transcript`；三路齐全见 §12.4。契约 §5、§12.4。代码：`kernel/coc/recall.py`（`transcript`/`history`）、`kernel/coc/memory.py` 的 `query_candidates`（`memory` 路）。
不是：`lookup secret`——`recall memory` 给的是**候选断言**（可能被超越、可能不准），`lookup secret` 给的是**模组图上的权威真相**；候选断言的 `state` 字段本身就有 `uncertain`/`distorted`，模组秘密没有这个维度。

**`resolve`** — 把一个 `action` 变成一次 RuleGraph 决策的结算：事实字典 → 候选与选择 → 槽位 → 执行 → 收据。切片 0 只做普通检定，切片 1 起接十族规则（战斗/追逐/理智/心理/社交/急救/施法/成长/推骰幸运/合并检定）。契约 §5、§11 全节。代码：`kernel/coc/resolve.py` 的 `class ResolvePipeline`。
不是：`apply`——`resolve` 只算「这次尝试的结果是什么」（掷骰、判定、可能带出的会话状态），不直接写世界状态之外的东西（伤害/理智等 `effects` 会跟着落，但「移动到哪」「拿到了什么线索」这类**由守秘人自己叙述后确认的**世界变化必须走 `apply`）。

**`apply`** — 把一批世界变化（`effects`，见上文）写进世界状态：移动、发现线索、推进时钟、伤害、物品、现金、手卡（世界线三效果已声明未实现）。契约 §5、§14.8、§15.3。代码：`kernel/coc/table.py` 的 `def apply`（约 906 行）。
不是：`resolve` 的 `outcome.effects`——`resolve` 结果里也有一个 `effects` 字段（§11.6，`hp`/`san`/`mp`/`luck`/`condition`/`ammo`/`position` 等资源变化），那是**结算引擎自己算出来并落盘**的效果，不需要再手动 `apply`；`table.apply` 的 `effects` 参数是守秘人**主动声明**的另外几类（move/clue/time/damage/item/cash/handout），两个「effects」同名不同源，读代码时要看是哪个函数的局部变量。

**`ask`** — 用一个问题加编号选项关闭本回合，记录 `pending_choice`，状态进 `asked`；不再调用 `narrate`。契约 §5。代码：`kernel/coc/table.py` 的 `def ask`（约 1423 行）。
不是：`narrate`——两者都能关闭回合，但 `ask` 关出一个待决（下一回合等玩家从选项里选），`narrate` 关出一个完结的叙述；一个回合只能二选一，不能又 `ask` 又 `narrate`。

**`narrate`** — 用守秘人的正文关闭本回合：核对每条公开收据的数字都在正文里出现（§16.3 的「数字核对」，不做语义核对，纯字符串包含），投影 `mechanics`，写回合记录，做一次同步 git 提交，回合进 `awaiting_player`、`turn+1`。契约 §5、§16。代码：`kernel/coc/table.py` 的 `def narrate`（约 1470 行）；`kernel/coc/render.py`（机制投影与数字核对）。
不是：内核「渲染」出的文字——§16 之前的旧说法里内核会插【明骰】【变化】这类行，§16 起这条已经废止：正文是守秘人一字不改地写、内核只核对数字对不对，不再插入或改写任何一个字。

## 真相与可见性

**`ModuleGraph`（模组图）** — 一本书（starter 或 PDF 构建出来）的结构化知识：场景、NPC、线索、结论……的节点与关系。产生：starter 投影脚本或 §14 的读者+装配管线；消费：`table.look`/`lookup`/`apply move`/`resolve` 的场景与在场判定、Director 打分、胶囊各节。契约 §14 全节。代码：`kernel/coc/module_graph.py` 的 `class ModuleGraph`。
不是：`ModuleStore`——`ModuleGraph` 是**一次读入内存的索引**（`Table.graph()`/`ModuleStore.graph()` 按代际缓存），`ModuleStore` 是它在磁盘上的**存储与代际管理**；改图要经 `ModuleStore`，读图用的对象是 `ModuleGraph`。

**「模组真相只读且默认保密」（module truth）** — 不是一个字段名，是 `Agents.md`「产品不变量」里的一条设计原则：模组图上的秘密、agenda、未发现线索默认对玩家不可见，守秘人可以引用它们来编织叙事，但不能把它们原样喂给玩家；玩家猜对了仍然只是猜测，不会因为猜对就被系统标记为「已知」。落地依据：模组图节点的 `visibility` 字段与 `truth_status` 字段（见下）、胶囊的 `keeper_only` 材料（§13.1 `present[].secret`/`fear`）、校验车道抓「越权揭示」（§12.5 `kind: "reveal"`）。
不是：`campaign_not_ready`（校验失败态）——「模组真相保密」是内容层面的可见性规则，`campaign_not_ready` 是内核加载校验（本体注册表、图摘要）失败时的协议错误，两者不是一回事。

**`visibility` / `truth_status` / `privacy`（三套看起来同义、实际各自独立的闭合词表）** — 这是最容易踩的近义词陷阱，三套词表分别管三种不同的对象，字符写法也不同：
  - 模组图节点的 `visibility`（连字符）：`keeper-only`、`player-safe`、`revealable`。管一个节点（NPC、线索、手卡……）能不能被玩家看到。契约 §14.2（`apply handout` 校验）、§14.3（`default_visibility: keeper-only`）；代码 `content/modules/module-graph-contract-v3.json` 的 `visibility` 数组，读入为 `kernel/coc/modules/contract.py` 的 `VISIBILITIES`。
  - 模组图节点的 `truth_status`（连字符）：`authored-fact`、`authored-belief`、`authored-rumor`、`authored-lie`、`inferred-candidate`。管一个节点上的断言是作者写死的事实还是角色的（可能错的）信念/流言/谎言，还是机器从关系推出来的候选。同一份 `module-graph-contract-v3.json` 的 `truth_status` 数组，读入为 `kernel/coc/modules/contract.py` 的 `TRUTH_STATUSES`。
  - 记忆候选的 `privacy`（下划线）：`player_safe`（缺省）、`keeper_only`。管一条**候选断言**（不是模组节点）能不能被玩家侧看到。契约 §12.3；代码 `kernel/coc/memory.py` 的 `PRIVACY`。
  - 骰子收据的 `visibility: "keeper"`（无修饰的单个词，出现在 `roll` 收据与 §16.2 机制投影的 `roll` 字段里）：标一条掷骰是隐藏骰（比如心理观察），不进玩家可见的核对与渲染。契约 §11.6、§16.2。
不是：彼此可以互换的同一个概念——四者管的对象都不同（图节点的可见性、图节点的真伪、记忆候选的隐私、单条骰子收据的隐藏标记），字面上有的连字符有的下划线也不是笔误，是四份独立的闭合枚举；读代码或契约时先看清楚是哪个对象上的字段，再决定它取哪套值。

**revealed vs guessed（揭示 vs 猜中）** — 不是字段名，是「产品不变量」里的另一条：线索/秘密只有经 `apply clue`（或世界线的 `apply {kind: "clue", clue: "echo:..."}`）才算「被揭示」，写进 `world.discovered_clues`；玩家凭对话猜对了模组里的真相，只要守秘人没有走 `apply clue` 确认，系统状态上它仍然是「未发现」——叙述里发生了却没有收据的事等于没发生（`Agents.md` 产品不变量、`docs/acceptance.md`「读证据的三条戒律」）。契约 §5（`apply` 的 `clue` 效果）、§13.3（`reveal` 列表）。代码：`kernel/coc/table.py` 的 `_stage_clue`（约 1064 行）。
不是：`known.clues_here[].discovered`——那是胶囊里对「这条线索有没有被发现」的只读投影，`discovered: false` 的条目本身就是「玩家可能已经猜到，但系统还没记」的证据，不是 bug。

## 规则层（RuleGraph）

**`RuleGraph`** — coc7 规则的图形式：决策、槽位、事实路径、族的图数据，`content/rulesets/coc7/rule-graph.json`。产生：内容团队维护；消费：`RulesRuntime`（`table.resolve` 靠它选决策、填槽位）。契约 §11 全节、ADR-0003。代码：`kernel/coc/rules/graph.py`。
不是：`ModuleGraph`——一个是规则本体（放之四海皆准的 coc7 规则），一个是某本书的具体内容（场景、NPC、线索）；两者只在本体注册表（`content/ontology/system-ontology.json`）里被交叉引用，互不包含。

**decision（决策）** — RuleGraph 里的一个节点，代表一种可结算的判定（比如 `decision:coc7:combat:attack`）；语义名去掉 `decision:coc7:` 前缀（`combat:attack`）。产生：内容团队写在 `rule-graph.json` 里；消费：`table.resolve` 的候选选择（§11.3）与收窄（本体 `grounded-by`，§13.4）。契约 §11.3、§2（收据前缀 `roll:` 等间接对应）。代码：`kernel/coc/rules/graph.py` 的 `decision_nodes`；`kernel/coc/resolve.py` 的 `full_decision_ref`/`semantic_name`。
不是：`outcome.kind`——决策是「选中了哪条规则」，`outcome.kind`（`check`/`combined`/`social`……）是这条决策结算完之后**结果**的分类；一个决策对应一种或几种 `outcome.kind`。

**slot（槽位）** — 一个决策声明的输入需求（比如 `skill`、`target_npc_id`、`weapon_ref`），分宿主锁定（内核从状态填）与守秘人语义槽位（从 `action` 字段映射，见 §11.4 的表）。契约 §11.4。代码：`kernel/coc/rules/graph.py` 的 `canonical_slot_name`；`kernel/coc/resolve.py` 的 `SLOT_TO_ACTION`。
不是：`action` 的字段名——槽位名是 RuleGraph 内部的东西，模型永远看不到；`needs`/`fix` 报错时永远用 `action` 的字段名说话（比如报 `weapon`，不会报 `weapon_ref`），这是契约 §11.4 明写的边界。

**fact（事实）** — 事实字典里的一条键值，键只能是 RuleGraph 契约登记过的路径（`REGISTERED_CONDITION_PATHS`），来源三处：状态事实（表与运行时数值）、意图事实（`intent.*`）、会话事实（`chase.*`/`sanity.*`/`magic.*`/`development.*`）。契约 §11.2。代码：`kernel/coc/rules/graph.py` 的 `REGISTERED_CONDITION_PATHS`、`facts_from_state`。
不是：`narrate` 结果里的 `facts`（§12.5 的 `committed`/`keeper_only`）——那是给守秘人和校验车道看的**play_language 句子列表**，是从收据和世界状态生成的叙述性摘要；这里的 `fact` 是喂给 RuleGraph 条件判断的**内部事实字典**，键是英文路径，值是布尔/数字/字符串，模型完全看不到它。两个词撞了同一个英文单词，是全契约里最容易望文生义的一处。

**situation（局势）** — 由 `actor.*`/`time.*`/`sanity.*`/`chase.*`/`development.*`/`clock.*` 下**正向状态事实**激活的硬门决策列表（比如濒死钟、每周重伤恢复），只列「现在正卡在这儿」的，供 `look`/胶囊展示。契约 §11.10、§13.1（`situations` 节）。代码：`kernel/coc/table.py` 的 `_situations`（约 623 行）。
不是：`pressures`（§13.2）——`situations` 是规则层判出来的硬门（有没有一个决策此刻可用/必须处理），`pressures` 是胶囊给守秘人看的**叙事化提醒**（时钟段数、威胁、未回答的规则后果），两者常常描述同一件事（比如濒死钟）但服务的读者不同：`situations` 是给规则/收窄逻辑用的结构化数据，`pressures` 是给守秘人看的一行话。

**family（族）** — RuleGraph 里一组决策的分类（`combat`/`chase`/`sanity`/`social`/`magic`/`healing`/`development`/`core-check`/`push-luck`/`psychology` 十族，见契约 §11 开头「RuleGraph 十族」）。产生：内容团队标在决策节点的 `family_id`；消费：会话优先级判断（§11.3「会话优先」）、遥测（`decision-settled` 事件的 `family` 字段）。契约 §11.3、§12.1。代码：`kernel/coc/rules/graph.py` 的 `decision_nodes(family=...)`；`kernel/coc/resolve.py` 的 `SESSION_FAMILIES`。
不是：`session.kind`（`combat`/`chase`/`sanity_bout`）——`family` 是决策的分类（静态、图上声明），`session.kind` 是运行时活跃的会话种类（动态、有生命周期）；`combat` 族的决策可以在没有 `session` 的情况下结算（比如战斗开局前的第一次攻击判定）。

**session（会话）** — 战斗/追逐/理智发作三种跨回合的引擎状态机，形状 `{kind, status, round, turn_of, actions, pending_defense, participants}`（契约 §11.9）。产生：`resolve` 判出 `intent: combat` 等触发开局；消费：后续每次 `resolve` 都回显当前 `session`，胶囊 `where.session`。契约 §11.5、§11.9、§13.1。代码：`kernel/coc/sessions.py` 的 `class SessionView`；快照落盘在 `save/combat.json`/`save/chase.json`/`save/sanity-state/<inv>.json`。
不是：Pi 的会话（`--session-id coc-<campaign>`，`docs/pi-host-contract.md` §1）——那是 Pi 进程级别的对话历史标识，和这里的规则引擎会话毫无关系，只是英文都叫 session；也不是 `lane`——车道是异步流程，`session` 是同步、跟着回合走的规则状态机。

**`continuations`（推骰待决）** — `resolve` 结果里列出的「这次失败的检定还能不能推骰/花幸运」的候选，跟 `pending_choice` 不是同一形状（没有 `name`/`prompt`/`options`，只有决策名与需要的 `action` 字段）。守秘人先 `ask` 玩家要不要推，再用 `action.push: true` 或 `action.luck` 调 `resolve`。契约 §11.5（末段）。代码：`kernel/coc/resolve.py` 的 `continuation_entry`；胶囊里被投影成 `pressures`/`obligations` 的 `rule`/`continuation` 两项（§13.2，`kernel/coc/pressures.py` 的 `rule_pressures`/`continuation_obligations`）。
不是：`pending_choice`——`pending_choice` 是内核**记着的、状态机会认**的待决（回合状态要等它），`continuations` 只是结果里的一份建议清单，守秘人可以完全不理会它（玩家不推骰、不花幸运，这条建议自然作废，不需要显式关闭）。

## Director

**beat（节拍）** — Director 打分选出的十一种叙事姿态之一（REVEAL/DEEPEN/PRESSURE/CHARACTER/CHOICE/CUT/MONTAGE/PAYOFF/RECOVER/SUBSYSTEM/ADVANCE）；胶囊 `director.beat` 只是建议，Director 没有写侧（契约 §13 前言）。契约 §13.3。代码：`kernel/coc/director.py` 的 `score`/`_hits`/`override_of`。
不是：`session.kind`——`SUBSYSTEM` 节拍常常和活跃会话同时出现（第三层硬规则：`session != none` 直接判 `SUBSYSTEM`），但 `beat` 是 Director 给守秘人的**叙事建议**，`session` 是规则引擎的**运行时状态**；没有 session 也可能判出 `SUBSYSTEM`（比如 `combat:flee` 刚判完）。

**scoring rule（打分规则）** — Director 图上的节点，声明一个节拍在什么条件下得多少基础分（第一层）。产生：内容团队写在 `content/director/director-graph.json`；消费：`director.score`。契约 §13.3（`scoring-rule` 节点、条件语义闭合表）。代码：`kernel/coc/director.py` 的 `score`（约 377 行）。
不是：本体的 `grounded-by` 关系——`scoring-rule` 决定「这个节拍值多少分」，`grounded-by` 是打分之外的另一件事：把命中的 scoring-rule 关联到具体的规则决策/效果，供胶囊 `director.grounded_by` 与 `resolve` 的候选收窄用（§13.4）。

**threshold（阈值）** — Director 图上的一类节点，给打分条件用的数字参数（比如 `pressure-stalled-turns`、`choice-undiscovered-clue-count`）。所有打分用到的数字都来自这里，代码里不允许出现字面量（ADR-0003 的核心约束）。契约 §13.3、ADR-0003。代码：`kernel/coc/director.py` 读图时按 `condition_id` 取阈值，不硬编码。
不是：规则层的数字（比如 `characteristic-dice.json` 的骰式）——那些是 coc7 规则书的数字，住在 `rules-json/`；Director 的阈值是叙事节奏的参数，住在 `director-graph.json`，两套数字来源不同，互不覆盖。

**structure weight（结构权重）** — 第二层：基础分 × `structure-weight[structure_type][beat]`，七种结构类型（模组图 `module` 节点声明，缺省 `branching_investigation`）各自对同一节拍给不同权重。契约 §13.3（第二层）。代码：`kernel/coc/director.py` 的 `score` 里的权重乘法；`structure_type_of`。
不是：`director.override`（第三层硬规则）——`structure_weight` 是打分环节的一部分（第二层），`override` 是打分之前就能一票定音的硬规则（会话进行中、濒死、大失败、有待决），命中 `override` 时 `scores` 直接塌缩成 `{<beat>: 1.0}`，不走加权。

**affinity（`affinity-ladder`，未消费）** — Director 图里存在的一类节点（`affinity-ladder`），契约 §13.10 明确列在「只读六类 + 手艺四类」之外——**内核不读它**，文件里有这个节点种类，但当前运行时不解析、不使用。契约 §13.3、§13.10（「`storylet`、`multiplier`、`time-cost-category`、`conflict-level`、`affinity-ladder` 留在文件里不读」）。
不是：一个还没写完的 bug——这是明确的范围裁剪（这一轮不带 storylet 与好感度阶梯），不是遗漏；如果哪个 worker 想读它，先去改契约 §13.3/§13.10，不要直接在代码里加读取。

**`director_adoption`（采纳）** — `narrate`/`ask` 关回合时算的遥测：`{beat, adopted: bool, evidence: [收据 id]}`，判定表按节拍闭合（比如 REVEAL 看有没有 `reveal` 列表里的线索收据）。这是遥测，不改变下一回合的胶囊建议（Director 没有写侧、没有反馈环）。契约 §13.7。代码：`kernel/coc/director.py` 的 `director_adoption`（约 527 行）；落盘在 `kernel/coc/table.py` 的 `_adoption`（约 1526 行），`lane: "director"` 遥测行。
不是：校验车道的 `findings`（§12.5）——两者都是「回合关完之后算的东西」，但 `director_adoption` 判的是「守秘人有没有顺着 Director 的建议走」（不评判对错），校验车道判的是「守秘人的正文有没有越权揭示/凭空声称状态变化」（是纠错机制）。

## 记忆

**episode（片段）** — 每个已提交回合追加进 `memory/episodes.jsonl` 的一条摘要：`{episode_id, turn, commit, scene, present, investigators, receipts, clues_discovered, ...}`，是抽取任务的输入之一。契约 §12.3。代码：`kernel/coc/memory.py` 的 `episode_id`、`write_episode`（约 197–221 行）。
不是：`turns/NNNN.json`——`episode` 是给记忆抽取车道用的精简索引（哪些人在场、哪些收据），完整回合记录（正文、世界快照、事实清单）仍然只在 `turns/`；`episode` 丢了可以从回合记录重建任务包（§12.6）。

**candidate（候选断言）** — `memory.submit` 提交的一条断言，`kind`/`subject`/`statement` 等八个闭合字段（§12.3 的表），落盘后 `status: "candidate"`，永远不会自动变成状态或规则事实（见下「promotion」）。契约 §12.3。代码：`kernel/coc/memory.py` 的 `validate_candidates`、`CANDIDATE_FIELDS`。
不是：`facts.committed`（§12.5）——`committed` 是内核从收据**确定性生成**的事实句（谁做了什么、通没通过），保证真；`candidate` 是模型抽取车道**猜**出来的断言（谁知道什么、谁相信什么），可能被 `state: uncertain/distorted` 标注，也可能被同主语同 `entities` 的新断言接续关闭。

**statement（陈述）** — 候选断言里那句 1–400 字的话本身（`candidate.statement`），用 play_language 写（守秘人和玩家都可能读到）。契约 §12.3（候选字段表）、§16.1（语言约束：「记忆候选的 `statement` 也按 play_language 写」）。代码：`kernel/coc/memory.py` 的 `MAX_STATEMENT_CHARS` 校验。
不是：`facts.committed` 的句子——那些是英文之外无关的、内核生成的确定性中/英句子（跟着系统语言走的部分不算，`committed` 本身是 play_language，但生成方式是模板拼接，不是模型写的自由陈述）；`statement` 是模型写的一句自然语言。

**kind（候选种类）** — 候选断言的闭合分类：`world_event`、`knowledge`、`belief`、`relationship`、`player_assertion`、`player_preference`、`keeper_correction`，加切片 3 新增的 `promise`（§13.5）。排序权重按种类分层（`world_event`/`knowledge`/`relationship`/`promise` 优先于 `belief`/`player_preference`/`keeper_correction`，`player_assertion` 最后）。契约 §12.3、§12.4（`recall memory` 排序）、§12.9（`memory.KIND_RANK_TIERS`）。代码：`kernel/coc/memory.py` 的 `KIND_RANK_TIERS`（约 34 行）。
不是：`candidate.kind` 和 `apply` 效果的 `kind`（`move`/`clue`/`time`……）——两个「kind」同名不同域，一个是候选断言的分类，一个是世界效果的分类，字段名撞了但闭合枚举完全不同。

**promotion（晋升，永不发生）** — 不是一个字段或函数名，是一条被反复强调的**不存在的路径**：候选断言永远不会自动变成状态、规则事实或世界数据；`apply` 的 `note`/`ruling` 字段留给后续切片，但当前没有任何机制把 `recall memory` 的命中直接写回 `world.json`/`party/`。契约 §12.3（「候选不晋升」）、§12（前言，三条法则之一）。
不是：`memory-written` 事件——那只是「一批候选被接受写盘」的记录，和「候选变成了世界状态」是两件事；候选写盘之后，怎么用它完全靠守秘人自己在正文里判断相关不相关（`recall memory` 把 `status` 一起给守秘人，相不相关由模型判）。

**三路 `recall`** — `transcript`（逐字记录，`recall.py` 的 `transcript`/`transcript_read`）、`memory`（候选断言，`memory.py` 的 `query_candidates`）、`history`（事件时间线与 `diff`，`recall.py` 的 `history`/`history_diff`）。三路都在任何回合状态下只读可调（契约 §12.4 末段）。契约 §12.4。代码：`kernel/coc/recall.py`、`kernel/coc/memory.py`。
不是：三个独立的 RPC 方法——三路共用同一个 `table.recall` 入口，靠 `params.what` 分流（`"transcript"|"memory"|"history"`），不要去找 `table.recall_memory` 这样的方法名。

## 模组

**bundle（资料包）** — 宿主的外部 PDF 技能产出的、逐字节校验过的书稿：`manifest.json` + `pages/NNNN.md` + `assets/`。仓库不解析 PDF，只核对哈希与页码连续性。契约 §14.2。代码：`kernel/coc/modules/bundle.py`；契约里的 `module.bind` 消费它。
不是：`ModuleStore` 里的 `bundle/` 目录——后者是校验通过之后**复制进存储**的副本（`modules/<id>/bundle/manifest.json`、`bundle/pages/`），前者是宿主技能产出、内核尚未收下的原始资料包；`module.bind` 是两者之间的唯一桥。

**section（分节）** — 全书按 `module.plan` 切出的一个可独立阅读单元：`{id, title, pages, kind, priority, status, shard, rounds}`，状态只前进（`planned→reading→accepted|failed|skipped`）。契约 §14.1（`sections.json`）、§14.3（`module.plan`/`module.plan.accept`）。代码：`kernel/coc/modules/store.py` 的 `section`/`set_section_status`。
不是：`shard`（见下）——`section` 是「书的哪一段该怎么读」的**计划单元**，`shard` 是「读出来的内容」；一个 accepted 的 section 对应一个 `shards/<section_id>.json`。

**shard（分片）** — 读者子进程对一个 section 产出的 v3 契约结构化内容，通过三道门才能进 `shards/`。契约 §14.1、§14.5。代码：`kernel/coc/modules/gates.py` 的 `fill`/`review`（机器填充与三道门跑在同一个 shard 上）。
不是：`module-graph.json`（整图）——`shard` 是单个 section 的产出，`module.assemble` 把骨架和全部 accepted 的 shard **合并**成一张整图（契约 §14.3、§14.11「装配」）；shard 本身不是可玩的图。

**gate（shape/grounding/coverage 三道门）** — `module.review` 对一个 shard 跑的三道确定性检查，每道都跑、都不降级：`shape`（契约键、id 语法、词表闭合）、`grounding`（每个名字/数字都能在其引用的 span 里找到，防止编造）、`coverage`（十个域是否都交代，未声明的域记 `unresolved`，不拒绝）。契约 §14.3、§14.11（「三道门」）。代码：`kernel/coc/modules/gates.py` 的 `shape`（约 164 行）、`grounding`（约 409 行）、`coverage`（约 447 行）。
不是：`module.assemble` 之后的「可玩性标准」（十条不变量）——`gate` 判的是**单个 section 的产出质不质量**（有没有编造、交没交代），可玩性标准判的是**整本书装起来能不能玩**（场景连不连通、有没有结局）；一个 section 三道门全过，整本书仍可能因为别的 section 缺失而 `assembled_not_playable`。

**span（证据段）** — 抽取包（`module.packet`）里带 id 的原文证据片段，`span-p<页>-<段>`，页级作用域（同一页在任何包里 id 相同）。`grounding` 门要求每个名字和数字都能在其引用的 span 里逐字找到。契约 §14.3（`module.packet` 段落切分规则）、§14.11（`span_ids` 生成算法）。代码：`kernel/coc/modules/packet.py`。
不是：`page`——一个 page 通常被切成多个 span（按空行分段、超 1600 字再切）；span 是证据的最小可引用单元，page 只是它们的容器。

**assemble（装配）** — 把骨架（机器造的 module 节点等）和全部 `accepted` 分片合并成整图，冲突走确定性规则（同 id 不同 kind 先到者留、`inferred-candidate` 让位于 `authored-*`……），随后跑十条可玩性不变量。契约 §14.3、§14.11。代码：`kernel/coc/modules/assemble.py` 的 `assemble`（约 304 行）、`merge`。
不是：`module.install`——`assemble` 只是把图拼起来并跑可玩性检查（结果可能是 `assembled` 或 `assembled_not_playable`，图照样写盘），`install` 是在这基础上再做一步「登记为战役可以开桌用的当前版本」的状态跃迁（不可玩的图需要显式 `force: true` 才能装）。

**install（安装）** — `module.install` 把一张 `assembled`（或带 `force` 的 `assembled_not_playable`）的图登记为战役可读的当前状态，状态只前进，不回落。契约 §14.3、§14.11。代码：`kernel/coc/modules/rpc.py` 的 `"module.install"` 方法。
不是：`campaign.create` 时的 starter 注册——starter 走的是 `ModuleStore.register_starter`（校验digest、复制、直接置 `installed`），不经过 `module.plan`/`packet`/`review`/`assemble` 这条 PDF 车道；两条车道在 §14.1「同一条注册车道」（starter 已投影成 v3 图后）殊途同归，但 `install` 这个 RPC 方法本身只服务 PDF 车道。

**deepen queue（深读队列）** — `deepen-queue.json`：`apply move` 成功后把目的地及其邻居里未 accepted 的 section 排队（`reason: move|adjacent`），`table.open` 对起始场景同理（`reason: opening`）；module 扩展在后台认领、读、装配。契约 §14.6。代码：`kernel/coc/modules/deepen.py`（`enqueue`/`claim`/`complete`/`enqueue_for_scene`）。
不是：`module.plan` 切出来但还没读的 section——那些一开始就在 `sections.json` 里是 `planned` 状态，不需要入队；`deepen-queue` 只服务「玩家快走到那儿了，这段书还没读」这个按需触发场景，不服务「全书还没开始读」的初始状态。

**asset（资产）** — 手卡/地图/插图的登记：`{id, kind: handout|map|illustration, name, pages, path, visibility}`，由 `module.bind` 从资料包清单登记，`module.assemble` 再和图上的 `asset`/`handout` 节点按页对齐合并。契约 §14.8。代码：`kernel/coc/modules/assets.py`。
不是：`attachment`（`apply handout` 结果里的字段）——`asset` 是存储里的登记条目，`attachment` 是某一次 `apply handout` 调用结果里给扩展的「这次交付了哪个文件」的即时描述（因为 Pi 没有出站附件通道，见 `docs/pi-host-contract.md` §3.3，最终只落成交付文本里的一行路径）。

**starter（起步模组）** — 已经是 v3 图形式、随仓库分发的模组：`the-haunting`、`mystery-house`、`the-white-war`，`content/starters/<id>/module-graph.json`。产生：`scripts/starter_graph.py`（把旧七文件 IR 投影成 v3 图，契约 §14.9）；消费：`campaign.create`、`ModuleStore.register_starter`。契约 §14.1、§14.9。代码：`kernel/coc/modules/store.py` 的 `register_starter`（约 186 行）。
不是：`module.bind` 绑定的 PDF 书——starter 是 `source: "starter"`，没有 `bundle`、没有 `sections.json`（§14.1「Starter：……没有 bundle 与 sections」）；PDF 书是 `source: "pdf"`，要走完整的 `bind→plan→packet→review→accept→assemble→install` 车道。

**`module_digest`/战役编译快照（campaign compile snapshot）** — `campaign.json` 记的 `module_digest`（建战役那一刻模组图的文件 sha256）与 `module_generation` **只做溯源，不锁读**（契约 §14.1 原句）：`Table.graph()` 每次都读 `ModuleStore` 当前代际的图，不是战役创建时冻住的那一份。真正在建战役那一刻被复制、此后不再变的是 `party/<id>.json`（pregen 表的副本）与 `world.json` 的初始场景/NPC 分布；模组图本身是共享、可增长的存储，不是每个战役各自的快照。契约 §14.1、§14.11、§14.12（starter 与桌面接线）。代码：`kernel/coc/table.py` 的 `campaign_create`（约 316 行）、`Table.graph`（约 144 行）、`kernel/coc/modules/store.py` 的 `register_starter`（digest 相同则原样返回、不同则代际 +1）。
不是：「改了 starter/模组数据，已建的战役就再也看不到」——这条直觉只对了一半：`register_starter` 只在 `campaign.create`（或旧战役第一次 `table.open` 补注册）时才被调用去比对源文件 digest；只要有**任何一次**这样的调用把 `ModuleStore` 的代际推高，**所有**引用同一 `module_id` 的战役（新老都算，因为存储是共享的）下一次读图都会看见新内容。「验证要新开战役」这条经验成立的真正原因是「新开战役会触发一次 `register_starter` 调用」，不是「战役天生冻结」——旧战役自己单独 `table.open` 而没有任何人触发过 re-register，才会停留在旧代际。

## 语言与机制（§16）

**system language（系统语言）** — 代码、契约、提示词、工具描述、宿主消息、内核写给守称人的一切说明性文字（`head`、Director 的 `reason`、检查点 `one_line`、事实清单、抽取指令、校验发现、读者 brief）只用英文；守卫测试扫 CJK。契约 §16.1。代码：`tests/kernel/test_system_language.py`、`tests/extension/system-language.test.mjs`。
不是：`play_language`——系统语言是「工具怎么和模型说话」，`play_language` 是「模型怎么和玩家说话」；模组内容数据（starter 图、玩测证据）不受系统语言约束，它们是它本来的语言。

**`play_language`（玩家语言）** — 战役建立时选定的闭合集（`zh-Hans`、`en`），守秘人正文与记忆候选 `statement` 都按它写；不是翻译层，是模型自己按这个标签写作。契约 §16.1、契约 §5（`campaign.create` 参数）。代码：`kernel/coc/table.py` 的 `SUPPORTED_LANGUAGES`、`campaign_create` 里的语言校验。
不是：`register`（`purist`/`pulp`）——那是文风轴（§13.6 的 `style` 节），和语言是两个独立维度：同一 `play_language` 下可以是纯正调查还是通俗猎奇的写法。

**mechanics projection（机制投影）** — `narrate`/`ask`/`table.status` 结果里的 `mechanics` 数组，语言中立，每条对应一条收据（`roll`/`dice`/`change`/`scene`/`clue`/`time`/`item`/`cash`/`session`/`choice`/`handout` 十一种 kind，见 §16.2 的字段表）。产生：内核；消费：扩展写成 `coc-mechanics` 会话条目与总线 `coc:mechanics`，供前端渲染骰子卡，TUI 不显示。契约 §16.2。代码：`kernel/coc/render.py` 的 `mechanics_of`/`mechanics`。
不是：正文里的任何文字——§16 之前内核会把机制拼成【明骰】【变化】这类中文行插进正文，§16 起这条彻底废止：正文只有守秘人自己写的字，机制只活在 `mechanics` 这个并行的结构化通道里。

**「核对数字」（the number check）** — 不是字段名，是 §16.3 的确定性底线：内核不再插入任何机制行，改成核对——每条**公开**收据的关键数字（掷值/目标、伤害前后、分钟数）必须以数字形式（纯字符串包含）出现在守秘人正文里，缺了报 `invalid_params`（`code_detail: "mechanics_missing"`），列出缺了哪些数。名字（技能、场景、线索）不核对。契约 §5（`narrate` 第 2 步）、§16.3。代码：`kernel/coc/render.py` 的 `missing_numbers`、`mechanics_missing`（`code_detail` 常量 `MECHANICS_MISSING`）。
不是：`facts.committed` 的句子生成——`facts.committed` 是内核**自己拼**的确定性事实句（给校验车道用），核对数字是**检查守秘人写的正文**里有没有抄对收据上的数字，两件事都发生在 `narrate`，但一个是生成、一个是校验，顺序上核对先于生成 `facts`（见 `kernel/coc/table.py` 的 `narrate` 方法体：`check_numbers` 在 `self._facts` 之前调用）。

## 世界线（§15，已在契约、未实现）

契约 §15 整节写了形状，但 `kernel/coc/` 与 `extensions/` 里没有任何代码实现它（`grep -r worldline kernel/coc extensions` 零命中）。下面几条只是把契约的词记下来，不代表已经能用；票 #23（切片 6）追踪它。

**worldline（世界线）** — 战役 sidecar 仓库里的一条 git 分支（`wl/<name>`），`campaign.json.worldlines` 登记每条线的 `kind`（`main`/`if`/`loop`/`merge`）、圈数、分叉点、状态。契约 §15.1。
不是：世界线本身没有独立的存储格式——它就是 git 分支加 `campaign.json` 里的一份元数据，战役目录（`world.json`/`turn.json`/`turns/`/`save/`/`memory/`……）本身没有变化，切一条线就是 `git checkout` 到另一条分支。

**if line（if 线）** — `apply {kind: "fork", mode: "if"}` 产生的分支：在某回合的提交上开叉，世界原样保留，用于「如果当时……」的假设推演。契约 §15.2、§15.3。
不是：`loop`（见下）——`if` 不重置世界状态，`loop` 会。

**loop（圈/循环）** — `apply {kind: "fork", mode: "loop"}` 产生的分支：先分叉，再按模组声明的 `resets-to`/`persists-across-loop` 把世界和表重置到锚点快照，`loop` 计数 +1。没有 `resets-to` 声明的模组不能开 `loop`（报 `invalid_params`）。契约 §15.2、§15.3。
不是：`worldline` 的同义词——`loop` 是 `worldline` 的一种 `kind`（另外两种是 `if` 和 `merge`），不是并列概念。

**anchor（锚点）** — 循环重置回去的那个快照：队伍第一次进入锚点场景那一回合关闭时的世界与表，存 `save/worldlines/anchor.json`，只算一次，之后每次回溯都用它，不重算。契约 §15.2。
不是：`continuation checkpoint`——锚点是世界线专用的、只在第一次 `loop` 分叉时生成一次的快照；续行检查点是每次 `narrate` 都刷新的、给崩溃恢复用的缓存，两者用途、生成时机都不同。

**echo（回声）** — 分叉/汇流时从其他父线（或上一圈）的回合记录生成的确定性摘要（`{id, line, loop, turn, scene, kind, summary, receipts, entities}`），是守秘人专属的可投放证据：只能通过 `apply {kind: "clue", clue: "echo:<id>"}` 揭示，内容不能被守秘人改写，只能决定揭不揭示。契约 §15.4。
不是：`recall memory` 的候选——回声是从**收据**确定性生成的（不经模型抽取），候选是模型在记忆车道里**写**出来的；回声一旦生成内容就定死，候选可以被同主语的新断言接续关闭。

**confluence（`merge`，汇流）** — `apply {kind: "merge", lines: [...], dispositions: {...}}`：把多条线合成一条新线，先算冲突报告，冲突未处置报 `needs`；处置齐了才落地、做一次带全部父提交的合并提交。契约 §15.3、§15.4。
不是：git 的 `merge` 命令本身——契约里的汇流是「先算出一份闭合的冲突报告，等守秘人显式处置每一条冲突」之后，内核才去做那次 `git merge -s ours --no-commit` 加一次手动 `commit`；git 操作只是落地的最后一步，不是这个词的全部含义。

**disposition（处置）** — 汇流冲突报告里，守秘人对每条冲突给出的解法：`{mode: "from", line}`（取某一线的值）、`{mode: "min"|"max"|"sum"}`、`{mode: "drop", note}`；哪些冲突类别允许哪些处置模式是闭合表（契约 §15.4：`dead_alive` 只能 `from`，`clue` 永不冲突不需要处置）。契约 §15.3、§15.4。
不是：`decision`（RuleGraph 的决策）——两个词都译作「决策/处置」容易混，但 `disposition` 只服务汇流这一个场景，是守秘人对冲突报告的人工裁决，和规则层的 `decision` 毫无关系。

## 退役词

下面这些词只存在于旧树（分支 `0.8.2a`、`main` 及所有 `claude/*`/`codex/*` 旧分支），0.9.0a 从孤儿分支重建、从未包含过旧树；读到旧代码或旧文档撞见它们时，对照右边找 0.9.0a 里接手的东西，不要在 0.9.0a 里找同名概念。

| 旧树的词 | 旧树在哪 | 0.9.0a 接手的东西 |
| --- | --- | --- |
| IR 七文件（`module-meta.json`/`story-graph.json`/`clue-graph.json`/`npc-agendas.json`/`threat-fronts.json`/`pacing-map.json`/`improvisation-boundaries.json`，可选第八文件 `quests.json`） | `plugins/coc-keeper/skills/coc-scenario-import/SKILL.md`，产出到 `campaigns/<id>/scenario/` | v3 `module-graph.json` 单图（`content/modules/module-graph-contract-v3.json`），§14 全节 |
| typed tools（按 role/phase/stage 变形的工具面） | `plugins/coc-keeper/pi/lib/typed-tools.ts` | 静态的七个动词（§5），工具面游玩期间不再变形（ADR-0002 记录了为什么废止 replan 信号） |
| MCP hotset（`listed_hotset`，长尾操作走独立的契约归档） | `plugins/coc-keeper/mcp/server.py`、`scripts/coc_mcp_contract_archive.py` | 不再有「小热集 + 长尾归档」这层区分：七个动词本身就是全部工具面 |
| steward（子代理车道：`steward-npc`/`steward-scene`/`steward-rule`/`steward-init`） | `plugins/coc-keeper/pi/agents/steward-*.md` | 职责拆给「模组图的权威」与「按需深读队列」（§14.6），见 `Agents.md` 分支地图「明确没搬」一条 |
| operation policy（`coc_operation_policy.py`，按 host 门控可达操作） | `plugins/coc-keeper/scripts/coc_operation_policy.py` | 内核不并发处理请求、扩展负责序列化（契约 §1）；没有按 host 分层的操作可达性这层概念 |
