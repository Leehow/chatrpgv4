# 内核 RPC 契约与回合事务

本文件是 Pi 扩展与 Python 内核之间的唯一契约。两侧的实现和两道接缝的测试都以它为准；改契约先改这里。范围标注为「切片 0」的是本轮必须实现的，标注为「保留」的只需要方法存在并返回 `not_implemented` 错误，形状不变。

规格全文见 GitHub issue #12，切片 0 的验收见 #13。

## 1. 进程与传输

- 一个 Pi 会话一个内核子进程。扩展在 `session_start` 拉起，`session_shutdown` 关闭。
- 启动命令：`uv run --frozen python -m coc.rpc --workspace <dir> --content <dir>`，在仓库根目录执行。`--workspace` 是战役状态所在的目录，内核只在其 `.coc/` 下读写；`--content` 是只读内容目录，含 `rulesets/coc7` 与 `starters/<module>`。
- stdin 收请求，stdout 发响应，一行一个 JSON 对象，`\n` 分隔，UTF-8。stderr 只写日志。
- 请求：`{"id": "<string>", "method": "<string>", "params": {...}}`。
- 成功：`{"id": "<同请求>", "ok": true, "result": {...}}`。
- 失败：`{"id": "<同请求>", "ok": false, "error": {"code": "<闭合枚举>", "message": "<给模型看的一句话>", "fix": "<可直接照做的修正，可省略>", "details": {...可省略}}}`。
- 内核不并发处理请求：按到达顺序逐个执行。扩展负责序列化。
- 内核崩溃或退出时扩展重新拉起并调用 `table.open`；所有状态都在磁盘上，内核进程无内存权威。

错误码闭合枚举：`invalid_params`、`unknown_method`、`not_implemented`、`campaign_not_found`、`campaign_not_ready`、`turn_state`（当前回合状态不允许该方法）、`idempotency_conflict`、`needs`（缺少可补的输入，`details.needs` 给字段与可选值）、`needs_choice`（多个互斥候选，`details.candidates`）、`unknown_entity`（名字在模组图与世界状态中都找不到，`details.candidates` 给相近名字）、`not_reachable`（移动目的地不可达）、`not_here`（线索不在当前场景可得）、`commit_failed`（git 提交失败，回合未关闭）、`internal`。

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
    world.json           世界状态：active_scene、visited_scenes、discovered_clues、flags、clock、npc_presence
    party/<inv_id>.json  调查员表：来自 pregen 或建卡，含 characteristics、derived、skills、weapons、equipment，加运行时 current_hp/current_san/current_mp/current_luck
    turn.json            当前回合游标：{turn, state, player_text, opened_at, calls: {call_id: {params_sha256, result}}, receipts: [...], pending_choice}
    turns/<NNNN>.json    已关闭回合的完整记录：玩家原文、收据、rendered_text、commit
    transcript.jsonl     逐字记录：{turn, role: player|keeper, text, at}
    events.jsonl         事件流（切片 0 只写 turn-started、player-declared、roll-resolved、scene-moved、clue-discovered、time-advanced、turn-finalized）
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
  "pending_turn": null | {"player_text", "receipts": [...], "owed": ["narrate"], "since": "<iso>"},
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

### table.recall（切片 0：transcript；保留：memory、history）
params：`{"what": "transcript"|"memory"|"history", "turns"?: [from, to], "role"?: "player"|"keeper"}`。
- `transcript`：返回区间内逐字记录，缺省最近 3 回合。
- 其余报 `not_implemented`。

### table.resolve（切片 0：普通检定）
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

