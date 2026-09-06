# Pi 宿主契约

我们不 fork Pi，也不打补丁。这份文件写清 pi-coc 依赖 Pi 的哪些接口与行为、我们在哪里绕过了它的限制、想请上游改什么，以及 Pi 升版时怎么核对。Pi 升级 = 改一个版本号，然后按第 7 节走一遍。

当前依据版本：`@earendil-works/pi-coding-agent` 0.85.1。`package.json` 用 `devDependencies` 钉死版本供启动器执行，用 `peerDependencies: "*"` 声明扩展导入的 Pi 核心包，遵循 Pi 的包规范。

## 1. 启动契约

`bin/pi-coc` 只依赖这些 CLI 参数：

| 参数 | 我们依赖的语义 |
| --- | --- |
| `--no-builtin-tools` | 关掉 read/bash/edit/write，KP 只见扩展工具 |
| `--system-prompt <file>` | **替换**缺省提示。Pi 之后只再追加一行 `Current working directory`，以及在有 `read` 或 `bash` 工具时的 skills 索引；我们没有这两个工具，所以 skills 索引不会出现。不要改回 `--append-system-prompt`，那会把「You are an expert coding assistant operating inside pi」放在 KP 提示最前面 |
| `--no-context-files` | 不加载 AGENTS.md 等上下文文件 |
| `--session-id <id>` | 一张桌子一个持久会话 |
| `--mode rpc`、`--no-session`、`--model` | 驾驭器与前端透传 |
| `-p`、`--no-extensions`、`--tools <list>` | 只给读者子进程用，见第 3.2 节 |

`--system-prompt` 收的是**文本或文件路径**：Pi 的 `resolvePromptInput` 先看这个值是不是一个存在的文件，是就读它。我们一直给路径。

Pi 家目录由 `PI_CODING_AGENT_DIR` 指定为仓库内 `.pi/coc-agent`；`settings.json` 里 `packages` 指向本仓库，`defaultProvider`/`defaultModel` 决定开桌那一轮用的模型，因为开桌轮在任何 RPC `set_model` 之前就触发。

`bin/pi-coc` 有两个模式（契约 §14.4），只差三样东西：提示页、会话 id、`PI_COC_MODE`。

| 命令 | `PI_COC_MODE` | 系统提示 | 会话 id |
| --- | --- | --- | --- |
| `bin/pi-coc [--campaign <id>]` | `play` | `prompts/keeper.md` | `coc-<id>` |
| `bin/pi-coc setup [--campaign <id>]` | `setup` | `prompts/setup.md` | `coc-setup-<id>` |

模式由**扩展自己读**（`extensions/lanes/host.ts` 的 `cocMode()`），Pi 那边没有「模式」这个概念：`play` 里 kernel 扩展注册七个动词、onboarding 什么都不注册；`setup` 里反过来，且 memory 与 table 扩展整个不注册（建卡进程没有回合、没有桌况）。kernel 扩展在两个模式下都拉起内核子进程——建卡要 `campaign.*`、`module.*`、`setup.*`——但 setup 模式不 `table.open`、不注册工具、不跑校验车道，战役可能还不存在。**模式在扩展工厂里读，不在模块顶层读**：测试台一个进程里加载多次，顶层常量会被第一次的值冻住。

## 2. 包清单

`package.json` 的 `pi` 字段只声明 `extensions`，五个：`kernel`（内核子进程与七个动词、校验车道）、`onboarding`（建卡的一个 `setup` 工具，只在 setup 模式注册）、`module`（无人值守构建与按需深读，两个模式都不注册工具）、`memory`（记忆抽取车道）、`table`（桌况显示）。加载顺序有意义：`kernel` 在最前，它在 `session_start` 里把内核 RPC 闭包发上总线，后面几个扩展的 `session_start` 才拿得到（扩展的 `session_start` 按加载顺序串行跑）；即便如此每个扩展都在**加载时**就订阅 `coc:kernel-bridge`，两种顺序都接得住。

`extensions/lanes/` 不是扩展，是几个扩展共用的模块，只被 import，不进 `pi.extensions`：`subsession.ts`（两条车道的零工具补全）与 `host.ts`（运行模式与 JSONL 追加）。手艺文档走回合胶囊的 `style` 节，不走 Pi skills；`prompts` 目录只被启动器读取，不交给 Pi 发现。

