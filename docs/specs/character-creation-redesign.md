# 建卡重设计：一张卡、两种改动、一道闸

Status: implemented on branch claude/character-creation-redesign-20260917（2026-09-17；契约 §97；用户拍板 §17 三项：形容词直接定属性顺序、预算不再是闸、确认按钮绕过模型）
Parent: 无远端工单；契约落地为 `docs/kernel-rpc.md` §97，修订 §23.4、§26（setup 部分）、§92、§96。
Evidence: 2026-09-16/17 血色公路五局建卡记录，见附录 A。

## Problem Statement

玩家在建卡阶段遇到三件事：

1. 给了一份详细的人物档案，出来的卡不像这个人。「天仙级容貌、以敏捷闪避见长的 S 级杀手」拿到 APP 35、DEX 50，因为属性只能是玩家自己骰子里的数，「强」只是把最好的那个骰子挪过去。
2. 改数字要等很久，而且改完会被改回去。玩家在卡上手改 DEX 90、APP 90 两次，两次都被下一张卡抹掉，卡上没有任何一句话说明。
3. 用一句话只改一个技能、一件装备、一处外貌，也要等 100 到 200 秒。每一句话都让模型重交整份档案，档案有五种形状校验（职业必须命中 28 个英文 id、职业技能恰好 8 个且含必需项、兴趣技能必须把预算花到恰好为零、武器必须是表里印的、字段名必须全对），错一次退一份 5 KB 目录让模型重猜，一个「修车工」要猜 7 到 10 次。确认前还有三道闸，闸没过模型唯一会做的就是再画一张卡。

根因是三件该分开的事绑成了一个 draft：语义（是谁、干什么、带什么）、目录映射（职业、技能、武器对表）、数字（属性、点数、信用）。改任何一样都要过全部校验、重算全部数字、再过全部闸。数字有两个主人（分配器与玩家），确认让模型去撞闸。§92、§93、§96 是 24 小时内对同一后果的三次补丁。

## Solution

卡是一份可 patch 的文档，字改字、数改数。数字只在第一次生成，之后就是卡上的数；玩家或模型定下的数是钉子，机器铺的点让位。预算是卡上的报告，不是闸。目录映射由内核做，对不上给候选不给目录。确认是卡上一个按钮，走宿主直接调内核，不经模型；打字确认只查是不是当前这张卡。玩家的形容词决定属性的高低顺序（规则书 Quick Fire 数组），档案里明写的数字直接成为钉子。玩家一句「我要强」就是放宽上限，卡标记为非标准卡。

目标：每个玩家回合最多一次画卡调用、零次形状类拒绝、一次确认成功、玩家手改的数永不回退、龙薇首张卡 APP 与 DEX 都不低于 70、一回合等待在 deepseek-v4.1-flash 上 45 秒以内。

## User Stories

