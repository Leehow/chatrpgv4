# 规则层可玩性覆盖：造景清扫 — 2026-09-02

主线是「把整个规则层图谱化并**测试实际可用**」。图谱化已完成（437 节点 / 671 关系，
十族 `family_runtime_ownership=graph`）；**「实际可用」是另一件事，本文记录它的进度。**

## 覆盖率

统计口径：一个决策算「已证明」当且仅当它在**真实对局**里成功结算过一次
（投影语料夹具 + 历次诊断 lane 的 `rules.settle` 成功记录）。
这是 Gate9 **诊断清扫并集**，不是一场连打把 43 张卡盖完，也不是 spec §14
整场产品验收。

- 2026-09-02 上午：**13 / 43**
- r55（10 条并发造景）之后：**16 / 43** — 新增 `combat:aim`、`combat:defend`、
  `push-luck:luck-roll`
- **2026-09-04 r87：41 / 43 结算卡**至少一次 Keeper 可见的 `rules.settle` `ok`。
  剩下 `combat:context`、`sanity:context` 是 `phase: context`，走
  `rules.context` / 子系统 context，本来就不结算。
  r87 六路（`ch-conf4` / `cmb5` / `mg-learn7` / `s-treat6` / `s-recov3` /
  `x-psy3`）全部 `resume_first` + finalize，六个目标决策均有成功 settle。

| 族 | 已证明 | 未证明 |
| --- | --- | --- |
| social | 1/1 | — |
| combat | 4/8 | context、flee、maneuver、reload |
| sanity | 3/9 | apply-treatment、context、gain-current-san、insane-insight、reality-check、recover-temporary |
| chase | 2/6 | barrier、conflict、end、hazard |
| push-luck | 2/3 | luck-spend |
| core-check | 1/3 | combined-check、opposed-check |
| development | 1/2 | settle-ending |
| psychology | 1/2 | realize-player-safe |
| healing | 1/7 | 六个全缺 |
| magic | **0/2** | cast-spell、learn-spell |

## 造景设计的一条硬约束（r55 学到）

r55 十条 lane 里六条没能逼出目标决策。查下来**六条全部掉进了疯狂发作**：

模组 12 个场景里**只有 `corbitt-confrontation` 和 `upper-floor-bedroom` 带 SAN
触发**，而那十条 lane 全部种的是前者。SAN 检定失败 → bout of madness → 按 p.157
**bout 期间由 KP 控制调查员身体**，玩家声明的动作在规则上就不是调查员的动作。

所以 Keeper 去推进 bout 是**正确的**，规则图谱也没问题——是造景把调查员送进了一个
它无法自主行动的状态。

**约束：测非 sanity 族的决策时，种子场景必须无 SAN 触发。** 无 SAN 的十个场景是
basement-rites、central-library、chapel-of-contemplation-ruins、commission-briefing、
corbitt-house-ground、hall-of-records、higher-courts-central-police、
neighborhood-gossip、newspaper-morgue、previous-tenants。

另两条参数教训：并发 5 时单条 lane 明显变慢，900 秒超时砍掉了两条正在推进的 lane；
r56 起改为并发 3 / 超时 1800 秒。

## 造景造不出来的状态

- **magic（0/2）**：需要法术书与已学法术
- **healing（1/7）**：需要受伤、濒死、重伤等状态
- **chase 的 barrier / hazard**：需要地点链上真的有屏障或危险
- **development:settle-ending**：需要一个已持久化的结局收据

这些不能靠 `scene_id + npc_presence` 种出来，需要另想办法（预置存档、或先用一个
准备回合把状态推到位）。

## 本轮修的产品缺陷

- `b222b60b` **`state.exceptional_effect` 的补救指引只列了 9 个必填参数中的 4 个**。
  `state.journal` / `turn.finalize` 拒绝时告诉 Keeper 去补一个特殊效果，却漏掉
  `direction`、`player_visible_impact`、`causal_link` 和结构复杂的 `boundary`。
  **照着做仍然失败**，journal 过不了，回合关不上——r55 有一条 lane 因此 645 秒未收尾。
  接受值现在直接从 `coc_exceptional_effects` 读，不再手抄。

## 报过但查证后不成立的（勿重开）

- **`unknown_weapon`**：Keeper 用了从显示名推的 slug，随后自己 `rules.catalog_search`
  查到规范 id `revolver_38_or_9mm` 并成功攻击。模型临时错误，自愈。
- **`combat_defense_required` / `combat_defense_not_pending`**：两码看似矛盾，实为
  顺序发生、逻辑互斥（有待处理攻击时只能防御 → 防了 → 再防就没得防）。行为正确。

## 已知但未修

- `combat_not_ready` 在 `aim` / `reload` 上报的消息是「combat cannot accept an
  **attack** declaration」，且不区分「战斗未激活」与「已有待处理攻击」两个条件。