**提示词的语言（契约 §16.1）**：`prompts/keeper.md` 与 `prompts/setup.md` 是英文——系统语言是英文，`extensions/**`、`bin/*`、`prompts/**` 里不出现中日韩字符（守卫在 `tests/extension/system-language.test.mjs`）。玩家看到的字不由提示词的语言决定：守秘人提示里有一句写死的法则，要求一切玩家可见的文字用战役的 `play_language` 写。所以换玩测语言不必改这两页，只改战役的 `play_language`。

## 3. 扩展 API：我们用到的面

事件：`session_start`、`session_shutdown`、`before_agent_start`、`agent_start`、`agent_end`、`agent_settled`、`turn_start`、`tool_call`、`tool_result`、`message_end`、`context`。

方法：`registerTool`（`name`、`label`、`description`、`promptSnippet`、`parameters` TypeBox、`executionMode`、`execute`）、`setActiveTools`（只在 `session_start` 调一次）、`sendMessage`（`customType`、`content`、`display`、`details`，`triggerTurn`）、`appendEntry`、`events`。

上下文：`ctx.cwd`、`ctx.hasUI`、`ctx.ui.notify` / `select` / `setStatus`、`ctx.model`、`ctx.modelRegistry.find` / `complete`。

总线：`pi.events.emit` / `on`。`on` 返回一个退订闭包，**没有 `off`**：要临时订阅（建卡等构建那一步）就得留着它自己收。十个频道：`coc:table-open`、`coc:resolve`、`coc:capsule`（本回合胶囊原样一份，桌况显示用它取 Director 节拍，契约 §13.9）、`coc:turn-committed`（契约 §12.8 的提交载荷）、`coc:mechanics`（契约 §16.2 的机制投影，见第 3.4 节）、`coc:kernel-bridge`（内核 RPC 闭包，见下），加上模组那四条（契约 §14.5）：`coc:module-build`（建卡的 `build-opening` 发起构建）、`coc:module-opening-ready`（开场就绪）、`coc:module-build-done`（整本读完，带报告）、`coc:module-build-failed`（构建起不来；有它建卡那一步才不会干等）。

`ctx.shutdown()`（「优雅退出 pi」）只在**交互模式与 RPC 模式**下真的做事：那两个模式在 `bindExtensions` 时给了 `shutdownHandler`，print 模式与 SDK 直接建的会话没给，调用是空转。建卡最后一步靠它退出进程，所以 `bin/pi-coc setup` 起的是交互模式；测试台里它是空转，所以断言看的是交接命令有没有交出去，不是进程有没有真的退。

### 3.1 零工具子会话：两条车道怎么起

契约 §12.3 与 §12.5 要的是「扩展内用 Pi SDK 起零工具内存会话」。Pi 里够得着这件事的面是 **`ctx.modelRegistry.complete(model, context, options)`**——`ModelRegistry` 自己的注释写着它就是「暴露给扩展的同步门面」，内部转 `ModelRuntime.stream().result()`，鉴权、baseUrl、自定义 provider 全走当前会话那一份。`context` 是 `{systemPrompt, messages, tools?}`；**`tools` 不给就是零工具**。实现在 `extensions/lanes/subsession.ts`，两条车道共用。

这不是绕路，是这条路本来就在扩展面上；但它是一次补全，不是一个会话，代价记在第 5 节。

模型选择（契约 §12.5、§12.8）：

| 环境变量 | 车道 | 缺省 |
| --- | --- | --- |
| `PI_COC_VERIFIER_MODEL` | kernel 扩展内的校验车道 | `ctx.model`，即桌子当前的模型 |
| `PI_COC_MEMORY_MODEL` | memory 扩展的抽取车道 | 同上 |

取值形如 `provider/model`，只在**第一个**斜杠上切（模型 id 自己可能带斜杠），再用 `ctx.modelRegistry.find(provider, id)` 取模型。解析不出来或注册表里没有：车道只落一行 `ok: false` 的遥测就结束，不动内核、不催守秘人。

记忆车道**先解析模型再叫 `memory.job`**：解析不出来就不把任务从内核那儿取走，免得它白白进 backlog 等人显式重派。

