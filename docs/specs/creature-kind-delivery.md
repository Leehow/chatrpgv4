# 人与生物分开 + 敌对生物 Mod：交付记录（handoff）

Status: ready-for-review（集成分支已兼容公共头 `66aedd44a`；按协调要求，不自行合主线、不打包）

- **分支** `claude/creature-kind-20261004`，worktree `~/leehow/code/chatrpgv4-wt-creature-kind`。
- **最终 ready 提交**：交付记录本身所在的提交。代码最后一次变动是 `c4ba0872c`（合入 CK-F2 审查跟进），之后的提交只改文档。公共头 `66aedd44a` 在 `8f67b9d53` 合入。
- **历史**：此前已兼容公共头 `1b17590e8`（代码头 `930a3a36f`）。`66aedd44a` 合入时没有冲突；它与本切片唯一重叠的代码文件是 `runtime/jev/hybrid-engine.ts`，但那处改动来自之前合入的主线 §178.3，本切片自己没改。
- **规范**：契约 `docs/kernel-rpc.md` §180（开头有 Status），spec [creature-kind.md](creature-kind.md)，工单 [creature-kind-tickets.md](creature-kind-tickets.md)，模组库调查 [creature-kind-survey.md](creature-kind-survey.md)。

## 证据的性质

本记录里的产品路径证据，是**机制证据和生产内核路径证据**：直接驱动打包所用的内核构建产物 `build/kernel/rpc.mjs`，按 JSON-RPC 调用，不调用任何模型。

- 它**不是**自然游玩。
- 它**不是**最终 App 验收。
- 旧的真桌记录不能算作新头的实际游玩。

真桌和成品复测，等唯一打包 owner 的信号，并且要有原已授权的模型预算。

## 逐项行为

| 行为 | 提交（合入集成） | 证据 |
| --- | --- | --- |
| 人与生物的界线；人类功能只对人（外号、未告知名字、`say_name`、声线、日志、记忆、性格工单、社交与心理学检定、胁迫、初见接触）；身体功能对 actor（理智去重、战斗标签、急救、伤害） | CK-A `168d7e719` → `00e5f9819`；person 行不带 `kind` 修正 `d167ef3ca`、`5e1756d55` | `tests/extension/creature-kind.test.mjs`；验收 basement 三项 |
| creature 行（`kind: "creature"`，不带任何人物字段）；简报的 `creatures` 名册只用剩余预算 | 同上 | 验收 opening 与 basement；`ts-kernel-read` 对照 |
| 读书提示词按遭遇区分人和生物；校验器做三件事：一物一节点、弱点条目、`misleads` 端点 | CK-C `4e168ce3b` → `d00f4f2ee` | `creature-reader.test.mjs` |
| 规则书 14 种野兽数据（第 14 章，PDF 第 348–352 页） | CK-B `45b5b0b50` → `5bbc670ae` | `beasts.json`；`ts-kernel-rules` |
| `hostile-creatures` 1.0.0：习性词、弱点形状与弱点链、桌上补记门、按章节声明（§183） | CK-D `d54a7e636`…`48aaf75f2` → `1e4f694db` | `hostile-creatures.test.mjs`；验收 final-indexed 的章节加载表 |
| §183 的门：`people_present`、`present_without_history` 只数人；新增 `creature_present`、`weakness_here` | 同上 | 只有老鼠时 natural-npc「First impression」门关；Corbitt 在场时门开 |
| 临场动物：`apply npc {walk_on, creature}` 从目录钉数据卡，能战斗 | CK-E `bf4678b88` → 集成合并 | `table-creature.test.mjs`；验收：看门狗进入战斗，HP 8 |
| **`dossier` 接线修复**：§28.7 的桌上补记门以前从未出现在 `apply` 工具里，现在 KP 可以写 natural-npc 的 `speaks` 和本包的 `habits`/`weaknesses` | CK-E `71298389e`；端到端用例 `b92323a95` | `table-creature.test.mjs` 两条 dossier 用例；验收：看门狗的习性出现在它那一行 |
| 世界线合并时，桌上生物取并集，目录数据卡随建立它的那条线带过来 | `b92323a95` | `table-creature-merge.test.mjs` |
| 起始包：删掉 the-haunting 的老鼠双胞胎；老鼠数据卡和习性照书；Corbitt 的匕首与日光两条弱点；rulebook 版和 mystery-house 的种类修正；起始包词汇按数据推出绑定 | CK-F `d7e5528a3`、`dbe2d5e2c` → 集成合并 | `starter-creatures.test.mjs`；验收：Corbitt 链 0/4 → 1/4 → 显示持有人 |
| 不完整数据卡：战斗、追逐、伤害给出可执行的拒绝；`creature`/`archetype` 补全时作者写明的值优先 | CK-F2 `359a3be32` → 集成合并 | `partial-stat-block.test.mjs` |
| CK-F2 审查跟进（Jev owner 的两个 P2）：(1) 先手攻击打向缺 STR/SIZ/DEX/CON 的数据卡时，走「准备 → 保留所选攻击 → 刷新 → 重放」，creature 的补全指向规则目录，不用人物 archetype，也不造数值；(2) 徒步追逐者和名册里的步行者缺 MOV 时给出补全拒绝，驾驶者和乘客不要求身体 MOV | 契约 `9ba223c16`；修复 `d51d23156` → `c4ba0872c` | `partial-stat-block.test.mjs`：真实路径的保留与重放跟踪；测试盒 pytest 7 个文件 181 通过，日志在 `/home/box/chatrpgv4-testbox/wt/chatrpgv4-wt-ck-partial/remote-py.log` |
| 与 §178 初遇的交界：初见接触的待处理和已掷结果都不含 creature | `19745b326` | `creature-kind.test.mjs`；验收 basement |
| 与名字 v5 / §177 的交界：名表只取书里的 `npc`；按外号查找时 creature 被种类过滤挡住；walk-on 拒绝用本桌叫法 | 合并 `930a3a36f` | 名字相关测试文件全过（见下） |

