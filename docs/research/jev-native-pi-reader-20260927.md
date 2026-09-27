# Native Pi / Jev source reader prototype

Status: prototype executed; production integration and full setup/play acceptance remain open.
Date: 2026-09-27
Source base: 0.9.6a at 58f5889d3341b7d90fcc9e7cf0fe4108530579b6.
Prototype branch: codex/jev-pi-reader-prototype-20260927, commit 4ba527fdf (not merged into production).
Artifacts: [prototype README](../../../chatrpgv4-wt-jev-pi-reader-prototype/experiments/jev-native-reader/README.md), [interactive report](../../../chatrpgv4-wt-jev-pi-reader-prototype/experiments/jev-native-reader/report.html), [measured events/usage summary](../../../chatrpgv4-wt-jev-pi-reader-prototype/experiments/jev-native-reader/measurements.json).
Updates: [spec](../specs/jev-pdf-demand-reading.md), [tickets](../specs/jev-pdf-demand-reading-tickets.md).

## Applicability after the player-readiness clarification

用户随后明确：建卡前只需少量模组概况，建卡期间准备所选首场景，其余持续后台解析，首要保证玩家迅速可玩。本实验的完整 dossier 范围过宽；将其耗时用于估算这两个前台阶段属于 invalid-for-intent / invalid-for-acceptance。现有结果继续作为原生 Pi 接线、定位、图像上下文和遗漏补读的机制证据保存，不能据此断言开玩必须等待数分钟，或已经证明开玩加速。新的前台目标须由小简报、首场景及实际必要依赖的测量确定；本次文档修订没有新增实测。

## What changed from the first experiment

用户指出当前 Pi 已经包含原生 Jev 单循环，并要求重新使用它做原型。旧实验的来源定位数据可参考，但其“外部 Jev + model-first reader”资料包对照不适合作为本方案的验收依据。

本次实际创建当前 vendored Pi 的 AgentSession，向其注入 SessionRunDriver。所有 decide/operate/infer/finish 都由 Pi 的 RunDriver 执行。Jev 走项目现有 DecisionAdapter、packing 和 TaskLease；开放文本与视觉理解走同一个 Pi session 的真实 provider/tool 通道。没有另起 TaskRuntime，没有假 assistant/tool result，也没有模拟 Keeper 或 campaign。

构建由 leehow-pc 从本次 base 完成，11 秒、exit 0。RunDriver、reader-context、reader-pdf、source 的 source-map 内容与源码逐字匹配。Node 固定 24.19.0；生成模型固定 grok-build/grok-4.5 low；Jev 固定 jev-1.13.0。认证文件只复制到独立私有 profile。

## Native loop evidence

实际轨迹包括：

1. Pi 发出 run_start，protocol=hybrid-v1、policy=prototype-source-reading。
2. operate 读取绑定 PDF，再由 decide 经真实 Jev 判断来源候选。
3. operate 精确取原文/原图，通过 projection 作为 host custom message 进入模型上下文。
4. infer 才调用 Grok；其真实工具调用经 invocation.executeModelTool 执行并配对结果。
5. 读者调用 request_source 提出新的晚宴/隐瞒条件问题，同一 RunDriver 再次 decide → operate → infer；没有 agent.continue。
6. 独立 reviewer 使用另一个 Pi session，重新取得原图；作者笔记不算复核证据。

另一个 native locate-only 任务执行 operate → decide → operate → finish，约 2.39 秒，17 次 Jev 请求、158,669 输入，零大模型调用。它只交出定位与原文材料，未声称看过原图或准备好游戏资料。

源码完成态目前偏向玩家回合。原型没有伪造 narrate/ask 或 delivery_accepted：驱动器返回 undelivered/source_artifact_complete_no_player_delivery，同时由宿主另行记录已校验资料提交。生产接入必须定义正式 artifact completion 契约。

## First cold source-task pairs

