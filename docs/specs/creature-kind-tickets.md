# 人与生物分开：工单

Spec：[creature-kind.md](creature-kind.md)。契约：`docs/kernel-rpc.md` §180。分支：`claude/creature-kind-20261004`（worktree `~/leehow/code/chatrpgv4-wt-creature-kind`）。

顺序：CK-01 → CK-02 → CK-03 → CK-04 → CK-05。CK-02 和 CK-03 都只依赖 CK-01，可以并行；CK-04 必须等 CK-02 合入（见 spec「只迁数据会更糟」）。

## CK-01 契约 §180 与图谱契约 JSON

Status: needs-triage

- `docs/kernel-rpc.md` 新开 §180，写入 spec 的 D1–D14 形状，并标注它修订了哪些旧节：
  - amends §136.12：`actor()` 的 npc 优先只用于旧快照的裁决；
  - amends §17.2：档案分出 `creature_dossier`；
  - 另外点名 §143.3 的行动方式和 §26 的 Mod 检定。
- §180 里放 CK-02 那张逐消费端的归属表，作为唯一规范。
- `content/modules/module-graph-contract-v3.json`：
  - 新增 `creature_dossier`（`profile_keys: ["habits", "weaknesses"]`，带 labels、why、law）；
  - `actor_dossier.profile_keys` 加 `weaknesses`；
  - 写明 `reveals` 的定律：只从 `clue` 指向 `npc` 或 `creature`；
  - 给 `npc` 和 `creature` 写上释义。
- 先查这份 JSON 的字节会被哪些摘要或指纹盖章（guidance 指纹、contract digest），改了要一并重盖。

## CK-02 内核：人和身体按功能分开

Status: needs-triage

**新增**

- `ModuleGraph.isPerson(node)`。
- `creatureEntry`：present[] 里 creature 的一行，字段为 `name`、`kind: "creature"`，以及有值才出现的 `state`、`habits`、`weaknesses`、`learned_from`、`combat`、`keeper_note`、`toward_party`。
- `moduleSection` 加 `creatures` 名册。
- `learned_from`：由 `reveals`、`discoverable-at`、`knows` 和 `world.discovered_clues` 推出。npc 行有 `weaknesses` 时同样带上。

**逐个消费端**（行号以 `fcb8655e1` 为准）：

| 位置 | 功能 | 归属 | 改动 |
| --- | --- | --- | --- |
| `read/capsule.ts:384` `npcsPresent` | 谁在场 | actor | 不变 |
| `read/capsule.ts:624` `presentSection` | present[] | 人用 `npcEntry`，creature 用 `creatureEntry` | 分流 |
| `read/capsule.ts:133` `untoldBlock`、`:167` `untoldRoster` | 未告知块与揭名 | 人 | 只对人 |
| `read/capsule.ts:890` `moduleSection` | 简报名册 | 两份 | 加 `creatures` |
| `runtime/check-catalog.ts:199-206` | 社交、心理学选项 | 人 | 过滤 |
| 同上，`opposed-check` | 对抗检定 | actor | 不变 |
| `npc/index.ts:72` `npc.job` | 性格作者 | 人 | 列人时过滤，与 `npc.submit` 一致 |
| `npc/act-options.ts:186,203` | `coercion`、`walk_on` 方式 | 人 | creature 不提供 |
| `npc/act-options.ts`、`apply/draw.ts`、`apply/entities.ts` 的 `_draws`/`_produces` | 拿出物件 | 人 | creature 不提供 |
| `runtime/jev/npc-act-step.ts`（作者输入） | 行动作者读什么 | 人读性格，creature 读 `habits` | 分流 |
| `apply/entities.ts:204` `stageNpc` | mood、reunion、walk_on | 人 | creature 上拒绝，带 `fix` |
| `apply/person.ts` | `apply person` | 人 | creature 上拒绝 |
| `epithets/index.ts:56`、`read/person-words.ts` | 外号 | 人 | 已只认 npc；补用例 |
| `voice/jobs.ts:107` | 声线 | 人 | 已只认 npc；补用例 |
| `journal/jobs.ts:104-116` | 日志 | 人 | 已只认 npc；补用例 |
| `memory/jobs.ts:256`、`write/contributions.ts:198-228` | 记忆、立场账 | 人 | 已只认 npc；补用例 |
| `mods/resolve.ts:120` | 初见（含 §178 照面） | 人 | 见 D14 |
| `extensions/table/expression-reference.ts:12-31` | 表情卡名册 | 人 | 过滤，需要宿主知道种类 |
| `write/speech.ts:60`、`speech/index.ts:100` | 台词说话人 | 人 | creature 当标签处理 |
| `sanity/index.ts:100-102` | 理智目击去重 | actor | 改为 actor |
| `read/session-view.ts:32` | 战斗标签 | actor | 改为 actor |
| `healing/patient.ts:43` | 急救对象 | actor | 改为 actor |
| `resolve/projection.ts:198`、`mods/effects.ts:18` | 收据标记、资源效果 | 实现时逐一定 | 写进 §180 |
| `apply/inventory.ts:151`、`runtime/fulfillment-options.ts:90` | 现金对方、承诺付款方 | 人 | 不变 |

**测试**：每处改动配一条能被变异测试杀死的用例。夹具用自造的图：带数据卡的 creature 在场，另有一个同场的人做对照。不靠发货的起始包，也不靠会补齐输入的测试辅助（「测试辅助会把缺陷藏起来」那条教训）。

## CK-03 读者与校验器

Status: needs-triage

- `content/setup/visual-reader.md`：写入 D1 的界线、档案键、弱点线索的 `reveals` 写法和记账律。全文英文。
- 读者任务的 `task.vocabulary` 带上 `creature_dossier`。
- 校验器：
  - `reveals` 的两端必须是 `clue` → `npc`/`creature`；
  - 同一份草稿里 npc 与 creature 同名或同 handle 时拒绝，错误码要可行动，`fix` 写明合成一个节点。
- 复核的 coverage：书里写明的习性和弱点是应覆盖的材料。
- 量度：`creatures_without_material`，与 `npcs_without_material` 同法，只报不拒。

## CK-04 数据迁移

Status: needs-triage（阻塞于 CK-02 合入）

按 spec D15：

- the-haunting、the-haunting-rulebook、mystery-house 三个起始包；
- 重新盖 guidance 包的指纹；
- 更新钉住 `npc-rat-pack` 的测试；
- mystery-house 的使魔带一条标明的薄样例，跑通「弱点—线索—任务」链。

习性和弱点只写书里写明的。the-haunting 编造的 fear、secret、agenda、voice 不迁。

## CK-05 验收

Status: needs-triage

按 spec「验收」三步：

1. 盒子全量（amax 优先）；
2. 真产品路径：新开两局，读真实胶囊；
3. 真桌：the-haunting 地下室，15 到 20 回合，结局预先写死。

真桌发现的缺陷归类后一批修完，再决定要不要开下一桌。

## Comments