## 测试

正式验收的位置以协调方的统一 LAN 全套为准。下面按「位置」和「日志」分开记录，本机 pytest 只算诊断。

### 头 `bd52d0980`（含 CK-F2 审查跟进；代码与 `c4ba0872c` 相同）

- **构建**：leehow-pc，`remote-test.sh build-fetch`。
- **pytest 单文件，在测试盒 leehow-pc 上跑**：17 个文件 269 通过、1 跳过，退出码 0。
  - 盒子日志 `/home/box/chatrpgv4-testbox/wt/chatrpgv4-wt-creature-kind/remote-py.log`，本地副本 `.coc/playtests/creature-kind-20261004/pytest-box-bd52d0980.log`。
  - 文件：下一节列出的 14 个，加上 engines/test_chase、test_npc_first_blow、engines/test_combat。
- **node 单文件，在本机跑**：33 个文件 544/544 通过，日志 `.coc/playtests/creature-kind-20261004/node-single-files-bd52d0980.log`。
  - 下一节的 23 个文件；
  - 加上先手准备与追逐：attack-preparation、check-preparation-host、check-selection、check-catalog、chase-roster-selection、chase-vehicle-gateway；
  - 加上单循环：single-loop-binding、single-loop-candidates、single-loop-compile、single-loop-domain-policy。
- **生产内核路径验收**：`head-bd52d0980-default`、`head-bd52d0980-indexed` 各 12/12。

### 代码头 `8f67b9d53`（已兼容 `66aedd44a`）

- **构建**：leehow-pc（`remote-test.sh build-fetch`，盒子日志 `/home/box/chatrpgv4-testbox/wt/chatrpgv4-wt-creature-kind/remote-build.log`；amax 不在线），产物拉回本机。
- **pytest 单文件，在测试盒 leehow-pc 上跑**（`remote-test.sh run … py <14 个文件>`）：132 通过、1 跳过，退出码 0。
  - 盒子日志 `/home/box/chatrpgv4-testbox/wt/chatrpgv4-wt-creature-kind/remote-py.log`，本地副本 `.coc/playtests/creature-kind-20261004/pytest-box-66aedd44a.log`。
  - 这 14 个文件：test_jev_resolve、test_starters、test_setup_laws、test_npc_situation、test_npc_act_options、test_voice_bench、test_mod_vocabulary、test_mod_packages、test_mod_director_text、test_rules_tables_register、test_chase_npc_quarry、test_npc_archetype、test_module_playability、test_haunting_shapes。
  - 主线原来的两条 `test_jev_resolve` 基线失败已经不再出现。
- **node 单文件，在本机跑**（`node --test --test-concurrency=2`）：23 个文件 394/394 通过，日志 `.coc/playtests/creature-kind-20261004/node-single-files-66aedd44a.log`。这 23 个文件包括：
  - 本切片：creature-kind、creature-reader、hostile-creatures、table-creature、table-creature-merge、starter-creatures、partial-stat-block、mod-section-index；
  - 读取与形状：ts-kernel-read、ts-kernel-rules、haunting-shapes、mechanics-readers、mechanics-shape；
  - 名字与初遇：module-cast、graph-epithets、untold-name-path、presence-impression；
  - 主线新增：single-loop-one-destination、time-band-momentary、band-shadow；
  - 守卫：world-state-seams、system-language、contract-section-numbers。
