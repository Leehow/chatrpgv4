# PDF、SQLite、慢回合与开场修复交接（2026-10-10）

用户已授权自主修复、测试并保留全部真实证据，现在要求交给其他 AI。本聊天停止继续实现和玩测；自动续跑 `pdf` 已通过 App 工具暂停，原提示和调度保留。接手目标：修复有证据的系统缺陷，在原门槛下完成真实建卡、开桌和阅读验证。

## 当前状态

| 项目 | 交接时核实的状态 |
| --- | --- |
| 主检出 | `/Users/haoli/leehow/code/chatrpgv4-wt-pi-coc-v2`；最新主线 `0.9.7a`，HEAD `caf1f5537`，干净，领先 origin 5 个提交 |
| 修复检出 | `/Users/haoli/.codex/worktrees/pdf-source-latency-opening-20261010` |
| 修复分支 | `codex/pdf-source-latency-opening-20261010`；写交接前 HEAD `c20318025`，其后仅有交接文档提交；以实际 Git 为准 |
| 集成 | `303a8f061` 已合入上述主线基底；本任务修复尚未反向合入主线，无推送 |
| 工作区 | 原有唯一未跟踪文件 `PLAYTEST_EVIDENCE.json` 是证据保护标记，保留、不提交 |
| 编译产物 | 现有 `build/` 对应 `7ae3c440e`，对当前修复已过期，不能用于验收 |
| 验证 | 局部测试通过；旧全量两项失败已修代码；最新全量、精确重建和真实复验待完成 |
| 生命周期 | 本任务条目 terminal，因未验证、未集成和真实证据而保留，不能清理 |

下文 **W** 为修复检出，**E** 为 `W/.coc/playtests/pdf-source-latency-opening-20261010-evidence`。源码路径相对 W。本文件是当前入口，历史细节按需查 [原执行计划](exec-plans/active/pdf-source-latency-opening-20261010.md)。计划中早期“尚未实现”和 heartbeat ACTIVE 是当时记录，不代表交接时状态。

## 按顺序接手

1. **确认归属和实际状态。** 读主检出的 `AGENTS.md`、`docs/kernel-rpc.md` §212、PDF 规格，以及 `/Users/haoli/.codex/policies/worktree-lifecycle.md`。检查两个检出的 `git status --short --branch`、HEAD、最新 `0.*a` 和 `git worktree list`。新聊天不得默认拥有旧任务生命周期条目；依据政策核实归属，必要时用自己合法创建的检出承载修复，保留旧检出及证据。完成标准：主线漂移、归属、待验证源码及他人的改动已明确。
2. **测试机空闲后验证当前源码。** 用户明确 amax 不在 LAN，使用 leehow-pc。读 `/Users/haoli/.codex/skills/leehow-pc-tests/SKILL.md`，执行 canonical probe，并另查在途构建。上次其他任务仍占用，交接没有重新探测，旧 PID 不代表当前状态。不要停止别人的进程或绕过 busy。完成标准：当前源码 canonical `all` 有真实退出码、三路汇总、全部日志，失败逐项处理。
3. **取得精确运行时。** 归档远端本次 raw/per-file 日志，再只读取回本次构建到自己的 build，核对 source maps 和原样加载的 JS/提示文件。`E/check-runtime.mjs` 生成带源码提交和产物哈希的新证明；换检出须先调整硬编码路径。完成标准：实际运行产物与当前源码匹配、差异为 0；旧 690/0 不能冒充新验证。
4. **真实复验保留的建卡草稿。** 用新 run 后缀保留旧 run。模型固定 Grok 4.7 Build Fast / low，主聊天为唯一自然语言玩家，一句一回合。恢复战役时 `session.resume` 是首个战役操作，走当前生产接线。完成标准：真实 `setup.confirm`、complete 收据和调查员状态成立，再真实 `table.open`，开场可以继续；正文自称完成不算。
5. **自然阅读验证。** 根据公开回复选择阅读，走已有载体的 look/document_page，或同一来源请求的 prepare 加真实 handout。完成标准：实际阅读证据、所有权保持、公开名字与来源可追溯；review、准入和姓名门槛保持。
6. **收尾。** 保存日志、KPI、失败和限制；复查主线漂移并只集成本任务改动；完成所有自己任务条目的 terminal/audit/分类，留中文结果。接手者自行决定新的调度，本聊天 heartbeat 保持暂停，避免双写。

```bash
S=/Users/haoli/.codex/skills/leehow-pc-tests/scripts/remote-test.sh
RT_HOST=leehow-pc "$S" probe
# 确认共享机器空闲、没有在途构建后：
RT_HOST=leehow-pc "$S" run /absolute/path/to/your-owned-worktree all
```

