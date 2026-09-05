# 规则层：真玩测挖出的缺陷与修复 — 2026-09-03

Track: `ACTIVE_IMPLEMENTATION_TRACK=pi-coc`。分支 `0.8.1a`。

本文只记录**当天用真 Keeper lane 跑出来、并且有证据的**缺陷。每条给机制、
证据位置、修复提交。它不是计划书。

---

## 贯穿全天的同一个病：状态动了，投影没带

今天九个缺陷里有六个是同一形状——**某一层算出了正确的东西，下一层没有携带**。
它们分布在完全不同的模块，但读起来是一句话：

| 算出来的东西 | 谁丢的 | 后果 |
| --- | --- | --- |
| 造景种子键（`spells`/`damage`/`advance_minutes`…） | `_normalize_situation` 的定长返回 | 三轮造景升级一次都没生效 |
| `rule_decision_stale` 的 `reason` | settle 自己那条 fail-closed 门的原始信封 | 「没授权」和「绑定漂移」读起来一样 |
| 未声明槽位的可填清单 | 宿主侧那条拒绝路径 | KP 被要求修它没发过的参数 |
| 结算收据里的掷骰身份 | `_minimal_identity` 的超限压缩 | 网关登记不到句柄，KP 无名可引 |
| 拥有的武器 id | `rules.context` 的 combat 上下文 | 规范 id 只在一次失败的 settle 里出现过 |
| 家族为何无牌可发 | `context` 丢掉了已算出的 `missing` | 空手，且不说为什么 |

**共同教训**：一个字段被计算出来，不等于消费端拿得到。测试必须断在
**消费端实际收到的形状**上，而不是产出方的返回值上。

---

## 一、造景的种子从未落地（`9c4c2c5e`）

`_normalize_situation` 校验通过 `items` / `spells` / `damage` / `ending` /
`advance_minutes` / `safe_rest`，然后 `return` 一个**写死四个键**的字典。
`_situation_operations` 读归一化后的字典，于是只发出场景移动。

证据在 lane 自己的 `final.json`：

```
requested keys: ['clue_ids', 'flags', 'npc_presence', 'scene_id']
applied ops:    ['state.move_scene']
```

测试没抓到，是因为它们直接调 `_situation_operations` 并手工构造**已归一化形状**
的 lane dict，正好跳过唯一坏掉的那一步。现在测试从 `_normalize_run_spec` 进，
并有一条类级守卫断言「接受集合」与「归一化后出现的键」差集为空。

## 二、三次操作契约错配

种子终于到达沙盒后，连续暴露三个：

- `rules.damage` 的 `kind` 是**方向**（damage/heal），不是伤害类型（`c4132488`）
- `state.item_grant` 的 `kind` 只收 gear/weapon（`9319b1b4`）
- `magic.learn` 的 `source` 是 tome/person/entity 的封闭集

前三个操作**在运行时强制封闭集，却只把它写在自由文本 `desc` 里**，任何调用方
都得读英文猜。补上机器可读的 `enum`（`9f07df6c`），并让造景在派发时读操作
自己的声明校验（`30702bda`）——不抄一份到造景里，那是第二个会漂移的地方。

## 三、关闭的门说不清自己要什么（`ac23353f`）

未满足条件的解释渲染 `expected` 而丢掉运算符，而 `{"op": "exists"}` 根本没有
`value`，于是渲染成 `actor.conditions.major_wound is None, needs None`——读起来
像已满足。同一个遍历还把否定处理反了：`not` 底下求值为 True 的叶子才是关门的
那个，跳过它等于一条未满足条件都报不出来。

## 四、opposed-check 结构上不可能结算（`79798c7b`）

`opposed-check` 声明 `investigator_target`，**没有** `investigator_id`；适配器却
对每个 core-check 决策无条件设 `locked["investigator_id"]`。167 条 lane 里一次
都没成功过。一条既有测试在**断言这个缺陷**。

## 五、combat 死锁三连（合并自 `claude/combat-deadlock`）

1. 自解算命令（maneuver/aim/reload/flee）只造 `combat_turn_resolved`，掷骰 id
   嵌在 `roll_evidence` 里，而 `logs/rolls.jsonl` 只从**顶层带 `roll_id`** 的
   扁平事件写入。收据引用了从未落盘的 `cr6`/`cr7`，玩家看到「系统故障」。
2. `nonretry-circuit` 把 `decision_id` 当宿主噪音剔除——对 `idempotency_conflict`
   恰好反了：那个错误的全部内容就是「这个 key 已绑定到不同参数」，换新 key 是
   唯一出路。KP 照文档做了正确恢复，被守卫封死。
3. `combat_not_ready` 对 aim/reload 也说「攻击声明」。