### table.apply（切片 0：move、clue、time；保留：handout、item、cash、npc、flag、note、ruling）
params：`{"call_id": "...", "effects": [{"kind": "move", "to": "<场景名>", "travel_minutes"?: int, "label"?: "<玩家语言的短名>"}, {"kind": "clue", "clue": "<线索名>", "how"?: "<一句话>", "label"?: "<玩家语言的短名>"}, {"kind": "time", "minutes": int, "why"?: "..."}]}`。`label` 是守秘人用 play_language 给玩家看的短名，只用于机制块；省略时机制块用图上的 display_name 或 id。
- 整批先校验后写，任一条失败整批不写：`{"code": "...", "details": {"index": i, ...}}`。
- `move`：目的地必须是图上 `route-to` 从当前场景可达的场景，或 `scene_edges` 声明的目的地；否则 `not_reachable`，`details.exits` 给可达列表。`travel_minutes` 缺省取图上边的值，没有则 0。写 `world.active_scene`、`visited_scenes`、`scene-moved` 事件。
- `clue`：必须是图上存在的 clue 节点，且 `discoverable-at` 当前场景或在当前场景 record 的 `available_clues` 里；否则 `not_here`。已发现的重复写入返回 `replayed: true`，不报错。写 `discovered_clues`、`clue-discovered` 事件。
- `time`：推进世界时钟，写 `time-advanced` 事件。
- 其余种类报 `not_implemented`。
result：`{"receipts": ["move:hall-of-records-t3-c2", ...], "world": {"active_scene", "clock"}, "material_ready": true}`。切片 0 `material_ready` 恒为 true。

### table.ask（切片 0）
params：`{"call_id", "prompt": "<给玩家的问题>", "options": ["...", "..."], "binds"?: "<待决名>"}`。
- 记录 `pending_choice = {"name": "<ask-<slug>-t<turn>>", "prompt", "options", "binds"}`，状态进 `asked`，写逐字记录（keeper）。`prompt` 就是本回合交付给玩家的文字；不再调用 `narrate`。
result：`{"pending_choice": {...}, "rendered_text": "<prompt 加选项列表>", "turn": int, "state": "asked"}`。

### table.narrate（切片 0）
params：`{"call_id", "text": "<本回合叙述>", "placement"?: "auto"|"end"}`。
流水线：
1. 状态必须是 `open` 或 `acting`。
2. 守秘人自写骰面检查：`text` 中出现 `【明骰】` 或 `【变化】` 行时报 `invalid_params`，`fix` 说明这些块由内核插入。
3. 渲染机制块：每条 `roll` 收据一行 `【明骰】<技能名>｜掷骰：<roll>；基础值：<target>；门槛：<难度>（≤<threshold>）；结果：通过/未通过`，技能名用规则术语表里的 play_language 译名，没有译名时用表上原名；每条 `move` 一行 `【变化】场景：<从> → <到>`，有行程时间时加 `（<n> 分钟）`，名字取 `label` 否则取 display_name；每条 `clue` 一行 `【变化】线索：<label 或 id>`；每条 `time` 一行 `【变化】时间：+<n> 分钟`。
4. 放置：`auto` 时，`text` 按空行分段，段数 ≥ 2 则全部机制块插在第 1 段之后，否则追加在末尾；`end` 时追加在末尾。
5. 写 `turns/<NNNN>.json`、逐字记录（keeper，写 rendered_text）、`turn-finalized` 事件。
6. 同步 git 提交，提交信息 `turn <n>: <前 60 字>`；失败报 `commit_failed`，回合保持 `acting`，不递增。
7. 成功后 `turn.json` 进 `awaiting_player`，`turn + 1`。
result：`{"rendered_text": "...", "turn": int, "receipt": "turn:<n>", "commit": "<短 sha>"}`。

开桌回合（turn 0）：`table.open` 返回 `opening_needed: true` 时，扩展先让守秘人 `look`，再 `narrate` 开场；此时状态从 `awaiting_player` 直接允许 `narrate`，内核视作 turn 0 的关闭。

## 6. 回合胶囊（切片 0 三节）

