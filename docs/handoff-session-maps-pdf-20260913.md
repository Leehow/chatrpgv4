# PipiCOC 会话地图与 PDF 地图解析交接

交接日期：2026-09-13。本文是本轮工作的事实快照，覆盖会话地图、玩家已知区域遮蔽、原 PDF 地图发现、读取效率与权限边界、Cold Harvest 实机验收，以及尚未通过的最后一段真实验收。

## 用户意图与完成标准

用户要的是一条统一地图能力：内置模组或原 PDF 中只要存在地图，守秘人在当前会话需要地图时就能展示；展示内容必须由玩家已经知道的区域决定，未知区域不能提前暴露。

成功需要同时满足：

1. 地图从模组或原 PDF 的真实来源进入图谱，并保留页码、裁切和哈希证据。
2. 世界状态只记录玩家已经获知的语义区域。
3. 会话 UI 只展示这些已知区域，未知区域保持隐藏。
4. App 重启后知识状态与地图仍可恢复。
5. 原 PDF reader 只能访问指定 PDF、任务目录和宿主生成的只读工具。
6. 用真实 PipiCOC App、真实 Keeper 模型和逐回合玩家输入完成一次原 PDF 地图验收。

目前 1–5 的系统实现已经落地，内置模组的真实 App 地图验收已通过。第 6 项在 Cold Harvest 上尚未完成：地图页已找到，但原 PDF 图谱详情没有成功发布，因此会话里还没有显示农场地图。

## 当前代码与安装状态

| 项目 | 当前事实 |
| --- | --- |
| 工作区 | /Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-v2 |
| 分支 | codex/session-maps |
| 写本文前 HEAD | a9c8773a，工作区干净；本文会形成新的文档改动 |
| 生产内核 | 仅 kernel-ts/；不要恢复或修改旧 Python 内核 |
| 规范 App | /Applications/PipiCOC.app |
| 当前包收据 | build/pipicoc-package.json，commit a9c8773a |
| 包类型 | standalone-typescript-runtime-fast-repack |
| 签名 | PipiUI Dev；安装后严格 codesign 校验已通过 |

当前 App 基于完整包 29c75e15，替换并重新签名了三个运行时文件：

- build/extensions/module/index.mjs
- build/pipicoc/onboarding-worker.mjs
- content/setup/visual-reader.md

程序集哈希已经同步。这个过程不是运行中热更新：旧 App 先退出，候选在 build/PipiCOC.app 中更新、重签名、严格校验，再安装到唯一规范路径并重新启动。

完整 pipicoc/package.mjs 曾因 GitHub 下载超时和临时 npm ci 长时间无进展而中止。不要把该网络失败当成源码或签名失败。

当前源代码包含两个与本任务无关的并行提交，已保留且没有回滚：

- f98b8ad0 sheet: centered one-line mount invitation; settings hint answers portrait_no_model
- f8735995 sheet: center the mount invitation in the photograph's own box

## 已落地提交

| 提交 | 作用 |
| --- | --- |
| 9bc885f7 | 会话地图主实现：地图来源、玩家知识状态、区域裁切/遮蔽、地图机制卡、重启恢复、世界线合并 |
| 8a28732c | PDF 准备重试使用当前会话模型与 thinking，并保留图片能力门 |
| 792e44f1 | 被拒的 PDF 开场在同一任务内进行一次有界修复 |
| c4a95ec5 | 限制 PDF reader 的 read/write/edit/bash 文件系统范围，修复跨目录搜索与 macOS TCC 弹窗 |
| b768722c | 加入最多 20 页的 PDF 接触表，仅用于导航 |
| 8ce029e7 | PDF 工具顶层 schema 固定为 object，兼容 OpenAI-compatible provider |
| 1b92f86c | 开场 finish 的 invalid_params 可在同一任务内做一次有界修复 |
| 2fe2b3c3 | 模型图片能力缺省支持；只有显式纯文本为 false；修复冷恢复能力覆盖 |
| 29c75e15 | 读取超时后的旧回合恢复；失败详情读对同一读取身份自动重试一次 |
| a9c8773a | Astra 修复详情读范围膨胀：purpose/focus/question 定义范围，浏览页与地图标签不扩大准备义务 |

## 会话地图设计与实现边界

规格：

- docs/specs/session-maps.md
- docs/specs/session-maps-tickets.md
- docs/specs/visual-pdf-reader.md
- docs/kernel-rpc.md 的地图与 PDF 读取章节

核心形状：

