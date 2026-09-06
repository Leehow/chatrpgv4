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
    world.json           世界状态：active_scene、scene_trail、visited_scenes、discovered_clues、flags、clock、npc_presence
    party/<inv_id>.json  调查员表：来自 pregen 或建卡，含 characteristics、derived、skills、weapons、equipment，加运行时 current_hp/current_san/current_mp/current_luck
    turn.json            当前回合游标：{turn, state, player_text, opened_at, calls: {call_id: {params_sha256, result}}, receipts: [...], pending_choice}
    turns/<NNNN>.json    已关闭回合的完整记录：玩家原文、收据、rendered_text、commit
    transcript.jsonl     逐字记录：{turn, role: player|keeper, text, at}
    events.jsonl         事件流，十二类 canonical 事件见第 7 节
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

### table.apply（切片 0：move、clue、time；保留：handout、item、cash、npc、flag、note、ruling）
params：`{"call_id": "...", "effects": [{"kind": "move", "to": "<场景名>", "travel_minutes"?: int, "label"?: "<玩家语言的短名>"}, {"kind": "clue", "clue": "<线索名>", "how"?: "<一句话>", "label"?: "<玩家语言的短名>"}, {"kind": "time", "minutes": int, "why"?: "..."}, {"kind": "damage", "dice": "1D6", "subject"?: "<调查员>", "why"?: "..."}]}`。`damage` 是没有攻击者的伤（摔落、火烧、坠物）：守秘人给规则书的骰子，内核掷骰、写一条 `roll` 收据与一条 `delta` 收据、更新 HP 与伤口记录；有攻击者的伤走 `resolve`。`move` 的结果带目的地的 `where` 与 `present`，守秘人不必再 `look`。`label` 是守秘人用 play_language 给玩家看的短名，只用于机制块；省略时机制块用图上的 display_name 或 id。
- 整批先校验后写，任一条失败整批不写：`{"code": "...", "details": {"index": i, ...}}`。
- `move`：目的地必须是图上 `route-to` 从当前场景可达的场景，或 `scene_edges` 声明的目的地，或来路上的任何场景（`world.scene_trail`：到达当前场景所经过的场景栈，来路总是可退：没有作者出口的巢穴也能一步退回地窖或一楼）；否则 `not_reachable`，`fix` 里直接写出两份名字，`details.exits` 给出口，`details.back` 给来路（由近到远）。`travel_minutes` 缺省取图上边的值（退一步取反向边），没有则 0。写 `world.active_scene`、`scene_trail`（前进则压入当前场景，退回则截断到目的地之前）、`visited_scenes`、`scene-moved` 事件。旧世界没有 `scene_trail` 时在 `_context` 里按同一规则重放 `scene-moved` 事件一次性补上。
- `clue`：必须是图上存在的 clue 节点，且 `discoverable-at` 当前场景或在当前场景 record 的 `available_clues` 里；否则 `not_here`。已发现的重复写入返回 `replayed: true`，不报错。写 `discovered_clues`、`clue-discovered` 事件。
- `time`：推进世界时钟，写 `time-advanced` 事件。
- 其余种类报 `not_implemented`。
result：`{"receipts": ["move:hall-of-records-t3-c2", ...], "world": {"active_scene", "clock"}, "material_ready": true}`。切片 0 `material_ready` 恒为 true。

### table.ask（切片 0）
params：`{"call_id", "prompt": "<给玩家的问题>", "options": ["...", "..."], "binds"?: "<待决名>", "text"?: "<问题之前的叙述>"}`。
- 记录 `pending_choice = {"name": "<ask-<slug>-t<turn>>", "prompt", "options", "binds"}`，状态进 `asked`，写逐字记录（keeper）。交付 = `text`（可省略）加本回合已落收据的机制块加 `prompt` 与编号选项：玩家先看到那一枪怎么打的，再选闪避还是反击。`text` 里同样不得自写【明骰】【变化】。不再调用 `narrate`。
result：`{"pending_choice": {...}, "rendered_text": "<叙述、机制块、prompt 与选项>", "turn": int, "state": "asked"}`。

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
result：`{"rendered_text": "...", "turn": int, "receipt": "turn:<n>", "commit": "<短 sha>", "facts": {...}, "extraction": {"job_id"}}`；`facts` 与 `extraction` 见 12.5 与 12.3。提交之后的链（检查点、episode、抽取任务）在 12.2–12.3，其中任何一步失败都不撤销已成功的提交：回合已关，失败只进遥测与 backlog。

