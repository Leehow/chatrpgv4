# 人与生物分开 + 敌对生物 Mod：工单

Spec：[creature-kind.md](creature-kind.md)；依据：[creature-kind-survey.md](creature-kind-survey.md)；**形状以契约 §180 为准**（`docs/kernel-rpc.md`）。集成分支：`claude/creature-kind-20261004`（worktree `~/leehow/code/chatrpgv4-wt-creature-kind`），由 lead 合并、提交、跑全量与验收。

分三期：

- 第 1 期并行：CK-A、CK-B、CK-C；
- 第 2 期并行：CK-D、CK-E，依赖第 1 期合入；
- 第 3 期：CK-F；
- 最后 CK-G 验收。

每个 worker 用自己的 worktree 和分支 `claude/creature-kind-20261004-<topic>`，可以在自己分支上提交，交回时报提交号。

## CK-A 内核：人和身体按功能分开（§180.3–180.5）

Status: done（`168d7e719`，合入 `00e5f9819`）

- `ModuleGraph.isPerson`。
- §180.3 表里的每一个消费端，含：
  - `npc.job` 与 `npc.submit` 一致；
  - act ways；
  - 检定选项；
  - 台词说话人；
  - 表情卡名册；
  - 理智去重、战斗标签、急救改认 actor；
  - `resolve/projection.ts` 与 `mods/effects.ts` 的归属定下来，写回 §180.3。
- §180.4 creature 行、person 行的 `kind`、简报 `creatures` 名册。这一期 creature 行只含基础字段；`habits`、`weaknesses`、`false_leads` 由 CK-D 接上。
- §180.5 `apply npc` 在 creature 上的接受与拒绝（`not_a_person`）。`creature` 字段留给 CK-E。
- 每处改动一条能被变异测试杀死的用例。夹具用自造的图：带数据卡的 creature 和一个人同场。

## CK-B 野兽目录数据（§180.6 后半）

Status: done（`45b5b0b50`，合入 `5bbc670ae`）。代码还没读它，所以 `tests/kernel/test_rules_tables_register.py` 暂把 `beasts` 列为未读表，CK-E 接上时删掉那一行

- 把规则书第 14 章「野兽」一节（PDF 第 347 页起）照录成 `content/rulesets/coc7/rules-json/beasts.json`。
- 只做数据，不改代码。每条逐页对照 PDF 图像，标 `source_page`；书里没印的写 `_unstated`，不从常识补。
- 条目形状对齐 `monsters.json`，并加上掷骰式、技能、栖息地。

## CK-C 读者、校验器、图谱契约 JSON（§180.2、180.7、180.8 的契约部分、180.9 的校验部分、180.13）

Status: done（`4e168ce3b`，合入 `d00f4f2ee`）。弱点闸门的输入是 `task.vocabulary.actor_weaknesses`，由 CK-D 接上

- `module-graph-contract-v3.json`：
  - 新增 `creature_dossier`；
  - 写入 `npc`、`creature` 的释义；
  - `weaknesses` 形状律；
  - `misleads` 端点律。
  - 先查这份 JSON 被哪些摘要或指纹盖章，一并重盖。
- `content/setup/visual-reader.md` 按 §180.13 增补，全文英文。
- 校验器：
  - `one_being_two_nodes`；
  - `weaknesses` 条目（`book` 必有，`needs` 与 `learned_by` 的解析和种类，`shape_unresolved` 带路径）；
  - `misleads` 端点。
  - weaknesses 只在绑定了 `actor.weaknesses.v1` 时才询问和校验。这一期先按契约预留开关，用夹具打开；正式的绑定在 CK-D。
- `task.vocabulary` 携带 `creature_dossier`。

## CK-D Mod 能力与 hostile-creatures 包（§180.8–180.11）

Status: ready-for-agent（2026-10-04 按 §183 重写后恢复）