改代码可用 `focused`，合主线前必须 `all`。真实 driver、Keeper/Jev 留 Mac。不得为等待使用 FRP、busy 覆盖或在 Mac 跑重型全套。

## 已提交修复：最终验收仍待完成

契约是 `docs/kernel-rpc.md` **§212**。其他任务的 §209.13 和 §211 已保留；模型、超时、重试次数、资源上限、复核阈值未调整。

| 修复 | 入口与行为 |
| --- | --- |
| 网络错误诊断 | `extensions/grok-build-oauth/agent/transport-observation.js`：原来丢失包装异常的系统 cause；新增有界白名单 code/cause/AggregateError 链，含 ENOTFOUND。排除消息、地址、URL、堆栈、未知代码；循环和 throwing getter 不改变回调。诊断增强不等于网络已修复。 |
| 阅读路径 | `prompts/keeper.md`、`extensions/kernel/tools.ts`：调查员阅读不应指导为所有权变更。来源回答是守秘人咨询，不是玩家阅读或公开名字的收据；已有载体和 handout 各走既有路径。 |
| 准备导航 | `runtime/jev/source-answer-pages.ts`、`extensions/kernel/index.ts`、`extensions/kernel/source-answers.ts`：仅显式查询/翻页的未准备回答附同一 focus/question 的 prepare/handout 导航，宿主覆盖不可信路由；held/carried 默认省略，保护聚合预算。 |
| 分页稳定 | 原算法先分页，再用空余字节附可选导航；保持 4KiB 上限、原文、units、part 数和 ordinals，满页省略导航。 |
| 建卡确认接线 | `runtime/jev/setup-engine.ts`：drawn-card 歧义/审批投影真实 draft/loaded/confirmed/complete 初始快照和完整工具。工具返回优先；真实同意后确认、成功后完成，world 后续由 table.open 打开。不会自动同意、重复确认或覆盖 Jev 不可用兜底。 |

关键提交：诊断 `50c7c2a2d`；阅读 `748d89f84`、`7ae3c440e`；预算 `6932d3fe2`；建卡 `0bbc3bc14`、措辞 `8429edd18`；分页 `f030b1a2a`；契约编号 `e0e09b3c3`；合入基底 `303a8f061`。按实际分支 diff 集成，避免重复 cherry-pick 主线其他任务提交。

相关 tests/extension 文件：`grok-transport-observation.test.mjs`、`source-answer-cache.test.mjs`、`single-loop-held-answers.test.mjs`、`setup-driven-engine.test.mjs`、系统语言守卫。

## 验证状态与真实开场失败

| 证据 | 结果与边界 |
| --- | --- |
| 局部 | transport 26/26；setup 34/34（随后有小幅措辞调整）；held/cache 18/18；分页 cache 8/8；早期语言 5/5；合主线相关 context/clock 14/14。不能替代最新 all。 |
| LAN all `7ae3c440e` | 891 秒；ext 5448 pass / 2 fail / 1 skip；py 2128 pass / 2 skip；loop 12 pass。两项 held-answer 失败因导航挤占预算；生产代码已修，旧断言与上限未放宽。 |
| 旧运行时 | 当时 690 嵌入源码 / 0 差异，仅证明 7ae。 |
| genuine setup | run `pdf-source-latency-opening-20261010-setup`：四回合 39.758 / 47.085 / 8.967 / 9.118 秒，2 次工具，正常停止。最后两回合口头完成，实际仍 setting_up、没有调查员、只有草稿。 |

公开选择：中文、原 PDF、42 岁男性农学/植物病理研究者、教授职业、第二个非逮捕的作物失败开场；姓名“谢尔盖·伊万诺维奇·维特罗夫”，笔记本、铅笔、样品袋，谨慎求证。自然确认应保持这些已选内容。

技术审计：第 3 回合 card_fields .91 与 approve_card .82 为 several_moves，旧 compose 的“无工具”指令未被新审批步骤替换；第 4 回合 approve_card .97、工具存在，仍没有确认/完成调用。旧指令还混淆“确认”和“创建世界”。已修投影，**尚未真实证明开桌成功**。

这是新 module/campaign、复用 48 份页转写，即“冷战役、温页面缓存”，不是全冷 PDF 基准。原 PDF SHA-256：`e4832eec4aa06a2a4946ac91e9b82388b2a7419310308b625171df95f15ec771`。

## 慢回合与来源失败

| 样本 | 已归因部分 |
| --- | --- |
| 159.629 秒 | 111.591 秒等前次自动开场就绪；输入后模型 33.416 + 7.894 秒。 |
| driver 300.010 秒超时 | 实际 377.721 秒 settled、未正常交付；11 次 provider 121.293 秒，8 次退避实际 242.233 秒，3 次来源查询仅 2.365 秒。 |
| 110.594 秒 | 6 次模型 71.216 秒、工具 22.006 秒；阅读误走所有权转移，被正确拒绝。隐式 narrate 拒绝后额外重生成 23.608 秒。 |
| 83.150 秒 | 3 次模型 53.054 秒、工具 14.767 秒；笔记真实追加成功。 |