开桌回合（turn 0）：`table.open` 返回 `opening_needed: true` 时，扩展先让守秘人 `look`，再 `narrate` 开场；此时状态从 `awaiting_player` 直接允许 `narrate`，内核视作 turn 0 的关闭。

## 6. 回合胶囊（切片 0 三节）

`table.capsule` 与 `table.player_input` 返回：
```
{"turn": {"number", "state", "pending_choice": null | {...}, "player_text": "<本回合玩家原文或 null>"},
 "where": {"scene": "<name>", "display_name", "dramatic_question", "pressure_moves": [...], "exits": [{"to", "travel_minutes"?, "unlock_when"?}], "back": [{"to", "display_name"}]（来路，由近到远）,
           "affordances": [{"id", "cue", "clue"?, "npc"?}], "keeper_notes": [...], "assets": [{"name", "kind"}]},
 "present": [{"name", "relationship", "agenda", "voice", "known_facts": [...], "attitude"?}],
 "known": {"discovered_clues": [names], "clues_here": [{"name", "summary", "delivery_kind", "discovered": bool}],
           "investigator": {"name", "occupation", "hp", "san", "mp", "luck", "skills_of_note": [{"name", "value"}]}},
 "recent": [{"turn", "player", "keeper": "<前 200 字>"}]   最近 2 回合
}
```
全部内容都是守秘人专属；`pressure_moves`、`keeper_notes`、NPC 的 `agenda`、`secret` 只能被守秘人当创作参考，不能进玩家文字。每节字节预算：`where` 4KB、`present` 3KB、`known` 3KB、`recent` 2KB；超出按项裁剪并在该节加 `"truncated": true`。

## 7. 事件

`events.jsonl` 每行 `{"seq", "turn", "type", "at", "call_id"?, "receipt"?, "data": {...}}`。十二类 canonical 事件闭合枚举，见 12.1；切片 0 写前七类，切片 1 加 `resource-changed`、`decision-settled`，切片 2 补齐 `session-changed`、`choice-asked`、`memory-written`。

## 8. 扩展侧职责（kernel 扩展）

- `session_start`：拉起内核，`kernel.hello`，读 `PI_COC_CAMPAIGN` 选战役（无则通过 ctx.ui 提示并列出 `campaign.list`），`table.open`。`opening_needed` 时注入一条宿主消息要求守秘人 `look` 后 `narrate` 开场；`pending_turn` 时注入恢复消息，并把 `call_id` 序号从 `last_call_ordinal` 之后接着铸，死掉的进程用过的序号不再复用。
- 七个工具用 TypeBox 定义参数，描述里写清用法与何时用；`resolve.action.intent` 用枚举；`apply.effects` 用 kind 判别联合。工具面固定，不调用 `setActiveTools` 变形。
- `call_id` 铸造：每次会改状态的调用（`resolve`、`apply`、`ask`、`narrate`）递增回合内计数器；读调用不带。
- `before_agent_start`：把玩家 prompt 交给 `table.player_input`，把返回的胶囊作为 `customType: "coc-capsule"`、`display: false` 的消息注入。宿主自己发出的消息（恢复、开场）不是玩家输入，不进 `player_input`。
- `tool_call`：`awaiting_player`/`committed` 拒写；`narrate` 成功后同一批次余下的调用一律 `block` 并说明回合已关闭；`apply`/`resolve` 的名字做大小写与空白归一化。
- `message_end`：带工具调用的助手消息只保留调用块，删掉其中的文本：守秘人在调用前写的过程话不是台词。本回合 `narrate` 或 `ask` 已返回 `rendered_text` 时，把随后那条助手消息的文本整体替换为 `rendered_text`；守秘人在工具之后写的正文被丢弃。守秘人写了正文却没调 `narrate` 就收工时，宿主替它关回合：剥掉自写的【明骰】【变化】行后把正文作为 `text` 调 `table.narrate`；内核留有 `for: player` 的待决时改调 `table.ask`，正文是 `text`，问题、选项与 `binds` 取自待决。交付仍是内核渲染的文本。只有正文为空（只想不说）时才催一次。玩家可见文字只由 `narrate` 与 `ask` 产生。
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

