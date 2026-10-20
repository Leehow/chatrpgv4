# 事前义务清单与「拿不准也出结果」的门

Status: ready-for-agent（2026-10-20 用户拍板：D1–D6 全部按推荐项定，见 §7）

本 spec 只覆盖两件事：

- 方案 1：把「事后判官」换成「事前义务清单」。
- 方案 2：门拿不准时不再等于拒绝。

方案 3（合并 `apply`/`place` 与决策包两套写入面）和方案 4（每个 `needs` 必须可执行）不在本 spec 范围。

## 1. 为什么要做

### 1.1 数据

数据来源：近 8 天（10-12 至 10-20）的真桌会话，覆盖 App 和 driver 测试工作区，共 1163 次工具调用。

- 217 个用到工具的回合里，65 个（30%）至少被拒一次，10 个被拒三次以上，11 个以中止或报错结束。
- 作者开写后很稳：成文流 203 次，203 次完成。成文失败发生在作者之前，也就是 `output` 决策包被打回的时候。
- 10-20 那局（决策包 v4）：KP 第一次交 `output` 就通过的只有 4/9 个回合。6 次被拒中，5 次落在本 spec 范围内：
  - 2 次缺 `scene` 评估；
  - 2 次被地点覆盖判官判为未覆盖；
  - 1 次同意复核 uncertain。
- 地点覆盖判官（`location-decision-coverage`）判未覆盖的情况：

  | 遥测 | 判未覆盖 | 其中 move 缺失 | 其中灰带 uncertain |
  |---|---|---|---|
  | locations-cold | 19 次 | 10 次 | 5 次 |
  | locations-stress | 15 次 | 13 次 | — |
  | repair-play | 20 次 | 11 次 | 5 次 |

  其余为 feature 缺失。覆盖判官判未覆盖的比例在 29%–37%。
- 同意复核（`admission`）：约 10% 回答 uncertain（10/101、3/40、10/118）。uncertain 直接变成 `needs` 拒绝。

### 1.2 现状链路

1. **义务其实在 KP 决策之前就算出来了，但 KP 看不到。**
   - `extensions/table/context-runtime.ts:782` 在回合开始时调用 `locationContextRelevance`（`extensions/table/location-relevance.ts:26`），得到 `selection:{move,feature,observation}` 三个概率。
   - 这份结果只通过 `coc:location-demand` 事件决定两件事：要不要加载地点工具、事后要不要审（`locationReviewTurn`）。
   - 它没有进 KP 请求。`view` 只加了 `location_identity` 和 `observation_reference`。
2. **`scene` 评估是条件必填，触发得太宽。**
   - `runtime/turn-packet-prototype.ts:124-132`：只要包里有任何 `place move` 就要求带 `scene`，包括同一地点内 `to:"here"` 的局部挪位，比如走到窗边小桌。
   - 已评估、尚未过期的同一地点也会被要求重评。
   - 缺了就是 schema 拒绝。
3. **事后判官再问一次 Jev。**
   - `extensions/kernel/index.ts:5767` 在 `output` 时调用 `locationDecisionCoverage`，上限 2.5 s。
   - 判官的判断是：玩家是否选了 move/feature/observation，包里或回执是否覆盖了它；observation 还要额外判一次「内容是否覆盖了玩家要看的东西」。
   - 判为 `missing`、`uncertain`，或者超时没答，都抛 `invalid_params`。
4. **同意复核的灰带是硬拒绝。**
   - 阈值见 `runtime/jev/continuous-consent.ts:16`：`.6` / `.4`。
   - `extensions/kernel/index.ts:3809-3822`：结果是 `uncertain` 时抛 `needs: The typed consent decision is uncertain`，fix 只有一句「提案未提交」。
   - verdict 按提案缓存，同一提案重交得到同一个 uncertain。KP 不知道该改什么，三次就撞上拒绝预算，回合中止。10-20 第 3 回合打了 23 次调用后中止，就是这个过程。
   - lane 没答、超时或未配置，走 `unavailable` 分支，同样是 `needs`。
5. **已有裁定。**
   - §163（2026-10-01）用户原话：「Jev 拿不准也要出个结果，不能没有结果，哪怕错了后期kp逻辑圆回来也行」。
   - 但 §163.2 第 5 条写明 §32 准入不变。地点覆盖判官是之后（§242/§243）才加的，也没套用 §163。
6. **覆盖判官的来历。** 它是为真实缺陷加的：live 第 118 回合，玩家要读菜单，到了餐馆却被一句到达氛围算作完成（§243 *Selected focused perception is independently completed*）。本 spec 必须保住这个意图：玩家选了的动作不能被静默丢掉。

## 2. 方案 1：事前义务清单

### 2.1 生产者

沿用回合开始时那一次 `location-context` 判断，**不新增模型调用**。