补抽（契约 §12.8 的 #20）也在这一侧：memory 扩展在 `session_start`（内核扩展已经发过桥）用**不带 `turn` 的** `memory.job` 一个一个地要上次会话漏掉的回合，内核回 `job_id: null` 就收手。

| 环境变量 | 管什么 | 缺省 |
| --- | --- | --- |
| `PI_COC_MEMORY_BACKFILL` | 每次会话至多补抽几个回合 | `5`；`0` 关掉整条补抽 |

预算在 `session_start` 读，不在模块顶层读（测试台一个进程里加载多次，顶层常量会被第一次的值冻住）。三条边界与桌子的关系：补抽仍是一次一个、跟桌上的抽取共用同一条队列；刚提交的回合永远排在补抽前面；**回合开着的时候不起新的补抽**——`agent_start` 到 `agent_settled` 之间就算回合开着（宿主自己发起的开场轮、恢复轮、催收轮也算），`agent_settled` 之后泵再踢一次。补抽的每一行遥测都带 `backfill: true`；缺省派发回空是补抽的正常收尾，不落遥测行（每次开桌记一行「没坑可补」只是噪音）。

两条车道各自的边界（扩展这一侧的决定，内核照此实现）：

- 校验车道**跑成功就叫一次 `table.warn`，哪怕 `findings` 是空的**：内核那边因此分得清「车道跑了、没发现」和「车道压根没跑」。所以 `table.warn` 必须收得下 `findings: []`。
- 发现在送出去之前先过闭合枚举与三个字符串字段的形状校验，认不出的整条丢掉，再按契约 §12.5 的上限截到 10 条——超限整批被判 `invalid_params` 的话，advisory 的东西反倒变成了噪音。同理，候选断言只送契约 §12.3 那八个字段，模型顺手写的 `turn`、`commit` 在扩展这一侧就摘掉。
- 内核不回 `facts` 时（切片 0、1 的 `narrate`）校验车道整条不起：没有事实清单，读什么都是猜。记忆车道照跑，任务包由内核按回合出。

跨扩展只有总线：memory 扩展要 `memory.job` / `submit` / `fail`，但内核子进程一个会话只有一个（契约 §1），所以 kernel 扩展在 `session_start` 用 `coc:kernel-bridge` 把一个 `call(method, params)` 闭包发上总线，`session_shutdown` 再发一次空的把它撤掉。总线是进程内的 `EventEmitter`，载荷不做序列化，闭包传得过去。

### 3.2 一段 section 一个子 `pi` 进程：读者怎么起

契约 §14.5（用户 2026-09-04 的法则）要的是「读书的模型工作跑成带工具的 agent」：它自己开抽取包、自己分多次写分片、自己跑闸门。第 3.1 节那条一次补全的路在这里不够用——它没有工具、没有多轮。所以读者是一个**真的子 `pi` 进程**，由 `extensions/module/reader.ts` 起：

```
pi -p --no-session --no-context-files --no-extensions --tools read,write,edit,bash \
   --system-prompt content/setup/reader.md [--model <provider/id>] -- <brief>
```

工作目录是 `work/<section_id>/`，`brief` 由 `module.packet` 给，作为最后一个位置参数（`--` 之后，所以 `-` 开头也不会被当成参数）。模型取 `PI_COC_BUILD_MODEL`，缺省与桌子同模型（`ctx.model` 拼成 `provider/id`）。

四件在契约里没写、由这一侧定下的事：

- **`--no-extensions` 必须给。** 不给的话子进程会顺着 `PI_CODING_AGENT_DIR` 的 `packages` 把本包的扩展再加载一遍：于是又拉起一个内核子进程（违反契约 §1），而且 kernel 扩展的 `setActiveTools` 会把 `--tools` 的允许清单顶掉，读者反而拿不到 read/write/bash。
- **`-p` 的语义与退出码。** print 模式跑完一轮 agent 就退出，把最后一条助手消息的文本块写到 stdout；助手消息 `stopReason` 是 `error` 或 `aborted` 时把错误写到 stderr 并 `exit 1`，抛异常也是 1，正常是 0（SIGTERM 143、SIGHUP 129）。我们**不读它的 stdout**：读者写得对不对由 `module.review` 的三道确定性门说了算，不由它自己那句话说了算。退出码只进遥测；非零退出的一轮照样跑一次 review，因为分片可能已经写下了。
- **环境。** `PI_CODING_AGENT_DIR` 原样继承（鉴权、模型目录在那儿），`PI_COC_CAMPAIGN` 与 `PI_COC_MODE` 显式摘掉，免得万一扩展被加载时它去开桌。
- **超时。** 一轮 `PI_COC_READER_TIMEOUT_MS`（缺省 15 分钟）后 SIGTERM，两秒后 SIGKILL；超时按「这一轮没过」算，findings 照样从 review 拿。会话关机时 `AbortController` 也走同一条掐断路径。

