# 回合没有交付：「这一回合结束时没有交付结果」

Status: needs-triage

交接文档（2026-10-02，Claude 写）。owner 原话：「怎么出现『这一回合结束时没有交付结果。已经结算的内容都还在——随便说句话就能继续。』这个严重问题已经出现很多次了！很多用户都是因为这个跑掉的！」；处理方式由 owner 交给另一个 AI，方案未定，见文末「待 owner 定的」。

## 现象

玩家发出一句话，等了几十秒，没有任何故事正文，只看到宿主的提示行 `turn_unfinished_notice`（`content/ui/zh-Hans/extension.json:94`）。已经结算的机制（时间、物品）还在，但玩家这一回合什么也没读到，只能「随便说句话」再来。

## 发生了多少次（已装机 App 的全部会话，2026-10-02 扫描）

会话目录：`~/Library/Application Support/Pipi/pipicoc/pi-coc/agent/ui-sessions/play/`。判据：`coc-telemetry` 行 `{lane: "delivery", reason: "turn_unfinished_notice"}`。51 个会话，12 次，5 个会话；其中 `2026-09-18T05-29-47-241Z_b4984…` 是 `2026-09-17T08-51-32-812Z_68b59…` 的分支副本（同两次），去重后 10 次。

| 会话（相对上面目录） | 回合 | 走到「不交付」的路径 |
|---|---|---|
| `%2F…chatrpgv4-wt-pi-coc-v2/2026-09-14T17-20-14-934Z_0c01381d…` | 4 | 模型流断：`Stream ended without finish_reason`，随后 `Request was aborted`；无草稿 |
| 同上 | 5、6 | `Request was aborted`；无草稿 |
| 同上 | 7 | `narrate` 被拒 `needs / mod_narrative_repair` → KP 去 `lookup` → 停下，不再交稿 |
| 同上 | 8、9 | `narrate` 被拒 `needs` → KP 停下 |
| `…pdf-opening-app-20260910/2026-09-17T08-51-32-812Z_68b5934a…` | 6 | 请求中断，`abandoned_not_steered` |
| 同上 | 8 | `apply` 被挡 `blocked / preparation_wait`；`narrate` 被拒 `mod_narrative_repair`；再 `apply` 又被挡；无交付 |
| `…jev-gui-20260922/2026-09-23T13-37-36-927Z_d33d44c1…` | 2 | KP `resolve`（说服）后直接 `stop`，一个字没写 |
| `…jev-gui-20260928/2026-10-02T02-03-41-072Z_1d528729…`（战役 `game-3a9734c5-e19d-4f70-8391-928f1afd7742`） | 4 | 见下节 |

三类路径：
1. **交付闸门拒稿、修改机会用完**（5 次）：Mod 审计 `mod_narrative_repair`、准备等待 `preparation_wait`、2026-10-01 新加的玩家选择闸门 `forced_player_choice_cue_review`。
2. **模型接口出错或中断，没有草稿**（4 次）。
3. **KP 自己停下、没写正文**（1 次）。

9 月那 11 次的 `turn_close` 行没记下「为什么收场」（当时的遥测没有这个字段），原因是逐条读会话里的助手消息和拒绝行推出来的。

## 最近一次的完整经过（2026-10-02，回合 4）

玩家：「我把执照收回来，压低声音说：就看一眼，不抄不带走，看完原样放回。要实在不行，你告诉我楼下管剪报的人叫什么，我改天带房东的条子再来，不耽误你截稿。」

