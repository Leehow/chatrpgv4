# COC Story Director v2 — 剧情编排层进阶蓝图

**Date:** 2026-07-06
**Status:** Blueprint（v2 设计建议原文存档，待转化为正式 spec）
**Source:** GPT Pro 评审建议（基于 GitHub 远端 v1 代码）
**Scope:** v1 deterministic director 骨架之上的进阶：记忆层、运行期信号接线、结构化 clue delivery、source_refs、write_intents、safety 加强、smoke fixtures 固化。

> **本文件是 v2 建议原文存档。** 下文为评审讨论内容。v1 真相源见 `2026-07-05-story-director-design.md`，台账见 `.zralph/story-director-tasks.md`。

---

## [评审结论摘要]

v1 已经从"规则器"迈进"导演脑 v1"的正确形态。方向比上次建议更工程化：不是把剧情编排写成 prompt，而是拆成 **LLM 读模组生成剧情图 → 确定性脚本校验 → deterministic director 运行期消费 → narration contract 检查** 这条链路。

最关键的是，v1 已经明确利用 Codex 的强项：**不写硬 PDF 解析器，让 LLM 通过 grep/read/PDF read 去编译剧情图；脚本只负责结构校验**。

v1 最强的地方：
1. 没有把剧情编排做成纯 prompt（deterministic planner，可测可复现可审计）
2. 模组结构分类抓得准（7 种 structure_type）
3. 规则层和剧情层耦合方式正确（coc_rule_signals 纯函数）
4. 已发现并修掉真实导演 bug（clue_type obvious/obscured）
5. 验证链路已成型（10/10 smoke + narration contract）

## 现在还缺什么：5 个 DirectorPlan 缺口

### 1. `must_include` 始终为空，叙事锚点不足

台账已发现并推迟到 v2。建议在 clue-graph 给每条 clue 增加：

```json
{
  "clue_id": "clue-door-scratches",
  "delivery": "Spot Hidden / house entry",
  "visibility": "player-safe",
  "player_visible_anchor": "门闩边缘的新鲜划痕",
  "interpretation": "最近有人或某物从内侧操作过门",
  "do_not_say": ["科比特仍在地下室", "这是浮空匕首造成的"],
  "source_ref": { "kind": "module", "path": "scenario/clues.json", "page": 448 }
}
```

DirectorPlan 的 `narrative_directives.must_include` 由 `clue_policy.reveal/fallback_routes` 自动填充 `player_visible_anchor`。

### 2. Director 不会真正更新 pressure clocks

`_build_pressure_moves` 只返回 `pressure_moves`，没有写回 `threat-fronts.json` 或 `pacing-state.json`。需要明确的 apply 层：

```text
DirectorPlan.pressure_moves -> coc_director_apply.py -> update save/pacing-state.json + logs/events.jsonl
```

不要让 director 直接写；但要有一个脚本把 plan 中的 pressure tick、clue reveal、scene transition、memory write 转成事件和状态更新。

### 3. `pacing-map` 校验了但运行期没真正消费

`generate_director_plan` 把 `horror_escalation_stage` 静态写成 `"wrongness"`。应接入：

```python
def _current_pacing_entry(ctx):
    active_scene_id = ctx["active_scene_id"]
    for entry in ctx["pacing_map"].get("pacing_curve", []):
        if entry.get("scene_id") == active_scene_id:
            return entry
    return {}
```

然后 `"pacing_mode": entry.tension_target`、`"narrative_directives.horror_escalation_stage": entry.horror_stage`，并让 `tension_delta` 受 pacing target 影响。

### 4. `clue_policy` 只会 reveal 当前 scene 的第一个 clue

`_select_clue_policy` 是 `available[:1]`。需要 lead graph 或 clue-graph 加字段：

```json
"leads_to": ["scene-archive", "npc-arty-wilmot"],
"conclusion_id": "corbitt-linked-to-chapel",
"route_priority": 0.8,
"risk": "low|medium|high",
"requires_player_action": "ask about chapel records"
```

让 director 能：REVEAL 给最贴合玩家行动的 clue；CHOICE 给两个 lead；RECOVER 移动同一 conclusion 的 fallback clue。

### 5. `player_intent_class` 太粗

真实玩家会说复合意图。建议轻量 `coc_intent_router.py`（规则/关键词，非 LLM 分类器）：

```json
{
  "primary_intent": "investigate",
  "secondary_intents": ["avoid_risk", "social_followup"],
  "target_entities": ["back_yard", "window", "neighbor"],
  "risk_posture": "cautious",
  "requested_pace": "slow",
  "explicit_roll_request": false,
  "player_hypothesis": "屋内有东西从内部出来过"
}
```

## 记忆层：grep-native memory cards（核心建议）

**强烈建议走 grep-native memory cards，不要急着做向量库。** Codex 插件天然优势是成熟 grep/read 和文件工具链。

### 四层语义

```text
save/        = 世界当前事实，必须精确
logs/        = 发生过什么，append-only
memory/      = 未来叙事要重新激活什么
index/       = 给 grep/read 快速定位的入口
```

### 推荐目录

```text
.coc/campaigns/<campaign-id>/
  memory/
    session-summaries.jsonl              # 已有
    director-notes.jsonl                 # 隐藏导演笔记，append-only
    cards/
      player-safe/
        mem-*.md
      keeper-only/
        mem-*.md
    npc-ledger.json
    plot-threads.json
    player-model.json
    clue-understanding.json
    index.json                           # 小索引，给脚本快速过滤
    context-packs/
      latest-director-context.md
      turn-00042.md
```

### memory card 用 Markdown + YAML frontmatter（关键设计）

