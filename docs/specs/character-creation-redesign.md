# 建卡重设计：一张卡、两种改动、一道闸（2026-09-17 提案）

Status: 提案，等用户拍板。依据是 2026-09-16/17 血色公路五局建卡记录（`game-96aa3e90`、`game-01250e5e`、`game-ab186963`、`game-cef418b6`、`game-32bc9a85`）与当前实现（`kernel-ts/setup/*`、`extensions/onboarding/index.ts`、`Electron/packages/ui/src/CocCharacterDraft*.tsx`）。落地时作为契约新节写入 `docs/kernel-rpc.md`，修订 §23.4、§26（setup 部分）、§92、§96；§编号不重排。

## 0. 一句话

现在的建卡是「模型交一份必须完全合法的语义档案，内核从种子整张重算数字，玩家改的数事后再贴回去，确认前过三道闸」。重设计后是「卡是一份可 patch 的文档：字改字、数改数，数字只在第一次生成，玩家和模型定下的数是钉子，机器铺的点让位；确认是卡上的一个按钮」。

## 1. 实测：时间都花在哪

五局的 setup 阶段，模型都是 deepseek-v4.1-flash（thinking low），单次模型调用 10 到 40 秒。

| 局 | 玩家那一句 | 等待秒 | 模型调用 | 画卡次数 | 被拒次数 |
|---|---|---|---|---|---|
| 韩渡 | 「机械师，现在就把卡写出来」 | 105 | 10 | 7 | 6 |
| 戴维·奥尔 | 「都点名找我，现在就做卡」 | 198 | 12 | 10 | 8 |
| 龙薇 一 | 「就这样吧，我们开始」 | 42 | 5 | 1 | 3 |
| 龙薇 二 | 「确认」（改完数字后，照卡片提示打的） | 101 / 111 | 10 / 8 | 4 / 4 | 5 / 2 |

被拒的理由只有五种，全是形状问题，不是内容问题：

- `occupation must be a listed occupation`：职业必须命中 28 个英文 id。「修车工」猜了 Mechanic、Engineer、Farmer 三轮。
- `occupation_skills must name eight distinct concrete catalog skills`：恰好 8 个、去重、全合法。
- `retain required occupation skills: [...]`：8 个里必须含职业必需技能，而必需技能是「one interpersonal skill (Charm, Fast Talk, ...)」这种短语，模型要自己解析。
- `Selected skills cannot hold the full budget`：兴趣技能必须把预算花到恰好为零（`chargen.ts:362`）。
- 确认三道闸：`previewed_revision` 未打、`input_key` 同一条消息、`completeness` 两个预算 `unspent` 必须为 0（`sheet.ts:12`）。

玩家手改数字的下场（磁盘 `setup/drafts/*.json`）：

| 局 | 玩家保存 | 下一次画卡 | 结果 |
|---|---|---|---|
| 龙薇 一 | rev 2 DEX 90 / APP 90 / 信用 65 | rev 3 | DEX 55 / APP 40 / 信用 5，无记录 |
| 龙薇 一 | rev 7 DEX 90 / APP 90 / 闪避 85 | rev 8 | 同上 |
| 龙薇 二 | rev 6 DEX 90 / APP 85 | rev 7 | 回到骰子，§92 之前 |
| 龙薇 二 | rev 9 DEX 90 / APP 90 | rev 11 | `carried: {}`，8 项 dropped「预算超了」（§96 之前） |

链条：玩家放宽预算上限但没花完（rev 6 职业点剩 80、兴趣点剩 96）→ `completeness` 判不完整 → 确认被拒 → 模型唯一会的恢复动作是重画 → 重画从种子重算 → 玩家的数没了。§92（贴回去）、§93（失败草稿别搞坏记账）、§96（贴不下让分配器让位）是 24 小时内对同一后果的三次补丁。

## 2. 根因：三件事绑成一个 draft

1. **语义**（是谁、干什么、带什么、长什么样）
2. **目录映射**（职业、技能、武器对到规则表的行）
3. **数字**（属性、技能点、信用、钱）

现在改任何一样都要过全部校验、重算全部数字、再过全部闸。目录映射压在模型身上并且错一次退一次；数字有两个主人（分配器和玩家）；确认让模型去撞闸。

## 3. 原则

- **字改字，数改数。** 改外貌、装备、背景、武器、技能名单，不碰任何数字。改数字不碰任何字。
- **数字只生成一次。** 属性在第一次画卡时生成，之后就是卡上的数。要重掷是玩家的一个明确动作。
- **钉子优先。** 玩家或模型定下的数是 `pinned`，机器铺的点是 `soft`。名单或预算变了，只有 soft 的点重新流动。不存在「贴回去」。
- **预算是报告不是闸。** 没花完、花超了都允许，卡上写清楚，给一键铺平。规则书合法与否是一个标记，不是锁。
- **目录映射内核做。** 模型给名字，内核对表；对不上给候选，不给全目录。
- **确认一道闸。** 卡上一个按钮直接确认，打字确认也只查「是不是当前这张」。
- **模型永远不需要为过闸重画。** 任何拒绝都不以「再画一张」为出路。

