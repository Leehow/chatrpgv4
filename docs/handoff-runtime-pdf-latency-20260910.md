# PipiCOC 运行时迁移与 PDF 等待优化交接

交接日期：2026-09-10。本文是本会话的状态快照，不是新的重构计划。下一轮先核对实际分支、安装包和并行修改，不要重新从历史 Python 树开始。

## 现在在做什么

用户最初要求把分散的 Python 生产路径迁移到 TypeScript，方便玩家直接运行安装包。迁移与 Python 生产源码退役已经完成；后来工作转向长 PDF 的开场等待、后台预读和场景切换延迟。

本会话最后一个实现任务是：定位博物馆切场景慢的问题，修复同名场景/地点造成的错误资料就绪判断。该修复已经合入、打包、安装，并通过针对安装包的回归。当前没有本会话仍在运行的测试、worker 派工或等待中的验收回合。

**尚未解决的是那一次 300 秒模型请求超时的具体原因，以及修复后整体等待是否稳定改善。不能说所有延迟都已解决。**

## 当前版本，必须区分

| 对象 | 本次交接核对结果 |
| --- | --- |
| 主工作区 | `/Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-v2`，分支 `0.9.2a` |
| 写本文前的源码 HEAD | `972e5fc1`；工作区干净。本文提交会在它之后增加一个文档提交 |
| 当前安装包 | `/Applications/PipiCOC.app`，本会话安装的候选 `62039c9f` |
| 安装包核对 | 当前 `assembly.json`、编译内核和 `pipicoc/panel.js` 的 SHA-256 与保留的 `62039c9f` 包一致；不是只根据旧安装收据猜版本 |
| 当前 App 进程 | 本次核对 PID `93986`，可随重启变化；不要照抄 PID 发信号 |
| 普通档最后观察 | 鬼屋 / 大牛皮，第 1 回合，正常输入框。未向该战役发送测试输入 |

`62039c9f` **不包含**后来提交的卡片栏目导航 `53fa8e47`，也不包含更晚的语言、Mod audit、测试对照等修改。后续若验收当前源码，需要先冻结候选并重新打包；本次交接请求没有替这些后续修改重包或重验。

## 本会话已经完成

1. **Python 生产内核退役。** 当前维护入口是 `kernel-ts/`、`runtime/`、`extensions/`、`pipicoc/`、`Electron/`。玩家包不依赖 Python/uv。Python 测试控制器或原生扩展构建工具不等于生产内核仍是 Python。`310f860c` 是退役提交；`7b327ecf` 强化了 `Agents.md` / `CLAUDE.md` 的维护边界。
2. **PDF 开局准备优化。** 前期优化与实际原 PDF 开局记录在 [fast-guided-pdf-onboarding.md](specs/fast-guided-pdf-onboarding.md)；不要重新发起整本 669 页解析作为前置条件。
3. **即时预读与有限并发。** `ee4c9b95`，集成/安装候选 `cc582f64`：table-open、排入场景工作、回合提交会立即唤醒读者，不再等 `agent_end`；两个后台任务加一个前台名额；同宿主读者进程上限 40，其中后台最多占 8。前台接手本地已有任务时提升排队子任务优先级，不重复启动同一任务。这不是供应商账户的全局并发隔离，也不保证所有后续细节都已预读。
4. **同名节点资料就绪修复。** 实现 `8ff8bb27`，合并候选 `62039c9f`，安装记录 `8b705f5a`：场景/出口/移动结果按已解析的场景节点 ID 查 readiness；apply 按操作的实体类型解析名字；缺资料时仍返回原语义 focus，继续复用预读队列。
5. **模型请求诊断日志。** `extensions/kernel/index.ts` 记录 `provider-request` 和 `provider-response` 的 `at`；响应只记状态和白名单 request-id，不记录任意头或凭据。超时与重试策略没有被改短。
6. **提交所有当时剩余的主工作区改动。** `53fa8e47` 提交调查员卡栏目导航及文案/测试，37 项面板测试、9 项界面文案检查通过。只提交了主工作区，没有擅自提交其他 worktree。

## 查明了什么，哪些解释已被更正

原来的真实长本游玩：周宁从餐厅前往博物馆。第一次因夜间闭馆没有移动；第二句自然行动休息至次日再前往，最终到达博物馆、第 4 回合，界面有移动收据、NPC 叙述和正常输入框。