健康调用 header 常 1–2.8 秒；部分长调用有大量 reasoning 事件跨度。不能全归网络慢，也未证明 payload 大就是根因。尚有约 12–14 秒 hooks/预处理/提交未唯一归因。历史网络故障缺底层码，不能倒推 DNS/TLS；新诊断用于下一次失败，未改变退避策略。

上一 SQLite 运行 8 个 failed source jobs：5 个内容/连接复核拒绝、3 个 transport 失败，最终组合只新增 read18。map 预览与反馈确已到作者，无证据说明 PDF 访问被禁止。read18 首次结构反馈已送达，后来跨页续文是新复核发现，作者未请求下一页。不能靠降门槛或强制全部重读刷绿。无剧情细节见 `E/repair-input-audit.json`。

## 已集成的 SQLite 批次

前一批 `/Users/haoli/.codex/worktrees/sqlite-task-transcript-20261010` 已集成主线 `5f1d63b67`：通用 TaskStore、home 页面转写/claim 管理；更早来源队列 SQLite 已在基底，勿重复迁移。详细范围见该树 `docs/exec-plans/active/sqlite-task-transcript-20261010.md`。

最后 all `934bc3383`：ext 5446 pass / 0 fail / 1 skip；py 2128 pass / 2 skip；loop 12 pass，611 秒；48 legacy import 字节/摘要保留，integrity 正常。真实两回合 110.594 / 83.150 秒。**默认 TaskRuntime flags 关闭，该真实运行不能证明可选 TaskStore 已在生产开启**；通用执行器由 runtime、多进程/crash 测试覆盖。本次不扩大到未批准的新迁移。

## 证据和启动索引

| 路径 | 用途 |
| --- | --- |
| `E/repair-input-audit.json` | 来源、预览、阅读接缝无剧情审计 |
| `E/opening-live-audit.json` | 模型和审批状态审计；准确四次耗时以原 turn 文件为准 |
| `E/all-7ae3c440e/` | 红色 all 的 612 份 per-file 结果与原始 lane 日志 |
| `E/runtime-proof-7ae3c440e.json` | 旧产物证明，保留、不可复用结论 |
| `E/check-runtime.mjs` | 新证明工具，输出用新名，检查硬编码路径 |
| `E/start-live.mjs` | 仅 driver 启动，不含玩家脚本；参数 setup/play + 新后缀，拒绝覆盖已有 run |
| `W/.coc/playtests/pdf-source-latency-opening-20261010-setup/` | 原四 turn、events、final、启动记录 |
| 同前缀 `-home/` | 真战役、module、draft、缓存，全部保留 |
| `E/source-input.json`、同前缀 `-input/source.pdf` | 原 PDF 与 48 份 legacy 页摘要 |
| `E/transport/`、E 根目录 `*.log` | 调用诊断、局部测试日志，保留失败 |
| `E/final-handoff-lifecycle-audit.json` | 交接最终保留分类与核查 |

更早 PDF 树 `/Users/haoli/.codex/worktrees/pdf-read-repair-20261009` 的 `docs/exec-plans/active/pdf-read-repair-20261009.md` 及结果记录供按需查询，证据保留，勿收编/清理。早期 amax focused 中断，远端最终退出码未收集，不算通过；取证前勿刷新旧 scratch。

凭据使用已有 native auth 链接：`W/.pi/coc-agent/auth.json` 指向旧 PDF 树的 `.pi/coc-agent/auth.json`。Jev vault 在 `/Users/haoli/Library/Application Support/Pipi/pipicoc/pi-coc/agent/`，`start-live.mjs` 只在启动/子进程内存解密，禁止输出、明文复制或放命令参数。脚本硬编码 W 与旧主检出 cwd，换树需按归属调整。driver 使用 `uv run --frozen python`，Node `/Users/haoli/.local/bin/node`。

生产只有 `kernel-ts/`，保留原始证据和 review/consent/name/resource 门槛。验收仅 `tests/play/driver.py`、当前 `bin/pi-coc-setup` / `bin/pi-coc`、`grok-build/grok-4.7-build-fast` / low。禁止 Astra、假 Keeper、scripted player、手工 RPC/改状态冒充确认、不存在的 UI 点击。玩家只看公开回复；私有图、原文、thinking 交独立技术审计，仅收无剧情结论。旧插件不认 TS save 时不能恢复 Python 内核或迁移证据绕过。

本次交接仅文档和调度状态；没有再跑模型、改 App、主检出 build、他人文件或进程。完成条件仍是最新源码真实验证并按范围集成，生成本文件不等于修复验收完成。
