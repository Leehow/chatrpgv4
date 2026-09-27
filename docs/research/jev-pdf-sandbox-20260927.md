# Jev PDF sandbox: measurements before targets

Status: exploratory source experiments complete; whole-product performance and completeness remain unproven.
Date: 2026-09-27
Source baseline: 0.9.6a, 58f5889d3341b7d90fcc9e7cf0fe4108530579b6.
Prototype branch: codex/jev-pdf-sandbox-20260927, commit 7c073a5f1 (not merged into production).
Prototype: [scripts and README](../../../chatrpgv4-wt-jev-pdf-sandbox/experiments/jev-pdf-demand/README.md), [interactive measurement report](../../../chatrpgv4-wt-jev-pdf-sandbox/experiments/jev-pdf-demand/report.html), [structured measurements](../../../chatrpgv4-wt-jev-pdf-sandbox/experiments/jev-pdf-demand/measurements.json).
Design: [draft spec](../specs/jev-pdf-demand-reading.md), [draft tickets](../specs/jev-pdf-demand-reading-tickets.md).

Scope correction: 用户随后将前台目标明确为少量建卡简报与所选首场景，其余持续后台解析。本报告的广泛 dossier 耗时用作前台开玩估计时为 invalid-for-intent / invalid-for-acceptance；保留它作为来源读取机制实验，不据此设定玩家等待目标。新的计时口径见规格 D0/D10/T3。

## Question and authorization

用户要求先做沙盒原型，看什么实现更好，再定提速和 token 目标。因此撤回此前没有原型支持的 50% / 60% / 70% 总目标。本轮授权隔离实验和规格修订，没有生产实现、打包、换模型或真桌验收。

实验分两层：原 PDF 到语义候选与精确原文；候选到带工具 Pi 作者和独立原页审阅者生成的资料包。第二层使用研究用 dossier schema，没有冒充 ModuleGraph 发布、完整开场/建卡或正式游玩。它能检验读取/审阅策略，不足以直接给出产品冷导入分钟数。

## Source and runtime

- 原始 Blood Road：111 页，SHA-256 9cc71c34dd62462f0f3c7bf765defc4bc49667f1f9fee3f0ac172a32464da50c。
- 原始 Masks：669 页，SHA-256 806966db20202a020af6213695dccc0b547fc998a73dd2f1344567e2579a1942。
- 宿主 PDF.js 原生文本提取：Blood Road 811 ms / 131,440 字符；Masks 3,297 ms / 2,297,434 字符。未用 OCR、历史图谱或历史抽取内容作为候选全集。
- Jev：jev-1.13.0；真实 API；最大 8 个并发请求；保留每次请求、响应、耗时、usage 和失败。每个请求只带 bounded 原文页组。凭据只经既有 vault reader 和 Jev credential resolver 进入内存。
- Pi 作者/审阅：grok-build/grok-4.5，low，真实 read/write/edit/bash/pdf 工具，沿用生产 reader confinement 和原页工具；独立私有 profile，只复制登录文件，未写回 App。
- 早期 shell 的 node 选择未冻结，后续发现 PATH 指向 Node 22。受控复跑固定 Node 24.19.0 绝对路径，并在 manifest 记录可执行文件、脚本摘要、题目、源身份和候选页。早期数据明确标记 exploratory。
- 随后核对 source map 发现，复制的 reader-context 构建产物缺少当前源码的 §140 输出上限设置。下方旧图像策略对照因此只代表这个共同旧上下文，不代表当前 0.9.6a 性能；原页工具源码一致，source 工具差异是未使用的 sourceWindow 方法。后续 guided/unguided 关键对照直接加载当前 reader-context 与 reader-pdf 源码，核查实际请求日志中的 output_bound。原生提取和 Jev API 实验不依赖该旧构建。

## Navigation results

| 原型 | Blood Road | Masks | 解释 |
| --- | --- | --- | --- |
| 未给角色/场景名的开场、建卡与全局背景候选定位 | 1.991 s；152,974 输入 | 4.780 s；825,526 输入 | 只得到候选排名；尚未独立核实每个候选是否真正可选开场 |
| 全书分项扫描，含综合题与诊断题 | 4.656 s；199,434 输入；13 请求 | 8.625 s；1,192,964 输入；147 请求 | 7 个分项加 1 个综合题同批处理；不是单题延迟 |
| 先做通用页角色索引，再查询其候选 | 冷启动合计 5.856 s；309,320 输入 | 冷启动合计 17.970 s；1,830,534 输入 | 后者查询有 1 个 transport failure，保留；不能作为无失败精确对照 |
| 每页一题“是否覆盖至少一项需求” | 1.113 s；141,772 输入 | 8.804 s；795,476 输入 | 只包含实际 focus 需求，未包含上一行全部诊断题 |
| 同上，Masks 批次扩大到最多 16 页/40k 字符 | — | 5.217 s；752,298 输入；61 请求 | 更快但候选变宽，不是无代价改进 |
| 实际 focus 的各项需求分别判断，固定 Node 24 | 3.568 s；165,700 输入 | 4.769 / 5.107 s；均 991,598 输入；61 请求 | Masks 两次相同请求布局的复跑；题目更细，不能与单题版只比调用数 |
| 对候选问具体证据问题 | 1.752 s；48,818 输入；26 请求 | 1.769 s；35,259 输入；23 请求 | 候选来自原始分项扫描，不能把这两行与 lean 的时间拼成已测 lean 管线 |