## 4. 数据模型

一局只有一份 `card`，按 `revision` 递增，每个 revision 一个文件（沿用 `setup/drafts/<n>.json`）。

```
card {
  revision, seed,
  profile {                       // 语义，全部可 patch
    name, occupation, occupation_stated, age, sex, concept, era, own_language,
    backstory{...}, key_connection, equipment[], weapons[],
    occupation_skills[], interest_skills[],      // 名单，1..8 / 0..n，内核补齐
    aptitude {strong[], weak[], origin}          // 只影响首次生成
  },
  numbers {
    characteristics {STR..EDU, LUCK},
    skills {name: value},
    credit_rating
  },
  pins {                          // 谁定的数就是谁的
    characteristics {abbr: {value, by: player|model}},
    skills {name: {value, by}},
    credit_rating? {value, by}
  },
  limits {characteristic_min, characteristic_max, skill_cap, occupation_points, interest_points, unlocked: [...]},
  budget {                        // 报告
    occupation {total, spent, unspent}, interest {total, spent, unspent},
    legal: true|false, notes: ["兴趣点还剩 96", "DEX 90 超过创建上限 75，已放宽"]
  },
  generation {method, rolls?, array?, assignment?}, // 追溯，只写一次
  creation {...}                  // 现有 trace 结构保留给「计算详情」
  sheet                           // 由 profile+numbers 投影出的现有 sheet 形状，party/investigator.json 写的还是它
}
```

`sheet` 继续存在，是投影：`engine-is-authoritative-sheet-is-mirror` 不变，只是「引擎」从「分配器每次重算」变成「card 的 numbers」。

## 5. 数字怎么来：三种生成，按玩家给了什么选

规则书有三种合法方法，表里都有（`characteristic-dice.json.generation_methods`）：

| 玩家给的是 | 方法 | 属性 |
|---|---|---|
| 什么都没说 | `rolled_in_order`（现状） | 骰子按表顺序 |
| 形容词（快、美、壮、弱） | **Quick Fire 数组按优先级排**（`quick_fire_array` 40 50 50 50 60 60 70 80） | strong 依次拿最高，未提的按表序拿中间，weak 拿最低 |
| 明确数字（「敏捷 90」「档案上写着 DEX 85」） | `point_buy_460` 加钉子 | 钉的数照钉，其余按 quick-fire 或骰子填，总分超 460 或超 90 时按 §10 放宽并标记 |

现状只有 rolled 加「拿自己骰子里最好的」，所以「天仙级」拿到 APP 35。换成 Quick Fire 数组之后，「S 级杀手：敏捷、容貌、力量、体质」得到 DEX 80、APP 70、STR 60、CON 60，其余 50、50、50、40。这是规则书方法，不是编数。

引导包（§26 guided-creation）的 `aptitude` 语义不变，只是从「排列自己的骰子」升级为「选 Quick Fire 数组」；`origin: concept` 的 1 强 1 弱上限不变。

年龄调整、幸运、派生值照旧，只在生成时算一次；之后改属性只重算派生值（现有 `rebuild` 已会）。

## 6. 技能点：铺点是机器的，钉子是人的

首次生成：
1. 职业技能名单 = 模型给的（0..8 个）+ 内核用职业必需项补齐到 8（`catalogName` 已能解析短语；「one interpersonal skill」类短语取模型名单里已有的一项，否则取短语第一项）。**不再拒「不是 8 个」和「缺必需技能」**：内核补，结果里 `filled_in: [...]` 告诉模型补了什么。
2. 职业点按现有 `spread` 分层铺；铺不完的**不拒**，进 `budget.occupation.unspent`。
3. 兴趣点同理，铺不完进 `unspent`；`interest_skills` 为空时沿用标准表轮询（现状）。

之后任何改动：
- 名单变了（加减技能、换职业）：钉子不动；soft 的点先全部收回，再按 spread 重铺到 soft 的格子里；预算不够钉子的部分记 `budget.notes`，不拒。§96 的 `makeRoom` 就是这个规则的一半，现在成为唯一规则，`carryManual` 删除。
- 数变了（玩家在卡上改、模型 `revise.numbers`）：直接写成钉子；超出 `limits` 的按 §10 处理。
- 换职业：信用范围换成新职业的；钉的信用超范围时记 note，不拒（这是 §96 唯一保留的「拒」，改成 note）。

`completeness` 只保留结构项：名字、职业 id、九个属性为整数、财务表可用、背景三项加 `scenario_bound`、母语、装备为数组。**预算 unspent 从 completeness 里删除**。