- `graph.vocabulary.v1` 接受 `creature_profile_keys`：creature 词进入 spine、读者询问和 creature 行。
- `graph.vocabulary.table.v1` 的门接受 creature 词。
- `actor.weaknesses.v1`：
  - 构建时绑定，接上 CK-C 的闸门输入 `task.vocabulary.actor_weaknesses`，并写进来源记录；
  - 弱点链投影：`held_by`、`known_by`、`taught_by`、`found`/`of`，用现有读数；
  - `false_leads`；
  - 桌上补记门。
- §183 的状态门：
  - `people_present`、`present_without_history` 只数人；
  - 新增 `creature_present`、`weakness_here`。
- `mods/hostile-creatures` 1.0.0：`mod.json`、`agent.md`（不超过 4 KB）、`sections.json`、`CHANGELOG.md`，全英文，不带 brief。
- `docs/mods-catalogue.md` 加一条。

## CK-E 临场生物（§180.6 前半）

Status: ready-for-agent（2026-10-04 恢复）

- `apply npc` 新增 `creature` 字段：walk-on 铸造与之后补钉。
- `world.table_creatures`、`ModuleGraph.addTableCreature`，加载时重装。
- 规则目录的 creature 族同时读 `monsters.json` 与 `beasts.json`。
- 数据卡构建：有掷骰式就用种子骰掷，否则用平均值；书面写明的值保留；武器、`sanity_loss` 照 §180.6；钉进 `npc_profiles`，权威标 `table_pinned`。
- 拒绝情况：未知条目时 `details.options` 列出可选项；已有数据卡时 `stat_block_exists`。

## CK-F 起始包数据（§180.12）

Status: ready-for-agent（等 CK-D、CK-E 合入）

- the-haunting、the-haunting-rulebook、mystery-house 三个起始包；
- 更新钉住 `npc-rat-pack` 的测试；
- 重新盖 guidance 包的指纹。

只写书里写明的内容；Corbitt 的每条弱点都要能指到原书页码。

## CK-G 验收（§180.15）

Status: ready-for-agent（等 CK-F）

1. 盒子上跑全量；
2. 真产品路径：新开一局，读三次胶囊，再声明一条看门狗；
3. 真桌，结局预先写死。

真桌发现的缺陷归类后一批修完，再决定要不要开下一桌。

## Comments

**2026-10-04 恢复。** Mod 重构（§183）合入 0.9.6a@7b83acc22 后恢复：分支已同步，§180.10–180.11 已按 §183 重写；合入主线仍需用户明说。

**2026-10-04 收尾。** 用户要求尽快收尾，Mod 系统要重构，之后按重构后的系统实现剩下的部分。

**全量测试（leehow-pc，`d167ef3ca` 之后）。**

- `test:ext`：4535 个用例只剩 1 个失败，是 `npc-mood.test.mjs` 钉着 narration-craft 2.2.3，而主线已在 `0d7334861` 升到 2.2.4，属于主线基线。§176.8 的两条在 `untold-name-path.test.mjs` 退回原样后通过。
- pytest：2085 个用例只剩 `tests/kernel/test_jev_resolve.py` 的 2 个失败，也是主线基线：主线 `ae8dd5d93`（10-01）让没有数据卡的人也成为先手目标并进入 preparation，测试没跟着改。
- 第一轮全量暴露的 7 个回归已在 `d167ef3ca` 修复：
  - person 行不再带 `kind`；
  - 简报的 `creatures` 名册只用 parity 裁剪剩下的预算。

CK-A 交回时留下的未决点，接手时一并处理：

- `table.look focus=npc name=<creature>` 仍走只认人的查找，会拒绝 creature。留给 CK-D 的单生物读数。
- 不带名字的 `npc.perspectives`、台词归属车道的在场名册（`extensions/kernel/index.ts` 的 `state.roster`）仍会列出 creature；§180.3 的表里没有这两项，要补进表并定下归属。
- 0 HP 时的死亡折叠现在也会记到 creature 身上，但还没有任何地方读 creature 账本里的 `dead`。
- CK-B 发现 `monsters.json` 的 `source_page` 有几处和 PDF 页码对不上（Byakhee 差一页；Werewolf、Zombie 记 330，实际在 347），它的 `source_note` 把页码说成印刷页也不对。这些不在本切片范围。
