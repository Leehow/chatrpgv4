# 项目规则 — pi-coc 0.9.0a

这份文件管这个分支上的一切工作。先读它，再按下面的路由读需要的契约；不要在开工时把所有文档都读一遍。

## 分支地图（先看这个，别搞混）

| 分支 | 是什么 | 怎么用 |
| --- | --- | --- |
| **`0.9.0a`** | 重构后的产品：一个 Pi 包 + 一个 Python 内核子进程，守秘人只见七个动词。从孤儿分支重建，**从来没有包含过旧树**。 | 只在这里开发。检出在 worktree `chatrpgv4-wt-pi-coc-v2`（或你自己的 worktree）。 |
| `0.8.2a`、`main` 及所有 `claude/*`、`codex/*` 旧分支 | 重构前的旧树（`plugins/coc-keeper/`、MCP、typed tools、七文件 IR、steward……）。 | **只读参照，不清空，不在上面开发，不合并进来。** 还有东西没搬完（见下），要搬的时候用 `git show 0.8.2a:<路径>` 读，或者读主检出 `/Users/haoli/leehow/code/chatrpgv4`（它停在 `0.8.2a`）。搬的是想法和数据（规则表、图、测试断言），不是机器。 |

明确**没搬、也不打算按旧样子搬**的：web/Electron 前端（未来在 PipiUI 基础版上用 pipi 插件做，现在只留了 Pi RPC 事件流与内核 `campaign.*`/`table.look` 两个接口）、steward 子代理车道（职责归图与深读队列）、世界线/时间线分叉与汇流、跨战役记忆、house rules 的提议/确认流程、Director 的 storylet、战报导出与地图供应技能、OCR worker（原 PDF 由宿主页面访问器与带工具 Pi 读者处理）。真桌暴露的 #19–#22 已做完并关票；世界线按契约 §15 在票 #23 重做（不是搬旧树）。

如果你发现自己在读 `plugins/coc-keeper/…` 或 `coc_toolbox.py`，你在旧树上——停下来，回到这张表。

## 路由

| 工作 | 必读 |
| --- | --- |
| 扩展与内核之间的一切（方法、收据、回合状态机、胶囊、resolve 流水线、提交链、Director、模组车道、世界线、系统语言与机制投影） | `docs/kernel-rpc.md`。**改契约先于改代码**；每个切片的实现决定记在对应的「内核的决定」小节。 |
| PDF 阅读、构图、按需补读或旧解析链路退役 | `docs/specs/visual-pdf-reader.md`、`docs/kernel-rpc.md` §22 与 GitHub #34。视觉实现与旧路径退役已接线；最后验证状态见规格实施记录；保留全部证据，Electron 留后。 |
| 对 Pi 的依赖、绕法、升版 | `docs/pi-host-contract.md`。不 fork、不打补丁。 |
| 架构规格与切片票 | GitHub issue #12（规格）、#13–#18（切片，已关）、#19–#22（真桌缺口，已关）、#26（切片 7：系统语言英文、机制 JSON）、#23（切片 8：世界线，契约 §15，代码已做完，§15.8 的真桌验收未跑）、#25（`apply npc`，留后）。用 `gh`。 |
| 决策记录 | `docs/adr/`。 |
| 真桌验收怎么做、证据在哪 | `docs/acceptance.md`。 |
| 布局、跑法、测试 | `README.md`。 |

## 意图优先于交付物（先读）

**交付物为意图服务，不是反过来。** 动大活之前先写清：用户想达成什么、什么叫成功、什么样的「完成」是空心的（文件、测试、回合数、报告齐了但没解决用户的事）。

- 真做的几步胜过合成的体量。计数、覆盖率、报告、状态文件只有在方法匹配意图之后才算证据。
- 用户要求、观察到的事实、推断、提议分开写。只在真正的歧义会实质改变范围时才问。
- 不许把任务换成更容易的目标；不许因为已有产物就沿着已知错的路走；不许把答案打磨成另一个问题的答案。
- 发现跑偏就停下，说出偏在哪，回到用户真正的事；不服务意图的产物标 `invalid-for-intent`，验收相关的再标 `invalid-for-acceptance`，不许洗成进度。
- Grok 系模型在多步工作前必须先写：「用户想达成 ___。成功是 ___。空心交付是 ___。」凡是强调「跑完 N 回合」「出一份报告」的总结都可疑，重查。

## 修补先看全局（System Gap Before Instance Patch）

用户说修、补、fix、补深挖、修体验时：

