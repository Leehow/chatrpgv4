# 问题：规则检定结果如何语义化地影响线索揭示（非机械门禁）

> **本文档用于咨询 GPT Pro。** 描述 CoC director 引擎的一个集成缺口，以及我们对修复方式的约束（不能用机械门禁）。请 GPT Pro 给出设计建议。

## 项目背景

这是一个 Call of Cthulhu 7e（40 周年规则书）的 Codex 插件，名为 coc-keeper。它有一个 **deterministic 的"剧情导演层"**（coc_story_director.py），每回合读规则状态 + 模组剧情图，产出 DirectorPlan JSON 指导叙事。

架构分层：
```
coc_story_director  = 导演脑（deterministic planner，选动作）
coc-keeper-play     = 玩家可见主持声音（LLM 读 DirectorPlan 写叙事）
coc_roll/combat/chase/sanity = 裁判层（规则引擎）
coc_director_apply  = 写回层（把 plan 效果落盘）
coc_playtest_driver = 多回合跑局驱动器（player→director→rules→apply 循环）
```

## 核心设计理念（必须遵守）

**禁止硬编码具体文字判定，用 LLM 语义方式约束。** 这是整个项目的一致原则：
- director 是 deterministic 的（选动作、评分），但**不写叙事文本**
- 叙事由 LLM（keeper-play）按 DirectorPlan 的 narrative_directives 语义生成
- 规则数据从 JSON 读，不硬编码
- 内容安全用提示词约束（content_constraints 传递 + SKILL.md 语义指引），不写敏感词过滤

## 当前问题

### 现象

跑了一局完整鬼屋模组（The Haunting），发现**规则检定的成败不影响线索是否揭示**。

具体数据（session-report-v4.json）：

```
回合 5:
  director 决定 REVEAL clue-1835-merchant-builds（一条 obscured 线索）
  director 请求 Library Use 检定（rules_requests: [{skill: "Library Use", difficulty: "regular"}]）
  driver 执行检定：roll=82, target=50, outcome=failure（失败）
  结果：clue-1835-merchant-builds 仍然被揭示（写进 discovered_clue_ids）

回合 9:
  同样：Library Use roll=95/50=failure，clue-corbitt-will-executor-thomas 仍被揭示
```

### 根因

架构分层后，**规则层 → 导演层的回路没接上**：

```
现在的流程（有缺口）：
  director 产 plan（含 rules_requests + clue_policy.reveal）
    → driver 跑检定（coc_roll.percentile_check）
    → apply 无条件执行 clue_policy.reveal（不看检定结果）
```

driver 跑了检定，记录了骰值，但**没把结果回写**影响揭示决策。检定沦为剧场效果——不管成败，线索都给。

### 为什么这同时损害两个评估维度

- **D1（规则合规性）：** 骰值本身 100% 正确（success_level 阈值算对），但"失败不挡揭示"违反了 CoC 的核心机制——obscured 线索就该检定成功才拿到
- **D3（叙事一致性）：** narration skeleton 同时携带"Library Use 失败"和"揭示线索"两个矛盾信号，LLM narrator 会写出"你什么都没查到……这是你查到的"这种破绽

## 我们的约束：不要机械门禁

**最直觉的修复是"检定失败 → 不揭示线索"。但我们明确不想要这个。** 理由：

1. **机械关门违背 CoC 的跑团哲学。** 规则书 p.199 的 Idea Roll 和"三线索思想"（The Alexandrian）都强调：**不要让玩家因为一次检定失败就死锁**。每个关键结论至少 3 条线索路径，就是为了避免"骰子烂=卡死"。
2. **机械关门违背我们的语义约束理念。** "失败=不给"是硬编码逻辑；我们更希望 director/LLM 语义判断"失败意味着什么"——可能是给部分信息、给误导、给风险、给替代线索、或推 pressure clock。
3. **真实 KP 不会这样跑团。** 一个好的 Keeper 在玩家检定失败时不会简单说"你什么都没找到"，而是：描述失败的后果（时间流逝、发出声响、NPC 注意到）、给替代路径暗示、或用 Idea Roll 兜底。

### 我们想要的：失败有后果，但不是死锁

CoC 规则书对失败的处理其实很丰富：
- **普通失败**：没达到目标，但时间/资源消耗了
- **pushed roll 失败**（p.84）：必须有更糟的叙事后果（受伤、警报、SAN 损失）
- **Idea Roll**（p.199）：卡住时给恢复阀，成功给方向，失败把玩家扔进"麻烦现场"
- **fumble（96-100）**：立即厄运，不可取消

所以我们希望：**检定结果不是简单的 gate（开/关），而是一个语义信号，让 director/LLM 决定"这次失败该如何影响叙事和状态"。**

## 当前的数据结构（供参考）

### DirectorPlan 相关字段

```json
{
  "scene_action": "REVEAL",
  "clue_policy": {
    "reveal": ["clue-1835-merchant-builds"],
    "clue_type": "obscured",            // obvious | obscured
    "skill": "Library Use",             // 检定技能（obscured 时）
    "difficulty": "regular",
    "fallback_routes": []               // 该 conclusion 的其他线索路径
  },
  "rules_requests": [
    {"kind": "skill_check", "skill": "Library Use", "difficulty": "regular", "reason": "obscured clue in scene"}
  ],
  "narrative_directives": {
    "tone": ["dust", "old paper", "silence"],
    "must_include": ["1835 年富商建屋后即病倒..."],
    "must_not_reveal": ["corbitt-buried-in-basement: ..."],
    "horror_escalation_stage": "wrongness"
  }
}
```