- 灰带按 §163 第 1 条读中点：严格大于 .5 算选中，正好 .5 算不选。
- 判断失败（无凭据、超时、没答）时不产生地点义务。与现状一致：fallback 时 `review:false`。

### 2.2 投影：KP 请求里多一块 `obligations`

在 `context-runtime.ts` 组装 `view` 时加入，跟 `location_identity` 同一位置。这一块是宿主写的机器文本，英文、闭合枚举，不写中文，也不按玩家语言写表。

```json
"obligations": [
  {"id": "ob-1", "kind": "place_move", "basis": "player_selected",
   "account_with": ["place move", "already_satisfied", "blocked"]},
  {"id": "ob-2", "kind": "place_observe", "basis": "player_selected",
   "account_with": ["place observe", "blocked"]},
  {"id": "ob-3", "kind": "scene_assessment", "reason": "unassessed | expired | entered_new_place",
   "account_with": ["scene"]}
]
```

- 每条义务只说「玩家这回合选了哪一类动作」，不说目标是什么。目标仍由 KP 从玩家原话和现有 `location_identity` 读出来。
- `scene_assessment` 由 `scenePopulationRequired` 决定性地产出，不问模型。
- 决策包新增一个可选的交代字段：`accounts: [{obligation: "ob-1", status: "already_satisfied" | "blocked", why?}]`。
  - `blocked` 只能指向本包或回执里已有的障碍，比如 NPC 拒绝、通路不可达的回执。
  - `why` 是给作者的材料，不是给判官的证据。

### 2.3 交付时核对改成纯记账

- **核对规则：** 对每条义务，决策包或本回合回执里有对应 `place` 操作，或者有一条 `accounts` 交代，就算通过。这是决定性检查，不调用模型。
- **退役 `location-decision-coverage` 这个 Jev family。**
  - `move_satisfied`、`feature_satisfied`（「已在目标处」）改由 KP 交代 `already_satisfied`，宿主只核对 `current_position` 存在。
  - `*_blocked`（「是否真有障碍」）改由 KP 交代 `blocked`。
- **删除 `observation_satisfied` 的内容判定**（待拍板 D6）。依据是既有原则「校验器只查交代，不查内容」：observe 的 `facts` 写得好不好，归作者和 KP 管。
- §243 那条防丢动作的意图由「义务必须被交代」保住：到达氛围不再能悄悄消掉一次读菜单，因为 `ob-2` 没有对应的 `place observe` 就过不了。

### 2.4 漏交代时

- **第一次漏：** 拒绝一次。错误点名是哪一条义务（`ob-2`），fix 列出三种合法交代方式的最小样例。不再说「the selected spatial action is not accounted for」这种不点名的话。
- **同一条义务第二次仍漏**（待拍板 D1）：按 §163 记一条 forced，然后放行。
  - 记录格式：`{lane:"forced-resolution", family:"location-obligation", subject:"ob-2", chosen:{outcome:"unaccounted"}, why:"keeper_omitted_twice"}`。
  - 这个动作视为没发生，作者材料里没有它。
  - KP 下回合按 §158 往前圆。
  - 不再打满三次拒绝预算、中止整个回合。

### 2.5 `scene` 评估

- **局部挪位不触发重评**（待拍板 D3）：`to:"here"`，或在当前 place 内改 `at`/`relation`，都不触发 `scene` 必填。只有真正换了 place，或评估缺失、过期时才要求。
- **必填但缺失时不再拒绝**（待拍板 D2）：宿主代写 `service:"unknown", crowd:"unknown", review_after_minutes:15`，并记一条 forced。
  - `unknown` 本来就是合法值，而且「缺名字不等于没人」的语义不变。
  - 代写的值是宿主自己的记账，不是 KP 说的话。

### 2.6 不做的事

- 不加关键词，不对玩家原话做任何字符串分类。
- 不新增模型调用，事前判断仍是原来那一次。
- 不改 `place` 工具的参数形状，那是方案 3。

## 3. 方案 2：门拿不准时不再等于拒绝

### 3.1 范围

本节把 §163 的裁定扩展到 §32 typed consent 的 uncertain 和 unavailable 两条分支，即 `extensions/kernel/index.ts:3779-3822`。

- 适用于 `apply`、`place` 和决策包编译出的效果。
- `not_authorized` 的路径保持不变：它的 fix（`respect_player_scope`）本来就可执行。

### 3.2 灰带按中点读（待拍板 D4）

`continuousConsentDisposition` 的两个硬门不变：

- `selection ≤ .4` 或 `veto ≥ .6`：判 `not_authorized`。
- `selection ≥ .6` 且 `veto ≤ .4`：判 `authorized`。

落在中间灰带时，按中点读：

- `selection > .5` 且 `veto < .5`：判 `authorized`，记 forced。
- 否则判 `not_authorized`，记 forced，走现有的拒绝路径。
- 打平算「否」，与 §163.2 第 1 条一致。

