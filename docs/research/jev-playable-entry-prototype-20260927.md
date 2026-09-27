# Jev / native Pi: minimal playable-entry prototype

Status: live source prototype; production publication and real setup/play acceptance remain open.
Date: 2026-09-27
Production base: 0.9.6a at 58f5889d3341b7d90fcc9e7cf0fe4108530579b6.
Prototype branch: codex/jev-pi-reader-prototype-20260927, commit 0a7a63ad8, new experiments/jev-playable-entry directory.
Evidence: [measured runs](../../../chatrpgv4-wt-jev-pi-reader-prototype/experiments/jev-playable-entry/measurements.json), [interactive report](../../../chatrpgv4-wt-jev-pi-reader-prototype/experiments/jev-playable-entry/report.html), [source and reproduction](../../../chatrpgv4-wt-jev-pi-reader-prototype/experiments/jev-playable-entry/README.md).

## Intent and boundary

用户要的是迅速可玩：先取得少量建卡信息，建卡期间准备所选首场景，其余持续后台读取。此次测试使用真实原生 Pi RunDriver、Jev、宿主原文/原页读取、带工具作者和独立原页复核。没有建立 campaign，没有脚本玩家或假 Keeper。

本轮实测的是两个阶段的**来源资料就绪**。它还没有接入正式 ModuleGraph 发布、建卡确认和守秘人行动链，不能把资料包通过复核直接叫作真实玩家已经可玩。交互报告中的建卡重叠滑块仅按实测场景耗时计算剩余等待。

生成模型按用户本轮更正固定为 **grok-build/grok-4.5 / low**。最初的 4.7 fast 试跑在更正后停止；已发生的作者用量和未完成复核的未知用量单独保留，未混入 4.5 的结果。Jev 使用 jev-1.13.0，Node 固定 24.19.0；reader-context、reader-pdf、source 与 RunDriver 的构建 source map 已重新核对。复用此前在 leehow-pc 构建的同一生产源码，没有重建或修改生产代码。

## Foreground results

以下是按修订顺序保留的可用资料结果，每个版本只有一次观测；没有配对生产基线，也没有尾延迟结论。

| 来源任务 | 墙钟时间，含作者与独立复核 | LLM 调用 | LLM 输入，含缓存 | Jev 输入 | 全部输入 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Blood Road：5 条建卡核心事实 | 49.2 s | 3 | 37,589 | 33,061 | 70,650 |
| Masks：6 条建卡核心事实 | 73.1 s | 5 | 149,071 | 107,884 | 256,955 |
| Masks：纽约实际会面现场 | 111.3 s | 10 | 281,307 | 83,884 | 365,191 |
| Blood Road：首站资料，初稿交独立复核判断未决问题 | 117.7 s | 4 | 81,503 | 319,748 | 401,251 |

Blood Road 简报的首次定位为 1.21 秒、首次原页供给为 2.75 秒；Masks 简报分别为 2.13 秒和 4.09 秒。当前主要等待已经落在生成模型及其工具往返上，不能用 Jev 的秒级定位代表整条准备链。

Masks 的首场景推进到 Hotel Chelsea 的实际遭遇：三名攻击者的身份、当下行为、Classic 战斗字段、门口行动分支、逃离与初始线索处理均有来源并经过独立复核。没有把一封介绍电报当作首场景完成。上一轮档案实验漏掉的第三名攻击者 Jomo “Jimmy” Jepleting，此次已包含。

Blood Road 明确选用原文的短篇流程，准备抵达与加油站首次交谈。未给定的具体报价作为待运行时处理的问题保留；独立复核确认它不阻碍当前交谈资料的使用。这个裁定没有授予交易、补写价格或代替规则结算。

若所选场景的准备完全与建卡重叠，按这两次 111.3/117.7 秒的观测计算：建卡重叠 60 秒，剩余来源等待约 51.3/57.7 秒；重叠 120 秒，则这部分等待被覆盖。实际确认卡到可玩的时间还要由正式路径测量，不能据此声称零等待已验收。

## Failures that changed the design

### A short brief can still omit a creation constraint

最初的 Blood Road 简报用了 108.5 秒、列出 10 条事实，并通过了当时的复核，但漏掉原文第 8 页的硬性要求：至少一位调查员有车，驾驶技能在 55% 以上。后续按建卡字段读取时发现这个遗漏；原结果保持不变，另存 post-audit 明确判定质量不通过。

目录选段也有一个结构错误：父章节范围原先被截在第一个子标题之前。已修正为使用同级/祖先边界，保留子章节范围。复核随后也加入独立定位与创建条件检查，能够查看作者未引用的页。49.2 秒的 Blood Road 简报运行在这次复核定位改动之前，因此其数字不能当作最终复核策略的耗时。

### An absent runtime input is not necessarily a missing source fact

多个 Blood Road 尝试在作者阶段停止，分别约 267、136、251、132、168 秒。读者不断提出修胎价格、某句对白之前是否已收到指令、车辆能滑行多远、此前累计高温暴露多久等问题。部分属于后续行动，部分依赖运行时状态，部分是原文允许的守秘人选择。把所有 unresolved 都接成全书补读，既无法获得不存在于 PDF 的现场状态，也让资料任务不断扩大。

原生策略增加闭合的需要分类：source_read、runtime_context、deferred、uncertain。Jev 的判断只影响下一步，不产生新事实或规则许可。一次实际调用将“是否采用拉索招手引导”判为 runtime_context；另一些问题得到 source_read 或 uncertain，说明它仍不是可靠的独立完整性证明。

