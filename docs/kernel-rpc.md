# 内核 RPC 契约与回合事务

The versioned gameplay Mod interface is specified in section 26. Mod packages do not import kernel internals or Pi objects.

本文件是 Pi 扩展与 TypeScript 内核之间的唯一契约。当前生产实现只在 `kernel-ts/`；进程组合见 §27。两侧的实现和接缝测试都以现行契约为准；改契约先改这里。历史切片编号记录实施顺序，不表示当前仍待实现；功能的现行状态以对应小节的最新决定为准。

PDF 直接阅读与按需构图的现行契约见 §22。§14 与 §20 的旧 PDF/OCR 流水线仅保留为历史记录，不是生产入口。实施、退役与验收证据见 [规格](specs/visual-pdf-reader.md)。

规格全文见 GitHub issue #12，切片 0 的验收见 #13。

## 1. 进程与传输

- 一个 Pi 会话一个内核子进程。扩展在 `session_start` 拉起，`session_shutdown` 关闭。
- 宿主按 §27 捕获部署配置并启动编译后的 `build/kernel/rpc.mjs`；业务调用者不自行拼启动命令。战役状态根目录与只读内容目录由宿主传入，内核只在前者的 `.coc/` 下写状态。源码模式与独立包都使用 TypeScript，不回退 Python。
- stdin 收请求，stdout 发响应，一行一个 JSON 对象，`\n` 分隔，UTF-8。stderr 只写日志。
- 请求：`{"id": "<string>", "method": "<string>", "params": {...}}`。
- 成功：`{"id": "<同请求>", "ok": true, "result": {...}}`。
- 失败：`{"id": "<同请求>", "ok": false, "error": {"code": "<闭合枚举>", "message": "<给模型看的一句话>", "fix": "<可直接照做的修正，可省略>", "details": {...可省略}}}`。
- 进度帧（本切片）：请求可带顶层字段 `"progress": true`（不进 `params`，不参与 `call_id` 的幂等哈希）。只在此标记存在时，内核才允许在最终响应之前发零或多条进度帧：`{"id": "<同请求>", "progress": {"stage": "<该方法小节的闭合枚举>", "detail"?: "<一句英文>", "at": "<iso>"}}`。进度帧不结算调用：客户端仍以 `ok`/`error` 帧为准；进度帧不得携带结果数据。未请求 `progress` 的调用永远收不到进度帧——旧客户端、驾驭器与 §23 的 Electron 桥的字节流形状不变。
- 内核不并发处理请求：按到达顺序逐个执行。扩展负责序列化。
- 内核崩溃或退出时扩展重新拉起并调用 `table.open`；所有状态都在磁盘上，内核进程无内存权威。

错误码闭合枚举：`invalid_params`、`unknown_method`、`not_implemented`、`campaign_not_found`、`campaign_not_ready`、`turn_state`（当前回合状态不允许该方法）、`idempotency_conflict`、`needs`（缺少可补的输入，`details.needs` 给字段与可选值）、`needs_choice`（多个互斥候选，`details.candidates`）、`unknown_entity`（名字在模组图与世界状态中都找不到，`details.candidates` 给相近名字）、`not_reachable`（移动目的地不可达）、`not_here`（线索不在当前场景可得）、`commit_failed`（git 提交失败，回合未关闭）、`internal`。

Every failure also carries `retryable` and `next`. `retryable` is true only when the exact
request is safe to send again; `next` is a closed recovery action: `retry_same`,
`change_input`, `narrate`, `ask`, or `stop`. `needs`, `needs_choice`, `invalid_params`,
`unknown_entity`, `not_reachable`, and `not_here` use `change_input`; `commit_failed` and
`operation_in_progress` use `retry_same`; `internal` is never an unchanged retry and uses
`stop`. Other infrastructure failures use `stop` unless their implementation explicitly
selects a safer action. The host projects both lines into the agent-visible tool result
unconditionally, independently of `fix` and `details`.

Section 26 adds two closed host-document error codes: `not_owned` refuses access
after ownership changes; `revision_conflict` refuses a stale document/worldline
write while preserving the client draft. Hot and cold UI bridges retain these codes.

### 1.1 内核的决定（进度帧）

- **opt-in 而不是常开。** 进度帧只在请求带顶层 `"progress": true` 时发出：驾驭器、§23 的 Electron 桥与任何旧客户端的字节流一行不多，不需要同时改。字段放顶层而不进 `params`，是为了不碰 `call_id` 幂等哈希（§2）。
- **帧是真实阶段边界，不是心跳。** 内核只在流水线真的走过一个阶段时发帧，不发定时器，不报「预计剩余」；慢的真相（比如 git 提交占大头）由帧间间隔自己说出来，不被平滑掉。
- **冻结 Python 对照不发帧，也不补新功能。** 生产内核是 `kernel-ts`；历史对照保持固定版本的一问一答。进度帧的新断言直接检查 TypeScript，不修改对照缓存。

## 2. 标识法

- 模型可见的一切标识都是名字或语义 id：场景用图上的 `scene_id` 去掉 `scene-` 前缀后的 kebab 名，也接受图上的 `display_name` 与 `name`；NPC、线索、物品同理接受 id 或名字，内核做归一化，歧义时报 `unknown_entity` 并给候选。
- 归一化折叠重音（#64）：名字先做 NFKC，再去掉 Unicode 会合成到基字母上的记号（`á`→`a`、`ệ`→`e`、`ñ`→`n`）。图的 `node_id` 按 §14.11 是全 ASCII kebab 而 `name`/`aliases` 保留书的拼法，所以一个只差重音的名字两个方向都能解析到自己的节点（`Nemesio Sánchez` → `npc-nemesio-sanchez`；`padre inigo munoz` → `Padre Iñigo Muñoz`）。从不合成的记号（天城文元音符号、泰文声调、阿拉伯文短元音）不是重音，照旧参与比较，`किरण` 与 `करण` 仍是两个名字。折叠后相等的两个节点报 `unknown_entity`（歧义）并给全部候选，不静默选一个。头衔前缀（`Professor …`）不折叠：那要一张词表，是语义不是记号。
- 整词连续片段回退（#64 后半）：两条精确路都落空（handle 不等、`name`/`aliases`/id 索引无键）之后，内核把归一化后的查询按空白切成词，在每个候选节点的每个归一化名键里找**同样顺序、不间断的整词连续片段**：`nemesio sanchez` 在 `professor nemesio sanchez` 里命中，`nemesio sanchez` 在 `dr. nemesio sanchez jr.` 里也命中；`emesio sanchez`、`nemesio sanch` 都不命中（词内子串不算），`nemesio ... sanchez` 中间隔着别的词也不命中。这是机械匹配，没有头衔词表，也不会有：`Professor`、`Dr.`、`Padre` 对内核只是多出来的词。只在恰好一个节点命中时才解析；多个节点命中报同样的 `unknown_entity`（歧义）并给全部候选，零个命中报原来的 `unknown_entity`（未找到）。**今天能解析的答案一个都不变**：回退在精确路之后，一个查询精确命中 A 又是 B 名字的片段时仍解析到 A。收紧到形状允许的最小：查询至少两个词（单个词仍是给 `candidates`/`look` 的线索，不是身份，否则 `resolve` 管线里玩家自由文本的目标词 `door`、`key`、`professor` 会开始悄悄绑定到节点），且片段严格短于名键（等长本该是精确命中）。**变松的范围**：`resolve`/`find` 对所有 kind、所有调用方生效（`apply npc/clue/move/handout`、裁定锚点、`look npc`、`resolve` 管线的目标与支撑线索、法术目标、记忆 `about`），kebab id 也是名键，所以 `old house` 会解析到唯一含它的 `scene-the-old-house`；`find` 遇到歧义照旧返回 null，不会挑一个。
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
open|acting      --table.player_input release:"stranded"-->  open   上一轮守秘人没交付就结束了；搁浅回合按 closed_by: "stranded" 落记录，开 turn+1（第 38 节）
```

- `awaiting_player` 与 `committed` 期间，除 `table.open`、`table.status`、`table.capsule`、`table.look`、`table.lookup`、`table.recall` 外一切方法报 `turn_state`。
- `narrate` 成功后内核自行把状态推到 `awaiting_player` 并递增 `turn`；「交付完成」是扩展侧的事，内核不等待。
- 玩家发出的每一句话都必须终结于一个可见结果：正常交付，或一条说明本轮没有完成的服务通知。`open`/`acting` 的回合若代理运行已经 `agent_settled` 而什么都没交付，宿主不猜原因，直接标为搁浅；下一条输入用 `table.player_input` 的 `release: "stranded"` 把它按 `closed_by: "stranded"` 落记录并开新回合。不叙述、不提交、不把失败当成裁决；仍在运行或同轮已经恢复并交付的情况不算搁浅。契约见第 38 节。
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
params：`{"text": "<玩家原文>", "release"?: "stranded"}`。
- 状态必须是 `awaiting_player` 或 `asked`，否则 `turn_state`；带 `release: "stranded"` 时 `open`/`acting` 也接受（第 38 节），其余状态带这个参数报 `invalid_params`。写逐字记录，开新回合，`turn.json` 进 `open`，发 `turn-started` 与 `player-declared` 事件。
result：`{"turn": int, "state": "open", "capsule": {...见第 6 节}}`。

### table.capsule（切片 0）
result：胶囊，同第 6 节。任何状态可调。

**Approved bounded-context amendment (2026-09-15; implementation/integration and live acceptance pending).**
See [bounded-play-context](specs/bounded-play-context.md), D5–D8. Host-only params add
`rehydrate?: boolean`. `rehydrate: true` forces the existing full module briefing, craft context
and active Mod instruction builders; it does not reopen a turn, consume `firstStyleTurn` or
pending resume, write files, or change game state. Ordinary calls retain their lifecycle.
The existing result envelopes are retained: `table.capsule` returns its capsule fields directly,
with transport-only `_context` alongside them; it does not gain a new `capsule` wrapper.
`table.player_input` keeps `{turn, state, capsule}` and adds the same sibling metadata:
`_context: {version: 1, campaign, worldline, loop, turn, source_revision, memory_coverage}`.
`source_revision` is an opaque digest of the effective briefing sources, including the module
and active packages. If optional binding-source I/O is unavailable, return `source_revision: null`
with `unavailable: true` and a bounded reason; the host must retain a conservative context rather
than claim a valid rebase. Coverage I/O failure is reported separately as
`memory_coverage.status: "unavailable"`, with unknown counts left unknown. Neither advisory path
may turn a successfully opened player turn into a failed reply. Legacy scene-trail reconstruction
for `rehydrate: true` stays in the read snapshot, never on disk.
The host stores this binding on the injected message; opaque identity is not model-visible.
This is a read/cache identity, not a new authoritative state store.

`memory_coverage` is bounded to 4096 serialized UTF-8 bytes: recent pending/failed committed-turn
ranges, counts of older gaps, and public recall arguments to page their existing history.
It derives from existing turn records and memory job/backlog state, without new mutable memory
files or synchronous extraction. Successful-empty extraction is complete but does not guarantee
semantic coverage. The Keeper may recall an original when a gap matters; gaps never create plot
obligations. Candidate ranking adds the current scene and up to four most-recent acquired evidence
names, using existing continuity evidence predicates, to present NPCs and investigators. Keep
correction-first ordering, the six-row/section-byte budget, and `conversation_report` authority.
Inherited worldlines follow canonical restore snapshots, not equality filters on candidate origins.
The task-3 outbound/fold policy will cache and invalidate this rehydration by context epoch;
that host consumption is not claimed implemented by this contract amendment.

### table.status（切片 0）
result：`{"turn": int, "state": "...", "receipts": [...本回合收据摘要], "mechanics": [...本回合的 §16.2 投影], "labels": {...玩家语言词表}, "pending_choice": null | {...}}`。
- `mechanics` 与 `labels` 是交付时那张卡的同一份投影与同一份词表（§16.2、§23）；一条没能交付的回合靠它们把已结算的事实送到玩家面前（§50）。

### table.look（切片 0）
params：`{"focus"?: "scene"|"npc"|"investigator"|"clues"|"time", "name"?: "<实体名>"}`。
- 缺省等价于 `focus: "scene"`。`focus: "npc"` 且给 `name` 返回该 NPC 的完整守秘人视图：agenda、fear、secret、voice、relationship、keeper_note、social_role、已知事实。`focus: "investigator"` 返回当前调查员表的玩家可见部分加运行时数值。`focus: "clues"` 返回已发现与当前场景可得的线索。`focus: "time"` 返回世界时钟。
result：见第 6 节的 `where`、`present`、`known`，按 focus 取子集；`npc` 与 `investigator` 返回单实体对象。

### table.lookup（切片 0：module、secret；rule、catalog 已实现，见 §58.5）
params：`{"kind": "module"|"secret"|"rule"|"catalog", "query": "<名字或问题>", "kinds"?: [...], "scope"?: "scene"|"module"}`。
- `module`：在模组图节点名、别名、摘要上做归一化子串匹配，返回最多 8 个实体：`{"name", "kind", "summary", "visibility", "relations": [{"kind", "to"}]}`。
- `secret`：`scope` 缺省 `scene`。返回当前场景的守秘人专属简报：`{"scene": {...dramatic_question, pressure_moves, keeper_notes}, "undiscovered_clues": [{"name", "summary", "delivery_kind"}], "npc_secrets": [{"name", "secret", "agenda"}], "module_secrets": [{"name", "summary"}]}`。`scope: "module"` 给整模组的 `secret` 与 `conclusion` 节点。
- `rule`：在规则索引上搜索规则节点。
- `catalog`：搜索规则书自己的印刷记录（装备与物价表、武器、法术、生物、技能……），每行带印刷金额、货币与页面出处；用 `kinds` 收窄（`item` 就是物价表），返回的 `price_id` 直接交给 `apply cash`。**这一行历史上写着「报 `not_implemented`」，而实现从来都在；工具描述照抄了这句，守秘人因此一次都没去取过物价。见 §58.5。**

### table.recall（切片 0：transcript；切片 2 三路齐全，见 12.4）
params：`{"what": "transcript"|"memory"|"history", ...}`，三路各自的参数与结果在 12.4。
- `transcript`：缺省最近 3 回合的有界卡片，不隐式返回全文；原文分页与完整性校验见 12.4 的新契约。

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
- `cash`（#19，§58）：`{"kind": "cash", "subject"?: "<调查员>", "delta": <整数，货币单位随时代>, "source": "price"|"quote"|"found", "price_id"?: "<印刷记录 id，source=price 必填>", "currency"?: "<这笔钱的单位>", "with"?: "<NPC 名>", "why"?}`；**`source` 必填**：钱的数额必须说明来源，`price` 由内核到规则书印刷物价表里解析 `price_id`（解析不到就拒），`quote` 要 `with`（场上谁开的价），`found` 是不涉及价格的进出。`currency` 与余额单位不一致直接拒——内核没有汇率表，不替任何人换算。玩家说的自己兜里有多少是余额不是价格；余额与本局已成交的价在胶囊 `known.investigator.cash` 与 `known.prices_paid` 里。全文见 §58；`with` 是钱的另一头（付给谁、从谁那儿来），落进那个人的账本 `exchanged`（§17.3）与机制投影；不写就只是钱数变了，没有对方。写表上 `finance.cash`（没有 finance 块的时代按 `rules-json/cash-assets.json` 建一个），收据 `cash:t<turn>-c<n>`，渲染 `【变化】现金：<人> <前> → <后>`（没有 `label`，标签固定为 play_language 的「现金」），事件 `resource-changed`（`resource: cash`）。
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

开桌回合（turn 0）：`table.open` 返回 `opening_needed: true` 时，扩展先让守秘人 `look`，再 `narrate` 开场；此时状态从 `awaiting_player` 直接允许 `narrate`，内核视作 turn 0 的关闭。开场也允许两类 Mod 写：带 `action.decision` 的 `resolve`（该 decision 必须是活跃 Mod 贡献的检查——与内核 `allowOpening` 同一条规则，`kernel-ts/resolve/index.ts` 按 `activeMods.contributes.checks` 比对）与仅含 `define`/`object`/`ability` 的 `apply`；两者都要求 `coc:mods-bridge` 已宣布。`decision` 若被挂在调用顶层而不是 `action` 里（schema 的家在 `action.decision`），扩展在判定前把它归一到 `action`，不再让一次合法开场骰死于字段摆放；Mod 桥尚未宣布时，这类调用先短暂等待桥就位（`PI_COC_MODS_WAIT_MS`，缺省 1500，0 关闭），超时后的拒绝只说桥未就绪、可重试（`cause: "mods_bridge_pending"`），不使用「等玩家说话」的关闭态文案。

## 6. 回合胶囊（切片 0 三节）

`table.capsule` 与 `table.player_input` 返回：
```
{"turn": {"number", "state", "pending_choice": null | {...}, "player_text": "<本回合玩家原文或 null>"},
 "where": {"scene": "<name>", "display_name", "dramatic_question", "pressure_moves": [...], "exits": [{"to", "travel_minutes"?, "unlock_when"?}], "back": [{"to", "display_name"}]（来路，由近到远）,
           "affordances": [{"id", "cue", "clue"?, "clues"?: [{"clue", "gate", "discovered"}], "npc"?}]（§32.5：`clues` 是这条线索行的产出与门，`clue` 仍是第一条）, "keeper_notes": [...], "assets": [{"name", "kind"}],
           "places": [{"name", "line"?}]（≤ 8；本场景 `occurs-at` 的地点下面 `located-in` 的房间——书把一栋楼建成「地点 + 一串房间」，只看离场景一跳就永远看不见它们）,
           "rules": [{"name", "line"?}]（≤ 6；本场景 `uses-rule` 指向的 rule 节点：书为这一场固定的判定与数值。每次构建都接对了这条关系，此前没有任何消费者）,
           "endings": [{"name", "via", "line"?}]（≤ 4；本场景 `may-lead-to` 的 ending 节点。结局不是走过去的地方——`WALKABLE_KINDS` 只有场景，且是有意的——它是一次结算（`development:settle-ending`）。此前没有任何东西告诉守秘人有一个够得着，于是一局玩到头就那么停住：巫师被毁，作者写好的收束从未结算，战役状态还是 `active`）},
 "present": [{"name", "role", "wants", "fears"?, "hides"?, "voice"?, "knows": [...], ...}]（§17.4 起是档案加账本，旧的 relationship/agenda/known_facts/attitude 已删）,
 "known": {"discovered_clues": [names], "clues_here": [{"name", "summary", "delivery_kind", "gate"（§32.5）, "discovered": bool}],
           "investigator": {"name", "occupation", "sex", "hp", "san", "mp", "luck", "skills_of_note": [{"name", "value"}]}},
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
- `tool_call`：同名同参的调用在本回合被内核拒过两次后第三次拦下，理由里复述上次的错误（原样重发不会有不同结果）；`awaiting_player`/`committed` 拒写（开场 Mod 车道例外，见 §5：带 `action.decision` 的 resolve 与纯 define/object/ability 的 apply 在开场放行，顶层 `decision` 先归一进 `action`；Mod 桥未就绪时给可重试的桥未就绪文案，而不是关闭态文案）；`narrate` 成功后同一批次余下的调用一律 `block` 并说明回合已关闭；`apply`/`resolve` 的名字做大小写与空白归一化。
- `message_end`：带工具调用的助手消息只保留调用块，删掉其中的文本：守秘人在调用前写的过程话不是台词。本回合 `narrate` 或 `ask` 已返回 `rendered_text` 时，把随后那条助手消息的文本整体替换为 `rendered_text`；守秘人在工具之后写的正文被丢弃。守秘人写了正文却没调 `narrate` 就收工时，宿主替它关回合：把正文原样作为 `text` 调 `table.narrate`。内核因玩家语言脚本核退回（`play_language_mismatch`）时**不交付**：宿主把这条助手消息里的正文块丢掉（被拒的草稿不能当交付立着），在 `agent_end` 带着内核自己的 `fix` 催一次，下一轮的 `narrate`/`ask` 才关回合。这是唯一的确定性地板（数字核已于 2026-09-09 移除，宿主再也不催守秘人往正文里补数字）。

内核留有 `for: player` 的待决（战斗里的防御）而守秘人只写了正文时，宿主**不替它问**：内核铸的待决 `prompt` 是英文的守秘人用语（§16.1），摆到玩家面前就破了「玩家看的字只由守秘人按 play_language 写」。宿主丢掉这份草稿、催一次（`agent_end` 那条已有的待决催促），由守秘人自己用玩家的语言 `ask`。同一回合已经催过还是只写正文，就按 `narrate` 关掉回合：待决留着，胶囊下一回合照样把它摆出来，回合不挂死。

交付是守秘人的正文，外加一条 `coc-mechanics` 会话条目（§16.2 的 JSON，前端与驾驭器由此渲染，TUI 不显示；投影为空时不发）。只有正文为空（只想不说）时才催一次。玩家可见文字只由 `narrate` 与 `ask` 产生。
- `agent_end`：回合仍在 `acting` 且没有 `narrate`，注入一条宿主消息「回合未关闭，用 narrate 交付」并触发一轮；最多一次。
- 遥测：每次工具调用记录 `{turn, tool, call_id?, started_at, ms, ok, code?}` 到 `.coc/campaigns/<id>/telemetry.jsonl`，每回合结束记录模型往返数。

### Host decision: what a `fix` names in `details`, the model sees (2026-09-10, #66)

A refusal reaches the model as text: `code: message`, `fix: ...`, then lines the host
projects out of `details`. `details` itself never reaches the model (it holds handles,
internal ids and candidate sets sized for the interface), so the projection used to be a
list of the keys someone had once needed -- `needs`, `candidates`, `conflicts`, `exits`,
`fields` -- and every producer that pointed its `fix` at another key was pointing at
nothing. Real play (#66): `reading_timeout` said "the exact focus and question in
details.read; do not invent another question", and `details.read` was not in the list. The
same shape sits in the kernel: `set action.defense to one of details.options`,
`discover one of details.clues_here`, `reveal one of details.echoes`, `name one of
details.lines`, `details.suggested lists ...`, `details.engine_contract is ...` -- none of
those keys was projected either.

Recovery is structural rather than prose: **`retryable` and `next` are always rendered**
to the model, independently of `fix` and `details`. They distinguish a safe unchanged replay
from a required input change or a safe fallback, without changing refusal budgets,
idempotency, or the rule that a failed batch has no effect.

The rule, now structural rather than a list: **every `details.<key>` a `fix` text names is
rendered to the model**, as one line `<key>: <compact JSON>` after the bespoke lines. The
host reads the key names out of the `fix` text itself (`details.<key>`; a deeper path such
as `details.needs.options` names `needs`), so a producer that writes a `fix` has, by
writing it, chosen what travels -- there is no second list to keep in step, in this
extension or in the kernel. Keys the `fix` does not name stay where they were: a
`job_id` beside `details.read` is for telemetry, not the model. The bespoke renderers are
kept unchanged for the keys they already cover, so no existing line changes shape; the
generic line is added only for named keys they did not render. A named key whose value is
absent renders nothing -- the host does not invent what the producer did not supply -- and
that mismatch is a producer defect to fix at the producer. A long list is cut at an element
boundary with a count of what was left out, never silently.

Producers therefore keep two obligations, both already in §14.15's spirit: put the
actionable part in `details`, and name it in `fix` by its key. Naming a key that is not
there, or supplying a key the `fix` never names, both leave the Keeper unable to take the
recovery path it was pointed at.

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
- `effects` 的 `kind` 另有 `skill`（成长）与 `condition`（治疗）。隐藏骰分两档（§16.5）：`visibility: keeper` 的骰（玩家根本不知道掷过，如暗中的侦查）有收据不渲染；`visibility: concealed` 的骰（玩家自己声明了行动、规则要求不给骰值，如心理观察）渲染一行只写检定名与「暗骰」，不带任何数字；NPC 的公开对抗骰渲染时带 `名字·` 前缀；推骰行带 `（推骰）`。
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

### 12.1 事件批：二十三类

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
| `journal-written` | `journal.submit`（§17.10） | `{job_id, turn, entries: n}` |
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

#### Approved bounded recall contract (2026-09-15)

This amendment implements the interface decisions in [bounded-play-context](specs/bounded-play-context.md),
D1/D6/D7/D8. The bounded recall implementation and migrated contract tests are integrated; real-table acceptance
remains pending. The legacy evidence below is not proof of the new bounds. Keep the seven verbs and existing filters/history fields wherever
compatible. All three modes cap each serialized JSON response at **12288 UTF-8 bytes (12 KiB)**,
including annotations and continuation metadata. Listings contain at most **20 rows** per page;
text pages contain at most **4096 Unicode code points**, shortened further to fit total response
bytes. No all-text/unlimited escape exists, and original files are never shortened.

Public `recall` arguments (beside existing query filters) add:

```
read?: {turn: integer, role: "player"|"keeper", offset?: integer >= 0, limit?: integer >= 1}
page?: {offset?: integer >= 0, limit?: integer >= 1,
        section?: "cards"|"timeline"|"events"|"diff"|"hits"}
detail?: {section: "cards"|"timeline"|"events"|"diff"|"hits", index: integer >= 0,
          offset?: integer >= 0, limit?: integer >= 1}
```

- **Transcript browse:** `what: "transcript"`, existing `turns`/`role` filters, default last
  three turns. Cards only even for one-to-three-turn ranges; never automatic `entries`.
  Cards expose turn, role, total character count, a bounded original head, and a complete public
  `read` reference. `page` selects listing rows in the stable turn/role order; its offset defaults
  to 0 and limit to 20, with byte pressure allowed to reduce the actual row count.
- **Transcript read:** `read` selects one original utterance. Offset defaults to 0 and limit to
  4096 code points. Return total characters, actual returned range, `truncated`, and exact `next`
  arguments; next offsets follow the actual returned end without splitting surrogate pairs.
  Verify the complete original against the canonical turn record before slicing. Preserve
  `verified` and `verification_scope: "record_integrity_only"`: matching recorded words is not
  module truth, nor an authority upgrade. A failed comparison stays unverified, not repaired.
- **History:** default range remains the latest 20 turns. Default section is `diff` when `diff`
  is supplied, otherwise `events` when `types` is supplied, otherwise `timeline`. Select other
  sections explicitly with `page.section`. Each response returns only the selected section's
  rows (`timeline`, `events` or `diff`), not all three collections. Preserve event filters,
  timeline fields and receipt-derived changes. The new diff wire shape is
  `{from, to, diff: [{kind: "scene"|"clock"|"clue"|"resource"|"session"|"move", ...}]}`:
  `from`/`to` are top-level turn bounds; `diff` is an ordered, pageable row list, not the legacy
  nested full-diff object below. Omitted/more metadata and `next` identify remaining rows.
  Oversized rows expose their type/turn where applicable and a `detail` locator, never an
  apparently complete silently truncated fact. Existing internal `lines`/`line`
  capabilities retain their worldline semantics; they gain no public schema exposure in this slice
  and cannot bypass the response ceiling.
- **Memory:** retain `about`, `turns`, `kinds`, `include_superseded` and existing deterministic
  entity selection/ordering; expose the already accepted `promise` kind. Legacy top-level `limit`
  remains a positive requested memory page size (default 12), clamped to 20; larger legacy requests
  are accepted and clamped, not schema-rejected. `page.limit` takes precedence.
  Remaining `hits` page within one stable source snapshot. Keep candidate `status`, `state`,
  correction/supersession/source annotations and `authority: "conversation_report"`. Missing or
  superseded evidence does not become a current fact; no semantic classifier or promotion is added.
- **Structured detail:** `detail` selects one row by its section and zero-based snapshot index,
  returning that original row's JSON serialization as bounded `text` pages, with total/range,
  `truncated` and `next`. Its offset/limit count Unicode code points, default 0/4096. This is not
  transcript `read`, not a summary, and not a bypass of the response cap. Concatenated pages
  reconstruct the original structured row's JSON text.

Every returned `next` or `read`/`detail` reference is a **complete public recall argument object**,
including `what` and relevant query filters, not a fragment or a model-copied opaque cursor.
Context reconstruction uses this same RPC with host-only `_context_read: true`: it reads canonical
records without advancing `open` to `acting` or persisting legacy cache repair. The Keeper tool
strips that private flag from model-supplied arguments. The internal bridge retains raw snapshot
metadata for its own paging and registers returned public references with the same host-owned
binding store; no second original-text cache or unbounded model read is introduced.
The kernel returns host-only `_snapshot` beside the result data. The host strips it from both
model-visible content and tool-result details, stores it against canonical public continuation
arguments, then reattaches it as an internal RPC parameter. It never appears in the public tool schema.
Bind source identity internally to campaign, active worldline, loop and source digest; compute
query source digests once per RPC, not once per row. Fresh initial offset-0 requests create a
fresh binding. An unknown/stale continuation returns a bounded refresh instruction with public
page-0 arguments; it must not silently rebind the old offset to changed content. Worldline switches,
rewinds, restarts without a compatible host binding and concurrent mutation obey this same rule.

**Implementation evidence (2026-09-15).** The 10 focused bounded-recall checks and 5 public-schema
checks passed, alongside 27 migrated kernel-controller checks and 2 worldline-recall checks.
Cold review passed after adding type/turn to oversized event references and retaining small
legacy top-level `lines` on every history section. Large worldline trees use a bound timeline/detail
reference instead. Stale-page refusals name `details.refresh`, a complete public first-page request.
These are deterministic TS/real-Pi interface checks, not gameplay acceptance.

#### Legacy slice-2 shape (superseded where it conflicts with the amendment above)

The paragraphs below preserve the original wire design/evidence. In particular their automatic
`entries`, whole-utterance read, 40/30/200-row limits and combined unbounded history output are
superseded, not alternative compatibility modes.

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
{"findings": [{"kind": "reveal"|"uncommitted_state"|"player_agency", "quote": "<正文里的原句，≤ 120 字>", "why": "<≤ 200 字>", "clue": "<揭示的是哪条未发现线索，只在 reveal 上，见 §51.3>"}]}
```

三类分别是：越权揭示了 `keeper_only` 里的事实；声称了 `committed` 里没有的状态变化（走了没 move、拿了没 clue、掉了没 delta）；替玩家做了未授权的自愿行为。扩展把结果交给 `table.warn`，params `{"campaign", "turn", "lane": "verifier", "findings": [...]}`：内核校验 `kind` 枚举，`quote` 必须是该回合 `rendered_text` 的子串（唯一的确定性锚点；不是子串的整条丢弃并记 `dropped`），最多 10 条；写进 `turns/NNNN.json` 的 `warnings`、遥测一行，并在**下一次** `player_input` 的胶囊里带 `warnings: [{"turn", "kind", "quote", "why"}]`（只带最近一个已提交回合的，≤ 1KB）。全部 advisory：不改状态，不拦交付，不重开回合。车道不用关键词、不用正则；能确定性判的（自写骰面、未关的 `needs`）仍在内核。

零工具子会话是规格第六、九节定下的形状：产出是 ≤ 12 条候选或 ≤ 10 条发现的短 JSON，远在单条助手消息的上限之下，不是把整本书塞进一次补全。实现取的是 `ctx.modelRegistry.complete`（一次不带工具的补全，复用当前会话的注册表与鉴权）；0.85.1 里真的嵌套零工具内存会话也起得了，是权衡后没走，不是上游没路——两边的代价记在 `docs/pi-host-contract.md` 3.1 与第 5 节。车道跑成功就调一次 `table.warn`，`findings` 为空也调：内核由此分得清「跑了没发现」与「没跑」，所以 `table.warn` 必须收 `findings: []`。校验车道选 `why` 的语言用 `table.open` 结果 `campaign.play_language`。

**advisory 的去留（2026-09-06 证据复核，报告在玩测证据旁）**：**保持 advisory**。两局 42 个关回合、52 条发现逐条判：`uncommitted_state` 22 真 0 假 6 判不了、`reveal` 2 真 1 假（n=3）、`player_agency` 1 真 20 假。升级为阻塞门的条件按类分开：`uncommitted_state` 最强，但它最大的一簇（NPC 被叙述进场却不在提交的在场表里）是产品缺口不是守秘人失误，要先落 #27 的 `apply npc`，再看一局 30–40 回合的召回；`player_agency` 定义过宽（把转述玩家请求成台词、「你转过身」判成越权），先收窄定义再重新计量；`reveal` 样本太小，要 100+ 回合。已证实的价值在人不在模型：重复出现的那条发现是 #19 的立票依据，没有证据表明胶囊 `warnings` 改变过守秘人下一回合的行为。

### 12.6 崩溃恢复与幂等

- `acting` 与 `committed` 之间死掉：`table.open` 从 `turn.json` 给 `pending_turn`（含 `last_call_ordinal`），守秘人接着做完；已落收据不重掷（`resolve`/`apply` 的 `call_id` 幂等回放）。
- `narrate` 提交后、写检查点或 episode 之前死掉：重开时检查点从 HEAD 重建；episode 与抽取任务缺失时 `memory.job` 仍能按 `turn` 从回合记录出任务。
- 同一 `call_id` 的 `narrate` 重放返回已存的结果，不再提交；这是唯一的「不重复提交」机制，扩展不做补偿。

### 12.7 胶囊新增节（切片 2）

The approved bounded-context amendment at `table.capsule` above adds host binding and bounded
coverage beside the capsule envelope, not a new narrative section. Its scene/evidence candidate
anchors amend the historical default below; current authority fields remain those in §36.11.

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

#### 12.8.1 车道调用的四行遥测（#67 第 1 步）

车道的模型调用走 `ctx.modelRegistry.complete()`，那条路**不经过扩展运行器**，所以 `before_provider_request` / `after_provider_response` 对它一行都不写（依据见 `docs/pi-host-contract.md` 第 5 节）。原有的 `lane: verifier` / `lane: memory` 只有一个 `ms`，把提示拼装、模型解析、补全、取 JSON、验形、`table.warn` 全压成一个数，拆不开。因此 `runLane` 自己记四行。

新增行，**只增不改**：原有的 `lane: "verifier"`、`lane: "memory"`、`lane: "provider-request"`、`lane: "provider-response"` 四种行的字段与条数一律不动（守秘人自己的调用仍是「一条 `provider-request` = 一次 HTTP 尝试」，车道的行不混进去）。

**`lane: "provider-call"`：守秘人自己的那一段耗时（2026-09-11）。** 上面两行只说「请求装配好了」和「响应头到了」，两行都不带时长，中间也没有第三行说响应体何时读完——于是一个回合里出现六分钟的洞，拿现有证据指不出是模型、是宿主还是别的。真桌上就这么发生过一次（`probe` 之外的网页局，一个 426 秒的回合，其中 359 秒落在一次响应头到达与下一次请求装配之间，没有任何工具调用），而当时能排除的只有上下文压缩（诊断行在那段时间里一条 `below_threshold` 也没变）。车道调用记四个阶段与 `ms`，守秘人的记两个且都不带时长，这个不对称本身就是缺口。

`message_end` 现在为每条助手消息补一行 `{lane: "provider-call", ms, from, stop_reason, blocks}`：`from: "request"` 表示这一段是从 `before_provider_request` 起算的，也就是整次调用（含响应体流式读取）；`from: "previous"` 表示那个钩子没有跑（测试台的假供应商就是如此），这一段从本轮上一件事结束起算。两种情况下，一个回合都被切成了可核对的段——这些段加上已有的工具行应当合上回合总时长，哪一段有洞就指得出是哪一段。`blocks` 记这条消息装了什么（`thinking`/`text`/`toolCall`），因为一次只出思考不出工具的调用和一次正常调用，耗时含义不同。

```
{"lane": "lane-call", "subsession": "verifier" | "memory", "phase": ..., "at": "<ISO>", ...}
```

`subsession` 说这一行是哪条车道的，四行都带；`at` 是那一刻的 ISO 时间戳；除 `start` 外每行都带 `ms`，一律从 `start` 起算（不是从 `runLane` 进门起算——两者之差就是提示拼装与模型解析）。

| `phase` | 记在哪一刻 | 额外字段 |
| --- | --- | --- |
| `start` | `complete()` 调用之前，模型已解析 | `model`（`provider/id`） |
| `request` | 出站请求体装配完、发上线之前（`onPayload`） | `model`（请求体里的模型 id）、`reasoning_effort`、`ms` |
| `response` | 响应头到达、响应体尚未消费之前（`onResponse`） | `status`、`request_id`（有才带）、`ms` |
| `end` | `complete()` 落定（正常或抛错） | `ms`、`ok`、`stop_reason`（有才带） |

读法与 provider 行同款：`request` 有而 `response` 无 = 等响应头时被砍（车道超时的十九次全是这个形状）；`response.ms` 就是到响应头的时间，`end.ms - response.ms` 是流那一段；`end.ms` 是补全本身的耗时，车道那一行的 `ms` 减去它就是车道自己花的时间。

- **`reasoning_effort` 记的是出站请求体里真正写着的那个值**，取 `payload.reasoning.effort ?? payload.reasoning_effort ?? null`，与 `provider-request` 行同一条读法。`runLane` 不传任何 thinking 档，所以这个值是适配器按模型目录算出来的默认；`null` 表示请求体里根本没有 reasoning 字段，也就是由供应商自己定。这一行是唯一能回答「车道跑在什么 effort 上」的证据，不是推的。
- **白名单纪律照抄 provider 行**：响应只记 `status` 与 `x-request-id` / `request-id`，不记任意头、不记凭据。请求只记模型 id 与 reasoning 档，**不记提示、不记正文、不记模型产出的任何散文或语义标签**——车道的输入是守秘人正文，出不了这条路。
- **遥测不许弄坏回合**：四行的写入各自吞掉自己的异常，写不下去就少一行，`runLane` 的返回值不受影响。
- 一次车道调用最多四行，最少一行（`start`；模型解析不出时连 `start` 都没有，那种情况原有的 `lane: verifier ok:false reason:model_unavailable` 行照旧交代）。适配器不实现 `onPayload`/`onResponse` 时对应的行就没有——**没有行就是没有测到，不许拿别处的数补**。

### 12.9 内核的决定（已实现）

Historical decisions below retain their evidence. The approved §12.4 amendment supersedes their
30-hit/200-event caps and unpaged full-hit returns; new recall/rehydration implementation and live
acceptance remain pending until their dedicated checks are recorded.

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
 "pressures": [{"kind": "clock"|"threat", "name", "state": "<段数或到期描述>", "due"?: "<回合或分钟>", "cue"?: "<作者的压力动作或规则的下一步>"}],
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

字节预算（超出按节裁剪并记入 `truncated`）：`where` 4KB、`present` 3KB、`known` 3KB、`pressures` 1KB、`obligations` 1KB、`director` 1.5KB、`situations` 1KB、`memory` 1.5KB、`style` 1KB（重开进程后的第一回合 2KB，见 13.6）、`recent` 2KB、`warnings` 1KB、`voices` 3KB（§40.7：在场每人的面具与示例，任何包的 lines 形状词都坐这里，先裁示例再裁人）、`module` 2KB（#22：只在开桌后本进程的第一回合出现，与 `resume`/首回合 `style` 同一条件；内容全部来自模组图——模组节点摘要与时代、派系/地点/人物名册各带一句摘要、结局与结论的名字、结构类型；没有的域给空数组；`head` 说明这一节在，守秘人开桌前不必再 `lookup` 这本书讲什么）。`head` 与 `turn` 不计预算。

- `where.clock`：`elapsed` 由世界时钟分钟数确定性生成；`day_part` 只在模组图的 `module` 节点声明了起始时刻时给（没有就不猜）。
- `present[].secret`/`fear`：NPC 档案里有就给；这是守秘人专属材料，与 `agenda` 同一条法则。
- `known.clues_here` 已含 `discovered: false` 的线索与 `delivery_kind`：这就是 `lookup secret scope=scene` 的内容，胶囊里有了，`head` 会说。

### 13.2 `pressures` 与 `obligations` 的来源

全部结构性来源，不做语义判断：

| 节 | kind | 来源 |
| --- | --- | --- |
| pressures | `clock` | 规则层的时钟事实：濒死小时钟、重伤一小时、理智发作剩余轮数（`situations` 里的 `time.*`/`clock.*`/`sanity.*` 事实转成一行） |
| pressures | `threat` | 模组图 `threat` 节点里与当前场景或在场 NPC 相关（`present-in`/`located-in`/`contains` 关系可达）的那些，`cue` 取场景的 `pressure_moves` |
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

内容目录加 `content/craft/text-graph.json`（旧树 `references/text-graph.json` 原样带过来）。只读 `play-register`、`style-axis`、`craft-directive`、`beat-type` 四类。`style` 节：`language` 取战役；`register` 取战役的 `register`（建战役时可给，缺省 `purist`）；`axes` 是 style-axis 的短句（play_language；2026-09-10 起六条，退役的三条见 §30.12）；`directives` 按节拍挑：图上 craft-directive 与 Director 节拍的对应表写在 `content/craft/beat-directives.json`（每节拍 ≤ 4 条 directive id，内容团队维护的闭合表，不是模型判断）。重开进程后的第一回合给全部 directive（预算 2KB），之后只给按节拍挑的（1KB）。

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
- **One continuation projection (2026-09-14).** Unanswered continuations are projected only as `obligations[kind=continuation]`, with `who: player`. The source is the previous turn's resolve result whose receipt has neither a `source_receipt` continuation nor `continued_by`. The old duplicate `pressures[kind=rule]` projection is retired. Director pressure offers may read the canonical obligations and name `from: obligations`; pending choices and execution authority are unchanged. `quest` 的 `state` 数该节点 `supports` / `may-lead-to` 指向的线索里已发现的条数（未开始 / 进行中 m/n / 可结束）；没有线索标记写「未开始（无线索标记）」；`who` 取 `giver`，`cue` 取 `importance`。`promise` 取 `memory.open_promises`：`kind: promise` 且 `status: candidate` 且未被接续。
- **`promise` 的接续。** 与 `relationship` 同一条确定性规则：同 `subject` 同 `entities` 的新 `promise` 给旧的加 `valid_until_turn` / `superseded_by`；抽取指令多一句。
- **`style` 的行。** 轴与 directive 的 play_language 短句（2026-09-10 起六条轴、十一条 directive，§30.12）住在 `content/craft/beat-directives.json`（`axis_lines`、`directive_lines`），没有对应语言的行时退到 `en`，再退到图上的 `name` / `rationale`；轴按 `language_applicability` 过滤（`translationese` 只给 zh-Hans）。「重开进程后的第一回合」= 本进程第一次 `player_input` 打开的那一回合：那一回合的所有胶囊（含 `table.capsule`）都给全部 directive，2KB；之后的回合按节拍表，1KB。十七条时 zh-Hans 全量 2019 字节刚好装下、`en` 全量超预算按 `truncated` 裁尾；十一条之后的尺寸由 #71 记录，预算不变。
- **采纳落两处。** `narrate` 与 `ask` 关回合时都算 `director_adoption`，写进回合记录，并在 `telemetry.jsonl` 写一行 `{lane: "director", turn, closed_by, beat, adopted, evidence}`；turn 0 没有胶囊，记录里为 `null`。`CHARACTER` 的 social 族与 `RECOVER` 的 healing/development 族从本回合 `calls` 结果的 `family` 反查收据；`MONTAGE` 看本回合 `time` 收据的总分钟数 ≥ 60；`CHOICE` 以 `ask` 关闭时 `evidence` 为空数组。
- **`where.clock.at` 与 `day_part`** 只在模组节点声明了故事何时开场时给：`start_clock.local_datetime`（`module-meta.json` 的本地日期时间，The Haunting 是 `1920-10-12T10:00:00`）或退而求其次的 `start_time`（`HH:MM`，只有钟点没有日期，因此只有 `day_part` 没有 `at`）。`at` = 声明的开场时刻 + `world.clock.minutes`，以 `YYYY-MM-DDTHH:MM` 给出；`elapsed` 仍然是从战役开局算起的已过时间，两者不是一回事。`day_part` 的边界是**起始钟点**（5 dawn / 8 morning / 12 midday / 14 afternoon / 18 evening / 22 night，之前是 `small_hours`）。两者都不声明的模组一个都不给——不猜。谁写它：starter 模组是 `module-meta.json` 手写；PDF 构图的模组由 skeleton/opening 读者在模组节点 `properties` 上声明（`content/setup/visual-reader.md`，带 source_refs 并进 critical，detail 补读也能后补），谁也不许按现实世界历史推断书里没写的开场时刻。`table.view` 的 `clock` 与胶囊同一份投影（§23），面板据此显示局内时间。`structure_type` 读模组节点记录的 `structure_type`，没有就 `branching_investigation`。`campaign.create` 接受 `register`（文本图 `play-register` 的 legacy key，缺省 `purist`），写进 `campaign.json`。
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

**开桌就绪**（`module.status` 的 `opening_ready`）：module 节点、起始场景、其出口指向的场景、起始场景的 NPC 与线索都在图里，且起始子图上十条不变量成立。构建顺序按 `priority`：front / keeper-truth / opening 场景所在 section 先；`opening_ready` 一到就允许 `setup.complete`，其余 section 继续在后台读（14.6）。（**§46 起（2026-09-16）：就绪只看 `missing`；起始子图上的 findings 只报，不再否决 `opening_ready`。本节编号与其余条款不变。**）

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
- **开桌就绪。** `opening_ready` = module 节点在、恰好一个入口、起始场景的每条出口都指向图里的场景、记录里点名的 NPC/线索都在图里、且诱导子图（module、起始场景、出口场景、在场 NPC、可得线索、这些线索支持的结论；不含 beat）上十条不变量成立——结局的交代取整图（结局往往在没读的 section 里，带声明不带节点）。`module.status` 每次从当前图现算；`module.json.opening_ready` 是装配/登记时的快照，`setup.complete` 读它。the-haunting 的开场邻域整页齐全，`opening_ready: true`；整图报 2 个 `actor_in_no_scene` 与 32 个 `node_without_page`（beat/concept/secret 无证据）——是 IR 事实，starter 仍按契约 `installed`。（**§46 起（2026-09-16）：就绪只看 `missing`；起始子图上的 findings 只报，不再否决 `opening_ready`。本节编号与其余条款不变。**）
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
- **建卡 sex 必填并投影给守秘人（2026-09-12）。** 真桌缺陷：对话式建卡的 `profile.sex` 只是可选字段、守秘人胶囊的 `known.investigator` 又不投影它，于是一位女性调查员（苏散）被守秘人按名字猜成了「先生」。决定：`validateProfile` 把 `sex` 升为必填非空自由文本，拒绝的 issue 指明语义——用玩家说过的词或对玩家描述之人的最佳解读、用 play_language 写，玩家在草稿卡上看到后对话纠正；`sex` 是开放文本，不是枚举，代码绝不按名字/词表/正则推断；守秘人胶囊 `investigatorSummary` 投影 `sex`。遗留路径 `setup.investigator` 的 sex 保持可选。
- **卡面上的 sex 走展示车道投影（2026-09-12）。** 真桌二报：艾琳·卡特（play_language=zh-Hans）卡上的 sex 显示英文 "Female"——setup 模型用系统语言起草的数据没有走到玩家面前。这不推翻「自由文本不进手写词表」，而是 sex 漏接了架构里现成的投影车道：§23 的第二条腿（系统侧的词由 presenter 车道投影）对卡面身份字段同样成立。决定：新增 lane kind `identity`（`identityTexts` 只收 `sex`，过滤空/非字符串/纯数字；`occupation_stated`、`concept` 是玩家散文，走第一条腿，不收），进 `SHEET_LANES` 不进 `PRESENTATION_LANES`（mechanics/递送卡不显示 sex）；面板 sex 行与草稿卡身份行经 `term()`/`t()` 查词表、投影缺失时回落卡上原词；`cardTexts` 收 `sex`，草稿卡投影同样覆盖。

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
| `dice` | `actor`, `label`, `expression`, `faces`, `total`（**`total` 是施加值，不是骰面之和**：极限/critical 成功按最大伤害结算时 `faces` 仍是掷出的点数而 `total` 是实际施加的伤害，玩家卡上的数字必须能解释他掉的血。见下方 2026-09-12 的决定） |
| `change` | `resource`, `subject`, `before`, `after` |
| `scene` | `from`, `to`, `minutes`, `via`? |
| `clue` | `clue`, `label`?, `summary`? |
| `time` | `minutes` |
| `item` | `name`, `quantity`, `to`, `weapon`? |
| `cash` | `subject`, `before`, `after` |
| `session` | `family`, `transition`, `round`?, `outcome`? |
| `choice` | `option` |
| `handout` | `name`, `document`（§59 起；此前是布尔 `available`）, `label`?, `path`?, `media_type`?, `text`? |
| `worldline` | `operation`, `line`, `loop`, `from`?（§15.3；切片 8 加的，此前只在实现里，照契约读的前端不知道有这一类） |

每条还可能带两个分组字段：`call` 是铸出该收据的 `call_id`，同一次 resolve/apply 铸出的收据同属一次结算；`family` 是 resolve 结算它的规则族（这次结算里的 `delta` 也带上），`apply` 的簿记行没有 `family`。前端按 `call` 把一次结算的行收进一组，按 `family` 决定这一组的气质；缺了任一个字段就退成单列的行，不许猜。

扩展把它作为会话条目 `coc-mechanics`（`{turn, mechanics}`）追加到 Pi 会话并发到总线 `coc:mechanics`；Pi RPC 事件流因此带着它（`entry_appended`），驾驭器落进 `events.jsonl`；未来的 Electron/web 前端按它渲染骰子卡与变化条。投影为空时不发条目。TUI 只显示守秘人的正文。

**手卡**：Pi 没有出站附件通道（`docs/pi-host-contract.md` §3.3），所以路径不进正文。内核给 `name`/`document`（§59 起的三态；此前是布尔 `available`），扩展把 `apply` 结果里的 `attachment` 合进这一行（`path`、`media_type`），前端按它取图；坐在终端前的人由 table 扩展通知一次（`handout <名>: <路径>`，每张卡一次，不进正文）。文本手卡（§14.8 物化的 markdown）额外带 `text`：正文原样（不含物化时加的那行 H1，上限 8000 字符，超出以 … 截断），让前端能把这一行展开成可读的卡片而不需要文件通道；图片手卡没有 `text`。契约里任何「渲染【明骰】【变化】【第 n 轮】【手卡】行」的旧说法一律以本节为准，包括 §5、§11.6、§11.9、§12.5，以及 §11 的会话渲染、§14.8 的手卡、§14 的实现小节、§15 的世界线收据——那些段落描述的行不再存在，对应的信息以 `mechanics` 的一行投影出去。

### Kernel decision: a damage receipt's total is what was applied (2026-09-12)

人格基准第一轮（`docs/player-persona-benchmark-20260911.md` §4.8）在四场不同的对局里量到同一个缺陷：
extreme 或 critical 成功时 `CombatEngine.extremeDamage` 按最大伤害重算并改写 `damageChain` 的记录，
但**已经排进 `pendingRolls` 的那条伤害收据不被回头更新**，而 `damageEvidenceRows` 又优先取
`rolled_total`。于是机制卡印「伤害 1」而 HP 掉 8，收据里没有任何东西能解释这个差；其中两次
直接打死了调查员。

- **`dice` 行的 `total` 是施加值**（`raw_damage`），`faces` 与 `rolled_total` 仍是掷出的点数。
  两者不等就是这一次结算做了最大伤害或穿刺加骰，卡上因此**能**解释 HP 的变化。§16.2 的
  「不许计算」不变：前端照样只印收据carrying的数字，是内核负责把施加值放进去。
- `combat_damage_external_v1` 的 `total` 同样是施加值；`rolled_total` 与 `die_rolls` 原样保留，
  骰子仍然可审计。
- 快照校验（`combat/snapshot.ts`）跟着改：它比对 `dice.total` 与施加值，并继续单独比对
  `rolled_total` 与骰面重算的结果——两条都在，篡改任一侧都拦得住。
- 这不改任何**规则**：CoC7 的穿刺武器极限成功打最大伤害，引擎一直是对的，错的只有收据。

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

- **Projection.** `kernel/coc/render.py` is now the receipts' projection and the number check; the mechanics-line templates, `place` and the marker check are gone. `mechanics(receipts)` yields one object per receipt in receipt order. Beyond the §16.2 columns every object carries `kind` and `receipt` (the receipt id), and the names the receipt already holds ride as data when present: `actor_label` (roll, dice), `subject_label` (change, cash), `from_label`/`to_label` (scene), `label` (clue, item, handout), `to_label`/`from`/`weapon` (item), `currency` (cash), `rounds` (a bout's session start), `available`/`path` (handout). A `delta` receipt projects as `change`, a `move` as `scene`, a dice-form roll as `dice` (`label` = the engine's die name, `expression`, `faces`, `total`). A roll's `visibility` has three tiers and every one of them is projected, so a log keeps the lot: `public` a consumer draws in full; `concealed` (2026-09-12) is a check the player declared whose die the rules withhold — a consumer that renders for the player draws the row without a single figure (no `roll`, `target`, `threshold`, `difficulty`, `level`, `passed`, `pushed`), because the player knows they attempted it and only the number is secret; `keeper` is a roll the player was never told happened, and a consumer that renders for the player must hide the row entirely. Psychology's concealed observation (`psychology:observe-concealed`) is `concealed`, not `keeper`: under one collapsed hidden tier its turn drew no card at all and a declared check was indistinguishable from plain narration. The host strips the figures off a `concealed` row where the rows leave the backend (`mechanicsEntry`), not in the renderer: a number that reached the client already left the Keeper's hands. Every row also carries `call` (the `call_id` that minted its receipt) and, for resolve-minted receipts, `family`: at commit time resolve stamps the settled family onto every receipt of that call with `setdefault`, so a session receipt's own family word survives and `apply`'s bookkeeping rows carry none. One settlement is one group; a row without `family` settles nothing and stays loose.
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
- A receipt whose marker the Keeper did not place is **not** an error. The kernel
  appends that marker to the end of `marked_text`, in receipt order, so every
  projected mechanics row has a stable delivery position. Explicit placements stay
  where the Keeper put them; the fallback never changes `rendered_text` and never
  loses a receipt because its position was omitted.

**What the delivery carries.**

- `rendered_text` keeps its meaning — the delivery as a text consumer reads it —
  with every marker removed. The kernel substitutes nothing for a marker: a
  substitution would be player-facing words written in code, which §16.1 forbids.
  A terminal reader therefore sees the prose it sees today.
- `marked_text` is the same delivery with explicit markers still in place and all
  omitted receipt markers appended at the end, for a frontend that can mount each
  component at a position. It is omitted only when the turn has no projectable
  mechanics receipt.
- Every `mechanics` row carries its `marker`. A consumer does not need a second
  out-of-body group for rows the Keeper omitted; their fallback position is already
  in `marked_text`.
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

### 17.10 玩家侧 NPC 日志 `npc-journal`（计划 npc-journal，2026-09-12 用户拍板）

桌上缺的那一块：玩家玩到第二十回合已经见过十几个人，「这人是谁、上次跟我说了什么」全靠自己的记忆。本节给玩家一本**自动写的 NPC 记事本**：角色面板末尾多一节（§23 的 sheet 投影加 `npcs.journal`），后台静默车道在每回合提交后把**这一回合真正出场**的 NPC 落成条目。守秘人与玩家都不做任何事。

**三端（§31）**：写它的是本节的车道（`journal.submit`，只从回合叙事抽取，不是模组图——图是书，书不会动，图上没露脸的 NPC 永远不进日志）；读它的是 `table.view` 的 `npcs.journal` 投影与角色面板的 NPC 节；据它行动的是玩家自己——**它不进守秘人胶囊，不催促，不反馈**（与 §13.7 同一条法：它只是一本玩家记事本，不是守秘人的义务）。

**存储** `<campaign>/npc-journal.json`（`{"schema": 1, "entries": {...}}`，键是 NPC 节点 id，与账本同一命名法则）：

```
"<npc node id>": {
  "name": "<play_language 的名字>",
  "description": "<玩家视角的一两句话：他是谁、看起来怎样>",
  "first_seen_turn": n, "last_seen_turn": n, "seen_count": n,
  "exchanges": [{"turn": n, "scene": "<display_name>", "summary": "<这一回合他与玩家之间发生了什么，一句>"}]}
```

**名字与场景走展示车道（2026-09-12 修正）。** `name` 写的是**可记录名**——车道被要求逐字照抄（`journal.submit` 校验成员资格），所以它是模组图的词，不是 play_language 的词；`exchanges[].scene` 是那一回合的 `display_name` 快照，之后守秘人改名也不会回填。两者都由展示车道投影：`journalTexts` 收集它们，写进 `setup/presentations/journal-<语言>.json`，表读取时并进词表（`SHEET_LANES`），面板用 `term()` 查（契约 §23 的两条腿）。车道自己写的 `description` 与 `exchanges[].summary` 本来就是 play_language，不进投影。

日志是**派生存储**：真相在逐字记录与回合记录里，日志可由车道重放重建，因此它**不进回合提交链**（与 `memory/candidates.jsonl` 同一待遇），世界线分叉/切换不管它——条目按战役累积，玩家看见的是「这条战役里见过的所有人」。崩溃恢复与 §12.6 相同：`journal.job` 能按 `turn` 从回合记录重新出任务。

**任务包** `journal.job`，params `{"campaign", "turn"?: int}`；缺省派发与 `memory.job` 同一条（最新的、未完成、不在 backlog 的已提交回合；§12.8）。result：

```
{"job_id": "journal:<campaign>:t<n>" | null, "turn", "commit",
 "scene": {"name", "display_name"}, "present": [名], "investigators": [{"id", "name"}],
 "player_text": "...", "keeper_text": "<守秘人正文原样>",
 "recordable": ["<允许记录的名字，闭集>"],
 "prior": [{"name", "description", "last_seen_turn"}（已在日志里的在场者，供改写描述时衔接）],
 "budget": {"max_entries": 6, "max_description_chars": 300, "max_exchange_chars": 200},
 "instruction": "<固定英文指令>"}
```

`recordable` 是确定性闭集，取三者之并：该回合 `world` 快照里**在场**的 NPC；该回合收据引用到的 NPC（`clue.from`、`interactions`、`npc` 收据）；已在日志里的名字。图上只在别处的 NPC 不在集内——**没出场就没有条目**，这是「只在剧情中出现才记录」的确定性落法。指令（英文，固定）要点：只为这一回合叙事里真正出场（说话、行动、被互动）的 NPC 写条目；`description` 只写玩家能感知到的（外貌、身份、言行），严禁写出动机、秘密、守秘人材料；`exchange` 一句概括这一回合他与玩家的来往；全部用 `play_language` 写；`prior` 里已有描述且本回合没有新信息的，只给 `exchange` 不复述描述。

**提交** `journal.submit`，params `{"campaign", "job_id", "entries": [{"name", "description"?, "exchange"?}]}`。校验与 `memory.submit` 同一家：未知字段、机器键、`recordable` 之外的名字、同名歧义都报 `invalid_params`（`details.index` 指到那一条，`fix` 列出 `recordable`）；整批要么全落要么全不落；同任务同内容重放幂等，内容不同报 `idempotency_conflict`。合并是确定性的：新名字建条目（`first_seen_turn` = 任务回合）；`last_seen_turn` 推进、`seen_count` 每回合至多 +1；给了 `description` 就整段替换（车道自己决定何时改写，内核不比diff）；给了 `exchange` 就追加 `{"turn", "scene", "summary"}`。成功发 **`journal-written`** 事件（`{"job_id", "turn", "entries": n}`，§12.1 的枚举因此再加一类）。失败与 `journal.fail {"campaign", "job_id", "reason", "detail"}` 写 `npc-journal/backlog.jsonl`，形状与重派法则同 §12.3 的 backlog。任务文件 `npc-journal/jobs/<job_id>.json` 整文件原子写。

**车道接线**（§12.8 同一家，**第四条零工具模型车道**——产出是 ≤ 6 条短 JSON，与记忆/校验/行动准入同构，2026-09-12 用户明文授权这一条，不推广）：`extensions/npc-journal` 订阅 `coc:turn-committed`，`journal.job`（显式 `turn`）→ `runLane` 零工具补全（模型 `PI_COC_NPCJOURNAL_MODEL`，缺省与桌子同模型；`subsession: "journal"` 的四行遥测照旧）→ `journal.submit`；失败一次重试，再失败 `journal.fail`。同一时刻只跑一个任务，后来的排队；`session_start` 补抽 ≤ `PI_COC_NPCJOURNAL_BACKFILL`（缺省 5）个回合；经 `coc:kernel-bridge` 调内核，不另开客户端；永不阻塞 `narrate`。提交成功后 announce 一次 sheet 刷新（与 ui-words 车道同一个 `sheet-changed` 通道），面板由此自己重读。

**投影**（本节修订 §23 的 read-only sheet 形状）：`table.view` 加

```
"npcs": {"journal": [{"name", "description", "seen_count", "last_seen_turn",
                        "dead_since_turn"?, "exchanges": [{"turn", "scene", "summary"}（≤ 6 条，新的在前）]}]}
```

按 `last_seen_turn` 新者在前；`dead_since_turn` 从账本投影（日志自己不存死讯，账本是唯一真相）；`exchanges` 全量留在文件里，投影只给最近 6 条。setting-up 形状为 `npcs: {journal: []}`。player-safe 由构造保证：能进日志的只有玩家可感知内容，守秘人秘密（stance、agenda、secret）从来不经过这条管道。

**UI 与语言**：面板照 `Clues` 节的形状加一个 `Npcs` 节，排在最后；tab 词只在 `content/ui/en/sheet.json` 加 `npcs` 与 `noNpcs` 两个键（其余语言由 presenter 车道投影，§23；`zh-Hans` 种子缓存同步补键）。条目正文（`name`/`description`/`exchanges`）由车道按 `play_language` 直接写，不走 ui-words——内容数据是它本来的语言。系统侧（契约、提示、键名、遥测）全部英文。

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

#### Approved bounded-context successor (task 3 pending; live acceptance pending)

[bounded-play-context](specs/bounded-play-context.md), D1–D5/D8/D9, is the approved successor to
this section's cumulative fold. One pure selection policy in the table extension serves both the
outbound `context` projection and persisted `session_before_compact` adapter; no second compressor,
model summary, Pi fork, new memory store or foreground semantic lane is introduced.

- Closed-history contribution has a **32 KiB serialized UTF-8 ceiling per outbound request**,
  with at most 4 KiB of omission/coverage/recall metadata inside that same budget. Prefer the latest
  two committed player/Keeper pairs, newest first; oversized historical quotes are labeled partial
  and carry original turn/role/range plus full bounded-read arguments (§12.4).
- Current user input, current capsule, system instructions and every message of an unresolved
  current exchange are protected and accounted separately. A successful `narrate` does not release
  the still-running Pi exchange. A pending-choice answer does not erase its context prematurely.
  If protected/fixed inputs alone exceed capacity, report that limitation, not successful compression.
- Use `_context` and committed delivery/session bindings, not prose, to identify campaign, line,
  loop and canonical turn. Rehydrate the current full briefing via `table.capsule {rehydrate:true}`
  when an epoch loses/invalidates it. Cache the stable prefix across tool round trips; invalidate
  on new player input, restart, line/loop or source/recovery changes and explicit compaction.
- Old capsules/tools leave only the closed-history view. Host notes expire only through their
  closed structural kind and turn binding; unknown/persistent notes are retained conservatively
  or regenerated explicitly. Missing bindings/capsule preserve the affected active region with
  bounded degraded/capacity diagnostics, not an aggressive guessed cut.
- Fold the same selected view with a safe retained suffix: no orphan tool result, split unfinished
  exchange or blind fallback to Pi's cut. No safe/progressing cut means explicit cancellation or
  degradation, never Pi's generic model summary. `prepareCompaction` failure before the hook does
  not disable outbound history bounds. Keep `PI_COC_COMPACT_AT` at 70% by default for token-pressure
  persistence, honor unknown post-compaction usage, and suppress repeated same-source no-progress work.
  Retained raw message bytes (latest kept boundary onward plus the latest summary, excluding old
  compaction details) also trigger persistence above 128 KiB. Projected provider usage alone cannot
  detect a growing raw message array; this storage-pressure measure is bytes, not claimed tokens.
  A host-minted input epoch in message details and the capsule bus binds the current message even if
  optional kernel metadata initially degraded. It never enters model content. Known prior COC
  deliveries and turn-scoped host notes expire before the proven current boundary; do not compare
  turn ordinals across worldlines when expiring them.
- Version-2 fold metadata is a bounded manifest of policy version, source/binding, retention/cut
  ranges, measured sizes and omission reasons, not an accumulating `lines` archive. Old version-1
  entries remain readable but are neither rewritten nor copied wholesale into new details. Raw
  Pi sessions and canonical campaign evidence stay intact. The cut-plus-summary API can replace
  an old region with bounded text today; selective outbound projection handles its remaining
  single-cut limitation. Upstream per-entry cuts are not a prerequisite.
- Existing telemetry records trigger/outcome, identity (host-only), protected/history bytes,
  capsule/fixed estimates, recall pages/bytes, coverage, cache/rehydration, no-progress reason and
  duration. Provider input/cache tokens and latency are actual measurements only when available;
  estimates stay labeled. None of these counts enter plot obligations.

Implementation and actual outbound-Pi integration checks belong to `bounded-context-policy`;
genuine continuity/restart/cost verification belongs to `context-live-acceptance`. Neither is
claimed complete by this interface amendment or the legacy tests below.

#### Legacy cumulative fold (superseded design; retained evidence)

The following describes the pre-amendment implementation. Its growing verbatim summary and
fallback cut are not the new guarantee; its claim that bounded replacement requires upstream
support is superseded by the decision above.

Pi 的缺省压缩不知道这张桌子哪些东西是可再生的。接 `session_before_compact`。**这个钩子表达不了「按条目挑着丢」**：它的返回是一个切点加一段摘要，Pi 用摘要替换切点之前的一切。所以「整段丢那些、原样留这些」只能实现成「选好切点，把要留的原样抄进摘要」。COC 口径如下：

- **整段丢**：所有 `coc-capsule` 消息（每回合重新生成，旧的一律是废页）、带工具调用的助手消息与工具结果消息（收据在内核里，`recall` 能拿回来）、上一次折叠自己写的那条说明。（`coc-mechanics` 是 `CustomEntry`，本来就不进模型上下文，丢它不改变守秘人看到的东西。）
- **原样留**：玩家输入与已交付的正文（它们是逐字记录的对应物）、系统提示、最近两回合的全部往返、任何 `pending_*` 相关的宿主消息。
- **压缩后补一条宿主消息**：一行英文，说明桌面状态在下一回合的胶囊里、往事用 `recall`、本回合的待决是什么。守秘人不需要从摘要里回忆状态——状态本来就每回合重发。
- 触发：除了 Pi 自己的阈值，`before_agent_start` 里当上下文占用超过阈值（缺省 70%，`PI_COC_COMPACT_AT` 可调）就先 `ctx.compact()` 再进回合，避免压缩发生在工具往返中间。刚折叠完 `getContextUsage().percent` 是 `null`，那一轮不判。
- 代价说清楚：留下的逐字对话随局增长，所以折叠**不是定长**的——胶囊、机制、工具往返都没了，但玩家原文与交付会一直累积。要定长得等上游给「按条目丢」的能力（宿主契约第 6 节的请求）。

判据是**条目类型与回合距离，不是内容语义**——不读文本、不做相关性判断（`Agents.md`「语义问题不许硬编码」）。

### 19.3 验收

The checks below describe the legacy slice. New bounded-context acceptance additionally requires
the specification's executable outbound-request, Unicode paging, source invalidation, read-only
rehydration, protected-exchange and genuine table/restart/cost checks; implementation/live status
remains pending, and legacy synthetic fold tests are not gameplay evidence.

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

宿主私有 PDF 工具的三种互斥操作：

- `info`：返回真实页数、已有书签与页面标签。没有书签返回空数组，不由程序猜章节。
- `page <page> [--box x0,y0,x1,y1]`：按需渲染并返回图片路径、物理页号、裁剪范围和实际尺寸；读者再用 Pi `read` 看图。`page` 是从 1 起的物理页序，印刷页码只是标签。`box` 是应用 PDF 旋转后的可视整页上、左为原点的归一化矩形；满足 `0 <= x0 < x1 <= 1` 与 `0 <= y0 < y1 <= 1`。内核持久化 `pdf_index = page - 1`，只在边界转换一次。
- `overview {first_page,last_page}`：最多 20 个连续物理页的一张固定布局联络表，格子同时标物理页与 PDF 页标签，并返回页到格子的 manifest。它只在原生导航和既有引用不足时帮助定位；结果是 `source_overview`，不产生 `source_pages` observations，不能满足 source ref、草稿提交或独立复核的原页证据。读者选中候选后必须用 `page` 重新打开原页。

书中“见第 N 页”的印刷引用由读者对照原页或可靠 PDF 页标签定位，不能用固定页差在全书或不同版本间推算。2026-09-07 样本已出现物理第 100 页对应印刷 97 的情况；这只是该页证据，不是全局偏移规则。首个交付仍是一份完整 PDF 一个来源；分卷正文与独立手卡册不自动拼接成同一来源。

缓存位于模组内 `cache/pages/`。原页缓存键包含原文件摘要、物理页、渲染参数与裁剪；联络表缓存键包含原文件摘要、连续物理范围和固定布局版本。只生成请求的页；裁剪从原 PDF 渲染，不能放大已经缩小的预览图冒充细节。原页请求写 `requests.jsonl`，联络表导航另写 `overviews.jsonl`。读者会话保留实际图片事件与失败，不能把联络表或“生成了图片”记成“模型已看过原页”。缓存不是真相，也不替代原 PDF。

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

若后续同一动作再次遇到 `material_pending`，而对 `details.read` 中完全相同的 `purpose/focus/question/guidance_key` 续接后确认任务已是 `reading_failed`，宿主可在当前玩家回合内为该读取身份自动发送一次 `retry: true`，成功后仍只重放原动作。这个额度按读取身份单次消费；修复再次失败就把真实拒绝交回 Keeper，不循环。`reading_timeout`、取消信号、传输或内部错误不触发这次自动修复，也不改写读取问题。

沿用有界读者超时；前台等待的总时限初值 120 秒，超时返回 `needs` 与 `details.reason: "reading_timeout"`，任务进度保留。超时不是一次新的阅读请求，也不是自动再次执行动作。原玩家输入与已完成收据保留；对同一目标再次 `lookup` 只加入已有任务继续等待，不重复起读者。Pi 的工具取消信号取消本调用拥有的前台阅读，宿主结束该读者及其工具子进程后用 `module.read.finish` 记 cancelled；共享任务只解除当前等待，不杀另一调用仍需要的任务。失败后 `lookup retry:true` 明确重试。取消不回滚此前成功的游戏动作，也不自动重发玩家输入或让 Keeper 补写未知情节。实际等待分布由验收记录决定是否调整此值。

等待超时后的旧玩家回合若仍为 `open/acting`，下一条玩家输入仍由内核以 `turn_state` 拒绝；宿主不越过该拒绝，也不自动重发输入。此时旧的单次修正状态不得沿用：宿主为这次运行重新给一次有界修正，要求 Keeper 用 `narrate` 诚实说明资料尚未就绪并关闭旧回合。旧回合关闭后，玩家可再次提交原动作；这次提交才进入正常材料检查和上面的同读取单次失败修复。

这次「用 `narrate` 说明等待」的修正**只花一次**，与 pending-ask 和回合地板两处同法：Keeper 在等待期写了正文而没有调 `narrate`，宿主丢一次正文并给出这一次修正；同一回合的下一条正文按隐式交付关闭回合——隐式关闭本身就是 `narrate`，照样落收据。丢弃不许每条都做：steer 花掉之后 `agent_end` 不再补发，回合就会一直 `open` 且什么都没交付，之后每条玩家输入都被 `turn_state` 拒绝，战役再也走不下去（Cold Harvest 第 2 回合实测，provider 两次都返回了 text）。

成功的读取结果通过原工具调用返回，不在桌外偷偷触发一个新的 Keeper 回合。背景预读仅在空闲时启动；素材就绪后进入后续胶囊，不自行叙事。

合并 §16.3 的结构化交互后，阅读等待说明放在 ask 的 prompt/options JSON 中，不进入正文。若 Keeper 只输出等待散文，宿主丢弃该草稿，并沿已有单次修正机制要求显式 ask；不得合成空选项调用。

### 22.5 开场、失败与旧数据

setup 用 `prepare-module` 替换 `build-bundle/bind-source/build-opening` 的外部编排。输入真实 `pdf` 或既有 `module`，执行来源登记、定位、开场准备；调查员流程保持原职责。多开场选择沿用 `module.opening.choose`；候选来自已读原书，等待不能解决选择。源语言由读者判断，玩家语言继续使用 `play_language`。

开场 ready 需要：有效且明确的入口；当前人物、互动、线索条件及必要规则数值有材料；影响开场的全局真相与跨页依赖已读；关键事实复核完成；未解决的问题不会改变这些内容。结构检查加读者依赖声明共同决定，不使用节点数量/读页比例作为替代。

沿用 `coc:module-ingest` 及其 `-progress/-done/-failed` 频道接入宿主。进度统一为 `{module_id?, stage: "source"|"index"|"read"|"verify", page?, of?, focus?}`；`-done` 表示开场可用，不表示全书精读完成。新路径不再发旧 build 专属频道，命令与 setup 调用同一个宿主阅读服务。当前不新增任何 Electron IPC 或 UI。

RPC 顶层错误枚举沿用 §1；具体原因放在 `details.reason`：`bad_pdf, vision_required, unreadable_pages, needs_source, material_pending, reading_timeout, reading_failed`。拒绝须有英文 `fix`；候选选择给 `details.candidates`。不可读的必要页面会阻断相关范围；不相关页面可保留为缺口，但不得声称全书可玩性已验证。

旧图谱、资产、campaign 与回合证据继续可读。无原 PDF 的旧模块可玩已有内容，新细读返回 `needs_source`；摘要匹配后可建立新阅读索引，绝不把旧全书“已接受”标记冒充视觉验证。旧资料包不再接受新的生产导入，不保留 OCR fallback。退役执行清单和删除后的验证以规格为准。

### 22.6 实施决定与证据

#### Campaign-isolated source workspaces (2026-09-15)

This decision supersedes the live-current-generation consumption in §14.1/§20.7: the shared module library is reusable source material, not a mutable table workspace. The library stays authoritative for a campaign that has not written anything of its own: reads follow the library's current verified generation, so a book whose reading finishes after the campaign exists still reaches it. The campaign's first private write -- a scoped reading request or an opening choice -- forks a private workspace under `.coc/module-campaigns/<campaign>/modules/<module_id>/` from the library generation current at that moment; a fork without a published generation is refused. The fork keeps the published graph bytes and manifest (the only hard requirements) plus readiness metadata, and copies the original PDF, index, guidance and referenced asset bytes when they exist: a published generation stays playable after its source document is gone, and a legacy starter may reference an author image that never shipped. A private directory that lost its binding is a damaged workspace and fails closed instead of falling back to the library. Until a campaign forks, a table enqueues no background prefetch into the shared library; material gates still start explicit scoped reads, and a shared prefetch another caller already queued is claimed and finished wherever it lives. The fork does not inherit publication leases, running jobs or completion identities. After the fork, graph generations, opening selection, reading metadata, assets and queue writes belong to that campaign, and later library publications no longer change its graph. Forking and publication use cross-process locks where the host provides them and atomic directory publication, so another campaign and the library remain unchanged. No existing campaign, library generation, transcript or reading artifact is deleted; already running old runtimes are not restarted or silently migrated.

Internal `module.*` source operations accept an optional `campaign` scope. Omitting it retains the library administration/initial source preparation path and its existing same-module claim/lease exclusion. With a campaign scope, status, asset, material and readiness reads use that campaign's workspace when it exists and the library otherwise; a scoped reading request and an opening choice fork the private workspace first, while claims, finishes and other scoped calls follow the workspace that already owns the job -- their campaign's private one once it exists, the library otherwise -- so a shared prefetch is not stranded by a later fork. Source binding with a campaign scope restores the source of an existing private workspace and remains a library registration otherwise. The campaign slug and module identity are validated on both paths; a scope cannot escape its storage root, substitute another campaign's workspace, or read a private module whose stored scope names a different campaign. The host retains one scope for the lifetime of a reading request and all its claim/finish/cancellation calls; it never finishes a library lease in a campaign workspace or vice versa. Initial source preparation may build reusable library material before campaign creation; it must not store a player's opening selection in that library. It passes the selected opening explicitly as the opening request focus, and campaign creation records that selection privately.

Producer: the campaign's first scoped reading request or opening choice forks the private workspace; after that its reads and publications belong to that campaign. Reader: every campaign-facing graph consumer, setup, material/asset resolver, background queue and adaptation source input follows the campaign's workspace once it exists, and the library until then. Adoption: ordinary Keeper reads and unchanged retry-after-reading calls consume their campaign's own publication after a fork, or the shared library while the campaign has not diverged. The shared source may continue to gain library publications without changing a forked campaign's graph. Adaptation still uses its immutable source snapshot plus worldline-local overlay; this isolation adds no new Keeper verb and no automatic adaptation rebase.

Regression acceptance uses two real TypeScript kernel clients in the SAME temporary home, two campaigns of the SAME module, interleaved private opening choices and reading publications, and cold reloads. Assert unchanged library and other-campaign graph/metadata/queues, preserved assets and integrity checks, independent material readiness, and existing same-scope claim/replay/cancellation/conflict behavior. Do not replace same-home concurrency tests with separate homes. Deterministic RPC tests are not reported as live play. Verification uses isolated test data and must not touch the existing live campaign evidence or stop ongoing drivers.

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
- 真桌按需读取发现：一次等待超时后，KP 换 query 又排入同义问题，玩家回合超过 300 秒。扩展在本轮首次 `reading_timeout` 后只允许 `narrate` 诚实交还控制权；新的 player_input 才清除此等待状态。若旧回合未关而新输入被内核拒绝，该运行获得一份新的单次关闭修正，不能继承已经耗尽的 steer 而永久卡住；拒绝的输入不自动重发。
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

### Opening latency implementation update (2026-09-09)

After character confirmation the selected opening still requires the existing source-backed
readiness check. This optimization does not change that authority or grant readiness to thin
future destinations. Opening readers submit the first playable scene through the existing
checked-submission tool and stop; other scene material remains outside ready_nodes and uses
normal detail/prefetch publication. The first batch includes required local interactions and
source dependencies, not an unreviewed placeholder or a full chapter. Guidance behavior stays
separate. Deferred handout images are not rendered as part of a batch that does not prepare them.
The host sets opening_batch on its private check packet: the same pure kernel checker rejects
a mismatched selected scene identity and unprepared present NPC/discoverable material before
launching independent reviews. This does not replace final publication validation. Small task
and candidate JSON may be supplied in context; tool-enabled source access stays available.

Independent review groups combine records with the same physical source-page set, within bounded
record and byte budgets; every previously required root, numeric and critical pointer remains
assigned exactly once. Review success can be reused only for an identical candidate, source,
semantic task context, model/thinking, rendering implementation and review protocol. Reused evidence retains the original
review path and actually observed source pages; malformed, rejected, missing or changed evidence
is never a cache hit. A later attempt repairs/retries failed groups while unchanged successful
groups keep their completed evidence. Cache hits do not claim fresh model calls or new reading.

PDF access reuses immutable bytes and an opened PDF.js document within the owning process, with
bounded cached document count/bytes, idle release and explicit shutdown. File identity changes
invalidate reuse. Concurrent identical page requests share rendering; persisted page images still
require their content hash before delivery. Publication and player-facing source gates are unchanged.

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
`setup.draft.profile.era` therefore accepts an existing `cash-assets.periods` key,
and an explicit value that names no period is `needs` with the closed set, so the
setup agent can pick semantically and retry. An authored era, however, never blocks
the table: a book set in a year the rulebook never tabulated once left a campaign
with no investigator at all, because the refusal and the setup prompt both told the
agent to keep setup blocked. The card is instead built against `cash-assets`'s own
`default_period` — which period stands in is table data, never arithmetic over the
authored text — and the substitution is carried where the numbers are sourced:
`sheet.finance.source`, `sheet.finance.substituted_for`, the same pair under
`sheet.creation.finance` with a note, `sheet.setting_era`, and `finance_period` /
`setting_era` on the investigator receipt. `sheet.era` stays a real rulebook key so
the standard sheet, weapons and equipment tables resolve; the authored setting is
kept beside it rather than rewritten into a key. The setup agent states the
substitution to the player once, in the play language, and carries on. The same
resolution runs on `setup.investigator`, which previously passed authored prose
straight through and produced a card with neither a standard sheet nor a finance
block — incomplete by `completeness`, so that campaign could not open play either.
Chargen arithmetic is unchanged. Entrance-specific `investigator_setup.era` takes
precedence over book-wide era for that campaign.

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

### Host decision: reading-lane telemetry names the job it serves (2026-09-10, #65)

The reading lane's rows (`.coc/reading-telemetry.jsonl`, mirrored into the campaign's
`telemetry.jsonl` while a table is open) recorded timing and never intent: a `phase: read`
row said how long a reader ran and how many images it saw, a `prefetch_wake` said why the
lane woke, the refusal that stopped a player at a door said `reading_timeout` and nothing
else. The queue (`deepen-queue.json`) carries the intent -- `job_id`, `purpose`, `focus` --
and no row carried any of it, so a 179-row log of a real table could not be joined to its
own queue, nor its rows to each other (`unit` restarts every round).

Fields are added; no existing field is renamed or re-meant, so old logs stay readable.

- Every row a job produces carries `job_id` (the queue's own value), `purpose` and `focus`
  (as the queue spells them; `focus` may be `""`). A `phase: read` or `phase: index` row
  also carries `pages`: the physical page numbers (1-based, the page tool's own) whose images
  that run actually consumed -- the same set `observations.read_pages` is built from -- so a
  finished book can answer which pages were read, and by which job.
- The row written when the pump claims a job (`event: concurrency`) carries `job_id`,
  `purpose`, `focus`, and `wake`: the reason of the most recent wake that had not yet been
  answered by a claim, when there was one. A wake whose claim finds the queue empty writes
  `{event: claim_empty, wake}`; `prefetch_wake` itself is unchanged and still says only
  why the lane woke, because a wake does not choose a job -- the kernel's queue does, at
  claim.
- Verify rows carry `round` and `attempt` beside `unit`, so `(job_id, round, unit, attempt)`
  is unique across the log, and `pages`: the pages that unit's reviewer viewed (a reused
  review reports the pages its cached evidence names). `review_concurrency` rows carry
  `unit` and `attempt`.
- `reading_timeout` carries `details.job_id` beside `details.read`; the seven-verb refusal
  row (§8) then carries `job_id`, `read_purpose` and `read_focus` for any refusal whose
  details hold them, whichever verb waited. `question` is the Keeper's prose and is not
  written to telemetry; `job_id` is not named by the `fix` and so does not reach the model.

On the queue's `pages`: it is not an unfilled record of what was read. `module.read.request`
sets it to a constant empty list, it is one of the inputs to the job's identity digest, and
§22.2 never listed it in the queue row; it is a page constraint on the request that nothing
supplies. What was read exists elsewhere -- the host's `observations.read_pages` per attempt,
folded by `module.read.finish` into the module's `viewed_pages` as a 0-based union that keeps
no per-job attribution. The telemetry `pages` above is the per-job, per-phase record; the
queue field is left as it is rather than given a second meaning.

### §22 implementation decision — verified published graph reads and canonical investigation material (2026-09-10)

This is the contract for repairing published-graph integrity and source-backed investigation coverage. It is an
integrity-consistency system, not a signature or authentication system: no TUF framework or dependency is added
(<https://theupdateframework.github.io/specification/> remains only a useful comparison point for roles and
metadata terms).

**Verified published graph reads.** One shared read-only loader verifies every registered module's current graph
against the module metadata and the generation manifest in the graph file's directory. A verified read captures the
metadata and graph pointer as one binding, checks the existing path-containment rules, reads the graph bytes once,
computes the raw SHA-256 from those exact bytes, and parses those same bytes with `parsePythonJson` for the
`jsonDigest` canonical comparison. It must never hash one read and parse another. For registered/published graphs,
all of these are required: metadata `graph_digest`, canonical `graph_content_digest`, manifest contract/schema,
module identity and generation must match. Missing or malformed verification data is a failure, not proof that the
graph is safe. Ordinary unregistered bundled starter reads keep their existing path, but once a starter is
registered its emitted metadata and manifest are verified like any other publication.

`ModuleStore.readGraph()`, `ModuleStore.graph()` and play `loadModule()` share this rule. A hot cache must revalidate
content before reuse; a generation number alone does not authorize cache reuse. Reading or merging the current graph
as the source for another publication must also verify it first. On failure, the caller returns `campaign_not_ready`
with `details.reason = "module_graph_integrity"` and precise host-facing mismatch data. There is no silent fallback,
mutation, metadata repair, new published generation, or destruction of evidence after a failed read. An incomplete
publication leaves the prior pointer and generation in authority. Replaying a completed job is historical idempotent
evidence, never authority to consume corrupted current bytes. Original damaged samples are retained unchanged;
recovery or backfill must be source-supported and publish a new reviewed generation, not launder a damaged file by
recomputing hashes. Repairs are first validated in isolated source workspaces; there is no automatic active-campaign
migration.

**Canonical investigation material.** The current ModuleGraph vocabulary remains the vocabulary: clue, conclusion,
`supports`, `discoverable-at`, `knows`, rule nodes and `uses-rule`. No new graph/state/tool vocabulary and no
minimum clue or conclusion quota are added. Readers distinguish a physical carrier -- an artifact, object, document
or handout -- from a discoverable proposition. Keep the carrier when the source has one, and create a sourced `clue`
for information the investigator can learn that matters to the prepared investigation. The clue's `summary` holds
that proposition.

**Delivery metadata contract.** `delivery_kind` is a runtime tag, not free prose or a synonym key. Source-backed
metadata uses existing clue fields only: `skill_check` for a required skill check, with `skill`/`difficulty` when
the source names them; `npc_dialogue` for source-authored NPC disclosure, with timing or conditions in `delivery`
and the source-backed NPC connection as `knows`; and `obvious` for authored automatic observation. Only these tags
have the handed/check semantics above. Other source modes keep their prose in `delivery`; existing `environmental`
or `handout` descriptions may remain descriptive, but they are not handed tags or no-roll assertions.

**Reader guidance.** Do not write aliases such as `skill` or `conversation`, do not map legacy `conversation` to
automatic delivery, do not force a kind when the source is unclear, and do not mark a clue `npc_dialogue` merely
because an NPC knows it. Do not populate `skill: null` as a no-roll assertion. Explicit no-roll and conditional
rules stay in source-backed rule nodes and `uses-rule`; the `check unspecified` repair in §30.12 still applies.

Place each clue in its actual discoverable scene with `discoverable-at`, connect clues to source-supported
conclusions with `supports`, and connect a knowing NPC to a clue with `knows` when appropriate. A carrier at a scene
is not a substitute for this chain. There are no inference keyword tables. Do not invent conclusions, arbitrary
support edges or special content to satisfy a gate. Some prepared scopes legitimately contain no clues or
conclusions. Existing prepared scopes may be augmented through the current detail request path with an explicit
question, using additive review and publication; there is no all-book reparsing, and unrelated source facts and
earlier generation bytes remain.

The read projection accepts canonical clue properties first and retains legacy `conclusion.clues` entries as a
field-by-field fallback. A small ModuleGraph clue-profile read method owns that bridge. Explicit null or empty
canonical values mean unspecified and must not silently resurrect a legacy skill or delivery value over them. The
Director gate and Story Thread delivery rows read the same clue profile. Director treats `skill_check` without a
named projected skill as a required check with the skill unspecified. Story Thread handed rows come only from
`obvious`, or from `npc_dialogue` with an actually present NPC named by legacy `source_npc_ids` or connected by
`knows`; data must reserve that combination for source-authored disclosure, not every NPC who knows a clue. Here/next
routing, visibility and `apply clue` semantics are unchanged.

**Coverage is reviewed independently of draft nodes.** For opening/detail drafts that have material `ready_nodes`,
`required_review` includes the existing JSON pointer `/coverage` in addition to current node, claim, numeric and
critical requirements. Skeleton/guidance drafts with empty `ready_nodes` keep their current limited readiness rules.
The existing host review coordinator creates one separate scope-completeness unit for `/coverage` even when the draft
contains zero clue or conclusion nodes. That unit sees the current task intent, known accepted context, the entire
candidate and the source pages actually read for this preparation. A host-only `review_scope_pages` record carries
those observed physical pages, falling back to the draft's source pages only when observations are unavailable. This
is task context, not graph vocabulary or world state. The coverage reviewer must actually view those pages in its
own image context; observations by other reviewers do not count for that unit.

**Observed pages do not define the preparation boundary.** `purpose`, `focus` and `question`
define it. For detail without a question, prepare the focused entity for its current use and
its necessary dependencies; a location focus does not request its whole chapter. Navigation,
surrounding context, map labels and a broad source page range do not make every entity or
investigation branch there ready material. Keep later destinations thin. Each coverage omission
must explain which requested use or immediate dependency would fail without that fact, as well
as identify its source. Already accepted context still counts. A repair follows this same scope;
an earlier review's unrelated suggestions cannot expand it. The host supplies `review_scope_pages`
only to the coverage unit, preserving those pages as evidence rather than assigning them to every
fact reviewer. All proposed facts still receive their required review.

The coverage reviewer compares source to candidate, not only candidate to source: discoverable propositions and
their connections, delivery and gates, knowing NPCs, and clue propositions versus physical carriers are checked for
the prepared task scope. It also checks that supported delivery semantics reach the existing runtime fields and tags
(`delivery_kind`, `delivery`, `skill`, `difficulty`; `skill_check`, `npc_dialogue`, `obvious`) rather than arbitrary
new synonym keys. Already accepted material need not be duplicated, and unprepared future material is not an
omission. The review reuses the existing shape: a `checked` result at `path` or `paths` containing `/coverage`,
`source_refs`, `verdict`, `reason`, plus `missing`. A supported `/coverage` result with a grounded reason can accept
a legitimate no-clue scope; lack of that result, an unclear or contradicted verdict, or missing necessary material
blocks affected publication. There is no numeric density target or count gate, and no claim that model review
mathematically guarantees completeness. The current reviewer workflow and cache are reused with a review protocol
revision; old approvals lacking scope coverage cannot be reused as new coverage evidence. Existing concurrency and
per-unit evidence isolation stay intact.

## 23. PipiCOC local frontend (2026-09-07)

### Current implementation decision: shared presentation attempts (2026-09-14)

The four UI/map/character/document presenters share only their bounded file-attempt protocol: attempt/check setup, up to two owner-runner rounds, event logs, output reads and repair findings. The existing tool-enabled Pi runner, prompts, validators, model/thinking, 120-second per-round timeout and cancellation/error identities remain unchanged. Cache keys and commit points stay with each caller: UI persists only complete projections; maps preserve accepted partial words; character vocabulary merges per round with finance/equipment kept separate; documents require a whole validated reading and retain owner-scoped single-flight. Authored-language, seed, known-label, empty-input and cache bypasses remain intact. No new language table, bare completion or spawn backend is introduced. See `docs/specs/coherent-path-ablation.md` for the binding difference matrix and executable test seams.

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

The `identity` lane carries the sheet's own identity words that are the setup
model's free text rather than rules data -- today exactly `sex` (§23.4). The
setup model drafts it in whatever language it wrote the card in, so a card
drafted in the system language would show that word to the player unchanged;
`identityTexts(view)` collects it from every investigator (skipping empty,
non-string and figure-only values; `occupation_stated` and `concept` stay out --
they are the player's own prose, the first leg), and the projection lands in
`setup/presentations/identity-<language>.json`, merged and topped up like every
other `SHEET_LANES` lane. The panel's sex row and the draft card's identity line
both read it through the same lookup as a clue's name, falling back to the
sheet's own word until the lane answers. The lane is not in `PRESENTATION_LANES`:
a mechanics or delivery card never shows sex, so it has no words to merge there.
The draft-card projection covers the same field because `cardTexts(sheet)`
collects `sex` alongside the occupation and era, so the card a player confirms
already shows the projected word.

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
lanes (`standing`, `possessions`, `clues`), attached by the host on both paths a
card reaches the panel by -- the history page it loads, and the live
`entry_appended` it reads out of the child's stdout -- so the mechanics card
reads the same words as the sheet; the renderer routes every content field
through `term()` (clue name and summary, item and owner names, scene names,
currency, session outcome, worldline and handout names, die captions).

**A delivery is projected where it is drawn, not only where it is re-read.** A
clue's `label` is the Keeper's, in the play language; its `summary` is the
module's sentence, which the graph contract keeps in the source language and
leaves to a later presentation layer (`source_language_law`). That layer is the
`clues` lane, so a card that reads only the kernel glossary opens the row into
the book's own language while the sheet beside it shows the projection of the
same clue. The live reader cannot wait on a file, so it answers from a held copy
of the lanes and starts the read that fills it; a lane that lands anywhere --
that read, or a sheet read topping one up -- replaces the held copy, or the next
delivery draws the words the run was started to replace. A clue found this turn
has no projection at all, because lanes are topped up on a sheet read and the
player may not open the sheet for an hour: the delivery starts the `clues` lane
for the words it carries, once per campaign, language and missing set, and
streams the same entry id again when it lands, which the transcript applies as a
replacement rather than a second copy of the turn.

**Every lane a delivery starts must be one that can collect the words asked
for.** A handed-over handout is module prose under the same law, but it is on no
panel and in no view: `apply handout` writes a card with a body to
`<campaign>/handouts/<handle>.md` and the delivery is its only surface. Its lane
is therefore `handouts`, whose input is those files rather than `table.view` —
`handoutInput` reads each one and takes the `# ` heading the kernel wrote above
the body, so the name is read back and never guessed out of the prose — and the
whole document is one string, because a newspaper column translated a line at a
time stops being a newspaper column. `PRESENTATION_LANES` therefore carries
`handouts` and `SHEET_LANES` does not, the way `standing` is merged but topped
up elsewhere. `deliveryWords` keys what a delivery needs by lane and asks the
handouts lane for `name` and `text` but never `label`: `label` is the Keeper's
own word, already in the play language and nowhere in the files that lane reads,
so asking for it would leave it missing for good and start the lane again on
every later delivery. In the renderer both halves of a row go through `term()`;
the handout's body did not, which folded a play-language title over a column of
the source language.

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

#### What landed and what is left (integration, 2026-09-09)

Landed on four branches and integrated: the renderers (`pipicoc/*.js`, `Coc*.tsx`,
`Transcript.tsx`) read `ui` and caption errors by code; both hosts attach `ui` and
merge the growing lanes under the mechanics entry's labels; the extensions notify
through the `extension` surface; the kernel reads languages from data, obliges
the script class by data, keeps every script in `normalizeText`, builds the
glossary from every `localized_labels` row plus `kernel-terms.json`, requires a
label to reveal an echo, files the display name on an unlabelled clue receipt,
carries the campaign language into a chase, and reads Mod names per tag.

Deviations and residue, each a decision or a ticket rather than a silent gap:

- **Guard scope.** The CJK guard scans `pipicoc/` and only the COC files under
  `Electron/` (`Coc*.tsx`, `coc-*.ts`). The rest of `Electron/packages/ui/src`
  and `pi-backend/src` is the PipiUI host's own chrome (93 and 19 files of it),
  another product's words; localising the host application is issue #63
  (user ruling 2026-09-09: a ticket of its own).
- **Python differential suites retired** (user ruling 2026-09-09). The ten
  `tests/kernel/test_ts_*.py` suites compared the TypeScript kernel against the
  retired Python kernel, which cannot read a per-language Mod manifest; they
  are deleted rather than fed a frozen fixture. `tests/kernel` now speaks to the
  built TypeScript kernel by default (`rpc_support.ts_command`), as the product
  does; `COC_TEST_KERNEL_CMD` still overrides. `test_corpus.py` replays its
  recorded payloads on that default and only compares against a second kernel
  when `COC_TEST_COMPARE_CMD` names one.
- **Starter guidance bundles.** The guidance prompt now states each field's
  language, which changes the bundle fingerprint. The-haunting's bundles were
  rebuilt in parallel; mystery-house's shipped text already satisfied the prompt
  and was re-stamped with the current fingerprint, not regenerated. A guide name
  in the play language needs `kernel-ts/setup/drafts.ts` to store the NPC's
  display name beside the resolved handle, then a bundle rebuild.
- **Panel titles.** `pipiui-extension.json` panel and view titles ("Investigator",
  "Mods", "Scenario preparation") are validated as plain strings by the host's
  manifest schema; no localisation path exists without changing that schema.
  The panels name their landmark from the host-supplied title and draw no
  English fallback of their own.
- **Mod settings.** A Mod setting's caption comes from its JSON Schema `title`
  (string or per-tag object); enum values render as themselves. A per-language
  channel for enum labels belongs to the Mod manifest schema.
- **Handout bodies on the mechanics card** are module text and go through
  `term()`, which only helps when a projection exists; the document-presentation
  lane that reads papers in the play language is the right producer and is not
  yet wired to handout rows.
- **The kernel-minted defence prompt** for a player (`session-view.ts`) is still
  an English sentence; the host discards it and has the Keeper ask in the play
  language, as §16 already ruled. The sentence stays a Keeper-facing note.
- `scripts/starter_graph.py` decides "is this a CJK language" by tag prefix; it is
  a build script for starters and should read the script class from
  `content/languages.json` when next touched.

### Host decision: the play language is open; words are projected, not authored (2026-09-09, supersedes the closed set above)

The user's ruling on the section above: moving the language tables from code into
`content/ui/<tag>/` and registering tags in `languages.json` is still hardcoding.
It is classic i18n -- a closed set of locales, each authored by hand -- and this
product does not work that way. The player's language is whatever the player
names; the words are produced in it by the Keeper and the generators (leg one),
or projected into it by the presenter lane (leg two). Nothing is authored per
language, nothing validates a tag against a list, and nothing guesses a
language from the text it is about to print. Adding a language is nothing.

**The tag set is open.** `play_language` is any BCP-47-shaped tag
(`/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/`, the pattern `validSourceLanguage` already
uses), accepted by `campaign.create`, the hosts, the extensions and the lanes by
shape alone. `content/languages.json` (`coc.play-languages.v2`) keeps only
`default`, the tag a host or kernel falls back to when a session carries none,
and `suggested`, the tags a picker offers first; `languages`, `autonym` and
`script` are gone. A picker names a language through `Intl.DisplayNames` in
that language itself and falls back to the tag; it accepts free text.

**No script obligation.** The kernel's `checkLanguage` / `SCRIPTS` table and the
`play_language_mismatch` refusal on `narrate` and `ask` are removed: a character
class is a detector, and an open set has no table to look in. Whether a
delivery is in the play language is the verifier lane's judgment: a fourth
finding kind `play_language_mismatch` ("the player-facing prose is not written
in <tag>"), advisory like the other three, recorded by `table.warn`. The host's
delivery loop no longer re-asks the Keeper on a kernel language refusal, because
the kernel makes none.

**Words: one authored source, projected per tag.** `content/ui/en/<surface>.json`
is the only authored set of captions (English is the system language). For a
tag, the words resolve in this order: a shipped seed `content/ui/<tag>/`
(optional; a cache the product ships in the same shape, so the default table
pays no model call -- `zh-Hans` ships one, and the seed parity test still pins
its keys to `en`); the home cache `<home>/.coc/ui-words/<tag>-<digest>.json`
written by the projection lane (`digest` = sha256 of the `en` source plus the
instruction, so an edited caption re-projects); otherwise the `en` words are
answered at once with `ui.projected: false` and the host starts one background
projection for the tag, after which the sheet, Mods and choice surfaces refresh
(`sheet_changed`, `mods-changed`, and the bus event `coc:ui-words {tag}` for the
extensions). The projection lane is the presenter: a tool-enabled run with
`content/setup/ui-presentation.md` over every `en` caption, templates keeping
their `{placeholders}` verbatim, answered as `{"texts": {source: projected}}`,
validated complete, retried once, cached per tag for every campaign in the home
(`extensions/module/ui-presentation.ts`, `prepareUiWords`). The extensions read
seed -> cache -> `en` without yielding and reset their surface on `coc:ui-words`.

**Rules terms and guidance.** `localized_labels` rows in the rules data are a
seed of the same kind: the glossary for a tag with no rows is empty and the
presenter lanes (card, standing, possessions, clues) fill the sheet as they
already do, so no kernel change is needed beyond accepting the tag. Bundled
starter guidance is built for the `suggested` tags; a starter opened in a tag
with no bundle generates its guidance per campaign as a PDF module does, never
`guidance_not_ready`.

### Host decision: the identity card is a passport-style page (2026-09-11)

The right sidebar keeps the investigator's identity as live HTML text on a paper
surface. Its small `identityTitle` caption is authored once as `Investigator
credential` in the English sheet surface and uses the existing presenter/cache
path for the play language. Names, occupation, language skills and background
keep their existing sheet/glossary sources; no per-language renderer is added.
Language skills share one caption and align their names and values in separate
columns, including the native language, without changing their values.
The page has a blank portrait mount and an ornamental archival seal. They are
static product artwork, not an investigator portrait, affiliation, status or
receipt. Refresh remains an ordinary host control outside the document.
The approved original seal is retained as artwork, including its fixed lettering;
it straddles the lower-right photo corner instead of sitting wholly on the photo.

The existing era is a quiet page-corner mark, without an `Era` record row.
A canonical four-digit year or decade token (`1920`, `1920s`) displays its four
digits; other era values use their existing projected term, never an invented
calendar year or issue date. The host's sheet answer adds optional
`identity_art: {backplate?: data_url, portrait?: data_url, seal?: data_url}` from the identity artwork
when the panel requests `include_identity_art: true`, using the same host-read
image transport as document paper. A mounted panel retains this artwork so
subsequent sheet refreshes do not resend it. The renderer alone
consumes this decorative block; it causes no game action and is never written
to campaign state. Missing artwork leaves all identity text readable. Text wraps
with the panel width and uses HTML bidirectional isolation without language
detection or locale-specific layout branches. The paper, frame and photo mount
belong to one coherent backplate. The archival seal is a separate transparent
overlay above the reserved portrait layer, so a future generated portrait can
sit beneath the same stamp. An empty card has no seal; the overlay appears only
after an investigator exists. A nine-slice border image preserves the
upper artwork's proportions while extending only the blank lower paper for
longer text. Live text is layered above it; no multiply blend or separately
coloured photo patch remains. The clean backplate contains no copy of the seal.
The standalone installer copies both identity images beside its copied agent;
otherwise the compiled agent's relative asset reads would silently fall back.
Electron's cold `sheet` fast path attaches the same optional block itself because
that path deliberately bypasses the mounted agent.

#### Host decision: the portrait mount generates the investigator's photo (2026-09-11, later)

The blank mount stops being static once an investigator exists: clicking it asks
the host lane for a portrait. This is a host control like Refresh — no kernel
RPC, no turn, no receipt, no Keeper involvement, and nothing enters the offer
ledger. The kernel never reads, writes or validates the image.

- **Subject text** is `backstory.personal_description` verbatim (the field
  reserved above for exactly this), plus the campaign era; a fixed English
  style prefix (1920s sepia archival portrait photograph, aged paper, head and
  shoulders) keeps every portrait on the card's own aesthetic. Style lives in
  the lane, never in the biographical field. An investigator without the
  description answers a refusal code and the mount stays empty.
- **Lane**: a `sheet` invoke action (`portrait: "generate"`) handled by the
  live agent (`pipicoc/sheet.ts`), reusing the image-gen extension's dispatch
  (same credential resolution as `image_gen`; an explicit image-model choice —
  the settings picker or `/image-gen:model` — wins, and grok-build is the
  default only while nothing is chosen; amended 2026-09-12: the picker wrote
  `image-model.json` that the former grok-first dispatch never read, so a
  deliberate selection had no effect while grok was logged in). The cold sheet
  fast path never generates; it only attaches an already-generated file.
  Integration notes: the vendor import is static so esbuild inlines it into
  the compiled agent (a lazy relative import resolves against the compiled
  tree and misses); pi-backend's cold-`sheet` intercept passes a generate
  action through to the mounted agent instead of answering a plain read.
- **Storage**: one host-side file per campaign at
  `<coc-home>/campaigns/<id>/portrait.<ext>`. It is not campaign state, not a
  receipt and not evidence; regenerating overwrites it. Sheet reads attach it
  as `identity_art.portrait` (same data-URL transport as the backplate), so the
  portrait survives restarts without a second generation.
- **Failure** leaves the mount empty and returns an error code; the panel's
  caption is a sheet-surface word (English authored, projected per §23), not an
  authored string in code. `portrait_no_model` means the image-gen dispatch
  reported no configured image model (its `image_model_unconfigured` error
  code); the panel answers that one with the settings hint. `portrait_unavailable`
  is every other generation failure and gets the generic caption. (Amended
  2026-09-12: the idle mount carries only the one-line click invitation,
  centered in the frame; the settings hint appears after a click that found no
  model, not statically on the empty frame.)
- The panel enables the mount only while the investigator has no portrait;
  once one exists the mount is static artwork again — regeneration stays a
  deliberate lane action, never a casual click. While the lane runs the mount
  shows a busy state, and the portrait renders beneath the seal overlay (the
  layering the passport decision reserved).

**Guard.** `tests/extension/ui-words.test.mjs` pins every shipped seed to the
`en` keys and asserts `languages.json` has no `languages` table;
`system-language.test.mjs` keeps refusing a tag comparison or a table keyed by
a tag anywhere in code. `Agents.md` states the rule for every future agent.

**Kernel note (2026-09-09, the open-language kernel slice).** What the kernel
does now, where an earlier section still says otherwise:

- `kernel-ts/read/languages.ts` reads `content/languages.json` as
  `coc.play-languages.v2`: `default` and `suggested` only, each checked by the
  shape `validSourceLanguage` exports (the kernel's one language-tag pattern);
  `playLanguageOf(meta)` returns the campaign's tag when it is tag-shaped, else
  `default`.
- `campaign.create` (§14.4 row `create-campaign`) accepts any tag-shaped
  `play_language`. A malformed one is `invalid_params` with
  `details.field: "play_language"`, `details.suggested` (the picker's first
  offers, from the data) and a `fix` naming the BCP-47 shape; there is no
  `details.options`. The guidance job (`module.read`, `purpose: "guidance"`)
  checks the same shape.
- The script rows of §5 (`table.ask`; `table.narrate` step 2) and of §16.3
  ("Play-language script check") are void: `checkLanguage`, `checkScript`,
  `SCRIPTS` and `playLanguageScript` are deleted and the kernel emits no
  `code_detail: "play_language_mismatch"`. `narrate` and `ask` deliver any text
  on any tag.
- `table.warn` (§12.5) accepts the fourth kind `play_language_mismatch` beside
  `reveal`, `uncommitted_state` and `player_agency`.
- Starter registration reads whichever
  `content/starters/<id>/character-guidance/<tag>.json` files exist; the file
  name is the tag and must be tag-shaped (`invalid_params` otherwise).
  `bundled_guidance_required` gates only the tags a bundle exists for: a listed
  starter opened in a tag with no bundle generates its guidance per campaign
  (`extensions/module/character-guidance.ts`), while a stale bundle still
  answers `guidance_not_ready`. `scripts/build-starter-guidance.ts` bundles the
  `suggested` tags.

**Integration note (2026-09-09).** A shipped seed or home cache is projected only
when it covers every authored key. Partial projections keep their existing words visible
but start the presenter for missing coverage; the presenter always reads the English
source, never the mixed fallback display. This includes newly added message actions.

#### What the hosts landed, and where it deviates (2026-09-09)

The loader, the projection lane, the two hosts, the extensions, the verifier
finding and the picker are in. Three notes, each a decision rather than a silent
gap:

- **`content/languages.json` gained `source`.** The rule above forbids a
  language tag literal in code, and the loader has to name the tag the authored
  captions are written in — for the digest, for the fallback words, and for the
  short-circuit that keeps the authored tag out of the model. `const SOURCE =
  "en"` would be the tag table in code, one entry long, so the tag lives in the
  data with `default` and `suggested`: `{contract, source, default, suggested}`.
  Adding a language is still nothing; changing which language the product is
  authored in is a data change plus a directory rename. The kernel's reader
  ignores keys it does not read, and `system-language.test.mjs` builds its
  forbidden-literal pattern from all three named tags.
- **`ui` carries `projected` and `source`.** Every answer's `ui` block is now
  `{tag, words, projected, source}` — `projected: false` is the authored words
  standing in while the lane runs, and `source` is `seed` | `cache` |
  `default`. The lane's request shape is documented with it: `texts.json`
  carries `play_language`, `captions` (one `{surface, key, text}` row per place
  a caption appears, because a key may itself contain a dot) and `texts` (the
  distinct source strings still owed); the answer is
  `{"texts": {source: projected}}`, and the cache is
  `<home>/.coc/ui-words/<tag>-<digest>.json` =
  `{play_language, digest, texts: {surface: {key: word}}}`, with `digest` the
  full sha256 of the authored surfaces plus `content/setup/ui-presentation.md`.
- **The retry word is shared.** A failed caption projection is not retried on
  its own; the sheet's existing `retry_projection` parameter clears it alongside
  the vocabulary lanes', so one button covers both.

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
The build installs the only copy of the App at `/Applications/PipiCOC.app` (overridable with `PIPICOC_APP_BUNDLE`); `~/leehow/code/pipicoc-build/` keeps the receipt and a back-link to it. LaunchServices will not register a symlink as a bundle, so the real bundle has to be the one in `/Applications`.
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

Foreground source priority (2026-09-10): one foreground and up to two background jobs may hold independent leases for distinct focuses. The third job slot is reserved for foreground work; existing jobs promoted to foreground are joined rather than cancelled or duplicated. Publication remains serialized under the metadata lock and rechecks additive conflicts against the latest graph. A claim advertises concurrency 3. Table-open, newly queued movement work and turn-commit events wake the existing pump immediately, without waiting for agent_end; session-start also drains retained work once its bridge and table binding exist. Wakeups do not block narration or bypass material readiness. Shutdown prevents new dispatch and cancels owned children.

All source/review Pi children in one host retain the 40-process ceiling. At most eight background children may occupy it; foreground work has priority over queued background children and can use the remaining capacity. This is a per-process resource budget, not a promise of provider-wide quota isolation. Background review groups share this budget across the two jobs. In-process promotion also promotes queued child work, without restarting running model requests. Across hosts, persisted priority controls subsequent claims; no duplicate same-focus read is introduced. Unrelated background failure never blocks a foreground claim. The initial background job limit is two; increasing it further requires throughput/latency evidence.


Material identity correction (2026-09-10): readiness belongs to a canonical graph node, not every node sharing a display name or short handle. Scene/exit projections and movement results check the resolved scene node id. Apply source gates resolve each authored effect within its declared entity kind before checking readiness; a ready namesake cannot admit an unread target. Adjacent-scene prefetch checks the resolved destination scene while retaining the original job focus for cache reuse. Source lookup with an explicit question continues to recheck original pages; no semantic question is auto-declared answered and no missing material gate is bypassed.

Already-ready entity questions produce additive node deltas: identity, new source references and newly sourced properties, not a copy of every accepted field. Known context carries physical source citations. Independent review checks the delta and its actual question; it does not demand that unchanged accepted context be copied into the delta. This prevents old facts being mis-cited to a new question's pages and repeatedly re-extracted. Existing merge/conflict checks preserve all prior values.

NPC assertions about another NPC project the assertion's source-authored reason/statement, never the target's canonical biography or secret. Existing source claims remain intact. Self-impersonation is rejected in new drafts (aliases belong on the person) and self-ties are omitted from the Keeper's relationship view. This fixes a source-grounded human-cult belief being projected as knowledge of the target's actual supernatural identity.

Process-observability correction (2026-09-15, user decision): PipiCOC keeps the ordinary live and historical process display. A `coc-keeper` product profile or `coc-session` binding must not suppress assistant text, thinking, tool calls/results, hosted activities, citations or source-detail events, including `message_end` catch-up and history reconciliation. These events also drive the thinking/tool waiting phases; hiding them removed useful debugging information and left players unable to see what was running. Restore the existing renderer paths without adding a privacy/debug switch or a second progress protocol. Existing credential redaction remains in force. Displaying process information does not make provisional text a canonical game-state change: ordinary receipts, delivery boundaries and structured mechanics/choices remain unchanged. Turn/retry status, terminal errors and authoritative presentations continue to stream, including immediate `coc-delivery` notices on `entry_appended`. The investigator panel's separate omission of canonical NPC names is not changed by this process-display correction. Other products keep their existing behavior.

A detail/source lookup must contain a nonempty named focus/query. A question adds scope but does not replace the target; this keeps retries from changing their identity by filling in a missing target later. Empty requests are rejected before dispatch; they must never create a generic, reusable detail job that hides which player need was answered.

Concurrent reading additionally excludes the same normalized focus: a foreground question about a scene being prepared in the background waits for that scene's publication, then claims a fresh context. Independent targets keep the foreground slot. This avoids two readers independently rewriting the same previously-thin scene. Existing failed attempts retain all artifacts and explicit retry claims a fresh published context.

A read-completion checkpoint names the job whose own read phase produced it, and only that job's own later attempt may use it to skip reading. An interruption therefore still does not pay for the source reading twice, while an explicit `retry: true` that inherits a failed job's draft always begins with the source-based repair read: the retained draft and its findings are the reader's input, not a settled result. Re-reviewing identical bytes under identical instructions cannot re-scope them, so without this a draft that grew out of scope would be re-verified on every retry, spend the whole foreground budget on its own review units, and never reach the repair round that would shrink it.

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
- Name normalisation folds composed diacritics (2026-09-10, #64). `normalize` is NFKC,
  then every mark Unicode composes onto its base letter is dropped (`Sánchez` →
  `sanchez`); marks the standard never composes (Devanagari vowel signs, Thai tone
  marks, Arabic harakat) stay, so `किरण` and `करण` remain two names. Node ids are ASCII
  kebab by the shape gate while names keep the book's spelling, so before this a name
  differing from its own handle only by an accent could never resolve: `apply npc`
  refused `Nemesio Sánchez` with `npc-nemesio-sanchez` in the graph. The fold applies
  wherever `normalize` compares names (graph resolution and the name index, party
  sheets, inventory and weapons, notes and rulings, memory `about`, material
  readiness); two nodes that fold together are `unknown_entity` ambiguous with both
  candidates. Two persisted digests include the folded key and shift only for accented
  names: the Mod registration queue key and the reading-job identity. `normalizeText`
  (markers, minted ids, `kebab`) is unchanged and keeps every mark. A title in front of
  a name (`Professor Nemesio Sánchez`) is not folded: that needs a word list, which
  the rules forbid; the bare name reaches the node through the whole-word run below.
- Whole-word contiguous-run fallback (2026-09-10, #64 second half). After both exact
  paths miss (no node's handle equals the normalised query and the `names` index has
  no such key), `resolve` splits the query into whitespace words and looks for that
  word sequence, in order and unbroken, **at one end of** each candidate's normalised
  name keys: `nemesio sanchez` closes `professor nemesio sanchez` and opens
  `nemesio sanchez jr.`; `emesio sanchez` (inside a word) and `nemesio sanch` do
  not, nor does `nemesio` ... `sanchez` with other words between. No title list exists
  or is allowed: `Professor`, `Dr.`, `Padre` are just extra words to the kernel. Exactly
  one node holding the run resolves; several raise the same `unknown_entity` ambiguous
  error with every candidate; none falls to the existing not-found error. Nothing that
  resolves today changes: the fallback runs strictly after the exact paths, so a query
  that is a node's exact handle or alias and also a run inside another node's name
  still resolves to the exact one. Bounds, as tight as the shape allows: the query must
  be at least two words (a single word stays a hint for `candidates` and `look`, not an
  identity -- otherwise free-text targets in the resolve pipeline such as `door`,
  `key`, `professor` would start binding silently to nodes), must sit at one end of the
  key, and must be strictly shorter than
  the key (equal length would have been an exact hit). What got looser, deliberately:
  every kind and every caller of `resolve`/`find` (`apply npc/clue/move/handout`,
  ruling anchors, `look npc`, the resolve pipeline's target and supporting clue, spell
  targets, memory `about`); kebab ids are name keys too, so `old house` resolves to the
  only `scene-the-old-house`. `find` still returns null on ambiguity, never a pick.

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

**A cell the rulebook printed no figure for is empty.** It is not a zero and not
the absent value itself. `cash-assets`'s lowest row prints `None` in the assets
column, so the kernel records `{amount: null, currency, formula: "None"}` — a
complete, honest record that the book prints no figure here — and never
substitutes a zero, which would invent a figure the book does not print. Every
card that draws money draws an absent amount the way it draws its other absent
cells. A real table printed the literal word `null` beside a currency, and
another printed a unit with no figure at all; both are the same defect.

**A period that stood in is said where the numbers are.** When
`sheet.finance.substituted_for` is present the figures were built from a column
the book is not set in (§22.9), and both the character draft and the play-time
sheet say so beside the money: the period the figures came from
(`sheet.finance.period`) and the authored setting it stood in for, in the play
language. The setup agent still states it once in its own words, but that
sentence is prose in a transcript and scrolls away — a real 1895 campaign never
said it at all, and its investigator then carried 1920s money unqualified for the
whole campaign — so the card, which the player can reopen at any time, is where
the fact is guaranteed. The authored setting travels as the book wrote it; it is
never read for a year or rewritten into a table key.

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
of the current semantic profile: name, occupation, age, sex (required, free text —
never an enum, never inferred from the name by code: the setup model drafts it as a
visible suggestion in the play language, the player's own words or its best reading
of the person the player described, and the player sees it on the draft card and
corrects it conversationally before confirm; the kernel refuses a profile whose sex
is empty with a needs finding naming sex), concept, occupation_skills
(eight concrete skills, including required catalog skills), interest_skills (concrete
skills), own_language, backstory (3–6 populated first-six categories plus scenario_bound),
key_connection (backstory_field and summary), equipment (named ordinary items),
weapons (optional: rules-table profile names, by the printable name or the table id,
resolved and written onto the card as the printable name), aptitude (optional strong/weak characteristic
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
that exact sheet, without random generation. revision may be omitted, in which case
the campaign's current draft revision is confirmed; a pinned stale revision still
conflicts. approved requires the current preview
ack and a later player-input token than the draft creation input; delegated is only for explicit write-now requests and does not pretend the
player saw a prior version. The extension injects the per-input token, never the model.

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

#### Manual numeric override from the card (2026-09-10)

The card is the one draft, but until now the only way to change its numbers was to
describe a change in chat and accept a fresh roll. `setup.override` is the
structured path: a host-only RPC behind the card's manual-edit control, never
called by the setup model. Conversational `setup.draft` keeps owning semantic
changes and its rolled arithmetic is untouched; the override changes numbers on
the existing person and says so on the record.

**Call.** `setup.override {campaign, revision, edits, limits_override?, dry_run?}`.
`revision` must equal the campaign's current `setup.draft_revision` — the same
optimistic-concurrency rule as preview/confirm — and a stale one is
`idempotency_conflict` with codeDetail `stale_draft`. The campaign must still be
`setting_up`; once the card is committed the investigator belongs to the table and
overrides are refused. The call carries no `input_key`: it is a host action, not a
player message, so the draft it writes has a null `input_key`.

**Edits.** `edits` is a partial numeric update with exactly these optional fields;
unknown fields are `invalid_params`:

- `characteristics`: object over the nine abbreviations; each value an integer.
  Default bounds are [15, 90] — the rulebook creation range, which the point-buy
  table in `characteristic-dice.json` records with the same floor and ceiling.
- `skills`: object over skills already listed on the sheet; each value an integer.
  A skill's floor is its base value recomputed on the new characteristics
  (unlearning is not a creation edit); its ceiling is the effective starting cap
  (default `skills.guided_creation_policy.starting_skill_cap`, 75). Skills absent
  from the sheet cannot be added, Cthulhu Mythos stays banned, and Credit Rating
  is not a skill edit.
- `credit_rating`: integer within the occupation's `credit_rating_range`.

Name, age, occupation, era, backstory and kit stay conversational: age is a
one-way application of rulebook adjustments and identity fields are the setup
model's semantic job, so the edit control edits numbers only.

**Accounting.** The override rebuilds the sheet from the stored draft rather than
patching cells:

1. Named characteristics take their edited values; the rest keep the stored ones.
2. Skill base values are recomputed from the new characteristics through the
   existing `Chargen.skillBase`, and every skill keeps its recorded point
   investment — final = new base + held points — before `edits.skills` is applied
   on top of that.
3. Budgets are charged against formulas evaluated on the new characteristics:
   occupational spend (points above base on the occupation's skill list, plus
   Credit Rating) against the occupation formula total, and every other skill's
   points above base against personal interest (INT*2). An edit that breaks a
   bound is `needs`, with details naming the pool, its total, the attempted spend
   and the legal range of the offending field — the closed-set refusal shape the
   frontend needs to mark the exact input. The sheet's allocation ledger
   (`creation.skills`) is rewritten to the manual allocation it now holds:
   per-skill points above base, each pool's budget evaluated on the new
   characteristics, spent and remaining — so the saved card's budget table never
   shows the rolled ledger the override replaced.
4. Derived values are recomputed by the existing `Chargen.derive` with the stored
   age movement penalty, and `current_hp/mp/san/luck` reset to the new values —
   setup has taken no damage. Age does not change, so the MOV penalty is not
   re-rolled either. A credit_rating edit also recomputes cash and finance
   through the existing cash-assets table of the draft's era, so the card's
   wealth line agrees with its rating.

**Limits and the unlock.** Both `setup.draft` and `setup.override` results carry a
`limits` block, also stored in the draft file, so the edit control renders the
rules instead of hardcoding them: characteristic floor/ceiling, starting skill
cap, the occupation formula with its evaluated total, the interest formula with
its evaluated total, the credit rating range, and which entries an override
supplied. `limits_override {characteristic_min?, characteristic_max?, skill_cap?,
occupation_points?, interest_points?}` relaxes exactly those bounds: the two
budget fields replace the evaluated formula totals while the formulas stay on the
record. The override is stored on the draft, applies to the call that carries it,
and persists on later drafts of the same campaign until changed — the control's
unlocked state survives closing and reopening, and the `limits` block always says
what is in force. Credit Rating's range is the occupation's and is not itself
unlockable; a raised `occupation_points` is how an unlocked draft affords more of
it.

**Persistence and audit.** Without `dry_run`, the override writes the next
immutable draft revision: the base draft's `seed` and `profile`, the rebuilt
sheet, `creation.method` preserved (the dice evidence stays), a new
`creation.manual` record {base_revision, edits, limits_override} and a recomputed
`digest`. `campaign.setup.draft_revision` advances and `previewed_revision`
clears, exactly as `setup.draft` does. `dry_run: true` runs the same rebuild and
validation and returns the would-be result without writing anything — the
control's live preview of derived values and budgets as fields change. Because an
override keeps its base profile, a later `setup.draft` with an identical profile
returns the overridden draft unchanged under its existing reuse rule; a later
`setup.draft` with a changed profile rebuilds from the dice and supersedes the
manual numbers — the player asked the fiction for a different person. Preview and
confirmation are unchanged: the re-rendered card acknowledges the new revision,
and `setup.confirm` commits exactly that sheet.

**Frontend rendering.** A `coc-character-draft` transcript entry renders the bound
campaign's current draft, read from the draft store at history time, not a
snapshot of the revision that appended it: the entry marks where the card sits in
the conversation, and a manual edit must neither fork the visible card from
campaign state nor rewrite a live session file. After confirmation the current
draft is the confirmed sheet, so cards freeze on it naturally. The edit control's
chrome (its button, the limit captions, the budget labels) joins the card's
existing English text keys and is projected by the same presenter lane — no
language table and no language branch.

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
`setting_up` campaign with the setup shape above, `slots` included). List returns every
installed version, compatibility, active/pending versions and player-safe settings.
Unbound panels manage installation and new-campaign defaults; they never guess a
campaign. Changes during open/acting turns or live subsystem sessions remain pending
until a safe boundary. The whole resolved set is checked for dependencies/conflicts
before activation. Unknown settings named in a request are rejected. When a request changes
`version` and names no `settings`, the kernel carries the active lock's settings forward but keeps
only the keys the target version declares; the keys it drops are written once to the campaign's
`telemetry.jsonl` as `{"lane": "mods", "event": "settings_retired", "mod", "from", "to", "keys"}`,
and the new lock shows the target version's settings (2026-09-10, #70, §30.12; until then the
panel's version-only Update was refused whenever the target version had removed a setting). A save
pins version, digest, settings and state version in `world.mods`; no automatic latest-version
selection.
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
capabilities. Its first version put the whole exchange — what to ask, when to
stop, how to read the player — into one instruction, and every real session
that went wrong was fixed by adding a rule to that instruction. That is the wrong
place: a prompt holding policy drifts, and a self-check added per failure grows
without bound. The exchange is therefore a **form**, in the sense task-oriented
dialogue systems give the word: a table of slots, a host that computes the state
and the one allowed move each turn, and a model that only reads answers into
slots and renders the move in the fiction.

**Slots are content.** `contributes.setup_slots` names a package JSON file
(behind `setup.guidance.v1`): an array of `{id, required, purpose, ask}` where
`id` is a semantic slug (`stop` is reserved), `purpose` is the one English line
that says what the slot decides — the model says it in the play language before
asking — and `ask` is the shape of question that fills it. Ids must be unique
within a package; across packages the earlier package in load order keeps an id
and the later one is listed as `displaced`. `mods.context` for a `setting_up`
campaign returns the active slots in load order as `slots`.

**Notes live in the kernel.** `setup.note {campaign, slot, value, origin?}`
records what the model read from the player: `slot` must be an active slot id or
`stop`; `value` is a non-empty string of at most 400 characters (for `stop`, it is
the player's words that meant it); `origin` is `player` or `concept` (the
`create-investigator.aptitude.origins` set), default `player`, and `stop` is only
ever `player`. `setup.note {campaign, advance: true}` counts one guiding turn.
Both write `campaign.json.setup.notes = {slots: {<id>: {value, origin, turn}},
turns}` under the setup lock, only while `setting_up`, and `setup.steps.state.notes`
returns it, so a resumed session continues the same exchange. A note carries no
order and is not a step of the seven-step table: the `setup` tool accepts
`step: "note"` once the campaign exists and routes it here.

**The host computes the move.** On every setup turn with active slots and no draft
yet, the onboarding extension advances the turn counter when the exchange is open
(a note exists), then appends a brief block to the system prompt: the turn count
against the package's `max_guided_turns`, every slot as filled (value and origin)
or missing (purpose and ask), and exactly one move — `ask <the first missing
required slot>` or `draft`. `draft` is the move when every required slot is
filled, when `stop` is noted, or when the cap is reached; otherwise the move is a
question. The same block is returned by every `note` result, so the model sees
the next move the moment it has recorded an answer. `create-investigator` is
refused with `brief_incomplete` (naming the missing slots and the move) while the
move is a question, exactly as the kernel refuses an incomplete profile. What the
player already said is noted before anything is asked, so a player whose first
sentence fills every slot is asked nothing; a filled slot is never asked.

**What is left to the instruction.** `guide.md` keeps only rendering: the opening
frame on the first question, the purpose line before each question, a concrete
acknowledgement of the previous answer in the play language's ordinary words,
one question per turn, the fixed reminder that "draft it now" ends the exchange,
and the aptitude rules of §23.4. Reading how much the player wants to say is no
longer a judgment: depth is the slot table and the cap. Disabling the package
returns the campaign to the core policy: name and occupation, then a card.

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

### Use-based physical objects: `objects.usages.v1` (2026-09-15)

Direction (user-confirmed; ADR 0005; spec `docs/specs/action-derived-object-usages.md`):
the object keeps what it is, the action chooses how it is used this time, and the
usage record describes how that use settles. `item` / `weapon` on a physical
definition is a compatibility and display label, not an execution gate. Production
is the TypeScript kernel (`kernel-ts/`). The retired Python kernel is not a second
implementation and is not restored.

`objects.usages.v1` is a Mod-generated data capability. It lets a materializer
create and validate usage records for physical instances; it does not add a fake
RuleGraph resolver node. Execution still goes through the registered combat
resolver / settlement path for the selected mode. Disabling the generator does not
delete already accepted, still applicable records; missing parameters then refuse
generation explicitly and do not fall back to arbitrary damage. Spell knowledge is
not a physical object: this slice does not merge `spell` with items, and owning a
book still does not grant a spell. Documents, containers, consumables and other
existing capabilities stay; an attack usage must not overwrite them.

**Who writes, who reads, who acts.** Creator prepares a draft; the kernel accepts
it through `apply usage` (or the host-only prepared-usage entry below) into
`world.objects.usages`. `look`, Mod context, ability
projection and combat resolution read those records. The Keeper selects a usage by
natural name; registration receipts and attack receipts name the same instance and
usage. Offer ledgers only count; unused usages are not next-turn obligations.

#### Apply `usage`

`table.apply` gains
`{"kind": "usage", "object": "<instance natural name>", "name": "<usage natural name>", "description": "<actual use and context>"}`.
The Keeper names the held or staged instance, the usage, and the action as it
happened. The Keeper never submits executable parameters, internal ids,
weapon_id handles, or an unaccepted draft. Host-private `_usage` and `_provenance`
carry the accepted packet the way `_definition` / `_provenance` carry a define;
they are stripped from the public call fingerprint and must not mutate the
Keeper's original tool arguments.

A new `define` that omits `category` defaults to `item`. Existing `weapon` and
`spell` define calls stay valid. `category` is not consulted as the entity-attack
execution gate: an ordinary `item` instance may carry attack usages, and a
`weapon` instance may be used without treating that label as permission.

`usage` is a contributed Mod effect (`contributions.mods`). A batch still
validates every effect and then writes, or writes nothing. Opening apply allowlist
includes `usage` only as pure parameter registration: it does not roll, advance
the clock, spend an action, change HP, or consume ammunition or charges. Usage
preparation and an actual physical object pickup / transfer are player actions
when `playerText` is present, so action-admission reviews them before Mod prepare
or real apply. Pure `adopt` and same-owner state changes remain bookkeeping; NPC
resolve keeps its existing exemption. Admission binds the public object, usage,
definition and ordered effects; private accepted packets and preview fields do
not enter the admission key. Source truth stays read-only. Damage with an
attacker is `resolve`, never `apply damage`, `note`, or prose.

#### `mods.job` role `usage` and `mods.accept`

Host-only `mods.job` accepts `role: "usage"` beside the existing `create` role.
The job input is `{object, name, description}` — the same three fields as the
apply effect, without `kind`. A host-private top-level `preview` may accompany a
usage job. It contains only same-batch `define` / `object` effects that have
already been materialized earlier in that batch and precede this usage. The host
accepts staged definitions first, then prepares usage jobs against that preview;
it does not run a half-batch `table.apply` or expose preview data in the Keeper's
public input.

The kernel builds usage preview by cloning the world and staged sheets and then
running the same `stageModEffect` path used by real apply. `mods.accept` rebuilds
that preview, verifies `request_digest`, validates the job, instance and
`physical_basis`, and refuses bad, stale or mismatched input without writing the
world. Replay of an accepted job reads stored data and does not invoke a model.

`request.json` sets `role: "usage"`; the kernel supplies object facts (immutable
definition projection, traits, already accepted usages) and the instance's
current condition. The creator does not rewrite module truth, invent undiscovered
facts, or treat player intent as a physical fact. Mode is a model judgment of how
this action executes, not a new physical-semantic classifier and not a
name-to-damage table.

The creator writes `result.json` as
`{name, description, basis, mode, parameters, player_view}`:

- `mode` is the closed execution type `melee` | `thrown` | `firearm`.
- `parameters` use the existing weapon-parameter shape. Required explicit fields:
  `skill`, `damage`, `uses_per_round`, `impale`, `adds_damage_bonus`. Range is
  `base_range_yards` when the profile has a range. `initial_ammo` and every other
  instance-state supplement are forbidden: ammunition, charges, quantity and
  condition live only on the instance.
- `player_view` follows the existing public-field rules for definitions.
- A record with only `damage` is refused. Unsupported skills or effects, out-of-
  range dice expressions and ambiguous names refuse before any world write.

`mods.accept` returns
`{usage: <validated raw>, physical_basis: <kernel-captured basis>, provenance: {mod, digest, job}}`.
The host copies that entire accepted object onto the usage effect as `_usage` and
stamps `_provenance` as `{mod, digest, job}`. Stage must re-validate the job, the
instance and the `physical_basis` before the batch commits; a stale or mismatched
basis is a refusal, not a silent rewrite. Failed, cancelled or refused jobs keep
their evidence and do not pretend the item worked.

#### Prepared usages (prefetch)

**Who writes, who reads, who acts.** After a committed turn the host may request
optional usage proposals for physical instances in the active scene or held by
investigators/NPCs. The same tool-enabled creator writes at most one plausible
attack usage from the object's physical facts; the kernel validates and registers
it in `world.objects.usages`. The existing Keeper projections and reuse/resolve
paths read it. The Keeper alone chooses whether to use it for a later authorized
action. Prefetch is not a player action: it produces no receipt, offer-ledger entry,
clock advancement, world-time change, action/resource consumption or admission
request. It neither claims that the player acted nor recommends an unused object.
Only the accepted data, retained job directory and telemetry record preparation.

The host reads `mods.prefetch.targets {campaign}` before scanning. This read-only
RPC returns `{campaign, worldline, turn, state, pending_choice, active_scene,
instances}`. Each instance has `{id, name, owner: {kind, id?, name?},
definition_digest, condition, has_any_usage, covered}`; owner kind is
`investigator`, `npc`, `scene` or `other` (including an immediate object container).
Scope is physical instances in the active scene or held by investigators/NPCs,
including instances nested in their containers, not the whole world. Owner is the
immediate owner; containment is followed only to establish scope. There is no
24-row projection limit. `worldline` is the active worldline (or null), `turn`,
`state` and `pending_choice` are the retained turn fields, and `active_scene` is
the world scene handle (or null).

`has_any_usage` counts every retained usage record for the instance, regardless
of provenance or current applicability. `covered` checks for `accepted.json`
under the same current proposal identity and job-directory function used by job
creation and acceptance. Positive and null negative results both count; unfinished
jobs do not. A changed physical basis or provider/worldline binding selects a new
key. With no active usage provider, `covered` is false. The RPC returns all
in-scope instances honestly, including those with usages: filtering such instances,
in-flight deduplication, serial scheduling and budgets belong to the host.

This method creates no job directories, registers no usages, writes no campaign
or world state, emits no receipts, advances no clocks and leaves pending choices
unchanged. It does not prepare a proposal as a side effect of checking coverage.

The host calls `mods.job` with `role: "usage"` and
`input: {object: <instance natural name>, propose: true}`. No staged `preview` is
allowed: proposals concern existing instances, not pending player effects.
`request.json` keeps the same usage facts and catalogs; its input marks a proposal,
not a player's utterance. The creator supplies its own natural usage name and
capability description, writes the ordinary single-usage `result.json` shape, or
writes JSON `null` when no reasonable attack usage exists. This is the same
creator and validation contract, not a new semantic lane or a name classifier.

The proposal key contains campaign, active worldline, immutable object identity
and physical basis, `propose: true`, and the same provider/package version binding
as action jobs. It has no turn stamp, receipts or other mutable turn context.
The first retained request has a separate digest checked at acceptance. Repeated
requests under the same basis reuse that directory, including accepted negative
results; a changed basis gets a new key. Host scanning, serial concurrency and the
per-turn budget belong to the host (default two, zero disables new prefetch).

Only `mods.prefetch.accept {campaign, job}` accepts proposal jobs. It reuses all
ordinary usage validation, provider/worldline checks and physical-basis checks,
then directly registers the accepted record without `table.apply` or a receipt.
It returns `{usage, physical_basis, provenance: {mod, digest, job, prefetched: true}}`;
`usage` is null for an accepted negative result, retained in `accepted.json` and
telemetry without a world write. Positive results carry this provenance unchanged
into the immutable record. Acceptance is idempotent; duplicate accepts do not
append duplicate records. `mods.accept` refuses proposals with reason
`prefetch_accept_required`; `mods.prefetch.accept` refuses action jobs with reason
`action_accept_required`. The ordinary action path never sets `prefetched`;
`reused_usage` keeps its existing reference-to-registered-record meaning.

Failures are silent to the player and retained only as job evidence and telemetry;
they do not fake success, block play or bind a speculative result to an action.
Prefetch is an independent, optional, discardable supplement, never permission to
defer a usage the player already requested. Action jobs remain bound to their
original turn. Applicability and invalidation are identical to action-generated
records, including ownership/resource rules at execution. Worldline snapshots,
forks and conflicts retain their existing behavior; a job may not cross worldlines.
Disabling the generator stops new proposals but leaves accepted applicable records
usable through the ordinary projection and resolve paths.

#### Immutable usage records and reuse

Accepted records append to `world.objects.usages`, keyed by instance, and are
immutable. They do not replace `world.objects.definitions` or instances. Each
record carries at least: a host-minted id, the instance, the usage name, the
supported execution mode, parameters, the captured `physical_basis`, rule /
executor versions, generation provenance and accepted status. Old rows stay;
numbers are never overwritten in place.

The kernel captures `physical_basis` bound to the immutable definition digest and
the instance condition at acceptance. Ownership changes, turn advances,
ammunition, charges and a rephrased player sentence are not cache-invalidation
reasons. Reuse is instance + chosen usage name + that physical basis, under a
compatible rule version. Semantic synonymy is the Keeper selecting an already
accepted usage; it is not a hash of the original utterance or of the turn text.
Actor skill values, damage bonus, current range, target defence, ammunition and
remaining uses are read live at `resolve`. They are not frozen into the usage as
a permanent generated result.

When material, structure or integrity facts change, old rows remain auditable but
must not execute without a fresh applicability check. The Keeper may reuse a
still-applicable record or request a new one for the new condition. The creator
must not claim the object is repaired by rewriting basis. `jammed` / `broken` are
not a blanket ban on every usage: a jammed firearm cannot fire and may still be
used as a melee usage if one is accepted; a broken chair cannot keep an intact
swing profile, but a usage derived from the remaining structure may. That is
neither clearing state nor defaulting damaged objects to usable.

Ammunition, charges and quantity exist only on the instance. Multiple usages must
not clone a magazine or uses pool. Ambiguous stacks of ordinary items still refuse
under existing quantity / possession rules; this slice does not add a split-stack
system.

Worldline snapshots include usages with definitions and instances. Conflicting
records are explicit, never a silent regenerate-and-win. Historical definitions,
receipts and playtest evidence are not rewritten.

#### `resolve` object, weapon alias and usage selection

`action.object` is the unified physical-instance entry (natural name). Existing
`action.weapon` remains a compatible alias for the same instance. If both are
filled and resolve to different objects, the call is refused (`invalid_params`);
the kernel does not silently pick one. `action.usage` is the optional natural
usage name. One applicable default attack usage may omit it. Several applicable
usages require an explicit name; the kernel returns the existing usages and does
not guess. The player does not choose internal terms: when they already said
swing versus throw, the Keeper fills `action.usage`.

Unregistered, inapplicable, unheld or not-yet-accepted usages refuse before any
roll or resource change, with a repairable reason. Default attack selection never
covers `objects:use`, `objects:repair` or spell decisions. Combat hit skill is
the selected usage profile's `parameters.skill` (or the mapped legacy weapon
profile), not `action.skill`. `action.skill` remains the ordinary-check and
`objects:repair` slot.

A previously accepted weapon definition maps deterministically to a default
attack usage without calling a model and without rewriting historical rows. A
newly accepted usage has its own usage id. That id is the combat `weapon_id`.
Every projected weapon / usage row carries `object_id` back to the single
physical resource pool. Look, investigator sheet, NPC usable-weapon choice and a
live combat snapshot all read this same set. Switching usage in an open fight
refreshes skill, damage, range and uses-per-round from the selected record; it
does not reset round order, clear participants, or recast instance identity.

Thrown settlement lands only after a real roll settles. It reuses `apply object`'s
`moveObject` path and the shared `kernel-ts/mods/object-transfer.ts`
`objectTransferReceipt` builder, preserving the existing `item-transferred` event
shape. Pending defence, combat-start handoff and refused attacks do not move the
object early; idempotent replay does not transfer it a second time. This is the
implemented apply-object state / receipt path, not a Keeper instruction to say
one more sentence and not an arbitrary direct world mutation.

#### Same-turn prepare and later slices

Define/adopt-only bookkeeping may still take the existing background `mods.queued`
defer and resume next turn. A usage the current action depends on must not. The
host prepares that usage on its own concurrent job, waits for `mods.accept`, and
returns the result to the Keeper who is still handling the same action so the
original `resolve` can continue. It does not ask the player for a second input
that only means "the system finished registering". Timeout, cancel or host
restart keep the job evidence and an explicit pending state; they must not fake
success or blindly resubmit the attack. A recovered result may bind only to the
still-valid original action; an action-bound stale result must not affect another
turn, worldline or a now-different instance. Independent prepared usages follow the
prefetch entry above, never this action-recovery path.

Prepare, accept and execute are distinct: a prepared draft is not possession; an
accepted usage is not a settled attack. Each `apply` batch stays atomic; `resolve`
stays idempotent. If pickup already committed and the later attack fails, receipts
show the object held and the attack not rolled — they do not grant the object a
second time.

First implementation cut (`held-object-usage`): already-held instances only. The
host waits; it does not defer a usage requested by the current player action.
Optional prefetch before such a request is a separate path, not action deferral.

Next cut (`scene-object-action`): a same-batch `define` / `object` / `usage` may
resolve through a staged view (definition, instance, usage) and then validate and
write as one batch. Scene materialization, adopt and pickup share that view with
admission and same-turn continuation. Failure, cancel and restart must not repeat
acquisition or the roll, and must not reuse the bookkeeping-only defer path.

Following cut (`stateful-multiple-usages`): several usages on one instance (swing
and throw), condition-gated applicability, shared ammo / charges, landing
transfers, NPC and investigator using the same instance after a hand-off, and
switching usage in a live fight. Mechanics JSON and the executor must show the
same chosen usage.

Compatibility cut (`compatibility-and-live`): old saves, version locks, disabled
generators, worldline conflicts, and the live-table method in §10. The old-save,
disabled-generator, explicit-upgrade and worldline regression cases pass; the
live-table evidence is recorded in the status note under the kernel's decisions
below.

#### Compatibility that does not authorize execution

`apply item.weapon` still resolves a rules-table profile (`rules-json/weapons.json`).
Unmanaged equipment rows remain until an explicit adopt; switching a usage must
not wipe the sheet. After adopt, one asset must not expose two consumable resource
pools. Compatibility readers may inspect historical `category` to map old data.
The new execution path must not use that field as a permission gate. No historical
campaign is batch-migrated; a campaign lock still changes only on an explicit
upgrade. Closing Enhanced Items leaves accepted applicable usages executable.

#### Preparation progress

While an in-turn definition or usage batch is preparing, the host emits
`mods-progress` on its panel channel with
`{campaign, role: "define"|"usage", objects: [<natural names>], done, total}`.
`done >= total` clears the line. The TUI shows the same line as a footer status
while the batch is in flight and clears it on completion, failure or shutdown;
background prefetch stays silent. Player-visible captions come from the shipped
ui-words surfaces (`content/ui/en/mods.json`, keys `progress.define` and
`progress.usage`, with `{objects}`, `{done}`, `{total}` placeholders) and are
projected per play language through the presenter lane: code carries no
per-language table or branch. Long object lists are clipped to two names.

#### Receipts, events and tests

Action-triggered new usage provisionally reuses existing `kind: "definition"` receipts, adding
`object` and `usage` fields, and the existing `definition-created` event, so this
slice does not mint an event kind with no consumer. Combat settlement receipts
also name the usage and the instance. Host-minted usage ids and job paths never
need to be copied by the Keeper.

Test interfaces: the production path is the seven Keeper verbs
through the TypeScript kernel RPC. Kernel cases cover selection, reuse, atomic
refusal, ownership / condition, shared resources and live skill / DB — extending
`tests/kernel/test_mods.py` (run against TS) and `tests/extension/ts-kernel-mods.test.mjs`.
Host cases cover `mods.job` / `mods.accept` / same-turn continue around
`extensions/mods/index.ts` and `extensions/kernel/tools.ts`. A test that only
asserts an internal map grew a row is not enough; it must show the chosen usage
changed the parameters actually used to settle. `tests/extension/world-state-seams.test.mjs`
still pairs writes with projections; `tests/extension/system-language.test.mjs`
still forbids CJK and per-tag language tables in code. Live-table acceptance
followed the unique method in §10 and Agents.md on campaign
`object-usages-live-sep15`; the evidence is summarized in the status note below.
`.coc` campaign, module, transcript and playtest evidence are not deleted or
rewritten to make a slice look done.

### The kernel's decisions (`objects.usages.v1`; implemented 2026-09-15)

- Prepared usages use `mods.job`'s `input.propose: true` variant and the independent
  `mods.prefetch.accept` entry. Stable proposal keys exclude turn/request-context
  digests; the first request digest is retained separately for tamper checks.
  Positive and null negative results retain `{mod, digest, job, prefetched: true}`.
  Positive acceptance uses `registerUsage` and existing inventory projection, not
  apply staging, receipts or clock effects. Action jobs retain their turn binding.
  Host scanning, budgets and silent failure reporting are a separate host slice.

- `mods.prefetch.targets` reads campaign files without transaction initialization
  or legacy repair. Proposal identity, key hashing and job-directory resolution
  are shared with creation/acceptance, so checking coverage never creates a job.
  Immediate owner metadata and all retained usage records are projected without
  applying the host's skip-used policy or budget.

**Status.** Implemented and verified 2026-09-15. The TypeScript kernel, host and
Enhanced Items 1.2.1 cover held-object usage, staged scene usage, stateful
multiple usages and admission review. Kernel/play suite: 1276 passed with one
pre-existing unrelated setup era case deselected after being reproduced failing
on a clean HEAD checkout. Extension suite: 1214/1215, the one failure a
load-flaky runtime process-lifetime case that passes 28/28 in isolation.
Whole-diff review found no critical issue after the accepted-cache, reload-pool,
pending-defense and public-projection fixes. Real table: campaign
`object-usages-live-sep15` (Grok 4.6 Keeper, this session as the sole player)
registered the improvised usage for the held wooden stool through the real usage
job and tool-enabled creator, rolled the attack, reused the accepted profile on
the next attack, and recorded the stool as damaged; evidence is retained under
`.coc/`. No production Python path.

- **Capability and effect.** `objects.usages.v1` is a Mod-generated data
  capability. Apply input is `{kind: "usage", object, name, description}` only.
  Default `define.category` is `item` when omitted. `category` is not an attack
  gate. Execution uses registered combat settlement, not a new RuleGraph resolver
  node.
- **Job, preview and accept.** `mods.job` `role: "usage"` input is
  `{object, name, description}`. Host-private top-level `preview` contains only
  earlier same-batch materialized `define` / `object` effects. The host accepts
  define before usage and never commits a half batch. Kernel preview clones world
  and staged sheets through `stageModEffect`; accept rebuilds preview and checks
  `request_digest` plus `physical_basis`. Bad or stale data writes nothing.
- **Creator result.** `request.json` carries the usage role plus kernel-supplied
  object facts and condition. Creator `result.json` is
  `{name, description, basis, mode, parameters, player_view}` with closed `mode`
  `melee|thrown|firearm`, existing weapon parameters, `base_range_yards` for
  ranged profiles and no `initial_ammo` or other state fields. `mods.accept`
  returns `{usage, physical_basis, provenance: {mod, digest, job}}`; `_usage` on
  the effect is that entire accepted object.
- **Records.** Append-only `world.objects.usages` per instance. `physical_basis`
  binds definition digest and instance condition. Reuse is instance + usage name +
  basis, not an utterance hash. Skill, damage bonus, defence, range, ammunition
  and charges are live at resolve. Ownership, turn, ammo and charges do not
  invalidate the cache.
- **Admission and opening.** Opening apply may include `usage` only for pure
  registration. Usage and real object transfer with `playerText` pass through
  action-admission before prepare or apply. Pure adopt and same-owner state remain
  bookkeeping; NPC resolve remains exempt. Admission keys bind object, usage,
  definition and order while excluding private preview / accepted fields.
- **Resolve.** `action.object` is the instance; `action.weapon` is an alias;
  disagreement refuses. `action.usage` is required when more than one usage
  applies. Combat `weapon_id` is the usage id; rows carry `object_id` to the one
  resource pool. Projection, combat catalog and ammo write-back share that pool.
  Hit skill comes from the usage (or mapped legacy weapon) profile.
- **Transfers and receipts.** Thrown objects move only after real settlement,
  through `moveObject` and `objectTransferReceipt`, producing the existing
  `item-transferred` event. Pending defence, combat-start handoff and refused
  attacks do not transfer early; replay does not duplicate the transfer. This is
  the apply-object state / receipt implementation path, not a direct world write.
- **Compatibility.** Legacy `apply item.weapon` stays on the rules table. Old
  weapon definitions map to a default attack usage without regeneration. Old
  category may be read to map data and must not authorize execution.

## 27. Host runtime composition (runtime migration, issue #35)

### Current implementation decision: bounded assembly and one recipe (2026-09-14)

The assembler owns its heavy work directory, and the App packager owns its outer stage. Imported and direct-CLI assembly stop/settle their owned children and clean heavy work on success, exception, SIGINT, SIGTERM and SIGHUP, restoring owned read-only permissions first. SIGKILL/power-loss recovery is not claimed. A successful requested output remains; existing output is rejected untouched, and failed task-owned partial output is cleaned. Known text logs and diagnostic JSON are retained under a run-owned `.build.noindex` diagnostics directory outside disposable staging, capped at 256 KiB per file with truncation recorded, without archives, dependencies, binaries or bundles. `evidence` and the App receipt's `assemblyEvidence` point there; full workspaces are not retained on ordinary failure. An owned process group whose stop cannot be confirmed after bounded TERM/KILL waits instead reports `cleanupBlocked`; outer cleanup must not delete active paths or treat that inability as success. This is not a selectable retention mode. All `.coc` evidence remains outside cleanup ownership.

The root package manifest's existing `version` is the sole App version source; product identity does not acquire a second version field, and branch/extension versions are not substituted. The executable packager consumes an import-safe pure configuration recipe which behavior tests also execute. The obsolete `Electron/scripts/package-product.mjs` entry refuses before building, downloading, staging or spawning, pointing to `node pipicoc/package.mjs`; unrelated build/dev and lower-level vendored tooling remain. Applicable package safety checks migrate to the current recipe/lifecycle; obsolete PipiUI assertions are retired, not blanket-skipped. Failure-baseline changes are generated removals only. This decision does not authorize actual App installation, packaging or restart as a test.

Python source retirement (2026-09-09, user authorized): TypeScript is the only
runtime backend in source and packaged modes. Python runtime selection is rejected
explicitly. The former editable kernel and legacy Python graph tools leave the
active tree; developer comparisons use a pinned Git revision exported by the
test-only oracle helper. Ordinary RPC tests target the compiled TypeScript kernel.
The frozen oracle is a compatibility baseline, not another implementation to edit.
Python test drivers and the native-addon build toolchain remain developer-only.

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

Implementation decision for uncached setup guidance (2026-09-10): onboarding
retains the `HostRuntime` from the existing `coc:kernel-bridge` payload and calls
`prepareCharacterGuidance` with `contentRoot: runtime.contentRoot` plus its
optional `runner` as `request => runtime.runTask({kind: "reader", request},
request.signal)`. This is interface wiring only: it creates no new runtime or
provider and no bare completion; the author and independent reviewer remain
tool-enabled through the owner runtime, with cancellation and lifecycle owned by
that runtime. Cached or preaccepted guidance keeps the existing behavior.
Verification must include an uncached installed module, because bundled guidance
can hide the missing consumer; this is not a gameplay-quality proof.

### Implementation decision: behavior-preserving consolidation (2026-09-14)

This consolidation changes internal ownership, not RPC schemas, save formats or player behavior:

- Memory and NPC-journal lanes share the queue/lifecycle implementation, but each lane retains its own queue, model work, job protocol, retry/backfill budget and failure handling. Current-turn jobs precede backfill; open turns suppress backfill; shutdown never waits for model completion.
- Product identity has one authored source. Source and packaged consumers retain the same identity, icon resolution, profile location and explicit product overrides.
- Launchers share extension-mount construction, not their policies. The TUI, desktop Keeper and tool-enabled reader retain their separate flags, tool boundaries and startup behavior. No new generic launch framework is introduced.
- Kernel load call sites name their exceptional options instead of relying on positional booleans. Shared delivery formatting stays separate from state transitions: `ask` still enters `asked`, `narrate` still commits and advances the turn, and `resolve`/`apply` still leave it open. Replay, write ordering, commit rollback, marker placement and record fields remain unchanged.
- Near-identical participant queries may share one implementation; combat and chase engines remain separate. Shared helpers do not introduce new mutable state or a second authority.

Verification targets the production TypeScript RPC and host seams. Frozen oracle data and existing failure baselines are not relaxed to make the refactor pass. Gameplay acceptance remains the real-table method; deterministic tests are not a substitute.

### 27.2 Historical runtime selection design (superseded by Python retirement)

This subsection retains the migration-stage design, not the current launch instructions. The historical source command was `uv run --frozen python -m coc.rpc --workspace <dir> --content <dir>`; production no longer runs it. Current selection is TypeScript-only as stated at the start of §27.

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

`pipicoc.game.v1` accepts `instructions` (with its per-turn `brief`, §30.7), `checks`, `materializer`, `auditor`
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

Backfill was to use the existing on-demand deepen (§14.6, `focus: {npc: <name>}`)
for an actor the party had actually met. It is **withdrawn**: it writes a
contributed key into a shared, persistent module at play time, which is the very
disagreement between campaigns that 28.2 exists to prevent. A campaign whose
module was built without the word fills it at the table instead (28.7).

Disabling a package stops its instructions, its auditor and its future asks. It
does not stop the word. A module records the vocabulary it was read under, and the
read side takes the word from that provenance rather than from a campaign's locks —
the graph carries the book's own material under it, and hiding that would leave the
book less readable than it was before the package was installed. No Mod may
overwrite authored source, and none may retract it either.

A module keeps the union of every key it was ever asked for, so a key extracted
under a package that has since been removed still reaches the table. Two packages
claiming one key are settled by load order: the first keeps it, the rest are
recorded as displaced. A collision is never allowed to fail an unrelated book's
build, and never resolved silently.

### 28.6 A package can see whether its own word reached the table

Because vocabulary binds at build and packages are enabled per campaign, a package
can be active while its key is absent from every actor -- and that absence is the
same shape as a book that does not say. A package that cannot tell the two apart
reads the second as the first: Natural NPC would conclude that nobody at this table
speaks another tongue, off a book that was never asked the question.

`mods.context` therefore carries `vocabulary` whenever any word is in play, both in
the turn capsule's `mods` section and from the RPC directly:

```
"vocabulary": {"words": [{"key": "language", "label": "speaks",
                          "mod": "natural-npc", "bound": true}],
               "authority": "A bound word was asked of this book: ..."}
```

`bound` is read from the module's own provenance, never from the campaign's locks,
so a key whose package has since been removed is reported `bound: true` with `mod:
null` -- the word still reaches the table (28.5) and the Keeper still sees it in the
dossier. The field is omitted entirely when no active package contributes a word and
the module records none, so an ordinary table pays nothing for it.

### 28.7 `graph.vocabulary.table.v1` -- door 4, opened for contributed words

Binding at build made the feature safe and left it inert. No shipped book names
anyone's tongue: The Haunting gives its eleven actors the five core keys and
nothing else, and the only `language` in that graph is on a handout, which the
document reader already gates with `language_skill`. A package that could only
read `speaks` off the source could only ever read nothing.

Backfill (28.5) is withdrawn rather than built. Re-reading a book on demand to
fill a contributed key writes into a module -- shared by every campaign compiled
from it, and persistent. That is the boundary 28.2 rests on: two campaigns cannot
disagree about what their reader was asked. Backfill makes them disagree over
time, decided by whichever campaign happens to play first, and the mutation stays
after the package is gone.

Door 4 is therefore opened, narrowly. A package requiring
`graph.vocabulary.table.v1` (which requires `graph.vocabulary.v1`, and is refused
without a contribution to write) may establish, at the table, a value for a word
it contributes:

```
apply {"kind": "dossier", "name": "<actor>",
       "values": {"language": "<what the table established>"},
       "why": "<what in the fiction settled it>"}
```

The write lands in `world.mods.state[<id>].dossier[<node_id>][<key>]`, and the
per-turn dossier reads it only where the source is silent and only while that
package is enabled. Three properties follow, and they are the point:

* **The book is never written to.** A key the source gives is refused, not
  overwritten -- one actor, one answer, and the authored one.
* **The word dies with the package.** Disabling stops the read; the graph is
  exactly as it was found. This is the opposite of 28.5's rule for *build-bound*
  words, and deliberately so: a word the reader extracted is the book's own
  material, a word the table established is the package's.
* **It is campaign-scoped.** `world.mods.state` survives worldlines and upgrades
  and never leaves the campaign that wrote it.

Establishing is a Keeper judgement in fiction, never a derivation. No list maps
names, trades or places to languages, and the instructions forbid inferring one.

### 28.8 Out of this version

Call-named check values (door 3) are named here so they are not reinvented, and
are not built in this version.

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
  - 另一活进程持战役锁时报 `internal`，`details.reason` 为 `campaign_locked`（共享 `guardCampaign` 的唯一口径，Python 对照在 `tests/kernel/test_campaign_lock.py` 钉死；宿主在展示层用 `operation_in_progress` 的玩家词渲染它，见 29.3）。
  - `name` 缺省铸 `if-<forkturn>-<k>`（k 是该分叉回合上的序号）；显式 `name` 须合世界线名语法且不与现有线撞，撞名报 `invalid_params`。
- 执行复用 §15.9 的迁移机器：必要时 seal 当前线 → 在 `commit` 上建 `wl/<name>` → 注册表加 `{"name", "kind": "if", "loop": 0, "forked_from": {"line", "turn", "commit"}, "seed": "sha256(\"<campaign>:<name>:<commit>\") 前 16 位", "status": "active", "last_turn", "last_commit", "created_at"}`，原活动线转 `dormant` → 检出 → 注册表覆盖写回 → 按新线种子与下一回合号重播 rng → 从分叉点的回合记录重建检查点。失败即回滚（检出回源线、删掉刚建的分支、注册表写回原样），遥测一行 `lane: worldline, op: branch, ok: false`。
- 事件 `worldline-forked` 落在**新线**上，`turn` 取新线接下来要打的回合，`data.from` 指出从哪条线哪一回合来——与 §15.9 同一条规则。
- 幂等：同 `(campaign, commit, name)` 重放返回同一形状：线已存在且 `forked_from.commit` 相同就不重复建线，只确保活动线是它（第一次调用的效果包含 `active = name`，重放把这一点补齐）。
- result：`{"ok": true, "line": {"name", "kind": "if", "loop": 0, "forked_from": {...}}, "active": "<name>", "branched_from": {"line", "turn", "commit"}}`。
- 换线通知：分支成功后下一次 `player_input` 的胶囊带一次性 `branched` 节 `{"name", "from_line", "from_turn"}`（内核置旗、胶囊读后清）；`worldlines` 节照常反映新线。宿主在会话里追加分水岭展示条目（§23 的 `coc-mechanics` 通道，投影 `{"kind": "worldline", "operation": "fork", "line", "from_line", "from_turn"}`），玩家由此在聊天流里看见分界。

### 29.3 内核的决定

**2026-09-09 conversation navigation revision.** A graph click navigates to its recorded
delivery; it never forks or opens a confirmation. Completed deliveries expose Copy and
Create branch. The host creates a child Pi session from the selected delivery's transcript
prefix, binds it to the new worldline, and selects it. The source transcript remains intact.
Session headers carry `cocWorldline: {campaign, line, parentSessionId?}`; this is navigation
metadata, never world-state authority. Old mixed-line sessions remain readable.

`table.switch {campaign, line}` is a host-only idle-table operation. It refuses unknown or
merged lines and open turns, seals the source, checks out the target, preserves the complete
registry, reseeds RNG and rebuilds the target checkpoint. It returns `{ok, active}` and rolls
back checkout/registry on failure. The Keeper's seven verbs do not change. The host closes
idle campaign writers before switching and refuses while any is working. Before starting a
bound conversation it ensures that conversation's worldline is active.

`timeline.graph` adds host-only `sessions` and `anchors` (commit, messageId, sessionId).
Anchors come from durable commit events or legacy successful narrate results, never ordinal
message counting. `timeline.navigate {commit}` selects the recorded conversation and scrolls
to that delivery, loading older history as needed; unavailable history returns an error.
`timeline.branch {messageId}` resolves the commit on the host, branches and returns the child
session. `timeline.select` activates the worldline bound to the requested session. These
routes use the existing extension transport. No hashes are typed by a model.
After a Keeper-driven worldline change settles, `timeline.follow {previousLine}` binds or
selects the corresponding conversation through that same host path; it creates no worldline
and never interrupts a running turn. This keeps model-driven and button-driven forks aligned.

The sidebar nests child conversations below their parents. The relationship panel keeps the
game-time axis, uses sparse time-range captions, visible line names and compact delivery
summaries. Equal game times still align; exact timestamps remain in node details. Chrome
uses the existing English source/presenter pipeline with no authored translation tables.

**`table.graph` 的实现面。** `kernel-ts/read/graph.ts` 一个模块装下：战役经 `CampaignSnapshot.open(ctx, id, requireWorld=false, requireTurn=false)` 打开（setting_up 的战役也读得了，不碰桌态）。`at` 取 committer 时间（`%cI`），节点按它降序——`when` 已经是游戏内日历，「更早的历史省略」是提交时间语义。`clock` 用一次 `git cat-file --batch` 给截断后留下的每个节点读 `<sha>:world.json` 的 `clock.minutes`（每节点一次的 `git show` 不允许；读不到的继承父节点，根为 0），`when` 走 `clockSection` 投影机（模组没声明 `start_clock.local_datetime` 时为 null）。枚举全图 = 一次 `for-each-ref refs/heads/wl/` + 一次 `git log --format`，每次调用 3 个 git 进程。`kind` 按契约顺序机械判；`title` 对回合节点剥 `turn N:` 前缀；sha 用短形与注册表一致。`max_nodes` 缺省 500、超 1000 收 1000、非整数或 <1 报 `invalid_params`；截断后把缺的线 tip 补回。`generate_reference.py` 学了 TS-only 方法名单（词汇锁证据可重生成）。

**`table.branch` 的实现面。** `kernel-ts/worldline/branch.ts` 驱动 §15.9 原语（`worldline/history.ts` 的 checkout/createBranch/deleteBranch/commitIfDirty/head/lineCommit），回滚形状与 `transition` 同款；`forkPlan` 本身用不了（它要开着的回合与图），所以是原语级复用，这是对「复用迁移机器」的正确读法。复审修复后：回放切线路径包同款回滚（强制检出回源线 + 写回 campaign.json + `ok: false` 遥测），且回放切线也置 `pending_branch`（回放切线仍是玩家视角的开线成功，守秘人必须听到）；seal 与 `before` 快照进 try，失败遥测一律有。分叉点回合记录的 `commit` 可以是 null（回合记录从下一次提交起才带 sha），检查点断言只钉 worldline 与 turn。胶囊旗标生命周期：`pending_branch` 随注册表重写写入，下一次 `player_input` 里鲜读→删→写，不会复活。

**锁码的决定（2026-09-09）。** §29.2 原写「锁占用报 `operation_in_progress`」。实现证明 handler 内 remap 不可能：`guardCampaign` 在 handler 之前拿锁，flock 按 open-file-description 计，handler 探不到竞争；而共享 guard 的 `internal` + `details.reason="campaign_locked"` 被 Python 对照（`tests/kernel/test_campaign_lock.py`）钉死，只改 TS 一侧会让两棵树在兼容性边界上分叉。定：契约接受 guard 的形状（§29.2 已改）；宿主在展示层把 `internal`+`reason:campaign_locked` 渲染成 `errors.operation_in_progress` 的玩家词（§23 的词表机制，线上代码不动）；两棵内核树都不动。

### 26.1 An audit that cannot finish does not hold the delivery (2026-09-10)

A Mod audit is a gate before publication, and that is the point: the player never sees a
delivery whose consequences the package found incomplete. What was not decided is what a
gate does when it cannot reach a verdict.

It refused, with `mod_agent_failed`. The Keeper read the refusal as "this delivery is
wrong", rewrote nothing it could find to rewrite, and retried the same narration; each
retry started the audit again and spent another deadline. One real turn spent three of
them -- about ten minutes -- on words that had been written in the first thirty seconds,
and the player saw none of it. A gate that cannot decide had failed closed onto the one
thing it was never judging.

An audit that times out now lets the delivery through and records that the turn was not
audited. A gate that reaches a verdict still gates: findings refuse exactly as before,
and the Keeper repairs before the player sees anything. Only the undecided case changes,
because the alternative to an unaudited delivery is not an audited one -- it is a lost
turn. The record is evidence, not a silence: the turn carries which package's audit did
not finish and how long it was given, so a package whose audit never finishes is visible
as that rather than as a table that plays slowly.

An audit that fails for any other reason still refuses. Only a deadline is treated this
way, because only a deadline says nothing about the delivery.

## 30. Director and narration packages: `context.thread.v1`, `context.pacing.v1` and four built-in Mods (2026-09-10)

The 0.8.2a Director and text layers were surveyed on 2026-09-10 (report delivered to the user). Their arithmetic
(§13.3) and their vocabulary (§13.6) were already here; what was not here is carried by four packages under
`mods/`, on the `pipicoc.game.v1` interface of §26, and by two new read-side capabilities. Nothing below adds a
write side, a fact about the world, a scoring number outside the graphs, or a reader of prose.

### 30.1 `context.thread.v1`: the story thread

A package requiring it makes the capsule's `mods` section (and `mods.context`) carry `thread`, the 0.8.2a
`story_thread` idea re-expressed as a pure projection of the module graph and the world: what each authored
conclusion still needs, organised by where the story can go rather than by where the party stands. The 0.8.2a
record of why is kept in the package: four flat lists organised by place changed nothing at a live table; one
chain organised by need changed the first turn.

```
"thread": {"lines": [{"name": "<conclusion handle>", "needs": "<the conclusion's own description, ≤110 chars>",
                      "importance": "critical"|"core"|"major"|"supporting"|"minor"|"unknown",
                      "missing": n, "of": m, "minimum_routes"?: k,
                      "here":   [{"clue", "gate": <§13.3 clueGate>, "line"?: "<the book's delivery words>"}]   (≤5),
                      "next":   [{"scene", "clues": j, "line"?: "<the book's delivery words>", "locked"?: "<condition>", "via"?: "back"}]  (≤4, most clues first),
                      "handed"?: [{"clue", "by": "obvious" | "<present NPC>"}]   (≤4),
                      "beyond": r,
                      "fallback"?: "<the conclusion's fallback_policy, only when here and next are both empty>"}]   (≤6, critical first, then fewest missing),
           "handed"?: "<one fixed sentence: the book means these clues to happen; not routes, not choices; timing is the Keeper's>",
           "truncated"?: true}
```

- A line exists for a conclusion with at least one `supports` clue and at least one of them undiscovered (the same
  reading as §13.3 `main_line_complete`). `here` is `sceneClueIds` of the active scene; `next` walks the scene's
  exits (§6 `where.exits`) and the way back (`scene_trail`), one entry per scene that holds an undiscovered clue of
  that line, a clue counted at the first scene that holds it; `beyond` is the remainder. `locked` is the exit's
  `unlock_when` condition when it is not known to be met; `via: back` marks a scene reached only by the trail.
- A row's `gate` keeps the existing one-string shape: `<delivery kind>: <check>`, followed by existing unlock
  conditions after semicolons. The check half is a projection, not source-prose parsing: a matching conclusion
  clue entry with a nonempty authored `skill` still renders that skill and its existing difficulty; a
  `delivery_kind` of `skill_check` with no named projected skill renders exactly
  `check required (skill unspecified)`; every other case with no projected named check renders exactly
  `check unspecified`. A missing
  key, absent matching conclusion, explicit `null` or empty skill is not evidence of a no-roll instruction. The
  kernel does not parse source prose to decide free or required checks; explicit no-roll instructions in existing
  source/rule material and the handed-clue contract remain authoritative to the Keeper. `check unspecified`
  instructs neither skipping a genuine risk nor inventing a roll: use current intent, existing known rule/source
  detail, and source lookup only when necessary. Ordinary uncontested actions and plainly given clues should not
  acquire a new check merely because this field is unspecified.
- `handed` is structural: an undiscovered clue here whose `delivery_kind` is `obvious`, or `npc_dialogue` with one of
  its `source_npc_ids` on stage. No semantic judgement chooses it.
- **Budget 3072 bytes**, because the `mods` section has none of its own. Over budget, the least important lines
  without clues here lose their words first (`needs`, `line`, `fallback`), then go, then the rest lose their words,
  then the last lines go; a line with clues in this scene is the actionable part and goes last. `truncated` says so.
- Implementation `kernel-ts/read/thread.ts`; wired in `modContext` only while an active package requires the
  capability, so a table without the package pays no bytes.

### 30.2 `context.pacing.v1`: close calls and threat clocks

```
"pacing": {"close_calls": {"count": n, "threshold": 3, "rule": "<one line naming p.209 and the counting rule>"},
           "threat_clocks": [{"threat", "clock", "state": "x/y", "symptom"?: "<on_tick_visible at the current segment>", "on_full"?}]}
```

- `close_calls.count` is the number of closed, played turns (§13.10's reading: player text present) in which an
  investigator took a blow of at least half their maximum hit points (Keeper Rulebook p.119, a major wound) or was
  taken to zero or below; each turn counts once. The threshold 3 is the fair-warning ladder of p.209, one of the
  four rule-derived values the 0.8.2a ledger could name. A party sheet without a maximum counts only drops to zero.
- `threat_clocks` uses the same relatedness as §13.2 `pressures.threat` (`relatedThreats` in
  `kernel-ts/read/pressures.ts`, extracted so the two cannot drift) and adds what §13.2 never projected: the
  clock's visible symptom at its current segment, taken from the threat record's `on_tick_visible`. A scenario-wide
  clock is still not shown in a scene the book does not connect it to; that rule is the relatedness itself.
- Implementation `kernel-ts/read/pacing.ts`. `modContext` takes the campaign's closed records as a fifth argument;
  `table.capsule`/`player_input` (`assemble.ts`) and `mods.context` pass them.

### 30.3 The four packages

| id | requires | contributes | what it carries |
| --- | --- | --- | --- |
| `story-thread` | `context.thread.v1` | `instructions`, `brief` | how to read and use `thread`: land `here` with `apply clue`, put `next` in reach through the fiction and never as a menu, `handed` is not a choice, `fallback` is for a line with nothing reachable; from 1.0.2 the lines are opportunities, not a per-turn plan; from 1.0.4 the gate check half is a named check, `check required (skill unspecified)` or `check unspecified`, and unknown is contextual rather than a blanket no-roll or automatic extra roll/source request (§30.12) |
| `keeper-pacing` | `context.pacing.v1` | `instructions`, `brief`, setting `stall_turns` (1–6, default 2) | fair warning below the threshold and none at it; clock symptoms shown only here and when to tick a clock (§30.9); from 1.1.1 the stalled counter is advisory, stuck versus lingering are read from the player's expressed meaning and context rather than brevity alone (§30.11), the recovery order world → NPC → information for a stuck player with the 0.8.2a `must_not`s kept (no repeated low-agency ask, no restating, no irreversible choice, no skipped gated risk), the Idea roll as the rulebook has it, clarification free; the blanket "a recovery always costs time, exposure or alarm" is retired (§30.12) |
| `narration-craft` | none | `instructions`, `brief`; no settings from 1.1.0 | NPC voice (news, refusals, a public failed check with a person present), crisis ordering without a handle clause, the scene-opening perception as an offer, Laws' beat words and the humour knobs, the world-assertion cost ladder, material selection from the live exchange and the dossier, friendly and cooperative outcomes, one detail serving several purposes, plain telling allowed; the 0.8.2a length ladder (eight, then four integer settings in 1.0.0–1.0.2), the own-paragraph rule, the handle before stopping and the open question are retired (§30.12) |
| `narration-audit` | `agents.tools.v1` | `auditor` (no `audit_on_decisions`: every audited delivery) | for each receipt of the turn, the narration must realise its fictional consequence; a finding is `{reason: "<receipt id>: …", fix: "<consequence>"}`; numbers, style, length and language are explicitly outside its remit; keeper-visibility rolls need no beat |

All four are `default_enabled: true`; the panel switches any of them per campaign or by default (§26). `narration-audit`
is a separate package on purpose: it is a gate (a finding refuses the delivery as `mod_narrative_repair`, §26) and
sits one model judgement away from the number check §16.3 retired for good, so a table can turn the gate off and
keep the craft. Its prompt forbids asking for a figure, a grade, elapsed minutes or an option list.

### 30.4 What stays out, and why

- Storylets (77 nodes, Chinese `cue`/`beat`/`variants`, 0 calls at the 0.8.2a live table), the storylet multipliers,
  `conflict-level`, `affinity-ladder`: left in `content/director/director-graph.json` unread, as §13.10 says.
- The 0.8.2a coverage-row protocol (nine fields per obligation, verbatim excerpt binding): a protocol the Keeper
  would have to learn; the seven verbs are the point. `narration-audit` keeps the obligation and drops the protocol.
- Regex or phrase-table prose matchers and the joke library: the 0.8.2a status documents record them rewriting Keeper
  sentences and never firing; Agents.md forbids them.
- A reader contribution from a package (§28.2 door 2 stays closed). The reader ask itself
  (`content/setup/visual-reader.md`) now names the scene pacing fields and the `beat` node, because a book the
  reader built carried none of them: on 2026-09-10 both PDF-built modules had 0 `dramatic_question`, 0
  `pressure_moves`, 0 `exit_conditions`, 0 `beat`, 0 `quest` against 12/12/2/12/3 for the hand-written starter, so
  §13.3's `dramatic_question`, `exit_condition_met` and `yielded-scene`, §13.2's `quest` and `threat` and this
  section's `next`/`locked` were dead for every imported book. That is the same trap the 0.8.2a Director spec
  recorded ("the sample selected the conclusion"). The reader ask is one bullet; it is not verified by a rebuild
  in this slice.

### 30.5 Acceptance

- `tests/kernel/test_mod_director_text.py`: the thread is ordered critical first, names the opening scene's clues
  with their gates and the present speaker who hands them, moves a discovered clue out, fits 3072 bytes, and both
  sections vanish when their packages are off; `narration-audit` joins the shared audit job and leaves it when
  disabled; a major-wound blow counts one close call. `tests/extension/ts-kernel-pacing.test.mjs` pins the
  close-call counting rule on synthetic records. `tests/kernel/test_mod_order.py` and the Electron catalogue test
  now list seven built-in packages.
- The real-table method of Agents.md is the acceptance; the fixtures above are not evidence of play.

### 30.6 What the first real table showed (2026-09-10, `mods-live-1`, The Haunting, zh-Hans, grok-4.6 low as Keeper)

Seven played turns plus the opening, evidence under the worktree's `.coc/playtests/mods-live-1/` and
`.coc/campaigns/mods-live-1/turns/`. Not a full acceptance run: it stopped in the upstairs bedroom after the bed
attack, before any close call and before the basement.

- **The thread was used from the first turn.** Turn 1 landed the `handed` clue (`knott-macario-summary`); turn 2,
  to a directionless player ("一时没想好该从哪儿下手"), the Keeper put every `next` scene in Knott's mouth as
  directions and landed the three remaining `here` clues (keys, commission, research leads) in one `apply`; turn 4
  at the morgue landed the three clues the line named there; turn 7 in the bedroom landed the two it named. Every
  `director_adoption` from turn 1 to 7 is `adopted: true`. The 0.8.2a judgement that a chain changes behaviour where
  flat lists did not is consistent with this, on one table.
- **`narration-audit` produced no false positive** across eight audited drafts (findings `[]` each time). The two
  refusals in the run were Enhanced Items' `missing` equipment adoptions, not this package. It has not yet been seen
  to catch a real omission; that is still to be shown.
- **The `mods` section is the heaviest part of the capsule now**: turn 6 capsule 32,976 bytes, of which `mods`
  22,048: `instructions` 11,970 (Enhanced Items 4,802; the four packages here 7,076 together), `objects` 6,074,
  `thread` 2,982. Every package's instruction text is re-sent every turn (§26 shape). A budget for `mods`, or a
  first-turn-only long form with a per-turn short form as `style` already does (§13.6), is the next contract
  decision; nothing here changes it.
- **`threat_clocks` stayed empty in the haunted house.** Both starter threat records have `scope: scenario`, no
  scene reference of any kind, no `current_segments`, and no product path advances a threat clock. Relatedness (§13.2)
  is therefore unsatisfiable on the starters until the threat's danger is on stage as an NPC. This is the data and
  the missing writer, not the projection; the 0.8.2a refusal to show a scenario-wide clock everywhere is kept on
  purpose. `close_calls` stayed 0 (the bed did 2 of 12).
- Seams seen that belong to other tickets: social `resolve` refused four times for a missing `skill` (turn 1);
  `needs_choice` re-sent unchanged three times (turn 7, the Director-grounded narrowing offered 2 candidates and the
  Keeper chose neither); one turn took 342 s (turn 6, the first read of the upstairs scene); an English token
  (`thrift`) appeared inside zh-Hans prose at turn 2, a model defect the verifier lane is meant to flag, and the
  audit rightly did not.

### 30.7 `contributes.brief`: the first turn long, the turns after short (2026-09-10 user decision)

**Approved 2026-09-15 amendment (implementation/integration pending):** the ordinary first-turn
lifecycle below is retained, but host-only `table.capsule {rehydrate:true}` also forces `full` using
these same builders without consuming the first-turn marker. See the capsule amendment and §19.2.
The recorded measurements below concern the original full/brief switch, not new rehydration acceptance.

§30.6 measured the cost: every package's `instructions` re-sent every turn, 12KB of a 33KB capsule. The user's
decision is the §13.6 pattern. A package may add `"brief": "<file>.md"` beside `instructions` (a `brief` without
`instructions` is refused at install). The capsule's `mods.instructions[]` rows gain `form`:

- **`full`** on the first turn this process opens for the campaign, and on every `table.capsule` before it: the
  same `styleFull` condition as §13.6 and the `module` brief, threaded into `modContext` as its `full` argument.
  A package without a `brief` is `full` on every turn (third-party packages keep their behaviour).
- **`brief`** afterwards: the reminder file's text.
- `mods.context` (host-facing) is always `full`; the setup context (`setup_instructions`) is unchanged.

All five built-in packages with instructions carry a brief and bump their version, because a package's bytes are
its version (§26, `freeze`): Enhanced Items 1.1.6, Natural NPC 1.1.1 (both merged over the same day's 1.1.5 and 1.1.0), Story Thread /
Keeper Pacing / Narration Craft 1.0.1. A campaign locked to an earlier version keeps the full text every turn until it upgrades. On a fresh
The Haunting the five briefs together are under 4KB against 12KB of full text; the test
`test_instructions_are_full_on_the_first_turn_and_brief_after` pins the switch, the ceiling and the host context.

Live check `mods-live-3` (fresh The Haunting, same Keeper model, two played turns after the opening): turn 1 capsule
31,975 bytes with `instructions` 12,050 (all five `full`); turn 2 capsule 22,994 with `instructions` 3,865 (all five
`brief`: Enhanced Items 1,008, Keeper Pacing 581, Narration Craft 638, Natural NPC 557, Story Thread 404). Turn 2
still landed the three clues the thread named and moved to the morgue.

### 30.8 What is verified and what is not (2026-09-10, merged tree)

§30.6 was measured before the merge with 0.9.2a's own Mod work. `merged-1` (The Haunting, zh-Hans, grok-4.6 low
as Keeper, eleven played turns from Knott's office into the basement confrontation, evidence in
`.coc/playtests/merged-1/` and `.coc/campaigns/merged-1/`) is the first table on the merged tree, and it was
driven deliberately at the paths §30.6 never reached.

**Verified at a real table**

- **The thread routes play.** Turn 2 asked for the basement; the exit was gated on `corbitt-diaries`, which the
  thread listed under `here` for `corbitt-is-undead-sorcerer`; the Keeper offered the cupboard, turn 3 took the
  diaries, turn 4 walked down. Every turn 1–11 recorded `director_adoption.adopted: true`.
- **`close_calls` counts what p.209 counts.** Turn 9's claw took HP 12 → 5, seven points against a maximum of
  twelve, and turn 10's capsule carried `close_calls.count: 1`. Zero before it, through eight turns of play.
- **`threat_clocks` populate exactly when the relatedness of §13.2 is satisfied.** Empty for six turns in the
  haunted house, and populated the turn Walter Corbitt stood on stage (`corbitt-awareness 0/4`,
  `landlord-impatience 0/3`), matched through the danger's `monster_ref`, not through the scene.
- **The audit gate can fire, and its fixes ask for fiction.** A seeded probe (`probes/` beside the run, a probe
  and not a playtest) put two drafts against the same three settled receipts of one open turn. The draft that
  omitted the fall came back with one finding per receipt, each naming its receipt id and asking for a
  perceptible consequence; the draft that told it came back empty. Across the fifteen audited deliveries of
  §30.6 and this run the lane produced no false positive.

**Not verified, and what it would take**

- **`threat_clocks` never showed a `symptom`.** Both starter clocks stayed at segment 0 because no product path
  advances a threat clock: §30.4's writer gap, unchanged, and the reason `on_tick_visible` has still never
  reached a table.
- **`keeper-pacing`'s compression never fired.** `stalled_turns` never reached the package's `stall_turns` in
  eighteen played turns across two runs; the player kept moving. It needs a table that deliberately stalls.
- **Fair warning was never observed changing an outcome.** The counter reached 1 of 3; nothing was seen at the
  threshold, which is where the doctrine actually bites.
- **`narration-craft`'s length budget is inert, and its paragraph caps are wrong.** Twenty deliveries across
  three campaigns: 52–430 characters against ceilings of 600–1500, so the character budget never binds; 1–9
  paragraphs against caps of 3–8, exceeded in eight of eleven measured deliveries. This Keeper writes short
  paragraphs, many of them. The figures came from the 0.8.2a T5 retune, whose complaint was a Keeper hugging a
  350-character floor; that is not this Keeper's failure mode. The honest reading is that the paragraph cap does
  not describe how prose is written here and the character ceiling is not reached, so neither number is doing
  work. Retuning them is a content decision and is not taken here.
- **The reader ask of §30.4 is still unverified**: no book has been rebuilt with it.

### 30.9 `apply threat`: the clock the Keeper runs (2026-09-10)

§30.8 measured the hole: `pressures.threat` and `pacing.threat_clocks` projected a segment that nothing could
move, so both stood at the book's starting value forever and `on_tick_visible` — written by the module authors
for exactly this — had never reached a table. A projection without a writer is half a feature.

`apply` gains a nineteenth kind. `{"kind": "threat", "name": "<threat>", "clock"?: "<clock>", "segments"?: n,
"why"?: "..."}` moves one threat clock. `name` is the handle `pressures` and `pacing.threat_clocks` already give;
`clock` may be omitted when the threat has exactly one; `segments` defaults to `+1` and accepts a small negative
number to give ground back. Refusals name what they could not find: an unknown threat lists the module's threats,
an unnamed clock on a multi-clock threat lists its clocks, a threat the book gave no clock says so and points at
the fiction instead. A refused batch writes nothing, as every `apply` batch does.

- **The count is runtime, never the graph.** `world.threat_clocks` is `{"<threat>": {"<clock>": n}}`, clamped to
  `[0, segments]`; the module graph stays the authored source and is not rewritten. A clock with no live entry
  reads the book's `current_segments`, so a campaign that predates this effect is unchanged.
- **The receipt hands back what the book says.** `{before, after, segments, full}` plus `shows` — the
  `on_tick_visible` entry for the segment it now stands on — and, when it fills, `on_full`. Visibility is
  `keeper`: this is pacing, and `mechanicsOf` projects no card for it, so nothing is drawn for the player. The
  symptom reaches them as fiction or not at all.
- **No canonical event.** §12.1's set is closed at twenty-four kinds and a pacing tick did not enter it; the
  receipt and the turn record carry it, the same way the sanity engine's own `day_ended` is recorded without
  being a canonical event.
- **Who decides.** The Keeper, and only the Keeper: no rule ticks it, no Director scores it, `apply time` does
  not imply it. That is the standing reading of the module as a reference and the clock as the Keeper's pacing
  instrument. `keeper-pacing` 1.0.2 says when to reach for it — real time spent, noise, exposure, or the danger's
  own interest advancing — and says plainly that it is not a per-turn metronome.

`narration-craft` 1.0.2 drops its paragraph caps in the same change, on the §30.8 measurement: exceeded in eight
of eleven deliveries while the character ceiling was never approached. The character ceilings stay and are named
as ceilings, not targets.

### 30.10 A verb nobody reaches for is the panel problem again (2026-09-10)

`apply threat` was implemented, unit-tested, named in `keeper-pacing` 1.0.2 with the occasions to use it, and
visible in the tool schema. `verify-1` then played twelve turns — the whole house, a fight, a chase, an
investigator at zero hit points — with both clocks in the capsule the entire time, and **the Keeper never called
it once**. That is the 0.8.2a finding again, in a different costume: a capability that must be remembered is not
reached for, and the answer is never to add an obligation.

Two changes, both lowering the cost of using it rather than raising the duty to:

- Each `pacing.threat_clocks` row carries `next`, the `on_tick_visible` entry one segment on (absent on a full
  clock). The row now says what advancing it would put on the table, so a tick is an offer with something in it
  rather than bookkeeping to remember.
- `prompts/keeper.md`'s own list of what `apply` lands names `threat`. The tool description had it; the Keeper's
  prose summary of its own verbs did not.

`verify-2`, ten turns on the same route: the Keeper called `apply threat` on **the first turn a clock was
visible** (`why: 入侵者闯入藏处并触碰其身`), the receipt handed back `shows`, and the next turn's capsule carried
`corbitt-awareness 1/4` with that symptom. One run before and one after is evidence, not proof, but the change is
the difference between never and immediately.

Two things this did not settle, both honest limits rather than defects to fix here:

- **The symptom did not reach the prose.** The Keeper ticked during a knife fight and wrote the fight; a knock
  inside the walls is a poor sentence in that round. Whether a segment's symptom is worth writing is the Keeper's
  call, and nothing gates it — the same standing as every other capsule suggestion.
- **Relatedness is per threat, not per clock — fixed by separating the two lists.** The Haunting hangs
  `landlord-impatience` — Knott losing patience with the investigation — off the same front as Corbitt, so
  §13.2's relatedness hid it through the whole research phase it paces and showed it in the knife fight it has
  nothing to do with. The clock-level scene references that would resolve it per clock are not in the data, but
  the two lists answer different questions and only one of them is about here: `pressures.threat` is what presses
  in this scene and keeps the relatedness rule exactly as it was, while `pacing.threat_clocks` is the Keeper's
  instrument panel, and a front the book itself declares `scope: "scenario"` runs everywhere in that scenario.
  Scenario-scoped clocks are therefore on the panel from the first turn; every other threat still has to be
  related. A campaign whose module scopes its fronts to places is unchanged.

### 30.11 Compression, and where the panel's clocks now stand (2026-09-10)

`stall-1`, a table played by a player who genuinely does not know what to do ("嗯", "我再想想", "我不知道该先干嘛"),
closes the last doctrine §30.8 left untested. Evidence in `.coc/playtests/stall-1/`.

- **Compression fires at the threshold and cuts.** `stalled_turns` reached `keeper-pacing`'s `stall_turns` of two
  on turn 4; the Director's beat turned RECOVER; the Keeper did not ask the same low-agency question again but
  had Knott take the investigator by the elbow and put them on the street, landing a `move`. The turns after it
  keep offering concrete handles in the fiction — a newsboy with the afternoon edition, the reading room up the
  steps, a cab at the kerb — instead of restating the same state, which is the clause the 0.8.2a compression
  contract was written for. What was not exercised is the montage form: those turns landed no `time`, so
  "advance until something interrupts" is still only half seen.
- **Scenario-scoped clocks are on the panel from turn one**, as §30.10 now specifies, so a Keeper running The
  Haunting sees the landlord's patience during the research it paces rather than only in the basement.

The two things still unverified after all of this are the fair-warning threshold — no table has reached three
close calls — and the reader ask of §30.4, which needs a book rebuilt with it.

**Stuck and lingering read the same on the counter (2026-09-10, #68).** `stalled_turns` counts consecutive
played turns with no `clue`, `move` or `session` receipt (`kernel-ts/read/director.ts`), so a player who talks to
an NPC for two turns by choice and a player who does not know what to do both reach `stall_turns`. The counter
cannot tell them apart; the Keeper can, from the player's own words, and that is the reading `keeper-pacing`
1.1.0 asks for: a player asking what to do gets the recovery order, exactly as `stall-1` went; a player talking,
reflecting or asking about the scene is playing and is not compressed. The `stall-1` verdict above stands for
its case.

**Brevity is not confusion (2026-09-10, pacing repair).** `stalled_turns` remains advisory. A concise but clear
choice, yes/no answer, quiet conversation, lingering or reflection is play when the player's intent, content and
context are clear. Recovery is for expressed confusion, explicit help-seeking, repeated low-agency action or an
exhausted scene that needs a cut or montage; short wording alone is not the signal, and no clue or pressure is
added just to answer a brief reply.

### 30.12 Keeper narrative quality: one owner per rule, the volume rules retired, settings that survive an upgrade (2026-09-10, #68)

The spec `docs/specs/keeper-narrative-quality.md` (#68, tickets #69–#79 in
`docs/specs/keeper-narrative-quality-tickets.md`) starts from a turn a novice could not answer: Masks of
Nyarlathotep, record 17 of the latency run, where the Keeper wrote short, textured sentences and stopped on a
camera that would not fire. The survey behind it read that turn's own capsule and the packages active on that
table; this section is the contract the tickets implement.

**What that turn had and lacked.** The capsule carried the full scene summary (the feeders at the crack, the
charnel pit, two assets, two endings) and complete dossiers for Larkin and de Mendoza; `dramatic_question`,
`pressure_moves`, `exits`, `affordances` and `keeper_notes` were empty, the §30.4 reader gap of an imported
book; the prose used the scene texture and the NPC manner and failed at the handoff; the verifier recorded three
`uncommitted_state` findings for NPC movement narrated without `apply`. The only gameplay package on that table
was `natural-npc` 1.0.0: the App build (`62039c9f`) predates the four packages of §30.3, so the screenshot
indicts the base style of §13.6, not them. Three layers, three diagnoses, kept apart.

**The layer map: each rule has one owner.**

- *Base, every table, Mods on or off.* `prompts/keeper.md` owns the laws and the definition of a playable turn
  (below). The capsule `style` owns readability: the six axes `avoid-translationese` (zh-Hans),
  `avoid-ai-summary-voice`, `avoid-log-style-summary`, `avoid-semantic-repetition` (its line now allows the
  callback placed on purpose), `avoid-abstract-psychological-explanation`, `prefer-observable-behavior` (its line:
  observable behaviour over asserted inner states); and the eleven directives `player-action-uptake`,
  `action-uptake-review`, `repetition-policy`, `observable-before-interpretation`,
  `skill-interpretation-after-visible-evidence`, `rewrite-abstract-psychological-explanation`,
  `rewrite-abstract-explanation-to-action`, `rewrite-ai-summary-voice`, `rewrite-passive-translation-ese`,
  `rewrite-camera-direction-staging`, `final-prose-guard-before-output`.
- *Retired from the text graph (#71).* The axes `prefer-short-sentences`, `prefer-concrete-sensory-detail`,
  `prefer-open-ended-prompt`; the directives `spend-budget-on-scene-texture` (written in terms of the retired
  budget), `scene-sensory-anchor` (a compulsory opening), `rewrite-expository-choice-summary` (the
  handle-as-proof recipe), `crisis-scene-clarity` and `npc-direct-speech` (craft, now the package's),
  `final-output-pass` (its rationale names `narration.review`, a tool this tree never had). Nodes leave the graph
  rather than the beat table because the first-turn full form sends every directive node, not the table's picks.
  The manifest's `graph_content_digest` is recomputed with `parsePythonJson` and `jsonDigest` from
  `kernel-ts/json.ts` (plain `JSON.parse` does not reproduce the Director manifest, so it is not the recipe),
  `node_counts` follows, and `beat-directives.json` drops the same ids, picking at most four of the eleven per
  beat. No campaign pins this digest; the ontology and the Director graph reference only the two `dying-*`
  directives, which stay; the capsule tests read the counts from the files.
- *`narration-craft` 1.1.0 (#75).* No settings. NPC voice, crisis ordering, the scene-opening perception as an
  offer, the beat words and the humour knobs, the world-assertion cost ladder, material selection from the live
  exchange and the dossier, friendly and cooperative outcomes, one detail serving several purposes, plain
  telling allowed, hidden truth by reference to law 3.
- *`keeper-pacing` 1.1.1 (#73 plus pacing repair).* The stalled counter as an advisory inspection (§30.11);
  concise replies are read by expressed meaning and context, not by length alone; the recovery order for a stuck
  player, the Idea roll as the rulebook has it and clarification free remain; fair warning and clocks unchanged.
- *`story-thread` 1.0.4 (#74/#80 repair).* The lines as opportunities; the gate check half distinguishes named
  checks, `check required (skill unspecified)` and `check unspecified`; structural semantics unchanged.
- *`narration-audit`, `natural-npc`, `enhanced-items`.* Unchanged.

**The playable turn, which the base prompt owns (#72).** Take up the declared action, question, attitude or
pause; make settled outcomes perceptible; stop at a real obstacle, a real decision, or an opportunity an
uninformed player can understand, never at a planted object; tell plainly what the investigator perceives or
already knows; never write the investigator's thoughts, feelings, trust, intentions or actions; clarification
and reminders of known facts cost nothing. `ask` admits `kind=mechanics` only (the model-facing shape above); a
story question lives in `narrate` prose, and the prompt says so once.

**What no layer says any more.** That quality is length; that sentences must be short; that a sensory detail,
an open question or a "handle" must be present before stopping; that texture should be spent over events; that
every recovery costs time, exposure or alarm; that the thread is a per-turn plan. Nothing replaces them with
event, clue, paragraph, twist or progress quotas; the verifier (§12.5) and `narration-audit` keep their remits;
no foreground model call is added.

**The #80 gate wording repair (2026-09-10, after `knq-live-1`).** The historical live failure remains the
boarded cupboard. `where.affordances` carried `force-cupboard` — *"Pry open the nailed-shut cupboard in the
storage room and inspect the old books inside"* — naming `corbitt-diaries`, and the thread's `here` row carried
the clue with the book's delivery words; the Keeper nevertheless invented a Strength check six times across
thirteen turns, treated failures as final, and never opened the critical line `corbitt-is-undead-sorcerer`.

The factual correction is narrower than the old diagnosis. The Haunting's current 39 conclusion clue entries
contain 9 named skills and 30 missing `skill` keys, with zero explicit `skill: null` entries; the
`corbitt-diaries` and Knott entries are missing-key entries. Earlier #80 prose said `skill:null` because absence
had been displayed as `null`, not because the source proved a no-roll annotation. JSON Schema's object reference
keeps required/present properties distinct from absent optional properties and present `null` values:
<https://json-schema.org/understanding-json-schema/reference/object>.

The repair therefore changes presentation, not evidence. The gate stays the existing single string,
`<delivery kind>: <check>`, plus existing unlock conditions after semicolons; no field, RPC or graph vocabulary is
added. A nonempty skill on a matching conclusion clue entry still renders with its difficulty. A `skill_check`
delivery with no named projected skill renders exactly `check required (skill unspecified)`. Every other no named
check case renders exactly `check unspecified`. The kernel does not parse source prose to decide free or required
checks. The current source producer preserves semantic check/no-roll prose as rule nodes and `uses-rule` relations
alongside legacy clue-entry data, so absence in this one projection is not absence at source. Explicit no-roll
instructions in that material and the handed-clue contract remain authoritative; genuine risks and rules still
call for checks. `check unspecified` is neither a skip-roll instruction nor an invitation to invent a new roll:
use current intent, known rule/source detail and source lookup only when necessary; ordinary uncontested actions
and plainly given clues should not acquire a new check merely because this field is unspecified. No `.coc`
evidence, source graph or prior receipts are rewritten, and no no-roll metadata is invented.

The old `affordance.skills` warning stands in its narrower form: side skills near a clue are not the gate
projection and must not become an automatic roll.

**Settings across a version change (#70).** §26 now says it: a version-only request carries forward only the
keys the target version declares and records the retired keys in telemetry; an explicit unknown key is still
refused. Reproduced on the emitted kernel before the change: locking a fresh table to the real 1.0.1 bytes and
configuring 1.0.2 with version only, or 1.0.2 to a copy with empty settings, both refused with `Invalid Mod
enable state or unknown setting`; explicit `settings: {}` passed. `merged-1` is still locked to 1.0.1 for this
reason.

**Verified and not.** At the time of writing nothing below this line has run: the six implementation tickets,
the integration and activation evidence (#76), the live regression (#77), the editorial comparison (#78) and the
novice-human gate (#79) are separate reports, and a missing human gate blocks any claim that the novice
experience is solved.

## 31. The three ends of a seam: producer, projection, adoption (2026-09-10)

Nine of the seventeen defects this project has recorded were one shape: something written that nothing reads, or
read that nothing writes. Two more turned up in §30 with a third end missing — a capability that had both ends
and that the Keeper never reached for. A seam has three, and each end has a check.

| end | question | check | catches |
| --- | --- | --- | --- |
| producer | what changes it? | §31.1, a test over the source | a world key read with no writer |
| projection | who sees it? | §31.1, the same test reversed | a world key written with no reader |
| adoption | who acts on it? | §31.2, a telemetry lane | a capability offered and never taken |

### 31.1 No world-state key with only one end

`tests/extension/world-state-seams.test.mjs` walks `kernel-ts/**` with the TypeScript AST, pairs every property
read on the world against every assignment to it, and fails either way round. The world reaches code as `world`
or `<something>.world`; a file that stages it under another name declares that name, so an ordinary local is
never mistaken for the world, and an identifier called `world` that is something else (the turn record's own
snapshot, in `recall.ts`) is declared with what it is instead. A key a campaign is created with and no later
path assigns goes in `SEEDED` with the reason it never changes — the table is the ledger, and an empty reason
is not an entry.

**Its blind spot, stated so nobody trusts it further than it goes:** it sees only world state. A projection that
reads an authored graph field and presents it as if play could change it is perfectly paired to this test. That
is exactly how §30.9's threat clocks shipped dead — `current_segments` came off the module graph, which is the
book and does not move. The next end is what catches that.

### 31.2 The offer ledger

An **offer** is a capsule row that names an action and what taking it would yield. Four are registered today:
a clue gate under `director.reveal`, a clue under a thread line's `here`, a scene under its `next`, and a threat
clock that has a `next` segment. `offerLedger` in `kernel-ts/write/text.ts` runs where `director_adoption`
already runs, at `narrate` and at `ask`, and writes one telemetry row per turn:

```
{"lane": "offers", "turn": n, "closed_by": "narrate"|"ask", "offered": [ids], "taken": [ids]}
```

An id is `<kind>:<handle>`; taken is decided by the turn's own receipts — a `clue` receipt for that clue, a
`move` to that scene, a `threat` tick of that clock. `tests/play/kpi.py` aggregates a run into offered, taken and
`never_taken` per kind.

**A capability nobody uses and a capability nobody can use read the same way here**, and that is the point.
Both have shipped in this tree: 0.8.2a's Director advised zero times across a whole live run, and this tree's
threat clocks were offered on every turn of a twelve-turn table with no writer behind them. The ledger shows
either within one run; telling them apart is then one investigation instead of one slice.

**It counts, it never nags.** §13.7's law holds for this lane exactly as it does for adoption: nothing here
reaches the next capsule. An offer the Keeper keeps declining is a fact about the offer, not a debt the Keeper
owes — the moment it feeds back it becomes an obligation, and obligations are what killed the old Director and
what retired the number check on 2026-09-09.

### 31.3 An offer row carries its own cost and its own yield

The thing that finally got `apply threat` used was not an instruction. It was one field: the clock row started
saying what advancing it would put on the table. Every row that works has the same shape — a clue gate is
`{clue, gate}`, a route is `{scene, clues, line, locked}`, a clock is `{state, next, on_full}`: what it costs and
what it gives, in the row, where the decision is made.

So the rule for any new row that invites an action: **name what it costs and what it yields, in that row.**
Information the Keeper has to assemble from two places is information nobody gave — the 0.8.2a lesson, which
cost two rounds of adding panels that changed nothing. `test_an_offer_row_carries_both_what_it_costs_and_what_it_yields`
holds the four registered offers to it.

### 31.4 §22 repair mapped to the three ends

The §22 graph repair is deliberately a three-end seam, not a reader-only cleanup. Its producer end is the source
reader and publication path: they write canonical clue propositions, support chains, reviewed `/coverage`, and
same-generation graph manifests. Its projection end is the verified graph loader, the ModuleGraph clue-profile
bridge, the play/load path, Director gates, and Story Thread rows that surface those projections. Its adoption end
is the Keeper actually choosing offered investigation information and recording canonical `apply clue` receipts.
The existing offer ledger and Director adoption telemetry measure the gap between what was offered and what was
acted on. Static source and code checks can establish the producer and projection ends only; they are not proof that
the Keeper acted, and this repair should not claim real play was tested. If producer or projection evidence is
missing, block the publication or graph read with evidence. If an offer is merely not acted on, record and
investigate it under §31.2's counts-never-nag law: do not block reads, add quotas, feed counts back as pressure,
infer source facts, or rewrite damaged history.

### Name-run anchoring correction (2026-09-10)

The run was unanchored for a few hours and `apply clue "steven-knott"` — a person, asked for as a clue — resolved
to `clue-knott-commission` instead of `unknown_entity` (`tests/kernel/test_apply.py::test_clue_here_not_here_and_duplicate`).
The cause is that a name key is not always a name: `nameKeys` indexes whatever the graph put in `name`, and for a
starter clue that is a whole sentence — "Landlord Steven Knott pays $20/day to examine the Corbitt House...". An
unanchored run turned the bridge into a substring search over prose, which is the shape Agents.md forbids
everywhere else.

Anchoring is the whole fix and it needs no list: a qualified form of a name keeps the qualifier outside it
("Professor Nemesio Sánchez", "Letter from Nemesio Sánchez", "Nemesio Sánchez, of the university"), so the run
sits at one end; a sentence that merely mentions someone holds it in the middle. Every #64 case is a suffix or a
prefix and is unchanged. `tests/extension/ts-kernel-name-phrase.test.mjs` gains a clue whose name is a sentence
carrying a person's name in its middle, and asks for that person as a clue.

## 32. Action admission and the local relation projection (2026-09-11)

The spec `docs/specs/graph-backed-play-experience.md` starts from two retained turns of The Haunting: a
player asking "科比特是什么？" after a setup that had already introduced Corbitt, and "那看看报纸" turning
into a move, a clue, a time advance and an encounter the player had not chosen. Everything below this
line is the contract those turns needed. It adds no plane of authority, no second Keeper, no quota, and
nothing that reaches the next capsule.

### 32.1 Admission is host-owned, runs before effects, and no package switches it off

Before a `resolve`, or an `apply` batch that carries a `move` (other than a rename of the scene
underfoot), a `clue`, a `time`, a `cash`, an `item` or a `handout`, reaches a Mod hook or the kernel, the
kernel extension puts the proposal to an independent review (`extensions/kernel/admission.ts`,
`admitAction` in `extensions/kernel/index.ts`). It runs in the tool path itself — ahead of
`mods.prepare`, so a refused batch pays for no definition agent, and ahead of the transaction, so a
refused batch mints no receipt and has nothing to replay. It is base host behaviour on the same footing
as the turn state machine: there is no package, setting or capsule field that disables it.

What is **not** put to review, decided by closed contract enums and never by reading the prose:

- `resolve` with `action.choice` (the player's own pending answer), a `decision` in the `sanity:` or
  `development:` families (the rules or the table run those), or an `actor` who is not an investigator
  (NPC initiative is the Keeper's to decide);
- an `apply` batch none of whose effects is a triggering kind: `npc`, `threat`, `flag`, `note`,
  `ruling`, `define`, `object`, `ability`, `dossier`, `ending`, `fork`, `switch`, `merge`, `damage` on
  their own are bookkeeping, NPC movement, pacing, world switches or consequences, not a proposed
  voluntary action;
- a `resolve` that settles the closed option the player was just asked (`ask` offered `dodge`/`fight_back`/`push`/`spend_luck`, the player answered in their own words, the Keeper writes `defense`, `push: true` or `luck` accordingly): the answer is the player's own choice, in whatever words it came. The second real table paid a full review, and two of its four timeouts, on exactly these combat rounds before this exemption existed;
- a turn with no player text (the opening). The skip is a telemetry row, not a silence.

A batch is reviewed whole and refused whole: a `clue` beside a `move` is admitted only when the player's
words authorise both. The review authorises the affected voluntary action, never its outcome, and never
asks that the player knew or approved a hidden danger.

### 32.2 The review, its verdicts, and what a refusal says

The review is the §12.5 pattern with a different remit: one zero-tool completion through `runLane`
(`extensions/lanes/subsession.ts`), model `PI_COC_ADMISSION_MODEL` (`provider/model`, default the
table's own model), cap `PI_COC_ADMISSION_TIMEOUT_MS` (default 120 s, the verifier's; it was 60 s until the first real table lost two turns to it, §32.9). It answers one
JSON object:

```
{"verdict": "authorized"|"entailed"|"not_player_action"|"not_authorized"|"uncertain",
 "grounds": "<=200 chars: the words relied on",
 "missing"?: "<the choice the player has not made; only for not_authorized / uncertain>"}
```

The first three admit: the player's words in context chose it; it is a routine step the chosen goal
requires; it is not the investigator's voluntary action at all. The last two refuse. A malformed answer
is no answer (`bad_output`) and refuses like an outage.

A refusal reaches the Keeper as an ordinary tool refusal (§8's `code: message` / `fix` / named
`details` lines), so nothing new has to be learned:

- `needs` with `details.reason: "action_not_authorized"` — `details.missing` names the choice the player
  has not made, `details.verdict` and `details.grounds` say why. The `fix` tells the Keeper not to roll,
  move, spend or land anything for it, not to resend the same action in other words, and to close with
  `narrate` putting that choice in front of the player in the fiction, without a menu.
- `needs` with `details.reason: "admission_unavailable"` (`details.cause` is the lane's failure reason:
  `model_unavailable`, `model_error`, `bad_output`, `timeout`, `session_gone`; `details.streak` is how
  many reviews in a row have failed) — no review, no authority.
  The `fix` tells the Keeper to say so to the player as a service notice, not as fiction, and to
  narrate nothing as having happened. **Unavailability refuses; it never admits.** The alternative to an
  unreviewed action is not a reviewed one, it is a Keeper choosing for the player.

One failure reads as transient, a streak as an outage (2026-09-14, live table `game-3782bd90`: a lane
provider fault — the lane's `complete()` lacked the OpenCode session headers, docs/pi-host-contract.md —
refused every review while the Keeper on the same model still narrated, and two player turns were spent
asking for a resend that could never work). The first unavailable refusal of a streak keeps the `fix`
above: the next input may try again. From the second consecutive failure the `fix` drops that promise —
the Keeper says the table cannot settle actions until the person running it restores the review
service, that they have been told outside the game, and that the next input is not promised to work —
and the host leaves a `coc-admission-status` session entry plus a `coc:admission-status` bus event,
`{campaign, turn, status: "down", streak, cause, detail, model, fix}`, once per streak: the operator
learns out of fiction that the review lane is down and how to restore it (switch the table model, or
set `PI_COC_ADMISSION_MODEL` and start a new session), instead of the table discovering it one player
turn at a time. Any live verdict, admitting or refusing, resets the streak; a turn boundary does not —
an outage is a service condition, not a turn context. A startup probe of the lane was considered and
rejected: it spends a model call at every table open on a check whose success guarantees nothing about
the calls that matter, and the streak fires exactly where unavailability is met — the escalation, not a
pre-flight check, is the operator's signal.

The refusal counts against §8's identical-resend strike like any kernel refusal, and the Keeper's own
`why`, `goal`, `method` and `stakes` are the proposal, never evidence of consent — the reviewer is told
so, and the Keeper cannot mint authority by writing a rationale.

**Picking one of the options the delivery named is a choice (2026-09-11 ruling).** The same six words,
「那看看报纸」, were refused on one table and admitted on another, and a five-model probe split three to
two: the rule as first written did not decide the case. It does now. Where the delivery the player just
read named the places to try, taking one of them by name chooses that destination, and the travel it
takes comes with it. Where the delivery named none, the same words are interest in a subject and choose
nothing — which is the spec's own motivating incident, and it stays refused. In neither case does such a
remark reach the situation waiting there: a gatekeeper to get past, a price, a danger staged on arrival
are proposals of their own and are judged on their own, which is how the third table's refusal of a
social check against a clerk the player had never been told about was already right. The rule lives in
the reviewer's prompt; the evidence that it decides the case is the seven-pair probe, where
deepseek-v4-flash, deepseek-v4-pro and grok-4.3 now agree on all seven, including the two that used to
split.

### 32.3 What the reviewer reads: the player's context, not the Keeper's

The input is the exact current player text (the `table.player_input` prompt; on a recovered turn,
`pending_turn.player_text` from `table.open`), the investigators' names and occupations, the scene's
player-facing name and the names on stage, what the player was already told — the setup prologue
(`table.open`'s `setup_prologue`) and the last four deliveries as the host delivered them (`rendered_text`
of `narrate`/`ask`), with the capsule's `recent` heads standing in after a restart — what this turn has
already settled through the kernel, what this turn has already refused, and the proposal itself, one
line per `resolve` field or `apply` effect. Nothing Keeper-only travels: no scene summary, no
`keeper_notes`, no NPC agenda or secret, no undiscovered clue. The reviewer judges whether the player
chose, and the player chooses from what the player was told.

### 32.4 Reuse and cancellation

A verdict is kept for the turn under a host-owned canonical key of the proposal (`resolve`: actor,
intent, goal, method, skill, target, weapon, spell, object, push, luck, defense; `apply`: each effect's
kind and its identifying fields, order-free; `why`, `how`, `label` and `decision` are outside the key,
so a `needs_choice` retry or a rationale bolted on reuses its verdict). Admitting and refusing verdicts
are both reused; a reused row says `reused: true` and costs no model call. The next `player_input`
clears every verdict: a new player utterance is a new context, and no earlier acceptance executes after
the player has spoken again. A refused proposal was never sent, so there is nothing for replay, restart
or a stale pending decision to execute.

### 32.5 The local relation projection: cue, gate and yield in one row

The Haunting's scene records author `affordances` as `{id, cue, grants_clue_ids | clue_id, route_type,
status, npc_interaction}`; §6 projected `{id, cue, clue?, npc?}` reading only the older singular
`clue_id`, so a book that wrote `grants_clue_ids` — every hand-written starter scene — put cues on the
table with nothing they yield. The row now carries `clues: [{clue, gate, discovered}]` (the first one
keeps the `clue` key), `gate` being the same one-string projection `director.reveal` and the thread's
`here` rows use (§30.1, §30.12). `known.clues_here` rows gain the same `gate`, so "what can still be dug
up here and how" is true of the section. `status` and `route_type` are not projected: they are author
fields with no writer, and §31.1's blind spot says exactly what a projected `status: "open"` would become.

Three ends (§31): the producer is the scene record's `grants_clue_ids`/`clue_id`; the projection is
`whereSection` and `cluesHere` in `kernel-ts/read/capsule.ts`; the adoption end is the offer ledger,
which now registers `affordance:<id>` for every row that names its clues, taken when one of them lands.
`kpi.py` counts it under its own kind. It counts and never nags (§31.2).

One authored writer was seen and left alone: `on_enter.clock_ticks` on a scene record names a threat
clock the book means to advance on entry, and nothing reads it — §30.9's Keeper-run tick is the only
writer. Whether the book's automatic tick should join it is a separate contract decision.

### 32.6 The public record beside the Keeper-only list

`narrate`'s `facts` gains `public: [...]` (≤ 2KB): `Investigator: <name> (<occupation>)` per sheet,
`Setup prologue told the player: <head>` when the setup handoff committed one, and `Told at turn n: <head>`
for the two deliveries before this one (`kernel-ts/write/text.ts` `publicContext`, read from the turn
records by `campaign.readTurnRecord`). The verifier lane (§12.5) reads it as a third block and is told
that a Keeper-only fact this list shows was already told is not a reveal, and that restating it is not
an invention. Nothing is made public by it: an undiscovered clue stays in `keeper_only` until its receipt
lands. The deterministic signal that was looked for and is **not** there: every conclusion clue entry
on The Haunting carries `visibility: player-safe`, so that field says the summary is safe to read out
once earned, not that the fact is public before it is earned. Public is what was delivered.

### 32.7 Telemetry

One `lane: "admission"` row per put-to-review call: `{verb, ok, verdict, admitted, reused, ms, key, model}`
on a verdict, `{verb, ok: false, reason, detail, ms}` when the review could not decide,
`{verb, ok: true, skipped: "no_player_text"}` on the opening. `key` is a digest of the canonical proposal,
never shown to a model. The lane's four `lane-call` rows carry `subsession: "admission"` (§12.8.1). The
tool-call row of a refused call keeps its own columns and records `reason: action_not_authorized` or
`admission_unavailable`. The outage escalation of §32.2 is not a telemetry row: it is the
`coc-admission-status` session entry and bus event, once per streak, because its reader is the
operator, not the run analysis — the consecutive `ok: false` rows already say the same thing to
`kpi.py`. `tests/play/kpi.py`'s `admission` section reports reviews, reuse, skips,
verdict counts, unavailability by cause, and the review time apart from delivery time. Whether a
refusal was right is a human reading of the turn record.

### 32.8 The base prompt

`prompts/keeper.md` gains two paragraphs and no package changes: what a refusal means and what to do
with it (§32.2), and orientation — re-establish public relationships after setup, handoff, a gap or a
subject change without restaging; answer a "what is that?" with its public meaning first, never as a
penalty and never with a secret; a `handout` is a physical document, a clue is what was learned, a
summary is neither. Craft and pacing stay with the packages of §30.

### 32.9 What is verified and what is not (2026-09-11)

Verified on the emitted kernel and the extension seam: refused batches reach neither the Mod bridge nor
the kernel; admitted batches go through unchanged with their minted `call_id`; the reviewer's input
carries the player's words, the investigator, the scene and the stage, and none of the capsule's
Keeper-only material; a reworded proposal is refused with the earlier refusal in its context, an
identical one reuses its verdict, and a new player input re-evaluates; unavailability and malformed
answers refuse with the service-status `fix`; a repeated outage drops the resend promise from that
`fix` and escalates once per streak to the operator (`coc-admission-status`), and any live verdict
resets the streak; bookkeeping, NPC actors, sanity checks and renames are
not reviewed; a recovered turn is reviewed against the pending turn's own words
(`tests/extension/admission.test.mjs`). `facts.public`, the affordance rows, the `known` gates and the
`affordance:` offers are pinned in `tests/kernel` (`test_facts_warn.py`, `test_capsule.py`,
`test_mod_director_text.py`).

**First real table (`admission-e2e-1`, 2026-09-11, The Haunting, zh-Hans, grok-4.6 as Keeper and, by default, as reviewer; evidence `.coc/campaigns/admission-e2e-1/`, `.coc/playtests/admission-e2e-1/`).** Seven played turns, stopped on the run's own rule after `admission_unavailable` twice in a row. Nine proposals were put to review: authorized 4, entailed 1, not_authorized 2, timeout 2; no false refusal and no false acceptance on a turn-by-turn reading against the source. Both motivating incidents were fixed at this table: 「科比特是什么？」 (turn 2) was answered with the public meaning and nothing was reviewed; 「那看看报纸」 (turn 3) had its move+clue batch refused with `missing` naming the destination the player had not chosen, and the Keeper put the choice in fiction without a menu and without resending. A resolve against a gatekeeper the player had not yet been told about (turn 4) was refused, which the source confirms as the authored `persuade-arty` gate reached too early. The cost was the defect: grok-4.6 answered a verdict in 13–45 s (the same order as the verifier lane, 47–120 s, on the same model) and two reviews of one clue-and-handout batch hit the 60 s cap, so admission took 338 s of the table's 660 s. The cap is now 120 s (§32.2).

**Second real table (`admission-e2e-2`, 2026-09-11, The Haunting, zh-Hans, grok-4.6 as Keeper, `PI_COC_ADMISSION_MODEL=xai/grok-4.3`; evidence `.coc/campaigns/admission-e2e-2/`, `.coc/playtests/admission-e2e-2/`).** Thirty played turns, 2175 s: the commission, the morgue and its gatekeeper, the boarded window, a quiet listen, the upstairs bedroom and the bed, the neighbour, the cellar boards, Corbitt's diaries, and a melee over the rusted dagger. Forty-two verdicts (authorized 29, entailed 8, not_authorized 4, not_player_action 1) and four timeouts at the 120 s cap; no false refusal and no false acceptance on a turn-by-turn reading against the source, one arguable refusal (a grab at the dagger the Keeper read as a combat manoeuvre). Every refusal was closed the way §32.2 asks: the missing choice in fiction, no menu, no resend, nothing narrated as done. Three things it exposed, two of them repaired the same day: (1) grok-4.3's tail — mean 7.3 s but 30–47 s outliers and four full-cap stalls in thirty turns, which the seven-case probe never showed; admission was 14% of table time by decisive reviews and 36% counting the stalls, against 51% on the first table; (2) a refusal or an outage on the trailing `apply` of a turn whose `resolve` had already landed sent the Keeper to narrate nothing, and `narration-audit` then rightly refused the draft for the unrealised roll — both `fix` texts now say that what already landed with a receipt did happen and is narrated, only the refused batch is not; (3) the player's answer to a dodge/fight-back `ask`, given in prose, was settled by a fresh `resolve` and reviewed each round — now exempt (§32.1). Verdict reuse was not exercised by play (no identical proposal within a turn), so §32.4 still rests on the seam tests.

**Third real table (`admission-e2e-4`, 2026-09-11, The Haunting, zh-Hans, grok-4.6 as Keeper, `PI_COC_ADMISSION_MODEL=deepseek/deepseek-v4-flash`; evidence `.coc/campaigns/admission-e2e-4/`, `.coc/playtests/admission-e2e-4/`).** Forty played turns, 2222 s, to a natural ending: the investigator died in the basement fighting Corbitt after opening the boards, reading the diaries, being hurt by the bed and refusing the newsboy's price. Fifty-one verdicts (authorized 41, entailed 5, not_authorized 4, not_player_action 1), **no timeout**, mean 0.92 s, p90 1.26 s, max 1.77 s; admission was 47 s of the table's 2222 s, about 2%, against 51% and 36% on the two tables before. No false refusal and no false acceptance against the source. The dodge and fight-back answers of the two combat rounds (turns 34, 36) produced no admission row, the player's own three attacks did, Corbitt's own rolls did not, the sanity checks did not, and the dying CON rolls (`healing:`) did; a swing the Keeper retargeted at "Walter Corbitt" when the player had named only the dagger was refused with `missing` naming exactly that, and the next `resolve` corrected the target (turn 30). Verdict reuse was again not exercised by play. Two defects it found lie outside admission: (1) the investigator's death (turn 38: dying CON roll failed, `dead` on the sheet) reaches the player only as prose — the roll's mechanics card says `failure`, not that the investigator died, a projection gap left open here; (2) `development:end-session` refused four times with "development tick references skill missing … 'CON'": the dying CON roll of turn 37, passed, had been recorded as an improvement tick on CON through the `healing_check` path, and CON is on no skill list — repaired the same day (`skillTickEligible` never ticks a characteristic; `tests/extension/ts-kernel-resolve.test.mjs`). The Keeper's first attempt also sent `ending: "failure"`, which the closed set (`conclusion`, `tpk`, `retreat`, `cliffhanger`) refused with the options listed, and it corrected itself.

**What the three tables found outside admission, and what was done (2026-09-11).** Seventy-seven real
turns are the only place these surfaced; the suites were green throughout. Repaired:

- **A condition had no receipt.** `dying` -> `dead` was written to the sheet and the healing save and
  reached nothing else, so the death of `admission-e2e-4` turn 38 existed only in the prose: no
  mechanics card, no committed fact, and three `uncommitted_state` findings from the verifier, which
  was right. `addEffect('condition', ...)` now mints a receipt beside its effect, `mechanicsOf`
  projects `{kind: "condition", gained, lost}`, `committedFacts` says who is now what, and the marker
  is `condition:<what changed>`. Every condition family gains this, not only death.
- **Four refusals named no way out**, against §8's rule that a `fix` points somewhere real: combat's
  missing target, the two "not a weapon the investigator carries", and a definition that cannot be
  regenerated. The weapon ones now name the arming path (`apply item` with a rules-table profile in
  `weapon`), which is what the Keeper could not find across three round trips at `admission-e2e-4`
  turn 33 before rolling the fight unarmed while the prose swung an iron bar. The target one says that
  a thing with nobody behind it is an ordinary `resolve` or `apply damage`, not combat.
- **A maneuver read its kind out of a prose goal.** The tool asks for a sentence in `action.goal`; the
  engine wanted one of `disarm`, `ongoing_disadvantage`, `escape`, `push`, and a sentence came back as
  an unusable `invalid_params` three times in a row (`admission-e2e-2` turn 30). The binding now reads
  the kind when the goal names one, keeps `ongoing_disadvantage` for an unstated goal, and otherwise
  refuses with the four in `details.needs.options`.
- **One invented entity name lost a whole turn's memory.** An entity link is an index into the graph,
  not the fact itself; a name that matches nothing is dropped and reported as `dropped_entities`,
  while `subject` and `knowers` stay strict because they say whose knowledge it is.
- **A declared scenario reward reached nobody, so one was invented.** The Keeper was told to "read the
  source conclusion/rewards" and tried `0`, `1D6` and `1D3` in turn. The reward was there all along:
  the authors write `conclusion_contract` on the scene that ends, with `sanity_reward.die` and a
  `rule_ref` into the ruleset (The Haunting: `1D6`, requiring Corbitt destroyed), and **nothing in the
  kernel read that field** -- a §31 first-end trap, authored and never projected. `lookup kind=secret
  scope=module` now carries `endings`, which is the call that table made; the ending refusal names it;
  and the base prompt says an undeclared reward is omitted, never a figure the Keeper chose, with an
  empty list as the answer that this book declares none.
- **Three of four handouts across the three tables were delivered empty.** The starter's own Handout 1
  declares neither `authored_text` nor an `image_ref`, and the investigator map's file is not on disk,
  so `stageHandout` landed the receipt with `available: false` -- and the Keeper, reading that bare
  field in a successful result, wrote the card across the desk anyway. `apply` now says it in words:
  the receipt landed, the player has nothing to look at, tell what the document holds in the prose.
  What is still missing is the bytes; §22's original-page crop is the path for a bound book.

Not repaired, and named here rather than patched:

- **An NPC cannot open a fight** (`admission-e2e-2` turn 25), and this is a slice, not a patch. Three
  things stand in the way, and only the first is code in this file. (1) `executeCombatResolve` refuses
  `no combat is underway for <npc> to act in`, and `startCombat` reads the NPC side out of
  `target_npc_id`; the slot binding already handles an NPC attacker. (2) The engine *does* implement
  the ambush -- `resolveSurpriseAttack`, `surprise_attack` in `VALID_ACTIONS` and `RESOLUTION_HINTS`,
  `surprised` in `VALID_CONDITIONS` -- but no decision reaches it, and decisions are RuleGraph data
  (`content/rulesets/coc7/rule-graph.json`), not code. (3) `snapshot.ts` holds initiative to strict DEX
  order (`combat initiative order is not canonical`) and requires every actor before the cursor to be
  `acted` or `skipped_ineligible`, so "whoever starts the fight acts first" is not representable
  without a `surprised` status carrying its own skip evidence. Letting the NPC open without answering
  (3) is worse than the dead end it replaces: the refusal throws, the session is rolled back, and the
  Keeper is pointed at the investigator's turn, which admission then rightly refuses -- a loop. The
  refusal now names the two paths that do work today: the investigator's own reaction opens the fight,
  and harm that contests nothing is `apply damage`.
- **No imported book declares a scenario SAN reward.** The starter's are projected now (above), but
  the producer end is still open for a book the reader built: the source reader never extracts
  `conclusion_contract`. Fixing it starts at the reader ask, as §30.4 did for the pacing fields.
- **An NPC's willingness does not move when a package settles the exchange, and that is the law, not a
  defect.** Three of the five NPCs of `admission-e2e-4` had an interaction on their ledger and no
  stance: the rolls that settled them were `natural-npc`'s own first-impression checks, whose receipts
  carry `family: "mod"` and no `approach`. `npc-stance.json` says what happens then, in its own note:
  *an approach or level absent from the table moves nothing: silence is zero, never a guess.* The kernel
  obeyed it. What is open is a package question, not a kernel one: a first impression is the interaction
  most likely to set where somebody stands, and it is the one interaction that cannot reach
  `toward_party`. Closing it means `natural-npc` declaring which of the four approaches its check was,
  so the existing table scores it — a package change with a version bump, and a number nobody has
  authored yet. Nothing here is repaired by code in the kernel, and the ledger's own row already says
  `social`, which is what the package declared its intent to be.
- **A delivery the kernel rendered could reach nobody (repaired).** `probe-willing` turn 1 settled a commission,
  moved the scene, seated an NPC and closed with `narrate`; the kernel wrote 242 characters of prose
  into the turn record, and the player was shown nothing. The Keeper had ended on the message that
  carried the `narrate` call, so there was no following text-only assistant message for `message_end`
  to place `rendered_text` into — the tool-call branch strips text and returns, and the placement waits
  for a message that never came. `agent_end` already knows this shape (its comment names it) and uses
  it only as the verifier lane's starting gun; nothing delivers the prose. It is rare — one turn in the
  445 this project has played across every run on disk — and the repair is not a patch: `sendMessage`
  can only make a custom message, not an assistant one. Two repairs rather than one, because the two
  readers are not the same: `agent_end` now places the prose as a displayed `coc-delivery` message when
  the replacement never ran, and writes a `lane: "delivery"` row saying it did, so a terminal shows the
  words instead of nothing; and `tests/play/driver.py` takes the delivery off the `narrate`/`ask`
  result, the channel PipiCOC has always read, so acceptance evidence stops depending on what the model
  did with its messages. The driver half is pinned by `test_a_delivery_that_only_the_narrate_result_
  carries_is_still_the_turn`; the host half is not, and cannot be at this seam — the faux provider
  always answers once more, and that answer is somewhere for the replacement to land. What keeps the
  branch honest is its guard, false on every turn the replacement did run, and its telemetry row.
- **The verifier lane times out on a slow model** -- eight of forty turns at `admission-e2e-4`, on
  grok-4.6, each losing its findings. `PI_COC_VERIFIER_MODEL` takes the same treatment as
  `PI_COC_ADMISSION_MODEL`: a small fast model answers a short JSON judgement in about a second.

**Three seeded probes for what play never reached (2026-09-11; probes, not playtests, and not
acceptance).** Each is a real table through the real Keeper with `deepseek/deepseek-v4-flash` reviewing,
aimed at one question the three tables left untested. `probe-quiet` (10 turns, Knott's office and the
street, never the haunted house): seven deliberately quiet turns landed **no** clue, move, time or
session between them, the one clue that did land came from the NPC's own initiative and admission
classified it `not_player_action`; `stalled_turns` crossed `keeper-pacing`'s threshold at turn 6 and
climbed to 6, the Director scored RECOVER top for five straight turns, and the Keeper declined it all
five, reading 「再给我一会儿」 and 「先别催」 as lingering rather than being stuck — §30.11's doctrine
exercised for the first time. `probe-improv` (12 turns of sideways investigation — title searches, the
will's executor, the Macarios' whereabouts): the Keeper reached for the source, by explicit `lookup` or
from an already-loaded node, and answered from authored causal facts (the executor pastor and his
sentence, the sealed 1912 raid file, the records clerk and his redirect), inventing no culprit,
contradicting nothing, and never flatly refusing to engage; the one weakness was an authored Law-contact
branch collapsed into a generic social check. `probe-willing` (10 turns working an authored gatekeeper):
the arc the specification asks for did **not** complete, because six social rolls in a row failed —
but the ledger worked end to end, moving `null` → `wary` through the closed table on a fast-talk
failure and then to `hostile` through the Keeper's own `apply npc`, and the next capsule carried
`toward_party` with both reasons, which the Keeper then played faithfully. Verdict reuse fired in none
of the three (nor in any of the 77 table turns), so §32.4 still rests on the seam tests alone.

**Reviewer model (probe, 2026-09-11, `ModelRuntime.complete` on the product prompt, seven positive/negative pairs: bare 「那看看报纸」 with no archive mentioned, the same after Knott named the morgue, an explicit trip, look-versus-pry, pry after looking, a quiet half hour, ask-versus-bribe).** grok-4.6: six of six unambiguous cases right, refuses the arguable one, 10–51 s each. grok-4.3: six of six right, admits the arguable one (the spec's "already discussed archive trip"), 2.7–4.6 s each. grok-4.5 (relay, low): six of six right, 4.6–14 s. glm-5.2: two wrong (admits the bare newspapers as `entailed`; a malformed answer on ask-versus-bribe), 9–32 s. With a working key (added by the user the same day): deepseek-v4-flash six of six right, admits the arguable one, 0.7–1.5 s; deepseek-v4-pro six of six right, refuses the arguable one, 1.6–2.6 s. The recommendation, confirmed by the third table above, is `PI_COC_ADMISSION_MODEL=deepseek/deepseek-v4-flash` (grok-4.3 where DeepSeek is not configured); the model is still an environment choice, not a product default, because provider names are the user's.

Not verified, and what it would take: one real table has run with admission on (above), so its false-refusal
and false-acceptance rates, its foreground cost against the same scenario without it, and whether the
Keeper takes the `missing` line into the fiction rather than into a menu are all unmeasured — the
canonical continuous regression of Agents.md, with the admission rows read turn by turn. The
uninformed-human UI gate (#79) has not run. Nothing here claims the novice experience solved.

## 33. Creation difficulty: an extension setting scaled into chargen (2026-09-11)

A difficulty setting for character creation, owned by the COC Keeper extension's
settings tab, snapshot into each new campaign, and applied by the kernel every
time it derives a card for that campaign. This section is the contract; the
implementation decisions land in §33.6.

### 33.1 The setting and its campaign snapshot

- The setting lives in the host's extension settings (`ext.coc-keeper.difficulty`,
  app scope of the settings JSON). It is host configuration, never model input:
  the setup model does not see it, cannot name it, and no `setup.*` profile field
  carries it. The kernel never reads the host settings file; it only accepts the
  value on `campaign.create`.
- Shape (closed): `{mode: "preset", preset: "extreme"|"hard"|"normal"|"easy"}` or
  `{mode: "custom", custom: {...}}`. A preset is a named bundle of the §33.3
  knobs (§33.2), never a uniform card multiplier:
  - `extreme`: occupation points ×0.75, interest points ×0.75, starting skill
    cap 60; characteristics and LUCK are the rulebook standard.
  - `hard`: no knobs at all — the rulebook numbers, bit for bit.
  - `normal`: occupation points ×1.25, interest points ×1.25; everything else
    standard.
  - `easy`: occupation points ×1.5, interest points ×1.5, LUCK rolls 2D6+6×5
    instead of 3D6×5; everything else standard.
  The product default when the setting was never stored is `normal` (user
  ruling 2026-09-11): the host injects it, so a fresh install creates normal
  campaigns out of the box while the kernel's own absent semantic stays the
  rulebook standard.
- Decision 2026-09-12: the uniform preset multipliers (×0.5/×1/×2/×4 of
  2026-09-11) are retired after the solo-COC research
  (`.pi/findings/solo-coc-research.md`): official solo material plays standard
  cards with structural cushions and nothing anywhere uniformly multiplies a
  card, so presets now reach only the budget, cap and luck knobs and every
  derived value stays ≤99. Preset definitions are product-versioned: a
  campaign still in creation re-derives under the new bundle on upgrade (its
  stored snapshot `{mode:"preset", preset}` stays valid), while completed
  sheets keep their resolved numbers — receipts are never re-derived.
- `campaign.create` gains an optional `difficulty` field with exactly this shape.
  The kernel validates it (closed enums, closed dice grammar, numeric ranges of
  §33.3; `invalid_params` with `details.field` naming the offender) and stores it
  verbatim in `campaign.json.difficulty`. Absent means `hard` — today's
  behavior bit for bit, and campaigns created before this section behave
  identically. The snapshot is per-campaign and immutable: editing the extension
  setting later touches only campaigns created afterwards; drafts and receipts
  already written are never re-derived. There is no RPC to mutate it.
- The Electron app reads `ext.coc-keeper.difficulty` when it creates a campaign
  and passes it on `campaign.create`, injecting `normal` when nothing was
  ever stored. The CLI setup path passes nothing. A
  campaign's difficulty therefore answers the three ends of §31 without any new
  machinery: written by the host at creation, read by chargen on every build,
  acted on through the sheet numbers, the receipt, and the draft `limits` block.

### 33.2 What a preset changes

- **Never characteristics or LUCK values.** Every preset rolls the rulebook
  dice on the rulebook 15/90 creation bounds; nothing is scaled, rounded or
  clamped, so a `hard` card is the absent-difficulty card bit for bit and the
  other presets differ from it only where their knobs reach.
- `extreme`, `normal` and `easy` multiply the evaluated occupation-point and
  interest-point budgets (`Math.round`), exactly as the §33.3 budget knobs do;
  the formulas themselves still evaluate on the unscaled characteristics.
- `extreme` replaces the starting skill cap with 60.
- `easy` rolls LUCK as 2D6+6×5 instead of 3D6×5; the keep-highest counts are
  unchanged.
- Everything else is unchanged: age adjustments (absolute values per table),
  the EDU-improvement ceiling of 99, credit-rating ranges, cash and asset
  derivation, `register` purist/pulp, and the characteristic dice expressions.

### 33.3 Custom knobs

`custom` carries any subset of the following (an absent key keeps the rulebook
default; an empty `custom` object is valid and equals `hard`):

- `characteristic_dice`: a map from a rulebook pool expression (`"3D6"` or
  `"2D6+6"`, exactly as keyed in `characteristic-dice.json`) to a replacement
  dice expression. That pool rolls NdM(+K)×5 instead, and its characteristics
  are bounded by the replacement's own range ((N+K)×5 .. (N×M+K)×5) in place of
  the creation bounds.
- `characteristic_min` / `characteristic_max`: multiples of 5 replacing the
  15/90 creation bounds — including the bounds the manual override (§23.4)
  renders.
- `luck`: `{dice: "<expr>"}` to roll NdM(+K)×5, or `{fixed: n}` to set LUCK
  flat with no roll.
- `occupation_points`: `{multiplier: k}` to multiply the evaluated formula
  budget (Math.round), or `{fixed: n}` for a flat budget that ignores the
  occupation formula.
- `interest_points`: the same shape for the INT*2 budget.
- `skill_cap`: an integer replacing 75.

A §33.1 preset is a named bundle of these same knobs (budget multipliers,
`skill_cap`, LUCK dice), resolved through the same arithmetic.

Dice grammar is closed: `^\d{1,2}D(4|6|8|10|12|20|100)(\+\d{1,2})?$`
(case-insensitive), N ≥ 1. Ranges: multiplier 0.25–8; fixed budgets 0–2000;
skill_cap 1–500; characteristic bounds 5–450 in multiples of 5 with min < max;
fixed luck a multiple of 5 in 5..450. Validation is shape and range only — a
closed grammar and numeric bounds, never a semantic judgement.

### 33.4 Records and determinism

- `sheet.creation.difficulty` records the RESOLVED policy: `{mode, preset?,
  custom: {<only the knobs actually applied>}}`. A preset record is
  `{mode:"preset", preset, custom:{}}` — the bundle is named by `preset` and
  product-versioned (§33.1), so no `multiplier` is recorded and a stored
  `multiplier` is rejected at validation. The
  `investigator:<id>` receipt carries the same block, and the creation trace
  names the scaling beside the rulebook source tables.
- The draft `limits` block (§23.4) resolves its fallbacks from
  `sheet.creation.difficulty`, so the draft edit control obeys the scaled
  bounds, budgets and cap with no change of its own; `limits_override` relaxes
  on top exactly as today.
- Same seed + same difficulty → same card. The difficulty snapshot is part of
  the campaign, so every draft revision of that campaign builds under it.
- `setup.investigator` (legacy) builds under the same snapshot; there is one
  chargen path for difficulty, not two.

### 33.5 The settings tab (Electron)

- The `coc-keeper` extension manifest gains
  `app.ui.settingsSections: [{id: "coc-difficulty", title: "难度设定",
  description: "角色创建的难度与数值倍率", entry: "pipicoc/settings-difficulty.js"}]`;
  the host whitelist (`HOST_SETTINGS_TAB_IDS`) and nav hints admit the id
  (a product whitelist edit in `Electron/packages/ui/src/ui-registries.ts`).
- The section renders an immersive 1920s control — a radio-dial preset selector
  with the five stops (extreme / hard / normal / easy / custom), each preset
  stop carrying a short descriptor (budgets −25% / rulebook / +25% budgets /
  +50% budgets · better luck) and a per-preset note line, and a
  newspaper-styled custom panel for the §33.3 knobs — reads and writes
  `ext.coc-keeper.difficulty` through the host's extension-settings methods,
  and validates dice grammar and ranges client-side for feedback only. The
  kernel re-validates everything; the UI is never the authority.
- Out of scope for this section: in-play check difficulty (the `resolve`
  recipes are untouched), existing campaigns, any Mod packaging of difficulty,
  and CLI-side customization.

### 33.6 The kernel's decisions (implemented 2026-09-11; presets re-specified 2026-09-12)

- **One module, one path.** `kernel-ts/setup/difficulty.ts` owns `validateDifficulty`
  (the closed §33.1/§33.3 shape; `invalid_params` with `details.field`),
  `ResolvedDifficulty` (the snapshot readied for arithmetic), the preset knob
  bundles and the dice grammar. `campaign.create` validates and stores the snapshot verbatim;
  `setup.draft` and legacy `setup.investigator` both pass `meta.difficulty` into
  `Chargen.build` — there is one difficulty path, never two. Absent means no key,
  no record, and a seeded test proves the card is bit-identical to the pre-§33
  numbers; an empty `custom: {}` resolves to the same card.
- **Records are written only when a snapshot exists.** `sheet.creation.difficulty`
  and the receipt's `difficulty` block carry the resolved policy; knob notes in
  the trace appear only where they change something (a `hard` snapshot records
  only the §33.4-required record).
- **Custom knobs never clamp a roll.** Replacement dice bind their own range by
  construction; `characteristic_min/max` govern the creation bounds the override
  validates against and the limits block renders — they do not re-clamp rolled
  values. Presets never scale or clamp either (§33.2). Pool-replacement bounds are
  enforced per characteristic in `setup.override` (`characteristicBounds`); the
  §23.4 limits block keeps its single min/max shape, since §33.4 mandates only
  fallback resolution.
- **Presets are knob bundles, never card multipliers (2026-09-12).** A preset
  rolls the rulebook dice on the rulebook 15/90 bounds — characteristics and LUCK
  values are never scaled — and touches only what its bundle names: budget
  multipliers adjust the evaluated budget (`Math.round`), `skill_cap` replaces
  75, LUCK dice replace the roll. Custom `multiplier`/`fixed` budget knobs share
  the same arithmetic, and the resolved record carries no `multiplier`.
- **Determinism is per seed plus snapshot.** Same seed + same difficulty → same
  card. Age adjustments consume the deterministic stream by value, so a luck
  attempt that is kept at one difficulty can differ at another; the stream order
  itself is unchanged.
- **Replacement pools are matched against the dice table.** A
  `characteristic_dice` key that matches no pool in `characteristic-dice.json` is
  dropped from the resolved policy and from the record rather than silently
  rolling nothing.
- **The settings tab is the only writer.** The Electron host reads
  `ext.coc-keeper.difficulty` (app scope) and injects it into the onboarding
  converse input; the worker passes it to `campaign.create` only when one is
  stored. The setup model never sees the field. The CLI path passes nothing.
  Verification at landing: `pytest tests/kernel` 1154 passed,
  `test_creation_difficulty.py` 19/19, Electron vitest 13/13 for the section,
  `npm run test:electron` identical to a pristine HEAD checkout (the one
  failure the suite flags outside its baseline, `coc-view.test.ts`'s bound sheet
  read, fails on a pristine 5ea9bf0a worktree as well — pre-existing at HEAD,
  attributed to the rules lane, out of scope), system-language and ui-words
  guards green (the only other red anywhere being the pre-existing
  `extensions/image-gen` violation).

## 34. The turn floor (2026-09-11)

Spec: `docs/specs/turn-floor.md`. Two live tables (medians 167 and 37 characters; on the thin one 11 of 12 turns closed by the host with no tool call) showed that every active layer forbade and none obliged: §30.12's "what no layer says any more" had left the Keeper with no statement of what a turn contains. The floor states it, as content kinds and never as counts.

**34.1 The two principles behind law 4.** The base prompt's fourth law now names the two principles every specific prohibition is a case of. *Immersion*: nothing out-of-game enters the story text — roll values, targets, grades, ledgers, elapsed figures, rule option lists, tool names, enum values and field names travel only as the mechanics projection (§16.2). *Freedom*: nothing in the story text narrows what the player may do — no story menus, no fixed option lists, no "do you want to continue?" where nothing else is possible, no asking how to handle a failed check. New prohibitions are added under one of the two or not at all.

**34.2 The four kinds every turn owes** (base prompt, "the turn the player gets"; `narration-craft` 1.2.0; `style.floor`). *Uptake*: the declared action or words enacted from the world's view; one word is still a declaration, and the player's length says nothing about the Keeper's. *The world's answer*: settled outcomes perceptible; when nothing settled, someone present acts or the scene changes. *A voice*: anyone present the exchange touches speaks in their own voice. *The handoff*: the turn stops only when the spotlight is back on the player — they hold enough to judge (scene, clues, people) and have more than one real thing to do; a midpoint with nothing to decide is not a stop, and the declared action is carried through its uncontroversial part until an outcome, an obstacle, a gated risk or a real fork. The four lines ride in `capsule.style.floor` on every turn, full form and brief alike, from `content/craft/beat-directives.json` `floor_lines` (four non-empty strings, validated at load); the brief-turn `style` budget is 1536 bytes for it (§13.6 table amended).

**34.3 `director.offer`.** `capsule.director.offer` carries at most three rows `{kind, who?, where?, target?, line, from}` with `kind ∈ {person, route, pressure, consequence}` and `line` at most 120 characters clipped at a word boundary with an ellipsis. Sources are material already in the capsule: `present[]` (wants, would_lie_about, voice; `can_hand` names up to two undiscovered known clues), open/ready `where.exits`, `mods.thread.next`, `mods.pacing.threat_clocks[].next`, core `pressures[]`, canonical `obligations[kind=continuation]`, and last turn's receipts (a failed non-dice roll or an NPC stance change). Continuation offers use `from: obligations`, without recreating a base rule-pressure row. Order follows the existing beat order; a consequence still owed keeps a seat during candidate selection even when the other pools fill all three slots. The existing 2048-byte director budget and offer-first trimming policy remain separate and unchanged. No model call or judgement of prose is added.

**Implementation decision (2026-09-14).** An actionable clock-pressure offer carries `target: {threat, clock}`, using the source's readable names. The producer derives it from graph/world projections, the capsule carries it unchanged, and adoption matches both names against an ordinary `apply threat` receipt using existing normalization, never display text or prefixes. A selected clock is counted once as `pressure:<threat>/<clock>`; repeated receipts do not duplicate adoption. Person/route targets keep their existing `who`/`where` semantics and `person:`/`route:` keys. The all-material offer ledger retains its distinct scope and `clock:` namespace while sharing narrow clock-target matching/key construction. Historical target-less capsules remain readable and closable but cannot gain clock adoption by parsing their prose; records are never rewritten. Three ends remain explicit: projections write targets, capsule/adoption read them, and the Keeper acts through canonical receipts. Telemetry never feeds obligations or quotas into a later capsule.

**34.4 Structural signals, no semantic classifier.** `signals()` adds `empty_turns` (consecutive played turns with no receipt at all), `repeat_input` (this input equals the previous, trimmed, character for character) and `previous_close` (`implicit`, `explicit`, or `none`). The Director graph adds `scoring-rule:recover:empty-turn` (0.53, chosen so its weighted score stays under the stalled PRESSURE band in every authored structure — one quiet turn does not overturn the pacing doctrine), `scoring-rule:recover:repeated-input` (0.85) and `threshold:recover-empty-turns` (1). No code reads the meaning or the length of the player's words; the authored `player-signal:low-agency:*` vocabulary stays unread until a model populates it, and no keyword list or regex may.

**34.5 How a turn closed.** `table.narrate` accepts `implicit: true` from the host; the turn record carries `closed_how: "implicit" | "explicit"` (an `ask` is always explicit) and `capsule.recent` rows carry `closed` and `receipts` (the count) when the record has it.

**34.6 The floor steer (host).** When the Keeper ends on prose having called no COC tool this turn, on any turn but the opening, the host drops that draft, sends one `coc-host` steer of kind `floor` naming `director.offer` and the four kinds, and records `{lane: "floor", turn, steered: true, round_trips}`. The second leg is honoured however it comes: an explicit `narrate`, prose closed implicitly, or nothing — in which case the dropped draft closes the turn as before, so the steer is strictly additive. A turn in which any tool was tried, refused or not, is not steered. The steer shares the turn's single steer budget with the pending-choice steer.

**34.7 Fix texts point at receipts.** The combat `needs` refusal for a person with no stat block no longer offers "narrate the exchange without dice"; it names the two lawful routes (pin a stat block with `lookup catalog` and `apply npc`, then `resolve` again; or `resolve` an uncontested attempt) and says that nothing without a receipt has happened. A fix text is executed literally by the Keeper, so none may point at a world change without a receipt.

**34.8 Packages.** `narration-craft` 1.2.0 (floor as craft, the routine-turn warning back as craft, `density_guide` `off` | `on` default `off`, the ranges as an expectation the kernel never counts); `keeper-pacing` 1.1.2 (the two structural RECOVER signs and the offer ladder). The per-turn brief ceiling of §30.7 (4000 bytes for all briefs; 5000 since §40.6) stands; both briefs were rewritten densely to fit. Old versions keep their bytes and locks (§26).

**34.9 What stays.** The seven verbs and `narrate`'s single `text`; `ask` mechanics-only; the verifier's four kinds and `narration-audit`'s receipt remit; no fifth "too little" finding, no literary grader, no character quota as a gate; the frozen oracle untouched — `ts-kernel-read.test.mjs` projects the new signals, because-lines and the live digest out before comparing.

**34.10 A stat block for a person the book never gave one (2026-09-11).** On table B the player attacked Knott; `resolve` refused for want of a stat block, the Keeper pinned Fighting and Dodge with `apply npc skill`, and three more `resolve` calls refused the same way: a skill pin feeds skill checks, and combat compiles a whole profile (STR, SIZ, DEX, CON; HP, damage bonus, build, MOV; skills; weapons). The rulebook data already authored `content/rulesets/coc7/rules-json/npc-stat-archetypes.json` — `ordinary_adult`, `capable_adult`, `dangerous_actor`, each a range per characteristic and skill, "for upgrading persistent silhouettes only when rules interaction requires it" — and nothing read it. Three tiers now, in this order. (1) The book: a `mechanics.profile` on the node, extracted at build or deep-read on demand (`lookup kind=source`), is authoritative and cannot be replaced. (2) The rulebook archetype: `apply npc` accepts `archetype`, one of the table's ids; which tier fits is the Keeper's judgement from who the person is, never a table's, and the kernel rolls each characteristic and skill inside the archetype's range with the turn's seeded dice (`kernel-ts/apply/archetype.ts`), derives HP, MP, SAN through `derived-attributes`, DB and Build through `damage-bonus-build`, MOV through `movement-rate`, and writes the profile to `world.npc_profiles[<handle>]` with `authority: table_pinned`, the Keeper's `why` and `pinned_turn`; the `npc` receipt carries `profile` (archetype, characteristics, derived, skills). The pin is made once for the campaign; a second one is refused, and so is a pin for anyone whose numbers the book prints. (3) Nothing else: there is no synthesis from a name, a trade or a description. `SettleContext.npcProfile` reads the book's profile first and the pinned one second, so combat, opposed checks and `look focus=npc` all see the pin; `presentOpponents` follows. The two combat refusals now say so: `needs` with `field: "archetype"`, `options` the table's ids, `fightable` the present people who already have numbers, and a `fix` that names the pin, the source read for modules with a book, and the receipt law — the old `lookup catalog` hint is gone, because the catalog is the monsters chapter. Tests: `tests/kernel/test_npc_archetype.py`.

**34.11 A fight against someone faster now opens (2026-09-11, table F).** With Knott pinned as `ordinary_adult` the investigator's opening `resolve` built the session, put Knott first in DEX order (62 against 60), and then fell through to the "it is steven-knott's turn" refusal: the unsaved session vanished with the failed call, the start receipt with it, and the Keeper's next call for Knott met "no combat is underway for steven-knott" — twenty-eight refusals in one turn, nobody able to act, a fight that could never start against anyone faster than the investigator. `executeCombatResolve` now keeps a freshly opened exchange whose first action is not the opener's: the session is saved, the `session` start receipt lands, and the result returns `action: "open"`, `turn_of: <first actor>`, the initiative order and a hint naming the next call (`resolve with actor: <first>, intent combat, a target and a weapon`); the opener's own strike comes when the order reaches them, re-declared then. The engine's own turn-order refusals are unchanged for every later call. Alongside: `read/session-view.ts` (chase readiness) and `sanity/index.ts` (an NPC's SAN loss) read a pinned profile beside the book's, as `SettleContext.npcProfile` already did. The NPC-*opens*-a-fight case of §32.9 (surprise, an ambush) is still not a decision the rules layer carries. Test: `test_a_fight_against_someone_faster_opens_and_hands_them_the_first_action`.

**34.12 The refusal budget (2026-09-11, user ruling: three refusals of the same problem and the retrying stops).** Table F ran twenty-eight refusals in one turn — seventeen `turn_state`, eight `needs` — each retry reworded, so the host's identical-resend guard (§8: the third *unchanged* resend is blocked) never fired, and the turn ran to its 300 s cap on the Keeper's re-planning. The host now counts refusals by **class**, never by parameters: the tool, the error code, and the structural field the kernel named (`details.turn_of`, `details.needs.field`, `details.reason`, `details.field`; nothing read from the prose). The third refusal of one class shuts that tool for the rest of the turn; eight refusals of any class shut `resolve`, `apply`, `look`, `lookup` and `recall`. `narrate` and `ask` are never shut. A shut tool's call is blocked before it leaves the extension with the count, the last refusal and the closing rule — nothing refused has happened; close the turn with narrate on what landed, or hand the player the pending choice with ask — and a telemetry row `{tool, ok: false, code: "blocked", reason: "refusal_budget"}`; the moment a limit is reached leaves `{lane: "refusals", reason: "class_limit" | "turn_budget", count, last}`. Everything resets with the next player input. Test: `gates.test.mjs` "同类拒绝三次".

**A strike is an attempt, not a call (2026-09-12).** A class takes at most one strike per model round trip: calls the Keeper wrote in one message are answered after it wrote them, so the second and third of a batch are not it ignoring the first refusal — it never saw one. The host records the round that issued each call (`turn_start` is the round counter) and skips the increment when a class is refused again inside the same round; the refusal is still recorded, still read back, and still counts toward the eight-refusal turn budget, which is a cost valve and keeps counting calls. A Keeper that reads a refusal and tries the same class again in its next message is still shut on the third such round. Masks, Bar Cordano: three first impressions — Larkin, Mendoza, Elias — in one message, all refused `not_here` because an imported book's people are staged in the turn they are met, and the third answer shut `resolve` for the turn; the Keeper staged all three correctly one call later and could no longer roll, delivering three NPCs and no mechanics. Test: `gates.test.mjs` "一条消息里的三次同类拒绝只算一次".

**34.13 The inline marker is not out-of-game text (2026-09-12, regression from §34.1).** §34.1 folded "tool names, English enum values and field names" into the immersion principle as things that must not enter the story text. That sentence reads over the `{{marker}}` the narrate description asks for — a marker looks exactly like a field name written into the prose — and on the App's model (deepseek-flash) the Keeper stopped placing them, so every roll, clue and item card fell to the end of the turn instead of being drawn where it happened (§16.6's `marked_text` is empty when no marker is bound). Law 4 now names the marker as the one machine token that belongs in the text, says the kernel strips it before delivery, and points at the Writing paragraph; Writing states the rule affirmatively for the first time in the base prompt, which until now carried it only in the `narrate` tool description. Nothing about what the player may see changes: markers never reach them.

**34.14 A marker is a rendering hint, not a reason to refuse (2026-09-12).** After §34.13 the Keeper placed markers again and the player read them as text: `{{scene:corbitt-house-ground}}你站在人行道上…{{clue:nailed-windows}}`, twice in one turn. Two faults met. The kernel's `bindMarkers` threw `unknown_marker` when a marker named no receipt of the turn — and the Keeper had narrated an `apply` that was refused, so every marker named nothing. The host, on a refused *implicit* delivery, returned without replacing the assistant message, so the raw draft stayed on screen, and the Keeper wrote it again. Both are repaired. `bindMarkers` now returns `{placed, unknown, duplicate, text}`: an unknown marker and every repeat after the first are removed from the text, the rest stand, `rendered_text` is always stripped so no brace can reach the player, `marked_text` carries only bound markers, and `narrate`/`ask` report `dropped_markers` `{unknown?, duplicate?, markers, note}` so the Keeper learns without spending the turn. `unknown_marker` and `duplicate_marker` are retired as refusals. The host drops the text blocks of a refused implicit delivery: a refused delivery is a turn that did not happen, and `agent_end` steers it closed. The `narrate` description and the base prompt now say the names come back in each tool result's `markers`, and that a dropped marker means that mechanic never landed. Tests: `test_markers.py` (dropped, first-placement-stands, all-miss-still-delivers), `turn.test.mjs` (no draft on screen).

**34.15 A starting weapon could not be named at creation (2026-09-12, table G).** The player brought a .38 revolver and a single-shot sleeve derringer. `setup.draft` refused eight times on `weapons must use existing rulebook profile names`, and the Keeper gave up and put both guns in `equipment`, apologising to the player in the prose that "this version's weapon list only accepts its own names". Two faults. `validateProfile` accepted only an exact key of `weapons.json` — the ASCII slugs `revolver_38`, `knife_small` — while `apply item weapon` has always taken the id *or* the printable name (§19), so one table taught the Keeper a convention the other refused; and a Keeper drafting in the play language never writes either. Worse, the refusal named no legal value: the same `details` ships `skills`, `occupations`, `backstory_fields` and the aptitude vocabulary, and shipped nothing for the hundred and six weapons, so there was nothing to read and nothing to correct towards. Repaired in `kernel-ts/setup/drafts.ts`. One index, built whole from the table and keyed by both the id and the printable name, is what validation checks and what the sheet resolves through — what is accepted is exactly what can be written, so no draft can pass the gate and then fail to build. The card takes the printable name: a profile reached by its id is never written onto the sheet, or into `equipment`, as `revolver_38`. The refusal now carries `details.weapons`, the printable names, narrowed to the era the draft names (advisory only — which era's entry is legal here has not changed) and falling back to the whole table when the era matches nothing. The issue text names `details.weapons` and says where a weapon the rulebook does not print belongs: out of `weapons`, into `equipment` under the name the player used, which is where the object lane registers it. Nothing promises the Keeper that parameters will arrive — that depends on an active package, and a fix text is executed literally (§34.7). Tests: `test_a_starting_weapon_is_named_the_way_play_names_it`, `test_a_weapon_the_rulebook_never_printed_is_refused_with_the_profiles_and_a_place_to_put_it`.

**34.16 A closed turn's run is cut at the sixth blocked call (2026-09-15).** After `narrate` closes a turn the host blocks every further tool call of that run with "the turn is closed, waiting for the player" (§34.12's `blocked`). On the merged 0.9.3a of 2026-09-15 grok-4.6 did not stop at that answer: 178 blocked `look`/`resolve`/`apply` calls in seventeen minutes after one opening, the run never settled, and the driver's next player input timed out waiting for idle. Now the host counts blocked calls per run (`blocked_after_close` on the telemetry row): from the third the block's reason is the firmer "The turn is closed and the player has the move. Call no tool and write nothing more; the next player input opens a new turn.", and at the sixth the host records `{lane: "runaway", turn, blocked: 6, aborted: true}` and aborts the run through the extension context. The count resets at `agent_start` and with the next turn. Nothing refused has happened; the turn stays closed as it was. Test: `gates.test.mjs` "回合关了还在连番调工具".

## 35. Turn illustrations: the message-action illustration lane (2026-09-12)

The transcript's message action bar gains a third action beside Copy and Create branch: illustrate. It is a host control exactly like the portrait mount (the §22 host decision): no kernel RPC, no turn, no receipt, no Keeper involvement, nothing enters the offer ledger, and the kernel never reads, writes or validates the image. Clicking it illustrates the Keeper narration on that row, from that row's own text, and mounts the image at the row's top right with the text wrapping it.

**35.1 The three ends (§31).** Producer: the `illustration.generate` lane, on a player's click only — never on a turn commit, or the campaign directory would fill with images nobody asked for. Projection: `illustration.list` / `illustration.get` reads behind the row's image mount, plus the `illustration-changed` push that tells the row its job has settled. Adoption: none, by design — the image is decoration for the player's eye, like the portrait; no Keeper lane, kernel read or validation touches it, and it is never game state. A product that later lets the Keeper see its own illustrations names that lane in this section first.

**35.2 The lane shape: answered early, pushed late.** `illustration.generate {messageId, text}` is handled by the live agent (`pipicoc/illustration.ts`). The invoke answers `{status: "generating"}` at once — the host's ext-invoke ceiling (15 s) cannot hold a two-stage image run — and the job's end arrives as the `illustration-changed` push `{messageId, status, code?, reference?}`. The row then reads the image with `illustration.get {messageId}`; a session that mounts the transcript reads what already exists with `illustration.list`. One job per message row: a click while it runs re-answers `generating`; a click after it lands regenerates and overwrites. Amended 2026-09-12 later: a restored session spawns its agent lazily, so "live" is made, not assumed — the host intercepts the three methods: `illustration.list` / `illustration.get` fall back to the campaign's own folder when no live agent answers (the same files the pack wrote; reads never spawn a process), and `illustration.generate` first `ensure`s the session and waits one `get_state` round trip — the same spawn a first prompt would pay — so the pack's lane answers instead of refusing `no_session`. Cold generation still never happens: the image is always the mounted agent's lane.

**35.3 The image prompt is written by a tool-enabled lane, never by the renderer and never inline.** Per the text-work ruling, a pi child with `read,write,edit,bash` (the `mod` runtime task, its instruction `content/setup/illustration-prompt.md`) reads `scene.json` — the narration text verbatim, the play language, the investigator's visual description and era from `table.view` when a table is bound, and whether a portrait reference will ride — and writes `prompt.json`: one English image prompt with cinematic composition (shot, framing, light, mood), the protagonist's place and gesture in the scene, the people and positions the text gives, the era the text shows, no text or watermark. Up to two rounds against deterministic validation; attempts stay under the campaign's `illustrations/attempts/` as evidence.

**35.4 The image call, and the protagonist's face.** The dispatch is the image-gen extension's host reuse (same credential resolution as `image_gen`; an explicit image-model choice wins, grok-build the default), exactly as the portrait mount does, at a 3:4 frame. When the campaign has a portrait whose bytes fit the 400 KB reference limit, the call is an *edit* with the portrait as the reference image — the player is the protagonist and should look like their card. An oversize or absent portrait is reported (`reference: "used" | "dropped-oversize" | "none"`) and the call is a plain generation; the prompt still describes the protagonist from the card's own description, so the figure is right either way. This is not a lane switch: the model and credentials are identical, only the reference is dropped.

**35.5 Storage.** `<coc-home>/campaigns/<id>/illustrations/<file>.<ext>` plus `index.json` mapping the message id to its file — one image per illustrated row; regenerating overwrites. Not campaign state, not a receipt, not evidence; a branch's rows illustrate independently because entry ids differ per session. Deleting illustrations never touches the campaign.

**35.6 Failure and words.** A failure leaves the row bare: the push carries the code (`table_not_open`, `campaign_not_open`, `prompt_unavailable`, `illustration_unavailable`, …) and the row's captions are message-actions words (§23: `illustrate`, `illustrating`, `illustrate_failed`, authored in English, projected per tag) — no authored strings in code. The button shows on Keeper narration rows only — an assistant row with prose, on a pipicoc session bound to a campaign, not while a turn runs — sized and styled as its two neighbours; while a job runs the row shows a busy frame in the same mount. Amended 2026-09-12 later: a mechanics turn is a narration row too — its prose lives in the presentation's `marked_text`, so the affordance and the lane's input text ride the same content Copy uses, and the mount floats at the top of the presentation's own article. A bound session is recognized by "not `unbound`", never by `status === "ready"`: the cold graph answer carries neither `status` nor `campaign`, and gating on them hid the button on every restored table (found on the first real click).

## 36. Story continuity and adaptation wire contract (implemented, 2026-09-12)

This section records the implemented wire contract. Production is kernel-ts only and the seven Keeper verbs remain unchanged.

### 36.1 Continuity lookup

`lookup` accepts `kind: "continuity"`, optional semantic `query` and `anchors` (entity, clue, or conclusion names), and bounded `limit`. One pure builder supplies both this lookup and `mods.thread.connections`; there is no new top-level capsule. With no anchors, use the current scene, present NPCs, and recently acquired clues. The base lookup is always available, including when craft Mods are off. It returns bounded relevant concluded support chains as well as active ones, with acquired/undiscovered flags, actual relation and source evidence, full delivered-text references, labeled memory hypotheses, and explicit truncation/missing information. It does not require comprehension flags, meaning regexes, counters, or a per-turn model call. The Keeper may clarify known relations or enact sourced NPC initiative directly, including when stalled and empty turns are zero.

### 36.2 Adaptation preparation

`lookup` also accepts `kind: "adaptation"` with `action: "prepare" | "status" | "cancel"`, semantic proposal `name`, natural-language `request`, semantic `anchors`, and optional `retry` and `rebase`. The host runs an asynchronous task through existing `runtime.runTask`, using `read`, `write`, `edit`, and `bash`: a fresh creator is followed by an independent reviewer. Pending responses are honest service notices with bounded foreground waiting; there is no filler or auto-accept. Craft packages receive new versions; the base lookup remains available. Host-only `adaptation.prepare/status/draft/review/fail/cancel` messages are not Keeper verbs.

**`status` reuses the one adaptation surface and takes an optional `name`.** With a name it keeps its current behavior exactly. Without a name it returns the most recent retained current proposal for the bound campaign whose status is `pending`, `reviewing`, `ready`, `failed` or `stale`, reported under its semantic name; `accepted` and `cancelled` proposals are settled, not recovery work, and are never returned this way. When no such proposal is retained it returns status `none`. The no-name form exposes only the semantic name and status already visible to the Keeper: it never returns hashes, digests, task keys, attempt generations, or retained task/work paths. It opens no foreground wait and starts nothing.

**Cold-resume recovery routing (host-owned, no model call).** On each explicit player input, if the host has no in-memory `preparation_wait`, it asks this no-name `status` once. A retained `pending`/`reviewing` proposal restores `preparation_wait` exactly as before (the host keeps the same retention rules across later inputs). A retained `ready`/`failed`/`stale` proposal instead restores a short host-owned adaptation control state that blocks ordinary Keeper tools until the Keeper calls `lookup kind adaptation status` with the supplied semantic name; that explicit result clears the control and allows accept/continue or a same-name retry. The host never calls a model to discover this, and never infers it from prose.

**Several retained proposals are unexpected but possible after failures.** When more than one is retained, the host chooses the newest deterministically by creation time and then by semantic name. This is recovery routing only: it neither accepts nor retries a proposal on its own, and it adds no new Keeper verb, no second registry, no opaque identifier, and no inference from narration.

Every task retains draft/review artifacts outside canonical campaign state. The kernel issues an opaque identity and pins source digest/generation, worldline, meaningful current world/party/turn state (including within-turn receipts, pending decision, and player input), and base history. **Implementation decision:** internal job completion carries a runtime-owned numeric attempt generation as well as the job key, preventing a replaced worker from finishing or failing a newer attempt. Creator output includes changes and explanation; deterministic normalization precedes review. Review covers every change and says it is supported; uncertainty, unavailable evidence, or failure is not ready. Draft and review digests bind together, while source provenance and campaign provenance remain separate. Full original source, accepted effective view, world, party, all relevant delivered records, and acquired handout text are files available to the tools; a two-delivery preview is never sufficient. There is no raw-provider drafting and the kernel does not decide semantic contradictions.

### 36.3 Closed operations and apply

A ready reviewed proposal is accepted by `apply` with an `adaptation` effect naming it, as a dedicated one-effect batch. Acceptance creates only a Keeper-only adaptation receipt and domain event: no dice, movement, clue, NPC presence, or time. Later ordinary effects use existing authority admission. Stale source/state/worldline or within-turn revision, cancellation, failure, missing review, or replay is rejected before world writes; replay of an already accepted call is idempotent. Unsolicited evidence is not a new voluntary PC action; existing `not_player_action` classification applies, with no blanket bypass of source gates.

The closed operations are: `scene` (adapt description/display name of an existing unvisited source scene), `clue_at` (additional discoverable-at binding for an existing clue), `route` (route-to between valid scenes), `add_scene` (minimal venue anchored to an existing source scene), `add_npc` (minimal supporting person anchored to source, with no model numeric mechanics), `npc_knows` (sourced/reviewed causal knowledge binding), and `handout` (campaign rendition of a source handout, text in `play_language`). Every operation has a reason and source anchors. Runtime mints added IDs. There is no generic JSON patch, delete, arbitrary property or rule/stat rewrite, duplicated unique identity, source-essential retcon, or invented PDF evidence. Canonical clue identities, acquired items, and original handout text remain. Definitions do not imply presence or discovery; original causes stay fixed and unseen material is not freely mutable. Semantic review protects public relied-on facts beyond deterministic structural checks.

### 36.4 Effective view, source refresh, and worldlines

`world.adaptation` stores the accepted revision/source snapshot reference and append-only accepted records. Immutable source snapshots are retained content-addressed outside mutable campaign source and never overwrite shared publication. `loadCampaignModule` derives the single effective view for every play-facing consumer: reads, writes, resolve, memory/verifier, Mods, graph, and worldlines. `loadModule` remains canonical-only for source reading, setup, and publication. Effective material/assets resolve added names through source anchors and accepted renditions; no global gate is removed. After shared source refresh the accepted view stays pinned; an explicit reviewed rebase switches to the latest source only at a safe start-of-turn boundary, preserving the old view meanwhile. Originals are never mutated.

Accepted adaptations are worldline-local and restored through existing fork/switch/rewind history. Identical revisions may merge. Divergent adaptation sets refuse before merge writes, naming semantic differences and the supported limitation; no automatic union, reconciliation, or new dispositions are introduced.

### 36.5 Validation and acceptance scope

Validation covers current TypeScript RPC and extension seams: acquired-all-supports, busy receipts at stalled=0, no quiz or free new secrets, older public context, stale within-turn acceptance, review coverage and digest binding, cancellation/replay/restart, source refresh/rebase, cross-campaign isolation, handouts, added entities and valid clue resolution, worldline restore, and divergent merge refusal. The real-play lane uses one main session and one player with the same driver, one utterance per turn to a natural ending or real blocker, with Keeper `deepseek/deepseek-v4-flash`; no Astra or Grok and no fixtures presented as gameplay. The unfamiliar-with-source human UI gate remains explicitly pending until actually performed. Integrated full suites and final cold-load evidence remain pending.

### 36.6 Current implementation decisions and evidence (2026-09-12)

**Cash fractional repair decision (2026-09-12).** `CashEffect.delta` is a JSON number: the kernel accepts nonzero finite decimal numbers as well as existing integer/bigint values. Money arithmetic uses exact base-10 coefficient/exponent arithmetic; it never adds or rounds player budgets with binary floating point. Existing whole-value number/bigint storage is preserved. Fractional before/after/delta values persist as `PythonFloat` only when the canonical decimal survives serialized numeric representation unchanged; an unrepresentable fractional result is rejected before any write rather than rounded. This adds no currency table, forced two-decimal precision, dependency, UI, or rounding policy. Existing `subject`/`with`/provenance, overdraft rejection, staged-batch atomicity, receipts/mechanics/events, idempotent replay, and kernel bookkeeping authority remain unchanged. Regression coverage includes 2.50 debit, 0.50 refund, repeated `0.1 + 0.2`, persisted balances and receipts, replay, overdraft, invalid nonfinite/zero values, and integer/bigint compatibility. The cash worker is complete: the focused new RPC test passed 1, the existing TypeScript cash controller module passed 8, and kernel typecheck passed. Primary analogues: [ECMAScript `Number.prototype.toString`](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-number.prototype.tostring) and [JSON Schema validation §6.2](https://json-schema.org/draft/2020-12/json-schema-validation#section-6.2).

- Implementation is present: shared continuity lookup/thread connections; closed adaptations with immutable original-source snapshots, fresh tool-enabled creator and independent reviewer, ready-only acceptance, stale/cancel/replay handling, effective loading across all play consumers including NPC journal, source rebase, and worldline conflict refusal. Exact decimal cash remains kernel-ledger authoritative. Recent acquired clues retain distance0; source roles and unknown causes remain explicit in `story-thread1.1.3` and `keeper-pacing1.2.2`, within the existing combined reminder byte budget. A rejected NEW stale request is distinct from idempotent replay.
- Validation: integrated full extension suite830 passed before the final one-line source-priority/craft repair; afterward focused source/host/language26 passed, Python thread/budget17 passed after repairing one budget failure, kernel typecheck and runtime build passed, and cash focused RPC1 plus existing TS cash module8 passed. Human UI acceptance remains pending; earlier Python1228/3-failure results are historical, not current full-suite success.
- Live runs used `deepseek/deepseek-v4-flash` only. `continuity-live-v2` turn4 clarified public facts/hearsay/unknown links at stalled=0/empty=0 with no receipts/time/actions. Campaign `continuity-venue-live` accepted Atlantic Hotel+route through fresh creator/reviewer and ordinary move and survived restart. RUN `continuity-venue-refund` is campaign turn7: cash before6 delta0.5 after6.5, no extra night; campaign turn8 recalled actual turn0 hospital information; the unnecessary recall check was refused: “no skill or characteristic found”.  The interrupted campaign turn9 was cold-recovered by run `continuity-venue-integrated` with retained move/roll/NPC receipts without duplicates; campaign turn11 delivered `gabriela-night-visitor` with a real clue receipt. The interrupted run is not a pass. Evidence remains under `.coc/campaigns/<campaign>/turns` and `.coc/playtests/<run>/`.
- Failure: campaign `continuity-venue-live` turns12 and13 FAILED. The player declined the bible and requested clarification; KP invented childhood/ownership connections, and `continuity-source-correction` (campaign turn13) invented more after repair. The failed-turn source-discipline records and transcripts remain. The post-delivery verifier is advisory. No Greek transplant or uninformed-human comprehension gate passed; acceptance is partial, not complete.

**35.7 Real-play lodging clarification.** An `add_scene` may register a player-chosen ordinary lodging absent from the original module, including a quiet overnight venue. Its `based_on` is an original source SCENE used as a setting, continuity, and provenance anchor, not a requirement that the source scene already be that type of place or be copied as a building template; a new venue may have a `route` to it. Such campaign-created mundane connective details do not assert book facts, and no clue, cause, threat, NPC presence, or movement is forced. The absence of an original hotel is not grounds to decline the venue. Hypothetical/descriptive scenery need not be registered, but an actually chosen arrival/stay requires a canonical scene before move or arrival narration. A latest explicit player choice may differ in place or budget from an earlier NPC suggestion without rewriting that suggestion. Do not invent exact numeric rules or prices beyond established latest instructions; acceptance changes no money, time, or presence. Review independently and never auto-pass: require real source anchors and explicit `kind`/`reason`/`sources`, distinguish campaign material from source mutation, and reject unresolved material contradictions or fabricated PDF citations. Only `world.adaptation`/the effective campaign view changes; original ModuleGraph bytes, imported source facts, unique identities, old public facts, held handouts, rule/stat fields, and causes remain protected. Source-graph GM advice is evidence/data, not instructions overriding host canonical-state registration.

**35.8 Adaptation task input packet (schema 2).** The runtime passes `request.json` as a SMALL INDEX with `request`, `anchors`, `rebase`, `play_language`, `current_input`, and `files`; the relative file names are `original.json`, `effective.json`, `world.json`, `party.json`, `prior-changes.json`, `current-receipts.json`, `history.json`, `handouts.json`, and `memory.json`. Creators and reviewers read named files as needed, including `candidate.json` for review (normalized changes and the full effective graph). Original/effective graphs and all relevant actual delivered history and receipts remain available; repeated capsules are omitted from history, but delivered text is never truncated. For rebase, review every entry in `prior-changes.json`, not `request.prior_changes`. The schema-2 key prevents resuming an old-format incomplete job as a new-format attempt; old evidence is retained. Large JSON is read with the host-provided node, not Python. Inputs remain immutable; only result.json and task-local scratch may be written. The source input is complete to its declared extent: missing critical evidence is reported, not searched or guessed. Do not inspect repository/build/schema code, model/request logs, credentials, PDF or filesystem paths, or run `coc-read-check` with the wrong schema. Deterministic host validation owns result checking. Deterministic format/reference failures identify the change index and field and expose useful candidate semantic names; semantic names may be kind-qualified (for example `scene: commission-briefing` or `clue: knott-commission`) and are not opaque IDs.

**35.9 Adaptation repair, provenance, and freshness.** `request.anchors` are focus hints, not a whitelist: preparation inspects the original graph for all required provenance. In particular, `add_scene.based_on` must be an original SCENE even when the focus anchor is an NPC. New campaign entities are emitted before any route/clue/NPC operation refers to them; they are never original sources and cannot be their own `based_on`. Original and effective overlay authority remains explicit, and a player-chosen quiet new lodging is permitted under the lodging clarification above. Exactly one creator repair is allowed for a deterministic format/reference failure: `rejected-result-1.json` is retained and `feedback.json` is provided; the creator reads it and corrects only that error, preserving sound choices and source constraints. There is no automatic retry for semantic rejection, uncertainty, or reviewer failure. Per-run model and event files are retained. Both drafting and review prompt bytes are included in preparation identity and freshness checks; changed instructions invalidate unaccepted jobs but never rewrite accepted world state. Rebase reviews every prior change and the full relevant history. There is no new zero-tool lane; the flow is one bounded pass and then stops. The contract contains no raw private credentials or credential examples.

**35.10 Clarification source discipline and projection evidence (2026-09-12).** Clarification is craft policy: it connects evidenced facts, preserves source roles and unknown causes, and does not guarantee model behavior or add a hidden forced check or transition. The producer must retain source evidence and the projection must expose who experienced what and what remains unknown; adoption of a note receipt or memory hypothesis does not grant authority to invented module facts. The continuity venue live lane recorded a failed turn 12: after the player declined Vittorio's bible and asked to confirm already-public Gabriela testimony, the Keeper invented unsourced claims about Vittorio's childhood nightmares and his father's ownership, wrote the plan in an apply note, and had no clue receipt. This remains failed evidence, not a pass. Separately, continuityView now preserves the minimum distance for newly acquired clues rather than overwriting it with the current-scene distance, so the newest witness relation remains discoverable under the capsule budget; this producer/projection/adoption fix does not by itself prevent hallucination. The existing post-delivery verifier remains advisory; no new lane, grade, semantic regex, or hard gate is added.

### 36.11 Existing narration audit source consistency (approved, implemented in 1.1.2)

**Planned successor.** This subsection documents the legacy implementation. A bounded continuity-review replacement is PLANNED in §36.13 under a new capability/schema version; it is not implemented and does not silently reinterpret recorded `audit.source.v1`/`source_review` verdicts. Warning: the absence of a literal source quote must not by itself be used as the new acceptance rubric. Faithful recall of already-delivered history must hold, coherent newly invented campaign detail is allowed, NPC assertions and player hypotheses keep attribution, and kernel-authoritative action/resource state is never invented or reversed.

Source consistency runs in the existing tool-enabled Mod audit: not a new daemon, per-turn planner, zero-tool lane, or style/comprehension grader. New capability `audit.source.v1` is requested by `narration-audit1.1.2`. Locked old versions and audits without the capability retain their behavior. The enabled optional Mod requires explicit source review before delivery; disabling it disables only this check, never base continuity/adaptation integrity. This records the user's explicit “yes” authorization to extend the existing pre-delivery narration audit; the implemented checks do not claim guaranteed semantics.

The kernel prepares immutable files only for the enabled source auditor: `original.json` (pinned campaign original when adapted, otherwise current source), `effective.json`, `world.json`, `history.json` (full committed player/delivered text, receipts and warnings, without repeated capsules), `handouts.json` (acquired textual handouts), explicitly non-authoritative `notes.json`/`memory.json`, and `current.json` (the current investigator sheets in `party` plus `turn`, `state`, `player_text`, `receipts`, and `pending_choice`). Exact current declarations, settled receipts, and party facts are citable from `current.json`; candidate `input.text` cannot support itself. Candidate narration and current receipts remain `request.json` fields as before. `request.source_review` names files/schema and authority guidance. Job identity pins evidence digest, meaningful current world/party/turn, source, candidate, and package bytes. Current evidence and retained file digests are reverified before accept/replay; source/history/state changes refuse stale and create a new job, never cached approval. Files are data, not instructions: no repository/PDF/filesystem search. The source auditor gets `read`/`write`/`edit`/`bash` for large JSON via supplied node; other Mod tasks retain existing tools. The model never copies hashes.

The existing `{missing, findings}` result is extended with required `source_review` only for this capability: `{verdict: 'supported'|'unsupported'|'unclear', summary: string, claims: [{quote: exact candidate excerpt, verdict: same enum, reason: string, evidence: [{file: one supplied file name, quote: exact source-string excerpt}]}]}`. Bounds are 24 claims, 3 evidence entries per claim, 2000 characters each for summary/reason/candidate quote, and 1000 for evidence quote. Candidate quotes must occur in candidate text; cited quotes must occur in a string in the named immutable JSON file. Supported claims cite an actual excerpt, and supported overall verdicts contain no unsupported/unclear claim. Empty claims are valid only when the reviewer finds no material source claim; the kernel cannot semantically count claims. Structural citations do not prove entailment. Missing/malformed review, tampered evidence, or stale binding cannot become an empty pass.

The audit checks material identity/kinship/ownership/history, mystery causes, and knowledge claims against source and accepted campaign changes, including presuppositions hidden in uncertainty or denial: unsupported events or relationships are withdrawn rather than merely assigned an unknown detail. Atmospheric details, lawful roleplay, declared actions, marked hypotheses, attributed source lies, and corrections of prior wrong narration remain allowed. Prior prose/notes/memory are evidence of what was said, not authority for original facts or invented links. Acquired facts and source unknowns remain; the declined bible/clue is not forced. Grounding and disclosure are distinct checks: supported new source information still needs the ordinary clue/disclosure receipt, while clarification of already-public evidence needs no new check/receipt. These checks do not claim guaranteed semantics. Engineering provenance is never shown to players.

Explicit `narrate`/`ask` already use Mod prepare; implicit prose closure must use the same audit. Rejected implicit text is removed from delivery, retained as evidence, and uses the existing single steer for repair without reroll. A `audit.source.v1` timeout is unavailable review and refuses; timeout pass-through remains only for legacy audits without this capability. Failure/uncertainty never disables the Mod or downgrades its version. Unsupported/unclear becomes the existing `mod_narrative_repair` refusal with actionable claim/reason information: no rewrite, clue/actor mutation, extra roll, or settlement. Preserve failed artifacts. Validation will cover source separation, full-history contradictions, authority, binding/stale replay, all verdicts, citations and semantic names, version/disabled behavior, timeout, both delivery seams, and recap versus disclosure. True play remains the existing driver/main session with one player and Keeper DeepSeek Flash (no Astra/Grok); human UI gate remains pending.

Precedent: [Anthropic](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-hallucinations) recommends explicit uncertainty and checking claims against source quotes, and [Microsoft groundedness](https://learn.microsoft.com/en-us/azure/ai-services/content-safety/concepts/groundedness) compares output with supplied material and exposes ungrounded segments. They support evidence-backed independent inspection, not blanket document literalism or service calls: atmospheric connective material, hypotheses, and sourced NPC lies are legitimate here.

### 36.12 Memory repair contract (implemented)

Memory candidates retain `valid_from_turn`; every continuity projection exposes it as `turn`. Only continuity `query`/`anchors` and `recall.memory.about` are semantic names; other lookup kinds retain their existing search semantics. Hypotheses carry `origin:memory_candidate`, while corrections are a distinct list with `authority:conversation_report`; memory is a report of past conversation, not module truth. Compact memory has `id/kind/subject/statement/turn/status/state/authority`; full hits also carry `source` and optionally readable `superseding`. Transcript `verified` additionally means `verification_scope: "record_integrity_only"`.

Normal extraction includes `correction_targets` when earlier candidates exist, capped at 30. A correction may select exact targets strictly earlier than its turn; the kernel binds them to retained ids, atomically, while the model never writes opaque ids. Existing corrections are linked through the same zero-tool lane; completed extraction jobs, raw statements, transcripts, and source/world/receipt authority remain unchanged. Corrections supersede linked reports; late-identical backfill remains superseded, and withdrawing a correction never auto-restores targets.

Startup/backfill reconciliation uses current-worldline jobs with ids `reconcile:<campaign>:t<turn>-<ordinal>:<runtime suffix>`; the suffix binds the job to its worldline and is never copied by the model. Jobs carry unchanged correction text and at most 30 ranked earlier candidates, and update links/status only. The existing single retry now passes deterministic validation feedback. Failed raw completions use existing backlog/telemetry rather than independent archival of every failure. No new memory database, semantic keyword classifier, or extra always-on model lane.

Wire details: only `keeper_correction` accepts optional `corrects: [{subject, statement}]`, at most 12 exact semantic references. The kernel stores their bound IDs on the correction, sets `correction_links_checked`, and marks targets with `status: superseded`, `superseded_by`, and `valid_until_turn`. Omission is unlinked legacy data; an explicit empty array records a checked target selection with no match. Unknown, self or future references reject the entire submission before writes. Reconciliation packets use `task: reconcile_correction`; `memory.job {job_id}` explicitly retrieves a retained reconciliation for retry, and `memory.submit` still rejects changed replay content. Source statements and completed original extraction jobs are preserved. Relevant corrections are ranked before reports; explicit old recall includes readable `superseding` content, while a correction itself never promotes a new module fact.

Observed validation: extension suite838 passed; final dedicated memory suite5/5 passed after worldline reconciliation was added; kernel memory module14 passed; adjacent memory/recall/worldline/transaction/capsule suite85 passed, with one expected transcript-schema assertion initially missing `verification_scope`, now corrected; the transcript module recheck passed all 4 tests. Final typecheck and runtime build passed. Real campaign `continuity-venue-live` startup/backfill reconciled three legacy corrections (4.601s total), and a fresh kernel read confirmed the links; no memories or raw transcripts were manually edited. Main-session recall/look evidence retained the childhood retraction, distinguished witness account from guesses, made no action/clue/roll receipts, and left clock 824. These observations repair the memory defects, not all hallucination, historical source error, Greek transplantation, or uninformed-human comprehension; the human UI gate remains pending. Evidence remains under `.coc/playtests/memory-correction-contracts`, `.coc/playtests/memory-upstream-live`, and `/tmp/pipicoc-continuity-impl.yh2FpS`.

### 36.13 PLANNED continuity-review repair (not implemented)

This is planned direction only; implementation and acceptance are pending. The authoritative execution plan is [story continuity and adaptation](plans/story-continuity-and-adaptation.md). P0 must finalize the literal capability/schema names before code changes. Use a new version rather than reinterpreting recorded `audit.source.v1`/`source_review` verdicts. Locked old Mod versions/jobs remain readable and immutable; adoption uses existing Mod configuration. Sections 35.11 and 35.12 still describe the existing implementation.

**Authority and review purpose.** Faithful recall of already-delivered history must not invent a previous statement, encounter or attribution. Compatible new campaign details are allowed without a literal module quote. An NPC assertion or player hypothesis retains attribution and is not automatically world truth. Retractions, player choices, receipts and kernel-authoritative state constrain continuation. The original module stays immutable as provenance, not as an exhaustive list of permissible fiction. Ordinary compatible detail needs no heavy adaptation job and persists through existing delivered history/notes/memory. Existing graph-adaptation capabilities and source-cause/unique-identity protections are unchanged.

Real settled consequences must remain perceptible without changed outcomes or numeric prose. Indirect sufficient realization passes; style, length, atmosphere and a prescribed description of waiting are not hard gates. This adds no comprehension score, forced clue, new Keeper verb, generic graph edit or automatic retcon.

**Writers, readers and action consumers.**

- The kernel audit producer and existing read projections write the bounded evidence packet. The private tool-enabled Pi auditor writes the semantic review artifact; static Mod policy supplies instructions, not verdicts. The host/kernel validates and binds submissions and retains review/attempt/budget records.
- The auditor reads the initial packet and targeted complete evidence. The Keeper reads actionable conflict findings; the host reads submission/error/budget status; the driver reads final settled delivery and timing. Existing memory extraction/correction writers and historical records remain in use.
- The Keeper responds through existing narrate/ask/apply/resolve. The auditor never settles world state or awards clues. The host terminates, repairs an artifact, or reports unavailability according to the result; the driver records the actual completed delivery.

**Focused input with complete fallback.** Reuse current scene/continuity/history/memory/object projections for current input, candidate and receipts; relevant established facts and corrections; actor/custody state; compact relevant object metadata; source relationships; and explicit coverage limits. Use structural references and semantic-name lookup, never keyword classification of open relevance. Full immutable source, committed history, acquired handouts, notes and memory remain available for targeted tool-enabled lookup. Do not silently truncate relevant older history or substitute the last two recaps for it.

Avoid loading duplicate original/effective content into the initial working context when identical. The archive may retain both immutable files for provenance; storage deduplication, migration and snapshot-format redesign are not part of this repair. Preserve independent legacy/queued equipment checks while reducing unrelated working-context bulk.

**Three distinct outcomes and their owners.**

- A material semantic conflict may request one bounded Keeper repair.
- A malformed review artifact is repaired inside the audit operation, without asking the Keeper to change fiction or reroll. Validation collects all deterministically discoverable format/reference errors in one response with exact paths, file, excerpt and expected shape where applicable. The targeted repair preserves the semantic verdict.
- Missing, stale or tampered evidence, execution failure, cancellation or budget exhaustion is unavailable, not a semantic verdict and not a pass. Preserve settled actions and rejected drafts. A refreshed view within the automatic chain consumes the remaining budget; it never silently grants another allowance.

**Checked submission and delivery.** Follow the existing private submit_reading/AgentToolResult.terminate pattern: structurally valid, freshness-bound submission ends that private agent immediately. Writing result.json alone is not completion and must not trigger blind process killing. Invalid submissions receive precise local feedback. Keep read/write/edit/bash and the current host task runner; no bare provider completion or Pi fork/patch. Passing reports are compact; material conflicts carry the candidate fragment and conflicting evidence. Runtime owns opaque bindings and records supplied/retrieved evidence scope; the model selects semantic references, never copied hashes or receipt IDs.

Explicit narrate/ask and implicit closure share the same review and remaining budget. Narrow delivery/retry/steer changes in extensions/kernel/index.ts may surface unavailability and prevent another automatic review cycle; neither rejected prose nor implicit closure can bypass the result. Freshness, cancellation, cold resume and legacy capability-absent behavior remain protected.

**Shared budget: proposed initial policy, not measured performance.** Normal review targets at most 6 private model responses. The entire automatic review/rewrite/artifact-repair chain targets at most 12 private model responses and 30 seconds of active foreground review, with at most one semantic Keeper rewrite and one targeted artifact repair. Host-enforced counts exclude human thinking and unrelated background work. Consumption is retained in existing job/attempt records across automatic retries and host restart; no new scheduler or database.

Repeated identical failure or no new candidate/evidence ends unavailable. A later explicit user-directed retry may start a separately recorded bounded attempt linked to its predecessor; automatic retries cannot masquerade as user retries or erase previous usage. Calibrate these initial boundaries with fixed-input trials before adoption. If they prevent useful completion, retain the finding and revise the plan explicitly; faster timeout is not success. No performance-settings UI is added.

**Version and validation gates.** Finalize a new capability/schema contract at P0; preserve recorded old behavior and optional-Mod semantics. Fix the driver's premature agent_end fallback before timing comparisons. Cover permitted improvisation, faithful recap, retained corrections, attributed rumors, forbidden state changes, adequate indirect narration, aggregate artifact errors, checked termination, both delivery paths, stale/tampered input, cold resume and shared budgets at existing seams.

All gameplay and model probes use DeepSeek Flash. Frozen-input probes are not live play; final play uses tests/play/driver.py with the main session as sole player, one natural utterance at a time, toward a natural ending or real blockage. Never stop or fail play merely because a compatible detail lacks a source quote. Initial targets are normal audit median at most 10 seconds and ordinary investigation-turn median at most 30 seconds; report sample count/range/median and unavailable results, and report dynamic adaptation/long reading separately. Correct cases must complete; small samples do not prove a p95 or universal semantic accuracy.

Prior turns 17/18 cannot be judged incoherent solely from missing source provenance. Their raw rejection records remain preserved and overall continuity acceptance is incomplete, not newly passed. Turns 12/13 included fabricated retrospective testimony explicitly withdrawn later; those corrections remain in force. Human UI acceptance remains a separate pending gate. Sources and the full acceptance matrix are in the authoritative plan.

### 36.14 Continuity audit v1 implementation contract (implemented; live validation in progress)

The new capability is `audit.continuity.v1`, contributed by `narration-audit` 1.2.1 with the protocol-aligned `enhanced-items` 1.1.9. The current Mod version is `narration-audit` 1.2.16 (§37 records the causal-reentry pre-delivery enforcement, bridge authority, the two-stage `bridge_offer`, the deterministic reentry modes and the checked `relation` it refines; the placement/offer and acquisition/delivery stages are separated unambiguously, `mode: clarify_known`/`introduce_evidence` closes which bases may pass, and each reentry basis now carries the evidence's `relation`; the host passes `context.preparation_wait` only from its actual retained background state, and 1.2.9–1.2.15 retain live use and their historical meanings). Legacy `audit.source.v1` validators, retained verdicts and locked versions remain unchanged. The new audit uses the same Mod job/accept bridge, seven Keeper verbs and immutable evidence binding.

The result is `{missing, findings, continuity_review:{verdict:"pass"|"revise"|"unavailable",summary,conflicts:[{claim,reason,evidence:[{file,quote}]}]}}`. Existing missing/findings shapes remain. Pass requires no conflicts, missing objects or findings; revise requires an actionable conflict/missing/finding. Unavailable is not approval. Conflicts contain an exact candidate excerpt and at least one exact excerpt from a named retained evidence file; compatible new fiction does not need a source quote. There is no exhaustive list of positive proofs. Bounds remain 16 missing entries, 10 findings, 10 conflicts and 3 excerpts per conflict; summaries/reasons/claims are at most 2000 characters and evidence excerpts at most 1000.

The shared validator collects bounded format/reference errors as `{path,message,file?,excerpt?}` in `details.errors`, with reason `audit_artifact_invalid`; it never asks the Keeper to revise fiction for an artifact error. The private `submit_audit` tool validates the report against the pinned candidate/files and ends the agent with the supported terminate result. Final live freshness and input integrity remain checked by `mods.accept` immediately before use. Failure on submission permits at most the remaining one artifact repair in that same private session. Only a valid submission event, not the mere presence of result.json, constitutes completed execution.

The initial `context.json` combines compact receipts/actors/objects, active-scene and recently acquired relationships, relevant memory with corrections, and bounded recent delivery previews, all with coverage limits and full-file fallback. `request.json` preserves existing co-auditor context, while a `continuity_review` descriptor names the context/evidence files. The initial agent brief includes the focused context directly. The runtime records supplied/retrieved scope through the retained request and tool trace; the model never copies hashes or opaque receipt IDs.

The host receives an internal review-scope path under existing Mod job storage, bound to campaign, worldline, game turn and opened-at identity. A shared retained budget spans text revisions and artifact repair: initially 30 seconds active review time and 12 model calls across the automatic chain, at most 6 per private session, one semantic Keeper repair and one artifact repair. An in-flight reservation survives restart and cannot silently refund an interrupted run. Explicit new player input may begin a separately recorded retry after an unavailable result; automatic host steering does not reset the allowance. An unavailable result stops automatic review/steering for that run and is exposed as a service-status event, never as approved narration.

The reader command adds the private audit submission extension only for continuity jobs. The private adapter enforces the permitted model-call/artifact-repair limits before further provider work; the parent runtime enforces remaining wall time and retains attempt outcomes. Explicit narrate/ask and implicit closure share the budget and block state. An unavailable explicit tool result terminates its agent batch; implicit rejected prose is removed and cannot start another audit-repair steer. A later genuine player input permits a linked, budgeted retry without erasing settled receipts.

P0 driver semantics: resumed agent/turn/message/tool work clears any agent_end fallback timer. Delivered kernel text or a host delivery event takes precedence over raw assistant drafts; a rejected audit draft is not a fallback final response. Stale prior settles and timeout/cancellation retain their existing meanings.

Implementation decisions: a private agent that ends with no submission may receive exactly one in-session submit-only reminder, within its remaining allowance; it does not receive a fresh job or budget. Exceptions in Pi provider hooks are advisory, so budget exhaustion also calls context.abort. Recent history previews include prior player inputs with truncation markers so refusal/custody checks do not require schema exploration. Equipment-without-instance rows are assessment candidates, not registration obligations. Missing-object findings need an established mechanical basis; they cannot manufacture one from registry absence or make an unchosen transfer true.

The private read_audit_evidence tool provides pinned objects/history/memory/source views by semantic name or turn number. It makes no gameplay writes and adds no Keeper verb. Object lookup covers complete retained instances/definitions and executable sheet weapons; history returns prior input/delivery and compact receipts without repeated world snapshots. Empty matches include known names, and truncation is explicit with complete-file fallback. The evidence scope remains bound to the same job and is recorded in its tool trace.

Cold recovery consults the internal read-only `mods.review.status` before starting a Keeper recovery run. It returns whether the current versioned review scope is paused, without preparing another audit or granting a new budget. An absent budget retains normal legacy recovery; blocked, interrupted or unreadable review accounting suppresses automatic recovery and emits service status. Only actual new player input may retry the preserved turn. This prevents a restarted Keeper from applying more time/threat effects before rediscovering that review was paused.

### 36.15 Adaptation routing and foreground latency repair (2026-09-12)

The failure class is ordinary fiction being misrouted into persistent graph authoring, compounded by a synchronous wait over a tool-enabled creator and independent reviewer. A module-name miss no longer advertises adaptation unconditionally. `lookup kind module` accepts an optional `expected_kind` from the closed graph kinds; only an explicit `expected_kind: scene` miss returns a new-destination preparation. Other misses explain that ordinary physical objects use `define`/`object`/`item`, that compatible first-appearance NPCs and scenery may remain narrated campaign detail, and that a later recurring NPC can be promoted through a reviewed adaptation. No regex or language-specific semantic classifier is added.

`lookup kind adaptation action prepare` requires `purpose: new_destination | persistent_npc | source_rebinding | handout | rebase`. The kernel structurally validates the purpose against the closed change set: `new_destination` requires `add_scene`; `persistent_npc` requires `add_npc` and permits only `add_npc`/`npc_knows`; `source_rebinding` permits only `scene`/`clue_at`/`route`/`npc_knows` over existing entities; `handout` permits only `handout`; `rebase` permits no new changes. Physical items have no adaptation purpose. Creator and reviewer still decide open semantics from the player input and evidence; the kernel does not infer semantic categories from prose.

Each task starts with a bounded `focus.json`, and the same focus is inlined into the child prompt when small. It contains the current request/input, purpose, original anchor neighborhood, current source/effective scene, compact world/party/current receipts, recent deliveries, continuity/corrections, prior accepted changes, and explicit full-file fallbacks. A child reads a full retained file only for a named evidence gap and must not enumerate schemas or files. Original/effective/full history remain immutable and available. This is still a tool-enabled Pi creator followed by an independent tool-enabled reviewer; no zero-tool lane or auto-accept is introduced.

Each creator or reviewer run has at most six provider requests and 30 seconds. The single deterministic creator repair uses the same per-run limits. The foreground `prepare` wait defaults to 12 seconds. `status` is read-only and nonblocking; it never opens another wait. Pending returns an honest service status and retry guidance, authorizes no arrival/change, and the retained task continues in the background. Completion, failure, cancellation, freshness, acceptance and evidence retention semantics are unchanged. Existing accepted adaptations remain valid; incomplete jobs whose prompt/contract digest changed become stale rather than being relabeled.

Acceptance covers: a missing ordinary key gets no adaptation preparation; a first-appearance passerby can be narrated without graph mutation; explicit recurring NPC promotion and a player-chosen absent destination still enter the reviewed path; purpose/change mismatches fail before acceptance; focused children do not need raw-schema exploration in the fixed cases; `prepare` returns pending within its foreground bound; repeated `status` does not add another foreground wait; timeout/request exhaustion fails retained work without mutation. Measure creator/reviewer model requests and elapsed time separately from the Keeper and continuity audit.

**Scene commitment (narration-audit 1.2.8; carried from 1.2.7).** `active_scene` is a persistent gameplay locus, not physical coordinates. Spatial wording, distance, scale, entering/exiting, or crossing a named boundary never decides promotion. The only promotion test is whether a distinct place becomes the ongoing locus for subsequent player action or durable location-bound state: its own affordances, discoverable clues, NPC/object presence, or intended return. If yes it needs a registered scene and move; otherwise it is same-locus detail or transition and needs no scene. A new-locus choice routes through `expected_kind` scene, reviewed adaptation, acceptance, then move. Existing target handle/display/summary are projected into admission so a label cannot substitute a different persistent locus. Continuity emits `locus_review` using the same promotion test, with no physical-location exception list. This is one semantic test, not an enumeration of physical places: a door, balcony, cabinet, vehicle or other named object is promoted only when it becomes the ongoing context for subsequent player action or durable location-bound state, and the noun or its size never decides. The 1.2.7 heading was the first adoption of this rule; 1.2.8 is the current version and keeps the earlier descriptions as historical meaning.

**Pending-preparation turn ownership (narration-audit 1.2.8; settled-consequence seam 1.2.18).** When `prepare` returns pending with a retained background preparation still running, that retained work owns the rest of the turn. Every later Keeper tool except status/cancel and the closing `narrate` is blocked while the preparation is retained. If nothing has settled in the turn, that narration honestly says preparation is pending and must not imply that the refused action, destination, cost or elapsed game time happened. If `resolve`/`apply` receipts had already landed before the later preparation became pending, the opposite boundary applies: the narration **must deliver those settled consequences**, may say the additional source-dependent material remains pending, and must neither erase those receipts with “nothing happened” nor add facts the pending preparation has not supplied. The host instruction names the already-landed receipt lines so the Keeper does not infer which branch applies; on cold recovery those lines are rebuilt from each structured `table.open.pending_turn.receipts[].id` (with a JSON fallback only for malformed legacy rows), not lost with the prior extension process or collapsed to `[object Object]`. The ordinary `agent_end` floor must not restart or replace retained work, and the retained task's completion, failure, cancellation, freshness and acceptance semantics are unchanged from the accounting described above. The foreground `prepare` wait's pending status authorizes no arrival or change on its own; it also cannot erase a change that an earlier receipt already authorized. Retained campaign `game-e0877a4e-fde9-430b-b0d0-d22c8868ce5c`, turn 7, is the failed evidence: `move:Boston harbor steamship ticket office-t7-c2` landed, then `harbor-chapel-eye-rebinding` became pending, but the old wait instruction still said not to move or introduce the destination; the Keeper therefore delivered no fiction and the run ended only with `turn_unfinished`.

**Host-owned `preparation_wait` is retained across later explicit player inputs (retained live evidence; P5 in progress).** The retained state is host-owned, not a turn-local verdict: while the same background source/adaptation job remains pending or reviewing in the same live process, `preparation_wait` survives subsequent explicit player inputs. A new player input clears only review/admission attempt state (it is a new context, `current_input`, and any prior audit/admission attempt no longer outlives it); it must not clear a real preparation wait whose job is still pending/reviewing. Only an explicit status result — `ready`/`failed`/`cancelled`, or an explicit `cancel`/nonpending adaptation result — clears it. Until one of those arrives, only adaptation `status`/`cancel` controls and an honest wait-only `narrate` are allowed, and the continuity audit receives the same `preparation_wait`, so the `preparation_wait` defer remains available on every such turn. This does not add a second task registry and never infers waiting from prose; it preserves the existing host-owned state until the job reports a terminal/nonpending status.

**Adaptation job freshness (retained fix).** A pending job binds the material world, party, active worldline, source generation and existing adaptation (`pin = digest({world, party, line})`, plus `source_digest`/`source_generation`); it does not bind narration-only HEAD, the turn number, or player text. An honest wait-only narrate therefore does not stale a job, and a later `status` or `cancel` remains callable while it waits. `status` stays read-only and nonblocking, and a terminal status (`accepted`/`cancelled`/`failed`) clears the wait. Any material world, party, worldline, or source change still invalidates the job, and final apply admission still protects withdrawal: acceptance is subject to the current player's action-admission review, so a wait turn cannot smuggle a change the player did not choose. This matches the retained implementation and the earlier live pending-preparation evidence.

**Retained live evidence.** Turn 43 (time/notes followed by false Athens arrival), turn 46 (Boston Atlantic Hotel relabeled Athens), and fresh live turn 2 (ordinary departure overclassified) are retained as failed evidence that motivated the abstraction; they are not marked passed.

## 37. Midgame causal re-entry: reliable detection and a grounded bridge (core mainline and the extended `introduce_evidence` / `source_rebinding` / `bridge_offer` gate both genuine-play accepted)

The adaptation and continuity infrastructure of §36 is integrated. The midgame causal-logic mainline is implemented and its static/code status stands, and its core genuine-play acceptance is **accepted on the retained `midgame-reentry-live-20` evidence**: the prior primary-acceptance campaign `midgame-reentry-live-18` (runs `midgame-reentry-live-18b-run`, `midgame-reentry-live-18c-run`) has raw evidence that was accidentally deleted by a worktree closeout and is now `invalid-for-acceptance` as independently inspectable raw evidence — an operator evidence-retention failure, not a product pass — so the accepted result rests on the retained live20 chain (turn-2 acquisition of `globe-unpublished-story` through Ruth Blake's 1918 withheld Globe file after ordinary play; turn-3 stored `misframed` frame for `house-haunted-by-corbitt`; turn-4 under 1.2.15 the wrong-direction failure, kept as failed evidence, not a pass; 1.2.16's `relation` fix; turn-5 corrected candidate passed audit job `8a186efaaa015298f4da7e7a5182e3eda6a346d44ddff53ca6918ec211ef3396` and turn-6 `player_discharge` passed audit job `80d5601af739a1ebbc513820561c88561b8b460f75995d043755d55b755c8ecc`, storing `aligned` in `memory/story.jsonl` at commit `c3a0d29` without forcing the player into the house). The retained `midgame-reentry-live-19` run is a semantic-model failure, not acceptance. The reentry contract itself remains implemented: a midgame explicit `misframed` frame is assessed post-commit, the next turn projects a deterministic reentry mode, and the checked audit validates a permitted basis with the selected evidence's `relation`. Current versions are **story-thread 1.2.6** and **narration-audit 1.2.16** with DeepSeek Flash only, and the current retained evidence worktree is `/Users/haoli/leehow/code/chatrpgv4-wt-midgame-evidence`, which will be locked and retained and must not be closed or deleted. The extended `introduce_evidence` / `source_rebinding` / `bridge_offer` live gate remains **PENDING**: its contracts and static seams are implemented but no successful post-1.2.16 live chain through those stages was completed, so §37.5 item 11 remains unaccepted and the gate is tracked separately. This section is the versioned contract for the slice that closes the gap. Verified implementation, current 1.2.16 static validation (`npm run check:kernel` passed; targeted continuity/adaptation/audit/turn 59/59; targeted relation validation 11/11; full `npm run test:ext` 883/883 exit 0), earlier adjacent validation (targeted Python `tests/kernel/test_memory.py` + `tests/play/test_driver.py` 29/29 and runtime build passed before the relation-only change), and the retained genuine-play evidence are in [the midgame causal re-entry checkpoint](../research/midgame-causal-reentry-2026-09-13.md). Historical failed-evidence paragraphs remain preserved and are not rewritten by this checkpoint. **Superseded by §37.6 and §37.8 (2026-09-13): the extended live gate is now ACCEPTED on retained campaign `midgame-bridge-live-22`, and current versions are story-thread 1.2.7 and narration-audit 1.2.17**, which add the `authority_unavailable` basis for a placement the independent source review refused; version numbers named in the historical paragraphs below record what was current when each finding was taken.

### 37.1 Objective and constraints

A player may keep acting while explicitly misunderstanding the causal story, or may choose an ongoing direction detached from every unresolved core conclusion. The product must detect this semantically and act on it: connect the causal thread or its current stakes to the direction the player actually chose, without forcing the player back to a prescribed scene and without retrying an offer the player declined. Detection and action carry no keyword list, no counter, no new Keeper verb, and no new foreground model call. Ordinary exploration, jokes, quiet play, short replies, a one-turn side action, and informed refusal of the core thread are all valid play and must not become compulsory beats. A shallower refusal — of a commission, clue, route, destination, NPC request, or authored hook — is not informed refusal of the core thread.

### 37.2 Deep module and existing seam

Reuse the existing post-commit memory extraction lane and its `memory.job` / `memory.submit` wire (see §12.3). That lane remains the one permitted zero-tool short semantic lane; no new lane, scheduler, foreground call, or Keeper verb is introduced.

**`memory.job` gains a bounded keeper-only `story_context`.** It carries the unresolved core-causal thread candidates and the relevant acquired-evidence connections, plus the last current-worldline assessment. It contains semantic names only; no opaque ids. It is the same lane's existing task packet extended, not a second call.

```
"story_context": {
  "threads": [{"thread": "<semantic name>", "claim": "<one line>", "importance": "<authored tier>",
               "supporting": [{"evidence": "<semantic name>", "delivery_turn": n}],
               "contradicting": [{"evidence": "<semantic name>", "delivery_turn": n}]}]   (bounded),
  "last_assessment"?: {"turn": n, "status": "aligned"|"unclear"|"misframed"|"detached",
                       "thread"?: "<semantic name>", "bridge_delivered": bool},
  "truncated"?: bool
}
```

**Importance is authored, and candidate selection is causal.** `importance` is the tier the module authored on the conclusion; the kernel does not invent or upgrade it. Prefer `critical` and `core` conclusions: when any unresolved `critical`/`core` thread exists, `threads` supplies only those. When the module declares no `critical`/`core` conclusion, `threads` supplies only the highest authored tier present. Lower-importance procedure, hook, route, and presentation conclusions never displace a core causal thread. `supporting`/`contradicting` list only already acquired evidence, each with the turn it was delivered; `truncated` is `true` when this packet's own evidence was cut — a selected thread whose connection was dropped, or one whose acquired rows did not fit the compact projection. It is **not** true merely because the graph holds conclusions this packet did not select; that is the normal state, since §37.2 selects only critical/core threads (see §37.9). `last_assessment` is the latest stored assessment bound to the active worldline and loop; a mismatching worldline or loop yields no previous assessment rather than a stale one.

**`story_assessment_context` uses the existing compact continuity evidence projection (input compaction only).** The thread rows this lane packet carries are the compact continuity evidence projection the other consumers already use, and they need only the evidence semantic name, the `supports`/`contradicts` relation, the `acquired` flag and the latest `delivery_turn`. Full source refs, claims, prose and NPC dossiers do not belong in this lane packet: the lane reads as a writer what the projection has already produced, and it is not a place to re-derive them. This is input compaction for the existing lane — not new semantic inference, not memory storage, not a model call.

**The per-context byte budget trims optional rows and never erases a selected thread's acquired evidence.** When the bounded packet exceeds its byte budget, the trim drops optional rows (extra threads, prose and other nonessential context) first. It must never erase all acquired evidence from a selected thread merely because one full connection exceeds the budget: an acquired row on the selected thread survives with at least its evidence name, relation, `acquired` flag and latest `delivery_turn`, and the projection reports the truncation through the existing `truncated` marker. A budget that silently turns a thread the player already holds evidence for into zero acquired evidence would make the audit and the feedback disagree exactly as the turn-7 failure below did.

**Acquired evidence is reconstructed from receipts, and a shown carrier counts.** Historical `story_context` reconstructs both clue and handout acquisition from receipts through the assessed turn. A clue is acquired evidence when the clue itself was discovered **or** a shown handout connected to it by the closed `supports`/`depicts` graph roles was delivered; `delivery_turn` comes from either the clue receipt or the carrier handout receipt, whichever makes the predicate true. A shown handout is thus a **carrier of that clue for causal understanding only**: it does not silently add a clue receipt, does not rewrite `discovered_clues`, and does not collapse the handout and clue into one identity — the clue keeps its own discovered/undiscovered state and the handout keeps its own `handouts_shown` receipt. `handouts_shown` is not itself acquired evidence, and a shown handout unrelated to any clue by those closed roles is not a carrier. This is the same predicate the continuity/story projections use; there is no general transitive inference over the graph. The retained live turn 7 below shows the failure of a `discovered_clues`-only reconstruction that omitted `handouts_shown`.

**When `story_context` has candidates**, the current extension requires the lane to submit the existing `candidates` list plus `story` exactly as `{status, thread, frame, bridge_delivered, delivery_quote}`. Kernel validation stays backward compatible with an already-open job from an older bundled host that omits `story`: omission is accepted, writes no assessment, and never invents alignment.

| field | value |
| --- | --- |
| `status` | `aligned` \| `unclear` \| `misframed` \| `detached` |
| `thread` | one supplied semantic thread name for `aligned`/`misframed`/`detached`; `null` for `unclear` |
| `frame` | an exact bounded `player_text` substring for non-`unclear`; `null` for `unclear` |
| `bridge_delivered` | `true` only if this turn's Keeper text explicitly made that causal relation or a source-backed consequence relevant to the player's chosen direction |
| `delivery_quote` | when `bridge_delivered` is `true`, an exact bounded `keeper_text` substring; `false` requires `null` |

Status meanings:

- **`aligned`** — the player explicitly connected the selected causal thread, or informedly refused *that thread*. An informed refusal requires the player to demonstrate understanding of the selected core causal claim and its present stakes, then knowingly decline involvement. Refusing a commission, clue, route, destination, NPC request, or authored hook without demonstrating the deeper causal connection is **not** informed refusal of the core thread, and does not make the frame `aligned` or excuse `detached`. *Informed refusal at that level must never be treated as detached.*
- **`unclear`** — no reliable player frame is expressed. This includes ordinary exploration, short replies, jokes, quiet play, and a one-turn side action. `unclear` never creates a compulsory beat.
- **`misframed`** — requires an exact frame excerpt from the current `player_text` and a selected supplied thread. The explicit causal account conflicts with, or leaves disconnected, public acquired evidence needed for that ongoing investigation.
- **`detached`** — requires an exact frame excerpt and a selected supplied thread. The player chose an ongoing direction with no currently visible path to the selected core thread and has not demonstrated that core understanding. It does not mean physically distant, a new scene, or merely off the expected route. Its response respects the refused hook and brings one source-grounded causal carrier into the direction the player actually chose; it never retries the refused offer and never forces the authored route.

`bridge_delivered` is `true` only when the Keeper text of that same turn explicitly made the causal relation, or a source-backed consequence relevant to the player's chosen direction, relevant to the player. Atmosphere, a menu, or merely naming a route is not a bridge. `false` requires a `null` `delivery_quote`.

**Kernel validation and storage.** The kernel validates the closed shape and the exact excerpts (`frame` must occur in that turn's `player_text`; `delivery_quote` must occur in that turn's `keeper_text`), binds turn/commit/worldline, and appends `memory/story.jsonl` transactionally with the ordinary memory submission. Replay is idempotent. A malformed story result rejects the whole memory submission for the existing bounded retry; there is no partial candidate write. Correction-only jobs do not assess story. `memory/story.jsonl` is advisory keeper-only evidence, isolated by worldline. It never changes world truth, receipts, player agency, or the immutable module.

### 37.3 Projection and action

`story-thread` receives the candidate memory and the story assessments. Its existing conclusion lines remain opportunities, never a per-turn plan.

**One acquired-evidence predicate across every consumer.** Thread ranking, known evidence (`known`), missing-bridge selection, post-commit validation and next-turn reentry all evaluate acquisition with the same predicate for `story_context` above: a clue is acquired when the clue itself was discovered **or** a shown handout connected to it by the closed `supports`/`depicts` roles was delivered. The audit and the feedback therefore agree: a bridge that the pre-delivery review accepted as carried by a shown handout is not read back as zero acquired evidence by the next assessment, and vice versa. No consumer keeps a private clue-only or handout-only reading, and none of them treats a carrier as the clue itself.

It emits **at most one `reentry` object**, only from the latest current-worldline `misframed`/`detached` assessment when `bridge_delivered` is `false` and that thread is still unresolved. The object combines, on the same row:

- `mode`: `clarify_known` or `introduce_evidence` (below);
- `assessed_turn`, `status`, and the exact `frame`;
- the selected thread name, claim, and importance;
- already acquired supporting and contradicting evidence with its delivery turns;
- currently available `here` / `handed` / `next` / `fallback` routes;
- one supplied concrete `bridge` (below) for `introduce_evidence`;
- one English action instruction.

**Deterministic reentry mode.** The row adds `mode: "clarify_known" | "introduce_evidence"`, selected structurally from the acquired evidence and prior assessments on the same worldline/loop/thread, never from prose, a keyword list, a counter or a physical-place list. Physical location never decides the mode; `authority.clue_here` remains a placement/authority fact for the acquisition stage only.

- **`clarify_known`** is selected when the chosen thread has acquired known evidence (`known` is nonempty) **and** no *unanswered* earlier delivery stands on the same worldline/loop/thread before the current assessment. This is a misunderstanding while the thread already carries evidence the player holds: the Keeper can connect what is already known, so the row needs **no new bridge** and does not open adaptation. The Keeper must use **one known evidence row**, explicitly state how it supports or contradicts the selected core claim and why it matters now, and then continue the player's chosen action. It must not open adaptation and must not invent or deliver a new clue.
- **`introduce_evidence`** is selected when `known` is empty, **or** an earlier assessment on the same worldline/loop/thread recorded `bridge_delivered: true`, no later `aligned` assessment on that same thread followed it, and a later player frame is still `misframed`/`detached`. It keeps the existing concrete `bridge`, authority, `source_rebinding`, `bridge_offer` and `bridge_receipt` flow described below. This prevents repeating the same clarification after renewed deviation, while avoiding graph work on a misunderstanding the held evidence can answer.

**A delivered bridge closes `clarify_known` until the player answers it, not forever (2026-09-15).** The prior rule read `bridge_delivered: true` as a permanent property of the thread: one delivery at any earlier turn forced `introduce_evidence` for the rest of that worldline, however much evidence the player went on to acquire and however long they stayed on the thread. A **later `aligned` assessment on the same worldline/loop/thread, after the last row that recorded `bridge_delivered: true`**, resets it, and the mode again follows the evidence the player holds. The reset trigger is the memory lane's own stored per-thread verdict — the same authority, on the same row family, that wrote `bridge_delivered` — so it introduces no counter, no keyword, no turn decay, no new model call and no second signal. The alternatives were rejected for that reason: a turn or assessment count is the counter this section forbids; a later `unclear`/`misframed` row is not evidence of re-engagement; and resetting on newly acquired evidence would fire with no semantic signal at all, since `known` being nonempty is already that fact. After an `aligned`, a later `detached` or `misframed` frame is a fresh first misunderstanding, which is exactly the state `clarify_known` was written for.

**`known` carries the thread's held evidence, not a sample.** `known` is the only place the audit lets a clarification name its evidence, so the projection keeps every acquired row up to six rather than the first three; a cap below the thread's authored evidence count made clues the player was holding unnameable. The same rule applies one level down, in the compact continuity projection both this row and `story_context` read: acquired rows are what the consumer must see and the unacquired remainder is optional context, so the compact evidence cap keeps every acquired row (to six) and fills to two with the rest, and the per-context byte budget sheds those optional rows before it sheds a whole thread. The fixed two-row compact slice was a projection cut with no budget behind it, and it is what showed the memory lane two of the four clues the player actually held (§37.2).

`bridge_delivered` remains the feedback recorded by the post-commit assessment; the mode selection reads the assessments that preceded the current one, so a first misunderstanding with acquired evidence never triggers adaptation, and a renewed misframe after a successful delivery may introduce exactly one new source-grounded bridge.

**The supplied concrete bridge.** The row does not leave the Keeper to invent a carrier. It names **one existing undiscovered clue** that supports or contradicts the selected core thread, selected deterministically from the graph:

```
"bridge": {
  "clue": "<semantic name>",
  "relation": "supports" | "contradicts",
  "fact": "<one line from the clue's source summary>",
  "source_handouts": ["<semantic name>"],       // source handout(s) depicting the clue, up to 2
  "knowledgeable_people": ["<semantic name>"],  // people who know the clue (not discoverers), up to 2
  "source_scenes": ["<semantic name>"],         // authored scenes that hold the clue, up to 3
  "delivery": "<one English line, below>"
}
```

The selection prefers a source handout, then a knowledgeable NPC, then an authored source scene (`source_handouts` present ⇒ rank 0; else `knowledgeable_people` present ⇒ rank 1; else rank 2), breaking ties by clue semantic name. These are **closed graph roles** read from the existing evidence graph, not keyword semantics: a handout is an `handout` node related to the clue by `supports`/`depicts`; a knowledgeable person is the clue's authored `people`; a source scene is an authored scene containing the clue. The bridge **does not create a new clue or story fact**; it reuses an existing one, its existing authority, and its existing receipt. When no such undiscovered clue exists the field is omitted and the action falls back to ordinary source-grounded bridging.

`delivery` is the fixed English instruction: carry that exact evidence into the chosen direction, use reviewed `source_rebinding` when its placement changes, settle the existing clue or handout receipt before narration, then state how it supports or contradicts the selected core thread and why that matters now.

The instruction requires the Keeper to make the causal connection and its current stakes explicit by realizing **this supplied bridge** — one source-grounded carrier, already named on the row. It respects a refused hook, never retries the refused offer, and never forces the authored route. A merely analogous invented incident, generic atmosphere, a detached recap, a route name, or a menu does **not** satisfy it. New information keeps existing clue/source/knowledge authority and receipts. If durable topology must follow the player, use the existing reviewed adaptation / `source_rebinding` path (§36.2/§36.15) before claiming it. The Keeper never chooses the investigator's response. The instruction is one action, with its cost and yield on the same row; it is never a menu and never a set of alternatives to assemble.

**Mode action.** For `clarify_known` the English action instruction is to use one already acquired row from `known`, state explicitly how it supports or contradicts the selected core claim and why it matters now, and continue the player's chosen action, opening no adaptation and inventing or delivering no new clue. For `introduce_evidence` the instruction is the supplied-bridge realization described above. Both modes share one predicate for the acquired evidence they read.

**Discharge and feedback.** The current `turn.player_text` discharges the projected reentry only when it explicitly demonstrates the selected core connection or its stakes, or an informed refusal at that level; a shallower refusal of a hook does not discharge it. Under `clarify_known` the Keeper must connect one already acquired `known` row; under `introduce_evidence` the Keeper must realize the supplied `bridge` before ordinary pacing; an invented analogous incident does not discharge it either, and the next assessment records `bridge_delivered: false` when the supplied evidence was not carried. This is semantic Keeper judgment over supplied evidence, not a regex. A reentry is not a Director debt counter and never feeds future capsules merely because it was offered. The next post-commit story assessment is the feedback: `bridge_delivered` proves presentation, and the next player frame proves alignment or continued misunderstanding.

**Two-stage player agency (narration-audit 1.2.13; stages separated unambiguously by 1.2.14; retained live turn 9 of `midgame-reentry-live-15f-run`).** Reentry must preserve player agency with two stages that are never collapsed. Once the effective graph says the supplied bridge clue is discoverable at the current scene — `causal_reentry.authority.clue_here` is `true` — the Keeper may deliver a **`bridge_offer`**: put the exact carrier within reach, state how that carrier bears on the selected causal claim and why the choice matters now, and stop with the choice still with the player. A `bridge_offer` must **not** claim the investigator took, read, accepted, spent time on, believed, or acted on the evidence; it mints no clue or handout receipt and never counts as `bridge_delivered`. The player's next naturally chosen action either accepts (the ordinary clue/handout receipt then lands through the existing effect path) or declines at the core level. This is the missing middle between the unmet bridge and `bridge_receipt`: it lets the Keeper put the newly available choice **into the fiction** without settling it for the player, which the retained turn-9 failure showed the previous rules forbade.

**The two stages and their authorities (narration-audit 1.2.14).** The offer is the *placement/offer* stage, the receipt-backed realization is the *acquisition/delivery* stage, and each stage has exactly one authority.

- **Placement/offer stage.** When `causal_reentry.authority.clue_here` is `true` and there is no current bridge clue or source-handout receipt, the effective graph already authorizes the exact carrier to appear at this scene: the accepted `source_rebinding` *is* the placement authority. A compliant candidate is reviewed as `bridge_offer` with verdict `defer`. It may show the carrier's visible identity and provenance and explain how examining it could bear on the selected causal claim and current stakes, while leaving taking/opening/reading/accepting/spending/believing/acting to the player. It needs no clue or handout receipt, never counts as `bridge_delivered`, and must not be told to `source_rebind` again.
- **Acquisition/delivery stage.** Quoting or realizing the evidence contents as learned, or claiming acquisition, requires its clue or source-handout receipt and is then reviewed under `bridge_receipt` pass. `bridge_delivered` continues to require acquired evidence.

The earlier blanket statement that new evidence always needs its own receipt therefore refers specifically to *acquired/read contents*, and it is explicitly subordinate to the `bridge_offer` exception: an unforced offer of an authorized carrier is not new acquired information. When `authority.clue_here` is `false`, the audit requires `source_rebinding`; when it is `true`, the audit never requires it again and never revises a compliant offer for a missing receipt.

**The three ends of the 1.2.13 basis (placement/offer and acquisition/delivery separated by 1.2.14).** The two-stage action is one loop across three seams: the **writer** is the effective graph/adaptation layer, which settles `source_rebinding` and therefore writes `causal_reentry.authority.clue_here`; the **reader/verifier** is the narration-audit 1.2.13 `bridge_offer` basis, which reads that authority and treats the unforced offer as a structural `defer`; the **actor** is `story-thread` **1.2.6**, whose Mod text tells the Keeper exactly which action to take for the current `current_input` and authority, and in which `relation` direction to argue the selected evidence. The audit basis is inert without the Keeper instruction, and the Keeper instruction is unsafe without the audit's `defer` reading, so the three are recorded together. For the reentry mode the kernel writes `mode` from acquired evidence plus prior assessments, `story-thread` 1.2.6 acts on it, and narration-audit 1.2.16 validates the permitted basis and its `relation` for that mode.

**A creation-time no-clue description is not a permanent prohibition (story-thread 1.2.4; carried unchanged by 1.2.5; retained live evidence `midgame-reentry-live-16c-run`, around open campaign turn 2).** When a `new_destination` scene's initial description says it has no scenario clue, that records only its creation-time graph state and does not forbid a later clue delivery there. A later reviewed `source_rebinding` is precisely the authorized way to add an existing clue's delivery relation to that scene: it is the writer end of the same loop, not an override of the scene. When `authority.clue_here` is `false`, the Keeper follows the projected bridge and prepares `source_rebinding`; it never creates a flag, ruling, note, or new adaptation whose purpose is to forbid the bridge, freeze the scene as clue-free, or override the reentry, because none of these can supersede source graph/adaptation authority. Player agency is preserved after rebinding exactly as in 1.2.3: use `bridge_offer` when the player has not chosen acquisition, or the minimal receipt path when they have. This is retained failed evidence, not a pass: in `midgame-reentry-live-16c-run` around open campaign turn 2, after the Athens destination acceptance and move, the Keeper read the scene's initial no-clue description as permanent, attempted rejected flag/ruling writes forbidding source clues, and omitted the required `source_rebinding`. P5 remains open until a retest records the bridge reached through a reviewed `source_rebinding` at that scene.

**Mode-permitted bases and the evidence relation (narration-audit 1.2.15; `relation` added by 1.2.16).** `causal_reentry.mode` closes which bases may pass. Under `mode: clarify_known` the audit accepts **only** `acquired_clarification` or `player_discharge`; neither may revise, and neither may demand a bridge receipt/offer or a source rebinding. Under `mode: introduce_evidence` the existing `bridge_receipt`/`bridge_offer` bases and their authority rules apply, and `acquired_clarification`/`player_discharge` remain available for evidence the player already holds. A basis outside its mode's permitted set does not pass and does not revise silently; the auditor returns exactly one finding naming the mode and the lawful basis. The `none` revise keeps exactly one finding and, under `clarify_known`, tells the Keeper to connect one acquired `known` row and continue the chosen action rather than to prepare any adaptation. Every passing or deferring basis now also carries the evidence's `relation` (1.2.16): `acquired_clarification`/`player_discharge` must set it exactly to the selected `known` row's relation, and the quote must use that evidence in that row's own direction — a `supports` row may not be quoted to argue against the selected thread, and a `contradicts` row may not be quoted to argue for it; `bridge_receipt`/`bridge_offer` must set it exactly to `causal_reentry.bridge.relation`; `preparation_wait`/`none` use `null`.

**Decision (2026-09-15): the reentry steers, it does not gate.** Retained live evidence, campaign `game-83177d61-ab11-4d58-b8ec-cf8b9c98d5a4` on `the-haunting`: turn 47 delivered a bridge on `house-haunted-by-corbitt` (`bridge_delivered: true`); turns 62, 63, 64 and 80 assessed `aligned` on that same thread; turn 87 assessed the movement-and-logistics sentence 「我现在就动身去环球报那栋楼，到了不下铁门，就在门厅站定」 as `detached` from it — while the player was walking to the newspaper to publish the story that *is* that thread, holding four of its five supporting clues (`globe-unpublished-story`, `dooley-macario-madness`, `poltergeist-bed`, `upstairs-disturbance`). Because turn 47 had made the prior-delivery flag permanent, the mode was forced to `introduce_evidence`; the one unacquired clue, `gabriela-night-visitor`, is authored at a sanitarium, so `authority.clue_here` was false everywhere the player stood. With no host-owned `preparation_wait` or `rebinding_refused`, 1.2.10 left exactly three exits — the player reciting the thesis, an adaptation importing the last missing clue, or a recorded refusal — and turns 88, 89 and 90 published **nothing** despite settled receipts (a hard-success Persuade, a move, an NPC arrival) while the Keeper burned `max_rewrites` on `source_rebinding` attempts that failed on anchors. Turn 91 passed first try only because the player happened to state the core claim verbatim. That is the same shape as the destination-identity defect: a rule written against a real abuse — the Keeper inventing an analogous incident or drifting off the mystery — had no concept of *the player is on a legitimate chosen path that is not the projected bridge*. The user's ruling is that the reentry is **steering, not a gate**. This reverses the publication requirement 1.2.10 introduced; it does not reverse the anti-fabrication rules, which stand unchanged.

**Pre-delivery enforcement, as it now stands (narration-audit 1.2.10, reentry sub-review 1.2.11, bridge authority 1.2.12, bridge offer 1.2.13, two-stage separation 1.2.14, reentry modes 1.2.15, evidence relation 1.2.16, steering 1.2.19).** The enabled continuity audit still decides the reentry before the turn is delivered rather than only after it, but what it decides is whether the candidate **damages** the selected thread, not whether the candidate reached the bridge. When `causal_reentry` is present in the audit context, the auditor first compares `current_input` semantically: an explicit demonstration of the selected core causal connection and its present stakes, or informed refusal at that core level, discharges the reentry and needs no finding. Otherwise `reentry_review` may return `revise` **only** when the candidate (a) contradicts the selected thread's claim or evidence the player has already acquired, or (b) invents an analogous incident, fabricates a carrier, or claims that evidence arrived, was read, or was acquired without its receipt. Those are the two abuses this enforcement was written for, and they remain revisions. Everything else defers and is delivered: an unrealized bridge on a turn the player spent on their own chosen line is `chosen_action` with verdict `defer`, the reentry is retained, and the turn goes out. The reentry never becomes a publication requirement, and an unmet bridge is never by itself a reason to withhold a turn whose receipts already settled. `bridge_offer`, `bridge_receipt`, `acquired_clarification` and `player_discharge` keep their meanings, their authority rules and their `relation` direction rules exactly. The receipt rule is unchanged and is not the gate: quoting or realizing evidence contents as learned, or claiming acquisition, must land through the clue's or handout's existing receipt, and `bridge_delivered` still requires at least one acquired supporting or contradicting evidence row on the selected thread; vague warning or atmosphere cannot count. That receipt requirement covers *acquired/read contents only* and stays subordinate to the `bridge_offer` exception: an authority-true unforced offer of the exact carrier, which claims no reading or acquisition, needs no receipt. Changed persistent placement still needs reviewed `source_rebinding` already settled, and handing out a source-located carrier at a scene the effective graph does not make discoverable is still not authority (1.2.12); when `authority.clue_here` is `true` the accepted rebinding already settles placement, so the audit requires no further `source_rebinding` and never revises a compliant offer for a missing receipt. The audit creates neither receipt nor adaptation, and it never directs the Keeper to open a `source_rebinding` whose only purpose is to satisfy the review. When it does revise for one of the two abuses, it adds one actionable finding naming what contradicts or what was claimed without a receipt, and sets overall `continuity_review` to `revise`; it does not require a duplicate conflict.

**Bridge authority is kernel-projected (narration-audit 1.2.12).** Prose guidance alone did not enforce the existing placement rule: retained live turn 7 of `midgame-reentry-live-15` showed the Keeper could hand out the selected source handout at Athens without first accepting `source_rebinding`, even though the bridge clue was source-located at the Chapel ruins, and the handout receipt made the checked audit pass. The audit context's `causal_reentry` therefore carries kernel-projected bridge authority: the current scene plus a boolean establishing whether the effective graph currently makes the bridge clue discoverable there. The boolean is computed from the effective graph after accepted adaptations, never from model prose or the stale `source_scenes` list, so the source-authored location ranking cannot override an accepted rebinding and cannot be overridden by narration either. It adds no physical-location enumeration, no automatic adaptation and no new semantic model call; it closes the existing `source_rebinding` rule structurally.

The `bridge_receipt` basis now requires both the exact clue/handout receipt **and** bridge authority at the current scene. When authority is false, `reentry_review` must revise and direct the Keeper to prepare and accept `source_rebinding` first. `acquired_clarification` and `player_discharge` use already acquired evidence and do not require the clue to remain at the current scene. `preparation_wait` and `none` keep their existing meanings.

**Checked reentry sub-review (narration-audit 1.2.11; bridge authority added by 1.2.12; `bridge_offer` added by 1.2.13; stages separated by 1.2.14; reentry modes added by 1.2.15; `relation` added by 1.2.16).** Prose-only guidance proved insufficient: in retained live turn 6 of `midgame-reentry-live-15`, `causal_reentry` was present, no `context.preparation_wait` existed, and neither a clue or handout receipt nor any acquired known evidence had landed, yet the reviewer claimed a generic Chandler Street item discharged the bridge and passed. The audit therefore submits a checked sub-review whenever `causal_reentry` exists and the overall verdict is not `unavailable`, with the exact shape `{verdict, basis, quote, clue, relation}`:

```
"reentry_review": {"verdict": "pass"|"revise"|"defer",
                   "basis": "bridge_receipt"|"bridge_offer"|"acquired_clarification"|"player_discharge"|"preparation_wait"|"none",
                   "quote": string|null, "clue": string|null,
                   "relation": "supports"|"contradicts"|null}
```

The `basis` is one of these closed cases, and `quote`/`clue`/`relation` satisfy that case exactly:

| basis | verdict | requirements |
| --- | --- | --- |
| `bridge_receipt` | `pass` | current receipts contain the supplied bridge clue or one of its source handouts and the candidate realizes its contents as learned or acquired; the kernel-projected bridge authority at the current scene is `true` (1.2.12); `clue` exactly copies `causal_reentry.bridge.clue` and `relation` exactly copies `causal_reentry.bridge.relation`, with the candidate stating that relation in the same direction (1.2.16); `quote` is an exact candidate excerpt explicitly stating the relation and current stakes. This is the acquisition/delivery stage; an offer that leaves the choice open is `bridge_offer`, not a failing receipt |
| `bridge_offer` | `defer` | bridge authority `causal_reentry.authority.clue_here` is `true` (1.2.12) and there is no current bridge clue or source-handout receipt; the effective graph already authorizes the exact carrier to appear at this scene, so the offer is the placement/offer stage and needs no receipt (1.2.14); `clue` exactly copies `causal_reentry.bridge.clue` and `relation` exactly copies `causal_reentry.bridge.relation` (1.2.16); `quote` is an exact candidate excerpt expressing the carrier's visible identity and provenance, its causal bearing on the selected claim in that relation's direction, the current stakes, and an open player choice — it claims no act of taking, reading, accepting, spending time on, believing or acting on the evidence (1.2.13) |
| `acquired_clarification` | `pass` | `mode` is `clarify_known`; `causal_reentry.known` is nonempty; `clue` names one known evidence row and `relation` exactly copies that row's relation (1.2.16); `quote` is an exact candidate excerpt explicitly connecting that evidence and the stakes in that row's relation direction — a `supports` row may not be quoted to argue against the selected thread and a `contradicts` row may not be quoted to argue for it. The candidate connects one already acquired row and opens no adaptation; it invents and delivers no new clue |
| `player_discharge` | `pass` | `causal_reentry.known` is nonempty; `clue` names one known evidence row and `relation` exactly copies that row's relation (1.2.16); `quote` is an exact `current_input` excerpt demonstrating the selected core connection in that row's relation direction and informed refusal or action |
| `chosen_action` | `defer` | the candidate continues the action the player actually chose without reaching the reentry, and neither contradicts the selected thread or its acquired evidence nor claims any evidence, arrival, acquisition or placement (1.2.19). Lawful under **both** modes and requiring no host-owned field: no `preparation_wait`, no `rebinding_refused`, no authority state. `clue` and `relation` are `null`; `quote` is an exact candidate excerpt continuing that chosen action. A current bridge clue or source-handout receipt makes this basis unlawful — that is `bridge_receipt`. The reentry is retained and never `bridge_delivered`, so the next turn carries it again |
| `preparation_wait` | `defer` | `context.preparation_wait` must exist; `clue` and `relation` are `null`; `quote` exactly copies the candidate's honest wait-only notice |
| `none` | `revise` | reserved for the two abuses (1.2.19): the candidate contradicts the selected thread's claim or already acquired evidence, or it invents an analogous incident, fabricates a carrier, or claims evidence arrived, was read or was acquired without its receipt. `quote`, `clue` and `relation` are `null`; add exactly one finding naming what contradicts or what was claimed without a receipt, and how to withdraw it. A candidate that simply did not reach the bridge is **not** this basis — it is `chosen_action` `defer`. The finding never asks for a `source_rebinding` whose only purpose is to satisfy this review, never asks for one when `authority.clue_here` is `true`, and never asks for a receipt when the candidate is a compliant offer |

Overall pass requires a passing `reentry_review` or a structural defer. There are four structural defers — `bridge_offer`, `chosen_action`, `preparation_wait` and `authority_unavailable` — and `chosen_action` is the one that needs no host-owned state at all, because the player's own chosen line is not a condition the host records. A `bridge_offer` defer is one such structural defer: the turn is delivered and the reentry is retained (never counted as delivered), so the next turn carries the reentry until the player acts or a later valid discharge occurs. A structured revise overrides a contradictory aggregate pass and is not duplicated as a conflict. When bridge authority at the current scene is false, the audit requires the Keeper to prepare and accept `source_rebinding` first, and `bridge_receipt`/`bridge_offer` cannot be used; when it is `true`, the audit never requires `source_rebinding` again and never revises an authority-true compliant offer merely for a missing receipt, and `bridge_receipt` then applies only to acquired/read contents. Under `mode: clarify_known` the audit accepts **only** `acquired_clarification` or `player_discharge` as successful bases; neither may revise, and neither may demand a bridge receipt, a bridge offer or a source rebinding. `bridge_receipt` and `bridge_offer` are the lawful bases only under `mode: introduce_evidence`. `acquired_clarification` and `player_discharge` use already acquired evidence and do not require the clue to remain at the current scene; `chosen_action` is lawful under both modes and requires no authority state, no receipt and no host-owned field; `preparation_wait` keeps its existing meaning, and `none` is now reserved for the two abuses named above. `locus_review` keeps its schema and gains no field.

**The post-commit assessment is unchanged.** `bridge_offer` is an audit-basis defer only; it does not write `story`. The next post-commit assessment still records `bridge_delivered: false` because no receipt landed, so the next turn retains the reentry until the player acts or a later valid discharge occurs. `bridge_offer` adds no Keeper verb, no lane, no forced clue, no automatic adaptation, no physical-place list and no opaque id.

**Deferral is structural, not inferred (narration-audit 1.2.10; the fourth structural defer added by 1.2.19).** Every deferral is still structural: the auditor never infers one from the mere absence of receipts, from a quiet turn, or from a candidate that merely says preparation is happening. What changed on 2026-09-15 is that being on the player's own chosen line is itself a structural case, and it is the only one that needs no host-owned field. A reentry may be deferred for an honest **background wait** only when `context.preparation_wait` exists with `kind` `source` or `adaptation`; the host passes that field only from its actual retained background state, and when it exists the candidate must only tell the player that the exact retained preparation is pending and must claim no result, movement, new evidence, elapsed fictional time or unrelated event. A reentry may be deferred for a **refused placement** only when `context.rebinding_refused` exists (§37.6). A reentry is deferred as **`chosen_action`** when the candidate continues the action the player actually chose without reaching the reentry and without either abuse — no host-owned field is consulted, because there is no host state that records that the player chose something else; the exact candidate excerpt is what the reviewer must copy, and a settled bridge receipt makes the basis unlawful. Without any of these, a projected reentry is discharged by `current_input` at the selected core causal level, realized from the supplied bridge, or deferred as `chosen_action`; it is revised only for a contradiction or a fabrication. `locus_review` keeps its schema; no new output field is added. The earlier inference-based deferral (from the mere absence of receipts) remains withdrawn, and the 1.2.10 rule that an unrealized bridge must revise is withdrawn by the 2026-09-15 decision above.

**Live failure that motivated two-stage `bridge_offer` (retained, `midgame-reentry-live-15f-run`, driver attempts 2-4 around campaign turn 9; not yet fixed or accepted).** The run accepted `source_rebinding` for `globe-unpublished-story` into the Athens pension (adaptation receipt `7f1866baa199b5ae`), so bridge authority `causal_reentry.authority.clue_here` became `true`. The Keeper then bundled the clue, handout, item transfer and 25 minutes of reading into one batch; action admission correctly refused it because the player had chosen only to mail the travel pages and had not chosen to receive or read the clipping. The continuity audit then rejected a narration that merely offered the newly available clipping, so the Keeper had no lawful way to put the missing choice into the fiction and the turn stayed undelivered. This is retained failed evidence: the rules forbade settling a choice the player had not made, yet also forbade offering it. Narration-audit 1.2.13 adds the `bridge_offer` basis to close this seam, and narration-audit 1.2.14 separates the placement/offer stage from the acquisition/delivery stage so that this offer can no longer be revised for a missing receipt; P5 remains open until a retest records a delivered offer whose choice the player actually takes. The Keeper/action consumer of that basis is `story-thread` **1.2.6**: its Mod text tells the Keeper to prepare/accept `source_rebinding` when `authority.clue_here` is false, to settle only the exact clue/handout receipt the current `current_input` chose when it is true, and otherwise to narrate an unforced `bridge_offer` and stop — so the writer (effective graph/adaptation authority), the reader/verifier (the 1.2.13 `bridge_offer` defer) and the actor (`story-thread` 1.2.6 telling the Keeper the action) close the same loop. Under `mode: clarify_known` the same text tells the Keeper to connect one already acquired `known` row in that row's own `relation` direction and continue the chosen action instead, opening no adaptation.

**Live false-revision failure that motivated the 1.2.14 stage separation (retained, `midgame-reentry-live-15h-run`, driver attempts around campaign turn 9; not yet fixed or accepted).** This run (`2026-09-13T06:30:55Z`, four undelivered turns, all `agent_settled`) attempted the offer stage repeatedly and was refused by the reviewer every time. `causal_reentry.authority.clue_here` was already `true` after the accepted `source_rebinding`, and the candidates put the exact Globe carrier within reach and explained its bearing: the landlady's forwarded stack with the difference in paper and heading, then the statement that the hard loose sheets are a set-and-corrected but never-printed editorial proof whose subject is the same Chandler Street address, followed by how that class of evidence would bear on the selected causal claim and why the choice matters now — while explicitly leaving the reading to the player ("标题具体怎么写、后面那一节写了什么，都还压在这几张对折的纸上，没有谁替你念出来", "先翻哪一张，你说"). The reviewer nevertheless returned `reentry_review` `{verdict: revise, basis: none, quote: null, clue: null}` on every attempt, invoked the old receipt-first rule ("new information lands through prose alone rather than through its existing clue/handout"), and in one attempt demanded `source_rebinding` again even though authority was true. Two attempts were refused by action admission and one review paused after the first refusal, so no candidate in this run was delivered. This is retained failed evidence for the clarification that became narration-audit 1.2.14: an authority-true compliant offer is the placement/offer stage, is reviewed as `bridge_offer` `defer`, needs no receipt, and must not be told to `source_rebind` again. P5 remains open until a retest records a delivered offer whose choice the player's next chosen action takes up.

**Live failure that motivated kernel-projected bridge authority (retained, `midgame-reentry-live-15`, turn 7; not yet fixed or accepted).** Turn 7 handed out the selected source handout at Athens without first accepting `source_rebinding`, while the bridge clue was source-located at the Chapel ruins; the handout receipt made the checked audit pass, so prose guidance alone did not enforce the existing placement rule. This is the retained failed evidence that motivates kernel-projected bridge authority under `causal_reentry` (narration-audit 1.2.12) computed from the effective graph after accepted adaptations. This turn is retained as failed evidence and P5 stays in progress until retest.

**Live failure that motivated retaining host-owned `preparation_wait` across player inputs (retained, `midgame-reentry-live-16-run`, around campaign turn 2; not yet fixed or accepted).** The run showed `athens-hayes-1920` still running, yet `before_agent_start` cleared `preparationWait` when the next explicit player input arrived. An honest wait-only `narrate` then lacked `context.preparation_wait` and was rejected, and a second `source_rebinding` could not start because the first job still owned preparation. This is retained failed evidence, not a pass: a new player input is a new review/admission context, but it is not a status result and must not clear a real preparation wait while the same job remains pending/reviewing. Only an explicit `ready`/`failed`/`cancelled` status (or an explicit `cancel`/nonpending adaptation result) clears it. The fix preserves the existing host-owned state until the job reports a terminal/nonpending status; it adds no second task registry and never infers waiting from prose. P5 stays in progress until a retest shows an honest wait accepted with the retained `preparation_wait` on a later input.

**Live failure that motivated cold-resume recovery routing (retained, `midgame-reentry-live-16b-run`, around campaign turn 2; not yet fixed or accepted).** After the process restarted, the prior adaptation was no longer in the host's memory, and the Keeper did not know its semantic name. The player asked to inspect that preparation, but the Keeper did not return the retained status, ignored the request, and repeatedly narrated an unverifiable wait. This is retained failed evidence, not a pass: recovery must not depend on the Keeper remembering a name from the previous process. `status` therefore takes an optional name and, without one, returns the most recent retained current proposal (status `pending`/`reviewing`/`ready`/`failed`/`stale`) under its semantic name, or `none`; on each explicit player input with no in-memory `preparation_wait` the host asks it once and either restores `preparation_wait` or restores a host-owned control state that blocks ordinary tools until the Keeper calls `status` with the supplied name. This is recovery routing only, adds no Keeper verb, second registry, opaque identifier, automatic adaptation or prose inference, and P5 stays in progress until a retest shows a restarted process recovering the retained proposal by name without the Keeper knowing it in advance.

**Live failures that motivated structural deferral and the checked sub-review (retained, `midgame-reentry-live-15`, turns 5 and 6; not yet fixed or accepted).** In turn 5, `causal_reentry` was present in the audit context (assessment of turn 4, `detached`), but the auditor passed a quiet no-new-mail scene by incorrectly treating the absence of receipts as a pending-preparation deferral. No `context.preparation_wait` existed, no clue or handout receipt had landed, and the next assessment had not yet established success. This motivates the structural `context.preparation_wait` field and is retained as a failure, not a pass. In turn 6, `causal_reentry` was present, no `context.preparation_wait` existed, and neither a clue or handout receipt nor any acquired known evidence had landed, yet the reviewer claimed a generic Chandler Street item discharged the bridge and passed. No supplied bridge clue was carried and no acquired evidence was connected, so this was not a discharge. This proves that prose-only audit guidance was insufficient and motivates the checked `reentry_review` sub-review (narration-audit 1.2.11); it is retained as failed evidence, not a pass. The slice remains **not** accepted and retest is pending.

**Live finding that exposed the `story_context` acquired-evidence seam (retained, `midgame-reentry-live-15`, turn 7; not yet fixed or accepted).** Turn 7 delivered the exact selected bridge through a handout receipt: `the-haunting-handout-9-chapel-symbol`, a `player-safe` drawing whose graph relation `supports` the clue `clue-chapel-eye-symbol`, was shown to the player and settled as `handout:the-haunting-handout-9-chapel-symbol-t7`, and the pre-delivery `reentry_review` correctly passed. But the post-commit `story_context` reconstructed only `discovered_clues` and omitted `handouts_shown`, so its `supporting`/`contradicting` rows were empty, it exposed zero acquired evidence, and the stored assessment returned `unclear` with `bridge_delivered: false` despite the bridge having landed. This is the retained failed acceptance evidence that motivates reconstructing acquisition from both clue and carrier handout receipts through the same predicate in every consumer; it is not claimed fixed or accepted, and the slice remains **not** accepted with retest pending.

**Retained live evidence that exposed the `story_assessment_context` budget seam (retained, `midgame-reentry-live-18`, turn 3; not yet fixed or accepted).** In turn 3 the pre-delivery audit correctly saw `globe-unpublished-story` as acquired and passed `acquired_clarification`. The memory job's full continuity connection for that thread then exceeded its 7KB per-context budget and was dropped whole rather than trimmed to its compact row, so every `story_context` supporting row was empty. The DeepSeek lane failed the shape check instead of recording `bridge_delivered`, so the delivered bridge is reported as zero acquired evidence. This is retained failed evidence, not a pass: the per-context byte budget must trim optional rows and must never erase all acquired evidence from a selected thread merely because one full connection exceeds the budget, and the packet's thread rows are the compact continuity evidence projection (evidence name, `supports`/`contradicts` relation, `acquired` flag, latest `delivery_turn`) rather than full source refs, claims, prose and NPC dossiers. Keep this failed evidence and P5 open until a backfill/retest succeeds in recording the assessment from the trimmed packet. This is input compaction, not new semantic inference, memory storage or a model call.

**Live failure that motivated pre-delivery enforcement (retained, `midgame-reentry-live-15`, turn 4; not yet fixed or accepted).** The projection correctly supplied a concrete `bridge` on `globe-unpublished-story` — the unpublished 1918 Boston Globe feature listing prior tenants ruined by accidents, illness, and suicide, with the Macario flight — carried by handout `globe-unpublished-1918` and held by the `newspaper-morgue`. The turn-4 candidate instead delivered an invented Chandler Street newspaper brief with no clue receipt and did not connect it to Corbitt or to that bridge, so the supplied evidence was not carried. The post-commit assessment correctly kept `story_status: detached` and `bridge_delivered: false`. This is the retained finding that motivates enforcing the discharge/realization decision before delivery rather than relying on the next assessment alone; the slice is **not** accepted and retest is pending.

**Live failure that motivated the concrete bridge (retained, `midgame-reentry-live-9`, turn 4; not yet fixed or accepted).** Turn 4 projected `detached` correctly, but the supplied instruction was generic: it said to use "one source-grounded carrier" without naming one. The Keeper then invented an **analogous, unnamed empty-house newspaper brief with no receipt and did not connect it to Corbitt**, so no existing clue was carried and the causal relation never landed. The next post-commit assessment correctly kept `bridge_delivered: false`. This is the retained finding that motivated naming one concrete, source-backed bridge on the row and rejecting analogous filler. The slice is **not** accepted; retest is pending.

**Earlier refinement (2026-09; retained, not yet accepted).** In a prior live midgame turn the player explicitly refused Knott's commission. The lane assessed that refusal as aligned to the minor commission-and-research-frame thread: the hook refusal was respected, but the core haunting story disappeared. The implementation supplies only unresolved critical/core threads when any exist and otherwise only the highest authored tier, so a lower-importance procedure, hook, route, or presentation conclusion cannot displace a core causal thread. This refinement is recorded; it is not claimed fixed or accepted until a retest runs.

**Live failure that motivated the deterministic reentry mode (retained, `midgame-reentry-live-17b-run`, turn 6; not yet fixed or accepted).** The player already held acquired evidence on the selected thread: `globe-unpublished-story` was shown and settled as acquired (delivery turn 4), and the current frame was explicitly `misframed` about `house-haunted-by-corbitt`. The Keeper did not clarify the article the player already held; it instead tried to open `source_rebinding` for a different clue (`dooley-macario-madness`) at the newspaper morgue. That projection was not yet authorized (`causal_reentry.authority.clue_here` was `false` there), so the reviewer revised `reentry_review` `{verdict: revise, basis: none}` and the turn was not delivered, costing 46.5 s (`wall_seconds` 46.499, `settle_class` `undelivered_with_tools`) for no fictional progress. This is retained failed evidence, not a pass: the first misunderstanding on a thread the player already holds evidence for needs no adapted bridge at all, so the row now carries `mode: clarify_known` and the Keeper connects one known row and continues the chosen action, opening no adaptation and inventing no clue. `introduce_evidence` is confined to a thread with no acquired evidence or to a renewed misframe/detachment after a prior assessment recorded `bridge_delivered: true`. P5 remains open until a retest records a first misunderstanding with known evidence completing without adaptation and, after a successful clarification, a later renewed misframe introducing exactly one new source-grounded bridge.

**Accounting.** Preserve the §13.7/§31 rule that ordinary `offerLedger` rows count but never nag. Add separate telemetry/acceptance accounting for story assessment status, reentry projected, and `bridge_delivered`; do not turn offer feedback into an obligation. All player-visible words are written by the Keeper in `play_language`; stored frame/delivery excerpts retain their original text. All authored system instructions stay English.

### 37.6 A refused placement: `rebinding_refused` and the `authority_unavailable` basis (2026-09-13)

`mode: introduce_evidence` with `authority.clue_here: false` permits exactly one route — accept a
`source_rebinding` first. Retained live evidence (`midgame-bridge-live-21`, campaign turn 3) shows what
happens when that route is closed from the other side: the Keeper prepared the rebinding, and the
independent adaptation review **contradicted** it, correctly, because the proposed placement would have
invented an NPC's possession of a document the source keeps at the newspaper morgue. Every basis was then
unreachable, the audit could only revise, and the Keeper — told nothing but a generic failure sentence —
prepared the same placement again on the next turn. The turn-lifecycle half of that deadlock is §38; this
subsection removes its cause.

**A refusal the Keeper cannot read is a refusal it repeats.** `adaptation.prepare`/`adaptation.status`
now carry the job's `purpose`, and a `failed` job carries `refused` — the independent reviewer's own
`summary`, `issues` and per-change `contradicted` reasons, each bounded — plus one instruction: do not
prepare the same placement again; propose a materially different one the original source supports, or
continue the chosen action without it. The generic `reason` sentence stays; it is no longer all there is.
This is the §31 adoption end of an error that already existed in the retained review artifact.

**`story-thread` 1.2.7** acts on it: a `failed` rebinding means that placement is refused, not that the
bridge must be retried verbatim. The Keeper either prepares a materially different placement — a different
scene, carrier or provenance — or plays the action the player actually chose, claims no evidence and no
placement, and leaves the causal thread standing for a later turn.

**`context.rebinding_refused` is host-owned structural state.** The host records `{name, summary?}` when a
`source_rebinding` result for this turn reports `failed`, clears it when a later proposal reports
`pending`/`reviewing`/`ready`/`accepted`, and clears it when the next turn opens. It rides on the `narrate`
payload beside `preparation_wait` and reaches `context.json` the same way. It is never inferred from prose
and never set because the Keeper says a placement is impossible.

**`authority_unavailable` (narration-audit 1.2.17)** is the resulting basis:

| basis | verdict | requirements |
| --- | --- | --- |
| `authority_unavailable` | `defer` | `mode` is `introduce_evidence`; `context.rebinding_refused` exists; `causal_reentry.authority.clue_here` is `false`; no bridge clue or source-handout receipt is current; `clue` exactly copies `causal_reentry.bridge.clue` and `relation` exactly copies `causal_reentry.bridge.relation`; `quote` is an exact candidate excerpt continuing the action the player chose, claiming no evidence, no acquisition, no placement and no preparation that is not running |

It is a structural defer beside `preparation_wait` and `bridge_offer`: the turn is delivered, no receipt is
minted, `bridge_delivered` stays `false`, and the next turn carries the reentry again until the player acts
or a later valid discharge occurs. It never applies when `authority.clue_here` is `true`, when a bridge
receipt is current, or merely because the Keeper has not tried — only a recorded refusal makes it lawful.

### 37.7 Acceptance for §37.6

1. A `failed` `source_rebinding` reports `purpose`, `refused.summary`/`issues`/`contradicted` and the
   do-not-repeat instruction, taken from the independent review's own artifact.
2. With `context.rebinding_refused` present, `authority.clue_here` false and no bridge receipt, a candidate
   that continues the player's chosen action without claiming the evidence is `authority_unavailable`
   `defer` and the turn is delivered.
3. The same basis is refused when `authority.clue_here` is `true`, when a bridge receipt is current, or
   when no `rebinding_refused` is recorded.
4. `bridge_delivered` stays `false` and the reentry is carried into the next turn.

### 37.9 Two decisions taken after the accepted run (2026-09-13)

The accepted run left two observations. Both were researched to a decision rather than tuned by feel.

**The review allowance now pays for the repair it already permits.** `AUDIT_LIMITS` had one shared
`time_ms` of 30000 for a whole player input, and `AuditBudget.start()` reserved *all* remaining time for
the first review. Under a lane model whose single continuity review costs 21–30 s — measured on the
authorized `xai/grok-4.6` at low reasoning effort — the first review consumed the allowance and the repair
that `max_rewrites: 1` explicitly permits got whatever seconds were left, so the bounded Keeper repair was
unreachable in practice and any first-attempt `revise` ended the input. That is an accidental limit
overriding the intended one. The limits are now `per_review_ms: 40000` with `time_ms: 80000`, and a review
reserves `min(per_review_ms, time_ms - spent)`: one review can still never run away, the shared allowance
is sized to hold the reviews `max_rewrites` already permits, and the limit that binds is the intended one.
Fast lane models are unaffected — these are caps, not targets. The worst-case audit cost of a single turn
rises from 30 s to 80 s, and only on a turn that needs a revise **and** a repair; before §38 such a turn
could not be delivered at all.

**A lane's reasoning effort is the operator's, like its model (2026-09-14).** The lane model was already
separable from the table's, for the reason above: a slow one is paid by the player, and nothing these lanes
write ever reaches the table. Its *effort* was not — the lane kept riding the table's own chip. A table on
`high` therefore ran its continuity review on `high` no matter which model the lane was pinned to, and a
review that gets `per_review_ms` of wall clock can spend all of it inside a first thinking stream it never
finishes: retained evidence (`game-9aa4e4ee`, 2026-09-14) is two consecutive reviews killed at 40 s having
made exactly one model call each. Half a separation is not one. `PI_COC_MOD_THINKING` joins
`PI_COC_MOD_MODEL` as the runtime's override, with a visible setting handed to it the same way.

**Two halves of this decision were wrong and are superseded.** It read "absent, the lane still follows the
table, which is the previous behaviour" — that default is now the lane's own level (§37.11), because
keeping the previous behaviour as the default kept the failure as the default. And both values were read
when a session *started*, so a change under a running table took effect only on the next one; §38.5 said so
rather than leave the operator to infer it, and §37.10 removed the trap the sentence was describing. A label
on a trap is not a fix, and a knob whose unchosen value points at the failure is not one either.

**The pre-delivery audit and the post-commit assessment ask different questions, and are left to.** On the
accepted run's acquisition turn the checked audit passed `bridge_receipt` while the next assessment
recorded `bridge_delivered: false`, which looks like the disagreement §37.3 forbids. It is not. The two
bars are genuinely different and each was right about its own question:

- `bridge_receipt` asks whether **the candidate realized the carrier**: current receipts settle the clue or
  one of its source handouts, and an exact excerpt states that evidence's `relation` and the current
  stakes. The turn-6 text did exactly that — the list tracks tenants, not buyers; the money is clean.
- `bridge_delivered` asks whether **the Keeper's text made the causal relation to the selected core claim
  land for the player**. That turn stopped at "it is the people who move in, not the money" and never
  reached Corbitt's lingering will; the following turn did, and was recorded `bridge_delivered: true` with
  its own quote.

**So the kernel does not derive `bridge_delivered` from `reentry_review`, and must not.** Collapsing them
would report a bridge as landed the moment its carrier was realized, which is exactly the confusion between
holding evidence and understanding it that this whole section exists to prevent — §37.3 already says
"acquisition is not understanding". The agreement §37.3 requires is over the **acquired-evidence
predicate**, not over the delivery judgment: no consumer may read a bridge the audit accepted as carried
back as *zero acquired evidence*, and the accepted run confirms that holds (`story_context` listed
`globe-unpublished-story` acquired at `delivery_turn: 6`). A conservative `bridge_delivered` on the
acquisition turn costs nothing structurally: the reentry is retained one more turn, and the mode selection
of §37.3 reads it only to decide whether a *later* renewed deviation may introduce a second bridge.

**`story_context.truncated` now reports a cut instead of the module's shape.** It read
`continuityView`'s own `truncated`, which is `connections.length > limit` — "there were more connections
than I showed you". That is right for the shared view and wrong for this packet: `storyAssessmentContext`
deliberately asks for exactly its selected threads, so on `the-haunting` (6 conclusions, 3 critical
threads) the flag was `true` on **every turn**, telling the memory lane its evidence might be incomplete
when nothing had been dropped. Measured on the accepted campaign's own state: 3 connections kept, limit 3,
all selected threads present with their acquired evidence, `truncated: true`. The packet now computes it
from what happened to the selected threads — a thread whose connection is absent, or one whose acquired
rows did not fit the compact projection, which the projection reports as `acquired_total` beside the rows
it kept. `continuityView.truncated` keeps its own meaning for its other consumers. A signal that is
constitutively true carries no information, and this one nudged a semantic lane toward reading its own
packet as incomplete every single turn.

### 37.10 The lane choice is read when the lane runs, not when the session started (2026-09-14)

§37.9 handed the visible lane settings to the runtime the way an operator would: as
`PI_COC_MOD_MODEL` and `PI_COC_MOD_THINKING` in the spawned session's environment. A process
environment cannot change. So the model a table's background lanes ran on was the one that stood
when that session started, and every later change to the setting was correct, visible in the panel,
and inert.

**Retained live evidence (2026-09-14).** During an outage the operator moved `laneModel` off
`grok-build/grok-4.6` to a fast model at 06:42. The continuity-review child launched at 06:43 still
ran `--model grok-build/grok-4.6`; `ps eww` on the session showed `PI_COC_MOD_MODEL=grok-build/grok-4.6`,
baked in at 06:30 when the session started. The reasonable reading from outside — "I already switched
to a fast model and it still fails" — was exactly wrong, and the rest of that outage went into
chasing the wrong thing. The same day's mitigation made the settings section and §38.5's escalation
*say* "read when a session starts". That is a label on a trap, and it is not what a person who has
just changed a setting needs to be told.

**The setting is now read at task time and the environment variable is left to the operator.** The
host no longer injects either value into a child's environment. `runtime/tasks.ts` reads the current
choice from the host's own settings document under `context.agentHome` — the same directory
`childCatalog` already reads `models-store.json` and `models.json` from — each time it starts a `mod`
lane child. Precedence, highest first: a genuine `PI_COC_MOD_MODEL` / `PI_COC_MOD_THINKING` in the
host's environment, then the setting, then what the caller asked for (the table's own model and
effort). Nothing is mirrored anywhere: the store the panel writes is the store the lane reads, so
there is no second copy to drift.

**Why not push the change into the running session instead.** The host has an `ext-invoke` channel to
a live session and could have sent the new value down it. Two things rule it out. A pushed value
still has to be delivered to a session whose agent is *at that moment* blocked on the slow lane the
operator is trying to escape — which is precisely when the change is made — so it lands after the
thing it was meant to fix. And the lane also runs with no such host at all (the CLI table), where
nothing would ever push. A read at the moment of use needs neither a sender nor a session to be idle.

**Failure is open, in both directions.** No settings document, an unreadable or half-written one, or
another product's shape is one source fewer and never a failed lane: the caller's own choice stands,
which is the behaviour that predates the setting. And an operator environment variable still wins, so
making the setting live did not quietly demote the override to a default.

**Three ends (§31).** *Writer:* the settings panel, through the host's ordinary extension-settings
write. *Reader:* `runtime/tasks.ts`, at every `mod` task. *Actor:* the lane child, which launches with
that model and effort. The seam that used to sit between writer and reader — a spawn environment — is
gone rather than widened.

**Acceptance.** Two lane children run over one runtime context whose environment never changes, with
the settings document rewritten between them: the second launches with the new model and effort, the
third with them changed back (`tests/extension/runtime-reader.test.mjs`). A real
`PI_COC_MOD_MODEL`/`PI_COC_MOD_THINKING` beats the setting in the same test file. And the host is
checked at the source for the other half, which no runtime test can see: it must not write either
name into a spawn environment again (`tests/extension/coc-lane-model.test.mjs`), because a live read
does nothing at all while a stale variable is still there to win. §38.5's escalation text and the
settings section's own line now say what the reader does — change it and send again — instead of
asking for a restart the product no longer needs.

### 37.11 The lane's reasoning effort has its own default, and never the table's (2026-09-14)

§37.9 made the lane's effort choosable and left its *unchosen* value as "follow the table". That unchosen
value is the configuration that fails, and it killed two campaigns in one day.

- **`game-9aa4e4ee`** (2026-09-14, morning). Table on `high`. Two consecutive continuity reviews were killed
  at the 40 s `per_review_ms` cap having made exactly one model call each; the turn was refused and the
  player was shown nothing. That run is the evidence §38.5 was written from.
- **`game-5779d0fd`** (2026-09-14, live playtest, turn 9). Same table effort `high`, the lane model already
  moved to the fast `deepseek-extended/deepseek-flash`, context grown to roughly 212k. `narrate` failed
  `needs` after 40 605 ms; §38.5's service notice fired correctly and the turn stranded. Setting
  `ext.coc-keeper.laneThinking` to `low` and restarting fixed it on the spot: the next turn settled in 40 s
  with `narrate ok` in 20.6 s.

**Why this is a wrong coupling and not a tuning value.** A continuity review has a fixed wall-clock budget
(`AUDIT_LIMITS.per_review_ms` 40 s, `time_ms` 80 s, §37.9). The table's reasoning effort is a
Keeper-quality choice about the fiction, and it has no relation to that budget. Reading one off the other
is not a conservative default; it is an unrelated dial wired to a deadline. And it degrades with play: as a
campaign's context grows, *any* table left on a high effort eventually crosses the cap, whichever lane
model is chosen — which is why the second campaign failed on a fast model, and why "pick a faster lane
model" is not the whole answer.

**So the lane runs at its own level when nothing is chosen.** `runtime/tasks.ts` resolves a `mod` task's
effort as `PI_COC_MOD_THINKING` → the `laneThinking` setting → `LANE_THINKING_DEFAULT`. The caller's own
`thinking` — the table's — is no longer consulted for these lanes at all, and the two Mod call sites that
used to hand `pi.getThinkingLevel()` down stopped doing so, because a writer whose value is always
outranked reads as a promise the runtime does not keep. `reader` tasks are unchanged: they are not these
lanes and have no such budget.

**The default is `low`, on the authorized lane models' own thinking maps rather than on taste.**
`grok-build/grok-4.6` maps `off` to `null`, so pi's `clampThinkingLevel` moves a requested `off` *upward* to
`minimal`; the DeepSeek family maps `minimal` to `null` and moves that up to `low`. `low` is the one level
both support as written, so it is the only candidate whose meaning does not change when the lane model
does — and a default that means different things on different models is the same wrong coupling in another
costume. It is also the value the second campaign was recovered with. `off` is rejected for the same reason
the repo already records elsewhere: it is not honoured uniformly, and a level that silently becomes
something else is not a floor.

**Following the table is not kept, even as an explicit choice.** It adds no capability — every level it
could have produced is directly selectable — and its one distinctive behaviour is to change under the
operator when the table's effort changes, which is exactly the failure. Keeping it would mean a stored
sentinel that is not a level, a row in the panel, and a reachable configuration whose only special power is
to go wrong later. The panel's unchosen row now shows the level it will actually run, the way every other
row shows its own; a row whose subtitle said "follow the table" is how nobody noticed the table was being
followed.

**Acceptance.** With nothing chosen and no environment override, a `mod` lane launches at
`LANE_THINKING_DEFAULT` for every one of the seven efforts a table can be set to, while its *model* still
falls back to the table's; a `reader` task in the same context still launches at the table's effort
(`tests/extension/runtime-reader.test.mjs`). The setting and `PI_COC_MOD_THINKING` both still outrank the
default, in that order. The panel's advertised level is pinned to the runtime's, and no sentinel for
following the table is accepted (`tests/extension/coc-lane-model.test.mjs`).

### 37.12 A lane child's idle timeout is its own, and is measured, not derived from its budget (2026-09-15)

§37.11's rule with a second dial. `runtime/launch.ts` writes `httpIdleTimeoutMs: 60000` into the agent
home so a provider connection that answers and then says nothing becomes a retryable *timeout error*
rather than an un-retryable watchdog abort — and that number is the table's, sized as twice the worst
time-to-headers across 15,942 retained table requests. Every `pi` child reads the same file, including
the Mod continuity-review child. That child's own wall-clock budget is `AUDIT_LIMITS.per_review_ms`,
40 s. **A timeout longer than the budget can never fire.** The child's own timer kills it first, so
the one failure the 60 s setting exists to convert is, in this lane, always a SIGTERM at the end of
the budget with no reason attached.

- `.coc/mods/jobs/f1336e40…` — request sent 2026-09-15T04:08:20.656Z, no provider response at all,
  killed `code 143 timedOut` after 40,031 ms.
- `…/playtest-evidence/pipicoc-20260914/homes/m-main/.coc/mods/jobs/b6242e2a…` — headers and first
  chunks at 04:46:03, then 38 s of silence, killed after 40,015 ms.

Both are on the build that already carried the 60 s setting. Both reached the Keeper as
`continuity_review_unavailable`, which latches the turn's review budget (§37.9).

**A fraction of `timeoutMs` is the wrong rule, for §37.11's reason in another costume.** How long a
healthy stream goes quiet is a property of the transport and the model; how much allowance is left is
a property of the accounting. Wiring one to the other is the same unrelated-dial-to-a-deadline
mistake, and it fails in the direction that hurts: the reservation shrinks (a second review under
`AUDIT_LIMITS.time_ms` gets only what remains), so "half the budget" lands *inside* the healthy
distribution exactly when the allowance is tight, and aborts reviews that would have finished. The
threshold is therefore measured from the lane's own retained streams.

**25 s (`LANE_HTTP_IDLE_TIMEOUT_MS`), from 103 children and 4,075 gaps.** Across every retained
`audit-agent-*.jsonl` in this worktree and in the 2026-09-14 playtest homes, the gaps between a lane
child's streamed events put the worst *healthy* mid-stream silence at 16.42 s — a real one, inside a
`thinking_delta` stream that went on to settle — with p99.9 at 10.79 s; the worst time-to-first-token
is 10.49 s, and a whole child's wall clock runs 6.53 s at the median, 12.02 s at p90, 22.43 s at its
worst. 25 s clears the worst observed healthy silence by half again and leaves 13 s of a 40 s budget
for the retry pi schedules 2 s later. Nothing clamps it against a shrunken reservation on purpose: a
threshold that cannot fire inside what is left is simply today's behaviour, which is the right
fallback. `PI_COC_MOD_HTTP_IDLE_TIMEOUT_MS` in the host's environment outranks it, the way
`PI_COC_MOD_TIMEOUT_MS` outranks the budget beside it.

**The seam is pi's project scope, not the agent home.** The agent-home value is written once and
never re-asserted because it is the operator's, so the lane may not move it. Pi deep-merges
`<cwd>/.pi/settings.json` over the agent home's for one process, and loads it only for a *trusted*
project — a print-mode child with no UI answers the trust question "no", so the file without
`--approve` is read by nobody. `runReader` therefore writes both or neither, for `mod` tasks only:
`reader` rounds have an hour and no such budget, and buying them a shorter idle timeout would only
abort reads that are answering slowly. The `.pi` directory is **recreated from nothing on every
run**: `--approve` trusts the whole project scope, the attempts of one review share a working
directory the child itself can write to, and a `SYSTEM.md`, `APPEND_SYSTEM.md`, `extensions` or
`skills` left behind would be writing the next attempt's startup.

**Acceptance** (`tests/extension/lane-idle-timeout.test.mjs`). The constant is pinned against both
quantities it sits between — above the 16.42 s worst healthy silence, and far enough below
`AUDIT_LIMITS.per_review_ms` to hold pi's 2 s backoff plus a median child. A `mod` task writes
`{httpIdleTimeoutMs}` into its own `cwd/.pi/settings.json` and launches with `--approve`; a `reader`
task in the same context gets neither; the agent home's settings file is unchanged. A `.pi` directory
carrying a previous attempt's `APPEND_SYSTEM.md`, stray `extensions` and a longer timeout is gone
after the next run. And the behavioural half, which no amount of writing the file can satisfy: a real
`pi` child, against a socket that sends headers and a first chunk and then stops, raises `terminated`
inside its budget, retries on pi's own auto-retry, and returns an answer — where before it streamed
nothing further and was killed at the end.

### 37.8 The extended live gate is accepted (2026-09-13)

Retained campaign **`midgame-bridge-live-22`** (runs `midgame-bridge-live-22-run`,
`midgame-bridge-live-22b-run`, `midgame-bridge-live-22c-run`) in the retained worktree
`/Users/haoli/leehow/code/chatrpgv4-wt-midgame-bridge`, played with `xai/grok-4.6` at low reasoning
effort — confirmed in `daemon.json.model_confirmed` and in every `provider-request` telemetry row — with
this main session as sole player, one natural utterance per turn, through `tests/play/driver.py` in RPC
mode. Mods pinned in `world.json`: story-thread 1.2.7, narration-audit 1.2.17.

The chain §37.5 item 11 and the extended gate asked for, in order and with structured evidence:

1. **Detection.** Turn 2 stored `detached` for `house-haunted-by-corbitt` in `memory/story.jsonl` with the
   exact player frame and `bridge_delivered: false`, after ordinary play with receipts every turn.
2. **Mode.** `known` was empty on that thread, so the projected `causal_reentry` carried
   `mode: introduce_evidence` with the deterministic bridge `globe-unpublished-story` (`relation: supports`,
   source handout `globe-unpublished-1918`, source scene `newspaper-morgue`) and
   `authority.clue_here: false` at the player's chosen `hall-of-records`.
3. **Authority.** A reviewed `source_rebinding` `globe-story-at-records` (one `clue_at`) passed independent
   review to `ready` and was accepted as receipt `adaptation:33a2e3859a70d929`, so the **effective graph**
   made the carrier discoverable there. No prose-only placement.
4. **Unforced offer.** Turn 5 was reviewed as `reentry_review {verdict: defer, basis: bridge_offer,
   clue: globe-unpublished-story, relation: supports}` (audit job
   `3da4cb0a0e24c0970d9e9085852615b6676b617cf7ffd39d50036193bfd2e84a`), overall `pass`, with only
   `adaptation` and `time` receipts — no clue and no handout receipt — and the post-commit assessment kept
   `detached` with `bridge_delivered: false`.
5. **The player's own acquisition.** Turn 6, on the player's explicit choice to take the clipping, minted
   only the clue and its source-handout receipt and passed `reentry_review {verdict: pass, basis:
   bridge_receipt, clue: globe-unpublished-story, relation: supports}` (audit job
   `89df3850730c25b507ac06d4c2fc0576fa36f57f505f2fe7a45c8059e6150059`).
6. **Coherent continuation.** Turn 7's player frame reconnected the causal thread in the player's own
   words; `memory/story.jsonl` stored **`aligned`** with `bridge_delivered: true` and an exact delivery
   quote, and that turn passed `acquired_clarification` in the row's own `supports` direction (audit job
   `9e90d272e3f637dc987e3049ad4cc521be8f5e92eafcc7fe0feb96d1eeff5401`). Play continued through the probate
   register and the executor to the chapel closed in 1912 — in the direction the player chose, with no
   forced return to the house.

`mode` was `introduce_evidence` for every bridge stage and became `clarify_known` only once the player
actually held the evidence; physical location never selected it. Turn 4 of the same campaign is the live
proof of §38: undelivered under a paused review, released as `closed_by: "stranded"` with `commit: null`
and its receipt preserved, and turn 5 opened on the player's next utterance.

**Preparation wait and cold restart.** Turn 11 prepared `new_destination` `教区总档案处` and delivered an
honest wait-only narration under `context.preparation_wait`. A fresh `bin/pi-coc --mode rpc --no-session`
process then recovered it: the capsule carried its `resume` checkpoint (turn 11, commit `c6f1933`), the
Keeper's first tool call was `lookup kind=adaptation action=status name=教区总档案处` — a name no
surviving session held — and it accepted the proposal (`adaptation:dd23f0023d16e116`) and delivered. Both
the host's unnamed `adaptation.status` scan and the `resume`/`recent` projection carried that name in this
run, so the restart is accepted as recovery-without-Keeper-memory but does not isolate the unnamed-status
path from the resume projection.

**Two observations from this run, both since decided in §37.9.** The acquisition turn passed
`bridge_receipt` while its assessment recorded `bridge_delivered: false` — researched and kept: the two
bars ask different questions and both were right, so the kernel does not derive one from the other. And
the review allowance was reshaped, because one continuity review under grok-4.6 low measured 21–30 s
against a shared 30 s budget, which made the repair `max_rewrites: 1` permits unaffordable.

Full retained evidence: [the extended gate working notes](../research/midgame-bridge-live-20260913-notes.md).

### 37.4 The three ends (§31)

- **Writer:** `memory.submit`, after model extraction in the existing lane; authority for the placement change itself is written by the effective graph/adaptation layer (settled `source_rebinding`), which sets `causal_reentry.authority.clue_here`. The kernel also writes `mode` (`clarify_known` | `introduce_evidence`) deterministically from the acquired evidence on the selected thread plus the earlier same-worldline/loop/thread assessments: `clarify_known` when `known` is nonempty and no earlier assessment before the current one recorded `bridge_delivered: true`, otherwise `introduce_evidence`.
- **Reader:** the `story-thread` projection in the capsule; `story-thread` **1.2.6** is the Keeper/action consumer of the narration-audit 1.2.16 modes, the `relation` rule and the 1.2.13 `bridge_offer` basis, whose placement/offer and acquisition/delivery stages are separated by 1.2.14. It reads `mode` and acts on it: for `clarify_known` it connects one already acquired `known` row, states how it supports or contradicts the selected claim **in that row's own `relation` direction** and why it matters now, and continues the player's chosen action, opening no adaptation and inventing no clue; for `introduce_evidence` it reads `authority.clue_here` and the current `current_input` and tells the Keeper whether to prepare/accept `source_rebinding` first (authority false), settle only the exact clue/handout receipt the chosen action needs (authority true and the player chose to receive/read/examine it), or narrate an unforced `bridge_offer` and leave the choice open (authority true and the player did not choose it), realizing the supplied bridge in its own `relation` direction; it never asks for `source_rebinding` again once authority is true, and it never treats a `new_destination` scene's creation-time no-clue description as a permanent prohibition on adding an existing clue's delivery relation through a later reviewed `source_rebinding`, nor creates a flag, ruling, note or adaptation that would forbid the bridge or freeze the scene clue-free.
- **Refused placement (§37.6):** the writer is the independent adaptation review, whose contradiction is
  recorded on the job and surfaced as `refused`; the host carries it as `rebinding_refused`; the reader is
  `story-thread` **1.2.7**, which stops resubmitting that placement; the actor is the Keeper, who plays the
  chosen action honestly, and narration-audit **1.2.17**, which accepts that as `authority_unavailable`
  `defer` and keeps the reentry standing.
- **Actor:** under `clarify_known` the Keeper realizes one known evidence row in that row's own `relation` direction using the existing seven verbs; under `introduce_evidence` the Keeper realizes the reentry's supplied `bridge` in its own `relation` direction. The narration-audit 1.2.16 modes accept only `acquired_clarification`/`player_discharge` for `clarify_known` and `bridge_receipt`/`bridge_offer` for `introduce_evidence`, each carrying the selected row's or bridge's `relation`; the 1.2.14 stage separation reads/verifies the unforced offer as a structural `defer` and the receipt-backed realization as `bridge_receipt`, and the next memory assessment records whether a bridge was delivered, with later player input showing alignment. Tied together: the kernel writes `mode` from acquired evidence plus prior assessments, `story-thread` acts on it, the audit validates the permitted basis and its relation, and the effective graph/adaptation layer writes authority.

### 37.5 Acceptance

This is the acceptance shape for the slice. For the core midgame mainline the verified genuine-play checkpoint (see the end of this section) covers item 1, item 2 and the `clarify_known` half of item 12; the extended-live item 11 remains **PENDING** and unaccepted. The remaining items outside the verified checkpoint below are not claimed as run.

1. Active wrong-theory midgame, despite receipts every turn and stall counters zero, produces `misframed` then a grounded reentry within the next turn.
2. Player gets facts but not the connection: the reentry's supplied bridge explains the relation and stakes, not merely repeating clues.
3. Informed refusal of the selected core thread produces `aligned` / no compulsory beat; a shallow refusal of a hook, commission, clue, route or NPC request that never demonstrates the core connection is not such a refusal.
4. Quiet play / short answer / one-turn side action produces `unclear` / no compulsory beat.
5. Persistent departure, such as choosing another city, produces `detached` and a source-grounded rebind into that chosen direction; no forced return and no arbitrary copy of the whole module.
6. After bridge delivery, no repeat until later player input is assessed; renewed misunderstanding can produce a new reentry.
7. Restart/worldline keeps only the matching latest assessment, and replay does not duplicate.
8. Lane failure / malformed output leaves gameplay available and retained backlog evidence, without inventing alignment.
9. Bridge delivery through a shown carrier handout is read back as acquired: a clue acquired only via a shown handout whose graph relation is `supports`/`depicts` counts as evidence for thread ranking, `known`, bridge selection, post-commit validation and next-turn reentry, so the audit and the feedback agree and the delivered bridge is not reported as zero acquired evidence.
10. True play uses `tests/play/driver.py`, this main session as sole player, one natural utterance per turn. For the remaining extended gate, the user authorized **`xai/grok-4.6` at low reasoning effort** on 2026-09-13; select it before activation and keep it fixed for the run. It must cover active wrong theory with nonzero receipts, informed refusal, a detached ongoing direction, a delivered causal bridge, renewed deviation, and eventual coherent continuation. No fake Keeper / scripted player and no Astra.
11. **ACCEPTED on retained `midgame-bridge-live-22` (§37.8).** Two-stage agency: once `causal_reentry.authority.clue_here` is `true` and no bridge clue/source-handout receipt exists, a candidate that puts the exact carrier within reach, shows its visible identity/provenance, states its causal bearing and the current stakes, and leaves the choice open is a structural `bridge_offer` defer, not a revise; it needs no clue or handout receipt, claims no taking/reading/accepting/spending/believing/acting, mints no receipt, and never counts as `bridge_delivered`, and it must not be told to `source_rebind` again; quoting or realizing the evidence contents as learned requires the clue/source-handout receipt and is then `bridge_receipt`, so the next turn retains the reentry until the player acts or a later valid discharge occurs.
12. Deterministic reentry mode: a first misunderstanding while the selected thread already carries acquired `known` evidence and no earlier same-worldline/loop/thread assessment before the current one recorded `bridge_delivered: true` selects `mode: clarify_known`, and the Keeper connects one known row — stating how it supports or contradicts the selected core claim **in that row's own `relation` direction** and why it matters now — then continues the player's chosen action, completing the turn with no adaptation, no new clue and no new bridge; the audit accepts only `acquired_clarification` or `player_discharge` for that mode and neither may revise or demand a bridge receipt, offer or source rebinding. The reentry sub-review carries that row's `relation` exactly, and the quote must use the row's evidence in that relation's direction: a `supports` row may not be quoted to argue against the selected thread and a `contradicts` row may not be quoted to argue for it. After such a successful clarification, a later renewed `misframed`/`detached` frame on the same worldline/loop/thread selects `mode: introduce_evidence` and may introduce exactly one new source-grounded bridge through the existing authority/`source_rebinding`/`bridge_offer`/`bridge_receipt` flow, in the bridge's own `relation` direction; a thread whose `known` is empty also selects `introduce_evidence`. Physical location never decides the mode.

The retained `midgame-reentry-live-17b-run` turn 6 is failed acceptance evidence for item 12, not a pass: the player already held `globe-unpublished-story` as acquired evidence and was explicitly `misframed` about `house-haunted-by-corbitt`, but the Keeper opened `source_rebinding` for `dooley-macario-madness` at the newspaper morgue — which the effective graph did not yet authorize — instead of clarifying the article the player already held, so the reviewer revised and the turn stayed undelivered (`wall_seconds` 46.499, `settle_class` `undelivered_with_tools`). Item 12 is not accepted until a retest records a first misunderstanding with known evidence completing without adaptation and, after a successful clarification, a later renewed misframe introducing exactly one new source-grounded bridge.

The retained `midgame-reentry-live-20-run` turn 5 is a second, wrong-direction failed acceptance set for item 12, not a pass: the mode was `clarify_known` with known row `globe-unpublished-story` whose relation was `supports`, and the player was still explicitly `misframed` about `house-haunted-by-corbitt`. The candidate used that supporting article to argue the opposite direction — that the unrelated fates looked like a manufactured scare rather than Corbitt's will — and the reviewer passed `acquired_clarification` anyway. That is a `supports` row quoted against the selected thread, so it is not a clarification; the checked sub-review now carries `relation` and the quote must use the selected row's evidence in that row's own direction. That failure is retained and is not rewritten. Item 12's `clarify_known` half is now **accepted on the retained live20 retest after the 1.2.16 upgrade**: turn 5 rejected the first wrong-direction candidate (audit job `ea5624057011efd004552bf69e67bf87b1f7633963c66cb8254ae57dad0aeb0`) and passed the corrected candidate argued in the selected row's own direction (audit job `8a186efaaa015298f4da7e7a5182e3eda6a346d44ddff53ca6918ec211ef3396`, `acquired_clarification`, clue `globe-unpublished-story`, relation `supports`), and turn 6 passed `player_discharge` (audit job `80d5601af739a1ebbc513820561c88561b8b460f75995d043755d55b755c8ecc`), storing `aligned` at commit `c3a0d29`. The extended-live items remain separately unaccepted.

The retained `midgame-reentry-live-15` turn 7 result is failed acceptance evidence for item 9, not a pass; that item is not accepted until a retest commits a bridge through a shown carrier and records the matching assessment. The retained `midgame-reentry-live-15f-run` attempts 2-4 around campaign turn 9 are failed acceptance evidence for item 11, not a pass; that item is not accepted until a retest delivers a `bridge_offer` that the player's next chosen action takes up. The retained `midgame-reentry-live-15h-run` attempts around campaign turn 9 are a second failed acceptance set for item 11 and the evidence for the 1.2.14 stage separation: there the candidates did reach a compliant authority-true offer and the reviewer still revised them for a missing receipt, even demanding `source_rebinding` again; item 11 remains unaccepted until a retest delivers an offer the player takes up.

Retained `midgame-reentry-live-16-run` around campaign turn 2 is the failed evidence for host-owned preparation retention: `athens-hayes-1920` was still running when a later explicit player input cleared `preparationWait`, so an honest wait-only `narrate` lacked `context.preparation_wait` and was rejected and a second `source_rebinding` could not start while the first job still owned preparation. It is not a pass; P5 remains in progress until a retest shows a later input keeping the retained `preparation_wait`, an honest wait accepted with it, and it cleared only by an explicit `ready`/`failed`/`cancelled` status (or an explicit `cancel`/nonpending adaptation result). Retained `midgame-reentry-live-16b-run` around campaign turn 2 is the failed evidence for cold-resume recovery routing: after the process restarted the prior adaptation was no longer in host memory, the Keeper did not know its semantic name, ignored the player's request to inspect it, and repeatedly narrated an unverifiable wait. It too is not a pass; P5 remains in progress until a retest shows a restarted process recovering the retained proposal with the no-name `status`, restoring `preparation_wait` for a pending/reviewing proposal or the host-owned control state for a `ready`/`failed`/`stale` one, and clearing that control only through an explicit named `status` result.

Retained `midgame-reentry-live-16c-run` around open campaign turn 2 is the failed evidence for the story-thread 1.2.4 clarification: after the Athens destination acceptance and move, the Keeper read the `new_destination` scene's initial no-clue description as a permanent prohibition, attempted rejected flag/ruling writes intended to forbid source clues there, and omitted the required `source_rebinding`, so the projection's bridge never reached the scene. It is not a pass; that initial description records only the scene's creation-time graph state, and a later reviewed `source_rebinding` is precisely the authorized way to add an existing clue's delivery relation there, so no flag, ruling, note or adaptation may forbid the bridge, freeze the scene as clue-free, or override the reentry. P5 remains open until a retest records the bridge reached through a reviewed `source_rebinding` at that scene, with `bridge_offer` used when the player has not chosen acquisition and the minimal receipt path when they have.

**Current checkpoint (2026-09-13; acceptance status corrected, then core mainline accepted on retained live20 evidence) — code/static status stands, core genuine-play acceptance accepted, extended live gate pending.** Current 1.2.16 validation passed with Node 24.19.0: `npm run check:kernel`, targeted continuity/adaptation/audit/turn 59/59, targeted relation validation 11/11, and full `npm run test:ext` 883/883 with exit 0. The targeted Python `tests/kernel/test_memory.py` + `tests/play/test_driver.py` 29/29 and runtime build passed before the relation-only change and were not rerun at closeout. The former primary-acceptance campaign **`midgame-reentry-live-18`** (runs `midgame-reentry-live-18b-run`, `midgame-reentry-live-18c-run`) had its raw campaign/playtest evidence accidentally deleted by a worktree closeout and no longer exists; those results are therefore **`invalid-for-acceptance`** as independently inspectable raw evidence and are retained only as historical claims, not as verified acceptance, and their missing paths are not cited as current evidence — an operator evidence-retention failure, not a product pass. **The core genuine-play acceptance is ACCEPTED on the retained `midgame-reentry-live-20` campaign and runs** (`midgame-reentry-live-20-run`, `midgame-reentry-live-20b-run`): turn 2 acquired `globe-unpublished-story` through Ruth Blake's 1918 withheld Globe file after ordinary play; turn 3 stored `misframed` for `house-haunted-by-corbitt`; turn 4 under 1.2.15 is the retained wrong-direction failure (a `supports` row quoted to argue against the thread while the audit passed `acquired_clarification`), not a pass; 1.2.16 adds `relation` to `reentry_review` and exact structural matching; turn 5 after upgrade rejected the first wrong-direction candidate (audit job `ea5624057011efd004552bf69e67bf87b1f7633963c66cb8254ae57dad0aeb0`, `reentry_review` none/`relation` null, with a precise fix) and passed the corrected candidate (audit job `8a186efaaa015298f4da7e7a5182e3eda6a346d44ddff53ca6918ec211ef3396`, `acquired_clarification`, clue `globe-unpublished-story`, relation `supports`, no adaptation/new clue); turn 6 passed `player_discharge` (audit job `80d5601af739a1ebbc513820561c88561b8b460f75995d043755d55b755c8ecc`) and stored `aligned` for `house-haunted-by-corbitt` (`memory/story.jsonl`, commit `c3a0d29`) without forcing the player into the house. The retained `midgame-reentry-live-19` run is a **semantic-model failure, not acceptance**: DeepSeek classified an active but repeatedly failed investigation as `introduce_evidence` too early. The driver `final_text` on the live20 turn-5 run carries a DeepSeek XML wrapper around the narration, a player-surface/model-output limitation while the kernel turn and audit evidence remain retained. Current versions are story-thread 1.2.6 and narration-audit 1.2.16; the current retained evidence worktree is `/Users/haoli/leehow/code/chatrpgv4-wt-midgame-evidence`, which will be locked and retained and must not be closed or deleted. The retained `midgame-reentry-live-19` and `midgame-reentry-live-20` campaigns and playtest runs remain preserved in this evidence worktree.

Implementation: post-commit memory story assessment over core authored threads; statuses `aligned`/`unclear`/`misframed`/`detached` with exact player/keeper excerpts and worldline/loop binding; reentry mode `clarify_known` vs `introduce_evidence`; receipt-grounded handout carriers; effective-graph bridge authority; two-stage `bridge_offer`; evidence `relation` in the checked sub-review; preparation wait retention; unnamed adaptation status cold recovery; compact story context. No new Keeper verb, lane, semantic regex/list, counter or forced convergence. Current 1.2.16 static validation: `npm run check:kernel` passed; targeted continuity/adaptation/audit/turn 59/59; targeted relation validation 11/11; full `npm run test:ext` 883/883 exit 0. Earlier adjacent validation: targeted Python `tests/kernel/test_memory.py` + `tests/play/test_driver.py` 29/29 and runtime build passed before the relation-only change; neither was rerun at closeout.

Performance: the retained live20 aligned delivery was 16.1 s with only `narrate`, and the whole `midgame-reentry-live-20b-run` was 81.7 s across four driver attempts and seven tool calls. The deleted `midgame-reentry-live-18` run reportedly had a decisive `clarify_known` delivery of 15.948 s that avoided adaptation and a later aligned/library turn of 89.542 s with 10 `lookup` calls; those figures are `invalid-for-acceptance` along with the deleted raw evidence and are recorded here only as historical claims, and the lookup-heavy figure is classified as repeated lookup/model behavior rather than dynamic graph adaptation; no claim is made that all turns meet the 30 s target.

The extended **`introduce_evidence` / `source_rebinding` / `bridge_offer`** live gate was **PENDING** at this checkpoint and is now **ACCEPTED** on retained campaign `midgame-bridge-live-22` under story-thread 1.2.7 / narration-audit 1.2.17 with `xai/grok-4.6` at low reasoning effort; see §37.8. Reaching it required two contract-first repairs found by that play: §38 (a paused review could strand a turn forever and brick the campaign) and §37.6 (a placement the independent source review refused had no lawful next move and no readable reason). The earlier Greece/off-script retained failures drove bridge authority, `bridge_offer`, wait recovery and the no-clue-scene fixes. Human UI acceptance, integration and packaging remain pending/out of scope. Full retained evidence: [the midgame causal re-entry checkpoint](../research/midgame-causal-reentry-2026-09-13.md).

## 38. A turn always ends: releasing a stranded turn (2026-09-13)

A turn that a player opened must always be able to return to that player, and every player utterance must
end in a visible result: a delivery or a service notice. Infrastructure that cannot complete a run must not
also be able to end the campaign. Until this section the state
machine of §4 had one exit from `open`/`acting` — a successful `narrate` or `ask` — and one guard on
`table.player_input`: the turn must be `awaiting_player` or `asked`. Retained live evidence
(`midgame-bridge-live-21`, campaign turn 3, 2026-09-13) shows those two rules can close on each other and
brick a campaign permanently, across process restarts. This section adds the missing exit. It is a
turn-lifecycle rule, not a reentry rule; §37 is only where it was found.

### 38.1 The retained deadlock

The turn carried a projected `causal_reentry` with `mode: introduce_evidence`, `known: []` and
`authority.clue_here: false`, so §37 permits exactly one lawful route: accept a `source_rebinding` first.
The Keeper prepared one, and the independent adaptation review **contradicted** it — correctly, because the
proposed placement would have invented an NPC's possession of a document the source keeps elsewhere. With
that refusal, no `reentry_review` basis remained: `bridge_receipt`/`bridge_offer` need
`authority.clue_here: true`; `acquired_clarification`/`player_discharge` need nonempty `known`;
`preparation_wait` needs a live pending/reviewing job, and the job was terminal `failed`; `none` is by
definition `revise`. The audit budget then blocked the review for that input, so every further `narrate`
returned `needs` / `continuity_review_unavailable` — while the REFUSAL_BUDGET escape hatch tells the Keeper
to "close the turn with narrate", the one thing the paused review had made impossible. A write had already
landed that turn, so `turn.json` read `acting`, and every subsequent `table.player_input` was refused
`turn_state`. A cold restart changed nothing: the state is on disk.

**Both ends of the seam already agreed the player should speak again.** The host's `agent_settled` handler
forwards a waiting input when the turn is closed **or** `reviewUnavailable` is set. The kernel never read
that intent. This is the §31 shape: a writer with no reader.

### 38.2 `table.player_input` accepts `release: "stranded"`

`table.player_input` gains one optional parameter, `release`, whose only value is `"stranded"`.

- Without it, the guard of §4/§5 is unchanged: `awaiting_player` or `asked`, else `turn_state`.
- With it, `open` and `acting` are also accepted. Any other state rejects the parameter as
  `invalid_params`: a delivered turn is not stranded, and stranding is never a way to discard a turn the
  Keeper could still finish.
- The kernel closes the stranded turn honestly before opening the next one. It writes that turn's record
  with `closed_by: "stranded"`, `text: null`, `rendered_text: null`, `commit: null`, and its
  `player_text`, `receipts`, `calls`, `capsule`, `opened_at`, `closed_at` and world snapshot preserved
  exactly as they stand, and appends a `turn-stranded` event. It then opens turn n+1 exactly as an
  ordinary `table.player_input` does.
- A stranded turn is **not** a delivered turn. There is no git commit, no memory extraction job, no
  Director adoption row, no offer-ledger row, no checkpoint and no transcript keeper line. Every consumer
  that requires a delivery already filters on `closed_by === "narrate"` with a commit, so a stranded record
  is inert to memory, continuity, continuation, source audit and story assessment.
- Evidence is preserved, never discarded: the receipts that did land stay on the stranded record, and the
  record is written before the next turn opens.

### 38.3 Who may declare a turn stranded

**The host, from its own retained run state, and never from prose or a verdict.** A turn is stranded when
an agent run has fully settled while leaving it `open`/`acting` with nothing delivered — no successful
`narrate`, no `ask`, and no retained delivery waiting to be placed. The cause is deliberately not part of
the predicate. A paused continuity review, a terminal provider error, a Keeper that spent its one repair
steer and then returned only thinking, and any future failure shape are the same lifecycle fact once the
run has ended: nobody remains who can finish that turn before new player input, while the state guard would
reject that input. The host already records the complete predicate (`state`, `closedThisRun`,
`renderedText`, and `agent_settled`). It marks the turn stranded at `agent_settled`; a restart that finds a
`pending_turn` under a paused retained review still marks it at `table.open`. The mark is carried on the
next `table.player_input` and cleared as soon as a turn opens.

Failures that recover and deliver inside the same run are not stranded. A `revise`, admission refusal,
provider retry or slow Keeper is not stranding while the run is still live; the Keeper may still repair and
deliver. Once that run settles without delivery, however, the lifecycle predicate is complete and the
cause no longer grants a special exemption. Retained App evidence
(`game-e0877a4e-fde9-430b-b0d0-d22c8868ce5c`, turn 4, 2026-09-14) is the non-infrastructure case: the
provider completed successfully twice, the review was available, the one preparation-wait steer was spent,
and the Keeper's second completion contained thinking but no text or tool call. The UI returned to an empty
composer with no result until this general rule replaced the earlier cause list.

The Electron turn watchdog cannot manufacture that boundary. A terminal message from a previous run is
not evidence that the current run settled: live state records the current `agent_start` time, and a durable
assistant stop/error must be at or after it before the watchdog may repair a missing `agent_settled`. This
matters on a silent provider body: the child may be alive after response headers while the last durable
message belongs to the prior run. The host therefore keeps the turn busy during its bounded silence window,
then sends Pi's real `abort` command if the run has produced neither a current terminal message nor a current
in-flight tool. The in-flight decision comes from the host's current-epoch `tool_execution_start`/`end` pairs,
not merely from the final JSONL row; several tools may overlap after one result has already been written. Tail
I/O is also only a snapshot: the host rechecks the live object, epoch, monotonic activity counter, terminal
fence, tool set and queue gate after every asynchronous read before it may act.

The watchdog does **not** relabel an old row or synthesize `settled`. It atomically arms
`<session.jsonl>.coc-watchdog-recovery.json` (`{version: 1, sessionId, turnEpoch, createdAt}`) and sends Pi's
real `abort`. This sidecar is a host lifecycle handoff, not campaign truth or a delivery. When Pi responds
normally, its `agent_settled` — not an intermediate `message_end(error)`, `agent_stopped` or `agent_error`
projection — is the terminal boundary: the extension synchronously marks the open turn stranded and schedules
the no-delivery service notice, then the FIFO may drain. If abort itself is unresponsive and the host must replace the Pi process, the marker makes
the replacement's environment carry one-shot `PI_COC_WATCHDOG_RECOVERY=1`; `session_start` consumes it,
marks the retained `pending_turn` stranded, schedules the same notice and suppresses ordinary mid-turn recovery
before queued player input can reach `table.player_input`. The host starts that replacement even when no later
input is queued, because the original sentence is already owed its notice. The marker is bound to the retained
kernel turn and remains through `agent_settled`, replacement initialization, notice delivery and repeated process
or App exits. Binding is a completion barrier: queued input must await the marker's durable kernel-turn write
before it may call `table.player_input`. Only a successful `table.player_input(release: "stranded")` clears it;
if that cleanup fails, the bound turn number prevents the stale marker from stranding a later turn. Both generic
unfinished notices and terminal provider notices carry a durable terminal-notice discriminator, so another
replacement never tells the player twice for the same turn. Pi runs `session_start` before its RPC event stream
is subscribed, so the Electron host records the JSONL byte offset when it arms watchdog recovery, preserves that
earliest unread offset across failed replacement attempts, and after initialization replays any newly appended
`coc-delivery` presentation whose id was not already seen live. It rechecks generation, live identity and process
liveness after that asynchronous replay; a child that exits during catch-up is another failed replacement, not a
successful initialization. A durable notice can therefore never become an empty timestamp merely because it
was written during replacement startup. A recovered
retry refreshes activity and never reaches this boundary.
Thus a provider may be slow, but it may not leave the player at an infinite spinner or return an empty composer.

**This is not a bypass of review.** Nothing is narrated, nothing is committed, no verdict is treated as a
pass, and an unavailable review still authorizes nothing (§32). It only stops an unavailable review from
also ending the campaign. The player gets the table back and may act again; the Keeper's next run sees the
same unresolved reentry, and — because a new player input is a new review context — a fresh review
allowance in which to reach a lawful draft.

### 38.4 The three ends (§31)

- **Writer:** the host, at `agent_settled`, from the run's state/delivery facts regardless of cause, and at
  a `table.open` that finds a `pending_turn` under a paused retained review, all from its own run state;
  `before_agent_start` carries the mark, and the kernel writes the stranded turn record and the
  `turn-stranded` event.
- **Reader:** `table.player_input`'s state guard, and every delivery consumer through the existing
  `closed_by === "narrate"` predicate, which a stranded record deliberately fails.
- **Actor:** the player, who can speak again, and the Keeper, whose next run gets a new review context on
  the same unresolved turn state.

### 38.5 The player is always told, and a streak reaches the operator

Releasing the turn kept the campaign alive but said nothing, and silence is its own defect. Retained live
evidence (campaign `game-9aa4e4ee`, turn 1, 2026-09-14): a Persuade roll, a discovered clue and four
queued registrations all settled with receipts, the continuity review timed out, the draft was discarded
under §34.14, and the run ended with **not one word on screen**. The engine had moved and the fiction had
not — exactly the drift the review exists to prevent, produced by the review. The player could only read it
as a dead table.

**A run that ends undelivered because the review was unavailable owes the player a service notice.** The
host emits it, once per run, as a displayed message of its own, in the campaign's `play_language` from the
extension caption surface (§23) — not as prose, not as fiction, and not through `narrate`, which the paused
review refuses by construction. It states that the turn could not be published and that whatever already
settled is kept. The rejected draft is **never** what gets sent: it never passed `narrate`, so it still
carries the machine tokens only a rendered delivery strips (§34.14).

**Outage streaks are counted and escalated, exactly as the admission lane's are (§32.2).** A run whose
review pauses increments a consecutive-outage count held on the host's own table state; a landed `narrate`
resets it, and a turn boundary does not, because an outage is a service condition rather than a turn
context. Only the first pause of a run counts: once paused, every later verb re-throws the same reason from
the guard, and counting those would turn one dead lane into a streak inside a single run. From the second
consecutive outage the notice stops promising that another try will help, and the host writes one
out-of-fiction operator entry (`coc-review-status` with `status: "down"`, the streak and a `fix`) naming
the lane model and the `PI_COC_MOD_MODEL` override. That `fix` originally also said the lane reads the
choice when a session starts, so change it and restart — because it did, and without that sentence an
operator changes the model, watches the running table fail identically, and concludes the change did not
help. **§37.10 removed the trap the sentence was describing:** the lane now reads the choice each time it
runs, so the `fix` says to change it and send again, and adds that `PI_COC_MOD_MODEL` still overrides the
setting but is fixed for the life of a session. Telling an operator to restart a table they could have
kept is its own lost turn.

### 38.6 Acceptance

1. A turn in `acting` whose agent run ended with no delivery under a paused review accepts the next
   `table.player_input` with `release: "stranded"`, writes a `closed_by: "stranded"` record carrying that
   turn's receipts, and opens turn n+1 with a capsule.
2. Without `release`, the same call still fails `turn_state`; with `release` on an `awaiting_player` or
   `asked` turn it fails `invalid_params`.
3. A stranded record produces no commit, no memory job, no checkpoint, no Director adoption row and no
   keeper transcript line, and is not read back as a delivery by continuity, continuation, source audit or
   story assessment.
4. A still-live run is never released merely because it has not delivered yet. Once `agent_settled` records
   the same `open`/`acting` no-delivery state, the next player input is released regardless of whether the
   review and provider were healthy.
5. Live: the retained `midgame-bridge-live-21` deadlock cannot recur — after a paused review strands a
   turn, the player's next utterance opens a new turn on the same unresolved reentry.
6. A run that ends undelivered under a paused review emits exactly one displayed service notice, in the
   campaign's `play_language`, and never the rejected draft. A second run with no notice owed emits none.
7. The outage count rises once per paused run however many verbs are refused after the pause, is reset by a
   landed `narrate` and not by a turn boundary, and from the second consecutive outage the notice drops the
   retry promise and one `coc-review-status` `status: "down"` entry carries the streak and the fix.
8. A run whose final provider call ends in `error`, with no later completed assistant message and no
   delivery, emits one provider-specific service notice and marks the turn stranded. The next player input
   releases it and opens a new turn. If a later provider call completes and the run delivers, it is not
   stranded.
9. Any other run that settles `open`/`acting` with no delivery emits exactly one cause-neutral service
   notice, preserves whatever settled, and marks the turn stranded. An already-sent review notice or the
   provider-specific terminal notice suppresses the generic one; the player never gets two failure notices
   for one run.

### 38.7 A provider call that dies leaves a trace (2026-09-14)

§38.5 settled a principle wider than the review lane it was written for: **an infrastructure failure must
not be indistinguishable from normal slowness.** The provider call itself was the one place that still was.

**Retained live evidence** (campaign `game-5779d0fd-7dac-41de-b1f5-1a0f05132e2a`, turn 3, 2026-09-14, from
the campaign's own `telemetry.jsonl`):

```
{"turn":3,"lane":"provider-request", "at":"2026-09-14T13:06:45.933Z", ...}
{"turn":3,"lane":"provider-call",    "at":"2026-09-14T13:11:45.944Z","from":"request","ms":300011,"stop_reason":"error","blocks":[]}
{"turn":3,"lane":"provider-request", "at":"2026-09-14T13:11:47.968Z", ...}
{"turn":3,"lane":"provider-response","at":"2026-09-14T13:11:50.600Z","status":200}
```

One call held the line for 300 s and came back with nothing at all — no blocks, no response row, only the
error. The immediate retry answered in 2.6 s and the turn then finished normally in about a minute. The
player saw one spinner reading 「模型仍在处理 · 已用时 3min49s」, and once the retry succeeded nothing
anywhere said that five of those six minutes had been an outage rather than the model thinking. A retry
that happens to work is not a reason to erase the call that did not.

**The 300 s ceiling is not ours, and is deliberately not touched.** It is set nowhere in this repository,
`@earendil-works/pi-ai` does not read `API_TIMEOUT_MS`, and pi gives an extension only the observational
`before_provider_request` / `after_provider_response` hooks — there is no interception point at which a
shorter deadline could be imposed. What is in scope is the record.

**Every failed call reaches the operator.** `message_end` already times the whole call and writes the
`lane: "provider-call"` row; a row whose `stop_reason` is `error` now also writes one out-of-fiction
`coc-provider-status` session entry and `coc:provider-status` bus event, in the shape of §38.5's
`coc-review-status` and §32.2's `coc-admission-status`: `{campaign, turn, status, streak, ms, model?,
provider?, detail?, fix?}`. `ms` is how long the table waited for nothing, which is the whole point. The
model and provider come from the request hook, held across the call, because a call that dies produces no
response row and that is the only place they still exist.

**Streaks are counted the same way the other two lanes count them.** A completed assistant message — the
proof the provider answered end to end, body stream included — resets the count; a turn boundary does not,
because an outage is a service condition rather than a turn context. From the second consecutive failure
the entry is `status: "down"` and carries a `fix` (check the provider and the route to it, or move the
table), once per streak rather than once per call.

**A long call also owes the player a word, and a short recovered one does not.** Once `agent_end` can see
that the run has delivered, a provider call that died after holding the table for at least
`PROVIDER_OUTAGE_NOTICE_MS` (60 s by default; `PI_COC_PROVIDER_NOTICE_MS` moves it) emits exactly one
displayed service notice of its own, in the campaign's `play_language` from the extension caption surface
(§23) — never prose, never through `narrate`. An open run keeps the failed-call fact until
`agent_settled`; a terminal provider failure then emits the notice regardless of duration, because it is
the run's only visible result.
It says the connection dropped, roughly how long returned nothing, that this was an outage rather than the
Keeper thinking, and that nothing the player did was lost; from the second consecutive outage it stops
reading as a one-off. Below the threshold the operator entry is still written and the table is left alone:
a provider that errors in a second and is retried is a blip the player never noticed, and a service message
about it would be noise on a turn that went fine.

**The final run state chooses one player notice, and diagnostics remain separate.** `agent_end` sends a
long-outage footnote only after an actual delivery, and may send §38.5's paused-review notice; it never
spends the provider notice on an open turn. `agent_settled`, the first point that knows retries are exhausted,
turns the retained failed call into the terminal notice. A terminal provider failure therefore wins over
the long-outage wording and says the turn did not finish; a recovered long failure reads as a footnote after
the delivery. If the player already
received the paused-review notice, no second provider notice is displayed, while every provider status row
and operator entry remains. The entry write is best-effort and the caption read falls back to an English
line: nothing on this path may block or fail a turn.

**Three ends (§31).** *Writer:* the `message_end` handler, from the provider hooks' own timing. *Reader:*
the operator, through the `coc-provider-status` entry and bus event, and `kpi.py` through the
`provider-call` rows that already said `error`. *Actor:* the operator, who can see that a wait was an
outage and act on the provider rather than the Keeper; and the player, who is told the same thing in one
sentence. As in §32.7, the escalation is not a telemetry row — the consecutive `stop_reason: "error"` rows
already say it to the run analysis; only the delivery of the player's notice adds a row
(`lane: "delivery"`, `reason: "provider_outage_notice"`).

**Acceptance.** A dead call whose retry saves the turn still leaves one operator entry and, when it crossed
the threshold, one player notice while the delivery is unharmed; a recovered dead call below the threshold
leaves the entry and no notice; a second consecutive dead call escalates once to `status: "down"` with a
`fix`, and a completed call — not the turn boundary — resets the streak. A terminal failed run emits exactly
one terminal notice regardless of duration and releases its stranded turn on the next input; crossing the
long-call threshold must not replace that terminal wording, and a simultaneous paused-review failure still
produces one player notice while both operator diagnostics remain (`tests/extension/provider-outage.test.mjs`,
`tests/extension/continuity-audit.test.mjs`).

**A provider that dies for good strands the turn; a recovered failure does not.** When the run ends
`open`/`acting` with no delivery and its final provider call is still `stop_reason: "error"`, the same
host-owned fact both forces a service notice and satisfies §38.3. The next player input releases the turn
through §38.2 instead of hitting `turn_state`. Any later completed assistant message in that run clears the
terminal-failure mark, so the retained turn-3 shape above — one failed call, a 2.6 s successful retry, then
a normal delivery — records and reports its outage but is never stranded.

### 38.8 A stale review binding is retryable, and the review lane is observable (2026-09-15)

Three retained `continuity_review_unavailable` turns from one browser playtest (2026-09-15) had three
different causes and, from the campaign's own telemetry, one indistinguishable shape: a long `narrate` that
returned `needs`, one `review_unavailable_notice`, and a stranded turn.

| run | `narrate` | retained cause in `review-budget.json` |
|---|---|---|
| H-MAIN `game-83177d61` t17 | 40 735 ms | `The private reviewer ended without a checked submission` (child killed at `per_review_ms`) |
| M-MAIN `game-3dd94f0a` t9 | 40 266 ms | the same; the child's stream stalled 1.6 s in and never resumed |
| A-MAIN `game-7dca41f9` t4 | 8 934 ms | `Source audit no longer matches the current campaign evidence` |

**The review is not a §12.8.1 subsession, so it wrote no lane row at all.** It is a `mod` child run through
`runtime.runTask`, and its only record was `.coc/mods/jobs/<digest>/audit-attempt-N.json` next to the job.
Read from the campaign, the absence of any lane row looked like a review that had never been started; two of
the three had in fact been started and killed at the 40 s cap. **Every continuity review now writes exactly
one `lane: "continuity-review"` telemetry row** — `{job, ok, ms, attempt?, requests?, submitted?, child_ms?,
timed_out?, model?, verdict? | code?, reason?, cause?}` — on the turn that paid for it, whether it passed,
revised, timed out, or never started. `model` is read from the child's own command line, because the runtime
resolves the lane model (§37.10) and the request cannot say which one ran. The row is best-effort and never
fails a review. This is a diagnostic row, not an escalation: §38.5's `coc-review-status` entry is unchanged.

**`cause` is `details.cause`, never the wrapper message.** `reviewUnavailable()` gives all eight of its
distinct conditions one `message` — *"Continuity review is paused; no draft was approved"* — and puts the
condition itself in `details.cause`. A row carrying the message says nothing: H-MAIN turn 42 (a review that
ran, submitted, and exhausted `max_rewrites`: `The bounded Keeper repair did not resolve the review`) and
H-MAIN turn 43 (a child killed at the cap having submitted nothing: `The private reviewer ended without a
checked submission`) printed the same sentence, and the two are opposite operational facts. `reason` stays
the closed contract field it is; `cause` is what separates the families.

**`mod_audit_stale` is a race, not a verdict, and must not latch the turn.** `mods.job` pins the evidence
digest; `mods.accept` recomputes it and refuses a binding that moved, with the fix *"Retry the same narration
to prepare a current source audit; do not reroll settled actions"*. The Mod bridge turned that refusal into
`AuditBudget.fail`, which writes `blocked` into the turn's retained review accounting — permanently, for the
rest of that player input. A refusal the kernel declares retryable became a refusal nothing could retry, and
§38 stranded the turn.

A-MAIN turn 4 is the evidence, and the writer that moved the evidence was the host's own:

```
{"turn":4,"tool":"narrate","ms":12196,"ok":false,"reason":"mod_narrative_repair"}   04:39:29 → revise
{"turn":4,"tool":"narrate","started_at":"...T04:39:47.313Z","ms":8934,...}          the repair's review runs
{"lane":"lane-call","turn":3,"subsession":"memory","at":"...T04:39:51.260Z","phase":"end","ok":true}
{"lane":"memory","turn":3,"ok":true,"ms":78315,"candidates":3}                      3 rows appended to memory.json
{"turn":4,"tool":"narrate","ms":8934,"ok":false,"reason":"continuity_review_unavailable"}
{"turn":4,"tool":"narrate","ms":1,"ok":false,"reason":"continuity_review_unavailable"}
```

The memory lane for **turn 3** landed its candidates while **turn 4**'s review was in flight; `memory.json`
is part of the audit evidence and therefore of the binding, so `mods.accept` refused the very packet it had
prepared 9 s earlier. Nothing was wrong with the draft, the reviewer, or the allowance.

**So `mod_audit_stale` propagates to the Keeper unchanged instead of blocking the budget.** The Keeper reads
the kernel's own message and fix and retries the same narration; `mods.job` then pins fresh evidence, and a
new review runs against it. Nothing is skipped and no verdict is assumed: the retry pays for a whole review,
and `AUDIT_LIMITS` (§37.9) still bounds how many reviews one player input may buy — an exhausted allowance
blocks exactly as before. The non-continuity audit path had always re-raised this refusal; only the
continuity path swallowed it.

**A reviewer that never submitted still latches, deliberately.** The H-MAIN and M-MAIN shape is §37.9's:
the lane model did not answer inside `per_review_ms`. Retrying buys a second dead 40 s and then blocks
anyway on the shared `time_ms`, which is why §38.5 escalates to the operator with "choose a faster review
model" rather than retrying. Only the binding race is reclassified here.

**Three ends (§31).** *Writer:* the Mod bridge, from the kernel's own `details.reason`. *Reader:* the Keeper,
which receives a retryable refusal with a fix it can act on, and the operator, through the new telemetry row.
*Actor:* the Keeper, which re-narrates the same draft in the same turn rather than losing it.

**Acceptance.** A `mods.accept` that refuses `mod_audit_stale` leaves the review accounting unblocked and
surfaces `mod_audit_stale` to the caller, and the next `narrate` of the same turn runs a real review and can
be delivered; every other accept failure still blocks; a review that passes, a review that is refused, and a
review whose runtime is missing each leave one `lane: "continuity-review"` row
(`tests/extension/continuity-audit.test.mjs`).

### 38.9 A streak counts outages, not the guard doing its job (2026-09-15)

§38.5 escalates a table to `status: "down"` on the second consecutive review pause: the player is told
another attempt is pointless, and the operator is handed the lane-model fix. `pauseReview` counted every
pause, whatever caused it. Half of the streak that first triggered it had no lane problem at all.

Retained evidence, `game-83177d61` (2026-09-15), from its own `telemetry.jsonl` and review accounting:

| turn | child | retained cause | streak |
|---|---|---|---|
| 42 | `submitted: true`, 17 386 ms | `The bounded Keeper repair did not resolve the review` | 1 |
| 43 | `submitted: false`, killed at 40 014 ms | `The private reviewer ended without a checked submission` | 2 |

Turn 42 is `max_rewrites` (§37.9) working exactly as designed: the review ran twice, submitted twice and
refused twice, and the input ended. **A table is not down because its reviewer disagreed.** Turn 43 is a
dead stream. Summed, they produced an escalation whose wording and whose fix were wrong for one of the two.

**So a pause carries its kind, and only a service pause accumulates.** `reviewUnavailable(cause, service)`
puts `service` in `details` beside `cause`; `AuditBudget.fail(cause, service)` records it in the retained
accounting as `blocked_service`, so a later review of the same input replays the kind instead of re-reading
a verdict end as a fresh outage. Every branch in which the reviewer *reached a conclusion*, or in which the
allowance those conclusions consumed ran out, is `service: false`: `max_rewrites`, the same rejected draft
resubmitted, a `verdict: "unavailable"` submission, and every exhausted-allowance end. Everything else — a
child that submitted nothing, an unreadable or interrupted accounting file, a lock another review holds, a
missing runtime — stays `service: true`. `reason` is unchanged: both kinds still end the player's input and
the Keeper's lawful response to either is identical, so splitting the closed contract field would buy
nothing.

The operator entry gains `service`, so `coc-review-status` says which kind it was rather than leaving it to
be inferred from the cause sentence. A verdict pause emits `status: "unavailable"` with no `fix`, and never
raises the streak on its own; two genuine outages still escalate once, exactly as before.

**This is not a relaxation.** A verdict pause still ends the input, still publishes nothing, and still
requires new player input — the guard is untouched. What changes is only whether that counts as evidence
that the lane is broken.

**Three ends (§31).** *Writer:* `AuditBudget`, at the site that knows which bound fired. *Reader:*
`pauseReview`, and the operator through `coc-review-status`. *Actor:* the operator, who is no longer sent to
change a lane model over a disagreement; and the player, who is no longer told that trying again is
pointless when it is not.

**Acceptance.** Two consecutive verdict pauses leave `streak: 0`, emit no `down` entry and no `fix`, and
leave the player the "send anything to try again" wording; two consecutive service pauses still reach
`streak: 2`, `status: "down"` and the lane-model fix; a retained block replays its own kind
(`tests/extension/continuity-audit.test.mjs`).

### 38.10 The player notice states what happened and what is worth doing (2026-09-15)

§38.9 made the *streak* honest. The three sentences the player actually reads were not, and two of
them were false on live tables.

**A review that finished is not a review that "did not finish".** `review_unavailable_notice` says
the continuity review did not finish. On H-MAIN turn 42 (`game-83177d61`) two reviews ran, both
submitted, and took 23.2 s and 17.4 s; the input ended on `rewrites(1) >= max_rewrites(1)`, the
bound §37.9 exists to enforce. The one fact the player was given about their own turn was wrong, and
it pointed them at the wrong remedy: nothing about that turn was going to be fixed by waiting.

**A streak is not a locked table.** `review_down_notice` said *"sending it again will not help"*.
`before_agent_start` clears `reviewUnavailable`, every new input opens a turn with a fresh allowance,
and a landed `narrate` zeroes `reviewOutage`; a streak changes the wording and nothing else. The
playtest run that found this recorded the table as unrecoverable and stopped on that sentence, then
sent one more line and received a complete turn. A notice that stops a player who could have carried
on is a worse outcome than the outage it describes.

**So the notice is chosen by the kind of pause, not by the streak alone.** `pauseReview` pins the
kind of the pause that stopped the review (`reviewPauseService`) on the same first pause that owns
the streak, because every later verb in the run re-throws through the guard, whose error carries no
`service` at all and would relabel a verdict as a dead lane by its own second symptom. Three
captions on the `extension` surface:

| pause | caption | what it tells the player |
|---|---|---|
| `service: false` | `review_verdict_notice` | the review read the turn and did not approve it; settled work is kept; send anything and the Keeper writes it again |
| `service: true`, streak < 2 | `review_unavailable_notice` | the review did not finish; send anything to try again |
| `service: true`, streak ≥ 2 | `review_down_notice` | it has failed `{streak}` times; sending again does still open a fresh attempt, and if it keeps failing, pick a quicker model under **Lane model** in settings — the next review uses it without restarting this table (§37.10) |

The streak line names the only operator lever the product actually has, in the words of the setting
that carries it, rather than telling the player to stop. `details.service` travels on the delivery
message and on the `lane: "delivery"` telemetry row beside `streak`, so which sentence was chosen is
recoverable from a transcript.

`mods.review.status` gains `service`, read from the retained accounting's `blocked_service`, so a
turn recovered through the watchdog replays the kind that blocked it instead of counting a retained
verdict end as a fresh outage. An invalid or unreadable accounting file and an interrupted
reservation answer `service: true` in their own right.

**Three ends (§31).** *Writer:* `pauseReview`, from the pause that stopped the review. *Reader:* the
delivery notice at `agent_settled`, and anyone reading the telemetry row. *Actor:* the player, who
is told whether another attempt is worth anything, and the operator, who is pointed at Lane model
rather than at nothing.

**Acceptance.** A verdict pause and a service pause in the same table produce different sentences,
and the verdict one never says "did not finish"; a verdict pause on a table already at `streak: 2`
still reads as a verdict; a service streak of 2 names Lane model and never says another attempt is
pointless; the verbs refused after a verdict pause do not relabel the run
(`tests/extension/continuity-audit.test.mjs`).

## 39. Session maps revealed by player knowledge (2026-09-13)

The map feature uses the existing seven verbs and the existing ModuleGraph, campaign world state, source reader and structured mechanics delivery. It adds no map tool and no second state store. A map is an `asset` or `handout` node whose `properties.map_regions` is a non-empty list. Each row is `{region_id, name, level?, source_asset, source_box, placement, redactions?, safe_after_redactions?}`. `source_box` and `placement` are normalized `[x0,y0,x1,y1]` boxes. The source asset is a graph `asset`; it must be `player-safe` or `revealable`, unless an independently reviewed private source supplies non-empty redactions and explicitly declares `safe_after_redactions: true`. Source variants never share coordinates by assumption.

`apply {effects:[{kind:"map", name, regions:[...], region_labels, level_labels, label, why}]}` records newly established spatial knowledge. `name` and every region are semantic names; `region_labels` must map every chosen id and `level_labels` must map every source level among them to player-facing words in `play_language` (an empty object when none has a level); `label` does the same for the map; `why` states what in the fiction established the knowledge. That requirement binds this path because the Keeper writes these words; the first-arrival path of §39.2 has no Keeper in it and takes its words from the host's presentation lane instead. The kernel validates all references and the complete label sets before commit, unions the region ids into `world.map_knowledge[map]`, keeps the supplied words in `world.map_labels[map]`, and emits one `map` receipt plus `map-revealed`. Visiting a scene, hearing a place name, receiving a handout, or an asset being `player-safe` never writes this state by itself. A rejected batch writes none of it. The same call id replays normally.

The receipt carries `{map, name, label, regions, known_regions, source_revision, why}`. Its mechanics projection carries only the map/title, revealed region labels, source revision and receipt identity. Private source paths, full images, unrevealed region rows, redaction boxes and placement geometry do not enter that projection. A host-only `map_views` payload resolves the source assets and is consumed before the tool result reaches the Keeper. The host crops and redacts the authorized layers, composes only their known bounding box onto an opaque background, writes an immutable campaign derivative, and replaces the private payload with a short availability summary. Only that flattened derivative is placed in the `coc-mechanics` entry as a structured `map` row.

`look {focus:"map"}` lists map and region semantic names with their current known flags. With `name`, it also prepares the current known view without changing state; the next `ask` or `narrate` can place it in the conversation. Opening, zooming, panning and reopening an existing card are renderer-local reads: no RPC, model call, turn, clock, receipt, item, clue or movement results. An unavailable source produces a named unavailable row and never falls back to the private base image.

Map source preparation is shared module material; `map_knowledge` is campaign state. New campaigns start with `{}`. Worldline confluence unions known regions under the existing cross-line knowledge policy. A card embeds the immutable derivative for its delivery-time source revision and known set, so an old card cannot silently become a later or foreign view. Source repair or replacement cannot apply an old region layout to changed bytes without a newly reviewed graph generation.

The visual reader may create region metadata and source assets during opening or demand reading. When a PDF has no published map material, `look {focus:"map", name?}` raises the existing `needs`/`material_pending` gate with `details.read: {purpose:"detail", material:"map", focus, question, pages?}`; the extension sends this descriptor through the existing reading queue, then retries the unchanged look. The closed `material:"map"` discriminator is part of reading-job identity and is carried into `task.json`; it is not a new Keeper tool or scheduler. Built-in modules and already-published maps do not raise this gate. It uses original page images, the existing tool-enabled reader and independent review. Map classification, region-place correspondence and annotation safety remain semantic reader/reviewer decisions; the host checks shapes, references, file confinement and bytes. The kernel never parses a PDF or image. Public titles and added labels follow `play_language`; authored pixels and physical-handout text remain verbatim.

The three ends are explicit. The Keeper writes newly learned region knowledge through `apply map`; `look focus=map` and the mechanics projection read it; the first arrival at a depicted scene places the player-safe floor plan as supplementary material in the delivery, and later `apply map` still records what was actually learned.

### 39.2 First arrival places the depicted map in the delivery

A published player map that `depicts` a scene is supplementary material for that place, not a thing the player has to ask for and not a sentence in the story. The first real `apply move` (not a rename) onto such a scene, when that map is not yet in `world.maps_presented`, mints one `map` receipt for the map's player-safe (and independently reviewed `safe_after_redactions`) regions, records the handle on `maps_presented`, and includes the host-only `map_views` payload. It does not write `map_knowledge` for secret rooms, does not require `look`, and does not wait for the Keeper to `apply map`. Returning to a depicted scene does not place the card again.

The receipt is bindable as `{{map:<map-handle>}}` (§16.6). Like every mechanics receipt, if the Keeper does not place that marker, the kernel appends it to `marked_text` so the frontend mounts the row in the delivery body; `rendered_text` still has no braces. The story text describes the place immersively. It does not mention a map, a floor plan, or what is "on the map"; those words are out of game. The picture is extra material beside the scene, the way every other mechanics row is extra material beside the prose.

**Its player-facing words come from the host's map presentation lane, not from the module.** §39 above requires `apply map` to carry `label`, `region_labels` and `level_labels` in `play_language` because the Keeper writes them. A first-arrival card has no Keeper in its path and so had no writer for those words at all: the kernel mints it out of the module's authored labels -- the map's `display_name`, each region's `name`, each level's name -- which are in whatever language the module was written in. Retained live evidence (campaign `game-5779d0fd-7dac-41de-b1f5-1a0f05132e2a`, turn 2, a table whose `play_language` is `zh-Hans`): one map title, nine region labels and three level labels reached the player in English while every other mechanics row of that turn was in the play language. Both paths produce the same projection shape for the same consumer, so a rule that bound only one of them was a gap in this contract and not merely in an implementation.

A card therefore says which leg wrote its words. Every `map` receipt and its mechanics projection carry `words`: `"play_language"` on the `apply map` path, and `"source"` on the arrival path until the host has replaced them. `table.open` carries `authored_map_words`, every caption the module's **player-safe** map regions could print, distinct and ordered; a region that is only safe behind reviewed redactions never contributes, because its name is module truth and has no business leaving the kernel to be rewritten. The host projects that whole set once per campaign home and tag through the §23 presentation lane -- a tool-enabled presenter with its own checker, cached under `.coc/map-words/<tag>-<digest>.json`, where the digest is the presenter's instruction -- and starts it when the table opens rather than when a card is minted: an arrival is minted inside `apply move` and is on screen at the end of that same turn, which is not room for a model round trip. Nothing anywhere decides which language the authored labels are already in. The presenter is told to copy a caption that is already in `play_language`, because that is a semantic judgement and §23 forbids settling one in code; no tag is compared, and no table is keyed by a language.

At delivery the host substitutes the projected words and sets `words: "play_language"`. **A card is wholly projected or wholly authored, never half of each** -- half a floor plan in each language reads as a rendering fault rather than as a pending lane, and `label` and `level` on one region are what a player matches against the picture. A card whose words are not ready is still delivered: the picture of the place is worth more than a withheld one. What is forbidden is delivering it *silently*. It keeps `words: "source"`, and the host writes one `lane: "map-words"` telemetry row naming the map and how many captions were missing, so a card that shipped in the author's language stays visible afterwards instead of being indistinguishable from one that did not -- the rule §38.5 states for an undelivered turn, applied to an unprojected word. The lane never blocks a turn: it is started beside the turn and never awaited, a run that fails leaves its row and the words it did validate, and a caption two rounds could not project is not asked for again on that table.

**The three ends (§31).** *Writer:* the module's author, for `authored_map_words`; the presentation lane, for a tag's cached words; the kernel, for `words` on every `map` receipt. *Reader:* the host's delivery hop, which reads `words` to know whether a card still owes a projection, and the retained turn record, where a delivered `words: "source"` is the only evidence afterwards that one shipped unprojected. *Actor:* the host, which either substitutes the words or records that it could not.

### 39.1 Canonical source revisions and compatibility

A delivered map is bound to a **reviewed source revision**, not merely to a semantic map id or a renderer view hash. The canonical revision is the reviewed ModuleGraph generation (`graph.digest`) plus any reviewed per-asset byte digest carried in the published asset metadata (`source_digest` or `asset_digest`). The map view carries that binding as `source_revision`; each rendered layer may carry the reviewed `source_digest`. Publication is the only writer of these reviewed digests: a file changed in place without a new reviewed publication is not a correction and is unavailable.

A **compatible correction** keeps the same reviewed map generation identity, source asset identity, source byte digest, region ids, source boxes, placements, redactions and safety review; only non-geometric metadata such as a spelling or player-language label may change. Such a correction may reuse the existing authorization and delivery-time derivative. Any changed source bytes, source boxes, placements, redactions, region correspondence, safety classification or map geometry is an **incompatible update**. It requires a new reviewed publication and a new canonical revision before any region is rendered. Until then, current map reads return the existing authorized metadata with `available: false` (or an equivalent `review`/`preparing` status); they never apply old region authorization to the new bytes. The host compares a supplied reviewed `source_digest` with the confined file bytes and fails closed on mismatch.

Historical cards retain their embedded delivery-time derivative and source-revision fields. They are not re-rendered when the module or campaign changes. A current-map read is evaluated against the active reviewed revision and may be unavailable while an incompatible update awaits review. Campaign knowledge remains in existing world state, and worldline fork/switch/confluence do not create a second map store or transfer a derivative across campaigns. Map offers may be measured but never feed obligations or quotas into later turns.

## 40. NPC speech: the say token, speaker colour, and the `npc-voice` lane (2026-09-15)

Spec: `docs/specs/npc-speech.md`. User rulings 2026-09-15: the wrapper form; marking is mandatory and the §30.7 brief ceiling is raised to make room; colours are hashed by the host and never stored; **the model never reads or writes a high-entropy id or hash** — the token carries a name; every person talks their own way, in spoken, colloquial words of their class, trade, era and place; coarse language is on by default and is a package setting with a sidebar toggle.

### 40.1 The token

A spoken line is written as `{{say:<name>}}…{{/say}}`. The open token carries the speaker's name; the close token is invariant; the spoken words lie between, **with the quotation marks the play language writes speech with kept inside the token** (2026-09-15 A/B: "or none" let the Keeper drop 「」 for the token — one 「 in twelve turns against twenty-eight with the marks kept — and the stripped prose read flat; the token wraps the line, it never replaces its marks). Narration, gesture and "he said" stay outside. Every line spoken aloud by anyone other than the narrator is wrapped: NPCs, and the investigator when the uptake renders the player's speakable line. Thought, signage, a document's text and reported speech are not lines.

`<name>` is the person exactly as `present[].name` gives it — the string `apply npc` takes, the string the journal lane copies — never a handle, node id, receipt id or hash (§16.6's invariant). Someone not in `present[]` is written under the label the prose uses for them (`the woman in the black coat`); the same label again is the same person to the host. Name text: anything but `}}` and a line break, trimmed, 1–60 characters.

**Repairs, never refusals** (§34.14's rule extends to this token). No nesting: an open before a close closes the previous span at the new open. An open with no close closes at the end of its paragraph (the next blank line or the end of the text). A close with no open is removed. A mechanics marker inside a span is moved to immediately after the span's close. `rendered_text` is stripped of both kinds of token; no brace reaches the player.

**Resolution is by name, deterministic, kernel-side.** In order: someone in the turn's `present[]` (`ModuleGraph.nameKeys`, normalised, the way `resolve` matches); an investigator of the party by name; any NPC of the graph when exactly one matches. No match, or more than one, and the name stays a **label**. No fuzzy matching, no character-overlap heuristics, no word list deciding what kind of person a label denotes.

### 40.2 Delivery outputs (`narrate`, `ask`)

- `rendered_text`: as before, now also free of say tokens.
- `marked_text`: emitted whenever **any** token was placed, mechanics or say (before this section: only when a mechanics marker bound). Carries both kinds after repair. A say token is never a mechanics marker: `bindMarkers` never sees it, never reports it in `dropped_markers`, never counts it in `placed`; the host's `splitDelivery` already skips a token that names no row.
- `speech`: on the turn record and the delivery result, text order, one row per span: `{who: {npc: <handle>, name} | {investigator: <sheet id>, name} | {label}, text}` — `text` is the spoken words with tokens stripped. `npc` is the graph handle (the same `id` `npcView` shows; a name the model may hold), never a node id: the whole result is the tool text the model reads.
- **To the Keeper** the result adds `unresolved_speakers: {names, note}` only when a span named nobody; informational (a person present is named as `present[].name` gives it). Never a refusal.
- `deliveryRecord` persists `speech`. Old records without it read as before.

### 40.3 Adoption

- **Telemetry.** One `coc-telemetry` row per delivery, written by the kernel extension: `{lane: "speech", turn, lines, resolved, unresolved, present}` (spans, spans that resolved to a person, spans left as labels, people in `present[]`). This is what "mandatory" is measured against, per model.
- **NPC ledger.** `npc_ledger[id].spoke = {turns, last_turn}` updated at commit from `speech[]`; `present[].history.last_spoke_turn` shows it.
- **Journal (§17.10).** `journal.job` packets carry `speech: [{name, text}]` (resolved NPC spans only); the recordable set (`collectNamed`) adds every resolved NPC speaker. The `npcs.journal` projection rows carry `id` (the handle) so the sheet panel can paint the legend swatch. The journal stays a paraphrase.
- **Verifier.** A fifth finding kind, `unmarked_speech`: a spoken line in the delivered prose outside any say span. Accepted by `table.warn` like the other four; a warning, never a refusal.

### 40.4 Host rendering (PipiCOC; a host decision, no kernel RPC)

The delivery card cuts each text run of `marked_text` at say tokens and renders every span as `<span class="coc-say" data-who="npc|investigator|label">` tinted by a CSS variable, with a hairline left rule in the same hue. Colour: FNV-1a over the **anchor** (the NPC's handle, the investigator's id, or the label string) into a palette of 16 hues authored once in CSS with a light and a dark value each; within one rendered transcript the host keeps the slots already taken and linear-probes from the hash slot to the next free one, in transcript order, so two people at a table never share a hue and a reload paints the same colours. Investigators take one fixed slot outside the hash palette. **Nothing is stored** — not on the NPC record, not in the campaign, not in `localStorage`. No avatar, no inline name chip; a `title` with the name through `term()`. The sheet panel's NPC section paints the same swatch beside each journal row (the legend). Both render paths — the live tool-result card and the restored transcript card — must render the token; the `proseBlocks` strip must remove `{{say:…}}` / `{{/say}}` with non-ASCII names, or the token reaches the player. No authored per-language literal enters the host (§23).

### 40.5 The `npc-voice` package and its lane

`mods/npc-voice` (default-enabled; `requires: ["graph.vocabulary.v1", "graph.vocabulary.table.v1", "context.npc.v1"]`) contributes:

- `vocabulary.actor_profile_keys: [{key: "sample_lines", label: "sounds like", shape: "lines", ask: …}]`. **`shape: "lines"` is new vocabulary on a contributed key**: its value is a list of at most two bounded strings instead of one line. `tableWords` passes a list through as a list, so `present[].<label>` is a list. `apply {kind: "dossier"}` refuses a `shape: "lines"` key (`invalid_params`, fix naming the lane): the Keeper does not author sample lines mid-turn. The reader is told, through `ask`, to preserve a book's printed speech as authored `sample_lines`; the lane never runs for a person the source already gives them (§28.7: the book's word stands).
- `settings: {coarse_language: true}`, `settings_schema.coarse_language: {title: {en: …, zh-Hans: …}}` — a boolean, which the sidebar Mods panel already renders as a checkbox. It rides to the Keeper in the instruction row's `settings` (as every package setting does) and to the lane in the job packet.
- `instructions` / `brief`: `sounds like` is the register, never a line to read out; a line is spoken by that mouth (the words of that person's trade, class, schooling, era and place; talk, not prose; an oath where the person swears when `coarse_language` is on, a euphemism where they would not); two people who sound alike is the Keeper's fault; the narrator's register never enters a say span.

**Lane RPCs** (the §17.10 shape; the campaign lock, like the journal):

- `voice.job {campaign, backfill?: boolean}` → the next person needing lines, or `{job_id: null}`. A person needs lines when the `npc-voice` package is enabled, the source gives no `sample_lines`, and none is established. Order: people present in the latest committed record, then anyone the ledger has met, then (only with `backfill: true`) every other NPC of the graph. Packet, closed fields: `job_id` (`voice:<campaign>:<handle>`), `play_language`, `module: {title, era?}`, `coarse_language`, `npc: {handle, name, role?, wants?, fears?, hides?, voice?, speaks?, would_lie_about?, deflect_lines?, knowledge?}` (the Keeper-side dossier, as `present[]` shows it), `documents: [text…]` (the person's own documents, ≤ 4 KB total), `budget: {lines: 2, max_chars: 120}`, `instruction` (the fixed English instruction; the lines themselves are written in the play language). Opening a job is idempotent; a `done` job is never reopened; a `failed` job is offered again (the lane limits retries).
- `voice.submit {campaign, job_id, sample_lines, reason?}` — deterministic validation, shape only: exactly two strings, each 1–120 characters after trim, distinct, no `{{`, no line break; **or** `sample_lines: null` with `reason: "does_not_speak"` (2026-09-15, the first table gave the rat swarm and the haunt two lines each because the shape demanded two): the person is settled with `{value: null, reason}` under the key, the read side emits nothing for a null value, and `voice.job` never offers them again. Established means a record under the key, lines or silence. Refuses `invalid_params` when the source authored the key. On pass writes `world.mods.state["npc-voice"].dossier[<node_id>].sample_lines = {value: [a, b], label: "sounds like", turn, mod: "npc-voice"}` and appends the §28.7 event `dossier-established {npc: <handle>, keys: ["sample_lines"]}`; result `{job_id, npc: <handle>, name, sample_lines}`; a same-digest resubmit replays, a different one is `idempotency_conflict`.
- `voice.fail {campaign, job_id, reason, detail?}` — `reason` from `journal.fail`'s closed enum (`invalid | lane_error | model_error`).

Nothing semantic is checked in code: no "generic" detector, no language detector, no table mapping a trade to a way of speaking. The lane (`extensions/npc-voice`) is a zero-tool subsession: on `coc:turn-committed` it asks `voice.job` until `job_id` is null; backfill over the graph's unmet people runs only when `PI_COC_NPCVOICE_BACKFILL` is set to a positive number — **off by default** (user ruling 2026-09-15: the first real table spent eleven model calls at the door, a fifty-person book would spend fifty, and play is already covered by "present or met first"); the model comes from `resolveLaneModel` with `PI_COC_VOICE_MODEL` overriding; at most one retry per person per session; telemetry `{lane: "voice", npc, ok, reason?, ms}`. The value is Keeper-facing material like `voice`: never in `table.view`, never in the journal, never to the player.

**The voice guard (2026-09-15).** When the packet carries the book's `voice`, the lane makes a second zero-tool call that reads the two lines against that one-line description — register only: manner, temper, volume — and answers `{honours, why}`. `false` sends the lines back to the writing call once with the objection; whatever the rewrite brings is filed. One bounce, never a gate, and a judge that cannot answer waives. Telemetry `voice_check: passed | rewritten | rewrite_failed | waived` on the person's row. The lane instruction (`content/setup/npc-voice.md`) also changed the same day: the strained line is the person's own way of handling strain, decided by `fears`/`hides`/`voice` and their station rather than one fixed situation, an exclamation mark is not a register, and no other person's name may appear in a line (the packet's names are the book's, in the book's language).

**The host speech steer (§40, 2026-09-15).** On an implicit delivery with people in the capsule's `present[]` and no `{{say:` in the draft, the host drops the draft once and asks for the same turn with its lines wrapped (`coc-host` kind `speech`, telemetry `{lane: "speech", steered: true, present}`); the second leg is honoured however it comes and a second leg that brings nothing falls back to the dropped draft, exactly as the turn-floor steer of §34. The opening is exempt, and `PI_COC_SPEECH_STEER=0` disables the steer for an experiment's control arm. Nothing reads the prose: a machine token is searched for. Reason: on `deepseek-flash` the Keeper wrapped 29% of lines and closed 17 of 20 turns implicitly; the token was a suggestion it forgot after the opening.

### 40.6 Prompt bytes

`prompts/keeper.md` Law 4 names two machine tokens; the Writing paragraph states the say rule beside the marker rule; the floor's voice clause names the token. `content/craft/beat-directives.json` `floor_lines[voice]` is unchanged — the `style` section's 1536-byte budget (`kernel-ts/read/assemble.ts`) has no room, and a longer voice line pushed a first-turn directive out (`test_capsule_nine`); the token rule lives in the base prompt and the tool descriptions; `narration-craft` 1.2.1's brief names it (a byte changed is a version bumped, §26). The `narrate` and `ask` tool descriptions gain one sentence. **The §30.7 per-turn brief ceiling rises from 4000 to 5000 bytes for all active briefs** (`tests/kernel/test_mod_director_text.py` pins it); §34.8's "4000" reads as this section's 5000. Old package versions keep their bytes and locks (§26).


### 40.7 Voice masks: `voice_mask`, `exchanges`, and the capsule's `voices` (2026-09-16)

Supersedes the `sample_lines` word of §40.5 (`npc-voice` 1.1.0; design and sources in `docs/specs/npc-voice-mask.md`). Ruling: the spotlight is the player's, NPCs need no personality of their own, they need to be told apart, to sound like people, and to serve the player. Role-language research says the same thing as linguistics: readers identify a supporting character from one or two speech markers, and the protagonist speaks unmarked.

- **Two lines-shaped words** replace one. `voice_mask` (label `mask`): one line ≤ 200 chars — what the person calls themselves and the one they talk to, one sentence-ending habit, the level of their words, one pet phrase. `exchanges` (label `in exchange`): exactly three lines ≤ 200 chars each — a stranger's words, an arrow, this person's reply wearing the mask. Both are `shape: "lines"` (the manifest's `lines` helper now admits up to four authored lines), both are refused by `apply {kind: "dossier"}`, both die with the package. A book that prints the person's speech answers the reader's `ask`; the lane never writes a person the book gave either word.
- **`voices` capsule section** (budget 3072, `SLICE3_BUDGETS`): `[{name, <label>: <line | lines>, …}]` for every present person carrying any lines-shaped word, of any package — the rule is the shape, not the package; a one-line list arrives as its line. `present[]` no longer carries lines-shaped words (`presentSection(…, {voices: true})`); `look focus=npc` still does. A lines-shaped word is recognised by `graph.dossier.contributed[].shape` (book-authored, bound at build) or by `shape: "lines"` on the table record (lane-established). `fitBudget` trims exchanges before it drops a person. `head` says: wear the mask on every line that person speaks; never read an exchange out. Always present, `[]` when nobody carries one.
- **Lane RPCs.** `voice.job`'s order now starts with the people on stage in the current world (`npc_presence` at `active_scene`), before the latest committed record's `present`, so a delivered opening's commit writes the start scene's masks while the player types their first line (the real-module table: the employer's first two answers predated his mask; a `--pregen` driver table has no delivered opening and keeps that gap). Then as §40.5. The packet gains `taken_masks: [string…]` (≤ 12: the masks the book gives or the table established for *other* people of this campaign, no names) and `budget: {mask_chars: 200, exchanges: 3, max_chars: 200}`; `instruction` is the new fixed English passage. `voice.submit {campaign, job_id, voice: {mask, exchanges} | null, reason?}` — shape only: `voice` an object with exactly `mask` and `exchanges`; `mask` one line 1–200 chars after trim; `exchanges` exactly three distinct lines 1–200 chars; no `{{`, no line break; `null` only with `reason: "does_not_speak"`. Writes `dossier[<node_id>].voice_mask = {value: [mask], label: "mask", turn, mod, shape: "lines"}` and `.exchanges = {value: [a, b, c], label: "in exchange", …}` (silence: `value: null, reason` under both), **deletes** a `sample_lines` record left by 1.0.x, appends `dossier-established {npc, keys: ["voice_mask", "exchanges"]}`; result `{job_id, npc, name, voice}` (or `voice: null, reason`); idempotent by digest (`voice_sha256` on the job). Established = a record under `exchanges`. `voice.fail` unchanged.
- **The lane instruction** (`content/setup/npc-voice.md`) asks for the mask first (one or two markers a listener could name, different from every mask in `taken_masks` in the ending habit or the address terms, register never dialect caricature), then three exchanges in it: a first question brushed off, something ordinary, something that touches what they hide; every reply answers the words just said, says the mundane thing, and leaves the stranger something to say next; no aphorisms; no other person's name. The voice guard reads mask and exchanges against the book's `voice` and also asks whether every reply wears the mask; still one bounce, never a gate.
- **The package instruction** stops asking that every line wants something (the rule that produced aphorisms) and asks for three things: wear the mask on every line (pet phrase at most once a turn); talk like a person — acknowledge before answering, say the mundane thing, drift and return, whole sentences with the joints of speech in, a fragment is one beat, nobody says an aphorism; serve the player — a line reacts to what the player just said or did and leaves them something to say back, no line closes the subject, the investigator speaks unmarked. Brief ≤ 250 bytes, names `coarse_language`.
- **Acceptance** is the lineup test of `docs/specs/npc-voice-mask.md` §4 on the seeded starter `voice-bench` (`content/starters/voice-bench`, unlisted; generated by `tests/play/fixtures/voice-bench/build.mjs`): names stripped, a judge attributes each spoken line to the roster.

## 41. A refused player input is never the player's sentence (2026-09-16)

Retained live evidence, campaign `game-3dd94f0a-4b26-41bc-96fa-f89a60abb143`, turn 36, 2026-09-16T00:14:

```
{"turn": 36, "tool": "table.player_input", "ok": false, "code": "invalid_params"}
{"turn": 36, "lane": "context", "event": "degraded", "reason": "player_input_not_accepted"}
```

The kernel's own words, from the host's session record:

```
invalid_params: A contributed profile key needs exactly a key, a label and an ask
```

That is `validateVocabulary` in `kernel-ts/read/mods.ts`, reached from `readModCatalog`, reached from
`initializeMods`, which `table.player_input` calls before it does anything else. A **package manifest on
disk** refused, and the refusal came back on the player's sentence. The campaign's own `world.json` lock
names seven packages and every one of them validates, so the manifest that refused is one this campaign
never used. The player was told "这条没能收下，桌上什么也没动。请再说一遍你要做的事。" and said it again;
the same words failed the same way. The Keeper, holding a refusal whose `next` was `change_input`,
then called `narrate` three times into `awaiting_player` and was refused `turn_state` three times, because
no turn had opened for it to narrate into.

Three separate seams produced that, and this section closes all three.

### 41.1 The host owns the one field the player writes, so no refusal is ever a rewording

`table.player_input` takes `campaign`, `text` and the §38 `release`. Of these the player writes exactly
`text`, and its only rule is that it is a non-empty string. `campaign` and `release` are the host's.

- The host checks `text` itself, before the call. A blank message never reaches the kernel: the player is
  told their message carried no text, which is the one thing here they can act on.
- **Therefore every refusal the kernel returns for `table.player_input` is a fault at the table**, and no
  rewording reaches it. The host must never tell the player to say it again, and must never hand the
  Keeper a refusal that reads as if it should.

The host's answer is **report** — never retry, never repair.

- *Retry* is wrong because the call is deterministic: the same bytes refuse the same way. The retained
  table proved it by rephrasing and failing identically.
- *Repair* is wrong because the fault is outside the request. The kernel must not rewrite a package, a
  lock or a campaign to make a refusal go away; a broken manifest is an operator's repair.
- *Report* is what the player is owed. The host sends the player a visible service notice at once
  (`coc-delivery`, `details.input_refused`, caption `table_input_refused_notice`): the table could not take
  it, this is a fault at the table and not their wording, saying it again will fail the same way, nothing
  moved, and the reason has gone to whoever runs the table. The reason itself — the code, the message, the
  `fix` and the `details` — is an operator's repair, so it goes to the operator entry `coc-table-status`
  beside the notice, not into the player's line.

This is the run's one player notice (§38's rule): a refused input suppresses the generic
unfinished-turn line, and the two never both land.

The Keeper's own `coc-host` note (`kind: "player-input-failed"`) carries the kernel's text as before and
adds what it is for: no turn opened for this input, this is not the player's wording, and **do not tell
them to say it again**. It then states what the Keeper may do, from the turn state the host already
tracks. When the previous turn is still `open`/`acting` a delivery is still owed, so `narrate` may still
close *that* turn and say the new input has not been taken up (`details.deliverable: true`, the §22
reading-wait case) — and the host sends no service notice, because that delivery is the player's answer
and a notice beside it would contradict it. Otherwise there is no open turn, `narrate` and `ask` will be
refused `turn_state`, the player has already had the notice, and the run ends without output.

The context lane latched on this too. `pi.on('input')` sets `inputPending`, and only a capsule clears it —
but a refused input produces no capsule, so every lane request until the next *accepted* input degraded on
`player_input_not_accepted` and lost the §19.2 bounded context, on exactly the run that most needed it.
The host emits `coc:input-refused` and the lane clears the latch: no turn opened, nothing at the table
moved, so the capsule and binding it already holds are still the current ones.

### 41.2 A package that refuses its own bytes refuses its own material, not the table

This is §22's rule for an unread page, applied where it was still missing. `readModCatalog` was
all-or-nothing: it walked every built-in package beside the content root and every installed package in
the store, and a single manifest that failed validation threw out of the whole read. That read is on the
path of every `table.player_input`, `table.open` and `mods.*` call, so one bad manifest anywhere took down
every campaign on the machine, including every campaign that did not use that package.

- `readModCatalog` returns a `ModCatalog`: the packages that loaded, plus `unavailable` — one row per
  package directory that refused, `{id, version, path, reason}`. `id` and `version` are the directory's
  (a built-in has no version directory and reports `null`), because a manifest that did not parse cannot
  be asked what it is called, and the directory is where the repair goes either way. `reason` is the
  manifest loader's own sentence, unchanged.
- A campaign that does **not** lock that package plays on, exactly as before it existed.
- A campaign that **does** lock it is refused `campaign_not_ready` — not `invalid_params`, because nothing
  about the caller's parameters is wrong and `invalid_params` is the code the host's recovery table reads
  as "the player should say it differently". The message names the package and quotes the reason, `fix`
  names the directory to repair and says that no player input can change it, and `details` carries
  `{mod, version, path, reason}`.
- Nothing is dropped silently. `mods.list` carries `unavailable` beside `mods`, so a reader of that call
  sees a package that stopped loading rather than one that quietly stopped existing, and
  `initializeCampaign` writes one telemetry row per refused package,
  `{lane: "mods", event: "package_unavailable", mod, version, path, reason}`, on the catalog read the
  world initialization has already done. The sidebar Mods panel does not render the field yet; the
  telemetry row is what a live table leaves behind.

The all-or-nothing read had been noticed before and pinned from the other end: `npc-voice-package.test.mjs`
asserts that the shipped `shape: "lines"` manifest and the kernel that accepts it land together, because
the half-landed pair takes the whole builtin catalog down. Pinning the pair does not help a running table
whose tree changes under it, which is what the retained evidence shows: turn 36's input was accepted at
17:37 and the next one refused at 00:14, with no kernel restart and no campaign change between them, so
the bytes the catalog read changed while the table was live. That is a development machine's ordinary
day — a package edited in the tree a table is running from — and it is also what an install or an upgrade
does to the store.

**The boundary with §28.9: unreadable is not the same as not understood, and only one of them is this
section's.** The same live incident was answered twice, from two branches, and each answer was right
about a different half. The dividing question is whether this kernel build can *load* the manifest at
all.

- **It cannot load** — bytes that do not parse, a field the loader outright refuses, an id that is not a
  slug. `manifestFrom` raises `RpcError`, the package never enters the catalog, and everything above
  applies: it lands in `unavailable`, and a campaign that locks it is refused `campaign_not_ready`
  carrying the loader's own sentence, the directory to repair and `details.path`.
- **It loads but carries a name this build does not know** — an unknown key under
  `contributes.vocabulary`, an unknown field on a contributed profile key, an unknown capability in
  `requires`, an unknown `game_api`. That is build skew, not a broken package, and it is **§28.9's**:
  `validateVocabulary` raises `KernelPredatesPackage`, the manifest records `kernel_gap`, the package
  **stays in the catalog** as `compatible: false`, `kernelGaps` names it, and `table.open` hands the list
  to the host as `mods_unreadable`. `unavailable` stays empty, because nothing about the package is wrong.

§28.9 is the later and better-evidenced of the two and it is the baseline; this section keeps only the
path §28.9 does not cover. One thing did have to be added to reach a campaign that locks a skewed
package. `table.open` builds `mods_unreadable` and `mod_context` into one result and `mod_context` reads
`activeMods`, which refuses first — so the whole result is discarded and `mods_unreadable` reaches
nobody, for exactly the one campaign that cannot play. `activeMods` therefore refuses a locked package
carrying a `kernel_gap` with the gap's own words: message `The <id> package this campaign locks is newer
than this kernel build: <the gap's sentence>`, `fix` saying to rebuild the kernel or drop the lock and
that no player input can change it, `details` `{mod, version, reason, kernel_gap}`. A locked package that
merely failed its digest or its capability check still gets its own older answer, `Missing or
incompatible locked Mod <id> <version>`, and is never reworded into a sibling version's fault
(`ModCatalog.refusalFor`).

## 42. A state the rules impose reaches the player, refuses the action, and has a way out (2026-09-16)

This section is a record of behaviour that already shipped. Eleven call sites in the kernel, the
extension, the panel and the suites cite `§42` and `§42.6` and there was no §42 to cite: the family
landed as three merged branches whose numbers were proposed in reports only, and `6a3bff977` moved them
off §41 once §41 had a claimant. Nothing here is a new design. Where a rule is written down and the
product does not keep it, it is marked as an open gap and left open.

Retained live evidence, campaign `game-83177d61` (The Haunting, `zh-Hans`), turns 107–114. Walter
Corbitt's claws took the investigator's last 6 hit points and the kernel settled it exactly right: zero
hit points with no major wound is `unconscious`, not `dying`, and the receipt said so. Not one word of it
reached anybody. The mechanics card had no case for a `condition` row and drew the row's kind and nothing
else; the capsule's `known.investigator` carried `hp: 0` and no conditions at all, so the Keeper was not
told either; `table.resolve` admitted every action declared for the body. For two turns the player
declared things an unconscious man cannot do — holding on to consciousness, driving a dagger up into a
chest — and got the same halted tableau back each time. Turns 108 through 114 settled no condition at
all, so no card in that stretch said anything, while `save/healing-state/investigator.json` reads
`conditions: ["unconscious"]` to this day. What finally reached the player, hours later, was the Keeper
choosing to write 「人却动不了」 into the fiction.

Three ends of §31's seam, all three broken at once: the state had a writer, no reader that reached a
player, and nobody who acted on it. The five subsections below are the writer, the two readers, the gate,
and the one thing the state still does not reliably have.

### 42.1 Which states take the action away is one line, and it lives in the rules layer

`INCAPACITATING_CONDITIONS` (`kernel-ts/healing/conditions.ts`) is `dead`, `dying`, `unconscious`: in CoC
7e a character in any of them takes no action of their own. `OUT_OF_FIGHT_CONDITIONS` adds `fled` — out
of this bout, still able to act. Everything else a character can carry (`major_wound`, `stabilized`,
`prone`, `grappled`, `surprised`, `outnumbered`) costs dice or position and never the action itself.

Deciding which states forbid acting is a rules question, so it is answered once, in the rules layer, and
every consumer reads the answer rather than keeping a list. Four consumers used to carry a copy — combat
eligibility, the initiative order, the session view's target list, the damage evidence rows — and a
renderer or a capsule that answered it would be a second rules table living in a consumer. The module is
deliberately a leaf: it imports nothing but the value helpers, so the projection, the capsule and the
resolve gate can each read it without pulling the healing engine in behind them.

The states are assigned beside it, in `applyWoundConditions`: `dead` on damage past maximum hit points,
`unconscious` at zero hit points or on a failed major-wound CON roll, `dying` when both are true.

### 42.2 A change of state reaches the player as a `condition` row on the delivery card

The `condition` receipt projects into `mechanics` (§16.2) as
`{kind: "condition", receipt, subject, gained, lost, standing, incapacitated, visibility}`.

- `gained` and `lost` are the change. `standing` is every condition the character carries **after** it,
  because a player who joins the card at turn 109 has to read what is true now, not diff two lists across
  three turns.
- `incapacitated` is which of `standing` take the action away. The rules engine decided that when the
  receipt was minted (§42.1); the card does not re-read a name to judge it, and the panel marks the ones
  it is handed and stamps `cannot act` beside them.
- The condition words are the delivery card's surface (`mechanics`, keys `condition.<name>` and
  `cannotAct`). That is the one place in this product a condition is named in the play language, and
  every other surface that needs one asks this surface for it (§42.6).

### 42.3 The Keeper is told what the body can do, in the capsule

`investigatorSummary` carries `conditions`, and when any of them take the action away, `cannot_act`: a
sentence naming the character and the state, saying the kernel will refuse an action declared for them,
and saying what to do instead — say the state in the fiction, and say what is being done about it. The
retained table had `hp: 0` here and nothing else, which is why the Keeper wrote around an investigator
who was out of play without ever being told he was.

`cannot_act` is a courtesy to the Keeper and never the enforcement: §42.4 holds whether the Keeper read
it or not, and §42.6 exists precisely because a layer that depends on a diligent Keeper is not a layer.

### 42.4 An action the state forbids is refused by naming the state

`table.resolve` refuses an action declared for an incapacitated investigator:
`needs`, `<who> is <state> and takes no action of their own`, `next: "narrate"`, with
`details: {reason: "actor_incapacitated", actor, actor_label, conditions, incapacitated, hp}`. The `fix`
is read literally, because it will be: it says settle nothing for this character this turn, narrate the
state instead, and names the ways out §42.5 gives — never a way for the Keeper to declare the state over,
which is what an unqualified "resolve it" becomes.

The kernel owns this and the §32.2 admission review does not, for three reasons. It is arithmetic rather
than semantics: whether an unconscious body can drive a dagger home is the rulebook's answer and the same
every time, while §32.2 answers whether the *player* chose the action — which on turns 108 and 109 it
would have answered correctly, because the player did choose it. It must hold when the review lane is
down. And §32.3 denies the reviewer the Keeper-side context, so the investigator's condition list is not
in its input at all, which is the whole defect, since the player had not been told either.

Three exemptions, the same shape as §32.1's and for the same reason — these are things that happen to
somebody, not things they do, and refusing them would stop the only clock that can take the condition off
again, so the gate would lock the state it exists to report:

- an `involuntary` action, and answering a `pending_choice`;
- the closed set `decision:coc7:healing:dying-round-clock`, `…:dying-hour-clock`,
  `…:weekly-major-wound-recovery`;
- the families `decision:coc7:sanity:` and `decision:coc7:development:`.

Closed refs and family prefixes, never a reading of the prose. The gate applies to the investigator's own
action only: an NPC acting inside a session carries a graph handle as the acting id, and the combat
engine already keeps an incapacitated participant out of the initiative order there.

### 42.5 The state has a way out, and the way out leaves a receipt

A state that takes the action away and cannot be ended is not a condition, it is the end of the campaign
for that character. CoC 7e gives three exits out of `unconscious`, and the kernel implements all three.
Every one of them turns on the same fact — the character regains a hit point — which is why
`HealingSession.heal` is the single place the condition is dropped: any hit point gained clears
`unconscious` (and `dying` once hit points are above zero, and `major_wound` at half maximum).

- **First Aid.** `resolve {decision: "healing:first-aid-ordinary"}`. A success grants 1 hit point and
  rouses an unconscious person; it must be delivered within the hour, may be attempted once with further
  attempts as a pushed roll, and two people may work together. (`skill-descriptions.json`, First Aid: a
  successful use "can rouse an unconscious person to consciousness".)
- **Medicine.** `resolve {decision: "healing:medicine-ordinary"}`. A success recovers 1D3 hit points and
  likewise rouses; it takes an hour, and is Hard if not delivered the same day.
- **Rest.** `apply {kind: "time"}` of six hours or more runs the healing time trigger; natural healing
  returns one hit point and `heal` drops the condition the moment it lands. This is the only exit that
  needs nobody else at the table.

A dying character is past all three until First Aid stabilizes them: First Aid on a dying character sets
1 temporary hit point and `stabilized` rather than healing, and Medicine refuses to treat a dying
character who is not stabilized yet.

Rest is the exit that used to be invisible. It changed the sheet and minted nothing, so by this product's
own rule — narrated without a receipt is narrated without happening — the table had no record that the
one exit an investigator alone on the floor can take had been taken. The time trigger now mints a
`condition` receipt for the change, which is what makes it a §42.2 row on the card.

**Open gap, BUG-076: on a live table the way out is written down and nobody is obliged to drive it.**
Retained real-table evidence: thirty in-game hours across seven turns with an `unconscious` investigator
and **zero** `condition` receipts in any of them; two rousing checks in the whole stretch, one of them an
outside accident and the other prompted by the player naming the rule themselves. The Keeper closed both
exits in its own words — "I will not have anyone touch the same wound again", and "You speak. **I will
not move the clock forward for you.**" — and then left the decision to a player who was, on the same
screen, forbidden to act. The rules above are correct and the kernel keeps them; what is missing is that
nothing at the table drives one. The `needs` refusal of §42.4 fires only when the Keeper tries to settle
something, so a Keeper who settles nothing is never prompted at all; the §42.6 notice goes to the player,
who by definition cannot act on it; and the one exit that needs nobody else is spelled `apply time`, a
verb only the Keeper has. This section does not close that gap. It records that the gap is in who drives
the exit, not in whether the exit exists.

### 42.6 The host says a standing state out of fiction, beside the delivery

§42.2 makes a *change* of state visible. The state itself was visible for exactly one turn, because
`mechanics` is a record of what happened and a state that did not change mints no receipt. That is the
whole of turns 108–114.

So a delivery that did not change a state still carries it. `standingStates` rides `table.narrate` and
`table.ask` as `standing`: `[{investigator, name, conditions}]`, one row per party member carrying an
incapacitating state, `conditions` being only the states that take the action away.

- **Only those states.** A `major_wound` or a `prone` costs dice or position and the character still
  acts; an every-turn notice about one would be noise on a channel that has to stay believed. Those live
  on the sheet, and still get their one `condition` row on the turn they land.
- **Never twice.** A subject whose conditions this turn changed is omitted: the card's own `condition`
  row already names the state, the standing set and the `cannot act` stamp. That holds for a withheld
  change too — a `keeper`-tier condition receipt suppresses the line, rather than having the host
  announce what the settlement meant to keep from the player.
- **Not a mechanics row, and deliberately never one.** It is not a receipt; it is what the player was
  told stood on them. `deliveryRecord` keeps `standing` on the turn record for the same reason: a record
  holding only receipts could not answer afterwards whether a turn said the state or said nothing.

The host says it on the channel the service notices already use — `coc-delivery`, `display: true`,
`details.standing_conditions`, caption `standing_condition_notice`, composed from the shipped captions in
the campaign's play language, with one telemetry row `{lane: "delivery", reason:
"standing_condition_notice"}`. Out of fiction, beside the delivery, because that is where the player is
already looking when they decide what to say next. It is sent `triggerTurn: false` and scheduled off the
tool result, so the player reads the delivery before the line about it. The host reads the condition
names from the delivery card's surface (`words.wordOn("mechanics", …)`) rather than copying them onto its
own: a second copy is a second place every new condition has to be projected, and the copies drift the
first time only one of them is.

The character sheet is the other reader, and the reason the notice exists rather than resting on it.
`table.view` gives each investigator `incapacitated` beside `conditions` — the same rules-layer answer,
projected once — and the panel marks those and stamps `cannot act`. The player of the retained table
never opened it.

## 43. A project root is a directory: the remote shell's typed path (2026-09-16)

Found in real remote play, not by a suite. A phone paired to the relay showed the
scenario onboarding with 「已上传 0.0 / 25.5 MB」 frozen under it and the banner
*「此会话使用 coc-keeper 扩展包；当前项目是 base。」* The session's own record said
why: `{"type":"session","version":3,"cwd":"测试"}` — its project root was the two
characters the user had typed, and no such directory exists.

### 43.1 What a bad root does

Observed, on the machine that produced it: every session in that project shows
`packSnapshotMismatch` — the session's immutable `pipiui_product_profile` says
`coc-keeper` while the project's form reads `base` — which locks the composer, and
the pack's own verbs go unanswered, so the onboarding's `begin`/`chunk` calls never
settle and the upload sits at zero bytes. **No error is raised anywhere along the
way**: every layer reports a coherent state of its own, and only the snapshot read
against the form shows the contradiction. Nothing done inside that project clears
it, because the snapshot is immutable by design (§23).

The internal route from a non-directory root to `base` is **not established here**
— a probe of `listExtensions` against a seeded bad root did not reproduce it in
isolation, so the chain through `extensionLoader.scan`, `projectPiAgentDir` and
`defaultPack` is a hypothesis, not a finding. It is not load-bearing: a root that
is not a directory is outside what every reader of it already assumes, and that is
reason enough to refuse it. Anyone chasing the remaining silence should start by
reproducing the mismatch from a seeded bad root rather than trusting this note.

### 43.2 Where the bad root comes from

Only the remote shell can make one. Electron's add-project goes through a native
folder picker, which can only return a directory that exists. A browser has no
such dialog, so `RemoteBrowserApp` asks the user to type a path that exists *on
the host*, and `addProject` accepted any non-empty string:

```ts
if (typeof value !== "string" || !value.length)
  throw new Error("project path 必须是非空 string");
```

This is the shape §31 keeps naming: an entry with a writer and a reader but no one
checking that what was written is what the reader needs.

### 43.3 The contract

**`addProject` refuses a root that is not an existing directory.** It is the only
common choke point — every shell, present or future, reaches a project through it,
so the check belongs there and not in any one dialog. Three refusals, each with the
offending path in the message: `项目路径必须是绝对路径`, `项目路径不存在`,
`项目路径不是文件夹`. A refusal adds nothing to `projectPaths`; `completeAddProject`
already rolls back its optimistic row and shows the host's message, so no shell
needs new plumbing to surface it.

The remote dialog additionally refuses a relative path **before** it closes
(`remoteProjectPathRefusal`), so the typed text survives the mistake instead of the
user retyping a long server path after reading the failure elsewhere. It is a
convenience, not the authority: only the host can stat the path, and both POSIX
(`/srv/app`) and Windows (`C:\app`, `\\host\share`) roots pass, because the browser
cannot know which platform the host runs.

This does not repair projects already stored with a bad root — their sessions keep
a snapshot that can never match. Remove such a project and start again in one whose
root is real.

Tests: `Electron/packages/pi-backend/test/add-project-root.test.ts` (the four
refusals and that a real directory still registers),
`packages/ui/src/remote-browser-session.test.ts` (the path predicate) and
`packages/ui/src/RemoteBrowserApp.test.tsx` (the dialog keeps the typed text and
stays open on a refusal).

## 44. An upload that stopped says so, and can be continued (2026-09-16)

Found at two real tables, not by a suite. The same 46,556,793-byte book froze at
`received: 9437184` on one and `received: 8388608` on the other — whole MiB, but
not the same one, so no fixed boundary: a chunk simply never answered and nothing
sent another. `.coc/imports/<id>/job.json` read
`{"received":8388608,"size":46556793,"state":"uploading"}` with `source.pdf`
exactly that long on disk, and stayed that way for six minutes on one table and
fourteen on the other while the card drew a progress bar and the page underneath
promised 「准备进度会保留，离开这个页面后也可以回来继续」. A CDP capture over 45 s
showed 38 `onboarding {action:"current"}` polls and one ping — the transport was
alive and the host kept answering `"received":8388608` — and no upload frame at
all. The server log said nothing. This is distinct from §43, where no byte ever
moves because the pack's verbs go unanswered; here the bytes moved, then stopped.

**What triggered the stall is not what this section fixes, and is not claimed
here.** The two stop points differ, so there is no boundary at 8 or 9 MiB, and the
machine those tables ran on was heavily oversubscribed at the time — a 30 s request
timeout under that load is ordinary, and the 60 s it took to reach 9 MiB says the
stream was already degraded before it stopped. The defect is what the product does
afterwards, which is wrong under any load: it goes on reporting a stream that has
stopped, offers a retry that moves no bytes, restores the same frozen card on
reload, and prints a promise that the progress is kept while providing no way to
keep it. The frame capture is the part that is a logic fact rather than a speed
one — after the timeout the client sent polls and no chunk at all, with no
`webSocketClosed` — and that is the fact this section answers.

### 44.1 The push loop was the only pusher, and it was not restartable

The chunk loop lives in the renderer, inside one `upload(file)` call, holding the
only reference to the chosen `File` — a `File` cannot be stored, so when that call
returned there was nothing left in the product that could send a byte. A chunk
that rejected (`transport_timeout` after the Host API's 30 s wait) ended the loop.
Neither recovery path restarted it: `retryConnection` re-read the catalog, so the
card's label went from 「这一步没有完成」 back to 「正在上传」 and nothing else, and a
reload restored the same frozen card from the host. **After a stream stops, the
renderer is the only party that can restart it, and it must therefore be the party
that knows how.** The host cannot: its side of an upload is a sink.

- **A chunk that fails is retried, not fatal.** `UPLOAD_ATTEMPTS` consecutive
  failures end an upload; one does not. Every attempt re-reads `{action:"status"}`
  first and resumes from the host's own `received`, because a frame that never
  answered may still have written its bytes (the Host API rule is never to replay
  a mutation blind) and the host refuses any offset that is not its count. A
  growing pause between attempts lets a chunk still being written land.
- **The chosen file is held for the life of the page**, so `retryConnection` and
  the paused card's `resume` both continue the stream instead of changing a label.
  Both are tested; a button that only re-labels is the defect.
- **Choosing the file again continues it.** A same-name, same-length file with
  bytes outstanding resumes the existing job; it does not `begin` a new one. After
  a reload this is the only way back, because the `File` is gone, and it is what
  `onboarding.lede.job` promises. `chunk` therefore accepts an upload that is
  `paused` as well as one that is `uploading`, restoring the phases the pause
  stopped; the offset check is unchanged, so a lost acknowledgement still cannot
  double-write.

### 44.2 `uploading` is a claim about the present, and the host checks it

`snapshot()` has asked "is anyone still working?" of the reading phases since they
were written (`state:'running' && !alive → 'paused'`). The upload never asked,
because its worker is a browser and no child of this host. The evidence available
is the age of the last acknowledgement: `received_at` is stamped by `begin` and by
every accepted chunk, and an `uploading` job with no chunk for `UPLOAD_STALL_MS`
(90 s, well past the 30 s request timeout and past the slowest chunk a real table
produced) is **reported** as `paused` carrying `{code: "upload_retry"}`.

Reported, never written: the job stays `uploading` on disk so the very next chunk
is still accepted. Saying "interrupted" and then refusing the resumed bytes would
be the same lie in the other direction. `dismiss` reads the same predicate — an
upload nobody is pushing is not live work, and refusing there sealed the player
inside a screen nothing was moving. A renderer that gives up in-page pauses the
job itself, so the card is honest at once rather than at the end of the window.

### 44.3 A transport code is not a player-facing word

`transport request timed out` reached a `zh-Hans` table verbatim. The projection
path was never bypassed: §23 looks a caption up by **code**, and `transport_timeout`
is minted in `@pipi/host-api`, a layer below the product, which registers no
captions. With no word for it the card fell back to `errors.unknown` — 「这一步没有
完成」 — over the English sentence in the fold, so the fold was the only content the
player could read. Registering that one code would fix that one sentence.

The rule instead: **the layer that catches a failure names it in the vocabulary it
has.** A code these words have is the product's own account and is kept whole; a
code they do not have came from beneath the product, and the upload reports
`upload_retry` — a word §23 already carries in every language, and one that names
something the player can do. The English stays behind the `errors.details` fold,
the log line it always was. The check is against the answer's own `ui.words.errors`,
which is data, not a list of codes in the renderer.

Tests: `Electron/packages/pi-backend/test/coc-onboarding.test.ts` (the stall
reading, the reopened chunk, dismissing a dead upload) and
`Electron/packages/ui/src/CocOnboarding.test.tsx` (a resumed stream, both retry
buttons moving bytes, a re-chosen file continuing from the prefix, and the
transport code never reaching the player).

## 45. A check the die cannot answer is not a hard check (2026-09-16)

Found on two real tables, three receipts, both drowning the same investigator.
`homes/t5/.coc/campaigns/game-33a2a97a…/turns/0002.json` and
`homes/t6/.coc/campaigns/game-b4cebfe0…/turns/0005.json` both carry:

```
skill "Pilot"  base_target 1  difficulty "hard"
required_target 0  effective_target 0  threshold 0
roll 75  level "failure"  passed false   push_eligible true
```

CoC 7e gives an unlisted skill its rulebook base chance, and `Pilot`'s is 1. Hard
halves it and floors, so the effective target is 0. **1d100 has no face at or below
0.** The check was settled anyway, the failure was written into the story, and the
mechanics card printed the arithmetic to the player — `需困难 · ≤0` — before the
boat capsized, the cargo sank and the motive the investigator had walked in with
was gone. The die was never the author of that outcome; the floor division was.

### 45.1 The rule

An effective target below `percentile-check.json`'s `minimum_target` is not a
difficult request but an **unrollable** one, and the kernel refuses it before the
die rather than settling it:

- The numeric rule is owned by the rule tables, not by code: `CheckArithmetic`
  exposes `minimumTarget`, `effectiveTarget(target, difficulty)` — the same clamp
  `check` rolls against — and `assertRollable(target, difficulty, label, pushed)`.
- `executeCheck` calls `assertRollable` **before** `arithmetic.check`, so an
  unrollable request mints no roll receipt, records no failure, and lands no
  stakes. Nothing is rolled, so no RNG is consumed and the turn is unchanged.
- The refusal is `invalid_params` (`next: change_input`) with
  `details.reason = "effective_target_below_minimum"` and the numbers that produced
  it: `skill`, `base_target`, `difficulty`, `effective_target`, `minimum_target`,
  `pushed`.
- **This is a pure numeric condition.** It asks nothing about whether a skill suits
  a situation — that judgement is the keeper's, and a list of skill names in the
  kernel would be exactly the hardcoded semantics the project forbids.

### 45.2 `push_eligible`

A push re-rolls the same target, and a pushed failure costs more than an ordinary
one, so offering a push on an unrollable check invites the player into a strictly
worse certain outcome. Because the refusal happens before settlement there is no
receipt to carry `push_eligible` at all; and `resolve` with `action.push` routes
through `executeCheck` with the original target and difficulty, so a push of a
legacy impossible receipt is refused by the same assertion, with the fix saying
first that a push repeats the same target and cannot rescue it.

### 45.3 The fix text is keeper-only

Per the standing lesson that an error's `fix` is executed literally and sometimes
read aloud, the refusal names its own audience and its own status before it asks
for anything: service information about the keeper's request, not fiction; do not
narrate it, do not read it to the player, do not treat the attempt as having
failed. Then exactly one repair, both halves concrete: name a skill or
characteristic the sheet gives this investigator a usable value in, or keep the
skill and lower the difficulty until the effective target is at least the minimum.
It closes by saying the player's stated action still stands and needs no new input
— the player did nothing wrong and must not be asked to repeat themselves.

### 45.4 What this does not cover

`executeCheck` (and therefore `push`) is wired. The other settlement paths that
take a keeper-chosen difficulty over a sheet-derived value — combat to-hit,
chase, sanity, magic, healing, mods and the concealed Psychology contract — share
the same `CheckArithmetic` and can adopt `assertRollable`, but are not wired here:
Psychology in particular derives its difficulty from the NPC's opposing skill, so
"lower the difficulty" is not an actionable repair there and would need its own
fix text before the assertion is worth adding.

Tests: `tests/extension/impossible-check.test.mjs` — base 1 at hard refused with
no receipt minted, base 1 at regular still rolling its legal 1%, an ordinary skill
at hard untouched, the push path refused, and the fix text's audience and repair.

## 46. Readiness is `missing`; `findings` is an opinion about the book (2026-09-16)

Found on two real tables, not by a suite. An imported 669-page Masks module reached
`module.json` like this:

```json
"opening": {"opening_ready": false, "start_scene": "scene-start-lima", "missing": [],
  "findings": [{"code": "clue_supports_nothing", "subject": "clue-larkin-research-destroyed"}],
  "finding_counts": {"clue_supports_nothing": 1}, "nodes": 22}
```

`missing` is empty: nothing the opening points at is absent. One clue of twenty-two
nodes is not connected to a conclusion — the book being a book — and that alone
turned the whole opening unready. In the same file
`prepared_openings["scene-start-lima"].opening_ready` and
`reading.completed["read-3"].opening_ready` were both `true`: that opening had been
prepared, and had been played.

### 46.1 What it cost

The gate is reached three ways, and all three refused. `setup.complete` reads
`setupOpeningReady`, wrote `setup.waiting_for_opening: true` and refused the
handoff. `module.read.request` with `purpose: "opening"` found the identical reading
already `completed` and answered `{"state": "blocked", "missing": []}` — **a refusal
naming nothing** — which `extensions/module/reading-service.ts` turned into
`needs`/`reading_failed` and the onboarding host recorded as a failed preparation.
One table took **zero turns**: its `turn.json` stayed at
`{"turn": 0, "state": "awaiting_player", "player_text": null}` with an empty
`turns/`, so the player's first sentence was kept nowhere, while the Keeper — which
had no receipt to take — promised in prose that it would be passed on later. It was
not.

The order matters more than the arithmetic. The opening was prepared and ready
first; a later **background detail reading of the same book** brought the clue in,
and `module.opening` is re-derived from the whole graph on every completed reading.
Nothing about the table changed. More of the source was read, and that revoked an
opening already in play.

### 46.2 The rule

`opening_ready` is `!missing.length`. `findings` never vetoes it.

- **`missing` is readiness.** No module node, no single entrance, an exit or a named
  NPC or clue that resolves to nothing, or a start scene whose material is not
  prepared. A table cannot open on any of those, and each names the next step.
- **`findings` is the playability invariants read as a quality opinion** about the
  book's own graph. It still travels, in `opening.findings` and
  `opening.finding_counts` in the same record, which is where `module.status`
  already reads it. Whole-book quality remains `module.json.playability` (§14),
  untouched: this section is about the opening subgraph only.
- The two are therefore equivalent by construction: `opening_ready` is false exactly
  when `missing` names something, so a refusal derived from it always has a next
  step. This supersedes the readiness clause of §14 (the induced opening subgraph
  satisfying the ten invariants); §14's numbering is unchanged.

**The authority is `openingReport` in `kernel-ts/write/source.ts`,** and it already
was — the three recorded copies are all its output, taken at different generations
against different graphs, which is why they disagreed. `module.json.opening_ready`
and `module.json.opening` are the live roll-up, and the only copy anything
downstream reads. `prepared_openings[<scene>]` is a record that that scene was
prepared. `reading.completed[<job>]` is a job log. Neither of the latter two is
consulted as readiness, and neither may become a second answer to it.

### 46.3 A failure the player is shown names a registered caption

The same incident, at the other end. The onboarding host handed the overlay
`{"code": "needs"}` — a kernel RPC code (§1), which nothing registers a caption for
— so the renderer fell back to `errors.unknown`, and under that heading it printed a
sentence the host had written itself: *"Source preparation could not finish. Your
source and investigator are saved; retry this preparation."* The player was playing
in `zh-Hans`. Writing that sentence also **discarded the diagnostic** the reading
service had actually reported.

- The player-facing explanation of a failure is its code's caption. The host has no
  sentence of its own to write for one (§23: the product's own words have one
  authored source and are projected, never authored per language).
- A code put in front of a player is one `content/ui/<source>/errors.json`
  registers. The surface **is** the registry: a code it does not carry is settled to
  `preparation_failed`, and the unregistered code moves into the message. Adding a
  caption registers a code and nothing else has to change.
- The message is the diagnostic, in the system language, behind `details`. Caption
  first, message after it, never the message instead of the caption.

### 46.4 A stopped preparation does not promise to finish itself

The overlay's standing lines all say the opening arrives on its own — *"play will
continue when the opening is ready"*, *"create your investigator while the opening
is prepared in the background"*. A stopped phase is the one state where that is
false, and it was being shown there, beside a **Resume control that actually works**:
a third table pressed it and was playing three and a half minutes later, without a
whole-book re-read. A player who is told to wait has no reason to press it. A
stopped phase states its own reason instead; the control stays in the head.

### 46.5 The three ends (§31)

Who writes `opening.findings`: `playability` on the induced opening subgraph, on
every completed reading. Who reads it: `module.status`, in the same record as
`missing`. Who acts on it: nobody automatically — it is an opinion, and the one
consumer that used to act on it (readiness) is exactly the defect this section
closes.

Tests: `tests/extension/opening-readiness.test.mjs` (the product path from
`module.source.bind` to the player's own words in `turn.json`, including the
`module.read.request` that used to block with nothing named, and the ambiguous-
opening book that is still refused because `missing` names it),
`tests/extension/preparation-failure-words.test.mjs` (every code these hosts refuse
with has a caption, and the host writes no player-facing sentence),
`Electron/packages/pi-backend/test/coc-onboarding.test.ts` (an unregistered code is
settled and its diagnostic survives) and
`Electron/packages/ui/src/coc-preparation.test.tsx` (a stopped phase promises
nothing, a running one still does).

## 47. Host state is not fiction, and a state said out loud is re-read first (2026-09-16)

Three unrelated live tables on 2026-09-16 delivered the same failure: the host held precise knowledge about its own preparation, handed the Keeper a sentence to deliver, and the player read that sentence in the Keeper's own voice, as fiction, already out of date — and on one table attached to the wrong cause entirely. This section splits the seam at the producer, which is the only place it can be split: a keyword test on delivered prose would be a semantic classifier, and this product forbids one. Two of the five retained turns looked, from telemetry, like the Keeper inventing the reason; the paragraph below shows it was relaying a block nobody could see, and both halves are fixed here.

**Retained evidence.** `game-1c0faba5` turn 3 (`homes/t4/.coc/campaigns/game-1c0faba5-5a90-4eff-ade3-0d62632b4e7a`). Telemetry: `apply` refused at 12:09:35.086 with `action_not_authorized` (the move destination was not registered — `registered_destination` was `previous-tenants`); `lookup` about `roxbury-sanitarium` returned at 12:10:12.911Z carrying `status: "pending"` and a `service_status` whose second sentence read *"Use narrate only to tell the player that preparation is pending and end the turn"*; `narrate` opened at 12:10:18.875 and the turn closed at 12:10:33Z. The Keeper executed the sentence it was handed and explained the *admission* refusal with the *preparation* status, then asked the player to say their action again — which `admissionRefusal`'s own `fix` (§32.2) expressly forbids. `turns/0003.json` has `receipts`, `mechanics`, `speech` and `intents` all empty and `closed_by: "narrate"`; the job's own draft landed at 12:10:29Z, four seconds before the turn closed, and it was accepted on turn 4. `game-b4cebfe0` turns 2 and 3 (`homes/t6`) are the reading half: `lookup kind=source` hit `reading_timeout` after 120 s, `sourceWaitInstruction` told the Keeper to "tell the player plainly that this one thing is still being prepared", and the wait became a line inside the scene while the material arrived seconds later.

**The wording has two carriers, and the second one wrote no telemetry.** `game-1c0faba5` turn 12 and `game-3dd94f0a` (M-MAIN) turn 52 deliver the same sentence with **no `ok:false` row anywhere in the turn**, which reads as a Keeper inventing a reason out of nothing. It is not. Both turns have one shape: `lookup kind=adaptation action=prepare` returns `ok:true` with `pending` after ~20 s (`about: "南区慈善会办公室"` 20027 ms at 12:37:22.850; `about: "利马照相馆"` 18088 ms at 12:39:18.563), the very next `provider-call` carries a single `toolCall` block that leaves **no tool row at all**, a further provider call follows within seconds, and the turn closes on a `narrate` about preparation with `receipts: []`. That swallowed call is this same wait's gate in `beforeTool`, which was the only tool-level block there that returned without `record(...)` while every other one — narrate-count, commit outage, stale adaptation, source wait, refusal budget, turn state — writes `ok: false, code: "blocked"`. The Keeper was relaying `preparationWaitInstruction`; the instruction was simply invisible. The only visible trace was a disagreement between two counters: the UI step bar counted the block (t4 turn 12: "11 steps, 1 failed"; M-MAIN turn 52: "12 steps, 1 failed") and telemetry counted nothing. The gate now records `reason: "preparation_wait"` with the verb, the proposal name and the retained status, so this class is legible from telemetry alone. **A host block that steers the Keeper is a host decision the run must be able to read back; a gate that returns without a row is a defect in its own right, whatever it blocks.**

**A host instruction says what the Keeper does, never what the Keeper says.** Every instruction that carries host state — the adaptation `service_status` (§36.15), `preparationWaitInstruction` in all its branches, `sourceWaitInstruction` and `sourceMaterialRefusal`'s `fix` (§22) — keeps its operational half (what is unsettled, what already settled, which call reports on it, that the turn must close) and drops every clause naming a sentence for the player. They end instead on one shared clause: do not put the preparation into the fiction, do not ask the player to say their action again, the host tells them itself. The reason is the rule Agents.md already records for error `fix` text: a Keeper executes what it reads, so a host instruction that names a line to deliver *is* the delivery.

**The host owns the service notice.** A delivered turn (`narrate` or `ask`) closed while the host held a preparation wait raises one `coc-delivery` message with `details.preparation_wait = {kind, name?}`, out of fiction and beside the delivery — the same channel and shape as §38.11's commit notice, §34.17's cut-short notice and §42.6's standing-condition notice. It is one authored English caption (`adaptation_wait_notice`, `source_wait_notice`) projected for the table's play language by the words lane (§23); it is not written by the Keeper, not translated by hand, and not switched on by any language test. Said once per delivered turn: the wait itself survives later player inputs (§36.15), the sentence about it does not. The player can therefore tell "I said the wrong thing" from "the product is not ready", because the two arrive on different surfaces.

**A notice re-reads the state at the moment it is sent.** No notice may be composed from a status captured earlier in the turn. An adaptation wait asks `adaptation.status` again and speaks only for `pending`/`reviewing` — strictly narrower than the `ADAPTATION_HELD` set the wait itself uses, because `ready` and `failed` are decisions the Keeper owes an answer to and neither is "still being prepared". A source wait asks the reading service whether that material is still in flight; a `reading_timeout` is the host's own patience ending and never the reader finishing, and the map the foreground waits are registered in is the whole answer. When the re-read says the work is over, or cannot be made at all, the notice is withheld and the decision is recorded (`lane: "delivery"`, `reason: "preparation_wait_notice_withheld"`) rather than softened; a landed notice records `reason: "preparation_wait_notice"`.

**`ready` is not "still preparing", and the instruction must say which it is.** `ADAPTATION_HELD` keeps `ready` and `failed` as waits (§36.15) because the table owes them an answer before it acts. That is a fact about the Keeper's obligations, not about the work, and the two were being collapsed. Retained evidence, campaign `game-ef7545c5` (t7): the only `lane: "adaptation"` row in 785 lines of telemetry is `{"turn":9,"proposal":"圣马丁广场照相馆","status":"ready","held":true}` — the place had been built, reviewed and marked ready — and the player had been told the table was "still checking it against the original book and its connection to the Lima section", with the reading queue reporting `claim_empty` at the same moment. The wait was held for six minutes. The terminal branch of the wait instruction now states, in the same breath as the status, that the job **has finished**, that nothing is still being prepared or running, and that the Keeper must never describe it to the player as pending. A finished job described as unfinished is not loose wording; it is false.

**A notice names one real job, and the host checks that it is that job.** The sentence must point at work that exists and is the work the player is waiting on. Two retained turns show what the absence of that rule produced: on `game-b4cebfe0` the player was told a camera shop was "still having its details checked" while the only reading in flight at that instant (13:14:52.247Z, `read-6`) had `focus: "puno"`, hundreds of kilometres away; on another turn the queue was `claim_empty` with no job at all. So the source notice matches the retained wait's own `focus` and `question` against the in-flight readings and speaks only for an exact match — a different reading in flight is not this one, and no reading in flight is not a wait. An unnamed wait matches nothing.

**A suspension that leaves no telemetry row cannot be diagnosed.** Two separate silences hid this class for a day, and both are closed. (1) The gate block above. (2) `refreshAdaptationWait` recorded only when `held` — the wait as it stood on the way *in* — so the turn on which a wait was **first** taken up, the one turn whose behaviour changes most, wrote nothing at all; it now records whenever a wait stands on either side of the re-read and marks that first one. The general rule: **a host decision that changes what the Keeper may do is a decision the run must be able to read back.**

**What this does not change.** §36.15's turn ownership, job freshness, pin and acceptance semantics are untouched, and so is the audit's `preparation_wait` deferral basis (§37.3): it stays lawful for a turn whose prose does carry a wait line — the settled-receipts branch may still say the additional material is pending — and a turn that carries none defers as `chosen_action`, which needs no host-owned field. No new lane, no new verb, no new foreground model call, and no reading of delivered prose.

## 48. A player-bound message is written by the layer that emits it (2026-09-16)

Four raw English sentences reached players in one day, on four unrelated paths:
a preparation banner, an upload, a turn transport, and the right-hand sheet. That
is not four forgotten strings. Service failures had never gone through the
presentation lane at all, because at each boundary a caught exception's own text
was copied straight into the `message` §23 shows. The worst named an internal tool
at the player: the sheet drew a read failure, the generic caption, and under the
fold `kernel table.view did not answer within 15000 ms`.

The caption being generic is the designed behaviour, not the leak: `internal` is a
kernel code the product's words do not carry, and §23 renders an unregistered code
as `errors.unknown`, a gap a player can name. The leak is the fold.

### 48.1 The rule

At every boundary where the product turns a **caught exception** into a
player-bound failure:

- **The code travels.** It is an identifier from a closed set, and the renderer
  projects it. A code from a layer below is still a code; it is not rewritten.
- **This layer's own message travels.** One English sentence belonging to the
  boundary, the same for every exception that arrives there — never the
  exception's text. English because every host string is (§23); the player reads
  the projected caption, and this is the log line behind `errors.details`.
- **The exception's text is a diagnostic and goes to a sink that already exists.**
  It is never placed in an answer a renderer reads. A boundary that drops a
  diagnostic without one has lost it, not moved it, so wiring the sink is part of
  the fix, not optional.
- **A refusal this layer minted itself passes whole**, because its sentence was
  written to be said. The distinction is by **construction, not by content**:
  `refuse()` brands what it builds (`said: true`), and nothing downstream ever
  inspects a string to guess whether it reads like a diagnostic. Deciding that by
  keyword or regex is the hardcoded-semantics ban, and it would also be wrong —
  a vendor's `Invalid PDF structure.` looks exactly like a sentence for a player.

### 48.2 Where it is applied, and which sink each uses

- `extensions/kernel/client.ts` — a call that never answers now reports to
  `onDiagnostic`, the sink this client already uses for stderr, protocol noise and
  restart notices. It was the one failure on the client that reached no sink while
  its text reached a player. The `KernelError` message is unchanged: internal
  callers and tool results still read it.
- `pipicoc/sheet.ts` — the `table.view` catch answers `{code, reason:
  TABLE_READ_STOPPED}`. The code still travels; the kernel's diagnostic does not,
  and is kept by the line above.
- `pipicoc/onboarding-worker.ts` — `reportError` emits its own sentence unless the
  error carries `said`, and puts the underlying text in `detail`. Two of the four
  sentences came through this line: `Invalid PDF structure.` from a PDF vendor and
  `Request timed out.` from a provider SDK, neither written for anyone to read.
- `Electron/packages/pi-backend/src/coc-onboarding.ts` — a worker that dies with
  no error event leaves only stderr, and `refuse('interrupted', … || tail || …)`
  put the last 2000 bytes of it — stack, absolute paths, whatever a vendor printed
  — in front of the player. That stderr is now appended to the import's own
  `events.jsonl` as a `diagnostic` event, where the rest of the worker's account
  already goes, and the refusal carries the host's sentence.

`PREPARATION_STOPPED` is spelled in both the worker and the host because either
may be the one that has to speak and they are separate programs; that duplication
is the cost of the process boundary, not a second source of truth.

### 48.3 The trade, stated

Some exceptions from below carry text that would have been useful: a kernel
refusal saying the turn is closed reads like a sentence written for a player. It
reads exactly as much like one as `Invalid PDF structure.` does, and a stack
arrives on the same field. Nothing can tell them apart without inspecting the
string, which is the hardcoded-semantics ban and would be unreliable anyway.

So the trade is explicit and the replacement is named: **a code from below whose
refusal deserves a player-facing word earns it by being registered in
`content/ui/en/errors.json`**, where the lane projects it into every language.
That is a word for every player rather than one language's sentence for all of
them. Which kernel codes deserve registering is an open question this section does
not answer; it is now the only way to answer it.

### 48.4 What this section does not cover

`CocOnboarding.tsx`'s failed/paused fold renders
`failure(job.error).message || said(failure(job.error))`, which prefers the
message over the caption and so makes the caption unreachable there whatever the
producers send. That render site is the story-opening work's, fixed in §46;
§48 is the producer end only. The two ends are independent, and both were needed:
a correct message from the producer already improves that fold, and fixing the
fold alone would still have shown a vendor's stack, because the stack was in the
`message` too.

Tests: `tests/extension/service-error-text.test.mjs` (the sheet boundary, the
diagnostic sink, and that an authored refusal passes whole) and
`Electron/packages/pi-backend/test/coc-onboarding.test.ts` (a real failing inspect,
and a worker that crashes with nothing but stderr).

## 49. An adapted scene has exits, and the offer always has a way out (2026-09-16)

Six tables walked into a place and could not walk out of it.

On campaign `game-1c0faba5` turn 4 accepted `add_scene "Roxbury Sanitarium"` and
moved into it. For the next **nineteen turns** `where.exits` was empty, the
Director's offer carried no `route` row, and the module's seven authored routes —
including the house the landlord is paying the investigator to enter, whose key is
already in her pocket — were off the table. Another table asked to leave three
turns running and was left at the door each time, with the clock at zero.

Two independent causes produce the same silence, and the fix is one guarantee at
each end: the graph mints the way out, and the offer never has nothing to say
about it.

### 49.1 `add_scene` mints the way back

`add_scene` minted a node and not one relation. Only `kind: "route"` called
`edge(...)`, and a `route` the Keeper writes is the Keeper's to aim: on that
campaign they wrote one for each of two venues and wrote it **inbound** both times
(`commission-briefing -> Roxbury Sanitarium`, `Roxbury Sanitarium -> South End
Parish Charity Office`) — the direction that gets the party in. So requiring
`route` for `new_destination` would not have moved that table at all: the route
was there.

`adaptedGraph` therefore mints `route-to` from the new scene to its `based_on`
anchor, in the same `edge()` closure every other adaptation edge uses (it
deduplicates, so a Keeper-written route in the same direction costs nothing).
`based_on` is required, always resolves against the **original** graph, and is the
scene this place was rendered from, so the edge is the one the mint itself can be
sure of, and it leaves every campaign-minted scene exactly one move from the
book's own topology. It is a **guarantee of the operation, not a demand on the
model**, and it adds out-edges only to the node being created: no authored scene's
exits, capsule or offer changes.

The edge is one-way. Getting *in* already degrades gracefully — `apply move`
accepts `via` and records `improvised: true` — and a reciprocal edge would put a
campaign venue into an authored scene's exits and its three-row offer forever.
Getting *out* did not degrade at all, which is the defect.

Effective graphs are rebuilt from `world.adaptation.records` on every load
(`campaignModule`), so the guarantee reaches campaigns that were created before
it. It changes no stored record and no `revision` digest.

### 49.2 The offer never has an empty route pool

`routeRows` filtered `where.exits` down to open ones and returned whatever
survived — including nothing, silently. Two exits are dropped by that filter, and
on a scene whose only exit is one of them the Keeper is told nothing at all:

- **`unlock_when.met === false`** — the book holds the door closed.
- **`material !== "ready"`** — the destination's pages have not been read out of
  the source PDF yet. This one is not even a closed door: `apply move` puts the
  destination through `requireMaterial`, which raises `material_pending`, and the
  host reads it in the foreground and retries. The exit was takeable the whole
  time. Measured: the same authored start scene of the same module read `material:
  "ready"` in one campaign and `"missing"` in another, and in the second the
  scenario's **only** entrance was filtered out of every offer for eleven turns —
  no roll, no clock minute, no world write, and no word to the Keeper or the
  player about why.

So when, and only when, the open pool is empty, the offer says which ways exist
and what stands in each one:

- a `material` row names the operation that clears it: `apply move to <scene>`
  reads the pages and takes it (`blocked: "material"`);
- a `locked` row carries the condition that opens it (`blocked: "locked"`);
- then the retrace rows from `where.back`, which `apply move` already accepts
  (`from: "where.back"`).

An ordinary scene with any open exit is untouched: this runs only when the pool is
empty, so nothing is ever ranked beside an open route.

`directorRecovery`'s third rung turns a route row into `apply move`, and it skips
`blocked: "locked"`: a door the book holds closed is information the Keeper needs,
never the step the recovery owes. A `material` row stays, because that move is the
call that makes the place ready.

### 49.3 The three ends (§31)

**Writes it:** `adaptedGraph` mints the edge; `whereSection` already wrote
`where.exits`, each exit's `material` and `unlock_when`, and `where.back`.
**Reads it:** `routeRows`, which until now read `where.exits` alone and never
`where.back` — `where.back` had no reader in the offer lane at all.
**Acts on it:** the Keeper, through `apply move`, with the operation named on the
row (§31: the cost and the yield on the same line).

### 49.4 What is deliberately not here

- **`available_clues: []` on a minted scene is not widened here.** A new place may
  honestly hold nothing, and filling it would be fabrication. The half of that
  which *was* structural — a campaign scene could never hold a clue at all — is
  §51's `add_clue`, already landed.
- **A scene with no exit and an empty trail still yields an empty pool.** That is
  reachable only from a module whose start scene has no exit at all, which is a
  module-authoring defect, not a play state a table can walk into.

Tests: `tests/extension/adapted-scene-exits.test.mjs` — a campaign scene entered
with `via` and left again by the minted edge alone, with the anchor absent from
`scene_trail` so a retrace cannot be the thing under test; the same over two
minted scenes; and the three offer shapes above.

## 50. A turn that settled is told, and the notice does not spend the next call (2026-09-16, extends §38)

§38.5 established that a run ending undelivered owes the player a service notice. Retained live
evidence shows the sentence is not enough, and that sending it costs a turn it should not.

**Retained live evidence** (`playtest-evidence/pipicoc-20260914`, campaign `game-b4cebfe0`, turn 8,
2026-09-16). Four receipts settled: a campaign-scoped `ruling`, an `npc` stance change, a Swim check
the investigator **passed** (54 against a target of 70) and a `time` advance of two minutes. The
continuity review then timed out at 40 814 ms. On disk:

```
closed_how: null        rendered_text: ""      closed_by: "stranded"
receipts: ruling:t8-c2 / npc:captain-gould-t8-c2 / roll:swim-t8-c3 / time:t8-c4
world.clock = {"minutes": 6}
```

The player's whole turn was one sentence — "this turn could not be published … everything already
settled is kept" — naming none of it, and one empty bubble. The retry opened turn 9 as a clean turn
with receipts of its own, correctly (§38.2: a stranded record is inert to every delivery consumer), so
those four receipts were never told to the player on any turn. **Nothing was lost from the state
surface and the entire delivery surface was gone.**

**A turn that settled receipts is told what settled.** At `agent_settled`, on the same predicate that
strands the turn (§38.3) and before the one player notice is chosen, the host reads the kernel's own
`table.status` and projects that turn's `mechanics` (§16.2) onto the delivery channel: a
`coc-mechanics` session entry and a `coc:mechanics` bus event, carrying `undelivered: true` so a
consumer that requires a delivery can still tell the two apart. Once per turn, whatever the cause and
however many runs end on the same open turn.

- **It is the card, not a narration.** Nothing here writes prose, reads a receipt for meaning, or
  matches on words; the kernel decides what a row is and what visibility it carries (§16.5), so a
  keeper-only receipt stays keeper-only exactly as it would on a delivered turn. The rejected draft is
  still never sent (§34.14), and a second full `narrate` — the step that just failed — is never
  attempted as a fallback.
- **An empty card is not sent.** A turn that settled nothing projectable gets no entry, because an
  empty mechanics card is a visibility verdict of its own. The telemetry row is written either way
  (`lane: "delivery"`, `reason: "settled_without_delivery"`, `rows`), because zero is a fact about
  that turn and a lane that wrote nothing cannot be told from one that never ran.
- **`table.status` gains `labels`**, the §23 glossary a delivery already hands its card, so the one
  card the player gets for a failed turn is not the one card in the campaign drawn in the system
  language.

**The notice must not restart the run it is reporting on.** The same retained turn spent a second
provider call on a `narrate` that failed in 0 ms:

```
12:34:08.831 lane:continuity-review ok:false continuity_review_unavailable ms:40814
12:34:08.831 tool:narrate          ok:false continuity_review_unavailable ms:41359
12:34:08.833 lane:delivery         ok:true  reason:review_unavailable_notice
12:34:15.328 tool:narrate          ok:false continuity_review_unavailable ms:0
```

The refused `narrate` already returns `terminate: true`, and the tool batch really does end. What
continues the run is **the notice itself**. `pi.sendMessage` from an `agent_end` handler, with
`triggerTurn` left unset, is `agent.steer()` while the run is still streaming, and AgentSession's
`_handlePostAgentRun` continues that run for precisely that reason ("Any messages here were queued by
agent_end extension handlers and need a continuation"). A continuation is not a new run, so
`before_agent_start` never clears `reviewUnavailable` (§38.2) and every verb the Keeper reaches for can
only be refused by the latched guard. The player pays a provider call for one more empty bubble.

**Every host message that can be sent while the run is still streaming therefore passes
`triggerTurn: false`.** Two are sent inline from `agent_end` — §38.5's paused-review notice and §8's
host-placed delivery — and those are the measured case. Two more are scheduled from
`applyToolSuccess` on a turn that *delivered*, §47's preparation-wait notice and §42.6's
standing-condition notice, so on a live table they land inside that run and cost one provider call
each, every turn they are said; the flag says the same thing for them, that a host sentence is not a
prompt. **Those two are not measured and the seam suite cannot measure them:** each does its own async
work before sending (a kernel read, a content read) while the faux provider finishes a whole run
without yielding to the macrotask queue, so in the harness the send always lands after the run. A
real provider call is seconds of socket I/O and the timer fires mid-run. The notices scheduled from
`agent_settled` were already outside the run and are unchanged; that is what "keeps `pi.sendMessage`
outside `agent_settled`" was protecting.

**Three ends (§31).** *Writer:* the host, at `agent_settled`, from the run's own no-delivery facts.
*Reader:* the delivery channel that draws every turn's card (`coc-mechanics` / `coc:mechanics`, and
`mechanicsEntry` in the Electron projection, which already filters `visibility: "keeper"` and conceals
hidden figures). *Actor:* the player, who can see that the dice fell and the clock moved before
deciding what to say next.

**Acceptance.** A turn that settles a public check and then cannot be delivered produces exactly one
`coc-mechanics` entry for that turn carrying the check, marked `undelivered`, alongside exactly one
service notice; a turn that settles nothing projectable produces no entry and still one
`settled_without_delivery` row with `rows: 0`; and a paused-review run ends on the assistant message
that called the refused verb, with no continuation behind it
(`tests/extension/settled-turn-is-told.test.mjs`).

## 51. 叙述交付的线索：记得下，以及记不下时账上留痕（2026-09-16）

三张真桌、六次实例：正文把姓名、日期、一条查证路线、甚至一处全新去处交给了玩家，右栏线索始终没有这条。玩家关掉窗口再回来，这些情报只剩在正文滚动条里；守秘人自己的上下文也靠账重建，于是连他一起丢。

逐回合读证据（`homes/{t9,t4,t5}/.coc/campaigns/*/turns/`）之后，判据只有一条，而它不在守秘人手里：

**`apply clue` 只收模组图上、且 `discoverable-at` 当前场景的线索节点。** 场景的 `clues_here` 为空时，任何记账都返回 `not_here`，守秘人再自觉也落不下账。

- t5《不息的渴望》：`book-1` 的图共 10 个节点，`clue` 一个都没有。11 个回合 `clues_here` 全空——侦查 63/75 通过挖到的、连续 6 个回合复现的水下钟声、第 7 回合 NPC 自己引用它当已知事实，**一条都不可能进线索栏**。这不是守秘人失误，是结构性不可能。
- t4《鬼屋》：开场 `commission-briefing` 有 4 条授权线索，1–3 回合全部落账；第 5 回合起party在 `Roxbury Sanitarium`，那是 `add_scene` 铸出来的地点，`clues_here: []`，此后 8 个回合 0 条。**「离开开场场景就不再登记」是表象，真因是 adaptation 铸的地点永远装不下线索。**
- t9《鬼屋》：每个场景都有授权线索，7 条落账正常。只有第 6、11 回合是真正的守秘人漏记——而那两次校验车道都发了 `reveal`，第 11 回合那条甚至指名道姓写着 `chapel-ruins-location`。
- t6 `game-b4cebfe0`（同一本书的另一次解析，18 个回合）：`active_scene` 自始至终是授权场景 `adventure-begins`，`visited_scenes` 只有它、`scene_trail` 为空、`adaptation.records` 为 0——**世界一步没动**，`clues_here` 全程只有 `handout-1-public-facts` 一条，从没被发现。这一局曾被怀疑是「人跑到书外去了，那里本来就没线索」；`world.json` 否掉了这个解释：地点一次都没换过，窄的是这个授权场景的线索集本身（18 个回合、一条）。顺带记下另一个不属于本节的缺陷：**正文跑出了书，而 locus 一次都没动过**。

所以「叙述与记账是两次独立的决定」这个读法，6 次实例里只解释 2 次；另外 4 次连第二次决定的机会都不存在。本节修两头。

### 51.1 `add_clue`：缺的是生产者（§31 第一端）

adaptation 的封闭操作里有 `add_scene`、`add_npc`、`handout` 三个铸新实体的，`clue_at` 与 `npc_knows` 则只能绑定书上已有的线索。**全系统没有任何一个操作能让一条线索存在。** 而 `add_scene` 铸出的场景带着 `available_clues: []` 出生，于是这条管线每造一处地点，就造出一处永远交代不了任何发现的地方。这是典型的「有消费者没有生产者」：`clues_here`、`apply clue`、`facts.keeper_only` 的未发现清单、玩家线索栏、校验车道的 `reveal` 检测，五个消费端都读它，没人写得进去。

`ADAPTATION_FIELDS` 增加第八个操作：

```
add_clue: {name, description, scene}
```

- `scene` 在**改编后**的图上解析，所以同一份提案里可以先 `add_scene` 再把线索挂上去；`new_destination` 因此可以带着自己的发现一起到场。
- 铸出的节点 `node_kind: "clue"`、`visibility: "revealable"`，并写一条 `discoverable-at` 边——与 `clue_at` 同一条边，`sceneClueIds` 和 `apply clue` 不需要第二套规则。
- 没有 `based_on`：线索的出处由每条改动都必须带的 `sources`（原始图上的锚点）交代，reviewer 仍逐条判 `supported`。管线不因此获得编造许可。

`PURPOSES` 增加第六项 `new_clue`，要求 `add_clue`，只许 `add_clue` / `clue_at` / `npc_knows`。**已经立着的地点不必为了装下在它里面发现的东西再铸一个自己**——t4 的 Roxbury 就是这种情况：场景第 4 回合已经铸好，线索在第 5–7 回合才浮现，而 `new_destination` 必须带 `add_scene`，`coveredPlace` 又会拒绝重复铸造同一处地方。

创作/复核提示词里「五个 purpose」「七个封闭操作」相应改为六与八；提示词字节进 `contract` 摘要，改了就让未接受的旧任务失效。

### 51.2 铸出来的线索走的是原路

`apply clue` 一个字不改。改编后的图是内核自己按 `world.adaptation.records` 重建的（`campaignModule`），铸出的线索在那张图上与书上的线索没有区别：`clues_here` 列它、`facts.keeper_only` 把它算进未发现清单、收据进 `world.discovered_clues`、`table.view` 的 `clues.discovered` 把它送到玩家面板。

### 51.3 `reveal` 说出它说的是哪条线索

校验车道一直知道。t9 第 11 回合它写的是「未挣得的线索 chapel-ruins-location 被杜利当面指出烧掉的礼拜堂位置」——句子里有 handle，而句子不是主语，没有任何一层读得出来。

`findings[].clue` 作为可选字段加进 §12.5 的形状，**只在 `kind: "reveal"` 上有效**：车道看到的 `facts.keeper_only` 里本来就有 `Undiscovered clue: <handle> -- <摘要>` 这样的行，提示词要求它在揭示的正是其中一条时把那个名字原样抄回来。内核在 `table.warn` 里按本战役的**有效图**（含 adaptation）把它归一成 handle 写进 `warnings` 行；解析不出来的名字只丢这个字段，不丢整条发现（车道猜了个词，它看到的别的东西仍然值钱）。遥测行多一个 `clues: <条数>`。

**这不是关键词识别。** 判断哪句正文交付了哪条线索，自始至终是车道这个模型的语义判断；新增的只是让它把判断的主语说清楚。

### 51.4 胶囊的 `unrecorded`：账上的缺口活过这一回合

`warnings` 只带**最近一个**已提交回合的发现（§12.5），所以一条漏记的线索在守秘人眼前存在一个回合就消失了。t9 第 11 回合发出警告，第 12 回合胶囊带着那句话，守秘人当回合补记了 `chapel-ruins-location`——这条通道是通的，但它只有一回合的寿命。

胶囊新增一节 `unrecorded`（≤ 768 字节），每行：

```
{clue, turn, quote, operation: "apply clue", line: "turn <n> already told the player this; apply clue <handle> puts it on their sheet"}
```

按 §31「邀请动作的行，代价和产出写在同一行」：要拼装的信息等于没给，所以下一步就写在这一行上。

来源是所有已提交回合里 `kind: "reveal"` 且带 `clue` 的发现，两个条件同时成立才列出：**该线索仍不在 `discovered_clues`**，且**仍在当前场景的 `sceneClueIds` 里**。因此它有两条自清路径，不需要任何一方去撤销：落一次 `apply clue` 它就没了；party 走出这个场景它也没了——这里找不到的东西在这里也记不下，留着就是一句没有调用支撑的催促。

**它不是义务，也不是 offer。** §31 与 §13.7 禁止的是把「守秘人没拿的 offer」反馈成债；这一节记的不是没做的事，而是**已经做了的事没有对应的账**：正文已经交付，玩家已经知道，只有账目不同意。一个回合本来就该有 0 条这样的行，也本来就该有 0 条线索——**没有可追情报的回合，`unrecorded` 是空的，这是正常状态，不是要求补一条**。全程 advisory：不改状态、不拦交付、不重开回合，2026-09-06 关于校验车道保持 advisory 的裁定（§12.5 末段）不变。

### 51.5 仍然没有修的（查清了，没做）

- **新地点除 `adaptation` 外没有第二条落账通道。** `where.exits` / `affordances` / `places` 全是模组图的只读投影；`apply move` 的 `to` 必须先在图上解析得出；`offerLedger` 的 `route:` 行只读授权的 thread 数据。NPC 嘴里说出的「隔几条街还有一处烧掉的礼拜堂」要成为可去之处，只有 `prepare → draft → review → apply` 这一条重路径。它存在、也确实能用（t4 就是这么铸出 Roxbury 的），t9 只是没走。**这里没有「有通道而没被用上」的隐藏缺口，只有一条对一句 NPC 台词而言偏重的通道。** 要不要给它一条轻路径是产品决定，本节不替它做。
- **玩家面板没有「去处」这一节。** `table.view` 只回 `scene`、`clock`、`present`、`investigators`、`clues.discovered`、`npcs.journal`；`exits` / `affordances` 只进守秘人胶囊。玩家知道有哪些地方可去，全靠正文。
- **t5 的模组图本身没有线索节点**（`generation-5` 共 10 个节点：2 scene / 3 npc / 2 rule / 1 handout / 1 vehicle / 1 module，`clue` 零个；唯一的 `discoverable-at` 指向那张手卡），那是阅读/构图管线的产出问题（§22），不在本节范围。同一本书在 t6 的另一次解析里也只抽出一条。`add_clue` 让这样一本书在桌上仍然记得下账，但补不出书里本来就没抽出来的东西。
- **`unrecorded` 只认车道点了名的 `reveal`。** 车道漏判的（t9 第 7 回合馆员给的四条查证路线、t4 第 4–5 回合疗养院的人名与日期，车道一条 `reveal` 都没发）不会出现在这一节里。这是有意的：本节不新增任何「从正文里认线索」的判断，判断只有车道一个来源；车道的召回是车道的问题（§12.5 末段那份按类计量的复核）。

### 51.6 测试

`tests/extension/narrated-clue-accounting.test.mjs`，走真实内核运行时与真实 adaptation 流程（prepare → draft → review → apply），五条：改编地点带着自己的线索到场且 `apply clue` 落账、已有地点用 `new_clue` 单独补一条线索、`new_clue` 的操作集与必需操作、`reveal` 的 handle 归一（解析不出的只丢字段）、缺口跨回合存活并在 `apply clue` 后自清。变异验证：抽掉 `add_clue` 杀前两条；让 `revealedClue` 恒为 null 杀后两条；把 `unrecorded` 写死成 `[]` 杀最后一条；去掉 `sceneClueIds` 那一半条件杀第一条。

## 52. A group skill is a choice before it is a number (2026-09-16)

A module's rule node reads `pilot_boat: 困难难度驾船 pilot (boat)；每条小艇上只有一名调查员可以投，用以保证小艇不翻`.
The investigator was an 1895 ferryman. His card had no `Pilot (Boat)` row — only the
printed `Pilot ( ___ )` group row, sitting at the group's base chance of 1. The
Keeper settled `Pilot` at hard twice. Six crates went into the water, the skiff went
over, the investigator ended up under the keel, and the opening motive was gone.
Swim 70, Navigate 70 and CON 65 were never touched.

Two ends were wrong at once, and this section closes both.

### 52.1 A specialization is derived from the group, not registered by hand

`skills.json` registers group skills two different ways. `Fighting` and `Firearms`
have a flat catalog row per specialization (`Fighting (Brawl)`, `Firearms (Handgun)`),
which is the only reason `SkillResolver`'s parenthesis rule can reach them at all.
`Pilot` and `Survival` have none, and `Science` has three of the thirteen its group
declares. So `specialization_groups.Pilot.specializations` named `Boat` and nothing
in the product could turn that into a skill: no chargen, no module, no Keeper and no
player could put `Pilot (Boat)` on a card, because the identity did not exist.

A group's declared specializations **are** the skill identities of that group.
`specializationIdentity(groups, skills, phrase)` reads `Group (Member)` — and the
same words without the parenthesis, which normalize identically — against
`specialization_groups`:

- A group that enumerates its members admits those and no others. `Pilot (Submarine)`
  is not a skill; the rules table decides that, never a list in the kernel.
- A group the rulebook leaves open declares `"open": true` and admits the member the
  investigator named. Terrain is open, so `Survival` is open. An open member set is
  never enumerated in code or in data.
- A specialization the catalog already prints keeps its one identity, under either
  spelling: `Science (Medicine)` resolves to the flat row `Medicine`, whose declared
  group is Science. A second identity would leave a card's value behind a name
  nothing resolves to.
- A group whose own name already carries a parenthesis keeps the rulebook's nested
  form, which is the spelling the product already uses: `Language (Other: French)`.

Derivation adds no rows to the catalog: `canonicalNames()` is unchanged, and so is
every alias in `findInText`, except that a specialization row **on a card** now
registers its member as an alias, so prose about a boat reaches `Pilot (Boat)` when
the investigator has it.

Chargen resolves an occupation's phrase the same way, so `Pilot (aircraft)` and
`Science (Physics)` land on the card with occupation points on them instead of
falling into `choices_pending` and leaving the blank group row to stand in.

### 52.2 The blank row is not an ability

`Pilot` on a 1920s card is not a skill the investigator has. It is the printed
player-selected group row — a blank — and its 1% is the cost of never filling it in.
Settling a check against it is the failure above.

`resolveTarget` therefore asks which row a group skill rolls, before the die:

1. The card carries a row for the requested skill → that row.
2. The request names the group, and the card carries exactly one specialization of
   it that carries a value → that specialization, named in the receipt.
3. The request names the group, the card carries no such specialization, and the
   group's own row carries a value → that row: one specialization taken and never
   named, which is what the printed sheet means.
4. The request names a specialization the card lacks, on a card whose group row
   carries a value and which carries no other specialization of that group → that
   row. The value is the investigator's; the request was just more specific than
   the card. **The receipt names the row that rolled, not the request**: the Keeper
   sends `Survival (Arctic)` and gets back `skill: "Survival"`, `base_target: 60`,
   `target_source: "sheet"`, so the substitution is on the mechanics card for the
   Keeper and the player to see and to argue with. Under 7e this is strictly
   ambiguous -- that 60 may have been desert, not ice -- but the alternative is a
   silent drop to the group base of 10, which is the failure this section exists
   to close, and it would be invisible.
5. Otherwise → `needs`. The refusal carries the group, the specializations it
   declares, whether it is open, its base chance, the rows of it the card carries,
   and the card's own highest values as `details.needs.options`.

**"Carries a value" is the arithmetic on the card, not a reading of the name:** a
group row above its group's base chance had points spent on it; a row still at the
base had not. That is what keeps a Military Officer's `Survival 60` rolling while
Thomas Reed's `Pilot 1` does not, with no list and no guess about what a row means.

A specialization the card lacks is **not** refused: it rolls its own rulebook base,
because an untrained skill is rollable in CoC 7e. What it never does is roll the
group row's value wearing the specialization's name. `Pilot (Boat)` at hard on a card
that lacks it is therefore refused by §45, not by this section — one base chance of
1, halved, with no face for it on the die.

### 52.3 What this section does not decide

`skills.json`'s `standard_sheet.1920s` also carries `player_selected_group_rows` and
`fixed_specialization_ids`. Neither has a reader anywhere in `kernel-ts/`,
`extensions/` or `runtime/` — a §31 first-end seam: `player_selected_group_rows` is
the authored description of exactly the choice this section is about (`{"group":
"Pilot", "catalog_skill_id": "Pilot", "base_chance": 1}`), and nothing ever asked a
player to make it. Connecting it (guided creation asks which vehicle, which terrain,
which science, and the answer becomes the row) or deleting it are different
decisions and belong to the product owner, not to this fix.

Likewise, the three blank rows stay in `default_skill_ids`. Removing them would
change every new 1920s card's interest pool and point distribution, and the frozen
capture `tests/extension/fixtures/oracle/setup-3.json` records those sheets with
`"Pilot":1,"Science":1,"Survival":10` in them.

### 52.4 Where this rule does not reach: the chase executor

`kernel-ts/chase/bindings.ts` reads a skill target of its own and this section does
not guard it. That is deliberate and it is a boundary, not an oversight: the skill
names on that path come from an **authored** chase feature, not from a Keeper's
request, so there is no request to repair and no card the Keeper was reading off
when it chose the name. If an authored chase feature ever names a bare group skill,
it will still read the group row. Naming the gap here is the point -- an open
boundary is cheaper than a silent one.

### 52.5 The three ends (§31)

*Writer:* `specialization_groups` in `skills.json` — the rules table, which is the
book and does not move; and chargen, which writes the specialization row onto a card
when an occupation names one. *Reader:* `SkillResolver.resolveExplicit` /
`targetValue` / `findInText`, and `Chargen.catalogName` / `skillBase`. *Actor:* the
Keeper, which either settles against the row the card really carries or repairs the
request from `details.group`.

Tests: `tests/extension/specialization-on-the-sheet.test.mjs` (the derivation, the
open group, the collision with a flat row, the refusal and every rule in 52.2, and
an occupation's specialization reaching the card),
`tests/extension/impossible-check.test.mjs` (§45's guard, now written the way §52
makes the Keeper write it: `Pilot (Boat)`, the skill the module actually named).

## 53. A delivery the player already read keeps the keeper's side of the transcript (2026-09-16)

A custom message can come from either side of the table. The host writes the keeper's
opening and the deliveries it places itself (§34.18's held `renderedText`, the service
notices of §38); it also injects messages that stand in for the player's own turn. Only
the channel the entry arrived through can say which — the text cannot, because a delivery
and a player's line are both prose in the play language, and no rule may read the words to
decide.

The speaker is therefore decided once, from the channel, and every projection of that entry
reads the one answer: the live `entry_appended` stream and every later re-read of the file
must name the same speaker for the same entry, and a renderer must use the name it was given
rather than deciding again.

This is load-bearing because the transcript treats the two sides differently on purpose — a
player's own message is previewed at five lines, a delivery folds against the §16.6 card that
draws it, and only a player's message offers resend. A delivery named as the player's is
therefore silently shortened: t9 turn 36 (2026-09-16) came back as three of six paragraphs,
cut on a full stop, and the paragraph it dropped was the answer the table had just won an
extreme success for. What the player has already been given is not taken back on the second
look.

## 54. A project whose form is not known yet is not `base` (2026-09-16)

Found in real remote play on the shipped build, not by a suite. Every fresh load
of the paired web shell spent 10 to 30+ seconds in this state, on a project whose
root is perfectly ordinary:

- the composer **disabled**,
- the Mods panel absent,
- and the banner 「此会话使用 coc-keeper 扩展包；当前项目是 base。请用当前扩展包新建会话继续。」

Then it healed by itself. A person does not wait that out — they conclude the
product is broken and close it. **The flicker is the defect**, not a cosmetic
detail on the way to a correct state; a playtest that "recovers by reloading" has
found a bug, not avoided one.

### 54.1 One field, two questions

`activeWorkbenchPlan.packId` answers *which layout am I painting*. The shell
starts by painting the base layout deliberately — `createProductWorkbenchRuntime`
calls `activateBaseWorkbench()` so the first frame is a usable shell, before
anything has been asked of the host.

`packSnapshotMismatch` asks a different question — *which form is this project
in* — and read the same field for its answer. On a local Electron host
`listExtensions` returns in milliseconds and nobody ever saw the difference. Over
a relay it can take tens of seconds, and for all of them the shell was telling
the person that their session belongs to another pack. This is the §31 shape
again: a field with two readers that mean different things by it.

The second half was in the loader:

```ts
try { list = await host.listExtensions?.(projectId) ?? [] }
catch { list = [] }          // a timeout becomes "this project enables nothing"
```

A failed call is not an answer. A host that does not implement the method *is* an
answer — it has none — but a rejection says only that nobody was asked.

### 54.2 The contract

**The shell never asserts a project's form before the host has answered for that
project.** `packSnapshotMismatch` is gated on the answer having arrived for the
currently selected project; until then no session is accused and the composer is
not locked for this reason. The placeholder layout is unchanged — the first frame
is still a usable shell.

**A failed extension listing is retried quietly and never reported as an empty
one.** `useDeclarativeContributionLoader` takes an `onFailure` alongside
`onExtensions`: a rejection schedules a retry (400ms, 1.2s, 3s, 6s) and reaches
`onFailure` only when those are spent. The shell holds the form it last knew
rather than flipping to `base`, and a single dropped request over a flaky link
costs nothing visible. Only a run of failures is put in front of the person, and
even then as a notice that the interface is staying as it is.

### 54.3 Still open: the shell goes blank while it believes it is connected

Reproduced three times in the same session (first pairing after an app restart,
mid character-creation, and on sending a line mid-scene): the whole shell
collapses to 「暂无项目与会话」. `[data-testid="remote-lifecycle"]` is absent and
there is no `.remote-browser-banner`, so `RemoteBrowserApp` considers itself
**connected** — the person gets an empty product with no explanation at all.
The host process is alive, the relay room answers 200, and the turn that was sent
during the blank **was delivered and answered** (it is there after a reload). The
mechanism was not established when this section was written and was deliberately
not guessed at. It is `RemoteBrowserApp` remounting the whole App on every
lifecycle transition — see §57, which fixes it.

## 55. A notice the host places reaches the screen when it is placed (2026-09-16, extends §53)

§53 settled *whose* words a host-placed delivery carries. This one settles *when* the player
gets them: at the moment the host places them, not at the next reading of the transcript.

Every word the host puts in front of the player itself travels one channel, `pi.sendMessage`
— the eight service notices (§38.5 review pause, §38.7 provider outage, §38.9 turn
unfinished, §38.11 commit interruption, §34.17 a delivery cut in half, §42.6 standing state,
§47 preparation wait) and the §8 `placed_by_host` fallback, which carries the turn's own
prose rather than a notice about it. Pi delivers such a message as a `message_end` whose
message carries `role: "custom"`. It is not an `entry_appended`: that event belongs to
`pi.appendEntry`, carries the other kind of entry (`type: "custom"`, not `type:
"custom_message"`), and nothing the host delivers has ever travelled it.

The host must therefore project a delivery from its own arrival. Until 2026-09-16 it did
not: the only projection of a delivery hung off `entry_appended`, so the live stream had no
branch that could ever see one, and the eight notices plus the host's own fallback prose
existed only in the file until something re-read it. The registry of host-delivered channels
(§53) is the whole test — whichever channel the host is registered to deliver through is
projected — so a channel added to that registry arrives on screen the day it is added.

The identity is the transcript's, not the projection's. The emitted message carries no entry
id; Pi discards the id its session manager minted. The host reads the row Pi appended before
it emitted, and publishes that id, so the live arrival, the watchdog replacement's startup
catch-up, and every later re-read are three readings of one entry rather than three entries.

**Where this must be asserted.** Not at the extension seam. The acceptance for these notices
counts `coc-delivery` custom messages in the session, and they were always there — that layer
was green for as long as the projection was dead, and it would stay green through the next
channel breaking the same way. The assertion belongs one layer down, on the projection: a
delivery that arrives the way Pi delivers it produces a `presentation` event. The fixture
that hid this is its own lesson: it fabricated an `entry_appended` carrying a
`custom_message`, a shape Pi has never emitted, so the test was green about a path that could
not run. A fixture for an arrival shape is pinned to the dependency that produces it.

## 56. One entity, one identifier; and an advisory lane that keeps failing says so (2026-09-16)

Campaign `game-3d8ab658` (masks.pdf, module graph generation 7, 56 nodes) played a whole game —
a full drift and one recovery — with the memory lane failing on **every one of its 31 turns**:

```json
{"lane":"memory","turn":0, "ok":false,"reason":"lane_error",
 "detail":"memory.job unknown_entity: entity 'artifacts-two-cultures' is ambiguous"}
{"lane":"memory","turn":26,"ok":false,"reason":"lane_error","detail": word for word the same }
```

Nothing recorded from a single turn. No sign of it on the player's side, on the keeper's side,
or anywhere an operator looks. It was found by someone counting something else.

**56.1 A handle is unique only within a kind.** `ModuleGraph.handle` strips the node kind off
the id, so `clue-artifacts-two-cultures` and `conclusion-artifacts-two-cultures` are both called
`artifacts-two-cultures`, and `resolve` — which matches the handle first — answers `unknown_entity:
… is ambiguous`. Three of that book's 52 bare names collided, and the collisions are not that
book's accident: the reader's own naming convention pairs `clue-x` with the `conclusion-x` it
supports, and `location-x` with the `scene-x` at that place. **Any module written to that
convention has them.** Nothing in `resolve` is wrong: given the kind, every one of those names is
exact and unique. The kind was what got thrown away.

**56.2 A caller that already holds the node never hands on a bare name.** `storyAssessmentContext`
walked `graph.kind('conclusion')`, reduced each node it was holding to `graph.handle(node)`, and
asked `continuityView` to find those same nodes again by name — one function, node in hand at both
ends, with a lossy string in the middle. The identifier that travels between layers carries its
kind: `referenceName` (`"conclusion: artifacts-two-cultures"`), parsed back by `resolveReference`
against `graph.byKind`, which is the shape `adaptation.prepare` has always minted for its own
anchors. **Disambiguation is never a list of prefixes in code**: a convention written into a
constant breaks the next time the convention moves. Either the kind travels with the name, or the
node does.

A bare name from the *keeper* is a different case and keeps its present behaviour: `table.lookup
kind=continuity` with an ambiguous anchor still refuses with `unknown_entity` and its candidates,
because a model's guess is a guess. The refusal was only ever wrong when the host was the one
guessing.

**56.3 A lane that fails and fails is told to the operator, once, and never to the player.**
The failures were written: `ok: false`, `reason: "lane_error"`, on 31 rows of the campaign's
`telemetry.jsonl` and 31 `coc-telemetry` session entries. Both halves are writes. No consumer
existed, the evidence tool included: `tests/play/kpi.py` rightly keeps lane rows out of its
tool-call statistics — a lane round is not a tool call, and counting one would dirty the
read-before-write ratio — and has no section of its own for them, so a campaign's KPI report is
structurally unable to show a lane failing. Thirty-one failures and zero failures looked exactly
alike from every angle anyone looks from.

The advisory lanes (`memory`, `journal`, `voice`) now share one telemetry writer, and it watches
its own rows. Consecutive rows with `ok: false` are a streak; a row with `ok: true` ends it. From
the third, the lane emits one `coc-lane-status` session entry and one `coc:lane-status` bus event —
`{lane, campaign, turn?, status: "down", streak, reason, detail?, fix}` — in the shape §32.2's
`coc-admission-status`, §38.5's `coc-review-status` and §38.7's provider notice already use, plus
one `event: "outage"` row in the campaign's own telemetry so the evidence path names it once
instead of repeating line 31. Once per streak, not once per failure.

**What that family reaches today is a record, not a screen.** As of 2026-09-16 no surface in this
repository renders any of it: `coc-admission-status`, `coc-review-status`, `coc-provider-status`,
`coc-mods-status` and this new `coc-lane-status` are written as session entries and bus events, and
nothing under `Electron/` or `pipicoc/` reads one. The entry lands in the session record and the
bus event is there for a consumer; neither is yet in front of an operator's eyes. Anyone adding a
sixth status entry is joining a family in that state, and should know it before treating the emit
as the end of the seam — §31's three ends apply to a notice exactly as they apply to a field.

Three, not §32.2's two: a lane job spends its own retries before it writes one failed row, and
nothing is blocked while the streak runs, so two rounds may still read as weather. The third does
not.

**It is not the player's business, and it is not said in fiction.** `admissionUnavailable` speaks
to the player because admission blocks the turn; an advisory lane blocks nothing, the table plays
on without it, and a service notice about the keeper's bookkeeping would be noise for a failure the
player neither caused nor can fix. The boundary is exact: **a keeper-side lane failure is never
player-visible, and is never silent thirty-one times either.**

Only the lane's own outcome rows count. `runLane` writes several nested `lane: "lane-call"` rows
per job through the same writer (§12.8.1), and a provider round that succeeds on a job that still
fails would clear the streak on every turn — which is the silence this section exists to end.

## 57. A reconnect is not a restart (2026-09-16)

Three times in one real remote session — the first pairing after an app restart,
mid character-creation, and on sending a line mid-scene — the whole product
collapsed to 「暂无项目与会话」. `[data-testid="remote-lifecycle"]` was absent and
there was no `.remote-browser-banner`, so `RemoteBrowserApp` considered itself
**connected**: an empty product with no explanation at all. The host process was
alive, the relay room answered 200, and the turn sent during the blank had been
delivered and answered — it was there after a reload. §54.3 recorded it as open
because the mechanism was not established. This is the mechanism.

### 57.1 React reconciles by position and type

`RemoteBrowserApp` rendered `<App>` inside a different tree for each phase:

```tsx
if (host && displayPhase === 'connected') return <><App host={host} />{dialog}</>
if (host && (reconnecting || disconnected)) return (
  <div className="remote-browser-shell"><div className="remote-browser-banner"/><App host={host} /></div>)
```

A Fragment and a `div` at the same slot are different types, so **every phase
transition unmounted the App and mounted a new one.** All of its state went with
it: the project list, the selected session, the loaded transcript, the draft in
the composer, the scroll position. What the person saw was the product reloading
itself from empty — and, until §54, flashing `base` on the way back, which locked
the composer and accused their session of belonging to another pack.

The blip that triggers it is ordinary. The relay closes a browser socket with
1008 when a burst crosses `maxInflight` (32) or `maxFramesPerWindow` (120/s), and
a mobile link drops sockets on its own; the shell reconnects in under a second.
Recovery was already correct at the transport layer. The shell threw the product
away while it happened.

### 57.2 The contract

**One mounted App for the life of the pairing.** While a host exists the shell
renders one tree — `.remote-browser-shell` wrapping `<App>` — in every phase. The
lifecycle banner is a conditional *sibling* that appears above it and disappears
again; `<App>` never changes position, so it is never remounted. Only the
pre-host states (first connect, and a close that cannot recover) render the
separate `browser-host-state` page, because there is nothing to preserve yet.

Because that wrapper now exists in every phase, it must be exactly the viewport:
`height: 100vh` as well as `min-height`, `overflow: hidden`, with
`.remote-browser-shell > .pipiui-shell` taking `flex: 1 1 auto; min-height: 0;
height: auto`. A wrapper with only a `min-height` grows to whatever the shell's
tallest card asks for — the investigator-sheet draft took it past 3500px — and
since the shell scrolls its own panes internally rather than the document, the
composer sits below the fold and cannot be reached at all. `height: auto` is
required because `.pipiui-shell`'s own `height: 100%` cannot resolve against a
flex container with no definite height. Caught in live play on the deployed
build, as a regression introduced by this very section; jsdom has no layout, so
this half is verified by measuring the composer's box in a real browser, not by
a unit test.

A reconnect still hands `<App>` a new `host` object: its effects re-run and rebind
to the new socket, which is what recovery means. That is a re-render, not a
remount, and the loaded table survives it.

Test: `RemoteBrowserApp.continuity.test.tsx` marks the mounted `.pipiui-shell`
node, drives connected → reconnecting → connected, and requires the same node
back. It fails on the pre-§57 shell.

## 58. A cash amount has a source (2026-09-16)

Two real-table defects came in through the same hole, five hours apart, and neither is a
rounding mistake.

- BUG-078, M-DETOUR t7 turn 25. The keeper narrated half a *sol* to a waiter in a Lima bar
  and wrote `{"delta": -0.5, "currency": "USD", "why": "…半个索尔…"}`. At 1921 rates that is
  four to eight times the sum the fiction named. The receipt's own reason field and its own
  number disagreed, and nothing on the path could say so.
- BUG-084, M-DETOUR t7 turn 31. The player said "six-thirty is what I can afford for a plain
  meal" — a statement about what was in her purse. The keeper charged it as the price of the
  meal: `{"before": 6.3, "after": 0, "delta": -6.3}`. That table's entire deviation had been
  played for a balance, nine dollars toward a steamer ticket to New York, and the balance went
  to zero the night before departure. The same session had already priced a hotel night at
  1.0, a full set of darkroom chemicals at 1.0 and the cheapest glass in that same bar at 0.2.
  The rulebook prints Lunch at 65¢.

The common shape is not a bad number. It is that **the number had no source**. Three bodies of
price knowledge existed the whole time and `apply cash` read none of them: the rulebook's
printed 1920s price lists (396 records in `content/rulesets/coc7/rules-json/equipment.json`,
each with an amount, a currency and a page), the campaign's own settled transactions, and the
investigator's balance. The effect took a signed number and a sentence and wrote both down.

### 58.1 The kernel prices nothing

The kernel holds no price table, no exchange rate and no notion of what anything is worth,
and it never will: what a thing costs in a scene is an open semantic judgement and belongs to
the keeper and to the authored rulebook data. The kernel's part is narrower and deterministic:
make the keeper cite where the amount came from, resolve the citation against data the product
already holds, and refuse a citation it cannot resolve.

### 58.2 `source` on the cash effect

`apply {kind: cash}` requires `source`, one of:

- `price` — the rulebook prints this price. Requires `price_id`, exactly as
  `lookup kind=catalog kinds=["item"]` returned it. The kernel resolves it against the printed
  list and refuses an id that list does not carry; an invented `price_id` is not a source. The
  receipt then carries `source_amount`, `source_currency`, `source_display`, `price_name`,
  `price_era` and `source_provenance` — what the book prints, beside what was charged. The two
  are allowed to differ: quantity, haggling, a local market and a keeper's judgement are all
  legitimate, and the receipt records both rather than adjudicating between them.
- `quote` — someone in the fiction named this amount. Requires `with`, the person who named it.
  This is keeper invention and stays fully allowed; it is now *labelled* as invention, and it
  lands on that person's account.
- `found` — no price is involved: money found, stolen, earned, given, or a debt settled.

There is deliberately no source meaning "a figure the player said". A number a player says
about their own purse is a balance, and §58.4 puts the balance in front of the keeper so it
does not have to guess which one it is hearing.

### 58.3 `currency` is declared, not echoed

`currency` on the receipt used to be copied from the sheet, so `"USD"` was never a claim
anybody made and nothing could contradict it — the keeper had no way to say *sol* even when it
had just written *sol* in the narration. The effect now accepts `currency`. When it is given
and is not the unit the balance is held in, the call is refused: the kernel owns no exchange
rate, so it will not silently spend one unit out of a balance counted in another. The fix names
the held unit and asks for what actually left the purse, or for the exchange to be settled in
the fiction first.

### 58.4 The read side: the balance, and what this table has already charged

`known.investigator` carries `cash` (amount and currency) and `living` (standard and spending
level). The capsule named no money at all before this, which is why the only figure in the room
at turn 31 was the one the player had just said out loud.

`known.prices_paid` carries the most recent amounts this campaign has actually charged, with
their `why`, their `source` and their `price_id` where there is one. These are facts the
product produced itself and nothing read them back: `npc-ledger.json` keeps the with-an-NPC
half, but only for the people standing in the room, and a price is a fact about the world, not
about who is present. Without this, every price a keeper sets is set from nothing, which is how
the fourth price in one session came out at thirty-one times its own cheapest drink.

### 58.5 The catalog was never `not_implemented`

`lookup kind=catalog` has been live in the TypeScript kernel the whole time
(`kernel-ts/rules/queries.ts`, wired at `kernel-ts/registry.ts`), and answers the rulebook's
printed records including the equipment and price lists with their page provenance. The tool
description the keeper reads said "the kinds rule and catalog answer not_implemented in this
slice", and this document said the same. Both were stale. A capability the model is told does
not exist is a capability that does not exist, which is the §31 gap in its third form: the
field is written, the projection is live, and the keeper was told not to go and get it. The
tool description now says what the kind answers, and `kinds` is on the tool's schema so the
price list can be asked for by name.

### 58.6 The three ends (§31)

- **Writes it.** `stageCash` in `kernel-ts/apply/inventory.ts`, from the source the keeper
  cites; the printed figures come from `equipment.json` through `Catalog`.
- **Reads it.** `investigatorSummary` and `pricesPaid` in `kernel-ts/read/capsule.ts` for the
  keeper; `mechanicsOf` in `kernel-ts/read/mechanics.ts` carries the source onto the mechanics
  card, so a charge can be read back against what it was based on.
- **Acts on it.** The keeper, which must answer "from what?" before it may answer "how much",
  and has `lookup kind=catalog` to answer it with.

### 58.7 What this section does not decide

It does not check affordability, does not compare a charge against the printed price and refuse
the difference, and does not read `spending_level` as a limit. It does not detect a currency in
prose. A shape check on the receipt — a `delta` that happens to equal `before` — is a symptom,
not this defect: the same mistake at ninety per cent of the balance is silent, and the fix for
"the number came from nowhere" is a source, not an alarm on one of its shapes.

## 59. A card says which of three things is true about opening it (2026-09-16, amends §16.2)

One boolean, `mechanics.available`, was answering two questions at once, and a third case had no
way to be said at all. Campaign `game-1c0faba5` (2026-09-16) has all three on the same table.

**What the boolean meant to its writer.** `apply handout` sets `attachment.available` to mean *there
are bytes*: it is true when the module authored the card's text (materialized to
`<campaign>/handouts/<handle>.md`) or when a registered asset file is on disk, and false otherwise.
That is a fact about a document, and it stays: the receipt keeps `attachment.available`, and the
Keeper-facing note on the `apply` result (`No card exists for …: the receipt landed, and the player
has nothing to look at. Say what the document holds in your narration`) is written from it. That
half of the seam was never broken — the real table's Keeper read that note and did exactly what it
asks.

**What the boolean meant to its reader.** The card drew it as *delivered / not delivered*. So
Handout 5 of The Haunting — authored `player-safe` by the module's own author, won on a hard Library
Use, its clue landed in the same turn, its contents read out in the prose directly above the card —
arrived stamped "not delivered". The card contradicted the delivery it was sitting under. Nothing
about the handout's authorization was ever in question; nothing in the pipeline had to change for
the player to be told the truth.

**The third case.** The kernel's `map` rows never wrote the field at all. A live delivery was
answered downstream — the host's rendered attachment merges into the delivery's rows and brought the
boolean with it — but **the row the campaign records is the kernel's**, and it carried no answer. So
the history card and the live card were two different objects and only one of them had been wired: a
map re-read out of `turns/*.json` was indistinguishable from a map that had been answered "no". The
same hole swallows any live path where that attachment does not merge.

Turns 33 and 35 of `game-1c0faba5` are worth stating precisely, because the premise is easy to get
backwards: those cards drew "not delivered" from a boolean that was *correctly* `false`. That
campaign's module directory holds no `assets/` bytes at all, so `renderMapView` had no pixels and
honestly said so. The word was wrong — the map had been delivered — but the answer was right, and
the absent bytes are their own defect, not this one.

### 59.1 Three states, declared by the producer

Every `mechanics` row that hands the player something openable carries `document`:

| value | means |
| --- | --- |
| `ready` | bytes exist and travel with the row (`path`, and `text` for a materialized page). The card opens. |
| `none` | the producer asked and there is nothing: the module registered the card with no document, or the render refused. **The delivery still happened**; only the page is missing. |
| `unresolved` | this producer cannot answer, and a later one owes the answer. |

A row that hands over nothing openable carries no `document` at all, and no consumer says anything
about opening for it. **The judgment never reads `kind`**: a consumer asks whether the row declared
the field, not which family it belongs to. A closed list of kinds here would be the same defect one
layer up — the next kind that hands over a document would be silently excluded by omission, exactly
as `map` was.

`available` is gone from the projection. It is not kept as a mirror: two fields answering one
question is what produced this, and one of them going stale is unobservable.

### 59.2 Who answers, and when

- **Handouts.** `apply handout` settles it itself: `ready` when `attachment.available`, `none`
  otherwise. A handout is never `unresolved`.
- **Maps.** The kernel does not hold pixels — only the host composes a map view, and only it knows
  whether the authorized regions rendered. The kernel's projection therefore leaves the map row
  `unresolved`, and the host's prepared attachment (`renderMapView`) overwrites it with `ready` or
  `none` when it merges into the delivery's rows. **A map card that reaches a player still saying
  `unresolved` never met that attachment**, and that is now a distinct, findable state rather than
  something indistinguishable from an empty map. It is also what the turn record keeps, which is the
  honest thing for it to keep: the recorded row is the kernel's, and it never knew.

The two legs are built separately and cannot import each other, so the three words are declared
twice — `DOCUMENT_READY` / `DOCUMENT_NONE` / `DOCUMENT_UNRESOLVED` in `kernel-ts/read/mechanics.ts`,
`MAP_DOCUMENT_READY` / `MAP_DOCUMENT_NONE` in `extensions/kernel/map-view.ts` — the same way §39.2's
`source` / `play_language` pair is. A test pins the two declarations to each other.

### 59.3 What the player is told

Three internal states, two things a player can be told, and neither of them is a claim about
delivery. The card stamps `available` when, and only when, the row is `ready` **and** the bytes
actually drew; every other case draws no stamp. A player does not need to know that a category has
not answered yet — they need to know whether they can look at the thing — and a card that cannot
say yes says nothing rather than something false.

The caption `pending` ("not delivered") is withdrawn from `content/ui/<tag>/mechanics.json`. It was
false in every place it was drawn: the handout, the map with no bytes, and the map whose image this
client failed to load had all been delivered.

### 59.4 The three ends (§31)

1. **Who writes it.** `stageHandout` (`kernel-ts/apply/entities.ts`) decides the handout's bytes;
   `mechanicsOf` (`kernel-ts/read/mechanics.ts`) turns that into `ready`/`none` and stamps every map
   row `unresolved`; `renderMapView` (`extensions/kernel/map-view.ts`) answers the map's.
2. **Who reads it.** The delivery's `mechanics` rows, merged in `extensions/kernel/index.ts` and
   drawn by `pipicoc/mechanics.js` (`renderRow` for handouts, `MapRow` for maps).
3. **Who acts on it.** The player, by opening the card — which is the end that was broken: every card
   that could not be opened told the player the delivery had not happened, including the one whose
   contents they had just been read.

Guarded by `tests/extension/authored-handout-reaches-the-player.test.mjs` (both kinds, through
`table.apply` on the shipped starter, whose graph carries the same two handout nodes the real table
was handed) and `tests/extension/map-session-viewer.test.mjs` (what the card draws).

## 60. A proposal that is over retires from the table (2026-09-16, narrows §36.15)

Three retained playtests of the same day, two branches of one shape, and the same price every
time: a tool call the player paid for, spent on a proposal that could never finish.

`homes/t8`, campaign `game-2543d551`. Three `new_destination` proposals were prepared in Lima, and
all three went `stale` when the pinned world moved. The newest, a corner photography shop the player
had asked an NPC about, was created at 13:14:20Z. Hours later, on a reed island in Puno — hundreds
of kilometres and three in-game days away — turns 39, 40 and 43 each opened with
`{"lane":"adaptation","proposal":"<the corner shop>","status":"stale"}` and each lost one call:
`apply`, then `resolve`, then `lookup`. Three turns, three different verbs, one dead shop.

`homes/t9`, campaign `game-ef8e60aa`, and `homes/t4`, campaign `game-1c0faba5`. Here the dead job is
`failed`, and `failed` was in `ADAPTATION_HELD`, so it was not merely announced — it was *held*, and
a held terminal wait blocks every verb including `narrate` until the Keeper looks the corpse up by
name. t9's sanatorium failed on turn 22 and blocked an `apply` on turn 45; t4's street of neighbours
failed on turn 24 and blocked both a `lookup` and a `look` on turn 40, by which time the player was
upstairs in a different house drawing a bolt. Both of those later rows carry `"first": true`, which
is the host's own word for *this process held no wait, and the cold scan gave it one*.

### 60.1 The in-memory half was never the leak; the store was

Within one process the notice really is said once. The gate spends `adaptationStale` on the first
tool call of the turn, and the next boundary returns early on `!held && adaptationScanned`. What
re-armed it was disk. `adaptation.status` with no name answers the host's cold-recovery scan out of
the retained job files, and it returned `failed` and `stale` jobs among the live ones, newest first,
with nothing anywhere to retire them. So the notice was said once *per process*, and a campaign has
as many processes as the player has evenings.

**The unnamed scan answers about work, not about history.** `RETAINED_LIVE` is `pending`,
`reviewing`, `ready`: work in flight, plus the one decision that still has something for `apply` to
accept. `failed`, `stale`, `cancelled` and `accepted` leave that surface the moment they are written.
Nothing is deleted — the job file keeps its status, its attempt and the reviewer's own refusal, and
`adaptation.status name=<name>` still answers with all of it. A proposal is simply no longer offered
to a table that did not ask for it. A `ready` job whose pin has since moved needs no special rule:
the scan re-checks freshness as it always did, writes `stale`, and retires it in the same breath.

### 60.2 A failure is a result, not a wait

`ADAPTATION_HELD` loses `failed`. §47 held `ready` and `failed` together because "the table owes them
an answer before it acts", but they are not the same kind of thing: `ready` has reviewed changes
sitting there, and `failed` has nothing at all. There is no answer to owe.

A terminal status the host *was* waiting on is said once, by name, in the gate, and then the table is
free — including for the repeat of the very action the dead job was prepared for. The notice carries
the kernel's own `reason`, which until now never left the job file, and it names the one call that
starts a fresh attempt. For `stale` that is `prepare`; for `failed` it is `prepare` **with
`retry: true`**, because `prepare` answers a retained non-stale job with its own dead view, so an
instruction without `retry` would be a loop — the trap Agents.md already records for `fix` text. The
`retry` parameter's description says so now; it spoke only of source readings before.

**The cold scan announces nothing terminal at all.** The notice exists to correct a belief the Keeper
holds — *the place I asked for is being built* — and a Keeper that has just come up holds no such
belief; it has never heard of the job. So only a wait this process was actually holding is worth a
sentence. This is the second lock on the same door: even if a store somewhere still offers a corpse,
it costs the table nothing.

### 60.3 The three ends (§31)

- **Who writes it.** The kernel, on every status transition, and on the freshness re-check inside
  the scan itself. Unchanged.
- **Who reads it.** The host's turn boundary — by name while it holds a wait, unnamed once per
  process for cold recovery. The unnamed read now sees live work only.
- **Who acts on it.** The gate, exactly once per death, and the telemetry that records it. The
  `lane: "adaptation"` row and the block row both carry `cause` now, so "why did it fail" is a
  question the evidence can answer; `status: "failed"` with nothing beside it is all three retained
  tables recorded, and it is why nobody could say why any of them failed.

### 60.4 Retries: nobody, zero, and that was the real silence

No layer retries a failed proposal. t9's turn-45 row is not a second attempt — the job file is
`attempt: 1`, created once at 13:06:56Z; the cold scan simply re-read the same 23-turn-old record.
The only retry path is the Keeper's own `prepare`, and until this section the Keeper was never told
the proposal had failed, how many times, or why. So the number stays zero and the decision stays the
Keeper's — it now just has the facts to make it with.

### 60.5 What this does not decide

A proposal is still pinned to the world it was prepared against and to nothing else. Nothing here
scopes a proposal to a scene, a city or a day, and nothing expires one by age: a `ready` proposal
prepared in Lima is still offered to a player in Puno for as long as the pin holds, and it retires
only when the pin moves and the scan writes `stale`. In practice the pin moves within a turn or two,
which is why every one of t8's Lima proposals was already dead — but that is the pin doing it, not a
rule about distance. §36.15's turn ownership, freshness, pin and acceptance semantics are otherwise
untouched.

### 60.6 Tests

`tests/extension/dead-proposal-retires.test.mjs`: the kernel over its own RPC, for both branches
(`failed` and a pin that moved) — retired from the scan, still readable by name, still on disk; and
the host through the real extension seam — a failure told once with its cause and the `retry=true`
call, the table free the same turn, no re-arming at the next boundary, and a cold scan that hands
back live work and never a corpse. `tests/extension/turn.test.mjs`'s cold-recovery test now exercises
the case it was always for, a `ready` proposal a restarted process knows nothing about.

## 61. The foreground reading lease belongs to the turn that is waiting (2026-09-16, extends §22 and §47)

`foreground` on a reading job is a claim that a Keeper turn is blocked on that material *right now*,
and it is what reserves the single foreground lease §22 advertises ("one foreground and up to two
background jobs may hold independent leases for distinct focuses"). That claim had a writer and no
eraser. Every foreground `module.read.request` for a job already queued or running promotes it;
nothing ever demoted one. So when the Keeper's own wait ended — and §47 is explicit that
`reading_timeout` is the host's patience ending and never the reader finishing — the job kept the
lease for the whole rest of its life, and the read for where the players were actually standing
queued behind a read the table had walked away from.

**Retained evidence, M-DETOUR `game-3d8ab658-d335-4426-aca6-6dcb76608490` (`homes/t7`, 2026-09-16).**
`read-6` (`purpose: detail`, `focus: "Bar Cordano"`, foreground) was requested on turn 25 at
15:17:37Z; the Keeper's wait on it expired at 15:19:37Z with `reading_timeout`. On turn 26 at
15:23:06Z `move:museo-de-arqueologia-t26-c1` landed and the party was at the museum. On turn 27 at
15:26:00Z the Keeper asked the book about the museum; `read-7` was queued at 15:26:01Z. `claim`
refused it three times — the `claim_empty` row at 15:28:31Z was written with a job sitting in the
queue — because `read-6` still held the only foreground lease. `read-6` finally *failed* at
15:29:11Z, 694 s after it started and **574 s after anybody was waiting for it**; `read-7` was
claimed at 15:29:11.344Z with `queue_wait_ms: 190344`, long after its own 120 s wait had expired.
The player, standing in the museum, was told the museum was still being prepared while the single
reader lane was spent on a bar.

**`module.read.unwait {module_id, job_id, campaign?} -> {job_id, foreground: false}`.** The host
calls it when the *last* waiter on a reading leaves without cancelling it. A `queued` or `running`
job loses its `foreground` flag; a finished job, an unknown one and an already-background one are
no-ops, so the call is idempotent and never fails a turn. It is routed like `module.read.finish` —
to whichever workspace's queue holds that job id — and never forks a campaign's private module copy.

**A demotion is not a cancellation and not a timeout.** The reading goes on, its material still
lands, §47's "is this still in flight" answer is unchanged, and the retry path is untouched. Only
the lease moves. And the trigger is an event, never a clock: the last waiter leaving. This product
has already paid for a timeout fallback once — `reading_timeout` firing five seconds before the
material arrived — and no reading decision may be taken by elapsed time again.

**The host must stop re-asserting what it gave back.** `fulfil` polls `module.read.request` roughly
three times a second for the whole life of a reading, and the kernel promotes on every foreground
request. A demotion that is not matched by the poll is undone within 300 ms. So the live wait is
held on the request itself (`PendingReading.foreground`), raised again by any later `ensure` that
joins in the foreground, dropped when the waiter count reaches zero, and it — not the original
`params` — is what every poll sends.

**The demotion is a host decision, so it is on the record** (§47): `{lane: "reading", event:
"unwaited", module_id, campaign, job_id}`. It is written through the unwrapped recorder, because
the wrapper doubles as the stall watchdog's heartbeat and a host note about a job is no evidence
that the job's reader child is alive.

**What this does not change.** Prefetch still queues only the exits of the scene just entered
(§22), `materialOverride` still prefetches nothing so a pinned adaptation never reads the shared
library, and concurrency stays at one foreground plus two background leases for distinct focuses.
Ordering among live foreground reads is still first-come-first-served: that a read for the party's
current location should outrank an older live foreground read is a separate question this evidence
does not settle, because only one wait was ever live at a time here.

## 62. A failed read is not an answer (2026-09-16)

The third and fourth instances of one bug, found while playing the deployed
build over the relay. §54 fixed the first: a rejected `listExtensions` was
reported as `[]`, so the shell concluded the project enabled nothing and painted
it `base`. The shape is general, and the remaining instances were worse, because
they did not merely display a wrong value — they **overwrote a correct one the
shell already held**.

### 62.1 What was observed

After a burst of `transport request timed out`, the composer's model chip read
`deepseek-v4.1-flash` / thinking `off`. Before the burst it read
`DeepSeek V4.1 Flash` / `low`; a reload brought that back. Nobody chose `off`.

```ts
void host.getModelState(...).then(...).catch(() => {
  const model = { provider: ref.provider, id: ref.modelId, name: ref.modelId }   // the raw id as a display name
  setModelState({ model, thinkingLevel: 'off', ... })                            // a level nobody chose
})
```

The same file did it again for the whole capability set:

```ts
void host.capabilities().then(...).catch(() => {
  setCanRevealInFinder(false); setBrowserAvailable(false); setTerminalAvailable(false)
  setGitAvailable(false); setRetainedWorktreeDispositionAvailable(false); setPlanAvailable(false)
})
```

One dropped request and the product claims it has no browser, no terminal, no
git and no plans — features disappear from the shell with no error anywhere.

`sendPrompt` does not carry a thinking level (the host reads it from the session
journal), so the fabricated `off` did not change how a turn was answered. It
still told the person something false about their own session and destroyed the
state the shell had.

### 62.2 The rule

**A rejected read is never written as a value.** A catch may record an error, and
it may leave things exactly as they were. It may not substitute something
plausible — not a default, not an empty list, not `false`, not a raw id in place
of a name. "We could not ask" and "the answer is nothing" are different facts and
the shell must not conflate them.

`readWithRetry` (`retry-read.ts`) is the shared form: quiet retries (400ms, 1.2s,
3s, 6s, the §54 schedule), `undefined` when they are spent, and a `cancelled`
hook so a stale effect stops. `undefined` means *still unknown* and callers must
treat it as such. The two sites above now use it; on a spent read the model
state keeps whatever is known for that session and only falls back to the
session's own model when nothing at all is known — and then to the catalogued
model, so the chip never shows a raw id.

### 62.3 The remaining ledger

A sweep of `.catch(… setX(…))` across `packages/ui/src` found 43 handlers. Most
record an error, which is correct. These still substitute a value and are the
same class, listed so the next person does not have to find them again:

| Site | Substitutes |
| --- | --- |
| `ExtensionsPane.tsx` | `setServers([])` — a failed list becomes "no MCP servers" |
| `PlanApprovalBar.tsx` | `setPlans([])` — becomes "no plans" |
| `DocumentPanel.tsx` | `setFallbackMarkdown('')` — becomes an empty document |
| `SubagentModelModal.tsx` | `setMemoryAvailable(false)` |
| `session-workspace-ui.tsx` | `setMainBranch(undefined)` |
| `App.tsx` (history lease) | `setLease(null)` — becomes "nobody holds it" |

None of them is on the Call of Cthulhu play path, which is why they are recorded
rather than changed here: each needs its own judgement about what "unknown"
should look like in that surface, and a blind sweep would be its own defect.
`setGitBinary('unknown')` is **not** in this class — `unknown` is the honest
third value, and that is the shape the others should grow toward.

## 63. "Not yet known" is not "none" (2026-09-16)

§62 stopped a *failed* read from becoming a value. Measuring the deployed build
right after that shipped showed the same conflation one step earlier, on the
path every load takes. Sampling the paired page every 250ms from navigation:

```
settled at 705ms
saw the base banner   : no    (§54 holds)
saw 暂无项目与会话      : yes
saw thinking `off`     : yes
saw the raw model id   : yes
```

Nothing failed in that run. The shell simply stated three things before it had
asked: that the person has no projects, that their session is thinking `off`,
and that their model is called `deepseek-v4.1-flash`. On a local Electron host
those answers land in milliseconds and no one ever saw the gap; the relay makes
it most of a second, every time.

**A flash of a wrong claim is a defect, not a step toward a right one.** Nobody
waits it out to see whether the product corrects itself — the user's ruling,
2026-09-16: a player who sees a glitch closes the app, so continuity is a
product property, and "it fixes itself if you reload" is a bug report.

### 63.1 Where it came from

Neither site had a way to say *unknown*:

- `Sidebar` rendered 「暂无项目与会话」 from an empty list alone. `App` already
  had `projectsLoaded` and never passed it.
- `modelStateFromSession` builds the immediate snapshot from `listSessions`
  metadata, which carries a model but no thinking level — so it wrote
  `thinkingLevel: 'off'`, and `ComposerOptions` defaulted to `'off'` again.
  `ModelState.thinkingLevel` is a required field, so there was nowhere to put
  "the host has not said".

### 63.2 The contract

**A surface that has not been told may not answer for the host.** The empty
state waits for `projectsLoaded`; `ThinkingChip` takes `pending`, renders `…`
with `思考级别（读取中）` and is not operable until a level has actually been
reported. `App` tracks `thinkingKnownFor` — the session whose level came from
`getModelState` or from the person's own choice — exactly as §54 tracks
`formKnownFor` for the project's form. The layout does not move when the answer
arrives; only the claim does.

The model *name* is the remaining instance and is deliberately left: the raw id
is an unfriendly label for the right model, not a false statement about the
session, and `reconcileModelStateWithCatalog` replaces it as soon as the catalog
lands. It is recorded here so the next person knows it was weighed.

Tests: with `listProjects` pending the sidebar shows no empty state and shows one
as soon as an empty answer arrives; with `getModelState` pending the chip asserts
no level and states one once the host reports it. Both fail if either pending
signal is disconnected.

## 64. The stream fits the link (2026-09-16)

Measured in real play on the deployed build, with a WebSocket frame tap in the
paired page. One ordinary turn:

```
frames in the turn : 3773
peak frames/second : 129
socket closes      : 1008 ×7
```

`1008` is the relay's own rate limiter:

```ts
if (!frameLimiter.take(peer.roomID ?? clientKey(peer))) {
  sendControl(peer, { v: 2, type: "error", reason: "limit_exceeded" });
  closePeer(peer, 1008, "limit exceeded");
}
```

with `maxFramesPerWindow: 120` per `frameWindowMs: 1000`. The host emitted one
frame per stream delta, 129 of them in a second, and the relay **closed the
browser's socket seven times inside a single turn**.

The browser reconnects in well under a second, which is why play mostly worked
and why this went unnoticed for so long. What does not survive a close are the
frames in flight. When the turn's completion event is among them the transcript
sits at 「运行中」 forever: the host's journal shows the message complete with
`stopReason: "stop"`, the composer says 「Boss 正在工作」, there is no stop button
and no error, and only a reload — which re-reads the session and shows the whole
turn — gets the person moving again. That is the stall reported from a phone and
the reason §54, §57 and §63 all had something to fix on the way back from it.

### 64.1 What the host changes

`remote-control.ts` now puts every outbound frame through `createFramePacer`.
It is a queue, not a filter: every frame is sent, in order, and it simply refuses
to hand the socket more than 90 per second — clearly under the relay's 120 — so a
burst spreads over the following few hundred milliseconds instead of being
destroyed. `reset()` drops the backlog when a socket is replaced, because those
frames belong to a link that no longer exists.

90 is a deliberate margin, not a tuned constant: the relay's window and the
host's window are not aligned clocks, so pacing exactly at 120 would still trip
it on boundaries.

### 64.2 What the relay should change, and has not

The limiter is keyed by `peer.roomID`, so the host's frames and the browser's
frames share one budget, and the peer that gets closed is whichever one sends
next. **The browser was killed for traffic the host produced.** A per-peer bucket
would have made this visible as "the host is flooding" instead of as a browser
that mysteriously drops its connection.

`Relay/src/host-api-relay.ts` also drops host→browser frames silently in two
places — when `room.browser` is not OPEN, and when `frame.generation` is older
than `room.browserGeneration` — with no counter and no signal to either end.

That code lives in the `pipiui` repository and runs in production at
`/opt/pipiui-relay`, and the user authorised changing it (2026-09-16). It is now
fixed there as well: every connection carries its own `id`, the limiter is keyed
`room:role:id` so a peer only ever spends its own budget, the close logs which
side overran, `maxFramesPerWindow` is 600 (a streaming number rather than a chat
one — abuse stays bounded by `maxQueuedBytes`, `maxRequestBytes` and by
`maxInflight`, which caps a browser at 32 outstanding requests), and the
host→browser drop with no open browser is counted and warned instead of silent.
Regression test in `Relay/test/host-api-relay.test.ts`: a host fills the window
exactly, the browser then sends one request, and that request must reach the
host with the browser still connected.

The host-side pacer stays regardless. The relay is one deployment of many and a
host that only works against a generous limiter is a host that breaks on the
next one.

Tests: `frame-pacer.test.ts` — a burst does not reach the socket whole, every
frame still arrives in order once the window moves on, and a replaced socket
starts with an empty queue.

## 65. A long session keeps its product, and an unread form is not `base` (2026-09-16)

Two tables were played on the same machine on the same build. One reached turn
68 over four and a half hours and ended with the composer locked and the player
told 「此会话使用 coc-keeper 扩展包；当前项目是 base。请用当前扩展包新建会话继续。」
on top of `发送失败：transport request timed out` — a table whose every receipt
was on disk, told to throw itself away. The other was 39 turns in and perfectly
healthy.

### 65.1 What the counter-example killed

The obvious reading was capacity: the host logs

```
[pipi-backend] SessionManager skipped for …jsonl: 8317622 bytes exceeds bounded history limit
```

42 times for the stranded table, first crossing at 4 MB. It is not the cause,
and it is not even a decision:

- **The healthy table was over the same bound**, 10 times, at 4.90 MB. Any
  mechanism that only explains the first table is wrong.
- **`readHistory` never used `SessionManager`.** `large` was computed, logged,
  and then ignored — every call went to `readHistoryFallback` either way. The
  line described a skip that was not happening. Both this investigation and the
  one that commissioned it spent themselves on it, so §65 deletes it. The
  freeze probe's `history_scan_end size=… ms=…` is the honest reading, and it
  says the page costs the same at 8 MB as at 5 MB (~600 ms in both tables,
  flat in file size).
- **The identity read is not size-bounded either.** The session's
  `pipiui_product_profile` row is written at file creation and sat at lines 2
  and 10 of a 5,779-line file, never rewritten; `readLatestSessionMetadata`
  scans newest-first and therefore reads the entire file to reach it. Measured
  on the two real files: 154 ms over 8.50 MB and 105 ms over 5.43 MB, and
  **both return `coc-keeper`**. It is O(whole file) per listing, which is worth
  knowing, but it is not a failure. `SessionManager.open` + `getEntries()` on
  the same 8.50 MB file is 87 ms — the 4 MB bound guards an 87 ms operation.
- **The campaign was never damaged.** `turns/0068.json`, `turn-finalized`,
  `world.json`, the lanes' receipts are all there and `turn.json` reads
  `{"turn": 69, "state": "awaiting_player"}`. The break was entirely in the
  session-identity layer, above the game.

So the size story is dead, and §65 does not raise any cap. What is left is the
shape the two tables share with two earlier incidents (a project that came back
`base` forever, a shell that spent 10–30 s as `base` on every load): **a form
that was never answered was written down, or acted on, as `base`.**

### 65.2 `base` is the value that means "nobody asked"

`activePackId` is `enablement.packIds[0] ?? BASE_PACK_ID`, resolved against
`extensionLoader.installedExtensions()` — a shared mutable registry whose
contents are whatever the last `scan(root)` pointed it at. A project-origin
pack is simply absent from it while the scanner is pointed elsewhere. So `base`
is returned for two unrelated reasons: *this project enables no pack*, and
*this registry is not this project's*. Every other layer then treats one as the
other.

**The contract: a product form is written down only from an answer.**

- The spawn path read `registeredExtensionsForSpawn` and `activePackId`
  **outside** `withStableExtensionScan`, while the two other callers of
  `activePackId` join the lane with a comment saying exactly why — and the
  spawn path is the one that *writes*. It now reads both halves in one lane
  call (`readSpawnProductIdentity`) and then checks `extensionLoader
  .loadedProject()` is still this project, retrying the read once; when it is
  not, `answered` is false, the JSONL is left alone, and the session keeps the
  form it already recorded. A session stamped `base` is durable — every later
  load reads the table as another product's, locks the composer, and offers the
  person nothing but a new session.
- The session list had two producers and they disagreed. `listSessionPage`
  projects through `toSession`, which carries `productProfile`; `listSessions`
  built its own object literal and dropped it. The shell reads whichever
  answered last, so a session's recorded form appeared and disappeared with the
  call that refreshed the list. `listSessions` now carries it (§31: one field,
  one projection).
- §54 gave the shell a third state for the *project* end (`formKnownFor`).
  §65 gives it the same for the *session* end: `selectedConversationPackId` no
  longer falls back to `activeProductPackId`, and `packSnapshotMismatch`
  requires both ends to have answered. Two absences can no longer cancel into
  an assertion. This one changes no behaviour today — the old fallback failed
  open — and stands as the guard against re-coercing it.

### 65.3 What the product says when the forms really do differ

Even a correct mismatch was answered with the one instruction that destroys the
work: 「请用当前扩展包新建会话继续」. The session's transcript, receipts and
campaign are all intact and the pack can be turned back on for this project, so
the notice now names that recovery and never offers a new session.

**No product surface may propose abandoning a session as the remedy for a form
it could not read, or for one it read and disagreed with.** The remedy is to
restore the form.

### 65.4 Still open

`transport request timed out` is a client-side timer in
`createHostBackendSession` (30 s, `WS_HOST_REQUEST_TIMEOUT_MS`); it appears in
neither host log, so the host was alive and simply did not answer that request
in time. On the build those tables ran, the same stall also produced the banner:
the pre-§54 loader turned any failed `listExtensions` into `[]`, which is
`base`. §54 severed the banner from it and §65 severs the durable stamp, but
**why the host stopped answering for that table and not the other is not
established.** Nothing measured in the session file explains it — see §65.1 —
and it was deliberately not guessed at. The tables were running
`apps/server/dist/index.js` built before §54 and §57 landed, so the shipped
build must be rebuilt before the next table, and the next occurrence should be
caught with the full freeze-probe file (`pipiui-debug-h129.jsonl`), not the
stderr subset.

Tests: `long-session-keeps-its-product.test.ts` grows a real session past 8 MB
through the product's own `newSession` plus appended message rows — it still
reports `coc-keeper`, still pages its history, and nothing reports it skipped —
and drives the registry away mid-spawn to require that `base` is never appended
over a recorded pack. `App.conversation-form-unknown.test.tsx` requires that an
unrecorded session form is not accused and that the notice keeps the table.

## 66. Harm and treatment reach the rules for whoever they are about (2026-09-16)

Retained live evidence, campaign `game-3d8ab658` (M-DETOUR, `zh-Hans`). Augustus Larkin, the
scenario's own main-line NPC, lay unconscious from a heroin overdose from turn 55 to the end of the
session. Two things happened in that stretch, and the second one is the section.

Turns 56 to 58 the investigator — First Aid 70, written into her backstory as two years of
wartime orderly work — did the whole procedure: recovery position, airway, collar and cuffs open,
window, philtrum, ear lobes, slaps, jaw lift, counting breaths, rescue breathing prepared. The
receipts for those three turns are `[time, npc]`, `[definition, time, definition]`,
`[time, npc, definition]`. Not one roll. Across the whole campaign the die was thrown 22 times:
seven for Photography, five for Fast Talk, four for Appearance, two for Spot Hidden, two for
Persuade, one for Language (Own), one for STR. Zero for First Aid, zero for Medicine.

Turn 64 she gave up waiting for the doctor, made a stretcher of the blanket and dragged him down
the stairs — and **the kernel settled it**: `roll:first-aid-t64-c1`, First Aid 79 against 70,
`failure`, `decision:coc7:core-check:ordinary-check`, declared failure stakes
「拖楼梯时头颈磕碰或气道受压，伤情加重」, and the receipt even carries `npc: "augustus-larkin"`. The
narration paid it: his head struck the nosing, a short sound came out of his throat, his chest
stopped for half a beat.

The turn's other receipt, in full:

```
npc:augustus-larkin-t64-c3   {"skill": null, "why": "被被子拖下楼梯一级，仍半昏迷，头在梯级上碰一下"}
```

A check that happened, was judged against a number, named its subject, declared injury to that
subject as the cost of failing, and failed — **and nothing about that subject changed**, because
there was nowhere for a number about him to go. Meanwhile the same turn's investigator carried hit
points, sanity, a cash ledger and `delta:item-condition` rows for her film tins. In one system, on
one screen, the film had a condition and the man's head did not.

### 66.1 The rules engine was never investigator-shaped; the lookup was

`applyWoundConditions`, `damageConditions` and `HealingSession` all read the same row —
`{id, derived.HP, characteristics.CON, current_hp, conditions}` — and none of them asks whose row it
is. Combat proves it: the identical functions run for an NPC participant every bout, and
`syncCombatants` has always written the result to `world.npc_resources[<handle>]`.

What was party-shaped was every way of *naming* somebody:

- `apply damage` resolved `subject` through `actor()` (`read/handlers.ts`), which searches the party
  and refuses everything else with `no investigator <name> at the table`. Outside a fight there was
  no verb that could put a number on anyone but a party member.
- `table.resolve` looked for `action.target` in the party and nowhere else.
- `CampaignSnapshot.preload` fetches one `healing-state/<id>.json` per party sheet.
- The capsule's `present[]` had no field for the state of a body at all.

So the gap is not that the healing family is unreachable — turn 64 reached the dice through it. It
is that a person who is not at the table has no account, and everything downstream of an account
therefore cannot run for them.

### 66.2 The writer: `apply damage` names a person, not a party member

`{kind: "damage", subject, dice, why}` now accepts an NPC in the scene. The subject becomes the
settlement's patient, the same rules assign the same conditions, and the result is written where an
NPC's body is kept: `world.npc_resources[<handle>]` gains `current_hp` and `conditions`, and the
turn gets the receipts it gets for anyone — a `delta` on `hp` with `subject_is_investigator: false`,
and a `condition` receipt carrying `gained`, `lost`, `standing` and the rules layer's own
`incapacitated` (§42.2).

A person the book printed no numbers for is refused, not defaulted:
`needs`, `details.needs.field: "npc.archetype"`. Inventing a CON would settle the CON roll that
decides whether a major wound puts him under, and §34.10 already gives the Keeper the one verb that
fills the gap once, for the rest of the campaign. This is the same refusal shape `noSkill` uses for
a missing skill, and for the same reason: the `fix` names the call that makes it settle.

`apply npc {dead: true}` stays what it was — the ledger's word for a person the story is done with,
folded into `npc-ledger.json` and `dead_since_turn`. It is not the rules condition and was never
meant to carry hit points. Nothing here adds a second way to declare a state; harm is settled, as
it is for the party.

### 66.3 The reader: the capsule says whose body cannot act

`investigatorSummary` has carried `conditions` and `cannot_act` since §42.3. `present[]` carried a
person's role, wants, fears, hides, voice, known clues, keeper note, ties, stance and history — and
nothing about their body. For ten turns it introduced the man unconscious on the bed as *"Warm and
friendly despite a tired appearance"*.

An NPC carrying an incapacitating condition now arrives with `state`, before the dossier because
what their body is doing decides whether any of the rest of it can happen this turn:

```
state: {conditions, incapacitated, cannot_act}
```

`incapacitated` is the rules layer's answer (`incapacitatedBy`), read and not re-derived — same
discipline as §42.2. `cannot_act` names the person, the state, and the ways out CoC 7e actually
has, which are the same three §42.5 gives an investigator because they are the same three, and it
spells the call: *resolve with the rescuer as actor and him as target*. A person who can still act
has no `state` key, so a reader tests for the key rather than reading a list of names.
`look focus=npc` carries it too, from the same function.

### 66.4 The actor: the patient is the person named in `target`

Both surfaces already promised this. The tool: *"target names the helped investigator or patient
when applicable"*. The prompt: *"For treatment, `actor` is the rescuer and `target` is the injured
investigator."* The kernel honoured it only for a party member — and when the patient was an NPC it
did not refuse. It silently made the **rescuer** the patient, settled First Aid on a woman at full
hit points, healed her for +0 and filed her as `patient` in the outcome. A wrong subject is worse
than a refusal, because nothing in the receipt says it was wrong.

`table.resolve` now resolves a First Aid or Medicine `target` to the NPC's own row when the name is
not at the table, and the whole existing settlement runs on it: hit points, conditions, the
once-per-wound-per-day usage ledger, the wound ledger the hour window is measured from, and the
write-back to `npc_resources`. `prepareFacts` loads that patient's healing save, because `preload`
fetches one per party sheet and an absent ledger makes `time.minutes_since_injury` unknown — which
is precisely the fact the First Aid hour gate is written against, so the treatment was refused for
want of the wound it was treating.

Both prompt and tool text are corrected to say *person* where they said *investigator*, and the
`damage` effect's `subject` says who may be named and what pinning numbers is for.

### 66.5 What this does not add: there is no continuous-care check in CoC 7e

Six turns of airway management drew no dice, and that is the rulebook, not a gap.
`skill-descriptions.json` is explicit: First Aid *"must be delivered within one hour, in which case
it grants 1 hit point. It may be attempted once, with subsequent attempts constituting a Pushed
roll… A character is limited to one successful treatment of both First Aid and Medicine until
further damage is taken."* It is a procedure with an outcome, not a watch that is kept. Turn 64 drew
dice because dragging a body down stairs can make things worse; holding a jaw open cannot. **No
"sustained care" check is invented here, and none should be.**

What CoC 7e *does* give for a crisis that runs while you work is the CON clock —
`healing:dying-round-clock` and `healing:dying-hour-clock`, which §42.4 exempts from the
incapacitation gate precisely so they can keep running. That clock is the rules' own answer to
"he is going down while you work on him", and it could not run for Larkin either, for the same
single reason as everything else in this section: he had no hit points, so there was no state for a
clock to tick.

### 66.6 The three ends (§31)

- **Who writes it.** `apply damage` with an NPC subject, and combat's `syncCombatants`, both into
  `world.npc_resources[<handle>]`; `HealingSession` through `syncHealing` writes it back when the
  treatment lands. Before this the first of those did not exist and the third returned silently when
  the id was not a party sheet.
- **Who reads it.** `npcProfileOf` lays it over the book's numbers for every settlement, and
  `present[].state` / `look focus=npc` put it in front of the Keeper. The projection was the end
  that had never existed at all.
- **Who acts on it.** The Keeper: the capsule sentence names the call, `table.resolve` settles it on
  the right body, and the `delta` and `condition` receipts are what say it happened. A Keeper who
  does nothing is still a Keeper who does nothing — §42.5's open gap BUG-076 is not closed by this
  section — but the state is now visible, the exit is named where it is read, and the settlement no
  longer reports a patient it did not treat.

Tests: `tests/extension/rescue-reaches-the-rules.test.mjs`, on the product kernel's own handlers.
Five cases, each killed by reverting one part of the change: the archetype refusal names its field;
harm to an NPC mints `delta` and `condition` receipts about him and moves `npc_resources` while the
investigator is untouched; the capsule gains `state.incapacitated` only once he is down; First Aid
with him as `target` moves his hit points and not the rescuer's; and First Aid with an investigator
as `target` still moves hers and not the NPC rescuer's.

## 67. A refusal the host issued is still a refusal (2026-09-16)

Real table, during character creation on the deployed build. The turn had never
opened — telemetry says `turn: 0`, state `awaiting_player` — and the Keeper kept
calling `resolve`:

```json
{"turn":0,"tool":"resolve","ok":false,"code":"turn_state",
 "reason":"the turn state is awaiting_player, so nothing may change state:
           wait for the player to speak, or use only look, lookup and recall"}
```

Twenty-three of those, one every three seconds. Fifteen minutes for a one-line
question, with frames flowing the whole time — nothing was stalled, nothing was
dropped, the stop button was there. The Keeper was simply told to wait for the
player while it was inside its own run, where waiting is not something it can do,
so it tried again forever.

§34.12's refusal budget was supposed to stop this at three: three strikes per
class, counted by class rather than by parameters, precisely so a reworded retry
still counts. It did not fire, and the reason is a seam.

### 67.1 The budget could not see half the refusals

The budget is scored in the tool-result handler, and only for results carrying
`details.coc_error` — that is, refusals the **kernel** produced. The host's own
pre-tool gate does not call the kernel at all; it returns `{ block: true, reason }`
from `pi.on("tool_call")`. Every refusal it issues was therefore free: `turn_state`,
`adaptation_failed`, `adaptation_stale`, `reading_wait`. A Keeper could be refused
by the host without limit.

This is the §31 shape once more. The rule ("three strikes per class, the host
enforces it") had a writer and a reader that did not meet: the host wrote
refusals down one path and the budget read them from another.

### 67.2 The contract

**Whoever refuses, it counts.** The class scoring is now one function,
`strikeRefusalClass`, used by both paths: the kernel-error path as before, and
the host's own `turn_state` block, whose class is `resolve\0turn_state\0<state>`.
On the third strike the tool is shut for the turn and the block carries the
closing instruction — *nothing refused has happened; close the turn with narrate,
or hand the player the choice with ask* — instead of repeating the same refusal a
twenty-third time. `narrate` and `ask` are never shut, because they are how a turn
ends.

The batching exemption is unchanged and still right: calls written in one message
take one strike between them, because the Keeper had not seen any answer when it
wrote them.

Test in `tests/extension/gates.test.mjs`: with the opening still unread, four
`resolve` attempts in four separate messages; none reaches the kernel, the third
answers with the exhausted-class instruction, one `class_limit` row is recorded,
and `narrate` still closes the opening. It fails if the host's block stops
scoring itself.

## 68. A session's model is the session's, and one open question (2026-09-16)

Seen in acceptance play on the deployed build. A turn ended with
`Provider stopped with: MALFORMED_FUNCTION_CALL` — a provider failure, surfaced
plainly with a dismiss control, which is the right behaviour. What was not right
is what the composer read afterwards: **`✦ Unknown` / thinking `auto`**, where a
moment earlier it had read `DeepSeek V4.1 Flash` / `low`. The person's own
setting had been replaced by a value nobody chose. This is §62's shape on the
host side.

### 68.1 Where the placeholder lives

`PiHostBackend` seeds its own `modelState`:

```ts
private modelState: ModelState = {
  model: { provider: "unknown", id: "unknown", name: "Unknown", reasoning: false },
  thinkingLevel: "off",
  availableThinkingLevels: [],
};
```

`availableThinkingLevels: []` is why the chip said `auto` — with no levels the
chip reports that the model decides. Two paths can hand that object back as an
answer about a *session*:

1. `getModelState`'s live branch ended `?? this.modelState`, while the cold path
   below it prefers `desiredModelFor(session)` — the session's own model.
2. `desiredModelFor` itself returns `base` (that same object) when the session
   has no model recorded.

### 68.2 What changed, and what did not

The live branch now falls back to `desiredModelFor(meta)` like the cold one: a
live session answers with its own model or with what it asked for, never with the
host's placeholder. That closes path 1.

**This change is not covered by a test that fails without it**, and that is worth
saying rather than hiding. Reaching the fallback requires a live session whose
model state is absent, and in every harness arrangement tried — including a real
`sendPrompt` against the fake pi — `ensure()` populates `sessionModelStates`
first, so the `??` is never taken. The change is kept because preferring the
session's own model over a global "unknown" is correct independently of the bug;
it is not claimed as the verified fix.

Path 2 remains **open**, and is the likelier one: `this.modelState` is only a
placeholder until the model catalog loads. If a catalog load fails — plausible
right after a provider error — every session would answer `Unknown` / `off` /
no levels, which is exactly what was seen. The mechanism was not reproduced, so
it is not guessed at further here. Anyone picking this up should start by
failing `loadModelCatalog` and reading `getModelState` for a session that has a
model recorded, rather than trusting this paragraph.

## 69. A turn that settled and was never told reaches the next capsule (2026-09-16, extends §38 and §50)

§38 gave an undelivered turn an honest ending and §50 gave the player its mechanics card. Both stop at
the state surface. The Keeper's next run reads neither, and that is where the cost actually falls.

**Retained live evidence** (`playtest-evidence/pipicoc-20260914`, home `t4`, campaign
`game-1c0faba5`, turns 81–83, 2026-09-16). The player searched a burned chapel wall carefully —
scraping the paint edge to prove it was applied after the fire, copying the emblem without correcting
its asymmetry, then circling the standing wall for the same paint elsewhere, for signs anyone had
camped there, and for anything the priest left. Six receipts settled:

```
roll:spot-hidden-t81-c3        Spot Hidden 8/50, level "extreme", passed
clue:chapel-eye-symbol-t81     + handout:the-haunting-handout-9-chapel-symbol-t81
time:t81-c2                    20 minutes, clock 3152 -> 3172
definition:document-t81-c2 / -c5   the notebook she drew it into, twice
```

The continuity review returned `revise`, the bounded Keeper repair did not resolve it, and the turn
was released `closed_by: "stranded"`, `text: null`, `rendered_text: null`.

**Turn 82 then contradicted the receipts.** Its prose said those observations were *still not written
down* — "the page beside the drawing is still empty" — and the campaign's own verifier lane caught it
(`player_agency`, quoting that sentence) without blocking it. The player, reading that the page was
blank, went back and searched the same wall again on turn 83, and the clock billed a second time for
one act. **Nothing was lost from the state surface; the fiction came out denying it.** That is worse
than a missing paragraph: the contradiction propagates, and every downstream consumer still reads the
receipts as true.

### 69.1 Why the Keeper wrote it that way

The capsule for turn 82 said nothing about turn 81 and, in two places, said the opposite:

- `recent` carried turn 81 with the player's whole sentence and `keeper: ""`. An empty Keeper line is
  indistinguishable from a turn where nothing happened. The `closed`/`receipts` fields `recent` rows
  already carry (§34.5) come from `closed_how`, which a stranded record leaves `null`.
- `known.clues_here` carried `chapel-eye-symbol` with `discovered: true`, because `apply clue` had
  landed. From the capsule, a discovered clue is a delivered clue; there was no third state.

This is the §31 shape once more, and specifically the mirror of §51.4. There the prose gave a finding
the books never got (`unrecorded`). Here the books got receipts the prose never gave.

### 69.2 `capsule.untold`

The capsule gains one section, `untold`: one row per earlier turn recorded `closed_by: "stranded"`
that settled at least one projectable receipt and has not yet been followed by a delivered turn.

```
untold: [{turn: 81, receipts: [ ...mechanics rows... ], line: "turn 81 settled these and the player
         was never told; say what they found, and do not write as though it did not happen"}]
```

- **The rows are the kernel's own projection.** `receipts` is `mechanicsOf` (§16.2) over the record's
  receipts — the same projection a delivered turn's card uses. Nothing here reads a receipt for
  meaning, matches on words, or writes prose; a receipt kind that projects to no card contributes no
  row, exactly as it contributes none to a delivery.
- **A turn that settled nothing projectable gets no row.** A row with no finding behind it would be a
  nag, and §31's boundary on the offer ledger applies: the capsule counts, it does not press.
- **It clears itself, and no writer has to retract it.** A delivered turn (`closed_by: "narrate"`)
  after the stranded one discharges every row before it, because by then the Keeper has written once
  with the findings in hand. A run of stranded turns accumulates until that delivery, in play order.
- **It is not licence to invent.** The receipts are facts the kernel minted and the ledger already
  counts. The Keeper says what landed, in its own prose, in the play language — no receipt text is
  handed to the player and the stranded record is never backfilled (§38.2 keeps it inert).

`HEAD` names the section beside `unrecorded`, and `SLICE2_BUDGETS.untold` is 1024 bytes.

### 69.3 The three ends (§31)

- **Writes it:** the kernel, when `table.player_input(release: "stranded")` writes the record with its
  receipts (§38.2). No new writer and no new state.
- **Reads it:** `untoldReceipts` in `kernel-ts/read/assemble.ts`, which until now had no reader at all
  for `closed_by: "stranded"` — the release wrote a record nothing downstream ever opened again.
- **Acts on it:** the Keeper, in the next turn's prose, and the same delivery retracts the row.

### 69.4 What is deliberately not here

- **The review is not relaxed.** Nothing narrates on the Keeper's behalf, nothing treats a verdict as
  a pass, and an unavailable review still authorizes nothing (§32).
- **The stranded record is not rewritten.** There is no path that backfills `text` on a
  `closed_by: "stranded"` record, and §38.2's inertness is the reason. What the player gets back is
  the content, on the next turn, not that turn's paragraph.
- **The stranded turn's own paragraph is not recovered.** What the player gets back is the content,
  on the next turn, not that turn's prose. The two are different promises, and the notice now makes
  the smaller, true one.

### 69.4a The notice stops promising a rewrite, and a caption change is two-legged

`review_verdict_notice` ended "send anything and the Keeper writes this turn again". Nothing rewrites
a stranded turn and nothing ever will: §38.2's record is inert by design. With `untold` the true
sentence is available for the first time — what settled is kept *and still counts*, and the Keeper
picks up from what happened there — so the notice now says that instead.

**A caption correction in this repo is two legs, and shipping one of them is worse than shipping
neither.** `runtime/ui-words.ts` answers from a *complete* shipped `content/ui/<tag>/` seed **before**
it looks at the home cache, and a seed carries **no digest**. The home cache is digest-guarded and so
re-projects when an authored caption changes; the seed is not, and simply keeps answering. Editing
`content/ui/en/<surface>.json` alone therefore leaves every player on a seeded tag reading the old
sentence for the life of the build, and `tests/extension/ui-words.test.mjs` stays green throughout,
because it pins each seed to the authored **key set** and never to a value.

Adding a key is the case the lane already handles: the seed goes incomplete, `resolveUiWords` drops to
`projected: false` and the lane runs. **Changing a value is the case it cannot see** — the key set is
unchanged, the seed is still complete, and the lane is never started. So the value leg is run by
opening the gap deliberately: drop that one key from the seed, run the presentation lane
(`onboarding-worker presentation` with `ui: true`), and harvest **only** that key back. The lane
re-asks every authored caption and returns its own wording for all of them; taking more than the one
changed key would silently reword the whole interface with nothing reviewing it. Hand-writing the
translation is forbidden outright (§23).

### 69.5 Open, found while reading this turn

- **A clue's `summary` has no player-side surface, and it is in the system language.**
  `clue:chapel-eye-symbol-t81` carries `"A freshly painted white emblem on the ruined wall forms a
  staring eye from three Y-shapes…"` — authored English, correct per §23 for a system-language field.
  The clue *label* is projected and the summary is not rendered anywhere the player can read, so the
  whole of what an extreme success bought reaches the player as one label and one figure on a card.
  Whether the summary should travel the presentation leg (§23) is not settled here.
- **Terminology across the `extension` surface's seed is not uniform.** The seed already carried two
  renderings of "continuity review" before this change and the lane's fresh answer is a third. Only
  the one changed key was harvested, deliberately, so the drift is recorded rather than hand-edited;
  settling the vocabulary is a lane run over the whole surface with someone reviewing it.

### 69.6 Acceptance

1. A turn released `release: "stranded"` after settling a check and a clue appears in the next
   capsule's `untold`, one row, naming that turn, carrying both receipt ids as `receipt` on its
   projected rows.
2. In that same capsule `known.clues_here` still reports the clue `discovered: true` and `recent`
   still reports `keeper: ""` — the two readings that produced the contradiction — so the row is what
   distinguishes them.
3. A delivered turn after it empties `untold`, with no call retracting anything.
4. Two stranded turns in a row both stay, in play order; a stranded turn that settled nothing adds no
   row.

Tests: `tests/extension/untold-turn-receipts.test.mjs`, against the real kernel over RPC, gating the
undelivered turn with `release: "stranded"` rather than by racing a delivery. Each test fails when the
`untold` wiring is reverted; the discharge test fails on its own when the self-clearing predicate is.

## 70. A turn that never opened also has to end (2026-09-16)

§67 made the host's own refusals count, and in the next real game the Keeper was
told: its reasoning names the budget — *"the kernel refused my resolve attempts
(8 refusals)"*, *"the '8 refusals this turn' message appeared"* — and it changed
plan instead of silently resending a twenty-third time. That part worked.

What it then did was keep calling anyway. Each call was blocked cheaply, so the
refusals stayed bounded; the **turn** did not. Five minutes of blocked
`resolve`/`apply` pairs on a table that could not move, with a player waiting.

### 70.1 The cut only knew about closed turns

§34.16 already has the escalation this needs: three blocked calls get a firmer
answer, the sixth aborts the run. It is gated on `state.closedThisRun` — a turn
that was closed with narrate and then kept being called. Here the turn had never
*opened* (`turn: 0`, `awaiting_player`), so nothing incremented and nothing cut.
Same runaway, the other end of the turn, no coverage.

### 70.2 The contract

**Whichever way a turn is unable to proceed, it ends.** A call blocked because
the refusal budget is spent now escalates exactly like one blocked after a
close: `blockedAfterExhausted` counts them, the third carries *call no further
tool and write nothing more* on top of the budget's own closing instruction, and
the sixth sets `runCut` and aborts the run. The counter resets with the others
at turn boundaries, and its telemetry says `after: "refusal_budget"` so a
runaway before the turn opened can be told from one after it closed.

The budget's message is unchanged and still says how to finish properly — close
with narrate, or hand the player the choice with ask. The cut is what happens
when that is ignored, not a replacement for it.

Test in `tests/extension/gates.test.mjs`: fourteen scripted `resolve` attempts
with the opening unread; the class budget trips, a later block carries the
harder line, one `runaway` row with `after: "refusal_budget"` is recorded, and
the run stops before the fourteenth. It fails if the block stops counting.

## 71. A resend is not a second turn (2026-09-16)

Real table, `playtest-evidence/pipicoc-20260914`, home `t4`, campaign
`game-1c0faba5`. The player reloaded the page while the Keeper was generating,
concluded from the blank screen that the turn had died with it, and pressed the
resend button on his own message bubble. The turn had not died:

```
turn 75   510 chars   4 receipts   correct
turn 76   193 chars   1 receipt    apply t76-c1 action_not_authorized
```

`turns/0075.json` and `turns/0076.json` carry the same `player_text`, byte for
byte. Turn 75 closed at 18:44:31; turn 76's `table.player_input` was issued at
18:44:39 and opened at 18:44:51 — the resend had been held in `waitingInputs`
while turn 75 ran, and replayed at `agent_settled` as an ordinary next turn.

Nowhere did the product say the word duplicate. Not on screen, not in
`turn.json`, not in telemetry. Three things followed from that silence:

1. The player got a thin turn with no explanation and read it as himself
   stuttering.
2. A turn of clock and of budget was spent on it.
3. The verifier reported the resulting prose as `player_agency` — *"她把同样的话
   再说一遍"* — because it judges whether the prose chose for the player, and
   nothing it can see says the player sent those words twice.

The engine's half was right throughout. `action_not_authorized` on `t76-c1` is
the rules engine correctly declining to file the same complaint a second time.
The defect is that the fact was invisible to the player and to the lane.

### 71.1 The host owns it, because only the host can see it

The question "is this the same message as the one being worked on" is answered
where the message arrives while the run is in flight: `pi.on("input")` in the
kernel extension, which already fires only when the session is not idle. At that
moment the host holds the turn's own `playerText` and its state, so the test is
three mechanical facts and no reading of meaning:

- the arriving `text` is **exactly equal** to `state.playerText`,
- the turn carrying those words is still `open` or `acting`,
- the arrival carries no images (the button sends text alone).

**Exact equality, and nothing looser, ever.** No similarity, no normalisation,
no prefix. A resend is the same bytes because the button sends the same bytes;
anything wider would be a heuristic standing in for a judgement about what the
player meant, which is the one thing §「语义问题不许硬编码」forbids.

The frontend is not the place for it. `resendDisabled` in `Electron/packages/ui/
src/App.tsx` is `!canWriteLease || streaming || sessionQueue.busy`, and
`streaming` is renderer state that a reload sets back to `false` — which is
exactly how the retained table got here. Even a renderer that recovered it
perfectly would still be racing the run's end, and a second client (remote web
is its own deploy) would not be in the race at all. A frontend gate is a
courtesy; the host is the authority.

### 71.2 Held, never dropped, and never silent

The player pressed that button for a reason: he believed the turn was dead. So
the resend is neither run nor discarded. It is **held under its own name**, and
the turn it duplicated decides what it was:

- **the turn delivers** → the resend is spent (`resend_folded`). Those words
  were answered; running them again buys prose about repeating oneself.
- **the turn settles with nothing delivered** → §38 strands it, and the held
  resend is exactly the retry the player meant. It is sent, carrying §38's
  `release: "stranded"` (`resend_released`).

Either way the player is told **at once**, not at the end: a `coc-delivery`
notice with `details.resend_held`, from the `resend_held_notice` caption, on the
channel the other service notices use — because he is looking at the screen he
just pressed a button on. Once per turn, not once per click.

### 71.3 The three ends (§31)

- **Who writes it.** `pi.on("input")` in `extensions/kernel/index.ts`, on the
  arrival, from `state.playerText` and `state.state`.
- **Who reads it.** The player, in the notice, while the turn is still running;
  and `agent_settled`, which decides between folding and releasing.
- **Who acts on it.** Telemetry rows `lane: "turn"`, `event: resend_held` then
  `resend_folded` | `resend_released`, on the turn that paid for it.

### 71.4 What this does not do: the verifier still cannot see a resend

`buildVerifierInput` (`extensions/kernel/verifier.ts`) hands the lane the
delivered prose and three fact lists. **It does not include the player's declared
text at all.** So a `player_agency` judgement — "the prose makes a voluntary
choice the player did not declare" — is made without the declaration in front of
it, and marking a turn as a resend would reach a reader that does not exist.
Consequence 3 above is repaired here only because the second turn no longer
happens. The lane's blind spot is real and is not this section's; it is the same
collision `docs/specs/turn-floor.md` records between the verifier's
`player_agency` and the floor's uptake requirement.

### 71.5 Still open: a client that drops mid-generation says nothing

Same table, same cause. When the client goes away during generation the turn
stays `state: "open"` with the input already stored, the host keeps running, and
the player side shows nothing at all — no "still working", no recovery line. The
only way back in is the resend button, and that button lives in
`.message-action-bar`, which is `opacity: 0; pointer-events: none` until the row
is hovered or focused (`Electron/packages/ui/src/message-actions.css`). A player
who does not hover has no visible way to do anything, and a player who does hover
presses the one control he can find. **This is very likely the same root**: the
resend was a rational response to a screen that had stopped telling him anything.
Not repaired here — recorded so the decision is made rather than inherited.

### 71.6 Tests

`tests/extension/resend-is-not-a-second-turn.test.mjs`, three cases driving the
real path (a prompt, then a second message while the Keeper streams, with the
delivery gated so the window is not a race): the identical resend opens no second
turn and is announced to the player; a resend held by a turn that then delivers
nothing is sent as that turn's `release: "stranded"` retry; and a message one
character different is an ordinary queued turn with nothing held. Each case dies
to a different mutation — disabling the fold, loosening equality to a prefix,
always folding, and holding silently.

## 72. The card has to reach the table (2026-09-17)

Acceptance play, PDF module. Character creation talked fine, the Keeper wrote
the whole sheet out as prose — and then stopped, saying it could not press
confirm until the card was displayed. There was no card on screen and no control
to press. The right panel still read 「还没有调查员」. The game could not continue.

The Keeper was telling the truth. `setup.confirm` refuses while
`previewed_revision` does not match the draft (`kernel-ts/setup/drafts.ts:194`,
`code: "needs"`, *Wait until the current complete card is displayed before
confirmation*), and that field is set only by `setup.previewed` — which is
called when the **rendered card acknowledges itself**.

Two sessions on the same build, same machine:

```
built-in scenario   coc-character-draft ×1 → setup.confirm ×2 → setup.complete ×2 → handoff
PDF module          coc-character-draft ×2 → setup.confirm ×8 → nothing
                    setup.previewed: 0 in both (the ack is an extension call, not a kernel one)
```

Both payloads were 11.9 KB with `completeness: {valid: true, issues: []}`. The
content was never the problem. The projection was.

### 72.1 A swallowed failure with a comment that assumed its own rescue

```ts
void (async () => {
  …
  await host.presentation({campaign, revision, …});
})().catch(() => undefined /* the card still asks for itself if this never lands */);
```

`host.presentation` generates through a model. The PDF session was the one where
the provider had already returned `MALFORMED_FUNCTION_CALL` once. When this
threw, the catch discarded it, and the comment's rescue does not exist: **a card
can only ask for itself once it has rendered, and it cannot render until this
lands.** So the table waited, the Keeper re-drafted, `setup.confirm` was refused
eight times, and nobody anywhere was told why.

### 72.2 The retry has to be inside the job, not beside the caller

The first fix for this was a retry loop around the call, and it retried nothing.

`presentation()` and `presentationStatus()` are the same job
(`coc-onboarding.ts`, `presentationJob`), keyed by campaign, revision, language
and lane flags, so that the host's eager start and the card's poll do not run the
model twice. A job that **fails** is kept in that map on purpose:
`presentationStatus` is a one-shot mailbox — it hands the error to the card once,
deletes the key, and the card draws that error with a ↻ the player can press.

So a caller that retried by calling `presentation()` again got the job it had
already failed, re-awaited the same settled rejection, and reported four attempts
having run the model once. Measured: three calls, one `run`.

There is a second reason it belongs inside. The mailbox is read by a poll that
runs every 1500ms. A retry outside the job cannot stop that poll from reading a
failure the retry is about to make untrue — the player would see the error, and
the retry would land its result into a job nobody is watching any more.

### 72.3 The contract

**A projection a player is waiting on retries inside its own job, under one
deadline for the whole job.** `runPresentation` attempts it, and on failure waits
800ms, 2.4s, 6s before each further attempt; the job stays unsettled while
attempts remain, so `presentationStatus` goes on answering `{pending: true}` and
the card goes on drawing its spinner. Only a *final* failure reaches the mailbox.

**One deadline covers the retries.** `PRESENTATION_DEADLINE_MS` is 6 minutes.
An attempt that burned the whole deadline has already made the player wait, and
giving the next attempt a fresh six minutes would only make the wait longer, so
a retry is skipped once the remaining budget cannot hold its own backoff. The
worst case the player sees is what it always was.

**The pre-warm only reports.** `startDraftPresentation` exists so the model
begins before the card mounts. It awaits and warns with the revision and reason;
it decides nothing, because the player's copy of the same failure arrives through
`presentationStatus`, as the error the card draws its retry under. That closes
what 72.2's first draft left open: a persistent failure now reaches the table as
a control, not as a Keeper repeating that it cannot confirm.

Tests (`coc-onboarding.test.ts`): a job whose first two attempts fail still lands,
`run` is called three times, and the poll answers `{pending: true}` throughout — it
fails when the retry is collapsed to one attempt. A job that fails every attempt
calls `run` four times, hands the failure to the poll exactly once, and leaves the
next poll starting a fresh job, which is what the card's ↻ rides on.

**Not covered by a test, deliberately:** `startDraftPresentation`'s three-line
pre-warm. Its failure path is a `console.warn`; the behaviour that matters to the
player is the mailbox, and that is tested above.

## 73. An internal error is not a review, and a declared strand closes itself (2026-09-17, corrects §37.9 and §38.2)

Retained live evidence: H-SIDE t4 `game-1c0faba5-5a90-4eff-ade3-0d62632b4e7a`, turn 86, 2026-09-17.
Six `narrate` attempts, ~215 s, nothing delivered, and then 43 minutes in which the table could not be
spoken to at all. Three separate things were wrong, and only one of them is the outage.

### 73.1 What `code: "internal"` was

It was the truth. The host's kernel RPC client gives a call 30 s and then fails it, and the UI session
carries the message verbatim on four of the five: `kernel mods.job did not answer within 30000 ms`. No
`details.reason`, which is why the telemetry rows carry a bare `code` and nothing else.

The kernel was not broken by anything the product did. It finished each of those jobs *after* the host had
given up — four job directories under `.coc/mods/jobs/` were written at 20:16:55, 20:17:37, 20:18:32 and
20:20:18 local, each after its caller had already been failed — and the attempts got slower as the
abandoned work piled up (36.3 s, 38.0 s, 38.1 s, 48.8 s, 53.8 s). The same shape appeared on a second table
and on unrelated agents in the same window, so the first cause is upstream, not in this repository. It is
recorded here because it is the condition the two rules below have to survive, not because it is a defect
this section fixes. **A failure faithfully reported is not swallowed, downgraded or retried away.**

### 73.2 The review allowance measures the reviewer

`AUDIT_LIMITS.time_ms` is "active review time" (§35.14) and is sized for the reviews `max_rewrites`
permits (§37.9). `AuditBudget.start()` nevertheless charged `Date.now()` since the `mods.job` call was
issued — the host's own wait — to that shared total before reserving anything.

So the five failures did not each buy a review; none of them ever constructed a budget. What they did was
leave the kernel congested, and the sixth `mods.job` took ~55 s to answer. That wait was booked as review
time. The reviewer then ran 22.4 s inside its reservation, submitted, and `mods.accept` bound its report —
and the retained scope (`jobs/d1198add…/review-budget.json`) reads `ms: 81539` against `time_ms: 80000`,
`requests: 1`, `reviewed_jobs: {}`, `blocked: "The shared review allowance is exhausted"`. The job
directory `jobs/8d9d575b…/` holds the `accepted.json` that nobody received. The identical review, rerun
35 minutes later, returned `verdict: pass`.

- **Preparation is not charged.** `start()` takes no preparation figure. A kernel that will not answer is a
  failure, not a verdict, and it may not spend the reviewer's allowance. The wait remains visible where it
  belongs: the `lane: "continuity-review"` row's `ms` beside its `child_ms`.
- **An allowance bounds what may be started, not what has already been produced.** `finish()` threw its
  exhaustion one line after `mods.accept` had bound the report and one line before `verdict()` could record
  it, which is why an exhausted block sits beside an empty `reviewed_jobs`. It now latches: `blocked` is
  written with `blocked_service: false`, the constructor refuses the *next* review of the same input, and
  the review that already finished keeps the verdict it earned.
- **The request overrun still throws.** A private session that spent more model calls than it reserved
  broke the bound it was handed, and its report is not trusted. That is a different fact from the shared
  allowance running out while the books were being closed.

### 73.3 A declared strand is completed, not promised

§38.3 gives the declaration to the host and §38.2 put the close inside `table.player_input`, so the
declaration lived in one process's memory and nothing on disk recorded it. On turn 86 the host wrote its
§50 card at 00:21:50 (`delivery … settled_without_delivery rows:2`) and `turns/0086.json` was written at
00:56:18 — the moment the player typed again. `turn.json` read `{"turn":86,"state":"acting"}` for 43
minutes, so every ordinary `table.player_input` was refused; a server restart changed nothing, because the
mark was never on disk to survive it. This is not particular to turn 86: every stranded turn on that table
(8, 14, 38, 72, 81) has a `closed_at` equal to the next player input's timestamp. The others looked fine
only because that player happened to speak within five minutes.

Nothing about the *writing* was broken. Once released, the record landed with `closed_by: "stranded"` and
all four receipts intact. The missing piece was the trigger.

**`table.release` is that trigger.** It takes `{campaign, release: "stranded"}`, accepts only `open` and
`acting` (anything else is `invalid_params`, exactly as §38.2's parameter does), writes the same stranded
record and `turn-stranded` event through the same writer, and leaves the table `awaiting_player` on turn
n+1 — where a delivered turn also leaves it. It narrates nothing, commits nothing and judges nothing.

The host calls it at `agent_settled`, after §50's card has been issued and only when no player input is
waiting to be sent; an input that is already queued closes the turn on its own way through, as before.

**§38.2's input-carried release stays, and is not a leftover.** The condition that strands most turns is a
kernel that will not answer, which is precisely when `table.release` cannot land either — on turn 86 the
same kernel was refusing `mods.job`, `table.capsule` and `table.player_input` within the same window. So
the mark is cleared only when the kernel confirms, and until then the next `table.player_input` carries it
exactly as §38 describes. The completion barrier §38.3 puts in front of the watchdog marker applies to both
roads: the marker must name this kernel turn durably before either may close it.

### 73.4 The three ends (§31)

- **Writer:** the host, at `agent_settled`, from the same §38.3 predicate as before; the kernel writes the
  record, the `turn-stranded` event and the `lane: "turn", event: "stranded"` telemetry row.
- **Reader:** `turn.json` — the cursor the next `table.player_input` meets — and every delivery consumer
  through `closed_by === "narrate"`, which a stranded record still deliberately fails.
- **Actor:** the player, who finds a table that will take an utterance, without having had to spend one to
  make it so; and the operator, for whom `lane: "turn", event: "released"` says whether the close landed.

### 73.5 What is deliberately not here

No retry loop and no larger allowance. Both of the rules above hold whatever the first failure was, and
neither turns five failures into ten. Why the kernel stopped answering `mods.job` for five consecutive
calls on a turn-86-sized campaign is a separate question and is still open; §73.1 records what is known
about it rather than guessing.

### 73.6 Tests

- `tests/extension/continuity-audit.test.mjs` — a stalled preparation is not charged to the reviewer and
  the verdict it delayed still lands; a review that finished inside its reservation keeps its verdict when
  the shared allowance runs out; the §38 test that asserted the release rides the next input now asserts it
  does not.
- `tests/extension/stranded-turn-closes-itself.test.mjs` — on the real kernel, a run that settles with
  nothing delivered leaves `turns/0001.json` written and `turn.json` `awaiting_player` with no further
  player input; and a release the kernel refuses leaves the mark for §38's road.

## 74. An unsourced number is removed, not re-cited (2026-09-17)

Acceptance play, PDF module. `Masks of Nyarlathotep`, 669 pages, DeepSeek V4.1
Flash / low. Character-creation background preparation ran for 25 minutes and
stopped with 「暂时无法完成准备」. The player's only offered recovery, 继续准备,
inherited the same draft and failed the same way.

```
review.json   7 units checked, missing: []
              6 supported
              1 unsupported  /nodes/2/properties/age
                             "Age 32 is not stated on the cited pages 64-66
                              (or 53); no source support found.
                              Minor NPC statistic, deferred for character creation."
draft.json    npc-augustus-larkin  age: 32      (still there after the repair round)
```

Nothing was missing. The whole book was prepared except for one number the
reader invented for a minor NPC, and that number made the book unplayable
forever.

### 74.1 Three ends, none of which says the word

`checkDraft` puts **every numeric properties field** on `required_review`
(`numericPaths`, `kernel-ts/modules/visual.ts`), and `checkReview` rejects the
whole submission on any verdict other than `supported`. That rule is right: a
number the book does not print is a fabrication, and relaxing it would turn a
visible stall into a silent invention.

But the remedy was never stated to the one participant who could perform it.

| end | what it said |
| --- | --- |
| reviewer | `verdict: "unsupported"` — *no source support found* |
| kernel | `fix: correct the draft using the original pages and submit again` |
| reader (round 2, with `findings.json` naming the exact pointer) | re-cited pages 64–66 and resubmitted `age: 32` |

The kernel's `fix` is the ambiguous kind this contract has been bitten by before:
*correct using the original pages* reads as *cite better*, and citing cannot help
a value that is not on any page. The one repair that works — delete the field —
appears nowhere in the reviewer's vocabulary, the kernel's fix, or the reader's
instructions. So the repair round re-ran, failed identically, and the retry the
player is offered inherits the same draft and fails a third time.

### 74.2 The contract

**A numeric field the review could not support is told its two repairs, and only
a numeric field is.** When a publication is rejected and the review left units
unsupported, `findings.json` gains a `repairs` array. For each unsupported
pointer that resolves to a number in the draft, it carries one line: view a page
that prints this exact value and cite it, or delete the field — and that
re-citing pages which do not print it fails the same way.

**Prose gets no such line, deliberately.** A summary or a voice note the review
could not confirm is usually repairable by reading the right page. Telling the
reader to delete it would trade a visible stall for a silent omission, which is
the failure this rule exists to prevent.

**The rule is also stated where the reader reads it.** `visual-reader.md`'s repair
paragraph now says that a number has these two repairs and no third, that
deleting an unsourced number is correct rather than a loss because the field
stops being reviewed once it is gone, and that a value printed on the page is to
be found, never deleted.

Changing `visual-reader.md` changes `reviewVersion`, so cached reviews written
under the old instruction are not reused. That is intended.

Tests (`tests/extension/reading-service.test.mjs`): a guidance job whose review
marks one numeric pointer unsupported and one node unit unclear writes both into
`findings.unsupported`, and writes exactly one `repairs` line, for the number.
It dies when the numeric gate is removed (the node unit gets a delete-or-cite
line it must not get) and when `repairs` is not written at all.

## 75. A preparation that landed is told, not withheld (2026-09-17, amends §47)

§47 gave the host a service notice for the turn a preparation owns, and a re-read so that it is only
said while it is still true. The re-read asks one question — *is this still running?* — and the notice
is withheld on **no**. But **no** has two meanings, and only one of them is silence: the work can be
**gone** (`accepted`, `cancelled`, `failed`, `stale`, `none`, or a kernel that will not answer), or it
can have **landed** — built, reviewed, `ready`, and waiting only for the table's `apply`. Collapsing
them means the player is told nothing in exactly the case where the product has the most to say.

**Retained evidence, `homes/t4` (`game-1c0faba5`), 94 turns.** Four turns — 66, 73, 93, 95 — each
declared a new destination, each prepared an adaptation, each had the next verb refused with
`reason: "preparation_wait"`, and each closed with `receipts: []`. All four §47 decisions read
`preparation_wait_notice_withheld`. Turn 93 is the clock: `apply` blocked 02:15:11.188 at `pending`,
`narrate` 02:15:36.296, the re-read 02:15:40.018 — the job had reached `ready` in those four seconds,
so the notice was dropped; the next player input did not arrive until 02:16:16.023, thirty-six
seconds after the host knew the answer. The player had said he would be at the elders' side door at
nine. The prose he got stops at the lamp going out, with no receipt, no notice, and no morning; turn
94 is him saying the same thing over again. Turn 66 is the same shape with a worse ending: the player
waited a turn for the juvenile court, opened turn 67 with "then I won't wait", and the proposal
—`萨福克少年法庭`, the only `stale` job in that home's store — was never accepted. Zero-receipt
delivered turns on that table: 11 of 94.

**The change.** The §47 re-read answers three ways instead of two, and the third one speaks.

- `waiting` — `pending` or `reviewing`, or a source reading the bridge still reports in flight. The
  §47 notice, unchanged: `adaptation_wait_notice` / `source_wait_notice`, telemetry
  `reason: "preparation_wait_notice"`.
- `landed` — an adaptation whose status is `ready`. One authored caption of its own,
  `adaptation_ready_notice`, on the same `coc-delivery` channel, with
  `details.preparation_wait.landed = true` and telemetry `reason: "preparation_ready_notice"`. It says
  the place is ready and that the next turn can reach it. §47's rule is kept and narrowed to the
  sentence: a finished job is still never described to the player as running.
- `null` — gone. Withheld exactly as before, with the `preparation_wait_notice_withheld` row.

A source reading has no `landed`: it has no status verb and nothing to accept, so it keeps two states.

**Why the turn itself cannot be saved, and therefore must be legible.** The empty turn is not a
policy. `prepare` pins the job to `digest({world, party, line})` plus the source digest and
generation, and `fresh()` compares that pin on every later read; any receipt that moves the world —
`time`, `move`, `npc` — stales the job the same turn that created it. The gate that blocks every verb
but `narrate` and the adaptation controls is protecting the work it just started, and acceptance is
therefore always the *first* effect of the following turn (turn 94: `apply adaptation` as `t94-c1`,
`apply time/move/npc` as `t94-c2`). §36.15's bounded 12-second foreground wait is the other half; the
four jobs on this table took roughly fifty to seventy seconds. Widening that bound is a latency
ruling §36.15 already made deliberately and is not reopened here. What is owed, while the extra turn
stands, is that the player be told it is an extra turn and not a rejection.

**What this does not change.** `ADAPTATION_HELD` keeps `ready`: a reviewed scene is not entered
without an answer, and §47's reason for holding it is untouched. Nothing is auto-accepted, no verb is
added, no new lane or foreground model call, no second kernel read — the notice's own re-read is the
only one, and it already existed. The wait instruction, the gate, the audit's `preparation_wait`
deferral basis (§37.3) and §60's retirement of terminal jobs are all as they were.

**What was checked and found not to be the defect.** The `ready` refusal is not a compliance failure.
On all four instances the Keeper reached `lookup kind=adaptation action=status` on its very next
provider call after the block, and the status result's own `instruction` field names the accepting
call; turns 74, 94 and 96 then accepted within the same turn. Turn 67 did read the status and
declined deliberately — its recorded reasoning is that the player had by then gone elsewhere — which
is a correct decision about a destination the player had already abandoned, one turn earlier, for
want of this notice.

**Guards.** `tests/extension/host-state-not-fiction.test.mjs` — a landed preparation reaches the
player on the `coc-delivery` channel with `landed: true` and its own projected caption, on a turn
whose `apply` the wait refused; a caption that does not say "still"; and a `failed` preparation still
withheld, so "landed" cannot be reached by always speaking.

## 76. One call, one name for one place (2026-09-17, amends §32)

H-SIDE t4, campaign `game-1c0faba5`, turn 99. Two cards from **one** `call_id`
(`t99-c2`), which the player reads one above the other:

```json
{"kind":"item",  "to":  "Benefit Street office building", "to_label":  "Benefit Street office building"}
{"kind":"scene", "from":"Benefit Street office building", "from_label":"本尼菲特街左侧办公楼"}
```

Same handle. Two names. The item card handed the player the book's English for a
place the move card, minted microseconds later in the same settlement, called by
the name this table had given it.

This is the reason to fix it now rather than later. The other members of this
family — «杰克逊·伊莱亚斯» through T19–T27 against «杰克逊·埃利亚斯» at T42 and on the
sheet, «库皮蒂娜» in prose against «库皮蒂纳» on the panel — can each be read as two
eras of the product drifting apart. **This one happened inside one call**, so
drift explains nothing: two producers of a single turn read two different records
for a single entity.

### 76.1 The record that decides

`world.scene_labels[<handle>]` is what this table calls a place. §22's `move`
writes it the moment the Keeper names a scene, and `sceneLabel` is how every
Keeper-facing and player-facing surface reads it back: the capsule's `where`,
the exits, the trail, the checkpoint, the journal and quest packets, and
`move`'s own `from_label`/`to_label`.

The object transfer never asked it. `objectOwner` (`kernel-ts/mods/stage.ts`)
resolved a scene owner as `{kind, id: graph.handle(scene), name:
graph.displayName(scene)}`, and `objectTransferReceipt` stamped that `name`
straight onto the receipt as `subject_label` — which §16.2 projects as the item
card's `to_label`. The book's word, on a card, beside a card carrying the
table's. `kernel-ts/combat/execution.ts` built the same owner row inline for a
thrown object, so there were three copies of the graph lookup and none of the
world lookup.

**The junction existed; one producer did not use it.** So the fix is not a new
field, a new store or a translation step: `placeLabel(world, handle, authored)`
in `kernel-ts/read/capsule.ts` is now the single read of `world.scene_labels`,
`sceneLabel` is written in terms of it, and `ownerLabel(world, owner)` resolves
an owner's card name through it.

### 76.2 An identity is not a label, and must not become one

An owner row is an identifier. `moveObject` stores it on the instance
(`prior.owner = clone(owner)`) and a later transfer's `from` is checked against
the stored row by deep equality, and `graph.scene()` resolves the module's
authored names and aliases — never a campaign label. So the obvious fix, making
`objectOwner` answer with the table's name, is wrong twice over: every instance
already standing in that place stops matching its own owner, and renaming a place
strands everything left there.

The split is the one `move` has always drawn, now drawn in the same place for
objects:

- **`from` / `to` / `subject` / `owner.id` / `owner.name`** — the graph's handle
  and authored name. Stable, stored, resolvable, never renamed underneath.
- **`from_label` / `to_label` / `subject_label`** — the table's name, resolved at
  the moment the receipt is minted, from `world.scene_labels`.

A person is not affected: an investigator carries their sheet name and an NPC the
graph's, and there is no per-table record to prefer, so `ownerLabel` answers
`owner.name` for them and nothing renames anybody.

Deliberately unchanged: `objectLook`, `objectContext` and the `container` line in
`publicItems` still report `owner.name`. Those are the names the Keeper passes
back as `from`/`to`, and an identifier that cannot be resolved is worse than an
identifier in the wrong language.

### 76.3 What is still missing, named here so it is not mistaken for fixed

A place has one per-table record and a clue has one (`world.clue_labels`, §22).
**A person has none.** Nothing anywhere records "what this table calls Jackson
Elias in the play language", so every turn the Keeper re-invents it and the
engine layer answers `Jackson Elias` forever. That is the same shape as this
defect one level up, and this section does not close it — it only removes the
case where the record existed and a producer walked past it.

**Guards.** `tests/extension/one-call-one-name.test.mjs` — one `apply` call that
leaves an object in the current scene and moves away must produce an item card
and a scene card that name the same handle with the same word, and that word is
read back out of `world.scene_labels` rather than written into the assertion; an
object taken back off a place is taken from the table's name while a person keeps
their own; and the label never reaches the stored owner row, checked by renaming
the place between placement and pickup.

## 77. A closed turn has no doors (2026-09-17, amends §34.12 and §67)

Acceptance play, campaign `game-01250e5e`, opening turn, DeepSeek V4.1 Flash / low.
`narrate` delivered the opening and closed the turn. The Keeper then spent
**48 steps** trying to act on a turn that was over, and the player read a
sentence that stops mid-delivery.

```
narrate  ×17   turn_state: "the turn state is awaiting_player, so nothing may change state"
narrate  ×3    "the turn is closed, waiting for the player"
resolve  ×6    refusal_budget
lane "refusals": (empty)
24 失败 · 24 成功 · This operation was aborted
```

### 77.1 The exemption outlived its reason

`narrate` and `ask` are exempt from the refusal budget
(`strikeRefusalClass`, `REFUSAL_BUDGET`'s own comment: *every write but narrate
and ask*). The reason is sound — they are the two doors out of a turn, and the
budget's own closing advice points at them: *close the turn with narrate on what
landed, or hand the player the pending choice with ask.*

But the exemption was unconditional, and this turn was **already closed**. There,
narrate ends nothing: it is refused by the same gate as any other write. So the
one tool the Keeper kept reaching for was the one tool nothing counted.

Worse, the strikes were not free. `strikeRefusalClass` increments
`refusalsThisTurn` for every strike, exempt or not, so narrate's seventeen
strikes spent the turn budget — which shut `resolve`, `apply`, `look`, `lookup`
and `recall`, and left narrate open. The budget shut everything except the tool
that was causing it.

### 77.2 Why no other counter caught it

Every runaway counter in this area is reset at `agent_start`:

```ts
pi.on("agent_start", async () => {
  table.closedThisRun = false;
  table.blockedAfterClose = 0;  table.blockedAfterExhausted = 0;
});
```

§34.16's cut counts blocks after a turn closed **in this run**. §70's cut counts
blocks after the budget was spent, also per run. The turn stayed closed across
runs; the counters started again at zero in each. Three of the seventeen narrate
calls landed in the run that did the closing and were counted there; the other
fourteen were free.

The refusal classes are the only counter here kept per **turn**. That is why the
budget is the lever that holds across runs, and why the fix belongs in it.

### 77.3 The contract

**The narrate/ask exemption is an exemption for doors, so it ends when the turn
does.** `strikeRefusalClass` takes a `closed` flag. The host's closed-state gate
passes it: every strike from that block is a refusal on a turn that is not open,
by construction, so narrate and ask are struck there like any other write. The
kernel-error road does not pass it — a kernel refusal can reach narrate while the
turn is still open, and the door must stay open there.

**The global sweep never touches narrate or ask, whatever `closed` says.** A
strike can arrive from a turn whose opening is still pending — `resolve` refused
while the opening waits to be delivered — and shutting narrate there would take
away the door the sweep's own advice points at.

Once narrate is struck, the existing escalation does the rest: the third strike
exhausts it (§34.12), further calls are blocked (§70), and the sixth cuts the
run. The 48-step run becomes roughly nine.

**Not added, deliberately.** A `turn_budget` row for the host's own road was
written and then removed. The `refusals` lane was empty in the live run because
nothing ever tripped a class — narrate was exempt and `resolve` was shut by the
global sweep, which records nothing. With this fix a class trips first, and the
lane gets its `class_limit` row; the global sweep is no longer reachable on this
road, so a row for it would have had no producer. State with no reader and code
with no path are the same defect (§72).

Test (`tests/extension/gates.test.mjs`): a run whose `table.player_input` is
refused leaves the turn closed, and twelve `narrate` calls are refused; the third
exhausts the class, the `refusals` lane names `narrate`, and the run is cut
before the twelfth. It dies when the exemption is made unconditional again.
