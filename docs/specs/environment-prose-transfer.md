# 环境文笔转移：2.2.1 应用与验证报告

## 结论先行

2.2.1 已作为可兼容的 `narration-craft` Mod 安装到当前 PipiCOC App 的可写 Mod 库，并在 App 内核的新战役兼容性检查中默认选中。五个最终版 driver 真桌回合中，可观察到它把把环境写成玩家可观察、可等待、可行动的现场：第 3 回合完成从办公室到宅邸的移动并交付街面观察，第 4 回合允许半分钟的安静等待而不强行制造事件，第 5 回合落实“只推门、锁住就停”的边界。这个结果支持“环境与节奏指导已经接入并在有限样本中可见”，不支持“文笔质量已被证明提升”，更不支持小说级质量承诺。

证据是五个真实最终版回合，本主会话作为唯一玩家使用 Flapcode `gpt-6-luna low`；所有观测到的模型行均为 Luna，没有 Astra。此前 2.1.18 基线只有四回合中的两回合交付，2.2.0 开发运行还出现过 reasoning 文本泄漏，因此不能构成可靠的成对 A/B 比较。本文把观察、推断利益和尚未验收的部分分开。

## 文学研究带来的可转移贡献

[《文笔与环境张力总报告》](</Users/haoli/Documents/TRPG/小说/文笔研究-20261003/文笔与环境张力总报告.md>)的价值不在模仿任何作者，而在把环境张力拆成可主持的关系：站位与可见对象，身体或材料造成的限制，行动尝试，环境反馈，以及仍未决的结果。研究比较的样本是两部小说各 27 张场景卡、48 个分散来源窗口和 6 个开场补充窗口；这是有边界的连续样本，不是全书统计，也不是穷尽覆盖。

它对运行时的主要启发有三点。第一，先交代玩家在哪里、看得到什么、路线和障碍在哪里，再让材料改变选择：门、干叶、湿泥、重量或声音应当成为行动条件，而非只堆形容词。第二，把事实、观察、转述和推断分层；普通物件可以只是普通物件，等待可以没有事件，危险也应通过身体、房间和时间推进，而不是每段末尾自动加一个阴影。第三，节奏跟随动作、检查和等待：完成玩家声明的动作，停在第一个结果、障碍或未选择的分叉处，把下一步交还玩家。这些原则与 [agent 指导](../../mods/narration-craft/agent.md)、[brief 提醒](../../mods/narration-craft/brief.md) 和 [style.json](../../mods/narration-craft/style.json) 中的 `act-then-reply`、`one-focus`、`place-the-eye`、`carry-through`、`show-the-change` 相互对应。

## 2.2.1 实际改变了什么

这次升级不是改运行时代码，也不是重新构建编译产物，而是收紧和补足 Mod 契约。完整风格核大小为 **1987/2048 bytes**；较大的后续风格为 **1318/1536 bytes**；共享 briefs 为 **4973/5000 bytes**。2.2.1 让实际内核装配对齐的完整指令与受限 brief，并把环境写法明确为：以“你”承接玩家动作；按视点给出材料、路线和可行动事实；允许静默等待；只推进到首个结果或分叉；NPC 仍保留自己的知识、语气、感受与 agency，而不会因为职业或固定口头禅自动回答。


2.2.1 还明确了源事实边界：文本可以写出玩家看见或已由 receipt 落定的东西，但不能把 Keeper 的未核实补充变成书本事实，不能补玩家未作的选择，也不能以小说叙述者的全知替代玩家视角。没有作者原句写入运行时，也没有做精确作者模仿。

## 最终回合中的可观察结果

