# 薄书成桌：让 KP 有路可走、有书可翻、RP 有回报

Status: proposed（2026-09-18；分支 claude/thin-book-play-20260918；待用户拍板后实现）
Parent: 无远端工单；落地时修订契约 §46/§90（读书与开场）、§32/§34（回合与检定）、§40（NPC 对白）。
Evidence: 玩家 Musen 2026-09-17/18 血色公路 24 回合记录（grok-4.6 low）与 book-4 的准备产物，见附录 A。

## Problem Statement

玩家报了四件事：进展缓慢、翻来覆去几句话；靠 RP 套话拿不到任何优势，「我骗他」和一段精心编的故事赔率一样；回复短、不回到点上；问加油站老板有没有诊所，KP 说没有，书里后面明明有。

核到的事实：

1. KP 手里这本 111 页的书只有 5 个节点（序幕 + 3 个 NPC）。全书索引读书 read-4 的读者产出了 21 节目录，但每行没写 `source_refs` 引用目录页，内核按规则整份拒绝，标为不可重试，之后没有任何东西再跑它。序幕没有通向下一场的关系，邻接读书也无从排队。KP 没有材料可以把玩家带去任何地方，只能在加油站原地转。
2. 「诊所？没有」是 KP 在图里查了三次查不到之后替 NPC 编的。玩家场外抗议两次后它才 `lookup kind=source` 翻原书，一翻就翻到凯利药店和布伦纳医生的家。提示词教了怎么用 source，没有说「图里没有不等于书里没有」，胶囊里也不告诉 KP 这本书还有哪些章节没读。
3. `resolve` 早就有 `modifiers.bonus_dice`（0–2）和 `difficulty`，这局 7 次社交检定全部 regular、奖励骰 0。工具描述里奖励骰的例子全是物理优势（同伴、工具、突袭），一个字没提说辞；收据和机制卡片也不显示奖励骰，玩家即使拿到了也看不见。
4. KP 回复 250–430 字并不短；「不到点上」是三个 NPC 的口头禅复读（「待不住」6/24 回合、「油加满」5、「加完就滚」4、「少废话」4），对玩家说辞本身没有回应。voice 车道拿到的是人物档案，不拿这个 NPC 之前说过什么；回合地板保证元素种类，不保证逐点回应。

根因排序：没材料（1）> 不翻书就否认（2）> RP 不进骰子也不上卡（3）> 复读（4）。前两条是准备管线和提示词的缺口，第三条是工具描述与收据的缺口，第四条一半是车道输入、一半是模型。

## Solution

四条，按收益排：

**A. 读书草稿被拒是修一轮，不是失败。** 内核对任何 purpose 的 `module.read.finish` 以 `invalid_params` 拒绝草稿时，读书服务把拒绝原文和 fix 写进 findings.json，同一阶段再跑一轮（今天只有 opening 有这一轮），一次为限。内核的索引拒绝要点名是哪几节缺引用，fix 说「给这几节补上观察过的目录页」，不再是「整份重写」。

**B. 开场就绪之后，机器替 KP 往前读。** 视觉读的书在开场发布后（以及 `setup.complete` 时）后台排两样读书：索引没建就排索引；索引在了，就排「开场邻接」的 detail 读书——包含开场页码的那一节、页码上紧接着的下一节，以及节名出现在开场场景文本里的节。以后每次 `apply move` 换场，在既有的出口邻接之外，也排页码上的下一节。胶囊里给 KP 一份紧凑的书目：每节名字、页码、读没读，≤512 字。KP 从此知道书里有什么、什么还没读。

**C. 图外事物先翻书；说辞进骰子并上卡。** 提示词加一条：玩家问到图里没有的人、地、事，先 `lookup kind=source`，读的时候 NPC 可以拖、可以含糊，永远不替书说「没有」；否认只能来自书。`resolve.modifiers` 加 `reason`（一句话：小说里什么换来了这个修正），给了奖励骰/惩罚骰/难度就必须写；描述里补社交条款：说辞具体、贴这个 NPC 想要或害怕的东西、给了他一个理由——一颗；他本来就信这个人、谎言有眼前的东西撑着——两颗；「我骗他」后面什么都没有——零颗。内核把 `reason` 写进掷骰收据（`modifier_reason`），机制卡片画出「奖励骰 +1 · 因为……」。叙事审计加一条义务：玩家这回合说的每个问题，要么被回答，要么被角色化地回避，要么被有理由地拒绝。

**D. NPC 不复读。** voice 车道的包里带这个 NPC 在本局已说过的最近若干句（来自 npc-journal），指令：已说过的话不再说；同一件事第二次被追问，人要动——给一点、拒得更狠、或换话题。宿主在审计前做一个结构检查：`{{say}}` 里一句与同一 NPC 本局任一旧句有 ≥12 个连续字符相同，判「复读」，打回重写。这不是语义判断，是逐字比对。

目标（在 Musen 那局的输入上重放，grok-4.6 low）：开桌后 5 分钟内 book-4 有索引且序幕后一节已读；问「有没有诊所」第一次就从书答；带故事的社交检定卡片上有奖励骰和原因；24 回合内没有一句 NPC 台词重复；任意连续 3 个玩家回合内至少出现一个新地点、新线索或新 NPC。

## User Stories