### clue-graph 的线索结构

```json
{
  "conclusion_id": "corbitt-linked-to-chapel",
  "importance": "critical",
  "minimum_routes": 3,
  "clues": [
    {"clue_id": "clue-newspaper", "delivery_kind": "handout", "visibility": "player-safe"},
    {"clue_id": "clue-archive", "delivery_kind": "skill_check", "skill": "Library Use", "difficulty": "regular"},
    {"clue_id": "clue-symbol", "delivery_kind": "skill_check", "skill": "Spot Hidden", "difficulty": "regular"}
  ],
  "fallback_policy": "If two routes are missed, director may move one clue to a new scene."
}
```

### driver 执行检定后的记录

```json
{
  "rules_executed": [
    {"skill": "Library Use", "target": 50, "difficulty": "regular", "roll": 82, "outcome": "failure", "success": false}
  ]
}
```

## 我们想问 GPT Pro 的问题

1. **检定失败时，director 应该如何语义化地处理线索揭示？** 我们不想要"失败=不给"的机械门禁。我们想要 director 根据失败类型（普通失败/pushed 失败/fumble）和模组上下文（fallback routes 是否存在、pressure clock 状态、玩家是否卡住）做不同的叙事响应。有什么设计模式？

2. **回写回路应该在哪一层实现？** 现在 director 先产 plan → driver 跑检定 → apply 执行。检定结果该回写给谁？
   - 选项 A：driver 把结果回填进 plan，apply 读 plan 的"检定成功？"字段决定揭示
   - 选项 B：apply 自己跑检定（director 只请求，apply 执行并决策）
   - 选项 C：director 不在当回合揭示，而是"待定"——下一回合根据检定结果重新决策
   - 其他？

3. **失败后果的语义谱系怎么设计？** 我们想要一个"失败后果枚举"，让 director/LLM 根据上下文选：
   - 部分信息（给一半线索，留悬念）
   - 误导（给错误信息，后续可纠正）
   - 时间/资源代价（没找到，但时间流逝，pressure clock +1）
   - 风险代价（没找到，但发出了声响/NPC 注意到）
   - 替代路径暗示（"这里没找到，但你想起邻居提过..."）
   - Idea Roll 兜底（卡住时触发）
   - 完全不给（仅 fumble 或已经多次失败时）
   
   这个谱系怎么和 director 的 10 个动作（REVEAL/DEEPEN/PRESSURE/CHARACTER/CHOICE/CUT/MONTAGE/SUBSYSTEM/RECOVER/PAYOFF）结合？

4. **如何避免"骰子决定死锁"？** CoC 的三线索原则要求关键结论有多路径。如果某条 clue 的检定失败了，director 应该如何确保玩家**最终能**通过其他路径到达结论——而不是因为骰子烂永远卡住？

5. **narrative_directives 如何传递"失败后果"给 LLM narrator？** 现在 must_include 是"必须出现的内容"。失败时应该改成什么？比如 `must_include` 变成"你翻找了一小时但没找到日记" + `tone` 加"挫败感" + `pressure_moves` 加"时间流逝"？

## 我们不想要的（明确排除）

- ❌ "检定失败 → 线索永远消失"（机械死锁，违反三线索原则）
- ❌ "检定失败 → 简单 return null"（硬编码逻辑，无语义判断）
- ❌ "检定失败 → 强制 Idea Roll"（每次失败都兜底，太软，没有失败张力）
- ❌ 在 director 里写大段 if-else 判断失败后果（违背 deterministic planner 的简洁性）

## 我们想要的（设计目标）

- ✅ 检定失败有**真实后果**（不是假装失败但照样给线索）
- ✅ 后果是**语义化的**（director 选后果类型，LLM 据此叙事）
- ✅ **不死锁**（关键结论总有多路径可达）
- ✅ 失败后果**多样化**（不是每次都"你没找到"）
- ✅ 符合 CoC 规则书精神（pushed fail 更糟、fumble 立即厄运、Idea Roll 兜底）
- ✅ 保持 director 的 deterministic 简洁性（评分选动作，不写复杂分支）

## 相关代码位置（供参考）

- `plugins/coc-keeper/scripts/coc_story_director.py` — director（_select_clue_policy / generate_director_plan / _build_rules_requests）
- `plugins/coc-keeper/scripts/coc_director_apply.py` — apply（apply_plan 执行 reveal）
- `plugins/coc-keeper/scripts/coc_playtest_driver.py` — driver（_execute_rules_requests / run_full_session）
- `plugins/coc-keeper/scripts/coc_roll.py` — 规则引擎（percentile_check）
- `plugins/coc-keeper/skills/coc-keeper-play/SKILL.md` — narrator 的提示词约束

## 评估数据（证明问题真实存在）

v4 跑局的 session-report-v4.json 里，15 回合中 6 次 Library Use 检定：
- T5: 82/50 失败 → 线索仍揭示 ❌
- T6: 15/50 困难成功 → 线索揭示 ✅
- T7: 4/50 极限成功 → 线索揭示 ✅
- T9: 95/50 失败 → 线索仍揭示 ❌
- T11: 36/50 常规成功 → 线索揭示 ✅
- T12: 32/50 常规成功 → 线索揭示 ✅

骰值机制全对，但 2 次失败没后果。