## 六、超限压缩吃掉掷骰身份（合并自 `claude/collapse-keeps-roll-identity`）

combat 结算 68–77 KB，上限 16384。`_minimal_identity` 只保**顶层** `roll_id`，
而 combat 的掷骰 id 全部嵌套。**22 次成功结算里 21 次被压成空壳**，网关遍历空壳
登记不到任何句柄。KP 找对了骰（NPC 的对抗闪避，大失败），却没有名字可以称呼它，
猜了 8 种形状 29 次，烧完 1800 秒超时。

保留全部掷骰（去重）的理由是数据：一次结算最多 6 个不同 id，筛选「最近 N 个」或
「可引用的」**都会正好丢掉害死那条 lane 的那颗**。实测最大结算 +632 B，上限下
仍剩 14,739 B。

## 七、magic 家族四层不可达（合并自 `claude/magic-learn-unreachable`）

`magic.learn` 返回 `ok:true` 却什么都不写：研读被排成一个触发器，
`_dispatch_handler` **从未实现** `grant_learned_spell`，而且触发器排的时候
**没带 `target_id`**，dispatch 在读 handler 名字前就返回了。复现：推进 200 周
游戏时间后 `learned_spells` 仍是 `[]`。

另两层只在做真实路径测试时才撞上：`_canonical_magic_binding` **没有生产调用者**；
`rules.settle` 有一份扁平名字黑名单，而 `cast-spell` 把黑名单里的 `pushed` 声明
为**必填**。

## 八、族参数化法术无法解析（合并自 `claude/summon-bind-family-resolution`）

CoC7 把 Summon/Bind 写成「族 + 生物参数」，目录只存族。模组授权的
`Summon/Bind Dimensional Shambler` 因此不是任何目录条目。族性从记录自己的
`kind` 推导（`kind="spell"` 的族用 `"... Spells"` 命名自己），生物拿目录自己的
creature 行校验，目录里没有的生物报成**内容缺口**而不是编造。

## 九、空家族不说为什么（合并自 `claude/empty-family-says-why`）

`rules.context` 对全部决策都被门挡住的家族返回 `cards: []`，而循环里**已经算出**
了 `missing`。KP 蒙眼结算后拿到的 `rule_decision_stale` **反而说清了**门在哪——
信息在一次拒绝之后才出现，不在那个专门用来说明「有什么可用」的调用里。

顺带修了一个旁支：`_unmet_availability` 重读原始事实源，而适配器的
`augment_facts` 从**本次提问的语义输入**推导 `magic.spell.known`，于是解释报
`actual: None` 而适用性看到的是 `False`——同一字段，两个世界。

---

## 诊断能力的扩展

- 并发上限 20 → 40（`282fe5d6`）。依据：r50–r57 从未被限流，3→6 并发下每条
  lane 的时长没有退化。lane 是网络受限且沙盒隔离的。
- 造景可以推进时钟与记录安全休息（`99bb610a`），这是到期触发类决策唯一的入口。
- **lane 可以自己任命法术老师**（`c2f360f3`）。哪个 NPC 教哪个法术是授权模组
  内容，而所有已发布模组一个都没授权，所以 magic 家族在诊断里根本开不了门。
  任命写进 lane **自己沙盒**的 `scenario/npc-agendas.json`，记为
  `host.appoint_spell_teacher` + `authority: host_diagnostic_seed`——**种出来的
  老师永远不可能被读回成模组内容**。只能给战役已授权的 NPC 换装，不能造人；
  法术是叠加不是覆盖。
- 覆盖率测量本身（`fc41eeb9`）：只认 `rules.settle` 返回 ok 且 `status: settled`
  的收据。在整个日志里搜决策 id 会报 43/43——因为 `rules.context` 把**整份卡片
  目录**发给 KP，每个 id 在每条 lane 里都出现。那个读法会宣布规则层做完了。

---

## 仍然缺的

- **老师没有 KP 可见的入口**。r70 里任命落地了，KP 却对玩家说「我是房东，不是
  什么开门关门的巫师」——它读到的诺特就是模组里那个房东。工具流里
  `magic_source_kind` 出现 **0** 次。这是第七次「状态动了投影没带」，修法有现成
  样板（今天的武器库入口）。
- **`combat` 全族仍零结算**。r68 相比 r65，`nonretryable_repeat_blocked` 从 21+
  降到 1，`c-attack` 规则错误从 5 种降到 0，但剩下的失败是真正的规则时序问题
  （先攻顺序、防御待处理）。
- **`_minimal_identity` 之外的超限行为**未系统检查过。
- 宽选测试跑到 39% 挂住，在干净 `0.8.1a` 上**行为完全一致**，进度与失败前缀
  逐字节相同。既有问题，需要单独查。