第二句的准确时间来自 Pi 会话/遥测，不用人工轮询时间冒充结束时间：

| 阶段 | 已保存的测量 |
| --- | --- |
| renderer 提交到最终助手文本 | 479.028 秒，约 8 分钟 |
| 一次模型请求到超时 | 300.007 秒；2.030 秒后另发一次请求，8.499 秒正常返回。这不是 provider 级重试（`maxRetries` 为 0），见下文第 1 项 |
| 前台 source lookup | 87.904 秒；领取任务排队约 195 毫秒 |
| 补读内部 | 阅读 69.259 秒；两路独立复核并发 17.131 / 18.237 秒 |
| narrate 调用 | 30.539 秒；尚未把此调用内部各阶段完整归因 |
| narrate 后模型尾部 | 10.172 秒 |
| 其他普通内核操作 | 合计不到 1 秒 |

最初把这次补读完全解释成“新问题需要新材料”，不够准确。后来检查发现：`scene-museo-arqueologia` 已经 ready，而同短名称的 `location-museo-arqueologia` 未 ready；投影拿短名称查全部匹配项，错误告诉守秘人 `material_ready:false`。反向组合还会因名称歧义跳过 apply 的资料门。这两个问题均有旧包红、新代码及新安装包绿的回归证据。

补读确实提出了一个新的问题，也补入了少量新事实；不能由此保证修复后所有类似追问都零补读。更不能把 88 秒、300 秒直接写成已经实现的节省时间。没有做修复后的同条件整轮 A/B。

## 验证边界

- 身份修复合并候选：134 项相关检查通过，内核类型检查通过。
- `tests/extension/material-identity.test.mjs`：旧 `cc582f64` 安装内核两个用例均失败；当前安装内核两个用例均通过。覆盖已读场景不再被同名地点误报，以及未读场景必须拒绝移动且状态不变。
- 当前包稳定签名校验通过，已重启恢复普通档；最后安装检查时 LaunchServices / Spotlight 均只有规范 App 路径。
- **身份修复后没有新跑付费 Keeper 长局，也没有重新导入整本 PDF。** 本次没有声称整个长本、全部功能或当前 `972e5fc1` 都完成了真实验收。
- 更早一次广泛宿主类型检查有 7 条既存诊断；当时本次改动未增加诊断。后续源码已经变化，不能把这个数当当前最新结果。

## 剩余工作，按优先级

### 1. 真正定位 300 秒模型超时

已知的是请求抵达 Pi 配置的 300 秒期限，不知道是等待响应头、流中断、上游推理、负载还是网络。错误响应的零 usage 不能证明上游没有做任何工作。不要默认改成 60/180 秒超时，也不要把总回合超过 180 秒当自动取消条件。

**2026-09-10 续：阶段已经定下来了，没有新开局。** 读法与全部锚点在 `.coc/playtests/pdf-opening-app-20260910/provider-timeout-analysis.md`，结论并入 [pi-host-contract.md](pi-host-contract.md) 的“Provider latency evidence”小节。要点：300000 毫秒是 Pi 的 `DEFAULT_HTTP_IDLE_TIMEOUT_MS` 默认值，本产品任何 settings 都没有设过；`openai@6.40.0` 把这个计时器夹在 `fetch` 的 `finally` 里，而 `fetch` 在响应头到达时就结束，所以这 300 秒**只覆盖等响应头，永远覆盖不到流**。同一段上下文在 2.030 秒后重发，8.499 秒就正常回来了。因此可以排除：上游在推理、上下文太大、期限设得太短、内部重试堆叠（provider 级重试 `maxRetries` 落到 0，一条 `provider-request` 就是一次 HTTP 尝试）、以及宿主车道并发（停顿的最后 2 分 34 秒没有任何读者/复核在跑）。「只覆盖等响应头」不是从源码推的，是量的：`.coc/playtests/pdf-opening-app-20260910/timeout-scope-probe.mjs` 用 App 自带的受管 Node 驱动 App 里那份 `openai@6.40.0`，对本地服务器打三种故障——不发状态行的那种在期限上抛出 `APIConnectionTimeoutError "Request timed out."`，而「响应头立刻到、之后静默 3 倍期限」完全不超时。输出留在 `timeout-scope-probe.out`。（第一版探针用 Node `http` 服务器，两种都超时、看着像推翻结论，那是探针的错：`res.writeHead()` 不会把响应头送上线。重跑必须用裸 socket 那一版。）