1. 先命名这是哪一类产品/运行时失败。
2. 检查这一类现有的路径：契约、内核方法、扩展钩子、内容表、测试、票。
3. 修或扩展那条**系统路径**，让下一个同类情况自动成立。
4. 只在用户明确要内容、或系统路径已通之后，才加一条标明的薄样例。

「玩家挖了 X、X 薄」不是手写这一处内容的许可。只有「修系统还是补内容」真的分不清时才问。

## 真桌验收方法与三条硬禁令

**Pi-Coc 的验收 / 体验 / 开桌 / 实机测试 / 端到端只有一种方法**（用户说这些词就是在点这一条，不是在点建战役、pytest 或把命令行扔给用户）：

1. 用 `tests/play/driver.py` 以 RPC 模式起 `bin/pi-coc`（建卡用 `--launcher bin/pi-coc-setup`）。驾驭器只做传输。
2. **grok 当守秘人**（模型在 `.pi/coc-agent/settings.json` 里定），驱动全部判断、叙事、NPC、规则调用。
3. **本主会话就是唯一玩家。** 一次一句自然的话，一回合一回，从建卡/开场跑到结局或真阻断。不问「要我当玩家吗」——角色已定死。
4. 沿途覆盖要测的能力点，不预设脚本，由守秘人正常推进。
5. **慢可以，假不行。**
6. 证据是 `.coc/campaigns/<id>/` 的回合记录与遥测、`.coc/playtests/<run>/`、`.coc/modules/<id>/`；指标用 `tests/play/kpi.py`。

### Absolute Ban: Fake-KP Shortcut Scripts

禁止任何冒充游玩的东西：批量结算、`kp_settle_turn` 一类的假守秘人、关键词路由意图、场景模板银行刷回合、pytest/fixture/scripted player/第二套 Keeper 冒充桌子、只建战役然后让用户自己去开。长局「100 轮」= 很多真回合，不是合成记录。违反即 `invalid-for-acceptance`，哪怕战役目录已经存在。这条被违反过多次。

### Special warning — Grok / Grok Build models

Grok 系模型屡次把「交付」当目标、把意图当配菜，也屡次静默换成假守秘人脚本。执行前 hard stop 重读本节与上一节；写出意图检查再动手。

### Standing Memory: Never Self-Authorize a Different Playtest Method

正确玩测 = 与「开一窗跑插件」同构（主会话 live 守秘人，真人/单句玩家，一回合一回）。任何非默认方法（批处理、假守秘人、造景脚本代替真玩）必须**在当前回合由用户明文授权**；必须先说明正确方法与它会变慢。不告知用户就换方法 = 违规，事后道歉不算记住。认错要写成永久规则，这一节就是。

## 永久法：不许毁掉玩测证据

战役目录、逐字记录、事件流、遥测、模组存储、玩测目录是**唯一证据**。不许为了「重新开始」「换了 schema」「已经出了报告」而删除。要新局就新建战役 id；删除只能由用户明文授权。这个错误在旧树时代犯过四次。

## 文本工作必须跑成带工具的 Pi agent（有例外先问）

对文档/模组文本做「读文本 → 产出结构」的模型工作，必须是带 `read/write/edit/bash` 的 pi agent：不是 `--no-tools`，不是单次补全，不是裸 provider 调用。原因是量出来的：单次补全要把整个答案塞进一条助手消息，本项目通道的上限约 47,000 字符，整条管线会围着它变形（切小叶子、成倍调用、密度掉一半、findings 来回递）。带工具的 agent 自己开包、分多次写文件、自己跑闸门、自己改。agent 模式去掉的是长度限制，去不掉义务：只写源里有的、引用真实 span、由同一套确定性闸门判。

0.9.0a 里的落实：模组读者是每 section 一个子 `pi -p --no-extensions --tools read,write,edit,bash`（`--no-extensions` 必须，否则子进程会再拉一个内核）。**唯一的例外**是记忆抽取与校验两条车道：产出是十几条短 JSON，规格 #12 定为零工具子会话，实现是一次不带工具的补全——嵌套零工具会话在 0.85.1 里起得了，是权衡后没走（`docs/pi-host-contract.md` 第 5 节）；这个例外 2026-09-06 已由用户裁定保留，**不得推广到任何别的文本工作**。想用别的形状，当前回合先问。

## 系统语言是英文，玩家语言由模型产出（2026-09-06 用户裁定）