- **生产内核路径验收**（本机 node 驱动 `build/kernel/rpc.mjs`，不调用模型）：
  - `head-66aedd44a-default` 12/12；
  - `head-66aedd44a-indexed`（`COC_INSTRUCTION_BUDGET=1`）12/12，章节加载与下表一致；
  - 证据目录 `.coc/playtests/creature-kind-20261004/`，脚本 `accept.mjs`，头记录在 `HEAD-66aedd44a.txt`。

### 代码头 `930a3a36f`（兼容 `1b17590e8` 时）

- **node 单文件，本机**：28 个文件 410/410。
- **pytest，本机**：14 个文件 133 通过。**只算诊断，不计正式 LAN 验收。** 按全局规则，pytest 单文件也要走测试盒，之后不再在本机跑。
- **生产内核路径验收**：`final-default`、`final-indexed` 各 12/12。章节加载如下：

  | 时点 | 「Playing a creature」 | 「Weaknesses」 |
  | --- | --- | --- |
  | 开局 | 不加载 | 不加载 |
  | 地下室（只有老鼠） | 加载 | 不加载 |
  | 对峙（Corbitt） | 不加载 | 加载 |
  | 狗进场后 | 加载 | 加载 |

### 全量套件

本切片的任何最终头都没有跑全量：协调方会在最终公共头上统一串行跑一次。此前在同步基线 `b7825a94e`/`48f1ec97c` 上，leehow-pc 跑过：

- ext 4568/4568；
- single-loop 通过；
- pytest 2083 通过，只有当时 `test_jev_resolve` 的两条主线基线失败。

## 成品包上的 CK-G 验收（`/Applications/PipiCOC.app` = `0eabe8f4150ac04b48d23c0d1d0f004595f896a5`，2026-10-04）

**性质：无模型的标准协议机制验证。** 不是自然游玩，也不能代替协调方用模型跑的自然遭遇。

**怎么跑的：**
- 用 App 自带的 Node v24.19.0，按 App 宿主 `compiledEnvironment` 的同一组环境变量（App 自带的 git、`PI_OFFLINE=1`、只含 App 运行时的 PATH），启动 App 自带的内核 `Contents/Resources/pi-coc/build/kernel/rpc.mjs`，content 和 mods 也是 App 的。
- 宿主部分：离线加载 App 打包的扩展（`build/extensions/kernel/index.mjs`），拿到它注册给 KP 的工具定义，用 App 自带的 pi-ai 1.0.0 校验参数。
- 战役全部建在证据目录里的隔离工作区，没有写 App、源码或书库的任何文件。
- mystery-house 本身没有预设调查员，所以那一局用一个隔离的内容镜像：全部符号链接到 App 的 content，只额外放进 App 自带的 the-haunting 预设调查员卡，模组数据和 App 一字节不差。

**结果**（证据在 `.coc/playtests/creature-kind-app-0eabe8f4/`，脚本 `accept-app.mjs`，包收据副本 `pipicoc-package.json`）：
- `default`（默认全文）25/25；`indexed`（`COC_INSTRUCTION_BUDGET=1`）28/28。
- 第一次运行有两处是脚本问题：战斗参与者按 `label` 匹配，钉住的数据卡按句柄作键。那份输出原样保留在 `default-attempt1/`、`default-attempt2/`。
- **宿主**：
  - 7 个 KP 工具都在；
  - `apply` 工具接受 `walk_on` 加 `creature`（目录条目或 `true`），也接受 `dossier` 的 `habits` 和 `weaknesses`；
  - 没写名字的 `dossier` 会被拒。
- **人与生物分界**：
  - 简报里老鼠群列在生物名册，不在人物名册；
  - 地下室里老鼠群是 creature 行，带习性，没有任何人物字段；
  - 待处理或已掷的初见结果、以及 `mod_check` 收据里，都没有老鼠。
- **索引模式下的门**：
  - 只有老鼠在场时，「Playing a creature」加载、「Weaknesses」不加载，natural-npc 的「First impression」门关闭；
  - 有弱点的人在场时，「Weaknesses」加载。
- **弱点链**（人物身上那条可习得的弱点）：
  - 知识：支持线索的计数从 0 到 1；
  - 持有：手段一栏显示持有它的调查员；
  - 在场行：带着这条链，并且是人物行。
  - 首战供给：先手行列出这个目标，持有物出现在武器里。用它攻击返回可执行的 `needs`：这件物品要先经已有的物品用法流程 `apply usage`（§26 `objects.usages.v1`，由带模型的创建任务完成）准备，或者换用一件可用的武器。无模型的机制验证到此为止。
