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

`package.json` 的 `pi` 字段只声明 `extensions`。手艺文档走回合胶囊的 `style` 节，不走 Pi skills；`prompts` 目录只被启动器读取，不交给 Pi 发现。

## 3. 扩展 API：我们用到的面

事件：`session_start`、`session_shutdown`、`before_agent_start`、`agent_start`、`agent_end`、`turn_start`、`tool_call`、`tool_result`、`message_end`、`context`。

方法：`registerTool`（`name`、`label`、`description`、`promptSnippet`、`parameters` TypeBox、`executionMode`、`execute`）、`setActiveTools`（只在 `session_start` 调一次）、`sendMessage`（`customType`、`content`、`display`、`details`，`triggerTurn`）、`appendEntry`、`events`。

上下文：`ctx.cwd`、`ctx.hasUI`、`ctx.ui.notify` / `select` / `setStatus`。

## 4. 我们依赖的行为，以及各自的核对方法

每条都有一个测试或一次真桌回合能证明；升版后失一条就是不兼容。

| 行为 | 核对 |
| --- | --- |
| `before_agent_start.prompt` 是玩家原文；返回 `message` 会在本轮开始前注入一条 custom 消息，`display:false` 仍进模型上下文 | `tests/extension/turn.test.mjs` 胶囊断言 |
| `tool_call` 里就地改 `event.input` 会生效；返回 `{block, reason}` 让模型收到一条错误结果而不执行 | `gates.test.mjs` |
| `executionMode: "sequential"` 的工具按 assistant 消息里的顺序逐个 preflight 与执行，所以 `narrate` 之后同批余下调用能被拦住、`call_id` 序号确定 | `gates.test.mjs`、`turn.test.mjs` |
| `tool_result` 返回 `{isError:true}` 的局部补丁被采纳 | `session.test.mjs` 内核报错用例 |
| `message_end` 可用同 role 的替换消息覆盖已完成的助手消息，包括删掉文本块、替换文本块 | `turn.test.mjs`、`real-kernel.test.mjs` |
| `agent_end` 在每次 agent run 结束时触发，`sendMessage(..., {triggerTurn:true})` 能在其后开新一轮 | `session.test.mjs` 催收用例 |
| `session_start` 只在 `bindExtensions` 时发；`createAgentSession` 本身不发 | `harness.mjs` 注释与 `openTable` |
| RPC 帧只以 `\n` 分隔；`set_model` 收 `provider` 与 `modelId` 两个字段；`agent_settled` 是回合真正结束 | `tests/play/test_driver.py` 与真 Pi 冒烟 |
| 缺省提示替换后不再有「Available tools」一节，工具用法只靠工具自己的 `description` | 真桌回合：守秘人无需索引即能正确调用七个工具 |

## 5. 已知限制与我们的绕法

- **流式文本**：助手在工具调用前写的文字会先流到客户端，我们在 `message_end` 才删。pi 的 TUI 会闪一下；我们的前端只渲染已提交的消息。提示词同时要求「调用其他工具时不要附带任何文字」。
- **SDK 生命周期**：`createAgentSession` 不发 `session_start`，`AgentSession.dispose` 不发 `session_shutdown`，`emitSessionShutdownEvent` 未从包根导出。测试台在 `bindExtensions` 后开桌，并借 `session._extensionRunner` 发 shutdown 让内核子进程退出。
- **工具结果没有 `isError`**：扩展在 `tool_result` 钩子里补旗。
- **`pi.getActiveTools` 只在扩展内可用**：测试台挂一个 inline 探针扩展取 `pi`。
- **Node 24 的 `node --test <目录>`** 把目录当文件：用 `npm run test:ext` 里的引号 glob。

## 6. 想请上游做的（不是补丁）

1. 工具调用消息上抑制文本块的开关，或让 `message_end` 替换也作用于流式展示。
2. SDK 的 `createAgentSession` 与 `dispose` 发出 `session_start` / `session_shutdown`，或从包根导出 `emitSessionShutdownEvent`。
3. `AgentToolResult` 增加 `isError`。

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
