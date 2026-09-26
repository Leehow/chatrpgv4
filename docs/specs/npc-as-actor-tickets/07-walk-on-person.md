Status: ready-for-agent
Spec: docs/specs/npc-as-actor.md（D4）；docs/specs/npc-acts-for-the-party.md L3 与其第 3 条拍板

# 07 — 书上没有的人到场：轻路径

邻居闻声进门、路人被喊过来、警察到场。今天 `apply person` 只给已有的人起名，陌生人走 adaptation 子进程（创作者加审稿，L7383 `persistent_npc`），不是一回合能到的路。

## 裁定（2026-09-26，用户：「按你的推荐来」）

走 (a)：walk-on 不建图节点，是运行时人物；他的 slug 进入 §12.4 的名字解析与 §79 的桌上名表，否则 say 记号解析不到他。(b) 不做。下面保留两个方案的原文作为决策记录。

身份边界（记忆 `pi-identity-boundary-fails-closed`：未声明的 id 让 `ok:true` 变成 `semantic_identity_unavailable`）。两个方案：

- (a) **walk-on 不建节点**：`apply npc {name: "<桌上名>", to: "here", walk_on: true, archetype, why}` 在 `world.walk_ons[<slug>]` 建一条运行时人物（名、原型、钉的技能、在场），`present` 列出、`resolve` 能以他为 target 或 actor、账本按 slug 记；不进模组图，不进 `npc_knows`，战役结束即止。npc-acts 设计稿推荐这条。
- (b) 走 adaptation 的 `persistent_npc`，但给它一条同步快路径（不审稿、只创作者、超时降级到 (a)）。

我的建议是 (a)，理由同设计稿：不动模组图与世界状态的边界。需要用户裁定的是：walk-on 的 id 是否进入 §12.4 的名字解析与 §79 的桌上名表（我认为进，否则 say 记号解析不到他）。

## Depends on

- 无。02 之后做更顺（walk-on 当 actor 时走 02 的 `needs` 路径），不是硬依赖。

## Scope（按 (a)）

- `apply npc` 的 `walk_on: true` 变体；`world.walk_ons`；`npcsPresent` 与 `speakerResolver` 认 walk-on；`npcProfile` 从原型取数；账本条目按 slug；`apply npc to: away` 下场。
- 契约：§17.3 加 walk-on 段；§12.4 解析加一层。

## Not in scope

- walk-on 转正为图节点（需要时走 adaptation）。

## Acceptance

- `tests/kernel/test_walk_on.py`：到场、被当 target 打、说话解析到他、下场、战役重开后不在。
- 变异用例：删掉 `speakerResolver` 的 walk-on 层，「说话解析」必须红。