- 模组图谱通过 properties.map_regions 描述可揭示的语义区域。
- 地图知识存入 world.map_knowledge，只由 apply kind=map 改变。
- 玩家地图由宿主从原资产生成，不把原图路径、裁切指令或 Keeper 私密标注交给前端。
- 区域可带 level；进入一个房间不等于揭示整层。
- Keeper 图只有在显式 redaction boxes 能删除所有私密标注并经独立复核确认安全时才可作为玩家图来源。
- 地图显示是普通会话机制条目，可缩放，重启后从持久状态恢复。

内置 The Haunting 的 App 验收已经完成：只显示玩家知道的门厅，未知房间与楼层隐藏；缩放与重启恢复正常。除非后续修改地图状态或渲染代码，不需要重做这条基础验收。

## PDF 读取工具与效率改动

### 接触表

pdf overview：

- 只接受连续物理页范围，最多 20 页。
- 输出带物理页/PDF label 的 4 列、1600px JPEG。
- 只用于定位页面，结果 kind=source_overview，没有 observations，不能满足 source refs 或独立复核。
- 缓存与证据日志独立为 overviews.jsonl；精确页图仍写 requests.jsonl。
- 没有引入 Docling、Marker、MinerU、PaddleOCR-VL、Python OCR 或新依赖。

Cold Harvest 的真实接触表仍在 /tmp/pipicoc-cold-harvest-overview-1-20.jpg；它显示物理第 17 页有地区地图。该临时文件可能在重启后消失，不是持久证据源。

### 文件系统限制

修复前，真实 reader 曾执行 find /，读取 App 资源、其他 .coc/modules 和先前草稿，并调用 python3，因此触发 Documents、Downloads、iCloud、Google Drive 等目录权限请求。

修复后：

- read 仅允许当前任务、内部 source/cache。
- write/edit 仅允许任务目录。
- bash 仅允许宿主生成的精确 coc-read-check 命令。
- 禁止 symlink/traversal；reader HOME 指向任务目录，并清理 BASH_ENV、ENV、CDPATH。
- 修复后的真实重试没有新增 TCC 时间戳。

不要通过放宽 reader 文件权限解决解析问题。

## 模型图片能力修复

用户裁定：新模型默认按多模态处理，只有明确声明非多模态才阻止图片。

最终规则：

- supportsImages:false 或 input:[text] 表示不支持图片。
- input 包含 image 表示支持图片。
- 能力字段缺失时默认支持图片。
- 不使用 provider/model 名称白名单或正则推断。

冷恢复问题有两层：COC onboarding 使用 supportsImages === true，把 unknown 误判为 false；同名扩展模型由运行时目录先占身份时，陈旧 input:[text] 会覆盖扩展清单的 input:[text,image]。

2fe2b3c3 修复两层问题，并覆盖 DeepSeek Flash、Grok 4.6、未来缺省模型、显式纯文本模型和冷 JSONL 恢复。实机上 DeepSeek 会话已经越过“所选模型不能读取图片”，完成真实页图读取与 13/13 开场复核。

## Cold Harvest 真实验收档

### 来源与身份

- PDF：/Users/haoli/Documents/TRPG/克苏鲁的呼唤/[COC模组翻译]冰冷的收获-Cold Harvest.pdf
- 物理页数：48
- SHA-256：e4832eec4aa06a2a4946ac91e9b82388b2a7419310308b625171df95f15ec771
- import：995ef6b5-1c13-42cf-972f-7108855d6bcb
- module：book-2
- campaign：game-a70232d0-b7c5-46c1-b072-626fa343d8b6
- Pi session：432e0529-ae27-4e43-bfd6-5bac4baab40e
- investigator：伊万·彼得罗夫，32 岁，工程师/前乡村测量员
- 开场：选项 2，NKVD 调查农场减产

主要证据：

- import 事件：/Users/haoli/Library/Application Support/Pipi/pipicoc/pi-coc/.coc/imports/995ef6b5-1c13-42cf-972f-7108855d6bcb/events.jsonl
- module：/Users/haoli/Library/Application Support/Pipi/pipicoc/pi-coc/.coc/modules/book-2
- campaign：/Users/haoli/Library/Application Support/Pipi/pipicoc/pi-coc/.coc/campaigns/game-a70232d0-b7c5-46c1-b072-626fa343d8b6
- session JSONL：/Users/haoli/Library/Application Support/Pipi/pipicoc/pi-coc/agent/ui-sessions/play/%2FUsers%2Fhaoli%2Fleehow%2Fcode%2Fchatrpgv4-wt-pi-coc-v2/2026-09-13T05-16-36-898Z_432e0529-ae27-4e43-bfd6-5bac4baab40e.jsonl

### 已通过的真实流程