**这条请求不是直连 xAI。** 本机默认路由是 `utun4`（Surge 系统扩展，事发时已连续运行 3 天 5 小时），系统代理 `127.0.0.1:6152`；`undici` 不认代理环境变量，但躲不开路由，所以 App 的每一条 provider 连接都过它。隧道上游腿卡住、两边都不关，正好长这个样子——这让「五分钟一个字节没有」从离谱变成常见。但这只是说清了路径，**不等于判定卡在代理**。

**仍然分不开的**是哪一跳握着连接。Pi 没有套接字层钩子，宿主自己答不了；Surge 的 Requests 视图给每条连接计时并显示走了哪条策略，但它**只存在内存里**（`~/Library/Application Support/com.nssurge.surge-mac` 没有请求日志），必须在慢回合还在屏幕上时就去看。06:09:59Z 那条已经过去三天，找不回了。不要为此打补丁。这一次的 479.028 秒里有 300.007 秒（62.6%）是这一次死等。

下一次出现慢回合，用新增的 request/response 时间、HTTP 状态/request-id 和原有消息、工具、重试时间线区分阶段。现在这对时间戳可以直接当「到响应头的时间」读：间隔大 = 又一次开流前停顿；间隔小但回合仍慢 = 延迟在流或车道里；只有 request 行、没有 response 行、后面跟一条 `stopReason:"error"` = 又一次响应头停顿。注意**两个档里现存的 566 条 `provider-request` 行全是旧包写的，没有 `at`，也没有配对的 response 行**——第一对可用证据要等当前安装包上跑出的第一个回合。不要给瞬态供应商问题写一个猜测性的生产补丁。

### 2. 有限验证整体等待是否改善

只有需要验证新的行为时再跑一轮真实行动，不为凑回合数反复开局。使用最新冻结且已打包的候选；确认最终场景/收据和恢复输入，而非只看到窗口打开。分别记录模型、读取、复核、Mod audit、提交、最后模型尾部。不能以缓存命中冒充冷解析提速。

### 3. 最新源码与 App 的分发差距

源码在本会话实现之后已被其他任务推进。写本文时 `53fa8e47..972e5fc1` 包含语言档案/Natural NPC、Mod audit 超时处理、驾驭器 settle 修复、Python 对照静态化等改动。它们不是本会话最后安装包里的功能，也不应重复“再修一次”。先读各提交和 [language-barrier-probe-20260910.md](language-barrier-probe-20260910.md)，再确定真正缺的集成验证。

那份语言报告明确区分了 staged probe 和真实验收，列有尚未测试的 full/light 差异、长局语言障碍、实际 reasoning effort 等限制。不要将它写成已完成长局验收。本会话未替这些其他任务重新认证结果。

### 用户明确暂缓的事项

独立干净机器/虚拟机验收、正式分发收尾按用户要求跳过。使用自签名；不要擅自重开 notarization、购买证书或对外发布任务。GitHub #35/子票最新开闭状态本次未重新联网核查；[runtime-consolidation-tickets.md](specs/runtime-consolidation-tickets.md) 有大量历史检查点，不能将其中旧“待合入/待签名”段落当作当前缺口。

## 证据与续测入口

工作区内的记录（均未删除）：

- `.coc/playtests/scene-material-latency-20260910/report.md`：本次修复、旧包/新包回归、安装收据、日志。
- `.coc/playtests/scene-prefetch-20260910/app-scene-transition.md`：真实场景迁移；另有读取阶段、安装和注册检查记录。
- `.coc/playtests/pdf-opening-app-20260910/isolated-run-report.md`：原 PDF 建卡/开场记录。
- `.coc/playtests/pdf-opening-latency-20260910/`：更早的开局耗时证据。

独立验收档（不是普通玩家档）：