1. 作为玩家，我贴一份完整的人物档案，我想第一张卡就是这个人（职业、外貌、装备、武器、强项与弱项都对得上），这样我不用一处一处纠正。
2. 作为玩家，我说「她很美、身手极快」，我想卡上的容貌和敏捷就是最高的两项，这样卡符合我脑子里的人。
3. 作为玩家，我档案里写了「敏捷 90」，我想卡上就是 90，这样我不用再改一遍。
4. 作为玩家，我说「主武器是武士刀，用吉他箱装着」，我想武士刀进武器栏、吉他箱进装备，其余什么都不变，这样一句话只改一处。
5. 作为玩家，我说「不是汽车，是哈雷摩托」，我想装备里换掉那一项、技能名单里换成骑摩托，属性和别的技能数一个都不动。
6. 作为玩家，我在卡上把 DEX 改成 90 并保存，我想它从此就是 90，之后不管我再说什么它都不变，这样我不用反复改。
7. 作为玩家，我改了一个技能的数，我想别的技能数不要跟着乱跳，只有超预算时机器铺的点才让位，这样卡是稳定的。
8. 作为玩家，我把预算上限放宽了但没花完，我想仍然能开桌，卡上写着还剩多少点，这样我不被一个「不完整」拦住。
9. 作为玩家，我想在卡上点一下「确认，开桌」就开桌，不用打字、不用等模型回话，这样确认不会失败。
10. 作为玩家，我打字说「确认」，我想它一次就成，这样不会像现在等两分钟看到一张重画的卡。
11. 作为玩家，我说「我要强，这剧本极难」，我想上限放开、点数加多，卡上标着非标准，这样我能按自己想要的强度玩。
12. 作为玩家，我说的职业书里没有（修车工、杀手），我想被告知最接近的两三个，选一个或让主持人定，我的原话留在卡上，这样职业不是被悄悄换掉的。
13. 作为玩家，我用中文说技能名（侦查、闪避），我想它直接对上，这样不用知道英文名。
14. 作为玩家，我想每一句话之后等待不超过一次模型回复的时间，这样建卡不是折磨。
15. 作为玩家，我想一局只有一张卡在原地更新，不是十三张卡排下来，这样我知道哪张是现在的。
16. 作为玩家，我想看到哪些数是我定的、哪些是机器铺的，这样我知道改动会影响什么。
17. 作为玩家，我想看到两条预算条（职业点、兴趣点）和剩余点数，有一键铺平，这样没花完的点不浪费。
18. 作为玩家，我想要重掷时说一声就重掷，不说就永远不重掷，这样属性不会在我不知情时变。
19. 作为玩家，我用引导包时想只被问我没说过的槽位，档案里已经有的一次记完，这样不重复回答。
20. 作为主持模型，我想每次改动只交改动的字段，收回一段摘要和预算报告，这样每回合载荷小、不需要重交整份档案。
21. 作为主持模型，我想任何拒绝都指名道姓说错在哪个键、给三个以内候选，这样一次就能改对。
22. 作为主持模型，我想永远不需要为了过闸重画一张卡，这样我不会抹掉玩家的数。
23. 作为守秘人，我想开桌时胶囊里有一行「非标准卡：上限放宽」，这样我知道这桌的强度。
24. 作为开发者，我想内核层的规则用 pytest 打真内核验证，变异用例能杀死「钉子被抹」和「确认绕不过模型」，这样修补不再靠真桌撞。
25. 作为开发者，我想用 driver 回放三段真实输入并量出调用数、拒绝数、等待秒，这样验收有数。

## Implementation Decisions

**卡是一份文档。** 一局一份 card，按 revision 递增，每个 revision 一个文件。card 含 `profile`（语义，全部可 patch）、`sheet`（现有卡片形状，是 numbers 的载体：characteristics、skills、credit_rating、derived、finance）、`pins`（谁定的数：`{characteristics: {abbr: {value, by}}, skills: {name: {value, by}}, credit_rating?}`，`by ∈ {player, model}`）、`limits`（上限与已放宽项）、`budget`（报告：两个池的 total/spent/unspent、`legal`、`notes[]`）、`generation`（首次生成的追溯，只写一次）。`sheet` 继续是 party 卡的来源，「引擎权威、卡片镜像」不变，引擎从「分配器每次重算」变成「card 的数」。

**数字只生成一次。** 首次画卡按玩家给了什么选规则书方法：什么都没说走骰子按表序；给了形容词（aptitude）走 Quick Fire 数组按优先级排（strong 依次拿最高，未提的按表序拿中间，weak 拿最低）；给了明确数字走 point-buy 加钉子。年龄调整、幸运、派生值只在生成时算一次；之后改属性只重算派生值。aptitude 不再要求引导包在场；`origin: concept` 的 1 强 1 弱上限保留。重掷是显式调用，默认保留钉子。

**钉子优先，铺点让位，铺点粘着。** 职业技能名单由模型给 0 到 8 个，内核用职业必需项补齐到 8（短语类必需项取名单里已有的一项，否则取短语第一项），结果回报补了什么。职业点与兴趣点按现有分层策略铺到 soft 格子；铺不完进 `unspent`，不拒。之后：名单变了，钉子不动，soft 分配从上一版继承，新格子只用剩余点铺，超预算时从最大的 soft 持有者往下走；数变了直接成钉子。信用超新职业范围记 note，不拒。carry 与 makeRoom 删除，钉子是一等数据。

**completeness 只查结构。** 名字、职业 id、九个属性为整数、财务表可用、背景三项加 scenario_bound、母语、装备为数组。两条 unspent 项删除。

**目录映射内核做。** 名字按顺序解析：规范化精确匹配、本地化标签（技能与职业的标签表全覆盖）、专精身份。技能对不上：从名单去掉并回报 `unresolved` 带三个以内候选（候选是本地化标签的字面重叠，结构化查表）。职业对不上：`needs` 带候选，候选按「模型名单与各职业必需技能的交集大小」排序，交集为零给全部职业的本地化名单；模型的义务不变：说出来、给玩家选或委托，`occupation_stated` 留原话。武器：表里没印的自动落到装备，回报 `moved_to_equipment`。未知字段：拒，指名道姓。拒绝载荷不再带全目录；全目录在 setup 开始时进一次系统提示（职业带必需技能与信用范围，技能名带本地化标签）。