## 7. 目录映射内核做

`setup.draft` 和 `setup.revise` 接受的名字都是自由文本，内核按顺序解析：

1. 规范化精确匹配（现有 `normalize`）。
2. 本地化标签（`skills.json.localized_labels`、`occupations.json.localized_labels` 都是 79/79、28/28 全覆盖），所以「侦查」「罪犯」直接对上。
3. 专精身份（现有 `specializationIdentity`），所以「Fighting (Sword)」「Language (Other: English)」对上。
4. 对不上的：
   - 技能：从名单里去掉，结果 `unresolved_skills: [{given, candidates: [≤3]}]`，候选取本地化标签的字面重叠（这是结构化查表，不是语义分类）。模型下一句问玩家或自己选。
   - 职业：不能猜，规则书职业只有 28 个。返回 `needs` 带候选 ≤3：候选按「模型给的技能名单与各职业必需技能的交集大小」排序（集合运算），交集为零时给全部 28 个的本地化名单一行一个。模型的义务不变：说出来，给玩家两三个选项，或玩家委托。`occupation_stated` 保存玩家原话（现状）。
   - 武器：规则表没印的，**自动落到 equipment**，`weapons` 只留印了的，结果里 `moved_to_equipment: [...]`。现在的错误文本已经这么说了，直接做。
5. 未知字段：拒，但 `details.unknown: [key]` 指名道姓；现在给的是合法字段全集，模型看不出错在哪。

拒绝的载荷不再带全目录（现在每次约 5 KB）。全目录在 setup 开始时进一次系统提示：28 个职业各带必需技能与信用范围，79 个技能名带中文标签，约 3 KB，一次性。

## 8. RPC 面

保留方法名以减小改动面；语义改成 patch。

| 方法 | 作用 | 变化 |
|---|---|---|
| `setup.draft {campaign, profile, numbers?}` | 第一次画卡 | 只在没有 card 时生成数字；有 card 时等价于 `revise`。`numbers` 是玩家档案里明写的数，进钉子。 |
| `setup.revise {campaign, revision, profile?, numbers?, limits?}` | 改卡 | 替代 `setup.override`（保留别名一版）。`profile` 浅合并；`numbers` 写钉子；`limits` 放宽。返回 `{card, applied, ignored, notes}`。 |
| `setup.reroll {campaign, revision, keep_pins?: true}` | 重掷 | 唯一会重新生成属性的调用；玩家明确要求才用。 |
| `setup.confirm {campaign, revision}` | 确认 | 见 §9。 |
| `setup.note` | 引导包槽位 | 不变。 |
| `setup.previewed` | 删除 | 见 §9。 |

模型侧 `setup` 工具的 step：`create-investigator`（首画）、`revise`（改字或改数，替代 `adjust`）、`reroll`、`confirm-investigator`、`note`。步骤表里 `create-investigator` 只做一次，之后不再 un-book / re-book；`confirm-investigator` 的前置是「有 card」，由内核判。

`revise` 的结果只回改动摘要和 `budget`，不回整张 sheet；卡片由宿主从当前 revision 画。这样模型每回合的载荷从 3 KB 降到几百字节。

## 9. 确认：一道闸，一个按钮

- 卡片右上角一个按钮「确认，开桌」。点击走宿主冷内核调用 `setup.confirm {revision}`，成功后宿主接着调 `setup.complete` 并发 handoff，**不经过模型**。这条路径和现在的 `draft-override` 同构（`pi-backend` 9563 行）。
- 打字确认仍然可以：模型调 `confirm-investigator`，内核只查 `revision` 是当前的。`input_key` 同一条消息的规则保留（防止模型画卡和确认一气呵成），`previewed_revision` 删除：宿主每个 revision 都同步把卡追加到 transcript，这个事实由宿主保证，不需要内核再问一遍。
- `completeness` 只查 §6 的结构项。预算没花完不拦，卡上写着。
- 卡片顶上那行「回复以确认或描述修改」改成「点『确认，开桌』，或在下面说要改什么」。

## 10. 强度

玩家说「我要强」「这剧本极难，一个人跑」「让规则见鬼去」：模型调 `revise {limits: {skill_cap: 90, characteristic_max: 90, occupation_points: ×1.5, interest_points: ×1.5}}`，或直接 `revise {numbers: ...}` 时内核发现超上限，返回 `needs` 一句「超过创建上限 75，要放宽吗」，模型问一句，玩家点头就放宽。`limits.unlocked` 记在卡上，`budget.legal: false` 标记「非标准卡」，KP 开桌时胶囊里带这一行。§33 难度预设保持是战役级设置；setup 里不再新加入口，`limits` 就是那把旋钮。

## 11. 详细档案一次成卡