- **作者写全与写了一部分**：
  - 写全的数据卡（老鼠群）不需要准备，战斗直接读书上的数值，HP 9；
  - 只写了技能的使魔：先手行把它列为待准备，`completions` 为 `creature`；补全前开打会被拒，`reason: stat_block_incomplete`，`needs.field: creature`；用目录条目补全后，作者写的技能全部保留（闪避 40 盖过目录的 42），并记录了 `completed_from` 和 `filled`；补全后战斗能开打。
- **临场的狗**：
  - 钉住的是规则书的 Dog，`beasts.json` 第 349 页，`table_pinned`；
  - 只进 `table_creatures`，不进 `table_people`；
  - 经 `dossier` 写的习性和桌上弱点出现在它那一行；
  - 战斗读的是钉住的数据卡。
- **Mod 锁**：hostile-creatures 1.0.0、natural-npc 1.5.0、narration-craft 2.2.7，其余见各自的 `summary.json`。

**不在本次范围、刻意保持不变的：**
- CK-F2 的三项遗留：
  - 追逐名册在选择阶段不认不完整的数据卡；
  - NPC 自己用不完整数据卡发起先手攻击时，执行阶段才被拒；
  - 带乘客的名册开追时出内部错误。
- 先手攻击的保留与重放、徒步追逐的 MOV，由 Jev owner 在这个包上核验。

**可能的窄修候选，由协调方决定是否排期**：the-haunting 起始包里那件弱点手段（artifact）没有类型化的武器数据（`mechanics.weapon`），书上其实印了它的伤害。所以调查员拿到它后，要当武器用，必须先走 `apply usage`。

## 实际 build 与 Mod 锁（最终头新开的战役）

- 内核 `kernel_version` 2.0.0a0。
- Mod 锁：enhanced-items 1.3.2、guided-creation 1.2.1、historical-reference 1.0.10、hostile-creatures 1.0.0、keeper-pacing 1.3.1、narration-audit 1.2.32、narration-craft 2.2.5、natural-npc 1.5.0、story-thread 1.2.11、zh-optimize 1.3.9。
- hostile-creatures 的指令 2696 B，在 64 KiB 预算内，整份发出（§183）。

## 未满足项与已知限制

- **真桌和成品 App 复测未做。** 没有新增付费额度，等唯一打包信号和原已授权的模型预算。
- **读者产出任务节点**：另开切片（D17）。
- **带类型的抗性和弱点引擎机制**：另开切片（D17）。
- **目录里的部分条目补不完整**：Azathoth、Yog-Sothoth 本身没有 STR/SIZ/DEX，用它们补全后仍然不完整，战斗仍会被拒。契约已写明。
- **武器合并**：按 `weapon_id` 匹配，没有 id 时退回按名字。作者写的武器如果没有 id，会和目录里同名武器同时存在。
- **一个存活变异**：CK-E 的 M22，table creature 的 material 包装，只在 adaptation 钉住的战役上起作用，没有测到。
- **Corbitt 的人物字段 `fear` 里还有一句书里没有的话。** 人物字段不在本切片范围，没改。
- **mystery-house 的鼠群**：沿用旧的 agenda/fear 文本，creature 不读这些字段，处于惰性状态。`npc-agendas.json` 保留两条旧记录，因为冻结的投影器靠它们排序，测试已改为按名字钉住差异。
- **CK-A 留下的点已全部处理**：单生物读数、perspectives、台词名册（CK-D）。0 HP 的死亡记录现在由 creature 行的 `state` 读到。

- **CK-F2 跟进刻意没做的三件事**（契约 §180.6 已记录）：
  - 追逐名册在选择阶段仍把任何数据卡都算「可用」，不完整的步行者要到开追时才拿到补全拒绝；
  - NPC 自己的行动选项仍会给数据卡不完整的 NPC 提供先手攻击，执行时拿到补全拒绝；
  - 带乘客的追逐名册开追时必然出内部错误，这是本切片之前就有的缺陷，已单独开任务卡。

## 事故记录

两个 worker 共用 scratchpad 根目录里同名的 `mutate.py`，CK-E 误跑了一次 CK-D 的变异脚本，在 CK-D 的 worktree 里改过 `kernel-ts/read/sections.ts` 又还原了。核实结果：

- CK-D 的 worktree 是干净的；
- 已合入的门逻辑正确；
- 没有任何损失。

之后的 worker 都改用独立子目录。

## 协调说明

- §178（初遇）的掷骰本身只对 `node_kind === "npc"`。§180 另外过滤了 `contactRows`。两边已在新头上一起验证。
- 名字 v5 的名表只取书里的 `npc`。
- worker 的 worktree（`chatrpgv4-wt-ck-{kernel,beasts,reader,mod,walkon,starters,partial}`）都已合入、没有未提交的改动。按规矩不自行删除，等用户或协调方要求。