测试接缝：`PI_COC_READER_CMD`（JSON 字符串数组）替换整条命令，`brief` 仍作为最后一个参数——跟 `PI_COC_KERNEL_CMD` 同一个套路。测试里它指向 `tests/extension/fixtures/fake-reader.mjs`，那个假读者做的正是读者对外可见的那件事：在工作目录里写下 `shard.json`（`FAKE_READER_FAIL` 让指定的 section 非零退出）。**闸门过不过不由假读者决定**，由假内核的 `module.review` 决定，所以「三轮都没过就记 failed」这条路验得到。

### 3.3 手卡附件：Pi 没有出站附件通道

契约 §14.8 要 `apply` 的 `handout` 把资产「作为附件交给玩家（Pi RPC 的消息附件）」。Pi 这一侧做不到：`AssistantMessage.content` 的块只有 `text`、`thinking`、`toolCall` 三种；`ImageContent` 只出现在 `UserMessage`、`ToolResultMessage` 与 RPC 的 `prompt`/`steer`/`follow_up` 命令上——**都是进来的方向**。RPC 文档里的 `Attachment` 类型也挂在 `UserMessage` 上。也就是说：客户端能把图发给模型，宿主没有办法把图随交付发给玩家。

绕法（契约 §14.8 的备选，2026-09-06 按 §16.2 改过）：kernel 扩展把 `apply` 结果里的 `attachment`（或 `attachments`）攒到本回合的交付上，在 narrate／ask 成功时把它并进**机制投影**——投影里已有同名或同路径的 `handout` 行就补上 `path`／`media_type`，没有就新增一行 `{kind: "handout", name, path, media_type?, receipt?}`——并写两行遥测（`lane: "handout"`：`apply` 那次一行、交付那次一行带 `delivered_as: "mechanics"`）。**路径不再进玩家看的正文**：交付是守秘人的正文原样，投影才是机器读的那一份。真正的图由前端按 `path` 自己取，驾驭器从 `entry_appended` 里落证据。上游请求见第 6 节第 5 条。

### 3.4 机制投影：`coc-mechanics` 会话条目与 `coc:mechanics` 总线

契约 §16.2 的机制投影是**语言中立的 JSON**，不是给玩家看的字。内核不再渲染任何机制行：`narrate`／`ask` 的结果带 `mechanics: [...]`（每条对应一条收据：`roll`、`dice`、`change`、`scene`、`clue`、`time`、`item`、`cash`、`session`、`choice`、`handout`），kernel 扩展在这两个动词成功时做三件事：

1. `pi.appendEntry("coc-mechanics", {turn, mechanics})`。这是 Pi 里唯一一条「往会话里放一份机器读的数据、且不进模型上下文」的路：`CustomEntry` 不参与 `buildSessionContext`，所以守秘人下一回合不会看见它。
2. 总线上发 `coc:mechanics {campaign, turn, mechanics}`。table 扩展据此画一行紧凑的状态行（`t1  roll 42/55 pass  clue 地窖的抓痕`），**只画状态行，绝不往正文里插**。
3. 交付照旧：`message_end` 把助手消息的正文整体换成 `rendered_text`，而 `rendered_text` 现在就是守秘人写的正文原样。

投影为空（这一回合一条收据都没落）时不发条目，也不发总线：每回合记一行空的只是噪音。

**`appendEntry` 会发 `entry_appended`**（`agent-session.js` 里 `appendCustomEntry` 之后 `_emit({type: "entry_appended", entry})`），RPC 模式的 `toJsonEvent` 除 `message_update` 外原样透传，所以这条事件进 Pi RPC 事件流。`tests/play/driver.py` 把**收到的每一行**都写进 `events.jsonl`，因此机制投影不改驾驭器就已经落进证据；它没有进驾驭器自己的 `turn-<n>.json`（那份只记 `final_text` 与工具调用），要的话是驾驭器那一侧的一个小改动。