- **代码、提示、工具描述、宿主消息、内核写给守秘人的一切文字（胶囊、压力、义务、Director 理由、检查点、事实句、车道指令、读者简报）只用英文。** 代码里不许有中文，注释也不许；`tests/kernel/test_system_language.py` 与 `tests/extension/system-language.test.mjs` 扫 CJK 守着这条。
- **玩家看到的文字由守秘人模型按战役的 `play_language` 写**（闭合集 `zh-Hans`、`en`）。守秘人是 agent，自己会语义理解，不需要翻译层；**不做 i18n 字符串表**，不按语言分支渲染。
- **机制不渲染成文字，投影成 JSON。** 收据 → `mechanics` 列表（契约 §16.2），随 `narrate`/`ask` 结果回来，扩展落成会话条目 `coc-mechanics` 与总线 `coc:mechanics`，给未来的 Electron/web 前端渲染骰子卡与变化条；TUI 只显示守秘人正文。
- **确定性底线换成核对数字**：守秘人必须在正文里用玩家语言说出每条公开收据的关键数字（掷值/目标、伤害前后、分钟数……），内核逐字核对，缺了拒绝 `narrate`（`mechanics_missing`）并在 `fix` 里说缺什么。
- 内容数据（模组图、starter、玩测证据）是它本来的语言，不受此条约束；`content/setup/steps.json`、`content/craft/beat-directives.json` 是系统内容，英文。

## 语义问题不许硬编码

性别、名字分类、语言检测、情感、意图、相关性这类开放语义问题，禁止用列表/正则/映射表解决——必须交给模型（守秘人、读者、车道）或问用户。允许的是闭合词表（契约枚举）、名字归一化匹配、id 语法、段落切分。发现自己在写 `const xxxList = [...]` 或 `text.match(/A|B|C/)` 做语义分类，立刻停下问用户。

## 产品不变量

- **内核不解析 PDF**：PDF 处理只发生在宿主，Python 侧禁止 import PDF 库的两条测试不变。当前来源契约见 §22：原 PDF、按需页图、带工具 Pi 读者、独立复核和可追溯图谱；OCR/Markdown 资料包生产路径已退役。
- 守秘人是产品：语义意图、因果、NPC、叙事归它；规则归内核算术；状态归内核事务。模组真相只读且默认保密，玩家猜对了仍是猜测。
- 数值只出自 `resolve`，世界改变只经 `apply`，叙述里发生了却没收据的事等于没发生。
- 模型可见的标识都是名字；哈希、收据 id、call id 由宿主与内核铸造，不让模型抄。
- 模组是参考不是圣经：场景门取向偏开，时钟是守秘人的节奏仪表。
- 宿主限制要显式：Pi 没有出站附件通道，手卡降级为路径行；确定性测试不等于真玩。

## Pi home 隔离（binding）

Pi 完全隔离在仓库内：游玩用 `{repo}/.pi/coc-agent`（`PI_CODING_AGENT_DIR`），编码用 `{repo}/.pi/agent`。不用 `~/.pi/*`，不把 COC 包装进全局 settings，不把这个 home 软链回 `~/.pi`。`auth.json`/`models.json` 永不提交。

## Python 解释器契约

唯一环境由 `.python-version`、`pyproject.toml` 与提交的 `uv.lock` 定义。所有 Python 命令从仓库根以 `uv run --frozen python …` 运行（别处加 `--project <repo>`）；子进程用 `sys.executable`；不从 `PATH` 挑 `python`。升级 Python 或依赖是一次跨 `.python-version`/`pyproject`/`uv.lock`/文档的原子改动。

## 开发方法

- **契约先行**：先在 `docs/kernel-rpc.md` 写形状，再开工；worker 只按契约写，形状对不上以契约为准，集成时补回归用例。
- **worker 按任务选模型**：内核实现用 Fable；扩展用 Opus；测试、驾驭器、机械迁移用 Sonnet/Haiku；不全用一个模型。同一 worktree 的 worker 路径互斥、`commit_policy: no_commit`，由 lead 集成与提交。
- 测试：`uv run --frozen python -m pytest tests/kernel tests/play -q` 与 `npm run test:ext`。**不要并发跑两个 pytest**（临时目录会撞出幻影失败）；提交前看真实退出码，别信 `pytest | tail`。
- 主检出与共享 worktree 上禁用 `git stash`、`reset --hard`、`checkout --`、`clean`；要隔离就开临时 worktree。不推、不删分支、不改共享历史，除非用户当回合明说。
- 每次真桌验收都会找出几个接缝看不见的系统缺陷：给每个切片预留一次修复提交。