### 3.3 复核没答（超时、provider 失败、未配置）（待拍板 D5）

- **A（推荐）**：放行并记 forced，`why:"jev_unanswered"`。这与 §163.2 第 7 条「没确定是戏外就按戏内玩」同构，错了由 KP 往前圆。
- **B**：不放行，但由宿主收尾。这批效果标为未发生，宿主直接让 KP 用 `ask` 把这一步交还玩家，本回合不允许重交同一提案。

### 3.4 记录与 KP 看到的东西

- **遥测：** 写入 `forced-resolution` 行，`family:"action-admission"`；`uncertain` 字段带 selection/veto 概率；`chosen.outcome` 为 `authorized` 或 `not_authorized`。
- **KP 看到的：** 放行就是普通成功回执；拒绝就是现有的 `not_authorized` 拒绝。KP 永远不会再收到 `The typed consent decision is uncertain`。
- **缓存：** 仍按提案缓存，但缓存的是 forced 后的最终结果，所以不会再出现「同提案同 uncertain」的死循环。
- **拒绝预算：** 三次预算保留，只对真正的拒绝计数。

## 4. 三端（producer / reader / actor）

| | 方案 1 | 方案 2 |
|---|---|---|
| Producer | 回合开始那一次 `location-context` 判断，加上决定性的 `scenePopulationRequired` | 现有 typed consent 复核 |
| Reader | KP 请求里的 `obligations`；交付时的决定性记账；forced 遥测 | `continuousConsentDisposition`；准入调用方；forced 遥测 |
| Actor | KP 交代或执行；作者只拿到实际发生的回执 | KP 拿到普通回执或可执行的拒绝 |

## 5. 改动面

- `extensions/table/context-runtime.ts`：投影 `obligations`，并把 selection 带进 demand 事件（事件已有）。
- `extensions/table/location-relevance.ts`：删除 `locationCoverageBatch` / `locationDecisionCoverage` 的 Jev 部分，保留并改写决定性的 `locationAccounting`。
- `extensions/kernel/index.ts`：
  - 约 5767 行：判官调用换成决定性记账，加上二次漏交代的 forced 放行。
  - 约 3790-3822 行：uncertain 和 unavailable 改走 forced。
- `runtime/turn-packet-prototype.ts:109-132`：调整 `scene` 必填的触发条件；新增可选的 `accounts`。
- `runtime/scene-population.ts`：宿主代写 `unknown` 的入口。
- `runtime/jev/continuous-consent.ts`：中点读法。
- 地点 Mod 的指令文本如果提到 coverage，要跟着改，并升版号（包字节按版本冻结）。
- `docs/kernel-rpc.md` 新增一节，编号只增不改。落地后本 spec 回链该节号。

## 6. 验收

- **离线：** 盒子跑三套件。每条新规则配一个能被变异杀死的用例：
  - 去掉 `obligations` 投影，用例变红；
  - 把中点读法改回硬拒，用例变红；
  - 二次漏交代时不放行，用例变红。
- **真桌：** 按 Agents.md 走 live KP，玩家一回合一句，15–20 回合，开局前预注册：

  | 指标 | 基线 | 目标方向 |
  |---|---|---|
  | `output` 首交通过率 | 4/9 | 明显上升 |
  | 被拒 ≥3 次的回合比例 | 10/217 | 下降 |
  | 中止的回合数 | 11/217 | 下降 |
  | 玩家选了的动作被静默丢掉（§243 菜单那类，靠人读正文核对） | 0 | 不得增加 |
  | `forced-resolution` 中 `action-admission` 和 `location-obligation` 的条数 | — | 逐条读原文，判断放行得对不对 |

- 只有阻塞性问题（无交付、挂死、推不动）才停桌。其余问题记下原因，桌继续打。

## 7. 拍板结果

用户裁定（2026-10-20，原话）：「D1–D6 全部按推荐项定」。下面每条的推荐项就是定案。正文里所有标着「待拍板 Dn」的地方，都按这里的推荐项执行。

- **D1** 同一条义务第二次仍漏时：放行并记 forced（推荐）／继续拒绝。
- **D2** `scene` 必填但缺失时：宿主代写 `unknown/unknown`（推荐）／继续拒绝。
- **D3** 同一地点内局部挪位不触发 `scene` 重评：是（推荐）／否。
- **D4** 准入灰带按中点读：是（推荐）／否。
- **D5** 准入复核没答时：A 放行并记 forced（推荐）／B 宿主收尾、交还玩家。
- **D6** 删除 `observation_satisfied` 内容判定：删（推荐）／保留。
  - 删的风险：KP 交一个空泛的 observe 也能过。
  - 保留的代价：它仍是事后模型判官，会带来超时和灰带拒绝。

## Comments