## 4. 我们依赖的行为，以及各自的核对方法

每条都有一个测试或一次真桌回合能证明；升版后失一条就是不兼容。

| 行为 | 核对 |
| --- | --- |
| `before_agent_start.prompt` 是玩家原文；返回 `message` 会在本轮开始前注入一条 custom 消息，`display:false` 仍进模型上下文，`content` 字符串原样进上下文（不被重排、不被美化） | `tests/extension/turn.test.mjs` 胶囊断言、`capsule.test.mjs` 逐字节断言 |
| `tool_call` 里就地改 `event.input` 会生效；返回 `{block, reason}` 让模型收到一条错误结果而不执行 | `gates.test.mjs` |
| `executionMode: "sequential"` 的工具按 assistant 消息里的顺序逐个 preflight 与执行，所以 `narrate` 之后同批余下调用能被拦住、`call_id` 序号确定 | `gates.test.mjs`、`turn.test.mjs` |
| `tool_result` 返回 `{isError:true}` 的局部补丁被采纳 | `session.test.mjs` 内核报错用例 |
| `message_end` 可用同 role 的替换消息覆盖已完成的助手消息，包括删掉文本块、替换文本块 | `turn.test.mjs`、`real-kernel.test.mjs` |
| `agent_end` 在每次 agent run 结束时触发，`sendMessage(..., {triggerTurn:true})` 能在其后开新一轮 | `session.test.mjs` 催收用例 |
| `agent_settled` 在 `_runAgentPrompt` 的 `finally` 里发，所以每一轮（含 `agent_end` 里排上的续行、自动重试、压缩）走完都恰好发一次，SDK 直接建的会话也发；`agent_start` 到它之间就是「回合开着」 | `lanes.test.mjs`「补抽让位给桌子」 |
| `session_start` 只在 `bindExtensions` 时发；`createAgentSession` 本身不发 | `harness.mjs` 注释与 `openTable` |
| RPC 帧只以 `\n` 分隔；`set_model` 收 `provider` 与 `modelId` 两个字段；`agent_settled` 是回合真正结束 | `tests/play/test_driver.py` 与真 Pi 冒烟 |
| 缺省提示替换后不再有「Available tools」一节，工具用法只靠工具自己的 `description` | 真桌回合：守秘人无需索引即能正确调用七个工具 |
| `ctx.modelRegistry.complete(model, {systemPrompt, messages})` 不带 `tools` 就是零工具补全，鉴权与 baseUrl 走当前会话的模型注册表 | `lanes.test.mjs` 两条车道用例：断言子会话收到的 `context.tools === undefined` |
| `ctx.modelRegistry.find(provider, id)` 取得到运行时注册进来的模型；`ctx.model` 是桌子当前的模型 | `lanes.test.mjs`「车道模型来自环境变量」与「不点名模型时两条车道都跟桌子同模型」 |
| `session_start` 拿到的 `ctx` 字段是取值时算的，之后仍反映当前模型；会话结束后它的 getter 会抛，车道因此整封失败 | 同上两个用例 |
| `pi.events` 是进程内 `EventEmitter`：载荷可带函数，跨扩展递内核 RPC 闭包可行；处理器抛错被总线吞掉，不影响回合 | `lanes.test.mjs` 记忆车道用例：memory 扩展只靠总线够到内核 |
| `message_end` 返回替换消息之后再排的 0 毫秒定时器跑在交付之后 | `lanes.test.mjs`「交付不等车道」 |
| `--system-prompt` 收文件路径；`-p` 打印最后一条助手消息的文本并退出，`stopReason` 出错时退出码 1 | `module.test.mjs` 的读者用例（假读者站在同一位置）、真读者冒烟 |
| `--no-extensions` 真的能让子进程一个扩展都不加载（否则读者会再拉起一个内核） | `module.test.mjs`：整场构建里内核请求只有一份、只有一个内核子进程 |
| 扩展工厂在每次 `resourceLoader.reload()` 时重跑，所以 `PI_COC_MODE` 在工厂里读得准 | `setup.test.mjs`「建卡模式：只注册 setup 这一个工具」与 `turn.test.mjs`（同一进程里两种模式） |
| `pi.setActiveTools` 由哪个扩展调都行，工具面按模式分岔 | `setup.test.mjs` 同上：`getActiveTools()` 恰好是 `["setup"]` |
| `pi.events.on` 返回退订闭包（没有 `off`），临时订阅收得干净 | `setup.test.mjs`「pdf 那条路」：`build-opening` 等到 `coc:module-opening-ready` 后不再堆订阅 |
| `ctx.shutdown()` 在没有 `shutdownHandler` 的模式下是空转，不抛 | `setup.test.mjs`「七步表走完」：交接命令交出去，测试台照常收尾 |
| 助手消息装不下附件（只有 text/thinking/toolCall），出站没有附件通道 | `module.test.mjs`「手卡」：路径落在机制投影与遥测里 |
| `pi.appendEntry(customType, data)` 写一条 `CustomEntry`，它不进 `buildSessionContext`，但会发 `entry_appended`，RPC 模式原样透传 | `turn.test.mjs`／`real-kernel.test.mjs`：`coc-mechanics` 条目里是每条收据的投影 |
| `message_end` 的替换消息可以**一个块都不剩**（内核以 `mechanics_missing` 退回隐式 narrate 时，被退回的正文整块摘掉，不留成一次交付） | `turn.test.mjs`「隐式 narrate 缺数字」 |
| 工具的 `parameters` 用 `additionalProperties: true` 时，模型摊在顶层的参数原样进 `execute` | `setup.test.mjs` 全部用例：`setup {step, ...params}` |