**RPC 面。** `setup.draft {campaign, profile, numbers?}` 只在没有 card 时生成数字，有 card 时等价于 revise。`setup.revise {campaign, revision?, profile?, numbers?, limits?}` 替代 override（旧名保留一版为别名）：profile 浅合并、numbers 写钉子、limits 放宽；返回 `{revision, applied, ignored, unresolved, notes, budget, sheet}`。`setup.reroll {campaign, keep_pins?}`。`setup.confirm {campaign, revision?}` 只查 revision 是当前的与同一条消息不能画卡又确认（input_key）；`previewed` 方法与闸删除。`setup.catalog {campaign}` 返回给系统提示用的紧凑目录。

**模型工具面。** `setup` 工具的 step：`create-investigator`（首画，只做一次）、`revise`（改字或改数，非表步骤，替代 `adjust`）、`reroll`、`confirm-investigator`、`note`。扩展里 create-investigator 的 un-book / re-book 删除。revise 的结果只回摘要与 budget；卡片由宿主从当前 revision 画。

**确认。** 卡片右上角「确认，开桌」按钮走宿主冷内核 `setup.confirm` 再 `setup.complete`，然后宿主向 setup 会话发一条合成消息让扩展按现有 finish 路径收尾并退出、由启动器自动进入 play；这一步模型只说一句收场，任何失败都不影响已确认的卡。打字确认走模型，一次成功。卡片提示语改为「点『确认，开桌』，或在下面说要改什么」。

**强度。** 玩家要强，模型调 `revise {limits}` 放宽；`revise {numbers}` 超上限时内核 `needs` 一句「超过创建上限，要放宽吗」，模型问一句。`limits.unlocked` 记在卡上，`budget.legal: false`，开桌胶囊带一行「非标准卡」。§33 难度预设保持是战役级设置。

**卡片。** 一局一张卡原地更新（旧 revision 的卡折成一行）。属性和技能格子可直接改，钉过的有图钉标记，机器铺的浅色。两条预算条，没花完显示剩余与「自动铺平」，超了显示「已放宽」。按钮：「确认，开桌」「改数字」「重掷」「自动铺平」。「计算详情」保留。

**提示词。** setup 提示词从 206 行收到核心：读人、一次交 create-investigator、之后每句话一次 revise、说清改了什么、等玩家点按钮或说确认。删除八个技能的教条、预算必须花完、never answer a number with a draft、wait until displayed、manual.dropped 的解释义务、aptitude 只能在引导包下。

## Testing Decisions

好的测试只看外部行为：RPC 的入参与出参、磁盘上的 card 文件、卡片渲染出的文字与按钮，不看内部函数。

**接缝（从高到低）。**
1. 内核 RPC：pytest 用 `RpcClient` 打 emitted kernel（现有 `tests/kernel/test_setup_*.py` 的接缝）。数字规则、目录解析、确认闸全在这一层验。变异用例：去掉钉子优先级则「改名单后钉子被抹」必须红；去掉 completeness 的收窄则「兴趣点剩 96 仍可确认」必须红；去掉候选则「修车工」必须红。
2. 扩展：`tests/extension/setup.test.mjs` 与假内核（现有接缝）。验工具面：revise 不重画、失败草稿不改记账、结果载荷只有摘要。
3. 卡片：vitest（现有 `CocCharacterDraft*.test.tsx`）。验一张卡原地更新、钉子标记、预算条、按钮调用的宿主方法名。
4. 真桌回放：`tests/play/driver.py` setup 模式回放三段真实输入（韩渡、龙薇档案、戴维·奥尔），grok-4.6 与 deepseek-v4.1-flash 各一遍，量表见附录 A 的目标列。

**先例。** `test_setup_override.py` 的 rebuild 与预算用例、`test_setup_drafts.py` 的 revision 与确认用例、`setup.test.mjs` 的 §92 adjust 与 §96 refused-draft 用例。

## Out of Scope

- 库存调查员（browse-library / load-investigator）流程不动。
- §33 难度预设的语义与设置面不动。
- 引导包（§26）的槽位机制不动，只是 aptitude 不再需要它在场。
- KP 在 play 阶段改卡（§92 提到的「开桌之后由守秘人接」）不在此。
- 远程网页版（另一份部署）。
- §82 那类「宿主空转但页面显示步骤仍在跑」的问题。

## Further Notes

- 契约新节 §97，标注 amends §23.4、§26、§92、§96；§编号不重排。
- 旧 `setting_up` 战役的草稿文件格式不迁移；重开一局。
- 打包只到 `~/leehow/code/pipicoc-build/PipiCOC.app`。
- 附录 A 是现状实测，附录 B 是数据结构与规则细节。