`action` 在切片 0 的字段之外接受（扩展的工具表必须逐一声明，否则模型无处可填）：`san_loss`（理智检定的成功/失败损失表达式，如 `0/1D6`）、`involuntary`（理智失败时的失控行为，`faint`、`flee`、`scream`、`freeze`、`attack` 之一）、`outcome`（结束战斗时的结果）、`skills` 与 `mode`（合并检定）、`motive` 与 `support`（社交判定里 NPC 倾向与玩家实证）、`interrupted`（施法）、`rest`（每周恢复条件）、`ending`（结束会话的结局种类）；以及：`weapon`（武器名，攻击时用；`unarmed` 表示徒手）、`spell`（法术名）、`defense`（`dodge` 或 `fight_back`，回应待决防御时用）、`push: true`（对上一次失败检定推骰，`stakes` 必填，是宣告的后果）、`luck: <点数>`（花幸运补上一次检定）。`actor` 可以是 NPC 名：守秘人替 NPC 行动时用，比如战斗里 NPC 的回合。

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
- 推骰与幸运的源是该行动者最近一次 D100 技能或特征检定；已推过、已通过、先花幸运再推都报 `turn_state`；无可推的检定报 `needs` 字段 `intent`；幸运不足报 `invalid_params` 带 `details.reason`。
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

### 12.1 事件批：十二类

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
| `turn-finalized` | `narrate` | `{receipts, placement, commit?}` |

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
 "player_text": "...", "keeper_text": "<rendered_text 去掉【明骰】【变化】【第 n 轮】行>",
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

- **memory**：params `{"what": "memory", "about"?: [名], "turns"?: [from, to], "kinds"?: [...], "include_superseded"?: bool, "limit"?: ≤ 30}`。收窄全是确定性的：名字按图上名字与别名归一化后精确匹配 `subject`、`knowers`、`entities`；`turns` 落在 `valid_from_turn`；缺省不含已关闭的。排序：与 `about`（缺省取当前在场实体加调查员）重叠数多者先，再按 `valid_from_turn` 晚者先。result `{"what": "memory", "about": [...], "hits": [{"id", "kind", "subject", "knowers", "entities", "statement", "privacy", "state", "confidence", "status", "turn", "superseded_by"?}]}`。不接受散文筛选，没有关键词与正则。
- **transcript**：params `{"what": "transcript", "turns"?: [from, to], "role"?: "player"|"keeper", "read"?: {"turn", "role"}}`。不带 `read` 时返回 `cards: [{"turn", "role", "chars", "head": "<前 80 字>"}]`（区间缺省最近 3 回合，最多 40 张），并在区间 ≤ 3 回合时同时返回切片 0 的 `entries`；带 `read` 时返回 `{"turn", "role", "text", "verified": bool}`，`verified` 表示逐字记录里的文本与 `turns/NNNN.json` 记录（守秘人取 `rendered_text`，玩家取 `player_text`）的 sha256 一致；不一致仍返回文本但 `verified: false`。
- **history**：params `{"what": "history", "turns"?: [from, to], "types"?: [事件类型], "diff"?: [turn_a, turn_b]}`。result `{"timeline": [{"turn", "commit", "scene", "clock", "closed_by", "receipts": {"roll": n, "move": n, "clue": n, "delta": n, "session": n, "time": n}, "head": "<守秘人交付前 60 字>"}], "events": [...]（按 `types` 过滤，最多 200 条，缺省不含 `player-declared` 之外的原文）, "diff"?: {"from", "to", "scene": [a, b], "clock": [a, b], "clues_added": [名], "resources": [{"subject", "resource", "from", "to"}], "sessions": [{"turn", "family", "transition", "outcome"?}], "moves": [{"turn", "from", "to"}]}}`。`diff` 只从回合记录里的收据累计，不读 git 对象。

三路都在 `open`、`acting`、`asked`、`awaiting_player` 任何状态可调，只读；写状态的调用照旧要在回合内。

### 12.5 事实清单与校验车道

`narrate` 结果里的 `facts`：

- `committed`：本回合已提交的事实，每条一句 play_language，确定性地从收据与世界状态生成：每条 `roll` 一句（谁、什么检定、过没过）、`move` 一句、`clue` 一句、`delta` 一句（资源 前 → 后）、`session` 一句、`time` 一句，再加「地点：<display_name>」与「在场：<名字>」。
- `keeper_only`：本场景尚未发现的线索（名字与摘要）、在场 NPC 的 `agenda` 与 `secret`、模组级秘密里与本场景相关的条目；总量 ≤ 2KB，超出按项裁剪。