1. PDF 选择、开场选择、调查员生成与确认完成。
2. read-12 用 DeepSeek Flash 完成开场主读与 13 个独立复核，结果 opening_ready:true，generation 3。
3. App 正常展示开场叙述、检定卡、举报信、居民名单、逃亡线索和 NPC。
4. 详情 reader 找到两张地图：物理第 17 页的地区地图、物理第 23 页的 3 号农场平面图。
5. 地图草稿使用原始页图与裁切证据，没有依赖 OCR 文本或重绘。

### 详情读失败时间线

| Job | 结果 | 关键事实 |
| --- | --- | --- |
| read-13 | failed | 13-node 地图/地点草稿；reviewer 把浏览过的 11–28 页当完整范围，扩出 46 个复核；最终一个连接错误、一个 reviewer 漏字段 |
| read-14 | failed | 从 read-13 续接并继续扩张；出现大量 Auth context expired、连接错误和一条畸形 JSON；未发布 |
| read-15 | 交接时仍为 running | 由安装 Astra 补丁后的 App 启动，但继承 read-14 已膨胀草稿；当前 draft 45 nodes、54 claims、45 ready_nodes，不能证明新范围收敛；verify-1 已记录 31 个 timeout/connection/page-scope 失败 |

read-15 工作目录：

/Users/haoli/Library/Application Support/Pipi/pipicoc/pi-coc/.coc/modules/book-2/work/read-15/attempt-1

交接时 deepen-queue.json 仍标为 running，reader/复核子进程仍在。不要继续等待它来验证 Astra 修复。它沿用了旧膨胀候选，并已积累大量 provider 失败。需要停止时应通过正常 App 退出/reader cancellation 保存证据；不要删除 lock、work、queue、generation 或 campaign 文件。

### 当前玩家状态

- 场景仍是“开场 2 给调查员的信息”。
- 游戏时间未推进，当前约为第 2 回合。
- 玩家已经拿到开场线索与手卡。
- 前往农场的 apply 没有成功落地，因此不能声称已抵达，也不能提前显示农场地图。
- Grok 4.6 最近出现 Request timed out / Connection error；session JSONL 中为 stopReason:error 且无内容。
- DeepSeek V4.1 Flash 最近两次为 stopReason:stop，但只返回 thinking block，没有 text/toolCall。这是 provider/模型工具完成问题，不是图片能力判断错误。

## Astra 修复的准确边界

a9c8773a 修改：

- content/setup/visual-reader.md
- extensions/module/reader-review.ts
- docs/kernel-rpc.md
- tests/extension/reader-review.test.mjs

规则：

- detail 的 purpose/focus/question 定义抽取与复核范围。
- 空 question 表示为当前用途准备 focus 及必要依赖，不表示整章或整地点所有未来分支。
- 浏览页、上下文页、地图标签只是证据入口，不能自动扩大 ready_nodes。
- coverage reviewer 可查看全部 review_scope_pages，但必须说明遗漏会阻断哪个当前用途或必要依赖。
- 普通字段 reviewer 不再收到完整 review_scope_pages，只核对分配字段。
- reviewer 传输或漏字段失败仍按现有机制只重试失败单元，成功单元使用缓存；没有新增恢复框架。

验证：Astra 报告相关 40 项通过；主会话复跑 reader-review、reading-service、visual-reader 相邻测试共 26 项通过，git diff --check 通过。

重要限制：补丁不能改变已经启动的 reader 模型上下文，也不能自动缩小从旧失败任务继承的膨胀草稿。必须以一个新鲜、明确地图用途的 detail 请求验证实际收敛；当前 read-15 不是有效证据。

## 读取超时后的回合恢复

真实问题：reading_timeout 后旧回合保持 open/acting。后续玩家输入被内核正确拒绝，但扩展沿用已花掉的 steer，模型即使想 narrate 也可能只留下 thinking，回合永久卡住。

29c75e15 做了两项修复：

- 对 turn_state + readingWait + open/acting 的后续运行刷新一次关闭回合修正，要求 Keeper 用 narrate 诚实说明材料未就绪。
- 当相同 detail 读取已明确 reading_failed 时，本玩家回合只自动 retry:true 一次；成功后重放原内核动作，失败不循环。

真实 App 已证明第一项有效：旧回合最终显示“原文仍在后台读取、出发没有发生、时间没有前进”。被内核拒绝的玩家输入不会自动重放，玩家需要在旧回合关闭后再次提交原动作。

## 测试与验证摘要