## 附录 A：现状实测与目标

五局的 setup 阶段，模型都是 deepseek-v4.1-flash（thinking low），单次模型调用 10 到 40 秒。

| 局 | 玩家那一句 | 等待秒 | 模型调用 | 画卡次数 | 被拒次数 |
|---|---|---|---|---|---|
| 韩渡 | 「机械师，现在就把卡写出来」 | 105 | 10 | 7 | 6 |
| 戴维·奥尔 | 「都点名找我，现在就做卡」 | 198 | 12 | 10 | 8 |
| 龙薇 一 | 「就这样吧，我们开始」 | 42 | 5 | 1 | 3 |
| 龙薇 二 | 「确认」（手改数字后照卡片提示打的） | 101 / 111 | 10 / 8 | 4 / 4 | 5 / 2 |

玩家手改数字的下场：

| 局 | 玩家保存 | 下一次画卡 | 结果 |
|---|---|---|---|
| 龙薇 一 | rev 2 DEX 90 / APP 90 / 信用 65 | rev 3 | DEX 55 / APP 40 / 信用 5，无记录 |
| 龙薇 一 | rev 7 DEX 90 / APP 90 / 闪避 85 | rev 8 | 同上 |
| 龙薇 二 | rev 6 DEX 90 / APP 85 | rev 7 | 回到骰子 |
| 龙薇 二 | rev 9 DEX 90 / APP 90 | rev 11 | `carried: {}`，8 项 dropped「预算超了」 |

链条：玩家放宽预算上限但没花完（rev 6 职业点剩 80、兴趣点剩 96）→ completeness 判不完整 → 确认被拒 → 模型重画 → 重画从种子重算 → 玩家的数没了。

目标：

| 指标 | 现状 | 目标 |
|---|---|---|
| 每个玩家回合 draft/revise 调用数 | 5 到 10 | ≤ 1 |
| 目录形状类拒绝 | 6 到 8 次/局 | 0 |
| 确认调用数 | 2 到 9，且常失败 | 1，且成功 |
| 玩家手改的数在之后任何 revision 被改回 | 每局 2 次 | 0 |
| 龙薇首张卡 APP / DEX | 35 / 50 | ≥ 70 / ≥ 70 |
| 一回合等待（deepseek flash） | 100 到 200 秒 | ≤ 45 秒 |

## 附录 B：数据结构与规则细节

```
card {
  revision, seed,
  profile { name, occupation, occupation_stated, age, sex, concept, era, own_language,
            backstory{...}, key_connection, equipment[], weapons[],
            occupation_skills[], interest_skills[], aptitude {strong[], weak[], origin} },
  sheet   { ...现有形状；characteristics / skills / credit_rating 就是 numbers },
  pins    { characteristics {abbr: {value, by}}, skills {name: {value, by}}, credit_rating? {value, by} },
  limits  { characteristic_min, characteristic_max, skill_cap, occupation_points, interest_points, unlocked[] },
  budget  { occupation {total, spent, unspent}, interest {total, spent, unspent}, legal, notes[] },
  generation { method: rolled_in_order | quick_fire | point_buy, rolls?, array?, assignment? },
  creation { ...现有 trace，给「计算详情」 }
}
```

生成方法选择：`numbers.characteristics` 非空 → point_buy（钉子照钉，其余按 quick-fire 优先级填，总分超 460 或超 90 记 note 并要求放宽）；否则 `aptitude` 非空 → quick_fire 按优先级；否则 rolled_in_order。

Quick Fire 数组 40 50 50 50 60 60 70 80：strong 按列出顺序拿最高，weak 按列出顺序拿最低，其余按表序拿中间。

铺点：职业名单 = 模型给的 + 必需项补齐到 8；职业点 = 公式 − 信用；按现有 spread 分层铺到非钉子格子；兴趣同理。revise 后：soft 分配继承上一版（仍在名单内的），新格子只用 unspent 铺，超预算时 soft 从最大持有者往下走到刚好为止；钉子永远不动。

拒绝：`needs` 只带 `details.field`、`details.candidates`（≤3）、`details.unlock?`；`invalid_params` 带 `details.unknown[]`。

确认：`confirm {campaign, revision?}`：revision 缺省为当前；不是当前 → `stale_draft`；与画卡同一条消息 → `confirmation_required`；结构 completeness 不过 → `needs` 列出缺项；其余写 party 卡、`confirmed_revision`、receipts。
