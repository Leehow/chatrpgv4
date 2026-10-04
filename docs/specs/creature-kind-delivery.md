# 人与生物分开 + 敌对生物 Mod：交付记录（handoff）

Status: ready-for-review（集成分支已兼容公共头 `66aedd44a`；按协调要求，不自行合主线、不打包）

- **分支** `claude/creature-kind-20261004`，worktree `~/leehow/code/chatrpgv4-wt-creature-kind`。
- **最终 ready 提交**：交付记录本身所在的提交。它的父提交 `8f67b9d53` 是公共头 `66aedd44a` 合入后的代码头。
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
| 与 §178 初遇的交界：初见接触的待处理和已掷结果都不含 creature | `19745b326` | `creature-kind.test.mjs`；验收 basement |
| 与名字 v5 / §177 的交界：名表只取书里的 `npc`；按外号查找时 creature 被种类过滤挡住；walk-on 拒绝用本桌叫法 | 合并 `930a3a36f` | 名字相关测试文件全过（见下） |

## 测试

正式验收的位置以协调方的统一 LAN 全套为准。下面按「位置」和「日志」分开记录，本机 pytest 只算诊断。

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