## 5. 已知限制与我们的绕法

- **流式文本**：助手在工具调用前写的文字会先流到客户端，我们在 `message_end` 才删。pi 的 TUI 会闪一下；我们的前端只渲染已提交的消息。提示词同时要求「调用其他工具时不要附带任何文字」。
- **SDK 生命周期**：`createAgentSession` 不发 `session_start`，`AgentSession.dispose` 不发 `session_shutdown`，`emitSessionShutdownEvent` 未从包根导出。测试台在 `bindExtensions` 后开桌，并借 `session._extensionRunner` 发 shutdown 让内核子进程退出。
- **工具结果没有 `isError`**：扩展在 `tool_result` 钩子里补旗。
- **`pi.getActiveTools` 只在扩展内可用**：测试台挂一个 inline 探针扩展取 `pi`。
- **Node 24 的 `node --test <目录>`** 把目录当文件：用 `npm run test:ext` 里的引号 glob。
- **扩展里起不了嵌套 agent 会话**：`createAgentSession` 要 `ModelRuntime` 与 `ResourceLoader`，扩展只拿得到 `ModelRegistry` 这个门面；就算硬凑出来，它会把本包的扩展再绑一遍，内核子进程就成了两个，违反契约 §1。所以车道是**一次补全，不是一个会话**：没有工具、没有多轮、不进会话记录、不吃 `SettingsManager` 的重试与压缩设置，token 也不进 Pi 的上下文统计（只进我们自己的遥测行）。两条车道的产出是 ≤ 12 条候选或 ≤ 10 条发现的短 JSON，本来就在一条助手消息的上限之下（规格第六、九节），所以这条限制现在不咬人；哪天车道要用工具，得先有上游的路，不是在这里凑。
- **`AgentSession.dispose()` 会把扩展 ctx 作废**：`dispose` 调 `runner.invalidate()`，之后那个 ctx 的每个 getter 都抛「stale after session replacement or reload」。车道是异步的，续行完全可能落在 dispose 之后（用户在车道飞着的时候退出 pi），所以**每一次碰 ctx 都当成会抛**：`runLane` 整个身子在 try 里，记忆车道的队列泵与遥测也各自兜住。漏一个就是一条没人接的 promise rejection——扩展测试跑六遍里中过两次。
- **子会话的思考等级不受控**：`complete()` 的选项按 api 分型，我们一个都不传，模型自己的缺省 reasoning 生效。强制思考的型号会把输出预算花在思考上，而车道要的是一段短 JSON——选车道模型时避开这类型号。
- **扩展之间没有共享服务**：只有 `pi.events` 一条载荷为 `unknown` 的总线，没有请求/响应语义，也没有「等对方就位」的握手。我们的绕法是 kernel 扩展在 `session_start` 把内核 RPC 闭包发上 `coc:kernel-bridge`；memory、module、onboarding 三个扩展在加载时就订阅，所以两种加载顺序都接得住。建卡那条「发起构建并等开场就绪」也只能用总线拼出来：`coc:module-build` 出去，`coc:module-opening-ready` / `coc:module-build-done` / `coc:module-build-failed` 回来，外加一个超时（`PI_COC_BUILD_WAIT_MS`，缺省 30 分钟）——没有请求/响应，就得自己给每一种「不会再有回音」的情况留出口。
- **出站没有附件通道**：助手消息装不下图片或文件（第 3.3 节）。手卡因此退成「机制投影里的一条 `path` + 遥测」，玩家在 TUI 里看不到文件在哪——前端渲染投影之后才看得到。上游请求见第 6 节第 5 条。
- **关机之后车道的调用会把内核子进程重新拉起来**：`KernelClient.close()` 之前只是「杀掉子进程 + 拒掉在飞的请求」，但排队里剩下的请求随后照样被 dispatch，而 dispatch 见 `child` 为空就再 spawn 一个——那个新内核没人再 close 它，工作区被它占着，管道也让宿主进程退不出去（`node --test` 因此挂住不退）。车道（记忆抽取、按需深读）是异步的，关机那一刻它们的调用完全可能还排在队里，所以这条路一定会被走到。现在两道闸：`close()` 之后 `dispatch` 直接拒（`client.ts`），并且总线上发出去的那个 RPC 闭包在 `shutdownKernel` 里当场失效（`index.ts` 的 `bridgeGate`）。`uv run` 那一层还是会留下一个短命的孤儿 python（uv 被 SIGTERM 掉之后它才收到 stdin EOF），但它自己会退。
- **`ctx.shutdown()` 分模式**：交互与 RPC 模式给了 `shutdownHandler`，print 模式与 SDK 直接建的会话没给，调用空转（第 3 节）。所以建卡的收尾是「把开桌命令交出去」+ `ctx.shutdown()`，两件事都做，不指望其中任何一件单独成立。

