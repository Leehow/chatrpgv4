# Keeper narrative quality ticket plan

父规格：[keeper-narrative-quality.md](keeper-narrative-quality.md)，发布为父票 [#68](https://github.com/Leehow/chatrpgv4/issues/68)。拆法依据规格末节 D1 到 D5 的决定；2026-09-10 用户批准后，11 张子票按依赖序建在 #68 下，阻塞关系用 GitHub 原生 blocked-by，父子关系用原生 sub-issue。

状态：**已拆票，未开工**。实现与验收都还没有发生；这里没有任何一票可以凭"spec 写好了"算完成。

## 实现进度

- 2026-09-10：用户授权"尽管做"，Claude 主会话任 lead。集成分支 `claude/keeper-narrative-quality`，从 `0.9.2a@baf1b818` 开出。#69 契约（636fdb6d）、#70 内核升级语义与两条回归测试（3e435655）、#71 文本图（077968e2）、#72 底层提示词（5c51cf0a）、#73 Keeper Pacing 1.1.0（c3be075c）、#74 Story Thread 1.0.2（1d4aef30）、#75 Narration Craft 1.1.0（e2158178）全部合入；lead 另补一笔把三份 brief 修回 4000 字节上限并改英文桌的轴计数（6eac940e）。
- 集成树验证：`check:kernel` 通过；`pytest tests/kernel tests/play` 1138 通过 1 跳过（17 分 18 秒，单进程）；`npm run test:ext` 通过。激活证据与对读记录在集成 worktree 的 `.coc/playtests/knq-activation-20260910/`。
- 派工注意：Agent 工具自带的隔离 worktree 落在过期基底（3297356b），五张票在 lead 自建的 worktree 上重派；三张票因此各有一份等价的冗余提交未合入（见 `integration.md`）。模型按表：#70 Fable，#72/#73/#75 Opus，#71/#74 Sonnet。
- #76 完成：候选 App 在独立 worktree `chatrpgv4-wt-knq-package/build/PipiCOC.app` 构建并签名（同一提交 1c0865a7），未安装，因为正式 App 全程在运行。
- #77 完成：`knq-live-1`，建卡 6 回合、游玩 22 回合，Grok 4.6 low 当守秘人，主会话当玩家，一句一回合。全部要求的玩法种类都覆盖到；在钉死的柜子前以六次失败的 STR 真阻断收场，没有到结局。报告在集成 worktree `.coc/playtests/knq-live-1-play/report.md`。系统类缺陷一条已立票 #80（活动场景内子地点的线索投影成 `next` 不是 `here`），守秘人判定两处（帮手的力气按调查员 STR 掷；书里白给的实物线索被反复掷骰门住）记在报告里。
- 未完成：App 安装（退出正式 App 后把候选包覆盖过去，保留旧包）；#78 盲评（可选诊断，未跑）；#79 真人门（需要没读过模组的人用真实界面）。集成分支尚未合入 `0.9.2a`：那棵共享检出上有别的会话的未提交改动，合并由用户在空闲时做。

## 11 张工单

### 契约

1. **[#69 契约先行，把 D1–D3 的形状写进 kernel-rpc](https://github.com/Leehow/chatrpgv4/issues/69)** — 前置：无 — 交付：§26 升级语义与遥测行、§13.6/§13.10 的六轴十一条与重算配方、§30.3 过期行重写、§30.11 卡住与流连的读法、新 §30.12 承载层次地图、包范围、底层提示词段落与那一回合的解剖。只有这一票碰契约文件。

### 实现（互不重叠的路径，可并行）

2. **[#70 Mod 升级跨过被删设置时内核退役旧键，不再拒绝](https://github.com/Leehow/chatrpgv4/issues/70)** — 前置：[#69](https://github.com/Leehow/chatrpgv4/issues/69) — 交付：版本变更且请求不带 settings 时只沿用新版本声明的键，写一行 `settings_retired` 遥测；显式未知键仍拒绝；回归测试照规格 D3 的复现写。
3. **[#71 底层风格六项退出文本图，节拍表与摘要同步](https://github.com/Leehow/chatrpgv4/issues/71)** — 前置：[#69](https://github.com/Leehow/chatrpgv4/issues/69) — 交付：三条轴六条 directive 离开文本图，manifest 用内核自己的 parsePythonJson 加 jsonDigest 重算，节拍表同步，两条英文行按 D1 表重写，capsule 测试的轴计数跟上。
4. **[#72 底层提示词写明什么是可玩的一回合](https://github.com/Leehow/chatrpgv4/issues/72)** — 前置：[#69](https://github.com/Leehow/chatrpgv4/issues/69) — 交付：keeper.md 新增"可玩的一回合"段，统一 ask 的两种说法；不新增任何把质量等同于篇幅、感官、问句或把手的句子。
5. **[#73 Keeper Pacing 1.1.0，停滞只是提示，恢复不再必有代价](https://github.com/Leehow/chatrpgv4/issues/73)** — 前置：[#69](https://github.com/Leehow/chatrpgv4/issues/69) — 交付：stalled_turns 改为看玩家的话判卡住还是流连；恢复段去掉"必有代价"，保留 Idea roll 与免费澄清；设置不变。
6. **[#74 Story Thread 1.0.2，线索链是机会不是清单](https://github.com/Leehow/chatrpgv4/issues/74)** — 前置：[#69](https://github.com/Leehow/chatrpgv4/issues/69) — 交付：机会语言替代"每回合据此规划"，结构语义不变。
7. **[#75 Narration Craft 1.1.0，去掉篇幅梯子，只留手艺](https://github.com/Leehow/chatrpgv4/issues/75)** — 前置：[#69](https://github.com/Leehow/chatrpgv4/issues/69)、[#70](https://github.com/Leehow/chatrpgv4/issues/70) — 交付：settings 清空，梯子与重复句删除，手艺段重写并加入选材、友好结局、一物多用、允许直述；brief、description、changelog（补 1.0.2）跟上；老战役靠 #70 才能用面板升上来。

### 集成与验收

8. **[#76 集成六张票，重建与重打包，记录激活证据](https://github.com/Leehow/chatrpgv4/issues/76)** — 前置：[#70](https://github.com/Leehow/chatrpgv4/issues/70)、[#71](https://github.com/Leehow/chatrpgv4/issues/71)、[#72](https://github.com/Leehow/chatrpgv4/issues/72)、[#73](https://github.com/Leehow/chatrpgv4/issues/73)、[#74](https://github.com/Leehow/chatrpgv4/issues/74)、[#75](https://github.com/Leehow/chatrpgv4/issues/75) — 交付：合并、`build:runtime`、套件一次一个 pytest、重打包 App；按规格 Testing Decisions 记录全部激活证据；一次性的层间对读，没有规则住两处。
9. **[#77 真桌回归，Grok 当守秘人，主会话当玩家](https://github.com/Leehow/chatrpgv4/issues/77)** — 前置：[#76](https://github.com/Leehow/chatrpgv4/issues/76) — 交付：一局连续真玩到结局或真阻断，一回合一句；证据全部保留。**不是 worker 票，未打 ready-for-agent。**
10. **[#78 盲评对照，只看玩家可见上下文](https://github.com/Leehow/chatrpgv4/issues/78)** — 前置：[#76](https://github.com/Leehow/chatrpgv4/issues/76) — 交付：匿名替代稿的离线对照，七个透镜，不打总分；只是诊断，不是门。
11. **[#79 真人门，没读过模组的人用真实界面玩](https://github.com/Leehow/chatrpgv4/issues/79)** — 前置：[#77](https://github.com/Leehow/chatrpgv4/issues/77) — 交付：真人验收记录与逐段反馈；没跑就如实写没跑。**不是 agent 票，未打 ready-for-agent。**

## 逻辑依赖 DAG

```
#69 ─┬─ #70 ─┬─ #75 ─┐
     ├─ #71 ─┼───────┼─ #76 ─┬─ #77 ─ #79
     ├─ #72 ─┤       │       └─ #78
     ├─ #73 ─┤       │
     └─ #74 ─┴───────┘
```

16 条阻塞边，无环。#75 等 #70 是真阻塞：settings 清空的新版本，没有 #70 的内核修复就无法从面板升级进来（规格 D3 在发出内核上复现过）。#79 等 #77 是规格 Further Notes 的次序：先连续真玩，再请真人。

## Worker 模型策略

按 Agents.md 开发方法：内核用 Fable，提示词与包文本用 Opus，机械改动与小文本用 Sonnet，契约与集成归 lead。

| 工单 | 角色/模型 | 为什么 |
| --- | --- | --- |
| [#69](https://github.com/Leehow/chatrpgv4/issues/69)、[#76](https://github.com/Leehow/chatrpgv4/issues/76) | lead | 契约文件与集成分支只有一个写者 |
| [#70](https://github.com/Leehow/chatrpgv4/issues/70) | Fable | 内核改动加回归测试 |
| [#72](https://github.com/Leehow/chatrpgv4/issues/72)、[#75](https://github.com/Leehow/chatrpgv4/issues/75)、[#73](https://github.com/Leehow/chatrpgv4/issues/73) | Opus | 整个规格的质量风险就坐在这三段文字上 |
| [#71](https://github.com/Leehow/chatrpgv4/issues/71)、[#74](https://github.com/Leehow/chatrpgv4/issues/74) | Sonnet | 对着处置表和已验证配方的机械改动；两句话加 changelog |
| [#77](https://github.com/Leehow/chatrpgv4/issues/77) | 主会话当玩家，Grok 当守秘人 | Agents.md 的硬规则，不可委派、不可脚本 |
| [#78](https://github.com/Leehow/chatrpgv4/issues/78) | lead，驱动带工具的 Pi author/reader | 文本工作必须跑成带工具的 Pi agent |
| [#79](https://github.com/Leehow/chatrpgv4/issues/79) | 没读过模组的真人 | AI 不能自我认证 |

## 归属与串行集成规则

- 集成分支 `claude/keeper-narrative-quality`（本轮由 Claude 主会话担任 lead，用户 2026-09-10 授权"尽管做"），从当前 `0.9.2a` 头开出；worker 分支 `claude/keeper-narrative-quality-<topic>`；worker `commit_policy: no_commit`，由 lead 集成与提交。
- 路径归属，互不重叠：#69 `docs/kernel-rpc.md` 与规格文件；#70 Mod 运行时的 configure 路径及其包测试；#71 `content/craft/` 三个文件与 capsule 九段测试；#72 `prompts/keeper.md`；#73 `mods/keeper-pacing/`；#74 `mods/story-thread/`；#75 `mods/narration-craft/` 与 Director 文字测试里那一条设置断言。需要动别人路径的，找 lead，并停下依赖那处改动的工作。
- 不新增运行时实体：没有新的规划器、评分服务、同步文学闸门、重写循环、正则分类器（规格 Implementation Decisions）。
- 旧包字节与战役锁不动；新版本是新字节；显式升级走既有面板与 #70 的规则。
- 文本工作（#78 的替代稿）必须是带 read/write/edit/bash 的 Pi agent，不许裸 provider 补全。
- 工单只有在 lead 集成并验证后才关闭，worker 说 done 不算。

## 初始可领取任务

- [#69](https://github.com/Leehow/chatrpgv4/issues/69) 契约先行。发布核对时它无阻塞、未认领，由 lead 直接做。
- #69 关闭后 [#70](https://github.com/Leehow/chatrpgv4/issues/70)、[#71](https://github.com/Leehow/chatrpgv4/issues/71)、[#72](https://github.com/Leehow/chatrpgv4/issues/72)、[#73](https://github.com/Leehow/chatrpgv4/issues/73)、[#74](https://github.com/Leehow/chatrpgv4/issues/74) 同时可领；[#75](https://github.com/Leehow/chatrpgv4/issues/75) 再等 #70。

## 父用户故事覆盖表（1–31）

| 故事 | 覆盖工单 |
| --- | --- |
| 1 | #72、#77、#79 |
| 2 | #72、#75 |
| 3 | #72 |
| 4 | #75 |
| 5 | #75 |
| 6 | #72、#75 |
| 7 | #72、#73 |
| 8 | #72、#73 |
| 9 | #72、#73 |
| 10 | #72、#73 |
| 11 | #73 |
| 12 | #71、#75 |
| 13 | #71、#72、#75 |
| 14 | #72、#75 |
| 15 | #71、#72 |
| 16 | #69、#71、#75、#76 |
| 17 | #71、#75 |
| 18 | #70、#75、#76 |
| 19 | #70、#75、#76 |
| 20 | #71、#72、#76 |
| 21 | #73、#74 |
| 22 | #69、#76、#77 |
| 23 | #69、#76 |
| 24 | #69、#76 |
| 25 | #70、#73 |
| 26 | #70、#76 |
| 27 | #78 |
| 28 | #77 |
| 29 | #79 |
| 30 | #76、#77 |
| 31 | #76、#79 |

## 发布与调度注意

- `ready-for-agent` 只表示规格完整；能否开工看原生阻塞关系：全部 blocker 已关、未认领、路径归属不冲突。
- #77 与 #79 故意没有该标签：一个只能由主会话当玩家、Grok 当守秘人来跑，一个只能由真人来跑。任何 worker 领走它们都是 Agents.md 里的假守秘人违规。
- 没有发现自动领票器；本计划只提供任务图与领取规则，不修改调度。
- 父票 #68 未关闭；其正文已同步为规格文件的当前内容（状态行与 2026-09-10 决定小节），票拆出后没有再改父票范围。

## 发布核对

- 11 张子票（#69–#79），16 条原生阻塞边，无环；全部 11 张都是 #68 的原生子票，建票后用读端 API 逐票复核过。
- 31 条父用户故事全部有归属。
- 比 2026-09-10 口头列给用户的 10 张多一张：#78 盲评对照，否则第 27 条故事没有归属，而规格的完成标准要求编辑证据单独汇报。