模型读档案时一次交出：`profile`（含 `aptitude` 从形容词来）+ `numbers`（档案里明写的数，若有）。内核按 §5 选方法。第一张卡就该是「像这个人」的，模型的说明只解释差在哪、怎么改。引导包（§26）的槽位读取不变：档案里能读到的槽一次记完，缺 trade 才问一句。

## 12. 卡片 UI

- **原地更新**：一局一张卡，revision 变了在原位置换内容，不再每个 revision 追加一张（龙薇二追加了 13 张）。
- 属性和技能格子可以直接改，钉过的格子有标记（小图钉），机器铺的是浅色。
- 两条预算条：职业点 spent/total、兴趣点 spent/total；没花完显示「还剩 N 点」和「自动铺平」按钮；超了显示红色和「已放宽」。
- 按钮：「确认，开桌」「改数字」（现有模态）「重掷」「自动铺平」。
- 「计算详情」保留。

## 13. 模型提示词

`prompts/setup.md` 现在 206 行，一半在教模型怎么躲校验。改后核心只剩：读人 → 一次交 `create-investigator` → 之后每句话对应一次 `revise`（字或数）→ 说清楚改了什么 → 等玩家点按钮或说确认。删除：八个技能的教条、预算必须花完的说明、「never answer a number with a draft」、「wait until displayed」、`manual.dropped` 的解释义务、限定 aptitude 只能在引导包下（改为：形容词就是 aptitude，谁都能给）。

## 14. 删除清单

- `previewed_revision` 与 `setup.previewed`、`draft-previewed` 宿主方法。
- `completeness` 的两条 unspent 项。
- `validateProfile` 的「eight distinct」「retain required」「cannot hold the full budget」三条拒绝。
- `carryManual`、`makeRoom`、`creation.manual` 的 carry 记录（钉子成为一等数据后不需要）。
- 扩展里 `create-investigator` 的 un-book / re-book。
- `setup.override` 改名 `setup.revise`（保留旧名一版）；`adjust` step 并入 `revise`。
- 拒绝载荷里的全目录。

## 15. 验收

用 `tests/play/driver.py` 的 setup 模式（包装 launcher `exec bin/pi-coc setup`）回放三段真实输入，做成夹具：

1. 韩渡：「我叫韩渡，跑长途货运的司机」→「机械师，现在就把卡写出来」→「确认」。
2. 龙薇：整段档案 → 「村规一个吧」→ 那段「相貌描述是错误的……」→ 卡上手改 DEX 90/APP 90 → 「确认」。
3. 戴维·奥尔：两句 → 「就这样，开桌」。

指标（每个脚本、两个模型各跑一遍：grok-4.6 按玩测规则，deepseek-v4.1-flash 是用户实际用的）：

| 指标 | 现状 | 目标 |
|---|---|---|
| 每个玩家回合 `draft/revise` 调用数 | 5 到 10 | ≤ 1 |
| 目录形状类拒绝 | 6 到 8 次/局 | 0 |
| 确认调用数 | 2 到 9，且常失败 | 1，且成功 |
| 玩家手改的数在之后任何 revision 被改回 | 每局 2 次 | 0 |
| 龙薇首张卡 APP / DEX | 35 / 50 | ≥ 70 / ≥ 70 |
| 一回合等待（deepseek flash） | 100 到 200 秒 | ≤ 45 秒 |

内核层：现有 `tests/kernel/test_setup_override.py`、`test_setup*.py` 改写为 card 语义；新增变异用例：删掉 `pins` 的优先级则「改名单后钉子被抹」用例必须红；删掉按钮的冷调用则「不经模型确认」用例必须红。

## 16. 切片与顺序

1. **内核 card 模型**：`drafts.ts` 重写为 profile/numbers/pins，`chargen.build` 拆成 `generate`（一次）与 `flow`（铺 soft 点）；宽容解析；completeness 收窄；confirm 单闸。约两天，含测试。
2. **扩展与提示词**：`setup` 工具 step 改为 revise/reroll，删 rebook，提示词重写，系统提示带目录。约一天。
3. **卡片 UI**：原地更新、钉子标记、预算条、按钮、确认冷调用。约一天半。
4. **验收回放**：三个夹具、两个模型、指标表。半天。
5. 契约新节 + §23.4/§26/§92/§96 修订标注，打包。

切片 1 与 3 可以并行（接口按 §4 §8 先定）。

## 17. 待拍板

1. **形容词直接进 aptitude，不再要求引导包在场。** 现契约 §23.4 说「核心产品从不让散文动属性，引导包才行」。这条要改：用 Quick Fire 数组是规则书方法，形容词只决定顺序。
2. **预算不再是闸。** 一张兴趣点剩 96 的卡可以开桌。KP 侧只在胶囊里看到「非标准卡」一行。
3. **确认按钮绕过模型。** 打字确认仍可用，但按钮是主路径；卡片提示语随之改。
