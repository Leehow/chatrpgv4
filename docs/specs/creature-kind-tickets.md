# 人与生物分开 + 敌对生物 Mod：工单

Spec：[creature-kind.md](creature-kind.md)；依据：[creature-kind-survey.md](creature-kind-survey.md)；**形状以契约 §180 为准**（`docs/kernel-rpc.md`）。集成分支：`claude/creature-kind-20261004`（worktree `~/leehow/code/chatrpgv4-wt-creature-kind`），由 lead 合并、提交、跑全量与验收。

分三期：

- 第 1 期并行：CK-A、CK-B、CK-C；
- 第 2 期并行：CK-D、CK-E，依赖第 1 期合入；
- 第 3 期：CK-F；
- 最后 CK-G 验收。

每个 worker 用自己的 worktree 和分支 `claude/creature-kind-20261004-<topic>`，可以在自己分支上提交，交回时报提交号。

## CK-A 内核：人和身体按功能分开（§180.3–180.5）

Status: ready-for-agent

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

Status: ready-for-agent

- 把规则书第 14 章「野兽」一节（PDF 第 347 页起）照录成 `content/rulesets/coc7/rules-json/beasts.json`。
- 只做数据，不改代码。每条逐页对照 PDF 图像，标 `source_page`；书里没印的写 `_unstated`，不从常识补。
- 条目形状对齐 `monsters.json`，并加上掷骰式、技能、栖息地。

## CK-C 读者、校验器、图谱契约 JSON（§180.2、180.7、180.8 的契约部分、180.9 的校验部分、180.13）

Status: ready-for-agent

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

Status: ready-for-agent（等第 1 期合入）

- `graph.vocabulary.v1` 接受 `creature_profile_keys`；creature 词进入 spine、读者询问、creature 行。
- `graph.vocabulary.table.v1` 的门接受 creature 词。
- `actor.weaknesses.v1`：
  - 构建时绑定，并写进来源记录；
  - 弱点链投影（`held_by`、`known_by`、`taught_by`、`found`/`of`），用现有读数；
  - `false_leads`；
  - 桌上补记门。
- `context.creature.v1`：限定范围的指令与 400 字节预算（`creature_brief_over_budget`），并更新两个上限测试。
- `mods/hostile-creatures` 1.0.0：`mod.json`、`agent.md`、`brief.md`、`CHANGELOG.md`，全部英文。

## CK-E 临场生物（§180.6 前半）

Status: ready-for-agent（等第 1 期合入）

- `apply npc` 新增 `creature` 字段：walk-on 铸造与之后补钉。
- `world.table_creatures`、`ModuleGraph.addTableCreature`，加载时重装。
- 规则目录的 creature 族同时读 `monsters.json` 与 `beasts.json`。
- 数据卡构建：有掷骰式就用种子骰掷，否则用平均值；书面写明的值保留；武器、`sanity_loss` 照 §180.6；钉进 `npc_profiles`，权威标 `table_pinned`。
- 拒绝情况：未知条目时 `details.options` 列出可选项；已有数据卡时 `stat_block_exists`。

## CK-F 起始包数据（§180.12）

Status: needs-triage（等第 2 期合入）

- the-haunting、the-haunting-rulebook、mystery-house 三个起始包；
- 更新钉住 `npc-rat-pack` 的测试；
- 重新盖 guidance 包的指纹。

只写书里写明的内容；Corbitt 的每条弱点都要能指到原书页码。

## CK-G 验收（§180.15）

Status: needs-triage

1. 盒子上跑全量；
2. 真产品路径：新开一局，读三次胶囊，再声明一条看门狗；
3. 真桌，结局预先写死。

真桌发现的缺陷归类后一批修完，再决定要不要开下一桌。

## Comments