**通用分类索引不是当前最优冷启动前置项。** Blood Road 仍留下 77/101 个有文本页；Masks 仍留下 525/669 页。分类阶段自身的成本，比省掉的查询工作更大。可复用的原生文本、请求结果和已确认关联仍值得缓存；“先给全书打分类标签”不应默认成为昂贵的必经阶段。

**更大的 state 不是免费收益。** Masks 每页一题在小批时，分数不低于 0.6 的候选为 217 页；扩大批次后变成 264 页。全书分项扫描、宽扫描加复筛之间要比较最终读了多少原页、漏了什么，不能只看第一步更快。

## Dependency evidence and limits

原型查询只有题目和原文，没有把期望页码发给 Jev。目标名称来自已知任务/历史场景语境，因此这不是盲测“首次交 PDF 就发现全部开场”。

- Blood Road 第 14 页的医生身份与友好伪装：综合题 0.65，身份/剧情分项 0.80，具体证据题 0.97。主会话原页核对确认这是会影响首次表现的背景。先分类再分组查询时，同页身份分项降至 0.10；它并未被角色索引排除，变化发生在不同同批上下文中。该次波动不能独立证明具体因果，但足以反对用一次分数作永久否决。
- Blood Road 第 90 页的疲劳表：宽环境题 0.40，具体表格证据题 0.92。部分答案页不能因未覆盖整个问题就被删除。
- Masks 第 172 页的两个 NPC 参数块：宽参数题 0.53；分别询问 Iregi、Colm 的实际参数后均 0.99。主会话原页确认两人的参数及普通/低俗规则分栏；本轮不把这些数值发布成可执行 mechanics。
- Masks 第 123 页：具体证据问题找到“旅馆线索被带走后可从哪些来源补获”的条件，分数 0.97；主会话原页确认。这说明当前场景的调查连续性需要关联条件，不能只记录眼前物品。
- Blood Road 的地图第 19 页没有可用原生文本。文本定位找到目录/引用不等于发现并查看地图；视觉兜底仍然必需。Masks 所有页都有一些文本，也不能据此声明所有视觉内容已覆盖。

原始问题、分布、精确原文材料化与原图均保存在沙盒。Jev 输出只选位置，宿主复制原文；没有让 Jev 写开放文本、计算参数或宣告全书完整。这里的少量 source anchors 和事后细问题是探索证据，不是独立留出的总体召回率。

## Reader and reviewer experiments

同一已知医生任务：首次拜访的信息、会影响当前表现的身份/动机、后续关联、原书数值与注射器规则。所有 guided 组使用同一候选页集和原生片段；作者、审阅者都亲自通过 pdf 看原页。资料包由真实带工具 Pi 编写，不是固定答案或假 Keeper。

| 固定 Node 24、共同旧 reader context 的策略 | 总耗时 | 总输入，含缓存 | 图片发送 | 图片字节 | 作者/审阅调用 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 生产默认最近 24 张 | 122.375 s | 177,286 | 36 | 42,439,666 | 10 |
| 每次成功推理后移出旧图，需要时重开 | 148.188 s | 205,648 | 29 | 34,578,371 | 16 |
| 生产已有的最近 4 张窗口 | 314.376 s | 217,765 | 43 | 50,989,426 | 15 |

4 张窗口组遇到一次 provider timeout，耗时不能全部归因于窗口；图片/重开/调用总量也没有表现出稳定节省。即时移出组在无 provider error 的复跑中仍比默认策略慢，且总输入更多。故两种策略都没有得到直接推广的证据。

三组资料包分别有 55/57/56 个事实、关系或数值行；独立审阅均逐行覆盖、未报告 unsupported/missing，引用页也都在该审阅者实际收到的图像里。输出粒度仍有差异，没有完整书级独立 goldens；不能据此宣称三组语义完全等价或全书零遗漏。

一个较早的即时移出试跑把图片降到 14 张，输入降到 118,134，看起来很有希望，但后续受控复跑没有重现。另一次默认策略因 provider timeout 总耗时 302.702 s；不能用它对比无超时的快组算倍速。更早一轮因原型误用宿主保留文件名 packet.json，结果被标为 invalid-for-comparison，原记录保留，修正后使用 dossier.json。

结论：先按使用单位控制阅读范围并保存可复用材料。图像生命周期需要保留当前核对所需的证据，不能把“每张只发一次”当唯一优化目标。更小的请求必须同时减少完整任务的重开、模型调用和 token 才有意义。

## Exact native-material reuse