校验车道在 kernel 扩展内：交付完成后（`message_end` 替换之后）用 Pi SDK 起零工具内存会话，模型由 `PI_COC_VERIFIER_MODEL`（`provider/model`）指定，缺省与桌子同模型；输入是 `rendered_text` 去掉机制行后的正文、`facts.committed`、`facts.keeper_only`，要求只返回 JSON：

```
{"findings": [{"kind": "reveal"|"uncommitted_state"|"player_agency", "quote": "<正文里的原句，≤ 120 字>", "why": "<≤ 200 字>"}]}
```

三类分别是：越权揭示了 `keeper_only` 里的事实；声称了 `committed` 里没有的状态变化（走了没 move、拿了没 clue、掉了没 delta）；替玩家做了未授权的自愿行为。扩展把结果交给 `table.warn`，params `{"campaign", "turn", "lane": "verifier", "findings": [...]}`：内核校验 `kind` 枚举，`quote` 必须是该回合 `rendered_text` 的子串（唯一的确定性锚点；不是子串的整条丢弃并记 `dropped`），最多 10 条；写进 `turns/NNNN.json` 的 `warnings`、遥测一行，并在**下一次** `player_input` 的胶囊里带 `warnings: [{"turn", "kind", "quote", "why"}]`（只带最近一个已提交回合的，≤ 1KB）。全部 advisory：不改状态，不拦交付，不重开回合。车道不用关键词、不用正则；能确定性判的（自写骰面、未关的 `needs`）仍在内核。

零工具子会话是规格第六、九节定下的形状：产出是 ≤ 12 条候选或 ≤ 10 条发现的短 JSON，远在单条助手消息的上限之下，不是把整本书塞进一次补全。Pi 0.85.1 里扩展够得着的面是 `ctx.modelRegistry.complete`（一次不带工具的补全，复用当前会话的注册表与鉴权），扩展里起不了嵌套 agent 会话；这条路的边界记在 `docs/pi-host-contract.md` 3.1 与第 5 节。车道跑成功就调一次 `table.warn`，`findings` 为空也调：内核由此分得清「跑了没发现」与「没跑」，所以 `table.warn` 必须收 `findings: []`。校验车道选 `why` 的语言用 `table.open` 结果 `campaign.play_language`。

### 12.6 崩溃恢复与幂等

- `acting` 与 `committed` 之间死掉：`table.open` 从 `turn.json` 给 `pending_turn`（含 `last_call_ordinal`），守秘人接着做完；已落收据不重掷（`resolve`/`apply` 的 `call_id` 幂等回放）。
- `narrate` 提交后、写检查点或 episode 之前死掉：重开时检查点从 HEAD 重建；episode 与抽取任务缺失时 `memory.job` 仍能按 `turn` 从回合记录出任务。
- 同一 `call_id` 的 `narrate` 重放返回已存的结果，不再提交；这是唯一的「不重复提交」机制，扩展不做补偿。

### 12.7 胶囊新增节（切片 2）

- `memory`（≤ 1.5KB）：`recall memory` 缺省排序的前 6 条命中，字段同 12.4；没有候选时为空数组。
- `warnings`（≤ 1KB）：12.5。
- `resume`：12.2，只在重开后的第一回合出现。

### 12.8 扩展侧职责（切片 2）

- kernel 扩展：`narrate` 成功后在总线上发 `coc:turn-committed {campaign, turn, commit, job_id, facts, rendered_text}`；交付替换完成后自己跑校验车道并 `table.warn`。车道出错只写遥测（`lane: verifier, ok: false`），不催守秘人，不阻塞。
- memory 扩展（`extensions/memory`）：订阅 `coc:turn-committed`，`memory.job` → 零工具子会话（模型 `PI_COC_MEMORY_MODEL`，缺省与桌子同模型）→ `memory.submit`；失败一次重试，再失败 `memory.fail`。同一时刻只跑一个任务，后来的排队；进程退出时未完成的任务留给下次 `memory.job` 缺省派发。
- 两条车道的 RPC（`memory.job`、`memory.submit`、`memory.fail`、`table.warn`）不带 `call_id`、不看回合状态；结果按 `turn` 落到对应回合记录，晚到也收。memory 扩展派任务时给显式 `turn`（刚提交的那一回合）；`memory.job` 的缺省派发只在重开进程后补漏时用。
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