同一份原始 PDF、同一请求、同一生成模型/思考档位；一组使用 native reading policy，另一组使用同一 Pi 的 model-first 工具循环。均包含作者和独立 reviewer。这里是研究用 dossier，不是完整 ModuleGraph 发布、建卡、App 开场或真桌。

| 书 / 循环 | 总时间 | 大模型调用 | 大模型输入，含缓存 | Jev 输入 | 两者总输入 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 血色公路 / model-first | 360.4 s | 13 | 241,397 | 0 | 241,397 |
| 血色公路 / native | 165.6 s | 5 | 167,266 | 176,956 | 344,222 |
| Masks / model-first | 431.5 s | 16 | 562,711 | 0 | 562,711 |
| Masks / native | 508.1 s | 7 | 321,096 | 880,264 | 1,201,360 |

血色公路这一次大模型调用与耗时明显下降，但计入 Jev 后总输入增加。Masks 大模型调用也减少，但时间和总输入都增加，且下一节的必要依赖没有补全。不能将“原生循环已接通”写成“整体优化已通过”。

每书只有一对；部分时段与另一个实验的 review 重叠，外部 provider 负载不受控。两组资料粒度也不完全相同：血色公路 native 将多个技能值合写一行，39 行对57行不能直接解释为丢失18项；Masks 是122行对85行，也不能解释为更完整。报告保留原文、引用与复核，不用行数代替语义等价。

## The missing dependency and its recovery

Masks 作者和独立 reviewer 都指出第三名袭击者 Jomo “Jimmy” Jepleting 缺少完整参数：已有 Iregi、Colm 的完整块，Jimmy 只有追逐快速参考。当前任务要求所有在场袭击者的参数，因此这是阻止完整准备的依赖，不能用“已提交 dossier”判通过。

原型第一次只收下 unresolved，没有读取它继续行动。这暴露了明确的生产者/消费者断点：模型已写出需要补什么，流程却没据此做下一步。

修正后的 prototype 在提交发现 required unresolved 时，将问题变成真正的 source request，再进入同一个 RunDriver 的 decide/operate；重复无进展或预算结束保留 partial。对已结束的旧任务，原型从保留稿件加载 unresolved，以 source.pending 操作重新进入读取，产出独立的已审阅 supplement。不会重写原始失败记录或把旧结果追认成成功。

一次全书补读找到物理第174页的 Jimmy 完整块。随后测试让 Jev 自己选择搜索范围：给它原有引用172、122页及实际原文，它选择先检查邻页，概率0.95、confidence 0.91；宿主按结构枚举这两处各前后4页，共18页，保留651页未查的边界与全书 fallback。同样找到了121、122、174页，完整参数的 supplement 经独立原页审阅通过。

| 同一缺失参数补读 | 全书范围 | Jev 选择邻页范围 |
| --- | ---: | ---: |
| 实际搜索原生页 | 669 | 18 |
| Jev 调用，含审阅路由 | 116 | 8 |
| Jev 输入 | 720,812 | 23,893 |
| 大模型调用 | 5 | 5 |
| 大模型输入，含缓存 | 79,650 | 84,480 |
| 全部输入 | 800,462 | 108,373 |
| 全部时间 | 140.8 s | 140.2 s |
| reviewer 缺失 / 未解决 / 不支持 | 0 / 0 / 0 | 0 / 0 / 0 |

这一对的总输入下降约86.5%，Jev 输入下降约96.7%；两组都带原图和独立审阅，但仍是一次探索比较，资料分行为49/51。时间基本不变，生成和审阅仍占大头。这证明了“让 Jev 选择实际读取策略”在此补读上的价值，不是全产品86.5%的节省。

邻域由已有引用和物理页位置机械构造，没有关键词/语言识别筛选。Jev决定是否先试局部；未解决时拓宽全书。实际观察到的是局部成功，局部失败后自动拓宽的代码路径尚未在实服务中触发，不声明它已实测。

