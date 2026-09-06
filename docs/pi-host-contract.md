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

Pi 家目录由 `PI_CODING_AGENT_DIR` 指定为仓库内 `.pi/coc-agent`；`settings.json` 里 `packages` 指向本仓库，`defaultProvider`/`defaultModel` 决定开桌那一轮用的模型，因为开桌轮在任何 RPC `set_model` 之前就触发。

## 2. 包清单

`package.json` 的 `pi` 字段只声明 `extensions`，三个：`kernel`（内核子进程与七个动词、校验车道）、`memory`（记忆抽取车道）、`table`（桌况显示）。`extensions/lanes/` 不是扩展，是两条车道共用的子会话模块，只被 import，不进 `pi.extensions`。手艺文档走回合胶囊的 `style` 节，不走 Pi skills；`prompts` 目录只被启动器读取，不交给 Pi 发现。

## 3. 扩展 API：我们用到的面

事件：`session_start`、`session_shutdown`、`before_agent_start`、`agent_start`、`agent_end`、`turn_start`、`tool_call`、`tool_result`、`message_end`、`context`。

方法：`registerTool`（`name`、`label`、`description`、`promptSnippet`、`parameters` TypeBox、`executionMode`、`execute`）、`setActiveTools`（只在 `session_start` 调一次）、`sendMessage`（`customType`、`content`、`display`、`details`，`triggerTurn`）、`appendEntry`、`events`。

上下文：`ctx.cwd`、`ctx.hasUI`、`ctx.ui.notify` / `select` / `setStatus`、`ctx.model`、`ctx.modelRegistry.find` / `complete`。

总线：`pi.events.emit` / `on`。五个频道：`coc:table-open`、`coc:resolve`、`coc:capsule`（本回合胶囊原样一份，桌况显示用它取 Director 节拍，契约 §13.9）、`coc:turn-committed`（契约 §12.8 的提交载荷）、`coc:kernel-bridge`（内核 RPC 闭包，见下）。

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

两条车道各自的边界（扩展这一侧的决定，内核照此实现）：

- 校验车道**跑成功就叫一次 `table.warn`，哪怕 `findings` 是空的**：内核那边因此分得清「车道跑了、没发现」和「车道压根没跑」。所以 `table.warn` 必须收得下 `findings: []`。
- 发现在送出去之前先过闭合枚举与三个字符串字段的形状校验，认不出的整条丢掉，再按契约 §12.5 的上限截到 10 条——超限整批被判 `invalid_params` 的话，advisory 的东西反倒变成了噪音。同理，候选断言只送契约 §12.3 那八个字段，模型顺手写的 `turn`、`commit` 在扩展这一侧就摘掉。
- 内核不回 `facts` 时（切片 0、1 的 `narrate`）校验车道整条不起：没有事实清单，读什么都是猜。记忆车道照跑，任务包由内核按回合出。

跨扩展只有总线：memory 扩展要 `memory.job` / `submit` / `fail`，但内核子进程一个会话只有一个（契约 §1），所以 kernel 扩展在 `session_start` 用 `coc:kernel-bridge` 把一个 `call(method, params)` 闭包发上总线，`session_shutdown` 再发一次空的把它撤掉。总线是进程内的 `EventEmitter`，载荷不做序列化，闭包传得过去。

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
| `session_start` 只在 `bindExtensions` 时发；`createAgentSession` 本身不发 | `harness.mjs` 注释与 `openTable` |
| RPC 帧只以 `\n` 分隔；`set_model` 收 `provider` 与 `modelId` 两个字段；`agent_settled` 是回合真正结束 | `tests/play/test_driver.py` 与真 Pi 冒烟 |
| 缺省提示替换后不再有「Available tools」一节，工具用法只靠工具自己的 `description` | 真桌回合：守秘人无需索引即能正确调用七个工具 |
| `ctx.modelRegistry.complete(model, {systemPrompt, messages})` 不带 `tools` 就是零工具补全，鉴权与 baseUrl 走当前会话的模型注册表 | `lanes.test.mjs` 两条车道用例：断言子会话收到的 `context.tools === undefined` |
| `ctx.modelRegistry.find(provider, id)` 取得到运行时注册进来的模型；`ctx.model` 是桌子当前的模型 | `lanes.test.mjs`「车道模型来自环境变量」与「不点名模型时两条车道都跟桌子同模型」 |
| `session_start` 拿到的 `ctx` 字段是取值时算的，之后仍反映当前模型；会话结束后它的 getter 会抛，车道因此整封失败 | 同上两个用例 |
| `pi.events` 是进程内 `EventEmitter`：载荷可带函数，跨扩展递内核 RPC 闭包可行；处理器抛错被总线吞掉，不影响回合 | `lanes.test.mjs` 记忆车道用例：memory 扩展只靠总线够到内核 |
| `message_end` 返回替换消息之后再排的 0 毫秒定时器跑在交付之后 | `lanes.test.mjs`「交付不等车道」 |

