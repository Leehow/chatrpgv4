# COC Keeper Desktop（pi-coc 轨道）

pi-coc 的 Electron 桌面壳：加载现有 web 前端（同一构建产物，浏览器版不受影响），
捆绑 pi-coc 全部运行时与扩展，用户双击即玩。**v1 仅 macOS arm64，未签名。**

## 快速开始

```bash
# 开发模式（直接用仓库 checkout 与本机 uv/node）
cd desktop && npm install
npm start   # 使用 Electron 自有 <userData>/pi-agent

# 打包（组装 payload + 捆绑二进制 + 出 DMG）
npm run dist    # 产物 dist/COC Keeper-0.1.0-arm64.dmg
```

## 架构

壳只做三件事：**进程管理、环境自举、首跑向导**。Electron 是 pi-coc 的
UI：`web/server-node/server.mjs` 为每个战役拉起 `pi-coc --mode rpc`，
浏览器只渲染那条宿主事件流。canonical 插件仍是唯一规则/技能内核。

- `electron/main.mjs` — 单实例、空闲端口、spawn web 桥（独立进程组，退出时
  整树 SIGTERM）、首跑向导闸门、应用菜单（⌘, 设置）。
- `electron/env.mjs` — 子进程 env 组装：`PI_AGENT_DIR`=`PI_CODING_AGENT_DIR`
  指向应用自管 agent 目录；`PATH` 前置捆绑 bin（node/uv）；`PI_OFFLINE`、
  `COC_PI_SCENE_SUPPLY=1`（TUI parity）；`COC_PI_PDF_INSPECTOR_COMMAND` 指向
  捆绑路由；packaged 模式另设 `UV_PYTHON`/`UV_PROJECT_ENVIRONMENT`/`UV_CACHE_DIR`/
  `UV_NO_DEV=1`（首跑零下载）。剥离 `PI_COC_CAMPAIGN_ID` 等会话选择器。
- `electron/bootstrap.mjs` — 复刻 pi-coc TUI 的副作用：steward agent 镜像到
  workspace 的 `.pi/agents/`；packaged 首跑 `uv sync --frozen`。
- `electron/agentconfig.mjs` — 向导写入器（纯 Node 可测）：upsert
  `models.json` providers + `auth.json` api_key（0600/0700，与 pi 本体一致）。
- `wizard/` — 首跑向导 + 设置页（React 19 + Vite 8，`loadFile` 加载，
  contextIsolation + 类型化 IPC）。预置 DeepSeek / xAI / 智谱 GLM / 自定义
  OpenAI 兼容端点；开场文本抽取与必要的 PDF 视觉回退都跟随主界面
  当前模型，设置页只展示能力状态（OCR 显式 gate）。
- `scripts/payload.mjs` — 组装 `build/`：payload（runtime、plugins、
  web/server-node、web/frontend/dist、根 manifest、keeper node_modules）、
  bin（node v24.19.0、uv 0.11.16）、python（python-build-standalone
  CPython 3.14.6）、coc-tools（pdf-inspector，本地 napi，无密钥无网络）。
  产物清单与 sha256 见 `build/payload-manifest.json`。

## 版本契约（锁死，不随"最新"升级）

pi-coding-agent **0.84.2**、CPython **3.14.6**、uv **0.11.16**。
Electron/Node/Vite/React/TypeScript 用最新稳定版。

## 运行时数据

- 战役工作区：`<userData>/coc-workspace`（`.coc/` 战役状态在此）
- pi agent 配置：`<userData>/pi-agent`（dev / packaged 一致，不读取全局 `~/.pi/agent`）
- venv/缓存：`<userData>/coc-venv`、`<userData>/uv-cache`
- 日志：`<userData>/logs/desktop.log`
- 测试覆盖盖：`COC_DESKTOP_USER_DATA`（QA 专用，模拟全新首跑）

## 已知边界

- 未签名/未公证（D 阶段需要 Apple Developer ID）；他人机器首次打开需
  右键打开绕过 Gatekeeper。
- OCR（baiduocr）与 Firecrawl 深链路为外部依赖，按能力状态显式 gate，
  不捆绑、不静默降级。
- 模型以列表勾选方式选择：填入 Base URL + API Key 后自动 `GET
  {baseUrl}/models` 拉取在线目录（在线目录为准，预置清单仅作起点）；
  端点不提供模型列表时可手动添加单个模型 ID。