```markdown
---
memory_id: mem-ada-door-scratches
scope: campaign
privacy: player_safe
status: active
salience: 0.82
last_touched_turn: 14
source_events:
  - event-00041
  - roll-00018
entities:
  - ada-king
  - corbitt-house
  - front-door
scenes:
  - house-entry
tags:
  - player_interest
  - physical_clue
  - threshold
reactivation_cues:
  - door
  - lock
  - scratch
  - threshold
possible_payoff: 下次遇到类似入口时，让细节检查获得额外意义。
---

玩家显著关注门闩和新划痕，倾向通过近距离触摸、照明、绕路确认危险。
```

grep 直接查：`grep -R "reactivation_cues:.*door" .coc/campaigns/<id>/memory/cards`

### memory-index.json 只做检索加速

真内容在 Markdown card，index 只方便脚本先筛。

### DirectorPlan 的 memory_reads/writes schema

```json
"memory_reads": [
  {
    "memory_id": "mem-0001-door-scratches",
    "path": "memory/cards/player-safe/mem-0001-door-scratches.md",
    "reason": "player inspects another threshold",
    "use": "PAYOFF|TONE|NPC_REACTION|CLUE_DELIVERY"
  }
],
"memory_writes": [
  {
    "type": "player_interest",
    "privacy": "player_safe",
    "salience": 0.7,
    "entities": ["front-door", "corbitt-house"],
    "tags": ["cautious_play", "physical_clue"],
    "summary": "玩家主动关注入口痕迹，偏好从物理细节推理。",
    "reactivation_cues": ["door", "lock", "marks"]
  }
]
```

director 只输出 write request；keeper-play apply 层负责落盘成 card + 更新 index。

### 检索算法：grep-first，不要 embedding-first

```text
score =
    4 × entity_overlap
  + 3 × active_plot_thread
  + 3 × reactivation_cue_match
  + 2 × same_scene_or_location
  + 2 × recentness
  + 2 × salience
  + 1 × player_style_match
  - 5 × privacy_mismatch
```

### 记忆写入触发（不要太频繁）

```text
1. 玩家显式表达偏好、恐惧、假设
2. 玩家花费大量 Luck 或主动推骰
3. NPC 态度发生变化
4. 关键线索被理解/误解
5. 玩家做出不可逆选择
6. 角色受到创伤、疯狂、重大伤害
7. 一个伏笔被设置或回收
```

普通"去了哪里、掷了什么骰"留在 logs。

### 记忆隐私分层

```text
player_safe      可用于玩家回顾和叙事回响
keeper_only      只能给 director/keeper-play 隐藏使用
system_only      玩家和 Keeper 叙事都不显示
```

## 最大化利用 Codex grep/read

1. **文件名就是索引**：`mem-20260706-ada-door-scratches-player-interest.md`（grep 友好，不要 UUID）
2. **frontmatter 用稳定英文 key**，玩家可见内容中文
3. **每个 card 写中文摘要**（LLM 读正文直接用）
4. **建 `index/memory-grep-hints.md`** 告诉 LLM 怎么搜
5. **`coc_memory.py` 只做薄工具**：create/update/retrieve/mark_reactivated/retire。智能判断仍由 director 做。

## v2 实现顺序（评审建议）

1. **补 `must_include`**：从 clue-graph `player_visible_anchor` 自动生成
2. **接入 pacing-map**：使 horror_escalation_stage 和 pacing_mode 不再静态
3. **做 `coc_director_apply.py`**：把 plan 的 reveal/pressure/scene transition/memory write 落到 logs/save/memory
4. **做 memory v2**：Markdown memory cards + memory-index + `coc_memory.py` 薄工具 + DirectorPlan memory_reads/writes
5. **扩展 harness**：加 `memory_continuity_drill`

## 评审补充：9 个具体修复点

1. **runtime 信号接线**：从 `logs/rolls.jsonl` 读 last_roll critical/fumble（现硬编码 False）；从真实 character derived 读 Luck（`char_derived.get("Luck", char_chars.get("LUCK", 50))`）；补 CR rich tier（90-98 是 rich，99 才 super_rich）；初始化 `pacing-state.json` 进 `_initialize_campaign_runtime_files`。
2. **clue delivery 结构化**：不要字符串猜，改 `delivery_kind`/`skill`/`difficulty`/`source_refs`/`player_safe_summary`
3. **加 source_refs**：scene/clue/NPC/front/pacing 都加 PDF/grep anchor
4. **memory v0.1**：grep-friendly Markdown cards + index + context pack，让 PAYOFF 不再是 0
5. **write_intents**：DirectorPlan 输出写回意图，不直接写 save
6. **safety/content boundary 加强**：content_flags 不能只是 metadata，重内容模组要能生成 `safety_policy`/`fade_or_omit`/`tone_limits`，harness 不能硬编码 pass
7. **smoke fixtures 固化**：脱敏/压缩后放 `tests/fixtures/story-director/`，不放版权正文，只放结构骨架和 synthetic summaries，CI 才能长期证明没退化

## 最关键结论

v1 已经把"规则器"升级成"有导演脑的规则器"。要变成"有趣的 LLM GM"，下一步不是继续补规则，而是：

> **用 Codex 的 grep/read 能力做一个文本优先的记忆层，让 director 能从玩家过去的选择、偏好、误解、恐惧、NPC 关系里挑出 3–8 个 relevant memories，并把它们变成 PAYOFF、CHARACTER、PRESSURE、CHOICE 的依据。**

先别上向量库。先让每张记忆卡都能被 grep 精准命中、被 LLM 直接读懂、被 harness 证明"不是无关回忆倾倒"。