1. 作为玩家，我问镇上有没有诊所，我想听到书里写的答案（或者「他得想想」），而不是 KP 替书说没有。
2. 作为玩家，我花心思编了一个让老板同情我的故事，我想看到卡片上写着「奖励骰 +1：伤心女大学生的故事让他心软」，知道 RP 起了作用。
3. 作为玩家，我连着几个回合跟同一个人磨，我不想第三次听到「油加满赶紧走」，他要么松口要么赶我。
4. 作为玩家，我想在加油站之外还有地方可去，KP 知道镇上有杂货店、医生家、山脊路，而不是等我撞墙。
5. 作为主持人，我翻书的时候想知道这本书还剩哪些章节没读，好知道往哪翻。

## Implementation Decisions

- A 在 `extensions/module/reading-service.ts`：`openingFinishSemanticRejection` 放宽为「任何 purpose 的 finish `invalid_params`」，`finishRepairUsed` 一次为限；`kernel-ts/modules/reading.ts` `finishIndex` 的拒绝带 `details.sections`（缺引用的节名），fix 文案点名补 `source_refs`。
- B 在 `kernel-ts/modules/reading.ts` 发布 opening 与 index 之后各挂一个 `queueAheadReading(mid, scene)`：按 `sections.json` 的页码排序，取包含场景 `source_refs` 页的那一节及其下一节，加上节名出现在场景 `exit_conditions`/`entry_landmarks`/`summary` 里的节；每节一个 `detail` 请求，focus 用节名，foreground false。`apply move` 的 `queueAdjacentReading` 之后同样调用。胶囊 `reading` 段在 `kernel-ts/read/assemble.ts` 加 `sections: [{name, pages, read}]`，预算 512。
- C：`prompts/keeper.md` Source reading 段加图外先翻书条款；`extensions/kernel/tools.ts` `modifiers` 加 `reason` 并补社交描述；内核 `resolve` 校验：有修正无 `reason` → `needs`；`kernel-ts/resolve/arithmetic.ts` 收据加 `modifier_reason`；`pipicoc/mechanics.js` 骰子行画修正与原因；界面字 `Bonus die`/`Penalty die`/`because` 走 ui-words 车道；`mods/narration-audit/auditor.md` 加「逐问回应」义务（版本号升）。
- D：`kernel-ts/voice` 的 packet 加 `said`（npc-journal 里该 NPC 最近 8 句）；`extensions/npc-voice` 指令文件加不复读条款；`extensions/kernel` 交付前钩子做 `{{say}}` 逐字比对，命中即 `needs` 打回，收据记 `repeated_line`。
- 不改模型、不改思考强度；低思考强度对第 4 条有贡献，作为旋钮写在附录，由用户决定。

## Testing Decisions

- 内核：索引草稿缺引用 → 拒绝点名节；opening 发布后队列里有邻接 detail 任务；胶囊带 sections；resolve 带 bonus 无 reason → needs，有 reason → 收据 `modifier_reason`；voice.job 包里有 `said`；交付钩子逐字比对命中。每条配一个能被变异测试杀死的用例。
- 扩展：finish 拒绝（purpose index）给一轮修补（fake-kernel）；mechanics 卡片渲染奖励骰行（vitest）。
- 真桌：用 driver.py 以 Musen 的 24 句输入当玩家脚本、grok-4.6 low 当 KP 重放 book-4，对照上面五条目标；最后由真人再玩一局验收。

## Out of Scope

- 模型选择与新会话默认模型（gemini 对档案回 MALFORMED_FUNCTION_CALL 是另一条）。
- 全书一次读完；仍是边玩边读，只是机器先走一步。
- 用关键词判断「说辞好不好」——好坏由 KP 判，规则只要求它写出理由并让玩家看见。

## Further Notes

- 与 §46/§90 的关系：B 不改变就绪判定，只在就绪之后补材料；A 不放松校验，只把校验结果还给读者。
- 复读比对用逐字连续字符，不做同义判断；阈值 12 个字符是初值，附录记录为什么。

## 附录 A：证据

- 会话：`ui-sessions/play/.../2026-09-18T05-29-47-241Z_b4984ef8-*.jsonl`（含 09-17 08:51 那份的 20 回合）。模型 grok-4.6。
- book-4：`generations/generation-3-*/module-graph.json` 5 节点；`deepen-queue.json` read-4 `index` failed，detail「unseen navigation ranges need an observed source reference」，attempts 1；`work/read-4/attempt-1/draft.json` 21 节、观察 34 页、行上无 `source_refs`。
- 诊所：回合 12 KP 三次 `lookup kind=module` 后 NPC 说「诊所？没有」；回合 13、14 玩家 OOC 抗议后 `lookup kind=source`，答出凯利药店与布伦纳医生的家（主干道东段、周一到周四应诊、急诊 EM6-4128）。
- 检定：回合 2、12、13、14 共 7 次掷骰全为 `difficulty: regular, bonus: 0`（回合 14 一次 hard）；所有 `resolve` 调用无 `modifiers`。
- 复读：24 回合中 NPC 台词含「待不住」6、「油加满」5、「嗯哼」5、「加完就滚」4、「少废话」4。
- 长度：玩家每回合 2–195 字（首回合档案 3606），KP 每回合 114–500 字，三回合为 0（纯工具回合）。