- [0003.json](</Users/haoli/Documents/TRPG/小说/文笔研究-20261003/implementation-20261003/live-evidence/.coc/campaigns/environment-prose-v221-20261003/turns/0003.json>) 有实际 `move` receipt；文字沿街到达宅邸，写出“外墙在日光下显得灰白而失去光泽”“大门紧闭，门上的漆已经剥落”，并把观察推进到一楼钉死的窗户。这里环境不仅营造气氛，还提供下一步可核验的对象。
- 同一回合出现“侧门上还装着三道插销和两把锁”。这在运行记录中是已交付的观察，但本报告不把它自动升级为独立接受的书本事实：从街道能否看清侧门内侧的全部插销，证据并未独立确认。来源/可见性问题应保留不确定性；侧门内部闩具不能仅凭 Keeper 的叙述当成已验收的原作事实。
- [0004.json](</Users/haoli/Documents/TRPG/小说/文笔研究-20261003/implementation-20261003/live-evidence/.coc/campaigns/environment-prose-v221-20261003/turns/0004.json>) 记录 1 分钟时间 receipt。生成文字把声音分层为“远处车轮碾过潮湿路面”“办公楼里传来模糊的人声”“近处偶尔有脚步经过”，没有添加撞门、敲击或新线索。这是研究中“安静可以只是安静”的一个小而清楚的应用。
- [0005.json](</Users/haoli/Documents/TRPG/小说/文笔研究-20261003/implementation-20261003/live-evidence/.coc/campaigns/environment-prose-v221-20261003/turns/0005.json>) 只写玩家选择的推门： “门板纹丝不动，门锁在里面发出沉闷的卡响。”随后明确“你没有继续用力，也没有碰工具”，停在锁住这一结果，没有替玩家撬门、撞门或强行进入。这是动作边界、物质反馈和节奏交接同时成立的例子。

需要特别记录第 2 回合的反例：[live-summary.json](</Users/haoli/Documents/TRPG/小说/文笔研究-20261003/implementation-20261003/live-summary.json>) 显示玩家没有选择拿地址纸，action guard 因而拒绝了整批领取、移动和付款，Keeper 改为再次请求接受。它保护了 agency，但也说明契约层和自然语言意图之间仍可能出现摩擦；不能把“玩家说要去”直接等同于“玩家已拿走全部物品”。

## 验证范围与限制

[final-focused-checks.log](</Users/haoli/Documents/TRPG/小说/文笔研究-20261003/implementation-20261003/final-focused-checks.log>) 显示 39 个 focused Node-24 测试全部通过，包含真实 kernel、legacy 与 hybrid-v1 两种引擎的 deterministic-provider request capture、风格预算、玩家 agency、mood、源/可见性相关契约。这是结构、接线和边界证据，不是文学实机评分。原作者 drafts 已经过 scope/budget 检查，root 已恢复，边界得到保留。

[app-installation.json](</Users/haoli/Documents/TRPG/小说/文笔研究-20261003/implementation-20261003/app-installation.json>) 证明通过普通 `mods.install` 安装 2.2.1，兼容性为 true、默认启用；[app-default-proof.json](</Users/haoli/Documents/TRPG/小说/文笔研究-20261003/implementation-20261003/app-default-proof.json>) 证明 App 自身 kernel 默认选中了 2.2.1。App 内置的文笔包仍是 2.1.17，App 没有重建，也没有 GUI 测试；不可把已有 compiled output 称为新的 exact-source build。LAN box 忙碌，所以没有跑完整 suite，也没有 fresh build。运行时代码未改动，最终 Mod 包是在现有 compiled runtime 与已安装 App 自有 kernel 上测试的。

当前验收仍缺少危机段、长会话、结局、失败与多人场景，也没有受控 paired A/B 或可靠的量化改善测量。例行的阴郁段落收尾仍可能出现；视角不充分时的不可见细节风险仍在。五回合只证明有限的“现场—等待—动作结果”链条，不能代表全局稳定性或完整源忠实度。

## 交付与后续边界

既有保存战役锁没有改变；升级沿普通 `mods.configure`/Mod panel 的安全边界进行。外部 [live-evidence 目录](</Users/haoli/Documents/TRPG/小说/文笔研究-20261003/implementation-20261003/live-evidence/>) 中的 campaign、run、telemetry 证据已从临时 worktree **完整移动**，不是删除；元数据里的旧绝对 origin path 只保留历史 provenance。最新 source branch 只接收本次 scoped package、contract 与 checks。后续若要提高置信度，应补做受控 paired runs、来源可见性人工复核、长会话和结局验收；在此之前，最准确的结论是：2.2.1 已成功安装并在有限实机中表现出更清晰的环境定位、安静等待与玩家边界保护，但其收益是条件性、观察性的，尚未成为统计或文学质量结论。
