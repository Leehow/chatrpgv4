Status: ready-for-agent
Spec: docs/specs/npc-as-actor.md（D4）；吸收 docs/specs/npc-acts-for-the-party.md 的 L1、L2，并落它第 1、2 条拍板（不推导技能；`apply npc skill` 钉数——后者已实现，契约 L1887）

# 04 — NPC 在战斗外用自己的本事

诺特打电话、医生缝手、锁匠开锁、NPC 威吓调查员：`actor` 写 NPC 名不再要求当场有战斗，掷的是他的数。

## Depends on

- 02（`needs` 的拒绝路径与 `intent_ref`）。

## Scope

- L1（设计稿）：`npcProfile` 同时读 starter 形状与构建书的扁平 `properties`（记忆 `authored-profile-vs-runtime-flat-shape`）；这是地基，先做。
- L2：契约 L809「NPC 作 actor 只在它参与的战斗或追逐里被接受」改为：session 内照旧；session 外，`actor` 为 NPC 时 `npc_in_session=false`、`npc_actor=true`，路由不推向 combat，按 family 正常绑定，技能取 `npcProfile`（书上 → 钉过的 → 无则 `needs`，不从特征值推导）。`kernel-ts/resolve/pipeline.ts:159` 的 `npcInSession` 与新的 `npcActor` 分开。
- healing 族：`rescuer_ref` 改用行动者 id（设计稿点名的写死处）。
- social / psychology 族：`resolve/basic.ts:65,117` 的 `actor = args.investigator || context.actorId` 改为允许 NPC 行动者、调查员目标（NPC 威吓、说服、看穿调查员）；对调查员的社交结算不写 stance（stance 是 NPC 对队伍的账），只出 roll 收据与 `intent_ref`；目标是调查员时 `support`/`motive` 字段按现有语义反向解释，契约写明。
- 契约：§5 `actor` 适用范围、§11.4 槽位绑定、L809 路由表、§17.9 回链。

## Not in scope

- 书里根本没有的人（L3，工单 07）。
- 在场以外的 NPC（不在 `present` 里的人不能行动，现状保持）。

## Acceptance

- `tests/kernel/test_npc_actor_outside_session.py`：无战斗时 `actor: <npc>` 走 core-check 掷他的数；书没写、没钉 → `needs` 指向 `apply npc skill`；healing 的施救者是 NPC 时掷 NPC 的医药；NPC 对调查员 Intimidate 出 roll、不动 stance。
- 变异用例：把 `rescuer_ref` 改回 `context.actorId`，医生用例必须红。
- 构建书夹具（扁平 `properties`）上 `npcProfile` 非空；变异删掉扁平读取必须红。