## 6. 想请上游做的（不是补丁）

1. 工具调用消息上抑制文本块的开关，或让 `message_end` 替换也作用于流式展示。
2. SDK 的 `createAgentSession` 与 `dispose` 发出 `session_start` / `session_shutdown`，或从包根导出 `emitSessionShutdownEvent`。
3. `AgentToolResult` 增加 `isError`。
4. 扩展之间的共享服务：一个有类型的服务注册表，或者让扩展声明依赖另一个扩展的导出。现在跨扩展只能靠 `pi.events` 传 `unknown`，我们在总线上递了一个函数闭包（第 5 节），能用但没有契约保证。
5. 出站附件：让宿主随一条助手消息交给客户端一个文件（图片、PDF），哪怕只是 RPC 模式下的一个 `attachments` 字段。现在图只能进不能出（第 3.3 节），手卡只好退成机制投影里的一条路径。

提了就在这里记编号与状态；被采纳后删掉第 5 节对应的绕法。

## 7. 升版流程

1. 改 `package.json` 的 `devDependencies` 版本，`npm install`。
2. 读新版 `CHANGELOG.md` 里涉及 system prompt 构建、`tool_call`/`tool_result`/`message_end` 语义、RPC 事件、SDK 会话生命周期的条目。
3. `npm run test:ext`，`uv run --frozen python -m pytest tests/play -q`。
4. 起一张真桌打一回合，看交付里没有过程话、正文就是守秘人写的那段（没有被插入机制行），`coc-mechanics` 条目里每条收据都在。另起 `bin/pi-coc setup` 走一步，确认工具面只有 `setup`；跑一次真读者（一段 section），确认 `pi -p` 的参数与退出码没变（第 3.2 节）。
5. 在下面的版本日志里加一行；第 4 节或第 5 节有变的先改本文件。

## 版本日志

| Pi 版本 | 日期 | 结果 |
| --- | --- | --- |
| 0.85.1 | 2026-09-05 | 首版契约；三项旧补丁全部不再需要 |
