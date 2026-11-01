# 战役建好之后、开桌之前改开场

Status: needs-triage

来源：§14.19.11 的第 4 条（`docs/kernel-rpc.md`，2026-11-01，live7 1101）。§14.19.11 的另外三条已经落地：玩家先选、建战役前可以改选、候选带序号，见提交 `84b14ea35`。还缺的一件是战役建好以后改开场，因为这需要一个内核方法，所以单独开票，内核部分不在宿主修复里做。

## 现象

一本书有多个开场。玩家选了开场 A，`create-campaign` 按 A 建了战役。之后、`complete` 之前，玩家改口想从 B 开始。现在的宿主会回 `opening_already_bound`（附 `player_reason`："这张桌已经按先前选的开场建好，要换开场就另开一张桌"），什么都不改。

live7 那四桌（du-1101a-gksevr、du-1101b-mmsev、cs-1101b-gksev、cs-1101b-mmsev）卡住的就是这一点。§14.19.11 修好以后，守秘人不能再抢在玩家回答之前替玩家选开场，所以这一点只剩下"玩家自己改主意"这一种情况会碰到。证据：`/Users/haoli/leehow/code/kp-translate-only/opening-names-1101.md`。

## 为什么宿主做不了

开场在三个地方被内核固定：

- `campaign.json` 的 `opening_scene`：由 `campaign.create` 写入（`kernel-ts/write/index.ts`）。之后 `startSetupWorld` 只在世界还没写出来时才读它；开场一旦有值、世界也已存在，就不再重算。
- `guidance_key`：建战役时钉住的那份已审 guidance 是为 A 写的；如果拿它配 B，`campaign.create` 会以 `guidance_scene_mismatch` 拒绝。
- `world.json`：开场在建战役时就已就绪的话，`initialWorld` 已经把队伍放在 A。

`module.opening.choose {campaign}` 只改战役 fork 里的 `opening_choice`，不碰上面三处。

## 和 anchor 线的关系

anchor worktree（`chatrpgv4-wt-v4-anchor`，章节定位）正在重做"战役 fork 里的 `opening_choice`"：`kernel-ts/modules/opening-choice.ts` 是新文件，`reading.ts` 的 `chooseOpening` 也在改。本票的内核方法要等那条线合入后，在它的 fork 语义上做，不能另起一套。

## 要做的（待评估）

1. 契约先行：在 `docs/kernel-rpc.md` 新开一节，定义一个由战役限定的改开场方法（名字待定，比如 `campaign.opening.rechoose {campaign, scene}`）。
   - 前置条件：战役处于 `setting_up`；还没有 `complete`，也没有 `table.open`；没有已提交的回合。
   - 效果：
     - 用 `resolveStartScene` 校验 `scene`，不合法就以 `needs_choice` 拒绝，附 `candidates`；
     - 改写 `campaign.json` 的 `opening_scene`；
     - 清掉 `guidance_key`，由宿主重新准备 guidance；
     - 世界如果已经写出，按新开场重新执行 `initialWorld`，或者删掉世界，让 `startSetupWorld` 到 `complete` 时重建，两种做法选一种；
     - 战役 fork 的 `opening_choice` 与之同步；
     - 草稿卡和 brief 保留不动。
   - 拒绝：已开桌，或已有回合，以 `campaign_not_ready` 或新码拒绝，并说明原因。
2. 宿主：
   - `openingAuthority` 遇到 `opening_already_bound` 的情况时，改为调用这个方法，再重新准备 guidance，然后在后台预读新开场；
   - 仍然只接受晚于提问的那条玩家输入，规则同 §14.19.11 第 2 条；
   - 已经展示过的旧 prologue 怎么处理要先定：`setup.prologue` 现在是先写者胜。
3. 测试：
   - 真内核上：建战役，改开场，然后 `complete` 和 `table.open` 都落在新开场；
   - 开桌之后再改，被拒绝；
   - 宿主层面：替换掉 `opening_already_bound` 用例的期望。

## 待 owner 定的

- 开场就绪时已经写出的世界，是重新写一遍，还是删掉留到 `complete` 时重建。
- 已经展示的 prologue（先写者胜）：允许覆盖，还是给新开场另开一条记录。
- 是否值得做：§14.19.11 修好以后，这只剩玩家主动改主意这一种情况，而"另开一张桌"本身就能解决。

## Comments