`table.capsule` 与 `table.player_input` 返回：
```
{"turn": {"number", "state", "pending_choice": null | {...}, "player_text": "<本回合玩家原文或 null>"},
 "where": {"scene": "<name>", "display_name", "dramatic_question", "pressure_moves": [...], "exits": [{"to", "travel_minutes"?, "unlock_when"?}],
           "affordances": [{"id", "cue", "clue"?, "npc"?}], "keeper_notes": [...], "assets": [{"name", "kind"}]},
 "present": [{"name", "relationship", "agenda", "voice", "known_facts": [...], "attitude"?}],
 "known": {"discovered_clues": [names], "clues_here": [{"name", "summary", "delivery_kind", "discovered": bool}],
           "investigator": {"name", "occupation", "hp", "san", "mp", "luck", "skills_of_note": [{"name", "value"}]}},
 "recent": [{"turn", "player", "keeper": "<前 200 字>"}]   最近 2 回合
}
```
全部内容都是守秘人专属；`pressure_moves`、`keeper_notes`、NPC 的 `agenda`、`secret` 只能被守秘人当创作参考，不能进玩家文字。每节字节预算：`where` 4KB、`present` 3KB、`known` 3KB、`recent` 2KB；超出按项裁剪并在该节加 `"truncated": true`。

## 7. 事件

`events.jsonl` 每行 `{"seq", "turn", "type", "at", "call_id"?, "receipt"?, "data": {...}}`。切片 0 类型：`turn-started`、`player-declared`、`roll-resolved`、`scene-moved`、`clue-discovered`、`time-advanced`、`turn-finalized`。

## 8. 扩展侧职责（kernel 扩展）

- `session_start`：拉起内核，`kernel.hello`，读 `PI_COC_CAMPAIGN` 选战役（无则通过 ctx.ui 提示并列出 `campaign.list`），`table.open`。`opening_needed` 时注入一条宿主消息要求守秘人 `look` 后 `narrate` 开场；`pending_turn` 时注入恢复消息。
- 七个工具用 TypeBox 定义参数，描述里写清用法与何时用；`resolve.action.intent` 用枚举；`apply.effects` 用 kind 判别联合。工具面固定，不调用 `setActiveTools` 变形。
- `call_id` 铸造：每次会改状态的调用（`resolve`、`apply`、`ask`、`narrate`）递增回合内计数器；读调用不带。
- `before_agent_start`：把玩家 prompt 交给 `table.player_input`，把返回的胶囊作为 `customType: "coc-capsule"`、`display: false` 的消息注入。宿主自己发出的消息（恢复、开场）不是玩家输入，不进 `player_input`。
- `tool_call`：`awaiting_player`/`committed` 拒写；`narrate` 成功后同一批次余下的调用一律 `block` 并说明回合已关闭；`apply`/`resolve` 的名字做大小写与空白归一化。
- `message_end`：带工具调用的助手消息只保留调用块，删掉其中的文本：守秘人在调用前写的过程话不是台词。本回合 `narrate` 或 `ask` 已返回 `rendered_text` 时，把随后那条助手消息的文本整体替换为 `rendered_text`；守秘人在工具之后写的正文被丢弃。玩家可见文字只由 `narrate` 与 `ask` 产生。
- `agent_end`：回合仍在 `acting` 且没有 `narrate`，注入一条宿主消息「回合未关闭，用 narrate 交付」并触发一轮；最多一次。
- 遥测：每次工具调用记录 `{turn, tool, call_id?, started_at, ms, ok, code?}` 到 `.coc/campaigns/<id>/telemetry.jsonl`，每回合结束记录模型往返数。

## 9. 启动器

`bin/pi-coc [--campaign <id>] [pi 参数...]`：
- 仓库根目录为 cwd；`PI_CODING_AGENT_DIR=<repo>/.pi/coc-agent`，无 `settings.json` 时写入 `{"packages": ["<repo>"], "quietStartup": true}`；`--campaign` 导出为 `PI_COC_CAMPAIGN`。
- exec `node_modules/.bin/pi --no-builtin-tools --append-system-prompt prompts/keeper.md --session-id coc-<campaign> <余下参数>`。`--mode rpc` 等 Pi 参数原样透传。

## 10. 真桌驾驭器

`tests/play/driver.py start|turn|stop|log`：以 `bin/pi-coc --campaign <id> --mode rpc --no-session` 起子进程，按 Pi RPC 协议发 `prompt`，收事件直到 `agent_end`，把助手文本、工具调用与结果、耗时写进 `.coc/playtests/<run_id>/`，并把守秘人交付原文打印到 stdout。模型由 `set_model` 命令切换，缺省 `xai/grok-4.5`。
