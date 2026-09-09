# 内核 RPC 契约与回合事务

The versioned gameplay Mod interface is specified in section 26. Mod packages do not import kernel internals or Pi objects.

本文件是 Pi 扩展与 Python 内核之间的唯一契约。两侧的实现和两道接缝的测试都以它为准；改契约先改这里。范围标注为「切片 0」的是本轮必须实现的，标注为「保留」的只需要方法存在并返回 `not_implemented` 错误，形状不变。

PDF 直接阅读与按需构图的目标契约见 §22（2026-09-07，待实现）。涉及 PDF/读者/模组车道的后续实现以 §22 为准；§14 与 §20 的旧流水线在切换验收前仅描述现有运行时。实施与退役顺序见 [规格](specs/visual-pdf-reader.md)。

规格全文见 GitHub issue #12，切片 0 的验收见 #13。

## 1. 进程与传输

- 一个 Pi 会话一个内核子进程。扩展在 `session_start` 拉起，`session_shutdown` 关闭。
- 启动命令：`uv run --frozen python -m coc.rpc --workspace <dir> --content <dir>`，在仓库根目录执行。`--workspace` 是战役状态所在的目录，内核只在其 `.coc/` 下读写；`--content` 是只读内容目录，含 `rulesets/coc7` 与 `starters/<module>`。
- stdin 收请求，stdout 发响应，一行一个 JSON 对象，`\n` 分隔，UTF-8。stderr 只写日志。
- 请求：`{"id": "<string>", "method": "<string>", "params": {...}}`。
- 成功：`{"id": "<同请求>", "ok": true, "result": {...}}`。
- 失败：`{"id": "<同请求>", "ok": false, "error": {"code": "<闭合枚举>", "message": "<给模型看的一句话>", "fix": "<可直接照做的修正，可省略>", "details": {...可省略}}}`。
- 进度帧（本切片）：请求可带顶层字段 `"progress": true`（不进 `params`，不参与 `call_id` 的幂等哈希）。只在此标记存在时，内核才允许在最终响应之前发零或多条进度帧：`{"id": "<同请求>", "progress": {"stage": "<该方法小节的闭合枚举>", "detail"?: "<一句英文>", "at": "<iso>"}}`。进度帧不结算调用：客户端仍以 `ok`/`error` 帧为准；进度帧不得携带结果数据。未请求 `progress` 的调用永远收不到进度帧——旧客户端、驾驭器与 §23 的 Electron 桥的字节流形状不变。
- 内核不并发处理请求：按到达顺序逐个执行。扩展负责序列化。
- 内核崩溃或退出时扩展重新拉起并调用 `table.open`；所有状态都在磁盘上，内核进程无内存权威。

错误码闭合枚举：`invalid_params`、`unknown_method`、`not_implemented`、`campaign_not_found`、`campaign_not_ready`、`turn_state`（当前回合状态不允许该方法）、`idempotency_conflict`、`needs`（缺少可补的输入，`details.needs` 给字段与可选值）、`needs_choice`（多个互斥候选，`details.candidates`）、`unknown_entity`（名字在模组图与世界状态中都找不到，`details.candidates` 给相近名字）、`not_reachable`（移动目的地不可达）、`not_here`（线索不在当前场景可得）、`commit_failed`（git 提交失败，回合未关闭）、`internal`。

Section 26 adds two closed host-document error codes: `not_owned` refuses access
after ownership changes; `revision_conflict` refuses a stale document/worldline
write while preserving the client draft. Hot and cold UI bridges retain these codes.

### 1.1 内核的决定（进度帧）

- **opt-in 而不是常开。** 进度帧只在请求带顶层 `"progress": true` 时发出：驾驭器、§23 的 Electron 桥与任何旧客户端的字节流一行不多，不需要同时改。字段放顶层而不进 `params`，是为了不碰 `call_id` 幂等哈希（§2）。
- **帧是真实阶段边界，不是心跳。** 内核只在流水线真的走过一个阶段时发帧，不发定时器，不报「预计剩余」；慢的真相（比如 git 提交占大头）由帧间间隔自己说出来，不被平滑掉。
- **Python 对照暂不发帧。** 生产内核是 `kernel-ts`；`kernel/coc/table.py` 的 RPC 对照保持一问一答，需要对照进度帧时另行补。

## 2. 标识法

- 模型可见的一切标识都是名字或语义 id：场景用图上的 `scene_id` 去掉 `scene-` 前缀后的 kebab 名，也接受图上的 `display_name` 与 `name`；NPC、线索、物品同理接受 id 或名字，内核做归一化，歧义时报 `unknown_entity` 并给候选。
- 回合号 `turn` 是从 1 起的整数。开桌那一回合是 0，只有 `narrate` 的开场交付，没有玩家输入。
- `call_id` 由扩展铸造：`t<turn>-c<n>`，`n` 是该回合内会改状态的调用序号，从 1 起。模型永远不写 `call_id`。同 `call_id` 同参数返回原结果并带 `"replayed": true`；同 `call_id` 不同参数报 `idempotency_conflict`。参数比较用规范化 JSON 的 sha256。
- 收据 id 由内核铸造，语义化，`<n>` 是该调用的 `call_id` 序号：`roll:<技能 kebab>-t<turn>-c<n>`、`move:<目的地>-t<turn>-c<n>`、`clue:<线索 kebab>-t<turn>`、`time:t<turn>-c<n>`（同批第二条起加 `-2`、`-3`）、`choice:<待决名>-t<turn>`。哈希、摘要、随机 id 不出内核。

## 3. 存储布局

工作区下：

```
.coc/
  campaigns/<campaign_id>/
    campaign.json        战役元数据：id、title、module_id、module_digest、play_language、status、created_at、opening_scene
    world.json           世界状态：active_scene、scene_trail、scene_labels（守秘人给过的场景短名）、visited_scenes、discovered_clues、flags、clock、npc_presence
    party/<inv_id>.json  调查员表：来自 pregen 或建卡，含 characteristics、derived、skills、weapons、equipment，加运行时 current_hp/current_san/current_mp/current_luck
    turn.json            当前回合游标：{turn, state, player_text, opened_at, calls: {call_id: {params_sha256, result}}, receipts: [...], pending_choice, capsule}
    turns/<NNNN>.json    已关闭回合的完整记录：玩家原文、收据、rendered_text、commit、world 快照、facts、warnings、capsule（守秘人这一回合拿到的胶囊，规格第十三节的证据）
    transcript.jsonl     逐字记录：{turn, role: player|keeper, text, at}
    events.jsonl         事件流，十八类 canonical 事件见第 7 节
    save/continuation/latest.json   续行检查点：最近一次提交的回合摘要，可重建的缓存（12.2）
    memory/episodes.jsonl           每个已提交回合一条 episode（12.3）
    memory/candidates.jsonl         候选断言，只增不删；矛盾用 superseded_by 关闭（12.3）
    memory/jobs/<job_id>.json       抽取任务包与结果，整文件原子写（12.3）
    memory/backlog.jsonl            抽取失败或被拒的任务，显式可恢复（12.3）
  repos/<campaign_id>.git   sidecar 裸仓库，战役目录是其工作树；每次 narrate 成功后一次提交（ADR-0001）
  playtests/<run_id>/       真桌证据，由驾驭器写
```

内容目录只读：`content/rulesets/coc7/rule-graph.json`、`content/rulesets/coc7/rules-json/*.json`、`content/starters/<module>/module-graph.json`、`content/starters/<module>/pregens/<id>/character.json`。

## 4. 回合状态机

`turn.json` 的 `state` 取值与转移：

```
awaiting_player  --table.player_input-->  open
open             --任一 look/lookup/recall/resolve/apply-->  acting     （read 也算进入 acting）
open|acting      --table.ask-->            asked      回合关闭，等玩家回答
open|acting      --table.narrate-->        committed  事件批与 git 提交已落
committed        --扩展交付完成后自动-->    awaiting_player（turn+1）

`committed` 是一个时刻，不是 `turn.json.state` 存得下的值：`narrate` 成功后内核直接写下一回合的 `awaiting_player`，代码里 grep 不到这个状态字符串。它表示「这一回合的记录、事件批与 git 提交已落」。
asked            --table.player_input-->   open       新回合，胶囊带出待决
```

- `awaiting_player` 与 `committed` 期间，除 `table.open`、`table.status`、`table.capsule`、`table.look`、`table.lookup`、`table.recall` 外一切方法报 `turn_state`。
- `narrate` 成功后内核自行把状态推到 `awaiting_player` 并递增 `turn`；「交付完成」是扩展侧的事，内核不等待。
- `table.open` 返回时若 `turn.json` 的 `state` 是 `open` 或 `acting`，说明上次进程在回合中途结束：返回 `pending_turn`，含玩家原文、已落收据、尚欠的步骤描述；扩展把它注入给守秘人接着做完。

## 5. 方法

参数里 `campaign` 一律必填，下面省略。

### kernel.hello（切片 0）
result：`{"kernel_version": "...", "content": {"rulesets": ["coc7"], "modules": ["the-haunting"]}}`。

### campaign.list（切片 0）
result：`{"campaigns": [{"id", "title", "module_id", "status", "turn"}]}`。

### campaign.create（切片 0）
params：`{"id", "module": "the-haunting", "pregen": "thomas-hayes", "play_language": "zh-Hans", "title"?}`。
- 复制 pregen 表进 `party/`，写 `campaign.json`（`status: "active"`），`world.json` 的 `active_scene` 取模组图中 `is_start: true` 的场景，初始化 sidecar 仓库并做首次提交。
result：`{"campaign": {...campaign.json}}`。`id` 已存在报 `invalid_params`。

### table.open（切片 0）
result：
```
{
  "campaign": {...},
  "turn": {"number": int, "state": "..."},
  "investigators": [{"id", "name", "occupation", "hp", "san", "mp", "luck"}],
  "scene": {"name", "display_name"},
  "pending_turn": null | {"player_text", "receipts": [...], "owed": ["narrate"], "since": "<iso>", "last_call_ordinal": int},
  "opening_needed": bool   首次开桌为 true：turn 0 尚未 narrate
}
```

### table.player_input（切片 0）
params：`{"text": "<玩家原文>"}`。
- 状态必须是 `awaiting_player` 或 `asked`，否则 `turn_state`。写逐字记录，开新回合，`turn.json` 进 `open`，发 `turn-started` 与 `player-declared` 事件。
result：`{"turn": int, "state": "open", "capsule": {...见第 6 节}}`。

### table.capsule（切片 0）
result：胶囊，同第 6 节。任何状态可调。

### table.status（切片 0）
result：`{"turn": int, "state": "...", "receipts": [...本回合收据摘要], "pending_choice": null | {...}}`。

### table.look（切片 0）
params：`{"focus"?: "scene"|"npc"|"investigator"|"clues"|"time", "name"?: "<实体名>"}`。
- 缺省等价于 `focus: "scene"`。`focus: "npc"` 且给 `name` 返回该 NPC 的完整守秘人视图：agenda、fear、secret、voice、relationship、keeper_note、social_role、已知事实。`focus: "investigator"` 返回当前调查员表的玩家可见部分加运行时数值。`focus: "clues"` 返回已发现与当前场景可得的线索。`focus: "time"` 返回世界时钟。
result：见第 6 节的 `where`、`present`、`known`，按 focus 取子集；`npc` 与 `investigator` 返回单实体对象。

### table.lookup（切片 0：module、secret；保留：rule、catalog）
params：`{"kind": "module"|"secret"|"rule"|"catalog", "query": "<名字或问题>", "scope"?: "scene"|"module"}`。
- `module`：在模组图节点名、别名、摘要上做归一化子串匹配，返回最多 8 个实体：`{"name", "kind", "summary", "visibility", "relations": [{"kind", "to"}]}`。
- `secret`：`scope` 缺省 `scene`。返回当前场景的守秘人专属简报：`{"scene": {...dramatic_question, pressure_moves, keeper_notes}, "undiscovered_clues": [{"name", "summary", "delivery_kind"}], "npc_secrets": [{"name", "secret", "agenda"}], "module_secrets": [{"name", "summary"}]}`。`scope: "module"` 给整模组的 `secret` 与 `conclusion` 节点。
- `rule`、`catalog`：报 `not_implemented`。

### table.recall（切片 0：transcript；切片 2 三路齐全，见 12.4）
params：`{"what": "transcript"|"memory"|"history", ...}`，三路各自的参数与结果在 12.4。
- `transcript`：返回区间内逐字记录，缺省最近 3 回合；切片 2 加候选卡与经摘要校验的原文读取。

### table.resolve（切片 0：普通检定；切片 1 全族见第 11 节）
params：
```
{"call_id": "t3-c1",
 "action": {
   "actor"?: "<调查员名或 id，缺省当前唯一调查员>",
   "intent": "investigate"|"social"|"move"|"combat"|"flee"|"cast"|"idle"|"meta"|"stuck"|"ambiguous"|"montage",
   "goal": "<一句话：想达成什么>",
   "method": "<一句话：怎么做；通常含技能名>",
   "target"?: "<NPC 或物件名>",
   "stakes"?: "<失败后果一句话>",
   "modifiers"?: {"bonus_dice"?: 0|1|2, "penalty_dice"?: 0|1|2, "difficulty"?: "regular"|"hard"|"extreme"},
   "skill"?: "<显式技能或特征名，优先于从 method 推断>",
   "choice"?: {"pending": "<待决名>", "option": "<选项>"},
   "decision"?: "<候选名>"
 }}
```
切片 0 的流水线：
1. `intent` 为 `idle`、`meta`、`stuck`、`ambiguous` 时不掷骰，返回 `{"outcome": {"kind": "none"}, "note": "..."}`，不写收据。`combat`、`flee`、`cast` 在切片 0 报 `not_implemented` 并说明留待切片 1。
2. 技能解析：`skill` 显式给出则用它；否则在 `method` 与 `goal` 里查调查员表的技能名与特征名（含中英双向的规则术语表）。找不到唯一匹配报 `needs`，`details.needs = {"field": "skill", "options": [表上最相关的 6 个技能名]}`。特征检定（STR、DEX、INT、POW、CON、APP、SIZ、EDU、LUCK）目标值取特征值。
3. 目标值取调查员表上的技能值；表上没有的技能按 coc7 规则表的基础值。
4. 调用 coc7 的百分骰检定（旧仓库 `coc_roll.percentile_check` 的算法，含奖励惩罚骰与成功等级），难度缺省 regular。
5. 写收据、写 `roll-resolved` 事件、回合 `receipts` 追加。
result：
```
{"receipt": "roll:spot-hidden-t3-c1",
 "outcome": {"kind": "check", "skill": "Spot Hidden", "target": 55, "difficulty": "regular", "threshold": 55,
             "roll": 42, "level": "regular"|"hard"|"extreme"|"critical"|"failure"|"fumble", "passed": true,
             "bonus": 0, "penalty": 0},
 "session": null, "pending_choice": null, "continuations": [],
 "rule_refs": ["percentile-check", ...]}
```
成功等级定义随规则表：大成功 1，极难 ≤1/5，困难 ≤1/2，普通 ≤目标，大失败 96 到 100（目标 <50）或 100。

### table.apply（切片 0：move、clue、time；切片 1 damage；切片 4 handout；#19 item、cash；保留：npc、flag、note、ruling）
params：`{"call_id": "...", "effects": [{"kind": "move", "to": "<场景名>", "travel_minutes"?: int, "label"?: "<玩家语言的短名>"}, {"kind": "clue", "clue": "<线索名>", "how"?: "<一句话>", "label"?: "<玩家语言的短名>"}, {"kind": "time", "minutes": int, "why"?: "..."}, {"kind": "damage", "dice": "1D6", "subject"?: "<调查员>", "why"?: "..."}]}`。`damage` 是没有攻击者的伤（摔落、火烧、坠物）：守秘人给规则书的骰子，内核掷骰、写一条 `roll` 收据与一条 `delta` 收据、更新 HP 与伤口记录；有攻击者的伤走 `resolve`。`move` 的结果带目的地的 `where` 与 `present`，守秘人不必再 `look`。`label` 是守秘人用 play_language 给玩家看的短名，只用于机制块；省略时机制块用图上的 display_name 或 id。
- 整批先校验后写，任一条失败整批不写：`{"code": "...", "details": {"index": i, ...}}`。
- `move`：目的地必须是图上从当前场景可达的场景（`route-to`，或可玩性模板的入口关系 `play-precedes`/`may-lead-to`/`alternative-to`/`hands-off-to`——构建出的书多按演出顺序连场景，运行时与可玩性检查用同一套词，出口条目带 `via`），或 `scene_edges` 声明的目的地，或来路上的任何场景（`world.scene_trail`：到达当前场景所经过的场景栈，来路总是可退：没有作者出口的巢穴也能一步退回地窖或一楼）；否则 `not_reachable`，`fix` 里直接写出两份名字，`details.exits` 给出口，`details.back` 给来路（由近到远）。**守秘人可以给一条图上没有的路**：`via` 写清怎么过去的（翻没钉死的二楼窗、下运煤道、跟着人进去），这一步就落地，收据记 `via` 与 `improvised: true`；`via` 写在图上本来就有的边上只是修辞，收据不记。没有这条口子时，书自己的虚构（「二楼的窗没钉」）会被拒，守秘人照样叙述，于是**世界停在街上而故事在楼上**，那一层的线索接着被判 `not_here`，而且没有任何信号说两者已经分叉——静默的分叉比走错出口更坏。`travel_minutes` 缺省取图上边的值（退一步取反向边），没有则 0。`label` 给过一次就是这个场景从此的名字：写进 `world.scene_labels[<场景>]`，之后的 `【变化】场景` 行、胶囊 `where`、检查点、任务包都用它，记忆解析把它当场景的别名。写 `world.active_scene`、`scene_trail`（前进则压入当前场景，退回则截断到目的地之前）、`visited_scenes`、`scene-moved` 事件。旧世界没有 `scene_trail` 时在 `_context` 里按同一规则重放 `scene-moved` 事件一次性补上。**`to` 就是当前场景时，这一步是命名而不是移动**：`label` 必填（缺了报 `invalid_params`，`fix` 指名 `label`），写进 `world.scene_labels` 就结束——不动时钟、不动 `scene_trail`、不发 `scene-moved`、收据 `visibility: "keeper"` 且带 `renamed: true`，机制投影不给它行（否则卡面上会出现「从某处走到某处本身」）。没有这条口子时，开场那个场景永远不是任何一次移动的目的地，于是全桌只有它一直挂着书上的英文名。
- `clue`：必须是图上存在的 clue 节点，且 `discoverable-at` 当前场景或在当前场景 record 的 `available_clues` 里；否则 `not_here`。已发现的重复写入返回 `replayed: true`，不报错。写 `discovered_clues`、`clue-discovered` 事件。
- `time`：推进世界时钟，写 `time-advanced` 事件。**时间过去了，伤就该好。**本批 `time` 效果的分钟数相加（同一批两个四小时就是一夜；`move` 的行程分钟不算——赶路不是休息）：≥360 分钟走治疗引擎的休整入口（`handle_time_trigger`：六小时以上算一天，没有重伤则每天回 1 点生命，规则书 p.121；不到这个数一次都不调，因为同一个函数还会清掉当天的急救次数，十分钟不是新的一天），≥60 分钟走魔法点的每小时回复（规则书的单位是小时，引擎的下限会给任何一次推进至少 1 点）。每个真正变动的资源写一条 `delta` 收据与一条 `resource-changed` 事件，result 另给 `recovered: [{investigator, resource, before, after}]`，好让守秘人在写这一夜之前就知道这一夜的人还站不站得起来（数字本身不进正文，§16.3）。**这条规则一直在规则图上**（`rule:coc7:healing:regular-damage-recovery`），两个引擎的入口也一直写着、测着，只是内核从来没有调用过：真桌上 55 个游戏内小时、三夜睡眠、两次看医生，生命值一整局卡在 5/11。
- `item`（#19）：`{"kind": "item", "name": "<物品名>", "to"?: "<调查员>", "from"?: "<NPC 名>", "weapon"?: "<规则表武器 id 或 profile 名>", "quantity"?: int, "label"?: "<玩家语言短名>", "why"?}`。叙述里到手的东西由此进调查员表：写 `party/<id>.json` 的 `equipment[]`（名字、数量、来源回合），`weapon` 给了就同时写 `weapons[]`（从 `rules-json/weapons.json` 的武器 profile 取伤害、射程、弹容、技能（`equipment.json` 只是价目表），取不到报 `needs`，`details.needs.options` 列可用 id），之后 `resolve` 的 `weapon` 能解析它、战斗开局按它排弹药。收据 `item:<slug>-t<turn>-c<n>`，渲染 `【变化】物品：<人> 得到 <label 或名>`，事件 `item-transferred`（`{name, to, from?, weapon?, quantity}`）。`quantity` 为负是失去（消耗、交出、被夺），表上没有就报 `invalid_params`。
- `cash`（#19）：`{"kind": "cash", "subject"?: "<调查员>", "delta": <整数，货币单位随时代>, "with"?: "<NPC 名>", "why"?}`；`with` 是钱的另一头（付给谁、从谁那儿来），落进那个人的账本 `exchanged`（§17.3）与机制投影；不写就只是钱数变了，没有对方。写表上 `finance.cash`（没有 finance 块的时代按 `rules-json/cash-assets.json` 建一个），收据 `cash:t<turn>-c<n>`，渲染 `【变化】现金：<人> <前> → <后>`（没有 `label`，标签固定为 play_language 的「现金」），事件 `resource-changed`（`resource: cash`）。
- 其余种类报 `not_implemented`。
result：`{"receipts": ["move:hall-of-records-t3-c2", ...], "world": {"active_scene", "clock"}, "material_ready": true, "recovered"?: [{"investigator", "resource", "before", "after"}]}`。切片 0 `material_ready` 恒为 true；`recovered` 只在这一批的休整真的还了资源时出现。

### table.ask（切片 0）
params：`{"call_id", "prompt": "<给玩家的问题>", "options": ["...", "..."], "binds"?: "<待决名>", "text"?: "<问题之前的叙述>"}`。
- 记录 `pending_choice = {"name": "<ask-<slug>-t<turn>>", "prompt", "options", "binds"}`，状态进 `asked`，写逐字记录（keeper）。交付 = `text`（可省略）加 `prompt` 与编号选项（编号是语言中立的 `1.`、`2.`）；`mechanics` 随结果给出。不再调用 `narrate`。
- 玩家可见字段过脚本核（§16.3，唯一的一层）：`play_language` 为 `zh-Hans` 时，`prompt`、每一条 `options[i]`、以及给出的 `text`，都必须至少含一个 CJK 字符。缺了报 `invalid_params`，`code_detail: "play_language_mismatch"`，`details.fields` 列出字段名（`prompt` / `options[<i>]` / `text`），`details.play_language` 是战役标签，`fix` 叫守秘人用玩家语言重写这些字段再调。`en` 不做此核。
result：`{"pending_choice": {...}, "rendered_text": "<叙述原样、空行、prompt、编号选项>", "mechanics": [...], "turn": int, "state": "asked"}`。没有机制块——机制走 §16.2 的投影。

### table.narrate（切片 0）
params：`{"call_id", "text": "<本回合叙述>"}`（`placement` 已废止：仍被接受但忽略，不进回合记录）。
流水线：
1. 状态必须是 `open` 或 `acting`。
2. 确定性核对（§16.3），只有一层，是字节、不做语义判断：
   - 玩家语言脚本：`play_language` 为 `zh-Hans` 时，`text` 必须至少含一个 CJK 字符（与系统语言守卫同一套字节范围）。缺了报 `invalid_params`，`code_detail: "play_language_mismatch"`，`details.fields: ["text"]`，`details.play_language` 是战役标签，`fix` 叫守秘人用玩家语言重写再调。`en` 与系统语言相同，此处不分玩家英文与守秘人英文，不做。
   - 机制数字：**不核**。内核不渲染任何机制行，也不在 `text` 里找任何数字：掷出值/目标值、前后值、骰子合计、`time` 的分钟数只走 §16.2 的投影，由前端画成卡片与时钟；守秘人被提示词禁止把它们写进正文，连「用了 15 分钟」也不行。曾经的 `mechanics_missing` 退回（09-06 加、09-07 退、09-08 恢复、**2026-09-09 用户裁定永久移除**）不再存在：任何 `code_detail` 都不得再要求正文出现数字，一段一个数字都没写的正文是正确的交付。
3. `mechanics`：本回合全部收据的结构化投影（§16.2），语言中立，随结果返回并进交付通道，供前端渲染；正文里不插入它。
4. `placement` 参数废止（忽略）。
5. 写 `turns/<NNNN>.json`、逐字记录（keeper，写 rendered_text）、`turn-finalized` 事件。
6. 同步 git 提交，提交信息 `turn <n>: <前 60 字>`；失败报 `commit_failed`，回合保持 `acting`，不递增。
7. 成功后 `turn.json` 进 `awaiting_player`，`turn + 1`。

进度帧 stage 闭合枚举（请求带 `progress: true` 时，按流水线真实边界至多各发一次，顺序即下列顺序）：`load`（快照载入与幂等回放核对后）、`validate`（preflight、mods 校验、§16.3 语言脚本核过后）、`project`（mechanics 投影、facts、labels 生成后）、`write`（回合记录、逐字、`turn-finalized` 事件、下一回合游标落盘后）、`commit`（git 提交返回后；失败照发 `commit_failed` 错误帧，无 `commit` 帧）、`poststep`（提交后链——检查点、episode、世界线——处理完，最终结果帧之前）。帧是真实阶段边界不是心跳；早退路径（如幂等回放直接返回）可以一跳直达结果，一帧不发。

result：`{"rendered_text": "<即 text，正文原样>"..., "mechanics": [...], "turn": int, "receipt": "turn:<n>", "commit": "<短 sha>", "facts": {...}, "extraction": {"job_id"}}`；`facts` 与 `extraction` 见 12.5 与 12.3。提交之后的链（检查点、episode、抽取任务）在 12.2–12.3，其中任何一步失败都不撤销已成功的提交：回合已关，失败只进遥测与 backlog。

开桌回合（turn 0）：`table.open` 返回 `opening_needed: true` 时，扩展先让守秘人 `look`，再 `narrate` 开场；此时状态从 `awaiting_player` 直接允许 `narrate`，内核视作 turn 0 的关闭。

## 6. 回合胶囊（切片 0 三节）

`table.capsule` 与 `table.player_input` 返回：
```
{"turn": {"number", "state", "pending_choice": null | {...}, "player_text": "<本回合玩家原文或 null>"},
 "where": {"scene": "<name>", "display_name", "dramatic_question", "pressure_moves": [...], "exits": [{"to", "travel_minutes"?, "unlock_when"?}], "back": [{"to", "display_name"}]（来路，由近到远）,
           "affordances": [{"id", "cue", "clue"?, "npc"?}], "keeper_notes": [...], "assets": [{"name", "kind"}],
           "places": [{"name", "line"?}]（≤ 8；本场景 `occurs-at` 的地点下面 `located-in` 的房间——书把一栋楼建成「地点 + 一串房间」，只看离场景一跳就永远看不见它们）,
           "rules": [{"name", "line"?}]（≤ 6；本场景 `uses-rule` 指向的 rule 节点：书为这一场固定的判定与数值。每次构建都接对了这条关系，此前没有任何消费者）,
           "endings": [{"name", "via", "line"?}]（≤ 4；本场景 `may-lead-to` 的 ending 节点。结局不是走过去的地方——`WALKABLE_KINDS` 只有场景，且是有意的——它是一次结算（`development:settle-ending`）。此前没有任何东西告诉守秘人有一个够得着，于是一局玩到头就那么停住：巫师被毁，作者写好的收束从未结算，战役状态还是 `active`）},
 "present": [{"name", "role", "wants", "fears"?, "hides"?, "voice"?, "knows": [...], ...}]（§17.4 起是档案加账本，旧的 relationship/agenda/known_facts/attitude 已删）,
 "known": {"discovered_clues": [names], "clues_here": [{"name", "summary", "delivery_kind", "discovered": bool}],
           "investigator": {"name", "occupation", "hp", "san", "mp", "luck", "skills_of_note": [{"name", "value"}]}},
 "recent": [{"turn", "player", "keeper": "<前 200 字>"}]   最近 2 回合
}
```
全部内容都是守秘人专属；`pressure_moves`、`keeper_notes`、NPC 的 `agenda`、`secret` 只能被守秘人当创作参考，不能进玩家文字。每节字节预算：`where` 4KB、`present` 3KB、`known` 3KB、`recent` 2KB；超出按项裁剪并在该节加 `"truncated": true`。

## 7. 事件

`events.jsonl` 每行 `{"seq", "turn", "type", "at", "call_id"?, "receipt"?, "data": {...}}`。十八类 canonical 事件闭合枚举，见 12.1；切片 0 写前七类，切片 1 加 `resource-changed`、`decision-settled`，切片 2 补齐 `session-changed`、`choice-asked`、`memory-written`，切片 4 加 `setup-completed`、`handout-shown`，#19 加 `item-transferred`。代码里的闭合表是 `kernel/coc/events.py`。

## 8. 扩展侧职责（kernel 扩展）

- `session_start`：拉起内核，`kernel.hello`，读 `PI_COC_CAMPAIGN` 选战役（无则通过 ctx.ui 提示并列出 `campaign.list`），`table.open`。`opening_needed` 时注入一条宿主消息要求守秘人 `look` 后 `narrate` 开场；`pending_turn` 时注入恢复消息，并把 `call_id` 序号从 `last_call_ordinal` 之后接着铸，死掉的进程用过的序号不再复用。
- 七个工具用 TypeBox 定义参数，描述里写清用法与何时用；`resolve.action.intent` 用枚举；`apply.effects` 用 kind 判别联合。工具面固定，不调用 `setActiveTools` 变形。
- `call_id` 铸造：每次会改状态的调用（`resolve`、`apply`、`ask`、`narrate`）递增回合内计数器；读调用不带。
- `before_agent_start`：把玩家 prompt 交给 `table.player_input`，把返回的胶囊作为 `customType: "coc-capsule"`、`display: false` 的消息注入。宿主自己发出的消息（恢复、开场）不是玩家输入，不进 `player_input`。
- `tool_call`：同名同参的调用在本回合被内核拒过两次后第三次拦下，理由里复述上次的错误（原样重发不会有不同结果）；`awaiting_player`/`committed` 拒写；`narrate` 成功后同一批次余下的调用一律 `block` 并说明回合已关闭；`apply`/`resolve` 的名字做大小写与空白归一化。
- `message_end`：带工具调用的助手消息只保留调用块，删掉其中的文本：守秘人在调用前写的过程话不是台词。本回合 `narrate` 或 `ask` 已返回 `rendered_text` 时，把随后那条助手消息的文本整体替换为 `rendered_text`；守秘人在工具之后写的正文被丢弃。守秘人写了正文却没调 `narrate` 就收工时，宿主替它关回合：把正文原样作为 `text` 调 `table.narrate`。内核因玩家语言脚本核退回（`play_language_mismatch`）时**不交付**：宿主把这条助手消息里的正文块丢掉（被拒的草稿不能当交付立着），在 `agent_end` 带着内核自己的 `fix` 催一次，下一轮的 `narrate`/`ask` 才关回合。这是唯一的确定性地板（数字核已于 2026-09-09 移除，宿主再也不催守秘人往正文里补数字）。

内核留有 `for: player` 的待决（战斗里的防御）而守秘人只写了正文时，宿主**不替它问**：内核铸的待决 `prompt` 是英文的守秘人用语（§16.1），摆到玩家面前就破了「玩家看的字只由守秘人按 play_language 写」。宿主丢掉这份草稿、催一次（`agent_end` 那条已有的待决催促），由守秘人自己用玩家的语言 `ask`。同一回合已经催过还是只写正文，就按 `narrate` 关掉回合：待决留着，胶囊下一回合照样把它摆出来，回合不挂死。

交付是守秘人的正文，外加一条 `coc-mechanics` 会话条目（§16.2 的 JSON，前端与驾驭器由此渲染，TUI 不显示；投影为空时不发）。只有正文为空（只想不说）时才催一次。玩家可见文字只由 `narrate` 与 `ask` 产生。
- `agent_end`：回合仍在 `acting` 且没有 `narrate`，注入一条宿主消息「回合未关闭，用 narrate 交付」并触发一轮；最多一次。
- 遥测：每次工具调用记录 `{turn, tool, call_id?, started_at, ms, ok, code?}` 到 `.coc/campaigns/<id>/telemetry.jsonl`，每回合结束记录模型往返数。

## 9. 启动器

`bin/pi-coc [--campaign <id>] [pi 参数...]`：
- 仓库根目录为 cwd；`PI_CODING_AGENT_DIR=<repo>/.pi/coc-agent`，无 `settings.json` 时写入 `{"packages": ["<repo>"], "quietStartup": true}`；`--campaign` 导出为 `PI_COC_CAMPAIGN`。
- exec `node_modules/.bin/pi --no-builtin-tools --no-context-files --system-prompt prompts/keeper.md --session-id coc-<campaign> <余下参数>`。`--mode rpc` 等 Pi 参数原样透传。对 Pi 的全部依赖见 `docs/pi-host-contract.md`。

## 10. 真桌驾驭器

`tests/play/driver.py start|turn|stop|log`：以 `bin/pi-coc --campaign <id> --mode rpc --no-session` 起子进程，按 Pi RPC 协议发 `prompt`，收事件直到 `agent_end`，把助手文本、工具调用与结果、耗时写进 `.coc/playtests/<run_id>/`，并把守秘人交付原文打印到 stdout。模型由 `set_model` 命令切换，缺省 `xai/grok-4.5`。

## 11. `resolve` 完整流水线（切片 1，票 #14）

切片 0 的 `resolve` 只做普通检定。切片 1 把 RuleGraph 十族接到它后面。模型侧的输入形状不变，只多几个可选字段；下面每一步都是内核的事。

### 11.1 输入补充

`action` 在切片 0 的字段之外接受（扩展的工具表必须逐一声明，否则模型无处可填）：`san_loss`（理智检定的成功/失败损失表达式，如 `0/1D6`）、`involuntary`（理智失败时的失控行为，`faint`、`flee`、`scream`、`freeze`、`attack` 之一）、`outcome`（结束战斗时的结果）、`skills` 与 `mode`（合并检定）、`motive`（`{direction: support|neutral|oppose, intensity: 0..2}`，工具表与内核用同一套词）与 `support`（社交判定里 NPC 倾向与玩家实证）、`interrupted`（施法）、`rest`（每周恢复条件）、`ending`（结束会话的结局种类）；以及：`weapon`（武器名，攻击时用；`unarmed` 表示徒手）、`spell`（法术名）、`defense`（`dodge` 或 `fight_back`，回应待决防御时用）、`push: true`（对上一次失败检定推骰，`stakes` 必填，是宣告的后果）、`luck: <点数>`（花幸运补上一次检定）。`actor` 可以是 NPC 名：守秘人替 NPC 行动时用——战斗或追逐里轮到他，**或者他在战斗之外用自己的本事替队伍做一件事**（医生缝合、锁匠开锁、向导认路）。后一种以前被拒（「只能在他参与的战斗或追逐里行动」），于是求医、雇向导这类调查跑团的日常表达不了；更糟的是治疗族把施救者写死成当前调查员，医生给伤员缝手掷的是**伤员自己**的医药基础值（真桌上是 4），必然失败还看着像一次正常判定。详见 §17.9。

### 11.2 事实

事实字典只含 RuleGraph 契约登记过的路径。来源三处：
- 状态事实：调查员表与运行时数值（`actor.*`、`time.*`、`campaign.ruleset_id`），移植旧仓库 `facts_from_state`。
- 意图事实：`intent.action_kind` 取 `action.intent`；`intent.pushed`、`intent.rescuer_count`、`receipt.last_outcome`、`receipt.push_eligible` 按旧适配器 `augment_facts` 的规则从本战役的上一次检定收据推。
- 会话事实：`chase.*`、`sanity.*`、`magic.*`、`development.*` 由会话层与引擎快照提供，移植旧 `_facts_provider_for` 里的族事实。

### 11.3 候选与选择

1. 会话优先：战斗有待决防御时只允许 `combat:defend`；追逐进行中只允许 `chase:*`；理智发作进行中只允许 `sanity:bout-tick` 与 `bout-end`。违背时报 `turn_state`，`fix` 说明当前必须先做什么。
2. 否则对每一族调 RulesRuntime 的 `context`，取 `applicability == applicable` 的决策；再按 `answers_declared_intent` 保留回答本次意图的。图上没有意图条件的决策（切片 1 会补齐，见 11.7）按下面的路由表兜底：`combat` → 战斗族；`flee` → `combat:flee`（战斗中）或 `chase:start`；`social` → `social:adjudicate-difficulty`，有 `target` 且 `method` 是读人时加 `psychology:observe-concealed`；`investigate` → `core-check:ordinary-check`，`target` 是典籍或人且 `method` 是学法时 `magic:learn-spell`，`method` 是急救或医疗时 healing 族；`move` → `method` 提到技能时 `core-check:ordinary-check`，否则不掷骰且 `note` 指向 `apply` 的 move；`cast` → `magic:cast-spell`；`push: true` → `push-luck:pushed-roll`；`luck` → `push-luck:luck-spend`；`idle`、`meta`、`stuck`、`ambiguous`、`montage` → 不掷骰。
3. 恰一个候选直接执行。多个候选：`action.decision` 点名了就用它；否则报 `needs_choice`，`details.candidates` 给每个候选的语义名（决策 id 去掉 `decision:coc7:` 前缀）与一句话说明它何时适用。
4. 零候选：报 `needs`，`details.needs.field` 为 `intent` 或 `skill`，并说明为什么当前状态下没有可用决策。

### 11.4 槽位

RuleGraph 的每个决策声明输入槽位与归属。宿主锁定槽位由内核从状态填，移植旧 `host_locked_provider` 的族绑定，但源收据一律从本战役 `turns/` 与 `turn.json` 的收据里取，不再有账本。守秘人语义槽位从 `action` 映射：

| 槽位 | 来源 |
| --- | --- |
| `skill` / `characteristic` | `action.skill`，否则在 `method`、`goal` 里匹配（切片 0 的解析器） |
| `difficulty`、`bonus`、`penalty` | `action.modifiers` |
| `goal`、`stakes`、`difficulty_basis` | 同名字段透传；`stakes` 空时 `difficulty_basis` 为 `keeper` |
| `target_npc_id`、`npc_id`、`target_ref` | `action.target` 解析为在场 NPC；不在场报 `unknown_entity` 并给在场者 |
| `weapon_ref` / `weapon_id` | `action.weapon` 在调查员装备与武器表里解析；空且意图为 combat 时报 `needs` 列出持有武器加 `unarmed` |
| `approach`（社交） | 从 `method` 归类为 charm、fast_talk、intimidate、persuade；归不出报 `needs` |
| `question`、`external_behavior`（心理） | `goal` 与 `method` |
| `spell`、`source`、`source_ref` | `action.spell`，`action.target` |
| `defense_kind` | `action.defense` |
| `failure_consequence`、`method_changed` | `action.stakes`、`action.method` |
| `points` | `action.luck` |
| `rescuer_ref`、`assistant_rescuer_ref` | `action.actor` 与 `action.target` |

必填槽位缺失报 `needs`，`details.needs` 给字段名与可选值；模型永远不见槽位名，`fix` 用 `action` 的字段名说话。

### 11.5 执行与会话

执行走移植进内核的引擎：百分骰与对抗、社交难度、心理观察、急救医学与濒死钟、推骰与幸运、施法与学法、成长结算，以及三个会话引擎 CombatSession、ChaseSession、SanitySession。旧仓库的 subsystem executor 不移植；会话层是内核自己的一层薄状态机，持有会话快照与待决。

- 引擎快照持久化在战役目录 `save/` 下，文件名沿用引擎（`combat.json`、`chase.json`、`sanity-state/<inv>.json`、`healing-state/…`、`mp-state/…`），随每次 `narrate` 一起提交。
- 战斗：`intent: combat` 加 `target` 开局或接续；引擎按 DEX 排序，回合由内核推进。攻击后若守方要防御，结果带 `pending_choice`：守方是调查员时它是给玩家的选择（`dodge` / `fight_back` / 不防），守秘人用 `ask` 交回玩家，下一回合用 `action.defense` 解；守方是 NPC 时由守秘人下一次 `resolve` 用 `actor: <npc>` 与 `defense` 决定。`combat:flee` 成功即按 `continues-as` 直接进入 `chase:start`，结果里 `continuations` 与 `session` 同时给出。
- 追逐：开始、移动、障碍、危险、冲突、结束六个决策由意图与会话事实选出；每回合的可用动作放在 `session.actions`。
- 理智：`sanity:check` 由守秘人在 `intent: investigate` 加 `stakes` 提到理智或 `action.decision: "sanity:check"` 时触发，`goal` 是来源；失败进入发作时结果带 `pending_choice`（守秘人的发作动作选择）与 `session.kind: "sanity_bout"`。
- 推骰与幸运：失败的可推检定在结果 `continuations` 里列出 `pushed-roll` 与 `luck-spend` 及其需要的 `action` 字段；守秘人先 `ask` 玩家，再以 `push: true` 或 `luck` 调 `resolve`。

### 11.6 结果与收据

`outcome.kind` 取 `check`、`opposed`、`combined`、`social`、`psychology`、`healing`、`push`、`luck`、`magic`、`development`、`combat`、`chase`、`sanity`、`none`。每种至少有 `level` 或 `status`、涉及的骰面与目标值、`effects`。`effects` 每条 `{kind: hp|san|mp|luck|condition|ammo|position, subject, before, after}`。

收据：每次掷骰一条 `roll` 收据（含 NPC 的）；每条资源变化一条 `delta` 收据。渲染：`delta` 一行 `【变化】<资源中文名>：<subject> <before> → <after>`；NPC 的骰在 `visibility: keeper` 时不渲染。`session.kind` 进入或结束时一行 `【变化】战斗开始` / `【变化】战斗结束：<outcome>`。

### 11.7 图数据

- 每个决策补齐以 `intent.action_kind` 为事实的 `available-when` 条件（不设 `hard_gate`），让 11.3 的兜底路由表退化为空。
- 本体注册表补齐 Director 意图到决策的 `grounded-by`。
- 改图后重算 `rule-graph-manifest.json` 的 `graph_content_digest`，算法与旧仓库 `coc_rule_graph.build` 一致；内核加载时校验它。

### 11.8 回归语料

旧仓库 `tests/fixtures/rules-settle-recorded/` 的五十五份录制载荷各含 `decision_ref`、`semantic_inputs` 与结算结果。切片 1 把它们翻译成 `resolve` 回归用例：每份构造等价的 `action`（`decision` 点名），断言同一决策被选中、效果种类与事件种类一致、会话状态迁移一致；骰面因随机不比对。

### 11.9 边界澄清（扩展 worker 提出，已定）

- `needs` 与 `needs_choice` 的候选与选项放在 `error.details` 里（`details.needs = {field, options}`、`details.candidates = [{name, when}]`、`details.exits`），`message` 与 `fix` 不重复列举；Pi 只把工具结果的文本交给模型，所以由扩展把这些 `details` 渲染进结果文本。
- `session` 的形状：`{kind: combat|chase|sanity_bout, status: active|ended, round, turn_of: <在场者名>, actions: [...], pending_defense: null | {for: player|npc, actor, options}, participants: [{name, side, hp?}]}`。会话进行期间每个 `resolve` 结果都回显它，不因本次判定与会话无关而返回 null；会话结束那一次返回 `status: ended`，之后返回 null。
- `pending_choice` 的形状：`{name, for: player|keeper, prompt, options}`。`for: player` 的待决由守秘人用 `ask` 交回玩家，`ask.binds` 填它的 `name`；守秘人漏填时扩展在 `tool_call` 里用最近一条 `for: player` 的待决名补上。`for: keeper` 的待决由守秘人下一次 `resolve` 的 `decision` 或 `defense` 回答。
- `defense` 取 `dodge`、`fight_back`、`none`；`none` 表示放弃防御。
- 遥测行是扁平的：`outcome_kind`、`session_kind`。

### 11.10 内核上半的决定（已实现，K2 与扩展照此）

- 候选选择是结构性路由：一个决策成为候选，当行动能填满它的语义槽位（心理、社交、对抗需要在场 NPC 目标；学法需要 `spell`；合并检定需要两个以上技能；推骰与幸运需要 `push` 或 `luck`）。图上的意图条件只做否决：`answers_declared_intent` 为 False 的决策不进候选；为 True 但路由不到的也不给。
- `social` 无 NPC 目标退化为普通检定；有目标走社交难度裁决，`method` 解析为 Psychology 时另给心理观察候选。`investigate` 对着 NPC 且技能解析不出时给两个候选。
- 推骰与幸运的源是该行动者最近一次 D100 技能或特征检定；已推过、已通过、先花幸运再推都报 `turn_state`；无可推的检定报 `needs` 字段 `intent`；幸运不足报 `invalid_params` 带 `details.reason`。**对抗、组合、暗骰与伤害骰不可接续**，所以这几种的结果里不会再出现 `push-luck:*` 续行——广告一条结算必拒的续行，比不给更坏：守秘人会照着问玩家，玩家选了，结算却绑到别的检定上并报那一次的结果。
- **花幸运也铸收据。** 推骰会为新的掷值铸一条 roll 收据，花幸运此前不铸，于是被买下的那次检定在记录里永远写着 `failure`，成功只活在本次调用的返回里，机制投影里玩家只看见幸运在减少、什么也没买到。现在铸一条 `roll_kind: "luck_bought"` 的收据，带 `source_receipt` 指向原检定与 `luck_spent`；这个种类不在可接续之列，所以没人能从它身上再推一次。
- 收据 id：NPC 骰 `roll:<skill>-<npc>-t<n>-c<k>`；资源变化 `delta:<resource>-t<n>-c<k>`；同一调用内重复加 `-2`。事件：每次掷骰 `roll-resolved`，每条变化 `resource-changed`，每次 resolve `decision-settled`。
- `effects` 的 `kind` 另有 `skill`（成长）与 `condition`（治疗）。隐藏骰（心理观察、`visibility: keeper`）有收据不渲染；NPC 的公开对抗骰渲染时带 `名字·` 前缀；推骰行带 `（推骰）`。
- 治疗对象：`method` 的技能是急救或医学时对象是 `target` 指的调查员，否则是行动者；施救者是行动者。法术来源：在场 NPC 的 `mechanics.profile.spells` 为 person 来源，典籍与生物节点的 `spells` 为 tome 与 entity 来源。
- `situations` 只列由 `actor.`、`time.`、`sanity.`、`chase.`、`development.`、`clock.` 下正向状态事实激活的硬门决策。
- 引擎快照：治疗 `save/healing-state/<inv>.json`，成长 `save/development-state/<inv>.json` 与 `save/development-settlements/endings/<id>/`；治疗快照把 `current_hp` 与 `conditions` 镜像回调查员表。
- 三个治疗钟决策（濒死小时钟、濒死回合钟、每周重伤恢复）不再挂意图条件：它们由状态事实与守秘人点名驱动。

### 11.11 内核下半的决定（已实现）

- `sanity:check` 必带 `action.involuntary`（五种失控行为之一，或 `{kind, summary}`）；缺失报 `needs` 字段 `involuntary`。`san_loss` 取 `action.san_loss`（如 `"0/1D6"`），否则取目标 NPC 或生物档案里的 SAN 损失；`stakes` 提到理智时把 `sanity:check` 加进候选。
- `combat:end` 取 `action.outcome`；被机械终结的战斗自行结束并以 `session.status: ended` 回报。枪械攻击下 `dodge` 对应引擎的卧倒找掩护，`fight_back` 被拒并列出可选项；`none` 处处合法。
- 优先级：待决防御只接受防御方的 `defense`；发作只接受点名的发作决策；追逐把 `flee`、`move`、`combat` 意图路由到当前唯一待决的追逐决策；给了 `defense` 或 NPC `actor` 时意图视为 `combat`。NPC 作 `actor` 只在它参与的战斗或追逐里被接受。
- 战斗开局尊重场景 affordance 的作者规则（Corbitt 的护甲、召唤代价、飞刀耗魔、专属短剑的 `destroy_target`），记在 `save/combat-operation.json`。
- `chase:start` 的路线 = 当前场景加 `route-to` 邻居（至多 8），不足时由引擎生成补到差距加三；需要一个有档案的在场 NPC，否则 `needs` 字段 `target`。`chase:conflict` 是引擎的擒抱，只在追者与被追者同位时待决。`chase:end` 的 `outcome` 可省略：引擎已判出 `escaped` / `captured` 时以引擎为准；守秘人给的是工具 schema 里战斗结局的四个词时按被追者是谁翻译（调查员是被追者：`fled`、`investigators_win` → `escaped`，`monsters_win` → `captured`；反之对调），`stalemate` → `concluded`；别的词报 `invalid_params`，`details.options` 列全两套词。追逐结束不改场景：人在哪里由守秘人随后 `apply` move 落地。
- `recover-temporary` 与 `apply-treatment` 由守秘人调用即视为安全处所；治疗是一次精神分析检定。`san_max = 99 − 克苏鲁神话`。
- 新增收据种类 `session`，渲染 `【变化】战斗开始/结束：<结果>`、`追逐开始/结束`、`理智发作：<摘要>`；跨轮的回合在骰行前加 `【第 n 轮】`；`effects` 增 `ammo`、`armor`、`position`、`mp`；`ammo` 与 `armor` 同时落 `delta` 收据，渲染 `【变化】弹药：<人> 6 → 5`、`【变化】护甲：<人> 4 → 1`，玩家由此知道那三点伤害去了哪里。NPC 的 HP 与 MP 只活在战斗快照里。

## 12. `narrate` 之后的提交链（切片 2，票 #15）

守秘人的上下文是可丢弃的缓存；桌子的真相在战役目录与 sidecar 仓库里。这一节把 `narrate` 提交之后的链条写死：事件批、续行检查点、记忆 episode 与异步抽取、三路 `recall`、advisory 校验车道。三条法则从旧树原样带过来：**候选不自动晋升**（记忆是参考，不是状态）；**矛盾不删除**（用 `valid_until_turn` 与 `superseded_by` 关闭，两条都可寻址）；**抽取与校验永不阻塞 `narrate`**（失败只进 backlog 与遥测）。旧树的时间线分叉、汇流、双层状态不带过来（规格「范围外」）。

### 12.1 事件批：二十二类

`EVENT_TYPES` 闭合枚举，其他类型报 `ValueError`（内核缺陷，不是守秘人错误）：

| 类型 | 谁发 | data |
| --- | --- | --- |
| `turn-started` | `player_input` | `{state}` |
| `player-declared` | `player_input` | `{text}` |
| `roll-resolved` | `resolve`、`apply damage` | 收据字段 |
| `scene-moved` | `apply move` | `{from, to, minutes}` |
| `clue-discovered` | `apply clue` | `{clue}` |
| `time-advanced` | `apply time`、`apply move` 有行程时 | `{minutes, why?}` |
| `resource-changed` | `resolve`、`apply damage` | `{resource, subject, before, after}` |
| `decision-settled` | `resolve` | `{decision, family, outcome_kind, session_kind?, session_status?}` |
| `session-changed` | `resolve` | `{family: combat|chase|sanity_bout, transition: start|end|round, outcome?, summary?}`，对应每条 `session` 收据 |
| `choice-asked` | `ask` | `{name, prompt, options, binds}` |
| `memory-written` | `memory.submit` | `{job_id, turn, candidates: n, superseded: n}` |
| `turn-finalized` | `narrate` | `{receipts, commit?}` |
| `setup-completed` | `setup.complete`（切片 4） | `{module_id, module_generation, investigators}` |
| `handout-shown` | `apply handout`（切片 4） | `{name, kind, available}` |
| `item-transferred` | `apply item`（#19） | `{name, to, from?, weapon?, quantity}` |
| `flag-set` | `apply flag`（#27） | `{name, value, previous}` |
| `note-written` | `apply note`（#27） | `{name, status, entities, closes}` |
| `ruling-made` | `apply ruling`（#27） | `{name, anchor, scope, supersedes}` |
| `npc-changed` | `apply npc`（#29，§17.3） | `{npc, to, stance, why}` |
| `worldline-forked` | `apply fork`（#23，§15.3） | `{name, mode, loop, from: {line, turn, commit}}` |
| `worldline-switched` | `apply switch`（#23，§15.3） | `{line, from: {line, turn, commit}}` |
| `worldline-merged` | `apply merge`（#23，§15.3） | `{name, lines, into, conflicts}` |

每条事件的 `receipt` 指向它对应的收据 id；`session-changed` 与 `choice-asked` 从切片 2 起补发，切片 1 的会话收据只有 `decision-settled`。查询走 `recall history`（12.4），不另开方法。

### 12.2 续行检查点

`narrate` 提交成功后写 `save/continuation/latest.json`：

```
{"schema": 1, "campaign": "<id>", "turn": <已提交回合>, "commit": "<短 sha>", "at": "<iso>",
 "scene": {"name", "display_name"}, "clock": {"minutes"},
 "investigators": [{"id", "name", "hp", "san", "mp", "luck"}],
 "session": null | {"kind", "status", "round"},
 "pending_choice": null | {...},
 "receipts_digest": "<sha256 of turns/NNNN.json receipts>",
 "one_line": "<第 n 回合：<场景>，<时钟>，<会话>；上回合：<守秘人交付前 60 字>>"}
```

- 检查点是可重建缓存，不是历史：写失败只进遥测，回合仍算已提交。`turns/NNNN.json` 与 git 提交才是真相。
- `table.open` 的规则：`turn.json` 可读 → 照旧从它取 `pending_turn`（4 节、12.6）；`turn.json` 缺失或损坏而检查点存在 → 若 HEAD 等于检查点 `commit`，用 `fresh_turn(checkpoint.turn + 1)` 重建 `turn.json`，`resume.rebuilt: true`；HEAD 领先检查点（提交后、写检查点前死掉）→ 从 HEAD 的回合记录重建检查点再继续，不报错。
- `table.open` 结果加 `resume: null | {turn, commit, scene, clock, session, one_line, rebuilt: bool}`，`opening_needed` 时为 null。
- 重开进程后的第一条 `player_input` 胶囊带 `resume` 节（同一对象），之后不再带；扩展不为重开单独注入宿主消息，胶囊就是恢复说明。`pending_turn` 的恢复消息仍照 8 节，文字里带 `resume.one_line`。

### 12.3 记忆：episode、抽取任务、候选断言

**Episode**（`narrate` 提交后追加 `memory/episodes.jsonl`）：`{"episode_id": "ep:t<n>", "turn", "commit", "scene", "present": [NPC 名], "investigators": [id], "receipts": [id], "clues_discovered": [名], "player_chars", "keeper_chars", "at"}`。

**抽取任务** `memory.job`，params `{"campaign", "turn"?: int}`；缺省取最新的、还没有完成任务且没在 backlog 里的已提交回合。result：

```
{"job_id": "extract:<campaign>:t<n>" | null, "turn", "commit",
 "scene": {"name", "display_name"}, "present": [名], "investigators": [{"id", "name"}],
 "player_text": "...", "keeper_text": "<守秘人正文原样；§16 之后内核不再渲染机制行>",
 "committed_facts": [...同 12.5 的 committed...],
 "known_entities": [{"name", "kind": investigator|npc|scene|clue}],
 "prior": [{"id", "kind", "subject", "statement", "status", "turn"}]（与在场实体相关的既有候选，≤ 12，按 12.4 排序）,
 "budget": {"max_candidates": 12, "max_statement_chars": 400},
 "instruction": "<固定的 play_language 指令：只写这一回合新出现的事实、知晓、信念、关系、玩家断言；主语用 known_entities 里的名字；不写数值与骰面；不复述 prior 已有的>"}
```

任务包只含名字，不含 commit、收据 id、回合号之外的任何机器键；`turn` 与 `commit` 是给扩展回填遥测用的，不进模型提示。

**候选提交** `memory.submit`，params `{"campaign", "job_id", "candidates": [{...}]}`，每条候选闭合字段：

| 字段 | 取值 |
| --- | --- |
| `kind` | `world_event`、`knowledge`、`belief`、`relationship`、`player_assertion`、`player_preference`、`keeper_correction` |
| `subject` | `known_entities` 里的名字，或保留主语 `world`、`party`、`keeper`、`player`；`world_event` 的主语必须是 `world` |
| `knowers`? | 名字列表（调查员、NPC、`party`、`keeper`、`player`） |
| `statement` | 1–400 字 |
| `entities`? | 名字列表；`relationship` 恰好一个 |
| `privacy`? | `player_safe`（缺省）或 `keeper_only` |
| `state`? | `accurate`（缺省）、`uncertain`、`distorted` |
| `confidence`? | 0–1 |

校验闭合：未知字段、任何机器键（`commit`、`receipt`、`turn`、`id`）、解析不到的名字、同名歧义（图上两个实体同名且都在场）都报 `invalid_params`，`details.index` 指到那一条，`fix` 写出可用的名字；整批要么全落要么全不落。落盘：每条得 `id: "mem:t<n>-<k>"`，`status: "candidate"`，`source: {turn, commit, episode_id, receipts}`，`valid_from_turn: n`。**确定性接续**只做一种：同 `subject` 与同 `entities` 的新 `relationship` 关闭旧的（旧条加 `valid_until_turn: n`、`superseded_by`），其余种类只累积。任务文件 `memory/jobs/<job_id>.json` 整文件原子写；同任务同内容重放幂等，内容不同报 `idempotency_conflict`。成功发 `memory-written` 事件。校验失败或扩展报告车道失败（`memory.fail {"campaign", "job_id", "reason", "detail"}`）写 `memory/backlog.jsonl` 一行 `{job_id, turn, reason: invalid|lane_error|model_error, detail, at, status: pending}`；backlog 里的任务 `memory.job` 不再自动派发，重派要显式给 `turn`。

候选不晋升：本切片没有把候选变成状态或规则事实的路径；`apply` 的 `note` 与 `ruling` 仍保留给后续切片。`recall memory` 把候选连同 `status` 一起给守秘人，相关与否由它判断。

### 12.4 `recall` 三路

- **memory**：params `{"what": "memory", "about"?: [名], "turns"?: [from, to], "kinds"?: [...], "include_superseded"?: bool, "limit"?: ≤ 30}`。收窄全是确定性的：`about` 里的名字先精确匹配图上名字、别名与 `scene_labels`，不中时取「一个名字里的整词」（`Knott` → Steven Knott），人（调查员、NPC）优先于地点与线索，仍歧义则 `unknown_entity` 且 `fix` 列出候选名；命中按图上名字与别名归一化后精确匹配 `subject`、`knowers`、`entities`；`turns` 落在 `valid_from_turn`；缺省不含已关闭的。排序：与 `about`（缺省取当前在场实体加调查员）重叠数多者先，再按种类权重（#20：`world_event`、`knowledge`、`relationship`、`promise` 先于 `belief`、`player_preference`、`keeper_correction`，`player_assertion` 最后——它多半是玩家输入的复述，守秘人已经读过），再按 `valid_from_turn` 晚者先。result `{"what": "memory", "about": [...], "hits": [{"id", "kind", "subject", "knowers", "entities", "statement", "privacy", "state", "confidence", "status", "turn", "superseded_by"?}]}`。不接受散文筛选，没有关键词与正则。
- **transcript**：params `{"what": "transcript", "turns"?: [from, to], "role"?: "player"|"keeper", "read"?: {"turn", "role"}}`。不带 `read` 时返回 `cards: [{"turn", "role", "chars", "head": "<前 80 字>"}]`（区间缺省最近 3 回合，最多 40 张），并在区间 ≤ 3 回合时同时返回切片 0 的 `entries`；带 `read` 时返回 `{"turn", "role", "text", "verified": bool}`，`verified` 表示逐字记录里的文本与 `turns/NNNN.json` 记录（守秘人取 `rendered_text`，玩家取 `player_text`）的 sha256 一致；不一致仍返回文本但 `verified: false`。
- **history**：params `{"what": "history", "turns"?: [from, to], "types"?: [事件类型], "diff"?: [turn_a, turn_b]}`。result `{"timeline": [{"turn", "commit", "scene", "clock", "closed_by", "receipts": {"roll": n, "move": n, "clue": n, "delta": n, "session": n, "time": n}, "head": "<守秘人交付前 60 字>"}], "events": [...]（按 `types` 过滤，最多 200 条，缺省不含 `player-declared` 之外的原文）, "diff"?: {"from", "to", "scene": [a, b], "clock": [a, b], "clues_added": [名], "resources": [{"subject", "resource", "from", "to"}], "sessions": [{"turn", "family", "transition", "outcome"?}], "moves": [{"turn", "from", "to"}]}}`。`diff` 只从回合记录里的收据累计，不读 git 对象。

三路都在 `open`、`acting`、`asked`、`awaiting_player` 任何状态可调，只读；写状态的调用照旧要在回合内。

### 12.5 事实清单与校验车道

`narrate` 结果里的 `facts`：

- `committed`：本回合已提交的事实，每条一句 play_language，确定性地从收据与世界状态生成：第一句是玩家原文（`玩家声明：<原文>`，校验车道据此判断哪些自愿行为是玩家自己声明的）；每条 `roll` 一句（谁、什么检定、过没过）、`move` 一句、`clue` 一句、`delta` 一句（资源 前 → 后）、`session` 一句、`time` 一句，再加「地点：<display_name>」与「在场：<名字>」。
- `keeper_only`：本场景尚未发现的线索（名字与摘要）、在场 NPC 的 `agenda` 与 `secret`、模组级秘密里与本场景相关的条目；总量 ≤ 2KB，超出按项裁剪。

校验车道在 kernel 扩展内：交付完成后（`message_end` 替换之后）用 Pi SDK 起零工具内存会话，模型由 `PI_COC_VERIFIER_MODEL`（`provider/model`）指定，缺省与桌子同模型；输入是正文（`rendered_text`）、`facts.committed`、`facts.keeper_only`（三者都是系统语言英文，正文除外），要求只返回 JSON：

```
{"findings": [{"kind": "reveal"|"uncommitted_state"|"player_agency", "quote": "<正文里的原句，≤ 120 字>", "why": "<≤ 200 字>"}]}
```

三类分别是：越权揭示了 `keeper_only` 里的事实；声称了 `committed` 里没有的状态变化（走了没 move、拿了没 clue、掉了没 delta）；替玩家做了未授权的自愿行为。扩展把结果交给 `table.warn`，params `{"campaign", "turn", "lane": "verifier", "findings": [...]}`：内核校验 `kind` 枚举，`quote` 必须是该回合 `rendered_text` 的子串（唯一的确定性锚点；不是子串的整条丢弃并记 `dropped`），最多 10 条；写进 `turns/NNNN.json` 的 `warnings`、遥测一行，并在**下一次** `player_input` 的胶囊里带 `warnings: [{"turn", "kind", "quote", "why"}]`（只带最近一个已提交回合的，≤ 1KB）。全部 advisory：不改状态，不拦交付，不重开回合。车道不用关键词、不用正则；能确定性判的（自写骰面、未关的 `needs`）仍在内核。

零工具子会话是规格第六、九节定下的形状：产出是 ≤ 12 条候选或 ≤ 10 条发现的短 JSON，远在单条助手消息的上限之下，不是把整本书塞进一次补全。实现取的是 `ctx.modelRegistry.complete`（一次不带工具的补全，复用当前会话的注册表与鉴权）；0.85.1 里真的嵌套零工具内存会话也起得了，是权衡后没走，不是上游没路——两边的代价记在 `docs/pi-host-contract.md` 3.1 与第 5 节。车道跑成功就调一次 `table.warn`，`findings` 为空也调：内核由此分得清「跑了没发现」与「没跑」，所以 `table.warn` 必须收 `findings: []`。校验车道选 `why` 的语言用 `table.open` 结果 `campaign.play_language`。

**advisory 的去留（2026-09-06 证据复核，报告在玩测证据旁）**：**保持 advisory**。两局 42 个关回合、52 条发现逐条判：`uncommitted_state` 22 真 0 假 6 判不了、`reveal` 2 真 1 假（n=3）、`player_agency` 1 真 20 假。升级为阻塞门的条件按类分开：`uncommitted_state` 最强，但它最大的一簇（NPC 被叙述进场却不在提交的在场表里）是产品缺口不是守秘人失误，要先落 #27 的 `apply npc`，再看一局 30–40 回合的召回；`player_agency` 定义过宽（把转述玩家请求成台词、「你转过身」判成越权），先收窄定义再重新计量；`reveal` 样本太小，要 100+ 回合。已证实的价值在人不在模型：重复出现的那条发现是 #19 的立票依据，没有证据表明胶囊 `warnings` 改变过守秘人下一回合的行为。

### 12.6 崩溃恢复与幂等

- `acting` 与 `committed` 之间死掉：`table.open` 从 `turn.json` 给 `pending_turn`（含 `last_call_ordinal`），守秘人接着做完；已落收据不重掷（`resolve`/`apply` 的 `call_id` 幂等回放）。
- `narrate` 提交后、写检查点或 episode 之前死掉：重开时检查点从 HEAD 重建；episode 与抽取任务缺失时 `memory.job` 仍能按 `turn` 从回合记录出任务。
- 同一 `call_id` 的 `narrate` 重放返回已存的结果，不再提交；这是唯一的「不重复提交」机制，扩展不做补偿。

### 12.7 胶囊新增节（切片 2）

- `memory`（≤ 1.5KB）：`recall memory` 缺省排序的前 6 条命中，投影成 `{id, kind, statement, turn}`（#20：`knowers`/`entities`/`privacy`/`confidence`/`state` 不进胶囊，要的时候 `recall memory` 拿全条），预算内装得下的条数因此翻倍；没有候选时为空数组。
- `warnings`（≤ 1KB）：12.5。
- `resume`：12.2，只在重开后的第一回合出现。

### 12.8 扩展侧职责（切片 2）

- kernel 扩展：`narrate` 成功后在总线上发 `coc:turn-committed {campaign, turn, commit, job_id, facts, rendered_text}`；交付替换完成后自己跑校验车道并 `table.warn`。车道出错只写遥测（`lane: verifier, ok: false`），不催守秘人，不阻塞。
- memory 扩展（`extensions/memory`）：订阅 `coc:turn-committed`，`memory.job` → 零工具子会话（模型 `PI_COC_MEMORY_MODEL`，缺省与桌子同模型）→ `memory.submit`；失败一次重试，再失败 `memory.fail`。同一时刻只跑一个任务，后来的排队；进程退出时未完成的任务留给下次 `memory.job` 缺省派发。
- 两条车道的 RPC（`memory.job`、`memory.submit`、`memory.fail`、`table.warn`）不带 `call_id`、不看回合状态；结果按 `turn` 落到对应回合记录，晚到也收。memory 扩展派任务时给显式 `turn`（刚提交的那一回合）；`memory.job` 的缺省派发只在重开进程后补漏时用。
- 补抽（#20）：memory 扩展在 `session_start`（桥就位后）用 `memory.job` 的缺省派发补抽尚未完成任务且不在 backlog 里的回合，每次会话至多 `PI_COC_MEMORY_BACKFILL`（缺省 5）个，仍是一次一个、不阻塞回合、先让位给刚提交的回合；遥测行带 `backfill: true`；缺省派发回 `job_id: null` 时不写遥测行（那是常态，不是事件）。
- 内核子进程一个会话只有一个（§1），memory 扩展没有自己的客户端：kernel 扩展在 `session_start` 于总线 `coc:kernel-bridge` 发布一个 `call(method, params)` 闭包，`session_shutdown` 时收回；memory 扩展只经它调内核。
- 子会话的建法与模型选择写进 `docs/pi-host-contract.md` 第 3–5 节。

### 12.9 内核的决定（已实现）

- **回合记录带世界快照。** `narrate` 与 `ask` 写的 `turns/NNNN.json` 多一个 `world` 块：`{scene: {name, display_name}, clock, present: [NPC 名], investigators: [{id, name, hp, san, mp, luck}], session, pending_choice}`，是回合关闭那一刻的状态；`narrate` 的记录另存 `facts`。检查点、episode、`memory.job` 的任务包、`history` 的时间线与 `diff` 全从这个块读，不碰可变的 `world.json`，也不读 git 对象。turn 0 被 `player_input` 隐式关闭时同样写快照。
- **检查点与 HEAD 的同步。** `table.open` 先让检查点跟上 HEAD：HEAD 的回合号从提交信息 `turn <n>:` 读，回合记录缺 `commit` 时补上再重建；检查点缺失、损坏、或 `commit`/`turn` 与 HEAD 不符都算「HEAD 领先」，`resume.rebuilt: true`。还没有任何 `narrate` 提交时不动检查点。`turn.json` 丢失或损坏：有检查点 → `fresh_turn(checkpoint.turn + 1)`；若检查点之后有一条 `ask` 关闭的记录，则重建成那一回合的 `asked` 并带回 `pending_choice`（玩家的回答还落得下去）；一次提交都没有时重建成 turn 0。`resume` 只在 `open` 后本进程第一次 `player_input` 的胶囊里出现一次。
- **`facts.keeper_only` 是句子列表**，与 `committed` 同形：`未发现线索：<名>——<摘要>`、`<NPC>的秘密——agenda：…；secret：…`、`模组秘密：<名>——<摘要>`。模组图上的 secret 节点没有指向场景的关系，「与本场景相关」无法结构性判定：秘密排在最后，2KB 预算裁剪时最先被裁。成功等级用规则表的闭合枚举译成 play_language（大成功/极难成功/困难成功/普通成功/失败/大失败）。`choice` 收据也各出一句（`玩家选择：<选项>`）。
- **`time-advanced` 补上有行程的 `move`**：事件 `receipt` 指向那条 `move` 收据，`data.why` 为 `travel`；零分钟的移动只有 `scene-moved`。`session-changed` 的 `data` 带收据上的 `outcome` 与 `summary`（有则带）。`choice-asked` 没有对应收据，事件不带 `receipt`。
- **任务包里的名字。** `known_entities` 为：调查员（表上名字）、在场 NPC（display_name）、当前场景（display_name）、到该回合为止已发现的线索（图上句柄，如 `knott-keys`，因为线索的 authored name 是一整句摘要）。解析用图上全部别名（句柄、display_name、节点 id）与调查员的 id/名字，归一化后精确匹配，只在 `known_entities` 范围内。歧义时 `fix` 与 `details.candidates` 给能唯一解析的 id：调查员给表 id，图节点给带种类前缀的节点 id（`npc-steven-knott`），因为句柄与名字在归一化下会撞（`steven-knott` == `Steven Knott`）。`knowers` 只接受调查员、NPC 与 `party`/`keeper`/`player`；`entities` 不接受保留主语。落盘的 `subject`/`knowers`/`entities` 一律写规范名（调查员名字、NPC display_name、场景 display_name、线索句柄）。
- **`memory.job` 缺省派发**从最新的已提交回合往前扫，跳过已完成任务与 backlog 里 `status: pending` 的回合，开桌回合 turn 0 也算；全部完成返回 `{job_id: null, turn: null}`。显式 `turn` 对已完成或已失败的任务仍返回任务包，只是不再改写任务文件。`memory.submit` 没有先调 `memory.job` 时（另一进程派发过）从回合记录重建任务再落盘。
- **提交的校验失败也进 backlog**（`reason: invalid`，`detail` 为错误信息），随后一次成功提交把该任务的 pending 行改成 `recovered`。任务文件 `status` 取 `open` → `done` | `failed`，完成时存 `candidates_sha256`、`submitted` 与 `result`；重放比较提交的候选列表的规范化 JSON sha256。候选 id `mem:t<n>-<k>`，`k` 接着该回合已有的最大值。`candidates.jsonl` 以整文件原子重写来给旧行加 `valid_until_turn`/`superseded_by`（并把 `status` 改成 `superseded`）：不删行，两条都可寻址。接续判定用规范键比较 `subject` 与 `entities` 集合，只对 `relationship`。
- **`recall memory` 的 `about`。** 显式给 `about` 时收窄（命中至少一个名字）；缺省的 `about`（在场 NPC 加调查员）只排序不收窄，否则 `world_event` 永远不会出现。`about` 里解析不到或歧义的名字报 `unknown_entity`（§2）。同重叠数、同回合的命中按 id 排序。`limit` 缺省 12，上限 30；胶囊的 `memory` 节取缺省查询的前 6 条。`history` 缺省区间为最近 20 回合，`events` 取区间内最新的 200 条。
- **`table.warn`** 的 `lane` 闭合为 `verifier`；`kind` 不在枚举里整批报 `invalid_params`（`details.index`），引文不是子串的单条丢弃并在 `dropped` 里给 `index` 与理由；多次 `warn` 同一回合追加。遥测行写在 `telemetry.jsonl`（与扩展同一文件，内核的行带 `lane`），检查点或 episode 写失败也各一行（`lane: kernel, step, ok: false`）。
- **`fit_budget` 增加 `drop` 方向**：排过序的列表（`memory`、`warnings`）从尾部裁，`recent` 仍从最旧裁；被裁的节名照旧进胶囊的 `truncated`。
- **`recall memory` 的种类权重（#20，已实现）。** 排序键为 `(重叠数降序, 种类层级, valid_from_turn 降序, id)`；层级是闭合表 `memory.KIND_RANK_TIERS`：`world_event`/`knowledge`/`relationship`/`promise` → 0，`belief`/`player_preference`/`keeper_correction` → 1，`player_assertion` → 2；不在表里的种类排在所有已知层级之后。`memory.job` 任务包的 `prior` 走同一函数，顺序随之。胶囊 `memory` 节的投影由 `memory.capsule_hit` 给：`{id, kind, statement, turn}`；`recall memory` 的 `hits` 不变（全字段）。
- **`history.diff.resources` 也累计 `cash` 收据**（#19）：`cash:` 收据带 `resource: cash`、`subject`、`before`、`after`，与 `delta` 同形；时间线的 `receipts` 计数键仍是 12.4 的六个（`item`/`cash` 不计入）。

## 13. 回合胶囊九节、Director 与本体（切片 3，票 #16）

胶囊是守秘人每回合动手前拿到的一切。切片 0–2 的证据（`haunting-s0` 13–25 回合）说明它还不够：守秘人平均在第一次写状态之前先读 5 次（中位数 4，最多 17），查的东西胶囊里本来该有——时钟、本场景未发现的线索与 NPC 秘密、能去哪、上回合变了什么。这一节把九节写全，把 DirectorGraph 的打分接成 `director` 节，把本体 `grounded-by` 读进运行时。三条边界：**Director 没有写侧**（建议是参考，采纳与否由收据推断）；**胶囊全部守秘人专属**（不进逐字记录，不进玩家文字）；**打分的每个数都来自图**（`content/director/director-graph.json`，缺图或对不上就开桌失败，不回退到代码里的字面量）。

### 13.1 胶囊的形状与预算

`table.player_input` 与 `table.capsule` 返回：

```
{"head": "<一句固定的话：以下是本回合开始时的全部场面，已含时钟、未发现线索、在场者秘密与来路；胶囊里有的不必再 look/lookup>",
 "turn": {...同 §6...},
 "where": {...同 §6 与 12.2 的 back...,
           "clock": {"minutes", "elapsed": "<n 小时 m 分钟>", "day_part"?: "<模组给了起始时刻才有>"},
           "session": null | {...11.9...}},
 "present": [{...同 §6..., "secret"?, "fear"?}],
 "known": {...同 §6...},
 "pressures": [{"kind": "clock"|"threat"|"rule", "name", "state": "<段数或到期描述>", "due"?: "<回合或分钟>", "cue"?: "<作者的压力动作或规则的下一步>"}],
 "obligations": [{"kind": "choice"|"session"|"continuation"|"quest"|"promise", "name", "who"?: "player"|"keeper"|"<NPC>", "state", "cue"?}],
 "director": {"beat": "<十一节拍之一>", "reason": "<一句>", "because": ["<信号 = 值>", ...],
              "grounded_by": ["<规则决策语义名或效果>", ...],
              "scores": {"<beat>": <0–1>, ...}（前三）,
              "override"?: "<第三层硬规则名>",
              "reveal"?: [{"clue", "gate": "<delivery_kind 或 unlock 条件>"}]},
 "situations": [...同 look 的 situations（11.10）...],
 "memory": [{"id", "kind", "statement", "turn"}],
 "style": {"language", "register": "purist"|"pulp", "axes": [...], "directives": [{"id", "line"}]},
 "module"?: {"title", "era"?, "synopsis": "<模组节点摘要>", "factions": [{"name", "line"}], "places": [{"name", "line"}],
             "people": [{"name", "line"}]（守秘人专属，含未登场者）, "endings": [名], "conclusions": [名], "structure_type"}（#22：只在开桌后第一回合出现）,
 "recent": [...§6...], "warnings": [...12.5...], "resume"?: {...12.2...},
 "truncated": [节名]}
```

字节预算（超出按节裁剪并记入 `truncated`）：`where` 4KB、`present` 3KB、`known` 3KB、`pressures` 1KB、`obligations` 1KB、`director` 1.5KB、`situations` 1KB、`memory` 1.5KB、`style` 1KB（重开进程后的第一回合 2KB，见 13.6）、`recent` 2KB、`warnings` 1KB、`module` 2KB（#22：只在开桌后本进程的第一回合出现，与 `resume`/首回合 `style` 同一条件；内容全部来自模组图——模组节点摘要与时代、派系/地点/人物名册各带一句摘要、结局与结论的名字、结构类型；没有的域给空数组；`head` 说明这一节在，守秘人开桌前不必再 `lookup` 这本书讲什么）。`head` 与 `turn` 不计预算。

- `where.clock`：`elapsed` 由世界时钟分钟数确定性生成；`day_part` 只在模组图的 `module` 节点声明了起始时刻时给（没有就不猜）。
- `present[].secret`/`fear`：NPC 档案里有就给；这是守秘人专属材料，与 `agenda` 同一条法则。
- `known.clues_here` 已含 `discovered: false` 的线索与 `delivery_kind`：这就是 `lookup secret scope=scene` 的内容，胶囊里有了，`head` 会说。

### 13.2 `pressures` 与 `obligations` 的来源

全部结构性来源，不做语义判断：

| 节 | kind | 来源 |
| --- | --- | --- |
| pressures | `clock` | 规则层的时钟事实：濒死小时钟、重伤一小时、理智发作剩余轮数（`situations` 里的 `time.*`/`clock.*`/`sanity.*` 事实转成一行） |
| pressures | `threat` | 模组图 `threat` 节点里与当前场景或在场 NPC 相关（`present-in`/`located-in`/`contains` 关系可达）的那些，`cue` 取场景的 `pressure_moves` |
| pressures | `rule` | 上回合留下的 `continuations`（可推、可花幸运）尚未被回答的 |
| obligations | `choice` | `turn.pending_choice`（`for` 标 who） |
| obligations | `session` | 活跃会话：种类、轮到谁、可用动作 |
| obligations | `continuation` | 上回合结果里 `continuations` 列出但没接的（推骰待玩家认账） |
| obligations | `quest` | 模组图 `quest` 节点：`state` 由其 `supports`/`may-lead-to` 关系指向的线索发现情况推出（未开始/进行中/可结束） |
| obligations | `promise` | 记忆候选里 `kind: promise` 且未关闭的（13.5 新增种类） |
| obligations | `note` | `apply note` 里未关闭的连续性欠账（§18.2 写着，13.2 的来源表此前漏了） |

### 13.3 Director：三层打分，图是唯一的数

内容目录加 `content/director/director-graph.json` 与 `director-graph-manifest.json`（旧树 `references/director-graph.json` 原样带过来，摘要照旧校验；只读 `director-action`、`structure-type`、`structure-weight`、`scoring-rule`、`threshold`、`tiebreak-order`、`player-signal` 六类节点，`storylet`、`multiplier`、`time-cost-category` 留在文件里不读——这次不带 storylet）。

**信号**（全部由内核从状态与上回合确定性算出，写进 `director.because`）：

| 信号 | 取值 | 来源 |
| --- | --- | --- |
| `structure_type` | 七种之一 | 模组图 `module` 节点声明；没有则 `branching_investigation` |
| `intent` | 上一回合 `resolve` 的 `intent`，没有 resolve 则由收据推：有 `move` 收据为 `move`，只有 `time` 为 `idle`，没有收据为 `none` | 回合记录 |
| `undiscovered_here` | 本场景未发现线索数 | 图 + 世界 |
| `agenda_npc_present` | 在场且档案有 `agenda` 的 NPC 数 | 图 + 世界 |
| `dramatic_question` | 场景有无 | 图 |
| `exit_condition_met` | 场景 `exit_conditions` 任一成立 | 图 + 世界 |
| `main_line_complete` | 模组图 `conclusion` 节点任一可达（其 `supports` 线索全部已发现） | 图 + 世界 |
| `stalled_turns` | 连续多少回合没有新线索、没有移动、没有会话变化 | 回合记录 |
| `turns_in_scene` | 连续在本场景的回合数 | 回合记录 |
| `hp_state` | healthy / wounded / major_wound / dying / dead（规则书 p.119–120：hp<0 dead；hp==0 且 major_wound 为 dying；有 major_wound 为 major_wound；hp<max 为 wounded） | 调查员表 |
| `sanity_state` | stable / shaken（本场景内掉过理智）/ bout_active / indefinite（理智 ≤ 0） | 表 + 会话快照 |
| `session` | none / combat / chase / sanity_bout | 会话快照 |
| `last_roll` | none / passed / failed / critical / fumble | 上回合最后一条 roll 收据 |
| `pushed_fail_pending` | 上回合推骰失败且后果未落 | 回合记录 |
| `pending_choice` | 有无给玩家的待决 | turn.json |
| `clock_near_full` | 任一 `pressures.clock` 的段数 ≥ 总段数的 2/3（图上阈值 `pressure-clock-near-full-fraction`） | 13.2 |

**第三层硬规则**（先于打分，命中即定，写 `director.override`）：会话进行中（`session != none`）→ `SUBSYSTEM`；`hp_state == dying` → `SUBSYSTEM`（并把 `PRESSURE` 加进 because）；`last_roll == fumble` → `PRESSURE`；`pending_choice` → `CHOICE`。旧树的「守秘人提案覆盖」不带：v2 的守秘人自己就是决策者，Director 只建议。

**第一层基础分**：每个节拍取图上 `scoring-rule` 里条件成立的最大值；条件语义闭合如下（条件名即图上的 `condition_id`）：`investigate-intent`/`social-intent`（REVEAL，且 `undiscovered_here > 0`）、`dramatic-question-present`（DEEPEN，且 intent 是 investigate/social）、`baseline`/`clock-near-full-or-stalled`（`stalled_turns ≥ 阈值 pressure-stalled-turns`）/`yielded-scene`（`turns_in_scene ≥ 3` 且 `undiscovered_here == 0` 且场景有 `pressure_moves`）/`pushed-fail-nudge`（PRESSURE；posture 两条不带，没有 rich intent）、`agenda-npc-in-scene`（CHARACTER）、`two-undiscovered-clues`（CHOICE，阈值 `choice-undiscovered-clue-count`）、`exit-condition-met`/`explicit-move-intent`/`main-line-complete`/`stalled-transition-pressure`（CUT；capped-linear 三元组 `[base, per_turn, cap]` 按 `stalled_turns - 阈值 cut-stalled-transition-turns` 线性封顶）、`montage-intent`（MONTAGE）、`structured-entity-overlap`（PAYOFF；重叠数 = 本场景在场 NPC 与已发现线索在记忆候选里被提到的条数，同样 capped-linear）、`stalled-turns`（RECOVER，阈值 `recover-stalled-turns`）、`combat-flee-cast-intent`（SUBSYSTEM）。`ADVANCE` 是规格加的第十一个节拍：没有任何条件成立（全部 0 分）时的缺省，理由写「无触发，推进」；旧图的无触发缺省 `CHOICE` 不沿用。

**第二层**：分数 × `structure-weight[structure_type][beat]`；四位小数；并列按 `tiebreak-order`。

**`reveal`**：节拍为 REVEAL 时列本场景未发现线索（≤ 5），每条带 `gate`：线索的 `delivery_kind` 与 `unlock`/`requires` 条件的描述（`describe_condition`）。

**`grounded_by`**：本体注册表里 `grounded-by` 关系从命中的 scoring-rule 指向的规则决策语义名（如 `magic:cast-spell`），加上该节拍在本体里 `may-emit-effect` 的效果名；没有关系的节拍给空数组，不编。

### 13.4 本体注册表进运行时

`content/ontology/system-ontology.json` 开桌时读入并校验：每条 `references` 的 `semantic_id` 必须在其 `graph_id` 对应的已加载图里存在（规则图节点、Director 图节点、live-state 事实路径在 RuleGraph 的 `registered_condition_paths`、resolver 能力在 `catalog`），`relations` 的两端必须是已登记的 ref；对不上 → `kernel.hello` 仍成功但 `table.open` 报 `campaign_not_ready`，`details.ontology` 列出坏引用。运行时读两类关系：

- `grounded-by`（Director → 规则决策）：13.3 的 `grounded_by`，以及 **`resolve` 的候选收窄**：`needs_choice` 时若本回合胶囊 `director.beat` 的 grounded 决策与候选有交集，交集只有一个就直接选它（结果 `decision_source: "director"`），多于一个则只把交集列为候选并在 `fix` 里说明；没有交集照旧。收窄只在多候选时发生，永远不推翻守秘人显式给的 `decision`。
- `may-emit-effect`（规则 → 规则）：`grounded_by` 里的效果名；此外 `narrate` 的确定性检查用它核对「每个状态效果恰交代一次」时的效果种类清单（12.5 已提交事实的种类由它闭合）。

`requires-live-state-fact`、`invokes-capability`、`renders-settled-output` 只校验、不驱动行为（切片 1 的 RuleGraph 运行时已经按自己的事实路径工作）。

### 13.5 记忆新增种类 `promise`

候选 `kind` 增加 `promise`：某人答应了有到期或有条件的事（`subject` 为许诺者，`entities` 为受诺者与相关实体，`statement` 写清条件或期限）。抽取指令加一句；`obligations.promise` 取未关闭的。关闭的路径与其他候选一样：同 `subject` 同 `entities` 的新 `promise` 接续旧的。

### 13.6 `style`：手艺进胶囊

内容目录加 `content/craft/text-graph.json`（旧树 `references/text-graph.json` 原样带过来）。只读 `play-register`、`style-axis`、`craft-directive`、`beat-type` 四类。`style` 节：`language` 取战役；`register` 取战役的 `register`（建战役时可给，缺省 `purist`）；`axes` 是九条 style-axis 的短句（play_language）；`directives` 按节拍挑：图上 craft-directive 与 Director 节拍的对应表写在 `content/craft/beat-directives.json`（每节拍 ≤ 4 条 directive id，内容团队维护的闭合表，不是模型判断）。重开进程后的第一回合给全部 directive（预算 2KB），之后只给按节拍挑的（1KB）。

### 13.7 采纳证据（无写侧）

`narrate` 关回合时内核算 `director_adoption` 写进回合记录与遥测：`{beat, adopted: bool, evidence: [收据 id]}`。判定表闭合：REVEAL → 本回合有 `reveal` 列表里的 `clue` 收据；PRESSURE → 有 `time`/`damage`/`delta`（负向）/`session start` 收据；CHOICE → 回合以 `ask` 关闭；SUBSYSTEM → 有 `session` 收据，或有会话内的 roll 收据（带 `session_kind`，或 `roll_kind: combat_check`）；CHARACTER → 有 social 族的 roll 收据或 `present` 非空且无移动；RECOVER → healing/development 族决策结算；CUT/ADVANCE → 有 `move` 收据；MONTAGE → 有 `time` 收据且 ≥ 60 分钟；DEEPEN → 有 core-check 族 roll 收据且无 `move`；PAYOFF → 有 `clue` 收据且该线索 `supports` 某 `conclusion`。这是遥测，不是奖惩：胶囊不据此改变下一回合的建议。

### 13.8 `head` 与查询预算

`head` 是固定文本（play_language），列出胶囊已含的内容；`look`/`lookup` 的工具描述同步改成「胶囊里没有的才查」。验收指标：同一造景（`haunting-s0` 的第 13–25 回合同类回合，或新战役的同一段）下「第一次写状态前的只读调用数」中位数从 4 降到 ≤ 2，均值从 5.3 降到 ≤ 3；进规则层的 lane 数不降。指标脚本走遥测（`tests/play/kpi.py`）。

### 13.9 扩展侧（切片 3）

- 胶囊仍是一条 `coc-capsule` 宿主消息，内容原样 JSON；不做二次渲染。
- `table` 扩展状态行加 Director 节拍（`director.beat`）与 `override`，只显示。
- 守秘人提示加一段：九节各是什么、`director` 是建议不是台词、`pressures`/`obligations` 是这回合该记得的账。
- 工具描述：`look` 与 `lookup` 说明胶囊已含的内容；`resolve` 的 `needs_choice` 结果里若 `decision_source: "director"` 会直接结算，无需再调。

### 13.10 内核的决定（已实现）

- **数据原样搬运。** `content/director/director-graph.json`、`director-graph-manifest.json`、`director-graph-contract-v1.json` 与 `content/craft/text-graph.json`、`text-graph-manifest.json` 是旧树 `references/` 的逐字节副本（摘要 `0ac3bb58…` 与 `b1432808…` 用 `graph_digest.compute_graph_content_digest` 复核，算法与规则图一致）。两张图都按同一条封闭法则加载：文件缺失、契约 id 不对、摘要与清单不符 → `campaign_not_ready`，`details.director` / `details.craft` 给原因；`kernel.hello` 不碰它们。`campaign.create` 也要读文本图（校验 `register`），所以坏内容在建战役时就报出来。
- **只读六类 + 手艺四类。** Director 图只读 `director-action`、`structure-type`、`structure-weight`、`scoring-rule`、`threshold`、`tiebreak-order`、`player-signal`（后者只用于本体校验的节点池）；`storylet`、`multiplier`、`time-cost-category`、`conflict-level`、`affinity-ladder` 留在文件里不读。文本图只读 `play-register`、`style-axis`、`craft-directive`、`beat-type`。节拍与结构类型的顺序按 `properties.ordinal` 重建，不按文件顺序。
- **`baseline` 不是触发。** 图上 `PRESSURE / baseline`（0.2）的 rationale 是「没有停滞也没有临满时钟时 PRESSURE 留在打分里」——它是 PRESSURE 在无事可反应时保留的分，不算条件成立。于是 `ADVANCE` 的判定是「除 `baseline` 外没有任何条件成立」，而不是「加权最高分为 0」（后者永远不成立，旧图的无触发缺省因此从未被走到）。别的节拍有条件成立时，PRESSURE 照旧以 baseline × 权重进 `scores`。
- **条件语义的几处取舍。** `two-undiscovered-clues` 只在 `intent ∈ {idle, ambiguous, stuck}` 时成立（图上 rationale 的原话；`none` 不算）。CUT 的四个条件都要求有可去之处（`exits` 或来路非空），与旧代码「有结构性移动权限」一致。`stalled-transition-pressure` 与 `structured-entity-overlap` 的 capped-linear 按图上 rationale 算 `min(cap, base + per_turn × n)`，`n` 是 `stalled_turns` 本身（阈值只做门），或重叠条数。`pushed-fail-nudge` 是加法修正：PRESSURE 基础分取成立条件的最大值后加 0.1，以阈值 `pressure-posture-ceiling` 封顶，按 `score-precision-digits` 取整；posture 两条不带。`yielded-scene` 里「场景有 pressure_moves」读场景记录。
- **信号的读法。** `intent` 读上一回合记录新增的 `intents`（`resolve` 每次调用把 `action.intent` 追加进 `turn.json`，关回合时进 `turns/NNNN.json`），没有 resolve 时按收据推。「上一回合」与 `stalled_turns`、`turns_in_scene`、`sanity_state` 的「本场景内」都只数**有玩家原文的已关回合**：开场回合 0 与隐式关闭不算节奏，否则第一回合就停滞一回合。`turns_in_scene` 含当前回合（同场景连续已关回合数 + 1）。`last_roll` 取上一回合最后一条有成功等级的 roll 收据（伤害骰这类 `form: dice` 不算）。`pushed_fail_pending` = 上一回合有推骰失败，且其后同回合没有负向 `delta`、伤害骰或会话开始。`hp_state` 取全队最重者（dead > dying > major_wound > wounded），条件读治疗快照；`sanity_state` 里 `indefinite` = 理智 ≤ 0 或快照标了 `indefinite_insane`，`shaken` = 本场景内有过负向 SAN `delta`。`clock_near_full` 由 `pressures.clock` 里可计段的钟（重伤小时钟 N/60、发作轮数）按图上 `pressure-clock-near-full-fraction` 判，濒死钟视为永远临满。
- **硬规则的 `override` 与依据。** `override` 取 `session`、`dying`、`fumble`、`pending_choice` 四个闭合名（按此优先级）；命中时 `scores` 只有 `{<beat>: 1.0}`，`dying` 在 `because` 追加 `extra = PRESSURE`。硬规则没有命中的 scoring-rule，其 `grounded_by` 走本体里登记给它的 Director 节点：`session` → `scoring-rule:subsystem:combat-flee-cast-intent`，`dying` → `craft-directive:dying-forces-rescue-subsystem` 与 `craft-directive:dying-clock-kind`；`fumble` 与 `pending_choice` 没有登记，给空数组。
- **`grounded_by` 的写法。** 决策用 §11.3 的语义名（`magic:cast-spell`），规则与效果用注册表里的完整 id（`rule:coc7:healing:dying-entry`、`effect:coc7:magic:cast-spell-mp-spent`），这样列表里只有决策能被 `resolve` 的收窄认成决策。效果取命中决策的 `may-emit-effect` 目标。`scores` 给加权后 > 0 的前三；`because` 列全部十六个信号 `名 = 值`。
- **收窄读胶囊。** `needs_choice` 的收窄用 `turn.json` 里本回合胶囊的 `director.grounded_by`（守秘人看到的那份），不重算；交集恰一个时结果带 `decision_source: "director"`，多个时 `details.candidates` 只列交集并给 `details.narrowed_by: <beat>`，`fix` 说明；显式 `decision`、`push`、`luck` 不进这条路。
- **`pressures.clock` 的来源是 situations 里的钟决策。** `healing:first-aid-ordinary`（`time.minutes_since_injury`）→ 重伤后一小时；`healing:dying-round-clock` / `first-aid-stabilization` → 濒死未稳定；`healing:dying-hour-clock` → 濒死已稳定；`healing:weekly-major-wound-recovery` → 每周恢复；`sanity:bout-tick` → 发作剩余轮数（读会话视图）。`cue` 就是那个决策名。`clock.dying` 这个登记路径没有事实来源，不用。
- **`threat` 的「相关」。** 模组图的 threat 节点没有指向场景的关系（只有 module `contains`），所以「相关」= 与当前场景或在场 NPC 有 `present-in`/`located-in`/`contains` 关系（任一方向），**或**其 `dangers[]` 的 `monster_ref`/`id`/`npc_id` 归一化后是某个在场 NPC 的名字。`state` 取第一只钟 `x/y`，没有钟写「无时钟；n 个危险源」；`cue` 是场景 `pressure_moves` 用「；」连起来。
- **`rule` 与 `continuation` 同源。** 都取上一回合 resolve 结果里的 `continuations`，其源检定收据既没被 `source_receipt` 接续也没标 `continued_by` 的；前者写规则的下一步，后者标 `who: player`。`quest` 的 `state` 数该节点 `supports` / `may-lead-to` 指向的线索里已发现的条数（未开始 / 进行中 m/n / 可结束）；没有线索标记写「未开始（无线索标记）」；`who` 取 `giver`，`cue` 取 `importance`。`promise` 取 `memory.open_promises`：`kind: promise` 且 `status: candidate` 且未被接续。
- **`promise` 的接续。** 与 `relationship` 同一条确定性规则：同 `subject` 同 `entities` 的新 `promise` 给旧的加 `valid_until_turn` / `superseded_by`；抽取指令多一句。
- **`style` 的行。** 九条轴与十七条 directive 的 play_language 短句住在 `content/craft/beat-directives.json`（`axis_lines`、`directive_lines`），没有对应语言的行时退到 `en`，再退到图上的 `name` / `rationale`；轴按 `language_applicability` 过滤（`translationese` 只给 zh-Hans）。「重开进程后的第一回合」= 本进程第一次 `player_input` 打开的那一回合：那一回合的所有胶囊（含 `table.capsule`）都给全部 directive，2KB；之后的回合按节拍表，1KB。zh-Hans 全量 2019 字节刚好装下；`en` 全量超预算，按 `truncated` 裁尾。
- **采纳落两处。** `narrate` 与 `ask` 关回合时都算 `director_adoption`，写进回合记录，并在 `telemetry.jsonl` 写一行 `{lane: "director", turn, closed_by, beat, adopted, evidence}`；turn 0 没有胶囊，记录里为 `null`。`CHARACTER` 的 social 族与 `RECOVER` 的 healing/development 族从本回合 `calls` 结果的 `family` 反查收据；`MONTAGE` 看本回合 `time` 收据的总分钟数 ≥ 60；`CHOICE` 以 `ask` 关闭时 `evidence` 为空数组。
- **`where.clock.at` 与 `day_part`** 只在模组节点声明了故事何时开场时给：`start_clock.local_datetime`（`module-meta.json` 的本地日期时间，The Haunting 是 `1920-10-12T10:00:00`）或退而求其次的 `start_time`（`HH:MM`，只有钟点没有日期，因此只有 `day_part` 没有 `at`）。`at` = 声明的开场时刻 + `world.clock.minutes`，以 `YYYY-MM-DDTHH:MM` 给出；`elapsed` 仍然是从战役开局算起的已过时间，两者不是一回事。`day_part` 的边界是**起始钟点**（5 dawn / 8 morning / 12 midday / 14 afternoon / 18 evening / 22 night，之前是 `small_hours`）。两者都不声明的模组一个都不给——不猜。`table.view` 的 `clock` 与胶囊同一份投影（§23），面板据此显示局内时间。`structure_type` 读模组节点记录的 `structure_type`，没有就 `branching_investigation`。`campaign.create` 接受 `register`（文本图 `play-register` 的 legacy key，缺省 `purist`），写进 `campaign.json`。
- **游戏日 = 局内午夜。** 声明了开场时刻的模组，日序号是 `(开场时刻的当日分钟 + world.clock.minutes) // 1440`，与 `where.clock.at` 换日期的那一刻严格一致；两者都不声明的模组退回 `minutes // 1440`。任何推进时钟的效果都可能跨过它——`time` 是守秘人有意让时间过去，`move` 的行程同样在走——所以夜里开车跨过 0 点也算过了一天，而 `_stage_recovery` 仍然正确地不把行程当休息。
- **`apply` 跨过午夜时结果多一个 `day_ended`**：`{days, sanity: [{investigator, day_start_san, went_indefinitely_insane}]}`，没跨就没有这个键。理智引擎同时在**自己的存档**里留下一条 `day_ended` 事件（`daily_san_lost / threshold / day_start_san / next_day_start_san / indefinite_insanity_triggered`）——注意它不是 `events.jsonl` 的规范事件，那张表是闭合的 24 类，跨日没有进去；它记的是**判了哪一天、对着什么阈值**——p.168 的「一天损失五分之一」以前没有任何产品路径调用者，计数于是从战役第一分钟起只增不减，这条事件让下一次它再失灵时看得出来。一次推进跨 N 个午夜就按序关 N 次日；推进内部没有路径能动 SAN，所以只有第一次有东西可判，**判定永远只针对队伍真正经历的最后一天，绝不跨天求和**。
- **本体校验的池。** `graph:rule:coc7` 对规则图节点 id；`graph:director:production` 对 Director 图节点 id；`graph:text:production` 对文本图节点 id；`graph:live-state:campaign` 的 `locator` 对 RuleGraph 的 `REGISTERED_CONDITION_PATHS`；`graph:execution:coc7-resolver` 的 `locator` 对 resolver 的 `public_api_index` 加内核执行器名；`graph:module:<id>` 对该模组图的节点 id（当前注册表没有模组引用）。关系两端必须是已登记的 `ref_id`。每进程校验一次，结果缓存。
- **`may-emit-effect` 的效果清单**以 `Ontology.effect_ids()` 暴露（决策 → 效果 id）。本树的 `narrate` 没有「每个状态效果恰交代一次」的确定性检查——12.5 的 `committed` 句子直接由收据生成——所以这份清单目前没有消费者；接那条检查的切片直接读它，不另抄一份。
- **`module` 节（#22，已实现）的装法。** 条件与 `style_full` 同一个：本进程为该战役第一次 `player_input` 打开的那一回合，及其前的任何 `table.capsule`；`resume` 的条件是它的子集（新书的 turn 0/1 没有 resume，但有简报）。内容全部来自模组图：`title`（模组节点名）、`era`（模组记录声明了才有）、`synopsis`（模组节点 summary）、`factions`（`faction` 与 `organization` 节点）、`places`（`location`）、`people`（全部 `npc`，含未登场者）、`endings`（`ending`）与 `conclusions`（`conclusion`）的名字、`structure_type`（与 Director 同一读法，缺省 `branching_investigation`）。名册的 `line` 取节点 summary（与名字相同时跳过），人物取 `relationship_to_investigators；agenda`，再退到记录的 prose；只复制不改写。装进 2KB 的顺序：先把行长从 120 字逐级降到 80/40/20/0（名册宁可全员短句，也不丢人——尾裁会先丢掉排在最后的 Walter Corbitt），仍超才按项裁尾；任一步发生都记入 `truncated`（the-haunting 在 40 字时装下，`truncated: ["module"]`；the-white-war 全长装下，不记）。有这一节时 `head` 追加一句说明。
- **`investigator_combat_participant` 的火器技能按武器自己的技能取**（#19 顺带修）。`weapons.json` 拼作 `Firearms (Rifle/shotgun)`、技能表拼作 `Firearms (Rifle/Shotgun)`，此前精确匹配落空就退到表上最高的 Firearms（霰弹枪按手枪 55 开火）。现在 `sessions.sheet_skill_value` 按 `normalize` 匹配表上技能，表上没有再按同法取技能表的基础值（25），两边都没有才退到旧行为。`weapons.json` 里 `Firearms (Rifle)`/`Firearms (rifle)`/`Firearms (MG)`/`Fighting` 这类不在技能表里的拼法仍走旧行为——那是内容漂移，`content/rulesets` 不在本切片范围。

## 14. 建卡、模组存储与来源车道（切片 4，票 #17）

> 来源构建部分的历史契约：文字资料包、span 分片与旧编排 RPC 已由 §22 替代并退役。建卡、既有图谱读取和资产契约仍适用；下文旧构建流程不再是生产入口。

从零到开桌：玩家选一本书或一个 starter，建卡，坐下。这一节定四件事的形状：模组存储（多战役共享、只增不删）、三条来源车道（starter 直接注册、PDF 资料包绑定、无人值守构建）、建卡进程（一个 `setup` 工具、一张七步表）、按需深读与资产。旧树的教训整条带过来：**仓库不解析 PDF**（外部宿主技能产出资料包，仓库只校验字节）；**读书的模型工作跑成带工具的 Pi agent**（一段 section 一个有界的子 `pi` 进程，不是一次补全——用户 2026-09-04 的法则）；**给读者工具而不是原始 JSON**（证据查询与闸门是它能自己跑的命令）；**构建必须装配**（`assembled` 与 `dangling_relations == 0` 才算成，只看「每片通过」是空心的）；**整图有可玩性标准**（十条不变量恒成立，十五项度量只报不卡）；**机器能推的不让模型写**（relations、visibility、coverage 记账是机器的）；**模组是参考不是圣经**（门取向偏开）。

### 14.1 模组存储

工作区 `.coc/modules/<module_id>/`：

```
module.json                身份：id、title、source: starter|pdf、languages、bundle_sha256?、page_count?、
                           graph_digest、generation、status: registered|planned|building|assembled|assembled_not_playable|installed
module-graph.json          v3 契约的整图（与 content/starters 同一加载器）；generation 每次合并递增
module-graph-manifest.json 摘要（算法同规则图）
bundle/manifest.json       校验过的资料包清单（宿主产出，逐字节）；bundle/pages/NNNN.md 每页 Markdown
sections.json              全书 section 索引：id、title、pages: [from, to]、kind、priority、status: planned|reading|accepted|failed|skipped、shard、rounds
shards/<section_id>.json   已接受的分片（v3 shard）
work/<section_id>/         抽取包 packet.json、读者的 shard.json 与 findings.json、每轮日志
assets.json                手卡、地图、插图登记：id、kind: handout|map|illustration、name、pages、path、visibility
deepen-queue.json          按需深读队列：{section_id, reason: move|adjacent|opening, priority, status, claimed_by?, at}
build.jsonl                构建遥测：每 section 每轮 {section_id, round, model, ms, findings_codes, accepted}
```

- 战役 `campaign.json` 只记 `module_id`、`module_digest`（建战役时的图摘要）与 `module_generation`；`look`/`lookup`/`apply` 读存储里当前代际的图，图长了战役就看得到（深读的意义所在）；`module_digest` 只做溯源，不锁读。
- 同一模组的多个战役共享目录；分片与页只增不删；`status` 只前进。
- Starter：`content/starters/<id>/module-graph.json` 在第一次被 `campaign.create` 或 `module.register` 引用时复制进存储并置 `installed`；`source: starter`，没有 bundle 与 sections。
- 模组 id 是名字（`the-haunting`、`they-did-not-think-it-too-many`），不是文件哈希；PDF 的 id 由 `module.bind` 从清单里的 `module_identity.slug` 取，缺省由标题转 kebab。

### 14.2 PDF 资料包与 `module.bind`

资料包由宿主的外部 PDF 技能产出（本仓库的 `skills/trpg-pdf-ingest` 契约不变；在这台机器上宿主就是 Claude Code 自己读 PDF 写 Markdown），仓库不 import 任何 PDF 解析库（保留旧树的契约测试）。目录形状：

```
<bundle>/manifest.json   {"contract": "coc.pdf-bundle.v1", "producer": "<技能名>", "module_identity": {"title", "slug", "language", "authors"?, "edition"?},
                          "source": {"file_sha256", "page_count", "filename"}, "pages": [{"pdf_index": 0, "path": "pages/0000.md", "sha256", "chars"}],
                          "assets"?: [{"id", "kind", "pages": [..], "path", "sha256", "media_type"}], "outline"?: [{"title", "level", "pdf_index"}]}
<bundle>/pages/NNNN.md   每页 UTF-8 Markdown；空页也要有文件（内容为空），页码从 0 起连续
<bundle>/assets/...      图片原件
```

`module.bind` params `{"bundle": "<目录>", "module_id"?: "<覆盖 slug>"}`：逐页复核 sha256、页码连续、`page_count` 与页数相等、资产哈希；不合报 `invalid_params`，`details.pages` 列坏页。通过则复制进 `modules/<id>/bundle/`，写 `module.json`（`registered`），登记 `assets.json`，返回 `{"module_id", "page_count", "assets": n}`。绑定不读书、不做 section、不起构建（各是各的调用，出错各自可重试）。

### 14.3 无人值守构建

**`module.plan`** params `{"module_id", "budget"?: <每 section 字符上限，缺省 60000>}`：先由机器量（旧 `coc_module_plan` 的算法：目录页、标题深度、按预算切；一本 20 页的书是一个 section，654 页的书按章再按预算切），产出候选切法；再由**一次 Pi agent 会话**（14.5 的读者形状，但只给标题、页码与每页首两行，不给正文）给每个 section 定 `kind`（front|keeper-truth|scene|npc-roster|handouts|appendix|rules|pregens|other）与 `priority`（opening 相关的最高）。分类是全书级判断，交给模型；切法是测量，交给机器。写 `sections.json`，状态 `planned`。

**`module.packet`** params `{"module_id", "section_id"}`：写 `work/<section_id>/packet.json`：section 的页正文切成带 id 的证据 span（`span-p<page>-<n>`，机器切段）、`page_window`（本节覆盖哪几页、前后各多少页——旧树 1281 条编造 span 全指向切片之后的页，加了这个降到 0）、骨架（module 节点、已接受分片里的场景/NPC/线索名册，供引用而非重定义）、v3 词表与 id 法则、`coverage` 要声明的十个域、`machine_filled_keys`。返回 packet 路径与 `brief`（读者的标准命令，见 14.5）。

**`module.review`** params `{"module_id", "section_id"}`：对 `work/<section_id>/shard.json` 跑三道确定性门，每道都跑、都不降级：`shape`（契约 v3 键、`node_id` 以 kind 前缀、`claim_id` 以 `claim-` 前缀、语义 id 法则、词表闭合）、`grounding`（每个名字与数字的引用 span 存在且含该名字/数字；不存在的 span id 是 `unknown_evidence_span`）、`coverage`（每个域已声明；span 消费率与实质段落未引用数只报）。机器填充在校验前做：从 claims 推 relations、visibility 缺省、coverage 记账。返回 `{"accepted": bool, "findings": [{"gate", "code", "path", "message"}], "measures"}`，并写 `findings.json`。

**`module.accept`** params `{"module_id", "section_id"}`：review 通过的 shard 复制到 `shards/`，`sections.json` 状态 `accepted`；未通过报 `invalid_params` 带 findings。

**`module.assemble`** params `{"module_id"}`：骨架 + 全部 `accepted` 分片合并成整图；合并冲突（同 id 不同 kind、悬空引用）是报告不是异常；然后跑**可玩性标准**——十条不变量：`dangling_relation`、`scene_graph_fragmented`、`scene_unreachable_from_entrance`、`no_entrance_declared`、`no_ending_declared`、`clue_supports_nothing`、`conclusion_without_support`、`clue_nowhere_to_find`、`actor_in_no_scene`、`node_without_page`（交代法则：一本没有结局的书用显式空声明回答，拒绝的是沉默）；十五项度量只报。全过 → `assembled`，否则 `assembled_not_playable`（图照写，`module.json.playability` 存报告）。写 `module-graph.json` 并递增 `generation`。

**`module.install`** params `{"module_id"}`：`assembled` 或 `assembled_not_playable` 的图登记摘要，状态 `installed`；`assembled_not_playable` 的安装要 `force: true` 并把报告写进 `module.json`（守秘人开桌时胶囊 `where` 会说材料不全）。

**开桌就绪**（`module.status` 的 `opening_ready`）：module 节点、起始场景、其出口指向的场景、起始场景的 NPC 与线索都在图里，且起始子图上十条不变量成立。构建顺序按 `priority`：front / keeper-truth / opening 场景所在 section 先；`opening_ready` 一到就允许 `setup.complete`，其余 section 继续在后台读（14.6）。

### 14.4 建卡进程与七步表

`bin/pi-coc setup [--campaign <id>]` 起一个独立 `pi` 进程：`PI_COC_MODE=setup`，只有 `onboarding` 扩展注册工具（`kernel`/`table`/`memory` 扩展在 setup 模式下不注册任何工具、不拉内核之外的车道），系统提示是一页建卡专用的话，`--no-builtin-tools`。工具只有一个：`setup {step, ...}`。

七步表住在 `content/setup/steps.json`，每步 `(id, needs, kind: ask|external|op, op?, params, receipt)`，扩展与内核都从它派生顺序、可用动作、拒绝语与下一步说明——任何顺序信息只写一次：

| id | needs | kind | 做什么 | 回执 |
| --- | --- | --- | --- | --- |
| `choose-source` | — | ask | 玩家选 starter（`campaign.list` 给的 starter 名单）或给一个资料包目录 | `source: {kind, module_id|bundle}` |
| `build-bundle` | choose-source（pdf） | external | 资料包不存在时告诉玩家怎么用宿主的 PDF 技能产出它，并等；存在则过 | `bundle_path` |
| `bind-source` | build-bundle（pdf） | op | `module.bind`，再 `module.plan`；模组 id 是这一步的产物 | `module_id`, `sections: n` |
| `create-campaign` | choose-source（starter）/ bind-source（pdf） | op | `campaign.create {id, module, title?, play_language, register}`，`module` 取 starter 名或上一步的 `module_id`，status `setting_up`；starter 时同时注册模组；`play_language` 只收内核有模板的标签（`zh-Hans`、`en`） | `campaign_id` |
| `build-opening` | bind-source（pdf） | op | 起构建（`module.build` 由 module 扩展驱动，见 14.5），等到 `opening_ready` | `opening_ready: true`, `sections_accepted` |
| `create-investigator` | create-campaign（starter）/ build-opening（pdf） | op | 14.7 | `investigator_id` |
| `complete` | create-investigator | op | `setup.complete`：写 `setup_handoff` 收据，战役 `ready_for_table`，进程退出并打印 `bin/pi-coc --campaign <id>` | `handoff` |

`setup` 的 `step` 不在表里、前置未满足、或重复已完成的步 → 工具结果带该步的拒绝语与「下一步」（从表派生），不改状态。建卡进程没有胶囊、没有 Director；内核 `table.open` 只开 `ready_for_table` 或 `active` 的战役，其他状态报 `campaign_not_ready` 并给 `fix: bin/pi-coc setup --campaign <id>`。

### 14.5 读者：一段 section 一个子 `pi` 进程

模型侧的读书工作由 `module` 扩展驱动，不在内核里、也不是 `modelRegistry.complete`：每个 section 起一个子进程 `pi -p --no-session --no-context-files --tools read,write,edit,bash --system-prompt content/setup/reader.md`（工作目录 `work/<section_id>/`，模型 `PI_COC_BUILD_MODEL`，缺省与桌子同模型），标准命令由 `module.packet` 返回的 `brief` 给：读 `packet.json`，用 `bin/coc-evidence`（仓库脚本：`search <名字>` 在全节 span 里找、`verify <span-id>` 查 id 是否存在、`page <n>` 看整页）查证据，把 shard 写到 `shard.json`，跑 `bin/coc-review --module <id> --section <id>`（即 `module.review`）看 findings，改到 `accepted` 或放弃。每 section 至多 3 轮（子进程退出后 review 不过就带着 findings 原样重起一轮），超过记 `failed`；读者产出的一切只在 `work/` 里，进 `shards/` 的只有 review 通过并 `module.accept` 的。这是用户法则要求的形状：带工具的 agent 自己开包、自己分多次写、自己跑闸门。

`module.build` 是扩展侧的驱动循环（不是内核方法）：plan → 按 priority 逐 section packet → 子进程 → review → accept → 每接受一片就 `module.assemble`（增量合并，`generation` 递增）→ `opening_ready` 一到发总线事件 `coc:module-opening-ready` → 剩余 section 继续 → 全部结束 `module.install`。并发上限 `PI_COC_BUILD_PARALLEL`（缺省 1）。构建遥测进 `build.jsonl`。

### 14.6 按需深读

`apply` 的 `move` 成功后内核把目标场景所在 section 与其 `route-to` 邻居的 section 中未 `accepted` 的入队（邻居还没有节点、找不到它的 section 时，按印刷顺序取当前场景所在 section 之后第一个未接受的 section——旧树 read-ahead 的脊线规则）（`deepen-queue.json`，reason `move`/`adjacent`，priority 脚下 100、一步之内 80）；`table.open` 时起始场景同理（reason `opening`，90）。module 扩展在游玩进程里有一条后台车道：认领队列（`module.deepen.claim` → `{section_id}`，同一时刻一个），跑 14.5 的读者，review、accept、assemble，`module.deepen.complete`；失败标 `failed` 并留在队列（下次开桌重试一次）。图换代后内核的图缓存按 `generation` 失效。胶囊 `where.exits[].material` 与 `where.material` 取 `ready|reading|missing`（该 section 的状态），守秘人据此知道往哪走会「书还没读到」；`head` 会说。

### 14.7 建卡：模型只问名字与职业概念，数值由内核推导

`setup.occupations` params `{"campaign"}` → `content/rulesets/coc7/rules-json/occupations.json` 的职业清单（id、名字、技能点公式、职业技能、信用评级范围），供建卡进程把玩家的一句「我想玩个战地记者」落到一个职业 id——这一步是语义判断，归模型；内核只认 id。玩家说的行当在清单里没有条目时（护士、卡车司机、码头搬运工），模型不得自作主张换一个近似条目：它要在虚构里说明规则书没有这一栏，报出两三个最近的条目各一句会落成什么，让玩家选或让它定；定了以后 `profile.occupation` 是所选条目，`profile.occupation_stated` 是玩家自己的说法，两者都上卡（§23.4）。

`setup.investigator` params `{"campaign", "name", "occupation": "<id>", "concept"?: "<一句>", "age"?: int, "sex"?, "method"?: "quick_fire"|"rolled"}`：内核确定性地生成整张表——特征值（`quick_fire` 用规则书快速数组按职业主特征分配；`rolled` 用 `characteristic-dice.json` 掷，种子写进收据）、年龄修正（旧 `coc_character` 的规则）、衍生值（HP/MP/SAN/幸运/伤害加值/体格/移动）、职业技能点按公式分配，分配策略是内容不是代码（#21：`steps.json` 的建卡策略块 `allocation`，缺省 `spread`：先把职业技能表每项抬到 `tiers[0]`（如 50），再轮到 `tiers[1]`（如 70），最后到上限，用不完的记 `unspent`；`fill` 是旧的填满式，留作可选；策略名写进 `sheet.creation.allocation`，玩家可在桌上用 `development` 族改）、兴趣点分给 `concept` 无关的规则书通用技能（缺省列表来自规则数据，不是代码字面量）、信用评级取职业范围下限、现金与资产按时代与信用等级、随身装备取职业缺省。写 `party/<id>.json`（与 pregen 同形）与收据 `investigator:<id>`。名字与概念原样存，不做任何判断。同一战役第二次调用是第二个调查员（多人桌留口，本切片桌上仍只用第一位）。

`setup.complete` params `{"campaign"}`：`party/` 至少一人、模组 `installed`（或 `opening_ready`）→ `campaign.json.status = ready_for_table`，写 `setup_handoff` 收据（模组 id、代际、调查员 id、时刻），事件 `setup-completed`。

### 14.8 资产

`assets.json` 由 `module.bind` 从资料包清单登记，`module.assemble` 再把图上 `asset`/`handout` 节点与登记合并（按页码对齐）。`apply` 新增种类 `handout`：`{"kind": "handout", "name": "<资产或 handout 节点名>", "label"?}` → 校验该资产 `visibility` 可给玩家（`player-safe`/`revealable`），写收据 `handout:<id>`，渲染 `【手卡】<label 或名字>`，事件 `handout-shown`，`rendered_text` 之外结果里带 `attachment: {"path", "media_type"}` 供扩展作为附件交给玩家（Pi RPC 的消息附件；驾驭器落到证据目录）。守秘人专属图像走 `lookup {kind: "secret", scope: "scene"}` 的 `assets` 字段（路径），不进玩家文字。

### 14.9 两个 starter 转成模组图

`mystery-house` 与 `the-white-war` 在旧树里只有七文件 IR；把旧 `coc_starter_graph.build_starter_graph`（IR → v3 图的确定性投影）移植为仓库脚本 `scripts/starter_graph.py`，产出 `content/starters/<id>/module-graph.json`（+ manifest），并要求两张图过 14.3 的可玩性标准（不过的先修 IR，不改标准）。此后三个 starter 走同一条注册车道；the-haunting 的图重新投影一次做逐字节对照（`section-curated-starter-projection`）。

### 14.10 验收与证据

- 一本真 PDF（《他们也没想太多》，20 页，zh-Hans；宿主把它读成资料包）从 `bin/pi-coc setup` 走七步到 `ready_for_table`，再 `bin/pi-coc --campaign` 开桌三回合：开场材料（场景、在场者、线索）全部来自构建出的图，守秘人不翻书。证据：`modules/<id>/build.jsonl`、`sections.json`、可玩性报告、三回合的回合记录与胶囊。
- 建卡进程的每一步拒绝与下一步说明只能追溯到七步表（测试从表生成用例）。
- 构建的每一片都有 review findings 日志；装配报告 `dangling_relations == 0`；两个 starter 图过十条不变量。

### 14.11 内核的决定（模组存储与车道，已实现）

- **包与入口。** `kernel/coc/modules/`：`store`（布局、状态梯子、代际、starter 登记）、`bundle`（14.2 字节校验）、`plan`（量与切）、`packet`（span、`page_window`、骨架、词表）、`gates`（机器填充与三道门）、`assemble`（合并与报告）、`playability`（十条不变量、度量、开桌就绪）、`deepen`（14.6 队列）、`assets`（14.8 登记）、`rpc`（`module.*`）、`evidence`/`review_cli`（读者工具）。桌子与建卡进程只经这些入口调用：`ModuleStore(workspace_root)` 的 `register_starter(module_id, starters_dir)`、`module(module_id)`、`exists`、`graph_path`、`generation`、`graph()`（按代际缓存的 `ModuleGraph`）、`section_for_scene(module_id, scene_handle) → {section_id, status} | None`、`assets`、`asset(module_id, name)`；`deepen.enqueue(store, module_id, section_ids, reason, priority) → [入队的 section id]`、`claim`、`complete`、`enqueue_for_scene`、`material_state`；`modules.rpc.methods(table_or_store)` 给 `coc.rpc` 追加 `module.list/status/register/bind/plan/plan.accept/packet/review/accept/assemble/install/deepen.claim/deepen.complete/deepen.enqueue/asset`。词表与不变量从 `content/modules/module-graph-contract-v3.json` 与 `module-graph-template-v1.json`（旧树逐字节副本）读，代码里不再有第二份。
- **`module.json`。** `id, title, source, languages, bundle_sha256?, file_sha256?, page_count?, graph_digest`（`module-graph.json` 文件的 sha256，与 `campaign.json.module_digest` 同算法）`, generation, status, playability, assemble_report, opening, opening_ready, install?`。`module-graph-manifest.json` 的 `graph_content_digest` 用规则图的规范 JSON 摘要，`nodes`/`relations` 按 id 排序写盘。状态只前进：`installed` 之后再 `assemble` 只涨代际、更新可玩性报告，不回落。Starter：内容图的文件摘要没变就是同一代，变了复制一次并 `generation + 1`（战役读存储的当前代）。
- **`module.bind` 的资料包。** 只认 §14.2 的形状：`contract`、`module_identity.title/language`、`source.file_sha256/page_count`、`pages[].{pdf_index,path,sha256,chars?}`、`assets[].{id,kind,name?,pages,path,sha256,media_type}`。逐页 sha256、`chars`、页码 `0..n-1` 连续、`page_count == len(pages)`、资产 sha256 与图片签名（PNG/JPEG/WebP，≤ 20 MiB）都查，坏页与坏资产全部列在 `details.pages` / `details.assets` 后一次报 `invalid_params`，失败不写存储。`bundle_sha256` 是页与资产摘要按页序的 sha256；同一资料包重绑返回 `replayed: true`，不同资料包撞同 id 拒绝。资料包整份复制进 `bundle/`；`assets.json` 里的 `path` 相对模组目录（`bundle/assets/...`）。
- **`module.plan` 的切法。** 整本 ≤ 预算（缺省 60000 字）就是一节；否则跳过目录页（行文在后文重现为标题的页，不看「目录」二字），取最浅的能切出 ≥ 2 节的标题深度作章，超预算的章按页边界贪心再切（`section-NN[-ascii-slug]`；单页超预算不再切，只报 `chars`）。返回候选（`kind: null, priority: null`）、测量、每页首两行（分类 agent 看这个，不看正文）。`module.plan.accept {sections: [{id, kind, priority}]}` 必须把每个候选恰好分类一次，`kind ∈ front|keeper-truth|scene|npc-roster|handouts|appendix|rules|pregens|other`；已有 `accepted` 分片后不再重切。
- **抽取包。** `work/<section>/packet.json`（`coc.module-packet.v1`）：`spans[].{span_id, page, text}`——按空行切段、超 1600 字再切，id `span-p<页>-<段>` 页内从 1 起、页级作用域（同一页在任何包里 id 相同）；`page_window`；`skeleton.module_node`（机器造的 `module-<id>`）与 `skeleton.known_nodes`（已接受分片里 module/scene/beat/event/ending/npc/creature/clue/conclusion/location/faction/organization/handout/asset 的 `{node_id, node_kind, name, visibility, section_id}`）；`vocabulary`、`coverage_domains`、`machine_filled_keys`、`default_visibility: keeper-only`、`output_budget {200, 400}`。`brief` 由 `kernel/coc/modules/brief.py` 的模板渲染，命令是 `bin/coc-evidence --packet <abs> search|verify|page|outline|read|coverage` 与 `bin/coc-review --workspace <abs> --module <id> --section <id>`（两个脚本不 `cd`，读者在 `work/<section>/` 里直接跑；`coc-review` 没给 `--workspace` 时从 cwd 向上找 `.coc`）。读者的常备命令是 `content/setup/reader.md`。第一次 `module.packet` 把模组推到 `building`、section 推到 `reading`。
- **机器填充（校验前）。** 缺省的 `contract_id/schema_version/module_id/section_id/source_language/aspects/node_refs`；`evidence_span_ids` = 根 ∪ 节点 ∪ claim 的并集；`coverage` 未声明的域一律 `unresolved`；claim 缺省 `visibility`（包的 `default_visibility`）、`asserted_by_ids: []`、`known_by_ids: []`、`validity: null`；省略的 `claim_id` 按 `claim-<subject>-<predicate>-<object>` 派生（写了就照写，但必须 `claim-` 前缀）；`relations` 缺席时逐条从 claims 投影（`rel-<claim 去前缀>`），写了就逐条校验与 claim 一致。节点缺省 `visibility/aliases/properties/summary`。
- **三道门。** 每道都跑，findings `{gate, code, path, message, …}`。`shape`：契约键集、`node_id` 必须以 `node_kind-` 起头且全 ASCII kebab、`claim_id` 必须 `claim-` 起头、词表闭合、`unknown_evidence_span`（包里没有的 id）、`evidence_span_out_of_scope`、`node_refs` 必须被 claim/relation 用到。`grounding`：只对书自己印名字的 kind（npc/creature/faction/organization/location/object/artifact/tome/spell/vehicle/handout/investigator-template）查 `name`/`aliases` 至少一个出现在它引用的 span 里（宽度折叠、去空白、大小写折叠后的包含）；每个节点 `summary`/`properties` 与 claim `reason` 里的每个数字串都要在其引用的 span 里（「五十三岁」写成 `53` 会被打回——这就是它要防的）。`coverage`：十个域都有交代、状态合法、未声明的 aspect 只能 `unresolved`；`span_consumption`、`substantive_spans_uncited`、节点/claim/relation 数只进 `measures`。空 shard（不引用任何 span）在 `shape` 门拒绝。`module.review` 每次计一轮（`sections.json.rounds`），写 `findings.json` 与 `shard.filled.json`，`build.jsonl` 记 `{section_id, round, findings_codes, accepted, measures}`；`module.accept` 重跑三门，通过则把**填充后**的 shard 写进 `shards/`。
- **装配。** 骨架 = 机器造的 module 节点（引用第 0 页第一个 span，第 0 页不在已接受 section 里就引用书序最早已接受 section 的第一个 span）+ 对每个 scene/beat/event/ending 的 `contains` claim 与 relation（证据取该节点自己的 span）。分片按 section 的起始页序合并：同 id 不同 kind → `node_kind_conflict`（先到者留，后者整个丢）；同 id 同 kind 字段冲突 → 证据 span 多者胜、平手先到者胜，记 `merge_notes`；同 id 的 claim/relation 意义不同 → `claim_conflict`/`relation_conflict`（先到者留）；`inferred-candidate` 让位于任何 `authored-*`；未被定义的 `node_refs` → `unresolved_node_refs`；端点不在图里的 relation → `dangling_relations`（关系照写进图，不变量再判）。`source_refs` 由 span 页派生：`{source_id: "pdf:<module_id>", pdf_index, grep_anchor}`。读者写的同 id module 节点并进骨架（证据并集，字段以骨架为准）；它的 `properties.entry_scene_ids` / `ending_scene_ids` / `unpaged` 提升为图级声明。scene 节点补最小 `runtime_projection.record {scene_id, display_name, is_start, is_final}`（`is_entrance`/`is_ending` 或 `is_start`/`is_final` 属性），使 `ModuleGraph.start_scene()` 不改就能读；不写 `available_clues`/`npc_ids`——`ModuleGraph` 从关系读。`assets.json` = 资料包资产 + 图上 `asset`/`handout` 节点按页对齐（同页唯一未认领的资产、或同 kind 唯一者归该节点；节点定 kind/name/visibility，资产给字节）。写图后 `generation + 1`，`module.json` 存 `playability`（含 findings 与度量）、`assemble_report`、`opening`、`opening_ready`。
- **可玩性怎么判。** 十条不变量按**这个内核**的投影判，不按旧投影：可走的图是 `scene` 节点（`ModuleGraph.scene()`/`apply move` 只解析它；模板的 beat/event/ending 是旧投影的四种），出口是 `route-to` ∪ 模板的四种入口关系 ∪ 记录的 `scene_edges`；入口 = `entry_scene_ids`（图级或 module 节点 properties）或 `properties.is_entrance`/`is_start` 或记录 `is_start`；结局 = `ending` 节点、`ending_scene_ids`、`properties.is_ending`/`is_final`、记录 `is_final`；线索安放 = `discoverable-at` 或记录 `available_clues`；在场 = `present-in` 或记录 `npc_ids`；有页 = 任一 span 报页（`span-p<n>-` 与 `span-page-<n>-` 两种拼法）、`source_refs[].pdf_index`、`properties.pdf_index`、记录 `source_refs`。交代口：`entry_scene_ids: []`、`ending_scene_ids: []` 说「书没写」；`unpaged: true`（图级或 module 节点）说「本模组没有源页」，只免 `node_without_page`。度量按模板全部十六项报（模板列了十六项，契约说十五；`span_consumption` 与 `substantive_spans_uncited` 只在有证据目录时有值）。
- **开桌就绪。** `opening_ready` = module 节点在、恰好一个入口、起始场景的每条出口都指向图里的场景、记录里点名的 NPC/线索都在图里、且诱导子图（module、起始场景、出口场景、在场 NPC、可得线索、这些线索支持的结论；不含 beat）上十条不变量成立——结局的交代取整图（结局往往在没读的 section 里，带声明不带节点）。`module.status` 每次从当前图现算；`module.json.opening_ready` 是装配/登记时的快照，`setup.complete` 读它。the-haunting 的开场邻域整页齐全，`opening_ready: true`；整图报 2 个 `actor_in_no_scene` 与 32 个 `node_without_page`（beat/concept/secret 无证据）——是 IR 事实，starter 仍按契约 `installed`。
- **安装。** `assembled` 直接装；`assembled_not_playable` 无 `force` 报 `invalid_params`（`details.finding_counts/findings`），`force: true` 装并把 `install {forced: true, finding_counts}` 写进 `module.json`；已装的重复调用 `replayed: true`。
- **深读队列。** `deepen-queue.json` 是列表，行 `{section_id, reason, priority, status: queued|claimed|failed|done, retries, at, claimed_by?, detail?}`。`enqueue` 跳过 `accepted`/`skipped` 的 section；已在队列的取更高优先级；`failed` 的重入队一次（`retries ≤ 1`）；返回本次入队或改动的 id。`claim` 一次只出一个（有 `claimed` 就返回 None），按优先级、入队时间取，并把 section 置 `reading`；`complete(ok=True)` 出队，`ok=False` 留队标 `failed` 并把 section 置 `failed`。`section_for_scene`：从当前图找场景，取其页所在 section；starter 没有 section 时返回 `{section_id: null, status: accepted}`；场景不在图里返回 None。`enqueue_for_scene(store, module_id, handle, reason=move|opening)`：脚下 100/90，`route-to` 邻居 80（`adjacent`）。
- **资产解析。** `asset(module_id, name)` 按登记的 `id`、`name`、`aliases`、`node_id`、去 `asset-`/`handout-` 前缀的 id、资料包 `bundle_asset_id` 归一化匹配；有字节的 `path` 返回绝对路径；带 `authored_text` 的手卡同时给 `text` 与 `authored_text`。`module.asset` 找不到报 `unknown_entity` 带候选。
- **没做与留口。** 可玩性检查不做 `merge_notes` 之外的语义仲裁；`module.plan` 的候选切法不接受模型改页界（切法是测量）；`deepen` 的读者驱动在扩展侧（14.5）；`bin/coc-evidence` 的 `--regex` 只是文本查找工具，不参与任何判定。

### 14.12 内核的决定（建卡、starter 与桌面接线，已实现）

- **状态梯子。** `campaign.json.status ∈ {setting_up, ready_for_table, active}`，只前进。`campaign.create` 的 `pregen` 改为可选：给了 pregen 就与从前一样直接 `active`（队伍已齐，没有要交接的东西）；不给则 `setting_up`、`party/` 为空，直到 `setup.investigator` 与 `setup.complete`。两条路都在建战役时把 starter 登记进模组存储（K5a 的 `ModuleStore.register_starter`），并在 `campaign.json` 记 `module_id`、`module_digest`（文件 sha256）与 `module_generation`。`table.open` 只开 `ready_for_table` 或 `active`；`setting_up` 报 `campaign_not_ready`，`fix` 取七步表的 `table_open_fix`（`bin/pi-coc setup --campaign <id>`）；第一次成功打开 `ready_for_table` 的战役把它翻成 `active` 并记 `activated_at`。其余 `table.*` 方法在非 `active` 时一律 `campaign_not_ready`。在存储出现之前建的战役第一次 `table.open` 时自动登记其 starter。
- **图从存储读。** `Table.graph()` 在模组已登记时读 `.coc/modules/<id>/module-graph.json`，缓存按 `generation` 失效；未登记（`campaign.create` 之前、`kernel.hello`）退回 `content/starters`。
- **七步表只写一次。** `content/setup/steps.json`（`coc.setup-steps.v1`）：`steps[]` 每步 `id, needs, only_for, kind, op, params, receipt, lines{zh-Hans,en}{do,next}`，顶层 `templates{unknown_step, needs_unmet, already_done, all_done}`、`table_open_fix`、`launch_line`、`start`、`sources`。`only_for: pdf` 的步在 starter 车道视为已满足。`build-opening` 标 `side: extension`（§14.5 说它是扩展的驱动循环，不是内核方法）；其余 op 步的 `op` 都是内核方法。内核 `setup.steps` 原样返回这张表；内核自己也只从它读 `table_open_fix`、`launch_line`、下一步说明与建卡策略。
- **建卡策略住在表里，不在代码里。** `create-investigator.defaults`（`method: quick_fire`, `age: 27`）、`formulas.personal_interest_points = "INT*2"`、`interest_pool.exclude = [Cthulhu Mythos, Credit Rating]` 是内容数据；规则书数字全部来自 `rules-json`：快速数组、特征骰与倍数（`characteristic-dice`）、年龄档（`age-adjustments`）、HP/MP/SAN 除数（`derived-attributes`）、伤害加值与体格（`damage-bonus-build`）、移动（`movement-rate`）、技能基础值与 75 上限（`skills`）、职业公式/技能表/信用范围（`occupations`）、现金与资产（`cash-assets`）。表上每个数在 `sheet.creation` 里写明来源表。兴趣点公式与 27 岁缺省是本切片放进 steps.json 的两个策略数，宜迁入 rules-json。
- **确定性建卡的取舍。** `quick_fire`：数组按「公式点名的特征优先（EDU 先，备选项按公式顺序），其余按 `characteristic-dice` 的键序」分配。`rolled`：每项按其骰式 ×5，种子来自 `params.seed`，缺省由内核 rng 铸一个 32 位数；种子写进收据与 `creation.seed`，同种子同表。年龄档：EDU/APP 扣减照表；STR/CON/DEX 的扣减总数按表列的选项均摊（余数给前面的）；EDU 提升检定按 `edu_improvement_checks` 次数掷 1D100，大于 EDU 则加 1D10，封顶 99；幸运按 `luck_rolls_keep_highest` 取高。职业公式的「either A or B」取点数最高的一支并在 `budget.alternative` 写明；`Credit Rating` 取职业范围下限并从职业点里扣除。职业点与兴趣点都是「按表顺序一次一点轮转，达上限跳过」；用不完的写 `unspent`，不硬塞。职业技能表里不是目录名的短语（`any one other skill`、`one interpersonal skill (...)`、`Art/Craft (any)`、`Own Language`）原样放进 `choices_pending`，留给桌上的 development 族——内核不猜。`era` 缺省取模组节点记录，可用 `params.era` 覆盖；该时代没有标准技能表或财务档时（the-white-war 的 `ww1`），兴趣点记为 `unspent`、`finance: null` 并写原因，不套别的时代。装备表没有职业字段，`equipment: []` 并写明。
- **收据与文件。** `setup.investigator` 写 `party/<id>.json`（与 pregen 同形，含 `current_*` 与 `creation`），收据 `investigator:<id>` 追加进 `campaign.json.setup.receipts`；`id` 缺省是拉丁名的 kebab，非拉丁名用 `inv-<n>`。`setup.complete` 要求 `party/` 非空、模组 `installed` 或 `opening_ready`，写 `campaign.json.setup.handoff`（收据 `setup:handoff`、模组 id、代际、调查员、`launch` 行）、事件 `setup-completed`（turn 0）、一次 git 提交 `campaign <id>: setup handoff`，状态 `ready_for_table`；再次调用返回同一份 handoff 带 `replayed: true`。`setup.occupations` 把 `occupations.json` 原样列成 `{id, name, skill_point_formula, occupational_skills, credit_rating_range, tags}`；不认识的 id 报 `needs`，`details.needs = {field: occupation, options}`。
- **材料状态与深读入队。** 胶囊 `where.material` 与 `where.exits[].material` 由存储的 `section_for_scene` 映射：无 section 或 `accepted` → `ready`；`planned/reading/claimed` → `reading`；`failed/skipped`/查不到 → `missing`；`head` 说明这三个词。`apply move` 成功后把目的地与其 `route-to` 邻居里未 `accepted` 的 section 交给 `deepen.enqueue`（脚下 100、邻居 80），结果带 `deepen_queued` 与 `material`（`material_ready` 现在等于 `material == "ready"`）；`table.open` 对起始场景同理（`opening`，90）。starter 没有 section，什么都不入队。
- **`apply handout`。** `{kind: handout, name, label?}` 解析 `handout` 或 `asset` 节点；`visibility` 不是 `player-safe`/`revealable` 报 `invalid_params`（`details.visibility`），整批不写。收据 `handout:<handle>-t<turn>`，渲染 `【手卡】<label 或名字>`，事件 `handout-shown`，`world.handouts_shown` 记录。`attachment`：记录里有 `authored_text` 的卡片落成 `<campaign>/handouts/<handle>.md`（`text/markdown`）；否则取存储登记的字节或图上的 `asset_ref`/`image_ref`，文件在就给绝对路径，不在就 `{path: <引用或 null>, available: false}`——没有的媒体不编造，收据与那一行照写。结果同时给 `attachment`（第一张）与 `attachments`。
- **starter 投影。** `scripts/starter_graph.py` 移植 `build_starter_graph`：模组身份取 `module-meta.json`（`scenario_id`、`title`、`one_liner` 作摘要）与可选的 `module-graph-assets.json`；没有资料目录就没有 source-document 节点、页引用与资产。缺的文档投影成显式空声明（`absent: true`，空集合），清单 `projection.absent_documents` 列出；`coverage` 按文档到域的表算 `accepted/partial/absent`。整本 story graph 没有 `scene_edges` 时（the-white-war），`route-to` 由 `exit_conditions` 与 `entry_conditions` 的旗标相等推出（关系带 `derived_from: exit-entry-flag`），入口是没有推出入边的唯一场景、结局是没有出边的场景，写进记录的 `is_start/is_final`（节点 `properties.derived` 记明）与模组节点的 `entry_scene_ids/ending_scene_ids`，推不出唯一入口就拒绝并要求修 IR。声明语言之外的文字只计数上报（`cjk_outside_declared_languages`），不再拒绝。the-haunting 重投影与提交的图逐字节一致，前提是把旧脚本写死的三个字面量（source-document 节点 id 与名字、模组摘要）以 CLI 参数给回——它们应迁入资料目录。清单不带时间戳，重投影可复现。
- **可玩性检查的现状。** 两张新图与 the-haunting 一起过 K5a 的十条不变量：没有源文档的 starter 每个节点都是 `node_without_page`（the-haunting 也有 32 个），检查器目前没有「本模组无页」的声明口；此外 mystery-house 的 `npc-rat-swarm` 不在任何场景，the-white-war 有三条线索无处可得——都是 IR 事实，测试把它们钉住，改了 IR 会立刻看见。
- **`apply item` / `apply cash`（#19，已实现）。** 两种效果都在批内的暂存表副本上算，整批校验通过后才写；写回只覆盖 `equipment`/`weapons`/`finance`/`cash` 四个字段（同批的 `damage` 直接把 HP 镜像到表上，不能被暂存副本盖掉）。`item`：`to` 缺省为唯一调查员（多人报 `needs_choice`）；`from` 先按图上 NPC 精确名解析、再按 12.4 的整词规则（`Knott` → Steven Knott），解析不到原样保留（来源是叙事，不是世界写入）；`quantity` 缺省 1、必须非零整数；`weapon` 对合并表解析（`weapons.json` 全表加模组自己的行，与战斗会话读的是同一张——契约写的 `equipment.json` 是 Table XVII 价目表，没有伤害/射程/弹容，profile 一直住在 `weapons.json`），按 id 或 display_name 归一化匹配，取不到报 `needs`（`options` 为该时代可用的 id，`close` 为 difflib 最近的至多 6 个，`source` 指向表）。得到时 `equipment[]` 追加 `{name, quantity, turn, from?, label?, weapon?}`（同名字典条目合并数量），给了 `weapon` 就同时追加 `weapons[]` 一行（pregen 同形：`weapon_id, name, label?, profile, skill, damage, range, attacks, ammo, malfunction, turn`，数值全出自 profile）；`resolve_investigator_weapon` 从此也认 `label`。失去时按 `name`/`label`/`weapon_id` 归一化匹配，持有数 = 装备条目数量之和（裸字符串算 1），没有装备条目时数武器行（pregen 的手枪只有武器行）；持有不足报 `invalid_params`（`details.held`）；清零后同名武器行一并删除。收据 `item:<slugify(name)>-t<turn>-c<n>`（同批重复加 `-2`…），带 `before/after` 持有数；渲染 `【变化】物品：<人> 得到/失去 <label 或名>[ ×n]`；facts 句 `物品：<人> 得到 <名>`；事件 `item-transferred {name, to, from?, weapon?, quantity}`。`cash`：`subject` 缺省同上；`delta` 非零整数；表上没有 `finance` 块（pregen 的 `cash` 是散文，不解析）就按 `cash-assets.json` 的时代与信用评级建一个（chargen 同形，`source: cash-assets.periods.<era>`）；时代没有档（`ww1`）从 0 起、`source: null` 并在 `note` 写明余额是现金收据之和；余额不能为负（`invalid_params`，`details.before/delta`）；同时更新 `sheet.cash` 显示串。收据 `cash:t<turn>-c<n>`，`resource: cash`、`label: 现金`、`before/after/delta/currency`；渲染 `【变化】现金：<人> <前> → <后>`；facts 用 `delta` 句式；事件 `resource-changed`（`resource: cash`）。事件类型表加 `item-transferred`（十五类）。
- **职业点分配策略（#21，已实现）。** `steps.json` 的 `create-investigator.allocation = {default: spread, options: [spread, fill], tiers: [50, 70]}`，`params.allocation` 可选覆盖；不认识的策略报 `invalid_params`（`details.stage: allocation`，`expected.options/default`）。`spread` 把职业技能表**每一项**当一个槽位，按书上顺序、按层（`tiers`，再到上限）走：能落到目录名的技能抬到该层；落不到的短语（`any one other skill`、`Firearms` 这类组名）**预留该层的值**——基础值未知，少于此不保证到层——记在 `occupation.reserved[{for, points}]`，仍算 `unspent`，留给桌上的 development 族；预算耗尽即停。`fill` 保留旧的一点轮转（只在能落到目录名的技能上，不预留）。`sheet.creation.allocation = {policy, tiers, source}`，`occupation.allocation` 与收据 `allocation` 给策略名，收据另给 `occupation_reserved`。真桌案例（Military Officer，快速数组，300 点）：`fill` 给 75/75/75/75 余 35；`spread` 给 50/50/50/50，预留 Firearms 50、两项交涉技能 50、任一其他 35——「四项到 75」与「其余为零」是同一个原因：三个短语从未参与分配，光换层不换槽位仍是 75×4。兴趣点仍按旧法轮转（本票未动）。

### 14.13 切分有目标值，预算只是天花板（票 #33，已实现）

真桌证据（2026-09-06，《冰冷的收获》48 页 53,118 字）：预算缺省 60,000，整本装得下，于是切成**一段**并自动接受；同一份 `measured` 里按一级标题能切 11 段、最大 10,058 字。后果全发生了——读者第 1、2 轮被 grounding 打回（`name_not_on_cited_pages`、`number_not_on_cited_pages`），span 消费率 0.395、34 段实质内容没被引用，按需深挖队列没有第二段可挖（§14.6 在这类书上等于不存在）。

- **两个数。** `budget` 是天花板（任何 section 都不许超过），`target` 是**一段该多大**的目标值，`module.plan` 新增可选参数，缺省 20,000；`target` 永远取 `min(target, budget)`（把预算调到目标之下，是说段要更小，不是更大）。两个数都写进 `plan.json` 与 `module.plan` 的结果。
- **选法**（全是机器量出来的，模型不参与；目录页在每一层都跳过）：
  1. 全书 ≤ target → 一段，`basis: whole_book_within_target`。
  2. 否则在 1–6 级标题里，取**最浅**的、能切出 ≥ 2 段且每段 ≤ target 的那一层 → `heading_depth_<d>_within_target`。最浅优先，是因为它给出最接近目标的大段，不会把书切碎。
  3. 没有就取最浅的、能切出 ≥ 2 段且每段 ≤ budget 的那一层 → `heading_depth_<d>_within_budget`。
  4. 还没有就取最浅的、能切出 ≥ 2 段的那一层，超预算的章按页边界再贪心切 → `heading_depth_<d>_split_by_budget`。
  5. 一层都切不出 ≥ 2 段：全书 ≤ budget 就是一段（`whole_book_no_heading_structure`），否则整本按页边界切（`budget_only`）。
- **理由与备选都留痕。** `basis` 说清是哪条规则选的；`measured.heading_depth_cuts` 每一层多给 `smallest_chars`、`divides`、`within_target`、`within_budget`，被否掉的备选原样在 `plan.json` 里。旧的 `whole_book_fits_budget`、裸 `heading_depth_<d>` 两个 basis 值不再出现。
- **对照。** 同一本《冰冷的收获》按新法走第 2 条：一级标题 11 段，最大 10,058 字。tiny 夹具（503 字）仍是一段（`whole_book_within_target`）；`budget: 200` 仍按二级标题切四段（`heading_depth_2_within_target`）。

### 14.14 开场歧义是一次待裁的选择，不是死等（票 #33，已实现）

真桌证据：《冰冷的收获》抽出两个开场场景，`opening_check` 不猜，`module.json` 停在 `{"opening_ready": false, "missing": ["start_scene_ambiguous:scene-nkvd-briefing-opening1,scene-nkvd-briefing-opening2"]}`，而模组已经 `installed`、可玩性 `playable`。建卡第五步只回了一句「还没就绪」，模型于是**连着调了 216 次 `build-opening`**（00:59:53–01:08:20），玩家的每一句都被 `Agent is already processing` 顶回，直到驾驭器杀进程。**哪个是开场是书的问题，内核不猜；但拒绝里必须有下一步。**

- **内核给候选。** `opening_check` 在只差「哪个是开场」时多带一个 `choice`：`{"field": "start_scene", "reason": "start_scene_ambiguous", "candidates": [{"node_id", "scene", "name"}], "method": "module.opening.choose", "ask": "<一句英文指令>"}`；`missing` 里那条字符串照旧（它是证据）。别的原因（缺场景、邻域断裂）是构建问题，不是问题句，没有 `choice`。`module.status` 与 `module.assemble` 的 `opening` 都带它。
- **`module.opening.choose {module_id, scene}`。** `scene` 只能是书自己声明的候选之一（按 node_id / 场景 handle / 名字归一化匹配）；不是候选就报 `needs_choice`，`details.candidates` 给全部候选。选中的写进 `module.json.opening_choice = {start_scene, at}`，然后重新装配一次。starter 的图是内容的逐字节副本，这个方法对它报 `invalid_params` 并说明去改内容图。
- **选择应用在两个机器自己的位置上**：图级 `entry_scene_ids = [选中]`（可玩性检查读它）与每个场景 `runtime_projection.record.is_start`（`ModuleGraph.start_scene()` 走它）。书自己写的 `properties.is_entrance` 一个字不动——那是证据，不是选票。选择存在 `module.json` 里，**每次装配重放**，所以后来的深挖长了图也不会把它抹掉。
- **`ModuleGraph.start_scene()` 的拒绝带路。** `campaign_not_ready`（声明了 N 个开场）现在带 `fix`（指向 `module.opening.choose`）与 `details.candidates`。
- **建卡第五步 `build-opening` 三个答案、一次沉默**（`extensions/onboarding`）：开场已定 → 这一步过；书已读完而开场歧义 → **当轮返回** `ok:false`，带 `needs: ["start_scene"]` 与候选（含名字），并说明「等下去不会好」；模组已 `installed` 且可玩性 `playable` 而开场仍未定 → 以 `ok:true, opening_ready:false, opening_pending:true` 收尾（「已就绪，开场待定」），建卡照常往下走。候选**只交一次**：同一本书第二次不带 `start_scene` 再来，直接走「收尾」那一支——所以这一步最多问一轮，永远打不了转。书还没读完时才是沉默：起构建、等总线，超时那一支不变。步表 `build-opening` 因此多一个可选参数 `start_scene`。
- **不要在读书之前就问。** 问句只在「书已读完」（构建结束，或存储已经说 `installed`）之后出；否则这一步会用一句问话顶掉整本书的构建。

### 14.15 闭合词表的拒绝要带候选，且候选要活过投影（票 #33，已实现）

真桌证据：模型连试 `play_language: "zh"`、`"zh-CN"`，然后放弃传参。内核那一侧**本来就带 `fix`**（`one of ['zh-Hans', 'en']`），是建卡工具把内核错误投影成工具结果时只抄了 `code` 与 `message`——可照做的那半截死在接缝上。

- 每条闭合词表的拒绝同时给 `fix` 与 `details.options`（实体名用 `details.candidates`）。本票补齐：`campaign.create` 的 `play_language`/`register`、`table.look` 的 `scope`、`resolve` 的 `action.defense`/`action.mode`、`apply npc` 的 `to`、会话族的 `combat`/`chase`/`sanity` 命令词、`state.end_session` 的 ending kind、`setup.investigator` 的 `allocation`，以及 §14.14 的 `start_scene`。
- **拒绝的可照做部分必须活过每一层投影**：`extensions/onboarding` 的工具结果现在带 `fix` 与 `details`。任何把内核错误压成 `{code, message}` 的地方都是同一个缺陷。

## 15. 世界线：if 线、时间回溯、跨线知晓与汇流（切片 6，票 #23）

一条世界线就是战役 sidecar 仓库里的一条分支。玩家在一个战役里同一时刻只玩一条线；可以分叉、回溯、切换、汇流；所有线都留着（证据永不删除）。什么跨线留下、谁记得别的线、汇流时怎么合，由模组图声明、内核确定性地算；守秘人只在胶囊里看到这是第几圈、锚点在哪、留下了什么、谁记得、有哪些回声可投放。世界线操作是世界的改变，所以走 `apply`（法则二），并在那一回合提交之后由内核执行——守秘人仍然只有七个动词。旧树世界线系统的双时态断言、九种记忆状态、跨战役转移、自动合并策略都不回来。

### 15.1 存储与身份

- `campaign.json` 加 `active_worldline`（缺省 `main`）与 `worldlines`：`{<name>: {"name", "kind": main|if|loop|merge, "loop": <圈数，main 为 0>, "forked_from": {"line", "turn", "commit"} | null, "parents": [{"line", "turn", "commit"}]（merge 才有）, "seed": "<sha256 前 16 位>", "status": active|dormant|merged, "last_turn", "last_commit", "created_at"}}`。
- git：分支 `wl/<name>`。没有 `worldlines` 的旧战役第一次 `table.open` 时把当前 HEAD 登记为 `wl/main`（裸仓库的 HEAD 符号引用指向它），不改任何提交。
- 战役目录始终是活动线的工作树：`world.json`、`turn.json`、`turns/`、`save/`、`memory/`、`transcript.jsonl`、`events.jsonl`、`telemetry.jsonl` 都被提交，所以切线 = 检出另一条分支，那条线的一切自然回来。
- 回合号按线延续：在第 N 回合的提交上分出的线，第一回合是 N+1；线内收据 id 不变（线内唯一），跨线引用一律用 `{line, turn, receipt}` 三元组；记忆候选写入时带 `worldline` 与 `loop`。
- 每条线一个骰子种子：`sha256("<campaign>:<line>:<forked_from.commit>")` 前 16 位，激活线时按它与回合号重播 rng；`COC_KERNEL_SEED` 仍能覆盖（测试）。同一动作在两条线上掷出不同的骰。

### 15.2 模组声明（没有声明就没有循环）

- `resets-to`：从循环终点（`ending`/`event`/`scene` 节点）指向锚点场景。`properties.reset` 闭合：`{"clock": "anchor"|"keep", "investigators": "anchor"|"keep"}`，缺省都是 `anchor`。
- `persists-across-loop`：从线索/物品/条件/知晓节点指向模组节点或锚点场景：回溯时这些东西留下（已发现的线索仍算发现，物品仍在表上——依赖 #19，条件仍在）。没有这条关系的一律重置。
- NPC 跨圈记得：NPC record 的 `remembers_across_loops: true`，或 NPC 到模组节点的 `knows` 关系带 `properties.across_loops: true`。只有这些 NPC 能看到别的圈的知晓。
- 模组节点 record 的 `structure_type: time_loop`：Director 用 `time_loop` 的结构权重；`loop_count`、`echoes_here`、`loop_available` 三个信号进 `because`。
- 锚点快照：第一次 `loop` 分叉时，内核从回合记录里找到队伍**第一次进入锚点场景**的那一回合（世界快照的场景等于锚点），以那一回合关闭时的世界与表为锚点快照，存 `save/worldlines/anchor.json`；起始场景就是锚点时取建战役时的状态。之后每次回溯都回到这份快照，不重新算。
- 没有 `resets-to` 的模组：`fork` 的 `kind: loop` 报 `invalid_params`（`fix: this module declares no loop anchor; mode: if forks the line as it stands`）；`if` 永远可用。

### 15.3 `apply` 的三个世界线效果

世界线操作是回合里的一条效果，和别的效果一样整批校验、落收据、进遥测；执行在**那一回合 `narrate` 提交之后**（12.2 的提交后链里，检查点之前），所以叙述先交付「你眼前一黑，又回到了……」，下一条玩家输入落在新线的第一回合。一个回合最多一条世界线效果，且它必须是本批最后一条；带世界线效果的回合不能用 `ask` 关闭。

- `{"kind": "fork", "name": "<线名>", "mode": "if"|"loop", "from_turn"?: int, "label"?}`：`if` 在 `from_turn`（缺省本回合）的提交上开分支，世界原样；`loop` 在本回合提交上开分支，然后按 15.2 写重置后的世界与表作为新线的第一个提交（`loop <n> reset`），`loop = 父线 loop + 1`。收据 `fork:<name>`，渲染 `【变化】世界线：<label 或名>（if | 第 n 圈）`，事件 `worldline-forked`。父线转 `dormant` 并记 `last_turn`。
- `{"kind": "switch", "line": "<线名>", "label"?}`：本回合提交后检出那条线；收据 `switch:<line>`，渲染 `【变化】世界线：切到 <名>`，事件 `worldline-switched`。目标线必须存在且不是 `merged`。
- `{"kind": "merge", "name": "<新线名>", "lines": ["<a>", "<b>", ...], "into"?: "<场景>", "dispositions"?: {"<conflict id>": {"mode": "from", "line": "<a>"} | {"mode": "min"|"max"|"sum"} | {"mode": "drop", "note": "..."}}}`：先算汇流报告（15.4）；有未处置的冲突就报 `needs`，`details.conflicts` 列出每条冲突与它允许的处置模式，整批不写；处置齐了才落收据 `merge:<name>`，渲染 `【变化】世界线：<a>、<b> 汇入 <名>`，事件 `worldline-merged`；提交后新建分支 `wl/<name>`（起点取 `lines[0]` 的末提交），写合并后的世界、表、记忆并集、回声，做一次带全部父提交的合并提交（`git merge -s ours --no-commit` 记父，再 `commit`），被合并的线转 `merged`。

### 15.4 汇流报告与回声

The extension includes each merge conflict's semantic ID, class, subject, field
and allowed modes in the model-visible error body. Scalar conflict values remain
visible. For `mod_state` and `engine_state`, it lists the available source lines
instead of expanding entire snapshots; those classes can only select one whole
line. Full snapshots remain in structured interface details. The Keeper can then
submit the chosen dispositions without guessing IDs or repeating the failed call.

- 合并口径：在场者取并集（按图重算 `npc_presence` 后叠加各线的移动）；已发现线索取并集；`flags` 取并集（冲突则报）；物品按名字取并集，但一条线消耗掉（`quantity` 为负的 `item` 收据）而另一条线还在的报 `consumed`；调查员的幸运各线不同报 `numeric`；**HP/SAN/MP 不再单独比**——它们是引擎存档的镜像（`mirror_investigator`「把引擎的看法写回卡片」），逐字段挑会拼出一个从未存在过的状态（HP 取 A 线、重伤盒取 B 线），所以连同 `save/` 下各引擎的快照一起作为**一条** `engine_state` 冲突整体择一；一条线死了（HP < 0 或 `dead` 条件）另一条活着报 `dead_alive`；一次性效果与已掷的骰**不合并**（它们是各线历史里的收据，合并提交把两段历史都留着，不重复计入状态）。
- 冲突类别与允许的处置（闭合表）：`numeric` → from|min|max（只剩幸运；见上）；`dead_alive` → from；`consumed` → from|drop；`flag` → from；`npc_presence` → from|sum（并集）；`mod_state` → from；`engine_state` → from（**只能整条线地取**：一条线说疯了、另一条说没疯，没有中间值，而且快照里的到期时刻是绝对 clock 分钟）；`clue` 永不冲突（并集）。`drop` 必须带 `note`。旧树的清单 `NON_DUPLICABLE_CONFLICT_CLASSES`（死亡、一次性效果、消耗、已掷骰）在这里体现为：这些类别没有 `sum`/`duplicate` 模式。
- 冲突 id 是语义的：`conflict:<class>:<subject>:<field>`，同一报告重算两次逐字节相同。
- 回声：分叉（loop）与汇流时，内核从其他父线（回溯时是上一圈）的回合记录生成 `save/worldlines/echoes.json`：每条 `{"id": "echo:<line>-t<n>-<k>", "line", "loop", "turn", "scene", "kind": presence|clue_taken|fight|death|move|handout, "summary": "<从收据确定性生成的一句 play_language>", "receipts": [...], "entities": [名]}`。回声是守秘人专属的可投放证据：`apply {"kind": "clue", "clue": "echo:<id>"}` 把它揭示给玩家（渲染 `【变化】线索：<label 或 summary>`，进 `world.discovered_echoes`），之后 `known` 里能看到；回声不是叙述，是收据的投影，守秘人不能改它的内容，只能决定揭不揭示、怎么讲。

### 15.5 记忆与跨线知晓

- 候选写入时带 `worldline` 与 `loop`。分支包含 `memory/` 文件，所以 `if` 线自然带着分叉点之前的记忆；`loop` 线也带着上一圈的候选——调查员记得上一圈，这是设计。
- `recall memory` 加 `line: current|any|<name>`（缺省 `current` = 当前分支文件里的一切）；`any` 从 git 读每条线的 `memory/candidates.jsonl`（`git show wl/<x>:memory/candidates.jsonl`）取并集，命中带 `worldline`、`loop`。
- 跨圈知晓的投影只对 15.2 声明的 NPC：`present[].known_facts` 与 `lookup secret scope=scene` 里多一组 `from_other_lines: [{statement, line, loop}]`，取该 NPC 作为主语或知情者、且 `loop < 当前圈` 或 `worldline != 当前线` 的候选；其他 NPC 一条不给。
- 胶囊 `worldlines.previous_loop`：调查员上一圈的候选前 4 条（`recall memory` 排序），标「上一圈」。

### 15.6 胶囊、Director、恢复

- 胶囊加 `worldlines`（≤ 1.5KB）：`{"line", "kind", "loop", "anchor": {"scene", "since_turn"} | null, "persisted": [名], "remembers": [在场且跨圈记得的 NPC 名], "echoes_here": n, "echoes": [{"id", "summary"}]（≤ 3）, "previous_loop": [{"statement", "turn"}], "lines": [{"name", "kind", "loop", "last_turn", "status"}], "loop_available": bool}`。`loop_available` 在当前场景/事件带 `resets-to` 时为真，同时 `obligations` 多一条 `kind: loop` 的账（「模组的循环在此可回溯」），由守秘人决定问不问玩家；玩家说「回溯」时守秘人用 `apply fork mode: loop`。
- Director：`time_loop` 结构权重来自图；三个新信号进 `because`；不加新的数。
- 续行检查点记 `worldline`；`table.open` 打开 `active_worldline`；`recall history {lines: true}` 返回线的树（每条线的分叉点、圈数、末回合、父线）。所有线都是分支，永不删除。

### 15.7 扩展侧

- `tools.ts`：`apply` 的 `effects` 加 `fork`/`switch`/`merge` 三种，描述里写清「回合提交后才发生、一回合一条、必须最后一条、不能配 `ask`」。
- 守秘人提示加一段：世界线是什么、回溯与 if 的分别、回声只能揭示不能改、跨圈记得的只有胶囊说记得的那些 NPC。
- `table` 扩展状态行显示线名与圈数。

### 15.8 验收

- 用新管线从 41 页 OCR 重新构建《不息的渴望》，读者提示里点明循环词表（`resets-to`、`persists-across-loop`、`remembers_across_loops`）；图不带循环声明就是构建缺陷，不手补内容。
- 真桌：玩到循环终点回溯，第二圈与第一圈不同（骰子、NPC 反应、Director 节拍），声明记得的 NPC 表现出记得；再开一条 if 线并与主线汇流，汇流报告出冲突、守秘人处置、回声被投放并揭示。KPI 与前几个切片同一脚本。
- 旧树 `tests/test_timeline_dag.py`、`test_timeline_fork_rewinds.py`、`test_timeline_confluence.py`、`test_toolbox_timeline*.py` 的用例名作为行为清单逐条对照（分叉不动主线、切线只动活动线、汇流冲突枚举完整且有序、处置闭合、不可复制类别不合并、重放幂等、状态写失败回滚引用）。

### 15.9 内核的决定（已实现）

**整节实现了：§15.1、§15.2、§15.3 三条效果、§15.4 汇流报告与回声、§15.5 跨线记忆与跨圈知晓、§15.6 胶囊/Director/恢复、§15.7 扩展侧。** §15.8 的验收（重建《不息的渴望》、真桌长局）不在本票的代码范围内。

- **一个新模块。** `kernel/coc/worldline.py` 装下整节：注册表、种子、模组声明的读法、锚点快照、`fork`/`switch` 的校验与执行、胶囊节、Director 三信号。`module_graph.py` 一个字没动——`resets-to`、`persists-across-loop`、`remembers_across_loops` 都是从 `graph.raw["relations"]` 与 `record_of(node)` 直接读的，图的接口不为这一节扩张。`history.py` 只加 git 动词（分支、符号引用、检出、脏检查、`show`/`ls-tree`），不含任何世界线判断。
- **分支与 HEAD。** `campaign.create` 在第一次提交之前就把裸仓库的 HEAD 指到 `refs/heads/wl/main`，所以新战役从第一个提交起就在线上；没有 `wl/` 分支的旧战役在 `table.open` 时把当前 HEAD 登记成 `wl/main` 并移动符号引用，不改任何提交。
- **`campaign.json` 是战役全局的，但它在工作树里。** 注册表按 §15.1 住在 `campaign.json`，而工作树属于当前分支，所以检出会把它换成目标线的旧副本。定下的规矩是：**注册表是权威，检出之后立刻用内存里的注册表覆盖写回**（`table.open` 与 `transition` 各写一次）。不把 `campaign.json` 排除出仓库——排除之后检出一个更早的提交仍会把它写回来，问题不减反增。
- **提交形状（契约没写）。** 一次迁移最多留两个提交：离开前在源线上 `worldline <src>: sealed at turn <n>`（回合提交之后总有残渣——回合记录刚学到自己的 sha、注册表刚更新——而检出拒绝脏工作树），落地后在新线上 `worldline <name>: forked from <src> at turn <n>` / `worldline <name>: resumed from <src> at turn <n>` / `loop <n> reset`。工作树干净时不写第二个提交（在本回合提交上开的 `if` 线就是这种）。这些提交的标题**故意不用 `turn <n>:` 开头**：`history.head_turn` 按这个前缀认回合，`continuation.sync_checkpoint` 会把 HEAD 的 sha 补写进回合记录，世界线提交若冒充回合提交就会把记录的 `commit` 指错。
- **执行顺序。** §15.3 写「在提交后链里，检查点之前」，实现照办，但把链拆成两半：`narrate` 提交 → library 回流与 episode（这两样属于刚关闭的那一回合、也属于它所在的那条线，写在源线的工作树里，随 seal 一起提交进去，`if`/`loop` 线因此也带着分叉那一回合的记忆）→ 世界线迁移 → 检查点 → 按新线的回合号重播骰子。检查点放在最后是因为它是**续行**用的：§15.6 要它记 `worldline`，`table.open` 又按它决定从哪儿接着打，所以它必须描述表实际落到的那条线与那个世界（回溯已经把世界换掉了）。带世界线效果的回合因此不按 `record["world"]` 建检查点，而按迁移之后的现场重建快照。不带世界线效果的回合走原来的顺序（检查点、library、episode），一个字节都没动。
- **失败即回滚，回合不回滚。** 迁移是提交后链的一环：任何一步抛异常都强制检出回源线、删掉本次调用刚建的分支、把迁移前的 `campaign.json` 写回去，然后只落一行 `lane: worldline, ok: false` 的遥测。回合已经提交，守秘人不会收到错误；下一回合的胶囊里线名没变，就是它没成的证据。
- **`mode`，不是 `kind`。** §15.3 的 `fix` 文案写成「`mode: if` forks the line as it stands」，但 `kind` 已经是效果种类（`fork`），模式字段是 `mode`。实现按 `mode` 读，文案改成 `mode: if`。
- **收据 id 带回合号。** §15.3 写 `fork:<name>` / `switch:<line>`。收据 id 只要求线内唯一（§15.1），而同一条线可以在不同回合切回同一条线，所以实际铸成 `fork:<name>-t<turn>` 与 `switch:<line>-t<turn>`，与 §2 的语义 id 同形。
- **收据不渲染，投影成一行。** §16 覆盖 §15.3 的【变化】说法：收据 `kind: "worldline"` 投影为 `mechanics` 的 `{"kind": "worldline", "receipt", "operation", "line", "mode", "loop", "from_line", "from_turn", "label"?}`。它不欠数字，所以 `narrate` 的核对（§16.3）对它没有要求。
- **三个新事件类型。** §12.1 的枚举加 `worldline-forked`、`worldline-switched`、`worldline-merged`。事件**落在迁移之后落地的那条线上**，`turn` 取落地线接下来要打的那一回合，`data.from` 指出从哪条线的哪一回合来；离开的那条线把收据与迁移计划留在自己的回合记录里（`turns/NNNN.json` 的 `worldline`）。理由：事件流是分支里的文件，把源线的回合号写进一条不含那个回合的线的日志只会读错。
- **一回合一条，且必须最后。** 校验在 `apply` 的批处理里（不是执行时）：不是本批最后一条 → `invalid_params`；本回合已经有一条 → `invalid_params`；`ask` 关回合时如果 `turn.json` 挂着世界线计划 → `invalid_params`。计划落在 `turn.json.worldline`，所以跨多次 `apply` 调用也只算一条。
- **种子。** `main` 的 `forked_from` 是 null，`sha256("<campaign>:main:")` 取前 16 位（空串占位）。每回合按 `"<seed>:<turn>"` 重播，只在 `table.player_input` 与 `table.open` 重播——回合内不重播，否则同一回合里的两次 `resolve` 会掷出同样的数。给了 `COC_KERNEL_SEED` 就一次都不重播（测试的确定性不变）。
- **锚点快照从 git 读。** 回合记录只存 §12.2 的摘要（场景、时钟、调查员几个数），重建不出 `world.json`，所以锚点快照是 `git show <commit>:world.json` 与 `party/*.json`，存 `save/worldlines/anchor.json`；已存在就不重算。锚点就是开场场景时取根提交（建战役那一刻），否则取「快照场景等于锚点」的第一条有 commit 的回合记录。
- **重置口径（契约只给了原则）。** 新世界 = 锚点世界的深拷贝；`discovered_clues` 并上当前线里句柄在 `persists-across-loop` 源集合中的那些；`flags` 同法按 flag 名匹配句柄；`reset.clock == keep` 时保留当前时钟；`reset.investigators == keep` 时整张表原样留下，否则回锚点的表再把名字落在持久集合里的 `equipment`/`weapons` 行与 `conditions` 带回来。匹配一律走名字归一化，不做语义判断。
- **锚点的选法。** `resets-to` 可以有多条：源节点就是当前场景、或被当前场景以 `contains`/`occurs-at`/`present-in`/`located-in`/`discoverable-at` 任一方向关联的那条优先；都不命中就取按节点 id 排序的第一条，所以在任何场景都能回溯，`loop_available` 只在真的「此处可回溯」时为真。
- **胶囊与 Director。** `worldlines` 节 1.5KB，超出按尾部裁剪并记 `truncated`；`loop_available` 为真时 `obligations` 多一条 `{"kind": "loop", "who": "keeper"}`；`director.because` 末尾追加 `loop_count`、`echoes_here`、`loop_available` 三行，**不进打分**（`time_loop` 的结构权重图里本来就有）。`head` 多一句说明这一节。
- **另外三处出口。** `table.open` 的结果加 `worldline: {name, kind, loop}`；`apply` 的结果在挂上计划时加 `worldline: {operation, line, mode, loop, when}`（说明它在本回合 narrate 提交后才发生）；`recall history {lines: true}` 加 `lines: {active, lines: [...]}`，只读注册表，不开 git 对象。续行检查点与 `resume` 加 `worldline` 字段（记名，不用来选线）。
- **`structure_type` 一直读不到（本票修的旧缺陷）。** §15.2 要模组节点 record 的 `structure_type: time_loop`，但模组节点的 `runtime_projection` 装的是 `documents`（`module-meta.json` 的 root），从来没有 `record`——`director.structure_type_of` 于是永远拿不到声明、永远退回 `branching_investigation`。这与 §21.3 的 `era` 是同一个缺陷同一个位置。修法是 `module_graph.module_declaration(node)`：先读 `module-meta.json` 的 root，`record_of` 垫底，**四个读模组节点自身声明的地方全部改走它**——`director.structure_type_of`、`library.module_era`、`capsule.clock_section` 的 `start_time`、`table` 里两处按时代解析武器/现金的兜底。改完 `kernel/` 里再没有 `record_of(graph.module_node)`。实际影响：the-white-war 声明的是 `linear_acts`，此前一直被当成 `branching_investigation` 打分。

**§15.4 汇流：**

- **算什么与 git 合什么是两件事。** git 只被要求把两条历史都留在可达处：新分支起点取 `lines[0]` 的末提交，其余父线用 `git merge -s ours --no-commit` 记成父，然后提交——**一个字节都不从对方的树里取**。合并后的世界、表、记忆并集与回声全部由内核按报告算好之后写进工作树，随那个合并提交落地。
- **冲突 id 的三段。** `conflict:<class>:<subject>:<field>`：`numeric` 与 `dead_alive` 与 `consumed` 的 subject 是调查员 id（field 分别是 `hp|san|mp|luck`、`alive`、归一化后的物品名），`flag` 的 subject 是 flag 名、field 是 `value`，`npc_presence` 的 subject 是 NPC 句柄、field 是 `scene`，`mod_state` 是 `game-mods`/`snapshot`，`engine_state` 是 `engines`/`snapshot`（**整桌一条**，`values[线]` 里 `save` 给各引擎存档的 sha256 前缀而不是字节——一份理智快照就有 4.7KB，而这一行要进 `needs` 错误、`turn.json` 与回合记录三处；胜出线的字节在落地时从 git 读）。报告按 id 排序，两次算出的字节相同。
- **`sum` 对单值字段的收口（契约只写了「并集」）。** `npc_presence` 是 `npc → 场景` 的单值映射，两条线把同一个人放在两处时并不出「并集」这种值。定下的口径：`sum` 把这个人放在汇流落地的那个场景（`into`，缺省 `lines[0]` 的所在），若那个场景不在候选里就取候选里字典序第一个；报告的 `values` 里两处都在，所以守秘人看得见自己放弃了什么。一条线动过、另一条线没动过（还在书上的位置）也算冲突，`values` 里那一项记作 `*book*`。
- **不能复制的类别没有 `sum`。** 闭表写死在 `confluence.DISPOSITIONS`：`numeric` → from|min|max，`dead_alive` → from，`consumed` → from|drop，`flag` → from，`npc_presence` → from|sum。`clue` 根本不在表里——线索、回声、手卡、走过的场景一律并集，不产生冲突。旧树的 `NON_DUPLICABLE_CONFLICT_CLASSES` 就体现为这张表里没有的那些模式。
- **未处置就整批不写。** `needs` 在 `apply` 的批处理里抛出，`details.conflicts` 是完整的冲突列表（每条带 `values` 与 `modes`）。处置里出现报告没有的 id、类别不允许的 mode、`from` 指向不在本次汇流里的线、`drop` 没有 `note`，都是 `invalid_params`。同一回合可以反复试，`apply` 不关回合。
- **时钟与足迹。** 合并后的时钟取两条线里走得最远的那个（时间不倒流）；`scene_trail` 清空（合并后的队伍站在一处，不拼两段过去）；`scene_labels` 取并集。
- **物品按名字并、不按数量加；`consumed` 看收据不看有无。** 两条线都拿着同一样东西是一样东西。一条线**没有**它有两种可能：从来没捡过（那就是并集，不问守秘人），或者花掉了。区分靠该线回合记录里有没有 `quantity < 0` 的 `item` 收据（§5、#19），只有后者才报 `consumed`。处置里 `drop` 与「`from` 指向那条花掉它的线」都真的删掉那一行，`from` 指向还拿着它的线才保留。武器行与状态取并集。
- **记忆并集按 id。** 候选 id 是按线按回合铸的，所以同一个 id 就是同一条记忆；`memory/candidates.jsonl` 写成所有父线的并集。
- **NPC 账本不合并（与「已掷的骰不合并」同一条）。** `npc-ledger.json` 是收据的折叠（§17.4），而收据是各线自己历史里的东西，不重复计入状态。合并后的线拿的是 `lines[0]` 的账本——工作树里的`turns/` 也只有它那一份，重建也只能重建出这一份。别的父线里谁被谁激怒过，留在那条线自己的历史里（合并提交把它留在可达处），不折进新线的账本。要让它进来，只有让守秘人用 `apply npc stance` 显式写。
- **回声由「没走进去的那些父线」生成。** 新分支起点是 `lines[0]`，所以它的过去就是这条线的过去；其余父线的回合记录投影成回声。

**§15.4 回声：**

- **回声是收据的投影，不是叙述。** `kernel/coc/echoes.py` 只认六种：`move`（`move` 收据）、`clue_taken`（`clue`）、`handout`（`handout`）、`fight`（`family: combat` 的 `session`）、`presence`（`npc` 收据里 `to` 是个场景）、`death`（`resource: hp` 且 `after ≤ 0` 的 `delta`）。掷出的骰、时间、记账、世界线收据本身都不留回声——回声是队伍可能再撞上的东西，不是所有被写下来的东西。
- **摘要是英文（§16 覆盖 §15.4）。** §15.4 写「一句 play_language」，但 §16 定下内核写的一切是英文，而回声摘要进胶囊、由守秘人转述给玩家。所以摘要由收据确定性生成，英文；玩家听到的那句是守秘人按 `play_language` 写的。
- **id 与累积。** `echo:<line>-t<n>-<k>`，`k` 是该回合内的序号，所以同一份回合记录投影两次得到同一批 id。`echoes.json` 只增不减：第二次回溯不抹掉第一圈留下的。
- **揭示走 `apply clue`。** `clue` 效果的句柄以 `echo:` 开头时解析回声而不是图；收据仍是 `kind: "clue"`（`id` 里冒号换成短横：`clue:echo-<line>-t<n>-<k>-t<turn>`），另带一个 `echo: {line, loop, turn, kind}`。写进 `world.discovered_echoes`，之后在胶囊 `known.discovered_echoes` 里；已揭示的不再出现在 `worldlines.echoes` 的待投放列表里。图里没有的回声报 `unknown_entity` 并列出有哪些。

**§15.5 记忆：**

- **候选带 `worldline` 与 `loop`。** `memory.submit` 落行时从 `campaign.json` 读当前线与圈数写进候选。这是内核区分「上一圈」与「这一圈」的唯一依据。
- **`recall memory {line}`。** `current`（缺省，只读本分支的文件）、`any`（每条线的 `memory/candidates.jsonl` 从 git 读出取并集，同 id 以磁盘上这份为准——它可能已经被 supersede 了）、或某条线的名字。结果里回带 `line`，每条命中带 `worldline` 与 `loop`。不认识的线名报 `invalid_params`。
- **`from_other_lines` 落在 NPC 档案上，不是 `known_facts`。** §15.5 写「`present[].known_facts` 里多一组」，但 §17.4 已经把 `known_facts` 换成了那份档案（`wants`/`knows`/`toward_party`/`history`）。这一组因此挂在档案的顶层 `from_other_lines`，`lookup secret scope=scene` 的 `npc_secrets` 同形。**只有 §15.2 声明过的人有这一键**，别人连空数组都没有；候选里写了什么都不改变这一点，测试用「同一局玩两遍、只把声明拿掉」钉住了它。
- **`previous_loop`。** 本分支候选里 `loop == 当前圈 - 1` 且未被 supersede 的前 4 条，按 `recall memory` 的排序去掉 `about` 那一维（种类层 → 回合新 → id）。

**§15.7 扩展侧：**

- `tools.ts` 的 `apply` 加 `ForkEffect`/`SwitchEffect`/`MergeEffect`，`clue` 的描述说明 `echo:` 开头的句柄；工具描述写清三条「回合提交后才发生、一回合一条、必须最后一条、不能配 `ask`」，以及 `merge` 先空跑拿 `needs` 再回填 `dispositions` 的两步。
- 守秘人提示加两段：世界线是什么、`if` 与回溯的分别、三条效果什么时候发生；回声只能揭示不能改、跨圈记得的只有胶囊说记得的那些人。
- `table` 扩展：`/coc` 状态面板多一行 `line`（线名、种类、圈数、锚点、共几条线、此处是否可回溯），机制状态行认 `kind: "worldline"`。

- **旧树行为清单的对照。** 分叉不动主线、切线只动活动线、重放幂等（同 `call_id` 只分叉一次）、状态写失败回滚引用、汇流冲突枚举完整且有序、处置闭合、不可复制类别不合并——都有 `tests/kernel/test_worldline.py` 的用例。

## 16. 系统语言与机制投影（切片 7，票 #26）

用户 2026-09-06 的裁定，替代此前误写的「语言表」方案：**系统语言是英文，玩家语言由 agent 自己出，机制结果是 JSON。** 不做翻译层，不做按语言分键的字符串表。

### 16.1 系统语言

- 代码、契约、提示词（守秘人、建卡、读者）、工具描述、宿主消息、胶囊里内核写的说明（`head`、压力/待办的状态词、Director 的 reason、检查点 one_line）、事实清单、抽取指令、校验车道的输入与发现、读者 brief、启动器帮助——全部英文。代码里不出现中文；守卫测试扫 `kernel/**`、`extensions/**`、`bin/**`、`prompts/**`、`content/setup/*.json`、`content/craft/beat-directives.json`，命中 CJK 即失败（模组内容与规则术语表是数据，不受限）。
- 玩家看到的一切由守秘人按战役 `play_language` 写（提示里的那一句是唯一机制）；记忆候选的 `statement` 也按 `play_language` 写（守秘人之后要读它、玩家可能通过 recall 看到它）；校验发现的 `why` 与遥测用英文。
- 规则术语表（技能、武器的各语言译名）留在规则数据里，不再被渲染路径消费；守秘人自己把 `Spot Hidden` 说成玩家语言里的词。

### 16.2 机制投影（`mechanics`）

内核不再把收据拼成句子。`narrate`/`ask` 的结果与 `table.status` 带 `mechanics: [...]`，每条一个语言中立的对象，直接对应收据，按收据顺序。每条都带公共字段 `kind` 与 `receipt`（收据 id）；收据上已有的名字作为数据顺带过去（`actor_label`、`subject_label`、`from_label`/`to_label`、`label`、`currency`、`rounds`、`available`、`path`）；`clue` 行的 `summary` 同理：收据铸成时就带着模组写的这条线索说了什么（`apply clue` 的收据，`table.py` `_stage_clue`），与 `label` 不同时投影，让前端能把这一行展开成线索的具体内容，而不必另查模组图。

| kind | 字段 |
| --- | --- |
| `roll` | `actor`, `skill`, `roll`, `target`, `threshold`, `difficulty`, `level`, `passed`, `pushed`, `visibility` |
| `dice` | `actor`, `label`, `expression`, `faces`, `total` |
| `change` | `resource`, `subject`, `before`, `after` |
| `scene` | `from`, `to`, `minutes`, `via`? |
| `clue` | `clue`, `label`?, `summary`? |
| `time` | `minutes` |
| `item` | `name`, `quantity`, `to`, `weapon`? |
| `cash` | `subject`, `before`, `after` |
| `session` | `family`, `transition`, `round`?, `outcome`? |
| `choice` | `option` |
| `handout` | `name`, `available`, `label`?, `path`?, `media_type`?, `text`? |
| `worldline` | `operation`, `line`, `loop`, `from`?（§15.3；切片 8 加的，此前只在实现里，照契约读的前端不知道有这一类） |

每条还可能带两个分组字段：`call` 是铸出该收据的 `call_id`，同一次 resolve/apply 铸出的收据同属一次结算；`family` 是 resolve 结算它的规则族（这次结算里的 `delta` 也带上），`apply` 的簿记行没有 `family`。前端按 `call` 把一次结算的行收进一组，按 `family` 决定这一组的气质；缺了任一个字段就退成单列的行，不许猜。

扩展把它作为会话条目 `coc-mechanics`（`{turn, mechanics}`）追加到 Pi 会话并发到总线 `coc:mechanics`；Pi RPC 事件流因此带着它（`entry_appended`），驾驭器落进 `events.jsonl`；未来的 Electron/web 前端按它渲染骰子卡与变化条。投影为空时不发条目。TUI 只显示守秘人的正文。

**手卡**：Pi 没有出站附件通道（`docs/pi-host-contract.md` §3.3），所以路径不进正文。内核给 `name`/`available`，扩展把 `apply` 结果里的 `attachment` 合进这一行（`path`、`media_type`），前端按它取图；坐在终端前的人由 table 扩展通知一次（`handout <名>: <路径>`，每张卡一次，不进正文）。文本手卡（§14.8 物化的 markdown）额外带 `text`：正文原样（不含物化时加的那行 H1，上限 8000 字符，超出以 … 截断），让前端能把这一行展开成可读的卡片而不需要文件通道；图片手卡没有 `text`。契约里任何「渲染【明骰】【变化】【第 n 轮】【手卡】行」的旧说法一律以本节为准，包括 §5、§11.6、§11.9、§12.5，以及 §11 的会话渲染、§14.8 的手卡、§14 的实现小节、§15 的世界线收据——那些段落描述的行不再存在，对应的信息以 `mechanics` 的一行投影出去。

### 16.3 Story text and system JSON (2026-09-07 user correction)

Narration contains fiction and observable consequences only. Roll/target values,
success grades, resource bookkeeping and mechanical option lists belong exclusively
to structured projections and frontend controls. The old public-number presence
check is retired. The play-language check remains. No regex removes semantic
sentences from text: the Keeper is instructed to keep these fields separate.

A failed check does not automatically require an ask about push/Luck/accept.
The Keeper narrates its fictional consequence and leaves the player's agency open.
When a system decision is actually required, ask uses kind=mechanics with closed
option identifiers and no prompt. Story decisions use kind=story. Both return an
interaction JSON object; neither appends a question or numbered list to rendered_text.
Existing recorded prose is historical evidence and is not rewritten.

**2026-09-09 user decision, final.** The number check stays retired. It had been restored
on 09-08 (#84) on the strength of defect #64, which predates the check: #64 came out of the
first v2 attempt's playtest, archived on 09-05, before any check existed. At a real table
the restored check produced every dice card doubled by a "rolled 25 against 53 ... 15
minutes" sentence under it, because the extension's steer told the Keeper to write exactly
that after four refusals. Elapsed time as a figure (a `time` receipt's minutes) is in the
ban too: the clock is the panel's, and the delivery card deliberately draws no time row.
No `code_detail` may ask for a figure in the prose; a delivery that states none of its
receipts' numbers is a correct delivery. `tests/kernel/test_narrate_numbers.py` guards this,
calling `table.narrate` directly.

### 16.4 验收

- 守卫测试绿；两场真桌各三回合：`toomany-s4`（zh-Hans）正文中文、机制数字齐全、`coc-mechanics` 条目随每回合落到证据；一局新建的 the-haunting（`play_language: en`）正文英文、没有一个中文字。

### 16.5 The kernel's decisions (implemented, ticket #26)

- **Public mechanics names.** Roll/dice receipts carry `actor_is_investigator`; resource deltas carry `subject_is_investigator`. Public mechanics names are included and rendered only when the corresponding flag is exactly `true`. NPC and unknown identities, including legacy untagged cards, render anonymously while retaining their numeric mechanics. Canonical names and ids remain in Keeper-side receipts; familiar names belong in Keeper-authored prose. This is a visible mechanics projection boundary, not a redesign of JSON access control.

- **Projection.** `kernel/coc/render.py` is now the receipts' projection and the number check; the mechanics-line templates, `place` and the marker check are gone. `mechanics(receipts)` yields one object per receipt in receipt order. Beyond the §16.2 columns every object carries `kind` and `receipt` (the receipt id), and the names the receipt already holds ride as data when present: `actor_label` (roll, dice), `subject_label` (change, cash), `from_label`/`to_label` (scene), `label` (clue, item, handout), `to_label`/`from`/`weapon` (item), `currency` (cash), `rounds` (a bout's session start), `available`/`path` (handout). A `delta` receipt projects as `change`, a `move` as `scene`, a dice-form roll as `dice` (`label` = the engine's die name, `expression`, `faces`, `total`). Keeper-visibility rolls are projected too, with `visibility: "keeper"`: a consumer that renders for the player must hide them. Every row also carries `call` (the `call_id` that minted its receipt) and, for resolve-minted receipts, `family`: at commit time resolve stamps the settled family onto every receipt of that call with `setdefault`, so a session receipt's own family word survives and `apply`'s bookkeeping rows carry none. One settlement is one group; a row without `family` settles nothing and stays loose.
- **Results and records.** `table.narrate` returns `rendered_text` equal to `text` verbatim plus `mechanics`; `table.ask` returns `text.strip()` + blank line + prompt + `1.`/`2.` options (or the question alone) plus `mechanics`; `table.status` carries `mechanics` for the open turn. The turn record stores `mechanics` beside `rendered_text`; `placement` is accepted, ignored, and no longer recorded; the `turn-finalized` event data is `{receipts}` only.
- **Number check — retired (§16.3, 2026-09-09).** The kernel reads no figure out of `text`; `expected_numbers` / `check_numbers` and `code_detail: "mechanics_missing"` are gone from both kernels and from the fake kernel. The error envelope (§1) keeps the optional `code_detail`, a closed refinement of `code`; its only value today is `play_language_mismatch`.
- **Play-language script check (§5 step 2, §16.3).** Closed tags only: `zh-Hans` obliges a CJK character (the same ranges as the system-language guard) in every player-facing field of the delivery — `narrate.text`, `ask.prompt`, each `ask.options[i]`, and `ask.text` when given. Failure is `invalid_params` with `code_detail: "play_language_mismatch"`, `details.fields` in field order, `details.play_language` the campaign tag, and a `fix` naming the fields. `en` is unchecked: it is the system language. Mixed CJK-plus-English is not this check's job. It is the only floor under a delivery. `language_of(meta)` is now consumed here, not only by craft and the extractor.
- **Receipts.** `delta` and `cash` receipts no longer carry `label` (the `resource` key is the language-neutral name); roll receipts keep `skill_label` equal to the canonical skill, dice receipts equal to the engine's die name (kept for the record, rendered by nothing). Session receipts carry the engine's closed `outcome` word and an English `summary` or `null`; a `sanity_bout` start carries `outcome` (the bout result) and `rounds`. Item receipt ids are `item:<ascii-slug>-t<turn>-c<n>` when the name has a Latin slug and `item:t<turn>-c<n>` otherwise (`-2`, `-3` on repeats in a batch), superseding the `item:<slugify(name)>` wording above; the name rides in `name`/`label`.
- **Language threading.** `facts.py`, `capsule.py`, `pressures.py`, `director.py` and `continuation.py` write English and take no language argument; `language_of(meta)` returns the campaign's `play_language` tag unchanged, as data. `craft.style_section` (the `language_applicability` filter and `style.language`), the extractor `instruction`, and the delivery script check consume it; the instruction tells the model to write every `statement` in that language. `campaign.create` still accepts only `zh-Hans` and `en` because §14.4 says so; a new play language is a contract decision plus a script-obligation row, not a detector.
- **Glossary in data.** Localized names live in the rules tables and nowhere in code: `skills.json` (unchanged), `characteristic-dice.json` `characteristics.<ABBR>.localized_labels` (new; the resolver reads it so `力量` still resolves to `STR`), `derived-attributes.json` `sanity.localized_labels` (new; `stakes` naming SAN in any listed language still offers `sanity:check`, §11.5).
- **System content.** `content/setup/steps.json`: `templates` and each step's `lines` are one English form; `content/setup/reader.md` is English; `content/craft/beat-directives.json`: one English line per axis and directive, written as one-liners like the zh originals, so the full first-turn set fits the §13.6 2KB budget in every play language (2021 bytes) and the remark that `en` overflows and truncates no longer applies. Kernel-minted §11.9 pending-choice prompts (a defense, a bout decision) are English; when the host closes a turn for the keeper by `ask` from a `for: player` pending, that English prompt is what the player sees, so the keeper should put the question in its own words.
- **Guard.** `tests/kernel/test_system_language.py` fails on any CJK character in `kernel/**`, `bin/coc-*`, `content/setup/**`, `content/craft/beat-directives.json` (comments included), and pins the zh-Hans turn: `rendered_text == text` with no figure in it, one projection per receipt, and `play_language_mismatch` naming the player-facing field that carried no CJK.
- **Left to the extension (not in this slice).** `verifier.ts` still strips marker lines; `tools.ts` descriptions still mention the marker lines; `onboarding/steps.ts` reads `lines[language]`; nothing in `extensions/` emits `coc-mechanics` yet.

### 16.6 Mechanics markers: where a receipt happened (2026-09-07 user decision)

§16.3 took the numbers out of the narration and left the mechanic with nowhere to
be. A five-turn live table showed the shape: the prose carries the consequence of
a check and nothing marks the moment, so a frontend can only append the whole
receipt block after the whole delivery, and the player cannot tell which sentence
a roll produced. §16.3 says what must not be in the text; this says what may.

This is not the `place` marker §16.5 removed. That one had the kernel render
mechanics *lines* into player-facing prose. This one carries position and nothing
else: the kernel still writes no player-facing word, and a consumer that ignores
markers reads exactly what it reads today.

**The kernel mints the marker; the Keeper places it and never invents one.**
Every receipt that projects (§16.2) has a marker: semantic and readable —
`check:spot-hidden`, `clue:knott-keys`, `scene:newspaper-morgue`, `cash` — built
from the receipt's kind and the name the Keeper already uses for that thing, and
unique within the turn (a second roll of the same skill is `check:spot-hidden-2`).
It is derived from the turn's receipt list in order, so a marker handed out after
one call still names the same receipt after the next. It is not a receipt id:
those are minted with turn and ordinal, and a model copying one drifts, which the
product invariant already forbids — hashes, receipt ids and call ids are minted by
the host and the kernel and are not for the model to copy. A marker is a name,
which is what the model is allowed to hold. `resolve` and `apply` return `markers`
in receipt order beside `receipts`, so the Keeper is handed the tokens it may place.

**Syntax.** `{{<marker>}}` in `narrate.text` and `ask.text`. A Keeper writing
Chinese or English prose does not produce that by accident and a Markdown renderer
passes it through. The scan is literal; no regex reads the prose for meaning.

**What the kernel does with them.**

- A marker naming a receipt of this turn binds to it.
- A marker naming nothing is `invalid_params` with `code_detail: "unknown_marker"`,
  `details.unknown` listing them and `details.markers` the turn's available ones.
  Prose asserting a mechanic that has no receipt is the §16.3 family of error.
- The same marker twice is `invalid_params` with `code_detail: "duplicate_marker"`.
  A receipt happened once and has one place.
- A receipt no marker placed is **not** an error. It projects exactly as today and
  the frontend groups it after the delivery. Requiring a marker per receipt would
  make every turn brittle for a cosmetic gain, and a receipt must never be lost
  because its position was.

**What the delivery carries.**

- `rendered_text` keeps its meaning — the delivery as a text consumer reads it —
  with every marker removed. The kernel substitutes nothing for a marker: a
  substitution would be player-facing words written in code, which §16.1 forbids.
  A terminal reader therefore sees the prose it sees today.
- `marked_text` is the same delivery with the markers still in it, for a frontend
  that can mount a component at the position. It is omitted when no marker was
  placed, so its presence is the signal that there is anything to mount.
- Each `mechanics` row of a placed receipt carries its `marker`; unplaced rows
  carry none, which is how a consumer tells the two groups apart.
- The turn record stores `marked_text` beside `rendered_text` so a consumer can
  re-render a turn it did not watch. The play-language and number checks run on
  `rendered_text`: a marker is not player-facing text.

**Open for the frontend slice, recommended not settled.** The delivery reaches the
UI as the assistant message the extension replaces at `message_end` (§23), and
that same message is what a terminal reader sees, so only one of them can hold the
markers. The recommendation is to leave the assistant message as `rendered_text`
and carry `marked_text` on the `coc-mechanics` entry, letting the frontend render
the delivery from that entry when it has one; putting `marked_text` in the message
instead would show raw `{{…}}` in the TUI. Two obligations this project has already
paid for once each: the `marker` and `marked_text` fields must be registered
wherever `coc-mechanics` is projected to the host, or they are dropped silently
between the kernel and the panel; and a delivery streams, so a marker can arrive
split across deltas — the renderer buffers an unterminated `{{` rather than
painting half a token. How a placed row is drawn is a frontend decision, not a
contract one.

## 17. NPC 层：作者档案、玩出来的账本、带因果的在场者（切片 9，票 #29）

用户 2026-09-06 拍板。目标是 NPC 在桌上有逻辑因果地扮演与互动，而不是模组里的背景板。证据（#29）：PDF 构建出的书里 NPC 只有属性块，`present` 节四个 null；图上已抽出的 NPC 关系没人投影；claim 的 `known_by_ids`/`asserted_by_ids` 零填充；NPC 与调查员之间没有任何运行时状态（`npc_attitude` 无写入者、`min_trust` 无消费者、social 结算不落到 NPC）。

三条边界：**不另起 NPC 图谱**——作者事实只有模组图这一根脊柱（§14），再开一张图就是两套 id 对不上的老病；**玩出来的状态不是图**——它是战役目录里的账本，只由收据与显式 `apply` 写，不解析散文；**守秘人仍是决策者**——档案与账本是他扮演的依据，不是台词，他可以显式改账（`apply npc`），但改了要留收据。

### 17.1 三个平面

| 平面 | 住在哪 | 谁写 | 回答什么 |
| --- | --- | --- | --- |
| 作者档案 | 模组图 `npc` 节点的 `properties`、以该 NPC 为主语的 claim、NPC↔NPC/派系/地点的关系 | 构建（读者）、starter 投影器 | 他是谁、要什么、怕什么、瞒什么、知道什么、信错了什么、会对谁撒什么谎、跟谁一伙跟谁作对 |
| 运行时账本 | `<campaign>/npc-ledger.json` | 内核，只从收据与 `apply` | 他对这队人什么态度、为什么、说过什么、给过什么、许过什么、见过几次 |
| 投影 | 胶囊 `present`、`look focus <npc>` | 内核 | 守秘人这一回合扮演他需要的一段，带因果 |

### 17.2 作者档案：图上 NPC 要有什么

- **一等属性。** `npc` 节点 `properties` 里：`agenda`（他要什么）、`fear`、`secret`、`voice`、`relationship_to_investigators`（对调查员的角色，书上的短语，如 gatekeeper / informant / patron / adversary；不是闭合枚举）。全部 keeper-only，书上有才写，没有就没有（读者法则「不要加书上没说的」不变）。
- **知与信走 claim**，用契约 v3 既有谓词，主语是该 NPC：`knows`（对象是 `clue`/`secret`/`npc`/`location`，`authored-fact`）、`believes`（他信的、可能是错的，`authored-belief`）、`asserts`（他会说的话，`authored-lie` 或 `authored-rumor`，`asserted_by_ids` 含他）、`hides`（对象是 `secret` 节点）。机器由此填 `known_by_ids`：每条 `knows` claim 把主语加进对象节点相关 claim 的 `known_by_ids`（§14 契约 `machine_filled_keys` 已把它归给机器，这里给出算法）。
- **关系走既有词汇**：`allied-with`、`opposes`、`member-of`、`controls`、`owns`、`possesses`、`worships`、`threatens`、`impersonates`、`located-in`。不新增关系种类。
- **一条读法。** 内核新增 `module_graph.npc_profile(node)`：先读一等属性，没有再回退到 `properties.runtime_projection.record`（starter 的旧投影；已建战役是编译快照，不能靠重建 starter 修）。`scripts/starter_graph.py` 同步把 npc-agendas 的这些键投成一等属性，`facts[]` 投成 `knows` claim（`min_trust` 丢弃，见 17.3）。`record_of` 只留给场景与其他节点。
- **构建端。** `content/setup/reader.md` 的 Actors 段与 `content/modules/module-graph-template-v1.json` 加：每个 NPC 的 wants/fears/hides/voice、他知道的线索与会说的谎、与其他 actor 的关系，都是「书上有就必须抽」的 asks。可玩性简报（§14.3 `brief`）加度量 `npc_without_material`：没有 agenda/secret/fear 也没有任何 `knows`/`believes`/`asserts` claim 的 NPC 名单，只报不卡（模板法则：结构性才是不变量，数量只度量）。按需深读（§14.6）接受 `focus: {npc: <名>}`，深读任务包带该 NPC 出场的全部 section。

### 17.3 运行时账本 `npc-ledger.json`

战役目录根下一份，随回合提交；键是 NPC 节点 id（`npc-…`，不用会撞名的句柄）。在场位置**不**进账本——`world.npc_presence` 是唯一的位置真相（#25 写它），账本只引用。

```
{"<npc node id>": {
   "stance": {"value": "hostile"|"wary"|"neutral"|"warm", "score": <-5..5>, "since_turn", "because": [收据 id]},
   "disclosed": [{"clue": "<句柄>", "turn", "receipt"}],
   "interactions": [{"turn", "kind": "social"|"combat"|"chase"|"psychology", "receipt", "level"?: "<成功等级>", "approach"?}],
   "promises": [{"memory_id", "turn"}],           引用记忆候选，不复制正文
   "said": [{"memory_id", "turn"}],               knowers 含他的 knowledge/belief 候选：他在桌上得知或表态的
   "turns_present": {"first", "last", "count"},
   "dead"?: {"turn", "receipt"}}}
```

写入者闭合，全部确定性：

| 字段 | 来源 |
| --- | --- |
| `stance.score` | social 族每次结算按闭合表 `content/rulesets/coc7/rules-json/npc-stance.json` 加减：`{approach × level → delta}`（如 Persuade/Charm 成功 +1、极难/大成功 +2、失败 0、大失败 −1、Intimidate 成功 0 且失败 −1、推骰失败再 −1），初值 0，钳在 −5..5，`value` 由表上阈值推（如 ≤ −3 hostile、−2..−1 wary、0..1 neutral、≥ 2 warm）。任何以他为 `target` 的 combat 结算直接 −5 hostile。数字与阈值全在表里，代码不写字面量 |
| `stance` 显式改写 | `apply {kind: "npc", name, stance: "<四值之一>", why}`：守秘人的裁量，收据 `npc:<id>-t<turn>-c<n>`，`because` 记这条收据；`score` 置为该档的下界。与 #25 的 `to` 可同批 |
| `exchanged` | `apply item` 的 `from`（东西从谁手里来的）与 `apply cash` 的 `with`（钱付给谁、从谁那儿来）。两者都由守秘人说，内核不从「当时谁在场」推断。现金那一条记 `{cash, direction, currency}` |
| `disclosed` | `apply clue` 新增可选 `from: "<NPC 名>"`（他给的）；省略时若该线索有 `held-by`/`delivered-by` 关系指向一个在场 NPC，机器补上；都没有就不记 |
| `interactions` | 本回合以他为 `target`/`actor` 的 `resolve` 收据 |
| `promises` / `said` | `memory.submit` 落盘时，`kind: promise` 且 `subject` 是他 → `promises`；`kind: knowledge|belief` 且 `knowers` 含他 → `said`。只挂 id，接续与关闭仍由记忆层（§13.5）管 |
| `turns_present` | 回合关闭时 `world` 快照的 `present` |
| `dead` | 会话结算里他 HP ≤ 0 的 `delta` 收据，或 `apply {kind: "npc", name, dead: true, why}`——人死的方式远不止掉血掉到零（当场处决、裁定摧毁、故事杀死），只认前者会让叙述里死掉的人在桌上永远还活着 |

崩溃恢复与世界线（§12.6、§15）：账本与 `world.json` 同一条提交，回滚与切线自然跟着；重建按收据重放，与 `scene_trail` 的补法同一模式。旧战役没有账本时第一次 `table.open` 从 `turns/NNNN.json` 的收据与 `memory/candidates.jsonl` 一次性重放生成。

### 17.4 投影：`present` 与 `look focus`

`present` 每项改为（预算仍 3KB，`known_facts`、`relationship`、`attitude` 旧字段删除；`npc_attitude` 死字段删除）：

```
{"name", "role": "<relationship_to_investigators>", "wants": "<agenda>", "fears"?, "hides"?, "voice"?,
 "knows": [{"clue": "<句柄>", "discovered": bool}]（≤ 6，未发现的在前）,
 "believes": ["<claim 摘要>"]（≤ 3）, "would_lie_about": ["<asserts 摘要>"]（≤ 3）,
 "ties": [{"kind": "<关系种类>", "to": "<display_name>"}]（≤ 6，在场者与派系优先）,
 "toward_party": {"stance", "because": ["turn <n>: <approach> <level>", "turn <n>: keeper set <stance>: <why>"]}（≤ 3 条，最近的）,
 "history": {"met_turns": n, "last_turn", "disclosed": ["<线索句柄>"], "exchanged": ["turn <n>: <label 或名>" 或 "turn <n>: paid <数额> <币种>"]（≤ 3）, "dead_since_turn"?,
             "promises": [{"statement", "turn"}]（≤ 3）,
             "tried": ["turn <n>: <路数或族> <成功等级>"]（≤ 3，最近的；账本 `interactions` 的投影）}}
```

- 多人在场时按「有未关承诺 > 有过互动 > 有 wants > 其余」排序再裁尾，裁了记 `truncated`。
- `head` 加一句：在场者带档案与账，胶囊里有的不必 `look focus`。
- `look focus <npc>` 返回全量：档案全部键、全部 claim 摘要、全部关系、账本原样。
- Director（§13.3）：`agenda_npc_present` 改读 `npc_profile`（starter 与构建的书同一读法）；不新增信号。`obligations.promise` 不变，账本的 `promises` 是同一批候选的另一视图。
- 记忆抽取指令（§12.3）加一句：NPC 在这一回合得知、表态或许诺的，写成 `knowers` 含他的 `knowledge`/`belief` 或 `subject` 是他的 `promise`。

### 17.5 扩展侧

- `apply` 的工具描述加 `npc` 种类（`to`、`stance`、`why`）与 `clue.from`。
- 守秘人提示加一段：`present` 里每个人是一份档案与一本账——他要什么就朝什么使劲，他知道什么就只能说什么，`ties` 决定他对在场其他人的反应，`toward_party` 是他对这队人的账与原因；这些是扮演的依据，不是台词；守秘人改了他的态度就用 `apply npc` 记一笔。
- `table` 扩展状态行不变。

### 17.6 验收（只认真桌，§10 与 Agents.md 的禁令照旧）

- toomany 重建（或对 NPC 深读）后新开一局：第一个有 NPC 在场的回合，`present` 不再是四个 null；书上给了材料的 NPC 都有 `wants` 或非空 `knows`；没有的在简报 `npc_without_material` 里点名。
- 一次 social 判定之后，下一回合胶囊里该 NPC 的 `toward_party.because` 引用那条收据，`stance` 与表一致。
- 守秘人叙述里 NPC 许下的承诺，经记忆车道抽出后出现在该 NPC 的 `history.promises`；`recall memory about=<他>` 能查到。
- `apply npc to: here` 之后 `resolve` 能以他为 target；`away` 之后 `present` 不列他。
- `tests/play/kpi.py` 加指标：有 NPC 在场的回合，对已在胶囊里的 NPC 的 `lookup`/`look focus` 次数中位数为 0。
- 旧战役（`haunting-s0`）打开不报错，账本由收据重放生成，`present` 的 `wants` 与此前的 `agenda` 一致。

### 17.7 顺序与前提

1. #25（`apply npc` 的 `to`）并入本切片第一步，人挪不进来后面全空转。
2. 先在 toomany 上重跑构建看读者能抽出多少作者材料，再定 17.2 的 asks 措辞；不按 starter 的厚度想当然。
3. 账本与投影（17.3、17.4）在作者层之后；投影必须走真产品路径验（胶囊落到 `turns/NNNN.json` 的 `capsule`），不认 CLI 打印。
4. 排在 #26（切片 7）落定之后开工；实现决定记在 17.8「内核的决定」。

### 17.8 内核的决定（已实现）

- **档案的读法只有一处。** `ModuleGraph.npc_profile(node)` 先读一等 `properties`，再退到 `properties.runtime_projection.record`（starter 在 #29 之前的投影）。已建战役是编译快照（改 starter 不回溯），所以退路必须留着；the-haunting 的 11 个 NPC 在两条路上读出同一份档案。`sessions.npc_profile` 是同名的另一件事——战斗属性块，不要混用。
- **`knows` 有两个来源，同一个出口。** `npc_knows` 合并以该 NPC 为主语的 `knows` claim 与 starter 记录里的 `facts[].clue_id`，按图上顺序去重。`npc_claim_lines` 取对象节点的 summary/name，再退到 claim 的 `statement`，只复制不改写。`npcs_knowing` 按 `knows` claim 反算 `known_by_ids`，不改图上已授权的那份。
- **`min_trust` 丢弃。** starter 的 `facts[].min_trust` 没有任何消费者，投影时不带；没有规则读的数字不是事实。
- **关系不新增。** `npc_ties` 只读 §17.2 列的十种关系，两个方向都读，按 `(种类, 对端)` 去重；`present` 里按「在场者 → 派系/组织 → 其余」排序后裁到 6 条。
- **`apply npc` 的形状。** `{kind: "npc", name, to?, stance?, why?}`，`to` 取场景名、`here`（当前场景）或 `away`（下场），`stance` 取账本四词；两者全缺报 `invalid_params`。收据 `npc:<slug>-t<n>-c<k>`（句柄无拉丁 slug 时退到 `npc:t<n>-c<k>`，与 `item`/`cash` 同一条），事件 **`npc-changed`**（事件枚举因此从十八类变十九类）。`to` 写 `world.npc_presence`——位置的唯一真相仍在世界里，账本只引用。
- **账本是收据的折叠，别的什么都不是。** `npc.apply_receipts` 只认四种收据：`roll`（互动与 stance）、`clue`（`from` → `disclosed`）、`npc`（守秘人显式改写）、`delta`（NPC 的 HP ≤ 0 → `dead`）。因此 `_rebuild_ledger` 重放 `turns/*.json` 与 `memory/candidates.jsonl` 就能重建整份账本——崩溃恢复、世界线切换、以及本切片之前的老战役第一次 `table.open`，走的是同一条路。只在文件不存在时重建：磁盘上的账本就是状态。
- **收据自己说清是谁。** `resolve` 结算后给本次调用的 roll 收据补 `family`、`npc`（本次判定针对的在场 NPC，NPC 自己掷的那条不补）与 `approach`。这是让账本能只读收据的前提；守秘人从不被问这件事。
- **stance 的数全在表里。** `content/rulesets/coc7/rules-json/npc-stance.json`：初值 0、区间 −5..5、四档阈值（≤ −3 hostile、≤ −1 wary、≤ 1 neutral、其余 warm）、`social[approach][level]` 的增减、`pushed_failure_delta`、`combat_target_score`。代码里没有一个字面量；表里没写的 approach 或 level 一律动 0——沉默是零，不是猜。显式 `apply npc stance` 把分数置为该档下界。
- **`present` 的旧字段删干净。** `relationship`/`agenda`/`known_facts`/`attitude` 与死字段 `npc_attitude` 全部消失，换成 §17.4 的形状；`look focus=<npc>` 给全量并原样附账本行（没有账本行时为 `null`）。`history.dead_since_turn` 是实现补的一项：账本记了 `dead` 就在投影里说一句。
- **Director 跟着改读法。** `agenda_npc_present` 从 `record_of(n).get("agenda")` 改成 `graph.npc_profile(n).get("agenda")`，构建出来的书的 NPC 因此也数得进去；信号不新增。
- **`clue.from` 的机器补全只在唯一时发生。** 守秘人给了 `from` 就用它；没给时，只有当该线索的 `held-by`/`delivered-by` 指向**恰好一个在场 NPC** 才补，两个及以上不选——机器不做归属判断。
- **简报只报不卡。** `npcs_without_material` 数「没有任何档案键、没有任何 `knows`/`believes`/`asserts`/`hides` claim、也没有 starter `facts`」的 NPC。the-haunting 报 1 个，they-did-not-think-it-too-many 报 10 个（11 个里）——#29 的证据本身。模板法则不变：结构性才是不变量，数量只度量。
- **档案词汇表只有一处。** `content/modules/module-graph-contract-v3.json` 加一块 `actor_dossier`：`profile_keys`（五个档案键）、`prose_keys`（`deflect_lines`——散文留 `properties`，claim 的对象只能是节点）、`claim_predicates`（`knows`/`believes`/`asserts`/`hides`）、`tie_relation_kinds`（十种）。它只**分组**不新增：每个谓词与关系都已在 `relation_kinds` 里。读者提示、starter 投影器、可玩性简报与桌面全部读这一份，`module_graph.PROFILE_KEYS` 等只是它的别名；`test_the_dossier_vocabulary_has_one_home` 钉住这件事，包括「读者提示里逐个点名了这些词」。
- **`lie_options`/`deflect_options` 的落法。** 谎言是关于一条事实的，所以 `lie_options[].fact_id` 投成对该线索的 `asserts` claim（`authored-lie`）；搪塞是一句台词，契约规定散文留 `properties`，所以 `deflect_options[].player_safe_line` 投成 `properties.deflect_lines`，带上它挡的那条线索。`npc_would_say` 把两者合起来，这就是 `present[].would_lie_about`。
- **按需深读认 `focus: {npc}`。** 该 NPC `present-in` 的场景所在 section，加上图上 `node_refs_by_section` 里定义它的 section，去重后入队。
- **信念与谎言按 `truth_status` 分开。** `asserts` 涵盖「他会说的一切」，是哪一种由 `truth_status` 说了算：`authored-lie`/`authored-rumor` 进 `would_lie_about`，`authored-belief` 读作他的 `believes`。从规则书构建 the-haunting 时两种都出现了——Dooley 的说法书上明写「他是推销员，可能会夸大」（rumor），Gabriela 说的「屋里有恶灵」她真信、书上也说是真的（belief）。把后者投成「他会拿这事撒谎」比不给还糟：守秘人会照着演一个撒谎的证人。starter 投影器此前把所有 claim 一律盖 `authored-fact`，同一个错的反面，现在 `lie_options` 投成 `authored-lie`。读者的 ask 说明每个状态的含义，因为状态就是全部差别。
- **从规则书构建的 the-haunting。** 资料包取原书 pdf 第 446–462 页（17 页，全部原生抽取、无需 OCR），`bin/coc-bundle` 签清单，`module.bind` 逐字节复核，模组 id `the-haunting-rulebook`，与策划版 starter `the-haunting` **并存**：后者是 48 个测试文件的夹具，换掉等于重写回归基线。构建一轮通过（`grok-relay/grok-4.5`，无 findings）：13 场景全连通、13 线索、5 结论、3 结局、7 条 rule，可玩性零 findings；8 个 NPC 里 6 个有档案，`npcs_without_material` 报 2 个（书上只提了一句的那两位）。`hides`/`believes`/`asserts`/`ties` 每条都有 span 溯源。

### 17.9 帮忙的 NPC 用自己的本事（真桌 2026-09-07）

设计稿见 `docs/specs/npc-acts-for-the-party.md`。桌上的症状：急诊医生给调查员缝手，收据是 `{actor: "inv-1", skill: "Medicine", target: 4}`——掷的是**伤员自己**的医药基础值，于是「去找医生」不但没用而且必然失败。三层，每层单独修都不够：

- **读得出书写的数（L1）。** `ModuleGraph.actor_profile` 把两种作者形状归一成 `{characteristics, skills, derived}`：一等 `properties` 优先（构建写的扁平特征值、顶层技能键、`skills` 字典），读不到再退到 `runtime_projection.record.mechanics.profile`（starter 的嵌套形状）。此前只读嵌套的，于是**每一本 PDF 构建的书、每一个 actor 都返回 None**——连带 `npc_social_defense` 对谁都取不到技能、战斗与追逐给作者 NPC 套默认 DEX/HP。`CHARACTERISTIC_KEYS` 与 `DERIVED_KEYS` 是闭合表：HP 与 Move 不是技能。**印成散文的技能（`"50% (Hard 25%)"`）不带数**——内核不解析印刷体，那是抽取层该写成数字的事。
- **NPC 可以行动，掷的是他的技能（L2）。** `actor` 写 NPC 名不再要求当场有战斗；`npc_in_session` 与 `npc_actor` 分开，只有前者才把路由与 effective intent 推向 combat。治疗族的 `rescuer_ref` 改用 `acting_id`。取值顺序是**最近一次明确的说法优先**：本回合在飞的 `apply npc` 钉值 → 账本里已钉的 → 书上写的。
- **书没写就问一次，不自己编（L3）。** 取不到值时报 `needs`（`details.needs.field = "npc.skill"`），`fix` 直接给出 `apply npc {name, skill: {name, value}, why}` 的写法。内核不替谁编数字，不是因为编造有罪——桌上的编造就是玩法——而是**内核编的数它下次会编成别的**，同一个医生两次不一样，逻辑就不圆了。守秘人钉一次，收据落进账本 `skills`，此后永远是那个数。

不在图上的人（临时的车夫、旅馆老板）仍不建节点：属性无关紧要的 NPC 由守秘人直接裁定结果，这是规则书自己的答案。

Ordinary helper checks bind the executor once. The resolver passes its resolved acting identity to the adapter; the adapter supplies both the numeric skill/characteristic target and the actor identity through host-owned bindings. Numeric targets never enter semantic inputs. The ordinary executor uses that identity for its receipt and check record, while the helped investigator remains the settlement subject. First Aid and Medicine keep their separate rescuer/patient binding. A missing NPC value returns the existing `npc.skill` needs response and never falls back to the beneficiary's skill or an investigator base chance. The Keeper must name the NPC in `action.actor` when that NPC performs the uncertain action, even outside combat; `target` identifies the helped investigator or patient where applicable. A different executor or method is not an implicit choice to push. Push requires the player's explicit choice of the failed check and announced risk.

An `apply npc` skill pin fills missing source material; it cannot contradict an existing authored numeric skill or characteristic. A conflicting pin is rejected before any receipt, ledger or other effect is written, with the authored value and a source explanation. An identical-value pin remains accepted, as does a genuinely absent skill. Existing campaign history and prior pins are not rewritten by this guard. Compact capsule omission does not prove source absence: the Keeper should try `resolve` first, or inspect the NPC's full view, and pin missing material only after the existing `npc.skill` refusal identifies it.

## 18. `apply` 补齐：flag、note、ruling，与 `look focus=session`（切片 8，票 #27）

规格 #12 第三节把 `apply` 的十种效果一次列全，切片 0–7 落了六种（`move`、`clue`、`time`、`damage`、`handout`、`item`、`cash`），四种一直报 `not_implemented`。其中 **`npc` 归 §17（票 #29）**，那一片连着作者档案与运行时账本一起做，本节不碰。剩下三种的后果：模组图上的开关条件没有真值可读；守秘人在桌上做的裁定与欠下的连续性债务落不了地——用户故事 24「我的裁定被记住并在同类判定再次出现时提醒我」至今没有实现路径。本节补齐这三种，外加 `look` 缺的那个 focus。

法则不变：世界改变只经 `apply`，整批先校验后写；模型只写名字，不写任何机器键；匹配靠标识不靠语义（裁定的复现由规则族、决策名、技能名、实体名锚定，内核不做「像不像同一类」的判断）。

### 18.1 `flag`

params：`{"kind": "flag", "name": "<开关名>", "value"?: true | false | "<≤ 40 字的短串>", "why"?}`，`value` 缺省 `true`。写 `world.flags[<slug>]`。

- 名字任取（守秘人的世界状态便签），但**必须有消费者**，所以本票同时接上两个：
  1. 胶囊 `where.exits[].unlock_when` 增加 `met`：条件是 `{"kind": "flag", "flag": ...}` 或条件文本里点名了一个已知 flag 时给 `true`/`false`，判不了给 `null`（内核不猜）。
  2. 胶囊 `known.flags`：已置位的 flag 列表（守秘人专属，预算 512B，超出按最近写入裁剪）。
- 开关**永远不拦路**：`apply move` 不因 `unlock_when` 未满足而失败（模组是参考不是圣经），胶囊只是把满没满足摆给守秘人看。
- 收据 `flag:<slug>-t<n>-c<k>`，守秘人专属，事件 `flag-set`，不进 `mechanics`。

### 18.2 `note`：连续性债务

params：`{"kind": "note", "name": "<短语义名>", "text": "<一句话>", "entities"?: [名], "closes"?: "<某条 note 的名字>"}`。`closes` 单独给时不需要 `text`。

- 存 `notes.jsonl`：`{"name", "text", "entities", "turn", "status": "open"|"closed", "closed_turn"?}`。同名的 open note 再写一次报 `invalid_params`（`fix`：换个名字，或用 `closes` 关掉它）。
- 胶囊 `obligations` 增加 kind `note`：`entities` 与在场实体或当前场景相交的全给，其余按最近三条给；关掉即消失。这是守秘人欠自己的账（「答应过要交代那盏灯」「玛丽还等着回话」），不是玩家可见文字。
- 收据 `note:<name>-t<n>-c<k>`，守秘人专属，事件 `note-written`，不进 `mechanics`。

### 18.3 `ruling`：桌上的裁定，按标识复现

params：`{"kind": "ruling", "name": "<短语义名>", "statement": "<一句话：怎么判>", "anchor": {"family"?: "<规则族名>", "decision"?: "<决策语义名>", "skill"?: "<技能名>", "entities"?: [名]}, "scope"?: "campaign"（缺省）| "module" | "scene"}`。`anchor` 至少一个字段。

- 校验闭合、全靠标识：`family` 必须是 RuleGraph 的十族之一；`decision` 必须是图上存在的决策语义名；`skill` 必须解析到技能目录；`entities` 必须解析到图上的实体。都报 `invalid_params` 并在 `fix` 里给出可用值。**内核不判断两次判定像不像同一类**——匹配就是标识相等。
- 存 `rulings.jsonl`：`{"name", "statement", "anchor", "scope", "turn", "status": "active"|"superseded", "superseded_by"?}`。锚点字段完全相同的新裁定接续旧的（与记忆里 `relationship` 的接续同一条法则）。
- 两处投影，都是提醒不是强制：
  1. `resolve` 结果增加 `rulings: [{"name", "statement"}]`：本次流水线实际选中的决策、它所属的族、用到的技能、行动里点到的实体，任一与锚点相等即命中（≤ 3 条，按新到旧）。**这就是用户故事 24 的落点**：判定发生的那一刻，上次怎么判的就在结果里。
  2. 胶囊 `situations.rulings`：锚点命中活跃会话的族、在场实体、或 `scope: "scene"` 且就是这个场景的，≤ 3 条，预算 1KB。
- `scope: "scene"` 的裁定只在写下它的那个场景命中；`module` 只在同一模组的战役里命中（跨战役共享靠模组存储，不在本票）。
- 收据 `ruling:<name>-t<n>-c<k>`，守秘人专属，事件 `ruling-made`，不进 `mechanics`。
- 不做的：旧树的 house rules 提议/确认流程（规格已排除），裁定改变规则算术（裁定是给守秘人看的文字，永远不改数）。

### 18.4 `look focus=session`

`LOOK_FOCUS` 增加 `session`：返回当前活跃会话的完整视图（种类、轮次、序列、轮到谁、可用动作、待决的防御或推骰），没有会话时 `{"session": null}`。今天这份数据只能从 `where.session` 的三字段摘要或上一次 `resolve` 的结果里拼，重开进程后拼不回来。

### 18.5 事件与遥测

canonical 事件枚举（§12.1，代码里实为十五类：`kernel/coc/events.py`；契约 §1/§7/§12.1 的「十二类」是切片 4 之后没跟上的旧数，本票一并改正）增加三类：`flag-set`、`note-written`、`ruling-made`（`npc-changed` 归 §17），共十八类。加类要同时改 §12.1 的清单与 `tests/kernel/test_events_slice2.py` 的闭合断言。

### 18.6 验收

- 内核用例：三种效果各自的写侧与校验、`ruling` 的锚点匹配与接续、`note` 的开关、`flag` 的 `met` 三态、`look focus=session`；每条产品修复配一个能被变异杀死的用例。
- 真桌（`toomany-s4` 续局或新建）：置一个开关并在胶囊里看到某条出口的 `met: false`；开一条 note 并在两回合后关掉；做一次裁定，随后在同族的第二次判定里从 `resolve` 结果看到它被提醒；战斗里 `look focus=session` 拿到完整会话视图。

### 18.7 The kernel's decisions (implemented, ticket #27)

- **Where it lives.** `kernel/coc/bookkeeping.py` holds the three effects, their validation, the two ledgers and both projections; `table.py` only routes (`APPLY_KINDS` gains `flag`, `note`, `ruling`; `APPLY_RESERVED` keeps `npc` for §17). The three receipts carry `visibility: "keeper"`, so `mechanics` (§16.2) projects nothing for them and `narrate`/`ask` owe no number; `facts.committed` (§12.5) has no sentence for them either — they are the keeper's bookkeeping, not events the player saw. `recall history` timeline counts keep their six kinds.
- **Ledgers.** `notes.jsonl` and `rulings.jsonl` sit in the campaign directory (`Campaign.notes_path` / `rulings_path`), append-only; the current state of a note or ruling is its last row by normalized name. A batch stages its rows and appends them right after `world.json` is written, so a failed effect writes nothing; the per-turn commit carries them like every other file. A closed note is a new row `{...open row, "status": "closed", "closed_turn", "closed_by": <call_id>}`; a superseded ruling is a new row `{...old row, "status": "superseded", "superseded_by": <new name>, "superseded_turn"}`, followed by the new one.
- **`flag`.** The key is `kebab(name)` (`Records serious crime destination known` → `records-serious-crime-destination-known`; `reached_blast_chamber` → `reached-blast-chamber`); `value` is `true` (default), `false`, or a non-empty string of at most 40 characters — anything else is `invalid_params`; the words `"true"`/`"false"` (any case, trimmed) read as the booleans, because a host tool schema that types `value` as a string would otherwise store the word and a gate would read `"false"` as set. `world.flags` stays a plain map `{slug: value}` in write order: a re-set flag is moved to the end, so recency is the map order and no timestamps are stored. Receipt `flag:<ascii slug, 24 chars>-t<n>-c<k>` with `{name: slug, value, previous, why}`; event `flag-set` `{name, value, previous}`.
- **Exit gates.** `where.exits[].unlock_when` is now an object `{"condition": "<described>", "met": true | false | null}`, present on every exit whose authored condition is not `always` (before this slice it was a string, shown only while unmet). Decidable: `clue_discovered`, and a flag condition in either spelling — the starters' `{"kind": "flag_set", "flag_id": ...}` (the-haunting: `hall-of-records → higher-courts-central-police`) or §18.1's `{"kind": "flag", "flag": ...}`, optionally with `value`; a flag not in the map reads `false`, a flag set to `false` reads `false`, any other value reads `true` (with `value` given: exact equality). A built book's `route-to` edge that carries only `properties.flag` (the-white-war's `derived_from: exit-entry-flag`) is read as a `flag_set` gate, and a bare-string condition as a flag name. A condition of any other kind reads the flags the world already holds by whole-token containment of the slug in its strings (`narrative` text naming `door-open` → that flag's truth); with no known flag named it is `null`. `condition_met` (chase chains, sessions) is now `condition_status(...) is True`, so a held flag also satisfies it. `apply move` never consults a gate.
- **`known.flags`.** `[{name, value}]`, most recent write first, fitted to its own 512 B by shedding the tail before `known` is fitted to 3 KB; a cut is recorded as `known.flags` in `truncated`.
- **`note`.** `text` opens a note (then `name` is required); `closes` closes the open note of that name (`name` and `text` may then be omitted); both in one effect replace one note by another, and `name == closes` with `text` restates a note. Opening a name that is already open is `invalid_params` (`details.open_since_turn`); closing a name that is not open is `invalid_params` (`details.open` lists what is). `entities` resolve like §12.4's `about` — the canonical name when exactly one investigator, NPC, scene or clue matches (exact, else one whole word), the keeper's own words otherwise: a note is a memo, not a world write. Receipt `note:<slug>-t<n>-c<k>` `{name, status: open|closed, text, entities, closes}`; event `note-written` with the same four fields. Capsule `obligations` rows: `{"kind": "note", "name", "who": "keeper", "state": <text>, "turn", "cue"?: <entities joined>}` — every open note whose entities meet a present NPC (display name or handle) or this scene (handle or the keeper's label) first, then the most recent three of the rest.
- **`ruling`.** `anchor` is validated closed and spelled canonically before anything is written: `family` against the RuleGraph coverage families (`details.options`), `decision` against the decisions' semantic names (a full `decision:coc7:...` ref is accepted and reduced), `skill` through `SkillResolver.resolve_explicit` (`details.options` = the closest sheet skills), `entities` through `graph.resolve` on any node kind, stored as sorted handles (`details.candidates` on a miss); at least one facet, no other keys. `scope` is `campaign` (default), `module` or `scene`; the row also records the scene it was made in and the module id. A new ruling supersedes every active ruling with the same normalized name **or** the identical anchor (canonical JSON, entities sorted). Receipt `ruling:<slug>-t<n>-c<k>` `{name, statement, anchor, scope, supersedes: [names]}`; event `ruling-made` with the same fields minus the statement.
- **Matching is a conjunction.** §18.3's "任一相等即命中" is read as: whichever facets the anchor names, each must be equal to the facet at hand (an anchor `{skill: Spot Hidden, decision: ordinary-check}` does not fire on a Listen ordinary check); `entities` counts as met when any anchored handle is among the handles at hand. In `resolve` the facets are the settled `decision` and `family`, the `skill` of every D100 roll receipt of the settlement plus `outcome.skill`, and the graph handles of `action.target`, `action.actor` and `outcome.target`. `result.rulings: [{name, statement}]`, newest first (turn, then ledger order), at most three; only settled results carry it (an `outcome.kind: none` selected nothing). In the capsule the facets a turn can judge are the live session's family (`combat`, `chase`, `sanity_bout → sanity`) and the present NPC handles plus this scene's handle; a family facet outside the session families (`core-check`, `social`, …) is not held against the ruling there, a `decision` or `skill` facet never is, and an anchor with nothing judgeable is left to `resolve`. A `scope: "scene"` ruling made in this scene shows regardless of its anchor. `scope: "scene"` filters both projections to the scene the ruling was made in; `scope: "module"` compares module ids, which inside one campaign is always equal (cross-campaign sharing is not in this slice).
- **Capsule section.** `situations` is a list of state-driven decisions, so `situations.rulings` cannot exist; the rulings ride as a top-level section `rulings: [{name, statement, anchor, scope}]`, budget 1 KB, tail-dropped, `truncated: "rulings"`. `look focus=scene` does not carry it.
- **`look focus=session`.** `{"session": <11.9 view or null>, "pending_choice": <11.9 pending or null>}` — the same `SessionView` the capsule and every `resolve` echo, rebuilt from the engine snapshots under `save/`, so a fresh process returns the same fight; `{"session": null, "pending_choice": null}` when nothing is live.
- **Events and counts.** `kernel/coc/events.py` is closed at eighteen: `flag-set` (`apply flag`, `{name, value, previous}`), `note-written` (`apply note`, `{name, status, entities, closes}`), `ruling-made` (`apply ruling`, `{name, anchor, scope, supersedes}`), each anchored on its receipt; `tests/kernel/test_apply_bookkeeping.py` pins the enum. The §12.1 table and the "fifteen" wording in §3, §7 and §12.1 were not edited by this slice (a parallel session owns that file's §17); the three rows above are what §12.1 needs, and the count becomes eighteen.
- **Left to the extension.** The `apply` tool description does not list `flag`/`note`/`ruling` and the keeper prompt says nothing about rulings or notes; `look` schema does not list `session`.

## 19. 桌况扩展：命令面、模型切换、COC 自己的上下文折叠（切片 10，票 #28）

规格 #12 第一节给 table 扩展派了五件事：HUD、欢迎页、上下文折叠、`/system` 命令、模型与思考等级切换。落地的只有前两件（状态行 `coc-session`/`coc-director` 与 `coc-welcome` 条目），后三件一直空着，扩展里没有一个 `registerCommand`。长局因此有两个真问题：会话记录被每回合的胶囊与工具往返撑大，Pi 的缺省压缩不知道哪些能整段丢；桌上换模型（守秘人太贵、太慢、抽风）只能杀进程重开。

宿主接口都在（`docs/pi-host-contract.md` 第 2 节与新的 3.5 节登记了实测行为）：`pi.registerCommand(name, {description, handler})`、`pi.setModel(model)` / `pi.setThinkingLevel(level)`（在 `ExtensionAPI` 上，不在 `ctx` 上；`ctx` 只有只读的 `model`、`thinkingLevel`、`modelRegistry`，且思考等级会被模型能力钳住，必须 `pi.getThinkingLevel()` 读回）、`session_before_compact` 事件与 `ctx.compact(options)`（fire-and-forget，要抢在回合前落地得自己包 `onComplete`）。

### 19.1 一个命令，几个子命令

只注册一个命令 `/coc`（规格里的 `/system`；名字随包走，避免与 Pi 自己的命令撞）。所有输出走 `ctx.ui`，**永不进模型上下文**：命令是给人看的，不是给守秘人看的，桌上的一次 `/coc` 不占守秘人一个回合，也不改回合状态机。

| 子命令 | 做什么 |
| --- | --- |
| `/coc`（无参） | 桌况面板：战役 id 与标题、回合号与状态、场景与时钟、队伍 HP/SAN/MP、活跃会话、Director 上一个节拍与理由、模组材料就绪度、当前模型与思考等级。数据取 `table.status` 与本回合胶囊，只读。 |
| `/coc model [provider/model]` | 无参列出注册表里的候选（`ctx.modelRegistry`）与当前值；有参切换（`ctx.setModel`），回合中途切了下一回合生效，当前回合不回滚。切换写一行遥测。 |
| `/coc thinking <level>` | `ctx.setThinkingLevel`，同上。 |
| `/coc lanes` | 校验与记忆两条车道的模型、最近 10 行车道遥测（成功/失败/耗时/原因码）。每个 `narrate` 关掉的回合都留一行，包括车道根本没跑的四种（没有事实清单、模型解析不出、调用抛错、超时），静默不跑不再可能。 |
| `/coc evidence` | 打印证据路径：战役目录、遥测、逐字记录、模组存储、玩测目录。给人用来开另一个终端看。 |

`ctx.mode !== "tui"` 时（RPC 模式、print 模式）命令只回一行「interactive only」，不做别的：驾驭器不靠它。

#### Host decision: explicit reasoning effort (2026-09-07)

For local xAI Grok 4.5/4.6 registrations, declare `reasoning: true` and
disable unsupported `off` and `minimal` levels with `thinkingLevelMap` values
of `null`. Grok 4.6 additionally supports `xhigh`. The local table default is
`low`; explicit supported user selections remain available through Pi.
These models cannot disable reasoning and default to `high` when effort is
omitted. Registering them as non-reasoning makes Pi omit effort even when its
UI reports `off`. Configure the existing repository-local Pi home; do not
patch Pi or hardcode provider behavior into the kernel. Verify the emitted
Responses payload and real table quality before claiming a latency benefit.

References: https://docs.x.ai/developers/model-capabilities/text/reasoning
and Pi 0.85.1 `docs/models.md` (`thinkingLevelMap`).

### 19.2 COC 自己的上下文折叠

Pi 的缺省压缩不知道这张桌子哪些东西是可再生的。接 `session_before_compact`。**这个钩子表达不了「按条目挑着丢」**：它的返回是一个切点加一段摘要，Pi 用摘要替换切点之前的一切。所以「整段丢那些、原样留这些」只能实现成「选好切点，把要留的原样抄进摘要」。COC 口径如下：

- **整段丢**：所有 `coc-capsule` 消息（每回合重新生成，旧的一律是废页）、带工具调用的助手消息与工具结果消息（收据在内核里，`recall` 能拿回来）、上一次折叠自己写的那条说明。（`coc-mechanics` 是 `CustomEntry`，本来就不进模型上下文，丢它不改变守秘人看到的东西。）
- **原样留**：玩家输入与已交付的正文（它们是逐字记录的对应物）、系统提示、最近两回合的全部往返、任何 `pending_*` 相关的宿主消息。
- **压缩后补一条宿主消息**：一行英文，说明桌面状态在下一回合的胶囊里、往事用 `recall`、本回合的待决是什么。守秘人不需要从摘要里回忆状态——状态本来就每回合重发。
- 触发：除了 Pi 自己的阈值，`before_agent_start` 里当上下文占用超过阈值（缺省 70%，`PI_COC_COMPACT_AT` 可调）就先 `ctx.compact()` 再进回合，避免压缩发生在工具往返中间。刚折叠完 `getContextUsage().percent` 是 `null`，那一轮不判。
- 代价说清楚：留下的逐字对话随局增长，所以折叠**不是定长**的——胶囊、机制、工具往返都没了，但玩家原文与交付会一直累积。要定长得等上游给「按条目丢」的能力（宿主契约第 6 节的请求）。

判据是**条目类型与回合距离，不是内容语义**——不读文本、不做相关性判断（`Agents.md`「语义问题不许硬编码」）。

### 19.3 验收

- 扩展用例：五个子命令各自的输出形状与 `mode !== "tui"` 的降级；折叠钩子在一个造出来的长会话上按类型丢对了东西、留下了玩家输入与交付、补了那条宿主消息；`before_agent_start` 的阈值触发。
- 真桌：一局跑到需要压缩（或把阈值调低逼出来），压缩之后守秘人接着走三回合不丢状态：场景、待决、在场 NPC、上一条线索都还在（它们本来就每回合从胶囊来）；桌上用 `/coc model` 换一次模型，下一回合生效且回合状态机没被打断。

## 20. 从 PDF 到可玩：本地抽取、外包 OCR、一个后台作业（切片 11，票 #30）

> 历史设计，生产实现已退役。当前唯一 PDF 准备流程见 §22；保留本节用于理解历史证据，不提供 OCR 或资料包导入兼容入口。

用户 2026-09-06 的更正与拍板：`@firecrawl/pdf-inspector` 是**本地**原生库（NAPI，按平台带预编译二进制），不是网络服务；OCR 外包给百度飞桨（PaddleOCR AI Studio 的 OCR Jobs API）；库已更新到 1.17.0，用新的，不用 `~/.pi/coc-tools/pdf-inspector` 里那份 1.12.0 的部署。

今天的缺口不是能力是接线：建卡第二步 `build-bundle` 让助手「告诉玩家怎么用宿主的 PDF 技能产出资料包」，仓库里却没有任何东西说得出怎么；装包器 `bundle_from_pages.py` 躺在 `tests/play/`，不在产品路径上。已装的那本 20 页的书是手工装包的。

### 20.1 一条边界，两个适配器

**边界不变**：内核只见成品资料包（§14.2 的 `coc.pdf-bundle.v1`），`module.bind` 逐字节复核。**清单永远由我们签**：适配器只写 `pages/NNNN.md` 与 `assets/`，每页 sha256 由打包器算——让适配器交清单，逐字节复核就变成核对适配器自己的说法。

| 适配器 | 在哪跑 | 干什么 |
| --- | --- | --- |
| `extract` | 本地，扩展进程内 | `classifyPdf(buffer)` 给 `{pdfType, pageCount, pagesNeedingOcr, confidence}`；`extractPagesMarkdownAsync(buffer, pages?)` 给每页 `{page（0 起）, markdown, needsOcr, ocrReason?}`。页码从 0 起，正好是资料包的页码 |
| `ocr` | 外包，飞桨 OCR Jobs API | 只处理 `pagesNeedingOcr` 那几页，回页级 Markdown 与图片；token 走环境变量 `BAIDUOCR_TOKEN`，永不进命令行、源码或产物 |

哪些页要 OCR **不做判断也不用阈值**：`classifyPdf` 直接给名单，`extractPagesMarkdown` 每页还带 `needsOcr` 与 `ocrReason`。实测《不息的渴望》41 页：`Mixed`，需 OCR 的是第 0、1、11、35–40 页，其余原生抽出干净中文，第 2 页就是目录。

**法则修订（本节生效）**：旧说法「仓库不解析 PDF」收窄为 **「内核不解析 PDF；解析只发生在宿主适配器里，产出永远是可逐字节复核的资料包」**。Python 侧禁止 import PDF 库的两条测试不变（内核仍然一行都不解析）；`@firecrawl/pdf-inspector` 作为 `optionalDependencies` 进 Node 侧（每平台一个约 9MB 的原生包，装不上时 ingest 报缺适配器，仍可接手工资料包）。收窄的理由是原来的顾虑不成立：它本地跑、离线、确定，不引入网络也不引入 Python 依赖；真正要守的是「产出必须可复核」，那条一个字没动。

### 20.2 一个后台作业 `ingest`

`extensions/module/ingest.ts`：`{pdf, module_id?}` → 分类 → 原生抽取 → 需要 OCR 的那几页交外包 → 写页文件与资产 → 打包器签清单 → `module.bind` → `module.plan` → 无人值守构建（§14.3 已有）→ `module.install`。作业可重入：同一 PDF 的 `file_sha256` 已有页文件就复用，只补缺页（飞桨那边一次作业不便宜）。

总线新增 `coc:module-ingest`（起）、`coc:module-ingest-progress`（`{stage: classify|extract|ocr|pack|bind, page?, of?}`）、`coc:module-ingest-done`、`coc:module-ingest-failed`；构建那四条（§14.5）不变。遥测 `lane: "ingest"` 每阶段一行，失败带原因码 `no_extractor`、`ocr_unavailable`、`ocr_failed`、`bad_pdf`、`bind_rejected`。

### 20.3 命令面（收进 §19 的 `/coc`）

- `/coc module parse <pdf 路径> [--id <module_id>]`：起作业，进度打在界面上，不进模型上下文。
- `/coc module`：存储里有什么——id、书名、页数、section 接受/总数、开场是否就绪。
- `/coc module use <id>`：**不能热切**——一局游玩会话在 `session_start` 就绑死一个战役。它只打印用这本书开桌的命令。「载入」在这个架构里不是动作：解析好的书住在共享存储里，玩它等于在它上面建一个战役。

建卡第二步 `build-bundle` 的 `lines.do` 改成给出这条命令；`bundle_from_pages.py` 挪到 `bin/coc-bundle`（`tests/play/` 留一个 import 转发，玩测脚本不动）。

### 20.4 Electron 是同一个作业

命令里不放逻辑。前端点 PDF 触发的是同一个 `ingest` 作业，进度订阅同一批总线频道，经 Pi RPC 事件流出去（§10 的两个接口不变）。库是本地原生模块，将来也能直接在 Electron 主进程里跑，不需要守护进程。逻辑写进命令就得写两遍。

### 20.5 分层还是按需

旧树在开场之前分三层读（封面目录建骨架 → 选择性补索引 → 开场深读）。这里不重来：`classifyPdf` 一次给身份与页数，抽取按页范围调用，开场之后的深浅由 §14.6 的深挖队列管——队伍走近哪一章就后台读哪一章。所以 ingest 只有两档：**全书抽页**（便宜，本地，一次做完）与 **OCR 补页**（贵，外包，只补名单上的）。

### 20.7 解析一次，之后直接开桌

**已经是这样了，缺的是入口与住处。** 模组存储 `.coc/modules/<id>/` 就是解析产物的家：`module-graph.json`（图）、`module-graph-manifest.json`、`sections.json`、`shards/`、`work/`（构建中间物）、`assets.json`、`build.jsonl`、`bundle/`（页文件）。战役不复制它——`campaign.json` 只记 `module_id`、`module_digest`、`module_generation`，`Table.graph()` 每次读存储的当前 generation（§14.1）。所以同一本书开第二局、第十局，解析成本是零。

三处要补：

1. **建卡选不到已装的书。** `content/setup/steps.json` 的 `choose-source` 只认 `starter` 与 `bundle`，`sources` 是 `["starter", "pdf"]`；而 `campaign.create` 早就接受存储里已登记的模组。加第三种来源 `module`（`module.list` 里 `status: installed` 的），选它就跳过 `build-bundle` 与 `bind-source` 两步直接建战役。**这是「以后直接加载来玩」缺的唯一一环。**
2. **存储的住处跟着工作目录。** 扩展把 `ctx.cwd` 当 workspace 传给内核，所以 `.coc/` 在哪起 `pi` 就在哪。开发时正好，装成 Electron 应用就不对，而且在另一个目录起就看不见已解析的书。加 `PI_COC_HOME`（缺省仍是 `ctx.cwd`）：**模组是库，战役是存档**，库该在稳定的用户数据目录，存档可以跟着库也可以另放。本票只做环境变量与缺省，拆两个根留给前端那一片。
3. **带不走。** 没有导出/导入。一本解析好的书这里约 800KB，其中 `work/` 与 `shards/` 是构建中间物，真正开桌要的是图、清单、sections、assets 与 `bundle/`（深挖队列还要回去读页）。`module.export`/`module.import` 留给以后，不在本票。

### 20.6 验收

- 一本没进过库的真 PDF（《不息的渴望》，41 页，9 页需 OCR）走 `/coc module parse` 到 installed，中途不手工装包；`module.bind` 的逐字节复核通过；OCR 那 9 页的内容进了页文件。
- 断网（或不给 token）重跑：需 OCR 的页记 `ocr_unavailable`，其余页照常成书，作业不整体失败，缺页在可玩性简报里点名。
- 同一本再跑一次：页文件复用，飞桨零调用。
- 真桌：用这本书新建战役开三回合，开场材料来自构建而不是临场翻书。

## 21. 调查员库：建一次，之后哪一局都能用（切片 12，票 #31）

用户 2026-09-06 的四条拍板：**载入整卡快照原样带过**；**库里的卡与新模组时代不符也允许，原样不动**；**在战役里玩过之后每回合自动回流**；建卡与载入都要有入口。

今天只有建卡：`setup.investigator` 在一个战役里造一张卡，写进 `<campaign>/party/<id>.json`，局终则止。同一个人物在下一本书里要重造一遍，练出来的技能、掉过的理智、攒下的东西全丢。

### 21.1 库住在哪，里面是什么

`<PI_COC_HOME>/.coc/investigators/<library_id>.json`（`PI_COC_HOME` 见 §20.7；模组是库、战役是存档，调查员同理）。`library_id` 是名字的 ascii slug 加短序号，机器铸，模型不写。

一行就是一张整卡加一段来历：

```
{"library_id", "sheet": {<party/<id>.json 原样>},
 "origin": {"created_in": "<campaign id>", "created_at", "era_at_creation"},
 "play": {"last_campaign", "last_turn", "last_commit", "updated_at", "campaigns": ["<id>", ...]},
 "schema_version": 1}
```

`sheet` 是逐字节的整卡：`characteristics`、`skills`、`derived`、`equipment`、`weapons`、`finance`、`cash`、`creation`、`era`、`occupation`、`current_hp/san/mp/luck`。实测这张表是自足的——伤口与状态活在引擎快照里而不在卡上，所以整卡搬家不会带出指向别局收据的悬空引用。

### 21.2 四个方法

- `investigator.list` → `[{library_id, name, occupation, era, current_hp, current_san, last_campaign, last_turn, updated_at}]`，按 `updated_at` 新到旧。
- `investigator.get {library_id}` → 整行。
- `investigator.save {campaign, investigator?}`：把战役里的卡存进库。已经有来历的更新那一行，没有的新建并在战役卡上写 `origin.library_id`。
- `investigator.load {campaign, library_id, as?}`：**整卡快照原样带过**——`sheet` 逐字节拷进 `<campaign>/party/<新 id>.json`，只改 `id`，并写 `origin: {library_id, loaded_at_turn}`。不折算、不重掷、不校时代。

### 21.3 时代不符：允许，原样不动

库里的卡是 1920s、新书是现代或古罗马，一律照收：不换属性、不换技能表、不换现金表。内核只把两个时代都记进战役记录（`campaign.json.era_mismatch: {sheet, module}`），胶囊 `known.investigator` 带一句英文提示让守秘人知道，怎么圆是他的事。**没有转换器**——时代折算是开放语义问题，不硬编码（`Agents.md`）。`setup.investigator` 现有的时代守卫只管新建卡，不管载入。

### 21.4 每回合自动回流

回流挂在提交后链（§12.2）里，检查点之后、抽取任务之前：本回合关闭时，凡是带 `origin.library_id` 的在场调查员，把它当前的整卡写回库，并更新 `play.last_campaign/last_turn/last_commit/updated_at`，`campaigns` 去重追加。

- **不阻塞回合**：写库失败只进遥测（`lane: "library"`，原因码 `library_unwritable`、`library_conflict`），回合已经关了，不回滚。
- **整文件原子写**，与别处一致。
- **同一张卡同时在两局里玩**：允许，后写的赢，`play.last_campaign` 与 `updated_at` 记着是谁最后写的——库是这个人物的当前状态，不是版本控制。真要分身就 `load` 成两张（`as` 给新名字），那是两个人。
- 回流只写库，**永不反向覆盖战役**：战役是权威，库是它的镜子。

### 21.5 入口

建卡表（§14.4）的 `create-investigator` 加来源选择，与 §20.7 给模组加的第三种来源同一形状：**新建**（现有七步不变）或**从库里载入**（`investigator.list` 选一张，`investigator.load`，跳过职业与属性分配）。命令面加 `/coc investigator`（列库）与 `/coc investigator save`（手动存一次，回流之外的保险），输出只走界面。

### 21.6 验收

- 建一张卡，存进库；新建另一局（另一本书），从库里载入，逐字节比对整卡一致，只有 `id` 与 `origin` 不同。
- 时代不符那一局照常开桌，胶囊里有提示，数值一个没变。
- 真桌玩三回合，其中有技能成长或理智损失：每回合结束后库里那一行跟着变，`last_turn` 对得上。
- 断开库目录的写权限：回合照常关闭，遥测有 `library_unwritable`，下一回合仍然能玩。

### 21.7 内核的决定（已实现）

- **Where it lives.** `kernel/coc/library.py` holds all of §21.1–§21.4: the store, the row, id minting, the two era helpers and the per-turn write-back. Everything else is one line each — `store.py` gains `Store.investigators_dir` (`<workspace>/.coc/investigators`, beside `modules/`; §20.7's `PI_COC_HOME` moves the whole `.coc` root, so the library follows the module store without knowing about it), `rpc.py` splats `**library_methods(table)` into `build_methods` the way `**module_methods(table)` already did, `table.py` adds one `("library", …)` step to the post-commit chain, and `capsule.py` merges `era_note(...)` into `known.investigator`. The library never reaches into `Table` except through `_actor`, `investigator_row`, `graph` and `module_store`, so it holds no turn state of its own.
- **The row.** Exactly §21.1's five keys in that order: `library_id`, `sheet`, `origin {created_in, created_at, era_at_creation}`, `play {last_campaign, last_turn, last_commit, updated_at, campaigns}`, `schema_version: 1`. `sheet` is the campaign file verbatim — including the `origin` block the campaign sheet itself carries — so a row and the sheet it mirrors compare equal. `origin` is written once at creation and never rewritten; only `sheet` and `play` move.
- **`library_id`.** `<ascii slug of the name, ≤32 chars>-<ordinal>`: `text.ascii_slug` folds accents and drops punctuation (`Zoë O'Brien-Núñez` → `zoe-o-brien-nunez-1`), and a name with no Latin letter or digit falls back to the stem `investigator` (a CJK-named card is `investigator-1`). The ordinal is one past the highest ordinal that exact stem already holds on disk, then bumped past any file that already exists, so minting is deterministic for a given library, never overwrites a file someone else put there, and treats `Ada Lovelace 2` (stem `ada-lovelace-2`) as a different person from the second `Ada Lovelace` (`ada-lovelace-2`). The model never writes an id: `investigator.save` mints it and stamps `origin.library_id` on the campaign sheet, and the row is written before the sheet, so a sheet's origin always names a row that exists.
- **`investigator.list` / `get`.** `list` returns `{"investigators": [<§21.2 summary>], "unreadable"?: [library_id]}` — an object, not a bare array, and a row this kernel cannot parse is named rather than silently skipped. Sorted by `updated_at` newest first, `library_id` breaking ties. `get` returns the whole row; an unknown id is `unknown_entity` with `details.candidates` listing what the library holds; a row that is on disk but unparseable is `internal` with `code_detail: "library_conflict"` — never a silent empty result.
- **`investigator.save`.** `{campaign, investigator?}`; the actor is picked by `Table._actor`, so no investigator named at a two-card table is `needs_choice` and a wrong name is `unknown_entity`, exactly as everywhere else. A card that already has an origin updates that row; one without gets a row minted. `play.last_turn` / `last_commit` come from the campaign's git HEAD (`history.head_turn` / `head_sha`), so a manual save before the first `narrate` records `last_turn: null` against the creation commit rather than inventing a turn number. The campaign may be `setting_up`, ready or active: saving needs neither a world nor an open turn.
- **`investigator.load`.** `{campaign, library_id, as?}`. The sheet is deep-copied and only `id` is replaced in place (key order therefore unchanged) and `origin` set to `{library_id, loaded_at_turn}` — no conversion, no re-roll, no era gate. The new `id` is `chargen.default_investigator_id(name, party+1)` with a `-n` suffix if that is taken, which is what `setup.investigator` mints, so a library card and a freshly built one are named by the same rule (a CJK-named card joins as `inv-<n>`). `loaded_at_turn` is `0` while the campaign is setting up and otherwise the open turn number; a card may only join between turns (`awaiting_player` or `asked`), and joining while the keeper is acting is `turn_state` — the capsule and the session snapshots of a turn in flight already name the party. Loading updates `campaign.json.investigators`, and while the campaign is `setting_up` it appends a setup receipt `{kind: "investigator", source: "library", library_id, forked_from}`, so `setup.steps` counts `create-investigator` done and `setup.complete` accepts the campaign. Loading is read-only on the row: the row still says the card was last played wherever it was last played, until this campaign commits a turn.
- **`as` is a second person, not a rename.** §21.4's double: with `as`, the copy's `name` changes too, a *new* row is minted for it and written before the campaign sheet, and its `origin.forked_from` names the row it came from. The original row is untouched. Without `as` the copy keeps sharing one row with every other table playing that card.
- **Era.** The book's era is `module-meta.json`'s `era` inside the module node's `runtime_projection.documents` (`the-haunting` → `1920s`, `the-white-war` → `ww1`), falling back to the node's `runtime_projection.record`. When both eras are known and differ, `campaign.json.era_mismatch: {sheet, module}` records them and the capsule's `known.investigator` gains one English `era_note` line telling the keeper the numbers were not converted and the difference is fiction's problem. Nothing on the sheet changes and no method refuses. A card with no origin never carries the note, and an unknown module era is not a mismatch. **Defect found, not fixed here:** `setup.investigator` reads the module era through `record_of(module_node)`, i.e. `runtime_projection.record`, which the module node does not have — so every book's era reads as `None` there and new cards fall back to `1920s` even on `the-white-war`. That is `setup.py`, owned by another slice; §21.3's guard ("the era guard governs new cards only") is unaffected, but a new card built on a ww1 book is silently a 1920s card today.
- **The write-back.** One call, `library.write_back(store, campaign, record)`, in `Table._after_commit` between the continuation checkpoint (§12.2) and the memory episode (§12.3). It runs once per committed turn per card carrying `origin.library_id`: the row's `sheet` is replaced whole by the campaign's, `play.last_campaign/last_turn/last_commit/updated_at` move and `campaigns` gains the campaign id once. A row that has gone missing is recreated from the campaign, with `origin.created_in` naming the campaign that recreated it. **Only `narrate` mirrors:** `ask` closes a turn without a git commit, so there is no `last_commit` to record and the next `narrate` catches the row up. Cards without an origin are skipped and write nothing, so a table that never saved a card never creates `.coc/investigators/`.
- **One card, two tables.** Allowed, last writer wins, no lock and no version: `play.last_campaign` and `updated_at` say who wrote last and `campaigns` says who has ever played it. The library is never read back into a campaign — nothing in the kernel copies a row's sheet over a campaign sheet except `investigator.load`, which is an explicit call that mints a new `id`. A row edited by hand between turns is simply overwritten by the campaign at the next commit.
- **Four failure paths, none of which fails a turn.** `write_back` never raises. (1) The row on disk is not JSON, not schema 1, or names another id → `Conflict`, telemetry `{lane: "library", turn, investigator, library_id, ok: false, reason: "library_conflict"}`, the file left exactly as it was. (2) The row cannot be written (a read-only `.coc/investigators`, a full disk) → `Unwritable`, `reason: "library_unwritable"`, the mirror unchanged. (3) Anything else thrown while mirroring one card → the same row with `library_unwritable` and the exception's type in `error`, and the remaining cards are still mirrored. (4) The write-back could not start at all → one `lane: "library"` row for the turn; if even the telemetry write fails, `_after_commit`'s own guard records `{lane: "kernel", step: "library"}`. A successful mirror leaves `{lane: "library", ok: true}`, so the evidence shows the mirror moving turn by turn and not only when it breaks. The same two reason codes surface as `code_detail` on `investigator.save` / `get` / `load`, which do fail — a manual save says why instead of pretending.
- **Left to the extension (§21.5, not in this slice).** The `create-investigator` source choice in `content/setup/steps.json`, and the `/coc investigator` and `/coc investigator save` subcommands of §19.1. The four RPC methods are the whole kernel side; nothing in `kernel/` calls them.

## 22. Visual PDF reading and demand-driven graph building

2026-09-07 用户确定的实施方向；本节已实现并替换旧路径；最终验收与集成状态见规格实施记录。实现顺序、删除范围和验收在 [visual-pdf-reader.md](specs/visual-pdf-reader.md)。本节替换 §14.2–§14.6、§14.11 中的文字构建协议，以及 §20 的分类/提取/OCR/打包协议；保留既有图谱消费、人物/规则/事务、资产可见性和七个 Keeper 动词。Electron onboarding and browser acceptance are covered by §24.

### 22.0 Selective reading after sandbox validation

Guidance latency refinement (2026-09-08): the host supplies the small task and native
PDF navigation in the initial reader prompt; reviewers receive their immutable
candidate pair and assigned paths up front. Navigation is not source evidence.
Both remain tool-enabled Pi agents and must view the original required pages.
A private `submit_reading` tool may write the bounded guidance pair or review,
check it, and return Pi's documented `terminate: true` to finish the tool batch
without a redundant final model response. Existing file-based write/edit/check
remains available. A failed check continues the same agent. This tool does not
publish a graph or bypass source review: the host still waits for child exit,
checks image delivery and immutable candidates, and calls module.read.finish
through the existing lease and publication gates. Only guidance and its reviewer
use this fast completion path; opening/detail behavior and reader capacity stay
unchanged. Host event timestamps distinguish provider, tool and exit intervals.

Opening/detail now queue directly without all-page navigation. One tool-enabled Pi selects native navigation and original pages, constructs the existing graph with prepared current material and sourced thin destinations, then up to 40 fresh tool-enabled Pi sessions independently review node/claim groups. No fixed page cuts or whole-chapter prerequisite. Sandbox owner-dispatch and incremental-draft frameworks were not selected. High-level preparation publishes a reviewed, unready skeleton first, offers authored opening choices, then prepares the selected opening. Cold browser timing for this early milestone remains pending.

Source image cache entries and readable view paths publish by atomic rename; the private pdf tool verifies image bytes before delivery. Every new image reaches the provider before history eviction. Each reviewer cites only images it received. Failed transport/output units retry once in isolated attempts; semantic findings return to source-based repair. Existing leases, cancellation, additive conflicts and source gates remain binding.

The reader host distinguishes Pi's transient provider errors from the final child
outcome. A later successful assistant message clears the earlier provider error;
an unrecovered terminal error still fails the attempt even if the child exits zero.
Malformed events, observer failures and evidence-log failures remain fatal. Author
and reviewer observers collect source evidence without prematurely failing on a
retryable message. Retain the complete error/retry/success event stream. This avoids
repeating successful reading after Pi has already recovered a provider failure.

### 22.1 来源、页与索引

来源存于 `.coc/modules/<module_id>/source.pdf`。宿主 PDF.js 读取元数据并计算原文件摘要；内核绑定时重算文件字节摘要，校验元数据形状，不解析 PDF，也不声称独立核实 PDF 页数。页数的正确性由宿主渲染验收证明。

`module.json` 增加 `reading_version: 1` 和 `source_document: {path, file_sha256, page_count}`。路径相对模组目录，必须落在该目录内。来源发布后不可原位替换。同文件重复导入返回已有模组；同 id 不同摘要报 `invalid_params` 并给出创建新模组的 `fix`。哈希和内部作业标识只在宿主与内核间传递。

宿主翻页命令的两种操作：

- `info`：返回真实页数、已有书签与页面标签。没有书签返回空数组，不由程序猜章节。
- `page <page> [--box x0,y0,x1,y1]`：按需渲染并返回图片路径、物理页号、裁剪范围和实际尺寸；读者再用 Pi `read` 看图。`page` 是从 1 起的物理页序，印刷页码只是标签。`box` 是应用 PDF 旋转后的可视整页上、左为原点的归一化矩形；满足 `0 <= x0 < x1 <= 1` 与 `0 <= y0 < y1 <= 1`。内核持久化 `pdf_index = page - 1`，只在边界转换一次。

书中“见第 N 页”的印刷引用由读者对照原页或可靠 PDF 页标签定位，不能用固定页差在全书或不同版本间推算。2026-09-07 样本已出现物理第 100 页对应印刷 97 的情况；这只是该页证据，不是全局偏移规则。首个交付仍是一份完整 PDF 一个来源；分卷正文与独立手卡册不自动拼接成同一来源。

缓存位于模组内 `cache/pages/`，键包含原文件摘要、物理页、渲染参数与裁剪。只生成请求的页；裁剪从原 PDF 渲染，不能放大已经缩小的预览图冒充细节。宿主保存请求记录，读者会话保留实际图片 `read` 事件与失败，不能把“生成了图片”记成“模型已看过”。缓存不是真相，也不替代原 PDF。

沿用 `sections.json` 作为阅读索引，新的记录形状为 `{name, pages: [[first,last], ...], topics: [string], entities: [string], references: [{name, pages?}], state: "indexed"|"unreadable"}`；页范围在此用从 0 起的物理页序、两端包含。不同主题可重叠，未读范围必须引用实际查看过的目录或标题页，不要求全页覆盖。`topics/entities/references` 由读者判断，程序只检查形状与范围；索引是定位信息，不是事实图，不授权规则结算。全局梗概中的事实要成为游戏依据，仍须走 22.3 的细读与复核。

### 22.2 一个阅读任务协议

保留 `module.list/status/register/opening.choose/asset`。新的模块读写入口如下，全部为宿主调用；内部校验与合并不再拆成要求调用者编排的公开 RPC。

| 方法 | 参数 | 结果与作用 |
| --- | --- | --- |
| `module.source.bind` | `{module_id?, source: {path, file_sha256, page_count}, title?, language?}` | 原子登记并保留原 PDF；返回 `{module_id, replayed}`。`path` 是宿主准备的本地原文件路径；内核复制并核对摘要。已有原文件缺失的旧模组只接受与记录摘要匹配的来源。 |
| `module.read.request` | `{module_id, purpose: "index"|"skeleton"|"opening"|"detail", focus?, question?, foreground?: boolean, retry?: boolean}` | 确认材料已满足该确切请求，或入统一队列；返回 `{state: "ready"|"queued"|"reading"|"blocked", job_id?, generation, missing, fix?}`。`focus/question` 为名字/自然语言，允许索引中尚未进入图谱的实体；`retry: true` 才允许重新派发已经失败/取消的同一请求。 |
| `module.read.claim` | `{module_id, owner}` | 原子认领下一任务；返回宿主生成的 `{job_id, purpose, focus?, question?, work_dir, base_generation, source, index, known_nodes, brief}` 或 `{job_id: null}`。 |
| `module.read.finish` | `{module_id, job_id, outcome: "completed"|"failed"|"cancelled", draft_path?, review_path?, detail?}` | 成功时由内核重新运行结构/来源/就绪检查并发布；失败/取消保留证据、释放认领，返回状态与可执行原因。`draft_path/review_path` 必须属于该任务工作目录；模型不调用此方法。 |

`module.status` 保留旧通用字段，并提供 `reading: {state, index_complete, opening_ready, queued, active, missing}`；`state` 为 `indexing|preparing|ready|blocked`。`ready` 只指开场或所请求范围就绪，不表示全书细读完毕。原来的 `installed` 标记可保留给列表兼容，但新的 PDF 就绪判断不以它为依据。

队列沿用 `deepen-queue.json`，记录 `{job_id, purpose, focus?, question?, foreground, state, owner?, base_generation?, attempts}`。状态为 `queued -> running -> completed|failed|cancelled`。同模组跨 Pi 进程的认领和发布都要使用可恢复的文件锁；只靠扩展内 `busy` 不满足此约束。宿主退出时释放自身任务；恢复要确认原 owner 已不再持有锁，不能仅凭超时夺走仍活跃的写者。

运行顺序：当前前台需求、开场、邻接预读；首次导入由读者自主定位，不等待索引完成。每模组一个活跃任务，读者只处理当前问题所需原页，已写草稿保留。可恢复错误至多自动重试一次；失败之后仅用户或 Keeper 明确重试才重派，不轮询失败请求刷模型调用。

去重键由内核取来源摘要、purpose、归一化 focus 和原样 question 生成。只归并完全相同的待办或已经满足且未失效的请求；不做语义相似度去重。出现不同问题时，旧 section 已 accepted 不构成跳过理由。已满足请求在 `module.json.reading.materials` 保存 `{purpose, focus?, question?, node_ids, source_refs, generation}`；来源或被依赖事实改变时失效，单纯新增不相关事实不引发重读。

### 22.3 读者输出与图谱发布

读者仍为带 `read/write/edit/bash` 的子 Pi：`--no-extensions --no-context-files --no-session`；沿用 repo-local Pi home，删除游玩模式与 campaign 环境。模型须声明图片输入，并由步骤 1 的真实图片读取验证通道；不支持时返回 `vision_required`，不回落到 OCR。读者不能派生另一层读者或内核。

任务简报只提供原 PDF 的翻页方法、可用导航、相关已有节点、当前需求与输出位置；不再塞全文 span。读者可以沿索引与原书引用查看任意必要页。宿主采集子 Pi 的结构化事件作为证据，不继续丢弃 stdout。进程成功退出不等于抽取成功。

定位任务写索引草稿与身份判断。开场/细读写新的 `coc.module-graph-shard.v4` 草稿：模型负责 `nodes, claims, node_refs, coverage, dependencies`，沿用现有节点/关系/真假/可见性词表；模块、任务、版本等机器字段由宿主补齐。`dependencies` 是尚需查阅的 `{focus, question, pages?}`，被当前可玩内容依赖的项不能留 unresolved 后发布为 ready。`coverage` 的判断针对当前任务范围。

节点和 claim 的 `evidence_span_ids` 改为 `source_refs: [{page, box?}]`，这里 `page` 是翻页工具给模型的从 1 起的物理页号。宿主转换为现有运行时 `source_refs: [{source_id, pdf_index, box?}]`，来源 id 与摘要由机器关联。模型不能自造文字 span 或把看图转写当作独立校验源。读者分片版本与已保存运行时图的版本分开，现有图与资产的读取无需批量升级。

读者复用已登记实体标识；一个事实可引多页，一页可支持多条事实。重复同值合并来源，不同值必须保留双方来源并解决冲突；禁止按“最后写入”静默覆盖，禁止把已发布真相改成玩家在本局碰到的状态。

原书的不同开场、可选章节与不同玩法版本属于带适用条件的作者材料，不得把互斥数值或分支并成无条件事实。沿用现有图谱字段与词表表达，当前验收只使用已支持的 CoC7 规则，不在阅读替换中增加 Pulp 等规则族。

开场与细读产出中将进入可玩范围的数值、检定/线索条件、因果关系、身份及事实/谎言区别，必须经过同一种带工具读者的新会话复核。新会话独立打开原页，写 `{checked: [{path, verdict: "supported"|"contradicted"|"unclear", source_refs, reason}], missing}`；`path` 指向候选字段。机器能枚举的数值字段必须逐项有结果；其余关键内容由抽取与复核者声明，并由真桌原页核对评估漏项，不能声称已被程序穷尽。

`supported` 是模型判断，不是确定性证明。`contradicted/unclear` 或缺少必要复核阻止受影响范围变为 ready，其他不受影响的已发布范围仍可玩。修正后重新检查受影响项，不把失败改写成警告后强行安装。

`module.read.finish` 是唯一发布入口：核对来源引用、结构、复核报告与依赖，合并进当前模组图，更新素材就绪信息，最后原子切换 generation。图、就绪信息与 generation 属于同一次发布；写入中断保留上一有效代。重放同一已完成 job 返回原结果，不再发布或再次收费。`base_generation` 过时须重新合并检查，冲突返回 `needs_choice`，不能覆盖当前代。

结构门继续检查语义 id、闭合词表、引用目标、作者/玩家可见性和玩法关系。局部就绪判定只要求本次可玩范围及其依赖成立；全书未细读页不导致全图失败，也不被标为 absent。跨向未准备区域的名字可以留在索引，但不能因为有一个名字就执行该处的作者规则。

### 22.4 七动词与等待

Keeper 工具总数仍是七个。`lookup {kind: "module", query}` 查现有图；`lookup {kind: "source", query, question?, retry?: boolean}` 明确请求核对原 PDF。source 由扩展编排阅读服务，完成后转为内核的 module 查询；Python RPC 不阻塞等待模型。普通查询误带 question 不启动读者，并明确说明返回的是图谱资料。这个区分来自真桌中普通行军问题意外启动原文阅读的反馈。

已准备的手卡由 `apply {effects: [{kind: "handout", name, label?}]}` 交付，`name` 必填。工具描述必须把它列为已实现效果：宿主交付登记的原页裁剪，不要求 Keeper 先逐字转写。需要理解内容时先查现有图；原文重读只服务新增问题，不是交付现有图片的前提。

`table.resolve` 与 `table.apply` 在 RNG、状态、收据、幂等成功记录之前检查本次使用的图谱材料。目的地/实体已定位但尚未准备，或动作显式依赖未核实字段时返回 `needs`，带 `details.reason: "material_pending"`、`details.read: {purpose: "detail", focus, question}` 与英文 `fix`，该批写入和 RNG 均不变。完全没有任何索引或图谱匹配时返回 `unknown_entity`，不能按语义关键词编造一个读取目标。

扩展对 `material_pending` 发一次前台读取请求并等待；前台读取允许在 `turnInFlight` 期间启动，不能等 `agent_settled`，否则形成死锁。等待期间不得占住内核 RPC 串行锁。发布后刷新图代际，用原始参数与原 `call_id` 重新校验并执行一次；失败的前置检查不能占用该 `call_id`。之前已经成功的调用照旧幂等重放。

只重试缺资料的整批动作，不重跑该回合此前已落收据的动作。发布不改写旧收据、已交付正文或世界状态。可用新图补充资料，但冲突不能暗中改变已经裁定的事实。

沿用有界读者超时；前台等待的总时限初值 120 秒，超时返回 `needs` 与 `details.reason: "reading_timeout"`，任务进度保留。超时不是一次新的阅读请求，也不是自动再次执行动作。原玩家输入与已完成收据保留；对同一目标再次 `lookup` 只加入已有任务继续等待，不重复起读者。Pi 的工具取消信号取消本调用拥有的前台阅读，宿主结束该读者及其工具子进程后用 `module.read.finish` 记 cancelled；共享任务只解除当前等待，不杀另一调用仍需要的任务。失败后 `lookup retry:true` 明确重试。取消不回滚此前成功的游戏动作，也不自动重发玩家输入或让 Keeper 补写未知情节。实际等待分布由验收记录决定是否调整此值。

成功的读取结果通过原工具调用返回，不在桌外偷偷触发一个新的 Keeper 回合。背景预读仅在空闲时启动；素材就绪后进入后续胶囊，不自行叙事。

合并 §16.3 的结构化交互后，阅读等待说明放在 ask 的 prompt/options JSON 中，不进入正文。若 Keeper 只输出等待散文，宿主丢弃该草稿，并沿已有单次修正机制要求显式 ask；不得合成空选项调用。

### 22.5 开场、失败与旧数据

setup 用 `prepare-module` 替换 `build-bundle/bind-source/build-opening` 的外部编排。输入真实 `pdf` 或既有 `module`，执行来源登记、定位、开场准备；调查员流程保持原职责。多开场选择沿用 `module.opening.choose`；候选来自已读原书，等待不能解决选择。源语言由读者判断，玩家语言继续使用 `play_language`。

开场 ready 需要：有效且明确的入口；当前人物、互动、线索条件及必要规则数值有材料；影响开场的全局真相与跨页依赖已读；关键事实复核完成；未解决的问题不会改变这些内容。结构检查加读者依赖声明共同决定，不使用节点数量/读页比例作为替代。

沿用 `coc:module-ingest` 及其 `-progress/-done/-failed` 频道接入宿主。进度统一为 `{module_id?, stage: "source"|"index"|"read"|"verify", page?, of?, focus?}`；`-done` 表示开场可用，不表示全书精读完成。新路径不再发旧 build 专属频道，命令与 setup 调用同一个宿主阅读服务。当前不新增任何 Electron IPC 或 UI。

RPC 顶层错误枚举沿用 §1；具体原因放在 `details.reason`：`bad_pdf, vision_required, unreadable_pages, needs_source, material_pending, reading_timeout, reading_failed`。拒绝须有英文 `fix`；候选选择给 `details.candidates`。不可读的必要页面会阻断相关范围；不相关页面可保留为缺口，但不得声称全书可玩性已验证。

旧图谱、资产、campaign 与回合证据继续可读。无原 PDF 的旧模块可玩已有内容，新细读返回 `needs_source`；摘要匹配后可建立新阅读索引，绝不把旧全书“已接受”标记冒充视觉验证。旧资料包不再接受新的生产导入，不保留 OCR fallback。退役执行清单和删除后的验证以规格为准。

### 22.6 实施决定与证据

- 实施中的内部形状：视觉模组把图和 manifest 写入不可变的代际目录，`module.json.graph_file` 指向完整的一代；ModuleStore 通过该指针读取，最后一次原子 metadata 写同时发布就绪信息与 generation。旧模组没有指针时继续读原位置。
- 读者定位草稿的页范围与翻页工具一致从 1 起，发布到阅读索引时由内核转为从 0 起；定位按至多 12 页的任务批次推进，所有页都实际浏览后才 `index_complete`。同一队列与读者执行形状不变。
- `module.read.claim` 内部返回本次 `lease`；`module.read.finish` 必须带同一 lease。认领锁由内核进程持有，崩溃后 OS 释放；重新认领使用新 attempt 目录与新 lease，旧读者即使迟到也不能发布。这两个字段不交模型填写。
- 视觉分片补两个显式字段：`ready_nodes` 声明本次真正准备好的实体，避免把仅有名字的邻接节点也判 ready；`critical` 给本次关键事实的 JSON pointer。内核合并机器可枚举的数值字段与 claim 的复核义务。元数据内同次发布保存完成任务的结果，用于进程在发布后、队列更新前崩溃时幂等恢复。
- 扩展之间用一条内部 `coc:reading-bridge` 共享 `{prepare, ensure}` 阅读服务闭包；终端命令与 setup 不再编排 build 的多条请求/回复频道。该闭包只在宿主进程内，不成为模型工具或 Electron 接口。
- 运行时投影沿用既有形状：NPC 数值写 `properties.mechanics.profile`，其中 characteristics、derived、skills 与现有 starter 一致；不能把数值只放在未被计算层读取的 stats 字典里。`record_of` 对没有旧 record 的节点读取其直接 properties，旧 record 保持优先；生成场景 record 时保留作者字段。该变化连接既有消费路径，不扩展规则引擎。
- 同一请求恢复时，新 attempt 可带入上次草稿；只有宿主记录的成功抽取检查点与草稿摘要相符时才跳过抽取、继续独立复核。新问题使用新请求，不继承旧草稿。复核前后核对草稿摘要，复核者改动草稿则拒绝；模型/传输故障重试复核，语义复核失败则带具体 findings 回到抽取修正。
- 手卡/地图用 `properties.image_sources: [{page, box?}]` 显式声明可揭示区域；引用页不自动成为玩家图片。宿主在复核后渲染这些区域，并通过 finish 的内部 `assets` 载荷交付文件与摘要；内核核对并写入同代资产登记。多区域按顺序拼为一张图片，沿用已有 20 MiB 限制；图与资产登记随同一个 metadata 指针发布。坐标是来源定位，不按作者数值进行逐项复核。
- 复核结果允许单条 `path` 或同来源同结论的 `paths: [pointer, ...]`。每个 required_review 字段仍须显式列出，程序逐一核对；仅合并重复的来源和理由，不用父对象自动覆盖未列出的数字。真实短本近 200 条复核义务暴露了重复输出成本，此形状减少文书量而不删核对项。
- 同一请求的修正读取可以沿用成功抽取检查点中未改变节点/claim 的图片阅读证据；按语义 id 与规范 JSON 比较记录，新增或改变记录的引用页必须在修正会话重新看过。独立复核仍用本次复核会话自己的图片证据，不能用旧阅读代替复核。
- 真入口开场发现：图谱 era 为公元 80 年，守秘人却说 210 年；turn 0 没有玩家输入胶囊，而 look 只含 where/present。开场 look 因此复用已有 fitted_module_section，把时代、设定与全局简报一起交给守秘人；不另造简报格式，也不修改旧叙述记录。
- 真桌按需读取发现：一次等待超时后，KP 换 query 又排入同义问题，玩家回合超过 300 秒。扩展在本轮首次 reading_timeout 后只允许 ask 交还控制权；新的 player_input 才清除此等待状态。纯文本退回同样经既有隐式交付路径关闭为 ask，不能隐式 narrate 冒充已读取结果。
- 前台等待只等所请求的材料 ready，不等待整条队列清空。队列处理继续独立运行，避免排在后面的预读或其他请求拖住已经完成的前台结果。跨扩展错误用结构判断保留 code/fix/details，不能用构造器实例身份丢失修正说明。
- 长本真实请求曾累计约 39 MiB 页图并报 413。读者保留 `--no-extensions` 禁止自动加载，但显式加载仅含 context hook 的 reader-context；它不注册工具、不起内核。每次请求只保留最近至多四张、合计约 8 MiB 的页图，始终保留最新图；其他文本和工具配对不改。被省略且尚未送入上下文的图明确提示重新 read，宿主只把 context 日志中真正保留的图计入阅读证据，不把单纯渲染或被省略的图记作读过。
- 长本开场已触及旧单 section 读者的 15 分钟上限。统一读者每阶段上限改为 60 分钟，仍可配置；玩家前台等待仍为 120 秒，届时交还控制权。任务上限不代表响应时间承诺。
- 阅读索引同样经 metadata 指针原子发布：累积索引写入本次 attempt 的 index.json，随后 module.json.index_file 与 viewed_pages 一起提交。崩溃留下未发布文件，不把索引追加两遍；没有指针的既有模块仍读 sections.json。
- 冷场景补读必须同步已有运行时 record 的新增作者字段，否则图上有新材料而守秘人仍看到旧薄场景。保持既有 record 字段，加入经过复核的直接 properties，最后重放开场选择。已发布材料就绪检查先于原 PDF 可用性检查；仅新的阅读工作需要原文件。
- 视觉资产按节点身份复用，不按同页猜配。显式 image_sources 渲染出的新区域路径优先；已有登记路径保持原样，不能再次加 bundle/ 前缀。同页多个手卡或 Keeper 图不会互相继承文件或可见性。
- 用相同摘要的原文件修复本地来源时，既可补回缺失文件，也可先保留损坏副本再恢复正确字节。修复持有模组 metadata 锁并重读当前元数据，避免覆盖同期发布的 generation；原始读取、损坏文件和发布证据不删除。
- ModuleStore 的视觉图写入统一生成图、manifest 与资产登记，包括开场选择所产生的新一代；调用者不能漏掉其中一件。已知节点简报携带原 summary，让后续读者可保留已接受文字，不因看不到旧值而无谓重写。
- lookup kind=source 不带 question 时准备缺失材料或加入既有任务；只有显式非空 question 才要求已知实体重新核对原文。等待错误带 details.read 的原 focus/question，Keeper 可重试原动作或原样加入等待。宿主不能给空 question 自动补出新问题，否则普通场景准备会被排成两项任务。
- 长本真实补读确认：尚未 ready 的导航节点，其 summary 可以在该节点通过独立复核、首次成为 ready 时被完整摘要替代；它不是已经交付游玩的正式材料。节点身份与已有结构化事实仍执行冲突检查，已 ready 节点的 summary 也保持稳定。读者简报逐节点标注 ready；本地检查先比对已知字段，避免把可发现的合并冲突留到昂贵复核之后。来源摘要不混入解析状态或 TODO。
- 队列中没有新问题的准备请求，若已被前一任务发布的材料满足，认领时直接记录 reused_generation 并完成，不再起读者或另发一代图。明确的新问题仍须读取。草稿和复核均要求边看当前页边写各自文件，避免图片历史收缩后凭记忆一次写完整材料；不新增转写中间层。
- 简报也提供既有 claims 的语义字段，供读者保留原有理由和条件；模型不必抄旧 claim id。未显式给 id、且端点与谓词唯一匹配既有 claim 时，宿主复用其身份。新断言用不同语义 id。检查阶段先发现已有字段的冲突；补来源不会生成一条同义旧关系，亦不会改写已接受的理由。
- 开场候选附带源图的 summary，建卡助手按真实简报选，不从内部 handle 猜任务。选定开场只收窄当前默认入口；作者声明的其他入口保留为候选，后续新战役仍可另选。此前只有根级入口列表的图在选择时将该作者声明同时保留到既有 is_entrance 字段。
- PDF 与已读 module 共用 prepare-module；单开场已读书只确认就绪，多开场则必须在本次准备显式选择，不能把另一战役留下的默认开场静默套用。module.status 提供当前 authored opening_candidates 及其摘要。旧已读书的开场选择只调整已发布图，不依赖旧分片重组。
- 当前场景的 where 投影携带源图 summary，普通实体 lookup 返回作者 properties（排除 runtime_projection 与宿主 asset_ref）。精细内容必须能从已发布图取回；不能在投影时丢掉后又要求重读原 PDF。完整作者字段按需 lookup，胶囊仍采用原有预算。

- 2026-09-07：目标契约与规格落地。运行时仍执行旧 §14/§20 流程；本节所有实现、真实 PDF、真桌及退役验收均未完成。
- 2026-09-07：原书抽读补充物理页定位、作者版本区别与单文件长本的验收样本；父规格为 GitHub #34。抽读不计视觉构图或真桌通过。
- 每个切片完成后在此记录实际提交、测试退出码、来源/玩测证据路径与未通过的门；不把未来行为改写成已实现。

- 2026-09-07（实现与本分支验收）：旧生产入口已在 `cbdab504` 退役。20 页来源跑完一次真实任务；Cold Harvest 多开场选择、原图手卡交付与正常暂停已核对；338 页长本的冷场景读取后行动只结算一次，退役后恢复保持同一场景与 510 分钟。吸收 `40dae53d` 后内核 1035 passed / 1 skipped、扩展 106 passed，退出码均为 0。实际路径、失败记录、未发布的下一场景与合回主工作区的并行冲突见 §22 规格实施记录；前端验收不计入本次。

- 2026-09-07（整合到 0.9.0a）：用户授权先提交并行前端工作 `ffb6361a` 再合并视觉分支。保留 §16.3 的系统 JSON 约定；阅读等待交互与普通故事分离。内核 1038、扩展 106、前端相关测试 107 项通过；源码构建通过。原件与真桌证据保留，详细记录见 §22 规格。

### 22.9. Early character guidance and background opening (2026-09-08)

`module.read.request` additionally accepts purpose `guidance`, `play_language`
(`zh-Hans` or `en`) and host-owned `guidance_key`. The key binds source bytes,
selected opening, language, occupation catalog and reader/reviewer versions;
it does not depend on the complete graph generation. The reader receives the
catalog as `occupations`. Guidance is a small source shard with empty
`ready_nodes`, plus `guidance.json` containing `opening`, `advice`, `scene`,
`guide`, `handoff`. All five are bounded strings, guide may be empty. One fresh
tool-enabled reviewer checks all shard records and player-safe guidance together.
The host binds its approval to the exact SHA-256 of both files in `review.json`.
The kernel checks both digests, graph references and review acceptance before
publishing the graph and an accepted guidance pointer under the module metadata
lock. Interrupted publication leaves evidence, never an accepted partial pair.

`module.read.request` for opening respects an explicit focus. Readiness is checked
against that scene, including independently prepared material, rather than another
session's default opening. `campaign.create` accepts optional `start_scene` and
`guidance_key`, pins both, and allows setup from accepted guidance. Draft, preview,
confirmation and prologue remain valid while opening preparation runs. Only
`setup.complete` gates play; it initializes the latest accepted opening world once
both the confirmed card and the campaign's selected scene are ready.

The onboarding host retains guidance and opening phases on the same durable import.
Long children are keyed by phase and attempt; callbacks patch the current job only
when their attempt still owns the phase. Converse is a short independent operation.
Browser connections borrow an application-owned onboarding host; disconnecting
unsubscribes without cancelling work. Application shutdown persists paused work.
Frontend status omits internal guidance prose and paths. A session-bound Workbench
overlay shares status polling with onboarding and stays visible during setup.

The accepted public opening is delivered once, directly, and recorded through
`setup.prologue`. The setup agent handles the player's answer without rewriting
that opening. Confirmed characters waiting for source readiness retain their
confirmation. An internal readiness notification retries the existing completion
gate after the active setup turn ends; no synthetic player message is added.

Listed starters ship independently reviewed `character-guidance/<play_language>.json`
artifacts with their graph. Each artifact binds module ID, graph SHA-256, language
and guidance fingerprint. Registration installs and indexes these artifacts even
when the graph generation is already current. Selection returns that fingerprint
as `guidance_key`; campaign creation pins it and setup loads the accepted opening
directly. A listed starter with missing or stale guidance fails preparation instead
of silently starting an author/reviewer job. Only the offline bundle builder may
generate its replacement. Existing campaign evidence and reader attempts remain.
Graph guidance keys canonicalize default, scene name, node ID and scene handle to
one node ID, and bind the full graph plus the two guidance prompts and occupations.
PDF guidance retains its source-file binding and existing publication pipeline.
Release preparation uses `node scripts/build-starter-guidance.ts <module-id>
<evidence-home>` from the repository root, with the repository-local Pi home.
The builder runs the existing tool-enabled author and independent reviewer for
each supported language and retains their inputs, drafts and reviews in the
evidence home. It writes only accepted player openings and private setup advice
into the starter bundle; selection never invokes this builder.

Implementation decisions: reuse the current queue, graph, guidance cache, setup
receipts and RPC setup-to-play switch. No OCR, global page scan, second graph,
global scheduler, detached daemon or new rules arithmetic. Full design and
acceptance milestones: `docs/specs/fast-guided-pdf-onboarding.md`.

Browser finding: authored `era` may be prose spanning several years. It must not
be interpreted with string matching or overwritten to satisfy a finance table.
`setup.draft.profile.era` therefore accepts an existing `cash-assets.periods` key.
When omitted and the authored value is not already a supported key, the kernel
returns the source description and closed supported options; the setup agent
chooses semantically and retries. Chargen arithmetic is unchanged. Entrance-specific
`investigator_setup.era` takes precedence over book-wide era for that campaign.

Pi 0.85.1's idle `ctx.shutdown()` only sets a pending flag. After the idle handoff
handler returns, the frontend uses the existing onboarding start operation to
send a read-only `get_state` RPC, allowing Pi to drain that flag and exit normally.
The existing wrapper then switches setup to play. A committed handoff in
`ready_for_table` remains resumable until table.open makes it active; it is not
projected as already playing. No Pi fork, signal protocol or synthetic turn is used.

The existing `draft-presentation` frontend invoke returns `{pending:true}` while
its application-owned presentation job runs, then the existing `{play_language,
texts}` projection. The renderer polls the same revision and acknowledges preview
only after that projection is displayed. This keeps model work outside the Web
transport's 30-second request window. Immutable draft results are shared in the
existing presentation map; standing-sheet queries still refresh their visible
context. The tool-enabled presentation agent runs the shared schema checker and
gets one bounded repair for malformed output, retaining both original attempts.

### Kernel decision: a drawn card is not re-earned (2026-09-09)

The saved `setup/presentations/<revision>-<language>.json` projection travels with
the `coc-character-draft` history row, as every other player-facing projection
already does. The renderer fetch is the path for a draft that has no projection
yet, not the path for every mount: without it a scroll, a session switch, the
setup-to-play handoff and a restart each redrew the loading placeholder on a card
whose text had been on disk for hours. The job also starts when the draft is
appended rather than when its card mounts, and is handed the glossary the row
already carries, so it makes no campaign-scoped read and never queues behind the
turn that produced it. A presentation run is bounded; past its deadline the card
reports a failure it can offer a retry for instead of staying pending forever.

Card text is projected from one accumulating per-language vocabulary rather than
a per-character fingerprint. A card's strings are overwhelmingly the previous
card's strings — UI chrome, characteristic and skill names, era, occupation — so
fingerprinting the whole list made every new investigator a complete miss that
paid for a fresh translation of the entire card before it could be drawn. The
vocabulary is keyed by play language and the instruction digest; the financial
equipment subset is keyed by the kit. Kernel glossary labels are context for the
agent and never a question put to it. A round is accepted in part: the words that
validated are kept and only the remainder is asked again, because one dropped key
used to discard every correct translation in the round and, with two rounds, turn
a near miss into a card that never appeared. `validatePresentation` keeps its
all-or-nothing schema for the agent's own checker, which the card is still drawn
under.

### Kernel decision: a contended campaign says so (2026-09-09)

`guardCampaign` waits for the per-campaign advisory lock against a deadline
(`PI_COC_CAMPAIGN_LOCK_TIMEOUT_MS`, 25s) instead of blocking without one, and
refuses with `internal` + `details.reason = "campaign_locked"`, the campaign name
and a `fix`. The deadline is below the RPC transport's own 30-second timeout on
purpose: an unbounded wait was reported to the caller as a dead transport, with
nothing in it that said another process held the campaign. Both kernels bound the
wait identically. No error code is added and no method changes.

The awaited retry timer keeps the TypeScript process alive until the lease is
acquired or the deadline returns its refusal, even when no other event-loop
handle is active. The bounded wait must not disappear as an unresolved promise.

Both normal and idle setup completion emit the existing `coc-setup-exit` marker.
The backend uses it to recognize the play child's startup within the same RPC
wrapper. Pi may start its extension-owned opening before the RPC subscription
exists; the first observed assistant message after that marker establishes a new
normal turn epoch even though the wrapper already hosted a completed setup turn.

## 23. PipiCOC local frontend (2026-09-07)

The copied `Electron/` workspace is a frontend owned by this branch. Its only
Keeper process is `bin/pi-coc` in RPC mode, reached through `pipicoc/rpc`.
It does not launch an embedded Pi or carry another Python kernel. The six
canonical COC extensions plus the DeepSeek Extended provider
(`extensions/deepseek/agent/index.js`) are explicitly mounted once; the UI
pack adds only the investigator sheet. Host coding prompts and tool mounts do not reach the Keeper.
`pipicoc/dev [setup] [--campaign <name>]` selects the canonical launcher mode.
The UI owns its transport session file; `PI_COC_HOME` owns campaign/module data,
and the repository-local `.pi/coc-agent` remains the model/auth home.
Setup and play run in separate application launches; completing setup exits its
agent as in the terminal launcher. The next play launch selects the ready table.
This change does not implement the visual PDF target in §22.

### Kernel decision: read-only sheet

`table.view {campaign}` returns the current turn/state, scene, clock, present
NPC display names, investigator projections, discovered clues, active subsystem
and pending choice. It reuses existing projections without touching the turn,
rolling dice or committing. It exposes no undiscovered clues or Keeper notes.
The panel must never call `table.look`, which is a Keeper action.

### Kernel decision: no machine handle reaches the player (2026-09-07)

A projection the player reads carries the name that player would use, in the
campaign's `play_language`. Canonical English rules names and kebab handles are
the machine's vocabulary and stop at the projection boundary. Three player
surfaces were showing handles because the projection had nothing else to give.

`table.view.labels` maps canonical characteristic abbreviations, their full names (a
characteristic check is filed under "Appearance", not "APP"), and skill names to the rules
data's own `localized_labels` for this campaign's `play_language`.
It is empty for `en`, whose canonical names already are the player's, and it
carries only terms that language actually renames. The glossary is read from the
rules tables; §16.1 forbids one written in code, and a name the data does not
localize stays canonical rather than being invented here.

`table.view.clues.discovered` carries `{clue, label}` rather than a bare handle.
The label is the name the Keeper gave the clue when `apply clue` discovered it,
kept in `world.clue_labels` exactly as a scene's name is kept in
`world.scene_labels`, and it falls back to the graph's display name for a clue
discovered before that field existed. The handle stays as `clue`, so a consumer
can still key on identity. A row also carries `summary` when the clue's module
node authors one -- the player panel unfolds the clue into exactly that text,
so what a clue says is one tap away instead of nowhere. Undiscovered clues
remain absent.

A `roll` or `dice` receipt carries `actor_label` for an investigator as it
already did for an NPC: the sheet's own name. The §16.2 projection copies it, so
a mechanics card names whoever rolled instead of printing `inv-1`. Fact
sentences already preferred `actor_label`, and now get it for the whole table.

Both label maps survive a worldline merge (§15.6) by the same union the scene
labels always used: a name is not a claim two lines can disagree about.

### Host decision: a clue's words reach the player in the play language (2026-09-09)

A zh-Hans table unfolded 血泊 into "Corbitt can form pools of blood on floor,
ceiling, or walls to frighten intruders away from his secret." The row's `summary`
is the module's own text, written by the reader in the language the book was read
in, and the row's `label` falls back to the graph's display name for a clue the
Keeper never renamed. Neither is the kernel's to rewrite (§16: the kernel writes
English and the module graph is the author's fact), and neither gets a hand-written
translation in the panel. They travel the same leg as standing names and possession
words: the tool-enabled presenter that projects the card.

`clueTexts(view)` collects, from `table.view.clues.discovered` (and any `here` row
marked `discovered`), each row's `label` and `summary`. The handle never enters,
and an unfound clue the scene offers is not on the sheet and is not asked. A label
the Keeper wrote in the play language is asked once and comes back as itself, as a
renamed scene's name does; the row does not say which word is whose, and guessing
by script is the detector §16 forbids. The projection is saved as
`setup/presentations/clues-<language>.json` beside the standing and possession
files and grows with the campaign: what the file lacks is asked, what it has is
kept, so a clue's text costs one question per language.

On every sheet read the host merges each growing lane's file under the kernel
glossary (`labels = {...lane.texts, ...labels}`, the glossary winning) and compares
the sheet's current words against it; a word the file lacks starts one background
run for that lane, keyed by lane and missing set, with the same `sheet_changed`
refresh and retry rules the possession lane has (§26). The panel reads a clue's
name and its body through the same `labels` lookup as everything else on the sheet.

### Host decision: languages and UI words are data (2026-09-09)

An audit found the language set and the product's own captions written into code
in five places each: `['zh-Hans','en']` in nine files, `zh-Hans` as a default in a
dozen, a CJK regex that only obliges one tag, four separate two-column word tables
in the pack renderers, one renderer with no table (`preparation.js`, all English)
and one with a single hardcoded language (`CocOnboarding.tsx`, all Chinese under
an `en` option), hand-written translations of Mod names and of six mechanics
option words, and host error prose rendered to the player. The user's ruling: no
detection by script, no table in code; every player-visible word travels the
play language by mechanism, and adding a language must not touch code.

**`content/languages.json`** is the closed set of play languages: `default` (the
tag a host or kernel falls back to when a campaign or session carries none),
and per tag an `autonym` (for a picker) and an optional `script` class the
delivery guard obliges (`cjk` today). The kernel validates `play_language`
against this file, takes its default from it, and applies the script obligation
by class; `kernel-ts/write/text.ts` owns the closed table of script classes to
character ranges, and nothing else in code names a tag. Loops over bundled
per-language files (starter guidance, listings) iterate this file.

**`content/ui/<tag>/<surface>.json`** holds one surface's captions per language:
`sheet`, `paper`, `mechanics`, `choices`, `mods`, `preparation`, `onboarding`,
`transcript`, `errors`, `extension`. Keys are stable identifiers, values are the
words. `runtime/ui-words.ts` (`loadUiWords(contentRoot, tag)`) merges the
surfaces into `{tag, words: {surface: {key: word}}}`, an unknown tag reading as
the default and a missing key filling from the default language. The guard test
pins every shipped language to the default's surfaces and keys, so that fallback
is a net, not a delivery.

**Hosts attach `ui`.** Every answer a renderer draws from carries
`ui: {tag, words}` for the session's play language, or the default when the
session has none: the `sheet` answer (bound, unbound and failed alike), `mods.*`
answers, onboarding and preparation snapshots, and the `details` of
`coc-mechanics` and `coc-choice` entries. Both hosts do it: the Electron backend
where it serves `coc-keeper` invokes itself, and `pipicoc/sheet.ts` /
`pipicoc/mods.ts` where the extension serves them. A renderer reads
`ui.words.<surface>.<key>`; before its first answer it draws no words (an
ellipsis, never a language); a missing key renders as the key, which is an
identifier and a visible gap, never as a word from another language. The
renderers keep no `LABELS`, `WORDS`, `PAPER_WORDS` or `zh ? … : …`; the §16.1
exception for a chrome table in `panel.js` is withdrawn, the table is data now.

**Errors carry codes.** A host failure a renderer shows is `{code, message}`;
the renderer shows `ui.words.errors[code]`, or `errors.unknown` when the code
has no word, and keeps `message` (English, for the log) behind a fold captioned
`errors.details`. Codes in use: `runtime_unavailable`, `campaign_unbound`,
`document_unavailable`, `invalid_params`, `stale_choice`, `no_session`,
`pack_unreachable`, `pack_silent`, `table_not_open`, `campaign_not_open`,
`preparation_paused`, `preparation_failed`, `upload_too_large`,
`model_without_images`, `unknown_import`, `import_other_session`,
`operation_in_progress`, `upload_chunk_invalid`, `upload_size_mismatch`,
`upload_incomplete`, `upload_retry`, `guidance_not_ready`, `guidance_unavailable`,
`opening_bound`, `preparation_pause_first`, `scenario_not_ready`,
`name_and_occupation_required`, `unknown_action`, `presentation_timeout`,
`interrupted`, `kernel_error`. Extensions that notify through `ctx.ui` read the
`extension` surface for the campaign's language.

**The glossary is generic.** `table.view.labels` is the union of every
`localized_labels` row in `content/rulesets/coc7/rules-json/*.json` for the
campaign's tag, whatever file it sits in; no abbreviation whitelist, no `en`
shortcut (a language whose canonical words are the keys simply has no rows). The
kernel's own closed player-visible words -- object `condition` values, object
`category`, document `presentation`, session `kind`, turn `state`, `day_part`,
resource names (`hp`, `mp`, `san`, `luck`, `cash`), backstory field names, the
engine's die captions (`SAN Loss`, `SAN Reward`, `damage`, `armor`,
`object-effect`), difficulty and success levels, eras and occupation names --
get `localized_labels` rows in the rules data (`kernel-terms.json` for those the
rules files do not already hold), so the panel's `term()` finds them. The
mechanics entry's `labels` are that glossary merged under the campaign's growing
lanes (`standing`, `possessions`, `clues`), attached by the host when it loads
history, so the mechanics card reads the same words as the sheet; the renderer
routes every content field through `term()` (clue name and summary, item and
owner names, scene names, currency, session outcome, worldline and handout
names, die captions).

**Kernel prose never reaches a player field.** `normalizeText` keeps every
script's letters and digits (`\p{L}\p{N}`), so markers, ids and alias
resolution work for kana, hangul, Cyrillic and Arabic as they do for Han.
`apply clue` without a `label` files the graph's display name on the receipt,
not the handle. Revealing an echo requires a `label` (`invalid_params` naming
it), because an echo's summary is the kernel's own sentence. A chase session
carries the campaign's language, not a constant. The rules catalogue's
`localized_name` becomes `localized_names` keyed by tag. Tool descriptions for
`ask` (`prompt`, `options`, `text`), `define.name` / `description`,
`object.name` and `document.text` say "in the campaign's play_language" as
`narrate` does; a Mod's `name` and `description` in `mod.json` are objects keyed
by tag, the panel reads the session's, and no renderer names a Mod.

**Guard.** `tests/extension/system-language.test.mjs` scans `pipicoc/*.js`,
`Electron/packages/ui/src` and `Electron/packages/pi-backend/src` (non-test)
for CJK as it scans `extensions/` and `kernel-ts/`, and
`tests/extension/ui-words.test.mjs` pins every language directory to the
default's key set; `content/ui/**` and `content/languages.json` are data and
are not scanned.

**What landed on the extension side, and where it departs from the paragraphs
above.** The extensions read `content/ui/<tag>/extension.json` through
`extensions/ui/words.ts`, which resolves the content root the way
`runtime/host.ts` does (`PI_COC_CONTENT_ROOT`, else `content/` beside the
resource root): a relocated content bundle must therefore carry
`languages.json` and `ui/<tag>/` as it already carries `starters/` and
`rulesets/`. Three departures:

- The kernel's own stderr on the `coc-kernel` status line
  (`extensions/kernel/index.ts`) stays English and keeps no key on the surface.
  It is a log, not a caption; a play-language frame around an English stack
  trace would only read as a product line that failed to translate.
- `progressLine` and `instructionFor` in `extensions/onboarding/steps.ts` are
  read by the model, so they stay English. The status line and the "setup
  opened" notice draw the same counts through the surface instead
  (`progressCounts`), and the setup notice no longer repeats the step's
  model-facing instruction sentence at the player.
- `guide` in `content/setup/character-guidance.md` is bound to the source's own
  name, not to `play_language`: `setup.prologue` resolves it against the module
  graph (`kernel-ts/setup/drafts.ts`, `graph.npc(guide)`), so a translated
  spelling refuses the whole prologue. The prompt and its reviewer now say so,
  where before the field was unbound. Giving the *player* a play-language guide
  name is a kernel change -- store `graph.displayName(npc)` beside the resolved
  handle, as `scene` is already normalised -- plus the presentation projection
  that already renders scene names; until then the Keeper renders the name in
  the prose, as it does every other graph name.

### Host decision: RPC adapter

The adapter preserves transport/session/model options, removes host persona and
tool-selection arguments, and permits only the UI invoke bridge and sheet mount.
It then explicitly loads the canonical six extensions with discovery disabled.
No `~/.pi` or shared credential profile is linked. The frontend reads the same
local model catalog as the canonical launcher. Copied upstream build artifacts,
embedded runtimes and user state are excluded.

The copied host uses a first-message session label only. Model-based title
refinement is removed: it would otherwise start a second Keeper through the same
launcher. Shutdown signals the owned process group, including reader children.

### Web and local App delivery (2026-09-07)

The Web server uses the same repository launcher, model/auth home, UI pack and
separate setup/play session roots as Electron. Browser acceptance uses a real
Keeper with the main session as player, as explicitly requested for this slice.
The local App embeds only the frontend. A packaged `pi-coc-runtime.json` points
to the canonical checkout and installed Node executable; the checkout and its
Python/Pi dependencies must remain available. No credentials enter the bundle.
The build artifact is `build/PipiCOC.app`; the installed App is `/Applications/PipiCOC.app`.
Keeper, preparation workers and cold UI kernel reads share the resolved command
environment, including the packaged tool PATH. Finder launches must not depend
on an interactive shell environment. This remains a local development package.

The frontend's `text` stream event accepts `replace: true` for an authoritative
final message that differs from its streamed draft. Replacement is scoped to the
message segment and may be empty (a rejected draft); earlier segments remain.
This honors Pi's `message_end` extension rewrite rather than retaining discarded
Keeper instructions on screen. Panel and mechanics modules use the same confined
`getExtensionUiEntrySource` path as header modules; Web clients never import a
server filesystem `file://` URL.
The local frontend recognizes credentials from `auth.json` when resolving the
configured default provider. A same-named relay model must not win merely because
its key is inline in `models.json`; explicit per-session model selections remain.

### Complete player projections (2026-09-07)

`coc-mechanics` becomes a standalone Host API presentation entry with renderer
`coc-mechanics`, preserving its session entry id. Live `entry_appended` and history
use one projector; keeper-only rows are removed before reaching the frontend.
The renderer shows public mechanics only, never another copy of narration. Its
language is the campaign's `play_language`, carried on new entries and obtained
from the session binding for older entries. Delivery tool renderers are retired
from the player surface so one receipt appears once.

A `coc-session` entry persists `{campaign, home, play_language}` when the table
opens. The host uses that binding for exactly the selected UI session; it never
falls back to the most recently live session. For legacy sessions an explicit
host-owned `<session>.coc.json` binding can be installed from known launch evidence;
missing bindings remain a distinct error and are never guessed from narrative.

The sheet is read through the live bridge when available. Otherwise the host
runs only `table.view` in a short-lived canonical Python process, without Pi,
`table.open`, model calls or game writes. Per-session reads are coalesced and timed
out. Mount, session change and table-open/commit notifications trigger refresh.
The panel distinguishes loading, connection failure, no binding and an empty party;
a stale response from an earlier session cannot replace the selected session.

### Structured choices

ask accepts kind=story|mechanics (default story). Story uses prompt and authored
options in play_language. Mechanics accepts only push, spend_luck, accept, dodge,
fight_back, flee and forbids a prompt. The result includes interaction with its
pending-choice name, kind, options and play_language. The host emits coc-choice
entries rendered as controls outside narration. Clicking is checked against the
selected session's current pending choice before submitting a semantic player
action; old controls cannot affect a newer choice.

## 24. Empty-conversation scenario onboarding

The PipiCOC empty conversation offers preset, original PDF and prepared-module sources. A product-scoped `invokeExtension("coc-keeper", "onboarding", {action, ...}, {sessionId})` adapter owns upload/preparation state; it does not add a Keeper tool. An explicit selected session is required for mutations. The host validates file size/type, acknowledges bounded sequential chunks, mints file/job identities, and retains bytes beneath PI_COC_HOME/.coc/imports. Clients never choose a destination path.

Preparation runs the existing ReadingService and module.source/read protocol in a host-owned child with repository-local Pi credentials and the selected session's explicit model/thinking. Polling reads persisted progress; it must not start duplicate work. Failed/interrupted jobs retain their artifacts and can be explicitly resumed. Opening candidates expose names and an optional reader-authored player-safe introduction, never Keeper-only summaries. Progress distinguishes uploaded bytes, indexed pages, detailed reading, independent verification and opening readiness.

Character forms invoke existing campaign.create/setup.investigator/setup.complete methods and display table.view projections. Identifiers and all derived numbers belong to host/kernel. Before the first Keeper start, the host persists this UI session's campaign/home/language binding. Bound play sessions override a setup launcher mode, allowing one uninterrupted UI journey without changing other sessions. No automatic fictional turn is generated by a background source job.

The user explicitly authorizes in-app-browser acceptance for this frontend path on 2026-09-07, replacing the terminal driver only as transport. Grok 4.6 low is Keeper and visual reader; the main assistant is the sole live player. The exact Masks PDF and at least one complete authored chapter are required. Backend/fixture tests and uploaded files alone are not end-to-end evidence. See docs/specs/pipicoc-pdf-onboarding.md.

### 24.1 Superseded whole-book indexing experiment

This section records the existing experiment, rejected as an opening strategy on 2026-09-07. It must not be resumed as fast-opening acceptance. Target scheduling is defined in §22.0 and awaits sandbox validation.

The experimental whole-book navigation uses fixed physical-page batches of at most 12 pages and permits up to 40 simultaneously claimed index jobs per module across all hosts. Missing batches are queued together; repeated requests reuse the same jobs. Failed batches require explicit retry, while other independent batches may finish. Opening and detail jobs retain a single exclusive reader because their facts may overlap.

Each job has its own OS-held lease lock. Index jobs additionally hold the module reader lock shared; opening/detail hold it exclusively, preserving exclusion against older hosts. Stale ownership is reclaimed only after the relevant lock can be acquired. Releasing or replaying one job must not release a sibling's lease. The metadata lock still serializes publication. Index rows stay inside the assigned batch and the accumulated index is sorted by physical page; all 669 pages must be actually observed before index_complete. Index requests carry their own range rather than accumulated book context.

The host fills the concurrency advertised by a claim, drains owned jobs on shutdown, and reports actual active jobs to the progress UI. This changes scheduling, not image-reading, source-reference or review obligations. The initial target is 40; rate-limit and failure evidence determines any later adjustment.

### §22 implementation decision — selective source reading (2026-09-07)

Opening and question-bearing detail requests queue directly. Neither page coverage nor a navigation index is a prerequisite. The tool-enabled Pi reader first inspects native bookmarks/page labels, follows source references, and builds a small real graph containing the opening and sourced thin destinations. Explicit `index` is one selective navigation job, not a page-batch dispatcher. `index_complete` means that navigation task completed, never that every page was read; `viewed_pages` records only images actually supplied to the model.

The private host `pdf` tool returns native navigation or selected physical page images (JPEG at 2000 pixels, optional crop); it does not extract text. Every new image reaches at least one model request before history eviction. Public handout rendering remains reviewed PNG. Source and image hashes remain host metadata.

Fresh tool-enabled Pi reviewers independently inspect bounded node/claim groups with the complete candidate context, up to 40 concurrently. Each reviewer owns its numeric and critical pointers, and its source citations must have been supplied to that reviewer. The host combines reviews without dropping negative findings. A failed review returns to the reader for source-based repair. Atomic graph publication still uses the existing deterministic draft/review gates. No ready flag or review score implies all-book completeness.

Opening validation does not require an unread ending. Whole-graph validation is unchanged. NPC authored knowledge/beliefs/lies and other properties reach the existing Keeper view, with legacy claim views preserved. Facts about a person's beliefs belong in properties unless a meaningful graph assertion connects appropriate nodes; Keeper directions belong in keeper_note/keeper_notes. Published values remain protected by additive conflict checks.

Browser acceptance must start from a new source home, retain the earlier paused scan, measure actual wall time, and use Grok 4.6 low through upload, character creation and the Peru chapter. Sandbox phase sums are not upload-to-play timing.

§24 opening handoff correction: Start starts the bound Pi runtime without a synthetic player prompt. The extension's existing session_start hook owns the opening/recovery turn. Enqueuing a second "start game" prompt during that hook bypasses a fresh player-input boundary and can hit a closed turn. Browser evidence: the first Masks campaign's valid opening was followed by that rejected duplicate. It remains retained; the corrected start is tested in a fresh campaign from the prepared module.

Foreground source priority: one foreground and one background reading job may hold independent shared reader leases; publication remains serialized under the metadata lock and rechecks additive conflicts against the latest graph. A second background job cannot occupy the foreground slot. Host pumps wake when a new foreground request arrives. All source/review Pi children in one host share a 40-process permit pool; cancellation removes pending permits and drains owned children. This replaces a background read blocking the player's exact question.

Already-ready entity questions produce additive node deltas: identity, new source references and newly sourced properties, not a copy of every accepted field. Known context carries physical source citations. Independent review checks the delta and its actual question; it does not demand that unchanged accepted context be copied into the delta. This prevents old facts being mis-cited to a new question's pages and repeatedly re-extracted. Existing merge/conflict checks preserve all prior values.

NPC assertions about another NPC project the assertion's source-authored reason/statement, never the target's canonical biography or secret. Existing source claims remain intact. Self-impersonation is rejected in new drafts (aliases belong on the person) and self-ties are omitted from the Keeper's relationship view. This fixes a source-grounded human-cult belief being projected as knowledge of the target's actual supernatural identity.

Player-view correction: PipiCOC renders delivered story, user input and structured mechanics/choices. Keeper thinking, tool traces and source dossiers remain retained evidence but are not rendered in the player transcript. Streaming provisional assistant text is withheld until delivery; the ordinary waiting indicator remains. The investigator panel no longer lists canonical NPC names, which can disclose an identity before the Keeper introduces it. Other products retain their existing transcript rendering.

A detail/source lookup must contain a nonempty named focus/query. A question adds scope but does not replace the target; this keeps retries from changing their identity by filling in a missing target later. Empty requests are rejected before dispatch; they must never create a generic, reusable detail job that hides which player need was answered.

Concurrent reading additionally excludes the same normalized focus: a foreground question about a scene being prepared in the background waits for that scene's publication, then claims a fresh context. Independent targets keep the foreground slot. This avoids two readers independently rewriting the same previously-thin scene. Existing failed attempts retain all artifacts and explicit retry claims a fresh published context.

Early structure milestone: the high-level prepare service first requests `purpose: skeleton` for a new source. One tool-enabled Pi reads only navigation, overview and entry evidence, publishing the existing graph vocabulary with empty ready_nodes after independent review. This exposes authored opening choices before detailed preparation. A skeleton never sets opening_ready or material readiness. The chosen opening then uses the normal scoped read/review path. Low-level opening/detail requests still have no full-index prerequisite; existing reviewed graphs reuse their structure.

Review corrections: skeleton drafts must have exactly empty ready_nodes; no skeleton can create material readiness. Every publication derives opening_ready from both the structural opening check and a prepared start scene in accepted/current materials. NPC knowledge, beliefs and lies are append-only textual collections (a string is a singleton); additions retain old statements, while other scalar facts remain protected and semantic contradictions still fail source review. Foreground cancellation aborts only its owned job; service shutdown cancels all owned jobs. Reader and reviewer subprocesses honor the same configured timeout. Startup activity recovery must not mark unrelated idle compaction as a player turn.

## 25. Real-table defect repairs (2026-09-07)

Implementation decisions for the two-session report, items 7–21:

- Player input received while an automatic opening/recovery is streaming is held by the
  extension input hook until the agent settles. It then enters through the normal user
  prompt path, which calls `table.player_input` exactly once. Host messages never become
  player inputs. Opening instructions explicitly carry `play_language`.
- An opening may close with `ask` when it needs a story choice; the question and options
  belong to interaction JSON. Opening `ask` has the same turn-zero permission as `narrate`.
- `narrate` and `ask` return `labels` from the existing player glossary. The extension
  carries them unchanged through `coc-mechanics` and `coc:mechanics`; the frontend puts
  them in renderer details. No separate translation table is introduced.
- Unbound story choices use an ASCII host ordinal, never the player's question, for
  their machine identity. Bindings remain semantic references supplied by the kernel.
- The system-language guard includes the agent-side `pipicoc/agent.ts`, `sheet.ts`, and
  `host-bridge.ts` sources. Player renderer assets remain outside that agent-side scope.

- Combat maneuver binds its weapon on the host side only; it does not fill an
  undeclared semantic weapon slot. A live chase projects its pending decision's
  intent (move/combat) while preserving the player's original intent in receipts.
- `resolve.action.defense` with an explicit attack, target, and weapon describes a
  non-resisting target when set to `none`. It must not be routed as a defense of a
  nonexistent pending attack. The attack still creates and settles real combat receipts.
- `apply` accepts `{kind:"ending", scope:"chapter"|"campaign", summary:string}`.
  `narrate` commits the scoped conclusion: chapter keeps `status:"active"`, while
  campaign alone sets `status:"completed"`. The ending retains its summary and turn.
  `ask` cannot close a turn containing an ending. This is a story decision, independent
  of HP and combat victory; zero HP alone never ends a campaign.

- Improvised weapons use the existing item/profile seam: `apply item` keeps the object's
  name and binds `weapon` to a rulebook profile chosen by the Keeper (e.g. a large club).
  Later `resolve.weapon` uses that object's name. The kernel must not infer a weapon
  class from an open-ended object name; refusal guidance explains this distinction.
- Entity resolution prefers an exact canonical semantic handle before shared display
  names/aliases. Ambiguous display names return distinct handles that are resolvable.

Spatial source fidelity: compact place/rule previews must explicitly indicate truncation, never imply complete connectivity from a clipped sentence. Full scene look exposes complete authored sublocation descriptions through the existing scene view; it must not invent routes from prose. Scene asset discovery includes maps depicting the scene's occurs-at location. Source readers and independent reviewers preserve explicit no-roll permissions, obstacle-specific check conditions, and spatial branches; checks attached to one obstacle must not migrate to another through summarization. Repairs of missing material use the same tool-enabled reader/review/publication path, without rewriting campaign outcomes.

NPC executor binding correction (§17.9): an ordinary NPC helper check uses the same resolved actor for host-locked skill/characteristic target and receipt actor identity; it must not fall back to the helped investigator after resolving the NPC. Missing NPC values retain the existing npc.skill needs/pinning contract. Tool guidance explicitly distinguishes the executor from a beneficiary/patient and does not turn changing actor or method into an unchosen pushed roll. This repairs the existing actor-binding path; dice arithmetic and family rules are unchanged.

- When a handout and its underlying asset share a display name, `apply handout`
  selects the handout delivery record; explicit asset handles remain usable.
- Starter clue projection preserves an explicit authored `name` separately from its
  `player_safe_summary`. The Crane clue title is corrected in source data and both
  generated graph and manifest are regenerated. Existing campaign evidence is untouched.
- The opening host message explicitly restricts state changes to its closing `ask`
  or `narrate`; inventory, renaming and other `apply` effects wait for player turn one.

### Postgame accounting through existing development settlement

A completed campaign stays completed unless its legacy unscoped ending is explicitly
reclassified as a chapter through the audited `apply ending` correction below. Later player input may open an accounting turn;
new writes are restricted to `resolve` with explicit `development:end-session` or
`development:settle-ending` and `intent: montage`, plus `ask`/`narrate` for source waits
and delivery. Other resolve actions and all new apply effects remain refused. The
original ending, prior turns and receipts are never rewritten or replayed as adventure.

`resolve.action.scenario_san_reward_expr` optionally supplies the source-authored SAN
reward expression for `development:end-session`. The Keeper first obtains the applicable
reward conditions through normal module/source reading; it does not calculate the
amount. The existing development capsule freezes the expression and its existing dice
plan, applies its existing SAN cap, and records the scenario reward alongside growth.
No new reward calculator or generic resource-write surface is introduced.

Late end-session accounting binds to the original campaign ending turn. It reuses a
development capsule created in that turn, or creates one host-owned capsule anchored
to that ending. New call IDs or later accounting turns cannot reroll that capsule,
repeat gains, or replace its frozen reward expression. `settle-ending` remains only
the recovery of pending investigator settlements; end-session normally settles them
all itself. Replayed accounting produces no new resource/skill effects.

Before a new `apply ending`, the current turn must contain successful development
end-session accounting (or completion of its pending settlement), with no pending
development settlement left. Otherwise the kernel returns an actionable `needs` asking
the Keeper to read the chapter's conclusion/rewards and resolve development first.
This gate establishes mechanical accounting, not proof that the model found every
authored reward; independent source review retains that responsibility.

The original-ending binding follows the same principle as [Stripe's idempotent
requests](https://docs.stripe.com/api/idempotent_requests?lang=curl): one logical
operation retains its original result and rejects conflicting parameters. The
[SQLite atomic-commit explanation](https://www.sqlite.org/atomiccommit.html) also
highlights why recovery must follow durable commit boundaries. This change reuses
existing capsules and turn commits; it does not establish crash-atomic growth.
The pre-existing development executor persists a settlement receipt before writing
the party sheet, leaving a process-crash window between those writes. Ordinary
replay/parameter-conflict safety is verified separately from that unresolved limit.

### Chapter closure and campaign completion (continuation correction)

`apply ending` requires `scope: "chapter" | "campaign"`; omission returns
`needs` with both choices before effects are written. A chapter's accounting is
not a terminal campaign event. A chapter closure records the existing ending
summary/turn with `scope: "chapter"`, projects a chapter-end receipt, and leaves
the campaign active. Only an explicitly campaign-scoped ending closes the campaign.
The Keeper chooses scope from authored context, not a title or keyword classifier.
Pausing after a chapter never implies completing the whole book.

While a closed chapter has not been continued, repeated end-session requests reuse
its frozen accounting. The next successful move marks this closure `continued`,
so a later session can have its own accounting. A rename or refused/missing-material
move does not start continuation. Earlier closure records, receipts and capsules
remain in history; no new chapter manager or parallel save format is introduced.
Cross-chapter travel uses existing `move`/`via` and material readiness gates.

Legacy completed saves have an unscoped ending. If the Keeper confirms that this
was only a chapter, a single `apply ending scope:chapter` may reclassify that
ending after its existing accounting is complete. It preserves the original ending
summary and turn, all character values, flags, frozen rewards and old records.
The correction adds a new receipt/event and requires `narrate` to commit the
campaign's active status; adventure writes stay blocked until that commit. This
exception cannot reopen an explicitly campaign-scoped ending and never silently
reclassifies a legacy save. No second development award is needed for correction.

External check: [ink's linked knots and explicit END](https://www.inklestudios.com/ink/web-tutorial/)
and [Yarn Spinner's node jumps](https://yarnspinner.dev/docs/faq/) separate narrative
transitions from termination. They support this distinction, while our existing
receipts and development capsules remain responsible for game-state persistence.

### 23.4 Immersive setup: one calculated draft, one confirmation

This section replaces the earlier prose-only confirmation implementation. Acceptance
is docs/specs/immersive-character-creation.md. The existing setup tool and campaign
store own the lifecycle; no second creation agent or rules engine is introduced.

**Creation method.** New conversational drafts use standard rolled characteristics,
rulebook age adjustments, occupational formula points and INT*2 personal-interest
points. Separate deterministic random streams for characteristics, age and Luck
preserve unrelated outcomes when editing. Existing quick_fire legacy imports are
not relabeled as rulebook Quick Fire. No invented point method or outstanding skill
choice may pass completeness. Skill directions, concrete specialties, languages,
backstory and ordinary kit are semantic choices supplied by the setup model.

**The trade the player named stays on the card.** `occupation` is a catalog id
because the budget formula, the skill list and the credit range hang off it; the
player's words are not always an entry. A nurse, a truck driver or a dock labourer
has no line in `occupations.json`, and a guide that quietly files them under
Doctor of Medicine, Engineer or Drifter has changed who the investigator is for
the whole campaign, since the sheet's `occupation` is what every later reader
sees. The setup guide therefore never substitutes silently: when the stated trade
has no entry it says so in the fiction, offers the two or three closest entries
from `setup.occupations` with one clause each on what they would mean, and lets
the player choose or delegate — the one clarification the quick policy permits,
because a valid draft depends on it. The draft then carries `occupation` (the
chosen entry) and `occupation_stated` (the player's words), both kernels store
`occupation_stated` on the sheet beside `occupation` and in the investigator row
the table reads, and the card shows the stated trade with the entry after it.

**Stated aptitude reaches the characteristics — when a package opens that door.**
A player who describes this person as notably strong, frail, quick, slow, bright or
dull is describing characteristics, not only skills, and the draft must not
contradict them. Optional profile field `aptitude {strong: [ABBR], weak: [ABBR]}`
carries that, using the characteristic abbreviations of `characteristic-dice.json`.
The field is accepted only while the campaign's mod set (§26: `world.mods`, or
`campaign.mods_pending` before the world exists) holds an enabled package that
requires `setup.aptitude.v1`; otherwise a non-empty aptitude is `needs` with
`details.capability` and the active package ids, and characteristics are the dice
in table order. The core product therefore never lets prose move a characteristic;
Guided Creation (§26) is what does. Deciding which abbreviations the
player's own words mean is the setup model's semantic judgment; the kernel only
accepts the closed set and never classifies prose. An absent or empty aptitude
generates exactly as before.

When aptitude is present the kernel rolls the same dice, in the same order, from
the same stream, and then assigns the rolled results within each characteristic's
own dice expression: the pool of 3D6 results is assigned among STR/CON/DEX/APP/POW
and the pool of 2D6+6 results among SIZ/INT/EDU. Assignment never crosses pools,
invents a value or changes the multiset of results, so the card is the same set of
rolls this player would otherwise have had. Named strong characteristics take the
highest remaining result of their pool in listed order, named weak ones the lowest
remaining in listed order, and every other characteristic keeps its own result when
that result is still free, otherwise takes what remains in table order. This is
`characteristic-dice.generation_methods.rolled_pool_assignment`: the generated
record, `creation.method` and the receipt all say `rolled_pool_assignment` rather
than `rolled`, and `creation.characteristics.assignment` records, per characteristic,
which slot rolled the result it holds and whether the player named it strong or weak.

A characteristic named in both directions, named twice, or outside the closed set
is `aptitude`-stage ChargenError with the legal options; aptitude with `quick_fire`
is refused rather than silently ignored. Because assignment is a permutation of
existing rolls, strong is not a promise of a high number: the setup model states
what the returned card actually holds and never a value it does not.

**Who said it is part of the field.** A player who describes nobody in particular
still hands over a person: an occupation, a concept, a background. Reading an
emphasis out of that is legitimate and is what a Keeper building a pregen does,
but it is the model's inference and not the player's claim, and a card may not
blur the two. `aptitude.origin` is therefore required whenever aptitude is present
and closed to `steps.json`'s `create-investigator.aptitude.origins`: `player` when
the player's own words named it, `concept` when the model read it off the person
they described. The kernel records the origin in the generated record and the
receipt, and the setup model says which one it used in its own words — never
"as you said" for an inference it made itself.

Both origins place the same rolls the same way; only the licence differs. An
inferred emphasis is capped at `concept_limit` strong and `concept_limit` weak
(content, not code) so that reading a person does not quietly optimize every card
into its occupation's archetype and retire the dice; a longer emphasis has to come
from the player. Exceeding it is an `aptitude`-stage refusal naming the limit.

**The interest list is priority ordered too.** The occupational list has been a
priority order since #21: `spread` walks it in the supplied order and raises each
entry to a tier before starting the next tier. The personal-interest budget kept
the older one-point round robin, which spends the same amount on every entry, so
the ability the player called defining came out level with the fillers it was
listed beside — a stated strength could reach the characteristics and still leave
its own skill near base. `steps.json` therefore carries a second policy block,
`create-investigator.interest_allocation` (`default: spread`, `options: [spread,
fill]`, `tiers`), overridable per call with `params.interest_allocation`, refused
the same way as an unknown occupational policy but at stage `interest_allocation`.

The tiered walk is applied only to a model-supplied `interest_skills` list, which
is ordered by what the player said matters. The legacy auto-pool of
`setup.investigator` is the era's whole standard sheet in table order and carries
no such intent, so it keeps the round robin; `sheet.creation.skills.interest`
records the policy actually applied and its source, and the receipt carries
`interest_allocation`. Both policies stop only when the budget is gone or every
entry has reached the starting cap, so neither leaves the budget unspent while an
entry is still raisable, and the conversational completeness check is unchanged.
A tail entry that receives nothing stays at its base value like any untrained
skill; the setup prompt owns keeping that list short enough to mean something.

**Pacing.** Conversational pacing is prompt-layer policy, not kernel gating, and
the core policy is the quick one: as soon as a name and an occupation concept are
known the setup guide drafts, filling every ordinary missing detail itself as an
editable suggestion; it interviews nobody. A guided exchange before the draft —
what to ask, how many turns, when to stop — is a package contribution (§26,
`setup.guidance.v1`), so a campaign without such a package goes from name and
occupation to a card in one reply. The kernel gates no player turn either way.

**RPC.** All calls include campaign. setup.draft accepts profile, a partial update
of the current semantic profile: name, occupation, age, sex, concept, occupation_skills
(eight concrete skills, including required catalog skills), interest_skills (concrete
skills), own_language, backstory (3–6 populated first-six categories plus scenario_bound),
key_connection (backstory_field and summary), equipment (named ordinary items),
weapons (optional catalog names), aptitude (optional strong/weak characteristic
abbreviations with their origin) and occupation_stated (optional: the player's own
words for the trade when they differ from, or are more specific than, the catalog
entry in occupation; a non-empty string, stored on the sheet verbatim). Unknown skills return the relevant catalog; no
semantic regex picks skills or fills an open choice. The kernel reuses Chargen's
arithmetic and validates complete budgets, provenance, gear and background.

The immutable candidate lives under campaign setup/drafts; campaign.setup points to
its current host-generated revision and digest. Invalid input returns findings and
never replaces a valid draft. setup.draft returns revision, sheet, completeness and
player-language labels. A repeated identical profile reuses the same revision.
setup.previewed {revision} is a host-only acknowledgment after actual render; it
rejects stale versions. setup.confirm {revision, consent: approved|delegated} commits
that exact sheet, without random generation. approved requires the current preview
ack and a later player-input token than the draft creation input; delegated is only for explicit write-now requests and does not pretend the
player saw a prior version. The extension injects revision and the per-input token, never the model.

Draft revisions, previews and confirmation are serialized by a campaign-local file
lock across kernel processes. Immutable draft file publication precedes its pointer;
confirmation can recover after the sheet write by proving equality before recording
the confirmation. Repeated confirmation returns the existing receipt; a different
sheet at the destination is a conflict. setup.complete checks all card completeness
and the setup confirmation, then performs its existing handoff. Imported/library
cards remain a distinct source and must satisfy their own validated intake contract.

**Pi/GUI.** draft-investigator is repeatable until confirm-investigator commits;
steps carry current draft state across session recovery. The extension appends a
coc-character-draft entry with actual calculated values. Electron renders it inside
the existing transcript and acknowledges its revision through the authenticated
session binding; the acknowledgment may not target another campaign. Terminal setup
renders the same data as structured JSON and acknowledges only after emitting it.
The model sees semantic profile/actual values but no opaque revision or hashes.
A model-supplied confirmed flag is not a substitute for these checks.

**Prologue.** The module-owned cache holds opening/advice plus scene, guide and
handoff text, all source-grounded and independently reviewed. Review may request
one bounded author revision; both rounds and findings remain on disk. Failed review
blocks setup and suppresses invented fallback prose. A brief narrator identity hint
is permitted; internal implementation instructions are not. Opening is an in-world
meeting with one identity question and a brief narrator hint, never a synopsis/menu.
setup.prologue is host-only and binds scene/guide/text/handoff to the authored
opening, validating that the guide is present. Only the first delivered meeting is
recorded; it does not award any resource. The setup
context records the actual opening delivery; confirmation records the introduction
and last setup exchange. It cannot award keys, money, clues or accept commissions.
Play opening receives that committed context and continues the meeting, without
repeating arrival or introductions. Subsequent recovery uses the normal turn receipts.

**Free action.** Ordinary scene questions belong in fiction and await free player
input. New ordinary questions close through narrate with no pending choice or options.
The model-facing ask only admits kind=mechanics; its runtime also rejects story
requests. Raw table.ask retains the old story format for existing RPC clients and
receipt/recovery compatibility, but that path is not exposed to the new Keeper.
Legacy story records are displayed as text. Reading/preparation waits likewise
return prose through normal turn closure, without creating fake story choices.
Mechanics controls retain the existing closed action vocabulary and rule arithmetic.

**Precedent.** Expected-version checks follow optimistic-concurrency practice
(https://learn.microsoft.com/en-us/aspnet/core/data/ef-rp/concurrency); the local
store adds its existing atomic files and a shared lock rather than a database.
Creation choices are checked against the supplied Keeper Rulebook Chapter 3 and
Chaosium skill/equipment guidance. No new provider or dependency is needed.

Setup confirmation may carry pending_action only as an exact substring of a
host-provided player_requests entry. It is retained in the prologue handoff for the
Keeper to address through normal receipts, not executed by setup. Confirmed drafts
cannot be edited before handoff; completion verifies the confirmed/current revision
match. Draft files are digest-checked before replay or commit.

#### Complete player-language card projection

All text in the character preview follows its stored play_language: UI headings,
column names, draft/confirmation guidance, profession, era, native language, skill
specialties, background labels, ordinary kit, weapon labels and currency names.
Canonical fields and all numeric values remain unchanged. The renderer has no
language branches or hand-written multilingual string tables. A tool-enabled Pi
prepares the card's player-facing text projection; its input contains text only,
never numeric cells to regenerate. Projections are cached by text content and
language, so an age/point change alone reuses the text result. Existing immutable
drafts use this same projection path, without rewriting their sheets or receipts.
Until the full projection exists, the renderer shows a neutral loading indicator
rather than exposing untranslated keys. It acknowledges a preview only after the
localized card is rendered. The authenticated host resolves the session's campaign
and reads the requested revision itself; clients cannot provide a replacement sheet.

The live investigator sidebar uses this text projection for string-valued derived
parameters as well as scene display names. The current sidebar continues to hide
canonical present-person names, including their translated forms. A separate campaign
and language cache grows from the visible table view only; hidden module names
are never sent to the presenter. New visible names are projected by a tool-enabled
Pi, while existing labels are reused. Canonical identities, damage formulas, numbers
and turn state remain unchanged. A missing live-name projection is shown as a
neutral placeholder and retried on the next sheet read, never as an English name.

#### Explain the actual character creation (2026-09-08)

The character preview and sidebar display the canonical DB `none` as numeric `0`
(the Keeper Rulebook printed page 35). This is a field-specific presentation of
zero damage adjustment, not a translation or a mutation of saved rules data.

The setup guide accompanies each computed draft with a concise player-language
explanation of the edition/method, actual characteristic generation, age reductions
and education checks, Luck generation, occupation and interest budgets and additions,
and derived-stat formulas including DB/Build. The explanation is grounded in the
sheet's existing `creation` trace, exposed to the guide with the seed omitted. The
host retains the complete trace in the draft. No reroll or reverse inference from
final values is permitted. The guide distinguishes optional/default allocation
policies (caps, skill distribution, chosen credit rating) from rulebook formulas,
and must not invent scenario, occupation or background bonuses.

This user-requested setup explanation may include the necessary numeric arithmetic
in prose alongside the card; the in-play mechanics-only JSON rule remains intact.
Keep it compact, do not repeat the whole card, and end with the existing single
confirmation invitation. Revisions explain only changed calculations and preserve
unchanged rolls. No extra question or character-generation choice menu is added.

#### Allocation review in the digital draft (2026-09-08)

Character and skill tables omit half/fifth thresholds; the game computes those
when resolving checks. The draft's skill table shows base value, occupational
addition, personal-interest addition and final value for every skill. Values come
from the immutable sheet.creation.skills ledger, not model prose. Base is the
recorded final value less the two recorded additions. Credit Rating's recorded
value is an occupational expenditure separate from occupation.allocations; include
it in that row and in occupational spent totals exactly once. Budget summaries
show total, spent and remaining for each pool. Missing legacy allocation evidence
is displayed as unavailable, never inferred as zero additions. The language
presenter supplies column headings only and cannot change the ledger.

The card also shows characteristic generation and derived-stat calculations inline.
Use recorded dice expressions/faces/totals/multipliers, age reductions and EDU
checks, and Luck attempts/keep policy. Show the final saved values alongside this
evidence. HP/MP/SAN expressions come from recorded creation.derived formulas.
Movement and DB/Build explanation rows resolve the recorded rule reference against
the existing content tables and are exposed only when the table result agrees
with the saved result. These are read-only explanations, never new rolls or a
replacement for the kernel calculator. Missing evidence remains unavailable.

The digital card defaults to a compact view: final characteristics, derived values
and skills, with background/possessions retained. A player-language button toggles
all calculation evidence and skill-allocation budgets inline and can collapse them
again. New revisions start compact. This is local presentation state only: toggling
never rerolls, writes the draft, re-acknowledges a preview or calls a model. The
frontend guide also keeps unsolicited calculation prose short and points to this
control; detailed explanation remains available on explicit request or in the TUI.

#### Appearance as a reusable portrait subject (2026-09-08)

Every newly computed/revised profile includes backstory.personal_description, a
compact player-language paragraph of visible appearance. Describe apparent age,
face shape and salient facial features, eyes/brows, skin, hair, and one or two
ordinary distinguishing details, plus era-appropriate visible clothing/accessories.
Personality, speech and habits belong in traits, not as substitutes for appearance.
Missing visual choices are editable proposals in the normal draft, never a new
questionnaire. Preserve player-supplied features and keep this paragraph unchanged
during unrelated occupation/skill/background edits unless explicitly asked to
change appearance. Do not derive ancestry or facial anatomy from language, job,
name or APP, or give every character the same scars/beauty marks.

Keep image composition, lighting, art style and generation controls out of this
biographical field. It will be reusable as the subject text of a future portrait
request, but this change adds no image-generation feature or separate schema.
The kernel checks presence only; visual quality remains the setup agent's semantic
responsibility. Existing confirmed cards are not rewritten by this requirement.

#### Background and monetary equipment in the sidebar

The investigator sidebar displays all populated backstory text (concept remains
in its existing header position), native language and key-connection summary using
the player-language text projection. No background data is copied into a new store.
Equipment contains physical belongings; ordinary cash, generic money allowances
and wealth placeholders belong to finance. The existing tool-enabled presenter
returns `finance_equipment`, an exact subset of supplied equipment strings, to
exclude legacy financial duplicates from both draft and sidebar item displays.
The host validates subset membership and uniqueness; open semantic classification
is the model's job, never a keyword list. Keep wallets, purses and collectible
coins, and keep uncertain entries. Financial balances and immutable evidence are
unchanged. Old projections are upgraded on sheet reads; new setup profiles are
instructed to omit monetary placeholders from equipment.

Legacy equipment-presentation upgrades run in the background without making
the sheet read await that model work. While pending, only the equipment section has a loading state; on
completion a sheet_changed extension event refreshes the panel. Failed upgrades
show a retry state instead of leaking monetary placeholders or retrying forever.

Sidebar inventory is a noninteractive list with item name and supplied quantity.
Weapon rows place labeled parameters beneath the name, using canonical weapon
fields (damage_die, base_range_yards, uses_per_round, magazine, ammo, malfunction,
skill, adds_damage_bonus, special) and legacy aliases when needed. Magazine
capacity and current ammunition remain distinct; missing values are not invented.
These UI captions use the sidebar's existing closed-language chrome exception.

## 26. Gameplay mods (2026-09-08)

### Document reading language (2026-09-08)

Enhanced Items 1.1.2 requires `ui.documents.language.v1` and instructs both the creator and Keeper to write generated,
readable document content in campaign `play_language`, preserving established
facts and intentional quoted clues. Authored handout captures remain exact.
The host presents existing documents through a tool-enabled Pi reading projection:
title, current writing and acquisition original use that same language, with
paragraphs, names, amounts and clue wording preserved. It does not decipher text,
retrieve hidden material, change canonical names or write campaign state.

The projection cache binds exact input text, target language and instructions.
Blank writing stays blank. Already localized text remains verbatim. Explicit
player edits are never translated or rewritten: `mods.document.view/apply` return
`player_edited` to distinguish these from generated writing. Legacy changed text
with an edit timestamp is conservatively treated as player-authored. In-fiction
Keeper writes clear that marker; acquisition by a new owner starts a new baseline.
Reset still uses the stored acquisition original and then presents its cached
reading version. No client-supplied translation becomes the reset authority.

Hot and cold panel adapters share the same projector. Failed preparation leaves
the editor in a retryable loading/error state; it does not silently claim an
untranslated page is ready. The canonical revision token still guards writes.
First preparation returns `{pending:true}`; the panel polls owned views while
retaining its draft, never resubmitting a save/reset to wait for a translation.
Projection is host presentation and also works for previously locked Mod versions
and the plain core editor. Future generation instructions require a Mod upgrade.

This separates source from presentation as recommended by
[W3C internationalization guidance](https://www.w3.org/International/quicktips/index);
[Firefox translation](https://firefox-source-docs.mozilla.org/toolkit/components/translations/resources/01_overview.html)
provides a comparable translated reading surface. Unlike Firefox's local models,
this product uses its existing tool-enabled Pi content runner.

### Possession words in the play language (2026-09-09)

An object reaches the sidebar with the words its definition was written in. Under
Enhanced Items 1.1.2 the creator wrote `player_view.description` and document text
in `play_language` and everything else in English, so a zh-Hans table read a
camera's `length`, `weight`, `capacity: 12 exposures` and `material: mahogany,
leather bellows, brass fittings, glass lens` untranslated, beside the kernel's own
`condition: intact`. The sidebar carries no hand-written translation of any of
these. The two legs below are the two legs document text already has: the producer
writes in the play language, and the host projects what was written before.

Enhanced Items 1.1.3 instructs the creator to write player-facing physical traits,
each trait's name, its unit and any string value, in `request.play_language`,
exactly as it writes the description, and to list the same localized names in
`player_view.traits`. Structural keys stay English: category, parameter names,
effect kinds, `player_view.fields`, the basis. A trait name has no mechanical
reading (the kernel checks shape and uniqueness; the Keeper reads traits through
`look`), so a localized name changes nothing the engine consumes. The kernel checks
shape, not language; a definition that slips through in English is still read in
the play language by the projection below. Accepted definitions keep their words;
a campaign locked to 1.1.2 upgrades explicitly, as before.

The kernel's own state words (`condition` with its closed values `intact`,
`damaged`, `jammed`, `broken`; `charges`) and the traits of definitions written
before 1.1.3 are projected on the read side by the same tool-enabled presenter that
projects card text and standing names, from the same per-language vocabulary, so a
word is asked of the model once per language, never per campaign.
`possessionTexts(view)` collects, from every investigator's `objects`, each trait
name and unit, each state key that carries a value and each string state value.
Item names, descriptions, containers and numbers are never sent: the first three are
already written in the play language, the last are the kernel's. The projection is
saved as `setup/presentations/possessions-<language>.json` beside the standing
names and grows with the campaign.

On every sheet read the host merges that file under the kernel glossary
(`labels = {...possessions.texts, ...labels}`, the glossary winning) and compares
the sheet's current words against it. A word the file lacks starts one background
run, keyed by the missing set; the read is not held, and the panel draws the
canonical word until the run's `sheet_changed` refresh redraws it. A failed run
keeps its key, so the same set is not asked again until the set changes or the
player's refresh (`retry_projection`) clears it. The panel looks a trait's unit up
through the same `labels` lookup as its name, so the value on the sheet is the
number and the projected unit.

### Writable documents and ordered overrides (2026-09-08)

Enhanced Items 1.1.0 adds `objects.documents.v1`. The semantic creator may attach
`document: {text, presentation: paper|notebook|book}` to an item/weapon definition.
For an already revealed textual handout, use `handout:<semantic name>` instead of
`text`; the kernel copies its exact authored text, rather than asking the model to
retype it. The creator receives only revealed handout names/previews. Hidden or
nontextual sources are refused. The stored instance always contains captured text.
Text is the established readable content, including an empty string for blank
stationery. Never copy undiscovered source truth, invent diary entries, translate
an undeciphered script or grant knowledge merely by opening an editor. Existing
carriers may acquire this capability through `apply object document:{...}` with
the same current owner in from/to; an initialized document cannot be reinitialized.
Definition/source text remains immutable; instance text is the editable copy.
At first placement an explicit instance document seed takes precedence over the
template seed and is captured once. This permits a written letter to use a blank
stationery template. It is not permission to reinitialize an acquired document.

An instance captures its current text when it enters an investigator's ownership.
Its acquisition snapshot is immutable throughout that custody, including edits,
reset, Mod upgrades and renderer changes. Moving it to another investigator
captures a new acquisition baseline from the text actually transferred. Containers
use the root owner's identity. Reset never replaces module graphs, clues, receipts
or the acquisition baseline. Books are carriers, not learned spells.

Host-only `mods.document.view {campaign, actor, name}` exposes only owned documents
and a host revision token. `mods.document.apply {campaign, actor, name, version,
action:save|reset, text?}` is the explicit player's document-edit apply path. It
checks ownership and the revision/worldline token, writes one current world value
atomically, and appends an audit receipt. It does not open a fictional turn, roll,
advance time, or change resources. Reset obtains the baseline from storage, never
from the client. Conflicts retain the user's unsaved draft. Text is bounded plain
text, not HTML or instructions. All campaign RPC operations share a short process
lock so a cold panel write cannot race a live Keeper's world transaction.

The inventory opens a modal editor for structural document capabilities, not name
keywords. Empty, loading, failure, unsaved, saved and reset states are explicit.
The normal handout/source reader remains the immutable reference; this editor owns
the writable inventory copy. Existing documents retain a plain core editor when
their generator is disabled. Modal input never edits scenario truth.

`mods.order {campaign?, order:[mod ids]}` stores an explicit top-to-bottom order;
without a campaign it sets new-campaign defaults. Dependencies load first. Manual
orders violating dependencies are rejected; busy campaign changes wait for the
same safe boundary as version changes. Saves/worldlines retain order and versions.

Contributions resolve by stable slots: each named check, the materializer, and the
document editor. Later providers replace earlier providers of the same slot,
including a named check whose namespace belongs to another Mod. A package may
provide `ui.document_editor:{renderer:paper|plain}` (the earlier
`contributes.document_editor` form remains accepted). The shipped 1.1.1 manifest
uses the additive top-level form so an older running kernel can list it as
incompatible without failing its whole catalog. A policy package's instructions
and auditor run only while it still owns one of its check/materializer slots;
observer-only auditors default to separate additive slots, but may declare the
same `audit_slot` to replace an earlier auditor. The resolved provider and displaced
providers are exposed to the Mod manager and Keeper. Jobs must still belong to
the effective provider at acceptance. Changing order affects future behavior,
never rerolls a committed pair check or regenerates accepted items.

These are executable contribution overrides, not arbitrary source monkey-patches.
New kinds of rule executors or UI renderers require new named capabilities while
keeping dice and state transactions in the kernel. This permits larger overhauls
without tying packages to kernel/Pi/Electron implementation objects.

Design precedent: Factorio orders dependencies before dependents; OpenMW exposes
user order with later resources replacing earlier ones. We use those explicit
ordering principles and retain captured model outputs instead of replaying them.

### Initial and existing equipment reconciliation

Enhanced Items 1.0.3 requires `objects.adopt.v1`. Active materializers receive
`unregistered_equipment` in opening/turn context and unpublished-narration audit
jobs. This is a structural inventory difference, not a weapon-name classifier.
The Agent identifies mechanically meaningful equipment even when the narration
does not mention it. Existing executable weapon rows are left unchanged.

Use the normal `define` and `object` batch, with `object.adopt` naming the exact
existing equipment row and `to` its current investigator. The kernel requires one
unambiguous unmanaged row, preserves its quantity and recorded physical state,
removes that row in the staged sheet and projects the same new instance back.
Adoption is representation enrichment, not acquisition, transfer, money, time,
characteristic changes or knowledge acquisition. A bad batch changes neither
inventory nor definitions. Repeated reconciliation sees no pending row.

This runs before opening delivery and in subsequent normal turn audits, including
after enabling/upgrading the Mod on an existing campaign. It does not manufacture
a player turn or retroactively edit a closed narration. Version locks remain
explicit; old Mod packages and prior game evidence remain immutable.

### Interface and authority

Game interface `pipicoc.game.v1` accepts JSON values and semantic names. Packages
contribute named decisions, Agent tasks, context instructions and migrations. They
never import kernel or Pi implementation objects. The current adapter translates
these contributions into the seven verbs, the existing transaction and host jobs.
The kernel owns dice, identities, validation, world changes and persistence; a Mod
owns its policy, prompts, presets and tests. No Mod may overwrite authored source.

The first implementation supports declarative percentile decisions (a maximum of
named actor values, target-scoped reuse and result mappings), generated weapon,
spell and item definitions, and typed world effects. Unknown required capabilities
are rejected; descriptive text never stands in for an executable mechanic.

Current implementation decisions: `definition-created` and `ability-acquired` join
the closed event set. Natural NPC checks may run during the opening after a real
contact; define/object/ability may prepare opening objects. Other adventure actions
still wait for player input. Host-private accepted draft fields are excluded from
the public call fingerprint and never mutate the Keeper's original tool arguments.
Multiple audit contributions are combined into one tool-enabled read of the draft;
findings are returned before delivery. Previously accepted same-name definitions
are reused, while a definition cannot shadow an existing rulebook spell.

A `mod_narrative_repair` refusal projects its validated `missing` objects and
`findings` (each reason and fix) into the model-visible tool result body as JSON,
as well as retaining the structured error details for the interface. The Keeper
must receive the actionable repair, not only the generic retry instruction.
Repairing the unpublished draft does not reroll settled actions or change the
authority of the audit. This closes the missing-feedback seam observed during
the runtime-consolidation visible acceptance.

### Packages, activation and upgrade

Enhanced Items 1.0.1 requires `weapons.profile.v2`: non-applicable range and
malfunction fields may be null, and new creator results must explicitly declare
the preset's `adds_damage_bonus` rule. Existing accepted definitions remain valid
and unchanged. Player descriptions are generated in the campaign language.

Packages contain `mod.json`, instructions, schemas and optional data/migrations.
The manifest declares `id`, `version`, `game_api`, `state_version`, `name`,
`description`, `author`, `default_enabled`, `requires`, `dependencies`, `conflicts`,
`contributes`, and `settings`. Built-ins live in repository `mods/`; installed
immutable versions in `<home>/.coc/mods/packages/<id>/<version>/`. A package digest
covers all files. Local directory/ZIP installation rejects escaping paths,
symlinks, executable payloads, oversized archives and replacement of existing
versions with different bytes. Installation does not activate or upgrade a save.

Host-only methods: `mods.list {campaign?}`, `mods.install {path}`,
`mods.configure {campaign, id, enabled?, version?, settings?}`,
`mods.defaults {id, enabled}`, and `mods.context {campaign}` (which also answers a
`setting_up` campaign with the setup shape above). List returns every
installed version, compatibility, active/pending versions and player-safe settings.
Unbound panels manage installation and new-campaign defaults; they never guess a
campaign. Changes during open/acting turns or live subsystem sessions remain pending
until a safe boundary. The whole resolved set is checked for dependencies/conflicts
before activation. Unknown settings are rejected. A save pins version, digest,
settings and state version in `world.mods`; no automatic latest-version selection.
During background opening preparation, before world.json exists, that same lock is
staged in campaign.mods_pending. table.open promotes it after the world is ready;
later default changes do not alter the already-created campaign's choices.

Upgrades run an explicit package migration chain before the version lock changes.
First-version migrations are deterministic namespace-local JSON field renames and
defaults, never arbitrary world patches. No available migration means refusal with
the old lock/state retained. Historical receipts and accepted definitions are not
rewritten. Disabled mods retain state; generated objects using core capabilities
remain usable. Worldline snapshots include mods, definitions and instances; merges
must treat conflicting records explicitly rather than silently pick one.

### Setup packages: `setup.guidance.v1` and `setup.aptitude.v1` (2026-09-09)

Two capabilities let a package reach the setup process, which has no capsule and
until now read no mod at all. `contributes.setup_instructions` names a Markdown
file, validated like `instructions`; `setup.guidance.v1` is the capability a
package must require to contribute it. `mods.context {campaign}` accepts a
`setting_up` campaign and then returns `{active, authority, capabilities, setup}`
instead of the play shape: `capabilities` is the union of what the enabled packages
require, and `setup` lists, in load order, every enabled package's setup
instruction with its version and settings. The lock it reads is `world.mods` when
world.json exists and `campaign.mods_pending` otherwise, the same two places
`mods.configure` writes during setup, so a package toggled in the Mods panel
while onboarding takes effect on the next setup turn.

The onboarding extension calls `mods.context` for the campaign on every setup turn
and appends each `setup` entry to the system prompt under the package's id and
settings. Setup instructions may add an exchange before the draft, name what the
player's words imply for the card, and set their own stopping rule; they cannot
add a tool, a check or a fact. A failed `mods.context` blocks the turn with a
notice rather than silently running the core policy.

`setup.aptitude.v1` is the fifth door of §28.1 in the other direction: not a fact
about the world, but a semantic input to creation. It gates `profile.aptitude` as
§23.4 says. Both capabilities enter `MOD_CAPABILITIES` in both kernels; the
Python kernel mirrors the setup context and the gate.

### Guided Creation

Built-in package `guided-creation` (default enabled) requires both setup
capabilities and contributes `guide.md`. It replaces the core's one-reply draft
with an exchange paced by the player: it asks about situations rather than
numbers, one thing per turn, and answers each reply by naming in one clause what
it will mean on the card before asking the next; it reads how much the player
wants to say from how much they say, stops when the load-bearing choices are in
or when `settings.max_guided_turns` is reached, and ends every guiding turn with
the same short reminder that saying "draft it now" ends the exchange. It owns
the aptitude rules of §23.4 (player vs concept origin, the concept limit, honest
reporting) because without it the field is closed. Disabling it returns the
campaign to the core policy: name and occupation, then a card.

### Natural NPC

The package contributes `natural-npc:first-impression` to `resolve.action.decision`.
It performs one public regular D100 against max(APP, Credit Rating), ties selecting
APP, and freezes the actor's values and result for that investigator/NPC pair.
Ordinary retries, reloads and repeat encounters reuse the receipt without another
roll. Existing same-pair receipts are imported when present; legacy hidden results
remain hidden. Closed result mappings preserve the old reaction/disposition tiers.
The Keeper decides when real contact occurs and realizes the result in observable
manner, causal explanation, preserved character boundaries and opportunity/friction.
This context remains separate from the existing party stance and interaction ledger.
Disabling stops new checks and instructions, not historical facts. No regex or word
list classifies contact, motives or appearance.

### Enhanced items

Enhanced Items 1.0.2 requires `objects.state.v2`. An object call with the same
from/to owner, an explicit condition and causal why changes the existing instance's
physical state; it produces an item-labeled condition delta, not an acquisition.
Changing owners still preserves condition. Managed instances cannot be mutated
through legacy equipment rows. The Mod auditor compares existing-object state
with narrated damage/use as well as checking newly introduced objects.

`apply` gains `define {name, category: weapon|spell|item, description, template?}`,
`object {name, definition, to, from?, quantity?, why?}`, and
`ability {name, to, source, why?}`. Define is intercepted by the host's Mods bridge:
a tool-enabled Pi job reads scene/actor/source context and preset catalogs, writes a
definition draft, checks it and repairs it. The kernel validates the accepted draft
again before it enters the existing apply batch. Host identities and job paths never
need to be copied by the Keeper. Plain items remain supported through `apply item`.

Definitions are immutable, versioned and carry provenance, supported capabilities
and a player-safe projection. Instances have their own identity, owner/location,
quantity and mutable use state. An owner may be an investigator, NPC or scene.
Transfer removes ownership from the giver and preserves the same instance and
remaining ammunition/charges. Copying a name is never a transfer. NPC and player
combat read the same definition/instance; character equipment is a projection.
Spells are definitions; owning a book does not grant knowledge. Ability acquisition
and spell learning/casting retain their explicit source and rule requirements.

Before narration/ask commits, the host's tool-enabled semantic audit compares the
unpublished draft with declared/registered objects. Unregistered mechanically
meaningful entities cause a repair request before delivery. Any attempted use also
requires an executable definition. A failed/cancelled job preserves evidence and
does not commit partial definitions or pretend the item worked. Accepted jobs are
reused by request identity; a changed request uses a new job. Replay reads accepted
data and never invokes a model or rolls again.

### Host and panel

`extensions/mods` contributes no Keeper tool. It publishes a host-only bridge to
the kernel extension for generation and pre-delivery checks, using the existing
tool-enabled Pi subprocess runner through an adapter. `pipicoc/mods-panel.js`
registers `coc.mods` beside the investigator panel. Panel reads do not open turns;
mutations go through the explicit bound session's host bridge. Public projections
exclude NPC secrets and undiscovered object properties. Core recipes render through
existing mechanics JSON. Local packages and both built-ins use the same loader.

### Acceptance

Implementation details: passive tools may carry typed scalar `traits` (for example
length, mass or material) independently from executable `parameters`. The Keeper
uses those facts to choose ordinary checks/world actions; an empty effect list is
not an automatic successful use. `look focus object` reads persistent definitions,
instances and container contents. Ownership cycles are rejected. Initial condition,
ammunition and jams follow an instance; `objects:repair` settles a declared repair
skill through the existing percentile engine. Public views expose only declared
known traits/parameters. Core-supported typed effects and spell costs execute in
resolve; new unimplemented active powers still require a capability upgrade.

The Mods panel remains available while onboarding. Host management uses the live
session's bridge when one exists; otherwise a short-lived kernel handles the four
management methods without starting Pi or a fictional turn. Cold campaign changes
require that selected UI session's recorded binding; caller-supplied campaign ids
are ignored. Install/default/list also work before a campaign exists.

Check package/version conflicts, bad archives, safe-boundary changes, migrations,
pair reuse, existing NPC behavior, rejected definition atomicity, NPC use/transfer,
inventory and restart persistence, disabled-generator usability and worldline
conflicts through public interfaces. Then run the required suites and real Grok
play with this main session as the sole player. UI controls must be exercised in a
real browser. A generated card or deterministic fixture is not real-table evidence.

## 27. Host runtime composition (runtime migration, issue #35)

### 27.1 Ownership and interface

The host creates one runtime object for each play/setup session, preparation task,
or standalone check. Its binding contains `owner` (`session`, `preparation`, or
`check`), `home`, optional `campaign`, and optional `signal`. The runtime object's
lifetime, not a process-global registry, identifies its owner. Separate objects
never share a kernel or a mutable campaign cache.

Only the host composition accepts deployment configuration: resource root,
content root, Pi home, Node executable and an environment snapshot. Business
callers supply the binding and operation inputs. They do not construct Python,
uv, PATH, PYTHONPATH or repository-relative launch recipes.

The runtime offers these existing capabilities:

- `openKernel(options)`: return the owner's existing KernelClient connection,
  starting it lazily. Connection options cover diagnostics, timeout and reopen
  behavior; executable selection belongs to composition.
- Reader/Mod task execution with cancellation and retained evidence.
- Read-only source-draft and Mod-definition checks, and host PDF page access.
- `close()`: revoke the owner and stop its processes. Repeated calls await the
  same shutdown. A closed or aborted owner cannot start or restart work.

Reader requests may identify an existing instruction template with
`prompt: {phase: "index" | "read" | "verify", guidance?: boolean}`. The host
adapter resolves the template from its captured content root and materializes it
inside the owned attempt directory. Callers do not compute template locations.
Existing explicit Mod job system prompts remain supported; conflicting prompt
forms are rejected rather than silently selecting one.

The capabilities are direct module calls and subprocesses. This introduces no
daemon, scheduler, network endpoint, dynamic plugin registry or second source of
game state. The kernel retains serial RPC, receipts, arithmetic, transactions,
source-publication leases and the authority defined by the earlier sections.

The existing `coc:kernel-bridge` also carries the session's `runtime` capability
object. Setup publishes it after hello without opening a table; play publishes it
after its normal open. Revocation publishes both `call` and `runtime` as undefined.
Consumers use that owner rather than constructing a second session runtime.
Its immutable `resourceRoot` and `contentRoot` are also available to existing
host presentation helpers for reading their templates and rule data. Neither
property is an alternate launch configuration or a mutable global setting.
The captured optional `readerModel` lets the host's existing vision check inspect
the same configured reader route that task execution uses.
Cold frontend table and management calls use a short-lived `check` owner from the
same emitted host adapter. They never construct a separate Python command or
start a Keeper merely to inspect existing state.

### 27.2 Runtime selection and failures

Stage A keeps the existing Python implementation. The default kernel command is
the locked uv/Python launch from section 1. `PI_COC_KERNEL_CMD` remains a host-only
JSON argv override and is resolved at owner creation. The host captures executable,
working directory, content and environment consistently; changing ambient process
configuration cannot redirect an existing owner's subsequent launch or restart.
The compatibility `kernelCommand` export delegates to the same command builder.

Host-only `backend` (`python` or `typescript`), or the captured `PI_COC_RUNTIME`
development selection, chooses the kernel and checking implementation together.
The default remains Python during migration. TypeScript uses the managed Node
executable and a compiled kernel entrypoint, defaulting to `build/kernel/rpc.mjs`
under the resource root; a host may supply its packaged entrypoint explicitly.
Missing TypeScript artifacts fail explicitly. The older `PI_COC_KERNEL_CMD` is
only a diagnostic command override, not permission for checking adapters to
silently switch implementation. A checking capability unavailable for the selected
backend reports `not_implemented`.

Composition validates its supplied locations and launch inputs before creating
processes or writing campaign state. Missing or invalid deployment configuration
is explicit; it never triggers a fallback download or selects another runtime.
Cancelling an owner revokes new calls immediately and initiates shutdown of work
already owned. A shutdown timeout is reported, never treated as verified cleanup.

Read-only checks share their validators with authoritative kernel acceptance.
Successful feedback alone does not publish a graph, accept a Mod definition or
mutate a campaign. Readers retain their tool-enabled Pi workflow and source
evidence. The memory/verifier exception and the seven Keeper verbs are unchanged.

### 27.3 Migration and verification

The lead owns this contract, common runtime shape and final wiring. Caller lanes
own play/setup integration, preparation integration, and reader/check integration
respectively. Kernel migration lanes use the existing JSONL interface and
preserve the previous state formats. A selectable incomplete TypeScript kernel
must refuse unsupported work explicitly and cannot call Python as a fallback.

Verify the runtime through actual subprocess startup, requests, restart,
cancellation and exit, including paths with spaces and independent owners.
Use the existing RPC corpus for semantic compatibility and the normal product
entrypoints for genuine acceptance. Stage A does not satisfy the final requirement
for a package without Python, uv, developer files or global runtimes.

### 27.4 Implementation record

2026-09-09: implementation restarted from the clean 0.9.2a baseline after the user
requested deletion of two unmerged worker attempts. No code from those attempts
is being integrated. The first slice provides host-owned kernel composition;
remaining task/check adapters and production TypeScript cutover stay pending.

The TypeScript lock backend uses native POSIX `flock` through `fs-ext`, preserving
shared/exclusive, nonblocking and descriptor-lifetime behavior with Python's
`fcntl.flock`. Blocking acquisition awaits repeated native nonblocking attempts
so waiters cannot exhaust Node's filesystem thread pool and prevent release.
It never substitutes a directory or lease file for an advisory lock. The native
addon is built for the selected managed Node ABI and must ship with that runtime.
The [fs-ext implementation](https://github.com/baudehlo/node-fs-ext) confirms the
underlying flock operation; [NAN](https://github.com/nodejs/nan) documents the
Node ABI compatibility layer. Actual cross-language contention and process-exit
tests, rather than these references alone, determine compatibility.

### 27.5 Read projections during partial migration

`kernel-ts/read/` owns ModuleGraph, Director, ontology, capsule, mechanics and
snapshot-only table projections. It exports one static handler group and reusable
pure views. The read slice may serve existing saved campaigns without importing
an unfinished transaction, publication or subsystem writer. Later slices reuse
these projections instead of forking them.

Existing `look`/`lookup` can transition an open turn to acting, and legacy load may
repair a missing scene trail. These effects remain part of compatibility. Before
the transaction slice supplies them, the partial backend explicitly refuses cases
requiring either write. Supported already-acting snapshots must compare responses
and unchanged state against Python. `table.view` retains its existing read-only
legacy projection behavior.

The read slice owns one pure condition/fact projection module for current rule
gate observations. RuleGraph migration consumes that same module. Unmigrated
decisions, catalogs or settlements cannot be replaced with empty successful data.
`kernel-ts/capabilities.ts` independently declares the existing registered state
paths and resolver/executor vocabulary for ontology validation. These declarations
do not mean the corresponding TS executors are implemented: actual dispatch still
refuses absent implementations. The declarations are checked against the Python
reference and must not be inferred from the ontology being validated.

The composition also provides one captured Git adapter. Read projections use
`lineBlob(campaignId, lineName, relativePath)` and `rootCommit(campaignId)` without
checkout or recovery. The transaction/history lane reuses the same `run`/`init`
adapter. It retains the existing identity flags, sidecar/work-tree paths, UTF-8
text and 60-second command limit. `PI_COC_GIT` selects a managed executable;
development may resolve Git from the captured PATH. No read projection chooses
a binary or reads ambient environment. Owned Git children terminate on kernel
shutdown. Packaging must supply Git and its helper environment.

### 27.6 Transaction and settlement contributions

`kernel-ts/transactions.ts` is the shared static type boundary implemented by the
campaign/turn writer and consumed by later rule families. It defines the campaign
I/O port, `beginWrite`, `touchActing` and `commitResolve`. `beginWrite` preserves
current-call and closed-record replay/conflict checks before checking write state;
its opening exception is explicit. A replay cannot consume RNG or run a domain
executor. `touchActing` is the single writer-owned hook for look/lookup/recall.

`commitResolve` preserves the existing order: append domain receipts to the
current cursor, mark it acting, remember the result, write the cursor, then append
domain events. It does not add a new rollback over effects that the current
executor persisted earlier. The `apply` owner retains its distinct staged batch
and the existing sheets/world/inventory/notes/rulings/cursor/event order. Narration
keeps its existing Git rollback and post-commit boundaries. Neither interface
turns these paths into a new general transaction store or runtime registry.

Before mutating, the writer must check required source, Mod, NPC, memory, library
and worldline contributions. A missing implementation is `not_implemented`, never
a successful no-op. The minimal unconditional episode write needed by narration
belongs to the transaction slice; the memory slice reuses it when adding job and
recall behavior. Imported-library writeback and pending worldline transitions
remain explicitly unavailable until their owning contributions exist.

The static read group accepts four named contributions: `repairLegacyTrail`,
`touchActing`, `capsule`, and `lookupRules`. The writer owns the first two and updates the
operation's snapshot/cache after its persisted change; the rules-query slice owns
`lookupRules` for the already declared rule/catalog lookup kinds. The lead supplies
these callbacks at startup. Missing callbacks retain the partial-backend refusal.
Argument validation and transition order remain in the existing read handler;
there is still exactly one registered handler per public RPC method. The writer's
`capsule` callback reuses the existing projection with its process-local style
lifecycle; ordinary table.capsule retains its non-consumption of pending resume.

Setup and library reuse named writer operations `campaign(params, requirements)`
and `startSetupWorld(campaign, meta)`; a missing world is allowed only when that
caller explicitly requests it. The latter is idempotent and uses the same source
opening readiness and initial-world construction as campaign opening. A static
`libraryWriteBack` callback enables imported-library writes and runs between the
normal checkpoint and episode steps after a successful commit.

Settlement domains use the campaign port's `readSave`/`writeSave` for their
existing files below `save/`. These preserve JSON types and atomic writes; they
are not a new state store. `transaction(params, {repairLegacyTrail:false})` offers
an operation-local preparation read so a partial executor can reject an unsupported
decision before requesting the existing legacy repair. Named receipt markers are
computed once by the shared `markersFor` helper, also used by narration binding.

### 27.7 Memory and recall migration

The memory handler group receives the same writer instance. Jobs rebuild their
packets from committed turn records even when earlier episode/job files are absent.
Candidate validation uses the shared EntityIndex restricted to the job's known
entities; submission retains superseded rows and their raw sources. The existing
advisory warning anchors, transcript selectors, history diffs and worldline reads
keep their public shapes. Memory uses the shared committed-fact and NPC-ledger
helpers instead of deriving a second account of receipts. The memory/verifier
host lanes retain their existing zero-tool exception; the kernel makes no model
calls. Recall performs the writer-owned read transition after validating its kind.

The static kernel composition returns `{handlers, close}`. The RPC entry awaits
the module reader's lease release and the Git adapter's shutdown on EOF or an
owner signal. Releasing a source lease leaves its durable running queue entry for
the existing stale-owner recovery; it never invents successful publication. Setup
and writer opening readiness share the composed source predicate. Library and
source handlers are assembled once beside the existing read and writer groups.

The source contribution owns `sourceGraphPath`, opening readiness, adjacent-scene
read-ahead and the pre-effect material gate. Setup, writer and resolve delegate to
these functions. The host's emitted read-only checker imports the same source
validator as publication, with vocabulary loaded from captured content. Its CLI
uses the shared Python-compatible JSON serializer, including large page integers.

### 27.8 Mod management migration

The static Mod management group owns package installation, immutable versions,
defaults, activation order, pending safe-boundary changes and namespace migration.
It accepts the same captured KernelContext and campaign writer. Its initialization
contribution replaces the transaction slice's temporary built-in-only plan;
callers do not grow their own package, pending-change or migration algorithms.
The existing read projection remains authoritative for context and installed
definitions. Definition validation is a pure shared module, used by the emitted
host checker and later creation acceptance, including bounded document seeds.
Management does not implement creation jobs, object operations or gameplay effect
families. Folder and ZIP constraints, digests, namespace state and existing saves
retain their current shapes; no new package registry or storage format is added.

### 27.9 Fixed settlement families and resource synchronization

Later settlement slices supply named, statically composed family contributions
to the existing resolve pipeline. A family binds its closed decision/capability
set, semantic slots, host-locked facts, executor arguments, execution and outcome
projection. Selection, card grants, plan compilation, receipt minting, replay,
skill ticks and final cursor/event commit remain in the common owner. This does
not add an imperative registration API or an alternative settlement pipeline.

The healing contribution owns the existing wound/healing snapshots, MP and time
synchronization. It uses SettleContext and the campaign port's existing save and
sheet operations; session families reuse this helper. First Aid/Medicine select
the target investigator as patient before evaluating facts/cards, with the acting
investigator or NPC retained separately. The apply owner stages its existing batch
and calls the same resource contribution for HP/MP/clock effects, preserving the
current write order and failure semantics.

Development owns its fixed skill/accounting/end-of-chapter decisions and guards.
It shares the setup/library writer, preserves chapter continuation versus completed
campaigns, and contributes late accounting through the existing explicit writer
gate. No new ending, rule, time unit or save schema is introduced by migration.

Combat, chase and sanity use the same named family bindings. Their snapshot
serialization and rule engines stay in their respective modules; shared wounds,
HP/MP and clock synchronization remain owned by healing/resources. Combat attack
behavior used from chase is exposed by the combat module, not copied. Session
and pending-choice projections come from the existing family result shape. The
common pipeline retains session priority and cross-family continuation ownership.

The transaction preparation read may opt out of eager snapshot loading. Apply
loads only the party and save documents its selected resource operation needs;
an unrelated broken session cannot preempt damage's existing roll/actor order or
a clock advance. Resolve serves an existing call replay before loading unrelated
session snapshots. Positive oracle scenarios must assert successful narration
and a real commit; two matching refusals do not prove turn-finalization coverage.

### 27.10 Standalone resource layout

The packaged descriptor is versioned and contains paths relative to the App's
Resources directory. It selects the packaged Node, Git, Pi and emitted COC
entrypoints; absolute checkout descriptors remain a development-only format.
The packaged loader refuses missing resources or paths escaping that root.
All process owners receive the same captured locations through RuntimeHostOptions.
Packaged preparation/read/check entrypoints are emitted JavaScript, including the
UI agent bridge and PDF page helper; no production TypeScript loader is required.
Every declared play language includes the default language's UI resource surfaces.
Assembly rejects missing surfaces instead of shipping an empty runtime fallback.

Installed resources are immutable. The App's userData contains its isolated Pi
home, credentials, UI sessions and runtime work, while the player's chosen COC
home retains campaigns/modules. Packaged launchers do not write settings or assets
inside the bundle. They use the verified macOS shell and the bundled runtime
tool paths, with dependency download fallback disabled. Package assembly records
the locked production dependency closure, licenses, native ABI/architecture and
dependency hashes before signing; relocation and GUI acceptance remain separate
from that build proof.

## 28. Mod vocabulary and the build boundary (proposed 2026-09-09)

### 28.1 The four closed doors

`pipicoc.game.v1` accepts `instructions`, `checks`, `materializer`, `auditor`
with `audit_slot`, and `document_editor`. A package can change how the Keeper
plays and can add one declarative percentile decision. It cannot add a *fact*
about the world. Four doors are closed, in the order they cost:

1. **The actor dossier is a closed spine.** `actor_dossier.profile_keys` in
   `content/modules/module-graph-contract-v3.json` is the one list the reader
   prompt, `ModuleGraph.npcProfile`, the starter projector and the playability
   measure `npcs_without_material` all read (§17.2). A package cannot add to it,
   so there is nowhere to put a fact about a person the five core keys do not
   already name.
2. **The reader takes no contributions.** `kernel-ts/modules/contract.ts` is the
   closed source vocabulary loaded from the captured content root, and nothing
   under `kernel-ts/modules/` reads `world.mods`. A key nobody asks for is never
   extracted, so door 1 alone would only add an always-empty field.
3. **A contributed check's values are manifest-static.** `contributes.checks[]
   .values[].path` is validated against the `characteristics.` / `skills.`
   prefixes at install and read literally at settlement. A decision whose
   governing skill is named by the call — which language, which craft, which
   science — cannot be expressed.
4. **There is no Mod-namespaced `apply`.** `world.mods.state[<id>]` exists and
   survives worldlines, upgrades and disablement, but only a contributed check
   writes it. A package cannot record what the table established rather than
   what the book said.

Setup is a door of a different kind: `setup.guidance.v1` and `setup.aptitude.v1`
(§26) let a package speak to the creation process and hand the kernel a semantic
input about the investigator being made, never a fact about the world.

Non-actor nodes are not a fifth door. `ModuleGraph.entityView` passes every
authored property through except `runtime_projection` and `asset_ref`, so a
property on a scene, item or handout already reaches the Keeper through `look
focus`. Only the per-turn actor dossier is gated.

### 28.2 The build boundary

Mods are campaign-scoped: `mods.configure` takes a campaign and a save pins
version, digest, settings and state version in `world.mods`. Modules are not. A
module is built once and shared by every campaign compiled from it, and a
campaign is a compile snapshot of that graph. A vocabulary contribution therefore
cannot be a per-campaign setting — two campaigns cannot disagree about what the
reader was asked while sharing one graph.

Vocabulary binds at **build** time, from installed packages enabled through
`mods.defaults`, and the built module records the vocabulary that was in force in
its own provenance. A campaign whose active packages contribute a key its module
was not built with sees that key absent on every actor. That is not an error: it
is the same absence as a book that does not say. Enabling a package does not
re-extract a book, exactly as enabling Enhanced Items does not re-read one (§26,
`objects.adopt.v1`).

### 28.3 `graph.vocabulary.v1`

A package requiring this capability may contribute:

```
"contributes": {"vocabulary": {"actor_profile_keys": [
  {"key": "language", "label": "speaks",
   "ask": "the language or dialect this person speaks, and how well, when the book says so"}]}}
```

`key` is a semantic slug that must not collide with a core profile key or another
active package's key; `label` is the Keeper-facing name in the turn capsule's
`present` dossier; `ask` is one bounded English line appended to the reader's
dossier ask. The contract law is unchanged and applies to contributed keys as
written: *a key a book does not give is absent, never invented*.

The key enters `actor_dossier.profile_keys`, which means every existing consumer
picks it up with no further wiring — that is the point of the spine. It is a
property on the `npc` node, not a claim: a claim's object is a node, never a
sentence (§17.2).

### 28.4 The dossier spine gains its labels

`dossier()` in `kernel-ts/read/capsule.ts` is today the one consumer that does
**not** read the spine: it carries its own copy of the five keys with their
Keeper-facing labels. A contributed key would be written by the reader, stored on
the graph, returned by `npcProfile`, and then silently dropped on the way to the
table — the projection-whitelist defect this contract has already paid for twice.

`actor_dossier` therefore carries the label beside each key, and `dossier()`
reads the spine. Core labels are unchanged (`relationship_to_investigators`→role,
`agenda`→wants, `fear`→fears, `secret`→hides, `voice`→voice) so `prompts/keeper.md`
still describes what arrives. A regression test adds a key to the contract and
asserts it reaches the capsule, so the whitelist cannot silently close again.

### 28.5 Measures, backfill and disabling

`npcs_without_material` keeps counting the **core** keys only. A book silent about
language must not report every actor in it as thin.

Backfill uses the existing on-demand deepen (§14.6, `focus: {npc: <name>}`); no
bulk re-read runs on enable. A deepen is queued for an actor that lacks a
contributed key only once the party has actually met them (`turns_present` in the
ledger), which bounds the cost to what this table will see. A deepen that comes
back with nothing records that absence so the same actor is not asked twice.

Disabling a package stops its instructions, its projection and its asks. Facts
already extracted stay on the graph and in campaigns compiled from it: no Mod may
overwrite authored source, and none may retract it either.

### 28.6 Out of this version

A Mod-namespaced `apply` (door 4) and call-named check values (door 3) are named
here so they are not reinvented, and are not built in this version. A package that
needs a value the book never gave has the Keeper play it without state.

## 29. 宿主向记忆线：全图读取与桌级分支（2026-09-09）

右侧栏「记忆线」面板的内核面：把战役的整条 git 记忆线（主线与所有世界线）按游戏内时钟画给玩家，并让玩家从历史节点开新线。设计见 `docs/specs/memory-line-panel.md`，桌级分支与法则二的关系见 `docs/adr/0004-host-level-branch.md`。两个方法都是**宿主向**的（同 `table.view` 一层）：守秘人工具表不变，仍只有七个动词。

### 29.1 `table.graph`：全图读取

- params：`{"campaign", "max_nodes"?: int}`；`max_nodes` 缺省 500，上限 1000。
- 只读：不开桌、不掷骰、不写；冷进程（无桌）与活进程同答。ADR-0001 的「recall 不读 git 对象」约束的是守秘人读面；本方法与 29.2 是宿主方法，`parents` 只能来自 git，这条例外只给这两个方法。
- result：

```
{"campaign", "active": "<线名>",
 "lines": [{"name", "kind", "loop", "status", "last_turn", "last_commit",
            "forked_from": {"line", "turn", "commit"} | null,
            "parents": [{"line", "turn", "commit"}]}],   // merge 线才有 parents
 "nodes": [{"sha", "turn": int | null, "clock": int, "when": {"y", "mo", "d", "hh", "mm"},
            "kind": "setup" | "turn" | "worldline" | "merge",
            "title", "at", "parents": ["<sha>"], "tip_of": ["<线名>"]}],
 "truncated": bool}
```

- 节点是所有 `wl/*` 引用可达的提交，按 `at` 降序。`kind` 是机械分类（闭合集，不是语义判断）：提交信息以 `turn <n>:` 开头 → `turn`（`turn` 取 n）；父数 > 1 → `merge`；首条回合提交之前 → `setup`；其余（seal、落地、`loop <n> reset`）→ `worldline`。
- `clock` 是该提交关闭时的**游戏内时钟**（分钟），`when` 是它按战役时钟锚点投影出的日历字段（与 §23 sheet 的 `at` 同一投影机器；面板不做时钟算术）。回合节点读该线 `turns/NNNN.json` 的世界快照；`worldline` 与 `merge` 节点取其落地回合的时钟；`setup` 节点取战役起始时钟。
- git 读取必须批量（`cat-file --batch` 或同级手段）；每节点一次 `git show` 不合格。
- 截断：节点总数超 `max_nodes` 时按 `at` 降序取前 `max_nodes` 并置 `truncated: true`；每条线的 tip 节点永远保留，即使因此略超上限。
- 宿主按 §23 附 `ui`；内核不回 `ui`。

### 29.2 `table.branch`：桌级从历史节点开线

- params：`{"campaign", "commit": "<sha>", "name"?: "<线名>", "label"?: "<一句>"}`。
- 这是**桌级动作**，与建战役、开桌同级：操作者是桌子前的人，不是守秘人。法则二（世界改变只经 `apply`）管的是模型；本方法不改任何已发生的事实——旧线的每个提交原样保留（证据永不删除），新线从历史节点继续。
- 校验（任一不过整批不写）：
  - `commit` 存在且从某条 `wl/*` 可达，否则 `invalid_params`（`details.commit` 带回所给值）。
  - 桌子空闲：没有挂着未关回合的 `turn.json`；回合进行中报 `operation_in_progress`。
  - 另一活进程持战役锁时报 `operation_in_progress`。
  - `name` 缺省铸 `if-<forkturn>-<k>`（k 是该分叉回合上的序号）；显式 `name` 须合世界线名语法且不与现有线撞，撞名报 `invalid_params`。
- 执行复用 §15.9 的迁移机器：必要时 seal 当前线 → 在 `commit` 上建 `wl/<name>` → 注册表加 `{"name", "kind": "if", "loop": 0, "forked_from": {"line", "turn", "commit"}, "seed": "sha256(\"<campaign>:<name>:<commit>\") 前 16 位", "status": "active", "last_turn", "last_commit", "created_at"}`，原活动线转 `dormant` → 检出 → 注册表覆盖写回 → 按新线种子与下一回合号重播 rng → 从分叉点的回合记录重建检查点。失败即回滚（检出回源线、删掉刚建的分支、注册表写回原样），遥测一行 `lane: worldline, op: branch, ok: false`。
- 事件 `worldline-forked` 落在**新线**上，`turn` 取新线接下来要打的回合，`data.from` 指出从哪条线哪一回合来——与 §15.9 同一条规则。
- 幂等：同 `(campaign, commit, name)` 重放返回同一形状：线已存在且 `forked_from.commit` 相同就不重复建线，只确保活动线是它（第一次调用的效果包含 `active = name`，重放把这一点补齐）。
- result：`{"ok": true, "line": {"name", "kind": "if", "loop": 0, "forked_from": {...}}, "active": "<name>", "branched_from": {"line", "turn", "commit"}}`。
- 换线通知：分支成功后下一次 `player_input` 的胶囊带一次性 `branched` 节 `{"name", "from_line", "from_turn"}`（内核置旗、胶囊读后清）；`worldlines` 节照常反映新线。宿主在会话里追加分水岭展示条目（§23 的 `coc-mechanics` 通道，投影 `{"kind": "worldline", "operation": "fork", "line", "from_line", "from_turn"}`），玩家由此在聊天流里看见分界。

### 29.3 内核的决定

（实现切片落地后记在这里。）