- 产品配置：`/Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-v2/.coc/playtests/pdf-opening-app-20260910/product-profile.json`
- userData：`/Users/haoli/Library/Application Support/Pipi/pipicoc-pdf-opening-acceptance-20260910`
- COC home：上述目录下的 `pi-coc`。
- 战役：`game-7976945e-74a9-4f3b-a7e3-e2873f95c52a`，调查员周宁；本会话停在第 4 回合博物馆。
- 主 Pi 会话：`pi-coc/agent/ui-sessions/play/%2FUsers%2Fhaoli%2Fleehow%2Fcode%2Fchatrpgv4-wt-pi-coc-v2%2F.coc%2Fplaytests%2Fpdf-opening-app-20260910/2026-09-10T04-47-47-705Z_7f1b7374-0208-4b0d-aa80-b1c2c0f8deb6.jsonl`。
- 时间线：`pi-coc/agent/telemetry/turns.jsonl`、`pi-coc/.coc/reading-telemetry.jsonl` 及该 campaign 的 `telemetry.jsonl`。
- 原 PDF：`/Users/haoli/Documents/TRPG/coc英文/Call of Cthulhu - Masks of Nyarlathotep (Larry DiTillio, Lynn Willis, Mike Mason etc.).pdf`；669 页，SHA-256 `806966db20202a020af6213695dccc0b547fc998a73dd2f1344567e2579a1942`。

## 必须延续的用户约束

- 真正玩测用可见 PipiCOC App，Grok 为守秘人，一次一句自然玩家输入；用户已经授权替代旧 driver 传输。若继续已有战役，首个战役操作走 `session.resume` / 既有 App 恢复流程，不先扫存档拼上下文。
- 用户指定经济型 Terra worker 负责测试；保留 180 秒观察阈值，不自动取消、不用假 Keeper/脚本玩家/手填场景伪装游玩。
- 测试时在隔离档关闭 Item Enhancement；本会话验证过旧隔离档本局和默认开关都为 0，后续版本应再看实际状态。普通档 Mods 不改。
- App 侧边栏“另建项目”不隔离 COC home；必须用上述独立 `PIPIUI_PRODUCT_CONFIG`。不要仅依赖 `--user-data-dir`，产品启动会设置自己的 userData。
- 普通档是 `~/Library/Application Support/Pipi/pipicoc`。不要向大牛皮发送测试动作，不覆盖凭据；任何日志都不打印 auth 内容。
- 后台记忆和校验可能在玩家轮结束后继续，不能把它们的耗时全加到玩家等待上。
- Python 生产实现不恢复、不从旧 Git 找回来继续改。后续提交已经在推进静态对照，先看当前测试入口再决定命令；已有旧对照记录不代表应启动 Python 内核。

## 打包与 worktree 注意事项

规范入口是本仓库 `pipicoc/package.mjs`，规范 App 为 `/Applications/PipiCOC.app`，稳定签名身份 `PipiUI Dev`。受管 Node 可用 `/Applications/PipiCOC.app/Contents/Resources/pi-coc/node/bin/node`（24.19.0 / ABI137）；随便取系统 Node22 会导致原生扩展 ABI 不匹配。

打包/重启前先读全局 macOS App hygiene 和仓库配方。不要启动 worktree 内的副本，不要修改或重签名仍在运行的 App。保留旧包、冻结测试与打包的源码版本、核对实际安装清单，再检查 LaunchServices/Spotlight。恢复普通档时移除测试进程的产品配置 override。

两个本会话 worktree 均已完成生命周期分类，**不是仍在工作的 worker**：

- `/Users/haoli/leehow/code/chatrpgv4-wt-scene-prefetch`，`codex/scene-prefetch`，terminal `retained:locked`。
- `/Users/haoli/leehow/code/chatrpgv4-wt-scene-material-latency`，`codex/scene-material-latency`，terminal `retained:locked`。

它们含唯一原始证据和旧安装包备份，不能为“收尾”删除。其余既有 worktree 不属于本任务，不接管、不清理。下一轮 Git 操作前照常核对 dirty 文件和 ownership；“全部提交”在本会话只操作了主工作区。

## 下一轮最短启动顺序

1. 读本文件和 `Agents.md`，核对 `git status --short --branch`、HEAD 和实际 App 版本。
2. 根据用户当时要处理的是模型超时、最新代码重包还是另一项问题，选择一条路径；不重启整个 #35 迁移或整本解析。
3. 先用已有日志/回归证据，只有修改相关行为后才补必要验证；没有同条件测量就不承诺整体节省秒数。