实际验证的缺口消费是读取已保留稿件的 unresolved，再进入新的 native source run。活动会话 submit_source 发现 unresolved 后自动继续的处理也已实现，但该工具分支尚未在本轮实服务中自然触发；不把保留稿件的补读冒充这一分支的独立实测。

## What the spec must now require

- 来源任务接入现有 Pi RunDriver；setup 外层可以先保持当前模型循环，读书子任务先独立完成 native 接入。不复制 Keeper 的战役/回合 policy，也不复活另一套 TaskRuntime。
- 把已有目录、引用、章节/邻页和全书列为实际可执行范围，由 Jev 按当前问题与真实证据选择。局部未找到保留未知并可扩域，不是全书没有。
- unresolved、missing、deferred 和 located_unreviewed 各有明确消费者。必须解决的第三个 NPC 参数能触发补读；可推迟内容保留出处；书里未说明的问题不编造。
- 案例中“晚宴具体流程/邀请与杀人室联动”仍被保留为未解决；它与确实有完整块的 Jimmy 参数不同。生产契约需要区分必要当前依赖、可推迟问题和已检查范围内未说明，不能把所有开放问题都当成必须造出答案的义务。
- 不再默认每个新问题全书重扫。来源缓存、已接受 material、真实引用和候选 frontier 进入读取策略；原型后续版本保存未选中的候选，不将 top-k 当作语义充分性。
- 对已有文字优先精确 materialization，避免大模型重新抄写同一份事实。当前 dossier 仍有大量生成开销；若未实际减少旧工作，总调用更少也可能更慢。
- 核对的是 source_refs 对应的实际图像交付、正确人/条件/普通与Pulp字段，以及独立复核；宿主投影原图不是伪造工具结果，也不能绕过正式来源门槛。
- 结构确定的步直接 operate；已确定必须查看原图或必须做最终检查时，不再浪费一个 Jev 问题确认。Jev处理真正有选择的范围、材料和后续步骤。

## Failures and acceptance boundary

两个初始 bring-up 任务因原型 retry-policy 参数不完整，在第一次真实 Jev 请求前结束；保留且不计作速度结果。第一个 live follow probe 的 reviewer 遇到500 Auth context expired；另起真实 reviewer 完成了独立检查，并保留晚宴问题的未知，未将原错误抹掉。

所有主结果使用真实当前 Pi、真实 Jev 和真实 Grok。没有 fake provider、脚本玩家、批量结算或手写故事填充。原型只证明原生调度、特定来源读取、依赖重新进入和局部范围选择，未证明整本模组零遗漏、完整冷导入/建卡提速或已安装 App 的玩家体验。

本轮保留11次任务尝试，包括两个bring-up失败、一次带依赖追问的源任务、两本书各一组native/model-first对照、一次独立复核恢复、一次零生成调用的定位任务，以及全书/局部两种依赖补读。缺失、未知、服务错误和每次实际源码快照全部保留。

最终代码使用纯 policy reducer，源字节和I/O归 ports；后续 unresolved/局部范围修正的运行有独立快照。不得把较早冷对照的时间套到较晚代码。生产目标仍需真实准备协议和真桌验证后确定；本轮不发布产品性能SLA。

## Evidence location

每次运行的 manifest、源码快照、源身份、事件、Jev批次、provider请求摘要、原图交付、作者和复核文件保留在实验 worktree 的 .pi/native-reader-lab。PDF、全文、认证与原始请求不提交；源码与脱敏测量索引保存在独立原型分支。主线仅更新研究、spec和票。

Lifecycle classification: retained:prototype-evidence. The task-owned worktree is terminal, process-idle and clean; closeout returned retained_unique because its experiment commit is intentionally not part of 0.9.6a. The audit helper counts this retained terminal entry as audit_pending; no removal/cleaned audit is claimed. Preserve the exact worktree and branch for its raw evidence; no unrelated checkout was adopted or changed.
