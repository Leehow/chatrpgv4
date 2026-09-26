Status: ready-for-agent（2026-09-26，真桌 B T1 发现）
Spec: docs/specs/npc-acts-first.md（D1；第九节「B 桌」）

# 22 — 玩家的话只进说给他听的那个人的处境包；开场的生成行动用玩家语言

## 证据（真桌 `npc-acts-b`）

- T1：玩家对克兰说「这活我接了。钥匙和钱给我，我先去环球报翻翻旧报纸。」书记员同一回合把他移到环球报；亚瑟被作用触发生成，处境包 `happened` 的最后一条永远是玩家这回合的原话（工单 01 的实现：kernel 没有 addressee，于是「总是带上」）。生成器于是写「亚瑟把钥匙从抽屉里拿出来……又数出几张钞票推过去」——把克兰的委托演到了亚瑟身上，KP 照着写进了正文。
- T0（开场）：克兰的生成行动是英文（「Crane clears his throat and asks 林默…」），这桌是 zh-Hans。

## Scope

1. `npc.situation` 接受可选 `addressed: boolean` 与 `declared_before_move: boolean`（宿主从 compile 的 addressee 与本回合落地的 move 顺序得出，§139.4 的扫描已持有这两样）：玩家原话只在「他被点名，或他在对话中（工单 21），且这句话不是在移动到他这里之前说的」时放进 `happened`；否则放一句代码拼的「the investigator has just arrived here」之类的结构句（或什么都不放），不放原话。
2. 生成车道的输入永远带 `play_language`（从战役读，不从会话状态读）；查清 T0 开场那次为什么是英文（开场回合的 run 是否在 play_language 可读之前起步），修掉并加用例。
3. 契约 §139.1 与 §139.2 各加带日期的注，§139.21。

## Acceptance

- pytest：同一回合先 move 再到场的人，`npc.situation`（带 `declared_before_move: true`）的 `happened` 不含玩家原话；被点名的人含。
- ext：开场回合的生成请求里 `play_language` 是战役的语言（夹具断言请求体）。
- 变异：把原话恢复成总是带上 → 第一条逮住。