- 会话地图相关内核、扩展、世界线和 UI 回归在主提交阶段通过。
- PDF 接触表：62 项相邻测试与系统语言检查通过；真实 Cold Harvest overview 生成并缓存复用。
- PDF schema：52 项测试与构建通过。
- reader 文件系统限制：32 项测试；真实重试无新增 TCC 时间戳。
- 模型能力冷恢复：38 项 provider/session 测试；pi-backend build 通过。
- 读取失败回合恢复：24 项 turn/reading-intent/real-kernel 测试；build:runtime 通过。
- Astra 详情范围修复：主会话相邻 26 项通过；Astra handoff 记录 40 项相关测试通过。
- 当前 /Applications/PipiCOC.app 严格签名校验通过。

测试通过不等于 Cold Harvest 地图会话验收已经完成。

## 下一位接手者的最短路径

1. 先读本文、AGENTS.md、docs/specs/session-maps.md、docs/specs/visual-pdf-reader.md，核对 Git 状态、HEAD 和当前 App 收据。不要回到旧 Python 树。
2. 先处理正在运行的 read-15：只读核对 queue；若仍运行且失败数不再收敛，通过正常 App 退出取消并保留证据。不要手工删除任务文件。
3. 不要再从 read-13/14/15 的膨胀 draft 续修来验证范围。用新鲜 detail 请求，question 明确为“prepare the authored map and safe reveal regions needed for arrival at Krasivyi Oktabur-3”，focus 保持 krasivyi-oktabur-3。
4. 新请求应只准备抵达、地图资产、玩家安全揭示单元及必要依赖。先观察 draft/reviewer 数量；若再次出现几十个无关 NPC/后期事件节点，立即停止并核对安装包是否加载 source-review-groups-v5 与新 visual-reader.md。
5. 选择能稳定完成工具调用的 Keeper/reader 模型。图片能力缺省逻辑已修复；若 provider 返回纯 thinking 或 stopReason:error，记录为 provider/tool-completion 失败，不要再改 vision 判定。
6. 新详情发布成功后，用真实玩家一句话前往农场，确认 move 收据与场景变化。
7. 请求显示当前已知的农场地图。验收 UI 只显示当前已知区域；未知房屋、路线、秘密地点与 Keeper 标注不得出现。
8. 重启规范 App，再检查同一会话地图恢复。保留截图、campaign 事件、module generation、reading telemetry 与 package receipt。

如果新鲜聚焦请求仍因 provider 网络失败无法完成，应明确记录：代码范围修复已验证，真实原 PDF 地图验收受 provider tool-completion/transport 阻断。不要手工修改 module graph、直接写 campaign 状态或用假 Keeper 脚本制造通过结果。

## 保留的 worker 交接

- .tmp/team-lead/worker-pdf-pipeline-reference-research-20260913.md
- .tmp/team-lead/worker-pdf-contact-sheet-overview-20260913.md
- .tmp/team-lead/worker-pdf-contact-sheet-schema-revision-20260913.md
- .tmp/team-lead/worker-pipicoc-reader-filesystem-confinement-20260913.md
- .tmp/team-lead/worker-pdf-opening-repair-20260913.md
- .tmp/team-lead/worker-pdf-opening-finish-repair-broadening-20260913.md
- .tmp/team-lead/worker-coc-vision-capability-cold-restore-20260913.md
- .tmp/team-lead/worker-coc-material-read-retry-20260913.md

## 保留的 App 备份

最近的相关备份：

- /Users/haoli/.Trash/PipiCOC.pre-focused-detail-20260913-064728.app
- /Users/haoli/.Trash/PipiCOC.pre-read-recovery-20260913-054800.app
- /Users/haoli/.Trash/PipiCOC.pre-multimodal-default-20260913-044414.app
- /Users/haoli/.Trash/PipiCOC.pre-finish-repair-20260913-0445.app
- /Users/haoli/.Trash/PipiCOC.pre-schema-fix-20260913-0430.app
- /Users/haoli/.Trash/PipiCOC.pre-pdf-overview-20260913-0355.app
- /Users/haoli/.Trash/PipiCOC.pre-reader-confinement-20260913-0312.app

未经用户明确授权，不要删除这些 App、战役、import、module work、generation、日志或玩测证据。

## 必须延续的用户约束

- 保持代码和架构简洁，不加入 Docling、Marker、MinerU、PaddleOCR-VL 等新解析栈。
- 尽量少用 Astra；只有核心、复杂、其他模型明显卡住时才升级。本轮 Astra 只用于定位详情范围膨胀。
- 模型默认按多模态处理，只有明确非多模态才禁图。
- PDF 只处理用户指定来源，不得搜索其他目录或触发额外 TCC 权限。
- 真桌验收必须使用真实 PipiCOC App、真实 Keeper、主会话逐句扮演玩家；不使用假 Keeper、批处理脚本或手工写状态。
- 保存全部战役、逐字记录、事件流、模块存储和玩测证据。
- 不回滚或吸收其他并行任务的 dirty work。