对同一来源、同一问题、同一已选择原文材料，原型核对整份 PDF 字节摘要并读取缓存约 17–38 ms；随后文件读取约 0.08–0.56 ms，不调用模型。这只证明相同原文材料的宿主复用，不包括新问题的语义定位、游戏状态有效性或已审阅图谱缓存。

## Current-source guided versus unguided comparison

最后两组直接加载当前 reader-context 和 reader-pdf 源码，固定 Node 24；实际出站日志都记录了 output_bound: 16384。其余私有 Pi/provider 构建沿用同一冻结副本，不作为完整当前产品构建证明。

| 同一个医生任务 | Jev 候选页和原生片段已给读者 | 读者从原 PDF 自行找页 |
| --- | ---: | ---: |
| 作者 + 独立审阅墙钟 | 337.265 s | 188.095 s |
| 已报告输入 token，含缓存读取 | 220,308 | 199,258 |
| 图片发送 / 字节 | 60 / 71,789,493 | 50 / 57,744,842 |
| provider errors | timeout + connection error | 无 |
| 资料行数 | 54 | 55 |

两组逐行审阅均无 unsupported/missing/未覆盖指针，引用页都有独立实际图像访问；两组当前/后续材料范围仍有细节差异，未建立完整独立 goldens，不能宣称完全等价。引导组保留了更多后续材料，非引导组将部分后续阅读推迟。

该对照没有证明 Jev 引导后的完整源任务更快或更省。引导组耗时包含服务故障，不能全归因于算法，也不能扣掉故障后宣称实测加速。上表尚未加 Jev 的冷检索：实际用于该组的首次复合诊断扫描另外消耗 199,434 输入 token；合计 419,742，比这次无引导任务更多。较精简的 focus 扫描可少问诊断题，但不能把另一个实验的数字换进来伪造更好的实测总量。失败调用没有 usage 的部分还存在未计量输入，不把它当成零。

因此，后续方案不能只在同样的作者/审阅流程前再加一次全书 Jev 扫描。必须让它替代原来的重复找页/重复生成，复用有效原文与已接受结果，并检查实际上减少了哪些旧工作。若旧工作没有减少，定位再快也不满足用户目标。

## Decisions and targets

1. 原生文本与来源位置可先机械建立。冷启动优先实验直接按当前需求定位，不把通用语义角色索引作为必经步骤。
2. 多项必要证据保留独立判断，接上针对具体条件、人物、数值位置的复筛。宽题结果只用于找候选，单分数不宣告缺失或完整。
3. 全书文本层允许跨章节找关联；关键当前依赖先核实，其余保留位置和继续条件。索引、已取原文、已看图、已独立审阅和可执行材料仍分开。
4. 原样材料化与精确复用应优先于再次生成同一份说明。复用现有可合格的 plaintext consultation / index-text 路径时保留 prepared:false 等边界；需要新图实体、可执行参数或视觉语义时仍走原来的带工具准备与独立审阅。进一步改变正式证据标准不是这个实验的授权。
5. 撤回“首次使用后立即移出图像”的选定方案；24/4/即时移出都必须按完整任务评价。现有证据支持先优化任务范围，图像退休策略继续作为受测变量。

可据当前实验提出的组件目标：同规模文本层 PDF 的已知 focus 冷定位，Blood Road 量级以 10 秒、Masks 量级以 15 秒为预算上限（包含提取/定位/必要候选复筛，正式实现还需实际连跑验证）；同源同问题原文材料复用以 100 ms、零模型调用为目标。这些是基于组件结果的新提议，不是已测完整开桌 SLA，也不是扫描 PDF 的承诺。

完整导入/建卡目标继续未定。研究 dossier 没有走实际 ModuleGraph 的结构修复、发布与 setup 交接，不能拿 122 秒当作产品导入结果。下一阶段的门槛应在真实准备协议沙盒跑通后预注册，包含所有作者、审阅、重试和后台成本；保留最初目标被撤回的历史。

本轮共保留 16 组 Jev 实验和 9 次资料包试跑（含无效输出名、旧构建、服务故障和修正后的对照）。没有把这些试跑算成真桌验收。所有作者和审阅进程已经退出；剩余工作是未来的生产协议验证，不是本轮悬挂进程。

## Evidence preservation

原始运行记录保留在实验 worktree 的 .pi/pdf-jev-lab；PDF、提取全文、页图、凭据和请求原文不进入跟踪文件。代码、脱敏测量索引、报告在独立原型分支保留。主线只更新研究与规格文档，不合入实验代码。没有运行 campaign、桌面 App 或生产包。

Lifecycle classification: retained:prototype-evidence, terminal and clean. Closeout returned retained_unique because the prototype commit is intentionally not ancestral to 0.9.6a. The final audit reports audit_pending=1: this helper counts every retained terminal entry as pending rather than persisting a retained outcome. This is intentional evidence retention, not a retryable cleanup or integration task; no clean/removed audit is claimed. Keep this exact worktree/branch with its raw evidence for reproducibility; no unrelated worktree or branch was adopted or changed.