1. 模组义务 `requirement-globe-clippings-access`（`content/starters/the-haunting/module-graph.json`：威尔莫特拒绝进剪报室，常规说服/恐吓/魅惑/话术可过）被触发；Jev 判「用哪项社交技能」低于门槛，按 §163.8（owner 2026-10-01「玩家的选择不替他定」）不替玩家选、不掷骰，记 `player_choice` no-roll，KP 应只写到结果之前、由场上人物把选择递还玩家。
2. KP（grok-4.7 low）以隐式交付写了正文。玩家选择闸门（`runtime/jev/forced-resolution.ts`：两个 Jev Noul，「结尾是否把选择递还给玩家」须 ≥ `FORCED_CHOICE_CUE_MIN = 0.60`，「是否替玩家写了成败」须 ≤ `FORCED_CHOICE_OUTCOME_MAX = 0.25`）判第一版 cue 0.83 / outcome 0.51 → 拒。
3. 宿主发一次修改指示（`turn_close status: steer`）。KP 写第二版：cue 0.90 / outcome 0.31 → 又拒。
4. `takeTurnCloseSteer` 发现本回合已经修过一次，返回 `{ none: "steer_spent" }`（`extensions/kernel/index.ts` 约 1577 行），回合以无交付收场，`stranded`，宿主显示 `turn_unfinished_notice`（约 3765 行）。两版正文都被丢掉。

这道闸门是 2026-10-01 另一会话加的：`3dfabf67c`（14:53）、`be770fe63`（18:48 guard delivery for forced player choices）、`745fa25cc`（19:15 keep forced choice narration recoverable）、`673fee420`、`9bf389a75`（allow one bounded choice narration repair）。

## 相关代码

- `extensions/kernel/index.ts`
  - `takeTurnCloseSteer`（约 1570–1610）：每回合只有一次修改指示（`steeredThisTurn`），用完返回 `steer_spent`。
  - 约 2163：`settled_without_delivery`。
  - 约 3765：显示 `turn_unfinished_notice`。
  - 约 7057：`abandoned_not_steered`（请求中断后不再推 KP）。
  - `forcedPlayerChoiceCue*` 状态与闸门调用（约 328–333、1405–1425、2535–2551）。
- `runtime/jev/forced-resolution.ts`：玩家选择闸门的两道问题与门槛。
- `runtime/jev/hybrid-engine.ts` 约 1798：同一闸门在单循环里的遥测。
- 契约：§135.11（turn-close 指示）、§158（已讲出的是定论，只向前圆）、§163 / §163.8（拿不准也出结果；玩家的选择不替他定）。

## 需要守住的 owner 裁定

- **§158**：已讲出的故事是定论，账追故事，向前圆，不认错。
- **§163.8**：玩家自己的选择（社交手段、目标、防御方式等）不替玩家定。
- **真实产品测试**：验收要走 App 或 driver 的真桌，主会话 live KP、一回合一回合玩，不许用脚本批量刷（Agents.md「Absolute Ban: Fake-KP Shortcut Scripts」）。
- **改动前先看全局**（Agents.md「System Gap Before Instance Patch」）：不要只修 2026-10-02 这一道闸门，三类路径都走到同一个结局。

## 待 owner 定的（Claude 提过、owner 尚未拍板）

共同的缺口：回合会因多种原因收不了尾，而宿主在任何一条路径的尽头都没有兜底，只给提示行。Claude 提过的方向（**未获批准，仅供参考**）：

1. 质量闸门最多要求改一次；改完仍不过，交付最后一版并记账，由交付后的复核按 §158 向前圆。玩家选择类是否照样交付（可能替玩家写了结果，与 §163.8 冲突）、还是只交提示加选择卡片，需要 owner 定。
2. 模型出错、中断或沉默且没有草稿时，宿主自动重跑一次再放弃。
3. 每次显示提示行都记下收场原因（闸门名、错误码），以后能按原因统计。

owner 当时追问了「闸门是什么、为什么要拦玩家选择、为什么时有时无」，Claude 的解释在原对话里；要点已写进上面「最近一次的完整经过」。

## 复现与验收建议

- 复现：已装机 App 打开上表最后一个会话可直接看到第 4 回合；或新开「鬼屋」，到报馆找威尔莫特，用含糊的社交说法（不点明技能）求他放行，重复几次。
- 验收：真桌上把三类路径都走到（模型出错那一类需要人为制造一次接口失败），每一类的回合都要有玩家能读的正文，或者明确记下原因的提示；另跑盒子三套件。