## 5. 已知限制与我们的绕法

- **流式文本**：助手在工具调用前写的文字会先流到客户端，我们在 `message_end` 才删。pi 的 TUI 会闪一下；我们的前端只渲染已提交的消息。提示词同时要求「调用其他工具时不要附带任何文字」。
- **SDK 生命周期**：`createAgentSession` 不发 `session_start`，`AgentSession.dispose` 不发 `session_shutdown`，`emitSessionShutdownEvent` 未从包根导出。测试台在 `bindExtensions` 后开桌，并借 `session._extensionRunner` 发 shutdown 让内核子进程退出。
- **工具结果没有 `isError`**：扩展在 `tool_result` 钩子里补旗。
- **`pi.getActiveTools` 只在扩展内可用**：测试台挂一个 inline 探针扩展取 `pi`。
- **Node 24 的 `node --test <目录>`** 把目录当文件：用 `npm run test:ext` 里的引号 glob。
- **扩展里起不了嵌套 agent 会话**：`createAgentSession` 要 `ModelRuntime` 与 `ResourceLoader`，扩展只拿得到 `ModelRegistry` 这个门面；就算硬凑出来，它会把本包的扩展再绑一遍，内核子进程就成了两个，违反契约 §1。所以车道是**一次补全，不是一个会话**：没有工具、没有多轮、不进会话记录、不吃 `SettingsManager` 的重试与压缩设置，token 也不进 Pi 的上下文统计（只进我们自己的遥测行）。两条车道的产出是 ≤ 12 条候选或 ≤ 10 条发现的短 JSON，本来就在一条助手消息的上限之下（规格第六、九节），所以这条限制现在不咬人；哪天车道要用工具，得先有上游的路，不是在这里凑。
- **`AgentSession.dispose()` 会把扩展 ctx 作废**：`dispose` 调 `runner.invalidate()`，之后那个 ctx 的每个 getter 都抛「stale after session replacement or reload」。车道是异步的，续行完全可能落在 dispose 之后（用户在车道飞着的时候退出 pi），所以**每一次碰 ctx 都当成会抛**：`runLane` 整个身子在 try 里，记忆车道的队列泵与遥测也各自兜住。漏一个就是一条没人接的 promise rejection——扩展测试跑六遍里中过两次。
- **子会话的思考等级不受控**：`complete()` 的选项按 api 分型，我们一个都不传，模型自己的缺省 reasoning 生效。强制思考的型号会把输出预算花在思考上，而车道要的是一段短 JSON——选车道模型时避开这类型号。
- **扩展之间没有共享服务**：只有 `pi.events` 一条载荷为 `unknown` 的总线，没有请求/响应语义，也没有「等对方就位」的握手。我们的绕法是 kernel 扩展在 `session_start` 把内核 RPC 闭包发上 `coc:kernel-bridge`；memory 扩展在加载时就订阅，所以两种加载顺序都接得住。

## 6. 想请上游做的（不是补丁）

1. 工具调用消息上抑制文本块的开关，或让 `message_end` 替换也作用于流式展示。
2. SDK 的 `createAgentSession` 与 `dispose` 发出 `session_start` / `session_shutdown`，或从包根导出 `emitSessionShutdownEvent`。
3. `AgentToolResult` 增加 `isError`。
4. 扩展之间的共享服务：一个有类型的服务注册表，或者让扩展声明依赖另一个扩展的导出。现在跨扩展只能靠 `pi.events` 传 `unknown`，我们在总线上递了一个函数闭包（第 5 节），能用但没有契约保证。

提了就在这里记编号与状态；被采纳后删掉第 5 节对应的绕法。

## 7. 升版流程

1. 改 `package.json` 的 `devDependencies` 版本，`npm install`。
2. 读新版 `CHANGELOG.md` 里涉及 system prompt 构建、`tool_call`/`tool_result`/`message_end` 语义、RPC 事件、SDK 会话生命周期的条目。
3. `npm run test:ext`，`uv run --frozen python -m pytest tests/play -q`。
4. 起一张真桌打一回合，看交付里没有过程话、明骰行由内核插入。
5. 在下面的版本日志里加一行；第 4 节或第 5 节有变的先改本文件。

## 版本日志

| Pi 版本 | 日期 | 结果 |
| --- | --- | --- |
| 0.85.1 | 2026-09-05 | 首版契约；三项旧补丁全部不再需要 |