最后一个实验把初稿及原始未决问题交给独立复核，由复核明确给出最终 disposition。只有所需事实有据、未决问题被支持地归为 runtime_context/deferred，资料结果才算通过；source_read/uncertain 不能通过。原始问题和引用仍保留。这样可以避免作者每收到一次分类就重新生成整包资料，再想出一个新的假设问题。生产实现仍须把真实缺口接到补读与修复消费者，不能仅靠这个研究用资料包检查器。

### Model-driven navigation and loose schemas add avoidable calls

一次读者不断换词调用旧的 literal PDF search，却反复只搜到前 50 页，没有消费 next_cursor；真实目标在后面的页。后续实验把未知材料的定位统一交给原生 request_source，保留指定页、裁剪与视觉概览工具。另测了一次全本文本 Jev fan-out 作为检索策略：它不解析完整图谱，但提高 Jev 输入量。因此目录局部定位与整本快速判断应按证据选用，不能宣布其中一种恒优。

工具往返还有原型自身的问题：重复写文件与提交、复核重新加载已提供的候选、尝试未授权 bash 检查、集合名/缺少 disposition 的提交修复。已供给完整候选、保留一次提交路径，并为复核记录补充闭合工具 schema。118 秒结果仍包含两次 disposition 形状修复；不能把后加 schema 的潜在节省算进已测数字。

### Provider time is variable

一次 Grok 请求返回 429 容量不足。另一个最终通过的 Blood Road 场景任务耗时 292.3 秒、仅四次 LLM 调用，明显慢于早先较小请求。全部失败和用量保留；没有受控服务负载，不能把各版本墙钟差异全部归因于策略。

## Background scheduling diagnostic

调度实验使用真实后台读者，在它发起模型请求后插入当前 NPC 参数来源需求。后台决策、操作与投影在下一边界让路；已经发送的模型请求不会被假装成可以瞬间抢占。需求使用自己的执行容量。

- 14:48:55.678 UTC：当前需求入队；14:48:59.277 发起生成请求，相隔约 3.6 秒，没有等后台整项结束。
- 后台在 14:49:12.726 的后续执行边界暂停；14:50:26.938 恢复，暂停 74.2 秒。
- 当前来源任务含复核耗时 90.6 秒；计入调度/进程启动为 91.2 秒。后台含暂停共 131.6 秒，两份来源答复都通过了各自的独立复核。
- 当前需求的 LLM 输入 195,968、Jev 输入 685,470；后台分别为 44,857、269,028。移到后台的成本没有被当作节省。

这里存在重要内容限制：当前任务确认了加油站老板身份和站内旧猎枪的维护/故障条件，但在已检查的相关页中没有找到他的完整个人 HP/格斗/闪避数值。答复明确保留这一缺口，没有发明参数。因此这是调度与诚实返回来源限制的成功，**不是一次已具备所需数值的对抗行动**。没有无后台对照，不能从单次观测证明后台对服务延迟毫无影响。

这是来源队列诊断，没有冒充一回合游玩，也没有证明全书后台解析、重启恢复、公平性或同一任务合并都已完成。

## Consequences for the spec

1. 保持两个小的前台阶段和持续后台解析。按真实建卡字段验收，单纯减少资料行数不能证明完整性。
2. 固定或保留原文模式条件，区分缺来源、未决现场状态与未来需要；保留它们各自的消费者。
3. Jev 负责来源范围和下一步判断；宿主取原文。避免把无消费的分页游标、反复找页和闭合 schema 修复留给多轮 LLM。
4. 当前阶段足够与全书完整必须是不同状态。独立复核仍需有来源之外的遗漏发现能力，不能盲信作者或 Jev 的页清单。
5. 现有结果不足以承诺产品 SLA。下一实现/验收目标应分别约束定位供给、生成/复核轮次、实际前台等待和后台争用；不得因这些试跑慢就把可接受玩家等待直接设成数分钟。

## Verification and retained evidence

共保留 13 个带完成记录的 4.5 任务，以及 1 个在用户更正模型后停止的 4.7 试跑；其中有失败、遗漏复核后的否决、服务容量错误和较慢的成功，交互报告完整列出。后台与当前需求按设计重叠；其余来源任务按次序运行。代码版本和服务负载变化使这些结果只能用于原型决策，不能充当受控性能归因。

本轮只检查原型脚本、数据、报告与文档接线；没有运行生产全套测试、真正开桌或 App 打包。正式数字来源校验、图谱发布和实际 Keeper 消费仍须走现有生产闸门。

## External comparison

[TypeSafe fan-out](https://docs.typesafe.ai/patterns/fan-out) 支持并行问独立闭合问题；[Jev jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13) 提醒状态、措辞与间接推理的限制。本轮的 source_read/runtime 分类结果再次说明需要独立验证。[Chrome 的优先级与让出执行](https://developer.chrome.com/blog/use-scheduler-yield) 支持分段后台工作的调度方向；网络模型请求的在途时间则必须另测。

原始 PDF、页图、请求、响应、失败、代码快照与来源材料全部保留在隔离工作区的 .pi/playable-entry-lab。主线仅更新规格、分票和研究记录。

Worktree closeout: the prototype checkout is clean, process-idle and terminal. It is intentionally classified retained:prototype-evidence at /Users/haoli/leehow/code/chatrpgv4-wt-jev-pi-reader-prototype on codex/jev-pi-reader-prototype-20260927. Canonical closeout returned retained_unique because the evidence commit is intentionally outside 0.9.6a. The lifecycle helper reports this retained terminal row as audit_pending; it has not been removed, merged or presented as a closed audit.
